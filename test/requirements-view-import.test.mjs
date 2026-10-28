// test/requirements-view-import.test.mjs — New feature › From a ticket… in jsdom with a fake API (plans/requirements-a61-design.md §7,
// D1, D3–D9, D12, D19; boards 32–34, 36). No server, no tracker. People are made-up names.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#requirements/new' });
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
    return { ok: status < 400, status, json: async () => out ?? { error: 'not found' }, text: async () => '' };
  };
  return calls;
}
const BASE = { 'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop' }] }, 'GET /api/workspaces': { workspaces: [] },
  'GET /api/requirements': { features: [], interview: null, lookCostUsd: null, briefs: [], readEstimates: {} } };
const IMP = '/api/requirements/import/project/shop-1';
const CONN = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const ACME = { id: 'acme', label: 'acme.atlassian.net (Cloud)' };
const SOURCES = { sources: [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira', profiles: [ACME] }], defaultConnection: CONN, defaultProject: 'SHOP' };
const T = (key, title, type, status, updatedOn, linkedTo = null) => ({ key, title, url: `https://acme.test/browse/${key}`, type, status, updatedOn, linkedTo });
const TICKETS = [T('SHOP-124', 'Partial cancel for multi-item orders', 'Story', 'In progress', '25 Oct'),
  T('SHOP-123', 'Cancel an order before it ships', 'Story', 'To do', '26 Oct', { id: 'FEAT-7', title: 'Cancel an order before it ships' }),
  T('SHOP-131', 'Cancel button hidden on the mobile order page', 'Bug', 'To do', '24 Oct'), T('SHOP-98', 'Refund to store credit after a cancel', 'Story', 'Done', '12 Oct')];
const searchAnswer = (b) => { const s = String(b.search || '').toLowerCase(); return { tickets: TICKETS.filter((t) => !s || t.title.toLowerCase().includes(s) || t.key.toLowerCase() === s) }; };
const PREVIEW = (over = {}) => ({
  key: 'SHOP-124', url: 'https://acme.test/browse/SHOP-124', tracker: 'Jira', connection: 'acme.atlassian.net (Cloud)',
  meta: { project: 'SHOP', projectName: 'Shop web', type: { id: '10001', name: 'Story' }, status: 'In progress', priority: { id: '3', name: 'Medium' } },
  title: 'Partial cancel for multi-item orders',
  description: 'When an order has several items, customers cannot cancel the rest.\n\n(image: packing-slip.png)\n\n<img src=x onerror=alert(1)> stays text',
  descriptionFile: null, clipped: false, redacted: 1,
  criteria: { from: 'section', name: 'Acceptance criteria', field: null, picked: [true, true, true],
    items: ['A customer can cancel the items not picked up.', 'Shipped items stay on the order.', 'The refund covers only the cancelled items.'] },
  comments: [
    { id: '10231', author: 'Ann Example', authorKind: 'person', created: '2026-10-21T09:30:00.000Z', when: '21 Oct', body: 'Picked per parcel.', bytes: 60, picked: true },
    { id: '10234', author: 'Jira Automation', authorKind: 'app', created: '2026-10-23T09:00:00.000Z', when: '23 Oct', body: 'Status changed to In progress.', bytes: 70, picked: false },
    { id: '10236', author: 'Bo Example', authorKind: 'person', created: '2026-10-25T11:10:00.000Z', when: '25 Oct', body: 'Sandbox token ghp_<redacted>', bytes: 66, picked: true }],
  commentsTotal: 4, restrictedComments: 1, olderComments: 0,
  attachments: [
    { id: '10041', name: 'packing-slip.png', kind: 'image', mime: 'image/png', bytes: 860160, refused: null, picked: true, capped: null },
    { id: '10042', name: 'partial-cancel-flow.pdf', kind: 'binary', mime: 'application/pdf', bytes: 1258291, refused: null, picked: true, capped: null },
    { id: '10044', name: 'refund-matrix.xlsx', kind: null, mime: '', bytes: 98304, refused: 'Not offered: Worca reads text, images and PDF. Save it as PDF to attach it here.', picked: false, capped: null }],
  linkedTo: null, ...over });
const ROUTES = (over = {}) => ({ ...BASE, [`GET ${IMP}`]: SOURCES,
  [`POST ${IMP}/options`]: { projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }] },
  [`POST ${IMP}/search`]: searchAnswer, [`POST ${IMP}/preview`]: () => PREVIEW(), ...over });
const make = () => {
  const host = document.createElement('div'); const msgEl = document.createElement('p'); const subEl = document.createElement('div');
  const nav = document.createElement('nav');
  document.body.replaceChildren(nav, host);
  const routed = [];
  const view = createRequirementsView({ host, subEl, msgEl, deps: { route: (p) => routed.push(p) } });
  return { host, msgEl, nav, view, routed };
};
const openNew = async (routes = ROUTES()) => { const calls = fakeApi(routes); const m = make(); await m.view.show('new'); await settle(); return { ...m, calls }; };
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const dlg = () => document.querySelector('.req-dlg-wrap [role="dialog"]');
const q = (ui, root = document) => root.querySelector(`[data-ui="${ui}"]`);
const optionTexts = (sel) => [...sel.options].map((o) => o.textContent);
const others = () => [...document.body.children].filter((el) => !el.classList.contains('req-dlg-wrap'));
const typeSearch = async (value) => { const s = q('pick-search'); s.value = value; s.dispatchEvent(new window.Event('input')); await new Promise((r) => setTimeout(r, 350)); await settle(); };

