// test/ui-attribution.test.mjs
// Attribution in the UI (the server's identity.mjs): "Signed in as" in the rail foot,
// "by <name>" on History cards and live run cards, "Started by" / "Scheduled by" in the
// History detail meta. Nothing shows for a null or 'local' identity, and every name is
// painted as text, never markup.
//
// boot() is a local copy of the jsdom harness in test/ui-running-card.test.mjs and
// test/ui-history-detail.test.mjs — the suites do not import each other.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const _openDoms = [];
afterEach(() => { for (const d of _openDoms.splice(0)) { try { d.window.close(); } catch { /* closed */ } } });

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const fail = (status, body) => Promise.resolve({ ok: false, status, json: async () => body });

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  _openDoms.push(dom);
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {}
    close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };
  const calls = [];
  window.fetch = (u, opts) => {
    calls.push(String(u));
    if (fetchHandler) { const r = fetchHandler(String(u), opts || {}); if (r) return r; }
    if (String(u).includes('/api/projects')) return ok({ projects: [] });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle(window);
  const dispatch = (msg) => wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
  return { window, doc: window.document, wsBox, dispatch, calls };
}

async function settle(window, n = 4) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}
function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

// ── "Signed in as" ─────────────────────────────────────────────────────────────

test('rail foot: "Signed in as <name>" from /api/whoami, fetched once at boot', async () => {
  const { doc, calls } = await boot({ fetchHandler: (u) => (u.endsWith('/api/whoami') ? ok({ name: 'ada@example.com', source: 'access' }) : null) });
  const box = doc.getElementById('side-who');
  assert.equal(box.hidden, false);
  assert.equal(box.textContent.replace(/\s+/g, ' ').trim(), 'Signed in as ada@example.com');
  assert.equal(calls.filter((u) => u.endsWith('/api/whoami')).length, 1);
});

test('rail foot: hidden on a local install ({ name: null }), on "local", and when the call fails', async () => {
  for (const handler of [
    (u) => (u.endsWith('/api/whoami') ? ok({ name: null, source: 'local' }) : null),
    (u) => (u.endsWith('/api/whoami') ? ok({ name: 'local', source: 'local' }) : null),
    (u) => (u.endsWith('/api/whoami') ? fail(500, {}) : null),
    null,   // an older server without the route: the default fetch stub answers config JSON
  ]) {
    const { doc } = await boot({ fetchHandler: handler || undefined });
    assert.equal(doc.getElementById('side-who').hidden, true);
  }
});

test('rail foot: a name is painted as text, never markup', async () => {
  const { doc } = await boot({ fetchHandler: (u) => (u.endsWith('/api/whoami') ? ok({ name: '<img src=x onerror=alert(1)>', source: 'header' }) : null) });
  const name = doc.querySelector('#side-who .side-who-name');
  assert.equal(name.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(name.querySelector('img'), null);
});

// ── History cards ──────────────────────────────────────────────────────────────

const ROW = (over = {}) => ({
  id: 'a1', title: 'Alpha one', status: 'done', startedAt: '2026-06-01T00:00:00Z',
  projectName: 'Alpha', projectKey: 'alpha-00000001', projectDir: '/x/alpha', ...over,
});

async function historyCards(rows) {
  const ctx = await boot({ fetchHandler: (u) => {
    if (u.endsWith('/api/history/pr')) return ok({ ok: true });
    if (u.endsWith('/api/history')) return ok({ pipelines: rows, ghAvailable: false });
    return null;
  } });
  go(ctx.window, 'history');
  await settle(ctx.window, 6);
  return ctx.doc.querySelectorAll('#history .hist-card');
}

test('History card: "by <name>" when someone started the run; nothing for null or local', async () => {
  const cards = await historyCards([
    ROW({ id: 'a3', startedBy: 'ada@example.com' }),
    ROW({ id: 'a2', startedBy: 'local' }),
    ROW({ id: 'a1', startedBy: null }),
  ]);
  assert.equal(cards.length, 3);
  const seg = (c) => c.querySelector('.hist-by-seg');
  assert.equal(seg(cards[0]).hidden, false);
  assert.equal(cards[0].querySelector('.hist-by').textContent, 'by ada@example.com');
  assert.equal(cards[0].querySelector('.hist-by').title, 'Started by ada@example.com');
  assert.equal(seg(cards[1]).hidden, true, "'local' is nobody in particular");
  assert.equal(seg(cards[2]).hidden, true, 'a run from before attribution');
});

// ── live run cards ─────────────────────────────────────────────────────────────

const RUN_ID = 'run-aaa';
function hello(ctx, extra = {}) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [{ runId: RUN_ID, title: 'Demo run', projectDir: '/tmp/p', status: 'running', startedAt: '2026-01-01T00:00:00Z', ...extra }] });
  go(ctx.window, 'running');
}
const card = (ctx) => ctx.doc.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);

