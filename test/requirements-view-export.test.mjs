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

test('board 29 (7): an archived feature: Export to Jira… is aria-disabled and says why under the open menu; Export setup… stays', async () => {
  const { host, calls } = await openFeature(feature({ status: 'archived', state: 'archived', export: XV({ canExport: false }) }), SETUP_ROUTES());
  const item = q('mi-export', host);
  assert.deepEqual([item.disabled, item.getAttribute('aria-disabled')], [false, 'true'], 'focusable and announced, not native disabled');
  const why = host.querySelector(`#${item.getAttribute('aria-describedby')}`);
  assert.deepEqual([text(why), item.title], ['Restore the feature to export it.', 'Restore the feature to export it.']);
  assert.equal(why.closest('[role="menu"]'), null, 'outside the menu: a menu holds only items and separators');
  assert.deepEqual([why.classList.contains('hint'), why.classList.contains('sr-only')], [true, false], 'a visible hint (board 29, 7)');
  assert.equal(why.closest('[hidden]') !== null, true, 'hidden while the menu is closed');
  q('menu-export', host).click();
  assert.equal(why.closest('[hidden]'), null, 'shown under the open menu');
  assert.ok(why.closest('[data-menu="export"]'), 'beside the Export menu');
  assert.deepEqual([...host.querySelectorAll('[data-menu="export"] [role="menu"] > *')].map((x) => x.getAttribute('role')),
    ['menuitem', 'menuitem', 'menuitem', 'separator', 'menuitem', 'menuitem']);
  item.focus();
  assert.equal(document.activeElement, item, 'focusable');
  item.click();
  await settle();
  assert.deepEqual([dlg(), calls.filter((c) => c.url.includes('export')).length], [null, 0], 'activating it does nothing');
  assert.equal(host.querySelector('[data-menu="export"] [role="menu"]').hidden, false, 'the menu stays open');
  assert.equal(q('mi-export-setup', host).disabled, false);
  q('menu-export', host).click();
  assert.equal(why.closest('[hidden]') !== null, true, 'hidden again with the menu');
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

// ── fix round 1 (review of Task 8) ──

/** A route that answers only when the test lets it: `hold.route` for the fake API, `hold.release()` answers. */
const held = (answer) => {
  const hold = { release: null };
  hold.route = (b) => new Promise((r) => { hold.release = () => r(typeof answer === 'function' ? answer(b) : answer); });
  return hold;
};
const SAVED = { ...CONN, trackerProject: 'SHOP', issueType: '10001', priority: null, labels: ['worca'], criteria: { target: 'description' } };
const openSetupFrom = async (routes, over = {}) => {
  const m = await openFeature(feature(over), routes);
  q('menu-export', m.host).click();
  q('mi-export-setup', m.host).click();
  return m;
};

test('setup: a label being typed keeps its text and caret while a slow options answer lands; removing a chip keeps it too', async () => {
  let options = (b) => optionsAnswer(b);
  const routes = { ...SETUP_ROUTES(SAVED), [`POST ${SETUP_URL}/options`]: (b) => options(b) };
  await openSetupFrom(routes);
  await settle();
  const slow = held((b) => optionsAnswer(b));
  options = slow.route;
  pick(q('setup-type'), '10002');
  await settle();
  const input = q('setup-lab-in');
  input.focus();
  input.value = 'needs';
  input.setSelectionRange(2, 2);
  input.dispatchEvent(new window.Event('input'));
  slow.release();
  await settle();
  assert.equal(q('setup-save').disabled, false, 'the answer landed');
  assert.deepEqual([q('setup-lab-in') === input, input.value, document.activeElement === input, input.selectionStart], [true, 'needs', true, 2]);
  q('setup-lab-x-0').click();
  assert.deepEqual([[...dlg().querySelectorAll('.req-export-lab')].map(text), q('setup-lab-in').value, document.activeElement === q('setup-lab-in')],
    [[], 'needs', true], 'a chip removed: the typed text stays and the focus goes back to the field');
  assert.equal(q('setup-lab-in').parentElement.classList.contains('req-export-chips'), true, 'board 26: the field ends the chips row');
});

test('setup: an options answer that changes nothing leaves the selects alone (an open dropdown stays open)', async () => {
  const { calls } = await openSetupFrom(SETUP_ROUTES(SAVED));
  await settle();
  const sel = q('setup-project');
  const opts = [...sel.options];
  const prio = [...q('setup-prio').options];
  pick(q('setup-type'), '10002');
  await settle();
  assert.equal(calls.filter((c) => c.url === `${SETUP_URL}/options`).length, 4, 'the fields were asked for again');
  assert.equal(q('setup-project'), sel);
  assert.deepEqual([[...sel.options].every((o, i) => o === opts[i]), [...q('setup-prio').options].every((o, i) => o === prio[i])], [true, true]);
});

test('setup: a saved connection that is gone leads with "Choose a connection"; picking the one there is loads', async () => {
  const one = [{ ...TRACKERS[0], profiles: [TRACKERS[0].profiles[0]] }];
  const routes = { ...SETUP_ROUTES(), [`GET ${SETUP_URL}`]: { setup: { ...SAVED, profile: 'gone' }, trackers: one, defaultProfile: CONN } };
  const { calls } = await openSetupFrom(routes);
  await settle();
  const conn = q('setup-conn');
  assert.deepEqual([conn.value, optionTexts(conn)], ['', ['Choose a connection', 'acme.atlassian.net (Cloud)']]);
  assert.deepEqual([calls.filter((c) => c.url === `${SETUP_URL}/options`).length, q('setup-save').disabled], [0, true]);
  pick(conn, 'jira-source|jira|acme');
  await settle();
  assert.deepEqual([optionTexts(conn), q('setup-project').value, q('setup-save').disabled], [['acme.atlassian.net (Cloud)'], 'SHOP', false]);
});

test('setup: the focus moves on to the Connection only while it is still on the title', async () => {
  const slow = held({ setup: SAVED, trackers: TRACKERS, defaultProfile: CONN });
  await openSetupFrom({ ...SETUP_ROUTES(), [`GET ${SETUP_URL}`]: slow.route });
  assert.equal(document.activeElement, dlg().querySelector('h2'));
  q('setup-cancel').focus();
  slow.release();
  await settle();
  assert.equal(document.activeElement, q('setup-cancel'), 'not taken from where the user put it');
});

test('setup: an answer that comes after the dialog closed is dropped', async () => {
  const slow = held({ setup: SAVED, trackers: TRACKERS, defaultProfile: CONN });
  const { host, nav, calls } = await openSetupFrom({ ...SETUP_ROUTES(), [`GET ${SETUP_URL}`]: slow.route });
  q('setup-cancel').click();
  assert.deepEqual([dlg(), nav.getAttribute('inert'), document.activeElement], [null, null, q('menu-export', host)]);
  slow.release();
  await settle();
  assert.deepEqual([dlg(), calls.filter((c) => c.url === `${SETUP_URL}/options`).length, document.activeElement], [null, 0, q('menu-export', host)]);
});

test('setup: while saving, Escape and Cancel do not close and a second Save does not post; Save releases the page', async () => {
  const slow = held((b) => ({ setup: b }));
  const { host, nav, calls } = await openSetupFrom({ ...SETUP_ROUTES(SAVED), [`PUT ${SETUP_URL}`]: slow.route });
  await settle();
  assert.equal(nav.getAttribute('inert'), '', 'the page behind is inert');
  q('setup-save').click();
  q('setup-save').click();
  q('setup-save').dispatchEvent(new window.Event('click'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  q('setup-cancel').click();
  assert.ok(dlg(), 'still open while saving');
  slow.release();
  await settle();
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 1, 'one save');
  assert.deepEqual([dlg(), nav.getAttribute('inert'), host.getAttribute('inert')], [null, null, null], 'closed and released');
});

test('setup: Shift+Tab from the title wraps to the last control; Escape while composing text does not close; Enter while composing adds no label', async () => {
  await openSetupFrom(SETUP_ROUTES(SAVED));
  await settle();
  const title = dlg().querySelector('h2');
  title.focus();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  assert.equal(document.activeElement, q('setup-save'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
  assert.ok(dlg(), 'an IME composition ends, the dialog stays');
  const input = q('setup-lab-in');
  input.focus();
  input.value = 'にほん';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
  assert.deepEqual([[...dlg().querySelectorAll('.req-export-lab')].map(text), input.value], [['worca'], 'にほん']);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(dlg(), null);
});

test('CSS (board 26): the label field shares the chips row, the buttons sit under a rule, a radio row is 28 px', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const rule = (sel) => { const at = css.indexOf(`${sel}{`); return at < 0 ? '' : css.slice(at, css.indexOf('}', at)); };
  assert.match(rule('.req-export-labin'), /flex:1 1 120px/);
  assert.match(rule('.req-dialog.req-export .req-dlg-btns'), /padding-top:14px;border-top:1px solid var\(--line\)/);
  assert.match(rule('.req-export-rad'), /min-height:28px/);
  assert.match(rule('.req-menu .req-export-menupop'), /position:absolute/);
  assert.match(css, /\.req-export-menupop\[hidden\]\{display:none\}/);
});

// ── Task 9: the preview, Export anyway, Export again, the comment, the chip, History (boards 27, 28) ──
const DESC = ['## Goal', '', 'Customers cancel an order themselves until it leaves the warehouse.', '', 'Measure: a third fewer support calls.', '',
  '## Main flow', '', '1. Open the order.', '2. Cancel it.', '',
  '## Acceptance criteria', '', '- R-po-1 A customer can cancel a paid order.', '- R-po-2 <img src=x onerror=alert(1)> stays text', '',
  'From Worca FEAT-7 · exported 26 Oct 2026', ''].join('\n');
const FIELDS = { conn: CONN, connection: 'acme.atlassian.net (Cloud)', project: { value: 'SHOP', label: 'SHOP — Shop web' },
  issueType: { value: '10001', label: 'Story' }, labels: ['worca', 'worca-FEAT-7'], fixedLabel: 'worca-FEAT-7', priority: null,
  criteria: { target: 'description' }, summary: 'Cancel an order before it ships' };
const preview = (over = {}) => ({ mode: 'create', tracker: 'Jira', key: null, comment: null, previewHash: 'h1', changes: [], fields: FIELDS, link: null,
  edited: false, gone: false, ticket: { project: 'SHOP', issueType: '10001', title: 'Cancel an order before it ships', description: DESC,
    labels: ['worca', 'worca-FEAT-7'], priority: null, criteria: { target: 'description' } }, ...over });
const AGAIN = (over = {}) => preview({ mode: 'update', key: 'SHOP-123', link: { key: 'SHOP-123', madeOn: '26 Oct', lastOn: '26 Oct' },
  changes: [{ line: 'Added R-po-6 An order with some items shipped can cancel only the items not yet picked up.', id: 'R-po-6' },
    { line: 'Business rules: 1 line changed', id: null }, { line: 'Edge cases: 1 line added', id: null }], ...over });
const exportAnswer = (action, key) => ({ action, key, url: `https://acme.test/browse/${key}`, turns: [],
  feature: feature({ export: XV({ link: { ...LINK, key, url: `https://acme.test/browse/${key}` },
    history: [{ action, tracker: 'Jira', key, url: `https://acme.test/browse/${key}`, reason: null, when: '26 Oct, 10:42', by: 'Tomica Brkovic' }] }) }) });
const PREVIEW_URL = `${F}/export/preview`;
const EXPORT_URL = `${F}/export`;
const openExport = async (f, routes) => {
  const m = await openFeature(f, { ...SETUP_ROUTES(), ...routes });
  q('menu-export', m.host).click();
  q('mi-export', m.host).click();
  await settle();
  return m;
};
const typeReason = (why) => { q('export-reason').value = why; q('export-reason').dispatchEvent(new window.Event('input')); };

test('board 27: with a setup a Ready feature goes straight to the preview: the fields, the description as text, Create in Jira', async () => {
  const { calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview() });
  const d = dlg();
  assert.equal(text(document.getElementById(d.getAttribute('aria-labelledby'))), 'Export FEAT-7 to Jira');
  const title = d.querySelector('h2');
  assert.deepEqual([document.activeElement, title.getAttribute('tabindex')], [title, '-1'], 'the focus is in the dialog, on its title');
  // board 31's phone title: CSS hides this part at 900 px and narrower and shows the line under the title
  assert.deepEqual([text(title.querySelector('.req-export-tid')), text(d.querySelector('.req-export-sub'))],
    ['FEAT-7', 'FEAT-7 · Cancel an order before it ships']);
  assert.equal(text(d.querySelector('.req-dlg-lead')), 'This is the ticket Worca will create in SHOP. Change the issue type, labels or priority for this export.');
  assert.deepEqual(calls.find((c) => c.url === PREVIEW_URL).body, { mode: 'create' });
  assert.deepEqual([...d.querySelectorAll('.req-export-fields > .req-export-fld')].map((x) => text(x.firstChild)),
    ['Project', 'Issue type', 'Summary', 'Labels', 'Priority', 'Acceptance criteria']);
  const fld = (i) => d.querySelectorAll('.req-export-fields > .req-export-fld')[i];
  const valHint = (i) => [text(fld(i).querySelector('.req-export-val')), text(fld(i).querySelector('.hint'))];
  assert.deepEqual(valHint(0), ['SHOP — Shop web', 'Saved in the export setup · acme.atlassian.net (Cloud)']);
  assert.deepEqual(valHint(2), ['Cancel an order before it ships', "The feature's title"]);
  assert.deepEqual(valHint(5), ['→ Description', 'A section of the description, as in the export setup']);
  assert.deepEqual([...d.querySelectorAll('.req-export-lab')].map(text), ['worca', 'worca-FEAT-7']);
  assert.equal(d.querySelectorAll('.req-export-lab .req-export-x').length, 1, 'the fixed label cannot be removed');
  assert.equal(text(document.getElementById(d.querySelector('.req-export-fixed').getAttribute('aria-describedby'))),
    'worca-FEAT-7 stays: Worca uses this label to find the ticket again.');
  assert.deepEqual(optionTexts(q('export-type')), ['Story', 'Task', 'Bug'], 'the choices loaded through options');
  assert.deepEqual(optionTexts(q('export-prio')), ['None', 'Highest', 'High', 'Medium', 'Low']);
  const desc = d.querySelector('.req-export-desc');
  assert.deepEqual([desc.getAttribute('tabindex'), desc.getAttribute('aria-label')], ['0', 'Description preview']);
  assert.equal(text(d.querySelector('#req-exp-desc-h')), 'Description, as Jira will show it');
  assert.deepEqual([...desc.querySelectorAll('h4')].map(text), ['Goal', 'Main flow', 'Acceptance criteria']);
  assert.deepEqual([...desc.querySelectorAll('ol li')].map(text), ['Open the order.', 'Cancel it.']);
  assert.equal(desc.querySelector('img'), null, 'never HTML');
  assert.ok(text(desc).includes('<img src=x onerror=alert(1)> stays text'));
  assert.equal(text(desc.querySelector('.req-export-sig')), 'From Worca FEAT-7 · exported 26 Oct 2026');
  assert.equal(text(d.querySelector('.req-export-foot > .hint')), 'Only what you see here is sent to Jira.');
  assert.deepEqual([text(q('export-go')), q('export-go').disabled], ['Create in Jira', false]);
});

test('D6: changing the issue type, a label or the priority asks for a fresh preview with it; the focus stays in the labels field', async () => {
  let n = 0;
  const { calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: (b) => { n += 1; return preview({ previewHash: `h${n}`,
    fields: { ...FIELDS, labels: [...(b.labels || ['worca']).map((l) => l.replace(/\s+/g, '-')), 'worca-FEAT-7'] } }); } });
  pick(q('export-type'), '10002');
  await settle();
  q('export-lab-in').value = 'needs review';
  q('export-lab-in').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  assert.equal(document.activeElement, q('export-lab-in'));
  pick(q('export-prio'), '3');
  await settle();
  assert.deepEqual(calls.filter((c) => c.url === PREVIEW_URL).map((c) => c.body), [{ mode: 'create' },
    { mode: 'create', issueType: '10002', issueTypeName: 'Task' },
    { mode: 'create', issueType: '10002', issueTypeName: 'Task', labels: ['worca', 'needs review'] },
    { mode: 'create', issueType: '10002', issueTypeName: 'Task', labels: ['worca', 'needs review'], priority: '3', priorityName: 'Medium' }]);
  assert.deepEqual([...dlg().querySelectorAll('.req-export-lab')].map(text), ['worca', 'needs-review', 'worca-FEAT-7'], 'as the server normalised it');
});

test('board 29 (4, 5): Create in Jira: Exporting to Jira… and the buttons wait; then the chip, "Created SHOP-123", the focus on the chip', async () => {
  let release;
  const { host, calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview(),
    [`POST ${EXPORT_URL}`]: () => new Promise((r) => { release = () => r(exportAnswer('created', 'SHOP-123')); }) });
  q('export-go').click();
  await settle();
  const status = dlg().querySelector('.req-export-status');
  assert.deepEqual([status.getAttribute('role'), text(status), !!status.querySelector('.badge.blue'), q('export-go').disabled, q('export-cancel').disabled],
    ['status', 'Exporting to Jira…', true, true, true]);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(dlg(), 'Escape waits while exporting');
  release();
  await settle();
  assert.deepEqual(calls.find((c) => c.url === EXPORT_URL).body, { mode: 'create', previewHash: 'h1' });
  assert.equal(dlg(), null);
  const chip = q('export-chip', host);
  assert.deepEqual([text(chip), chip.getAttribute('href'), chip.getAttribute('target'), chip.getAttribute('rel'), chip.getAttribute('aria-label')],
    ['SHOP-123', 'https://acme.test/browse/SHOP-123', '_blank', 'noopener', 'SHOP-123, opens the ticket in Jira in a new tab']);
  assert.ok(chip.querySelector('svg') && !/↗/.test(chip.textContent), 'the external icon, not a glyph');
  assert.equal(document.activeElement, chip);
  const done = host.querySelector('.req-export-done');
  assert.deepEqual([done.getAttribute('role'), text(done), !!done.querySelector('svg')], ['status', 'Created SHOP-123', true]);
});

test('board 27: not Ready, its dialog comes first; the checks as the board writes them; Export anyway needs a reason, the preview gets it', async () => {
  const f = feature({ readiness: readiness(['openQuestions', 'assumptions']), state: 'decide',
    spec: { ...SPEC, openQuestions: ['Do business customers need approval before cancelling?'], assumptions: [{ id: 'A-4', text: 'x', status: 'open' }] } });
  const { calls } = await openExport(f, { [`POST ${PREVIEW_URL}`]: (b) => preview({ ticket: { ...preview().ticket, description: `Exported before Ready: ${b.reason}\n\n${DESC}` } }) });
  const d = dlg();
  assert.equal(text(document.getElementById(d.getAttribute('aria-labelledby'))), 'Export FEAT-7 before it’s Ready?');
  assert.equal(text(d.querySelector('.req-dlg-lead')), '2 checks do not pass yet:');
  assert.deepEqual([...d.querySelectorAll('.req-dlg-fail li')].map(text), ['1 open question. Do business customers need approval before cancelling?',
    'A-4 is not decided. The ticket lists confirmed assumptions only.']);
  assert.equal(text(d.querySelector('label[for="req-exp-reason"]')), 'Why export before it is Ready? required, kept on the feature with your name');
  assert.ok([...d.querySelectorAll('.hint')].some((x) => text(x)
    === 'Your reason is recorded on the feature. The preview then adds it at the top of the description: “Exported before Ready: <your reason>”.'));
  assert.equal(document.activeElement, q('export-reason'));
  assert.equal(q('export-anyway').disabled, true);
  typeReason('The team estimates in Jira tomorrow.');
  assert.equal(text(d.querySelector('.req-dlg-count')), '36 / 500');
  q('export-anyway').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.url === PREVIEW_URL).body, { mode: 'create', reason: 'The team estimates in Jira tomorrow.' });
  assert.equal(text(dlg().querySelector('.req-export-desc p')), 'Exported before Ready: The team estimates in Jira tomorrow.');
});

