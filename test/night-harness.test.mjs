// test/night-harness.test.mjs
// Night mode in the harness: _ask arms a decision timer (fake clock), the decision goes
// through answer(id, payload, 'night-mode'), guardrails pause, and the per-run switch.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { isPause } from '../src/core/run-harness.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { setNightMode, setNightModeToggle } from '../src/core/settings.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { artifactPaths, recordArtifact } from '../src/core/artifacts.mjs';
import { writeNightDecision } from '../src/core/night/store.mjs';
import { recordCostDelta } from '../src/core/cost-budget.mjs';

useTempHome(after);                                  // sqlite under WORCA_HOME
let home; const prev = {};                           // settings.json under HOME
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-night-h-'));
  for (const k of ['HOME', 'USERPROFILE']) { prev[k] = process.env[k]; process.env[k] = home; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true, maxRetries: 3 });
});
// Every test resets the user layer first so tests do not leak settings into each other.
beforeEach(async () => { await setNightMode(null); await setNightModeToggle('auto'); });

function fakeClock(start = Date.parse('2026-09-27T12:00:00Z')) {
  let t = start; let seq = 0; const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    async tick(ms) {
      t += ms;
      for (const [id, tm] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (tm.at <= t) { timers.delete(id); tm.fn(); }
      await new Promise((r) => setImmediate(r));
    },
    pending: () => timers.size,
  };
}
/** Tick the fake clock until `done()` holds. The analysis starts after real file reads, so a fixed
 *  number of ticks is not enough on a loaded machine: give it up to 5 s of wall time. */
async function settle(clock, done) {
  for (const end = Date.now() + 5000; !done() && Date.now() < end;) {
    await clock.tick(0);
    if (!done()) await new Promise((r) => setTimeout(r, 2));
  }
}
const Q = [{ id: 'a', question: 'A?', options: ['x', 'y'], confidence: [90, 10], recommended: 'x' }];

test('grace timeout decides an open question with actor night-mode', async () => {
  await setNightMode({ enabled: true, graceMinutes: 1, strategy: 'weights', window: null });
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h1', nightClock: clock, nightMode: true });
  const p = orch._ask({ id: 'c1', kind: 'clarify', questions: Q });
  await clock.tick(59_000);
  assert.ok(orch.pendingQuestion, 'still waiting before grace');
  await clock.tick(2_000);
  assert.deepEqual(await p, { answers: [{ id: 'a', choice: 'x' }] });
  assert.equal(orch.answeredBy('c1'), 'night-mode');
  assert.equal(orch.nightDecision('c1').strategy, 'weights');
  assert.equal(orch.state.night.decisions, 1);
});

test('a night-decision event is emitted only after the answer landed', async () => {
  await setNightMode({ enabled: true, graceMinutes: 1, strategy: 'weights' });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h1b', nightClock: clock });
  const seen = [];
  orch.on('night-decision', (e) => seen.push({ ...e, pending: orch.pendingQuestion?.id ?? null }));
  const p = orch._ask({ id: 'c1b', kind: 'clarify', questions: Q });
  await clock.tick(0);
  await p;
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].id, seen[0].kind, seen[0].pending], ['c1b', 'clarify', null]);
  assert.equal(seen[0].record.choice, 'x');
});

test('the user answering first cancels the timer', async () => {
  await setNightMode({ enabled: true, graceMinutes: 1, window: null });
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h2', nightClock: clock, nightMode: true });
  const p = orch._ask({ id: 'c2', kind: 'clarify', questions: Q });
  orch.answer('c2', { answers: [{ id: 'a', choice: 'y' }] }, 'local');
  await p;
  assert.equal(clock.pending(), 0);
});

test('not eligible → never decided; per-run opt-in makes it eligible', async () => {
  await setNightMode({ enabled: false, graceMinutes: 1 });
  const clock = fakeClock();
  const off = createOrchestrator({ projectDir: '/tmp/night-h3', nightClock: clock });
  off._ask({ id: 'c3', kind: 'clarify', questions: Q }).catch(() => {});
  await clock.tick(10 * 60_000);
  assert.ok(off.pendingQuestion);
  const on = createOrchestrator({ projectDir: '/tmp/night-h4', nightClock: clock, nightMode: true });
  const p = on._ask({ id: 'c4', kind: 'clarify', questions: Q });
  await clock.tick(61_000);
  await p;
  assert.equal(on.answeredBy('c4'), 'night-mode');
});

