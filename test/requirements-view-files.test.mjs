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
  assert.deepEqual([tag.tagName, tag.textContent, tag.getAttribute('href'), tag.getAttribute('target')], ['A', 'from support-tickets.pdf', HREF, '_blank']);
  assert.deepEqual([tag.parentElement.className, tag.parentElement.firstChild.textContent], ['req-item-text', 'Cancel until printed'], 'after the text, in its line');
  assert.equal(tag.querySelector('svg').getAttribute('aria-hidden'), 'true');
  assert.equal(host.querySelector('[data-criterion="R-po-2"] .req-src-tag'), null);
  const gone = host.querySelector('[data-assumption="A-1"] .req-src-tag');
  assert.deepEqual([gone.tagName, gone.textContent], ['SPAN', 'from gone.md']);
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
  assert.deepEqual([host.querySelector('.req-src-tag').tagName, host.querySelector('.req-src-tag').textContent], ['SPAN', 'from support-tickets.pdf']);
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

// ── Task 13 review: an ask in progress, a repaint mid-request, renamed sources, error copy, a cancelled picker ─────────

test('an ask in progress: the blue Asking… badge (one role=status node) and "Worca is looking for: …"; the menu waits; cleared by the answer', async () => {
  let f = feature({ attachments: [att({ asking: 'What about refunds?' })] });
  const { host, view } = await openFeature(null, { 'GET /api/requirements/4': () => ({ feature: f, turns: [] }) });
  const badge = host.querySelector('.req-file .badge.blue');
  assert.deepEqual([badge.textContent, badge.getAttribute('role')], ['Asking…', 'status']);
  assert.equal(host.querySelector('.req-file-asking').textContent, 'Worca is looking for: “What about refunds?”…');
  assert.deepEqual(labels(openMenu(host)), ['Open', '—', 'Remove'], 'like reading: only Open and Remove');
  assert.equal(host.querySelector('.req-file-pencil'), null, 'no pencil while it is asked');
  await view.changed(4);
  assert.equal(host.querySelector('.req-file .badge.blue'), badge, 'the same status node across a repaint');
  f = feature({ attachments: [att({ asking: null, asks: [{ question: 'What about refunds?', answer: 'None.' }] })] });
  await view.changed(4);
  assert.equal(host.querySelector('.req-file .badge.blue'), null);
  assert.equal(host.querySelector('.req-file-asking'), null);
  assert.equal(labels(openMenu(host)).length, 7, 'the whole menu again');
});

test('Ask stays busy across a live repaint while its request is out; one POST', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { host, view, calls } = await openFeature(feature(), { [`POST ${HREF}/ask`]: () => held });
  item(host, 'Ask about this file…').click();
  const input = host.querySelector('[data-ui="file-ask-text-ratt_00000000000a"]');
  input.value = 'Refunds?';
  input.dispatchEvent(new window.Event('input'));
  host.querySelector('[data-ui="file-ask-go-ratt_00000000000a"]').click();
  await settle();
  await view.changed(4);
  const go = host.querySelector('[data-ui="file-ask-go-ratt_00000000000a"]');
  assert.equal(go.disabled, true, 'the repainted Ask is still busy');
  go.click();
  host.querySelector('[data-ui="file-ask-text-ratt_00000000000a"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await settle();
  assert.equal(calls.filter((c) => c.url === `${HREF}/ask`).length, 1);
  release(OK);
  await settle();
  assert.equal(host.querySelector('.req-file-askpanel'), null, 'closed once it went through');
});

test("a source naming a file's earlier version keeps its link to the file that replaced it", async () => {
  const spec = { ...feature().spec, criteria: [{ id: 'R-po-1', text: 'x', source: 'Tickets-Sept.pdf' }, { id: 'R-po-2', text: 'y', source: 'notes.md' }] };
  const { host } = await openFeature(feature({ spec, attachments: [att({ history: [
    { at: '2026-10-19T08:00:00Z', name: 'tickets-sept.pdf', summary: 'old', reason: 'replaced' },
    { at: '2026-10-18T08:00:00Z', name: 'notes.md', summary: 'old', reason: 'read-again' }] })] }));
  const renamed = host.querySelector('[data-criterion="R-po-1"] .req-src-tag');
  assert.deepEqual([renamed.tagName, renamed.getAttribute('href')], ['A', HREF]);
  assert.equal(host.querySelector('[data-criterion="R-po-2"] .req-src-tag').tagName, 'SPAN', 'only a replaced version counts');
});

test('a source link is named "from <name>" for screen readers', async () => {
  const spec = { ...feature().spec, criteria: [{ id: 'R-po-1', text: 'x', source: 'support-tickets.pdf' }] };
  const { host } = await openFeature(feature({ spec }));
  const tag = host.querySelector('.req-src-tag');
  assert.deepEqual([tag.querySelector('.sr-only').textContent, tag.lastChild.textContent], ['from ', 'support-tickets.pdf']);
});

