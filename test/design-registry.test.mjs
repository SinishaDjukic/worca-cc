// test/design-registry.test.mjs
// P2 Task 17: the `createDesignBuilds` registry. Running builds in memory, every open one in `live()`, the start
// refusals and their order (M10), the global agent cap, Stop and Continue through rehydrated builds (L2.6), row-built
// snapshots for a late joiner, and the owner lookup `broadcast` calls for every frame. One home per file: `live()`
// reads every open row, and earlier rows leave paused builds open, so rows filter by design.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newDesign, useDesignEnv, waitForFrame, waitUntil } from './helpers/design-fixture.mjs';
import { currentBillTo, currentOwner } from '../src/core/billing.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { prepare } from '../src/core/db.mjs';
import { DesignBuild } from '../src/core/design/build.mjs';
import { DesignError } from '../src/core/design/ids.mjs';
import { designWorkDir } from '../src/core/design/paths.mjs';
import { createDesignBuilds } from '../src/core/design/registry.mjs';
import { createAgent, createBuild, deleteDesign, getAgent, getBuild, latestBuild, listAgents, updateBuild } from '../src/core/design/store.mjs';

useDesignEnv(after);
const mk = (over = {}) => { const frames = []; const r = createDesignBuilds({ broadcast: (f) => frames.push(f), deps: { staggerMs: 0, retryDelayMs: 0 }, ...over }); return { r, frames }; };
const status = (n) => (e) => e.status === n;
// One home per file: live() reads every open row, and earlier tests leave paused builds open. Filter by design.
const liveOf = (r, d, opts) => r.live(opts).filter((x) => x.designId === d.id);
/** A pin as P5 sends it (M10); P2's `pinsBlock` refuses every non-empty list until P5 Task 11. */
const PIN = { id: 'p1', path: 'sections/hero/index.html', tag: 'h1', text: 'Hi', html: '<h1>Hi</h1>' };

