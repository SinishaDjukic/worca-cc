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
  const go = host.querySelector('.btn-primary');
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
  card.querySelector('.btn-primary').click();
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
// A7 D12: the feature page's Project context panel moved to the brief page as Your notes for Worca; ⋯ routes there.
const openNotes = async (host) => { host.querySelector('[data-ui="menu-more"]').click(); host.querySelector('[data-ui="mi-notes"]').click(); await tick(); };
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
  host.querySelector('.btn-primary').click();
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

test('feature page: Your notes for Worca (was the context panel) opens the brief page; there the notes keep their text and switch across a live update and save together', async () => {
  const notesUrl = '/api/requirements/context/project/shop-1';
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/brief/project/shop-1': () => ({ brief: null, target: { name: 'shop', branch: 'main', leftOut: [], slow: [] },
    notes: { scopeType: 'project', scopeKey: 'shop-1', body: 'Standing rules', lookAtCode: true }, estimate: { costUsd: null, model: null }, usedBy: [], staleness: null }),
  [`PUT ${notesUrl}`]: { body: 'New rules', lookAtCode: true } });
  const { host, view, routed } = make();
  await view.show('feature/4');
  assert.equal(host.querySelector('.req-context'), null, 'no context panel on the feature page');
  assert.equal(host.querySelector('[data-ui="notes-body"]'), null);
  assert.equal(calls.filter((c) => c.url.includes('/context/')).length, 0, 'the feature page loads no notes');
  await openNotes(host);
  assert.deepEqual(routed, ['brief/project/shop-1'], 'the brief page, where the notes live');
  await view.show(routed[0]);
  const area = () => host.querySelector('[data-ui="notes-body"]');
  assert.equal(area().value, 'Standing rules');
  area().value = 'New rules';
  await view.changed(undefined, 'project:shop-1');
  assert.equal(area().value, 'New rules', 'kept across a live update');
  assert.equal(host.querySelector('[data-ui="notes-look"]').checked, true);
  btn(host, 'Save notes').click();
  await tick();
  assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { body: 'New rules', lookAtCode: true });
  assert.equal(calls.find((c) => c.method === 'PUT').url, notesUrl);
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
  assert.deepEqual(fields.map((f) => f.querySelector('label').firstChild.textContent.trim()), ['Title', 'Describe it', 'Files', 'For']);
  assert.equal(fields[0].querySelector('#req-new-title').tagName, 'INPUT');
  assert.equal(fields[1].querySelector('#req-new-desc').tagName, 'TEXTAREA');
  assert.equal(fields[1].querySelector('label .opt').textContent, 'who needs it, what they want to do, and why');
  const select = fields[3].querySelector('.select-wrap select#req-new-target');
  assert.ok(select);
  assert.deepEqual([...select.querySelectorAll('optgroup')].map((g) => g.label), ['Projects', 'Workspaces']);
  assert.deepEqual([...select.options].map((o) => o.value), ['project:shop-1', 'workspace:ws1']);
  assert.equal(fields[3].querySelector('.hint').textContent, "Worca looks at this project's code once, read-only, to learn what already exists. Change that in Your notes for Worca.");
  select.value = 'workspace:ws1';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(fields[3].querySelector('.hint').textContent, "Worca looks at the code of this workspace's projects once, read-only, to learn what already exists. Change that in Your notes for Worca.");
  assert.equal(fields[3].querySelector('.req-brief-line'), null, 'no brief, no green line');
  assert.deepEqual([...form.querySelectorAll('.btn, .btn-primary')].map((b) => b.textContent), ['Cancel', 'Start the interview']);
  assert.ok([...form.querySelectorAll('.btn-primary')].at(-1).textContent === 'Start the interview', 'the CDP proof clicks the last .req-new .btn-primary');
  assert.doesNotMatch(host.textContent, /null|false|undefined/);
});

test('new feature: the hint says who interviews, then the cost (lane 2 replaces only the part after the dot)', async () => {
  const hint = async (extra) => {
    fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf([], extra) });
    const { host, view } = make();
    await view.show('new');
    assert.doesNotMatch(host.textContent, /null|false|undefined/);
    return host.querySelector('.req-new-cost');
  };
  let el = await hint({ lookCostUsd: 0.25, interview: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } });
  assert.equal(el.textContent, 'Worca interviews with Opus 5.5 at medium effort · about $0.25 for the code look, then cents per round');
  assert.equal(el.querySelector('.req-new-model').textContent, 'Worca interviews with Opus 5.5 at medium effort');
  assert.ok(el.classList.contains('hint'));
  el = await hint({ lookCostUsd: null, interview: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } });
  assert.equal(el.textContent, 'Worca interviews with Opus 5.5 at medium effort · cents per round');
  el = await hint({ lookCostUsd: 0.25, interview: { model: 'claude-sonnet-5', label: 'Sonnet 5', effort: null } });
  assert.equal(el.querySelector('.req-new-model').textContent, 'Worca interviews with Sonnet 5');
  el = await hint({ lookCostUsd: null, interview: { model: 'claude-sonnet-5', effort: null } });
  assert.equal(el.textContent, 'Worca interviews with claude-sonnet-5 · cents per round', 'no label: the model id');
  el = await hint({ lookCostUsd: 0.25, interview: null });
  assert.equal(el.textContent, 'About $0.25 for the code look, then cents per round.', "no interview info: today's hint");
  assert.equal(await hint({ lookCostUsd: null, interview: null }), null);
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

test('notes: a failed load of the brief page shows no notes editor and sends no PUT (was: context Save stays disabled)', async () => {
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/brief/project/shop-1': { __status: 500, body: { error: 'ctx down' } } });
  const { host, msgEl, view, routed } = make();
  await view.show('feature/4');
  await openNotes(host);
  await view.show(routed[0]);
  assert.match(msgEl.textContent, /ctx down/);
  assert.equal(host.querySelector('[data-ui="notes-body"]'), null);
  assert.equal(btn(host, 'Save notes'), undefined);
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
  const trigger = () => btn(host, 'Export');
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

test('⋯ menu: Your notes for Worca, Look again, Archive; kept open across a live update; the lock rules', async () => {
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
  assert.deepEqual(items().map((x) => x.textContent), ['Your notes for Worca', 'Look again', 'Archive']);
  assert.ok(items().every((x) => !x.disabled));
  fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: feature({ busy: true, status: 'thinking', state: 'thinking', pending: null }), turns: [] } });
  await view.changed(4);
  assert.equal(more().parentElement.querySelector('[role="menu"]').hidden, false, 'still open');
  assert.deepEqual(items().map((x) => [x.textContent, x.disabled]), [['Your notes for Worca', false], ['Look again', true], ['Archive', true]]);
  fakeApi({ ...BASE, 'GET /api/requirements/4': { feature: feature({ scopeType: 'workspace', scopeKey: 'ws1' }), turns: [] } });
  await view.changed(4);
  assert.equal(items()[0].textContent, 'Your notes for Worca');
  assert.equal(items()[0].getAttribute('data-ui'), 'mi-notes');
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
  assert.equal(start().textContent, 'Start in Worca');
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
  assert.ok(follow().classList.contains('btn-primary'));
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
  assert.ok(go.classList.contains('btn-primary'));
  assert.equal(go.textContent, 'Start in Worca');
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
  btn(host, 'Export').click();
  btn(host, 'Copy Markdown').focus();
  await view.changed(4);
  assert.equal(document.activeElement && document.activeElement.textContent, 'Copy Markdown');
  assert.ok(host.contains(document.activeElement));
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(btn(host, 'Export').getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, btn(host, 'Export'));
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

// ---- A7 Task 7: the brief page with no brief yet (board 11), Your notes for Worca, the list's group header ----

const { age } = await import('../ui/public/requirements-view.mjs');
const BRIEF_URL = '/api/requirements/brief/project/shop-1';
// The brief page's body (A7 §5): no brief yet, the target with its default branch, the notes, the estimate.
const briefBody = (over = {}) => ({ brief: null, target: { name: 'shop', branch: 'main', leftOut: [], slow: [] },
  notes: { scopeType: 'project', scopeKey: 'shop-1', body: 'Shoppers order things.', lookAtCode: true },
  estimate: { costUsd: 1.5, model: { id: 'claude-opus-5-5', label: 'Opus 5.5' } }, usedBy: [], staleness: null, ...over });
const briefRow = (over = {}) => ({ id: 3, scopeType: 'project', scopeKey: 'shop-1', status: 'empty', sections: {}, edited: {}, sources: [],
  files: [], seed: null, model: null, costUsd: 0, error: null, madeBy: null, madeAt: null, updatedAt: '2026-10-21T10:00:00Z', ...over });
const briefRoutes = (body = briefBody(), extra = {}) => ({ ...BASE, [`GET ${BRIEF_URL}`]: typeof body === 'function' ? body : () => body, ...extra });
const createBtn = (host) => host.querySelector('[data-ui="brief-create"]');
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);

test('age: today, yesterday, days, weeks, months', () => {
  const now = new Date(2026, 9, 21, 15, 0).getTime();
  const at = (y, m, d, hh = 9) => new Date(y, m, d, hh).toISOString();
  assert.equal(age(at(2026, 9, 21, 1), now), 'today');
  assert.equal(age(at(2026, 9, 20, 23), now), 'yesterday');
  assert.equal(age(at(2026, 9, 18), now), '3 days');
  assert.equal(age(at(2026, 9, 8), now), '13 days');
  assert.equal(age(at(2026, 9, 7), now), '2 weeks');
  assert.equal(age(at(2026, 7, 26), now), '8 weeks');
  assert.equal(age(at(2026, 7, 10), now), '2 months');
  assert.equal(age(at(2026, 6, 1), now), '3 months');
  assert.equal(age(at(2026, 9, 25), now), 'today', 'a time ahead of the clock reads today');
  assert.equal(age('not a date', now), '');
});

test('brief page: the route decodes the scope key; the header, the subtitle and the back link', async () => {
  const W = '/api/requirements/brief/workspace/ws%3A1%3Ab';
  const calls = fakeApi({ ...BASE, 'GET /api/workspaces': { workspaces: [{ id: 'ws:1:b', name: 'Storefront' }] },
    [`GET ${W}`]: briefBody({ target: { name: 'Storefront', branch: null, leftOut: [], slow: [] } }) });
  const { host, view, routed } = make();
  await view.show(`brief/workspace/${encodeURIComponent('ws:1:b')}`);
  assert.ok(calls.some((c) => c.method === 'GET' && c.url === W), 'fetched with the key encoded again');
  assert.equal(host.querySelector('.req-brief-page h2').textContent, 'Product brief');
  assert.equal(host.querySelector('.req-brief-head .chip').textContent, 'Workspace · Storefront');
  assert.equal(host.querySelector('.req-brief-head .req-sub').textContent,
    "What the product does, in your words and Worca's. Every interview for Storefront starts from it.");
  const back = host.querySelector('.req-back');
  assert.equal(back.textContent, '← All features');
  back.click();
  assert.deepEqual(routed, ['']);
});

test('brief page, none yet: the head-start card, the four parts, the cost box with the estimate and the model', async () => {
  fakeApi(briefRoutes());
  const { host, view } = make();
  await view.show('brief/project/shop-1');
  const card = host.querySelector('section.req-brief-start');
  assert.ok(card.classList.contains('card'));
  assert.equal(card.querySelector('h3').textContent, 'Give Worca a head start');
  assert.equal(text(card.querySelector('.req-brief-why')), 'Today Worca looks at the code again for every new feature. A brief is one deeper look, done once, that every feature here reuses: interviews ask better questions sooner, and each feature saves its own look.');
  const parts = [...card.querySelectorAll('.req-brief-parts li')];
  assert.deepEqual(parts.map(text), ['What the product does, in a few sentences', 'Who uses it and what each of them can do',
    'The words the product uses: its concepts and what they mean', 'What exists today, area by area, and what only partly exists']);
  assert.deepEqual(parts.map((li) => li.querySelector('b').textContent), ['What the product does', 'Who uses it', 'The words the product uses', 'What exists today']);
  assert.ok(parts.every((li) => li.querySelector('svg').getAttribute('aria-hidden') === 'true'), 'the check icons are decorative');
  assert.equal(text(card.querySelector('.req-brief-plain')), 'Plain product language, no code. You can edit every part; your text is kept.');
  const box = card.querySelector('.req-brief-cost');
  assert.equal(text(box.querySelector('.req-brief-look')), 'One look, read-only');
  assert.equal(text(box.querySelector('.req-brief-facts')), 'Branch main · about $1.50 · 3 to 5 minutes');
  assert.deepEqual([...box.querySelectorAll('.req-brief-facts code')].map((c) => c.textContent), ['main', '$1.50']);
  assert.equal(text(box.querySelector('.req-brief-model')), 'Opus 5.5 · counts toward your limit');
  const go = createBtn(host);
  assert.equal(go.textContent, 'Create the brief');
  assert.ok(go.classList.contains('btn-primary'));
  assert.equal(go.disabled, false);
  assert.ok(!/null|undefined/.test(host.textContent), 'no "null" or "undefined" on the page');
});

