// test/ui-new-run-form-reset.test.mjs
// #687: once a run starts (or is scheduled), New pipeline clears the TASK (title, prompt, markdown,
// the loaded .md name, extra files) and keeps the CHOICES (project, task source). "Reuse last task"
// puts the task back. A failed start keeps everything; typing during the start is never wiped.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECTS = [{ name: 'svc-iam', path: '/a/svc-iam', exists: true }];

// `runReply()` answers POST /api/run; a test may hand back a promise it resolves later.
async function boot(runReply) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/#new' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    if (u.endsWith('/api/run') && opts && opts.method === 'POST') return runReply();
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  return window;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };
const reply = (status, body) => Promise.resolve({ ok: status < 300, status, json: async () => body });
const started = () => reply(200, { runId: 'run-1' });

function fillTask(window, { markdown = false } = {}) {
  const doc = window.document;
  const psel = doc.querySelector('#projectSelect');
  psel.value = '/a/svc-iam';
  psel.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.querySelector('#title').value = 'Dark mode';
  if (markdown) {
    doc.querySelector('#source-seg button[data-src="markdown"]').click();
    doc.querySelector('#promptMarkdown').value = '# Dark mode\n- a toggle';
    doc.querySelector('#mdFileName').textContent = 'dark-mode.md';
  } else {
    doc.querySelector('#prompt').value = 'Add dark mode';
  }
  const input = doc.querySelector('#extras');
  Object.defineProperty(input, 'files', { configurable: true, value: [new window.File(['x'], 'notes.txt', { type: 'text/plain' })] });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

const submit = (window) => window.document.querySelector('#run-form')
  .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
const pills = (doc) => [...doc.querySelectorAll('#extrasPills .extra-pill-name')].map((n) => n.textContent);
const reuse = (doc) => doc.querySelector('#reuse-task');

test('a started run clears the task, keeps the choices, and Reuse last task puts it back', async () => {
  const window = await boot(started);
  const doc = window.document;
  fillTask(window);
  assert.deepEqual(pills(doc), ['notes.txt'], 'precondition: one extra file');
  assert.equal(reuse(doc).hidden, true, 'no Reuse link before any run');
  submit(window);
  await settle();
  await checkRows([
    { name: 'the task is cleared', run: () => {
      assert.equal(doc.querySelector('#title').value, '');
      assert.equal(doc.querySelector('#prompt').value, '');
      assert.deepEqual(pills(doc), []);
    } },
    { name: 'the project choice is kept', run: () => assert.equal(doc.querySelector('#projectSelect').value, '/a/svc-iam') },
    { name: 'Reuse last task is offered', run: () => assert.equal(reuse(doc).hidden, false) },
    { name: 'Reuse restores title, prompt and extra files, then hides', run: () => {
      doc.querySelector('#reuse-task-btn').click();
      assert.equal(doc.querySelector('#title').value, 'Dark mode');
      assert.equal(doc.querySelector('#prompt').value, 'Add dark mode');
      assert.deepEqual(pills(doc), ['notes.txt']);
      assert.equal(reuse(doc).hidden, true);
    } },
  ]);
});

test('a markdown task: the text and the .md name clear; Reuse restores them on the Markdown source', async () => {
  const window = await boot(started);
  const doc = window.document;
  fillTask(window, { markdown: true });
  submit(window);
  await settle();
  assert.equal(doc.querySelector('#promptMarkdown').value, '');
  assert.equal(doc.querySelector('#mdFileName').textContent, '');
  doc.querySelector('#source-seg button[data-src="prompt"]').click();   // the user moved on
  doc.querySelector('#reuse-task-btn').click();
  assert.equal(doc.querySelector('#promptMarkdown').value, '# Dark mode\n- a toggle');
  assert.equal(doc.querySelector('#mdFileName').textContent, 'dark-mode.md');
  assert.ok(doc.querySelector('#source-seg button[data-src="markdown"]').classList.contains('on'), 'back on Markdown');
  assert.equal(doc.querySelector('input[name="source"][value="markdown"]').checked, true);
});

test('a scheduled run clears the task too', async () => {
  const window = await boot(() => reply(202, { runId: 'run-2', status: 'scheduled' }));
  const doc = window.document;
  fillTask(window);
  submit(window);
  await settle();
  assert.equal(doc.querySelector('#prompt').value, '');
  assert.equal(reuse(doc).hidden, false);
});

test('a failed start keeps the whole task and offers no Reuse', async () => {
  const window = await boot(() => reply(500, { error: 'boom' }));
  const doc = window.document;
  fillTask(window);
  submit(window);
  await settle();
  assert.equal(doc.querySelector('#title').value, 'Dark mode');
  assert.equal(doc.querySelector('#prompt').value, 'Add dark mode');
  assert.deepEqual(pills(doc), ['notes.txt']);
  assert.equal(reuse(doc).hidden, true);
});

test('text typed while the run is starting is never wiped', async () => {
  let release;
  const window = await boot(() => new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => ({ runId: 'run-3' }) }); }));
  const doc = window.document;
  fillTask(window);
  submit(window);
  await settle();
  doc.querySelector('#prompt').value = 'Next task, typed while starting';
  release();
  await settle();
  assert.equal(doc.querySelector('#prompt').value, 'Next task, typed while starting');
  assert.equal(reuse(doc).hidden, true);
});

test('typing a new task hides Reuse last task, so it can never overwrite it', async () => {
  const window = await boot(started);
  const doc = window.document;
  fillTask(window);
  submit(window);
  await settle();
  assert.equal(reuse(doc).hidden, false);
  const p = doc.querySelector('#prompt');
  p.value = 'Something new';
  p.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(reuse(doc).hidden, true);
});
