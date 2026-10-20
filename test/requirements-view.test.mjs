// test/requirements-view.test.mjs — the Requirements page module in jsdom with a fake API (design §6).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#requirements' });
for (const k of ['document', 'location', 'Event', 'HTMLElement', 'window']) Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
const clip = [];
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { clip.push(t); } } }, configurable: true, writable: true });
window.confirm = () => true;
const tick = () => new Promise((r) => setTimeout(r, 0));
after(() => window.close());
const { createRequirementsView } = await import('../ui/public/requirements-view.mjs');

const Q = [{ id: 'who', question: 'Who may cancel?', options: ['Customers', 'Support'], recommended: 'Customers', why: 'Decides the button' }];
// The six readiness checks as featureView carries them (A2 D1): three pass, three do not.
const CHECKS = [
  { key: 'goal', ok: false, label: 'Goal with a success measure', hint: 'add a success measure' },
  { key: 'criteria', ok: true, label: '1 acceptance criterion', hint: '' },
  { key: 'interview', ok: false, label: 'Interview finished', hint: '1 question waiting' },
  { key: 'openQuestions', ok: true, label: 'No open questions', hint: '' },
  { key: 'assumptions', ok: false, label: 'Every assumption decided', hint: '1 to decide' },
  { key: 'target', ok: true, label: 'Project shop is registered', hint: '' },
];
const readiness = (over = {}) => ({ ok: false, passed: 3, total: 6, checks: CHECKS, overridable: false, ...over });
const ALL_OK = () => readiness({ ok: true, passed: 6, checks: CHECKS.map((c) => ({ ...c, ok: true, hint: '' })) });
const feature = (over = {}) => ({
  seq: 4, id: 'FEAT-4', scopeType: 'project', scopeKey: 'shop-1', title: 'Cancel order', status: 'your_turn', rounds: 1, costUsd: 0.42, busy: false,
  orientation: { summary: 'Orders have a status.', files: ['src/o.js'], skipped: null },
  spec: { goal: { text: 'Cancel', measure: '' }, actors: ['Customer'], flow: [], edgeCases: [], rules: [], outOfScope: [],
    criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }], assumptions: [{ id: 'A-1', text: 'Full refund', status: 'open' }],
    openQuestions: [], edited: { actors: true } },
  pending: { turnId: 9, questions: Q, note: 'One question.' }, lastError: null,
  state: 'your_turn', readiness: readiness(), starts: [], unaskedRejections: [], changedSinceStart: [], ...over,
});
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
  const routed = [];
  const view = createRequirementsView({ host, subEl, msgEl, deps: { route: (p) => routed.push(p) } });
  return { host, msgEl, view, routed };
};

// One list row as GET /api/requirements carries it (A2 §4): the server's state, the Ready count, the latest run.
const row = (over = {}) => ({ seq: 4, id: 'FEAT-4', scopeType: 'project', scopeKey: 'shop-1', title: 'Cancel order', status: 'your_turn',
  state: 'your_turn', ready: 2, rounds: 1, costUsd: 0.42, busy: false, latestRun: null, ...over });
const LIST_BASE = { 'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop' }] }, 'GET /api/workspaces': { workspaces: [{ id: 'ws1', name: 'Storefront' }] } };
const listOf = (features, extra = {}) => ({ features, lookCostUsd: null, spend: { windowUsd: 0, totalLimitUsd: null }, ...extra });
const tabs = (host) => [...host.querySelectorAll('[role="tab"]')];
const tab = (host, re) => tabs(host).find((t) => re.test(t.textContent));
const rowOf = (host, seq) => host.querySelector(`.req-row[data-feature="${seq}"]`);
const seqs = (host) => [...host.querySelectorAll('.req-row')].map((r) => r.getAttribute('data-feature'));

test('list: grouped by project, FEAT id, state badge, cost; a row routes to the feature', async () => {
  fakeApi({
    ...LIST_BASE,
    'GET /api/requirements': listOf([row({ seq: 5, id: 'FEAT-5', title: 'Refunds', status: 'done', state: 'ready', ready: 6 }), row(),
      row({ seq: 3, id: 'FEAT-3', scopeType: 'workspace', scopeKey: 'ws1', title: 'Gift cards', state: 'looking', status: 'looking' })]),
  });
  const { host, view, routed } = make();
  await view.show('');
  assert.deepEqual([...host.querySelectorAll('.req-group h2')].map((x) => x.textContent), ['Project · shop', 'Workspace · Storefront']);
  assert.ok(host.querySelector('.req-group .card .req-row'), 'each group is a card of rows');
  const rows = [...host.querySelectorAll('.req-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.req-id').textContent), ['FEAT-5', 'FEAT-4', 'FEAT-3']);
  assert.equal(rows[1].tagName, 'BUTTON');
  assert.equal(rows[1].getAttribute('data-feature'), '4');
  assert.equal(rows[1].querySelector('.req-title').textContent, 'Cancel order');
  assert.equal(rows[1].querySelector('.badge').textContent, 'Your turn');
  assert.ok(rows[1].querySelector('.badge').classList.contains('amber'));
  assert.equal(rows[1].querySelector('.req-cost').textContent, '$0.42');
  rows[1].click();
  assert.deepEqual(routed, ['feature/4']);
});

test('list: subtitle and New feature; the filter tabs with their counts; the filter survives a repaint', async () => {
  const calls = fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf([
    row({ seq: 1, state: 'your_turn' }), row({ seq: 2, state: 'decide' }), row({ seq: 3, state: 'ready' }),
    row({ seq: 4, state: 'started', latestRun: { status: 'running', phase: 'implement', costUsd: 1, href: '#running/r1' } }),
    row({ seq: 5, state: 'thinking' }), row({ seq: 6, state: 'looking' })]) });
  const host = document.createElement('div'); const subEl = document.createElement('div'); const routed = [];
  const view = createRequirementsView({ host, subEl, msgEl: document.createElement('p'), deps: { route: (p) => routed.push(p) } });
  await view.show('');
  assert.equal(subEl.textContent, 'Define a feature with Worca before anything is built. Nothing runs until you start it.');
  const go = host.querySelector('.btn-go');
  assert.equal(go.textContent, 'New feature');
  go.click();
  assert.deepEqual(routed, ['new']);
  const list = host.querySelector('[role="tablist"]');
  assert.ok(list.classList.contains('seg'));
  assert.deepEqual(tabs(host).map((t) => t.textContent), ['All open · 6', 'Needs you · 2', 'Ready · 1', 'Started · 1', 'Archived']);
  assert.deepEqual(tabs(host).map((t) => t.getAttribute('aria-selected')), ['true', 'false', 'false', 'false', 'false']);
  assert.equal(host.querySelectorAll('.req-row').length, 6);
  tab(host, /^Needs you/).click(); await tick(); await tick();
  assert.deepEqual(seqs(host), ['1', '2']);
  assert.equal(tab(host, /^Needs you/).getAttribute('aria-selected'), 'true');
  assert.ok(tab(host, /^Needs you/).classList.contains('on'));
  assert.equal(tab(host, /^All open/).getAttribute('aria-selected'), 'false');
  await view.changed(9);
  assert.equal(tab(host, /^Needs you/).getAttribute('aria-selected'), 'true', 'kept across a live repaint');
  assert.deepEqual(seqs(host), ['1', '2']);
  tab(host, /^Ready/).click(); await tick(); await tick();
  assert.deepEqual(seqs(host), ['3']);
  tab(host, /^Started/).click(); await tick(); await tick();
  assert.deepEqual(seqs(host), ['4']);
  assert.ok(calls.every((c) => c.url !== '/api/requirements?archived=1'));
  // leaving the list and coming back keeps the filter too
  await view.show('new');
  await view.show('');
  assert.equal(tab(host, /^Started/).getAttribute('aria-selected'), 'true');
});

test('list: each state\'s badge and meta line', async () => {
  fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf([
    row({ seq: 1, state: 'your_turn', rounds: 2 }), row({ seq: 2, state: 'your_turn', rounds: 1, pendingCount: 3 }),
    row({ seq: 3, state: 'decide', ready: 4 }), row({ seq: 4, state: 'ready', ready: 6 }),
    row({ seq: 5, state: 'looking' }), row({ seq: 6, state: 'thinking' }),
    row({ seq: 7, state: 'started', latestRun: { status: 'running', phase: 'implement', costUsd: 1, href: '#running/r1' } }),
    row({ seq: 8, state: 'started', latestRun: { status: 'done', phase: null, costUsd: 1, href: '#running/r2' } }),
    row({ seq: 9, state: 'started', latestRun: null }),
    row({ seq: 10, state: 'your_turn', rounds: 1, pendingCount: 1 }),
    row({ seq: 11, state: 'decide', ready: 5, openAssumptions: 3 }), row({ seq: 12, state: 'decide', ready: 5, openAssumptions: 1 }),
    row({ seq: 13, state: 'decide', ready: 5, openAssumptions: 0 })]) });
  const { host, view } = make();
  await view.show('');
  const meta = (seq) => rowOf(host, seq).querySelector('.req-row-meta').textContent;
  const mark = (seq) => rowOf(host, seq).querySelector('.badge, .pill-run');
  assert.equal(meta(1), 'Round 2 of 6 · Your turn');
  assert.equal(meta(2), 'Round 1 of 6 · 3 questions for you');
  assert.equal(meta(10), 'Round 1 of 6 · 1 question for you');
  assert.equal(meta(3), 'Interview done · Ready 4 of 6');
  assert.equal(meta(11), 'Interview done · Ready 5 of 6 · 3 assumptions to decide');
  assert.equal(meta(12), 'Interview done · Ready 5 of 6 · 1 assumption to decide');
  assert.equal(meta(13), 'Interview done · Ready 5 of 6');
  assert.equal(meta(4), 'Ready 6 of 6');
  assert.equal(meta(5), 'Worca is looking at the code…');
  assert.equal(meta(6), 'Worca is thinking…');
  assert.equal(meta(7), 'Started · run running · Implement');
  assert.equal(meta(8), 'Started · run done');
  assert.equal(meta(9), 'Started');
  for (const [seq, label, cls] of [[1, 'Your turn', 'amber'], [3, 'Decide', 'amber'], [4, 'Ready', 'green'], [5, 'Looking', 'running'], [6, 'Thinking', 'running']]) {
    assert.ok(mark(seq).classList.contains('badge'), `FEAT-${seq} wears a badge`);
    assert.equal(mark(seq).textContent, label);
    assert.ok(mark(seq).classList.contains(cls), `FEAT-${seq} is ${cls}`);
  }
  for (const seq of [7, 8, 9]) assert.ok(mark(seq).classList.contains('pill-run'), `FEAT-${seq} wears a run pill`);
});

