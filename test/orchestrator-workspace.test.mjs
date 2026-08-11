// test/orchestrator-workspace.test.mjs
// Milestone 3: the multi-worktree workspace orchestrator. Mirrors the sandboxing
// of orchestrator-worktree.test.mjs EXACTLY — throwaway temp git repos (in tmpdir,
// never the product repo), tracked in `created[]`, force-removed in after(); an
// isolated WORCA_HOME so the workspace store lands in temp. Every worktree lives
// INSIDE its member's temp repo (<repo>/.worca-cc/worktrees/<id>/), so rm -rf of the
// repo reaps the worktree and the branch with it. After this file runs, the product
// repo's `git worktree list` + `git branch --list worca-cc/*` are unchanged.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { projectKey } from '../src/core/store.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { listAllPipelines, readPipelineForResume, readPipelineExtras } from '../src/core/artifacts.mjs';
import { readRunManifest } from '../src/core/run-manifest.mjs';
import { writeWorkflow } from '../src/core/workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after); // workspace store writes -> isolated temp home, not real ~/.worca-cc

// ── Mode pinning (§6 intro) ───────────────────────────────────────────────────
// Every pre-Phase-1 assertion in this file (placement inside each member's own
// repo, workspace-store routing, teardown branch-kept, the partial-setup leak
// guard) is the §10 LEGACY ROLLBACK GUARD and must stay byte-identical, so the
// default for every test here is a legacy pin applied in beforeEach — no test body
// is rewritten. The new detached siblings at the bottom of this file re-pin
// `detached` as their first statement, which wins because beforeEach ran already.
const _prevRunRootMode = process.env.WORCA_RUN_ROOT;
beforeEach(() => { process.env.WORCA_RUN_ROOT = 'legacy'; });
after(() => {
  if (_prevRunRootMode === undefined) delete process.env.WORCA_RUN_ROOT;
  else process.env.WORCA_RUN_ROOT = _prevRunRootMode;
});

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

// ── Leak guard (M2 regression watchdog) ──────────────────────────────────────
// Every workspace run creates REAL git worktrees + branches inside the throwaway
// temp repos (reaped by the `created` cleanup above). Capture the PRODUCT repo's
// worktree + worca-cc/* branch state at module load and assert, after every test in
// this file, that it is unchanged — so a future regression that points an
// orchestrator at the real repo fails loudly instead of silently polluting it.
const PRODUCT_REPO = process.cwd();
function gitLines(args) {
  return spawnSync('git', ['-C', PRODUCT_REPO, ...args]).stdout.toString()
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean).sort();
}
const baselineWorktrees = gitLines(['worktree', 'list']);
const baselineBranches = gitLines(['branch', '--list', 'worca-cc/*']);
after(() => {
  assert.deepEqual(gitLines(['worktree', 'list']), baselineWorktrees,
    'workspace tests must not add/remove a worktree in the PRODUCT repo');
  assert.deepEqual(gitLines(['branch', '--list', 'worca-cc/*']), baselineBranches,
    'workspace tests must not add a worca-cc/* branch to the PRODUCT repo');
});

/** A fresh throwaway git repo with one commit, on branch `main`. */
async function freshRepo(prefix = 'worca-cc-ws-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'seed.txt'), 'seed\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

function branchList(dir) {
  return spawnSync('git', ['-C', dir, 'branch', '--format=%(refname:short)'])
    .stdout.toString().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** Build the `workspace` opts the server constructs for a run over `dirs`, sorted by projectKey. */
function workspaceOpts(dirs, { name = 'Demo WS', description = '', branch = { source: 'main' } } = {}) {
  const projects = dirs.map((d) => ({ projectDir: d, projectKey: projectKey(d), projectName: require_basename(d) }));
  projects.sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0));
  return {
    workspace: {
      id: `wks-demo-${projects.map((p) => p.projectKey).join('').slice(0, 8)}`,
      key: `wks-demo-${projects.map((p) => p.projectKey).join('').slice(0, 8)}`,
      name, description,
      projects: projects.map((p) => ({ ...p, branch })),
    },
    branch,
  };
}
function require_basename(p) { return p.split('/').filter(Boolean).pop(); }

// ── D3: per-member worktree layout, each in its OWN repo ──────────────────────
test('D3: each member gets a worktree in its OWN repo at .worca-cc/worktrees/<pipelineId>', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({
    ...ws, prompt: 'Add pagination', auto: true, claude: { mock: true },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));

  const state = orch.getState();
  assert.equal(state.target, 'workspace');
  // Both members carry a branch record keyed by projectKey, each worktreeDir inside its own repo.
  const keys = ws.workspace.projects.map((p) => p.projectKey);
  for (const dir of [a, b]) {
    const k = projectKey(dir);
    assert.ok(state.branches[k], `state.branches[${k}] present`);
    assert.ok(
      state.branches[k].worktreeDir.startsWith(join(dir, '.worca-cc', 'worktrees')) ||
      state.branches[k].worktreeDir.includes(join('.worca-cc', 'worktrees')),
      `member ${k} worktree must live inside its own repo: ${state.branches[k].worktreeDir}`,
    );
  }
  // Never a cross-repo checkout: a's branch must not appear in b's repo and vice-versa.
  const featA = state.branches[projectKey(a)].feature;
  const featB = state.branches[projectKey(b)].feature;
  assert.ok(branchList(a).includes(featA), 'feature branch lives in repo a');
  assert.ok(branchList(b).includes(featB), 'feature branch lives in repo b');
  // pipelineId is shared across members (same shortId), so the dir segment matches.
  assert.equal(keys.length, 2);
});

// ── per-project checkpoints ───────────────────────────────────────────────────
test('per-project checkpoint refs are recorded; the scalar mirrors the primary', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  await orch.run();
  const state = orch.getState();
  const ka = projectKey(a), kb = projectKey(b);
  assert.ok(state.checkpointRefs[ka], 'checkpointRefs has member a');
  assert.ok(state.checkpointRefs[kb], 'checkpointRefs has member b');
  assert.match(state.checkpointRefs[ka], /^[0-9a-f]{7,40}$/, 'a real sha for a');
  // Primary = lowest projectKey = projects[0]; the scalar checkpointRef mirrors it.
  const primaryKey = ws.workspace.projects[0].projectKey;
  assert.equal(state.checkpointRef, state.checkpointRefs[primaryKey], 'scalar mirrors primary');
});

