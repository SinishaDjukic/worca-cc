// test/ui-design-grid.test.mjs — the designs under a new design's start (designs-grid.mjs): the newest nine as tiles,
// Show all designs and Show fewer in place, a search over every design by title and kind, and the C-5 frames moving a
// tile in place or loading the list again. Plain DOM in jsdom, with a fake fetch and a fake clock; nothing here reaches
// a server.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { fakeClock } from './helpers/design-clock.mjs';
import { cssRules } from './helpers/css-rules.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { COLLAPSED, filterDesigns, shownDesigns, createDesignsGrid } from '../ui/public/design/designs-grid.mjs';
import { KIND_ICONS } from '../ui/public/design/library.mjs';

const trackDom = useDomRelease(afterEach);
const made = [];
afterEach(() => { while (made.length) made.pop().destroy(); });

const flush = () => new Promise((resolve) => setImmediate(resolve));

function reply(status, body) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text };
}

const NOW = new Date(2026, 10, 5, 14, 0).getTime();   // Thursday
const at = (...a) => new Date(2026, ...a).toISOString();
const ROWS = [{ id: 'd_000000000001', title: 'Apsida landing page', kind: 'web', status: 'done', updatedAt: at(10, 5, 12, 0), costUsd: 4.2, costKnown: true, thumb: '/api/design/d_000000000001/thumb?v=1' },
  { id: 'd_000000000002', title: 'Seed deck', kind: 'pitch', status: 'building', updatedAt: at(10, 5, 13, 0), costUsd: 0, costKnown: true, thumb: null }];

// rig({rows, all}) -> {grid, host, win, doc, clock, tick, gets, navs, alls, scrolls, setRows, hold, find, tiles, more, foot, type}
// jsdom body: <div id="h"></div>. win.setTimeout / clearTimeout are fakeClock's set / clear.
// win.Element.prototype.scrollIntoView counts its calls: scrolls().
// fetch: GET /api/design answers `rows` (null: a 500) and counts in gets(); setRows(next) swaps the answer.
// hold() keeps the next GET until the returned release runs; that GET answers what was set when it was asked.
// grid = createDesignsGrid({doc, win, fetch, navigate: (h) => navs.push(h), now: () => NOW, all, onAll: (on) => alls.push(on)});
// host.append(grid.el); made.push(grid).
// find = () => host.querySelector('input.dz-find'); tiles = () => [...host.querySelectorAll('a.dz-tile')];
// more = () => host.querySelector('[data-dz-show-all]'); foot = () => host.querySelector('.dz-lib-foot');
// type = (text) => { find().value = text; find().dispatchEvent(new win.Event('input', { bubbles: true })); };
// tick = async () => { clock.tick(250); await flush(); };
function rig({ rows = [], all = false } = {}) {
  const clock = fakeClock();
  const dom = trackDom(new JSDOM('<!doctype html><html><body><div id="h"></div></body></html>', { url: 'http://localhost/' }));
  const win = dom.window;
  const doc = win.document;
  Object.assign(win, { setTimeout: clock.set, clearTimeout: clock.clear });
  let scrolled = 0;
  win.Element.prototype.scrollIntoView = function () { scrolled += 1; };
  const host = doc.getElementById('h');
  let answer = rows;
  let listed = 0;
  let holding = null;   // the promise the next GET waits for
  const navs = [];
  const alls = [];
  async function fetch(url, init = {}) {
    const method = String(init.method ?? 'GET').toUpperCase();
    if (method === 'GET' && url === '/api/design') {
      listed += 1;
      const res = answer === null ? reply(500, { error: 'boom' }) : reply(200, answer);
      const held = holding;
      holding = null;
      if (held) await held;
      return res;
    }
    return reply(404, { error: 'not found' });
  }
  const hold = () => {
    let release;
    holding = new Promise((resolve) => { release = resolve; });
    return () => release();
  };
  const grid = createDesignsGrid({ doc, win, fetch, navigate: (h) => navs.push(h), now: () => NOW, all, onAll: (on) => alls.push(on) });
  host.append(grid.el);
  made.push(grid);
  const find = () => host.querySelector('input.dz-find');
  const tiles = () => [...host.querySelectorAll('a.dz-tile')];
  const more = () => host.querySelector('[data-dz-show-all]');
  const foot = () => host.querySelector('.dz-lib-foot');
  const type = (text) => { find().value = text; find().dispatchEvent(new win.Event('input', { bubbles: true })); };
  const tick = async () => { clock.tick(250); await flush(); };
  return { grid, host, win, doc, clock, tick, gets: () => listed, navs, alls, scrolls: () => scrolled,
    setRows: (next) => { answer = next; }, hold, find, tiles, more, foot, type };
}
const many = (n) => Array.from({ length: n }, (_, i) => ({ id: `d_${String(i + 1).padStart(12, '0')}`, title: `Design ${i + 1}`,
  kind: i % 2 ? 'pitch' : 'web', status: 'done', updatedAt: at(10, 5, 12, 0), costUsd: 0, costKnown: true, thumb: null }));
