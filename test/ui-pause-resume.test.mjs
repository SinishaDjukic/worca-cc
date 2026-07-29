// test/ui-pause-resume.test.mjs — pause/resume UI affordances (jsdom).
// Harness mirrors test/ui-subagent-tree.test.mjs's bootLive: boot index.html,
// stub WebSocket/fetch, import app.js with a cache-buster, reach internals via
// window.__np. Adds a fetchCalls recorder + an /api/resume stub for the
// resume-from-history flow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function bootLive() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  const fetchCalls = [];
  window.fetch = (url, opts) => {
    fetchCalls.push({ url: String(url), opts });
    if (String(url).includes('/api/resume')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, runId: 'r-new', pipelineId: 'p1' }) });
    }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window, fetchCalls };
}

test('historyBadge: paused -> amber PAUSED; pausing -> running-family PAUSING…', async () => {
  const { window } = await bootLive();
  const { historyBadge } = window.__np;
  assert.deepEqual(historyBadge({ status: 'paused' }), { cls: 'badge paused', text: 'PAUSED' });
  assert.deepEqual(historyBadge({ status: 'pausing' }), { cls: 'badge running', text: 'PAUSING…' });
});

test('statusPill: pausing/paused map to amber, ahead of the question state', async () => {
  const { window } = await bootLive();
  const { statusPill } = window.__np;
  assert.deepEqual(statusPill({ status: 'pausing', pendingQuestion: null }), { family: 'amber', text: 'Pausing…' });
  assert.deepEqual(statusPill({ status: 'paused', pendingQuestion: null }), { family: 'amber', text: 'Paused' });
});

test('paused history card shows a wired Resume button', async () => {
  const { window, fetchCalls } = await bootLive();
  const { buildHistCard } = window.__np;
  const card = buildHistCard('/tmp/proj', { id: 'p1', title: 't', status: 'paused', projectKey: 'k' }, false);
  const btn = card.querySelector('.hist-resume');
  assert.ok(btn, 'resume button present');
  assert.equal(btn.hidden, false, 'visible on paused records');
  btn.click();
  await new Promise((r) => setTimeout(r, 0));
  const call = fetchCalls.find((c) => c.url.includes('/api/resume'));
  assert.ok(call, 'click posts /api/resume');
  assert.deepEqual(JSON.parse(call.opts.body), { pipelineId: 'p1' });
});

test('non-paused history card hides the Resume button', async () => {
  const { window } = await bootLive();
  const { buildHistCard } = window.__np;
  const card = buildHistCard('/tmp/proj', { id: 'p2', title: 't', status: 'done', projectKey: 'k' }, false);
  assert.equal(card.querySelector('.hist-resume').hidden, true);
});

test('run-card template carries a Pause button next to Stop', async () => {
  const html = readFileSync(htmlPath, 'utf8');
  assert.match(html, /btn-pause/, 'index.html run-card template has .btn-pause');
});