test('board 28: with a ticket: Export FEAT-7 again, the three choices, what changed; Continue previews Update SHOP-123', async () => {
  const { host, calls } = await openFeature(feature({ export: XV({ link: LINK }) }), { ...SETUP_ROUTES(), [`POST ${PREVIEW_URL}`]: (b) => AGAIN({ mode: b.mode }) });
  q('menu-export', host).click();
  q('mi-export', host).click();
  assert.equal(document.activeElement, dlg().querySelector('h2'), 'the focus starts in the dialog, on its title');
  await settle();
  const d = dlg();
  assert.equal(document.activeElement, q('again-update'), 'then on the default choice once the choices loaded');
  assert.equal(text(d.querySelector('h2')), 'Export FEAT-7 again');
  assert.equal(text(d.querySelector('#req-again-desc')), 'SHOP-123 was made on 26 Oct. The spec has changed since. What should happen?');
  const group = d.querySelector('[role="radiogroup"]');
  assert.equal(group.getAttribute('aria-label'), 'What should happen');
  assert.deepEqual([...group.querySelectorAll('.req-export-mode')].map((m) => [text(m.querySelector('b')), text(m.querySelector('.hint'))]), [
    ['Update SHOP-123', 'Rewrites its summary, description and fields.'],
    ['Add a comment to SHOP-123', 'Lists what changed since the last export. The description stays.'],
    ['Create a new ticket', 'For example when the feature was split.']]);
  assert.equal(q('again-update').checked, true);
  assert.equal(text(d.querySelector('#req-again-chg')), 'What changed since the last export (26 Oct)');
  assert.deepEqual([...d.querySelectorAll('.req-export-change')].map(text), ['Added R-po-6 An order with some items shipped can cancel only the items not yet picked up.',
    'Business rules: 1 line changed', 'Edge cases: 1 line added']);
  assert.equal(text(d.querySelector('.req-export-change code')), 'R-po-6');
  assert.ok([...d.querySelectorAll('.hint')].some((x) => text(x) === 'The preview shows the result before anything is sent.'));
  assert.deepEqual(calls.find((c) => c.url === PREVIEW_URL).body, { mode: 'update' }, 'the tracker is asked first (gone, edited)');
  q('again-continue').click();
  await settle();
  assert.deepEqual(calls.filter((c) => c.url === PREVIEW_URL).at(-1).body, { mode: 'update' });
  assert.equal(text(q('export-go')), 'Update SHOP-123');
  assert.equal(text(dlg().querySelector('.req-dlg-lead')), 'This is the ticket Worca will update in SHOP. Change the issue type, labels or priority for this export.');
});