const titles = (list) => list.map((t) => t.querySelector('.dz-tile-t').textContent);

test('filterDesigns: every word, in the title or the kind, any case; a blank query keeps all', () => {
  const rows = [{ id: 'a', title: 'Apsida landing page', kind: 'web' }, { id: 'b', title: 'Seed deck', kind: 'pitch' }, { id: 'c', title: '', kind: 'nope' }];
  const ids = (q) => filterDesigns(rows, q).map((r) => r.id);
  assert.deepEqual(ids(''), ['a', 'b', 'c']);
  assert.deepEqual(ids('   '), ['a', 'b', 'c']);
  assert.deepEqual(ids('APSIDA'), ['a']);
  assert.deepEqual(ids('pitch'), ['b'], 'the kind as people read it: Pitch deck');
  assert.deepEqual(ids('web page landing'), ['a'], 'every word must be there');
  assert.deepEqual(ids('seed  deck '), ['b']);
  assert.deepEqual(ids('untitled'), ['c'], 'a design with no title is Untitled design');
  assert.deepEqual(ids('.*'), [], 'plain text, never a pattern');
  assert.deepEqual(ids('('), [], 'and never a throw');
});
test('shownDesigns: the newest nine, every design on request, every match while searching', () => {
  const rows = many(12);
  const of = (r, o) => { const s = shownDesigns(r, o); return [s.list.length, s.more]; };
  assert.equal(COLLAPSED, 9);
  assert.deepEqual(of(rows, {}), [9, 'all']);
  assert.deepEqual(of(rows, { all: true }), [12, 'fewer']);
  assert.deepEqual(of(many(9), {}), [9, 'none']);
  assert.deepEqual(of(many(9), { all: true }), [9, 'none']);
  assert.deepEqual(of(many(10), {}), [9, 'all']);
  assert.deepEqual(of(rows, { query: 'design 1' }), [4, 'none'], 'Design 1, 10, 11 and 12: past the nine too');
  assert.deepEqual(of(rows, { query: 'design 1', all: true }), [4, 'none']);
});
test('nine tiles, then Show all designs; a click shows every design and reads Show fewer; onAll hears each', async () => {
  const { grid, host, tiles, more, foot, alls, scrolls, tick } = rig({ rows: many(12) }); await grid.open(); await tick();
  assert.deepEqual(titles(tiles()).slice(0, 2), ['Design 1', 'Design 2'], 'the order the server sends: newest first');
  assert.equal(tiles().length, 9);
  assert.deepEqual([more().textContent, more().getAttribute('aria-expanded'), more().className, foot().hidden], ['Show all designs', 'false', 'btn btn-sm', false]);
  assert.equal(more().getAttribute('aria-controls'), host.querySelector('.dz-grid').id);
  assert.equal(foot().previousElementSibling.className, 'dz-grid', 'the button sits under the tiles');
  more().click();
  assert.deepEqual([tiles().length, more().textContent, more().getAttribute('aria-expanded'), scrolls()], [12, 'Show fewer', 'true', 0]);
  more().click();
  assert.deepEqual([tiles().length, more().textContent, scrolls()], [9, 'Show all designs', 1], 'Show fewer keeps the button in view');
  assert.deepEqual(alls, [true, false]);
});
test('nine designs or fewer: no button; ten: the button; none: no heading, no search, no prose', async () => {
  for (const [n, noButton] of [[0, true], [1, true], [9, true], [10, false]]) {
    const r = rig({ rows: many(n) }); await r.grid.open(); await r.tick();
    assert.equal(r.foot().hidden, noButton, String(n));
    assert.equal(r.host.querySelector('.dz-lib-body').hidden, n === 0, String(n));
  }
});
test('all: true starts with every design shown', async () => {
  const { grid, tiles, more, alls, tick } = rig({ rows: many(12), all: true }); await grid.open(); await tick();
  assert.deepEqual([tiles().length, more().textContent, alls], [12, 'Show fewer', []]);
});
test('search looks through every design, not the nine; the button hides; no match says so in plain text; Escape clears', async () => {
  const { grid, host, doc, tiles, foot, type, find, win, tick } = rig({ rows: many(12) }); await grid.open(); await tick();
  assert.deepEqual([find().type, find().placeholder, find().getAttribute('aria-label'), find().className], ['search', 'Search designs', 'Search designs', 'input dz-find']);
  assert.equal(host.querySelector('.dz-lib-head > h2.dz-lib-h + input.dz-find').previousElementSibling.textContent, 'Designs');
  type('DESIGN 12');
  assert.deepEqual([titles(tiles()), foot().hidden], [['Design 12'], true]);
  type('  zzz  ');
  assert.equal(host.querySelector('.dz-find-none').textContent, 'No designs match “zzz”.', 'the query as trimmed');
  type('<img src=x onerror=alert(1)>');
  const none = host.querySelector('.dz-find-none');
  assert.deepEqual([tiles().length, none.tagName, none.textContent, none.querySelector('img')], [0, 'P', 'No designs match “<img src=x onerror=alert(1)>”.', null]);
  assert.equal(none.previousElementSibling.className, 'dz-grid');
  assert.equal(host.querySelector('.dz-lib-body').hidden, false, 'the search stays, to be changed');
  // Something before the search took the Escape (ask-panel's composer popover, an open flyout): one Escape closes one thing.
  const taken = (e) => { if (e.key === 'Escape') e.preventDefault(); };
  doc.addEventListener('keydown', taken, true);
  find().dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.deepEqual([find().value, tiles().length], ['<img src=x onerror=alert(1)>', 0], 'an Escape already taken leaves the search');
  doc.removeEventListener('keydown', taken, true);
  // The IME owns an Escape while it composes, and WebKit's committing keydown (keyCode 229): the search stays.
  for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
    const ime = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });
    find().dispatchEvent(ime);
    assert.deepEqual([ime.defaultPrevented, find().value], [false, '<img src=x onerror=alert(1)>'], JSON.stringify(init));
  }
  const esc =new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  find().dispatchEvent(esc);
  assert.deepEqual([esc.defaultPrevented, find().value, tiles().length, host.querySelector('.dz-find-none'), foot().hidden], [true, '', 9, null, false]);
  const idle = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  find().dispatchEvent(idle);
  assert.equal(idle.defaultPrevented, false, 'an empty search leaves Escape to the page');
});
test('a frame for a design that is not on screen is kept: it shows once the design does', async () => {
  const { grid, tiles, more, type, tick } = rig({ rows: many(12) }); await grid.open(); await tick();
  const last = many(12)[11].id;
  grid.pushFrame({ type: 'design-build', designId: last, status: 'paused', stats: {} });
  grid.pushFrame({ type: 'design-thumb', designId: last, thumb: '/t?v=4' });
  more().click();
  assert.equal(tiles()[11].querySelector('.dz-tile-m').textContent, 'Pitch deck · Paused');
  assert.equal(tiles()[11].querySelector('.dz-thumb img').getAttribute('src'), '/t?v=4');
  more().click(); type('design 12');
  assert.equal(tiles()[0].querySelector('.dz-tile-m').textContent, 'Pitch deck · Paused');
});
test('the list comes again while expanded and searching: what is shown, the query and the focus stay; an equal list repaints nothing', async () => {
  const r = rig({ rows: many(12) }); await r.grid.open(); await r.tick();
  r.more().click(); r.find().focus(); r.type('design 1');
  const before = r.tiles();
  r.grid.pushFrame({ type: 'design-build', designId: many(12)[0].id, status: 'done', stats: {} }); await r.tick();
  assert.ok(r.tiles().every((t, i) => t === before[i]), 'the same rows again: the same tiles');
  r.setRows(many(13));
  r.grid.pushFrame({ type: 'design-restored', designId: many(12)[0].id }); await r.tick();
  assert.deepEqual(titles(r.tiles()), ['Design 1', 'Design 10', 'Design 11', 'Design 12', 'Design 13']);
  assert.deepEqual([r.find().value, r.doc.activeElement === r.find()], ['design 1', true]);
  r.type('');
  assert.deepEqual([r.tiles().length, r.more().textContent], [13, 'Show fewer'], 'still expanded');
});
test('expanded, then the list shrinks to nine: every design and no button; ten again is still every design', async () => {
  const r = rig({ rows: many(12) }); await r.grid.open(); await r.tick();
  r.more().click();
  r.setRows(many(9)); await r.grid.open(); await r.tick();
  assert.deepEqual([r.tiles().length, r.foot().hidden], [9, true]);
  r.setRows(many(10)); await r.grid.open(); await r.tick();
  assert.deepEqual([r.tiles().length, r.more().textContent, r.foot().hidden], [10, 'Show fewer', false]);
});
test('the designs block: at most three columns, the search beside the heading, the button centred under the tiles', () => {
  const rules = cssRules(readStyleCss()).filter((r) => !r.media);
  const body = (sel) => rules.filter((r) => r.sel === sel).map((r) => r.body).join(';');
  assert.match(body('.dz-designs'), /max-width:1040px/);
  assert.match(body('.dz-designs .dz-grid'), /grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,max\(260px,calc\(\(100% - 40px\)\/3\)\)\),1fr\)\)/);
  assert.match(body('.dz-lib-head'), /display:flex/);
  assert.match(body('.dz-lib-head'), /justify-content:space-between/);
  assert.match(body('.dz-lib-foot'), /justify-content:center/);
  assert.match(body('.dz-lib-foot[hidden]'), /display:none/);
});

