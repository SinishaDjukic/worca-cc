// test/cli-resume.test.mjs
// Guard-level tests for `worca resume <id>` (no orchestrator spawn): usage,
// unknown id, non-paused id — plus the cwd-fallback projectDir resolution (which
// reaches orch.resume() but stops deterministically at the missing-worktree
// check). The happy path is covered by test/orchestrator-resume.test.mjs.
// Harness mirrors test/cli-subcommands.test.mjs: spawn the CLI as a child
// process; seed the shared sqlite file from THIS process (same WORCA_HOME via
// useTempHome), then let the child read it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, realpath, readFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline, seedPipelineRow } from './helpers/db-seed.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { getDb } from '../src/core/db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');

// useTempHome sets process.env.WORCA_HOME (inherited by run()'s env spread)
// and resets the db singleton so seedPipelineRow writes into THIS home.
const home = useTempHome(after);

function run(args, { cwd } = {}) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, WORCA_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(cwd ? { cwd } : {}),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}

/** A REAL v2 resume point. The v1 engine is retired, so `resumeRun` refuses any
 *  point that is not `version: 2`; the graph engine's _engineRehydrate then
 *  refuses a v2 point with no manifest. `snapshot: null` replays the graph from
 *  scratch, which is all a guard-level fixture needs to get PAST both checks. */
async function v2ResumePoint(pipelineDir) {
  const { loadAgentRegistry } = await import('../src/core/agent-registry.mjs');
  const { resolveGraph } = await import('../src/core/workflows.mjs');
  const { buildGraphManifest } = await import('../src/shared/graph/manifest.mjs');
  const resolved = await resolveGraph(pipelineDir, 'wf_default', loadAgentRegistry());
  const manifest = buildGraphManifest(resolved.template, resolved.agentsByKey,
    { overlays: { nodes: resolved.nodes, wires: resolved.wires } });
  return { version: 2, snapshot: null, manifest, nodes: [], planVersion: 0,
    stepModels: null, workflowId: 'wf_default', guardrailsId: null, checkpointRef: null,
    checkpointRefs: {}, workspace: null, pauseReason: null, toolInstruction: '',
    pipelineDir, pausedAt: '2026-06-09T00:00:00Z' };
}


test('resume with no id -> exit 1 + usage', async () => {
  const r = await run(['resume']);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /usage: worca resume/i);
});

test('resume unknown id -> exit 1 + not found', async () => {
  const r = await run(['resume', 'deadbeef']);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /not found/i);
});

test('resume a non-paused pipeline -> exit 1 + not resumable', async () => {
  seedPipelineRow({
    id: 'aaaa0001',
    status: 'done',
    startedAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  });
  const r = await run(['resume', 'aaaa0001']);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /not resumable/i);
});

// ── §5.2 / §10: cross-mode resume is pinned to the mode the run STARTED in ────
// This is the correctness property that makes the mid-rollout flip safe. The tests
// below drive real orchestrators in-process (the child-process harness above cannot
// observe runCwd/runRoot) and deliberately resume with the LIVE FLAG SET TO THE
// OPPOSITE VALUE in both directions.

/** A real repo with one commit on `main`. */
async function freshRepo(prefix = 'worca-cc-cliresume-repo-') {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  repos.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'seed.txt'), 'seed\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}
const repos = [];
after(() => Promise.all(repos.map((d) => rm(d, { recursive: true, force: true }))));

/**
 * Runners for the pause/resume pin tests. With `pause:true` the first producer node
 * pauses the run (once) and every later node succeeds; with `pause:false` nothing
 * pauses — the shape a resume needs to reach `done`.
 */
function pausingRunners(getOrch, { pause = true } = {}) {
  let hangOnce = pause;
  const seen = [];
  return {
    seen,
    runners: {
      producer: async (ctx) => {
        seen.push({ nodeId: ctx.nodeId, cwd: ctx.projectDir, runRoot: ctx.runRoot });
        ctx.onEvent({ type: 'session', sessionId: `sess-${ctx.nodeId}` });
        if (hangOnce) {
          hangOnce = false;
          queueMicrotask(() => getOrch().pause());
          return new Promise((_r, rej) => {
            const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
            if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
          });
        }
        return { status: 'ok', summary: 'ok' };
      },
      verifier: async (ctx) => {
        seen.push({ nodeId: ctx.nodeId, cwd: ctx.projectDir, runRoot: ctx.runRoot });
        return { status: 'ok', issues: [], review: { issues: [] }, summary: '' };
      },
    },
  };
}

/**
 * Pin WORCA_RUN_ROOT for the WHOLE of `fn` (await included). The flag is consulted
 * inside run()/_setupRunRoot, not in the constructor, so a pin that covers only
 * construction would be restored before it is ever read.
 */
async function withEnvMode(mode, fn) {
  const prev = process.env.WORCA_RUN_ROOT;
  process.env.WORCA_RUN_ROOT = mode;
  try { return await fn(); }
  finally {
    if (prev === undefined) delete process.env.WORCA_RUN_ROOT;
    else process.env.WORCA_RUN_ROOT = prev;
  }
}