// ── C8: scalar state.branch is the primary's OBJECT ───────────────────────────
test('C8: scalar state.branch is an object copied from the primary member', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  await orch.run();
  const state = orch.getState();
  const primaryKey = ws.workspace.projects[0].projectKey;
  assert.equal(typeof state.branch, 'object', 'state.branch is an object (C8), not a string');
  assert.equal(state.branch.feature, state.branches[primaryKey].feature);
  assert.equal(state.branch.source, state.branches[primaryKey].source);
  assert.equal(state.branch.worktreeDir, state.branches[primaryKey].worktreeDir);
  assert.equal('reusedExisting' in state.branch, true);
});

// ── D2: per-project source fallback when the named source is absent ───────────
test('D2: a member lacking the named source branch falls back to its own default', async () => {
  const a = await freshRepo();           // on `main`
  // b is on `master`, has NO `main` branch — the named source must fall back.
  const b = await mkdtemp(join(tmpdir(), 'worca-cc-ws-master-'));
  created.push(b);
  const g = (args) => spawnSync('git', args, { cwd: b });
  g(['init', '-q', '-b', 'master']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(b, 'a.txt'), 'a\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);

  const ws = workspaceOpts([a, b], { branch: { source: 'main' } });
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const state = orch.getState();
  // a resolved source 'main' (present); b fell back to 'master' (its default).
  assert.equal(state.branches[projectKey(a)].source, 'main');
  assert.equal(state.branches[projectKey(b)].source, 'master', 'b fell back to its own default');
});

test('D2: per-project feature branch is the feature + project slug', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b], { branch: { source: 'main', feature: 'add-pagination' } });
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  await orch.run();
  const state = orch.getState();
  for (const dir of [a, b]) {
    const slug = require_basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const feat = state.branches[projectKey(dir)].feature;
    assert.match(feat, /^add-pagination-/, `feature carries the base name: ${feat}`);
    assert.ok(feat.includes(slug.split('-')[0]) || feat.length > 'add-pagination-'.length,
      `feature carries the project slug: ${feat}`);
  }
  // The two members' feature branches differ (per-project slug).
  assert.notEqual(state.branches[projectKey(a)].feature, state.branches[projectKey(b)].feature);
});

test('per-project source: each member uses its own branch.source (the server map result)', async () => {
  // Two repos; give each its own extra source branch, then set distinct per-member sources.
  const a = await freshRepo();
  const b = await freshRepo();
  for (const [dir, br] of [[a, 'develop'], [b, 'release']]) {
    const g = (args) => spawnSync('git', args, { cwd: dir });
    g(['branch', br]); // create the branch the member will be based on
  }
  const ws = workspaceOpts([a, b]); // baseline shape, sorted by projectKey, branch:{source:'main'}
  // Mimic buildWorkspaceMembers: assign each member its own source by projectKey.
  const byKey = { [projectKey(a)]: 'develop', [projectKey(b)]: 'release' };
  ws.workspace.projects = ws.workspace.projects.map((p) => ({ ...p, branch: { source: byKey[p.projectKey], feature: null } }));

  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const state = orch.getState();
  assert.equal(state.branches[projectKey(a)].source, 'develop');
  assert.equal(state.branches[projectKey(b)].source, 'release');
});

// ── description injection + freeze ────────────────────────────────────────────
test('description is frozen at run start onto state + this.workspaceDescription', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b], { description: '# Workspace: Demo\n\nShared REST contract.' });
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  await orch.run();
  const state = orch.getState();
  assert.match(state.workspaceDescription, /Shared REST contract/, 'frozen onto state');
  assert.equal(orch.workspaceDescription, state.workspaceDescription, 'frozen onto the instance');
  // The on-disk frozen snapshot exists in the workspace-store pipeline dir.
  assert.ok(existsSync(join(state.pipelineDir, 'workspace-description.md')));
  const snap = await readFile(join(state.pipelineDir, 'workspace-description.md'), 'utf8');
  assert.match(snap, /Shared REST contract/);
});

// ── createPipeline routed to the workspace store ──────────────────────────────
test('artifacts route to the workspace store (store/workspaces/<key>/pipelines)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  await orch.run();
  const state = orch.getState();
  assert.match(state.pipelineDir, new RegExp(`/store/workspaces/${ws.workspace.key}/pipelines/`),
    `pipeline dir under the workspace store: ${state.pipelineDir}`);
});

// ── teardown: worktrees removed, branches KEPT ────────────────────────────────
test('teardown removes every member worktree but KEEPS every feature branch', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  await orch.run();
  const state = orch.getState();
  for (const dir of [a, b]) {
    const k = projectKey(dir);
    const wtDir = state.branches[k].worktreeDir;
    const feat = state.branches[k].feature;
    assert.ok(!existsSync(wtDir), `member ${k} worktree removed: ${wtDir}`);
    assert.ok(branchList(dir).includes(feat), `member ${k} feature branch KEPT: ${feat}`);
  }
});

// ── _stageWorkingTree stages every member worktree ────────────────────────────
test('_stageWorkingTree stages EVERY member worktree (not just primary)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  // Inject a new file into each member worktree as soon as worktrees exist, then
  // assert the staged diff (vs each checkpoint) shows it for BOTH members.
  let injected = false;
  orch.on('state', (s) => {
    if (injected || !s.branches) return;
    const ka = projectKey(a), kb = projectKey(b);
    if (s.branches[ka]?.worktreeDir && s.branches[kb]?.worktreeDir
        && existsSync(s.branches[ka].worktreeDir) && existsSync(s.branches[kb].worktreeDir)) {
      injected = true;
      writeFileSync(join(s.branches[ka].worktreeDir, 'new-a.txt'), 'a\n');
      writeFileSync(join(s.branches[kb].worktreeDir, 'new-b.txt'), 'b\n');
    }
  });
  await orch.run();
  assert.ok(injected, 'precondition: files injected into both worktrees');
  const state = orch.getState();
  // The kept-branch commit on EACH member must carry its injected file (teardown
  // commits the staged tree). This proves staging reached both worktrees.
  for (const [dir, file] of [[a, 'new-a.txt'], [b, 'new-b.txt']]) {
    const feat = state.branches[projectKey(dir)].feature;
    const show = spawnSync('git', ['-C', dir, 'show', `${feat}:${file}`]);
    assert.equal(show.status, 0, `${file} committed on ${dir}'s kept branch`);
  }
});

