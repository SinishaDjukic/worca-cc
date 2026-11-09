// test/design-build-lead.test.mjs — Design P2 Task 10: the DesignBuild lead pass and the slot semaphore.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { framesOf, newBuild, newDesign, useDesignEnv, waitForFrame } from './helpers/design-fixture.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { crewFile, designDir, designWorkDir, kitDir } from '../src/core/design/paths.mjs';
import { getBuild, getDesign, listAgents } from '../src/core/design/store.mjs';
import { addProject, listProjects } from '../src/core/projects.mjs';
import { createSemaphore } from '../src/core/design/semaphore.mjs';
import { designCaps } from '../src/core/design/limits.mjs';
import { ASK_DENY_RULES } from '../src/core/ask/deny-rules.mjs';
import { defaultGuardrailSetId, readGuardrailSet } from '../src/core/guardrail-store.mjs';
import { guardrailsToPermissionRules } from '../src/core/guardrails.mjs';

useDesignEnv(after);

const tick = () => new Promise((r) => setImmediate(r));
/** A promise's outcome as a flag: `pending`, `ok` or `rejected` (with `err`). */
function track(p) {
  const t = { state: 'pending', err: null };
  p.then(() => { t.state = 'ok'; }, (err) => { t.state = 'rejected'; t.err = err; });
  return t;
}

test('the lead writes the plan: planning, then design-plan with planned sections, then done', async () => {
  const d = newDesign(); const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=2' });
  const r = await build.run();
  assert.equal(r.status, 'done');
  assert.equal(calls.length, 4, 'the lead, one builder per section, then the integrate pass');
  assert.equal(frames[0].type, 'design-build', 'P4 resets on the first frame of a new buildId');
  assert.equal(framesOf(frames, 'design-build')[0].status, 'planning');
  assert.equal(framesOf(frames, 'design-build')[0].round, 1);
  assert.equal(framesOf(frames, 'design-build')[0].kind, 'first');
  const plan = framesOf(frames, 'design-plan')[0];
  assert.equal(plan.planRev, 1);
  assert.deepEqual(plan.sections.map((s) => [s.id, s.status]), [['hero', 'planned'], ['features', 'planned']]);
  assert.deepEqual(plan.canvas, { w: 1440 }, 'C-5; P4 and P7 read it');
  const ag = framesOf(frames, 'design-agent');
  assert.deepEqual([ag[0].role, ag[0].job, ag[0].status, ag[0].sectionId, ag[0].engine, ag[0].error], ['lead', 'Lead', 'starting', null, 'claude', null]);
  assert.ok('model' in ag[0]);
  assert.equal(ag.at(-1).status, 'done');
  assert.ok(framesOf(frames, 'design-file').some((f) => f.path === 'tokens.css'));
  assert.ok(framesOf(frames, 'design-delta').some((f) => f.path === 'tokens.css'));
  const row = getBuild(build.id);
  assert.equal(row.status, 'done');
  assert.ok(row.endedAt);
});

test('M5: an optional band passes through design-plan, and only when given', async () => {
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=3 MOCK_BANDS' });
  await build.run();
  assert.deepEqual(framesOf(frames, 'design-plan')[0].sections.map((s) => s.band), ['Top', 'Top', undefined]);
  assert.equal('band' in framesOf(frames, 'design-plan')[0].sections[2], false);
});

test('.crew.json lists the plan at once, with C-5 statuses', async () => {
  const d = newDesign(); const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=2' });
  // Read when the plan is sent: by the end of run() the builders have moved every section on.
  let crew = null; let rows = null;
  build.on('frame', (f) => {
    if (f.type !== 'design-plan') return;
    crew = JSON.parse(readFileSync(crewFile(d.id), 'utf8'));
    rows = getBuild(build.id).sections.map((s) => [s.id, s.status, s.agentId, s.summary]);
  });
  await build.run();
  assert.deepEqual(crew, [{ id: 'hero', status: 'planned', summary: '' }, { id: 'features', status: 'planned', summary: '' }]);
  assert.deepEqual(rows, [['hero', 'planned', null, ''], ['features', 'planned', null, '']], 'the section records are persisted');
});

