// test/design-system-components.test.mjs — the Worca Rail components (ui/public/design-system/components/): each
// writes the markup its catalog entry promises, escapes what it is given, and carries its roles and states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as C from '../ui/public/design-system/components/index.mjs';

const dom = (html) => new JSDOM(`<body>${html}</body>`).window.document.body.firstElementChild;

test('esc and attrs: text is escaped; true is bare, false and null are dropped', () => {
  assert.equal(C.esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(C.attrs({ 'data-key': 'a"b', disabled: true, hidden: false, title: null }), ' data-key="a&quot;b" disabled');
});

test('button: one class per role, an icon-only button names itself', () => {
  assert.equal(C.button({ label: 'Merge', kind: 'primary', attrs: { 'data-key': 'm' } }),
    '<button type="button" class="btn btn-sm btn-primary" data-key="m">Merge</button>');
  const b = dom(C.button({ label: 'More for this run', icon: '<svg></svg>', iconOnly: true }));
  assert.equal(b.className, 'btn btn-sm btn-icon');
  assert.equal(b.getAttribute('aria-label'), 'More for this run');
  assert.equal(b.title, 'More for this run');
  assert.equal(b.textContent, '');
  assert.throws(() => C.button({ label: 'x', kind: 'big' }), /unknown kind/);
});

test('splitButton: the ▾ takes the main kind and shows its menu only when open', () => {
  const closed = dom(C.splitButton({ main: { label: 'Merge', kind: 'primary' }, moreLabel: 'More actions', chevron: '<svg></svg>', menuHtml: '<div class="menu"></div>' }));
  const [main, more] = closed.querySelectorAll('button');
  assert.equal(main.textContent, 'Merge');
  assert.match(more.className, /btn-primary/);
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.equal(closed.querySelector('.menu'), null);
  const open = dom(C.splitButton({ main: { label: 'Merge' }, moreLabel: 'More actions', chevron: '', open: true, menuHtml: '<div class="menu"></div>' }));
  assert.ok(open.querySelector('.menu'));
  assert.equal(dom(C.splitButton({ main: { label: 'Merge' } })).querySelectorAll('button').length, 1, 'no alternatives, no ▾');
});

test('compactMenu: choices are radios, danger comes after one rule, help is the tooltip', () => {
  const m = dom(C.compactMenu({ items: [
    { header: 'Away mode' }, { id: 'a', text: 'As set up', checked: true }, { id: 'b', text: 'Never', checked: false }, { sep: true },
    { text: 'Copy link', hint: '⌘L', help: 'Paste it anywhere' }, { text: 'Archive', danger: true }, { text: 'Discard', danger: true, off: true },
  ] }));
  const items = [...m.querySelectorAll('.menu-item')];
  assert.deepEqual(items.map((x) => x.getAttribute('role')), ['menuitemradio', 'menuitemradio', 'menuitem', 'menuitem', 'menuitem']);
  assert.equal(items[0].getAttribute('aria-checked'), 'true');
  assert.equal(items[2].title, 'Paste it anywhere');
  assert.equal(items[2].querySelector('.mi-hint').textContent, '⌘L');
  assert.equal(m.querySelectorAll('.menu-sep').length, 2, 'the separator, then one rule before the danger items');
  assert.ok(items[3].previousElementSibling.matches('.menu-sep'));
  assert.ok(items[4].previousElementSibling === items[3], 'one rule only');
  assert.equal(items[4].getAttribute('aria-disabled'), 'true');
  assert.equal(items[2].dataset.menuPick, 'Copy link', 'the text when no id');
});

test('statusLine: rail mark, the state word, the action slot, the detail with its tooltip', () => {
  const z = dom(C.statusLine({ dot: C.statusDot({ tone: 'is-green' }), word: 'Ready to merge', action: '<div class="rc-side"></div>', detail: 'Checks pass <ok>' }));
  assert.equal(z.className, 'rc-zone');
  assert.ok(z.querySelector('.rc-rail > .status-dot.is-green'));
  assert.equal(z.querySelector('.rc-word').textContent, 'Ready to merge');
  assert.ok(z.querySelector('.rc-side'));
  assert.equal(z.querySelector('.rc-detail').title, 'Checks pass <ok>');
  assert.match(C.statusDot({ sym: 'q', glyph: '<path/>' }), /is-amber has-sym/);
  assert.match(C.statusDot({ sym: '!' }), /is-red has-sym/);
});

test('confirmStrip: asks, works, then fails with the reason and Try again', () => {
  const ask = dom(C.confirmStrip({ text: 'Merge #959 into dev?', yes: 'Merge' }));
  assert.equal(ask.getAttribute('role'), 'alertdialog');
  assert.equal(ask.getAttribute('aria-labelledby'), 'rc-strip-t');
  assert.deepEqual([...ask.querySelectorAll('button')].map((b) => b.textContent), ['Merge', 'Cancel']);
  assert.match(ask.querySelector('[data-confirm="yes"]').className, /btn-primary/);
  const busy = dom(C.confirmStrip({ text: 'x', yes: 'Merge', busy: 'Merging…' }));
  assert.equal(busy.querySelector('[data-confirm="yes"]').textContent, 'Merging…');
  assert.ok(busy.querySelector('[data-confirm="yes"]').disabled);
  const err = dom(C.confirmStrip({ text: 'x', yes: 'Stop', danger: true, err: { title: 'Could not stop', detail: 'It had just finished. Nothing changed.' } }));
  assert.equal(err.querySelector('[role="alert"]').firstChild.textContent, 'Could not stop');
  assert.equal(err.querySelector('.rc-confirm-why').textContent, 'It had just finished. Nothing changed.');
  assert.equal(err.querySelector('[data-confirm="yes"]').textContent, 'Try again');
  assert.match(err.querySelector('[data-confirm="yes"]').className, /btn-danger/);
});

test('tabs: one Tab stop, each tab names its panel, a count only when there is one', () => {
  const t = dom(C.tabs({ label: 'Run detail', controls: 'p', items: [{ id: 'summary', label: 'Overview', selected: true }, { id: 'changes', label: 'Changes', count: '5 · 3 docs' }] }));
  const [a, b] = t.querySelectorAll('[role="tab"]');
  assert.equal(t.getAttribute('role'), 'tablist');
  assert.equal(a.getAttribute('aria-selected'), 'true');
  assert.equal(a.tabIndex, 0);
  assert.equal(b.tabIndex, -1);
  assert.equal(b.getAttribute('aria-controls'), 'p');
  assert.equal(a.querySelector('.n'), null);
  assert.equal(b.querySelector('.n').textContent, '5 · 3 docs');
});

test('segmented, figures, toast, emptyState, textLink', () => {
  const s = dom(C.segmented({ label: 'Show', hook: 'filter', items: [{ id: 'all', label: 'All steps', pressed: true }, { id: 'problems', label: 'Problems' }] }));
  assert.deepEqual([...s.querySelectorAll('button')].map((b) => [b.dataset.filter, b.getAttribute('aria-pressed')]), [['all', 'true'], ['problems', 'false']]);
  const f = dom(C.figures([C.figure({ k: 'Cost', v: '$4.10', of: 'of $10', warn: true }), C.figure({ k: 'Changes', v: '+120', tab: 'changes', current: true })]));
  assert.equal(f.querySelector('.rc-of.is-warn').textContent, 'of $10');
  assert.equal(f.querySelector('.rc-fig-link').getAttribute('aria-current'), 'true');
  const pop = (open) => dom(C.figure({ k: 'Cost', v: '$4', pop: { open, html: '<div class="menu"></div>', attrs: { 'data-menu': 'cost' } } }));
  assert.equal(pop(false).querySelector('button').getAttribute('aria-expanded'), 'false');
  assert.equal(pop(false).querySelector('.menu'), null);
  assert.ok(pop(true).querySelector('.menu'), 'its detail opens in place');
  assert.equal(dom(C.toast()).className, 'rc-toast');
  assert.equal(dom(C.toast({ text: 'Merged' })).className, 'rc-toast is-on');
  const e = dom(C.errorToast({ title: 'Something went wrong', text: 'Your runs keep going.', icon: '', count: 3 }));
  assert.equal(e.querySelector('.badge').textContent, '3');
  assert.equal(dom(C.errorToast({ title: 't', text: 'x', icon: '', count: 1 })).querySelector('.badge'), null, 'once is not a count');
  const es = dom(C.emptyState({ title: 'Could not show the changes', text: 'The rest still works.', error: true }));
  assert.equal(es.getAttribute('role'), 'alert');
  assert.equal(dom(C.emptyState({ title: 'No runs yet' })).getAttribute('role'), null);
  assert.equal(C.textLink({ label: 'Open it', attrs: { 'data-go': 'doc:0' } }), '<button type="button" class="dc-link" data-go="doc:0">Open it</button>');
});

test('toElement turns markup into an element for pages that build the DOM', () => {
  const { document } = new JSDOM('').window;
  const el = C.toElement(document, C.button({ label: 'Go' }));
  assert.equal(el.tagName, 'BUTTON');
});

test('the catalog names a module for every component built in code, and each module exports it', async () => {
  const cat = JSON.parse(readFileSync(new URL('../docs/design-system-catalog.json', import.meta.url), 'utf8'));
  const coded = cat.components.filter((c) => c.code);
  assert.ok(coded.length >= 9, 'the run page\'s components point at their code');
  for (const c of coded) {
    const [file, name] = c.code.split('#');
    const mod = await import(new URL('../' + file, import.meta.url));
    assert.equal(typeof mod[name], 'function', `${c.name}: ${c.code}`);
  }
});

test('morph keeps what stays, adds what is new, drops what left, and draws the same DOM as innerHTML', () => {
  const { document } = new JSDOM('<div id="t"></div>').window;
  const t = document.getElementById('t');
  C.morph(t, '<p class="a">one</p><ul><li data-key="x">x</li><li data-key="y">y</li></ul>');
  const p = t.querySelector('p'), y = t.querySelector('[data-key="y"]');
  const html = '<div class="strip">ask</div><p class="a is-on">two</p><ul><li data-key="y">y!</li></ul><input value="v">';
  const r = C.morph(t, html);
  assert.equal(t.querySelector('p'), p, 'the same element, so its transitions run');
  assert.equal(t.querySelector('[data-key="y"]'), y, 'a keyed row is found after one left before it');
  assert.equal(t.querySelector('[data-key="x"]'), null);
  assert.deepEqual(r.entered.map((e) => e.className || e.tagName), ['strip', 'INPUT']);
  const ref = document.createElement('div'); ref.innerHTML = html;
  assert.equal(t.innerHTML, ref.innerHTML);
  assert.equal(t.querySelector('input').value, 'v');
});

test('morph plays data-motion: in and open when they appear, change and swap when they change; never on a jump or under reduced motion', () => {
  const run = ({ reduced = false, motion = true } = {}) => {
    const { window } = new JSDOM('<div id="t"></div>');
    const calls = [];
    window.matchMedia = () => ({ matches: reduced });
    window.Element.prototype.animate = function (k, o) { calls.push([this.getAttribute('data-motion'), o.duration]); };
    const t = window.document.getElementById('t');
    C.morph(t, '<span data-motion="change">Ready</span><button data-motion="swap">Merge</button><span class="m"></span>');
    C.morph(t, '<span data-motion="change">Merged</span><button data-motion="swap">Merge</button><span class="m"><div data-motion="in"></div></span><div data-motion="open"></div>', { motion });
    return calls;
  };
  assert.deepEqual(run().sort(), [['change', 200], ['in', 150], ['open', 150]], 'swap did not change, so it stays still');
  assert.deepEqual(run({ reduced: true }), []);
  assert.deepEqual(run({ motion: false }), []);
});

test('the components say how they move', () => {
  assert.match(C.compactMenu({ items: [] }), /data-motion="in"/);
  assert.match(C.confirmStrip({ text: 'x', yes: 'Merge' }), /class="rc-confirm"[^>]*data-motion="open"/);
  assert.match(C.confirmStrip({ text: 'x', yes: 'Merge' }), /data-confirm="yes"[^>]*data-motion="swap"/);
  assert.equal((C.statusLine({ dot: '', word: 'Ready' }).match(/data-motion="change"/g) || []).length, 2, 'the mark and the word');
});

test('sentencePicker: the words in the sentence, a CompactMenu only when open, each pick names the picker and the value', () => {
  const items = [{ id: 'needs', text: 'what needs you', checked: true }, { sep: true }, { id: 'none', text: 'nothing', checked: false }];
  const closed = dom(C.sentencePicker({ id: 'badge', text: 'what needs you', items, tip: 'What the count counts' }));
  const b = closed.querySelector('.spick-b');
  assert.equal(b.textContent, 'what needs you');
  assert.equal(b.dataset.menu, 'badge');
  assert.equal(b.getAttribute('aria-expanded'), 'false');
  assert.equal(closed.querySelector('.menu'), null);
  const open = dom(C.sentencePicker({ id: 'badge', text: 'x', items, open: true, right: true }));
  assert.ok(open.querySelector('.menu.spick-menu.is-right'));
  assert.deepEqual([...open.querySelectorAll('[data-menu-pick]')].map((x) => x.dataset.menuPick), ['badge|needs', 'badge|none']);
});

test('switchButton, settingsRow and settingsSection: the row owns its parts, the section its head and action', () => {
  const sw = dom(C.switchButton({ on: true, label: 'Desktop notifications', why: 'On', attrs: { 'data-desk': '' } }));
  assert.equal(sw.getAttribute('role'), 'switch');
  assert.equal(sw.getAttribute('aria-checked'), 'true');
  const row = dom(C.settingsRow({ name: 'Badge <b>', sentence: 'The tab title counts <x>', end: '<button class="btn"></button>', changed: [{ name: 'Total', was: '$1,000 a month' }, { name: 'Per run', was: 'no limit' }], detail: '<p>more</p>' }));
  assert.equal(row.className, 'set-row');
  assert.equal(row.querySelector('.set-name').textContent, 'Badge <b>', 'the name is escaped');
  assert.ok(row.querySelector('.set-text x'), 'the sentence is markup, so it can hold pickers');
  const dot = row.querySelector('.set-name .set-dot');   // right after the name, one however many values, no words on the row
  assert.equal(dot.getAttribute('title'), 'Changed\nTotal: default $1,000 a month\nPer run: default no limit');
  assert.equal(row.querySelectorAll('.set-dot').length, 1);
  assert.equal(row.querySelector('.set-name').textContent, 'Badge <b>');
  assert.equal(C.changedDot(), '');
  assert.equal(C.settingsRow({ name: 'A' }).includes('set-dot'), false);
  assert.equal(C.settingsRow({ name: 'A', changed: [] }).includes('set-dot'), false);
  assert.equal(dom(C.settingsRow({ name: 'A', changed: true })).querySelector('.set-dot').getAttribute('title'), 'Changed');
  assert.equal(row.querySelector('.set-detail').dataset.motion, 'open');
  const sec = dom(C.settingsSection({ title: 'What reaches you', action: '<button class="btn btn-quiet">Reset</button>', meta: 'one line', rows: C.settingsRow({ name: 'a' }) }));
  assert.equal(sec.querySelector('h2.set-sec-h').textContent, 'What reaches you');
  assert.ok(sec.querySelector('.set-sec-head > .btn-quiet'));
  assert.equal(sec.querySelector('.set-sec-meta').textContent, 'one line');
  assert.equal(sec.querySelectorAll('.set-rows > .set-row').length, 1);
});

test('listRow: the mark on the rail, title and meta, a figure and the ⋯ at the right; the whole row opens its target', () => {
  const r = dom(C.listRow({ title: 'Bug fix <x>', meta: 'Any project · Fix workflow', mark: C.statusDot({ tone: 'is-green' }), endText: '14:32', end: '<button class="btn">⋯</button>', open: { 'data-open': 'p1', title: 'Open Bug fix' } }));
  assert.equal(r.className, 'list-row');
  assert.ok(r.querySelector('.lr-rail > .status-dot.is-green'));
  const main = r.querySelector('button.lr-main');
  assert.equal(main.dataset.open, 'p1');
  assert.equal(r.querySelector('.lr-t').textContent, 'Bug fix <x>');
  assert.equal(r.querySelector('.lr-m').textContent, 'Any project · Fix workflow');
  assert.equal(r.querySelector('.lr-fig').textContent, '14:32');
  assert.equal(dom(C.listRow({ title: 'Only shows' })).querySelector('button'), null, 'no target, no button');
});

test('list: its sentence, groups in order, an empty group not drawn, Show N more, the empty state when nothing is left', () => {
  const l = dom(C.list({ sentence: 'Showing <b>everything</b>', groups: [
    { title: 'Needs you', count: 2, rows: [C.listRow({ title: 'a' }), C.listRow({ title: 'b' })] },
    { title: 'Running', count: 0, rows: [] },
    { title: 'Older', rows: [C.listRow({ title: 'c' })], more: { n: 21, attrs: { 'data-more': 'older' } } },
  ] }));
  assert.equal(l.querySelector('.list-sentence b').textContent, 'everything');
  assert.deepEqual([...l.querySelectorAll('.list-h')].map((h) => h.firstChild.textContent.trim()), ['Needs you', 'Older']);
  assert.equal(l.querySelector('.list-more').textContent, 'Show 21 more');
  assert.equal(dom(C.list({ groups: [{ rows: [] }], empty: C.emptyState({ title: 'No presets yet' }) })).querySelector('.empty-line .el-t').textContent, 'No presets yet');
});

test('dialog: head, the one scrolling body, a foot with its status, Cancel and the step; busy says so', () => {
  const d = dom(C.dialog({ title: 'Change the Worca folder', body: '<p>x</p>', yes: 'Move it', status: 'Runs pause while it moves' }));
  assert.equal(d.getAttribute('role'), 'dialog');
  assert.equal(d.getAttribute('aria-modal'), 'true');
  assert.equal(d.dataset.motion, 'in');
  assert.ok(d.querySelector('.card.dlg > .dlg-head > h2#dlg-t'));
  assert.ok(d.querySelector('.dlg-body > p'));
  assert.deepEqual([...d.querySelectorAll('.dlg-acts button')].map((b) => b.textContent), ['Cancel', 'Move it']);
  const busy = dom(C.dialog({ title: 't', body: '', yes: 'Move it', busy: true, busyLabel: 'Moving…' }));
  assert.equal(busy.querySelector('[data-dialog="yes"]').textContent, 'Moving…');
  assert.ok(busy.querySelector('[data-dialog="yes"]').disabled);
});

test('dialog: a stepped setup has the Stepper at its head, Back in its foot; a view only closes', () => {
  const d = dom(C.dialog({ title: 'Setup', body: '', yes: 'Next', back: true, steps: C.stepper({ stages: [{ key: 'a', label: 'Check', selected: true, cells: ['is-done'], attrs: { 'data-x': '1' } }] }) }));
  assert.ok(d.querySelector('.dlg-head + .dlg-steps [data-x="1"]'));
  assert.deepEqual([...d.querySelectorAll('.dlg-acts button')].map((b) => b.textContent), ['Cancel', 'Back', 'Next']);
  const v = dom(C.dialog({ title: 'Default', body: '', yes: 'Close', view: true }));
  assert.deepEqual([...v.querySelectorAll('.dlg-acts button')].map((b) => b.textContent), ['Close']);
});

test('field and tooltip: a label for its input, the error replaces the hint; a disabled control keeps its tooltip', () => {
  const f = dom(C.field({ id: 'root', label: 'Worca folder', value: '~/.worca', hint: 'Runs and history live here' }));
  assert.equal(f.querySelector('label').htmlFor, 'root');
  assert.equal(f.querySelector('input').value, '~/.worca');
  assert.equal(f.querySelector('input').getAttribute('aria-describedby'), 'root-note');
  const e = dom(C.field({ id: 'root', label: 'Worca folder', hint: 'h', error: 'This folder cannot be written' }));
  assert.equal(e.querySelector('[role="alert"]').textContent, 'This folder cannot be written');
  assert.equal(e.querySelector('input').getAttribute('aria-invalid'), 'true');
  assert.equal(e.querySelector('.fld-hint'), null);
  assert.ok(dom(C.field({ id: 'n', label: 'Note', multiline: true })).querySelector('textarea.textarea'));
  const t = dom(C.tooltip({ text: 'Checks are still running', html: '<button class="btn" disabled>Merge</button>', off: true }));
  assert.equal(t.className, 'tip-wrap');
  assert.equal(t.title, 'Checks are still running');
  assert.equal(dom(C.tooltip({ text: 'Copy the link', html: '<button class="btn">Copy</button>' })).title, 'Copy the link');
});

test('listRow menu: the row\'s own actions in its ⋯, the ones that cannot be taken back last after one rule', () => {
  const r = dom(C.listRow({ title: 'Strict', menu: { id: 'm1', label: 'More for Strict', icon: '<svg></svg>', items: ['Delete', 'Edit', 'Duplicate'], open: true } }));
  const b = r.querySelector('.lr-end .rc-pop > button');
  assert.equal(b.dataset.menu, 'm1');
  assert.equal(b.getAttribute('aria-label'), 'More for Strict');
  assert.deepEqual([...r.querySelectorAll('[data-menu-pick]')].map((x) => x.dataset.menuPick), ['m1|Edit', 'm1|Duplicate', 'm1|Delete']);
  assert.ok(r.querySelector('.menu-item.is-danger'));
  assert.equal(dom(C.listRow({ title: 'x', menu: { id: 'm', label: 'l', icon: '', items: ['Edit'] } })).querySelector('.menu'), null, 'closed: no menu');
});

test('icon: one line weight, and no caller can choose another; the sidebar has its places', () => {
  assert.match(C.icon('check', 14), /stroke-width="1.8"/);
  assert.match(C.icon('check', 14, { stroke: 3 }), /stroke-width="1.8"/);
  for (const v of ['chat', 'runs', 'schedules', 'stats', 'team-metrics', 'workflows', 'requirements', 'marketplace', 'projects', 'workspaces']) assert.ok(C.ICONS['nav-' + v], v);
});

test('settingsGroup: a small head over its own rows', () => {
  const g = dom(C.settingsGroup({ title: 'Beta', rows: C.settingsRow({ name: 'Summaries' }) }));
  assert.equal(g.querySelector('.list-h').textContent, 'Beta');
  assert.equal(g.querySelector('.set-rows .set-name').textContent, 'Summaries');
});

test('listRow fold: Customise shows what is under the record, Done hides it; a List group has one meta line', () => {
  const shut = dom(C.listRow({ title: 'Jira', after: '<p class="x"></p>', fold: { open: false, attrs: { 'data-f': 'j' } } }));
  assert.equal(shut.querySelector('[data-f]').textContent, 'Customise');
  assert.equal(shut.querySelector('.x'), null);
  const open = dom(C.listRow({ title: 'Jira', after: '<p class="x"></p>', fold: { open: true } }));
  assert.ok(open.querySelector('.lr-after .x'));
  assert.equal(open.querySelector('[aria-expanded="true"]').textContent, 'Done');
  assert.ok(dom(C.listRow({ title: 'Run', after: '<p class="x"></p>' })).querySelector('.x'), 'without a fold, after always shows');
  const l = dom(C.list({ groups: [{ title: 'Blocked', meta: 'Recorded as off-policy', rows: ['<div></div>'] }] }));
  assert.equal(l.querySelector('.list-h + .list-m').textContent, 'Recorded as off-policy');
});

test('settingsRow fold.label names what a fold holds; settingsSection with no title has no head to repeat the tab', () => {
  const r = dom(C.settingsRow({ name: 'Browser extension', sentence: 's', fold: { open: false, label: 'Paired browsers' } }));
  assert.ok([...r.querySelectorAll('button')].some((b) => b.textContent === 'Paired browsers'));
  const open = dom(C.settingsRow({ name: 'Browser extension', sentence: 's', detail: '<p></p>', fold: { open: true, label: 'Paired browsers' } }));
  assert.ok([...open.querySelectorAll('button')].some((b) => b.textContent === 'Done'));
  const s = dom(C.settingsSection({ rows: '<div class="x"></div>' }));
  assert.equal(s.querySelector('.set-sec-head'), null);
  assert.ok(s.querySelector('.x'));
});

test('settingsRow fold: Customise opens its rows, a small label over each sentence, and its one foot action; Done closes', () => {
  const closed = dom(C.settingsRow({ name: 'Network', sentence: 'A direct connection', fold: { open: false, attrs: { 'data-fold': 'net' } }, detailRows: C.settingsRow({ name: 'Proxy' }) }));
  const btn = closed.querySelector('.set-end .btn-quiet');
  assert.equal(btn.textContent, 'Customise');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(btn.dataset.fold, 'net');
  assert.equal(closed.querySelector('.set-detail'), null);
  const open = dom(C.settingsRow({ name: 'Network', fold: { open: true }, detailRows: C.settingsRow({ name: 'Proxy' }), detailAction: '<button class="btn btn-quiet">Back to the group</button>' }));
  assert.equal(open.querySelector('.set-end .btn-quiet').textContent, 'Done');
  assert.ok(open.querySelector('.set-detail > .set-rows > .set-row'));
  assert.ok(open.querySelector('.set-detail > .set-foot > .btn-quiet'));
});

test('sideMenu, backLink, search: the place\'s menu with its current section, its narrow list, one step up, what search finds', () => {
  const groups = [{ title: 'Worca', items: [{ label: 'General', current: true, attrs: { 'data-sset': 'general' } }, { label: 'Labs', attrs: { 'data-sset': 'experimental' } }] }];
  const m = dom(C.sideMenu({ label: 'Settings', back: { label: 'Back to Worca', attrs: { 'data-go': 'runs' } }, groups }));
  assert.equal(m.getAttribute('aria-label'), 'Settings');
  assert.equal(m.querySelector('.side-back').dataset.go, 'runs');
  assert.equal(m.querySelector('[aria-current="page"]').textContent, 'General');
  assert.equal(m.querySelector('.side-g').textContent, 'Worca');
  const l = dom(C.sideMenu({ label: 'Settings', list: true, chevron: '<svg class="ch"></svg>', groups }));
  assert.ok(l.classList.contains('is-list'));
  assert.equal(l.querySelectorAll('.side-i svg.ch').length, 2);
  assert.equal(dom(C.backLink({ label: 'Settings', attrs: { 'data-sset': '' } })).textContent, 'Settings');
  const s = dom(C.search({ value: 'pro', label: 'Search settings', results: C.searchResults([{ id: 'srch|1', text: 'Proxy', where: 'Runs › Network' }]) }));
  assert.equal(s.querySelector('input[data-search]').value, 'pro');
  assert.equal(s.querySelector('[data-menu-pick="srch|1"] .mi-hint').textContent, 'Runs › Network');
  assert.equal(dom(C.searchResults([], 'No setting matches')).querySelector('[aria-disabled="true"]').textContent, 'No setting matches');
});

test('the library takes real addresses and knows no page: a Trail step and a PR link go where they are told', () => {
  assert.equal(dom(C.trail({ items: [{ label: 'Runs', href: '#runs' }, { label: 'x' }] })).querySelector('a').getAttribute('href'), '#runs');
  const place = dom(C.workPlace({ branch: 'feat/x', base: 'dev', pr: '#9', prUrl: 'https://git.example/9', host: 'GitLab', copy: true, prAttrs: { 'data-p': '1' } }));
  const pr = place.querySelector('.rc-pr');
  assert.equal(pr.getAttribute('href'), 'https://git.example/9'); assert.equal(pr.getAttribute('title'), 'Open #9 on GitLab'); assert.equal(pr.dataset.p, '1');
  assert.equal(place.querySelector('[data-say]'), null);
});

test('usageRing and panelFrame: a ring shows its share and its warning line; a panel is its head and a body that scrolls', () => {
  const ring = dom(C.usageRing({ pct: 130, warnAt: 80, tone: 'over', cls: 'x' }));
  assert.match(ring.getAttribute('style'), /--p:100;--w:80/); assert.ok(ring.classList.contains('is-over')); assert.ok(ring.classList.contains('x'));
  const p = dom(C.panelFrame({ label: 'Pulse', head: '<i></i>', body: '<b></b>', foot: '<u></u>', cls: 'y' }));
  assert.equal(p.getAttribute('aria-label'), 'Pulse'); assert.ok(p.classList.contains('y'));
  assert.ok(p.querySelector('.panel-head i') && p.querySelector('.panel-body b') && p.querySelector(':scope > u'));
});

test('land and dialog hooks: the target lights once, comes into view and takes focus; a Dialog carries the page\'s hooks and class', () => {
  const { window } = new JSDOM('<div id="t"></div>');
  let scrolled = null; const t = window.document.getElementById('t');
  t.scrollIntoView = (o) => { scrolled = o; };
  window.matchMedia = () => ({ matches: false });
  C.land(t);
  assert.ok(t.hasAttribute('data-landed'));
  assert.equal(scrolled.block, 'center');
  assert.equal(window.document.activeElement, t);   // it takes the focus, and only scrollIntoView moves the page
  let opts = null; const b = window.document.createElement('button'); window.document.body.append(b); b.focus = (o) => { opts = o; }; C.land(b);
  assert.deepEqual(opts, { preventScroll: true });
  const d = dom(C.dialog({ title: 'Create PR', body: '', yes: 'Create PR', cls: 'is-wide', hooks: { yes: { 'data-pd': 'ok' }, cancel: { 'data-pd': 'cancel' } } }));
  assert.ok(d.querySelector('.card.dlg.rl-dialog.is-wide'));
  assert.equal(d.querySelector('[data-dialog="yes"]').dataset.pd, 'ok');
  assert.equal(d.querySelector('[data-dialog="cancel"]').dataset.pd, 'cancel');
});

test('trail and pager: one depth up, never the page itself, the parent marked for narrow screens; siblings, one that cannot open says why', () => {
  const t = dom(C.trail({ items: [{ label: 'Runs', attrs: { 'data-key': 'crumb:0' } }, { label: 'worca-cc', button: true, attrs: { 'data-crumb': 1 } }] }));
  assert.equal(t.getAttribute('aria-label'), 'Breadcrumb');
  assert.deepEqual([...t.querySelectorAll('.rc-crumb')].map((x) => [x.tagName, x.textContent, x.title]), [['A', 'Runs', 'Runs'], ['BUTTON', 'worca-cc', 'worca-cc']]);
  assert.ok(t.querySelector('li:last-child').classList.contains('is-parent'));
  const p = dom(C.pager({ label: 'Runs in this group', index: 1, n: 3, noun: 'run', prev: { ok: true, attrs: { 'data-sib': 0 } }, next: { ok: false, why: 'Run 3 hasn’t started' }, icons: { prev: '<svg></svg>', next: '<svg></svg>' } }));
  const [a, b] = p.querySelectorAll('button');
  assert.equal(p.querySelector('.rc-pager-n').textContent, '2 of 3');
  assert.equal(a.getAttribute('aria-label'), 'Previous run');
  assert.equal(a.disabled, false);
  assert.ok(b.disabled);
  assert.equal(b.title, 'Run 3 hasn’t started');
});

test('row: four slots in order; an unknown kind throws; ListRow and SettingsRow are built on it', () => {
  const r = dom(C.row({ rail: '<i></i>', text: '<b>t</b>', end: '<u>e</u>', more: '<s>m</s>', cls: 'is-x', attrs: { 'data-a': '1' } }));
  assert.equal(r.className, 'list-row is-x'); assert.equal(r.dataset.a, '1');
  assert.deepEqual([...r.children].map((e) => e.className || e.tagName), ['lr-rail', 'B', 'lr-end']);
  assert.equal(r.querySelector('.lr-end').children.length, 2);
  assert.throws(() => C.row({ kind: 'nope' }), /unknown kind/);
  assert.equal(dom(C.listRow({ title: 'x' })).className, 'list-row');
  assert.equal(dom(C.settingsRow({ name: 'x' })).className, 'set-row');
  assert.equal(dom(C.row({ kind: 'step', text: '' })).tagName, 'LI');
});

test('chip and checkbox: a fact that never acts; a labelled box that says why when off', () => {
  assert.equal(dom(C.chip({ text: 'Beta <1>' })).textContent, 'Beta <1>');
  const b = dom(C.checkbox({ label: 'Draft', checked: true, disabled: true, why: 'Locked', attrs: { id: 'x' } }));
  assert.equal(b.title, 'Locked'); const i = b.querySelector('input');
  assert.ok(i.checked && i.disabled); assert.equal(i.id, 'x');
});

test('optionList: real radios, one tab stop, Worca\'s pick marked, your own answer under it', () => {
  const box = new JSDOM(`<body><div>${C.optionList({ label: 'Q', options: ['a', 'b'], selected: 0, recommended: 1, own: '<input id="own">', optAttrs: (i) => ({ 'data-answer': i }) })}</div>`).window.document.body.firstElementChild;
  const r = box.querySelectorAll('[role=radio]');
  assert.equal(r[0].getAttribute('aria-checked'), 'true'); assert.equal(r[1].tabIndex, -1);
  assert.ok(r[1].querySelector('.sc-ans-hint')); assert.ok(!r[0].querySelector('.sc-ans-hint'));
  assert.ok(box.querySelector('#own'));
});

test('suggestionField: the shimmer and read only while it writes; the text stays when it could not', () => {
  const w = dom(C.suggestionField({ id: 'x', value: 'kept', writing: true, writingPlaceholder: 'Writing…', placeholder: 'T' }));
  assert.match(w.className, /is-writing/); const i = w.querySelector('input');
  assert.equal(i.value, ''); assert.ok(i.readOnly); assert.equal(i.placeholder, 'Writing…');
  const ta = dom(C.suggestionField({ id: 'y', value: 'a<b', rows: 3 })).querySelector('textarea');
  assert.equal(ta.value, 'a<b');
  assert.match(C.suggestionFail({ model: 'Haiku' }), /The text is as it was/);
  assert.match(C.suggestButton({ tip: 'Draft' }), /title="Draft"/);
});

test('tagGroup and listEditor: one button, one editor; a name escaped; many or one pick', () => {
  const g = dom(C.tagGroup({ items: [{ kind: 'label', text: 'u<i' }], open: true, editor: '<div id="ed"></div>' }));
  assert.equal(g.querySelector('.rc-tag').firstChild.textContent, 'u<i'); assert.ok(g.querySelector('#ed'));
  assert.equal(dom(C.tagGroup({ items: [], editor: '<div id="ed"></div>' })).querySelector('#ed'), null);
  const e = dom(C.listEditor({ label: 'L', inputId: 'i', placeholder: 'p', sections: [{ title: 'T', kind: 'tag', many: true, rows: [{ text: 'a', n: 2, on: true }] }, { title: 'G', kind: 'group', many: false, rows: [{ text: 'b', n: 1, on: false }] }] }));
  assert.equal(e.querySelector('[data-listtoggle="tag|a"]').getAttribute('role'), 'menuitemcheckbox');
  assert.equal(e.querySelector('[data-listtoggle="group|b"]').getAttribute('role'), 'menuitemradio');
});

test('stepper and stepRow: a real tablist, one tab stop; a row\'s mark, rounds and second line', () => {
  const box = new JSDOM(`<body><div>${C.stepper({ stages: [{ key: 'a', label: 'Plan', selected: true, cells: ['is-done'] }, { key: 'b', label: 'Build', cells: ['is-next', 'is-next'] }] })}</div>`).window.document.body.firstElementChild;
  const tabs = box.querySelectorAll('[role=tab]'); assert.equal(tabs[0].tabIndex, 0); assert.equal(tabs[1].tabIndex, -1);
  assert.equal(box.querySelectorAll('.sc-seg')[1].children.length, 2);
  const look = C.stepLook({ state: 'now', name: 'Build', time: '2m', loops: 2, live: 'Editing', when: '3s ago' });
  const r = dom(C.stepRow(Object.assign(look, { roundsKey: 'k' })));
  assert.equal(r.tagName, 'LI'); assert.equal(r.querySelector('.rd-route-dot').getAttribute('aria-label'), 'In progress');
  assert.equal(r.querySelector('.sc-loop.is-btn').dataset.rounds, 'k'); assert.match(r.querySelector('.sc-line').textContent, /Editing · 3s ago/);
  assert.ok(dom(C.stepRow(look, { full: true, action: '<i id="a"></i>' })).querySelector('.sc-act #a'));
});

test('table: the name first, figures tabular, what drops on a narrow screen is in the row\'s detail', () => {
  const t = dom(C.table({ label: 'Sessions', columns: [{ id: 'n', label: 'Name' }, { id: 'c', label: 'Cost', num: true }, { id: 'm', label: 'Model', narrow: false }], rows: [{ n: 'x', c: '$1', m: 'Opus' }] }));
  assert.equal(t.querySelector('table').getAttribute('aria-label'), 'Sessions');
  assert.match(t.querySelector('td.is-num').textContent, /\$1/); assert.match(t.querySelector('.rt-detail').textContent, /Model Opus/);
});

test('icon: one set; an unknown name draws nothing', () => {
  assert.match(C.icon('check', 12), /width="12"/); assert.equal(C.icon('nope'), '');
});

test('copyButton: a quiet icon button; the tick and Copied for a moment, then back', () => {
  const b = dom(C.copyButton({ text: 'feat/x', label: 'Copy branch' }));
  assert.equal(b.dataset.copy, 'feat/x'); assert.match(b.className, /btn-quiet/); assert.equal(b.getAttribute('aria-label'), 'Copy branch');
  let later = null; C.copied(b, { wait: (fn) => { later = fn; } });
  assert.ok(b.classList.contains('is-copied')); assert.equal(b.title, 'Copied'); assert.equal(b.querySelector('[role=status]').textContent, 'Copied');
  later(); assert.ok(!b.classList.contains('is-copied')); assert.equal(b.title, 'Copy branch');
});

test('the shell pieces: offline line, side column, action row, away screen', () => {
  const off = dom(C.offlineLine());
  assert.equal(off.getAttribute('role'), 'status');
  assert.match(off.textContent, /Offline · retrying/);
  assert.ok(off.title);
  const side = new JSDOM(`<body>${C.sideColumn({ title: 'Ask <worca>', body: '<p>x</p>', hooks: { close: { 'data-side-close': '' } } })}</body>`).window.document;
  assert.equal(side.querySelector('.ask-side-grip').getAttribute('aria-valuemax'), '680');
  assert.equal(side.querySelector('.rl-side-title').textContent, 'Ask <worca>');
  assert.ok(side.querySelector('[data-side-close]'));
  const on = { away: true, keepAwake: true, focused: true, idleMs: C.AWAY_IDLE_MS, reduced: false };
  assert.equal(C.awayShows(on), true);
  for (const off2 of [{ away: false }, { keepAwake: false }, { focused: false }, { idleMs: C.AWAY_IDLE_MS - 1 }, { reduced: true }]) assert.equal(C.awayShows({ ...on, ...off2 }), false);
  assert.equal(dom(C.awayScreen({ line: 'All <quiet>' })).querySelector('.rl-away-line').textContent, 'All <quiet>');
});

test('workflowGraph: a lane per stage, a node acts and says its state, a gate has its pip', () => {
  const g = dom(C.workflowGraph({ stages: [{ label: 'Plan', nodes: [{ key: 'a', name: 'Plan', state: 'done', gate: true, loops: 2, selected: true }] }], end: 'End · Ready' }));
  assert.equal(g.querySelectorAll('.wg-stage').length, 2);
  const n = g.querySelector('.wg-node');
  assert.equal(n.dataset.node, 'a'); assert.equal(n.getAttribute('aria-pressed'), 'true'); assert.match(n.title, /Done · a gate/);
  assert.ok(n.querySelector('.wg-pip')); assert.ok(n.querySelector('.wg-loop'));
});

test('logLines: one line per entry, a problem in its colour, words escaped', () => {
  const l = dom(C.logLines({ label: 'Log', lines: [{ t: '1', from: 'Plan', text: '<b>' }, { t: '2', from: 'Plan', lvl: 'error', text: 'x' }] }));
  assert.equal(l.querySelectorAll('.lg-row').length, 2);
  assert.ok(l.querySelector('.lg-row.is-error'));
  assert.equal(l.querySelector('.lg-text').textContent, '<b>');
});

test('stackRow: its own actions sit at its end', () => {
  const r = dom(C.stackRow({ num: '1', title: 'A', word: 'Small', sub: 'x', state: 'next', rowCls: 'is-next', dotCls: 'is-future', icon: '', end: '<button id="m"></button>' }));
  assert.ok(r.querySelector('#m'));
});

test('compactMenu and menuItem: a page may name the attribute a pick reads, and animate what holds the menu', () => {
  const m = dom(C.compactMenu({ items: [{ id: 'a|b', text: 'B', checked: true }], cls: 'x', pickAttr: 'data-pick', motion: false }));
  assert.equal(m.hasAttribute('data-motion'), false);
  assert.equal(m.querySelector('.menu-item').getAttribute('data-pick'), 'a|b');
  const it = dom(C.menuItem({ text: 'Simple', checked: false, help: 'Why' }, { pickAttr: null, attrs: { 'data-level': 'simple' } }));
  assert.equal(it.getAttribute('role'), 'menuitemradio');
  assert.equal(it.getAttribute('data-level'), 'simple');
  assert.equal(it.hasAttribute('data-menu-pick'), false);
});

test('statusDotClass, the button\'s count, the checkbox without words or with a link', () => {
  assert.equal(C.statusDotClass('is-green'), 'status-dot is-green');
  assert.equal(dom(C.statusDot({ tone: 'is-green' })).className, C.statusDotClass('is-green'));
  assert.equal(dom(C.button({ label: 'Clear', count: 3 })).querySelector('.runs-bulk-c').textContent, '3');
  assert.equal(dom(C.button({ label: 'Clear' })).querySelector('.runs-bulk-c'), null);
  const bare = C.checkbox({ cls: 'pz-check', why: 'Select', attrs: { 'aria-label': 'Select a' } });
  assert.match(bare, /<input[^>]*><\/label>$/);
  assert.equal(dom(C.checkbox({ html: 'A <b>b</b>' })).querySelector('span b').textContent, 'b');
});

test('tabs with no panel: the page\'s hooks in place of the panel\'s', () => {
  const t = dom(C.tabs({ items: [{ id: 'vitals', label: 'Vitals', count: 2, selected: true }], hooks: (x) => ({ 'data-ptab': x.id }) })).querySelector('.tab');
  assert.equal(t.getAttribute('data-ptab'), 'vitals');
  assert.equal(t.getAttribute('aria-selected'), 'true');
  assert.equal(t.hasAttribute('data-tab'), false);
  assert.equal(t.querySelector('.n').textContent, '2');
});

test('wordPicker: the chosen words, escaped, its menu under it', () => {
  const p = dom(C.wordPicker({ text: 'a<b', chevron: '<svg></svg>', open: true, menuHtml: '<div class="menu"></div>', tip: 'Base', cls: 'pd-ship', attrs: { 'data-menu': 'x' } }));
  const b = p.querySelector('button.pd-base.pd-ship');
  assert.equal(b.textContent, 'a<b');
  assert.equal(b.getAttribute('aria-expanded'), 'true');
  assert.equal(b.title, 'Base');
  assert.ok(p.querySelector('.menu'));
});

test('lineRow, fileRow and stackedPrRow: a row that opens says so; a made PR no longer opens', () => {
  const l = dom(C.lineRow({ mark: '<i></i>', text: 'a<b', open: true, more: '<p>x</p>', attrs: { 'data-line': 'k' } }));
  assert.ok(l.classList.contains('ov-line') && l.classList.contains('is-open'));
  assert.equal(l.querySelector('button').getAttribute('aria-expanded'), 'true');
  assert.equal(l.querySelector('button span').textContent, 'a<b');
  assert.equal(l.querySelector('.ov-line-more p').textContent, 'x');
  const go = dom(C.lineRow({ mark: '', text: 'x', link: true })).querySelector('button');
  assert.ok(go.classList.contains('is-link'));
  assert.equal(go.hasAttribute('aria-expanded'), false);
  const f = dom(C.fileRow({ status: 'A', name: 'a.js', dir: 'ui', path: 'ui/a.js', notes: 2, added: 3, removed: 1, open: true }));
  assert.equal(f.querySelector('.ch-st').title, 'Added');
  assert.equal(f.querySelector('.ch-notes').title, '2 review comments');
  assert.equal(f.querySelector('.del').textContent, '−1');
  assert.equal(dom(C.fileRow({ status: 'M', name: 'a', dir: '', path: 'a', added: 0, removed: 0 })).querySelector('.ch-notes').textContent, '');
  const pr = dom(C.stackedPrRow({ n: 2, title: 'T', line: '', meta: ['x', 'y'], open: true, body: '<p>f</p>' }));
  assert.equal(pr.querySelector('.st-num').textContent, 'PR 2');
  assert.equal(pr.querySelector('.st-body p').textContent, 'f');
  const made = dom(C.stackedPrRow({ n: 1, title: 'T', line: '', meta: [], open: true, made: true, body: '<p>f</p>' }));
  assert.ok(made.querySelector('.st-head').disabled);
  assert.equal(made.querySelector('.st-body'), null);
});

test('pulseRow: its mark, the tick box on the rail while selecting, its text opens it', () => {
  const r = dom(C.pulseRow({ title: 'a<b', meta: 'm', time: 't', tip: 'Opens', id: 'k', check: true, unread: true, resolved: true }));
  assert.ok(r.classList.contains('pz-row') && r.classList.contains('is-sel') && r.classList.contains('is-unread'));
  assert.ok(r.querySelector('.pz-rail .pz-unread'));
  assert.equal(r.querySelector('.pz-check input').getAttribute('data-sel'), 'k');
  assert.equal(r.querySelector('.pz-check input').checked, true);
  assert.equal(r.querySelector('.pz-row-main').getAttribute('data-open'), 'k');
  assert.ok(r.querySelector('.pz-resolved'));
  assert.ok(!r.querySelector('.pz-row-tt .pz-resolved'), 'the title shortens, the state word beside it never does');
  assert.equal(dom(C.pulseRow({ mark: '<i></i>', title: 'a', meta: 'm', time: 't', tip: 'x', id: 'k' })).querySelector('.pz-check'), null);
});

test('navItem, accountButton, topBarAction: the shell\'s own buttons', () => {
  const n = dom(C.navItem({ label: 'Runs', icon: '', current: true, attrs: { 'data-go': 'runs' } }));
  assert.ok(n.classList.contains('is-on'));
  assert.equal(n.getAttribute('aria-current'), 'page');
  const off = dom(C.navItem({ label: 'Chats', icon: '', off: true, title: 'Chats is not here' }));
  assert.equal(off.getAttribute('aria-disabled'), 'true');
  assert.ok(off.title);
  const a = dom(C.accountButton({ name: 'A <b>', avatar: '', chevron: '', label: 'Account', away: true, open: true }));
  assert.equal(a.dataset.presence, 'away');
  assert.equal(a.getAttribute('aria-expanded'), 'true');
  assert.equal(a.querySelector('.pz-acct-name').textContent, 'A <b>');
  const top = dom(C.topBarAction({ label: 'Pulse', icon: '', labelCls: 'l', kind: 'quiet', badge: { n: 3, tone: 'need' } }));
  assert.ok(top.classList.contains('btn-sm') && top.classList.contains('btn-quiet'));
  assert.equal(top.querySelector('.topnav-badge').dataset.tone, 'need');
  assert.equal(dom(C.topBarAction({ label: 'P', icon: '', labelCls: 'l', full: true })).classList.contains('btn-sm'), false);
});

test('accountItem, navFlyout, themeChoice, cardTitleLink: the account menu\'s parts', () => {
  const i = dom(C.accountItem({ label: 'Mode', value: 'Expert', chev: '<svg></svg>', attrs: { 'data-sub': '' } }));
  assert.equal(i.getAttribute('role'), 'menuitem');
  assert.equal(i.querySelector('.mi-val').textContent, 'Expert');
  assert.equal(i.getAttribute('data-sub'), '');
  const sw = dom(C.accountItem({ label: 'Away', sw: true, hint: 'h', attrs: { role: 'menuitemcheckbox' } }));
  assert.equal(sw.getAttribute('role'), 'menuitemcheckbox');
  assert.ok(sw.querySelector('.switch'));
  assert.equal(dom(C.accountItem({ label: 'x' })).querySelector('.mi-val'), null);
  assert.ok(dom(C.accountItem({ label: 'x', valueAlways: true })).querySelector('.mi-val'));
  const fl = dom(C.navFlyout({ label: 'Account', cls: 'acct-menu', body: '<p></p>' }));
  assert.equal(fl.className, 'menu nav-fly acct-menu');
  assert.equal(fl.getAttribute('aria-label'), 'Account');
  const th = dom(C.themeChoice({ label: 'Dark', icon: '', on: true }));
  assert.ok(th.classList.contains('on'));
  assert.equal(th.getAttribute('aria-checked'), 'true');
  assert.equal(dom(C.cardTitleLink({ label: 'Spend' })).getAttribute('role'), 'menuitem');
});

test('the small parts: confirmForm, figureBreakdown, dialogFrame, documentLink, toastUndo, failureLink, previewToggle, suggestionPreview', () => {
  const f = dom(C.confirmForm({ form: 'after', text: 'a<b', body: '<input>' }));
  assert.equal(f.tagName, 'FORM');
  assert.equal(f.dataset.form, 'after');
  assert.equal(f.querySelector('.rc-confirm-t').textContent, 'a<b');
  const b = dom(C.figureBreakdown({ label: 'Cost', rows: [['Plan', '$1']], total: '$1', help: 'h' }));
  assert.equal(b.querySelector('.is-total .ct').textContent, '$1');
  assert.equal(b.getAttribute('role'), 'dialog');
  assert.equal(dom(C.dialogFrame({ label: 'New run', cls: 'x', scrimCls: 'is-in', body: '<p></p>' })).firstElementChild.getAttribute('aria-modal'), 'true');
  assert.equal(dom(C.documentLink({ name: 'a<b' })).querySelector('code').textContent, 'a<b');
  assert.ok(dom(C.toastUndo({ title: 'Puts them back' })).hasAttribute('data-undo'));
  assert.equal(dom(C.failureLink({ label: 'Details' })).textContent, 'Details');
  assert.equal(dom(C.previewToggle({ on: true })).getAttribute('aria-pressed'), 'true');
  assert.ok(dom(C.suggestionPreview({ html: '<p></p>', writing: true })).classList.contains('is-writing'));
  assert.equal(C.TRACKER_MOVES.jira[0], 'In review');
});

test('morph: a textarea shows the new text, even when its text node moves across', () => {
  const host = new JSDOM('<body><div id="t"><textarea id="x"></textarea></div></body>').window.document.getElementById('t');
  C.morph(host, '<textarea id="x">new words</textarea>');
  assert.equal(host.querySelector('#x').value, 'new words');
});

test('thumbBox and watchScrollbars: a bar sits where the scroller is, shows on a mouse move, goes when still, once per document', () => {
  assert.deepEqual(C.thumbBox(0, 1000, 500), { offset: 0, length: 250 });
  assert.deepEqual(C.thumbBox(500, 1000, 500), { offset: 250, length: 250 });
  assert.equal(C.thumbBox(0, 500, 500), null, 'nothing overflows, no bar');
  assert.equal(C.thumbBox(0, 100000, 100).length, 24, 'never too small to grab');
  const d = new JSDOM('<body><div id="a" style="overflow-y:auto"><span id="in"></span></div><div id="b"></div></body>').window.document; const later = [];
  C.watchScrollbars(d, { wait: (fn) => { later.push(fn); return later.length; }, clear: () => {} });
  C.watchScrollbars(d, { wait: () => { throw new Error('watched twice'); } });
  const a = d.getElementById('a'); Object.defineProperty(a, 'scrollHeight', { value: 100 }); Object.defineProperty(a, 'clientHeight', { value: 50 });
  d.getElementById('b').dispatchEvent(new d.defaultView.MouseEvent('mousemove', { bubbles: true }));
  assert.equal(d.querySelector('.rail-thumb'), null, 'what cannot scroll has no bar');
  d.getElementById('in').dispatchEvent(new d.defaultView.MouseEvent('mousemove', { bubbles: true }));
  const th = d.querySelector('.rail-thumb.is-v'); assert.ok(th.classList.contains('is-on')); assert.equal(th.style.height, '25px');
  later.shift()(); assert.ok(!th.classList.contains('is-on'), 'gone when still');
  later.shift()(); assert.equal(d.querySelector('.rail-thumb'), null);
  // A bar in a panel sits on top of that panel; a page's stays under what opens over it.
  const m = d.body.appendChild(d.createElement('div')); m.setAttribute('role', 'dialog'); m.style.overflowY = 'auto';
  Object.defineProperty(m, 'scrollHeight', { value: 100 }); Object.defineProperty(m, 'clientHeight', { value: 50 });
  m.dispatchEvent(new d.defaultView.MouseEvent('mousemove', { bubbles: true }));
  assert.ok(d.querySelector('.rail-thumb').classList.contains('is-over'));
});

test('selectionBar: how many, each action with its count, disabled at 0 with why, Cancel', () => {
  const b = dom(C.selectionBar({ label: 'Selected updates', count: 2, actions: [{ id: 'read', label: 'Mark read', n: 0, tip: 'x', why: 'All read already' }, { id: 'clear', label: 'Clear', n: 2, tip: 'Moves them' }] }));
  assert.equal(b.className, 'runs-bulk'); assert.equal(b.getAttribute('role'), 'toolbar'); assert.equal(b.getAttribute('aria-label'), 'Selected updates');
  assert.equal(b.querySelector('.runs-bulk-n').textContent, '2 selected');
  const read = b.querySelector('[data-bulk="read"]'), clear = b.querySelector('[data-bulk="clear"]');
  assert.ok(read.disabled); assert.equal(read.title, 'All read already');
  assert.ok(!clear.disabled); assert.equal(clear.title, 'Moves them'); assert.match(clear.textContent, /Clear.*2/);
  assert.ok(b.querySelector('[data-bulk="cancel"]'));
  const none = dom(C.selectionBar({ label: 'x', count: 0, actions: [{ id: 'a', label: 'A', n: 0, tip: '' }] }));
  assert.equal(none.querySelector('[data-bulk="a"]').title, 'Nothing selected');
});

test('selectAllBox: checked at all, mixed at some', () => {
  const box = (state) => dom(C.selectAllBox({ state })).querySelector('input');
  assert.ok(box('all').checked); assert.ok(!box('none').checked); assert.ok(!box('some').checked);
  assert.ok(box('some').hasAttribute('data-mixed')); assert.ok(!box('all').hasAttribute('data-mixed'));
  assert.ok(box('all').hasAttribute('data-selall'));
});

test('bindLongPress: holding a row presses it and swallows its click; a move or a mouse does not', async () => {
  const { window: w } = new JSDOM('<body><div class="r" id="a"></div><div class="r" id="no"></div></body>');
  const d = w.document, a = d.getElementById('a'); const hits = [];
  const off = C.bindLongPress({ root: d, selector: '.r', accept: (r) => r.id !== 'no', onPress: (r) => hits.push(r.id), win: w });
  const ptr = (t, el, o = {}) => { const e = new w.Event(t, { bubbles: true, cancelable: true }); Object.assign(e, { pointerType: 'touch', clientX: 0, clientY: 0 }, o); el.dispatchEvent(e); return e; };
  const wait = () => new Promise((r) => setTimeout(r, C.PRESS_MS + 40));
  ptr('pointerdown', a, { pointerType: 'mouse' }); await wait(); assert.deepEqual(hits, [], 'a mouse does not');
  ptr('pointerdown', d.getElementById('no')); await wait(); assert.deepEqual(hits, [], 'a row that cannot be selected');
  ptr('pointerdown', a); ptr('pointermove', a, { clientX: 40 }); await wait(); assert.deepEqual(hits, [], 'a finger that moves scrolls');
  ptr('pointerdown', a); ptr('pointerup', a); await wait(); assert.deepEqual(hits, [], 'a tap');
  ptr('pointerdown', a); await wait(); assert.deepEqual(hits, ['a']);
  const click = new w.MouseEvent('click', { bubbles: true, cancelable: true }); a.dispatchEvent(click);
  assert.ok(click.defaultPrevented, 'the click that follows is swallowed');
  const next = new w.MouseEvent('click', { bubbles: true, cancelable: true }); a.dispatchEvent(next);
  assert.ok(!next.defaultPrevented, 'only that one');
  off();
});

test('shortcutsSheet: a Dialog with only Close, drawn from the table, ⌘ or Ctrl', () => {
  const s = dom(C.shortcutsSheet({ mac: true }));
  assert.ok(s.classList.contains('viewer-modal') && s.classList.contains('keys-modal')); assert.equal(s.getAttribute('aria-modal'), 'true');
  assert.equal(s.querySelector('.dlg-title').textContent, 'Keyboard shortcuts');
  assert.equal(s.querySelectorAll('button').length, 1); assert.equal(s.querySelector('button').textContent, 'Close');
  assert.ok(!s.querySelector('input, form'), 'no form');
  const rows = [...s.querySelectorAll('.keys-row')];
  const sections = C.shortcutSections();
  assert.equal(rows.length, sections.flatMap((x) => x.rows).length);
  const search = rows.find((r) => r.textContent.includes('Search or ask'));
  assert.deepEqual([...search.querySelectorAll('kbd')].map((k) => k.textContent), ['⌘', 'K']);
  const pc = [...dom(C.shortcutsSheet({ mac: false })).querySelectorAll('.keys-row')].find((r) => r.textContent.includes('Search or ask'));
  assert.deepEqual([...pc.querySelectorAll('kbd')].map((k) => k.textContent), ['Ctrl', 'K']);
  const only = dom(C.shortcutsSheet({ sections: C.shortcutSections({ scopes: ['run'] }) }));
  assert.deepEqual([...only.querySelectorAll('.keys-h')].map((h) => h.textContent), ['Run page']);
});

test('openShortcutsSheet: one at a time, holds the keys, Esc or Close closes and the focus goes back', () => {
  const { window: w } = new JSDOM('<body><button id="o">Open</button></body>', { pretendToBeVisual: true });
  const d = w.document, o = d.getElementById('o'); let reached = 0;
  d.addEventListener('keydown', () => { reached += 1; }); d.addEventListener('click', () => { reached += 1; });
  o.focus();
  const m = C.openShortcutsSheet({ doc: d });
  assert.equal(C.openShortcutsSheet({ doc: d }), m);
  assert.equal(d.activeElement.textContent, 'Close');
  d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'j', bubbles: true }));
  assert.equal(reached, 0, 'no key reaches the page');
  d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(d.querySelector('.keys-modal'), null); assert.equal(d.activeElement, o);
  C.openShortcutsSheet({ doc: d });
  d.querySelector('[data-dialog="yes"]').click();
  assert.equal(d.querySelector('.keys-modal'), null); assert.equal(reached, 0, 'its click stays its own');
});

