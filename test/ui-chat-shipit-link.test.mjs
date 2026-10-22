// test/ui-chat-shipit-link.test.mjs — worca Chat P2 Task 9: the pull-request card opens the SAME Ship it dialog the
// History page opens, over the chat; its /api/pr body carries the card's ask link; the opener settles when the dialog
// closes; and a success never paints another run's History detail (Review Focus 5).
// boot()/settle()/go() and the history arms are a local copy of test/ui-history-shipit.test.mjs (suites never import each other).
// After P1 the app boots on Chat (U5): the page asks /api/ask/models, /api/ask/threads?limit=50 and POST /api/ask/mcp-preview
// at once (P6 adds more home fetches). This suite answers /api/ask/threads with an empty list and every other /api/ask/* with a 404 — P1 pins that a boot on Chat survives that —
// and never asserts a fetch count, so later boot fetches cannot break it.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const extensionsUrl = new URL('../ui/public/chat/extensions.mjs', import.meta.url).href;   // the instance app.js registers into

async function boot({ fetchHandler, url = 'http://localhost:4317/' } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url }));
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
    calls.push({ url: String(u), opts: opts || {} });
    const r = fetchHandler && fetchHandler(String(u), opts || {});
    if (r) return r;
    if (String(u).includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: '/tmp/proj', exists: true }] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only global */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window, calls, wsBox };
}
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const go = (window, hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); };
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

const KEY = 'proj-alpha-abcd1234';
const ROW = (id, title) => ({ id, projectKey: KEY, projectName: 'Alpha', projectDir: '/tmp/proj', title, status: 'done',
  startedAt: '2026-08-17T20:54:42Z', branch: `worca-cc/${id}`, sourceBranch: 'feat/log-ux', survived: true, added: 12, removed: 3,
  totalCostUsd: 1, totalActiveMs: 1000, mtime: 1, pauseReason: null, retainedWork: null, pr: null });
const DETAIL = (id, title) => ({ state: { id, title, status: 'done', startedAt: '2026-08-17T20:54:42Z', stepper: null, steps: [], subAgents: [],
  totalCostUsd: 1, totalActiveMs: 1000, branch: { source: 'feat/log-ux', feature: `worca-cc/${id}`, worktreeDir: '/tmp/wt' }, prompt: 'x' },
  results: null, overview: null, clarify: { questions: [], answers: [] }, reviews: [], stepQuestions: [], artifacts: [], auditMarkdown: '# saved' });
const remote = (name, owner, url) => ({ name, fetchUrl: url, pushUrl: url, host: 'github.com', owner, repo: 'repo', slug: `${owner}/repo` });
const REMOTES = { ok: true, remotes: [remote('origin', 'me', 'https://github.com/me/repo.git')], defaults: { pushRemote: 'origin', baseRemote: 'origin' },
  remembered: null, chain: ['feat/log-ux'], defaultBase: 'feat/log-ux', branches: { origin: ['feat/log-ux', 'main'] } };
const A = 'aaaa0001'; const B = 'bbbb0002';
const budget = { pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'monthly', windowStartMs: 0, windowEndMs: Date.now() + 1e9, msUntilReset: 1e9, windowSpendUsd: 0, allTimeSpendUsd: 0, remainingUsd: 50, blocked: false };
/** History arms, most specific first (ui-history-shipit.test.mjs's order rule). */
const arms = (url, opts) => {
  if (url.includes('/api/ask/threads')) return ok({ threads: [] });                                    // the Chat page's history list (review P2-8)
  if (url.includes('/api/ask/')) return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'not in this suite' }) });   // the Chat boot page's other fetches
  if (/\/api\/pr\/remotes\?/.test(url)) return ok(REMOTES);
  if (url.endsWith('/api/pr') && opts.method === 'POST') return ok({ ok: true, url: 'https://x/pull/7', mergeable: 'MERGEABLE', existed: false });
  if (url.endsWith('/api/history/pr')) return ok({ ok: true });
  if (url.endsWith('/diff') || url.endsWith('/log')) return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'no' }) });
  if (url.endsWith('/api/history')) return ok({ pipelines: [ROW(A, 'Run A'), ROW(B, 'Run B')], ghAvailable: true });
  if (url.endsWith(`/api/history/${KEY}/${A}`)) return ok(DETAIL(A, 'Run A'));
  if (url.endsWith(`/api/history/${KEY}/${B}`)) return ok(DETAIL(B, 'Run B'));
  if (url.endsWith('/api/budget')) return ok(budget);
  return null;
};
const modalOf = (w) => w.document.querySelector('#shipit-modal');
const prPosts = (ctx) => ctx.calls.filter((c) => c.url.endsWith('/api/pr') && c.opts.method === 'POST');
/** The registered pull-request card for run `id`, built into the page with a minimal card ctx whose openShipIt does what
 *  P1's does — call chatDeps.openShipIt at call time (window.__np.chat.deps is P1's test hook onto chatDeps). */
