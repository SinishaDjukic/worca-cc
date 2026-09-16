// Offline end-to-end: the store is mounted into a mock run, every agent execution
// carries the pointer block; the files are in the run cwd's `.claude/rules/worca/`, where
// Claude Code loads them natively. A file an agent writes lands in the store after its
// execution, the run summary carries the change, and the mount never enters the worktree
// diff or the kept branch. Default (detached) mode + a legacy pin.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir, cp } from 'node:fs/promises';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { runAgentExecution } from '../src/core/graph/executor.mjs';
import { memoryRoot, writeMemory, readMemory, listMemory, readScopeState, GLOBAL_SCOPE, projectScope, bumpScopeState, listSnapshots } from '../src/core/memory-store.mjs';
import { projectKey } from '../src/core/store.mjs';
import { RESULTS_FILE, retainedWorkPatchName } from '../src/core/results.mjs';
import { memoryMountPath, MEMORY_RULES_REL } from '../src/core/memory-sync.mjs';
import { RUN_LOG_FILE } from '../src/core/run-log.mjs';
import { readPipelineByKey, readPipelineForResume } from '../src/core/artifacts.mjs';

useTempHome(after);
// settings.json (memory caps) resolves under HOME; the detached run context reads
// the root layer at WORCA_PROJECTS_ROOT — both pinned hermetic, as
// test/orchestrator-graph.test.mjs and test/run-root-layout.test.mjs do.
let sandboxHome; const prevEnv = {};
const HERMETIC_ROOT = mkdtempSync(join(tmpdir(), 'worca-mem-proot-'));
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-mem-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT', 'WORCA_RUN_ROOT']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_PROJECTS_ROOT = HERMETIC_ROOT;
  delete process.env.WORCA_RUN_ROOT;
});
after(async () => {
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
  rmSync(HERMETIC_ROOT, { recursive: true, force: true });
});

const CAPS = { hardBytesPerFile: 32768 };
const NOW = '2026-09-09T10:00:00.000Z';

/** A producer runner that records what every producer execution saw (`runners.producer`
 *  intercepts producer nodes only — planner, refiner x2, implementer x2 under mock
 *  wf_default; the reviewer is runnerType verifier and clarify is clarifier, and they
 *  still get the block through _execCtx) and, on the FIRST implementer execution, writes
 *  one memory file into the mount before delegating to the real (mock) execution.
 *  `ctx.memoryMount` is null when the mount failed — the producer must still run. */
function recordingProducer(seen) {
  let wrote = false;
  return async (ctx) => {
    seen.push({ key: ctx.node.key, executionId: ctx.executionId, block: ctx.memoryBlock, mount: ctx.memoryMount, cwd: ctx.projectDir,
      projectScopeDir: ctx.memoryMount ? existsSync(join(ctx.memoryMount, 'project')) : null,
      junk: ctx.memoryMount ? existsSync(join(ctx.memoryMount, 'global', 'my notes.md')) : null,
      sentinel: ctx.memoryMount ? existsSync(join(ctx.memoryMount, '.gitignore')) : null,
      status: spawnSync('git', ['-C', ctx.projectDir, 'status', '--porcelain']).stdout.toString() });
    if (ctx.memoryMount && ctx.node.key === 'implementer' && !wrote) {
      wrote = true;
      await writeFile(join(ctx.memoryMount, 'project', 'lesson.md'), 'Run npm ci before the suite.\nElse express fails.\n');
      await writeFile(join(ctx.memoryMount, 'global', 'style.md'), '---\nname: style\ndescription: Terse commit subjects\n---\nKeep subjects under 50 chars.\n');
    }
    return runAgentExecution(ctx);
  };
}