test('list: the run pill: colour by status, the phase while running, a pdot', async () => {
  const run = (status, phase = null) => ({ status, phase, costUsd: 0, href: '#running/x' });
  const cases = [['created', null, 'peach', 'Created'], ['starting', null, 'peach', 'Starting'], ['running', 'plan_review', 'peach', 'Plan review'],
    ['pausing', 'test', 'peach', 'Test'], ['done', 'learn', 'green', 'Done'], ['error', 'test', 'red', 'Error'], ['stopped', null, 'red', 'Stopped'],
    ['paused', 'test', '', 'Paused']];
  fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf(cases.map(([status, phase], i) => row({ seq: i + 1, state: 'started', latestRun: run(status, phase) }))) });
  const { host, view } = make();
  await view.show('');
  const COLOURS = ['peach', 'green', 'red', 'blue', 'amber', 'violet'];
  cases.forEach(([status, , cls, text], i) => {
    const pill = rowOf(host, i + 1).querySelector('.pill-run');
    assert.equal(pill.textContent, text, status);
    assert.ok(pill.querySelector('.pdot'), `${status}: a pdot`);
    assert.deepEqual(COLOURS.filter((c) => pill.classList.contains(c)), cls ? [cls] : [], status);
  });
});

test('list: Archived refetches with archived=1 and shows only the archived features', async () => {
  const calls = fakeApi({
    ...LIST_BASE,
    'GET /api/requirements': listOf([row()]),
    'GET /api/requirements?archived=1': listOf([row(), row({ seq: 6, id: 'FEAT-6', status: 'archived', state: 'archived' })]),
  });
  const { host, view } = make();
  await view.show('');
  assert.equal(host.querySelector('.req-archived-toggle'), null, 'the old toggle is gone');
  tab(host, /^Archived/).click(); await tick(); await tick();
  assert.ok(calls.some((c) => c.url === '/api/requirements?archived=1'));
  assert.equal(tab(host, /^Archived/).getAttribute('aria-selected'), 'true');
  assert.deepEqual([...host.querySelectorAll('.req-row .badge')].map((b) => b.textContent), ['Archived']);
  assert.equal(tab(host, /^All open/).textContent, 'All open · 1', 'the counts leave archived out');
  const n = calls.length;
  tab(host, /^All open/).click(); await tick(); await tick();
  assert.equal(calls.slice(n).find((c) => c.url.startsWith('/api/requirements'))?.url, '/api/requirements');
  assert.equal(host.querySelectorAll('.req-row').length, 1);
});

test('list: the spend footer, with and without a limit; an empty list or filter never shows "null"', async () => {
  fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf([row()], { spend: { windowUsd: 2.09, totalLimitUsd: 50 } }) });
  const { host, view } = make();
  await view.show('');
  assert.equal(host.querySelector('.req-spend').textContent, 'Spent on requirements this month: $2.09 of your $50.00 limit.');
  assert.ok(host.querySelector('.req-spend').classList.contains('hint'));
  fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf([row()], { spend: { windowUsd: 0.5, totalLimitUsd: null } }) });
  await view.show('');
  assert.equal(host.querySelector('.req-spend').textContent, 'Spent on requirements this month: $0.50.');
  fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf([row()], { spend: { windowUsd: 0.5, totalLimitUsd: 5, resetPeriod: 'weekly' } }) });
  await view.show('');
  assert.equal(host.querySelector('.req-spend').textContent, 'Spent on requirements this week: $0.50 of your $5.00 limit.', 'the budget period');
  fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf([row()], { spend: { windowUsd: 0.5, totalLimitUsd: null, resetPeriod: 'monthly' } }) });
  await view.show('');
  assert.equal(host.querySelector('.req-spend').textContent, 'Spent on requirements this month: $0.50.');
  tab(host, /^Ready/).click(); await tick(); await tick();
  assert.doesNotMatch(host.textContent, /null|false|undefined/);
  assert.match(host.textContent, /Nothing here/);
  fakeApi({ ...LIST_BASE, 'GET /api/requirements': { features: [] } });
  await view.show('');
  assert.doesNotMatch(host.textContent, /null|false|undefined/);
  assert.match(host.textContent, /No features yet/);
});

test('detail: question card with recommended preselected; submit posts the picks', async () => {
  const calls = fakeApi({
    'GET /api/requirements/4': { feature: feature(), turns: [] },
    'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop' }] },
    'GET /api/workspaces': { workspaces: [] },
    'POST /api/requirements/4/answers': { feature: feature({ status: 'thinking', pending: null }), turns: [] },
  });
  const { host, view } = make();
  await view.show('feature/4');
  const card = host.querySelector('.qpanel');
  assert.ok(card);
  const opts = [...card.querySelectorAll('.qopt')];
  assert.deepEqual(opts.map((o) => o.getAttribute('data-key')), ['A', 'B']);
  assert.equal(opts[0].getAttribute('aria-pressed'), 'true', 'recommended preselected');
  assert.ok(opts[0].querySelector('.qrec'));
  opts[1].click();
  assert.equal(opts[1].getAttribute('aria-pressed'), 'true');
  assert.equal(opts[0].getAttribute('aria-pressed'), 'false');
  card.querySelector('.btn-go').click();
  await new Promise((r) => setTimeout(r, 0));
  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body, { roundTurnId: 9, answers: [{ id: 'who', option: 'Support' }] });
});

test('detail: free text clears the pick; skip uses recommended; finish now', async () => {
  const calls = fakeApi({
    'GET /api/requirements/4': { feature: feature(), turns: [] },
    'GET /api/projects': { projects: [] }, 'GET /api/workspaces': { workspaces: [] },
    'POST /api/requirements/4/answers': { feature: feature({ pending: null }), turns: [] },
    'POST /api/requirements/4/finish': { feature: feature({ pending: null }), turns: [] },
  });
  const { host, view } = make();
  await view.show('feature/4');
  const free = host.querySelector('.qfree');
  free.value = 'Only managers';
  free.dispatchEvent(new window.Event('input'));
  assert.equal(host.querySelector('.qopt[aria-pressed="true"]'), null);
  host.querySelector('.req-skip').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { roundTurnId: 9, useRecommended: true, answers: [{ id: 'who', text: 'Only managers' }] });
  await view.show('feature/4');
  host.querySelector('.req-finish').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(calls.some((c) => c.method === 'POST' && c.url === '/api/requirements/4/finish'));
});

test('spec column: edited mark, criteria ids, assumption buttons; busy disables edits', async () => {
  const calls = fakeApi({
    'GET /api/requirements/4': { feature: feature(), turns: [] },
    'GET /api/projects': { projects: [] }, 'GET /api/workspaces': { workspaces: [] },
    'POST /api/requirements/4/assumptions/A-1': { feature: feature(), turns: [] },
  });
  const { host, view } = make();
  await view.show('feature/4');
  assert.ok(host.querySelector('[data-section="actors"] .req-edited'));
  assert.equal(host.querySelector('[data-criterion="R-po-1"] code').textContent, 'R-po-1');
  host.querySelector('[data-assumption="A-1"] .req-confirm').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { status: 'confirmed' });
  fakeApi({ 'GET /api/requirements/4': { feature: feature({ busy: true, status: 'thinking', pending: null }), turns: [] },
    'GET /api/projects': { projects: [] }, 'GET /api/workspaces': { workspaces: [] } });
  await view.show('feature/4');
  assert.match(host.textContent, /Worca is thinking/);
  const lockable = [...host.querySelectorAll('.req-sect-edit')];
  assert.ok(lockable.length >= 8, 'pencils, Let Worca rewrite, the add and remove icons, Confirm / Reject');
  assert.ok(lockable.every((b) => b.disabled));
});

test('error turn shows the message and Try again; a 404 says the page is off or gone', async () => {
  const calls = fakeApi({
    'GET /api/requirements/4': { feature: feature({ pending: null, lastError: 'Limit reached' }), turns: [] },
    'GET /api/projects': { projects: [] }, 'GET /api/workspaces': { workspaces: [] },
    'POST /api/requirements/4/retry': { feature: feature(), turns: [] },
  });
  const { host, msgEl, view } = make();
  await view.show('feature/4');
  assert.match(host.querySelector('.req-error').textContent, /Limit reached/);
  host.querySelector('.req-retry').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(calls.some((c) => c.url === '/api/requirements/4/retry'));
  fakeApi({});
  await view.show('feature/77');
  assert.match(msgEl.textContent, /turned off|no longer exists/);
});

const BASE = {
  'GET /api/requirements/4': () => ({ feature: feature(), turns: [] }),
  'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop' }] }, 'GET /api/workspaces': { workspaces: [] },
};
const critInput = (host) => host.querySelector('[aria-label="New acceptance criterion"]');
const openCrit = async (host) => { host.querySelector('[aria-label="Add a criterion"]').click(); await tick(); await tick(); };
const openCtx = async (host) => { btn(host, 'Project context').click(); await tick(); await tick(); };
const btn = (host, text) => [...host.querySelectorAll('button')].find((b) => b.textContent === text);

test('new form: a live update neither repaints nor fetches; create posts and routes to the feature', async () => {
  const calls = fakeApi({ ...BASE, 'POST /api/requirements': { feature: { seq: 7 } } });
  const { host, view, routed } = make();
  await view.show('new');
  host.querySelector('#req-new-title').value = 'My title';
  host.querySelector('#req-new-desc').value = 'My text';
  const n = calls.length;
  await view.changed(4);
  assert.equal(host.querySelector('#req-new-title').value, 'My title');
  assert.equal(host.querySelector('#req-new-desc').value, 'My text');
  assert.equal(calls.length, n, 'no fetch');
  host.querySelector('.btn-go').click();
  await tick();
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { scopeType: 'project', scopeKey: 'shop-1', title: 'My title', description: 'My text' });
  assert.deepEqual(routed, ['feature/7']);
});

test('feature page: a live update keeps the open editor and a half-typed criterion', async () => {
  fakeApi(BASE);
  const { host, view } = make();
  await view.show('feature/4');
  host.querySelector('[data-section="actors"] [aria-label="Edit Actors"]').click();
  await tick();
  host.querySelector('[data-section="actors"] .req-edit textarea').value = 'Customer\nSupport';
  await openCrit(host);
  assert.equal(host.querySelector('[data-section="actors"] .req-edit textarea').value, 'Customer\nSupport', 'kept across the own repaint');
  critInput(host).value = 'half typed';
  await view.changed(4);
  assert.equal(host.querySelector('[data-section="actors"] .req-edit textarea').value, 'Customer\nSupport');
  assert.equal(critInput(host).value, 'half typed');
});

test('feature page: an own repaint (Confirm) keeps the typed criterion; focus returns to the field', async () => {
  fakeApi({ ...BASE, 'POST /api/requirements/4/assumptions/A-1': { feature: feature(), turns: [] } });
  const { host, view } = make();
  document.body.append(host);
  await view.show('feature/4');
  assert.equal(critInput(host), null, 'the add row opens from the plus button');
  await openCrit(host);
  assert.equal(document.activeElement, critInput(host), 'the plus focuses the new field');
  critInput(host).value = 'half typed';
  critInput(host).focus();
  host.querySelector('[data-assumption="A-1"] .req-confirm').click();
  await tick(); await tick();
  assert.equal(critInput(host).value, 'half typed');
  critInput(host).focus();
  await view.changed(4);
  assert.equal(document.activeElement, critInput(host));
  host.remove();
});

