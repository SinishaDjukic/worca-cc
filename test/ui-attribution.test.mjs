// test/ui-attribution.test.mjs
// Attribution in the UI (the server's identity.mjs). People are shown ONLY on a shared
// deployment (whoami.shared: a real per-person sign-in): "Signed in as" in the rail foot,
// an initials circle + "by <name>" / "by you" on run cards, History cards and sidebar rows,
// the person chip (full name) in both detail headers, "Paused by …" banners, and a
// "Started by" History filter. A local install or a one-person deployment shows none of it.
// Nothing shows for a null or 'local' identity, and every name is painted as text.
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

async function boot({ fetchHandler, whoami = null } = {}) {
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
    if (whoami && String(u).endsWith('/api/whoami')) return ok(whoami);
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

const ME = 'me@example.com';
const SHARED = { name: ME, source: 'access', shared: true };
const SOLO = { name: 'Solo Operator', source: 'operator', shared: false };

// ── "Signed in as" ─────────────────────────────────────────────────────────────

test('rail foot: "Signed in as <name>" on a shared deployment, fetched once at boot', async () => {
  const { doc, calls } = await boot({ whoami: SHARED });
  const box = doc.getElementById('side-who');
  assert.equal(box.hidden, false);
  assert.equal(box.textContent.replace(/\s+/g, ' ').trim(), `Signed in as ${ME}`);
  assert.equal(calls.filter((u) => u.endsWith('/api/whoami')).length, 1);
});

test('rail foot: hidden locally, for a one-person deployment, on "local", and when the call fails', async () => {
  for (const handler of [
    (u) => (u.endsWith('/api/whoami') ? ok({ name: null, source: 'local', shared: false }) : null),
    (u) => (u.endsWith('/api/whoami') ? ok(SOLO) : null),
    (u) => (u.endsWith('/api/whoami') ? ok({ name: 'ada@example.com', source: 'access' }) : null),   // an older server: no `shared`
    (u) => (u.endsWith('/api/whoami') ? fail(500, {}) : null),
    null,
  ]) {
    const { doc } = await boot({ fetchHandler: handler || undefined });
    assert.equal(doc.getElementById('side-who').hidden, true);
  }
});

test('rail foot: a name is painted as text, never markup', async () => {
  const { doc } = await boot({ whoami: { name: '<img src=x onerror=alert(1)>', source: 'header', shared: true } });
  const name = doc.querySelector('#side-who .side-who-name');
  assert.equal(name.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(name.querySelector('img'), null);
});

// ── History cards + the "Started by" filter ─────────────────────────────────────

const ROW = (over = {}) => ({
  id: 'a1', title: 'Alpha one', status: 'done', startedAt: '2026-06-01T00:00:00Z',
  projectName: 'Alpha', projectKey: 'alpha-00000001', projectDir: '/x/alpha', ...over,
});

async function history(rows, whoami = SHARED) {
  const ctx = await boot({ whoami, fetchHandler: (u) => {
    if (u.endsWith('/api/history/pr')) return ok({ ok: true });
    if (u.endsWith('/api/history')) return ok({ pipelines: rows, ghAvailable: false });
    return null;
  } });
  go(ctx.window, 'history');
  await settle(ctx.window, 6);
  return ctx;
}
const cardsOf = (ctx) => [...ctx.doc.querySelectorAll('#history .hist-card')];

test('History card: initials + "by <name>" / "by you" on a shared deployment; nothing for null or local', async () => {
  const ctx = await history([
    ROW({ id: 'a4', startedBy: 'ada.lovelace@example.com' }),
    ROW({ id: 'a3', startedBy: ME }),
    ROW({ id: 'a2', startedBy: 'local' }),
    ROW({ id: 'a1', startedBy: null }),
  ]);
  const cards = cardsOf(ctx);
  assert.equal(cards.length, 4);
  const seg = (c) => c.querySelector('.hist-by-seg');
  assert.equal(cards[0].querySelector('.hist-by').textContent, 'by ada.lovelace@example.com');
  assert.equal(cards[0].querySelector('.hist-by').title, 'Started by ada.lovelace@example.com');
  assert.equal(seg(cards[0]).querySelector('.person-ini').textContent, 'AL');
  assert.equal(cards[1].querySelector('.hist-by').textContent, 'by you');
  assert.equal(cards[1].querySelector('.hist-by').title, `Started by ${ME}`, 'the tooltip keeps the full name');
  assert.equal(seg(cards[2]).hidden, true, "'local' is nobody in particular");
  assert.equal(seg(cards[3]).hidden, true, 'a run from before attribution');
});

test('History card: a one-person or local deployment shows no people at all', async () => {
  for (const whoami of [SOLO, { name: null, source: 'local', shared: false }]) {
    const ctx = await history([ROW({ id: 'a2', startedBy: 'ada@example.com' }), ROW({ id: 'a1', startedBy: 'Solo Operator' })], whoami);
    for (const c of cardsOf(ctx)) {
      assert.equal(c.querySelector('.hist-by-seg').hidden, true);
      assert.equal(c.querySelector('.person-ini'), null);
    }
    assert.equal(ctx.doc.querySelectorAll('#historyFilter .hist-pill.person').length, 0, 'no Started by filter');
  }
});

test('History filter: "Started by" pills, you first; one filters, again clears; combines with the project', async () => {
  const ctx = await history([
    ROW({ id: 'b3', startedBy: 'ada@example.com', projectKey: 'beta-00000002', projectName: 'Beta', projectDir: '/x/beta' }),
    ROW({ id: 'a3', startedBy: 'ada@example.com' }),
    ROW({ id: 'a2', startedBy: 'grace@example.com' }),
    ROW({ id: 'a1', startedBy: ME }),
  ]);
  const pills = () => [...ctx.doc.querySelectorAll('#historyFilter .hist-pill.person')];
  assert.deepEqual(pills().map((b) => b.textContent.replace(/\s+/g, ' ').trim()), ['Myou 1', 'Aada@example.com 2', 'Ggrace@example.com 1']);
  pills()[1].dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
  await settle(ctx.window);
  assert.deepEqual(cardsOf(ctx).map((c) => c.querySelector('.hist-by').textContent), ['by ada@example.com', 'by ada@example.com']);
  assert.equal(pills()[1].getAttribute('aria-pressed'), 'true');
  // + the project filter
  ctx.doc.querySelector('#historyFilter .hist-pill[data-project-key="alpha-00000001"]').dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
  await settle(ctx.window);
  assert.equal(cardsOf(ctx).length, 1);
  // clicking the active person pill again shows everyone (on Alpha)
  pills()[1].dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
  await settle(ctx.window);
  assert.equal(cardsOf(ctx).length, 3);
});

// ── live run cards, sidebar rows ────────────────────────────────────────────────

const RUN_ID = 'run-aaa';
function hello(ctx, extra = {}) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [{ runId: RUN_ID, title: 'Demo run', projectDir: '/tmp/p', status: 'running', startedAt: '2026-01-01T00:00:00Z', ...extra }] });
  go(ctx.window, 'running');
}
const card = (ctx) => ctx.doc.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);

