// test/design-build-stop.test.mjs — Design P2 Task 12: stop all, stop one, the drain pause and the kill booking.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { framesOf, newBuild, newDesign, useDesignEnv, waitForFrame, waitUntil } from './helpers/design-fixture.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { prepare } from '../src/core/db.mjs';
import { distDir } from '../src/core/design/paths.mjs';
import { DesignBuild } from '../src/core/design/build.mjs';
import { getBuild, listAgents } from '../src/core/design/store.mjs';

useDesignEnv(after);
const hung = (brief, deps) => newBuild(newDesign(), { brief, deps });
const ledger = (b) => prepare('SELECT agent_id, amount_usd FROM design_cost_ledger WHERE build_id = ?').all(b);

const mockRun = (o) => runClaude({ ...o, mock: true });
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
/** A process that runs until its signal aborts, then rejects as the runner does. A ref'd 10 s bound rejects `hung`,
 *  so a missing abort fails the row instead of draining the event loop. */
function hangUntilAbort(o) {
  return new Promise((resolve, reject) => {
    const bound = setTimeout(() => reject(new Error('hung')), 10_000);
    const onAbort = () => { clearTimeout(bound); reject(abortError()); };
    if (o.signal.aborted) onAbort();
    else o.signal.addEventListener('abort', onAbort, { once: true });
  });
}
const agentOf = (build, sectionId) => listAgents(build.id).find((a) => a.sectionId === sectionId);
/** `p`'s value, or a rejection `hung` after `ms` (ref'd): a park that never resolves fails its row in seconds instead
 *  of hanging the file to its 300 s timeout. */
function within(p, ms = 5000) {
  return new Promise((resolve, reject) => {
    const bound = setTimeout(() => reject(new Error('hung')), ms);
    p.then((v) => { clearTimeout(bound); resolve(v); }, (e) => { clearTimeout(bound); reject(e); });
  });
}

