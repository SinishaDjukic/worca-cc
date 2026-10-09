// test/ui-attribution.test.mjs
// Attribution in the UI (the server's identity.mjs). People are shown ONLY on a shared
// deployment (whoami.shared: a real per-person sign-in): "Signed in as" in the account menu,
// an initials circle on sidebar rows (the compact Runs list rows carry no "by", D14),
// the person chip (full name) in both detail headers, "Paused by …" banners, and a
// "Started by" filter over the Runs list. A local install or a one-person deployment
// shows none of it (the account corner names a one-person deployment's operator, no more).
// Nothing shows for a null or 'local' identity, and every name is painted as text.
//
// boot() is a local copy of the jsdom harness in test/ui-running-card.test.mjs and
// test/ui-history-detail.test.mjs — the suites do not import each other.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const trackDom = useDomRelease(afterEach);

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const fail = (status, body) => Promise.resolve({ ok: false, status, json: async () => body });

async function boot({ fetchHandler, whoami = null } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  trackDom(dom);
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

// ── The account corner and "Signed in as" ───────────────────────────────────────

const corner = (doc) => {
  const b = doc.getElementById('side-acct');
  return { ava: b.querySelector('.acct-ava').textContent, name: b.querySelector('.acct-name').textContent, title: b.title, account: b.dataset.account,
    card: doc.getElementById('acct-id').hidden, label: b.getAttribute('aria-label') };
};

test('account corner: who is signed in, fetched once; an operator gets a name but no card; local, an older server and a failed call read Profile', async () => {
  await checkRows([
    { name: 'shared: initials + the name up to "@" in the corner, the full name in the tooltip and in "Signed in as"; one whoami fetch', run: async () => {
      const { doc, calls } = await boot({ whoami: SHARED });
      assert.deepEqual(corner(doc), { ava: 'M', name: 'me', title: ME, account: 'shared', card: false,
        label: `${ME}: spend, away mode, interface mode and settings` });
      const card = doc.getElementById('acct-id');
      assert.equal(card.textContent.replace(/\s+/g, ' ').trim(), `Signed in as ${ME} via Cloudflare Access`);
      assert.equal(calls.filter((u) => u.endsWith('/api/whoami')).length, 1);
    } },
    { name: 'operator-named (one person): initials + the name, no identity card, no people anywhere', run: async () => {
      const { doc } = await boot({ whoami: SOLO });
      assert.deepEqual(corner(doc), { ava: 'SO', name: 'Solo Operator', title: 'Solo Operator', account: 'operator', card: true,
        label: 'Solo Operator: spend, away mode, interface mode and settings' });
    } },
    { name: 'local, "local", an older server (no `shared`), a failed call, no answer: "P" and "Profile", no card', run: async () => {
      for (const handler of [
        (u) => (u.endsWith('/api/whoami') ? ok({ name: null, source: 'local', shared: false }) : null),
        (u) => (u.endsWith('/api/whoami') ? ok({ name: 'local', source: 'local', shared: false }) : null),
        (u) => (u.endsWith('/api/whoami') ? ok({ name: 'ada@example.com', source: 'access' }) : null),   // an older server: no `shared`
        (u) => (u.endsWith('/api/whoami') ? fail(500, {}) : null),
        null,
      ]) {
        const { doc } = await boot({ fetchHandler: handler || undefined });
        assert.deepEqual(corner(doc), { ava: 'P', name: 'Profile', title: 'Profile: spend, away mode, interface mode and settings', account: 'local', card: true,
          label: 'Profile: spend, away mode, interface mode and settings' });
      }
    } },
  ]);
});

test('account corner: a name is painted as text, never markup', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const { doc } = await boot({ whoami: { name: evil, source: 'header', shared: true } });
  assert.equal(doc.querySelector('#side-acct .acct-name').textContent, evil);
  assert.equal(doc.querySelector('#acct-id .id-name').textContent, evil);
  assert.equal(doc.querySelector('#acct-id .id-via').textContent, 'via your sign-in proxy');
  assert.equal(doc.querySelector('#side-acct img, #acct-id img'), null);
});

// ── The "Started by" filter over the Runs list ───────────────────────────────────

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
  go(ctx.window, 'runs');                 // nothing remembered at boot: the bare list
  await settle(ctx.window, 6);
  return ctx;
}
// The listed finished runs, by pipeline id (group copies only: Needs you repeats rows).
const rowIds = (ctx) => [...ctx.doc.querySelectorAll('#runs-list .runs-row[data-slot="group"][data-kind="hist"]')]
  .map((r) => r.dataset.pipelineId).sort();

