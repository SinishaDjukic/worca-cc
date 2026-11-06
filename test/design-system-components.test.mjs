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
  const row = dom(C.settingsRow({ name: 'Badge <b>', sentence: 'The tab title counts <x>', end: '<button class="btn"></button>', changed: true, detail: '<p>more</p>' }));
  assert.equal(row.className, 'set-row');
  assert.equal(row.querySelector('.set-name').textContent, 'Badge <b>', 'the name is escaped');
  assert.ok(row.querySelector('.set-text x'), 'the sentence is markup, so it can hold pickers');
  assert.equal(row.querySelector('.set-end .set-changed').textContent, 'Changed');
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

test('land and dialog hooks: the target lights once and comes into view; a Dialog carries the page\'s hooks and class', () => {
  const { window } = new JSDOM('<div id="t"></div>');
  let scrolled = null; const t = window.document.getElementById('t');
  t.scrollIntoView = (o) => { scrolled = o; };
  window.matchMedia = () => ({ matches: false });
  C.land(t);
  assert.ok(t.hasAttribute('data-landed'));
  assert.equal(scrolled.block, 'center');
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
  const act = dom(C.actionRow({ text: 'web · Dev <server>', stop: 'Stop it', stopIcon: '<svg></svg>', open: { 'data-x': '1' } }));
  assert.equal(act.querySelector('button.act-srow-name').textContent, 'web · Dev <server>');
  assert.equal(act.querySelector('.act-stop').getAttribute('aria-label'), 'Stop it');
  assert.equal(dom(C.actionRow({ text: 'a', stop: 's', stopIcon: '' })).querySelector('span.act-srow-name').textContent, 'a');
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

test('morph: a textarea shows the new text, even when its text node moves across', () => {
  const host = new JSDOM('<body><div id="t"><textarea id="x"></textarea></div></body>').window.document.getElementById('t');
  C.morph(host, '<textarea id="x">new words</textarea>');
  assert.equal(host.querySelector('#x').value, 'new words');
});
