// test/feature-pull-flow.test.mjs — the pick → confirm → overlay → start flow, in jsdom with a fake modal and fetchJson.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/' });
for (const k of ['document', 'window', 'Event']) Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
after(() => window.close());
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const { startFromFeature, ARCHIVED_TEXT, REASON_MAX, NOT_STARTABLE_TEXT } = await import('../ui/public/feature-pull/run-flow.mjs');
const { RUN_IN_PROGRESS_TEXT } = await import('../ui/public/run-setup-overlay.mjs');

const READY = { ok: true, checks: [] };
const NOT_READY = { ok: false, overridable: true, checks: [{ key: 'assumptions', ok: false, label: 'Open assumptions' }, { key: 'scope', ok: true, label: 'Scope' }] };
const feature = (over = {}) => ({ seq: 7, status: 'idle', state: 'ready', readiness: READY, starts: [], ...over });

function fakeModal() {
  const m = { card: null, opts: null, closed: [], open(card, opts) { m.card = card; m.opts = opts; },
    close(restore) { m.closed.push(restore); const o = m.opts; m.card = null; m.opts = null; if (o && o.onClose) o.onClose(); } };
  return m;
}
const ui = (m, name) => m.card && m.card.querySelector(`[data-ui="${name}"]`);

/** fetchJson over a table: GET feature, then `start` / `noteCheck` handlers; every call is recorded. */
function harness({ f = feature(), start = async () => ({ runId: 'r1', version: 2, feature: { seq: 7 } }), noteCheck = async () => ({ conflict: false, conflicts: [] }) } = {}) {
  const calls = [];
  const fetchJson = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body });
    if (url === '/api/requirements/7') return { feature: f };
    if (url === '/api/requirements/7/start') return start(opts.body);
    if (url === '/api/requirements/7/note-check') return noteCheck(opts.body);
    throw new Error(`unexpected ${url}`);
  };
  const modal = fakeModal();
  const started = [];
  const run = () => startFromFeature({ seq: 7, modal, fetchJson, projectDir: '/p', scopeRef: { kind: 'project', ref: 'shop' }, trigger: null,
    onStarted: (s) => started.push(s), document });
  const posts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/start'));
  return { calls, modal, started, run, posts };
}
const refuse = (status, data) => Object.assign(new Error(data.error || `HTTP ${status}`), { status, data });
const press = async (m, name) => { ui(m, name).click(); await settle(); };

test('ready and idle: the overlay opens on Auto with the note step, Start posts once and reports runId and version', async () => {
  const t = harness();
  void t.run(); await settle();
  assert.equal(t.posts().length, 0);
  assert.equal(ui(t.modal, 'runsetup-workflow').textContent, 'Auto');
  assert.ok(ui(t.modal, 'runsetup-note'));
  await press(t.modal, 'runsetup-go');
  assert.equal(t.posts().length, 1);
  assert.deepEqual(t.posts()[0].body, { workflowId: 'wf_auto' });   // Auto: no overlay key at all
  assert.deepEqual(t.started, [{ runId: 'r1', version: 2, feature: { seq: 7 } }]);
});

test('the last start\'s workflow and branch are the defaults; a saved workflow opens its own overlay', async () => {
  const prior = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const t = harness({ f: feature({ starts: [{ workflowId: 'wf_g', sourceBranch: 'dev', run: { status: 'done' } }] }) });
    void t.run(); await settle();
    assert.equal(ui(t.modal, 'runsetup-workflow').textContent, 'wf_g');
  } finally { globalThis.fetch = prior; }
});

test('the branch of the last start is sent; a note and its override flag go with the start', async () => {
  const t = harness({ f: feature({ starts: [{ workflowId: 'wf_auto', sourceBranch: 'dev', run: { status: 'done' } }] }),
    noteCheck: async () => ({ conflict: true, conflicts: [{ quote: 'no tests', why: 'the spec wants tests' }] }) });
  void t.run(); await settle();
  ui(t.modal, 'runsetup-note').value = 'ship with no tests';
  await press(t.modal, 'runsetup-go');
  assert.equal(t.posts().length, 0);
  assert.ok(ui(t.modal, 'runsetup-anyway'));
  await press(t.modal, 'runsetup-anyway');
  assert.deepEqual(t.posts()[0].body, { workflowId: 'wf_auto', sourceBranch: 'dev', note: 'ship with no tests', noteOverrides: true });
  assert.ok(t.calls.some((c) => c.url === '/api/requirements/7/note-check' && c.body.note === 'ship with no tests'));
});

