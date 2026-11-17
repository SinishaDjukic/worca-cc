// test/design-budget.test.mjs — Design P2 Task 14: a round pauses at worca's spend limits (M13: Design has none of its
// own), the per-process spend flag, and bridged models booked from their upstream's figure.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { framesOf, newBuild, newDesign, useDesignEnv, waitForFrame } from './helpers/design-fixture.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { prepare } from '../src/core/db.mjs';
import { bridgeCostFor, recordBridgeCost } from '../src/core/bridge/telemetry.mjs';
import { addProject } from '../src/core/projects.mjs';
import { getBuild, listAgents } from '../src/core/design/store.mjs';

const home = useDesignEnv(after);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ? `${msg}: ` : ''}${a} vs ${b}`);
/** `p`'s value, or a rejection `hung` after `ms` (ref'd): a build nothing halts fails its row in seconds instead of
 *  hanging the file to its 300 s timeout. */
function within(p, ms = 10_000) {
  return new Promise((resolve, reject) => {
    const bound = setTimeout(() => reject(new Error('hung')), ms);
    p.then((v) => { clearTimeout(bound); resolve(v); }, (e) => { clearTimeout(bound); reject(e); });
  });
}
const cwdNames = (calls) => calls.map((c) => c.cwd.split(sep).at(-1));
const sectionStatuses = (build) => getBuild(build.id).sections.map((s) => s.status);

test('the per-run cap set in Settings stops the crew: paused, total-limit, per-process flags are what remains', async () => {
  const readCaps = async () => ({ perRunCapUsd: 0.5, totalCapUsd: null });
  const { build, calls, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_COST=0.3', deps: { maxBuildersFor: () => 1, readCaps } });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'total-limit' });
  near(calls[0].maxBudgetUsd, 0.5);
  near(calls[1].maxBudgetUsd, 0.2);
  assert.equal(calls.length, 2, 'the second builder never starts');
  const end = framesOf(frames, 'design-build').at(-1);
  assert.equal(end.reason, 'total-limit');
  near(end.stats.costUsd, 0.6);
  assert.equal(end.status, 'paused');
  assert.deepEqual(sectionStatuses(build), ['done', 'planned'], 'the builder whose own result crossed the cap keeps its outcome (L2.31)');
  assert.equal(listAgents(build.id).find((a) => a.sectionId === 'hero').status, 'done');
});

test('M13: with no worca limit set, nothing stops the round and no flag is passed; a per-run cap is the flag', async () => {
  const a = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_COST=40' });
  assert.deepEqual(await a.build.run(), { status: 'done', reason: null }, 'Design has no limit of its own');
  assert.ok(a.calls.every((c) => c.maxBudgetUsd == null));
  const b = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { readCaps: async () => ({ perRunCapUsd: 12, totalCapUsd: null }) } });
  await b.build.run();
  near(b.calls[0].maxBudgetUsd, 12);
});

test("a resumed session's flag adds back that session's own total (L2.2)", async () => {
  const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_COST=0.3', deps: { readCaps: async () => ({ perRunCapUsd: 5, totalCapUsd: null }) } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.deepEqual(cwdNames(calls), ['work', 'hero', 'work']);
  near(calls[0].maxBudgetUsd, 5);
  near(calls[1].maxBudgetUsd, 4.7, 'the builder: what remains of the cap');
  assert.ok(calls[2].resumeSessionId, 'the integrate pass resumes the lead');
  near(calls[2].maxBudgetUsd, 4.7, 'the integrate pass: 5 - 0.6 spent + the 0.3 its own session already counts');
});

test('a live estimate at the per-run cap aborts running agents, before any result', async () => {
  const { build } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_HANG_SECTION=hero MOCK_PRICED', deps: { readCaps: async () => ({ perRunCapUsd: 0.005, totalCapUsd: null }) } });
  const end = await within(build.run()).catch(async (err) => { await build.stop(); throw err; });
  assert.deepEqual(end, { status: 'paused', reason: 'total-limit' }, 'priced 0.007 passes 0.005 with nobody stopping it');
  assert.equal(listAgents(build.id).find((a) => a.sectionId === 'hero')?.status, 'stopped', 'the hero tripped it, not the priced lead (peak about $0.0026, and its $0 result retires it)');
});

test('the total limit is checked before every spawn', async () => {
  let blocked = false;
  let asked = 0;
  const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2', deps: { maxBuildersFor: () => 1, budgetStatus: () => { asked += 1; const b = blocked; blocked = true; return { blocked: b }; } } });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'total-limit' });
  assert.equal(calls.length, 1);
  assert.equal(asked, 2, 'asked once per spawn, and nowhere else');
});

test('a team total cap is asked before every spawn, integrate included; a refused spawn leaves no row; a warn cap passes', async () => {
  for (const [at, want, rows] of [[3, ['work', 'hero'], 2], [4, ['work', 'hero', 'features'], 3]]) {
    let n = 0;
    const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2', deps: { maxBuildersFor: () => 1, teamTotalGate: async () => ({ blocked: ++n >= at }) } });
    assert.deepEqual(await build.run(), { status: 'paused', reason: 'total-limit' });
    assert.deepEqual([calls.map((c) => c.cwd.split(sep).at(-1)), listAgents(build.id).length], [want, rows], `refused at spawn ${at}`);
  }
  const warn = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { teamTotalGate: async () => ({ blocked: false, warned: true }) } });
  assert.equal((await warn.build.run()).status, 'done');
});

test('the limits are asked with the global slot held, and a refused spawn gives the slot back', async () => {
  let held = 0;
  let acquired = 0;
  let released = 0;
  const seen = [];
  const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: {
    acquireGlobal: async () => { held += 1; acquired += 1; },
    releaseGlobal: () => { held -= 1; released += 1; },
    budgetStatus: () => { seen.push(['total', held]); return { blocked: false }; },
    teamTotalGate: async () => { seen.push(['team', held]); return { blocked: seen.length >= 4 }; },
  } });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'total-limit' });
  assert.deepEqual(seen, [['total', 1], ['team', 1], ['total', 1], ['team', 1]]);
  assert.equal(calls.length, 1, 'the lead ran, the hero was refused');
  assert.deepEqual([acquired, released, held], [2, 2, 0]);
});

test('a halt that lands while the limits are asked spawns nothing; a limit check that throws gives the slot back', async () => {
  let n = 0;
  const halted = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { teamTotalGate: async () => {
    if (++n === 2) void halted.build.stop('user');
    return { blocked: false };
  } } });
  assert.deepEqual(await halted.build.run(), { status: 'stopped', reason: 'user' });
  assert.deepEqual(cwdNames(halted.calls), ['work'], 'the hero was asked, then the stop landed: it never spawns');
  assert.equal(listAgents(halted.build.id).length, 1, 'and it has no row');

  let acquired = 0;
  let released = 0;
  let m = 0;
  const broken = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: {
    acquireGlobal: async () => { acquired += 1; },
    releaseGlobal: () => { released += 1; },
    teamTotalGate: async () => { if (++m === 2) throw new Error('policy store gone'); return { blocked: false }; },
  } });
  assert.deepEqual(await broken.build.run(), { status: 'error', reason: 'engine-error' });
  assert.equal(broken.calls.length, 1);
  assert.deepEqual([acquired, released], [2, 2]);
});

test("a per-run cap the round's spend already reached refuses the very first spawn; the lead's row is there", async () => {
  const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { readCaps: async () => ({ perRunCapUsd: 0.5, totalCapUsd: null }) } });
  build._costUsd = 0.6; // what a rehydrated round's row seeds (the constructor's `row.costUsd`), with no booking since
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'total-limit' });
  assert.equal(calls.length, 0);
  assert.deepEqual(listAgents(build.id).map((a) => [a.role, a.status]), [['lead', 'stopped']]);
});

test("the team gate is asked for the design's project with the discovery worca's caps use, never the gate's default", async (t) => {
  const record = (log) => async (target, opts) => { log.push([target, opts]); return { blocked: false }; };
  const none = [];
  const caps = [];
  const a = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { teamTotalGate: record(none), readCaps: async (q) => { caps.push(q); return { perRunCapUsd: null, totalCapUsd: null }; } } });
  await a.build.run();
  assert.equal(none.length, 3);
  for (const args of none) assert.deepEqual(args, [{ projectDir: null }, { discover: false }]);
  assert.deepEqual(caps, [{ projectDir: null }], 'the caps are read once per drive');

  const dir = join(home, 'design-budget-project');
  mkdirSync(dir, { recursive: true });
  const project = (await addProject({ name: 'design-budget', path: dir })).find((p) => p.name === 'design-budget');
  const prevGit = process.env.WORCA_GIT;
  process.env.WORCA_GIT = '1';
  t.after(() => { if (prevGit === undefined) delete process.env.WORCA_GIT; else process.env.WORCA_GIT = prevGit; });
  const withGit = [];
  await newBuild(newDesign({ projectKey: project.key }), { brief: 'MOCK_SECTIONS=1', deps: { teamTotalGate: record(withGit), readCaps: async () => ({ perRunCapUsd: null, totalCapUsd: null }) } }).build.run();
  assert.ok(withGit.length > 0);
  for (const args of withGit) assert.deepEqual(args, [{ projectDir: project.path }, { discover: false }], 'a project with git: cache only, as readDesignCaps');
  const noGit = [];
  const restore = withNoGit();
  try {
    await newBuild(newDesign({ projectKey: project.key }), { brief: 'MOCK_SECTIONS=1', deps: { teamTotalGate: record(noGit), readCaps: async () => ({ perRunCapUsd: null, totalCapUsd: null }) } }).build.run();
  } finally { restore(); }
  assert.ok(noGit.length > 0);
  for (const args of noGit) assert.deepEqual(args, [{ projectDir: project.path }, { discover: 'if-missing' }], 'no git: one HTTPS discovery, as readDesignCaps');
});

test('the CLI stopping on its own flag is the same total-limit pause', async () => {
  const { build } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { readCaps: async () => ({ perRunCapUsd: 1, totalCapUsd: null }), runClaude: async (o) => {
    o.onEvent({ type: 'session', sessionId: 's', model: 'mock', init: true });
    o.onEvent({ type: 'result', subtype: 'error_max_budget_usd', isError: true, costUsd: 0.1, cumulativeCost: true, sessionId: 's' });
    throw Object.assign(new Error('claude exited with code 1: no stderr'), { errorClass: null });
  } } });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'total-limit' });
});

test('a model booked off list price gets no flag, even under a per-run cap', async () => {
  const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { readCaps: async () => ({ perRunCapUsd: 5, totalCapUsd: null }), isListPriced: () => false } });
  await build.run();
  assert.ok(calls.length > 0);
  assert.ok(calls.every((c) => c.maxBudgetUsd == null));
});

/** The mock behind a bridge whose upstream reports $0.40 for every builder process, tagged with the agent's id. */
const bridged = (o) => {
  const a = listAgents(o.runId).find((x) => x.sectionId === (o.cwd.includes('sections') ? o.cwd.split(sep).at(-1) : null));
  if (a.role === 'builder') recordBridgeCost({ tag: a.id, costUsd: 0.4 });
  return runClaude({ ...o, mock: true });
};

test('a bridged model books what its upstream reported, as runs do', async () => {
  const { build } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { runClaude: bridged } });
  await build.run();
  const hero = listAgents(build.id).find((x) => x.sectionId === 'hero');
  assert.ok(Math.abs(prepare('SELECT SUM(amount_usd) s FROM design_cost_ledger WHERE agent_id = ?').get(hero.id).s - 0.4) < 1e-9);
  assert.equal(bridgeCostFor(hero.id), null, 'the tag is forgotten');
  near(hero.costUsd, 0.4, 'the agent shows it too');

  const capped = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2', deps: { runClaude: bridged, maxBuildersFor: () => 1, readCaps: async () => ({ perRunCapUsd: 0.3, totalCapUsd: null }) } });
  assert.deepEqual(await capped.build.run(), { status: 'paused', reason: 'total-limit' }, 'the bridged 0.4 trips the cap');
  assert.deepEqual(cwdNames(capped.calls), ['work', 'hero'], 'features never spawns');
  assert.deepEqual(sectionStatuses(capped.build), ['done', 'planned']);
  near(framesOf(capped.frames, 'design-build').at(-1).stats.costUsd, 0.4);
  near(framesOf(capped.frames, 'design-agent').filter((f) => f.sectionId === 'hero').at(-1).costUsd, 0.4, "the hero's frame");

  const priced = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_COST=0.1', deps: { runClaude: bridged } });
  await priced.build.run();
  const h = listAgents(priced.build.id).find((x) => x.sectionId === 'hero');
  near(prepare('SELECT SUM(amount_usd) s FROM design_cost_ledger WHERE agent_id = ?').get(h.id).s, 0.4, 'the CLI booked 0.1, the upstream 0.4: only the 0.3 beyond it is added');
  near(h.costUsd, 0.4);
});

test('the bridged figure is on the agent row at the exit, and stays there while the agent waits', async () => {
  const atExit = [];
  const heroRow = () => listAgents(made.build.id).find((x) => x.sectionId === 'hero');
  const made = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', deps: { runClaude: bridged, onLiveChange: () => {
    const hero = heroRow();
    if (hero && made.build.runningCount === 0) atExit.push(hero.costUsd);
  } } });
  const p = made.build.run();
  await waitForFrame(made.frames, (f) => f.type === 'design-question');
  near(atExit.at(-1), 0.4, 'the row has it as the process ends, with the ledger');
  near(heroRow().costUsd, 0.4, 'and after the exit, while the agent waits');
  assert.equal(made.build.pauseForDrain(), true);
  assert.deepEqual(await p, { status: 'paused', reason: 'drain' });
  assert.equal(heroRow().status, 'waiting');
  near(heroRow().costUsd, 0.4, 'a paused build keeps it, so a rehydrate seeds the right figure');
});

test('cost unknown stays unknown on the frames, never $0', async () => {
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_NO_COST' });
  await build.run();
  assert.equal(framesOf(frames, 'design-build').at(-1).stats.costKnown, false);
  const row = listAgents(build.id).find((a) => a.role === 'builder');
  assert.equal(row.costKnown, false);
  assert.equal(prepare('SELECT COUNT(*) n FROM design_cost_ledger WHERE build_id = ?').get(build.id).n, 0);
});