test('error copy: the Replace dialog, the ask panel and the start dialog never show a raw HTTP status', async () => {
  const raw = (status) => { globalThis.fetch = async () => ({ ok: false, status, json: async () => { throw new SyntaxError('Unexpected token <'); } }); };
  const { host } = await openFeature(feature({ readiness: { ...readiness(), overridable: true } }));
  pick(host.querySelector('[data-menu="file-ratt_00000000000a"] input[type="file"]'), [mkFile('b.md', '# b')]);
  const dlg = document.querySelector('.req-dialog');
  raw(502);
  dlg.querySelector('[data-ui="replace-go"]').click();
  await settle();
  assert.equal(dlg.querySelector('.req-dlg-msg').textContent, 'Worca could not finish that. Try again.');
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'file not found' }) });
  dlg.querySelector('[data-ui="replace-go"]').click();
  await settle();
  assert.equal(dlg.querySelector('.req-dlg-msg').textContent, 'Requirements are turned off, or this feature no longer exists.');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  item(host, 'Ask about this file…').click();
  const input = host.querySelector('[data-ui="file-ask-text-ratt_00000000000a"]');
  input.value = 'Q?';
  input.dispatchEvent(new window.Event('input'));
  raw(500);
  host.querySelector('[data-ui="file-ask-go-ratt_00000000000a"]').click();
  await settle();
  assert.equal(host.querySelector('.req-file-askmsg').textContent, 'Worca could not finish that. Try again.');
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  host.querySelector('[data-ui="file-ask-go-ratt_00000000000a"]').click();
  await settle();
  assert.equal(host.querySelector('.req-file-askmsg').textContent, 'Worca could not finish that. Try again.', 'a network failure too');
  host.querySelector('[data-ui="start-anyway"]').click();
  const reason = document.getElementById('req-dlg-reason');
  reason.value = 'Now.';
  reason.dispatchEvent(new window.Event('input'));
  raw(502);
  [...document.querySelectorAll('.req-dialog button')].at(-1).click();
  await settle();
  assert.equal(document.querySelector('.req-dialog .req-dlg-msg').textContent, 'Worca could not finish that. Try again.');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));   // close it: its key handler is on the document
  assert.equal(document.querySelector('.req-dialog'), null);
});

test('Replace with a newer version… hands the focus to the ⋯ before the picker, so a cancelled picker leaves it there', async () => {
  const { host } = await openFeature(feature());
  let opened = 0;
  host.querySelector('[data-menu="file-ratt_00000000000a"] input[type="file"]').addEventListener('click', () => {
    opened += 1;
    assert.equal(document.activeElement.getAttribute('data-ui'), 'file-more-ratt_00000000000a', 'focused before the picker opens');
  });
  item(host, 'Replace with a newer version…').click();
  assert.equal(opened, 1);
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-more-ratt_00000000000a');
  assert.equal(document.querySelector('.req-dialog'), null, 'nothing picked: no dialog');
});
// ── board 18: Ready to build, Files for the run ─────────────────
const DOC_HREF = '/api/requirements/brief/project/shop-1/documents/ratt_0000000000d1';
const doc = (over = {}) => { const { sendWithRun, ...rest } = att(); return { ...rest, id: 'ratt_0000000000d1', name: 'glossary.pdf', sendWithEveryRun: true, href: DOC_HREF, ...over }; };
const ready = (over = {}) => feature({ status: 'done', state: 'ready', readiness: readiness(true), ...over });

test('board 18: the row (role=group): "n of m go with it", a chip per file then From the brief; the notes and the mentions', async () => {
  const f = ready({ attachments: [att({ sendWithRun: true, mentions: ['R-po-3'] }), att({ id: 'ratt_00000000000b', name: 'refund-policy.md', sendWithRun: false,
    href: '/api/requirements/4/attachments/ratt_00000000000b' })], briefDocuments: [doc()] });
  const { host } = await openFeature(f);
  const row = host.querySelector('.req-build .req-build-files');
  assert.deepEqual([row.getAttribute('role'), row.querySelector('h4').textContent, row.querySelector('.req-build-files-head .hint').textContent],
    ['group', 'Files for the run', '2 of 3 go with it · click a file to add or leave it out']);
  assert.equal(document.getElementById(row.getAttribute('aria-labelledby')), row.querySelector('h4'));
  const chips = [...row.querySelectorAll('.req-fpick')];
  assert.deepEqual(chips.map((c) => [c.textContent, c.getAttribute('aria-pressed'), c.getAttribute('aria-label')]), [
    ['support-tickets.pdf', 'true', 'Send support-tickets.pdf with the run'], ['refund-policy.md', 'false', 'Send refund-policy.md with the run'],
    ['glossary.pdf', 'true', 'Send glossary.pdf with every run']]);
  assert.equal(row.querySelector('.req-fpick-group').textContent, 'From the brief');
  assert.equal(text(row.querySelector('.req-build-files-note')), 'Left out, a file still shaped the spec through what Worca took from it. The spec mentions support-tickets.pdf (R-po-3).');
});

test('board 18: the mentions are one sentence: "The spec mentions a.pdf (R-po-3) and b.md (R-po-5, A-1)."', async () => {
  const mk = (id, name, mentions) => att({ id, name, mentions, href: `/api/requirements/4/attachments/${id}` });
  const two = await openFeature(ready({ attachments: [mk('ratt_00000000000b', 'a.pdf', ['R-po-3']), mk('ratt_00000000000c', 'b.md', ['R-po-5', 'A-1'])] }));
  assert.equal(text(two.host.querySelector('.req-build-files-note')),
    'Left out, a file still shaped the spec through what Worca took from it. The spec mentions a.pdf (R-po-3) and b.md (R-po-5, A-1).');
  const three = await openFeature(ready({ attachments: [mk('ratt_00000000000b', 'a.pdf', ['R-po-3']), mk('ratt_00000000000c', 'b.md', ['R-po-5'])],
    briefDocuments: [doc({ mentions: ['R-po-1'] })] }));
  assert.match(text(three.host.querySelector('.req-build-files-note')), /The spec mentions a\.pdf \(R-po-3\), b\.md \(R-po-5\) and glossary\.pdf \(R-po-1\)\.$/);
});

test('board 18: a chip flips its switch: the file\'s Send with the run, a document\'s Send with every run', async () => {
  const f = ready({ briefDocuments: [doc()] });
  const { host, calls } = await openFeature(f, { [`PATCH ${HREF}`]: OK, [`PATCH ${DOC_HREF}`]: OK });
  host.querySelector('[data-ui="fpick-ratt_00000000000a"]').click();
  await settle();
  host.querySelector('[data-ui="fpick-ratt_0000000000d1"]').click();
  await settle();
  assert.deepEqual(calls.filter((c) => c.method === 'PATCH').map((c) => [c.url, c.body]), [[HREF, { sendWithRun: true }], [DOC_HREF, { sendWithEveryRun: false }]]);
});

