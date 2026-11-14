// ui/public/stillhet/live/market-map.mjs — Stillhet's Marketplace in the live kind (slice 8 D4): dev's GET /api/marketplaces
// and GET /api/plugins answers as the prototype's records (marketplace/marketplace.js `data`). The only place dev's field
// names are read. Pure: no fetch, no DOM. Dev's own kind helpers (ui/public/marketplace/kinds.mjs) are a dev screen
// module, which the import guard forbids, so the rules live here (D5–D7).
import { githubWebUrl } from '../../../../src/shared/plugin-access.mjs';

// D5: a plugin's kind is its first non-zero contribution in this order; [inventory key, kind, one, many, part name]
const KINDS = [
  ['taskSources', 'Task sources', 'A task source', 'task sources', 'Task source'],
  ['chatChannels', 'Chat channels', 'A chat channel', 'chat channels', 'Chat channel'],
  ['mcpServers', 'MCP servers', 'An MCP server', 'MCP servers', 'MCP server'],
  ['models', 'Models', 'A model', 'models', 'Model'],
  ['workflows', 'Workflows', 'A workflow', 'workflows', 'Workflow'],
  ['agents', 'Agents', 'An agent', 'agents', 'Agent'],
  ['scripts', 'Scripts', 'A script', 'scripts', 'Script'],
  ['skills', 'Skills', 'A skill', 'skills', 'Skill'],
];
const BRANDS = ['github', 'jira', 'slack', 'telegram', 'cloudflare', 'notion'];
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : '');
const itemName = (x) => (typeof x === 'string' ? x : str(x?.displayName) || str(x?.label) || str(x?.name) || str(x?.key) || str(x?.id));

/** The plugin's kind from its contribution counts (D5); a plugin with none lands on the last shelf. */
export function kindOf(counts = {}) {
  const k = KINDS.find(([key]) => Number(counts?.[key]) > 0);
  return k ? k[1] : 'Skills';
}
const countsOf = (inventory) => Object.fromEntries(KINDS.map(([key]) => [key, arr(inventory?.[key]).length]));

/** The one task source's or chat channel's display name when it has exactly one, else the plugin name. */
export function nameOf(entry, row) {
  const inv = entry?.inventory, one = [...arr(inv?.taskSources), ...arr(inv?.chatChannels)];
  return (one.length === 1 && str(one[0]?.displayName)) || str(entry?.name) || str(row?.name);
}

/** `brand-…` when a chat channel's platform or a task source's id names a known brand, else '' (the plug). */
export function brandOf(inventory) {
  const words = [...arr(inventory?.chatChannels).map((c) => str(c?.platform)), ...arr(inventory?.taskSources).map((s) => str(s?.id))].map((w) => w.toLowerCase());
  const b = BRANDS.find((x) => words.some((w) => w.includes(x)));
  return b ? `brand-${b}` : '';
}

function ago(at, now) {
  const t = Date.parse(at || '');
  if (!Number.isFinite(t)) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const n = (v, w) => `${v} ${w}${v === 1 ? '' : 's'} ago`;
  if (s < 3600) return n(Math.floor(s / 60), 'minute');
  if (s < 86400) return n(Math.floor(s / 3600), 'hour');
  return n(Math.floor(s / 86400), 'day');
}

/** A market as the prototype's record; `sha` is the 7-character short form (installs read the full one from `source`). */
export function marketOf(m, now = Date.now()) {
  const sha = str(m?.lastSync?.sha);
  return {
    id: str(m?.id), name: str(m?.name) || str(m?.id), url: str(m?.url).replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''), branch: str(m?.ref) || 'HEAD',
    sha: sha.slice(0, 7), synced: ago(m?.lastSync?.at, now), builtin: m?.builtin === true, webUrl: githubWebUrl(m?.url, sha) || null, error: str(m?.lastError?.message),
  };
}

// what it adds: one line per kind (`A task source: Jira`, `2 MCP servers`); each part by name when the names are known
function addsOf(inventory, counts) {
  const adds = [], parts = [];
  for (const [key, , one, many, part] of KINDS) {
    const n = Number(counts[key]) || 0, names = arr(inventory?.[key]).map(itemName).filter(Boolean);
    if (!n) continue;
    adds.push(n === 1 && names[0] ? `${one}: ${names[0]}` : n === 1 ? one : `${n} ${many}`);
    for (const x of names) parts.push([part, x]);
  }
  return { adds, parts };
}
const secretsOf = (inventory) => [...arr(inventory?.taskSources).flatMap((s) => arr(s?.secrets)), ...arr(inventory?.chatChannels).flatMap((c) => arr(c?.secrets)), ...arr(inventory?.modelSecrets).map((x) => str(x?.label) || str(x?.key))].filter(Boolean);

/** Dev's lists as the prototype's plugin records (D5–D7). `configs` maps an installed plugin's name to its
 *  GET /api/plugins/:name/config answer (its asks are those labels); without one the inventory's secret keys ask. */
