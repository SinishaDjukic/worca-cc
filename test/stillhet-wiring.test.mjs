// test/stillhet-wiring.test.mjs — plans/rail/stillhet-wiring.md has a row for every module with actions and every model file
// with seeded figures, each with a known status. A module that gains a RailWould call, or a model file that is added, with no row fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = path.join(ROOT, 'ui/public/stillhet');
const doc = readFileSync(path.join(ROOT, 'plans/rail/stillhet-wiring.md'), 'utf8');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sources = walk(SRC).map((p) => path.relative(ROOT, p)).filter((p) => p.endsWith('.js') && !/\/(components|graph)\.js$/.test(p));
const rows = doc.split('\n').filter((l) => l.startsWith('|') && /`ui\/public\/stillhet\//.test(l));
const rowFor = (file) => rows.find((r) => r.includes('`' + file + '`'));
const STATUS = /\|\s*(wire to|wired|wired \(partial\)|new: build it|new: built|add to the design first|not offered live)\s*\|/;

test('every module that calls RailWould has an action row with a known status', () => {
  const missing = sources.filter((f) => /RailWould\(/.test(readFileSync(path.join(ROOT, f), 'utf8')) && !/(adapter|demo-actions)\.js$/.test(f)).filter((f) => !rowFor(f));
  assert.deepEqual(missing, []);
});

test('every model file and the world have a figure row with a known status', () => {
  const missing = sources.filter((f) => /(-model|world)\.js$/.test(f)).filter((f) => !rowFor(f));
  assert.deepEqual(missing, []);
});

test('every row of the actions and figures tables carries a known status', () => {
  for (const r of rows) assert.match(r, STATUS, r.slice(0, 80));
});

// One row per action and per seeded figure (tools/stillhet-wiring.mjs).
const W = await import('../tools/stillhet-wiring.mjs');

test('phrasesOf: a RailWould literal with every ${…} read as …, a concatenation ends in …, a computed phrase is named', () => {
  assert.deepEqual(W.phrasesOf("RailWould(`open ${a.b} in a new tab`); RailWould('run ' + x); RailWould(say); RailWould(`x ${{ a: 1 }.a} y`)"),
    ['open … in a new tab', 'run …', '(a phrase built from data)', 'x … y']);
});

test('check: an action or a figure with no row is reported, and so is a row with a status outside the three', () => {
  const doc = '# x\n\n## Action rows\n\n| `a › open` | wire to | y |\n| `a › copy` | maybe | y |\n\n## Figure rows\n\n| `m › F.x` | new: build it | y |\n';
  const r = W.check(doc, ['a › open', 'a › copy', 'a › gone'], ['m › F.x', 'm › F.y']);
  assert.deepEqual(r.actions, ['a › gone']);
  assert.deepEqual(r.figures, ['m › F.y']);
  assert.deepEqual(r.badStatus, ['| `a › copy` | maybe | y |']);
});

test('the real wiring file has a row for every action and seeded figure, the named counts among them', async () => {
  const figures = await W.figureIds();
  for (const n of W.NAMED_FIGURES) assert.ok(figures.includes(n), n);
  assert.deepEqual(W.check(doc, W.actionIds(), figures), { actions: [], figures: [], badStatus: [] });
});

test('actionIds: every `would` action of the library\'s run-state flow is an action id, its {names} kept', () => {
  const lib = W.actionIds().filter((id) => id.startsWith('design-system/components/run-state.mjs › '));
  const src = readFileSync(path.join(ROOT, 'ui/public/design-system/components/run-state.mjs'), 'utf8');
  assert.equal(lib.length, new Set([...src.matchAll(/\bwould: '([^']*)'/g)].map((m) => m[1])).size);
  assert.ok(lib.includes('design-system/components/run-state.mjs › open {pr} on GitHub'));
  assert.ok(lib.includes('design-system/components/run-state.mjs › open Settings › Tasks › Budget'));
});

test('the bar, the bell, the sidebar, the profile menu, Pulse and the world are wired, with no "Would" and no partial row (the final check wired the last two)', () => {
  const live = doc.split('\n').filter((l) => /^\| `(bar|bell|sidebar|profile|pulse\/pulse\.js|pulse\/pulse-model\.js|shell\/world\.js) › /.test(l));
  assert.ok(live.length >= 30, 'the rows are read');
  for (const r of live) {
    assert.match(r, /^\| `[^`]+` \| wired( \(partial\))? \|/, r.slice(0, 90));
    assert.doesNotMatch(r, /Would/, r.slice(0, 90));
  }
  const partial = live.filter((r) => /\| wired \(partial\) \|/.test(r)).map((r) => r.match(/^\| `([^`]+)`/)[1]);
  assert.deepEqual(partial, []);
  for (const id of ['bell › the Needs you rows', 'profile › the usage rings per harness']) assert.ok(doc.includes('| `' + id + '` | wired |'), id);
  for (const id of ['live/live-adapter.mjs › every source and frame', 'live/live-map.mjs › the shapes', 'profile › the interface mode', 'profile › Keep awake', 'profile › Away']) assert.ok(doc.includes('| `' + id + '` | wired |'), id);
});

