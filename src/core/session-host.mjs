// src/core/session-host.mjs — one SessionHost per session: the member dispatches of a session run one at a time, each as
// ONE host turn (session groups, Tasks 39–41; spec §5, §5.2, §6.3; C2, C9–C12, C20, C25, C30, C31, C35, C39–C41, C43). The executor
// hands a member's unchanged runOpts to `host.run(opts, member)` (Task 45). A turn's frames go through the demux
// (session-demux.mjs), its dollars through the harness port (Task 42), and every fact lands in the session trace
// (session-trace.mjs), never a prompt.
import { runClaude, mockEnabled } from './claude-runner.mjs';
import { runMockSession } from './engines/mock-session.mjs';
import { SessionHostError, HOST_MAX_TURNS, HOST_TOOLS_MODE, dispatchIdFor, turnIdFor, dispatchMessage, memberDefinition, hostFlagsFor,
  hostSpawnOpts } from './engines/session-dispatch.mjs';
import { createTurnDemux, watchdogVerdict } from './engines/session-demux.mjs';
import { createSessionTrace, applyTraceRecord, emptySummary } from './session-trace.mjs';
import { priceUsage, usageTokens, reconcileEpoch, estimateMemberUsd } from './session-cost.mjs';
import { listCostRates } from './config.mjs';
import { upstreamKey } from './model-roles.mjs';
import { classifyError } from './recoverable-error.mjs';
import { engineReportsCost } from '../shared/engine-switch.mjs';
import { RECOVERY_MAX_AUTO_ATTEMPTS, markTerminal } from './failure-policy.mjs';
import { sessionHostGuardSettings } from './session-host-guard.mjs';

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
/** Is there a `shared` ("one conversation") runtime? Not before Task 65, which builds it (its `_turn` path) and turns this
 *  on: until then the run-start gate runs a `shared` session separate, never as sub-agents behind the closed gate (C18). */
export const SESSION_SHARED_RUNTIME = false;
/** C30: this many consecutive watchdog failures in one session degrade it to `separate` for the rest of the run. */
export const HOST_DEGRADE_AFTER = RECOVERY_MAX_AUTO_ATTEMPTS;
/** `--max-budget-usd` never goes below a cent (C10). */
const BUDGET_FLOOR_USD = 0.01;

/** The host turn's runner. The mock host plays a turn offline; a real one is `runClaude` with the RAW envelopes the demux
 *  routes (`rawEvents`: runClaude otherwise hands out the normalized vocabulary, which carries no Agent call). The mock
 *  predicate is claude-runner's own (`opts.mock` OR WORCA_MOCK/ORCH_MOCK, critique minor 8), never `opts.mock` alone. */