test('listSentence, listWord: its words, one menu open, a pick reports its id and each choice its count', () => {
  const p = new JSDOM(`<div>${C.listSentence({ open: 'by', parts: [{ word: 'Showing', id: 'show', text: 'a<ll', items: [] }, { word: 'by', id: 'by', text: 'state', items: [{ id: 'day', text: 'day', hint: '5', checked: false }] }] })}</div>`).window.document.body.firstElementChild;
  assert.match(p.textContent, /^Showing a<ll by state/);
  assert.equal(p.querySelectorAll('.list-part').length, 2, 'each word stays with its picker');
  assert.equal(p.querySelectorAll('[data-menu]').length, 2);
  assert.equal(p.querySelector('[data-pick="by|day"] .mi-hint').textContent, '5');
  assert.equal(dom(`<div>${C.listWord({ id: 'x', text: 't', items: [] })}</div>`).querySelector('.menu'), null);
});

test('listRow: while selecting its tick box takes the mark\'s place; unread, current, what sits under it', () => {
  const m = dom(C.listRow({ title: 'a', mark: C.statusDot({ tone: 'is-green' }), open: {} }));
  assert.ok(m.querySelector('.status-dot')); assert.equal(m.querySelector('input'), null);
  const s = dom(C.listRow({ title: 'a', mark: C.statusDot({ tone: 'is-green' }), check: true, boxAttrs: { 'data-sel': 'a' }, unread: true, current: true, after: '<i>x</i>' }));
  assert.equal(s.querySelector('.status-dot'), null); assert.ok(s.querySelector('input[data-sel="a"]').checked);
  assert.match(s.className, /is-unread/); assert.equal(s.getAttribute('aria-current'), 'true');
  assert.ok(s.querySelector('.lr-after i'));
});

