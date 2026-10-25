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
