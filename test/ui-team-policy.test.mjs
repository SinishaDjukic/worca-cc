// test/ui-team-policy.test.mjs — the team-policy surfaces wired through the REAL index.html +
// app.js in jsdom (team-policy design §11): nav + view, Projects cells, the page (table / empty
// state / editor), the Settings readout, the New pipeline notes line, the History meta segment,
// and the team-cap pause banner with its "continue past" flow. Harness: the ui-cost-paused idiom
// (dispatchable WebSocket stub, recorded fetch calls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

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
const EMPTY_SCOPES = { projects: [OFF_STATUS], workspaces: [], scopes: { projects: [], workspaces: [] }, homes: [], requirements: [], blockedPlugins: [], anyEnabled: false };
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
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
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

test('nav: Team policy sits in Manage after Workspaces, mirrored in the compact top-nav, and routes to its view', async () => {
  const { doc, go } = await boot();
  const side = [...doc.querySelectorAll('.nav button[data-nav]')].map((b) => b.dataset.nav);
  assert.equal(side[side.indexOf('workspaces') + 1], 'team-policy');
  assert.equal(doc.querySelector('.nav button[data-nav="team-policy"] span').textContent, 'Team policy');
  assert.ok(doc.querySelector('.topnav button[data-nav="team-policy"]'));
  await go('team-policy');
  assert.equal(doc.querySelector('.view[data-view="team-policy"]').classList.contains('hidden'), false);
  assert.equal(doc.querySelector('.nav button[data-nav="team-policy"]').classList.contains('active'), true);
});

test('Team policy page: the sync chip carries freshness only; the panel carries the document and the version', async () => {
  const { doc, go, settle } = await boot();
  await go('team-policy');
  await settle();
  const chip = doc.getElementById('tp-sync');
  assert.equal(chip.hidden, false);
  assert.equal(chip.textContent, 'Synced just nowRefresh', 'the team-metrics chip, without the commit id');
  const head = doc.querySelector('#tp-body .tp-head');
  assert.equal(head.querySelector('.tp-head-title').textContent, 'Gateway team policy');
  const facts = [...head.querySelectorAll('.tp-facts dt')].map((dt) => dt.textContent);
  assert.deepEqual(facts, ['SOURCE', 'APPLIES TO', 'VERSION']);
  assert.match(head.querySelectorAll('.tp-facts dd')[2].textContent, /^3f2a1bc · updated just now by Mara$/);
  assert.equal(doc.querySelector('#tp-scope-meta'), null, 'the chip row of pills is gone');
  // The cards are this machine's side, and each tab is its own section.
  const cards = [...doc.querySelectorAll('#tp-body .tp-ov-card')].map((c) => [c.querySelector('.tp-ov-label').textContent, c.querySelector('.tp-ov-value').textContent]);
  assert.deepEqual(cards, [['PER-PIPELINE CAP', '$10.00'], ['TOTAL CAP', '$120.00'], ['REQUIRED PLUGINS', '0/1'], ['OFF-POLICY HERE', '1']]);
  assert.equal(doc.querySelector('#tp-body .tp-sec-label').textContent, 'ON THIS MACHINE');
  const tabs = [...doc.querySelectorAll('#tp-body .tp-tab')].map((b) => [b.dataset.sec, b.querySelector('.tp-tab-badge')?.textContent]);
  assert.deepEqual(tabs, [['policy', '2'], ['plugins', '1']], 'no Catalog tab when the policy ships none');
  assert.ok(doc.querySelector('#tp-sec-policy table.tp-tbl'), 'the effective table is the Policy tab');
  assert.equal(doc.getElementById('tp-sec-plugins').hidden, true);
});

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
  assert.equal(editor.querySelector('.tp-publish').disabled, true);
  const cap = editor.querySelector('.tp-edit-row[data-key="cost.pipelineLimitUsd"][data-scope="fields"] .tp-val');
  cap.value = '12';
  cap.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle();
  assert.equal(editor.querySelector('.tp-publish').disabled, false, 'a change enables Publish');
  editor.querySelector('.tp-publish').click();
  await settle(8);
  assert.equal(puts.length, 1, 'one PUT /api/policy');
  assert.equal(puts[0].scope, 'project:gateway-00000001');
  assert.equal(puts[0].doc.fields['cost.pipelineLimitUsd'].value, 12);
  assert.ok(fetchCalls.some((c) => c.url.includes('/api/policy/validate')), 'validated before publishing');
  assert.ok(doc.querySelector('#tp-body table.tp-tbl'), 'back in read mode after a publish');
  assert.match(doc.querySelector('#tp-body .form-msg.ok').textContent, /Published · commit abc1234/);
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
  editor.querySelector('.tp-publish').click();
  await settle(8);
  const msg = editor.querySelector('.tp-msg');
  assert.ok(msg.classList.contains('err'));
  assert.match(msg.textContent, /push rejected · remote: error: GH006: Protected branch update failed .* · you may not have push rights/);
  assert.equal(editor.querySelector('.tp-publish').disabled, false, 'the bar is usable again after a rejection');
});

test('Team policy page: nothing enabled → the empty state; a 404 for the scope → an honest error', async () => {
  const empty = await boot({ scopes: EMPTY_SCOPES });
  await empty.go('team-policy');
  await empty.settle();
  assert.ok(empty.doc.querySelector('#tp-body .tm-empty'), 'the two-card empty state');
  assert.equal(empty.doc.getElementById('tp-sync').hidden, true);
  assert.ok(empty.doc.querySelector('#tp-body .tp-check-now'));
  const missing = await boot({ policy: null });
  await missing.go('team-policy');
  await missing.settle();
  assert.match(missing.doc.querySelector('#tp-body .hint.err').textContent, /Could not load the team policy: no team policy/);
});

