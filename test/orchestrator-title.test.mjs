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
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { prepare } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { posix } from './helpers/posix-path.mjs';
import { checkRows } from './helpers/rows.mjs';
import { stopAt, afterStarts } from './helpers/engines.mjs';

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

test('a mock run emits the stepper before the first exec, exactly one title event, and books its $0 title call', async () => {
  // One run serves four former tests. WORCA_MOCK stays UNSET and the bin cannot spawn, so
  // claude.mock alone must carry the title kickoff (a missed mock shows as zero title events).
  const prevMock = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;
  const projectDir = await makeTmpDir();
  try {
    const orch = createOrchestrator({
      projectDir, workflowId: 'wf_default', prompt: 'Add a settings page with dark mode', auto: true,
      claude: { mock: true, bin: '/nonexistent/claude-must-not-spawn' },
    });
    const seen = [];
    orch.on('title', (p) => seen.push(p));

    const events = []; // ordered { event, hasStepper?, nodeId? }
    let firstStepperAt = -1;
    let firstExecAt = -1;
    let firstClarifyExecAt = -1;

    orch.on('state', (s) => {
      const i = events.push({ event: 'state', hasStepper: !!(s && s.stepper) }) - 1;
      if (firstStepperAt < 0 && s && s.stepper) firstStepperAt = i;
    });
    orch.on('exec', (p) => {
      const i = events.push({ event: 'exec', nodeId: p && p.nodeId }) - 1;
      if (firstExecAt < 0) firstExecAt = i;
      if (firstClarifyExecAt < 0 && p && String(p.nodeId).includes('clarify')) firstClarifyExecAt = i;
    });

    // In case clarify emits a question (non-auto path), answer it immediately.
    orch.on('question', (q) => orch.answer(q.id, { answers: [] }));

    await orch.run();
    await orch._titlePromise;                 // ensure the detached kickoff has settled
    await checkRows([
      { name: 'stepper manifest is emitted before the first exec event (i.e. before preflight/clarify)', run: () => {
        assert.ok(firstStepperAt >= 0, 'a state event with a stepper was emitted');
        assert.ok(firstExecAt >= 0, 'at least one exec event was emitted');
        assert.ok(
          firstStepperAt < firstExecAt,
          `stepper (idx ${firstStepperAt}) must precede the first exec event (idx ${firstExecAt})`,
        );
        // Secondary, for readability: the blocking clarify execution comes strictly later.
        if (firstClarifyExecAt >= 0) {
          assert.ok(firstStepperAt < firstClarifyExecAt, 'stepper precedes the clarify execution');
        }
      } },
      { name: 'emits a title event with the LLM title after createPipeline', run: () => {
        assert.equal(seen.length, 1, 'exactly one title event');
        assert.equal(seen[0].provisional, false);
        assert.ok(seen[0].pipelineId, 'payload carries the pipeline id');
        assert.ok(seen[0].title && seen[0].title.length <= 70);
      } },
      { name: 'title kickoff inherits claude.mock — no WORCA_MOCK env, no real claude spawn', run: () => {
        assert.equal(seen.length, 1, 'exactly one title event');
        assert.equal(seen[0].title, '[mock] role unknown complete');
      } },
      { name: 'a mock run books its $0 title call too (the call count is never hidden as "no cost")', run: () => {
        assert.deepEqual(orch.state.steps.find((s) => s.key === 'x:preflight:1').auxCosts?.title, { usd: 0, calls: 1 });
        assert.equal(orch.state.subAgents.filter((s) => s.subagentType === 'run-title').length, 1);
      } },
    ]);
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  }
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
    assert.match(posix(cwdAtKickoff), new RegExp(`/runs/${orch.getState().id}/repos/${key}$`),
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
    // here too (belt-and-suspenders, exactly as the comment at the site says). The gate is a
    // synchronous call in run()'s setup, before the Preflight bookend closes, so the Task
    // card's start is past it: stop there (stopAt throws if the run never got that far).
    assert.equal((await stopAt(orch, afterStarts(1, { agentsOnly: false }))).status, 'stopped');
    assert.equal(fired, false, 'a resumed run never re-generates its title');
  } finally {
    delete process.env.WORCA_MOCK;
  }
});

