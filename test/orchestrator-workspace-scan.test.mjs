// test/orchestrator-workspace-scan.test.mjs
// A wf_workspace_scan run is READ-ONLY (nothing committed, every member's run branch
// deleted at teardown) and, on done, saves the scanner output as the workspace.
// Sandboxed like orchestrator-workspace.test.mjs: throwaway repos, temp WORCA_HOME,
// a product-repo leak guard.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { projectKey } from '../src/core/store.mjs';
import { workspaceKey, createWorkspace, readWorkspace } from '../src/core/workspaces.mjs';
import { WORKSPACE_SCAN_WORKFLOW_ID } from '../src/core/graph/builtin-workflows.mjs';
import { WORKSPACE_SCAN_OUTPUT_FILE } from '../src/core/workspace-scan-run.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

const _prevRunRootMode = process.env.WORCA_RUN_ROOT;
beforeEach(() => { process.env.WORCA_RUN_ROOT = 'detached'; });
after(() => {
  if (_prevRunRootMode === undefined) delete process.env.WORCA_RUN_ROOT;
  else process.env.WORCA_RUN_ROOT = _prevRunRootMode;
});

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

const PRODUCT_REPO = process.cwd();
const gitLines = (args) => spawnSync('git', ['-C', PRODUCT_REPO, ...args]).stdout.toString()
  .split(/\r?\n/).map((s) => s.trim()).filter(Boolean).sort();
const baselineBranches = gitLines(['branch', '--list', 'worca-cc/*']);
after(() => assert.deepEqual(gitLines(['branch', '--list', 'worca-cc/*']), baselineBranches, 'no branch leaked into the product repo'));

async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wsscan-'));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'seed.txt'), 'seed\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}
const branches = (dir) => spawnSync('git', ['-C', dir, 'branch', '--format=%(refname:short)'])
  .stdout.toString().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const head = (dir) => spawnSync('git', ['-C', dir, 'rev-parse', 'main']).stdout.toString().trim();

/** The opts the server builds for a scan (D3): the synthetic target keyed by workspaceKey. */
function scanOpts(dirs, name = 'Scan WS', workflowId = WORKSPACE_SCAN_WORKFLOW_ID) {
  const id = workspaceKey({ name, projectPaths: dirs });
  const projects = dirs
    .map((d) => ({ projectDir: d, projectKey: projectKey(d), projectName: basename(d), branch: { source: 'main' } }))
    .sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0));
  return {
    workspace: { id, key: id, name, description: '', projects },
    branch: { source: 'main' },
    workflowId,
    prompt: `Scan the interconnections of the workspace "${name}".`,
    auto: true,
    claude: { mock: true },
  };
}

test('a scan run is read-only: done, no commit, every member branch deleted, checkouts gone', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const before = { [a]: head(a), [b]: head(b) };
  const orch = createOrchestrator(scanOpts([a, b]));
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const state = orch.getState();
  for (const dir of [a, b]) {
    const k = projectKey(dir);
    assert.equal(head(dir), before[dir], `${k}: main untouched`);
    assert.deepEqual(branches(dir), ['main'], `${k}: the run branch is deleted`);
    assert.ok(!existsSync(state.branches[k].worktreeDir), `${k}: checkout removed`);
    assert.equal(state.branches[k].branchKept, false);
  }
});

test('legacy run-root mode deletes the branches too', async () => {
  process.env.WORCA_RUN_ROOT = 'legacy';
  const a = await freshRepo();
  const b = await freshRepo();
  const orch = createOrchestrator(scanOpts([a, b], 'Legacy Scan'));
  assert.equal((await orch.run()).status, 'done');
  assert.deepEqual(branches(a), ['main']);
  assert.deepEqual(branches(b), ['main']);
});

