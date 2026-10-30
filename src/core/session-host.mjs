// src/core/session-host.mjs — one SessionHost per session: the member dispatches of a session run one at a time, each as
// ONE host turn (session groups, Tasks 39–41; spec §5, §5.2, §6.3; C2, C9–C12, C20, C25, C30, C31, C35, C39–C41, C43). The executor
// hands a member's unchanged runOpts to `host.run(opts, member)` (Task 45). A turn's frames go through the demux
// (session-demux.mjs), its dollars through the harness port (Task 42), and every fact lands in the session trace
// (session-trace.mjs), never a prompt.
import { runClaude, mockEnabled } from './claude-runner.mjs';
import { runMockSession, mockRestoresCutCost } from './engines/mock-session.mjs';
import { SessionHostError, HOST_MAX_TURNS, HOST_TOOLS_MODE, dispatchIdFor, turnIdFor, dispatchMessage, memberDefinition, hostFlagsFor,
  hostSpawnOpts, sharedTurnOpts } from './engines/session-dispatch.mjs';
import { createTurnDemux, watchdogVerdict } from './engines/session-demux.mjs';
import { createSessionTrace, applyTraceRecord, emptySummary, readTraceSync, reduceTrace } from './session-trace.mjs';
import { priceUsage, usageTokens, reconcileEpoch, estimateMemberUsd } from './session-cost.mjs';
import { listCostRates } from './config.mjs';
import { upstreamKey } from './model-roles.mjs';
import { classifyError } from './recoverable-error.mjs';
import { engineReportsCost } from '../shared/engine-switch.mjs';
import { RECOVERY_MAX_AUTO_ATTEMPTS, markTerminal } from './failure-policy.mjs';
import { sessionHostGuardSettings } from './session-host-guard.mjs';
import { CODEX_RESUME_NOT_FOUND_RE } from './engines/codex.mjs';
import { COPILOT_RESUME_NOT_FOUND_RE } from './engines/copilot.mjs';

/** v1 runs every session on the `turns` transport: one `--resume` process per dispatch (spec D4). */
export const SESSION_TRANSPORT = 'turns';
/** Does the next `--resume` of the same host restore a killed turn's spend in its cumulative total (S4)? Then a cut turn's
 *  spend is carried into the next Δ of its epoch; else it is booked at the cut as an estimate (C9). */
export const HOST_CUT_COST_RESTORED = true;
/** The result subtype of a turn `--max-budget-usd` stopped (S4; C10). */
export const HOST_BUDGET_SUBTYPE = 'error_max_budget_usd';
/** A `--resume` whose host transcript is gone (S1 pins the fragment; C20). */
export const VANISHED_RE = /No conversation found/i;
/** Rotation (spec §5, C25): a fresh host session after this many dispatches, or once the LAST host message of a turn held
 *  this much context (input + cache, critique minor 4). S6 / Task 53 may change them. */
export const HOST_ROTATE_DISPATCHES = 24;
export const HOST_ROTATE_CONTEXT_TOKENS = 120000;
/** Does `--max-budget-usd` count the whole host session, earlier turns included (S4)? Then the flag is the remaining
 *  pipeline budget plus the host's last cumulative figure (C10). */
export const HOST_BUDGET_IS_CUMULATIVE = true;
/** C40: attach the host-only PreToolUse guard (session-host-guard.mjs) in `union` mode, once S3 shows a payload field that
 *  only a sub-agent's call carries; HOST_GUARD_CONTEXT_FIELD names it. Off until then: the watchdog stops such a call after the fact. */
export const HOST_MAIN_THREAD_GUARD = false;
export const HOST_GUARD_CONTEXT_FIELD = null;
/** Is there a `shared` ("one conversation") runtime? Task 65 built it (`_sharedTurn`). Off, the run-start gate would run a
 *  `shared` session separate, never as sub-agents behind the closed gate (C18). */
export const SESSION_SHARED_RUNTIME = true;
/** Engines whose result reports the conversation's running total, so a cut turn's spend reaches the next result:
 *  Claude Code (claude-events.mjs `cumulativeCost`) and Goose (its `complete` is the session's sum, goose.mjs). Codex and
 *  OpenCode report each process's own figure. */
const CUMULATIVE_COST_ENGINES = new Set(['claude', 'goose']);
/** Engines whose result usage is the session's sum too, never one turn's tokens (goose.mjs `complete`, `total: true`). */
const SESSION_SUM_USAGE_ENGINES = new Set(['goose']);
/** What each engine says when a `--resume` finds no conversation (C20), where its adapter does not start a fresh one
 *  itself: Claude Code, Codex, Copilot. (Goose, OpenCode, Cursor, Gemini and Qwen retry fresh and name the new id.) */
const LOST_CONVERSATION_RES = [VANISHED_RE, CODEX_RESUME_NOT_FOUND_RE, COPILOT_RESUME_NOT_FOUND_RE];
/** A result of a turn that never ran: an error with no model turn. Claude Code answers a `--resume` of a lost conversation
 *  with one (`error_during_execution`, `num_turns: 0`, `errors: ["No conversation found …"]`, $0) before it exits 1
 *  (test/fixtures/ask/bogus-resume.jsonl), so it is no sign the conversation answered (C20). */
const noTurnResult = (e) => e.isError === true && !(e.numTurns > 0);
/** C30: this many consecutive watchdog failures in one session degrade it to `separate` for the rest of the run. */
export const HOST_DEGRADE_AFTER = RECOVERY_MAX_AUTO_ATTEMPTS;
/** `--max-budget-usd` never goes below a cent (C10). */
const BUDGET_FLOOR_USD = 0.01;

/** The host turn's runner. The mock host plays a turn offline; a real one is `runClaude` with the RAW envelopes the demux
 *  routes (`rawEvents`: runClaude otherwise hands out the normalized vocabulary, which carries no Agent call). The mock
 *  predicate is claude-runner's own (`opts.mock` OR WORCA_MOCK/ORCH_MOCK, critique minor 8), never `opts.mock` alone. */
export const defaultTransport = (hostOpts) => {
  if (mockEnabled(hostOpts)) return runMockSession(hostOpts);
  // A `shared` turn is the member's own spawn on the run's engine: normalized events, as an ungrouped step gets (Task 65).
  if (hostOpts.shared === true) { const o = { ...hostOpts }; delete o.shared; return runClaude(o); }
  return runClaude({ ...hostOpts, rawEvents: true });
};

/** Test seams (the parity checks): `onDefinitions(definitions, memberOpts, member)` sees each turn's definitions beside the
 *  member's own runOpts (Task 49); `onSharedTurn(turnOpts, memberOpts, member)` sees each `shared` turn's options beside
 *  them (Task 65). Never set in production. */
export const _testing = { onDefinitions: null, onSharedTurn: null };

const WATCHDOG_TEXT = {
  SESSION_HOST_NO_DISPATCH: 'the main agent did not dispatch the step',
  SESSION_HOST_MULTI_DISPATCH: 'the main agent dispatched the step more than once',
  SESSION_HOST_STRAY_TOOL: 'the main agent called a tool itself',
};
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const emitTo = (onEvent, e) => { try { if (typeof onEvent === 'function') onEvent(e); } catch { /* a listener never breaks the turn */ } };
const decisionOf = (decisions, sid) => (decisions instanceof Map ? decisions.get(sid) : decisions?.[sid]) || null;
const ZERO_TOKENS = () => ({ in: 0, out: 0, cr: 0, cw: 0 });
const addTokens = (a, t) => { for (const k of ['in', 'out', 'cr', 'cw']) a[k] += t[k]; return a; };
/** A count from a snapshot or a record: a non-negative integer, else 0. */
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
/** A trace record's `{ in, out, cr, cw }` (turn_end.hostUsage, member_done.tokens), each part a finite figure or 0. */
const tokensOf = (t) => ({ in: fin(t?.in) ? t.in : 0, out: fin(t?.out) ? t.out : 0, cr: fin(t?.cr) ? t.cr : 0, cw: fin(t?.cw) ? t.cw : 0 });
/** USD of a usage at a model, 0 when it cannot be priced (a cut turn's estimate, C9). `ratesFor` as priceUsage's (default:
 *  the operator's override, else the list price). */
