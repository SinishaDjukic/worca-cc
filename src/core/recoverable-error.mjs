// src/core/recoverable-error.mjs
// Single source of truth for "is this pipeline error recoverable, and which class".
// Recoverable errors are user/transient-fixable (re-auth, wait, top up, retry),
// NOT bugs. The orchestrator uses the class to drive a retry gate; a null result
// means "fail as today". Classification reads the thrown message because the real
// runner (src/core/claude-runner.mjs) folds the underlying headless cause — incl.
// the 401 auth string captured from the terminal result(is_error:true) event —
// into its reject text: `claude exited with code N: <cause>` (claude-runner.mjs:298).
//
// CAVEAT (accepted, see YAGNI): detection is purely message-based, so a genuine
// bug whose message happens to contain a recoverable keyword (e.g. an app error
// literally mentioning "network" or "quota") will be classed recoverable and
// retried. Structured error-code detection is out of scope.
//
// @param {Error|string|unknown} err
// @returns {'auth'|'usage_limit'|'rate_limit'|'quota'|'network'|null}
export function classifyError(err) {
  const msg = String((err && err.message) || err || '');
  if (/\b401\b|invalid authentication|authentication_error|please run .*login|not logged in/i.test(msg)) return 'auth';
  // Session/usage caps that only clear after a multi-hour reset (the CLI prints
  // "You've hit your session limit · resets 6pm"). Distinct from rate_limit (a
  // few-second 429/overloaded burst) because retrying is futile — the orchestrator
  // PAUSES on this class instead of burning the retry budget. Kept narrow enough
  // not to swallow the generic "usage limit reached" billing case (-> quota).
  if (/\bsession limit\b|hit your[^.]*\blimit\b|reached your[^.]*\blimit\b|\blimit\b[^.]*\bresets?\b/i.test(msg)) return 'usage_limit';
  if (/\b429\b|\b529\b|rate.?limit|overloaded/i.test(msg)) return 'rate_limit';
  if (/credit balance|usage limit|quota|insufficient_quota|billing/i.test(msg)) return 'quota';
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network|connection (refused|reset|closed|error)|closed mid-response|response above may be incomplete/i.test(msg)) return 'network';
  return null;
}
