// test/ui-workspace-scan-model.test.mjs — the choose-a-scan-model window: the header's "Scan
// model" control (label, open, Save → PUT /scan-models, Clear → PUT null) and a Re-scan that
// answers 428 SCAN_MODEL_REQUIRED opening the window and, on Save, persisting + re-starting the
// scan with the picked model (`{ models: pick }`).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const CATALOG = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', efforts: ['medium', 'high', 'xhigh', 'max'] },
];
const DEFAULTS = { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' };
const PICK = { scanModel: 'claude-opus-5-5', scanEffort: 'high', agentModel: 'opus', agentEffort: 'xhigh' };
const WS = [
  { id: 'wks-a1a1a1a1a1a1000001', name: 'Alpha WS', description: '# Workspace: Alpha\n## Overview\ntwo svcs', projectPaths: ['/a/svc-iam', '/a/svc-ui'], projectKeys: ['k1', 'k2'], exists: [true, true], scanModels: PICK, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-18T10:00:00.000Z' },
  { id: 'wks-b2b2b2b2b2b2000002', name: 'Beta WS', description: '', projectPaths: ['/b/api', '/b/web'], projectKeys: ['k3', 'k4'], exists: [true, false], scanModels: null, createdAt: 'x', updatedAt: 'x' },
];
const PROJECTS = [
  { name: 'svc-iam', path: '/a/svc-iam', exists: true, key: 'k1' },
  { name: 'svc-ui', path: '/a/svc-ui', exists: true, key: 'k2' },
];

class WSStub {
  constructor() { this.readyState = 1; this._listeners = {}; WSStub.last = this; }
  send(t) { (this.sent = this.sent || []).push(t); } close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
}

const settle = async (n = 8) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const tick = () => new Promise((r) => setTimeout(r, 0));

async function boot({ ws = WS, scanAnswers = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  // The persisted picks per workspace id (the PUT mutates it so a later GET/label sees it).
  const scanModels = new Map((ws.map((w) => [w.id, w.scanModels || null])).filter(([, p]) => p != null));
  const putBodies = [];
  const scanPosts = [];
  const memberPosts = [];
  const list = () => ws.map((w) => ({ ...w, scanModels: scanModels.has(w.id) ? scanModels.get(w.id) : null }));
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    if (u.includes('/api/settings')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaceScan: null, workspaceScanDefault: DEFAULTS }) });
    if (u.includes('/api/config')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: CATALOG, efforts: ['medium', 'high'] }) });
    if (u.endsWith('/api/workspaces') || u.includes('/api/workspaces?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: list() }) });
    // A member change of a pick-less workspace answers needsModel (the server's startAutoRescan).
    const membersS = u.match(/\/api\/workspaces\/(wks-[0-9a-f-]+)\/members$/);
    if (membersS && method === 'POST') {
      memberPosts.push({ id: membersS[1], body: JSON.parse(opts.body || '{}') });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspace: list().find((w) => w.id === membersS[1]), clearedHomes: [], rescan: { needsModel: true } }) });
    }
    const scanM = u.match(/\/api\/workspaces\/(wks-[0-9a-f-]+)\/scan-models$/);
    if (scanM && method === 'PUT') {
      const body = JSON.parse(opts.body || '{}');
      putBodies.push(body);
      const pick = body.workspaceScan || null;
      const id = scanM[1];
      if (pick) scanModels.set(id, pick); else scanModels.delete(id);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspace: list().find((w) => w.id === id) }) });
    }
    const scanS = u.match(/\/api\/workspaces\/(wks-[0-9a-f-]+)\/scan$/);
    if (scanS && method === 'POST') {
      scanPosts.push({ url: u, id: scanS[1], body: JSON.parse(opts.body || '{}') });
      const answer = scanAnswers ? scanAnswers(scanPosts.length - 1, scanPosts[scanPosts.length - 1]) : null;
      if (answer) {
        const { status, body } = answer;
        return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        runId: 'run-rescan', workspaceId: scanS[1], title: `Workspace scan: ${scanS[1]}`,
        projectDir: '/a/svc-iam', projectNames: ['a', 'b'],
      }) });
    }
    if (/\/api\/workspaces\/metrics-scan$/.test(u) && method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ members: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  const show = (hash = 'workspaces') => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); };
  return { window, show, putBodies, scanPosts, memberPosts, scanModels };
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const open = async (window, id) => { window.location.hash = `workspaces/${id}`; await settle(); };