test('brief page, none yet: no estimate hides the cost and the model line; a workspace reads each default branch', async () => {
  fakeApi(briefRoutes(briefBody({ estimate: { costUsd: null, model: null } })));
  const { host, view } = make();
  await view.show('brief/project/shop-1');
  assert.equal(text(host.querySelector('.req-brief-facts')), 'Branch main · 3 to 5 minutes');
  assert.equal(host.querySelector('.req-brief-model'), null);
  const W = '/api/requirements/brief/workspace/ws1';
  fakeApi({ ...BASE, [`GET ${W}`]: briefBody({ target: { name: 'Storefront', branch: null, leftOut: [], slow: [] } }) });
  const w = make();
  await w.view.show('brief/workspace/ws1');
  assert.equal(text(w.host.querySelector('.req-brief-facts')), "Each project's default branch · about $1.50 · 3 to 5 minutes");
  assert.equal(createBtn(w.host).disabled, false, 'a workspace has no single branch: the server decides');
  assert.equal(w.host.querySelector('.req-brief-left-out'), null);
});

test('brief page, none yet: Create posts, then paints the answer; a refused Create says why and the button stays', async () => {
  let made = false;
  const calls = fakeApi(briefRoutes(() => (made ? briefBody({ brief: briefRow({ status: 'making' }) }) : briefBody()), {
    [`POST ${BRIEF_URL}`]: () => { made = true; return { __status: 202, body: briefBody({ brief: briefRow({ status: 'making' }) }) }; } }));
  const { host, view } = make();
  await view.show('brief/project/shop-1');
  createBtn(host).click();
  assert.equal(createBtn(host).disabled, true, 'disabled at once: no second press');
  createBtn(host).click();
  await tick(); await tick();
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url === BRIEF_URL).length, 1);
  assert.equal(createBtn(host).textContent, 'Creating…');
  assert.equal(createBtn(host).disabled, true);
  // refused: budget
  const r = fakeApi(briefRoutes(briefBody(), { [`POST ${BRIEF_URL}`]: { __status: 409, body: { error: 'The spending limit of $5 is reached for this period. Worca can make the brief when the limit resets or is raised.' } } }));
  const b = make();
  await b.view.show('brief/project/shop-1');
  createBtn(b.host).click();
  await tick(); await tick(); await tick();
  assert.equal(r.filter((c) => c.method === 'POST').length, 1);
  assert.match(b.msgEl.textContent, /The spending limit of \$5 is reached/);
  assert.ok(b.msgEl.classList.contains('err'));
  assert.equal(createBtn(b.host).textContent, 'Create the brief');
  assert.equal(createBtn(b.host).disabled, false, 'the button stays');
});

test('brief page, none yet: making, a failed first make, the switch off, no repository, members left out', async () => {
  const states = [
    [briefBody({ brief: briefRow({ status: 'making' }) }), { label: 'Creating…', disabled: true,
      hint: 'Worca is reading the code. This takes a few minutes; you can leave this page.' }],
    [briefBody({ brief: briefRow({ status: 'empty', error: { code: 'BAD_REPLY', message: 'Worca ran out of steps before writing the brief.', at: 'x' } }) }),
      { label: 'Try again', disabled: false, failed: 'Worca ran out of steps before writing the brief.' }],
    [briefBody({ notes: { body: '', lookAtCode: false } }), { label: 'Create the brief', disabled: true,
      hint: 'Looking at the code is off. Turn it on under Your notes for Worca.' }],
    [briefBody({ target: { name: 'shop', branch: null, leftOut: [], slow: [] } }), { label: 'Create the brief', disabled: true,
      hint: 'There is no repository to look at.' }],
  ];
  for (const [body, want] of states) {
    fakeApi(briefRoutes(body));
    const { host, view } = make();
    await view.show('brief/project/shop-1');
    const go = createBtn(host);
    assert.equal(go.textContent, want.label);
    assert.equal(go.disabled, want.disabled, want.label);
    assert.equal(text(host.querySelector('.req-brief-why-not')), want.hint || null);
    assert.equal(text(host.querySelector('.req-brief-failed')), want.failed || null);
    if (want.failed) {
      const box = host.querySelector('.req-brief-cost');
      const kids = [...box.children];
      assert.ok(kids.indexOf(box.querySelector('.req-brief-failed')) < kids.indexOf(go), 'the failure is said above the button');
    }
  }
  // no branch on a project because git was slow: the server decides (it says so on Create)
  fakeApi(briefRoutes(briefBody({ target: { name: 'shop', branch: null, leftOut: [], slow: ['shop'] } })));
  const s = make();
  await s.view.show('brief/project/shop-1');
  assert.equal(createBtn(s.host).disabled, false);
  assert.equal(text(s.host.querySelector('.req-brief-facts')), 'about $1.50 · 3 to 5 minutes');
  // a workspace past the checkout cap names the members left out
  const W = '/api/requirements/brief/workspace/ws1';
  fakeApi({ ...BASE, [`GET ${W}`]: briefBody({ target: { name: 'Storefront', branch: null, leftOut: ['cart', 'mail', 'pay'], slow: [] } }) });
  const w = make();
  await w.view.show('brief/workspace/ws1');
  assert.equal(text(w.host.querySelector('.req-brief-left-out')), 'Worca reads at most 8 projects of a workspace: cart, mail and pay are left out.');
  assert.equal(w.host.querySelector('.req-brief-slow'), null);
  // repositories too slow to read on this load are named, as the ones left out are; Create stays (it probes longer)
  fakeApi({ ...BASE, [`GET ${W}`]: briefBody({ target: { name: 'Storefront', branch: null, repositories: 1, leftOut: [], slow: ['cart', 'mail'] } }) });
  const sw = make();
  await sw.view.show('brief/workspace/ws1');
  assert.equal(text(sw.host.querySelector('.req-brief-slow')), 'Worca could not read cart and mail in time; Create tries again.');
  assert.equal(createBtn(sw.host).disabled, false);
  assert.equal(text(s.host.querySelector('.req-brief-slow')), 'Worca could not read shop in time; Create tries again.');
});

test('brief page: Your notes for Worca: the card, Save notes puts the body and the switch, then repaints', async () => {
  let look = true;
  const calls = fakeApi(briefRoutes(() => briefBody({ notes: { body: look ? 'Shoppers order things.' : 'New notes', lookAtCode: look } }), {
    'PUT /api/requirements/context/project/shop-1': () => { look = false; return { body: 'New notes', lookAtCode: false }; } }));
  const { host, view } = make();
  await view.show('brief/project/shop-1');
  const card = host.querySelector('section.card[aria-label="Your notes for Worca"]');
  assert.ok(card);
  assert.equal(card.querySelector('h3').textContent, 'Your notes for Worca');
  const area = card.querySelector('textarea[data-ui="notes-body"]');
  assert.equal(area.getAttribute('aria-label'), 'Your notes for Worca');
  assert.equal(area.value, 'Shoppers order things.');
  const sw = card.querySelector('input[type="checkbox"][data-ui="notes-look"]');
  assert.equal(sw.checked, true);
  assert.equal(text(sw.closest('label')), 'Let Worca look at the code (for the brief, and when you ask it to look closer at a feature)');
  area.value = 'New notes';
  sw.checked = false;
  const save = btn(host, 'Save notes');
  assert.ok(save.classList.contains('btn') && save.classList.contains('btn-sm'));
  save.click();
  await tick(); await tick(); await tick();
  assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { body: 'New notes', lookAtCode: false });
  assert.ok(calls.filter((c) => c.method === 'GET' && c.url === BRIEF_URL).length >= 2, 'repainted from the server');
  assert.equal(createBtn(host).disabled, true, 'the switch, now off, disables Create');
  assert.equal(text(host.querySelector('.req-brief-why-not')), 'Looking at the code is off. Turn it on under Your notes for Worca.');
  assert.equal(host.querySelector('[data-ui="notes-look"]').checked, false);
  assert.equal(host.querySelector('[data-ui="notes-body"]').value, 'New notes');
});

test('brief page: unsaved notes survive a live repaint; a workspace has the same notes card', async () => {
  fakeApi(briefRoutes());
  const { host, view } = make();
  await view.show('brief/project/shop-1');
  host.querySelector('[data-ui="notes-body"]').value = 'Half typed';
  host.querySelector('[data-ui="notes-look"]').checked = false;
  await view.changed(undefined, 'project:shop-1');
  assert.equal(host.querySelector('[data-ui="notes-body"]').value, 'Half typed');
  assert.equal(host.querySelector('[data-ui="notes-look"]').checked, false);
  // leaving the page drops the draft
  await view.show('');
  await view.show('brief/project/shop-1');
  assert.equal(host.querySelector('[data-ui="notes-body"]').value, 'Shoppers order things.');
  const W = '/api/requirements/brief/workspace/ws1';
  fakeApi({ ...BASE, [`GET ${W}`]: briefBody({ target: { name: 'Storefront', branch: null, leftOut: [], slow: [] } }) });
  const w = make();
  await w.view.show('brief/workspace/ws1');
  assert.equal(w.host.querySelector('.req-brief-notes h3').textContent, 'Your notes for Worca');
});

test('list: each group header names its brief: none yet with Create, being made, or its age; each links to the brief page', async () => {
  const day = 86400000;
  fakeApi({ ...LIST_BASE, 'GET /api/workspaces': { workspaces: [{ id: 'ws:1', name: 'Storefront' }, { id: 'ws2', name: 'Mall' }] },
    'GET /api/requirements': listOf([row(), row({ seq: 3, scopeType: 'workspace', scopeKey: 'ws:1' }), row({ seq: 6, scopeType: 'workspace', scopeKey: 'ws2' })], {
      briefs: [{ scopeType: 'workspace', scopeKey: 'ws:1', status: 'making', madeAt: null, lookAtCode: true },
        { scopeType: 'workspace', scopeKey: 'ws2', status: 'ready', madeAt: new Date(Date.now() - 3 * day).toISOString(), lookAtCode: true }] }) });
  const { host, view, routed } = make();
  await view.show('');
  assert.deepEqual([...host.querySelectorAll('.req-group h2')].map((x) => x.textContent), ['Project · shop', 'Workspace · Storefront', 'Workspace · Mall']);
  const heads = [...host.querySelectorAll('.req-group-brief')];
  assert.deepEqual(heads.map(text), ['Product brief: none yet · Create', 'Product brief: being made…', 'Product brief · 3 days old']);
  const links = heads.map((x) => x.querySelector('a'));
  assert.deepEqual(links.map((a) => a.textContent), ['Create', 'Product brief: being made…', 'Product brief · 3 days old']);
  assert.deepEqual(links.map((a) => a.getAttribute('href')), ['#requirements/brief/project/shop-1', '#requirements/brief/workspace/ws%3A1', '#requirements/brief/workspace/ws2']);
  links.forEach((a) => a.click());
  assert.deepEqual(routed, ['brief/project/shop-1', 'brief/workspace/ws%3A1', 'brief/workspace/ws2']);
  // an `empty` row (a failed first make) reads none yet too; a brief made today says so
  fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf([row()], { briefs: [{ scopeType: 'project', scopeKey: 'shop-1', status: 'empty', madeAt: null }] }) });
  const e = make();
  await e.view.show('');
  assert.equal(text(e.host.querySelector('.req-group-brief')), 'Product brief: none yet · Create');
  fakeApi({ ...LIST_BASE, 'GET /api/requirements': listOf([row()], { briefs: [{ scopeType: 'project', scopeKey: 'shop-1', status: 'ready', madeAt: new Date().toISOString() }] }) });
  const t = make();
  await t.view.show('');
  assert.equal(text(t.host.querySelector('.req-group-brief')), 'Product brief · made today');
});

