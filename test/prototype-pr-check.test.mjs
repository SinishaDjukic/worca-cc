// test/prototype-pr-check.test.mjs — the CI half of gate.prototype (docs/rail/gate.md): a PR that changes today's UI
// changes the prototype too, or adds a `wire to` row under `## Dev surfaces` for each changed file, or carries the
// no-ui-change label plus a "No UI change:" line (tools/prototype-pr-check.mjs). Pure decisions first, then temp git repos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { surfaceRows } from '../tools/stillhet-wiring.mjs';
import * as P from '../tools/prototype-pr-check.mjs';

// Never the real HOME's or the machine's git config (identity, signing, hooks).
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const wiring = (...rows) => '# w\n\n## Figure rows\n\n## Dev surfaces\n\n| Surface | Status | Where in Stillhet, or why not yet |\n|---|---|---|\n'
  + rows.map((r) => r + '\n').join('') + '\n## Opt-in\n';
const APP_ROW = '| `ui/public/app.js` | wire to | Settings not in Stillhet yet |';
const app = [{ file: 'ui/public/app.js' }];
// decide's input for a PR whose wiring file at HEAD holds `rows`, of which `added` are + lines of its diff.
const input = ({ culprits = app, files = ['ui/public/app.js'], rows = [], added = rows, labels = [], body = '' } = {}) =>
  ({ culprits, files, rows: surfaceRows(wiring(...rows)), wiringAdded: new Set(added), labels, body });

test('culprits: today\'s UI files, and route files that add a route today\'s UI fetches', () => {
  const files = ['src/x.mjs', 'ui/public/app.js', 'ui/public/stillhet/a.js', 'ui/routes/foo/foo.mjs', 'ui/server.mjs'];
  assert.deepEqual(P.culprits({ files, routesAdded: [], calls: [] }), [{ file: 'ui/public/app.js' }]);
  assert.deepEqual(P.culprits({ files, routesAdded: ['/api/foo/:id', '/api/bar'], calls: ['/api/foo/:param'] }), [
    { file: 'ui/public/app.js' }, { file: 'ui/routes/foo/foo.mjs', route: '/api/foo/:id' }, { file: 'ui/server.mjs', route: '/api/foo/:id' }]);
  // A generic call (`/api/runs/${a}/${b}`) does not claim a route's literal segment: a server-only route stays server-only.
  assert.deepEqual(P.culprits({ files: ['ui/server.mjs'], routesAdded: ['/api/runs/:id/new-thing'], calls: ['/api/runs/:param/:param'] }), []);
  assert.deepEqual(P.culprits({ files: ['ui/server.mjs'], routesAdded: ['/api/runs/:id/:name'], calls: ['/api/runs/:param/pause'] }),
    [{ file: 'ui/server.mjs', route: '/api/runs/:id/:name' }]);
});

test('decide: a `route › ` row with the npm gate\'s :param id covers the route of a route file', () => {
  const cs = [{ file: 'ui/server.mjs', route: '/api/foo/:id' }];
  const r = P.decide(input({ culprits: cs, files: ['ui/server.mjs'], rows: ['| `route › /api/foo/:param` | wire to | not in Stillhet yet |'] }));
  assert.deepEqual(r, { ok: true, why: 'wiring', uncovered: [] });
});

test('decide: no-ui when nothing in today\'s UI changed', () => {
  assert.equal(P.decide(input({ culprits: [], files: ['src/x.mjs', 'test/x.test.mjs'] })).why, 'no-ui');
});

test('decide: prototype when a prototype file changed too', () => {
  for (const f of ['ui/public/stillhet/a.js', 'plans/rail/prototype/a.html', 'docs/rail/a.md']) {
    assert.deepEqual(P.decide(input({ files: ['ui/public/app.js', f] })), { ok: true, why: 'prototype', uncovered: [] }, f);
  }
});

test('decide: wiring for an added wire-to row naming the file, or a folder row at least one level below ui/public/', () => {
  assert.equal(P.decide(input({ rows: [APP_ROW] })).why, 'wiring');
  const chat = [{ file: 'ui/public/chat/a.mjs' }];
  const r = P.decide(input({ culprits: chat, files: ['ui/public/chat/a.mjs'], rows: ['| `ui/public/chat/` | wire to | the chat cards |'] }));
  assert.deepEqual(r, { ok: true, why: 'wiring', uncovered: [] });
});

test('decide: fails for a wired row, an empty why, another file\'s id, or the folder ui/public/', () => {
  for (const row of ['| `ui/public/app.js` | wired | x |', '| `ui/public/app.js` | wire to |  |', '| `ui/public/other.js` | wire to | x |', '| `ui/public/` | wire to | everything |']) {
    const r = P.decide(input({ rows: [row] }));
    assert.equal(r.ok, false, row);
    assert.equal(r.why, 'fail', row);
  }
});

test('decide: an old row (not in this PR\'s diff) does not count, and the failure says to update its why', () => {
  const r = P.decide(input({ rows: [APP_ROW], added: [] }));
  assert.deepEqual(r, { ok: false, why: 'fail', uncovered: [{ file: 'ui/public/app.js', hasRow: true }] });
  assert.match(P.failureMessage(r), /ui\/public\/app\.js \(it has a row: update its why in this PR\)/);
});

