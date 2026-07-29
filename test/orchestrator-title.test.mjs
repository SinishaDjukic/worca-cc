// test/orchestrator-title.test.mjs
// The orchestrator fires a non-blocking LLM title generation right after
// createPipeline and, when it settles, emits a 'title' event carrying the
// pipeline id (the client run model has no pipeline id of its own).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { projectKey } from '../src/core/store.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-title-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

test('emits a title event with the LLM title after createPipeline', async () => {
  process.env.WORCA_MOCK = '1';
  const projectDir = await makeTmpDir();
  const orch = createOrchestrator({ projectDir, prompt: 'Add a settings page with dark mode', auto: true, claude: { mock: true } });
  const seen = [];
  orch.on('title', (p) => seen.push(p));
  await orch.run();
  await orch._titlePromise;                 // ensure the detached kickoff has settled
  assert.equal(seen.length, 1, 'exactly one title event');
  assert.equal(seen[0].provisional, false);
  assert.ok(seen[0].pipelineId, 'payload carries the pipeline id');
  assert.ok(seen[0].title && seen[0].title.length <= 70);
  delete process.env.WORCA_MOCK;
});

// ── §2.1 row 3: generateTitle is the LAST worca-cc process that used to start ──
// inside the user's LIVE checkout. Phase 1 gives it cwd = this.runCwd, which also
// PINS the kickoff ordering: it must fire AFTER _setupRunRoot() (runCwd is null
// before that, so a kickoff at the old site would silently fall back to projectDir).

test('generateTitle is called with the RUN CWD, never the live projectDir (detached)', async () => {
  const prevMode = process.env.WORCA_RUN_ROOT;
  process.env.WORCA_RUN_ROOT = 'detached';
  process.env.WORCA_MOCK = '1';
  const projectDir = await makeTmpDir();
  const g = (a) => spawnSync('git', a, { cwd: projectDir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(projectDir, 'seed.txt'), 'seed\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  try {
    const orch = createOrchestrator({
      projectDir, prompt: 'Add a settings page', auto: true, claude: { mock: true },
      branch: { source: 'main' },
    });
    // Spy on the kickoff so we can read runCwd at the exact moment it fires — the
    // ordering assertion. (The run root is torn down by the time run() resolves.)
    const key = projectKey(projectDir);
    let cwdAtKickoff = 'NEVER CALLED';
    let runRootAtKickoff = null;
    let workDirAtKickoff = null;
    const orig = orch._kickoffTitleGeneration.bind(orch);
    orch._kickoffTitleGeneration = () => {
      cwdAtKickoff = orch.runCwd ?? orch.projectDir;
      runRootAtKickoff = orch.runRoot;
      workDirAtKickoff = orch.workDirs.get(key) || null;
      return orig();
    };
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    await orch._titlePromise;
    assert.notEqual(cwdAtKickoff, 'NEVER CALLED', 'the kickoff fired');
    // Ordering: runRoot AND the member worktree are already registered, which is only
    // true after _setupRunRoot() — a kickoff at the old site would see both null.
    assert.ok(runRootAtKickoff, 'the kickoff fires AFTER _setupRunRoot (runRoot is set)');
    assert.ok(workDirAtKickoff, 'the member worktree is registered at kickoff time');
    assert.notEqual(cwdAtKickoff, projectDir,
      'the title process must NOT start in the user\'s live checkout');
    assert.equal(cwdAtKickoff, workDirAtKickoff, 'cwd is the run-root worktree');
    // The realpath'd run root differs from the deterministic one only by macOS's
    // /var -> /private/var symlink, so match on the stable tail.
    assert.match(cwdAtKickoff, new RegExp(`/runs/${orch.getState().id}/repos/${key}$`),
      `cwd sits under the run root: ${cwdAtKickoff}`);
  } finally {
    delete process.env.WORCA_MOCK;
    if (prevMode === undefined) delete process.env.WORCA_RUN_ROOT;
    else process.env.WORCA_RUN_ROOT = prevMode;
  }
});

test('the title kickoff is still SKIPPED on a resumed run (the gate is preserved verbatim)', async () => {
  process.env.WORCA_MOCK = '1';
  const projectDir = await makeTmpDir();
  try {
    const orch = createOrchestrator({
      projectDir, prompt: 'x', auto: true, claude: { mock: true },
      // A truthy resume opt is the resume signal the gate reads.
      resume: { row: { id: 'x' }, resumePoint: { version: 1 } },
    });
    let fired = false;
    orch._kickoffTitleGeneration = () => { fired = true; };
    // run() is never the resume entry point in production, but the gate must hold
    // here too (belt-and-suspenders, exactly as the comment at the site says).
    await orch.run().catch(() => {});
    assert.equal(fired, false, 'a resumed run never re-generates its title');
  } finally {
    delete process.env.WORCA_MOCK;
  }
});