async function runOnce({ seed = true } = {}) {
  const dir = gitDir('mem');
  // useTempHome gives ONE home (and one store) to the whole file, so the GLOBAL
  // scope carries over between tests: an "empty store" run must wipe the root
  // first or a previous test's global/style.md is still listed in the index.
  if (seed) await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'testing', 'How the suite runs.\n', { source: 'user', now: NOW, caps: CAPS });
  else await rm(memoryRoot(), { recursive: true, force: true });
  const seen = [];
  const orch = createOrchestrator({
    projectDir: dir, workflowId: 'wf_default', prompt: 'demo task', claude: { mock: true }, auto: true,
    runners: { producer: recordingProducer(seen) },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  return { dir, orch, seen };
}

/** Run wf_default under mock until the FIRST implementer execution pauses the run. The mount now
 *  lives INSIDE the run cwd, which teardown removes — but a PAUSE keeps the checkout (and the
 *  mount in it), so a live-mount assertion runs against the still-live orchestrator instead of
 *  reading a directory that is already gone. `mkRunners` is handed back for the resuming twin
 *  (its `hangOnce` is already spent, so the resume runs to `done`). */
async function pausedRun({ seed = true, onPause } = {}) {
  const dir = gitDir('mem');
  if (seed) await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'testing', 'How the suite runs.\n', { source: 'user', now: NOW, caps: CAPS });
  let orchRef = null; let hangOnce = true;
  const mkRunners = () => ({
    producer: async (ctx) => {
      if (hangOnce && ctx.node.key === 'implementer') {
        hangOnce = false;
        if (onPause) await onPause(ctx);
        queueMicrotask(() => orchRef.pause());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      return runAgentExecution(ctx);
    },
  });
  const orch = createOrchestrator({
    projectDir: dir, workflowId: 'wf_default', prompt: 'demo task', claude: { mock: true }, auto: true, runners: mkRunners(),
  });
  orchRef = orch;
  assert.equal((await orch.run()).status, 'paused');
  return { dir, orch, mkRunners, setRef: (o) => { orchRef = o; } };
}

test('detached (default): mount at <worktree>/.claude/rules/worca, pointer block in every producer ctx, sync after the writing execution, summary + ledger, nothing memory in the commit', { timeout: 120000 }, async () => {
  const { dir, orch, seen } = await runOnce();
  const st = orch.getState();
  const pipelineDir = st.pipelineDir;
  assert.equal(st.memoryMount, memoryMountPath(st.branch.worktreeDir));
  assert.ok(seen.every((s) => s.mount.startsWith(s.cwd + sep)), 'the mount is INSIDE every run cwd (native rules load from the cwd)');
  assert.ok(seen.length >= 4, `producers ran: ${seen.length}`);
  for (const s of seen) {
    assert.ok(s.block.startsWith('## Worca memory\n'), `${s.key}: block present`);
    assert.ok(s.block.includes(`Global — ${join(st.memoryMount, 'global')}:`), `${s.key}: the global dir is named`);
    assert.ok(!s.block.includes('`testing.md`'), `${s.key}: the block lists no files — the CLI loads them`);
    assert.equal(s.mount, st.memoryMount);
    assert.equal(s.sentinel, true, `${s.key}: the .gitignore sentinel is in the mount`);
  }
  // Captured INSIDE the first producer execution: with the sentinel the mount is invisible to
  // an agent's own `git add -A`, to a staging pre-commit hook and to the reviewer's `git status`.
  assert.equal(seen[0].status, '', `git status inside the live checkout: ${JSON.stringify(seen[0].status)}`);
  const impl = seen.filter((s) => s.key === 'implementer');
  assert.ok(impl.length >= 2, 'wf_default under mock runs the implementer twice (review → fix)');
  // Store: repaired frontmatter, run-stamped.
  const pk = orch.members[0].projectKey;
  const lesson = await readMemory(memoryRoot(), projectScope(pk), 'lesson');
  assert.equal(lesson.meta.source, `run:${orch.pipeline.id}`);
  assert.equal(lesson.meta.description, 'Run npm ci before the suite.');
  assert.deepEqual((await listMemory(memoryRoot(), GLOBAL_SCOPE)).map((e) => e.name), ['style', 'testing']);
  // Summary: results.json.memory + the ledger + the detail reader.
  const results = JSON.parse(await readFile(join(pipelineDir, RESULTS_FILE), 'utf8'));
  assert.equal(results.memory.changes.length, 1);
  const ch = results.memory.changes[0];
  assert.equal(ch.agentKey, 'implementer');
  assert.deepEqual(ch.added.map((r) => `${r.scope}/${r.name}`).sort(), ['global/style', 'project/lesson']);
  assert.deepEqual(results.memory.totals, { added: 2, modified: 0, deleted: 0, rejected: 0 });
  assert.ok(!(results.newFiles || []).some((f) => /lesson\.md|style\.md/.test(f.path || f)), 'memory files never enter the run diff');
  assert.equal(orch.injectedPaths[pk].filter((e) => e.kind === 'memory').length, 1, 'ONE memory entry in the §8.8 set');
  assert.deepEqual(orch.injectedPaths[pk].find((e) => e.kind === 'memory'), { path: MEMORY_RULES_REL, kind: 'memory', source: null });
  const tree = spawnSync('git', ['-C', dir, 'ls-tree', '-r', '--name-only', st.branch.feature]).stdout.toString().split(/\r?\n/).filter(Boolean);
  assert.ok(!tree.some((q) => q.startsWith('.claude/rules/worca/')), `memory never enters the kept branch: ${tree.join(',')}`);
  assert.ok(!existsSync(st.branch.worktreeDir), 'the checkout (and the mount in it) is gone after teardown');
  const ledger = JSON.parse(await readFile(join(pipelineDir, 'memory.json'), 'utf8'));
  assert.equal(ledger.mount, st.memoryMount);
  assert.ok(ledger.baseline['project/lesson.md']);
  const detail = await readPipelineByKey(pk, orch.pipeline.id);
  assert.equal(detail.memory.changes.length, 1);
  assert.equal(detail.memory.mount, st.memoryMount);
  assert.deepEqual(detail.memory.totals, results.memory.totals, 'the detail and results.json agree');
  // Run log carries the audit line.
  assert.match(detail.auditMarkdown, /Memory: \+2 ~0 -0 by implementer/);
});

test('legacy (pinned): mount in the legacy worktree, the ONE legacy exclusion pathspec, nothing memory in the commit', { timeout: 120000 }, async () => {
  process.env.WORCA_RUN_ROOT = 'legacy';
  try {
    const { dir, orch } = await runOnce();
    const st = orch.getState();
    assert.equal(st.memoryMount, memoryMountPath(st.branch.worktreeDir));
    assert.ok(st.branch.worktreeDir.includes(join('.worca-cc', 'worktrees')), 'legacy checkout');
    assert.ok(await readMemory(memoryRoot(), projectScope(orch.members[0].projectKey), 'lesson'));
    assert.deepEqual(orch._excludePathspecs(orch.members[0].projectKey), [`:(exclude)${MEMORY_RULES_REL}`]);
    const tree = spawnSync('git', ['-C', dir, 'ls-tree', '-r', '--name-only', st.branch.feature]).stdout.toString().split(/\r?\n/).filter(Boolean);
    assert.ok(!tree.some((q) => q.startsWith('.claude/')), `legacy commit carries no mount: ${tree.join(',')}`);
    assert.ok(tree.includes('src/feature.mjs'), 'the mock edit was committed (the status recheck did not swallow a real change)');
  } finally { delete process.env.WORCA_RUN_ROOT; }
});

test('a checkout that TRACKS .claude/rules/worca is never mounted over: the run degrades to no memory with the audit line', { timeout: 120000 }, async () => {
  const dir = gitDir('mem');
  await mkdir(join(dir, '.claude', 'rules', 'worca'), { recursive: true });
  await writeFile(join(dir, '.claude', 'rules', 'worca', 'theirs.md'), 'committed by the project\n');
  spawnSync('git', ['-C', dir, 'add', '-A']); spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'own worca rules']);   // gitDir() configures no identity
  const seen = [];
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', prompt: 'demo task', claude: { mock: true }, auto: true, runners: { producer: recordingProducer(seen) } });
  // The guard must ask git with a CASE-FOLDED pathspec, in the run cwd, exactly once.
  const calls = [];
  const realGit = orch._git.bind(orch);
  orch._git = (args, o) => { if (args[0] === 'ls-files') calls.push(args); return realGit(args, o); };
  assert.equal((await orch.run()).status, 'done');
  assert.deepEqual(calls, [['ls-files', '--', ':(icase).claude/rules/worca']]);
  assert.equal(orch.memory, null); assert.equal(orch.getState().memoryMount, null);
  const detail = await readPipelineByKey(orch.members[0].projectKey, orch.pipeline.id);
  assert.match(detail.auditMarkdown, /Memory: not mounted \(the checkout tracks \.claude\/rules\/worca/);
  assert.match(detail.auditMarkdown, /untrack it/);
  assert.ok(!detail.auditMarkdown.includes('start the defragment'), 'an ordinary run is not told to start a defragment elsewhere');
  const tree = spawnSync('git', ['-C', dir, 'ls-tree', '-r', '--name-only', orch.getState().branch.feature]).stdout.toString();
  assert.ok(tree.includes('.claude/rules/worca/theirs.md'), 'the project\'s committed file is still on the branch, untouched');
  // A DEFRAGMENT of the same tracked checkout gets the extra way out: its scope is not this
  // project's checkout, so another project's can host the run. (B8: it pauses, never degrades.)
  const d2 = createOrchestrator({ projectDir: dir, workflowId: 'wf_memory_defrag', memoryScope: 'global', prompt: 'Defragment global memory.', claude: { mock: true }, auto: true, runners: { producer: recordingProducer([]) } });
  assert.equal((await d2.run()).status, 'paused');
  assert.match(String(d2.getState().pauseDetail || ''), /untrack it \(or start the defragment from another project\)/);
});