test('a bad plan gets one resume with the errors, then passes', async () => {
  const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_BAD_PLAN' });
  assert.equal((await build.run()).status, 'done');
  assert.equal(calls.length, 6, 'the lead, its one resume, the three default sections, the integrate pass');
  assert.equal(calls.filter((c) => c.cwd === calls[0].cwd && c.maxTurns === 40).length, 2, 'one plan resume only');
  assert.ok(calls[1].resumeSessionId);
  assert.match(calls[1].prompt, /plan\.json/);
});

test('a plan that stays bad fails the round with plan-invalid', async () => {
  const { build, calls, frames } = newBuild(newDesign(), { brief: 'MOCK_BAD_PLAN_ALWAYS' });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'plan-invalid' });
  assert.equal(calls.length, 2);
  assert.ok(framesOf(frames, 'design-agent').at(-1).error);
});

test('a lead that crashes fails the round, run() does not reject', async () => {
  const { build } = newBuild(newDesign(), { brief: 'MOCK_FAIL_LEAD' });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'lead-failed' });
  const long = newBuild(newDesign(), { deps: { runClaude: () => Promise.reject(new Error('x'.repeat(1000))) } });
  assert.deepEqual(await long.build.run(), { status: 'error', reason: 'lead-failed' });
  assert.equal(framesOf(long.frames, 'design-agent').at(-1).error.length, 300, 'the error is capped at 300 characters');
  assert.equal(listAgents(long.build.id)[0].status, 'error');
});

test('the spawn gets the session the CLI reported on the next process', async () => {
  const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_BAD_PLAN' });
  await build.run();
  const row = listAgents(build.id)[0];
  assert.equal(calls[1].resumeSessionId, row.sessionId);
});

test('run() removes a stale integration.json before the lead starts', async () => {
  const d = newDesign();
  const stale = join(designWorkDir(d.id), 'integration.json');
  writeFileSync(stale, '{"v":1,"rework":[]}');
  let seen = null;
  const { build } = newBuild(d, { deps: { runClaude: (o) => { seen ??= existsSync(stale); return mockRun(o); } } });
  await build.run();
  assert.equal(seen, false);
});

test('the lead books the difference of the running total, once per process, in the design ledger', async () => {
  const d = newDesign();
  const { build } = newBuild(d, { brief: 'MOCK_BAD_PLAN_ALWAYS MOCK_COST=0.1' });
  assert.equal((await build.run()).reason, 'plan-invalid');
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(getDesign(d.id).costUsd, 0.2);
  near(getBuild(build.id).costUsd, 0.2);
  near(listAgents(build.id)[0].costUsd, 0.2);
});

test('a frame listener that throws never breaks the build', async () => {
  const { build } = newBuild(newDesign());
  build.on('frame', () => { throw new Error('listener down'); });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
});

test('each spawn takes the global slot, then waits out the stagger; every exit releases the slot', async () => {
  const at = [];
  const slot = { taken: 0, freed: 0 };
  const { build } = newBuild(newDesign(), { brief: 'MOCK_BAD_PLAN_ALWAYS', deps: {
    staggerMs: 60,
    acquireGlobal: async ({ signal }) => { assert.ok(signal instanceof AbortSignal); slot.taken += 1; },
    releaseGlobal: () => { slot.freed += 1; },
    runClaude: (o) => { at.push(performance.now()); return mockRun(o); },
  } });
  await build.run();
  assert.equal(at.length, 2);
  assert.ok(at[1] - at[0] >= 50, `${at[1] - at[0]} ms between spawns`);
  assert.deepEqual(slot, { taken: 2, freed: 2 });
});

test("a registered project is named to the lead and added to its dirs", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-design-proj-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  await addProject({ name: 'brandsite', path: dir });
  const p = (await listProjects()).find((x) => x.name === 'brandsite');
  const { build, calls } = newBuild(newDesign({ projectKey: p.key }));
  await build.run();
  assert.ok(calls[0].prompt.includes(`Project: ${p.path} `), calls[0].prompt);
  assert.ok(calls[0].addDirs.includes(p.path));
});

