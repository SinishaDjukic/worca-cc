// test/ui-pause-resume.test.mjs — pause/resume UI affordances (jsdom).
// Harness mirrors test/ui-subagent-tree.test.mjs's bootLive: boot index.html,
// stub WebSocket/fetch, import app.js with a cache-buster, reach internals via
// window.__np. Adds a fetchCalls recorder + an /api/resume stub, and can drive
// the History DETAIL screen — Resume lives there now, not on the list card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function bootLive({ fetchHandler } = {}) {
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
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
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
  const showHistory = () => { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); };
  // The card no longer expands — open the run's DETAIL screen (#history/<key>/<id>).
  const showDetail = (key, id) => { window.location.hash = `history/${key}/${id}`; window.dispatchEvent(new window.Event('hashchange')); };
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { window, fetchCalls, showHistory, showDetail, settle };
}

// MOST-SPECIFIC FIRST: the keyed detail URL has the list URL as a prefix.
const historyArms = (row) => (url) => {
  if (url.endsWith(`/api/history/k/${row.id}`)) {
    return Promise.resolve({ ok: true, status: 200,
      json: async () => ({ state: { id: row.id, title: row.title, status: row.status, steps: [] } }) });
  }
  if (url.endsWith('/api/history')) {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: [row], live: [] }) });
  }
  return null;
};

test('histStatusMeta: paused and pausing both land in the amber paused family', async () => {
  const { window } = await bootLive();
  const { histStatusMeta } = window.__np;
  assert.deepEqual(histStatusMeta({ status: 'paused' }), { family: 'paused', word: 'Paused' });
  assert.deepEqual(histStatusMeta({ status: 'pausing' }), { family: 'paused', word: 'Pausing…' });
});

test('statusPill: pausing/paused map to amber, ahead of the question state', async () => {
  const { window } = await bootLive();
  const { statusPill } = window.__np;
  assert.deepEqual(statusPill({ status: 'pausing', pendingQuestion: null }), { family: 'amber', text: 'Pausing…' });
  assert.deepEqual(statusPill({ status: 'paused', pendingQuestion: null }), { family: 'amber', text: 'Paused' });
});

test('a paused run shows a wired Resume button on its detail screen', async () => {
  const row = { id: 'p1', title: 't', status: 'paused', projectKey: 'k' };
  const ctx = await bootLive({ fetchHandler: historyArms(row) });
  ctx.showHistory();
  await ctx.settle();
  ctx.showDetail('k', 'p1');
  await ctx.settle();
  const btn = ctx.window.document.querySelector('#hist-detail .hd-resume');
  assert.ok(btn, 'resume button present');
  assert.equal(btn.hidden, false, 'visible on paused records');
  btn.click();
  await ctx.settle(5);
  const call = ctx.fetchCalls.find((c) => c.url.includes('/api/resume'));
  assert.ok(call, 'click posts /api/resume');
  assert.deepEqual(JSON.parse(call.opts.body), { pipelineId: 'p1' });
});

test('a done run hides the Resume button on its detail screen', async () => {
  const row = { id: 'p2', title: 't', status: 'done', projectKey: 'k' };
  const ctx = await bootLive({ fetchHandler: historyArms(row) });
  ctx.showHistory();
  await ctx.settle();
  ctx.showDetail('k', 'p2');
  await ctx.settle();
  assert.equal(ctx.window.document.querySelector('#hist-detail .hd-resume').hidden, true);
});

test('run-card template carries a Pause button next to Stop', async () => {
  const html = readFileSync(htmlPath, 'utf8');
  assert.match(html, /btn-pause/, 'index.html run-card template has .btn-pause');
});