// ── partial worktree-setup failure is fully torn down (no leak; §5.10 edge 4) ──
test('a member whose branch is already checked out errors the run and leaks no worktree', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b], { branch: { source: 'main', feature: 'collide' } });
  // Pre-occupy member b's feature branch in a separate live worktree so its
  // createWorktree throws the M2 "already checked out" error mid-setup.
  const bKey = projectKey(b);
  const bSlug = require_basename(b).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const bFeature = `collide-${bSlug}`.slice(0, 80);
  const squatDir = join(b, '.worca-cc', 'worktrees', 'squatter');
  await mkdir(join(b, '.worca-cc', 'worktrees'), { recursive: true });
  const add = spawnSync('git', ['-C', b, 'worktree', 'add', '-b', bFeature, '--', squatDir, 'main']);
  assert.equal(add.status, 0, `precondition: squat b's feature branch: ${add.stderr}`);

  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  const res = await orch.run();
  // The run errors (one member could not get its worktree); whichever member DID
  // get a worktree must be torn down (no orphan checkout dir), branch kept.
  assert.equal(res.status, 'error', JSON.stringify(res));
  const wtBaseA = join(a, '.worca-cc', 'worktrees');
  // a's pipeline-id worktree (if it was created before b threw) must be gone.
  const orphan = existsSync(join(wtBaseA, orch.getState().id || ''));
  assert.ok(!orphan, 'partial worktree for member a must be torn down on setup failure');
});

// ── fan-out node forcing ──────────────────────────────────────────────────────
test('fan-out forcing: a workspace run forces fanOut=true on eligible nodes only', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  // Capture the resolved graph the engine runs by spying on _adoptResolvedGraph
  // (the forcing itself lives there).
  const origAdopt = orch._adoptResolvedGraph.bind(orch);
  let seenResolved = null;
  orch._adoptResolvedGraph = (resolved) => { origAdopt(resolved); seenResolved = resolved; };
  await orch.run();
  assert.ok(seenResolved, 'the graph resolved');
  // The forcing is META-driven now (`workspaceFanOut` on the sidecar), not a key
  // set, and it only ever ADDS: a node that declares it MUST come out fanned out on
  // a workspace run, and a node that does not keeps its own sidecar default.
  let forced = 0;
  for (const node of seenResolved.template.nodes) {
    if (node.kind !== 'agent') continue;
    const nc = seenResolved.nodeCtx[node.id];
    if (nc.meta?.workspaceFanOut) {
      forced += 1;
      assert.equal(nc.fanOut, true, `node ${node.key} declares workspaceFanOut and must be forced`);
      assert.equal(node.fanOut, true, `node ${node.key}: ctxFanOut reads the node first`);
    } else {
      assert.equal(nc.fanOut, !!nc.meta?.fanOut,
        `node ${node.key} does NOT declare workspaceFanOut, so it keeps its sidecar default`);
    }
  }
  assert.ok(forced > 0, 'at least one node was forced');
  // M4: the review node is substituted reviewer -> workspaceReviewer (workflows.mjs),
  // so the resolved workspace graph carries a fanned-out workspaceReviewer and NO
  // single-project reviewer node.
  const agents = Object.values(seenResolved.nodeCtx).filter((nc) => nc.kind === 'agent');
  const wsReviewer = agents.find((nc) => nc.key === 'workspaceReviewer');
  assert.ok(wsReviewer, 'workspace graph contains a workspaceReviewer node');
  assert.equal(wsReviewer.fanOut, true, 'the workspaceReviewer node is forced fanOut');
  assert.ok(!agents.some((nc) => nc.key === 'reviewer'), 'no single-project reviewer node in a workspace graph');
});

// ── fan-out forcing, BOTH ways, with the flagged builtins named ───────────────
// `workspaceFanOut` replaced v1's FANOUT_ELIGIBLE key set, so the positive AND the
// negative branch need a node in one graph: the five builtins that declare the flag
// (planner, refiner, implementer, planReviewer, and the substituted workspaceReviewer)
// must come out forced, and a USER agent the engine has never heard of — no flag —
// must keep its own sidecar default. wf_default places neither planReviewer nor a
// user agent, so this test writes its own template.

/** The five builtin agent keys whose sidecars declare `workspaceFanOut`. */
const FLAGGED_BUILTINS = ['implementer', 'planReviewer', 'planner', 'refiner', 'workspaceReviewer'];

/** Register a user producer sidecar with NO `workspaceFanOut` under <worcaHome>/agents. */
async function writeProbeAgent() {
  const dir = join(worcaHome(), 'agents');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'wsProbe.md'), '# WS Probe\n\nYou take notes.\n');
  await writeFile(join(dir, 'wsProbe.meta.json'), JSON.stringify({
    metaVersion: 2,
    key: 'wsProbe', displayName: 'WS Probe', description: 'a user producer with no workspace flag',
    color: 'green', icon: '<p/>', agentFile: 'wsProbe.md', runnerType: 'producer', order: 30,
    inputs: [{ id: 'plan', type: 'md' }],
    outputs: [{ id: 'notes', type: 'md', filename: 'ws-probe-notes.md' }],
  }));
  return () => Promise.all(['wsProbe.md', 'wsProbe.meta.json']
    .map((f) => rm(join(dir, f), { force: true })));
}

/** wf_default's spine plus a planReviewer and the unflagged user probe, both fed
 *  off `refiner.plan`. Their own outputs stay unwired — nothing downstream depends
 *  on them, so the run still converges through `reviewer.pass -> End`. */
