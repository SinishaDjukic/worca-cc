import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Behavior tests for Task 4: the inline per-card clarify/gate question panel.
// We boot the REAL app.js against the REAL index.html under jsdom, capture the
// WebSocket instance via a constructor stub, dispatch `message` events through
// it, and capture POST /api/answer via a fetch stub.
//
// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state can't leak between cases.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

// Boot app.js into a fresh jsdom window. Returns helpers for driving it.
async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;

  // Capture the single WebSocket instance app.js creates at boot so tests can
  // dispatch server `message` events through its registered listeners.
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() {
      this.readyState = 1; // OPEN — app.js gates backfill subscribes on wsReady
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

  // Record fetch calls; default to a benign JSON 200 for the boot fetches
  // (/api/projects, /api/config). Tests can supply a custom handler.
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

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);

  // Let the boot's async fetches (loadProjects/loadConfig) settle.
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

// Open the WS so hello-driven backfill subscribes don't throw, then dispatch a
// `hello` with one running run.
function helloRunning(ctx, extra = {}) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    runs: [
      { runId: RUN_ID, title: 'Demo run', projectDir: '/tmp/p', status: 'running', startedAt: '2026-01-01T00:00:00Z', ...extra },
    ],
  });
}

function clarifyEvent() {
  return {
    type: 'question',
    runId: RUN_ID,
    id: 'clarify-1',
    kind: 'clarify',
    questions: [
      // options padded to 3 slots with '' per the clarify contract — UI must filter.
      { id: 'q1', question: 'Where to store sessions?', options: ['Redis', 'Postgres', ''], allowFreeText: true },
      { id: 'q2', question: 'How to handle invalid input?', options: ['Fail fast', '', ''], allowFreeText: true },
    ],
  };
}

test('clarify question renders inline in the run card, card gets .attention', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();
  ctx.dispatch(clarifyEvent());

  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  assert.ok(card, 'run card exists');
  const panel = card.querySelector('.qpanel');
  assert.ok(panel, 'qpanel present');
  assert.equal(panel.classList.contains('hidden'), false, 'qpanel is visible (not hidden)');
  assert.ok(card.classList.contains('attention'), 'card has .attention ring');

  const blocks = panel.querySelectorAll('.qblock');
  assert.equal(blocks.length, 2, 'one .qblock per question');

  // q1 has 2 real options, q2 has 1 (the '' slots are filtered) => 3 total.
  const opts = panel.querySelectorAll('.qopt');
  assert.equal(opts.length, 3, 'empty option slots are filtered out');

  // Head: count chip + title with the phase label (defaults to phaseKey label).
  assert.ok(panel.querySelector('.qcount'), 'qcount chip present');
  assert.match(panel.querySelector('.qcount').textContent, /2 questions/);
  assert.ok(panel.querySelector('.qpanel-foot .btn-go'), 'submit button present');
});

test('selecting an option marks it + submit posts {runId,id,payload:{answers}} with the choice', async () => {
  const captured = [];
  const ctx = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/answer')) {
        captured.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return null;
    },
  });
  helloRunning(ctx);
  ctx.showRunning();
  ctx.dispatch(clarifyEvent());

  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  const blocks = card.querySelectorAll('.qblock');

  // Click the first option of q1 ("Redis").
  const q1opt = blocks[0].querySelectorAll('.qopt')[0];
  q1opt.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.ok(q1opt.classList.contains('sel'), 'clicked option marked .sel');
  assert.equal(q1opt.getAttribute('aria-pressed'), 'true', 'clicked option aria-pressed=true');
  // Sibling stays unselected.
  const q1opt2 = blocks[0].querySelectorAll('.qopt')[1];
  assert.equal(q1opt2.getAttribute('aria-pressed'), 'false', 'sibling stays unpressed');

  // Click q2's only option ("Fail fast").
  blocks[1].querySelectorAll('.qopt')[0].dispatchEvent(new ctx.window.Event('click', { bubbles: true }));

  // Click submit (delegated handler on #run-list).
  const submit = card.querySelector('.qpanel-foot .btn-go');
  submit.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(captured.length, 1, 'one POST /api/answer issued');
  const body = captured[0];
  assert.equal(body.runId, RUN_ID, 'body carries runId');
  assert.equal(body.id, 'clarify-1', 'body carries the question id');
  assert.ok(body.payload && Array.isArray(body.payload.answers), 'payload.answers is an array');
  assert.equal(body.payload.answers.length, 2, 'one answer per question');
  assert.equal(body.payload.answers[0].id, 'q1');
  assert.equal(body.payload.answers[0].choice, 'Redis', 'chosen option text captured as choice');
  assert.equal(body.payload.answers[1].id, 'q2');
  assert.equal(body.payload.answers[1].choice, 'Fail fast');

  // 200 must NOT immediately clear the panel — keep pendingQuestion until resume.
  assert.equal(card.classList.contains('attention'), true, 'panel kept until a resume event confirms');
  assert.equal(card.querySelector('.qpanel').classList.contains('hidden'), false, 'panel still visible after 200');

  // A following `phase` event confirms resume -> panel clears, attention drops.
  ctx.dispatch({ type: 'phase', runId: RUN_ID, phase: 'plan', status: 'start' });
  assert.equal(card.classList.contains('attention'), false, 'attention dropped on resume');
  assert.equal(card.querySelector('.qpanel').classList.contains('hidden'), true, 'panel hidden on resume');
  assert.equal(card.querySelector('.qpanel').innerHTML, '', 'panel emptied on resume');
});