test('again: with nothing changed it says so and Add a comment is disabled; Create a new ticket previews mode new', async () => {
  const { calls } = await openExport(feature({ export: XV({ link: LINK }) }), { [`POST ${PREVIEW_URL}`]: (b) => AGAIN({ mode: b.mode, changes: [] }) });
  const d = dlg();
  assert.equal(text(d.querySelector('#req-again-desc')), 'SHOP-123 was made on 26 Oct. The spec has not changed since the last export (26 Oct).');
  assert.equal(q('again-comment').disabled, true);
  assert.equal(d.querySelector('.req-export-changes').hidden, true);
  q('again-new').click();
  q('again-continue').click();
  await settle();
  assert.deepEqual(calls.filter((c) => c.url === PREVIEW_URL).at(-1).body, { mode: 'new' });
  assert.equal(text(q('export-go')), 'Create in Jira');
});

test('board 28: edited in Jira since the last export: the alert, Update anyway (a forced update) and Add a comment instead', async () => {
  const { calls } = await openExport(feature({ export: XV({ link: LINK }) }), { [`POST ${PREVIEW_URL}`]: (b) => AGAIN({ mode: b.mode, edited: true }),
    [`POST ${EXPORT_URL}`]: () => exportAnswer('updated', 'SHOP-123') });
  const alert = dlg().querySelector('[role="alert"]');
  assert.equal(text(alert), 'SHOP-123 was edited in Jira since your last export. Updating replaces its description.');
  assert.equal(text(alert.querySelector('b')), 'SHOP-123 was edited in Jira since your last export.');
  assert.equal(q('again-continue').hidden, true);
  assert.deepEqual(['export-update-anyway', 'export-comment-instead', 'export-edited-cancel'].map((u) => text(q(u))), ['Update anyway', 'Add a comment instead', 'Cancel']);
  q('again-comment').click();
  assert.deepEqual([q('again-continue').hidden, text(dlg().querySelector('[role="alert"]'))], [false, ''], 'another choice: no alert');
  q('again-update').click();
  q('export-update-anyway').click();
  await settle();
  assert.equal(text(q('export-go')), 'Update SHOP-123');
  q('export-go').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.url === EXPORT_URL).body, { mode: 'update', previewHash: 'h1', force: true });
});

