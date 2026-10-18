// test/ui-folder-run-running.test.mjs — Projects, any way (P1b): a Folder run on the Running page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { checkRows } from './helpers/rows.mjs';

const COUNTS = { added: 9, modified: 4, deleted: 1 };
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const tabs = (ctx) => [...ctx.window.document.querySelectorAll('#run-detail .rd-tab')].map((b) => b.dataset.sec);
const $ = (ctx, sel) => ctx.window.document.querySelector(`#run-detail ${sel}`);
const FOLDER_TABS = ['overview', 'changes', 'artifacts', 'workflow', 'qa', 'logs', 'agents'];

test('a live folder run: Changes in place of Diff and Actions, from its hello or its run-created frame', async () => {
  await checkRows([
    { name: 'hello', run: async () => {
      const ctx = await bootApp();
      helloRun(ctx, { runId: 'r1', pipelineId: 'p1', workMode: 'folder', projectDir: '/tmp/tax' });
      ctx.go('running/r1/details');
      await ctx.settle();
      assert.deepEqual(tabs(ctx), FOLDER_TABS);
      assert.equal($(ctx, '.rd-tab[data-sec="changes"]').dataset.minLevel, 'simple');
    } },
    { name: 'run-created', run: async () => {
      const ctx = await bootApp();
      helloRun(ctx, { runId: 'r0' });
      ctx.dispatch({ type: 'run-created', runId: 'r2', title: 'Sort statements', projectDir: '/tmp/tax', kind: 'run',
        status: 'starting', startedAt: '2026-10-17T14:10:32Z', workMode: 'folder' });
      ctx.go('running/r2/details');
      await ctx.settle();
      assert.deepEqual(tabs(ctx), FOLDER_TABS);
    } },
  ]);
});

test('learned from a state frame: the tabs rebuild, no branch row, chip or Sync, the meta says Folder, Changes waits for the end', async () => {
  const ctx = await bootApp();
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', projectDir: '/tmp/tax' });
  ctx.go('running/r1/details');
  await ctx.settle();
  assert.ok(tabs(ctx).includes('diff'), 'an older server: a git run until it says otherwise');
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', steps: [], workMode: 'folder',
    branch: { workMode: 'folder', copyDir: '/tmp/worca/runs/p1/repos/tax' } });   // a folder record has copyDir, never worktreeDir (S51)
  await ctx.settle();
  assert.deepEqual(tabs(ctx), FOLDER_TABS);
  for (const sel of ['.rd-base', '.rd-branch-copy', '.rd-sync', '.rd-page-branch']) assert.equal($(ctx, sel).hidden, true, sel);
  assert.equal($(ctx, '.rd-page-meta .kind-chip.kind-folder').textContent, 'Folder');
  $(ctx, '.rd-tab[data-sec="changes"]').click();
  await ctx.settle();
  assert.equal($(ctx, '.rd-sec[data-sec="changes"] .hd-diff-empty').textContent, 'No changes yet.');
  assert.ok(!ctx.calls.some((c) => /\/changes|\/live-diff/.test(c.url)), 'nothing is read while it runs');
});

test('a git run while git is missing: the composed predicate (gitOn() && isGitRun) hides its branch row; no Folder chip', async () => {
  const ctx = await bootApp();
  ctx.window.document.documentElement.dataset.git = 'off';
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1' });
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', steps: [], branch: { source: 'main', feature: 'worca-cc/fix-p1' } });
  ctx.go('running/r1/details');
  await ctx.settle();
  for (const sel of ['.rd-base', '.rd-branch-copy', '.rd-page-branch']) assert.equal($(ctx, sel).hidden, true, sel);
  assert.equal($(ctx, '.rd-page-meta .kind-chip'), null, 'still a git run');
});

test('a finished folder run before its saved row lands: Finished · 14 files changed, the Apply bar, no pull request, no Actions strip', async () => {
  const DETAIL = { state: { id: 'p1', title: 'Rename receipts', status: 'done', workMode: 'folder', branch: { workMode: 'folder' }, steps: [], subAgents: [],
    changes: { state: 'pending', counts: COUNTS } }, results: null, clarify: { questions: [], answers: [] }, stepQuestions: [], artifacts: [] };
  const ctx = await bootApp({ fetchHandler: (url) => {
    if (url.startsWith('/api/runs/p1?')) return ok(DETAIL);
    if (url.endsWith('/api/history')) return ok({ pipelines: [], ghAvailable: true });
    return null;
  } });
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', status: 'done', workMode: 'folder', projectDir: '/tmp/tax' });
  ctx.go('running/r1');
  await ctx.settle(8);
  assert.equal(ctx.window.location.hash, '#running/r1', 'no saved row yet: it stays here');
  assert.equal($(ctx, '.rd-now-state').textContent, 'Finished');
  assert.equal($(ctx, '.rd-now-sub').textContent, '14 files changed');
  assert.equal($(ctx, '.rd-apply-slot .fc-bar-l').textContent, '14 files · on a copy');
  assert.deepEqual([...ctx.window.document.querySelectorAll('#run-detail .rd-apply-slot button')].map((b) => b.textContent), ['Discard', 'Apply to folder']);
  assert.equal($(ctx, '.rd-pr-slot').hidden, true);
  const tile = [...ctx.window.document.querySelectorAll('#run-detail .rd-facts .rd-stats > div')].find((t) => t.lastElementChild.textContent === 'files changed');
  assert.equal(tile.querySelector('b').textContent, '+9 ~4 −1');
  const rows = [...ctx.window.document.querySelectorAll('#run-detail .rd-result .rd-srow')].map((r) => [r.dataset.rdTab, (r.querySelector('.rd-srow-v') || { textContent: '' }).textContent]);
  assert.deepEqual(rows.find((r) => r[0] === 'changes'), ['changes', '14 files']);
  assert.equal(rows.some((r) => r[0] === 'diff' || r[0] === 'actions'), false);
  ctx.go('running/r1/details/overview');
  await ctx.settle();
  assert.equal($(ctx, '.rd-sec[data-sec="overview"] .act-strip').hidden, true);
  assert.equal($(ctx, '.rd-sec[data-sec="overview"] .hd-ov-wt'), null);
});

