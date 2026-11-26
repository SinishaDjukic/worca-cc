// test/shared-boot-family-adapters.test.mjs — the run-page and History detail adapters over the shared app boot:
// runPageOn(app) (test/helpers/run-page-boot.mjs), historyFetch and detailOn(app)
// (test/helpers/history-detail-boot.mjs). Their contract against a recording stand-in for the app, then each on the
// real shared app. The helpers are read as namespaces, so a missing export fails its own tests, not the file's load.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { useSharedApp } from './helpers/shared-app-boot.mjs';
import * as runPage from './helpers/run-page-boot.mjs';
import * as history from './helpers/history-detail-boot.mjs';
import { readRepo } from '../tools/suite-guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const app = useSharedApp({ before, beforeEach, after });

const { PROJECT, ROW, DETAIL, DETAIL_URL, detailHash } = history;
const PROJECTS = { projects: [{ name: 'proj', path: PROJECT, exists: true }] };
// What useSharedApp's fresh() accepts; any other key throws.
const FRESH_KEYS = ['fetchHandler', 'local', 'session', 'hooks', 'flags', 'level', 'hash'];

// The parts of the shared app an adapter may touch, recording what it asks for.
function recordingApp() {
  const seen = { fresh: [], gone: [], removed: [] };
  const stand = {
    window: { localStorage: { removeItem: (k) => seen.removed.push(k) } },
    calls: [],
    wsBox: { ws: null },
    async fresh(options = {}) { seen.fresh.push(options); return stand; },
    go(hash) { seen.gone.push(hash); },
    async settle() {},
  };
  return { app: stand, seen };
}
const assertFreshOptions = (options) => {
  assert.deepEqual(Object.keys(options).filter((k) => !FRESH_KEYS.includes(k)), [], 'only fresh() options');
  assert.deepEqual(Object.keys(options).filter((k) => options[k] === undefined), [], 'no undefined keys');
};
const bodyOf = async (reply) => (await reply).json();

test('R-arch-8: the two helpers export their adapters, import no shared boot, and export no new app boot', () => {
  assert.equal(typeof runPage.runPageOn, 'function', 'run-page-boot exports runPageOn');
  assert.equal(typeof history.historyFetch, 'function', 'history-detail-boot exports historyFetch');
  assert.equal(typeof history.detailOn, 'function', 'history-detail-boot exports detailOn');
  for (const helper of ['run-page-boot', 'history-detail-boot']) {
    const source = readFileSync(`${ROOT}test/helpers/${helper}.mjs`, 'utf8');
    const imported = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
      .filter((n) => n.source).map((n) => n.source.value);
    assert.deepEqual(imported.filter((s) => s.includes('shared-app-boot')), [], `${helper} does not import the shared boot`);
    assert.doesNotMatch(source, /import\([^)]*shared-app-boot/, `${helper} does not import() it either`);
  }
  const { boots } = readRepo(ROOT, null);
  assert.deepEqual([...boots.get('test/helpers/run-page-boot.mjs')].sort(), ['bootApp']);
  assert.deepEqual([...boots.get('test/helpers/history-detail-boot.mjs')].sort(), ['boot', 'bootDetail']);
});

test('the adapters\' functions are not named like the helpers\' own boots', () => {
  const stand = recordingApp().app;
  const detail = history.detailOn(stand);
  const names = [runPage.runPageOn(stand).name, detail.page.name, detail.detail.name];
  assert.deepEqual(names.filter((n) => ['bootApp', 'bootDetail', 'bootChat', 'bootGitApp', 'boot'].includes(n)), []);
});

// ── runPageOn ───────────────────────────────────────────────────────────────
test('runPageOn resets the app with just the options the test gave', async () => {
  const { app: stand, seen } = recordingApp();
  const openPage = runPage.runPageOn(stand);
  const fetchHandler = () => null;
  const hooks = { seam: 1 };
  const local = { 'worca-cc.seeded': '1' };
  await openPage({ fetchHandler, hooks, local });
  await openPage({ fetchHandler, hooks: undefined, local: undefined });
  await openPage();
  assert.equal(seen.fresh.length, 3, 'one reset per call');
  seen.fresh.forEach(assertFreshOptions);
  assert.deepEqual(seen.fresh[0], { fetchHandler, hooks, local });
  assert.deepEqual(seen.fresh[1], { fetchHandler });
  assert.deepEqual(seen.fresh[2], {});
});

