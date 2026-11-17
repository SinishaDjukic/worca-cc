// test/design-system-shell-redesign.test.mjs — the shell redesign's parts (ui/public/design-system/components/):
// PlaceButton, its menu's items and the bar's head; SkipLink; NewTaskButton; NarrowedLine; FilterRow's cases; the list's
// roles, its Tab stops and its whole-row target; the Search as a combobox; classic's names as search words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { placeButton, placeItems, barPlaceHead, skipLink } from '../ui/public/design-system/components/shell-frame.mjs';
import * as R from '../ui/public/design-system/components/index.mjs';
import { filterRow, narrowedLine, groupRow } from '../ui/public/design-system/components/list-parts.mjs';
import { list, listRow } from '../ui/public/design-system/components/list.mjs';
import { listController } from '../ui/public/design-system/components/list-page.mjs';
import { search, searchResults, watchSearch } from '../ui/public/design-system/components/side-menu.mjs';

const dom = (html) => new JSDOM(`<body>${html}</body>`).window.document.body.firstElementChild;

test('placeButton: the name and the chevron are one button that says it opens the places', () => {
  const b = dom(placeButton({ title: 'Ta<sks', open: true, attrs: { 'data-bar-house': '' } }));
  assert.equal(b.tagName, 'BUTTON');
  assert.equal(b.querySelector('.place-btn-t').textContent, 'Ta<sks');
  assert.ok(b.querySelector('svg'), 'the chevron is inside the same button');
  assert.equal(b.getAttribute('aria-haspopup'), 'menu'); assert.equal(b.getAttribute('aria-expanded'), 'true');
  assert.equal(b.getAttribute('aria-label'), 'Ta<sks: go to another place');
  assert.ok(b.hasAttribute('data-bar-house'));
  assert.equal(dom(placeButton({ title: 'Chat' })).getAttribute('aria-expanded'), 'false');
});

test('placeItems: the place\'s home first, then each place with its count, the current one checked', () => {
  const items = placeItems({ home: { id: 'runs', label: 'Tasks home' }, places: [{ id: 'chat', label: 'Chat', count: 8 }, { id: 'runs', label: 'Tasks', count: 10, current: true }, { id: 'workflows', label: 'Workflows' }, { id: 'requirements', label: 'Requirements', lab: true }] });
  assert.equal(items[0].id, 'bar-go|runs'); assert.equal(items[0].text, 'Tasks home'); assert.equal(items[0].checked, undefined, 'the home is a way, not a choice');
  assert.deepEqual(items[1], { sep: true });
  assert.deepEqual(items[2], { header: 'Places', end: 'need you' }, 'small.one-count: one quiet caption says what the numbers count');
  assert.deepEqual(items.slice(3).map((x) => [x.id, x.text, x.hint, x.checked]), [['bar-go|chat', 'Chat', '8', false], ['bar-go|runs', 'Tasks', '10', true], ['bar-go|workflows', 'Workflows', undefined, false], ['bar-go|requirements', 'Requirements', 'Labs', false]]);
  assert.equal(placeItems({ places: [{ id: 'chat', label: 'Chat' }] }).length, 1, 'no home, no rule');
});

test('barPlaceHead: the W alone goes home; the place\'s name is the one PlaceButton; the home bar\'s name is plain text', () => {
  const h = dom(barPlaceHead({ title: 'Tasks', logo: '<i></i>', open: true, menu: '<div class="menu"></div>', action: '<b id="plus"></b>', hide: '<b id="hide"></b>' }));
  const buttons = [...h.querySelectorAll('button')];
  assert.equal(buttons.length, 2, 'two controls: the W and the place button (never a name and a chevron apart)');
  assert.ok(buttons[0].matches('.bar-house[data-bar-home]')); assert.equal(buttons[0].getAttribute('aria-label'), 'Home');
  assert.ok(buttons[1].matches('h2.bar-title > .place-btn[data-bar-house]'));
  assert.ok(h.querySelector('.bar-quick > .menu')); assert.ok(h.querySelector('#plus')); assert.ok(h.querySelector('#hide'));
  assert.equal(dom(barPlaceHead({ title: 'Tasks', menu: '<div class="menu"></div>' })).querySelector('.bar-quick'), null, 'closed: no menu');
  const home = dom(barPlaceHead({ title: 'Worca', places: false }));
  assert.equal(home.querySelector('.place-btn'), null); assert.equal(home.querySelector('.bar-title-w').textContent, 'Worca');
});

