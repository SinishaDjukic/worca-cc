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
import { join, basename } from 'node:path';

import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { projectKey } from '../src/core/store.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { listAllPipelines, readPipelineForResume, slugify } from '../src/core/artifacts.mjs';
import { sanitizeBranchName } from '../src/core/worktree.mjs';
import { getDb } from '../src/core/db.mjs';
import { readRunManifest } from '../src/core/run-manifest.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { posix } from './helpers/posix-path.mjs';
import { checkRows } from './helpers/rows.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

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
  const dir = templateRepo('ws', { branch: 'main', user: true, files: { 'seed.txt': 'seed\n' }, prefix });
  created.push(dir);
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

const tipOf = (dir, ref) => spawnSync('git', ['-C', dir, 'rev-parse', ref]).stdout.toString().trim();
const auditLines = (id) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(id).map((r) => r.text);
/** [primaryDir, otherDir] — the primary is projects[0], the lowest projectKey. */
function primaryFirst(ws, a, b) {
  return projectKey(a) === ws.workspace.projects[0].projectKey ? [a, b] : [b, a];
}
/** Stop the run the moment every member checkout exists (setup's "Building the knowledge
 *  graph" state emit, before any agent node). `beforeStop(s)` runs first, synchronously. */
function stopWhenCheckedOut(orch, keys, beforeStop = () => {}) {
  let fired = false;
  orch.on('state', (s) => {
    if (fired || !s.branches) return;
    const dirs = keys.map((k) => s.branches[k]?.worktreeDir);
    if (!dirs.every((d) => d && existsSync(d))) return;
    fired = true;
    beforeStop(s);
    orch.stop();
  });
  return () => fired;
}