const WS_FORCING_GRAPH = {
  name: 'Workspace forcing probe',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 360, y: 198, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 660, y: 198, config: {} },
    { id: 'n_pr', kind: 'agent', key: 'planReviewer', x: 660, y: 440, config: {} },
    { id: 'n_probe', kind: 'agent', key: 'wsProbe', x: 660, y: 680, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 960, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1260, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 1560, y: 198, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w3', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w4', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_pr', port: 'plan' } },
    { id: 'w5', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_probe', port: 'plan' } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w7', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w8', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w9', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w10', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};

test('fan-out forcing: the five flagged builtins are forced, an unflagged custom agent is NOT', async () => {
  const cleanupAgent = await writeProbeAgent();
  try {
    const a = await freshRepo();
    const b = await freshRepo();
    const wf = await writeWorkflow(structuredClone(WS_FORCING_GRAPH));
    const orch = createOrchestrator({
      ...workspaceOpts([a, b]), workflowId: wf.id, prompt: 'x', auto: true, claude: { mock: true },
    });
    const origAdopt = orch._adoptResolvedGraph.bind(orch);
    let seenResolved = null;
    orch._adoptResolvedGraph = (resolved) => { origAdopt(resolved); seenResolved = resolved; };
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    assert.ok(seenResolved, 'the graph resolved');

    const byKey = {};
    for (const node of seenResolved.template.nodes) {
      if (node.kind !== 'agent') continue;
      byKey[node.key] = { node, nc: seenResolved.nodeCtx[node.id] };
    }
    // POSITIVE: every flagged builtin is present in this graph and comes out forced.
    assert.deepEqual(
      Object.keys(byKey).filter((k) => byKey[k].nc.meta?.workspaceFanOut).sort(),
      FLAGGED_BUILTINS,
      'exactly the five flagged builtins declare workspaceFanOut in this graph',
    );
    for (const key of FLAGGED_BUILTINS) {
      const { node, nc } = byKey[key];
      assert.equal(nc.fanOut, true, `${key} declares workspaceFanOut and must be forced`);
      assert.equal(node.fanOut, true, `${key}: ctxFanOut reads the node first`);
    }
    // NEGATIVE: the user agent has no flag, so the forcing pass leaves it alone —
    // its sidecar default (no `fanOut`) stands and the template node is untouched.
    const probe = byKey.wsProbe;
    assert.ok(probe, 'the user agent is a real node in the resolved workspace graph');
    assert.equal(probe.nc.meta.workspaceFanOut, undefined, 'precondition: the probe declares no flag');
    assert.equal(probe.nc.fanOut, false, 'an unflagged custom agent is NOT forced on a workspace run');
    assert.equal(probe.node.fanOut, undefined, 'and its template node is never stamped');
  } finally {
    await cleanupAgent();
  }
});

// ── substitution via workspaceVariantOf + the ws-review filenames ─────────────
// The workspace review node is not a key branch in the engine: workspaceReviewer
// declares `workspaceVariantOf: 'reviewer'`, so resolveGraph swaps the key on a
// workspace run and the run's verdicts land under the VARIANT's own filename
// template (ws-review-cycleN.json -> reviews.kind 'ws').

/** The META port signature workflows.mjs compares before it accepts a variant:
 *  ids, types and the required/loop/expands/when flags. Renderer hints, filenames
 *  and stores are excluded (a variant writes its own files by design), and the
 *  synthesized `await` input is added ABOVE the meta layer, so it never shows up. */
function metaPortSignature(meta) {
  return {
    inputs: (meta.inputs || []).map((p) => ({
      id: p.id, type: p.type, required: p.required !== false, loop: !!p.loop, expands: !!p.expands,
    })),
    outputs: (meta.outputs || []).map((p) => ({ id: p.id, type: p.type, when: p.when || 'always' })),
    verdict: !!meta.verdict,
  };
}

test('substitution: reviewer -> workspaceReviewer via workspaceVariantOf, with ws-review verdicts', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const orch = createOrchestrator({
    ...workspaceOpts([a, b]), prompt: 'x', auto: true, claude: { mock: true },
  });
  const origAdopt = orch._adoptResolvedGraph.bind(orch);
  let seenResolved = null;
  orch._adoptResolvedGraph = (resolved) => { origAdopt(resolved); seenResolved = resolved; };
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));

  // The node the user DREW is still `reviewer` (templateKey, the config-lookup key);
  // the node the engine RAN is the declared variant.
  const nc = Object.values(seenResolved.nodeCtx).find((c) => c.kind === 'agent' && c.templateKey === 'reviewer');
  assert.ok(nc, 'the authored reviewer node is still identifiable by templateKey');
  assert.equal(nc.key, 'workspaceReviewer', 'the substituted key is what the run used');
  assert.equal(nc.meta.workspaceVariantOf, 'reviewer', 'and it substituted because it DECLARES the target');
  assert.equal(nc.meta.scope, 'workspace-only');
  assert.equal(seenResolved.template.nodes.find((n) => n.id === nc.nodeId).key, 'workspaceReviewer');

  // The substitution is wiring-safe because the two META port signatures are equal —
  // a meta-level comparison, unaffected by the `await` port synthesized above it.
  const reg = loadAgentRegistry();
  assert.deepEqual(metaPortSignature(reg.workspaceReviewer), metaPortSignature(reg.reviewer),
    'the variant preserves the port contract of the node it replaces');

  // ws-review filenames: the verdict template is the VARIANT's own, so the review
  // rows land under kind `ws` (ws-review-cycleN.json -> 'ws'), never `impl`.
  const { reviews } = readPipelineExtras(orch.getState().id);
  const ws = reviews.filter((r) => r.kind === 'ws');
  assert.deepEqual(ws.map((r) => r.cycle), [1, 2], 'both review cycles are recorded as ws-review verdicts');
  assert.ok(!reviews.some((r) => r.kind === 'impl'), 'no single-project impl-review verdict on a workspace run');
  // Cycle 1 blocks with the cross-project UNION (one issue per member, prefixed).
  assert.equal(ws[0].issues.length, 2, JSON.stringify(ws[0].issues));
  assert.ok(ws[0].issues.every((i) => /^project-[ab]:/.test(i.location)),
    `every location is projectKey-prefixed: ${JSON.stringify(ws[0].issues.map((i) => i.location))}`);
  assert.ok(ws[1].issues.every((i) => i.severity !== 'critical' && i.severity !== 'major'),
    'cycle 2 is clean of blocking issues, which is why the loop terminated');
});

