// test/ui-team-policy.test.mjs — the team-policy surfaces wired through the REAL index.html +
// app.js in jsdom (team-policy design §11): the page (table / empty state / editor / Plugins tab),
// the project page's set-up dialog, the New pipeline MCP servers and policy notes, the team-cap
// pause banner with its "continue past" flow, and the MCP strip / checklist. Harness: the ui-cost-paused idiom
// (dispatchable WebSocket stub, recorded fetch calls).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/Users/me/dev/gateway';
const DAY = 86400000;

const PROJECTS = [
  { name: 'gateway', path: PROJECT, exists: true, key: 'gateway-00000001' },
  { name: 'billing-api', path: '/Users/me/dev/billing-api', exists: true, key: 'billing-00000002' },
];
const budget = () => ({ pipelineLimitUsd: 25, totalLimitUsd: 120, resetPeriod: 'monthly', windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY, msUntilReset: 4 * DAY, windowSpendUsd: 62.4, allTimeSpendUsd: 62.4, remainingUsd: 57.6, blocked: false });
const CAPS = { pipeline: { kind: 'soft', value: 10, onBreach: 'pause', requireReason: false }, total: { kind: 'soft', value: 150, onBreach: 'pause', requireReason: false }, resetPeriod: 'monthly', pooled: null };
const HOME_STATUS = { key: 'gateway-00000001', name: 'gateway', path: PROJECT, exists: true, slug: 'acme/gateway', hasOrigin: true, present: true, docKnown: true, unknownSchema: false, warnings: [], delegateTo: null, delegateState: null, blocked: null, home: 'acme/gateway', homeKey: 'gateway-00000001', sha: '3f2a1bc0', title: 'Gateway team policy', updatedAt: new Date().toISOString(), updatedBy: 'Mara', fieldCount: 3, carries: true, caps: CAPS, workspaceCaps: CAPS, origin: 'github.com/acme/gateway' };
const OFF_STATUS = { key: 'billing-00000002', name: 'billing-api', path: '/Users/me/dev/billing-api', exists: true, slug: 'acme/billing-api', hasOrigin: true, present: false, docKnown: false, unknownSchema: false, warnings: [], delegateTo: null, delegateState: null, blocked: null, home: null, fieldCount: 0, carries: false, caps: null };
const SCOPES = {
  projects: [HOME_STATUS, OFF_STATUS], workspaces: [],
  scopes: { projects: [{ id: 'project:gateway-00000001', label: 'acme/gateway', name: 'gateway', home: 'acme/gateway', follows: null }], workspaces: [] },
  homes: [{ slug: 'acme/gateway', key: 'gateway-00000001', title: 'Gateway team policy', caps: CAPS, workspaceCaps: CAPS, usedBy: ['acme/gateway'] }],
  requirements: [], blockedPlugins: [], anyEnabled: true,
};
const REGISTRY = [
  { key: 'cost.pipelineLimitUsd', group: 'cost', label: 'Per-pipeline cap (USD)', type: 'usd', kinds: ['default', 'soft'], cap: true, attrs: ['onBreach', 'requireReason'] },
  { key: 'cost.totalLimitUsd', group: 'cost', label: 'Total cap per period (USD)', type: 'usd', kinds: ['default', 'soft'], cap: true, attrs: ['onBreach', 'requireReason'] },
  { key: 'models.allowed', group: 'models', label: 'Allowed models', type: 'string[]', kinds: ['soft'] },
];
const DOC = { schema: 1, title: 'Gateway team policy', notes: '', updatedAt: new Date().toISOString(), updatedBy: 'Mara', fields: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 10, onBreach: 'pause' }, 'cost.totalLimitUsd': { kind: 'soft', value: 150 } }, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } };
const POLICY = {
  scope: { kind: 'project', id: 'gateway-00000001', name: 'gateway', path: PROJECT },
  policy: { home: 'acme/gateway', homeKey: 'gateway-00000001', sha: '3f2a1bc0', delegated: false, from: 'acme/gateway', warnings: [], checkedAt: new Date().toISOString(), doc: DOC, caps: CAPS, workspaceRun: false },
  rows: [
    { key: 'cost.pipelineLimitUsd', group: 'cost', label: 'Per-pipeline cap (USD)', help: 'pauses the run', type: 'usd', team: { kind: 'soft', declaredKind: 'soft', value: 10, display: '$10.00', onBreach: 'pause' }, local: { value: 25, set: true, display: '$25.00' }, effective: { value: 10, display: '$10.00', source: 'team' }, note: 'yours ($25.00) is looser; the team cap applies', shown: true },
    { key: 'cost.totalLimitUsd', group: 'cost', label: 'Total cap per period (USD)', type: 'usd', team: { kind: 'soft', declaredKind: 'soft', value: 150, display: '$150.00' }, local: { value: 120, set: true, display: '$120.00' }, effective: { value: 120, display: '$120.00', source: 'local' }, note: 'yours is tighter', shown: true },
    { key: 'models.allowed', group: 'models', label: 'Allowed models', type: 'string[]', team: null, local: null, effective: { value: null, display: '—', source: 'none' }, note: null, shown: false },
  ],
  local: {}, deviations: [{ code: 'plugin-missing:acme-jira', level: 'warn', text: 'Required plugin acme-jira is not installed.' }],
  requirements: [{ name: 'acme-jira', marketplace: 'acme', minVersion: '1.2.0', state: 'missing', installed: null, homes: ['acme/gateway'] }],
  blockedPlugins: [], worcaVersion: '1.3.0', registry: REGISTRY, canPublish: true,
};
const NOTES = { scope: { kind: 'project', id: 'gateway-00000001' }, policy: { home: 'acme/gateway', sha: '3f2a1bc0', delegated: false, from: 'acme/gateway', caps: CAPS }, notes: [{ code: 'plugin-missing:acme-jira', text: 'Required plugin acme-jira is not installed.', level: 'warn' }], guardrailsDefault: null };

const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

