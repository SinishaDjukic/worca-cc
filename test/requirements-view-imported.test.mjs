// test/requirements-view-imported.test.mjs — a feature that started from a ticket, in jsdom with a fake API (plans/requirements-a61-design.md
// §7, D10, D11, D14, D19; boards 35, 36). No server, no tracker.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#requirements' });
for (const k of ['document', 'location', 'Event', 'KeyboardEvent', 'HTMLElement', 'window']) {
  Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
}
window.confirm = () => true;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 12; i += 1) await tick(); };
after(() => window.close());
const { createRequirementsView } = await import('../ui/public/requirements-view.mjs');

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
const BASE = { 'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop' }] }, 'GET /api/workspaces': { workspaces: [] } };
const F = '/api/requirements/8';
const FROM = { tracker: 'Jira', key: 'SHOP-124' };
const file = (id, name, kind, bytes, status, over = {}) => ({ id, name, kind, mime: kind === 'image' ? 'image/png' : kind === 'binary' ? 'application/pdf' : 'text/markdown',
  bytes, status, error: null, summary: '', summaryEdited: false, asks: [], history: [], sendWithRun: false, costUsd: 0, readAt: null, readModel: null,
  estimateUsd: 0.1, mentions: [], href: `${F}/attachments/${id}`, asking: null, sendable: status === 'done', from: FROM, fetched: false, ...over });
const SPEC = { goal: { text: '', measure: '' }, actors: [], flow: [], edgeCases: [], rules: [], outOfScope: [],
  criteria: [{ id: 'R-po-1', text: 'A customer can cancel the items not picked up.', edited: true, source: 'SHOP-124' },
    { id: 'R-po-2', text: 'The refund follows refund-matrix.pdf.', edited: true, source: 'refund-matrix.pdf' }],
  assumptions: [], openQuestions: [], edited: {} };
const LINK = { key: 'SHOP-124', url: 'https://acme.test/browse/SHOP-124', createdAt: '2026-10-27T09:12:00Z', exportedAt: '2026-10-27T09:12:00Z',
  madeOn: '27 Oct', lastOn: '27 Oct', origin: 'import', importedOn: '27 Oct', sinceImport: true, tracker: 'Jira' };
const XV = (over = {}) => ({ tracker: { name: 'Jira' }, canExport: true, hasSetup: false, link: LINK, exporting: false, doneStatus: null,
  history: [{ action: 'imported', tracker: 'Jira', key: 'SHOP-124', url: LINK.url, reason: null, when: '27 Oct, 09:12', by: 'Ann Example', linked: true, linkedTo: null }], ...over });
const feature = (over = {}) => ({ seq: 8, id: 'FEAT-8', scopeType: 'project', scopeKey: 'shop-1', title: 'Partial cancel for multi-item orders', status: 'looking',
  rounds: 0, costUsd: 0, busy: true, orientation: null, spec: SPEC, pending: null, lastError: null, state: 'looking',
  readiness: { ok: false, passed: 1, total: 6, checks: [], overridable: false }, starts: [], unaskedRejections: [], changedSinceStart: [], briefDocuments: [], unaskedFiles: [],
  interview: null, resetPeriod: 'monthly', export: XV(),
  attachments: [file('ratt_000000000001', 'SHOP-124 comments.md', 'text', 3072, 'reading', { estimateUsd: 0.02 }),
    file('ratt_000000000002', 'packing-slip.png', 'image', 860160, 'reading', { fetched: true, estimateUsd: 0.06 }),
    file('ratt_000000000003', 'partial-cancel-flow.pdf', 'binary', 1258291, 'downloading'),
    file('ratt_000000000004', 'support-macro.txt', 'text', 4096, 'downloading', { estimateUsd: null })], ...over });