test('done creates the workspace from the scanner output (the run id IS the workspace id)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const opts = scanOpts([a, b], 'Created WS');
  const orch = createOrchestrator(opts);
  assert.equal((await orch.run()).status, 'done');
  const ws = await readWorkspace(opts.workspace.id);
  assert.ok(ws, 'workspace created');
  assert.equal(ws.name, 'Created WS');
  assert.match(ws.description, /## Interconnections/);
  const out = await readFile(join(orch.getState().pipelineDir, WORKSPACE_SCAN_OUTPUT_FILE), 'utf8');
  assert.equal(ws.description, out.trim());
  assert.equal(orch.state.workspaceScan.outcome, 'created');
});

test('re-scan: an existing workspace gets its description replaced (outcome updated)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Rescan WS', projectPaths: [a, b], description: 'old' });
  const opts = scanOpts([a, b], 'Rescan WS');
  assert.equal(opts.workspace.id, ws.id);
  const orch = createOrchestrator(opts);
  assert.equal((await orch.run()).status, 'done');
  assert.equal(orch.state.workspaceScan.outcome, 'updated');
  assert.match((await readWorkspace(ws.id)).description, /## Interconnections/);
});

test('finalize conflict: a name taken meanwhile leaves the run done with a warning, nothing saved', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  await createWorkspace({ name: 'Taken', projectPaths: [a, c] });
  const opts = scanOpts([a, b], 'Taken');
  const orch = createOrchestrator(opts);
  assert.equal((await orch.run()).status, 'done');
  assert.equal(orch.state.workspaceScan.outcome, 'failed');
  assert.equal(orch.state.workspaceScan.code, 'DUPLICATE_NAME');
  assert.equal(await readWorkspace(opts.workspace.id), null);
  assert.ok(existsSync(join(orch.getState().pipelineDir, WORKSPACE_SCAN_OUTPUT_FILE)), 'description kept in the run');
});

// The FIRST `exec` event is the preflight bookend (no checkout, no branch yet) — a stop hooked
// there proves nothing. Hook the scanner node's own start: every member run branch exists then.
const onScanStart = (orch, fn) => {
  const onExec = (p) => {
    if (p.nodeId !== 'n_scan' || p.status !== 'start') return;
    orch.off('exec', onExec);
    fn();
  };
  orch.on('exec', onExec);
};

test('stopped scan: nothing saved, no branch left', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const opts = scanOpts([a, b], 'Stopped WS');
  const orch = createOrchestrator(opts);
  let branchedAtStop = false;
  onScanStart(orch, () => {
    branchedAtStop = branches(a).length > 1 && branches(b).length > 1;
    orch.stop();
  });
  const res = await orch.run();
  assert.equal(res.status, 'stopped');
  assert.ok(branchedAtStop, 'the stop landed after every member run branch existed');
  assert.equal(await readWorkspace(opts.workspace.id), null);
  assert.deepEqual(branches(a), ['main']);
  assert.deepEqual(branches(b), ['main']);
});

test('a paused scan keeps its branches; resume() ends done, saves the workspace, deletes the branches', async () => {
  const { createOrchestratorFor } = await import('../src/core/engine-select.mjs');
  const { readPipelineForResume } = await import('../src/core/artifacts.mjs');
  const a = await freshRepo();
  const b = await freshRepo();
  const opts = scanOpts([a, b], 'Paused WS');
  const orch = createOrchestrator(opts);
  onScanStart(orch, () => orch.pause());
  assert.equal((await orch.run()).status, 'paused');
  assert.equal(branches(a).length, 2, 'paused: the run branch is kept (it resumes into it)');
  assert.equal(await readWorkspace(opts.workspace.id), null, 'paused: nothing saved');
  // Rebuild the target exactly like the server's resumeRun does: from workspace_meta, never from
  // the workspaces table (the workspace does not exist yet).
  const saved = readPipelineForResume(orch.state.id);
  const meta = JSON.parse(saved.row.workspace_meta);
  const orch2 = await createOrchestratorFor({
    projectDir: meta.projects[0].projectDir,
    workspace: { id: meta.workspaceId, key: saved.row.workspace_key, name: meta.workspaceName, description: '', projects: meta.projects },
    claude: { mock: true }, auto: true, resume: saved,
  });
  assert.equal((await orch2.resume()).status, 'done');
  assert.equal(orch2.state.workspaceScan.outcome, 'created');
  assert.ok(await readWorkspace(opts.workspace.id), 'the resumed scan saved the workspace');
  assert.deepEqual(branches(a), ['main']);
  assert.deepEqual(branches(b), ['main']);
});