test('changed: the brief key splits on its first ":"; who repaints on a brief frame and on a seq frame', async () => {
  const W = '/api/requirements/brief/workspace/ws%3A1';
  const calls = fakeApi({ ...BASE, 'GET /api/workspaces': { workspaces: [{ id: 'ws:1', name: 'Storefront' }] },
    [`GET ${W}`]: briefBody({ target: { name: 'Storefront', branch: null, leftOut: [], slow: [] }, usedBy: [{ seq: 8, id: 'FEAT-8' }] }),
    'GET /api/requirements': listOf([row(), row({ seq: 9, scopeType: 'workspace', scopeKey: 'ws:1' })]),
    'GET /api/requirements/4': () => ({ feature: feature(), turns: [] }) });
  const gets = (url) => calls.filter((c) => c.method === 'GET' && c.url === url).length;
  const { view } = make();
  // the list: any frame
  await view.show('');
  let n = gets('/api/requirements');
  await view.changed(undefined, 'project:other');
  assert.equal(gets('/api/requirements'), n + 1);
  // the brief page: its own scope (a key with ':' after the first), its features' seq frames, a seq it never saw
  await view.show(`brief/workspace/${encodeURIComponent('ws:1')}`);
  n = gets(W);
  await view.changed(undefined, 'workspace:ws:1');
  assert.equal(gets(W), n + 1, 'its scope');
  await view.changed(undefined, 'workspace:ws');
  await view.changed(undefined, 'project:ws:1');
  assert.equal(gets(W), n + 1, 'another scope');
  await view.changed(9);
  assert.equal(gets(W), n + 2, 'a feature of its scope (from the list)');
  await view.changed(8);
  assert.equal(gets(W), n + 3, 'a feature using the brief');
  await view.changed(4);
  assert.equal(gets(W), n + 3, 'a feature of another scope');
  await view.changed(77);
  assert.equal(gets(W), n + 4, 'a feature never seen may be of this scope');
  // the feature page: its seq, or its scope's brief
  await view.show('feature/4');
  n = gets('/api/requirements/4');
  await view.changed(undefined, 'project:shop-1');
  assert.equal(gets('/api/requirements/4'), n + 1);
  await view.changed(undefined, 'project:shop-2');
  await view.changed(5);
  assert.equal(gets('/api/requirements/4'), n + 1);
  await view.changed(4);
  assert.equal(gets('/api/requirements/4'), n + 2);
  // the New feature form: never
  await view.show('new');
  const all = calls.length;
  await view.changed(undefined, 'project:shop-1');
  await view.changed(4);
  assert.equal(calls.length, all);
});

test('style.css: the req-brief rules use tokens only', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const rules = css.split('\n').filter((l) => /\.req-brief|\.req-group-|\.req-knows/.test(l));
  assert.ok(rules.length > 0, 'the brief page has its rules');
  assert.ok(rules.every((l) => !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l)), 'no literal colour');
  // the notice's branch and commit read inline: no padded box leaves a gap before ";", " since " or "."
  const code = css.split('\n').find((l) => l.startsWith('.req-brief-stale-text code{'));
  assert.ok(code, 'the rule');
  assert.ok(!/padding:(?!0[;}])/.test(code), `no padding: ${code}`);
  assert.ok(!/background:(?!none)/.test(code), `no box: ${code}`);
  assert.equal(css.includes('.req-context'), false, 'the removed panel left no rules');
  assert.equal(css.includes('.req-ctx-'), false, 'nor its class names');
});

// ---- A7 Task 8: the brief page with a made brief (board 12): chips, the code-moved-on notice, the brief card and
// its editors, the right column, Export and ⋯ ----

const DAY = 86400000;
const MADE_SECTIONS = {
  product: 'An online shop for home goods. Shoppers browse a catalog and follow their order.',
  users: [{ name: 'Shopper', can: 'browses, orders, pays.' }, { name: 'Support agent', can: 'sees every order.' }],
  terms: [{ term: 'Packed', meaning: 'in a box at the warehouse.' }, { term: 'Refund', meaning: 'money back.' }],
  areas: [
    { name: 'Orders', text: 'checkout, order history; no cancel action', status: 'partly', files: ['src/orders.mjs'], added: null, belongsTo: null },
    { name: 'Catalog', text: 'categories and product pages', status: 'exists', files: [], added: null, belongsTo: null },
    { name: 'Gift message on an order', text: 'The packing slip is printed from the order.', status: null, files: ['src/slip.mjs'],
      added: { feature: 'FEAT-6', at: '2026-10-20T10:00:00Z' }, belongsTo: 'Orders' },
  ],
};
const madeRow = (over = {}) => briefRow({ status: 'ready', sections: MADE_SECTIONS, edited: { users: true },
  sources: [{ project: 'shop-1', branch: 'main', ref: 'refs/heads/main', sha: '3f9c2a1deadbeef00' }], files: ['README.md', 'src/orders.mjs', 'src/slip.mjs'],
  model: 'claude-opus-5-5', costUsd: 1.42, madeBy: 'po', madeAt: new Date(Date.now() - 2 * DAY).toISOString(), ...over });
const STALE = { known: true, commits: 38, touching: 6, areas: ['Orders', 'Payments'], checked: true, partial: false,
  sources: [{ project: 'shop-1', branch: 'main', ref: 'refs/heads/main', sha: '3f9c2a1deadbeef00', known: true, commits: 38 }] };
const madeBody = (over = {}) => briefBody({ brief: madeRow(), usedBy: [{ seq: 2, id: 'FEAT-2' }, { seq: 3, id: 'FEAT-3' }], staleness: STALE, ...over });
const W1 = '/api/requirements/brief/workspace/ws1';
const wsBody = (over = {}) => madeBody({ target: { name: 'Storefront', branch: null, leftOut: [], slow: [] },
  brief: madeRow({ scopeType: 'workspace', scopeKey: 'ws1', seed: { kind: 'workspace-map', scannedAt: '2026-10-18T09:30:00Z' },
    sources: ['cart', 'pay', 'mail'].map((p) => ({ project: p, branch: 'main', ref: 'refs/heads/main', sha: `${p}0000000aaa` })) }),
  usedBy: [{ seq: 2, id: 'FEAT-2' }], ...over });
const chips = (host) => [...host.querySelectorAll('.req-brief-chips > *')].map(text);
const notice = (host) => host.querySelector('section[aria-label="The brief is behind the code"]');
const openBrief = async (body, extra = {}) => {
  const calls = fakeApi(briefRoutes(body, extra));
  const m = make();
  await m.view.show('brief/project/shop-1');
  return { ...m, calls };
};
const withConfirm = async (answer, fn) => {
  const was = window.confirm;
  const asked = [];
  window.confirm = (q) => { asked.push(q); return answer; };
  try { await fn(); } finally { window.confirm = was; }
  return asked;
};

test('brief page, made: the chips (branch @ sha · age, cost, used by), no head-start card, Export and ⋯', async () => {
  const { host } = await openBrief(madeBody());
  assert.equal(host.querySelector('.req-brief-start'), null, 'no head-start card');
  assert.equal(host.querySelector('.req-brief-head .req-sub'), null, 'no subtitle once made');
  assert.equal(host.querySelector('.req-brief-head .req-head-title .chip').textContent, 'Project · shop');
  assert.deepEqual(chips(host), ['Made from main @ 3f9c2a1 · 2 days ago', '$1.42', 'Used by 2 features']);
  assert.equal(host.querySelector('.req-brief-chips code').textContent, 'main @ 3f9c2a1');
  assert.equal(host.querySelector('.req-brief-chips .badge'), null, 'no Refreshing badge');
  assert.ok(btn(host, 'Export'), 'Export');
  assert.ok(host.querySelector('[data-ui="brief-more"][aria-label="More actions"]'), '⋯');
  assert.ok(!/null|undefined/.test(host.textContent), 'no "null" or "undefined" on the page');
  // made today, one user
  const t = await openBrief(madeBody({ brief: madeRow({ madeAt: new Date().toISOString() }), usedBy: [{ seq: 2, id: 'FEAT-2' }] }));
  assert.deepEqual(chips(t.host), ['Made from main @ 3f9c2a1 · today', '$1.42', 'Used by 1 feature']);
});

test('brief page, made: a workspace counts its projects and names the workspace map; Refreshing while it is made again', async () => {
  fakeApi({ ...BASE, [`GET ${W1}`]: wsBody() });
  const w = make();
  await w.view.show('brief/workspace/ws1');
  assert.deepEqual(chips(w.host), ['Made from 3 projects · 2 days ago', '$1.42', 'Used by 1 feature', 'Built from the workspace map, scanned 2026-10-18']);
  // a description written by hand: no map chip
  fakeApi({ ...BASE, [`GET ${W1}`]: wsBody({ brief: madeRow({ scopeType: 'workspace', scopeKey: 'ws1', seed: { kind: 'workspace-description' } }) }) });
  const d = make();
  await d.view.show('brief/workspace/ws1');
  assert.ok(!chips(d.host).some((c) => /workspace map/.test(c)));
  // refreshing: the running badge, the Refresh controls disabled, the sections still editable
  const r = await openBrief(madeBody({ brief: madeRow({ status: 'making' }) }));
  const badge = r.host.querySelector('.req-brief-chips .badge');
  assert.equal(badge.textContent, 'Refreshing');
  assert.ok(badge.classList.contains('running'));
  assert.equal(r.host.querySelector('[data-ui="brief-refresh"]').disabled, true, 'the notice button');
  assert.equal(r.host.querySelector('[data-ui="mi-brief-refresh"]').disabled, true, 'the ⋯ entry');
  assert.equal(r.host.querySelector('[data-ui="mi-brief-delete"]').disabled, true, 'no delete while it is being made');
  assert.ok([...r.host.querySelectorAll('[data-ui^="brief-edit-"]')].every((b) => !b.disabled), 'the pencils stay');
});

test('brief page, made: a failed refresh is said under the chips with Refresh', async () => {
  let made = false;
  const { host, calls } = await openBrief(() => madeBody({ brief: madeRow(made ? { status: 'making' } : { error: { code: 'TIMEOUT', message: 'Worca could not check out the code in time. Try again.', at: 'x' } }) }), {
    [`POST ${BRIEF_URL}`]: () => { made = true; return { __status: 202, body: madeBody({ brief: madeRow({ status: 'making' }) }) }; } });
  const line = host.querySelector('.req-brief-refresh-failed');
  assert.equal(text(line), 'The last refresh failed: Worca could not check out the code in time. Try again. Refresh');
  const kids = [...host.querySelector('.req-brief-head').children];
  assert.ok(kids.indexOf(line) > kids.indexOf(host.querySelector('.req-brief-head-row')), 'under the chips');
  const go = line.querySelector('button');
  assert.ok(go.classList.contains('btn') && go.classList.contains('btn-sm'));
  go.click();
  assert.equal(go.disabled, true, 'disabled at once');
  go.click();
  await tick(); await tick();
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url === BRIEF_URL).length, 1);
  assert.equal(host.querySelector('.req-brief-refresh-failed'), null, 'gone once it runs again');
  assert.equal(host.querySelector('.req-brief-chips .badge').textContent, 'Refreshing');
  // no failure line while a refresh runs
  const ok = await openBrief(madeBody({ brief: madeRow({ status: 'making', error: { code: 'X', message: 'old', at: 'x' } }) }));
  assert.equal(ok.host.querySelector('.req-brief-refresh-failed'), null);
});