test('run card: initials + "by <name>" from the state snapshot, hidden until then', async () => {
  const ctx = await boot({ whoami: SHARED });
  hello(ctx);
  await settle(ctx.window);
  const by = card(ctx).querySelector('.rc-by');
  assert.equal(by.hidden, true, 'unknown yet');
  assert.match(card(ctx).querySelector('.rm-text').textContent, /^started \d\d:\d\d:\d\d$/, 'the started segment is unchanged');
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running', startedBy: 'ada@example.com' });
  await settle(ctx.window);
  assert.equal(by.hidden, false);
  assert.equal(by.querySelector('.rc-by-text').textContent, 'by ada@example.com');
  assert.equal(by.querySelector('.person-ini').textContent, 'A');
  assert.equal(by.title, 'Started by ada@example.com');
});

test('run card: "by you" for the viewer\'s own run; local and not-shared stay hidden', async () => {
  const ctx = await boot({ whoami: SHARED });
  hello(ctx, { startedBy: 'ME@example.com' });
  await settle(ctx.window);
  assert.equal(card(ctx).querySelector('.rc-by-text').textContent, 'by you', 'case-insensitive');

  const local = await boot({ whoami: SHARED });
  hello(local, { startedBy: 'local' });
  await settle(local.window);
  assert.equal(card(local).querySelector('.rc-by').hidden, true);

  const solo = await boot({ whoami: SOLO });
  hello(solo, { startedBy: 'grace@example.com' });
  await settle(solo.window);
  assert.equal(card(solo).querySelector('.rc-by').hidden, true);
});

test('sidebar row: just the initials with a tooltip, shared deployments only', async () => {
  const ctx = await boot({ whoami: SHARED });
  hello(ctx, { startedBy: 'grace.hopper@example.com' });
  await settle(ctx.window);
  const ini = ctx.doc.querySelector(`#nav-running-children [data-child-run-id="${RUN_ID}"] .child-by`);
  assert.ok(ini);
  assert.equal(ini.textContent, 'GH');
  assert.equal(ini.title, 'Started by grace.hopper@example.com');

  const solo = await boot({ whoami: SOLO });
  hello(solo, { startedBy: 'grace.hopper@example.com' });
  await settle(solo.window);
  assert.equal(solo.doc.querySelector(`#nav-running-children .child-by`), null);
});

