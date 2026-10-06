// test/ui-history-workspace.test.mjs — jsdom boot tests for the Runs list's
// workspace-run cosmetics: a workspace row (projectKey="workspaces/<key>",
// target:'workspace') forms its own group keyed by that literal path segment,
// and the group's name prefers p.workspaceName. (The project pills, and the "WS"
// badge they carried, are gone: D4.)
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

// Mix of a normal project row and two workspace rows (same workspace key).
const HISTORY = [
  { id: 'p1', title: 'project run', status: 'done', startedAt: '2026-06-04T00:00:00Z', projectName: 'Alpha', projectKey: 'alpha-00000001', projectDir: '/x/alpha' },
  { id: 'w2', title: 'ws run two', status: 'done', startedAt: '2026-06-03T00:00:00Z', target: 'workspace', workspaceName: 'IoT Platform', projectName: 'svc-iam', projectKey: 'workspaces/wks-iot-9f3a1c20', projectDir: '/abs/iam' },
  { id: 'w1', title: 'ws run one', status: 'stopped', startedAt: '2026-06-02T00:00:00Z', target: 'workspace', workspaceName: 'IoT Platform', projectName: 'svc-iam', projectKey: 'workspaces/wks-iot-9f3a1c20', projectDir: '/abs/iam' },
];
const histResp = (pipelines) => Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, ghAvailable: false }) });
const WKS_KEY = 'workspaces/wks-iot-9f3a1c20';

// A persisted state with a stepper + audit markdown, the shape both
// readPipelineByKey and readWorkspacePipeline return ({state, auditMarkdown}).
const PIPELINE_DETAIL = { state: { id: 'w2', status: 'done', stepper: null, steps: [], totalCostUsd: 0, totalActiveMs: 0, phase: 'done' }, auditMarkdown: '# audit' };