test('a finished folder run whose project has other saved runs: no pull request placeholder; the Changes pill counts', async () => {
  const FDET = { state: { id: 'p1', title: 'Rename receipts', status: 'done', workMode: 'folder', branch: { workMode: 'folder' }, steps: [], subAgents: [],
    changes: { state: 'pending', counts: COUNTS } }, results: null, clarify: { questions: [], answers: [] }, stepQuestions: [], artifacts: [] };
  const OTHER = { id: 'aaaa1111', projectKey: 'tax-papers-1a2b3c4d', projectName: 'Tax papers 2026', projectDir: '/tmp/tax', status: 'done', title: 'Earlier',
    startedAt: '2026-10-16T10:00:00Z', mtime: 1, workMode: 'folder', branch: null, changes: { state: 'applied', counts: COUNTS } };
  const ctx = await bootApp({ fetchHandler: (url) => {
    if (url.startsWith('/api/runs/p1?')) return ok(FDET);
    if (url.endsWith('/api/history')) return ok({ pipelines: [OTHER], ghAvailable: true });
    return null;
  } });
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', status: 'done', workMode: 'folder', projectDir: '/tmp/tax' });
  ctx.go('running/r1');
  await ctx.settle(8);
  assert.equal(ctx.window.location.hash, '#running/r1');
  assert.equal($(ctx, '.rd-pr-slot .rd-pr-spin'), null, 'no Checking the pull request… spinner');
  assert.equal($(ctx, '.rd-pr-slot').hidden, true);
  assert.equal($(ctx, '.rd-tab[data-sec="changes"] .rd-tab-badge').textContent, '14');
});

test('git comes back: the Running page re-reads the composed predicate without a frame', async () => {
  const ctx = await bootApp();
  ctx.window.document.documentElement.dataset.git = 'off';
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1' });
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', steps: [], branch: { source: 'main', feature: 'worca-cc/fix-p1' } });
  ctx.go('running/r1/details');
  await ctx.settle();
  assert.equal($(ctx, '.rd-base').hidden, true);
  ctx.dispatch({ type: 'git', git: { available: true } });
  await ctx.settle();
  assert.equal($(ctx, '.rd-base').hidden, false);
  assert.equal($(ctx, '.rd-page-branch').hidden, false);
});

const FPLAN = { target: '/x', add: ['a'], update: [], delete: [], skipped: [] };
const FDONE = { state: { id: 'p1', title: 'Rename receipts', status: 'done', workMode: 'folder', branch: { workMode: 'folder' }, steps: [], subAgents: [],
  changes: { state: 'pending', counts: COUNTS } }, results: null, clarify: { questions: [], answers: [] }, stepQuestions: [], artifacts: [] };

test('Apply from the Running page settles its bar and headline (the run models + rdRepaintOpenGlance)', async () => {
  const ctx = await bootApp({ fetchHandler: (url, opts) => {
    if (url.startsWith('/api/runs/p1?')) return ok(FDONE);
    if (url.endsWith('/api/history')) return ok({ pipelines: [], ghAvailable: false });
    if (url.endsWith('/api/runs/p1/apply-plan')) return ok(FPLAN);
    if (url.endsWith('/api/runs/p1/apply') && opts.method === 'POST') return ok({ applied: 1, skipped: [] });
    return null;
  } });
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', status: 'done', workMode: 'folder', projectDir: '/tmp/tax' });
  ctx.go('running/r1');
  await ctx.settle(8);
  $(ctx, '.rd-apply-slot .fc-apply').click();
  await ctx.settle(4);
  ctx.window.document.querySelector('.fc-modal .fc-go').click();
  await ctx.settle(8);
  assert.equal($(ctx, '.rd-apply-slot .fc-bar-l').textContent, '14 files · Applied');
  assert.equal($(ctx, '.rd-now-state').textContent, 'Applied');
});

test('a starting folder run reads Copying the folder', async () => {
  const ctx = await bootApp();
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', status: 'starting', workMode: 'folder', projectDir: '/tmp/tax' });
  ctx.go('running/r1');
  await ctx.settle();
  assert.equal($(ctx, '.rd-now-sub').textContent, 'Copying the folder');
});