test('Runs list: Started-by pills filter every group (you first, again clears); none on a solo/local deployment', async () => {
  await checkRows([
    { name: 'Runs list: a one-person or local deployment shows no Started-by filter', run: async () => {
      for (const whoami of [SOLO, { name: null, source: 'local', shared: false }]) {
        const ctx = await history([ROW({ id: 'a2', startedBy: 'ada@example.com' }), ROW({ id: 'a1', startedBy: 'Solo Operator' })], whoami);
        assert.deepEqual(rowIds(ctx), ['a1', 'a2'], 'the runs are listed');
        assert.equal(ctx.doc.querySelectorAll('#historyFilter .hist-pill.person').length, 0, 'no Started by filter');
      }
    } },
    { name: 'Runs filter: "Started by" pills, you first; one filters every group, again clears', run: async () => {
      const ctx = await history([
        ROW({ id: 'b3', startedBy: 'ada@example.com', projectKey: 'beta-00000002', projectName: 'Beta', projectDir: '/x/beta' }),
        ROW({ id: 'a3', startedBy: 'ada@example.com' }),
        ROW({ id: 'a2', startedBy: 'grace@example.com' }),
        ROW({ id: 'a1', startedBy: ME }),
      ]);
      const pills = () => [...ctx.doc.querySelectorAll('#historyFilter .hist-pill.person')];
      assert.deepEqual(pills().map((b) => b.textContent.replace(/\s+/g, ' ').trim()), ['Myou 1', 'Aada@example.com 2', 'Ggrace@example.com 1']);
      assert.deepEqual(rowIds(ctx), ['a1', 'a2', 'a3', 'b3']);
      pills()[1].dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
      await settle(ctx.window);
      assert.deepEqual(rowIds(ctx), ['a3', 'b3'], "only ada's runs, in both projects");
      assert.equal(pills()[1].getAttribute('aria-pressed'), 'true');
      // clicking the active person pill again shows everyone
      pills()[1].dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
      await settle(ctx.window);
      assert.deepEqual(rowIds(ctx), ['a1', 'a2', 'a3', 'b3']);
      assert.equal(pills()[1].getAttribute('aria-pressed'), 'false');
    } },
  ]);
});

// ── History detail ──────────────────────────────────────────────────────────────

