// src/shared/connections.mjs
// Harness ⟂ provider ⟂ model. A catalog model reaches its endpoint over a CONNECTION, and the harnesses that can
// run it follow from that connection — they are derived here, never declared:
//   signin    the harness's own sign-in (Claude Code login, ChatGPT for Codex, Cursor). A subscription belongs to
//             its harness, so the model runs there and nowhere else. The entry's `engine` names that harness.
//   env       routing env for Claude Code (ANTHROPIC_BASE_URL …): an Anthropic-format endpoint. Claude Code only.
//   provider  a provider worca knows (`upstream`: copilot / openai / anthropic over a wire protocol). Claude Code
//             reaches every one through worca's bridge; Codex reaches an OpenAI-compatible Responses endpoint
//             itself (engines/codex-endpoint.mjs). Copilot and Cursor take no endpoint.
// ONE source for the server and the browser (served as-is under /src/shared). Import-free but for engine-switch.
import { ENGINES, MODEL_ENGINE_NAMES, engineLabel } from './engine-switch.mjs';

export const PROVIDER_LABELS = Object.freeze({ copilot: 'GitHub Copilot', openai: 'OpenAI-compatible', anthropic: 'Anthropic-compatible' });
/** The name of each harness's own sign-in, as a provider. */
export const SIGNIN_LABELS = Object.freeze({ claude: 'Claude sign-in', codex: 'ChatGPT sign-in', cursor: 'Cursor sign-in', copilot: 'Copilot sign-in' });

const signinEngine = (m) => (m && MODEL_ENGINE_NAMES.includes(m.engine) ? m.engine : 'claude');

/** Whether Codex can connect to `upstream` itself: an OpenAI-compatible Responses endpoint, no OpenRouter routing
 *  (model-env.mjs codexUpstreamProblem holds the same rule for writes). */
export function codexReaches(upstream) {
  return !!upstream && upstream.provider === 'openai' && upstream.api === 'openai-responses' && !upstream.openrouter;
}

/**
 * The connection of a catalog entry (settings / plugin / policy shape: `upstream`, `env`) or of a composed catalog
 * row (`connection`, or `bridged` + `upstreamApi`, `routed`). Never throws.
 * @returns {{kind:'signin', engine:string} | {kind:'env'} | {kind:'provider', provider:string, api:string|null, codex:boolean, prefer:string}}
 */
export function connectionOf(m) {
  if (m && m.connection && typeof m.connection === 'object' && m.connection.kind) return m.connection;
  const up = m?.upstream && typeof m.upstream === 'object' ? m.upstream
    : (m?.bridged ? { provider: m.bridged, api: m.upstreamApi || null, openrouter: !!m.openrouter } : null);
  if (up && up.provider) return { kind: 'provider', provider: up.provider, api: up.api || null, codex: codexReaches(up), prefer: signinEngine(m) };
  if (m?.env && typeof m.env === 'object' && 'ANTHROPIC_BASE_URL' in m.env) return { kind: 'env' };
  if (m?.routed && !m?.bridged && signinEngine(m) === 'claude') return { kind: 'env' };
  return { kind: 'signin', engine: signinEngine(m) };
}

/** Every harness that can run the entry, in list order. A row the server composed carries them (`harnesses`). */
export function harnessesOf(m) {
  if (Array.isArray(m?.harnesses)) return m.harnesses;
  const c = connectionOf(m);
  if (c.kind === 'signin') return [c.engine];
  if (c.kind === 'env') return ['claude'];
  if (!c.codex) return ['claude'];
  return c.prefer === 'codex' ? ['codex', 'claude'] : ['claude', 'codex'];   // the entry's own engine first: its preferred harness
}

/** Can a run (or chat) on `engine` run the entry? A missing engine is Claude. */
export function runsOn(m, engine) {
  return harnessesOf(m).includes(engine || 'claude');
}

/** The provider an entry's tokens are billed to, for display: 'Claude sign-in', 'OpenAI-compatible', … */
export function connectionLabel(m) {
  const c = connectionOf(m);
  if (c.kind === 'signin') return SIGNIN_LABELS[c.engine] || `${engineLabel(c.engine)} sign-in`;
  if (c.kind === 'env') return 'Custom endpoint';
  return PROVIDER_LABELS[c.provider] || c.provider;
}

/** A stable key for "the same connection" (a usage limit spent on one is spent for every model on it). */
export function connectionKey(m) {
  const c = connectionOf(m);
  if (c.kind === 'signin') return `signin:${c.engine}`;
  if (c.kind === 'env') return `env:${String(m?.id || '').toLowerCase()}`;
  return `provider:${c.provider}`;
}

