// src/core/recovery-backoff.mjs
// The ONE backoff rule for recoverable errors (recoverable-error.mjs classes). The
// node retry loop (run-harness#_backoff) and worca's own helper calls — the Auto
// classifier, title generation — share it, so "how long does worca wait on a 429"
// has one answer.
//
// A rate limit waits longer than a network blip: a provider's 429 (a shared free
// pool, a per-minute cap) takes seconds to clear, and the CLI has already retried
// the request itself before exiting. Each wait honours a retry-after hint when the
// message carries one, and is capped so three retries stay within ~2 minutes.
// WORCA_RECOVERY_BACKOFF_MS overrides the base for every class (tests pin it to 0).
import { classifyError } from './recoverable-error.mjs';

export const RATE_LIMIT_BACKOFF_BASE_MS = 5_000;
export const NETWORK_BACKOFF_BASE_MS = 1_000;
/** Per-wait cap: 3 capped waits stay within ~2 minutes. */
export const MAX_RECOVERY_WAIT_MS = 40_000;
/** Retries a helper call gets (withRecoveryRetry) — the node loop's own budget is RECOVERY_MAX_AUTO_ATTEMPTS. */
export const HELPER_RETRY_ATTEMPTS = 3;
/** The classes a wait can clear. auth/quota/usage_limit never clear by waiting. */
export const RETRYABLE_CLASSES = Object.freeze(['rate_limit', 'network']);

/** The first wait for a class, before doubling. */
export function backoffBaseMs(cls, env = process.env) {
  const n = Number(env?.WORCA_RECOVERY_BACKOFF_MS);
  if (env?.WORCA_RECOVERY_BACKOFF_MS != null && env.WORCA_RECOVERY_BACKOFF_MS !== '' && Number.isFinite(n) && n >= 0) return n;
  return cls === 'rate_limit' ? RATE_LIMIT_BACKOFF_BASE_MS : NETWORK_BACKOFF_BASE_MS;
}

/** A retry-after hint in an error message ("retry-after: 12", "retry after 3 seconds", "1500ms"), in ms; null when absent. */
export function retryAfterMs(err) {
  const msg = String((err && typeof err === 'object' ? err.message : err) ?? '');
  const m = /retry[- ]after[:=\s]*(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?)?/i.exec(msg);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  return /^m/i.test(m[2] || '') ? Math.round(n) : Math.round(n * 1000);
}

/** The wait before retry `attempt` (1-based): base·2^(attempt-1), at least a retry-after hint, at most MAX_RECOVERY_WAIT_MS. */
export function recoveryDelayMs({ cls, attempt = 1, err = null, env = process.env } = {}) {
  const base = backoffBaseMs(cls, env);
  if (!base) return 0;
  const exp = base * Math.pow(2, Math.max(0, attempt - 1));
  const hint = retryAfterMs(err) ?? 0;
  return Math.min(MAX_RECOVERY_WAIT_MS, Math.max(exp, hint));
}

/** Wait `ms`, resolving early (never rejecting) when `signal` aborts. */
export function sleepAbortable(ms, signal) {
  if (!ms || ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((res) => {
    // Not unref'd: a helper call waiting out a 429 is real pending work — an
    // unref'd timer would let a headless CLI process exit mid-wait.
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); signal?.removeEventListener?.('abort', done); res(); }
    signal?.addEventListener?.('abort', done, { once: true });
  });
}

/**
 * Run `fn`, retrying it on a retryable class (rate_limit / network) with the
 * shared backoff. Anything else — and the last error once `attempts` retries are
 * spent, or once `signal` aborts — is rethrown unchanged.
 * @param {() => Promise<any>} fn
 * `classes` narrows what is retried (title generation retries only rate_limit: an
 * unspawnable CLI is stamped network, and a cosmetic call should not wait it out).
 * @param {{attempts?:number, classes?:string[], signal?:AbortSignal, env?:object,
 *          onRetry?:(w:{attempt:number, cls:string, delayMs:number, err:Error}) => void}} [o]
 */
export async function withRecoveryRetry(fn, { attempts = HELPER_RETRY_ATTEMPTS, classes = RETRYABLE_CLASSES, signal, env = process.env, onRetry } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const cls = classifyError(err);
      if (attempt > attempts || !classes.includes(cls) || signal?.aborted || err?.name === 'AbortError') throw err;
      const delayMs = recoveryDelayMs({ cls, attempt, err, env });
      try { onRetry?.({ attempt, cls, delayMs, err }); } catch { /* a logger must not break the retry */ }
      await sleepAbortable(delayMs, signal);
      if (signal?.aborted) throw err;
    }
  }
}