test('feature page: the context panel keeps its text and open state across a live update', async () => {
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/context/project/shop-1': { body: 'Standing rules', lookAtCode: true },
    'PUT /api/requirements/context/project/shop-1': { ok: true } });
  const { host, view } = make();
  await view.show('feature/4');
  assert.equal(host.querySelector('.req-context'), null, 'closed until asked for');
  assert.equal(calls.filter((c) => c.url.includes('/context/')).length, 0, 'loaded lazily');
  await openCtx(host);
  assert.equal(host.querySelector('.req-context textarea').value, 'Standing rules');
  host.querySelector('.req-context textarea').value = 'New rules';
  await view.changed(4);
  await tick(); await tick();
  assert.ok(host.querySelector('.req-context'), 'still open');
  assert.equal(host.querySelector('.req-context textarea').value, 'New rules');
  assert.equal(host.querySelector('.req-context input[type=checkbox]').checked, true);
  assert.equal(calls.filter((c) => c.method === 'GET' && c.url.includes('/context/')).length, 1);
  btn(host, 'Save context').click();
  await tick();
  assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { body: 'New rules', lookAtCode: true });
});

test('new feature: back link, heading, field blocks, the For select with its groups, the code-look hint', async () => {
  fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf([]) });
  const { host, view, routed } = make();
  await view.show('new');
  const back = [...host.querySelectorAll('a, button')].find((x) => x.textContent === '← All features');
  assert.ok(back, 'a back link');
  back.click();
  assert.deepEqual(routed, ['']);
  assert.equal(host.querySelector('h2').textContent, 'New feature');
  const form = host.querySelector('.card.req-new');
  assert.ok(form);
  const fields = [...form.querySelectorAll('.field')];
  assert.deepEqual(fields.map((f) => f.querySelector('label').firstChild.textContent.trim()), ['Title', 'Describe it', 'For']);
  assert.equal(fields[0].querySelector('#req-new-title').tagName, 'INPUT');
  assert.equal(fields[1].querySelector('#req-new-desc').tagName, 'TEXTAREA');
  assert.equal(fields[1].querySelector('label .opt').textContent, 'who needs it, what they want to do, and why');
  const select = fields[2].querySelector('.select-wrap select#req-new-target');
  assert.ok(select);
  assert.deepEqual([...select.querySelectorAll('optgroup')].map((g) => g.label), ['Projects', 'Workspaces']);
  assert.deepEqual([...select.options].map((o) => o.value), ['project:shop-1', 'workspace:ws1']);
  assert.match(fields[2].querySelector('.hint').textContent, /looks at this project's code once, read-only/);
  assert.deepEqual([...form.querySelectorAll('.btn, .btn-go')].map((b) => b.textContent), ['Cancel', 'Start the interview']);
  assert.ok([...form.querySelectorAll('.btn-go')].at(-1).textContent === 'Start the interview', 'the CDP proof clicks the last .req-new .btn-go');
  assert.doesNotMatch(host.textContent, /null|false|undefined/);
});

test('new feature: the cost hint shows only when lookCostUsd is a number (from the list call)', async () => {
  const calls = fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf([], { lookCostUsd: 0.25 }) });
  const { host, view } = make();
  await view.show('new');
  assert.ok(calls.some((c) => c.method === 'GET' && c.url === '/api/requirements'));
  assert.equal(host.querySelector('.req-new-cost').textContent, 'About $0.25 for the code look, then cents per round.');
  fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf([], { lookCostUsd: null }) });
  await view.show('new');
  assert.equal(host.querySelector('.req-new-cost'), null);
  assert.ok(host.querySelector('#req-new-title'), 'the form still renders');
  fakeApi({ ...LIST_BASE });   // the list call fails: no hint, the form still renders
  await view.show('new');
  assert.equal(host.querySelector('.req-new-cost'), null);
  assert.ok(host.querySelector('#req-new-title'));
});

test('Save: exists asks, then posts overwrite and reports the path', async () => {
  let n = 0;
  const calls = fakeApi({ ...BASE, 'POST /api/requirements/4/save': () => (++n === 1 ? { __status: 409, body: { error: 'exists', path: 'specs/a.md' } } : { path: 'specs/a.md' }) });
  const { host, msgEl, view } = make();
  await view.show('feature/4');
  btn(host, 'Save to specs/').click();
  await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.url.endsWith('/save')).map((c) => c.body), [{}, { overwrite: true }]);
  assert.match(msgEl.textContent, /Saved to specs\/a\.md/);
});

test('Copy: copies the Markdown; a failing response shows an error and copies nothing', async () => {
  fakeApi({ ...BASE, 'GET /api/requirements/4/markdown': {} });
  const { host, msgEl, view } = make();
  await view.show('feature/4');
  clip.length = 0;
  btn(host, 'Copy Markdown').click(); await tick(); await tick();
  assert.deepEqual(clip, ['# md']);
  assert.match(msgEl.textContent, /Copied/);
  fakeApi({ ...BASE, 'GET /api/requirements/4/markdown': { __status: 500, body: { error: 'boom' } } });
  clip.length = 0;
  btn(host, 'Copy Markdown').click(); await tick(); await tick();
  assert.deepEqual(clip, []);
  assert.ok(msgEl.classList.contains('err'));
});

test('Archive / Restore bodies; an archived feature is not interactive', async () => {
  const calls = fakeApi({ ...BASE, 'POST /api/requirements/4/archive': { feature: feature(), turns: [] } });
  const { host, view } = make();
  await view.show('feature/4');
  btn(host, 'Archive').click();
  await tick();
  assert.deepEqual(calls.find((c) => c.url.endsWith('/archive')).body, {});
  const arch = feature({ status: 'archived', lastError: 'old error' });
  const calls2 = fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: arch, turns: [] }, 'POST /api/requirements/4/archive': { feature: arch, turns: [] } });
  await view.show('feature/4');
  assert.equal(host.querySelector('.qpanel'), null);
  assert.equal(host.querySelector('.req-retry'), null);
  assert.match(host.querySelector('.req-left').textContent, /archived/i);
  assert.equal(host.querySelector('.req-ready'), null, 'no Ready panel while archived');
  assert.equal(btn(host, 'Look again').disabled, true);
  assert.equal(btn(host, 'Archive'), undefined);
  btn(host, 'Restore').click();
  await tick();
  assert.deepEqual(calls2.find((c) => c.url.endsWith('/archive')).body, { restore: true });
});

test('Look again posts to /look', async () => {
  const calls = fakeApi({ ...BASE, 'POST /api/requirements/4/look': { feature: feature(), turns: [] } });
  const { host, view } = make();
  await view.show('feature/4');
  btn(host, 'Look again').click();
  await tick();
  assert.ok(calls.some((c) => c.method === 'POST' && c.url === '/api/requirements/4/look'));
});

test('text from the API renders as text, never as markup', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const f = feature({ title: evil });
  f.spec.criteria = [{ id: 'R-po-1', text: evil }];
  fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: f, turns: [] }, 'GET /api/requirements': { features: [f] } });
  const { host, view } = make();
  await view.show('feature/4');
  assert.equal(host.querySelector('img'), null);
  assert.ok(host.textContent.includes(evil));
  await view.show('');
  assert.equal(host.querySelector('img'), null);
});

test('a failed repaint (not 404) keeps the page and shows the message; a 404 blanks it', async () => {
  fakeApi(BASE);
  const { host, msgEl, view } = make();
  await view.show('feature/4');
  fakeApi({ ...BASE, 'GET /api/requirements/4': { __status: 500, body: { error: 'Server hiccup' } } });
  await view.changed(4);
  assert.ok(host.querySelector('.req-head'));
  assert.match(msgEl.textContent, /Server hiccup/);
  fakeApi({ 'GET /api/projects': { projects: [] }, 'GET /api/workspaces': { workspaces: [] } });
  await view.changed(4);
  assert.equal(host.querySelector('.req-head'), null);
});

test('per-item accessible names on section and assumption buttons', async () => {
  fakeApi(BASE);
  const { host, view } = make();
  await view.show('feature/4');
  const btns = [...host.querySelectorAll('[data-section="actors"] .req-sect-edit')];
  assert.deepEqual(btns.map((b) => b.getAttribute('aria-label')), ['Let Worca rewrite Actors', 'Edit Actors']);
  assert.equal(host.querySelector('.req-confirm').getAttribute('aria-label'), 'Confirm A-1');
  assert.equal(host.querySelector('.req-reject').getAttribute('aria-label'), 'Reject A-1');
});

test('context: a failed load keeps Save context disabled and sends no PUT', async () => {
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/context/project/shop-1': { __status: 500, body: { error: 'ctx down' } } });
  const { host, msgEl, view } = make();
  await view.show('feature/4');
  await openCtx(host);
  assert.match(msgEl.textContent, /ctx down/);
  assert.equal(btn(host, 'Save context').disabled, true);
  btn(host, 'Save context').click();
  await tick();
  assert.equal(calls.some((c) => c.method === 'PUT'), false);
});

test('Save: declining the overwrite confirm sends no second POST', async () => {
  const calls = fakeApi({ ...BASE, 'POST /api/requirements/4/save': { __status: 409, body: { error: 'exists', path: 'specs/a.md' } } });
  const { host, view } = make();
  await view.show('feature/4');
  const orig = window.confirm;
  window.confirm = () => false;
  btn(host, 'Save to specs/').click();
  await tick(); await tick();
  window.confirm = orig;
  assert.equal(calls.filter((c) => c.url.endsWith('/save')).length, 1);
});

test('index.html: a Simple-level, flag-gated nav row and a page section', () => {
  const html = readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<button type="button" data-nav="requirements" data-min-level="simple" data-flag="requirements" data-flag-chip>/);
  assert.match(html, /<section class="view hidden" data-view="requirements">[\s\S]*id="requirements-host"/);
  const topnav = readFileSync(new URL('../ui/public/topnav.mjs', import.meta.url), 'utf8');
  assert.match(topnav, /requirements: 'Requirements'/);
});

