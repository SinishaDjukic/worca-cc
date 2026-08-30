// test/ui-running-card.test.mjs — run-card v2 header: status avatar, title, meta
// line, branch chip, action cluster, and header-click navigation.
//
// boot()/dispatch()/showRunning()/helloRunning() are copied VERBATIM from
// test/ui-question.test.mjs (boot 19-82, RUN_ID 84, helloRunning 88-96) — the
// nearest suite that both captures the WebSocket instance and lets a case
// intercept fetch, which the Pause/Stop POST assertions need.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() {
      this.readyState = 1;
      this._listeners = {};
      wsBox.ws = this;
    }
    send() {}
    close() {}
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    dispatch(type, evt) {
      (this._listeners[type] || []).forEach((fn) => fn(evt));
    }
  };

  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) {
      const r = fetchHandler(String(url), opts || {});
      if (r) return r;
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
    });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present — leave it */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  function dispatch(msg) {
    wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
  }
  function showRunning() {
    window.location.hash = 'running';
    window.dispatchEvent(new window.Event('hashchange'));
  }
  return { window, dispatch, showRunning, calls, wsBox };
}

const RUN_ID = 'run-aaa';

function helloRunning(ctx, extra = {}) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    runs: [
      { runId: RUN_ID, title: 'Demo run', projectDir: '/tmp/p', status: 'running', startedAt: '2026-01-01T00:00:00Z', ...extra },
    ],
  });
}

const cardOf = (ctx) => ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);

test('header anatomy: avatar, ellipsised title, meta line, action cluster — and no .run-foot', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();

  const card = cardOf(ctx);
  assert.ok(card, 'run card built');
  const head = card.querySelector('.rc-head');
  assert.ok(head, '.rc-head present');
  assert.equal(head.getAttribute('role'), 'button', 'header is a button for AT');
  assert.equal(head.getAttribute('tabindex'), '0', 'header is focusable');

  assert.ok(head.querySelector('.rc-sic'), '.rc-sic status avatar present');
  assert.equal(head.querySelector('.rc-title').textContent, 'Demo run');
  assert.ok(head.querySelector('.rc-meta .rc-status-word'), 'status word lives in the meta line');
  assert.ok(head.querySelector('.rc-meta .rm-text'), 'started-at segment kept');
  assert.ok(head.querySelector('.rc-meta .run-time'), '.run-time kept (the 1s ticker writes it)');
  assert.ok(head.querySelector('.rc-meta .run-cost'), '.run-cost kept');
  assert.ok(head.querySelector('.rc-branch'), 'branch chip slot present');

  assert.ok(head.querySelector('.rc-acts .btn-pause'), 'Pause moved into the action cluster');
  assert.ok(head.querySelector('.rc-acts .btn-resume'), 'Resume moved into the action cluster');
  assert.ok(head.querySelector('.rc-acts .btn-stop'), 'Stop moved into the action cluster');
  assert.ok(head.querySelector('.rc-acts .rc-open'), 'chevron present');

  assert.equal(card.querySelector('.run-foot'), null, '.run-foot is gone');
  assert.equal(card.querySelector('.run-top'), null, '.run-top is gone');
  assert.equal(card.querySelector('.chip'), null, 'the phase chip is gone');
  assert.equal(card.querySelector('.pill-run'), null, 'the old status pill is gone from the card');
});

