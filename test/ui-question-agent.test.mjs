import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Behavior tests for Task 10: kind:'questions' (per-agent user questions) in the
// inline run-card question panel. Harness (boot/helloRunning) copied verbatim
// from ui-question.test.mjs: real app.js + real index.html under jsdom, WS
// constructor stub, fetch recorder.

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

function questionsEvent() {
  return {
    type: 'question',
    runId: RUN_ID,
    id: 'questions-1:s0_0-r1',
    kind: 'questions',
    agent: 'Plan',
    nodeId: 's0_0',
    questions: [{ id: 'q1', question: 'Which storage?', options: ['Redis', 'Postgres'], allowFreeText: true }],
  };
}

test('kind:questions renders the clarify-style body with the agent name in the head', async () => {
  const ctx = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/answer') && opts && opts.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return null;
    },
  });
  helloRunning(ctx);
  ctx.showRunning();
  ctx.dispatch(questionsEvent());
  const doc = ctx.window.document;
  const head = doc.querySelector('.qpanel-head b');
  assert.equal(head.textContent, 'Plan has questions');
  assert.equal(doc.querySelectorAll('.qpanel .qopt').length, 2, 'options rendered');
  assert.ok(doc.querySelector('.qpanel .qfree'), 'free text rendered');
  // Submit posts the standard answers payload.
  doc.querySelector('.qpanel .qopt').click();
  doc.querySelector('.qpanel .qpanel-foot .btn-go').click();
  await new Promise((r) => setTimeout(r, 0));
  const post = ctx.calls.find((c) => c.url.includes('/api/answer'));
  assert.ok(post, 'POST /api/answer fired');
  const body = JSON.parse(post.opts.body);
  assert.equal(body.runId, RUN_ID);
  assert.equal(body.id, 'questions-1:s0_0-r1');
  assert.equal(body.payload.answers[0].choice, 'Redis');
});
