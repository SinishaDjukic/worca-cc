// test/ui-source-pane-mount.test.mjs — app.js's mountPluginSourcePane error
// path: a FAILED binding resolve (server unreachable mid project switch) must
// tear down the previous scope's pane instead of leaving its task list and
// resolved profile live — a submit would otherwise run the new project against
// the old project's tracker, the exact mistake bindings exist to prevent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const SOURCES = { sources: [
  { type: 'prompt', displayName: 'Prompt' },
  { type: 'markdown', displayName: 'Markdown' },
  {
    type: 'plugin', plugin: 'jira', sourceId: 'jira', displayName: 'Jira',
    multiProfile: true,
    profiles: [{ id: 'acme', label: 'Acme' }, { id: 'globex', label: 'Globex' }],
    inputs: [{ key: 'task', type: 'task-browser', label: 'Task', options: [], optionsFrom: null, default: null }],
  },
] };

const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

// Boot app.js in jsdom with a controllable fetch (mirrors newpipeline-config.test.mjs).
async function boot(handlers) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4319/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  window.fetch = (url, opts) => {
    const u = String(url);
    for (const [prefix, fn] of Object.entries(handlers)) {
      if (u.includes(prefix)) return fn(u, opts || {});
    }
    if (u.includes('/api/projects')) {
      return json({ projects: [
        { name: 'alpha', path: '/tmp/alpha', exists: true },
        { name: 'beta', path: '/tmp/beta', exists: true },
      ] });
    }
    if (u.includes('/api/sources') && !u.includes('/call')) return json(SOURCES);
    if (u.includes('/api/workflows')) return json({ workflows: [] });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'HTMLInputElement', 'HTMLSelectElement']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

