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

test('compactMenu: a choice with a mark shows its tick at the end (comp.menu-tick)', () => {
  const m = dom(C.compactMenu({ items: [{ text: 'a', mark: '<i></i>', checked: true }, { text: 'b', mark: '<i></i>', checked: false }, { text: 'c', checked: true }] }));
  assert.equal(m.querySelectorAll('.menu-check').length, 1);
  assert.ok(m.children[0].querySelector('.menu-check svg'));
});

test('pluginCard: its title can open its page', () => {
  const c = dom(C.pluginCard({ mark: '', title: 'A<b', titleHtml: C.textLink({ label: 'A', attrs: { 'data-x': '1' } }), action: '' }));
  assert.ok(c.querySelector('.pg-t > .dc-link[data-x]'));
  assert.equal(dom(C.pluginCard({ mark: '', title: 'A<b', action: '' })).querySelector('.pg-t').textContent, 'A<b');
});

test('listController: selected counts in the actions\' unit (list.select-bar)', () => {
  const d = new JSDOM('<body><div id="r"></div></body>', { pretendToBeVisual: true }).window.document, root = d.getElementById('r');
  const rows = [{ key: 'g', title: 'g', meta: '' }, { key: 'c', title: 'c', meta: '' }];
  const ctl = C.listController({ root, spec: { noun: `cnt-${Math.random()}`, label: 'x', can: () => ['menu'], bulk: () => [{ id: 'a', label: 'A', n: 3 }], count: () => 3, act: () => {}, word: () => false, say: () => {}, active: () => true, open: () => {}, view: () => ({ state: 'ready', parts: [], sections: [{ id: 's', title: 'S', rows }] }) } });
  ctl.state.pick = { on: true, ids: ['g'], last: 'g' }; ctl.paint();
  assert.match(root.querySelector('.runs-bulk-n').textContent, /^3 selected/);
});

test('compactMenu: two columns live inside what scrolls (comp.menu-groups)', () => {
  const m = dom(C.compactMenu({ cls: 'pz-menu is-two-cols', items: [{ header: 'One' }, { text: 'a' }] }));
  assert.ok(m.firstElementChild.matches('.menu-cols') && m.querySelector('.menu-cols > .menu-g'));
  assert.equal(dom(C.compactMenu({ items: [{ text: 'a' }] })).querySelector('.menu-cols'), null);
});

test('toastText: the whole text in its tooltip, Undo beside it (comp.toast-clamp)', () => {
  const t = dom(C.toast({ text: 'Merged <#959>' }));
  assert.equal(t.querySelector('.rc-toast-t').title, 'Merged <#959>');
  assert.equal(dom(C.toast({})).innerHTML, '');
  assert.ok(dom(`<div>${C.toastText('x', C.toastUndo())}</div>`).querySelector('.rc-toast-t + [data-undo]'));
});

test('watchClickGuard: a double click fires only what was pressed (comp.click-guard)', () => {
  const at = (t, sign, el = {}, x = 10) => ({ t, x, y: 10, el, sign });
  const a = at(0, 'a');
  assert.equal(C.secondClickIgnored(null, at(100, 'b')), false);
  assert.equal(C.secondClickIgnored(a, at(100, 'b')), true, 'another button landed under the pointer');
  assert.equal(C.secondClickIgnored(a, at(100, 'a')), false, 'the same button, redrawn');
  assert.equal(C.secondClickIgnored(a, { ...a, t: 100 }), false, 'the same element');
  assert.equal(C.secondClickIgnored(a, at(400, 'b')), false, 'after the guard');
  assert.equal(C.secondClickIgnored(a, at(100, 'b', {}, 40)), false, 'elsewhere on the page');
  const d = new JSDOM('<button id="a">Approve</button><button id="b">Merge</button>').window;
  C.watchClickGuard(d.document);
  const acted = []; for (const id of ['a', 'b']) d.document.getElementById(id).addEventListener('click', () => acted.push(id));
  const press = (id, detail) => d.document.getElementById(id).dispatchEvent(new d.MouseEvent('click', { bubbles: true, detail, clientX: 5, clientY: 5 }));
  press('a', 1); press('b', 2); assert.deepEqual(acted, ['a'], 'the second click is eaten');
  press('b', 0); assert.deepEqual(acted, ['a', 'b'], 'a keyboard click passes');
});

test('watchMenus: a disabled item acts for nothing and says why (comp.menu-off)', () => {
  const d = new JSDOM('<div id="r"><button class="menu-item" aria-disabled="true" title="Needs a project">x</button></div>').window;
  C.watchMenus(d.document);
  let acted = 0, why = '';
  d.document.getElementById('r').addEventListener('click', () => { acted++; });
  d.document.addEventListener('rail:disabled', (e) => { why = e.detail.why; });
  d.document.querySelector('.menu-item').click();
  assert.equal(acted, 0); assert.equal(why, 'Needs a project');
});

