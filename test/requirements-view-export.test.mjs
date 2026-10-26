// test/requirements-view-export.test.mjs — Export to a tracker on the Requirements page in jsdom with a fake API
// (plans/requirements-a6-design.md §7; design round 5, boards 26–31). No server, no tracker.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#requirements' });
for (const k of ['document', 'location', 'Event', 'KeyboardEvent', 'HTMLElement', 'window']) {
  Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 12; i += 1) await tick(); };
after(() => window.close());
const { createRequirementsView } = await import('../ui/public/requirements-view.mjs');

/** Routes: `METHOD url` → a value, or (body) => value (may be a promise); a value { __status, body } answers that status. */
function fakeApi(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, url, body });
    const hit = routes[`${method} ${url}`];
    let out = typeof hit === 'function' ? await hit(body) : hit;
    let status = out !== undefined ? 200 : 404;
    if (out && out.__status) { status = out.__status; out = out.body; }
    return { ok: status < 400, status, json: async () => out ?? { error: 'not found' }, text: async () => '# md' };
  };
  return calls;
}
const BASE = { 'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop' }] }, 'GET /api/workspaces': { workspaces: [{ id: 'ws-1', name: 'web' }] } };
const KEYS = ['goal', 'criteria', 'interview', 'openQuestions', 'assumptions', 'target'];
const readiness = (failing = []) => ({ ok: !failing.length, passed: 6 - failing.length, total: 6, overridable: failing.length > 0,
  checks: KEYS.map((key) => ({ key, ok: !failing.includes(key), label: { interview: 'Interview finished', openQuestions: 'No open questions',
    assumptions: 'Every assumption decided' }[key] || key, hint: failing.includes(key) ? 'not yet' : '' })) });
const XV = (over = {}) => ({ tracker: { name: 'Jira' }, canExport: true, hasSetup: true, link: null, exporting: false, doneStatus: null, history: [], ...over });
const LINK = { key: 'SHOP-123', url: 'https://acme.test/browse/SHOP-123', createdAt: '2026-10-26T10:42:00Z', exportedAt: '2026-10-26T10:42:00Z',
  madeOn: '26 Oct', lastOn: '26 Oct', tracker: 'Jira' };
const SPEC = { goal: { text: 'Cancel', measure: 'fewer calls' }, actors: [], flow: [], edgeCases: [], rules: [], outOfScope: [],
  criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }], assumptions: [], openQuestions: [], edited: {} };
const feature = (over = {}) => ({ seq: 7, id: 'FEAT-7', scopeType: 'project', scopeKey: 'shop-1', title: 'Cancel an order before it ships', status: 'done',
  rounds: 3, costUsd: 0.62, busy: false, orientation: null, spec: SPEC, pending: null, lastError: null, state: 'ready', readiness: readiness(), starts: [],
  unaskedRejections: [], changedSinceStart: [], attachments: [], briefDocuments: [], unaskedFiles: [], interview: null, resetPeriod: 'monthly',
  export: XV(), ...over });
const F = '/api/requirements/7';
const SETUP_URL = '/api/requirements/export-setup/project/shop-1';
const CONN = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const TRACKERS = [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira', multiProfile: true,
  profiles: [{ id: 'acme', label: 'acme.atlassian.net (Cloud)' }, { id: 'beta', label: 'jira.beta.test (Data Center)' }] }];
const optionsAnswer = (b) => ({
  projects: b.profile === 'beta' ? [{ value: 'OPS', label: 'OPS — Operations' }] : [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }],
  ...(b.project ? { issueTypes: [{ value: '10001', label: 'Story' }, { value: '10002', label: 'Task' }, { value: '10003', label: 'Bug' }] } : {}),
  ...(b.project && b.issueType ? { priorities: [{ value: '1', label: 'Highest' }, { value: '2', label: 'High' }, { value: '3', label: 'Medium' }, { value: '4', label: 'Low' }],
    criteriaFields: [{ value: 'customfield_10070', label: 'Acceptance Criteria' }, { value: 'customfield_10071', label: 'Definition of Done' }] } : {}),
  doneStatus: 'Done' });
