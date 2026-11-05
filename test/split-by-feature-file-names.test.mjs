// test/split-by-feature-file-names.test.mjs — #919 mechanical names: route areas, CSS headings, markup ids; reruns give the same names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAMING_DEFAULTS, NameError, checkName, routeKeys, pathOf, routeFiles, slugWords, cssTitle, uniqueNames, markupName, nameProblems } from '../tools/split-by-feature/file-names.mjs';

const N = { minLines: 40, areaMinLines: 150, stopwords: ['the', 'a', 'an', 'and', 'of', 'for', 'to', 'in', 'on', 'with', 'at', 'is', 'by', 'one'], generic: NAMING_DEFAULTS.generic };
const u = (segment, path, lines, first, prefix = '/api') => ({ segment, keys: routeKeys(path, prefix), full: routeKeys(path), lines, first });
const sum = (us) => us.reduce((n, x) => n + x.lines, 0);

test('routeKeys keeps literal segments after /api/: params, wildcards and patterns are dropped', () => {
  assert.deepEqual(routeKeys('/api/ask/threads/:id/cards/:cardId'), ['ask', 'threads', 'cards']);
  assert.deepEqual(routeKeys('/api/run-groups'), ['run-groups']);
  assert.deepEqual(routeKeys('/api/runs/:id/artifact-raw/*'), ['runs', 'artifact-raw']);
  assert.deepEqual(routeKeys(''), []);
});

test('the area is the path segment after the feature prefix; the prefix itself is its own resource', () => {
  assert.deepEqual(routeKeys('/api/runs/:id/diff', '/api/runs'), ['diff']);
  assert.deepEqual(routeKeys('/api/runs/:id/pause', '/api/runs'), ['pause']);
  assert.deepEqual(routeKeys('/api/run-groups', '/api/run-groups'), ['run-groups']);
  assert.deepEqual(routeKeys('/api/runs/:id', '/api/runs'), ['runs']);
  assert.deepEqual(routeKeys('/api/mcp/servers/:id', '/api/mcp/'), ['servers']);
});

test('pathOf reads the first literal path of a route descriptor (an array: its first element; a regexp: none)', () => {
  assert.deepEqual(routeKeys(pathOf({ kind: 'array', value: [{ kind: 'string', value: '/api/sets/:id/skills' }] })), ['sets', 'skills']);
  assert.deepEqual(routeKeys(pathOf({ kind: 'string', value: '/api/runs/*' })), ['runs']);
  assert.deepEqual(routeKeys(pathOf({ kind: 'regexp', value: 'unknown' })), []);
});

test('an area over the cap splits off its largest sub-resource until the rest fits (no numbers)', () => {
  const units = [u(1, '/api/ask/threads', 600, 1, '/api/ask'), u(1, '/api/ask/threads/:id/cards', 665, 2, '/api/ask'), u(1, '/api/pinpoint', 300, 3, '/api/pinpoint')];
  const names = routeFiles('chat', units, { cap: 1000, ...N }).map((f) => [f.name, sum(f.units)]);
  assert.deepEqual(names, [['threads', 600], ['threads-cards', 665], ['pinpoint', 300]]);
});

test('names say what a file holds, never where it registers: no -before-, and the segment stays in the file list only', () => {
  const units = [u(0, '/api/runs', 300, 1, '/api/runs'), u(0, '/api/runs/:id/artifacts', 200, 2, '/api/runs'), u(1, '/api/runs/:id/publish', 400, 9, '/api/runs')];
  const files = routeFiles('runs', units, { cap: 1000, ...N });
  assert.deepEqual(files.map((f) => [f.segment, f.name]), [[0, 'runs'], [0, 'artifacts'], [1, 'publish']]);
  assert.ok(files.every((f) => !f.name.includes('-before-')));
});

test('naming.areas groups areas under one name (pause, resume and stop give control); a slashed key matches the literals after /api/', () => {
  const areas = { runs: { pause: 'control', resume: 'control', stop: 'control', 'history/pr': 'history' } };
  const units = [u(0, '/api/runs/:id/pause', 20, 1, '/api/runs'), u(0, '/api/runs/:id/resume', 30, 2, '/api/runs'), u(0, '/api/runs/:id/stop', 25, 3, '/api/runs'), u(0, '/api/runs', 400, 4, '/api/runs')];
  assert.deepEqual(routeFiles('runs', units, { cap: 1000, ...N, areas }).map((f) => [f.name, sum(f.units)]), [['control', 75], ['runs', 400]]);
  const h = [u(0, '/api/history/pr', 20, 1, '/api/history'), u(1, '/api/pr', 200, 2, '/api/pr')];
  assert.deepEqual(routeFiles('runs', h, { cap: 1000, ...N, areas: { runs: { 'history/pr': 'history', pr: 'pull-requests' } } }).map((f) => f.name), ['history', 'pull-requests']);
});

test('an unmapped area under areaMinLines joins the dominant area of its segment; a mapped one keeps its own file', () => {
  const units = [u(0, '/api/runs/:id/labels', 30, 1, '/api/runs'), u(0, '/api/runs', 300, 2, '/api/runs'), u(0, '/api/runs/:id/tags', 40, 3, '/api/runs')];
  assert.deepEqual(routeFiles('runs', units, { cap: 1000, ...N }).map((f) => [f.name, sum(f.units)]), [['runs', 370]]);
  assert.deepEqual(routeFiles('runs', units, { cap: 1000, ...N, areas: { runs: { tags: 'labels-and-tags', labels: 'labels-and-tags' } } }).map((f) => [f.name, sum(f.units)]),
    [['labels-and-tags', 70], ['runs', 300]]);
});

