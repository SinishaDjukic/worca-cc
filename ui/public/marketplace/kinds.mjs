// ui/public/marketplace/kinds.mjs — the eight contribution kinds, the plugin icon rule (U7) and the kind / status
// tones of the Marketplace (CONTRACT §3.1, SM18, SM19). Pure: no fetch, no state; DOM only through the `doc` handed in.
import { icon, iconSvg } from '../icons.mjs';

export const KIND_ORDER = Object.freeze(['taskSources', 'chatChannels', 'mcpServers', 'models', 'agents', 'scripts', 'skills', 'workflows']);

export const KINDS = Object.freeze({
  taskSources: Object.freeze({ one: 'Task source', many: 'Task sources', tone: 'src', glyph: 'tray' }),
  chatChannels: Object.freeze({ one: 'Chat channel', many: 'Chat channels', tone: 'chat', glyph: 'chat' }),
  mcpServers: Object.freeze({ one: 'MCP server', many: 'MCP servers', tone: 'mcp', glyph: 'plug' }),
  models: Object.freeze({ one: 'Model', many: 'Models', tone: 'model', glyph: 'cube' }),
  agents: Object.freeze({ one: 'Agent', many: 'Agents', tone: 'agent', glyph: 'agent' }),
  scripts: Object.freeze({ one: 'Script', many: 'Scripts', tone: 'script', glyph: 'script' }),
  skills: Object.freeze({ one: 'Skill', many: 'Skills', tone: 'skill', glyph: 'skill' }),
  workflows: Object.freeze({ one: 'Workflow', many: 'Workflows', tone: 'wf', glyph: 'workflow' }),
});
export const MIX = Object.freeze({ many: 'Mixed', tone: 'mix', glyph: 'layers' });
export const NONE = Object.freeze({ many: 'Other', tone: 'none', glyph: 'none' });   // 'many' = the Browse group title
export const MKT = Object.freeze({ tone: 'mkt', glyph: 'bag' });                     // SM18: the marketplace tile
export const TILE_PX = Object.freeze({ sm: 30, md: 40, lg: 56 });
const GLYPH_PX = { sm: 16, md: 20, lg: 28 };
export const CHIP_TONES = Object.freeze(['n', 'ok', 'upd', 'warn', 'bad', 'off', 'built']);

const LANDING = {
  taskSources: { label: 'Pick it in New run', href: '#new' },
  chatChannels: { label: 'Chat notifications', href: '#settings/runs' },
  mcpServers: { label: 'Open in Connectors', href: '#connectors/servers' },
  models: { label: 'Open in Models', href: '#models' },
  agents: { label: 'Open in Workflows', href: '#workflows/agents' },
  scripts: { label: 'Open in Workflows', href: '#workflows/scripts' },
  skills: { label: 'Open in Connectors', href: '#connectors/skills' },
  workflows: { label: 'Open in Workflows', href: '#workflows' },
};
const IGNORED_KIND = { agents: 'agents', scripts: 'scripts', workflows: 'workflows' };   // ignored file's first segment → kind
const ACRONYMS = { pat: 'PAT', api: 'API', url: 'URL', id: 'ID', mcp: 'MCP', ssh: 'SSH' };
// Lookups over third-party keys ('constructor', 'toString') must never reach Object.prototype.
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);

/** Per-kind counts of an installed row (`contributions` minus its `ignored` agent/script/workflow files) or of a
 *  snapshot entry (`inventory` arrays); a missing kind is 0. */
export function kindCounts(source) {
  const src = source?.contributions ?? source?.inventory ?? source ?? {};
  const out = {};
  for (const k of KIND_ORDER) {
    const v = src[k];
    out[k] = Array.isArray(v) ? v.length : Number.isFinite(v) ? v : 0;
  }
  for (const item of Array.isArray(source?.ignored) ? source.ignored : []) {
    const k = own(IGNORED_KIND, String(item?.file ?? '').split('/')[0]);
    if (k) out[k] = Math.max(0, out[k] - 1);
  }
  return out;
}

/** U7: one kind → that kind, two or more → 'mix', nothing → 'none'. */
export function pluginIconKind(counts) {
  const present = KIND_ORDER.filter((k) => counts?.[k] > 0);
  return present.length === 1 ? present[0] : present.length ? 'mix' : 'none';
}

/** Any icons.mjs glyph on a tile tone: span.mk-mt.mk-mt-<size>.mk-t-<tone>[aria-hidden] > svg (16 / 20 / 28px). */
export function glyphTile(doc, glyph, tone, { size = 'md' } = {}) {
  const span = doc.createElement('span');
  span.className = `mk-mt mk-mt-${size} mk-t-${tone}`;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = iconSvg(glyph, GLYPH_PX[size]);
  return span;
}

/** The plugin icon of `iconKind` (a kind, 'mix', 'none' or 'mkt'). */
export function kindTile(doc, iconKind, opts = {}) {
  const d = KINDS[iconKind] ?? { mix: MIX, mkt: MKT }[iconKind] ?? NONE;
  return glyphTile(doc, d.glyph, d.tone, opts);
}

/** The one .badge chip (SM19): span.badge.mk-chip.mk-chip-<tone>, an optional 12px glyph first, then the text. */
export function chip(doc, tone, text, { icon: glyph = null } = {}) {
  const span = doc.createElement('span');
  span.className = `badge mk-chip mk-chip-${tone}`;
  if (glyph) span.append(icon(doc, glyph, 12));
  span.append(doc.createTextNode(String(text ?? '')));
  return span;
}

/** What a plugin adds, in words: 'Task source', '2 MCP servers', '2 agents · 1 skill · 1 workflow'; '' when nothing. */
export function addsSummary(counts) {
  const present = KIND_ORDER.filter((k) => counts?.[k] > 0);
  if (present.length === 1 && counts[present[0]] === 1 && (present[0] === 'taskSources' || present[0] === 'chatChannels')) {
    return KINDS[present[0]].one;
  }
  return present.map((k) => {
    const n = counts[k];
    const word = n === 1 ? KINDS[k].one : KINDS[k].many;
    return `${n} ${word.startsWith('MCP ') ? word : word.toLowerCase()}`;
  }).join(' · ');
}

/** The secrets a plugin asks for: one key in words ('Bot token', 'API key'), several counted ('2 tokens',
 *  '2 secrets'), none → null. */
export function secretsSummary(keys) {
  const list = [...new Set(Array.isArray(keys) ? keys.map(String) : [])];
  if (!list.length) return null;
  if (list.length > 1) return `${list.length} ${list.every((k) => /token$/i.test(k)) ? 'tokens' : 'secrets'}`;
  const words = list[0].replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/).filter(Boolean).map((w) => own(ACRONYMS, w.toLowerCase()) ?? w.toLowerCase());
  if (words.length) words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  return words.join(' ');
}

/** Where a kind shows up in worca once installed. */
export function landing(kind) {
  const l = own(LANDING, kind);
  return l ? { ...l } : null;
}
