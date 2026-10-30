// src/core/exec-env/credentials.mjs
// The model-credential owner (plans/core-protection-layer-design.md §4.2): resolveModelRoute decides, for one spawn,
// where its model calls go and what signs them — relayed (worca's model relay signs on the server), brokered (the CLI
// calls a broker slot with a spawn token), own (the engine's own login) or direct (a credential in worca's env, which
// the agent can read). Pure and sync: the harness gate, the server's 409 path (e2bPreflight) and readiness call it.
// Import-light on purpose (policy.mjs and every backend load it); the relay route itself is built by relay-route.mjs.
import { engineEntry } from '../../shared/engine-switch.mjs';
import { brokerEnabled, brokerSlotIds, brokerRefusalText } from '../broker-client.mjs';
import { copilotTokenProblem } from '../../broker/copilot-token.mjs';
export { brokerRefusalText };
/** The Copilot PAT rule, one copy (src/broker/copilot-token.mjs, Task 8.2): the relay and the broker both apply it. */
export { FINE_GRAINED_PAT_RE, copilotTokenProblem } from '../../broker/copilot-token.mjs';

const SECRET_NAME = /_(TOKEN|SECRET|KEY)$/;
const ANTHROPIC = 'https://api.anthropic.com';
const RESOLVED = Symbol('worca.resolvedModelRoute');
const filled = (v) => typeof v === 'string' && v.trim() !== '';
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const hostOf = (url) => { try { return url ? new URL(url).host : null; } catch { return null; } };

/** The credential of a sign-in mode: its one secret-named env name, or null (an own login, a config-only mode). */
export const modeCredential = (mode) => (mode && mode.kind !== 'own' ? mode.env.find((k) => SECRET_NAME.test(k)) ?? null : null);

/** Every credential name `engine` declares: its non-own modes' credentials plus its secret-named relay-owned names
 *  (COPILOT_PROVIDER_API_KEY, CURSOR_AUTH_TOKEN). childEnv, LEAK_KEYS, the guard test and C-CANARY read this list. */
export function credentialNamesOf(engine) {
  const e = engineEntry(engine);
  if (!e) return [];
  return [...new Set([...e.signIn.modes.map(modeCredential).filter(Boolean), ...e.env.relayOwned.filter((k) => SECRET_NAME.test(k))])];
}

/** Claude Code's sandbox credential from the server env: OAuth first (the user's chosen method). Remote only. */
export function modelCredential(env = process.env) {
  if (filled(env.CLAUDE_CODE_OAUTH_TOKEN)) return { CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN };
  if (filled(env.ANTHROPIC_API_KEY)) return { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY };
  return null;
}

const SANDBOX_PICK = Object.freeze({
  anthropic: { order: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
    problem: "Neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set in the worca server's environment; it stays on the server and signs the sandbox's model calls." },
  openai: { order: ['CODEX_API_KEY', 'OPENAI_API_KEY'],
    // A ChatGPT sign-in (codex login, ~/.codex/auth.json) holds a refresh token and calls ChatGPT's own hosts: worca
    // neither copies it into a sandbox nor relays it.
    problem: "Codex in a sandbox needs CODEX_API_KEY or OPENAI_API_KEY in the worca server's environment: worca signs its calls on the server. A ChatGPT sign-in (codex login) cannot be used in a sandbox." },
  copilot: { order: ['COPILOT_GITHUB_TOKEN'], check: (t) => copilotTokenProblem(t),
    problem: "COPILOT_GITHUB_TOKEN is not set in the worca server's environment; worca signs a sandbox's Copilot calls with it on the server (copilot login stays in this machine's keychain). Use a fine-grained personal access token (github_pat_…) with only the Copilot Requests permission." },
  cursor: { order: ['CURSOR_API_KEY'],
    problem: "CURSOR_API_KEY is not set in the worca server's environment; worca signs a sandbox's Cursor calls with it on the server (cursor-agent login stays in this machine's keychain)." },
});