async function prCard(window, id, said) {
  const { chatCardBuilder } = await import(extensionsUrl);
  const block = { kind: 'card', id: 'card_0000aaaa', state: 'proposed', card: { type: 'pull-request', pipelineId: id, projectKey: KEY, title: `Run ${id}`, branch: `worca-cc/${id}`, base: 'feat/log-ux' } };
  const { el } = chatCardBuilder('pull-request')(block, { doc: window.document, win: window, threadId: () => 'ask_aaaaaaaa', postCard: async () => ({}), announce: (t) => said.push(t),
    openShipIt: (ref, link) => window.__np.chat.deps.openShipIt(ref, link) });
  window.document.body.appendChild(el);
  return el;
}

test('the pull-request card opens Ship it over the chat; the PR body carries the ask link; the opener settles {opened, url} on close', async () => {
  const ctx = await boot({ fetchHandler: arms });
  const said = [];
  const el = await prCard(ctx.window, A, said);
  click(ctx.window, el.querySelector('[data-chat-pr-create]'));
  await settle(10);
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), false, 'the History dialog, opened from the chat');
  click(ctx.window, modalOf(ctx.window).querySelector('.shipit-ok'));
  await settle(10);
  assert.deepEqual(JSON.parse(prPosts(ctx)[0].opts.body),
    { projectDir: '/tmp/proj', projectKey: KEY, id: A, askThreadId: 'ask_aaaaaaaa', askCardId: 'card_0000aaaa', pushRemote: 'origin', baseRemote: 'origin', baseBranch: 'feat/log-ux' });
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), true);
  assert.deepEqual(said, ['Pull request opened'], 'the opener resolved {opened:true}');
  assert.equal(el.querySelector('[data-chat-pr-create]').disabled, true);
});

test('closing Ship it without a PR settles {opened:false}: the card offers Create again', async () => {
  const ctx = await boot({ fetchHandler: arms });
  const el = await prCard(ctx.window, A, []);
  click(ctx.window, el.querySelector('[data-chat-pr-create]'));
  await settle(10);
  assert.equal(el.querySelector('[data-chat-pr-create]').disabled, true, 'while the dialog is open');
  click(ctx.window, modalOf(ctx.window).querySelector('.shipit-cancel'));
  await settle(4);
  assert.equal(el.querySelector('[data-chat-pr-create]').disabled, false);
  assert.equal(ctx.window.document.activeElement, el.querySelector('[data-chat-pr-create]'), 'the focus comes back to Create');
  assert.equal(prPosts(ctx).length, 0);
});

test('a run History does not know: the card says so and nothing opens', async () => {
  const ctx = await boot({ fetchHandler: arms });
  const el = await prCard(ctx.window, 'ffff0000', []);
  click(ctx.window, el.querySelector('[data-chat-pr-create]'));
  await settle(10);
  assert.equal(el.querySelector('.ask-card-err').textContent, 'This run is not in History yet.');
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), true);
});