test('D1 (board 32): From a ticket… sits at the right of Describe it once a connection can import; without one it is absent', async () => {
  const none = await openNew(ROUTES({ [`GET ${IMP}`]: { sources: [], defaultConnection: null, defaultProject: null } }));
  assert.equal(q('import-open', none.host).hidden, true);
  none.view.destroy();
  const m = await openNew();
  const b = q('import-open', m.host);
  assert.deepEqual([b.hidden, b.textContent, b.getAttribute('aria-haspopup'), b.className], [false, 'From a ticket…', 'dialog', 'btn btn-sm req-import-open']);
  assert.ok(b.closest('.req-import-labrow').querySelector('label[for="req-new-desc"]'), 'in the Describe it label row');
  m.view.destroy();
});

test('board 33: Start from a ticket is a modal dialog, its title focused, the page inert; SHOP; recently updated; the radio group "Tickets"; Escape returns the focus', async () => {
  const m = await openNew();
  q('import-open', m.host).click();
  await settle();
  const dl = dlg();
  assert.deepEqual([dl.getAttribute('aria-modal'), dl.getAttribute('aria-labelledby'), text(dl.querySelector('h2'))], ['true', 'req-pick-title', 'Start from a ticket']);
  assert.equal(document.activeElement, dl.querySelector('h2'));
  assert.ok(others().every((el) => el.hasAttribute('inert')), 'every other child of <body> is inert');
  assert.equal(text(dl.querySelector('#req-pick-desc')), 'Pick the ticket this feature starts from. Worca reads it through your Jira connection and changes nothing in Jira.');
  assert.equal(text(dl.querySelector('label[for="req-pick-project"]')), 'Jira project');
  assert.deepEqual([q('pick-project').value, optionTexts(q('pick-project'))], ['SHOP', ['All projects', 'SHOP — Shop web', 'OPS — Operations']]);
  assert.equal(q('pick-conn'), null, 'one connection: no Connection select');
  assert.equal(text(dl.querySelector('.req-import-status')), 'Recently updated in SHOP');
  const group = dl.querySelector('[role="radiogroup"]');
  assert.equal(group.getAttribute('aria-label'), 'Tickets');
  assert.deepEqual([...group.querySelectorAll('input[type="radio"]')].map((r) => r.getAttribute('aria-label')),
    TICKETS.map((t) => `${t.key} ${t.title}`));
  const row = q('pick-SHOP-123').closest('label');
  assert.deepEqual([text(row.querySelector('.hint')), text(row.querySelector('.req-import-linkchip'))], ['Story · To do · updated 26 Oct', 'Linked to FEAT-7']);
  assert.equal(q('pick-continue').disabled, true);
  q('pick-SHOP-124').click();
  assert.equal(q('pick-continue').disabled, false);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(dlg(), null);
  assert.equal(document.activeElement, q('import-open', m.host));
  assert.ok([...document.body.children].every((el) => !el.hasAttribute('inert')), 'the page is released');
  m.view.destroy();
});

test('D4: typing searches 300 ms after the last key, with the last words; the count line; an older answer that lands late is dropped', async () => {
  let first = null;
  const m = await openNew(ROUTES({ [`POST ${IMP}/search`]: (b) => (b.search === 'can'
    ? new Promise((r) => { first = () => r({ tickets: [TICKETS[2]] }); }) : searchAnswer(b)) }));
  q('import-open', m.host).click();
  await settle();
  const box = q('pick-search');
  assert.deepEqual([box.type, box.getAttribute('aria-describedby'), box.placeholder], ['search', 'req-pick-paste', 'Search by key or words']);
  box.value = 'ca'; box.dispatchEvent(new window.Event('input'));
  box.value = 'can'; box.dispatchEvent(new window.Event('input'));
  await new Promise((r) => setTimeout(r, 350));
  await settle();
  assert.deepEqual(m.calls.filter((c) => c.url === `${IMP}/search` && c.body.search).map((c) => c.body.search), ['can'], 'one search, the last words');
  assert.equal(text(dlg().querySelector('.req-import-status .badge')), 'Searching SHOP…');
  await typeSearch('cancel');
  assert.equal(text(dlg().querySelector('.req-import-status')), '4 tickets in SHOP match “cancel”.');
  first();
  await settle();
  assert.equal(dlg().querySelectorAll('[role="radiogroup"] input').length, 4, 'the late answer for "can" changed nothing');
  m.view.destroy();
});

test('D3, D4: Show more adds the next page with its cursor; several connections: a Connection select led by the tracker when several import', async () => {
  const m = await openNew(ROUTES({
    [`GET ${IMP}`]: { sources: [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira', profiles: [ACME, { id: 'beta', label: 'jira.beta.test (Data Center)' }] },
      { plugin: 'gh-issues', sourceId: 'issues', name: 'GitHub', profiles: [{ id: null, label: 'GitHub' }] }], defaultConnection: CONN, defaultProject: null },
    [`POST ${IMP}/search`]: (b) => (b.cursor ? { tickets: [TICKETS[3]] } : { tickets: TICKETS.slice(0, 3), cursor: 'p2' }),
  }));
  q('import-open', m.host).click();
  await settle();
  assert.deepEqual(optionTexts(q('pick-conn')), ['Jira · acme.atlassian.net (Cloud)', 'Jira · jira.beta.test (Data Center)', 'GitHub · GitHub']);
  assert.equal(q('pick-project').value, '', 'no setup: All projects');
  assert.equal(text(dlg().querySelector('.req-import-status')), 'Recently updated');
  q('pick-more').click();
  await settle();
  assert.equal(m.calls.filter((c) => c.url === `${IMP}/search`).at(-1).body.cursor, 'p2');
  assert.equal(dlg().querySelectorAll('[role="radiogroup"] input').length, 4);
  assert.equal(q('pick-more').hidden, true);
  m.view.destroy();
});

