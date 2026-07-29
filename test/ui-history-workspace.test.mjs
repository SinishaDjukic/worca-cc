// test/ui-history-workspace.test.mjs — jsdom boot tests for the History view's
// workspace-run cosmetics: a workspace row (projectKey="workspaces/<key>",
// target:'workspace') forms its own pill/group keyed by that literal path
// segment, the label prefers p.workspaceName, and the pill carries a "WS" badge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

// Mix of a normal project row and two workspace rows (same workspace key).
const HISTORY = [
  { id: 'p1', title: 'project run', status: 'done', startedAt: '2026-06-04T00:00:00Z', projectName: 'Alpha', projectKey: 'alpha-00000001', projectDir: '/x/alpha' },
  { id: 'w2', title: 'ws run two', status: 'done', startedAt: '2026-06-03T00:00:00Z', target: 'workspace', workspaceName: 'IoT Platform', projectName: 'svc-iam', projectKey: 'workspaces/wks-iot-9f3a1c20', projectDir: '/abs/iam' },
  { id: 'w1', title: 'ws run one', status: 'stopped', startedAt: '2026-06-02T00:00:00Z', target: 'workspace', workspaceName: 'IoT Platform', projectName: 'svc-iam', projectKey: 'workspaces/wks-iot-9f3a1c20', projectDir: '/abs/iam' },
];
const histResp = (pipelines) => Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, ghAvailable: false }) });
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// A persisted state with a stepper + audit markdown, the shape both
// readPipelineByKey and readWorkspacePipeline return ({state, auditMarkdown}).
const PIPELINE_DETAIL = { state: { id: 'w2', status: 'done', stepper: null, steps: [], totalCostUsd: 0, totalActiveMs: 0, phase: 'done' }, auditMarkdown: '# audit' };

async function boot({ local, fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  const reqs = []; // every requested URL (+ method), for action-routing assertions
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.confirm = () => true;
  if (local) for (const [k, v] of Object.entries(local)) window.localStorage.setItem(k, v);
  window.fetch = (url, opts) => {
    const u = String(url);
    reqs.push({ url: u, method: (opts && opts.method) || 'GET' });
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/history')) return histResp(HISTORY);
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const show = () => { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); };
  return { window, show, reqs };
}
const filterTo = (window, key) => {
  const pill = [...window.document.querySelectorAll('#historyFilter .hist-pill')].find((p) => p.dataset.projectKey === key);
  pill.dispatchEvent(new window.Event('click', { bubbles: true }));
};

test('a workspace run forms its own pill labelled by workspaceName, carrying the WS badge', async () => {
  const { window, show } = await boot();
  show();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  const pills = [...doc.querySelectorAll('#historyFilter .hist-pill')];
  // All Projects + Alpha + IoT Platform (the workspace bucket).
  assert.equal(pills.length, 3);
  const wsPill = pills.find((p) => p.dataset.projectKey === 'workspaces/wks-iot-9f3a1c20');
  assert.ok(wsPill, 'workspace pill keyed by the literal projectKey path segment');
  assert.match(norm(wsPill.textContent), /IoT Platform 2/, 'labelled by workspaceName, count 2');
  assert.ok(wsPill.classList.contains('ws'), 'workspace pill carries the .ws badge class');
  // The plain project pill is NOT a workspace pill.
  const alphaPill = pills.find((p) => p.dataset.projectKey === 'alpha-00000001');
  assert.equal(alphaPill.classList.contains('ws'), false);
});

test('All Projects view groups the workspace runs under a workspaceName header', async () => {
  const { window, show } = await boot();
  show();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  const groups = [...doc.querySelectorAll('#history .hist-group')];
  assert.equal(groups.length, 2, 'one project group + one workspace group');
  const heads = groups.map((g) => norm(g.querySelector('.hist-group-head').textContent));
  assert.ok(heads.includes('IoT Platform 2'), 'workspace group header uses workspaceName');
  assert.ok(heads.includes('Alpha 1'), 'project group unchanged');
});

test('filtering to the workspace pill shows only its runs (literal path-segment filter)', async () => {
  const { window, show } = await boot();
  show();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  const wsPill = [...doc.querySelectorAll('#historyFilter .hist-pill')].find((p) => p.dataset.projectKey === 'workspaces/wks-iot-9f3a1c20');
  wsPill.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelectorAll('#history .hist-group').length, 0, 'single bucket → flat list');
  assert.equal(doc.querySelectorAll('#history .hist-card').length, 2, 'two workspace runs');
  // Sidebar badge = TOTAL across all buckets regardless of the active filter (Q4): the
  // workspace pill narrows the list to its 2 runs, but the badge reads the full 3.
  assert.equal(doc.querySelector('#nav-history-count').textContent, '3');
  assert.equal(window.localStorage.getItem('worca-cc.history.project'), 'workspaces/wks-iot-9f3a1c20', 'filter persisted by literal key');
});

