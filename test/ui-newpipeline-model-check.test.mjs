// test/ui-newpipeline-model-check.test.mjs
// New pipeline › the pre-run model check's warning line (#newModelNote, GET /api/run/model-check).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const tick = (n = 3) => new Promise((r) => setTimeout(r, n));
const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

const WF_DEFAULT = {
  id: 'wf_default', name: 'Default',
  steps: [[{ id: 's_clarify', key: 'clarify' }], [{ id: 's0_0', key: 'planner' }], [{ id: 's3_0', key: 'reviewer' }]],
  feedbacks: [],
};
const AGENTS = [
  { key: 'planner', displayName: 'Plan', color: 'violet', order: 1 },
  { key: 'reviewer', displayName: 'Review', color: 'blue', order: 4 },
];
const PROBLEM = { model: 'gw-gpt', provider: 'openai', nodes: ['Implement'], message: 'provider openai: no API key — open Settings › Providers', fix: 'add an API key for openai in Settings › Providers' };

async function boot(check) {
  const calls = [];
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.requestAnimationFrame = globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/run/model-check')) { calls.push(u); return json(check()); }
    if (u.includes('/api/projects')) return json({ projects: [{ name: 'proj', key: 'proj-abcd1234', path: '/tmp/proj', exists: true }] });
    if (u.endsWith('/api/workflows')) return json({ workflows: [WF_DEFAULT] });
    if (u.match(/\/api\/workflows\/wf_default$/)) return json(WF_DEFAULT);
    if (u.includes('/api/guardrails')) return json({ guardrails: [{ id: 'permissive', name: 'Permissive', settings: null }] });
    if (u.includes('/api/agents')) return json({ agents: AGENTS, channels: [] });
    if (u.includes('/api/plugins')) return json({ plugins: [] });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'HTMLInputElement', 'HTMLSelectElement']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick(10);
  return { window, calls };
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  return tick(220);   // past schedulePolicyLine's 150 ms debounce
}

test('picking a workflow whose models are unavailable un-hides #newModelNote with the text', async () => {
  let answer = { ok: false, problems: [PROBLEM], warnings: [], checked: [] };
  const { window, calls } = await boot(() => answer);
  await go(window, 'new');
  const sel = window.document.getElementById('projectSelect');
  sel.value = '/tmp/proj';
  sel.dispatchEvent(new window.Event('change'));
  await tick(220);   // past schedulePolicyLine's 150 ms debounce
  const note = window.document.getElementById('newModelNote');
  assert.ok(calls.some((u) => /scope=project%3Aproj-abcd1234/.test(u) && /workflowId=wf_default/.test(u)), calls.join('\n'));
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /^This run can't start yet: gw-gpt \(Implement\) — provider openai: no API key/);

  answer = { ok: true, problems: [], warnings: [], checked: [] };   // the key was added: the next selection clears it
  await go(window, 'history');
  await go(window, 'new');
  assert.equal(note.hidden, true);
  assert.equal(note.textContent, '');
});