test('a skipped note check starts the run without conflicts', async () => {
  const t = harness({ noteCheck: async () => ({ conflict: false, conflicts: [], skipped: true }) });
  void t.run(); await settle();
  ui(t.modal, 'runsetup-note').value = 'be careful';
  await press(t.modal, 'runsetup-go');
  assert.deepEqual(t.posts()[0].body, { workflowId: 'wf_auto', note: 'be careful' });
  assert.equal(t.started.length, 1);
});

test('not Ready: the failing labels and a required reason come before any POST; the reason goes in the body', async () => {
  const t = harness({ f: feature({ readiness: NOT_READY }) });
  void t.run(); await settle();
  assert.deepEqual([...ui(t.modal, 'feature-flow-failing').querySelectorAll('li')].map((l) => l.textContent), ['Open assumptions']);
  assert.equal(ui(t.modal, 'feature-flow-confirm').disabled, true);   // a reason is required
  const area = ui(t.modal, 'feature-flow-reason');
  area.value = 'customer demo'; area.dispatchEvent(new window.Event('input'));
  assert.equal(t.posts().length, 0);
  await press(t.modal, 'feature-flow-confirm');
  assert.ok(ui(t.modal, 'runsetup-go'));
  assert.equal(t.posts().length, 0);
  await press(t.modal, 'runsetup-go');
  assert.equal(t.posts()[0].body.reason, 'customer demo');
});

test('not Ready and not overridable: the failing labels are shown as a notice and the flow stops', async () => {
  const t = harness({ f: feature({ readiness: { ...NOT_READY, overridable: false } }) });
  assert.equal(await t.run(), null);
  assert.match(ui(t.modal, 'feature-flow-notice').textContent, new RegExp(`^${NOT_STARTABLE_TEXT}Open assumptions\\.$`));
  assert.equal(ui(t.modal, 'runsetup-go'), null);
  assert.equal(t.posts().length, 0);
});

test('the reason box is capped at the server\'s 500 characters', async () => {
  const t = harness({ f: feature({ readiness: NOT_READY }) });
  void t.run(); await settle();
  assert.equal(REASON_MAX, 500);
  assert.equal(ui(t.modal, 'feature-flow-reason').getAttribute('maxlength'), '500');
});

test('an onStarted that throws does not turn a started run into an error', async () => {
  const t = harness();
  const modal = t.modal;
  const warn = console.warn; console.warn = () => {};
  try {
    void startFromFeature({ seq: 7, modal, fetchJson: async (url, o = {}) => (url === '/api/requirements/7' ? { feature: feature() } : { runId: 'r1', version: 1 }), onStarted: () => { throw new Error('x'); }, document });
    await settle();
    await press(modal, 'runsetup-go');
  } finally { console.warn = warn; }
  assert.equal(modal.card, null, 'the overlay closed: the start counted as started');
});

test('not Ready, cancelled: nothing is posted and no overlay opens', async () => {
  const t = harness({ f: feature({ readiness: NOT_READY }) });
  void t.run(); await settle();
  await press(t.modal, 'feature-flow-cancel');
  assert.equal(t.modal.card, null);
  assert.equal(t.posts().length, 0);
});

test('a live start asks first; confirming sends confirmRunning, declining sends nothing', async () => {
  const f = feature({ starts: [{ workflowId: 'wf_auto', run: { status: 'running' } }] });
  const declined = harness({ f });
  void declined.run(); await settle();
  assert.ok(declined.modal.card.textContent.includes(RUN_IN_PROGRESS_TEXT));
  await press(declined.modal, 'feature-flow-cancel');
  assert.equal(declined.modal.card, null);
  assert.equal(declined.posts().length, 0);

  const t = harness({ f });
  void t.run(); await settle();
  await press(t.modal, 'feature-flow-confirm');
  await press(t.modal, 'runsetup-go');
  assert.deepEqual(t.posts()[0].body, { workflowId: 'wf_auto', confirmRunning: true });
});