test('board 18: no files and no documents: no row', async () => {
  const { host } = await openFeature(ready({ attachments: [] }));
  assert.ok(host.querySelector('.req-build'));
  assert.equal(host.querySelector('.req-build-files'), null);
});

test('board 18: the chip is the switch: the focus stays on it, it turns green with a check, and the Files card\'s switch shows it', async () => {
  let f = ready();
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns: [] }),
    [`PATCH ${HREF}`]: () => { f = ready({ attachments: [att({ sendWithRun: true })] }); return { feature: f, turns: [] }; } });
  const { host, view } = make();
  await view.show('feature/4');
  const chip = host.querySelector('[data-ui="fpick-ratt_00000000000a"]');
  assert.deepEqual([chip.tagName, chip.type, chip.classList.contains('on'), chip.querySelector('svg path').getAttribute('d')], ['BUTTON', 'button', false, 'M12 5v14M5 12h14']);
  assert.equal(host.querySelector('[data-ui="file-send-ratt_00000000000a"]').checked, false);
  chip.focus();
  chip.click();
  await settle();
  const now = host.querySelector('[data-ui="fpick-ratt_00000000000a"]');
  assert.equal(document.activeElement, now, 'the focus stays on the chip');
  assert.deepEqual([now.getAttribute('aria-pressed'), now.classList.contains('on'), now.querySelector('svg path').getAttribute('d')], ['true', true, 'M5 12.5l4.5 4.5L19 7.5']);
  assert.equal(host.querySelector('[data-ui="file-send-ratt_00000000000a"]').checked, true, 'the Files card\'s switch is the same setting');
  assert.equal(host.querySelector('.req-build-files-head .hint').textContent, '1 of 1 go with it · click a file to add or leave it out');
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 1);
});

test('board 18: a second press while the first is on its way sends nothing more', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: ready(), turns: [] }), [`PATCH ${HREF}`]: OK });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => { if ((opts.method || 'GET') === 'PATCH') await gate; return realFetch(url, opts); };
  const { host, view } = make();
  await view.show('feature/4');
  const chip = host.querySelector('[data-ui="fpick-ratt_00000000000a"]');
  chip.click();
  chip.click();
  release();
  await settle();
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 1);
});

test('board 18: a file the server says cannot go (sendable: false) cannot be switched on, chip or switch; switched on, it can be left out', async () => {
  const stuck = att({ status: 'failed', summary: '', sendable: false, error: { code: 'STORE_FAILED', message: 'Worca could not store the new version. Replace it again.' } });
  const gone = att({ id: 'ratt_00000000000b', name: 'notes.md', sendable: false, sendWithRun: true, href: '/api/requirements/4/attachments/ratt_00000000000b' });
  // a read that failed on a temporary copy, its body fine: the server says it can go, whatever the error's words
  const copy = att({ id: 'ratt_00000000000c', name: 'slow.png', status: 'failed', summary: '', sendable: true,
    error: { code: 'FAILED', message: 'Worca could not open the stored file. Remove it and attach it again.' }, href: '/api/requirements/4/attachments/ratt_00000000000c' });
  const { host, calls } = await openFeature(ready({ attachments: [stuck, gone, copy] }), { 'PATCH /api/requirements/4/attachments/ratt_00000000000b': OK });
  const [a, b, c] = [...host.querySelectorAll('.req-fpick')];
  assert.deepEqual([a.disabled, a.getAttribute('aria-pressed'), a.classList.contains('bad')], [true, 'false', true], 'off and not sendable: it cannot be switched on');
  assert.deepEqual([b.disabled, b.getAttribute('aria-pressed'), b.classList.contains('bad')], [false, 'true', true], 'on and not sendable: it can be left out');
  assert.deepEqual([c.disabled, c.classList.contains('bad'), c.hasAttribute('aria-describedby')], [false, false, false], 'sendable: no error words decide it');
  for (const x of [a, b]) assert.equal(x.querySelector('svg path').getAttribute('d'), 'M12 3l9.5 17h-19L12 3z');
  const why = (name) => `${name} cannot go with the run: Worca could not open the stored file. Replace it, or leave it out of the run.`;
  const lines = [...host.querySelectorAll('.req-build-files-bad')];
  assert.deepEqual(lines.map((l) => l.textContent), [why('support-tickets.pdf'), why('notes.md')]);
  assert.equal(document.getElementById(a.getAttribute('aria-describedby')), lines[0]);
  assert.equal(document.getElementById(b.getAttribute('aria-describedby')), lines[1]);
  // the Files card's switch is the same setting: disabled while off, with the same words
  const sw = (id) => host.querySelector(`[data-ui="file-send-${id}"]`);
  assert.deepEqual([sw('ratt_00000000000a').disabled, sw('ratt_00000000000b').disabled, sw('ratt_00000000000c').disabled], [true, false, false]);
  for (const id of ['ratt_00000000000a', 'ratt_00000000000b']) {
    const line = document.getElementById(sw(id).getAttribute('aria-describedby'));
    assert.ok(line && line.closest('.req-files'), 'the line is on the Files card');
  }
  assert.equal(text(document.getElementById(sw('ratt_00000000000a').getAttribute('aria-describedby'))), why('support-tickets.pdf'));
  assert.equal(sw('ratt_00000000000c').hasAttribute('aria-describedby'), false);
  a.click();
  b.click();
  await settle();
  assert.deepEqual(calls.filter((x) => x.method === 'PATCH').map((x) => [x.url, x.body]), [['/api/requirements/4/attachments/ratt_00000000000b', { sendWithRun: false }]]);
});

test('board 18: a file being read again has no switch (D1): its chip waits and says Reading…', async () => {
  const { host } = await openFeature(ready({ attachments: [att({ status: 'reading', sendWithRun: true })] }));
  const chip = host.querySelector('.req-fpick');
  assert.deepEqual([chip.disabled, text(chip), chip.getAttribute('aria-label'), chip.getAttribute('aria-pressed')],
    [true, 'support-tickets.pdf Reading…', 'Send support-tickets.pdf with the run', 'true']);
});