// ── one legacy 2-member run: D3 layout through the history walker ──────────────
test('legacy workspace run (2 members): own-repo worktrees, per-member checkpoints, scalar branch object, slugged features, frozen description, workspace-store routing, all members staged, teardown keeps branches, history row', async () => {
  // One legacy 2-member run serves nine former tests (one row each). It carries every
  // option they passed: the 'add-pagination' feature (D2) and a description (freeze);
  // the branch names the rows check are read back from the run's own state.
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b], {
    description: '# Workspace: Demo\n\nShared REST contract.',
    branch: { source: 'main', feature: 'add-pagination' },
  });
  const orch = createOrchestrator({ ...ws, prompt: 'Add pagination', auto: true, claude: { mock: true } });
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
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const state = orch.getState();

  await checkRows([
    { name: 'D3: each member gets a worktree in its OWN repo at .worca-cc/worktrees/<pipelineId>', run: () => {
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
    } },
    { name: 'per-project checkpoint refs are recorded; the scalar mirrors the primary', run: () => {
      const ka = projectKey(a), kb = projectKey(b);
      assert.ok(state.checkpointRefs[ka], 'checkpointRefs has member a');
      assert.ok(state.checkpointRefs[kb], 'checkpointRefs has member b');
      assert.match(state.checkpointRefs[ka], /^[0-9a-f]{7,40}$/, 'a real sha for a');
      // Primary = lowest projectKey = projects[0]; the scalar checkpointRef mirrors it.
      const primaryKey = ws.workspace.projects[0].projectKey;
      assert.equal(state.checkpointRef, state.checkpointRefs[primaryKey], 'scalar mirrors primary');
    } },
    { name: 'C8: scalar state.branch is an object copied from the primary member', run: () => {
      const primaryKey = ws.workspace.projects[0].projectKey;
      assert.equal(typeof state.branch, 'object', 'state.branch is an object (C8), not a string');
      assert.equal(state.branch.feature, state.branches[primaryKey].feature);
      assert.equal(state.branch.source, state.branches[primaryKey].source);
      assert.equal(state.branch.worktreeDir, state.branches[primaryKey].worktreeDir);
      assert.equal('reusedExisting' in state.branch, true);
    } },
    { name: 'D2: per-project feature branch is the feature + project slug', run: () => {
      for (const dir of [a, b]) {
        const slug = require_basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const feat = state.branches[projectKey(dir)].feature;
        assert.match(feat, /^add-pagination-/, `feature carries the base name: ${feat}`);
        assert.ok(feat.includes(slug.split('-')[0]) || feat.length > 'add-pagination-'.length,
          `feature carries the project slug: ${feat}`);
      }
      // The two members' feature branches differ (per-project slug).
      assert.notEqual(state.branches[projectKey(a)].feature, state.branches[projectKey(b)].feature);
    } },
    { name: 'description is frozen at run start onto state + this.workspaceDescription', run: async () => {
      assert.match(state.workspaceDescription, /Shared REST contract/, 'frozen onto state');
      assert.equal(orch.workspaceDescription, state.workspaceDescription, 'frozen onto the instance');
      // The on-disk frozen snapshot exists in the workspace-store pipeline dir.
      assert.ok(existsSync(join(state.pipelineDir, 'workspace-description.md')));
      const snap = await readFile(join(state.pipelineDir, 'workspace-description.md'), 'utf8');
      assert.match(snap, /Shared REST contract/);
    } },
    { name: 'artifacts route to the workspace store (store/workspaces/<key>/pipelines)', run: () => {
      assert.match(posix(state.pipelineDir), new RegExp(`/store/workspaces/${ws.workspace.key}/pipelines/`),
        `pipeline dir under the workspace store: ${state.pipelineDir}`);
    } },
    { name: 'teardown removes every member worktree but KEEPS every feature branch', run: () => {
      for (const dir of [a, b]) {
        const k = projectKey(dir);
        const wtDir = state.branches[k].worktreeDir;
        const feat = state.branches[k].feature;
        assert.ok(!existsSync(wtDir), `member ${k} worktree removed: ${wtDir}`);
        assert.ok(branchList(dir).includes(feat), `member ${k} feature branch KEPT: ${feat}`);
      }
    } },
    { name: '_stageWorkingTree stages EVERY member worktree (not just primary)', run: () => {
      assert.ok(injected, 'precondition: files injected into both worktrees');
      // The kept-branch commit on EACH member must carry its injected file (teardown
      // commits the staged tree). This proves staging reached both worktrees.
      for (const [dir, file] of [[a, 'new-a.txt'], [b, 'new-b.txt']]) {
        const feat = state.branches[projectKey(dir)].feature;
        const show = spawnSync('git', ['-C', dir, 'show', `${feat}:${file}`]);
        assert.equal(show.status, 0, `${file} committed on ${dir}'s kept branch`);
      }
    } },
    { name: 'history: listAllPipelines discovers the workspace run with target=workspace', run: async () => {
      const all = await listAllPipelines();
      const row = all.find((e) => e.projectKey === `workspaces/${ws.workspace.key}`);
      assert.ok(row, 'workspace run discovered by the machine-wide walker');
      assert.equal(row.target, 'workspace');
      assert.equal(row.projectName, ws.workspace.name);
    } },
  ]);
});

