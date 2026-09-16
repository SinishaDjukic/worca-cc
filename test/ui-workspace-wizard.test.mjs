// test/ui-workspace-wizard.test.mjs — jsdom boot tests for the 4-step creation
// wizard: step gating, the team-metrics home step, scan POST (pre-persist),
// live changing status text, scan-done/scan-error, save (create + 409-preserve),
// abort + leave-guard, and the JSON-safety regression guard (.value/.textContent
// only; never innerHTML).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECTS = [
  { name: 'svc-iam', path: '/a/svc-iam', exists: true },
  { name: 'svc-ui', path: '/a/svc-ui', exists: true },
  { name: 'svc-pay', path: '/a/svc-pay', exists: true },
  { name: 'gone', path: '/a/gone', exists: false },
];

// Metrics-scan fixtures (§8.6 board 7). Paths line up with PROJECTS so the auto-picked
// "single recording member" and the create-POST metricsProject guard both resolve for real.
const WIZ_MEMBERS = { members: [
  { path: '/a/svc-iam', key: 'svc-iam-1', slug: 'me/svc-iam', hasOrigin: true, enabled: true, recordsLocally: true, enabledAt: '2026-08-12T00:00:00Z' },
  { path: '/a/svc-ui', key: 'svc-ui-1', slug: 'me/svc-ui', hasOrigin: true, enabled: false, recordsLocally: false },
] };
const MEMBERS_ROUND1 = { members: [
  { path: '/a/svc-iam', key: 'svc-iam-1', slug: 'me/svc-iam', hasOrigin: true, enabled: true, recordsLocally: true, enabledAt: '2026-08-12T00:00:00Z' },
  { path: '/a/svc-ui', key: 'svc-ui-1', slug: 'me/svc-ui', hasOrigin: true, enabled: true, recordsLocally: true, enabledAt: '2026-08-12T00:00:00Z' },
] };
const MEMBERS_ROUND2 = { members: [
  { path: '/a/svc-ui', key: 'svc-ui-1', slug: 'me/svc-ui', hasOrigin: true, enabled: false, recordsLocally: false },
  { path: '/a/svc-pay', key: 'svc-pay-1', slug: 'me/svc-pay', hasOrigin: true, enabled: true, recordsLocally: true, enabledAt: '2026-08-12T00:00:00Z' },
] };

// A WebSocket stub that records sent frames and exposes a way to deliver a
// server message into app.js's 'message' listener.
class WSStub {
  constructor() { this.readyState = 1; this.sent = []; this._listeners = {}; WSStub.last = this; }
  send(s) { this.sent.push(typeof s === 'string' ? JSON.parse(s) : s); }
  close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { (this._listeners.open || []).forEach((fn) => fn({})); }
  deliver(obj) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) })); }
}

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.confirm = () => true;
  window.fetch = (url, opts) => {
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    // Must be checked before the generic '/api/workspaces' branch below, which would
    // otherwise swallow this more specific URL first.
    if (u.includes('/api/workspaces/metrics-scan')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ members: [] }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [] }) });
    if (u.includes('/api/branches')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ branches: [], current: '' }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  // app.js opens the socket at boot; fire 'open' so wsReady=true (subscribes send).
  if (WSStub.last) WSStub.last._open();
  return { window, ws: () => WSStub.last };
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const goCreate = (window) => { window.location.hash = 'workspace-create'; window.dispatchEvent(new window.Event('hashchange')); };
const stepVisible = (doc, n) => !doc.querySelector(`#wiz-step-${n}`).classList.contains('hidden');

test('Step 1 gating: start-scan disabled until 2+ projects selected', async () => {
  const { window } = await boot();
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  assert.ok(stepVisible(doc, 1), 'starts on step 1');
  const cbs = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')];
  // The missing project's checkbox is disabled.
  const missing = cbs.find((c) => c.value === '/a/gone');
  assert.equal(missing.disabled, true, 'missing project checkbox disabled');

  assert.equal(doc.querySelector('#wiz-next-metrics').disabled, true, 'disabled with 0 selected');
  cbs.find((c) => c.value === '/a/svc-iam').checked = true;
  cbs.find((c) => c.value === '/a/svc-iam').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(doc.querySelector('#wiz-next-metrics').disabled, true, 'still disabled with 1 selected');
  cbs.find((c) => c.value === '/a/svc-ui').checked = true;
  cbs.find((c) => c.value === '/a/svc-ui').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(doc.querySelector('#wiz-next-metrics').disabled, false, 'enabled at 2 selected');
});