// ── live run detail: the person chip ────────────────────────────────────────────

async function runDetail(extra, whoami = SHARED) {
  const ctx = await boot({ whoami });
  hello(ctx, extra);
  go(ctx.window, `running/${RUN_ID}`);
  await settle(ctx.window, 8);
  return ctx;
}

test('live run detail: a person chip beside the status pill with the full name, never "you"', async () => {
  const ctx = await runDetail({ startedBy: 'ada.lovelace@example.com' });
  const chip = ctx.doc.querySelector('.rd-row1 .person-chip');
  assert.ok(chip);
  assert.equal(chip.nextElementSibling.classList.contains('rd-status'), true, 'right beside the status pill');
  assert.equal(chip.querySelector('.person-ini').textContent, 'AL');
  assert.equal(chip.querySelector('.person-chip-name').textContent, 'ada.lovelace@example.com');
  assert.equal(chip.title, 'Started by ada.lovelace@example.com');
  assert.doesNotMatch(ctx.doc.querySelector('.rd-meta').textContent, /\bby\b/, 'the meta line no longer repeats it');

  const own = await runDetail({ startedBy: ME });
  assert.equal(own.doc.querySelector('.rd-row1 .person-chip-name').textContent, ME, 'the full name, even for the viewer');
  assert.equal((await runDetail({ startedBy: 'local' })).doc.querySelector('.rd-row1 .person-chip'), null);
  assert.equal((await runDetail({ startedBy: 'ada@example.com' }, SOLO)).doc.querySelector('.rd-row1 .person-chip'), null);
});

test('run detail banner: "Paused by <name>" / "Paused by you" / "Stopped by <name>" when shared; plain otherwise', async () => {
  const copyOf = async (extra, whoami = SHARED) => {
    const ctx = await runDetail(extra, whoami);
    // The state banner lives on the Overview tab.
    const tab = [...ctx.doc.querySelectorAll('.rd-tab')].find((b) => /overview/i.test(b.dataset.sec || b.textContent));
    if (tab) tab.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
    await settle(ctx.window, 8);
    return ctx.doc.querySelector('.rd-ov-copy')?.textContent || '';
  };
  const at = '2026-01-01T00:00:00Z';
  assert.match(await copyOf({ status: 'paused', lastAction: { kind: 'pause', by: 'grace@example.com', at } }), /^Paused by grace@example\.com\. Agents in flight/);
  assert.match(await copyOf({ status: 'paused', lastAction: { kind: 'pause', by: ME, at } }), /^Paused by you\. /);
  assert.match(await copyOf({ status: 'paused', lastAction: { kind: 'pause', by: 'local', at } }), /^Paused\. Agents in flight/);
  assert.match(await copyOf({ status: 'paused' }), /^Paused\. /);
  assert.match(await copyOf({ status: 'stopped', lastAction: { kind: 'stop', by: 'ada@example.com', at } }), /^Stopped by ada@example\.com\./);
  assert.match(await copyOf({ status: 'paused', lastAction: { kind: 'pause', by: 'grace@example.com', at } }, SOLO), /^Paused\. /, 'not shared: nobody named');
});

// ── History detail: the person chip ─────────────────────────────────────────────

const KEY = 'proj-alpha-abcd1234';
const DETAIL_ROW = { id: 'fcec04e8', projectKey: KEY, projectName: 'Alpha', projectDir: '/tmp/proj', title: 'Fix it', status: 'done', startedAt: '2026-08-17T20:54:42Z', mtime: 1 };
const detailOf = (state) => ({
  state: { id: DETAIL_ROW.id, title: 'Fix it', status: 'done', startedAt: DETAIL_ROW.startedAt, stepper: null, steps: [], subAgents: [], totalCostUsd: 1, totalActiveMs: 60000, branch: null, prompt: 'x', ...state },
  results: null, overview: null, clarify: { questions: [], answers: [] }, reviews: [], stepQuestions: [], artifacts: [], auditMarkdown: '# saved',
});

async function detailRow2(state, whoami = SHARED) {
  const detail = detailOf(state);
  const ctx = await boot({ whoami, fetchHandler: (u) => {
    if (u.endsWith('/api/history/pr')) return ok({ ok: true });
    if (u.endsWith('/diff')) return fail(404, { error: 'no diff' });
    if (u.endsWith('/log')) return fail(404, { error: 'no log' });
    if (u.endsWith('/api/history')) return ok({ pipelines: [DETAIL_ROW], ghAvailable: false });
    if (u.endsWith(`/api/history/${KEY}/${DETAIL_ROW.id}`)) return ok(detail);
    return null;
  } });
  go(ctx.window, `history/${KEY}/${DETAIL_ROW.id}`);
  await settle(ctx.window, 8);
  return ctx.doc.querySelector('#hist-detail .hd-row2');
}