// ── D2: per-project source fallback when the named source is absent ───────────
test('per-member source: each member uses its own branch.source, and a member lacking it falls back to its own default', async () => {
  // One run serves both former tests: per-member sources {a: 'develop', b: 'main'} (the
  // server map result), where a has its own extra 'develop' branch and b is on `master`
  // with NO `main` branch — so b's named source is absent and must fall back.
  const a = await freshRepo();           // on `main`
  spawnSync('git', ['branch', 'develop'], { cwd: a }); // create the branch the member will be based on
  const b = await mkdtemp(join(tmpdir(), 'worca-cc-ws-master-'));
  created.push(b);
  const g = (args) => spawnSync('git', args, { cwd: b });
  g(['init', '-q', '-b', 'master']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(b, 'a.txt'), 'a\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);

  const ws = workspaceOpts([a, b], { branch: { source: 'main' } });
  // Mimic buildWorkspaceMembers: assign each member its own source by projectKey.
  const byKey = { [projectKey(a)]: 'develop', [projectKey(b)]: 'main' };
  ws.workspace.projects = ws.workspace.projects.map((p) => ({ ...p, branch: { source: byKey[p.projectKey], feature: null } }));

  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const state = orch.getState();
  await checkRows([
    { name: 'D2: a member lacking the named source branch falls back to its own default', run: () => {
      // b's named source 'main' is absent: it fell back to 'master' (its default).
      assert.equal(state.branches[projectKey(b)].source, 'master', 'b fell back to its own default');
    } },
    { name: 'per-project source: each member uses its own branch.source (the server map result)', run: () => {
      assert.equal(state.branches[projectKey(a)].source, 'develop');
    } },
  ]);
});

// ── partial worktree-setup failure PAUSES, keeping the sibling checkout (§5.10 edge 4) ──
test('a member whose branch is already checked out PAUSES the run; the sibling\'s checkout is kept and the resume replays the setup', async () => {
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
  assert.equal(res.status, 'paused', JSON.stringify(res));
  assert.equal(res.reason, 'error');
  assert.match(res.detail, /already checked out/);
  // _setupRunRoot settles EVERY member before throwing, so whichever member DID get a
  // worktree is recorded AND kept — the paused run resumes into it.
  const wtA = orch.getState().branches[projectKey(a)]?.worktreeDir;
  assert.ok(wtA && existsSync(wtA), "member a's checkout is retained for the resume");
  const saved = readPipelineForResume(orch.getState().id);
  assert.equal(saved.resumePoint.setupIncomplete, true);
  assert.equal(saved.resumePoint.workspace.projects.find((p) => p.projectKey === projectKey(a))?.worktreeDir, wtA, 'the point records the kept checkout');
  // Free b's branch, then resume: the replay re-attaches a and creates b.
  assert.equal(spawnSync('git', ['-C', b, 'worktree', 'remove', '--force', squatDir]).status, 0);
  const orch2 = createOrchestrator({ ...ws, auto: true, claude: { mock: true }, resume: saved });
  const res2 = await orch2.resume();
  assert.equal(res2.status, 'done', JSON.stringify(res2));
  assert.ok(orch2.getState().branches[bKey]?.worktreeDir, 'the replay created member b');
  assert.ok(!existsSync(wtA), 'done tears every member checkout down');
});

// ── fan-out node forcing ──────────────────────────────────────────────────────
test('fan-out forcing: a workspace run forces fanOut=true on eligible nodes only', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  // Capture the resolved graph the scheduler runs. resolveGraph stamps fanOut on
  // every nodeCtx up front, so the resolved bag IS the v1 plan's replacement.
  let seenNodes = null;
  const origResolve = orch._resolveTopology.bind(orch);
  orch._resolveTopology = async (...a) => { const r = await origResolve(...a); seenNodes = Object.values(orch.resolved.nodeCtx); return r; };
  await orch.run();
  assert.ok(seenNodes, 'the graph resolved');
  // meta.workspaceFanOut is the v2 replacement for the v1 FANOUT_ELIGIBLE list
  // (workflows.mjs:579), so the expectation is read from the registry, not hard-coded.
  const agents = seenNodes.filter((n) => n.kind === 'agent');
  assert.ok(agents.length >= 3, `several agent nodes resolved: ${agents.map((n) => n.key).join(',')}`);
  for (const node of agents) {
    if (node.meta && node.meta.workspaceFanOut) {
      assert.equal(node.fanOut, true, `eligible node ${node.key} is FORCED fanOut`);
    } else {
      // Not eligible => not forced: it keeps whatever its own sidecar default says.
      assert.equal(node.fanOut, !!(node.meta && node.meta.fanOut),
        `ineligible node ${node.key} is NOT forced (keeps its sidecar default)`);
    }
  }
  // The eligible set is non-empty — otherwise the loop above is vacuous.
  assert.ok(agents.some((n) => n.meta && n.meta.workspaceFanOut), 'at least one node IS forced fanOut');
  // M4: the review node is substituted reviewer -> workspaceReviewer (workflows.mjs),
  // so the resolved workspace graph carries a fanned-out workspaceReviewer and NO
  // single-project reviewer node.
  const keys = agents.map((n) => n.key);
  const wsReviewer = agents.find((n) => n.key === 'workspaceReviewer');
  assert.ok(wsReviewer, 'workspace plan contains a workspaceReviewer node');
  assert.equal(wsReviewer.fanOut, true, 'the workspaceReviewer node is forced fanOut');
  assert.ok(!keys.includes('reviewer'), 'no single-project reviewer node in a workspace graph');
});