const make = () => {
  const host = document.createElement('div'); const msgEl = document.createElement('p'); const subEl = document.createElement('div');
  document.body.replaceChildren(document.createElement('nav'), host);
  const view = createRequirementsView({ host, subEl, msgEl, deps: { route: () => {} } });
  return { host, msgEl, view };
};
const openFeature = async (f, extra = {}) => {
  let current = f;
  const calls = fakeApi({ ...BASE, [`GET ${F}`]: () => ({ feature: current, turns: [] }), ...extra });
  const m = make();
  await m.view.show('feature/8');
  await settle();
  return { ...m, calls, set: (nf) => { current = nf; } };
};
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const q = (ui, root = document) => root.querySelector(`[data-ui="${ui}"]`);
const row = (host, id) => host.querySelector(`[data-file="${id}"]`);

test('board 35: the working line says what is on its way, then what is read, in one role=status node', async () => {
  const m = await openFeature(feature());
  const line = m.host.querySelector('.req-reading');
  assert.equal(line.getAttribute('role'), 'status');
  assert.equal(text(line), 'Getting 2 files from SHOP-124… Worca gets the files from Jira and reads them first, then shows round 1.');
  m.set(feature({ attachments: feature().attachments.map((a) => ({ ...a, status: 'reading' })) }));
  await m.view.changed(8);
  await settle();
  assert.equal(m.host.querySelector('.req-reading'), line, 'the same node');
  assert.equal(text(line), 'Reading 4 files… Worca reads the files first, then shows round 1.');
  m.view.destroy();
});

test('board 35: each file says where it came from and where it is: Downloading…, "Downloaded from SHOP-124", Reading…; no switch, Open or Read again before it is there', async () => {
  const m = await openFeature(feature());
  const pdf = row(m.host, 'ratt_000000000003');
  assert.equal(text(pdf.querySelector('.req-file-meta')), 'PDF · 1.2 MB · from SHOP-124');
  const badge = pdf.querySelector('.badge');
  assert.deepEqual([text(badge), badge.getAttribute('role')], ['Downloading…', 'status']);
  assert.equal(text(pdf.querySelector('.req-file-state')), 'Worca is getting it from SHOP-124. Then it reads it (about $0.10).');
  assert.equal(text(row(m.host, 'ratt_000000000004').querySelector('.req-file-state')), 'Worca is getting it from SHOP-124. Then it reads it.');
  assert.equal(pdf.querySelector('.req-file-send'), null, 'no Send with the run before it is there');
  const nameEl = q('file-name-ratt_000000000003', m.host);
  assert.deepEqual([nameEl.tagName, nameEl.hasAttribute('href'), nameEl.getAttribute('tabindex'), text(nameEl)], ['SPAN', false, '-1', 'partial-cancel-flow.pdf'],
    'no link to a body that is not there yet; still a focus target');
  assert.equal(q('file-name-ratt_000000000002', m.host).tagName, 'A', 'a downloaded file links its body');
  q('file-more-ratt_000000000003', m.host).click();
  assert.deepEqual([q('fmi-open-ratt_000000000003', m.host), q('fmi-again-ratt_000000000003', m.host)], [null, null]);
  assert.ok(q('fmi-remove-ratt_000000000003', m.host), 'Remove stays');
  assert.deepEqual(['replace', 'ask', 'edit'].map((k) => q(`fmi-${k}-ratt_000000000003`, m.host)), [null, null, null],
    'a file on its way offers no Replace, Ask or Edit (one job per file)');
  assert.equal(text(row(m.host, 'ratt_000000000002').querySelector('.req-file-state')),
    'Downloaded from SHOP-124. Worca is reading it (about $0.06). The next round uses it.');
  assert.equal(text(row(m.host, 'ratt_000000000001').querySelector('.req-file-meta')), 'Text · 3 KB · from SHOP-124');
  assert.equal(text(row(m.host, 'ratt_000000000001').querySelector('.req-file-state')), 'Worca is reading it (about $0.02). The next round uses it.');
  await m.view.changed(8);
  await settle();
  assert.equal(row(m.host, 'ratt_000000000003').querySelector('.badge'), badge, 'the badge node survives a repaint');
  m.view.destroy();
});