test('brief page, made: Export (Copy Markdown, Download .md) and ⋯ (Refresh with the estimate, Delete with a confirmation)', async () => {
  const { host, msgEl, calls } = await openBrief(madeBody(), {
    [`POST ${BRIEF_URL}`]: { __status: 202, body: madeBody({ brief: madeRow({ status: 'making' }) }) },
    [`DELETE ${BRIEF_URL}`]: briefBody(), [`GET ${BRIEF_URL}/markdown`]: {} });
  btn(host, 'Export').click();
  const exp = host.querySelector('[data-menu="brief-export"] [role="menu"]');
  assert.equal(exp.hidden, false);
  assert.deepEqual([...exp.querySelectorAll('[role="menuitem"]')].map((x) => x.textContent), ['Copy Markdown', 'Download .md']);
  assert.equal(exp.querySelector('a[role="menuitem"]').getAttribute('href'), `${BRIEF_URL}/markdown?download=1`);
  clip.length = 0;
  btn(host, 'Copy Markdown').click();
  await tick(); await tick();
  assert.ok(calls.some((c) => c.method === 'GET' && c.url === `${BRIEF_URL}/markdown`));
  assert.deepEqual(clip, ['# md']);
  assert.equal(msgEl.textContent, 'Copied as Markdown.');
  assert.equal(exp.hidden, true, 'a choice closes the menu');
  host.querySelector('[data-ui="brief-more"]').click();
  const more = host.querySelector('[data-menu="brief-more"] [role="menu"]');
  assert.equal(more.hidden, false);
  assert.deepEqual([...more.querySelectorAll('[role="menuitem"]')].map((x) => x.textContent), ['Refresh the brief · about $1.50', 'Delete the brief']);
  // Delete: the confirmation names the features using the brief; No keeps it
  let asked = await withConfirm(false, async () => { host.querySelector('[data-ui="mi-brief-delete"]').click(); await tick(); await tick(); });
  assert.deepEqual(asked, ['Delete the brief? FEAT-2 and FEAT-3 use this brief; they go back to looking at the code when asked.']);
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0);
  await withConfirm(true, async () => { host.querySelector('[data-ui="mi-brief-delete"]').click(); await tick(); await tick(); });
  assert.equal(calls.filter((c) => c.method === 'DELETE' && c.url === BRIEF_URL).length, 1);
  assert.ok(host.querySelector('.req-brief-start'), 'painted from the answer: none yet again');
  // Refresh from ⋯ posts once; without an estimate the entry has no cost
  const r = await openBrief(madeBody({ estimate: { costUsd: null, model: null } }), { [`POST ${BRIEF_URL}`]: { __status: 202, body: madeBody({ brief: madeRow({ status: 'making' }) }) } });
  assert.equal(r.host.querySelector('[data-ui="mi-brief-refresh"]').textContent, 'Refresh the brief');
  r.host.querySelector('[data-ui="mi-brief-refresh"]').click();
  await tick(); await tick();
  assert.equal(r.calls.filter((c) => c.method === 'POST' && c.url === BRIEF_URL).length, 1);
  assert.equal(r.host.querySelector('.req-brief-chips .badge').textContent, 'Refreshing');
  // one user, no user
  const one = await openBrief(madeBody({ usedBy: [{ seq: 2, id: 'FEAT-2' }] }));
  asked = await withConfirm(false, async () => { one.host.querySelector('[data-ui="mi-brief-delete"]').click(); await tick(); });
  assert.deepEqual(asked, ['Delete the brief? FEAT-2 uses this brief; it goes back to looking at the code when asked.']);
  const none = await openBrief(madeBody({ usedBy: [] }));
  asked = await withConfirm(false, async () => { none.host.querySelector('[data-ui="mi-brief-delete"]').click(); await tick(); });
  assert.deepEqual(asked, ['Delete the brief? No feature uses this brief yet.']);
});

test('brief page, made: the code-moved-on notice, with the changed areas or none, and its Refresh', async () => {
  const { host, calls } = await openBrief(madeBody(), { [`POST ${BRIEF_URL}`]: { __status: 202, body: madeBody({ brief: madeRow({ status: 'making' }) }) } });
  const n = notice(host);
  assert.ok(n, 'the notice');
  assert.ok(n.classList.contains('req-changed'), 'the amber wash');
  assert.equal(n.querySelector('svg').getAttribute('aria-hidden'), 'true', 'the warning icon');
  assert.equal(n.querySelector('b').textContent, 'The code moved on since this brief');
  const p = n.querySelector('.req-brief-stale-text');
  assert.equal(text(p), '38 commits on main since 3f9c2a1; 6 of them change areas the brief describes: Orders and Payments. Interviews still use the brief as it is.');
  assert.deepEqual([...p.querySelectorAll('code')].map((c) => c.textContent), ['main', '3f9c2a1']);
  assert.deepEqual([...p.querySelectorAll('b')].map((c) => c.textContent), ['Orders', 'Payments']);
  const go = n.querySelector('[data-ui="brief-refresh"]');
  assert.equal(go.textContent, 'Refresh · about $1.50');
  assert.ok(go.classList.contains('btn') && go.classList.contains('btn-sm'));
  assert.equal(n.querySelectorAll('button').length, 1, 'one Refresh (Q2)');
  go.click();
  await tick(); await tick();
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url === BRIEF_URL).length, 1);
  // m = 0, one commit; no estimate
  const z = await openBrief(madeBody({ estimate: { costUsd: null, model: null }, staleness: { ...STALE, commits: 1, touching: 0, areas: [] } }));
  assert.equal(text(notice(z.host).querySelector('.req-brief-stale-text')), '1 commit on main since 3f9c2a1; none of them change areas the brief describes. Interviews still use the brief as it is.');
  assert.equal(notice(z.host).querySelector('[data-ui="brief-refresh"]').textContent, 'Refresh');
  // three areas, an added one by its label; one commit touching
  const three = await openBrief(madeBody({ staleness: { ...STALE, touching: 1, areas: ['Orders', 'Catalog', 'Orders: Gift message on an order'] } }));
  assert.equal(text(notice(three.host).querySelector('.req-brief-stale-text')),
    '38 commits on main since 3f9c2a1; 1 of them changes areas the brief describes: Orders, Catalog and Orders: Gift message on an order. Interviews still use the brief as it is.');
  // partial: the file scan saw only the newest 2000 commits
  const part = await openBrief(madeBody({ staleness: { ...STALE, commits: 2400, partial: true } }));
  assert.equal(text(notice(part.host).querySelector('.req-brief-stale-text')),
    'More than 2000 commits on main since 3f9c2a1; of the newest 2000, 6 change areas the brief describes: Orders and Payments. Interviews still use the brief as it is.');
  const part1 = await openBrief(madeBody({ staleness: { ...STALE, commits: 2400, partial: true, touching: 1, areas: ['Orders'] } }));
  assert.equal(text(notice(part1.host).querySelector('.req-brief-stale-text')),
    'More than 2000 commits on main since 3f9c2a1; of the newest 2000, 1 changes areas the brief describes: Orders. Interviews still use the brief as it is.');
  const part0 = await openBrief(madeBody({ staleness: { ...STALE, commits: 2400, partial: true, touching: 0, areas: [] } }));
  assert.equal(text(notice(part0.host).querySelector('.req-brief-stale-text')),
    'More than 2000 commits on main since 3f9c2a1; of the newest 2000, none change areas the brief describes. Interviews still use the brief as it is.');
  // no notice: 0 commits, the areas section edited (not checked), no staleness
  for (const staleness of [{ ...STALE, commits: 0, touching: 0, areas: [] }, { ...STALE, touching: 0, areas: [], checked: false }, null]) {
    const x = await openBrief(madeBody({ staleness }));
    assert.equal(notice(x.host), null, JSON.stringify(staleness));
  }
  const ed = await openBrief(madeBody({ brief: madeRow({ edited: { areas: true } }), staleness: { known: false, reason: 'slow' } }));
  assert.equal(notice(ed.host), null, 'the owner owns What exists today: no notice at all');
});

test('brief page, made: a staleness that cannot be told says why, with the same Refresh', async () => {
  const cases = [
    [{ known: false, reason: 'missing', branch: 'main', sha: '3f9c2a1deadbeef00' }, "Worca cannot tell how far the code moved on: the project's folder is missing."],
    [{ known: false, reason: 'branch-gone', branch: 'trunk', sha: '3f9c2a1deadbeef00' }, 'Worca cannot tell how far the code moved on: the branch trunk no longer exists.'],
    [{ known: false, reason: 'rewritten', branch: 'main', sha: '3f9c2a1deadbeef00' }, 'Worca cannot tell how far the code moved on: the commit this brief was made from is no longer on main.'],
    [{ known: false, reason: 'slow' }, 'Worca cannot tell how far the code moved on: checking took too long; reload to try again.'],
  ];
  for (const [staleness, want] of cases) {
    const { host } = await openBrief(madeBody({ staleness }));
    const n = notice(host);
    assert.ok(n, staleness.reason);
    assert.equal(n.querySelector('b').textContent, 'Worca cannot check this brief against the code');
    assert.equal(text(n.querySelector('.req-brief-stale-text')), want);
    assert.equal(n.querySelector('[data-ui="brief-refresh"]').textContent, 'Refresh · about $1.50');
  }
  const { host } = await openBrief(madeBody({ staleness: { known: false, reason: 'branch-gone', branch: 'trunk' } }));
  assert.equal(notice(host).querySelector('.req-brief-stale-text code').textContent, 'trunk');
});

test('brief page, made: a workspace notice names the members not checked and those that joined after the brief', async () => {
  const st = { known: true, commits: 5, touching: 2, areas: ['Orders'], checked: true, partial: false, unknown: ['mail'], added: ['cart', 'pay'],
    sources: [{ project: 'cart', branch: 'main', sha: 'cart0000000aaa', known: true, commits: 5 }, { project: 'mail', known: false, reason: 'missing' }] };
  fakeApi({ ...BASE, [`GET ${W1}`]: wsBody({ staleness: st }) });
  const w = make();
  await w.view.show('brief/workspace/ws1');
  const n = notice(w.host);
  assert.equal(text(n.querySelector('.req-brief-stale-text')), '5 commits in its projects since this brief; 2 of them change areas the brief describes: Orders. Interviews still use the brief as it is.');
  assert.equal(text(n.querySelector('.req-brief-stale-unknown')), 'Not checked: mail.');
  assert.equal(text(n.querySelector('.req-brief-stale-added')), 'cart and pay joined after this brief; refresh to include them.');
  // nothing moved on: no notice (0 commits), but the members it does not cover are still said, in a small note
  fakeApi({ ...BASE, [`GET ${W1}`]: wsBody({ staleness: { ...st, commits: 0, touching: 0, areas: [], unknown: [] } }) });
  const q = make();
  await q.view.show('brief/workspace/ws1');
  assert.equal(notice(q.host), null);
  const small = q.host.querySelector('.req-brief-members');
  assert.ok(small, 'the small notice');
  assert.equal(small.querySelector('.req-brief-stale-unknown'), null);
  assert.equal(text(small.querySelector('.req-brief-stale-added')), 'cart and pay joined after this brief; refresh to include them.');
  assert.equal(small.querySelector('[data-ui="brief-refresh"]').textContent, 'Refresh · about $1.50');
  fakeApi({ ...BASE, [`GET ${W1}`]: wsBody({ staleness: { ...st, commits: 0, touching: 0, areas: [], unknown: ['mail'], added: [] } }) });
  const k = make();
  await k.view.show('brief/workspace/ws1');
  assert.equal(text(k.host.querySelector('.req-brief-members .req-brief-stale-unknown')), 'Not checked: mail.');
  assert.equal(k.host.querySelector('.req-brief-members .req-brief-stale-added'), null);
  // the full notice carries the lines itself: no second, small one
  assert.equal(w.host.querySelector('.req-brief-members'), null);
  // nothing uncovered: nothing at all
  fakeApi({ ...BASE, [`GET ${W1}`]: wsBody({ staleness: { ...st, commits: 0, touching: 0, areas: [], unknown: [], added: [] } }) });
  const none = make();
  await none.view.show('brief/workspace/ws1');
  assert.equal(none.host.querySelector('.req-brief-members'), null);
  // every member unknown: the reason, and who was not checked
  fakeApi({ ...BASE, [`GET ${W1}`]: wsBody({ staleness: { known: false, reason: 'missing', unknown: ['cart', 'mail'], added: [], sources: [] } }) });
  const u = make();
  await u.view.show('brief/workspace/ws1');
  assert.equal(text(notice(u.host).querySelector('.req-brief-stale-text')), "Worca cannot tell how far the code moved on: a project's folder is missing.");
  assert.equal(text(notice(u.host).querySelector('.req-brief-stale-unknown')), 'Not checked: cart and mail.');
  assert.equal(notice(u.host).querySelector('.req-brief-stale-added'), null);
  // every member it was made from has left the workspace
  fakeApi({ ...BASE, [`GET ${W1}`]: wsBody({ staleness: { known: false, reason: 'removed', unknown: [], added: ['pay'], sources: [] } }) });
  const r = make();
  await r.view.show('brief/workspace/ws1');
  assert.equal(text(notice(r.host).querySelector('.req-brief-stale-text')),
    'Worca cannot tell how far the code moved on: none of the projects it was made from is in the workspace any more.');
  assert.equal(text(notice(r.host).querySelector('.req-brief-stale-added')), 'pay joined after this brief; refresh to include them.');
});