const KEY = 'proj-alpha-abcd1234';
const DETAIL_ROW = { id: 'fcec04e8', projectKey: KEY, projectName: 'Alpha', projectDir: '/tmp/proj', title: 'Fix it', status: 'done', startedAt: '2026-08-17T20:54:42Z', mtime: 1 };
const detailOf = (state) => ({
  state: { id: DETAIL_ROW.id, title: 'Fix it', status: 'done', startedAt: DETAIL_ROW.startedAt, stepper: null, steps: [], subAgents: [], totalCostUsd: 1, totalActiveMs: 60000, branch: null, prompt: 'x', ...state },
  results: null, overview: null, clarify: { questions: [], answers: [] }, reviews: [], stepQuestions: [], artifacts: [], auditMarkdown: '# saved',
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

test('History Clarify attribution: answered by <name>/you/nobody, and Away mode answers say so with reason and \'please check\'', async () => {
  await checkRows([
    { name: 'History Clarify: "answered by <name>" under the answers, "you" for yourself, nothing when not shared', run: async () => {
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
    } },
    { name: 'History Clarify: an Away mode answer says so, solo or shared, with its reason and "please check"', run: async () => {
      const Q = [{ id: 'q1', question: 'Which DB?', options: ['sqlite', 'pg'] }, { id: 'q2', question: 'Cache?', options: ['yes', 'no'] }];
      const A = [{ id: 'q1', question: 'Which DB?', choice: 'pg' }, { id: 'q2', question: 'Cache?', choice: 'no' }];
      const night = { strategy: 'weights', flagged: true, questions: [
        { id: 'q1', choice: 'pg', rationale: 'the agent recommended this at 80%, well ahead of the next option', flagged: false },
        { id: 'q2', choice: 'no', rationale: 'the agent was not sure enough; first option taken', flagged: true },
      ] };
      for (const who of [SOLO, SHARED]) {
        const sec = await clarifySec({ clarify: { questions: Q, answers: A, answeredBy: 'night-mode', night } }, who);
        assert.equal(sec.querySelector('.hd-cl-by')?.textContent, 'Answered by Away mode · please check');
        const why = [...sec.querySelectorAll('.hd-cl-away')].map((e) => e.textContent);
        assert.deepEqual(why, ['Away mode: the agent recommended this at 80%, well ahead of the next option.',
          'Away mode, please check: the agent was not sure enough; first option taken.']);
      }
      const step = await clarifySec({ stepQuestions: [{ stepKey: 'x:n_plan:1', round: 1, nodeId: 'n_plan', agentKey: 'planner', questions: Q.slice(0, 1), answers: A.slice(0, 1), answeredBy: 'night-mode', night: { flagged: false, questions: night.questions.slice(0, 1) } }] }, SOLO);
      assert.equal(step.querySelector('.hd-cl-by')?.textContent, 'Answered by Away mode');
    } },
  ]);
});

test('History run page Away-mode answers: section lists stored answers with check marks, a top note counts the ones to check, absent when none', async () => {
  await checkRows([
    { name: 'History run page: "Answered for you" lists the stored answers', run: async () => {
      const decisions = [
        { questionId: 'clarify-1', kind: 'clarify', choice: 'pg', strategy: 'weights', flagged: false, rationale: 'q1: the agent recommended this at 80%' },
        { questionId: 'gate-1', kind: 'gate', choice: 'another', strategy: 'rule', flagged: true, rationale: '2 critical issues left, one more fix round' },
      ];
      const ctx = await boot({ whoami: SOLO, fetchHandler: (u) => {
        if (u.includes('/api/night-decisions')) return ok({ decisions: u.includes(encodeURIComponent(DETAIL_ROW.id)) ? decisions : [] });
        if (u.endsWith('/api/history/pr')) return ok({ ok: true });
        if (u.endsWith('/diff')) return fail(404, { error: 'no diff' });
        if (u.endsWith('/log')) return fail(404, { error: 'no log' });
        if (u.endsWith('/api/history')) return ok({ pipelines: [DETAIL_ROW], ghAvailable: false });
        if (u.endsWith(`/api/history/${KEY}/${DETAIL_ROW.id}`)) return ok(detailOf({}));
        return null;
      } });
      go(ctx.window, `history/${KEY}/${DETAIL_ROW.id}`);
      await settle(ctx.window, 8);
      const sec = ctx.doc.querySelector('#hist-detail .rd-night-sec');
      assert.ok(sec && !sec.hidden, 'the section shows');
      assert.deepEqual([...sec.querySelectorAll('.rd-na .rd-slabel')].map((e) => e.textContent.split(' · ')[0]), ['Clarifying questions', 'Review loop']);
      const rows = [...sec.querySelectorAll('.rd-na-row')];
      assert.deepEqual(rows.map((r) => [r.querySelector('.rd-na-a').textContent, !!r.querySelector('.rd-na-check')]), [['pg', false], ['One more fix round', true]]);
    } },
    { name: 'History run page: a note at the top of the card says how many answers to check', run: async () => {
      const decisions = [
        { questionId: 'clarify-1', kind: 'clarify', choice: 'a | b', strategy: 'weights', flagged: true, questions: [{ id: 'q1', choice: 'a', flagged: false }, { id: 'q2', choice: 'b', flagged: true }] },
        { questionId: 'gate-1', kind: 'gate', choice: 'continue', strategy: 'rule', flagged: false },
      ];
      const note = await detailNote(decisions);
      assert.equal(note.hidden, false);
      assert.equal(note.querySelector('.rd-away-note-text').textContent, 'Away mode: 3 answers while you were away — 1 to check.');
      assert.equal(note.querySelector('button').textContent, 'See the answers');
      assert.equal((await detailNote([])).hidden, true);
    } },
    { name: 'History run page: no Away mode answers, no section', run: async () => {
      const ctx = await boot({ whoami: SOLO, fetchHandler: (u) => {
        if (u.includes('/api/night-decisions')) return ok({ decisions: [] });
        if (u.endsWith('/api/history/pr')) return ok({ ok: true });
        if (u.endsWith('/diff')) return fail(404, { error: 'no diff' });
        if (u.endsWith('/log')) return fail(404, { error: 'no log' });
        if (u.endsWith('/api/history')) return ok({ pipelines: [DETAIL_ROW], ghAvailable: false });
        if (u.endsWith(`/api/history/${KEY}/${DETAIL_ROW.id}`)) return ok(detailOf({}));
        return null;
      } });
      go(ctx.window, `history/${KEY}/${DETAIL_ROW.id}`);
      await settle(ctx.window, 8);
      assert.equal(ctx.doc.querySelector('#hist-detail .rd-night-sec').hidden, true);
    } },
  ]);
});

async function detailNote(decisions) {
  const ctx = await boot({ whoami: SOLO, fetchHandler: (u) => {
    if (u.includes('/api/night-decisions')) return ok({ decisions });
    if (u.endsWith('/api/history/pr')) return ok({ ok: true });
    if (u.endsWith('/diff')) return fail(404, { error: 'no diff' });
    if (u.endsWith('/log')) return fail(404, { error: 'no log' });
    if (u.endsWith('/api/history')) return ok({ pipelines: [DETAIL_ROW], ghAvailable: false });
    if (u.endsWith(`/api/history/${KEY}/${DETAIL_ROW.id}`)) return ok(detailOf({}));
    return null;
  } });
  go(ctx.window, `history/${KEY}/${DETAIL_ROW.id}`);
  await settle(ctx.window, 8);
  return ctx.doc.querySelector('#hist-detail .rd-sheet .rd-away-note');
}

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

test('Schedules: \'by <creator>\' with Created/Changed by on a shared deployment, nobody on local/solo', async () => {
  await checkRows([
    { name: 'Schedules: "by <creator>" with initials, "by you", nothing for local; Details name creator and changer', run: async () => {
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
    } },
    { name: 'Schedules: nobody is shown on a local or one-person deployment', run: async () => {
      for (const whoami of [SOLO, { name: null, source: 'local', shared: false }]) {
        const ctx = await schedules(whoami, 'repeating');
        const nightly = cardBy(ctx, 'Nightly');
        assert.equal(nightly.querySelector('.sched-by'), null);
        assert.equal([...nightly.querySelectorAll('.sched-k')].some((k) => /by$/.test(k.textContent)), false);
      }
    } },
  ]);
});