async function boot({ fetchHandler, scopes = SCOPES, policy = POLICY } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {} close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };
  const fetchCalls = [];
  window.fetch = (url, opts) => {
    const u = String(url);
    fetchCalls.push({ url: u, opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/policy/scopes') || u.includes('/api/policy/discover')) return json(scopes);
    if (u.includes('/api/policy/notes')) return json(NOTES);
    if (u.includes('/api/policy/validate')) return json({ ok: true, warnings: [] });
    if (u.startsWith('/api/policy?')) return policy ? json(policy) : json({ error: 'no team policy', code: 'NOT_ENABLED' }, 404);
    if (u.includes('/api/budget')) return json(budget());
    if (u.includes('/api/settings')) return json({ root: '', projectsRoot: '', pipelineCostLimitUsd: 25, totalCostLimitUsd: 120, costLimitResetPeriod: 'monthly', askMaxTurns: 40, askMaxBudgetUsd: 2, theme: 'system', app: {}, chat: {}, models: [] });
    if (u.includes('/api/team-metrics/scopes')) return json({ projects: [], workspaces: [], scopes: { projects: [], workspaces: [] }, anyEnabled: false });
    if (u.includes('/api/resume')) return json({ ok: true, runId: 'r-new', pipelineId: 'pl_1' });
    if (u.includes('/api/projects')) return json({ projects: PROJECTS });
    if (u.includes('/api/history')) return json({ pipelines: [], live: [], ghAvailable: false });
    if (u.includes('/api/guardrails')) return json({ sets: [{ id: 'permissive', name: 'Permissive', origin: 'builtin', settings: {} }, { id: 'normal', name: 'Normal', origin: 'builtin', settings: {} }] });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [], plugins: [], marketplaces: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) await tick(); };
  const recv = (obj) => wsBox.ws.dispatch('message', { data: JSON.stringify(obj) });
  const go = async (hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); await settle(); };
  await tick();
  return { window, doc: window.document, fetchCalls, tick, settle, recv, go };
}

test('Team policy page: the Plugins tab lists what the policy expects and installs through the consent flow', async () => {
  const { doc, go, settle } = await boot();
  await go('team-policy');
  await settle();
  doc.querySelector('#tp-tab-plugins').click();
  await settle();
  assert.equal(doc.getElementById('tp-sec-policy').hidden, true);
  const row = doc.querySelector('#tp-sec-plugins tr[data-name="acme-jira"]');
  assert.match(row.textContent, /expected by acme\/gateway · from acme/);
  assert.match(row.textContent, /≥ 1.2.0/);
  assert.equal(row.querySelector('.badge.amber').textContent, 'not installed');
  assert.equal(row.querySelector('.pl-policy-install').dataset.marketplace, 'acme');
  assert.ok(doc.querySelector('#tp-sec-plugins .pl-policy-setup'), 'Set up… opens the checklist');
  assert.equal(doc.querySelector('#tp-sec-plugins .card-head .pl-policy-all').textContent, 'Install all…', 'the fixture has one missing plugin');
});

test('#555: a failed Team policy Install and a failed Check now are error toasts (with Retry), not lines on another page', async () => {
  await checkRows([
    { name: '#555 D5: Team policy Install reports where the install happens — a failure is an error toast, not a line on the Marketplace page', run: async () => {
      const MKT = { id: 'acme', name: 'acme', url: 'https://example.com/acme.git', lastSync: { sha: 'abc1234' }, plugins: [{ name: 'acme-jira', subdir: 'plugins/jira', inventory: {} }] };
      let installStatus = 500;
      const installs = [];
      const { doc, go, settle } = await boot({
        fetchHandler: (u, opts) => {
          if (u === '/api/marketplaces' && !opts.method) return json({ marketplaces: [MKT] });
          if (u === '/api/plugins/install' && opts.method === 'POST') { installs.push(JSON.parse(opts.body)); return installStatus === 200 ? json({ ok: true }) : json({ error: 'clone failed' }, installStatus); }
          return null;
        },
      });
      await go('team-policy');
      await settle();
      doc.querySelector('#tp-tab-plugins').click();
      await settle();
      const install = () => doc.querySelector('#tp-sec-plugins tr[data-name="acme-jira"] .pl-policy-install');
      install().click();
      await settle();
      assert.equal(install().dataset.fbState, undefined, 'opening the consent dialog is not a result: the Team-policy button shows no state');
      assert.equal(install().textContent, 'Install…');
      const confirm = () => [...doc.querySelectorAll('#plugin-modal-actions button')].find((b) => b.textContent === 'Install');
      confirm().click();
      await settle(8);
      assert.equal(installs.length, 1);
      assert.equal(lastToast(doc).tone, 'err');
      assert.equal(lastToast(doc).title, 'clone failed');
      assert.equal(doc.getElementById('plugins-msg').textContent, '', 'nothing lands on the Marketplace page line');
      assert.equal(doc.querySelectorAll('#toasts > .toast').length, 1, 'the progress toast was replaced by the result');

      installStatus = 200;
      install().click();
      await settle();
      assert.equal(install().dataset.fbState, undefined, 'no "Installed" state before the consent is confirmed');
      confirm().click();
      await settle(8);
      assert.equal(installs.length, 2);
      assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Installed acme-jira.', detail: '', action: 'Open' });
      assert.equal(doc.getElementById('plugins-msg').textContent, '');
    } },
    { name: '#555: a failed Check now is an error toast with Retry', run: async () => {
      let discover = 0;
      const { doc, go, settle } = await boot({
        fetchHandler: (u, opts) => {
          if (u.includes('/api/policy/discover') && opts.method === 'POST') { discover += 1; return json({ error: 'git fetch failed' }, 502); }
          return null;
        },
      });
      await go('team-policy');
      await settle();
      doc.querySelector('#tp-sync .tp-check-now').click();
      await settle(8);
      assert.equal(discover, 1);
      assert.deepEqual(lastToast(doc), { tone: 'err', title: 'Check failed', detail: 'git fetch failed', action: 'Retry' });
      doc.querySelector('#toasts .toast-act').click();
      await settle(8);
      assert.equal(discover, 2, 'Retry runs the check again');
      assert.equal(doc.querySelectorAll('#toasts > .toast').length, 1, 'the keyed toast replaces itself');
    } },
  ]);
});

