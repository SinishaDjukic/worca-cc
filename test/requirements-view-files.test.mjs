// test/requirements-view-files.test.mjs — the Requirements page's files in jsdom with a fake API (plans/requirements-a8-design.md §6;
// design round 3, boards 15–21). Grows in Tasks 11–15.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#requirements' });
for (const k of ['document', 'location', 'Event', 'HTMLElement', 'window', 'File']) {
  Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
}
const asked = [];
let answer = true;
window.confirm = (q) => { asked.push(q); return answer; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i += 1) await tick(); };
after(() => window.close());
const { createRequirementsView, sizeText, uploadBatches } = await import('../ui/public/requirements-view.mjs');

function fakeApi(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ method, url, body: opts.body ? JSON.parse(opts.body) : undefined });
    const hit = routes[`${method} ${url}`];
    let body = typeof hit === 'function' ? hit() : hit;
    let status = body !== undefined ? 200 : 404;
    if (body && body.__status) { status = body.__status; body = body.body; }
    return { ok: status < 400, status, json: async () => body ?? { error: 'not found' }, text: async () => '# md' };
  };
  return calls;
}
const make = () => {
  const host = document.createElement('div'); const msgEl = document.createElement('p'); const subEl = document.createElement('div');
  document.body.replaceChildren(host);   // one page in the document: jsdom's '#id' lookups go through the document
  const routed = [];
  const view = createRequirementsView({ host, subEl, msgEl, deps: { route: (p) => routed.push(p) } });
  return { host, msgEl, view, routed };
};
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const mkFile = (name, content, type = 'text/plain') => new window.File([content], name, { type });
const drop = (el, files) => { const ev = new window.Event('drop', { bubbles: true, cancelable: true }); ev.dataTransfer = { types: ['Files'], files }; el.dispatchEvent(ev); };
const pick = (input, files) => { Object.defineProperty(input, 'files', { value: files, configurable: true }); input.dispatchEvent(new window.Event('change')); };

const INTERVIEW = { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium', source: 'default' };
const BASE = { 'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop' }] }, 'GET /api/workspaces': { workspaces: [] } };
const LIST = { features: [], lookCostUsd: null, spend: { windowUsd: 0, totalLimitUsd: null }, interview: INTERVIEW, briefs: [],
  readEstimates: { text: null, image: null, binary: null } };
const CHECKS = (ok) => ['goal', 'criteria', 'interview', 'openQuestions', 'assumptions', 'target'].map((key) => ({ key, ok, label: key, hint: ok ? '' : 'not yet' }));
const readiness = (ok = false) => ({ ok, passed: ok ? 6 : 0, total: 6, checks: CHECKS(ok), overridable: false });
const att = (over = {}) => ({ id: 'ratt_00000000000a', name: 'support-tickets.pdf', kind: 'binary', mime: 'application/pdf', bytes: Math.round(2.1 * 1024 * 1024),
  status: 'done', error: null, summary: '52 support tickets from September asking to cancel an order.', summaryEdited: false, asks: [], history: [],
  sendWithRun: false, costUsd: 0.12, readAt: '2026-10-20T10:00:00Z', readModel: 'claude-opus-5-5', estimateUsd: 0.12, mentions: [],
  href: '/api/requirements/4/attachments/ratt_00000000000a', ...over });
const feature = (over = {}) => ({ seq: 4, id: 'FEAT-4', scopeType: 'project', scopeKey: 'shop-1', title: 'Cancel order', status: 'your_turn', rounds: 1,
  costUsd: 0.31, busy: false, orientation: { summary: 'Orders have a status.', files: [], skipped: null },
  spec: { goal: { text: 'Cancel', measure: '' }, actors: [], flow: [], edgeCases: [], rules: [], outOfScope: [],
    criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }], assumptions: [], openQuestions: [], edited: {} },
  pending: null, lastError: null, state: 'your_turn', readiness: readiness(), starts: [], unaskedRejections: [], changedSinceStart: [],
  attachments: [att()], briefDocuments: [], unaskedFiles: [], interview: INTERVIEW, resetPeriod: 'monthly', ...over });
const openFeature = async (f, extra = {}) => {
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns: [] }), ...extra });
  const m = make();
  await m.view.show('feature/4');
  return { ...m, calls };
};
const openNew = async (list = LIST, extra = {}) => {
  const calls = fakeApi({ ...BASE, 'GET /api/requirements': list, ...extra });
  const m = make();
  await m.view.show('new');
  return { ...m, calls, zone: m.host.querySelector('.req-new-files .req-drop') };
};
/** Every selector's first rule sits inside the Requirements block (before marketplace P3); those rules use tokens only. */
function assertInRequirementsBlock(selectors) {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  assert.ok(start > 0 && end > start, 'the block markers');
  for (const sel of selectors) {
    const at = css.indexOf(sel);
    assert.ok(at > start && at < end, `${sel} inside the Requirements block`);
  }
  const lines = css.slice(start, end).split('\n').filter((l) => selectors.some((s) => l.includes(s)));
  assert.ok(lines.every((l) => !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l)), 'tokens only');
}

// ── board 15: New feature with files ─────────────────

test('board 15: a Files field after Describe it: the drop zone, its limits, the privacy note naming the model; no chips yet', async () => {
  const { host, zone } = await openNew();
  const ids = [...host.querySelectorAll('.req-new .field > label')].map((l) => l.getAttribute('for'));
  assert.deepEqual(ids, ['req-new-title', 'req-new-desc', 'req-new-files-input', 'req-new-target']);
  assert.equal(text(host.querySelector('.req-new-files > label')), 'Files optional: emails, a spec, screenshots, a mockup');
  assert.equal(zone.firstChild.textContent, 'Drop files here, paste them, or ');
  assert.equal(zone.querySelector('.link-btn').textContent, 'Choose files');
  assert.equal(zone.querySelector('.hint').textContent, 'Text, images and PDF · up to 10 files, 25 MB each');
  assert.equal(host.querySelector('.req-new-files .req-files-privacy').textContent,
    'Worca sends each file to Opus 5.5 to read it. Text is checked for keys and passwords first; images and PDFs go as they are.');
  assert.equal(host.querySelectorAll('.req-new-chip').length, 0);
  assert.equal(host.querySelector('.req-new-files-note').hidden, true);
});

test('board 15: without the interview model the privacy note says "the interview model"', async () => {
  const { host } = await openNew({ ...LIST, interview: null });
  assert.match(host.querySelector('.req-files-privacy').textContent, /^Worca sends each file to the interview model to read it\./);
});

test('board 15: dropped files become chips (name, kind · size, ×); a refused one shows the amber alert and is not added', async () => {
  const { host, zone } = await openNew();
  drop(zone, [mkFile('tickets.pdf', '%PDF-1.7 x', 'application/pdf'), mkFile('plan.docx', 'x'), mkFile('notes.md', '# n')]);
  const chips = [...host.querySelectorAll('.req-new-chip')];
  assert.deepEqual(chips.map((c) => c.querySelector('.req-new-chip-name').textContent), ['tickets.pdf', 'notes.md']);
  assert.equal(chips[0].querySelector('.hint').textContent, 'PDF · 10 B');
  assert.equal(chips[1].querySelector('.hint').textContent, 'Text · 3 B');
  assert.equal(chips[0].querySelector('button').getAttribute('aria-label'), 'Remove tickets.pdf');
  const alert = host.querySelector('.req-new-files .req-file-refused');
  assert.deepEqual([alert.getAttribute('role'), alert.hidden, alert.textContent],
    ['alert', false, 'plan.docx was not added: Worca reads text, images and PDF. Save it as PDF to attach it here.']);
  assert.equal(host.querySelector('.req-new-files-note').hidden, false);
  assert.equal(host.querySelector('.req-new-files-note').textContent, 'Files stay on the feature. Which files go with a run is chosen later, on the feature page.');
  chips[0].querySelector('button').click();
  assert.deepEqual([...host.querySelectorAll('.req-new-chip-name')].map((c) => c.textContent), ['notes.md']);
});