test('board 36 (9–11): a download that failed (Try again, one post per press), one a restart stopped, one Worca could not use (no Try again)', async () => {
  const dl = (id, name, code, message) => file(id, name, 'binary', 1258291, 'failed', { error: { code, message, job: 'download', at: 't' } });
  const f = feature({ busy: false, status: 'your_turn', rounds: 1, attachments: [
    dl('ratt_000000000003', 'partial-cancel-flow.pdf', 'DOWNLOAD', 'Worca could not get this file from Jira: it did not answer within 2 minutes.'),
    dl('ratt_000000000004', 'support-macro.txt', 'INTERRUPTED', 'Worca restarted before it got this file from Jira.'),
    dl('ratt_000000000005', 'scan-notes.pdf', 'REFUSED', 'Worca could not use this file: it is already attached as call-notes.pdf.')] });
  let release = null;
  const m = await openFeature(f, { [`POST ${F}/attachments/ratt_000000000003/read-again`]: () => new Promise((r) => { release = () => r({ feature: f, turns: [] }); }) });
  const a = row(m.host, 'ratt_000000000003').querySelector('.req-file-failed');
  assert.deepEqual([a.getAttribute('role'), text(a.querySelector('.req-file-failed-text'))],
    ['alert', 'Worca could not get this file from Jira: it did not answer within 2 minutes. The interview lists it by name only.']);
  const again = q('file-retry-ratt_000000000003', m.host);
  again.click();
  again.click();
  await settle();
  assert.equal(m.calls.filter((c) => c.url.endsWith('/read-again')).length, 1, 'no double post');
  release();
  await settle();
  assert.equal(text(row(m.host, 'ratt_000000000004').querySelector('.req-file-failed-text')), 'Worca restarted before it got this file from Jira.');
  assert.equal(q('file-retry-ratt_000000000004', m.host).hidden, false);
  const refused = row(m.host, 'ratt_000000000005');
  assert.equal(text(refused.querySelector('.req-file-failed-text')), 'Worca could not use this file: it is already attached as call-notes.pdf.');
  assert.equal(refused.querySelector('[data-ui^="file-retry-"]').hidden, true, 'no Try again: the same file would be refused again');
  for (const id of ['ratt_000000000003', 'ratt_000000000004', 'ratt_000000000005']) {
    assert.equal(row(m.host, id).querySelector('.req-file-send'), null, `${id}: no switch for a file without its body`);
    assert.equal(q(`file-name-${id}`, m.host).tagName, 'SPAN', `${id}: no link to a body that never came`);
  }
  q('file-more-ratt_000000000005', m.host).click();
  assert.deepEqual([q('fmi-open-ratt_000000000005', m.host), q('fmi-again-ratt_000000000005', m.host)], [null, null]);
  assert.ok(q('fmi-remove-ratt_000000000005', m.host), 'Remove mends a refused file');
  m.view.destroy();
});

const dlFailed = (id, name, code, message) => file(id, name, 'binary', 1258291, 'failed', { error: { code, message, job: 'download', at: 't' } });
const DL_MSG = 'Worca could not get this file from Jira: it did not answer within 2 minutes.';

test('board 36: while the feature is busy (locked) Try again is disabled; once it is free it works', async () => {
  const id = 'ratt_000000000003';
  const m = await openFeature(feature({ busy: true, attachments: [dlFailed(id, 'partial-cancel-flow.pdf', 'DOWNLOAD', DL_MSG)] }));
  assert.equal(q(`file-retry-${id}`, m.host).disabled, true, 'locked: no Try again');
  m.set(feature({ busy: false, status: 'your_turn', rounds: 1, attachments: [dlFailed(id, 'partial-cancel-flow.pdf', 'DOWNLOAD', DL_MSG)] }));
  await m.view.changed(8);
  await settle();
  assert.equal(q(`file-retry-${id}`, m.host).disabled, false, 'free again: Try again is on');
  m.view.destroy();
});

