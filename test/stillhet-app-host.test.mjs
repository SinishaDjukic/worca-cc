// test/stillhet-app-host.test.mjs — host-app.js (the opt-out inside Stillhet), host-prototype.js and adapter.js, run in a vm
// with a small DOM stub: the files are classic scripts that set window.RailHost / window.RailAdapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const DIR = new URL('../ui/public/stillhet/', import.meta.url);
const load = (file, { fetchImpl, search = '', host, adapter = '', fields = [] } = {}) => {
  const calls = [], cls = new Set(), toast = { textContent: '', cls, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) } }, listeners = [];
  const win = { RailHost: host };
  const ctx = {
    window: win, fetch: async (u, o) => { calls.push({ u, o }); return fetchImpl(u, o); }, setTimeout: () => 0, clearTimeout: () => {},
    location: { search, reload: () => calls.push('reload') }, URLSearchParams, JSON,
    matchMedia: () => ({ matches: false }),
    document: {
      activeElement: null,
      querySelector: (s) => (s === '.rc-toast' ? toast : null), querySelectorAll: () => fields, getElementById: () => null,
      documentElement: { getAttribute: (k) => (k === 'data-adapter' ? adapter || null : null) },
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

test('"Try Stillhet" while in Stillhet (rail moved off elsewhere): rail back on, no reload; a failure says "on"', async () => {
  const { win, calls } = load('host-app.js', { fetchImpl: reply(true, { flags: [] }) });
  win.RailHost.flagsChanged({ rail: false });
  assert.equal(win.RailHost.stillhetOn(), false);
  calls.length = 0;
  assert.deepEqual({ ...(await win.RailHost.setStillhet(true)) }, { ok: true });
  assert.deepEqual(JSON.parse(calls[0].o.body), { rail: true });
  assert.equal(calls.includes('reload'), false);
  assert.equal(win.RailHost.stillhetOn(), true);
  const failed = load(['host-app.js', 'adapter.js'], { fetchImpl: reply(false, { error: 'locked' }) });
  const r = await failed.win.RailHost.setStillhet(true);
  assert.equal(r.text, 'Could not turn Stillhet on: locked');
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

// the top-bar icon (frame.js draws R.stillhetSwitch and installs its watch) is the way back: "Back to today's UI" runs
// setStillhet(false). The real scripts in jsdom, in boot.js's order.
const settle = () => new Promise((r) => setImmediate(r));
async function iconHost(t, fetch) {
  const { stillhetHost } = await import('./helpers/stillhet-host.mjs');
  const w = stillhetHost({ after: (fn) => t.after(fn), fetch });
  const d = w.document;
  return { w, d, icon: () => d.querySelector('[data-stillhet="ui-icon"]'), rows: () => [...d.querySelectorAll('[data-design-pick]')], slot: () => d.querySelector('[data-stillhet="design-switch"]') };
}
const writes = (calls) => calls.filter(([m]) => m !== 'GET');

test('the top-bar icon: "Back to today\'s UI" sends one PATCH { rail: false }, busy while it is out; the checked row and a busy click send nothing', async (t) => {
  const calls = [];
  const { d, icon, rows } = await iconHost(t, async (u, o = {}) => { calls.push([o.method || 'GET', String(u), o.body]); if (o.method === 'PATCH') return new Promise(() => {}); return { ok: false, json: async () => ({}) }; });
  d.body.click();
  icon().click();
  assert.deepEqual(rows().map((r) => [r.textContent, r.getAttribute('aria-checked')]), [['Try Stillhet', 'true'], ["Back to today's UI", 'false']]);
  rows()[0].click();   // the current UI: it only closes
  assert.equal(rows().length, 0);
  await settle();
  assert.deepEqual(writes(calls), []);
  icon().click();
  rows()[1].click();
  assert.equal(icon().getAttribute('aria-busy'), 'true');
  icon().click();   // a second click while the first is in flight sends nothing more
  await settle();
  assert.deepEqual(writes(calls).map(([m, u, b]) => [m, u, JSON.parse(b)]), [['PATCH', '/api/flags', { rail: false }]]);
});

test('the top-bar icon: a failed opt-out keeps Stillhet checked, clears busy, refocuses the icon, says why and can be tried again', async (t) => {
  const calls = [];
  const { w, d, icon, rows, slot } = await iconHost(t, async (u, o = {}) => { calls.push([o.method || 'GET', String(u)]); return o.method === 'PATCH' ? { ok: false, json: async () => ({ error: 'rail is locked by WORCA_FLAGS' }) } : { ok: false, json: async () => ({}) }; });
  icon().focus();
  icon().click();
  rows()[1].click();
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(slot().dataset.on, 'true');
  assert.equal(icon().hasAttribute('aria-busy'), false);
  assert.equal(icon().hasAttribute('aria-disabled'), false);
  assert.equal(d.activeElement, icon());
  assert.equal(w.RailHost.toastEl.textContent, 'Could not turn Stillhet off: rail is locked by WORCA_FLAGS', 'the shell\'s own toast');
  icon().click();
  rows()[1].click();
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(writes(calls).length, 2);
});

test('prototype host: Stillhet reads on, and off with ?stillhet=off; setStillhet moves it and reloads nothing', () => {
  assert.equal(load('host-prototype.js').win.RailHost.stillhetOn(), true);
  const { win, calls } = load('host-prototype.js', { search: '?stillhet=off' }), off = win.RailHost;
  assert.equal(off.stillhetOn(), false);
  assert.deepEqual({ ...off.setStillhet(true) }, { ok: true });
  assert.equal(off.stillhetOn(), true);
  assert.equal(off.name, 'prototype');
  assert.deepEqual(calls, []);
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
    for (const f of ['host-app.js', 'adapter.js', 'shell/frame.js']) w.eval(readFileSync(new URL(f, DIR), 'utf8'));
    // drawn later, as the shell does: the run board with its own toast inside a hidden route, and the top-bar icon
    d.getElementById('app').innerHTML = `<section id="route-run" hidden><div class="rc">${R.toast({})}</div></section>`
      + `<header>${R.stillhetSwitch({ on: true })}</header>`;
    const sw = () => d.querySelector('[data-stillhet="ui-icon"]');
    sw().focus();
    sw().click();
    d.querySelector('[data-design-pick="off"]').click();
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
    assert.equal(d.querySelector('[data-stillhet="design-switch"]').dataset.on, 'true', `${name}: Stillhet stays checked`);
    assert.equal(sw().hasAttribute('aria-busy'), false, name);
    assert.equal(d.activeElement, sw(), `${name}: focus stays on the icon`);
    w.close();
  }
});

test('adapter: the shell\'s stamp picks the kind, never the address: live with data-adapter="live" even with ?state=empty', () => {
  assert.equal(load('adapter.js', { host: { name: 'app' }, adapter: 'live', search: '?state=empty' }).win.RailAdapter.kind, 'live');
  assert.equal(load('adapter.js', { host: { name: 'app' }, adapter: 'demo' }).win.RailAdapter.kind, 'demo');
  assert.equal(load('adapter.js', { host: { name: 'prototype' }, adapter: 'live' }).win.RailAdapter.kind, 'demo', 'the prototype is always demo');
});

test('one reload owner: the icon\'s pick and a flags frame with rail off reload exactly once; the only write is PATCH /api/flags', async () => {
  const { win, calls } = load('host-app.js', { fetchImpl: reply(true, { flags: [] }) });
  win.RailHost.setStillhet(false);   // what frame.js's watch calls on "Back to today's UI"
  win.RailHost.flagsChanged({ rail: false });
  await settle();
  win.RailHost.flagsChanged({ rail: false });
  assert.deepEqual(calls.filter((c) => c === 'reload'), ['reload']);
  const writes = calls.filter((c) => c !== 'reload' && c.o && c.o.method && c.o.method !== 'GET');
  assert.deepEqual(writes.map((c) => [c.o.method, c.u]), [['PATCH', '/api/flags']]);
  assert.equal(win.RailHost.stillhetOn(), false, 'the live flag: the icon\'s menu checks "Back to today\'s UI" until the reload lands');
  win.RailHost.flagsChanged({ rail: true });
  assert.equal(win.RailHost.stillhetOn(), true);
  assert.equal(calls.filter((c) => c === 'reload').length, 1);
});

test('a flags frame with rail off waits while text is typed, says so once, and reloads once the text is gone', () => {
  const field = { value: 'half a sentence', defaultValue: '', getAttribute: () => null, closest: () => null };
  const { win, calls, toast } = load(['host-app.js', 'adapter.js'], { fetchImpl: reply(true, {}), fields: [field] });
  win.RailHost.flagsChanged({ rail: false });
  win.RailHost.flagsChanged({ rail: false });
  assert.equal(calls.includes('reload'), false);
  assert.equal(toast.textContent, 'Stillhet is off.');
  toast.textContent = '';
  win.RailHost.flagsChanged({ rail: false });
  assert.equal(toast.textContent, '', 'said once');
  field.value = '';
  win.RailHost.flagsChanged({ rail: false });
  assert.deepEqual(calls, ['reload']);
});

test('jsdom: rail locked by WORCA_FLAGS: the tip and both rows say why; a pick sends nothing and shows no toast', async () => {
  const { stillhetHost } = await import('./helpers/stillhet-host.mjs');
  const { after } = await import('node:test');
  const calls = [];
  const w = stillhetHost({ railLocked: true, after, fetch: async (u, o = {}) => { calls.push([o.method || 'GET', String(u)]); return { ok: false, status: 500, json: async () => ({}) }; } });
  const d = w.document, icon = d.querySelector('[data-stillhet="ui-icon"]');
  assert.ok(icon, 'the icon is drawn');
  assert.ok(icon.getAttribute('aria-label').endsWith(' · Locked by WORCA_FLAGS'));
  assert.ok((icon.getAttribute('title') || icon.getAttribute('data-tip-text') || '').endsWith(' · Locked by WORCA_FLAGS'));
  icon.click();
  const rows = [...d.querySelectorAll('[data-design-pick]')];
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.getAttribute('aria-disabled') === 'true' && r.getAttribute('title') === 'Locked by WORCA_FLAGS'));
  assert.equal(rows[0].getAttribute('aria-checked'), 'true', 'it still says Stillhet is on');
  rows[1].click();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls.filter(([m]) => m !== 'GET'), [], 'no PATCH /api/flags');
  const said = [...d.querySelectorAll('body > .rc-toast')].map((x) => x.textContent).filter(Boolean);
  assert.ok(said.every((x) => x === 'Locked by WORCA_FLAGS'), `a disabled row only says why, nothing failed: ${said}`);
  assert.equal(w.RailHost.railLocked(), true);
});
