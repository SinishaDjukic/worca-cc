// test/ui-newpipeline-extras.test.mjs — New-Pipeline extra files as removable
// pills, and the @-mention autocomplete that completes attached file names in
// the prompt textareas (mouse + ArrowUp/Down + Enter/Tab + Escape).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot() {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4319/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  window.fetch = (url) => {
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    }
    if (String(url).includes('/api/workflows')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'HTMLInputElement', 'HTMLSelectElement']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

// Simulate the OS file picker returning `names`: the FileList is read-only, so
// override the input's `files` getter, then fire `change` like a real pick.
function pickFiles(window, names) {
  const input = window.document.querySelector('#extras');
  const files = names.map((n) => new window.File(['x'], n, { type: 'text/plain' }));
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

// One boot serves several rows: a row that needs its own file list starts from none.
function clearPills(window) {
  for (let x, i = 0; i < 50 && (x = window.document.querySelector('#extrasPills .extra-pill-x')); i++) x.click();
}

const pillNames = (window) =>
  [...window.document.querySelectorAll('#extrasPills .extra-pill-name')].map((n) => n.textContent);

test('extra files render as removable pills: picks append, a re-pick never duplicates, (x) removes exactly that file and the empty note returns', async () => {
  const { window } = await boot();
  await checkRows([
    { name: 'picking files renders one removable pill per file', run: async () => {
      pickFiles(window, ['spec.md', 'data.csv']);

      assert.deepEqual(pillNames(window), ['spec.md', 'data.csv']);
      assert.equal(window.document.querySelector('#extrasPills').hidden, false);
      assert.match(window.document.querySelector('#extrasNote').textContent, /2 file\(s\)/);

      // picking more files APPENDS; a re-pick of the same name does not duplicate
      pickFiles(window, ['notes.txt', 'spec.md']);
      assert.deepEqual(pillNames(window), ['spec.md', 'data.csv', 'notes.txt']);
    } },
    { name: 'the pill (x) removes exactly that file; empty state restores the note', run: async () => {
      clearPills(window);
      pickFiles(window, ['a.md', 'b.md', 'c.md']);

      const xFor = (name) =>
        [...window.document.querySelectorAll('.extra-pill')]
          .find((p) => p.querySelector('.extra-pill-name').textContent === name)
          .querySelector('.extra-pill-x');
      xFor('b.md').click();
      assert.deepEqual(pillNames(window), ['a.md', 'c.md']);

      xFor('a.md').click();
      xFor('c.md').click();
      assert.deepEqual(pillNames(window), []);
      assert.equal(window.document.querySelector('#extrasPills').hidden, true);
      assert.equal(
        window.document.querySelector('#extrasNote').textContent,
        'Leave empty and the run gets no extra files.'
      );
    } },
  ]);
});

test('extra files are capped at 100 MB in total: a pick past it is refused with a note, a same-name re-pick counts once', async () => {
  const { window } = await boot();
  const MB = 1024 * 1024;
  // Content-free Files with a claimed size: the cap reads File.size only.
  const pickSized = (list) => {
    const input = window.document.querySelector('#extras');
    const files = list.map(([n, size]) => {
      const f = new window.File(['x'], n);
      Object.defineProperty(f, 'size', { value: size });
      return f;
    });
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const note = () => window.document.querySelector('#extrasNote').textContent;
  pickSized([['a.pdf', 50 * MB], ['b.pdf', 50 * MB]]);
  assert.deepEqual(pillNames(window), ['a.pdf', 'b.pdf'], 'exactly 100 MB fits');
  pickSized([['c.md', 1]]);
  assert.deepEqual(pillNames(window), ['a.pdf', 'b.pdf'], 'one byte past the cap is not added');
  assert.equal(note(), 'Not added: c.md. Extra files are limited to 100 MB in total.');
  pickSized([['b.pdf', 50 * MB]]);
  assert.deepEqual(pillNames(window), ['a.pdf', 'b.pdf'], 'a same-name re-pick replaces, so its old size does not count twice');
  assert.match(note(), /2 file\(s\)/, 'the refusal note clears on the next change');
});