const SETUP_ROUTES = (setup = null) => ({ [`GET ${SETUP_URL}`]: { setup, trackers: TRACKERS, defaultProfile: CONN },
  [`POST ${SETUP_URL}/options`]: (b) => optionsAnswer(b), [`PUT ${SETUP_URL}`]: (b) => ({ setup: { ...b } }) });

const make = () => {
  const host = document.createElement('div'); const msgEl = document.createElement('p'); const subEl = document.createElement('div');
  const nav = document.createElement('nav');
  document.body.replaceChildren(nav, host);
  const view = createRequirementsView({ host, subEl, msgEl, deps: { route: () => {}, who: () => 'Tomica' } });
  return { host, msgEl, nav, view };
};
const openFeature = async (f, extra = {}) => {
  const calls = fakeApi({ ...BASE, [`GET ${F}`]: () => ({ feature: f, turns: [] }), ...extra });
  const m = make();
  await m.view.show('feature/7');
  await settle();
  return { ...m, calls };
};
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const dlg = () => document.querySelector('.req-dlg-wrap [role="dialog"]');
const q = (ui, root = document) => root.querySelector(`[data-ui="${ui}"]`);
const menuItems = (host) => [...host.querySelectorAll('[data-menu="export"] [role="menuitem"], [data-menu="export"] [role="separator"]')]
  .map((x) => (x.getAttribute('role') === 'separator' ? '—' : text(x)));
const pick = (sel, value) => { sel.value = value; sel.dispatchEvent(new window.Event('change')); };
const optionTexts = (sel) => [...sel.options].map((o) => o.textContent);

// ── the menu (board 26's note, D1) ──

test('board 26: Export ▾ ends with a separator, Export to Jira… and Export setup…', async () => {
  const { host } = await openFeature(feature());
  assert.deepEqual(menuItems(host), ['Save to specs/', 'Copy Markdown', 'Download .md', '—', 'Export to Jira…', 'Export setup…']);
});

test('D1: several trackers and none bound: "Export to a tracker…"; none at all: "Connect a tracker…"; a workspace has no Save to specs/', async () => {
  let m = await openFeature(feature({ export: XV({ tracker: { name: null } }) }));
  assert.equal(text(q('mi-export', m.host)), 'Export to a tracker…');
  m = await openFeature(feature({ export: XV({ tracker: null, canExport: false, hasSetup: false }) }));
  assert.deepEqual(menuItems(m.host), ['Save to specs/', 'Copy Markdown', 'Download .md', '—', 'Connect a tracker…']);
  m = await openFeature(feature({ scopeType: 'workspace', scopeKey: 'ws-1' }));
  assert.deepEqual(menuItems(m.host), ['Copy Markdown', 'Download .md', '—', 'Export to Jira…', 'Export setup…']);
});

test('board 29 (7): an archived feature: Export to Jira… is disabled and says why; Export setup… stays', async () => {
  const { host } = await openFeature(feature({ status: 'archived', state: 'archived', export: XV({ canExport: false }) }));
  const item = q('mi-export', host);
  assert.equal(item.disabled, true);
  const why = host.querySelector(`#${item.getAttribute('aria-describedby')}`);
  assert.deepEqual([text(why), item.title], ['Restore the feature to export it.', 'Restore the feature to export it.']);
  assert.equal(why.closest('[role="menu"]'), null, 'outside the menu: a menu holds only items and separators');
  assert.deepEqual([...host.querySelectorAll('[data-menu="export"] [role="menu"] > *')].map((x) => x.getAttribute('role')),
    ['menuitem', 'menuitem', 'menuitem', 'separator', 'menuitem', 'menuitem']);
  assert.equal(q('mi-export-setup', host).disabled, false);
});