test('History detail: the person chip at the end of the status row; nothing for local, null or not shared', async () => {
  const row = await detailRow2({ startedBy: 'ada@example.com' });
  const chips = row.querySelectorAll('.person-chip');
  assert.equal(chips.length, 1, 'painted once');
  assert.equal(chips[0].querySelector('.person-chip-name').textContent, 'ada@example.com');
  assert.equal(chips[0].title, 'Started by ada@example.com');
  assert.equal(row.querySelector('.hd-by'), null, 'no meta text repeating it');
  assert.equal((await detailRow2({ startedBy: 'local' })).querySelector('.person-chip'), null);
  assert.equal((await detailRow2({ startedBy: null })).querySelector('.person-chip'), null);
  assert.equal((await detailRow2({ startedBy: 'ada@example.com' }, SOLO)).querySelector('.person-chip'), null);
});

test('History detail: a scheduled run\'s chip says who scheduled it', async () => {
  const row = await detailRow2({ startedBy: 'ada@example.com', scheduledFor: '2026-08-18T02:00:00Z', scheduleId: null });
  assert.equal(row.querySelector('.hd-sched').textContent, 'Started by schedule');
  assert.equal(row.querySelector('.person-chip').title, 'Scheduled by ada@example.com');
});

// ── History Clarify: who answered (step 3) ───────────────────────────────────────

async function clarifySec(extra, whoami = SHARED) {
  const detail = { ...detailOf({}), ...extra };
  const ctx = await boot({ whoami, fetchHandler: (u) => {
    if (u.endsWith('/api/history/pr')) return ok({ ok: true });
    if (u.endsWith('/diff')) return fail(404, { error: 'no diff' });
    if (u.endsWith('/log')) return fail(404, { error: 'no log' });
    if (u.endsWith('/api/history')) return ok({ pipelines: [DETAIL_ROW], ghAvailable: false });
    if (u.endsWith(`/api/history/${KEY}/${DETAIL_ROW.id}`)) return ok(detail);
    return null;
  } });
  go(ctx.window, `history/${KEY}/${DETAIL_ROW.id}`);
  await settle(ctx.window, 8);
  const tab = ctx.doc.querySelector('#hist-detail [data-tab="clarify"], #hist-detail .hd-tab[data-sec="clarify"]');
  if (tab) { tab.click(); await settle(ctx.window, 4); }
  return ctx.doc.querySelector('#hist-detail .hd-sec[data-sec="clarify"]');
}

test('History Clarify: "answered by <name>" under the answers, "you" for yourself, nothing when not shared', async () => {
  const Q = [{ id: 'q1', question: 'Which DB?', options: ['sqlite', 'pg'] }];
  const A = [{ id: 'q1', question: 'Which DB?', choice: 'pg' }];
  const clar = (answeredBy) => ({ clarify: { questions: Q, answers: A, ...(answeredBy ? { answeredBy } : {}) } });
  const sec = await clarifySec(clar('grace@example.com'));
  assert.ok(sec, 'the Clarify section');
  assert.equal(sec.querySelector('.hd-cl-by')?.textContent, 'answered by grace@example.com');
  assert.equal(sec.querySelector('.hd-cl-by').title, 'Answered by grace@example.com');
  assert.equal((await clarifySec(clar(ME))).querySelector('.hd-cl-by')?.textContent, 'answered by you');
  assert.equal((await clarifySec(clar('local'))).querySelector('.hd-cl-by'), null);
  assert.equal((await clarifySec(clar(null))).querySelector('.hd-cl-by'), null);
  assert.equal((await clarifySec(clar('grace@example.com'), SOLO)).querySelector('.hd-cl-by'), null, 'not shared: nobody named');
  const step = await clarifySec({ stepQuestions: [{ stepKey: 'x:n_plan:1', round: 1, nodeId: 'n_plan', agentKey: 'planner', questions: Q, answers: A, answeredBy: 'ada via Slack' }] });
  assert.equal(step.querySelector('.hd-cl-by')?.textContent, 'answered by ada via Slack');
});

// ── Schedules: created by / changed by (step 4) ──────────────────────────────────