test('Team policy page: scope select, effective table, Edit policy → editor → publish', async () => {
  const puts = [];
  const { doc, go, settle, fetchCalls } = await boot({
    fetchHandler: (u, opts) => {
      if (u === '/api/policy' && opts.method === 'PUT') { puts.push(JSON.parse(opts.body)); return json({ ok: true, slug: 'acme/gateway', sha: 'abc1234def', unchanged: false, doc: DOC }); }
      return null;
    },
  });
  await go('team-policy');
  await settle();
  const sel = doc.getElementById('tp-scope');
  assert.equal(sel.value, 'project:gateway-00000001');
  const table = doc.querySelector('#tp-body table.tp-tbl');
  assert.ok(table, 'the effective table paints');
  assert.equal(table.querySelectorAll('tbody tr[data-key]').length, 2);
  assert.ok(table.querySelector('tr[data-key="cost.pipelineLimitUsd"] td.tp-eff.loose'), 'the looser local value is struck through');
  const edit = doc.querySelector('#tp-body .tp-head .tp-edit');
  assert.equal(edit.disabled, false);
  edit.click();
  await settle();
  const editor = doc.querySelector('#tp-body .tp-editor');
  assert.ok(editor, 'Edit policy opens the editor');
  assert.ok(doc.querySelector('#tp-body .tp-head'), 'the document panel stays above the editor');
  assert.equal(doc.querySelector('#tp-body .tp-head .tp-edit').textContent, 'Cancel editing');
  const publish = doc.querySelector('#tp-body .tp-head .tp-head-btns .tp-publish');
  assert.ok(publish, 'Publish sits on the header, beside Cancel editing');
  assert.equal(doc.querySelector('#tp-body .tp-head .tp-head-btns .tp-edit').textContent, 'Cancel editing');
  assert.equal(editor.querySelector('.tp-publish-bar'), null, 'no bar floats over the form');
  assert.equal(doc.querySelector('#tp-body .tp-head .tp-head-status .tp-change-count').textContent, 'no changes');
  assert.deepEqual([...editor.querySelectorAll('.tp-edit-tabs .tp-tab')].map((b) => b.dataset.sec), ['document', 'cost', 'models', 'workspace', 'catalog'], 'one tab per group the registry has, plus Document, Workspace runs and Catalog');
  assert.equal(publish.disabled, true);
  const cap = editor.querySelector('.tp-edit-row[data-key="cost.pipelineLimitUsd"][data-scope="fields"] .tp-val');
  cap.value = '12';
  cap.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle();
  assert.equal(publish.disabled, false, 'a change enables Publish');
  assert.equal(doc.querySelector('#tp-body .tp-head .tp-change-count').textContent, '1 change');
  publish.click();
  await settle(8);
  assert.equal(puts.length, 1, 'one PUT /api/policy');
  assert.equal(puts[0].scope, 'project:gateway-00000001');
  assert.equal(puts[0].doc.fields['cost.pipelineLimitUsd'].value, 12);
  assert.ok(fetchCalls.some((c) => c.url.includes('/api/policy/validate')), 'validated before publishing');
  assert.ok(doc.querySelector('#tp-body table.tp-tbl'), 'back in read mode after a publish');
  assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Policy published', detail: 'Commit abc1234', action: '' });
  assert.equal(doc.querySelector('#tp-body .form-msg.ok'), null, 'the result is a toast, not a line the next repaint drops');
});

test('Team policy page: a publish rejection is printed verbatim under the bar', async () => {
  const { doc, go, settle } = await boot({
    fetchHandler: (u, opts) => (u === '/api/policy' && opts.method === 'PUT'
      ? json({ error: 'push rejected', code: 'PUSH_REJECTED', stderr: 'remote: error: GH006: Protected branch update failed for refs/heads/worca-policy.', hint: 'you may not have push rights to `worca-policy` — copy the JSON and open a pull request against that branch, or ask a maintainer' }, 409)
      : null),
  });
  await go('team-policy');
  await settle();
  doc.querySelector('#tp-body .tp-head .tp-edit').click();
  await settle();
  const editor = doc.querySelector('#tp-body .tp-editor');
  editor.querySelector('.tp-title').value = 'Renamed';
  editor.querySelector('.tp-title').dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle();
  doc.querySelector('#tp-body .tp-head .tp-publish').click();
  await settle(8);
  const msg = editor.querySelector('.tp-msg');
  assert.ok(msg.classList.contains('err'));
  assert.match(msg.textContent, /push rejected · remote: error: GH006: Protected branch update failed .* · you may not have push rights/);
  assert.equal(editor.firstElementChild, msg, 'the rejection sits at the top of the form, under the header that holds Publish');
  assert.equal(doc.querySelector('#tp-body .tp-head .tp-publish').disabled, false, 'Publish is usable again after a rejection');
});

test('Project page: "Set up team policy…" opens the dialog; the follow mode posts the marker body', async () => {
  const posts = [];
  const { doc, go, settle } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/policy/enable') && opts.method === 'POST') { posts.push({ url: u, body: JSON.parse(opts.body) }); return json({ action: 'created', slug: 'acme/billing-api', status: OFF_STATUS }); }
      return null;
    },
  });
  await go('projects/billing-00000002');
  await settle();
  // The Overview card reads the state and opens the Team tab.
  const card = doc.querySelector('#proj-detail .pd-ov-card-policy');
  assert.equal(card.querySelector('.pd-ov-value').textContent, 'Off');
  assert.equal(card.querySelector('.pd-ov-sub').textContent, 'your settings apply');
  card.click();
  await settle();
  assert.equal(window.location.hash, '#projects/billing-00000002/team');
  doc.querySelector('#proj-detail .pd-team-policy .tp-enable').click();
  await settle();
  const modal = doc.getElementById('plugin-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'the slot modal opens');
  assert.match(modal.textContent, /Set up team policy/);
  assert.match(modal.querySelector('.tm-warn').textContent, /Protect worca-policy/);
  const follow = modal.querySelector('input[name="tp-where"][value="follow"]');
  assert.equal(follow.disabled, false, 'gateway carries a policy, so following is offered');
  follow.checked = true;
  follow.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  assert.equal(modal.querySelector('.tp-follow-target').value, 'acme/gateway');
  assert.equal(modal.querySelector('.tp-enable-submit').textContent, 'Create marker and follow');
  modal.querySelector('.tp-enable-submit').click();
  await settle(6);
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/api\/projects\/billing-00000002\/policy\/enable$/);
  assert.deepEqual(posts[0].body, { mode: 'follow', delegateTo: 'acme/gateway', change: false });
});