test('earlier rounds: one card, each answered question with its latest answer and the note; the pending one is not repeated', async () => {
  const turns = [
    { id: 2, kind: 'orientation', payload: {} },
    { id: 3, kind: 'round', payload: { questions: [{ id: 'who', question: 'Who may cancel?', options: ['Customers', 'Support'], recommended: 'Customers' }], note: 'Start <b>here</b>.' } },
    { id: 4, kind: 'answers', payload: { roundTurnId: 3, answers: [{ id: 'who', question: 'Who may cancel?', answer: 'Customers', recommended: true }] } },
    { id: 5, kind: 'answers', payload: { roundTurnId: 3, revises: true, answers: [{ id: 'who', question: 'Who may cancel?', answer: 'Support', recommended: false }] } },
    { id: 6, kind: 'round', payload: { questions: [{ id: 'until', question: 'Until when?', options: ['Until shipped', 'Until paid'], recommended: 'Until shipped' }] } },
    { id: 7, kind: 'answers', payload: { roundTurnId: 6, answers: [{ id: 'until', question: 'Until when?', answer: 'Until shipped', recommended: true }] } },
    { id: 9, kind: 'round', payload: { questions: Q, note: 'One question.' } },
  ];
  fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: feature({ rounds: 3 }), turns } });
  const { host, view } = make();
  await view.show('feature/4');
  const card = host.querySelector('.req-left .req-rounds');
  assert.ok(card.classList.contains('card'), 'one card');
  assert.equal(card.querySelector('h3').textContent, 'Earlier rounds');
  const rounds = [...card.querySelectorAll('.req-round')];
  assert.deepEqual(rounds.map((r) => r.getAttribute('data-round')), ['3', '6'], 'only the earlier rounds; the pending one is the question card');
  const [r1, r2] = rounds;
  assert.match(r1.textContent, /Who may cancel\?/);
  assert.equal(r1.querySelector('.req-round-answer').textContent, '→ Support', 'the latest answer, no recommended marker');
  assert.doesNotMatch(r1.textContent, /Customers/, 'a superseded answer is not shown');
  assert.equal(r1.querySelector('.req-round-note').textContent, 'Start <b>here</b>.', 'the note, as text');
  assert.equal(r2.querySelector('.req-round-answer').textContent, '→ Until shipped recommended');
  assert.equal(r2.querySelector('.req-round-answer code').textContent, 'recommended');
  for (const r of rounds) {
    assert.deepEqual([...r.querySelectorAll('button, input, textarea')].map((b) => b.textContent), ['Change'], 'read-only but for Change');
  }
  // the question card comes first, the earlier rounds after it
  const left = [...host.querySelector('.req-left').children];
  assert.ok(left.indexOf(host.querySelector('.qpanel')) < left.indexOf(card));
});

test('earlier rounds: a done interview lists every round, the last one with no questions shows its note and no Change', async () => {
  const turns = [
    { id: 3, kind: 'round', payload: { questions: Q, note: 'One question.' } },
    { id: 4, kind: 'answers', payload: { roundTurnId: 3, answers: [{ id: 'who', question: 'Who may cancel?', answer: 'Customers' }] } },
    { id: 6, kind: 'round', payload: { questions: [], note: 'The spec is complete.', done: true } },
  ];
  fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: feature({ status: 'done', state: 'decide', pending: null, rounds: 2 }), turns } });
  const { host, view } = make();
  await view.show('feature/4');
  const rounds = [...host.querySelectorAll('.req-round')];
  assert.deepEqual(rounds.map((d) => d.querySelector('.req-round-n').textContent), ['Round 1', 'Round 2']);
  assert.equal(rounds[1].querySelector('.req-round-note').textContent, 'The spec is complete.');
  assert.equal(rounds[1].querySelectorAll('.req-round-q').length, 0);
  assert.equal(rounds[1].querySelector('button'), null, 'nothing to change');
});

test('Change on an earlier round: the prefilled card, Cancel, Submit changes posts that round; never while locked', async () => {
  const R = [{ id: 'who', question: 'Who may cancel?', options: ['Customers', 'Support'], recommended: 'Customers' },
    { id: 'reason', question: 'Ask for a reason?', options: ['Optional', 'None'], recommended: 'Optional' }];
  const turns = [
    { id: 3, kind: 'round', payload: { questions: R, note: 'Two questions.' } },
    { id: 4, kind: 'answers', payload: { roundTurnId: 3, answers: [{ id: 'who', question: R[0].question, answer: 'Support' },
      { id: 'reason', question: R[1].question, answer: 'Only for refunds' }] } },
    { id: 6, kind: 'round', payload: { questions: [], note: 'Complete.', done: true } },
  ];
  const done = feature({ status: 'done', state: 'decide', pending: null, rounds: 2 });
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: done, turns }),
    'POST /api/requirements/4/answers': { feature: done, turns } });
  const { host, view } = make();
  await view.show('feature/4');
  assert.equal(host.querySelector('.req-revise'), null);
  btn(host, 'Change').click();
  await tick(); await tick();
  const card = () => host.querySelector('.req-left .req-revise');
  assert.ok(card().classList.contains('qpanel'));
  const left = [...host.querySelector('.req-left').children];
  assert.ok(left.indexOf(card()) < left.indexOf(host.querySelector('.req-rounds')), 'above Earlier rounds');
  assert.match(card().querySelector('.qpanel-head').textContent, /Change round 1/);
  const [b1, b2] = [...card().querySelectorAll('.qblock')];
  assert.deepEqual([...b1.querySelectorAll('.qopt')].map((o) => o.getAttribute('aria-pressed')), ['false', 'true'], 'prefilled: Support');
  assert.equal(b2.querySelector('.qfree').value, 'Only for refunds', 'prefilled: the free answer');
  assert.equal(b2.querySelector('.qopt[aria-pressed="true"]'), null);
  b1.querySelector('.qopt').click();   // Customers
  // a live update keeps the card and the changed pick
  await view.changed(4);
  assert.deepEqual([...card().querySelector('.qblock').querySelectorAll('.qopt')].map((o) => o.getAttribute('aria-pressed')), ['true', 'false']);
  btn(card(), 'Submit changes').click();
  await tick(); await tick();
  assert.deepEqual(calls.find((c) => c.method === 'POST').body,
    { roundTurnId: 3, answers: [{ id: 'who', option: 'Customers' }, { id: 'reason', text: 'Only for refunds' }] });
  assert.equal(card(), null, 'closed after the submit');
  // Cancel closes it without a post
  btn(host, 'Change').click();
  await tick(); await tick();
  assert.ok(card());
  const n = calls.filter((c) => c.method === 'POST').length;
  btn(card(), 'Cancel').click();
  await tick(); await tick();
  assert.equal(card(), null);
  assert.equal(calls.filter((c) => c.method === 'POST').length, n);
  // locked: no Change
  fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: { ...done, busy: true, status: 'thinking', state: 'thinking' }, turns } });
  await view.changed(4);
  assert.equal(btn(host, 'Change'), undefined);
  fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: { ...done, status: 'archived', state: 'archived' }, turns } });
  await view.changed(4);
  assert.equal(btn(host, 'Change'), undefined);
});

test('header: back link, FEAT code, title, state badge or run pill, chips', async () => {
  fakeApi(BASE);
  const { host, view, routed } = make();
  await view.show('feature/4');
  const back = host.querySelector('.req-back');
  assert.equal(back.textContent, '← All features');
  back.click();
  assert.deepEqual(routed, ['']);
  const head = () => host.querySelector('.req-head');
  const chips = () => [...head().querySelectorAll('.chip')].map((c) => c.textContent);
  assert.equal(head().querySelector('code').textContent, 'FEAT-4');
  assert.equal(head().querySelector('h2').textContent, 'Cancel order');
  assert.equal(head().querySelector('.badge').textContent, 'Your turn');
  assert.ok(head().querySelector('.badge').classList.contains('amber'));
  assert.deepEqual(chips(), ['Project · shop', 'Round 1 of 6', '$0.42 so far']);
  const doneReady = readiness({ passed: 4, checks: CHECKS.map((c) => (c.key === 'interview' ? { ...c, ok: true, hint: '' } : c)) });
  fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: feature({ status: 'done', state: 'decide', pending: null, rounds: 3,
    savedPath: 'specs/FEAT-4.md', readiness: doneReady }), turns: [] } });
  await view.changed(4);
  assert.equal(head().querySelector('.badge').textContent, 'Decide');
  assert.deepEqual(chips(), ['Project · shop', 'Interview done · 3 rounds', '$0.42 so far', 'Saved as specs/FEAT-4.md']);
  fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: feature({ status: 'done', state: 'started', pending: null, rounds: 1, readiness: ALL_OK(),
    starts: [{ version: 1, runId: 'r1', run: { status: 'running', phase: 'implement', costUsd: 1, href: '#running/r1' } }] }), turns: [] } });
  await view.changed(4);
  assert.equal(head().querySelector('.pill-run').textContent, 'Implement');
  assert.ok(head().querySelector('.pill-run').classList.contains('peach'));
  assert.equal(head().querySelector('.badge'), null, 'the pill, not a badge');
  assert.deepEqual(chips(), ['Project · shop', 'Interview done · 1 round', '$0.42 so far']);
  assert.doesNotMatch(host.textContent, /null|undefined/);
});

test('Export menu: its entries, Save only for a project feature; a choice, Escape and an outside click close it', async () => {
  fakeApi({ ...BASE, 'GET /api/requirements/4/markdown': {} });
  const { host, view } = make();
  document.body.append(host);
  await view.show('feature/4');
  const trigger = () => btn(host, 'Export ▾');
  const list = () => trigger().parentElement.querySelector('[role="menu"]');
  assert.equal(trigger().getAttribute('aria-haspopup'), 'menu');
  assert.equal(trigger().getAttribute('aria-expanded'), 'false');
  assert.equal(list().hidden, true);
  trigger().click();
  assert.equal(list().hidden, false);
  assert.equal(trigger().getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...list().querySelectorAll('[role="menuitem"]')].map((x) => x.textContent), ['Save to specs/', 'Copy Markdown', 'Download .md']);
  const dl = list().querySelector('a[role="menuitem"]');
  assert.equal(dl.getAttribute('href'), '/api/requirements/4/markdown?download=1');
  assert.ok(dl.hasAttribute('download'));
  list().querySelector('[role="menuitem"]').focus();
  list().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(list().hidden, true, 'Escape closes');
  assert.equal(trigger().getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, trigger(), 'and returns the focus to the trigger');
  trigger().click();
  btn(host, 'Copy Markdown').click();
  assert.equal(list().hidden, true, 'a choice closes');
  await tick(); await tick();
  trigger().click();
  assert.equal(list().hidden, false);
  document.body.click();
  assert.equal(list().hidden, true, 'an outside click closes');
  host.remove();
  fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: feature({ scopeType: 'workspace', scopeKey: 'ws1' }), turns: [] } });
  await view.changed(4);
  assert.deepEqual([...list().querySelectorAll('[role="menuitem"]')].map((x) => x.textContent), ['Copy Markdown', 'Download .md']);
});

test('⋯ menu: Project context, Look again, Archive; kept open across a live update; the lock rules', async () => {
  fakeApi(BASE);
  const { host, view } = make();
  await view.show('feature/4');
  const more = () => host.querySelector('[aria-label="More actions"]');
  const items = () => [...more().parentElement.querySelectorAll('[role="menuitem"]')];
  assert.equal(more().tagName, 'BUTTON');
  assert.ok(more().classList.contains('req-ico'));
  assert.equal(more().getAttribute('aria-haspopup'), 'menu');
  assert.ok(more().querySelector('svg'));
  more().click();
  assert.deepEqual(items().map((x) => x.textContent), ['Project context', 'Look again', 'Archive']);
  assert.ok(items().every((x) => !x.disabled));
  fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: feature({ busy: true, status: 'thinking', state: 'thinking', pending: null }), turns: [] } });
  await view.changed(4);
  assert.equal(more().parentElement.querySelector('[role="menu"]').hidden, false, 'still open');
  assert.deepEqual(items().map((x) => [x.textContent, x.disabled]), [['Project context', false], ['Look again', true], ['Archive', true]]);
  fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: feature({ scopeType: 'workspace', scopeKey: 'ws1' }), turns: [] } });
  await view.changed(4);
  assert.equal(items()[0].textContent, 'Workspace context');
});