test('groupRow, roundRows: its count and ⌄, members only while open; rounds, then +n earlier', () => {
  const open = dom(C.groupRow({ title: 'g', count: '2/3', noun: 'runs', shown: true, open: { 'data-open': 'g' }, toggle: { 'data-fold': 'g' }, rows: C.listRow({ title: 'm' }) }));
  assert.equal(open.querySelector('.lr-fig').textContent, '2/3');
  assert.ok(open.querySelector('button.lr-main[data-open="g"]'), 'the row opens its target');
  assert.equal(open.querySelector('[data-fold]').getAttribute('aria-expanded'), 'true');
  assert.equal(open.querySelector('.lr-members .lr-t').textContent, 'm');
  assert.equal(dom(C.groupRow({ title: 'g', count: '1', noun: 'runs', shown: false, toggle: {}, rows: C.listRow({ title: 'm' }) })).querySelector('.lr-members'), null);
  const shut = dom(C.roundRows({ line: 'Round 7', n: 7, open: false, toggle: { 'data-rounds': 'r' } }));
  assert.match(shut.textContent, /7 rounds/); assert.equal(shut.querySelector('.list-row'), null);
  const rs = dom(C.roundRows({ line: 'Round 7', n: 7, open: true, toggle: {}, rounds: [{ n: 7, words: 'w', time: '11:20' }], more: { n: 2, attrs: { 'data-x': '1' } } }));
  assert.equal(rs.querySelector('.lr-t').textContent, 'Round 7 · w'); assert.equal(rs.querySelector('[data-x]').textContent, '+2 earlier');
});