test('Configure…: an installed plugin opens its settings pane with the policy\'s seeds filled into blank fields', async () => {
  const REQ = { name: 'acme-jira', marketplace: 'acme', minVersion: '1.2.0', state: 'ok', installed: { version: '1.3.0', enabled: true }, homes: ['acme/gateway'], config: { baseUrl: 'https://acme.atlassian.net', projectKey: 'GW' } };
  const configGets = [];
  // Installed and configured is not "off-policy", so the Settings panel is gone; the Team policy
  // page's Plugins tab still lists it, with Configure… on the row.
  const { doc, go, settle } = await boot({
    scopes: { ...SCOPES, requirements: [REQ] },
    policy: { ...POLICY, requirements: [REQ], deviations: [] },
    fetchHandler: (u, opts) => {
      if (/\/api\/plugins\/acme-jira\/config/.test(u) && (!opts.method || opts.method === 'GET')) {
        configGets.push(u);
        return json({ sources: [{ id: 'jira', schema: [{ key: 'baseUrl', label: 'Base URL' }, { key: 'projectKey', label: 'Project' }, { key: 'token', label: 'Token', secret: true }], values: { projectKey: 'OLD' } }], channels: [] });
      }
      if (u.includes('/api/plugins') && !opts.method) return json({ plugins: [{ name: 'acme-jira', version: '1.3.0', enabled: true }], marketplaces: [] });
      return null;
    },
  });
  await go('team-policy/project:gateway-00000001');
  await settle();
  doc.querySelector('#tp-tab-plugins').click();
  await settle();
  const cfg = doc.querySelector('#tp-sec-plugins tr[data-name="acme-jira"] .pl-policy-configure');
  assert.ok(cfg, 'an installed plugin with seeds gets Configure… on its row');
  cfg.click();
  await settle(6);
  const modal = doc.getElementById('plugin-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  assert.equal(configGets.length, 1, 'the plugin\'s config pane was fetched');
  assert.match(modal.textContent, /Settings: acme-jira/);
  const inputs = Object.fromEntries([...modal.querySelectorAll('.pl-config-form [data-key]')].map((i) => [i.dataset.key, i]));
  assert.equal(inputs.baseUrl.value, 'https://acme.atlassian.net', 'a blank field takes the seed');
  assert.equal(inputs.baseUrl.dataset.seeded, '1');
  assert.equal(inputs.projectKey.value, 'OLD', 'a stored value is never overwritten');
  assert.equal(inputs.token.value, '', 'a secret is never seeded');
  assert.match(modal.querySelector('.pl-seeded-note').textContent, /^baseUrl filled in from the team policy — Save keeps them/);
});

