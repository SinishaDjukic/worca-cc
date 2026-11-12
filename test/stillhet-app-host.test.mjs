// test/stillhet-app-host.test.mjs — host-app.js (the opt-out inside Stillhet), host-prototype.js and adapter.js, run in a vm
// with a small DOM stub: the files are classic scripts that set window.RailHost / window.RailAdapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const DIR = new URL('../ui/public/stillhet/', import.meta.url);
const load = (file, { fetchImpl, search = '', host } = {}) => {
  const calls = [], cls = new Set(), toast = { textContent: '', cls, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) } }, listeners = [];
  const win = { RailHost: host };
  const ctx = {
    window: win, fetch: async (u, o) => { calls.push({ u, o }); return fetchImpl(u, o); }, setTimeout: () => 0, clearTimeout: () => {},
    location: { search, reload: () => calls.push('reload') }, URLSearchParams, JSON,
    matchMedia: () => ({ matches: false }),
    document: {
      activeElement: null,
      querySelector: (s) => (s === '.rc-toast' ? toast : null), querySelectorAll: () => [], getElementById: () => null,
      addEventListener: (type, fn) => listeners.push({ type, fn }),
    },
  };
  for (const f of [].concat(file)) vm.runInNewContext(readFileSync(new URL(f, DIR), 'utf8'), ctx);
  const click = (target) => listeners.filter((l) => l.type === 'click').forEach((l) => l.fn({ target }));
  return { win, calls, toast, click, doc: ctx.document, ctx };
};
const reply = (ok, data = {}) => async () => ({ ok, json: async () => data });

test('opt-out: one PATCH /api/flags with { rail: false }, no other call, then a reload', async () => {
  const { win, calls } = load('host-app.js', { fetchImpl: reply(true, { flags: [] }) });
  assert.equal(win.RailHost.name, 'app');
  assert.equal(win.RailHost.stillhetOn(), true);
  assert.deepEqual({ ...(await win.RailHost.setStillhet(false)) }, { ok: true });
  assert.equal(calls.filter((c) => c !== 'reload').length, 1);
  assert.equal(calls[0].u, '/api/flags');
  assert.equal(calls[0].o.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].o.body), { rail: false });
  assert.deepEqual(calls.slice(1), ['reload']);
});

test('a failed opt-out names the failed step, does not reload, and leaves the page', async () => {
  for (const fetchImpl of [reply(false, { error: 'rail is locked by WORCA_FLAGS' }), async () => { throw new Error('down'); }]) {
    const { win, calls, toast } = load(['host-app.js', 'adapter.js'], { fetchImpl });
    const r = await win.RailHost.setStillhet(false);
    assert.equal(r.ok, false);
    assert.match(r.text, /^Could not turn Stillhet off: /);
    assert.equal(toast.textContent, r.text);
    assert.ok(toast.cls.has('is-on'), 'the sentence is shown, not only announced (the adapter toast\'s is-on)');
    assert.equal(calls.includes('reload'), false);
  }
});

// the top-bar switch (frame.js draws R.designSwitch) is the way back: a click on it runs setStillhet(false)
const switchStub = () => {
  const attrs = { 'aria-checked': 'true' };
  const b = { disabled: false, focused: 0, focus() { b.focused++; }, getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; } };
  return { b, attrs, target: { closest: (s) => (s === '[data-design-switch]' ? b : null) } };
};
const settle = () => new Promise((r) => setImmediate(r));

test('the top-bar switch: a click sends one PATCH { rail: false } and reloads; a click elsewhere does nothing', async () => {
  const { calls, click } = load('host-app.js', { fetchImpl: reply(true, { flags: [] }) });
  click({ closest: () => null });
  await settle();
  assert.equal(calls.length, 0);
  const sw = switchStub();
  click(sw.target);
  assert.equal(sw.attrs['aria-busy'], 'true');
  click(sw.target);   // a second click while the first is in flight sends nothing more
  await settle();
  assert.equal(calls.filter((c) => c !== 'reload').length, 1);
  assert.deepEqual(JSON.parse(calls[0].o.body), { rail: false });
  assert.deepEqual(calls.slice(1), ['reload']);
});

test('the top-bar switch: a failed opt-out keeps the switch on, clears busy, says why and can be tried again', async () => {
  const { calls, click, toast, doc } = load(['host-app.js', 'adapter.js'], { fetchImpl: reply(false, { error: 'rail is locked by WORCA_FLAGS' }) });
  const sw = switchStub();
  doc.activeElement = sw.b;   // focused before the click; Chromium blurs it on disable, so focus must come back
  click(sw.target);
  await settle();
  assert.equal(sw.attrs['aria-checked'], 'true');
  assert.equal('aria-busy' in sw.attrs, false);
  assert.equal(sw.b.disabled, false);
  assert.equal(sw.b.focused, 1);
  assert.equal(toast.textContent, 'Could not turn Stillhet off: rail is locked by WORCA_FLAGS');
  assert.ok(toast.cls.has('is-on'));
  assert.equal(calls.includes('reload'), false);
  click(sw.target);
  await settle();
  assert.equal(calls.length, 2);
});

