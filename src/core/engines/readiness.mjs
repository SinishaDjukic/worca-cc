// src/core/engines/readiness.mjs
// Which run engines are ready now: each adapter's own run-start preflight (binary present, signed in), cached
// (engines/ready-cache.mjs) so a page or a pause asking twice spawns nothing new. Only the UI server's GET /api/engines
// calls this; the text surfaces read the cache and never spawn a preflight.
import { listEngines } from './index.mjs';
import { engineLabel } from '../../shared/engine-switch.mjs';
import { envFlag } from '../model-env.mjs';
import { cachedReadiness, storeReadiness } from './ready-cache.mjs';
import { probeClaudeAuth } from '../preflight.mjs';
import { brokerEngineRefusal } from '../broker-client.mjs';
import { listExecBackends } from '../exec-env/registry.mjs';
import { engineCredential } from '../exec-env/policy.mjs';
import { REMOTE_ENGINES } from '../../shared/exec-env.mjs';

/** Claude's readiness: its sign-in (claude auth status, cached; env keys and the broker count as signed in). Only a
 *  definite signed-out refuses — an unknown answer (an older CLI) reads as ready, as the run-start check treats it. */
async function claudeSignIn() {
  const a = await probeClaudeAuth({ bin: process.env.WORCA_CLAUDE_BIN || 'claude' });
  return a.state === 'signed-out' ? { refusal: 'Claude Code is not signed in — run claude, then /login' } : {};
}

/** Whether worca's model relay can sign `name`'s calls in a remote sandbox (the credential in the server env: no spawn),
 *  for each configured backend; null when no backend is configured or the engine runs locally only. */
function sandboxSignIn(name, { backends, env }) {
  if (!REMOTE_ENGINES.includes(name)) return null;
  const titles = backends().filter((b) => { try { return b.configured(env); } catch { return false; } }).map((b) => b.title);
  if (!titles.length) return null;
  const cred = engineCredential(name, env);
  return { titles, ready: !cred.problem, reason: cred.problem || null };
}

/**
 * Claude has no adapter preflight: its readiness is its sign-in (claudeSignIn), so a usage-limit pause never offers a
 * signed-out Claude.
 * Codex's preflight runs with its default sign-in check: codex models that all sit on their own endpoint may read
 * "not ready"; the resume menu still lists Codex and the run-start gate decides.
 * `mock` defaults to the server's own rule (WORCA_MOCK, else ORCH_MOCK; '0'/'false' off): `!!WORCA_MOCK` would call
 * WORCA_MOCK=0 a mock and miss ORCH_MOCK=1.
 * @param {{force?:boolean, now?:number, mock?:boolean, preflights?:Record<string,()=>Promise<object>>,
 *   backends?:()=>object[], env?:object}} [o]
 *   preflights: a test seam replacing adapters' preflight by name. mock: every engine ready, nothing spawned.
 *   backends, env: test seams for the sandbox sign-in (the registered remote backends, the server env).
 * @returns {Promise<Array<{name:string, label:string, ready:boolean, reason:string|null, broker?:true,
 *   sandbox?:{titles:string[], ready:boolean, reason:string|null}}>>}
 */
/** The engines this instance never starts, whatever their sign-in (the credential broker is on): no preflight, nothing
 *  spawned, so a page can ask on every load (GET /api/engine-locks). */
export function engineLocks(env = process.env) {
  return listEngines().filter((e) => e.name !== 'mock')
    .map((e) => ({ name: e.name, reason: brokerEngineRefusal(e.name, env) }))
    .filter((e) => e.reason).map((e) => ({ ...e, broker: true }));
}

export async function engineReadiness({ force = false, now = Date.now(), mock = envFlag('WORCA_MOCK', 'ORCH_MOCK'), preflights = {},
  backends = listExecBackends, env = process.env } = {}) {
  const hit = force ? null : cachedReadiness(now);
  if (hit) return hit;
  const list = await Promise.all(listEngines().filter((e) => e.name !== 'mock').map(async (e) => {
    // Before mock, as the run-start gate does: with the broker on, another engine never starts. `broker` lets a picker
    // tell this (an instance setting) from a sign-in the user can fix.
    const refusal = brokerEngineRefusal(e.name);
    if (refusal) return { name: e.name, label: engineLabel(e.name), ready: false, reason: refusal, broker: true };
    const check = preflights[e.name] || (e.name === 'claude' ? claudeSignIn : e.preflight);
    if (mock || typeof check !== 'function') return { name: e.name, label: engineLabel(e.name), ready: true, reason: null };
    let r;
    try { r = await check({}); } catch (err) { r = { warning: String(err?.message || err) }; }
    const sandbox = sandboxSignIn(e.name, { backends, env });
    return { name: e.name, label: engineLabel(e.name), ready: !r?.refusal, reason: r?.refusal || r?.warning || null, ...(sandbox ? { sandbox } : {}) };
  }));
  storeReadiness(list, now);
  return list;
}