test('listState, originMark, chatKindIcon: a list with no rows; a chat\'s marks say what they are', () => {
  assert.match(dom(C.listState({ state: 'loading', noun: 'runs' })).textContent, /Loading runs/);
  const f = dom(C.listState({ state: 'failed', noun: 'runs', retry: { 'data-retry': '' } }));
  assert.match(f.className, /is-err/); assert.ok(f.querySelector('[data-retry]'));
  assert.equal(dom(C.listState({ state: 'empty', noun: 'runs', text: 'Nothing needs you.' })).querySelector('.el-t').textContent, 'Nothing needs you.');
  assert.equal(dom(C.originMark({ platform: 'slack' })).title, 'From Slack');
  assert.equal(dom(C.originMark({ platform: 'x', label: 'Matter' })).title, 'From Matter');
  assert.equal(dom(C.chatKindIcon(C.CHAT_KINDS.started)).title, 'Started a run');
});

test('listController: draws what a page names; selecting, the sentence, Show N more and a confirm work by clicks', () => {
  const d = new JSDOM('<body><div id="r"></div></body>', { pretendToBeVisual: true }).window.document, root = d.getElementById('r');
  const rows = ['a', 'b', 'c', 'd'].map((k) => ({ key: k, title: k, meta: '', menu: [{ id: 'toggle', text: 'Select' }, { id: 'stop', text: 'Stop' }] }));
  const said = [], did = []; let by = 'x';
  const ctl = C.listController({ root, spec: { noun: 'runs', label: 'Selected', can: () => ['menu'], active: () => true, say: (t) => said.push(t),
    view: () => ({ parts: [{ word: 'by', id: 'by', text: by, items: [{ id: 'y', text: 'y' }] }], tools: [{ id: 'select', text: 'Select' }], sections: [{ id: 's', title: 'S', limit: 2, rows }] }),
    bulk: (r) => [{ id: 'stop', label: 'Stop', n: r.length, tip: 't' }], act: (id, r) => did.push([id, r.map((x) => x.key)]), open: (r) => did.push(['open', r.key]), word: (id, v) => { by = v; return false; } } });
  ctl.paint();
  const click = (sel, o = {}) => root.querySelector(sel).dispatchEvent(new d.defaultView.MouseEvent('click', { bubbles: true, ...o }));
  assert.equal(root.querySelectorAll('.list-row').length, 2); assert.equal(root.querySelector('.list-more').textContent, 'Show 2 more');
  click('[data-more]'); assert.equal(root.querySelectorAll('.list-row').length, 4);
  click('[data-open="a"]'); assert.deepEqual(did.pop(), ['open', 'a']);
  click('[data-open="a"]', { metaKey: true }); assert.deepEqual(ctl.state.pick.ids, ['a']); assert.ok(root.querySelector('.runs-bulk'));
  click('[data-open="c"]', { shiftKey: true }); assert.deepEqual(ctl.state.pick.ids, ['a', 'b', 'c']);
  click('[data-bulk="stop"]'); assert.deepEqual(did.pop(), ['stop', ['a', 'b', 'c']]);
  click('[data-bulk="cancel"]'); assert.equal(root.querySelector('.runs-bulk'), null);
  click('[data-menu="by"]'); click('[data-pick="by|y"]'); assert.equal(by, 'y');
  let ran = 0; ctl.confirm({ text: 'Sure?', yes: 'Go', run: () => { ran++; } });
  click('[data-confirm="yes"]'); assert.equal(ran, 1); assert.equal(root.querySelector('.rc-confirm'), null);
});