test('a ship from the chat never paints another run\'s open History detail (Review Focus 5)', async () => {
  const ctx = await boot({ fetchHandler: arms });
  go(ctx.window, `history/${KEY}/${A}`);
  await settle(10);
  const hdPr = () => ctx.window.document.querySelector('#hist-detail .hd-pr');
  assert.equal(hdPr().hidden, false, 'run A offers Create PR');
  const el = await prCard(ctx.window, B, []);
  click(ctx.window, el.querySelector('[data-chat-pr-create]'));
  await settle(10);
  click(ctx.window, modalOf(ctx.window).querySelector('.shipit-ok'));
  await settle(10);
  assert.equal(JSON.parse(prPosts(ctx)[0].opts.body).id, B);
  assert.equal(hdPr().hidden, false, 'run A still offers Create PR — B\'s PR was not painted onto A');
});

test('History\'s own Create PR sends no ask link (the body is unchanged)', async () => {
  const ctx = await boot({ fetchHandler: arms });
  go(ctx.window, `history/${KEY}/${A}`);
  await settle(10);
  click(ctx.window, ctx.window.document.querySelector('#hist-detail .hd-pr'));
  await settle(10);
  click(ctx.window, modalOf(ctx.window).querySelector('.shipit-ok'));
  await settle(10);
  const body = JSON.parse(prPosts(ctx)[0].opts.body);
  assert.equal('askThreadId' in body, false); assert.equal('askCardId' in body, false);
});

test('a workspace run from the chat: every member PR carries the ask link; the opener settles {opened:true} when the dialog closes (mutation killer)', async () => {
  const WKS = 'workspaces/team-a'; const API = 'api-00000001'; const WEB = 'web-00000002';
  const member = (memberKey, name) => ({ memberKey, name, projectDir: `/tmp/${name}`, branch: `worca-cc/feat-${name}`, sourceBranch: 'main',
    survived: true, affected: true, added: 5, removed: 1, diffFrozen: true, pr: null });
  const wsRow = { ...ROW(A, 'Run A'), projectKey: WKS, target: 'workspace', workspaceName: 'Team A', members: [member(API, 'api'), member(WEB, 'web')] };
  const wsArms = (url, opts) => {
    if (url.endsWith('/api/history')) return ok({ pipelines: [wsRow], ghAvailable: true });
    if (url.endsWith(`/api/workspaces/team-a/runs/${A}`)) return ok({ ...DETAIL(A, 'Run A'), state: { ...DETAIL(A, 'Run A').state, target: 'workspace' } });
    if (url.endsWith('/api/pr/crosslink')) return ok({ ok: true, edited: [], failed: [] });
    if (url.endsWith('/api/pr') && opts.method === 'POST') {
      const b = JSON.parse(opts.body);
      return ok({ ok: true, url: `https://x/${b.memberKey}/pull/1`, mergeable: 'MERGEABLE', existed: false, memberKey: b.memberKey });
    }
    return arms(url, opts);
  };
  const ctx = await boot({ fetchHandler: wsArms });
  const said = [];
  const { chatCardBuilder } = await import(extensionsUrl);
  const block = { kind: 'card', id: 'card_0000bbbb', state: 'proposed', card: { type: 'pull-request', pipelineId: A, projectKey: WKS, workspaceId: 'team-a', title: 'Run A', branch: 'worca-cc/feat-api' } };
  const { el } = chatCardBuilder('pull-request')(block, { doc: ctx.window.document, win: ctx.window, threadId: () => 'ask_aaaaaaaa', postCard: async () => ({}), announce: (t) => said.push(t),
    openShipIt: (ref, link) => ctx.window.__np.chat.deps.openShipIt(ref, link) });
  ctx.window.document.body.appendChild(el);
  click(ctx.window, el.querySelector('[data-chat-pr-create]'));
  await settle(10);
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), false, 'the workspace dialog, opened from the chat');
  click(ctx.window, modalOf(ctx.window).querySelector('.shipit-ok'));
  await settle(12);
  assert.deepEqual(prPosts(ctx).map((c) => JSON.parse(c.opts.body)).map((b) => [b.memberKey, b.askThreadId, b.askCardId]),
    [[API, 'ask_aaaaaaaa', 'card_0000bbbb'], [WEB, 'ask_aaaaaaaa', 'card_0000bbbb']]);
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), true);
  assert.deepEqual(said, ['Pull request opened'], 'the opener resolved {opened:true}');
  assert.equal(el.querySelector('[data-chat-pr-create]').disabled, true);
});

