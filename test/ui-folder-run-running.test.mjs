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
  // Runs redesign: the one status block (run-model.mjs) words the run.
  assert.equal($(ctx, '.rd-now-top').dataset.word, 'Finished');
  assert.equal($(ctx, '.rd-now-top .run-status-text').textContent, 'Finished · 14 files changed');
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
  assert.equal($(ctx, '.rd-now-top').dataset.word, 'Applied');
});

test('a starting folder run reads Copying the folder', async () => {
  const ctx = await bootApp();
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', status: 'starting', workMode: 'folder', projectDir: '/tmp/tax' });
  ctx.go('running/r1');
  await ctx.settle();
  assert.equal($(ctx, '.rd-now-top').dataset.line, 'Copying the folder');
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
  assert.equal($(ctx, '.rd-now-top .run-status-text').textContent, 'Finished', 'not "Ready to ship": Ship it is hidden');
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
  const ctx = await bootApp({ local: { 'worca-cc.runs.view': JSON.stringify({ show: 'all', groupBy: 'project', person: '' }) }, fetchHandler: (url) => {
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
  const group = ctx.window.document.querySelector('#runs-list .runs-sec[data-section="project:tax-papers-1a2b3c4d"]');   // View › Group by Project
  assert.equal(group.querySelector('.runs-sec-head .kind-chip').textContent, 'Folder');
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

test('P5: a live mixed workspace run learns its Folder member from a state frame: Diff and Changes, one section per Folder member', async () => {
  const ctx = await bootApp();
  helloRun(ctx, { runId: 'w1', pipelineId: 'pw', kind: 'workspace-run', workspaceId: 'wks-1', projectNames: ['api', 'notes'], projectDir: '/tmp/ws' });
  ctx.go('running/w1/details');
  await ctx.settle();
  assert.ok(!tabs(ctx).includes('changes'), 'no Folder member known yet');
  ctx.dispatch({ type: 'state', runId: 'w1', id: 'pw', status: 'running', steps: [], target: 'workspace',
    projects: [{ projectKey: 'api-00000001', projectName: 'api', projectDir: '/r/api' },
      { projectKey: 'notes-00000004', projectName: 'notes', projectDir: '/r/notes', workMode: 'folder' }] });
  await ctx.settle();
  assert.deepEqual(tabs(ctx).filter((k) => k === 'diff' || k === 'changes'), ['diff', 'changes']);
  $(ctx, '.rd-tab[data-sec="changes"]').click();
  await ctx.settle();
  const secs = [...ctx.window.document.querySelectorAll('#run-detail .rd-sec[data-sec="changes"] section[data-member-key]')];
  assert.deepEqual(secs.map((n) => [n.dataset.memberKey, n.querySelector('.fc-member-name').textContent, n.querySelector('.kind-chip').textContent]),
    [['notes-00000004', 'notes', 'Folder']]);
  assert.equal(secs[0].querySelector('.hd-diff-empty').textContent, 'No changes yet.');
  assert.ok(!ctx.calls.some((c) => /\/changes/.test(c.url)), 'nothing is read while it runs');
});

test('P5: a finished all-Folder workspace run before its saved row lands: no run-level Apply bar; Changes per member from the saved state', async () => {
  const WDET = { state: { id: 'pw', title: 'Tidy both', status: 'done', target: 'workspace', workMode: 'folder', branch: { workMode: 'folder' }, steps: [], subAgents: [],
    projects: [{ projectKey: 'notes-00000004', projectName: 'notes', projectDir: '/r/notes', workMode: 'folder' },
      { projectKey: 'docs-00000005', projectName: 'docs', projectDir: '/r/docs', workMode: 'folder' }],
    branches: { 'notes-00000004': { workMode: 'folder', changes: { state: 'pending', counts: { added: 2, modified: 0, deleted: 0 } } },
      'docs-00000005': { workMode: 'folder', changes: { state: 'applied', counts: { added: 1, modified: 2, deleted: 0 } } } },
    changes: { state: 'pending', counts: { added: 3, modified: 2, deleted: 0 } } }, results: null, clarify: { questions: [], answers: [] }, stepQuestions: [], artifacts: [] };
  const ctx = await bootApp({ fetchHandler: (url, opts) => {
    if (url.endsWith('/api/workspaces/wks-1/runs/pw')) return ok(WDET);
    if (url.endsWith('/api/history')) return ok({ pipelines: [], ghAvailable: true });
    if (/\/api\/runs\/pw\/changes\?memberKey=/.test(url)) return ok({ state: 'pending', files: [{ path: 'a.txt', change: 'added' }], counts: { added: 1, modified: 0, deleted: 0 } });
    if (url.endsWith('/api/runs/pw/apply-plan?memberKey=notes-00000004')) return ok({ target: '/data/notes', add: ['a.txt', 'b.txt'], update: [], delete: [], skipped: [] });
    if (url.endsWith('/api/runs/pw/apply?memberKey=notes-00000004') && opts.method === 'POST') return ok({ applied: 2, skipped: [] });
    return null;
  } });
  helloRun(ctx, { runId: 'w2', pipelineId: 'pw', status: 'done', workMode: 'folder', kind: 'workspace-run', workspaceId: 'wks-1', projectDir: '/tmp/ws' });
  ctx.go('running/w2/details/changes');   // the tabs are built before the saved state lands, then rebuilt from it
  await ctx.settle(8);
  assert.equal(ctx.window.location.hash, '#running/w2/details/changes', 'no saved row yet: it stays here');
  assert.equal($(ctx, '.rd-tab[data-sec="changes"] .rd-tab-badge').textContent, '5');
  const secs = [...ctx.window.document.querySelectorAll('#run-detail .rd-sec[data-sec="changes"] section[data-member-key]')];
  assert.deepEqual(secs.map((n) => [n.dataset.memberKey, n.querySelector('.fc-bar-l').textContent]),
    [['notes-00000004', '2 files · on a copy'], ['docs-00000005', '3 files · Applied']]);
  assert.ok(!ctx.calls.some((c) => /\/api\/runs\/pw\/(changes|apply-plan|apply|discard)/.test(c.url) && !c.url.includes('memberKey=')), 'never a memberless Changes call');
  ctx.go('running/w2');
  await ctx.settle(8);
  const slot = $(ctx, '.rd-apply-slot');
  assert.ok(slot && slot.hidden, 'no run-level Apply bar on the glance (it would POST without a memberKey)');
  assert.equal($(ctx, '.rd-now-top').dataset.word, 'Finished', 'notes is still pending');
  // Applying the last pending member settles the saved state's rollup too: with no History row the headline reads it.
  ctx.go('running/w2/details/changes');
  await ctx.settle(8);
  const notes = ctx.window.document.querySelector('#run-detail .rd-sec[data-sec="changes"] section[data-member-key="notes-00000004"]');
  [...notes.querySelectorAll('button')].find((b) => b.textContent === 'Apply to folder').click();
  await ctx.settle(8);
  [...ctx.window.document.querySelectorAll('.fc-modal button')].find((b) => b.textContent.trim() === 'Apply 2 files').click();
  await ctx.settle(10);
  ctx.go('running/w2');
  await ctx.settle(8);
  assert.equal($(ctx, '.rd-now-top').dataset.word, 'Applied', 'both members applied: the run reads Applied, as a single Folder run does');
});

test('P5: a live mixed workspace run that finishes on the run page badges Changes once its saved counts land', async () => {
  const PROJ = [{ projectKey: 'api-00000001', projectName: 'api', projectDir: '/r/api' }, { projectKey: 'notes-00000004', projectName: 'notes', projectDir: '/r/notes', workMode: 'folder' }];
  const WDET = { state: { id: 'pw', title: 'Mixed', status: 'done', target: 'workspace', steps: [], subAgents: [], projects: PROJ,
    branches: { 'api-00000001': { feature: 'worca-cc/x-api', source: 'main' }, 'notes-00000004': { workMode: 'folder', changes: { state: 'pending', counts: { added: 2, modified: 0, deleted: 0 } } } },
    changes: { state: 'pending', counts: { added: 2, modified: 0, deleted: 0 } } }, results: null, clarify: { questions: [], answers: [] }, stepQuestions: [], artifacts: [] };
  const ctx = await bootApp({ fetchHandler: (url) => {
    if (url.includes('/api/workspaces/wks-1/runs/pw')) return ok(WDET);
    if (url.endsWith('/api/history')) return ok({ pipelines: [], ghAvailable: true });
    return null;
  } });
  helloRun(ctx, { runId: 'w1', pipelineId: 'pw', kind: 'workspace-run', workspaceId: 'wks-1', projectNames: ['api', 'notes'], projectDir: '/tmp/ws' });
  ctx.go('running/w1/details');
  await ctx.settle();
  ctx.dispatch({ type: 'state', runId: 'w1', id: 'pw', status: 'running', steps: [], target: 'workspace', projects: PROJ });
  await ctx.settle();
  assert.equal($(ctx, '.rd-tab[data-sec="changes"] .rd-tab-badge')?.textContent || '', '', 'nothing counted while it runs');
  ctx.dispatch({ type: 'state', runId: 'w1', id: 'pw', status: 'done', steps: [], target: 'workspace', projects: PROJ });
  ctx.dispatch({ type: 'run-done', runId: 'w1', status: 'done' });
  await ctx.settle(12);
  assert.equal($(ctx, '.rd-tab[data-sec="changes"] .rd-tab-badge')?.textContent, '2', 'the Folder member\'s saved count, as on an all-Folder run');
});

test('P5: a reload on a live mixed workspace run\'s Changes tab opens Changes once a state frame names its Folder member', async () => {
  const ctx = await bootApp();
  helloRun(ctx, { runId: 'w1', pipelineId: 'pw', kind: 'workspace-run', workspaceId: 'wks-1', projectNames: ['api', 'notes'], projectDir: '/tmp/ws' });
  ctx.go('running/w1/details/changes');
  await ctx.settle();
  assert.ok(!tabs(ctx).includes('changes'), 'no Folder member known yet');
  ctx.dispatch({ type: 'state', runId: 'w1', id: 'pw', status: 'running', steps: [], target: 'workspace',
    projects: [{ projectKey: 'api-00000001', projectName: 'api', projectDir: '/r/api' },
      { projectKey: 'notes-00000004', projectName: 'notes', projectDir: '/r/notes', workMode: 'folder' }] });
  await ctx.settle();
  assert.equal($(ctx, '.rd-tab.active')?.dataset.sec, 'changes');
  // A tab the person picks while Changes is still pending wins: the rebuild keeps it.
  const ctx2 = await bootApp();
  helloRun(ctx2, { runId: 'w1', pipelineId: 'pw', kind: 'workspace-run', workspaceId: 'wks-1', projectNames: ['api', 'notes'], projectDir: '/tmp/ws' });
  ctx2.go('running/w1/details/changes');
  await ctx2.settle();
  ctx2.go('running/w1/details/logs');
  await ctx2.settle();
  ctx2.dispatch({ type: 'state', runId: 'w1', id: 'pw', status: 'running', steps: [], target: 'workspace',
    projects: [{ projectKey: 'api-00000001', projectName: 'api', projectDir: '/r/api' },
      { projectKey: 'notes-00000004', projectName: 'notes', projectDir: '/r/notes', workMode: 'folder' }] });
  await ctx2.settle();
  assert.ok(tabs(ctx2).includes('changes'));
  assert.equal($(ctx2, '.rd-tab.active')?.dataset.sec, 'logs');
});

test('P5: the Runs list row of a finished all-Folder workspace run never reads its first member\'s changes as the run\'s', async () => {
  const P2 = [{ projectKey: 'notes-00000004', projectName: 'notes', projectDir: '/r/notes', workMode: 'folder' },
    { projectKey: 'docs-00000005', projectName: 'docs', projectDir: '/r/docs', workMode: 'folder' }];
  const ctx = await bootApp({ fetchHandler: (url) => (url.endsWith('/api/history') ? ok({ pipelines: [], ghAvailable: false }) : null) });
  helloRun(ctx, { runId: 'w2', pipelineId: 'pw', kind: 'workspace-run', workspaceId: 'wks-1', projectNames: ['notes', 'docs'], projectDir: '/tmp/ws', workMode: 'folder' });
  // An all-Folder workspace's state.branch is the harness's scalar mirror of its FIRST member's record (_primaryMirror).
  ctx.dispatch({ type: 'state', runId: 'w2', id: 'pw', status: 'running', steps: [], target: 'workspace', workMode: 'folder', projects: P2,
    branch: { workMode: 'folder', copyDir: '/x/notes', changes: { state: 'applied', counts: { added: 2, modified: 0, deleted: 0 } } } });
  ctx.dispatch({ type: 'done', runId: 'w2', status: 'done' });
  ctx.showRunning();
  await ctx.settle(8);
  const sub = ctx.window.document.querySelector('#runs-list .runs-row[data-run-id="w2"] .runs-row-sub').textContent;
  assert.doesNotMatch(sub, /^Applied/, 'docs is still pending: the run is not Applied');
});

test('P5: a finished mixed workspace run on the run page badges Diff with its Git member\'s files only', async () => {
  const PROJ = [{ projectKey: 'api-00000001', projectName: 'api', projectDir: '/r/api' }, { projectKey: 'notes-00000004', projectName: 'notes', projectDir: '/r/notes', workMode: 'folder' }];
  const sum = (n) => ({ filesNew: n, filesChanged: 0, linesAdded: n, linesRemoved: 0 });
  const WDET = { state: { id: 'pw', title: 'Mixed', status: 'done', target: 'workspace', steps: [], subAgents: [], projects: PROJ,
    branches: { 'api-00000001': { feature: 'worca-cc/x-api', source: 'main' }, 'notes-00000004': { workMode: 'folder', changes: { state: 'pending', counts: { added: 2, modified: 0, deleted: 0 } } } },
    changes: { state: 'pending', counts: { added: 2, modified: 0, deleted: 0 } } },
  results: { summary: sum(3), perProject: { 'api-00000001': { summary: sum(1) }, 'notes-00000004': { summary: sum(2) } } },
  clarify: { questions: [], answers: [] }, stepQuestions: [], artifacts: [] };
  const ctx = await bootApp({ fetchHandler: (url) => {
    if (url.includes('/api/workspaces/wks-1/runs/pw')) return ok(WDET);
    if (url.endsWith('/api/history')) return ok({ pipelines: [], ghAvailable: true });
    return null;
  } });
  helloRun(ctx, { runId: 'w1', pipelineId: 'pw', kind: 'workspace-run', workspaceId: 'wks-1', projectNames: ['api', 'notes'], projectDir: '/tmp/ws' });
  ctx.go('running/w1/details');
  await ctx.settle();
  ctx.dispatch({ type: 'state', runId: 'w1', id: 'pw', status: 'done', steps: [], target: 'workspace', projects: PROJ });
  ctx.dispatch({ type: 'run-done', runId: 'w1', status: 'done' });
  await ctx.settle(12);
  assert.equal($(ctx, '.rd-tab[data-sec="changes"] .rd-tab-badge')?.textContent, '2', 'the saved state landed');
  assert.equal($(ctx, '.rd-tab[data-sec="diff"] .rd-tab-badge')?.textContent, '1', 'the Git member\'s 1 file, not 1 + the Folder member\'s 2');
});