test('New pipeline: MCP servers paints under Guardrails; an unticked membership reaches the policy notes and the run body', async () => {
  const PREVIEW = {
    sets: [{ id: 'billing', name: 'Billing', group: 'set' }],
    copies: [
      { name: 'pg_billing', copy: 'pg_billing', setId: 'billing', serverId: 'manual:pg' },
      { name: 'sentry_billing', copy: 'sentry_billing', setId: 'billing', serverId: 'plugin:acme-tools/sentry' },
    ],
    skipped: [{ setId: 'billing', setName: 'Billing', serverId: 'manual:jira', copy: 'jira_billing', reason: 'missing:token', why: 'API token not set' }],
    started: 2, deviations: [],
  };
  const CONFIG = { config: { steps: { planner: { model: 'gw-gpt' } }, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [], plugins: [], marketplaces: [] };
  let previewFails = false;
  const { doc, go, settle, window, fetchCalls } = await boot({ fetchHandler: (u) => (u === '/api/mcp/preview' ? (previewFails ? json({ error: 'boom' }, 500) : json(PREVIEW)) : u.startsWith('/api/config') ? json(CONFIG) : null) });
  await go('new');
  await settle();
  assert.equal(doc.getElementById('mcpRunsField').hidden, true, 'no target yet');
  const sel = doc.getElementById('projectSelect');
  sel.value = PROJECT;
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  await settle();
  assert.equal(doc.getElementById('mcpRunsField').hidden, false);
  assert.equal(doc.getElementById('mcpRunsLabel').textContent, '2 of 2 MCP servers');
  assert.deepEqual(JSON.parse(fetchCalls.findLast((c) => c.url === '/api/mcp/preview').opts.body), { target: { projectKey: 'gateway-00000001' }, models: ['gw-gpt'], engine: 'claude' }, 'the form\'s models set the preview\'s tool-name limit, its engine the set skills\' names');
  const rows = [...doc.querySelectorAll('#mcpRunsPop .mcp-runs-row')];
  assert.equal(rows.at(-1).textContent, 'jira_billingAPI token not set', 'the skipped membership is a row with its reason');
  rows[0].querySelector('input').focus();
  rows[0].querySelector('input').click();
  await settle();
  assert.equal(doc.getElementById('mcpRunsLabel').textContent, '1 of 2 MCP servers');
  assert.equal(doc.activeElement?.dataset.keys, 'billing|manual:pg', 'the re-render keeps the keyboard focus on the ticked box');
  assert.equal(doc.activeElement?.dataset.kind, 'row');
  assert.ok(fetchCalls.some((c) => c.url.includes('/api/policy/notes') && new URL(c.url, 'http://x').searchParams.get('mcpOptOut') === 'billing|manual:pg'));
  // A failed preview refetch hides the control but keeps the opt-out (the server drops unknown entries).
  const repaint = async () => {
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    await settle();
  };
  previewFails = true;
  await repaint();
  assert.equal(doc.getElementById('mcpRunsField').hidden, true);
  doc.getElementById('prompt').value = 'demo task';
  doc.getElementById('run-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await settle();
  assert.deepEqual(JSON.parse(fetchCalls.findLast((c) => c.url === '/api/run').opts.body).mcpOptOut, ['billing|manual:pg']);
  previewFails = false;
  await repaint();
  assert.equal(doc.getElementById('mcpRunsField').hidden, false);
  assert.equal(doc.getElementById('mcpRunsLabel').textContent, '1 of 2 MCP servers', 'the opt-out held through the failed fetch');
  // §6.1: a memory-defrag run gets no registry servers: the control hides and the body carries none.
  const runs = fetchCalls.filter((c) => c.url === '/api/run').length;
  const wf = doc.getElementById('workflowSelect');
  wf.append(Object.assign(doc.createElement('option'), { value: 'wf_memory_defrag', textContent: 'Memory defragment' }));
  wf.value = 'wf_memory_defrag';
  wf.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  await settle();
  assert.equal(doc.getElementById('mcpRunsField').hidden, true);
  doc.getElementById('run-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await settle();
  const defrag = fetchCalls.filter((c) => c.url === '/api/run');
  assert.equal(defrag.length, runs + 1, 'the defrag run was started');
  assert.equal(JSON.parse(defrag.at(-1).opts.body).mcpOptOut, undefined);
});

test('Running: a cost_pipeline_policy pause shows the blue banner; "Continue past" prompts, then resumes with pastTeamCap', async () => {
  const ctx = await boot();
  const { doc, recv, settle, fetchCalls } = ctx;
  await ctx.go('running');
  recv({ type: 'hello', runs: [{ runId: 'r1', title: 'Feat', projectDir: PROJECT, status: 'running', startedAt: '00:00:00', pipelineId: 'pl_1' }] });
  await settle();
  recv({ type: 'done', runId: 'r1', status: 'paused', reason: 'cost_pipeline_policy', detail: 'team cost cap reached ($10.00 >= $10.00, acme/gateway)' });
  await settle();
  const row = () => doc.querySelector('#runs-list .runs-row[data-slot="group"][data-run-id="r1"]');
  const word = (a) => a.querySelector('.runs-row-sub').textContent.split(' \u00b7 ')[0];
  assert.ok(row(), 'the paused run is listed in its project group');
  assert.equal(row().querySelector('.cost-banner'), null, 'the list row carries no cost banner');
  const needs = doc.querySelector('#runs-list .runs-needs .runs-row[data-run-id="r1"]');
  assert.ok(needs, 'Needs you says the run is parked');
  assert.equal(word(needs), 'Team cap');
  await ctx.go('running/r1');                                  // the banner lives on the run page
  await settle(6);
  const banner = doc.querySelector('#run-detail .cost-banner');
  assert.ok(banner, 'the run page carries the cost banner');
  assert.equal(banner.hidden, false);
  assert.ok(banner.classList.contains('cb-policy'), 'the blue team-cap variant');
  assert.match(banner.textContent, /Paused — team cost cap reached/);
  assert.equal(word(row()), 'Team cap', 'the group row names the team cap');
  assert.ok(banner.querySelector('.cb-past-team-cap'));
  assert.equal(banner.querySelector('.cb-override'), null);
  banner.querySelector('.cb-past-team-cap').click();
  await settle();
  const modal = doc.getElementById('confirm-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'the prompt opens first');
  assert.match(doc.getElementById('confirm-title').textContent, /Continue past the team cap\?/);
  const reason = modal.querySelector('#confirm-fields input');
  assert.ok(reason, 'a reason field');
  reason.value = 'release hotfix';
  reason.dispatchEvent(new window.Event('input', { bubbles: true }));
  doc.getElementById('confirm-ok').click();
  await settle(6);
  const posts = fetchCalls.filter((c) => c.url.includes('/api/resume'));
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].opts.body), { pipelineId: 'pl_1', baseCheck: true, pastTeamCap: true, policyReason: 'release hotfix' });
});

test('MCP rows in the setup checklist: Install opens the consent dialog, then posts only { expectHash }; a trusted home never installs or turns on one', async () => {
  const LINEAR = { home: 'acme/gateway', sha: '3f2a1bc0', setId: 'team-acme-gateway-1a2b', setName: 'Team · acme/gateway', serverId: 'policy:acme/gateway/linear', name: 'linear', plugin: null, type: 'http',
    state: 'not-installed', working: false, hash: 'd'.repeat(64), field: null, base: 'linear', def: { type: 'http', url: 'https://mcp.linear.app/mcp', fields: [], description: '' }, values: {}, before: null, running: null };
  const SENTRY = { ...LINEAR, serverId: 'plugin:acme-tools/sentry', name: 'sentry', plugin: 'acme-tools', state: 'never-consented', hash: 'b'.repeat(64) };
  const posts = [];
  const { window, doc, go, settle, fetchCalls } = await boot({
    scopes: { ...SCOPES, mcpRequirements: [LINEAR, SENTRY] },
    fetchHandler: (u, opts) => {
      if (u.startsWith('/api/mcp/teams/') && opts.method === 'POST') { posts.push({ url: u, body: JSON.parse(opts.body) }); return json({ ok: true, setId: LINEAR.setId, serverId: LINEAR.serverId }); }
      if (u.startsWith('/api/mcp/sets')) return json({ error: 'not in this test' }, 404);   // the card Install opens (P6's view)
      return null;
    },
  });
  window.localStorage.setItem('worca.policy.trust.acme/gateway', '1');
  await go('marketplace');
  await settle(6);
  assert.equal(fetchCalls.some((c) => c.url.startsWith('/api/mcp/teams/')), false, 'trust covers plugins only');
  await go('team-policy');
  await settle();
  doc.querySelector('#tp-tab-plugins').click();
  await settle();
  doc.querySelector('#tp-sec-plugins .pl-policy-setup').click();
  await settle(6);
  const modal = doc.getElementById('plugin-modal');
  assert.equal(modal.querySelectorAll('.tp-mcp-row').length, 2);
  modal.querySelector('.tp-mcp-act[data-server="policy:acme/gateway/linear"]').click();
  await settle(6);
  assert.equal(doc.getElementById('plugin-modal-title').textContent, 'Install MCP server');
  assert.match(modal.textContent, /https:\/\/mcp\.linear\.app\/mcp/);
  assert.equal(posts.length, 0, 'nothing is posted before the click in the dialog');
  const install = [...modal.querySelectorAll('#plugin-modal-actions button')].find((b) => b.textContent === 'Install');
  install.click(); install.click();   // a double click posts once
  await settle(6);
  assert.deepEqual(posts, [{ url: '/api/mcp/teams/acme%2Fgateway/members/policy%3Aacme%2Fgateway%2Flinear/install', body: { expectHash: 'd'.repeat(64) } }]);
  assert.equal(window.location.hash, '#connectors/sets/team-acme-gateway-1a2b', 'Install opens its card');
  assert.equal(modal.classList.contains('hidden'), true, 'the consent dialog closes');
});

test('the MCP tab strip: a Team action reloads the Sets view under it; a row that moved on repaints instead of posting (§11.3)', async () => {
  const PG = { home: 'acme/gateway', sha: '3f2a1bc0', setId: 'team-acme-gateway-1a2b', setName: 'Team · acme/gateway', serverId: 'policy:acme/gateway/pg', name: 'pg', plugin: null, type: 'stdio',
    state: 'off', working: false, hash: 'e'.repeat(64), field: null, base: 'pg', def: { type: 'stdio', command: 'pg-mcp', fields: [], description: '' }, values: {}, before: null, running: null };
  let rows = [PG];
  const posts = [];
  const { doc, go, settle, recv, fetchCalls } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/policy/scopes')) return json({ ...SCOPES, mcpRequirements: rows });
      if (u.startsWith('/api/mcp/teams/') && opts.method === 'POST') { posts.push(u); return json({ ok: true, setId: PG.setId, serverId: PG.serverId }); }
      if (u.startsWith('/api/mcp/sets')) return json({ error: 'not in this test' }, 404);   // P6's Sets view: only its reloads are counted
      return null;
    },
  });
  await go(`connectors/sets/${PG.setId}`);
  await settle(8);
  const strip = () => doc.querySelector('[data-view="connectors"] [data-mcp-strip] .tp-mcp-strip');
  const setGets = () => fetchCalls.filter((c) => c.url === `/api/mcp/sets/${PG.setId}`).length;
  assert.ok(strip(), 'the strip paints above the Sets view');
  const before = setGets();
  const pg = strip().querySelector('.tp-mcp-act[data-server="policy:acme/gateway/pg"]');
  pg.click(); pg.click();   // Off · Turn on: consented, no dialog; a double click posts once
  await settle(8);
  assert.deepEqual(posts, ['/api/mcp/teams/acme%2Fgateway/members/policy%3Aacme%2Fgateway%2Fpg/turn-on']);
  assert.ok(setGets() > before, 'the Sets view reloads: its card never contradicts the strip');
  // The team changed the definition; the strip still shows the Turn on it painted. The click repaints (Update), never posts.
  rows = [{ ...PG, state: 'changed', hash: 'f'.repeat(64), before: { def: PG.def, values: {} } }];
  strip().querySelector('.tp-mcp-act[data-server="policy:acme/gateway/pg"]').click();
  await settle(8);
  assert.equal(posts.length, 1, 'no consent without the dialog');
  assert.equal(strip().querySelector('.tp-mcp-act[data-server="policy:acme/gateway/pg"]').dataset.action, 'update');
  // A policy change elsewhere (discovery, another tab) reloads the pane and its strip.
  const n = setGets();
  recv({ type: 'team-policy-changed', action: 'updated' });
  await settle(8);
  assert.ok(setGets() > n, 'team-policy-changed reloads the MCP pane');
  // Every repaint of the pane (a token set, a switch on a card) reads the scopes again, never a copy up to 15 s old.
  rows = [];
  await go('connectors/servers');
  await settle(8);
  assert.equal(strip(), null, 'nothing open: no strip');
});