test('startScan POSTs pre-persist {projectPaths,name}, shows Step 2, subscribes by scanId', async () => {
  const posts = [];
  const { window, ws } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/workspaces/scan') && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: 'scan_abc' }) });
      }
      return null;
    },
  });
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'My WS';
  doc.querySelector('#wiz-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  for (const v of ['/a/svc-iam', '/a/svc-ui']) {
    const cb = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === v);
    cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  click(window, doc.querySelector('#wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  click(window, doc.querySelector('#wiz-start-scan'));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(posts.length, 1, 'one scan POST');
  assert.deepEqual(posts[0], { projectPaths: ['/a/svc-iam', '/a/svc-ui'], name: 'My WS' }, 'pre-persist body');
  assert.ok(stepVisible(doc, 2), 'advanced to step 2 (scan loader)');
  // No workspace was persisted yet (the create POST happens only at Step 3 Save).
  const subscribed = ws().sent.find((m) => m.type === 'subscribe' && m.scanId === 'scan_abc');
  assert.ok(subscribed, 'subscribed to the scan by scanId');
});

test('scan-progress drives the CHANGING status text + progress + phase track', async () => {
  const { window, ws } = await boot({
    fetchHandler: (u, opts) => u.endsWith('/api/workspaces/scan') && opts.method === 'POST'
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: 'scan_p' }) }) : null,
  });
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'P';
  doc.querySelector('#wiz-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  for (const v of ['/a/svc-iam', '/a/svc-ui']) {
    const cb = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === v);
    cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  click(window, doc.querySelector('#wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  click(window, doc.querySelector('#wiz-start-scan'));
  await new Promise((r) => setTimeout(r, 0));

  ws().deliver({ type: 'scan-progress', scanId: 'scan_p', phase: 'graph', projectsTotal: 2, projectsDone: 0, message: 'building graph for svc-iam...' });
  assert.equal(doc.querySelector('#wiz-status').textContent, 'building graph for svc-iam...');
  assert.equal(doc.querySelector('#wiz-progress').textContent, '0 / 2 projects');
  assert.ok(doc.querySelector('#wiz-phases [data-phase="graph"]').classList.contains('active'));

  // A second event with a DIFFERENT message proves it changes live.
  ws().deliver({ type: 'scan-progress', scanId: 'scan_p', phase: 'investigate', projectsTotal: 2, projectsDone: 1, message: 'investigating svc-ui relations to svc-iam...' });
  assert.equal(doc.querySelector('#wiz-status').textContent, 'investigating svc-ui relations to svc-iam...');
  assert.equal(doc.querySelector('#wiz-progress').textContent, '1 / 2 projects');
  assert.ok(doc.querySelector('#wiz-phases [data-phase="investigate"]').classList.contains('active'));
  assert.equal(doc.querySelector('#wiz-phases [data-phase="graph"]').classList.contains('active'), false, 'phase advances exclusively');

  // A stale event for another scanId must be ignored.
  ws().deliver({ type: 'scan-progress', scanId: 'scan_OTHER', phase: 'synthesize', message: 'STALE — should be ignored' });
  assert.equal(doc.querySelector('#wiz-status').textContent, 'investigating svc-ui relations to svc-iam...', 'stale scan ignored');
});