// ── history walker discovers the workspace run ────────────────────────────────
test('history: listAllPipelines discovers the workspace run with target=workspace', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  await orch.run();
  const all = await listAllPipelines();
  const row = all.find((e) => e.projectKey === `workspaces/${ws.workspace.key}`);
  assert.ok(row, 'workspace run discovered by the machine-wide walker');
  assert.equal(row.target, 'workspace');
  assert.equal(row.projectName, ws.workspace.name);
});

// ── single-project back-compat (NON-NEGOTIABLE byte-identity) ─────────────────
test('back-compat: a single-project run (no workspace opts) is unchanged', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'Add login', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const state = orch.getState();
  assert.equal(state.target, undefined, 'no workspace discriminator on a single-project run');
  assert.equal(state.workspaceKey, undefined);
  // Phase 1 (run-root plumbing): the per-member maps are initialized in the
  // constructor state literal so getState()'s snapshot shape is stable across modes
  // and targets — a single-project run now carries a ONE-entry map keyed by its own
  // projectKey (previously undefined). Nothing else about the single-project shape
  // moved: `target`/`workspaceKey` stay absent and the scalars below are unchanged.
  const onlyKey = projectKey(repo);
  assert.deepEqual(Object.keys(state.checkpointRefs), [onlyKey], 'one-entry per-member ref map');
  assert.deepEqual(Object.keys(state.branches), [onlyKey], 'one-entry per-member branches map');
  // The single-project branch object shape is unchanged.
  assert.ok(state.branch && typeof state.branch === 'object');
  assert.equal(state.branch.source, 'main');
  assert.match(state.branch.feature, /^worca-cc\//);
  // Pipeline routes to the PROJECT store, never workspaces/.
  assert.doesNotMatch(state.pipelineDir, /\/store\/workspaces\//);
  assert.match(state.pipelineDir, new RegExp(`/store/${projectKey(repo)}/pipelines/`));
});

// ── Phase 1 detached siblings (pinned `detached`) ─────────────────────────────
// The legacy assertions above are the rollback guard; these are the same
// properties under the new layout. Only worktree LOCATIONS change.

test('detached: every member worktree lives under <worcaHome>/runs/<id>/repos/<projectKey>', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({ ...ws, prompt: 'Add pagination', auto: true, claude: { mock: true } });
  // Snapshot the live per-member worktrees before teardown removes them.
  let live = null;
  orch.on('state', (s) => {
    if (live || !s.branches) return;
    const ka = projectKey(a), kb = projectKey(b);
    if (s.branches[ka]?.worktreeDir && s.branches[kb]?.worktreeDir) {
      live = { id: s.id, [ka]: s.branches[ka].worktreeDir, [kb]: s.branches[kb].worktreeDir };
    }
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.ok(live, 'both member worktrees were registered');
  for (const dir of [a, b]) {
    const k = projectKey(dir);
    assert.match(live[k], new RegExp(`/runs/${live.id}/repos/${k}$`),
      `member ${k} worktree sits under the run root: ${live[k]}`);
    assert.ok(!existsSync(join(dir, '.worca-cc')), `nothing was created inside member ${k}'s repo`);
  }
});

test('detached: per-member branches + checkpoints are unchanged, and every branch is KEPT at teardown', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b], { branch: { source: 'main', feature: 'add-pagination' } });
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const state = orch.getState();
  const ka = projectKey(a), kb = projectKey(b);
  // Member-suffixed feature names (the _resolveMemberBranches semantics) are intact.
  assert.match(state.branches[ka].feature, /^add-pagination-/);
  assert.match(state.branches[kb].feature, /^add-pagination-/);
  assert.notEqual(state.branches[ka].feature, state.branches[kb].feature);
  assert.equal(state.branches[ka].source, 'main');
  // Per-member checkpoints, scalar mirrors the primary.
  assert.match(state.checkpointRefs[ka], /^[0-9a-f]{7,40}$/);
  assert.match(state.checkpointRefs[kb], /^[0-9a-f]{7,40}$/);
  assert.equal(state.checkpointRef, state.checkpointRefs[ws.workspace.projects[0].projectKey]);
  // Teardown keeps every branch and removes every checkout + the run root.
  for (const dir of [a, b]) {
    const k = projectKey(dir);
    assert.ok(branchList(dir).includes(state.branches[k].feature), `member ${k} branch KEPT`);
    assert.ok(!existsSync(state.branches[k].worktreeDir), `member ${k} checkout removed`);
  }
  assert.ok(!existsSync(join(worcaHome(), 'runs', state.id)), 'the run root is removed');
});

test('detached: the workspace mode pin is stamped on state and the run cwd is the NEUTRAL run root', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  let cwdDuringRun = null;
  let runRootDuringRun = null;
  orch.on('state', (s) => {
    if (cwdDuringRun || !s.branches || !Object.keys(s.branches).length) return;
    cwdDuringRun = orch.runCwd;
    runRootDuringRun = orch.runRoot;
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.equal(orch.getState().runRootMode, 'detached', 'the pin rides top-level state');
  assert.equal(cwdDuringRun, runRootDuringRun,
    'a detached workspace run starts at the run root, not in any member');
  assert.equal(runRootDuringRun, join(worcaHome(), 'runs', orch.getState().id));
  // No member is the cwd (R3 structural neutrality).
  for (const dir of [a, b]) assert.notEqual(cwdDuringRun, dir);
});

// ── Phase 4: per-node cwd + the §8.21 sub-agent preflight warning ─────────────
// Every execution's cwd is `ctx.projectDir` (phases.mjs runOpts maps it straight to
// runClaude's `cwd`), so spying on _execCtx is the per-execution cwd assertion.
function spyNodeCtxs(orch) {
  const seen = [];
  const orig = orch._execCtx.bind(orch);
  orch._execCtx = (node, nc, args) => {
    const ctx = orig(node, nc, args);
    if (node.kind === 'agent') {
      seen.push({ key: node.key, cwd: ctx.projectDir, runRoot: ctx.runRoot, workspace: !!ctx.workspace });
    }
    return ctx;
  };
  return seen;
}

test('detached workspace: EVERY node runs with cwd = the run root (never a member)', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  const seen = spyNodeCtxs(orch);
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const runRoot = join(worcaHome(), 'runs', orch.getState().id);
  assert.ok(seen.length >= 3, `several nodes ran: ${seen.map((s) => s.key).join(',')}`);
  for (const s of seen) {
    assert.equal(s.cwd, runRoot, `node ${s.key} cwd is the run root`);
    assert.equal(s.runRoot, runRoot, `node ${s.key} carries the detached gate`);
    assert.equal(s.workspace, true, `node ${s.key} carries the workspace channel`);
    for (const dir of [a, b]) assert.notEqual(s.cwd, dir, `node ${s.key} is not inside a member`);
  }
});