test('board 18: only the brief\'s documents: the row is From the brief alone; a view without files (before A8) has no row', async () => {
  const docs = await openFeature(ready({ attachments: [], briefDocuments: [doc({ sendWithEveryRun: false })] }));
  const row = docs.host.querySelector('.req-build-files');
  assert.equal(row.querySelector('.req-build-files-head .hint').textContent, '0 of 1 go with it · click a file to add or leave it out');
  assert.equal(row.querySelectorAll('.req-fpicks').length, 1);
  assert.equal(text(row.querySelector('.req-build-files-note')), 'Left out, a file still shaped the spec through what Worca took from it.');
  const old = feature({ status: 'done', state: 'ready', readiness: readiness(true) });
  delete old.attachments;
  delete old.briefDocuments;
  const before = await openFeature(old);
  assert.ok(before.host.querySelector('.req-build'));
  assert.equal(before.host.querySelector('.req-build-files'), null);
});

test('board 18: names are text only', async () => {
  const evil = '<img src=x onerror="window.__x=1">.md';
  const { host } = await openFeature(ready({ attachments: [att({ name: evil, mentions: ['R-po-1'] })] }));
  const row = host.querySelector('.req-build-files');
  assert.equal(row.querySelector('img'), null);
  assert.equal(row.querySelector('.req-fpick').textContent, evil);
  assert.ok(row.querySelector('.req-build-files-note').textContent.endsWith(`The spec mentions ${evil} (R-po-1).`));
});

test('Changed since the run started: the three file lines and the undo note', async () => {
  const start = { version: 1, runId: 'r1', run: { status: 'running', phase: 'plan', costUsd: 0.5, href: '#running/r1' }, failing: [], spec: feature().spec, files: [] };
  const f = feature({ status: 'done', state: 'started', starts: [start], changedSinceStart: [{ kind: 'file', change: 'added', name: 'a.pdf' },
    { kind: 'file', change: 'removed', name: 'b.md' }, { kind: 'file', change: 'replaced', name: 'c.png' }] });
  const { host } = await openFeature(f);
  const lines = [...host.querySelectorAll('.req-changed .req-change-line')];
  assert.deepEqual(lines.map(text), ['File: a.pdf goes with the run now.', 'File: b.md no longer goes with the run.', 'File: c.png was replaced with a newer version.']);
  assert.equal(lines[0].querySelector('b').textContent, 'a.pdf');
  assert.equal(lines[1].querySelector('del').textContent, 'b.md');
  assert.equal(text(host.querySelector('.req-changed-files')), "Undo puts the spec and the files' Send switches back. A removed or replaced file stays as it is now, and so do the documents' switches.");
});

test('Changed since the run started: without a file line, no undo note; a spec line keeps its form', async () => {
  const start = { version: 1, runId: 'r1', run: { status: 'running', phase: 'plan', costUsd: 0.5, href: '#running/r1' }, failing: [], spec: feature().spec, files: [] };
  const f = feature({ status: 'done', state: 'started', starts: [start], changedSinceStart: [{ kind: 'goal', field: 'text', before: 'Cancel', after: 'Cancel early' }] });
  const { host } = await openFeature(f);
  assert.deepEqual([...host.querySelectorAll('.req-changed .req-change-line')].map(text), ['Goal: Cancel Cancel early']);
  assert.equal(host.querySelector('.req-changed-files'), null);
});

test('Decide: files to ask about give "Ask about <name>"; with a rejection waiting too, "Ask about A-4 and <name>"', async () => {
  const late = att({ id: 'ratt_00000000000c', name: 'b.pdf', href: '/api/requirements/4/attachments/ratt_00000000000c' });
  const only = await openFeature(feature({ status: 'done', state: 'decide', unaskedFiles: ['ratt_00000000000c'], attachments: [att(), late] }),
    { 'POST /api/requirements/4/follow-up': OK });
  const btn = only.host.querySelector('[data-ui="follow-up"]');
  assert.equal(btn.textContent, 'Ask about b.pdf');
  btn.click();
  await settle();
  assert.ok(only.calls.some((c) => c.method === 'POST' && c.url === '/api/requirements/4/follow-up'));
  const spec = { ...feature().spec, assumptions: [{ id: 'A-4', text: 'Full refund', status: 'rejected' }] };
  const both = await openFeature(feature({ status: 'done', state: 'decide', spec, unaskedRejections: ['A-4'], unaskedFiles: ['ratt_00000000000c'], attachments: [late] }));
  assert.equal(both.host.querySelector('[data-ui="follow-up"]').textContent, 'Ask about A-4 and b.pdf');
});

test('Decide: three to ask about read "Ask about <first> and 2 more"; a file still being read is not offered; rejections alone keep "Done, ask about"', async () => {
  const mk = (id, name, over = {}) => att({ id, name, href: `/api/requirements/4/attachments/${id}`, ...over });
  const spec = { ...feature().spec, assumptions: [{ id: 'A-4', text: 'Full refund', status: 'rejected' }] };
  const three = await openFeature(feature({ status: 'done', state: 'decide', spec, unaskedRejections: ['A-4'],
    unaskedFiles: ['ratt_00000000000b', 'ratt_00000000000c'], attachments: [mk('ratt_00000000000b', 'a.pdf'), mk('ratt_00000000000c', 'b.pdf')] }));
  assert.equal(three.host.querySelector('[data-ui="follow-up"]').textContent, 'Ask about A-4 and 2 more');
  const reading = await openFeature(feature({ status: 'done', state: 'decide', unaskedFiles: ['ratt_00000000000c'],
    attachments: [mk('ratt_00000000000c', 'b.pdf', { status: 'reading', summary: '' })] }));
  assert.equal(reading.host.querySelector('[data-ui="follow-up"]'), null, 'the follow-up waits for the read (D8)');
  // one read, one still being read: no file button at all, the follow-up takes both after the read
  const mixed = await openFeature(feature({ status: 'done', state: 'decide', unaskedFiles: ['ratt_00000000000b', 'ratt_00000000000c'],
    attachments: [mk('ratt_00000000000b', 'a.pdf'), mk('ratt_00000000000c', 'b.pdf', { status: 'reading', summary: '' })] }));
  assert.equal(mixed.host.querySelector('[data-ui="follow-up"]'), null);
  const mixedRej = await openFeature(feature({ status: 'done', state: 'decide', spec, unaskedRejections: ['A-4'], unaskedFiles: ['ratt_00000000000b', 'ratt_00000000000c'],
    attachments: [mk('ratt_00000000000b', 'a.pdf'), mk('ratt_00000000000c', 'b.pdf', { status: 'reading', summary: '' })] }));
  assert.equal(mixedRej.host.querySelector('[data-ui="follow-up"]').textContent, 'Done, ask about A-4', 'a rejection still asks as in A2');
  const rej = await openFeature(feature({ status: 'done', state: 'decide', spec, unaskedRejections: ['A-4'] }));
  assert.equal(rej.host.querySelector('[data-ui="follow-up"]').textContent, 'Done, ask about A-4');
});