const priced = (model, usage, ratesFor) => { const p = priceUsage(model, usage, { ratesFor }); return fin(p) ? p : 0; };

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
    // Tests only: cutCostRestored, rotateDispatches, rotateContextTokens, degradeAfter, mainThreadGuard, guardField. On the mock
    // transport the cut-cost fact is the mock CLI's own (Task 50): it is a property of the CLI the host drives (S4).
    const cutCostRestored = port.mock ? mockRestoresCutCost() : HOST_CUT_COST_RESTORED;
    this.limits = { cutCostRestored, rotateDispatches: HOST_ROTATE_DISPATCHES, rotateContextTokens: HOST_ROTATE_CONTEXT_TOKENS,
      degradeAfter: HOST_DEGRADE_AFTER, mainThreadGuard: HOST_MAIN_THREAD_GUARD, guardField: HOST_GUARD_CONTEXT_FIELD, ...limits };
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
    this.epochBookedUsd = 0;                   // Σ harness-sourced bookings of the current epoch (C33)
    this.epochChecks = [];                     // every closed epoch's check (rotate, restart)
    this.openCut = null;
    this.pendingRotate = null;                 // a member-level cap refusal: rotate before the next dispatch (S6)
    this.memberUsdByNode = {};
    this.tokens = ZERO_TOKENS();
    this.activeMs = 0;
    this.lastDispatch = new Map();             // executionId → { dispatchId, nodeId } of its latest dispatch (noteVerdict)
    this.plainSessions = new Set();            // the CLI sessions plain runs started (a degraded member's follow-up resumes its own)
    this.queue = [];
    this.busy = false;
    this.inflight = null;                      // the turn in flight: close() lets it settle first
    this.closed = false;
    this.closing = null;                       // the one close() promise
    this.closedAs = null;                      // the outcome close() was given: its refusal follows it (Task 45)
    this.closeKill = new AbortController();    // a 'paused' close cuts the turn in flight, as a pause cuts an ungrouped step
    this.openedAt = Date.now();
    this.summary = emptySummary({ sid: this.sid, label: this.label, members: this.members });
    this.trace = createSessionTrace({ pipelineDir: port.pipelineDir, sid: this.sid, runId: port.runId ?? null });
  }

  /** A fresh session's first records (C27: a separate session still writes the short trace, so the Sessions tab can say why). */
  _open() {
    const d = this.decision;
    const s = this.settings;
    this._write('open', { engine: this.engine, mode: d.mode, transport: SESSION_TRANSPORT, hostModel: s.hostModel ?? null,
      hostEffort: s.hostEffort ?? null, members: this.members, label: this.label });
    this._writeMode();
  }

  /** The run-start gate's decision as a `mode` record, plus `degrade` when it is separate (C27). */
  _writeMode() {
    const d = this.decision;
    this._write('mode', { mode: d.mode, requested: d.requested ?? null, reason: d.reason ?? null, engine: this.engine, transport: SESSION_TRANSPORT });
    if (d.mode === 'separate') this._write('degrade', { from: d.requested ?? 'subagents', to: 'separate', reason: d.reason ?? null });
  }

  /**
   * Task 47 (spec §5.2; C2, C28, C30, C43): continue this session from the resume point's snapshot `S` and its trace,
   * either of which a crash may have cut short of its last write. The live summary is the trace's own fold (C6). The
   * higher epoch, turn, dispatch, rotation, restart and attempt figures win; the host id and the cumulative figure are
   * those of the CURRENT epoch (the trace's when it reached it: a crash keeps an older snapshot, C43); the held cut, the
   * degrade (C30), the watchdog streak and a pending rotation come from the snapshot. The baseline is seeded so the first
   * resumed turn's Δ and `--max-budget-usd` use the figure the CLI reports (critique M-1). Then `resume {after}` — or, on
   * another engine, the held cut is booked as an estimate (it cannot carry across epochs), `restart {reason:
   * 'engine-switch'}` opens a new epoch, and the new run's gate decision is written as `mode`. A trace that holds no
   * record (lost, or never written) is opened again first; the snapshot alone then restores the host.
   */
  _restore(S) {
    let records = [];
    try { records = readTraceSync(this.trace.path).records; } catch { records = []; }
    const traceLost = !records.length;
    if (traceLost) this._open();
    else this.summary = reduceTrace(records);
    const T = this.summary;
    const sEpoch = count(S.hostEpoch);
    // A crash right after a rotate/restart record (its next epoch's first record lost, the usual torn tail) is in the new
    // epoch already: the old epoch's host id and cumulative must not come back (its cut was booked by the rotate).
    const recEpoch = records.reduce((m, r) => Math.max(m, count(r.hostEpoch)), 0);
    const lastSwitch = records.findLast((r) => r.kind === 'rotate' || r.kind === 'restart');
    const tEpoch = Math.max(count(T.hostEpoch), lastSwitch && count(lastSwitch.hostEpoch) === recEpoch ? recEpoch + 1 : 0);
    const epoch = Math.max(sEpoch, tEpoch, 1);
    const sameEpoch = sEpoch === epoch;
    this.hostEpoch = epoch;
    this.hostSessionId = (T.hostEpoch === epoch ? T.hostSessionId : null) ?? (sameEpoch ? S.hostSessionId ?? null : null);
    this.hostResolvedModel = (sameEpoch ? S.hostResolvedModel : null) ?? null;
    this.turns = Math.max(count(S.turns), T.turns);
    this.dispatches = Math.max(count(S.dispatches), T.dispatches);
    this.rotations = Math.max(count(S.rotations), T.rotations);
    this.restarts = Math.max(count(S.restarts), T.restarts);
    for (const [x, n] of Object.entries(S.attempts && typeof S.attempts === 'object' ? S.attempts : {})) if (count(n)) this.attempts.set(x, n);
    const inEpoch = records.filter((r) => r.hostEpoch === epoch);
    const costed = new Set();                                                // C9: a turn with a cost record is no longer a cut
    for (const r of records) {
      if (r.kind === 'dispatch' && typeof r.executionId === 'string' && count(r.attempt)) this.attempts.set(r.executionId, Math.max(this.attempts.get(r.executionId) || 0, r.attempt));
      else if (r.kind === 'cost') { this._addMemberUsd(r.nodeId, r.memberUsd); if (typeof r.turnId === 'string') costed.add(r.turnId); }
      else if (r.kind === 'turn_end') { if (fin(r.durationMs)) this.activeMs += r.durationMs; addTokens(this.tokens, tokensOf(r.hostUsage)); }
      else if (r.kind === 'member_done') addTokens(this.tokens, tokensOf(r.tokens));
      else if ((r.kind === 'rotate' || r.kind === 'restart') && r.epochCheck && typeof r.epochCheck === 'object') this.epochChecks.push(r.epochCheck);
    }
    this.epochDispatches = Math.max(inEpoch.filter((r) => r.kind === 'dispatch').length, sameEpoch ? count(S.epochDispatches) : 0);
    const lastEnd = inEpoch.filter((r) => r.kind === 'turn_end' && fin(r.cumulativeUsd)).at(-1);
    this.lastCumulativeUsd = lastEnd ? lastEnd.cumulativeUsd : (sameEpoch && fin(S.lastCumulativeUsd) ? S.lastCumulativeUsd : 0);
    this.lastContextTokens = sameEpoch && fin(S.lastContextTokens) ? S.lastContextTokens : 0;
    // This run checks what it books from here: its epoch bookings start at 0, so the epoch opens at the restored figure.
    this.epochOpeningUsd = this.lastCumulativeUsd;
    // The snapshot is taken when an execution completes, so after a crash its held cut can be older than the trace: a part
    // the trace already carried or booked (a cost record for its turn) is not held again (C9).
    const held = S.openCut && typeof S.openCut === 'object' ? (Array.isArray(S.openCut.parts) ? S.openCut.parts : [S.openCut]) : [];
    const open = held.filter((p) => p && typeof p === 'object' && !costed.has(p.turnId));
    if (open.length === held.length) this.openCut = held.length ? structuredClone(S.openCut) : null;
    else for (const p of open) this._holdCut(structuredClone(p));
    this.pendingRotate = T.rotations > count(S.rotations) ? null : S.pendingRotate ?? null;   // a rotate the trace holds used it
    this.consecutiveWatchdog = count(S.consecutiveWatchdog);
    const opened = Date.parse(T.startedAt ?? '');
    if (fin(opened)) this.openedAt = opened;
    // C30: a runtime degrade (a degrade after a dispatch, since the last gate decision) holds even where the snapshot
    // predates it (a crash during the plain retry that follows it).
    const tail = records.slice(records.findLastIndex((r) => r.kind === 'mode') + 1);
    const ranAt = tail.findIndex((r) => r.kind === 'dispatch');
    const traceDegrade = ranAt >= 0 ? tail.slice(ranAt).findLast((r) => r.kind === 'degrade') ?? null : null;
    const degraded = (S.mode === 'separate' || !!traceDegrade) && this.mode !== 'separate';
    if (degraded) {                                                          // C30: a degraded session stays degraded
      this.mode = 'separate';
      this.degradeReason = (S.mode === 'separate' ? S.degradeReason : traceDegrade?.reason) ?? null;
    }
    if (S.engine != null && this.engine != null && S.engine !== this.engine) {
      this.mode = this.decision.mode;                                        // the new run's gate chose it
      this.degradeReason = this.decision.mode === 'separate' ? (this.decision.reason ?? null) : null;
      this.consecutiveWatchdog = 0;
      this.pendingRotate = null;
      this._bookOpenCut(S.engine);                                           // spent on the old engine: priced as its estimate
      this._restart('engine-switch');
      if (!traceLost) this._writeMode();                                     // a reopened trace's open already wrote it
      return;
    }
    this._write('resume', { after: S.status === 'paused' ? 'pause' : 'crash' });
    if (degraded && traceLost) this._write('degrade', { from: this.decision.mode, to: 'separate', reason: this.degradeReason });   // the lost trace said it
    if (this.decision.mode === 'separate' && S.mode !== 'separate') {        // the gate says separate now (flag, CLI, …)
      this.mode = 'separate';
      this.degradeReason = this.decision.reason ?? null;
      if (!traceLost) this._writeMode();                                     // a reopened trace's open already wrote it
    }
    if (this.hostSessionId && fin(this.lastCumulativeUsd)) {
      // The rows are written before a turn's turn_end lands (an async append): the harness seeds from a row whose own booked
      // turn is newer than the trace's last turn_end, and answers the figure it seeded (run 5's crash seam).
      const afterTurn = lastEnd ? Number(/:(\d+)$/.exec(String(lastEnd.turnId))?.[1] ?? 0) : 0;
      let seeded;
      try { seeded = this.port.seedBaseline?.(this.hostSessionId, this.lastCumulativeUsd, { sid: this.sid, afterTurn }); } catch { /* the baseline falls back to the rows */ }
      if (fin(seeded)) { this.lastCumulativeUsd = seeded; this.epochOpeningUsd = seeded; }
    }
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

  _log(level, text, attr) {
    try { this.port.log?.(level, text, attr); } catch { /* a log line never breaks a turn */ }
  }

  _stamp(executionId, ref) {
    try { this.port.stampRow?.(executionId, ref); } catch { /* the row ref is best-effort, like _persist */ }
  }

  /** Task 47 (C28, the crash seam): this session's snapshot for the run's resume point, handed over with every booking. The
   *  harness persists the rows a booking changes at once and the trace appends later, so a snapshot taken only when an
   *  execution completes would, after a crash, still hold a cut the rows already carried or booked. */
  _saveSnapshot() {
    try { this.port.saveSnapshot?.(this.sid, this.snapshot()); } catch { /* best-effort, like _persist */ }
  }

  /** The harness books; a booking that throws is logged and the turn goes on (its records say what is known). */
  _book(b) {
    try { return this.port.bookTurn(b) || null; } catch (err) {
      this._log('warn', `session ${this.sid}: booking ${b.turnId} failed: ${err?.message || err}`, { session: this.sid });
      return null;
    }
  }

  /** The executor's `run` for a member (C25: FIFO, one turn at a time). Rejects at once with an AbortError when the
   *  signal already fired or the host is closed: nothing is queued and nothing is written. */
  run(opts, member) {
    const o = opts || {};
    const m = member || {};
    if (o.signal?.aborted) return Promise.reject(abortError());
    if (this.closed) return Promise.reject(this._refusal());
    if (this.mode === 'separate') return this._plain(o, m);                  // C30: degraded, as ungrouped
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
    if (this.mode === 'separate') { this._drainPlain(); return; }            // degraded: the waiters run plain, side by side
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

  /** The waiters a degrade left in the queue: each runs plain at once, as ungrouped steps run side by side (C30), not one
   *  at a time behind the host. Each still passes the abort, close and cost-gate checks `_dispatch` makes. */
  _drainPlain() {
    for (const entry of this.queue.splice(0)) {
      if (entry.onAbort) entry.opts.signal.removeEventListener('abort', entry.onAbort);
      if (entry.waited) this._queued(entry.member.executionId, false);
      Promise.resolve()
        .then(() => {
          if (entry.opts.signal?.aborted) throw abortError();
          if (this.closed) throw this._refusal();
          if (entry.waited) this.port.checkCostLimits?.();
          return this._plain(entry.opts, entry.member);
        })
        .then(entry.resolve, entry.reject);
    }
  }

  /** C42 / C30: a degraded member's own plain CLI session from before a resume (orchestrator `_reattachFor`): its plain run
   *  may resume it, as an ungrouped step resumes its own. */
  keepPlainSession(id) {
    if (typeof id === 'string' && id) this.plainSessions.add(id);
  }

  /** C30 / C29: does a degraded session's plain run of these opts `--resume` `id` (the member's own plain session)? */
  resumesPlain(id) {
    return typeof id === 'string' && this.plainSessions.has(id);
  }

  /** C30: a degraded session's dispatch is a plain spawn (no record, no turn), never `--resume <host>`: only a CLI session a
   *  plain run started itself is resumed (a follow-up round of a degraded member, as ungrouped). Its host dispatch is
   *  history: a verdict on this plain run (Task 46 calls noteVerdict after it) must not land on that failed turn. */
  _plain(opts, member) {
    this.lastDispatch.delete(String(member.executionId));
    const own = this.resumesPlain(opts.resumeSessionId);
    const onEvent = (e) => {
      if (e?.type === 'session' && typeof e.sessionId === 'string' && e.sessionId) this.plainSessions.add(e.sessionId);
      return opts.onEvent?.(e);
    };
    return this.plainRun({ ...opts, resumeSessionId: own ? opts.resumeSessionId : undefined, onEvent });
  }

  async _dispatch(opts, member, { queueMs, waited = false }) {
    if (opts.signal?.aborted) throw abortError();                            // aborted after it left the queue: no attempt, no record
    if (this.closed) throw this._refusal();                                  // closed after it left the queue: it never starts
    if (waited) this.port.checkCostLimits?.();                               // C37: the executor gated it before it queued; spend moved since
    if (this.mode === 'separate') return this._plain(opts, member);          // it degraded while this one waited
    // C25: before a dispatch, never mid-turn. One conversation never rotates: its context is what it is for (Claude Code
    // compacts it itself), and a fresh one would drop the earlier steps' work without a word.
    if (this.mode !== 'shared') this._rotateIfDue();
    try {
      return await this._turn(opts, member, { queueMs });
    } catch (err) {
      const retry = err instanceof SessionHostError ? { SESSION_HOST_CAP: 'cap', SESSION_HOST_VANISHED: 'vanished' }[err.code] : null;
      if (!retry) throw err;
      if (opts.signal?.aborted) throw abortError();                          // no retry once the member's signal fired (41-4)
      if (this.closed) throw this._refusal();                                // nor on a closed host
      this.port.checkCostLimits?.();                                           // C37: the cost gate runs before every spawn, a retry's too
      // One retry on a fresh host with a FRESH attempt (C31: a new agentType and dispatchId, so every turn's rows stay apart).
      if (retry === 'cap') this._rotate('cap');                                // S6
      else this._restart('vanished');                                          // C20
      return this._turn(opts, member, { retry });
    }
  }

  _rotateIfDue() {
    const reason = this.pendingRotate ? 'cap'
      : this.epochDispatches >= this.limits.rotateDispatches ? 'dispatches'
        : this.lastContextTokens >= this.limits.rotateContextTokens ? 'context' : null;
    if (reason) this._rotate(reason);
  }

  /** A new host session (epoch + 1). The old epoch is reconciled first; a cut on it can never be carried, so it is booked
   *  as an estimate (C9). */
  _closeEpoch() {
    this._bookOpenCut();
    const epochCheck = this._epochCheck();
    this.epochChecks.push(epochCheck);
    return epochCheck;
  }

  _newEpoch() {
    this.hostEpoch += 1;
    this.hostSessionId = null;
    this.epochDispatches = 0;
    this.lastContextTokens = 0;
    this.lastCumulativeUsd = 0;
    this.epochOpeningUsd = 0;
    this.epochBookedUsd = 0;
  }

  _rotate(reason) {
    const epochCheck = this._closeEpoch();
    this._write('rotate', { reason, fromSessionId: this.hostSessionId, fromEpoch: this.hostEpoch, dispatches: this.epochDispatches,
      contextTokens: this.lastContextTokens, epochCheck });
    this._newEpoch();
    this.rotations += 1;
    this.pendingRotate = null;
  }

  _restart(reason) {
    const epochCheck = this._closeEpoch();
    this._write('restart', { reason, fromSessionId: this.hostSessionId, engine: this.engine, transport: SESSION_TRANSPORT, epochCheck });
    this._newEpoch();
    this.restarts += 1;
  }

  _degrade(reason) {
    const from = this.mode;
    // The mode flips first: the snapshot each estimate booking hands over then already says separate, so a crash that loses
    // the degrade record never restores the session on the host whose cumulative holds the cut (Task 47's crash seam).
    this.mode = 'separate';
    this.degradeReason = reason;
    this._bookOpenCut();                                                       // no host turn follows to carry it (C9)
    this._write('degrade', { from, to: 'separate', reason });              // its audit line comes from the port (sessionAuditLine)
  }

  /** The attempt number is taken when the dispatch STARTS, so a cancelled waiter consumes none (C2). */
  _nextAttempt(executionId) {
    const n = (this.attempts.get(executionId) || 0) + 1;
    this.attempts.set(executionId, n);
    return n;
  }

  /** `--max-budget-usd` for the next turn: the remaining pipeline budget (own cap and team soft cap), plus the host's last
   *  cumulative figure when the flag counts the whole session; null ⇒ omitted (C10). `models` are the turn's known models:
   *  the harness withholds the budget when one of them is booked at other prices than the CLI's list-price meter (Task 42). */
  _maxBudgetUsd(models) {
    let remaining = null;
    try { remaining = this.port.remainingBudgetUsd?.({ models }) ?? null; } catch { remaining = null; }
    if (!fin(remaining)) return null;
    // A held cut is in the CLI's cumulative at its LIST price, and the books will take it at its own (cutUsd): the flag
    // gives the difference back, so a cut under a cost override never stops the next turn early (correction 21's class).
    const cutGap = (this.openCut?.parts || []).reduce((a, p) => a + (fin(p?.cutListUsd) && fin(p?.cutUsd) ? p.cutListUsd - p.cutUsd : 0), 0);
    return Math.max(BUDGET_FLOOR_USD, remaining + (HOST_BUDGET_IS_CUMULATIVE ? this.lastCumulativeUsd + cutGap : 0));
  }

  /** C40: the host-only guard, in `union` mode only (agent-only hosts hold no other tool), and only with a proven context
   *  field: without one it would allow every call while the run-start line says the main agent's tools are refused. */
  _mainThreadGuard() {
    const field = this.limits.guardField;
    return this.limits.mainThreadGuard && field && HOST_TOOLS_MODE === 'union' ? sessionHostGuardSettings({ field }) : null;
  }

  /** One host turn: turn_start and dispatch, the transport through the demux, the outcome's records and booking. */
  async _turn(opts, member, { queueMs = 0, retry = null } = {}) {
    if (this.mode === 'shared') return this._sharedTurn(opts, member, { queueMs });
    const executionId = String(member.executionId);
    const nodeId = member.nodeId ?? null;
    const label = member.label || nodeId || executionId;
    const attr = { nodeId, executionId, session: this.sid };
    const attempt = this._nextAttempt(executionId);
    const turnId = turnIdFor(this.sid, ++this.turns);
    const dispatchId = dispatchIdFor(executionId, attempt);
    const flags = hostFlagsFor({ settings: this.settings, firstMemberModel: this.decision.firstMemberModel ?? null, member });   // C26
    const resume = this.hostSessionId;
    this.dispatches += 1;
    this.epochDispatches += 1;
    this.lastDispatch.set(executionId, { dispatchId, nodeId });
    const { agentType, definitions } = memberDefinition(opts, { executionId, attempt, label });
    const definition = definitions[agentType];
    try { _testing.onDefinitions?.(definitions, opts, member); } catch { /* a test seam never breaks a turn */ }
    // A member with no model of its own and no host model runs on the CLI's default model, which nothing here can price:
    // no flag then (as for an ungrouped step; C37's gate still runs before every spawn).
    const maxBudgetUsd = definition.model || flags.model ? this._maxBudgetUsd([flags.model, this.hostResolvedModel, definition.model].filter(Boolean)) : null;
    this._write('turn_start', { turnId, resume: !!resume, maxTurns: HOST_MAX_TURNS, maxBudgetUsd, hostModel: flags.model ?? null,
      hostEffort: flags.effort ?? null });
    this._write('dispatch', { turnId, dispatchId, executionId, nodeId, attempt, agentType,
      cold: attempt > 1 || !!opts.resumeSessionId || !!opts.coldRedispatch, queueMs });

    const started = Date.now();
    const turnAbort = new AbortController();
    const signal = AbortSignal.any([...(opts.signal ? [opts.signal] : []), turnAbort.signal, this.closeKill.signal]);
    const emit = (e) => emitTo(opts.onEvent, e);
    const memberUsage = new Map();              // the member's own usage per message id: a cut turn's price before its tool_result
    let memberMsgModel = null;                  // the model the member's own messages name (one that pins none, C26)
    let boundId = null;
    const demux = createTurnDemux({
      agentType,
      onMember: (e) => {
        if (e?.type === 'usage' && e.phase === 'message' && (e.parentId ?? null) === null && e.usage) {
          memberUsage.set(e.messageId ?? `n${memberUsage.size}`, e.usage);
          if (typeof e.model === 'string' && e.model) memberMsgModel = e.model;
        }
        emit(e);                                // the member's row; runOpts stamps the role
      },
      onInit: ({ hostSessionId, model }) => {   // C43: adopt the id the moment it arrives; C35: the main agent's real model
        if (hostSessionId) this.hostSessionId = hostSessionId;
        if (model) this.hostResolvedModel = model;
      },
      onBind: (id) => {
        boundId = id;
        this._write('member_bound', { turnId, dispatchId, memberAgentId: id });
        // A partial ref: a row paused mid-turn already says it ran inside the session (C42); the full one follows the booking.
        this._stamp(executionId, { sid: this.sid, hostEpoch: this.hostEpoch, hostSessionId: this.hostSessionId, turnId, dispatchId, attempt, memberAgentId: id });
        emit({ type: 'subagent', event: 'spawn', toolUseId: id, subagentType: agentType, label, memberOf: this.sid });   // C8
        emit({ type: 'session', init: true, model: definition.model ?? null, sessionId: this.hostSessionId });
      },
      onMemberDone: (x) => {
        this._write('member_done', { turnId, dispatchId, memberAgentId: boundId, memberTranscriptId: x.agentId, tokens: x.usage ? usageTokens(x.usage) : null,
          resolvedModel: x.resolvedModel, durationMs: x.durationMs, isError: x.isError, ...(x.isError ? { errorClass: classifyError(x.errorText || '') } : {}) });
        // Verify minor 7: no tokens, usage or duration — the member's sub_agents row never carries a price (C8).
        emit({ type: 'subagent', event: x.isError ? 'error' : 'finish', toolUseId: boundId, ...(x.resolvedModel ? { resolvedModel: x.resolvedModel } : {}) });
        const requested = definition.model ?? null;
        if (requested && x.resolvedModel && upstreamKey(x.resolvedModel) !== upstreamKey(requested)) {   // S2, C26 (a dated id of it is no mismatch)
          this._write('watchdog', { turnId, dispatchId, code: 'model-mismatch', level: 'warn', detail: { requested, resolved: x.resolvedModel } });
          this._log('warn', `${label} asked for ${requested} but ran on ${x.resolvedModel}`, attr);
          emit({ type: 'session', init: true, model: x.resolvedModel });
        } else if (!requested && x.resolvedModel) {
          emit({ type: 'session', init: true, model: x.resolvedModel });   // no model of its own: the real one stamps the row, as an ungrouped init does
        }
      },
      onHostText: (t) => this._log('info', t, attr),
      onViolation: () => turnAbort.abort(),     // C11: at once, before AND after the member's result
      onWarn: (w) => this._onWarn(w, { turnId, dispatchId, label, attr }),
    });

    let hostOpts = hostSpawnOpts(opts, { hostSessionId: resume, hostModel: flags.model, hostEffort: flags.effort, definitions, maxBudgetUsd,
      hostToolsMode: HOST_TOOLS_MODE, mainThreadGuard: this._mainThreadGuard(), dispatchText: dispatchMessage({ agentType, label }) });
    // A model entry's env is merged over the run env (composeSpawnEnv): it must not switch background tasks back on.
    if (hostOpts.modelEnv && Object.hasOwn(hostOpts.modelEnv, 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS')) {
      hostOpts = { ...hostOpts, modelEnv: { ...hostOpts.modelEnv, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' } };
    }
    let err = null;
    try { await this.transport({ ...hostOpts, signal, onEvent: (e) => demux.feed(e) }); } catch (e) { err = e; }
    const facts = demux.facts();
    const durationMs = Date.now() - started;
    const r = facts.result;
    const done = facts.done;
    const killed = turnAbort.signal.aborted;

    // The outcome; the first matching rule wins (C10, C11, C12, C20, C41).
    let outcome;
    let verdict = null;
    const cutByClose = this.closeKill.signal.aborted && !opts.signal?.aborted;                     // a 'paused' close cut it (Task 45)
    if (opts.signal?.aborted || cutByClose) outcome = 'abort';                                     // Stop / pause: the turn is cut
    else if (done && !done.isError) outcome = 'accept';                                             // C12: the step finished
    else if (r?.subtype === HOST_BUDGET_SUBTYPE) outcome = 'budget';                                 // C10: exit 1 after its result
    else if (r?.subtype === 'error_max_turns') {                                                    // the host looped instead of dispatching
      outcome = 'watchdog';
      verdict = { code: 'SESSION_HOST_NO_DISPATCH', detail: { maxTurns: HOST_MAX_TURNS } };
    } else if (facts.violation) outcome = 'watchdog';                                               // C11: before the member's result
    else if (done?.isError && (!err || killed)) outcome = facts.capRefused ? 'cap' : 'member-error';   // S6; C41 (after-done violations stay warnings)
    else if (err && resume && !facts.sawInit && VANISHED_RE.test([err.message, err.stream, ...facts.said].join('\n'))) outcome = 'vanished';   // C20: before init
    else if (err) outcome = 'adapter';
    else outcome = watchdogVerdict(facts) ? 'watchdog' : 'accept';
    const flagged = facts.afterDone.length > 0 || (outcome === 'accept' && !!facts.violation);
    const exit = {
      abort: 'aborted',
      accept: flagged ? 'violation' : err ? 'error' : 'ok',
      budget: 'budget',
      watchdog: r?.subtype === 'error_max_turns' ? 'max_turns' : killed ? 'violation' : 'ok',
      cap: err ? 'error' : 'ok',
      'member-error': err ? 'error' : 'ok',
      vanished: 'error',
      adapter: 'error',
    }[outcome];

    // Warnings the turn earned: a violation that raced a clean result, every violation after the member's result (C11, C41).
    if (outcome === 'accept' || outcome === 'member-error') {
      for (const v of [outcome === 'accept' ? facts.violation : null, ...facts.afterDone].filter(Boolean)) {
        this._write('watchdog', { turnId, dispatchId, code: v.code, level: 'warn', detail: v.detail || {} });
        this._log('warn', `${label}: ${v.code} after the step's own result`, attr);   // C11: a warn line, as for every warn record
      }
    }
    if (outcome === 'watchdog') {
      verdict ??= facts.violation || watchdogVerdict(facts);
      this._write('watchdog', { turnId, dispatchId, code: verdict.code, level: 'error', detail: verdict.detail || {} });
    }
    if (outcome === 'cap') {                            // the refused child; a refusal on any retry fails the dispatch (S6)
      this._write('watchdog', { turnId, dispatchId, code: 'SESSION_HOST_CAP', level: retry ? 'error' : 'warn', detail: { capRefused: true } });
    }

    // Booking (C9, critique minor 2): the port first, then turn_end, the carried cost, the cost and the reconcile.
    const hostModel = this.hostResolvedModel || flags.model || null;
    // A member that pins no model runs on what its own messages name, else on the main agent's (C26: it inherits it).
    const memberModel = done?.resolvedModel || definition.model || memberMsgModel || hostModel;
    const hostUsage = r?.usage ?? facts.hostUsage;     // the result's host usage keeps its real output and 1-hour cache writes
    const fromEvents = ZERO_TOKENS();
    for (const u of memberUsage.values()) addTokens(fromEvents, usageTokens(u));
    // The member's own total when its tool_result arrived, else what its messages reported so far (null: it never spoke).
    const memberSpent = done?.usage ?? (memberUsage.size ? fromEvents : null);
    let booking = null;
    let cutNow = null;                                  // a cut that can never be carried: booked right after its turn_end
    // A result with no cumulative on an engine that reports cost is held like a cut: the next result of the epoch holds its
    // spend, so booking an estimate now would book it twice (C9; C24's estimate then only books what nothing carries).
    const unpricedResult = !!r && !fin(r.cumulativeUsd) && engineReportsCost(this.engine);
    if (r && !unpricedResult) {                         // every turn that produced a result, failed ones too (the child may have spent)
      booking = this._book({ sid: this.sid, hostEpoch: this.hostEpoch, hostSessionId: this.hostSessionId, turnId, dispatchId, stepKey: executionId, nodeId,
        cumulativeUsd: r.cumulativeUsd ?? NaN, hostUsage, hostModel, memberUsage: memberSpent, memberModel,
        investigators: facts.investigators, hookUsd: facts.hookUsd, carried: this.openCut });
    } else if (r || facts.sawInit) {                    // a CUT turn: no result (pause, stop, a kill, a host death), or no cost on it
      // Its price: the member's own usage plus its finished investigators' (C33), plus the main agent's; unpriceable parts 0.
      // Twice: at the operator's rates (what an estimate books) and at the CLI's list rates, which is how the next Δ holds
      // it: the carried split is taken at those, then the cut keeps its own rates (Task 42; correction 5's rule).
      const memberCut = memberSpent ?? fromEvents;
      const cutPrice = (ratesFor) => {
        const m = estimateMemberUsd({ memberUsage: memberCut, memberModel, investigators: facts.investigators, ratesFor });
        return (fin(m) ? m : 0) + priced(hostModel, hostUsage, ratesFor);
      };
      const cutTokens = addTokens(usageTokens(memberCut), usageTokens(hostUsage));
      for (const i of facts.investigators) addTokens(cutTokens, usageTokens(i.usage));
      const cut = { turnId, dispatchId, executionId, nodeId, cutUsd: cutPrice(), cutListUsd: cutPrice(listCostRates), cutTokens };
      if (this.limits.cutCostRestored || r) this._holdCut(cut);                 // a finished turn's spend is in the next cumulative
      else cutNow = cut;
    }
    if (fin(r?.cumulativeUsd)) this.lastCumulativeUsd = r.cumulativeUsd;
    if (facts.lastHostUsage) this.lastContextTokens = facts.lastHostUsage.in + facts.lastHostUsage.cr + facts.lastHostUsage.cw;   // critique minor 4
    this.activeMs += durationMs;
    addTokens(this.tokens, usageTokens(hostUsage));
    if (memberSpent) addTokens(this.tokens, usageTokens(memberSpent));
    for (const i of facts.investigators) addTokens(this.tokens, usageTokens(i.usage));   // the member's investigators too (spec §6.3)
    this._write('turn_end', { turnId, cumulativeUsd: r?.cumulativeUsd ?? null, deltaUsd: booking?.deltaUsd ?? null, hostUsage: usageTokens(hostUsage),
      hostModel: this.hostResolvedModel, numTurns: r?.numTurns ?? null, durationMs: r?.durationMs ?? durationMs, exit, subtype: r?.subtype ?? null });
    if (cutNow) this._bookCut(cutNow);
    if (booking) this._writeBooking(booking, { turnId, dispatchId, executionId, nodeId });
    // C30: the watchdog streak counts this turn before the snapshot is taken, so a crash after it degrades on time.
    if (outcome === 'watchdog') this.consecutiveWatchdog += 1;
    else if (outcome === 'accept' || outcome === 'member-error') this.consecutiveWatchdog = 0;
    // C7: the full ref replaces the bind-time one. The snapshot goes first, so the persist after this turn's booking writes it
    // with the rows (Task 47: the trace's appends lag both; a crash then never holds again a cut the rows already carried).
    this._saveSnapshot();
    this._stamp(executionId, { sid: this.sid, hostEpoch: this.hostEpoch, hostSessionId: this.hostSessionId, turnId, dispatchId, attempt,
      memberAgentId: boundId, memberTranscriptId: done?.agentId ?? null, costSource: booking?.costSource ?? null });

    switch (outcome) {
      // A turn a 'paused' close cut answers with the close's refusal (the pause sentinel), as its waiters do.
      case 'abort': throw cutByClose ? this._refusal() : err?.name === 'AbortError' ? err : abortError();
      case 'accept':
        if (err) this._log('warn', 'the main agent failed after the step finished; the step is kept', attr);
        emit({ type: 'result', text: done.report, sessionBooked: true });     // the harness logs it and books nothing (Task 42)
        return { text: done.report, exitCode: 0 };
      case 'member-error':
        // C41: a 529 retries as rate_limit, a usage limit pauses as usage_limit with its reset time, exactly as ungrouped.
        throw Object.assign(new Error(done.errorText || 'the step failed'), { errorClass: classifyError(done.errorText || '') });
      case 'watchdog': {
        const e = new SessionHostError(verdict.code, WATCHDOG_TEXT[verdict.code] || 'the main agent did not dispatch as told', verdict.detail || {});
        // C30: a main agent that keeps misbehaving degrades its session; this dispatch still fails, its retry runs plain.
        if (this.consecutiveWatchdog >= this.limits.degradeAfter && this.mode !== 'separate') this._degrade('the main agent did not dispatch');
        throw e;
      }
      case 'budget':
        this.port.checkCostLimits?.();                  // a reached cap throws the pause sentinel: COST_PIPELINE, as ungrouped (C10)
        throw new SessionHostError('SESSION_HOST_BUDGET', 'the host turn reached its budget', { maxBudgetUsd });
      case 'cap':
        throw new SessionHostError('SESSION_HOST_CAP', 'the session reached its sub-agent cap', { capRefused: true });
      case 'vanished':
        throw new SessionHostError('SESSION_HOST_VANISHED', 'the host session was not found', { hostSessionId: resume });
      case 'adapter':
      default:
        // C20: the adapter's error unchanged (message, errorClass, stream), so a --plugin-dir refusal reaches the executor's
        // sideload retry and an auth failure classifies as auth. Only a missing class takes the member's error class (C41).
        if (err && err.errorClass == null && done?.isError) err.errorClass = classifyError(done.errorText || '');
        throw err;
    }
  }

  /** A booked turn's records (C9, critique minor 2): each carried cut back on its own row, then the turn's `cost` and its
   *  `reconcile`. */
  _writeBooking(booking, { turnId, dispatchId, executionId, nodeId }) {
    if (booking.carried && this.openCut) {              // C9: each cut turn's spend inside this Δ goes back to its own row
      const c = this.openCut;
      this.openCut = null;
      // The port's shares follow the cuts' order; a port that answers one figure gives it all to the first cut.
      const shares = Array.isArray(booking.carried.parts) ? booking.carried.parts : [{ usd: booking.carried.usd }];
      (c.parts || [c]).forEach((p, i) => {
        const usd = shares[i]?.usd ?? null;
        // A carry is taken out of the CLI's Δ (a harness figure), whatever this turn's own source; an override on the cut
        // member is that record's, not this turn's (C9).
        this._write('cost', { turnId: p.turnId, dispatchId: p.dispatchId, executionId: p.executionId, nodeId: p.nodeId, memberUsd: usd,
          hostOverheadUsd: null, costSource: 'harness', overridden: shares[i]?.overridden === true, carriedBy: turnId });
        this._addMemberUsd(p.nodeId, usd);
      });
    }
    this._write('cost', { turnId, dispatchId, executionId, nodeId, memberUsd: booking.memberUsd, hostOverheadUsd: booking.hostOverheadUsd,
      costSource: booking.costSource, hostPriced: booking.hostPriced, overridden: booking.overridden });
    this._addMemberUsd(nodeId, booking.memberUsd);
    this.epochBookedUsd += this._harnessPart(booking);
    const rc = booking.reconcile || { ok: true, checks: [] };
    this._write('reconcile', { turnId, dispatchId, ok: rc.ok !== false, checks: Array.isArray(rc.checks) ? rc.checks : [] });
  }

  /**
   * `shared` mode (Task 65; spec §5, 04 §5): the member runs ITSELF as the next turn of the session's one conversation, on
   * the run's engine, with its own runOpts (`sharedTurnOpts`: the role in the user turn). No Agent call, no watchdog, no
   * `member_bound`: its frames go to its own row as they come. The conversation's id is adopted the moment it is named
   * (and again whenever the engine names another), and the row and the snapshot say it before the turn can be cut (C43).
   * The `result` is held back and booked first, all of it the step's (`shared: true`: no main agent, so no hand-off), then
   * handed on as booked. Its figure is the conversation's running total on Claude Code and Goose (Δ from the run-level
   * baseline) and the turn's own elsewhere (`turnUsd`); the result's own usage prices a cost override, as it does an
   * ungrouped step's. A turn with no result, or no figure on an engine that reports cost, is priced from its usage and its
   * investigators': held for the next running total where one follows, else booked now as an estimate (C9, C24); with
   * nothing priceable it books nothing (a blank row, never $0.00). A turn a bridged member's upstream priced books that
   * figure, never a cut beside it (C34). Failures are the runner's, unchanged (C20, C41), except a `--resume` that found no
   * conversation before it answered, in the engine's own words, which restarts it once (C20). A result of a turn that
   * never ran (no model turn, $0: Claude Code's answer to a lost conversation, or to a refusal before it starts) is no
   * answer, and nothing of it is booked or handed on.
   */
  async _sharedTurn(opts, member, { queueMs = 0 } = {}) {
    const executionId = String(member.executionId);
    const nodeId = member.nodeId ?? null;
    const attempt = this._nextAttempt(executionId);
    const turnId = turnIdFor(this.sid, ++this.turns);
    const dispatchId = dispatchIdFor(executionId, attempt);
    const resume = this.hostSessionId;
    this.dispatches += 1;
    this.epochDispatches += 1;
    this.lastDispatch.set(executionId, { dispatchId, nodeId });
    this._write('turn_start', { turnId, resume: !!resume, maxTurns: null, maxBudgetUsd: null, hostModel: null, hostEffort: null });
    this._write('dispatch', { turnId, dispatchId, executionId, nodeId, attempt, agentType: null,
      cold: attempt > 1 || !!opts.resumeSessionId || !!opts.coldRedispatch, queueMs });

    const started = Date.now();
    const signal = AbortSignal.any([...(opts.signal ? [opts.signal] : []), this.closeKill.signal]);
    const ref = () => ({ sid: this.sid, hostEpoch: this.hostEpoch, hostSessionId: this.hostSessionId, turnId, dispatchId, attempt });
    const usage = new Map();                    // the turn's own usage per message id: a cut turn's price
    const inv = new Map();                      // its investigators' usage per message id: part of that price (C33)
    let msgModel = null;                        // the model its messages name (a member that pins none)
    let got = null;                             // the result: booked before it is handed on
    let named = false;                          // the row says where the turn runs
    let answered = false;                       // the conversation answered: its init, the model's output, a turn's result
    const said = [];                            // the runner's plain and stderr lines, where a lost conversation says so (C20)
    const onEvent = (e) => {
      if (!e || typeof e !== 'object') return;
      if (['usage', 'text', 'tool'].includes(e.type) || (e.type === 'session' && e.init === true) || (e.type === 'result' && !noTurnResult(e))) answered = true;
      if (e.type === 'result') { got = e; return; }
      if (e.type === 'session' && typeof e.sessionId === 'string' && e.sessionId) {
        // Adopted when named, and again when the engine names another: an adapter that starts a fresh session itself
        // when a resume finds none (Gemini, Qwen, OpenCode, Goose, Cursor) goes on in the new one.
        if (!named || e.sessionId !== this.hostSessionId) {
          const fresh = e.sessionId !== this.hostSessionId;
          named = true;
          this.hostSessionId = e.sessionId;
          if (fresh) this._saveSnapshot();
          this._stamp(executionId, { ...ref(), memberAgentId: null });   // a row cut mid-turn already says where it ran (C42)
        }
      } else if (e.type === 'usage' && e.phase === 'message' && e.usage && e.total !== true) {   // `total`: a session's sum
        if ((e.parentId ?? null) !== null) inv.set(e.messageId ?? `n${inv.size}`, { resolvedModel: e.model ?? null, usage: e.usage });
        else {
          usage.set(e.messageId ?? `n${usage.size}`, e.usage);
          if (typeof e.model === 'string' && e.model) msgModel = e.model;
        }
      } else if ((e.type === 'log' || e.type === 'stderr') && typeof e.text === 'string' && said.length < 20) said.push(e.text.slice(0, 500));
      emitTo(opts.onEvent, e);
    };
    const turnOpts = sharedTurnOpts(opts, { hostSessionId: resume });
    try { _testing.onSharedTurn?.(turnOpts, opts, member); } catch { /* a test seam never breaks a turn */ }
    let err = null;
    let out = null;
    try { out = await this.transport({ ...turnOpts, signal, onEvent }); } catch (e) { err = e; }
    const durationMs = Date.now() - started;
    const cutByClose = this.closeKill.signal.aborted && !opts.signal?.aborted;   // a 'paused' close cut it (Task 45)
    const aborted = !!opts.signal?.aborted || cutByClose;
    const lostText = err ? [err.message, err.stream, ...said, ...(Array.isArray(got?.errors) ? got.errors : [])].join('\n') : '';
    const vanished = !aborted && !!err && !!resume && !answered && LOST_CONVERSATION_RES.some((re) => re.test(lostText));
    // A result of a turn that never ran is not this turn's (a lost conversation's, a refusal before the CLI starts, which
    // the sideload retry runs again): it spent nothing, and its $0 is no running total. Booked, it would reset the
    // conversation's baseline (the next result's Δ would then book every earlier turn again) and give a held cut a $0 share.
    const r = got && !noTurnResult(got) ? got : null;

    const usd = fin(r?.costUsd) ? r.costUsd : null;
    const cumulative = this._cumulativeEngine();
    const memberModel = opts.model || msgModel || null;
    const fromEvents = ZERO_TOKENS();
    for (const u of usage.values()) addTokens(fromEvents, usageTokens(u));
    // The turn's own usage: the result's (a session's sum is none of it), else its messages'.
    const own = r?.usage && !SESSION_SUM_USAGE_ENGINES.has(this.engine) ? r.usage : null;
    const spent = own ?? (usage.size ? fromEvents : null);
    // A cut turn, or a result without its figure on an engine that reports cost, is priced from the usage the turn reported
    // and its investigators' (C9, C24, C33). Nothing priceable is no estimate: the turn books nothing, never $0.00.
    const price = (ratesFor) => estimateMemberUsd({ memberUsage: spent, memberModel, investigators: [...inv.values()], ratesFor });
    // A bridged member whose upstream reported what this turn cost (C34): that figure is booked now, as the booking's bridge
    // part. A cut held or booked beside it would book the turn twice (the open-turn flush books the upstream's figure too).
    const bridged = fin(this.port.bridgeUsd?.(executionId));
    const cutUsd = answered && !bridged && (!r || (usd === null && engineReportsCost(this.engine))) ? price() : NaN;
    let booking = null;
    let cutNow = null;
    if (fin(cutUsd)) {
      const listUsd = price(listCostRates);
      const cut = { turnId, dispatchId, executionId, nodeId, cutUsd, cutListUsd: listUsd, cutTokens: usageTokens(spent ?? fromEvents) };
      // The next running total holds its spend at the CLI's list price. A model without one (a gateway id the CLI cannot
      // price) is no part of it: that cut is booked now, never carried out of the next step's Δ.
      if (cumulative && fin(listUsd) && (this.limits.cutCostRestored || r)) this._holdCut(cut);
      else cutNow = cut;
    } else if (r || bridged) {                          // its figure as it is (none: a blank row), or its upstream's
      booking = this._book({ sid: this.sid, hostEpoch: this.hostEpoch, hostSessionId: this.hostSessionId, turnId, dispatchId, stepKey: executionId, nodeId,
        shared: true, ...(cumulative ? { cumulativeUsd: usd ?? NaN, carried: this.openCut } : { turnUsd: usd ?? NaN }), hostUsage: null, hostModel: null,
        memberUsage: own, memberModel, investigators: [], hookUsd: null });
    }
    // The books' running total of this conversation: the CLI's own figure, else the sum of the turn figures (the epoch check).
    if (usd !== null) this.lastCumulativeUsd = cumulative ? usd : this.lastCumulativeUsd + usd;
    this.activeMs += durationMs;
    if (spent) addTokens(this.tokens, usageTokens(spent));
    this._write('turn_end', { turnId, cumulativeUsd: cumulative ? usd : null, deltaUsd: booking?.deltaUsd ?? null, hostUsage: usageTokens(null),
      hostModel: null, numTurns: r?.numTurns ?? null, durationMs: r?.durationMs ?? durationMs, exit: aborted ? 'aborted' : err ? 'error' : 'ok',
      subtype: r?.subtype ?? null });
    if (cutNow) this._bookCut(cutNow);
    if (booking) this._writeBooking(booking, { turnId, dispatchId, executionId, nodeId });
    this._saveSnapshot();
    this._stamp(executionId, { ...ref(), memberAgentId: null, memberTranscriptId: null, costSource: booking?.costSource ?? null });
    if (r) {
      // Handed on as booked: the harness logs its text and books nothing (Task 42). Its figure is the conversation's (a
      // running total), never this step's, so it goes without it: nothing downstream reads it as the step's cost.
      const booked = { ...r, sessionBooked: true };
      delete booked.costUsd;
      delete booked.cumulativeCost;
      emitTo(opts.onEvent, booked);
    }
    if (aborted) throw cutByClose ? this._refusal() : err?.name === 'AbortError' ? err : abortError();
    if (vanished) throw new SessionHostError('SESSION_HOST_VANISHED', 'the host session was not found', { hostSessionId: resume });
    if (err) throw err;
    return out;
  }

  /** Does this engine's result report the conversation's running total (a cut turn's spend then reaches the next one)? The
   *  offline host plays Claude Code. */
  _cumulativeEngine() {
    return this.port.mock === true || CUMULATIVE_COST_ENGINES.has(this.engine ?? 'claude');
  }

  _onWarn(w, { turnId, dispatchId, label, attr }) {
    this._write('watchdog', { turnId, dispatchId, code: w.code, level: 'warn', detail: w.detail || {} });
    this._log('warn', `${label}: ${w.code}`, attr);
    if (w.code === 'member-cap-refused') this.pendingRotate = 'cap';           // S6: the member's own child hit the cap
  }

  _addMemberUsd(nodeId, usd) {
    if (!fin(usd) || nodeId == null) return;
    this.memberUsdByNode[nodeId] = (this.memberUsdByNode[nodeId] ?? 0) + usd;
  }

  /** What a booking adds to its epoch's harness side: the booked parts when the harness figure was booked as split, else
   *  the turn's Δ (a bridge or override booking still moved the CLI's cumulative by Δ). */
  _harnessPart(b) {
    const carriedOverridden = (b.carried?.parts || []).some((p) => p?.overridden === true);
    if (b.costSource === 'harness' && !b.overridden && !carriedOverridden) {
      return [b.memberUsd, b.hostOverheadUsd, b.carried?.usd].reduce((a, x) => a + (fin(x) ? x : 0), 0);
    }
    return fin(b.deltaUsd) ? b.deltaUsd : 0;
  }

  _epochCheck() {
    return reconcileEpoch({ epoch: this.hostEpoch, openingUsd: this.epochOpeningUsd, lastCumulativeUsd: this.lastCumulativeUsd, bookedHarnessUsd: this.epochBookedUsd });
  }

  /** A cut turn waits for the next booking of its epoch (C9). A second cut before that booking joins the pending one as
   *  another part: both spends reach the same next Δ, and the carried split gives each cut turn its own share, oldest
   *  first, on its own row (Task 42). The totals, under the first cut's ids, are what `pause` records. */
  _holdCut(cut) {
    const o = this.openCut;
    this.openCut = o ? { ...o, cutUsd: o.cutUsd + cut.cutUsd, cutListUsd: (o.cutListUsd ?? o.cutUsd) + cut.cutListUsd,
      cutTokens: addTokens({ ...o.cutTokens }, cut.cutTokens), parts: [...(o.parts || [o]), cut] } : { ...cut, parts: [cut] };
  }

  /** A cut that can never be carried (no restore, a closing host, a rotate or restart): booked now, as an estimate. */
  _bookCut(cut, cutEngine = null) {
    this._saveSnapshot();                       // what is still held, as the rows will say once this booking persists
    const booking = this._book({ sid: this.sid, hostEpoch: this.hostEpoch, hostSessionId: this.hostSessionId, turnId: cut.turnId, dispatchId: cut.dispatchId,
      stepKey: cut.executionId, nodeId: cut.nodeId, cutEstimateUsd: cut.cutUsd, ...(cutEngine ? { cutEngine } : {}) });
    this._write('cost', { turnId: cut.turnId, dispatchId: cut.dispatchId, executionId: cut.executionId, nodeId: cut.nodeId,
      memberUsd: booking?.memberUsd ?? null, hostOverheadUsd: booking?.hostOverheadUsd ?? null, costSource: booking?.costSource ?? 'estimate', cut: true });
    this._addMemberUsd(cut.nodeId, booking?.memberUsd);
  }

  /** `cutEngine`: the engine the cut was spent on, when it is not this run's (an engine switch on resume, Task 47). */
  _bookOpenCut(cutEngine = null) {
    if (!this.openCut) return;
    const c = this.openCut;
    this.openCut = null;
    for (const p of c.parts || [c]) this._bookCut(p, cutEngine);              // each cut turn on its own row (C9)
  }

  /** C5: the executor's verdict on the execution's latest dispatch (counts only). */
  noteVerdict(executionId, { verdict = 'none', issues = 0 } = {}) {
    if (this.closed) return;                    // a turn close() waited for ends its execution after `close`: nothing follows it
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
      lastCumulativeUsd: this.lastCumulativeUsd, epochOpeningUsd: this.epochOpeningUsd, openCut: this.openCut ? structuredClone(this.openCut) : null,
      status: this.summary.status, pendingRotate: this.pendingRotate,
    };
  }

  /** 'paused' writes `pause` and keeps `openCut` in the snapshot, so the resumed turn carries it (Task 47). Any other
   *  outcome first books a pending cut as an estimate (verify major 1: a host that died after the LAST member's
   *  tool_result, or a Stop never resumed, would drop that member's dollars), then writes `close`. Once. A run that ends
   *  on Stop or a failure does not wait for its running steps (graph/scheduler.mjs `finish`), so close refuses the
   *  waiters and lets the turn in flight settle first: its records and its cut come before `pause`/`close`. A 'paused'
   *  close cuts that turn first (the run pauses; nothing will keep the rest of the turn). */
  close(outcome) {
    this.closing ??= this._close(outcome);                                    // once; a second caller waits for the first
    return this.closing;
  }

  /** What a closed host tells a waiter it refuses (and a dispatch that would start after close): a TERMINAL AbortError,
   *  so the member's flow site enacts it and never re-decides it as a pause with the detail 'aborted' (orchestrator.mjs
   *  `_execute`; the slice prompt guard does the same). A real pause has no waiters left to refuse (each one's signal
   *  carries the pause, and the scheduler waits for it), and a pause settles any AbortError as paused before the mark.
   *  A close for a pause the run reaches WITHOUT a pause request (a non-terminal failure the base catch ends paused, Task
   *  45) can still have waiters: they get the pause sentinel, so `_execute` keeps their rows non-terminal for the resume
   *  instead of recording a terminal error that would end the run stopped. */
  _refusal() {
    if (this.closedAs === 'paused') return Object.assign(new Error('paused'), { name: 'PauseError' });   // run-harness pauseErr()
    return markTerminal(abortError());
  }

  async _close(outcome) {
    this.closed = true;
    this.closedAs = outcome;
    for (const entry of this.queue.splice(0)) {
      if (entry.onAbort) entry.opts.signal.removeEventListener('abort', entry.onAbort);
      if (entry.waited) this._queued(entry.member.executionId, false);
      entry.reject(this._refusal());
    }
    // A run that ends paused without a pause request (a non-terminal failure; the scheduler did not wait for its running
    // steps) cuts the turn in flight now, as the pause that follows cuts every ungrouped step: its cut is held for the
    // resumed turn, and the run does not wait for the member to finish a turn nobody will keep.
    if (outcome === 'paused') this.closeKill.abort();
    await this.inflight;
    if (outcome === 'paused') {
      const c = this.openCut;
      this._write('pause', { reason: 'pause', ...(c ? { turnId: c.turnId, dispatchId: c.dispatchId, cutTokens: c.cutTokens } : {}) });
    } else {
      this._bookOpenCut();
      const epochChecks = [...this.epochChecks, ...(this.epochDispatches ? [this._epochCheck()] : [])];
      const turnChecksOk = this.summary.reconciled;
      this._write('close', { status: outcome, costUsd: this.summary.costUsd, memberUsd: Object.keys(this.memberUsdByNode).length ? { ...this.memberUsdByNode } : null,
        hostOverheadUsd: this.summary.hostOverheadUsd, turns: this.turns, dispatches: this.dispatches, rotations: this.rotations,
        restarts: this.restarts, wallMs: Date.now() - this.openedAt, activeMs: this.activeMs, tokens: { ...this.tokens },
        reconciled: turnChecksOk && epochChecks.every((c) => c.ok !== false), epochChecks });
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
  const hosts = new Map();
  const byNode = new Map();
  for (const spec of Array.isArray(specs) ? specs : []) {
    if (!spec || typeof spec.sid !== 'string') continue;
    const decision = decisionOf(decisions, spec.sid)
      || { mode: 'separate', requested: spec.settings?.mode ?? null, reason: 'no run-start decision', firstMemberModel: null };
    const host = new SessionHost({ spec, decision, port, transport, plainRun, limits });
    hosts.set(spec.sid, host);
    for (const id of host.members) byNode.set(id, host);
    const snap = restore && typeof restore === 'object' ? restore[spec.sid] : null;
    if (snap && typeof snap === 'object') host._restore(snap);             // Task 47: a resumed session continues its trace
    else host._open();
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