test('skipLink: the first Tab stop names where it goes; the new parts are the library\'s exports', () => {
  const s = dom(skipLink());
  assert.equal(s.tagName, 'A'); assert.equal(s.getAttribute('href'), '#main-content'); assert.equal(s.dataset.skip, 'main-content'); assert.equal(s.textContent, 'Skip to content');
  for (const k of ['placeButton', 'placeItems', 'barPlaceHead', 'skipLink', 'narrowedLine', 'watchSearch']) assert.equal(typeof R[k], 'function', `${k} is exported`);
});

test('narrowedLine: says what the visit is narrowed to and offers Clear, a real button', () => {
  const n = dom(narrowedLine({ to: 'web<app' }));
  assert.equal(n.getAttribute('role'), 'status');
  assert.equal(n.querySelector('.list-narrowed-t').textContent, 'Narrowed to web<app');
  const b = n.querySelector('button[data-narrow-clear]');
  assert.equal(b.textContent, 'Clear'); assert.ok(b.matches('.btn') && !b.matches('.btn-quiet'));
  assert.ok(dom(list({ groups: [], note: narrowedLine({ to: 'x' }), sentence: '<i></i>' })).querySelector('.list-sentence + .list-narrowed'), 'under the filters');
});

const PARTS = () => [{ id: 'show', word: 'Showing', tabs: ['all', 'needs', 'running'], text: 'waiting', items: [{ id: 'all', text: 'all', hint: '62', checked: false }, { id: 'needs', text: 'needs you', hint: '5', checked: false }, { id: 'running', text: 'running', hint: '6', checked: false }, { id: 'waiting', text: 'waiting', hint: '2', checked: true }] },
  { id: 'from', word: 'from', raw: true, text: 'web-app', items: [{ id: 'all', text: 'All projects' }, { sep: true }, { id: 'web-app', text: 'web-app', checked: true }] },
  { word: 'by', id: 'by', chip: false, text: 'state', items: [{ id: 'day', text: 'date' }, { id: 'state', text: 'state', checked: true }] }];

test('filterRow on a page: one line of plain tabs with counts, More, and pickers with their label inside; `end` closes the line', () => {
  const f = dom(filterRow({ parts: PARTS(), open: 'from', end: '<button id="fig">Figures</button>' }));
  assert.ok(f.matches('span.fr:not(.is-fold)'));
  assert.equal(f.querySelector('.filter-l, .filter-field, .filter-tabs'), null, 'no label row, no boxed tab block');
  assert.deepEqual([...f.querySelectorAll('.fr-tabs > .fr-tab')].map((t) => [t.querySelector('.fr-tab-t').textContent, t.querySelector('.n').textContent, t.dataset.pick, t.getAttribute('aria-pressed')]), [['All', '62', 'show|all', 'false'], ['Needs you', '5', 'show|needs', 'false'], ['Running', '6', 'show|running', 'false']]);
  const [more, from, by] = f.querySelectorAll('.fr-pick');
  assert.equal(more.dataset.menu, 'show'); assert.equal(more.querySelector('.fr-pick-v').textContent, 'Waiting', 'More says the choice it holds'); assert.ok(more.classList.contains('is-on'));
  assert.equal(from.textContent, 'Project:web-app'); assert.equal(from.getAttribute('aria-label'), 'Project: web-app', 'a project keeps its own letters');
  assert.equal(by.textContent, 'Group by:State'); assert.equal(by.getAttribute('aria-expanded'), 'false');
  assert.deepEqual([...f.querySelectorAll('.pz-menu [data-pick]')].map((x) => [x.dataset.pick, x.querySelector('.mi-l').textContent]), [['from|all', 'All projects'], ['from|web-app', 'web-app']], 'one menu open, under its picker');
  assert.equal(f.querySelector('.fr-chip, .fr-more'), null, 'the pickers say their values: no chips, no More filters under five pickers');
  assert.ok([more, from, by].every((b) => /^--fr-w:\d+$/.test(b.getAttribute('style'))), 'each picker has its filter\'s width, never its value\'s');
  assert.equal(from.getAttribute('style'), dom(filterRow({ parts: PARTS().map((p) => (p.id === 'from' ? { ...p, text: 'All projects', items: p.items.map((it) => (it.sep ? it : { ...it, checked: it.id === 'all' })) } : p)) })).querySelectorAll('.fr-pick')[1].getAttribute('style'), 'a pick moves nothing');
  const phone = f.querySelector('.fr-filter.fr-phone > button'); assert.equal(phone.dataset.menu, 'filters', 'on a phone: the tabs and this one Filter control');
  // more than four pickers: the first four, the rest behind More filters
  const many = dom(filterRow({ parts: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id: `in-${id}`, label: id.toUpperCase(), text: 'x', items: [{ id: 'x', text: 'x', checked: true }, { id: 'y', text: 'y' }] })), open: 'in-more' }));
  assert.equal(many.querySelectorAll(':scope > .fr-pick-w').length, 4); assert.equal(many.querySelector('.fr-more > button').dataset.menu, 'in-more', 'the page\'s own menu prefix');
  assert.deepEqual([...many.querySelectorAll('.fr-more .menu-h')].map((x) => x.textContent), ['E', 'F']);
  // keep: a kept picker stays on the line when the others fold, and the folded Filter menu does not list it again
  const kept = dom(filterRow({ parts: [{ id: 'step', label: 'Step', keep: true, text: 'Build', items: [{ id: 'b', text: 'Build', checked: true }] }, { id: 'who', label: 'Agent', text: 'All', items: [{ id: 'all', text: 'All', checked: true }, { id: 'x', text: 'x' }] }], open: 'filters' }));
  assert.ok(kept.querySelector(':scope > .fr-pick-w.fr-keep > [data-menu="step"]')); assert.equal(kept.querySelectorAll(':scope > .fr-pick-w.fr-keep').length, 1);
  assert.deepEqual([...kept.querySelectorAll('.fr-phone .menu-h')].map((x) => x.textContent), ['Agent']);
  assert.ok(f.lastElementChild.matches('.fr-end') && f.querySelector('.fr-end > #fig'));
});