test('M8: every process of a real build carries the read denies, and the guardrail set once a project is attached', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-design-deny-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  await addProject({ name: 'denysite', path: dir });
  const p = (await listProjects()).find((x) => x.name === 'denysite');
  const guard = guardrailsToPermissionRules((await readGuardrailSet(defaultGuardrailSetId())).settings).deny.filter((r) => !ASK_DENY_RULES.includes(r));
  assert.ok(guard.length, 'the default set has a rule of its own');
  const bare = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1' });
  const proj = newBuild(newDesign({ projectKey: p.key }), { brief: 'MOCK_SECTIONS=1' });
  for (const { build } of [bare, proj]) assert.deepEqual(await build.run(), { status: 'done', reason: null });
  for (const { calls } of [bare, proj]) {
    assert.equal(calls.length, 3, 'lead, hero, integrate');
    for (const o of calls) assert.ok(o.permissionRules.deny.includes('Read(//**/.env*)'), o.cwd);
  }
  for (const o of bare.calls) assert.ok(guard.every((r) => !o.permissionRules.deny.includes(r)), 'no project: no guardrail rule');
  for (const o of proj.calls) assert.ok(guard.every((r) => o.permissionRules.deny.includes(r)), `${o.cwd}: the guardrail rules`);
});

test('M1 holds: nothing is recorded for playback', async () => {
  const d = newDesign();
  const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1' });
  await build.run();
  assert.equal(readdirSync(designDir(d.id), { recursive: true }).some((f) => String(f).endsWith('events.ndjson')), false);
});

test('a kit contract on disk is named to the lead', async () => {
  const d = newDesign();
  mkdirSync(kitDir(d.id), { recursive: true });
  const contract = join(kitDir(d.id), 'CONTRACT.md');
  writeFileSync(contract, 'x');
  const { build, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1' });
  await build.run();
  assert.ok(calls[0].prompt.includes(`Kit contract: ${contract}`), calls[0].prompt);
  const bare = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1' });
  await bare.build.run();
  assert.doesNotMatch(bare.calls[0].prompt, /Kit contract:/, 'no file, no line');
});

const mockRun = (o) => runClaude({ ...o, mock: true });
const classed = (message, errorClass) => Object.assign(new Error(message), { errorClass });

test('a transient error resumes the lead once: the continue prompt on its session, the first prompt with none', async () => {
  let n = 0;
  const runner = (o) => {
    if (++n > 1) return mockRun(o);
    o.onEvent({ type: 'session', init: true, sessionId: 'sess-lead-1', parentId: null, model: 'claude-sonnet-5-5' });
    return Promise.reject(classed('mock rate limit', 'rate_limit'));
  };
  const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { runClaude: runner } });
  assert.equal((await build.run()).status, 'done');
  assert.match(calls[1].prompt, /^Continue your task/);
  assert.equal(calls[1].resumeSessionId, 'sess-lead-1');
  let m = 0;
  const bare = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { runClaude: (o) => (++m === 1 ? Promise.reject(classed('mock rate limit', 'rate_limit')) : mockRun(o)) } });
  assert.equal((await bare.build.run()).status, 'done');
  assert.equal(bare.calls[1].resumeSessionId, undefined);
  assert.equal(bare.calls[1].prompt, bare.calls[0].prompt, 'no session to resume: the first prompt again, brief and all');
  const twice = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { runClaude: () => Promise.reject(classed('mock rate limit', 'rate_limit')) } });
  assert.deepEqual(await twice.build.run(), { status: 'error', reason: 'lead-failed' });
  assert.equal(twice.calls.length, 2, 'one retry, then the lead fails');
});

test('a usage limit pauses the build; a budget-stopped result pauses it at total-limit', async () => {
  const limit = newBuild(newDesign(), { deps: { runClaude: () => Promise.reject(classed('mock usage limit', 'usage_limit')) } });
  assert.deepEqual(await limit.build.run(), { status: 'paused', reason: 'usage_limit' });
  assert.equal(limit.calls.length, 1);
  assert.equal(getBuild(limit.build.id).status, 'paused');
  assert.ok(getBuild(limit.build.id).endedAt, 'a pause still writes endedAt');
  const budget = newBuild(newDesign(), { deps: { runClaude: async (o) => {
    o.onEvent({ type: 'result', subtype: 'error_max_budget_usd', isError: true, costUsd: 0, cumulativeCost: true });
    return { text: '', exitCode: 0 };
  } } });
  assert.deepEqual(await budget.build.run(), { status: 'paused', reason: 'total-limit' });
});