test('detached single project: every node runs with cwd = its own detached worktree', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  const seen = spyNodeCtxs(orch);
  // The worktree dir is REALPATH'd (macOS /private/var vs /var), so the recorded live
  // value — not a join() of worcaHome() — is the reference for an equality check.
  let liveWorktree = null;
  orch.on('state', (s) => {
    const k = projectKey(repo);
    if (!liveWorktree && s.branches?.[k]?.worktreeDir) liveWorktree = s.branches[k].worktreeDir;
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const id = orch.getState().id;
  assert.ok(liveWorktree, 'the worktree was registered');
  assert.ok(seen.length >= 3);
  for (const s of seen) {
    assert.equal(s.cwd, liveWorktree, `node ${s.key} cwd is its OWN worktree`);
    assert.match(s.cwd, new RegExp(`/runs/${id}/repos/${projectKey(repo)}$`), 'under the run root');
    assert.notEqual(s.cwd, s.runRoot, 'single mode never starts at the run root itself');
    assert.equal(s.workspace, false, 'no workspace channel on a single-project run');
  }
});

// The §8.21 enumeration lives INSIDE assembleRunContext (one derivation feeding all
// three carriers: run log, run.json.warnings, and the generated roster), so it fires
// during preflight — before any node is dispatched — and re-fires identically on a
// resume re-assembly. These tests assert the orchestrator-visible half.
test('detached workspace: the §8.21 loss is WARNED by member in the run log + run.json', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  const a = await freshRepo();           // carries a committed project sub-agent
  const b = await freshRepo();           // carries none
  await mkdir(join(a, '.claude', 'agents'), { recursive: true });
  await writeFile(join(a, '.claude', 'agents', 'db-migrator.md'), '---\nname: db-migrator\n---\nbody\n');
  spawnSync('git', ['-C', a, 'add', '-A']);
  spawnSync('git', ['-C', a, 'commit', '-qm', 'add project agent']);

  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  const logs = [];
  orch.on('log', (e) => logs.push(e));
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));

  const ka = projectKey(a), kb = projectKey(b);
  const warns = logs.filter((e) => e.level === 'warn' && /sub-agents/.test(e.text || ''));
  assert.equal(warns.length, 1, `exactly the carrier is named: ${JSON.stringify(warns.map((w) => w.text))}`);
  const text = warns[0].text;
  assert.ok(text.includes(require_basename(a)) || text.includes(ka), `names member a: ${text}`);
  assert.match(text, /not discoverable on workspace runs \(cwd is the run root\)/);
  assert.match(text, /~\/\.claude\/agents/, 'personal agents still work');
  assert.ok(!text.includes(kb) && !text.includes(require_basename(b)),
    `the member WITHOUT agents is not named: ${text}`);

  // Durable per §5.2: the same warning rides run.json, copied into the pipeline dir
  // before the run root is removed.
  const manifest = JSON.parse(await readFile(join(orch.getState().pipelineDir, 'run.json'), 'utf8'));
  assert.ok((manifest.warnings || []).some((w) => /sub-agents/.test(w)),
    `run.json.warnings carries it: ${JSON.stringify(manifest.warnings)}`);
});

test('detached workspace: the §8.21 warning survives pause -> resume, recorded EXACTLY once', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  const a = await freshRepo();
  const b = await freshRepo();
  await mkdir(join(a, '.claude', 'agents'), { recursive: true });
  await writeFile(join(a, '.claude', 'agents', 'db-migrator.md'), '---\nname: db-migrator\n---\nbody\n');
  spawnSync('git', ['-C', a, 'add', '-A']);
  spawnSync('git', ['-C', a, 'commit', '-qm', 'agent']);
  const ws = workspaceOpts([a, b]);

  // A producer that pauses the run mid-node once, then succeeds after the resume.
  let orchRef = null;
  let hangOnce = true;
  const mkRunners = () => ({
    producer: async (ctx) => {
      ctx.onEvent({ type: 'session', sessionId: `sess-${ctx.nodeId}` });
      if (hangOnce) {
        hangOnce = false;
        queueMicrotask(() => orchRef.pause());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      return { status: 'ok', summary: 'ok' };
    },
    verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
  });

  const logs1 = [];
  const orch1 = createOrchestrator({
    ...ws, prompt: 'x', auto: true, claude: { mock: true }, runners: mkRunners(),
  });
  orchRef = orch1;
  orch1.on('log', (e) => logs1.push(e));
  assert.equal((await orch1.run()).status, 'paused');
  const id = orch1.getState().id;
  const runRoot = join(worcaHome(), 'runs', id);
  assert.ok(existsSync(runRoot), 'paused: the run root is kept');
  const paused = await readRunManifest(runRoot);
  const inManifest = (m) => (m?.warnings || []).filter((w) => /sub-agents/.test(w));
  assert.equal(inManifest(paused).length, 1, `warned once before the pause: ${JSON.stringify(paused?.warnings)}`);

  // Restart simulation: a brand-new instance built ONLY from the DB. Resume re-runs
  // assembleRunContext, which REWRITES run.json.warnings wholesale — the §8.21 entry
  // must be re-derived there, not silently dropped.
  const logs2 = [];
  const orch2 = createOrchestrator({
    ...ws, auto: true, claude: { mock: true }, runners: mkRunners(),
    resume: readPipelineForResume(id),
  });
  orchRef = orch2;
  orch2.on('log', (e) => logs2.push(e));
  let live = null;
  orch2.on('state', () => { if (!live && existsSync(runRoot)) live = true; });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done', JSON.stringify(r2));

  // (1) the durable manifest copied out at teardown still carries it, exactly once.
  const copied = JSON.parse(await readFile(join(orch2.getState().pipelineDir, 'run.json'), 'utf8'));
  assert.equal(inManifest(copied).length, 1,
    `resume kept the §8.21 entry in run.json exactly once: ${JSON.stringify(copied.warnings)}`);
  assert.match(inManifest(copied)[0], /not discoverable on workspace runs/);
  // (2) and the run log carries it once ACROSS the pause boundary (no double-report).
  const logged = [...logs1, ...logs2].filter((e) => e.level === 'warn' && /sub-agents/.test(e.text || ''));
  assert.equal(logged.length, 1, `logged once across pause+resume: ${JSON.stringify(logged.map((l) => l.text))}`);
});

