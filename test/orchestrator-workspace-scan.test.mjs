// test/orchestrator-workspace-scan.test.mjs
// A wf_workspace_scan run is READ-ONLY (nothing committed, every member's run branch
// deleted at teardown) and, on done, saves the render stage's description as the workspace.
// The scan is the hybrid map pipeline (wsmap P2): in mock mode the four scripts run FOR REAL
// and the three agents write their mock JSON, so extract -> survey -> catalog -> usage -> join
// -> synth -> render -> finalize runs end to end, in both run-root modes.
// Sandboxed like orchestrator-workspace.test.mjs: throwaway repos, temp WORCA_HOME,
// a product-repo leak guard.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename, resolve } from 'node:path';

import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { projectKey } from '../src/core/store.mjs';
import { workspaceKey, createWorkspace, readWorkspace } from '../src/core/workspaces.mjs';
import { WORKSPACE_SCAN_WORKFLOW_ID } from '../src/core/graph/builtin-workflows.mjs';
import { WORKSPACE_SCAN_OUTPUT_FILE } from '../src/core/workspace-scan-run.mjs';
import { checkSurvey, checkUsage, checkSynthesis } from '../src/shared/workspace-map/schema.mjs';
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

/** A throwaway committed repo; `files` are top-level names -> contents. */
async function freshRepo(label = 'm', files = { 'seed.txt': 'seed\n' }) {
  const dir = await mkdtemp(join(tmpdir(), `worca-cc-wsscan-${label}-`));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  for (const [rel, text] of Object.entries(files)) await writeFile(join(dir, rel), text);
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
  const out = await readFile(runFile(orch.getState().pipelineDir, WORKSPACE_SCAN_OUTPUT_FILE), 'utf8');
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
  assert.ok(existsSync(runFile(orch.getState().pipelineDir, WORKSPACE_SCAN_OUTPUT_FILE)), 'description kept in the run');
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

const manifestNode = (orch, id) => orch.state.stepper.graph.nodes.find((n) => n.id === id);

/** orch.run() that a node:test timeout stops: the scan's cards are children with 30-minute timeouts,
 *  and without a stop a hung one keeps the file alive long past the test. node:test also aborts
 *  `t.signal` after a NORMAL end, so the listener lives only while the run is pending. */
async function runUntilAbort(t, orch) {
  const stop = () => orch.stop();
  t.signal.addEventListener('abort', stop, { once: true });
  try {
    return await orch.run();
  } finally {
    t.signal.removeEventListener('abort', stop);
  }
}

test('scan models pin all three agent nodes and the investigators of both fan-out stages (D10; the manifest records them)', async (t) => {
  const a = await freshRepo();
  const b = await freshRepo();
  const orch = createOrchestrator({
    ...scanOpts([a, b], 'Pinned WS'),
    scanModels: { scanModel: 'claude-opus-5-5', scanEffort: 'high', agentModel: 'fable', agentEffort: 'max', source: 'explicit', warning: null },
  });
  assert.equal((await runUntilAbort(t, orch)).status, 'done');
  const n = scanNode(orch);
  assert.equal(n.model, 'claude-opus-5-5');
  assert.equal(n.effort, 'high');
  assert.equal(n.subagentModel, 'fable');
  assert.equal(n.subagentEffort, 'max');
  const u = manifestNode(orch, 'n_usage');
  assert.deepEqual([u.model, u.effort, u.subagentModel, u.subagentEffort, u.fanOut], ['claude-opus-5-5', 'high', 'fable', 'max', true]);
  const y = manifestNode(orch, 'n_synth');
  assert.deepEqual([y.model, y.effort, y.fanOut], ['claude-opus-5-5', 'high', false]);
});

test('no scan models: the template defaults on all three agent nodes (Sonnet 5 · medium, sonnet · medium)', async (t) => {
  const a = await freshRepo();
  const b = await freshRepo();
  const orch = createOrchestrator(scanOpts([a, b], 'Default Models WS'));
  assert.equal((await runUntilAbort(t, orch)).status, 'done');
  for (const id of ['n_scan', 'n_usage']) {
    const n = manifestNode(orch, id);
    assert.deepEqual([n.model, n.effort, n.subagentModel, n.subagentEffort], ['claude-sonnet-5', 'medium', 'sonnet', 'medium'], id);
  }
  const y = manifestNode(orch, 'n_synth');
  assert.deepEqual([y.model, y.effort], ['claude-sonnet-5', 'medium']);
});

test('a stale stored pick runs on the defaults and says so in the run log (Review Focus 5)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const warning = 'Workspace scan models (Settings › Runs › Workspaces) no longer fit: unknown model "gone-model"';
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

// ── the hybrid map, end to end (wsmap P2) ────────────────────────────────────
// Two members with a real npm dependency: static extraction finds it (pkg-npm), the catalog lists
// lib's package, the mock usage confirms the candidate, the join makes it an exact edge and the
// render lists it under ## Interconnections — then the finalize saves exactly that description.

const LIB_PKG = `${JSON.stringify({ name: '@wsmap/lib', version: '1.0.0' }, null, 2)}\n`;
const APP_PKG = `${JSON.stringify({ name: '@wsmap/app', version: '1.0.0', dependencies: { '@wsmap/lib': '^1.0.0' } }, null, 2)}\n`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * A run file by BARE NAME. Run-folder artifacts (D1) allocate each execution's
 * outputs into its own steps/<node>-c<N>/ folder, so a scan's stage files no longer
 * sit at the run root. Mirrors workspace-scan-run.mjs#runFilePath: the root first
 * (the older layout, and the envelopes that still live there), then the most
 * recently written match under steps/. Returns the root path when nothing matches,
 * so a failing assertion still names the place a reader would look first.
 */
function runFile(dir, rel) {
  const atRoot = join(dir, rel);
  if (existsSync(atRoot)) return atRoot;
  const steps = join(dir, 'steps');
  if (!existsSync(steps)) return atRoot;
  let best = null;
  for (const name of readdirSync(steps)) {
    const p = join(steps, name, rel);
    if (!existsSync(p)) continue;
    const t = statSync(p).mtimeMs;
    if (!best || t > best.t) best = { p, t };
  }
  return best ? best.p : atRoot;
}

const V3_FILES = ['extract.json', 'survey-brief.md', 'survey.json', 'catalog.json', 'usage-brief.md', 'usage.json',
  'workspace-map.json', 'synth-brief.md', 'synthesis.json', WORKSPACE_SCAN_OUTPUT_FILE];

async function npmPair() {
  const lib = await freshRepo('lib', { 'package.json': LIB_PKG, 'README.md': '# lib\n\nShared helpers for the app.\n' });
  const app = await freshRepo('app', { 'package.json': APP_PKG, 'README.md': '# app\n\nThe web app.\n' });
  return { lib, app };
}

/** Every stage's file is in the run folder, every agent document passes P1's checker, the npm
 *  dependency is an exact app -> lib edge and a line under ## Interconnections. */
async function assertMapped(orch, { lib, app }) {
  const dir = orch.getState().pipelineDir;
  for (const f of V3_FILES) assert.ok(existsSync(runFile(dir, f)), `${f} written`);
  const keys = [projectKey(app), projectKey(lib)].sort();
  for (const k of keys) assert.ok(existsSync(runFile(dir, join('usage-briefs', `${k}.md`))), `usage-briefs/${k}.md written`);
  const read = async (f) => JSON.parse(await readFile(runFile(dir, f), 'utf8'));
  const survey = checkSurvey(await read('survey.json'), { memberKeys: keys });
  assert.equal(survey.ok, true, survey.errors.join('\n'));
  const entryIds = (await read('catalog.json')).entries.map((e) => e.id);
  const usage = checkUsage(await read('usage.json'), { memberKeys: keys, entryIds });
  assert.equal(usage.ok, true, usage.errors.join('\n'));
  const synthesis = checkSynthesis(await read('synthesis.json'), { memberKeys: keys });
  assert.equal(synthesis.ok, true, synthesis.errors.join('\n'));
  const map = await read('workspace-map.json');
  const edge = map.edges.find((e) => e.from === projectKey(app) && e.to === projectKey(lib) && e.kind === 'pkg');
  assert.ok(edge, `the npm dependency is an edge: ${JSON.stringify(map.edges)}`);
  assert.equal(edge.confidence, 'exact');
  const md = await readFile(runFile(dir, WORKSPACE_SCAN_OUTPUT_FILE), 'utf8');
  const inter = md.split('\n## Interconnections\n')[1]?.split('\n## ')[0] ?? '';
  // Case-insensitive: a projectKey lower-cases the dir name the member's display name keeps.
  assert.match(inter, new RegExp(`^- .*${esc(basename(app))}.* -> .*${esc(basename(lib))}`, 'mi'), md);
  return { dir, keys, md };
}

/** The extract card's audit envelope (script-runner.mjs envelopeAuditPath) — what the program saw. */
async function extractEnvelope(dir) {
  return JSON.parse(await readFile(join(dir, 'scripts', 'n_extract-c1.envelope.json'), 'utf8'));
}

test('v3 end to end (detached): the npm dependency is an exact edge in the map and a line in the saved description', async (t) => {
  const pair = await npmPair();
  const opts = scanOpts([pair.app, pair.lib], 'Map WS');
  const orch = createOrchestrator(opts);
  assert.equal((await runUntilAbort(t, orch)).status, 'done');
  const { dir, keys, md } = await assertMapped(orch, pair);
  const env = await extractEnvelope(dir);
  assert.deepEqual(env.ctx.workspace.members.map((m) => m.key), keys, 'members sorted by key');
  assert.equal(env.ctx.workspace.id, opts.workspace.id);
  assert.equal(env.ctx.workspace.name, 'Map WS');
  for (const m of env.ctx.workspace.members) {
    // endsWith, not equal: on macOS the checkout is realpath'd (/private/var/…) while runRoot is not.
    assert.ok(m.dir.endsWith(join('.worca-cc', 'runs', basename(env.ctx.runRoot), 'repos', m.key)), `detached: the run-root checkout, got ${m.dir}`);
    assert.equal(m.projectDir, resolve(m.key === projectKey(pair.app) ? pair.app : pair.lib), 'the live project');
  }
  assert.deepEqual(env.ctx.repos.map((r) => r.key), keys);
  const ex = JSON.parse(await readFile(runFile(dir, 'extract.json'), 'utf8'));
  for (const m of env.ctx.workspace.members) assert.equal(ex.members[m.key].dir, m.dir, 'extract scans the run checkout, not the live project');
  assert.equal((await readWorkspace(opts.workspace.id)).description, md.trim(), 'the finalize saved the rendered description');
});

test('v3 end to end (legacy run-root): the scripts still see every member — ctx.workspace, not ctx.repos — and map the edge', async (t) => {
  process.env.WORCA_RUN_ROOT = 'legacy';
  const pair = await npmPair();
  const opts = scanOpts([pair.app, pair.lib], 'Legacy Map WS');
  const orch = createOrchestrator(opts);
  assert.equal((await runUntilAbort(t, orch)).status, 'done');
  const { dir, keys } = await assertMapped(orch, pair);
  const env = await extractEnvelope(dir);
  assert.equal(env.ctx.runRoot, null);
  assert.equal(env.ctx.repos, null, 'legacy: no repos list');
  assert.deepEqual(env.ctx.workspace.members.map((m) => m.key), keys);
  for (const m of env.ctx.workspace.members) {
    assert.ok(m.dir.includes(join('.worca-cc', 'worktrees')), `legacy checkout: ${m.dir}`);
    assert.equal(m.projectDir, resolve(m.key === projectKey(pair.app) ? pair.app : pair.lib));
  }
  assert.equal(orch.state.workspaceScan.outcome, 'created');
});

// The P1 ↔ P2 mock seam: the npm pair above yields NO candidate (P1 never searches a member for an
// entry it already consumes statically), so its usage.json is always empty. Here `tool` uses lib in
// code with no manifest dependency: the candidate scan finds the literal, the usage mock confirms it,
// and the join verifies the cited line into a `verified` edge.
test('v3 end to end: a literal use the candidate scan finds is confirmed by the usage mock and joined as a verified edge', async (t) => {
  const lib = await freshRepo('lib', { 'package.json': LIB_PKG, 'README.md': '# lib\n\nShared helpers for the app.\n' });
  const tool = await freshRepo('tool', { 'run.js': "const lib = require('@wsmap/lib');\nmodule.exports = lib;\n" });
  const orch = createOrchestrator(scanOpts([tool, lib], 'Candidate WS'));
  assert.equal((await runUntilAbort(t, orch)).status, 'done');
  const dir = orch.getState().pipelineDir;
  const read = async (f) => JSON.parse(await readFile(runFile(dir, f), 'utf8'));
  const keys = [projectKey(lib), projectKey(tool)].sort();
  const catalog = await read('catalog.json');
  const cands = catalog.candidates[projectKey(tool)] || [];
  assert.ok(cands.length >= 1, `the candidate scan finds the literal: ${JSON.stringify(catalog.candidates)}`);
  const usage = await read('usage.json');
  const checked = checkUsage(usage, { memberKeys: keys, entryIds: catalog.entries.map((e) => e.id) });
  assert.equal(checked.ok, true, checked.errors.join('\n'));
  assert.equal(usage.members[projectKey(tool)].uses.length, cands.length, 'every candidate confirmed');
  const map = await read('workspace-map.json');
  const edge = map.edges.find((e) => e.from === projectKey(tool) && e.to === projectKey(lib) && e.kind === 'pkg');
  assert.ok(edge, JSON.stringify(map.edges));
  assert.equal(edge.confidence, 'verified');
  assert.deepEqual(edge.sources, ['candidate', 'usage']);
});

// Review Focus 1 through the engine: an agent node that "finishes" without its file still publishes
// its output token, and every awaitAll card downstream runs on the missing input.
test('v3 end to end: survey, usage and synthesis files that never appear still end the scan done with a description', async (t) => {
  const pair = await npmPair();
  const opts = scanOpts([pair.app, pair.lib], 'Missing Files WS');
  const orch = createOrchestrator(opts);
  // The agents "finish" but their files are gone by the time the next card reads them.
  const drop = { n_catalog: 'survey.json', n_join: 'usage.json', n_render: 'synthesis.json' };
  const orig = orch._execCtx.bind(orch);
  orch._execCtx = (node, nc, args) => {
    // runFile, not the run root: the file this drops is the PREVIOUS card's output,
    // which now lives in that execution's step folder.
    if (drop[node.id]) rmSync(runFile(orch.getState().pipelineDir, drop[node.id]), { force: true });
    return orig(node, nc, args);
  };
  assert.equal((await runUntilAbort(t, orch)).status, 'done');
  const dir = orch.getState().pipelineDir;
  const map = JSON.parse(await readFile(runFile(dir, 'workspace-map.json'), 'utf8'));
  assert.ok(map.edges.some((e) => e.from === projectKey(pair.app) && e.to === projectKey(pair.lib) && e.confidence === 'exact'), 'static edges survive');
  assert.ok(map.members.every((m) => m.coverage.usageStatus === 'failed'), 'no usage.json: every member counts as usage failed');
  const catalog = JSON.parse(await readFile(runFile(dir, 'catalog.json'), 'utf8'));
  assert.ok(catalog.errors.some((e) => /^survey: missing/.test(e)), `no survey.json: the catalog ran on a failed survey: ${JSON.stringify(catalog.errors)}`);
  const ws = await readWorkspace(opts.workspace.id);
  assert.match(ws.description, /## Interconnections/);
  assert.match(ws.description, /Workspace of 2 projects/, 'no synthesis: the fallback overview');
  const inter = ws.description.split('\n## Interconnections\n')[1]?.split('\n## ')[0] ?? '';
  assert.match(inter, new RegExp(`^- .*${esc(basename(pair.app))}.* -> .*${esc(basename(pair.lib))}`, 'mi'), 'rendered from the map, not the minimal fallback');
});