test('board 36: a Try again the server refused (409) does not stick: the next press posts again', async () => {
  const id = 'ratt_000000000003';
  const f = feature({ busy: false, status: 'your_turn', rounds: 1, attachments: [dlFailed(id, 'partial-cancel-flow.pdf', 'DOWNLOAD', DL_MSG)] });
  let n = 0;
  const m = await openFeature(f, { [`POST ${F}/attachments/${id}/read-again`]: () => (++n === 1 ? { __status: 409, body: { error: 'busy' } } : { feature: f, turns: [] }) });
  q(`file-retry-${id}`, m.host).click();
  await settle();
  q(`file-retry-${id}`, m.host).click();
  await settle();
  assert.equal(m.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/read-again')).length, 2, 'the second press posts again');
  m.view.destroy();
});

test('board 18/36: the Build chip for a download that failed says the Files card words, not stored file; for one on its way it waits', async () => {
  const id = 'ratt_000000000003';
  const ready = (attachments) => feature({ busy: false, status: 'done', state: 'ready', rounds: 1, attachments,
    readiness: { ok: true, passed: 6, total: 6, checks: [], overridable: false } });
  const m = await openFeature(ready([dlFailed(id, 'partial-cancel-flow.pdf', 'DOWNLOAD', DL_MSG),
    dlFailed('ratt_000000000005', 'scan-notes.pdf', 'REFUSED', 'Worca could not use this file: it is already attached as call-notes.pdf.'),
    file('ratt_000000000004', 'support-macro.txt', 'text', 4096, 'downloading')]));
  const bad = [...m.host.querySelectorAll('.req-build-files-bad')].map((l) => text(l));
  assert.deepEqual(bad, [`partial-cancel-flow.pdf: ${DL_MSG} The interview lists it by name only.`,
    'scan-notes.pdf: Worca could not use this file: it is already attached as call-notes.pdf.']);
  assert.ok(bad.every((t) => !t.includes('stored file')));
  assert.equal(text(row(m.host, id).querySelector('.req-file-failed-text')),
    `${DL_MSG} The interview lists it by name only.`, 'the same sentence as the Files card');
  const chips = [...m.host.querySelectorAll('.req-fpick')];
  assert.deepEqual(chips.map((c) => c.disabled), [true, true, true], 'off and disabled');
  assert.equal(text(chips[2]), 'support-macro.txt Downloading…');
  m.view.destroy();
});

const PREVIEW_URL = `${F}/export/preview`;
const AGAIN = (over = {}) => ({ mode: 'update', tracker: 'Jira', key: 'SHOP-124', ticket: { description: '## Goal\n\nx\n' }, comment: null, previewHash: 'h1',
  changes: [{ line: 'Goal: 1 line added', id: null }, { line: 'Added R-po-4 A parcel that is picked up cannot be cancelled.', id: 'R-po-4' }],
  fields: null, link: { key: 'SHOP-124', madeOn: '27 Oct', lastOn: '27 Oct', origin: 'import', importedOn: '27 Oct', sinceImport: true }, edited: false, gone: false, ...over });
const ready = (over = {}) => feature({ busy: false, status: 'done', rounds: 3, state: 'ready', attachments: [],
  readiness: { ok: true, passed: 6, total: 6, checks: [], overridable: false }, ...over });

test('D7, D19: a criterion from SHOP-124 links to the ticket; one from a file stays the file tag', async () => {
  const m = await openFeature(ready());
  const tags = [...m.host.querySelectorAll('.req-src-tag')];
  assert.deepEqual([tags[0].tagName, tags[0].href, tags[0].target, tags[0].rel, tags[0].getAttribute('aria-label')],
    ['A', 'https://acme.test/browse/SHOP-124', '_blank', 'noopener', 'SHOP-124, opens the ticket in Jira in a new tab']);
  assert.equal(text(tags[1]), 'from refund-matrix.pdf');
  m.view.destroy();
});

test('D12, board 35: History names the import, linked or not', async () => {
  const m = await openFeature(ready({ export: XV({ history: [
    { action: 'imported', tracker: 'Jira', key: 'SHOP-124', url: LINK.url, when: '27 Oct, 09:12', by: 'Ann Example', linked: true, linkedTo: null },
    { action: 'imported', tracker: 'Jira', key: 'SHOP-123', url: 'https://acme.test/browse/SHOP-123', when: '27 Oct, 09:12', by: null, linked: false, linkedTo: 'FEAT-7' }] }) }));
  const lines = [...m.host.querySelectorAll('.req-history-list li')].map((li) => [text(li.firstChild), text(li.querySelector('.hint'))]);
  assert.deepEqual(lines, [['Imported SHOP-124 from Jira · 27 Oct, 09:12', 'Ann Example'], ['Started from SHOP-123 in Jira, not linked: FEAT-7 is. · 27 Oct, 09:12', null]]);
  m.view.destroy();
});

test('D11 (board 35): Export to Jira… on an imported feature without a setup opens "Export FEAT-8 to Jira" with the import\'s words', async () => {
  const m = await openFeature(ready(), { [`POST ${PREVIEW_URL}`]: () => AGAIN() });
  q('menu-export', m.host).click();
  q('mi-export', m.host).click();
  await settle();
  const dl = document.querySelector('.req-dlg-wrap [role="dialog"]');
  assert.equal(text(dl.querySelector('h2')), 'Export FEAT-8 to Jira');
  assert.equal(text(dl.querySelector('#req-again-desc')), 'FEAT-8 started from SHOP-124 on 27 Oct. The spec has changed since. What should happen?');
  const choice = (ui) => { const l = q(ui).closest('label'); return [text(l.querySelector('b')), text(l.querySelector('.hint'))]; };
  assert.deepEqual(choice('again-update'), ['Update SHOP-124',
    "Rewrites its summary, description and fields. Its description was written in Jira; Jira keeps the old text in the ticket's history."]);
  assert.deepEqual(choice('again-comment'), ['Add a comment to SHOP-124', 'Lists what changed since the import. The description stays.']);
  assert.equal(text(dl.querySelector('#req-again-chg')), 'What changed since the import (27 Oct)');
  assert.equal(m.calls.filter((c) => c.url.startsWith('/api/requirements/export-setup')).length, 0, 'no setup asked for');
  m.view.destroy();
});

test("D11: after the first export it is A6's dialog, saying when the ticket was imported", async () => {
  const after1 = { ...LINK, exportedAt: '2026-10-28T10:00:00Z', lastOn: '28 Oct', sinceImport: false };
  const m = await openFeature(ready({ export: XV({ link: after1 }) }), { [`POST ${PREVIEW_URL}`]: () => AGAIN({ link: { ...AGAIN().link, lastOn: '28 Oct', sinceImport: false } }) });
  q('menu-export', m.host).click();
  q('mi-export', m.host).click();
  await settle();
  const dl = document.querySelector('.req-dlg-wrap [role="dialog"]');
  assert.equal(text(dl.querySelector('h2')), 'Export FEAT-8 again');
  assert.equal(text(dl.querySelector('#req-again-desc')), 'SHOP-124 was imported on 27 Oct. The spec has changed since. What should happen?');
  assert.equal(text(dl.querySelector('#req-again-chg')), 'What changed since the last export (28 Oct)');
  m.view.destroy();
});

test('D11: Create a new ticket without a setup opens Set up export first, then the preview of a new ticket', async () => {
  const SETUP_URL = '/api/requirements/export-setup/project/shop-1';
  const m = await openFeature(ready(), {
    [`POST ${PREVIEW_URL}`]: (b) => (b.mode === 'new' ? AGAIN({ mode: 'new', key: null, link: null }) : AGAIN()),
    [`GET ${SETUP_URL}`]: { setup: null, trackers: [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira', multiProfile: true, profiles: [{ id: 'acme', label: 'acme.atlassian.net (Cloud)' }] }],
      defaultProfile: { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' } },
    [`POST ${SETUP_URL}/options`]: { projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }], issueTypes: [{ value: '10001', label: 'Story' }], priorities: [], criteriaFields: [], doneStatus: null },
    [`PUT ${SETUP_URL}`]: (b) => ({ setup: b }),
  });
  q('menu-export', m.host).click();
  q('mi-export', m.host).click();
  await settle();
  q('again-new', m.host.ownerDocument).click();
  q('again-continue', m.host.ownerDocument).click();
  await settle();
  assert.equal(text(document.querySelector('.req-dlg-wrap [role="dialog"] h2')), 'Set up export for shop');
  m.view.destroy();
});

// ── the review's fixes: the link, the copy, and a new ticket after a gone one ──
const SETUP_URL = '/api/requirements/export-setup/project/shop-1';
const SETUP_ROUTES = () => ({
  [`GET ${SETUP_URL}`]: { setup: null, trackers: [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira', multiProfile: true, profiles: [{ id: 'acme', label: 'acme.atlassian.net (Cloud)' }] }],
    defaultProfile: { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' } },
  [`POST ${SETUP_URL}/options`]: { projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }], issueTypes: [{ value: '10001', label: 'Story' }], priorities: [], criteriaFields: [], doneStatus: null },
  [`PUT ${SETUP_URL}`]: (b) => ({ setup: b }),
});
const NEWFIELDS = { conn: { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' }, connection: 'acme.atlassian.net (Cloud)', project: { value: 'SHOP', label: 'SHOP — Shop web' },
  issueType: { value: '10001', label: 'Story' }, labels: ['worca'], fixedLabel: 'worca-FEAT-8', priority: null, criteria: { target: 'description' }, summary: 'Partial cancel' };
const dlg = () => document.querySelector('.req-dlg-wrap [role="dialog"]');
const exportNow = async (m) => { q('menu-export', m.host).click(); q('mi-export', m.host).click(); await settle(); };
const previews = (m) => m.calls.filter((c) => c.method === 'POST' && c.url === PREVIEW_URL);

test('D11, board 29 (3): a ticket gone from Jira, no setup: New ticket opens Set up export first, then previews mode new', async () => {
  const m = await openFeature(ready(), { ...SETUP_ROUTES(),
    [`POST ${PREVIEW_URL}`]: (b) => AGAIN({ mode: b.mode, gone: b.mode !== 'new', ...(b.mode === 'new' ? { key: null, link: null, changes: [], fields: NEWFIELDS } : {}) }) });
  await exportNow(m);
  assert.equal(text(dlg().querySelector('[role="alert"]')), 'SHOP-124 no longer exists in Jira.');
  q('export-new').click();
  await settle();
  assert.equal(text(dlg().querySelector('h2')), 'Set up export for shop');
  assert.deepEqual(previews(m).map((c) => c.body.mode), ['update'], 'no new-ticket preview before the setup is saved');
  q('setup-save').click();
  await settle();
  assert.equal(previews(m).at(-1).body.mode, 'new');
  assert.equal(text(q('export-go')), 'Create in Jira');
  m.view.destroy();
});

test('D11: Create a new ticket without a setup: after the setup is saved the preview is asked with mode new', async () => {
  const m = await openFeature(ready(), { ...SETUP_ROUTES(),
    [`POST ${PREVIEW_URL}`]: (b) => (b.mode === 'new' ? AGAIN({ mode: 'new', key: null, link: null }) : AGAIN()) });
  await exportNow(m);
  q('again-new', m.host.ownerDocument).click();
  q('again-continue', m.host.ownerDocument).click();
  await settle();
  assert.equal(text(dlg().querySelector('h2')), 'Set up export for shop');
  assert.equal(previews(m).length, 1);
  q('setup-save').click();
  await settle();
  assert.deepEqual(previews(m).map((c) => c.body.mode), ['update', 'new']);
  m.view.destroy();
});

test('D11: a plain A6 link (made by an export) without a setup also opens the again dialog, not the setup', async () => {
  const plain = { ...LINK, origin: 'export', importedOn: null, sinceImport: false };
  const m = await openFeature(ready({ export: XV({ link: plain }) }), { [`POST ${PREVIEW_URL}`]: () => AGAIN({ link: { ...plain, key: 'SHOP-124' } }) });
  await exportNow(m);
  assert.equal(text(dlg().querySelector('h2')), 'Export FEAT-8 again');
  assert.equal(m.calls.filter((c) => c.url.startsWith('/api/requirements/export-setup')).length, 0);
  m.view.destroy();
});

test('D11: the dialog is titled from the feature before the preview loads, and from the preview once it has', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const m = await openFeature(ready(), { [`POST ${PREVIEW_URL}`]: async () => { await gate; return AGAIN({ link: { ...AGAIN().link, sinceImport: false, lastOn: '28 Oct' } }); } });
  await exportNow(m);
  assert.equal(text(dlg().querySelector('h2')), 'Export FEAT-8 to Jira', 'from the feature\'s link, still unexported');
  release();
  await settle();
  assert.equal(text(dlg().querySelector('h2')), 'Export FEAT-8 again', 'the preview says it was exported meanwhile');
  m.view.destroy();
});

test('D11: nothing changed since the import / since the last export: the exact words', async () => {
  let m = await openFeature(ready(), { [`POST ${PREVIEW_URL}`]: () => AGAIN({ changes: [] }) });
  await exportNow(m);
  assert.equal(text(dlg().querySelector('#req-again-desc')), 'FEAT-8 started from SHOP-124 on 27 Oct. The spec has not changed since the import.');
  m.view.destroy();
  m = await openFeature(ready(), { [`POST ${PREVIEW_URL}`]: () => AGAIN({ changes: [], link: { ...AGAIN().link, sinceImport: false, lastOn: '28 Oct' } }) });
  await exportNow(m);
  assert.equal(text(dlg().querySelector('#req-again-desc')), 'SHOP-124 was imported on 27 Oct. The spec has not changed since the last export (28 Oct).');
  m.view.destroy();
});

test('D7, D19: the ticket tag has its external icon, matches the key in any case, and a javascript: URL leaves the plain tag', async () => {
  let m = await openFeature(ready());
  assert.ok(m.host.querySelector('a.req-src-tag .ic svg'), 'the external icon');
  m.view.destroy();
  const lower = { ...SPEC, criteria: [{ ...SPEC.criteria[0], source: 'shop-124' }] };
  m = await openFeature(ready({ spec: lower }));
  const t = m.host.querySelector('.req-src-tag');
  assert.deepEqual([t.tagName, t.href], ['A', 'https://acme.test/browse/SHOP-124']);
  m.view.destroy();
  m = await openFeature(ready({ export: XV({ link: { ...LINK, url: 'javascript:alert(1)' } }) }));
  const tag = m.host.querySelector('.req-src-tag');
  assert.equal(tag.tagName === 'A' || m.host.querySelector('a[href^="javascript"]') !== null, false);
  assert.equal(text(tag), 'from SHOP-124');
  m.view.destroy();
});

test('D12: History\'s "Imported" line has the key as a link to the ticket', async () => {
  const m = await openFeature(ready());
  const a = m.host.querySelector('.req-history-list li a');
  assert.deepEqual([a.textContent, a.href, a.target, a.rel], ['SHOP-124', 'https://acme.test/browse/SHOP-124', '_blank', 'noopener']);
  m.view.destroy();
});
