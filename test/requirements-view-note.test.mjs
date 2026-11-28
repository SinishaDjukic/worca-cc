// test/requirements-view-note.test.mjs — the Requirements page's own Start goes through the run setup overlay's note step
// (Auto included), asks before a second live run, re-sends the note after a NOT_READY, and the runs list shows each start's note.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#requirements' });
for (const k of ['document', 'location', 'Event', 'HTMLElement', 'window']) Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true, writable: true });
window.confirm = () => true;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };
after(() => window.close());
const { createRequirementsView } = await import('../ui/public/requirements-view.mjs');
const { RUN_IN_PROGRESS_TEXT } = await import('../ui/public/run-setup-overlay.mjs');

const CHECKS = [
  { key: 'goal', ok: true, label: 'Goal with a success measure', hint: '' },
  { key: 'assumptions', ok: false, label: 'Every assumption decided', hint: '1 to decide' },
];
const readiness = (over = {}) => ({ ok: false, passed: 1, total: 2, checks: CHECKS, overridable: true, ...over });
const ALL_OK = () => readiness({ ok: true, passed: 2, checks: CHECKS.map((c) => ({ ...c, ok: true, hint: '' })) });
const feature = (over = {}) => ({
  seq: 4, id: 'FEAT-4', scopeType: 'project', scopeKey: 'shop-1', title: 'Cancel order', status: 'done', rounds: 2, costUsd: 0.4, busy: false,
  orientation: { summary: 'x', files: [], skipped: null },
  spec: { goal: { text: 'Cancel', measure: '' }, actors: ['Customer'], flow: [], edgeCases: [], rules: [], outOfScope: [],
    criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }], assumptions: [{ id: 'A-1', text: 'Full refund', status: 'open' }], openQuestions: [], edited: {} },
  pending: null, lastError: null, state: 'ready', readiness: ALL_OK(), starts: [], unaskedRejections: [], changedSinceStart: [], ...over,
});
const start = (over = {}) => ({ version: 1, runId: 'r0', ready: true, failing: [], reason: null, workflowId: 'wf_auto', sourceBranch: null,
  run: { status: 'done', phase: null, costUsd: 0.1, href: '#running/r0' }, ...over });
const STARTED = { __status: 201, body: { runId: 'r9', version: 1, feature: feature({ state: 'started', starts: [start({ runId: 'r9' })] }), turns: [] } };

