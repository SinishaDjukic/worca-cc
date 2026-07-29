import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '../ui/public/index.html');
const appPath = join(here, '../ui/public/app.js');

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; } send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { np: window.__np, document: window.document };
}

test('buildRunGraph uses cell.label for the column tag when present', async () => {
  const { np, document } = await boot();
  const host = document.createElement('div');
  const manifest = {
    version: 1,
    steps: [
      { kind: 'agents', label: 'Phase 1', nodes: [{ id: 's_impl_p1_t1', label: 'Slice one' }, { id: 's_impl_p1_t2', label: 'Slice two' }] },
      { kind: 'agents', nodes: [{ id: 's3_0', label: 'Review' }] },
    ],
    feedbacks: [],
  };
  np.buildRunGraph(host, manifest);
  const tags = [...host.querySelectorAll('.col-tag')].map((t) => t.textContent);
  assert.ok(tags[0].startsWith('Phase 1'));
  assert.ok(tags[1].startsWith('Step 2')); // unlabeled cell keeps the Step N default
});