test('global toggle on decides immediately; neverDecide waits', async () => {
  await setNightMode({ enabled: true, neverDecide: ['gate'], graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h5', nightClock: clock });
  const p5 = orch._ask({ id: 'c5', kind: 'clarify', questions: Q });
  await clock.tick(0);                  // delay 0 still goes through the (fake) timer
  await p5;
  orch._ask({ id: 'g5', kind: 'gate', issues: [] }).catch(() => {});
  await clock.tick(10 * 60_000);
  assert.equal(orch.pendingQuestion?.id, 'g5');
});

test('"I\'m here" inside the away hours: the open question waits until the next stretch', async () => {
  await setNightMode({ enabled: true, window: '10:00-14:00', timeZone: 'UTC', graceMinutes: null });
  const clock = fakeClock();                                     // 12:00 UTC: inside the hours
  await setNightModeToggle('here', { now: clock.now() });
  const orch = createOrchestrator({ projectDir: '/tmp/night-h-here', nightClock: clock });
  const p = orch._ask({ id: 'c-here', kind: 'clarify', questions: Q });
  await clock.tick(60 * 60_000);
  assert.equal(orch.pendingQuestion?.id, 'c-here', 'not answered in the skipped stretch');
  await clock.tick(21 * 60 * 60_000);                            // the next day, 10:00
  await p;
  assert.equal(orch.answeredBy('c-here'), 'night-mode');
});

test('max decisions reached → the run pauses with night_guardrail', async () => {
  await setNightMode({ enabled: true, maxDecisions: 1, graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h6', nightClock: clock });
  orch._nightCount = () => 1;          // seam: pretend one decision was already made (no pipeline row here)
  // pause() is a no-op unless the run is 'running' (a fresh harness is 'idle').
  orch.state.status = 'running';
  const p6 = orch._ask({ id: 'c6', kind: 'clarify', questions: Q });
  const rejected = assert.rejects(p6, (e) => isPause(e));   // attach before the tick rejects it
  await clock.tick(0);
  await rejected;
  assert.equal(orch.pauseReason, 'night_guardrail');
  assert.match(orch.pauseDetail, /worca answered 1 times on this run, the limit you set/);
  assert.equal(orch._night.override, 'off', 'a guardrail pause turns night mode off for this run');
});

test('a refused pause (run not running) leaves the question waiting for the user', async () => {
  await setNightMode({ enabled: true, maxDecisions: 1, graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h6b', nightClock: clock });
  orch._nightCount = () => 1;          // state.status stays 'idle' → pause() refuses
  orch._ask({ id: 'c6b', kind: 'clarify', questions: Q }).catch(() => {});
  await clock.tick(0);
  assert.equal(orch.pendingQuestion?.id, 'c6b');
  assert.equal(orch.pauseReason, null, 'a refused pause records no reason');
});

test('a night-owned --yes run never hangs: refused pause → the --yes answer, flagged', async () => {
  await setNightMode({ enabled: true, maxDecisions: 1, graceMinutes: 1 });
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h6c', nightClock: clock, auto: true });
  orch._nightCount = () => 1;          // guardrail hit; state 'idle' → pause() refuses
  const p = orch._ask({ id: 'c6c', kind: 'clarify', questions: Q });
  await clock.tick(0);
  assert.deepEqual(await p, { answers: [{ id: 'a', choice: 'x' }] });   // autoChoice → recommended
  assert.equal(orch.answeredBy('c6c'), 'night-mode');
  assert.equal(orch.nightDecision('c6c').strategy, 'auto');
  assert.equal(orch.nightDecision('c6c').flagged, true);
});

test('a --yes run that is not night-eligible answers directly, as today', async () => {
  const orch = createOrchestrator({ projectDir: '/tmp/night-h6d', auto: true, nightClock: fakeClock() });
  assert.deepEqual(await orch._ask({ id: 'c6d', kind: 'gate', issues: [{ severity: 'critical' }] }), { decision: 'continue' });
  assert.equal(orch.answeredBy('c6d'), null);
});

test('a question armed while an earlier decision is still running is decided afterwards', async () => {
  await setNightMode({ enabled: true, strategy: 'weights', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  let release; const gate = new Promise((r) => { release = r; });
  const orch = createOrchestrator({ projectDir: '/tmp/night-h11', nightClock: clock });
  const realDecide = orch._nightDecide.bind(orch);
  // Seam: the FIRST decision is slow (stands in for a 5-minute analysis call).
  orch._nightDecide = async (q, c) => { if (q.id === 'c11a') await gate; return realDecide(q, c); };
  const p1 = orch._ask({ id: 'c11a', kind: 'clarify', questions: Q });
  await clock.tick(0);                                   // decision 1 starts and blocks on `gate`
  orch.answer('c11a', { answers: [{ id: 'a', choice: 'y' }] }, 'local');   // the user answers first
  await p1;
  const p2 = orch._ask({ id: 'c11b', kind: 'clarify', questions: Q });
  await clock.tick(0);                                   // fires while decision 1 is still "deciding"
  assert.equal(orch.pendingQuestion?.id, 'c11b', 'not decided yet');
  release();                                             // decision 1 ends → c11b is re-armed
  for (let i = 0; i < 20 && orch.pendingQuestion; i++) await clock.tick(0);
  await p2;
  assert.equal(orch.answeredBy('c11b'), 'night-mode');
  assert.equal(orch.answeredBy('c11a'), 'local');
});

test('per-run override off: never decided even with the global toggle on', async () => {
  await setNightMode({ enabled: true, graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h8', nightClock: clock });
  orch.setNightOverride('off');
  orch._ask({ id: 'c8', kind: 'clarify', questions: Q }).catch(() => {});
  await clock.tick(10 * 60_000);
  assert.equal(orch.pendingQuestion?.id, 'c8');
  assert.throws(() => orch.setNightOverride('maybe'), (e) => e.code === 'BAD_NIGHT_MODE');
});

test('window-only config (grace null) wakes the open question at the window start', async () => {
  await setNightMode({ enabled: true, graceMinutes: null, window: '13:00-14:00', timeZone: 'UTC', strategy: 'weights' });
  const clock = fakeClock();                         // 12:00Z
  const orch = createOrchestrator({ projectDir: '/tmp/night-h9', nightClock: clock });
  const p = orch._ask({ id: 'c9', kind: 'clarify', questions: Q });
  await clock.tick(59 * 60_000);
  assert.ok(orch.pendingQuestion);
  await clock.tick(60_000);
  await p;
  assert.equal(orch.answeredBy('c9'), 'night-mode');
});

test('resume point carries night {optIn, override} and the constructor reads it back', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/night-h10', resume: { resumePoint: { night: { optIn: true, override: 'on' } } } });
  assert.deepEqual([orch._night.optIn, orch._night.override], [true, 'on']);
  assert.deepEqual(orch.state.night, { optIn: true, override: 'on', decisions: 0, flagged: 0, answers: 0, checks: 0, openedAt: null });
});

test('setNightOverride on re-arms and decides', async () => {
  await setNightMode({ enabled: true, graceMinutes: null, window: null });
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h7', nightClock: clock });
  const p = orch._ask({ id: 'c7', kind: 'clarify', questions: Q });
  await clock.tick(60 * 60_000);
  assert.ok(orch.pendingQuestion);
  orch.setNightOverride('on');
  await clock.tick(0);
  await p;
  assert.equal(orch.answeredBy('c7'), 'night-mode');
});

test('analysis strategy books the nightDecider call on the run', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const nightRunClaude = async (o) => {
    o.onEvent({ type: 'usage', messageId: null, parentId: null, usage: { input_tokens: 1200, cache_read_input_tokens: 800 }, phase: 'message' });
    o.onEvent({ type: 'result', text: '', costUsd: 0.05, isError: false, usage: { input_tokens: 3, output_tokens: 2 } });
    return { text: '{"decisions":[{"id":"a","choice":"y","confidence":90,"rationale":"fits","reversible":true,"scores":{}}]}' };
  };
  const orch = createOrchestrator({ projectDir: '/tmp/night-h12', nightClock: clock, nightRunClaude });
  const p = orch._ask({ id: 'c12', kind: 'clarify', questions: [{ id: 'a', question: 'A?', options: ['x', 'y'] }] });
  await settle(clock, () => !orch.pendingQuestion);
  assert.deepEqual(await p, { answers: [{ id: 'a', choice: 'y' }] });
  assert.equal(orch.nightDecision('c12').strategy, 'analysis');
  assert.equal(orch.nightDecision('c12').meta.reviewPeakContextTokens, 2000, 'the review\'s fullest context rides on the answer');
  assert.ok(orch.state.subAgents.some((s) => s.subagentType === 'night-decider'));
});

test('the review reads task.md and only the newest plan from the store, never superseded versions', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'night-plans-'));
  const { id, dir } = await seedPipeline(projectDir, { title: 'plans' });
  await writeFile(join(dir, 'task.md'), '# task');
  const { root } = artifactPaths(projectDir);
  await mkdir(join(root, 'plans'), { recursive: true });
  for (const name of ['01-01-26-x.md', '01-01-26-x-v2.md']) {       // usually the same millisecond
    await writeFile(join(root, 'plans', name), name);
    recordArtifact(id, 'plan', `plans/${name}`);
  }
  const orch = createOrchestrator({ projectDir });
  orch.pipeline = { id, dir };
  assert.deepEqual(await orch._nightPlanPaths(), [join(dir, 'task.md'), join(root, 'plans', '01-01-26-x-v2.md')]);
  await rm(projectDir, { recursive: true, force: true });
});

// ── Robustness: errors, stop, switching off, resume (review cycle 1: M1-M4) ────────────

test('a night-owned --yes run never hangs when the decider throws: the --yes answer, flagged', async () => {
  await setNightMode({ enabled: true, graceMinutes: 1 });
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h13', nightClock: clock, auto: true });
  orch._nightDecide = async () => { throw new Error('db down'); };
  const p = orch._ask({ id: 'c13', kind: 'clarify', questions: Q });
  await clock.tick(0);
  assert.deepEqual(await p, { answers: [{ id: 'a', choice: 'x' }] });
  assert.equal(orch.answeredBy('c13'), 'night-mode');
  assert.equal(orch.nightDecision('c13').strategy, 'auto');
  assert.equal(orch.nightDecision('c13').flagged, true);
  assert.match(orch.nightDecision('c13').rationale, /db down/);
});

test('a night-owned --yes run never hangs when arming throws', async () => {
  await setNightMode({ enabled: true, graceMinutes: 1 });
  const orch = createOrchestrator({ projectDir: '/tmp/night-h14', nightClock: fakeClock(), auto: true });
  orch._nightArm = () => { throw new Error('bad config'); };
  assert.deepEqual(await orch._ask({ id: 'g14', kind: 'gate', issues: [] }), { decision: 'continue' });
  assert.equal(orch.answeredBy('g14'), 'night-mode');
});

test('a throwing decider in an attended run leaves the question for the user', async () => {
  await setNightMode({ enabled: true, graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h15', nightClock: clock });
  orch._nightDecide = async () => { throw new Error('db down'); };
  orch._ask({ id: 'c15', kind: 'clarify', questions: Q }).catch(() => {});
  await clock.tick(0);
  assert.equal(orch.pendingQuestion?.id, 'c15');
});

/** A nightDecider call that blocks until released or aborted (reports the signal it got). */
function blockingAnalysis() {
  const seen = { signal: null }; let release;
  const run = (o) => new Promise((res, rej) => {
    seen.signal = o.signal;
    release = () => res({ text: '{"decisions":[{"id":"a","choice":"y","confidence":90,"rationale":"fits","reversible":true,"scores":{}}]}' });
    o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  return { run, seen, release: () => release() };
}
const QA = [{ id: 'a', question: 'A?', options: ['x', 'y'] }];

test('stop() aborts an in-flight night analysis', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const a = blockingAnalysis();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h16', nightClock: clock, nightRunClaude: a.run });
  const p = orch._ask({ id: 'c16', kind: 'clarify', questions: QA });
  const rejected = assert.rejects(p, (e) => e.name === 'AbortError');
  await settle(clock, () => a.seen.signal);
  assert.ok(a.seen.signal, 'the analysis started');
  orch.stop();
  await rejected;
  assert.equal(a.seen.signal.aborted, true, 'the nightDecider child is killed by stop');
  await settle(clock, () => !orch._night.deciding);
  assert.equal(orch._night.deciding, false);
  assert.equal(orch.nightDecision('c16'), null);
});

test('stop() cuts a night recovery backoff short', async () => {
  await setNightMode({ enabled: true, graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h17', nightClock: clock });
  const p = orch._ask({ id: 'r17', kind: 'recovery', recovery: { cls: 'network' } });
  const rejected = assert.rejects(p, (e) => e.name === 'AbortError');
  await clock.tick(0);
  assert.equal(orch._night.deciding, true, 'waiting out the backoff');
  orch.stop();
  await rejected;
  await settle(clock, () => !orch._night.deciding);
  assert.equal(orch._night.deciding, false, 'the backoff sleep ended on stop');
});

for (const how of ['run override', 'global toggle']) {
  test(`switching night mode off (${how}) during an analysis drops the decision`, async () => {
    await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: null, window: null });
    await setNightModeToggle('on');
    const clock = fakeClock();
    const a = blockingAnalysis();
    const orch = createOrchestrator({ projectDir: '/tmp/night-h18', nightClock: clock, nightRunClaude: a.run });
    orch._ask({ id: 'c18', kind: 'clarify', questions: QA }).catch(() => {});
    await settle(clock, () => a.seen.signal);
    if (how === 'run override') orch.setNightOverride('off');
    else { await setNightModeToggle('off'); orch.nightConfigChanged(); }
    a.release();
    await settle(clock, () => !orch._night.deciding);
    assert.equal(orch.pendingQuestion?.id, 'c18', 'still waiting for the user');
    assert.equal(orch.nightDecision('c18'), null);
    assert.equal(orch.state.night.decisions, 0);
  });
}

test('night counters continue from the DB (a resumed run does not restart them at 0)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-night-h19-'));
  try {
    const { id: pid } = await seedPipeline(dir);
    writeNightDecision(pid, { questionId: 'old-1', kind: 'clarify', choice: 'x', strategy: 'weights', flagged: true });
    writeNightDecision(pid, { questionId: 'old-2', kind: 'gate', choice: 'continue', strategy: 'rule', flagged: false });
    await setNightMode({ enabled: true, graceMinutes: 1, strategy: 'weights' });
    await setNightModeToggle('on');
    const clock = fakeClock();
    const orch = createOrchestrator({ projectDir: '/tmp/night-h19', nightClock: clock });
    orch.pipeline = { id: pid, dir, promptText: '' };
    orch._nightSyncCounts();                         // what _resume() does once the row is known
    assert.deepEqual([orch.state.night.decisions, orch.state.night.flagged], [2, 1]);
    const p = orch._ask({ id: 'c19', kind: 'clarify', questions: Q });
    await clock.tick(0);
    await p;
    assert.deepEqual([orch.state.night.decisions, orch.state.night.flagged], [3, 1], 'the new decision adds to the stored totals');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the night spend cap ignores attended daytime spend and counts the unattended stretch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-night-h20-'));
  try {
    const { id: pid } = await seedPipeline(dir);
    const at = (iso) => Date.parse(iso);
    recordCostDelta({ pipelineId: pid, amountUsd: 5, tsMs: at('2026-09-27T10:00:00Z') });   // attended morning spend
    await setNightMode({ enabled: true, graceMinutes: 1, strategy: 'weights', window: '22:00-08:00', timeZone: 'UTC', spendCapUsd: 1 });
    const clock = fakeClock(at('2026-09-27T15:00:00Z'));
    const orch = createOrchestrator({ projectDir: '/tmp/night-h20', nightClock: clock, nightMode: true });
    orch.state.status = 'running';
    const p1 = orch._ask({ id: 'c20a', kind: 'clarify', questions: Q });
    await clock.tick(61_000);
    assert.deepEqual(await p1, { answers: [{ id: 'a', choice: 'x' }] }, 'a grace decision at 15:00 is not charged the morning');

    recordCostDelta({ pipelineId: pid, amountUsd: 2, tsMs: clock.now() });                   // spent while unattended
    const p2 = orch._ask({ id: 'c20b', kind: 'clarify', questions: Q });
    const rejected = assert.rejects(p2, (e) => isPause(e));
    await clock.tick(61_000);
    await rejected;
    assert.equal(orch.pauseReason, 'night_guardrail');
    assert.match(orch.pauseDetail, /spending while away reached \$1\.00/);
    assert.ok(Math.abs(orch._nightSpentUsd({ window: '22:00-08:00', timeZone: 'UTC', graceMinutes: 1 }) - 2) < 1e-9, 'only the unattended $2 counts');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a human answer ends the unattended stretch the spend cap counts', async () => {
  await setNightMode({ enabled: true, graceMinutes: 1, strategy: 'weights', window: null });
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h21', nightClock: clock, nightMode: true });
  const p1 = orch._ask({ id: 'c21a', kind: 'clarify', questions: Q });
  await clock.tick(61_000);
  await p1;
  assert.ok(orch._night.since != null, 'the night decision started a stretch');
  const p2 = orch._ask({ id: 'c21b', kind: 'clarify', questions: Q });
  orch.answer('c21b', { answers: [{ id: 'a', choice: 'y' }] }, 'local');
  await p2;
  assert.equal(orch._night.since, null);
});

test('a night-owned --yes run never hangs when its open kind joins neverDecide: the --yes answer', async () => {
  await setNightMode({ enabled: true, graceMinutes: 1, strategy: 'weights' });
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h22', nightClock: clock, auto: true });
  const p = orch._ask({ id: 'c22', kind: 'clarify', questions: Q });
  assert.ok(orch.pendingQuestion, 'night mode owns the ask');
  await setNightMode({ enabled: true, graceMinutes: 1, strategy: 'weights', neverDecide: ['clarify'] });
  orch._nightArm();                    // what a settings change (or a dropped decision's 'rearm') does
  await clock.tick(0);
  assert.equal(orch.pendingQuestion, null, 'answered, not left waiting in an unattended run');
  assert.deepEqual(await p, { answers: [{ id: 'a', choice: 'x' }] });
  assert.equal(orch.nightDecision('c22').strategy, 'auto');
});

test('neverDecide clarify leaves a clarifier FORM ask for the user', async () => {
  await setNightMode({ enabled: true, graceMinutes: 1, neverDecide: ['clarify'] });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h23', nightClock: clock });
  orch._ask({ id: 'clarify-n-1', kind: 'form', origin: 'clarify', form: 'pick', version: 1, answerSchema: { type: 'object', properties: {} }, autoValues: {} }).catch(() => {});
  await clock.tick(10 * 60_000);
  assert.equal(orch.pendingQuestion?.id, 'clarify-n-1');
  assert.equal(clock.pending(), 0, 'no decision armed');
});

test('the user answering during a night analysis kills it, and the next question is not held up', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const a = blockingAnalysis();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h24', nightClock: clock, nightRunClaude: a.run });
  const p = orch._ask({ id: 'c24', kind: 'clarify', questions: QA });
  await settle(clock, () => a.seen.signal);
  assert.ok(a.seen.signal, 'the analysis started');
  orch.answer('c24', { answers: [{ id: 'a', choice: 'x' }] }, 'local');
  assert.deepEqual(await p, { answers: [{ id: 'a', choice: 'x' }] });
  assert.equal(a.seen.signal.aborted, true, 'the superseded nightDecider child is killed (no longer billed)');
  await settle(clock, () => !orch._night.deciding);
  assert.equal(orch._night.deciding, false, 'the next question is free to be decided');
  assert.equal(orch.nightDecision('c24'), null);
});

test('the run-view switch on a PAUSED run lands in its resume point (not lost on resume)', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/night-h25' });
  orch.state.status = 'paused';
  orch.state.resumePoint = { night: { optIn: false, override: 'auto' } };
  orch._persist = async () => {};
  orch.setNightOverride('on', 'alice');
  assert.equal(orch.state.resumePoint.night.override, 'on');
  const resumed = createOrchestrator({ projectDir: '/tmp/night-h25', resume: { resumePoint: orch.state.resumePoint } });
  assert.equal(resumed._night.override, 'on');
});

test('the run-view switch is refused on a finished run', () => {
  for (const status of ['done', 'stopped', 'error']) {
    const orch = createOrchestrator({ projectDir: '/tmp/night-h26' });
    orch.state.status = status;
    assert.throws(() => orch.setNightOverride('on', 'alice'), (e) => e.code === 'NIGHT_NOT_LIVE', status);
  }
});

test('flipping the night switch does not take over "who paused" (lastAction)', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/night-h27' });
  orch.state.lastAction = { kind: 'pause', by: 'alice', at: 't' };
  orch.setNightOverride('on', 'bob');
  assert.deepEqual(orch.state.lastAction, { kind: 'pause', by: 'alice', at: 't' });
});

test('--night on a resume opts in a run that was not opted in; the saved opt-in is never dropped', () => {
  const rp = (optIn) => ({ resumePoint: { night: { optIn, override: 'auto' } } });
  assert.equal(createOrchestrator({ projectDir: '/tmp/night-h28', nightMode: true, resume: rp(false) })._night.optIn, true);
  assert.equal(createOrchestrator({ projectDir: '/tmp/night-h28', resume: rp(true) })._night.optIn, true);
  assert.equal(createOrchestrator({ projectDir: '/tmp/night-h28', resume: rp(false) })._night.optIn, false);
});

test('the unattended stretch start survives a pause/resume (the spend cap keeps counting it)', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/night-h29' });
  orch._night.since = 1234;
  orch.pipeline = { id: 'p', dir: '/tmp/night-h29' };
  const saved = orch._buildResumePoint(null).night;
  assert.equal(saved.since, 1234);
  assert.equal(createOrchestrator({ projectDir: '/tmp/night-h29', resume: { resumePoint: { night: saved } } })._night.since, 1234);
});

test('a failed night analysis still books what it cost', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const nightRunClaude = async (o) => {
    o.onEvent({ type: 'result', text: '', costUsd: 0.07, isError: false, usage: { input_tokens: 3, output_tokens: 2 } });
    throw new Error('claude exited with code 1');
  };
  const orch = createOrchestrator({ projectDir: '/tmp/night-h30', nightClock: clock, nightRunClaude });
  const booked = [];
  orch._recordCost = (usd) => booked.push(usd);
  const p = orch._ask({ id: 'c30', kind: 'clarify', questions: QA });
  for (let i = 0; i < 20 && orch.pendingQuestion; i++) await clock.tick(0);
  await p;
  assert.equal(orch.nightDecision('c30').flagged, true, 'analysis unavailable → flagged fallback');
  assert.ok(booked.some((u) => u > 0), 'the failed call was billed and is booked');
});

test('an unmarked run with Which runs = All runs waits by day', async () => {
  await setNightMode({ enabled: true, graceMinutes: 1, window: '22:00-07:00', timeZone: 'UTC' });
  const clock = fakeClock(Date.parse('2026-09-27T12:00:00Z'));
  const orch = createOrchestrator({ projectDir: '/tmp/night-h40', nightClock: clock });
  orch._ask({ id: 'c40', kind: 'clarify', questions: Q }).catch(() => {});
  await clock.tick(10 * 60_000);
  assert.equal(orch.pendingQuestion?.id, 'c40', 'not answered by day');
  assert.equal(orch.state.night.openedAt, '2026-09-27T12:00:00.000Z');
});

test('"I\'m away now" answers an unmarked run with Which runs = Only runs I marked', async () => {
  await setNightModeToggle('on');
  await setNightMode({ strategy: 'weights' });
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h41', nightClock: clock });
  const p = orch._ask({ id: 'c41', kind: 'clarify', questions: Q });
  await clock.tick(0);
  assert.deepEqual(await p, { answers: [{ id: 'a', choice: 'x' }] });
  assert.equal(orch.answeredBy('c41'), 'night-mode');
});

test('a --yes run is not handed to Away mode by "I\'m away now" alone (as today)', async () => {
  await setNightModeToggle('on');
  const orch = createOrchestrator({ projectDir: '/tmp/night-h42', auto: true, nightClock: fakeClock() });
  assert.deepEqual(await orch._ask({ id: 'c42', kind: 'gate', issues: [{ severity: 'critical' }] }), { decision: 'continue' });
  assert.equal(orch.answeredBy('c42'), null);
});

test('a question on an always-wait kind reports no openedAt', async () => {
  await setNightMode({ graceMinutes: 1, neverDecide: ['clarify'] });
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: '/tmp/night-h43', nightClock: clock, nightMode: true });
  orch._ask({ id: 'c43', kind: 'clarify', questions: Q }).catch(() => {});
  await clock.tick(0);
  assert.equal(orch.state.night.openedAt, null);
});

test('openedAt follows the always-wait list while the question is open', async () => {
  await setNightMode({ graceMinutes: 30, neverDecide: ['clarify'] });
  const clock = fakeClock(Date.parse('2026-09-27T12:00:00Z'));
  const orch = createOrchestrator({ projectDir: '/tmp/night-h44', nightClock: clock, nightMode: true });
  orch._ask({ id: 'c44', kind: 'clarify', questions: Q }).catch(() => {});
  await clock.tick(0);
  assert.equal(orch.state.night.openedAt, null);
  await setNightMode({ graceMinutes: 30, neverDecide: [] });
  orch.nightConfigChanged();
  assert.equal(orch.state.night.openedAt, '2026-09-27T12:00:00.000Z', 'the re-arm publishes the open time');
});