test('_titleGenOpts mirrors the run\'s claude policy: bin + mock travel with the title spawn', async () => {
  const projectDir = await makeTmpDir();
  const orch = createOrchestrator({
    projectDir, prompt: 'Add a settings page', auto: true,
    claude: { mock: true, bin: '/nonexistent/claude-must-not-spawn' },
  });
  const o = orch._titleGenOpts();
  assert.equal(o.bin, '/nonexistent/claude-must-not-spawn');
  assert.equal(o.mock, true);
  assert.equal(o.signal, orch.abort.signal);
  assert.equal(o.cwd, orch.projectDir, 'before _setupRunRoot the cwd falls back to projectDir');
});

// ── Away mode cost visibility (T4): the run-title call is worca's own AI spend during the run ──
const titleResult = (o) => o.onEvent({ type: 'result', costUsd: 0.0021, raw: { type: 'result', usage: { input_tokens: 90, output_tokens: 8 } } });

test('the run-title call is booked (row, aux title, total) whether it settles before or after run() returns, and persists to the DB', async () => {
  await checkRows([
    { name: 'the run-title call is booked: a run-title row, aux "title" on the preflight bookend, in the total', run: async () => {
      const projectDir = await makeTmpDir();
      const titleRunClaude = async (o) => { titleResult(o); return { text: 'Add a settings page' }; };
      const orch = createOrchestrator({ projectDir, prompt: 'Add a settings page with dark mode', auto: true,
        claude: { mock: true, bin: '/nonexistent/claude-must-not-spawn' }, titleRunClaude });
      const res = await orch.run();
      await orch._titlePromise;
      assert.equal(res.status, 'done', JSON.stringify(res));
      const pre = orch.state.steps.find((s) => s.key === 'x:preflight:1');
      assert.deepEqual(pre.auxCosts?.title, { usd: 0.0021, calls: 1 });
      const rows = orch.state.subAgents.filter((s) => s.subagentType === 'run-title');
      assert.equal(rows.length, 1);
      assert.match(rows[0].id, /^run-title-[0-9a-f]{8}$/);
      assert.deepEqual([rows[0].costUsd, rows[0].tokens, rows[0].nodeId, rows[0].stepKey, rows[0].status], [0.0021, 98, 'preflight', 'x:preflight:1', 'finished']);
      assert.equal(orch.state.totalCostUsd, 0.0021, 'mock agents cost $0: the total is the title call');
      assert.equal(orch.state.title, 'Add a settings page');
    } },
    { name: 'a title that settles after run() returned is still booked and persisted (History reads the DB)', run: async () => {
      const projectDir = await makeTmpDir();
      // Hold the title until run() has returned: every state write of the run (the done persist, the
      // run-root teardown in its finally) is behind it, so only _recordCost's own persist can land it.
      let release;
      const released = new Promise((r) => { release = r; });
      const titleRunClaude = async (o) => { await released; titleResult(o); return { text: 'Add a settings page' }; };
      const orch = createOrchestrator({ projectDir, prompt: 'Add a settings page with dark mode', auto: true,
        claude: { mock: true, bin: '/nonexistent/claude-must-not-spawn' }, titleRunClaude });
      orch._recordRunMetrics = async () => {};   // its 5 s title grace would otherwise wait for the held title
      const res = await orch.run();
      assert.equal(res.status, 'done');
      const id = orch.getState().id;
      assert.equal(readPipelineForResume(id).row.total_cost_usd, 0, 'nothing booked yet');
      release();
      await orch._titlePromise;
      const { row, steps } = readPipelineForResume(id);
      assert.equal(row.status, 'done');
      assert.equal(row.total_cost_usd, 0.0021, 'the late cost reached pipelines.total_cost_usd');
      assert.deepEqual(steps.find((s) => s.key === 'x:preflight:1').auxCosts, { title: { usd: 0.0021, calls: 1 } });
      const sub = prepare("SELECT cost_usd FROM sub_agents WHERE pipeline_id = ? AND subagent_type = 'run-title'").all(id);
      assert.deepEqual(sub.map((r) => r.cost_usd), [0.0021]);
      const ledger = prepare('SELECT SUM(amount_usd) AS s FROM cost_ledger WHERE pipeline_id = ?').get(id).s;
      assert.ok(Math.abs(ledger - row.total_cost_usd) < 1e-4, 'I2: ledger = total');
    } },
  ]);
});

