// src/core/claude-auth.mjs
// "Did this Claude failure happen because the CLI is signed out?" — for the
// surfaces that only learn it after the spawn (Ask Worca, run overview, model
// Test). The CLI's own error text is not reliable: signed out, a first-party
// model id can fail as `[claude-code:unrecognized_model]` instead of "Not
// logged in". So a failed run on a model the CLI serves itself (not routed to
// an endpoint or the bridge) asks preflight's probeClaudeAuth, which is cheap
// (remembered 60 s) and says 'signed-out' only when `claude auth status` does.
import { isClaudeSignedOutError, probeClaudeAuth } from './preflight.mjs';
import { modelHasBaseUrlRouting } from './config.mjs';
import { configuredClaudeBin } from './onboarding.mjs';

/**
 * Never throws.
 * @param {{message?:string, model?:string, bin?:string, probe?:typeof probeClaudeAuth, routed?:(model:string)=>boolean}} o
 *   `probe` / `routed` are injectable for tests.
 * @returns {Promise<boolean>}
 */
export async function failedBecauseSignedOut({
  message, model, bin = configuredClaudeBin(), probe = probeClaudeAuth, routed = modelHasBaseUrlRouting,
} = {}) {
  try {
    if (isClaudeSignedOutError(message)) return true;
    if (model && routed(model)) return false;   // the endpoint / bridge authenticates, not the CLI sign-in
    // Fresh, not the remembered answer: a failure is rare, and a stale one would
    // misname it for up to a minute after signing in or out.
    return (await probe({ bin, force: true })).state === 'signed-out';
  } catch { return false; }
}
