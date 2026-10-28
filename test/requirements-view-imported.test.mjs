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
