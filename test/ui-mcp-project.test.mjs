// test/ui-mcp-project.test.mjs — the project MCP tab, the workspace overview card and the Ask Worca
// settings block (spec §8, §9.5): chips and ×, Add set, "Include General in runs", the zero-set text,
// the resolution table from POST /api/mcp/preview, and the booted #projects/<key>/mcp route.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { renderResolution, mountProjectMcp, paintMcpResolution, paintAskMcpBlock } from '../ui/public/mcp-view.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const SETS = [
  { id: 'general', name: 'General', members: [{ serverId: 'plugin:acme-tools/jira', copy: 'jira', problem: null, test: 'ok' },
    { serverId: 'manual:playwright', copy: 'playwright', problem: null, test: 'none' }] },
  { id: 'billing', name: 'Billing', members: [
    { serverId: 'plugin:acme-tools/sentry', copy: 'sentry_billing', problem: null, test: 'stale' },
    { serverId: 'plugin:acme-tools/jira', copy: 'jira_billing', problem: 'API token not set', test: 'none' }] },
  { id: 'team-acme-platform-9333', name: 'Team · acme/platform', members: [
    { serverId: 'plugin:acme-tools/sentry', copy: 'sentry_team-platfor', problem: null, test: 'none' }] },
];
const PREVIEW = {
  sets: [], started: 2, deviations: [],
  copies: [
    { name: 'sentry_billing', copy: 'sentry_billing', setId: 'billing', setName: 'Billing', serverId: 'plugin:acme-tools/sentry', provisional: true },
    { name: 'playwright', copy: 'playwright', setId: 'general', setName: 'General', serverId: 'manual:playwright' },
  ],
  skipped: [
    { copy: 'jira_billing', setId: 'billing', setName: 'Billing', serverId: 'plugin:acme-tools/jira', reason: 'missing:token', why: 'API token not set' },
    { copy: 'sentry_team-platfor', setId: 'team-acme-platform-9333', setName: 'Team · acme/platform', serverId: 'plugin:acme-tools/sentry',
      reason: 'needs-consent', why: 'turn it on in the team checklist' },
  ],
};

