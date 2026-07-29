import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Behavior tests for Task 11: History per-step Q&A in the Clarify dropdown.
// We boot the REAL app.js against the REAL index.html under jsdom, instantiate
// the hist-card template (the .clarify-bar lives in it), and drive the painter
// directly via the window.__np test hook.

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

test('paintClarifyBar renders step questions with agent prefix and sums the count chip', async () => {
  const { window } = await boot();
  const doc = window.document;
  // Instantiate the hist-card template to get a real .clarify-bar.
  const tpl = [...doc.querySelectorAll('template')].find((t) => t.content.querySelector('.clarify-bar'));
  doc.body.appendChild(tpl.content.cloneNode(true));
  const bar = doc.body.querySelector('.clarify-bar');
  window.__np.paintClarifyBar(bar, {
    questions: [{ id: 'c1', question: 'Clarify?', options: ['A'] }],
    answers: [{ id: 'c1', question: 'Clarify?', choice: 'A' }],
  }, [{
    stepKey: '1:s0_0', round: 1, nodeId: 's0_0', agentKey: 'planner',
    questions: [{ id: 'q1', question: 'Which storage?', options: ['Redis', 'Postgres'] }],
    answers: [{ id: 'q1', question: 'Which storage?', choice: 'Postgres' }],
  }]);
  assert.equal(bar.hidden, false);
  assert.equal(bar.querySelector('.sb-count').textContent, '2', 'clarify + step questions');
  bar.querySelector('.btn-subs').click();
  const text = bar.querySelector('.clarify-panel').textContent;
  assert.match(text, /Clarify\?/);
  assert.match(text, /planner — round 1/);
  assert.match(text, /Which storage\?/);
  assert.match(text, /Answer: Postgres/);
});

test('cycle suffix appears when the stepKey carries one', async () => {
  const { window } = await boot();
  const doc = window.document;
  const tpl = [...doc.querySelectorAll('template')].find((t) => t.content.querySelector('.clarify-bar'));
  doc.body.appendChild(tpl.content.cloneNode(true));
  const bar = doc.body.querySelector('.clarify-bar');
  window.__np.paintClarifyBar(bar, { questions: [], answers: [] }, [{
    stepKey: '3:s2_0#2', round: 1, nodeId: 's2_0', agentKey: 'implementer',
    questions: [{ id: 'q1', question: 'Fix how?', options: ['A', 'B'] }],
    answers: [],
  }]);
  bar.querySelector('.btn-subs').click();
  assert.match(bar.querySelector('.clarify-panel').textContent, /implementer — round 1 · cycle 2/);
});

test('paintClarifyBar stays hidden with no clarify and no step questions', async () => {
  const { window } = await boot();
  const doc = window.document;
  const tpl = [...doc.querySelectorAll('template')].find((t) => t.content.querySelector('.clarify-bar'));
  doc.body.appendChild(tpl.content.cloneNode(true));
  const bar = doc.body.querySelector('.clarify-bar');
  window.__np.paintClarifyBar(bar, { questions: [], answers: [] }, []);
  assert.equal(bar.hidden, true);
});
