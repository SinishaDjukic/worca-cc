// failure-policy.mjs — the ONE place that decides what a failure does to a run.
//
// Every site in the engine that can see a failure — the per-node retry loop, the
// flow-card dispatcher, the budget gate, run()/resume()'s setup and shell catch
// blocks — asks `resolveFailure()` for a VERDICT and then enacts it with its own
// mechanics (throwing the pause sentinel through the scheduler, picking a resume
// point, stamping a setup replay). No site makes the decision itself, so shifting
// a case from "terminal error" to "pause" (or back) is a one-cell edit in
// FAILURE_POLICY below plus its row in test/failure-policy.test.mjs.
//
// Inputs (all plain values — this module is pure and imports nothing):
//   site     where the failure surfaced (SITES)
//   cls      classifyError()'s class, or null for an unclassified error; the
//            budget gate passes its cost code
//   auto     --yes / headless (true) or interactive (false)
//   attempt  1-based attempt number, for bounded retries
//   answer   the recovery prompt's answer once the user gave one ('retry'|'giveup')
//
// Verdicts:
//   { outcome: 'retry' }                          try again (the site backs off)
//   { outcome: 'prompt', options: [...] }         ask the user (interactive only)
//   { outcome: 'pause', reason: ReasonCode }      park the run, resumable
//   { outcome: 'error' }                          end the run as a terminal error
//
// Control-flow signals — a PauseError, an AbortError, a pause already requested,
// the user's Stop — are NOT failures and never reach this table; every site guards
// for them first. Stop is user-only and always ends the run as 'stopped'.
//
// A verdict is issued ONCE. When a site enacts 'error' it marks the error
// terminal (markTerminal) so every enclosing catch — the flow dispatcher, the
// shell — enacts that same verdict instead of re-deciding at its own site.

/** Where a failure can surface. */
export const SITES = Object.freeze(['node', 'flow', 'budget', 'setup', 'launch', 'shell', 'resume']);

/** Machine-readable pause reasons. The human text rides `pauseDetail`. */
export const REASON = Object.freeze({
  USAGE_LIMIT: 'usage_limit',     // a session/usage cap that clears after a multi-hour reset
  RECOVERABLE: 'recoverable',     // a classified (auth/quota/rate_limit/network) error the run could not outwait
  ERROR: 'error',                 // a failure that would otherwise have ended the run
  COST_PIPELINE: 'cost_pipeline', // the per-pipeline cost cap
  COST_TOTAL: 'cost_total',       // the total (weekly/monthly) cost cap
});
export const REASON_CODES = Object.freeze(Object.values(REASON));