test('_commitWork commits nothing on a scan run, and still commits on any other workspace run', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const dirty = await freshRepo();
  await writeFile(join(dirty, 'agent-edit.txt'), 'x\n');
  const scan = createOrchestrator(scanOpts([a, b], 'Commit Scan'));
  const r1 = await scan._commitWork({ worktreeDir: dirty }, null);
  assert.equal(r1.committed, false);
  assert.match(spawnSync('git', ['-C', dirty, 'status', '--porcelain']).stdout.toString(), /agent-edit\.txt/, 'left uncommitted');
  const normal = createOrchestrator(scanOpts([a, b], 'Commit Normal', 'wf_default'));
  const r2 = await normal._commitWork({ worktreeDir: dirty }, null);
  assert.equal(r2.committed, true, 'a non-scan workspace run still commits');
});

test('wf_workspace_scan on a single-project target is refused at construction (D20)', async () => {
  const a = await freshRepo();
  assert.throws(() => createOrchestrator({ projectDir: a, workflowId: WORKSPACE_SCAN_WORKFLOW_ID, prompt: 'x', claude: { mock: true } }),
    /runs over a workspace only/);
});

test('_isWorkspaceScan reads workflowId live (resume() restores it after construction)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const orch = createOrchestrator(scanOpts([a, b], 'Live', 'wf_default'));
  assert.equal(orch._isWorkspaceScan(), false);
  orch.workflowId = WORKSPACE_SCAN_WORKFLOW_ID;
  assert.equal(orch._isWorkspaceScan(), true);
});

const scanNode = (orch) => orch.state.stepper.graph.nodes.find((n) => n.id === 'n_scan');

test('scan models pin the scan node and its investigators (the manifest records them)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const orch = createOrchestrator({
    ...scanOpts([a, b], 'Pinned WS'),
    scanModels: { scanModel: 'claude-opus-5-5', scanEffort: 'high', agentModel: 'fable', agentEffort: 'max', source: 'explicit', warning: null },
  });
  assert.equal((await orch.run()).status, 'done');
  const n = scanNode(orch);
  assert.equal(n.model, 'claude-opus-5-5');
  assert.equal(n.effort, 'high');
  assert.equal(n.subagentModel, 'fable');
  assert.equal(n.subagentEffort, 'max');
});

test('no scan models: the template defaults (Sonnet 5 · medium, sonnet · medium)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const orch = createOrchestrator(scanOpts([a, b], 'Default Models WS'));
  assert.equal((await orch.run()).status, 'done');
  const n = scanNode(orch);
  assert.deepEqual([n.model, n.effort, n.subagentModel, n.subagentEffort], ['claude-sonnet-5', 'medium', 'sonnet', 'medium']);
});

test('a stale stored pick runs on the defaults and says so in the run log (Review Focus 5)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const warning = 'Workspace scan models (Settings › General › Workspaces) no longer fit: unknown model "gone-model"';
  const orch = createOrchestrator({
    ...scanOpts([a, b], 'Stale Pick WS'),
    // What resolveScanModels hands back for a stored pick that left the catalog.
    scanModels: { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium', source: 'default', warning },
  });
  const logs = [];
  orch.on('log', (e) => logs.push(e));
  assert.equal((await orch.run()).status, 'done');
  assert.ok(logs.some((e) => e.level === 'warn' && e.text === warning), 'the warning is in the run log');
  assert.ok(logs.some((e) => e.text === 'Workspace scan models: scan agent claude-sonnet-5 · medium, project agents sonnet · medium (default)'));
});