const SUMMARY = { target: 'project', workflowId: 'wf_default', guardrailsId: null, prompt: 'x', source: null, sourceBranch: null, featureBranch: null, memoryScope: null, mock: false, extras: 0 };
const IN_AN_HOUR = new Date(Date.now() + 3600_000).toISOString();
const SCHED = {
  schedules: [{ id: 'sch_00000001', kind: 'recurring', title: 'Nightly', projectDir: '/x/alpha', workspaceId: null, rule: { freq: 'daily', interval: 1, time: '02:00', tz: 'UTC' },
    sentence: 'Every day at 02:00', tz: 'UTC', overlap: 'skip', maxFailures: 3, failureStreak: 0, ifMissed: 'run', graceMin: 360, status: 'active', pauseReason: null,
    runsCount: 0, nextRunAt: IN_AN_HOUR, lastResult: null, createdBy: 'ada.lovelace@example.com', updatedBy: 'grace@example.com', summary: SUMMARY }],
  tickets: [
    { id: '11111111-2222-3333-4444-555555555555', kind: 'once', scheduleId: null, title: 'Mine', projectDir: '/x/alpha', workspaceId: null, runAt: IN_AN_HOUR, scheduledFor: IN_AN_HOUR, status: 'scheduled',
      ifMissed: 'run', graceMin: 360, attempts: 0, retryAt: null, queued: false, forced: false, ownerPid: null, pipelineId: null, failReason: null, createdBy: ME, updatedBy: ME, summary: SUMMARY },
    { id: '22222222-2222-3333-4444-555555555555', kind: 'once', scheduleId: null, title: 'Local', projectDir: '/x/alpha', workspaceId: null, runAt: IN_AN_HOUR, scheduledFor: IN_AN_HOUR, status: 'scheduled',
      ifMissed: 'run', graceMin: 360, attempts: 0, retryAt: null, queued: false, forced: false, ownerPid: null, pipelineId: null, failReason: null, createdBy: 'local', updatedBy: 'local', summary: SUMMARY },
  ],
  counts: { scheduled: 2, missed: 0, recurring: 1, unread: 0 }, defaults: { graceMin: 360, ifMissed: 'run', maxFailures: 3 },
};

async function schedules(whoami, tab) {
  const ctx = await boot({ whoami, fetchHandler: (u) => {
    if (u.includes('/api/notifications')) return ok({ notifications: [], unread: 0 });
    if (u.includes('/api/schedules')) return ok(SCHED);
    if (u.includes('/api/workspaces')) return ok({ workspaces: [] });
    return null;
  } });
  // The rows' icons parse SVG through a global DOMParser (schedules-view.mjs svgIcon).
  Object.defineProperty(globalThis, 'DOMParser', { value: ctx.window.DOMParser, configurable: true, writable: true });
  go(ctx.window, `schedules/${tab}`);
  await settle(ctx.window, 8);
  return ctx;
}
const cardBy = (ctx, title) => [...ctx.doc.querySelectorAll('.sched-item')].find((c) => c.querySelector('.rc-title')?.textContent === title);

test('Schedules: "by <creator>" with initials, "by you", nothing for local; Details name creator and changer', async () => {
  const rep = await schedules(SHARED, 'repeating');
  const nightly = cardBy(rep, 'Nightly');
  assert.ok(nightly, rep.doc.querySelector('#schedules-repeating')?.textContent);
  assert.equal(nightly.querySelector('.sched-by-text').textContent, 'by ada.lovelace@example.com');
  assert.equal(nightly.querySelector('.sched-by .person-ini').textContent, 'AL');
  assert.equal(nightly.querySelector('.sched-by').title, 'Created by ada.lovelace@example.com');
  const kv = Object.fromEntries([...nightly.querySelectorAll('.sched-kv')].map((r) => [r.querySelector('.sched-k').textContent, r.querySelector('.sched-v').textContent]));
  assert.equal(kv['Created by'], 'ada.lovelace@example.com');
  assert.equal(kv['Changed by'], 'grace@example.com');

  const once = await schedules(SHARED, 'once');
  assert.equal(cardBy(once, 'Mine').querySelector('.sched-by-text').textContent, 'by you');
  assert.equal(cardBy(once, 'Local').querySelector('.sched-by'), null);
});

test('Schedules: nobody is shown on a local or one-person deployment', async () => {
  for (const whoami of [SOLO, { name: null, source: 'local', shared: false }]) {
    const ctx = await schedules(whoami, 'repeating');
    const nightly = cardBy(ctx, 'Nightly');
    assert.equal(nightly.querySelector('.sched-by'), null);
    assert.equal([...nightly.querySelectorAll('.sched-k')].some((k) => /by$/.test(k.textContent)), false);
  }
});
