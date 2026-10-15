// test/ui-run-model-pill-engine.test.mjs — the run page's step pills show the model a node ran
// with on the run's engine (cascading-settings-design.md §4.5): another engine's configured model
// never ran, so it shows no pill (never a guess).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot() {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4319/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], projects: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

const STEPPER = { version: 2, steps: [], graph: { wires: [], nodes: [
  { id: 'n1', kind: 'agent', model: 'claude-opus-4-8', effort: 'max' },
  { id: 'n2', kind: 'agent', model: 'gpt-5.5', effort: 'low' },
  { id: 'n3', kind: 'agent', model: 'my-proxy', effort: '' },
] } };

test('stepModelByNode keeps only what the run\'s engine ran', async () => {
  const { window } = await boot();
  window.__np._setModels([
    { id: 'claude-opus-4-8', label: 'Opus 4.8', engine: 'claude' },
    { id: 'gpt-5.5', label: 'GPT-5.5', engine: 'codex' },
  ]);
  assert.deepEqual(window.__np.stepModelByNode(STEPPER, 'codex'), { n2: { model: 'gpt-5.5', effort: 'low' }, n3: { model: 'my-proxy', effort: '' } });
  assert.deepEqual(window.__np.stepModelByNode(STEPPER, 'claude'), { n1: { model: 'claude-opus-4-8', effort: 'max' }, n3: { model: 'my-proxy', effort: '' } });
  assert.deepEqual(Object.keys(window.__np.stepModelByNode(STEPPER)), ['n1', 'n3'], 'no engine = a Claude run');
});

test('stepModelByNode marks a node that ran the model its run\'s own overlay set; its pill says "Picked for this run only"', async () => {
  const { window } = await boot();
  window.__np._setModels([{ id: 'claude-opus-4-8', label: 'Opus 4.8', engine: 'claude' }]);
  const stepper = { ...STEPPER, runOverlay: { nodes: { n1: { model: 'CLAUDE-OPUS-4-8', effort: 'max' }, n3: { model: 'claude-haiku-4-5' } } } };
  const by = window.__np.stepModelByNode(stepper, 'claude');
  assert.deepEqual(by.n1, { model: 'claude-opus-4-8', effort: 'max', perRun: true });
  assert.deepEqual(by.n3, { model: 'my-proxy', effort: '' }, 'the cell ran another model (a pinned pair or the run\'s engine won): not marked');
  assert.match(window.__np.stepModelPillHtml(by.n1), /<span class="sub-model-pill" title="Picked for this run only">/);
  // Visible too (a title is hover-only: touch, keyboard and screen-reader users never get it), like " · bridged".
  assert.match(window.__np.stepModelPillHtml(by.n1), />Opus 4\.8 · max · this run<\/span>$/);
  assert.doesNotMatch(window.__np.stepModelPillHtml(by.n3), /this run/);
  assert.doesNotMatch(window.__np.stepModelPillHtml(by.n3), /title=/);
  const fanOnly = window.__np.stepModelByNode({ ...STEPPER, runOverlay: { nodes: { n1: { fanOut: true } } } }, 'claude');
  assert.equal('perRun' in fanOnly.n1, false, 'an entry naming no model (fan-out only) leaves the model pill unmarked');
});