test('M10: start resolves {buildId, round, kind} at once, before the build ends', async () => {
  const { r, frames } = mk(); const d = newDesign({ title: 'Ship' });
  const got = await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_HANG_LEAD', by: 'local' });
  assert.deepEqual(Object.keys(got).sort(), ['buildId', 'kind', 'round']);
  assert.deepEqual([got.round, got.kind], [1, 'first']);
  assert.ok(r.get(got.buildId), 'still running');
  assert.deepEqual(liveOf(r, d).map((x) => [x.designId, x.buildId, x.title, x.waiting]), [[d.id, got.buildId, 'Ship', 0]]);
  r.pauseAll(); await r.settled();
  assert.ok(frames.some((f) => f.type === 'design-build'));
});
test('a finished build leaves the map and live()', async () => {
  const { r, frames } = mk(); const d = newDesign();
  const { buildId } = await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'local' });
  await r.settled();
  assert.ok(frames.some((f) => f.type === 'design-delta'));
  assert.deepEqual(liveOf(r, d), []);
  assert.equal(r.get(buildId), null);
  assert.equal(r.liveAgentCount(), 0);
});
test('a paused build is still live: nothing runs, but no second round and no restore', async () => {
  const { r } = mk(); const d = newDesign();
  const { buildId } = await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero', by: 'local' });
  await r.settled();
  assert.deepEqual(liveOf(r, d).map((x) => [x.buildId, x.status]), [[buildId, 'paused']]);
  assert.equal(r.get(buildId), null);
  await assert.rejects(r.start({ designId: d.id, brief: 'x', by: 'local' }), status(409));
});
test('refusals are Errors with numeric status', async () => {
  const { r } = mk(); const d = newDesign();
  await r.start({ designId: d.id, brief: 'MOCK_HANG_LEAD', by: 'local' });
  await assert.rejects(r.start({ designId: d.id, brief: 'x', by: 'local' }), status(409));
  await assert.rejects(r.start({ designId: newDesign().id, brief: '', by: 'local' }), status(422));
  const a = newDesign({ createdBy: 'a@x.io' }); const b = newDesign({ createdBy: 'a@x.io' });
  await r.start({ designId: a.id, brief: 'MOCK_HANG_LEAD', by: 'a@x.io' });
  await assert.rejects(r.start({ designId: b.id, brief: 'x', by: 'a@x.io' }), status(409));
  await assert.rejects(r.start({ designId: 'd_000000000000', brief: 'x', by: 'local' }), status(404));
  await assert.rejects(mk({ draining: () => true }).r.start({ designId: newDesign().id, brief: 'x', by: 'local' }), status(503));
  await assert.rejects(mk({ deps: { budgetStatus: () => ({ blocked: true }) } }).r.start({ designId: newDesign().id, brief: 'x', by: 'local' }), (e) => e.status === 403 && /total cost limit reached/.test(e.message));
  await assert.rejects(mk().r.start({ designId: newDesign({ engine: 'codex' }).id, brief: 'x', by: 'local' }), status(422));
  for (const engine of [null, 'claude', 'mock']) {
    const one = mk(); const got = await one.r.start({ designId: newDesign({ engine }).id, brief: 'MOCK_SECTIONS=1', by: 'local' });
    assert.equal(got.kind, 'first', `engine ${engine} counts as Claude`);
    await one.r.settled();
  }
  r.pauseAll(); await r.settled();
});
test('the refusals answer in order: each one before the next', async () => {
  const blocked = { deps: { budgetStatus: () => ({ blocked: true }) } };
  await assert.rejects(mk({ draining: () => true }).r.start({ designId: 'd_000000000000', brief: 'x', by: 'local' }), status(503), 'draining before an unknown design');
  await assert.rejects(mk().r.start({ designId: newDesign({ engine: 'codex' }).id, brief: '', by: 'local' }), (e) => e.status === 422 && /Claude/.test(e.message), 'the engine before the brief');
  const { r } = mk(); const d = newDesign({ createdBy: 'a@x.io' });
  await r.start({ designId: d.id, brief: 'MOCK_HANG_LEAD', by: 'a@x.io' });
  await assert.rejects(r.start({ designId: d.id, brief: '', by: 'a@x.io' }), (e) => e.status === 422 && !/Claude/.test(e.message), 'the brief before the open build');
  await assert.rejects(r.start({ designId: d.id, brief: 'x', by: 'a@x.io' }), (e) => e.status === 409 && e.code === undefined && /this design/i.test(e.message), 'the design\'s open build before the person');
  await assert.rejects(r.start({ designId: newDesign().id, brief: 'x', pins: [PIN], by: 'a@x.io' }), (e) => e.status === 409 && /You already have a build running/.test(e.message), 'the person before the pins');
  await assert.rejects(mk(blocked).r.start({ designId: newDesign().id, brief: 'x', pins: [PIN], by: 'local' }), status(422), 'the pins before the budget');
  await assert.rejects(mk(blocked).r.start({ designId: newDesign().id, instruction: 'x', sections: ['ghost'], by: 'local' }), status(403), 'the budget before the change checks');
  r.pauseAll(); await r.settled();
  const again = await r.start({ designId: newDesign().id, brief: 'MOCK_SECTIONS=1', by: 'a@x.io' });
  assert.ok(again.buildId, 'a paused build does not hold its person');
  await r.settled();
});
test('a throw while creating the build answers a status: 409, 404, 422, else 500', async () => {
  const at = (err) => mk({ deps: { staggerMs: 0, maxBuildersFor: () => { throw err; } } }).r.start({ designId: newDesign().id, brief: 'x', by: 'local' });
  await assert.rejects(at(new DesignError('CONFLICT', 'raced')), (e) => e.status === 409 && e.code === undefined && e.message === 'A build is already running');
  await assert.rejects(at(new DesignError('NOT_FOUND', 'gone')), status(404));
  await assert.rejects(at(new DesignError('BAD_REQUEST', 'bad')), status(422));
  await assert.rejects(at(new DesignError('IO', 'disk')), (e) => e instanceof Error && e.status === 500);
  await assert.rejects(at(new Error('SQLITE_BUSY')), (e) => e instanceof Error && e.status === 500);
  await assert.rejects(mk().r.start({ designId: newDesign().id, brief: 'x'.repeat(4001), by: 'local' }), status(422));
});
test('M6: a throw once the row exists closes it, so the design can start again', async () => {
  for (const kind of ['first', 'change']) {
    const d = newDesign();
    if (kind === 'change') { const { r } = mk(); await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'local' }); await r.settled(); }
    let boom = true;
    const { r } = mk({ deps: { staggerMs: 0, maxBuildersFor: () => { if (boom) { boom = false; throw new Error('SQLITE_BUSY'); } return 3; } } });
    const opts = kind === 'change' ? { designId: d.id, instruction: 'Warmer', by: 'local' } : { designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'local' };
    await assert.rejects(r.start(opts), status(500), kind);
    const row = latestBuild(d.id);
    assert.equal(row.kind, kind);
    assert.deepEqual([row.status, row.reason], ['error', 'engine-error'], `${kind}: the row is closed`);
    const again = await r.start(opts);
    assert.equal(again.kind, kind, `${kind}: no 409 from a row nothing holds`);
    await r.settled();
  }
});