test('a lost session starts the lead fresh once, from its first prompt', async () => {
  let n = 0;
  const runner = (o) => (++n === 2 ? Promise.reject(new Error('claude exited with code 1: No conversation found with session ID: x')) : mockRun(o));
  const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_BAD_PLAN', deps: { runClaude: runner } });
  assert.equal((await build.run()).status, 'done');
  assert.ok(calls[1].resumeSessionId);
  assert.equal(calls[2].resumeSessionId, undefined, 'no resume of a session the CLI lost');
  assert.equal(calls[2].prompt, calls[0].prompt);
  const lost = () => Promise.reject(new Error('claude exited with code 1: No conversation found with session ID: x'));
  let m = 0;
  const always = newBuild(newDesign(), { deps: { runClaude: (o) => (++m <= 4 ? lost() : mockRun(o)) } });
  assert.deepEqual(await always.build.run(), { status: 'error', reason: 'lead-failed' }, 'a second lost session fails');
  assert.equal(always.calls.length, 2);
});

test('M8: auth, quota and model errors pause the whole build as usage_limit does', async () => {
  for (const c of ['auth', 'quota', 'model']) {
    const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2', deps: {
      maxBuildersFor: () => 1,
      runClaude: (o) => (o.cwd.endsWith('hero') ? Promise.reject(classed(`mock ${c}`, c)) : runClaude({ ...o, mock: true })),
    } });
    assert.deepEqual(await build.run(), { status: 'paused', reason: c }, c);
    assert.equal(calls.some((o) => o.cwd.endsWith('features')), false, `${c}: nothing more spawns`);
    assert.equal(calls.filter((o) => o.cwd.endsWith('hero')).length, 1, `${c}: no retry`);
  }
});

test('M8: a network error resumes that agent once, as a rate limit does; a retry before any session starts over', async () => {
  let n = 0;
  const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: {
    runClaude: (o) => (o.cwd.endsWith('hero') && ++n === 1 ? Promise.reject(classed('fetch failed', 'network')) : runClaude({ ...o, mock: true })),
  } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  const hero = calls.filter((o) => o.cwd.endsWith('hero'));
  assert.equal(hero.length, 2);
  assert.equal(hero[1].resumeSessionId, undefined, 'the first process never reported a session');
  assert.equal(hero[1].prompt, hero[0].prompt, 'so the retry gets the first prompt, brief and all');
  assert.match(hero[1].prompt, /^Section: hero$/m);
});

test('L2.31: an abort after a success result keeps the result', async () => {
  let built = null;
  const { build, frames } = newBuild(newDesign(), { deps: { runClaude: async (o) => {
    await mockRun(o);
    built.stop('user');
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  } } });
  built = build;
  assert.deepEqual(await build.run(), { status: 'stopped', reason: 'user' });
  assert.equal(framesOf(frames, 'design-plan').length, 1, 'the plan of the finished process is taken');
  assert.equal(listAgents(build.id)[0].status, 'done');
});

test('a throw in the drive ends error, engine-error; every end time is deps.now() as ISO', async () => {
  const at = Date.parse('2026-01-02T03:04:05.000Z');
  const { build, frames } = newBuild(newDesign(), { deps: { now: () => at, acquireGlobal: async () => { throw new Error('slot table gone'); } } });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'engine-error' });
  assert.equal(getBuild(build.id).endedAt, '2026-01-02T03:04:05.000Z');
  assert.equal(listAgents(build.id)[0].endedAt, '2026-01-02T03:04:05.000Z');
  assert.equal(listAgents(build.id)[0].status, 'stopped');
  assert.deepEqual([frames.at(-1).type, frames.at(-1).status, frames.at(-1).reason], ['design-build', 'error', 'engine-error']);
});