/** The credential worca's relay signs `engine`'s sandbox calls with, from the SERVER env only: `{value, source}` or
 *  `{problem}` (never a value in it). Same contract and texts as before (policy.mjs re-exports it). */
export function engineCredential(engine, env = process.env) {
  const e = engineEntry(engine || 'claude');
  // An engine whose relay is per mode: the key of the mode the route resolver picks (with no step model, the first mode
  // whose key is set), from the same server env.
  if (e?.remote && e.relay?.perMode) {
    const d = resolveModelRoute({ engine, remote: true, serverEnv: env, broker: { on: false }, checkModel: false });
    if (d.refusal) return { problem: d.refusal };
    const mode = e.signIn.modes.find((m) => m.id === d.relayMode) ?? e.signIn.modes.find((m) => m.relay && filled(env[modeCredential(m)]));
    const source = modeCredential(mode);
    return { value: env[source].trim(), source };
  }
  const pick = e?.remote && e.relay ? SANDBOX_PICK[e.relay.upstream] : null;
  if (!pick) return { problem: `the ${engine} engine cannot run in a remote sandbox` };
  const source = pick.order.find((k) => filled(env[k]));
  if (!source) return { problem: pick.problem };
  const value = env[source].trim();
  const problem = pick.check?.(value);
  return problem ? { problem } : { value, source };
}

/** The mode an engine with a per-mode relay (catalog relay.perMode: Gemini CLI, Qwen Code, Goose, OpenCode) signs in
 *  with behind the relay or a broker slot, as the local spawn would pick it: the provider the step's model names
 *  (signIn.byModel), else the mode the CLI's own settings choose (`configured`), else the catalog order. `ok(mode)` says
 *  whether a mode can be used here (its credential is in the server env, or its broker slot exists). Returns
 *  `{mode}`, `{mode: null}` (no model to name a provider yet, and some mode is usable: readiness), or `{refusal}`. */
function perModeChoice(entry, { label, model, configured, ok, need, where }) {
  const slash = entry.signIn.byModel && model ? String(model).indexOf('/') : -1;
  const chosen = slash > 0 ? String(model).slice(0, slash) : configured;
  const relayable = entry.signIn.modes.filter((m) => m.kind !== 'own' && m.relay);
  const names = relayable.map((m) => m.id).join(', ');
  if (chosen != null) {
    const mode = entry.signIn.modes.find((m) => m.id === chosen) ?? null;
    const what = entry.signIn.byModel ? `${label}'s ${chosen} provider` : `${label}'s ${chosen} sign-in`;
    if (!mode || mode.kind === 'own' || !mode.relay) {
      return { refusal: `${what} cannot run ${where}: it would need ${mode?.kind === 'own' ? 'a sign-in that stays on this machine' : 'a credential worca cannot sign with there'}. ${where === 'in a sandbox' ? 'In a sandbox' : 'Under the broker'} worca signs ${label}'s ${entry.signIn.byModel ? 'providers' : 'sign-ins'} ${names}. Pick one of them, or pick Local.` };
    }
    return ok(mode) ? { mode } : { refusal: need(mode, what) };
  }
  const mode = relayable.find(ok);
  if (mode) return entry.signIn.byModel && !model ? { mode: null } : { mode };
  return { refusal: need(null, label) };
}

/** A mode's `requires` names that the step's own model fills (OPENAI_MODEL, GEMINI_MODEL, …): behind the relay or a
 *  broker slot the spawn names its model itself, so only the others must be in the server env. */
const requiredConfig = (mode) => (mode.requires || []).filter((k) => !/_MODEL$/.test(k));

