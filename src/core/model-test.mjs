// src/core/model-test.mjs
// One minimal live claude spawn to verify a catalog model actually works —
// the Models-view Test button (POST /api/models/:id/test). Mirrors the cheap
// aux-run pattern of title.mjs: the model's catalog routing env travels with
// the id via resolveModelEnv, no tools, low effort, hard timeout. Never
// throws — the outcome is a result object either way.

import { runClaude } from './claude-runner.mjs';
import { resolveModelEnv } from './config.mjs';
import { AUX_EFFORT } from './model-env.mjs';
import { classifyError } from './recoverable-error.mjs';

const TEST_TIMEOUT_MS = 60_000;
const REPLY_CAP = 100;

const SYSTEM = 'You are a connectivity check. Reply with exactly OK.';

/** Actionable hint for a recovery class ('' when there is nothing to add —
 *  the raw runner message already carries the detail). Pure, for tests. */
export function hintFor(errorClass) {
  switch (errorClass) {
    case 'auth': return 'authentication failed — check the token/secret for this model';
    case 'network': return 'endpoint unreachable — check ANTHROPIC_BASE_URL';
    case 'rate_limit': return 'the endpoint is rate-limiting or overloaded — try again shortly';
    case 'quota': return 'quota/billing problem — check the account behind this endpoint';
    case 'usage_limit': return 'usage limit reached on the account behind this endpoint';
    case 'timeout': return `no reply — the test timed out after ${TEST_TIMEOUT_MS / 1000}s`;
    default: return '';
  }
}

/**
 * Live connectivity check for a catalog model id (global or plugin — the
 * resolution precedence is resolveModelEnv's). Explicit user action only.
 * @param {string} id catalog model id
 * @param {{signal?:AbortSignal, bin?:string, run?:typeof runClaude}} [opts]
 *   `run` is injectable for unit tests.
 * @returns {Promise<{ok:true, text:string}|{ok:false, errorClass:(string|null), message:string, hint?:string}>}
 */
export async function testModel(id, { signal, bin, run = runClaude } = {}) {
  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), TEST_TIMEOUT_MS);
  timer.unref?.();
  try {
    const { text } = await run({
      cwd: process.cwd(),
      systemPrompt: SYSTEM,
      prompt: 'Reply with exactly OK.',
      model: id,
      modelEnv: resolveModelEnv(id),
      effort: AUX_EFFORT,
      permissionMode: 'acceptEdits',
      allowedTools: [],          // empty → no --allowedTools flag; pure text gen
      signal: ctrl.signal,
      bin,
      onEvent: () => {},
    });
    const reply = String(text || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l) || '';
    if (!reply) {
      return { ok: false, errorClass: null, message: 'the model returned an empty reply' };
    }
    return { ok: true, text: reply.slice(0, REPLY_CAP) };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, errorClass: 'timeout', message: `Timed out after ${TEST_TIMEOUT_MS / 1000}s`, hint: hintFor('timeout') };
    }
    const message = err && err.message ? err.message : String(err);
    const errorClass = (err && err.errorClass) || classifyError(message);
    const hint = hintFor(errorClass);
    return { ok: false, errorClass, message, ...(hint ? { hint } : {}) };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener?.('abort', onOuterAbort);
  }
}