test('Ship it already open (History\'s own): the card says so and offers Create again (mutation killer)', async () => {
  const ctx = await boot({ fetchHandler: arms });
  go(ctx.window, `history/${KEY}/${A}`);
  await settle(10);
  click(ctx.window, ctx.window.document.querySelector('#hist-detail .hd-pr'));
  await settle(10);
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), false);
  const el = await prCard(ctx.window, B, []);
  click(ctx.window, el.querySelector('[data-chat-pr-create]'));
  await settle(10);
  assert.equal(el.querySelector('.ask-card-err').textContent, 'The Create PR dialog is already open.');
  assert.equal(el.querySelector('[data-chat-pr-create]').disabled, false);
});

test('a run that got its pull request since the card was posted: the card says so and nothing opens (mutation killer)', async () => {
  const withPr = (url, opts) => (url.endsWith('/api/history')
    ? ok({ pipelines: [{ ...ROW(A, 'Run A'), pr: { state: 'OPEN', url: 'https://x/pull/1', number: 1 } }, ROW(B, 'Run B')], ghAvailable: true })
    : arms(url, opts));
  const ctx = await boot({ fetchHandler: withPr });
  const el = await prCard(ctx.window, A, []);
  click(ctx.window, el.querySelector('[data-chat-pr-create]'));
  await settle(10);
  assert.equal(el.querySelector('.ask-card-err').textContent, 'This run already has a pull request.');
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), true);
  assert.equal(prPosts(ctx).length, 0);
});

/** History's rows before its PR lookup lands: no `pr` key (the real /api/history sends none; history-pr frames fill it). */
const pendingArms = (url, opts) => {
  if (url.endsWith('/api/history')) {
    const { pr: _a, ...a } = ROW(A, 'Run A'); const { pr: _b, ...b } = ROW(B, 'Run B');
    return ok({ pipelines: [a, b], ghAvailable: true });
  }
  return arms(url, opts);
};
/** Deliver History's PR lookup for run A (the token is the one the app sent with POST /api/history/pr). */
function prLookup(ctx, pr) {
  const posts = ctx.calls.filter((c) => c.url.endsWith('/api/history/pr'));
  const { token } = JSON.parse(posts.at(-1).opts.body);
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'history-pr', token, items: [{ projectKey: KEY, id: A, pr }], done: true }) });
}
const until = async (fn) => { for (let i = 0; i < 60 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); };

test('a run whose pull requests History is still looking up: nothing opens until the lookup lands — a merged PR found then opens nothing', async () => {
  const ctx = await boot({ fetchHandler: pendingArms });
  const el = await prCard(ctx.window, A, []);
  click(ctx.window, el.querySelector('[data-chat-pr-create]'));
  await settle(10);
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), true, 'no guess while the lookup is out');
  assert.equal(el.querySelector('[data-chat-pr-create]').disabled, true);
  prLookup(ctx, { state: 'MERGED', url: 'https://x/pull/3', number: 3 });
  await until(() => el.querySelector('.ask-card-err').textContent);
  assert.equal(el.querySelector('.ask-card-err').textContent, 'This run already has a pull request.');
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), true);
  assert.equal(prPosts(ctx).length, 0);
});

test('a run whose lookup finds no pull request: Ship it opens once it lands', async () => {
  const ctx = await boot({ fetchHandler: pendingArms });
  const el = await prCard(ctx.window, A, []);
  click(ctx.window, el.querySelector('[data-chat-pr-create]'));
  await settle(10);
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), true);
  prLookup(ctx, null);
  await until(() => !modalOf(ctx.window).classList.contains('hidden'));
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), false);
  click(ctx.window, modalOf(ctx.window).querySelector('.shipit-cancel'));
  await settle(4);
});