test('watchStrips: Esc presses the strip\'s Cancel; what is typed stays (keys.esc-strip)', () => {
  const d = new JSDOM(`<div>${C.confirmForm({ form: 'f', text: 'Add?', body: `<input value="a">${C.confirmActions({ yes: 'Add' })}` })}</div>`, { pretendToBeVisual: true }).window;
  d.document.querySelector('.rc-confirm').getClientRects = () => [1];
  C.watchStrips(d.document);
  let no = 0;
  d.document.querySelector('[data-confirm="no"]').addEventListener('click', () => { no++; });
  const esc = () => d.document.body.dispatchEvent(new d.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  d.document.querySelector('input').value = 'typed'; esc(); assert.equal(no, 0);
  d.document.querySelector('input').value = 'a'; esc(); assert.equal(no, 1);
});

test('listController: a section can count in its own unit', () => {
  const dom2 = new JSDOM('<div id="b"></div>').window, root = dom2.document.getElementById('b');
  const ctl = C.listController({ root, spec: { noun: `unit-${Math.random()}`, label: 'x', can: () => [], bulk: () => [], act: () => {}, word: () => false, say: () => {}, active: () => true, open: () => {}, view: () => ({ state: 'ready', parts: [], sections: [{ id: 's', title: 'S', count: 5, rows: [{ key: 'k', title: 'T' }] }] }) } });
  ctl.paint();
  assert.match(root.textContent, /S\s*5/);
});

test('listController: two lists on one bar, the rows showing answer (one owner per root)', () => {
  const dom2 = new JSDOM('<div id="b"></div>').window, root = dom2.document.getElementById('b');
  const opened = [], mk = (n) => C.listController({ root, spec: { noun: `own-${n}-${Math.random()}`, label: 'x', can: () => [], bulk: () => [], act: () => {}, word: () => false, say: () => {}, active: () => true, open: () => opened.push(n), view: () => ({ state: 'ready', parts: [], sections: [{ id: 's', title: 'S', noCount: true, rows: [{ key: 'k', title: 'T' }] }] }) } });
  const a = mk('a'), b = mk('b');
  a.paint(); b.paint();
  root.querySelector('[data-open]').click();
  assert.deepEqual(opened, ['b']);
});

test('listController: a dialog\'s name field stops at its limit and says so (small.name-short)', () => {
  const root = new JSDOM('<div id="b"></div>').window.document.getElementById('b');
  const ctl = C.listController({ root, spec: { noun: `max-${Math.random()}`, label: 'x', can: () => [], bulk: () => [], act: () => {}, word: () => false, say: () => {}, active: () => true, view: () => ({ state: 'ready', parts: [], sections: [] }) } });
  ctl.dialog({ title: 'Rename chat', label: 'Name', value: 'a', max: 80, yes: 'Rename', run: () => {} });
  assert.equal(root.querySelector('[data-dlg-name]').getAttribute('maxlength'), '80');
  assert.match(root.querySelector('.fld-hint').textContent, /Up to 80 characters/);
});

test('compactMenu: a head and its options are one block (comp.menu-groups)', () => {
  const m = dom(C.compactMenu({ items: [{ header: 'One' }, { text: 'a' }, { text: 'b' }, { header: 'Two' }, { text: 'c' }, { sep: true }, { text: 'd' }] }));
  const g = [...m.querySelectorAll('.menu-g')];
  assert.deepEqual(g.map((x) => x.textContent), ['Oneab', 'Twoc']);
  assert.ok(m.querySelector('.menu-sep').previousElementSibling === g[1], 'a separator ends the group');
  assert.equal(dom(C.compactMenu({ items: [{ text: 'a' }] })).querySelector('.menu-g'), null);
});

const MAKER_ITEMS = [
  { id: 'anthropic', text: 'Anthropic', sub: [{ id: 'opus', text: 'Opus 5.5', checked: false }, { id: 'sonnet', text: 'Sonnet 5.5', checked: true }] },
  { id: 'openai', text: 'OpenAI', sub: [{ id: 'gpt', text: 'Codex 5', checked: false }] },
];

test('compactMenu: an opener says it opens a menu and ticks the group holding the choice (comp.menu-sub)', () => {
  const m = dom(C.compactMenu({ items: MAKER_ITEMS }));
  const [a, o] = [...m.querySelectorAll('.menu-item')];
  assert.deepEqual([a.getAttribute('role'), a.getAttribute('aria-haspopup'), a.getAttribute('aria-expanded'), a.dataset.menuSub], ['menuitem', 'menu', 'false', 'anthropic']);
  assert.equal(a.hasAttribute('data-menu-pick'), false, 'an opener picks nothing');
  assert.ok(a.querySelector('.menu-check svg'), 'the group holding the choice carries the tick');
  assert.equal(o.querySelector('.menu-check'), null);
  assert.ok(a.querySelector('.menu-sub-chev svg'), 'a › says it opens');
  assert.equal(m.querySelectorAll('[data-menu-pick]').length, 0, 'closed: only openers');
  assert.equal(m.hasAttribute('data-sub-of'), false);
});

test('compactMenu: openSub draws the group\'s items under a back row; sentencePicker reports a sub pick as id|ROWID', () => {
  const m = dom(C.compactMenu({ items: MAKER_ITEMS, openSub: 'anthropic' }));
  assert.equal(m.dataset.subOf, 'anthropic');
  assert.equal(m.getAttribute('aria-label'), 'Anthropic');
  const items = [...m.querySelectorAll('.menu-item')];
  assert.ok(items[0].matches('.menu-back'));
  assert.deepEqual([items[0].dataset.menuSub, items[0].getAttribute('role'), items[0].getAttribute('aria-label'), items[0].textContent], ['', 'menuitem', 'Back to every maker', 'Anthropic']);
  assert.deepEqual(items.slice(1).map((x) => x.dataset.menuPick), ['opus', 'sonnet']);
  assert.equal(items[2].getAttribute('aria-checked'), 'true');
  const p = dom(C.sentencePicker({ id: 'cp-engine', text: 'Sonnet 5.5', items: MAKER_ITEMS, open: true, openSub: 'openai' }));
  assert.deepEqual([...p.querySelectorAll('[data-menu-pick]')].map((x) => x.dataset.menuPick), ['cp-engine|gpt']);
  assert.equal(p.querySelector('.menu').dataset.subOf, 'openai', 'the opener keeps its raw id');
  const closed = dom(C.sentencePicker({ id: 'cp-engine', text: 'x', items: MAKER_ITEMS, open: true }));
  assert.deepEqual([...closed.querySelectorAll('[data-menu-sub]')].map((x) => x.dataset.menuSub), ['anthropic', 'openai']);
});

test('menuKeys: arrows wrap, → and Space open, ← and the back row return, Enter clicks once', () => {
  const win = new JSDOM('<body><div id="r"></div><input id="out"></body>', { pretendToBeVisual: true }).window, d = win.document, r = d.getElementById('r');
  let sub = '', clicks = 0;
  const calls = [];
  const items = [...MAKER_ITEMS, { id: 'off', text: 'Off', off: true, sub: [{ id: 'x', text: 'x' }] }];
  const paint = () => { r.innerHTML = C.sentencePicker({ id: 'cp-engine', text: 'Sonnet 5.5', items, open: true, openSub: sub }); };
  const hooks = { openSub: (id) => { calls.push(['open', id]); sub = id; paint(); }, closeSub: () => { calls.push(['close']); sub = ''; paint(); } };
  d.addEventListener('click', (e) => { if (e.target.closest('[data-menu-pick]')) clicks++; });
  const key = (el, k) => { const e = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); const got = C.menuKeys(Object.defineProperty(e, 'target', { value: el }), hooks); return [got, e.defaultPrevented]; };
  paint();
  assert.deepEqual(key(r.querySelector('.spick-b'), 'ArrowDown'), [true, true]);
  assert.equal(d.activeElement.dataset.menuSub, 'anthropic', 'the button\'s ArrowDown focuses the first item');
  key(d.activeElement, 'ArrowDown'); assert.equal(d.activeElement.dataset.menuSub, 'openai');
  key(d.activeElement, 'ArrowDown'); assert.equal(d.activeElement.dataset.menuSub, 'anthropic', 'the disabled item is skipped and it wraps');
  key(d.activeElement, 'ArrowUp'); assert.equal(d.activeElement.dataset.menuSub, 'openai', 'and wraps back');
  key(r.querySelector('[data-menu-sub="anthropic"]'), 'ArrowRight');
  assert.equal(d.activeElement.dataset.menuPick, 'cp-engine|sonnet', 'the checked item takes the focus');
  key(d.activeElement, 'ArrowLeft'); assert.equal(d.activeElement.dataset.menuSub, 'anthropic', 'back on its opener');
  key(d.activeElement, ' '); assert.equal(d.querySelector('.menu').dataset.subOf, 'anthropic');
  key(d.querySelector('.menu-back'), 'Enter'); assert.equal(d.activeElement.dataset.menuSub, 'anthropic');
  key(r.querySelector('[data-menu-sub="openai"]'), 'Enter'); assert.equal(d.activeElement.dataset.menuPick, 'cp-engine|gpt', 'no choice here: the first item');
  key(d.activeElement, 'Enter'); assert.equal(clicks, 1);
  key(d.querySelector('.menu-back'), ' ');
  assert.deepEqual(calls, [['open', 'anthropic'], ['close'], ['open', 'anthropic'], ['close'], ['open', 'openai'], ['close']]);
  const off = r.querySelector('[data-menu-sub="off"]');
  assert.deepEqual(key(off, 'Enter'), [true, true]); assert.equal(calls.length, 6, 'a disabled opener never opens');
  assert.deepEqual(key(d.getElementById('out'), 'Enter'), [false, false], 'outside a .spick it touches nothing');
  assert.deepEqual(key(r.querySelector('.menu-item'), 'a'), [false, false], 'a key it does not own');
});

test('notFound: names what was asked for, escapes it, and gives one way on (nav.not-found)', () => {
  const n = dom(C.notFound({ what: 'project', name: '<x>', back: 'Projects', attrs: { 'data-nav': 'projects' } }));
  assert.equal(n.querySelector('.el-t').textContent, 'There is no project called <x>');
  assert.equal(n.querySelector('button').textContent, 'Go to Projects');
  assert.equal(n.querySelector('button').dataset.nav, 'projects');
});

