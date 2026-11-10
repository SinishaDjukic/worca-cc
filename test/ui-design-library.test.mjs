// test/ui-design-library.test.mjs — Design P6 Tasks 8 and 9: the Library on `#design` (the grid of tiles, then the
// start composer above it) and the chat head's More (Rename, Delete). Plain DOM in jsdom, with a fake fetch and a
// fake clock; nothing here reaches a server.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { fakeClock } from './helpers/design-clock.mjs';
import { checkRows } from './helpers/rows.mjs';
import { cssRules } from './helpers/css-rules.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { tileTime, tileMeta, createLibrary, designMoreMenu, kindWord, titleFromBrief, takeStart } from '../ui/public/design/library.mjs';

const trackDom = useDomRelease(afterEach);
const made = [];
afterEach(() => { while (made.length) made.pop().destroy(); });

const flush = () => new Promise((resolve) => setImmediate(resolve));

function reply(status, body) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text };
}

// rig({rows, projects, created, createStatus, createError}) (one rig for Tasks 8 and 9) -> {lib, host, win, tick, gets, posts, navs, setText, keydown, pick, addFiles}.
// It uses a fake fetch over GET/POST /api/design and GET /api/projects, records navigate() calls in navs, and gets() counts GET /api/design.
// Timers run on fakeClock() (test/helpers/design-clock.mjs:21): win.setTimeout = clock.set, win.clearTimeout = clock.clear, as ui-design-view's rig.
// tick = async () => { clock.tick(250); await flush(); }, so the 200 ms refetch timer fires inside one tick.
// rows: null makes GET /api/design answer 500, and projects: null GET /api/projects. `created` is the 201 body of POST
// /api/design; `createError` makes it answer `createStatus` (400 by default) with that error instead.
function rig({ rows = [], projects = [], created = null, createStatus, createError } = {}) {
  const clock = fakeClock();
  const dom = trackDom(new JSDOM(`<!doctype html><html><body>
    <main class="main"><section class="view" data-view="design"><div id="design-host"></div></section></main>
  </body></html>`, { url: 'http://localhost/' }));
  const win = dom.window;
  const doc = win.document;
  Object.assign(win, { setTimeout: clock.set, clearTimeout: clock.clear });
  const host = doc.getElementById('design-host');
  let listed = 0;
  const posts = [];
  const navs = [];
  async function fetch(url, init = {}) {
    const method = String(init.method ?? 'GET').toUpperCase();
    if (method === 'POST') {
      const body = JSON.parse(init.body ?? '{}');
      posts.push({ url, body });
      if (url === '/api/design') {
        if (createError) return reply(createStatus ?? 400, { error: createError });
        return reply(createStatus ?? 201, created ?? { design: { id: 'd_0000000000ff' }, threadId: null });
      }
      return reply(404, { error: 'not found' });
    }
    if (url === '/api/design') {
      listed += 1;
      return rows === null ? reply(500, { error: 'boom' }) : reply(200, rows);
    }
    if (url === '/api/projects') return projects === null ? reply(500, { error: 'boom' }) : reply(200, { projects });
    return reply(404, { error: 'not found' });
  }
  const lib = createLibrary({ doc, win, host, fetch, navigate: (hash) => { navs.push(hash); }, now: () => NOW });
  made.push(lib);
  const input = () => host.querySelector('textarea.dz-input');
  const setText = (text) => {
    input().value = text;
    input().dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const keydown = (key, opts = {}) => {
    input().dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
  };
  // Opens the composer's project menu and picks the row named `name`.
  const pick = async (name) => {
    host.querySelector('.ask-scope-btn').click();
    await flush();
    [...doc.querySelectorAll('[role^="menuitem"]')].find((b) => b.textContent.trim() === name).click();
    await flush();
  };
  // Hands `files` to the composer's file input, as a person choosing them would.
  const addFiles = async (files) => {
    const el = host.querySelector('input[type="file"]');
    Object.defineProperty(el, 'files', { configurable: true, value: files });
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    for (let i = 0; i < 5; i += 1) await flush();
  };
  const tick = async () => { clock.tick(250); await flush(); };
  return { lib, host, win, doc, clock, tick, gets: () => listed, posts, navs, setText, keydown, pick, addFiles };
}

const DESIGN = { id: 'd_000000000001', title: 'Apsida landing page', kind: 'web', status: 'done' };

// rigMore({live}) -> {more, doc, button, calls, confirms, navs, tick}: prompt resolves {title:'New name'}, and confirm records its options and resolves true.
// calls records {method, url}, plus body only when the request has one.
// `answers` replaces what confirm and prompt resolve, one per call in order; `deleteAnswers` and `patchAnswers` are the
// [status, body] replies of DELETE and PATCH, one per call, then 200.
function rigMore({ live = false, answers = null, prompts: promptAnswers = null, deleteAnswers = [], patchAnswers = [] } = {}) {
  const dom = trackDom(new JSDOM('<!doctype html><html><body><div class="chat-head"></div></body></html>', { url: 'http://localhost/' }));
  const win = dom.window;
  const doc = win.document;
  const button = doc.createElement('button');
  button.type = 'button';
  doc.querySelector('.chat-head').append(button);
  const calls = [];
  const confirms = [];
  const prompted = [];
  const navs = [];
  const renamed = [];
  async function fetch(url, init = {}) {
    const method = String(init.method ?? 'GET').toUpperCase();
    calls.push({ method, url, ...(init.body != null ? { body: JSON.parse(init.body) } : {}) });
    if (method === 'PATCH') {
      const next = patchAnswers.shift();
      return next ? reply(...next) : reply(200, { ...DESIGN, ...JSON.parse(init.body) });
    }
    if (method === 'DELETE') {
      const next = deleteAnswers.shift();
      return next ? reply(...next) : reply(200, { ok: true });
    }
    return reply(404, { error: 'not found' });
  }
  const more = designMoreMenu({
    doc, win, button, getDesign: () => DESIGN, fetch,
    confirm: (o) => { confirms.push(o); return Promise.resolve(answers ? answers.shift() : true); },
    prompt: (o) => { prompted.push(o); return Promise.resolve(promptAnswers ? promptAnswers.shift() : { title: 'New name' }); },
    navigate: (hash) => { navs.push(hash); },
    buildLive: () => live,
    onRenamed: (row) => { renamed.push(row); },
  });
  made.push(more);
  const items = () => [...doc.querySelectorAll('.menu .menu-item')];
  return { more, doc, win, button, calls, confirms, prompted, navs, renamed, items, tick: flush };
}

const NOW = new Date(2026, 10, 5, 14, 0).getTime();   // Thursday
const at = (...a) => new Date(2026, ...a).toISOString();
test('tileTime reads as the mockup', () => {
  assert.equal(tileTime(new Date(NOW - 20_000).toISOString(), NOW), 'Just now');
  assert.equal(tileTime(new Date(NOW - 12 * 60_000).toISOString(), NOW), '12m ago');
  assert.equal(tileTime(new Date(NOW - 2 * 3600_000).toISOString(), NOW), '2h ago');
  assert.equal(tileTime(at(10, 4, 23, 0), NOW), 'Yesterday');
  assert.equal(tileTime(at(10, 2, 9, 0), NOW), 'Monday');
  assert.equal(tileTime(at(9, 30, 9, 0), NOW), 'Oct 30');
  assert.equal(tileTime(new Date(2025, 9, 30).toISOString(), NOW), 'Oct 30, 2025');
});
test('tileTime: the edges of each step, and a time that is not one', async () => {
  await checkRows([
    [new Date(NOW - 59_999).toISOString(), 'Just now'],
    [new Date(NOW - 60_000).toISOString(), '1m ago'],
    [new Date(NOW - 3_599_999).toISOString(), '59m ago'],
    [new Date(NOW - 3_600_000).toISOString(), '1h ago'],
    [at(10, 5, 0, 0), '14h ago'],
    [at(10, 4, 0, 0), 'Yesterday'],
    [at(10, 3, 23, 59), 'Tuesday'],
    [at(9, 31, 0, 0), 'Saturday'],
    [at(9, 30, 23, 59), 'Oct 30'],
    [at(0, 1, 0, 0), 'Jan 1'],
    [new Date(NOW + 3_600_000).toISOString(), 'Just now'],
    ['x', ''],
    [null, ''],
  ].map(([iso, want]) => ({ name: `${iso} -> ${want}`, run: () => assert.equal(tileTime(iso, NOW), want) })));
});
test('tileMeta: kind, then state or time, then the true cost', async () => {
  const row = (o) => ({ kind: 'web', status: 'done', updatedAt: new Date(NOW - 7200_000).toISOString(), costUsd: 4.2, costKnown: true, ...o });
  await checkRows([
    [row({}), 'Web page · 2h ago · $4.20'],
    [row({ kind: 'pitch', costUsd: 3.1 }), 'Pitch deck · 2h ago · $3.10'],
    [row({ status: 'empty', costUsd: 0 }), 'Web page · 2h ago'],
    [row({ status: 'building' }), 'Web page · Building · $4.20'],
    [row({ status: 'planning' }), 'Web page · Building · $4.20'],
    [row({ status: 'integrating' }), 'Web page · Building · $4.20'],
    [row({ status: 'paused' }), 'Web page · Paused · $4.20'],
    [row({ status: 'stopped' }), 'Web page · Stopped · $4.20'],
    [row({ status: 'error' }), 'Web page · Failed · $4.20'],
    [row({ status: 'interrupted' }), 'Web page · Interrupted · $4.20'],
    [row({ costKnown: false, costUsd: 0 }), 'Web page · 2h ago · cost unknown'],
  ].map(([r, want]) => ({ name: want, run: () => assert.equal(tileMeta(r, NOW), want) })));
});
test('tileMeta: a row with no costKnown (before the server sends it) reads its cost; an unknown kind reads Design', async () => {
  await checkRows([
    [{ kind: 'video', status: 'done', updatedAt: at(10, 4, 9, 0), costUsd: 6.85 }, 'Video · Yesterday · $6.85'],
    [{ kind: 'presentation', status: 'done', updatedAt: at(10, 2, 9, 0), costUsd: 1.92, costKnown: true }, 'Presentation · Monday · $1.92'],
    [{ kind: 'zine', status: 'done', updatedAt: 'x', costUsd: 0 }, 'Design'],
    [{ kind: 'web', status: 'done', updatedAt: 'x', costUsd: 2, costKnown: false }, 'Web page · cost unknown'],
  ].map(([r, want]) => ({ name: want, run: () => assert.equal(tileMeta(r, NOW), want) })));
  assert.deepEqual(['web', 'presentation', 'pitch', 'video', 'nope', 7].map(kindWord), ['Web page', 'Presentation', 'Pitch deck', 'Video', 'Design', 'Design']);
});
const ROWS = [{ id: 'd_000000000001', title: 'Apsida landing page', kind: 'web', status: 'done', updatedAt: at(10, 5, 12, 0), costUsd: 4.2, costKnown: true, thumb: '/api/design/d_000000000001/thumb?v=1' },
  { id: 'd_000000000002', title: 'Seed deck', kind: 'pitch', status: 'building', updatedAt: at(10, 5, 13, 0), costUsd: 0, costKnown: true, thumb: null }];
test('the grid is just the items', async () => {
  const { lib, host, tick } = rig({ rows: ROWS }); await lib.open(); await tick();
  assert.equal(host.querySelector('.dz-lib-h').textContent, 'Designs');
  const tiles = [...host.querySelectorAll('a.dz-tile')];
  assert.deepEqual(tiles.map((t) => t.getAttribute('href')), ['#design/d_000000000001', '#design/d_000000000002']);
  assert.equal(tiles[0].querySelector('.dz-tile-t').textContent, 'Apsida landing page');
  assert.equal(tiles[0].querySelector('.dz-thumb img').getAttribute('src'), ROWS[0].thumb);
  assert.equal(tiles[0].querySelector('.dz-thumb img').getAttribute('alt'), '');
  assert.ok(tiles[1].querySelector('.dz-thumb .dz-thumb-none svg'), 'no picture: the kind icon');
  assert.equal(host.querySelectorAll('.dz-grid > *').length, 2, 'no stacked result cards');
});
test('the markup is the mockup\'s: an empty hero, then the body; tile parts in order; meta from tileMeta', async () => {
  const { lib, host, tick } = rig({ rows: ROWS }); await lib.open(); await tick();
  assert.ok(host.querySelector('div.dz-lib > .dz-lib-in > .dz-hero + .dz-lib-body > h2.dz-lib-h + .dz-grid > a.dz-tile'));
  assert.ok(host.querySelector('.dz-hero > h1.chat-home-title + .ask-composer > .ask-composer-box > textarea.dz-input + .ask-composer-row'), 'Task 9 fills the hero');
  assert.ok(host.querySelector('.dz-hero > .ask-composer + .dz-kinds[role="group"] > button.dz-kind-btn'));
  const t = host.querySelector('a.dz-tile');
  assert.deepEqual([...t.children].map((c) => `${c.tagName} ${c.className}`), ['SPAN dz-thumb', 'SPAN dz-tile-t', 'SPAN dz-tile-m']);
  assert.equal(t.querySelector('.dz-tile-m').textContent, 'Web page · 2h ago · $4.20');
  assert.equal(t.querySelector('.dz-thumb img').getAttribute('loading'), 'lazy');
  assert.equal(host.querySelector('.dz-lib-body').hidden, false);
  assert.equal(host.querySelector('.dz-lib-load'), null);
  assert.equal(host.querySelector('.dz-lib-err'), null);
});
test('empty library: no heading, no prose', async () => {
  const { lib, host, tick } = rig({ rows: [] }); await lib.open(); await tick();
  assert.equal(host.querySelector('.dz-lib-body').hidden, true);
  assert.equal(host.querySelector('.dz-lib-in').textContent.replace(/\s+/g, ' ').includes('No designs'), false);
});
test('a tile click navigates; a failed load says so and Try again refetches', async () => {
  const { lib, host, tick, navs, win } = rig({ rows: ROWS }); await lib.open(); await tick();
  host.querySelector('a.dz-tile').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(navs, ['#design/d_000000000001']);
  const bad = rig({ rows: null }); await bad.lib.open(); await bad.tick();   // rows:null = GET /api/design answers 500
  assert.equal(bad.host.querySelector('.dz-lib-err').textContent.startsWith('Could not load designs'), true);
  const n = bad.gets(); [...bad.host.querySelectorAll('.dz-lib-err button')].find((b) => b.textContent === 'Try again').click(); await bad.tick();
  assert.equal(bad.gets(), n + 1);
});
test('a tile click: no modifier is the page\'s own route; a modifier or another button keeps the browser\'s', async () => {
  const { lib, host, tick, navs, win } = rig({ rows: ROWS }); await lib.open(); await tick();
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
  const r = rig({ rows: null }); await r.lib.open(); await r.tick();
  const err = r.host.querySelector('.dz-lib-err');
  assert.equal(err.tagName, 'P');
  assert.equal(err.parentElement, r.host.querySelector('.dz-lib-in'));
  assert.equal(r.host.querySelector('.dz-lib-body').contains(err), false);
  assert.equal(r.host.querySelectorAll('a.dz-tile').length, 0);
  await r.lib.open(); await r.tick();
  assert.equal(r.host.querySelectorAll('.dz-lib-err').length, 1, 'one failure line, not two');
});
test('loading: nothing for 300 ms, then one busy line after the body; the answer removes it', async () => {
  const { host, win, clock, doc } = rig({ rows: ROWS });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const lib = createLibrary({
    doc, win, host: doc.body, now: () => NOW, navigate() {},
    fetch: async () => { await held; return reply(200, ROWS); },
  });
  made.push(lib);
  const shown = lib.open();
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
  const { lib, host, tick, win } = rig({ rows: [{ ...ROWS[0], title: '<img src=x onerror=alert(1)>' }] }); await lib.open(); await tick();
  const t = host.querySelector('a.dz-tile');
  assert.equal(t.querySelector('.dz-tile-t img'), null);
  assert.equal(t.querySelector('.dz-tile-t').textContent, '<img src=x onerror=alert(1)>');
  t.querySelector('.dz-thumb img').dispatchEvent(new win.Event('error'));
  assert.ok(t.querySelector('.dz-thumb .dz-thumb-none svg'));
  assert.equal(t.querySelector('.dz-thumb img'), null);
});
test('a new picture from a frame: the old one\'s late error leaves it', async () => {
  const { lib, host, tick, win } = rig({ rows: ROWS }); await lib.open(); await tick();
  const t = host.querySelector('a.dz-tile');
  const old = t.querySelector('.dz-thumb img');
  lib.pushFrame({ type: 'design-thumb', designId: ROWS[0].id, thumb: '/t?v=9' });
  old.dispatchEvent(new win.Event('error'));
  assert.equal(t.querySelector('.dz-thumb img').getAttribute('src'), '/t?v=9');
  lib.pushFrame({ type: 'design-thumb', designId: ROWS[0].id, thumb: 7 });
  assert.equal(t.querySelector('.dz-thumb img').getAttribute('src'), '/t?v=9', 'a thumb that is not a string or null changes nothing');
  lib.pushFrame({ type: 'design-thumb', designId: ROWS[0].id, thumb: null });
  assert.ok(t.querySelector('.dz-thumb .dz-thumb-none svg'), 'a frame with no picture shows the icon');
});
test('frames: status and thumb in place; an end or a restore refetches once; deltas do nothing', async () => {
  const { lib, host, tick, gets } = rig({ rows: ROWS }); await lib.open(); await tick();
  const n = gets(); const tile = host.querySelectorAll('a.dz-tile')[1];
  lib.pushFrame({ type: 'design-delta', designId: ROWS[1].id }); assert.equal(gets(), n);
  lib.pushFrame({ type: 'design-build', designId: ROWS[1].id, status: 'paused', stats: {} }); await tick();
  assert.ok(host.querySelectorAll('a.dz-tile')[1].querySelector('.dz-tile-m').textContent.includes('Paused'));
  lib.pushFrame({ type: 'design-thumb', designId: ROWS[1].id, thumb: '/t?v=2' }); await tick();
  assert.equal(host.querySelectorAll('a.dz-tile')[1].querySelector('img').getAttribute('src'), '/t?v=2');
  lib.pushFrame({ type: 'design-build', designId: ROWS[1].id, status: 'done', stats: {} });
  lib.pushFrame({ type: 'design-restored', designId: ROWS[1].id }); await tick();
  assert.equal(gets(), n + 1); assert.ok(tile);
});
test('frames: in place means the same tile; a live status refetches nothing; each end kind refetches; an unchanged list keeps its tiles', async () => {
  const { lib, host, tick, gets, clock } = rig({ rows: ROWS }); await lib.open(); await tick();
  const n = gets();
  const tile = host.querySelectorAll('a.dz-tile')[1];
  lib.pushFrame({ type: 'design-build', designId: ROWS[1].id, status: 'integrating', stats: {} });
  assert.equal(clock.pending(), 0, 'a live status schedules nothing');
  assert.equal(host.querySelectorAll('a.dz-tile')[1], tile, 'the same tile, updated in place');
  assert.equal(tile.querySelector('.dz-tile-m').textContent, 'Pitch deck · Building');
  lib.pushFrame({ type: 'design-thumb', designId: ROWS[1].id, thumb: '/t?v=3' });
  assert.equal(host.querySelectorAll('a.dz-tile')[1], tile);
  lib.pushFrame({ type: 'design-thumb', designId: 'd_00000000ffff', thumb: '/x' });
  lib.pushFrame({ type: 'design-section', designId: ROWS[1].id });
  lib.pushFrame(null);
  assert.equal(clock.pending(), 0, 'other frames schedule nothing');
  await tick();
  assert.equal(gets(), n);
  for (const status of ['done', 'stopped', 'error', 'interrupted']) {
    const before = gets();
    lib.pushFrame({ type: 'design-build', designId: ROWS[0].id, status, stats: {} });
    clock.tick(199); await flush();
    assert.equal(gets(), before, `${status}: one 200 ms timer`);
    clock.tick(1); await flush();
    assert.equal(gets(), before + 1, status);
  }
  const second = host.querySelectorAll('a.dz-tile')[1];
  assert.equal(second.querySelector('.dz-tile-m').textContent, 'Pitch deck · Building', 'the answer replaces what the frames changed');
  assert.ok(second.querySelector('.dz-thumb-none svg'));
  const first = host.querySelector('a.dz-tile');
  lib.pushFrame({ type: 'design-restored', designId: ROWS[0].id }); await tick();
  assert.equal(host.querySelector('a.dz-tile'), first, 'the same rows again: no repaint');
});
test('destroy: the library goes, its timers with it, and frames after it do nothing', async () => {
  const { lib, host, tick, gets, clock } = rig({ rows: ROWS }); await lib.open(); await tick();
  lib.pushFrame({ type: 'design-restored', designId: ROWS[0].id });
  assert.equal(clock.pending(), 1);
  const n = gets();
  made.splice(made.indexOf(lib), 1);
  lib.destroy();
  assert.equal(clock.pending(), 0);
  assert.equal(host.querySelector('.dz-lib'), null);
  lib.pushFrame({ type: 'design-restored', designId: ROWS[0].id });
  await tick();
  assert.equal(gets(), n);
});
test('More: Rename and Delete; Delete is off during a build', async () => {
  const { more, doc, button, calls, confirms, navs, tick } = rigMore({ live: false });
  button.click();
  const items = [...doc.querySelectorAll('.menu .menu-item')];
  assert.deepEqual(items.map((b) => b.textContent), ['Rename', 'Delete']);
  items[0].click(); await tick();
  assert.deepEqual(calls.at(-1), { method: 'PATCH', url: '/api/design/d_000000000001', body: { title: 'New name' } });
  button.click(); [...doc.querySelectorAll('.menu .menu-item')][1].click(); await tick();
  assert.equal(confirms[0].confirmLabel, 'Delete'); assert.equal(confirms[0].danger, true);
  assert.deepEqual(calls.at(-1), { method: 'DELETE', url: '/api/design/d_000000000001' });
  assert.deepEqual(navs, ['#design']);
  assert.ok(more);
  const off = rigMore({ live: true }); off.button.click();
  assert.equal([...off.doc.querySelectorAll('.menu .menu-item')][1].getAttribute('aria-disabled'), 'true');
});
test('More: the prompt and the confirm say what the plan says; Rename hands the row back; each item closes the menu first', async () => {
  const { button, items, prompted, confirms, renamed, tick } = rigMore();
  assert.equal(button.getAttribute('aria-haspopup'), 'menu');
  button.click();
  const menu = items()[0].closest('.menu');
  assert.equal(menu.getAttribute('role'), 'menu');
  assert.deepEqual(items().map((b) => b.getAttribute('role')), ['menuitem', 'menuitem']);
  items()[0].click();
  assert.equal(menu.hidden, true, 'Rename closed the menu before its prompt');
  await tick();
  assert.deepEqual(prompted, [{ title: 'Rename design', fields: [{ id: 'title', label: 'Name', value: 'Apsida landing page', required: true }], confirmLabel: 'Rename' }]);
  assert.deepEqual(renamed, [{ ...DESIGN, title: 'New name' }]);
  button.click();
  items()[1].click();
  assert.equal(menu.hidden, true, 'Delete closed the menu before its confirm');
  await tick();
  assert.deepEqual(confirms, [{ title: 'Delete this design?', message: 'Its files and chat go. What it cost stays in Statistics.', confirmLabel: 'Delete', danger: true }]);
});
test('More: a cancelled prompt or confirm sends nothing', async () => {
  const { button, items, calls, navs, renamed, tick } = rigMore({ answers: [false], prompts: [null] });
  button.click(); items()[0].click(); await tick();
  button.click(); items()[1].click(); await tick();
  assert.deepEqual([calls, navs, renamed], [[], [], []]);
});
test('More: a disabled Delete does nothing on a click, says why, and the menu stays open', async () => {
  const { button, items, calls, confirms, tick } = rigMore({ live: true });
  button.click();
  const del = items()[1];
  assert.equal(del.getAttribute('title'), 'A build is running');
  del.click(); await tick();
  assert.deepEqual([calls, confirms], [[], []]);
  assert.equal(del.closest('.menu').hidden, false);
});
test('More: Delete follows the build at each open', async () => {
  let live = false;
  const dom = trackDom(new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' }));
  const doc = dom.window.document;
  const button = doc.body.appendChild(doc.createElement('button'));
  const more = designMoreMenu({
    doc, win: dom.window, button, getDesign: () => DESIGN, fetch: async () => reply(200, {}), confirm: async () => false,
    prompt: async () => null, navigate() {}, buildLive: () => live, onRenamed() {},
  });
  made.push(more);
  const del = () => doc.querySelectorAll('.menu .menu-item')[1];
  button.click();
  assert.equal(del().hasAttribute('aria-disabled'), false);
  button.click();
  live = true;
  button.click();
  assert.deepEqual([del().getAttribute('aria-disabled'), del().getAttribute('title')], ['true', 'A build is running']);
  button.click();
  live = false;
  button.click();
  assert.deepEqual([del().hasAttribute('aria-disabled'), del().hasAttribute('title')], [false, false]);
});
test('More: a 409 re-opens the confirm with the server\'s text in red, still saying what is lost; a second refusal too; a cancel then leaves', async () => {
  const refused = 'the design has a build that is still running or paused';
  const loss = 'Its files and chat go. What it cost stays in Statistics.';
  const { button, items, calls, confirms, navs, tick } = rigMore({ answers: [true, true, false], deleteAnswers: [[409, { error: refused }], [409, { error: 'A restore is running.' }]] });
  button.click(); items()[1].click(); await tick(); await tick();
  assert.equal(confirms.length, 3);
  assert.deepEqual([confirms[1].message, confirms[1].messageTone, confirms[1].confirmLabel, confirms[1].danger], [`${refused}. ${loss}`, 'err', 'Delete', true]);
  assert.deepEqual([confirms[2].message, confirms[2].messageTone], [`A restore is running. ${loss}`, 'err']);
  assert.equal(confirms[0].messageTone, undefined);
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 2);
  assert.deepEqual(navs, []);
});
test('More: a refused rename re-opens the prompt with the server\'s text and the name typed', async () => {
  const { button, items, calls, prompted, renamed, tick } = rigMore({ prompts: [{ title: 'Bad' }, null], patchAnswers: [[400, { error: 'title is too long' }]] });
  button.click(); items()[0].click(); await tick(); await tick();
  assert.equal(calls.length, 1);
  assert.equal(prompted.length, 2);
  assert.deepEqual([prompted[1].message, prompted[1].messageTone, prompted[1].fields[0].value], ['title is too long', 'err', 'Bad']);
  assert.deepEqual(renamed, []);
});
test('More: destroy removes the menu and every window listener', async () => {
  const dom = trackDom(new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' }));
  const win = dom.window;
  const doc = win.document;
  const live = new Map();
  const add = win.addEventListener.bind(win); const remove = win.removeEventListener.bind(win);
  win.addEventListener = (t, fn, o) => { live.set(fn, t); add(t, fn, o); };
  win.removeEventListener = (t, fn, o) => { live.delete(fn); remove(t, fn, o); };
  const button = doc.body.appendChild(doc.createElement('button'));
  const more = designMoreMenu({
    doc, win, button, getDesign: () => DESIGN, fetch: async () => reply(200, {}), confirm: async () => false,
    prompt: async () => null, navigate() {}, buildLive: () => false, onRenamed() {},
  });
  assert.ok(live.size > 0);
  more.destroy();
  assert.deepEqual([...live.values()], []);
  assert.equal(doc.querySelector('.menu'), null);
  button.click();
  assert.equal(doc.querySelector('.menu'), null);
});
test('titleFromBrief: first line, first sentence, at most 60 chars at a word', async () => {
  await checkRows([
    ['Q4 roadmap review', 'Q4 roadmap review'], ['  Hiring all-hands\nfor the team', 'Hiring all-hands'], ['A menu. Warm and plain.', 'A menu'],
    ['A landing page for Apsida, ground-station scheduling for small satellite fleets. Dark.', 'A landing page for Apsida, ground-station scheduling for'],
    ['v1.2 launch film', 'v1.2 launch film'], ['x'.repeat(100), 'x'.repeat(60)],
    // The 60th character is a space after a comma: the cut keeps 60 and drops the comma; a first line ending in a colon.
    ['A landing page for Apsida, ground-station scheduling for us, then more', 'A landing page for Apsida, ground-station scheduling for us'],
    ['Hiring all-hands:\nfor the team', 'Hiring all-hands'], ['  ', ''],
  ].map(([t, want]) => ({ name: t, run: () => assert.equal(titleFromBrief(t), want) })));
});
test('composer matches the mockup', async () => {
  const { lib, host, tick } = rig({ rows: [] }); await lib.open(); await tick();
  assert.equal(host.querySelector('.dz-hero h1').textContent, 'What should we design?');
  assert.equal(host.querySelector('textarea.dz-input').getAttribute('placeholder'), 'A landing page, a deck, a pitch, a film');
  assert.deepEqual([...host.querySelectorAll('.dz-kinds .dz-kind-btn')].map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
    [['Web page', 'true'], ['Presentation', 'false'], ['Pitch deck', 'false'], ['Video', 'false']]);
  assert.equal(host.querySelector('.ask-scope-btn .ask-scope-label').textContent, 'No project');
  assert.equal(host.querySelector('.ask-scope-btn').getAttribute('aria-label'), 'Project: none');
  const sw = host.querySelector('.dz-fast input[role=switch]');   // makeSwitch, as the dock's
  assert.equal(sw.checked, false);
  assert.equal(host.querySelector('.dz-fast-cap.dz-fast-n').hidden, true);
  sw.click();
  assert.equal(host.querySelector('.dz-fast-cap').textContent, 'up to 12');
  host.querySelectorAll('.dz-kind-btn')[1].click();
  assert.deepEqual([...host.querySelectorAll('.dz-kind-btn')].map((b) => [b.getAttribute('aria-pressed'), b.classList.contains('is-on')]), [['false', false], ['true', true], ['false', false], ['false', false]]);
  assert.equal(host.querySelector('.ask-send').tagName, 'BUTTON');
  assert.equal(host.querySelector('.ask-send').disabled, true, 'empty');
});
test('the kind chips wrap on a narrow screen: a centred row that spills cuts its first chip off out of reach', () => {
  // The p6t1 browser pass at 390 px: four chips in one centred row overflowed both sides of the Library.
  const rules = cssRules(readStyleCss()).filter((r) => r.sel === '.dz-kinds' && !r.media);
  assert.ok(rules.some((r) => /(^|;)flex-wrap:wrap(;|$)/.test(r.body)), rules.map((r) => r.body).join(' | '));
});
test('send: creates the design with its choices, hands the message over, opens it, with no AI title', async () => {
  const { lib, host, tick, posts, navs, setText, pick } = rig({ rows: [], projects: [{ key: 'p1', name: 'One', exists: true }], created: { design: { id: 'd_000000000009' }, threadId: 'ask_00000001' } });
  await lib.open(); await tick();
  host.querySelectorAll('.dz-kind-btn')[2].click();
  host.querySelector('.dz-fast [role=switch]').click();
  await pick('One');
  setText('A seed deck. Twelve slides, dark.');
  host.querySelector('.ask-send').click(); await tick();
  assert.deepEqual(posts, [{ url: '/api/design', body: { kind: 'pitch', fast: true, title: 'A seed deck', projectKey: 'p1' } }]);
  assert.deepEqual(navs, ['#design/d_000000000009']);
  assert.deepEqual(takeStart('d_000000000009'), { text: 'A seed deck. Twelve slides, dark.', files: [] });
  assert.equal(takeStart('d_000000000009'), null, 'one shot');
});
test('keys: Enter sends, Shift+Enter is a new line, IME composing does nothing', async () => {
  const { lib, host, tick, posts, setText, keydown } = rig({ rows: [], created: { design: { id: 'd_000000000009' } } });
  await lib.open(); await tick(); setText('x');
  keydown('Enter', { shiftKey: true }); keydown('Enter', { isComposing: true }); await tick();
  assert.equal(posts.length, 0);
  keydown('Enter'); keydown('Enter'); await tick();
  assert.equal(posts.length, 1, 'a second press while busy does nothing');
  assert.ok(host);
});
test('a refused create stays in the composer with everything kept: text, kind, Build fast, project, files; Send works again', async () => {
  const { lib, host, win, tick, navs, setText, pick, addFiles } = rig({ rows: [], projects: [{ key: 'p1', name: 'One', exists: true }], createStatus: 400, createError: 'There is no project "p1"' });
  await lib.open(); await tick();
  host.querySelectorAll('.dz-kind-btn')[2].click();
  host.querySelector('.dz-fast [role=switch]').click();
  await pick('One');
  await addFiles([new win.File(['x'], 'logo.png', { type: 'image/png' })]);
  setText('A page');
  host.querySelector('.ask-send').click(); await tick();
  assert.equal(host.querySelector('.dz-start-err').textContent, 'There is no project "p1"');
  assert.equal(host.querySelector('textarea.dz-input').value, 'A page');
  assert.equal(host.querySelector('.dz-kind-btn.is-on').textContent, 'Pitch deck');
  assert.deepEqual([host.querySelector('.dz-fast [role=switch]').checked, host.querySelector('.dz-fast-cap').hidden], [true, false]);
  assert.equal(host.querySelector('.ask-scope-label').textContent, 'One');
  assert.deepEqual([...host.querySelectorAll('.dz-start-file > span:first-child')].map((s) => s.textContent), ['logo.png']);
  assert.equal(host.querySelector('.ask-send').disabled, false, 'Send is ready again without typing');
  assert.deepEqual(navs, []);
});
test('attach: pills, removal, a refusal shown in place, files handed over', async () => {
  const { lib, host, tick, addFiles, setText, win } = rig({ rows: [], created: { design: { id: 'd_00000000000a' } } });
  await lib.open(); await tick();
  // No file is refused for its type (dev's "accept any file type"): the refusal here is a file over the size cap.
  const big = new win.File(['x'], 'huge.bin');
  Object.defineProperty(big, 'size', { value: 100 * 1024 * 1024 + 1 });
  await addFiles([new win.File(['x'], 'logo.png', { type: 'image/png' }), big]);
  assert.match(host.querySelector('.dz-start-err').textContent, /huge\.bin/);
  assert.deepEqual([...host.querySelectorAll('.dz-start-file')].map((c) => c.querySelector('span').textContent), ['logo.png']);
  setText('Use this'); host.querySelector('.ask-send').click(); await tick();
  assert.equal(takeStart('d_00000000000a').files[0].name, 'logo.png');
});
test('the project menu: No project and each project there; the pick is checked and named; a failed load says so in a disabled row', async () => {
  const { lib, host, doc, tick, pick } = rig({ rows: [], projects: [{ key: 'p1', name: 'One', exists: true }, { key: 'p2', name: 'Gone', exists: false }] });
  await lib.open(); await tick();
  const btn = host.querySelector('.ask-scope-btn');
  assert.equal(btn.getAttribute('aria-haspopup'), 'menu');
  await pick('One');
  assert.equal(doc.querySelector('.menu.dz-start-menu').hidden, true, 'a pick closes the menu');
  assert.deepEqual([btn.querySelector('.ask-scope-label').textContent, btn.getAttribute('aria-label')], ['One', 'Project: One']);
  btn.click(); await flush();
  const rows = () => [...doc.querySelectorAll('.dz-start-menu [role^="menuitem"]')];
  assert.deepEqual(rows().map((r) => [r.getAttribute('role'), r.textContent.trim(), r.getAttribute('aria-checked'), r.querySelector('.ask-scope-check > .ask-model-check') !== null]),
    [['menuitemradio', 'No project', 'false', false], ['menuitemradio', 'One', 'true', true]]);
  assert.ok(rows().every((r) => r.lastElementChild.matches('span.ask-scope-check[aria-hidden="true"]')), 'a trailing check slot on every row');
  rows()[0].click(); await flush();
  assert.deepEqual([btn.querySelector('.ask-scope-label').textContent, btn.getAttribute('aria-label')], ['No project', 'Project: none']);
  const bad = rig({ rows: [], projects: null }); await bad.lib.open(); await bad.tick();
  bad.host.querySelector('.ask-scope-btn').click(); await flush();
  const items = [...bad.doc.querySelectorAll('.dz-start-menu [role^="menuitem"]')];
  assert.deepEqual(items.map((r) => [r.textContent.trim(), r.disabled]), [['No project', false], ['Could not load projects', true]]);
});
test('attach: the remove button, a paste and a drop on the composer box; send waits for a batch still being read', async () => {
  const { lib, host, win, tick, posts, addFiles, setText } = rig({ rows: [], created: { design: { id: 'd_00000000000b' } } });
  await lib.open(); await tick();
  await addFiles([new win.File(['a'], 'a.md'), new win.File(['b'], 'b.md')]);
  const x = host.querySelector('.dz-start-file button');
  assert.deepEqual([x.getAttribute('aria-label'), x.querySelector('.ic svg') !== null], ['Remove a.md', true]);
  x.click();
  assert.deepEqual([...host.querySelectorAll('.dz-start-file > span:first-child')].map((s) => s.textContent), ['b.md']);
  const paste = new win.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { files: [new win.File(['c'], 'c.md')], getData: () => '' } });
  host.querySelector('textarea.dz-input').dispatchEvent(paste);
  assert.equal(paste.defaultPrevented, true);
  const drop = new win.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [new win.File(['d'], 'd.md')] } });
  host.querySelector('.ask-composer-box').dispatchEvent(drop);
  assert.equal(drop.defaultPrevented, true);
  setText('Go');
  host.querySelector('.ask-send').click();   // the paste and the drop are still being read
  for (let i = 0; i < 5; i += 1) await flush();
  assert.equal(posts.length, 1);
  assert.deepEqual(takeStart('d_00000000000b').files.map((f) => [f.name, f.attKind, f.mime, f.bytes, f.dataBase64]),
    [['b.md', 'text', null, 1, 'Yg=='], ['c.md', 'text', null, 1, 'Yw=='], ['d.md', 'text', null, 1, 'ZA==']]);
  assert.deepEqual([host.querySelectorAll('.dz-start-file').length, host.querySelector('textarea.dz-input').value], [0, ''], 'the composer resets');
});
test('the composer: Send follows the text; a 201 resets it but the kind stays; destroy takes the project menu with it', async () => {
  const { lib, host, doc, tick, setText, pick } = rig({ rows: [], projects: [{ key: 'p1', name: 'One', exists: true }], created: { design: { id: 'd_00000000000c' } } });
  await lib.open(); await tick();
  const send = host.querySelector('.ask-send');
  setText('  '); assert.equal(send.disabled, true, 'blank');
  setText('A film'); assert.equal(send.disabled, false);
  host.querySelectorAll('.dz-kind-btn')[3].click();
  host.querySelector('.dz-fast [role=switch]').click();
  await pick('One');
  send.click(); await tick();
  assert.deepEqual([host.querySelector('textarea.dz-input').value, send.disabled], ['', true]);
  assert.equal(host.querySelector('.dz-kind-btn.is-on').textContent, 'Video', 'the kind stays');
  assert.deepEqual([host.querySelector('.dz-fast [role=switch]').checked, host.querySelector('.dz-fast-cap').hidden, host.querySelector('.ask-scope-label').textContent], [false, true, 'No project']);
  assert.ok(takeStart('d_00000000000c'));
  made.splice(made.indexOf(lib), 1);
  lib.destroy();
  assert.equal(doc.querySelector('.dz-start-menu'), null);
});