test('legacy retained checkout (commit failed): the mount is removed before the retained-work snapshot, so neither the kept checkout nor the patch carries memory', { timeout: 120000 }, async () => {
  process.env.WORCA_RUN_ROOT = 'legacy';
  try {
    const dir = gitDir('mem');
    const seen = [];
    const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', prompt: 'demo task', claude: { mock: true }, auto: true, runners: { producer: recordingProducer(seen) } });
    const realGit = orch._git.bind(orch);
    orch._git = (args, opts) => {
      const at = args.indexOf('-m');
      if (args.includes('commit') && at >= 0 && String(args[at + 1] || '').startsWith('worca:')) return Promise.resolve({ ok: false, code: 1, stdout: '', stderr: 'forced commit failure' });
      return realGit(args, opts);
    };
    assert.equal((await orch.run()).status, 'done');
    const st = orch.getState();
    assert.ok(existsSync(st.branch.worktreeDir), 'the checkout is RETAINED');
    assert.equal(st.branch.worktreeRemoved, false);
    assert.equal(existsSync(join(st.branch.worktreeDir, '.claude', 'rules', 'worca')), false, 'the mount was removed after the commit attempt');
    const patch = await readFile(join(st.pipelineDir, retainedWorkPatchName(null)), 'utf8').catch(() => '');
    assert.ok(!patch.includes('.claude/rules/worca'), 'the recovery patch carries no memory');
    assert.ok(await readMemory(memoryRoot(), projectScope(orch.members[0].projectKey), 'lesson'), 'the agent write still reached the store (final sync at _buildResults)');
  } finally { delete process.env.WORCA_RUN_ROOT; }
});