test('the MCP resolution table (copy · set link · status, skip reasons) for a project and for { workspaceId }', async () => {
  await checkRows([
    { name: 'the resolution table: copy · set (a link to its set) · status, skip reasons from the preview\'s why', run: () => {
      const card = renderResolution(doc, 'Servers in runs on billing', PREVIEW, SETS);
      const rows = [...card.querySelectorAll('.mcp-res-row')].map((r) => [...r.children].map((c) => c.textContent));
      assert.deepEqual(rows, [
        ['jira_billing', 'Billing', 'API token not set in Billing'],
        ['playwright', 'General', 'not tested'],
        ['sentry_billing · name provisional', 'Billing', 'stale'],
        ['sentry_team-platfor', 'Team · acme/platform', 'off — turn it on in the team checklist'],
      ]);
      assert.equal(card.querySelector('.mcp-res-row a').getAttribute('href'), '#connectors/sets/billing');
      assert.match(card.textContent, /renamed with _w when the run starts/);
      const gone = renderResolution(doc, 'x', { copies: [PREVIEW.copies[1]], skipped: [{ copy: null, setId: 'billing', setName: 'Billing',
        serverId: 'manual:gone', reason: 'missing-server', why: 'the server is no longer installed' }] }, SETS);
      assert.deepEqual([...gone.querySelectorAll('.mcp-res-row')].map((r) => r.firstChild.textContent), ['manual:gone', 'playwright'], 'a missing-server skip has no copy name');
      const empty = renderResolution(doc, 'x', { copies: [], skipped: [] }, [], 'workspace');
      assert.match(empty.textContent, /No MCP servers in runs on this workspace/);
    } },
    { name: 'workspace overview: the same table for { workspaceId }', run: async () => {
      const host = doc.createElement('div');
      const { api, calls } = fakeApi(null);
      await paintMcpResolution(host, { target: { workspaceId: 'wks-checkout-1234abcd' }, title: 'MCP servers in runs on checkout', api, doc });
      assert.deepEqual(calls[0], ['POST', '/api/mcp/preview', { target: { workspaceId: 'wks-checkout-1234abcd' } }]);
      assert.equal(host.querySelectorAll('.mcp-res-row').length, 4);
      const js = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
      assert.match(js, /paintMcpResolution\(mcp, \{ target: \{ workspaceId: id \}/, 'buildWdOverview paints it');
    } },
  ]);
});

function fakeApi(assignment) {
  const calls = [];
  const api = async (method, path, body) => {
    calls.push([method, path, body]);
    if (method === 'GET' && path.startsWith('/api/mcp/projects/')) return { ok: true, status: 200, data: assignment };
    if (path === '/api/mcp/preview') return { ok: true, status: 200, data: PREVIEW };
    if (path === '/api/mcp/sets') return { ok: true, status: 200, data: { sets: SETS } };
    return { ok: true, status: 200, data: { ok: true } };
  };
  return { api, calls, writes: () => calls.filter(([m, p]) => m === 'PUT') };
}

test('project MCP tab: chips with ×, read-only Team chip, Add set, Include General help; a project resolving to no sets says so', async () => {
  await checkRows([
    { name: 'project tab: chips with ×, the read-only Team chip, Add set, Include General in runs with its help', run: async () => {
      const a = { sets: [{ id: 'billing', name: 'Billing' }], includeGeneral: false, none: false,
        team: { id: 'team-acme-platform-9333', name: 'Team · acme/platform', home: 'acme/platform' }, choices: [{ id: 'shop', name: 'Shop' }] };
      const sec = doc.createElement('section');
      const { api, calls, writes } = fakeApi(a);
      await mountProjectMcp(sec, { key: 'billing-1a2b3c4d', name: 'billing', api, doc });
      const chips = [...sec.querySelectorAll('.mcp-proj-sets .mcp-chip')];
      assert.deepEqual(chips.map((c) => c.textContent), ['Billing×', 'Team · acme/platform']);
      assert.equal(chips[1].querySelector('button'), null, 'the Team chip is read-only');
      assert.equal(chips[1].getAttribute('href'), '#connectors/sets/team-acme-platform-9333');
      assert.match(sec.textContent, /Include General in runs/);
      assert.match(sec.textContent, /Ask Worca always includes General; a workspace run includes it when any member does/);
      assert.deepEqual(calls.find(([, p]) => p === '/api/mcp/preview')[2], { target: { projectKey: 'billing-1a2b3c4d' } });
      assert.match(sec.querySelector('.mcp-resolution h2').textContent, /Servers in runs on billing/);
      const sw = sec.querySelector('input[aria-label="Include General in runs"]');
      sw.checked = true;
      sw.dispatchEvent(new doc.defaultView.Event('change'));
      await settle();
      const sel = sec.querySelector('select.mcp-add-set');
      sel.value = 'shop';
      sel.dispatchEvent(new doc.defaultView.Event('change'));
      await settle();
      sec.querySelector('.mcp-chip button').click();
      await settle();
      assert.deepEqual(writes().map(([, , b]) => b), [
        { sets: ['billing'], includeGeneral: true },
        { sets: ['billing', 'shop'], includeGeneral: false },
        { sets: [], includeGeneral: false },
      ]);
    } },
    { name: 'project tab: a project that resolves to no sets says so', run: async () => {
      const sec = doc.createElement('section');
      const { api } = fakeApi({ sets: [], includeGeneral: false, none: true, team: null, choices: [] });
      await mountProjectMcp(sec, { key: 'shop-2b3c4d5e', name: 'shop', api, doc });
      assert.match(sec.querySelector('.mcp-proj-sets').textContent, /No MCP servers in runs on this project/);
      const { api: api2 } = fakeApi({ sets: [], includeGeneral: true, none: false, team: null, choices: [] });
      await mountProjectMcp(sec, { key: 'shop-2b3c4d5e', name: 'shop', api: api2, doc });
      assert.doesNotMatch(sec.querySelector('.mcp-proj-sets').textContent, /No MCP servers/);
    } },
  ]);
});

// ── the booted project page ──────────────────────────────────────────────────
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
class WSStub { constructor() { WSStub.last = this; this._l = {}; } send() {} close() {}
  addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); } _open() { (this._l.open || []).forEach((fn) => fn({})); } }

test('#projects/<key>/mcp opens the MCP tab (Advanced) and the pill writes that hash; Settings › Ask Worca paints its MCP block', async () => {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4321/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  const calls = [];
  window.fetch = (u, opts = {}) => {
    const s = String(u);
    calls.push(`${opts.method || 'GET'} ${s}`);
    const json = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
    if (s.startsWith('/api/mcp/projects/')) return json({ sets: [], includeGeneral: true, none: false, team: null, choices: [] });
    if (s === '/api/mcp/preview') return json(PREVIEW);
    if (s === '/api/mcp/sets') return json({ sets: SETS });
    if (s.includes('/api/projects')) return json({ projects: [{ name: 'alpha', path: '/Users/me/dev/alpha', exists: true, key: 'alpha-00000001' }] });
    if (s.includes('/api/history')) return json({ pipelines: [], ghAvailable: false });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  if (WSStub.last) WSStub.last._open();
  window.location.hash = 'projects/alpha-00000001/mcp';
  await settle(); await settle();
  const d = window.document;
  const tab = d.querySelector('#proj-detail .pd-tab[data-sec="mcp"]');
  assert.ok(tab, 'the MCP pill');
  assert.equal(tab.dataset.minLevel, 'advanced');
  assert.ok(tab.classList.contains('active'));
  assert.ok(calls.includes('GET /api/mcp/projects/alpha-00000001'));
  assert.ok(d.querySelector('#proj-detail .pd-sec[data-sec="mcp"] .mcp-proj-sets'));
  d.getElementById('pd-tab-overview').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle();
  d.getElementById('pd-tab-mcp').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle();
  assert.equal(window.location.hash, '#projects/alpha-00000001/mcp', 'projParamFor keeps the tab in the hash');
  window.location.hash = 'settings/ask';
  await settle(); await settle();
  assert.deepEqual([...d.querySelectorAll('#ask-mcp-host .chip')].map((c) => c.textContent), ['jira', 'playwright'], 'showSettingsTab paints the Ask block');
});
