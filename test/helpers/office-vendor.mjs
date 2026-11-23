// test/helpers/office-vendor.mjs — the browser side of the Office fallback's vendor scripts, for a jsdom window built with
// `runScripts: 'outside-only'`. `importer(url)` stands in for office-lite.mjs's `import(url)`: it evaluates the pinned
// node_modules file in the window, once per URL like a browser's module map (a second import resolves without running
// it again — what makes the xlsx-then-docx global bug reproducible). Like a browser, it evaluates a tick after the call,
// and imports of one URL in flight share that one evaluation (what makes two renders in one window race). It also gives
// the window what jsdom lacks:
// setImmediate (jszip's postMessage polyfill never settles in jsdom: it checks `event.source === window`, jsdom posts
// `source: null`) and URL.createObjectURL / revokeObjectURL, recorded in `created` / `revoked` (each created Blob's `type`
// in `types`, at the same index).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
/** The two URLs office-lite.mjs's LITE_VENDOR names (test/office-lite-lazy.test.mjs pins that they agree). */
export const VENDOR_FILES = Object.freeze({
  '/vendor/jszip/jszip.min.js': path.join(path.dirname(require.resolve('jszip')), '..', 'dist', 'jszip.min.js'),
  // docx-preview's exports map hides dist/*.min.js from require.resolve: join from the package directory (plan D9).
  '/vendor/docx-preview/docx-preview.min.js': path.join(path.dirname(require.resolve('docx-preview')), 'docx-preview.min.js'),
});
const sources = new Map();
const sourceOf = (url) => {
  if (!sources.has(url)) sources.set(url, readFileSync(VENDOR_FILES[url], 'utf8'));
  return sources.get(url);
};

export function officeVendor(win) {
  const calls = [];
  const created = [];
  const revoked = [];
  const evaluated = new Map();
  const types = [];
  const failing = new Set();
  win.setImmediate = setImmediate;
  win.clearImmediate = clearImmediate;
  let n = 0;
  win.URL.createObjectURL = (blob) => { const u = `blob:http://localhost:4317/olp-${++n}`; created.push(u); types.push(blob ? blob.type : undefined); return u; };
  win.URL.revokeObjectURL = (u) => { revoked.push(u); };
  async function importer(url) {
    calls.push(url);
    if (failing.delete(url)) throw new Error(`import failed: ${url}`);
    if (!Object.hasOwn(VENDOR_FILES, url)) throw new Error(`unknown module: ${url}`);
    if (!evaluated.has(url)) {
      evaluated.set(url, new Promise((resolve) => { setImmediate(resolve); }).then(() => { win.eval(sourceOf(url)); }));
    }
    await evaluated.get(url);
    return {};
  }
  return {
    importer, calls, created, revoked, types,
    /** The next import of `url` rejects (and does not count as evaluated). */
    failNext: (url) => { failing.add(url); },
  };
}