test('status avatar: family + single glyph per run state, word from statusPill', async () => {
  const ctx = await boot();
  const { upsertRun, buildRunCard, paintRunCard } = ctx.window.__np;
  const cases = [
    ['running',  { status: 'running' },  'st-blue',  'sic-spin',   'Running'],
    ['starting', { status: 'starting' }, 'st-blue',  'sic-spin',   'Starting'],
    ['ask',      { status: 'running', pendingQuestion: { id: 'q', questions: [{ question: 'x?' }] } },
                                          'st-amber', 'sic-ask',    'Paused · awaiting answers'],
    ['paused',   { status: 'paused' },   'st-amber', 'sic-pause',  'Paused'],
    ['pausing',  { status: 'pausing' },  'st-amber', 'sic-pause',  'Pausing…'],
    ['interrupted', { status: 'interrupted' }, 'st-amber', 'sic-pause', 'Interrupted'],
    ['done',     { status: 'done' },     'st-green', 'sic-check',  'Done'],
    ['stopped',  { status: 'stopped' },  'st-red',   'sic-square', 'Stopped'],
    ['error',    { status: 'error' },    'st-red',   'sic-bang',   'Error'],
    // Reachable on reload: onHello seeds pendingQuestion regardless of status, so
    // a run parked on a question can arrive carrying a terminal one. statusPill
    // tests pendingQuestion BEFORE done/stopped/error, and the avatar has to
    // agree — otherwise a green check sits beside "Paused · awaiting answers"
    // and the "?" that is the only cue the user must act never appears.
    ['done+ask', { status: 'done', pendingQuestion: { id: 'q', questions: [{ question: 'x?' }] } },
                                          'st-amber', 'sic-ask',    'Paused · awaiting answers'],
  ];
  for (const [id, patch, family, glyph, word] of cases) {
    const r = upsertRun({ runId: `s-${id}`, title: 't', projectDir: '/tmp/p', ...patch });
    r.el = buildRunCard(r);
    paintRunCard(r);
    const sic = r.el.querySelector('.rc-sic');
    assert.ok(sic.classList.contains(family), `${id}: avatar family ${family}`);
    const on = [...sic.querySelectorAll('.sic')].filter((s) => !s.hasAttribute('hidden'));
    assert.equal(on.length, 1, `${id}: exactly one glyph visible`);
    assert.ok(on[0].classList.contains(glyph), `${id}: glyph is ${glyph}`);
    assert.equal(sic.title, word, `${id}: avatar title is the status word`);
    assert.equal(sic.getAttribute('aria-label'), word, `${id}: avatar aria-label is the status word`);
    assert.equal(r.el.querySelector('.rc-status-word').textContent, word, `${id}: meta word`);
  }
});

test('meta line: status-word family follows statusPill, started-at renders, elapsed + cost paint', async () => {
  const ctx = await boot();
  const { upsertRun, buildRunCard, paintRunCard, onState } = ctx.window.__np;
  const r = upsertRun({ runId: 'm1', title: 't', projectDir: '/tmp/p', status: 'running', startedAt: '2026-01-01T09:30:15Z' });
  r.el = buildRunCard(r);
  // A run with no manifest yet has no active agent, so the pill reads plainly
  // "Running" (the v1 phaseKey switch that used to name the phase is gone).
  onState(r, { status: 'running', totalCostUsd: 1.25 });
  const word = r.el.querySelector('.rc-status-word');
  assert.equal(word.textContent, 'Running');
  assert.ok(word.classList.contains('st-peach'), "statusPill's family lands on the word");
  assert.match(r.el.querySelector('.rm-text').textContent, /^started \d\d:\d\d:\d\d$/,
    'the meta segment is the started-at clock only (project moved to the sidebar/detail)');
  assert.equal(r.el.querySelector('.run-cost').textContent, '$1.25');
  assert.ok(r.el.querySelector('.run-time').textContent, 'elapsed painted');
});

test('branch chip: base → feature, copies on click, and never opens the run', async () => {
  const ctx = await boot();
  const { upsertRun, buildRunCard, onState } = ctx.window.__np;
  // Stub the clipboard AFTER boot, on the RETURNED window — copyBranchToClipboard
  // reads navigator.clipboard at CLICK time. Precedent: ui-history-detail.test.mjs:266-270.
  const writes = [];
  Object.defineProperty(ctx.window.navigator, 'clipboard', {
    value: { writeText: async (t) => { writes.push(t); } },
    configurable: true,
  });

  const r = upsertRun({ runId: 'br1', title: 't', projectDir: '/tmp/p', status: 'running' });
  r.el = buildRunCard(r);
  const chip = r.el.querySelector('.rc-branch');
  assert.equal(chip.hidden, true, 'no chip before a branch is known');

  onState(r, { branch: { feature: 'feat/x', source: 'main' } });
  assert.equal(chip.hidden, false, 'the chip appears when the branch lands on a later state event');
  assert.equal(r.el.querySelector('.rc-branch-name').textContent, 'feat/x');
  assert.equal(r.el.querySelector('.rc-base').textContent, 'main →');
  assert.equal(r.el.querySelector('.rc-base').hidden, false);

  const before = ctx.window.location.hash;
  r.el.querySelector('.rc-branch-copy').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(writes, ['feat/x'], 'the copy button copies the feature branch');
  assert.equal(ctx.window.location.hash, before, 'copying must not navigate');
});

