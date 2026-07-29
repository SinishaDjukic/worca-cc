import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '../ui/public/index.html');
const appPath = join(here, '../ui/public/app.js');

// Mirror test/ui-hello-stepper-seed.test.mjs:11-29 (no shared helper exists).
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
  return { np: window.__np, window };
}

test('manifestSig changes when node ids change', async () => {
  const { np } = await boot();
  const a = { steps: [{ nodes: [{ id: 's2_0' }] }] };
  const b = { steps: [{ nodes: [{ id: 's_impl_p1_t1' }, { id: 's_impl_p1_t2' }] }] };
  assert.notEqual(np.manifestSig(a), np.manifestSig(b));
  assert.equal(np.manifestSig(a), np.manifestSig({ steps: [{ nodes: [{ id: 's2_0' }] }] }));
});

test('onState swaps the manifest when the signature changes', async () => {
  const { np } = await boot();
  // makeRun({...}) takes an OPTIONS OBJECT (app.js:668) and returns a COMPLETE run
  // object. onState calls paintRunCard + maybeResume unconditionally; both no-op when
  // r.el == null, so a full run object with el=null is safe for this unit test.
  const r = np.makeRun({ runId: 'rid' });
  r.stepper = { steps: [{ nodes: [{ id: 's2_0', key: 'implementer' }] }] };
  r.el = null; // no DOM card in this unit test; swap should still update r.stepper
  np.onState(r, { stepper: { steps: [{ nodes: [{ id: 's_impl_p1_t1' }] }] }, status: 'running' });
  assert.deepEqual(r.stepper.steps[0].nodes.map((n) => n.id), ['s_impl_p1_t1']);
});