test('KindMark: the type until the state matters more; the ring fills by stage; only live work breathes', () => {
  const live = C.kindMark({ kind: 'task', tone: 'run', stage: 2 });
  assert.match(live, /is-run/); assert.match(live, /km-ring/);
  assert.doesNotMatch(C.kindMark({ kind: 'chat' }), /km-ring/, 'an idle chat wears no ring');
  // a Shaper task or a workflow run keeps its type in the centre while it works; only a question or a failure takes it
  assert.match(C.kindMark({ kind: 'feature', tone: 'run', stage: 1 }), /km-ring/, 'its ring still says how far');
  assert.doesNotMatch(C.kindMark({ kind: 'feature', tone: 'run', stage: 1 }), /sym-x|question/);
  assert.equal(C.kindMark({ kind: 'feature', tone: 'run', stage: 1 }), C.kindMark({ kind: 'feature', tone: 'run', stage: 1, keepType: true }), 'the type keeps the centre');
  assert.notEqual(C.kindMark({ kind: 'feature', tone: 'ask', stage: 1 }), C.kindMark({ kind: 'feature', tone: 'ask', stage: 1, keepType: true }), 'a question takes the centre');
  assert.notEqual(C.kindMark({ kind: 'workflow', tone: 'fail', stage: 1 }), C.kindMark({ kind: 'workflow', tone: 'fail', stage: 1, keepType: true }), 'a failure takes the centre');
  assert.equal(C.partsWord(['ok', 'merged', 'run']), '2 of 3');
  assert.doesNotMatch(C.kindMark({ kind: 'event', tone: 'fail' }), /km-ring/, 'an event is a moment, with no progress');
  assert.equal(C.markTone({ word: 'Needs you', sym: 'q' }), 'ask'); assert.equal(C.markTone({ word: 'Needs you', dot: 'is-amber' }), 'act');
  assert.equal(C.markTone({ word: 'Failed', sym: 'x' }), 'fail'); assert.equal(C.markTone({ word: 'Paused' }), 'pause'); assert.equal(C.markTone({ word: 'Merged' }), 'merged'); assert.equal(C.markTone({ word: 'Working', dot: 'is-peach is-pulse' }), 'run');
});
test('GitMark: its status in the tooltip, Watch as a ring', () => {
  assert.match(C.gitMark({ status: 'fail' }), /Checks failing/);
  assert.match(C.gitMark({ status: 'fail', watch: 'fix' }), /is-watch is-fix/);
  assert.doesNotMatch(C.gitMark({ status: 'open' }), /is-watch/);
});
test('Timeline and TimelineCard: each tick where its moment is', () => {
  const h = C.timeline({ ticks: [{ id: 'a', at: 0.5, kind: 'work', tone: 'ask', title: 'A question', line: 'now' }], view: [0, 0.5] });
  assert.match(h, /top:50%/); assert.match(h, /is-ask/); assert.match(h, /data-tick="a"/); assert.match(h, /aria-label="A question, now"/);
  assert.match(C.timelineCard({ mark: '', title: 'A question', at: 0.25 }), /top:25%/);
});
test('BarHead, TurnRow, Composer, StageBar', () => {
  assert.match(C.barHead({ title: 'Chat' }), /data-bar-house/);
  assert.match(C.turnRow({ mark: '', text: 'Ran', body: 'x', open: true, attrs: { 'data-fold-turn': '0' } }), /tr-body/);
  assert.doesNotMatch(C.turnRow({ mark: '', text: 'Ran', body: 'x', attrs: { 'data-fold-turn': '0' } }), /tr-body/);
  assert.match(C.composer({ placeholder: 'Ask', sentence: 's', tools: '', send: 'b' }), /data-composer-t/);
  assert.match(C.stageBar({ labels: ['a', 'b'], stage: 0 }), /<b>a<\/b>/);
});