// ── §8.19 + §5.1: the other two assembly-derived preflight warnings ──────────
// Both are derived inside assembleRunContext exactly like §8.21, so they fire during
// preflight (before any node is dispatched), land in the run log AND run.json, and are
// re-derived — not duplicated — by a resume re-assembly. These are the
// orchestrator-visible halves; the shape/wording cases live in run-context.test.mjs.

/** Run `fn` with WORCA_PROJECTS_ROOT pinned, restoring it in finally. */
async function withProjectsRoot(root, fn) {
  const prev = process.env.WORCA_PROJECTS_ROOT;
  process.env.WORCA_PROJECTS_ROOT = root;
  try { return await fn(); }
  finally {
    if (prev === undefined) delete process.env.WORCA_PROJECTS_ROOT;
    else process.env.WORCA_PROJECTS_ROOT = prev;
  }
}

const SETTINGS_RE = /project hooks\/permissions/;
const CONTAINMENT_RE = /is not under the projects root/;

test('detached workspace: the §8.19 and §5.1 losses are WARNED by member in the run log + run.json', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  const a = await freshRepo();           // carries committed project settings
  const b = await freshRepo();           // carries none
  await mkdir(join(a, '.claude'), { recursive: true });
  await writeFile(join(a, '.claude', 'settings.json'), JSON.stringify({
    hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo hi' }] }] },
    permissions: { allow: ['Bash(npm run lint)'] },
  }));
  spawnSync('git', ['-C', a, 'add', '-A']);
  spawnSync('git', ['-C', a, 'commit', '-qm', 'add project settings']);

  // A projects root that is an ancestor of NEITHER member: both must be named.
  const proot = await mkdtemp(join(tmpdir(), 'worca-cc-ws-proot-'));
  created.push(proot);
  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  const logs = [];
  orch.on('log', (e) => logs.push(e));
  const res = await withProjectsRoot(proot, () => orch.run());
  assert.equal(res.status, 'done', JSON.stringify(res));

  const warnText = (re) => logs.filter((e) => e.level === 'warn' && re.test(e.text || '')).map((e) => e.text);

  // §8.19 — exactly the carrier, with its keys and the documented remedy.
  const settings = warnText(SETTINGS_RE);
  assert.equal(settings.length, 1, `exactly the carrier is named: ${JSON.stringify(settings)}`);
  assert.ok(settings[0].includes(require_basename(a)) || settings[0].includes(projectKey(a)),
    `names member a: ${settings[0]}`);
  assert.ok(!settings[0].includes(require_basename(b)) && !settings[0].includes(projectKey(b)),
    `the member WITHOUT settings is not named: ${settings[0]}`);
  assert.match(settings[0], /do not apply on workspace runs \(cwd is the run root\)/);
  assert.match(settings[0], /hooks, permissions/, 'the committed keys are named');

  // §5.1 — one line per member, naming its real dir and the root it is not under.
  const outside = warnText(CONTAINMENT_RE);
  assert.equal(outside.length, 2, `both members are outside: ${JSON.stringify(outside)}`);
  for (const dir of [a, b]) assert.ok(outside.some((w) => w.includes(dir)), `names ${dir}`);
  assert.ok(outside.every((w) => w.includes(proot)), 'names the projects root');

  // Durable per §5.2: both ride run.json, copied into the pipeline dir at teardown.
  const manifest = JSON.parse(await readFile(join(orch.getState().pipelineDir, 'run.json'), 'utf8'));
  for (const re of [SETTINGS_RE, CONTAINMENT_RE]) {
    assert.ok((manifest.warnings || []).some((w) => re.test(w)),
      `run.json.warnings carries ${re}: ${JSON.stringify(manifest.warnings)}`);
  }
});