test('board 15: with files the cost words say each file is read once before round 1, about $X a file; "$0.05–0.20" without estimates', async () => {
  const { host, zone } = await openNew({ ...LIST, lookCostUsd: 0.25, readEstimates: { text: 0.05, image: null, binary: 0.12 } });
  const cost = () => host.querySelector('.req-new-cost').textContent;
  assert.equal(cost(), 'Worca interviews with Opus 5.5 at medium effort · about $0.25 for the code look, then cents per round');
  drop(zone, [mkFile('a.md', 'a')]);
  assert.equal(cost(), 'Worca interviews with Opus 5.5 at medium effort · about $0.25 for the code look, reads each file once before round 1, about $0.05 a file, then cents per round');
  drop(zone, [mkFile('b.pdf', '%PDF-1.7', 'application/pdf')]);
  assert.match(cost(), / · about \$0\.25 for the code look, reads each file once before round 1, about \$0\.05–0\.12 a file, then cents per round$/);
  const none = await openNew({ ...LIST, readEstimates: { text: null, image: null, binary: null } });
  drop(none.zone, [mkFile('c.png', 'png', 'image/png')]);
  assert.equal(none.host.querySelector('.req-new-cost').textContent, 'Worca interviews with Opus 5.5 at medium effort · reads each file once before round 1, about $0.05–0.20 a file, then cents per round');
  const a2 = await openNew({ ...LIST, interview: null, lookCostUsd: null });
  assert.equal(a2.host.querySelector('.req-new-cost'), null, "A2's page without a look estimate has no cost line");
  drop(a2.zone, [mkFile('d.md', 'd')]);
  assert.equal(a2.host.querySelector('.req-new-cost').textContent, 'Reads each file once before round 1, about $0.05–0.20 a file, then cents per round.');
});

test('board 15: Start the interview sends the files with the create call', async () => {
  const { host, zone, calls, routed } = await openNew(LIST, { 'POST /api/requirements': { feature: { seq: 9 } } });
  host.querySelector('#req-new-title').value = 'Cancel';
  host.querySelector('#req-new-desc').value = 'Before it ships';
  drop(zone, [mkFile('notes.md', '# n')]);
  [...host.querySelectorAll('.req-new .btn-primary')].at(-1).click();
  await settle();
  const post = calls.find((c) => c.method === 'POST' && c.url === '/api/requirements');
  assert.deepEqual(post.body.attachments, [{ name: 'notes.md', dataBase64: Buffer.from('# n').toString('base64') }]);
  assert.deepEqual(routed, ['feature/9']);
});

test('the feature page says "Reading N files…" (role=status) until round 1 starts', async () => {
  const reading = [att({ status: 'reading' }), att({ id: 'ratt_00000000000b', name: 'b.md', kind: 'text', status: 'reading' })];
  const { host } = await openFeature(feature({ status: 'looking', state: 'looking', busy: true, rounds: 0, attachments: reading }));
  const line = host.querySelector('.req-reading');
  assert.equal(line.getAttribute('role'), 'status');
  assert.equal(line.querySelector('.badge.blue').textContent, 'Reading 2 files…');
  assert.equal(text(line), 'Reading 2 files… Worca reads the files first, then shows round 1.');
  assert.equal(host.querySelector('.req-working'), null);
  const later = await openFeature(feature({ status: 'thinking', state: 'thinking', busy: true, rounds: 1, attachments: reading }));
  assert.equal(later.host.querySelector('.req-reading'), null, 'after round 1: the ordinary working line');
});

test('sizes and the upload batches (at most 100 MB per request)', () => {
  assert.deepEqual([sizeText(640), sizeText(9 * 1024), sizeText(Math.round(2.1 * 1024 * 1024))], ['640 B', '9 KB', '2.1 MB']);
  const MB = 1024 * 1024;
  const b = uploadBatches([{ size: 60 * MB }, { size: 60 * MB }, { size: 30 * MB }, { size: 5 }]);
  assert.deepEqual(b.map((x) => x.length), [1, 3]);
});

test('board 15: a file the server could not store is named on the feature page the create routes to', async () => {
  const { host, zone, view, msgEl } = await openNew(LIST, { 'POST /api/requirements': { feature: { seq: 4 }, filesNotStored: ['b.md'] },
    'GET /api/requirements/4': () => ({ feature: feature(), turns: [] }) });
  host.querySelector('#req-new-title').value = 'Cancel';
  drop(zone, [mkFile('a.md', 'a'), mkFile('b.md', 'b')]);
  [...host.querySelectorAll('.req-new .btn-primary')].at(-1).click();
  await settle();
  await view.show('feature/4');
  assert.deepEqual([msgEl.textContent, msgEl.className], ['b.md was not added: Worca could not store it. Add it on the feature page.', 'form-msg req-msg-warn'],
    'its own amber pair (--amber-ink-strong on --amber-bg, AA), not the shared .form-msg.warn');
  await view.show('feature/4');
  assert.equal(msgEl.textContent, '', 'said once');
});

test('board 15: removing a chip hands the focus to the next chip, then Choose files; a refusal keeps the chips', async () => {
  const { host, zone } = await openNew();
  drop(zone, [mkFile('a.md', 'a'), mkFile('b.md', 'b')]);
  host.querySelector('.req-new-chip-x').click();
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Remove b.md');
  document.activeElement.click();
  assert.equal(document.activeElement.textContent, 'Choose files');
  const input = host.querySelector('#req-new-files-input');
  assert.deepEqual([input.type, input.multiple, input.hidden], ['file', true, true]);
  pick(input, [mkFile('c.md', 'c'), mkFile('d.exe', 'x')]);
  assert.deepEqual([...host.querySelectorAll('.req-new-chip-name')].map((c) => c.textContent), ['c.md']);
  assert.equal(host.querySelector('.req-file-refused').textContent, 'd.exe was not added: Worca reads text, images and PDF.');
  assert.equal(host.querySelector('.req-file-refused b').textContent, 'd.exe');
  drop(zone, [mkFile('e.md', 'e')]);
  assert.equal(host.querySelector('.req-file-refused').hidden, true, 'a clean pick clears the alert');
  assert.equal(zone.getAttribute('tabindex'), '0');
});

test('board 15: a second press of Start the interview while the files are sent posts once', async () => {
  const { host, zone, calls } = await openNew(LIST, { 'POST /api/requirements': { feature: { seq: 9 } } });
  host.querySelector('#req-new-title').value = 'Cancel';
  drop(zone, [mkFile('notes.md', '# n')]);
  const go = [...host.querySelectorAll('.req-new .btn-primary')].at(-1);
  go.click();
  go.click();
  await settle();
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url === '/api/requirements').length, 1);
});

test('a11y: Enter or Space on the focused drop zone opens the file picker; a key on Choose files does not open it twice', async () => {
  const { host, zone } = await openNew();
  const input = host.querySelector('#req-new-files-input');
  let opened = 0;
  input.click = () => { opened += 1; };
  const key = (el, k) => { const ev = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev; };
  assert.equal(key(zone, 'Enter').defaultPrevented, true);
  assert.equal(opened, 1);
  assert.equal(key(zone, ' ').defaultPrevented, true);
  assert.equal(opened, 2);
  key(zone, 'a');
  assert.equal(opened, 2, 'other keys do nothing');
  key(zone.querySelector('.link-btn'), 'Enter');
  assert.equal(opened, 2, 'the button keeps its own Enter (its click opens the picker)');
});

test('a11y: the drop zone is described by the optional hint, its limits and the privacy note', async () => {
  const { host, zone } = await openNew();
  const ids = zone.getAttribute('aria-describedby').split(' ');
  assert.deepEqual(ids.map((id) => host.querySelector(`#${id}`)?.textContent), [
    'optional: emails, a spec, screenshots, a mockup',
    'Text, images and PDF · up to 10 files, 25 MB each',
    'Worca sends each file to Opus 5.5 to read it. Text is checked for keys and passwords first; images and PDFs go as they are.']);
});

test('a11y: the reading line is one role=status node across paints, so 2 → 1 is announced in place', async () => {
  const reading = (n) => Array.from({ length: n }, (_, i) => att({ id: `ratt_00000000000${i}`, name: `f${i}.md`, kind: 'text', status: 'reading' }));
  let f = feature({ status: 'looking', state: 'looking', busy: true, rounds: 0, attachments: reading(2) });
  const { host, view } = await openFeature(null, { 'GET /api/requirements/4': () => ({ feature: f, turns: [] }) });
  const line = host.querySelector('.req-reading');
  assert.equal(line.querySelector('.badge').textContent, 'Reading 2 files…');
  f = feature({ status: 'looking', state: 'looking', busy: true, rounds: 0, attachments: [...reading(1), att()] });
  await view.changed(4);
  assert.equal(host.querySelector('.req-reading'), line, 'the same node');
  assert.equal(line.getAttribute('role'), 'status');
  assert.equal(line.querySelector('.badge').textContent, 'Reading 1 file…');
  f = feature({ status: 'your_turn', state: 'your_turn', rounds: 1, attachments: [att()] });
  await view.changed(4);
  assert.equal(host.querySelector('.req-reading'), null);
});

