// src/core/session-host.mjs — one SessionHost per session: the member dispatches of a session run one at a time, each as
// ONE host turn (session groups, Tasks 39–41; spec §5, §5.2; C2, C25, C39). The executor hands a member's unchanged
// runOpts to `host.run(opts, member)` (Task 45). Every fact lands in the session trace (session-trace.mjs), never a prompt.
import { runClaude, mockEnabled } from './claude-runner.mjs';
import { runMockSession } from './engines/mock-session.mjs';
import { HOST_MAX_TURNS, dispatchIdFor, turnIdFor, dispatchMessage, memberDefinition, hostFlagsFor, hostSpawnOpts } from './engines/session-dispatch.mjs';
import { createSessionTrace, applyTraceRecord, emptySummary } from './session-trace.mjs';
import { markTerminal } from './failure-policy.mjs';

/** v1 runs every session on the `turns` transport: one `--resume` process per dispatch (spec D4). */
export const SESSION_TRANSPORT = 'turns';

/** The host turn's runner. The mock host plays a turn offline; a real one is `runClaude` with the RAW envelopes the demux
 *  routes (`rawEvents`: runClaude otherwise hands out the normalized vocabulary, which carries no Agent call). The mock
 *  predicate is claude-runner's own (`opts.mock` OR WORCA_MOCK/ORCH_MOCK, critique minor 8), never `opts.mock` alone. */
export const defaultTransport = (hostOpts) => (mockEnabled(hostOpts) ? runMockSession(hostOpts) : runClaude({ ...hostOpts, rawEvents: true }));

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const emitTo = (onEvent, e) => { try { if (typeof onEvent === 'function') onEvent(e); } catch { /* a listener never breaks the turn */ } };
const decisionOf = (decisions, sid) => (decisions instanceof Map ? decisions.get(sid) : decisions?.[sid]) || null;

export class SessionHost {
  constructor({ spec, decision, port, transport, plainRun, limits = {} }) {
    const settings = spec.settings || {};
    this.sid = spec.sid;
    this.members = Array.isArray(spec.members) ? [...spec.members] : [];
    this.settings = settings;
    this.label = settings.label ?? null;
    this.decision = decision;
    this.mode = decision.mode;
    this.degradeReason = decision.mode === 'separate' ? (decision.reason ?? null) : null;
    this.port = port;
    this.transport = transport;
    this.plainRun = plainRun;
    this.limits = { ...limits };
    this.engine = port.engine ?? null;
    this.hostEpoch = 1;                        // C2: the first host session is epoch 1
    this.hostSessionId = null;
    this.hostResolvedModel = null;
    this.turns = 0;
    this.dispatches = 0;
    this.epochDispatches = 0;
    this.rotations = 0;
    this.restarts = 0;
    this.attempts = new Map();                 // executionId → attempts started (C2)
    this.consecutiveWatchdog = 0;
    this.lastContextTokens = 0;
    this.lastCumulativeUsd = 0;
    this.epochOpeningUsd = 0;
    this.openCut = null;
    this.lastDispatch = new Map();             // executionId → { dispatchId, nodeId } of its latest dispatch (noteVerdict)
    this.queue = [];
    this.busy = false;
    this.inflight = null;                      // the turn in flight: close() lets it settle first
    this.closed = false;
    this.closing = null;                       // the one close() promise
    this.openedAt = Date.now();
    this.summary = emptySummary({ sid: this.sid, label: this.label, members: this.members });
    this.trace = createSessionTrace({ pipelineDir: port.pipelineDir, sid: this.sid, runId: port.runId ?? null });
  }

  /** Append one record (with the host's ids), fold it into the live summary and hand both to the port (C6). */
  _write(kind, fields = {}) {
    const rec = this.trace.append(kind, { hostEpoch: this.hostEpoch, hostSessionId: this.hostSessionId, ...fields });
    if (!rec) return null;
    this.summary = applyTraceRecord(this.summary, rec);
    try { this.port.onRecord?.(this.sid, rec, this.summary); } catch { /* the port never breaks a turn */ }
    return rec;
  }

  _queued(executionId, queued) {
    try { this.port.onQueue?.(executionId, queued); } catch { /* status only */ }
  }