test('M6: Stop closes an open row no build here holds, as boot recovery would, so Delete and Start work again', async () => {
  const d = newDesign();
  const row = createBuild({ designId: d.id, kind: 'first', brief: 'x' }, { by: 'local' });
  updateBuild(row.id, { status: 'building', sections: [{ id: 'hero', status: 'writing' }, { id: 'faq', status: 'done' }] });
  const live = createAgent({ buildId: row.id, role: 'builder', sectionId: 'hero', job: 'Hero', engine: 'claude', status: 'writing' });
  const ended = createAgent({ buildId: row.id, role: 'builder', sectionId: 'faq', job: 'Faq', engine: 'claude', status: 'done' });
  const { r } = mk();
  await assert.rejects(r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'local' }), status(409), 'wedged before the Stop');
  await r.stopBuild(row.id);
  const shut = getBuild(row.id);
  assert.deepEqual([shut.status, shut.reason], ['stopped', 'user']);
  assert.ok(shut.endedAt);
  assert.deepEqual(shut.sections.map((s) => s.status), ['stopped', 'done']);
  assert.deepEqual([getAgent(live.id).status, getAgent(ended.id).status], ['stopped', 'done']);
  const next = await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'local' });
  assert.equal(next.round, 2);
  await r.settled();
});

test('a change round needs a plan and known sections; it returns kind change', async () => {
  const { r } = mk(); const d = newDesign();
  await assert.rejects(r.start({ designId: d.id, instruction: 'x', by: 'local' }), status(422));
  await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'local' }); await r.settled();
  await assert.rejects(r.start({ designId: d.id, instruction: 'x', sections: ['ghost'], needsLead: false, by: 'local' }), status(422));
  const got = await r.start({ designId: d.id, instruction: 'x', sections: ['hero'], needsLead: false, by: 'local' });
  assert.deepEqual([got.round, got.kind], [2, 'change']);
  await r.settled();
  // pins before P5: non-empty pins -> 422 (P5 Task 11 flips this row)
  await assert.rejects(r.start({ designId: d.id, instruction: 'x', sections: ['hero'], pins: [PIN], by: 'local' }), status(422));
  // no sections and no needsLead -> a lead round
  const lead = await r.start({ designId: d.id, instruction: 'Warmer', brief: 'ignored', by: 'local' });
  assert.deepEqual([lead.round, lead.kind], [3, 'change']);
  await r.settled();
  assert.deepEqual(listAgents(lead.buildId).map((a) => a.role).slice(0, 1), ['lead']);
  assert.deepEqual([getBuild(lead.buildId).status, getBuild(lead.buildId).brief], ['done', 'Warmer'], 'instruction wins over brief');
});
test('a build runs as the person who started it', async () => {
  let who = null; let owner = null;
  const { r } = mk({ deps: { staggerMs: 0, runClaude: (o) => { who = currentBillTo(); owner = currentOwner(); return runClaude({ ...o, mock: true }); } } });
  const d = newDesign({ createdBy: 'a@x.io' });
  await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'a@x.io' });
  await r.settled();
  assert.equal(who, 'a@x.io');
  await r.start({ designId: newDesign({ createdBy: 'b@x.io' }).id, brief: 'MOCK_SECTIONS=1', by: 'a@x.io' });
  await r.settled();
  assert.deepEqual([who, owner], ['a@x.io', 'b@x.io'], 'billed to the starter, owned by the design\'s maker');
});
test('the global cap holds across builds', async () => {
  let now = 0; let peak = 0;
  const { r } = mk({ globalCap: 2, deps: { staggerMs: 0, runClaude: async (o) => { now++; peak = Math.max(peak, now); try { await new Promise((res) => setTimeout(res, 5)); return await runClaude({ ...o, mock: true }); } finally { now--; } } } });
  for (let i = 0; i < 3; i++) await r.start({ designId: newDesign().id, brief: 'MOCK_SECTIONS=2', by: 'local' });
  await r.settled();
  assert.equal(peak, 2);
});
test('M6: fast on allows 12 at once under the default', async () => {
  let now = 0; let peak = 0;
  const { r } = mk({ deps: { staggerMs: 0, runClaude: async (o) => { if (o.cwd.includes('sections')) { now++; peak = Math.max(peak, now); } try { await new Promise((res) => setTimeout(res, 5)); return await runClaude({ ...o, mock: true }); } finally { if (o.cwd.includes('sections')) now--; } } } });
  await r.start({ designId: newDesign({ fast: true }).id, brief: 'MOCK_SECTIONS=20', by: 'local' });
  await r.settled();
  assert.equal(peak, 12);
});
test('L2.12: hosted, fast on allows 6 at once', async () => {
  let now = 0; let peak = 0;
  const { r } = mk({ hosted: true, deps: { staggerMs: 0, runClaude: async (o) => { if (o.cwd.includes('sections')) { now++; peak = Math.max(peak, now); } try { await new Promise((res) => setTimeout(res, 5)); return await runClaude({ ...o, mock: true }); } finally { if (o.cwd.includes('sections')) now--; } } } });
  await r.start({ designId: newDesign({ fast: true }).id, brief: 'MOCK_SECTIONS=10', by: 'local' });
  await r.settled();
  assert.equal(peak, 6);
});
test('liveAgentCount follows processes and onLiveChange fires', async () => {
  const seen = []; const { r, frames } = mk({ onLiveChange: () => seen.push(r.liveAgentCount()) });
  const d = newDesign();
  const { buildId } = await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', by: 'local' });
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  assert.ok(Math.max(...seen) >= 1);
  assert.equal(r.liveAgentCount(), 0, 'a waiting agent has no process, so it keeps no machine awake');
  r.get(buildId).answer(q.askId, [{ id: 'q1', value: 'a' }]);
  await r.settled();
  assert.equal(seen.at(-1), 0, 'the settle reports the build gone');
});
test('onLiveChange fires once a settled build has left the map', async () => {
  const seen = []; const { r } = mk({ onLiveChange: () => seen.push(r.busy()) });
  await r.start({ designId: newDesign().id, brief: 'MOCK_SECTIONS=1', by: 'local' });
  await r.settled();
  assert.equal(seen.at(-1), false);
});
test('pauseAll pauses every running build', async () => {
  const { r } = mk();
  const { buildId } = await r.start({ designId: newDesign().id, brief: 'MOCK_HANG_LEAD', by: 'local' });
  assert.equal(r.pauseAll(), 1);
  assert.equal(r.pauseAll(), 0, 'idempotent: the drain poll calls it every 200 ms');
  await r.settled();
  assert.deepEqual([getBuild(buildId).status, getBuild(buildId).reason], ['paused', 'drain']);
  assert.equal(r.liveAgentCount(), 0);
  assert.equal(r.pauseAll(), 0);
});
test('stopBuild stops a running build, closes a paused one, and is a no-op on a finished one', async () => {
  const { r, frames } = mk();
  const a = await r.start({ designId: newDesign().id, brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero', by: 'local' });
  await r.settled();
  await r.stopBuild(a.buildId);
  assert.equal(getBuild(a.buildId).status, 'stopped');
  assert.equal(frames.filter((f) => f.type === 'design-build' && f.buildId === a.buildId).at(-1).status, 'stopped');
  assert.deepEqual([r.get(a.buildId), r.busy()], [null, false], 'the closing build left the map');
  await r.stopBuild(a.buildId);
  assert.equal(getBuild(a.buildId).status, 'stopped');
  assert.equal(frames.filter((f) => f.type === 'design-build' && f.buildId === a.buildId && f.status === 'stopped').length, 1, 'a finished build sends nothing');
});
test('stopBuild of a running build signals it and resolves at once', async () => {
  // The lead's process ends only once `open` resolves, so "at once" is the build still in memory after the await.
  let open; const gate = new Promise((res) => { open = res; });
  const { r } = mk({ deps: { staggerMs: 0, runClaude: (o) => { const ctl = new AbortController(); o.signal.addEventListener('abort', () => { gate.then(() => ctl.abort()); }, { once: true }); return runClaude({ ...o, signal: ctl.signal, mock: true }); } } });
  const { buildId } = await r.start({ designId: newDesign().id, brief: 'MOCK_HANG_LEAD', by: 'local' });
  await waitUntil(() => r.liveAgentCount() === 1);
  let bound;
  const late = new Promise((res) => { bound = setTimeout(() => res('pending'), 1000); });
  try {
    assert.equal(await Promise.race([r.stopBuild(buildId).then(() => 'resolved'), late]), 'resolved');
    assert.ok(r.get(buildId), 'resolved before the build settled');
  } finally {
    clearTimeout(bound);
    open();
  }
  await r.settled();
  assert.deepEqual([getBuild(buildId).status, getBuild(buildId).reason], ['stopped', 'user']);
});
test('continueBuild: from a paused row, with sections; refuses while running or draining', async () => {
  const { r, frames } = mk(); const d = newDesign();
  const { buildId } = await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=2 MOCK_FAIL_SECTION=hero', by: 'local' });
  await r.settled();
  assert.throws(() => mk({ draining: () => true }).r.continueBuild({ designId: d.id, buildId, by: 'local' }), status(503));
  assert.throws(() => r.continueBuild({ designId: newDesign().id, buildId, by: 'local' }), status(404));
  assert.throws(() => r.continueBuild({ designId: d.id, buildId: 'b_000000000000', by: 'local' }), status(404));
  assert.deepEqual(r.continueBuild({ designId: d.id, buildId, sections: ['hero'], by: 'local' }), { buildId });
  const held = r.get(buildId);
  assert.throws(() => r.continueBuild({ designId: d.id, buildId, by: 'local' }), (e) => e.status === 409 && /is running/.test(e.message));
  assert.equal(r.get(buildId), held, 'the in-memory guard answered, not a second rehydrate');
  await r.settled();
  assert.equal(getBuild(buildId).status, 'done');
  assert.equal(frames.filter((f) => f.type === 'design-build' && f.buildId === buildId).at(-1).status, 'done', 'a continued build is wired to broadcast');
  assert.throws(() => r.continueBuild({ designId: d.id, buildId, by: 'local' }), status(409));
  assert.deepEqual([r.get(buildId), r.busy()], [null, false], 'a refused continue leaves nothing behind');
});
test('continueBuild runs as the person who continued it, owned by the design\'s maker', async () => {
  let who = null; let owner = null;
  const { r } = mk({ deps: { staggerMs: 0, retryDelayMs: 0, runClaude: (o) => { who = currentBillTo(); owner = currentOwner(); return runClaude({ ...o, mock: true }); } } });
  const d = newDesign({ createdBy: 'b@x.io' });
  const { buildId } = await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero', by: 'b@x.io' });
  await r.settled();
  r.continueBuild({ designId: d.id, buildId, by: 'a@x.io' });
  await r.settled();
  assert.deepEqual([getBuild(buildId).status, who, owner], ['done', 'a@x.io', 'b@x.io']);
});
test('snapshotFor: live, settled from rows, and hidden from another person', async () => {
  const { r, frames } = mk(); const d = newDesign({ createdBy: 'a@x.io' });
  const { buildId } = await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_HANG_SECTION=hero', by: 'a@x.io' });
  await waitForFrame(frames, (f) => f.type === 'design-delta' && f.sectionId === 'hero');
  const live = r.snapshotFor(buildId, { viewer: 'a@x.io' });
  assert.ok(live.drafts.length > 0);
  assert.equal(r.snapshotFor(buildId, { viewer: 'b@x.io' }), null);
  r.pauseAll(); await r.settled();
  const s = r.snapshotFor(buildId, { viewer: null });
  assert.deepEqual([s.type, s.build.status, s.drafts], ['design-snapshot', 'paused', []]);
  const keys = (o) => Object.keys(o).sort();
  for (const [a, b] of [[s, live], [s.build, live.build], [s.build.stats, live.build.stats], [s.plan, live.plan], [s.plan.sections[0], live.plan.sections[0]], [s.agents[0], live.agents[0]], [s.sections[0], live.sections[0]]]) assert.deepEqual(keys(a), keys(b));
  assert.deepEqual([s.agents.map((x) => x.agentId).sort(), s.plan.canvas], [live.agents.map((x) => x.agentId).sort(), { w: 1440 }]);
  assert.equal(r.snapshotFor('b_000000000000'), null);
  assert.equal(r.snapshotFor(buildId, { viewer: 'b@x.io' }), null, 'the row path is hidden too');
  assert.deepEqual([s.designId, s.buildId, s.seq, s.questions, s.plan.planRev], [d.id, buildId, 0, [], 1]);
  assert.deepEqual([s.build.round, s.build.kind, s.build.reason, s.build.stats.agentsNow, s.build.stats.estimatedUsd], [1, 'first', 'drain', 0, 0]);
  assert.deepEqual(s.agents.map((x) => [x.tool, x.estimatedUsd]), s.agents.map(() => [null, null]));
  assert.deepEqual(s.plan.sections, s.sections);
  assert.notEqual(s.plan.sections, s.sections, 'two copies, never one shared array');
});
test('snapshotFor from rows: planRev and canvas from a valid plan only, stats from the rows, no todo', async () => {
  const { r } = mk(); const d = newDesign();
  const first = await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=2 MOCK_FAIL_SECTION=hero', by: 'local' });
  await r.settled();
  const s = r.snapshotFor(first.buildId);
  assert.deepEqual([s.build.status, s.build.reason, s.build.stats.failed, s.build.stats.sectionsDone, s.build.stats.sectionsPlanned], ['paused', 'failed', 1, 1, 2]);
  assert.equal(s.build.stats.agentsTotal, listAgents(first.buildId).length);
  const row = getBuild(first.buildId);
  assert.equal(s.build.stats.elapsedMs, Date.parse(row.endedAt) - Date.parse(row.startedAt), 'elapsedMs from the row times');
  assert.ok(s.build.stats.elapsedMs > 0);
  r.continueBuild({ designId: d.id, buildId: first.buildId, by: 'local' }); await r.settled();
  // A lead-less change round paused before its first spawn: its section carries a `todo` in the row, and no lead
  // applied a round, so planRev stays 1.
  const ch = await r.start({ designId: d.id, instruction: 'Bolder', sections: ['hero'], needsLead: false, by: 'local' });
  r.pauseAll(); await r.settled();
  assert.ok(getBuild(ch.buildId).sections.some((x) => x.todo), 'the row holds a todo');
  // An add with no build yet is marked `unbuiltAdd` in the row, and that never leaves the engine either.
  updateBuild(ch.buildId, { sections: getBuild(ch.buildId).sections.map((x) => (x.id === 'hero' ? x : { ...x, unbuiltAdd: true })) });
  const c = r.snapshotFor(ch.buildId);
  assert.deepEqual([c.build.kind, c.build.status, c.plan.planRev, c.plan.canvas], ['change', 'paused', 1, { w: 1440 }]);
  const internal = (x) => 'todo' in x || 'unbuiltAdd' in x;
  assert.ok(!c.sections.some(internal) && !c.plan.sections.some(internal), 'todo and unbuiltAdd never leave the engine');
  await r.stopBuild(ch.buildId);
  // A change round whose lead applied its round reads planRev 2 (a finished build takes the row path too).
  const f = newDesign();
  await r.start({ designId: f.id, brief: 'MOCK_SECTIONS=1', by: 'local' }); await r.settled();
  const lr = await r.start({ designId: f.id, instruction: 'Warmer', by: 'local' });
  await r.settled();
  assert.equal(getBuild(lr.buildId).status, 'done');
  assert.deepEqual([r.snapshotFor(lr.buildId).build.kind, r.snapshotFor(lr.buildId).plan.planRev], ['change', 2]);
  // With no plan held (the lead never wrote one), canvas is null and planRev 0.
  const e = newDesign(); const hung = await r.start({ designId: e.id, brief: 'MOCK_HANG_LEAD', by: 'local' });
  r.pauseAll(); await r.settled();
  const n = r.snapshotFor(hung.buildId);
  assert.deepEqual([n.plan.planRev, n.plan.canvas, n.plan.sections, n.sections, n.agents.length], [0, null, [], [], 1]);
  // A valid plan.json on disk while the row has no section records is not a held plan: a rehydrate drops it too.
  writeFileSync(join(designWorkDir(e.id), 'plan.json'), readFileSync(join(designWorkDir(f.id), 'plan.json')));
  const held = DesignBuild.rehydrate({ buildId: hung.buildId }).snapshot().plan;
  const disk = r.snapshotFor(hung.buildId).plan;
  assert.deepEqual([disk.planRev, disk.canvas], [held.planRev, held.canvas]);
  assert.deepEqual([disk.planRev, disk.canvas], [0, null]);
});
test('snapshotFor from rows: each agent\'s tokens are the counts a live snapshot carries, never the engine\'s session figure', async () => {
  const { r } = mk();
  const live = [];
  const { buildId } = await r.start({ designId: newDesign().id, brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero', by: 'local' });
  live.push(...r.get(buildId).snapshot().agents);
  await r.settled();
  assert.ok(listAgents(buildId).every((a) => Number.isFinite(a.tokens?.sessionUsd)), 'the rows keep it for a rehydrate (M3)');
  const rows = r.snapshotFor(buildId).agents;
  assert.ok(rows.length >= 2);
  for (const a of [...rows, ...live]) assert.deepEqual(Object.keys(a.tokens).sort(), ['cr', 'cw', 'in', 'out'], a.agentId);
  await r.stopBuild(buildId);
});

test('snapshotFor answers null on a read error, never a throw', async () => {
  const { r } = mk(); const d = newDesign();
  const { buildId } = await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero', by: 'local' });
  await r.settled();
  assert.ok(r.snapshotFor(buildId));
  const saved = prepare('SELECT sections_json AS s FROM design_builds WHERE id = ?').get(buildId).s;
  prepare('UPDATE design_builds SET sections_json = ? WHERE id = ?').run('[null]', buildId);
  assert.equal(r.snapshotFor(buildId), null);
  prepare('UPDATE design_builds SET sections_json = ? WHERE id = ?').run(saved, buildId);
  await r.stopBuild(buildId);
});
test('a local install sees its own builds: a null viewer and createdBy local', async () => {
  const { r } = mk(); const d = newDesign();
  const { buildId } = await r.start({ designId: d.id, brief: 'MOCK_HANG_LEAD', by: 'local' });
  assert.deepEqual(liveOf(r, d, { viewer: null }).map((x) => x.buildId), [buildId]);
  assert.ok(r.snapshotFor(buildId, { viewer: null }));
  r.pauseAll(); await r.settled();
});
test('frameOwner names any design frame owner, design-restored included, and nothing else', async () => {
  const { r } = mk(); const d = newDesign({ createdBy: 'a@x.io' });
  assert.equal(r.frameOwner({ type: 'design-delta', designId: d.id }), 'a@x.io');
  assert.equal(r.frameOwner({ type: 'design-restored', designId: d.id, version: 2, restoredFrom: 1, ts: 1 }), 'a@x.io');
  assert.equal(r.frameOwner({ type: 'ask-delta', threadId: 't' }), null);
  assert.equal(r.frameOwner({ type: 'run-update', designId: d.id }), null, 'only design- frames');
  assert.equal(r.frameOwner({ type: 'design-delta', designId: 'd_000000000000' }), null);
  // a design created by 'b@x.io' whose build a@x.io started through the registry: frameOwner and live({viewer})
  // follow 'b@x.io', never the build's by
  const e = newDesign({ createdBy: 'b@x.io' });
  const { buildId } = await r.start({ designId: e.id, brief: 'MOCK_HANG_LEAD', by: 'a@x.io' });
  assert.equal(r.frameOwner({ type: 'design-build', designId: e.id, buildId }), 'b@x.io');
  assert.deepEqual([liveOf(r, e, { viewer: 'b@x.io' }).length, liveOf(r, e, { viewer: 'a@x.io' }).length], [1, 0]);
  assert.deepEqual([Boolean(r.snapshotFor(buildId, { viewer: 'b@x.io' })), r.snapshotFor(buildId, { viewer: 'a@x.io' })], [true, null]);
  r.pauseAll(); await r.settled();
  assert.deepEqual([Boolean(r.snapshotFor(buildId, { viewer: 'b@x.io' })), r.snapshotFor(buildId, { viewer: 'a@x.io' })], [true, null]);
  await r.stopBuild(buildId);
});
test('frameOwner caches each owner, clears past 5000, and answers null on any error', () => {
  const { r } = mk(); const d = newDesign({ createdBy: 'a@x.io' });
  assert.equal(r.frameOwner({ type: 'design-file', designId: d.id }), 'a@x.io');
  deleteDesign(d.id);
  assert.equal(r.frameOwner({ type: 'design-file', designId: d.id }), 'a@x.io', 'cached: broadcast reads no row per frame');
  for (let i = 0; i <= 5001; i++) r.frameOwner({ type: 'design-delta', designId: `d_${String(i).padStart(12, '0')}` });
  assert.equal(r.frameOwner({ type: 'design-file', designId: d.id }), null, 'the cache was cleared past 5000 entries');
  assert.equal(r.frameOwner({ type: 'design-delta', get designId() { throw new Error('read'); } }), null);
  assert.equal(r.frameOwner({ type: 'design-delta' }), null);
  assert.equal(r.frameOwner(null), null);
});
test('live filters by viewer', async () => {
  const { r } = mk(); const d = newDesign({ createdBy: 'a@x.io' }); const n = newDesign({ createdBy: null });
  await r.start({ designId: d.id, brief: 'MOCK_HANG_LEAD', by: 'a@x.io' });
  await r.start({ designId: n.id, brief: 'MOCK_HANG_LEAD', by: 'local' });
  assert.deepEqual(liveOf(r, d, { viewer: 'b@x.io' }), []);
  assert.equal(liveOf(r, d, { viewer: 'a@x.io' }).length, 1);
  assert.equal(liveOf(r, d).length, 1);
  assert.equal(liveOf(r, n, { viewer: 'b@x.io' }).length, 1, 'a design with no maker is everyone\'s');
  r.pauseAll(); await r.settled();
  assert.equal(liveOf(r, d, { viewer: 'b@x.io' }).length, 0, 'a paused row is filtered the same way');
  assert.deepEqual(liveOf(r, d, { viewer: 'a@x.io' }).map((x) => [x.status, x.waiting]), [['paused', 0]]);
});
test('live counts a paused build\'s waiting agents from its rows', async () => {
  const { r, frames } = mk(); const d = newDesign();
  const { buildId } = await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', by: 'local' });
  await waitForFrame(frames, (f) => f.type === 'design-question');
  assert.deepEqual(liveOf(r, d).map((x) => x.waiting), [1], 'from the build in memory');
  assert.equal(r.snapshotFor(buildId).build.waiting, 1);
  r.pauseAll(); await r.settled();
  assert.equal(r.get(buildId), null);
  assert.deepEqual(liveOf(r, d).map((x) => [x.status, x.waiting]), [['paused', 1]], 'from the agent rows (L2.29)');
  const s = r.snapshotFor(buildId);
  assert.deepEqual([s.build.waiting, s.agents.filter((a) => a.status === 'waiting').length, s.questions], [1, 1, []], 'the row snapshot counts it too; askId lived in memory');
  await r.stopBuild(buildId);
});
test('the constructor calls none of its hooks', () => {
  const boom = () => { throw new Error('called during construction'); };
  assert.doesNotThrow(() => createDesignBuilds({ broadcast: boom, draining: boom, onLiveChange: boom }));
});
test('methods live on the prototype, so a test can shadow live() and delete the shadow', () => {
  const { r } = mk(); const real = r.live();
  r.live = () => [{ designId: 'x' }]; assert.deepEqual(r.live(), [{ designId: 'x' }]);
  delete r.live; assert.deepEqual(r.live(), real);
});