test('prototype host: the switch reads on, and off with ?stillhet=off; setStillhet does nothing', () => {
  assert.equal(load('host-prototype.js').win.RailHost.stillhetOn(), true);
  const off = load('host-prototype.js', { search: '?stillhet=off' }).win.RailHost;
  assert.equal(off.stillhetOn(), false);
  assert.equal(off.setStillhet(true), undefined);
  assert.equal(off.name, 'prototype');
});

test('adapter: in the app host an action is refused with the one sentence, announced once, never "Would…"', () => {
  const { win, toast } = load('adapter.js', { host: { name: 'app' } });
  const a = win.RailAdapter;
  assert.equal(a.kind, 'demo');
  assert.deepEqual(JSON.parse(JSON.stringify(a.act('create-pr', {}))), { ok: false, text: 'Not connected to Worca yet.' });
  assert.equal(toast.textContent, 'Not connected to Worca yet.');
  assert.doesNotMatch(toast.textContent, /Would/);
});

test('adapter: a refused act sends nothing and touches only the toast; a second toast clears the first one\'s hide timer', () => {
  const { win, calls, toast, doc, ctx } = load('adapter.js', { host: { name: 'app' } });
  const timers = [], cleared = [], touched = [];
  ctx.setTimeout = (fn) => timers.push(fn); ctx.clearTimeout = (id) => cleared.push(id);
  for (const k of ['querySelectorAll', 'getElementById']) doc[k] = (s) => { touched.push(s); return k === 'querySelectorAll' ? [] : null; };
  win.RailAdapter.act('create-pr', {});
  assert.deepEqual(calls, [], 'no fetch, no reload');
  assert.deepEqual(touched, []);
  win.RailAdapter.toast('Could not turn Stillhet off');
  assert.deepEqual(cleared, [null, 1], 'each toast clears the hide timer before it');
  timers[2](); assert.equal(toast.cls.has('is-on'), false);
});

test('RailWould: the prototype host asks demo-actions.js for the sentence, the app host refuses with the one sentence', () => {
  const demo = load('demo/demo-actions.js').win.RailDemoActions;
  assert.equal(demo.would('open a terminal'), 'Would open a terminal');
  const proto = load('adapter.js', { host: { name: 'prototype' } }).win;
  proto.RailDemoActions = demo;
  assert.equal(proto.RailWould('open a terminal'), 'Would open a terminal');
  assert.equal(load('adapter.js', { host: { name: 'app' } }).win.RailWould('open a terminal'), 'Not connected to Worca yet.');
});

// The real scripts in a jsdom page shaped like shell.html, with a view's toast (the run board's, inside a hidden route)
// earlier in the document than the shell's. A failed opt-out must land in the shell's own toast, the one shown over the page.
test('jsdom: a failed opt-out (fetch rejected, or locked) shows its sentence in the shell\'s own toast, not a hidden view\'s', async () => {
  const { JSDOM } = await import('jsdom');
  const R = await import('../ui/public/design-system/components/index.mjs');
  const css = ['css/rail.css', 'shell/shell.css'].map((f) => readFileSync(new URL(f, DIR), 'utf8')).join('\n');
  for (const [name, fetchImpl, sentence] of [
    ['rejected', async () => { throw new TypeError('Failed to fetch'); }, 'Could not turn Stillhet off: the server did not answer.'],
    ['locked', reply(false, { error: '"rail" is locked by WORCA_FLAGS' }), 'Could not turn Stillhet off: "rail" is locked by WORCA_FLAGS'],
  ]) {
    const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body><div class="app" id="worca"></div>`
      + '<div class="pz-app rail-layer" id="app"></div></body></html>', { runScripts: 'outside-only', url: 'http://localhost/#chat' });
    const w = dom.window, d = w.document;
    w.RailUI = { ...R };
    w.fetch = fetchImpl;
    w.eval(readFileSync(new URL('host-app.js', DIR), 'utf8'));
    w.eval(readFileSync(new URL('adapter.js', DIR), 'utf8'));
    // drawn later, as the shell does: the run board with its own toast inside a hidden route, and the top-bar switch
    d.getElementById('app').innerHTML = `<section id="route-run" hidden><div class="rc">${R.toast({})}</div></section>`
      + `<header>${R.designSwitch({ on: true })}</header>`;
    const sw = d.querySelector('[data-design-switch]');
    sw.focus();
    sw.click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    const shown = [...d.querySelectorAll('.rc-toast')].filter((t) => t.textContent);
    assert.equal(shown.length, 1, `${name}: one toast speaks`);
    const t = shown[0];
    assert.equal(t.textContent, sentence, name);
    assert.equal(t.parentElement, d.body, `${name}: the shell's own toast, a direct child of body`);
    assert.ok(t.classList.contains('is-on'), name);
    assert.equal(t.closest('[hidden]'), null, `${name}: no hidden ancestor`);
    const cs = w.getComputedStyle(t);
    assert.equal(cs.position, 'fixed', `${name}: laid over the page`);
    assert.notEqual(cs.display, 'none', name);
    assert.equal(cs.opacity, '1', name);
    assert.equal(d.querySelector('.rc .rc-toast').textContent, '', `${name}: the hidden run board's toast stays empty`);
    assert.equal(sw.getAttribute('aria-checked'), 'true', `${name}: the switch stays on`);
    assert.equal(sw.disabled, false, name);
    assert.equal(d.activeElement, sw, `${name}: focus stays on the switch`);
    w.close();
  }
});
