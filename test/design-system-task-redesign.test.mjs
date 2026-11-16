// test/design-system-task-redesign.test.mjs — the task redesign's library parts: the stage train (StageBar), the
// open-line fold (StagePart), DiffView, what a card that asks shows (TaskCard's asks), a proposal's labelled rows, the
// busy words, and the one slow breath of every running sign.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { stageBar, stagePart, kindMark, taskCard, taskProposal, changeProposal, button } from '../ui/public/design-system/components/index.mjs';
import { diffView, paired, numbered, hunkStart, parsePatch } from '../ui/public/design-system/components/diff-view.mjs';
import { busyWord } from '../ui/public/design-system/components/button.mjs';

const dom = (html) => new JSDOM(`<body>${html}</body>`).window.document.body;
const STAGES = ['Plan', 'Build', 'Review', 'PR', 'Merged'];

test('the stage train: a knot a stage, each name under its knot, the current one named with its step', () => {
  const d = dom(stageBar({ labels: STAGES, stage: 2, tone: 'run', step: [2, 3] }));
  const knots = [...d.querySelectorAll('.sl-knot')], names = [...d.querySelectorAll('.sb-labels > *')];
  assert.equal(knots.length, 5); assert.equal(names.length, 5);
  assert.deepEqual(knots.map((k) => k.style.left), ['10%', '30%', '50%', '70%', '90%'], 'a knot stands over the middle of its name');
  assert.deepEqual(knots.map((k) => (k.classList.contains('is-done') ? 'done' : k.classList.contains('is-now') ? 'now' : 'next')), ['done', 'done', 'now', 'next', 'next']);
  assert.equal(d.querySelector('.sb-labels > b').textContent, 'Review2 of 3');
  assert.equal(d.querySelector('.sl-base').style.left, '10%', 'the line runs from the first knot to the last');
});

test('the stage train says where the task is in words, for a screen reader', () => {
  const says = (o) => dom(stageBar({ labels: STAGES, ...o })).querySelector('.stage-bar');
  assert.equal(says({ stage: 2, tone: 'run' }).getAttribute('aria-label'), 'Stage 3 of 5: Review, working');
  assert.equal(says({ stage: 1, tone: 'fail' }).getAttribute('aria-label'), 'Stage 2 of 5: Build, failed');
  assert.equal(says({ stage: 2, tone: 'ask' }).getAttribute('aria-label'), 'Stage 3 of 5: Review, asks you');
  assert.match(says({ stage: 4, tone: 'merged' }).getAttribute('aria-label'), /^All 5 stages done: merged$/);
  assert.equal(says({ stage: 2 }).getAttribute('role'), 'group');
  assert.equal(says({ stage: 2 }).querySelector('.sl').getAttribute('aria-hidden'), 'true', 'the drawing is not read twice');
});

test('the stage train: with a hook each stop is a real button with a name; the current one is aria-current="step"', () => {
  const d = dom(stageBar({ labels: STAGES, stage: 2, tone: 'ask', step: [1, 3], open: 2, knot: (i, l) => ({ 'data-stage-line': l.toLowerCase() }) }));
  const stops = [...d.querySelectorAll('button.sb-stop')];
  assert.equal(stops.length, 5);
  assert.equal(stops[1].getAttribute('aria-label'), 'Build: done, open its details');
  assert.equal(stops[2].getAttribute('aria-label'), 'Review: step 1 of 3, asks you, open its details');
  assert.equal(stops[4].getAttribute('aria-label'), 'Merged: not started, open its details');
  assert.deepEqual(stops.map((s) => s.getAttribute('aria-current')), [null, null, 'step', null, null]);
  assert.deepEqual(stops.map((s) => s.getAttribute('aria-expanded')), ['false', 'false', 'true', 'false', 'false'], 'on a page: which stage is open under the train');
  assert.equal(stops[0].dataset.stageLine, 'plan');
  // on a card a stop opens the task's page at that stage: no aria-expanded, its own words
  const card = dom(stageBar({ labels: STAGES, stage: 0, does: 'open the task at this stage', knot: () => ({}) }));
  assert.equal(card.querySelector('.sb-stop').getAttribute('aria-label'), 'Plan: working, open the task at this stage');
  assert.equal(card.querySelector('.sb-stop').hasAttribute('aria-expanded'), false);
  // with no hook, nothing looks pressable
  assert.equal(dom(stageBar({ labels: STAGES, stage: 0 })).querySelector('button'), null);
});