test('decide: the label with a "No UI change:" line passes; the label alone fails, unless rows cover every file; the line alone is no escape', () => {
  assert.equal(P.decide(input({ labels: ['no-ui-change'], body: 'Summary\n\nNo UI change: rename only\n' })).why, 'label');
  const alone = P.decide(input({ labels: ['no-ui-change'], body: '' }));
  assert.deepEqual([alone.ok, alone.why], [false, 'label-without-line']);
  assert.match(P.failureMessage(alone), /^The no-ui-change label needs a "No UI change: …" line in the PR body that says why\./);
  assert.equal(P.decide(input({ labels: ['no-ui-change'], body: 'No UI change:   ' })).why, 'label-without-line');
  assert.equal(P.decide(input({ labels: ['no-ui-change'], body: '', rows: [APP_ROW] })).why, 'wiring');
  assert.equal(P.decide(input({ body: 'No UI change: x' })).why, 'fail');
});

test('failureMessage: every uncovered file, the route it adds, the three ways and the rule', () => {
  const m = P.failureMessage({ ok: false, why: 'fail', uncovered: [{ file: 'ui/public/app.js' }, { file: 'ui/routes/foo/foo.mjs', route: '/api/foo' }] });
  assert.match(m, /^This PR changes today's UI but not the Stillhet prototype:\n {2}ui\/public\/app\.js\n {2}ui\/routes\/foo\/foo\.mjs \(adds \/api\/foo, which today's UI fetches\)\n/);
  for (const s of ['Add ONE of these:', 'ui/public/stillhet/, plans/rail/prototype/ or docs/rail/', '## Dev surfaces', '| `ui/public/app.js` | wire to |',
    '`ui/public/chat/`', '`no-ui-change` label', 'No UI change: what and why', 'gate.prototype in docs/rail/gate.md']) assert.ok(m.includes(s), s);
});

// ---- temp repos: a base commit, then the PR's commit on top ----
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' }).trim();
function write(root, files) {
  for (const [f, text] of Object.entries(files)) { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), text); }
}
function repo(baseFiles, prFiles) {
  const root = mkdtempSync(join(tmpdir(), 'prototype-pr-check-'));
  git(root, 'init', '-q', '-b', 'main');
  write(root, { 'ui/public/app.js': "fetch('/api/x')\n", 'plans/rail/stillhet-wiring.md': wiring(), 'tools/parity/route-classes.json': '{"GET /api/x": {}}\n', ...baseFiles });
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base');
  const base = git(root, 'rev-parse', 'HEAD');
  write(root, prFiles);
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'pr');
  return { root, base };
}
async function run(r, extra = []) {
  const lines = [];
  const code = await P.main(['--base', r.base, ...extra], { cwd: r.root, out: { log: (s) => lines.push(String(s)) } });
  rmSync(r.root, { recursive: true, force: true });
  return { code, text: lines.join('\n') };
}
const APP_CHANGE = { 'ui/public/app.js': "fetch('/api/x')\nconsole.log(1)\n" };

test('main: a today\'s-UI change alone fails and names the file', async () => {
  const { code, text } = await run(repo({}, APP_CHANGE));
  assert.equal(code, 1);
  assert.match(text, /^ {2}ui\/public\/app\.js$/m);
});

test('main: the same change passes with a Stillhet file, or with a wire-to row added in the PR', async () => {
  let r = await run(repo({ 'ui/public/stillhet/x.js': '1\n' }, { ...APP_CHANGE, 'ui/public/stillhet/x.js': '2\n' }));
  assert.equal(r.code, 0); assert.match(r.text, /prototype/);
  r = await run(repo({}, { ...APP_CHANGE, 'plans/rail/stillhet-wiring.md': wiring(APP_ROW) }));
  assert.equal(r.code, 0); assert.match(r.text, /wiring/);
});

test('main: a row already on base does not count', async () => {
  const { code, text } = await run(repo({ 'plans/rail/stillhet-wiring.md': wiring(APP_ROW) }, APP_CHANGE));
  assert.equal(code, 1);
  assert.match(text, /update its why/);
});

test('main: the label and the line from --pr-json pass', async () => {
  const r = repo({}, APP_CHANGE);
  const pr = join(r.root, '..', `pr-${process.pid}.json`);
  writeFileSync(pr, JSON.stringify({ labels: [{ name: 'no-ui-change' }], body: 'No UI change: a comment only' }));
  try {
    const { code, text } = await run(r, ['--pr-json', pr]);
    assert.equal(code, 0); assert.match(text, /label/);
  } finally { rmSync(pr, { force: true }); }
});

test('main: a PR adding a route today\'s UI fetches fails and names the route file and the path; an unfetched one passes', async () => {
  const route = { 'tools/parity/route-classes.json': '{"GET /api/foo": {}, "GET /api/x": {}}\n', 'ui/routes/foo/foo.mjs': "router.get('/api/foo')\n" };
  let r = await run(repo({ 'ui/public/a.mjs': "fetch('/api/foo')\n" }, route));
  assert.equal(r.code, 1);
  assert.match(r.text, /ui\/routes\/foo\/foo\.mjs \(adds \/api\/foo, which today's UI fetches\)/);
  r = await run(repo({}, route));
  assert.equal(r.code, 0); assert.match(r.text, /no-ui/);
});

test('main: an unknown base exits 2 and names fetch-depth', async () => {
  const r = repo({}, APP_CHANGE);
  const lines = [];
  const code = await P.main(['--base', 'no-such-ref'], { cwd: r.root, out: { log: (s) => lines.push(s), error: (s) => lines.push(s) } });
  rmSync(r.root, { recursive: true, force: true });
  assert.equal(code, 2);
  assert.match(lines.join('\n'), /Cannot read the PR's base no-such-ref: fetch it \(actions\/checkout fetch-depth: 2\)\./);
});