test('runPageOn\'s ctx is the app plus showRunning, which forgets the remembered run and opens the Runs list', async () => {
  const { app: stand, seen } = recordingApp();
  const ctx = await runPage.runPageOn(stand)();
  for (const key of ['window', 'calls', 'wsBox']) assert.equal(ctx[key], stand[key], key);
  for (const key of ['go', 'settle', 'showRunning']) assert.equal(typeof ctx[key], 'function', key);
  assert.deepEqual(seen.gone, [], 'opening the page does not route anywhere');
  ctx.showRunning();
  assert.deepEqual(seen.removed, ['worca-cc.runs.last']);
  assert.deepEqual(seen.gone, ['runs']);
});

// ── historyFetch and detailOn ───────────────────────────────────────────────
test('historyFetch answers /api/projects with the History project, behind the test\'s handler, and nothing else', async () => {
  const bare = history.historyFetch();
  assert.deepEqual(await bodyOf(bare('/api/projects', {})), PROJECTS);
  assert.ok(!bare('/api/config', {}), 'any other request falls through to the shared default');

  const seen = [];
  const mine = Promise.resolve('mine');
  const projects = Promise.resolve('my projects');
  const wrapped = history.historyFetch((url, opts) => {
    seen.push([url, opts]);
    if (url === '/api/mine') return mine;
    return url === '/api/projects?mine' ? projects : null;
  });
  const opts = { method: 'POST' };
  assert.equal(wrapped('/api/mine', opts), mine);
  assert.deepEqual(seen[0], ['/api/mine', opts]);
  assert.equal(wrapped('/api/projects?mine', {}), projects, 'the test\'s handler answers first');
  assert.deepEqual(await bodyOf(wrapped('/api/projects', {})), PROJECTS);
  assert.ok(!wrapped('/api/config', {}));
});

test('detailOn page() resets with the History fetch and puts hljsLoader in the per-test hooks', async () => {
  const { app: stand, seen } = recordingApp();
  const mine = Promise.resolve('mine');
  const hljsLoader = () => null;
  const local = { 'worca-cc.seeded': '1' };
  const ctx = await history.detailOn(stand).page({
    fetchHandler: (url) => (url === '/api/mine' ? mine : null), hooks: { seam: 1 }, local, hljsLoader,
  });
  assert.equal(ctx.window, stand.window);
  assert.equal(ctx.calls, stand.calls);
  assert.equal(ctx.wsBox, stand.wsBox);
  assertFreshOptions(seen.fresh[0]);
  assert.deepEqual(seen.fresh[0].hooks, { hljsLoader, seam: 1 });
  assert.deepEqual(seen.fresh[0].local, local);
  assert.equal(seen.fresh[0].fetchHandler('/api/mine', {}), mine);
  assert.deepEqual(await bodyOf(seen.fresh[0].fetchHandler('/api/projects', {})), PROJECTS);

  await history.detailOn(stand).page();
  assertFreshOptions(seen.fresh[1]);
  assert.deepEqual(Object.keys(seen.fresh[1].hooks ?? {}), [], 'no hooks when the test gave none');
  assert.deepEqual(await bodyOf(seen.fresh[1].fetchHandler('/api/projects', {})), PROJECTS);
});