test('board 15: a refused create says why in the message region and stays on the form', async () => {
  const { host, zone, msgEl, routed } = await openNew(LIST, { 'POST /api/requirements': { __status: 409, body: { error: 'Try again in a moment.' } } });
  host.querySelector('#req-new-title').value = 'Cancel';
  drop(zone, [mkFile('notes.md', '# n')]);
  [...host.querySelectorAll('.req-new .btn-primary')].at(-1).click();
  await settle();
  assert.deepEqual([msgEl.textContent, msgEl.className], ['Try again in a moment.', 'form-msg err']);
  assert.deepEqual(routed, []);
  assert.equal(host.querySelectorAll('.req-new-chip').length, 1, 'the picked files stay');
});

test('style.css: board 15 rules inside the Requirements block, tokens only', () => {
  assertInRequirementsBlock(['.req-new-files', '.req-drop', '.req-new-chip', '.req-file-refused', '.req-reading', '.req-files-privacy', '.req-msg-warn']);
});

// ── board 16: the Files card ─────────────────

test('board 16: the Files card follows Ready to start? in the right column; head, hint, Add files, the privacy note; the header chip "N files"', async () => {
  const { host } = await openFeature(feature());
  const right = host.querySelector('.req-right');
  const card = right.querySelector('section[aria-label="Files"]');
  assert.ok(right.firstElementChild.classList.contains('req-ready'), "A2's Ready panel stays first (test/requirements-view.test.mjs, \"first in the right column\")");
  assert.equal(card.previousElementSibling, right.querySelector('.req-ready'), 'the Files card comes right after it, as boards 16 and 18 place it');
  assert.equal(card.querySelector('h3').textContent, 'Files · 1');
  assert.equal(card.querySelector('.req-files-head .hint').textContent, 'Worca reads each one once and uses what it took from it in every round.');
  assert.equal(card.querySelector('[data-ui="files-add"]').textContent, 'Add files');
  assert.ok(card.querySelector('.req-files-privacy'));
  assert.ok([...host.querySelectorAll('.req-chips .chip')].some((c) => c.textContent === '1 file'));
});

test('board 16: a read file: the name opens it, kind · size · read for $X, the pencil, What Worca took from it, the switch', async () => {
  const long = 'x'.repeat(300);
  const { host, calls } = await openFeature(feature({ attachments: [att({ summary: long, mentions: ['R-po-1'],
    asks: [{ question: 'What about refunds?', answer: '4 ask for store credit.' }] })] }), { 'PATCH /api/requirements/4/attachments/ratt_00000000000a': { feature: feature(), turns: [] } });
  const row = host.querySelector('.req-file[data-file="ratt_00000000000a"]');
  const name = row.querySelector('.req-file-name');
  assert.deepEqual([name.textContent, name.getAttribute('href'), name.getAttribute('target')], ['support-tickets.pdf', '/api/requirements/4/attachments/ratt_00000000000a', '_blank']);
  assert.equal(row.querySelector('.req-file-meta').textContent, 'PDF · 2.1 MB · read for $0.12');
  assert.equal(row.querySelector('.req-file-pencil').getAttribute('aria-label'), 'Edit what Worca took from support-tickets.pdf');
  assert.equal(row.querySelector('.req-file-cap').textContent, 'What Worca took from it');
  assert.ok(row.querySelector('.req-file-took').classList.contains('req-clamp'));
  row.querySelector('.req-file-all').click();
  assert.ok(!host.querySelector('.req-file[data-file="ratt_00000000000a"] .req-file-took').classList.contains('req-clamp'));
  assert.equal(text(host.querySelector('.req-file-ask')), 'Q: What about refunds? 4 ask for store credit.');
  const sw = host.querySelector('[data-ui="file-send-ratt_00000000000a"]');
  assert.deepEqual([sw.getAttribute('role'), sw.getAttribute('aria-label'), sw.checked], ['switch', 'Send support-tickets.pdf with the run', false]);
  assert.equal(text(sw.closest('.req-file-send')), 'Send with the run The spec mentions this file (R-po-1).');
  sw.checked = true;
  sw.dispatchEvent(new window.Event('change'));
  await settle();
  assert.deepEqual(calls.filter((c) => c.method === 'PATCH').map((c) => c.body), [{ sendWithRun: true }]);
});

test('board 16: "· edited by you"; the pencil opens the editor, Save sends the text (1500 at most), Cancel closes', async () => {
  const route = 'PATCH /api/requirements/4/attachments/ratt_00000000000a';
  const { host, calls } = await openFeature(feature({ attachments: [att({ summaryEdited: true })] }), { [route]: { feature: feature(), turns: [] } });
  assert.equal(text(host.querySelector('.req-file-cap')), 'What Worca took from it · edited by you');
  host.querySelector('.req-file-pencil').click();
  const ta = host.querySelector('[data-ui="file-edit-text-ratt_00000000000a"]');
  assert.deepEqual([ta.value, ta.getAttribute('maxlength'), document.activeElement === ta], [att().summary, '1500', true]);
  ta.value = 'Mine.';
  ta.dispatchEvent(new window.Event('input'));
  host.querySelector('[data-ui="file-save-ratt_00000000000a"]').click();
  await settle();
  assert.deepEqual(calls.filter((c) => c.method === 'PATCH').map((c) => c.body), [{ summary: 'Mine.' }]);
});

test('board 16: reading (with and without an estimate), failed with each reason and Try again, not read yet for a month or a week', async () => {
  const states = [
    att({ id: 'ratt_000000000001', name: 'r.md', status: 'reading', summary: '' }),
    att({ id: 'ratt_000000000002', name: 'r2.md', status: 'reading', summary: '', estimateUsd: null }),
    att({ id: 'ratt_000000000003', name: 'f.pdf', status: 'failed', summary: '', error: { code: 'TIMEOUT', message: 'Worca got no reply within 180 seconds. Try again.' } }),
    att({ id: 'ratt_000000000004', name: 'g.pdf', status: 'failed', summary: '', error: { code: 'BAD_REPLY', message: 'x' } }),
    att({ id: 'ratt_000000000005', name: 'h.pdf', status: 'failed', summary: '', error: { code: 'INTERRUPTED', message: 'x' } }),
    att({ id: 'ratt_000000000006', name: 'i.pdf', status: 'failed', summary: '', error: { code: 'FAILED', message: 'the file could not be opened.' } }),
    att({ id: 'ratt_000000000007', name: 'u.md', status: 'unread-budget', summary: '' }),
  ];
  const again = 'POST /api/requirements/4/attachments/ratt_000000000003/read-again';
  const { host, calls } = await openFeature(feature({ attachments: states.map((a) => ({ ...a, href: `/api/requirements/4/attachments/${a.id}` })) }), { [again]: { feature: feature(), turns: [] } });
  const row = (id) => host.querySelector(`.req-file[data-file="${id}"]`);
  const badge = row('ratt_000000000001').querySelector('.badge.blue');
  assert.deepEqual([badge.textContent, badge.getAttribute('role')], ['Reading…', 'status']);
  assert.equal(row('ratt_000000000001').querySelector('.req-file-state').textContent, 'Worca is reading it (about $0.12). The next round uses it.');
  assert.equal(row('ratt_000000000002').querySelector('.req-file-state').textContent, 'Worca is reading it. The next round uses it.');
  const failed = (id) => row(id).querySelector('.req-file-failed');
  assert.equal(failed('ratt_000000000003').getAttribute('role'), 'alert');
  assert.equal(text(failed('ratt_000000000003')), 'Worca could not read this file: it ran out of time. The interview lists it by name only. Try again');
  assert.match(text(failed('ratt_000000000004')), /: its reply could not be read\. /);
  assert.match(text(failed('ratt_000000000005')), /: Worca restarted\. /);
  assert.match(text(failed('ratt_000000000006')), /: the file could not be opened\. The interview/);
  failed('ratt_000000000003').querySelector('button').click();
  await settle();
  assert.ok(calls.some((c) => c.method === 'POST' && c.url.endsWith('/ratt_000000000003/read-again')));
  assert.equal(row('ratt_000000000007').querySelector('.badge.amber').textContent, 'Not read yet');
  assert.equal(row('ratt_000000000007').querySelector('.req-file-state').textContent,
    'The Requirements budget is used up for this month. Worca reads it when the budget allows; until then the interview lists it by name only.');
  const week = await openFeature(feature({ resetPeriod: 'weekly', attachments: [states[6]] }));
  assert.match(week.host.querySelector('.req-file-state').textContent, /used up for this week\./);
  for (const id of ['ratt_000000000001', 'ratt_000000000003', 'ratt_000000000007']) assert.equal(row(id).querySelector('.req-file-pencil'), null, id);
  // D1: every file has its switch, except while it is being read (a file Worca could not read may still go to the run)
  assert.equal(row('ratt_000000000001').querySelector('[data-ui="file-send-ratt_000000000001"]'), null, 'not while reading');
  for (const id of ['ratt_000000000003', 'ratt_000000000007']) assert.ok(row(id).querySelector(`[data-ui="file-send-${id}"]`), id);
});

