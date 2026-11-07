// test/design-continue.test.mjs
// P2 Task 15: `continue({sections})`, `DesignBuild.rehydrate` and boot recovery (`recoverDesignBuilds`). One home per
// file: every row closes the builds it leaves open, and counts compare with `listOpenBuilds()` read just before.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { framesOf, newBuild, newDesign, useDesignEnv, waitForFrame, waitUntil } from './helpers/design-fixture.mjs';
import { mockSpawnLog, runClaude } from '../src/core/claude-runner.mjs';
import { prepare } from '../src/core/db.mjs';
import { DesignBuild } from '../src/core/design/build.mjs';
import { asksDir, designWorkDir, distDir } from '../src/core/design/paths.mjs';
import { recoverDesignBuilds } from '../src/core/design/recover.mjs';
import {
  OPEN_BUILD_STATUSES, createAgent, createBuild, getAgent, getBuild, getDesign, listAgents, listOpenBuilds, updateAgent,
  updateBuild, updateDesign,
} from '../src/core/design/store.mjs';
import { MOCK_SPAWN_LOG_MAX } from '../src/core/engines/mock.mjs';
import { _testing as mockDesignTesting } from '../src/core/engines/mock-design.mjs';

useDesignEnv(after);
const crash = (buildId) => { updateBuild(buildId, { status: 'building', endedAt: null }); for (const a of listAgents(buildId)) if (a.status === 'stopped') updateAgent(a.id, { status: 'writing', endedAt: null }); };
const again = (buildId, deps = {}) => { const calls = []; const frames = []; const b = DesignBuild.rehydrate({ buildId, deps: { staggerMs: 0, retryDelayMs: 0, runClaude: (o) => { calls.push(o); return runClaude({ ...o, mock: true }); }, ...deps } }); b.on('frame', (f) => frames.push(f)); return { b, calls, frames }; };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`);
/** Closes every build of `ids` still open, so a later count sees only its own row's builds. */
const close = (...ids) => {
  for (const id of ids) if (OPEN_BUILD_STATUSES.includes(getBuild(id)?.status)) updateBuild(id, { status: 'stopped' });
};
const names = (calls) => calls.map((c) => c.cwd.split(sep).at(-1));
const iso = (ms) => new Date(ms).toISOString();
const integrationFile = (designId) => join(designWorkDir(designId), 'integration.json');

test('updateBuild takes startedAt, and endedAt null reopens', () => {
  const b = createBuild({ designId: newDesign().id, kind: 'first', brief: 'x' }, { by: 'local' });
  const u = updateBuild(b.id, { status: 'stopped' }); assert.ok(u.endedAt);
  const r = updateBuild(b.id, { status: 'building', endedAt: null, startedAt: '2026-11-05T00:00:00.000Z' });
  assert.deepEqual([r.endedAt, r.startedAt], [null, '2026-11-05T00:00:00.000Z']);
  for (const bad of [null, 1730764800000, 'yesterday']) assert.throws(() => updateBuild(b.id, { startedAt: bad }), { code: 'BAD_REQUEST' });
  assert.equal(getBuild(b.id).startedAt, '2026-11-05T00:00:00.000Z', 'a refused patch writes nothing');
  updateBuild(b.id, { status: 'stopped' });
});

test('recover marks live builds and agents interrupted; paused stays; a running build is skipped', () => {
  const open = (status, reason = null) => {
    const b = createBuild({ designId: newDesign().id, kind: 'first', brief: 'x' }, { by: 'local' });
    return status === 'planning' ? b : updateBuild(b.id, { status, reason });
  };
  const agent = (buildId, status, sectionId = 'hero') => createAgent({ buildId, role: 'builder', sectionId, job: 'Hero', engine: 'claude', status });
  const A = open('building');
  const B = open('planning');
  const C = open('paused', 'drain');
  const D = open('building');
  const live = ['starting', 'thinking', 'writing', 'reading', 'waiting', 'retrying'].map((s) => agent(A.id, s));
  const ended = agent(A.id, 'done', 'features');
  updateBuild(A.id, { sections: [{ id: 'hero', status: 'writing' }, { id: 'features', status: 'done' }, { id: 'faq', status: 'planned' }] });
  const cAgent = agent(C.id, 'waiting');
  updateBuild(C.id, { sections: [{ id: 'hero', status: 'writing' }] });
  const dAgent = agent(D.id, 'writing');
  const expected = listOpenBuilds().filter((b) => b.status !== 'paused' && b.id !== D.id).length;
  assert.ok(expected >= 2);
  assert.equal(recoverDesignBuilds({ isLive: (id) => id === D.id }), expected);
  for (const id of [A.id, B.id]) {
    const row = getBuild(id);
    assert.deepEqual([row.status, row.reason], ['interrupted', 'restart'], id);
    assert.ok(Number.isFinite(Date.parse(row.endedAt)), 'endedAt set');
  }
  for (const a of live) {
    const row = getAgent(a.id);
    assert.equal(row.status, 'interrupted', `${a.status} -> interrupted`);
    assert.ok(row.endedAt);
  }
  assert.equal(getAgent(ended.id).status, 'done', 'an ended agent is left alone');
  assert.deepEqual(getBuild(A.id).sections.map((s) => s.status), ['stopped', 'done', 'planned']);
  assert.equal(getDesign(A.designId).status, 'interrupted');
  assert.deepEqual([getBuild(C.id).status, getBuild(C.id).reason, getBuild(C.id).endedAt], ['paused', 'drain', null], 'paused stays');
  assert.equal(getAgent(cAgent.id).status, 'waiting');
  assert.equal(getBuild(C.id).sections[0].status, 'writing');
  assert.deepEqual([getBuild(D.id).status, getAgent(dAgent.id).status], ['building', 'writing'], 'a running build is skipped');
  close(C.id, D.id);
  assert.equal(recoverDesignBuilds(), 0, 'nothing left to recover');
});

test('Continue after a restart re-spawns only unfinished sections, resuming their sessions', async () => {
  const d = newDesign();
  const first = newBuild(d, { brief: 'MOCK_SECTIONS=2 MOCK_HANG_SECTION=features' });
  const p = first.build.run();
  await waitForFrame(first.frames, (f) => f.type === 'design-delta' && f.sectionId === 'features');
  await waitForFrame(first.frames, (f) => f.type === 'design-section' && f.sectionId === 'hero' && f.status === 'done');
  first.build.pauseForDrain(); await p;
  crash(first.build.id);
  recoverDesignBuilds();
  assert.equal(getBuild(first.build.id).status, 'interrupted');
  const { b, calls } = again(first.build.id);
  assert.deepEqual(await b.continue(), { status: 'done', reason: null });
  assert.deepEqual(calls.map((c) => c.cwd.split(sep).at(-1)), ['features', 'work']);
  const row = listAgents(first.build.id).find((a) => a.sectionId === 'features');
  assert.equal(calls[0].resumeSessionId, row.sessionId);
  assert.match(calls[0].prompt, /Read .*before.*Edit/is);
  assert.equal(getBuild(first.build.id).sections.every((s) => s.status === 'done'), true);
  assert.equal(listAgents(first.build.id).length, 3, 'M6: no new agent row');
  assert.equal(getBuild(first.build.id).agentsTotal, 3);
});

test('nothing starts by itself: recover spawns no agent', async () => {
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_HANG_SECTION=hero' });
  const p = first.build.run();
  await waitForFrame(first.frames, (f) => f.type === 'design-delta' && f.sectionId === 'hero');
  first.build.pauseForDrain(); await p;
  crash(first.build.id);
  assert.ok(mockSpawnLog.length > 0 && mockSpawnLog.length < MOCK_SPAWN_LOG_MAX, 'below the cap, so a new spawn would grow the log');
  const [n, last] = [mockSpawnLog.length, mockSpawnLog.at(-1)];
  const expected = listOpenBuilds().filter((b) => b.status !== 'paused').length;
  assert.equal(recoverDesignBuilds(), expected);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(mockSpawnLog.length, n);
  assert.equal(mockSpawnLog.at(-1), last);
  assert.equal(getBuild(first.build.id).status, 'interrupted');
  assert.ok(listAgents(first.build.id).every((a) => a.status === 'done' || a.status === 'interrupted'));
});

test('M8: continue {sections} retries only those; with no field, every unfinished section', async () => {
  const d = newDesign();
  const first = newBuild(d, { brief: 'MOCK_SECTIONS=3 MOCK_FAIL_SECTION=hero MOCK_FAIL_SECTION=features' });
  assert.deepEqual(await first.build.run(), { status: 'paused', reason: 'failed' });
  const one = again(first.build.id);
  assert.deepEqual(await one.b.continue({ sections: ['hero'] }), { status: 'paused', reason: 'failed' });
  assert.deepEqual(one.calls.map((c) => c.cwd.split(sep).at(-1)), ['hero'], 'integration still has not run');
  assert.equal(framesOf(one.frames, 'design-build').at(-1).stats.failed, 1);
  const all = again(first.build.id);
  assert.deepEqual(await all.b.continue(), { status: 'done', reason: null });
  assert.deepEqual(all.calls.map((c) => c.cwd.split(sep).at(-1)), ['features', 'work'], 'then integration');
  assert.ok(existsSync(join(distDir(d.id), 'index.html')));
});

test('continue {sections} refuses what it cannot retry', async () => {
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_FAIL_SECTION=hero' });
  await first.build.run();
  for (const sections of [['ghost'], ['features'], 'hero', [], null, ['hero', 7]]) assert.throws(() => again(first.build.id).b.continue({ sections }), { status: 422 }, JSON.stringify(sections));
  assert.deepEqual([getBuild(first.build.id).status, getBuild(first.build.id).reason], ['paused', 'failed'], 'a refusal changes nothing');
  close(first.build.id);
});

test('a subset after a halt leaves the rest for later', async () => {
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=3 MOCK_USAGE_LIMIT_SECTION=hero', deps: { maxBuildersFor: () => 1 } });
  assert.deepEqual(await first.build.run(), { status: 'paused', reason: 'usage_limit' });
  assert.deepEqual(getBuild(first.build.id).sections.map((s) => s.status), ['stopped', 'planned', 'planned']);
  const { b, calls } = again(first.build.id, { maxBuildersFor: () => 1 });
  const frames = [];
  b.on('frame', (f) => frames.push(f));
  assert.deepEqual(await b.continue({ sections: ['hero'] }), { status: 'paused', reason: 'unfinished' });
  assert.deepEqual(names(calls), ['hero'], 'only hero spawned');
  assert.equal(existsSync(integrationFile(first.build.designId)), false, 'no integrate');
  assert.deepEqual(getBuild(first.build.id).sections.map((s) => s.status), ['done', 'planned', 'planned']);
  const settled = getBuild(first.build.id);
  const active = Date.parse(settled.endedAt) - Date.parse(settled.startedAt);
  await new Promise((r) => setTimeout(r, 300));
  const mark = frames.length;
  const c = b.continue();
  assert.deepEqual([frames[mark].type, frames[mark].status], ['design-build', 'building'], 'sent at once, past the 2 Hz hold');
  const shifted = Date.now() - Date.parse(getBuild(first.build.id).startedAt);
  assert.ok(Math.abs(shifted - active) < 150, `the second pause is left out too: ${shifted} vs ${active}`);
  assert.deepEqual(await c, { status: 'done', reason: null }, 'the same instance drives again');
  assert.deepEqual(names(calls), ['hero', 'features', 'pricing', 'work']);
});

test('a subset never finishes the round over a section still writing', async () => {
  const d = newDesign();
  const first = newBuild(d, { brief: 'MOCK_SECTIONS=2 MOCK_ASK_SECTION=hero MOCK_FAIL_SECTION=features' });
  const p = first.build.run();
  const q0 = await waitForFrame(first.frames, (f) => f.type === 'design-question');
  await waitForFrame(first.frames, (f) => f.type === 'design-section' && f.sectionId === 'features' && f.status === 'failed');
  first.build.pauseForDrain(); await p;
  rmSync(join(asksDir(d.id), `${q0.agentId}.json`));
  const { b, calls } = again(first.build.id);
  assert.deepEqual(await b.continue({ sections: ['features'] }), { status: 'paused', reason: 'unfinished' });
  assert.deepEqual(names(calls), ['features']);
  assert.equal(existsSync(integrationFile(d.id)), false, 'no integrate over the open section');
  close(first.build.id);
});

test('Continue before a plan held re-runs the lead on its own row, resuming its session', async () => {
  let cut = false;
  const haltLead = async (o) => {
    const r = await runClaude({ ...o, mock: true });
    if (!cut && o.maxTurns === 40) { cut = true; throw Object.assign(new Error('claude exited with code 1: mock usage limit'), { errorClass: 'usage_limit' }); }
    return r;
  };
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { runClaude: haltLead } });
  assert.deepEqual(await first.build.run(), { status: 'paused', reason: 'usage_limit' });
  assert.deepEqual(getBuild(first.build.id).sections, [], 'no plan was taken, though plan.json is on disk');
  const lead = listAgents(first.build.id)[0];
  const { b, calls, frames } = again(first.build.id);
  assert.equal(b.snapshot().plan.planRev, 0);
  const c = b.continue();
  assert.deepEqual([frames[0].type, frames[0].status], ['design-build', 'planning']);
  assert.deepEqual(await c, { status: 'done', reason: null });
  assert.deepEqual(names(calls), ['work', 'hero', 'work']);
  assert.equal(calls[0].resumeSessionId, lead.sessionId);
  assert.match(calls[0].prompt, /^Continue your task where you stopped\./);
  assert.equal(listAgents(first.build.id).filter((a) => a.role === 'lead').length, 1, 'L2.1: never a second lead row');
});

test('a lead question pending at a pause comes back on the lead row', async () => {
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_ASK_LEAD' });
  const p = first.build.run();
  const q0 = await waitForFrame(first.frames, (f) => f.type === 'design-question');
  first.build.pauseForDrain();
  assert.deepEqual(await p, { status: 'paused', reason: 'drain' });
  const { b, calls, frames } = again(first.build.id);
  const c = b.continue();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  assert.deepEqual([q.agentId, calls.length], [q0.agentId, 0]);
  assert.equal(framesOf(frames, 'design-agent').find((f) => f.agentId === q.agentId).status, 'waiting');
  b.answer(q.askId, [{ id: 'q1', value: 'a' }]);
  assert.deepEqual(await c, { status: 'done', reason: null });
  assert.equal(calls[0].resumeSessionId, listAgents(first.build.id)[0].sessionId);
  assert.equal(listAgents(first.build.id).filter((a) => a.role === 'lead').length, 1);
});

test('a rehydrated build reads its figures from the rows and the disk', async () => {
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_FAIL_SECTION=features' });
  assert.deepEqual(await first.build.run(), { status: 'paused', reason: 'failed' });
  const live = first.build.snapshot();
  const { b, calls, frames } = again(first.build.id);
  const s = b.snapshot();
  assert.deepEqual([s.plan.planRev, s.plan.canvas], [1, live.plan.canvas]);
  assert.deepEqual(s.sections, live.sections);
  assert.ok(s.build.stats.layers > 0);
  assert.equal(s.build.stats.layers, live.build.stats.layers, 'layers counted from the landed section HTML');
  assert.equal(s.build.stats.elapsedMs, live.build.stats.elapsedMs, 'a settled build counts to its endedAt');
  assert.equal(s.build.stats.agentsTotal, 3);
  assert.deepEqual(s.agents.map((a) => [a.agentId, a.status, a.costUsd]), live.agents.map((a) => [a.agentId, a.status, a.costUsd]));
  assert.equal(s.build.stats.costKnown, true);
  const before = getBuild(first.build.id);
  assert.deepEqual(await b.run(), { status: 'paused', reason: 'failed' }, 'run() on a rehydrated build drives nothing');
  assert.deepEqual([calls.length, frames.length], [0, 0]);
  assert.deepEqual(getBuild(first.build.id), before);
  const hero = listAgents(first.build.id).find((a) => a.sectionId === 'hero');
  updateAgent(hero.id, { costKnown: false });
  const u = again(first.build.id).b.snapshot();
  assert.equal(u.agents.find((a) => a.agentId === hero.id).costKnown, false, 'an unknown cost stays unknown');
  assert.equal(u.build.stats.costKnown, false);
  close(first.build.id);
});

test('rev and seq keep rising across a Continue, and the base lands before any splice', async () => {
  const P = 'sections/hero/index.html';
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_HANG_SECTION=hero' });
  const p = first.build.run();
  await waitForFrame(first.frames, (f) => f.type === 'design-delta' && f.sectionId === 'hero');
  await first.build.stop('user'); await p;
  const lastRev = first.frames.filter((f) => f.path === P && (f.type === 'design-delta' || f.type === 'design-file')).at(-1).rev;
  const { b, frames } = again(first.build.id);
  assert.deepEqual(await b.continue(), { status: 'done', reason: null });
  assert.equal(frames[0].type, 'design-build');
  assert.equal(frames[0].status, 'building', 'the new status, never the stale terminal one');
  assert.ok(frames[0].seq > first.frames.at(-1).seq);
  assert.ok(frames.every((f, i) => i === 0 || f.seq === frames[i - 1].seq + 1), 'seq has no gap');
  const hero = frames.filter((x) => x.path === P && (x.type === 'design-delta' || x.type === 'design-file'));
  assert.deepEqual([hero[0].type, hero[0].text], ['design-file', ''], 'the stopped draft landed as the base');
  assert.ok(hero[0].rev > lastRev);
  assert.deepEqual(hero.map((x) => x.rev), hero.map((_, i) => hero[0].rev + i), 'no gap after the base');
  assert.ok(hero.some((x) => x.type === 'design-delta'), 'deltas follow the base');
});

test('Continue after the CLI lost the session starts that agent fresh', async () => {
  const d = newDesign();
  const first = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_HANG_SECTION=hero MOCK_COST=0.25 MOCK_PRICED' });
  const p = first.build.run();
  await waitForFrame(first.frames, (f) => f.type === 'design-delta' && f.sectionId === 'hero');
  await first.build.stop('user'); await p;
  const hero = listAgents(first.build.id).find((a) => a.sectionId === 'hero');
  near(hero.costUsd, 0.007, 'the cut booked its priced usage');
  mockDesignTesting.lost.add(hero.sessionId);
  const { b, calls } = again(first.build.id);
  assert.deepEqual(await b.continue(), { status: 'done', reason: null });
  mockDesignTesting.lost.delete(hero.sessionId);
  const heroCalls = calls.filter((c) => c.cwd.endsWith('hero'));
  assert.ok(heroCalls[0].resumeSessionId);
  assert.equal(heroCalls[1].resumeSessionId, undefined);
  assert.match(heroCalls[1].prompt, /^Section: hero$/m, 'the full first prompt');
  const led = prepare('SELECT SUM(amount_usd) s FROM design_cost_ledger WHERE agent_id = ?').get(hero.id).s;
  near(led, 0.007 + 0.25, 'the cut once, then the fresh session in full: not netted against the lost one, not booked twice');
  near(listAgents(first.build.id).find((a) => a.sectionId === 'hero').costUsd, 0.257, 'the row agrees with the ledger');
  assert.equal(listAgents(first.build.id).filter((a) => a.sectionId === 'hero').length, 1);
});

test('M3: after a lost session, a rehydrate meters the fresh session alone: the ledger books every session in full', async () => {
  const d = newDesign();
  const cap = 10; const readCaps = async () => ({ perRunCapUsd: cap, totalCapUsd: null });
  const first = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero MOCK_COST=0.25', deps: { readCaps } });
  assert.deepEqual(await first.build.run(), { status: 'paused', reason: 'failed' });
  const hero = listAgents(first.build.id).find((a) => a.sectionId === 'hero');
  near(hero.costUsd, 0.25, 'the first session booked its failed process');
  mockDesignTesting.lost.add(hero.sessionId);
  // The fresh session's first process builds, then leaves a question: the round waits on it.
  let fresh = null;
  const askAfterFresh = async (o) => {
    const r = await runClaude({ ...o, mock: true });
    if (o.cwd.endsWith(`${sep}hero`) && !o.resumeSessionId && !fresh) {
      fresh = o;
      writeFileSync(join(asksDir(d.id), `${hero.id}.json`), JSON.stringify({ questions: [{ id: 'q1', text: 'Tone?', why: 'mock', options: [{ label: 'Calm', value: 'a' }, { label: 'Bold', value: 'b' }] }] }));
    }
    return r;
  };
  const one = again(first.build.id, { readCaps, runClaude: askAfterFresh });
  const c1 = one.b.continue();
  await waitForFrame(one.frames, (f) => f.type === 'design-question');
  mockDesignTesting.lost.delete(hero.sessionId);
  assert.ok(fresh, 'the lost resume started a fresh session');
  one.b.pauseForDrain();
  assert.deepEqual(await c1, { status: 'paused', reason: 'drain' });
  near(getAgent(hero.id).costUsd, 0.5, 'the fresh session booked its first process');
  const spent = getBuild(first.build.id).costUsd;
  const two = again(first.build.id, { readCaps });
  const c2 = two.b.continue();
  const q = await waitForFrame(two.frames, (f) => f.type === 'design-question');
  two.b.answer(q.askId, [{ id: 'q1', value: 'b' }]);
  assert.deepEqual(await c2, { status: 'done', reason: null });
  const resume = two.calls.find((o) => o.cwd.endsWith(`${sep}hero`));
  assert.equal(resume.resumeSessionId, getAgent(hero.id).sessionId, 'the answer resumes the fresh session');
  near(resume.maxBudgetUsd, cap - spent + 0.25, 'the flag adds back only the fresh session\'s own total');
  const led = prepare('SELECT SUM(amount_usd) s FROM design_cost_ledger WHERE agent_id = ?').get(hero.id).s;
  near(led, 0.75, 'the lost session, then the fresh one in full: its resume is never netted against the lost one');
  near(getAgent(hero.id).costUsd, 0.75, 'the row agrees with the ledger');
});

test('M3: the fresh session\'s total survives its agent ending with a failed section', async () => {
  const d = newDesign();
  const first = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero MOCK_COST=0.25' });
  assert.deepEqual(await first.build.run(), { status: 'paused', reason: 'failed' });
  const hero = listAgents(first.build.id).find((a) => a.sectionId === 'hero');
  mockDesignTesting.lost.add(hero.sessionId);
  // The fresh session's first process books, then its index.html goes: the section fails, its agent ends error.
  let fresh = false;
  const failAfterFresh = async (o) => {
    const r = await runClaude({ ...o, mock: true });
    if (o.cwd.endsWith(`${sep}hero`) && !o.resumeSessionId && !fresh) { fresh = true; rmSync(join(o.cwd, 'index.html'), { force: true }); }
    return r;
  };
  const one = again(first.build.id, { runClaude: failAfterFresh });
  assert.deepEqual(await one.b.continue(), { status: 'paused', reason: 'failed' });
  mockDesignTesting.lost.delete(hero.sessionId);
  assert.equal(getAgent(hero.id).status, 'error');
  const two = again(first.build.id);
  assert.deepEqual(await two.b.continue(), { status: 'done', reason: null });
  assert.ok(two.calls.find((o) => o.cwd.endsWith(`${sep}hero`)).resumeSessionId, 'the fresh session resumes');
  const led = prepare('SELECT SUM(amount_usd) s FROM design_cost_ledger WHERE agent_id = ?').get(hero.id).s;
  near(led, 0.75, 'every session in full');
});

test('a question pending at restart comes back with no spawn, then resumes', async () => {
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero' });
  const p = first.build.run();
  const q0 = await waitForFrame(first.frames, (f) => f.type === 'design-question');
  first.build.pauseForDrain(); await p;
  crash(first.build.id); recoverDesignBuilds();
  const heroRow = listAgents(first.build.id).find((a) => a.sectionId === 'hero');
  assert.equal(heroRow.status, 'interrupted');
  const { b, calls, frames } = again(first.build.id);
  const c = b.continue();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  assert.equal(calls.length, 0);
  assert.notEqual(q.askId, q0.askId, 'asked again under a fresh askId');
  assert.equal(q.agentId, heroRow.id);
  assert.equal(framesOf(frames, 'design-agent').find((f) => f.agentId === heroRow.id).status, 'waiting', 'written waiting, never starting: no process runs');
  assert.equal(getAgent(heroRow.id).status, 'waiting');
  assert.ok(frames.slice(0, frames.indexOf(q)).some((f) => f.type === 'design-build' && f.waiting === 1), 'the waiting count reached the client before the question');
  b.answer(q.askId, [{ id: 'q1', value: 'a' }]);
  assert.equal((await c).status, 'done');
  assert.equal(calls[0].resumeSessionId, heroRow.sessionId, 'the answer resumes the session');
});

test('a question pending at a pause re-enters whatever {sections} names', async () => {
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_ASK_SECTION=hero MOCK_FAIL_SECTION=features' });
  const p = first.build.run();
  const q0 = await waitForFrame(first.frames, (f) => f.type === 'design-question');
  await waitForFrame(first.frames, (f) => f.type === 'design-section' && f.sectionId === 'features' && f.status === 'failed');
  first.build.pauseForDrain();
  assert.deepEqual(await p, { status: 'paused', reason: 'drain' });
  assert.deepEqual(getBuild(first.build.id).sections.map((s) => s.status), ['writing', 'failed'], 'L2.29: the waiting section stays writing');
  const { b, calls, frames } = again(first.build.id);
  const c = b.continue({ sections: ['features'] });
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  assert.equal(q.agentId, q0.agentId);
  b.answer(q.askId, [{ id: 'q1', value: 'b' }]);
  assert.deepEqual(await c, { status: 'done', reason: null });
  assert.deepEqual(names(calls), ['features', 'hero', 'work']);
});

test('Continue refusals', async () => {
  const done = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1' });
  assert.deepEqual(await done.build.run(), { status: 'done', reason: null });
  const finishedMsg = { status: 409, message: 'This build has nothing left to continue' };
  assert.throws(() => again(done.build.id).b.continue(), finishedMsg, 'a done build, reason null');
  assert.throws(() => done.build.continue(), finishedMsg, 'the live instance too');
  rmSync(integrationFile(done.build.designId));
  assert.throws(() => again(done.build.id).b.continue(), finishedMsg, 'done, whatever the disk would allow');

  const d = newDesign();
  const old = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero' });
  await old.build.run();
  await old.build.stop('user');
  const newer = newBuild(d, { brief: 'MOCK_SECTIONS=1' });
  assert.throws(() => again(old.build.id).b.continue(), { status: 409, message: 'A newer round of this design exists' }, 'no longer the current build');
  close(newer.build.id);

  const paused = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero' });
  await paused.build.run();
  const blocked = again(paused.build.id, { budgetStatus: () => ({ blocked: true }) });
  assert.throws(() => blocked.b.continue(), { status: 403, message: 'total cost limit reached' });
  assert.equal(blocked.calls.length, 0);
  assert.equal(getBuild(paused.build.id).status, 'paused');
  close(paused.build.id);

  const finished = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1' });
  await finished.build.run();
  updateBuild(finished.build.id, { status: 'stopped', reason: 'user' });
  assert.throws(() => again(finished.build.id).b.continue(), { status: 409, message: 'Nothing to continue' }, 'every section done and integrated');

  const live = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_HANG_SECTION=hero' });
  const p = live.build.run();
  await waitForFrame(live.frames, (f) => f.type === 'design-delta' && f.sectionId === 'hero');
  assert.throws(() => live.build.continue(), { status: 409, message: 'This build is running' }, 'a running build');
  assert.throws(() => again(live.build.id).b.continue(), finishedMsg, 'a running build, rehydrated: its row is not a pause');
  await live.build.stop('user'); await p;
});

test('Continue after a total-limit pause carries on only once the cap in Settings is raised, and counts the session', async () => {
  let cap = 0.5; const readCaps = async () => ({ perRunCapUsd: cap, totalCapUsd: null });
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_COST=0.3', deps: { maxBuildersFor: () => 1, readCaps } });
  assert.deepEqual(await first.build.run(), { status: 'paused', reason: 'total-limit' });
  const same = again(first.build.id, { maxBuildersFor: () => 1, readCaps });
  assert.deepEqual(await same.b.continue(), { status: 'paused', reason: 'total-limit' });
  assert.equal(same.calls.length, 0, 'the cap is still at or below the spend: nothing spawns');
  cap = 5;
  const { b, calls } = again(first.build.id, { maxBuildersFor: () => 1, readCaps });
  assert.equal((await b.continue()).status, 'done');
  assert.ok(Math.abs(calls[0].maxBudgetUsd - 4.4) < 1e-9, 'a fresh builder: remaining 5 - 0.6');
  assert.ok(Math.abs(calls.at(-1).maxBudgetUsd - 4.4) < 1e-9, 'the lead resumes: remaining 4.1 + its session 0.3');
});

test('a halt during the rework cycle integrates again on Continue', async () => {
  let cap = 1; const readCaps = async () => ({ perRunCapUsd: cap, totalCapUsd: null });
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_COST=0.3 MOCK_REWORK=hero', deps: { readCaps } });
  assert.deepEqual(await first.build.run(), { status: 'paused', reason: 'total-limit' });
  assert.deepEqual(names(first.calls), ['work', 'hero', 'work', 'hero'], 'the rework booking crossed the cap');
  assert.equal(existsSync(integrationFile(first.build.designId)), false, 'integration.json removed, so the rework list is not lost');
  cap = 5;
  const { b, calls } = again(first.build.id, { readCaps });
  assert.deepEqual(await b.continue(), { status: 'done', reason: null });
  assert.deepEqual(names(calls), ['work', 'hero'], 'integrate again, then its rework');
});

test('a throw during the rework cycle integrates again on Continue', async () => {
  let n = 0;
  const acquireGlobal = async () => { n += 1; if (n === 4) throw new Error('slot table broke'); };
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_REWORK=hero', deps: { acquireGlobal } });
  assert.deepEqual(await first.build.run(), { status: 'error', reason: 'engine-error' });
  assert.deepEqual(names(first.calls), ['work', 'hero', 'work'], 'the rework spawn never started');
  assert.equal(existsSync(integrationFile(first.build.designId)), false);
  const { b, calls } = again(first.build.id);
  assert.deepEqual(await b.continue(), { status: 'done', reason: null });
  assert.deepEqual(names(calls), ['hero', 'work', 'hero'], 'the cut rework section, then integrate again and its rework');
});

test('a halt during integrate, after the lead wrote integration.json, integrates again on Continue', async () => {
  const d = newDesign();
  let held = null;
  const hangIntegrate = (o) => {
    if (o.maxTurns !== 15 || held) return runClaude({ ...o, mock: true });
    writeFileSync(integrationFile(d.id), '{"v":1,"done":true,"rework":[]}\n');
    held = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('hung')), 10000);
      o.signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
    });
    return held;
  };
  const first = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { runClaude: hangIntegrate } });
  const p = first.build.run();
  await waitUntil(() => held && first.build.runningCount > 0);
  first.build.pauseForDrain();
  assert.deepEqual(await p, { status: 'paused', reason: 'drain' });
  assert.equal(existsSync(integrationFile(d.id)), false, 'removed');
  const { b, calls } = again(first.build.id);
  assert.deepEqual(await b.continue(), { status: 'done', reason: null });
  assert.deepEqual(names(calls), ['work']);
  assert.ok(existsSync(join(distDir(d.id), 'index.html')));
});

test('stop closes a settled paused build, with a terminal frame, so a delete can follow', async () => {
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero' });
  await first.build.run();
  const { b, frames } = again(first.build.id);
  assert.equal(b.pauseForDrain(), false, 'a rehydrated build starts settled');
  await b.stop('user');
  assert.deepEqual([getBuild(first.build.id).status, getBuild(first.build.id).reason], ['stopped', 'user']);
  assert.equal(framesOf(frames, 'design-build').at(-1).status, 'stopped');
});

test('elapsed time leaves out the pause', async () => {
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero' });
  assert.deepEqual(await first.build.run(), { status: 'paused', reason: 'failed' });
  const T = Date.now() - 60000;
  updateBuild(first.build.id, { startedAt: iso(T), endedAt: iso(T + 10000) });
  const { b, frames } = again(first.build.id);
  assert.equal(b.snapshot().build.stats.elapsedMs, 10000, 'paused: counted to endedAt');
  const t0 = Date.now();
  const c = b.continue();
  const row = getBuild(first.build.id);
  assert.deepEqual([row.status, row.reason, row.endedAt], ['building', null, null]);
  assert.ok(Math.abs(Date.parse(row.startedAt) - (t0 - 10000)) < 1000, `startedAt = now - 10000: ${row.startedAt}`);
  assert.ok(Math.abs(frames[0].stats.elapsedMs - 10000) < 1000, `elapsedMs starts near 10000: ${frames[0].stats.elapsedMs}`);
  assert.deepEqual(await c, { status: 'done', reason: null });

  const open = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero' });
  await open.build.run();
  const startedAt = updateBuild(open.build.id, { endedAt: null }).startedAt;
  const r = again(open.build.id);
  const rc = r.b.continue();
  assert.ok(Math.abs(Date.parse(getBuild(open.build.id).startedAt) - Date.parse(startedAt)) < 1000, 'a row paused without endedAt: no shift, no throw');
  assert.deepEqual(await rc, { status: 'done', reason: null });
});

test('a section done before a stop is not redone; a stopped one is', async () => {
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_HANG_SECTION=features' });
  const p = first.build.run();
  await waitForFrame(first.frames, (f) => f.type === 'design-delta' && f.sectionId === 'features');
  await waitForFrame(first.frames, (f) => f.type === 'design-section' && f.sectionId === 'hero' && f.status === 'done');
  assert.equal(first.build.stopAgent(listAgents(first.build.id).find((a) => a.sectionId === 'features').id), true);
  assert.deepEqual(await p, { status: 'done', reason: 'partial' });
  const mark = first.calls.length;
  assert.deepEqual(await first.build.continue(), { status: 'done', reason: null }, 'the live instance continues too');
  assert.deepEqual(names(first.calls.slice(mark)), ['features'], 'integration already ran');
  assert.deepEqual(getBuild(first.build.id).sections.map((s) => s.status), ['done', 'done']);
});

test('an agent stopped before a Continue on the same instance can be stopped again', async () => {
  const hangHero = (o) => {
    if (!o.cwd.endsWith(`${sep}hero`)) return runClaude({ ...o, mock: true });
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('hung')), 3000);
      o.signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
    });
  };
  const first = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2', deps: { runClaude: hangHero } });
  const heroAgent = () => listAgents(first.build.id).find((a) => a.sectionId === 'hero');
  const p = first.build.run();
  await waitUntil(() => heroAgent() && first.build.runningCount > 0);
  first.build.stopAgent(heroAgent().id);
  assert.deepEqual(await p, { status: 'done', reason: 'partial' });
  const mark = first.calls.length;
  const c = first.build.continue();
  await waitUntil(() => first.calls.length > mark && first.build.runningCount > 0);
  assert.equal(first.build.stopAgent(heroAgent().id), true);
  assert.deepEqual(await c, { status: 'done', reason: 'partial' }, 'the second stop took: not a 3 s hang failing the section');
  assert.equal(heroAgent().status, 'stopped');
});

test('setFast on a rehydrated build uses the design row', async () => {
  const d = newDesign({ fast: false });
  const first = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero' });
  await first.build.run();
  updateDesign(d.id, { fast: true });
  const seen = [];
  const { b } = again(first.build.id, { maxBuildersFor: (fast) => { seen.push(fast); return 3; } });
  assert.deepEqual(seen, [true]);
  b.setFast(false);
  assert.deepEqual(seen, [true, false]);
  await b.stop('user');
  assert.equal(getBuild(first.build.id).status, 'stopped');
});

test('an unknown build: rehydrate answers null', () => {
  assert.equal(DesignBuild.rehydrate({ buildId: 'b_000000000000' }), null);
  assert.equal(DesignBuild.rehydrate({ buildId: 42 }), null);
  assert.equal(DesignBuild.rehydrate(), null);
});