test('a LEGACY-recorded run resumed while the live flag says `detached` stays legacy', async () => {
  const repo = await freshRepo();
  let orchRef = null;
  const a = pausingRunners(() => orchRef);
  const orch1 = createOrchestrator({
    projectDir: repo, prompt: 'demo', auto: true, claude: { mock: true },
    runners: a.runners, branch: { source: 'main' },
  });
  orchRef = orch1;
  assert.equal((await withEnvMode('legacy', () => orch1.run())).status, 'paused');
  const id = orch1.state.id;
  const legacyWorktree = orch1.getState().branch.worktreeDir;
  assert.match(legacyWorktree, /\.worca-cc\/worktrees\//, 'precondition: a legacy checkout');
  assert.equal(orch1.getState().branch.runRootMode, 'legacy', 'the pin was recorded on the row');

  // Resume with the live flag flipped to `detached` — the record must win.
  const saved = readPipelineForResume(id);
  const b = pausingRunners(() => orchRef, { pause: false });
  const orch2 = createOrchestrator({
    projectDir: repo, auto: true, claude: { mock: true }, runners: b.runners, resume: saved,
  });
  orchRef = orch2;
  const r2 = await withEnvMode('detached', () => orch2.resume());
  assert.equal(r2.status, 'done', JSON.stringify(r2));
  assert.equal(orch2.runRootMode, 'legacy', 'resume honored the RECORDED mode, not the live flag');
  assert.equal(orch2.runRoot, null, 'no run root was derived');
  assert.equal(orch2.runCwd, legacyWorktree, 'the legacy cwd is preserved');
  for (const s of b.seen) {
    assert.equal(s.cwd, legacyWorktree, 'every resumed node ran in the legacy checkout');
    assert.equal(s.runRoot, null, 'and was told there is no run root (legacy prompts)');
  }
  assert.ok(!existsSync(join(worcaHome(), 'runs', id)),
    'a legacy-started run is never pointed at an empty <worcaHome>/runs/<id>/repos tree');
});

test('a DETACHED-recorded run resumed while the live flag says `legacy` keeps its run root', async () => {
  const repo = await freshRepo();
  let orchRef = null;
  const a = pausingRunners(() => orchRef);
  const orch1 = createOrchestrator({
    projectDir: repo, prompt: 'demo', auto: true, claude: { mock: true },
    runners: a.runners, branch: { source: 'main' },
  });
  orchRef = orch1;
  assert.equal((await withEnvMode('detached', () => orch1.run())).status, 'paused');
  const id = orch1.state.id;
  const runRoot = join(worcaHome(), 'runs', id);
  assert.ok(existsSync(runRoot), 'precondition: a paused detached run keeps its run root');
  const detachedWorktree = orch1.getState().branch.worktreeDir;
  assert.match(detachedWorktree, new RegExp(`/runs/${id}/repos/`), 'precondition: a run-root checkout');

  // Resume with the live flag rolled BACK to `legacy` — the record must still win.
  const saved = readPipelineForResume(id);
  const b = pausingRunners(() => orchRef, { pause: false });
  const orch2 = createOrchestrator({
    projectDir: repo, auto: true, claude: { mock: true }, runners: b.runners, resume: saved,
  });
  orchRef = orch2;
  const r2 = await withEnvMode('legacy', () => orch2.resume());
  assert.equal(r2.status, 'done', JSON.stringify(r2));
  assert.equal(orch2.runRootMode, 'detached', 'resume honored the RECORDED mode, not the rolled-back flag');
  assert.equal(orch2.runRoot, runRoot, 'the deterministic run root was derived');
  assert.equal(orch2.runCwd, detachedWorktree, 'cwd is the recorded run-root checkout');
  for (const s of b.seen) assert.equal(s.runRoot, runRoot, 'every resumed node saw the run root');
  // Completing after a resume tears the run root down (the resume-finally wiring).
  assert.ok(!existsSync(runRoot), 'and teardown reclaimed it on completion');
});

test('the persisted WORKSPACE row itself carries the pin, and still does after pause -> resume -> pause', async () => {
  const a = await freshRepo('worca-cc-cliresume-wsa-');
  const b = await freshRepo('worca-cc-cliresume-wsb-');
  const projects = [a, b]
    .map((d) => ({ projectDir: d, projectKey: projectKey(d), projectName: d.split('/').pop() }))
    .sort((x, y) => (x.projectKey < y.projectKey ? -1 : 1));
  const wkey = `wks-res-${projects.map((p) => p.projectKey).join('').slice(0, 8)}`;
  const wsOpts = {
    workspace: { id: wkey, key: wkey, name: 'Res WS', description: '', projects: projects.map((p) => ({ ...p, branch: { source: 'main' } })) },
    branch: { source: 'main' },
  };
  const rawPin = (id) => {
    const row = getDb().prepare('SELECT workspace_meta FROM pipelines WHERE id = ?').get(id);
    return row?.workspace_meta ?? null;
  };

  let orchRef = null;
  const p1 = pausingRunners(() => orchRef);
  const orch1 = createOrchestrator({
    ...wsOpts, prompt: 'demo', auto: true, claude: { mock: true }, runners: p1.runners,
  });
  orchRef = orch1;
  assert.equal((await withEnvMode('detached', () => orch1.run())).status, 'paused');
  const id = orch1.state.id;
  // The RAW JSON column must contain the pin — without the artifacts.mjs whitelist
  // fold, workspace_meta is a fixed set and every paused detached workspace run
  // would silently resume as legacy with all tests green.
  assert.match(rawPin(id), /"runRootMode":\s*"detached"/, `raw workspace_meta: ${rawPin(id)}`);

  // Resume, pause again: the re-stamp must keep the pin on the row.
  const saved = readPipelineForResume(id);
  const p2 = pausingRunners(() => orchRef);
  const orch2 = createOrchestrator({
    ...wsOpts, auto: true, claude: { mock: true }, runners: p2.runners, resume: saved,
  });
  orchRef = orch2;
  const r2 = await withEnvMode('legacy', () => orch2.resume());
  assert.equal(r2.status, 'paused', JSON.stringify(r2));
  assert.equal(orch2.runRootMode, 'detached', 'the resumed workspace run honored the recorded mode');
  assert.match(rawPin(id), /"runRootMode":\s*"detached"/,
    `the pin survives pause -> resume -> pause: ${rawPin(id)}`);
});

test('the persisted SINGLE-project row carries the pin inside its `branch` column', async () => {
  const repo = await freshRepo();
  for (const mode of ['detached', 'legacy']) {
    let orchRef = null;
    const p = pausingRunners(() => orchRef);
    const orch = createOrchestrator({
      projectDir: repo, prompt: `demo ${mode}`, auto: true, claude: { mock: true },
      runners: p.runners, branch: { source: 'main', feature: `feat/pin-${mode}` },
    });
    orchRef = orch;
    assert.equal((await withEnvMode(mode, () => orch.run())).status, 'paused');
    const raw = getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(orch.state.id)?.branch;
    assert.match(raw, new RegExp(`"runRootMode":\\s*"${mode}"`), `raw branch column: ${raw}`);
  }
});

// The CLI's default run flow needs no registration, so the `worca resume <id>`
// hint it prints must resolve the project from the CHILD's cwd when the registry
// has no match. The no-resume-point guard fires BEFORE resolution, so the seed
// must carry a resumePoint; the deliberately missing worktreeDir then makes
// orch.resume() fail at its worktree re-attach check — a deterministic error that
// can only be reached AFTER projectDir resolution succeeded.
test('resume an unregistered cwd project -> resolves past "not onboarded"', async () => {
  // realpath: macOS mkdtemp returns a /var -> /private/var symlinked path while
  // the child's process.cwd() is physical; keep the test focused on the cwd
  // fallback itself rather than projectKey's symlink canonicalization.
  const projDir = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-cliresume-proj-')));
  const goneWt = await mkdtemp(join(tmpdir(), 'worca-cc-cliresume-wt-'));
  await rm(goneWt, { recursive: true, force: true }); // worktree no longer exists
  try {
    const { id } = await seedPipeline(projDir, {
      title: 'paused cwd run', status: 'paused',
      branch: { source: 'main', feature: 'f', worktreeDir: goneWt, reusedExisting: false },
      resumePoint: await v2ResumePoint(projDir),
    });
    const r = await run(['resume', id, '--mock', '--yes'], { cwd: projDir });
    assert.equal(r.code, 1, r.stderr);
    assert.doesNotMatch(r.stderr, /not onboarded/i, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /worktree missing/i, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  } finally {
    await rm(projDir, { recursive: true, force: true });
  }
});

test('cmdResume routes a v2 resume point to the graph engine', async () => {
  const { selectEngine } = await import('../src/core/engine-select.mjs');
  assert.equal(selectEngine({ resumePointVersion: 2 }), 'graph');
  // and the CLI no longer imports the v1 factory directly
  const src = await readFile(new URL('../src/cli/worca-cc.mjs', import.meta.url), 'utf8');
  assert.ok(/createOrchestratorFor/.test(src), 'CLI uses the engine-selecting factory');
  assert.ok(!/\bcreateOrchestrator\(/.test(src), 'CLI has no direct v1 construction left');
});

// P8a: `worca resume` refuses a v1 point with exit 2 and the honest message.
// The guard sits ABOVE the sweep on purpose — sweeping first would NULL the
// point under test and the caller would read "has no resume point" (exit 1).
// (Without this test the CLI refusal is dead code — it was, measured.)
test('resume refuses a v1 resume point: exit 2 and the retirement message', async () => {
  const projDir = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-cliresume-v1-')));
  try {
    const { id } = await seedPipeline(projDir, {
      title: 'v1 point run', status: 'paused',
      resumePoint: { version: 1, kind: 'boundary', pipelineDir: projDir },
    });
    const r = await run(['resume', id, '--mock', '--yes'], { cwd: projDir });
    assert.equal(r.code, 2, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
    assert.match(r.stderr, /^worca resume: paused on the v1 engine before the graph rework — not resumable$/m,
      `stderr: ${r.stderr}`);
  } finally {
    await rm(projDir, { recursive: true, force: true });
  }
});
