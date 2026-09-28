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
// @returns {'auth'|'model'|'usage_limit'|'rate_limit'|'quota'|'network'|null}
export function classifyError(err) {
  // A producer that saw MORE evidence than the message carries stamps the
  // verdict directly: claude-runner classifies the FULL stderr stream line-by-
  // line, then tail-caps the message. Re-sniffing the capped message here could
  // only lose an early marker (or mint a fake one at the slice boundary), so a
  // stamp — including an explicit null — is authoritative.
  if (err && typeof err === 'object' && err.errorClass !== undefined) return err.errorClass;
  const msg = String((err && err.message) || err || '');
  // The credential broker's refusals (a missing or rejected key, a dead token, nobody to
  // bill) arrive as a 403 the CLI prints as "Failed to authenticate. API Error: 403
  // worca-broker: …" — no 401, no authentication_error left in the text. Same class.
  if (BROKER_AUTH_RE.test(msg)) return 'auth';
  // OpenRouter's daily allowance of `:free` requests is spent: only its daily reset clears
  // it, so it pauses like the session limit below instead of retrying as a 429.
  if (FREE_DAILY_RE.test(msg)) return 'usage_limit';
  if (/\b401\b|invalid authentication|authentication_error|please run .*login|not logged in/i.test(msg)) return 'auth';
  // The model id itself is the problem — refused by the endpoint it was sent to,
  // or named by a catalog-miss error. The remedy is a different model id, never
  // a retry. The stderr notice `[claude-code:unrecognized_model]` is deliberately
  // NOT classified here: the runner treats it as a benign notice
  // (claude-runner BENIGN_STDERR_PATTERNS) — it fires on every spawn whose id the
  // CLI does not know, and never states the cause. The phrases are specific
  // CLI/API wordings so an ordinary message that merely mentions a model stays
  // unclassified.
  if (/no access to this model|isn't described by this version's model catalog|model not found/i.test(msg)) return 'model';
  // Session/usage caps that only clear after a multi-hour reset (the CLI prints
  // "You've hit your session limit · resets 6pm"). Distinct from rate_limit (a
  // few-second 429/overloaded burst) because retrying is futile — the orchestrator
  // PAUSES on this class instead of burning the retry budget. Kept narrow enough
  // not to swallow the generic "usage limit reached" billing case (-> quota).
  if (/\bsession limit\b|hit your[^.]*\blimit\b|reached your[^.]*\blimit\b|\blimit\b[^.]*\bresets?\b/i.test(msg)) return 'usage_limit';
  if (/\b429\b|\b529\b|rate.?limit|overloaded/i.test(msg)) return 'rate_limit';
  if (/credit balance|usage limit|quota|insufficient_quota|billing/i.test(msg)) return 'quota';
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network|connection (refused|reset|closed|error)|closed mid-response|response above may be incomplete|\btimed?[ -]?out\b|\btimeout\b|\b500\b|Internal Server Error/i.test(msg)) return 'network';
  return null;
}

// OpenRouter's `:free` models run on a donated provider pool that every OpenRouter
// user shares: its 429 ("temporarily rate-limited upstream", limit_source
// upstream_provider_shared_pool) arrives for a single request, whatever worca's
// max-concurrent setting. Still class rate_limit (a retry can clear it); only the
// final pause message changes, so it names the real cause and the real fixes.
const SHARED_POOL_RE = /rate-limited upstream|upstream_provider_shared_pool/i;

/** Whether a rate-limit error came from a provider's shared (free) pool. */
export function isSharedPoolRateLimit(err) {
  const msg = String((err && typeof err === 'object' ? err.message : err) ?? '');
  return SHARED_POOL_RE.test(msg);
}

/** The fix text a rate-limit pause carries ('' when there is nothing specific to say). */
export function rateLimitHint(err) {
  if (!isSharedPoolRateLimit(err)) return '';
  return "the provider's shared free pool is saturated — every user of this free model shares it, " +
    "so this is not worca's max-concurrent setting. Use the paid variant, add your own provider key " +
    '(BYOK) on the provider, or give the model a fallback model list';
}