test('the cap is measured as the emitted file (head included), and a small area that would push the dominant over stays its own file', () => {
  const measure = (us) => sum(us) + 30;   // a 30-line import head
  const units = [u(0, '/api/runs', 968, 1, '/api/runs'), u(0, '/api/runs/:id/stop', 5, 2, '/api/runs')];   // alone 998 and 35; merged 1003
  assert.deepEqual(routeFiles('runs', units, { cap: 1000, ...N, measure }).map((f) => f.name), ['runs', 'stop']);
});

test('the namer throws instead of falling back: no area, one name in two segments, a generic name, a number', () => {
  assert.throws(() => routeFiles('mcp-servers', [{ segment: 3, keys: [], lines: 50, first: 1 }], { cap: 1000, ...N }), NameError);
  const two = [u(0, '/api/runs/:id/diff', 200, 1, '/api/runs'), u(1, '/api/runs/:id/diff/x', 200, 5, '/api/runs')];
  assert.throws(() => routeFiles('runs', two, { cap: 1000, ...N }), /area "diff" registers in segments 0 and 1/);
  assert.throws(() => routeFiles('runs', [u(0, '/api/runs/:id/shared', 200, 1, '/api/runs')], { cap: 1000, ...N }), /"shared" is generic/);
  assert.throws(() => routeFiles('runs', [u(0, '/api/runs/:id/x', 200, 1, '/api/runs')], { cap: 1000, ...N, areas: { runs: { x: 'part-two' } } }), /is generic \("part"\)/);
  for (const bad of ['chat-2', 'runs4', 'workspaces-two', 'misc', 'common-utils', 'report-this', 'document', 'other-things']) assert.throws(() => checkName(bad, N.generic, 'x'), NameError, bad);
  for (const ok of ['control', 'labels-and-tags', 'workspaces-shell', 'code-editor']) assert.equal(checkName(ok, N.generic, 'x'), ok);
  assert.throws(() => uniqueNames(['(only words in parentheses)'], N.stopwords), NameError);
  assert.throws(() => markupName('<!-- ==== -->', N), NameError);
});

test('an area over the cap with no next key is reported, not numbered', () => {
  const files = routeFiles('x', [u(1, '/api/big', 1200, 1)], { cap: 1000, ...N });
  assert.equal(files[0].name, 'big'); assert.equal(files[0].oversize, true);
});

test('CSS names: shortest unique prefix of >= 2 words; same input, same names', () => {
  const t = ['History detail: diff tab', 'History detail: diff comments', 'History detail: meta line', 'Self-hosted webfonts (Poppins)', 'The account corner and its menu'];
  const once = uniqueNames(t, N.stopwords);
  assert.deepEqual(once, ['history-detail-diff-tab', 'history-detail-diff-comments', 'history-detail-meta', 'self-hosted', 'account-corner']);
  assert.deepEqual(uniqueNames(t, N.stopwords), once);
});

test('CSS names: phase tokens are dropped; a heading left with fewer than 2 words takes the first comment line under its marker', () => {
  const chat = ['Chat P1: shell', 'Chat P2: Action cards', 'Chat P3: run card', 'Chat P4: run panel', 'Chat P5: artifacts', 'Chat P6: home'];
  assert.deepEqual(uniqueNames(chat.map((h) => cssTitle(h, '', N.stopwords)), N.stopwords),
    ['chat-shell', 'chat-action', 'chat-run-card', 'chat-run-panel', 'chat-artifacts', 'chat-home']);
  const mk = [['marketplace P3', '/* Plugin icons (U7, board 0.1): the kind colour lives only in this tile; */'],
    ['marketplace P4', '/* Plugin sheet, install mode (Review → Install → Set up → Done) and the shared Set up fields. */'],
    ['marketplace P5', '/* Installed tab (board 3.1): one column; each list is ONE card of divided rows */'],
    ['marketplace P6', '/* The installed plugin sheet (board 3.3) and the Update review sheet (board 3.2). */'],
    ['marketplace P7', '/* Marketplaces tab (board 4.1): one card per marketplace; */']];
  assert.deepEqual(uniqueNames(mk.map(([h, c]) => cssTitle(h, c, N.stopwords)), N.stopwords),
    ['plugin-icons', 'plugin-sheet', 'installed-tab', 'installed-plugin', 'marketplaces-tab']);
  assert.equal(cssTitle('Script wizard : step 1 and the workspace', '', N.stopwords), 'Script wizard : step 1 and the workspace', 'no phase token: unchanged');
  assert.equal(slugWords('buttons : one component, 3 sizes x 4 variants', N.stopwords).slice(0, 2).join('-'), 'buttons-component');
});

test('names are checked, never numbered: a collision, a bad name and a route area named index are problems', () => {
  assert.deepEqual(nameProblems(['ui/public/chat/chat-shell.css', 'ui/routes/runs/runs.mjs']), []);
  assert.match(nameProblems(['ui/public/x/run-page.css', 'ui/public/x/run-page.css']).join(), /name collision: ui\/public\/x\/run-page\.css/);
  assert.match(nameProblems(['ui/routes/runs/index.mjs']).join(), /bad name: ui\/routes\/runs\/index\.mjs/);
  assert.match(nameProblems(['ui/routes/runs/runs-artifact-raw-*.mjs']).join(), /bad name/);
});

test('markup names: data-view id, else dialog id minus -modal, else the marker words', () => {
  assert.equal(markupName('        <!-- ===== VIEW: STATISTICS ===== -->\n        <section class="view hidden" data-view="stats">', N), 'stats');
  assert.equal(markupName('    <dialog id="shipit-modal" class="modal">', N), 'shipit');
  assert.equal(markupName('       <!-- ===================== Main column: the top bar over the pages ===================== -->', N), 'main-column');
});