test('Ready panel: the six checks, n of 6, Start disabled until Ready, start-anyway only when overridable', async () => {
  const calls = fakeApi(BASE);
  const { host, view } = make();
  await view.show('feature/4');
  const panel = () => host.querySelector('.req-ready');
  assert.equal(host.querySelector('.req-right').firstElementChild, panel(), 'first in the right column');
  assert.ok(panel().classList.contains('card'));
  assert.equal(panel().querySelector('h3').textContent, 'Ready to start?');
  assert.equal(panel().querySelector('code').textContent, '3 of 6');
  const items = [...panel().querySelectorAll('li')];
  assert.deepEqual(items.map((li) => li.getAttribute('data-check')), CHECKS.map((c) => c.key));
  assert.deepEqual(items.map((li) => li.querySelector('.req-check-label').textContent), CHECKS.map((c) => c.label));
  assert.deepEqual(items.map((li) => li.querySelector('[role="img"]').getAttribute('aria-label')), ['Not yet', 'Passed', 'Not yet', 'Passed', 'Not yet', 'Passed']);
  assert.deepEqual(items.map((li) => li.querySelector('.hint')?.textContent ?? ''), ['add a success measure', '', '1 question waiting', '', '1 to decide', '']);
  assert.match(panel().textContent, /Nothing is built until you start it\./);
  const start = () => panel().querySelector('[data-ui="start"]');
  assert.equal(start().textContent, 'Start in worca');
  assert.equal(start().disabled, true);
  assert.equal(panel().querySelector('[data-ui="start-anyway"]'), null);
  fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: feature({ readiness: readiness({ overridable: true }) }), turns: [] } });
  await view.changed(4);
  const anyway = panel().querySelector('[data-ui="start-anyway"]');
  assert.equal(anyway.textContent, "Start before it's Ready…");
  assert.ok(anyway.classList.contains('link-btn'));
  assert.equal(start().disabled, true);
  const calls2 = fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: feature({ status: 'done', state: 'ready', pending: null, readiness: ALL_OK() }), turns: [] } });
  await view.changed(4);
  // Ready: the Ready to build card's Start is the one; the panel keeps its checks but no second button
  assert.equal(start(), null);
  assert.equal(host.querySelectorAll('[data-start]').length, 1);
  assert.equal(host.querySelector('.req-build [data-ui="start-go"]').disabled, false);
  assert.equal(panel().querySelector('code').textContent, '6 of 6');
  assert.ok([...panel().querySelectorAll('[role="img"]')].every((i) => i.getAttribute('aria-label') === 'Passed'));
  assert.equal(panel().querySelector('[data-ui="start-anyway"]'), null);
  assert.equal([...calls, ...calls2].filter((c) => c.method !== 'GET').length, 0, 'nothing is posted until a Start');
});

test('spec card: pencil buttons with labels, edited inline, remove icons, the folded long lists', async () => {
  const f = feature();
  Object.assign(f.spec, { flow: ['Open the order', 'Press Cancel'], edgeCases: ['Already shipped'], rules: [], outOfScope: ['Partial cancel'] });
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns: [] }),
    'DELETE /api/requirements/4/criteria/R-po-1': { feature: f, turns: [] } });
  const { host, view } = make();
  await view.show('feature/4');
  const spec = () => host.querySelector('.req-right .req-spec');
  assert.ok(spec().classList.contains('card'));
  assert.equal(spec().querySelector('h3').textContent, 'Spec');
  const sections = () => [...spec().querySelectorAll('[data-section]')].map((x) => x.getAttribute('data-section'));
  assert.deepEqual(sections(), ['goal', 'actors', 'criteria', 'assumptions', 'openQuestions']);
  const pencil = spec().querySelector('[data-section="goal"] .req-ico');
  assert.equal(pencil.getAttribute('aria-label'), 'Edit Goal');
  assert.ok(pencil.querySelector('svg'));
  assert.equal(pencil.textContent, '');
  const pencils = () => [...spec().querySelectorAll('.req-ico')].map((b) => b.getAttribute('aria-label')).filter((l) => l.startsWith('Edit '));
  assert.deepEqual(pencils(), ['Edit Goal', 'Edit Actors', 'Edit Open questions']);
  assert.match(spec().querySelector('[data-section="actors"] h4').textContent, /^Actors.*edited by you$/);
  const rewrite = btn(host, 'Let Worca rewrite this');
  assert.ok(rewrite && !rewrite.classList.contains('req-ico'), 'stays a text button');
  assert.equal(spec().querySelector('[data-section="criteria"] .req-ico[aria-label="Add a criterion"]').tagName, 'BUTTON');
  const rm = spec().querySelector('[aria-label="Remove R-po-1"]');
  assert.ok(rm.classList.contains('req-ico'));
  rm.click();
  await tick();
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url === '/api/requirements/4/criteria/R-po-1'));
  await tick();
  const show = () => btn(host, 'Show flow, edge cases, rules and out of scope (4 items)');
  assert.ok(show().classList.contains('link-btn'));
  assert.equal(show().getAttribute('aria-expanded'), 'false');
  show().click();
  await tick(); await tick();
  assert.deepEqual(sections(), ['goal', 'actors', 'criteria', 'assumptions', 'openQuestions', 'flow', 'edgeCases', 'rules', 'outOfScope']);
  assert.ok(pencils().includes('Edit Main flow'));
  await view.changed(4);
  assert.ok(sections().includes('flow'), 'kept open across a live update');
  const hide = btn(host, 'Hide flow, edge cases, rules and out of scope');
  assert.equal(hide.getAttribute('aria-expanded'), 'true');
  hide.click();
  await tick(); await tick();
  assert.deepEqual(sections(), ['goal', 'actors', 'criteria', 'assumptions', 'openQuestions']);
});

test('What Worca found in the code: folded below the rounds, with how often it looked, the files and the cost', async () => {
  const look = (id, costUsd) => ({ id, kind: 'orientation', costUsd, payload: { summary: 'x', files: ['src/o.js'], skipped: null } });
  let turns = [look(2, 0.14)];
  fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: feature(), turns }) });
  const { host, view } = make();
  await view.show('feature/4');
  const box = () => host.querySelector('.req-left > details.req-orient');
  assert.equal(box().open, false);
  assert.match(box().querySelector('summary').textContent, /^What Worca found in the code/);
  assert.equal(box().querySelector('.req-orient-meta').textContent, 'looked once · 1 file · $0.14');
  turns = [look(2, 0.14), look(7, 0.1)];
  box().open = true;
  await view.changed(4);
  assert.equal(box().open, true, 'kept open across a live update');
  assert.equal(box().querySelector('.req-orient-meta').textContent, 'looked twice · 1 file · $0.24');
  turns = [{ ...look(2, 0.14), payload: { summary: 'x', files: [], skipped: null } }];
  fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: feature({ orientation: { summary: 'x', files: [], skipped: null } }), turns }) });
  await view.changed(4);
  assert.equal(box().querySelector('.req-orient-meta').textContent, 'looked once · $0.14', 'no files, no file count');
  turns = [];
  await view.changed(4);
  assert.equal(box().querySelector('.req-orient-meta'), null, 'nothing known, nothing said');
});

// ---- Task 8: Decide, Ready to build, Start, the start-before-Ready dialog, Started ----

const DONE = { status: 'done', pending: null, rounds: 2 };
const decideFeature = (over = {}) => {
  const f = feature({ ...DONE, state: 'decide', unaskedRejections: ['A-3'], ...over });
  f.spec.assumptions = [
    { id: 'A-1', text: 'Full refund', status: 'open' }, { id: 'A-2', text: 'Email the customer', status: 'confirmed' },
    { id: 'A-3', text: 'No partial cancel', status: 'rejected' }, { id: 'A-4', text: 'Stock goes back', status: 'open' },
    { id: 'A-5', text: 'Only the buyer', status: 'rejected' }];
  return f;
};
const decideRows = (host) => [...host.querySelectorAll('.req-decide [data-decide]')].map((r) => r.getAttribute('data-decide'));

test('Decide card: open first, then the unasked rejections, the rest folded; the toggles, the counts', async () => {
  const f = decideFeature();
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns: [] }),
    'POST /api/requirements/4/assumptions/A-1': { feature: f, turns: [] }, 'POST /api/requirements/4/assumptions/A-3': { feature: f, turns: [] } });
  const { host, view } = make();
  await view.show('feature/4');
  const card = () => host.querySelector('.req-left .req-decide');
  assert.ok(card().classList.contains('qpanel'));
  assert.equal(host.querySelector('.req-left').firstElementChild, card(), 'the current card, at the top');
  assert.equal(card().querySelector('.qpanel-head b').textContent, 'Decide the assumptions');
  assert.equal(card().querySelector('.qcount').textContent, '2 of 5 left');
  assert.match(card().textContent, /Confirm what is right, reject what is not: a rejected one is asked again in one short round\./);
  assert.doesNotMatch(host.textContent, /The interview is done\./, 'the A1 hint is gone');
  assert.deepEqual(decideRows(host), ['A-1', 'A-4', 'A-3']);
  const row = (id) => card().querySelector(`[data-decide="${id}"]`);
  const group = row('A-3').querySelector('[role="group"]');
  assert.equal(group.getAttribute('aria-label'), 'Decide A-3');
  assert.deepEqual([...group.querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')]), [['Confirm', 'false'], ['Reject', 'true']]);
  assert.equal(row('A-1').querySelector('code').textContent, 'A-1');
  assert.match(row('A-1').textContent, /Full refund/);
  const more = btn(card(), 'Show the other 2');
  assert.ok(more.classList.contains('hint'));
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  more.click();
  await tick();
  assert.deepEqual(decideRows(host), ['A-1', 'A-4', 'A-3', 'A-2', 'A-5']);
  assert.equal(btn(card(), 'Show fewer').getAttribute('aria-expanded'), 'true');
  assert.equal(card().querySelector('.qanswered').textContent, '3 decided · 2 rejected');
  btn(row('A-1'), 'Confirm').click();
  await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.method === 'POST').map((c) => [c.url, c.body]), [['/api/requirements/4/assumptions/A-1', { status: 'confirmed' }]]);
  btn(row('A-3'), 'Reject').click();   // pressing the pressed one reopens it
  await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.method === 'POST').at(-1).body, { status: 'open' });
});