test('resume: the ledger sync runs BEFORE the tracked guard — a guard that fails only now degrades the run to no memory but never loses the interrupted segment\'s writes', { timeout: 120000 }, async () => {
  const { orch } = await pausedRun();
  const mount = orch.getState().memoryMount;
  await writeFile(join(mount, 'project', 'guard-race.md'), 'Written before the pause.\n');
  // git breaks between the pause and the resume (a broken index, or — IDH-1 — the previous
  // segment's agent staged the mount): the guard throws where it used to run FIRST.
  const realGit = orch._git.bind(orch);
  orch._git = (args, opts) => (args[0] === 'ls-files'
    ? Promise.resolve({ ok: false, code: 128, stdout: '', stderr: 'fatal: not a git repository' })
    : realGit(args, opts));
  await orch._mountMemory({ resume: true });
  assert.ok(await readMemory(memoryRoot(), projectScope(orch.members[0].projectKey), 'guard-race'),
    'the interrupted execution\'s write was synced before the guard ran');
  assert.equal(orch.memory, null, 'and the run degraded to no memory');
  assert.equal(orch.getState().memoryMount, null);
  assert.equal(orch.memoryBlock, '');
});

test('resume: a run paused BEFORE the native-rules revision keeps its files at the ledger\'s old mount — synced once, then remounted at the recomputed path', { timeout: 120000 }, async () => {
  const { dir, orch: orch1, mkRunners, setRef } = await pausedRun();
  const pdir = orch1.getState().pipelineDir;
  const oldMount = join(pdir, 'memory');
  await cp(orch1.getState().memoryMount, oldMount, { recursive: true });
  await writeFile(join(oldMount, 'project', 'legacy-paused.md'), 'Written under the old mount.\n');
  const ledger = JSON.parse(await readFile(join(pdir, 'memory.json'), 'utf8'));
  ledger.mount = oldMount;
  await writeFile(join(pdir, 'memory.json'), JSON.stringify(ledger, null, 2));
  const pk = orch1.members[0].projectKey;
  const saved = readPipelineForResume(orch1.state.id);
  const orch2 = createOrchestrator({ projectDir: dir, claude: { mock: true }, auto: true, runners: mkRunners(), resume: saved });
  setRef(orch2);
  let liveMount = null; let liveWorktree = null;
  orch2.on('state', (st) => { if (st.memoryMount) liveMount = st.memoryMount; if (st.branch?.worktreeDir) liveWorktree = st.branch.worktreeDir; });
  assert.equal((await orch2.resume()).status, 'done');
  assert.ok(await readMemory(memoryRoot(), projectScope(pk), 'legacy-paused'), 'the pre-revision mount was synced once');
  assert.ok(orch2.memoryChanges.some((c) => c.nodeId === 'resume' && c.added.some((r) => r.name === 'legacy-paused')), JSON.stringify(orch2.memoryChanges));
  assert.equal(liveMount, memoryMountPath(liveWorktree), 'and the remount is at the RECOMPUTED path, never the ledger\'s');
});

test('empty store: every scope dir exists in the mount and the block names it', { timeout: 120000 }, async () => {
  const { seen } = await runOnce({ seed: false });
  const first = seen[0].block;
  assert.match(first, /Global — .*[\\/]global:\n/);
  assert.match(first, /Project .* — .*[\\/]project:\n/);
  assert.equal(seen[0].projectScopeDir, true, 'the empty project scope dir exists in the mount');
});

test('resume: a file written by an interrupted execution is synced BEFORE the remount', { timeout: 120000 }, async () => {
  const { orch } = await pausedRun();
  const mount = orch.getState().memoryMount;
  await writeFile(join(mount, 'project', 'interrupted.md'), 'Written mid-execution.\n');
  const before = orch.memoryChanges.length;
  await orch._mountMemory({ resume: true });
  assert.ok(await readMemory(memoryRoot(), projectScope(orch.members[0].projectKey), 'interrupted'), 'captured into the store');
  assert.equal(orch.memoryChanges.length, before + 1);
  assert.equal(orch.memoryChanges.at(-1).agentKey, null);
  assert.equal(orch.memoryChanges.at(-1).nodeId, 'resume');
  assert.ok(existsSync(join(mount, 'project', 'interrupted.md')), 'the fresh mount carries it (it is in the store now)');
  assert.equal(await readFile(join(mount, '.gitignore'), 'utf8'), '*\n', 'the remount re-writes the sentinel');
  assert.ok(orch.memoryBlock.startsWith('## Worca memory\n'));
});

