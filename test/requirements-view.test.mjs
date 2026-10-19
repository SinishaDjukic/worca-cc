// test/requirements-view.test.mjs — the Requirements page module in jsdom with a fake API (design §6).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#requirements' });
for (const k of ['document', 'location', 'Event', 'HTMLElement']) Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
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
    const body = typeof hit === 'function' ? hit() : hit;
    return { ok: body !== undefined, status: body !== undefined ? 200 : 404, json: async () => body ?? { error: 'not found' }, text: async () => '# md' };
  };
  return calls;
}
const make = () => {
  const host = document.createElement('div'); const msgEl = document.createElement('p'); const subEl = document.createElement('div');
  const routed = [];
  const view = createRequirementsView({ host, subEl, msgEl, deps: { route: (p) => routed.push(p) } });
  return { host, msgEl, view, routed };
};

test('list: grouped by project, FEAT id, state badge, cost; a row routes to the feature', async () => {
  fakeApi({
    'GET /api/requirements': { features: [feature({ seq: 5, id: 'FEAT-5', title: 'Refunds', status: 'done' }), feature()] },
    'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop' }] },
    'GET /api/workspaces': { workspaces: [] },
  });
  const { host, view, routed } = make();
  await view.show('');
  assert.equal(host.querySelector('.req-group h3').textContent, 'Project · shop');
  const rows = [...host.querySelectorAll('.req-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.req-id').textContent), ['FEAT-5', 'FEAT-4']);
  assert.equal(rows[1].querySelector('.badge').textContent, 'Your turn');
  assert.ok(rows[1].querySelector('.badge').classList.contains('amber'));
  rows[1].click();
  assert.deepEqual(routed, ['feature/4']);
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