test('Decide card: Confirm the N left and Done, ask about A-n post their routes; each shows only when it applies', async () => {
  let f = decideFeature();
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns: [] }),
    'POST /api/requirements/4/assumptions': () => ({ feature: f, turns: [] }), 'POST /api/requirements/4/follow-up': () => ({ feature: f, turns: [] }) });
  const { host, view } = make();
  await view.show('feature/4');
  const all = () => host.querySelector('[data-ui="confirm-all"]');
  const follow = () => host.querySelector('[data-ui="follow-up"]');
  assert.equal(all().textContent, 'Confirm the 2 left');
  assert.equal(follow().textContent, 'Done, ask about A-3');
  assert.ok(follow().classList.contains('btn-go'));
  all().click();
  await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.method === 'POST').at(-1), { method: 'POST', url: '/api/requirements/4/assumptions', body: { confirmOpen: true } });
  follow().click();
  await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.method === 'POST').at(-1), { method: 'POST', url: '/api/requirements/4/follow-up', body: {} });
  f = decideFeature({ unaskedRejections: ['A-3', 'A-5'] });
  await view.changed(4);
  assert.equal(follow().textContent, 'Done, ask about A-3 and 1 more');
  f = decideFeature({ unaskedRejections: [] });
  f.spec.assumptions = f.spec.assumptions.map((a) => ({ ...a, status: a.status === 'open' ? 'confirmed' : a.status }));
  await view.changed(4);
  assert.equal(all(), null, 'nothing left to confirm');
  assert.equal(follow(), null, 'no rejection waits');
  assert.equal(host.querySelector('.req-decide .qcount').textContent, '0 of 5 left');
  f = decideFeature({ busy: true, status: 'thinking', state: 'thinking' });
  await view.changed(4);
  assert.equal(host.querySelector('.req-decide'), null, 'never while Worca works');
});

const readyFeature = (over = {}) => feature({ ...DONE, state: 'ready', readiness: ALL_OK(), ...over });
const BUILD = {
  'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop', path: '/p/shop' }] },
  'GET /api/workflows': { workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_memory_defrag', name: 'Memory defragment' }, { id: 'wf_x', name: 'Careful' }] },
  'GET /api/branches?projectDir=%2Fp%2Fshop': { branches: ['main', 'dev'], current: 'main' },
};
const chipsOf = (el) => [...el.querySelectorAll('.chip')].map((c) => c.textContent);
const pick = (el, value) => { el.value = value; el.dispatchEvent(new window.Event('change', { bubbles: true })); };

test('Ready to build: the sentence, the chips, Change reveals the workflow and branch selects; the choices are kept', async () => {
  const calls = fakeApi({ ...BASE, ...BUILD, 'GET /api/requirements/4': () => ({ feature: readyFeature(), turns: [] }) });
  const { host, view } = make();
  await view.show('feature/4');
  const card = () => host.querySelector('.req-left .req-build');
  assert.ok(card().classList.contains('card'));
  assert.equal(host.querySelector('.req-left').firstElementChild, card());
  assert.equal(card().querySelector('h3').textContent, 'Ready to build');
  assert.equal(card().querySelector('p').textContent, 'All 6 checks pass. Starting saves this spec as version 1 and starts a run on shop with it as the task. The run plans, builds and reviews; its cost counts toward your limit like any run.');
  assert.equal(card().querySelector('p b').textContent, 'shop');
  assert.deepEqual(chipsOf(card()), ['Workflow · Auto', 'Branch from · default']);
  const go = card().querySelector('[data-ui="start-go"]');
  assert.ok(go.classList.contains('btn-go'));
  assert.equal(go.textContent, 'Start in worca');
  assert.equal(card().querySelector('select'), null, 'the selects open from Change');
  const change = card().querySelector('[data-ui="build-change"]');
  assert.equal(change.textContent, 'Change');
  assert.ok(change.classList.contains('hint'));
  change.click();
  await tick(); await tick(); await tick();
  const wf = () => card().querySelector('select[data-ui="build-workflow"]');
  const br = () => card().querySelector('select[data-ui="build-branch"]');
  assert.deepEqual([...wf().options].map((o) => [o.value, o.textContent]), [['wf_auto', 'Auto'], ['wf_default', 'Default'], ['wf_x', 'Careful']]);
  assert.deepEqual([...br().options].map((o) => [o.value, o.textContent]), [['', 'Project default (main)'], ['main', 'main'], ['dev', 'dev']]);
  assert.ok(calls.some((c) => c.url === '/api/branches?projectDir=%2Fp%2Fshop'));
  pick(wf(), 'wf_x');
  pick(br(), 'dev');
  assert.deepEqual(chipsOf(card()), ['Workflow · Careful', 'Branch from · dev']);
  await view.changed(4);
  assert.equal(wf().value, 'wf_x', 'kept across a live update');
  assert.equal(br().value, 'dev');
  assert.equal(calls.filter((c) => c.url === '/api/workflows').length, 1, 'loaded once');
});

test('Ready to build, workspace: one branch field for every project, no branch list', async () => {
  const calls = fakeApi({ ...BASE, ...BUILD, 'GET /api/workspaces': { workspaces: [{ id: 'ws1', name: 'Storefront' }] },
    'GET /api/requirements/4': () => ({ feature: readyFeature({ scopeType: 'workspace', scopeKey: 'ws1' }), turns: [] }) });
  const { host, view } = make();
  await view.show('feature/4');
  const card = host.querySelector('.req-build');
  assert.match(card.querySelector('p').textContent, /starts a run on Storefront with it/);
  card.querySelector('[data-ui="build-change"]').click();
  await tick(); await tick();
  const input = host.querySelector('.req-build input[data-ui="build-branch"]');
  assert.equal(input.getAttribute('placeholder'), "Branch for every project (empty: each project's default)");
  input.value = 'release';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(chipsOf(host.querySelector('.req-build')), ['Workflow · Auto', 'Branch from · release']);
  assert.ok(!calls.some((c) => c.url.startsWith('/api/branches')));
});

const startedFeature = (over = {}) => feature({ ...DONE, state: 'started', readiness: ALL_OK(),
  starts: [{ version: 1, runId: 'r9', ready: true, failing: [], reason: null, workflowId: 'wf_x', sourceBranch: 'dev',
    run: { status: 'running', phase: 'plan', costUsd: 0.1, href: '#running/r9' } }], ...over });

test('Start: posts the choices once (the button waits for the answer), repaints as started, says so with a link', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = fakeApi({ ...BASE, ...BUILD, 'GET /api/requirements/4': () => ({ feature: readyFeature(), turns: [] }) });
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (opts.method === 'POST' && url === '/api/requirements/4/start') {
      calls.push({ method: 'POST', url, body: JSON.parse(opts.body) });
      await gate;
      return { ok: true, status: 201, json: async () => ({ runId: 'r9', version: 1, feature: startedFeature(), turns: [] }) };
    }
    return inner(url, opts);
  };
  const { host, msgEl, view } = make();
  await view.show('feature/4');
  host.querySelector('[data-ui="build-change"]').click();
  await tick(); await tick(); await tick();
  pick(host.querySelector('[data-ui="build-workflow"]'), 'wf_x');
  pick(host.querySelector('[data-ui="build-branch"]'), 'dev');
  const go = host.querySelector('[data-ui="start-go"]');
  go.click();
  go.click();
  await tick();
  assert.equal(host.querySelector('[data-ui="start-go"]').disabled, true, 'disabled while the start is in flight');
  host.querySelector('[data-ui="start-go"]').click();
  release();
  await tick(); await tick(); await tick();
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 1, 'one start, however often it was pressed');
  assert.deepEqual(posts[0].body, { workflowId: 'wf_x', sourceBranch: 'dev' });
  assert.equal(msgEl.textContent, 'Started build v1. Open the run');
  assert.equal(msgEl.querySelector('a').getAttribute('href'), '#running/r9');
  assert.ok(host.querySelector('.req-runs'), 'repainted from the answer: the feature is started');
  assert.equal(host.querySelector('.req-build'), null);
  assert.equal(calls.filter((c) => c.url === '/api/requirements/4').length, 1, 'no refetch: the answer carries the feature');
});

test('Start: the defaults send only the workflow; an error other than NOT_READY is said, with no dialog', async () => {
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: readyFeature(), turns: [] }),
    'POST /api/requirements/4/start': { __status: 409, body: { error: 'The budget for this month is used up.' } } });
  const { host, msgEl, view } = make();
  await view.show('feature/4');
  host.querySelector('[data-ui="start-go"]').click();
  await tick(); await tick();
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { workflowId: 'wf_auto' });
  assert.equal(msgEl.textContent, 'The budget for this month is used up.');
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(host.querySelector('[data-ui="start-go"]').disabled, false, 'usable again');
});

test('NOT_READY opens the dialog: the failing checks, a required reason, sent with the start; Escape closes, focus returns', async () => {
  const f = readyFeature();
  let calls = null;
  calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns: [] }),
    'POST /api/requirements/4/start': () => (calls.at(-1).body.reason
      ? { __status: 201, body: { runId: 'r9', version: 1, feature: startedFeature(), turns: [] } }
      : { __status: 409, body: { error: 'This feature is not Ready. Give a reason to start it anyway.', failing: ['assumptions'] } }) });
  const { host, msgEl, view } = make();
  document.body.append(host);
  await view.show('feature/4');
  const go = () => host.querySelector('[data-ui="start-go"]');
  go().focus();
  go().click();
  await tick(); await tick();
  const dlg = () => document.querySelector('[role="dialog"]');
  assert.ok(dlg(), 'the dialog opens');
  assert.equal(dlg().getAttribute('aria-modal'), 'true');
  assert.ok(dlg().closest('.viewer-modal'), 'the upstream modal overlay');
  assert.equal(document.getElementById(dlg().getAttribute('aria-labelledby')).textContent, "Start FEAT-4 before it's Ready?");
  assert.match(dlg().querySelector('.req-dlg-fail').textContent, /Every assumption decided/);
  assert.match(dlg().textContent, /The run treats open assumptions as confirmed: the build follows them as written\./);
  const area = () => dlg().querySelector('textarea');
  assert.equal(document.activeElement, area(), 'focus on the reason');
  assert.equal(area().getAttribute('aria-required'), 'true');
  assert.ok(host.hasAttribute('inert'), 'the page behind is inert');
  assert.equal(area().getAttribute('maxlength'), '500');
  assert.match(dlg().textContent, /Why start now\?/);
  assert.match(dlg().textContent, /Recorded as: you · started before Ready/);
  const primary = () => dlg().querySelector('.btn-primary');
  assert.equal(primary().textContent, 'Start with 1 open', 'A-1 is open');
  assert.equal(primary().disabled, true);
  area().value = '   ';
  area().dispatchEvent(new window.Event('input'));
  assert.equal(primary().disabled, true, 'blank is no reason');
  area().value = 'Sprint today';
  area().dispatchEvent(new window.Event('input'));
  assert.equal(primary().disabled, false);
  assert.equal(dlg().querySelector('.req-dlg-count').textContent, '12 / 500');
  // Tab stays inside the dialog
  primary().focus();
  dlg().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert.equal(document.activeElement, area());
  area().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  assert.equal(document.activeElement, primary());
  // a click on the scrim leaves the focus on <body>: Tab still lands inside, Escape still closes
  document.activeElement.blur();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert.ok(dlg().contains(document.activeElement), 'Tab from <body> goes into the dialog');
  document.activeElement.blur();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(dlg(), null);
  assert.ok(!host.hasAttribute('inert'), 'the page is live again');
  assert.equal(document.activeElement, go());
  // again, with Keep deciding
  go().click();
  await tick(); await tick();
  btn(dlg(), 'Keep deciding').click();
  assert.equal(dlg(), null);
  // again, now with a reason: sent with the start
  go().click();
  await tick(); await tick();
  area().value = '  Sprint today ';
  area().dispatchEvent(new window.Event('input'));
  primary().click();
  await tick(); await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.method === 'POST').at(-1).body, { reason: 'Sprint today', workflowId: 'wf_auto' });
  assert.equal(dlg(), null, 'closed after the start');
  assert.equal(msgEl.textContent, 'Started build v1. Open the run');
  assert.ok(host.querySelector('.req-runs'));
  assert.ok(host.querySelector('.req-runs').contains(document.activeElement), 'the focus goes to the runs card (the message is not on the page here)');
  document.body.append(msgEl);
  host.remove();
  msgEl.remove();
});