// ── survivor-killing additions found by the mutation audit ───────────────────

test('the detail exposes only mount + changes + totals — never the baseline', { timeout: 120000 }, async () => {
  const { orch } = await runOnce();
  const detail = await readPipelineByKey(orch.members[0].projectKey, orch.pipeline.id);
  assert.deepEqual(Object.keys(detail.memory).sort(), ['changes', 'mount', 'totals']);
});

test('a run that changed no memory writes no results.json memory key', { timeout: 120000 }, async () => {
  const dir = gitDir('mem');
  const orch = createOrchestrator({
    projectDir: dir, workflowId: 'wf_default', prompt: 'demo task', claude: { mock: true }, auto: true,
  });
  assert.equal((await orch.run()).status, 'done');
  const results = JSON.parse(await readFile(join(orch.getState().pipelineDir, RESULTS_FILE), 'utf8'));
  assert.equal('memory' in results, false, 'nothing changed ⇒ results.json is unchanged');
  assert.equal(orch.memorySummary(), null);
});

test('a stopped run still captures what the interrupted execution wrote (the _buildResults final sync)', { timeout: 120000 }, async () => {
  const dir = gitDir('mem');
  let tripped = false;
  const orch = createOrchestrator({
    projectDir: dir, workflowId: 'wf_default', prompt: 'demo task', claude: { mock: true }, auto: true,
    runners: { producer: async (ctx) => {
      if (ctx.node.key === 'implementer' && !tripped) {
        tripped = true;
        await writeFile(join(ctx.memoryMount, 'project', 'midflight.md'), 'Written before the stop.\n');
        await orch.stop();
      }
      return runAgentExecution(ctx);
    } },
  });
  await orch.run();
  assert.ok(await readMemory(memoryRoot(), projectScope(orch.members[0].projectKey), 'midflight'),
    'the _buildResults final sync captured the interrupted execution write');
});