// Ported from test/ui-design-library.test.mjs (the Library's grid): the same tiles, list, loading, failure and frames.
test('the grid is just the items', async () => {
  const { grid, host, tick } = rig({ rows: ROWS }); await grid.open(); await tick();
  assert.equal(host.querySelector('.dz-lib-h').textContent, 'Designs');
  const tiles = [...host.querySelectorAll('a.dz-tile')];
  assert.deepEqual(tiles.map((t) => t.getAttribute('href')), ['#design/d_000000000001', '#design/d_000000000002']);
  assert.equal(tiles[0].querySelector('.dz-tile-t').textContent, 'Apsida landing page');
  assert.equal(tiles[0].querySelector('.dz-thumb img').getAttribute('src'), ROWS[0].thumb);
  assert.equal(tiles[0].querySelector('.dz-thumb img').getAttribute('alt'), '');
  assert.ok(tiles[1].querySelector('.dz-thumb .dz-thumb-none svg'), 'no picture: the kind icon');
  assert.equal(host.querySelectorAll('.dz-grid > *').length, 2, 'no stacked result cards');
});
test('the markup is the mockup\'s: the body; tile parts in order; meta from tileMeta', async () => {
  const { grid, host, tick } = rig({ rows: ROWS }); await grid.open(); await tick();
  assert.ok(host.querySelector('div.dz-designs > .dz-lib-body > .dz-lib-head + .dz-grid > a.dz-tile'));
  const t = host.querySelector('a.dz-tile');
  assert.deepEqual([...t.children].map((c) => `${c.tagName} ${c.className}`), ['SPAN dz-thumb', 'SPAN dz-tile-t', 'SPAN dz-tile-m']);
  assert.equal(t.querySelector('.dz-tile-m').textContent, 'Web page · 2h ago · $4.20');
  assert.equal(t.querySelector('.dz-thumb img').getAttribute('loading'), 'lazy');
  assert.equal(host.querySelector('.dz-lib-body').hidden, false);
  assert.equal(host.querySelector('.dz-lib-load'), null);
  assert.equal(host.querySelector('.dz-lib-err'), null);
});
test('no designs: no heading, no prose', async () => {
  const { grid, host, tick } = rig({ rows: [] }); await grid.open(); await tick();
  assert.equal(host.querySelector('.dz-lib-body').hidden, true);
  assert.equal(host.querySelector('.dz-designs').textContent.replace(/\s+/g, ' ').includes('No designs'), false);
});
test('a tile click navigates; a failed load says so and Try again refetches', async () => {
  const { grid, host, tick, navs, win } = rig({ rows: ROWS }); await grid.open(); await tick();
  host.querySelector('a.dz-tile').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(navs, ['#design/d_000000000001']);
  const bad = rig({ rows: null }); await bad.grid.open(); await bad.tick();   // rows:null = GET /api/design answers 500
  assert.equal(bad.host.querySelector('.dz-lib-err').textContent.startsWith('Could not load designs'), true);
  const n = bad.gets(); [...bad.host.querySelectorAll('.dz-lib-err button')].find((b) => b.textContent === 'Try again').click(); await bad.tick();
  assert.equal(bad.gets(), n + 1);
});
test('a tile click: no modifier is the page\'s own route; a modifier or another button keeps the browser\'s', async () => {
  const { grid, host, tick, navs, win } = rig({ rows: ROWS }); await grid.open(); await tick();
  const t = host.querySelector('a.dz-tile');
  for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const e = new win.MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    t.dispatchEvent(e);
    assert.equal(e.defaultPrevented, false, JSON.stringify(init));
  }
  assert.deepEqual(navs, []);
  const plain = new win.MouseEvent('click', { bubbles: true, cancelable: true });
  t.dispatchEvent(plain);
  assert.equal(plain.defaultPrevented, true);
  assert.deepEqual(navs, ['#design/d_000000000001']);
});
test('a failure: the error sits outside the hidden body; a later answer clears it', async () => {
  const r = rig({ rows: null }); await r.grid.open(); await r.tick();
  const err = r.host.querySelector('.dz-lib-err');
  assert.equal(err.tagName, 'P');
  assert.equal(err.parentElement, r.host.querySelector('.dz-designs'));
  assert.equal(r.host.querySelector('.dz-lib-body').contains(err), false);
  assert.equal(r.host.querySelectorAll('a.dz-tile').length, 0);
  await r.grid.open(); await r.tick();
  assert.equal(r.host.querySelectorAll('.dz-lib-err').length, 1, 'one failure line, not two');
  // A list that comes in time (no loading line first) clears the failure itself.
  r.setRows(ROWS); await r.grid.open();
  assert.equal(r.host.querySelector('.dz-lib-err'), null, 'the answer clears the failure');
  assert.deepEqual(titles(r.tiles()), ['Apsida landing page', 'Seed deck']);
  assert.equal(r.clock.pending(), 0);
});
test('an older answer paints nothing: a failure or a list that lands after a newer list leaves the newer list', async () => {
  const r = rig({ rows: ROWS }); await r.grid.open(); await r.tick();
  // A hello's load fails as the server restarts, and lands after a round end's newer list.
  r.setRows(null);
  const late = r.hold();
  const older = r.grid.open();
  r.setRows([ROWS[0]]);
  await r.grid.open();
  late(); await older; await r.tick();
  assert.deepEqual(titles(r.tiles()), ['Apsida landing page'], 'an older failure does not paint over the newer list');
  assert.equal(r.host.querySelector('.dz-lib-err'), null);
  // An older list lands after a newer one: the newer one stays.
  r.setRows(ROWS);
  const late2 = r.hold();
  const older2 = r.grid.open();
  r.setRows(many(3));
  await r.grid.open();
  late2(); await older2; await r.tick();
  assert.deepEqual(titles(r.tiles()), ['Design 1', 'Design 2', 'Design 3'], 'an older list does not paint over the newer one');
  assert.deepEqual([r.host.querySelector('.dz-lib-load'), r.clock.pending()], [null, 0]);
});
test('loading: nothing for 300 ms, then one busy line after the body; the answer removes it', async () => {
  const { host, win, clock, doc } = rig({ rows: ROWS });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const grid = createDesignsGrid({
    doc, win, now: () => NOW, navigate() {},
    fetch: async () => { await held; return reply(200, ROWS); },
  });
  doc.body.append(grid.el);
  made.push(grid);
  const shown = grid.open();
  clock.tick(299);
  assert.equal(doc.body.querySelector('.dz-lib-load'), null, 'nothing for 300 ms');
  clock.tick(1);
  const load = doc.body.querySelector('.dz-lib-load');
  assert.deepEqual([load.tagName, load.textContent, load.getAttribute('aria-busy')], ['P', 'Loading designs…', 'true']);
  assert.equal(load.previousElementSibling.className, 'dz-lib-body');
  clock.tick(1000);
  assert.equal(doc.body.querySelectorAll('.dz-lib-load').length, 1, 'one line');
  release(); await shown;
  assert.equal(doc.body.querySelector('.dz-lib-load'), null);
  assert.equal(clock.pending(), 0);
  assert.ok(host);
});
test('hostile title and a broken image', async () => {
  const { grid, host, tick, win } = rig({ rows: [{ ...ROWS[0], title: '<img src=x onerror=alert(1)>' }] }); await grid.open(); await tick();
  const t = host.querySelector('a.dz-tile');
  assert.equal(t.querySelector('.dz-tile-t img'), null);
  assert.equal(t.querySelector('.dz-tile-t').textContent, '<img src=x onerror=alert(1)>');
  t.querySelector('.dz-thumb img').dispatchEvent(new win.Event('error'));
  assert.ok(t.querySelector('.dz-thumb .dz-thumb-none svg'));
  assert.equal(t.querySelector('.dz-thumb img'), null);
});
test('a new picture from a frame: the old one\'s late error leaves it', async () => {
  const { grid, host, tick, win } = rig({ rows: ROWS }); await grid.open(); await tick();
  const t = host.querySelector('a.dz-tile');
  const old = t.querySelector('.dz-thumb img');
  grid.pushFrame({ type: 'design-thumb', designId: ROWS[0].id, thumb: '/t?v=9' });
  old.dispatchEvent(new win.Event('error'));
  assert.equal(t.querySelector('.dz-thumb img').getAttribute('src'), '/t?v=9');
  grid.pushFrame({ type: 'design-thumb', designId: ROWS[0].id, thumb: 7 });
  assert.equal(t.querySelector('.dz-thumb img').getAttribute('src'), '/t?v=9', 'a thumb that is not a string or null changes nothing');
  grid.pushFrame({ type: 'design-thumb', designId: ROWS[0].id, thumb: null });
  assert.ok(t.querySelector('.dz-thumb .dz-thumb-none svg'), 'a frame with no picture shows the icon');
});
test('frames: status and thumb in place; an end or a restore refetches once; deltas do nothing', async () => {
  const { grid, host, tick, gets } = rig({ rows: ROWS }); await grid.open(); await tick();
  const n = gets(); const tile = host.querySelectorAll('a.dz-tile')[1];
  grid.pushFrame({ type: 'design-delta', designId: ROWS[1].id }); assert.equal(gets(), n);
  grid.pushFrame({ type: 'design-build', designId: ROWS[1].id, status: 'paused', stats: {} }); await tick();
  assert.ok(host.querySelectorAll('a.dz-tile')[1].querySelector('.dz-tile-m').textContent.includes('Paused'));
  grid.pushFrame({ type: 'design-thumb', designId: ROWS[1].id, thumb: '/t?v=2' }); await tick();
  assert.equal(host.querySelectorAll('a.dz-tile')[1].querySelector('img').getAttribute('src'), '/t?v=2');
  grid.pushFrame({ type: 'design-build', designId: ROWS[1].id, status: 'done', stats: {} });
  grid.pushFrame({ type: 'design-restored', designId: ROWS[1].id }); await tick();
  assert.equal(gets(), n + 1); assert.ok(tile);
});
test('frames: in place means the same tile; a live status refetches nothing; each end kind refetches; an unchanged list keeps its tiles', async () => {
  const { grid, host, tick, gets, clock } = rig({ rows: ROWS }); await grid.open(); await tick();
  const n = gets();
  const tile = host.querySelectorAll('a.dz-tile')[1];
  grid.pushFrame({ type: 'design-build', designId: ROWS[1].id, status: 'integrating', stats: {} });
  assert.equal(clock.pending(), 0, 'a live status schedules nothing');
  assert.equal(host.querySelectorAll('a.dz-tile')[1], tile, 'the same tile, updated in place');
  assert.equal(tile.querySelector('.dz-tile-m').textContent, 'Pitch deck · Building');
  grid.pushFrame({ type: 'design-thumb', designId: ROWS[1].id, thumb: '/t?v=3' });
  assert.equal(host.querySelectorAll('a.dz-tile')[1], tile);
  grid.pushFrame({ type: 'design-thumb', designId: 'd_00000000ffff', thumb: '/x' });
  grid.pushFrame({ type: 'design-section', designId: ROWS[1].id });
  grid.pushFrame(null);
  assert.equal(clock.pending(), 0, 'other frames schedule nothing');
  await tick();
  assert.equal(gets(), n);
  for (const status of ['done', 'stopped', 'error', 'interrupted']) {
    const before = gets();
    grid.pushFrame({ type: 'design-build', designId: ROWS[0].id, status, stats: {} });
    clock.tick(199); await flush();
    assert.equal(gets(), before, `${status}: one 200 ms timer`);
    clock.tick(1); await flush();
    assert.equal(gets(), before + 1, status);
  }
  const second = host.querySelectorAll('a.dz-tile')[1];
  assert.equal(second.querySelector('.dz-tile-m').textContent, 'Pitch deck · Building', 'the answer replaces what the frames changed');
  assert.ok(second.querySelector('.dz-thumb-none svg'));
  const first = host.querySelector('a.dz-tile');
  grid.pushFrame({ type: 'design-restored', designId: ROWS[0].id }); await tick();
  assert.equal(host.querySelector('a.dz-tile'), first, 'the same rows again: no repaint');
});
test('a list holding one id twice: a frame still changes a tile', async () => {
  const { grid, host, tick } = rig({ rows: [ROWS[1], { ...ROWS[1], title: 'Seed deck copy' }] }); await grid.open(); await tick();
  grid.pushFrame({ type: 'design-build', designId: ROWS[1].id, status: 'paused', stats: {} });
  grid.pushFrame({ type: 'design-thumb', designId: ROWS[1].id, thumb: '/t?v=5' });
  const drawn = host.querySelectorAll('a.dz-tile')[1];
  assert.equal(drawn.querySelector('.dz-tile-m').textContent, 'Pitch deck · Paused');
  assert.equal(drawn.querySelector('.dz-thumb img').getAttribute('src'), '/t?v=5');
});
test('destroy: the designs go, their timers with them, and frames after it do nothing', async () => {
  const { grid, host, tick, gets, clock } = rig({ rows: ROWS }); await grid.open(); await tick();
  grid.pushFrame({ type: 'design-restored', designId: ROWS[0].id });
  assert.equal(clock.pending(), 1);
  const n = gets();
  made.splice(made.indexOf(grid), 1);
  grid.destroy();
  assert.equal(clock.pending(), 0);
  assert.equal(host.querySelector('.dz-designs'), null);
  grid.pushFrame({ type: 'design-restored', designId: ROWS[0].id });
  await grid.open();
  await tick();
  assert.deepEqual([gets(), clock.pending()], [n, 0], 'open() after destroy loads nothing');
});
test('a document tile with no picture shows the document icon', async () => {
  const rows = [{ id: 'd_00000000000e', title: 'Q3 review', kind: 'document', status: 'done', updatedAt: at(10, 5, 12, 0), costUsd: 1, costKnown: true, thumb: null },
    { id: 'd_00000000000f', title: 'Site', kind: 'web', status: 'done', updatedAt: at(10, 5, 12, 0), costUsd: 1, costKnown: true, thumb: null }];
  const { grid, host, doc, tick } = rig({ rows }); await grid.open(); await tick();
  const [icon, web] = [...host.querySelectorAll('a.dz-tile .dz-thumb-none')].map((n) => n.innerHTML);
  assert.ok(icon.includes('<svg'));
  assert.notEqual(icon, web, 'its own icon, not the web page\'s');
  const ref = doc.createElement('span');
  ref.innerHTML = KIND_ICONS.document;
  assert.equal(icon, ref.innerHTML);
});
