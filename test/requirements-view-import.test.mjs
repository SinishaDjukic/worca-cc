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