// ── Phase 1 detached siblings (pinned `detached`) ─────────────────────────────
// The legacy assertions above are the rollback guard; these are the same
// properties under the new layout. Only worktree LOCATIONS change.

test('detached workspace run: member worktrees under runs/<id>/repos/<key>, cwd and every node at the neutral run root, mode pin stamped, branches/checkpoints kept, run root removed', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  // One detached 2-member run serves four former tests (one row each); it carries the
  // 'add-pagination' feature the branches test passed.
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b], { branch: { source: 'main', feature: 'add-pagination' } });
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
  let cwdDuringRun = null;
  let runRootDuringRun = null;
  orch.on('state', (s) => {
    if (cwdDuringRun || !s.branches || !Object.keys(s.branches).length) return;
    cwdDuringRun = orch.runCwd;
    runRootDuringRun = orch.runRoot;
  });
  const seen = spyNodeCtxs(orch);
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));

  await checkRows([
    { name: 'detached: every member worktree lives under <worcaHome>/runs/<id>/repos/<projectKey>', run: () => {
      assert.ok(live, 'both member worktrees were registered');
      for (const dir of [a, b]) {
        const k = projectKey(dir);
        assert.match(posix(live[k]), new RegExp(`/runs/${live.id}/repos/${k}$`),
          `member ${k} worktree sits under the run root: ${live[k]}`);
        assert.ok(!existsSync(join(dir, '.worca-cc')), `nothing was created inside member ${k}'s repo`);
      }
    } },
    { name: 'detached: per-member branches + checkpoints are unchanged, and every branch is KEPT at teardown', run: () => {
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
      // Teardown keeps every branch (the detached mock changed EVERY member, so none is
      // unchanged) and removes every checkout + the run root.
      for (const dir of [a, b]) {
        const k = projectKey(dir);
        assert.ok(branchList(dir).includes(state.branches[k].feature), `member ${k} branch KEPT`);
        assert.ok(!existsSync(state.branches[k].worktreeDir), `member ${k} checkout removed`);
      }
      assert.ok(!existsSync(join(worcaHome(), 'runs', state.id)), 'the run root is removed');
    } },
    { name: 'detached: the workspace mode pin is stamped on state and the run cwd is the NEUTRAL run root', run: () => {
      assert.equal(orch.getState().runRootMode, 'detached', 'the pin rides top-level state');
      assert.equal(cwdDuringRun, runRootDuringRun,
        'a detached workspace run starts at the run root, not in any member');
      assert.equal(runRootDuringRun, join(worcaHome(), 'runs', orch.getState().id));
      // No member is the cwd (R3 structural neutrality).
      for (const dir of [a, b]) assert.notEqual(cwdDuringRun, dir);
    } },
    { name: 'detached workspace: EVERY node runs with cwd = the run root (never a member)', run: () => {
      const runRoot = join(worcaHome(), 'runs', orch.getState().id);
      assert.ok(seen.length >= 3, `several nodes ran: ${seen.map((s) => s.key).join(',')}`);
      for (const s of seen) {
        assert.equal(s.cwd, runRoot, `node ${s.key} cwd is the run root`);
        assert.equal(s.runRoot, runRoot, `node ${s.key} carries the detached gate`);
        assert.equal(s.workspace, true, `node ${s.key} carries the workspace channel`);
        for (const dir of [a, b]) assert.notEqual(s.cwd, dir, `node ${s.key} is not inside a member`);
      }
    } },
  ]);
});

// ── Phase 4: per-node cwd + the §8.21 sub-agent preflight warning ─────────────
// Every execution's cwd is `ctx.projectDir` (phases.mjs runOpts maps it straight
// to runClaude's `cwd`), so spying on _execCtx is the per-node cwd assertion.
function spyNodeCtxs(orch) {
  const seen = [];
  const orig = orch._execCtx.bind(orch);
  orch._execCtx = (node, nc, args) => {
    const ctx = orig(node, nc, args);
    seen.push({ key: nc.key, cwd: ctx.projectDir, runRoot: ctx.runRoot, workspace: !!ctx.workspace });
    return ctx;
  };
  return seen;
}