async function boot({ local, fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
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
    // endsWith, not includes: the keyed detail URL /api/history/<key>/<id> would
    // otherwise be swallowed by the list arm.
    if (u.endsWith('/api/history')) return histResp(HISTORY);
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const show = () => { window.location.hash = 'runs'; window.dispatchEvent(new window.Event('hashchange')); };
  // Open the run's DETAIL screen (#history/<key>/<id>) in the Runs pane.
  const showDetail = (key, id) => { window.location.hash = `history/${key}/${id}`; window.dispatchEvent(new window.Event('hashchange')); };
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { window, show, reqs, showDetail, settle };
}

test('a workspace run forms its own group keyed by the literal path segment, named by workspaceName, holding exactly its own runs', async () => {
  const { window, show } = await boot();
  show();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  await checkRows([
    { name: 'a workspace run forms its own group keyed by the literal path segment, named by workspaceName', run: () => {
      // The project pills (and their WS badge) are gone (D4): the workspace is a group of the Runs list.
      assert.equal(doc.querySelectorAll('#historyFilter .hist-pill').length, 0, 'no project pills');
      const ws = doc.querySelector(`#runs-list .runs-group[data-group-key="${WKS_KEY}"]`);
      assert.ok(ws, 'workspace group keyed by the literal projectKey path segment');
      assert.equal(ws.querySelector('.runs-group-name').textContent, 'IoT Platform', 'named by workspaceName, not the member projectName');
      assert.equal(ws.querySelector('.runs-count').textContent, '2');
      // The plain project row is NOT in the workspace group.
      const alpha = doc.querySelector('#runs-list .runs-group[data-group-key="alpha-00000001"]');
      assert.ok(alpha);
      assert.equal(ws.querySelector('.runs-row[data-pipeline-id="p1"]'), null);
    } },
    { name: 'the Runs list groups the workspace runs under a workspaceName header', run: () => {
      const groups = [...doc.querySelectorAll('#runs-list .runs-group')];
      assert.equal(groups.length, 2, 'one project group + one workspace group');
      // Read name and count apart: the head's textContent runs them together ("IoT Platform2").
      const heads = groups.map((g) => `${g.querySelector('.runs-group-name').textContent} ${g.querySelector('.runs-count').textContent}`);
      assert.ok(heads.includes('IoT Platform 2'), 'workspace group header uses workspaceName');
      assert.ok(heads.includes('Alpha 1'), 'project group unchanged');
    } },
    { name: 'the workspace group holds exactly its own runs (literal path-segment key)', run: () => {
      const rows = [...doc.querySelectorAll(`#runs-list .runs-group[data-group-key="${WKS_KEY}"] .runs-row`)];
      assert.deepEqual(rows.map((r) => r.dataset.pipelineId), ['w2', 'w1'], 'two workspace runs, newest first');
      assert.ok(rows.every((r) => r.dataset.projectKey === WKS_KEY), 'each row carries the literal key');
      assert.equal(doc.querySelectorAll(`#runs-list .runs-row[data-project-key="${WKS_KEY}"]`).length, 2,
        'and no workspace row lands in another group');
    } },
  ]);
});

// ── M6↔M2 integration boundary: the three row actions must route a WORKSPACE row
// to the workspace-aware endpoints (the slashed projectKey 404s on the single-
// project routes). Single-project rows keep the old URLs (byte-identity). ──

test('opening a workspace row fetches GET /api/workspaces/<wksId>/runs/<id> (not /api/history/...)', async () => {
  const detailReqs = [];
  const { window, show, reqs, settle } = await boot({
    fetchHandler: (u) => {
      if (/\/api\/workspaces\/.+\/runs\//.test(u)) { detailReqs.push(u); return Promise.resolve({ ok: true, status: 200, json: async () => PIPELINE_DETAIL }); }
      return null;
    },
  });
  show();
  await new Promise((r) => setTimeout(r, 0));
  // Nothing is open yet, so the click navigates (a click on the open run's row changes nothing).
  const row = window.document.querySelector(`#runs-list .runs-row[data-project-key="${WKS_KEY}"]`);
  row.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await settle();

  assert.equal(window.location.hash.replace(/^#/, ''), 'history/workspaces/wks-iot-9f3a1c20/w2',
    'the row click navigates to the run\'s detail screen');
  assert.equal(detailReqs.length, 1, 'one detail fetch');
  assert.match(detailReqs[0], /\/api\/workspaces\/wks-iot-9f3a1c20\/runs\/w2$/, 'workspace-aware detail URL with the BARE wks id');
  // It must NOT have hit the single-project key route (which would 404 on the slash).
  assert.ok(!reqs.some((r) => r.url.includes('/api/history/workspaces')), 'never builds /api/history/workspaces%2F...');
  // The shared {state,...} shape renders the stepper (no error state).
  assert.equal(window.document.querySelector('#hist-detail .hd-error').hidden, true, 'detail rendered from the workspace route');
});

test('archiving a workspace row sends DELETE /api/runs/<id>?workspaceId=<wksId> (not ?projectKey=...)', async () => {
  const delReqs = [];
  const { window, show, showDetail, settle } = await boot({
    fetchHandler: (u, opts) => {
      if (opts.method === 'DELETE' && /\/api\/runs\//.test(u)) { delReqs.push(u); return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, warnings: [] }) }); }
      if (/\/api\/workspaces\/.+\/runs\//.test(u)) return Promise.resolve({ ok: true, status: 200, json: async () => PIPELINE_DETAIL });
      return null;
    },
  });
  show();
  await new Promise((r) => setTimeout(r, 0));
  // Archive lives on the DETAIL screen now, behind confirmModal (not window.confirm).
  showDetail('workspaces/wks-iot-9f3a1c20', 'w2');
  await settle();
  const del = window.document.querySelector('#hist-detail .hd-archive');
  assert.equal(del.hidden, false, 'archive shown for a finished workspace run');
  del.dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle();
  window.document.querySelector('#confirm-ok').click();
  await settle(5);

  assert.equal(delReqs.length, 1);
  assert.match(delReqs[0], /\/api\/runs\/w2\?workspaceId=wks-iot-9f3a1c20$/, 'delete routes by bare workspaceId');
  assert.ok(!delReqs[0].includes('projectKey'), 'never sends the slashed ?projectKey for a workspace row');
});

test('single-project rows keep the OLD URLs (byte-identity): /api/history/:key/:id + ?projectKey=', async () => {
  const seen = [];
  const { window, show, showDetail, settle } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/history/alpha-00000001/')) { seen.push(u); return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: { id: 'p1', status: 'done', stepper: null, steps: [] }, auditMarkdown: '# a' } ) }); }
      if (opts.method === 'DELETE' && /\/api\/runs\//.test(u)) { seen.push(u + ' [DELETE]'); return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }); }
      return null;
    },
  });
  show();
  await new Promise((r) => setTimeout(r, 0));
  showDetail('alpha-00000001', 'p1');
  await settle();
  window.document.querySelector('#hist-detail .hd-archive').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle();
  window.document.querySelector('#confirm-ok').click();
  await settle(5);

  assert.ok(seen.some((u) => /\/api\/history\/alpha-00000001\/p1$/.test(u)), 'project detail uses the by-key history route');
  assert.ok(seen.some((u) => /\/api\/runs\/p1\?projectKey=alpha-00000001 \[DELETE\]$/.test(u)), 'project delete still sends ?projectKey=');
  assert.ok(!seen.some((u) => u.includes('/api/workspaces/')), 'a single-project row never hits a workspace route');
});

test('detail: a workspace run whose primary branch was dropped (no changes) shows no copyable branch', async () => {
  const detail = { ...PIPELINE_DETAIL, state: { ...PIPELINE_DETAIL.state, target: 'workspace',
    branch: { source: 'main', feature: 'worca-cc/gone-w2', branchKept: false, branchDeleted: { reason: 'unchanged', at: 'x' } } } };
  const { window, showDetail, settle } = await boot({
    fetchHandler: (u) => (/\/api\/workspaces\/.+\/runs\/w2$/.test(u)
      ? Promise.resolve({ ok: true, status: 200, json: async () => detail }) : null),
  });
  showDetail(WKS_KEY, 'w2');
  await settle(6);
  const doc = window.document;
  assert.equal(doc.querySelector('#hist-detail .hd-branch-copy').hidden, true, 'no copy button for a deleted branch');
  const base = doc.querySelector('#hist-detail .hd-base');
  assert.equal(base.hidden, false);
  assert.match(base.textContent, /No branch — no changes/);
});

test('detail: a kept workspace branch still paints source → feature with a copy button', async () => {
  const detail = { ...PIPELINE_DETAIL, state: { ...PIPELINE_DETAIL.state, target: 'workspace',
    branch: { source: 'main', feature: 'worca-cc/kept-w2', branchKept: true } } };
  const { window, showDetail, settle } = await boot({
    fetchHandler: (u) => (/\/api\/workspaces\/.+\/runs\/w2$/.test(u)
      ? Promise.resolve({ ok: true, status: 200, json: async () => detail }) : null),
  });
  showDetail(WKS_KEY, 'w2');
  await settle(6);
  const doc = window.document;
  assert.equal(doc.querySelector('#hist-detail .hd-branch-copy').hidden, false);
  assert.equal(doc.querySelector('#hist-detail .hd-branch-name').textContent, 'worca-cc/kept-w2');
  assert.equal(doc.querySelector('#hist-detail .hd-base').textContent, 'main →');
});