test('brief page: a brief that finishes or fails while the page is open is announced once in the message line', async () => {
  let body = briefBody({ brief: briefRow({ status: 'making' }) });
  fakeApi(briefRoutes(() => body));
  const { msgEl, view } = make();
  await view.show('brief/project/shop-1');
  assert.equal(msgEl.textContent, '');
  await view.changed(undefined, 'project:shop-1');   // still making: nothing said
  assert.equal(msgEl.textContent, '');
  body = madeBody({ staleness: null });
  await view.changed(undefined, 'project:shop-1');
  assert.equal(msgEl.textContent, 'The product brief is ready.');
  assert.ok(msgEl.classList.contains('ok'));
  msgEl.textContent = '';
  await view.changed(undefined, 'project:shop-1');
  assert.equal(msgEl.textContent, '', 'said once, not on every repaint');
  // a refresh that fails keeps the earlier brief (ready, with the error)
  body = madeBody({ brief: madeRow({ status: 'making' }), staleness: null });
  await view.changed(undefined, 'project:shop-1');
  body = madeBody({ brief: madeRow({ error: { code: 'TIMEOUT', message: 'Worca got no reply within 600 seconds. Try again.', at: 'x' } }), staleness: null });
  await view.changed(undefined, 'project:shop-1');
  assert.equal(msgEl.textContent, 'The product brief could not be made: Worca got no reply within 600 seconds. Try again.');
  assert.ok(msgEl.classList.contains('err'));
  // a first make that fails
  let first = briefBody({ brief: briefRow({ status: 'making' }) });
  fakeApi(briefRoutes(() => first));
  const f = make();
  await f.view.show('brief/project/shop-1');
  first = briefBody({ brief: briefRow({ status: 'empty', error: { code: 'BAD_REPLY', message: 'Worca ran out of steps before writing the brief.', at: 'x' } }) });
  await f.view.changed(undefined, 'project:shop-1');
  assert.equal(f.msgEl.textContent, 'The product brief could not be made: Worca ran out of steps before writing the brief.');
  // opened when already made: nothing to announce
  fakeApi(briefRoutes(madeBody({ staleness: null })));
  const o = make();
  await o.view.show('brief/project/shop-1');
  await o.view.changed(undefined, 'project:shop-1');
  assert.equal(o.msgEl.textContent, '');
});

test('brief page, none yet: a workspace with no repository disables Create and says why, like a project', async () => {
  const W = '/api/requirements/brief/workspace/ws1';
  const at = async (target) => {
    fakeApi({ ...BASE, [`GET ${W}`]: briefBody({ target: { name: 'Storefront', branch: null, leftOut: [], slow: [], ...target } }) });
    const m = make();
    await m.view.show('brief/workspace/ws1');
    return m.host;
  };
  const none = await at({ repositories: 0 });
  assert.equal(createBtn(none).disabled, true);
  assert.equal(text(none.querySelector('.req-brief-why-not')), 'There is no repository to look at.');
  const two = await at({ repositories: 2 });
  assert.equal(createBtn(two).disabled, false);
  assert.equal(two.querySelector('.req-brief-why-not'), null);
  const slow = await at({ repositories: 0, slow: ['cart'] });
  assert.equal(createBtn(slow).disabled, false, 'a slow repository is not "no repository": the server decides on Create');
});

test('brief page, made: the brief card, its four sections, the edited mark and the pencils', async () => {
  const { host } = await openBrief(madeBody());
  const card = host.querySelector('section.card[aria-label="The brief"]');
  assert.ok(card);
  assert.deepEqual([...card.querySelectorAll('.req-sect')].map((s) => s.getAttribute('data-section')), ['product', 'users', 'terms', 'areas']);
  assert.deepEqual([...card.querySelectorAll('h4')].map(text), ['What the product does', 'Who uses it · edited by you', 'The words it uses', 'What exists today']);
  assert.ok(card.querySelector('[data-section="users"] h4 .req-edited'), 'edited by you in amber');
  const pencils = [...card.querySelectorAll('button.req-ico')];
  assert.deepEqual(pencils.map((b) => b.getAttribute('aria-label')), ['Edit What the product does', 'Edit Who uses it', 'Edit The words it uses', 'Edit What exists today']);
  assert.deepEqual(pencils.map((b) => b.getAttribute('data-ui')), ['brief-edit-product', 'brief-edit-users', 'brief-edit-terms', 'brief-edit-areas']);
  assert.equal(text(card.querySelector('[data-section="product"] p')), MADE_SECTIONS.product);
  const users = [...card.querySelectorAll('[data-section="users"] li')];
  assert.deepEqual(users.map(text), ['Shopper: browses, orders, pays.', 'Support agent: sees every order.']);
  assert.deepEqual(users.map((li) => li.querySelector('b').textContent), ['Shopper', 'Support agent']);
  const terms = card.querySelector('[data-section="terms"] .req-brief-terms');
  assert.deepEqual([...terms.querySelectorAll('b')].map((x) => x.textContent), ['Packed', 'Refund']);
  assert.deepEqual([...terms.querySelectorAll('span')].map((x) => x.textContent), ['in a box at the warehouse.', 'money back.']);
  const areas = [...card.querySelectorAll('[data-section="areas"] .req-brief-area')];
  assert.deepEqual(areas.map(text), ['Orders · checkout, order history; no cancel action Partly', 'Catalog · categories and product pages Exists',
    'Orders: Gift message on an order · The packing slip is printed from the order.']);
  assert.deepEqual(areas.map((a) => a.querySelector('b').textContent), ['Orders', 'Catalog', 'Orders: Gift message on an order']);
  assert.ok(areas[0].querySelector('.badge').classList.contains('amber'));
  assert.ok(areas[1].querySelector('.badge').classList.contains('green'));
  assert.equal(areas[2].querySelector('.badge'), null, 'no status, no badge');
  // Let Worca rewrite this only on the edited section; its name holds its visible text (WCAG label in name)
  assert.deepEqual([...card.querySelectorAll('.req-rewrite')].map((b) => b.closest('[data-section]').getAttribute('data-section')), ['users']);
  const rw = card.querySelector('.req-rewrite');
  assert.equal(rw.textContent, 'Let Worca rewrite this');
  assert.equal(rw.getAttribute('aria-label'), 'Let Worca rewrite this — Who uses it');
  // empty sections
  const e = await openBrief(madeBody({ brief: madeRow({ sections: { product: '', users: [], terms: [], areas: [] }, edited: {} }) }));
  assert.deepEqual([...e.host.querySelectorAll('section[aria-label="The brief"] .req-sect')].map((s) => text(s.querySelector('.hint'))), ['Not yet.', 'Not yet.', 'Not yet.', 'Not yet.']);
});

test('brief page, made: a pencil opens the section in its text form; Save puts the text, Cancel closes; one editor at a time', async () => {
  const S = `${BRIEF_URL}/sections`;
  const { host, calls } = await openBrief(madeBody(), {
    [`PUT ${S}/users`]: madeBody({ brief: madeRow({ sections: { ...MADE_SECTIONS, users: [{ name: 'Buyer', can: 'buys.' }] } }) }),
    [`DELETE ${S}/users/edited`]: madeBody({ brief: madeRow({ edited: {} }) }) });
  const ed = () => host.querySelector('[data-ui="brief-edit-text"]');
  host.querySelector('[data-ui="brief-edit-users"]').click();
  assert.equal(ed().tagName, 'TEXTAREA');
  assert.equal(ed().getAttribute('aria-label'), 'Who uses it');
  assert.equal(ed().value, 'Shopper: browses, orders, pays.\nSupport agent: sees every order.');
  host.querySelector('[data-ui="brief-edit-areas"]').click();
  assert.equal(host.querySelectorAll('[data-ui="brief-edit-text"]').length, 1, 'one at a time');
  assert.equal(ed().closest('[data-section]').getAttribute('data-section'), 'areas');
  assert.equal(ed().value, 'Orders (partly): checkout, order history; no cancel action\nCatalog (exists): categories and product pages\nGift message on an order: The packing slip is printed from the order.');
  btn(host, 'Cancel').click();
  assert.equal(ed(), null);
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
  host.querySelector('[data-ui="brief-edit-product"]').click();
  assert.equal(ed().value, MADE_SECTIONS.product);
  btn(host, 'Cancel').click();
  host.querySelector('[data-ui="brief-edit-users"]').click();
  ed().value = 'Buyer: buys.';
  btn(host, 'Save').click();
  await tick(); await tick();
  assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { value: 'Buyer: buys.' });
  assert.equal(calls.find((c) => c.method === 'PUT').url, `${S}/users`);
  assert.equal(ed(), null, 'closed after the save');
  assert.equal(text(host.querySelector('[data-section="users"] li')), 'Buyer: buys.', 'painted from the answer');
  // Let Worca rewrite this
  host.querySelector('.req-rewrite').click();
  await tick(); await tick();
  assert.equal(calls.filter((c) => c.method === 'DELETE' && c.url === `${S}/users/edited`).length, 1);
  assert.equal(host.querySelector('.req-rewrite'), null);
  assert.equal(text(host.querySelector('[data-section="users"] h4')), 'Who uses it');
});

test('brief page, made: an open editor keeps its text, focus and caret over a live repaint; a refused save keeps it open', async () => {
  const S = `${BRIEF_URL}/sections`;
  const { host, view, msgEl } = await openBrief(madeBody(), { [`PUT ${S}/terms`]: { __status: 400, body: { error: 'at most 30 terms fit in the brief' } } });
  document.body.append(host);
  host.querySelector('[data-ui="brief-edit-terms"]').click();
  const ed = () => host.querySelector('[data-ui="brief-edit-text"]');
  assert.equal(document.activeElement, ed(), 'the editor takes the focus');
  ed().value = 'Packed: boxed.\nHalf typ';
  ed().setSelectionRange(3, 6);
  await view.changed(undefined, 'project:shop-1');
  assert.equal(ed().value, 'Packed: boxed.\nHalf typ');
  assert.equal(document.activeElement, ed());
  assert.deepEqual([ed().selectionStart, ed().selectionEnd], [3, 6]);
  btn(host, 'Save').click();
  await tick(); await tick(); await tick();
  assert.match(msgEl.textContent, /at most 30 terms/);
  assert.equal(ed().value, 'Packed: boxed.\nHalf typ', 'kept after a refusal');
  // leaving the page drops the editor
  await view.show('');
  await view.show('brief/project/shop-1');
  assert.equal(ed(), null);
  host.remove();
});

test('brief page: the notes keep their caret over a live repaint', async () => {
  const { host, view } = await openBrief(briefBody());
  document.body.append(host);
  const area = () => host.querySelector('[data-ui="notes-body"]');
  area().focus();
  area().value = 'Shoppers order things, often.';
  area().setSelectionRange(9, 14);
  await view.changed(undefined, 'project:shop-1');
  assert.equal(document.activeElement, area());
  assert.deepEqual([area().selectionStart, area().selectionEnd], [9, 14]);
  host.remove();
});