test('the header "Scan model" control labels the saved pick (or "Set scan model") and opens the window; Clear saves null', async () => {
  const { window, putBodies } = await boot();
  await open(window, 'wks-a1a1a1a1a1a1000001');
  let page = window.document.querySelector('#ws-detail .pd.wd');
  assert.equal(page.querySelector('.ws-scan-model-label').textContent, 'Scan: claude-opus-5-5', 'a saved pick labels the control');
  click(window, page.querySelector('.ws-scan-model'));
  await settle();
  let modal = window.document.getElementById('scan-model-modal');
  assert.ok(!modal.classList.contains('hidden'), 'the header control opens the window');
  assert.ok(!window.document.getElementById('scan-model-clear').classList.contains('hidden'), 'the header offers Clear');
  assert.equal(window.document.getElementById('sm-scan-model').value, 'claude-opus-5-5', 'pre-filled from the saved pick');
  // Cancel closes it without writing.
  click(window, window.document.getElementById('scan-model-cancel'));
  await settle();
  assert.ok(modal.classList.contains('hidden'));
  assert.equal(putBodies.length, 0);

  // Clear: the "Clear saved model" action PUTs null and the label drops to "Set scan model".
  click(window, page.querySelector('.ws-scan-model'));
  await settle();
  click(window, window.document.getElementById('scan-model-clear'));
  await settle();
  assert.equal(putBodies.length, 1);
  assert.deepEqual(putBodies[0], { workspaceScan: null });
  page = window.document.querySelector('#ws-detail .pd.wd');
  assert.equal(page.querySelector('.ws-scan-model-label').textContent, 'Set scan model', 'the cleared pick drops the label');

  // A pick-less workspace's control starts unstyled: "Set scan model".
  await open(window, 'wks-b2b2b2b2b2b2000002');
  page = window.document.querySelector('#ws-detail .pd.wd');
  assert.equal(page.querySelector('.ws-scan-model-label').textContent, 'Set scan model');
});