test('a refusal is returned to the overlay: its text shows, the overlay stays, nothing is reported started', async () => {
  const t = harness({ start: async () => { throw refuse(409, { error: 'The feature is archived.' }); } });
  void t.run(); await settle();
  await press(t.modal, 'runsetup-go');
  assert.equal(t.modal.card.querySelector('.req-runsetup-msg').textContent, 'The feature is archived.');
  assert.ok(ui(t.modal, 'runsetup-go'));
  assert.equal(t.started.length, 0);
});

test('RUN_IN_PROGRESS 409: the message shows and the next Start sends confirmRunning', async () => {
  let n = 0;
  const t = harness({ start: async (body) => {
    n += 1;
    if (!body.confirmRunning) throw refuse(409, { code: 'RUN_IN_PROGRESS', error: 'busy' });
    return { runId: 'r2', version: 3, feature: { seq: 7 } };
  } });
  void t.run(); await settle();
  await press(t.modal, 'runsetup-go');
  assert.ok(t.modal.card.querySelector('.req-runsetup-msg').textContent.startsWith(RUN_IN_PROGRESS_TEXT));
  assert.equal(t.posts()[0].body.confirmRunning, undefined);
  await press(t.modal, 'runsetup-go');
  assert.equal(t.posts()[1].body.confirmRunning, true);
  assert.equal(n, 2);
  assert.equal(t.started[0].runId, 'r2');
});

test('NOT_READY 409 after the overlay: the reason is asked with the failing labels, then the same start goes again with it', async () => {
  const t = harness({ f: feature({ readiness: { ok: true, checks: NOT_READY.checks } }), start: async (body) => {
    if (!body.reason) throw refuse(409, { error: 'not ready', failing: ['assumptions'] });
    return { runId: 'r3', version: 1, feature: { seq: 7 } };
  } });
  void t.run(); await settle();
  ui(t.modal, 'runsetup-note').value = 'n';
  await press(t.modal, 'runsetup-go');
  assert.deepEqual([...ui(t.modal, 'feature-flow-failing').querySelectorAll('li')].map((l) => l.textContent), ['Open assumptions']);
  const area = ui(t.modal, 'feature-flow-reason');
  area.value = 'urgent'; area.dispatchEvent(new window.Event('input'));
  await press(t.modal, 'feature-flow-confirm');
  assert.deepEqual(t.posts()[1].body, { workflowId: 'wf_auto', reason: 'urgent', note: 'n' });
  assert.equal(t.started[0].runId, 'r3');
  assert.equal(t.modal.card, null);
});

test('a double Start posts once', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const t = harness({ start: async () => { await gate; return { runId: 'r1', version: 1, feature: { seq: 7 } }; } });
  void t.run(); await settle();
  const go = ui(t.modal, 'runsetup-go');
  go.click(); go.click();
  await settle();
  assert.equal(t.posts().length, 1);
  release(); await settle();
  assert.equal(t.started.length, 1);
});

test('an archived feature shows a message and stops; a feature that cannot load says so', async () => {
  const t = harness({ f: feature({ status: 'archived', state: 'archived' }) });
  assert.equal(await t.run(), null);
  assert.equal(ui(t.modal, 'feature-flow-notice').textContent, ARCHIVED_TEXT);
  assert.equal(t.posts().length, 0);

  const modal = fakeModal();
  await startFromFeature({ seq: 7, modal, fetchJson: async () => { throw refuse(404, { error: 'gone' }); }, onStarted: () => {}, document });
  assert.ok(ui(modal, 'feature-flow-notice'));
});

test('the flow posts only to the feature start and note-check paths, never /api/run', async () => {
  const t = harness({ noteCheck: async () => ({ conflict: false, conflicts: [] }) });
  void t.run(); await settle();
  ui(t.modal, 'runsetup-note').value = 'hi';
  await press(t.modal, 'runsetup-go');
  const posted = t.calls.filter((c) => c.method === 'POST').map((c) => c.url);
  assert.deepEqual(posted.sort(), ['/api/requirements/7/note-check', '/api/requirements/7/start']);
  assert.ok(!t.calls.some((c) => c.url.startsWith('/api/run')));
});
