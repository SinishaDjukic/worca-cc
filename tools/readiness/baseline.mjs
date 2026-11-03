// tools/readiness/baseline.mjs — #919 slice 3: the numbers the report compares, dev vs migrated.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { lineCount } from '../split-by-feature/css.mjs';
import { codeLineCounts } from '../split-by-feature.mjs';

export function conflictShare(rows, key) {
  const total = rows.length; const conflicted = rows.filter((r) => r[key].conflict).length;
  return { conflicted, total, pct: total ? Math.round((conflicted / total) * 1000) / 10 : 0 };
}
export const fmtShare = (s) => `${s.conflicted}/${s.total} (${s.pct}%)`;

/** ui/server.mjs plus every ui/routes/**.mjs of one tree (the indexes too), as { path, text }. */
export function codeFiles(dir) {
  const files = [{ path: 'ui/server.mjs', text: readFileSync(join(dir, 'ui/server.mjs'), 'utf8') }];
  const routes = join(dir, 'ui/routes');
  if (existsSync(routes)) {
    for (const f of readdirSync(routes, { recursive: true }).map((n) => String(n).split('\\').join('/')).filter((n) => n.endsWith('.mjs')).sort()) {
      files.push({ path: `ui/routes/${f}`, text: readFileSync(join(routes, f), 'utf8') });
    }
  }
  return files;
}

const DECL = /^(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=)/gm;
const IDENT = /(?<![\w$.])[A-Za-z_$][\w$]*/g;
/** Top-level names that occur once (their declaration) across the files: a heuristic, the same on both trees (D11). */
export function deadCode(files) {
  const counts = new Map();
  for (const f of files) for (const m of f.text.matchAll(IDENT)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  const dead = [];
  for (const f of files) for (const m of f.text.matchAll(DECL)) { const n = m[1] ?? m[2]; if ((counts.get(n) ?? 0) <= 1) dead.push({ name: n, path: f.path }); }
  return dead.sort((a, b) => (a.path + a.name < b.path + b.name ? -1 : 1));
}

/** Boot and page-load medians from a parity report.json (a = dev, b = migrated). */
export function parityTimings(report) {
  const row = (t) => ({ dev: t.a, migrated: t.b, deltaPct: t.deltaPct, pass: t.pass });
  return { gated: report.timingGated, boot: row(report.timings.boot),
    pages: Object.fromEntries(Object.entries(report.timings.pages).map(([p, t]) => [p, row(t)])) };
}

// A generated area file or part: the feature is its folder (ui/routes/FEATURE/AREA.mjs, ui/public/FEATURE/PART.css|html).
const OWNED = /^ui\/(?:routes\/([a-z0-9-]+)\/(?!index\.mjs$)[a-z0-9-]+\.mjs|public\/([a-z0-9-]+)\/[a-z0-9-]+\.(?:css|html))$/;

/** The feature names a split plan writes files for, from their folders; the route indexes are wiring, not a feature's. */
export function featureNames(files) {
  const names = new Set();
  for (const [p, t] of files) {
    if (t === null) continue;
    const m = p.match(OWNED);
    if (m) names.add(m[1] ?? m[2]);
  }
  return [...names].sort();
}

/** Files and lines each feature receives, from the split plan's files map. */
export function movedByFeature(files, names) {
  const rows = [];
  for (const f of names) {
    const mine = [...files].filter(([p, t]) => { const m = t !== null && p.match(OWNED); return !!m && (m[1] ?? m[2]) === f; }).map(([p, t]) => ({ path: p, lines: lineCount(t) })).sort((a, b) => (a.path < b.path ? -1 : 1));
    if (mine.length) rows.push({ feature: f, files: mine, lines: mine.reduce((s, x) => s + x.lines, 0) });
  }
  return rows;
}

/** The n longest code files under `rel`, from the size-cap walk (vendored files, minified bundles and fonts skipped). */
export function largestFiles(dir, n = 10, rel = 'ui') {
  return Object.entries(codeLineCounts(dir)).filter(([p]) => p.startsWith(`${rel}/`)).map(([path, lines]) => ({ path, lines }))
    .sort((a, b) => b.lines - a.lines || (a.path < b.path ? -1 : 1)).slice(0, n);
}