test('Tooltip: watchTooltips draws a title; tipPlace keeps it inside the window', async () => {
  const at = C.tipPlace({ top: 700, bottom: 720, left: 1000, width: 20 }, { width: 200, height: 40 }, 1024, 730);
  assert.ok(at.top < 700, 'no room under it: it goes above'); assert.ok(at.left + 200 <= 1024 - 8, 'inside the window');
  const { window } = new JSDOM('<body><span id="a" title="What it does">x</span></body>', { pretendToBeVisual: true });
  C.watchTooltips(window.document);
  const a = window.document.getElementById('a');
  a.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
  assert.equal(a.getAttribute('title'), null, 'the browser\'s own never shows');
  await new Promise((r) => setTimeout(r, 220));
  assert.equal(window.document.querySelector('.rail-tip')?.textContent, 'What it does');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(window.document.querySelector('.rail-tip'), null); assert.equal(a.getAttribute('title'), 'What it does');
  // the trigger of an open menu shows no tooltip: it would cover the menu's first item
  a.setAttribute('aria-expanded', 'true'); window.document.body.insertAdjacentHTML('beforeend', '<div role="menu"><button>One</button></div>');
  a.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 220));
  assert.equal(window.document.querySelector('.rail-tip'), null, 'no tooltip over an open menu');
  window.close();
});

