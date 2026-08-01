// test/ui-projects-guardrails.test.mjs — jsdom tests for the Projects-view guardrails panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PRESETS = {
  permissive: { honorProjectSettings: true, envScrub: false, envAllowlist: [], protectedPaths: [], deny: [] },
  normal: {
    honorProjectSettings: true, envScrub: false, envAllowlist: [],
    protectedPaths: ['.env*', '*.pem'], deny: ['Bash(git push)', 'Bash(git push:*)'],
  },
  secure: {
    honorProjectSettings: true, envScrub: true, envAllowlist: [],
    protectedPaths: ['.env*', '*.pem', '**/secrets/**'], deny: ['Bash(git push)', 'Bash(git push:*)', 'Bash(curl)', 'Bash(curl:*)'],
  },
};
const LEVELS = ['permissive', 'normal', 'secure', 'custom'];
const PROJECTS = [{ name: 'alpha', path: '/tmp/alpha', exists: true }];

class WSStub {
  constructor() { this.readyState = 1; this.sent = []; this._listeners = {}; WSStub.last = this; }
  send() {} close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { (this._listeners.open || []).forEach((fn) => fn({})); }
}

async function boot({ guardrails, posts, fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.fetch = (url, opts) => {
    const u = String(url);
    // fetchHandler is the ONLY way to vary a response per-test: app.js calls bare
    // `fetch` (→ globalThis.fetch, copied by VALUE at boot), so reassigning
    // window.fetch AFTER boot changes nothing. A handler returning a truthy value
    // wins; returning undefined falls through to the defaults below.
    if (fetchHandler) { const r = fetchHandler(url, opts); if (r) return r; }
    if (u.includes('/api/config/guardrails') && opts?.method === 'POST') {
      const body = JSON.parse(opts.body);
      if (posts) posts.push(body);
      const level = body.guardrails.level;
      const custom = body.guardrails.custom ?? null;
      const effective = level === 'custom' ? custom : PRESETS[level];
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ guardrails: { level, custom, effective } }) });
    }
    if (u.includes('/api/config?') || u.endsWith('/api/config')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        config: { steps: {}, customModels: [], guardrails: guardrails
          || { level: 'permissive', custom: null, effective: PRESETS.permissive } },
        models: [], efforts: [], steps: [],
        guardrailPresets: PRESETS, guardrailLevels: LEVELS,
      }) });
    }
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    if (u.includes('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: [], channels: [] }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (WSStub.last) WSStub.last._open();
  return { window };
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));

async function openProjects(window) {
  window.location.hash = 'projects';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick();
}

test('project row expands to a guardrails panel; level seg painted from the fetched config', async () => {
  const { window } = await boot();
  await openProjects(window);
  const doc = window.document;
  const item = doc.querySelector('#projects-list .pl-item[data-name="alpha"]');
  assert.ok(item, 'project row rendered');
  assert.ok(item.querySelector('.pl-caret'), 'caret present');
  click(window, item.querySelector('.pl-row'));
  await tick(); await tick();                                   // lazy fetch + render
  assert.ok(item.classList.contains('open'), 'accordion opened');
  const seg = item.querySelector('.gr-preset');
  assert.ok(seg, 'level selector rendered');
  const on = seg.querySelector('button.on');
  assert.equal(on.dataset.preset, 'permissive', 'unset project paints Permissive (reflects reality)');
  assert.equal(item.querySelector('.gr-save').disabled, true, 'Save disabled while clean');
  // delete button still works (caret must not swallow the delegated router)
  assert.ok(item.querySelector('.proj-del'), 'delete button intact');
});

test('stored custom project paints Custom seg + its rows', async () => {
  const custom = {
    honorProjectSettings: false, envScrub: true, envAllowlist: ['NPM_TOKEN'],
    protectedPaths: ['*.sqlite'], deny: ['Bash(curl:*)'],
  };
  const { window } = await boot({ guardrails: { level: 'custom', custom, effective: custom } });
  await openProjects(window);
  const item = window.document.querySelector('#projects-list .pl-item[data-name="alpha"]');
  click(window, item.querySelector('.pl-row'));
  await tick(); await tick();
  assert.equal(item.querySelector('.gr-preset button.on').dataset.preset, 'custom');
  assert.equal(item.querySelector('.gr-scrub').classList.contains('on'), true, 'scrub switch on');
  assert.equal(item.querySelector('.gr-honor').classList.contains('on'), false, 'honor switch off');
  const denyRows = [...item.querySelectorAll('.gr-deny .gr-row .mono')].map((n) => n.textContent);
  assert.deepEqual(denyRows, ['Bash(curl:*)']);
  const allowRows = [...item.querySelectorAll('.gr-allow .gr-row .mono')].map((n) => n.textContent);
  assert.deepEqual(allowRows, ['NPM_TOKEN']);
});

test('expanded state survives a full list re-render (WebSocket projects-changed path)', async () => {
  const { window } = await boot();
  await openProjects(window);
  const doc = window.document;
  let item = doc.querySelector('#projects-list .pl-item[data-name="alpha"]');
  click(window, item.querySelector('.pl-row'));
  await tick(); await tick();
  window.__projects.renderProjectsList();                        // simulate the rebuild
  await tick();
  item = doc.querySelector('#projects-list .pl-item[data-name="alpha"]');
  assert.ok(item.classList.contains('open'), 'row still open after rebuild');
  assert.ok(item.querySelector('.gr-preset'), 'panel re-rendered from grState, no refetch needed');
});