// OpenRouter's daily allowance for `:free` models (1000 requests a day on an account that
// bought $10 of credit, 50 below): its 429 names the limit ("Rate limit exceeded:
// free-models-per-day-high-balance", limit_source openrouter_free_tier_daily) and clears
// only at the daily reset, 00:00 UTC. The bridge adds "resets <ISO>" when OpenRouter says.
const FREE_DAILY_RE = /openrouter_free_tier_daily|free-models-per-day/i;
const FREE_DAILY_RESET_RE = /resets (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/;

/** Whether an error is OpenRouter's spent daily allowance of free-model requests. */
export function isFreeDailyLimit(err) {
  const msg = String((err && typeof err === 'object' ? err.message : err) ?? '');
  return FREE_DAILY_RE.test(msg);
}

/** When the free-model allowance comes back (ms): the reset the error names, else the next 00:00 UTC. */
export function freeDailyResetAt(err, now = Date.now()) {
  const msg = String((err && typeof err === 'object' ? err.message : err) ?? '');
  const m = FREE_DAILY_RESET_RE.exec(msg);
  const named = m ? Date.parse(m[1]) : NaN;
  if (Number.isFinite(named) && named > now) return named;
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** "3h 12m" / "12m" / "under a minute". Pure. */
export function untilText(ms) {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return 'under a minute';
  const h = Math.floor(min / 60);
  return h ? `${h}h ${min % 60}m` : `${min}m`;
}

/**
 * The pause text for a spent free-model allowance ('' for any other error): what ran out,
 * when it comes back, and the two ways on. `used`/`limit` when a key reading has them.
 */
export function freeDailyHint(err, { now = Date.now(), used = null, limit = null } = {}) {
  if (!isFreeDailyLimit(err)) return '';
  const at = freeDailyResetAt(err, now);
  const hhmm = new Date(at).toISOString().slice(11, 16);
  const count = Number.isFinite(limit) && limit > 0 ? ` (${Number.isFinite(used) ? used : limit} / ${limit})` : '';
  return `OpenRouter's free-model requests for today are used up${count} — they reset at ${hhmm} UTC, in ${untilText(at - now)}. ` +
    'Resume after the reset, or switch this step to a paid model';
}

// The credential broker (src/broker/) answers in the provider's own error envelope
// with a `worca-broker:` message, so its refusals already land in the right class:
// a missing/rejected key or a dead token is `auth` (401), a spent budget is `quota`
// (its message says "quota reached"), a busy slot is `rate_limit` (429). Only the
// pause text differs: it says what to do, which is never "sign in to Claude Code".
const BROKER_RE = /worca-broker:/i;
/** The broker's credential refusals (classifyError reads them as `auth`). */
const BROKER_AUTH_RE = /worca-broker: (?:no .+ for \S+|your .+ was rejected|.+ key for \S+: |token expired or revoked|no token|this action has no signed-in person|cannot get a token)/i;

/** Whether an error came from the credential broker. */
export function isBrokerError(err) {
  const msg = String((err && typeof err === 'object' ? err.message : err) ?? '');
  return BROKER_RE.test(msg);
}

/** The fix text a pause caused by the broker carries ('' for any other error). */
export function brokerHint(err, cls = classifyError(err)) {
  if (!isBrokerError(err)) return '';
  if (cls === 'auth') return 'the credential broker refused this spawn: add or replace the key on the key page (Settings › My credentials links to it), then resume';
  if (cls === 'quota') return 'a spending cap on the credential broker was reached: raise it on the key page or wait for the reset, then resume';
  return '';
}

// Precedence for folding per-line classes into the one whole-text class — the
// SAME order as the regex chain above. First-match-wins there equals
// strongest-class-wins here, because every per-line match (the patterns are
// unanchored) is also a whole-text match.
const CLASS_ORDER = ['auth', 'model', 'usage_limit', 'rate_limit', 'quota', 'network'];

/** Fold two classification results, keeping the higher-precedence class. */
export function strongestClass(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return CLASS_ORDER.indexOf(a) <= CLASS_ORDER.indexOf(b) ? a : b;
}