test('board 16: no files yet; Add files is disabled while the feature is busy or archived; the history folds at the advanced level', async () => {
  const empty = await openFeature(feature({ attachments: [] }));
  assert.equal(empty.host.querySelector('.req-files-empty').textContent, 'No files yet. Add emails, a spec, screenshots or a mockup.');
  const busy = await openFeature(feature({ busy: true, status: 'thinking', state: 'thinking' }));
  assert.equal(busy.host.querySelector('[data-ui="files-add"]').disabled, true);
  const old = await openFeature(feature({ attachments: [att({ history: [{ at: '2026-10-19T08:00:00Z', name: 'old.pdf', summary: 'Before.', reason: 'replaced' }] })] }));
  const h = old.host.querySelector('.req-file-history');
  assert.deepEqual([h.tagName, h.getAttribute('data-min-level'), h.querySelector('summary').textContent], ['DETAILS', 'advanced', 'Earlier text (1)']);
  assert.equal(text(h.querySelector('li')), '2026-10-19 · old.pdf Before.');
});

test('board 16: Add files posts the accepted picks and names the refused ones in the card', async () => {
  const add = 'POST /api/requirements/4/attachments';
  const { host, calls } = await openFeature(feature(), { [add]: { feature: feature(), turns: [] } });
  pick(host.querySelector('.req-files input[type="file"]'), [mkFile('notes.md', '# n'), mkFile('deck.pptx', 'x')]);
  await settle();
  const post = calls.find((c) => c.method === 'POST' && c.url === '/api/requirements/4/attachments');
  assert.deepEqual(post.body.attachments.map((x) => x.name), ['notes.md']);
  assert.equal(host.querySelector('.req-files .req-file-refused').textContent, 'deck.pptx was not added: Worca reads text, images and PDF. Save it as PDF to attach it here.');
});

test('a question that came from a file says "From <name>:" before its why; What Worca knows says "and the files below"', async () => {
  const q = [{ id: 'when', question: 'Until when?', options: ['Label', 'Pick-up'], recommended: 'Label', why: '38 of the 52 tickets came before pick-up.', source: 'support-tickets.pdf' }];
  const brief = { id: 3, status: 'ready', madeAt: new Date().toISOString(), sources: [], matches: ['Orders'], matchesMore: 0, lookAtCode: true };
  const { host } = await openFeature(feature({ pending: { turnId: 9, questions: q, note: '' }, brief, orientation: { summary: '', files: [], skipped: 'brief' } }));
  assert.equal(text(host.querySelector('.req-why')), 'From support-tickets.pdf: 38 of the 52 tickets came before pick-up.');
  assert.equal(host.querySelector('.req-knows-text').textContent,
    'Worca works from the shop brief and the files below. Orders is described in the brief. It has not looked at the code for this feature.');
});

// The brief asserted `.req-files .btn,…{min-height:44px}`; upstream's design-language test bans a 44px height on a
// control (OFF_SCALE), so the 44 px targets are hit areas past the visible control (Task 11's pattern).
test('style.css: the Files card rules (and the phone rules) inside the Requirements block, tokens only', () => {
  assertInRequirementsBlock(['.req-files{', '.req-file{', '.req-file-top', '.req-file-took', '.req-clamp', '.req-file-failed', '.req-file-history', '.req-file-send']);
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width:600px\)\{[^}]*\.req-file-top\{flex-wrap:wrap\}/);
  assert.match(css, /\.req-files \.btn-sm::after\{content:"";position:absolute;inset:-9px 0\}/, 'a 28px button: 9px past its 26px padding box, above and below');
  assert.match(css, /\.req-files \.switch-row::after\{content:"";position:absolute;inset:-8px 0\}/, 'the 28px switch row');
  assert.match(css, /\.req-files \.req-ico::after\{content:"";position:absolute;inset:-8px\}/, 'a 28px icon button: 44 x 44');
});

// ── boards 16 / 20: Task 12's own checks (the ⋯ menu, focus, live regions, uploads, XSS, flag off) ─────────────────

test("board 16/20: a file's ⋯ is named for it and opens a menu with Open and Edit what Worca took from it (the pencil at phone width)", async () => {
  const { host } = await openFeature(feature());
  const trigger = host.querySelector('[data-ui="file-more-ratt_00000000000a"]');
  assert.deepEqual([trigger.getAttribute('aria-label'), trigger.getAttribute('aria-haspopup'), trigger.getAttribute('aria-expanded')],
    ['More for support-tickets.pdf', 'menu', 'false']);
  trigger.click();
  const list = host.querySelector('[data-menu="file-ratt_00000000000a"] [role="menu"]');
  assert.equal(list.hidden, false);
  assert.ok(list.classList.contains('menu'));
  assert.deepEqual([...list.querySelectorAll('[role="menuitem"]')].slice(0, 2).map((x) => x.textContent), ['Open', 'Edit what Worca took from it']);
  const open = list.querySelector('a[role="menuitem"]');
  assert.deepEqual([open.getAttribute('href'), open.getAttribute('target'), open.className], ['/api/requirements/4/attachments/ratt_00000000000a', '_blank', 'menu-item req-menu-item']);
  list.children[1].click();
  assert.equal(document.activeElement, host.querySelector('[data-ui="file-edit-text-ratt_00000000000a"]'), 'the editor takes the focus');
  const reading = await openFeature(feature({ attachments: [att({ status: 'reading', summary: '' })] }));
  reading.host.querySelector('[data-ui="file-more-ratt_00000000000a"]').click();
  assert.deepEqual([...reading.host.querySelectorAll('[data-menu="file-ratt_00000000000a"] [role="menuitem"]')].map((x) => x.textContent), ['Open', 'Remove']);
});

test('a11y: the focus after Save and Cancel goes back to the pencil, after Show all to the text, after Try again to the file name', async () => {
  const route = 'PATCH /api/requirements/4/attachments/ratt_00000000000a';
  const { host } = await openFeature(feature({ attachments: [att({ summary: 'y'.repeat(300) })] }), { [route]: { feature: feature(), turns: [] } });
  host.querySelector('.req-file-pencil').click();
  [...host.querySelectorAll('.req-file-edit button')].find((b) => b.textContent === 'Cancel').click();
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-edit-ratt_00000000000a', 'Cancel');
  host.querySelector('.req-file-pencil').click();
  host.querySelector('[data-ui="file-save-ratt_00000000000a"]').click();
  await settle();
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-edit-ratt_00000000000a', 'Save');
  host.querySelector('.req-file-all').click();
  assert.equal(document.activeElement, host.querySelector('.req-file-took'), 'Show all: the whole text takes the focus');
  assert.equal(document.activeElement.getAttribute('tabindex'), '-1');
  const failed = att({ status: 'failed', summary: '', error: { code: 'TIMEOUT', message: 'x' } });
  const f2 = await openFeature(feature({ attachments: [failed] }), { 'POST /api/requirements/4/attachments/ratt_00000000000a/read-again': { feature: feature(), turns: [] } });
  f2.host.querySelector('[data-ui="file-retry-ratt_00000000000a"]').click();
  await settle();
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-name-ratt_00000000000a');
});