test('a lookup still out when the wait ends: the card says "still checking" and nothing opens — never a guess (Review Focus 7, refine cycle 2 mutation killer)', async () => {
  const ctx = await boot({ fetchHandler: pendingArms });
  const el = await prCard(ctx.window, A, []);
  const realNow = Date.now;
  try {
    click(ctx.window, el.querySelector('[data-chat-pr-create]'));
    await settle(10);
    assert.equal(modalOf(ctx.window).classList.contains('hidden'), true);
    Date.now = () => realNow() + 20000;                    // past HISTORY_PR_TIMEOUT_MS + 1 s; History's own watchdog (a real timer) has not fired
    await until(() => el.querySelector('.ask-card-err').textContent);
    assert.equal(el.querySelector('.ask-card-err').textContent, "Still checking this run's pull requests. Try again in a moment.");
    assert.equal(modalOf(ctx.window).classList.contains('hidden'), true);
    assert.equal(prPosts(ctx).length, 0);
  } finally { Date.now = realNow; }
});

test('a workspace run whose members\' pull requests are still being looked up: nothing opens and nothing is refused until the lookup lands (refine cycle 2 mutation killer)', async () => {
  const WKS = 'workspaces/team-a'; const API = 'api-00000001'; const WEB = 'web-00000002';
  // No member `pr` key: History has not looked them up yet (the row's own pr came from the cache).
  const member = (memberKey, name) => ({ memberKey, name, projectDir: `/tmp/${name}`, branch: `worca-cc/feat-${name}`, sourceBranch: 'main', survived: true, affected: true, added: 5, removed: 1, diffFrozen: true });
  const wsRow = { ...ROW(A, 'Run A'), projectKey: WKS, target: 'workspace', workspaceName: 'Team A', pr: null, members: [member(API, 'api'), member(WEB, 'web')] };
  const wsArms = (url, opts) => {
    if (url.endsWith('/api/history')) return ok({ pipelines: [wsRow], ghAvailable: true });
    if (url.endsWith(`/api/workspaces/team-a/runs/${A}`)) return ok({ ...DETAIL(A, 'Run A'), state: { ...DETAIL(A, 'Run A').state, target: 'workspace' } });
    return arms(url, opts);
  };
  const ctx = await boot({ fetchHandler: wsArms });
  const { chatCardBuilder } = await import(extensionsUrl);
  const block = { kind: 'card', id: 'card_0000cccc', state: 'proposed', card: { type: 'pull-request', pipelineId: A, projectKey: WKS, workspaceId: 'team-a', title: 'Run A', branch: 'worca-cc/feat-api' } };
  const { el } = chatCardBuilder('pull-request')(block, { doc: ctx.window.document, win: ctx.window, threadId: () => 'ask_aaaaaaaa', postCard: async () => ({}), announce: () => {},
    openShipIt: (ref, link) => ctx.window.__np.chat.deps.openShipIt(ref, link) });
  ctx.window.document.body.appendChild(el);
  click(ctx.window, el.querySelector('[data-chat-pr-create]'));
  await settle(10);
  assert.equal(el.querySelector('.ask-card-err').textContent, '', 'no refusal while the members are looked up');
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), true);
  const { token } = JSON.parse(ctx.calls.filter((c) => c.url.endsWith('/api/history/pr')).at(-1).opts.body);
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'history-pr', token, items: [{ projectKey: WKS, id: A, pr: null, members: [{ memberKey: API, pr: null }, { memberKey: WEB, pr: null }] }], done: true }) });
  await until(() => !modalOf(ctx.window).classList.contains('hidden'));
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), false, 'the workspace dialog opens once the members are known');
  click(ctx.window, modalOf(ctx.window).querySelector('.shipit-cancel'));
  await settle(4);
});

test('History reloads while the card waits for the PR lookup: the wait follows the fresh rows and Ship it opens when their lookup lands (refine cycle 2 mutation killer)', async () => {
  const ctx = await boot({ fetchHandler: pendingArms });
  const el = await prCard(ctx.window, A, []);
  click(ctx.window, el.querySelector('[data-chat-pr-create]'));
  await settle(10);
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), true);
  const loads = ctx.calls.filter((c) => c.url.endsWith('/api/history')).length;
  go(ctx.window, 'history');                               // entering the Runs views reloads History: fresh rows, a new lookup token
  await until(() => ctx.calls.filter((c) => c.url.endsWith('/api/history')).length > loads);
  await settle(10);
  prLookup(ctx, null);                                     // the NEW load's lookup
  await until(() => !modalOf(ctx.window).classList.contains('hidden'));
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), false);
  click(ctx.window, modalOf(ctx.window).querySelector('.shipit-cancel'));
  await settle(4);
});