test("Start before it's Ready…: the dialog names every failing check with its hint, posts nothing until confirmed", async () => {
  const f = feature({ readiness: readiness({ overridable: true }) });
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns: [] }),
    'POST /api/requirements/4/start': { __status: 409, body: { error: 'Worca is still working on this feature.' } } });
  const { host, view } = make();
  document.body.append(host);
  await view.show('feature/4');
  host.querySelector('[data-ui="start-anyway"]').focus();
  host.querySelector('[data-ui="start-anyway"]').click();
  await tick();
  const dlg = () => document.querySelector('[role="dialog"]');
  assert.ok(dlg());
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  assert.match(dlg().textContent, /3 checks do not pass yet:/);
  const items = [...dlg().querySelectorAll('.req-dlg-fail li')].map((li) => li.textContent);
  assert.deepEqual(items, ['Goal with a success measure: add a success measure', 'Interview finished: 1 question waiting', 'Every assumption decided: 1 to decide']);
  dlg().querySelector('textarea').value = 'Demo';
  dlg().querySelector('textarea').dispatchEvent(new window.Event('input'));
  dlg().querySelector('.btn-primary').click();
  await tick(); await tick();
  assert.equal(dlg().querySelector('.form-msg').textContent, 'Worca is still working on this feature.', 'an error stays in the dialog');
  dlg().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.activeElement, host.querySelector('[data-ui="start-anyway"]'));
  host.remove();
});

const frozen = () => ({ goal: { text: 'Cancel', measure: '' }, actors: ['Customer'], flow: [], edgeCases: [], rules: [], outOfScope: [],
  criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }], assumptions: [{ id: 'A-1', text: 'Full refund', status: 'open' }], openQuestions: [], edited: {} });
const CHANGES = [
  { kind: 'goal', field: 'measure', before: '', after: 'Fewer calls' },
  { kind: 'section', section: 'actors', added: ['Support'], removed: ['Customer'] },
  { kind: 'criterion', id: 'R-po-1', change: 'edited', before: 'Cancel while unpaid', after: 'Cancel until shipped' },
  { kind: 'criterion', id: 'R-po-2', change: 'added', after: 'Refund in 3 days' },
  { kind: 'assumption', id: 'A-1', change: 'status', before: 'open', after: 'confirmed' },
];
const twoStarts = (over = {}) => {
  const f = feature({ ...DONE, state: 'started', costUsd: 0.4, readiness: ALL_OK(), changedSinceStart: CHANGES,
    starts: [
      { version: 2, runId: 'r2', startedBy: 'tom', ready: false, failing: ['assumptions'], reason: 'Sprint today', workflowId: 'wf_x', sourceBranch: null,
        run: { status: 'running', phase: 'implement', costUsd: 2.84, href: '#running/r2' }, spec: frozen() },
      { version: 1, runId: 'r1', ready: true, failing: [], reason: null, workflowId: 'wf_auto', sourceBranch: null, run: null }], ...over });
  f.spec.criteria = [{ id: 'R-po-1', text: 'Cancel until shipped' }, { id: 'R-po-2', text: 'Refund in 3 days' }];
  return f;
};

test('Started: the runs card (newest first), the total, Start again with the next version', async () => {
  let f = twoStarts();
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns: [] }),
    'POST /api/requirements/4/start': { __status: 201, body: { runId: 'r3', version: 3, feature: twoStarts(), turns: [] } } });
  const { host, msgEl, view } = make();
  await view.show('feature/4');
  const card = () => host.querySelector('.req-left .req-runs');
  assert.ok(card().classList.contains('card'));
  assert.equal(host.querySelector('.req-left').firstElementChild, card(), 'at the top of the left column');
  assert.equal(card().querySelector('h3').textContent, 'Runs from this feature');
  const rows = [...card().querySelectorAll('.req-run-row')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tagName, 'A');
  assert.equal(rows[0].getAttribute('href'), '#running/r2');
  assert.equal(rows[0].querySelector('.pill-run').textContent, 'Implement');
  const label = rows[0].querySelector('.req-run-label');
  assert.equal(label.textContent, 'Run · spec v2 · started before Ready');
  assert.equal(label.getAttribute('title'), 'Sprint today');
  assert.equal(rows[0].querySelector('.req-run-cost').textContent, '$2.84');
  assert.notEqual(rows[1].tagName, 'A');
  assert.match(rows[1].textContent, /Run · spec v1/);
  assert.match(rows[1].textContent, /Run not found/);
  assert.equal(card().querySelector('.req-run-total').textContent, 'Total for FEAT-4 so far: $3.24 (requirements $0.40 + build $2.84)');
  const again = () => card().querySelector('[data-ui="start-again"]');
  assert.equal(again().textContent, 'Start again with v3');
  assert.equal(host.querySelector('.req-ready [data-ui="start"]'), null, 'one Start again: the runs card\'s, none in the Ready panel');
  assert.deepEqual([...host.querySelectorAll('button')].filter((b) => /^Start again/.test(b.textContent)).length, 1);
  assert.equal(again().disabled, false);
  again().click();
  await tick(); await tick();
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { workflowId: 'wf_x' }, 'the last start\'s workflow');
  assert.equal(msgEl.textContent, 'Started build v3. Open the run');
  f = twoStarts({ changedSinceStart: [] });
  await view.changed(4);
  assert.equal(again().disabled, true, 'nothing changed: nothing to start again');
  f = twoStarts({ readiness: readiness() });
  await view.changed(4);
  assert.equal(again().disabled, true, 'not Ready and not overridable');
  assert.doesNotMatch(host.textContent, /null|undefined|NaN/);
});

test('Started: the changed-since notice, one line per change; Undo my changes reverts after a confirm', async () => {
  const f = twoStarts();
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns: [] }),
    'POST /api/requirements/4/revert': { feature: f, turns: [] } });
  const { host, view } = make();
  await view.show('feature/4');
  const box = host.querySelector('.req-left .req-changed');
  const left = [...host.querySelector('.req-left').children];
  assert.equal(left.indexOf(box), left.indexOf(host.querySelector('.req-runs')) + 1, 'right under the runs card');
  assert.equal(box.querySelector('b').textContent, 'Changed since the run started');
  const lines = [...box.querySelectorAll('.req-change-line')];
  assert.equal(lines.length, 5);
  assert.equal(lines[0].textContent, 'Success measure: Fewer calls');
  assert.equal(lines[0].querySelector('ins').textContent, 'Fewer calls');
  assert.equal(lines[1].textContent, 'Actors: Customer Support');
  assert.equal(lines[1].querySelector('del').textContent, 'Customer');
  assert.equal(lines[1].querySelector('ins').textContent, 'Support');
  assert.equal(lines[2].querySelector('code').textContent, 'R-po-1');
  assert.equal(lines[2].querySelector('del').textContent, 'Cancel while unpaid');
  assert.equal(lines[2].querySelector('ins').textContent, 'Cancel until shipped');
  assert.equal(lines[3].textContent, 'R-po-2 added: Refund in 3 days');
  assert.equal(lines[4].textContent, 'A-1 open confirmed');
  assert.equal(lines[4].querySelector('del').textContent, 'open');
  assert.match(box.textContent, /The running build still works from v2; it does not see this change\./);
  const undo = btn(box, 'Undo my changes');
  window.confirm = () => false;
  undo.click();
  await tick();
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'declined: nothing sent');
  window.confirm = () => true;
  btn(host.querySelector('.req-changed'), 'Undo my changes').click();
  await tick(); await tick();
  assert.deepEqual(calls.find((c) => c.method === 'POST'), { method: 'POST', url: '/api/requirements/4/revert', body: { version: 2 } });
});

test('Started: the spec card switches between the draft and the started version; the started one is read-only', async () => {
  let f = twoStarts();
  fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns: [] }) });
  const { host, view } = make();
  await view.show('feature/4');
  const spec = () => host.querySelector('.req-spec');
  const tabsOf = () => [...spec().querySelectorAll('[role="tab"]')];
  assert.ok(spec().querySelector('[role="tablist"]').classList.contains('seg'));
  assert.deepEqual(tabsOf().map((t) => [t.textContent, t.getAttribute('aria-selected')]), [['v3 draft', 'true'], ['v2 started', 'false']]);
  const crit = () => [...spec().querySelectorAll('[data-criterion]')].map((li) => li.querySelector('.req-item-text').textContent);
  assert.deepEqual(crit(), ['Cancel until shipped', 'Refund in 3 days']);
  assert.ok(spec().querySelector('[data-criterion="R-po-1"] .req-changed-mark'), 'a changed criterion is marked');
  tabsOf()[1].click();
  await tick();
  assert.equal(tabsOf()[1].getAttribute('aria-selected'), 'true');
  assert.deepEqual(crit(), ['Cancel while unpaid'], 'the frozen spec');
  assert.equal(spec().querySelectorAll('.req-ico').length, 0, 'no pencils, no add or remove');
  assert.equal(spec().querySelector('.req-confirm'), null, 'no Confirm / Reject');
  assert.match(spec().querySelector('[data-assumption="A-1"]').textContent, /open/);
  assert.equal(spec().querySelector('[data-assumption="A-1"] .badge').textContent, 'open', 'the frozen tab shows the status as a badge');
  assert.equal(spec().querySelector('[data-assumption="A-1"] [role="group"]'), null);
  await view.changed(4);
  assert.deepEqual(crit(), ['Cancel while unpaid'], 'kept across a live update');
  tabsOf()[0].click();
  await tick();
  assert.deepEqual(crit(), ['Cancel until shipped', 'Refund in 3 days']);
  f = twoStarts({ changedSinceStart: [] });
  await view.changed(4);
  assert.equal(spec().querySelector('[role="tablist"]'), null, 'no changes: no switch');
  assert.equal(host.querySelector('.req-changed'), null, 'and no notice');
});