test('a11y: the switch keeps the focus across the repaint its PATCH causes; Add files has it back after an upload', async () => {
  const { host } = await openFeature(feature(), { 'PATCH /api/requirements/4/attachments/ratt_00000000000a': { feature: feature(), turns: [] },
    'POST /api/requirements/4/attachments': { feature: feature(), turns: [] } });
  const sw = host.querySelector('[data-ui="file-send-ratt_00000000000a"]');
  sw.focus();
  sw.checked = true;
  sw.dispatchEvent(new window.Event('change'));
  await settle();
  assert.notEqual(host.querySelector('[data-ui="file-send-ratt_00000000000a"]'), sw, 'repainted');
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-send-ratt_00000000000a');
  pick(host.querySelector('.req-files input[type="file"]'), [mkFile('notes.md', '# n')]);
  await settle();
  assert.equal(document.activeElement.getAttribute('data-ui'), 'files-add');
});

test("a11y: a failed line and the refusal line stay the same role=alert nodes across repaints; a read result is said in the card's status line", async () => {
  let f = feature({ attachments: [att({ id: 'ratt_000000000001', name: 'r.md', status: 'reading', summary: '' }),
    att({ id: 'ratt_000000000002', name: 'f.pdf', status: 'failed', summary: '', error: { code: 'TIMEOUT', message: 'x' } }),
    att({ id: 'ratt_000000000003', name: 'u.md', status: 'reading', summary: '' })] });
  const { host, view } = await openFeature(null, { 'GET /api/requirements/4': () => ({ feature: f, turns: [] }) });
  const alertNode = host.querySelector('.req-file-failed');
  const live = host.querySelector('.req-files-live');
  assert.deepEqual([live.getAttribute('role'), live.classList.contains('sr-only'), live.textContent], ['status', true, '']);
  pick(host.querySelector('.req-files input[type="file"]'), [mkFile('deck.pptx', 'x')]);
  const refused = host.querySelector('.req-files .req-file-refused');
  assert.deepEqual([refused.getAttribute('role'), refused.hidden], ['alert', false]);
  f = feature({ attachments: [att({ id: 'ratt_000000000001', name: 'r.md' }),
    att({ id: 'ratt_000000000002', name: 'f.pdf', status: 'failed', summary: '', error: { code: 'TIMEOUT', message: 'x' } }),
    att({ id: 'ratt_000000000003', name: 'u.md', status: 'unread-budget', summary: '' })] });
  await view.changed(4);
  assert.equal(host.querySelector('.req-file-failed'), alertNode, 'the same failed line');
  assert.equal(host.querySelector('.req-files .req-file-refused'), refused, 'the same refusal line');
  assert.equal(host.querySelector('.req-files-live'), live, 'the same status line');
  assert.equal(live.textContent, 'Worca read r.md. u.md: Not read yet.');
  await view.changed(4);
  assert.equal(live.textContent, 'Worca read r.md. u.md: Not read yet.', 'a repaint with no change says nothing new');
});

test('uploads: a pick over 100 MB goes in two requests; the server\'s 409 "Try again in a moment." is shown', async () => {
  const MB = 1024 * 1024;
  const big = (n) => ({ name: `part-${n}.pdf`, size: 24 * MB, type: 'application/pdf', arrayBuffer: async () => new Uint8Array([0x25, 0x50]).buffer });
  const { host, calls } = await openFeature(feature(), { 'POST /api/requirements/4/attachments': { feature: feature(), turns: [] } });
  pick(host.querySelector('.req-files input[type="file"]'), [1, 2, 3, 4, 5].map(big));
  await settle();
  const posts = calls.filter((c) => c.method === 'POST' && c.url === '/api/requirements/4/attachments');
  assert.deepEqual(posts.map((p) => p.body.attachments.map((x) => x.name)), [['part-1.pdf', 'part-2.pdf', 'part-3.pdf', 'part-4.pdf'], ['part-5.pdf']]);
  const busy = await openFeature(feature(), { 'POST /api/requirements/4/attachments': { __status: 409, body: { error: 'Try again in a moment.' } } });
  pick(busy.host.querySelector('.req-files input[type="file"]'), [mkFile('notes.md', '# n')]);
  await settle();
  assert.deepEqual([busy.msgEl.textContent, busy.msgEl.className], ['Try again in a moment.', 'form-msg err']);
});

test('XSS: a file name and a summary are text, never markup', async () => {
  const evil = '<img src=x onerror=alert(1)>.md';
  const { host } = await openFeature(feature({ attachments: [att({ name: evil, summary: '<script>alert(1)</script><b>bold</b>', mentions: ['R-po-1'] })] }));
  assert.equal(host.querySelector('.req-files img'), null);
  assert.equal(host.querySelector('.req-files script'), null);
  assert.equal(host.querySelector('.req-files .req-file-took b'), null);
  assert.equal(host.querySelector('.req-file-name').textContent, evil);
  assert.equal(host.querySelector('.req-file-pencil').getAttribute('aria-label'), `Edit what Worca took from ${evil}`);
});

test('flag off: the feature route answers 404 and the page shows no Files card; a view without files has none either', async () => {
  const off = await openFeature(null, { 'GET /api/requirements/4': { __status: 404, body: { error: 'not found' } } });
  assert.equal(off.host.querySelector('.req-files'), null);
  assert.equal(off.host.querySelector('input[type="file"]'), null);
  const old = await openFeature(feature({ attachments: undefined }));
  assert.equal(old.host.querySelector('.req-files'), null);
  assert.ok(![...old.host.querySelectorAll('.req-chips .chip')].some((c) => /file/.test(c.textContent)));
});

test('style.css: board 20 hides the pencil below 600 px (it is in the ⋯ menu); AA ink for the badges, the failed line and the caption', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width:600px\)\{\s*\.req-file-pencil\{display:none\}/);
  assertInRequirementsBlock(['.req-file-name', '.req-file-cap', '.req-file .badge.blue', '.req-file .badge.amber', '.req-menu{']);
  const rule = (sel) => (css.match(new RegExp(`${sel.replace(/[.[\]()]/g, '\\$&')}\\{([^}]*)\\}`)) || [])[1] || '';
  assert.match(rule('.req-file .badge.blue'), /color:var\(--blue-ink-strong\)/);
  assert.match(rule('.req-file .badge.amber'), /color:var\(--amber-ink-strong\)/);
  assert.match(rule('.req-file-failed'), /color:var\(--red-ink-strong\)/);
  assert.match(rule('.req-file-cap'), /color:var\(--ink-2\)/);
  assert.match(rule('.req-menu .hd-menu'), /position:absolute/, 'a menu floats under its trigger');
});

// ── Task 12 follow-up (review): the reading line's AA ink, the editor's Escape and caret, a dropped draft, focus at 10 files ─────────

test('style.css: the "Reading N files…" badge takes --blue-ink-strong on --blue-bg (AA), inside the Requirements block', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assertInRequirementsBlock(['.req-reading .badge.blue']);
  const body = (css.match(/\.req-reading \.badge\.blue\{([^}]*)\}/) || [])[1] || '';
  assert.match(body, /color:var\(--blue-ink-strong\)/);
});

test('the summary editor: Escape cancels and hands the focus back to the pencil; nothing is sent', async () => {
  const { host, calls } = await openFeature(feature());
  host.querySelector('.req-file-pencil').click();
  const ta = host.querySelector('[data-ui="file-edit-text-ratt_00000000000a"]');
  ta.value = 'Half typed';
  ta.dispatchEvent(new window.Event('input'));
  const ev = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  ta.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(host.querySelector('[data-ui="file-edit-text-ratt_00000000000a"]'), null, 'the editor is closed');
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-edit-ratt_00000000000a');
  host.querySelector('.req-file-pencil').click();
  assert.equal(host.querySelector('[data-ui="file-edit-text-ratt_00000000000a"]').value, att().summary, 'a new edit starts from the text, not the cancelled draft');
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
});