function fakeApi(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ method, url, body: opts.body ? JSON.parse(opts.body) : undefined });
    const hit = routes[`${method} ${url}`];
    let body = typeof hit === 'function' ? hit(calls.at(-1)) : hit;
    let status = body !== undefined ? 200 : 404;
    if (body && body.__status) { status = body.__status; body = body.body; }
    return { ok: status < 400, status, json: async () => body ?? { error: 'not found' }, text: async () => '# md' };
  };
  return calls;
}
const BASE = (f) => ({
  'GET /api/requirements/4': () => ({ feature: f(), turns: [] }),
  'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop', path: '/p/shop' }] }, 'GET /api/workspaces': { workspaces: [] },
  'GET /api/workflows': { workflows: [] }, 'GET /api/branches?projectDir=%2Fp%2Fshop': { branches: ['main'], current: 'main' },
  'PUT /api/requirements/4/early-start-reason': { earlyStartReason: 'Sprint' },
  'POST /api/requirements/4/note-check': { conflicts: [] },
});
function make(deps = {}) {
  const host = document.createElement('div');
  const opened = [];
  const view = createRequirementsView({ host, subEl: document.createElement('div'), msgEl: document.createElement('p'),
    deps: { route: () => {}, openRun: (id) => opened.push(id), ...deps } });
  document.body.append(host);
  return { host, view, opened };
}
const overlay = () => document.querySelector('.req-runsetup');
const ui = (name) => document.querySelector(`[data-ui="${name}"]`);
const type = (el, value) => { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
const posts = (calls, url) => calls.filter((c) => c.method === 'POST' && c.url === `/api/requirements/4/${url}`);

test('Auto Start opens the note step first; nothing is posted until the overlay confirms, then the note goes with the start', async () => {
  const calls = fakeApi({ ...BASE(() => feature()), 'POST /api/requirements/4/start': STARTED });
  const { host, view, opened } = make();
  await view.show('feature/4');
  host.querySelector('[data-ui="start-go"]').click();
  await settle();
  assert.ok(overlay(), 'the overlay opens in Auto mode');
  assert.ok(ui('runsetup-note'), 'with the note box');
  assert.equal(posts(calls, 'start').length, 0, 'nothing is posted before it is confirmed');
  type(ui('runsetup-note'), '  Use the new button  ');
  ui('runsetup-go').click();
  await settle();
  assert.equal(posts(calls, 'note-check')[0].body.note, 'Use the new button');
  assert.deepEqual(posts(calls, 'start').map((c) => c.body), [{ workflowId: 'wf_auto', note: 'Use the new button' }]);
  assert.deepEqual(opened, ['r9']);
  assert.equal(overlay(), null);
  host.remove();
});

test('Auto Start without a note posts none of the note fields', async () => {
  const calls = fakeApi({ ...BASE(() => feature()), 'POST /api/requirements/4/start': STARTED });
  const { host, view } = make();
  await view.show('feature/4');
  host.querySelector('[data-ui="start-go"]').click();
  await settle();
  ui('runsetup-go').click();
  await settle();
  assert.deepEqual(posts(calls, 'start').map((c) => c.body), [{ workflowId: 'wf_auto' }]);
  assert.equal(posts(calls, 'note-check').length, 0, 'a blank note is not checked');
  host.remove();
});

test('not-Ready Auto: the reason first, then the note step, then one start carrying both', async () => {
  const calls = fakeApi({ ...BASE(() => feature({ state: 'decide', readiness: readiness() })), 'POST /api/requirements/4/start': STARTED });
  const { host, view } = make();
  await view.show('feature/4');
  host.querySelector('[data-ui="start-anyway"]').click();
  await settle(3);
  const dlg = document.querySelector('.req-dialog');
  assert.equal(overlay(), null, 'the reason comes before the overlay');
  type(dlg.querySelector('textarea'), 'Sprint');
  dlg.querySelector('.btn-primary').click();
  await settle();
  assert.ok(overlay(), 'then the note step');
  assert.equal(posts(calls, 'start').length, 0);
  type(ui('runsetup-note'), 'Keep it small');
  ui('runsetup-go').click();
  await settle();
  assert.deepEqual(posts(calls, 'start').map((c) => c.body), [{ reason: 'Sprint', workflowId: 'wf_auto', note: 'Keep it small' }]);
  host.remove();
});

test('a conflicting note started anyway sends noteOverrides; a NOT_READY answer re-opens the reason and re-sends the note with it', async () => {
  const calls = fakeApi({
    ...BASE(() => feature()),
    'POST /api/requirements/4/note-check': { conflicts: [{ quote: 'v1', why: 'The spec says v2' }] },
    'POST /api/requirements/4/start': (c) => (c.body.reason ? STARTED
      : { __status: 409, body: { error: 'This feature is not Ready.', failing: ['assumptions'] } }),
  });
  const { host, view, opened } = make();
  await view.show('feature/4');
  host.querySelector('[data-ui="start-go"]').click();
  await settle();
  type(ui('runsetup-note'), 'Use v1');
  ui('runsetup-go').click();
  await settle();
  ui('runsetup-anyway').click();
  await settle();
  assert.equal(overlay(), null, 'the overlay closed');
  const dlg = document.querySelector('.req-dialog');
  assert.match(dlg.textContent, /Every assumption decided/);
  type(dlg.querySelector('textarea'), 'Late reason');
  dlg.querySelector('.btn-primary').click();
  await settle();
  const sent = posts(calls, 'start').map((c) => c.body);
  assert.deepEqual(sent[0], { workflowId: 'wf_auto', note: 'Use v1', noteOverrides: true });
  assert.deepEqual(sent[1], { reason: 'Late reason', workflowId: 'wf_auto', note: 'Use v1', noteOverrides: true });
  assert.deepEqual(opened, ['r9']);
  host.remove();
});

const LIVE = [start({ run: { status: 'running', phase: 'plan', costUsd: 0.1, href: '#running/r0' } })];

test('a live run: the confirm comes before the overlay, Cancel stops, and confirming sends confirmRunning', async () => {
  const calls = fakeApi({ ...BASE(() => feature({ state: 'ready', starts: LIVE })), 'POST /api/requirements/4/start': STARTED });
  const { host, view } = make();
  await view.show('feature/4');
  host.querySelector('[data-ui="start-go"]').click();
  await settle();
  assert.equal(overlay(), null, 'no overlay before the confirm');
  assert.match(document.querySelector('.req-dialog').textContent, new RegExp(RUN_IN_PROGRESS_TEXT));
  ui('run-confirm-cancel').click();
  await settle();
  assert.equal(document.querySelector('.req-dialog'), null);
  assert.equal(posts(calls, 'start').length, 0);
  host.querySelector('[data-ui="start-go"]').click();
  await settle();
  ui('run-confirm-go').click();
  await settle();
  assert.ok(overlay(), 'the overlay follows the confirm');
  ui('runsetup-go').click();
  await settle();
  assert.deepEqual(posts(calls, 'start').map((c) => c.body), [{ workflowId: 'wf_auto', confirmRunning: true }]);
  host.remove();
});

test('a server RUN_IN_PROGRESS answer stays in the overlay and the next press sends confirmRunning', async () => {
  const calls = fakeApi({ ...BASE(() => feature()),
    'POST /api/requirements/4/start': (c) => (c.body.confirmRunning ? STARTED
      : { __status: 409, body: { error: 'x', code: 'RUN_IN_PROGRESS' } }) });
  const { host, view, opened } = make();
  await view.show('feature/4');
  host.querySelector('[data-ui="start-go"]').click();
  await settle();
  ui('runsetup-go').click();
  await settle();
  assert.match(overlay().textContent, new RegExp(RUN_IN_PROGRESS_TEXT));
  ui('runsetup-go').click();
  await settle();
  assert.deepEqual(posts(calls, 'start').map((c) => c.body), [{ workflowId: 'wf_auto' }, { workflowId: 'wf_auto', confirmRunning: true }]);
  assert.deepEqual(opened, ['r9']);
  host.remove();
});

test('the runs list shows each start\'s note as text, clamped with Show more, and marks an override', async () => {
  const long = `${'Long note. '.repeat(40)}<b>end</b>`;
  const f = () => feature({ state: 'started', starts: [
    start({ version: 3, runId: 'r3', note: long, noteOverrides: true }),
    start({ version: 2, runId: 'r2', note: 'Short one', noteOverrides: false }),
    start({ version: 1, runId: 'r1' })] });
  fakeApi(BASE(f));
  const { host, view } = make();
  await view.show('feature/4');
  const notes = [...host.querySelectorAll('.req-run-note')];
  assert.equal(notes.length, 2, 'a start without a note shows none');
  assert.equal(notes[0].querySelector('.req-run-note-text').textContent, long);
  assert.equal(notes[0].querySelector('b'), null, 'the note is text, never markup');
  assert.ok(notes[0].querySelector('.req-run-note-text').classList.contains('clamped'));
  assert.equal(notes[1].querySelector('[data-ui="run-note-more"]'), null, 'a short note has no Show more');
  const more = notes[0].querySelector('[data-ui="run-note-more"]');
  assert.equal(more.textContent, 'Show more');
  more.click();
  await tick();
  const open = host.querySelector('.req-run-note');
  assert.ok(!open.querySelector('.req-run-note-text').classList.contains('clamped'));
  assert.equal(open.querySelector('[data-ui="run-note-more"]').textContent, 'Show less');
  const marks = [...host.querySelectorAll('.req-run-override')];
  assert.deepEqual(marks.map((m) => m.textContent), ['Overrode the spec']);
  host.remove();
});

test('a start the guardrails refuse for a step\'s harness asks once; Allow unguarded resends with the consent; Cancel says so', async () => {
  const refusal = { error: 'Plan runs on OpenAI Codex, which cannot enforce the Normal rules.', code: 'engine-refused', overridable: true, engines: ['codex'] };
  const route = { 'POST /api/requirements/4/start': (c) => (c.body.allowUnguardedEngine ? STARTED : { __status: 409, body: refusal }) };
  const asked = [];
  let calls = fakeApi({ ...BASE(() => feature()), ...route });
  let m = make({ confirm: async (plan) => { asked.push(plan); return true; } });
  await m.view.show('feature/4');
  m.host.querySelector('[data-ui="start-go"]').click(); await settle();
  ui('runsetup-go').click(); await settle();
  assert.deepEqual(asked, [{ title: 'Start without some guardrails?', message: refusal.error, confirmLabel: 'Allow unguarded' }]);
  assert.deepEqual(posts(calls, 'start').map((c) => c.body), [{ workflowId: 'wf_auto' }, { workflowId: 'wf_auto', allowUnguardedEngine: true }]);
  assert.deepEqual(m.opened, ['r9']);
  m.host.remove();
  calls = fakeApi({ ...BASE(() => feature()), ...route });
  m = make({ confirm: async () => false });
  await m.view.show('feature/4');
  m.host.querySelector('[data-ui="start-go"]').click(); await settle();
  ui('runsetup-go').click(); await settle();
  assert.deepEqual([posts(calls, 'start').length, document.querySelector('.req-runsetup-msg').textContent], [1, 'Start cancelled.']);
  m.host.remove();
  overlay()?.remove();   // a cancelled start leaves the overlay open, on the body
});

test('a harness refusal the consent cannot lift asks nothing and reads as the server says', async () => {
  const hard = { error: 'codex is off while the credential broker is on', code: 'engine-refused', overridable: false };
  const asked = [];
  const calls = fakeApi({ ...BASE(() => feature()), 'POST /api/requirements/4/start': { __status: 409, body: hard } });
  const m = make({ confirm: async (plan) => { asked.push(plan); return true; } });
  await m.view.show('feature/4');
  m.host.querySelector('[data-ui="start-go"]').click(); await settle();
  ui('runsetup-go').click(); await settle();
  assert.deepEqual([asked, posts(calls, 'start').length, document.querySelector('.req-runsetup-msg').textContent, m.opened], [[], 1, hard.error, []]);
  m.host.remove();
  overlay()?.remove();   // the refusal leaves the overlay open, on the body
});
test('a consented resend after a harness refusal keeps the note', async () => {
  const refusal = { error: 'Plan runs on OpenAI Codex.', code: 'engine-refused', overridable: true };
  const calls = fakeApi({ ...BASE(() => feature()), 'POST /api/requirements/4/start': (c) => (c.body.allowUnguardedEngine ? STARTED : { __status: 409, body: refusal }) });
  const m = make({ confirm: async () => true });
  await m.view.show('feature/4');
  m.host.querySelector('[data-ui="start-go"]').click(); await settle();
  type(ui('runsetup-note'), 'Keep it small');
  ui('runsetup-go').click(); await settle(16);   // note-check, the refusal, the ask, the resend
  const sent = posts(calls, 'start').map((c) => c.body);
  assert.deepEqual(sent, [{ workflowId: 'wf_auto', note: 'Keep it small' }, { ...sent[0], allowUnguardedEngine: true }]);
  assert.deepEqual([m.opened, overlay()], [['r9'], null]);
  m.host.remove();
});
