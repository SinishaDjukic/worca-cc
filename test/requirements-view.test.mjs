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
const feature = (over = {}) => ({
  seq: 4, id: 'FEAT-4', scopeType: 'project', scopeKey: 'shop-1', title: 'Cancel order', status: 'your_turn', rounds: 1, costUsd: 0.42, busy: false,
  orientation: { summary: 'Orders have a status.', files: ['src/o.js'], skipped: null },
  spec: { goal: { text: 'Cancel', measure: '' }, actors: ['Customer'], flow: [], edgeCases: [], rules: [], outOfScope: [],
    criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }], assumptions: [{ id: 'A-1', text: 'Full refund', status: 'open' }],
    openQuestions: [], edited: { actors: true } },
  pending: { turnId: 9, questions: Q, note: 'One question.' }, lastError: null, ...over,
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
    row({ seq: 10, state: 'your_turn', rounds: 1, pendingCount: 1 })]) });
  const { host, view } = make();
  await view.show('');
  const meta = (seq) => rowOf(host, seq).querySelector('.req-row-meta').textContent;
  const mark = (seq) => rowOf(host, seq).querySelector('.badge, .pill-run');
  assert.equal(meta(1), 'Round 2 of 6 · Your turn');
  assert.equal(meta(2), 'Round 1 of 6 · 3 questions for you');
  assert.equal(meta(10), 'Round 1 of 6 · 1 question for you');
  assert.equal(meta(3), 'Interview done · Ready 4 of 6');
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
  assert.ok([...host.querySelectorAll('.req-sect-edit')].every((b) => b.disabled));
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
  host.querySelector('[data-section="actors"] .req-sect-edit').click();
  await tick();
  host.querySelector('[data-section="actors"] .req-edit textarea').value = 'Customer\nSupport';
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
  const d = host.querySelector('.req-context');
  d.open = true; d.dispatchEvent(new window.Event('toggle'));
  await tick(); await tick();
  assert.equal(host.querySelector('.req-context textarea').value, 'Standing rules');
  host.querySelector('.req-context textarea').value = 'New rules';
  await view.changed(4);
  await tick(); await tick();
  assert.ok(host.querySelector('.req-context').open);
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
  assert.deepEqual(btns.map((b) => b.getAttribute('aria-label')), ['Edit Actors', 'Let Worca rewrite Actors']);
  assert.equal(host.querySelector('.req-confirm').getAttribute('aria-label'), 'Confirm A-1');
  assert.equal(host.querySelector('.req-reject').getAttribute('aria-label'), 'Reject A-1');
});

test('context: a failed load keeps Save context disabled and sends no PUT', async () => {
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/context/project/shop-1': { __status: 500, body: { error: 'ctx down' } } });
  const { host, msgEl, view } = make();
  await view.show('feature/4');
  const d = host.querySelector('.req-context');
  d.open = true; d.dispatchEvent(new window.Event('toggle'));
  await tick(); await tick();
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

test('earlier rounds: folded, read-only, with their questions, the latest answers and the note; the pending one is not repeated', async () => {
  const turns = [
    { id: 2, kind: 'orientation', payload: {} },
    { id: 3, kind: 'round', payload: { questions: [{ id: 'who', question: 'Who may cancel?', options: ['Customers', 'Support'], recommended: 'Customers' }], note: 'Start <b>here</b>.' } },
    { id: 4, kind: 'answers', payload: { roundTurnId: 3, answers: [{ id: 'who', question: 'Who may cancel?', answer: 'Customers' }] } },
    { id: 5, kind: 'answers', payload: { roundTurnId: 3, revises: true, answers: [{ id: 'who', question: 'Who may cancel?', answer: 'Support' }] } },
    { id: 9, kind: 'round', payload: { questions: Q, note: 'One question.' } },
  ];
  fakeApi({
    'GET /api/requirements/4': { feature: feature({ rounds: 2 }), turns },
    'GET /api/projects': { projects: [] }, 'GET /api/workspaces': { workspaces: [] },
  });
  const { host, view } = make();
  await view.show('feature/4');
  const rounds = [...host.querySelectorAll('details.req-round')];
  assert.equal(rounds.length, 1, 'only the earlier round; the pending one is the question card');
  const r = rounds[0];
  assert.equal(r.open, false, 'folded');
  assert.match(r.querySelector('summary').textContent, /Round 1/);
  assert.match(r.textContent, /Who may cancel\?/);
  assert.match(r.textContent, /Support/, 'the latest answer');
  assert.doesNotMatch(r.querySelector('.req-round-answer').textContent, /Customers/, 'a superseded answer is not shown');
  assert.equal(r.querySelector('.req-round-note').textContent, 'Start <b>here</b>.', 'the note, as text');
  assert.equal(r.querySelectorAll('button, input, textarea').length, 0, 'read-only');
  // the open state survives a live repaint
  r.open = true;
  await view.changed(4);
  assert.equal(host.querySelector('details.req-round').open, true);
});

test('earlier rounds: a done interview lists every round, the last one with no questions shows its note', async () => {
  const turns = [
    { id: 3, kind: 'round', payload: { questions: Q, note: 'One question.' } },
    { id: 4, kind: 'answers', payload: { roundTurnId: 3, answers: [{ id: 'who', question: 'Who may cancel?', answer: 'Customers' }] } },
    { id: 6, kind: 'round', payload: { questions: [], note: 'The spec is complete.', done: true } },
  ];
  fakeApi({
    'GET /api/requirements/4': { feature: feature({ status: 'done', pending: null, rounds: 2 }), turns },
    'GET /api/projects': { projects: [] }, 'GET /api/workspaces': { workspaces: [] },
  });
  const { host, view } = make();
  await view.show('feature/4');
  const rounds = [...host.querySelectorAll('details.req-round')];
  assert.deepEqual(rounds.map((d) => d.querySelector('summary').textContent.match(/Round \d/)[0]), ['Round 1', 'Round 2']);
  assert.equal(rounds[1].querySelector('.req-round-note').textContent, 'The spec is complete.');
  assert.equal(rounds[1].querySelectorAll('.req-round-q').length, 0);
});
