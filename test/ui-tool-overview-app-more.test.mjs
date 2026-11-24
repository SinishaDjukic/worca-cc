// test/ui-tool-overview-app-more.test.mjs — the tool panel's Overview in the real app, part 2 (issue 1064): no-project and run-page Overviews, live runs, Background and Context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { PK, TID, NOPROJ, WSCHAT, wait, until, boot } from './helpers/tool-overview-boot.mjs';

test('in the real app: a no-project chat gets the Overview (its tools stay disabled)', async () => {
  const a = await boot({ url: `http://localhost:4317/#chat/${NOPROJ}` });
  const strip = a.doc.querySelector('.chat-head [data-tool-icons]');
  assert.equal(strip.querySelector('.tool-icon-overview').disabled, false);
  assert.equal(strip.querySelector('.tool-icon[data-tool-kind="terminal"]').disabled, true);
  await a.openOverview();
  assert.equal(a.panel().querySelector('.tool-body').dataset.kind, 'overview');
  assert.ok(await until(() => a.rowsOf('environment').includes('No project')));
  assert.deepEqual(a.rec.overview, [NOPROJ]);
});

test('in the real app: the run page Overview shows its branch and PR', async () => {
  const { KEY, ROW } = await import('./helpers/chat-panel-boot.mjs');
  const a = await boot({ url: `http://localhost:4317/#history/${KEY}/${ROW.id}`, rows: [ROW] });
  await a.settle(12);
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('environment').includes(ROW.branch)), JSON.stringify(a.rowsOf('environment')));   // historyRow: the History row's branch
  assert.ok(a.rec.askRuns.some((p) => p.endsWith(`/api/ask/runs/${ROW.id}`)), a.rec.askRuns.join());
  assert.ok(await until(() => a.rowsOf('pr').includes('o/r#9')), JSON.stringify(a.rowsOf('pr')));
});

test('in the real app: a live run overlays the saved row (runStore); a workspace chat names its workspace (workspaceOf)', async () => {
  const { liveRun } = await import('./helpers/chat-panel-boot.mjs');
  const a = await boot();
  a.dispatch({ type: 'hello', runs: [liveRun({ runId: 'r-1', pipelineId: 'aaaa0001', title: 'First run', status: 'running', projectDir: '/tmp/app' })] });
  await a.settle(8);
  await a.openOverview();
  assert.ok(await until(() => /Running/.test(a.sec('runs')?.querySelector('.tov-meta')?.textContent || '')), a.sec('runs')?.textContent);
  const w = await boot({ url: `http://localhost:4317/#chat/${WSCHAT}` });
  w.dispatch({ type: 'workspaces-changed' });   // the chat page loads workspace names on demand
  await w.settle(8);
  await w.openOverview();
  assert.ok(await until(() => w.rowsOf('environment').includes('Shop')), JSON.stringify(w.rowsOf('environment')));
});

test('in the real app: Background follows the Actions list (onActions); a service row opens a Browser tab (openService); a command row shows its shell (showSession)', async () => {
  const CMD = { kind: 'card', id: 'card_000000c1', state: 'command', card: { type: 'command', blockId: 't-0000000001:1', sessionId: 't-0000000001', seq: 1, command: 'npm test', folder: 'app', cwd: '/tmp/app', warning: null } };
  let acts = [];
  const a = await boot({ blocks: [CMD], running: () => acts });
  a.dispatch({ type: 'hello', runs: [] });
  await a.settle(8);
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('background').length === 1), JSON.stringify(a.rowsOf('background')));
  acts = [{ instanceId: 'inst_1', runId: 'aaaa0001', kind: 'service', label: 'Web', url: 'http://localhost:4417/', startedAt: new Date().toISOString() }];
  a.dispatch({ type: 'actions-changed' });
  assert.ok(await until(() => a.rowsOf('background').includes('Web')), 'the new service row');
  const web = [...a.sec('background').querySelectorAll('.tov-row')].find((r) => r.textContent.includes('Web'));
  web.click();
  await a.settle(12);
  assert.ok(a.model().tabs.some((t) => t.kind === 'browser' && t.state.url === 'http://localhost:4417/'), JSON.stringify(a.model().tabs));
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('background').includes('npm test')));
  [...a.sec('background').querySelectorAll('.tov-row')].find((r) => r.textContent.includes('npm test')).click();
  await a.settle(12);
  assert.equal(a.panel().querySelector('.tool-body').dataset.kind, 'terminal', 'its shell\'s tab');
});

test('in the real app: a run artifact opens the run artifact viewer (openRunArtifact)', async () => {
  const { KEY, ROW } = await import('./helpers/chat-panel-boot.mjs');
  const a = await boot({ url: `http://localhost:4317/#history/${KEY}/${ROW.id}`, rows: [ROW], runArtifacts: [{ kind: 'plan', relPath: 'plan.md', bytes: 10, nodeId: 'n_plan', cycle: 1 }] });
  await a.settle(12);
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').includes('plan.md')), JSON.stringify(a.rowsOf('artifacts')));
  a.sec('artifacts').querySelector('.tov-row').click();
  await a.settle(12);
  assert.ok(await until(() => a.doc.querySelector('.viewer-modal.apv:not(.hidden)')), 'the artifact viewer');
});