test('Decide without assumptions: the panel is named for the new file or the new files', async () => {
  const mk = (id, name) => att({ id, name, href: `/api/requirements/4/attachments/${id}` });
  const one = await openFeature(feature({ status: 'done', state: 'decide', unaskedFiles: ['ratt_00000000000b'], attachments: [mk('ratt_00000000000b', 'a.pdf')] }));
  assert.equal(one.host.querySelector('.req-decide').getAttribute('aria-label'), 'Ask about the new file');
  const two = await openFeature(feature({ status: 'done', state: 'decide', unaskedFiles: ['ratt_00000000000b', 'ratt_00000000000c'],
    attachments: [mk('ratt_00000000000b', 'a.pdf'), mk('ratt_00000000000c', 'b.pdf')] }));
  assert.equal(two.host.querySelector('.req-decide').getAttribute('aria-label'), 'Ask about the new files');
  assert.equal(two.host.querySelector('[data-ui="follow-up"]').textContent, 'Ask about a.pdf and b.pdf');
});

test('style.css: board 18 rules inside the Requirements block, tokens only', () => {
  assertInRequirementsBlock(['.req-build-files', '.req-fpick', '.req-fpick.on', '.req-changed-files']);
});

test('style.css: board 18 on the type scale and the 6px corner; AA inks; 44px hit areas at phone width', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const block = css.slice(start, css.indexOf('/* ── marketplace P3 ── */'));
  const rule = (sel) => { const at = block.indexOf(`\n${sel}{`); return at < 0 ? '' : block.slice(at + sel.length + 2, block.indexOf('}', at)); };
  const chip = rule('.req-fpick');
  assert.match(chip, /border:1px dashed /);
  assert.match(chip, /border-radius:var\(--r-sm\)/);
  assert.match(chip, /font-size:var\(--fs-meta\)/);
  assert.match(chip, /color:var\(--ink-2\)/, 'the name and the + on --panel: 6.6:1');
  // attached (user decision): a green outline and a green check, no fill (A2's .req-confirm[aria-pressed="true"] pattern);
  // on .on, so ui-shared-controls' "no on control is filled green" watches it
  assert.equal(rule('.req-fpick.on'), 'border:1px solid var(--green-ink-strong);background:var(--panel);color:var(--green-ink-strong)', 'the check and outline 5.7:1 on --panel');
  assert.equal(rule('.req-fpick.on .req-fpick-name'), 'color:var(--ink)', 'one weight on and off: no shift when pressed');
  assert.doesNotMatch(block, /(?:^|\n)\.req-fpick(?![\w-])[^{]*\{[^}]*(?:--green-bg|font-weight)/, 'no green fill and no weight change on any chip rule');
  assert.doesNotMatch(block, /\.req-fpick\[aria-pressed/, 'no aria-pressed selector beside .on');
  assert.match(rule('.req-fpick-group'), /color:var\(--ink-2\)/);
  const phone = block.slice(block.indexOf('/* Board 18 at phone width'));
  assert.match(phone, /\.req-fpick::after\{content:"";position:absolute;inset:-8px 0\}/);
  assert.match(phone, /\.req-fpicks\{row-gap:14px\}/);
});

// ── board 19: the brief's Documents ─────────────────
const BRIEF_URL = '/api/requirements/brief/project/shop-1';
const madeBrief = (over = {}) => ({
  brief: { id: 3, scopeType: 'project', scopeKey: 'shop-1', status: 'ready', sections: { product: 'A shop.', users: [{ name: 'Buyer', can: 'buys', source: 'glossary.pdf' }],
    terms: [{ term: 'Order', meaning: 'a purchase', source: 'glossary.pdf' }], areas: [{ name: 'Orders', text: 'checkout', status: 'exists', files: [], source: 'glossary.pdf' }] },
  edited: {}, sources: [{ project: 'shop-1', branch: 'main', ref: 'refs/heads/main', sha: '3f9c2a1deadbeef00' }], files: [], seed: null, model: 'claude-opus-5-5',
  costUsd: 1.42, error: null, madeBy: 'po', madeAt: new Date(Date.now() - 2 * 86400000).toISOString(), updatedAt: '2026-10-21T10:00:00Z' },
  target: { name: 'shop', branch: 'main', repositories: 1, leftOut: [], slow: [] }, notes: { scopeType: 'project', scopeKey: 'shop-1', body: '', lookAtCode: true },
  estimate: { costUsd: 1.5, model: { id: 'claude-opus-5-5', label: 'Opus 5.5' } }, usedBy: [], staleness: null,
  documents: [doc({ sendWithEveryRun: false })], interview: INTERVIEW, resetPeriod: 'monthly', ...over });
const openBriefPage = async (body, extra = {}) => {
  const calls = fakeApi({ ...BASE, [`GET ${BRIEF_URL}`]: () => body, ...extra });
  const m = make();
  await m.view.show('brief/project/shop-1');
  return { ...m, calls };
};

test('board 19: the first card of the right column; head, hint, Add documents, rows with Send with every run, the footer', async () => {
  const { host } = await openBriefPage(madeBrief());
  const side = host.querySelector('.req-brief-side');
  const card = side.firstElementChild;
  assert.equal(card.getAttribute('aria-label'), 'Documents');
  assert.equal(card.querySelector('h3').textContent, 'Documents · 1');
  assert.equal(card.querySelector('.req-files-head .hint').textContent, 'Worca uses these for every feature in shop.');
  assert.equal(card.querySelector('[data-ui="docs-add"]').textContent, 'Add documents');
  const sw = card.querySelector('[data-ui="file-send-ratt_0000000000d1"]');
  assert.deepEqual([sw.getAttribute('aria-label'), text(sw.closest('.switch-row'))], ['Send glossary.pdf with every run', 'Send with every run']);
  assert.equal(card.querySelector('.req-docs-foot').textContent, 'Interviews use a new document right away. The brief\'s sections change only when you Refresh it. '
    + '“Send with every run” adds the document to every run started from a shop feature; each start card lists it.');
  assert.ok([...host.querySelectorAll('.req-brief-chips .chip')].some((c) => c.textContent === '1 document'));
  assert.match(text(host.querySelector('.req-brief-how > p')), /^Every interview round for shop reads the brief and these documents\. New features no longer need their own look/);
});

test('board 19: brief items from a document end in "(from <name>)"; Add documents posts to the brief; the switch posts sendWithEveryRun', async () => {
  const { host, calls } = await openBriefPage(madeBrief(), { [`POST ${BRIEF_URL}/documents`]: madeBrief(), [`PATCH ${DOC_HREF}`]: madeBrief() });
  for (const sel of ['.req-brief-users li', '.req-brief-terms', '.req-brief-area']) assert.match(text(host.querySelector(sel)), /\(from glossary\.pdf\)/, sel);
  pick(host.querySelector('.req-docs input[type="file"]'), [mkFile('tone.md', 'friendly')]);
  await settle();
  assert.deepEqual(calls.find((c) => c.method === 'POST').body.attachments.map((x) => x.name), ['tone.md']);
  const sw = host.querySelector('[data-ui="file-send-ratt_0000000000d1"]');
  sw.checked = true;
  sw.dispatchEvent(new window.Event('change'));
  await settle();
  assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { sendWithEveryRun: true });
});

