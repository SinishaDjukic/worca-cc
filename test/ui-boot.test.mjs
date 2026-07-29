import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Smoke test: the real app.js must boot against the real index.html without
// throwing, and the shell must expose exactly eleven routed views. This is the
// guard that catches a module-top null-dereference when the markup changes.
test('app.js boots without throwing and finds 11 views', async () => {
  const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;

  // Stub the network primitives app.js touches at boot (WS + a couple of fetches).
  window.WebSocket = class {
    constructor() { this.readyState = 0; }
    send() {}
    close() {}
    addEventListener() {}
  };
  window.fetch = () =>
    Promise.resolve({
      ok: true,
      json: async () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
    });

  // app.js uses bare globals (document/window/location/localStorage/WebSocket/
  // fetch/navigator); mirror jsdom's window onto globalThis before importing.
  // Some globals (e.g. navigator) are read-only getters in modern Node, so use
  // defineProperty and fall back to skipping any that can't be (re)assigned.
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present (e.g. navigator) — leave it as-is */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  let threw = null;
  try {
    await import(fileURLToPath(new URL('../ui/public/app.js', import.meta.url)) + `?b=${Date.now()}`);
  } catch (e) {
    threw = e;
  }
  assert.equal(threw, null, threw && threw.stack);
  assert.equal(window.document.querySelectorAll('[data-view]').length, 11);
});