async function waitFor(fn, what, { timeoutMs = 3000, everyMs = 10 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

test('a failed profile resolve on project switch clears the stale pane and offers a retry', async () => {
  let bindingsMode = 'ok';
  const { window } = await boot({
    '/api/source-bindings': () => {
      if (bindingsMode === 'fail') return Promise.reject(new TypeError('fetch failed'));
      return json({ scopeType: 'project', scopeKey: 'k', profile: 'acme', via: 'binding' });
    },
    '/api/sources/call': (u, opts) => {
      const body = JSON.parse(opts.body || '{}');
      if (body.op === 'validateConfig') return json({ ok: true, result: { ok: true } });
      if (body.op === 'listTasks') {
        return json({ ok: true, result: { tasks: [
          { id: 'A-1', title: 'Alpha task', state: 'open', labels: [], updatedAt: '' },
        ] } });
      }
      return json({ ok: true, result: null });
    },
  });
  const doc = window.document;

  // Select a project, then the plugin source: the pane mounts fully.
  const projectSelect = doc.querySelector('#projectSelect');
  projectSelect.value = '/tmp/alpha';
  projectSelect.dispatchEvent(new window.Event('change'));
  const srcBtn = await waitFor(() => doc.querySelector('#source-seg button[data-plugin-src="jira/jira"]'), 'plugin source button');
  srcBtn.click();
  const pane = doc.querySelector('#plugin-source-pane');
  await waitFor(() => pane.querySelector('.sp-task-browser'), 'mounted task browser');
  await waitFor(() => pane.querySelector('.sp-row'), 'the initial task listing');
  assert.match(pane.textContent, /Alpha task/);
  assert.equal(pane.querySelector('.sp-profile-bar').dataset.profile, 'acme');

  // Switch projects while the server is unreachable: the resolve rejects.
  bindingsMode = 'fail';
  projectSelect.value = '/tmp/beta';
  projectSelect.dispatchEvent(new window.Event('change'));
  await waitFor(() => /Could not resolve the source profile/.test(pane.textContent), 'the resolve-failure notice');
  // Nothing of the previous project's pane survives — no task rows to submit,
  // no profile bar claiming the old binding still applies.
  assert.equal(pane.querySelector('.sp-row'), null, 'stale task list torn down');
  assert.equal(pane.querySelector('.sp-profile-bar'), null, 'stale profile bar torn down');
  const retry = pane.querySelector('button');
  assert.match(retry.textContent, /Retry/);

  // The server comes back; Retry remounts against the NEW scope.
  bindingsMode = 'ok';
  retry.click();
  await waitFor(() => pane.querySelector('.sp-task-browser'), 'remounted task browser');
  assert.equal(pane.querySelector('.sp-profile-bar').dataset.profile, 'acme');
});

test('the old pane is torn down SYNCHRONOUSLY on remount — nothing submittable while the binding fetch is in flight', async () => {
  // The window between "project switched" and "binding resolved" must not keep
  // the previous project's task list, picked task and profile live: a Start
  // clicked in that window would run the new project against the old project's
  // tracker. The fetch here never resolves, so anything still visible IS the
  // stale-window content.
  let bindingsMode = 'ok';
  const { window } = await boot({
    '/api/source-bindings': () => {
      if (bindingsMode === 'hang') return new Promise(() => {});
      return json({ scopeType: 'project', scopeKey: 'k', profile: 'acme', via: 'binding' });
    },
    '/api/sources/call': (u, opts) => {
      const body = JSON.parse(opts.body || '{}');
      if (body.op === 'validateConfig') return json({ ok: true, result: { ok: true } });
      if (body.op === 'listTasks') {
        return json({ ok: true, result: { tasks: [
          { id: 'A-1', title: 'Alpha task', state: 'open', labels: [], updatedAt: '' },
        ] } });
      }
      return json({ ok: true, result: null });
    },
  });
  const doc = window.document;

  const projectSelect = doc.querySelector('#projectSelect');
  projectSelect.value = '/tmp/alpha';
  projectSelect.dispatchEvent(new window.Event('change'));
  const srcBtn = await waitFor(() => doc.querySelector('#source-seg button[data-plugin-src="jira/jira"]'), 'plugin source button');
  srcBtn.click();
  const pane = doc.querySelector('#plugin-source-pane');
  await waitFor(() => pane.querySelector('.sp-row'), 'the initial task listing');

  // Switch projects with the binding fetch hung: the pane must empty NOW.
  bindingsMode = 'hang';
  projectSelect.value = '/tmp/beta';
  projectSelect.dispatchEvent(new window.Event('change'));
  await waitFor(() => /Checking/.test(pane.textContent) && !pane.querySelector('.sp-row'),
    'the placeholder replacing the stale pane');
  assert.equal(pane.querySelector('.sp-row'), null, 'no stale task row to submit');
  assert.equal(pane.querySelector('.sp-profile-bar'), null, 'no stale profile bar');
  // …and it STAYS empty while the fetch hangs (nothing repaints the old pane).
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(pane.querySelector('.sp-row'), null);
});

test('an HTTP failure on the binding GET offers a retry — never the first-time gate', async () => {
  // ok:false (a transient 500) is not "no binding": rendering the gate would
  // invite the user to overwrite a correct standing binding. Only a real
  // "unbound" answer may gate.
  let bindingsMode = 'ok';
  const { window } = await boot({
    '/api/source-bindings': () => {
      if (bindingsMode === '500') {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'db locked' }) });
      }
      return json({ scopeType: 'project', scopeKey: 'k', profile: 'acme', via: 'binding' });
    },
    '/api/sources/call': (u, opts) => {
      const body = JSON.parse(opts.body || '{}');
      if (body.op === 'validateConfig') return json({ ok: true, result: { ok: true } });
      if (body.op === 'listTasks') return json({ ok: true, result: { tasks: [] } });
      return json({ ok: true, result: null });
    },
  });
  const doc = window.document;

  const projectSelect = doc.querySelector('#projectSelect');
  projectSelect.value = '/tmp/alpha';
  projectSelect.dispatchEvent(new window.Event('change'));
  const srcBtn = await waitFor(() => doc.querySelector('#source-seg button[data-plugin-src="jira/jira"]'), 'plugin source button');
  bindingsMode = '500';
  srcBtn.click();
  const pane = doc.querySelector('#plugin-source-pane');
  await waitFor(() => /Could not resolve the source profile/.test(pane.textContent), 'the resolve-failure notice');
  assert.match(pane.textContent, /db locked/, 'the server error is surfaced');
  assert.equal(pane.querySelector('.sp-profile-gate'), null, 'no gate on an HTTP failure');
  assert.equal(pane.querySelector('.sp-profile-use'), null);

  // The server recovers: Retry lands on the STANDING binding, no gate involved.
  bindingsMode = 'ok';
  const retry = pane.querySelector('button');
  assert.match(retry.textContent, /Retry/);
  retry.click();
  await waitFor(() => pane.querySelector('.sp-profile-bar'), 'the pane on the standing binding');
  assert.equal(pane.querySelector('.sp-profile-bar').dataset.profile, 'acme');
});