test('the summary editor keeps its text, focus and caret across a live repaint', async () => {
  const { host, view } = await openFeature(feature());
  host.querySelector('.req-file-pencil').click();
  let ta = host.querySelector('[data-ui="file-edit-text-ratt_00000000000a"]');
  ta.value = 'abcdefgh';
  ta.dispatchEvent(new window.Event('input'));
  ta.focus();
  ta.setSelectionRange(2, 5);
  await view.changed(4);
  const now = host.querySelector('[data-ui="file-edit-text-ratt_00000000000a"]');
  assert.notEqual(now, ta, 'repainted');
  ta = now;
  assert.deepEqual([ta.value, document.activeElement === ta, ta.selectionStart, ta.selectionEnd], ['abcdefgh', true, 2, 5]);
});

test('a draft whose file is read again (or loses its text) under the open editor is dropped, and the card says "Worca is reading this file."', async () => {
  let f = feature();
  const { host, view } = await openFeature(null, { 'GET /api/requirements/4': () => ({ feature: f, turns: [] }) });
  host.querySelector('.req-file-pencil').click();
  const ta = host.querySelector('[data-ui="file-edit-text-ratt_00000000000a"]');
  ta.value = 'Mine';
  ta.dispatchEvent(new window.Event('input'));
  f = feature({ attachments: [att({ status: 'reading', summary: '' })] });
  await view.changed(4);
  assert.equal(host.querySelector('[data-ui="file-edit-text-ratt_00000000000a"]'), null);
  const line = host.querySelector('.req-files .req-file-refused');
  assert.deepEqual([line.getAttribute('role'), line.hidden, line.textContent], ['alert', false, 'Worca is reading this file.']);
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-more-ratt_00000000000a', "the focus goes to the file's ⋯");
  f = feature();
  await view.changed(4);
  assert.deepEqual([line.hidden, line.textContent], [true, ''], 'cleared on the next paint once no file is read');
  host.querySelector('.req-file-pencil').click();
  f = feature({ attachments: [att({ status: 'failed', summary: '', error: { code: 'TIMEOUT', message: 'x' } })] });
  await view.changed(4);
  assert.equal(host.querySelector('[data-ui="file-edit-text-ratt_00000000000a"]'), null, 'lost its text: closed too');
  const after = host.querySelector('.req-files .req-file-refused');
  assert.deepEqual([after.hidden, after.textContent], [true, ''], 'a file that went straight to failed is not being read: its own alert says why');
  assert.match(host.querySelector('.req-file-failed').textContent, /^Worca could not read this file: it ran out of time\./);
});

test('an upload that fills the card (10 files) disables Add files; the focus goes to the Files heading', async () => {
  const nine = Array.from({ length: 9 }, (_, i) => att({ id: `ratt_00000000001${i}`, name: `f${i}.md`, kind: 'text', bytes: 10 }));
  let f = feature({ attachments: nine });
  const { host } = await openFeature(null, { 'GET /api/requirements/4': () => ({ feature: f, turns: [] }),
    'POST /api/requirements/4/attachments': () => { f = feature({ attachments: [...nine, att({ id: 'ratt_000000000020', name: 'last.md', kind: 'text', bytes: 3 })] }); return { feature: f, turns: [] }; } });
  pick(host.querySelector('.req-files input[type="file"]'), [mkFile('last.md', '# n')]);
  await settle();
  assert.equal(host.querySelector('[data-ui="files-add"]').disabled, true);
  const head = host.querySelector('.req-files h3');
  assert.deepEqual([document.activeElement === head, head.getAttribute('tabindex'), head.textContent], [true, '-1', 'Files · 10']);
});

// ── board 21: the menu, Replace, Ask, sources ─────────────────
const HREF = '/api/requirements/4/attachments/ratt_00000000000a';
const OK = { feature: feature(), turns: [] };
const openMenu = (host) => { host.querySelector('[data-ui="file-more-ratt_00000000000a"]').click(); return host.querySelector('[data-menu="file-ratt_00000000000a"] [role="menu"]'); };
const labels = (list) => [...list.children].map((x) => (x.classList.contains('menu-sep') ? '—' : x.textContent));
const item = (host, label) => [...openMenu(host).children].find((x) => x.textContent === label);

test("board 21: the ⋯ menu, named for its file: Open, Edit, Ask, Replace, Read again, a separator, Remove (red)", async () => {
  const { host } = await openFeature(feature());
  const trigger = host.querySelector('[data-ui="file-more-ratt_00000000000a"]');
  assert.deepEqual([trigger.getAttribute('aria-label'), trigger.getAttribute('aria-haspopup')], ['More for support-tickets.pdf', 'menu']);
  const list = openMenu(host);
  assert.deepEqual(labels(list), ['Open', 'Edit what Worca took from it', 'Ask about this file…', 'Replace with a newer version…', 'Read again', '—', 'Remove']);
  assert.deepEqual([...list.querySelectorAll('[role="menuitem"]')].map((x) => x.getAttribute('data-ui')),
    ['open', 'edit', 'ask', 'replace', 'again', 'remove'].map((k) => `fmi-${k}-ratt_00000000000a`));
  assert.equal(list.querySelector('.menu-sep').getAttribute('role'), 'separator');
  assert.equal(list.querySelector('a[role="menuitem"]').getAttribute('href'), HREF);
  assert.ok(list.lastElementChild.classList.contains('is-danger'));
  list.children[1].click();
  assert.ok(host.querySelector('[data-ui="file-edit-text-ratt_00000000000a"]'), 'the menu opens the editor (the pencil at phone width)');
});

test('board 21: each state offers only what applies: reading, failed, a version that could not be stored, not read yet; the lock disables', async () => {
  const offered = async (over, f = null) => labels(openMenu((await openFeature(f || feature({ attachments: [att(over)] }))).host));
  assert.deepEqual(await offered({ status: 'reading', summary: '' }), ['Open', '—', 'Remove'], 'no Ask, Replace or Read again while it is read');
  assert.deepEqual(await offered({ status: 'failed', summary: '', error: { code: 'TIMEOUT', message: 'x' } }),
    ['Open', 'Replace with a newer version…', 'Read again', '—', 'Remove'], 'no Ask on a file Worca could not read');
  assert.deepEqual(await offered({ status: 'failed', summary: '', error: { code: 'STORE_FAILED', message: 'Worca could not store the new version. Replace it again.' } }),
    ['Open', 'Replace with a newer version…', '—', 'Remove'], 'the server refuses Read again here: Replace mends it');
  assert.deepEqual(await offered({ status: 'unread-budget', summary: '' }), ['Open', 'Replace with a newer version…', 'Read again', '—', 'Remove']);
  const { host } = await openFeature(feature({ busy: true }));
  const list = openMenu(host);
  assert.deepEqual([...list.querySelectorAll('button[role="menuitem"]')].map((b) => b.disabled), [true, true, true, true, true]);
});

test('a version that could not be stored says the server\'s words and offers Replace, not Try again', async () => {
  const { host } = await openFeature(feature({ attachments: [att({ status: 'failed', summary: '',
    error: { code: 'STORE_FAILED', message: 'Worca could not store the new version. Replace it again.' } })] }));
  const line = host.querySelector('.req-file-failed');
  assert.equal(line.getAttribute('role'), 'alert');
  assert.equal(line.querySelector('.req-file-failed-text').textContent, 'Worca could not store the new version. Replace it again.');
  const btn = line.querySelector('button');
  assert.deepEqual([btn.textContent, btn.getAttribute('data-ui')], ['Replace with a newer version…', 'file-replace-ratt_00000000000a']);
  let opened = 0;
  host.querySelector('[data-menu="file-ratt_00000000000a"] input[type="file"]').addEventListener('click', () => { opened += 1; });
  btn.click();
  assert.equal(opened, 1, 'it opens the file picker');
});