test('scan-done fills the textarea via .value (never innerHTML) + lands on Step 3', async () => {
  const { window, ws } = await boot({
    fetchHandler: (u, opts) => u.endsWith('/api/workspaces/scan') && opts.method === 'POST'
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: 'scan_d' }) }) : null,
  });
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'D';
  doc.querySelector('#wiz-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  for (const v of ['/a/svc-iam', '/a/svc-ui']) {
    const cb = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === v);
    cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  click(window, doc.querySelector('#wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  click(window, doc.querySelector('#wiz-start-scan'));
  await new Promise((r) => setTimeout(r, 0));

  // A description containing markup that, if injected as innerHTML, would create a node.
  const desc = '# Workspace: D\n## Overview\n<img src=x onerror="boom()">\n- svc-iam: api';
  ws().deliver({ type: 'scan-done', scanId: 'scan_d', description: desc, projects: [], graphify: { used: false } });
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(stepVisible(doc, 3), 'advanced to step 3');
  const ta = doc.querySelector('#wiz-desc');
  assert.equal(ta.value, desc, 'textarea value bound verbatim');
  // JSON-safety: the markup is inert — bound as text, never parsed into a child node.
  assert.equal(ta.querySelector('img'), null, 'no element parsed from the description (no innerHTML)');
  assert.match(doc.querySelector('#wiz-graphify-note').textContent, /graphify not available/i);
});

test('scan-error returns to Step 1 with the error message', async () => {
  const { window, ws } = await boot({
    fetchHandler: (u, opts) => u.endsWith('/api/workspaces/scan') && opts.method === 'POST'
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: 'scan_e' }) }) : null,
  });
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'E';
  doc.querySelector('#wiz-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  for (const v of ['/a/svc-iam', '/a/svc-ui']) {
    const cb = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === v);
    cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  click(window, doc.querySelector('#wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  click(window, doc.querySelector('#wiz-start-scan'));
  await new Promise((r) => setTimeout(r, 0));
  ws().deliver({ type: 'scan-error', scanId: 'scan_e', message: 'scanner exploded' });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(stepVisible(doc, 1), 'back to step 1');
  assert.match(doc.querySelector('#wiz-step1-hint').textContent, /scanner exploded/);
});

test('Step 3 Save (create) POSTs {name,projectPaths,description} then navigates to #workspaces', async () => {
  const posts = [];
  const { window, ws } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/workspaces/scan') && opts.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: 'scan_s' }) });
      if (u.endsWith('/api/workspaces') && opts.method === 'POST') { posts.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, status: 201, json: async () => ({ workspace: { id: 'wks-new', name: 'S', description: JSON.parse(opts.body).description, projectPaths: ['/a/svc-iam', '/a/svc-ui'], projectKeys: [], exists: [true, true] } }) }); }
      return null;
    },
  });
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'S';
  doc.querySelector('#wiz-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  for (const v of ['/a/svc-iam', '/a/svc-ui']) {
    const cb = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === v);
    cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  click(window, doc.querySelector('#wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  click(window, doc.querySelector('#wiz-start-scan'));
  await new Promise((r) => setTimeout(r, 0));
  ws().deliver({ type: 'scan-done', scanId: 'scan_s', description: '# Workspace: S', projects: [], graphify: { used: true } });
  await new Promise((r) => setTimeout(r, 0));

  doc.querySelector('#wiz-desc').value = '# Workspace: S\nedited by hand';
  click(window, doc.querySelector('#wiz-save'));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(posts.length, 1, 'one create POST');
  assert.deepEqual(posts[0], { name: 'S', projectPaths: ['/a/svc-iam', '/a/svc-ui'], description: '# Workspace: S\nedited by hand', metricsProject: null });
  assert.equal(window.location.hash, '#workspaces', 'navigated to workspaces on success');
});