test('filterRow folded (a bar): tabs, a chip with ✕ for each filter off its default, one Filter control holding every part', () => {
  const f = dom(filterRow({ parts: PARTS(), fold: true, open: 'filters' }));
  assert.ok(f.matches('.fr.is-fold'));
  assert.equal(f.querySelectorAll('.fr-pick').length, 0, 'no picker on the line');
  const chips = [...f.querySelectorAll('.fr-chips > .fr-chip')];
  assert.deepEqual(chips.map((c) => [c.querySelector('.fr-chip-t').textContent, c.querySelector('.fr-chip-x').dataset.pick, c.querySelector('.fr-chip-x').getAttribute('aria-label')]),
    [['Waiting', 'show|all', 'Clear Show: Waiting'], ['web-app', 'from|all', 'Clear Project: web-app']], 'Group by arranges and is no chip; ✕ picks the default');
  const b = f.querySelector('.fr-filter > button[data-menu="filters"]');
  assert.equal(b.getAttribute('aria-expanded'), 'true'); assert.ok(b.classList.contains('is-on')); assert.equal(b.querySelector('.fr-filter-l').textContent, 'Filter');
  assert.deepEqual([...f.querySelectorAll('.fr-pop .menu-h')].map((x) => x.textContent), ['Show', 'Project', 'Group by'], 'a labelled group per part');
  assert.equal(f.querySelectorAll('.fr-pop [data-pick^="show|"]').length, 4, 'every view is in Filter, the tabs\' too');
  assert.equal(f.querySelector('.fr-pop [data-pick="by|day"] .mi-l').textContent, 'Date');
  assert.equal(b.querySelector('.fr-filter-n').textContent, '2', 'narrowed: the control says by how many, so a chip with no room can drop whole');
  // at its defaults: no chip, the control at rest; a third tab that is the view is said by its tab (the look keeps it)
  const rest = PARTS(); rest[0].items.forEach((it) => { it.checked = it.id === 'running'; }); rest[1].items.forEach((it) => { if (!it.sep) it.checked = it.id === 'all'; });
  const g = dom(filterRow({ parts: rest, fold: true }));
  assert.equal(g.querySelectorAll('.fr-chip').length, 0); assert.equal(g.querySelector('.fr-filter-n'), null);
  assert.equal(g.querySelector('.fr-pop'), null);
  rest[0].items.forEach((it) => { it.checked = it.id === 'all'; });
  const h = dom(filterRow({ parts: rest, fold: true }));
  assert.equal(h.querySelector('.fr-chip'), null); assert.ok(!h.querySelector('.fr-filter-b').classList.contains('is-on'));
});