test('detached single project: state.branches is live from construction and every node runs with cwd = its own detached worktree', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  // The maps as constructed, before any run (asserted in the constructor-literal row).
  const before = structuredClone({ branches: orch.getState().branches, checkpointRefs: orch.getState().checkpointRefs });
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

  await checkRows([
    { name: 'detached single project: every node runs with cwd = its own detached worktree', run: () => {
      const id = orch.getState().id;
      assert.ok(liveWorktree, 'the worktree was registered');
      assert.ok(seen.length >= 3);
      for (const s of seen) {
        assert.equal(s.cwd, liveWorktree, `node ${s.key} cwd is its OWN worktree`);
        assert.match(posix(s.cwd), new RegExp(`/runs/${id}/repos/${projectKey(repo)}$`), 'under the run root');
        assert.notEqual(s.cwd, s.runRoot, 'single mode never starts at the run root itself');
        assert.equal(s.workspace, false, 'no workspace channel on a single-project run');
      }
    } },
    { name: 'detached: state.branches is a LIVE object on a SINGLE-project run (constructor-literal fix)', run: () => {
      // Before any run: both maps exist and are empty (never undefined — a
      // single-project detached run would otherwise TypeError on the first
      // this.state.branches[key] = … inside mapWithCap).
      assert.deepEqual(before.branches, {});
      assert.deepEqual(before.checkpointRefs, {});
      const state = orch.getState();
      const k = projectKey(repo);
      assert.deepEqual(Object.keys(state.branches), [k], 'one entry, keyed by the synthesized member');
      assert.equal(state.branches[k].feature, state.branch.feature, 'the scalar mirrors the only member');
      assert.match(state.checkpointRefs[k], /^[0-9a-f]{7,40}$/, 'the checkpoint mirror populated it');
      assert.equal(state.checkpointRefs[k], state.checkpointRef);
      // The synthesized member is the one-element array every unified path iterates.
      assert.equal(orch.members.length, 1);
      assert.equal(orch.members[0].projectKey, k);
      assert.equal(orch.members[0].projectName, basename(repo));
    } },
  ]);
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

// The §8.21 enumeration lives INSIDE assembleRunContext (one derivation feeding all
// three carriers: run log, run.json.warnings, and the generated roster), so it fires
// during preflight — before any node is dispatched — and re-fires identically on a
// resume re-assembly. These tests assert the orchestrator-visible half.
test('detached workspace: the §8.21, §8.19 and §5.1 losses are WARNED by member in the run log + run.json', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  // One run serves both former tests: member a carries a committed project sub-agent AND
  // committed project settings, member b carries neither. The families are filtered by
  // texts that never cross-match (/sub-agents/, SETTINGS_RE, CONTAINMENT_RE).
  const a = await freshRepo();           // carries a committed project sub-agent + project settings
  const b = await freshRepo();           // carries none
  await mkdir(join(a, '.claude', 'agents'), { recursive: true });
  await writeFile(join(a, '.claude', 'agents', 'db-migrator.md'), '---\nname: db-migrator\n---\nbody\n');
  await writeFile(join(a, '.claude', 'settings.json'), JSON.stringify({
    hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo hi' }] }] },
    permissions: { allow: ['Bash(npm run lint)'] },
  }));
  spawnSync('git', ['-C', a, 'add', '-A']);
  spawnSync('git', ['-C', a, 'commit', '-qm', 'add project agent and settings']);

  // A projects root that is an ancestor of NEITHER member: both must be named.
  const proot = await mkdtemp(join(tmpdir(), 'worca-cc-ws-proot-'));
  created.push(proot);
  const ws = workspaceOpts([a, b]);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  const logs = [];
  orch.on('log', (e) => logs.push(e));
  const res = await withProjectsRoot(proot, () => orch.run());
  assert.equal(res.status, 'done', JSON.stringify(res));

  await checkRows([
    { name: 'detached workspace: the §8.21 loss is WARNED by member in the run log + run.json', run: async () => {
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
    } },
    { name: 'detached workspace: the §8.19 and §5.1 losses are WARNED by member in the run log + run.json', run: async () => {
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
    } },
  ]);
});