export function pluginsOf(markets = [], rows = [], configs = {}) {
  const byName = new Map(arr(rows).filter((r) => r && r.name).map((r) => [r.name, r]));
  const offers = new Map();   // name → [{ market, entry }] in market order
  for (const m of arr(markets)) for (const e of arr(m?.plugins)) if (e?.name) { if (!offers.has(e.name)) offers.set(e.name, []); offers.get(e.name).push({ m, e }); }
  const names = [...offers.keys(), ...[...byName.keys()].filter((n) => !offers.has(n))];
  return names.map((name) => {
    const row = byName.get(name) || null, list = offers.get(name) || [];
    // the installed row's market wins, then the first market that offers it (D6)
    const pick = (row && list.find((o) => o.m.id === row.marketplace)) || list[0] || null;
    const entry = pick?.e || null, inv = entry?.inventory;
    const counts = inv ? countsOf(inv) : row?.contributions || {};
    const { adds, parts } = addsOf(inv, counts);
    const cfg = row ? configs?.[name] : null;
    const asks = cfg ? setupFieldsOf(cfg).map((f) => f.label) : secretsOf(inv);
    const repoUrl = row ? str(row.repo) : str(pick?.m?.url), sha = row ? str(row.pinnedSha) : str(pick?.m?.lastSync?.sha), subdir = row ? str(row.subdir) : str(entry?.subdir);
    const rec = {
      id: name, name: nameOf(entry, row) || name, brand: brandOf(inv), ver: str(row?.version) || str(entry?.version), kind: kindOf(counts),
      market: (row ? str(row.marketplace) : str(pick?.m?.id)) || 'linked',
      what: str(row?.description) || str(entry?.description), adds, asks, installed: !!row,
      needsSetup: !!row && row.setup?.ok === false,
      source: { repoUrl, sha, subdir, webUrl: githubWebUrl(repoUrl, sha, subdir) || null },
      row,
    };
    if (parts.length > 1) rec.parts = parts;
    if (row?.latest && str(row.latest.version)) rec.update = row.latest.version;
    return rec;
  });
}

/** The values Marketplace's set-up form asks for (D12): each task source's, chat channel's and the model secrets'
 *  required fields that are everyday, or still empty though advanced (dev's set-up state counts those too). A
 *  multi-profile source carries its profile (null: none yet, one is made first); with no field to ask, it asks for that
 *  first profile alone (`profileOnly`). */
export function setupFieldsOf(config) {
  if (!config || typeof config !== 'object') return [];
  const out = [];
  const setOf = (values, f) => { const v = values?.[f.key]; return f.secret === true ? v?.set === true : v !== undefined && v !== null && v !== ''; };
  const kept = (schema, values) => arr(schema).filter((f) => f && f.required === true && str(f.key)).map((f) => [f, setOf(values, f)]).filter(([f, set]) => f.advanced !== true || !set);
  for (const s of arr(config.sources)) {
    const id = str(s?.id), prof = s?.multiProfile ? { profile: s.profile || null } : {}, list = kept(s?.schema, s?.values);
    for (const [f, set] of list) out.push({ target: 'source', sourceId: id, ...prof, key: f.key, label: str(f.label) || f.key, secret: f.secret === true, set });
    if (!list.length && s?.multiProfile && !s.profile) out.push({ target: 'source', sourceId: id, profile: null, key: '', label: `A first profile for ${id}`, secret: false, set: false, profileOnly: true });
  }
  for (const c of arr(config.channels)) for (const [f, set] of kept(c?.schema, c?.values)) out.push({ target: 'channel', channelId: str(c.id), key: f.key, label: str(f.label) || f.key, secret: f.secret === true, set });
  // model secrets are required by dev's setup state (plugin-setup-state.mjs) though their schema says otherwise; the broker holds them when on
  if (config.models && !config.models.broker) for (const f of arr(config.models.schema)) if (str(f?.key)) out.push({ target: 'modelSecrets', key: f.key, label: str(f.label) || f.key, secret: true, set: setOf(config.models.values, f) });
  return out;
}

/** The one target a set-up field is saved with (one Save each, so a refusal changes nothing): its source, channel or the model secrets. */
export const setupGroupOf = (f) => (f.target === 'source' ? `source|${f.sourceId}` : f.target === 'channel' ? `channel|${f.channelId}` : 'modelSecrets');
/** That target in words, for its part of the form and its toasts. */
export const setupWhereOf = (f) => (f.target === 'source' ? `the ${f.sourceId} source` : f.target === 'channel' ? `the ${f.channelId} channel` : 'the model keys');

/** Dev's list answers unwrapped (GET /api/marketplaces, GET /api/plugins). */
export const marketsOf = (answer) => arr(answer?.marketplaces);
export const rowsOf = (answer) => arr(answer?.plugins);
/** The installed rows whose config is read with the list (D6): those with settings. */
export const configRowsOf = (answer) => rowsOf(answer).filter((r) => r?.name && r.hasSettings !== false);