test('listRow, list, groupRow: rows are list items in a named list', () => {
  const r = dom(listRow({ title: 'a', meta: 'web-app · Working', open: { 'data-open': 'a' }, current: true }));
  assert.equal(r.getAttribute('role'), 'listitem'); assert.equal(r.getAttribute('aria-current'), 'true');
  assert.equal(r.querySelector('.lr-m'), null, 'one line (list.one-line)'); assert.equal(r.querySelector('.lr-main').title, 'a\nweb-app · Working', 'its project and state are its tooltip');
  const l = dom(list({ groups: [{ title: 'Today', rows: [listRow({ title: 'a' })] }] }));
  assert.equal(l.querySelector('.list-rows').getAttribute('role'), 'list'); assert.equal(l.querySelector('.list-rows').getAttribute('aria-label'), 'Today');
  const g = dom(groupRow({ title: 'g', count: '1', noun: 'tasks', shown: true, toggle: {}, rows: listRow({ title: 'm' }) }));
  assert.equal(g.querySelector('.lr-members > .list-rows').getAttribute('role'), 'list');
  assert.equal(g.querySelector('.lr-members > .list-rows > .list-row').getAttribute('role'), 'listitem');
});

function listWorld({ narrowed = '' } = {}) {
  const w = new JSDOM('<body><div id="r"></div><p tabindex="0" id="page"></p></body>', { pretendToBeVisual: true }).window, d = w.document, root = d.getElementById('r');
  const log = [];
  const row = (k, extra = {}) => ({ key: k, title: k, meta: 'p · Working', menu: [{ id: 'stop', text: 'Stop' }], ...extra });
  const rows = [row('a', { tree: [row('a1')] }), row('b'), row('g', { members: [row('m')], open: true, count: '1', noun: 'tasks' })];
  const ctl = listController({ root, spec: { noun: `tasks`, name: 'Tasks', label: 'x', can: () => ['menu', 'fold'], bulk: () => [], act: () => {}, word: () => false, tool: (v) => log.push(`tool:${v}`), say: () => {}, active: () => true, open: (r) => log.push(`open:${r.key}`),
    view: () => ({ state: 'ready', parts: [], tools: [{ id: 'select', text: 'Select' }], narrowed, sections: [{ id: 'today', title: 'Today', rows }] }) } });
  ctl.paint();
  const press = (el, key) => { const e = new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; };
  return { w, d, root, log, ctl, press };
}

test('listController: the list has a role and a name; one Tab stop, and only that row\'s fold and ⋯ follow it', () => {
  const { root } = listWorld();
  const l = root.querySelector('.list');
  assert.equal(l.getAttribute('role'), 'region'); assert.equal(l.getAttribute('aria-label'), 'Tasks');
  const stops = () => [...root.querySelectorAll('.list-row button')].filter((b) => b.tabIndex === 0).map((b) => b.dataset.open || b.dataset.menu || (b.hasAttribute('data-fold-tree') ? 'fold-tree' : b.hasAttribute('data-fold') ? 'fold' : '?'));
  assert.deepEqual(stops().sort(), ['a', 'fold-tree', 'row:a'].sort(), 'the first row, its fold and its ⋯: nothing of any other row');
  root.querySelector('[data-open="g"]').focus();
  assert.deepEqual([...new Set(stops())].sort(), ['fold', 'g', 'row:g'].sort(), 'the stop follows the row you are on');
});

test('listController: the whole row is the target; the arrows stay where the focus is; Left and Right fold what is under a row', () => {
  const { d, root, log, press } = listWorld();
  root.querySelector('[data-row="b"] > .lr-rail').click();
  assert.deepEqual(log, ['open:b'], 'a click beside the title opens the row');
  root.querySelector('[data-row="a1"] > .lr-rail').click();
  assert.deepEqual(log, ['open:b', 'open:a1'], 'a row under a row opens itself, not its parent');
  root.querySelector('[data-row="b"] [data-menu]').click();
  assert.deepEqual(log, ['open:b', 'open:a1'], 'its ⋯ is its own control');
  d.dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const page = d.getElementById('page'); page.focus();
  assert.equal(press(page, 'ArrowDown'), false, 'from the page an arrow is the page\'s');
  assert.equal(d.activeElement, page, 'and the focus never moves into the list');
  const a = root.querySelector('[data-open="a"]'); a.focus();
  assert.equal(press(a, 'ArrowLeft'), true);
  assert.equal(root.querySelector('[data-row="a1"]'), null, 'ArrowLeft folds what hangs under the row');
  assert.equal(press(root.querySelector('[data-open="a"]'), 'ArrowRight'), true);
  assert.ok(root.querySelector('[data-row="a1"]'), 'ArrowRight shows it again');
});

