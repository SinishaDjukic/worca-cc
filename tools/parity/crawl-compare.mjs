// tools/parity/crawl-compare.mjs — normalisation, control masks, A-vs-B comparison, coverage and the report (D3, D6).
const ID = [[/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>'], [/\bask_[0-9a-f]{8}\b/g, '<thread>'],
  [/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?\b/g, '<iso>'], [/\b1[6-9]\d{11}\b/g, '<epoch-ms>'],
  // client-made random ids (a dev-vs-dev smoke masked these): Ask suggestion ids and workflow graph node ids
  [/\bask-suggest-[a-z0-9]{8}\b/g, 'ask-suggest-<id>'], [/\bn_[a-z0-9]{8}\b/g, 'n_<id>'],
  // every server listens on its own free port, and it leaks into page text (a failed dynamic import names its URL)
  [/\b(127\.0\.0\.1|localhost):\d{2,5}\b/g, '$1:<port>']];
/** Ids and timestamps only (the request's normalisation); everything else that drifts is the control pass's job. */
export const normalizeLine = (l) => ID.reduce((s, [re, to]) => s.replace(re, to), l);
const byId = (recs) => new Map(recs.map((r) => [r.id, r]));
const domMap = (lines) => new Map(lines.map((l) => { const i = l.indexOf('\t'); return [l.slice(0, i), l.slice(i + 1)]; }));
const callKey = (n) => n.split(' ').slice(0, 2).join(' ');
/** The non-GET /api calls a plain load of a screen makes (History's POST /api/history/pr lookup): `mutated` ignores them. */
export const loadCalls = (net) => new Set(net.filter((n) => { const [m, p = ''] = n.split(' '); return m !== 'GET' && p.startsWith('/api/'); }).map(callKey));
/** A non-GET /api call the screen's own load does not make dirties the state (D8): the server restarts from the template. */
export const mutated = (net, load = new Set()) => net.some((n) => { const [m, p = ''] = n.split(' '); return m !== 'GET' && p.startsWith('/api/') && !load.has(callKey(n)); });

/** Every field where A1 and A2 (the same tree, twice) differ becomes a mask: { id, field, path?, key?, rect?, message? }. */
export function deriveMasks(a1, a2, { pngDiff = null } = {}) {
  const masks = []; const B = byId(a2);
  for (const r of a1) {
    const s = B.get(r.id);
    if (!s) { masks.push({ id: r.id, field: 'presence' }); continue; }
    const da = domMap(r.dom); const db = domMap(s.dom);
    for (const p of new Set([...da.keys(), ...db.keys()])) if (da.get(p) !== db.get(p)) masks.push({ id: r.id, field: 'dom', path: p });
    if (r.png !== s.png && pngDiff) { const rect = pngDiff(r.png, s.png); if (rect) masks.push({ id: r.id, field: 'png', rect }); }
    const na = new Set(r.net); const nb = new Set(s.net);
    for (const n of new Set([...na, ...nb])) if (na.has(n) !== nb.has(n)) masks.push({ id: r.id, field: 'net', key: n.split(' ').slice(0, 2).join(' ') });
    for (const m of new Set([...r.console, ...s.console])) if (r.console.includes(m) !== s.console.includes(m)) masks.push({ id: r.id, field: 'console', message: m });
  }
  for (const s of a2) if (!a1.some((r) => r.id === s.id)) masks.push({ id: s.id, field: 'presence' });
  return masks;
}

/** A (A1) vs one B. `pngDiff(hashA, hashB, rects)` → { pixels, diff } with masked rects ignored (crawl.mjs gives it). */
export function compareCrawls(a, b, masks, { pngDiff = null } = {}) {
  const m = (id, field) => masks.filter((x) => x.id === id && x.field === field);
  const diffs = []; const B = byId(b);
  for (const r of a) {
    const s = B.get(r.id);
    if (!s) { if (!m(r.id, 'presence').length) diffs.push({ id: r.id, field: 'presence', detail: 'missing in B' }); continue; }
    const skip = new Set(m(r.id, 'dom').map((x) => x.path));
    const da = domMap(r.dom); const db = domMap(s.dom);
    const bad = [...new Set([...da.keys(), ...db.keys()])].filter((p) => !skip.has(p) && da.get(p) !== db.get(p));
    if (bad.length) diffs.push({ id: r.id, field: 'dom', detail: `${bad.length} elements differ, first ${bad[0]}: A ${da.get(bad[0]) ?? '(none)'} · B ${db.get(bad[0]) ?? '(none)'}` });
    if (r.png !== s.png && pngDiff) { const d = pngDiff(r.png, s.png, m(r.id, 'png').map((x) => x.rect)); if (d.pixels) diffs.push({ id: r.id, field: 'png', detail: `${d.pixels} px`, diff: d.diff }); }
    const loose = new Set(m(r.id, 'net').map((x) => x.key));
    const key = (n) => (loose.has(n.split(' ').slice(0, 2).join(' ')) ? n.split(' ').slice(0, 2).join(' ') : n);
    const na = [...new Set(r.net.map(key))].sort(); const nb = [...new Set(s.net.map(key))].sort();
    if (na.join('\n') !== nb.join('\n')) diffs.push({ id: r.id, field: 'net', detail: `A only: ${na.filter((x) => !nb.includes(x)).join(', ') || '—'} · B only: ${nb.filter((x) => !na.includes(x)).join(', ') || '—'}` });
    const known = new Set([...r.console, ...m(r.id, 'console').map((x) => x.message)]);
    const fresh = s.console.filter((x) => !known.has(x));
    if (fresh.length) diffs.push({ id: r.id, field: 'console', detail: `${fresh.length} new console errors, first: ${fresh[0].slice(0, 160)}` });
  }
  for (const s of b) if (!a.some((r) => r.id === s.id) && !m(s.id, 'presence').length) diffs.push({ id: s.id, field: 'presence', detail: 'only in B' });
  return { pass: !diffs.length, diffs };
}

export function coverage({ registered, visits }) {
  const ok = new Set(visits.filter((v) => v.rendered).map((v) => v.route));
  return { registered: registered.length, visited: registered.filter((r) => ok.has(r)).length, unvisited: registered.filter((r) => !ok.has(r)) };
}

export const crawlSummary = (r) => `${r.coverage.screens} screens, ${r.coverage.routes.visited}/${r.coverage.routes.registered} routes, `
  + `${r.coverage.elements.found} elements found, ${r.coverage.elements.exercised} exercised, ${r.coverage.elements.skipped} skipped; `
  + `${r.masks.length} masks; ${r.comparisons.map((c) => `${c.label} ${c.diffs.length} diffs`).join(', ')}`;

const md = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').replace(/`/g, "'");
/** Record id `route|variant|flags|element|step` → its five parts. */
export const idParts = (id) => { const p = String(id).split('|'); return { route: p[0], variant: p[1], flags: p[2], element: p.slice(3, -1).join('|'), step: p.at(-1) }; };

/**
 * report.md: Coverage (screens, routes registered/visited + the unvisited/unfillable list, elements found / exercised /
 * skipped by reason), Masks (one row each: record, field, path/key/rect/message), per-B Differences (screen, variant,
 * flags, element, step, field, detail, diff image link).
 */
export function renderCrawlReport(r) {
  const c = r.coverage;
  const out = [`# Differential crawl — ${r.pass ? 'PASS' : 'FAIL'}`, '',
    `A \`${md(r.a.spec)}\` (tree ${r.a.tree ?? '—'}) vs ${r.bs.map((b) => `\`${md(b.spec)}\` (tree ${b.tree ?? '—'})`).join(', ')} · control ${r.control ? 'on' : 'OFF'} · ${r.minutes} min`, '',
    '## Coverage', '', `- Screens: ${c.screens}`, `- Routes: ${c.routes.visited}/${c.routes.registered} visited`,
    ...c.routes.unvisited.map((x) => `  - unvisited: \`${md(x)}\``), ...c.routes.unfillable.map((x) => `  - unfillable: \`${md(x)}\``),
    `- Elements: ${c.elements.found} found, ${c.elements.exercised} exercised, ${c.elements.skipped} skipped`,
    ...Object.entries(c.elements.byReason ?? {}).sort(([, a], [, b]) => b - a).map(([why, n]) => `  - ${md(why)}: ${n}`),
    ...(r.catalogueDiffs?.length ? ['', '## Route catalogue differences', '', ...r.catalogueDiffs.map((x) => `- ${md(x)}`)] : []),
    '', `## Masks (${r.masks.length}, from the control pass A1 vs A2)`, ''];
  if (r.masks.length) {
    out.push('| Record | Field | Where |', '|---|---|---|');
    for (const m of r.masks) out.push(`| \`${md(m.id)}\` | ${m.field} | ${md(m.path ?? m.key ?? (m.rect ? m.rect.join(',') : null) ?? m.message ?? '—')} |`);
  } else out.push('None.');
  for (const cmp of r.comparisons) {
    out.push('', `## Differences: ${md(cmp.label)} (${cmp.diffs.length})`, '');
    if (!cmp.diffs.length) { out.push('None.'); continue; }
    out.push('| Screen | Variant | Flags | Element | Step | Field | Detail | Diff |', '|---|---|---|---|---|---|---|---|');
    for (const d of cmp.diffs) {
      const p = idParts(d.id);
      out.push(`| \`${md(p.route)}\` | ${md(p.variant)} | ${md(p.flags)} | ${p.element ? `\`${md(p.element)}\`` : 'screen'} | ${md(p.step)} | ${d.field} | ${md(d.detail)} | ${d.diff ? `[png](${d.diff})` : '—'} |`);
    }
  }
  return `${out.join('\n')}\n`;
}
