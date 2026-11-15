#!/usr/bin/env node
// tools/stillhet-no-demo.mjs — the static half of gate.no-demo (docs/rail/gate.md, B1.10). Lists every demo-answer site under
// ui/public/stillhet/ and every `wire to` row of plans/rail/stillhet-wiring.md, and checks each against its classification in
// test/fixtures/stillhet-no-demo-baseline.json (wired, refused, not-in-stillhet, prototype-only, offender). The offenders can
// only shrink: --update drops gone sites, refuses an unclassified one and refuses a new offender.
//   node tools/stillhet-no-demo.mjs            exit 1 on an unclassified, stale or badly evidenced site
//   node tools/stillhet-no-demo.mjs --list     every site with its class
//   node tools/stillhet-no-demo.mjs --update   lowers the baseline (the static part; the live list is printed by the test)
// A site id is `FILE › KIND › LABEL`, with ` #N` for the Nth site of the same file, kind and label: no line numbers.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { phrasesOf, rowsUnder, STATUS, WIRING } from './stillhet-wiring.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SRC = path.join(ROOT, 'ui/public/stillhet/');
export const BASELINE = path.join(ROOT, 'test/fixtures/stillhet-no-demo-baseline.json');
export const STRINGS = path.join(ROOT, 'test/fixtures/stillhet-demo-strings.json');
export const KINDS = ['would', 'act', 'demo-action', 'demo-row', 'wire-to'];
export const CLASSES = ['wired', 'refused', 'not-in-stillhet', 'prototype-only', 'offender'];
/** The rule ids a `not-in-stillhet` site may cite: each draws words only on live. */
export const NOT_LIVE_RULES = ['set.not-live', 'nav.not-live'];
/** The A2 batches an offender may be owned by. */
export const OWNERS = ['B1', 'B2', 'B5', 'B6', 'B8'];

const SEAM = new Set(['adapter.js', 'demo/demo-actions.js']);   // they answer the calls: they hold no site
const GENERATED = /(^|\/)(components|graph|today)\.js$/;
const COMMENT = /^\s*\/\//;
const DEMO_ROW = /sample:\s*true|only:\s*'demo'/;

// ` #N` for the Nth site of the same file, kind and label (N ≥ 2)
function numbered(list) {
  const seen = new Map();
  return list.map((s) => {
    const base = `${s.file} › ${s.kind} › ${s.label}`, n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { id: n > 1 ? `${base} #${n}` : base, ...s };
  });
}