test('detached workspace: §8.19 + §5.1 survive pause -> resume, recorded EXACTLY once', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  const a = await freshRepo();
  const b = await freshRepo();
  await mkdir(join(a, '.claude'), { recursive: true });
  await writeFile(join(a, '.claude', 'settings.json'), JSON.stringify({ hooks: { PostToolUse: [] } }));
  spawnSync('git', ['-C', a, 'add', '-A']);
  spawnSync('git', ['-C', a, 'commit', '-qm', 'settings']);
  const proot = await mkdtemp(join(tmpdir(), 'worca-cc-ws-proot2-'));
  created.push(proot);
  const ws = workspaceOpts([a, b]);

  let orchRef = null;
  let hangOnce = true;
  const mkRunners = () => ({
    producer: async (ctx) => {
      ctx.onEvent({ type: 'session', sessionId: `sess-${ctx.nodeId}` });
      if (hangOnce) {
        hangOnce = false;
        queueMicrotask(() => orchRef.pause());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      return { status: 'ok', summary: 'ok' };
    },
    verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
  });

  const logs1 = [];
  const orch1 = createOrchestrator({
    ...ws, prompt: 'x', auto: true, claude: { mock: true }, runners: mkRunners(),
  });
  orchRef = orch1;
  orch1.on('log', (e) => logs1.push(e));
  assert.equal((await withProjectsRoot(proot, () => orch1.run())).status, 'paused');
  const id = orch1.getState().id;
  const paused = await readRunManifest(join(worcaHome(), 'runs', id));
  assert.equal((paused?.warnings || []).filter((w) => SETTINGS_RE.test(w)).length, 1);
  assert.equal((paused?.warnings || []).filter((w) => CONTAINMENT_RE.test(w)).length, 2);

  // Restart simulation: resume re-runs assembleRunContext, which REWRITES
  // run.json.warnings wholesale — both families must be re-derived, not doubled.
  const logs2 = [];
  const orch2 = createOrchestrator({
    ...ws, auto: true, claude: { mock: true }, runners: mkRunners(), resume: readPipelineForResume(id),
  });
  orchRef = orch2;
  orch2.on('log', (e) => logs2.push(e));
  const r2 = await withProjectsRoot(proot, () => orch2.resume());
  assert.equal(r2.status, 'done', JSON.stringify(r2));

  const copied = JSON.parse(await readFile(join(orch2.getState().pipelineDir, 'run.json'), 'utf8'));
  assert.equal((copied.warnings || []).filter((w) => SETTINGS_RE.test(w)).length, 1,
    `§8.19 kept exactly once: ${JSON.stringify(copied.warnings)}`);
  assert.equal((copied.warnings || []).filter((w) => CONTAINMENT_RE.test(w)).length, 2,
    `§5.1 kept exactly once per member: ${JSON.stringify(copied.warnings)}`);
  const logged = (re) => [...logs1, ...logs2].filter((e) => e.level === 'warn' && re.test(e.text || ''));
  assert.equal(logged(SETTINGS_RE).length, 1,
    `§8.19 logged once across pause+resume: ${JSON.stringify(logged(SETTINGS_RE).map((l) => l.text))}`);
  assert.equal(logged(CONTAINMENT_RE).length, 2,
    `§5.1 logged once per member across pause+resume: ${JSON.stringify(logged(CONTAINMENT_RE).map((l) => l.text))}`);
});

test('legacy workspace + detached single: NO §8.19 project-settings warning (gate holds)', async () => {
  for (const mode of ['legacy', 'detached']) {
    process.env.WORCA_RUN_ROOT = mode;
    const repo = await freshRepo();
    await mkdir(join(repo, '.claude'), { recursive: true });
    await writeFile(join(repo, '.claude', 'settings.json'), JSON.stringify({ hooks: { PostToolUse: [] } }));
    spawnSync('git', ['-C', repo, 'add', '-A']);
    spawnSync('git', ['-C', repo, 'commit', '-qm', 'settings']);
    const opts = mode === 'legacy'
      // legacy WORKSPACE: the config-source member's settings keep applying as today
      ? { ...workspaceOpts([repo, await freshRepo()]), prompt: 'x' }
      // detached SINGLE: cwd is always a checkout, so its committed settings apply
      : { projectDir: repo, prompt: 'x', branch: { source: 'main' } };
    const orch = createOrchestrator({ ...opts, auto: true, claude: { mock: true } });
    const logs = [];
    orch.on('log', (e) => logs.push(e));
    const res = await orch.run();
    assert.equal(res.status, 'done', `${mode}: ${JSON.stringify(res)}`);
    assert.equal(logs.filter((e) => SETTINGS_RE.test(e.text || '')).length, 0,
      `${mode} emits no §8.19 warning`);
  }
});

test('legacy workspace + detached single: NO §8.21 sub-agent warning (gate holds)', async () => {
  for (const mode of ['legacy', 'detached']) {
    process.env.WORCA_RUN_ROOT = mode;
    const repo = await freshRepo();
    await mkdir(join(repo, '.claude', 'agents'), { recursive: true });
    await writeFile(join(repo, '.claude', 'agents', 'x.md'), '---\nname: x\n---\nbody\n');
    spawnSync('git', ['-C', repo, 'add', '-A']);
    spawnSync('git', ['-C', repo, 'commit', '-qm', 'agent']);
    const opts = mode === 'legacy'
      // legacy WORKSPACE: the config-source member's agents keep working as today
      ? { ...workspaceOpts([repo, await freshRepo()]), prompt: 'x' }
      // detached SINGLE: cwd is always a checkout, so nothing is lost
      : { projectDir: repo, prompt: 'x', branch: { source: 'main' } };
    const orch = createOrchestrator({ ...opts, auto: true, claude: { mock: true } });
    const logs = [];
    orch.on('log', (e) => logs.push(e));
    const res = await orch.run();
    assert.equal(res.status, 'done', `${mode}: ${JSON.stringify(res)}`);
    assert.equal(logs.filter((e) => /not discoverable on workspace runs/.test(e.text || '')).length, 0,
      `${mode} emits no §8.21 warning`);
  }
});

test('detached: state.branches is a LIVE object on a SINGLE-project run (constructor-literal fix)', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  // Before any run: both maps exist and are empty (never undefined — a
  // single-project detached run would otherwise TypeError on the first
  // this.state.branches[key] = … inside mapWithCap).
  assert.deepEqual(orch.getState().branches, {});
  assert.deepEqual(orch.getState().checkpointRefs, {});
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const state = orch.getState();
  const k = projectKey(repo);
  assert.deepEqual(Object.keys(state.branches), [k], 'one entry, keyed by the synthesized member');
  assert.equal(state.branches[k].feature, state.branch.feature, 'the scalar mirrors the only member');
  assert.match(state.checkpointRefs[k], /^[0-9a-f]{7,40}$/, 'the checkpoint mirror populated it');
  assert.equal(state.checkpointRefs[k], state.checkpointRef);
  // The synthesized member is the one-element array every unified path iterates.
  assert.equal(orch.members.length, 1);
  assert.equal(orch.members[0].projectKey, k);
  assert.equal(orch.members[0].projectName, repo.split('/').filter(Boolean).pop());
});