// One Team member switched off (consented): its strip row is "Off · Turn on", with no consent dialog.
const PG_OFF = { home: 'acme/gateway', sha: '3f2a1bc0', setId: 'team-acme-gateway-1a2b', setName: 'Team · acme/gateway', serverId: 'policy:acme/gateway/pg', name: 'pg', plugin: null, type: 'stdio',
  state: 'off', working: false, hash: 'e'.repeat(64), field: null, problem: null, base: 'pg', def: { type: 'stdio', command: 'pg-mcp', fields: [], description: '' }, values: {}, before: null, running: null };

test('the MCP tab strip shows while an item is open and stays painted across a pane repaint; a refused action reloads the pane; Set up… opens the checklist', async () => {
  await checkRows([
    { name: 'the MCP tab strip: the host shows while an item is open; a refused action reloads the pane; Set up… opens the checklist', run: async () => {
      const { doc, go, settle, fetchCalls } = await boot({
        fetchHandler: (u, opts) => {
          if (u.includes('/api/policy/scopes')) return json({ ...SCOPES, mcpRequirements: [PG_OFF] });
          if (u.startsWith('/api/mcp/teams/') && opts.method === 'POST') return json({ error: 'the team definition changed, review it again' }, 409);
          if (u.startsWith('/api/mcp/sets')) return json({ error: 'not in this test' }, 404);
          return null;
        },
      });
      await go(`connectors/sets/${PG_OFF.setId}`);
      await settle(8);
      const host = () => doc.querySelector('[data-view="connectors"] [data-mcp-strip]');
      assert.equal(host().hidden, false, 'an open item shows the strip');
      const setGets = () => fetchCalls.filter((c) => c.url === `/api/mcp/sets/${PG_OFF.setId}`).length;
      const before = setGets();
      host().querySelector('.tp-mcp-act').click();
      await settle(8);
      assert.ok(setGets() > before, 'a refused action reloads the pane: the strip shows where the row is now');
      host().querySelector('.pl-policy-setup').click();
      await settle(8);
      assert.equal(doc.getElementById('plugin-modal-title').textContent, 'Set up for acme/gateway');
      assert.equal(doc.getElementById('plugin-modal').querySelectorAll('.tp-mcp-row').length, 1);
    } },
    { name: 'the MCP tab strip stays painted while a repaint of the pane reads the scopes again', run: async () => {
      let hold = null;
      const { doc, go, settle, recv } = await boot({
        fetchHandler: (u) => {
          if (u.includes('/api/policy/scopes')) { const body = json({ ...SCOPES, mcpRequirements: [PG_OFF] }); return hold ? hold.then(() => body) : body; }
          if (u.startsWith('/api/mcp/sets')) return json({ error: 'not in this test' }, 404);
          return null;
        },
      });
      await go(`connectors/sets/${PG_OFF.setId}`);
      await settle(8);
      const host = () => doc.querySelector('[data-view="connectors"] [data-mcp-strip]');
      assert.equal(host().hidden, false);
      let release; hold = new Promise((res) => { release = res; });
      recv({ type: 'team-policy-changed', action: 'updated' });   // reloads the pane: P6 hands the strip a fresh, hidden host
      await settle(8);
      assert.equal(host().hidden, false, 'the last state stays painted while the scopes are read again: no flicker');
      assert.ok(host().querySelector('.tp-mcp-act[data-server="policy:acme/gateway/pg"]'));
      release();
      await settle(8);
      assert.equal(host().hidden, false);
    } },
  ]);
});