test('a builder killed mid-Write leaves no half draft', async () => {
  const { build, frames } = hung('MOCK_SECTIONS=1 MOCK_HANG_SECTION=hero');
  const p = build.run();
  await waitForFrame(frames, (f) => f.type === 'design-delta' && f.sectionId === 'hero');
  await build.stop('user'); await p;
  const last = framesOf(frames, 'design-file').filter((f) => f.path === 'sections/hero/index.html').at(-1);
  assert.deepEqual([last.bytes, last.text], [0, '']);
  assert.equal(framesOf(frames, 'design-section').at(-1).status, 'stopped');
  assert.equal(framesOf(frames, 'design-agent').at(-1).status, 'stopped');
  assert.deepEqual([getBuild(build.id).status, getBuild(build.id).reason], ['stopped', 'user']);
});
test('killed before result books its priced usage once', async () => {
  let built = null; let atExit = null;
  // The last live change is hero's exit, after its kill booking and before the settle writes the row again.
  const { build, frames } = hung('MOCK_SECTIONS=1 MOCK_HANG_SECTION=hero MOCK_PRICED', {
    onLiveChange: () => { if (built.runningCount === 0) atExit = getBuild(built.id).costUsd; },
  });
  built = build;
  const p = build.run();
  await waitForFrame(frames, (f) => f.type === 'design-delta' && f.sectionId === 'hero');
  await build.stop('user'); await p;
  const a = listAgents(build.id).find((x) => x.sectionId === 'hero');
  const hero = ledger(build.id).filter((r) => r.agent_id === a.id);
  assert.equal(hero.length, 1);
  assert.ok(Math.abs(hero[0].amount_usd - 0.007) < 1e-9);
  assert.ok(Math.abs(a.costUsd - 0.007) < 1e-9);
  const total = ledger(build.id).reduce((s, r) => s + r.amount_usd, 0);
  assert.ok(total >= 0.007 && Math.abs(atExit - total) < 1e-9, `the build row has the kill booking before the settle (${atExit} of ${total})`);
});
test('stop is idempotent and stops the queue', async () => {
  const { build, frames, calls } = hung('MOCK_SECTIONS=4 MOCK_HANG_SECTION=hero', { maxBuildersFor: () => 1 });
  const p = build.run();
  await waitForFrame(frames, (f) => f.type === 'design-delta' && f.sectionId === 'hero');
  await Promise.all([build.stop('user'), build.stop('user')]); await p;
  assert.equal(calls.filter((c) => c.cwd.includes('sections')).length, 1);
  assert.deepEqual(getBuild(build.id).sections.map((s) => s.status), ['stopped', 'planned', 'planned', 'planned']);
  assert.deepEqual(await build.stop('user'), { status: 'stopped', reason: 'user' });
});
test('stop one: that section stops, the rest finish, the round ends partial with no pause', async () => {
  const { build, frames } = hung('MOCK_SECTIONS=3 MOCK_HANG_SECTION=features');
  const p = build.run();
  await waitForFrame(frames, (f) => f.type === 'design-delta' && f.sectionId === 'features');
  const id = framesOf(frames, 'design-agent').find((f) => f.sectionId === 'features').agentId;
  assert.equal(build.stopAgent(id), true);
  assert.deepEqual(await p, { status: 'done', reason: 'partial' });
  assert.deepEqual(getBuild(build.id).sections.map((x) => x.status), ['done', 'stopped', 'done']);
});
test('stop one: an unknown id is false; a finished agent is true with no effect', async () => {
  const { build, frames } = hung('MOCK_SECTIONS=1');
  await build.run();
  assert.equal(build.stopAgent('a_00000000'), false);
  assert.equal(build.stopAgent(framesOf(frames, 'design-agent').at(-1).agentId), true);
  assert.equal(getBuild(build.id).status, 'done');
});
test('stopping the lead while it plans stops the build; while it integrates only skips integration', async () => {
  const a = hung('MOCK_HANG_LEAD');
  const pa = a.build.run();
  await waitForFrame(a.frames, (f) => f.type === 'design-agent' && f.status !== 'starting');
  a.build.stopAgent(framesOf(a.frames, 'design-agent')[0].agentId);
  assert.deepEqual(await pa, { status: 'stopped', reason: 'user' });
  // integrate case: deps.runClaude hangs on maxTurns 40 until aborted; stopAgent(lead) -> result { status:'done', reason:null }, dist exists
  const d = newDesign(); let leadAtSnapshot = null; let bid = null;
  const b = newBuild(d, { brief: 'MOCK_SECTIONS=2', deps: {
    runClaude: (o) => (o.maxTurns === 40 ? hangUntilAbort(o) : mockRun(o)),
    snapshotVersion: async () => { leadAtSnapshot = listAgents(bid).find((x) => x.role === 'lead').status; },
  } });
  bid = b.build.id;
  const pb = b.build.run();
  await waitUntil(() => b.build.status === 'integrating' && b.build.runningCount === 1);
  const lead = listAgents(b.build.id).find((x) => x.role === 'lead');
  assert.equal(b.build.stopAgent(lead.id), true);
  assert.deepEqual(await pb, { status: 'done', reason: null });
  assert.ok(existsSync(join(distDir(d.id), 'index.html')));
  assert.equal(b.calls.filter((c) => c.maxTurns === 40).length, 1, 'no second integrate');
  assert.equal(listAgents(b.build.id).find((x) => x.role === 'lead').status, 'stopped');
  assert.equal(leadAtSnapshot, 'stopped', 'the lead ends when stopped, before the finish runs');
  assert.deepEqual(getBuild(b.build.id).sections.map((s) => s.status), ['done', 'done']);
  const end = framesOf(b.frames, 'design-agent').filter((f) => f.agentId === lead.id).map((f) => f.status);
  assert.equal(end.at(-1), 'stopped');
});
test('pauseForDrain: true while live, paused with reason drain, false once settled', async () => {
  const { build, frames } = hung('MOCK_SECTIONS=2 MOCK_HANG_SECTION=hero');
  const p = build.run();
  await waitForFrame(frames, (f) => f.type === 'design-delta' && f.sectionId === 'hero');
  assert.equal(build.pauseForDrain(), true);
  assert.deepEqual(await p, { status: 'paused', reason: 'drain' });
  assert.equal(build.pauseForDrain(), false);
});
test('runningCount goes back to 0 and onLiveChange saw it', async () => {
  const seen = []; let built = null;
  const { build, frames } = hung('MOCK_SECTIONS=2 MOCK_HANG_SECTION=hero', { onLiveChange: () => seen.push(built.runningCount) });
  built = build;
  const p = build.run();
  await waitForFrame(frames, (f) => f.type === 'design-delta' && f.sectionId === 'hero');
  assert.ok(build.runningCount > 0);
  await build.stop('user'); await p;
  assert.equal(build.runningCount, 0);
  assert.equal(seen.at(-1), 0, 'the last change onLiveChange saw is back to 0');
  assert.ok(Math.max(...seen) > 0, 'and it saw a running process');
});