test('watchMenus: a menu with no room under it opens above; menuUp says when', () => {
  assert.equal(C.menuUp({ top: 700, bottom: 720 }, 200, 760), true, 'no room under, more above: up');
  assert.equal(C.menuUp({ top: 100, bottom: 120 }, 200, 760), false, 'room under: down');
  assert.equal(C.menuUp({ top: 80, bottom: 100 }, 900, 760), false, 'no room either way: down, where there is more');
  assert.equal(C.menuShift({ left: 200, right: 420 }, { left: 0, right: 280 }), -148, 'past a sidebar\'s edge: it slides back inside');
  assert.equal(C.menuShift({ left: 20, right: 200 }, { left: 0, right: 280 }), 0, 'inside: it stays');
  const { window } = new JSDOM('<body><span class="rc-pop"><button>+</button></span></body>', { pretendToBeVisual: true });
  C.watchMenus(window.document);
  window.document.querySelector('.rc-pop').insertAdjacentHTML('beforeend', '<div class="menu" role="menu"></div>');
  return new Promise((r) => setTimeout(r, 0)).then(() => { assert.ok(window.document.querySelector('.menu').hasAttribute('data-placed'), 'a menu that opens is placed'); window.close(); });
});

test('menus keep one edge only for check marks: a switch item (the account menu) keeps its own layout', () => {
  const css = readFileSync('plans/rail/prototype/design-system/rail.css', 'utf8');
  const lines = css.split('\n').filter((l) => l.includes('.menu:has(.menu-item:is([role="menuitemradio"]'));
  assert.ok(lines.length > 0);
  for (const l of lines) assert.match(l, /:not\(\.sw-item\)/, 'a switch never turns its menu into the check-mark grid');
});

test('taskProposal: a picker opened in its sentence keeps its menu beside it (a sentence is never a <p>, which a menu would close)', () => {
  const pick = C.sentencePicker({ id: 'w', text: 'Default', items: [{ text: 'Lean' }], open: true });
  const { window } = new JSDOM(`<body>${C.taskProposal({ title: 'A', sentence: `Task with ${pick} now` })}</body>`);
  const menu = window.document.querySelector('.spick-menu');
  assert.ok(menu.closest('.spick'), 'the menu stays in its picker');
  assert.match(window.document.querySelector('.tp-sentence').textContent, /Task with Default[\s\S]*now/, 'the sentence stays whole');
  window.close();
});

test('planCard: Full plan folds the plan itself open, to read before approving', () => {
  const shut = C.planCard({ title: 'P', version: 'v1 of 1', roles: [], full: '<h4>Steps</h4>' });
  assert.match(shut, /Full plan/); assert.doesNotMatch(shut, /plan-full/);
  const open = C.planCard({ title: 'P', version: 'v1 of 1', roles: [], full: '<h4>Steps</h4>', fullOpen: true });
  assert.match(open, /class="plan-full"><h4>Steps/); assert.match(open, /Hide the plan/); assert.match(open, /aria-expanded="true"/);
  assert.doesNotMatch(C.planCard({ title: 'P', version: 'v1', roles: [] }), /Full plan/, 'no plan to show: no button');
});

test('topBarAction: its name is its words even when only its icon and badge show', () => {
  assert.match(C.topBarAction({ label: 'Pulse', icon: '', labelCls: 'x', badge: { n: 3 }, title: 'Pulse: 3 need you' }), /aria-label="Pulse: 3 need you"/);
  assert.match(C.topBarAction({ label: 'Pulse', icon: '', labelCls: 'x' }), /aria-label="Pulse"/);
});

test('sentencePicker: a body (a ListEditor) opens in place of its menu, placed as a menu', () => {
  const h = C.sentencePicker({ id: 'l', text: '+ Label', open: true, body: C.listEditor({ label: 'Labels', inputId: 'q', placeholder: 'Find or make a label', sections: [{ title: 'Labels', kind: 'label', many: true, rows: [{ text: 'infra', n: '', on: false }] }] }) });
  assert.match(h, /class="menu spick-menu rc-list-ed"/); assert.match(h, /aria-haspopup="dialog"/); assert.match(h, /Find or make a label/);
});

test('the Rail stylesheets close every rule: one open brace would swallow all that follows', () => {
  for (const f of ['plans/rail/prototype/design-system/rail.css', 'plans/rail/prototype/design-system/rail-look.css', 'plans/rail/prototype/shell/shell.css', 'plans/rail/prototype/pulse/pulse.css']) {
    const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length, f);
  }
});