test('the checklist on the Team policy page closes and reloads the page after a Team action; a moved-on row repaints it; Set <field> opens the Team set', async () => {
  const GH = { ...PG_OFF, serverId: 'policy:acme/gateway/github', name: 'github', state: 'skipped', field: 'Token', problem: 'Token not set', hash: 'a'.repeat(64),
    def: { type: 'stdio', command: 'npx', fields: [{ key: 'token', label: 'Token', secret: true, oauth: false, required: true }], description: '' } };
  let rows = [PG_OFF, GH];
  const posts = [];
  const { window, doc, go, settle, fetchCalls } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/policy/scopes')) return json({ ...SCOPES, mcpRequirements: rows });
      if (u.startsWith('/api/mcp/teams/') && opts.method === 'POST') { posts.push(u); return json({ ok: true, setId: PG_OFF.setId, serverId: PG_OFF.serverId }); }
      if (u.startsWith('/api/mcp/sets')) return json({ error: 'not in this test' }, 404);
      return null;
    },
  });
  await go('team-policy');
  await settle();
  doc.querySelector('#tp-tab-plugins').click();
  await settle();
  const modal = doc.getElementById('plugin-modal');
  const openChecklist = async () => { doc.querySelector('#tp-sec-plugins .pl-policy-setup').click(); await settle(6); };
  const policyGets = () => fetchCalls.filter((c) => c.url.startsWith('/api/policy?')).length;
  await openChecklist();
  assert.equal(modal.classList.contains('hidden'), false);
  const n = policyGets();
  modal.querySelector('.tp-mcp-act[data-server="policy:acme/gateway/pg"]').click();   // Off · Turn on: consented, no dialog
  await settle(8);
  assert.equal(posts.length, 1);
  assert.equal(modal.classList.contains('hidden'), true, 'done: the checklist closes');
  assert.ok(policyGets() > n, 'the Team policy page reloads ("Yours", deviations)');
  await openChecklist();
  rows = [{ ...PG_OFF, state: 'changed', hash: 'f'.repeat(64), before: { def: PG_OFF.def, values: {} } }, GH];
  modal.querySelector('.tp-mcp-act[data-server="policy:acme/gateway/pg"]').click();
  await settle(8);
  assert.equal(posts.length, 1, 'never posted for a row that moved on');
  assert.equal(modal.querySelector('.tp-mcp-act[data-server="policy:acme/gateway/pg"]').dataset.action, 'update', 'the checklist repaints at the new state');
  modal.querySelector('.tp-mcp-act[data-server="policy:acme/gateway/github"]').click();   // Set Token
  await settle(8);
  assert.equal(window.location.hash, `#connectors/sets/${PG_OFF.setId}`, 'Set Token opens the Team set');
  assert.equal(modal.classList.contains('hidden'), true, 'the checklist closes over the Team set it opens');
});

test('with only MCP items open, the checklist is for their home, not the first home listed', async () => {
  const homes = [{ ...SCOPES.homes[0], slug: 'acme/other', key: 'other-00000003' }, SCOPES.homes[0]];
  const { doc, go, settle } = await boot({
    fetchHandler: (u) => {
      if (u.includes('/api/policy/scopes')) return json({ ...SCOPES, homes, mcpRequirements: [PG_OFF] });
      if (u.startsWith('/api/mcp/sets')) return json({ error: 'not in this test' }, 404);
      return null;
    },
  });
  await go(`connectors/sets/${PG_OFF.setId}`);
  await settle(8);
  doc.querySelector('[data-view="connectors"] [data-mcp-strip] .pl-policy-setup').click();
  await settle(8);
  assert.equal(doc.getElementById('plugin-modal-title').textContent, 'Set up for acme/gateway');
  assert.equal(doc.querySelector('#plugin-modal .tp-trust').dataset.home, 'acme/gateway', 'trust is offered for the home the items come from');
});

test('a strip Turn on (no dialog) that lands later never closes a dialog opened meanwhile', async () => {
  let hold = null;
  const posts = [];
  const { doc, go, settle } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/policy/scopes')) return json({ ...SCOPES, mcpRequirements: [PG_OFF] });
      if (u.startsWith('/api/mcp/teams/') && opts.method === 'POST') { posts.push(u); const body = json({ ok: true, setId: PG_OFF.setId, serverId: PG_OFF.serverId }); return hold ? hold.then(() => body) : body; }
      if (u.startsWith('/api/mcp/sets')) return json({ error: 'not in this test' }, 404);
      return null;
    },
  });
  await go(`connectors/sets/${PG_OFF.setId}`);
  await settle(8);
  const host = () => doc.querySelector('[data-view="connectors"] [data-mcp-strip]');
  let release; hold = new Promise((res) => { release = res; });
  host().querySelector('.tp-mcp-act').click();   // Off · Turn on: consented, no dialog; its POST is still out
  await settle(8);
  assert.equal(posts.length, 1);
  host().querySelector('.pl-policy-setup').click();   // the user opens a dialog meanwhile
  await settle(8);
  const modal = doc.getElementById('plugin-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  release();
  await settle(8);
  assert.equal(modal.classList.contains('hidden'), false, 'the Turn on that landed never closes the dialog the user opened');
});