test('the stage train: done is ink, never green; a state colours only the stop it is on', () => {
  const css = readFileSync('ui/public/stillhet/css/stillhet.css', 'utf8') + readFileSync('ui/public/stillhet/runs/task.css', 'utf8');
  assert.match(css, /\.sl-knot\.is-done\{background:var\(--ink-2\)/);
  assert.doesNotMatch(css, /\.s[lb]-[a-z-]+[^{}]*\{[^}]*var\(--green/, 'no green in the train');
  assert.match(css, /\.stage-bar\.is-fail \.sb-stop\.is-now\{color:var\(--red-ink\)/);
  assert.match(css, /\.stage-bar:is\(\.is-ask,\.is-act\) \.sb-stop\.is-now\{color:var\(--amber-ink\)/);
  assert.match(css, /\.rd-route-dot\.is-done[^{]*\{color:var\(--ink\)/, 'a done step is ink, not a green ring');
  const metas = dom(stageBar({ labels: ['a', 'b'], stage: 1, metas: ['1h 34m', ''] }));
  assert.equal(metas.querySelector('.sb-meta').textContent, '1h 34m', 'a stage can carry its time under its name');
});

test('the running sign: at least 16px, one slow breath of 4s, nothing faster, still under reduced motion', () => {
  assert.match(kindMark({ kind: 'task', tone: 'run', size: 12 }), /--km:16px/);
  assert.match(kindMark({ kind: 'task', tone: 'ask', size: 12 }), /--km:12px/, 'only the running mark is held to 16px');
  const css = readFileSync('ui/public/stillhet/css/stillhet.css', 'utf8'), own = readFileSync('ui/public/stillhet/runs/task.css', 'utf8');
  assert.match(css, /\.kind-mark\.is-run\{color:var\(--ink\);animation:sl-breath 4s ease-in-out infinite;\}/);
  assert.match(css, /\.rc-rail:has\(> \.kind-mark\.is-run\) ~ \.rc-word\{color:var\(--ink\);\}/, 'the state word of a running task is full ink');
  for (const m of (css + own).matchAll(/(\.(?:kind-mark|git-mark|sl-step|sl-knot|btn-knot|sc-cell|rd-route-dot|status-dot)[^{}]*)\{[^}]*animation:[a-z-]+ ([\d.]+)s[^;}]*infinite/g)) assert.ok(+m[2] >= 4, `${m[1]} breathes no faster than 4s (${m[2]}s)`);
  assert.match(css + own, /@media \(prefers-reduced-motion: reduce\)\{[^}]*\.kind-mark\.is-run[^}]*\{animation:none;\}/);
});

test('the open-line fold: a hairline from the words to the chevron, closed and open; what it opens hangs on it', () => {
  const shut = dom(stagePart({ label: 'Changes', says: '5 files +358 −144', attrs: { 'data-tab': 'changes' } }));
  const b = shut.querySelector('button.stage-part-b');
  assert.equal(b.getAttribute('aria-expanded'), 'false');
  assert.deepEqual([...b.children].map((c) => c.tagName), ['B', 'SPAN', 'I', 'svg'], 'its name, what is inside, the line, the chevron');
  assert.ok(b.querySelector('i.sp-rule[aria-hidden="true"]'));
  const open = dom(stagePart({ label: 'Changes', open: true, body: '<p id="in">files</p>' }));
  assert.equal(open.querySelector('.sp-open > button').getAttribute('aria-expanded'), 'true');
  assert.ok(open.querySelector('.sp-open > button .sp-rule'), 'the line stays while it is open');
  assert.equal(open.querySelector('.sp-open > .sp-body > #in').textContent, 'files');
  assert.equal(open.querySelector('.sp-open > button b').textContent, 'Changes', 'the words do not change; the chevron turns');
  assert.equal(dom(stagePart({ label: 'Changes', body: '<p>x</p>' })).querySelector('.sp-body'), null, 'closed: nothing under it');
  const css = readFileSync('ui/public/stillhet/css/stillhet.css', 'utf8') + readFileSync('ui/public/stillhet/runs/task.css', 'utf8');
  assert.match(css, /\.sp-body\{[^}]*border-bottom:1px solid/, 'the opened part ends with a line of its own');
});

const HUNK = { at: '@@ -36,6 +36,6 @@ function paintRunHead(run, el) {', lines: [[' ', 'function paintRunHead(run, el) {'], ['-', '  el.append(backButton(run));'], ['-', '  el.append(groupList(run));'], ['+', '  el.append(breadcrumb(run));'], [' ', '}']] };

test('diffView: line numbers from the hunk head, on both sides', () => {
  assert.deepEqual(hunkStart(HUNK.at), [36, 36]); assert.deepEqual(hunkStart('@@ -0,0 +24,6 @@'), [0, 24]); assert.deepEqual(hunkStart('no head'), [1, 1]);
  assert.deepEqual(numbered(HUNK).map((l) => [l.k, l.a, l.b]), [[' ', 36, 36], ['-', 37, ''], ['-', 38, ''], ['+', '', 37], [' ', 39, 38]]);
  assert.deepEqual(paired(numbered(HUNK)).map(([l, r]) => [l?.a ?? null, r?.b ?? null]), [[36, 36], [37, 37], [38, null], [39, 38]], 'a removed line stands beside the line that replaced it');
});

test('diffView: unified and side by side, added and removed marked by a sign and a word, never colour alone', () => {
  const d = dom(diffView({ path: 'ui/public/app.js', hunks: [HUNK] }));
  const root = d.querySelector('section.diff-view');
  assert.equal(root.dataset.mode, 'split', 'side by side where it fits');
  assert.equal(root.getAttribute('aria-label'), 'Changes in ui/public/app.js');
  const uni = [...d.querySelectorAll('.dv-unified tbody tr:not(.dv-at)')];
  assert.equal(uni.length, 5);
  assert.deepEqual(uni.map((r) => r.className), ['', 'dv-del', 'dv-del', 'dv-add', '']);
  assert.equal(uni[1].querySelector('.dv-s [aria-hidden]').textContent, '−'); assert.equal(uni[1].querySelector('.dv-s .sr-only').textContent, 'removed');
  assert.equal(uni[3].querySelector('.dv-s [aria-hidden]').textContent, '+'); assert.equal(uni[3].querySelector('.dv-s .sr-only').textContent, 'added');
  assert.deepEqual([...uni[3].querySelectorAll('.dv-n')].map((c) => c.textContent), ['', '37']);
  const split = [...d.querySelectorAll('.dv-split tbody tr:not(.dv-at)')];
  assert.equal(split.length, 4);
  assert.equal(split[1].children.length, 6, 'old on the left, new on the right: number, sign, code each');
  assert.ok(split[1].children[2].classList.contains('dv-del')); assert.ok(split[1].children[5].classList.contains('dv-add'));
  assert.ok(split[2].children[5].classList.contains('dv-none'), 'a removed line with no partner leaves its right side empty');
  assert.equal(d.querySelector('.dv-head .ct').textContent, '+1−2');
  assert.match(d.querySelector('.dv-c').textContent, /function paintRunHead/);
  assert.equal(dom(diffView({ path: 'a<b>.js', hunks: [{ lines: [['+', '<script>']] }] })).querySelector('script'), null, 'code is text');
});

test('diffView: a Segmented picks the layout where both fit; under 900px of its own width it is unified', () => {
  const d = dom(diffView({ path: 'a.js', hunks: [HUNK], mode: 'unified' }));
  assert.equal(d.querySelector('.diff-view').dataset.mode, 'unified');
  const seg = [...d.querySelectorAll('.dv-seg .seg button')];
  assert.deepEqual(seg.map((b) => [b.textContent, b.dataset.diffMode, b.getAttribute('aria-pressed')]), [['Side by side', 'split', 'false'], ['Unified', 'unified', 'true']]);
  assert.equal(dom(diffView({ path: 'a.js', hunks: [HUNK], seg: false })).querySelector('.dv-seg'), null, 'the later files of one view share the first one\'s');
  const css = readFileSync('ui/public/stillhet/css/stillhet.css', 'utf8') + readFileSync('ui/public/stillhet/runs/task.css', 'utf8');
  assert.match(css, /\.diff-view\{container-type:inline-size/);
  assert.match(css, /\.dv-split\{display:none/); assert.match(css, /\.dv-seg\{display:none/);
  assert.match(css, /@container \(min-width: 900px\)\{\s*\.dv-seg\{display:inline-flex;\}\s*\.diff-view\[data-mode="split"\] \.dv-split\{display:table;\}\s*\.diff-view\[data-mode="split"\] \.dv-unified\{display:none;\}/);
  assert.match(css, /tr\.dv-add td,\.dv-split td\.dv-add\{background:color-mix\(in srgb,var\(--green\) \d+%,transparent\)/, 'a tint under ink text: the text keeps its contrast');
  assert.doesNotMatch(css, /\.dv-c[^{]*\{[^}]*color:var\(--(green|red)/, 'the code itself stays ink');
});

test('diffView: a patch becomes hunks', () => {
  const hs = parsePatch('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n one\n-two\n+2\n\\ No newline at end of file\n@@ -9 +9 @@\n-a\n+b');
  assert.equal(hs.length, 2); assert.deepEqual(hs[0].lines, [[' ', 'one'], ['-', 'two'], ['+', '2']]); assert.equal(hs[1].at, '@@ -9 +9 @@');
  assert.equal(diffView.parsePatch, parsePatch);
});

test('a card that asks shows what it asks about; its title opens its page; it says what it is', () => {
  const d = dom(taskCard({ title: 'Migrate cron parser', mark: '<i></i>', word: 'Needs approval', from: 'Task · started from this chat', titleAttrs: { 'data-open-task-page': 't16' },
    menu: '<span class="rc-pop"><div class="menu">m</div></span>',
    asks: { label: 'What the review found', lines: ['2 small things left'], decisions: [{ text: 'Confirm these findings · 2', attrs: { 'data-open-task': 't16' } }], more: { label: 'Read it on the task page', attrs: { 'data-card-stage': 't16|Review' } } } }));
  assert.equal(d.querySelector('.tp-kicker .tp-from').textContent, 'Task · started from this chat');
  assert.equal(d.querySelector('h2.tc-title > button.tc-title-b').dataset.openTaskPage, 't16');
  const asks = d.querySelector('.rc-card .tc-asks');
  assert.equal(asks.querySelector('.tc-asks-h').textContent, 'What the review found');
  assert.equal(asks.querySelector('.tc-asks-l li').textContent, '2 small things left');
  assert.equal(asks.querySelector('.tc-asks-d button').textContent, 'Confirm these findings · 2', 'every open decision is on the folded card');
  assert.equal(asks.querySelector('button.btn').dataset.cardStage, 't16|Review');
  assert.ok(d.querySelector('.tp-kicker .tp-menu .menu'), 'the menu stays inside the head, where it floats (a div in a p would be thrown out of it)');
});

test('a proposal is labelled rows in fixed places with one supporting line; a changed value says so', () => {
  const d = dom(taskProposal({ title: 'Add tax', rows: [{ label: 'Project', value: '<b>billing-api</b>' }, { label: 'Workflow', value: 'Lean', was: 'Default' }, { label: 'Model', value: 'Opus' }, { label: 'Starts', value: 'now' }, { label: 'Then', value: 'open a PR' }], line: 'Lean: build and a quick review', files: ['spec.pdf'] }));
  assert.deepEqual([...d.querySelectorAll('.tp-rows dt')].map((e) => e.textContent), ['Project', 'Workflow', 'Model', 'Starts', 'Then']);
  assert.equal(d.querySelectorAll('.tp-row.is-changed').length, 1);
  assert.match(d.querySelector('.tp-row.is-changed .tp-was').textContent, /You picked · was Default/);
  assert.equal(d.querySelector('.tp-what').textContent, 'Lean: build and a quick review');
  assert.equal(d.querySelector('.tp-files .kind-chip').textContent, 'spec.pdf', 'attached files show on the closed card');
  assert.equal(d.querySelector('.tp-sentence'), null, 'no sentence of pickers');
  const wf = dom(changeProposal({ kind: 'Workflow', title: 'Security first', facts: [{ label: 'Project', value: 'billing-api' }], body: '<section class="ws"></section>', apply: 'Save workflow', second: { label: 'Run once', attrs: { 'data-cp-once': 'w9' } } }));
  assert.equal(wf.querySelector('.tp-rows dt').textContent, 'Project'); assert.equal(wf.querySelector('.tp-rows dd').textContent, 'billing-api');
  assert.deepEqual([...wf.querySelectorAll('.tp-actions button')].map((b) => b.textContent), ['Save workflow', 'Run once', 'Not now']);
});

test('busy buttons say what they are doing in the present tense', () => {
  assert.equal(busyWord('Create PR'), 'Creating PR…'); assert.equal(busyWord('Merge'), 'Merging…'); assert.equal(busyWord('Retry'), 'Retrying…');
  assert.equal(busyWord('Save workflow'), 'Saving workflow…'); assert.equal(busyWord('Answer'), 'Sending the answer…'); assert.equal(busyWord('Accept as is'), 'Accepting as is…');
  assert.equal(busyWord('Stop'), 'Stopping…'); assert.equal(busyWord('Tidy'), 'Tidy…');
  const b = dom(button({ label: 'Create PR', busy: { label: busyWord('Create PR') } })).querySelector('button');
  assert.ok(b.disabled); assert.equal(b.getAttribute('aria-busy'), 'true'); assert.ok(b.querySelector('.btn-knot')); assert.equal(b.querySelector('.btn-busy-t').textContent, 'Creating PR…');
});

test('Chat home starters are cards: an icon, a name, one plain line, the whole card one button, in a 3/2/1 grid', async () => {
  const { starterCard, starterGrid } = await import('../ui/public/design-system/components/kind-mark.mjs');
  const d = dom(starterGrid({ cards: starterCard({ icon: '<svg></svg>', label: 'New task', says: 'One job on a project', attrs: { 'data-starter': 'task' } }) + starterCard({ icon: '<svg></svg>', label: 'More', says: 'The rarely used ones', more: true, attrs: { 'aria-haspopup': 'menu' } }) }));
  const cards = [...d.querySelectorAll('.starter-grid > button.starter-card')];
  assert.equal(cards.length, 2); assert.equal(d.querySelector('.starter-grid').getAttribute('role'), 'group');
  assert.equal(cards[0].dataset.starter, 'task'); assert.equal(cards[0].querySelector('.st-n').textContent, 'New task'); assert.equal(cards[0].querySelector('.st-s').textContent, 'One job on a project');
  assert.ok(cards[1].querySelector('.st-n svg'), 'More says it opens a menu');
  const css = readFileSync('ui/public/stillhet/css/stillhet.css', 'utf8') + readFileSync('ui/public/stillhet/runs/task.css', 'utf8');
  assert.match(css, /\.home-starters\.starter-grid\{display:grid;grid-template-columns:repeat\(3,/);
  assert.match(css, /@media \(max-width: 900px\)\{ \.home-starters\.starter-grid\{grid-template-columns:repeat\(2,/);
  assert.match(css, /@media \(max-width: 600px\)\{ \.home-starters\.starter-grid\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.starter-card\{[^}]*border:1px solid var\(--line-2\);border-radius:var\(--r-sm\)/, 'a hairline border, tight corners');
  assert.doesNotMatch(css, /\.starter-card[^{]*\{[^}]*(gradient|border-radius:(9|[1-9]\d)\d*px)/, 'no gradients, no pills');
});

test('the chat timeline: a slim track on the reading column\'s right edge, quiet at rest, its ticks on hover or focus; not drawn when narrow', () => {
  const css = readFileSync('ui/public/stillhet/css/stillhet.css', 'utf8') + readFileSync('ui/public/stillhet/runs/task.css', 'utf8');
  assert.match(css, /\[data-timeline\]\{position:absolute;[^}]*left:min\(calc\(50% \+ 336px\),calc\(100% - 44px\)\)/);
  assert.match(css, /\[data-timeline\] \.tl-tick i\{opacity:0;/);
  assert.match(css, /\[data-timeline\] > \.timeline:is\(:hover,:focus-within\) \.tl-tick i\{opacity:1;\}/);
  assert.match(css, /@media \(max-width: 760px\)\{ \[data-timeline\]\{display:none;\}/);
});

test('DiffView find: a Find field in the head of the view that owns the Segmented; findSpans ignores case; the watcher marks, counts, steps and clears', async () => {
  const { JSDOM } = await import('jsdom');
  const C = await import('../ui/public/design-system/components/index.mjs');
  assert.deepEqual(C.findSpans('const Total = total + 1', 'total'), [[6, 11], [14, 19]]);
  assert.deepEqual(C.findSpans('abc', ''), []);
  const hunks = [{ at: '@@ -1,3 +1,3 @@', lines: [[' ', 'const a = 1;'], ['-', 'let total = a;'], ['+', 'const total = a + 1;']] }];
  const html = `<div class="diff-files">${C.diffView({ path: 'a.js', hunks, mode: 'unified' })}${C.diffView({ path: 'b.js', hunks, mode: 'unified', seg: false })}</div>`;
  const dom = new JSDOM(`<body>${html}</body>`), d = dom.window.document;
  assert.equal(d.querySelectorAll('[data-dv-find]').length, 1, 'one Find field for the files shown together');
  assert.equal(new JSDOM(C.diffView({ path: 'a.js', hunks, find: false })).window.document.querySelector('[data-dv-find]'), null);
  // jsdom lays nothing out: keep only the unified tables, as the screen would
  for (const t of d.querySelectorAll('.dv-split')) t.remove();
  C.watchDiffFind(d);
  const input = d.querySelector('[data-dv-find]'), count = () => d.querySelector('.dv-find-n').textContent;
  const type = (v) => { input.value = v; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  type('TOTAL');
  assert.equal(d.querySelectorAll('mark.dv-hit').length, 4, 'both lines of both files');
  assert.equal(count(), '1 of 4');
  assert.equal(d.querySelector('[data-dv-step="1"]').disabled, false);
  d.querySelector('[data-dv-step="1"]').click();
  assert.equal(count(), '2 of 4'); assert.equal(d.querySelectorAll('mark.dv-hit.is-now').length, 1);
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
  assert.equal(count(), '1 of 4');
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
  assert.equal(count(), '4 of 4', 'it goes round the end');
  type('nothing here');
  assert.equal(count(), 'No match'); assert.equal(d.querySelectorAll('mark.dv-hit').length, 0);
  type('a');
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(input.value, ''); assert.equal(count(), ''); assert.equal(d.querySelectorAll('mark').length, 0);
  assert.equal(d.querySelector('.dv-c').textContent, 'const a = 1;', 'the code is as it was');
});

test('the detail panel\'s controller: a trigger opens it with the focus on its title, the same trigger closes it, Esc gives the focus back, it follows another thing and remembers the tab', async () => {
  const { detailPanelController } = await import('../ui/public/design-system/components/index.mjs');
  const win = new JSDOM('<body><div id="page"><button data-dp-open="a|changes">A</button><button data-dp-open="b|">B</button><div data-detail></div></div></body>', { url: 'http://localhost/' }).window;
  const doc = win.document, root = doc.getElementById('page'), kept = new Map();
  const storage = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) };
  const things = { a: 'Add CSV', b: 'Fix login' };
  const make = () => detailPanelController({ root, host: () => root.querySelector('[data-detail]'), storage,
    resolve: (id) => things[id] && { title: things[id], word: 'Working', tabs: [{ id: 'activity', label: 'Activity' }, { id: 'changes', label: 'Changes' }], body: (tab) => `<p>${id} ${tab}</p>` } });
  const dp = make();
  const click = (el) => { const e = { target: el }; return dp.click(e); };
  const [a, b] = root.querySelectorAll('[data-dp-open]'), panel = () => root.querySelector('.detail-panel');
  assert.equal(click(doc.body), false, 'a click elsewhere is not the panel\'s and leaves it as it is');
  a.focus(); assert.equal(click(a), true);
  assert.equal(panel().getAttribute('aria-label'), 'Details of Add CSV'); assert.equal(root.querySelector('.dp-body').textContent, 'a changes');
  assert.ok(doc.activeElement.hasAttribute('data-dp-title'), 'the focus goes to its title');
  assert.ok(root.classList.contains('has-detail'), 'the frame makes room for it');
  click(a); assert.equal(panel(), null, 'the same trigger again closes it'); assert.equal(doc.activeElement, a, 'and the focus is back on the trigger');
  click(a); click(b);
  assert.equal(panel().getAttribute('aria-label'), 'Details of Fix login', 'it follows the thing you point at'); assert.equal(root.querySelector('.dp-body').textContent, 'b changes', 'at the tab you were on');
  click(root.querySelector('.dp-tabs [data-tab="activity"]')); assert.equal(root.querySelector('.dp-body').textContent, 'b activity');
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(panel(), null, 'Esc closes it'); assert.equal(doc.activeElement, b, 'and gives the focus back to what opened it');
  click(root.querySelector('[data-dp-open]')); click(root.querySelector('[data-dp-widen]')); assert.ok(panel().classList.contains('is-wide'));
  assert.deepEqual(JSON.parse(kept.get('worca-stillhet.detail-panel')), { wide: true, tab: 'changes' });
  const next = make(); next.open('b', ''); assert.equal(next.state.tab, 'changes', 'another visit opens at the remembered tab'); assert.equal(next.state.wide, true);
  kept.set('worca-stillhet.card-layout', 'card'); assert.equal(next.sidePanel(), false); assert.equal(next.html(), '', 'with Inside the card there is no panel');
});

test('the detail panel\'s tabs: one set and order for every place, an empty tab left out, and a tab remembered as Activity opens Steps', async () => {
  const { detailTabs, detailPanelController } = await import('../ui/public/design-system/components/index.mjs');
  assert.deepEqual(detailTabs({ cost: true, steps: true, log: true, changes: 5, checks: true, decisions: 2 }).map((t) => t.label), ['Steps', 'Log', 'Changes', 'Checks', 'Decisions', 'Cost']);
  assert.deepEqual(detailTabs({ steps: true, changes: 0, checks: false, decisions: 2 }), [{ id: 'steps', label: 'Steps', count: '' }, { id: 'decisions', label: 'Decisions', count: 2 }]);
  const win = new JSDOM('<body><div id="page"><div data-detail></div></div></body>', { url: 'http://localhost/' }).window, root = win.document.getElementById('page');
  const storage = { getItem: (k) => (k === 'worca-stillhet.detail-panel' ? '{"tab":"activity"}' : null), setItem() {} };
  const dp = detailPanelController({ root, host: root.firstChild, storage, resolve: () => ({ title: 'T', tabs: detailTabs({ steps: true, log: true }), body: (tab) => tab }) });
  dp.open('a', ''); assert.equal(dp.state.tab, 'steps'); assert.equal(root.querySelector('.dp-body').textContent, 'steps');
});

test('a knot points at its stage: Steps marks it, another knot moves the mark with the panel open, the same knot closes it, and any other trigger points at none', async () => {
  const { detailPanelController, stageLine } = await import('../ui/public/design-system/components/index.mjs');
  const win = new JSDOM('<body><div id="page"><button data-dp-open="t|steps" data-dp-stage="0">Plan</button><button data-dp-open="t|steps" data-dp-stage="1">Build</button><button data-dp-open="t|steps">Follow its steps</button><div data-detail></div></div></body>', { url: 'http://localhost/' }).window;
  const root = win.document.getElementById('page'), storage = { getItem: () => null, setItem() {} };
  const dp = detailPanelController({ root, host: () => root.querySelector('[data-detail]'), storage,
    resolve: () => ({ title: 'T', tabs: [{ id: 'steps', label: 'Steps' }], body: () => ['Plan', 'Build'].map((label, i) => stageLine({ mark: '', label, pointed: dp.state.stage !== '' && +dp.state.stage === i })).join('') }) });
  const [plan, build, link] = root.querySelectorAll('[data-dp-open]'), click = (el) => dp.click({ target: el });
  const marked = () => [...root.querySelectorAll('.detail-panel .stage-line.is-pointed[aria-current="step"] b')].map((b) => b.textContent);
  click(build); assert.equal(dp.state.stage, '1'); assert.deepEqual(marked(), ['Build']);
  click(plan); assert.ok(root.querySelector('.detail-panel'), 'another knot keeps the panel open'); assert.deepEqual(marked(), ['Plan'], 'and moves the mark');
  click(plan); assert.equal(root.querySelector('.detail-panel'), null, 'the same knot again closes it'); assert.equal(dp.state.stage, '');
  click(link); assert.deepEqual(marked(), [], 'a link points at no stage');
  assert.doesNotMatch(stageLine({ mark: '', label: 'Plan' }), /is-pointed|aria-current/);
});
