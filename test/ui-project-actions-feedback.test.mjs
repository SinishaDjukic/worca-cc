// test/ui-project-actions-feedback.test.mjs — #555: the project page's Actions editor (#projects/<key>/actions)
// reports its Save on the button (Save starts disabled, busy → Saved), a server error that names a
// field goes on that input, and a success raises a toast naming the project. No .act-save-msg line.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { lastToast, fieldErrorText, edit } from './helpers/feedback.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

const trackDom = useDomRelease(afterEach);

const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECTS = [{ name: 'svc-iam', path: '/a/svc-iam', exists: true, key: 'k' }];
const CONFIG = { setup: null, actions: [{ id: 'web', label: 'Web', kind: 'service', cmd: 'npm start', ready: null, env: [] }], builtins: {} };

const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

async function boot(put) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  const puts = [];
  // Route table: the most specific arms first (`/api/projects` would also catch `/api/projects/k/actions`).
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u === '/api/projects/k/actions' && method === 'PUT') { puts.push(JSON.parse(opts.body)); return put(); }
    if (u === '/api/projects/k/actions') return json(200, { config: structuredClone(CONFIG), detected: {} });
    if (u.includes('/api/projects')) return json(200, { projects: PROJECTS });
    return json(200, { config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle();
  window.location.hash = 'projects/k/actions';
  await settle(12);
  return { window, doc: window.document, puts };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

test('Actions editor Save: disabled until an edit; a 400 naming actions[0].cmd marks that input; a 200 PUTs the edited actions, reads Saved and toasts the project', async () => {
  // Two boots (a 400 PUT stub, then a 200 one): one test, one row per former test.
  await checkRows([
    { name: 'Save starts disabled; a 400 naming actions[0].cmd puts the error on that input, with no .act-save-msg line', run: async () => {
      const { window, doc, puts } = await boot(() => json(400, { error: 'a command is required', field: 'actions[0].cmd' }));
      const editor = doc.querySelector('.pd-sec-actions .actions-config');
      assert.ok(editor, 'the editor rendered');
      const save = editor.querySelector('.ac-save');
      assert.equal(save.disabled, true, 'a clean editor: Save is disabled');
      const cmd = editor.querySelector('.ac-action .ac-f-cmd');
      edit(window, cmd, '');
      assert.equal(save.disabled, false, 'an edit enables Save');
      click(window, save);
      await settle();
      assert.equal(puts.length, 1);
      assert.equal(cmd.getAttribute('aria-invalid'), 'true');
      assert.equal(fieldErrorText(cmd), 'A command is required');
      assert.equal(doc.querySelector('.act-save-msg'), null);
    } },
    { name: 'a 200 shows Saved on the button and a toast naming the project', run: async () => {
      const { window, doc, puts } = await boot(() => json(200, { ok: true }));
      const editor = doc.querySelector('.pd-sec-actions .actions-config');
      const save = editor.querySelector('.ac-save');
      edit(window, editor.querySelector('.ac-action .ac-f-cmd'), 'npm run dev');
      click(window, save);
      await settle();
      assert.equal(puts.length, 1);
      assert.equal(puts[0].actions[0].cmd, 'npm run dev');
      assert.equal(save.textContent.trim(), 'Saved');
      assert.equal(lastToast(doc)?.title, 'Actions saved for svc-iam');
      assert.equal(doc.querySelector('.act-save-msg'), null);
    } },
  ]);
});