test('the drain pause records its end state once: a second call changes nothing; a later stop closes it (L2.34)', async () => {
  const { build, frames } = hung('MOCK_SECTIONS=2 MOCK_HANG_SECTION=hero');
  const p = build.run();
  await waitForFrame(frames, (f) => f.type === 'design-delta' && f.sectionId === 'hero');
  assert.equal(build.pauseForDrain(), true);
  assert.equal(build.pauseForDrain(), false, 'a build already pausing keeps its own reason, as a run does');
  void build.stop('user');
  assert.deepEqual(await p, { status: 'paused', reason: 'drain' });
  const row = getBuild(build.id);
  assert.deepEqual([row.status, row.reason], ['paused', 'drain']);
  assert.ok(Number.isFinite(Date.parse(row.endedAt)), 'a paused round has its endedAt, though paused is open');
  assert.equal(framesOf(frames, 'design-build').at(-1).status, 'paused');
  const s = build.stop('user');
  assert.deepEqual(await s, { status: 'stopped', reason: 'user' }, 'stop on a settled paused build closes it');
  const shut = getBuild(build.id);
  assert.deepEqual([shut.status, shut.reason], ['stopped', 'user']);
  assert.ok(Number.isFinite(Date.parse(shut.endedAt)));
  assert.equal(framesOf(frames, 'design-build').at(-1).status, 'stopped', 'and sends its terminal frame');
  const sent = frames.length;
  assert.deepEqual(await build.stop('user'), { status: 'stopped', reason: 'user' }, 'a second stop has no effect');
  assert.equal(frames.length, sent);
  const stopped = hung('MOCK_SECTIONS=2 MOCK_HANG_SECTION=hero');
  const ps = stopped.build.run();
  await waitForFrame(stopped.frames, (f) => f.type === 'design-delta' && f.sectionId === 'hero');
  void stopped.build.stop('user');
  assert.equal(stopped.build.pauseForDrain(), false, 'a build already stopping is not paused');
  assert.deepEqual(await ps, { status: 'stopped', reason: 'user' });
  const done = hung('MOCK_SECTIONS=1');
  assert.deepEqual(await done.build.run(), { status: 'done', reason: null });
  assert.equal(done.build.pauseForDrain(), false, 'a finished build is not paused');
  assert.equal(getBuild(done.build.id).status, 'done');
  const quiet = done.frames.length;
  assert.deepEqual(await done.build.stop('user'), { status: 'done', reason: null }, 'stop on a terminal build has no effect');
  assert.deepEqual([getBuild(done.build.id).status, getBuild(done.build.id).reason, done.frames.length], ['done', null, quiet]);
});

test('M7: a halt that lands after the last check before a spawn, at any microtask of the gap, starts no process', async () => {
  // The halt is raised k microtasks after the limits are asked: early ones land before the slot's last check, late ones
  // while the process runs, and the ones between land while the caller resumes from the slot. The first spawn is the
  // lead's loop taking its slot; the second a builder's first build, which takes it before its agent row exists.
  const microtasks = (k) => { let p = Promise.resolve(); for (let i = 0; i < k; i += 1) p = p.then(() => {}); return p; };
  for (const nth of [1, 2]) {
    for (let k = 0; k <= 12; k += 1) {
      let asked = 0;
      let halted = false;
      const late = [];
      const { build } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: {
        teamTotalGate: async () => {
          if (++asked === nth) void microtasks(k).then(() => { halted = true; build.pauseForDrain(); });
          return { blocked: false };
        },
        runClaude: (o) => { if (halted) late.push(o.cwd.split(sep).at(-1)); return mockRun(o); },
      } });
      const end = await within(build.run());
      assert.deepEqual(late, [], `spawn ${nth}, halt after ${k} microtasks: no process starts once halted`);
      assert.deepEqual(end, { status: 'paused', reason: 'drain' }, `spawn ${nth}, ${k}`);
      const builders = listAgents(build.id).filter((a) => a.role === 'builder');
      if (nth === 2 && !builders.some((a) => a.sessionId)) assert.equal(builders.length, 0, `${k}: no row for a builder that never started`);
    }
  }
});