test('Connect a tracker…: a modal dialog with the line, Close focused, the Marketplace button for Advanced; Escape closes, focus returns', async () => {
  const { host, nav } = await openFeature(feature({ export: XV({ tracker: null, canExport: false, hasSetup: false }) }));
  q('menu-export', host).click();
  q('mi-connect', host).click();
  const d = dlg();
  assert.deepEqual([d.getAttribute('aria-modal'), text(document.getElementById(d.getAttribute('aria-labelledby')))], ['true', 'Connect a tracker']);
  assert.equal(text(d.querySelector('.req-dlg-lead')), 'Trackers are connected on the Marketplace page (Advanced mode), or by whoever set up Worca.');
  assert.equal(document.activeElement, q('connect-close'));
  assert.deepEqual([text(q('connect-market')), q('connect-market').getAttribute('data-min-level')], ['Open the Marketplace page', 'advanced']);
  assert.equal(nav.getAttribute('inert'), '', 'the page behind is inert');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(dlg(), null);
  assert.equal(nav.getAttribute('inert'), null, 'released');
  assert.equal(document.activeElement, q('menu-export', host));
});

// ── the setup (board 26, D2, D16) ──

test('board 26: the first Export to Jira… opens Set up export for shop, each select loaded through options as the one before it', async () => {
  const { host, calls } = await openFeature(feature({ export: XV({ hasSetup: false }) }), SETUP_ROUTES());
  q('menu-export', host).click();
  q('mi-export', host).click();
  assert.deepEqual([document.activeElement, dlg().querySelector('h2').getAttribute('tabindex')], [dlg().querySelector('h2'), '-1'],
    'the focus starts in the dialog, on its title');
  await settle();
  const d = dlg();
  assert.equal(text(d.querySelector('h2')), 'Set up export for shop');
  assert.equal(document.activeElement, q('setup-conn'), 'then on the Connection once it loaded');
  assert.equal(text(d.querySelector('.req-dlg-lead')),
    'Worca uses these for every export from shop. You can change them for one export in the preview, or for good in Export ▾ › Export setup…');
  const conn = q('setup-conn');
  assert.deepEqual([conn.value, optionTexts(conn)], ['jira-source|jira|acme', ['acme.atlassian.net (Cloud)', 'jira.beta.test (Data Center)']]);
  assert.equal(text(document.getElementById(conn.getAttribute('aria-describedby'))), 'Connections are added on the Marketplace page: Installed › Jira (Advanced mode).');
  assert.equal(text(d.querySelector('label[for="req-setup-proj"]')), 'Jira project');
  assert.deepEqual([q('setup-project').value, q('setup-type').value], ['SHOP', '10001'], 'Story by default');
  assert.deepEqual(optionTexts(q('setup-prio')), ['None', 'Highest', 'High', 'Medium', 'Low']);
  assert.equal(q('setup-prio').value, '');
  assert.deepEqual([...d.querySelectorAll('.req-export-lab')].map(text), ['worca']);
  assert.equal(d.querySelector('.req-export-x').getAttribute('aria-label'), 'Remove label worca');
  assert.equal(d.querySelector('.req-export-x svg') !== null && !/×/.test(d.querySelector('.req-export-x').textContent), true, 'an icon, not a glyph');
  const group = d.querySelector('[role="radiogroup"]');
  assert.equal(text(document.getElementById(group.getAttribute('aria-labelledby'))), 'Acceptance criteria go to');
  assert.deepEqual([q('setup-crit-desc').checked, q('setup-crit-select').disabled, q('setup-crit-select').getAttribute('aria-label')],
    [true, true, 'Jira field for acceptance criteria']);
  assert.deepEqual([...group.querySelectorAll('.req-export-rad')].map(text), ['A section of the description', 'A Jira field']);
  assert.deepEqual(optionTexts(q('setup-crit-select')), ['Acceptance Criteria (custom field)', 'Definition of Done (custom field)'], 'board 26');
  assert.equal(text(group.querySelector('p.hint')), 'The list shows the text fields of SHOP that can hold the criteria.');
  assert.deepEqual(calls.filter((c) => c.url === `${SETUP_URL}/options`).map((c) => c.body),
    [CONN, { ...CONN, project: 'SHOP' }, { ...CONN, project: 'SHOP', issueType: '10001' }]);
  assert.deepEqual([text(q('setup-save')), q('setup-save').disabled], ['Save and continue', false]);
});

