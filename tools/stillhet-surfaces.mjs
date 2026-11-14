#!/usr/bin/env node
// tools/stillhet-surfaces.mjs — the npm-test half of gate.prototype (docs/rail/gate.md): every Settings key
// (test/fixtures/settings-api-keys.json, pinned to GET /api/settings by test/settings-projects-root.test.mjs) and every
// path today's UI fetches has a row under `## Dev surfaces` in plans/rail/stillhet-wiring.md, or sits in the frozen
// baseline test/fixtures/stillhet-surfaces-baseline.json, which only shrinks (like tools/rail-gate.mjs).
// Ids: `setting › KEY`, `route › /api/path/:param`. Stillhet's own fetches (ui/public/stillhet/) have Action rows instead.
//   node tools/stillhet-surfaces.mjs            what has no row against the baseline; exit 1 on a new one or a bad row
//   node tools/stillhet-surfaces.mjs --list     every id
//   node tools/stillhet-surfaces.mjs --update   writes the lower set; it refuses one that gained an id
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SURFACE_STATUS, surfaceRows } from './stillhet-wiring.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const BASELINE = join(ROOT, 'test/fixtures/stillhet-surfaces-baseline.json');
export const SETTINGS_KEYS = join(ROOT, 'test/fixtures/settings-api-keys.json');
const WIRING = 'plans/rail/stillhet-wiring.md';
const EXT = /\.(mjs|js|html)$/;

/** Today's UI: ui/public/ except Stillhet (built side) and the design-system library. */
export function isTodaysUi(rel) {
  return rel.startsWith('ui/public/') && !rel.startsWith('ui/public/stillhet/') && !rel.startsWith('ui/public/design-system/');
}

// The index just past a JS string literal that starts at src[i] (a quote or a backtick, ${…} read with nesting).
function skipString(src, i) {
  const q = src[i]; let j = i + 1;
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\\') { j += 2; continue; }
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') { j = skipExpr(src, j + 2); continue; }
    j++;
  }
  return j + 1;
}

// The index just past the `}` that closes a ${ whose body starts at src[i].
function skipExpr(src, i) {
  let depth = 1, j = i;
  while (j < src.length && depth) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') { j = skipString(src, j); continue; }
    if (c === '{') depth++; else if (c === '}') depth--;
    j++;
  }
  return j;
}

/** Every `/api/…` string literal of a source text as a call path: ${…} → :param, no query or fragment, no trailing / or glued :param. */
export function callPathsOf(text) {
  const out = [];
  for (const m of text.matchAll(/['"`](?=\/api\/)/g)) {
    const q = m[0]; let j = m.index + 1, raw = '';
    while (j < text.length && text[j] !== q && text[j] !== '\n') {
      if (text[j] === '\\') { raw += text[j + 1]; j += 2; continue; }
      if (q === '`' && text[j] === '$' && text[j + 1] === '{') { raw += ':param'; j = skipExpr(text, j + 2); continue; }
      raw += text[j++];
    }
    let p = raw.replace(/[?#].*$/, '');
    while (/[^/]:param$/.test(p)) p = p.slice(0, -':param'.length);
    p = p.replace(/\/+$/, '');
    out.push(p);
  }
  return out;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

/** The sorted unique call paths of today's UI under root. */
export function browserPaths(root = ROOT) {
  const paths = new Set();
  for (const f of walk(join(root, 'ui/public'))) {
    if (!isTodaysUi(relative(root, f).split('\\').join('/'))) continue;
    for (const p of callPathsOf(readFileSync(f, 'utf8'))) paths.add(p);
  }
  return [...paths].sort();
}

/** Does a call path hit a route path? Same segment count; each segment equal, or a :name on either side. */
export function pathMatches(callPath, routePath) {
  const a = callPath.split('/'), b = routePath.split('/');
  return a.length === b.length && a.every((s, i) => s === b[i] || s.startsWith(':') || b[i].startsWith(':'));
}

/** Every surface id: `setting › KEY` for each fixture key, `route › PATH` for each of today's UI fetches; sorted. */
export function surfaceIds(root = ROOT) {
  const keys = JSON.parse(readFileSync(join(root, relative(ROOT, SETTINGS_KEYS)), 'utf8'));
  return [...keys.map((k) => `setting › ${k}`), ...browserPaths(root).map((p) => `route › ${p}`)].sort();
}

/** grew: ids with no row and not in the baseline; shrank: baseline ids no longer missing; badStatus: bad or repeated rows. */
export function compare(ids, doc, baseline) {
  const rows = surfaceRows(doc), have = new Set(rows.map((r) => r.id)), base = new Set(baseline);
  const missing = new Set(ids.filter((id) => !have.has(id)));
  const seen = new Set(), badStatus = [];
  for (const r of rows) {
    if (!SURFACE_STATUS.test(r.status) || !r.why || seen.has(r.id)) badStatus.push(r.line);
    seen.add(r.id);
  }
  return { grew: [...missing].filter((id) => !base.has(id)), shrank: baseline.filter((id) => !missing.has(id)), badStatus };
}

/** The lower baseline, or a refusal naming every id it would gain. */
export function nextBaseline(ids, doc, baseline) {
  const { grew } = compare(ids, doc, baseline);
  if (grew.length) return { ok: false, added: grew };
  const have = new Set(surfaceRows(doc).map((r) => r.id));
  return { ok: true, next: ids.filter((id) => !have.has(id)).sort() };
}

const json = (ids) => JSON.stringify(ids, null, 2) + '\n';

export function main(argv = process.argv.slice(2), { root = ROOT, baseline = BASELINE, out = console } = {}) {
  const ids = surfaceIds(root), doc = readFileSync(join(root, WIRING), 'utf8');
  if (argv.includes('--list')) { for (const id of ids) out.log(id); return 0; }
  if (argv.includes('--update')) {
    if (!existsSync(baseline)) {
      const have = new Set(surfaceRows(doc).map((r) => r.id));
      const seed = ids.filter((id) => !have.has(id));
      writeFileSync(baseline, json(seed));
      out.log(`Seeded ${relative(root, baseline)}: ${seed.length} ids with no row.`);
      return 0;
    }
    const r = nextBaseline(ids, doc, JSON.parse(readFileSync(baseline, 'utf8')));
    if (!r.ok) {
      out.log('Refused: the baseline only shrinks. Add a row under "## Dev surfaces" in plans/rail/stillhet-wiring.md for:');
      for (const id of r.added) out.log('  ' + id);
      return 1;
    }
    writeFileSync(baseline, json(r.next));
    out.log(`Wrote ${relative(root, baseline)}: ${r.next.length} ids with no row.`);
    return 0;
  }
  const { grew, shrank, badStatus } = compare(ids, doc, existsSync(baseline) ? JSON.parse(readFileSync(baseline, 'utf8')) : []);
  for (const id of grew) out.log('GREW ' + id);
  for (const id of shrank) out.log('shrank ' + id);
  for (const l of badStatus) out.log('bad row: ' + l.slice(0, 100));
  if (grew.length) out.log(`New surfaces: add a row under ## Dev surfaces in ${WIRING} (status wired, wire to or not offered live, and why).`);
  if (shrank.length) out.log('Lower the baseline in this change: node tools/stillhet-surfaces.mjs --update');
  if (badStatus.length) out.log('A Dev surfaces row needs one of wired, wire to, not offered live, a reason, and an id no other row has.');
  out.log(`${ids.length} surfaces; ${grew.length} new without a row, ${shrank.length} shrank, ${badStatus.length} bad rows`);
  return grew.length || badStatus.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