test('board 28: Add a comment: the comment itself, Back to the choices, Add comment sends it with its hash', async () => {
  const COMMENT = 'Updated in Worca since the last export (26 Oct)\n\nAdded R-po-6 An order with some items shipped can cancel only the items not yet picked up.\n\n'
    + 'Business rules: “Packed but not picked up still counts as not shipped.” was “Packed orders count as shipped.”\n\nFrom Worca FEAT-7\n';
  const { host, calls } = await openExport(feature({ export: XV({ link: LINK }) }), { [`POST ${PREVIEW_URL}`]: (b) => (b.mode === 'comment'
    ? AGAIN({ mode: 'comment', ticket: null, fields: null, comment: COMMENT, previewHash: 'c1' }) : AGAIN({ mode: b.mode })),
    [`POST ${EXPORT_URL}`]: () => exportAnswer('commented', 'SHOP-123') });
  q('again-comment').click();
  q('again-continue').click();
  await settle();
  const d = dlg();
  assert.equal(text(d.querySelector('h2')), 'Comment on SHOP-123');
  assert.equal(document.activeElement, d.querySelector('h2'), 'the focus is in the dialog, on its title');
  assert.equal(text(d.querySelector('.req-dlg-lead')), 'This comment is added to SHOP-123. Its description and fields stay as they are.');
  const box = d.querySelector('[aria-label="Comment preview"]');
  assert.deepEqual([box.getAttribute('tabindex'), [...box.querySelectorAll('p')].map(text)], ['0', ['Updated in Worca since the last export (26 Oct)',
    'Added R-po-6 An order with some items shipped can cancel only the items not yet picked up.',
    'Business rules: “Packed but not picked up still counts as not shipped.” was “Packed orders count as shipped.”', 'From Worca FEAT-7']]);
  q('comment-back').click();
  await settle();
  assert.equal(text(dlg().querySelector('h2')), 'Export FEAT-7 again');
  q('again-comment').click();
  q('again-continue').click();
  await settle();
  q('comment-add').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.url === EXPORT_URL).body, { mode: 'comment', previewHash: 'c1' });
  assert.equal(text(host.querySelector('.req-export-done')), 'Commented on SHOP-123');
});

test('D17: the History card right under the header, newest first, as board 28 writes it; none without an export', async () => {
  const at = (action, when, extra = {}) => ({ action, tracker: 'Jira', key: 'SHOP-123', url: 'https://acme.test/browse/SHOP-123', reason: null, when,
    by: 'Tomica Brkovic', ...extra });
  const history = [at('forgot', '28 Oct, 08:00'), at('commented', '27 Oct, 09:15'), at('updated', '27 Oct, 09:00'), at('linked', '26 Oct, 11:00', { by: null }),
    at('new', '26 Oct, 10:50', { key: 'SHOP-124', url: 'https://acme.test/browse/SHOP-124' }), at('created', '26 Oct, 10:42', { reason: 'Estimating tomorrow.' })];
  const { host } = await openFeature(feature({ export: XV({ history }) }));
  const card = host.querySelector('.req-history');
  assert.equal(host.querySelector('.req-head').nextElementSibling, card);
  assert.equal(text(document.getElementById(card.getAttribute('aria-labelledby'))), 'History');
  assert.deepEqual([...card.querySelectorAll('li')].map((li) => [text(li.firstChild), text(li.querySelector('.hint'))]), [
    ['Forgot the link to SHOP-123 · 28 Oct, 08:00', 'Tomica Brkovic'],
    ['Commented on SHOP-123 in Jira · 27 Oct, 09:15', 'Tomica Brkovic'],
    ['Updated SHOP-123 in Jira · 27 Oct, 09:00', 'Tomica Brkovic'],
    ['Linked SHOP-123, which an earlier export made · 26 Oct, 11:00', null],
    ['Exported to Jira as SHOP-124 · 26 Oct, 10:50', 'Tomica Brkovic'],
    ['Exported to Jira as SHOP-123 · 26 Oct, 10:42 · before Ready: Estimating tomorrow.', 'Tomica Brkovic']]);
  const a = card.querySelector('li:last-child a');
  assert.deepEqual([text(a), a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')], ['SHOP-123', 'https://acme.test/browse/SHOP-123', '_blank', 'noopener']);
  assert.equal((await openFeature(feature())).host.querySelector('.req-history'), null);
});

// ── Task 9: the server's answers (Task 5's review fixes) and the dialogs' rules ──
const STALE_MSG = 'The spec changed since the preview. Look at the preview again.';

test('a stale preview: the sentence, then a fresh preview (its hash) on screen; Create in Jira sends that one', async () => {
  let n = 0;
  let first = true;
  const { calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => { n += 1; return preview({ previewHash: `h${n}` }); },
    [`POST ${EXPORT_URL}`]: () => {
      if (!first) return exportAnswer('created', 'SHOP-123');
      first = false;
      return { __status: 409, body: { error: STALE_MSG, stale: true } };
    } });
  const alert = dlg().querySelector('[role="alert"]');
  q('export-go').click();
  await settle();
  assert.equal(dlg().querySelector('[role="alert"]'), alert, 'the same live node');
  assert.equal(text(alert), STALE_MSG);
  assert.equal(calls.filter((c) => c.url === PREVIEW_URL).length, 2, 'a fresh preview');
  assert.deepEqual([text(q('export-go')), q('export-go').disabled, q('export-cancel').disabled], ['Create in Jira', false, false]);
  q('export-go').click();
  await settle();
  assert.deepEqual(calls.filter((c) => c.url === EXPORT_URL).map((c) => c.body.previewHash), ['h1', 'h2']);
  assert.equal(dlg(), null);
});

test('a ticket an earlier export made was found and linked (nothing sent): the page reloads, Export again opens for it, no create preview', async () => {
  let f = feature();
  const routes = { [`GET ${F}`]: () => ({ feature: f, turns: [] }),
    [`POST ${PREVIEW_URL}`]: (b) => (b.mode === 'create' ? preview() : AGAIN({ mode: b.mode })),
    [`POST ${EXPORT_URL}`]: () => {
      f = feature({ export: XV({ link: LINK }) });
      return { __status: 409, body: { error: STALE_MSG, stale: true, linked: 'SHOP-123' } };
    } };
  const { host, calls, nav } = await openExport(feature(), routes);
  q('export-go').click();
  await settle();
  const d = dlg();
  assert.equal(text(d.querySelector('h2')), 'Export FEAT-7 again');
  assert.equal(text(d.querySelector('[role="alert"]')), 'Linked SHOP-123, which an earlier export made. Nothing was sent.', 'the dedicated line, as History says it');
  assert.deepEqual(calls.filter((c) => c.url === PREVIEW_URL).map((c) => c.body.mode), ['create', 'update'], 'never the create again');
  assert.equal(calls.filter((c) => c.url === EXPORT_URL).length, 1);
  assert.equal(text(q('export-chip', host)), 'SHOP-123', 'the page shows the linked ticket');
  assert.equal(nav.getAttribute('inert'), '', 'still a modal');
  q('again-cancel').click();
  assert.deepEqual([dlg(), nav.getAttribute('inert'), document.activeElement], [null, null, q('menu-export', host)]);
});

test('a comment on a ticket Worca has no starting point for: the sentence, Add comment gone, Back to the choices works', async () => {
  const START = 'Update SHOP-123 once to give Worca a starting point for comments.';
  await openExport(feature({ export: XV({ link: LINK }) }), { [`POST ${PREVIEW_URL}`]: (b) => (b.mode === 'comment'
    ? { __status: 409, body: { error: START } } : AGAIN({ mode: b.mode })) });
  q('again-comment').click();
  q('again-continue').click();
  await settle();
  assert.equal(text(dlg().querySelector('[role="alert"]')), START);
  assert.equal(q('comment-add').hidden, true, 'trying again gives the same answer');
  assert.equal(q('comment-back').disabled, false);
  q('comment-back').click();
  await settle();
  assert.equal(text(dlg().querySelector('h2')), 'Export FEAT-7 again');
  assert.deepEqual(['again-update', 'again-comment', 'again-new'].map((u) => q(u).disabled), [false, false, false]);
  assert.equal(q('again-continue').disabled, false);
});

test('busy, a tracker that cannot be reached, the edited race on send: the sentence; the preview stays and can send again', async () => {
  const STILL = 'Worca is still checking whether Jira made the ticket. Try again in a moment.';
  const REACH = 'Worca could not reach Jira: it did not answer within a minute.';
  const EDITED = 'SHOP-123 was edited in Jira since your last export. Updating replaces its description.';
  const answers = [{ __status: 409, body: { error: STILL } }, { __status: 502, body: { error: REACH, kind: 'timeout' } },
    { __status: 409, body: { error: EDITED, edited: true } }, exportAnswer('updated', 'SHOP-123')];
  const { calls } = await openExport(feature({ export: XV({ link: LINK }) }), { [`POST ${PREVIEW_URL}`]: (b) => AGAIN({ mode: b.mode }),
    [`POST ${EXPORT_URL}`]: () => answers.shift() });
  q('again-continue').click();
  await settle();
  const alert = () => text(dlg().querySelector('[role="alert"]'));
  q('export-go').click();
  await settle();
  assert.deepEqual([alert(), q('export-go').disabled, q('export-cancel').disabled], [STILL, false, false]);
  q('export-go').click();
  await settle();
  assert.equal(alert(), REACH);
  q('export-go').click();
  await settle();
  assert.equal(alert(), EDITED);
  assert.deepEqual([q('export-go').hidden, text(q('export-update-anyway'))], [true, 'Update anyway']);
  q('export-update-anyway').click();
  await settle();
  assert.deepEqual(calls.filter((c) => c.url === EXPORT_URL).map((c) => c.body.force || false), [false, false, false, true]);
  assert.equal(dlg(), null);
});

test('no double post: Create in Jira pressed again while it sends posts once', async () => {
  const slow = held(() => exportAnswer('created', 'SHOP-123'));
  const { calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview(), [`POST ${EXPORT_URL}`]: slow.route });
  q('export-go').click();
  q('export-go').click();
  q('export-go').dispatchEvent(new window.Event('click'));
  q('export-cancel').click();
  assert.ok(dlg(), 'Cancel waits while exporting');
  slow.release();
  await settle();
  assert.equal(calls.filter((c) => c.url === EXPORT_URL).length, 1);
});