test('board 21: Ask about this file: the panel, its estimate, Ask posts the question; the answer, newest first, labelled', async () => {
  let f = feature({ attachments: [att({ asks: [{ question: 'Older?', answer: 'Older answer.' }] })] });
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns: [] }), [`POST ${HREF}/ask`]: OK });
  const { host, view } = make();
  await view.show('feature/4');
  item(host, 'Ask about this file…').click();
  const panel = host.querySelector('.req-file-askpanel');
  assert.equal(panel.querySelector('label').textContent, 'What should Worca look for?');
  assert.equal(panel.querySelector('.hint').textContent, 'One more read of this file · about $0.12');
  const input = panel.querySelector('input');
  assert.deepEqual([document.activeElement, input.getAttribute('maxlength'), panel.querySelector('label').getAttribute('for')], [input, '200', input.id]);
  const go = panel.querySelector('[data-ui="file-ask-go-ratt_00000000000a"]');
  assert.equal(go.disabled, true, 'a question is 1 to 200 characters');
  input.value = 'What about refunds?';
  input.dispatchEvent(new window.Event('input'));
  assert.equal(go.disabled, false);
  f = feature({ attachments: [att({ asks: [{ question: 'Older?', answer: 'Older answer.' }, { question: 'What about refunds?', answer: '4 ask for store credit.' }] })] });
  go.click();
  await settle();
  assert.deepEqual(calls.find((c) => c.url === `${HREF}/ask`).body, { question: 'What about refunds?' });
  assert.equal(host.querySelector('.req-file-askpanel'), null, 'the panel closes');
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-more-ratt_00000000000a');
  assert.equal(host.querySelector('.req-file-added').textContent, 'Added to what Worca took from it · Q: What about refunds?');
  assert.deepEqual([...host.querySelectorAll('.req-file-ask')].map(text),
    ['Added to what Worca took from it · Q: What about refunds? 4 ask for store credit.', 'Q: Older? Older answer.'], 'newest first');
  assert.equal(host.querySelector('.req-files-live').textContent, 'Added to what Worca took from it · Q: What about refunds?', 'said once in the status line');
  const none = await openFeature(feature({ attachments: [att({ estimateUsd: null })] }));
  item(none.host, 'Ask about this file…').click();
  assert.equal(none.host.querySelector('.req-file-askpanel .hint').textContent, 'One more read of this file · about $0.05–0.15');
});

test('Ask: the budget refusal shows in the panel, word for word, and keeps the question; Escape and Cancel close it', async () => {
  const BUDGET = 'The spending limit of $5 is reached for this period. Worca can read the file when the limit resets or is raised.';
  const { host, view } = await openFeature(feature(), { [`POST ${HREF}/ask`]: { __status: 409, body: { error: BUDGET } } });
  item(host, 'Ask about this file…').click();
  const input = host.querySelector('[data-ui="file-ask-text-ratt_00000000000a"]');
  input.value = 'Refunds?';
  input.dispatchEvent(new window.Event('input'));
  host.querySelector('[data-ui="file-ask-go-ratt_00000000000a"]').click();
  await settle();
  const msg = host.querySelector('.req-file-askpanel .req-file-askmsg');
  assert.deepEqual([msg.getAttribute('role'), msg.textContent], ['alert', BUDGET]);
  assert.equal(host.querySelector('[data-ui="file-ask-text-ratt_00000000000a"]').value, 'Refunds?');
  await view.changed(4);
  assert.equal(host.querySelector('.req-file-askpanel .req-file-askmsg'), msg, 'the same alert node across a repaint');
  const ev = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  host.querySelector('[data-ui="file-ask-text-ratt_00000000000a"]').dispatchEvent(ev);
  assert.equal(host.querySelector('.req-file-askpanel'), null);
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-more-ratt_00000000000a');
  item(host, 'Ask about this file…').click();
  assert.equal(host.querySelector('.req-file-askmsg').textContent, '', 'a new panel starts without the old refusal');
  [...host.querySelectorAll('.req-file-askpanel button')].find((b) => b.textContent === 'Cancel').click();
  assert.equal(host.querySelector('.req-file-askpanel'), null);
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-more-ratt_00000000000a');
});

test('a failed ask says so under the file, one alert node across repaints', async () => {
  const { host, view } = await openFeature(feature({ attachments: [att({ error: { code: 'TIMEOUT', message: 'x', job: 'ask', question: 'Refunds?', at: 't1' } })] }));
  const line = host.querySelector('.req-file-ask-failed');
  assert.deepEqual([line.getAttribute('role'), line.textContent], ['alert', 'Worca could not answer “Refunds?”: it ran out of time.']);
  await view.changed(4);
  assert.equal(host.querySelector('.req-file-ask-failed'), line);
});

test('board 21: Replace opens the picker, then the dialog; an edited summary offers rewrite (default) or keep; Replace posts', async () => {
  const { host, calls } = await openFeature(feature({ attachments: [att({ summaryEdited: true, sendWithRun: true })] }), { [`POST ${HREF}/replace`]: OK });
  const trigger = host.querySelector('[data-ui="file-more-ratt_00000000000a"]');
  trigger.focus();
  pick(host.querySelector('[data-menu="file-ratt_00000000000a"] input[type="file"]'), [mkFile('tickets-v2.pdf', '%PDF-1.7 v2', 'application/pdf')]);
  const dlg = document.querySelector('.req-dialog[role="dialog"]');
  assert.equal(dlg.getAttribute('aria-modal'), 'true');
  assert.equal(document.getElementById(dlg.getAttribute('aria-labelledby')), dlg.querySelector('h2'));
  assert.equal(dlg.querySelector('h2').textContent, 'Replace support-tickets.pdf');
  assert.equal(text(dlg.querySelector('.req-replace-lead')), 'New file: tickets-v2.pdf · PDF · 11 B. Worca reads it again (about $0.12); “Send with the run” stays on.');
  assert.equal(dlg.querySelector('.req-replace-lead b').textContent, 'tickets-v2.pdf');
  assert.equal(dlg.querySelector('legend').textContent, 'You edited what Worca took from the old file');
  assert.deepEqual([...dlg.querySelectorAll('.req-replace-opt')].map(text),
    ["Let Worca write it again from the new file (your text is kept in the file's history)", 'Keep my text']);
  assert.equal(dlg.querySelector('[data-ui="replace-rewrite"]').checked, true);
  assert.equal(document.activeElement, dlg.querySelector('[data-ui="replace-rewrite"]'), 'the choice takes the focus');
  assert.equal(host.inert, true, 'the page behind is inert');
  assert.equal(text(dlg.querySelector('.req-replace-hint')),
    'The next round uses the new version. A Ready feature gets one short follow-up round; after the start it counts as a change since the start.');
  dlg.querySelector('[data-ui="replace-keep"]').click();
  dlg.querySelector('[data-ui="replace-go"]').click();
  await settle();
  const post = calls.find((c) => c.url === `${HREF}/replace`);
  assert.deepEqual([post.body.keepSummary, post.body.attachments[0].name, typeof post.body.attachments[0].dataBase64], [true, 'tickets-v2.pdf', 'string']);
  assert.equal(document.querySelector('.req-dialog'), null, 'closed after Replace');
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-more-ratt_00000000000a', 'the focus goes back to the ⋯');
});

test("Replace: Tab stays in the dialog; the server's refusals show in it, word for word; Replace without the choice sends keepSummary false", async () => {
  const { host, calls } = await openFeature(feature(), { [`POST ${HREF}/replace`]: { __status: 409, body: { error: 'This is the same version as support-tickets.pdf.' } } });
  pick(host.querySelector('[data-menu="file-ratt_00000000000a"] input[type="file"]'), [mkFile('b.md', '# b')]);
  const dlg = document.querySelector('.req-dialog');
  const go = dlg.querySelector('[data-ui="replace-go"]');
  assert.equal(document.activeElement, go, 'without a choice, Replace takes the focus');
  const tab = (shiftKey) => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
  tab(false);
  assert.equal(document.activeElement.textContent, 'Cancel', 'Tab from the last control wraps to the first');
  tab(true);
  assert.equal(document.activeElement, go);
  go.click();
  await settle();
  assert.deepEqual([calls.find((c) => c.url === `${HREF}/replace`).body.keepSummary, dlg.querySelector('.req-dlg-msg').textContent],
    [false, 'This is the same version as support-tickets.pdf.']);
  assert.ok(dlg.isConnected, 'the dialog stays open');
  for (const error of ['Worca could not store the new version. Replace it again.', 'Try again in a moment.', 'Worca is reading this file.']) {
    globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error }) });
    go.click();
    await settle();
    assert.equal(dlg.querySelector('.req-dlg-msg').textContent, error);
  }
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.querySelector('.req-dialog'), null);
  assert.equal(host.inert, false);
});

