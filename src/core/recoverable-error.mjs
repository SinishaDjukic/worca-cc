// src/core/recoverable-error.mjs
// Single source of truth for "is this pipeline error recoverable, and which class".
// Recoverable errors are user/transient-fixable (re-auth, wait, top up, retry),
// NOT bugs. The orchestrator uses the class to drive a retry gate; a null result
// means "fail as today". Classification reads the thrown message because the real
// runner (src/core/claude-runner.mjs) folds the underlying headless cause — incl.
// the 401 auth string captured from the terminal result(is_error:true) event —
// into its reject text: `claude exited with code N: <cause>` (claude-runner.mjs:298).
//
// CAVEAT (accepted, see YAGNI): detection is message-based unless the producer
// stamped `errorClass` (claude-runner does, on the non-zero-exit path only —
// spawn-failure errors stay unstamped and keep message-sniff classification), so
// a genuine bug whose message happens to contain a recoverable keyword (e.g. an
// app error literally mentioning "network" or "quota") will be classed
// recoverable and retried. Structured error-code detection is out of scope.
//
// @param {Error|string|unknown} err
// @returns {'auth'|'usage_limit'|'rate_limit'|'quota'|'network'|null}
export function classifyError(err) {
  // A producer that saw MORE evidence than the message carries stamps the
  // verdict directly: claude-runner classifies the FULL stderr stream line-by-
  // line, then tail-caps the message. Re-sniffing the capped message here could
  // only lose an early marker (or mint a fake one at the slice boundary), so a
  // stamp — including an explicit null — is authoritative.
  if (err && typeof err === 'object' && err.errorClass !== undefined) return err.errorClass;
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
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network|connection (refused|reset|closed|error)|closed mid-response|response above may be incomplete|\btimed?[ -]?out\b|\btimeout\b/i.test(msg)) return 'network';
  return null;
}

// Precedence for folding per-line classes into the one whole-text class — the
// SAME order as the regex chain above. First-match-wins there equals
// strongest-class-wins here, because every per-line match (the patterns are
// unanchored) is also a whole-text match.
const CLASS_ORDER = ['auth', 'usage_limit', 'rate_limit', 'quota', 'network'];

/** Fold two classification results, keeping the higher-precedence class. */
export function strongestClass(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return CLASS_ORDER.indexOf(a) <= CLASS_ORDER.indexOf(b) ? a : b;
}
