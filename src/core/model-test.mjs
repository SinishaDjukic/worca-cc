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
import { isClaudeSignedOutError } from './preflight.mjs';
import { bridgeEvents } from './bridge/telemetry.mjs';

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

export const CLAUDE_SIGNED_OUT_HINT = "Claude Code isn't signed in — run `claude` in a terminal and type /login";

/** Actionable hint for a bridge readiness failure (config.mjs resolveModelEnv). Pure. */
export function bridgeHintFor(reason, provider = 'the provider') {
  switch (reason) {
    case 'not_signed_in': return `sign in to ${provider} under Settings › Providers (or \`worca models login ${provider}\`)`;
    case 'terms': return 'acknowledge the GitHub Copilot notice under Settings › Providers first';
    case 'no_key': return `set an API key for ${provider} under Settings › Providers, or on this model's Connection`;
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
  // A bridged model's failure is recorded by the in-process bridge with the
  // upstream's reason; the CLI's stderr for such a run carries only warnings
  // (unrecognized_model, connectors disabled), so that reason wins. The test's
  // own call is untagged (resolveModelEnv(id) passes no execution id); a
  // pipeline node run on the same model is tagged and ignored. An untagged
  // call (Ask, titles) failing on the same id during the Test is picked up
  // too — rare, and still a real failure of this model.
  const want = String(id || '').toLowerCase();
  let bridgeFailure = null;
  const onBridgeFailure = (e) => { if (e && !e.tag && String(e.catalogId || '').toLowerCase() === want) bridgeFailure = e; };
  bridgeEvents.on('failure', onBridgeFailure);
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
    // The Test's own timer can fire while the CLI still retries a failure the
    // bridge booked (it retries a 5xx well past TEST_TIMEOUT_MS): that failure
    // is the answer. A Test the caller cancelled stays a timeout.
    const booked = bridgeFailure && bridgeFailure.message && !(signal && signal.aborted);
    if (err && err.name === 'AbortError' && !booked) {
      return { ok: false, errorClass: 'timeout', message: `Timed out after ${TEST_TIMEOUT_MS / 1000}s`, hint: hintFor('timeout') };
    }
    const message = bridgeFailure && bridgeFailure.message
      ? String(bridgeFailure.message)
      : (err && err.message ? err.message : String(err));
    const errorClass = bridgeFailure && bridgeFailure.message
      ? classifyError(message)
      : ((err && err.errorClass) || classifyError(message));
    // A bridged model whose provider is not usable (model-bridge-design.md
    // §8.5): resolveModelEnv fails fast with `bridgeReason`, and the hint
    // names the fix instead of the generic credential advice. A bridge failure
    // classed `network` ("endpoint unreachable", "upstream error (500)") is not
    // an ANTHROPIC_BASE_URL problem: no hint, so the UI shows the message.
    // The CLI's own "Not logged in" is not this model's token: a first-party
    // model needs the Claude Code sign-in, so say that instead of the generic advice.
    const hint = err && err.bridgeReason ? bridgeHintFor(err.bridgeReason, err.bridgeProvider)
      : bridgeFailure && bridgeFailure.message && errorClass === 'network' ? ''
      : !bridgeFailure && isClaudeSignedOutError(message) ? CLAUDE_SIGNED_OUT_HINT
      : hintFor(errorClass);
    return { ok: false, errorClass, message, ...(hint ? { hint } : {}) };
  } finally {
    bridgeEvents.off('failure', onBridgeFailure);
    clearTimeout(timer);
    if (signal) signal.removeEventListener?.('abort', onOuterAbort);
  }
}