test('the wiring tool accepts wired and wired (partial)', () => {
  const doc = '# x\n\n## Action rows\n\n| `a › open` | wired | y |\n\n## Figure rows\n\n| `m › F.x` | wired (partial) | y |\n';
  assert.deepEqual(W.check(doc, ['a › open'], ['m › F.x']), { actions: [], figures: [], badStatus: [] });
});

test('Chat is wired (Step 9): its module rows, its figure row and every chat/… action row, with no "Would"; the capability table is there', () => {
  const rows = doc.split('\n').filter((l) => /^\| `(chat\/(conversation|chats-model)\.js › |ui\/public\/stillhet\/chat\/(conversation|chats-model)\.js`)/.test(l));
  assert.ok(rows.length >= 25, `the rows are read (${rows.length})`);
  for (const r of rows) {
    assert.match(r, /^\| `[^`]+` \|( [^|]+ \|)? wired \|/, r.slice(0, 90));
    assert.doesNotMatch(r.split(' | ').slice(2).join(' | '), /\bWould\b/, r.slice(0, 90));
  }
  assert.ok(doc.includes('| `chat/conversation.js › (a phrase built from data)` | wired |'));
  // owner direction d717d0286: no Chat capability row is dropped or deferred; each is wired or says why it is no dev capability
  const cap = doc.slice(doc.indexOf('## Chat capabilities'), doc.indexOf('\n## ', doc.indexOf('## Chat capabilities') + 5) >>> 0 || undefined);
  for (const r of cap.split('\n').filter((l) => l.startsWith('| ') && !/^\| (Dev capability|Dev card|Dev function) /.test(l))) {
    assert.doesNotMatch(r, /\| (dropped|add to the design first|new: build it)[^|]*\|\s*$/, r.slice(0, 90));
    assert.match(r, /\| (wired|not a dev capability|new: built)[^|]*\|\s*$/, r.slice(0, 90));
  }
  assert.match(doc, /\| Side chat beside a page \|[^\n]*\| wired: /);
  assert.match(doc, /\| Chat labels \|[^\n]*\| new: built: /, 'owner direction dc2f5d474: chat labels are built, not hidden');
});

test('Chat\'s capability table has no partial row, and every run-state row a chat card reaches (chat-live.mjs FLOW) is wired', async () => {
  const cap = doc.slice(doc.indexOf('## Chat capabilities'));
  const rows = cap.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Dev capability') && !l.startsWith('|---'));
  assert.ok(rows.length >= 25, `${rows.length} capability rows`);
  for (const r of rows) assert.doesNotMatch(r, /\| wired \(partial\)/, r.slice(0, 80));
  const { FLOW } = await import('../ui/public/stillhet/live/chat-live.mjs');
  const { actionFlow } = await import('../ui/public/design-system/components/run-state.mjs');
  // each `would` phrase whose label FLOW carries out, over every state the library knows
  const states = [...readFileSync(path.join(ROOT, 'ui/public/design-system/components/run-state.mjs'), 'utf8').matchAll(/^\s*'?([a-z][a-z-]*)'?: \{/gm)].map((m) => m[1]);
  const phrases = new Set();
  for (const st of states) { let f; try { f = actionFlow(st, { would: (p) => p }); } catch { continue; } for (const [label, e] of Object.entries(f || {})) if (FLOW[label] && e && typeof e.say === 'string' && e.would !== undefined) phrases.add(e.would); }
  assert.ok(phrases.size >= 6, `the phrases are read (${[...phrases].join('; ')})`);
  for (const ph of phrases) {
    const row = doc.split('\n').find((l) => l.startsWith(`| \`design-system/components/run-state.mjs › ${ph}\``));
    if (row) assert.match(row, /\| wired \|/, row.slice(0, 100));
  }
});