test('brief page, made: How Worca uses it, Your notes for Worca with Edit notes, What Worca read', async () => {
  const { host, routed, calls } = await openBrief(madeBody(), {
    'PUT /api/requirements/context/project/shop-1': { body: 'New notes', lookAtCode: true } });
  const side = host.querySelector('.req-brief-side');
  assert.ok(side, 'the right column');
  const how = side.querySelector('section[aria-label="How Worca uses it"]');
  assert.equal(how.querySelector('h3').textContent, 'How Worca uses it');
  assert.equal(text(how.querySelector('p')), 'Every interview round for shop reads it. New features no longer need their own look at the code; Look closer on a feature adds one when the brief is not enough.');
  assert.equal(how.querySelector('p b').textContent, 'Look closer');
  const used = how.querySelector('.req-brief-used');
  assert.equal(text(used), 'Used by FEAT-2, FEAT-3');
  const links = [...used.querySelectorAll('a')];
  assert.deepEqual(links.map((a) => a.getAttribute('href')), ['#requirements/feature/2', '#requirements/feature/3']);
  links[1].click();
  assert.deepEqual(routed, ['feature/3']);
  const notes = side.querySelector('details.req-brief-notes-read');
  assert.ok(notes.open, 'open');
  assert.equal(text(notes.querySelector('summary')), 'Your notes for Worca');
  assert.equal(text(notes.querySelector('p')), 'Shoppers order things.');
  assert.equal(host.querySelector('[data-ui="notes-body"]'), null, 'no editor until Edit notes');
  btn(host, 'Edit notes').click();
  const area = host.querySelector('.req-brief-side [data-ui="notes-body"]');
  assert.ok(area, "Task 7's editor, in place");
  assert.equal(area.value, 'Shoppers order things.');
  area.value = 'New notes';
  btn(host, 'Save notes').click();
  await tick(); await tick(); await tick();
  assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { body: 'New notes', lookAtCode: true });
  assert.equal(host.querySelector('[data-ui="notes-body"]'), null, 'back to the notes after a save');
  const read = host.querySelector('.req-brief-side details.req-brief-read');
  assert.equal(read.open, false, 'folded');
  assert.equal(text(read.querySelector('summary')), 'What Worca read 3 files');
  assert.deepEqual([...read.querySelectorAll('li')].map((x) => x.textContent), ['README.md', 'src/orders.mjs', 'src/slip.mjs']);
  // no users, no notes
  const e = await openBrief(madeBody({ usedBy: [], notes: { body: '', lookAtCode: true }, brief: madeRow({ files: ['README.md'] }) }));
  assert.equal(e.host.querySelector('.req-brief-used'), null);
  assert.equal(text(e.host.querySelector('details.req-brief-notes-read p')), 'No notes yet.');
  assert.equal(text(e.host.querySelector('details.req-brief-read summary')), 'What Worca read 1 file');
});

test('brief page, made: an open notes editor and the folds survive a live repaint', async () => {
  const { host, view } = await openBrief(madeBody());
  btn(host, 'Edit notes').click();
  host.querySelector('[data-ui="notes-body"]').value = 'Half typed';
  host.querySelector('details.req-brief-read').open = true;
  await view.changed(undefined, 'project:shop-1');
  assert.equal(host.querySelector('[data-ui="notes-body"]').value, 'Half typed');
  assert.equal(host.querySelector('details.req-brief-read').open, true);
  // Cancel goes back to the notes and drops what was typed
  btn(host, 'Cancel').click();
  assert.equal(host.querySelector('[data-ui="notes-body"]'), null);
  assert.equal(text(host.querySelector('details.req-brief-notes-read p')), 'Shoppers order things.');
  btn(host, 'Edit notes').click();
  assert.equal(host.querySelector('[data-ui="notes-body"]').value, 'Shoppers order things.');
});

test('brief page, made: Copy Markdown that fails says so and copies nothing', async () => {
  const { host, msgEl } = await openBrief(madeBody(), { [`GET ${BRIEF_URL}/markdown`]: { __status: 500, body: { error: 'down' } } });
  clip.length = 0;
  btn(host, 'Export').click();
  btn(host, 'Copy Markdown').click();
  await tick(); await tick();
  assert.deepEqual(clip, []);
  assert.equal(msgEl.textContent, 'Could not copy the Markdown (HTTP 500).');
  assert.ok(msgEl.className.includes('err'));
});

// ---- A7 Task 9: New feature with a brief (board 13); What Worca knows on the feature page (board 14); ⋯ ----

const usableBrief = (over = {}) => ({ scopeType: 'project', scopeKey: 'shop-1', status: 'ready', madeAt: new Date(Date.now() - 2 * DAY).toISOString(), lookAtCode: true, ...over });
const NEW_TARGETS = { 'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop' }, { key: 'blog', name: 'blog' }] }, 'GET /api/workspaces': { workspaces: [{ id: 'ws1', name: 'Storefront' }] } };
const forField = (host) => [...host.querySelectorAll('.req-new .field')][3];   // Title, Describe it, Files (A8), For

test('new feature: with a brief, the green line names it and links to it; the code-look cost is not shown; it follows the select', async () => {
  fakeApi({ ...NEW_TARGETS, 'GET /api/requirements': listOf([], { lookCostUsd: 0.25,
    briefs: [usableBrief(), usableBrief({ scopeType: 'workspace', scopeKey: 'ws1', lookAtCode: false, madeAt: new Date().toISOString() }),
      { scopeType: 'project', scopeKey: 'blog', status: 'making', madeAt: null }] }) });
  const { host, view, routed } = make();
  await view.show('new');
  const field = forField(host);
  const select = field.querySelector('select');
  const line = () => field.querySelector('.req-brief-line');
  const cost = () => host.querySelector('.req-new-cost');
  assert.equal(select.value, 'project:shop-1');
  assert.ok(line(), 'the green line');
  assert.equal(text(line()), 'Worca knows shop from its product brief (2 days old), so it starts asking right away. It looks closer at the code only if you ask.');
  assert.equal(line().querySelector('svg').getAttribute('aria-hidden'), 'true', 'the check is decorative');
  assert.equal(field.querySelector('.req-new-look'), null, "A2's look hint is gone");
  assert.ok(!cost() || cost().hidden, 'no code-look cost');
  const link = line().querySelector('a');
  assert.equal(link.textContent, 'product brief');
  assert.equal(link.getAttribute('href'), '#requirements/brief/project/shop-1');
  link.click();
  assert.deepEqual(routed, ['brief/project/shop-1']);
  // a project being briefed for the first time has no usable brief: A2's hint and the cost
  select.value = 'project:blog';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(line(), null);
  assert.match(text(field.querySelector('.req-new-look')), /looks at this project's code once/);
  assert.equal(cost().hidden, false);
  assert.equal(cost().textContent, 'About $0.25 for the code look, then cents per round.');
  // the workspace's brief, made today, with the switch off: no "looks closer" sentence
  select.value = 'workspace:ws1';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(text(line()), 'Worca knows Storefront from its product brief (made today), so it starts asking right away.');
  assert.equal(line().querySelector('a').getAttribute('href'), '#requirements/brief/workspace/ws1');
  assert.ok(cost().hidden);
  assert.doesNotMatch(host.textContent, /null|undefined/);
});

test('new feature: without a lookCost and with a brief nothing about the cost shows; a brief without madeAt is not usable', async () => {
  fakeApi({ ...NEW_TARGETS, 'GET /api/requirements': listOf([], { briefs: [{ scopeType: 'project', scopeKey: 'shop-1', status: 'empty', madeAt: null, lookAtCode: true }] }) });
  const { host, view } = make();
  await view.show('new');
  assert.equal(forField(host).querySelector('.req-brief-line'), null);
  assert.ok(forField(host).querySelector('.req-new-look'));
  assert.equal(host.querySelector('.req-new-cost'), null);
});

test('new feature with a brief (A1.1 merged): the model part stays; only the words after the dot become "cents per round"', async () => {
  const interview = { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'high' };
  fakeApi({ ...NEW_TARGETS, 'GET /api/requirements': listOf([], { lookCostUsd: 0.25, interview, briefs: [usableBrief()] }) });
  const { host, view } = make();
  await view.show('new');
  const select = forField(host).querySelector('select');
  const cost = () => host.querySelector('.req-new-cost');
  assert.equal(select.value, 'project:shop-1');
  assert.equal(cost().textContent, 'Worca interviews with Opus 5.5 at high effort · cents per round', 'board 13');
  assert.equal(cost().querySelector('.req-new-model').textContent, 'Worca interviews with Opus 5.5 at high effort');
  assert.equal(cost().hidden, false);
  select.value = 'project:blog';   // no usable brief: A1.1's line as is
  select.dispatchEvent(new window.Event('change'));
  assert.equal(cost().textContent, 'Worca interviews with Opus 5.5 at high effort · about $0.25 for the code look, then cents per round');
  select.value = 'project:shop-1';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(cost().textContent, 'Worca interviews with Opus 5.5 at high effort · cents per round');
  assert.equal(host.querySelectorAll('.req-new-cost').length, 1);
  assert.doesNotMatch(host.textContent, /null|undefined/);
});

const briefOf = (over = {}) => ({ id: 3, status: 'ready', madeAt: new Date(Date.now() - 2 * DAY).toISOString(), sources: [], matches: ['Orders', 'Packing', 'Packing slip'], matchesMore: 0, lookAtCode: true, ...over });
const SKIPPED = { summary: '', files: [], skipped: 'brief', briefMadeAt: '2026-10-20T10:00:00Z' };
const knowsFeature = (over = {}) => feature({ brief: briefOf(), lookCostUsd: 0.25, orientation: SKIPPED, ...over });
const knows = (host) => host.querySelector('.req-left > section.req-knows');
const openKnows = async (f, turns = [], extra = {}) => {
  let cur = { feature: f, turns };
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/4': () => cur, ...extra });
  const m = make();
  await m.view.show('feature/4');
  return { ...m, calls, set: (nf, nt = turns) => { cur = { feature: nf, turns: nt }; } };
};

test('What Worca knows, before a closer look: from the brief, the matches, the hint and Look closer with its price', async () => {
  const { host, calls, routed } = await openKnows(knowsFeature(), [], { 'POST /api/requirements/4/look': { feature: knowsFeature(), turns: [] } });
  const card = knows(host);
  assert.ok(card, 'the card');
  assert.ok(card.classList.contains('card'));
  assert.equal(card.getAttribute('aria-label'), 'What Worca knows');
  assert.equal(host.querySelector('details.req-orient'), null, "A2's folded box is replaced");
  assert.equal(card.querySelector('h3').textContent, 'What Worca knows');
  const meta = card.querySelector('.req-knows-meta');
  assert.equal(text(meta), 'from the product brief · 2 days old');
  assert.equal(meta.querySelector('a').getAttribute('href'), '#requirements/brief/project/shop-1');
  meta.querySelector('a').click();
  assert.deepEqual(routed, ['brief/project/shop-1']);
  assert.equal(text(card.querySelector('.req-knows-text')), 'Worca works from the shop brief: Orders, Packing and Packing slip are described there. It has not looked at the code for this feature.');
  assert.equal(text(card.querySelector('.req-knows-foot .hint')), 'Worth it when the feature touches something the brief only skims.');
  const go = card.querySelector('[data-ui="look-closer"]');
  assert.equal(go.textContent, 'Look closer · about $0.25');
  assert.ok(go.classList.contains('btn') && go.classList.contains('btn-sm'));
  assert.equal(go.disabled, false);
  assert.equal(card.querySelector('.req-knows-failed'), null);
  go.click();
  await tick(); await tick();
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url === '/api/requirements/4/look').length, 1);
  assert.doesNotMatch(host.textContent, /null|undefined/);
});