test('in the real app: a project page Overview lists its live runs, then History (liveRunsOf, historyRows)', async () => {
  const { KEY, ROW, liveRun } = await import('./helpers/chat-panel-boot.mjs');
  const tools = { v: 1, tabs: [], active: {}, prefs: { width: 460 }, open: [`project:${KEY}`] };
  const a = await boot({ url: `http://localhost:4317/#projects/${KEY}`, rows: [ROW], local: { 'worca-cc.tools': JSON.stringify(tools) } });
  a.dispatch({ type: 'hello', runs: [liveRun({ runId: 'r-live', pipelineId: 'beef0001', title: 'Live one', projectDir: '/tmp/proj' })] });
  await a.settle(12);
  if (a.panel().hidden || a.panel().querySelector('.tool-body').dataset.kind !== 'overview') { a.go(`projects/${KEY}`); await a.settle(12); }
  assert.equal(a.panel().querySelector('.tool-body').dataset.kind, 'overview', 'the project\'s no-tab view');
  assert.ok(await until(() => a.rowsOf('runs').length === 2), JSON.stringify(a.rowsOf('runs')));
  assert.deepEqual(a.rowsOf('runs'), ['Live one', ROW.title]);
});

test('in the real app: a Background meta reads the clock (now): a service started 2 min ago shows its uptime', async () => {
  const a = await boot({ running: () => [{ instanceId: 'inst_1', runId: 'aaaa0001', kind: 'service', label: 'Web', url: 'http://localhost:4417/', startedAt: new Date(Date.now() - 125000).toISOString() }] });
  a.dispatch({ type: 'hello', runs: [] });
  await a.settle(8);
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('background').includes('Web')), JSON.stringify(a.rowsOf('background')));
  const meta = [...a.sec('background').querySelectorAll('.tov-row')].find((r) => r.textContent.includes('Web')).querySelector('.tov-meta').textContent;
  assert.match(meta, /^2m \d+s$/, meta);
});

test('in the real app: a command\'s done frame drops its Background row at once (commands is emitted after the card updates)', async () => {
  const CMD = { kind: 'card', id: 'card_000000c1', state: 'command', card: { type: 'command', blockId: 't-0000000001:1', sessionId: 't-0000000001', seq: 1, command: 'npm test', folder: 'app', cwd: '/tmp/app', warning: null } };
  const a = await boot({ blocks: [CMD] });
  a.dispatch({ type: 'hello', runs: [] });
  await a.settle(8);
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('background').includes('npm test')), JSON.stringify(a.rowsOf('background')));
  a.dispatch({ type: 'ask-command', threadId: TID, command: { blockId: 't-0000000001:1', sessionId: 't-0000000001', status: 'done', exitCode: 0, tail: '', command: 'npm test', startedAt: new Date().toISOString() } });
  await a.settle(2);
  assert.deepEqual(a.rowsOf('background'), [], 'no row for the finished command');
});

test('in the real app: Context\'s actions are the chat panel\'s: one worktree refresh per mount, the trash removes it, a topic routes', async () => {
  const WT = { worktreeId: 'wt_00000001', projectKey: PK, ref: 'dev', commit: 'abcdef1234567', path: '/tmp/wt/app', createdAt: null };
  const { ok } = await import('./helpers/chat-panel-boot.mjs');
  const gets = [];
  const dels = [];
  const a = await boot({ more: (u, opts) => {
    const path = u.split('?')[0];
    const m = (opts.method || 'GET').toUpperCase();
    if (path.endsWith(`/api/ask/threads/${TID}`) && m === 'GET') {
      gets.push(path);
      return ok({ thread: { id: TID, title: 'Overview chat', createdAt: 't', updatedAt: 't', context: { pinned: true, projectKey: PK },
        contexts: [{ kind: 'project', id: 'proj-alpha-abcd1234', label: 'Alpha' }], totals: { ctx: 120400, ctxWindow: 1000000, turns: 1, costUsd: 0.4 } },
      attachments: [], runLinks: [], worktrees: [WT], inFlight: null, messages: [{ id: 'askm_00000001', threadId: TID, seq: 1, role: 'assistant', text: 'Done.', blocks: [], status: 'done', createdAt: 't' }] });
    }
    if (path.endsWith(`/api/ask/threads/${TID}/worktrees/${WT.worktreeId}`) && m === 'DELETE') { dels.push(path); return ok({ ok: true }); }
    return null;
  } });
  const before = gets.length;
  a.doc.querySelector('.chat-head-meter').click();
  await a.settle(12);
  assert.ok(await until(() => a.sec('context')?.querySelector('.tov-body .ask-wt-row')), 'the worktree row');
  await a.settle(12);
  assert.equal(gets.length, before + 1, 'refresh: one worktrees GET when Context opens');
  a.dispatch({ type: 'ask-worktrees', threadId: TID, worktrees: [WT] });   // a later redraw of Context
  await a.settle(12);
  await wait(40);
  assert.ok(a.sec('context').querySelector('.tov-body .ask-wt-row'));
  assert.equal(gets.length, before + 1, 'no second refresh on a redraw (once per mount)');
  a.sec('context').querySelector('.tov-body .ask-wt-row .ask-thread-trash').click();
  await a.settle(6);
  a.doc.getElementById('confirm-ok').click();
  assert.ok(await until(() => dels.length === 1), 'removeWorktree: the DELETE');
  a.sec('context').querySelector('.tov-body .ask-ctx-topic').click();
  await a.settle(6);
  assert.equal(a.window.location.hash, '#projects/proj-alpha-abcd1234', 'openTopic: the topic\'s page');
});