test('a preview answer that comes after Cancel is dropped; the page is released and the focus is back on Export', async () => {
  const slow = held(() => preview());
  const { host, nav } = await openFeature(feature(), { ...SETUP_ROUTES(), [`POST ${PREVIEW_URL}`]: slow.route });
  q('menu-export', host).click();
  q('mi-export', host).click();
  assert.equal(document.activeElement, dlg().querySelector('h2'));
  q('export-cancel').click();
  assert.deepEqual([dlg(), nav.getAttribute('inert'), host.getAttribute('inert'), document.activeElement], [null, null, null, q('menu-export', host)]);
  slow.release();
  await settle();
  assert.deepEqual([dlg(), document.activeElement], [null, q('menu-export', host)]);
});

test('Not Ready: Escape closes it (not while composing), the page is released, the focus back on Export', async () => {
  const { host, nav } = await openExport(feature({ readiness: readiness(['interview']), state: 'decide' }), {});
  assert.equal(text(dlg().querySelector('.req-dlg-lead')), 'One check does not pass yet:');
  assert.equal(text(dlg().querySelector('.req-dlg-fail li')), 'Interview finished: not yet');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
  assert.ok(dlg());
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.deepEqual([dlg(), nav.getAttribute('inert'), document.activeElement], [null, null, q('menu-export', host)]);
});

test('preview: a label being typed keeps its text, caret and field while the choices and a fresh preview land; the selects stay in place', async () => {
  const opts = held((b) => optionsAnswer(b));
  const routes = { ...SETUP_ROUTES(), [`POST ${SETUP_URL}/options`]: opts.route, [`POST ${PREVIEW_URL}`]: () => preview() };
  const m = await openFeature(feature(), routes);
  q('menu-export', m.host).click();
  q('mi-export', m.host).click();
  await settle();
  const input = q('export-lab-in');
  const type = q('export-type');
  input.focus();
  input.value = 'needs';
  input.setSelectionRange(2, 2);
  input.dispatchEvent(new window.Event('input'));
  opts.release();
  await settle();
  assert.deepEqual(optionTexts(q('export-type')), ['Story', 'Task', 'Bug'], 'the choices landed');
  assert.deepEqual([q('export-lab-in') === input, input.value, document.activeElement === input, input.selectionStart, q('export-type') === type],
    [true, 'needs', true, 2, true]);
  const prio = q('export-prio');
  const kept = [...prio.options];
  pick(prio, '2');
  await settle();
  assert.deepEqual([q('export-prio') === prio, [...prio.options].every((o, i) => o === kept[i]), input.value], [true, true, 'needs']);
});

test('live regions: the status and alert lines of the preview stay the same nodes; "Created SHOP-123" survives a repaint without being redrawn', async () => {
  let f = feature();
  const { host, view } = await openExport(f, { [`GET ${F}`]: () => ({ feature: f, turns: [] }), [`POST ${PREVIEW_URL}`]: () => preview(),
    [`POST ${EXPORT_URL}`]: () => { const r = exportAnswer('created', 'SHOP-123'); f = r.feature; return r; } });
  q('export-go').click();
  await settle();
  const done = host.querySelector('.req-export-done');
  const kids = [...done.childNodes];
  await view.changed(7);
  await settle();
  assert.equal(host.querySelector('.req-export-done'), done, 'the same node after a repaint');
  assert.deepEqual([[...done.childNodes].every((k, i) => k === kids[i]), text(done)], [true, 'Created SHOP-123']);
  assert.equal(done.getAttribute('role'), 'status');
});

test('CSS: the Task 9 rules sit in the Requirements block (tokens only) and the picked choice is an ink border, not a fill', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  for (const sel of ['.req-export-grid', '.req-export-desc', '.req-export-mode', '.req-export-changes', 'a.chip.req-export-chip', '.req-export-done', '.req-history-list']) {
    const at = css.indexOf(sel);
    assert.ok(at > start && at < end, `${sel} inside the Requirements block`);
  }
  const rule = (sel) => { const at = css.indexOf(`${sel}{`); return at < 0 ? '' : css.slice(at, css.indexOf('}', at)); };
  assert.match(rule('.req-export-mode:has(input:checked)'), /border-color:var\(--ink\)/);
  assert.doesNotMatch(rule('.req-export-mode:has(input:checked)'), /background/);
});

// ── Task 9 fix round 1 ──
const NOT_READY_MSG = 'This feature is not Ready. Give a reason to export it anyway.';

test('board 28: the edited alert sits under the choices, what changed and the note, so picking a choice moves no card', async () => {
  await openExport(feature({ export: XV({ link: LINK }) }), { [`POST ${PREVIEW_URL}`]: (b) => AGAIN({ mode: b.mode, edited: true }) });
  const d = dlg();
  const alert = d.querySelector('[role="alert"]');
  const note = [...d.querySelectorAll('.hint')].find((x) => text(x) === 'The preview shows the result before anything is sent.');
  const before = (a, b) => !!(a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.deepEqual([before(d.querySelector('[role="radiogroup"]'), alert), before(d.querySelector('.req-export-changes'), alert), before(note, alert)],
    [true, true, true]);
  assert.ok(before(alert, q('again-continue')), 'and above the buttons');
});

test('NOT_READY while the preview is open (the feature stopped being Ready): the Not Ready dialog, then the preview of the same mode with the reason', async () => {
  const { calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: (b) => (b.reason ? preview()
    : { __status: 409, body: { error: NOT_READY_MSG, failing: ['interview'] } }) });
  const d = dlg();
  assert.equal(text(d.querySelector('h2')), 'Export FEAT-7 before it’s Ready?');
  assert.equal(text(d.querySelector('.req-dlg-lead')), 'One check does not pass yet:');
  assert.equal(document.activeElement, q('export-reason'));
  typeReason('Estimating tomorrow.');
  q('export-anyway').click();
  await settle();
  assert.deepEqual(calls.filter((c) => c.url === PREVIEW_URL).map((c) => c.body), [{ mode: 'create' }, { mode: 'create', reason: 'Estimating tomorrow.' }]);
  assert.equal(text(q('export-go')), 'Create in Jira');
});