test('setup: labels added (Enter) and removed, a Jira field for the criteria, a priority; Save sends the names; Export setup… says Save and closes', async () => {
  const { host, calls } = await openFeature(feature(), SETUP_ROUTES({ ...CONN, trackerProject: 'SHOP', issueType: '10001', priority: null, labels: ['worca'],
    criteria: { target: 'description' } }));
  q('menu-export', host).click();
  q('mi-export-setup', host).click();
  await settle();
  assert.equal(text(q('setup-save')), 'Save');
  const input = q('setup-lab-in');
  input.value = 'needs review';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual([...dlg().querySelectorAll('.req-export-lab')].map(text), ['worca', 'needs review']);
  assert.equal(document.activeElement, q('setup-lab-in'), 'focus stays in the field');
  q('setup-lab-x-0').click();
  assert.deepEqual([...dlg().querySelectorAll('.req-export-lab')].map(text), ['needs review']);
  q('setup-crit-field').click();
  q('setup-crit-field').dispatchEvent(new window.Event('change'));
  assert.equal(q('setup-crit-select').disabled, false);
  pick(q('setup-crit-select'), 'customfield_10071');
  pick(q('setup-prio'), '2');
  q('setup-save').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { ...CONN, project: 'SHOP', projectName: 'SHOP — Shop web', issueType: '10001', issueTypeName: 'Story',
    labels: ['needs review'], priority: '2', priorityName: 'High', criteria: { target: 'field', field: 'customfield_10071', name: 'Definition of Done' } });
  assert.equal(dlg(), null);
  assert.equal(document.activeElement, q('menu-export', host));
});

test('setup: an answer for a connection no longer chosen is dropped; a failure shows the server\'s sentence; a Jira too old says so', async () => {
  let release;
  // openFeature copies the routes, so the options route reads `options`, which the test swaps below
  let options = (b) => (b.profile === 'acme' && !b.project ? new Promise((r) => { release = () => r(optionsAnswer(b)); }) : optionsAnswer(b));
  const routes = SETUP_ROUTES();
  routes[`POST ${SETUP_URL}/options`] = (b) => options(b);
  const { host } = await openFeature(feature({ export: XV({ hasSetup: false }) }), routes);
  q('menu-export', host).click();
  q('mi-export', host).click();
  await settle();
  pick(q('setup-conn'), 'jira-source|jira|beta');
  await settle();
  release();
  await settle();
  assert.deepEqual(optionTexts(q('setup-project')), ['OPS — Operations'], 'the late acme answer did not land');
  options = () => ({ __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' } });
  pick(q('setup-conn'), 'jira-source|jira|acme');
  await settle();
  assert.equal(text(dlg().querySelector('[role="alert"]')), 'Worca could not reach Jira: the API token was refused.');
  assert.equal(q('setup-save').disabled, true);
  options = (b) => (b.project ? { ...optionsAnswer(b), issueTypes: [], tooOld: true } : optionsAnswer(b));
  pick(q('setup-conn'), 'jira-source|jira|beta');
  await settle();
  assert.equal(text(dlg().querySelector('[role="alert"]')), 'This Jira is too old for export setup.');
  assert.equal(q('setup-save').disabled, true);
});

test('CSS: the A6 rules sit inside the Requirements block and use tokens only', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  const block = css.slice(start, end);
  for (const sel of ['.req-export-fld', '.req-export-pair', '.req-export-x', '.req-export-rad', '.req-export-alert']) {
    const at = css.indexOf(sel);
    assert.ok(at > start && at < end, `${sel} inside the Requirements block`);
  }
  const mine = block.split('\n').filter((l) => /req-export|req-history|req-report|req-dlg-sheet/.test(l));
  const bad = /#[0-9a-fA-F]{3,8}\b|rgba?\(|font(?:-size)?:[^;}]*\b(?:11\.5|12\.5|14)px|border-radius:(?:12|999)px|min-height:44px/;
  assert.ok(mine.every((l) => !bad.test(l)), mine.filter((l) => bad.test(l)).join('\n'));
});