test('detailOn detail() answers the History routes from a box the test can change afterwards', async () => {
  const { app: stand, seen } = recordingApp();
  const ctx = await history.detailOn(stand).detail();
  assert.equal(ctx.window, stand.window);
  assert.equal(ctx.calls, stand.calls);
  assert.equal(ctx.wsBox, stand.wsBox);
  assert.deepEqual(ctx.box.rows, [ROW]);
  assert.equal(ctx.box.detail, DETAIL);
  assert.equal(ctx.box.budget.blocked, false);
  assertFreshOptions(seen.fresh[0]);
  const answer = (url) => seen.fresh[0].fetchHandler(url, {});
  assert.deepEqual(await bodyOf(answer('/api/projects')), PROJECTS);
  assert.deepEqual((await bodyOf(answer('/api/history'))).pipelines, [ROW]);
  assert.equal(await bodyOf(answer(DETAIL_URL)), DETAIL);
  assert.equal(await bodyOf(answer('/api/budget')), ctx.box.budget);
  assert.equal((await answer(`${DETAIL_URL}/log`)).status, 404);
  ctx.box.rows = [];
  assert.deepEqual((await bodyOf(answer('/api/history'))).pipelines, [], 'rows delivered later are served');
});

test('detailOn detail() takes the test\'s rows, detail and budget, asks its arms first, and passes the hooks and storage', async () => {
  const { app: stand, seen } = recordingApp();
  const rows = [{ ...ROW, title: 'Mine' }];
  const detail = { ...DETAIL, auditMarkdown: '# mine' };
  const budget = { blocked: true };
  const mine = Promise.resolve('mine');
  const armSaw = [];
  const hljsLoader = () => null;
  const ctx = await history.detailOn(stand).detail({
    rows, detail, budget, hljsLoader, hooks: { seam: 1 }, local: { k: 'v' },
    arms: (url, opts, box) => { armSaw.push(box); return url.endsWith('/diff') ? mine : null; },
  });
  assert.equal(ctx.box.rows, rows);
  assert.equal(ctx.box.detail, detail);
  assert.equal(ctx.box.budget, budget);
  const options = seen.fresh[0];
  assertFreshOptions(options);
  assert.deepEqual(options.hooks, { hljsLoader, seam: 1 });
  assert.deepEqual(options.local, { k: 'v' });
  assert.equal(options.fetchHandler(`${DETAIL_URL}/diff`, {}), mine, 'the arm wins over the shared 404');
  assert.equal(armSaw[0], ctx.box);
  assert.equal(await bodyOf(options.fetchHandler(DETAIL_URL, {})), detail);
});

// ── on the real shared app ──────────────────────────────────────────────────
const CLARIFY = {
  id: 'clarify-adapter', kind: 'clarify',
  questions: [{ id: 'q1', question: 'Where to store sessions?', options: ['Redis', 'Postgres', ''], allowFreeText: true }],
};

test('on the shared app, runPageOn\'s ctx drives openRunPanel, showRunning and runCard', async () => {
  const ctx = await runPage.runPageOn(app)();
  const runId = app.uid('adapter-run-');
  const panel = await runPage.openRunPanel(ctx, { runId, question: CLARIFY });
  assert.ok(panel?.querySelector('.qopt'), 'the run page shows the question\'s panel');
  ctx.showRunning();
  await ctx.settle();
  assert.ok(runPage.runCard(ctx, runId), 'the Runs list has the run\'s row');
});

const titled = (title) => ({
  rows: [{ ...ROW, title }],
  detail: { ...DETAIL, state: { ...DETAIL.state, title } },
});

test('on the shared app, detailOn detail() opens a saved run with openDetail', async () => {
  const bootDetail = history.detailOn(app).detail;
  const ctx = await bootDetail(titled('Adapter opened run'));
  await history.openDetail(ctx);
  assert.match(ctx.window.document.querySelector('#hist-detail').textContent, /Adapter opened run/);
  assert.ok(ctx.calls.some((c) => c.url.endsWith(DETAIL_URL)));
});

test('on the shared app, detailOn detail({ deepLink: true }) lands on the run\'s route after the reset, with the test\'s answers', async () => {
  const bootDetail = history.detailOn(app).detail;
  const ctx = await bootDetail({ ...titled('Adapter linked run'), deepLink: true });
  await history.settle(ctx.window, 6);
  assert.equal(ctx.window.location.hash, `#${detailHash}`);
  assert.ok(ctx.calls.some((c) => c.url.endsWith(DETAIL_URL)), 'the detail was fetched after the reset');
  assert.match(ctx.window.document.querySelector('#hist-detail').textContent, /Adapter linked run/);
});