test('resume(): the REAL call site syncs the interrupted mount back before remounting', { timeout: 120000 }, async () => {
  const dir = gitDir('mem');
  let orchRef = null;
  let hangOnce = true;
  const mkRunners = () => ({
    producer: async (ctx) => {
      if (hangOnce && ctx.node.key === 'implementer') {
        hangOnce = false;
        await writeFile(join(ctx.memoryMount, 'project', 'midpause.md'), 'Written before the pause.\n');
        queueMicrotask(() => orchRef.pause());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      return runAgentExecution(ctx);
    },
  });
  const orch1 = createOrchestrator({
    projectDir: dir, workflowId: 'wf_default', prompt: 'demo task', claude: { mock: true }, auto: true, runners: mkRunners(),
  });
  orchRef = orch1;
  assert.equal((await orch1.run()).status, 'paused');
  const pk = orch1.members[0].projectKey;
  const saved = readPipelineForResume(orch1.state.id);
  const orch2 = createOrchestrator({
    projectDir: dir, claude: { mock: true }, auto: true, runners: mkRunners(), resume: saved,
  });
  orchRef = orch2;
  assert.equal((await orch2.resume()).status, 'done');
  assert.ok(await readMemory(memoryRoot(), projectScope(pk), 'midpause'),
    'resume() captured the interrupted execution write into the store');
});

test('two executions finishing together sync ONCE: one change entry, one store write', { timeout: 120000 }, async () => {
  const { orch } = await pausedRun();
  const mount = orch.getState().memoryMount;
  const writesBefore = (await readScopeState(memoryRoot(), GLOBAL_SCOPE)).writesSinceDefrag;
  const entriesBefore = orch.memoryChanges.length;
  await writeFile(join(mount, 'global', 'race.md'), 'Two executions finish together.\n');
  const ctx = (id) => ({ nodeId: `n_${id}`, executionId: `x:${id}:1` });
  // Composite slices and parallel branches finish together: two syncs diffing against
  // ONE baseline would both write the file and both report it.
  await Promise.all([orch._syncMemory({ key: 'a' }, ctx('a')), orch._syncMemory({ key: 'b' }, ctx('b'))]);
  assert.equal(orch.memoryChanges.length, entriesBefore + 1, 'ONE change entry, not two');
  assert.deepEqual(orch.memoryChanges.at(-1).added.map((r) => `${r.scope}/${r.name}`), ['global/race']);
  assert.equal((await readScopeState(memoryRoot(), GLOBAL_SCOPE)).writesSinceDefrag, writesBefore + 1, 'ONE store write');
  assert.ok(await readMemory(memoryRoot(), GLOBAL_SCOPE, 'race'));
});

test('a mount failure degrades to no memory; the run still finishes', { timeout: 120000 }, async () => {
  const dir = gitDir('mem');
  const seen = [];
  const orch = createOrchestrator({
    projectDir: dir, workflowId: 'wf_default', prompt: 'demo task', claude: { mock: true }, auto: true,
    runners: { producer: recordingProducer(seen) },
  });
  orch._mountMemoryUnguarded = async () => { throw new Error('boom'); };
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.equal(orch.memory, null, 'the run carries no memory');
  assert.equal(orch.memoryBlock, '');
  assert.equal(orch.getState().memoryMount, null);
  assert.ok(seen.length >= 4, `producers ran: ${seen.length}`);
  for (const s of seen) { assert.equal(s.block, '', `${s.key}: no block`); assert.equal(s.mount, null, `${s.key}: no mount`); assert.equal(s.sentinel, null); }
  assert.equal(existsSync(join(orch.getState().pipelineDir, 'memory.json')), false, 'no ledger without a mount');
  const detail = await readPipelineByKey(orch.members[0].projectKey, orch.pipeline.id);
  assert.match(detail.auditMarkdown, /Memory: not mounted \(boom\)/);
});

test('junk in a store scope never blocks the run\'s memory writes, and is logged as ignored, not as an I/O error', { timeout: 120000 }, async () => {
  const dir = gitDir('mem');
  // One file a user dropped into the store by hand used to make the scope unwritable:
  // the pre-write snapshot listed it, threw ENAME, and every agent write to that scope
  // came back rejected with a reason naming a file the agent had never written.
  await rm(memoryRoot(), { recursive: true, force: true });
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'testing', 'How the suite runs.\n', { source: 'user', now: NOW, caps: CAPS });
  await writeFile(join(memoryRoot(), 'global', 'my notes.md'), 'Dropped in by hand.\n');
  const seen = [];
  const orch = createOrchestrator({
    projectDir: dir, workflowId: 'wf_default', prompt: 'demo task', claude: { mock: true }, auto: true,
    runners: { producer: recordingProducer(seen) },
  });
  assert.equal((await orch.run()).status, 'done');
  assert.ok(await readMemory(memoryRoot(), GLOBAL_SCOPE, 'style'), 'the agent write reached the store');
  assert.ok(await readMemory(memoryRoot(), projectScope(orch.members[0].projectKey), 'lesson'));
  const results = JSON.parse(await readFile(join(orch.getState().pipelineDir, RESULTS_FILE), 'utf8'));
  assert.deepEqual(results.memory.totals, { added: 2, modified: 0, deleted: 0, rejected: 0 });
  assert.ok(!(await listMemory(memoryRoot(), GLOBAL_SCOPE)).some((e) => e.name === 'my notes'), 'the junk file is never served');
  const log = await readFile(join(orch.getState().pipelineDir, RUN_LOG_FILE), 'utf8');
  assert.match(log, /memory: ignored [^"]*my notes\.md \(invalid name/, log.split('\n').filter((l) => /memory/.test(l)).join('\n'));
  assert.equal(/cannot read [^"]*my notes\.md/.test(log), false, 'a junk name is not an I/O failure');
  assert.equal(seen[0].junk, false, 'and it never reaches the mount (captured live: teardown removes the checkout)');
});

test('wf_memory_defrag + memoryScope global: one-scope mount, the mock merges, sync lands as defrag:, .state stamped, project scope untouched', { timeout: 120000 }, async () => {
  await rm(memoryRoot(), { recursive: true, force: true });
  const dir = gitDir('mem');
  const pk = projectKey(dir);
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'a', 'Rule A.\n', { source: 'user', now: NOW, caps: CAPS });
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'b', 'Rule B.\n', { source: 'user', now: NOW, caps: CAPS });
  await writeMemory(memoryRoot(), projectScope(pk), 'keep', 'Keep me.\n', { source: 'user', now: NOW, caps: CAPS });
  await bumpScopeState(memoryRoot(), GLOBAL_SCOPE, { writesSinceDefrag: 7 });
  let mounted = null;
  const orch = createOrchestrator({
    projectDir: dir, workflowId: 'wf_memory_defrag', memoryScope: 'global', prompt: 'Defragment global memory.', claude: { mock: true }, auto: true,
    runners: { producer: async (ctx) => { if (ctx.node.key === 'memoryDefragmenter') mounted = (await readdir(ctx.memoryMount)).sort(); return runAgentExecution(ctx); } },
  });
  assert.equal(orch.memoryScope, 'global');
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  // Captured LIVE from the defragmenter's own ctx: teardown removes the checkout the mount is in.
  assert.deepEqual(mounted, ['.gitignore', 'global'], 'ONE scope dir is mounted — never project/ (plus the git sentinel)');
  assert.deepEqual((await listMemory(memoryRoot(), GLOBAL_SCOPE)).map((e) => e.name), ['a'], 'b was merged into a and removed');
  const a = await readMemory(memoryRoot(), GLOBAL_SCOPE, 'a');
  assert.equal(a.meta.source, `defrag:${orch.pipeline.id}`);
  assert.ok(a.body.includes('Rule B.'), 'the merged body landed');
  const state = await readScopeState(memoryRoot(), GLOBAL_SCOPE);
  assert.equal(state.writesSinceDefrag, 0, 'zeroed AFTER the final sync counted the defragmenter\'s own writes');
  assert.equal(state.lastDefragRunId, orch.pipeline.id);
  assert.match(String(state.lastDefragAt), /^\d{4}-\d{2}-\d{2}T/);
  const snaps = await listSnapshots(memoryRoot(), GLOBAL_SCOPE);
  const snap = snaps.find((s) => s.id.includes(`-defrag-${orch.pipeline.id}`));   // A8: a same-second second snapshot carries a -NN suffix
  assert.ok(snap, `a defrag-sourced snapshot: ${snaps.map((s) => s.id)}`);
  assert.deepEqual(snap.files, ['a.md', 'b.md'], 'the pre-defrag scope is recoverable');
  assert.deepEqual((await listMemory(memoryRoot(), projectScope(pk))).map((e) => e.name), ['keep'], 'the other scope was never mounted, never touched');
  const results = JSON.parse(await readFile(join(st.pipelineDir, RESULTS_FILE), 'utf8'));
  // ONE entry: the node sync writes the repaired text back into the mount, so _buildResults'
  // final sync is a no-op (and an emptied b.md never re-enters the baseline — B19).
  assert.equal(results.memory.changes.length, 1);
  assert.equal(results.memory.changes[0].agentKey, 'memoryDefragmenter');
  assert.deepEqual(results.memory.changes[0].modified, [{ scope: 'global', name: 'a' }]);
  assert.deepEqual(results.memory.changes[0].deleted, [{ scope: 'global', name: 'b' }]);
  assert.deepEqual(results.memory.totals, { added: 0, modified: 1, deleted: 1, rejected: 0 });
  assert.ok(existsSync(join(st.pipelineDir, 'defrag-report.md')), 'the report output landed in the pipeline dir');
  const detail = await readPipelineByKey(pk, orch.pipeline.id);
  assert.match(detail.auditMarkdown, /Memory: \+0 ~1 -1 by memoryDefragmenter/);
  assert.match(detail.auditMarkdown, /Memory: Global defragmented by this run\./);
});

test('memoryScope: the constructor refuses the illegal combinations (the API/CLI answer 400 first; this is the last line)', () => {
  const dir = gitDir('mem');
  assert.throws(() => createOrchestrator({ projectDir: dir, workflowId: 'wf_memory_defrag', prompt: 'x', claude: { mock: true } }), /needs memoryScope/);
  assert.throws(() => createOrchestrator({ projectDir: dir, workflowId: 'wf_default', memoryScope: 'global', prompt: 'x', claude: { mock: true } }), /only valid with the Memory defragment workflow/);
  assert.throws(() => createOrchestrator({ projectDir: dir, workflowId: 'wf_memory_defrag', memoryScope: 'both', prompt: 'x', claude: { mock: true } }), /must be "global" or "project"/);
  const workspace = { id: 'wks-two-0000abcd', key: 'wks-two-0000abcd', name: 'Two', description: '',
    projects: [{ projectKey: 'a-00000001', projectName: 'A', projectDir: dir }, { projectKey: 'b-00000002', projectName: 'B', projectDir: dir }] };
  assert.throws(() => createOrchestrator({ workspace, workflowId: 'wf_memory_defrag', memoryScope: 'global', prompt: 'x', claude: { mock: true } }), /targets one project, not a workspace/);
});

test('a defragment run whose mount fails PAUSES on the setup failure policy instead of running on nothing', { timeout: 120000 }, async () => {
  const dir = gitDir('mem');
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_memory_defrag', memoryScope: 'project', prompt: 'Defragment.', claude: { mock: true }, auto: true });
  orch._mountMemoryUnguarded = async () => { throw new Error('boom'); };
  const res = await orch.run();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(st.pauseReason, 'error');
  assert.match(String(st.pauseDetail || ''), /memory not mounted: boom/);
  assert.equal(orch.memory, null, 'no mount, no index');
  const detail = await readPipelineByKey(projectKey(dir), orch.pipeline.id);
  assert.match(detail.auditMarkdown, /Memory: not mounted \(boom\) — a defragment run cannot continue\./);
});

test('memoryScope rides the resume point: a paused defrag resumes with ONE scope and still stamps', { timeout: 120000 }, async () => {
  await rm(memoryRoot(), { recursive: true, force: true });
  const dir = gitDir('mem');
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'a', 'Rule A.\n', { source: 'user', now: NOW, caps: CAPS });
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'b', 'Rule B.\n', { source: 'user', now: NOW, caps: CAPS });
  let orchRef = null; let hangOnce = true; let mounted2 = null;
  const mkRunners = () => ({
    producer: async (ctx) => {
      if (hangOnce && ctx.node.key === 'memoryDefragmenter') {
        hangOnce = false;
        queueMicrotask(() => orchRef.pause());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      if (ctx.node.key === 'memoryDefragmenter') mounted2 = (await readdir(ctx.memoryMount)).sort();
      return runAgentExecution(ctx);
    },
  });
  const orch1 = createOrchestrator({ projectDir: dir, workflowId: 'wf_memory_defrag', memoryScope: 'global', prompt: 'Defragment global memory.', claude: { mock: true }, auto: true, runners: mkRunners() });
  orchRef = orch1;
  assert.equal((await orch1.run()).status, 'paused');
  const saved = readPipelineForResume(orch1.state.id);
  assert.equal(saved.resumePoint.memoryScope, 'global', 'the point carries the option');
  const orch2 = createOrchestrator({ projectDir: dir, claude: { mock: true }, auto: true, runners: mkRunners(), resume: saved });
  orchRef = orch2;
  assert.equal(orch2.memoryScope, 'global', 'rehydrated from the point, not from opts');
  assert.equal((await orch2.resume()).status, 'done');
  assert.deepEqual(mounted2, ['.gitignore', 'global'], 'the remount is still one scope (captured live)');
  assert.deepEqual((await listMemory(memoryRoot(), GLOBAL_SCOPE)).map((e) => e.name), ['a']);
  assert.equal((await readScopeState(memoryRoot(), GLOBAL_SCOPE)).lastDefragRunId, orch2.pipeline.id);
});

// I1-F5 / amendment B31: "defragmented" must mean the store IS what the agent intended. A run
// whose writes were all refused is `done` all the same — zeroing the counters there would hide
// an unchanged (or worse) scope behind a green health card.
test('a defragment run whose write was REJECTED finishes done but does NOT stamp the scope', { timeout: 120000 }, async () => {
  await rm(memoryRoot(), { recursive: true, force: true });
  const dir = gitDir('mem');
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'a', 'Rule A.\n', { source: 'user', now: NOW, caps: CAPS });
  await bumpScopeState(memoryRoot(), GLOBAL_SCOPE, { writesSinceDefrag: 7 });
  const orch = createOrchestrator({
    projectDir: dir, workflowId: 'wf_memory_defrag', memoryScope: 'global', prompt: 'Defragment global memory.', claude: { mock: true }, auto: true,
    runners: {
      producer: async (ctx) => {
        if (ctx.node.key === 'memoryDefragmenter') {
          // Over the 32 KB hard cap: syncBack refuses it and the node still finishes.
          await writeFile(join(ctx.memoryMount, 'global', 'a.md'), `---\nname: a\n---\n${'x'.repeat(40000)}\n`);
        }
        return runAgentExecution(ctx);
      },
    },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const results = JSON.parse(await readFile(join(orch.getState().pipelineDir, RESULTS_FILE), 'utf8'));
  assert.ok(results.memory.totals.rejected >= 1, JSON.stringify(results.memory.totals));
  const state = await readScopeState(memoryRoot(), GLOBAL_SCOPE);
  assert.equal(state.writesSinceDefrag, 7, 'the counter is NOT reset');
  assert.equal(state.lastDefragRunId, null);
  assert.equal(state.lastDefragAt, null);
  const detail = await readPipelineByKey(projectKey(dir), orch.pipeline.id);
  assert.match(detail.auditMarkdown, /counters not reset/);
  assert.equal(/defragmented by this run/.test(detail.auditMarkdown), false, 'and it never claims success');
});

test('an agent that `git add -f`s the mount never gets it onto the kept branch: the exclusion set is UNSTAGED before the add', { timeout: 120000 }, async () => {
  const dir = gitDir('mem');
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'testing', 'How the suite runs.\n', { source: 'user', now: NOW, caps: CAPS });
  let forced = false;
  const orch = createOrchestrator({
    projectDir: dir, workflowId: 'wf_default', prompt: 'demo task', claude: { mock: true }, auto: true,
    runners: {
      producer: async (ctx) => {
        // The one way a mount file can reach the index despite the sentinel: an explicit `-f`.
        if (!forced && ctx.node.key === 'implementer' && ctx.memoryMount) {
          forced = true;
          assert.equal(spawnSync('git', ['-C', ctx.projectDir, 'add', '-f', MEMORY_RULES_REL]).status, 0);
        }
        return runAgentExecution(ctx);
      },
    },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.equal(forced, true, 'the mount existed and was force-staged');
  const tree = spawnSync('git', ['-C', dir, 'ls-tree', '-r', '--name-only', orch.getState().branch.feature]).stdout.toString().split(/\r?\n/).filter(Boolean);
  assert.ok(!tree.some((q) => q.startsWith('.claude/rules/worca/')), `the kept branch carries no mount file: ${tree.join(',')}`);
  assert.ok(tree.includes('src/feature.mjs'), 'and the agent work was still committed');
});