test('a source-less branch hides only the "base →" prefix', async () => {
  const ctx = await boot();
  const { upsertRun, buildRunCard, onState } = ctx.window.__np;
  const r = upsertRun({ runId: 'br2', title: 't', projectDir: '/tmp/p', status: 'running' });
  r.el = buildRunCard(r);
  onState(r, { branch: { feature: 'feat/y' } });
  assert.equal(r.el.querySelector('.rc-branch').hidden, false);
  assert.equal(r.el.querySelector('.rc-base').hidden, true, 'no source branch -> no "base →" prefix');
});

test('clicking the card header opens #running/<runId>', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();
  cardOf(ctx).querySelector('.rc-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(ctx.window.location.hash, `#running/${RUN_ID}`);
});

test('Enter on the focused header opens #running/<runId>', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();
  cardOf(ctx).querySelector('.rc-head')
    .dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(ctx.window.location.hash, `#running/${RUN_ID}`);
});

test('Space on the focused header opens #running/<runId>', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();
  cardOf(ctx).querySelector('.rc-head')
    .dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  assert.equal(ctx.window.location.hash, `#running/${RUN_ID}`);
});

test('the chevron opens #running/<runId>', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();
  cardOf(ctx).querySelector('.rc-open').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(ctx.window.location.hash, `#running/${RUN_ID}`);
});

// REGRESSION GUARD: the action buttons ride the DELEGATED #run-list listener
// (app.js:7957-8062). A stopPropagation on them would silently kill Pause/Stop.
// Stop now confirms first (D5, Task 10), so its POST lands only after
// `.stop-confirm`. What this case guards is the delegated hop and the "an action
// button must not open the run" rule — not the directness of the call.
test('Pause and Stop still reach their endpoints from the header cluster, without navigating', async () => {
  const posts = [];
  const ctx = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/pause') || url.includes('/api/stop')) {
        posts.push({ url, body: JSON.parse(opts.body) });
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return null;
    },
  });
  helloRunning(ctx);
  ctx.showRunning();
  const card = cardOf(ctx);
  const before = ctx.window.location.hash;
  card.querySelector('.btn-pause').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  card.querySelector('.btn-stop').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  const modal = ctx.window.document.getElementById('stop-modal');
  assert.equal(modal.dataset.runId, RUN_ID, 'Stop reached the delegated listener and opened the modal');
  modal.querySelector('.stop-confirm').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posts.length, 2, 'both actions posted');
  assert.ok(posts[0].url.includes('/api/pause'));
  assert.deepEqual(posts[0].body, { runId: RUN_ID });
  assert.ok(posts[1].url.includes('/api/stop'));
  assert.deepEqual(posts[1].body, { runId: RUN_ID });
  assert.equal(ctx.window.location.hash, before, 'an action button must not open the run');
});

test('a paused run swaps Pause for Resume inside the cluster', async () => {
  const ctx = await boot();
  const { upsertRun, buildRunCard, paintRunCard, onState } = ctx.window.__np;
  const r = upsertRun({ runId: 'p9', title: 't', projectDir: '/tmp/p', status: 'running' });
  r.el = buildRunCard(r);
  paintRunCard(r);
  assert.equal(r.el.querySelector('.rc-acts .btn-pause').hidden, false);
  assert.equal(r.el.querySelector('.rc-acts .btn-resume').hidden, true);
  onState(r, { status: 'paused' });
  assert.equal(r.el.querySelector('.rc-acts .btn-pause').hidden, true);
  assert.equal(r.el.querySelector('.rc-acts .btn-resume').hidden, false);
});

test('a pending question shows the amber question-count pill in the action cluster', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();
  assert.equal(cardOf(ctx).querySelector('.rc-qpill').hidden, true, 'no pill without a question');
  ctx.dispatch({
    type: 'question', runId: RUN_ID, id: 'q1', kind: 'clarify',
    questions: [{ id: 'a', question: 'x?', options: ['1'] }, { id: 'b', question: 'y?', options: ['2'] }],
  });
  const pill = cardOf(ctx).querySelector('.rc-qpill');
  assert.equal(pill.hidden, false);
  assert.equal(pill.textContent, '2 questions');
  ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: 'q1' });
  assert.equal(cardOf(ctx).querySelector('.rc-qpill').hidden, true, 'pill clears when the question resolves');
});