test('detached workspace: §8.21, §8.19 and §5.1 warnings survive pause -> resume, each recorded EXACTLY once', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  // One pause -> resume pair serves both former tests: member a carries a committed project
  // sub-agent AND project settings; the projects root is pinned for BOTH segments (the §5.1
  // text embeds it, so recording it once needs the same root on the resume).
  const a = await freshRepo();
  const b = await freshRepo();
  await mkdir(join(a, '.claude', 'agents'), { recursive: true });
  await writeFile(join(a, '.claude', 'agents', 'db-migrator.md'), '---\nname: db-migrator\n---\nbody\n');
  await writeFile(join(a, '.claude', 'settings.json'), JSON.stringify({ hooks: { PostToolUse: [] } }));
  spawnSync('git', ['-C', a, 'add', '-A']);
  spawnSync('git', ['-C', a, 'commit', '-qm', 'agent and settings']);
  const proot = await mkdtemp(join(tmpdir(), 'worca-cc-ws-proot2-'));
  created.push(proot);
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
  assert.equal((await withProjectsRoot(proot, () => orch1.run())).status, 'paused');
  const id = orch1.getState().id;
  const runRoot = join(worcaHome(), 'runs', id);
  assert.ok(existsSync(runRoot), 'paused: the run root is kept');
  const paused = await readRunManifest(runRoot);

  // Restart simulation: a brand-new instance built ONLY from the DB. Resume re-runs
  // assembleRunContext, which REWRITES run.json.warnings wholesale — every family must be
  // re-derived there, not silently dropped or doubled.
  const logs2 = [];
  const orch2 = createOrchestrator({
    ...ws, auto: true, claude: { mock: true }, runners: mkRunners(), resume: readPipelineForResume(id),
  });
  orchRef = orch2;
  orch2.on('log', (e) => logs2.push(e));
  const r2 = await withProjectsRoot(proot, () => orch2.resume());
  assert.equal(r2.status, 'done', JSON.stringify(r2));
  const copied = JSON.parse(await readFile(join(orch2.getState().pipelineDir, 'run.json'), 'utf8'));

  await checkRows([
    { name: 'detached workspace: the §8.21 warning survives pause -> resume, recorded EXACTLY once', run: () => {
      const inManifest = (m) => (m?.warnings || []).filter((w) => /sub-agents/.test(w));
      assert.equal(inManifest(paused).length, 1, `warned once before the pause: ${JSON.stringify(paused?.warnings)}`);
      // (1) the durable manifest copied out at teardown still carries it, exactly once.
      assert.equal(inManifest(copied).length, 1,
        `resume kept the §8.21 entry in run.json exactly once: ${JSON.stringify(copied.warnings)}`);
      assert.match(inManifest(copied)[0], /not discoverable on workspace runs/);
      // (2) and the run log carries it once ACROSS the pause boundary (no double-report).
      const logged = [...logs1, ...logs2].filter((e) => e.level === 'warn' && /sub-agents/.test(e.text || ''));
      assert.equal(logged.length, 1, `logged once across pause+resume: ${JSON.stringify(logged.map((l) => l.text))}`);
    } },
    { name: 'detached workspace: §8.19 + §5.1 survive pause -> resume, recorded EXACTLY once', run: () => {
      assert.equal((paused?.warnings || []).filter((w) => SETTINGS_RE.test(w)).length, 1);
      assert.equal((paused?.warnings || []).filter((w) => CONTAINMENT_RE.test(w)).length, 2);
      assert.equal((copied.warnings || []).filter((w) => SETTINGS_RE.test(w)).length, 1,
        `§8.19 kept exactly once: ${JSON.stringify(copied.warnings)}`);
      assert.equal((copied.warnings || []).filter((w) => CONTAINMENT_RE.test(w)).length, 2,
        `§5.1 kept exactly once per member: ${JSON.stringify(copied.warnings)}`);
      const logged = (re) => [...logs1, ...logs2].filter((e) => e.level === 'warn' && re.test(e.text || ''));
      assert.equal(logged(SETTINGS_RE).length, 1,
        `§8.19 logged once across pause+resume: ${JSON.stringify(logged(SETTINGS_RE).map((l) => l.text))}`);
      assert.equal(logged(CONTAINMENT_RE).length, 2,
        `§5.1 logged once per member across pause+resume: ${JSON.stringify(logged(CONTAINMENT_RE).map((l) => l.text))}`);
    } },
  ]);
});