test('stop() aborts the running lead and the round ends stopped', async () => {
  const live = [];
  const d = newDesign();
  const { build, frames } = newBuild(d, { brief: 'MOCK_HANG_LEAD MOCK_PRICED', deps: { onLiveChange: () => live.push(build.runningCount) } });
  const p = build.run();
  await waitForFrame(frames, (f) => f.type === 'design-delta' && f.path === 'tokens.css');
  assert.equal(build.runningCount, 1);
  assert.deepEqual(await build.stop('user'), { status: 'stopped', reason: 'user' });
  assert.deepEqual(await p, { status: 'stopped', reason: 'user' });
  assert.equal(build.runningCount, 0);
  assert.deepEqual(live, [1, 0], 'onLiveChange sees each change of runningCount');
  assert.equal(listAgents(build.id)[0].status, 'stopped');
  assert.ok(getDesign(d.id).costUsd > 0, 'a process killed before its result books its priced usage');
  assert.equal(getBuild(build.id).costUsd, getDesign(d.id).costUsd);
  assert.deepEqual(await build.stop('user'), { status: 'stopped', reason: 'user' }, 'no effect once settled');
});

test('semaphore: FIFO, an aborted waiter leaves the queue, resize never touches a holder', async () => {
  // Every grant is read through a settled flag after a tick, never awaited, so a broken queue fails instead of hanging.
  const s = createSemaphore(1);
  const a = track(s.acquire());
  const bAbort = new AbortController();
  const b = track(s.acquire({ signal: bAbort.signal }));
  const c = track(s.acquire());
  const d = track(s.acquire());
  await tick();
  assert.deepEqual([a.state, b.state, c.state, d.state], ['ok', 'pending', 'pending', 'pending'], 'b, c and d wait while a holds');
  bAbort.abort();
  await tick();
  assert.equal(b.state, 'rejected');
  assert.equal(b.err?.name, 'AbortError');
  s.release();
  await tick();
  assert.deepEqual([c.state, d.state], ['ok', 'pending'], 'the release goes to c, the next in line, not to the aborted b');
  s.release();
  await tick();
  assert.equal(d.state, 'ok');
  const pre = track(s.acquire({ signal: AbortSignal.abort() }));
  await tick();
  assert.equal(pre.err?.name, 'AbortError', 'an aborted signal never queues');

  const up = createSemaphore(1);
  track(up.acquire());
  const w = track(up.acquire());
  await tick();
  assert.equal(w.state, 'pending');
  up.resize(3);
  await tick();
  assert.equal(w.state, 'ok', 'resize up wakes a waiter');
  const third = track(up.acquire());
  const fourth = track(up.acquire());
  await tick();
  assert.deepEqual([third.state, fourth.state], ['ok', 'pending'], 'three holders fill a size of 3');

  const down = createSemaphore(3);
  for (let i = 0; i < 3; i++) track(down.acquire());
  down.resize(1);
  const next = track(down.acquire());
  await tick();
  assert.equal(next.state, 'pending', 'resize down leaves the three holders, and the next acquire waits');
  down.release(); await tick();
  assert.equal(next.state, 'pending', 'two holders left: still at or above 1');
  down.release(); await tick();
  assert.equal(next.state, 'pending', 'one holder left: still at 1');
  down.release(); await tick();
  assert.equal(next.state, 'ok', 'no holder: the waiter gets the slot');
});

test('useDesignEnv deletes WORCA_DESIGN_MAX_BUILDERS and WORCA_DESIGN_MAX_AGENTS until after, then restores them', () => {
  // tools/test.mjs keeps the variables, and the pinned caps (12 fast, 3 off, 24 agents) read the defaults.
  const keys = ['WORCA_DESIGN_MAX_BUILDERS', 'WORCA_DESIGN_MAX_AGENTS'];
  const outer = keys.map((k) => process.env[k]);
  const hooks = [];
  process.env.WORCA_DESIGN_MAX_BUILDERS = '2';
  process.env.WORCA_DESIGN_MAX_AGENTS = '5';
  try {
    useDesignEnv((fn) => hooks.push(fn));
    assert.deepEqual(keys.map((k) => process.env[k]), [undefined, undefined]);
    assert.deepEqual(designCaps(), { fast: 12, calm: 3, global: 24 });
  } finally {
    for (const fn of hooks) fn();
  }
  assert.deepEqual(keys.map((k) => process.env[k]), ['2', '5'], 'restored in after');
  keys.forEach((k, i) => { if (outer[i] === undefined) delete process.env[k]; else process.env[k] = outer[i]; });
});