test('What Worca knows, before: one match, no match, no price, made today, a failed closer look, the switch off, locked', async () => {
  const say = async (over) => text(knows((await openKnows(knowsFeature(over))).host).querySelector('.req-knows-text'));
  assert.equal(await say({ brief: briefOf({ matches: ['Orders'] }) }), 'Worca works from the shop brief: Orders is described there. It has not looked at the code for this feature.');
  assert.equal(await say({ brief: briefOf({ matchesMore: 2 }) }), 'Worca works from the shop brief: Orders, Packing, Packing slip and 2 more are described there. It has not looked at the code for this feature.');
  assert.equal(await say({ brief: briefOf({ matches: ['Orders', 'Refund'], matchesMore: undefined }) }), 'Worca works from the shop brief: Orders and Refund are described there. It has not looked at the code for this feature.');
  assert.equal(await say({ brief: briefOf({ matches: [], matchesMore: 0 }) }), 'Worca works from the shop brief. It has not looked at the code for this feature.');
  const today = await openKnows(knowsFeature({ brief: briefOf({ madeAt: new Date().toISOString() }), lookCostUsd: null }));
  assert.equal(text(knows(today.host).querySelector('.req-knows-meta')), 'from the product brief · made today');
  assert.equal(knows(today.host).querySelector('[data-ui="look-closer"]').textContent, 'Look closer', 'no price without an estimate');
  // a closer look that failed: the card stays as before and says so
  const failed = await openKnows(knowsFeature({ orientation: { summary: '', files: [], skipped: 'failed' } }));
  assert.equal(text(knows(failed.host).querySelector('.req-knows-failed')), 'Worca could not look at the code this time.');
  assert.ok(knows(failed.host).querySelector('[data-ui="look-closer"]'));
  // the switch off: no Look closer, no hint about it
  const off = await openKnows(knowsFeature({ brief: briefOf({ lookAtCode: false }) }));
  assert.equal(knows(off.host).querySelector('[data-ui="look-closer"]'), null);
  assert.equal(knows(off.host).querySelector('.req-knows-foot'), null);
  // busy and archived: disabled
  for (const over of [{ busy: true, status: 'thinking', state: 'thinking', pending: null }, { status: 'archived', state: 'archived', pending: null }]) {
    const l = await openKnows(knowsFeature(over));
    assert.equal(knows(l.host).querySelector('[data-ui="look-closer"]').disabled, true, over.status);
  }
});

test('What Worca knows, after a closer look: brief + a closer look, the summary, Add this to the brief until added, Look again', async () => {
  const LOOKED = { summary: 'The packing slip is printed from the order with its prices.', files: ['src/slip.mjs', 'src/order.mjs'], skipped: null, area: 'Orders',
    scopeType: 'project', scopeKey: 'shop-1', briefId: 3 };
  const turns = [{ id: 2, kind: 'orientation', costUsd: 0, payload: SKIPPED }, { id: 7, kind: 'orientation', costUsd: 0.22, payload: { ...LOOKED } }];
  // a look made for another scope, before any brief, or against an earlier brief: no Add (the server refuses it too)
  for (const stale of [{ scopeKey: 'other-2' }, { scopeType: 'workspace' }, { briefId: null }, { briefId: 2 }, { scopeType: undefined, scopeKey: undefined, briefId: undefined }]) {
    const x = await openKnows(knowsFeature({ orientation: { ...LOOKED, ...stale } }), turns);
    assert.equal(knows(x.host).querySelector('[data-ui="brief-add"]'), null, JSON.stringify(stale));
    assert.doesNotMatch(text(knows(x.host)), /Not in the brief yet/);
    assert.equal(text(knows(x.host).querySelector('.req-knows-text')), LOOKED.summary, 'the summary still shows');
  }
  const { host, calls, set, view } = await openKnows(knowsFeature({ orientation: LOOKED }), turns, {
    'POST /api/requirements/4/brief-addition': () => { set(knowsFeature({ orientation: { ...LOOKED, addedToBrief: '2026-10-22T10:00:00Z' } })); return { feature: knowsFeature(), turns }; },
    'POST /api/requirements/4/look': { feature: knowsFeature(), turns } });
  const card = knows(host);
  assert.equal(text(card.querySelector('.req-knows-meta')), 'brief + a closer look · 2 files · $0.22');
  assert.equal(text(card.querySelector('.req-knows-text')), LOOKED.summary);
  const add = card.querySelector('[data-ui="brief-add"]');
  assert.equal(text(add.parentElement), 'Not in the brief yet. Add this to the brief');
  assert.ok(add.classList.contains('link-btn'));
  assert.equal(card.querySelector('[data-ui="look-closer"]'), null);
  const again = card.querySelector('[data-ui="look-again"]');
  assert.equal(again.textContent, 'Look again');
  add.click();
  await tick(); await tick();
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url === '/api/requirements/4/brief-addition').length, 1);
  assert.equal(knows(host).querySelector('[data-ui="brief-add"]'), null, 'gone once added');
  assert.doesNotMatch(text(knows(host)), /Not in the brief yet/);
  knows(host).querySelector('[data-ui="look-again"]').click();
  await tick(); await tick();
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url === '/api/requirements/4/look').length, 1);
  // the switch off hides Look again; a look that found nothing offers nothing to add
  set(knowsFeature({ brief: briefOf({ lookAtCode: false }), orientation: { summary: '', files: [], skipped: null } }));
  await view.changed(4);
  assert.equal(knows(host).querySelector('[data-ui="look-again"]'), null);
  assert.equal(knows(host).querySelector('[data-ui="brief-add"]'), null);
  assert.equal(text(knows(host).querySelector('.req-knows-meta')), 'brief + a closer look · $0.22', 'no files, no file count');
  // locked: both disabled
  const l = await openKnows(knowsFeature({ orientation: LOOKED, busy: true, status: 'thinking', state: 'thinking', pending: null }), turns);
  assert.equal(knows(l.host).querySelector('[data-ui="brief-add"]').disabled, true);
  assert.equal(knows(l.host).querySelector('[data-ui="look-again"]').disabled, true);
});

test("A2's box without a brief: skipped for a brief reads it has not looked, with Look again; the switch-off text names Your notes for Worca", async () => {
  const s = await openKnows(feature({ brief: null, orientation: SKIPPED }), [{ id: 2, kind: 'orientation', costUsd: 0, payload: SKIPPED }],
    { 'POST /api/requirements/4/look': { feature: feature(), turns: [] } });
  const box = s.host.querySelector('.req-left > details.req-orient');
  assert.ok(box, "A2's box");
  assert.equal(knows(s.host), null);
  assert.equal(box.querySelector('p').textContent, 'Worca has not looked at the code for this feature.');
  assert.equal(box.querySelector('.req-orient-meta'), null);
  const again = box.querySelector('[data-ui="orient-look-again"]');
  assert.equal(again.textContent, 'Look again');
  again.click();
  await tick(); await tick();
  assert.equal(s.calls.filter((c) => c.method === 'POST' && c.url === '/api/requirements/4/look').length, 1);
  const off = await openKnows(feature({ orientation: { summary: '', files: [], skipped: 'off' } }));
  assert.equal(off.host.querySelector('details.req-orient p').textContent, 'Looking at the code is turned off for this one (Your notes for Worca).');
  assert.equal(off.host.querySelector('[data-ui="orient-look-again"]'), null, 'only for the brief-skipped look');
  const plain = await openKnows(feature());
  assert.equal(plain.host.querySelector('details.req-orient p').textContent, 'Orders have a status.', 'unchanged otherwise');
  assert.doesNotMatch(plain.host.textContent, /Project context|Workspace context/);
});

test('⋯ with a brief: Look closer while the look was skipped for the brief, Look again after; hidden with the switch off; Your notes for Worca routes', async () => {
  const labels = (host) => { host.querySelector('[data-ui="menu-more"]').click(); return [...host.querySelectorAll('[data-menu="more"] [role="menuitem"]')].map((x) => x.textContent); };
  const a = await openKnows(knowsFeature(), [], { 'POST /api/requirements/4/look': { feature: knowsFeature(), turns: [] } });
  assert.deepEqual(labels(a.host), ['Your notes for Worca', 'Look closer', 'Archive']);
  a.host.querySelector('[data-ui="mi-look"]').click();
  await tick(); await tick();
  assert.equal(a.calls.filter((c) => c.method === 'POST' && c.url === '/api/requirements/4/look').length, 1);
  const b = await openKnows(knowsFeature({ orientation: { summary: 'x', files: [], skipped: null } }));
  assert.deepEqual(labels(b.host), ['Your notes for Worca', 'Look again', 'Archive']);
  const c = await openKnows(knowsFeature({ brief: briefOf({ lookAtCode: false }) }));
  assert.deepEqual(labels(c.host), ['Your notes for Worca', 'Archive']);
  // without a brief, a look skipped for a (since deleted) brief is looked at again
  const d = await openKnows(feature({ orientation: SKIPPED }));
  assert.deepEqual(labels(d.host), ['Your notes for Worca', 'Look again', 'Archive']);
  // with a brief the entry says what the card says: Look closer until a closer look has been made
  for (const orientation of [null, { summary: '', files: [], skipped: 'failed' }, { summary: '', files: [], skipped: 'no-repo' }, { summary: '', files: [], skipped: 'off' }]) {
    const e = await openKnows(knowsFeature({ orientation }));
    assert.deepEqual(labels(e.host), ['Your notes for Worca', 'Look closer', 'Archive'], JSON.stringify(orientation));
    assert.ok(knows(e.host).querySelector('[data-ui="look-closer"]'), 'and the card offers Look closer');
  }
  const w = await openKnows(knowsFeature({ scopeType: 'workspace', scopeKey: 'ws:1' }));
  w.host.querySelector('[data-ui="menu-more"]').click();
  w.host.querySelector('[data-ui="mi-notes"]').click();
  assert.deepEqual(w.routed, ['brief/workspace/ws%3A1']);
});
// Upstream's first-paint git gate (ui/public/git-gate.mjs, test/ui-git-hide-set.test.mjs): every control that checks out
// the code carries data-needs-git, which style.css hides while <html data-git="off">; the rest of the page stays.
test('git-only controls carry data-needs-git: the brief Create box and Refresh, Look closer and Look again; nothing else', async () => {
  const gated = (el) => !!el && !!el.closest('[data-needs-git]');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /:root\[data-git="off"\] \[data-needs-git\]\{display:none !important;\}/, 'the gate rule exists');
  const none = await openBrief(briefBody());
  assert.ok(gated(createBtn(none.host)), 'Create the brief');
  assert.ok(none.host.querySelector('.req-brief-cost').hasAttribute('data-needs-git'), "the look's box (facts, estimate, Create)");
  assert.ok(!gated(none.host.querySelector('.req-brief-why')), 'the explanation stays');
  const made = await openBrief(madeBody());
  assert.ok(gated(made.host.querySelector('[data-ui="brief-refresh"]')), 'the notice Refresh');
  made.host.querySelector('[data-ui="brief-more"]').click();
  assert.ok(gated(made.host.querySelector('[data-ui="mi-brief-refresh"]')), 'the ⋯ Refresh the brief');
  for (const k of ['mi-brief-delete', 'brief-export', 'mi-brief-copy']) assert.ok(!gated(made.host.querySelector(`[data-ui="${k}"]`)), `${k} stays`);
  const failed = await openBrief(madeBody({ brief: madeRow({ error: { message: 'no time' } }) }));
  assert.ok(gated(failed.host.querySelector('[data-ui="brief-refresh-again"]')), 'the failed refresh line Refresh');
  const before = await openKnows(knowsFeature());
  assert.ok(gated(knows(before.host).querySelector('[data-ui="look-closer"]')), 'Look closer');
  assert.ok(gated(knows(before.host).querySelector('.req-knows-foot .hint')), 'and its hint');
  assert.ok(!gated(knows(before.host).querySelector('.req-knows-text')), 'what Worca knows stays');
  before.host.querySelector('[data-ui="menu-more"]').click();
  assert.ok(gated(before.host.querySelector('[data-ui="mi-look"]')), 'the ⋯ Look closer');
  for (const k of ['mi-notes', 'mi-archive']) assert.ok(!gated(before.host.querySelector(`[data-ui="${k}"]`)), `${k} stays`);
  const LOOKED = { summary: 'The slip.', files: ['src/slip.mjs'], skipped: null, area: 'Orders', scopeType: 'project', scopeKey: 'shop-1', briefId: 3 };
  const after = await openKnows(knowsFeature({ orientation: LOOKED }), [{ id: 7, kind: 'orientation', costUsd: 0.22, payload: { ...LOOKED } }]);
  assert.ok(gated(knows(after.host).querySelector('[data-ui="look-again"]')), 'Look again');
  assert.ok(!gated(knows(after.host).querySelector('[data-ui="brief-add"]')), 'Add this to the brief stays (no git)');
  const skipped = await openKnows(feature({ brief: null, orientation: SKIPPED }), [{ id: 2, kind: 'orientation', costUsd: 0, payload: SKIPPED }]);
  assert.ok(gated(skipped.host.querySelector('[data-ui="orient-look-again"]')), "A2's box Look again");
});