test('legacy workspace + detached single: NO §8.19 / §8.21 warnings (gates hold)', async () => {
  // Each mode runs once with BOTH carriers committed (project settings and a project agent).
  const runs = [];
  for (const mode of ['legacy', 'detached']) {
    process.env.WORCA_RUN_ROOT = mode;
    const repo = await freshRepo();
    await mkdir(join(repo, '.claude', 'agents'), { recursive: true });
    await writeFile(join(repo, '.claude', 'settings.json'), JSON.stringify({ hooks: { PostToolUse: [] } }));
    await writeFile(join(repo, '.claude', 'agents', 'x.md'), '---\nname: x\n---\nbody\n');
    spawnSync('git', ['-C', repo, 'add', '-A']);
    spawnSync('git', ['-C', repo, 'commit', '-qm', 'settings and agent']);
    const opts = mode === 'legacy'
      // legacy WORKSPACE: the config-source member's settings and agents keep applying as today
      ? { ...workspaceOpts([repo, await freshRepo()]), prompt: 'x' }
      // detached SINGLE: cwd is always a checkout, so its committed settings apply and nothing is lost
      : { projectDir: repo, prompt: 'x', branch: { source: 'main' } };
    const orch = createOrchestrator({ ...opts, auto: true, claude: { mock: true } });
    const logs = [];
    orch.on('log', (e) => logs.push(e));
    const res = await orch.run();
    assert.equal(res.status, 'done', `${mode}: ${JSON.stringify(res)}`);
    runs.push({ mode, logs });
  }
  await checkRows([
    { name: 'legacy workspace + detached single: NO §8.19 project-settings warning (gate holds)', run: () => {
      for (const { mode, logs } of runs) {
        assert.equal(logs.filter((e) => SETTINGS_RE.test(e.text || '')).length, 0,
          `${mode} emits no §8.19 warning`);
      }
    } },
    { name: 'legacy workspace + detached single: NO §8.21 sub-agent warning (gate holds)', run: () => {
      for (const { mode, logs } of runs) {
        assert.equal(logs.filter((e) => /not discoverable on workspace runs/.test(e.text || '')).length, 0,
          `${mode} emits no §8.21 warning`);
      }
    } },
  ]);
});

// ── affected projects only: an unchanged member's branch is dropped at teardown ──
test('legacy: the changed (primary) member keeps its branch; the unchanged member\'s branch is deleted', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const [pDir, oDir] = primaryFirst(ws, a, b);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  const pRec = st.branches[projectKey(pDir)];
  const oRec = st.branches[projectKey(oDir)];
  // Legacy mock writes only into the primary's checkout (phases.mjs workspaceWriteTargetsFor).
  assert.ok(branchList(pDir).includes(pRec.feature), 'changed member: branch KEPT');
  assert.equal(pRec.branchKept, true);
  assert.equal(pRec.branchDeleted, undefined);
  assert.ok(!branchList(oDir).includes(oRec.feature), 'unchanged member: branch DELETED');
  assert.equal(oRec.branchKept, false);
  assert.equal(oRec.branchDeleted.reason, 'unchanged');
  assert.ok(!existsSync(oRec.worktreeDir), 'its checkout is removed too');
  assert.deepEqual(branchList(oDir), ['main'], 'the unchanged repo is left exactly as it was');
  // The scalar mirror follows the primary's real outcome.
  assert.equal(st.branch.branchKept, true);
  assert.equal(st.branch.branchDeleted, undefined);
  // Persisted: the DB round trip carries the per-member marker.
  const saved = readPipelineForResume(st.id);
  const meta = JSON.parse(saved.row.workspace_meta);
  assert.equal(meta.branches[projectKey(oDir)].branchDeleted.reason, 'unchanged');
  // Audit names the drop. appendAudit writes the DB timeline (pipeline_events), not a file.
  const lines = auditLines(st.id);
  assert.ok(lines.some((t) => t.includes(`deleted branch \`${oRec.feature}\` — no changes`)), lines.join('\n'));
  assert.ok(lines.some((t) => t.includes(`kept branch \`${pRec.feature}\``)), 'the kept member keeps today\'s wording');
});

