// test/requirements-view.test.mjs — the Requirements page module in jsdom with a fake API (design §6).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

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

test('list: Show archived refetches with archived=1 and shows the Archived badge', async () => {
  const calls = fakeApi({
    'GET /api/requirements': { features: [feature()] },
    'GET /api/requirements?archived=1': { features: [feature(), feature({ seq: 6, id: 'FEAT-6', status: 'archived', pending: null })] },
    'GET /api/projects': { projects: [] }, 'GET /api/workspaces': { workspaces: [] },
  });
  const { host, view } = make();
  await view.show('');
  assert.equal(host.querySelector('.req-archived-toggle').getAttribute('aria-pressed'), 'false');
  host.querySelector('.req-archived-toggle').click(); await tick(); await tick();
  assert.ok(calls.some((c) => c.url === '/api/requirements?archived=1'));
  assert.equal(host.querySelector('.req-archived-toggle').getAttribute('aria-pressed'), 'true');
  assert.deepEqual([...host.querySelectorAll('.req-row .badge')].map((b) => b.textContent), ['Your turn', 'Archived']);
  host.querySelector('.req-archived-toggle').click(); await tick(); await tick();
  assert.equal(host.querySelectorAll('.req-row').length, 1);
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