test('NOT_READY for Export again: the Not Ready dialog, then Export again with the reason', async () => {
  const { calls } = await openExport(feature({ export: XV({ link: LINK }) }), { [`POST ${PREVIEW_URL}`]: (b) => (b.reason ? AGAIN({ mode: b.mode })
    : { __status: 409, body: { error: NOT_READY_MSG, failing: ['interview'] } }) });
  assert.equal(text(dlg().querySelector('h2')), 'Export FEAT-7 before it’s Ready?');
  typeReason('Estimating tomorrow.');
  q('export-anyway').click();
  await settle();
  assert.equal(text(dlg().querySelector('h2')), 'Export FEAT-7 again');
  q('again-continue').click();
  await settle();
  assert.deepEqual(calls.filter((c) => c.url === PREVIEW_URL).map((c) => c.body),
    [{ mode: 'update' }, { mode: 'update', reason: 'Estimating tomorrow.' }, { mode: 'update', reason: 'Estimating tomorrow.' }]);
});

test('Export again: a first preview that fails says why with Try again; Continue waits until the choices load', async () => {
  const REACH = 'Worca could not reach Jira: the API token was refused.';
  let fail = true;
  const { calls } = await openExport(feature({ export: XV({ link: LINK }) }), { [`POST ${PREVIEW_URL}`]: (b) => (fail
    ? { __status: 502, body: { error: REACH, kind: 'auth' } } : AGAIN({ mode: b.mode })) });
  const d = dlg();
  assert.equal(text(d.querySelector('[role="alert"]')), REACH);
  assert.deepEqual([text(q('again-retry')), q('again-continue').disabled, d.querySelector('[role="radiogroup"]').hidden], ['Try again', true, true]);
  fail = false;
  q('again-retry').focus();
  q('again-retry').click();
  await settle();
  assert.equal(calls.filter((c) => c.url === PREVIEW_URL).length, 2);
  assert.deepEqual([text(d.querySelector('[role="alert"]')), q('again-retry'), q('again-continue').disabled], ['', null, false]);
  assert.equal(document.activeElement, q('again-update'), 'the focus, left on the gone Try again, goes to the default choice');
});

test('a11y: the description and comment previews are named regions', async () => {
  const COMMENT = 'Updated in Worca since the last export (26 Oct)\n\nFrom Worca FEAT-7\n';
  await openExport(feature({ export: XV({ link: LINK }) }), { [`POST ${PREVIEW_URL}`]: (b) => (b.mode === 'comment'
    ? AGAIN({ mode: 'comment', ticket: null, fields: null, comment: COMMENT, previewHash: 'c1' }) : AGAIN({ mode: b.mode })) });
  q('again-continue').click();
  await settle();
  const desc = dlg().querySelector('.req-export-desc');
  assert.deepEqual([desc.getAttribute('role'), desc.getAttribute('aria-label')], ['region', 'Description preview']);
  q('export-cancel').click();
  q('menu-export').click();
  q('mi-export').click();
  await settle();
  q('again-comment').click();
  q('again-continue').click();
  await settle();
  const box = dlg().querySelector('.req-export-comment');
  assert.deepEqual([box.getAttribute('role'), box.getAttribute('aria-label')], ['region', 'Comment preview']);
});

test('CSS (boards 28, 29): the edited alert borders with --amber-line; the chip reads as a link; "Created SHOP-123" is green ink, never a fill', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const rule = (sel) => { const at = css.indexOf(`${sel}{`); return at < 0 ? '' : css.slice(at, css.indexOf('}', at)); };
  assert.match(rule('.req-export-alert.is-warn'), /border:1px solid var\(--amber-line\)/);
  assert.match(rule('a.chip.req-export-chip'), /color:var\(--blue-ink-strong\)/);
  assert.match(rule('.req-export-done'), /color:var\(--green-ink-strong\)/);
  assert.doesNotMatch(rule('.req-export-done'), /background/);
});

// ── Task 10 (part A): board 29's states, Report back ──
test('board 29 (1): Worca cannot reach Jira: the sentence (role=alert), "Nothing was recorded…", Try again sends again; the preview stays', async () => {
  let fail = true;
  const { calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview(),
    [`POST ${EXPORT_URL}`]: () => (fail ? { __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' } }
      : exportAnswer('created', 'SHOP-123')) });
  q('export-go').click();
  await settle();
  const d = dlg();
  assert.ok(d, 'the preview stays open');
  assert.equal(text(d.querySelector('[role="alert"]')), 'Worca could not reach Jira: the API token was refused.');
  assert.equal(text(d.querySelector('.req-export-alert-hint')),
    'Nothing was recorded. The preview stays open, so you can try again once the connection is fixed on the Marketplace page (Installed › Jira).');
  assert.deepEqual([text(q('export-go')), q('export-go').disabled, q('export-cancel').disabled], ['Try again', false, false]);
  fail = false;
  q('export-go').click();
  await settle();
  assert.equal(calls.filter((c) => c.url === EXPORT_URL).length, 2);
  assert.equal(dlg(), null);
});

test('board 29 (2): Jira refuses a field: its sentence and Change the export setup, which comes back to the preview after Save', async () => {
  const { calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview(),
    [`POST ${EXPORT_URL}`]: () => ({ __status: 409, body: { error: 'Jira needs a value for “Team” in SHOP.', refused: true, field: 'Team' } }),
    [`GET ${SETUP_URL}`]: { setup: { ...CONN, trackerProject: 'SHOP', issueType: '10001', priority: null, labels: ['worca'], criteria: { target: 'description' } },
      trackers: TRACKERS, defaultProfile: CONN } });
  q('export-go').focus();
  q('export-go').click();
  await settle();
  assert.equal(text(dlg().querySelector('[role="alert"]')), 'Jira needs a value for “Team” in SHOP.');
  assert.equal(document.activeElement, q('export-change-setup'), 'the focus, on the hidden Create in Jira, moves to the state button');
  q('export-change-setup').click();
  await settle();
  assert.deepEqual([text(dlg().querySelector('h2')), text(q('setup-save'))], ['Set up export for shop', 'Save and continue']);
  q('setup-save').click();
  await settle();
  assert.equal(text(dlg().querySelector('h2')), 'Export FEAT-7 to Jira');
  assert.equal(calls.filter((c) => c.url === PREVIEW_URL).length, 2, 'a fresh preview');
});

test('board 29 (3): the ticket is gone: the again dialog says so first; Forget the link drops the chip; New ticket previews mode new', async () => {
  const forgot = { feature: feature({ export: XV({ history: [{ action: 'forgot', tracker: 'Jira', key: 'SHOP-123', url: LINK.url, reason: null,
    when: '26 Oct, 11:00', by: 'Tomica Brkovic' }] }) }), turns: [] };
  const gone = { [`POST ${PREVIEW_URL}`]: (b) => AGAIN({ mode: b.mode, gone: b.mode === 'update' || b.mode === 'comment' }),
    [`DELETE ${EXPORT_URL}/link`]: () => forgot };
  let m = await openExport(feature({ export: XV({ link: LINK }) }), gone);
  const d = dlg();
  assert.equal(document.activeElement, d.querySelector('h2'), 'the focus stays in the dialog, on its title (no choices to focus)');
  assert.equal(text(d.querySelector('[role="alert"]')), 'SHOP-123 no longer exists in Jira.');
  assert.equal(text(d.querySelector('.req-export-alert-hint')),
    'It was deleted or moved where this connection cannot see it. Forget the link removes the SHOP-123 chip; the history keeps the export.');
  assert.deepEqual([d.querySelector('[role="radiogroup"]').hidden, q('again-continue').hidden], [true, true]);
  q('export-forget').click();
  q('export-forget').click();
  await settle();
  assert.equal(dlg(), null);
  assert.equal(q('export-chip', m.host), null);
  assert.equal(document.activeElement, q('menu-export', m.host));
  assert.equal(m.calls.filter((c) => c.method === 'DELETE' && c.url === `${EXPORT_URL}/link`).length, 1, 'one DELETE, however often it is pressed');
  m = await openExport(feature({ export: XV({ link: LINK }) }), gone);
  q('export-new').click();
  await settle();
  assert.deepEqual(m.calls.filter((c) => c.url === PREVIEW_URL).at(-1).body, { mode: 'new' });
  assert.equal(text(q('export-go')), 'Create in Jira');
});