test('M6: an end state the store cannot write still closes the row, in the drive and in a Stop of a paused build', async () => {
  const error = console.error;
  console.error = () => {};
  try {
    // The drive: the clock breaks as the round finishes, so its _settle throws, and so does the engine-error one.
    let broken = false;
    const now = () => { if (broken) throw new Error('clock gone'); return Date.now(); };
    const a = hung('MOCK_SECTIONS=1', { now, snapshotVersion: async () => { broken = true; } });
    assert.deepEqual(await within(a.build.run()), { status: 'error', reason: 'engine-error' });
    broken = false; // the frame throttle's timers read the clock later
    assert.deepEqual([getBuild(a.build.id).status, getBuild(a.build.id).reason], ['error', 'engine-error'], 'the row is closed too');
    // A Stop of a settled paused build: its close throws, never out of stop(), and the row is closed anyway.
    const b = hung('MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero');
    const p = b.build.run();
    await waitForFrame(b.frames, (f) => f.type === 'design-question');
    b.build.pauseForDrain();
    assert.deepEqual(await within(p), { status: 'paused', reason: 'drain' });
    broken = true;
    const r = DesignBuild.rehydrate({ buildId: b.build.id, deps: { now } });
    let s;
    assert.doesNotThrow(() => { s = r.stop('user'); });
    assert.deepEqual(await s, { status: 'error', reason: 'engine-error' });
    broken = false;
    const row = getBuild(b.build.id);
    assert.deepEqual([row.status, row.reason], ['error', 'engine-error'], 'no longer paused: Delete and Start work');
    assert.equal(agentOf(b.build, 'hero').status, 'stopped', 'its waiting agent ended with it');
  } finally {
    console.error = error;
  }
});

test('stop one ends a wait for the machine slot', async () => {
  let block = false; let blocked = false;
  const { build, calls } = hung('MOCK_SECTIONS=1 MOCK_RATE_LIMIT_SECTION=hero', { retryDelayMs: 1000, acquireGlobal: ({ signal }) => {
    if (!block) return Promise.resolve();
    blocked = true;
    return new Promise((resolve, reject) => {
      const bound = setTimeout(() => reject(new Error('hung')), 10_000);
      signal.addEventListener('abort', () => { clearTimeout(bound); reject(abortError()); }, { once: true });
    });
  } });
  const p = build.run();
  await waitUntil(() => agentOf(build, 'hero')?.status === 'retrying');
  block = true;
  await waitUntil(() => blocked);
  assert.equal(build.stopAgent(agentOf(build, 'hero').id), true);
  block = false;
  assert.deepEqual(await p, { status: 'done', reason: 'partial' });
  assert.equal(calls.filter((c) => c.cwd.endsWith(`${sep}hero`)).length, 1);
  assert.equal(agentOf(build, 'hero').status, 'stopped');
});

test('a booking writes the agent row\'s cost with its ledger row and sends fresh figures, before the process ends', async () => {
  let built = null; let atResult = null; let buildAtResult = null; let sessionAtResult = null; let framed = null;
  const near = (v, want) => Math.abs(v - want) < 1e-9;
  const { build, frames } = hung('MOCK_SECTIONS=1', { runClaude: async (o) => {
    if (!o.cwd.endsWith(`${sep}hero`)) return mockRun(o);
    writeFileSync(join(o.cwd, 'index.html'), '<section data-section="hero"><h2>Hero</h2></section>\n');
    o.onEvent({ type: 'result', subtype: 'success', costUsd: 0.01, cumulativeCost: true, parentId: null });
    atResult = agentOf(built, 'hero').costUsd;
    sessionAtResult = agentOf(built, 'hero').tokens?.sessionUsd;
    buildAtResult = getBuild(built.id).costUsd;
    // Past the 2 Hz window, so a throttled frame has gone out; the process has not ended yet.
    await new Promise((r) => setTimeout(r, 600));
    framed = {
      agent: framesOf(frames, 'design-agent').some((f) => f.sectionId === 'hero' && f.status !== 'done' && near(f.costUsd, 0.01)),
      build: framesOf(frames, 'design-build').some((f) => near(f.stats.costUsd, 0.01)),
    };
  } });
  built = build;
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.ok(near(atResult, 0.01), `the row has the booked cost at once (${atResult})`);
  assert.ok(near(buildAtResult, 0.01), `so does the build row, which a rehydrate after a host kill seeds from (${buildAtResult})`);
  assert.ok(near(sessionAtResult, 0.01), `and the session's running total beside it, which seeds the meter (M3: ${sessionAtResult})`);
  assert.deepEqual(framed, { agent: true, build: true }, 'the booking sent the agent and the build figures');
  const hero = ledger(build.id).filter((r) => r.agent_id === agentOf(build, 'hero').id);
  assert.equal(hero.length, 1, 'a result that was seen is never booked again at the exit');
  assert.ok(Math.abs(hero[0].amount_usd - 0.01) < 1e-9);
});

