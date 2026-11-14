// src/core/claude-auth.mjs
// "Did this Claude failure happen because the CLI is signed out?" — for the
// surfaces that only learn it after the spawn (Ask Worca, run overview, model
// Test). The CLI's own error text is not reliable: signed out, a first-party
// model id can fail as `[claude-code:unrecognized_model]` instead of "Not
// logged in". So a failed run on a model the CLI serves itself (not routed to
// an endpoint or the bridge) asks preflight's probeClaudeAuth, which is cheap
// (remembered 60 s) and says 'signed-out' only when `claude auth status` does.
import { isClaudeSignedOutError, probeClaudeAuth, claudeAuthFromEnv } from './preflight.mjs';
import { listModels, modelHasBaseUrlRouting, resolveModelEnv } from './config.mjs';
import { agentIdentity } from './agent-user.mjs';
import { configuredClaudeBin } from './onboarding.mjs';

/**
 * Whether a chat moving to Claude must be refused because the CLI is signed out (#943, POST
 * /api/ask/threads/:id/engine): only a definite 'signed-out' does. A relayed chat runs as the person's agent user, with
 * that user's own sign-in (turn.mjs _engineGate skips the check for it), and a model routed to an endpoint or the
 * bridge authenticates there (as failedBecauseSignedOut below), so neither asks the CLI's sign-in.
 * @param {{model?:string, relay?:boolean, mock?:boolean, bin?:string, probe?:typeof probeClaudeAuth, routed?:(model:string)=>boolean}} o
 *   `probe` / `routed` are injectable for tests.
 * @returns {Promise<boolean>}
 */
export async function claudeChatSignedOut({
  model, relay = false, mock, bin = configuredClaudeBin(), probe = probeClaudeAuth, routed = modelHasBaseUrlRouting,
} = {}) {
  try {
    if (relay || (model && routed(model))) return false;
    return (await probe({ bin, mock })).state === 'signed-out';
  } catch { return false; }
}

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

/** Would a Claude run in `dir` have nothing to call? Only a definite signed-out with no endpoint or provider model
 *  says yes (a run with an agent user signs in as that user). A remembered signed-out is re-read, so a run started
 *  right after /login is not refused. Never throws. */
export async function claudeRunSignedOut(dir) {
  try {
    if (agentIdentity()) return false;
    const bin = configuredClaudeBin();
    if ((await probeClaudeAuth({ bin })).state !== 'signed-out') return false;
    if ((await probeClaudeAuth({ bin, force: true })).state !== 'signed-out') return false;
    return !(await listModels(dir)).some((m) => m && !m.needsSignIn && modelHasBaseUrlRouting(m.id));
  } catch { return false; }
}

/**
 * Does `modelId` run on Claude Code without the CLI's own sign-in? Yes when it is routed to an endpoint or the bridge (as
 * failedBecauseSignedOut reads it), or when its model profile env signs the CLI in by itself: an API key or auth token, or
 * Bedrock / Vertex / Foundry (preflight's claudeAuthFromEnv, the keys `claude auth status` does not report). A company model
 * profile on Vertex is such a model. Never throws (a bridged model whose provider is not ready: false).
 * @param {string} modelId
 * @param {{routed?:(id:string)=>boolean, envOf?:(id:string)=>Record<string,string>|undefined}} [o] injectable for tests
 * @returns {boolean}
 */
export function claudeModelRunsSignedOut(modelId, { routed = modelHasBaseUrlRouting, envOf = resolveModelEnv } = {}) {
  try {
    if (typeof modelId !== 'string' || !modelId.trim()) return false;
    const env = envOf(modelId);
    if (routed(modelId)) return true;
    return !!(env && typeof env === 'object' && claudeAuthFromEnv(env));
  } catch { return false; }
}