test('Step 3 Save 409 keeps the user on Step 3 with edited text intact + surfaces error verbatim', async () => {
  const { window, ws } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/workspaces/scan') && opts.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: 'scan_409' }) });
      if (u.endsWith('/api/workspaces') && opts.method === 'POST') return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'a workspace with this name already exists' }) });
      return null;
    },
  });
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'Dup';
  doc.querySelector('#wiz-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  for (const v of ['/a/svc-iam', '/a/svc-ui']) {
    const cb = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === v);
    cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  click(window, doc.querySelector('#wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  click(window, doc.querySelector('#wiz-start-scan'));
  await new Promise((r) => setTimeout(r, 0));
  ws().deliver({ type: 'scan-done', scanId: 'scan_409', description: '# Workspace: Dup', projects: [], graphify: { used: false } });
  await new Promise((r) => setTimeout(r, 0));

  const edited = '# Workspace: Dup\nmy careful edits';
  doc.querySelector('#wiz-desc').value = edited;
  click(window, doc.querySelector('#wiz-save'));
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(stepVisible(doc, 3), 'still on step 3 after 409');
  assert.equal(doc.querySelector('#wiz-desc').value, edited, 'edited text preserved');
  assert.equal(window.location.hash !== '#workspaces', true, 'did NOT navigate away');
  assert.match(doc.querySelector('#wiz-msg').textContent, /name already exists/, 'verbatim 409 error surfaced');
});

test('abort sends {unsubscribe,scanId} and the leave-guard aborts a live scan on navigation', async () => {
  const { window, ws } = await boot({
    fetchHandler: (u, opts) => u.endsWith('/api/workspaces/scan') && opts.method === 'POST'
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: 'scan_ab' }) }) : null,
  });
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'Ab';
  doc.querySelector('#wiz-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  for (const v of ['/a/svc-iam', '/a/svc-ui']) {
    const cb = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === v);
    cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  click(window, doc.querySelector('#wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  click(window, doc.querySelector('#wiz-start-scan'));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(stepVisible(doc, 2), 'scanning');

  // Navigate away (e.g. to New) → leave-guard fires abortWizardScan.
  window.location.hash = 'new';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  const unsub = ws().sent.find((m) => m.type === 'unsubscribe' && m.scanId === 'scan_ab');
  assert.ok(unsub, 'leave-guard sent unsubscribe for the live scan');

  // A late scan-done for the aborted scan must NOT jump back into the wizard.
  ws().deliver({ type: 'scan-done', scanId: 'scan_ab', description: 'late', projects: [], graphify: { used: false } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('.view[data-view="new"]').classList.contains('hidden'), false, 'stayed on New');
});

test('a duplicate scan-done for a PRIOR scanId is ignored after a new scan starts', async () => {
  let nth = 0;
  const { window, ws } = await boot({
    fetchHandler: (u, opts) => u.endsWith('/api/workspaces/scan') && opts.method === 'POST'
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: ++nth === 1 ? 'scan_old' : 'scan_new' }) }) : null,
  });
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'Dup';
  doc.querySelector('#wiz-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  for (const v of ['/a/svc-iam', '/a/svc-ui']) {
    const cb = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === v);
    cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  // First scan completes.
  click(window, doc.querySelector('#wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  click(window, doc.querySelector('#wiz-start-scan'));
  await new Promise((r) => setTimeout(r, 0));
  ws().deliver({ type: 'scan-done', scanId: 'scan_old', description: 'FIRST', projects: [], graphify: { used: false } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('#wiz-desc').value, 'FIRST', 'first scan filled the textarea');

  // Re-scan from Step 3: the old scanId must be cleared before the new POST resolves.
  click(window, doc.querySelector('#wiz-rescan'));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(stepVisible(doc, 2), 'back to the scan loader');

  // A late/buffered duplicate scan-done for the OLD scan must NOT re-fill or jump to Step 3.
  ws().deliver({ type: 'scan-done', scanId: 'scan_old', description: 'STALE-OLD', projects: [], graphify: { used: false } });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(stepVisible(doc, 2), 'stale old scan-done ignored — still scanning');
  assert.notEqual(doc.querySelector('#wiz-desc').value, 'STALE-OLD', 'stale description not applied');

  // The NEW scan's scan-done is honored.
  ws().deliver({ type: 'scan-done', scanId: 'scan_new', description: 'SECOND', projects: [], graphify: { used: true } });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(stepVisible(doc, 3), 'new scan-done lands on Step 3');
  assert.equal(doc.querySelector('#wiz-desc').value, 'SECOND');
});

test('#wiz-abort button returns to Step 1 and unsubscribes', async () => {
  const { window, ws } = await boot({
    fetchHandler: (u, opts) => u.endsWith('/api/workspaces/scan') && opts.method === 'POST'
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: 'scan_btn' }) }) : null,
  });
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'Btn';
  doc.querySelector('#wiz-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  for (const v of ['/a/svc-iam', '/a/svc-ui']) {
    const cb = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === v);
    cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  click(window, doc.querySelector('#wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  click(window, doc.querySelector('#wiz-start-scan'));
  await new Promise((r) => setTimeout(r, 0));
  click(window, doc.querySelector('#wiz-abort'));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(stepVisible(doc, 1), 'abort returns to step 1');
  assert.ok(ws().sent.some((m) => m.type === 'unsubscribe' && m.scanId === 'scan_btn'), 'unsubscribed on abort');
});