test('a process that sent its result books nothing at the exit, even with priced usage still open', async () => {
  let built = null; let openUsd = null;
  const { build } = hung('MOCK_SECTIONS=1', { runClaude: async (o) => {
    if (!o.cwd.endsWith(`${sep}hero`)) return mockRun(o);
    writeFileSync(join(o.cwd, 'index.html'), '<section data-section="hero"><h2>Hero</h2></section>\n');
    o.onEvent({ type: 'session', sessionId: 'sess-hero', model: 'claude-sonnet-5-5', init: true });
    o.onEvent({ type: 'result', subtype: 'success', costUsd: 0.01, cumulativeCost: true, parentId: null });
    // A main-thread message opened after the result: priced usage the meter still holds at the exit.
    o.onEvent({ type: 'usage', messageId: 'late', parentId: null, phase: 'start', usage: { input_tokens: 1000, output_tokens: 500 } });
    openUsd = built._agents.find((a) => a.sectionId === 'hero').meter.snapshot().estimatedUsd;
  } });
  built = build;
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.ok(openUsd > 0, `the late usage is priced and open at the exit (${openUsd})`);
  const hero = ledger(build.id).filter((r) => r.agent_id === agentOf(build, 'hero').id);
  assert.equal(hero.length, 1, 'only the result is booked');
  assert.ok(Math.abs(hero[0].amount_usd - 0.01) < 1e-9);
});

test('stop one reaches an agent with no process: a builder in its retry wait ends at once and spawns nothing more', async () => {
  const { build, calls } = hung('MOCK_SECTIONS=2 MOCK_RATE_LIMIT_SECTION=hero', { retryDelayMs: 60_000 });
  const p = build.run();
  await waitUntil(() => agentOf(build, 'hero')?.status === 'retrying' && agentOf(build, 'features')?.status === 'done');
  assert.equal(build.runningCount, 0, 'hero has no process while it waits to retry');
  let settled = false; void p.then(() => { settled = true; });
  assert.equal(build.stopAgent(agentOf(build, 'hero').id), true);
  await waitUntil(() => settled);
  assert.deepEqual(await p, { status: 'done', reason: 'partial' }, 'the retry wait ended at once, not after its delay');
  assert.equal(calls.filter((c) => c.cwd.endsWith(`${sep}hero`)).length, 1, 'no resume after the stop');
  assert.deepEqual(getBuild(build.id).sections.map((s) => s.status), ['stopped', 'done']);
  assert.equal(agentOf(build, 'hero').status, 'stopped');
});

test('a stopped section is stopped at once: the integrate pass and .crew.json already see it', async () => {
  let seen = null; let built = null;
  const { build, frames } = hung('MOCK_SECTIONS=2 MOCK_HANG_SECTION=hero', { runClaude: (o) => {
    if (o.maxTurns === 40) seen = getBuild(built.id).sections.map((s) => s.status);
    return mockRun(o);
  } });
  built = build;
  const p = build.run();
  await waitForFrame(frames, (f) => f.type === 'design-delta' && f.sectionId === 'hero');
  const lead = listAgents(build.id).find((x) => x.role === 'lead');
  assert.equal(build.stopAgent(lead.id), true, 'the lead finished its plan: true with no effect');
  build.stopAgent(agentOf(build, 'hero').id);
  assert.deepEqual(await p, { status: 'done', reason: 'partial' });
  assert.deepEqual(seen, ['stopped', 'done']);
  assert.equal(listAgents(build.id).find((x) => x.role === 'lead').status, 'done', 'the integrate pass ran and finished');
  const hero = framesOf(frames, 'design-agent').filter((f) => f.sectionId === 'hero');
  const stoppedAt = frames.indexOf(hero.find((f) => f.status === 'stopped'));
  const integrating = frames.findIndex((f) => f.type === 'design-build' && f.status === 'integrating');
  assert.ok(stoppedAt >= 0 && stoppedAt < integrating, 'the stopped cursor goes before the integrate pass, not at the end');
  assert.equal(build.stopAgent(agentOf(build, 'hero').id), true, 'stopping it again is true with no effect');
});