// ── A paused harness's title can land after a NEW harness resumed the run ────────────────────
// pause() aborts only the node children: the fire-and-forget title call outlives it. A resume builds
// a new harness on the same pipeline row. The old harness's late booking must never write its stale
// paused snapshot over the row the new harness owns (writeState replaces the row and every step row).
async function pausedRunWithHeldTitle({ pauseAt = [1], titleGapMs = 0, beforeRun = null } = {}) {
  const projectDir = await makeTmpDir();
  const g = (a) => spawnSync('git', a, { cwd: projectDir });
  g(['init', '-q', '-b', 'main']); g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  let release;
  const released = new Promise((r) => { release = r; });
  // titleGapMs: time between the title's `result` (booked) and its return (the title written to the row).
  const titleRunClaude = async (o) => {
    await released; titleResult(o);
    if (titleGapMs) await new Promise((r) => setTimeout(r, titleGapMs));
    return { text: 'Add a settings page' };
  };
  let calls = 0; let orchRef = null;            // pauseAt: the producer calls (1-based, across harnesses) that pause
  const mkRunners = () => ({
    producer: async (ctx) => {
      if (pauseAt.includes(++calls)) {
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
  const claude = { mock: true, bin: '/nonexistent/claude-must-not-spawn' };
  const orch1 = createOrchestrator({ projectDir, prompt: 'Add a settings page with dark mode', auto: true, claude, runners: mkRunners(), titleRunClaude });
  orchRef = orch1;
  if (beforeRun) beforeRun(orch1);
  assert.equal((await orch1.run()).status, 'paused');
  const id = orch1.getState().id;
  const resumeWith = () => {
    const orch2 = createOrchestrator({ projectDir, claude, auto: true, runners: mkRunners(), resume: readPipelineForResume(id) });
    orchRef = orch2;
    return orch2;
  };
  // Frames the old harness emits once the title is released: it no longer speaks for the run.
  const stale = [];
  const land = async () => {
    orch1.on('state', (s) => stale.push(`state:${s.status}`));
    orch1.on('subagent', (s) => stale.push(`subagent:${s.subagentType || s.id}`));
    release(); await orch1._titlePromise; await new Promise((r) => setImmediate(r));
  };
  return { orch1, id, resumeWith, land, stale };
}
const stepSig = (steps) => steps.map((s) => `${s.key}:${s.status}`);
const ledgerSum = (id) => prepare('SELECT SUM(amount_usd) AS s FROM cost_ledger WHERE pipeline_id = ?').get(id).s || 0;
const titleRows = (id) => prepare("SELECT cost_usd FROM sub_agents WHERE pipeline_id = ? AND subagent_type = 'run-title'").all(id).map((r) => r.cost_usd);

test('a paused harness\'s late title never rewrites the row of the run a new harness resumed and finished', async () => {
  const { orch1, id, resumeWith, land, stale } = await pausedRunWithHeldTitle();
  assert.equal((await resumeWith().resume()).status, 'done');
  const done = readPipelineForResume(id);
  assert.equal(done.row.status, 'done');
  await land();
  await orch1._persist();                                   // any other late write from the paused harness
  const after = readPipelineForResume(id);
  assert.equal(after.row.status, 'done', 'the finished run never reads paused again');
  assert.deepEqual(stepSig(after.steps), stepSig(done.steps), 'every step row of the finished run is kept');
  assert.equal(after.row.resume_point, done.row.resume_point);
  assert.equal(after.row.total_cost_usd, done.row.total_cost_usd);
  assert.deepEqual(stale, [], 'no stale state or sub-agent frame is broadcast for the run');
  // The title was billed: its row and its ledger line are kept (ledger > total by one title, the
  // drift the plan accepts for a title the resumed run never saw).
  assert.deepEqual(titleRows(id), [0.0021]);
  assert.ok(Math.abs(ledgerSum(id) - (done.row.total_cost_usd + 0.0021)) < 1e-9, `ledger ${ledgerSum(id)} includes the title`);
});

test('a paused harness\'s late title never rewrites a resumed run that paused again', async () => {
  const { orch1, id, resumeWith, land, stale } = await pausedRunWithHeldTitle({ pauseAt: [1, 3] });   // the resumed run pauses at a LATER node
  assert.equal((await resumeWith().resume()).status, 'paused');
  const again = readPipelineForResume(id);
  await land();
  const after = readPipelineForResume(id);
  assert.deepEqual([after.row.status, after.row.resume_point, after.row.total_cost_usd], [again.row.status, again.row.resume_point, again.row.total_cost_usd],
    'the second pause\'s row is the new harness\'s, not the first harness\'s snapshot');
  assert.deepEqual(stepSig(after.steps), stepSig(again.steps));
  assert.deepEqual(stale, []);
  assert.deepEqual(titleRows(id), [0.0021]);
  assert.equal(orch1.getState().totalCostUsd, 0, 'the old harness keeps no booking for a row it gave up');
});

test('a paused run nobody resumed still books its late title into its own row', async () => {
  const { id, land, stale } = await pausedRunWithHeldTitle();
  const paused = readPipelineForResume(id);
  await land();
  const { row, steps } = readPipelineForResume(id);
  assert.equal(row.status, 'paused');
  assert.deepEqual(stepSig(steps), stepSig(paused.steps));
  assert.ok(row.resume_point, 'the resume point survives');
  assert.equal(row.total_cost_usd, 0.0021, 'the title is in the paused run\'s total');
  assert.deepEqual(steps.find((s) => s.key === 'x:preflight:1').auxCosts, { title: { usd: 0.0021, calls: 1 } });
  assert.ok(Math.abs(ledgerSum(id) - row.total_cost_usd) < 1e-9, 'I2: ledger = total');
  assert.ok(stale.includes('subagent:run-title'), 'the run is still this harness\'s to report');
});

// ── The paused harness keeps its row after its own late title (impl review cycle 2, M1) ──────────
// The title books its cost (one write), then updatePipelineTitle writes the title and bumps the row's
// updated_at. Neither is another harness taking the row over: every later write of the paused harness
// that still owns its row must land. The gap between the title's result and its return keeps the two
// millisecond stamps apart.
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const lateReview = (orch, executionId, n) => orch._nightBookAnalysis(`night-decider-1a7e000${n}`, { kind: 'questions', executionId },
  new Date().toISOString(), { costUsd: 0.05, usage: { input_tokens: 10, output_tokens: 5 } }, 'finished', { model: null, effort: null });
const lateStopped = (orch, executionId, n) => orch._nightBookStopped(`night-decider-5e0d000${n}`, { kind: 'questions', executionId },
  new Date().toISOString(), { input_tokens: 10, output_tokens: 0 }, { model: null, effort: null });

test('after its own late title, a paused run nobody resumed still saves its Away mode switch and books a late review (ledger = total)', async () => {
  const { orch1, id, land } = await pausedRunWithHeldTitle({ titleGapMs: 5 });
  await land();
  await checkRows([
    { name: 'after its own late title, a paused run nobody resumed still saves its Away mode switch', run: async () => {
      assert.equal(readPipelineForResume(id).resumePoint.night.override, 'auto');
      orch1.setNightOverride('on');
      await tick();
      assert.equal(readPipelineForResume(id).resumePoint.night.override, 'on', 'the resumed run (a new harness built from the row) runs with it');
      assert.equal(readPipelineForResume(id).row.title, 'Add a settings page');
    } },
    { name: 'after its own late title, a paused run nobody resumed books a late review into its total (ledger = total)', run: async () => {
      const execKey = orch1.state.steps.at(-1).key;
      // Two bookings in the same tick: the first one's write must not make the harness doubt its own row.
      lateReview(orch1, execKey, 1);
      lateStopped(orch1, execKey, 1);
      await tick();
      const { row, steps } = readPipelineForResume(id);
      assert.equal(row.status, 'paused');
      assert.equal(row.total_cost_usd, 0.0521, 'the title and the late review are in the total');
      assert.ok(Math.abs(ledgerSum(id) - row.total_cost_usd) < 1e-9, `I2: ledger ${ledgerSum(id)} = total ${row.total_cost_usd}`);
      assert.deepEqual(steps.find((s) => s.key === execKey).auxCosts?.away, { usd: 0.05, calls: 1, stopped: 1 }, 'the stopped review is counted too');
    } },
  ]);
});

test('a resumed run that paused again keeps saving its Away mode switch after the old harness\'s title lands', async () => {
  const { id, resumeWith, land, stale } = await pausedRunWithHeldTitle({ pauseAt: [1, 3], titleGapMs: 5 });
  const orch2 = resumeWith();
  assert.equal((await orch2.resume()).status, 'paused');
  await land();
  assert.deepEqual(stale, [], 'the old harness no longer speaks for the run');
  orch2.setNightOverride('on');
  await tick();
  assert.equal(readPipelineForResume(id).resumePoint.night.override, 'on', 'the old harness\'s title write never hands the new harness\'s row away');
});

test('a late Away mode review on a harness a resumed run replaced emits nothing and keeps nothing (its rows are kept)', async () => {
  const { orch1, id, resumeWith } = await pausedRunWithHeldTitle();
  assert.equal((await resumeWith().resume()).status, 'done');
  const done = readPipelineForResume(id);
  const stale = [];
  orch1.on('state', (s) => stale.push(`state:${s.status}`));
  orch1.on('subagent', (s) => stale.push(`subagent:${s.transition}`));
  const execKey = orch1.state.steps.at(-1).key;
  const subsBefore = orch1.state.subAgents.length;
  lateStopped(orch1, execKey, 2);
  lateReview(orch1, execKey, 2);
  await tick();
  assert.deepEqual(stale, [], 'no frame under the evicted run');
  assert.equal(orch1.state.subAgents.length, subsBefore, 'nothing kept in the old harness\'s state');
  assert.equal(orch1.state.steps.find((s) => s.key === execKey).auxCosts?.away, undefined);
  const after = readPipelineForResume(id);
  assert.deepEqual([after.row.status, after.row.total_cost_usd, stepSig(after.steps)], [done.row.status, done.row.total_cost_usd, stepSig(done.steps)]);
  const rows = prepare("SELECT id, status, cost_usd FROM sub_agents WHERE pipeline_id = ? AND subagent_type = 'night-decider' ORDER BY id").all(id);
  assert.deepEqual(rows.map((r) => [r.id, r.status, r.cost_usd]), [['night-decider-1a7e0002', 'finished', 0.05], ['night-decider-5e0d0002', 'stopped', null]],
    'each review keeps its own sub_agents row (a random id never overwrites the resumed run\'s)');
});

test('a pause whose own write failed never hands its row away (a late title still lands)', async () => {
  let failed = false;
  const failPauseWrite = (orch) => {
    const real = orch._persist.bind(orch);
    // The write of the pause itself fails (best-effort persistence swallows it): the row is left as it was.
    orch._persist = () => (orch.state.status === 'paused' && !failed ? (failed = true, Promise.resolve(false)) : real());
  };
  const { id, land } = await pausedRunWithHeldTitle({ beforeRun: failPauseWrite });
  assert.equal(failed, true);
  assert.notEqual(readPipelineForResume(id).row.status, 'paused', 'the pause never reached the row');
  await land();
  const { row } = readPipelineForResume(id);
  assert.deepEqual([row.status, row.total_cost_usd], ['paused', 0.0021], 'the harness still owns its row: its next write lands');
});