test('a consent dialog whose POST lands after the user moved on never closes the dialog opened meanwhile', async () => {
  const NEW = { ...PG_OFF, state: 'never-consented' };
  let hold = null;
  const posts = [];
  const { doc, go, settle } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/policy/scopes')) return json({ ...SCOPES, mcpRequirements: [NEW] });
      if (u.startsWith('/api/mcp/teams/') && opts.method === 'POST') { posts.push(u); const body = json({ ok: true, setId: NEW.setId, serverId: NEW.serverId }); return hold ? hold.then(() => body) : body; }
      if (u.startsWith('/api/mcp/sets')) return json({ error: 'not in this test' }, 404);
      return null;
    },
  });
  await go(`connectors/sets/${NEW.setId}`);
  await settle(8);
  const host = () => doc.querySelector('[data-view="connectors"] [data-mcp-strip]');
  const modal = doc.getElementById('plugin-modal');
  const button = (label) => [...modal.querySelectorAll('#plugin-modal-actions button')].find((b) => b.textContent === label);
  const turnOn = host().querySelector('.tp-mcp-act');
  turnOn.click();   // Off · Turn on, never consented: the consent dialog first
  await settle(8);
  assert.equal(doc.getElementById('plugin-modal-title').textContent, 'Turn on MCP server');
  button('Cancel').click();
  assert.ok(turnOn.isConnected);
  turnOn.click();   // the same button again: a cancelled dialog never leaves it dead
  await settle(8);
  assert.equal(modal.classList.contains('hidden'), false, 'the consent dialog opens again');
  let release; hold = new Promise((res) => { release = res; });
  button('Turn on').click();
  await settle(8);
  assert.equal(posts.length, 1);
  button('Cancel').click();
  host().querySelector('.pl-policy-setup').click();   // the user opens the checklist while the POST is out
  await settle(8);
  assert.equal(doc.getElementById('plugin-modal-title').textContent, 'Set up for acme/gateway');
  release();
  await settle(8);
  assert.equal(modal.classList.contains('hidden'), false, 'the Turn on that landed never closes the checklist the user opened');
});

// ---- required skills (skills registry spec §5, §6 boards 1 and 10): the checklist and the Sets-tab strip, wired ----
const SKILL_NEW = { home: 'acme/gateway', sha: '3f2a1bc0', setId: 'team-acme-gateway-1a2b', setName: 'Team · acme/gateway', skillId: 'skill:plugin:acme/deploy-checklist',
  name: 'deploy-checklist', plugin: 'acme', state: 'never-consented', working: false, hash: 'd'.repeat(64), problem: null, code: '3f9a1c2', files: 2, bytes: 900,
  scripts: ['scripts/preflight.sh'], shellBlocks: 1, description: 'Pre-deploy checks' };

test('required skills: the checklist row opens the consent dialog; Turn on posts { expectHash } to the Sets route and closes it; the Sets-tab strip lists it', async () => {
  let rows = [SKILL_NEW];
  const posts = [];
  const { doc, go, settle } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/policy/scopes')) return json({ ...SCOPES, mcpRequirements: [], skillRequirements: rows });
      if (u.startsWith('/api/sets/teams/') && u.endsWith('/consent')) return json({ ...SKILL_NEW, allowedTools: null, skillMd: '---\nname: deploy-checklist\n---\n# Deploy\n' });
      if (u.startsWith('/api/sets/teams/') && opts.method === 'POST') {
        posts.push([u, JSON.parse(opts.body)]);
        rows = [{ ...SKILL_NEW, state: 'ok', working: true }];
        return json({ ok: true, setId: SKILL_NEW.setId, skillId: SKILL_NEW.skillId });
      }
      if (u.startsWith('/api/mcp/sets')) return json({ error: 'not in this test' }, 404);
      return null;
    },
  });
  await go('team-policy');
  await settle();
  doc.querySelector('#tp-tab-plugins').click();
  await settle();
  doc.querySelector('#tp-sec-plugins .pl-policy-setup').click();
  await settle(6);
  const modal = doc.getElementById('plugin-modal');
  const button = (label) => [...modal.querySelectorAll('#plugin-modal-actions button')].find((b) => b.textContent === label);
  const turnOn = modal.querySelector('.tp-skill-row .tp-skill-act');
  assert.equal(turnOn.textContent, 'Turn on');
  turnOn.click();
  await settle(8);
  assert.equal(doc.getElementById('plugin-modal-title').textContent, 'Turn on skill: deploy-checklist');
  assert.equal(modal.querySelector('pre.tp-skill-md').textContent, '---\nname: deploy-checklist\n---\n# Deploy\n');
  assert.equal(posts.length, 0, 'nothing is posted before the consent click');
  button('Turn on').click();
  await settle(8);
  assert.deepEqual(posts, [['/api/sets/teams/acme%2Fgateway/skills/skill%3Aplugin%3Aacme%2Fdeploy-checklist/turn-on', { expectHash: 'd'.repeat(64) }]]);
  assert.equal(modal.classList.contains('hidden'), true, 'done: the dialog closes');
  // An off row turns on at once and closes the checklist it came from; a row that moved on repaints that checklist.
  rows = [{ ...SKILL_NEW, state: 'off' }];
  doc.querySelector('#tp-sec-plugins .pl-policy-setup').click();
  await settle(6);
  modal.querySelector('.tp-skill-row .tp-skill-act[data-state="off"]').click();
  await settle(8);
  assert.equal(posts.length, 2);
  assert.equal(modal.classList.contains('hidden'), true, 'the checklist it came from closes');
  rows = [{ ...SKILL_NEW, state: 'off' }];
  doc.querySelector('#tp-sec-plugins .pl-policy-setup').click();
  await settle(6);
  rows = [{ ...SKILL_NEW, state: 'ok', working: true }];
  modal.querySelector('.tp-skill-row .tp-skill-act[data-state="off"]').click();
  await settle(8);
  assert.equal(posts.length, 2, 'moved on: no POST');
  assert.equal(modal.classList.contains('hidden'), false);
  assert.equal(modal.querySelector('.tp-skill-row .tp-skill-state').textContent, 'On', 'the checklist repainted');
  rows = [SKILL_NEW];
  await go('connectors');
  await settle(8);
  const strip = doc.querySelector('[data-view="connectors"] [data-mcp-strip]');
  assert.equal(strip.querySelector('.card-head b').textContent, 'acme/gateway requires the skill deploy-checklist · acme in its Team set');
  strip.querySelector('.tp-skill-act[data-consent="1"]').click();
  await settle(8);
  assert.equal(modal.classList.contains('hidden'), false, 'the strip click opened a dialog');
  assert.equal(doc.getElementById('plugin-modal-title').textContent, 'Turn on skill: deploy-checklist', 'the strip opens the same dialog');
});