/**
 * How one spawn of `engine` signs its model calls.
 * @param {{engine:string, remote?:boolean, serverEnv?:object, modelEnv?:object|null, model?:string|null,
 *   endpoint?:boolean, broker?:{on:boolean, slots?:string[]}, checkModel?:boolean}} o
 *   serverEnv: worca's env plus the run env locally, a RemoteExecEnv's `env` in a sandbox run; modelEnv: a Claude
 *   catalog model's env (under the broker: runViaBroker's slot URL + spawn token); endpoint: the codex model sits on
 *   its own endpoint (codex-endpoint.mjs hasCodexEndpoint); broker: whether the broker is on (default: worca's own
 *   process env — the broker is a property of the server, never of a sandbox env) and its slot ids;
 *   checkModel: false skips the needsModel refusals (the caller does not know the step's model); configured: the sign-in
 *   mode id the CLI's own settings choose (a local spawn of Gemini CLI, Qwen Code or Goose), which wins over the catalog
 *   order; on an engine whose model id names its provider (signIn.byModel), the step's model wins over both.
 * @returns {{kind:'relayed'|'brokered'|'own'|'direct', engine:string, signInMode:string|null, credential:string|null,
 *   source:'server'|'model'|'endpoint'|'broker'|'login'|null, slot:string|null, provider:string|null,
 *   models:string[], warning:string|null, refusal:string|null, relayMode:string|null}}
 *   signInMode: the catalog mode id childEnv keeps, or an undeclared id (relayed, brokered, model, endpoint) that keeps
 *   no credential of the engine (brokered: no model credential at all, D10); credential: the one env name the child
 *   keeps (direct/own), else null; relayMode: on an engine whose relay is per mode, the sign-in mode a relayed or
 *   brokered spawn is pointed for (its route, catalog `relay` on the mode), else null.
 */
