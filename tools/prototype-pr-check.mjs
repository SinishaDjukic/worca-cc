#!/usr/bin/env node
// tools/prototype-pr-check.mjs — the CI half of gate.prototype (docs/rail/gate.md), run by ci.yml's `prototype` job.
// A PR that changes today's UI (ui/public/ outside stillhet/ and design-system/, or a ui/routes/ or ui/server.mjs change
// that adds a route today's UI fetches) passes only when it also:
//   1. changes a file under ui/public/stillhet/, plans/rail/prototype/ or docs/rail/, or
//   2. adds or changes a `wire to` row with a why under `## Dev surfaces` in plans/rail/stillhet-wiring.md for each such file, or
//   3. carries the no-ui-change label and a "No UI change: …" line in its body.
//   node tools/prototype-pr-check.mjs --base origin/dev [--pr-json FILE]   (FILE: `gh pr view --json labels,body`)
// Exit 0 pass, 1 fail, 2 base or usage error. Only node: built-ins and tools/stillhet-*.mjs, so CI runs it without npm ci.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { surfaceRows } from './stillhet-wiring.mjs';
import { browserPaths, isTodaysUi, pathMatches } from './stillhet-surfaces.mjs';

export const PROTOTYPE_DIRS = ['ui/public/stillhet/', 'plans/rail/prototype/', 'docs/rail/'];
export const LABEL = 'no-ui-change';
export const BODY_LINE = /^[ \t]*No UI change:[ \t]*\S/m;
const WIRING = 'plans/rail/stillhet-wiring.md';
const ROUTES = 'tools/parity/route-classes.json';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// A file's text at a commit, or '' when the commit does not hold it.
const show = (cwd, rev, file) => { try { return git(cwd, 'show', `${rev}:${file}`); } catch { return ''; } };
const routePaths = (text) => Object.keys(text ? JSON.parse(text) : {}).map((k) => k.slice(k.indexOf(' ') + 1));

/** What the PR changed since its merge base with `base`: its files, the + lines of the wiring file, the routes it adds. */
export function gitDiff(root, base) {
  let mb;
  try { mb = git(root, 'merge-base', base, 'HEAD').trim(); } catch {
    throw { code: 'BASE', message: `Cannot read the PR's base ${base}: fetch it (actions/checkout fetch-depth: 2).` };
  }
  const files = git(root, 'diff', '--name-only', mb, 'HEAD').split('\n').filter(Boolean);
  const wiringAdded = new Set(git(root, 'diff', '-U0', mb, 'HEAD', '--', WIRING).split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)));
  const before = new Set(routePaths(show(root, mb, ROUTES)));
  const routesAdded = [...new Set(routePaths(show(root, 'HEAD', ROUTES)))].filter((p) => !before.has(p));
  return { files, wiringAdded, routesAdded };
}

const isRouteFile = (f) => f.startsWith('ui/routes/') || f === 'ui/server.mjs';
// Does a call of today's UI fetch this route? One-sided: a route's :name matches any call segment, but a call's :param
// matches only a route's :name, so a generic call (`/api/runs/${a}/${b}`) does not claim a server-only route.
const fetches = (call, route) => {
  const a = call.split('/'), b = route.split('/');
  return a.length === b.length && a.every((s, i) => s === b[i] || b[i].startsWith(':'));
};

/** The changed files that change today's UI; a route file is one only for an added route a call of today's UI matches. */
export function culprits({ files, routesAdded, calls }) {
  const out = files.filter(isTodaysUi).map((file) => ({ file }));
  for (const route of routesAdded) {
    if (!calls.some((c) => fetches(c, route))) continue;
    for (const file of files.filter(isRouteFile)) out.push({ file, route });
  }
  return out;
}

// Does a row's id name a culprit: the file itself, a folder at least one level below ui/public/ holding it, or its route.
const names = (id, c) => id === c.file
  || (id.endsWith('/') && id.split('/').filter(Boolean).length >= 3 && c.file.startsWith(id))
  || (c.route !== undefined && id.startsWith('route › ') && pathMatches(id.slice('route › '.length), c.route));

/** Pass or fail, in a fixed order: no-ui, prototype, label, wiring; else fail (label-without-line when the label lacks its line). */
export function decide({ culprits: cs, files, rows, wiringAdded, labels, body }) {
  if (!cs.length) return { ok: true, why: 'no-ui', uncovered: [] };
  if (files.some((f) => PROTOTYPE_DIRS.some((d) => f.startsWith(d)))) return { ok: true, why: 'prototype', uncovered: [] };
  const labelled = labels.includes(LABEL);
  if (labelled && BODY_LINE.test(body || '')) return { ok: true, why: 'label', uncovered: [] };
  const added = rows.filter((r) => wiringAdded.has(r.line) && r.status === 'wire to' && r.why);
  const uncovered = cs.filter((c) => !added.some((r) => names(r.id, c)));
  if (!uncovered.length) return { ok: true, why: 'wiring', uncovered: [] };
  return {
    ok: false, why: labelled ? 'label-without-line' : 'fail',
    uncovered: uncovered.map((c) => (rows.some((r) => names(r.id, c)) ? { ...c, hasRow: true } : c)),
  };
}

/** The failure, with every uncovered file and the three ways to pass. */
export function failureMessage(result) {
  const head = result.why === 'label-without-line'
    ? 'The no-ui-change label needs a "No UI change: …" line in the PR body that says why.'
    : "This PR changes today's UI but not the Stillhet prototype:";
  const lines = result.uncovered.map((c) => '  ' + c.file
    + (c.route ? ` (adds ${c.route}, which today's UI fetches)` : '')
    + (c.hasRow ? ' (it has a row: update its why in this PR)' : ''));
  const example = result.uncovered[0]?.file || 'ui/public/app.js';
  return [head, ...lines,
    'Add ONE of these:',
    '  1. The same change in ui/public/stillhet/, plans/rail/prototype/ or docs/rail/.',
    `  2. A row under "## Dev surfaces" in ${WIRING}, for each file above:`,
    `       | \`${example}\` | wire to | why it is not built in Stillhet yet |`,
    '     A folder id such as `ui/public/chat/` covers every file in it.',
    '  3. No visible effect (a refactor, a test-only change)? Add the `no-ui-change` label and a',
    '     "No UI change: what and why" line to the PR body, then re-run this job.',
    'Rule: gate.prototype in docs/rail/gate.md.'].join('\n');
}

const PASS = {
  'no-ui': "no change to today's UI",
  prototype: 'the prototype changes with it',
  wiring: 'a wire to row for each changed file',
  label: 'no-ui-change, with its "No UI change:" line',
};

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), out = console } = {}) {
  const arg = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
  const base = arg('--base'), prJson = arg('--pr-json');
  if (!base) { out.log('Usage: node tools/prototype-pr-check.mjs --base REF [--pr-json FILE]'); return 2; }
  let diff;
  try { diff = gitDiff(cwd, base); } catch (e) {
    if (e?.code !== 'BASE') throw e;
    out.log(e.message); return 2;
  }
  const pr = prJson ? JSON.parse(readFileSync(prJson, 'utf8')) : {};
  const result = decide({
    culprits: culprits({ ...diff, calls: browserPaths(cwd) }),
    files: diff.files,
    rows: surfaceRows(show(cwd, 'HEAD', WIRING)),
    wiringAdded: diff.wiringAdded,
    labels: (pr.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
    body: pr.body || '',
  });
  if (!result.ok) { out.log(failureMessage(result)); return 1; }
  out.log(`gate.prototype: pass (${result.why}): ${PASS[result.why]}.`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