test('board 21: Replace without an edited summary has no choice; Escape and Cancel close; a refused pick never opens it', async () => {
  const { host } = await openFeature(feature());
  const input = () => host.querySelector('[data-menu="file-ratt_00000000000a"] input[type="file"]');
  pick(input(), [mkFile('b.md', '# b')]);
  assert.equal(document.querySelector('.req-dialog legend'), null);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.querySelector('.req-dialog'), null);
  pick(input(), [mkFile('c.md', '# c')]);
  [...document.querySelectorAll('.req-dialog button')].find((b) => b.textContent === 'Cancel').click();
  assert.equal(document.querySelector('.req-dialog'), null);
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-more-ratt_00000000000a');
  pick(input(), [mkFile('deck.pptx', 'x')]);
  assert.equal(document.querySelector('.req-dialog'), null);
  const line = host.querySelector('.req-files .req-file-refused');
  assert.deepEqual([line.hidden, line.textContent], [false, 'deck.pptx was not added: Worca reads text, images and PDF. Save it as PDF to attach it here.']);
  const big = mkFile('huge.pdf', 'x', 'application/pdf');
  Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
  pick(input(), [big]);
  assert.equal(document.querySelector('.req-dialog'), null);
  assert.equal(host.querySelector('.req-files .req-file-refused').textContent, 'huge.pdf was not added: it is over 25 MB.');
});

test('board 21: Read again asks first on an edited summary; Remove asks before deleting', async () => {
  const { host, calls } = await openFeature(feature({ attachments: [att({ summaryEdited: true })] }), { [`POST ${HREF}/read-again`]: OK, [`DELETE ${HREF}`]: OK });
  asked.length = 0;
  item(host, 'Read again').click();
  await settle();
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-more-ratt_00000000000a', 'after Read again the focus is on the ⋯');
  item(host, 'Remove').click();
  await settle();
  assert.deepEqual(asked, ["Read again? Your text goes to the file's history.", 'Remove support-tickets.pdf? The file and what Worca took from it are deleted.']);
  assert.deepEqual(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`), [`POST ${HREF}/read-again`, `DELETE ${HREF}`]);
  answer = false;
  item(host, 'Remove').click();
  await settle();
  answer = true;
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 1, 'a No sends nothing');
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-more-ratt_00000000000a', 'a No leaves the focus on the ⋯');
  asked.length = 0;
  const plain = await openFeature(feature(), { [`POST ${HREF}/read-again`]: OK });
  item(plain.host, 'Read again').click();
  await settle();
  assert.deepEqual([asked.length, plain.calls.filter((c) => c.method === 'POST').length], [0, 1], 'no question on a text Worca wrote');
});

test('Remove: the focus goes to the next file, else the previous one, else Add files', async () => {
  const mk = (k) => att({ id: `ratt_00000000000${k}`, name: `${k}.md`, kind: 'text', bytes: 3, href: `/api/requirements/4/attachments/ratt_00000000000${k}` });
  let files = ['b', 'c', 'd'].map(mk);
  const del = (k) => () => { files = files.filter((a) => a.id !== `ratt_00000000000${k}`); return OK; };
  const { host } = await openFeature(null, { 'GET /api/requirements/4': () => ({ feature: feature({ attachments: files }), turns: [] }),
    'DELETE /api/requirements/4/attachments/ratt_00000000000b': del('b'), 'DELETE /api/requirements/4/attachments/ratt_00000000000c': del('c'),
    'DELETE /api/requirements/4/attachments/ratt_00000000000d': del('d') });
  const remove = async (k) => {
    host.querySelector(`[data-ui="file-more-ratt_00000000000${k}"]`).click();
    host.querySelector(`[data-ui="fmi-remove-ratt_00000000000${k}"]`).click();
    await settle();
    return document.activeElement.getAttribute('data-ui');
  };
  assert.equal(await remove('c'), 'file-name-ratt_00000000000d', 'the next file');
  assert.equal(await remove('d'), 'file-name-ratt_00000000000b', 'the last one gone: the previous file');
  assert.equal(await remove('b'), 'files-add', 'none left: Add files');
});

test('D13: the spec card shows a source as a tag after the text, a link while the file exists, plain text once it is gone', async () => {
  const spec = { ...feature().spec, criteria: [{ id: 'R-po-1', text: 'Cancel until printed', source: 'support-tickets.pdf' }, { id: 'R-po-2', text: 'Plain' }],
    assumptions: [{ id: 'A-1', text: 'Card refunds', status: 'open', source: 'gone.md' }, { id: 'A-2', text: 'From the brief', status: 'open', source: 'Policy.MD' }] };
  const { host } = await openFeature(feature({ spec, briefDocuments: [att({ id: 'ratt_00000000000f', name: 'policy.md', kind: 'text', href: '/api/requirements/brief/project/shop-1/documents/ratt_00000000000f' })] }));
  const tag = host.querySelector('[data-criterion="R-po-1"] .req-src-tag');
  assert.deepEqual([tag.tagName, tag.textContent, tag.getAttribute('href'), tag.getAttribute('target')], ['A', 'support-tickets.pdf', HREF, '_blank']);
  assert.deepEqual([tag.parentElement.className, tag.parentElement.firstChild.textContent], ['req-item-text', 'Cancel until printed'], 'after the text, in its line');
  assert.equal(tag.querySelector('svg').getAttribute('aria-hidden'), 'true');
  assert.equal(host.querySelector('[data-criterion="R-po-2"] .req-src-tag'), null);
  const gone = host.querySelector('[data-assumption="A-1"] .req-src-tag');
  assert.deepEqual([gone.tagName, gone.textContent], ['SPAN', 'gone.md']);
  const doc = host.querySelector('[data-assumption="A-2"] .req-src-tag');
  assert.deepEqual([doc.tagName, doc.getAttribute('href')], ['A', '/api/requirements/brief/project/shop-1/documents/ratt_00000000000f'], 'a brief document, matched case-insensitively');
});

test('D13: a removed file\'s tag loses its link on the next paint', async () => {
  const spec = { ...feature().spec, criteria: [{ id: 'R-po-1', text: 'Cancel until printed', source: 'support-tickets.pdf' }] };
  let f = feature({ spec });
  const { host } = await openFeature(null, { 'GET /api/requirements/4': () => ({ feature: f, turns: [] }),
    [`DELETE ${HREF}`]: () => { f = feature({ spec, attachments: [] }); return OK; } });
  assert.equal(host.querySelector('.req-src-tag').tagName, 'A');
  item(host, 'Remove').click();
  await settle();
  assert.deepEqual([host.querySelector('.req-src-tag').tagName, host.querySelector('.req-src-tag').textContent], ['SPAN', 'support-tickets.pdf']);
});

test('XSS: a question, an answer and a source are text, never markup', async () => {
  const bad = '<img src=x onerror="window.__pwn=1">';
  const spec = { ...feature().spec, criteria: [{ id: 'R-po-1', text: 'x', source: bad }] };
  const { host } = await openFeature(feature({ spec, attachments: [att({ asks: [{ question: bad, answer: bad }], error: { code: 'X', message: bad, job: 'ask', question: bad } })] }));
  assert.equal(host.querySelectorAll('img').length, 0);
  assert.ok(host.querySelector('.req-src-tag').textContent.includes('<img'));
});

test('style.css: board 20 puts the pencil in the menu below 600 px; board 21 rules inside the Requirements block, AA ink, 44 px targets', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width:600px\)\{\s*\.req-file-pencil\{display:none\}/);
  assert.equal(css.match(/\.req-file-pencil\{display:none\}/g).length, 1, 'one pencil rule');
  assertInRequirementsBlock(['.req-src-tag', '.req-file-askpanel', '.req-replace-opt', '.req-file-added', '.req-menu .menu-item.is-danger', '.req-files .req-menu .menu-item{min-height:44px}']);
  const rule = (sel) => (css.match(new RegExp(`${sel.replace(/[.[\]()]/g, '\\$&')}\\{([^}]*)\\}`)) || [])[1] || '';
  assert.match(rule('.req-menu .menu-item.is-danger'), /color:var\(--red-ink-strong\)/, 'Remove: AA on the panel and on its red hover');
  assert.match(rule('a.req-src-tag'), /color:var\(--blue-ink-strong\)/);
  assert.match(rule('.req-src-tag'), /background:var\(--field\);color:var\(--ink-2\)/);
  assert.match(rule('.req-files .req-menu .menu-item'), /white-space:nowrap/, 'board 21: one line a menu row');
  assert.match(rule('.req-replace-opt .hint'), /display:inline/, "the history note follows the choice's words");
  assert.match(rule('.req-spec a.req-src-tag::after'), /inset:-13px -4px/, 'a source link has a 44 px target at phone width');
});