/** Max auto-mode retries for a recoverable error before the row's `then` verdict. */
export const RECOVERY_MAX_AUTO_ATTEMPTS = (() => {
  const n = Number(process.env.WORCA_RECOVERY_MAX_ATTEMPTS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
})();

// ── verdict constructors ──────────────────────────────────────────────────────
const pause = (reason) => Object.freeze({ outcome: 'pause', reason });
const error = () => Object.freeze({ outcome: 'error' });
/** Bounded retries (auto mode): `max` retries, then the `then` verdict. */
const retry = (max, then) => Object.freeze({ outcome: 'retry', max, then });
/** Interactive prompt: Retry re-runs in place; the give-up option enacts `giveUp`. */
const prompt = (giveUp) => Object.freeze({ outcome: 'prompt', giveUp });

/** One matrix cell: the verdict per run mode. */
const cell = (auto, interactive) => Object.freeze({ auto, interactive });
/** The same verdict in both modes. */
const both = (v) => cell(v, v);

// ── THE MATRIX ────────────────────────────────────────────────────────────────
// Rows are keyed by site, then by error class; '*' is the row for any class the
// site has no specific row for. Edit a cell to shift a case.
//
// A note on the two contested rows (PR #415 vs. the policy PR #412 shipped):
//   node/'*'   an UNCLASSIFIED error (often a genuine bug) pauses instead of ending
//              the run; resume retries the node in place. Flip to error() to
//              restore "a bug ends the run".
//   node/auth… an interactive recovery prompt's give-up option PAUSES (no Abort
//              verdict). Flip prompt(error()) to offer Abort as a terminal error.
export const FAILURE_POLICY = Object.freeze({
  node: Object.freeze({
    usage_limit: both(pause(REASON.USAGE_LIMIT)),
    // auth/quota are user-fixable but never time-fixable — a 1s/2s/4s backoff
    // cannot re-login or top up a balance — so auto mode pauses on the first hit.
    // A self-parked auto run pauses as RECOVERABLE (the class is kept: "resume when
    // it clears"); a user who gives up on the prompt pauses as ERROR (a verdict).
    auth:        cell(pause(REASON.RECOVERABLE), prompt(pause(REASON.ERROR))),
    quota:       cell(pause(REASON.RECOVERABLE), prompt(pause(REASON.ERROR))),
    rate_limit:  cell(retry(RECOVERY_MAX_AUTO_ATTEMPTS, pause(REASON.RECOVERABLE)), prompt(pause(REASON.ERROR))),
    network:     cell(retry(RECOVERY_MAX_AUTO_ATTEMPTS, pause(REASON.RECOVERABLE)), prompt(pause(REASON.ERROR))),
    '*':         both(pause(REASON.ERROR)),
  }),
  // A flow card, the questions loop, _afterExecution, a composite shell mode, an
  // allocation failure — engine-side throws around an execution.
  flow: Object.freeze({ '*': both(pause(REASON.ERROR)) }),
  // The step-boundary budget gate (not an error: a cap was reached).
  budget: Object.freeze({
    cost_pipeline: both(pause(REASON.COST_PIPELINE)),
    cost_total:    both(pause(REASON.COST_TOTAL)),
  }),
  // run()'s setup — checkout, graph build, skills gate — failed with the pipeline
  // row already created. A pause here stamps `setupIncomplete`; resume replays it.
  setup: Object.freeze({ '*': both(pause(REASON.ERROR)) }),
  // Before the pipeline row exists (topology, preflight, tool detection) there is
  // nothing to resume into: a launch error is the only enactable verdict.
  launch: Object.freeze({ '*': both(error()) }),
  // Anything that escaped the engine after setup (a scheduler throw, a persist
  // failure, a bookkeeping bug).
  shell: Object.freeze({ '*': both(pause(REASON.ERROR)) }),
  // resume() could not REHYDRATE the paused run — the checkout is gone, run.json
  // is corrupt, a guardrail set or agent prompt no longer loads. The point on disk
  // is already the best the run can offer: parking it again would re-persist the
  // same point (and re-notify the task source) on every attempt, forever. A
  // structurally unrecoverable resume ends the run.
  resume: Object.freeze({ '*': both(error()) }),
});

/** The recovery prompt's options, derived from the row: what Retry does is fixed;
 *  the give-up option's id is the wire `decision` value and names its verdict. */
export function promptOptions(giveUp) {
  const giveUpId = giveUp.outcome === 'pause' ? 'pause' : 'abort';
  return Object.freeze([
    Object.freeze({ id: 'retry', label: 'Retry' }),
    giveUpId === 'pause'
      ? Object.freeze({ id: 'pause', label: 'Pause the run (nothing is discarded — resume later)' })
      : Object.freeze({ id: 'abort', label: 'Abort the run' }),
  ]);
}

/** The give-up option of a prompt's options (the CLI/UI/chat render its label and
 *  send its id back as the decision). Falls back to the pause option for a prompt
 *  payload that predates options. */
export function giveUpOption(options) {
  const found = Array.isArray(options) ? options.find((o) => o && o.id !== 'retry') : null;
  return found || promptOptions({ outcome: 'pause' })[1];
}

/** A recovery answer's `decision` wire value → the policy answer. 'abort' is the
 *  pre-policy wire value (older UI tabs, chat /abort) and means give up too. */
export function answerFromDecision(decision) {
  return decision === 'retry' ? 'retry' : 'giveup';
}

/**
 * Decide what a failure does. Pure.
 * @param {{site:string, cls?:string|null, auto?:boolean, attempt?:number, answer?:'retry'|'giveup'}} f
 * @returns {{outcome:'retry'|'prompt'|'pause'|'error', reason?:string, options?:readonly object[]}}
 */
export function resolveFailure({ site, cls = null, auto = false, attempt = 1, answer } = {}) {
  const rows = FAILURE_POLICY[site];
  if (!rows) throw new Error(`failure-policy: unknown site '${site}'`);
  const row = (cls != null && rows[cls]) || rows['*'];
  if (!row) throw new Error(`failure-policy: no row for ${site}/${cls}`);
  let v = auto ? row.auto : row.interactive;
  if (v.outcome === 'retry') {
    v = attempt > v.max ? v.then : { outcome: 'retry' };
  }
  if (v.outcome === 'prompt') {
    if (answer === undefined) return { outcome: 'prompt', options: promptOptions(v.giveUp) };
    v = answer === 'retry' ? { outcome: 'retry' } : v.giveUp;
  }
  return v.outcome === 'pause' ? { outcome: 'pause', reason: v.reason } : { outcome: v.outcome };
}

// ── terminal-verdict stamp ────────────────────────────────────────────────────
const TERMINAL = Symbol.for('worca.failure.terminal');
/** Stamp an error whose verdict is 'error' so enclosing sites enact, not re-decide. */
export function markTerminal(err) {
  if (err && typeof err === 'object') { try { err[TERMINAL] = true; } catch { /* frozen */ } }
  return err;
}
export function isTerminal(err) {
  return !!(err && typeof err === 'object' && err[TERMINAL] === true);
}

// ── consequences of a pause, keyed on its reason ──────────────────────────────
// What each surface does with a parked run is a function of the reason code, not
// of ad hoc string checks. `null` is a manual pause (the user pressed Pause).
const CONSEQUENCES = Object.freeze({
  manual:                { reportsToSource: false, stagesResults: false, severity: 'info',    notifyPref: 'paused', exitInteractive: 0, label: null },
  [REASON.USAGE_LIMIT]:  { reportsToSource: true,  stagesResults: false, severity: 'warning', notifyPref: 'paused', exitInteractive: 0, label: 'session/usage limit reached' },
  [REASON.RECOVERABLE]:  { reportsToSource: true,  stagesResults: false, severity: 'warning', notifyPref: 'paused', exitInteractive: 0, label: 'recoverable error — resume to retry' },
  [REASON.COST_PIPELINE]:{ reportsToSource: true,  stagesResults: false, severity: 'warning', notifyPref: 'paused', exitInteractive: 0, label: 'pipeline cost limit reached' },
  [REASON.COST_TOTAL]:   { reportsToSource: true,  stagesResults: false, severity: 'warning', notifyPref: 'paused', exitInteractive: 0, label: 'total cost limit reached' },
  [REASON.ERROR]:        { reportsToSource: true,  stagesResults: true,  severity: 'error',   notifyPref: 'error',  exitInteractive: 1, label: 'a step failed' },
});

/** The consequences row for a pause reason (unknown/legacy free-text reasons read
 *  as a forced pause with a warning severity — every reasoned pause is forced). */
export function pauseConsequences(reason) {
  if (reason == null || reason === '') return CONSEQUENCES.manual;
  return CONSEQUENCES[reason] || CONSEQUENCES[REASON.USAGE_LIMIT];
}

/** CLI exit code for a paused run. Under --yes every pause is the run parking
 *  ITSELF with nobody left to resume: 3, so a wrapper can tell a resumable pause
 *  from a hard error (1) and a usage error (2). Interactive: 0 when the user asked
 *  for it or a cap/limit holds the run; 1 when an error forced it. */
export function pauseExitCode(reason, auto) {
  return auto ? 3 : pauseConsequences(reason).exitInteractive;
}

/** Human label for a reason code, or null for a manual pause / unknown code. */
export function describePauseReason(reason) {
  return pauseConsequences(reason).label;
}