test('detached: a run stopped before any change drops EVERY member branch, the primary included', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const keys = [projectKey(a), projectKey(b)];
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  const fired = stopWhenCheckedOut(orch, keys);
  const res = await orch.run();
  assert.equal(res.status, 'stopped', JSON.stringify(res));
  assert.ok(fired(), 'the stop landed after both member branches existed');
  const st = orch.getState();
  for (const dir of [a, b]) {
    const rec = st.branches[projectKey(dir)];
    assert.ok(rec.baseSha, 'precondition: a fresh branch this run created');
    assert.deepEqual(branchList(dir), ['main'], `${projectKey(dir)}: no branch left behind`);
    assert.equal(rec.branchKept, false);
    assert.equal(rec.branchDeleted.reason, 'unchanged');
  }
  // Primary dropped too (clarify: no special case) — the scalar mirror says so.
  assert.equal(st.branch.branchKept, false);
  assert.equal(st.branch.branchDeleted.reason, 'unchanged');
  assert.ok(!existsSync(join(worcaHome(), 'runs', st.id)), 'run root still reclaimed');
});

test('detached: an agent\'s own commit (nothing left uncommitted at teardown) still keeps that member\'s branch', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const ka = projectKey(a), kb = projectKey(b);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  stopWhenCheckedOut(orch, [ka, kb], (s) => {
    const wt = s.branches[ka].worktreeDir;
    writeFileSync(join(wt, 'agent.txt'), 'by the agent\n');
    spawnSync('git', ['-C', wt, 'add', 'agent.txt']);
    spawnSync('git', ['-C', wt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'agent commit']);
  });
  assert.equal((await orch.run()).status, 'stopped');
  const st = orch.getState();
  assert.ok(branchList(a).includes(st.branches[ka].feature), 'a: the agent-committed branch is KEPT');
  assert.equal(spawnSync('git', ['-C', a, 'show', `${st.branches[ka].feature}:agent.txt`]).status, 0);
  assert.equal(st.branches[ka].branchKept, true);
  assert.equal(st.branches[ka].branchDeleted, undefined);
  assert.ok(!branchList(b).includes(st.branches[kb].feature), 'b: unchanged, deleted');
});

test('a pre-existing feature branch (no baseSha) is never deleted, even when unchanged', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b], { branch: { source: 'main', feature: 'preexist' } });
  // Pre-create BOTH members' feature branches (not checked out anywhere) so each is reused.
  // Name = run-harness _resolveMemberBranches: sanitizeBranchName(`${feature}-${slugify(projectName)}`).
  for (const dir of [a, b]) {
    const name = sanitizeBranchName(`preexist-${slugify(require_basename(dir))}`);
    assert.equal(spawnSync('git', ['-C', dir, 'branch', name, 'main']).status, 0);
  }
  const [, oDir] = primaryFirst(ws, a, b);
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  assert.equal((await orch.run()).status, 'done');
  const rec = orch.getState().branches[projectKey(oDir)];
  assert.equal(rec.baseSha, undefined, 'precondition: a reused branch carries no baseSha');
  assert.equal(tipOf(oDir, rec.feature), tipOf(oDir, 'main'), 'precondition: unchanged');
  assert.ok(branchList(oDir).includes(rec.feature), 'the user\'s pre-existing branch is KEPT');
  assert.equal(rec.branchKept, true);
});

test('a paused workspace run keeps every member branch (teardown never runs on pause)', async () => {
  process.env.WORCA_RUN_ROOT = 'detached';
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = workspaceOpts([a, b]);
  const keys = [projectKey(a), projectKey(b)];
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  let fired = false;
  orch.on('state', (s) => {
    if (fired || !s.branches || !keys.every((k) => s.branches[k]?.worktreeDir && existsSync(s.branches[k].worktreeDir))) return;
    fired = true;
    orch.pause();
  });
  assert.equal((await orch.run()).status, 'paused');
  const st = orch.getState();
  for (const dir of [a, b]) assert.ok(branchList(dir).includes(st.branches[projectKey(dir)].feature), 'kept while paused');
});
