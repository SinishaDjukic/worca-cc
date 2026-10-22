// src/core/exec-env/e2b-sdk.mjs
// The ONE place the `e2b` package is imported — lazily, only in e2b mode, so local mode
// never needs it (optionalDependencies, clarify: e2b-dependency). Mock mode gets the
// loopback fake (./e2b-fake.mjs); tests inject any module with _setE2bForTests.
import { join } from 'node:path';
import { E2B_SDK_VERSION } from './e2b-config.mjs';
import { createFakeE2b } from './e2b-fake.mjs';
import { worcaHome } from '../projects.mjs';

let override = null;
const mockFakes = new Map();   // fake root -> fake (tests switch WORCA_HOME between cases)
export function _setE2bForTests(mod) { override = mod; }

export { e2bInstalled } from './backends/e2b.mjs';

export async function loadE2b({ mock = false } = {}) {
  if (override) return override;
  if (mock) {
    const root = join(worcaHome(), 'tmp', 'e2b-fake');
    if (!mockFakes.has(root)) mockFakes.set(root, createFakeE2b({ root, logFile: join(root, 'events.ndjson') }));
    return mockFakes.get(root);
  }
  try { return await import('e2b'); }
  catch (err) {
    const e = new Error(`The optional "e2b" package could not be loaded (${err?.code || err?.message}). Run: npm install e2b@${E2B_SDK_VERSION}`);
    e.cause = err; throw e;
  }
}