export const defaultTransport = (hostOpts) => (mockEnabled(hostOpts) ? runMockSession(hostOpts) : runClaude({ ...hostOpts, rawEvents: true }));

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
    // Tests only: cutCostRestored, rotateDispatches, rotateContextTokens, degradeAfter, mainThreadGuard, guardField.
    this.limits = { cutCostRestored: HOST_CUT_COST_RESTORED, rotateDispatches: HOST_ROTATE_DISPATCHES, rotateContextTokens: HOST_ROTATE_CONTEXT_TOKENS,
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

  _log(level, text, attr) {
    try { this.port.log?.(level, text, attr); } catch { /* a log line never breaks a turn */ }
  }

  _stamp(executionId, ref) {
    try { this.port.stampRow?.(executionId, ref); } catch { /* the row ref is best-effort, like _persist */ }
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

  /** C30: a degraded session's dispatch is a plain spawn (no record, no turn), never `--resume <host>`: only a CLI session a
   *  plain run started itself is resumed (a follow-up round of a degraded member, as ungrouped). Its host dispatch is
   *  history: a verdict on this plain run (Task 46 calls noteVerdict after it) must not land on that failed turn. */
  _plain(opts, member) {
    this.lastDispatch.delete(String(member.executionId));
    const own = typeof opts.resumeSessionId === 'string' && this.plainSessions.has(opts.resumeSessionId);
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
    this._rotateIfDue();                                                       // C25: before a dispatch, never mid-turn
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
    this._bookOpenCut();                                                       // no host turn follows to carry it (C9)
    this._write('degrade', { from: this.mode, to: 'separate', reason });   // its audit line comes from the port (sessionAuditLine)
    this.mode = 'separate';
    this.degradeReason = reason;
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
    // A member with no model of its own and no host model runs on the CLI's default model, which nothing here can price:
    // no flag then (as for an ungrouped step; C37's gate still runs before every spawn).
    const maxBudgetUsd = definition.model || flags.model ? this._maxBudgetUsd([flags.model, this.hostResolvedModel, definition.model].filter(Boolean)) : null;
    this._write('turn_start', { turnId, resume: !!resume, maxTurns: HOST_MAX_TURNS, maxBudgetUsd, hostModel: flags.model ?? null,
      hostEffort: flags.effort ?? null });
    this._write('dispatch', { turnId, dispatchId, executionId, nodeId, attempt, agentType,
      cold: attempt > 1 || !!opts.resumeSessionId || !!opts.coldRedispatch, queueMs });

    const started = Date.now();
    const turnAbort = new AbortController();
    const signal = opts.signal ? AbortSignal.any([opts.signal, turnAbort.signal]) : turnAbort.signal;
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
    if (opts.signal?.aborted) outcome = 'abort';                                                   // Stop / pause: the turn is cut
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
    if (booking) {
      if (booking.carried && this.openCut) {            // C9: each cut turn's spend inside this Δ goes back to its own row
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
    // C7: the full ref replaces the bind-time one.
    this._stamp(executionId, { sid: this.sid, hostEpoch: this.hostEpoch, hostSessionId: this.hostSessionId, turnId, dispatchId, attempt,
      memberAgentId: boundId, memberTranscriptId: done?.agentId ?? null, costSource: booking?.costSource ?? null });

    switch (outcome) {
      case 'abort': throw err?.name === 'AbortError' ? err : abortError();
      case 'accept':
        this.consecutiveWatchdog = 0;
        if (err) this._log('warn', 'the main agent failed after the step finished; the step is kept', attr);
        emit({ type: 'result', text: done.report, sessionBooked: true });     // the harness logs it and books nothing (Task 42)
        return { text: done.report, exitCode: 0 };
      case 'member-error':
        this.consecutiveWatchdog = 0;
        // C41: a 529 retries as rate_limit, a usage limit pauses as usage_limit with its reset time, exactly as ungrouped.
        throw Object.assign(new Error(done.errorText || 'the step failed'), { errorClass: classifyError(done.errorText || '') });
      case 'watchdog': {
        this.consecutiveWatchdog += 1;
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
  _bookCut(cut) {
    const booking = this._book({ sid: this.sid, hostEpoch: this.hostEpoch, hostSessionId: this.hostSessionId, turnId: cut.turnId, dispatchId: cut.dispatchId,
      stepKey: cut.executionId, nodeId: cut.nodeId, cutEstimateUsd: cut.cutUsd });
    this._write('cost', { turnId: cut.turnId, dispatchId: cut.dispatchId, executionId: cut.executionId, nodeId: cut.nodeId,
      memberUsd: booking?.memberUsd ?? null, hostOverheadUsd: booking?.hostOverheadUsd ?? null, costSource: booking?.costSource ?? 'estimate', cut: true });
    this._addMemberUsd(cut.nodeId, booking?.memberUsd);
  }

  _bookOpenCut() {
    if (!this.openCut) return;
    const c = this.openCut;
    this.openCut = null;
    for (const p of c.parts || [c]) this._bookCut(p);                         // each cut turn on its own row (C9)
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
      lastCumulativeUsd: this.lastCumulativeUsd, epochOpeningUsd: this.epochOpeningUsd, openCut: this.openCut ? structuredClone(this.openCut) : null,
      status: this.summary.status,
    };
  }

  /** 'paused' writes `pause` and keeps `openCut` in the snapshot, so the resumed turn carries it (Task 47). Any other
   *  outcome first books a pending cut as an estimate (verify major 1: a host that died after the LAST member's
   *  tool_result, or a Stop never resumed, would drop that member's dollars), then writes `close`. Once. A run that ends
   *  on Stop or a failure does not wait for its running steps (graph/scheduler.mjs `finish`), so close refuses the
   *  waiters and lets the turn in flight settle first: its records and its cut come before `pause`/`close`. */
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