test('L2.31: an abort that lands after an error result keeps the result\'s outcome', async () => {
  let built = null;
  const { build } = hung('MOCK_SECTIONS=1', { runClaude: async (o) => {
    if (!o.cwd.endsWith(`${sep}hero`)) return mockRun(o);
    writeFileSync(join(o.cwd, 'index.html'), '<section data-section="hero"><h2>Hero</h2></section>\n');
    o.onEvent({ type: 'result', subtype: 'error_max_turns', parentId: null });
    built.stopAgent(agentOf(built, 'hero').id);
    throw abortError();
  } });
  built = build;
  assert.deepEqual(await build.run(), { status: 'done', reason: null }, 'judged by its output, like the same result with no abort');
  assert.deepEqual(getBuild(build.id).sections.map((s) => s.status), ['done']);
  assert.equal(agentOf(build, 'hero').status, 'done');
});

test('a waiter parked on an agent wakes with null at a halt or a stop; a paused settle keeps a waiting agent waiting', async () => {
  // The seam the question pass waits on: `_park` parks, `_wake` resolves it, a halt or a stop resolves it with null.
  const parkOn = ({ onParked, stopFirst = false } = {}) => {
    const parked = []; let built = null;
    const box = hung('MOCK_SECTIONS=2', { runClaude: async (o) => {
      if (!o.cwd.endsWith(`${sep}hero`)) return mockRun(o);
      const agent = built._agents.find((x) => x.sectionId === 'hero');
      if (stopFirst) built.stopAgent(agent.id);
      built._setAgentStatus(agent, 'waiting');
      const wait = built._park(agent);
      onParked?.(agent);
      const v = await within(wait);
      parked.push(v);
      if (v === null) throw abortError();
      return mockRun(o);
    } });
    built = box.build;
    return { ...box, parked };
  };
  // features finishes first, so each case acts on the waiting hero alone.
  const waiting = (b) => waitUntil(() => agentOf(b, 'hero')?.status === 'waiting' && agentOf(b, 'features')?.status === 'done');

  const drain = parkOn();
  const pd = drain.build.run();
  await waiting(drain.build);
  assert.equal(drain.build.pauseForDrain(), true);
  assert.deepEqual(await pd, { status: 'paused', reason: 'drain' });
  assert.deepEqual(drain.parked, [null]);
  assert.equal(agentOf(drain.build, 'hero').status, 'waiting', 'L2.29: the row stays waiting');
  assert.equal(agentOf(drain.build, 'hero').endedAt, null);
  assert.deepEqual(getBuild(drain.build.id).sections.map((s) => s.status), ['writing', 'done'], 'and its section writing');
  assert.equal(framesOf(drain.frames, 'design-agent').filter((f) => f.sectionId === 'hero').at(-1).status, 'waiting');
  assert.equal(framesOf(drain.frames, 'design-section').filter((f) => f.sectionId === 'hero').at(-1).status, 'writing');
  assert.equal(framesOf(drain.frames, 'design-build').at(-1).waiting, 1);
  assert.equal(drain.build.stopAgent(agentOf(drain.build, 'hero').id), true, 'a settled build: true with no effect');
  assert.equal(agentOf(drain.build, 'hero').status, 'waiting');
  const kept = drain.build._agents.find((x) => x.sectionId === 'hero');
  assert.deepEqual([kept.stopKind, kept.stopCtl.signal.aborted], [null, false], 'unmarked, so a later park still waits');
  assert.deepEqual(await drain.build.stop('user'), { status: 'stopped', reason: 'user' }, 'L2.34: Stop closes the paused build');
  assert.equal(agentOf(drain.build, 'hero').status, 'stopped', 'and its waiting agent ends with it');
  assert.ok(Number.isFinite(Date.parse(agentOf(drain.build, 'hero').endedAt)));
  assert.deepEqual(getBuild(drain.build.id).sections.map((s) => s.status), ['stopped', 'done']);
  assert.equal(framesOf(drain.frames, 'design-agent').filter((f) => f.sectionId === 'hero').at(-1).status, 'stopped');
  assert.equal(framesOf(drain.frames, 'design-section').filter((f) => f.sectionId === 'hero').at(-1).status, 'stopped');
  const closed = framesOf(drain.frames, 'design-build').at(-1);
  assert.deepEqual([closed.status, closed.reason, closed.waiting], ['stopped', 'user', 0]);

  const stop = parkOn();
  const ps = stop.build.run();
  await waiting(stop.build);
  await stop.build.stop('user'); await ps;
  assert.deepEqual(stop.parked, [null]);
  assert.equal(agentOf(stop.build, 'hero').status, 'stopped', 'every other settle stops a waiting agent');
  assert.deepEqual(getBuild(stop.build.id).sections.map((s) => s.status), ['stopped', 'done']);
  const late = stop.build._agents.find((x) => x.sectionId === 'hero');
  assert.equal(await within(stop.build._park(late), 1000), null, 'a park after a halt resolves null at once');

  const one = parkOn();
  const po = one.build.run();
  await waiting(one.build);
  assert.equal(one.build.stopAgent(agentOf(one.build, 'hero').id), true);
  assert.deepEqual(await po, { status: 'done', reason: 'partial' });
  assert.deepEqual(one.parked, [null], 'stop one wakes its waiter with null');
  assert.equal(agentOf(one.build, 'hero').status, 'stopped');

  const first = parkOn({ stopFirst: true });
  assert.deepEqual(await first.build.run(), { status: 'done', reason: 'partial' });
  assert.deepEqual(first.parked, [null], 'a park after stop one resolves null at once');
  assert.equal(agentOf(first.build, 'hero').status, 'stopped');

  let parkedAgent = null;
  const answered = parkOn({ onParked: (agent) => { parkedAgent = agent; } });
  const pa = answered.build.run();
  await waiting(answered.build);
  assert.equal(answered.build._wake(parkedAgent, { q1: 'a' }), true);
  assert.equal(answered.build._wake(parkedAgent, { q1: 'b' }), false, 'a waiter wakes once');
  assert.deepEqual(await pa, { status: 'done', reason: null });
  assert.deepEqual(answered.parked, [{ q1: 'a' }]);
});