test('a brief not made yet shows board 11 unchanged: no Documents card; Delete the brief names its documents', async () => {
  const none = await openBriefPage({ ...madeBrief(), brief: null, documents: [] });
  assert.equal(none.host.querySelector('.req-docs'), null);
  const empty = await openBriefPage(madeBrief({ documents: [] }));
  assert.equal(empty.host.querySelector('.req-docs .req-files-empty').textContent, 'No documents yet.');
  const { host } = await openBriefPage(madeBrief(), { [`DELETE ${BRIEF_URL}`]: { ...madeBrief(), brief: null, documents: [] } });
  asked.length = 0;
  host.querySelector('[data-ui="brief-more"]').click();
  host.querySelector('[data-ui="mi-brief-delete"]').click();
  await settle();
  assert.equal(asked[0], 'Delete the brief? No feature uses this brief yet. Its 1 document is deleted too.');
});

test('style.css: board 19 rules inside the Requirements block, tokens only', () => {
  assertInRequirementsBlock(['.req-docs-foot', '.req-brief-src']);
});

// ── board 19: the documents behave as the Files card's files ─────────────────
const DOC2 = `${BRIEF_URL}/documents/ratt_0000000000d2`;
const docN = (i, over = {}) => doc({ id: `ratt_00000000${String(i).padStart(2, '0')}dd`, name: `d${i}.md`, kind: 'text', href: `${BRIEF_URL}/documents/ratt_00000000${String(i).padStart(2, '0')}dd`, ...over });

test('board 19: a document row is the Files card row: name, kind · size · cost, What Worca took from it (edited by you), the pencil and the ⋯', async () => {
  const { host } = await openBriefPage(madeBrief({ documents: [doc({ summaryEdited: true, summary: 'Words of the shop.' })] }));
  const row = host.querySelector('.req-docs .req-file[data-file="ratt_0000000000d1"]');
  assert.equal(row.querySelector('.req-file-name').textContent, 'glossary.pdf');
  assert.equal(row.querySelector('.req-file-name').getAttribute('href'), DOC_HREF);
  assert.equal(row.querySelector('.req-file-meta').textContent, 'PDF · 2.1 MB · read for $0.12');
  assert.equal(text(row.querySelector('.req-file-cap')), 'What Worca took from it · edited by you');
  assert.equal(row.querySelector('.req-file-took').textContent, 'Words of the shop.');
  assert.equal(row.querySelector('.req-file-pencil').getAttribute('aria-label'), 'Edit what Worca took from glossary.pdf');
  assert.equal(row.querySelector('[data-ui="file-more-ratt_0000000000d1"]').getAttribute('aria-label'), 'More for glossary.pdf');
  host.querySelector('[data-ui="file-more-ratt_0000000000d1"]').click();
  const list = host.querySelector('[data-menu="file-ratt_0000000000d1"] [role="menu"]');
  assert.equal(list.hidden, false);
  assert.deepEqual(labels(list), ['Open', 'Edit what Worca took from it', 'Ask about this file…', 'Replace with a newer version…', 'Read again', '—', 'Remove']);
  assert.equal(host.querySelector('.req-docs .req-files-privacy').textContent,
    'Worca sends each file to Opus 5.5 to read it. Text is checked for keys and passwords first; images and PDFs go as they are.');
});

