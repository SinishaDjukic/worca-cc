// Offline end-to-end: the store is mounted into a mock run, every agent execution
// sees the index, a file an agent writes lands in the store after its execution,
// the next execution's index lists it, the run summary carries the change, and the
// mount never enters the worktree diff. Default (detached) mode + a legacy pin.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { runAgentExecution } from '../src/core/graph/executor.mjs';
import { memoryRoot, writeMemory, readMemory, listMemory, readScopeState, GLOBAL_SCOPE, projectScope } from '../src/core/memory-store.mjs';
import { RESULTS_FILE } from '../src/core/results.mjs';
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
 *  still get the index through _execCtx) and, on the FIRST implementer execution, writes
 *  one memory file into the mount before delegating to the real (mock) execution.
 *  `ctx.memoryMount` is null when the mount failed — the producer must still run. */
function recordingProducer(seen) {
  let wrote = false;
  return async (ctx) => {
    seen.push({ key: ctx.node.key, executionId: ctx.executionId, index: ctx.memoryIndex, mount: ctx.memoryMount, cwd: ctx.projectDir });
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

test('detached (default): mount at <pipeline.dir>/memory, index in every producer ctx, sync after the writing execution, summary + ledger', { timeout: 120000 }, async () => {
  const { orch, seen } = await runOnce();
  const st = orch.getState();
  const pipelineDir = st.pipelineDir;
  assert.equal(st.memoryMount, join(pipelineDir, 'memory'));
  assert.ok(seen.every((s) => !s.mount.startsWith(s.cwd)), 'the mount is outside every run cwd');
  assert.ok(seen.length >= 4, `producers ran: ${seen.length}`);
  for (const s of seen) {
    assert.ok(s.index.startsWith('## Worca memory\n'), `${s.key}: index present`);
    assert.ok(s.index.includes('`testing.md`'), `${s.key}: seeded global file listed`);
    assert.equal(s.mount, st.memoryMount);
  }
  const impl = seen.filter((s) => s.key === 'implementer');
  assert.ok(impl.length >= 2, 'wf_default under mock runs the implementer twice (review → fix)');
  assert.ok(!impl[0].index.includes('lesson.md'), 'first implementer spawn: not yet written');
  assert.ok(impl[1].index.includes('`lesson.md`') && impl[1].index.includes('`style.md`'), 'the fix cycle sees both new files');
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

test('legacy (pinned): same mount location and the same sync', { timeout: 120000 }, async () => {
  process.env.WORCA_RUN_ROOT = 'legacy';
  try {
    const { orch } = await runOnce();
    const st = orch.getState();
    assert.equal(st.memoryMount, join(st.pipelineDir, 'memory'));
    assert.ok(await readMemory(memoryRoot(), projectScope(orch.members[0].projectKey), 'lesson'));
  } finally { delete process.env.WORCA_RUN_ROOT; }
});

test('empty store: every scope dir exists in the mount and the index says so', { timeout: 120000 }, async () => {
  const { orch, seen } = await runOnce({ seed: false });
  const first = seen[0].index;
  assert.match(first, /Global — .*:\n- \(nothing yet\)\n/);
  assert.ok(existsSync(join(orch.getState().memoryMount, 'project')));
});

test('resume: a file written by an interrupted execution is synced BEFORE the remount', { timeout: 120000 }, async () => {
  const { orch } = await runOnce();
  const mount = orch.getState().memoryMount;
  await writeFile(join(mount, 'project', 'interrupted.md'), 'Written mid-execution.\n');
  const before = orch.memoryChanges.length;
  await orch._mountMemory({ resume: true });
  assert.ok(await readMemory(memoryRoot(), projectScope(orch.members[0].projectKey), 'interrupted'), 'captured into the store');
  assert.equal(orch.memoryChanges.length, before + 1);
  assert.equal(orch.memoryChanges.at(-1).agentKey, null);
  assert.equal(orch.memoryChanges.at(-1).nodeId, 'resume');
  assert.ok(existsSync(join(mount, 'project', 'interrupted.md')), 'the fresh mount carries it (it is in the store now)');
  assert.ok(orch.memoryIndex.includes('`interrupted.md`'));
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
  const { orch } = await runOnce();
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
  assert.equal(orch.memoryIndex, '');
  assert.equal(orch.getState().memoryMount, null);
  assert.ok(seen.length >= 4, `producers ran: ${seen.length}`);
  for (const s of seen) { assert.equal(s.index, '', `${s.key}: no index`); assert.equal(s.mount, null, `${s.key}: no mount`); }
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
  assert.ok(!seen[0].index.includes('my notes'), 'and it never reaches an agent index');
});
