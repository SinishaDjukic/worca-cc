// test/ui-newpipeline-extras.test.mjs — New-Pipeline extra files as removable
// pills, and the @-mention autocomplete that completes attached file names in
// the prompt textareas (mouse + ArrowUp/Down + Enter/Tab + Escape).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4319/' });
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
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
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

const pillNames = (window) =>
  [...window.document.querySelectorAll('#extrasPills .extra-pill-name')].map((n) => n.textContent);

function typeInPrompt(window, text) {
  const ta = window.document.querySelector('#prompt');
  ta.value = text;
  ta.selectionStart = ta.selectionEnd = text.length;
  ta.dispatchEvent(new window.Event('input', { bubbles: true }));
  return ta;
}

const popupItems = (window) =>
  [...window.document.querySelectorAll('#mention-popup .mention-item')].map((n) => n.textContent);

const key = (window, ta, k) =>
  ta.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

test('picking files renders one removable pill per file', async () => {
  const { window } = await boot();
  pickFiles(window, ['spec.md', 'data.csv']);

  assert.deepEqual(pillNames(window), ['spec.md', 'data.csv']);
  assert.equal(window.document.querySelector('#extrasPills').hidden, false);
  assert.match(window.document.querySelector('#extrasNote').textContent, /2 file\(s\)/);

  // picking more files APPENDS; a re-pick of the same name does not duplicate
  pickFiles(window, ['notes.txt', 'spec.md']);
  assert.deepEqual(pillNames(window), ['spec.md', 'data.csv', 'notes.txt']);
});

test('the pill (x) removes exactly that file; empty state restores the note', async () => {
  const { window } = await boot();
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
});

test('typing @ pops up attached files and filters as you type', async () => {
  const { window } = await boot();
  pickFiles(window, ['readme.md', 'report.csv', 'notes.txt']);

  typeInPrompt(window, 'Use @');
  const popup = window.document.querySelector('#mention-popup');
  assert.equal(popup.hidden, false);
  assert.deepEqual(popupItems(window), ['readme.md', 'report.csv', 'notes.txt']);

  typeInPrompt(window, 'Use @re');
  assert.deepEqual(popupItems(window), ['readme.md', 'report.csv']);

  typeInPrompt(window, 'Use @zzz');
  assert.equal(popup.hidden, true);
});

test('no popup without attached files, and none mid-word', async () => {
  const { window } = await boot();
  typeInPrompt(window, 'Use @');
  assert.equal(window.document.querySelector('#mention-popup').hidden, true);

  pickFiles(window, ['spec.md']);
  typeInPrompt(window, 'mail me@'); // "@" inside a word must not trigger
  assert.equal(window.document.querySelector('#mention-popup').hidden, true);
});

test('keyboard: arrows move the highlight, Tab inserts, Escape closes', async () => {
  const { window } = await boot();
  pickFiles(window, ['alpha.md', 'beta.md']);

  let ta = typeInPrompt(window, 'See @');
  key(window, ta, 'ArrowDown');
  assert.equal(window.document.querySelector('#mention-popup .mention-item.sel').textContent, 'beta.md');
  key(window, ta, 'Tab');
  assert.equal(ta.value, 'See @beta.md ');
  assert.equal(ta.selectionStart, 'See @beta.md '.length);
  assert.equal(window.document.querySelector('#mention-popup').hidden, true);

  ta = typeInPrompt(window, 'See @al');
  key(window, ta, 'Enter');
  assert.equal(ta.value, 'See @alpha.md ');

  ta = typeInPrompt(window, 'See @');
  key(window, ta, 'Escape');
  assert.equal(window.document.querySelector('#mention-popup').hidden, true);
});

test('mouse: mousedown on a popup item inserts the mention', async () => {
  const { window } = await boot();
  pickFiles(window, ['alpha.md', 'beta.md']);

  const ta = typeInPrompt(window, 'See @');
  const item = [...window.document.querySelectorAll('#mention-popup .mention-item')]
    .find((n) => n.textContent === 'beta.md');
  item.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert.equal(ta.value, 'See @beta.md ');
  assert.equal(window.document.querySelector('#mention-popup').hidden, true);
});

test('the markdown textarea gets the same autocomplete', async () => {
  const { window } = await boot();
  pickFiles(window, ['spec.md']);

  const ta = window.document.querySelector('#promptMarkdown');
  ta.value = '@';
  ta.selectionStart = ta.selectionEnd = 1;
  ta.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(popupItems(window), ['spec.md']);
  key(window, ta, 'Enter');
  assert.equal(ta.value, '@spec.md ');
});