test('board 19: a document being read or asked about waits as a file does: Reading… / Asking…, only Open and Remove, no switch while read', async () => {
  const { host } = await openBriefPage(madeBrief({ documents: [doc({ status: 'reading', summary: null }),
    doc({ id: 'ratt_0000000000d2', name: 'tone.md', kind: 'text', asking: 'the tone', href: DOC2 })] }));
  const [one, two] = host.querySelectorAll('.req-docs .req-file');
  assert.equal(one.querySelector('.badge.blue').textContent, 'Reading…');
  assert.equal(one.querySelector('.badge.blue').getAttribute('role'), 'status');
  assert.equal(one.querySelector('.switch-row'), null, 'no switch while read (D1)');
  assert.equal(two.querySelector('.req-file-asking').textContent, 'Worca is looking for: “the tone”…');
  assert.equal(two.querySelector('.badge.blue').textContent, 'Asking…');
  for (const id of ['ratt_0000000000d1', 'ratt_0000000000d2']) {
    host.querySelector(`[data-ui="file-more-${id}"]`).click();
    assert.deepEqual(labels(host.querySelector(`[data-menu="file-${id}"] [role="menu"]`)), ['Open', '—', 'Remove'], id);
  }
});

test('board 19: the summary editor on a document: Escape cancels to the pencil; Save patches the document and comes back to it', async () => {
  const { host, calls } = await openBriefPage(madeBrief(), { [`PATCH ${DOC_HREF}`]: madeBrief() });
  host.querySelector('.req-docs .req-file-pencil').click();
  let ta = host.querySelector('[data-ui="file-edit-text-ratt_0000000000d1"]');
  assert.equal(document.activeElement, ta, 'the editor takes the focus');
  ta.value = 'Half typed';
  ta.dispatchEvent(new window.Event('input'));
  const ev = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  ta.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(host.querySelector('[data-ui="file-edit-text-ratt_0000000000d1"]'), null);
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-edit-ratt_0000000000d1');
  host.querySelector('.req-docs .req-file-pencil').click();
  ta = host.querySelector('[data-ui="file-edit-text-ratt_0000000000d1"]');
  ta.value = 'The shop words.';
  ta.dispatchEvent(new window.Event('input'));
  host.querySelector('[data-ui="file-save-ratt_0000000000d1"]').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.method === 'PATCH'), { method: 'PATCH', url: DOC_HREF, body: { summary: 'The shop words.' } });
  assert.equal(document.activeElement.getAttribute('data-ui'), 'file-edit-ratt_0000000000d1');
});

test('board 19: the editor keeps its text, focus and caret across a live repaint of the brief page', async () => {
  const { host, view } = await openBriefPage(madeBrief());
  host.querySelector('.req-docs .req-file-pencil').click();
  const ta = host.querySelector('[data-ui="file-edit-text-ratt_0000000000d1"]');
  ta.value = 'abcdefgh';
  ta.dispatchEvent(new window.Event('input'));
  ta.focus();
  ta.setSelectionRange(2, 5);
  await view.changed(undefined, 'project:shop-1');
  const now = host.querySelector('[data-ui="file-edit-text-ratt_0000000000d1"]');
  assert.notEqual(now, ta, 'repainted');
  assert.deepEqual([now.value, document.activeElement === now, now.selectionStart, now.selectionEnd], ['abcdefgh', true, 2, 5]);
});

test('board 19: Ask about this file… on a document posts the question to the document', async () => {
  const { host, calls } = await openBriefPage(madeBrief(), { [`POST ${DOC_HREF}/ask`]: madeBrief() });
  host.querySelector('[data-ui="file-more-ratt_0000000000d1"]').click();
  host.querySelector('[data-ui="fmi-ask-ratt_0000000000d1"]').click();
  const input = host.querySelector('[data-ui="file-ask-text-ratt_0000000000d1"]');
  assert.equal(document.activeElement, input);
  input.value = 'the refund words';
  input.dispatchEvent(new window.Event('input'));
  host.querySelector('[data-ui="file-ask-go-ratt_0000000000d1"]').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { question: 'the refund words' });
  assert.equal(calls.find((c) => c.method === 'POST').url, `${DOC_HREF}/ask`);
});

test('board 19: Replace on a document: the dialog keeps “Send with every run” and the document hint; Replace posts to the document', async () => {
  const { calls } = await openBriefPage(madeBrief({ documents: [doc()] }), { [`POST ${DOC_HREF}/replace`]: madeBrief() });
  pick(document.querySelector('[data-menu="file-ratt_0000000000d1"] input[type="file"]'), [mkFile('glossary-v2.pdf', '%PDF-1.7 v2', 'application/pdf')]);
  const dlg = document.querySelector('.req-dialog[role="dialog"]');
  assert.equal(dlg.querySelector('h2').textContent, 'Replace glossary.pdf');
  assert.equal(text(dlg.querySelector('.req-replace-lead')), 'New file: glossary-v2.pdf · PDF · 11 B. Worca reads it again (about $0.12); “Send with every run” stays on.');
  assert.equal(dlg.querySelector('.req-replace-hint').textContent, "Interviews use the new version right away; the brief's sections change only when you Refresh it.");
  dlg.querySelector('[data-ui="replace-go"]').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.url === `${DOC_HREF}/replace`).body.attachments.map((x) => x.name), ['glossary-v2.pdf']);
  assert.equal(document.querySelector('.req-dialog'), null);
});

test('board 19: Remove asks first, deletes the document, and hands the focus to Add documents when none is left', async () => {
  let page = madeBrief();
  const { host, calls } = await openBriefPage(null, { [`GET ${BRIEF_URL}`]: () => page,
    [`DELETE ${DOC_HREF}`]: () => { page = madeBrief({ documents: [] }); return page; } });
  asked.length = 0;
  host.querySelector('[data-ui="file-more-ratt_0000000000d1"]').click();
  host.querySelector('[data-ui="fmi-remove-ratt_0000000000d1"]').click();
  await settle();
  assert.equal(asked[0], 'Remove glossary.pdf? The file and what Worca took from it are deleted.');
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url === DOC_HREF));
  assert.equal(host.querySelector('.req-docs .req-files-empty').textContent, 'No documents yet.');
  assert.equal(document.activeElement.getAttribute('data-ui'), 'docs-add');
});