test('focus: Change opens the card on its first option; Cancel and Submit changes return to that round\'s Change', async () => {
  const turns = [
    { id: 3, kind: 'round', payload: { questions: Q, note: '' } },
    { id: 4, kind: 'answers', payload: { roundTurnId: 3, answers: [{ id: 'who', question: Q[0].question, answer: 'Support' }] } },
    { id: 6, kind: 'round', payload: { questions: [], note: 'Complete.', done: true } },
  ];
  const f = decideFeature();
  fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns }), 'POST /api/requirements/4/answers': { feature: f, turns } });
  const { host, view } = make();
  document.body.append(host);
  await view.show('feature/4');
  const change = () => host.querySelector('[data-ui="change-3"]');
  assert.ok(change().classList.contains('hint'), 'the muted hint link');
  assert.ok(!change().classList.contains('link-btn'));
  change().click();
  await tick();
  assert.equal(document.activeElement, host.querySelector('.req-revise .qopt'));
  btn(host.querySelector('.req-revise'), 'Cancel').click();
  await tick();
  assert.equal(document.activeElement, change());
  change().click();
  await tick();
  btn(host.querySelector('.req-revise'), 'Submit changes').click();
  await tick(); await tick(); await tick();
  assert.equal(host.querySelector('.req-revise'), null);
  assert.equal(document.activeElement, change());
  host.remove();
});

test('focus: a live update keeps the focus on an open menu\'s item; Escape still closes it', async () => {
  fakeApi(BASE);
  const { host, view } = make();
  document.body.append(host);
  await view.show('feature/4');
  btn(host, 'Export ▾').click();
  btn(host, 'Copy Markdown').focus();
  await view.changed(4);
  assert.equal(document.activeElement && document.activeElement.textContent, 'Copy Markdown');
  assert.ok(host.contains(document.activeElement));
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(btn(host, 'Export ▾').getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, btn(host, 'Export ▾'));
  host.remove();
});

test('style.css: the start-anyway link has a disabled look; the req- rules use tokens only', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.req-start-anyway:disabled\{[^}]*opacity/);
  const req = css.split('\n').filter((l) => /\.req-/.test(l));
  assert.ok(req.every((l) => !/#[0-9a-fA-F]{3,8}\b/.test(l)), 'no hex colour in a req- rule');
});

test('spec card: each assumption is one Confirm / Reject toggle (aria-pressed carries the status); the frozen tab keeps the badge', async () => {
  const f = decideFeature({ state: 'your_turn', status: 'your_turn', pending: { turnId: 9, questions: Q, note: '' } });
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns: [] }),
    'POST /api/requirements/4/assumptions/A-3': { feature: f, turns: [] } });
  const { host, view } = make();
  await view.show('feature/4');
  const row = (id) => host.querySelector(`.req-spec [data-assumption="${id}"]`);
  const group = row('A-3').querySelector('[role="group"]');
  assert.ok(group.classList.contains('req-toggle'));
  assert.equal(row('A-3').querySelector('.badge'), null, 'the toggle carries the status, no badge');
  assert.deepEqual([...group.querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('aria-pressed'), b.getAttribute('data-ui')]),
    [['Confirm', 'false', 'confirm-A-3'], ['Reject', 'true', 'reject-A-3']]);
  btn(group, 'Reject').click();
  btn(group, 'Reject').click();
  assert.ok([...host.querySelectorAll('[data-assume-toggle="A-3"] button')].every((b) => b.disabled), 'disabled while the POST runs');
  await tick(); await tick(); await tick();
  const posts = calls.filter((c) => c.method === 'POST');
  assert.deepEqual(posts.map((c) => [c.url, c.body]), [['/api/requirements/4/assumptions/A-3', { status: 'open' }]], 'one post: pressing the pressed one reopens');
  assert.ok([...host.querySelectorAll('[data-assume-toggle="A-3"] button')].every((b) => !b.disabled), 'usable again');
});

test('Decide card: a toggle is disabled while its POST runs, also across a live update; no double post', async () => {
  const f = decideFeature();
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns: [] }) });
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (opts.method === 'POST') { calls.push({ method: 'POST', url, body: JSON.parse(opts.body) }); await gate; return { ok: true, status: 200, json: async () => ({ feature: f, turns: [] }) }; }
    return inner(url, opts);
  };
  const { host, view } = make();
  await view.show('feature/4');
  const yes = () => host.querySelector('[data-ui="decide-confirm-A-1"]');
  yes().click();
  yes().click();
  await view.changed(4);
  assert.equal(yes().disabled, true, 'still disabled after the repaint');
  assert.equal(host.querySelector('[data-ui="confirm-A-1"]').disabled, true, 'the spec card\'s toggle for the same assumption too');
  yes().click();
  release();
  await tick(); await tick(); await tick();
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  assert.equal(yes().disabled, false);
});

test('Ready to build: a failed workflow list says Auto is used', async () => {
  fakeApi({ ...BASE, ...BUILD, 'GET /api/workflows': { __status: 500, body: { error: 'boom' } },
    'GET /api/requirements/4': () => ({ feature: readyFeature(), turns: [] }) });
  const { host, view } = make();
  await view.show('feature/4');
  host.querySelector('[data-ui="build-change"]').click();
  await tick(); await tick(); await tick();
  assert.deepEqual([...host.querySelectorAll('[data-ui="build-workflow"] option')].map((o) => o.value), ['wf_auto']);
  assert.equal(host.querySelector('.req-build-warn').textContent, 'Could not load workflows; Auto is used.');
});

test('Started: the Decide card stays reachable (A2 D11): Done, ask about A-n and Confirm the N left, under the runs card', async () => {
  let f = twoStarts({ unaskedRejections: ['A-3'] });
  f.spec.assumptions = [{ id: 'A-1', text: 'Full refund', status: 'confirmed' }, { id: 'A-3', text: 'No partial cancel', status: 'rejected' }];
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => ({ feature: f, turns: [] }),
    'POST /api/requirements/4/follow-up': () => ({ feature: f, turns: [] }), 'POST /api/requirements/4/assumptions': () => ({ feature: f, turns: [] }) });
  const { host, view } = make();
  await view.show('feature/4');
  const left = () => [...host.querySelector('.req-left').children];
  const decide = () => host.querySelector('.req-left .req-decide');
  assert.ok(decide(), 'a started feature with an unasked rejection shows the Decide card');
  assert.ok(left().indexOf(decide()) > left().indexOf(host.querySelector('.req-runs')), 'under the runs card');
  const follow = host.querySelector('[data-ui="follow-up"]');
  assert.equal(follow.textContent, 'Done, ask about A-3');
  follow.click();
  await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.method === 'POST').at(-1), { method: 'POST', url: '/api/requirements/4/follow-up', body: {} });

  f = twoStarts({ unaskedRejections: [] });
  f.spec.assumptions = [{ id: 'A-1', text: 'Full refund', status: 'open' }, { id: 'A-2', text: 'Email', status: 'open' }];
  await view.changed(4);
  const all = host.querySelector('[data-ui="confirm-all"]');
  assert.equal(all.textContent, 'Confirm the 2 left');
  all.click();
  await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.method === 'POST').at(-1), { method: 'POST', url: '/api/requirements/4/assumptions', body: { confirmOpen: true } });

  f = twoStarts({ unaskedRejections: [] });
  f.spec.assumptions = [{ id: 'A-1', text: 'Full refund', status: 'confirmed' }];
  await view.changed(4);
  assert.equal(decide(), null, 'nothing to decide: no Decide card on a started feature');
  f = twoStarts({ unaskedRejections: ['A-3'], status: 'archived', state: 'archived' });
  await view.changed(4);
  assert.equal(decide(), null, 'never while locked');
});

test('list: a started feature with questions waiting says so in its meta line', async () => {
  fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf([
    row({ seq: 1, state: 'started', pendingCount: 2, latestRun: { status: 'running', phase: 'implement', costUsd: 1, href: '#running/r1' } }),
    row({ seq: 2, state: 'started', pendingCount: 1, latestRun: null }),
    row({ seq: 3, state: 'started', pendingCount: 0, latestRun: { status: 'done', phase: null, costUsd: 1, href: '#running/r3' } })]) });
  const { host, view } = make();
  await view.show('');
  const meta = (seq) => rowOf(host, seq).querySelector('.req-row-meta');
  assert.equal(meta(1).textContent, 'Started · run running · Implement · 2 questions for you');
  assert.ok(meta(1).classList.contains('need'));
  assert.equal(meta(2).textContent, 'Started · 1 question for you');
  assert.equal(meta(3).textContent, 'Started · run done');
  assert.equal(meta(3).classList.contains('need'), false);
});

test('Start: when another feature is on screen by the time the start answers, its page keeps the focus and its paint', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const other = readyFeature({ seq: 5, id: 'FEAT-5', title: 'Other one' });
  fakeApi({ ...BASE, ...BUILD, 'GET /api/requirements/4': () => ({ feature: readyFeature(), turns: [] }),
    'GET /api/requirements/5': () => ({ feature: other, turns: [] }) });
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (opts.method === 'POST' && url === '/api/requirements/4/start') {
      await gate;
      return { ok: true, status: 201, json: async () => ({ runId: 'r9', version: 1, feature: startedFeature(), turns: [] }) };
    }
    return inner(url, opts);
  };
  const { host, msgEl, view } = make();
  document.body.append(host, msgEl);
  try {
    await view.show('feature/4');
    host.querySelector('[data-ui="start-go"]').click();
    await tick();
    await view.show('feature/5');
    host.querySelector('[data-ui="build-change"]').focus();
    release();
    await tick(); await tick(); await tick();
    assert.equal(host.querySelector('.req-head h2').textContent, 'Other one', 'FEAT-5 stays on screen');
    assert.equal(document.activeElement.getAttribute('data-ui'), 'build-change', 'the focus is not taken to FEAT-4\'s run');
    assert.equal(host.querySelector('[data-ui="start-go"]').disabled, false, 'FEAT-5 can start once FEAT-4\'s start answered');
  } finally { host.remove(); msgEl.remove(); }
});

test('run pill: a live run waiting for the person says "Waiting for you" (amber), not its idle phase', async () => {
  fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf([
    row({ seq: 1, state: 'started', latestRun: { status: 'running', phase: 'idle', costUsd: 0, href: '#running/r1', waiting: true } }),
    row({ seq: 2, state: 'started', latestRun: { status: 'running', phase: 'idle', costUsd: 0, href: '#running/r2' } })]) });
  const { host, view } = make();
  await view.show('');
  const pill = (seq) => rowOf(host, seq).querySelector('.pill-run');
  assert.equal(pill(1).textContent, 'Waiting for you');
  assert.ok(pill(1).classList.contains('amber'));
  assert.equal(pill(1).classList.contains('peach'), false);
  assert.equal(pill(2).textContent, 'Idle');
  const meta = (seq) => rowOf(host, seq).querySelector('.req-row-meta');
  assert.equal(meta(1).textContent, 'Started · run waiting for you');
  assert.ok(meta(1).classList.contains('need'));
  assert.equal(meta(2).textContent, 'Started · run running · Idle');
});