/** The would, act and demo-row sites of one source file; `file` is relative to SRC. */
export function sitesOfText(file, src) {
  const out = [];
  if (!SEAM.has(file)) {
    for (const label of phrasesOf(src)) out.push({ file, kind: 'would', label });
    for (const m of src.matchAll(/RailAdapter\.(act|refuse)\(\s*/g)) {
      const lit = src.slice(m.index + m[0].length).match(/^(['"`])([^'"`]+)\1/);
      out.push({ file, kind: 'act', label: lit ? lit[2] : '(an id built from data)' });
    }
  }
  for (const line of src.split('\n')) {
    if (COMMENT.test(line) || !DEMO_ROW.test(line)) continue;
    out.push({ file, kind: 'demo-row', label: line.match(/\b(?:title|name):\s*(['"`])([^'"`]*)\1/)?.[2] || '(unnamed)' });
  }
  return numbered(out);
}

/** Every key of the `window.RailDemoActions` literal in demo/demo-actions.js but `would`. */
export function demoActionSites(src) {
  const sb = { window: {} };
  vm.runInNewContext(src, sb);
  return numbered(Object.keys(sb.window.RailDemoActions || {}).filter((k) => k !== 'would').map((label) => ({ file: 'demo/demo-actions.js', kind: 'demo-action', label })));
}

/** Every `wire to` row under every `## ` heading of the wiring doc, Dev surfaces and any later section included. */
export function wireToSites(doc) {
  const out = [];
  for (const [, heading] of doc.matchAll(/^## (.+)$/gm)) {
    for (const row of rowsUnder(doc, heading)) {
      if (row.match(STATUS)?.[1] !== 'wire to') continue;
      out.push({ file: 'stillhet-wiring.md', kind: 'wire-to', label: `${heading} › ${row.slice(3, row.indexOf('`', 3))}` });
    }
  }
  return numbered(out);
}

const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

/** Every site of the tree, sorted by id. */
export function scanSites(root = ROOT) {
  const src = path.join(root, 'ui/public/stillhet');
  const sites = [];
  for (const f of walk(src).filter((p) => /\.m?js$/.test(p))) {
    const rel = path.relative(src, f).split(path.sep).join('/');
    if (GENERATED.test(rel)) continue;
    const text = readFileSync(f, 'utf8');
    sites.push(...sitesOfText(rel, text));
    if (rel === 'demo/demo-actions.js') sites.push(...demoActionSites(text));
  }
  sites.push(...wireToSites(readFileSync(path.join(root, path.relative(ROOT, WIRING)), 'utf8')));
  return sites.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// the rule ids the docs define: the first backticked cell of each rules row in docs/rail/*.md
function ruleIds(root) {
  const dir = path.join(root, 'docs/rail');
  const ids = new Set();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    for (const m of readFileSync(path.join(dir, f), 'utf8').matchAll(/^\| `([a-z][\w-]*\.[\w.-]+)` \|/gm)) ids.add(m[1]);
  }
  return ids;
}

/** What one entry lacks of its class's evidence (§3.2), or '' when it has it. */
function problemOf(e, root, rules) {
  if (!e || !CLASSES.includes(e.class)) return `class must be one of ${CLASSES.join(', ')}`;
  if (typeof e.why !== 'string' || !e.why.trim()) return 'a non-empty why';
  if (e.class === 'wired' && !(typeof e.via === 'string' && e.via && existsSync(path.join(root, e.via)))) return 'wired needs `via`: an existing repo path';
  if (e.class === 'not-in-stillhet' && !(NOT_LIVE_RULES.includes(e.rule) && rules.has(e.rule))) return `not-in-stillhet needs \`rule\`: ${NOT_LIVE_RULES.join(' or ')}`;
  if (e.class === 'offender' && !(/^(F-[\w/-]+|B1\.10)$/.test(e.finding || '') && OWNERS.includes(e.owner))) return `offender needs \`finding\` (an F-… id or B1.10) and \`owner\` (${OWNERS.join(', ')})`;
  return '';
}

/** Sites with no entry, entries with no site, and entries that break their class's evidence rule. */
export function checkSites(sites, baseline, root = ROOT) {
  const ids = new Set(sites.map((s) => s.id)), entries = baseline.sites || {};
  const rules = ruleIds(root);
  return {
    unclassified: [...ids].filter((id) => !(id in entries)),
    stale: Object.keys(entries).filter((id) => !ids.has(id)),
    bad: Object.entries(entries).map(([id, e]) => ({ id, problem: problemOf(e, root, rules) })).filter((b) => b.problem),
  };
}

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
export const format = (baseline) => JSON.stringify({ sites: sortKeys(baseline.sites || {}), live: [...(baseline.live || [])].sort() }, null, 2) + '\n';

/**
 * The baseline lowered to today's sites: stale entries dropped, `live` kept. Refused when a site has no entry (a new site
 * is classified by hand) or when an offender is not one of `prev`'s (the committed baseline): the list only shrinks.
 */
export function update(sites, baseline, prev = baseline) {
  const entries = baseline.sites || {}, old = prev.sites || {};
  const refused = sites.map((s) => s.id).filter((id) => !(id in entries));
  for (const s of sites) if (entries[s.id]?.class === 'offender' && old[s.id]?.class !== 'offender') refused.push(s.id);
  if (refused.length) return { ok: false, refused };
  const kept = Object.fromEntries(sites.map((s) => [s.id, entries[s.id]]));
  return { ok: true, baseline: { sites: sortKeys(kept), live: baseline.live || [] } };
}

// the committed baseline (the one an --update may not grow), or the file itself outside git
function committed(fallback) {
  try { return JSON.parse(execFileSync('git', ['show', `HEAD:${path.relative(ROOT, BASELINE).split(path.sep).join('/')}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return fallback; }
}

export function main(argv = process.argv.slice(2)) {
  const sites = scanSites();
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { sites: {}, live: [] };
  if (argv.includes('--list')) {
    for (const s of sites) console.log(`${baseline.sites?.[s.id]?.class || 'unclassified'}\t${s.id}`);
    return 0;
  }
  if (argv.includes('--update')) {
    const r = update(sites, baseline, committed(baseline));
    if (!r.ok) { console.log('refused (classify by hand; an offender may not be added):'); for (const id of r.refused) console.log('  ' + id); return 1; }
    writeFileSync(BASELINE, format(r.baseline));
    console.log(`baseline: ${Object.keys(r.baseline.sites).length} sites`);
    return 0;
  }
  const { unclassified, stale, bad } = checkSites(sites, baseline);
  for (const id of unclassified) console.log('unclassified: ' + id);
  for (const id of stale) console.log('stale:        ' + id);
  for (const b of bad) console.log(`bad:          ${b.id}: ${b.problem}`);
  console.log(`${sites.length} sites · ${unclassified.length} unclassified · ${stale.length} stale · ${bad.length} bad`);
  return unclassified.length || stale.length || bad.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