test('resetViewTool: its tooltip is where it goes, or why it is off (list.reset-view)', () => {
  assert.deepEqual(C.resetViewTool({ changed: true, to: 'all tasks' }), { id: 'reset', text: 'Reset view', off: false, help: 'Back to all tasks' });
  const off = C.resetViewTool({ changed: false, to: 'all tasks' });
  assert.equal(off.off, true);
  assert.equal(off.help, 'This is already the default view');
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

test('terminalPane: its output is a polite live log, and a closed shell turns its input off (more in design-system-terminal-pane)', () => {
  const t = dom(C.terminalPane({ title: 'ls', lines: [{ t: '1', text: 'a' }], closed: true, hooks: { send: { 'data-term-input': 's' } } }));
  assert.equal(t.querySelector('[role="log"]').getAttribute('aria-live'), 'polite');
  assert.equal(t.querySelector('input').disabled, true);
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
  assert.ok(!r.querySelector('.pz-unread') && r.querySelector('.pz-row-t.is-unread'));   // unread is weight, not a dot
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

test('selectionBar: Select all, the count and Cancel on one line, the actions under them', () => {
  const b = dom(C.selectionBar({ label: 'x', count: 2, all: 'some', actions: [{ id: 'a', label: 'A', n: 2, tip: '' }] }));
  const top = b.querySelector('.runs-bulk-top');
  assert.ok(top.querySelector('[data-selall][data-mixed]')); assert.equal(top.querySelector('.runs-bulk-n').textContent, '2 selected'); assert.ok(top.querySelector('[data-bulk="cancel"]'));
  assert.ok(b.querySelector('.runs-bulk-acts [data-bulk="a"]'));
  assert.equal(dom(C.selectionBar({ label: 'x', count: 0 })).querySelector('[data-selall]'), null, 'nothing to tick: no Select all');
});

test('list: the selection sits under the head, before the first section', () => {
  const l = dom(C.list({ sentence: 's', tools: '<i></i>', groups: [{ title: 'T', rows: ['<b></b>'] }], selection: '<u></u>' }));
  assert.equal(l.querySelector('.list-head').nextElementSibling.className, 'list-select');
});

test('tipPlace: a menu item\'s tip sits beside the menu, else on its other side, level with the item', () => {
  const item = { top: 100, bottom: 120, left: 20, width: 200 }, tip = { width: 150, height: 30 };
  assert.deepEqual(C.tipPlace(item, tip, 1000, 700, { left: 10, right: 230 }), { top: 100, left: 236 });
  assert.deepEqual(C.tipPlace(item, tip, 300, 700, { left: 200, right: 290 }), { top: 100, left: 44 });
  assert.equal(C.tipPlace(item, tip, 240, 700, { left: 8, right: 232 }).top, 126, 'no room either side: under it');
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
  assert.match(f.textContent, /Could not load the runs/);
  assert.match(dom(C.listState({ state: 'failed', noun: 'chat', title: 'Could not load this chat' })).textContent, /^Could not load this chat/, 'fail.chat-thread: the rule\'s own title, given, never string-replaced');
  assert.equal(dom(C.listState({ state: 'empty', noun: 'runs', text: 'Nothing needs you.' })).querySelector('.el-t').textContent, 'Nothing needs you.');
  // fail.task-page: brief says only "Nothing changed." under the failed title, never the server-did-not-answer wording
  const brief = dom(C.listState({ state: 'failed', noun: 'task', title: 'Could not load this task', brief: true, retry: { 'data-task-retry': 'h3' } })).textContent;
  assert.match(brief, /^Could not load this task/);
  assert.match(brief, /Nothing changed\./);
  assert.doesNotMatch(brief, /did not answer/);
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
  assert.equal(root.querySelector('.list-more').textContent, 'Show less'); click('[data-less]'); assert.equal(root.querySelectorAll('.list-row').length, 2); click('[data-more]');
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
  assert.notEqual(C.kindMark({ kind: 'workflow', tone: 'fail', stage: 1 }), C.kindMark({ kind: 'workflow', tone: 'fail', stage: 1, keepType: true }), 'what needs you takes the centre');
  assert.match(C.kindMark({ kind: 'chat', tone: 'ask', breathe: true }), /is-breathe/, 'unopened, what needs you breathes');
  assert.doesNotMatch(C.kindMark({ kind: 'task', tone: 'run', breathe: true }), /is-breathe/, 'only what needs you breathes so');
  assert.match(C.kindMark({ kind: 'task', tone: 'pause' }), /pause/, 'a pause keeps its sign');
  assert.equal(C.partsWord(['ok', 'merged', 'run']), '2 of 3');
  assert.equal(C.namesWord(['a', 'b']), 'a, b'); assert.equal(C.namesWord(['a', 'b', 'c', 'd', 'e']), 'a, b, +3', 'small.names-short');
  assert.match(C.barChart({ label: 'x', bars: [{ label: 'a', value: 1, text: '1', off: 'Opens nothing' }], play: true }), /data-off="Opens nothing"[^>]*aria-disabled|aria-disabled[^>]*data-off/, 'look.chart-play: a bar that opens nothing says why');
  assert.doesNotMatch(C.kindMark({ kind: 'event', tone: 'fail' }), /km-ring/, 'an event is a moment, with no progress');
  assert.equal(C.markTone({ word: 'Needs you', sym: 'q' }), 'ask'); assert.equal(C.markTone({ word: 'Needs you', dot: 'is-amber' }), 'ask');
  assert.equal(C.markTone({ word: 'Failed', sym: 'x' }), 'fail'); assert.equal(C.markTone({ word: 'Paused' }), 'pause'); assert.equal(C.markTone({ word: 'Merged' }), 'merged'); assert.equal(C.markTone({ word: 'Working', dot: 'is-peach is-pulse' }), 'run');
});
test('placeHead: a thing\'s page starts with its title, its facts, then its state with one action and ⋯', () => {
  const h = C.placeHead({ title: 'a<b', facts: 'Git · ~/src', mark: '<i class="m"></i>', word: '3 behind', why: 'since today', action: '<button>Sync</button>', menu: '<span class="more"></span>' });
  assert.match(h, /<h1 class="place-title">a&lt;b<\/h1>/); assert.match(h, /convo-head">Git · ~\/src/);
  assert.match(h, /convo-card-line"><i class="m"><\/i><span class="convo-card-w">3 behind<span>since today<\/span><\/span><button>Sync<\/button><span class="more"><\/span>/);
  assert.doesNotMatch(C.placeHead({ title: 'x' }), /convo-card-line/, 'no state, no state line');
});
test('barChart: one series, numbers only on the highest and the current, a table for a screen reader', () => {
  const c = dom(C.barChart({ label: 'Spend by day', bars: [{ label: 'Mon', value: 10, text: '$10' }, { label: 'Tue', value: 40, text: '$40' }, { label: 'Wed', value: 5, text: '$5' }], current: 2 }));
  assert.equal(c.querySelectorAll('.bc-col').length, 3);
  assert.deepEqual([...c.querySelectorAll('.bc-v')].map((v) => v.textContent), ['', '$40', '$5'], 'the highest and the current carry their number');
  assert.ok(c.querySelectorAll('.bc-col')[2].classList.contains('is-now'));
  assert.equal(c.querySelector('.bc-plot').getAttribute('aria-hidden'), 'true'); assert.equal(c.querySelectorAll('.bc-table tr').length, 3);
  assert.match(c.querySelector('.bc-col').getAttribute('title'), /Mon: \$10/);
});
test('lineChart: solid and dashed, a legend, a limit, a table, each point readable', () => {
  const pts = (v) => v.map((n) => ({ value: n, text: `$${n}`, diff: '+$1, +5%' }));
  const c = dom(C.lineChart({ label: 'Spend', labels: ['a', 'b', 'c'], series: [{ label: 'Now', points: pts([10, 40, 5]) }, { label: 'Before', dashed: true, points: pts([8, 30, 6]) }], limit: { value: 50, text: 'Budget $50' }, current: 2, hint: 'Drag across to narrow' }));
  assert.equal(c.querySelectorAll('.ch-l.is-before').length, 1); assert.equal(c.querySelectorAll('.ch-l.is-limit').length, 1);
  assert.deepEqual([...c.querySelectorAll('.ch-key')].map((k) => k.textContent), ['Now', 'Before', 'Budget $50']);
  assert.deepEqual([...c.querySelectorAll('.ch-v')].map((v) => v.textContent), ['$40', '$5'], 'the highest and the current carry their number');
  assert.equal(c.querySelectorAll('.ch-hit').length, 3); assert.equal(c.querySelector('.ch-hit').dataset.read, 'a|$10|+$1, +5%');
  assert.equal(c.querySelectorAll('.bc-table tbody tr').length, 3); assert.equal(c.querySelector('.ch-hint').textContent, 'Drag across to narrow');
  const split = dom(C.lineChart({ label: 'x', labels: ['a'], series: [{ label: 'Build', part: 0, points: pts([3]) }, { label: 'Plan', part: 1, points: pts([1]) }] }));
  assert.equal(split.querySelectorAll('.ch-l.is-p0').length, 1); assert.equal(split.querySelectorAll('.ch-l.is-p1').length, 1); assert.equal(split.querySelectorAll('.ch-swatch.is-line.is-s1').length, 1);
  const one = dom(C.lineChart({ label: 'x', labels: ['a', 'b'], series: [{ label: 'Now', points: [{ value: 1, text: '1' }, null] }] }));
  assert.equal(one.querySelector('.ch-legend'), null, 'one series, no legend'); assert.equal(one.querySelectorAll('.ch-hit').length, 1, 'no data, no point');
});
test('mixChart: stacks in ink shades with a legend and a table', () => {
  const c = dom(C.mixChart({ label: 'Mix', labels: ['a', 'b'], parts: [{ label: 'acme', values: [3, 1] }, { label: 'globex', values: [1, 1] }], reads: ['$4', '$2'] }));
  assert.equal(c.querySelectorAll('.ch-stack').length, 2); assert.equal(c.querySelectorAll('.ch-seg.is-s1').length, 2);
  assert.deepEqual([...c.querySelectorAll('.ch-key')].map((k) => k.textContent), ['acme', 'globex']); assert.equal(c.querySelectorAll('.bc-table tbody tr').length, 2);
});
test('diffWords: the difference in words, nothing without a before', () => {
  const usd = (n) => `$${n}`;
  assert.equal(C.diffWords(93, 66, usd), '+$27, +41%'); assert.equal(C.diffWords(50, 100, usd), '−$50, −50%'); assert.equal(C.diffWords(5, null, usd), '');
});
test('watchChart: focus reads a point, Enter opens it, a drag across narrows', () => {
  const fig = dom(C.barChart({ label: 'x', play: true, hint: 'Drag', bars: [1, 2, 3, 4].map((v) => ({ label: `d${v}`, value: v, text: `$${v}`, diff: '+$1' })) }));
  const win = fig.ownerDocument.defaultView, plot = fig.querySelector('.bc-plot'); let opened = -1, range = null;
  plot.getBoundingClientRect = () => ({ left: 0, width: 400 });
  C.watchChart(fig, { open: (i) => { opened = i; }, narrow: (a, b) => { range = [a, b]; } });
  const col = fig.querySelectorAll('.bc-col')[1];
  col.dispatchEvent(new win.FocusEvent('focusin', { bubbles: true })); assert.equal(fig.querySelector('.ch-read').hidden, false); assert.match(fig.querySelector('.ch-read').textContent, /d2.*\$2.*\+\$1/);
  col.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); assert.equal(opened, 1);
  const p = (type, clientX) => { const e = new win.MouseEvent(type, { clientX, button: 0, bubbles: true }); plot.dispatchEvent(e); };
  p('pointerdown', 110); p('pointermove', 320); assert.ok(plot.querySelector('.ch-brush')); p('pointerup', 320); assert.deepEqual(range, [1, 3]); assert.equal(plot.querySelector('.ch-brush'), null);
});
test('figureRows: each whole row is one button, a second level is marked', () => {
  const c = dom(C.figureRows({ label: 'By project', columns: [{ label: 'Share' }, { label: 'AI spend', narrow: false }], rows: [{ name: 'a<b', cells: ['45%', '$186'], attrs: { 'data-x': '1' } }, { name: 'sub', cells: ['1%', '$2'], sub: true }] }));
  assert.equal(c.querySelectorAll('button.fr-row').length, 2); assert.equal(c.querySelector('button .fr-name').textContent, 'a<b'); assert.ok(c.querySelector('button.fr-row.is-sub'));
  assert.match(c.querySelector('button').getAttribute('aria-label'), /Share 45%, AI spend \$186/); assert.equal(c.querySelector('button').querySelectorAll('button').length, 0);
});
test('sideMenu: an item may carry a count', () => {
  const c = dom(C.sideMenu({ label: 'x', groups: [{ title: 'T', items: [{ label: 'a', count: 18 }, { label: 'b' }] }] }));
  assert.equal(c.querySelectorAll('.side-n').length, 1); assert.equal(c.querySelector('.side-n').textContent, '18');
});
test('pluginCard: its brand, kind and version, what it does, Worca\'s reason, facts, one action', () => {
  const c = dom(C.pluginCard({ mark: C.kindMark({ kind: 'plugin', icon: 'brand-github' }), kicker: 'Task source · 0.2.0', update: '0.3.0', title: 'GitHub Issues', what: 'Pull tasks', why: 'Your projects live on GitHub', facts: 'Adds a task source', action: '<button>Install</button>' }));
  assert.ok(c.classList.contains('pg-card')); assert.equal(c.querySelector('.pg-t').textContent, 'GitHub Issues');
  assert.match(c.querySelector('.pg-k').textContent, /Task source · 0.2.0 · update 0.3.0/); assert.ok(c.querySelector('.pg-why svg')); assert.equal(c.querySelector('.pg-a button').textContent, 'Install');
  assert.notEqual(C.kindMark({ kind: 'plugin', icon: 'brand-github' }), C.kindMark({ kind: 'plugin' }), 'a brand takes the centre');
});
test('listRow markFold: the mark folds what is under the row; its name still opens it (list.fold-by-mark)', () => {
  const open = dom(C.listRow({ title: 'Chat', mark: '<i class="m"></i>', open: { 'data-open': 'c' }, markFold: { open: true, attrs: { 'data-fold-tree': 'c' } }, after: '<b>tasks</b>' }));
  const b = open.querySelector('.lr-mark-fold'); assert.ok(b && b.querySelector('.m')); assert.equal(b.getAttribute('aria-expanded'), 'true'); assert.equal(b.dataset.foldTree, 'c');
  assert.ok(open.querySelector('.lr-after b')); assert.ok(open.querySelector('.lr-main[data-open="c"]'));
  const shut = dom(C.listRow({ title: 'Chat', mark: '<i></i>', markFold: { open: false, attrs: {} }, after: '<b>tasks</b>' }));
  assert.equal(shut.querySelector('.lr-after'), null, 'folded: nothing under it');
});
test('question forms: a slider with Worca\'s pick, an order with Up and Down, rows to tick, a facts line (panel.question-forms)', () => {
  const s = dom(C.sliderPick({ id: 'r', label: 'Rounds', min: 1, max: 6, value: 3, pick: 4, words: (n) => `${n} rounds` }));
  assert.equal(s.querySelector('input[type="range"]').value, '3'); assert.match(s.querySelector('.q-slide-pick').textContent, /4 rounds/);
  const r = dom(C.rankList({ label: 'Order', items: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], move: (id, d) => ({ 'data-rank': `${id}|${d}` }) }));
  assert.equal(r.querySelectorAll('.q-rank-r').length, 2); assert.ok(r.querySelector('[data-rank="a|up"]').disabled, 'the first cannot go up'); assert.equal(r.querySelector('[data-rank="a|up"]').closest('.tip-wrap').title, 'It is already first', 'and says why (small.disabled-why)');
  const p = dom(C.pickRows({ cols: ['Ticket', 'Estimate'], rows: [{ id: 't1', cells: ['BILL-1', '1 day'], checked: true }], tick: (id) => ({ 'data-tick-row': id }) }));
  assert.ok(p.querySelector('[data-tick-row="t1"]')); assert.equal(p.querySelectorAll('.q-rows-h span').length, 3);
  const f = dom(C.factsLine([{ n: '$1.84', word: 'so far', attrs: { 'data-cost': '' } }, { n: '23 min', word: '' }]));
  assert.ok(f.querySelector('button[data-cost]')); assert.equal(f.querySelectorAll('.q-fact').length, 2);
});
test('listController: every period but Today starts folded; the one holding your row starts open; your choice is kept (list.sections-start-folded)', () => {
  const { document: doc } = new JSDOM('<body></body>', { url: 'http://localhost/' }).window;
  const root = doc.createElement('div'); doc.body.append(root);
  const rows = (k, cur) => [{ key: k, title: k, current: cur }];
  const ctl = C.listController({ root, spec: { noun: `fold-${Math.random()}`, label: 'x', view: () => ({ state: 'ready', parts: [], sections: [{ id: 'today', title: 'Today', fold: true, rows: rows('a') }, { id: 'yesterday', title: 'Yesterday', fold: true, rows: rows('b') }, { id: 'week', title: 'Previous 7 days', fold: true, rows: rows('c', true) }] }), can: () => [], bulk: () => [], act() {}, open() {}, word() {}, say() {}, active: () => false } });
  ctl.paint();
  const shown = () => [...root.querySelectorAll('[data-row]')].map((r) => r.dataset.row);
  assert.deepEqual(shown(), ['a', 'c'], 'Today open, Yesterday folded, the week open for your row');
  root.querySelector('[data-fold-section="yesterday"]').click();
  assert.deepEqual(shown(), ['a', 'b', 'c'], 'opened, it shows');
  root.remove();
});
test('workspace map: boxes say only what is wrong; one opens in place; arrows by who uses whom; the order of a change (panel.workspace-map)', () => {
  const boxes = [{ id: 'a', title: 'Web shop', count: '5 projects', lines: [['web-app has moved apart', 'ask']], attrs: { 'data-b': 'a' } }, { id: 'b', title: 'IoT', count: '3 projects' }];
  const home = dom(C.workspaceBoxes({ boxes })); assert.equal(home.querySelectorAll('.wb-box').length, 2); assert.ok(home.querySelector('.wb-l.is-ask')); assert.equal(home.querySelector('.wb-box').dataset.b, 'a');
  const open = dom(C.workspaceBoxes({ boxes, openId: 'a', open: '<i class="x"></i>', openTitle: 'Web shop' }));
  assert.ok(open.querySelector('.wb-open .x')); assert.equal(open.querySelectorAll('.wb-side .wb-box').length, 1, 'the others stay boxes');
  const map = dom(C.workspaceMap({ label: 'M', nodes: [{ id: 'w', title: 'web' }, { id: 'p', title: 'pay', status: 'Behind 3', tone: 'ask' }, { id: 'e', title: 'mail' }], links: [{ from: 'w', to: 'p', word: 'calls' }, { from: 'p', to: 'e', unsure: true }, { from: 'x', to: 'w' }] }));
  assert.equal(map.querySelectorAll('.wm-n').length, 3); assert.equal(map.querySelectorAll('.wm-w').length, 2, 'a link to nothing is not drawn'); assert.ok(map.querySelector('.wm-w.is-unsure'));
  const [w, p, e] = [...map.querySelectorAll('.wm-n')].map((n) => parseInt(n.style.left, 10)); assert.ok(w < p && p < e, 'what uses sits left of what it uses');
  assert.deepEqual(C.workspaceOrder(['w', 'p', 'e'], [{ from: 'w', to: 'p' }, { from: 'p', to: 'e' }]), ['e', 'p', 'w']);
  assert.equal(C.workspaceOrder(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]).length, 2, 'a cycle still ends');
});
test('navItem lab: a Labs feature says so at its end, and only then (nav.labs)', () => {
  assert.equal(dom(C.navItem({ label: 'Requirements', icon: '<svg></svg>', lab: true })).querySelector('.nav-lab').textContent, 'Labs');
  assert.equal(dom(C.navItem({ label: 'Tasks', icon: '<svg></svg>' })).querySelector('.nav-lab'), null);
});
test('handedChip: says what was handed over, and can be removed (rail.hand-to-chat)', () => {
  const b = dom(C.handedChip({ kind: 'Workflow', name: 'Lean', attrs: { 'data-x': '' } }));
  assert.match(b.textContent, /Workflow · Lean/);
  assert.ok(b.hasAttribute('data-x'));
});
test('expandFrame: closed in its column, open over its page, one button either way (panel.expand)', () => {
  assert.equal(dom(C.expandFrame({ body: '<i></i>' })).classList.contains('is-open'), false);
  const open = dom(C.expandFrame({ body: '<i></i>', open: true }));
  assert.ok(open.classList.contains('is-open')); assert.match(open.textContent, /Close/);
});
test('barHead: the W goes home; the ▾ opens the quick navigation inside the bar (nav.quick)', () => {
  const h = C.barHead({ title: 'Workflows', home: true, menu: '<div class="menu"></div>' });
  assert.match(h, /data-bar-home/); assert.match(h, /data-bar-house/); assert.match(h, /bar-quick/);
});
test('nav.center-home: the title word goes home, the ▾ stays the menu; a page in a center has one crumb to it', () => {
  const h = dom(C.barHead({ title: 'Projects', center: 'projects' }));
  assert.equal(h.querySelector('[data-center-go]').textContent, 'Projects'); assert.equal(h.querySelector('[data-bar-house]').textContent, ''); assert.notEqual(h.querySelector('[data-center-go]'), h.querySelector('[data-bar-house]'));
  assert.equal(dom(C.barHead({ title: 'Home' })).querySelector('[data-center-go]'), null);
  const p = dom(`<div>${C.placeHead({ title: 'billing-api', center: { label: 'Projects', to: 'projects' } })}</div>`);
  assert.equal(p.querySelector('.rc-crumbs button[data-center-go="projects"]').textContent, 'Projects'); assert.equal(p.querySelector('.rc-crumbs [aria-current="page"]').textContent, 'billing-api');
  assert.equal(dom(`<div>${C.placeHead({ title: 'x' })}</div>`).querySelector('.rc-crumbs'), null);
});
test('motion.stage-advance: a keyed bar plays once when it reaches a later stage; first sight and reduced motion do not', async () => {
  const run = async (reduced) => { const w = new JSDOM('<body><div id="r"></div></body>', { pretendToBeVisual: true }).window, r = w.document.getElementById('r'); let n = 0;
    w.matchMedia = () => ({ matches: reduced }); w.Element.prototype.animate = () => { n++; return {}; };
    const bar = (stage) => { r.innerHTML = C.stageBar({ labels: ['a', 'b', 'c'], stage, step: stage === 0 ? [2, 2] : null, key: 'k' }); };
    bar(0); C.watchStageAdvance(w.document); await new Promise((f) => setTimeout(f)); const first = n;
    bar(1); await new Promise((f) => setTimeout(f)); const after = n; bar(1); await new Promise((f) => setTimeout(f)); return { first, after, again: n }; };
  const on = await run(false); assert.equal(on.first, 0); assert.ok(on.after > 0); assert.equal(on.again, on.after, 'once per change');
  assert.equal((await run(true)).after, 0);
});
test('watchFolds: opening animates the new part; closing fades a copy that then goes (motion.fold)', () => {
  const w = new JSDOM('<body><div id="r"></div></body>', { pretendToBeVisual: true }).window, r = w.document.getElementById('r'); let open = false; const seen = [];
  w.Element.prototype.getBoundingClientRect = () => ({ height: 40 });
  w.Element.prototype.animate = function (k) { seen.push([this.className, k[0].opacity]); const a = {}; this._a = a; return a; };
  const draw = () => { r.innerHTML = `<article class="task-card"><div class="tc-foot"><button data-t="1" aria-expanded="${open}">x</button></div>${open ? '<div class="tc-stream">s</div>' : ''}</article>`; };
  draw(); r.addEventListener('click', (e) => { if (e.target.closest('[data-t]')) { open = !open; draw(); } });
  C.watchFolds(r, { win: w });
  r.querySelector('[data-t]').click(); assert.deepEqual(seen[0], ['tc-stream', 0], 'opens from nothing');
  seen.length = 0; r.querySelector('[data-t]').click(); const g = r.querySelector('.tc-stream');
  assert.ok(g && g.getAttribute('aria-hidden') === 'true', 'a copy stands in while it closes'); assert.deepEqual(seen[0], ['tc-stream', 1]);
  g._a.onfinish(); assert.equal(r.querySelector('.tc-stream'), null, 'and goes');
  assert.equal(C.foldKey(r.querySelector('[data-t]')), '[data-t="1"][aria-expanded]');
});
test('draftBar: a draft, its changes, that the saved one still runs, Discard and Save (rail.drafts)', () => {
  const d = dom(C.draftBar({ changes: 2, hooks: { save: { 'data-s': '' }, discard: { 'data-d': '' } } }));
  assert.equal(d.getAttribute('role'), 'status'); assert.match(d.textContent, /Draft/); assert.match(d.textContent, /2 changes · tasks still run the saved one/);
  assert.ok(d.querySelector('[data-s]').classList.contains('btn-primary') || /primary/.test(d.querySelector('[data-s]').className)); assert.ok(d.querySelector('[data-d]'));
  assert.match(dom(C.draftBar({ changes: 1 })).textContent, /1 change ·/);
  assert.match(dom(C.draftBar({ changes: 0, fresh: true })).textContent, /never saved · nothing can run it yet/);
});
test('workflowStory: a panel a step, the loop drawn back in words under the steps it joins, how a task goes (panel.workflow-story)', () => {
  const s = dom(C.workflowStory({ steps: [{ name: 'Plan', says: 'Thinks', meta: '3 min' }, { name: 'Build', says: 'Makes' }, { name: 'Check', says: 'Looks', check: true }, { name: 'Review', says: 'Reads' }], loop: { from: 2, to: 1, text: 'back to Build' }, ways: [{ title: 'Straight through', meta: '18 min', tone: 'ok', stage: 4 }], byline: 'Told by a small model' }));
  assert.equal(s.querySelectorAll('.ws-p').length, 4); assert.ok(s.querySelectorAll('.ws-p')[2].classList.contains('is-check'));
  const loop = s.querySelector('.ws-loop'); assert.equal(loop.style.left, '37.5%'); assert.equal(loop.style.width, '25%'); assert.match(loop.textContent, /back to Build/);
  assert.match(s.querySelector('.list').textContent, /Straight through/); assert.match(s.querySelector('.ws-by').textContent, /small model/);
  assert.equal(dom(C.workflowStory({ steps: [{ name: 'A', says: 'a' }] })).querySelector('.ws-loop'), null, 'no loop, no arc');
});
test('crafting: a sketch of its kind that draws itself, and what is being made (motion.crafting)', () => {
  const c = dom(C.crafting({ kind: 'workflow', label: 'Making the workflow', detail: 'from this chat' }));
  assert.equal(c.getAttribute('role'), 'status'); assert.ok(c.querySelectorAll('.craft-art path[pathLength="1"]').length > 3);
  assert.equal(c.querySelector('.craft-t b').textContent, 'Making the workflow'); assert.equal(c.querySelector('.craft-t span').textContent, 'from this chat');
  assert.notEqual(C.crafting({ kind: 'image', label: 'x' }), C.crafting({ kind: 'workflow', label: 'x' }), 'each kind its own sketch');
  assert.ok(dom(C.crafting({ kind: 'nope', label: 'x' })).querySelector('path'), 'an unknown kind draws as a document');
});
test('artifactView: its name and where from, Previous and Next through the others, Open full and Download (panel.task-depth)', () => {
  const v = dom(C.artifactView({ name: 'plan.md', meta: 'Plan', body: '<p>Hi</p>', at: 0, of: 3, hooks: { prev: { 'data-p': '' }, next: { 'data-n': '' }, full: { 'data-f': '' }, download: { 'data-d': '' } } }));
  assert.equal(v.querySelector('.av-h b').textContent, 'plan.md'); assert.ok(v.querySelector('[data-p]').disabled, 'the first has no previous'); assert.ok(!v.querySelector('[data-n]').disabled);
  assert.match(v.querySelector('.av-n').textContent, /1 of 3/); assert.ok(v.querySelector('[data-f]') && v.querySelector('[data-d]')); assert.equal(v.querySelector('.av-body p').textContent, 'Hi');
  assert.equal(dom(C.artifactView({ name: 'a', body: '' })).querySelector('.av-n'), null, 'one alone: no stepping');
  assert.ok(![...dom(C.artifactView({ name: 'a', body: '', hooks: { download: {} } })).querySelectorAll('button')].some((x) => x.textContent.trim() === 'Open full'), 'outside Expert it has no page to open (rail.stay-in-chat)');
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
  assert.equal(dom(C.stageBar({ labels: ['a', 'b'], stage: 0, bare: true })).querySelector('.sb-labels'), null, 'bare: the line alone (rail.one-place)');
  const line = dom(C.stageBar({ labels: ['Plan', 'Build', 'Review', 'PR', 'Merged'], stage: 2, tone: 'ask', step: [2, 3] }));   // look.stage-line
  assert.equal(line.querySelectorAll('.sl-knot').length, 5); assert.equal(line.querySelectorAll('.sl-knot.is-done').length, 2); assert.ok(line.querySelectorAll('.sl-knot')[2].classList.contains('is-now'));
  assert.equal(line.querySelectorAll('.sl-step').length, 3); assert.equal(line.querySelectorAll('.sl-step.is-done').length, 1); assert.ok(line.querySelectorAll('.sl-step')[1].classList.contains('is-now'));
  assert.match(line.querySelector('.sb-labels b').textContent, /Review2 of 3/);
  assert.equal(dom(C.stageBar({ labels: ['a', 'b'], stage: 1, tone: 'merged', step: [1, 3] })).querySelectorAll('.sl-step').length, 0, 'merged: no steps, the whole line in its colour');
  assert.deepEqual(C.stageStep('Review · step 2 of 3'), [2, 3]); assert.equal(C.stageStep('Waiting'), null);
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

test('watchMenus: a menu with no room under it opens above; menuUp says when', async () => {
  assert.equal(C.menuUp({ top: 700, bottom: 720 }, 200, 760), true, 'no room under, more above: up');
  assert.equal(C.menuUp({ top: 100, bottom: 120 }, 200, 760), false, 'room under: down');
  assert.equal(C.menuUp({ top: 80, bottom: 100 }, 900, 760), false, 'no room either way: down, where there is more');
  assert.equal(C.menuShift({ left: 200, right: 420 }, { left: 0, right: 280 }), -148, 'past a sidebar\'s edge: it slides back inside');
  assert.equal(C.menuShift({ left: 20, right: 200 }, { left: 0, right: 280 }), 0, 'inside: it stays');
  const { foldCut } = await import('../ui/public/design-system/components/menu-place.mjs');
  assert.equal(foldCut([{ head: 100, option: 150 }, { head: 562, option: 632 }], 599), 562, 'comp.menu-groups: a head whose option is past the fold ends the menu above it');
  assert.equal(foldCut([{ head: 100, option: 150 }, { head: 700, option: 760 }], 599), null, 'a head wholly past the fold, or with its option showing, changes nothing');
  const { window } = new JSDOM('<body><span class="rc-pop"><button>+</button></span></body>', { pretendToBeVisual: true });
  C.watchMenus(window.document);
  window.document.querySelector('.rc-pop').insertAdjacentHTML('beforeend', '<div class="menu" role="menu"></div>');
  return new Promise((r) => setTimeout(r, 0)).then(() => { assert.ok(window.document.querySelector('.menu').hasAttribute('data-placed'), 'a menu that opens is placed'); window.close(); });
});

test('pluginCard: its actions end the card, so they line up across a row (panel.plugin-card)', () => {
  const css = readFileSync('ui/public/stillhet/css/rail.css', 'utf8');
  assert.match(css, /\.pg-card\{grid-template-rows:repeat\(5,auto\) 1fr;\}/);
  assert.match(css, /\.pg-a\{[^}]*grid-row:6;align-self:end;/);
});

test('runOutcomes: a square per run, oldest first, named the last 7 runs (panel.run-outcomes)', () => {
  const c = dom(C.runOutcomes({ runs: ['ok', 'fail', 'run', 'miss'], says: '3 of 4' }));
  assert.equal(c.querySelectorAll('.ro-sq').length, 4);
  assert.ok(c.querySelector('.ro-sq.is-fail') && c.querySelector('.ro-sq.is-miss'));
  assert.match(c.querySelector('.ro-sqs').getAttribute('title'), /last 7 runs/);
  assert.match(c.textContent, /3 of 4/);
  assert.equal(dom('<div>' + C.runOutcomes({ runs: [], says: 'No runs in 7 days' }) + '</div>').querySelector('.ro-sqs'), null);
});

test('center parts: a task said one way, a shelf, the line for a shared project (panel.center-shelf)', () => {
  assert.equal(C.taskClause({ state: 'failed', name: 'N', detail: 'Build · 3 failed' }), 'N failed at Build');
  assert.ok(C.taskRank('failed') < C.taskRank('question') && C.taskRank('question') < C.taskRank('gate') && C.taskRank('gate') < C.taskRank('ready'));
  const one = dom(`<div>${C.taskActions([{ id: 'a', title: 'A', state: 'failed' }])}</div>`).querySelector('button');
  assert.equal(one.textContent.trim(), 'Retry'); assert.match(one.className, /primary/);
  const two = [...dom(`<div>${C.taskActions([{ id: 'a', title: 'A', short: 'cron', state: 'gate' }, { id: 'b', title: 'B', short: 'pager', state: 'ready' }])}</div>`).querySelectorAll('button')];
  assert.deepEqual(two.map((b) => b.textContent.trim()), ['Approve cron', 'Create PR pager']);   // Tasks D16: a ready task has no PR yet
  assert.ok(two.every((b) => !/primary/.test(b.className)));
  const s = dom(C.centerShelf({ title: 'Web<b', word: 'Failed', tone: 'fail', link: C.textLink({ label: 'Workspace map' }), cards: '<i class="c"></i>', rest: '<i class="r"></i>' }));
  assert.equal(s.querySelector('.pg-shelf-h').firstChild.textContent, 'Web<b'); assert.equal(s.querySelector('.pg-state.is-fail').textContent, 'Failed');
  assert.ok(s.querySelector('.center-shelf-l .dc-link') && s.querySelector('.pg-grid .c') && s.querySelector(':scope > .r'));
  assert.equal(dom(C.centerShelf({ title: 'x' })).querySelector('.pg-shelf-m'), null);
  assert.match(dom(C.centerAlso({ mark: '', name: 'billing-api', where: 'Web shop', link: 'Answer there' })).textContent, /billing-api · Also in Web shop · Answer there/);
  const q = dom(C.quietLine({ n: 1, noun: 'project', names: 'a', hook: { 'data-q': '' } }));
  assert.match(q.textContent, /1 quiet project/); assert.ok(q.querySelector('[data-q][aria-expanded="false"]'));
  assert.equal(dom(C.quietLine({ n: 3, noun: 'project', names: 'zed', open: true })).textContent.includes('zed'), false);
  const c = dom(`<div>${C.centerSentence({ words: 'Showing', open: true, facts: '4 running' })}</div>`);
  assert.match(c.textContent, /4 running/); assert.doesNotMatch(dom(`<div>${C.centerSentence({ words: 'S', facts: '4 running' })}</div>`).textContent, /4 running/);
});

test('pluginCard in a center: its state first and in its colour, links in what it says, facts on one line (panel.center)', () => {
  const c = dom(C.pluginCard({ mark: '', word: 'Failed', tone: 'fail', title: 'web-app', whatHtml: C.textLink({ label: 'Update Node' }), line: '<i class="l"></i>', factsHtml: '2 running', factsTip: '2 running', action: '<button>Retry</button>' }));
  assert.equal(c.querySelector('.pg-state.is-fail').textContent, 'Failed');
  assert.ok(c.querySelector('.pg-w .dc-link') && c.querySelector('.pg-line .l'));
  assert.ok(c.querySelector('.pg-f.is-one'));
});

test('cardAction: the step that fits each state; anything else opens (panel.center)', () => {
  assert.deepEqual(['failed', 'question', 'gate', 'ready', 'approved', 'paused-limit', 'working'].map((s) => C.cardAction(s).label), ['Retry', 'Answer', 'Approve', 'Create PR', 'Merge', 'Resume', 'Open']);   // Tasks D16: only approved merges
  assert.deepEqual(C.cardAction('failing'), { label: 'Fix checks', does: 'fix-checks' }, 'failing checks: the task page\'s own action (web-UI review cycle 3)');
});

test('scheduleDates and scheduleButton: the next times and the named step', () => {
  const from = new Date(2026, 10, 12), f = (o) => C.scheduleDates({ from, at: '09:00', ...o }).map((d) => d.getDate());
  assert.deepEqual(f({ every: 'every weekday' }), [13, 16, 17]);
  assert.deepEqual(f({ every: 'every Monday', n: 1 }), [16]);
  assert.deepEqual(f({ every: 'every day', at: '16:00' }), [12, 13, 14]);
  assert.equal(C.scheduleButton({ every: 'every weekday', at: '09:00' }), 'Schedule weekdays at 09:00');
  assert.equal(C.scheduleButton({ every: 'every day', at: '02:00' }), 'Schedule every day at 02:00');
});

test('menus keep one edge only for check marks: a switch item (the account menu) keeps its own layout', () => {
  const css = readFileSync('ui/public/stillhet/css/rail.css', 'utf8');
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

test('planCard: Read the plan, its foot, folds the plan itself open, to read before approving', () => {
  const shut = C.planCard({ title: 'P', version: 'v1 of 1', roles: [], full: '<h4>Steps</h4>' });
  assert.match(shut, /Read the plan/); assert.doesNotMatch(shut, /plan-full/);
  const open = C.planCard({ title: 'P', version: 'v1 of 1', roles: [], full: '<h4>Steps</h4>', fullOpen: true });
  assert.match(open, /class="tc-foot">[\s\S]*class="plan-full"><h4>Steps/); assert.match(open, /Hide the plan/); assert.match(open, /aria-expanded="true"/);
  assert.doesNotMatch(C.planCard({ title: 'P', version: 'v1', roles: [] }), /Read the plan/, 'no plan to show: no button');
});

test('planCard (panel.plan-folds): its coverage heads the plan it folds open, one row per requirement; shut, none shows', () => {
  const coverage = [{ name: 'R-1 · covered by Step 2', ok: true, note: '' }, { name: 'R-2 · <totals>', ok: false, note: 'not covered by any step' }];
  const open = C.planCard({ title: 'P', version: 'v1', roles: [], full: '<h4>Steps</h4>', fullOpen: true, coverage });
  assert.match(open, /class="plan-full"><div class="plan-roles" role="group" aria-label="Requirements">[\s\S]*1 of 2 covered[\s\S]*R-2 · &lt;totals&gt;<\/b> not covered by any step[\s\S]*<h4>Steps/);
  assert.doesNotMatch(C.planCard({ title: 'P', version: 'v1', roles: [], full: '<h4>Steps</h4>', coverage }), /Requirements/, 'folded: no extra chrome on the card');
});

test('topBarAction: its name is its words even when only its icon and badge show', () => {
  assert.match(C.topBarAction({ label: 'Pulse', icon: '', labelCls: 'x', badge: { n: 3 }, title: 'Pulse: 3 need you' }), /aria-label="Pulse: 3 need you"/);
  assert.match(C.topBarAction({ label: 'Pulse', icon: '', labelCls: 'x' }), /aria-label="Pulse"/);
});

test('sentencePicker: a body (a ListEditor) opens in place of its menu, placed as a menu', () => {
  const h = C.sentencePicker({ id: 'l', text: '+ Label', open: true, body: C.listEditor({ label: 'Labels', inputId: 'q', placeholder: 'Find or make a label', sections: [{ title: 'Labels', kind: 'label', many: true, rows: [{ text: 'infra', n: '', on: false }] }] }) });
  assert.match(h, /class="menu spick-menu rc-list-ed"/); assert.match(h, /aria-haspopup="dialog"/); assert.match(h, /Find or make a label/);
});

test('ScrollFade: an edge fades only while there is more past it', () => {
  assert.deepEqual(C.scrollEdges({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 }), { above: false, below: true });
  assert.deepEqual(C.scrollEdges({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 }), { above: true, below: false }, 'at the end, the last line is never dimmed');
  const { window } = new JSDOM('<body><div class="convo-scroll"></div></body>');
  C.watchScrollFades(window.document);
  assert.equal(window.document.querySelector('.convo-scroll').hasAttribute('data-more-below'), false, 'nothing past it: no fade');
  window.close();
});

test('commands: dev\'s group head, rows with no mark, Copy on the command and its output', () => {
  assert.equal(C.commandHead({ count: 3, failed: 1, dur: '5.4s' }), '<b>Ran 3 commands</b> · <span class="cmd-failed">1 failed</span> · 5.4s');
  assert.match(C.commandHead({ count: 3, running: true, current: 'Running the tests', dur: '2.1s' }), /^<b>Running the tests<\/b> · 3 commands · 2.1s$/);
  assert.match(C.commandLine('a && b | c'), /<span class="cmd-op">&amp;&amp;<\/span>/);
  const shut = C.commandRow({ summary: 'Ran the tests', cmd: 'npm test', state: 'fail', end: 'exit 1 · 4.2s' });
  assert.match(shut, /cmd-row is-fail/); assert.match(shut, /title="npm test"/); assert.doesNotMatch(shut, /cmd-detail/); assert.match(shut, /<span class="tr-mark"><\/span>/, 'no mark');
  const open = C.commandRow({ summary: 'Counted', cmd: 'ls | wc -l', open: true, dir: 'worca-cc', out: '84', hooks: { terminal: { 'data-t': '' } } });
  assert.match(open, /Copy command/); assert.match(open, /Copy output/); assert.match(open, /Output · 1 line</); assert.match(open, /in worca-cc/); assert.match(open, /Show in terminal/);
  assert.match(C.commandRow({ summary: 'x', cmd: 'x', state: 'run' }), />Stop</, 'a running command can be stopped');
  const g = C.commandGroup({ head: C.commandHead({ count: 2, dur: '1s' }), open: true, rows: '<i>r</i>', running: true });
  assert.match(g, /cmd-rows"><i>r<\/i>/); assert.match(g, />Stop</);
});

test('the Rail stylesheets close every rule: one open brace would swallow all that follows', () => {
  for (const f of ['ui/public/stillhet/css/rail.css', 'ui/public/stillhet/css/rail-look.css', 'ui/public/stillhet/shell/shell.css', 'ui/public/stillhet/pulse/pulse.css']) {
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
  assert.match(C.changeProposal({ kind: 'Away', title: 'Quiet', rows, state: 'applied', hooks: { revert: { 'data-x': '1' } } }), />Revert</);
  assert.doesNotMatch(C.changeProposal({ kind: 'Away', title: 'Quiet', rows, state: 'applied' }), />Revert</, 'no Revert where the change cannot be undone');
  assert.match(C.changeProposal({ kind: 'Away', title: 'Quiet', rows, state: 'declined' }), /Not changed/);
  assert.match(C.turnDivider({ text: 'Switched to a' }), /role="separator"[^>]*aria-label="Switched to a"/);
});

test('refChip (panel.answer-refs): a chip that leads to what it names, with its hook and tip; words escaped', () => {
  const c = dom(C.refChip({ text: '<Fix>', mark: '<i></i>', attrs: { 'data-ref-run': 'pa' } }));
  assert.equal(c.tagName, 'BUTTON'); assert.equal(c.getAttribute('type'), 'button');
  assert.equal(c.dataset.refRun, 'pa');
  assert.equal(c.title, 'Opens <Fix> in its chat');
  assert.equal(c.textContent, '<Fix>');
  assert.equal(dom(C.refChip({ text: 'a#1', title: 'Opens the PR' })).title, 'Opens the PR');
});

test('planCard, filesCard, youTurn: the Shaper plan folds its roles; files as tiles and rows; your words with what came with them', () => {
  const roles = [{ name: 'Security', ok: false, note: 'Flag first' }, { name: 'UX', ok: true, note: 'Fine' }];
  const shut = C.planCard({ title: 'Plan', version: 'v2 of 2', roles });
  assert.match(shut, /Plan · v2 of 2/); assert.match(shut, /Reviewed by [^·<]+ · 1 open/);   // up to three reviewers are named assert.doesNotMatch(shut, /Flag first/); assert.match(shut, />Approve and build</);
  assert.match(C.planCard({ title: 'Plan', version: 'v2', roles, open: true }), /Security<\/b> Flag first/);
  const f = C.filesCard({ files: [{ name: 'a.png', image: true }, { name: 'b.txt', meta: '2 KB' }] });
  assert.match(f, /fc-tile[\s\S]*a\.png/); assert.match(f, /<b>b\.txt<\/b> 2 KB/); assert.match(f, /aria-label="Download b\.txt"/);
  const y = C.youTurn({ text: 'Same bug?', quote: 'Off by a cent', files: ['x.pdf'] });
  assert.match(y, /you-quote">Off by a cent/); assert.match(y, /x\.pdf/);
  assert.match(C.youTurn({ text: 'Hi', time: C.turnTime({ at: Date.now() }) }), /<time class="turn-time"[^>]*>\d\d:\d\d<\/time><\/div>$/);   // turnTime: its time is the turn's last child
  assert.doesNotMatch(C.changeProposal({ kind: 'Agent', title: 'New', rows: [{ name: 'Reads', before: '', after: 'PRs' }] }), /→/);
});

test('askWorcaMark: the bubble and its W at rest, dots while writing, filled while open; writing wins', () => {
  assert.match(C.askWorcaMark(), /M5 4h14/); assert.match(C.askWorcaMark(), /M7.4 8.2/); assert.doesNotMatch(C.askWorcaMark(), /circle|mask/);
  assert.match(C.askWorcaMark({ answering: true }), /<circle/);
  assert.match(C.askWorcaMark({ open: true }), /mask="url\(#ask-worca-cut\)"/);
  assert.match(C.askWorcaMark({ open: true, answering: true }), /<circle/);
});

test('topBarAction: with news, it carries is-news; the look animates it', () => {
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
  assert.doesNotMatch(C.stageLine({ mark: '', label: 'Plan' }), /<button/);   // nothing to open: a row, not a dead button
  assert.match(C.stageLine({ mark: '', label: 'Plan', attrs: { 'data-stage-line': 'plan' } }), /<button[^>]*data-turn-toggle/);
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
  const sw = C.scheduleWords;   // small.schedule-words
  assert.deepEqual(sw({ every: 'every hour', at: '07:30' }), { runs: 'every hour', says: 'Every hour', next: 'Next within the hour', time: 'Hourly', day: 'today' });
  assert.equal(sw({ every: 'every month on the 1st', at: '07:30' }).next, 'Next on the 1st at 07:30');
  assert.equal(sw({ every: 'every weekend', at: '02:00' }).next, 'Next weekend at 02:00');
  assert.equal(sw({ every: 'every Monday', at: '09:00' }).day, 'week'); assert.equal(sw({ every: 'every day', at: '02:00' }).day, 'tomorrow'); assert.equal(sw({ every: 'every day', at: '20:00' }).time, '20:00');
  assert.ok(C.REPEATS.includes('every day') && C.REPEATS.includes('once') && C.REPEATS.includes('every weekend') && C.REPEATS.includes('every Sunday')); assert.equal(C.TIMES_OF_DAY.length, 48); assert.equal(C.TIMES_OF_DAY[5], '02:30');
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

test('charts: a caption says what the chart shows, and none is drawn without one', () => {
  const bars = [{ label: 'Mon', value: 1, text: '$1' }];
  assert.equal(dom(C.barChart({ label: 'x', bars, caption: 'Per day' })).querySelector('.ch-cap').textContent, 'Per day');
  assert.equal(dom(C.barChart({ label: 'x', bars })).querySelector('.ch-cap'), null);
  assert.equal(dom(C.mixChart({ label: 'x', labels: ['Mon'], parts: [{ label: 'a', values: [1] }], caption: 'Per day' })).querySelector('.ch-cap').textContent, 'Per day');
  assert.equal(dom(C.lineChart({ label: 'x', labels: ['Mon'], series: [{ label: 'a', points: [{ value: 1, text: '$1' }] }], caption: 'Per day' })).querySelector('.ch-cap').textContent, 'Per day');
});

test('barChart by a dimension: bars stack in ink shades with a legend, a limit is one thin line named once', () => {
  const c = dom(C.barChart({ label: 'x', play: true, limit: { value: 67, text: 'Budget pace $67 a day' }, parts: [{ label: 'a', values: [6, 0] }, { label: 'b', values: [4, 20] }], bars: [{ label: 'd1', value: 10, text: '$10' }, { label: 'd2', value: 20, text: '$20' }] }));
  assert.equal(c.querySelectorAll('.bc-bar.is-stack').length, 2); assert.equal(c.querySelectorAll('.bc-col')[1].querySelectorAll('.ch-seg').length, 1);
  assert.deepEqual([...c.querySelectorAll('.ch-key')].map((k) => k.textContent), ['a', 'b', 'Budget pace $67 a day']);
  assert.equal(c.querySelectorAll('.bc-limit').length, 1); assert.match(c.querySelector('.bc-col').dataset.read, /a 6 · b 4/);
  assert.equal(c.querySelectorAll('.bc-table thead th').length, 4);
});
test('barChart: a number that would sit on the limit line goes beside its bar', () => {
  const bars = [{ label: 'd1', value: 93, text: '$93' }, { label: 'd2', value: 60, text: '$60' }];
  const c = dom(C.barChart({ label: 'x', limit: { value: 67, text: 'pace' }, bars, current: 1 }));
  assert.ok(c.querySelectorAll('.bc-v')[1].classList.contains('is-beside'));
  assert.ok(!c.querySelectorAll('.bc-v')[0].classList.contains('is-beside'), 'clear of the line, it stays on top');
});
test('workspaceMap: links leaving one box turn at their own place', () => {
  const map = dom(C.workspaceMap({ label: 'M', nodes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }, { id: 'c', title: 'c' }], links: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c', unsure: true }] }));
  const [p, q] = [...map.querySelectorAll('.wm-w')].map((w) => w.getAttribute('d').match(/H([\d.]+)V/)[1]);
  assert.notEqual(p, q);
});
test('needsReason: a task under Needs you says why in a word or two', () => {
  assert.equal(C.needsReason('question'), 'Question'); assert.equal(C.needsReason('failed'), 'Failed');
  assert.equal(C.needsReason('plan'), 'Needs approval');
});
test('runState plan: a plan waiting for your approval wears the pencil, as a gate does (list.kind-mark)', () => {
  const st = C.runState('plan');
  assert.equal(st.word, 'Needs approval'); assert.equal(st.sym, 'q'); assert.equal(st.approval, true);
  assert.equal(C.markTone(st), 'act');
  assert.equal(C.alertLevel(C.markTone(st)), C.alertLevel('ask'), 'the badge tone holds');
  assert.equal(C.sectionOf(st.word, 'plan'), 'needs', 'it stays under Needs you'); assert.equal(C.bulkStateOf(st.word), 'needs-you');
  assert.match(readFileSync('plans/rail/prototype/components.html', 'utf8'), /runState\('plan'\)/, 'the gallery shows a plan-state TaskCard');
});
test('a branch on a card is in the text face, not the mono (look.md)', () => {
  const css = readFileSync('ui/public/stillhet/css/rail.css', 'utf8');
  for (const sel of ['.rc-mid', '.rc-base']) {
    const rule = css.match(new RegExp(`^\\${sel}\\{[^}]*\\}`, 'm'))[0];
    assert.doesNotMatch(rule, /--mono/, sel);
  }
});
test('roundRows: one line, one end', () => {
  const shut = dom(C.roundRows({ line: 'Round 2', n: 1, open: false, toggle: { 'data-rounds': 'r' } }));
  assert.equal(shut.querySelectorAll('button').length, 1); assert.equal(shut.querySelector('button[data-rounds]').querySelector('.lr-round-end').textContent, '1 round');
});
test('watchChart: a chart that narrows keeps the drag in its tooltip', () => {
  const fig = dom(C.barChart({ label: 'x', play: true, bars: [1, 2, 3].map((v) => ({ label: `d${v}`, value: v, text: `$${v}` })) }));
  C.watchChart(fig, { narrow: () => {} }); assert.equal(fig.querySelector('.bc-plot').title, 'Drag across to narrow');
});

test('figuresToggle, figuresLine: counts and costs on demand (look.figures-on-demand)', () => {
  const t = dom(C.figuresToggle({ attrs: { 'data-x': '1' } }));
  assert.equal(t.querySelector('.spick-b').getAttribute('aria-expanded'), 'false'); assert.match(t.textContent, /Figures/);
  assert.equal(dom(C.figuresToggle({ card: true, open: true })).getAttribute('aria-expanded'), 'true');
  assert.match(C.figuresLine('60 tasks'), /figs-line/);
});

test('alertLevel: the ladder, on every tone (look.alert-ladder)', () => {
  assert.deepEqual(['fail', 'ask', 'act', 'ok', 'run', 'merged', 'pause'].map(C.alertLevel), [3, 2, 2, 1, 0, 0, 0]);
  assert.equal(C.markTone(C.runState('capped')), 'fail', 'a cap that stops work is a Warning');
  assert.equal(C.markTone(C.runState('gate')), 'act', 'an approval is the pencil');
  assert.equal(C.markTone(C.runState('paused-you')), 'pause', 'a pause of yours is Normal');
});

test('kindMark: a task\'s glyph shows its state; merged is full ink with no ring; a plugin is one ink (list.kind-mark)', () => {
  const inner = (tone) => { return dom(C.kindMark({ kind: 'task', tone })).querySelector(':scope > svg:not(.km-ring)').innerHTML; };
  const glyph = (n) => dom(C.icon(n, 13)).innerHTML;
  for (const [tone, n] of [['run', 'kind-task'], ['wait', 'waiting'], ['pause', 'pause'], ['ask', 'question'], ['act', 'approve'], ['ok', 'check'], ['fail', 'alert'], ['stop', 'sym-stop'], ['merged', 'merge']]) assert.equal(inner(tone), glyph(n), tone);
  assert.doesNotMatch(C.kindMark({ kind: 'task', tone: 'merged' }), /km-ring/, 'merged has no ring');
  assert.match(C.kindMark({ kind: 'chat', tone: 'ask' }), new RegExp(glyph('kind-chat').slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'a chat keeps its bubble');
  assert.match(C.kindMark({ kind: 'plugin', tone: 'act' }), /is-idle/, 'a plugin takes no colour');
  assert.match(C.kindMark({ kind: 'task', tone: 'ok', advisory: true }), /is-adv/);
  assert.match(C.kindMark({ kind: 'task', tone: 'ok', landed: true }), /is-landed/);
});

test('one icon, one meaning: Web access is the globe, failed checks are not ×, cost and time have their own (look.one-icon)', () => {
  for (const n of ['hourglass', 'dollar', 'globe', 'approve', 'waiting']) assert.ok(C.ICONS[n], n);
  assert.match(C.changeProposal({ kind: 'Web access', title: 'Read a page', state: 'proposed' }), new RegExp(C.ICONS.globe.slice(0, 20)));
});

test('finished is a plain check, ready a check in a ring, merged the branch; a place that stopped shows "!" (look.alert-ladder)', () => {
  const R = C;
  assert.equal(R.markTone({ word: 'Finished' }), 'done');
  assert.equal(R.markTone({ word: 'Ready to merge' }), 'ok');
  assert.equal(R.alertLevel('done'), 0);
  assert.equal(R.alertLevel('ok'), 1);
  assert.ok(!R.kindMark({ kind: 'task', tone: 'done' }).includes('km-ring'));
  assert.ok(R.kindMark({ kind: 'task', tone: 'ok' }).includes('km-ring'));
  assert.equal(R.kindMark({ kind: 'project', tone: 'fail' }), R.kindMark({ kind: 'project', tone: 'fail', icon: 'alert' }));
  assert.match(R.kindMark({ kind: 'chat', tone: 'fail', outline: true }), /is-outline/);
});

test('stillhetInvitation and designSwitch render their roles and hooks', () => {
  const inv = dom(C.stillhetInvitation({ bugsUrl: 'https://github.com/o/r/issues' }));
  assert.equal(inv.getAttribute('role'), 'alertdialog');
  assert.equal(inv.dataset.stillhet, 'invitation');
  const sw = dom(C.designSwitch({ on: true }));
  assert.equal(sw.dataset.stillhet, 'design-switch');
  assert.equal(sw.querySelector('[role="switch"]').getAttribute('aria-checked'), 'true');
});

test('frame parts (brandRow, navSection, barGrip, sidebarFrame, sideToggle, menuButton, topBarFrame, askButton): the sidebar and top bar landmarks', () => {
  const side = dom(C.sidebarFrame({ brand: C.brandRow(), nav: C.navSection({ label: 'Work' }), grip: C.barGrip() }));
  assert.equal(side.tagName, 'ASIDE'); assert.equal(side.id, 'side-rail');
  assert.ok(side.querySelector('.bar-grip[role="separator"]'));
  const top = dom(C.topBarFrame({ title: 'Tasks', left: C.menuButton() + C.sideToggle() }));
  assert.equal(top.tagName, 'HEADER'); assert.equal(top.querySelectorAll('#mbar-menu[aria-expanded="false"], #side-toggle[aria-expanded="true"]').length, 2);
});
