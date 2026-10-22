// ui/public/marketplace/catalog.mjs — the Browse catalogue model (CONTRACT §3.4): one item per snapshot plugin,
// its filters, groups, facet counts and the header's marketplace health. Pure: data in, data out.
import { KIND_ORDER, KINDS, MIX, NONE, kindCounts, pluginIconKind } from './kinds.mjs';
import { githubWebUrl } from '../../../src/shared/plugin-access.mjs';

const list = (v) => (Array.isArray(v) ? v : []);
const sha7 = (sha) => (typeof sha === 'string' && sha ? sha.slice(0, 7) : null);

/** The secret keys a snapshot entry asks for, deduped: task source and chat channel secrets, then model secrets. */
function secretsOf(inv) {
  return [...new Set([
    ...list(inv?.taskSources).flatMap((s) => list(s?.secrets)),
    ...list(inv?.chatChannels).flatMap((c) => list(c?.secrets)),
    ...list(inv?.modelSecrets).map((s) => s?.key),
  ].filter((k) => typeof k === 'string' && k))];
}

/** CatalogItem[] in the API's marketplace order, then snapshot order. `plugins` = the GET /api/plugins rows. */
export function buildCatalog(marketplaces, plugins) {
  const rows = new Map(list(plugins).map((r) => [r?.name, r]));
  return list(marketplaces).flatMap((m) => list(m?.plugins).filter((p) => typeof p?.name === 'string').map((p) => {
    const row = rows.get(p.name) ?? null;
    const sha = m.lastSync?.sha ?? null;
    const subdir = p.subdir ?? '';
    const counts = kindCounts(p);
    return {
      key: `${m.id}/${p.name}`,
      name: p.name,
      version: row?.version ?? p.version ?? sha7(sha) ?? null,
      description: typeof p.description === 'string' ? p.description : '',
      marketplace: { id: m.id, name: m.name ?? m.id, stale: !!m.lastError, snapshotAt: m.lastSync?.at ?? null },
      counts,
      iconKind: pluginIconKind(counts),
      secrets: secretsOf(p.inventory),
      installed: !!row || p.installed === true,
      row,
      update: row?.latest && row.latest.marketplace === m.id ? { version: row.latest.version ?? sha7(row.latest.sha) } : null,
      entry: p,
      source: { repoUrl: m.url ?? null, subdir, sha, webUrl: sha && m.url ? githubWebUrl(m.url, sha, subdir) : null },
    };
  }));
}

/** Search (name or description, case-insensitive, trimmed), Adds (a mixed plugin counts), From, Hide installed. */
export function filterCatalog(items, { q = '', adds = null, from = null, hideInstalled = false } = {}) {
  const needle = String(q ?? '').trim().toLowerCase();
  return list(items).filter((i) => (!needle || i.name.toLowerCase().includes(needle) || i.description.toLowerCase().includes(needle))
    && (!adds || i.counts[adds] > 0)
    && (!from || i.marketplace.id === from)
    && (!hideInstalled || !i.installed));
}

/** The Browse groups: the kinds in KIND_ORDER, then Mixed, then Other; empty groups dropped, item order kept. */
export function groupCatalog(items) {
  const title = (key) => KINDS[key]?.many ?? (key === 'mix' ? MIX.many : NONE.many);
  return [...KIND_ORDER, 'mix', 'none']
    .map((key) => ({ key, title: title(key), items: list(items).filter((i) => i.iconKind === key) }))
    .filter((g) => g.items.length);
}

/** The facet rail's counts: all items, items per kind (a mixed plugin counts in each of its kinds), per marketplace. */
export function facetCounts(items) {
  const kinds = Object.fromEntries(KIND_ORDER.map((k) => [k, 0]));
  const from = {};
  for (const i of list(items)) {
    for (const k of KIND_ORDER) if (i.counts[k] > 0) kinds[k] += 1;
    from[i.marketplace.id] = (from[i.marketplace.id] ?? 0) + 1;
  }
  return { all: list(items).length, kinds, from };
}

/** The header line (SM4): marketplaces whose lastError is set, and the oldest snapshot time. */
export function marketplaceHealth(marketplaces) {
  const ms = list(marketplaces);
  const times = ms.map((m) => m?.lastSync?.at).filter((at) => typeof at === 'string' && !Number.isNaN(Date.parse(at)));
  return {
    unreachable: ms.filter((m) => m?.lastError != null).length,
    syncedAt: times.reduce((a, b) => (a === null || Date.parse(b) < Date.parse(a) ? b : a), null),
  };
}

/** 'Sep 3' this year, 'Sep 3, 2025' another year, '' when not a date. */
export function shortDate(iso, now = Date.now()) {
  const d = new Date(typeof iso === 'string' ? iso : NaN);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}

/** A snapshot note without its manifest path prefix (SM5). */
export function noteText(note) {
  return String(note ?? '').replace(/^.*?worca-cc-plugin\.json: /, '');
}