// ---- Step "metrics" (team-metrics-design.md §4.8, plan §8.6) ---------------

test('step 1 gates on 2 picks, Next opens the metrics step, and the only recording member is pre-selected', async () => {
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/workspaces/metrics-scan')) return Promise.resolve({ ok: true, status: 200, json: async () => WIZ_MEMBERS });
      if (u.endsWith('/api/workspaces/scan') && opts.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: 'scan_pick' }) });
      return null;
    },
  });
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'M';
  doc.querySelector('#wiz-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  const cbs = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')];
  assert.equal(doc.getElementById('wiz-next-metrics').disabled, true, 'disabled with 0 selected');
  for (const v of ['/a/svc-iam', '/a/svc-ui']) {
    cbs.find((c) => c.value === v).checked = true;
    cbs.find((c) => c.value === v).dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  assert.equal(doc.getElementById('wiz-next-metrics').disabled, false, 'enabled at 2 selected');

  click(window, doc.getElementById('wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(stepVisible(doc, 'metrics'), 'metrics pane visible');
  const radios = [...doc.querySelectorAll('#wiz-metrics-list input[name="tm-home"]')];
  assert.equal(radios.length, 1, 'only the recording member gets a radio');
  assert.equal(radios[0].checked, true, 'the only recording member is pre-selected');
  assert.equal(doc.getElementById('wiz-metrics-pre').hidden, false, '"Pre-selected…" sentence shown for the automatic pick');

  click(window, doc.getElementById('wiz-start-scan'));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(stepVisible(doc, 2), 'Scan interconnections (now in the metrics pane) still advances to the scan loader');
});

test('Save posts the chosen metrics home; Skip posts null', async () => {
  async function runToSave({ skip }) {
    const posts = [];
    const { window, ws } = await boot({
      fetchHandler: (u, opts) => {
        if (u.includes('/api/workspaces/metrics-scan')) return Promise.resolve({ ok: true, status: 200, json: async () => WIZ_MEMBERS });
        if (u.endsWith('/api/workspaces/scan') && opts.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: 'scan_save' }) });
        if (u.endsWith('/api/workspaces') && opts.method === 'POST') {
          posts.push(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, status: 201, json: async () => ({ workspace: { id: 'wks-save', name: 'Sv', description: '', projectPaths: ['/a/svc-iam', '/a/svc-ui'], projectKeys: [], exists: [true, true] } }) });
        }
        return null;
      },
    });
    goCreate(window);
    await new Promise((r) => setTimeout(r, 0));
    const doc = window.document;
    doc.querySelector('#wiz-name').value = 'Sv';
    doc.querySelector('#wiz-name').dispatchEvent(new window.Event('input', { bubbles: true }));
    for (const v of ['/a/svc-iam', '/a/svc-ui']) {
      const cb = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === v);
      cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
    }
    click(window, doc.getElementById('wiz-next-metrics'));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    click(window, doc.getElementById(skip ? 'wiz-metrics-skip' : 'wiz-start-scan'));
    await new Promise((r) => setTimeout(r, 0));
    ws().deliver({ type: 'scan-done', scanId: 'scan_save', description: '# Workspace: Sv', projects: [], graphify: { used: false } });
    await new Promise((r) => setTimeout(r, 0));
    click(window, doc.querySelector('#wiz-save'));
    await new Promise((r) => setTimeout(r, 0));
    return posts;
  }

  const savedPosts = await runToSave({ skip: false });
  assert.equal(savedPosts.length, 1);
  assert.deepEqual(savedPosts[0], { name: 'Sv', projectPaths: ['/a/svc-iam', '/a/svc-ui'], description: '# Workspace: Sv', metricsProject: '/a/svc-iam' });

  const skippedPosts = await runToSave({ skip: true });
  assert.equal(skippedPosts.length, 1);
  assert.deepEqual(skippedPosts[0], { name: 'Sv', projectPaths: ['/a/svc-iam', '/a/svc-ui'], description: '# Workspace: Sv', metricsProject: null });
});