test('listController: a visit narrowed by a link says so under the filters; Clear is the page\'s to answer', () => {
  const { root, log } = listWorld({ narrowed: 'web-app' });
  assert.equal(root.querySelector('.list-narrowed-t').textContent, 'Narrowed to web-app');
  root.querySelector('[data-narrow-clear]').click();
  assert.deepEqual(log, ['tool:clear-narrowed']);
  assert.equal(listWorld().root.querySelector('.list-narrowed'), null, 'no line while nothing narrows it');
});

test('search in the top bar is a combobox over a listbox: the arrows walk the results from the field, the active one is named', () => {
  const w = new JSDOM(`<body>${search({ label: 'Search or ask', bar: { kbd: 'K' } })}</body>`, { pretendToBeVisual: true }).window, d = w.document;
  const input = d.querySelector('[data-search]'), res = d.querySelector('[data-search-res]');
  assert.equal(input.getAttribute('role'), 'combobox'); assert.equal(input.getAttribute('aria-controls'), res.id);
  watchSearch(d);
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  res.innerHTML = searchResults([{ id: 'srch|0', text: 'a' }, { id: 'srch|1', text: 'b' }], 'Nothing matches', { tail: [{ id: 'none', text: 'off', off: true }] });
  assert.equal(res.querySelector('.menu').getAttribute('role'), 'listbox'); assert.equal(res.querySelectorAll('[role="option"][id]').length, 3);
  return new Promise((done) => setTimeout(() => {
    assert.equal(input.getAttribute('aria-expanded'), 'true');
    input.focus();
    const key = (k) => { const e = new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); input.dispatchEvent(e); return e; };
    const active = () => d.getElementById(input.getAttribute('aria-activedescendant'));
    assert.ok(key('ArrowDown').defaultPrevented); assert.equal(active().dataset.menuPick, 'srch|0'); assert.equal(d.activeElement, input, 'the focus stays in the field');
    key('ArrowDown'); assert.equal(active().dataset.menuPick, 'srch|1'); assert.equal(active().getAttribute('aria-selected'), 'true');
    key('ArrowDown'); assert.equal(active().dataset.menuPick, 'srch|0', 'it wraps, past the disabled one');
    key('ArrowUp'); assert.equal(active().dataset.menuPick, 'srch|1'); assert.ok(active().classList.contains('is-active'));
    res.innerHTML = '';
    setTimeout(() => { assert.equal(input.getAttribute('aria-expanded'), 'false'); done(); }, 0);
  }, 0));
});

test('classic\'s names are search words: each finds today\'s place once, from three letters', () => {
  const mod = { module: { exports: {} } };
  vm.runInNewContext(readFileSync(new URL('../ui/public/stillhet/shell/old-addresses.js', import.meta.url), 'utf8'), mod);
  const A = mod.module.exports;
  const one = (q) => Array.from(A.words(q), (x) => `${x.label} > ${x.hash || `${x.sset}${x.path ? ` / ${Array.from(x.path).join(' / ')}` : ''}`}`);
  assert.deepEqual(one('providers'), ['Sign-ins > models']); assert.equal(A.words('providers')[0].head, true, 'it lands on the Sign-ins head of Settings › Models');
  assert.deepEqual(one('Import Models'), ['Import > models / Catalogue / Sources / Import']);
  for (const q of ['appearance', 'text size', 'font size']) assert.deepEqual(one(q), ['Appearance > appearance'], q);
  assert.deepEqual(one('runs'), ['Tasks > runs']);
  assert.deepEqual(one('statistics'), ['Insights > insights']);
  assert.deepEqual(one('activity'), ['Pulse > activity']);
  assert.deepEqual(one('new run'), ['New task > ~new-task']);
  assert.deepEqual(one('ru'), [], 'two letters find nothing');
  assert.deepEqual(one(''), []);
  assert.match(A.words('providers')[0].where, /was Providers/);
  assert.equal(A.resolve('#activity').pulse, 'now', 'the old address it opens still lands on Pulse');
});