export function resolveModelRoute({ engine, remote = false, serverEnv = process.env, modelEnv = null, model = null,
  endpoint = false, broker = null, checkModel = true, configured = null } = {}) {
  const name = engine || 'claude';
  const entry = engineEntry(name);
  const label = entry?.label ?? name;   // engineLabel reads ENGINES, not the test seam
  const b = broker || { on: brokerEnabled() };
  const slots = b.slots || brokerSlotIds();
  const out = { kind: null, engine: name, signInMode: null, credential: null, source: null, slot: null, provider: null,
    models: model ? [String(model)] : [], warning: null, refusal: null, relayMode: null };
  const done = (o) => Object.defineProperty({ ...out, ...o }, RESOLVED, { value: true });
  // An engine the catalog does not know (the mock adapter): nothing to decide; childEnv keeps its default (null mode).
  if (!entry) return done({ kind: 'own', signInMode: null });
  const upstream = entry.relay?.upstream ?? null;
  // Who serves the calls of a mode: the relay's upstream, else the mode's own provider, else the entry's.
  const providerOf = (mode) => upstream ?? mode?.provider ?? entry.provider ?? null;
  const brokerSlot = entry.signIn.modes.find((m) => m.kind !== 'own' && m.brokerSlot && slots.includes(m.brokerSlot))?.brokerSlot ?? null;
  const modelKey = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'].find((k) => filled(modelEnv?.[k])) ?? null;
  const modelBase = str(modelEnv?.ANTHROPIC_BASE_URL);
  const needsModel = checkModel && !!entry.relay?.needsModel && !model;

  // A codex model on its own endpoint carries its own key (the model catalog's): never the broker's, never the env's.
  if (endpoint) {
    if (b.on) return done({ kind: 'brokered', signInMode: 'endpoint', refusal: `the credential broker is on, and this ${label} model calls its own endpoint with a key worca holds; give the model a broker slot or pick another model` });
    return done({ kind: remote ? 'relayed' : 'direct', signInMode: 'endpoint', source: 'endpoint', provider: 'endpoint',
      credential: remote ? null : 'WORCA_CODEX_PROVIDER_KEY',
      warning: remote ? null : `${name} signs in with WORCA_CODEX_PROVIDER_KEY from this model's settings; the agent can read it. Use a sandbox or the credential broker to keep it out.` });
  }

  // An engine whose relay is per mode: the mode its step resolves to names the route and the broker slot.
  const perMode = (where, ok, need) => perModeChoice(entry, { label, model, configured, ok, need, where });
  const modeProvider = (mode) => (mode ? mode.provider ?? entry.provider ?? (entry.signIn.byModel ? mode.id : null) : null);
  const slotOk = (m) => !!m.brokerSlot && slots.includes(m.brokerSlot);
  // No mode with a slot here at all: the broker's one refusal (brokerEngineRefusal says the same at run start).
  const noSlot = (m, what) => (m && entry.signIn.modes.some(slotOk)
    ? `the credential broker is on, and ${what} has no broker slot; pick a model or sign-in that has one (${entry.signIn.modes.filter(slotOk).map((x) => x.id).join(', ')}), or turn the broker off`
    : brokerRefusalText(name));

  if (remote) {
    if (!entry.remote || !entry.relay) return done({ kind: 'relayed', signInMode: 'relayed', refusal: `the ${name} engine cannot run in a remote sandbox` });
    if (needsModel) return done({ kind: 'relayed', signInMode: 'relayed', refusal: `${label} in a sandbox needs a model; pick one for this step.` });
    if (entry.relay.perMode) {
      const c = b.on ? perMode('under the broker', slotOk, noSlot)
        : perMode('in a sandbox', (m) => { const k = modeCredential(m); return !!k && filled(serverEnv[k]) && requiredConfig(m).every((r) => filled(serverEnv[r])); },
          (m, what) => (m ? `${what} in a sandbox needs ${[modeCredential(m), ...requiredConfig(m)].filter((k) => !filled(serverEnv[k])).join(' and ')} in the worca server's environment: worca signs its calls there (a key the CLI stores itself stays on this machine). Set it, or pick Local.`
            : `${label} in a sandbox needs the key of one of its ${entry.signIn.byModel ? 'providers' : 'sign-ins'} (${entry.signIn.modes.filter((x) => x.kind !== 'own' && x.relay).map((x) => modeCredential(x)).join(', ')}) in the worca server's environment: worca signs its calls there. None is set.`));
      if (c.refusal) return done({ kind: 'relayed', signInMode: 'relayed', refusal: c.refusal });
      return done({ kind: 'relayed', signInMode: 'relayed', source: b.on ? 'broker' : 'server', slot: b.on ? c.mode?.brokerSlot ?? null : null,
        provider: modeProvider(c.mode), relayMode: c.mode?.id ?? null });
    }
    if (b.on) {
      // Claude under the broker: runViaBroker already put the slot URL and the spawn token (or a keyless bridge URL) in
      // the model env, and the relay signs with it. Other engines: the adapter takes a lease for `slot` (broker-lease.mjs).
      if (modelKey || modelBase) return done({ kind: 'relayed', signInMode: 'relayed', source: 'broker', provider: hostOf(modelBase) || upstream });
      if (brokerSlot) return done({ kind: 'relayed', signInMode: 'relayed', source: 'broker', slot: brokerSlot, provider: brokerSlot });
      return done({ kind: 'relayed', signInMode: 'relayed', refusal: brokerRefusalText(name) });
    }
    if (modelKey || modelBase) return done({ kind: 'relayed', signInMode: 'relayed', source: 'model', provider: hostOf(modelBase) || upstream });
    const cred = engineCredential(name, serverEnv);
    if (cred.problem) return done({ kind: 'relayed', signInMode: 'relayed', refusal: cred.problem });
    return done({ kind: 'relayed', signInMode: 'relayed', source: 'server', provider: upstream });
  }

  // Local.
  if (b.on) {
    if (needsModel) return done({ kind: 'brokered', signInMode: 'brokered', refusal: `${label} under the credential broker needs a model; pick one for this step.` });
    if (entry.relay?.perMode) {
      const c = perMode('under the broker', slotOk, noSlot);
      if (c.refusal) return done({ kind: 'own', signInMode: 'brokered', refusal: c.refusal });
      const mode = c.mode ?? entry.signIn.modes.find(slotOk);
      return done({ kind: 'brokered', signInMode: 'brokered', source: 'broker', slot: mode.brokerSlot, provider: modeProvider(mode), relayMode: mode.id });
    }
    // Claude: runViaBroker's model env (slot URL + spawn token, or a keyless loopback bridge) is the only credential;
    // signInMode 'brokered' makes childEnv drop every other model credential (as claude.mjs:579-582 did).
    if (modelKey || modelBase) return done({ kind: 'brokered', signInMode: 'brokered', source: 'broker', provider: hostOf(modelBase) || upstream });
    if (brokerSlot) return done({ kind: 'brokered', signInMode: 'brokered', source: 'broker', slot: brokerSlot, provider: brokerSlot });
    return done({ kind: 'own', signInMode: 'brokered', refusal: brokerRefusalText(name) });
  }
  // A catalog model with its own key (a gateway entry): that key, from the model's settings; no server credential.
  if (modelKey) return done({ kind: 'direct', signInMode: 'model', credential: modelKey, source: 'model', provider: hostOf(modelBase) || upstream,
    warning: `${name} signs in with ${modelKey} from this model's settings; the agent can read it. Use a sandbox or the credential broker to keep it out.` });
  // A catalog model on a third-party base URL with no key of its own: never the server's credential (as the relay
  // decides, relay-route.mjs remoteModelRoute), unless the server's own env names that same gateway.
  if (modelBase && hostOf(modelBase) !== hostOf(ANTHROPIC) && modelBase !== str(serverEnv.ANTHROPIC_BASE_URL)) {
    return done({ kind: 'direct', signInMode: 'model', source: 'model', provider: hostOf(modelBase) });
  }
  const direct = (mode, key) => done({ kind: 'direct', signInMode: mode.id, credential: key, source: 'server',
    provider: providerOf(mode) ?? (entry.signIn.byModel ? mode.id : null),
    warning: `${name} signs in with ${key} from worca's environment; the agent can read it. Use a sandbox or the credential broker to keep it out.` });
  // An engine whose model id names its provider (`provider/model`, catalog signIn.byModel: Goose) signs in to that
  // provider: its mode, as if the CLI's own settings chose it.
  const slash = entry.signIn.byModel && model ? String(model).indexOf('/') : -1;
  const named = slash > 0 ? String(model).slice(0, slash) : null;
  // The mode the CLI's own settings choose (Gemini CLI's and Qwen Code's security.auth.selectedType, the provider Goose
  // is configured with) is the one it signs in with, whatever else is set: only its credential is kept, and when worca's
  // env does not hold it (the CLI's own files do), none is. A setting the catalog does not name keeps none either.
  const chosen = named ?? configured;
  if (chosen != null) {
    const mode = entry.signIn.modes.find((m) => m.id === chosen) ?? null;
    const key = modeCredential(mode);
    if (key && filled(serverEnv[key])) return direct(mode, key);
    return done({ kind: 'own', signInMode: mode ? mode.id : String(chosen), source: 'login',
      provider: providerOf(mode) ?? (entry.signIn.byModel ? String(chosen) : null) });
  }
  for (const mode of entry.signIn.modes) {
    const key = modeCredential(mode);
    if (key && filled(serverEnv[key]) && (mode.requires || []).every((r) => filled(serverEnv[r]))) return direct(mode, key);
  }
  const own = entry.signIn.modes.find((m) => m.kind === 'own');
  return done({ kind: 'own', signInMode: own ? own.id : 'own', source: 'login', provider: providerOf(own) });
}

/** What a LOCAL spawn's sign-in is decided on: worca's own env plus the run env (`runEnv`, cleanRunEnv), which may carry
 *  a credential too. Read here, by the credential owner, never as a spawn env (that is childEnv's). */
export const localServerEnv = (runEnv = null) => ({ ...process.env, ...(runEnv || {}) });

/** True for resolveModelRoute's own result (RemoteExecEnv.openRoute refuses anything else). */
export const isResolved = (d) => !!(d && d[RESOLVED] === true);