test('board 29 (3): a ticket gone on send: the sentence, Forget the link and New ticket; Create in Jira is gone', async () => {
  await openExport(feature({ export: XV({ link: LINK }) }), { [`POST ${PREVIEW_URL}`]: (b) => AGAIN({ mode: b.mode }),
    [`POST ${EXPORT_URL}`]: () => ({ __status: 409, body: { error: 'SHOP-123 no longer exists in Jira.', gone: true } }) });
  q('again-continue').click();
  await settle();
  q('export-go').focus();
  q('export-go').click();
  await settle();
  assert.equal(text(dlg().querySelector('[role="alert"]')), 'SHOP-123 no longer exists in Jira.');
  assert.deepEqual([q('export-go').hidden, text(q('export-forget')), text(q('export-new'))], [true, 'Forget the link', 'New ticket']);
  assert.equal(document.activeElement, q('export-forget'));
});

test('the spec changed since the preview: the sentence stays and a fresh preview comes', async () => {
  let n = 0;
  const { calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => { n += 1; return preview({ previewHash: `h${n}` }); },
    [`POST ${EXPORT_URL}`]: () => ({ __status: 409, body: { error: 'The spec changed since the preview. Look at the preview again.', stale: true } }) });
  q('export-go').click();
  await settle();
  assert.equal(text(dlg().querySelector('[role="alert"]')), 'The spec changed since the preview. Look at the preview again.');
  assert.equal(calls.filter((c) => c.url === PREVIEW_URL).length, 2);
  assert.equal(q('export-go').disabled, false);
});

test('D15, board 29 (6): Report back to SHOP-123 on the Ready to build card, on by default; the hint names the status or says it only comments', async () => {
  let m = await openFeature(feature({ export: XV({ link: LINK, doneStatus: 'Done' }) }),
    { [`POST ${F}/start`]: () => ({ runId: 'r1', version: 1, feature: feature(), turns: [] }) });
  const sw = q('report-card', m.host);
  assert.deepEqual([sw.getAttribute('role'), sw.type, sw.checked, text(sw.closest('label'))], ['switch', 'checkbox', true, 'Report back to SHOP-123']);
  assert.ok(sw.nextElementSibling.classList.contains('switch'), "upstream's switch (ink when on)");
  assert.equal(text(document.getElementById(sw.getAttribute('aria-describedby'))), 'When the run ends, Worca comments with the result and the pull request link, '
    + 'and moves the ticket to Done (the status named in the Jira connection; without one, it only comments).');
  sw.checked = false;
  sw.dispatchEvent(new window.Event('change'));
  q('start-go', m.host).click();
  await settle();
  assert.equal(m.calls.find((c) => c.url === `${F}/start`).body.reportBack, false);
  m = await openFeature(feature({ export: XV({ link: LINK }) }));
  assert.equal(text(document.getElementById(q('report-card', m.host).getAttribute('aria-describedby'))),
    'When the run ends, Worca comments with the result and the pull request link. The Jira connection names no status to move the ticket to, so it only comments.');
  m = await openFeature(feature());
  assert.equal(q('report-card', m.host), null, 'no ticket, no row');
});

test('D15: the start-before-Ready dialog and the runs card carry the same switch; the start sends reportBack', async () => {
  const f = feature({ readiness: readiness(['openQuestions']), state: 'decide', export: XV({ link: LINK }) });
  const { host, calls } = await openFeature(f, { [`POST ${F}/start`]: () => ({ runId: 'r1', version: 1, feature: f, turns: [] }) });
  q('start-anyway', host).click();
  await settle();
  const sw = q('report-dialog');
  assert.deepEqual([sw.checked, text(sw.closest('label'))], [true, 'Report back to SHOP-123']);
  const area = document.getElementById('req-dlg-reason');
  area.value = 'Now.';
  area.dispatchEvent(new window.Event('input'));
  [...dlg().querySelectorAll('.btn-primary')].at(-1).click();
  await settle();
  assert.equal(calls.find((c) => c.url === `${F}/start`).body.reportBack, true);
  const started = await openFeature(feature({ state: 'started', export: XV({ link: LINK }), changedSinceStart: [{ kind: 'goal', field: 'text', before: 'a', after: 'b' }],
    starts: [{ version: 1, runId: 'r1', run: { status: 'running', phase: 'build', costUsd: 0.1, href: '#running/r1' }, failing: [], files: [] }] }));
  assert.ok(q('report-runs', started.host), 'the runs card has it too');
});

test('D15: without a ticket the start sends no reportBack', async () => {
  const { host, calls } = await openFeature(feature(), { [`POST ${F}/start`]: () => ({ runId: 'r1', version: 1, feature: feature(), turns: [] }) });
  q('start-go', host).click();
  await settle();
  assert.equal('reportBack' in calls.find((c) => c.url === `${F}/start`).body, false);
});

test('CSS (board 29 (6)): the Report back rows sit in the Requirements block, tokens only', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  const at = css.indexOf('.req-report{');
  assert.ok(at > 0 && at < end);
  assert.match(css, /\.req-report \.req-report-hint\{[^}]*font-size:var\(--fs-meta\)/);
});

test('Export again: a Try again that fails again keeps the focus on Try again; one that answers gone puts it on the title', async () => {
  const REACH = 'Worca could not reach Jira: the API token was refused.';
  const answers = [{ __status: 502, body: { error: REACH, kind: 'auth' } }, { __status: 502, body: { error: REACH, kind: 'auth' } }, AGAIN({ gone: true })];
  await openExport(feature({ export: XV({ link: LINK }) }), { [`POST ${PREVIEW_URL}`]: () => answers.shift() });
  const retry = q('again-retry');
  retry.focus();
  retry.click();
  await settle();
  assert.deepEqual([text(dlg().querySelector('[role="alert"]')), q('again-retry'), document.activeElement], [REACH, retry, retry]);
  retry.click();
  await settle();
  assert.equal(text(dlg().querySelector('[role="alert"]')), 'SHOP-123 no longer exists in Jira.');
  assert.equal(document.activeElement, dlg().querySelector('h2'));
});

test('NOT_READY mid-dialog: the Not Ready dialog lists the feature as it is now (fetched again), not as the dialog opened it', async () => {
  let n = 0;
  const now = feature({ readiness: readiness(['interview']), state: 'decide' });
  const calls = fakeApi({ ...BASE, ...SETUP_ROUTES(), [`GET ${F}`]: () => { n += 1; return { feature: n === 1 ? feature() : now, turns: [] }; },
    [`POST ${PREVIEW_URL}`]: (b) => (b.reason ? preview() : { __status: 409, body: { error: NOT_READY_MSG, failing: ['interview'] } }) });
  const m = make();
  await m.view.show('feature/7');
  await settle();
  q('menu-export', m.host).click();
  q('mi-export', m.host).click();
  await settle();
  assert.equal(text(dlg().querySelector('h2')), 'Export FEAT-7 before it’s Ready?');
  assert.equal(text(dlg().querySelector('.req-dlg-fail li')), 'Interview finished: not yet');
  assert.ok(calls.filter((c) => c.method === 'GET' && c.url === F).length >= 2, 'the feature was fetched again');
});

// ── Task 10, part B: board 31's phone sheet, leaving the view (D20) ──

/** A phone: window.matchMedia answers (max-width:900px) with `phone.on`; `phone.set` fires a resize across 900 px. Install it
 *  before the view is made (it listens from then on). */
function withPhone(on = true) {
  const phone = { on, listeners: new Set() };
  const before = window.matchMedia;
  window.matchMedia = (mq) => ({ media: mq, get matches() { return /max-width:900px/.test(mq) && phone.on; },
    addEventListener: (_t, fn) => phone.listeners.add(fn), removeEventListener: (_t, fn) => phone.listeners.delete(fn) });
  phone.restore = () => { window.matchMedia = before; };
  phone.set = (v) => { phone.on = v; phone.listeners.forEach((fn) => fn()); };
  return phone;
}
const inertIn = () => [...document.querySelectorAll('[inert]')];
const tab = (shiftKey = false) => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));

