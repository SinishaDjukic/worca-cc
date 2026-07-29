// test/ui-subagent-log.test.mjs — end-to-end jsdom round-trip of the `sub` flag
// (WS frame → record → DOM .log-line.sub-agent). Mirrors test/ui-cost.test.mjs's
// boot harness, plus a WebSocket stub that captures its instance and exposes
// recv() to inject frames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url) => String(url).includes('/api/projects')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const selectProject = () => { const s = window.document.querySelector('#projectSelect'); s.value = PROJECT; s.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  return { window, selectProject, recv };
}

test('a log frame with sub:true renders a .log-line.sub-agent; a main line does not', async () => {
  const ctx = await boot();
  ctx.selectProject();
  ctx.window.location.hash = 'running';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  ctx.recv({ type: 'phase', runId: 'p1', phase: 'plan', cycle: 0 });  // mounts the card
  ctx.recv({ type: 'log', runId: 'p1', source: 'planner ▸ research auth', level: 'info', text: 'hi', sub: true });
  await new Promise((r) => setTimeout(r, 0));
  const card = ctx.window.document.querySelector('[data-run-id="p1"]');
  assert.ok(card.querySelector('.log-line.sub-agent'), 'sub-agent line is styled');
  ctx.recv({ type: 'log', runId: 'p1', source: 'planner', level: 'info', text: 'main', sub: false });
  await new Promise((r) => setTimeout(r, 0));
  const plain = [...card.querySelectorAll('.log-line')].find((n) => n.textContent.includes('main'));
  assert.ok(!plain.classList.contains('sub-agent'), 'main line is not styled');
});