test('Tasks (slice 5): the capabilities table, the new sources built, and the rows this slice wired', () => {
  const at = doc.indexOf('## Tasks capabilities');
  assert.ok(at > 0, 'the Tasks capabilities table is there');
  const caps = doc.slice(at).split('\n').filter((l) => /^\| [A-Z]/.test(l) && !l.startsWith('| Capability'));
  assert.ok(caps.length >= 20, `one row per capability (${caps.length})`);
  for (const r of caps) assert.match(r, /\| (wired|new: built|not offered live) \|$/, r.slice(0, 80));
  for (const what of ['Raise the cap', 'Restart Build', 'Pause after this step', 'Merge PR', 'reviewers']) assert.ok(caps.some((r) => r.includes(what) && /new: built \|$/.test(r)), what);
  for (const id of ['shell/world.js › RailDemoState.task', 'runs/runs-list.js › open PR … on GitHub (it leaves Worca)']) assert.ok(doc.includes('| `' + id + '` | wired |'), id);
  assert.match(doc, /\| `ui\/public\/stillhet\/runs\/runs-list\.js` \| [^|]+ \| wired \|/);
});

// R-qa-13 (controller directions d027fd8b6 and d8357b0e2): no Tasks row stays `wire to`, `wired (partial)` or `new: build it`;
// a row the live kind does not draw says why, for the controller; the controls the direction names are each wired.
test('Tasks (slice 5): every Tasks row is wired, new: built, or not offered live with its reason; the named controls are wired', () => {
  const tasks = doc.split('\n').filter((l) => /^\| `(ui\/public\/stillhet\/runs\/|ui\/public\/stillhet\/centers\/|ui\/public\/design-system\/components\/run-state\.mjs`|runs\/|centers\/|design-system\/components\/run-state\.mjs › )/.test(l));
  assert.ok(tasks.length >= 60, `the Tasks rows are read (${tasks.length})`);
  for (const r of tasks) {
    assert.doesNotMatch(r, /\| (wire to|wired \(partial\)|new: build it) \|/, r.slice(0, 100));
    const m = /\| not offered live \| ([^|]*) \|$/.exec(r);
    if (m) assert.ok(m[1].trim().length > 40, `a row the live kind leaves out says why: ${r.slice(0, 100)}`);
  }
  const named = ['runs/run-page.js › open a terminal in the worktree', 'runs/run-page.js › run …', 'runs/run-page.js › open localhost:…', 'runs/run-page.js › check out on this machine and open a local copy',
    'runs/run-page.js › open the Sync log', 'runs/run-page.js › open the whole diff of the file', 'runs/run-page.js › download …', 'runs/run-page-model.js › RunCardModel.forms'];
  for (const id of named) assert.ok(doc.includes('| `' + id + '` | wired |'), id);
  const cap = doc.slice(doc.indexOf('## Tasks capabilities'));
  for (const what of ["A group's page", 'Terminal, actions, builtins', 'Presets', 'Switch model and Resume at', 'Move to group', 'The check-out diff and Try it']) {
    assert.match(cap, new RegExp('\\| ' + what.replace(/[()]/g, '\\$&') + '[^\\n]*\\| wired \\|'), what);
  }
});
