// ui/public/marketplace/installed-model.mjs — Pure data for the Installed tab (board 3.1) and the Remove dialogs
// (board 3.4). Rows may lack any P1 key: every reader defaults.
import { KIND_ORDER, KINDS, MIX, NONE, kindCounts } from './kinds.mjs';
import { needsReview } from '../../../src/shared/plugin-access.mjs';

const list = (v) => (Array.isArray(v) ? v : []);
const byName = (a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
const kindOne = (k) => (Object.hasOwn(KINDS, k) ? KINDS[k].one : String(k ?? ''));

/** The first seven characters of a sha; '' when there is none. */
export const sha7 = (s) => (typeof s === 'string' && s ? s.slice(0, 7) : '');

/** What a row shows as its version: the version, else the pinned sha7, else ''. */
export function versionOf(row) {
  return row?.version || sha7(row?.pinnedSha);
}

/** The update a row can take (P1 `latest`): { from, to, review } — review when the update asks for new access (L7). */
export function updateOf(row) {
  if (!row?.latest || row.linked) return null;
  const l = row.latest;
  return { from: versionOf(row), to: l.version || sha7(l.sha), review: needsReview(list(l.access)) };
}

/** An enabled plugin whose setup is not done yet (missing keys or no profile). */
export function needsSetup(row) {
  return row?.enabled !== false && row?.setup?.ok === false;
}

/** The problem chips of a row and the server's own text as lines. An API mismatch wins over Broken (one chip). */
export function problemsOf(row) {
  const chips = [];
  const lines = [];
  if (row?.apiMismatch) {
    chips.push({ key: 'api', label: 'Needs update', tone: 'warn' });
    if (row.apiMismatch.message) lines.push(String(row.apiMismatch.message));
  } else if (row?.broken) {
    chips.push({ key: 'broken', label: 'Broken', tone: 'bad' });
  }
  if (row?.pythonMissing) chips.push({ key: 'python', label: 'Python not found', tone: 'warn' });
  const ignored = list(row?.ignored);
  if (ignored.length) {
    chips.push({ key: 'ignored', label: `${ignored.length} ignored`, tone: 'bad' });
    for (const i of ignored) lines.push(`${i?.file}: ${i?.reason}`);
  }
  return { chips, lines };
}

/** Needs attention: updates, then needs setup, then problems; alphabetical inside each; one entry per reason. */
export function attention(plugins) {
  const rows = list(plugins).filter(Boolean).slice().sort(byName);
  return [
    ...rows.filter((r) => updateOf(r)).map((row) => ({ reason: 'update', row })),
    ...rows.filter((r) => needsSetup(r)).map((row) => ({ reason: 'setup', row })),
    ...rows.filter((r) => problemsOf(r).chips.length).map((row) => ({ reason: 'problem', row })),
  ];
}

/** The names "Update all" covers: rows with an update, alphabetical. */
export function updatable(plugins) {
  return list(plugins).filter((r) => updateOf(r)).map((r) => r.name).sort((a, b) => String(a).localeCompare(String(b)));
}

/** Counted kind words in KIND_ORDER: '1 task source', '2 models', '1 MCP server'. */
export function kindsMeta(source) {
  const counts = kindCounts(source);
  return KIND_ORDER.filter((k) => counts[k] > 0).map((k) => {
    const n = counts[k];
    const word = n === 1 ? KINDS[k].one : KINDS[k].many;
    const w = /^.[A-Z]/.test(word) ? word : word[0].toLowerCase() + word.slice(1);   // "MCP server" keeps its capitals
    return { kind: k, text: `${n} ${w}` };
  });
}

const OPEN = new Set(['missing', 'outdated', 'disabled', 'needs-setup']);

/** The Team policy card's rows: missing / outdated / disabled from the policy, ok + needs setup from the row join, blocked last. */
export function policyItems(scopes, plugins) {
  const rows = new Map(list(plugins).map((p) => [p?.name, p]));
  const out = [];
  for (const r of list(scopes?.requirements)) {
    let state = r?.state;
    if (state === 'ok') {
      if (!needsSetup(rows.get(r.name))) continue;
      state = 'needs-setup';
    }
    if (!OPEN.has(state)) continue;
    out.push({ name: r.name, state, minVersion: r.minVersion || null, marketplace: r.marketplace || '', config: r.config || null });
  }
  // The server lists one { name, home } per home that blocks a plugin: one row per name.
  const blocked = new Set();
  for (const b of list(scopes?.blockedPlugins)) {
    if (blocked.has(b?.name)) continue;
    blocked.add(b?.name);
    out.push({ name: b?.name, state: 'blocked', minVersion: null, marketplace: '', config: null });
  }
  return out;
}

const SUMMARY = [
  ['missing', (n) => `${n} missing`],
  ['outdated', (n) => `${n} outdated`],
  ['disabled', (n) => `${n} disabled`],
  ['needs-setup', (n) => (n === 1 ? '1 needs setup' : `${n} need setup`)],
  ['blocked', (n) => `${n} blocked`],
];

/** The card's meta: the non-zero counts per state, joined with ' · '. */
export function policySummary(items) {
  const all = list(items);
  return SUMMARY.map(([state, text]) => [all.filter((i) => i?.state === state).length, text])
    .filter(([n]) => n > 0).map(([n, text]) => text(n)).join(' · ');
}

/** The snapshot a policy row installs from: the hint matches marketplace id, name or url; else the first listing. */
export function findCatalogItem(catalog, name, hint) {
  const named = list(catalog).filter((it) => it?.name === name);
  if (hint) {
    const hit = named.find((it) => it.marketplace?.id === hint || it.marketplace?.name === hint || it.source?.repoUrl === hint);
    if (hit) return hit;
  }
  return named[0] || null;
}

const GOES_ID = {
  taskSources: (x) => x?.id, chatChannels: (x) => x?.id, models: (x) => x?.id, mcpServers: (x) => x?.name,
  agents: (x) => x?.key, scripts: (x) => x?.key, skills: (x) => x, workflows: (x) => x,
};

/** Remove › Goes away: one row per contribution of the installed inventory; counted rows when it is unknown. */
export function goesAway(inventory, source) {
  if (inventory) {
    return KIND_ORDER.flatMap((k) => list(inventory[k]).map((x) => ({ kind: k, text: KINDS[k].one, id: GOES_ID[k](x) ?? null })));
  }
  const counts = kindCounts(source);
  return KIND_ORDER.filter((k) => counts[k] > 0).map((k) => ({ kind: k, text: kindsMeta({ [k]: counts[k] })[0].text, id: null }));
}

/** Remove › Changes: one row per MCP set and per skill set, naming what each loses. */
export function removeChanges(row, inventory) {
  const servers = list(inventory?.mcpServers).map((s) => s?.name).filter(Boolean);
  const skills = list(inventory?.skills).map(String);
  const mcp = servers.length === 0 ? 'loses its servers with their values and secrets'
    : servers.length === 1 ? `loses the ${servers[0]} server with its values and secrets`
      : `loses the ${servers.join(', ')} servers with their values and secrets`;
  const skill = skills.length === 0 ? 'loses its skills'
    : skills.length === 1 ? `loses the ${skills[0]} skill`
      : `loses the ${skills.join(', ')} skills`;
  return [
    ...list(row?.mcpSets).map((set) => ({ set, text: mcp })),
    ...list(row?.skillSets).map((set) => ({ set, text: skill })),
  ];
}

/** A Blocked dialog row from one GET /api/plugins/:name/references row (SM11). */
export function usedByRow(ref) {
  const kind = ref?.contributionKind || 'workflows';
  const label = ref?.label ?? '';
  const n = Number(ref?.count) || 0;
  const detail = ref?.kind === 'model-selection' ? `${n} pipeline selection${n === 1 ? '' : 's'}`
    : ref?.kind === 'active-workflow' ? `active in ${label}`
      : ref?.kind === 'paused-run' ? `in paused run ${label}`
        : `in ${label}`;
  return { kind, title: ref?.contribution || label, meta: `${kindOne(kind)} · ${detail}`, href: ref?.href || null };
}

/** The Blocked dialog's one sentence. */
export function usedByNote(refs) {
  return list(refs).every((r) => r?.kind === 'model-selection') ? 'Clear those selections first.' : 'Clear those first.';
}

/** A leftover's tile: the kind of a snapshot that still lists the name; else none. */
export function leftoverIconKind(catalog, name) {
  return list(catalog).find((it) => it?.name === name)?.iconKind || 'none';
}

/** The glyph of an icon kind (a kind, 'mix' or anything else → none), for a neutral glyphTile. */
export function glyphOf(iconKind) {
  if (Object.hasOwn(KINDS, iconKind)) return KINDS[iconKind].glyph;
  return iconKind === 'mix' ? MIX.glyph : NONE.glyph;
}