  /** The executor's `run` for a member (C25: FIFO, one turn at a time). Rejects at once with an AbortError when the
   *  signal already fired or the host is closed: nothing is queued and nothing is written. */
  run(opts, member) {
    const o = opts || {};
    const m = member || {};
    if (o.signal?.aborted) return Promise.reject(abortError());
    if (this.closed) return Promise.reject(this._refusal());
    return new Promise((resolve, reject) => {
      const entry = { opts: o, member: m, enqueuedAt: Date.now(), resolve, reject, onAbort: null, waited: false };
      if (o.signal) {
        // A waiter whose signal fires leaves the queue at once: no record, no turn, no attempt, and its executor returns,
        // which frees its agent-pool slot (scheduler.mjs settle). A started dispatch hears the abort through its turn.
        entry.onAbort = () => {
          const i = this.queue.indexOf(entry);
          if (i < 0) return;
          this.queue.splice(i, 1);
          if (entry.waited) this._queued(m.executionId, false);
          reject(abortError());
        };
        o.signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.queue.push(entry);
      if (this.busy) { entry.waited = true; this._queued(m.executionId, true); }   // C39: the row says "queued"
      this._pump();
    });
  }

  _pump() {
    if (this.busy) return;
    const entry = this.queue.shift();
    if (!entry) return;
    this.busy = true;
    if (entry.onAbort) entry.opts.signal.removeEventListener('abort', entry.onAbort);
    if (entry.waited) this._queued(entry.member.executionId, false);
    const queueMs = Date.now() - entry.enqueuedAt;
    this.inflight = Promise.resolve()
      .then(() => this._dispatch(entry.opts, entry.member, { queueMs, waited: entry.waited }))
      .then((value) => ({ value }), (error) => ({ error, failed: true }))
      .then((r) => {
        // Free the host BEFORE the caller hears back: a caller that runs again at once (the executor's sideload retry, its
        // clarifier repair) starts at once instead of reading "queued" behind its own finished turn (C39).
        this.busy = false;
        this.inflight = null;
        if (r.failed) entry.reject(r.error); else entry.resolve(r.value);
        this._pump();
      });
  }

  async _dispatch(opts, member, { queueMs, waited = false }) {
    if (opts.signal?.aborted) throw abortError();                            // aborted after it left the queue: no attempt, no record
    if (this.closed) throw this._refusal();                                  // closed after it left the queue: it never starts
    if (waited) this.port.checkCostLimits?.();                               // C37: the executor gated it before it queued; spend moved since
    return this._turn(opts, member, { queueMs });
  }

  /** The attempt number is taken when the dispatch STARTS, so a cancelled waiter consumes none (C2). */
  _nextAttempt(executionId) {
    const n = (this.attempts.get(executionId) || 0) + 1;
    this.attempts.set(executionId, n);
    return n;
  }

  /** One host turn. Task 39 runs the transport and writes the turn's frame records; Task 40 fills in the rest. */
  async _turn(opts, member, { queueMs = 0 } = {}) {
    const executionId = String(member.executionId);
    const nodeId = member.nodeId ?? null;
    const label = member.label || nodeId || executionId;
    const attempt = this._nextAttempt(executionId);
    const turnId = turnIdFor(this.sid, ++this.turns);
    const dispatchId = dispatchIdFor(executionId, attempt);
    const flags = hostFlagsFor({ settings: this.settings, firstMemberModel: this.decision.firstMemberModel ?? null, member });
    this.dispatches += 1;
    this.epochDispatches += 1;
    this.lastDispatch.set(executionId, { dispatchId, nodeId });
    const { agentType, definitions } = memberDefinition(opts, { executionId, attempt, label });
    this._write('turn_start', { turnId, resume: !!this.hostSessionId, maxTurns: HOST_MAX_TURNS, maxBudgetUsd: null,
      hostModel: flags.model ?? null, hostEffort: flags.effort ?? null });
    this._write('dispatch', { turnId, dispatchId, executionId, nodeId, attempt, agentType,
      cold: attempt > 1 || !!opts.resumeSessionId || !!opts.coldRedispatch, queueMs });
    const turnAbort = new AbortController();
    const signal = opts.signal ? AbortSignal.any([opts.signal, turnAbort.signal]) : turnAbort.signal;
    const hostOpts = hostSpawnOpts(opts, { hostSessionId: this.hostSessionId, hostModel: flags.model, hostEffort: flags.effort, definitions,
      dispatchText: dispatchMessage({ agentType, label }) });
    try {
      const out = await this.transport({ ...hostOpts, signal, onEvent: (e) => emitTo(opts.onEvent, e) });
      this._write('turn_end', { turnId, exit: 'ok' });
      return { text: String(out?.text ?? ''), exitCode: out?.exitCode ?? 0 };
    } catch (err) {
      const aborted = !!opts.signal?.aborted;
      this._write('turn_end', { turnId, exit: aborted ? 'aborted' : 'error' });
      throw aborted && err?.name !== 'AbortError' ? abortError() : err;
    }
  }

  /** C5: the executor's verdict on the execution's latest dispatch (counts only). */
  noteVerdict(executionId, { verdict = 'none', issues = 0 } = {}) {
    const last = this.lastDispatch.get(executionId);
    if (!last) return;
    this._write('verdict', { dispatchId: last.dispatchId, executionId, nodeId: last.nodeId, verdict,
      issues: Array.isArray(issues) ? issues.length : (Number.isFinite(issues) ? issues : 0) });
  }

  snapshot() {
    return {
      sid: this.sid, mode: this.mode, degradeReason: this.degradeReason, engine: this.engine, hostEpoch: this.hostEpoch,
      hostSessionId: this.hostSessionId, hostResolvedModel: this.hostResolvedModel, turns: this.turns, dispatches: this.dispatches,
      epochDispatches: this.epochDispatches, rotations: this.rotations, restarts: this.restarts,
      attempts: Object.fromEntries(this.attempts), consecutiveWatchdog: this.consecutiveWatchdog, lastContextTokens: this.lastContextTokens,
      lastCumulativeUsd: this.lastCumulativeUsd, epochOpeningUsd: this.epochOpeningUsd, openCut: this.openCut ? { ...this.openCut } : null,
      status: this.summary.status,
    };
  }

  /** 'paused' writes `pause` (a later run resumes this host, Task 47); any other outcome writes `close`. Once. A run that
   *  ends on Stop or a failure does not wait for its running steps (graph/scheduler.mjs `finish`), so close refuses the
   *  waiters and lets the turn in flight settle first: its records come before `pause`/`close`. */
  close(outcome) {
    this.closing ??= this._close(outcome);                                    // once; a second caller waits for the first
    return this.closing;
  }

  /** What a closed host tells a waiter it refuses (and a dispatch that would start after close): a TERMINAL AbortError,
   *  so the member's flow site enacts it and never re-decides it as a pause with the detail 'aborted' (orchestrator.mjs
   *  `_execute`; the slice prompt guard does the same). A real pause has no waiters left to refuse (each one's signal
   *  carries the pause, and the scheduler waits for it), and a pause settles any AbortError as paused before the mark. */
  _refusal() {
    return markTerminal(abortError());
  }

  async _close(outcome) {
    this.closed = true;
    for (const entry of this.queue.splice(0)) {
      if (entry.onAbort) entry.opts.signal.removeEventListener('abort', entry.onAbort);
      if (entry.waited) this._queued(entry.member.executionId, false);
      entry.reject(this._refusal());
    }
    await this.inflight;
    if (outcome === 'paused') {
      this._write('pause', { reason: 'pause', ...(this.openCut ? { turnId: this.openCut.turnId, dispatchId: this.openCut.dispatchId } : {}) });
    } else {
      this._write('close', { status: outcome, costUsd: this.summary.costUsd, hostOverheadUsd: this.summary.hostOverheadUsd,
        turns: this.turns, dispatches: this.dispatches, rotations: this.rotations, restarts: this.restarts,
        wallMs: Date.now() - this.openedAt, reconciled: this.summary.reconciled });
    }
    await this.trace.close();
  }
}

/**
 * One SessionHost per session spec. `decisions` is the run-start gate's `Map<sid, Decision>` (Task 44); a spec without
 * one runs separate. `restore` is `resumePoint.sessionHosts` (Task 47 merges it). `plainRun` is what a degraded
 * session's dispatch calls (Task 41, C30): the executor's own runner, so it runs exactly as ungrouped.
 */
export function createSessionHosts({ specs = [], decisions = null, port, transport = defaultTransport, plainRun = runClaude, restore = null, limits = {} } = {}) {
  void restore;                                                            // Task 47
  const hosts = new Map();
  const byNode = new Map();
  for (const spec of Array.isArray(specs) ? specs : []) {
    if (!spec || typeof spec.sid !== 'string') continue;
    const decision = decisionOf(decisions, spec.sid)
      || { mode: 'separate', requested: spec.settings?.mode ?? null, reason: 'no run-start decision', firstMemberModel: null };
    const host = new SessionHost({ spec, decision, port, transport, plainRun, limits });
    hosts.set(spec.sid, host);
    for (const id of host.members) byNode.set(id, host);
    const s = spec.settings || {};
    host._write('open', { engine: port.engine ?? null, mode: decision.mode, transport: SESSION_TRANSPORT, hostModel: s.hostModel ?? null,
      hostEffort: s.hostEffort ?? null, members: host.members, label: host.label });
    host._write('mode', { mode: decision.mode, requested: decision.requested ?? null, reason: decision.reason ?? null,
      engine: port.engine ?? null, transport: SESSION_TRANSPORT });
    // C27: a separate session still writes a short trace, so the Sessions tab can say why.
    if (decision.mode === 'separate') host._write('degrade', { from: decision.requested ?? 'subagents', to: 'separate', reason: decision.reason ?? null });
  }
  return {
    hosts,
    /** null for a ×N slice, a role-review slice (D2), a session that runs separate from the start, or a non-member. */
    hostFor(nodeId, { slice = null, role = null } = {}) {
      if (slice || role) return null;
      const h = byNode.get(nodeId);
      return h && h.decision.mode !== 'separate' ? h : null;
    },
    sidOf: (nodeId) => byNode.get(nodeId)?.sid ?? null,
    modeOf: (nodeId) => byNode.get(nodeId)?.mode ?? null,
    noteVerdict(executionId, v) {
      for (const h of hosts.values()) if (h.lastDispatch.has(executionId)) { h.noteVerdict(executionId, v); return; }
    },
    snapshot: () => Object.fromEntries([...hosts].map(([sid, h]) => [sid, h.snapshot()])),
    close: async (outcome) => { await Promise.all([...hosts.values()].map((h) => h.close(outcome))); },
  };
}