test('free-text answer overrides option selection and is captured as the choice', async () => {
  const captured = [];
  const ctx = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/answer')) {
        captured.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return null;
    },
  });
  helloRunning(ctx);
  ctx.showRunning();
  ctx.dispatch(clarifyEvent());

  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  const blocks = card.querySelectorAll('.qblock');

  // Select an option in q1, then type free text -> the option must clear.
  const q1opt = blocks[0].querySelectorAll('.qopt')[0];
  q1opt.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  const free = blocks[0].querySelector('.qfree');
  free.value = 'DynamoDB';
  free.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  assert.equal(q1opt.classList.contains('sel'), false, 'typing free text clears the option selection');

  card.querySelector('.qpanel-foot .btn-go').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(captured[0].payload.answers[0].choice, 'DynamoDB', 'free-text value captured as the choice');
});

test('A2: a hello-seeded pendingQuestion renders the panel when the card is built (no question event)', async () => {
  const ctx = await boot();
  // hello seeds the run WITH a pendingQuestion (mid-pause reload: the original
  // question event is past the replay buffer). No separate `question` dispatched.
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    runs: [
      {
        runId: RUN_ID,
        title: 'Reloaded run',
        projectDir: '/tmp/p',
        status: 'running',
        startedAt: '2026-01-01T00:00:00Z',
        pendingQuestion: clarifyEvent(),
      },
    ],
  });

  // Now navigate to Running — showView('running') -> renderRunningView builds the card.
  ctx.showRunning();

  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  assert.ok(card, 'card built for seeded run');
  const panel = card.querySelector('.qpanel');
  assert.equal(panel.classList.contains('hidden'), false, 'panel rendered from the seed');
  assert.equal(panel.querySelectorAll('.qblock').length, 2, 'seeded questions rendered');
  assert.ok(card.classList.contains('attention'), 'seeded paused run shows attention');
});

test('gate question renders issues + two decision buttons; approve posts {decision:"another"}', async () => {
  const captured = [];
  const ctx = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/answer')) {
        captured.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return null;
    },
  });
  helloRunning(ctx);
  ctx.showRunning();
  ctx.dispatch({
    type: 'question',
    runId: RUN_ID,
    id: 'gate-refine-5',
    kind: 'gate',
    issues: [
      { severity: 'critical', title: 'Missing tests', detail: 'No coverage for X', location: 'src/x.js:10' },
      { severity: 'minor', title: 'Naming', detail: 'foo -> bar' },
    ],
  });

  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  const panel = card.querySelector('.qpanel');
  assert.equal(panel.classList.contains('hidden'), false, 'gate panel visible');
  assert.equal(panel.querySelectorAll('.issues .issue').length, 2, 'both issues rendered');
  assert.ok(panel.querySelector('.issue.sev-critical'), 'critical severity class applied');
  assert.ok(panel.querySelector('.gate-continue'), 'continue button present');
  assert.ok(panel.querySelector('.gate-another'), 'approve-another button present');

  panel.querySelector('.gate-another').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(captured.length, 1, 'gate POST issued');
  assert.equal(captured[0].id, 'gate-refine-5');
  assert.deepEqual(captured[0].payload, { decision: 'another' }, 'approve posts decision:another');
});

test('multi-tab: a question-resolved event clears the card WITHOUT this tab having answered', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();
  ctx.dispatch(clarifyEvent()); // card shows; this tab never submits an answer (_answering stays false)

  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  assert.equal(card.classList.contains('attention'), true, 'card shows the question first');
  assert.equal(card.querySelector('.qpanel').classList.contains('hidden'), false, 'panel visible first');

  // Answered in ANOTHER tab -> the server broadcasts the resolution to this one.
  ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: 'clarify-1' });

  assert.equal(card.classList.contains('attention'), false, 'attention drops for the non-answering tab');
  assert.equal(card.querySelector('.qpanel').classList.contains('hidden'), true, 'panel hidden');
  assert.equal(card.querySelector('.qpanel').innerHTML, '', 'panel emptied');
});

test('a question-resolved for a STALE id leaves a newer pending question untouched', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();
  ctx.dispatch(clarifyEvent()); // pending = clarify-1

  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: 'clarify-OLD' });

  assert.equal(card.classList.contains('attention'), true, 'mismatched id leaves the card up');
  assert.equal(card.querySelector('.qpanel').classList.contains('hidden'), false, 'panel still visible');
});
