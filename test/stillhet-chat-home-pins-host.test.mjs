// test/stillhet-chat-home-pins-host.test.mjs — F-5-11: Chat home reads dev's pins again each time it is shown, so a pin
// made elsewhere (Workflows' own PUT /api/chat-home/pins, no WS frame) is a starter without a reload. Only Chat home reads
// (never an open chat or another page), an unchanged answer redraws nothing, a changed one redraws only the starters row,
// a failed read keeps what is drawn, and a read that answers after a pin keeps the pin. The demo (the prototype) shows the same.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, until, closeHosts, toastText } from './helpers/stillhet-chat-live-host.mjs';
import { workflowsHost, WF_LISTS } from './helpers/stillhet-workflows-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
const PINS = '/api/chat-home/pins';
const starters = (d) => [...d.querySelectorAll('#route-chat [data-pin]')].map((e) => e.dataset.pin);
const pinGets = (calls) => calls.filter((c) => c.method === 'GET' && c.url === PINS).length;
// a held answer: `arm()` holds the next pins request (one, the read) until `release()`
function holder() {
  let gate = null, open = null;
  return {
    hold: (u) => { if (u !== PINS || !gate) return null; const g = gate; gate = null; return g; },
    arm: () => { gate = new Promise((r) => { open = r; }); },
    release: () => { const o = open; open = null; o?.(); },
  };
}

test('F-5-11 live: a pin from Workflows\' act is a Chat home starter without a reload', async () => {
  let pins = ['wf_default'], wfReads = 0;
  const all = WF_LISTS['/api/workflows'].workflows;
  const { w, d } = await workflowsHost({
    hash: '#chat',
    // the first workflows read (Chat home's) does not know wf_mine yet: a pin of it must still be drawn by its name (R2)
    read: (u) => (u === PINS ? [200, { pins: [...pins] }] : u === '/api/workflows' ? [200, { workflows: wfReads++ ? all : all.filter((x) => x.id !== 'wf_mine') }] : null),
    write: (u, b) => { if (u === PINS) { pins = [...b.pins]; return [200, { pins }]; } return [200, { ok: true }]; },
  });
  await until(() => starters(d).includes('Default'));
  assert.ok(!starters(d).includes('Mine'));
  await go(w, '#workflows/workflow:wf_mine', 200);
  d.querySelector('[data-menu="wf-more"]').click(); await settle(20);
  d.querySelector('[data-menu-pick="wf-more|pin"]').click(); await settle(80);
  assert.deepEqual(pins, ['wf_default', 'wf_mine'], 'Workflows wrote the pin');
  await go(w, '#chat', 120);
  await until(() => starters(d).includes('Mine'));
  assert.deepEqual(starters(d), ['Default', 'Mine'], 'named, never the bare id');
});

test('F-5-11: pins are read again only when Chat home is shown', async () => {
  const { w, d, calls } = await liveHost({ hash: '#chat/ask_1' });
  await settle(60);
  const n0 = pinGets(calls);
  await go(w, '#chat/ask_2');
  assert.equal(pinGets(calls), n0, 'an open chat never reads the pins');
  await go(w, '#schedules');
  assert.equal(pinGets(calls), n0, 'another page never reads them');
  w.RailConversation.refresh(); w.RailConversation.flushPaints(); await settle(20);
  assert.equal(pinGets(calls), n0, 'a repaint never reads them');
  await go(w, '#chat');
  assert.equal(pinGets(calls), n0 + 1, 'Chat home shown: one read');
  await go(w, '#chat/ask_1');
  assert.equal(pinGets(calls), n0 + 1);
  await go(w, '#chat');
  assert.equal(pinGets(calls), n0 + 2, 'shown again: read again');
  assert.deepEqual(starters(d), ['Shaper']);
});

test('F-5-11: an unchanged read redraws nothing; a changed one redraws only the starters', async () => {
  let pins = ['wf_shape'];
  const h = holder();
  const { w, d } = await liveHost({ hash: '#chat', hold: h.hold, read: (u) => (u === PINS ? [200, { pins: [...pins] }] : null) });
  await until(() => starters(d).length);
  await go(w, '#chat/ask_1');
  h.arm(); await go(w, '#chat');
  const row = d.querySelector('#route-chat .home-starters'), box = d.querySelector('#route-chat [data-composer-t]');
  box.value = 'typed while the pins were read';
  h.release(); await settle(60);
  assert.equal(d.querySelector('#route-chat .home-starters'), row, 'unchanged: the row is the same node');
  assert.equal(d.querySelector('#route-chat [data-composer-t]'), box);
  assert.equal(box.value, 'typed while the pins were read');
  pins = ['wf_shape', 'wf_lean'];
  await go(w, '#chat/ask_1');
  h.arm(); await go(w, '#chat');
  const row2 = d.querySelector('#route-chat .home-starters'), box2 = d.querySelector('#route-chat [data-composer-t]');
  box2.value = 'still here';
  h.release(); await until(() => starters(d).includes('Lean'));
  assert.notEqual(d.querySelector('#route-chat .home-starters'), row2, 'changed: the row is drawn again');
  assert.equal(d.querySelector('#route-chat [data-composer-t]'), box2, 'the composer is not redrawn');
  assert.equal(box2.value, 'still here');
  assert.deepEqual(starters(d), ['Shaper', 'Lean']);
});