test('the header control saves a changed model: PUT /scan-models carries the four fields and the label updates', async () => {
  const { window, putBodies } = await boot();
  await open(window, 'wks-a1a1a1a1a1a1000001');
  click(window, window.document.querySelector('#ws-detail .ws-scan-model'));
  await settle();
  const doc = window.document;
  const sm = doc.getElementById('sm-scan-model');
  // Swap the scan model and its effort together (the pair rule repaints the effort list).
  sm.value = 'claude-sonnet-5';
  sm.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  doc.getElementById('sm-scan-effort').value = 'medium';
  doc.getElementById('sm-agent-model').value = 'sonnet';
  doc.getElementById('sm-agent-effort').value = 'medium';
  click(window, doc.getElementById('scan-model-ok'));
  await settle();
  assert.equal(putBodies.length, 1);
  assert.deepEqual(putBodies[0], { workspaceScan: { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' } });
  const page = window.document.querySelector('#ws-detail .pd.wd');
  assert.equal(page.querySelector('.ws-scan-model-label').textContent, 'Scan: claude-sonnet-5', 'the saved model labels the control');
});

test('Re-scan of a pick-less workspace (428 SCAN_MODEL_REQUIRED) opens the window; Save PUTs the pick and re-POSTs /scan with it', async () => {
  const { window, putBodies, scanPosts } = await boot({
    ws: [WS[1]],   // pick-less Beta only
    // The FIRST /scan answers 428; the follow-up (with the picked model) succeeds.
    scanAnswers: (i) => (i === 0
      ? { status: 428, body: { code: 'SCAN_MODEL_REQUIRED', error: 'This workspace has no scan model saved (or the saved model is no longer available) — choose one to scan.' } }
      : null),
  });
  await open(window, 'wks-b2b2b2b2b2b2000002');
  const page = window.document.querySelector('#ws-detail .pd.wd');
  click(window, page.querySelector('.ws-rescan'));
  await settle();
  const modal = window.document.getElementById('scan-model-modal');
  assert.ok(!modal.classList.contains('hidden'), '428 opens the choose-a-scan-model window');
  // The window is pre-filled from Settings, and Save is not the way out of a REQUIRED pick —
  // no "Clear saved model" on a required window.
  assert.ok(window.document.getElementById('scan-model-clear').classList.contains('hidden'));
  assert.equal(window.document.getElementById('sm-scan-model').value, 'claude-sonnet-5', 'pre-filled from Settings › Runs › Workspaces');
  // Capture the error node before Save: starting the run navigates away from the ws detail screen.
  const pageErr = page.querySelector('.pd-error');
  click(window, window.document.getElementById('scan-model-ok'));
  await settle();
  assert.equal(window.document.getElementById('scan-model-modal').classList.contains('hidden'), true, 'the window closes on Save');
  assert.equal(putBodies.length, 1, 'the picked model is saved first');
  assert.deepEqual(putBodies[0], { workspaceScan: { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' } });
  // Two POSTs: the refused one, then the follow-up carrying the explicit pick.
  assert.equal(scanPosts.length, 2);
  assert.equal(scanPosts[0].body.models, undefined, 'the first POST had no model');
  assert.deepEqual(scanPosts[1].body.models, { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' },
    'the follow-up POST names the chosen model');
  assert.ok(window.location.hash.startsWith('#running/'), 'the scan run is followed on Running');
  assert.equal(pageErr.textContent, '', 'no cancel error on the page');
});

test('dismissing the pick-a-model window skips the re-scan with a clear message', async () => {
  const { window, putBodies, scanPosts } = await boot({
    ws: [WS[1]],
    scanAnswers: () => ({ status: 428, body: { code: 'SCAN_MODEL_REQUIRED', error: 'This workspace has no scan model saved (or the saved model is no longer available) — choose one to scan.' } }),
  });
  await open(window, 'wks-b2b2b2b2b2b2000002');
  click(window, window.document.querySelector('#ws-detail .ws-rescan'));
  await settle();
  click(window, window.document.getElementById('scan-model-cancel'));
  await settle();
  assert.equal(window.document.getElementById('scan-model-modal').classList.contains('hidden'), true);
  assert.equal(putBodies.length, 0, 'dismissing writes nothing');
  assert.equal(scanPosts.length, 1, 'the refused POST is not retried');
  assert.match(window.document.querySelector('#ws-detail .pd-error').textContent, /choose a scan model/, 'the page explains why it did not scan');
});

test('a member change of a pick-less workspace (rescan.needsModel) opens the window; Save PUTs the pick and re-scans with it (autoRescan)', async () => {
  const { window, putBodies, scanPosts, memberPosts } = await boot({ ws: [WS[1]] });
  await open(window, 'wks-b2b2b2b2b2b2000002');
  const doc = window.document;
  click(window, doc.querySelector('#ws-detail .wd-members-add'));
  await settle();
  // The Add-members plugin modal lists the registered non-members.
  const box = doc.querySelector('#plugin-modal .wd-add-row input[type="checkbox"]');
  assert.ok(box, 'Add lists the registered non-members');
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  click(window, [...doc.querySelectorAll('#plugin-modal button')].find((b) => b.textContent === 'Add'));
  await settle();
  // needsModel opens the pick-a-model window (over the still-open Add modal — the z-index fix).
  const modal = doc.getElementById('scan-model-modal');
  assert.ok(!modal.classList.contains('hidden'), 'a member change with no saved model opens the window');
  assert.equal(doc.getElementById('sm-scan-model').value, 'claude-sonnet-5', 'pre-filled from Settings');
  click(window, doc.getElementById('scan-model-ok'));
  await settle(10);
  assert.deepEqual(memberPosts, [{ id: 'wks-b2b2b2b2b2b2000002', body: { add: ['/a/svc-iam'] } }], 'the member change was posted and recorded');
  assert.equal(putBodies.length, 1, 'Save persisted the pick first');
  assert.deepEqual(putBodies[0], { workspaceScan: { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' } });
  assert.deepEqual(scanPosts[scanPosts.length - 1].body, { models: { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' }, autoRescan: true }, 'the re-scan runs with the pick, tagged autoRescan');
  assert.ok(modal.classList.contains('hidden'), 'the window closes on Save');
  assert.ok(doc.getElementById('plugin-modal').classList.contains('hidden'), 'the Add modal closes after the re-scan starts');
  assert.ok(doc.querySelector('#ws-detail .wd-members .wd-rescan.is-running'), 'the re-scan loader shows the run');
});