/** "Claude Code and Codex" — the harnesses that run an entry, in words. */
export function harnessesLabel(m) {
  const l = harnessesOf(m).map(engineLabel);
  return l.length < 2 ? (l[0] || '') : `${l.slice(0, -1).join(', ')} and ${l.at(-1)}`;
}

// Effort vocabularies per harness (model-env.mjs EFFORTS / CODEX_EFFORTS / CURSOR_EFFORTS; kept equal by a test).
export const HARNESS_EFFORTS = Object.freeze({
  claude: Object.freeze(['medium', 'high', 'xhigh', 'max']),
  codex: Object.freeze(['minimal', 'low', 'medium', 'high']),
  cursor: Object.freeze([]),
});

/** An effort picked in one harness's vocabulary, as the closest one `engine` takes, or null when it takes none.
 *  A model that runs on two harnesses keeps one effort list (its own engine's); the other harness gets the nearest. */
export function effortOn(effort, engine) {
  const list = HARNESS_EFFORTS[engine || 'claude'];
  if (!effort || !list) return effort || null;
  if (!list.length) return null;
  if (list.includes(effort)) return effort;
  const rank = { minimal: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };
  if (!(effort in rank)) return null;
  return list.reduce((best, e) => (Math.abs(rank[e] - rank[effort]) < Math.abs(rank[best] - rank[effort]) ? e : best), list[0]);
}

/** An entry's efforts as `engine` offers them (mapped, de-duplicated, in that harness's order). */
export function effortsOn(m, engine) {
  const list = HARNESS_EFFORTS[engine || 'claude'];
  if (!list) return Array.isArray(m?.efforts) ? [...m.efforts] : [];
  const own = Array.isArray(m?.efforts) ? m.efforts : [];
  const mapped = new Set(own.map((e) => effortOn(e, engine)).filter(Boolean));
  return list.filter((e) => mapped.has(e));
}

/** The harnesses by their product names, where a sentence names the CLI (the engine labels stay short: Claude). */
export const HARNESS_NAMES = Object.freeze({ claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', copilot: 'Copilot' });

/** A free catalog id for a model `upstreamId` reached through `provider` ('openai', 'copilot', 'anthropic', or 'gw' for a
 *  routing-env endpoint): the id is worca's handle, the upstream id is what the endpoint is sent. */
export function suggestModelHandle(upstreamId, provider = 'gw') {
  const base = String(upstreamId || '').trim().toLowerCase().replace(/[^a-z0-9._[\]-]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
  return `${provider || 'gw'}-${base}`;
}

/** "Runs on Claude Code and Codex — …" for the model editor: what a connection reaches, in words. */
export function runsOnText(connection) {
  const hs = harnessesOf({ connection });
  if (connection.kind === 'signin') return `Runs on ${HARNESS_NAMES[connection.engine] || engineLabel(connection.engine)} only — a subscription works in its own harness.`;
  if (connection.kind === 'env') return 'Runs on Claude Code only — the routing env is Claude Code\'s.';
  return hs.includes('codex')
    ? 'Runs on Claude Code (through worca\'s bridge) and Codex (directly).'
    : 'Runs on Claude Code, through worca\'s bridge. Codex reaches only an OpenAI-compatible Responses endpoint without OpenRouter routing.';
}

/** Engines that own catalog models, for pickers that group by harness. */
export const CONNECTION_ENGINES = MODEL_ENGINE_NAMES;
export { ENGINES };

/** Every model dropdown groups its models by connection — what a model signs in or spends with, the one grouping all
 *  pickers share: the engine's own sign-in first, then the other sign-ins, custom endpoints, then each provider.
 *  Inside a group the catalog order holds (built-ins newest first, then the user's in the order added). */
export function modelGroups(models, { engine = 'claude' } = {}) {
  const rank = (m) => { const c = connectionOf(m); return c.kind === 'signin' ? (c.engine === engine ? 0 : 1) : c.kind === 'env' ? 2 : 3; };
  const groups = new Map();
  for (const m of Array.isArray(models) ? models : []) {
    if (!m || typeof m.id !== 'string') continue;
    const label = connectionLabel(m);
    if (!groups.has(label)) groups.set(label, { label, rank: rank(m), models: [] });
    groups.get(label).models.push(m);
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label)).map(({ label, models: ms }) => ({ label, models: ms }));
}

/** Who added a model, as an option suffix (its group already says how it connects): "", " · team policy", " · <plugin>". */
export function modelSourceSuffix(m) {
  return m?.custom === 'policy' ? ' · team policy' : m?.custom === 'plugin' ? ` · ${m.plugin || 'plugin'}` : '';
}