test('D20: an export dialog makes every other child of <body> inert; Back closes it and releases; leave() closes it and releases', async () => {
  const { host, nav, view } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview() });
  const d = dlg();
  assert.deepEqual([d.getAttribute('role'), d.getAttribute('aria-modal'), d.closest('.req-dlg-wrap').classList.contains('req-dlg-sheet')], ['dialog', 'true', true]);
  assert.deepEqual([nav.getAttribute('inert'), host.getAttribute('inert')], ['', '']);
  const back = q('export-back');
  assert.deepEqual([back.getAttribute('aria-label'), text(back)], ['Back to FEAT-7', '← FEAT-7']);
  back.click();
  assert.equal(dlg(), null);
  assert.deepEqual([nav.getAttribute('inert'), host.getAttribute('inert')], [null, null]);
  assert.equal(document.activeElement, q('menu-export', host), 'Back hands the focus to Export');
  q('menu-export', host).click();
  q('mi-export', host).click();
  await settle();
  assert.ok(dlg());
  assert.equal(typeof view.leave, 'function');
  view.leave();
  assert.equal(dlg(), null, 'leaving the Requirements view closes the sheet');
  assert.deepEqual(inertIn(), [], 'nothing is left inert');
});

test('board 31: every export dialog of a feature leads with ← FEAT-7 (Connect a tracker belongs to no feature)', async () => {
  const m = await openFeature(feature(), SETUP_ROUTES());
  q('menu-export', m.host).click();
  q('mi-export-setup', m.host).click();
  await settle();
  assert.equal(dlg().firstElementChild, q('export-back'), 'Setup');
  q('export-back').click();
  await openExport(feature({ readiness: readiness(['interview']), state: 'decide' }), {});
  assert.equal(dlg().firstElementChild, q('export-back'), 'Not Ready');
});

test('board 31: Show all unfolds the description and names what it controls', async () => {
  await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview() });
  const more = q('export-more');
  const desc = document.getElementById(more.getAttribute('aria-controls'));
  assert.deepEqual([text(more), more.getAttribute('aria-expanded'), desc.classList.contains('folded')], ['Show all', 'false', true]);
  more.click();
  assert.deepEqual([more.getAttribute('aria-expanded'), more.hidden, desc.classList.contains('folded'), document.activeElement], ['true', true, false, desc]);
});

test('D20 (phone): Tab and Shift+Tab stay inside the sheet, from its last control back to ← FEAT-7 and round', async () => {
  await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview() });
  const back = q('export-back');
  const go = q('export-go');
  go.focus();
  tab();
  assert.equal(document.activeElement, back, 'Tab from the last control wraps to ← FEAT-7');
  tab(true);
  assert.equal(document.activeElement, go, 'Shift+Tab from ← FEAT-7 wraps to the last control');
  document.body.focus();
  tab();
  assert.ok(dlg().contains(document.activeElement), 'a Tab from outside lands inside the sheet');
});

test('D20 (phone): the page is inert only while the dialog is a sheet; widening past 900 px frees it, narrowing makes it modal again', async () => {
  const phone = withPhone(false);
  try {
    const { host, nav } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview() });
    assert.ok(dlg());
    assert.deepEqual([nav.getAttribute('inert'), host.getAttribute('inert')], [null, ''], 'beside the page: the view is inert, the app is not');
    phone.set(true);
    assert.equal(nav.getAttribute('inert'), '', 'narrowed to a phone: a sheet, every other child of <body> is inert');
    assert.equal(dlg().closest('[inert]'), null, 'the sheet itself is live');
    phone.set(false);
    assert.deepEqual([nav.getAttribute('inert'), host.getAttribute('inert')], [null, ''], 'widened again: released');
    phone.set(true);
    q('export-cancel').click();
    assert.deepEqual(inertIn(), [], 'closed: nothing is inert');
    phone.set(false); phone.set(true);
    assert.deepEqual(inertIn(), [], 'a resize with no dialog open re-applies nothing');
  } finally { phone.restore(); }
});

test('D20 (phone): leaving the view with a sheet open leaves nothing inert; a resize while away re-applies nothing; coming back has no sheet', async () => {
  const phone = withPhone(true);
  try {
    const m = await openFeature(feature(), { ...SETUP_ROUTES(), [`POST ${PREVIEW_URL}`]: () => preview() });
    const section = document.createElement('section'); section.className = 'view';
    const other = document.createElement('section'); other.className = 'view hidden';   // another view of the app
    document.body.prepend(section, other);
    section.append(m.host);
    q('menu-export', m.host).click();
    q('mi-export', m.host).click();
    await settle();
    assert.ok(dlg() && other.inert && m.nav.inert, 'the sheet is open: the rest of the app is inert');
    section.classList.add('hidden'); other.classList.remove('hidden');   // the app shows another view ...
    m.view.leave();                                                       // ... and tells this one
    assert.equal(dlg(), null, 'the sheet is closed');
    assert.deepEqual(inertIn(), [], 'leaving releases the page');
    phone.set(false); phone.set(true);
    assert.deepEqual(inertIn(), [], 'a resize while away re-applies nothing');
    section.classList.remove('hidden'); other.classList.add('hidden');
    await m.view.show('feature/7');
    await settle();
    assert.deepEqual([dlg(), inertIn()], [null, []], 'back on the page: no sheet, nothing inert');
  } finally { phone.restore(); }
});

test('D20 (phone): a change of feature, or the list, closes the sheet and frees the page', async () => {
  const phone = withPhone(true);
  try {
    const m = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview(), 'GET /api/requirements': { features: [] } });
    assert.equal(m.nav.getAttribute('inert'), '');
    await m.view.show('');
    await settle();
    assert.deepEqual([dlg(), inertIn()], [null, []]);
  } finally { phone.restore(); }
});

test('CSS (board 31): at 900 px and narrower an export dialog is a sheet of the viewport size; its body scrolls, its buttons stay at the bottom; 44 px hit areas; Back only there', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  const at = css.indexOf('.req-dlg-wrap.req-dlg-sheet .card.req-dialog.req-export{');
  assert.ok(at > start && at < end, 'the sheet rule is in the Requirements block');
  const media = css.lastIndexOf('@media (max-width:900px){', at);
  const close = css.indexOf('\n}', media);
  assert.ok(media > start && at < close, 'the sheet rule is inside the 900 px query');
  const phone = css.slice(media, close);
  const rule = css.slice(at, css.indexOf('}', at));
  // 390×844: fixed to the viewport (inset:0), never the content's size; no cap, no rounded box; it scrolls inside
  for (const decl of ['position:fixed', 'inset:0', 'width:auto', 'height:auto', 'max-width:none', 'max-height:none', 'overflow-y:auto', 'border-radius:0']) {
    assert.ok(rule.includes(decl), decl);
  }
  assert.match(phone, /\.viewer-modal\.req-dlg-wrap\.req-dlg-sheet\{padding:0;place-items:stretch\}/);
  // the button row (or the preview's footer) stays at the bottom of the sheet while the body scrolls
  assert.match(phone, /\.req-dlg-sheet \.req-export > \.req-dlg-btns,\s*\.req-dlg-sheet \.req-export > \.req-export-foot\{[^}]*position:sticky;bottom:0;[^}]*margin-top:auto[^}]*background:var\(--panel\)/);
  // full-width buttons; 44 px hit areas as ::after (never min-height:44px)
  assert.match(phone, /\.req-export \.req-dlg-btns \.btn,\.req-export \.req-export-alert-btns \.btn\{width:100%;position:relative\}/);
  assert.match(phone, /\.req-export \.req-dlg-btns \.btn::after,[^{]*\{content:"";position:absolute;inset:-6px 0\}/);
  assert.match(phone, /\.req-export \.req-export-alert-btns \.btn-sm::after\{inset:-8px 0\}/);
  assert.match(phone, /\.req-export-x::after\{content:"";position:absolute;inset:-14px\}/);
  assert.match(phone, /a\.chip\.req-export-chip::after\{content:"";position:absolute;inset:-8px 0\}/);
  assert.match(phone, /\.req-export-back::after\{content:"";position:absolute;inset:-14px -8px\}/);
  assert.match(phone, /\.req-export-desc\.folded\{max-height:180px;overflow:hidden\}/);
  // ← FEAT-7 only on the phone; board 31's title at 900 px and narrower (user decision 2026-10-26)
  const hide = css.indexOf('.req-export-back{display:none}');
  assert.ok(hide > start && hide < media, '← FEAT-7 is hidden above 900 px');
  assert.match(phone, /\.req-export-back\{display:inline-flex;/);
  assert.match(css, /\.req-export-sub\{display:none[;}]/);
  assert.match(css, /@media \(max-width:900px\)\{\s*\.req-export-title \.req-export-tid\{display:none\}\s*\.req-export-sub\{display:block\}/);
  assert.ok(!/min-height:44px/.test(phone), 'no 44 px min-height in the sheet');
});