test('a park resolves null at once for an agent marked stopped or whose stop signal fired, with no halt', async () => {
  const { build } = hung('MOCK_SECTIONS=2');
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  const [lead, hero, features] = build._agents;
  const control = build._park(lead);
  assert.equal(build._wake(lead, 7), true, 'the build is not halted: a plain agent parks');
  assert.equal(await control, 7);
  hero.stopKind = 'stopped';
  assert.equal(await within(build._park(hero), 1000), null, 'stopKind alone');
  assert.equal(hero.waiter, null);
  features.stopCtl.abort();
  assert.equal(await within(build._park(features), 1000), null, 'the stop signal alone');
  assert.equal(features.waiter, null);
});

test('stop one aborts only that agent\'s process', async () => {
  const signals = new Map();
  const { build } = hung('MOCK_SECTIONS=2', { runClaude: (o) => {
    if (!o.cwd.includes(`${sep}sections${sep}`)) return mockRun(o);
    signals.set(o.cwd.split(sep).at(-1), o.signal);
    return hangUntilAbort(o);
  } });
  const p = build.run();
  await waitUntil(() => build.runningCount === 2 && signals.size === 2);
  assert.equal(build.stopAgent(agentOf(build, 'hero').id), true);
  await waitUntil(() => agentOf(build, 'hero').status === 'stopped');
  assert.deepEqual([signals.get('hero').aborted, signals.get('features').aborted], [true, false]);
  assert.equal(build.runningCount, 1);
  assert.equal(agentOf(build, 'features').status !== 'stopped', true, 'features still runs');
  assert.deepEqual(await build.stop('user'), { status: 'stopped', reason: 'user' });
  assert.deepEqual(await p, { status: 'stopped', reason: 'user' });
  assert.deepEqual(getBuild(build.id).sections.map((s) => s.status), ['stopped', 'stopped']);
});