test('Projects rows carry a compact policy chip; the project page\'s Team tab carries the block with Open', async () => {
  const { doc, go, settle } = await boot();
  await go('projects');
  await settle();
  const rows = [...doc.querySelectorAll('#projects-list .pl-item')];
  assert.equal(rows.length, 2);
  for (const r of rows) {
    const team = r.querySelector('.pl-team');
    assert.ok(team && team.querySelector('.pl-tm') && team.querySelector('.pl-tp'), 'one team column, metrics chip then policy chip');
    assert.equal(r.querySelector('.tp-cell'), null, 'no cell on the row');
  }
  const home = rows[0].querySelector('.pl-tp');
  assert.equal(home.textContent, 'Policy home');
  assert.equal(home.dataset.kind, 'home');
  assert.match(home.title, /^Team policy: Home · 3 fields · updated just now/);
  assert.equal(rows[1].querySelector('.pl-tp').textContent, 'Policy off');
  assert.equal(rows[1].querySelector('.pl-tp').title, 'Team policy: Off · your settings apply');
  // The page: the Team tab's block has the same copy the cell had, and Open lands on the page with the scope preselected.
  await go('projects/gateway-00000001/team');
  await settle();
  const cell = doc.querySelector('#proj-detail .pd-team-policy .tp-cell');
  assert.match(cell.querySelector('.tm-status').textContent, /^On · policy home · 3 fields · updated just now$/);
  assert.equal(cell.querySelector('.tm-label'), null);
  cell.querySelector('.tp-open').click();
  await settle();
  assert.equal(window.location.hash, '#team-policy/project:gateway-00000001');
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

test('Settings › Budget: the team readout mounts and the labels carry team chips', async () => {
  const { doc, go, settle } = await boot();
  await go('settings');
  await settle(6);
  const readout = doc.querySelector('#teamCapsReadout .team-readout');
  assert.ok(readout, 'the readout paints under the spend line');
  assert.equal(readout.querySelector('.badge.blue').textContent, 'acme/gateway');
  const chip = doc.querySelector('label[for="budgetPerPipeline"]').closest('.label-row').querySelector('.team-chip');
  assert.ok(chip);
  assert.equal(chip.textContent, 'soft team $10.00');
  assert.equal(doc.querySelector('label[for="budgetTotal"]').closest('.label-row').querySelector('.team-chip').textContent, 'soft team $150.00');
});

test('New pipeline: the policy notes line paints for the selected project and hides without a policy', async () => {
  const { doc, go, settle, window } = await boot();
  await go('new');
  await settle();
  const sel = doc.getElementById('projectSelect');
  sel.value = PROJECT;
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  await settle();
  const line = doc.getElementById('policyLine');
  assert.equal(line.hidden, false);
  assert.match(line.querySelector('.pl-head-row').textContent, /acme\/gateway · 1 note · nothing here blocks the run/);
  assert.match(line.querySelector('.pl-note.warn').textContent, /acme-jira is not installed/);
});

test('History detail meta: the policy segment names overrides and off-policy picks', async () => {
  const detail = { state: { id: 'h1', phase: 'implement', status: 'done', totalCostUsd: 5.2, steps: [] }, policy: { home: 'acme/gateway', sha: '3f2a1bc0', overrides: ['pipeline'], exceeded: [], deviations: ['model:claude-opus-4-8'], unattended: false, reason: 'hotfix' } };
  const { doc, go, settle } = await boot({
    fetchHandler: (u) => {
      if (u.endsWith('/api/history/k1/h1')) return json(detail);
      if (u.endsWith('/api/history')) return json({ pipelines: [{ id: 'h1', projectKey: 'k1', title: 'Feat', status: 'done', startedAt: '2026-01-01T00:00:00Z' }], live: [], ghAvailable: false });
      return null;
    },
  });
  await go('history');
  await settle();
  await go('history/k1/h1');
  await settle(6);
  const seg = doc.querySelector('#hist-detail .hd-policy');
  assert.ok(seg, 'the meta line carries the policy segment');
  assert.equal(seg.textContent, 'policy · 1 override · 1 off-policy');
  assert.match(seg.title, /policy acme\/gateway @ 3f2a1bc · hotfix/);
});

test('Running: a cost_pipeline_policy pause shows the blue banner; "Continue past" prompts, then resumes with pastTeamCap', async () => {
  const ctx = await boot();
  const { doc, recv, settle, fetchCalls } = ctx;
  await ctx.go('running');
  recv({ type: 'hello', runs: [{ runId: 'r1', title: 'Feat', projectDir: PROJECT, status: 'running', startedAt: '00:00:00', pipelineId: 'pl_1' }] });
  await settle();
  recv({ type: 'done', runId: 'r1', status: 'paused', reason: 'cost_pipeline_policy', detail: 'team cost cap reached ($10.00 >= $10.00, acme/gateway)' });
  await settle();
  const card = doc.querySelector('#run-list .run-card');
  const banner = card.querySelector('.cost-banner');
  assert.equal(banner.hidden, false);
  assert.ok(banner.classList.contains('cb-policy'), 'the blue team-cap variant');
  assert.match(banner.textContent, /Paused — team cost cap reached/);
  assert.equal(card.querySelector('.rc-status-word').textContent, 'Paused · team cap');
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
  assert.deepEqual(JSON.parse(posts[0].opts.body), { pipelineId: 'pl_1', pastTeamCap: true, policyReason: 'release hotfix' });
});