test('the tab bar rebuilt for a Folder run keeps the open tab', async () => {
  const ctx = await bootApp();
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', projectDir: '/tmp/tax' });
  ctx.go('running/r1/details/workflow');
  await ctx.settle();
  assert.equal($(ctx, '.rd-tab.active').dataset.sec, 'workflow');
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', steps: [], workMode: 'folder', branch: { workMode: 'folder' } });
  await ctx.settle();
  assert.equal($(ctx, '.rd-tab.active').dataset.sec, 'workflow');
});

test('a finished git run while git is missing: no pull-request placeholder, a line that names no hidden control', async () => {
  const GDETAIL = { state: { id: 'p1', title: 'Fix', status: 'done', branch: { source: 'main', feature: 'worca-cc/fix-p1' }, steps: [], subAgents: [] },
    results: null, clarify: { questions: [], answers: [] }, stepQuestions: [], artifacts: [] };
  const ctx = await bootApp({ fetchHandler: (url) => {
    if (url.startsWith('/api/runs/p1?')) return ok(GDETAIL);
    if (url.endsWith('/api/history')) return ok({ pipelines: [], ghAvailable: true });
    return null;
  } });
  ctx.window.document.documentElement.dataset.git = 'off';
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', status: 'done', projectDir: '/tmp/p' });
  ctx.go('running/r1');
  await ctx.settle(8);
  assert.equal($(ctx, '.rd-pr-slot').hidden, true);
  assert.equal($(ctx, '.rd-pr-slot .rd-pr-spin'), null);
  assert.equal($(ctx, '.rd-now-sub').textContent, '');
});

test('a finished folder run: changes that land after the detail payload fill the Changes row', async () => {
  const NOCH = { state: { id: 'p1', title: 'Rename receipts', status: 'done', workMode: 'folder', branch: { workMode: 'folder' }, steps: [], subAgents: [] },
    results: null, clarify: { questions: [], answers: [] }, stepQuestions: [], artifacts: [] };
  const ctx = await bootApp({ fetchHandler: (url) => {
    if (url.startsWith('/api/runs/p1?')) return ok(NOCH);
    if (url.endsWith('/api/history')) return ok({ pipelines: [], ghAvailable: false });
    return null;
  } });
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', status: 'done', workMode: 'folder', projectDir: '/tmp/tax' });
  ctx.go('running/r1');
  await ctx.settle(8);
  const row = () => [...ctx.window.document.querySelectorAll('#run-detail .rd-result .rd-srow')].map((r) => [r.dataset.rdTab, (r.querySelector('.rd-srow-v') || { textContent: '' }).textContent]).find((r) => r[0] === 'changes');
  assert.deepEqual(row(), ['changes', '']);
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'done', steps: [], workMode: 'folder', branch: { workMode: 'folder', changes: { state: 'pending', counts: COUNTS } } });
  await ctx.settle(4);
  assert.deepEqual(row(), ['changes', '14 files']);
});

test('the Runs list: a live Folder run names its group kind and its settled changes before any saved row', async () => {
  const PROJ = [{ name: 'Tax papers 2026', path: '/tmp/tax', exists: true, vcs: 'none', workMode: 'folder', key: 'tax-papers-1a2b3c4d' }];
  const ctx = await bootApp({ fetchHandler: (url) => {
    if (url === '/api/projects') return ok({ projects: PROJ });
    if (url.endsWith('/api/history')) return ok({ pipelines: [], ghAvailable: false });
    return null;
  } });
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', workMode: 'folder', projectDir: '/tmp/tax' });
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', steps: [], workMode: 'folder',
    branch: { workMode: 'folder', changes: { state: 'applied', counts: COUNTS } } });
  ctx.dispatch({ type: 'done', runId: 'r1', status: 'done' });
  ctx.showRunning();
  await ctx.settle(8);
  const group = ctx.window.document.querySelector('#runs-list .runs-group[data-group-key="tax-papers-1a2b3c4d"]');
  assert.equal(group.querySelector('.runs-group-head .kind-chip').textContent, 'Folder');
  assert.match(group.querySelector('.runs-row[data-run-id="r1"] .runs-row-sub').textContent, /^Applied/);
});

test('the chat card of a live Folder run is a Folder run; openApply opens Apply to folder', async () => {
  const plan = { target: '/x', add: ['a'], update: [], delete: [], skipped: [] };
  const ctx = await bootApp({ fetchHandler: (url) => (url.endsWith('/api/runs/p1/apply-plan') ? ok(plan) : null) });
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', status: 'done', workMode: 'folder', projectDir: '/tmp/tax' });
  await ctx.settle();
  const snap = ctx.window.__np.askRunStore.byPipeline('p1');
  assert.deepEqual([snap.workMode, snap.changes], ['folder', null]);
  void ctx.window.__np.chatRunControls.openApply({ pipelineId: 'p1' });
  await ctx.settle(4);
  assert.equal(ctx.window.document.querySelector('.fc-modal .fc-dlg-title').textContent, 'Apply to folder');
});