test('run card: "by <name>" from the state snapshot, hidden until then', async () => {
  const ctx = await boot();
  hello(ctx);
  await settle(ctx.window);
  const by = card(ctx).querySelector('.rc-by');
  assert.equal(by.hidden, true, 'unknown yet');
  assert.match(card(ctx).querySelector('.rm-text').textContent, /^started \d\d:\d\d:\d\d$/, 'the started segment is unchanged');
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running', startedBy: 'ada@example.com' });
  await settle(ctx.window);
  assert.equal(by.hidden, false);
  assert.equal(by.querySelector('.rc-by-text').textContent, 'by ada@example.com');
});

test('run card: the hello snapshot may carry startedBy; local stays hidden', async () => {
  const ctx = await boot();
  hello(ctx, { startedBy: 'grace@example.com' });
  await settle(ctx.window);
  assert.equal(card(ctx).querySelector('.rc-by-text').textContent, 'by grace@example.com');

  const local = await boot();
  hello(local, { startedBy: 'local' });
  await settle(local.window);
  assert.equal(card(local).querySelector('.rc-by').hidden, true);
});

test('live run detail header: "by <name>" after "started …"; nothing for local', async () => {
  const ctx = await boot();
  hello(ctx, { startedBy: 'ada@example.com' });
  go(ctx.window, `running/${RUN_ID}`);
  await settle(ctx.window, 8);
  const by = ctx.doc.querySelector('.rd-meta .rd-by');
  assert.ok(by, ctx.doc.querySelector('.rd-meta')?.textContent);
  assert.equal(by.textContent, 'by ada@example.com');
  assert.equal(by.title, 'Started by ada@example.com');
  assert.equal(by.previousElementSibling?.previousElementSibling?.className, 'rd-clock', 'right after "started …"');

  const local = await boot();
  hello(local, { startedBy: 'local' });
  go(local.window, `running/${RUN_ID}`);
  await settle(local.window, 8);
  assert.equal(local.doc.querySelector('.rd-meta .rd-by'), null);
});

// ── History detail meta ────────────────────────────────────────────────────────

const KEY = 'proj-alpha-abcd1234';
const DETAIL_ROW = { id: 'fcec04e8', projectKey: KEY, projectName: 'Alpha', projectDir: '/tmp/proj', title: 'Fix it', status: 'done', startedAt: '2026-08-17T20:54:42Z', mtime: 1 };
const detailOf = (state) => ({
  state: { id: DETAIL_ROW.id, title: 'Fix it', status: 'done', startedAt: DETAIL_ROW.startedAt, stepper: null, steps: [], subAgents: [], totalCostUsd: 1, totalActiveMs: 60000, branch: null, prompt: 'x', ...state },
  results: null, overview: null, clarify: { questions: [], answers: [] }, reviews: [], stepQuestions: [], artifacts: [], auditMarkdown: '# saved',
});

async function detailMeta(state) {
  const detail = detailOf(state);
  const ctx = await boot({ fetchHandler: (u) => {
    if (u.endsWith('/api/history/pr')) return ok({ ok: true });
    if (u.endsWith('/diff')) return fail(404, { error: 'no diff' });
    if (u.endsWith('/log')) return fail(404, { error: 'no log' });
    if (u.endsWith('/api/history')) return ok({ pipelines: [DETAIL_ROW], ghAvailable: false });
    if (u.endsWith(`/api/history/${KEY}/${DETAIL_ROW.id}`)) return ok(detail);
    return null;
  } });
  go(ctx.window, `history/${KEY}/${DETAIL_ROW.id}`);
  await settle(ctx.window, 8);
  return ctx.doc.querySelector('#hist-detail .hd-meta');
}

test('detail meta: "Started by <name>"; nothing for local or null', async () => {
  assert.equal((await detailMeta({ startedBy: 'ada@example.com' })).querySelector('.hd-by').textContent, 'Started by ada@example.com');
  assert.equal((await detailMeta({ startedBy: 'local' })).querySelector('.hd-by'), null);
  assert.equal((await detailMeta({ startedBy: null })).querySelector('.hd-by'), null);
});

test('detail meta: a scheduled run says who scheduled it', async () => {
  const meta = await detailMeta({ startedBy: 'ada@example.com', scheduledFor: '2026-08-18T02:00:00Z', scheduleId: null });
  assert.equal(meta.querySelector('.hd-sched').textContent, 'Started by schedule');
  assert.equal(meta.querySelector('.hd-by').textContent, 'Scheduled by ada@example.com');
});
