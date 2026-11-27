// test/ui-design-library.test.mjs — what library.mjs still owns: a tile's words (tileTime, tileMeta, kindWord), the kind
// buttons, a new design's title (titleFromBrief), the gear's Pictures row and the chat head's More (Rename, Delete). The
// tiles themselves: test/ui-design-grid.test.mjs; the design start that makes a design: test/ui-design-studio.test.mjs.
// Plain DOM in jsdom, with a fake fetch; nothing here reaches a server.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { cssRules } from './helpers/css-rules.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { tileTime, tileMeta, designMoreMenu, kindWord, titleFromBrief } from '../ui/public/design/library.mjs';
import { createPicturesRow } from '../ui/public/design/composer-settings.mjs';

const trackDom = useDomRelease(afterEach);
const made = [];
afterEach(() => { while (made.length) made.pop().destroy(); });

const flush = () => new Promise((resolve) => setImmediate(resolve));

function reply(status, body) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text };
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
  assert.deepEqual(['web', 'presentation', 'pitch', 'video', 'document', 'nope', 7].map(kindWord), ['Web page', 'Presentation', 'Pitch deck', 'Video', 'Document', 'Design', 'Design']);
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
  assert.deepEqual(confirms, [{ title: 'Delete this design?', message: 'Its files go; its chat stays. What it cost stays in Statistics.', confirmLabel: 'Delete', danger: true }]);
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
  const loss = 'Its files go; its chat stays. What it cost stays in Statistics.';
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
test('the kind buttons are equal grid columns that wrap on a narrow screen: a centred row that spills cuts its first one off out of reach', () => {
  // The p6t1 browser pass at 390 px: four chips in one centred row overflowed both sides of the design start.
  const rules = cssRules(readStyleCss()).filter((r) => r.sel === '.dz-kinds' && !r.media);
  // Equal grid columns (auto-fit) wrap into rows of equal buttons: one size whatever the word, never spilling.
  assert.ok(rules.some((r) => /(^|;)display:grid(;|$)/.test(r.body) && /grid-template-columns:repeat\(auto-fit,minmax\(140px,1fr\)\)/.test(r.body)), rules.map((r) => r.body).join(' | '));
});
test('Pictures not set up, its key missing, or under the broker: Set up leads to the Providers row; no answer, no row', async () => {
  for (const images of [{ configured: false, settable: true, model: '' }, { configured: false, settable: true, keyMissing: true, model: 'gpt-image-2.6-flare' },
    { configured: false, settable: false, model: '' }]) {
    const doc = trackDom(new JSDOM('<!doctype html><html><body></body></html>')).window.document;
    const pics = createPicturesRow({ doc, fetch: async () => reply(200, images) });
    await pics.load();
    const off = pics.el.querySelector('.dz-pics-off');
    const a = off.querySelector('a.dz-pics-setup');
    assert.deepEqual([off.hidden, pics.el.querySelector('.dz-pics-on').hidden, off.querySelector('.switch-label').textContent, a.textContent, a.getAttribute('href'), a.hasAttribute('data-nav')],
      [false, true, 'Pictures', 'Set up', '#models/providers/images', true], JSON.stringify(images));
    assert.equal(pics.ready(), false, 'no switch: a new design sends no pictures field (ui-design-studio: the start\'s send)');
  }
  const doc = trackDom(new JSDOM('<!doctype html><html><body></body></html>')).window.document;
  const none = createPicturesRow({ doc, fetch: async () => reply(404, { error: 'not found' }) });
  await none.load();
  assert.equal(none.el.hidden, true, 'no answer: no row');
});
test('the Pictures row paints only the newest answer and says when what it shows changed', async () => {
  const doc = trackDom(new JSDOM('<!doctype html><html><body></body></html>')).window.document;
  const answers = [];
  const pics = createPicturesRow({ doc, fetch: () => new Promise((resolve) => { answers.push(resolve); }) });
  const ready = reply(200, { configured: true, model: 'gpt-image-2.6-flare' });
  const first = pics.load();
  const second = pics.load();
  answers[1](reply(200, { configured: false, model: '' }));
  assert.equal(await second, true);
  answers[0](ready);
  assert.equal(await first, false, 'an answer that is not the newest is dropped');
  assert.deepEqual([pics.el.hidden, pics.ready(), pics.el.querySelector('.dz-pics-off').hidden], [false, false, false]);
  const third = pics.load();
  answers[2](ready);
  assert.equal(await third, true);
  const fourth = pics.load();
  answers[3](ready);
  assert.equal(await fourth, false, 'the same answer changes nothing');
  const model = pics.el.querySelector('.dz-pics-model');
  assert.deepEqual([pics.ready(), model.textContent, model.title], [true, 'gpt-image-2.6-flare', 'gpt-image-2.6-flare']);
});