test("board 19: a refused pick says so in the card's alert line (bold names); the accepted ones still post; the focus goes back to Add documents", async () => {
  const nine = Array.from({ length: 9 }, (_, i) => docN(i));
  const { host, calls } = await openBriefPage(madeBrief({ documents: nine }), { [`POST ${BRIEF_URL}/documents`]: madeBrief({ documents: nine }) });
  const alert = host.querySelector('.req-docs .req-file-refused');
  assert.deepEqual([alert.getAttribute('role'), alert.hidden], ['alert', true], 'one stable alert node, hidden while empty');
  pick(host.querySelector('.req-docs input[type="file"]'), [mkFile('plan.docx', 'x'), mkFile('a.md', 'a'), mkFile('b.md', 'b')]);
  await settle();
  const now = host.querySelector('.req-docs .req-file-refused');
  assert.equal(now, alert, 'the same node');
  assert.equal(text(now), 'plan.docx was not added: Worca reads text, images and PDF. Save it as PDF to attach it here. b.md was not added: a brief takes up to 10 documents.');
  assert.deepEqual([...now.querySelectorAll('b')].map((b) => b.textContent), ['plan.docx', 'b.md']);
  assert.deepEqual(calls.find((c) => c.method === 'POST').body.attachments.map((x) => x.name), ['a.md']);
  assert.equal(document.activeElement.getAttribute('data-ui'), 'docs-add');
});

test('board 19: at 10 documents Add documents is disabled; a document Start could not send (sendable: false) cannot be switched on', async () => {
  const ten = Array.from({ length: 10 }, (_, i) => docN(i, { sendWithEveryRun: false, sendable: i !== 0 }));
  const { host } = await openBriefPage(madeBrief({ documents: ten }));
  assert.equal(host.querySelector('[data-ui="docs-add"]').disabled, true);
  assert.equal(host.querySelector('.req-docs h3').getAttribute('data-ui'), 'docs-head');
  assert.equal(host.querySelector('.req-docs h3').getAttribute('tabindex'), '-1');
  const sw = host.querySelector('[data-ui="file-send-ratt_0000000000dd"]');
  assert.equal(sw.disabled, true);
  assert.equal(document.getElementById(sw.getAttribute('aria-describedby')).textContent,
    'd0.md cannot go with the run: Worca could not open the stored file. Replace it, or leave it out of the run.');
  assert.equal(host.querySelector('[data-ui="file-send-ratt_0000000001dd"]').disabled, false);
  const on = await openBriefPage(madeBrief({ documents: [doc({ sendable: false, sendWithEveryRun: true })] }));
  assert.equal(on.host.querySelector('[data-ui="file-send-ratt_0000000000d1"]').disabled, false, 'switching off still works');
});

test('board 19: names, summaries and sources are text only', async () => {
  const b = madeBrief();
  const { host } = await openBriefPage(madeBrief({ documents: [doc({ name: '<img src=x onerror=alert(1)>.md', summary: '<b>bold</b>' })],
    brief: { ...b.brief, sections: { ...b.brief.sections, users: [{ name: 'Buyer', can: 'buys', source: '<i>x</i>.md' }] } } }));
  assert.equal(host.querySelector('.req-docs img'), null);
  assert.equal(host.querySelector('.req-docs .req-file-took b'), null);
  assert.equal(host.querySelector('.req-brief-users i'), null);
  assert.match(text(host.querySelector('.req-brief-users li')), /\(from <i>x<\/i>\.md\)$/);
});

test("board 19: without documents the page is A7's: How Worca uses it reads the brief, no chip; a pre-A8 view has no card; Delete names 2", async () => {
  const empty = await openBriefPage(madeBrief({ documents: [] }));
  assert.match(text(empty.host.querySelector('.req-brief-how > p')), /^Every interview round for shop reads it\. New features no longer need their own look/);
  assert.ok(![...empty.host.querySelectorAll('.req-brief-chips .chip')].some((c) => /document/.test(c.textContent)));
  const { documents, interview, resetPeriod, ...old } = madeBrief();
  const a7 = await openBriefPage(old);
  assert.equal(a7.host.querySelector('.req-docs'), null);
  assert.equal(a7.host.querySelector('.req-brief-side').firstElementChild.getAttribute('aria-label'), 'How Worca uses it');
  const two = await openBriefPage(madeBrief({ documents: [doc(), doc({ id: 'ratt_0000000000d2', name: 'tone.md', href: DOC2 })] }));
  asked.length = 0;
  answer = false;
  two.host.querySelector('[data-ui="brief-more"]').click();
  two.host.querySelector('[data-ui="mi-brief-delete"]').click();
  await settle();
  answer = true;
  assert.equal(asked[0], 'Delete the brief? No feature uses this brief yet. Its 2 documents are deleted too.');
  assert.ok([...two.host.querySelectorAll('.req-brief-chips .chip')].some((c) => c.textContent === '2 documents'));
  assert.equal(two.host.querySelector('.req-docs h3').textContent, 'Documents · 2');
});

test('style.css: board 19 at phone width: the Documents card shares the Files card rules (44px hit areas), the source hint is on the type scale', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const block = css.slice(start, css.indexOf('/* ── marketplace P3 ── */'));
  const rule = (sel) => { const at = block.indexOf(`\n${sel}{`); return at < 0 ? '' : block.slice(at + sel.length + 2, block.indexOf('}', at)); };
  assert.match(rule('.req-docs .req-docs-foot'), /border-top:1px solid var\(--line\)/);
  assert.match(rule('.req-brief-src'), /font-size:var\(--fs-meta\)/);
  assert.match(block, /\.req-files \.switch-row::after\{content:"";position:absolute;inset:-8px 0\}/, 'the Documents card is a .req-files card');
});
