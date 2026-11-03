// test/requirements-view-speed.test.mjs — the Requirements page asks for what it needs at once, not one call after another
// (jsdom, a fake API whose answers are held until the test lets them go). No server, no tracker.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#requirements' });
for (const k of ['document', 'location', 'Event', 'KeyboardEvent', 'HTMLElement', 'window']) {
  Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 12; i += 1) await tick(); };
after(() => window.close());
const { createRequirementsView } = await import('../ui/public/requirements-view.mjs');

/** A held answer: `gate.release()` lets it go. */
const gate = () => { let release; const p = new Promise((r) => { release = r; }); return { p, release }; };

/** Routes: `METHOD url` → a value, a function (body) → value, or { hold: gate, value } (answers after the gate is released).
 *  `calls` records every request in the order it started. */
function fakeApi(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, url, body });
    let hit = routes[`${method} ${url}`];
    if (hit && hit.hold) { await hit.hold.p; hit = hit.value; }
    const out = typeof hit === 'function' ? await hit(body) : hit;
    const status = out !== undefined ? 200 : 404;
    return { ok: status < 400, status, json: async () => out ?? { error: 'not found' }, text: async () => '' };
  };
  return calls;
}
const started = (calls, method, url) => calls.filter((c) => c.method === method && c.url === url).length;
const PROJECTS = { projects: [{ key: 'shop-1', name: 'shop' }] };
const LIST = { features: [], interview: { label: 'Opus', effort: 'high' }, lookCostUsd: 0.3, briefs: [], readEstimates: {} };
const make = () => {
  const host = document.createElement('div'); const msgEl = document.createElement('p'); const subEl = document.createElement('div');
  document.body.replaceChildren(host);
  const view = createRequirementsView({ host, subEl, msgEl, deps: { route: () => {} } });
  return { host, view };
};

test('the list asks for projects, workspaces and the features together, not one after the other', async () => {
  const held = gate();
  const calls = fakeApi({ 'GET /api/projects': { hold: held, value: PROJECTS }, 'GET /api/workspaces': { workspaces: [] }, 'GET /api/requirements': LIST });
  const m = make();
  const shown = m.view.show('');
  await settle();
  assert.equal(started(calls, 'GET', '/api/requirements'), 1, 'the features call started while /api/projects was still held');
  held.release();
  await shown;
  await settle();
  m.view.destroy();
});

test('New feature draws its form without waiting for the feature list, then fills in the hint when the list arrives', async () => {
  const held = gate();
  const calls = fakeApi({ 'GET /api/projects': PROJECTS, 'GET /api/workspaces': { workspaces: [] }, 'GET /api/requirements': { hold: held, value: LIST } });
  const m = make();
  void m.view.show('new');
  await settle();
  assert.ok(m.host.querySelector('#req-new-title'), 'the form is there while the list is held');
  assert.equal(m.host.querySelector('.req-new-model'), null, 'no interview line yet');
  assert.equal(started(calls, 'GET', '/api/requirements'), 1);
  const typed = m.host.querySelector('#req-new-title');
  typed.value = 'My title';
  held.release();
  await settle();
  assert.equal(m.host.querySelector('#req-new-title'), typed, 'the same form, not a rebuilt one');
  assert.equal(typed.value, 'My title');
  assert.match(m.host.querySelector('.req-new-model').textContent, /Worca interviews with Opus at high effort/);
  assert.match(m.host.querySelector('.req-new-cost').textContent, /\$0\.30 for the code look/);
  assert.match(m.host.querySelector('#req-new-files-privacy').textContent, /sends each file to Opus/);
  m.view.destroy();
});

test('New feature: a brief that arrives with the list turns the look line into the brief line', async () => {
  const held = gate();
  const brief = { scopeType: 'project', scopeKey: 'shop-1', madeAt: new Date().toISOString(), lookAtCode: true };
  fakeApi({ 'GET /api/projects': PROJECTS, 'GET /api/workspaces': { workspaces: [] }, 'GET /api/requirements': { hold: held, value: { ...LIST, briefs: [brief] } } });
  const m = make();
  void m.view.show('new');
  await settle();
  assert.equal(m.host.querySelector('.req-brief-line'), null);
  held.release();
  await settle();
  assert.ok(m.host.querySelector('.req-brief-line'), 'the green line for the target with a brief');
  m.view.destroy();
});

test('New feature still draws when the feature list cannot be read', async () => {
  fakeApi({ 'GET /api/projects': PROJECTS, 'GET /api/workspaces': { workspaces: [] } });
  const m = make();
  await m.view.show('new');
  await settle();
  assert.ok(m.host.querySelector('#req-new-title'));
  m.view.destroy();
});

test('a live repaint keeps the projects and workspaces it has; a project change tells the view to ask again', async () => {
  const calls = fakeApi({ 'GET /api/projects': PROJECTS, 'GET /api/workspaces': { workspaces: [] }, 'GET /api/requirements': LIST });
  const m = make();
  await m.view.show('');
  await settle();
  await m.view.changed(undefined, undefined);
  await m.view.changed(undefined, undefined);
  await settle();
  assert.equal(started(calls, 'GET', '/api/projects'), 1, 'three paints, one projects call');
  assert.equal(started(calls, 'GET', '/api/workspaces'), 1);
  assert.equal(started(calls, 'GET', '/api/requirements'), 3);
  m.view.targetsChanged();
  await m.view.changed(undefined, undefined);
  await settle();
  assert.equal(started(calls, 'GET', '/api/projects'), 2, 'asked again after a projects-changed frame');
  m.view.destroy();
});