test('F-5-11: a failed fresh read keeps the drawn pins', async () => {
  let fail = false;
  const { w, d } = await liveHost({ hash: '#chat', read: (u) => (u === PINS && fail ? [500, { error: 'down' }] : null) });
  await until(() => starters(d).includes('Shaper'));
  fail = true;
  await go(w, '#chat/ask_1'); await go(w, '#chat', 120);
  assert.deepEqual(starters(d), ['Shaper']);
  assert.ok(!/Could not/.test(toastText(d)), 'no toast');
});

test('F-5-11: a pins read that answers after a pin keeps the pin', async () => {
  const h = holder();
  const { w, d, calls } = await liveHost({
    hash: '#chat', hold: h.hold,
    read: (u) => (u === PINS ? [200, { pins: ['wf_shape'] }] : null),   // the GET was answered before the pin was written
    write: (u, b) => (u === PINS ? [200, { pins: b.pins }] : [200, {}]),
  });
  await until(() => starters(d).includes('Shaper'));
  await go(w, '#chat/ask_1');
  h.arm(); await go(w, '#chat');
  w.RailConversation.pin('Lean', true); await settle(60);
  assert.ok(calls.some((c) => c.method === 'PUT' && c.url === PINS));
  assert.deepEqual(starters(d), ['Shaper', 'Lean'], 'the PUT answer is drawn');
  h.release(); await settle(80);
  assert.deepEqual(starters(d), ['Shaper', 'Lean'], 'the older read is dropped');
});

test('F-5-11: a home with no starters (Requirements\' Shape a feature) never reads the pins', async () => {
  const { w, d, calls } = await liveHost({ hash: '#chat/ask_1' });
  await settle(60);
  const el = d.createElement('div'); d.body.append(el);
  const home = w.RailConversation.mount(el, { mode: 'ask', title: 'Shape a feature' });
  const n0 = pinGets(calls);
  home.show(''); await settle(40);
  home.show(''); await settle(40);
  assert.equal(pinGets(calls), n0, 'shown twice: no pins read');
  assert.equal(el.querySelector('.home-starters'), null, 'it draws no starters');
});

test('F-5-11: a fresh read whose workflows read fails keeps the names, never a bare id', async () => {
  let pins = ['wf_shape'], flowsDown = false;
  const { w, d } = await liveHost({ hash: '#chat', read: (u) => (u === PINS ? [200, { pins: [...pins] }] : u === '/api/workflows' && flowsDown ? [500, { error: 'down' }] : null) });
  await until(() => starters(d).includes('Shaper'));
  pins = ['wf_shape', 'wf_new']; flowsDown = true;   // a pin of a workflow this page has not read yet, and its read fails
  await go(w, '#chat/ask_1'); await go(w, '#chat', 120);
  assert.deepEqual(starters(d), ['Shaper'], 'what is drawn stays');
  assert.ok(!starters(d).includes('wf_new'), 'never the bare id');
});

test('F-5-11 demo: a pin made in Workflows is a starter on Chat home', async () => {
  const urls = [];
  const w = stillhetHost({ hash: '#chat', after: (fn) => closers.push(fn), fetch: async (u) => { urls.push(String(u)); return { ok: false, status: 404, json: async () => ({}) }; }, beforeScripts: (win) => { win.structuredClone ||= structuredClone; win.RailGraph = { mount: () => ({ g: null, view: null, fit: 1 }), align: (g) => g, build: () => ({}) }; } });
  const d = w.document;
  await settle(60);
  const before = starters(d);
  await go(w, '#workflows/workflow:default', 120);
  const title = d.querySelector('[data-menu="wf-more"]').getAttribute('aria-label')?.replace(/^More for /, '') || '';
  d.querySelector('[data-menu="wf-more"]').click(); await settle(20);
  d.querySelector('[data-menu-pick="wf-more|pin"]').click(); await settle(40);
  await go(w, '#chat', 80);
  assert.ok(title && !before.includes(title), `the workflow was not pinned before: ${title}`);
  assert.ok(starters(d).includes(title), `${title} is a starter: ${starters(d)}`);
  assert.ok(!urls.includes(PINS), 'the demo asks no server for its pins');
});
const closers = [];
afterEach(() => { while (closers.length) closers.pop()(); });
