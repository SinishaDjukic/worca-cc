// test/ui-agent-caps-start-line.test.mjs — FEAT-1: the start dialog's agent-capabilities line. POST /api/agents/run-check
// (R-po-10) warns about agent servers/skills the run cannot provide; it never blocks Start, there is no review chip (R-po-17),
// and a start after a warning says so in a warn toast.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast } from './helpers/feedback.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const WARNINGS = ['Agent "Plan": server github is not available — switched off in the set', 'Agent "Plan": skill deploy is not available — not in any set'];
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const tick = (n = 0) => new Promise((r) => setTimeout(r, n));
async function waitFor(pred, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await tick(5);
  }
}

async function boot({ warnings = WARNINGS } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/#new' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const checks = [];
  const posted = [];
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u.endsWith('/api/agents/run-check') && method === 'POST') { checks.push(JSON.parse(opts.body)); return Promise.resolve(ok({ warnings })); }
    if (u.endsWith('/api/run') && method === 'POST') { posted.push(JSON.parse(opts.body)); return Promise.resolve(ok({ runId: 'r1' })); }
    if (u.includes('/api/run-defaults')) return Promise.resolve(ok({ engine: { value: 'claude', source: 'default' }, steps: { claude: {}, codex: {} } }));
    if (u.includes('/api/projects')) return Promise.resolve(ok({ projects: [{ name: 'web', key: 'web-1', path: '/a/web', exists: true }] }));
    if (u.includes('/api/workspaces')) return Promise.resolve(ok({ workspaces: [] }));
    return Promise.resolve(ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }));
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  window.localStorage.setItem('worca-cc.runTarget', 'project');
  window.localStorage.setItem('worca-cc.lastProject', 'web');
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  return { window, doc: window.document, checks, posted };
}

test('start dialog: run-check warnings render in #agentCapsLine, Start is not blocked and toasts the warning, no review chip', async () => {
  const { window, doc, checks, posted } = await boot();
  const line = doc.getElementById('agentCapsLine');
  assert.ok(line, '#agentCapsLine exists next to #policyLine');
  await waitFor(() => !line.hidden);
  assert.deepEqual(line.querySelectorAll('.pl-note.warn').length, 2);
  assert.match(line.textContent, /server github is not available/);
  assert.match(line.textContent, /skill deploy is not available/);
  assert.equal(line.querySelector('.review, [class*="review"]'), null, 'no review chip (R-po-17)');
  assert.deepEqual(checks[0].target, { projectKey: 'web-1' });
  assert.equal(checks[0].workflowId, 'wf_default');

  doc.getElementById('prompt').value = 'do work';
  doc.getElementById('run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => posted.length === 1);
  await waitFor(() => lastToast(doc)?.title === 'Run started');
  const t = lastToast(doc);
  assert.equal(t.tone, 'warn');
  assert.match(t.detail, /2 agent items are not available \(see run details\)/);
});

test('start dialog: no warnings hides the line and raises no warn toast', async () => {
  const { window, doc, checks, posted } = await boot({ warnings: [] });
  await waitFor(() => checks.length > 0);
  await tick(20);
  assert.equal(doc.getElementById('agentCapsLine').hidden, true);
  doc.getElementById('prompt').value = 'do work';
  doc.getElementById('run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => posted.length === 1);
  await tick(20);
  assert.notEqual(lastToast(doc)?.tone, 'warn', 'the run\'s own page is the confirmation');
});