test('a stale metrics pick is dropped after Back deselects that project; the new single recording member is offered instead', async () => {
  const posts = [];
  const { window, ws } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/workspaces/metrics-scan')) {
        const body = JSON.parse(opts.body || '{}');
        const resp = (body.projectPaths || []).includes('/a/svc-pay') ? MEMBERS_ROUND2 : MEMBERS_ROUND1;
        return Promise.resolve({ ok: true, status: 200, json: async () => resp });
      }
      if (u.endsWith('/api/workspaces/scan') && opts.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: 'scan_stale' }) });
      if (u.endsWith('/api/workspaces') && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 201, json: async () => ({ workspace: { id: 'wks-stale', name: 'St', description: '', projectPaths: [], projectKeys: [], exists: [] } }) });
      }
      return null;
    },
  });
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'St';
  doc.querySelector('#wiz-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  const check = (v, on) => {
    const cb = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === v);
    cb.checked = on; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  check('/a/svc-iam', true);
  check('/a/svc-ui', true);

  click(window, doc.getElementById('wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  // Both round-1 members record: no automatic pick — choose svc-iam by hand.
  const iamRadio = doc.querySelector('#wiz-metrics-list input[name="tm-home"][value="/a/svc-iam"]');
  iamRadio.checked = true;
  iamRadio.dispatchEvent(new window.Event('change', { bubbles: true }));

  click(window, doc.getElementById('wiz-metrics-back'));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(stepVisible(doc, 1), 'back on step 1');
  check('/a/svc-iam', false);
  check('/a/svc-pay', true);

  click(window, doc.getElementById('wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(stepVisible(doc, 'metrics'), 'metrics pane again');
  const radios = [...doc.querySelectorAll('#wiz-metrics-list input[name="tm-home"]')];
  assert.equal(radios.length, 1, 'only svc-pay records in round 2');
  assert.equal(radios[0].value, '/a/svc-pay');
  assert.equal(radios[0].checked, true, 'the new single recording member is pre-selected');

  click(window, doc.getElementById('wiz-start-scan'));
  await new Promise((r) => setTimeout(r, 0));
  ws().deliver({ type: 'scan-done', scanId: 'scan_stale', description: '# Workspace: St', projects: [], graphify: { used: false } });
  await new Promise((r) => setTimeout(r, 0));
  click(window, doc.querySelector('#wiz-save'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].metricsProject, '/a/svc-pay', 'the new single recording member, never the deselected /a/svc-iam');
});

test('Skip -> Back -> Next keeps "no home" (does not re-apply the single-recording-member default)', async () => {
  const posts = [];
  const { window, ws } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/workspaces/metrics-scan')) return Promise.resolve({ ok: true, status: 200, json: async () => WIZ_MEMBERS });
      if (u.endsWith('/api/workspaces/scan') && opts.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: 'scan_skip' }) });
      if (u.endsWith('/api/workspaces') && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 201, json: async () => ({ workspace: { id: 'wks-skip', name: 'Sk', description: '', projectPaths: [], projectKeys: [], exists: [] } }) });
      }
      return null;
    },
  });
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'Sk';
  doc.querySelector('#wiz-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  for (const v of ['/a/svc-iam', '/a/svc-ui']) {
    const cb = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === v);
    cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  }

  click(window, doc.getElementById('wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  click(window, doc.getElementById('wiz-metrics-skip'));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(stepVisible(doc, 2), 'Skip proceeds straight to the scan');

  click(window, doc.getElementById('wiz-abort'));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(stepVisible(doc, 1), 'abort returns to step 1');

  click(window, doc.getElementById('wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(stepVisible(doc, 'metrics'), 'back on the metrics pane');
  const radios = [...doc.querySelectorAll('#wiz-metrics-list input[name="tm-home"]')];
  assert.ok(radios.length === 0 || radios.every((r) => !r.checked), '"no home" survives the round trip — the single recording member is not re-applied');

  click(window, doc.getElementById('wiz-start-scan'));
  await new Promise((r) => setTimeout(r, 0));
  ws().deliver({ type: 'scan-done', scanId: 'scan_skip', description: '# Workspace: Sk', projects: [], graphify: { used: false } });
  await new Promise((r) => setTimeout(r, 0));
  click(window, doc.querySelector('#wiz-save'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].metricsProject, null, 'no home was explicitly kept through the round trip');
});

test('"Enable now…" on another member keeps the earlier automatic pre-selection instead of dropping it', async () => {
  const posts = [];
  let enabled = false;
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/workspaces/metrics-scan')) return Promise.resolve({ ok: true, status: 200, json: async () => (enabled ? MEMBERS_ROUND1 : WIZ_MEMBERS) });
      if (u.endsWith('/api/projects')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [
          { name: 'svc-iam', path: '/a/svc-iam', key: 'svc-iam-1', exists: true },
          { name: 'svc-ui', path: '/a/svc-ui', key: 'svc-ui-1', exists: true },
        ] }) });
      }
      if (u.includes('/api/team-metrics/scopes')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          projects: [
            { key: 'svc-iam-1', name: 'svc-iam', slug: 'me/svc-iam', hasOrigin: true, enabled: true, recordsLocally: true, runs: 1 },
            { key: 'svc-ui-1', name: 'svc-ui', slug: 'me/svc-ui', hasOrigin: true, enabled: false, recordsLocally: false },
          ],
          workspaces: [],
        }) });
      }
      if (/\/api\/projects\/svc-ui-1\/team-metrics\/enable$/.test(u) && opts.method === 'POST') {
        enabled = true;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      if (u.endsWith('/api/workspaces/scan') && opts.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: 'scan_enablenow' }) });
      if (u.endsWith('/api/workspaces') && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 201, json: async () => ({ workspace: { id: 'wks-en', name: 'En', description: '', projectPaths: [], projectKeys: [], exists: [] } }) });
      }
      return null;
    },
  });
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'En';
  doc.querySelector('#wiz-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  for (const v of ['/a/svc-iam', '/a/svc-ui']) {
    const cb = [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === v);
    cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  }

  click(window, doc.getElementById('wiz-next-metrics'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  let iamRadio = doc.querySelector('#wiz-metrics-list input[name="tm-home"][value="/a/svc-iam"]');
  assert.equal(iamRadio.checked, true, 'svc-iam auto-pre-selected as the only recording member');
  assert.equal(doc.getElementById('wiz-metrics-pre').hidden, false, 'pre-selection hint shown');

  click(window, doc.querySelector('#wiz-metrics-list .wiz-row[data-path="/a/svc-ui"] .tm-enable-now'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.getElementById('plugin-modal').classList.contains('hidden'), false, 'enable dialog opened');
  click(window, doc.querySelector('#plugin-modal .tm-enable-submit'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const radios = [...doc.querySelectorAll('#wiz-metrics-list input[name="tm-home"]')];
  assert.equal(radios.length, 2, 'both members now have a radio');
  iamRadio = radios.find((r) => r.value === '/a/svc-iam');
  assert.equal(iamRadio.checked, true, 'the earlier pre-selected svc-iam is still selected, not dropped');

  click(window, doc.getElementById('wiz-start-scan'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
});
