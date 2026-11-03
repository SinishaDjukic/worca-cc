import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const here = dirname(fileURLToPath(import.meta.url));
const appPath = join(here, '../ui/public/app.js');

// Mirror test/ui-hello-stepper-seed.test.mjs:11-29 (no shared helper exists).
async function boot() {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; } send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { np: window.__np, window };
}

test('onState swaps the stepper manifest exactly when manifestSig (node ids) changes', async () => {
  const { np } = await boot();
  await checkRows([
    { name: 'manifestSig changes when node ids change', run: async () => {
      const a = { steps: [{ nodes: [{ id: 's2_0' }] }] };
      const b = { steps: [{ nodes: [{ id: 's_impl_p1_t1' }, { id: 's_impl_p1_t2' }] }] };
      assert.notEqual(np.manifestSig(a), np.manifestSig(b));
      assert.equal(np.manifestSig(a), np.manifestSig({ steps: [{ nodes: [{ id: 's2_0' }] }] }));
    } },
    { name: 'onState swaps the manifest when the signature changes', run: async () => {
      // makeRun({...}) takes an OPTIONS OBJECT and returns a COMPLETE run object. onState
      // paints nothing itself (the frame hook repaints the Runs row and the open run page) and
      // calls maybeResume, which no-ops unless an answer is in flight, so a bare run is safe here.
      const r = np.makeRun({ runId: 'rid' });
      r.stepper = { steps: [{ nodes: [{ id: 's2_0', key: 'implementer' }] }] };
      r.el = null; // r.el is always null (the list card is gone); swap should still update r.stepper
      np.onState(r, { stepper: { steps: [{ nodes: [{ id: 's_impl_p1_t1' }] }] }, status: 'running' });
      assert.deepEqual(r.stepper.steps[0].nodes.map((n) => n.id), ['s_impl_p1_t1']);
    } },
  ]);
});
