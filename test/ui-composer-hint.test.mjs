import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '../ui/public/index.html');
const appPath = join(here, '../ui/public/app.js');

async function bootComposer() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/#composer' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  // jsdom lacks requestAnimationFrame; composerRefresh() (called during the
  // #composer boot via initComposer) dereferences it. Match the sibling
  // composer DOM tests (ui-composer.test.mjs) and stub it before boot.
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; } send() {} close() {} addEventListener() {} };
  window.fetch = (url) => String(url).includes('/api/agents')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: [] }) })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], workflows: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { np: window.__np, document: window.document };
}

test('composer hint shows only when a decomposer node is in the pipeline', async () => {
  const { np, document } = await bootComposer();
  const hint = document.getElementById('composer-decomposer-hint');
  assert.ok(hint, '#composer-decomposer-hint must exist');

  // composerRefresh() reads composer.els.flow. Wire it to the real canvas element
  // so the call renders instead of throwing (composer.steps shape is Array<Array<{id,key}>>).
  np.composer.els = np.composer.els || {};
  np.composer.els.flow = np.composer.els.flow || document.getElementById('composer-flow');

  np.composer.steps = [[{ id: 'n1', key: 'planner' }], [{ id: 'n2', key: 'implementer' }]];
  np.composerRefresh();
  assert.equal(hint.hidden, true);

  np.composer.steps = [[{ id: 'n1', key: 'decomposer' }], [{ id: 'n2', key: 'implementer' }]];
  np.composerRefresh();
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /implementer.*per task/i);
});