// ---- the final review's fixes: UI levels, git missing, messages and focus ----

const withGit = async (on, fn) => {
  const el = document.documentElement;
  const was = el.dataset.git;
  el.dataset.git = on ? 'on' : 'off';
  try { return await fn(); } finally { if (was === undefined) delete el.dataset.git; else el.dataset.git = was; }
};

test('UI levels (docs/ui-levels.md): Ready to build Change and the brief page What Worca read are Advanced; the chips and the rest stay', async () => {
  fakeApi({ ...BASE, ...BUILD, 'GET /api/requirements/4': () => ({ feature: readyFeature(), turns: [] }) });
  const { host, view } = make();
  await view.show('feature/4');
  const card = host.querySelector('.req-build');
  assert.equal(card.querySelector('[data-ui="build-change"]').getAttribute('data-min-level'), 'advanced');
  for (const el of [card, card.querySelector('.req-build-chips'), card.querySelector('[data-ui="start-go"]')]) {
    assert.equal(el.closest('[data-min-level]'), null, 'the card, its chips and Start show at every level');
  }
  const made = await openBrief(madeBody());
  assert.equal(made.host.querySelector('details.req-brief-read').getAttribute('data-min-level'), 'advanced');
  assert.equal(made.host.querySelector('.req-brief-how').closest('[data-min-level]'), null);
});

test('Start in Worca is capitalised on both buttons', async () => {
  fakeApi({ ...BASE, ...BUILD, 'GET /api/requirements/4': () => ({ feature: readyFeature(), turns: [] }) });
  const { host, view } = make();
  await view.show('feature/4');
  assert.equal(text(host.querySelector('[data-ui="start-go"]')), 'Start in Worca');
});

test('the notes card has no former name, and its text area stops at 10000 characters', async () => {
  const { host } = await openBrief(briefBody());
  assert.equal(host.querySelector('.req-brief-was'), null);
  assert.doesNotMatch(host.textContent, /Project context|Workspace context/);
  assert.equal(host.querySelector('[data-ui="notes-body"]').getAttribute('maxlength'), '10000');
});

test('git missing: the made brief says it cannot check against the code, quietly', async () => {
  await withGit(false, async () => {
    const { host, view } = await openBrief(madeBody({ staleness: { known: false, reason: 'no-git' } }));
    assert.equal(notice(host), null, 'no amber notice');
    const note = host.querySelector('.req-brief-nogit');
    assert.ok(note, 'a quiet note');
    assert.equal(note.getAttribute('role'), 'note');
    assert.equal(text(note), 'Worca cannot check this brief against the code: git is not installed on this machine.');
    view.destroy();
  });
});

test('git missing: the list header offers Create only with git; the empty brief page says why there is no Create', async () => {
  fakeApi({ ...BASE, 'GET /api/requirements': listOf([row()]) });
  const m = make();
  await m.view.show('');
  const head = m.host.querySelector('.req-group-brief');
  assert.equal(text(head), 'Product brief: none yet · Create');
  const create = head.querySelector('a');
  assert.ok(create.closest('[data-needs-git]'), 'the " · Create" part hides while git is missing');
  assert.equal(create.getAttribute('aria-label'), 'Create the product brief for shop');
  const none = await openBrief(briefBody());
  const why = none.host.querySelector('.req-brief-nogit-create');
  assert.equal(text(why), 'A brief needs git to read the code, and git is not installed on this machine.');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /:root:not\(\[data-git="off"\]\) \.req-brief-nogit-create\{display:none\}/);
});

test('git missing: New feature says there is no look and costs cents per round; the feature says why it did not look', async () => {
  await withGit(false, async () => {
    fakeApi({ ...BASE, 'GET /api/requirements': listOf([], { lookCostUsd: 0.25, interview: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } }) });
    const { host, view } = make();
    await view.show('new');
    assert.equal(text(host.querySelector('.req-new-look')), 'Worca does not look at the code: git is not installed on this machine. It starts asking right away.');
    assert.equal(text(host.querySelector('.req-new-cost')), 'Worca interviews with Opus 5.5 at medium effort · cents per round');
    view.destroy();
    const f = await openKnows(feature({ orientation: { summary: '', files: [], skipped: 'no-git' } }));
    assert.equal(f.host.querySelector('details.req-orient p').textContent, 'Worca did not look at the code: git is not installed on this machine.');
  });
  // with git, a feature whose look was skipped for git says so too, after git came back
  const back = await openKnows(feature({ orientation: { summary: '', files: [], skipped: 'no-git' } }));
  assert.equal(back.host.querySelector('details.req-orient p').textContent, 'Worca did not look at the code: git is not installed on this machine.');
});

test('Add this to the brief: says so in the message line and keeps the focus on the card', async () => {
  const LOOKED = { summary: 'The slip.', files: ['src/slip.mjs'], skipped: null, area: 'Orders', scopeType: 'project', scopeKey: 'shop-1', briefId: 3 };
  const turns = [{ id: 7, kind: 'orientation', costUsd: 0.22, payload: { ...LOOKED } }];
  const a = await openKnows(knowsFeature({ orientation: LOOKED }), turns, {
    'POST /api/requirements/4/brief-addition': () => { a.set(knowsFeature({ orientation: { ...LOOKED, addedToBrief: '2026-10-22T10:00:00Z' } })); return {}; } });
  document.body.append(a.host);
  try {
    a.host.querySelector('[data-ui="brief-add"]').click();
    await tick(); await tick(); await tick();
    assert.equal(a.msgEl.textContent, 'Added to the product brief as “Orders: Cancel order”.');
    assert.ok(a.msgEl.classList.contains('ok'));
    assert.equal(document.activeElement.getAttribute('data-ui'), 'look-again');
  } finally { a.host.remove(); }
  // the switch off: no Look again, so the focus stays on the card
  const OFF = briefOf({ lookAtCode: false });
  const off = await openKnows(knowsFeature({ brief: OFF, orientation: LOOKED }), turns, {
    'POST /api/requirements/4/brief-addition': () => { off.set(knowsFeature({ brief: OFF, orientation: { ...LOOKED, addedToBrief: 'x' } })); return {}; } });
  document.body.append(off.host);
  try {
    off.host.querySelector('[data-ui="brief-add"]').click();
    await tick(); await tick(); await tick();
    assert.equal(document.activeElement.getAttribute('data-ui'), 'knows');
  } finally { off.host.remove(); }
});

test('Create the brief and Delete the brief say what happened; Delete leaves the focus on Create', async () => {
  let body = briefBody();
  const c = await openBrief(() => body, {
    [`POST ${BRIEF_URL}`]: () => { body = briefBody({ brief: briefRow({ status: 'making' }) }); return body; } });
  createBtn(c.host).click();
  await tick(); await tick();
  assert.equal(c.msgEl.textContent, 'Worca is making the brief. This takes a few minutes; you can leave this page.');
  let made = madeBody();
  const d = await openBrief(() => made, { [`DELETE ${BRIEF_URL}`]: () => { made = briefBody(); return made; } });
  document.body.append(d.host);
  try {
    d.host.querySelector('[data-ui="brief-more"]').click();
    await withConfirm(true, async () => { d.host.querySelector('[data-ui="mi-brief-delete"]').click(); await tick(); await tick(); });
    assert.equal(d.msgEl.textContent, 'The brief is deleted.');
    assert.equal(document.activeElement.getAttribute('data-ui'), 'brief-create');
  } finally { d.host.remove(); }
});

test('a staleness that cannot be told heads the notice "Worca cannot check this brief against the code"', async () => {
  const { host } = await openBrief(madeBody({ staleness: { known: false, reason: 'slow' } }));
  assert.equal(notice(host).querySelector('b').textContent, 'Worca cannot check this brief against the code');
});

test('style: the phone menus open inside the screen, the faint ink is not used for text, the small-screen wraps', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.req-head-tools\{[^}]*margin-left:auto/);
  for (const sel of ['.req-group-head .req-group-brief', '.req-id', '.req-round-n', '.req-del']) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rules = [...css.matchAll(new RegExp(`(?:^|[}\\s,])${esc}\\{([^}]*)\\}`, 'gm'))];
    assert.ok(rules.length, sel);
    for (const m of rules) assert.doesNotMatch(m[1], /--ink-3/, `${sel} text uses --ink-2`);
  }
  assert.match(css, /@media \(max-width:600px\)\{\.req-check\{flex-wrap:wrap\}/);
  assert.match(css, /\.req-brief-notes-look\{[^}]*align-items:flex-start/);
});

test('git appears or goes missing: New feature says its look line again and keeps the typed title; the brief page refetches', async () => {
  const { applyGit } = await import('../ui/public/git-gate.mjs');
  await withGit(true, async () => {
    fakeApi({ ...BASE, 'GET /api/requirements': listOf([], { lookCostUsd: 0.25 }) });
    const { host, view } = make();
    await view.show('new');
    host.querySelector('#req-new-title').value = 'Typed';
    applyGit({ available: false });
    assert.match(text(host.querySelector('.req-new-look')), /^Worca does not look at the code/);
    assert.equal(host.querySelector('#req-new-title').value, 'Typed', 'the form is not rebuilt');
    applyGit({ available: true });
    assert.match(text(host.querySelector('.req-new-look')), /^Worca looks at this project's code once/);
    view.destroy();
    // a scope of its own: views of earlier tests still show other pages
    const URL = '/api/requirements/brief/project/flip-9';
    const calls = fakeApi({ ...BASE, [`GET ${URL}`]: () => madeBody() });
    const b = make();
    await b.view.show('brief/project/flip-9');
    const gets = () => calls.filter((c) => c.url === URL).length;
    applyGit({ available: false });
    await tick(); await tick();
    assert.equal(gets(), 2, 'refetched on the flip');
    b.view.destroy();
    applyGit({ available: true });
    await tick();
    assert.equal(gets(), 2, 'destroy unsubscribes');
  });
});

// Upstream's one menu (style.css .menu / .menu-item, test/ui-shared-controls.test.mjs): every Export ▾ and ⋯ list is a
// .menu box and every row a .menu-item, on the feature page and on the brief page.
test('one menu: the Export and ⋯ lists are .menu boxes with .menu-item rows', async () => {
  const f = await openKnows(knowsFeature());
  const b = await openBrief(madeBody());
  const lists = [...f.host.querySelectorAll('[role="menu"]'), ...b.host.querySelectorAll('[role="menu"]')];
  assert.equal(lists.length, 4);
  for (const m of lists) {
    assert.ok(m.classList.contains('menu') && m.classList.contains('hd-menu'), m.parentElement.getAttribute('data-menu'));
    for (const it of m.querySelectorAll('[role="menuitem"]')) assert.ok(it.classList.contains('menu-item'), it.textContent);
  }
});

test('the notes switch is the shared switch (role=switch), with its label', async () => {
  const { host } = await openBrief(briefBody());
  const sw = host.querySelector('[data-ui="notes-look"]');
  assert.equal(sw.getAttribute('role'), 'switch');
  assert.ok(sw.classList.contains('sw-input'));
  assert.ok(sw.closest('label').classList.contains('switch-row'));
  assert.equal(text(sw.closest('label')), 'Let Worca look at the code (for the brief, and when you ask it to look closer at a feature)');
});

test('Add this to the brief without git: Look again is hidden, so the focus goes to the card', async () => {
  const LOOKED = { summary: 'The slip.', files: ['src/slip.mjs'], skipped: null, area: 'Orders', scopeType: 'project', scopeKey: 'shop-1', briefId: 3 };
  const turns = [{ id: 7, kind: 'orientation', costUsd: 0.22, payload: { ...LOOKED } }];
  await withGit(false, async () => {
    const a = await openKnows(knowsFeature({ orientation: LOOKED }), turns, {
      'POST /api/requirements/4/brief-addition': () => { a.set(knowsFeature({ orientation: { ...LOOKED, addedToBrief: 'x' } })); return {}; } });
    document.body.append(a.host);
    try {
      a.host.querySelector('[data-ui="brief-add"]').click();
      await tick(); await tick(); await tick();
      assert.equal(document.activeElement.getAttribute('data-ui'), 'knows');
    } finally { a.host.remove(); a.view.destroy(); }
  });
});