test('taskCard: every chat card\'s head (its word as kicker), stage bar, actions; opens its stream in place; compact is one line', () => {
  const full = C.taskCard({ title: 'Add CSV', place: 'a into dev', mark: '<i></i>', word: 'Working', detail: 'Plan', stages: C.stageBar({ labels: ['a'], stage: 0 }) });
  assert.match(full, /rc-heading/); assert.match(full, /rc-facts/); assert.match(full, /rc-card/); assert.match(full, /stage-bar/);
  const small = C.taskCard({ compact: true, title: 'Add CSV', mark: '', word: 'Waiting' });
  assert.match(small, /is-compact/); assert.doesNotMatch(small, /rc-heading/);
  assert.match(full, /tp-kicker[\s\S]*Working[\s\S]*rc-heading/); assert.match(small, /class="turn-row/);
  assert.match(C.taskCard({ title: 'x', mark: '', word: 'w', stream: '<i>s</i>', open: true }), /tc-stream"><i>s<\/i>/); assert.doesNotMatch(C.taskCard({ title: 'x', mark: '', word: 'w', stream: '<i>s</i>' }), /<i>s<\/i>/);
});
test('stepper: deepen colours each main stage up to where it is', () => {
  const stages = [{ key: 'a', label: 'A', cells: ['is-done'] }, { key: 'b', label: 'B', cells: ['is-now'] }, { key: 'c', label: 'C', cells: ['is-next'] }];
  const h = C.stepper({ stages, deepen: 'run' });
  assert.match(h, /--sc-mix:65%/); assert.match(h, /is-deep is-run/); assert.doesNotMatch(C.stepper({ stages }), /sc-mix/);
});

test('calmMarks: one breath per tree, three per list', () => {
  assert.equal(C.BREATHE, 3);
  const live = (t) => ({ key: t, title: t, mark: C.kindMark({ kind: 'task', tone: 'run' }) });
  const chat = { ...live('chat'), tree: [live('task')] };
  const rows = [chat, live('a'), live('b'), live('c')];
  C.calmMarks([{ rows }]);
  const still = rows.flatMap((r) => [r, ...(r.tree || [])]).filter((r) => r.mark.includes('is-still')).map((r) => r.key);
  assert.deepEqual(still, ['chat', 'c']);
});

test('kindMark: a filled ring step carries its order, so a changed mark can fill in turn', () => {
  const m = C.kindMark({ kind: 'task', tone: 'run', stage: 1 });
  assert.match(m, /style="--k:0"/); assert.doesNotMatch(C.kindMark({ kind: 'chat' }), /--k:/);
});

test('inView: the tab you are on carries aria-current and is-current', () => {
  const h = C.inView({ items: [{ title: 'A', icon: '', current: true }, { title: 'B', icon: '' }] });
  assert.equal((h.match(/aria-current="page"/g) || []).length, 1); assert.match(h, /is-named is-current/);
});

test('orbMark: a canvas in its phase, its size kept; an unknown phase rests', () => {
  assert.match(C.orbMark(), /data-pattern="w"/); assert.doesNotMatch(C.orbMark({ w: false }), /data-pattern/);
  assert.match(C.orbMark({ phase: 'write', size: 18 }), /<canvas class="dot-orb" data-orb="write" data-pattern="w" data-s="18"/);
  assert.match(C.orbMark({ phase: 'dance' }), /data-orb="rest"/);
  assert.match(C.thinkingRow({ step: 'x', secs: '1s' }), /data-orb="think"/);
});

test('thinkingRow: live says, in one line, what it does and how long, politely; done folds what it did', () => {
  const live = C.thinkingRow({ step: 'Searching the code', secs: '4s' });
  assert.match(live, /class="think-w">Searching the code</); assert.doesNotMatch(live, />Thinking</);
  assert.match(C.thinkingRow({ secs: '1s' }), /class="think-w">Thinking</); assert.match(live, /think-t">4s/); assert.match(live, /aria-live="polite"/);
  const shut = C.thinkingRow({ done: true, secs: '8s', steps: ['Read the chat'], attrs: { 'data-fold-turn': '3' } });
  assert.match(shut, /Thought for 8s/); assert.match(shut, /aria-expanded="false"/); assert.doesNotMatch(shut, /Read the chat/);
  assert.match(C.thinkingRow({ done: true, secs: '8s', steps: ['Read the chat'], open: true, attrs: { 'data-fold-turn': '3' } }), /tr-body is-steps[\s\S]*Read the chat/);
});

test('the review\'s fixes in the library: a quiet field label, Start ▾ on a proposal, ⋯ on a change, danger as quiet words', () => {
  assert.match(C.field({ id: 'x', label: 'Answer', quietLabel: true }), /fld-l is-quiet/);
  const p = C.taskProposal({ title: 't', sentence: '', alts: { open: true, menu: '<i>alts</i>', attrs: { 'data-menu': 'a' } } });
  assert.match(p, /btn-split/); assert.match(p, /<i>alts<\/i>/);
  assert.match(C.changeProposal({ kind: 'Away', title: 'Q', menu: '<u>m</u>' }), /tp-menu"><u>m<\/u>/);
  assert.match(C.changeProposal({ kind: 'X', title: 'Q', actions: [{ label: 'Remove', kind: 'danger' }] }), /btn-quiet[^"]*is-danger/);
});

test('intentChip: a starter armed in the composer: its icon, its name, and ✕ to clear it', () => {
  const h = C.intentChip({ icon: '<i>i</i>', label: 'Build workflow', clear: { 'data-intent-clear': '' } });
  assert.match(h, /kind-chip composer-intent"><i>i<\/i>Build workflow/); assert.match(h, /aria-label="Clear Build workflow"[^>]*data-intent-clear/);
});

test('cardHead: the kicker with its mark and word, the title, one line, facts and ⋯; a feature lists its slices; your words carry task chips', () => {
  const h = C.cardHead({ mark: '<i>m</i>', kicker: 'Running', title: 'Add', why: 'Plan · 1 of 2', facts: '<b>f</b>', menu: '<u>⋯</u>' });
  assert.match(h, /tp-kicker"><i>m<\/i><span>Running<\/span><span class="tp-menu"><u>⋯<\/u>/); assert.match(h, /rc-heading tc-title[^>]*>Add</); assert.match(h, /rc-facts"><b>f<\/b>/); assert.match(h, /tp-why">Plan · 1 of 2/);
  assert.match(C.taskCard({ title: 'F', mark: '', word: 'Running', rows: '<i>slice</i>' }), /tc-rows"><i>slice<\/i>/);
  assert.match(C.youTurn({ text: 'x', refs: [{ text: 'Add CSV', attrs: { 'data-open-ref': 'question' } }] }), /you-ref[^>]*data-open-ref="question"[^>]*>Add CSV/);
});

test('the cards at parity: a proposal\'s own start word, kicker and extra; a change\'s own choices; a plan\'s ⋯ and lines above its review', () => {
  const p = C.taskProposal({ title: 't', sentence: '', start: 'Start planning', kicker: 'Proposed · from BILL-412', extra: '<i>e</i>' });
  assert.match(p, />Start planning</); assert.match(p, /Proposed · from BILL-412/); assert.match(p, /tp-extra"><i>e<\/i>/);
  const c = C.changeProposal({ kind: 'Web access', title: 'Read a page', actions: [{ label: 'Allow in chat', kind: 'primary', attrs: { 'data-x': '1' } }, { label: 'Deny' }] });
  assert.match(c, />Allow in chat</); assert.match(c, /data-x="1"/); assert.match(c, />Deny</); assert.doesNotMatch(c, />Apply</);
  const pl = C.planCard({ title: 'P', version: 'v1', roles: [], menu: '<u>m</u>', extra: '<i>shape check</i>' });
  assert.match(pl, /tp-menu"><u>m<\/u>/); assert.match(pl, /<i>shape check<\/i>[\s\S]*Reviewed by/);
});

test('taskProposal: the composer sentence, Customise folding, Start and Not now with their hooks', () => {
  const h = C.taskProposal({ title: 'Add export', why: 'From this chat', sentence: '<i>s</i>', more: '<i>m</i>', nudge: '<i>n</i>', hooks: { start: { 'data-s': '1' }, later: { 'data-l': '1' }, more: { 'data-m': '1' }, title: { 'data-t': '1' } } });
  assert.match(h, /Proposed/); assert.match(h, /class="tp-title"[^>]*value="Add export"[^>]*data-t="1"/); assert.match(h, /<i>s<\/i>/); assert.match(h, /<i>n<\/i>/);
  assert.match(h, />Start</); assert.match(h, /data-s="1"/); assert.match(h, />Not now</); assert.doesNotMatch(h, /<i>m<\/i>/);
  assert.match(C.taskProposal({ title: 'x', sentence: '', more: '<i>m</i>', open: true }), /<i>m<\/i>[\s\S]*Hide Customise|Hide Customise[\s\S]*<i>m<\/i>/);
});

test('changeProposal: before and after, Apply; applied, a receipt with Revert; declined, one quiet line', () => {
  const rows = [{ name: 'Away on', before: 'Never', after: 'Weekends' }];
  const h = C.changeProposal({ kind: 'Away', title: 'Quiet', rows });
  assert.match(h, /tp-kicker">[\s\S]*?<span>Away<\/span>/); assert.match(h, /<s>Never<\/s>/); assert.match(h, /<b>Weekends<\/b>/); assert.match(h, />Apply</);
  assert.match(C.changeProposal({ kind: 'Away', title: 'Quiet', rows, state: 'applied' }), />Revert</);
  assert.match(C.changeProposal({ kind: 'Away', title: 'Quiet', rows, state: 'declined' }), /Not changed/);
  assert.match(C.turnDivider({ text: 'Switched to a' }), /role="separator"[^>]*aria-label="Switched to a"/);
});

test('planCard, filesCard, youTurn: the Shaper plan folds its roles; files as tiles and rows; your words with what came with them', () => {
  const roles = [{ name: 'Security', ok: false, note: 'Flag first' }, { name: 'UX', ok: true, note: 'Fine' }];
  const shut = C.planCard({ title: 'Plan', version: 'v2 of 2', roles });
  assert.match(shut, /Plan · v2 of 2/); assert.match(shut, /Reviewed by 2 roles · 1 open/); assert.doesNotMatch(shut, /Flag first/); assert.match(shut, />Approve and build</);
  assert.match(C.planCard({ title: 'Plan', version: 'v2', roles, open: true }), /Security<\/b> Flag first/);
  const f = C.filesCard({ files: [{ name: 'a.png', image: true }, { name: 'b.txt', meta: '2 KB' }] });
  assert.match(f, /fc-tile[\s\S]*a\.png/); assert.match(f, /<b>b\.txt<\/b> 2 KB/); assert.match(f, /aria-label="Download b\.txt"/);
  const y = C.youTurn({ text: 'Same bug?', quote: 'Off by a cent', files: ['x.pdf'] });
  assert.match(y, /you-quote">Off by a cent/); assert.match(y, /x\.pdf/);
  assert.doesNotMatch(C.changeProposal({ kind: 'Agent', title: 'New', rows: [{ name: 'Reads', before: '', after: 'PRs' }] }), /→/);
});

test('askWorcaMark: the bubble and its W at rest, dots while writing, filled while open; writing wins', () => {
  assert.match(C.askWorcaMark(), /M5 4h14/); assert.match(C.askWorcaMark(), /M7.4 8.2/); assert.doesNotMatch(C.askWorcaMark(), /circle|mask/);
  assert.match(C.askWorcaMark({ answering: true }), /<circle/);
  assert.match(C.askWorcaMark({ open: true }), /mask="url\(#ask-worca-cut\)"/);
  assert.match(C.askWorcaMark({ open: true, answering: true }), /<circle/);
});

test('topBarAction: with news, it shakes once (a class the look animates)', () => {
  assert.match(C.topBarAction({ label: 'Pulse', icon: '<svg></svg>', labelCls: 'x', news: true }), /class="[^"]*is-news/);
  assert.doesNotMatch(C.topBarAction({ label: 'Pulse', icon: '<svg></svg>', labelCls: 'x' }), /is-news/);
});

test('countBadge, barStrip, stageLine, searchResults by area', () => {
  assert.match(C.countBadge({ n: 3, tone: 'need', corner: true }), /topnav-badge is-corner/);
  assert.match(C.topBarAction({ label: 'Pulse', icon: '', labelCls: 'l', badge: { n: 2, tone: 'need' } }), /topnav-badge/);
  const strip = C.barStrip({ items: [{ label: 'Chats: 4 open', icon: '', n: 4 }, { label: 'Tasks', icon: '', n: 0 }] });
  assert.match(strip, /aria-label="Chats: 4 open"/); assert.equal((strip.match(/topnav-badge/g) || []).length, 1, 'no badge at 0');
  assert.match(C.stageLine({ mark: '', label: 'Plan', parts: '<b>x</b>' }), /stage-tools/);
  assert.match(C.stageLine({ mark: '', label: 'PR', next: true }), /is-next/);
  const res = C.searchResults([{ id: 'a', text: 'Export', where: 'billing', area: 'Chats', mark: '<i></i>' }], 'None', { areas: [['Settings', ''], ['Chats', '']] });
  assert.match(res, /menu-h">Chats/); assert.doesNotMatch(res, /Settings/);
});

test('inView: still marks, a card with a way out of view, +N opens a menu of the rest; nothing when empty', () => {
  assert.equal(C.inView({ items: [] }), '');
  const h = C.inView({ items: [{ title: 'Fix the login', line: 'Working', icon: '<i></i>', attrs: { 'data-in-view': 'task:t4' }, drop: { 'data-in-view-drop': 'task:t4' } }], more: { n: 2 } });
  assert.match(h, /data-in-view="task:t4"/); assert.match(h, /\+2/); assert.match(h, /aria-label="In view"/);
  assert.match(h, /class="in-view-card" role="tooltip"/); assert.match(h, /is-named[\s\S]*class="in-view-n"[^>]*>Fix the login</); assert.match(h, /aria-label="Out of view: Fix the login"/); assert.match(h, /aria-label="Fix the login: Working"/);
  assert.doesNotMatch(h, /<div class="menu/);
  const open = C.inView({ items: [], more: { n: 1, open: true, items: [{ id: 'chat:c2', text: 'Release 1.20' }] } });
  assert.match(open, /aria-expanded="true"/); assert.match(open, /data-in-view="chat:c2"/);
});

test('byPart: one order and one set of words for every list; date first and the default', () => {
  assert.equal(C.BY_DEFAULT, 'day');
  const b = C.byPart({ by: 'day', choices: [{ id: 'project' }, { id: 'state', help: 'Mine' }, { id: 'day', hint: '4' }] });
  assert.deepEqual(b.items.map((x) => x.text), ['date', 'state', 'project']);
  assert.equal(b.text, 'date'); assert.equal(b.items[1].help, 'Mine'); assert.equal(b.items[0].hint, '4'); assert.ok(b.items[0].checked);
  assert.equal(C.byPart({ by: 'ai', choices: [{ id: 'ai' }] }).text, 'AI topics');
});

test('dateSections: what waits on you first, then each day folding; Older and Later show 3', () => {
  const rows = [{ k: 'a', d: 'today' }, { k: 'b', d: 'older' }];
  const secs = C.dateSections({ rows, dayOf: (r) => r.d, row: (r) => r.k, head: [{ id: 'needs', rows: ['n'] }] });
  assert.equal(secs[0].id, 'needs'); assert.equal(secs[0].fold, undefined);
  const today = secs.find((x) => x.id === 'day:today'); assert.deepEqual(today.rows, ['a']); assert.equal(today.fold, true);
  assert.equal(secs.find((x) => x.id === 'day:older').limit, 3);
  assert.ok(C.REPEATS.includes('every day') && C.REPEATS.includes('once')); assert.equal(C.TIMES_OF_DAY.length, 48); assert.equal(C.TIMES_OF_DAY[5], '02:30');
  assert.deepEqual(C.dateSections({ rows: [], dayOf: () => '', days: C.NEXT_RUN_SECTIONS }).map((x) => x.title), ['Today', 'Tomorrow', 'This week', 'Later']);
});

test('list: a date section folds from its head, keeping its title and count', () => {
  const open = C.list({ groups: [{ title: 'Today', count: 2, rows: ['<i>r</i>'], fold: { open: true, attrs: { 'data-fold-section': 'day:today' } } }] });
  assert.match(open, /class="list-h-b"[^>]*data-fold-section="day:today"[^>]*aria-expanded="true"/); assert.match(open, /<i>r<\/i>/);
  const shut = C.list({ groups: [{ title: 'Today', count: 2, rows: [''], fold: { open: false, attrs: {} } }] });
  assert.match(shut, /is-shut/); assert.match(shut, /aria-expanded="false"/); assert.doesNotMatch(shut, /list-rows/);
});

test('stagePart: what a part holds, said before it opens; open, its chevron turns', () => {
  const h = C.stagePart({ label: 'Changes', says: '5 files +358 −144', attrs: { 'data-tab': 'changes' } });
  assert.match(h, /<b>Changes<\/b><span>5 files \+358 −144<\/span>/); assert.match(h, /aria-expanded="false"/); assert.match(h, /data-tab="changes"/);
  assert.match(C.stagePart({ label: 'Decisions', open: true }), /is-open[^>]*aria-expanded="true"/);
  assert.doesNotMatch(C.stagePart({ label: 'Activity' }), /<span>/);
});