test('a workspace run that finished while the chat held its stale running History row: Create reloads History and opens Ship it (impl review M1 mutation killer)', async () => {
  const WKS = 'workspaces/team-a'; const API = 'api-00000001'; const WEB = 'web-00000002';
  // A running workspace run's members read affected:false (no results.json yet, no commits ahead until teardown).
  const member = (memberKey, name, affected) => ({ memberKey, name, projectDir: `/tmp/${name}`, branch: `worca-cc/feat-${name}`, sourceBranch: 'main',
    survived: true, affected, added: affected ? 5 : 0, removed: affected ? 1 : 0, diffFrozen: affected, pr: null });
  const wsRow = (status, affected) => ({ ...ROW(A, 'Run A'), status, projectKey: WKS, target: 'workspace', workspaceName: 'Team A',
    members: [member(API, 'api', affected), member(WEB, 'web', affected)] });
  const box = { row: wsRow('running', false) };
  const wsArms = (url, opts) => {
    if (url.endsWith('/api/history')) return ok({ pipelines: [box.row], ghAvailable: true });
    if (url.endsWith(`/api/workspaces/team-a/runs/${A}`)) return ok({ ...DETAIL(A, 'Run A'), state: { ...DETAIL(A, 'Run A').state, target: 'workspace' } });
    return arms(url, opts);
  };
  const ctx = await boot({ fetchHandler: wsArms });
  const historyLoads = () => ctx.calls.filter((c) => c.url.endsWith('/api/history')).length;
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [] }) });   // the first connect loads History: the run is still running
  await until(() => historyLoads() > 0);
  await settle(10);
  box.row = wsRow('done', true);                                                             // the run finishes; the Chat page reloads no History
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'pipelines-changed' }) });
  await settle(10);
  assert.equal(historyLoads(), 1, 'the chat still holds the stale running row');
  const { chatCardBuilder } = await import(extensionsUrl);
  const block = { kind: 'card', id: 'card_0000dddd', state: 'proposed', card: { type: 'pull-request', pipelineId: A, projectKey: WKS, workspaceId: 'team-a', title: 'Run A', branch: 'worca-cc/feat-api' } };
  const { el } = chatCardBuilder('pull-request')(block, { doc: ctx.window.document, win: ctx.window, threadId: () => 'ask_aaaaaaaa', postCard: async () => ({}), announce: () => {},
    openShipIt: (ref, link) => ctx.window.__np.chat.deps.openShipIt(ref, link) });
  ctx.window.document.body.appendChild(el);
  click(ctx.window, el.querySelector('[data-chat-pr-create]'));
  await until(() => !modalOf(ctx.window).classList.contains('hidden') || el.querySelector('.ask-card-err').textContent);
  assert.equal(el.querySelector('.ask-card-err').textContent, '', 'no "No pull request can be opened" from the stale row');
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), false, 'the workspace dialog opens from the fresh row');
  assert.equal(historyLoads(), 2, 'Create reloaded History once');
  click(ctx.window, modalOf(ctx.window).querySelector('.shipit-cancel'));
  await settle(4);
});

test('History failed to load: the card says so in the Runs list\'s words, not that the run is missing (refine cycle 2)', async () => {
  const failing = (url, opts) => (url.endsWith('/api/history') ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'database is locked' }) }) : arms(url, opts));
  const ctx = await boot({ fetchHandler: failing });
  const el = await prCard(ctx.window, A, []);
  click(ctx.window, el.querySelector('[data-chat-pr-create]'));
  await settle(10);
  assert.match(el.querySelector('.ask-card-err').textContent, /^Could not load finished runs: /);
  assert.equal(modalOf(ctx.window).classList.contains('hidden'), true);
});