test('a search that fails says why with Try again; Try again searches again', async () => {
  let fail = true;
  const m = await openNew(ROUTES({ [`POST ${IMP}/search`]: (b) => (fail ? { __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' } } : searchAnswer(b)) }));
  q('import-open', m.host).click();
  await settle();
  assert.equal(text(dlg().querySelector('.req-export-alert')), 'Worca could not reach Jira: the API token was refused.');
  fail = false;
  q('pick-retry').click();
  await settle();
  assert.deepEqual([text(dlg().querySelector('.req-export-alert')), q('pick-retry').hidden, dlg().querySelectorAll('[role="radiogroup"] input').length], ['', true, 4]);
  m.view.destroy();
});

test('CSS: the pick\'s rules sit inside the Requirements block, use tokens only, and a picked ticket row is an ink border', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  for (const sel of ['.req-import-labrow', '.req-import-search', '.req-import-ticket', '.req-import-results']) {
    const at = css.indexOf(sel);
    assert.ok(at > start && at < end, `${sel} inside the Requirements block`);
  }
  const mine = css.slice(start, end).split('\n').filter((l) => /req-import/.test(l));
  const bad = /#[0-9a-fA-F]{3,8}\b|rgba?\(|font(?:-size)?:[^;}]*\b(?:11\.5|12\.5|14)px|border-radius:(?:12|999)px|min-height:44px|background:var\(--green/;
  assert.ok(mine.every((l) => !bad.test(l)), mine.filter((l) => bad.test(l)).join('\n'));
  assert.match(css, /\.req-import-ticket:has\(input:checked\)\{border-color:var\(--ink\)\}/);
});

// ---- Task 11 review fixes (fix round 1) ----
const TWO_CONNS = { sources: [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira', profiles: [ACME, { id: 'beta', label: 'jira.beta.test (Data Center)' }] }],
  defaultConnection: CONN, defaultProject: null };
const radios = () => [...dlg().querySelectorAll('[role="radiogroup"] input')].map((r) => r.value);
const switchConn = async (value) => { const sel = q('pick-conn'); sel.value = value; sel.dispatchEvent(new window.Event('change')); await settle(); };

test('a Connection change clears the old connection\'s tickets at once: none is pickable while the new projects load', async () => {
  let release = null;
  const m = await openNew(ROUTES({ [`GET ${IMP}`]: TWO_CONNS,
    [`POST ${IMP}/options`]: (b) => (b.profile === 'beta' ? new Promise((r) => { release = () => r({ projects: [{ value: 'OPS', label: 'OPS — Operations' }] }); }) : { projects: [] }) }));
  q('import-open', m.host).click();
  await settle();
  assert.equal(radios().length, 4);
  q('pick-SHOP-124').click();
  assert.equal(q('pick-continue').disabled, false);
  await switchConn('jira-source|jira|beta');
  assert.deepEqual([radios(), q('pick-continue').disabled, q('pick-more').hidden], [[], true, true], 'no old ticket stays on screen');
  assert.equal(text(dlg().querySelector('.req-import-status .badge')), 'Searching all projects…');
  release();
  await settle();
  const last = m.calls.filter((c) => c.url === `${IMP}/search`).at(-1);
  assert.equal(last.body.profile, 'beta', 'the new connection searches');
  assert.deepEqual(optionTexts(q('pick-project')), ['All projects', 'OPS — Operations']);
  assert.equal(radios().length, 4);
  m.view.destroy();
});

test('a search answer for the old connection that lands after a Connection change is dropped', async () => {
  let slow = null;
  const m = await openNew(ROUTES({ [`GET ${IMP}`]: TWO_CONNS,
    [`POST ${IMP}/options`]: (b) => (b.profile === 'beta' ? new Promise(() => {}) : { projects: [] }),
    [`POST ${IMP}/search`]: (b) => (b.search === 'zz' ? new Promise((r) => { slow = () => r({ tickets: [TICKETS[3]] }); }) : searchAnswer(b)) }));
  q('import-open', m.host).click();
  await settle();
  await typeSearch('zz');
  await switchConn('jira-source|jira|beta');
  slow();
  await settle();
  assert.deepEqual(radios(), [], 'the acme answer is not shown as beta\'s');
  assert.equal(text(dlg().querySelector('.req-import-status')), 'Searching all projects…');
  m.view.destroy();
});

test('Try again after the projects call failed loads the projects again, then searches', async () => {
  let fail = true;
  const m = await openNew(ROUTES({ [`POST ${IMP}/options`]: () => (fail ? { __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.' } }
    : { projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }] }) }));
  q('import-open', m.host).click();
  await settle();
  assert.equal(text(dlg().querySelector('.req-export-alert')), 'Worca could not reach Jira: the API token was refused.');
  assert.equal(q('pick-retry').hidden, false);
  fail = false;
  q('pick-retry').click();
  await settle();
  assert.equal(m.calls.filter((c) => c.url === `${IMP}/options`).length, 2, 'the projects are asked for again');
  assert.deepEqual([q('pick-project').value, optionTexts(q('pick-project'))], ['SHOP', ['All projects', 'SHOP — Shop web']]);
  assert.deepEqual([text(dlg().querySelector('.req-export-alert')), q('pick-retry').hidden, radios().length], ['', true, 4]);
  assert.equal(text(dlg().querySelector('.req-import-status')), 'Recently updated in SHOP');
  m.view.destroy();
});

test('Try again after a Connection change whose projects call failed loads that connection\'s projects again', async () => {
  let fail = true;
  const m = await openNew(ROUTES({ [`GET ${IMP}`]: TWO_CONNS,
    [`POST ${IMP}/options`]: (b) => (b.profile !== 'beta' ? { projects: [] } : fail ? { __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.' } }
      : { projects: [{ value: 'OPS', label: 'OPS — Operations' }] }) }));
  q('import-open', m.host).click();
  await settle();
  await switchConn('jira-source|jira|beta');
  assert.equal(text(dlg().querySelector('.req-export-alert')), 'Worca could not reach Jira: the API token was refused.');
  assert.deepEqual(radios(), []);
  fail = false;
  q('pick-retry').click();
  await settle();
  assert.deepEqual(m.calls.filter((c) => c.url === `${IMP}/options`).map((c) => c.body.profile), ['acme', 'beta', 'beta']);
  assert.deepEqual(optionTexts(q('pick-project')), ['All projects', 'OPS — Operations']);
  assert.equal(m.calls.filter((c) => c.url === `${IMP}/search`).at(-1).body.profile, 'beta');
  assert.equal(radios().length, 4);
  m.view.destroy();
});

test('a ticket row\'s radio is described by its type, status and date, and by its Linked to chip', async () => {
  const m = await openNew();
  q('import-open', m.host).click();
  await settle();
  const described = (key) => (q(`pick-${key}`).getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id));
  const linked = described('SHOP-123');
  assert.ok(linked.length === 2 && linked.every(Boolean), 'both targets exist');
  assert.deepEqual(linked.map(text), ['Story · To do · updated 26 Oct', 'Linked to FEAT-7']);
  assert.deepEqual(described('SHOP-124').map(text), ['Story · In progress · updated 25 Oct']);
  assert.equal(q('pick-SHOP-123').getAttribute('aria-label'), 'SHOP-123 Cancel an order before it ships', 'the name stays');
  const ids = [...dlg().querySelectorAll('[role="radiogroup"] [id]')].map((el) => el.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  m.view.destroy();
});

test('Show more on the last page moves the focus to the first ticket it added', async () => {
  const m = await openNew(ROUTES({ [`POST ${IMP}/search`]: (b) => (b.cursor ? { tickets: [TICKETS[3]] } : { tickets: TICKETS.slice(0, 3), cursor: 'p2' }) }));
  q('import-open', m.host).click();
  await settle();
  const more = q('pick-more');
  more.focus();
  more.click();
  await settle();
  assert.equal(more.hidden, true);
  assert.equal(document.activeElement, q('pick-SHOP-98'), 'the focus is on the first new ticket, not lost to <body>');
  m.view.destroy();
});

test('CSS: the Describe it label row matches the other field labels (8px below, weight 600 at the body size)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const rule = (sel) => { const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')}\\{([^}]*)\\}`).exec(css); return m ? m[1] : null; };
  assert.match(css, /\.field > label,\.field \.label\{display:block;font-weight:600;font-size:13px;margin-bottom:8px;\}/, 'the shared rule it matches');
  assert.match(rule('.req-import-labrow') || '', /(?:^|;)margin-bottom:8px(?:;|$)/);
  const label = rule('.req-import-labrow > label') || '';
  assert.match(label, /(?:^|;)font-weight:600(?:;|$)/);
  assert.match(label, /(?:^|;)font-size:var\(--fs-body\)(?:;|$)/);
});

// ---- Task 12: the preview (board 34), and Use this ticket ----
const toPreview = async (m) => { q('import-open', m.host).click(); await settle(); await typeSearch('cancel'); q('pick-SHOP-124').click(); q('pick-continue').click(); await settle(); };

test('board 34: Continue opens Start from SHOP-124: its title focused; the description as text; criteria renumbered; ticks; reasons; notices; Back keeps the search', async () => {
  const m = await openNew();
  await toPreview(m);
  const dl = dlg();
  assert.equal(text(dl.querySelector('h2')), 'Start from SHOP-124');
  assert.equal(document.activeElement, dl.querySelector('h2'));
  assert.equal(text(dl.querySelector('#req-ipv-desc')), 'This is what the new feature takes from SHOP-124. Untick what it should not start with. Nothing changes in Jira.');
  assert.deepEqual(m.calls.find((c) => c.url === `${IMP}/preview`).body, { ...CONN, key: 'SHOP-124', formFiles: { count: 0, bytes: 0 } });
  assert.equal(text(dl.querySelector('.req-import-meta')), 'Story · In progress · Medium · acme.atlassian.net (Cloud)');
  const desc = dl.querySelector('[aria-label="Description preview"]');
  assert.ok(desc.textContent.includes('<img src=x onerror=alert(1)> stays text'));
  assert.equal(desc.querySelector('img'), null, 'ticket text is never HTML');
  assert.ok(text(dl).includes('Without its Acceptance criteria section, which becomes the criteria below.'));
  assert.ok(text(dl).includes('Worca hid 1 thing that looked like a key or password.'));
  assert.ok(text(dl).includes('1 comment visible only to a Jira group or role is left out.'));
  assert.ok(text(dl).includes('found under “Acceptance criteria” in the description'));
  const crits = () => [...dl.querySelectorAll('[data-ui^="ipv-crit-"]')].map((b) => b.getAttribute('aria-label'));
  assert.deepEqual(crits(), ['Use R-po-1: A customer can cancel the items not picked up.', 'Use R-po-2: Shipped items stay on the order.',
    'Use R-po-3: The refund covers only the cancelled items.']);
  q('ipv-crit-0').click();
  assert.deepEqual([...dl.querySelectorAll('.req-import-code')].map((c) => c.textContent), ['', 'R-po-1', 'R-po-2']);
  assert.ok(text(dl).includes('Ticked criteria start the spec as R-po-1 to R-po-2, kept as your own edits and marked “from SHOP-124”. Unticked ones are left out; they stay in Jira.'));
  assert.deepEqual([q('ipv-com-10231').checked, q('ipv-com-10234').checked, q('ipv-com-10236').checked], [true, false, true]);
  assert.equal(q('ipv-com-10231').getAttribute('aria-label'), 'Use the comment by Ann Example, 21 Oct');
  assert.ok(text(dl).includes('Comments · 2 of 3'));
  const xlsx = q('ipv-att-10044');
  assert.deepEqual([xlsx.disabled, xlsx.checked, text(document.getElementById(xlsx.getAttribute('aria-describedby').split(' ').at(-1)))],
    [true, false, 'Not offered: Worca reads text, images and PDF. Save it as PDF to attach it here.']);
  assert.equal(q('ipv-att-10041').getAttribute('aria-label'), 'Add packing-slip.png as a feature file');
  assert.ok(text(dl).includes('Attachments · 2 of 3'));
  assert.ok(text(dl).includes('Nothing is sent to Jira.'));
  q('ipv-back').click();
  await settle();
  assert.equal(text(dlg().querySelector('h2')), 'Start from a ticket');
  assert.deepEqual([q('pick-search').value, q('pick-SHOP-124').checked, q('pick-continue').disabled], ['cancel', true, false]);
  m.view.destroy();
});

test('D1, D5: Use this ticket only fills the form: the title and the description; the dialog closes, the page is released, the focus on From a ticket…; nothing is posted', async () => {
  const m = await openNew();
  await toPreview(m);
  q('ipv-use').click();
  await settle();
  assert.equal(dlg(), null);
  assert.equal(m.host.querySelector('#req-new-title').value, 'Partial cancel for multi-item orders');
  assert.equal(m.host.querySelector('#req-new-desc').value, PREVIEW().description);
  assert.equal(document.activeElement, q('import-open', m.host));
  assert.ok([...document.body.children].every((el) => !el.hasAttribute('inert')));
  assert.equal(m.calls.filter((c) => c.method === 'POST' && c.url === '/api/requirements').length, 0, 'nothing created');
  m.view.destroy();
});

test("CSS: the preview's rules sit inside the Requirements block", () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  for (const sel of ['.req-import-cols', '.req-import-check', '.req-import-why', '.req-import-linked']) {
    const at = css.indexOf(sel);
    assert.ok(at > start && at < end, `${sel} inside the Requirements block`);
  }
});

// ---- Task 11 re-review fixes (in Task 12) ----
test('Show more does not take the focus from the search box when its page answers while the user types', async () => {
  let page = null;
  const m = await openNew(ROUTES({ [`POST ${IMP}/search`]: (b) => (b.cursor ? new Promise((r) => { page = () => r({ tickets: [TICKETS[3]] }); })
    : { tickets: TICKETS.slice(0, 3), cursor: 'p2' }) }));
  q('import-open', m.host).click();
  await settle();
  const more = q('pick-more');
  more.focus();
  more.click();
  await settle();
  const box = q('pick-search');
  box.focus();
  box.value = 'refund';
  box.dispatchEvent(new window.Event('input'));
  page();
  await settle();
  assert.ok(q('pick-SHOP-98'), 'the next page is shown');
  assert.equal(document.activeElement, box, 'the focus stays in the search box');
  m.view.destroy();
});

test('Back from the preview keeps the search words and the tickets when the projects call fails; Try again searches the same words', async () => {
  let options = 0;
  const m = await openNew(ROUTES({ [`POST ${IMP}/options`]: () => ((options += 1) === 2
    ? { __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' } }
    : { projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }] }) }));
  await toPreview(m);
  q('ipv-back').click();
  await settle();
  assert.equal(options, 2, 'Back asked for the projects again');
  assert.equal(text(dlg().querySelector('.req-export-alert')), 'Worca could not reach Jira: the API token was refused.');
  assert.equal(q('pick-retry').hidden, false);
  assert.deepEqual([q('pick-search').value, radios().length, q('pick-SHOP-124').checked, q('pick-continue').disabled, q('pick-project').value],
    ['cancel', 4, true, false, 'SHOP'], 'the kept pick stays');
  q('pick-retry').click();
  await settle();
  assert.equal(m.calls.filter((c) => c.url === `${IMP}/search`).at(-1).body.search, 'cancel', 'Try again searches the kept words');
  assert.deepEqual([text(dlg().querySelector('.req-import-status')), q('pick-SHOP-124').checked], ['4 tickets in SHOP match “cancel”.', true]);
  m.view.destroy();
});

test('after Try again the focus lands on the preview title, not <body>; also when the retry answers gone', async () => {
  let n = 0;
  const m = await openNew(ROUTES({ [`POST ${IMP}/preview`]: () => ((n += 1) === 1
    ? { __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' } } : PREVIEW()) }));
  await toPreview(m);
  assert.ok(text(dlg()).includes('Nothing was changed.'));
  q('ipv-retry').focus();
  assert.equal(document.activeElement, q('ipv-retry'));
  q('ipv-retry').click();
  await settle();
  assert.ok(q('ipv-use') && !q('ipv-use').disabled, 'the preview loaded');
  assert.equal(document.activeElement, document.getElementById('req-ipv-title'), 'the focus is on the title');
  m.view.destroy();
  let k = 0;
  const g = await openNew(ROUTES({ [`POST ${IMP}/preview`]: () => ((k += 1) === 1
    ? { __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.' } }
    : { __status: 409, body: { gone: true, error: 'SHOP-124 no longer exists in Jira.' } }) }));
  await toPreview(g);
  q('ipv-retry').focus();
  q('ipv-retry').click();
  await settle();
  assert.equal(q('ipv-retry'), null, 'no Try again for a ticket that is gone');
  assert.equal(document.activeElement, document.getElementById('req-ipv-title'));
  g.view.destroy();
});

test('a preview answer that arrives after Back is dropped: nothing is painted into the pick', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const m = await openNew(ROUTES({ [`POST ${IMP}/preview`]: async () => { await gate; return PREVIEW(); } }));
  await toPreview(m);
  q('ipv-back').click();
  await settle();
  release();
  await settle();
  assert.ok(q('pick-search'), 'the pick is on screen');
  assert.equal(dlg().querySelector('.req-import-body'), null);
  assert.equal(q('ipv-use'), null);
  m.view.destroy();
});

test('the comment and attachment checkboxes are described by the comment body and the kind and size', async () => {
  const m = await openNew();
  await toPreview(m);
  const by = (ui) => (q(ui).getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((id) => text(document.getElementById(id)));
  assert.deepEqual(by('ipv-com-10231'), ['Picked per parcel.']);
  assert.deepEqual(by('ipv-att-10041'), ['Image · 840 KB']);
  const ids = [...dlg().querySelectorAll('[id]')].map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'the ids are unique');
  m.view.destroy();
});

test('in the preview a 502 puts "Nothing was changed." before Try again, as the pick does', async () => {
  const fail = { __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' } };
  const order = (root, retry) => {
    const all = [...root.querySelectorAll('*')];
    const note = all.find((e) => e.classList.contains('req-import-note') && !e.hidden);
    const btn = root.querySelector(`[data-ui="${retry}"]`);
    return !!note && !!btn && !!(note.compareDocumentPosition(btn) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  };
  const m = await openNew(ROUTES({ [`POST ${IMP}/search`]: fail }));
  q('import-open', m.host).click();
  await settle();
  assert.equal(order(dlg(), 'pick-retry'), true, 'the pick: note then Try again');
  m.view.destroy();
  const p = await openNew(ROUTES({ [`POST ${IMP}/preview`]: fail }));
  await toPreview(p);
  assert.equal(order(dlg(), 'ipv-retry'), true, 'the preview matches');
  p.view.destroy();
});

const KB = (id, name, bytes, extra = {}) => ({ id, name, kind: 'text', mime: 'text/plain', bytes, refused: null, picked: true, capped: null, ...extra });
// Task 12's fix round describes an attachment by its kind and size (req-ipv-ameta-<id>) at all times; a cap line is appended last
const describedBy = (el) => (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
const lastLine = (el) => { const ids = describedBy(el); return ids.length ? text(document.getElementById(ids[ids.length - 1])) : null; };

test('D9 (board 36, 6): a tick that would pass 10 files or 100 MB is disabled with the line; freeing room enables it again', async () => {
  const nine = Array.from({ length: 9 }, (_, i) => KB(`2${i}`, `notes-${i}.md`, 2048));
  const m = await openNew(ROUTES({ [`POST ${IMP}/preview`]: () => PREVIEW({ attachments: [...nine, KB('30', 'notes-9.md', 2048, { picked: false, capped: 'files' })] }) }));
  await toPreview(m);
  const tenth = q('ipv-att-30');
  assert.deepEqual([tenth.disabled, lastLine(tenth)], [true, 'A feature takes up to 10 files; 10 are picked.']);
  assert.equal(tenth.closest('li').classList.contains('req-import-off'), true, 'a capped row looks off like a refused one');
  assert.deepEqual(describedBy(tenth), ['req-ipv-ameta-30', 'req-ipv-why-30'], 'the kind and size stay; the cap line comes last');
  q('ipv-att-20').click();
  assert.deepEqual([tenth.disabled, describedBy(tenth).includes('req-ipv-why-30'), document.getElementById('req-ipv-why-30').hidden], [false, false, true]);
  assert.deepEqual(describedBy(tenth), ['req-ipv-ameta-30'], 'only the kind and size once room is freed');
  assert.equal(tenth.closest('li').classList.contains('req-import-off'), false, 'room made: the row looks on again');
  q('ipv-att-20').click();
  assert.equal(tenth.disabled, true, 'taking the room back disables it again');
  q('ipv-com-10231').click();
  q('ipv-com-10236').click();
  assert.equal(q('ipv-att-20').closest('li').classList.contains('req-import-off'), false, 'a ticked row is never off');
  assert.equal(tenth.disabled, false, 'no comment picked: no comments file, one more room');
  m.view.destroy();
  const MB = 1024 * 1024;
  const big = [KB('40', 'a.pdf', 24 * MB), KB('41', 'b.pdf', 24 * MB), KB('42', 'c.pdf', 24 * MB), KB('43', 'd.pdf', 24 * MB), KB('44', 'e.pdf', 24 * MB, { picked: false, capped: 'bytes' })];
  const h2 = await openNew(ROUTES({ [`POST ${IMP}/preview`]: () => PREVIEW({ attachments: big }) }));
  await toPreview(h2);
  assert.equal(lastLine(q('ipv-att-44')), "Picked files are at 100 MB, a new feature's limit. Add more on the feature page.");
  h2.view.destroy();
});

/** Puts files on the New feature form (name, bytes) through its file input, as a pick would; sizes are faked, no memory is spent. */
const formFiles = (specs) => {
  const input = document.getElementById('req-new-files-input');
  const files = specs.map(([name, bytes]) => { const f = new window.File(['x'], name, { type: 'application/pdf' }); Object.defineProperty(f, 'size', { value: bytes }); return f; });
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new window.Event('change'));
};
const MB = 1024 * 1024;
/** Opens the preview over `over` (its attachments get one more, unticked: the probe), with the form already holding `form` files. */
const capCase = async (form, over, probe = KB('99', 'probe.pdf', 1, { picked: false })) => {
  const m = await openNew(ROUTES({ [`POST ${IMP}/preview`]: () => PREVIEW({ comments: [], ...over, attachments: [...(over.attachments || []), probe] }) }));
  formFiles(form);
  await toPreview(m);
  return { m, probe: q('ipv-att-99'), line: () => lastLine(q('ipv-att-99')) };
};
const FILES_LINE = 'A feature takes up to 10 files; 10 are picked.';
const BYTES_LINE = "Picked files are at 100 MB, a new feature's limit. Add more on the feature page.";
const smalls = (n) => Array.from({ length: n }, (_, i) => [`form-${i}.pdf`, 1024]);

test("D9 caps: the form's own files count toward 10 files (10 cap one more, 9 do not)", async () => {
  const ten = await capCase(smalls(10), {});
  assert.deepEqual([ten.probe.disabled, ten.line()], [true, FILES_LINE]);   // kills: dropping form.count
  ten.m.view.destroy();
  const nine = await capCase(smalls(9), {});
  assert.equal(nine.probe.disabled, false, 'the tenth file still fits');
  nine.m.view.destroy();
});

test('D9 caps: the description file counts toward 10 files, and toward 100 MB', async () => {
  const nine = Array.from({ length: 9 }, (_, i) => KB(`5${i}`, `n-${i}.md`, 1024));
  const files = await capCase([], { attachments: nine, descriptionFile: { name: 'SHOP-124 description.md', bytes: 100 } });
  assert.deepEqual([files.probe.disabled, files.line()], [true, FILES_LINE]);   // kills: dropping the description file's count
  files.m.view.destroy();
  const none = await capCase([], { attachments: nine });
  assert.equal(none.probe.disabled, false, 'without a description file there is room');
  none.m.view.destroy();
  const three = [KB('60', 'a.pdf', 24 * MB), KB('61', 'b.pdf', 24 * MB), KB('62', 'c.pdf', 24 * MB)];
  const bytes = await capCase([], { attachments: three, descriptionFile: { name: 'SHOP-124 description.md', bytes: 24 * MB } }, KB('99', 'probe.pdf', 5 * MB, { picked: false }));
  assert.deepEqual([bytes.probe.disabled, bytes.line()], [true, BYTES_LINE]);   // kills: dropping the description file's bytes
  bytes.m.view.destroy();
});

test("D9 caps: the form's files and the picked comments count toward 100 MB; exactly 100 MB is allowed, one byte more is capped", async () => {
  const four = [['a.pdf', 24 * MB], ['b.pdf', 24 * MB], ['c.pdf', 24 * MB], ['d.pdf', 24 * MB]];
  const over = await capCase(four, {}, KB('99', 'probe.pdf', 5 * MB, { picked: false }));
  assert.deepEqual([over.probe.disabled, over.line()], [true, BYTES_LINE]);   // kills: dropping form.bytes
  over.m.view.destroy();
  const exact = await capCase(four, {}, KB('99', 'probe.pdf', 4 * MB, { picked: false }));
  assert.equal(exact.probe.disabled, false, 'a total of exactly 100 MB is allowed');   // kills: > changed to >= on bytes
  exact.m.view.destroy();
  const plus = await capCase(four, {}, KB('99', 'probe.pdf', 4 * MB + 1, { picked: false }));
  assert.deepEqual([plus.probe.disabled, plus.line()], [true, BYTES_LINE], 'one byte more is capped');
  plus.m.view.destroy();
  const three = [KB('60', 'a.pdf', 24 * MB), KB('61', 'b.pdf', 24 * MB), KB('62', 'c.pdf', 24 * MB)];
  const com = { id: 'c1', author: 'Ann Example', authorKind: 'person', created: '2026-10-21T09:30:00.000Z', when: '21 Oct', body: 'Big', bytes: 24 * MB, picked: true };
  const comments = await capCase([], { attachments: three, comments: [com] }, KB('99', 'probe.pdf', 5 * MB, { picked: false }));
  assert.deepEqual([comments.probe.disabled, comments.line()], [true, BYTES_LINE]);   // kills: dropping the comments' bytes
  q('ipv-com-c1').click();
  assert.equal(comments.probe.disabled, false, 'unticking the comment gives its bytes back');
  comments.m.view.destroy();
});

test('exactly three comments give no Show all; a refused row keeps looking off', async () => {
  const m = await openNew();
  await toPreview(m);
  assert.equal(dlg().querySelectorAll('.req-import-com').length, 3);
  assert.equal(q('ipv-showall'), null);
  assert.equal(dlg().querySelectorAll('.req-import-com.folded').length, 0);
  assert.equal(q('ipv-att-10044').closest('li').classList.contains('req-import-off'), true, 'refused');
  m.view.destroy();
});

test('board 36 (1–3): unreachable says what changed and where it is fixed (Advanced); no match; a pasted key that is not there', async () => {
  const m = await openNew(ROUTES({ [`POST ${IMP}/search`]: (b) => (b.search === 'partial refund' ? { tickets: [] } : b.search === 'SHOP-999' ? { tickets: [] }
    : { __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' } }) }));
  q('import-open', m.host).click();
  await settle();
  const dl = dlg();
  assert.equal(text(dl.querySelector('.req-export-alert')), 'Worca could not reach Jira: the API token was refused.');
  const note = dl.querySelector('.req-import-note');
  assert.equal(note.hidden, false);
  assert.equal(text(note), 'Nothing was changed. Fix the connection on the Marketplace page (Installed › Jira), then try again.');
  assert.equal(note.querySelector('[data-min-level="advanced"]').textContent, ' Fix the connection on the Marketplace page (Installed › Jira), then try again.');
  assert.equal(q('pick-retry').hidden, false);
  await typeSearch('partial refund');
  assert.deepEqual([text(dl.querySelector('.req-import-status')), dl.querySelector('.req-import-empty').hidden],
    ['No ticket in SHOP matches “partial refund”.', false]);
  assert.equal(text(dl.querySelector('.req-import-empty')), "Try other words, or paste the ticket's key or link.");
  await typeSearch('SHOP-999');
  assert.deepEqual([text(dl.querySelector('.req-import-status')), dl.querySelector('.req-import-empty').hidden],
    ['SHOP-999 was not found in Jira, or this connection cannot see it.', true]);
  m.view.destroy();
});

test('board 36 (4, 5, 7): the ticket another feature follows (an amber alert above the columns); no criteria, comments or attachments; a long description', async () => {
  const m = await openNew(ROUTES({ [`POST ${IMP}/preview`]: () => PREVIEW({ key: 'SHOP-131', linkedTo: { id: 'FEAT-7', title: 'Cancel an order before it ships' },
    criteria: { from: null, name: null, field: null, items: [], picked: [] }, comments: [], restrictedComments: 0, attachments: [], redacted: 0, clipped: true,
    descriptionFile: { name: 'SHOP-131 description.md', bytes: 24002 } }) }));
  await toPreview(m);
  const dl = dlg();
  const alert = dl.querySelector('.req-import-linked');
  assert.deepEqual([alert.getAttribute('role'), text(alert)], ['alert',
    'SHOP-131 is linked to FEAT-7 · Cancel an order before it ships. The new feature can start from it but stays unlinked: one ticket follows one feature.']);
  assert.ok(alert.compareDocumentPosition(dl.querySelector('.req-import-cols')) & window.Node.DOCUMENT_POSITION_FOLLOWING, 'above the columns');
  for (const s of ['Acceptance criteria · none', 'None found in SHOP-131. Round 1 asks for them.', 'Comments · none', 'Attachments · none',
    "SHOP-131's description is longer than 20,000 characters. The form keeps the start; the whole text goes along as SHOP-131 description.md."]) {
    assert.ok(text(dl).includes(s), s);
  }
  m.view.destroy();
});

test('the preview of a ticket that is gone says its sentence (not the flag text) and offers no Try again; a 502 offers Try again and says nothing changed (D16); a late answer after Back is dropped', async () => {
  const gone = await openNew(ROUTES({ [`POST ${IMP}/preview`]: { __status: 404, body: { gone: true, error: 'SHOP-124 was not found in Jira, or this connection cannot see it.' } } }));
  await toPreview(gone);
  assert.equal(text(dlg().querySelector('.req-export-alert')), 'SHOP-124 was not found in Jira, or this connection cannot see it.');
  assert.equal(q('ipv-retry'), null);
  assert.equal(q('ipv-use').disabled, true);
  assert.equal(dlg().querySelector('.req-import-note').hidden, true, 'a gone ticket is not a connection to fix');
  gone.view.destroy();
  const down = await openNew(ROUTES({ [`POST ${IMP}/preview`]: { __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' } } }));
  await toPreview(down);
  const note = dlg().querySelector('.req-import-note');
  assert.deepEqual([text(dlg().querySelector('.req-export-alert')), note.hidden, text(note), !!q('ipv-retry')],
    ['Worca could not reach Jira: the API token was refused.', false,
      'Nothing was changed. Fix the connection on the Marketplace page (Installed › Jira), then try again.', true]);
  assert.equal(note.querySelector('[data-min-level="advanced"]').textContent, ' Fix the connection on the Marketplace page (Installed › Jira), then try again.');
  down.view.destroy();
  let release = null;
  const late = await openNew(ROUTES({ [`POST ${IMP}/preview`]: () => new Promise((r) => { release = () => r(PREVIEW()); }) }));
  await toPreview(late);
  q('ipv-back').click();
  await settle();
  release();
  await settle();
  assert.equal(text(dlg().querySelector('h2')), 'Start from a ticket', 'the pick stays; the late preview changed nothing');
  late.view.destroy();
});

test('board 36 (phone): past three comments the rest fold behind "Show all 6 comments", which unfolds them', async () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, author: i % 2 ? 'Bo Example' : 'Ann Example', authorKind: 'person', created: '2026-10-21T09:30:00.000Z',
    when: '21 Oct', body: `Comment ${i}`, bytes: 40, picked: true }));
  const m = await openNew(ROUTES({ [`POST ${IMP}/preview`]: () => PREVIEW({ comments: six }) }));
  await toPreview(m);
  const rows = [...dlg().querySelectorAll('.req-import-com')];
  assert.deepEqual(rows.map((r) => r.classList.contains('folded')), [false, false, false, true, true, true]);
  const all = q('ipv-showall');
  assert.equal(all.textContent, 'Show all 6 comments');
  all.click();
  assert.ok(rows.every((r) => !r.classList.contains('folded')));
  assert.equal(all.hidden, true);
  assert.equal(document.activeElement, q('ipv-com-c3'), 'the focus goes to the first comment it unfolded, not <body>');
  m.view.destroy();
});

test('CSS (board 36): at 900 px and narrower one column, author and date only, the fold, 44 px hit areas without min-height on a button', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const at = css.indexOf('/* A6.1 (board 36, D19)');
  assert.ok(at > 0 && at < css.indexOf('/* ── marketplace P3 ── */'));
  const block = css.slice(at, css.indexOf('/* ── marketplace P3 ── */'));
  for (const rule of ['.req-import-cols{grid-template-columns:minmax(0,1fr)}', '.req-import-cbody{display:none}', '.req-import-com.folded{display:none}',
    '.req-import-check::after{content:"";position:absolute;inset:-13px 0}', '.req-import .btn-sm::after{content:"";position:absolute;inset:-9px 0}',
    '.req-import-showall{display:block;width:100%;position:relative;text-align:left;margin-top:20px}']) {
    assert.ok(block.includes(rule), rule);
  }
  const media = block.indexOf('@media (max-width:900px)');
  assert.ok(media > 0 && block.indexOf('.req-import-showall{display:none}') < media, 'Show all is hidden outside the media query');
  // a long file name, author or criterion shrinks and wraps inside the card instead of widening it; the hint stays inside
  for (const rule of ['.req-import-aname{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}', '.req-import-check{min-width:0;overflow-wrap:anywhere}',
    '.req-import-cby{overflow-wrap:anywhere}', '.req-import-check > .hint{flex:none;max-width:45%}']) assert.ok(css.includes(rule), rule);
  // the two ::after tap areas (13 px each) touch, never overlap: 26 px between rows; the section's 6 px gap + 20 px margin above Show all
  assert.ok(css.includes('.req-import-list{gap:26px}') && block.includes('margin-top:20px'));
  assert.ok(!/min-height:44px/.test(block));
});