// ── M6↔M2 integration boundary: the three row actions must route a WORKSPACE row
// to the workspace-aware endpoints (the slashed projectKey 404s on the single-
// project routes). Single-project rows keep the old URLs (byte-identity). ──

test('expanding a workspace row fetches GET /api/workspaces/<wksId>/runs/<id> (not /api/history/...)', async () => {
  const detailReqs = [];
  const { window, show, reqs } = await boot({
    fetchHandler: (u) => {
      if (/\/api\/workspaces\/.+\/runs\//.test(u)) { detailReqs.push(u); return Promise.resolve({ ok: true, status: 200, json: async () => PIPELINE_DETAIL }); }
      return null;
    },
  });
  show();
  await new Promise((r) => setTimeout(r, 0));
  filterTo(window, 'workspaces/wks-iot-9f3a1c20'); // flat list of the two ws runs
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  card.querySelector('.hist-head').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(detailReqs.length, 1, 'one detail fetch');
  assert.match(detailReqs[0], /\/api\/workspaces\/wks-iot-9f3a1c20\/runs\/w2$/, 'workspace-aware detail URL with the BARE wks id');
  // It must NOT have hit the single-project key route (which would 404 on the slash).
  assert.ok(!reqs.some((r) => r.url.includes('/api/history/workspaces')), 'never builds /api/history/workspaces%2F...');
  // The shared {state,...} shape renders the stepper (no detail-error note).
  assert.equal(card.querySelector('.detail-error'), null, 'detail rendered from the workspace route');
});

test('opening a workspace row (title click) fetches the workspace route for the markdown viewer', async () => {
  const viewReqs = [];
  const { window, show } = await boot({
    fetchHandler: (u) => {
      if (/\/api\/workspaces\/.+\/runs\//.test(u)) { viewReqs.push(u); return Promise.resolve({ ok: true, status: 200, json: async () => PIPELINE_DETAIL }); }
      return null;
    },
  });
  show();
  await new Promise((r) => setTimeout(r, 0));
  filterTo(window, 'workspaces/wks-iot-9f3a1c20');
  await new Promise((r) => setTimeout(r, 0));
  window.document.querySelector('#history .hist-card .h-meta b').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(viewReqs.length, 1);
  assert.match(viewReqs[0], /\/api\/workspaces\/wks-iot-9f3a1c20\/runs\/w2$/);
});

test('deleting a workspace row sends DELETE /api/runs/<id>?workspaceId=<wksId> (not ?projectKey=...)', async () => {
  const delReqs = [];
  const { window, show } = await boot({
    fetchHandler: (u, opts) => {
      if (opts.method === 'DELETE' && /\/api\/runs\//.test(u)) { delReqs.push(u); return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, warnings: [] }) }); }
      return null;
    },
  });
  show();
  await new Promise((r) => setTimeout(r, 0));
  filterTo(window, 'workspaces/wks-iot-9f3a1c20');
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  card.querySelector('.hist-head').dispatchEvent(new window.Event('click', { bubbles: true })); // reveal delete btn
  await new Promise((r) => setTimeout(r, 0));
  const del = card.querySelector('.hist-delete');
  assert.equal(del.hidden, false, 'delete shown for a finished workspace run');
  del.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(delReqs.length, 1);
  assert.match(delReqs[0], /\/api\/runs\/w2\?workspaceId=wks-iot-9f3a1c20$/, 'delete routes by bare workspaceId');
  assert.ok(!delReqs[0].includes('projectKey'), 'never sends the slashed ?projectKey for a workspace row');
});

test('single-project rows keep the OLD URLs (byte-identity): /api/history/:key/:id + ?projectKey=', async () => {
  const seen = [];
  const { window, show } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/history/alpha-00000001/')) { seen.push(u); return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: { id: 'p1', status: 'done', stepper: null, steps: [] }, auditMarkdown: '# a' } ) }); }
      if (opts.method === 'DELETE' && /\/api\/runs\//.test(u)) { seen.push(u + ' [DELETE]'); return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }); }
      return null;
    },
  });
  show();
  await new Promise((r) => setTimeout(r, 0));
  filterTo(window, 'alpha-00000001');
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  card.querySelector('.hist-head').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  card.querySelector('.hist-delete').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(seen.some((u) => /\/api\/history\/alpha-00000001\/p1$/.test(u)), 'project detail uses the by-key history route');
  assert.ok(seen.some((u) => /\/api\/runs\/p1\?projectKey=alpha-00000001 \[DELETE\]$/.test(u)), 'project delete still sends ?projectKey=');
  assert.ok(!seen.some((u) => u.includes('/api/workspaces/')), 'a single-project row never hits a workspace route');
});
