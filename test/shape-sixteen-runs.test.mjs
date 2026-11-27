// test/shape-sixteen-runs.test.mjs — Slice 1 (R-arch-5): several live runs of one feature, replayed on the real 16-run
// feature (test/helpers/shape-sixteen-runs.mjs). Each moment asserts the scheduler's own answer (sliceGateState).
// Slice 2 adds the payload tests (T1 to T7): the waitsFor, cannotStart and nextTurn that src/core/shape/features.mjs
// sends in featureView and the Runs list.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { withEnv as withEnvVars } from './helpers/with-env.mjs';
import { getDb } from '../src/core/db.mjs';
import { chainBaseBranchesOf, createTicket, getTicket, predecessorState, previousBranchesOf, workBranchOf } from '../src/core/scheduler.mjs';
import { listRunGroups } from '../src/core/run-groups.mjs';
import { busySliceOf, featureView, liveSliceFrom, resumeFeature, setApproveEach, sliceGateState, sliceOfPipeline,
  clashHoldOf, dependencyBranchesOf, featureBase, featureHoldsTicket, setClashHold, smallRunsPrBase, stackedPrBase, ticketHeld, replanRest } from '../src/core/shape/features.mjs';
// Slice 5: a namespace read, so a missing new export fails only its own test, not the whole file.
import * as SF from '../src/core/shape/features.mjs';
import { sliceChainGate, heldStopTurn, latestFinishedSource, sliceSourceOf, sliceCombineGate, combineDependencies, createHeldStops } from '../src/core/shape/chain.mjs';
import { gateStop } from '../src/shared/shape/run-stops.mjs';
import { SIXTEEN_RUN_LINKS, sixteenRunFeature, siblingRunsFeature, startable, world, SIXTEEN_RUN_STATES,
  siblingKit, commitFile, writeShared, head, probeEnv, isAncestorExit, minute, record } from './helpers/shape-sixteen-runs.mjs';
import { runStatus, namedWaits } from '../src/shared/shape/run-status.mjs';
// Slice 6: a namespace read, so a missing new export fails only its own test, not the whole file.
import * as RS from '../src/shared/shape/run-status.mjs';
import { projectKey } from '../src/core/store.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { g, GITCONFIG } from './helpers/base-world.mjs';
import { mergeBaseInto } from '../src/core/git-sync.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';

useTempHome(after, 'worca-shape-sixteen-');
const root = mkdtempSync(join(tmpdir(), 'worca-shape-sixteen-proj-'));
after(() => rmSync(root, { recursive: true, force: true }));
before(() => { getDb(); });
// File-wide: every git command in this file (the missing-work tests' real repos) reads a temp global config, not the
// machine's, and the variables are restored when the file ends.
const GIT_ENV = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'];
const gitEnvBefore = Object.fromEntries(GIT_ENV.map((k) => [k, process.env[k]]));
before(() => {
  process.env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  writeFileSync(process.env.GIT_CONFIG_GLOBAL, GITCONFIG);
});
after(() => {
  for (const [k, v] of Object.entries(gitEnvBefore)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const M1 = { 1: { stop: 'requirement' } };
const M3_DONE = [1];
const M3 = { 9: { stop: 'check' }, 11: { stop: 'check' }, 2: { stop: 'requirement' } };
const M4_DONE = [1, 2, 3, 4, 9, 11];

test('the fixture links equal the stored outline of the feature (16 runs)', () => {
  const fx = world(root, { done: [1] });
  const outline = JSON.parse(getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(fx.featureId).outline);
  const runOf = new Map(outline.slices.map((s, i) => [s.id, i + 1]));
  assert.equal(SIXTEEN_RUN_LINKS.length, 16);
  assert.deepEqual(outline.slices.map((s) => ({ run: runOf.get(s.id), dependsOn: s.dependsOn.map((d) => runOf.get(d)) })),
    SIXTEEN_RUN_LINKS.map((l) => ({ run: l.run, dependsOn: [...l.dependsOn] })));
  // Only run 12 builds on run 7 (slice 11: run 7's "Needed by" reads 12).
  assert.deepEqual(SIXTEEN_RUN_LINKS.filter((l) => l.dependsOn.includes(7)).map((l) => l.run), [12]);
});

test('M1: run 1 at an open requirement stop frees the turn: only run 9 may start', () => {
  assert.deepEqual(startable(world(root, { done: [], states: M1 })), [9]);
});

test('M2: runs 1 and 9 at open stops: run 11 starts', () => {
  assert.deepEqual(startable(world(root, { done: [], states: { ...M1, 9: { stop: 'check' } } })), [11]);
});

test('M3: run 1 done, runs 9, 11 and 2 at open stops: run 3 starts', () => {
  assert.deepEqual(startable(world(root, { done: M3_DONE, states: M3 })), [3]);
});

test('M4: run 5 paused frees the turn: run 8 starts (10 and 13 wait behind the lower number)', () => {
  assert.deepEqual(startable(world(root, { done: M4_DONE, states: { 5: { pipe: 'paused' } } })), [8]);
});

test('M5a (slice 5, R-po-3): run 8 being resumed at boot holds the turn: its row reads paused and nothing starts', () => withEnvVars(ON, () => {
  const fx = world(root, { done: M4_DONE, states: { 5: { pipe: 'paused' }, 8: { pipe: 'paused', resuming: true } } });
  assert.equal(getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(fx.pipelineOf(8)).status, 'paused');
  assert.equal(featureView(fx.featureId, { live: fx.live }).slices.find((s) => s.index === 8).state, 'paused');
  assert.equal(fx.live(fx.pipelineOf(8)).resuming, true);
  assert.deepEqual(startable(fx), []);
}));

test('M5b (stop answer): runs 8 and 10 going while run 5 is paused: nothing starts; a stop answer of run 5 would wait for run 8', () => {
  const fx = world(root, { done: M4_DONE, states: { 5: { pipe: 'paused' }, 8: { pipe: 'running' }, 10: { pipe: 'running' } } });
  assert.deepEqual(startable(fx), []);
  assert.deepEqual(busySliceOf(fx.featureId, { exclude: 5, live: fx.live }), { index: 8 });
  assert.deepEqual(heldStopTurn(fx.featureId, 5, { live: fx.live }), { due: false, after: 8 });
});

test('contrast (D3): M3 with run 2\'s stop held keeps the slot: nothing starts', () => {
  assert.deepEqual(startable(world(root, { done: M3_DONE, states: { ...M3, 2: { stop: 'requirement', held: true } } })), []);
});

test('contrast (D3): M3 with run 2 asking a non-stop question keeps the slot: nothing starts', () => {
  assert.deepEqual(startable(world(root, { done: M3_DONE, states: { ...M3, 2: { asking: true } } })), []);
});

test('flag off: sliceChainGate answers null for every not-started run (dev\'s gate decides)', () => withEnvVars({ WORCA_FLAGS: undefined }, () => {
  const fx = world(root, { done: M3_DONE, states: M3 });
  for (let run = 2; run <= 16; run++) {
    assert.equal(sliceChainGate(getTicket(fx.ticketOf(run)), {}, { flagEnabled: () => false }), null, `run ${run}`);
  }
  // On, the same ticket gets the scheduler's answer.
  assert.equal(sliceChainGate(getTicket(fx.ticketOf(3)), { live: fx.live }, { flagEnabled: () => true }).state, 'ok');
}));

// ---- Slice 2: the server sends waitsFor, cannotStart and nextTurn (R-arch-2, R-po-2) ----
const ON = { WORCA_FLAGS: 'shaperSmallRuns' };
const views = (fx) => {
  const view = featureView(fx.featureId, { live: fx.live }).slices;
  const group = listRunGroups({ live: fx.live }).find((g) => g.id === fx.featureId);
  const members = new Map(group.members.map((m) => [m.position, m.slice]));
  return { view: new Map(view.map((s) => [s.index, s])), members };
};
const turnRuns = (map) => [...map].filter(([, s]) => s && s.nextTurn).map(([run]) => run);
const gate = (fx, run) => sliceGateState(getTicket(fx.ticketOf(run)), { live: fx.live });
const NOT_STARTED = new Set(['planned', 'held']);

test('T1 (R-qa-8): base state: run 12 waits for [7, 10], run 7 for [2..6], in featureView and the Runs list alike', () => withEnvVars(ON, () => {
  const { view, members } = views(world(root, 'base'));
  for (const m of [view, members]) {
    assert.deepEqual(m.get(12).waitsFor, [7, 10]);
    assert.deepEqual(m.get(7).waitsFor, [2, 3, 4, 5, 6]);
    assert.deepEqual(m.get(13).waitsFor, []);
    assert.equal('nextTurn' in m.get(13), false);
    assert.deepEqual(turnRuns(m), [9]);
  }
}));

test('T2 (R-qa-7): busy state: exactly one run carries nextTurn, run 9, in both payloads; run 10 (also free) has none', () => withEnvVars(ON, () => {
  const { view, members } = views(world(root, 'busy'));
  for (const m of [view, members]) {
    assert.deepEqual(turnRuns(m), [9]);
    assert.deepEqual(m.get(10).waitsFor, []);
    assert.equal('nextTurn' in m.get(10), false);
  }
}));

test('T3 (R-qa-9): over every not-started run, waitsFor equals what the gate holds on, and the gate agrees', () => withEnvVars(ON, () => {
  // Each world is built just before it is walked: building one cancels the previous feature's scheduled tickets.
  const specs = ['base', 'busy', { done: [], states: M1 }, { done: [], states: { ...M1, 9: { stop: 'check' } } },
    { done: M3_DONE, states: M3 }, { done: M4_DONE, states: { 5: { pipe: 'paused' } } }];
  let checked = 0;
  for (const spec of specs) {
    const fx = world(root, spec);
    const { view, members } = views(fx);
    const rows = getDb().prepare('SELECT idx, ticket_id, pipeline_id FROM shape_feature_slices WHERE feature_id = ?').all(fx.featureId);
    const ref = (run) => { const r = rows.find((x) => x.idx === run); return r.ticket_id ? { kind: 'ticket', id: r.ticket_id } : { kind: 'pipeline', id: r.pipeline_id }; };
    for (const { run, dependsOn } of SIXTEEN_RUN_LINKS) {
      const s = view.get(run);
      if (!NOT_STARTED.has(s.state)) continue;
      const oracle = dependsOn.filter((d) => { const p = predecessorState(ref(d), { policy: 'done' }); return p.state === 'waiting' || (p.state === 'bad' && ['stopped', 'error', 'interrupted'].includes(p.status)); }).sort((a, b) => a - b);
      assert.deepEqual(s.waitsFor, oracle, `run ${run} waitsFor`);
      const g = gate(fx, run)?.state;
      if (s.cannotStart) assert.equal(g, 'bad', `run ${run} gate`);
      else if (oracle.length) assert.equal(g, 'waiting', `run ${run} gate`);
      for (const k of ['waitsFor', 'cannotStart', 'nextTurn']) assert.deepEqual(members.get(run)[k], s[k], `run ${run} member ${k}`);
      checked++;
    }
  }
  assert.ok(checked > 40, `walked ${checked} runs`);
}));

test('T4 (R-qa-11): with no answer held, nextTurn is the scheduler\'s start once nothing delays it; a held answer has it', () => withEnvVars(ON, () => {
  const busy = world(root, { done: [1, 3], states: { ...SIXTEEN_RUN_STATES.busy.states, 6: { pipe: 'paused' } } });
  assert.deepEqual(startable(busy), [9]);
  assert.deepEqual(turnRuns(views(busy).view), [9]);
  const m1 = world(root, { done: [], states: M1 });
  assert.deepEqual(turnRuns(views(m1).view), [startable(m1)[0]]);
  const m4 = world(root, { done: M4_DONE, states: { 5: { pipe: 'paused' } } });
  assert.deepEqual(turnRuns(views(m4).view), [8]);
  // Owner direction dd8aea6ed: run 2's answer is held waiting its turn, so run 2 goes on next, not run 3.
  const held = world(root, { done: M3_DONE, states: { ...M3, 2: { stop: 'requirement', held: true } } });
  const { view, members } = views(held);
  assert.deepEqual(turnRuns(view), [2]);
  assert.deepEqual(turnRuns(members), [2]);
  const cleared = world(root, { done: M3_DONE, states: M3 });
  assert.deepEqual(startable(cleared), [3]);
  assert.deepEqual(turnRuns(views(cleared).view), [3]);
}));

test('T4b (owner direction dd8aea6ed): run 2\'s answer held while run 3 builds, free runs waiting: nextTurn is run 2, in both payloads', () => withEnvVars(ON, () => {
  const fx = world(root, { done: [1], states: { 2: { stop: 'requirement', held: true }, 3: { pipe: 'running' } } });
  const { view, members } = views(fx);
  for (const m of [view, members]) {
    assert.deepEqual(m.get(2).stop.held, true);
    for (const r of [9, 11]) assert.deepEqual(m.get(r).waitsFor, [], `run ${r} is free`);
    assert.deepEqual(turnRuns(m), [2]);
  }
  // Without the held answer, the lowest free run has the turn.
  assert.deepEqual(turnRuns(views(world(root, { done: [1], states: { 2: { stop: 'requirement' }, 3: { pipe: 'running' } } })).view), [9]);
}));

test('T4c (D9): with "Ask me before each run" on, no run carries nextTurn in either payload', () => withEnvVars(ON, () => {
  const fx = world(root, 'base');
  setApproveEach(fx.featureId, true);
  const { view, members } = views(fx);
  assert.deepEqual(turnRuns(view), []);
  assert.deepEqual(turnRuns(members), []);
}));

test('T5 (R-qa-10): a canceled dependency: cannotStart, never nextTurn; the canceled run itself carries neither', () => withEnvVars(ON, () => {
  const fx = world(root, { done: [1], states: { 2: { stop: 'requirement' } } });
  fx.cancelTicket(3);
  const { view, members } = views(fx);
  for (const m of [view, members]) {
    assert.deepEqual(m.get(4).cannotStart, { run: 3, reason: 'was canceled' });
    assert.equal('nextTurn' in m.get(4), false);
    for (const r of [5, 6, 7, 10]) assert.equal(m.get(r).cannotStart.run, 3, `run ${r}`);
    assert.deepEqual(m.get(12).waitsFor, [7, 10]);
    assert.equal('cannotStart' in m.get(12), false);
    for (const k of ['waitsFor', 'cannotStart', 'nextTurn']) assert.equal(k in m.get(3), false, `run 3 ${k}`);
    assert.deepEqual(turnRuns(m), [9]);
    for (const [run, s] of m) if (s.cannotStart) assert.equal('nextTurn' in s, false, `run ${run}`);
  }
  for (const r of [4, 5, 6, 7, 10]) assert.equal(gate(fx, r).state, 'bad', `gate ${r}`);
}));

test('T6: flag off, or an unmarked feature: no new keys, and the members carry no slice', () => {
  const fx = world(root, 'busy');
  withEnvVars({ WORCA_FLAGS: undefined }, () => {
    const slices = featureView(fx.featureId, { live: fx.live }).slices;
    for (const s of slices) for (const k of ['cannotStart', 'nextTurn']) assert.equal(k in s, false, `${s.index} ${k}`);
    const pick = (s) => Object.fromEntries(['index', 'state', 'kind', 'stop', 'waitsFor'].filter((k) => k in s).map((k) => [k, s[k]]));
    const P = (index, state, more = {}) => ({ index, state, kind: null, ...more });
    const open = (reason) => ({ stop: { reason, held: false } });
    // Characterization: the flag-off output of the untouched stopWords branch (single-number waitsFor).
    assert.deepEqual(slices.map(pick), [
      P(1, 'done'), P(2, 'approval', open('requirement')), P(3, 'done'), P(4, 'questions', open('check')), P(5, 'error'),
      P(6, 'starting'), P(7, 'planned', { waitsFor: 2 }), P(8, 'planned', { waitsFor: 2 }), P(9, 'planned'), P(10, 'planned'),
      P(11, 'questions', open('check')), P(12, 'planned'), P(13, 'planned', { waitsFor: 11 }), P(14, 'planned', { waitsFor: 11 }),
      P(15, 'planned'), P(16, 'planned', { waitsFor: 11 }),
    ]);
    const g = listRunGroups({ live: fx.live }).find((x) => x.id === fx.featureId);
    assert.ok(g.members.every((m) => !('slice' in m)));
  });
  getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
  const plain = sixteenRunFeature({ projectDir: root, smallRuns: false });
  withEnvVars(ON, () => {
    for (const s of featureView(plain.featureId).slices) for (const k of ['stop', 'waitsFor', 'cannotStart', 'nextTurn']) assert.equal(k in s, false, `${s.index} ${k}`);
  });
});

test('T7 (R-qa-12): a free change run takes nextTurn before a lower-numbered free run', () => withEnvVars(ON, () => {
  const fx = world(root, 'base');
  fx.setKind(13, 'change');
  const { view, members } = views(fx);
  assert.deepEqual(turnRuns(view), [13]);
  assert.deepEqual(turnRuns(members), [13]);
}));

// ---- Slice 3: the shared run status phrase on the real payloads (R-po-1, R-po-3) ----
const statusOf = (m, run) => runStatus({ slice: m.get(run), slices: m });
const nextRuns = (m) => [...m.keys()].filter((r) => statusOf(m, r).word === 'next');

test('S3-T1 base: run 12 waits for run 7, 10; run 7 names [2, 6]; run 9 alone reads next', () => withEnvVars(ON, () => {
  const { view, members } = views(world(root, 'base'));
  for (const m of [view, members]) {
    assert.equal(statusOf(m, 12).word, 'waits for run 7, 10');
    assert.deepEqual(namedWaits(m.get(7), m), [2, 6]);
    assert.equal(statusOf(m, 7).word, 'waits for run 2 (needs you), 6');
    assert.deepEqual(nextRuns(m), [9]);
  }
}));

test('S3-T2 busy: run 9 next, run 10 empty, run 8 and run 7 name run 2 (needs you), run 13 names run 11', () => withEnvVars(ON, () => {
  const { view, members } = views(world(root, 'busy'));
  for (const m of [view, members]) {
    assert.equal(statusOf(m, 9).word, 'next');
    assert.equal(statusOf(m, 10).word, '');
    assert.equal(statusOf(m, 8).word, 'waits for run 2 (needs you)');
    assert.equal(statusOf(m, 7).word, 'waits for run 2 (needs you), 6');
    assert.equal(statusOf(m, 13).word, 'waits for run 11 (needs you)');
    assert.ok(nextRuns(m).length <= 1);
  }
}));

test('S3-T3 busy with run 6 not started: run 6 reads waits for run 5 (failed)', () => withEnvVars(ON, () => {
  const { states } = SIXTEEN_RUN_STATES.busy;
  const { 6: _six, ...rest } = states;
  const { view, members } = views(world(root, { done: [1, 3], states: rest }));
  for (const m of [view, members]) assert.equal(statusOf(m, 6).word, 'waits for run 5 (failed)');
}));

test('S3-T4 change run: run 13 reads next · small change run, run 9 reads empty', () => withEnvVars(ON, () => {
  const fx = world(root, 'base');
  fx.setKind(13, 'change');
  const { view, members } = views(fx);
  for (const m of [view, members]) {
    assert.equal(statusOf(m, 13).word, 'next · small change run');
    assert.equal(statusOf(m, 9).word, '');
  }
}));

test('S3-T5 held answer has the turn: no row reads next; run 2 is mark after, never waiting for you', () => withEnvVars(ON, () => {
  const fx = world(root, { done: [1], states: { 2: { stop: 'requirement', held: true }, 3: { pipe: 'running' } } });
  const { view, members } = views(fx);
  for (const m of [view, members]) {
    assert.deepEqual(nextRuns(m), []);
    assert.equal(statusOf(m, 2).mark, 'after');
    assert.notEqual(statusOf(m, 2).word, 'next');
    assert.notEqual(statusOf(m, 2).word, 'waiting for you');
    assert.equal(statusOf(m, 9).word, '');
  }
}));

test('S3-T6 buildsOn: every flag-on slice carries its direct builds-on runs in both payloads; flag off carries none', () => {
  const fx = world(root, 'busy');
  withEnvVars(ON, () => {
    const { view, members } = views(fx);
    for (const m of [view, members]) for (const { run, dependsOn } of SIXTEEN_RUN_LINKS) assert.deepEqual(m.get(run).buildsOn, [...dependsOn], `run ${run}`);
  });
  withEnvVars({ WORCA_FLAGS: undefined }, () => {
    for (const s of featureView(fx.featureId, { live: fx.live }).slices) assert.equal('buildsOn' in s, false, `run ${s.index}`);
  });
});

test('S3-T7 cannot start on the payload: a canceled dependency reads word null, mark faint, never next', () => withEnvVars(ON, () => {
  const fx = world(root, { done: [1], states: { 2: { stop: 'requirement' } } });
  fx.cancelTicket(3);
  const { view, members } = views(fx);
  for (const m of [view, members]) assert.deepEqual(statusOf(m, 4), { word: null, mark: 'faint' });
}));

// ── Slice 11 (R-po-6): the run page's links on the /slice answer ─────────────────────────────────────────────────────
const S11_STATE = { done: [1, 11], states: { 2: { stop: 'requirement' }, 3: { pipe: 'running' }, 7: { pipe: 'running' } } };

test('S11-T2 base state, run 7 started: links {waitsFor: [2, 6], neededBy: [12]}', () => withEnvVars(ON, () => {
  const fx = world(root, S11_STATE);
  assert.deepEqual(sliceOfPipeline(fx.pipelineOf(7), { live: fx.live }).links, { waitsFor: [2, 6], neededBy: [12] });
}));

test('S11-T3 run 2 is needed by 7 and 8 and waits for nothing; run 16 started is needed by nothing', () => withEnvVars(ON, () => {
  const fx = world(root, S11_STATE);
  assert.deepEqual(sliceOfPipeline(fx.pipelineOf(2), { live: fx.live }).links, { waitsFor: [], neededBy: [7, 8] });
  fx.setRun(16, { pipe: 'running' });
  assert.deepEqual(sliceOfPipeline(fx.pipelineOf(16), { live: fx.live }).links.neededBy, []);
}));

test('S11-T4 flag off or unmarked feature: no links key; flag on: no top-level waitsFor / neededBy / buildsOn', () => {
  const fx = world(root, S11_STATE);
  withEnvVars({ WORCA_FLAGS: undefined }, () => {
    assert.equal('links' in sliceOfPipeline(fx.pipelineOf(7), { live: fx.live }), false);
  });
  withEnvVars(ON, () => {
    const on = sliceOfPipeline(fx.pipelineOf(7), { live: fx.live });
    assert.ok(on.links);
    for (const k of ['waitsFor', 'neededBy', 'buildsOn']) assert.equal(k in on, false, k);
  });
  getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
  const plain = sixteenRunFeature({ projectDir: root, smallRuns: false });
  plain.setRun(1, { pipe: 'running' });
  withEnvVars(ON, () => {
    assert.equal('links' in sliceOfPipeline(plain.pipelineOf(1), { live: plain.live }), false);
  });
});

test('S11-T5 a canceled dependency is never listed in links.waitsFor', () => withEnvVars(ON, () => {
  const fx = world(root, { done: [1], states: { 2: { stop: 'requirement' } } });
  fx.cancelTicket(3);
  fx.setRun(7, { pipe: 'running' });
  const { waitsFor } = sliceOfPipeline(fx.pipelineOf(7), { live: fx.live }).links;
  assert.ok(!waitsFor.includes(3));
  assert.ok(waitsFor.includes(2));
}));

// ── Slice 16 (R-po-6): only a started run has facts; a run that has not started has no run page ───────────────────────
test('S16-T1 run 7 started after runs 1 to 6 are done: links {waitsFor: [], neededBy: [12]}', () => withEnvVars(ON, () => {
  const fx = world(root, { done: [1, 2, 3, 4, 5, 6], states: { 7: { pipe: 'running' } } });
  assert.deepEqual(sliceOfPipeline(fx.pipelineOf(7), { live: fx.live }).links, { waitsFor: [], neededBy: [12] });
}));

test('S16-T2 a run that has not started has pipelineId null in featureView and the Runs list: nothing for a run page to open', () => withEnvVars(ON, () => {
  const fx = world(root, S11_STATE);
  const { view, members } = views(fx);
  const runs = SIXTEEN_RUN_LINKS.map((l) => l.run);
  const noPipeline = (idOf) => runs.filter((run) => idOf(run) === null);
  const notStarted = [4, 5, 6, 8, 9, 10, 12, 13, 14, 15, 16];
  assert.deepEqual(noPipeline((run) => fx.pipelineOf(run)), notStarted, 'sliceOfPipeline has no pipeline to answer for');
  assert.deepEqual(noPipeline((run) => view.get(run).pipelineId), notStarted, 'featureView');
  const group = listRunGroups({ live: fx.live }).find((g) => g.id === fx.featureId);
  assert.equal(group.members.length, runs.length, 'every run is a member');
  const byRun = new Map(group.members.map((m) => [m.position, m]));
  assert.equal(members.size, runs.length);
  assert.deepEqual(noPipeline((run) => byRun.get(run).pipelineId), notStarted, 'the Runs list');
}));

// ---- Slice 4 (D14): the helper holds a stop behind any run, default run 2 ----
test('setRun held takes `after`: run 4 held behind run 3 reads stop.after === 3 in featureView; the default stays 2', () => withEnvVars(ON, () => {
  const fx = world(root, { done: [1], states: { 2: { stop: 'requirement' }, 3: { pipe: 'running' }, 4: { stop: 'check', held: true, after: 3 } } });
  const four = featureView(fx.featureId, { live: fx.live }).slices.find((x) => x.index === 4);
  assert.equal(four.stop.held, true);
  assert.equal(four.stop.after, 3);
  const def = world(root, { done: [1], states: { 2: { stop: 'check', held: true } } });
  assert.equal(featureView(def.featureId, { live: def.live }).slices.find((x) => x.index === 2).stop.after, 2);
}));

// ---- Slice 6 (R-po-4, R-arch-3, R-qa-1): featureView.asks, every open stop and failed run, and Resume of a named run ----
const viewOf = (fx, live = fx.live) => featureView(fx.featureId, { live });
const indexes = (v) => v.asks?.map((a) => a.index);
const BUSY_LINES = ['Run 2 · plan approval · holds up 7, 8, 12, 15, 16', 'Run 4 · plan approval · holds up 5, 6, 7, 12, 16',
  'Run 5 failed · holds up 6, 7, 12, 16', 'Run 11 · plan approval · holds up 13, 14, 15, 16'];

test('S6-T1 busy: asks lists runs 2, 4, 5 and 11 in order with holdsUp, run 5 marked failed, and ask equals asks[0]', () => withEnvVars(ON, () => {
  const fx = world(root, 'busy');
  const v = viewOf(fx);
  assert.deepEqual(indexes(v), [2, 4, 5, 11]);
  const open = (index, kind, reason, holdsUp) => ({ index, runId: `r${index}`, pipelineId: fx.pipelineOf(index), id: `q${index}`, kind, reason, failed: false, holdsUp });
  assert.deepEqual(v.asks, [
    open(2, 'plan', 'requirement', [7, 8, 12, 15, 16]),
    open(4, 'gate', 'check', [5, 6, 7, 12, 16]),
    { index: 5, runId: null, pipelineId: fx.pipelineOf(5), id: null, kind: null, reason: null, failed: true, holdsUp: [6, 7, 12, 16] },
    open(11, 'gate', 'check', [13, 14, 15, 16]),
  ]);
  assert.deepEqual(v.ask, v.asks[0]);
}));

test('S6-T1b busy: stopLinesOf on the real view gives the four lines, their marks, and no ref only for the failed run', () => withEnvVars(ON, async () => {
  const { stopLinesOf } = await import('../ui/public/shape/stop-list.mjs');
  const fx = world(root, 'busy');
  const lines = stopLinesOf(viewOf(fx));
  assert.deepEqual(lines.map((l) => l.text), BUSY_LINES);
  assert.deepEqual(lines.map((l) => l.mark), ['ask', 'ask', 'failed', 'ask']);
  assert.deepEqual(lines.map((l) => l.ref), [2, 4, 5, 11].map((r) => (r === 5 ? null : { runId: `r${r}`, pipelineId: fx.pipelineOf(r) })));
}));

test('S6-T2: once run 4 is answered and building, asks lists 2, 5 and 11 and ask is still run 2', () => withEnvVars(ON, () => {
  const fx = world(root, 'busy');
  fx.setRun(4, { pipe: 'running' });
  const v = viewOf(fx);
  assert.deepEqual(indexes(v), [2, 5, 11]);
  assert.equal(v.ask.index, 2);
  assert.deepEqual(v.ask, v.asks[0]);
}));

test('S6-T3 (D2): a held stop answer is not a line', () => withEnvVars(ON, () => {
  const { states } = SIXTEEN_RUN_STATES.busy;
  const fx = world(root, { done: [1, 3], states: { ...states, 4: { stop: 'check', held: true, after: 6 } } });
  assert.deepEqual(indexes(viewOf(fx)), [2, 5, 11]);
}));

test('S6 (D2): a plan approval and a Clarify question without a stop are lines too, with no reason', () => withEnvVars(ON, () => {
  const fx = world(root, { done: [1, 3], states: { 2: { approval: true }, 9: { asking: true } } });
  const v = viewOf(fx);
  assert.deepEqual(v.asks?.map((a) => [a.index, a.kind, a.reason, a.failed]), [[2, 'plan', null, false], [9, 'questions', null, false]]);
}));

test('S6 (D3): a run that could not start is a failed line; stopped, paused and canceled runs are not lines', () => withEnvVars(ON, () => {
  const fx = world(root, { done: [1, 3], states: { 2: { stop: 'requirement' }, 5: { pipe: 'stopped' }, 9: { pipe: 'paused' } } });
  fx.cancelTicket(10);
  getDb().prepare("UPDATE scheduled_runs SET status = 'failed' WHERE id = ?").run(fx.ticketOf(11));
  const v = viewOf(fx);
  assert.equal(v.slices[10].state, 'failed');
  assert.deepEqual(v.asks?.map((a) => [a.index, a.failed, a.pipelineId]), [[2, false, fx.pipelineOf(2)], [11, true, null]]);
}));

test('S6 (D5): with nothing open and nothing failed, asks is empty and ask stays null', () => withEnvVars(ON, () => {
  const v = viewOf(world(root, { done: [1], states: { 3: { pipe: 'running' } } }));
  assert.deepEqual(v.asks, []);
  assert.equal(v.ask, null);
}));

test('S6 (D5): a failed run before the first open stop is asks[0], and ask equals it', () => withEnvVars(ON, () => {
  const v = viewOf(world(root, { done: [1], states: { 2: { pipe: 'error' }, 9: { stop: 'check' } } }));
  assert.deepEqual(indexes(v), [2, 9]);
  assert.equal(v.ask?.failed, true);
  assert.deepEqual(v.ask, v.asks[0]);
}));

test('S6 (D16): the chat tools never take a failed run for the open step: failed run 2 before stop run 9 names run 9; only a failed run lets them through', () => withEnvVars(ON, async () => {
  const { threadWork, shapeToolFit } = await import('../src/core/shape/changes.mjs');
  const deps = (fx) => ({ live: fx.live, readPrState: () => null, findPipelineRowById: () => null, readRunTags: () => [], readRunLabels: () => [] });
  const route = (fx) => ({ featureId: fx.featureId, text: 'add a chart', guess: 'add', reason: 'fits the next run' });
  const both = world(root, { done: [1], states: { 2: { pipe: 'error' }, 9: { stop: 'check' } } });
  const w = threadWork([{ pipelineId: both.pipelineOf(1) }], deps(both));
  assert.equal(w.open?.index, 9);
  assert.match(shapeToolFit('route', route(both), w).error, /^Run 9 is waiting/);
  const onlyFailed = world(root, { done: [1], states: { 2: { pipe: 'error' } } });
  const w2 = threadWork([{ pipelineId: onlyFailed.pipelineOf(1) }], deps(onlyFailed));
  assert.equal(w2.open, null);
  assert.doesNotMatch(String(shapeToolFit('route', route(onlyFailed), w2).error || ''), /is waiting at its/);
}));

test('S6-T4 (D1): flag off or unmarked: no asks key, and ask is today\'s first-live-ask pointer', async () => {
  const fx = world(root, 'busy');
  await withEnvVars({ WORCA_FLAGS: undefined }, () => {
    const v = viewOf(fx);
    assert.equal('asks' in v, false);
    assert.deepEqual(v.ask, { index: 2, runId: 'r2', pipelineId: fx.pipelineOf(2), id: 'q2', kind: 'plan' });
  });
  getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
  const plain = sixteenRunFeature({ projectDir: root, smallRuns: false });
  plain.setRun(1, { pipe: 'done' });
  plain.setRun(2, { stop: 'requirement' });
  plain.setRun(5, { pipe: 'error' });
  await withEnvVars(ON, () => {
    const v = viewOf(plain);
    assert.equal('asks' in v, false);
    assert.deepEqual(v.ask, { index: 2, runId: 'r2', pipelineId: plain.pipelineOf(2), id: 'q2', kind: 'plan' });
  });
});

test('S6-T5 (D19): every member\'s waitsFor and nextTurn equal featureView\'s, and no member carries asks', () => withEnvVars(ON, () => {
  const fx = world(root, 'busy');
  const { view, members } = views(fx);
  for (const { run } of SIXTEEN_RUN_LINKS) {
    for (const k of ['waitsFor', 'nextTurn']) assert.deepEqual(members.get(run)[k], view.get(run)[k], `run ${run} ${k}`);
  }
  const group = listRunGroups({ live: fx.live }).find((g) => g.id === fx.featureId);
  assert.equal('asks' in group, false);
  for (const m of group.members) { assert.equal('asks' in m, false); assert.equal('asks' in (m.slice || {}), false); }
}));

test('S6-T6 (R-qa-1): runs 2, 9 and 11 at stops and run 5 failed: every row word, every stop line; approving run 9 leaves 2, 5 and 11', () => withEnvVars(ON, () => {
  const fx = world(root, { done: [1, 3, 4], states: { 2: { stop: 'requirement' }, 9: { stop: 'check' }, 11: { stop: 'check' }, 5: { pipe: 'error' } } });
  const v = viewOf(fx);
  const map = new Map(v.slices.map((s) => [s.index, s]));
  const words = Object.fromEntries(v.slices.filter((s) => s.state !== 'done').map((s) => [s.index, statusOf(map, s.index).word]));
  assert.deepEqual(words, {
    2: 'waiting for you', 5: 'failed', 6: 'waits for run 5 (failed)', 7: 'waits for run 2 (needs you), 6',
    8: 'waits for run 2 (needs you)', 9: 'waiting for you', 10: 'next', 11: 'waiting for you', 12: 'waits for run 7, 10',
    13: 'waits for run 11 (needs you)', 14: 'waits for run 13', 15: 'waits for run 8, 14', 16: 'waits for run 9 (needs you), 12, 15',
  });
  assert.deepEqual(v.asks?.map((a) => RS.stopLineText(a)), [
    'Run 2 · plan approval · holds up 7, 8, 12, 15, 16', 'Run 5 failed · holds up 6, 7, 12, 16',
    'Run 9 · plan approval · holds up 16', 'Run 11 · plan approval · holds up 13, 14, 15, 16',
  ]);
  fx.setRun(9, { pipe: 'running' });
  assert.deepEqual(indexes(viewOf(fx)), [2, 5, 11]);
}));

test('S6-T7 (D1): re-planning lists no asks and keeps the Re-plan run\'s Split ask; a canceled feature lists none', () => withEnvVars(ON, () => {
  const fx = world(root, 'busy');
  for (const r of [2, 4, 11]) fx.setRun(r, { pipe: 'error' });   // no slice asks any more, as while re-planning
  const rp = 's16-replan-1';
  seedPipelineRow({ id: rp, projectKey: projectKey(root), status: 'running', title: 'Re-plan', branch: { source: 'main', feature: 'feat/replan' } });
  const t = createTicket({ title: 'Re-plan the rest', projectDir: root, request: {}, runAtMs: Date.now() });
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(rp, t.id);
  getDb().prepare("UPDATE shape_features SET status = 'replanning', replan_ticket_id = ? WHERE id = ?").run(t.id, fx.featureId);
  const split = liveSliceFrom({ runId: 'r-replan', status: 'running', pendingQuestion: { id: 'out-1', kind: 'plan', plan: { outline: { why: 'w', slices: [] } } } });
  const v = viewOf(fx, (pid) => (pid === rp ? split : fx.live(pid)));
  assert.equal('asks' in v, false);
  assert.deepEqual(v.ask, { index: null, runId: 'r-replan', pipelineId: rp, id: 'out-1', kind: 'outline' });
  getDb().prepare("UPDATE shape_features SET status = 'canceled' WHERE id = ?").run(fx.featureId);
  assert.equal('asks' in viewOf(fx), false);
}));

// ---- Slice 6 Step 3 (D12): Resume a named run ----
const writes = (fid) => JSON.stringify([
  getDb().prepare('SELECT * FROM scheduled_runs ORDER BY id').all(),
  getDb().prepare('SELECT * FROM shape_feature_slices WHERE feature_id = ? ORDER BY idx').all(fid)]);
const rowTickets = (fid) => new Map(getDb().prepare('SELECT idx, ticket_id FROM shape_feature_slices WHERE feature_id = ?').all(fid).map((r) => [r.idx, r.ticket_id]));
const TWO_FAILED = { done: [1, 3, 4], states: { 5: { pipe: 'error' }, 9: { pipe: 'error' } } };

test('S6 resume: an index that is not halted answers 409 NOT_HALTED and writes nothing', () => withEnvVars(ON, () => {
  const fx = world(root, 'busy');
  for (const index of [4, 10, 99]) {
    const before = writes(fx.featureId);
    assert.deepEqual(resumeFeature(fx.featureId, { live: fx.live, index }), { status: 409, code: 'NOT_HALTED', error: `Run ${index} is not stopped` });
    assert.equal(writes(fx.featureId), before, `index ${index} wrote nothing`);
  }
}));

test('S6 resume: a named run on a feature with nothing halted is NOT_HALTED, not "none"', () => withEnvVars(ON, () => {
  const fx = world(root, 'base');
  const before = writes(fx.featureId);
  assert.deepEqual(resumeFeature(fx.featureId, { live: fx.live, index: 3 }), { status: 409, code: 'NOT_HALTED', error: 'Run 3 is not stopped' });
  assert.equal(writes(fx.featureId), before);
}));

test('S6 resume: a named failed run while another run is going keeps today\'s 409 and writes nothing', () => withEnvVars(ON, () => {
  const fx = world(root, 'busy');
  const before = writes(fx.featureId);
  assert.deepEqual(resumeFeature(fx.featureId, { live: fx.live, index: 5 }), { status: 409, error: 'Slice 6 is still going: resume this one when it finishes' });
  assert.equal(writes(fx.featureId), before);
}));

test('S6 resume: index 9 restarts run 9 only; run 5 stays the first halted run', () => withEnvVars(ON, () => {
  const fx = world(root, TWO_FAILED);
  const before = rowTickets(fx.featureId);
  const res = resumeFeature(fx.featureId, { live: fx.live, index: 9 });
  assert.equal(res.action, 'restart');
  const after = rowTickets(fx.featureId);
  assert.equal(after.get(9), res.ticketId);
  assert.notEqual(after.get(9), before.get(9), 'run 9 got a new ticket');
  for (const r of [5, 6, 7, 12, 16]) assert.equal(after.get(r), before.get(r), `run ${r} keeps its ticket`);
  assert.equal(viewOf(fx).halted.index, 5);
}));

test('S6 resume: a named paused run resumes that run, not the first halted one', () => withEnvVars(ON, () => {
  const fx = world(root, { done: [1, 3, 4], states: { 5: { pipe: 'error' }, 9: { pipe: 'paused' } } });
  assert.deepEqual(resumeFeature(fx.featureId, { live: fx.live, index: 9 }), { action: 'resume', pipelineId: fx.pipelineOf(9), index: 9, mock: false });
}));

// ---- Slice 7 (R-po-5, R-qa-9, R-qa-10): the state line and the stop count on the real payload -------------------------
/** The card module and the surface helper (live entries and snapshots, as the server holds them), loaded per test so a
 *  missing new export fails only these tests. */
const s7Mods = async () => ({ ...(await import('../ui/public/shape/feature-card.mjs')),
  ...(await import('../ui/public/shape/stop-list.mjs')), walkWorld: (await import('./helpers/shape-surfaces.mjs')).walkWorld });

test('S7-T17 busy: the real view reads "Run 6 reviewing · next: run 9" and lists 4 stop lines', () => withEnvVars(ON, async () => {
  const { featureStateLine, needYouText, stopLinesOf, walkWorld } = await s7Mods();
  const { fx, snaps } = walkWorld(root, { name: 'busy', spec: 'busy', at: { 6: 'n_review' } });
  const view = viewOf(fx);
  const snapOf = (pid) => snaps.get(pid) || null;
  assert.equal(featureStateLine(view, { snapOf }), 'Run 6 reviewing · next: run 9');
  assert.equal(stopLinesOf(view, { snapOf }).length, 4);
  assert.equal(needYouText(stopLinesOf(view, { snapOf }).length), '4 need you');
}));

test('S7-T18 busy with run 6 not started: only "next: run 9"', () => withEnvVars(ON, async () => {
  const { featureStateLine } = await s7Mods();
  const { 6: _six, ...states } = SIXTEEN_RUN_STATES.busy.states;
  assert.equal(featureStateLine(viewOf(world(root, { done: [1, 3], states }))), 'next: run 9');
}));

test('S7-T18 M5b: runs 8 and 10 both working are named once each, in run order', () => withEnvVars(ON, async () => {
  const { featureStateLine, stopLinesOf, walkWorld } = await s7Mods();
  const { fx, snaps } = walkWorld(root, { name: 'two', spec: { done: M4_DONE, states: { 5: { pipe: 'paused' }, 8: { pipe: 'running' }, 10: { pipe: 'running' } } } });
  const view = viewOf(fx);
  // Frozen from the real payload: run 5 is paused, runs 8 and 10 build, and the server gives run 13 the next turn.
  assert.equal(featureStateLine(view, { snapOf: (pid) => snaps.get(pid) || null }), 'Run 8 building, run 10 building · next: run 13');
  assert.equal(stopLinesOf(view).length, 0);
}));

test('S7-T18 Ask before each run: an open stop reads "Nothing can go on until you act"; without it the held run waits for you', () => withEnvVars(ON, async () => {
  const { featureStateLine } = await s7Mods();
  const stopped = world(root, { done: [1], states: { 2: { stop: 'requirement' } } });
  setApproveEach(stopped.featureId, true);
  assert.equal(featureStateLine(viewOf(stopped)), 'Nothing can go on until you act');
  const held = world(root, { done: [1] });
  setApproveEach(held.featureId, true);
  const view = viewOf(held);
  assert.equal(view.held?.index, 2, 'run 2\'s ticket is held');
  assert.equal(featureStateLine(view), 'Run 2 waiting for you to start');
}));

// ---- Missing work, reproduced on real git branches (R-qa-1): runs 8 and 9 build on run 7, run 10 builds on 8 and 9 ----
// A1 and A4 assert that a run that waited at a stop takes in what finished meanwhile before it goes on (slice 3); A2
// and A3 assert that a run starts with the work of every run it builds on (slice 2). The causes slice 1 found (the full
// write-up with file:line is missing-work-cause.md in slice 1's pipeline folder):
// 1. A waited run's take-in ran before the finished sibling's work was committed: run 9 sends `done` before its teardown
//    commits onto feat/run-9, so an answer now waits until run 9 settles (A1); while the sibling is still merging back
//    the take-in answers `wait` instead of skipping (A4).
// 2. A run's start ignored dependsOn: sliceSourceOf starts run 10 from the branch of the run that finished last only,
//    so the combine takes the other sibling in (A2, A3).

const { siblingWorld, waitedRunHarness, doneSiblings, runTen } = siblingKit({ root, RunHarness });
const filesOn = (cwd, ref) => g(cwd, 'ls-tree', '-r', '--name-only', ref).split('\n').sort();
const noMergeStarted = (wt) => spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: wt, env: probeEnv() }).status !== 0;

// ---- Slice 3 (R-po-2, R-arch-5): a run that waited takes in what finished meanwhile ----------------------------------
// The card's run numbers are the slice numbers: the runs labelled 7, 8, 9 and 10 here are the card's runs 1 to 4.
const STOP8 = gateStop({ run: 2, issues: [{ severity: 'major', title: 'x' }], fixCycles: 3 });
const ANOTHER = { decision: 'another' };
const movedLine = (run) => `Base \`feat/run-${run}\` moved: merged into \`feat/run-8\` (1 commit).`;
const CONFLICT_LINE = 'Base `feat/run-9` moved: conflicts in 1 file.';
const featureLog = (fx) => featureView(fx.featureId).log.map((r) => r.text);
const read8 = (w, file) => readFileSync(join(w.wt8, file), 'utf8');
const commitNine = (w) => { g(w.wt9, 'add', '-A'); g(w.wt9, 'commit', '-qm', 'nine.txt'); };

/** A finished sibling of run 8 on `source` with one commit of its own file, in its own worktree (the card's run 4). */
function finishRunTen(w, { source = 'feat/run-7', at = minute(2), from = 'feat/run-7' } = {}) {
  const wt10 = join(dirname(w.repo), 'wt10');
  g(w.repo, 'worktree', 'add', '-q', '-b', 'feat/run-10', wt10, from);
  commitFile(wt10, 'ten.txt');
  w.fx.start(10, { branch: record(10, source) });
  w.fx.finish(10, { at });
  return head(w.repo, 'feat/run-10');
}

/** The runs map as the server holds it, with the real take-in wired as createHeldStops' `takeIn`: run 8 at its open
 *  stop and, when `nine` is given, run 9's entry. */
function liveRuns(w, eight, { nine = null } = {}) {
  const runs = new Map();
  const e8 = { id: 'r8', pipelineId: w.fx.pipelineOf(8), status: 'running', heldStop: null,
    pendingQuestion: { id: 'gate-w1', kind: 'gate', stop: STOP8 }, orch: eight.h };
  runs.set(e8.id, e8);
  const e9 = nine ? { id: 'r9', pipelineId: w.fx.pipelineOf(9), status: nine.status, settled: nine.settled, heldStop: null,
    pendingQuestion: null, orch: { runShape: { slice: { feature: w.fx.featureId, index: 3 } }, answer() {} } } : null;
  if (e9) runs.set(e9.id, e9);
  const liveSliceOf = (pid) => {
    const e = [...runs.values()].find((x) => x.pipelineId === pid);
    return e && e.status === 'running' ? liveSliceFrom({ runId: e.id, status: e.status, pendingQuestion: e.pendingQuestion,
      approved: true, heldStop: e.heldStop, going: !!e.takingIn }) : null;
  };
  const resolved = [];
  const repaints = [];
  const held = createHeldStops({ runs, liveSliceOf, broadcastFeature: (id) => repaints.push(id), now: Date.now,
    resolvePending: (e, { id, reason }) => { resolved.push({ id, reason }); e.pendingQuestion = null; return true; },
    takeIn: (entry) => entry.orch.takeInBeforeAnswer() });
  return { e8, e9, held, resolved, repaints, direct: async () => held.answer(e8, 'gate-w1', ANOTHER, 'ann') };
}

// Cause 1 (report above): run 9's row reads `done` before teardown commits its work. The answer waits for run 9 to
// settle, then run 9's committed work is taken in before run 8 gets it.
test('A1 / W1 (R-po-2, live order): run 8\'s answer waits while run 9 reads done and not settled, then run 8 takes runs 10 and 9 in before it goes on', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  const { repo, wt8, fx } = w;
  const ten = finishRunTen(w, { source: 'feat/run-9', at: minute(0) });   // built on runs 8 and 9: another base
  const eight = waitedRunHarness(w);
  const live = liveRuns(w, eight, { nine: { status: 'running', settled: false } });
  assert.deepEqual(await live.direct(), { held: true }, 'run 9 is building: the answer is held');

  // Run 9 sends `done`; its teardown has not committed nine.txt yet.
  fx.finish(9, { at: minute(1) });
  live.e9.status = 'done';
  const tip = head(repo, 'feat/run-8');
  await live.held.deliver();
  assert.equal(eight.answers.length, 0, 'no answer goes out while run 9 is still committing');
  assert.equal(live.e8.heldStop?.after, 3);
  assert.equal(head(repo, 'feat/run-8'), tip);

  // Teardown commits run 9's work and the run settles.
  commitNine(w);
  live.e9.settled = true;
  await live.held.deliver();
  assert.deepEqual(eight.answers, [{ id: 'gate-w1', payload: ANOTHER, by: 'ann' }]);
  assert.deepEqual(live.resolved, [{ id: 'gate-w1', reason: 'answered' }]);
  assert.equal(isAncestorExit(repo, head(repo, 'feat/run-9'), 'feat/run-8'), 0, 'run 9\'s commit is in run 8\'s branch');
  assert.equal(isAncestorExit(repo, ten, 'feat/run-8'), 0, 'run 10, built on another base, is taken in too');
  assert.deepEqual(filesOn(repo, 'feat/run-8'), ['base.txt', 'eight.txt', 'nine.txt', 'seven.txt', 'ten.txt']);
  assert.deepEqual(auditOf(fx.pipelineOf(8)).filter((t) => t.startsWith('Base `')), [movedLine(10), movedLine(9)], 'in finish order');
  assert.ok(featureLog(fx).includes('feat/run-9 moved · run 2 starts from it'), featureLog(fx).join(' | '));
  assert.equal(noMergeStarted(wt8), true);
}));

// Cause 1, its second silent skip (report above): a finished run still merging back reads {pending:true}. The take-in
// answers `wait`, names the run and logs it.
test('A4 (R-po-2): while a same-base sibling still merges its work back, the take-in waits for it and says so', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  const { repo, wt8, wt9, fx } = w;
  // Run 9's work is committed, so only the pending merge back can be what keeps it out.
  commitNine(w);
  // Now, not a fixed time: mergeBackPending reads the row as pending only while its finish is recent by the real clock.
  fx.finish(9, { at: new Date().toISOString(), branch: { ...record(9), sameAsSource: true, worktreeDir: wt9 } });
  assert.deepEqual(latestFinishedSource(fx.featureId, { exclude: fx.pipelineOf(8) }), { pending: true });

  const tip = head(repo, 'feat/run-8');
  const { h, logged } = waitedRunHarness(w);
  assert.deepEqual(await h.takeInBeforeAnswer(), { ok: false, wait: true, after: 3 });
  assert.equal(head(repo, 'feat/run-8'), tip);
  assert.equal(noMergeStarted(wt8), true);
  assert.deepEqual(logged.map((l) => l.slice(0, 3)),
    [['worktree', 'info', 'waiting for run 3 to finish merging its work back before taking it in']]);
}));

test('R1 (R-arch-5): after a take-in the record names the taken-in branch, keeps the start, and the diff holds only run 8\'s commits', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  const { repo, fx } = w;
  commitNine(w);
  fx.finish(9, { at: minute(1) });
  const nine = head(repo, 'feat/run-9');
  const eight = waitedRunHarness(w);
  const { start } = eight;
  assert.deepEqual(await eight.h.takeInBeforeAnswer(), { ok: true, merged: [{ index: 3, branch: 'feat/run-9' }] });
  for (const rec of [eight.record(), eight.h.state.branch]) {
    assert.equal(rec.source, 'feat/run-9');
    assert.equal(rec.sourceFrom, 'feat/run-7');
    assert.deepEqual([rec.baseSha, rec.diffBase, rec.startHead], [start, start, start], 'the start never moves');
    assert.deepEqual(rec.tookIn, [{ index: 3, branch: 'feat/run-9', pipelineId: fx.pipelineOf(9), sha: nine }]);
    assert.equal(rec.baseRefs['feat/run-9'], nine);
    assert.equal(rec.baseRefs['feat/run-7'], start, 'the old source stays a base ref');
    assert.deepEqual(rec.baseMerged, { base: 'feat/run-9', behind: 1, merged: true, onAnswer: true });
  }
  assert.ok(eight.persisted.some((r) => r.source === 'feat/run-9'), 'the new record is persisted');
  assert.equal(eight.h.checkpointRefs[eight.key], nine, 'only checkpointRefs move, to the taken-in tip');
  assert.equal(g(repo, 'diff', '--name-only', eight.h.checkpointRefs[eight.key], 'feat/run-8'), 'eight.txt');
  assert.equal(g(repo, 'log', '--no-merges', '--format=%s', 'feat/run-9..feat/run-8'), 'eight.txt');
  // Run 8 finishes with that record: its pull request goes onto run 9's branch.
  fx.finish(8, { at: minute(2), branch: eight.record() });
  assert.equal(smallRunsPrBase(fx.pipelineOf(8)), 'feat/run-9');
  assert.deepEqual(chainBaseBranchesOf(fx.pipelineOf(8)).slice(-2), ['feat/run-7', 'feat/run-9']);
}));

test('take-in (R-po-2): every same-base sibling is merged in finish order, uncommitted work is committed first and kept', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  const { repo, wt8, fx } = w;
  commitNine(w);
  fx.finish(9, { at: minute(1) });
  const ten = finishRunTen(w, { at: minute(2) });
  writeFileSync(join(wt8, 'eight.txt'), 'eight changed\n');
  const eight = waitedRunHarness(w);
  assert.deepEqual(await eight.h.takeInBeforeAnswer(),
    { ok: true, merged: [{ index: 3, branch: 'feat/run-9' }, { index: 4, branch: 'feat/run-10' }] });
  assert.equal(isAncestorExit(repo, head(repo, 'feat/run-9'), 'feat/run-8'), 0);
  assert.equal(isAncestorExit(repo, ten, 'feat/run-8'), 0);
  assert.equal(g(repo, 'show', 'feat/run-8:eight.txt'), 'eight changed', 'the uncommitted work is committed');
  assert.equal(cleanTree(wt8), '');
  assert.equal(eight.record().source, 'feat/run-10', 'source names the last branch merged');
  assert.equal(eight.record().sourceFrom, 'feat/run-7');
  assert.deepEqual(eight.record().tookIn.map((t) => t.index), [3, 4]);
  assert.deepEqual(auditOf(fx.pipelineOf(8)).filter((t) => t.startsWith('Base `')), [movedLine(9), movedLine(10)]);
  assert.ok(eight.logged.some((l) => l[0] === 'worktree' && l[1] === 'info' && /took in the work of .*feat\/run-10.* before going on/.test(l[2])),
    JSON.stringify(eight.logged));
}));

test('take-in (R-arch-5): a second take-in keeps the fire-time source and appends; nothing missing changes nothing', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  const { repo, fx } = w;
  commitNine(w);
  fx.finish(9, { at: minute(1) });
  const eight = waitedRunHarness(w);
  assert.equal((await eight.h.takeInBeforeAnswer()).ok, true);
  // What _persist writes: the next verdict reads the run's fire-time source from the row.
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify(eight.record()), fx.pipelineOf(8));
  finishRunTen(w, { at: minute(2) });
  assert.deepEqual(await eight.h.takeInBeforeAnswer(), { ok: true, merged: [{ index: 4, branch: 'feat/run-10' }] });
  assert.deepEqual([eight.record().source, eight.record().sourceFrom], ['feat/run-10', 'feat/run-7']);
  assert.deepEqual(eight.record().tookIn.map((t) => t.branch), ['feat/run-9', 'feat/run-10']);
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify(eight.record()), fx.pipelineOf(8));

  const [rec, tip, audit] = [structuredClone(eight.record()), head(repo, 'feat/run-8'), auditOf(fx.pipelineOf(8))];
  assert.deepEqual(await eight.h.takeInBeforeAnswer(), { ok: true, merged: [] });
  assert.deepEqual(eight.record(), rec);
  assert.equal(head(repo, 'feat/run-8'), tip);
  assert.deepEqual(auditOf(fx.pipelineOf(8)), audit);
}));

/** Runs 8 and 9 change the same line of src/a.mjs, run 9 finished; run 8 also has an uncommitted change to eight.txt. */
function clashWorld() {
  const w = siblingWorld({ shared: true });
  writeShared(w.wt8, 'eight');
  writeFileSync(join(w.wt9, 'src', 'a.mjs'), "export const a = 'nine';\n");
  commitNine(w);
  w.fx.finish(9, { at: minute(1) });
  writeFileSync(join(w.wt8, 'eight.txt'), 'uncommitted\n');
  return w;
}
const snapshot = (w) => ({ head: head(w.repo, 'feat/run-8'), status: cleanTree(w.wt8), refs: refsOf(w.repo), eight: read8(w, 'eight.txt') });
/** The merge of run 9 into run 8, settled by the person in run 8's checkout. */
function settleOnEight(w) {
  spawnSync('git', ['merge', '-q', '--no-edit', 'feat/run-9'], { cwd: w.wt8, env: probeEnv() });   // conflicts
  writeFileSync(join(w.wt8, 'src', 'a.mjs'), "export const a = 'eight and nine';\n");
  g(w.wt8, 'add', 'src/a.mjs');
  g(w.wt8, 'commit', '-q', '--no-edit');
}

test('C1 (R-qa-6, started-run clash): a direct answer is refused with the clash, the stop stays open and nothing moves', () => withEnvVars(ON, async () => {
  const w = clashWorld();
  const eight = waitedRunHarness(w);
  const live = liveRuns(w, eight);
  const was = snapshot(w);
  await assert.rejects(live.direct(), (err) => err.code === 'TAKE_IN_REFUSED' && err.status === 409 && err.message === CLASH);
  assert.equal(eight.answers.length, 0);
  assert.deepEqual(snapshot(w), was);
  assert.equal(noMergeStarted(w.wt8), true);
  assert.equal(live.e8.pendingQuestion?.id, 'gate-w1', 'the question stays open');
  assert.equal(live.e8.heldStop, null, 'nothing is held');
  assert.ok(auditOf(w.fx.pipelineOf(8)).includes(CONFLICT_LINE), auditOf(w.fx.pipelineOf(8)).join(' | '));
  assert.ok(featureLog(w.fx).includes('feat/run-9 moved · run 2 has conflicts with it in 1 file'), featureLog(w.fx).join(' | '));
  assert.ok(eight.logged.some((l) => l[0] === 'worktree' && l[1] === 'warn' && String(l[2]).includes(CLASH)), JSON.stringify(eight.logged));
}));

test('C2 (R-po-2): after the clash is settled on run 8\'s branch, answering again delivers once with run 9\'s work', () => withEnvVars(ON, async () => {
  const w = clashWorld();
  const eight = waitedRunHarness(w);
  const live = liveRuns(w, eight);
  await assert.rejects(live.direct(), { code: 'TAKE_IN_REFUSED' });
  settleOnEight(w);
  assert.equal(await live.direct(), undefined, 'delivered, not held');
  assert.deepEqual(eight.answers, [{ id: 'gate-w1', payload: ANOTHER, by: 'ann' }]);
  assert.equal(isAncestorExit(w.repo, head(w.repo, 'feat/run-9'), 'feat/run-8'), 0);
}));

test('C3 (R-po-2): a held answer that clashes is dropped with its reason kept on the open stop; answering again is accepted', () => withEnvVars(ON, async () => {
  const w = clashWorld();
  // Run 9 is still going when the person answers.
  getDb().prepare("UPDATE pipelines SET status = 'running' WHERE id = ?").run(w.fx.pipelineOf(9));
  const eight = waitedRunHarness(w);
  const live = liveRuns(w, eight, { nine: { status: 'running', settled: false } });
  assert.deepEqual(await live.direct(), { held: true });
  w.fx.finish(9, { at: minute(1) });
  Object.assign(live.e9, { status: 'done', settled: true });
  const was = snapshot(w);
  await live.held.deliver();
  assert.equal(live.e8.heldStop, null, 'the refused answer is dropped');
  assert.equal(eight.answers.length, 0);
  assert.deepEqual(live.resolved, [], 'the question is not resolved');
  assert.equal(live.e8.pendingQuestion?.id, 'gate-w1');
  assert.deepEqual(live.e8.takeInRefused, { id: 'gate-w1', reason: CLASH });
  assert.ok(live.repaints.includes(w.fx.featureId), 'the stop repaints');
  assert.deepEqual(snapshot(w), was);
  assert.equal(noMergeStarted(w.wt8), true);

  settleOnEight(w);
  assert.equal(await live.direct(), undefined);
  assert.equal(eight.answers.length, 1);
  assert.ok(!live.e8.takeInRefused, 'the next accepted answer clears the reason');
}));

test('take-in (R-arch-7): a clash only the uncommitted work makes is undone: the head and the files are as before', () => withEnvVars(ON, async () => {
  const w = siblingWorld({ shared: true });
  writeFileSync(join(w.wt9, 'src', 'a.mjs'), "export const a = 'nine';\n");
  commitNine(w);
  w.fx.finish(9, { at: minute(1) });
  writeFileSync(join(w.wt8, 'src', 'a.mjs'), "export const a = 'eight, not committed';\n");
  const was = { ...snapshot(w), eight: read8(w, 'src/a.mjs') };
  const eight = waitedRunHarness(w);
  const rec = structuredClone(eight.record());
  assert.deepEqual(await eight.h.takeInBeforeAnswer(), { ok: false, refused: true, reason: CLASH });
  assert.deepEqual({ ...snapshot(w), eight: read8(w, 'src/a.mjs') }, was);
  assert.equal(noMergeStarted(w.wt8), true);
  assert.deepEqual(eight.record(), rec);
}));

test('take-in (R-arch-7, R-arch-8): a later merge that fails puts the branch back where it was, with the uncommitted files', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  commitNine(w);
  w.fx.finish(9, { at: minute(1) });
  finishRunTen(w, { at: minute(2) });
  writeFileSync(join(w.wt8, 'eight.txt'), 'uncommitted\n');
  writeFileSync(join(w.wt8, 'ten.txt'), 'untracked, in the way of the second merge\n');
  const was = { ...snapshot(w), ten: read8(w, 'ten.txt') };
  const eight = waitedRunHarness(w);
  // A file Worca put in the checkout: the commit of the uncommitted work leaves it out, so it stays in the merge's way.
  eight.h.injectedPaths = { [eight.key]: [{ kind: 'file', path: 'ten.txt' }] };
  const rec = structuredClone(eight.record());
  assert.deepEqual(await eight.h.takeInBeforeAnswer(),
    { ok: false, refused: true, reason: 'could not take in the work of run 4 (feat/run-10): failed' });
  assert.deepEqual({ ...snapshot(w), ten: read8(w, 'ten.txt') }, was);
  assert.equal(isAncestorExit(w.repo, head(w.repo, 'feat/run-9'), 'feat/run-8'), 1, 'the first merge is undone too');
  assert.equal(noMergeStarted(w.wt8), true);
  assert.deepEqual(eight.record(), rec);
}));

test('take-in (D7): a checkout with uncommitted changes in worca\'s CLAUDE.md section is refused with no write', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  commitNine(w);
  w.fx.finish(9, { at: minute(1) });
  commitFile(w.wt8, 'CLAUDE.md');
  writeFileSync(join(w.wt8, 'CLAUDE.md'), 'worca section\n');
  const was = { ...snapshot(w), eight: read8(w, 'CLAUDE.md') };
  const eight = waitedRunHarness(w);
  eight.h.injectedPaths = { [eight.key]: [{ kind: 'claudeMdSection', path: 'CLAUDE.md' }] };
  assert.deepEqual(await eight.h.takeInBeforeAnswer(),
    { ok: false, refused: true, reason: 'run 2\'s checkout has uncommitted changes in worca\'s CLAUDE.md section' });
  assert.deepEqual({ ...snapshot(w), eight: read8(w, 'CLAUDE.md') }, was);
  assert.equal(noMergeStarted(w.wt8), true);
}));

test('take-in (D8): a combine check that fails refuses with its error; nothing is merged', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  commitNine(w);
  w.fx.finish(9, { at: minute(1) });
  const was = snapshot(w);
  const eight = waitedRunHarness(w);
  const r = await eight.h.takeInBeforeAnswer({ checkCombine: async () => ({ status: 'error', kind: 'timeout', error: 'git timed out', files: [], fileCount: 0 }) });
  assert.deepEqual([r.ok, r.refused], [false, true]);
  assert.match(r.reason, /git timed out/);
  assert.deepEqual(snapshot(w), was);
  assert.equal(noMergeStarted(w.wt8), true);
}));

test('F1 (R-arch-11): with the flag off, on an unmarked feature or on a source-branch run, the take-in makes no git call and changes no record', async () => {
  const setups = [
    ['flag off', { WORCA_FLAGS: undefined }, () => {}],
    ['unmarked feature', ON, ({ fx }) => getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?')
      .run(JSON.stringify({ smallRuns: false }), fx.pipelineOf(7))],
    ['a run on its source branch', ON, (_w, eight) => { eight.h.state.branch.sameAsSource = true; eight.h.state.branches[eight.key].sameAsSource = true; }],
  ];
  for (const [why, env, apply] of setups) {
    await withEnvVars(env, async () => {
      const w = siblingWorld();
      commitNine(w);
      w.fx.finish(9, { at: minute(1) });
      const eight = waitedRunHarness(w);
      apply(w, eight);
      const rec = structuredClone(eight.record());
      const was = snapshot(w);
      const calls = [];
      const spy = (name) => (...args) => { calls.push([name, ...args]); return null; };
      eight.h._git = async (...args) => { calls.push(['_git', ...args]); return { ok: true, stdout: '', stderr: '' }; };
      assert.deepEqual(await eight.h.takeInBeforeAnswer({ checkCombine: spy('checkCombine'), isAncestor: spy('isAncestor'),
        resolves: spy('resolves'), recordOf: spy('recordOf') }), { ok: true, merged: [], skipped: true }, why);
      assert.deepEqual(calls, [], why);
      assert.deepEqual(eight.record(), rec, why);
      assert.deepEqual(snapshot(w), was, why);
    });
  }
});

// ---- Slice 2 (R-po-1, R-arch-4a): a run starts with the work of every run it builds on ------------------------------
// The card's run numbers are the slice numbers: the runs labelled 7, 8, 9 and 10 here are the card's runs 1 to 4.
const CLASH = 'runs 2 and 3 clash in src/a.mjs';
const refsOf = (repo) => g(repo, 'for-each-ref');
const cleanTree = (wt) => g(wt, 'status', '--porcelain');
const auditOf = (id) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY rowid').all(id).map((r) => r.text);
const combinedLine = (card, run) => `Combined the work of run ${card} (\`feat/run-${run}\`) into \`feat/run-10\` before the first agent.`;

/** Runs 8 and 9 done, then run 10 started the way the scheduler and the harness do it: the source the fire path picks,
 *  the fire-time check (nothing to hold), then the combine onto run 10's fresh branch. */
async function startRunTen(order) {
  const w = doneSiblings(order);
  const ticket = getTicket(w.fx.ticketOf(10));
  const source = sliceSourceOf(ticket);
  assert.equal(await sliceCombineGate(ticket, source), null, 'a clean combine does not hold run 10');
  const ten = runTen(w, source.sourceBranch);
  await ten.combine();
  return { ...w, source, ten };
}

/** Run 10 holds both runs' work, its start is the combined tip, and the audit names the run it took in. */
function assertBoth({ repo, eight, nine, source, ten }, { card, run }) {
  assert.equal(isAncestorExit(repo, eight, 'feat/run-10'), 0, 'run 8\'s work is on run 10\'s branch');
  assert.equal(isAncestorExit(repo, nine, 'feat/run-10'), 0, 'run 9\'s work is on run 10\'s branch');
  assert.deepEqual(filesOn(repo, 'feat/run-10'), ['base.txt', 'eight.txt', 'nine.txt', 'seven.txt']);
  const tip = head(repo, 'feat/run-10');
  assert.notEqual(tip, ten.start);
  // R-arch-6: the recorded source stays the branch the run started from.
  assert.equal(ten.record().source, source.sourceBranch);
  // The dependencies' commits never count as this run's changes.
  assert.deepEqual([ten.record().baseSha, ten.record().diffBase, ten.record().startHead, ten.checkpoint()], [tip, tip, tip, tip]);
  assert.deepEqual(auditOf(ten.id), [combinedLine(card, run)]);
  assert.deepEqual(ten.logged.map((l) => l.slice(0, 2)), [['worktree', 'info']]);
  assert.equal(cleanTree(ten.wt10), '');
  assert.equal(noMergeStarted(ten.wt10), true);
}

test('A2 (R-po-1): run 10 builds on runs 8 and 9 and starts from run 8, which finished last: the combine takes run 9 in', () => withEnvVars(ON, async () => {
  const w = await startRunTen({ nineAt: minute(1), eightAt: minute(2) });
  assert.deepEqual(w.source, { pipelineId: w.fx.pipelineOf(8), sourceBranch: 'feat/run-8' });
  assertBoth(w, { card: 3, run: 9 });
}));

test('A3 (R-po-1): with run 9 finishing last instead, run 10 starts from run 9 and the combine takes run 8 in', () => withEnvVars(ON, async () => {
  const w = await startRunTen({ eightAt: minute(1), nineAt: minute(2) });
  assert.deepEqual(w.source, { pipelineId: w.fx.pipelineOf(9), sourceBranch: 'feat/run-9' });
  assertBoth(w, { card: 2, run: 8 });
}));

// Slice 4 (D4): Ship reads what a combine merged from the run's branch record.
test('R-qa-6 (D4): a combine records the runs it merged as `combined` on the run\'s branch record, in merge order', () => withEnvVars(ON, async () => {
  const w = await startRunTen({ nineAt: minute(1), eightAt: minute(2) });
  assert.deepEqual(w.ten.record().combined, [{ index: 3, branch: 'feat/run-9' }], 'run 10 started from run 8: only run 9 was merged');

  const both = runTen(doneSiblings(), 'feat/run-7');
  await both.combine();
  assert.deepEqual(both.record().combined, [{ index: 2, branch: 'feat/run-8' }, { index: 3, branch: 'feat/run-9' }]);
}));

test('R-qa-6 (D4): a combine with nothing to merge leaves no `combined` key', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  commitNine(w);
  w.fx.finish(9, { at: minute(1) });
  const eight = waitedRunHarness(w);
  assert.equal((await eight.h.takeInBeforeAnswer()).ok, true);
  w.fx.finish(8, { at: minute(2), branch: eight.record() });
  const ten = runTen(w, 'feat/run-8');   // run 8 already holds run 9's work
  await ten.combine();
  assert.equal(head(w.repo, 'feat/run-10'), ten.start);
  assert.equal('combined' in ten.record(), false);
}));

test('R-po-1: a start that holds neither run takes both in, one after the other', () => withEnvVars(ON, async () => {
  const w = doneSiblings();
  const ten = runTen(w, 'feat/run-7');
  await ten.combine();
  assert.equal(isAncestorExit(w.repo, w.eight, 'feat/run-10'), 0);
  assert.equal(isAncestorExit(w.repo, w.nine, 'feat/run-10'), 0);
  assert.deepEqual(filesOn(w.repo, 'feat/run-10'), ['base.txt', 'eight.txt', 'nine.txt', 'seven.txt']);
  const tip = head(w.repo, 'feat/run-10');
  assert.deepEqual([ten.record().source, ten.record().diffBase, ten.checkpoint()], ['feat/run-7', tip, tip]);
  assert.equal(cleanTree(ten.wt10), '');
}));

test('R-arch-4: a second merge that fails puts the branch back at its start, not at the first merge', () => withEnvVars(ON, async () => {
  const w = doneSiblings();
  const ten = runTen(w, 'feat/run-7');
  let calls = 0;
  const merge = (dir, opts) => (++calls === 2 ? Promise.resolve({ ok: false, kind: 'failed', error: 'boom' }) : mergeBaseInto(dir, opts));
  await assert.rejects(combineDependencies(w.repo, { featureId: w.fx.featureId, index: 4, branch: 'feat/run-10', source: 'feat/run-7' },
    { mergeBaseInto: merge }), { kind: 'failed' });
  assert.equal(calls, 2, 'the first merge ran');
  assert.equal(head(w.repo, 'feat/run-10'), ten.start);
  assert.equal(cleanTree(ten.wt10), '');
  assert.equal(noMergeStarted(ten.wt10), true);
}));

test('R-arch-6: a start that already holds every run it builds on is left as it is, with no audit line', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  g(w.wt9, 'add', 'nine.txt');
  g(w.wt9, 'commit', '-qm', 'nine.txt');
  g(w.wt9, 'merge', '-q', '--no-edit', 'feat/run-8');
  w.fx.finish(8, { at: minute(1) });
  w.fx.finish(9, { at: minute(2) });
  const ten = runTen(w, 'feat/run-9');
  await ten.combine();
  assert.equal(head(w.repo, 'feat/run-10'), ten.start);
  assert.equal(ten.checkpoint(), ten.start);
  assert.deepEqual(auditOf(ten.id), []);
  assert.deepEqual(ten.logged, []);
}));

test('R-arch-4: a dependency still merging its work back fails the combine before anything is written', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  g(w.wt9, 'add', 'nine.txt');
  g(w.wt9, 'commit', '-qm', 'nine.txt');
  w.fx.finish(8, { at: minute(1) });
  w.fx.finish(9, { at: new Date().toISOString(), branch: { ...record(9), sameAsSource: true, worktreeDir: w.wt9 } });
  const ten = runTen(w, 'feat/run-8');
  await assert.rejects(ten.combine(), { message: 'the run before it is still merging its work back' });
  assert.equal(head(w.repo, 'feat/run-10'), ten.start);
}));

test('R-arch-4: a merge that fails after a clean check fails the combine with its kind', () => withEnvVars(ON, async () => {
  const w = doneSiblings();
  const ten = runTen(w, 'feat/run-8');
  writeFileSync(join(ten.wt10, 'base.txt'), 'an uncommitted change\n');
  await assert.rejects(ten.combine(), (err) => /dirty|uncommitted/.test(`${err.kind} ${err.message}`));
  assert.equal(head(w.repo, 'feat/run-10'), ten.start);
  assert.equal(noMergeStarted(ten.wt10), true);
}));

test('C1 (R-arch-4a): runs 8 and 9 clash in src/a.mjs: run 10 stays held with that reason, and no ref moves', () => withEnvVars(ON, async () => {
  const w = doneSiblings({ clash: true });
  const ticketId = w.fx.ticketOf(10);
  const ticket = getTicket(ticketId);
  assert.equal(featureView(w.fx.featureId).slices[3].nextTurn, true, 'before the check, run 10 has the next turn');
  const refs = refsOf(w.repo);
  const before = Date.now();
  assert.deepEqual(await sliceCombineGate(ticket, sliceSourceOf(ticket)), { ok: false, hold: true, error: CLASH });
  assert.equal(refsOf(w.repo), refs, 'no ref was written or moved, and run 10 has no branch');
  for (const wt of [w.repo, w.wt8, w.wt9]) assert.equal(noMergeStarted(wt), true, wt);
  const hold = clashHoldOf(ticketId);
  assert.equal(hold.reason, CLASH);
  assert.deepEqual([...hold.runs].sort(), [2, 3]);
  assert.deepEqual(hold.files, ['src/a.mjs']);
  assert.ok(hold.at >= before && hold.at <= Date.now(), 'the hold says when it was found');
  // "Ask me before each run" is off, and the run still reads held, through the one display rule.
  const view = featureView(w.fx.featureId);
  assert.equal(view.approveEach, false);
  assert.equal(ticketHeld(getTicket(ticketId)), true);
  assert.equal(featureHoldsTicket(getTicket(ticketId)), true);
  assert.deepEqual(view.held, { index: 4, ticketId, reason: CLASH });
  assert.equal(view.slices[3].state, 'held');
  assert.equal(view.slices.some((s) => s.nextTurn), false, 'next never names a run the scheduler will not start');
  assert.equal(getTicket(ticketId).status, 'scheduled');
}));

test('C2 (R-arch-4a, R-arch-8): once the clash is settled on run 9\'s local branch, run 10 starts with both runs\' work', () => withEnvVars(ON, async () => {
  const w = doneSiblings({ clash: true, eightAt: minute(2), nineAt: minute(1) });
  const ticketId = w.fx.ticketOf(10);
  const ticket = getTicket(ticketId);
  assert.equal((await sliceCombineGate(ticket, sliceSourceOf(ticket)))?.hold, true);
  // The owner merges run 8 into run 9's branch and settles it there, without pushing: origin still has the old tip.
  g(w.repo, 'remote', 'add', 'origin', join(dirname(w.repo), 'no-such-remote'));
  g(w.repo, 'update-ref', 'refs/remotes/origin/feat/run-9', w.nine);
  spawnSync('git', ['merge', '--no-edit', 'feat/run-8'], { cwd: w.wt9, env: probeEnv() });
  writeFileSync(join(w.wt9, 'src', 'a.mjs'), "export const a = 'settled';\n");
  g(w.wt9, 'add', '-A');
  g(w.wt9, 'commit', '-q', '--no-edit');
  const settled = head(w.repo, 'feat/run-9');
  const source = sliceSourceOf(ticket);
  assert.equal(source.sourceBranch, 'feat/run-8');
  assert.equal(await sliceCombineGate(ticket, source), null);
  assert.equal(clashHoldOf(ticketId), null, 'the hold is cleared');
  assert.equal(ticketHeld(getTicket(ticketId)), false);
  assert.equal(featureView(w.fx.featureId).held, null);
  const ten = runTen(w, source.sourceBranch);
  await ten.combine();
  for (const commit of [w.eight, w.nine, settled]) assert.equal(isAncestorExit(w.repo, commit, 'feat/run-10'), 0, commit);
  assert.equal(noMergeStarted(ten.wt10), true);
}));

test('H1 (R-arch-4a): a clash the harness finds fails the combine with the reason and leaves the branch at its start', () => withEnvVars(ON, async () => {
  const w = doneSiblings({ clash: true });
  const ten = runTen(w, 'feat/run-8');
  const refs = refsOf(w.repo);
  await assert.rejects(ten.combine(), { message: CLASH });
  assert.equal(head(w.repo, 'feat/run-10'), ten.start);
  assert.equal(refsOf(w.repo), refs);
  assert.equal(noMergeStarted(ten.wt10), true);
  assert.equal(cleanTree(ten.wt10), '');
  assert.equal(ten.checkpoint(), ten.start);
}));

test('H2: dev moved and clashes only with run 3: the harness combines first (the gate\'s tree), then leaves the base clash to its audit', () => withEnvVars(ON, async () => {
  const w = doneSiblings();
  assert.equal(featureBase(w.fx.featureId), 'dev');
  // dev adds its own nine.txt: it clashes with run 9 (card run 3) only, never with run 8 alone.
  writeFileSync(join(w.repo, 'nine.txt'), 'dev\n');
  g(w.repo, 'add', 'nine.txt');
  g(w.repo, 'commit', '-qm', 'dev nine');
  const ticket = getTicket(w.fx.ticketOf(10));
  const source = sliceSourceOf(ticket);
  assert.equal(source.sourceBranch, 'feat/run-8');
  assert.equal(await sliceCombineGate(ticket, source), null, 'the gate checks runs 8 and 9 only: clean');
  const ten = runTen(w, source.sourceBranch);
  await ten.h._startFromFeature(ten.h.members[0], { branch: 'feat/run-10', worktreeDir: ten.wt10 }, ten.h.runShape.slice, true);
  const tip = head(w.repo, 'feat/run-10');
  for (const commit of [w.eight, w.nine]) assert.equal(isAncestorExit(w.repo, commit, 'feat/run-10'), 0, commit);
  assert.equal(isAncestorExit(w.repo, head(w.repo, 'dev'), 'feat/run-10'), 1, 'the clashing base is left out');
  assert.deepEqual(auditOf(ten.id), [combinedLine(3, 9), 'Base `dev` moved: conflicts in 1 file.']);
  assert.deepEqual([ten.record().diffBase, ten.checkpoint()], [tip, tip]);
  assert.equal(noMergeStarted(ten.wt10), true);
  assert.equal(cleanTree(ten.wt10), '');
}));

test('F1 (R-arch-9): flag off, or an unmarked feature: the gate answers null with no git call, and held has no reason', async () => {
  const w = await withEnvVars(ON, () => doneSiblings({ clash: true }));
  const ticketId = w.fx.ticketOf(10);
  const ticket = getTicket(ticketId);
  const own = { pipelineId: w.fx.pipelineOf(8), sourceBranch: 'feat/run-8' };
  let gitCalls = 0;
  const seams = (on) => ({ flagEnabled: () => on, checkCombine: async () => { gitCalls++; return { status: 'clean' }; },
    isAncestor: async () => { gitCalls++; return false; } });
  await withEnvVars({ WORCA_FLAGS: undefined }, async () => {
    assert.equal(await sliceCombineGate(ticket, own, seams(false)), null);
    // A hold left from while the flag was on is not read.
    setClashHold(ticketId, { reason: CLASH, runs: [2, 3], files: ['src/a.mjs'], at: Date.now() });
    assert.equal(clashHoldOf(ticketId), null);
    assert.equal(featureHoldsTicket(getTicket(ticketId)), false);
    assert.equal(featureView(w.fx.featureId).held, null);
    setApproveEach(w.fx.featureId, true);
    assert.deepEqual(featureView(w.fx.featureId).held, { index: 4, ticketId }, 'Ask me before each run holds it, with no reason');
  });
  await withEnvVars(ON, async () => {
    getDb().prepare(`UPDATE pipelines SET shape_stats = NULL WHERE id =
      (SELECT origin_pipeline_id FROM shape_features WHERE id = ?)`).run(w.fx.featureId);
    assert.equal(await sliceCombineGate(ticket, own, seams(true)), null);
  });
  assert.equal(gitCalls, 0);
});

test('R-po-1 (D4): dependencyBranchesOf names the work branch of each run the slice builds on', () => withEnvVars(ON, () => {
  const w = doneSiblings();
  const { featureId, pipelineOf } = w.fx;
  const eight = { index: 2, pipelineId: pipelineOf(8), branch: 'feat/run-8' };
  const nine = { index: 3, pipelineId: pipelineOf(9), branch: 'feat/run-9' };
  assert.deepEqual(dependencyBranchesOf(featureId, 4), { branches: [eight, nine] });
  assert.deepEqual(dependencyBranchesOf(featureId, 99), { branches: [] }, 'unknown run');
  assert.deepEqual(dependencyBranchesOf('no-such-feature', 4), { branches: [] });
  // A dependency with no single-project branch (a workspace run) combines nothing.
  const db = getDb();
  db.prepare("UPDATE pipelines SET target = 'workspace', workspace_meta = ? WHERE id = ?")
    .run(JSON.stringify({ branches: { k: record(9) } }), pipelineOf(9));
  assert.deepEqual(dependencyBranchesOf(featureId, 4), { branches: [eight] });
  // One still merging its work back makes the whole answer pending.
  db.prepare("UPDATE pipelines SET target = 'project', workspace_meta = NULL, branch = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify({ ...record(9), sameAsSource: true, worktreeDir: w.wt9 }), new Date().toISOString(), pipelineOf(9));
  assert.deepEqual(dependencyBranchesOf(featureId, 4), { pending: true });
  // A follow-up run starts from the base by design.
  db.prepare("UPDATE shape_feature_slices SET kind = 'follow-up' WHERE feature_id = ? AND idx = 4").run(featureId);
  assert.deepEqual(dependencyBranchesOf(featureId, 4), { branches: [] });
}));

// ---- Slice 5 (R-po-3, R-arch-1, R-qa-4): a run being resumed at server start holds the turn --------------------------
// The base of these worlds: run 5 paused by a person, so runs 10 and 13 are due once the turn is free (10 first).
const S5_DONE = [1, 2, 3, 4, 8, 11];
const s5 = (states = {}) => world(root, { done: S5_DONE, states: { 5: { pipe: 'paused' }, ...states } });
const WORKING = { pipe: 'running' };
const RESUMING = { pipe: 'paused', resuming: true };
const PAUSED = { pipe: 'paused' };
const OFF = { WORCA_FLAGS: undefined };
const replan = (fx) => replanRest(fx.featureId, { live: fx.live });
const busy = (fx, live = fx.live) => busySliceOf(fx.featureId, { live });
const stillGoing = (n) => ({ status: 409, error: `Slice ${n} is still going: stop it first, then re-plan the rest` });

test('S5: run 9 being resumed holds the turn as while it works', () => withEnvVars(ON, () => {
  // Each world is read in full before the next is built: building one cancels the previous feature's tickets.
  const read = (nine) => {
    const fx = s5({ 9: nine });
    const { view, members } = views(fx);
    return { fx, start: startable(fx), ten: gate(fx, 10), view: turnRuns(view), members: turnRuns(members) };
  };
  const working = read(WORKING);
  const workingReplan = replan(working.fx);
  const resuming = read(RESUMING);
  const resumingReplan = replan(resuming.fx);
  const paused = read(PAUSED);
  assert.deepEqual(paused.start, [10], 'control: a run a person paused frees the turn');
  assert.deepEqual(working.start, []);
  assert.deepEqual(resuming.start, [], 'nothing starts while run 9 is being resumed');
  assert.deepEqual(working.ten, { state: 'waiting' });
  assert.deepEqual(resuming.ten, { state: 'waiting' }, "Start now's gate");
  assert.deepEqual(working.view, [10]);
  assert.deepEqual(resuming.view, working.view, 'featureView next label');
  assert.deepEqual(resuming.members, working.members, 'Runs list next label');
  assert.deepEqual(workingReplan, stillGoing(9));
  assert.deepEqual(resumingReplan, workingReplan, 'Re-plan the rest refuses as while run 9 works');
}));

test("S5: run 5's held answer stays held and the next label is unchanged while run 9 is being resumed", () => withEnvVars(ON, async () => {
  const read = async (nine) => {
    const fx = s5({ 5: { stop: 'requirement', held: true, after: 9 }, 9: nine });
    const turn = heldStopTurn(fx.featureId, 5, { live: fx.live });
    const answered = [];
    const resolved = [];
    const entry = { id: 'r5', pipelineId: fx.pipelineOf(5), status: 'running',
      heldStop: { id: 'q5', payload: ANOTHER, by: 'ann', after: 9 },
      pendingQuestion: { id: 'q5', kind: 'plan', stop: { reason: 'requirement', run: 5 } },
      orch: { runShape: { slice: { feature: fx.featureId, index: 5 } }, answer: (id) => answered.push(id) } };
    const held = createHeldStops({ runs: new Map([[entry.id, entry]]), liveSliceOf: fx.live, broadcastFeature: () => {},
      resolvePending: (e, { id }) => { resolved.push(id); return true; } });
    await held.deliver();
    const { view, members } = views(fx);
    // The re-plan is read last. Run 5's held answer counts as going, so every world refuses it and nothing is written.
    return { turn, answered, resolved, heldAfter: entry.heldStop?.after ?? null, view: turnRuns(view), members: turnRuns(members),
      start: startable(fx), replan: replan(fx) };
  };
  const working = await read(WORKING);
  const resuming = await read(RESUMING);
  const paused = await read(PAUSED);
  assert.deepEqual(paused.turn, { due: true }, 'control: a run a person paused frees the turn');
  assert.deepEqual(paused.resolved, ['q5'], 'control: deliver() sends the answer once the turn is free');
  for (const [name, w] of [['working', working], ['resuming', resuming]]) {
    assert.deepEqual(w.turn, { due: false, after: 9 }, name);
    assert.deepEqual(w.resolved, [], `${name}: no pending question is resolved`);
    assert.deepEqual(w.answered, [], `${name}: run 5 is not answered`);
    assert.equal(w.heldAfter, 9, `${name}: the answer stays held`);
  }
  assert.deepEqual(working.view, [5]);
  assert.deepEqual(resuming.view, working.view, 'featureView next label');
  assert.deepEqual(working.members, [5]);
  assert.deepEqual(resuming.members, working.members, 'Runs list next label');
  assert.deepEqual(working.start, []);
  assert.deepEqual(resuming.start, [], 'no other run starts');
  assert.deepEqual(working.replan, stillGoing(5));
  assert.deepEqual(resuming.replan, working.replan, 'Re-plan the rest refuses as while run 9 works');
}));

test('S5 R-qa-4: with the flag off the signal changes nothing', () => withEnvVars(OFF, () => {
  // Run 13 going: were the signal read, run 9 (the lower number) would be named instead.
  const going = (nine) => { const fx = s5({ 13: WORKING, 9: nine }); return { busy: busy(fx), replan: replan(fx) }; };
  const signal = going(RESUMING);
  const none = going(PAUSED);
  assert.deepEqual(none.busy, { index: 13 });
  assert.deepEqual(signal.busy, none.busy);
  assert.deepEqual(none.replan, stillGoing(13));
  assert.deepEqual(signal.replan, none.replan);
  // No going run: the re-plan goes through, so it is read last (it cancels the waiting tickets).
  const idle = (nine) => {
    const fx = s5({ 9: nine });
    const read = { busy: busy(fx), start: startable(fx) };
    const out = replan(fx);
    return { ...read, replan: out.ticketId ? { ...out, ticketId: typeof out.ticketId } : out };
  };
  const idleSignal = idle(RESUMING);
  const idleNone = idle(PAUSED);
  assert.deepEqual(idleNone, { busy: null, start: [10], replan: { ticketId: 'string' } });
  assert.deepEqual(idleSignal, idleNone);
}));

test('S5 (R-arch-7): a resuming row shows its stored state, with the flag on and off', async () => {
  for (const env of [ON, OFF]) {
    await withEnvVars(env, () => {
      const fx = s5({ 9: { pipe: 'stopped', resuming: true } });
      const nine = featureView(fx.featureId, { live: fx.live }).slices.find((s) => s.index === 9);
      assert.equal(nine.state, 'stopped', `flags ${env.WORCA_FLAGS || 'off'}`);
    });
  }
});

test('S5 (D1): liveSliceResuming() is the frozen overlay of a paused run with no runs-map entry, marked resuming', () => {
  const overlay = SF.liveSliceResuming();
  assert.deepEqual(overlay, { runId: null, status: 'paused', waiting: false, asking: false, approved: false, ask: null, resuming: true });
  assert.ok(Object.isFrozen(overlay));
});

test('S5 (D2, D3): a marked paused entry holds the turn, even at an open stop, and its row reads as the unmarked entry does', async () => {
  const entry = liveSliceFrom({ runId: 'r9', status: 'paused', pendingQuestion: { id: 'q9', kind: 'gate', stop: { reason: 'check', run: 9 } } });
  const read = (overlay) => {
    const fx = s5({ 9: PAUSED });
    const live = (pid) => (pid === fx.pipelineOf(9) ? overlay : fx.live(pid));
    const nine = featureView(fx.featureId, { live }).slices.find((s) => s.index === 9);
    return { busy: busy(fx, live), state: nine.state, stop: nine.stop };
  };
  await withEnvVars(ON, () => {
    const marked = read({ ...entry, resuming: true });
    const unmarked = read(entry);
    assert.equal(unmarked.busy, null, 'control: an open stop frees the turn');
    assert.deepEqual(marked.busy, { index: 9 });
    assert.deepEqual([marked.state, marked.stop], [unmarked.state, unmarked.stop]);
    assert.equal(marked.state, 'questions');
  });
  await withEnvVars(OFF, () => assert.deepEqual(read({ ...entry, resuming: true }), read(entry)));
});

test("S5 (D4): the gate is the flag alone: an unmarked feature's resuming run holds the turn too", () => withEnvVars(ON, () => {
  getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
  const fx = sixteenRunFeature({ projectDir: root, smallRuns: false });
  fx.setRun(9, PAUSED);
  assert.equal(busy(fx), null, 'control: a paused run is not going');
  fx.setRun(9, RESUMING);
  assert.deepEqual(busy(fx), { index: 9 });
}));

// ---- Slice 7 (R-po-4, R-po-5, R-qa-2): a resume waits its turn ------------------------------------------------------
/** A 16-run world read through a held-stops instance's overlay, as the server composes it, with a fake resumeRun that
 *  records each call and stays in flight until `goOn(run)`. `make()` builds another instance (a restart). */
function resumeKit(spec) {
  const calls = [];
  const flying = new Map();
  let fx = null;
  const make = () => createHeldStops({ runs: new Map(), liveSliceOf: (pid) => fx.live(pid), broadcastFeature: () => {},
    resolvePending: () => true,
    resume: (pid, opts) => { calls.push({ pid, opts }); return new Promise((resolve) => flying.set(pid, resolve)); } });
  const held = make();
  fx = world(root, spec, { held });
  /** Run `run`'s resume is live: the run works and the call resolves. */
  const goOn = (run) => {
    const pid = fx.pipelineOf(run);
    fx.setRun(run, { pipe: 'running' });
    flying.get(pid)?.({ ok: true, runId: `r${run}`, pipelineId: pid });
  };
  return { fx, held, calls, make, goOn };
}
const flushed = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const storedStatus = (pid) => getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(pid).status;
const ONLY_EIGHT = { done: M4_DONE, states: { 5: PAUSED, 8: WORKING } };

test('M5b (s7): only run 8 going; resuming run 5 is held after run 8, startable [], delivered once after run 8 is done', () => withEnvVars(ON, async () => {
  const k = resumeKit(ONLY_EIGHT);
  const { fx, held, calls } = k;
  const five = fx.pipelineOf(5);
  assert.deepEqual(startable(fx), []);
  assert.deepEqual(held.holdResume(five, { by: 'ann' }), { ok: true, held: true, pipelineId: five, after: 8 });
  assert.equal(storedStatus(five), 'paused');
  assert.deepEqual(startable(fx), [], 'the resume starts nothing');
  await held.deliver();
  assert.deepEqual(calls, [], 'nothing is delivered while run 8 goes');
  fx.setRun(8, { pipe: 'done' });
  assert.deepEqual(held.heldResumeOf(five), { after: 8 });
  assert.deepEqual(startable(fx), [], 'the held resume goes before the free runs');
  const first = held.deliver();
  const second = held.deliver();
  try {
    await flushed();
    assert.deepEqual(calls, [{ pid: five, opts: { by: 'ann', heldDelivery: true } }]);
    assert.equal(fx.live(five).resuming, true);
    assert.deepEqual(startable(fx), [], "while run 5's resume is in flight");
  } finally { k.goOn(5); }
  await Promise.all([first, second]);
  await held.deliver();
  assert.equal(calls.length, 1, 'delivered exactly once');
  assert.deepEqual(startable(fx), [], 'run 5 works now');
}));

test('M5b (s7): the label is on run 5 while held', () => withEnvVars(ON, () => {
  const { fx, held } = resumeKit(ONLY_EIGHT);
  held.holdResume(fx.pipelineOf(5), { by: 'ann' });
  const { view, members } = views(fx);
  assert.equal(view.get(5).state, 'paused');
  assert.deepEqual(view.get(5).heldResume, { after: 8 });
  assert.deepEqual(turnRuns(view), [5], 'featureView next label');
  assert.deepEqual(turnRuns(members), [5], 'Runs list next label');
}));

test('s7: pausing held run 5, or a simulated restart (a new held-stops instance), leaves run 5 paused with no heldResume and nothing delivered when run 8 finishes', () => withEnvVars(ON, async () => {
  const drop = {
    pause: (k) => { assert.equal(k.held.dropResume(k.fx.pipelineOf(5)), true); return k.held; },
    restart: (k) => { const next = k.make(); k.fx.useHeld(next); return next; },
  };
  for (const [name, how] of Object.entries(drop)) {
    const k = resumeKit(ONLY_EIGHT);
    const five = k.fx.pipelineOf(5);
    assert.ok(k.held.holdResume(five, { by: 'ann' }), name);
    const now = how(k);
    const row = () => featureView(k.fx.featureId, { live: k.fx.live }).slices.find((s) => s.index === 5);
    const unheld = () => {
      assert.equal(row().state, 'paused', name);
      assert.equal('heldResume' in row(), false, name);
      assert.equal('nextTurn' in row(), false, name);
    };
    unheld();
    k.fx.setRun(8, { pipe: 'done' });
    await now.deliver();
    await flushed();
    assert.deepEqual(k.calls, [], `${name}: nothing is delivered`);
    unheld();
    assert.equal(storedStatus(five), 'paused', name);
    assert.deepEqual(startable(k.fx), [10], `${name}: the next free run has the turn`);
  }
}));

test('s7: two boot picks (4 and 6): only 4 resumes and holds the turn; 6 is held after 4 and holds nothing', () => withEnvVars(ON, () => {
  const { fx, held } = resumeKit({ done: [1, 2, 3], states: { 4: PAUSED, 6: PAUSED } });
  const [four, six] = [fx.pipelineOf(4), fx.pipelineOf(6)];
  const picks = [{ pipelineId: six, by: 'ann', why: 'drain' }, { pipelineId: four, by: 'bo', why: 'drain' }];
  assert.deepEqual(held.splitBootPicks(picks, { mock: true }).map((p) => p.pipelineId), [four]);
  fx.setRun(4, RESUMING);                             // the server marks the picks it keeps
  assert.ok(!fx.live(six).resuming, 'run 6 is not being resumed');
  assert.deepEqual(fx.live(six).heldResume, { after: 4 });
  assert.equal(busySliceOf(fx.featureId, { exclude: 4, live: fx.live }), null, 'run 6 holds nothing');
  assert.deepEqual(busy(fx), { index: 4 });
  assert.deepEqual(startable(fx), []);
}));

test('s7 (R-arch-8): a held resume holds nothing, yet a free run waits for it', () => withEnvVars(ON, () => {
  const { fx, held } = resumeKit({ done: M4_DONE, states: { 5: PAUSED, 8: WORKING, 12: PAUSED } });
  held.holdResume(fx.pipelineOf(5), { by: 'ann' });
  fx.setRun(8, { pipe: 'done' });
  assert.deepEqual(held.heldResumeOf(fx.pipelineOf(5)), { after: 8 });
  assert.equal(busy(fx), null, 'not counted as going');
  assert.deepEqual(heldStopTurn(fx.featureId, 12, { live: fx.live }), { due: true }, "another held item's turn is not blocked");
  assert.deepEqual(gate(fx, 10), { state: 'waiting' }, "run 10 is free but waits behind the held resume (Start now's gate)");
  const resume = resumeFeature(fx.featureId, { live: fx.live, index: 12 });
  assert.equal(resume.action, 'resume', `the feature's Resume is not refused: ${JSON.stringify(resume)}`);
  const out = replan(fx);                             // read last: it cancels the waiting tickets
  assert.ok(out.ticketId, `Re-plan the rest is not refused: ${JSON.stringify(out)}`);
}));

test('S7 (D9): liveSliceHeldResume() overlays heldResume on a slice, or on a bare paused run', () => {
  const bare = SF.liveSliceHeldResume(null, 8);
  assert.deepEqual(bare, { ...liveSliceFrom({ runId: null, status: 'paused' }), heldResume: { after: 8 } });
  assert.ok(Object.isFrozen(bare));
  const entry = liveSliceFrom({ runId: 'r5', status: 'paused' });
  assert.deepEqual(SF.liveSliceHeldResume(entry, 8), { ...entry, heldResume: { after: 8 } });
  assert.equal('heldResume' in entry, false, 'the input is not changed');
});

test('s7 (R-po-4, the example): run 6 resumed while run 4 works stays held, goes on once run 4 finishes or stops at a stop; after a restart it reads paused, held after nothing', () => withEnvVars(ON, async () => {
  const ends = {
    'run 4 finishes': { end: (k) => k.fx.setRun(4, { pipe: 'done' }), goes: true },
    'run 4 stops at a stop': { end: (k) => k.fx.setRun(4, { stop: 'check' }), goes: true },
    'the server restarts first': { end: (k) => { const next = k.make(); k.fx.useHeld(next); k.fx.setRun(4, { pipe: 'done' }); return next; }, goes: false },
  };
  for (const [name, { end, goes }] of Object.entries(ends)) {
    const k = resumeKit({ done: [1, 2, 3], states: { 4: WORKING, 6: PAUSED } });
    const six = k.fx.pipelineOf(6);
    const row = () => featureView(k.fx.featureId, { live: k.fx.live }).slices.find((s) => s.index === 6);
    assert.deepEqual(k.held.holdResume(six, { by: 'ann' }), { ok: true, held: true, pipelineId: six, after: 4 }, name);
    await k.held.deliver();
    assert.deepEqual(k.calls, [], `${name}: held while run 4 works`);
    assert.deepEqual(row().heldResume, { after: 4 }, name);
    const now = end(k) || k.held;
    const pass = now.deliver();
    try {
      await flushed();
      assert.deepEqual(k.calls.map((c) => c.pid), goes ? [six] : [], name);
    } finally { if (k.calls.length) k.goOn(6); }
    await pass;
    if (!goes) {
      assert.equal(row().state, 'paused', name);
      assert.equal('heldResume' in row(), false, `${name}: no longer after run 4`);
    }
  }
}));

// A guard that holds on today's code too: a person's pause frees the turn and this slice must not change that.
test('s7 (R-po-5, the example): the owner pauses run 8; the next free run starts', () => withEnvVars(ON, () => {
  const fx = world(root, { done: M4_DONE, states: { 8: WORKING } });
  assert.deepEqual(startable(fx), []);
  fx.setRun(8, PAUSED);
  assert.deepEqual(startable(fx), [5]);
}));

// ── Shaper small runs, slice 9 (R-arch-3): the next-turn marker on a paused run with a held answer ───────────────────
// Runs 2 to 7 each build on run 1 only, so run 7 can be free while run 2 is paused (in the 16-run links it builds on 2).
const PAUSED_HELD_LINKS = [[1, []], [2, [1]], [3, [1]], [4, [1]], [5, [1]], [6, [1]], [7, [1]]]
  .map(([run, dependsOn]) => ({ run, dependsOn }));

test('S9 (R-arch-3): run 2 paused with a held answer and run 7 free: the marker sits on run 7, the run the scheduler starts', () => withEnvVars(ON, () => {
  const runTwo = (how) => world(root, { done: [1, 3, 4, 5, 6], states: { 2: how } }, { links: PAUSED_HELD_LINKS });
  const marked = (fx) => { const { view, members } = views(fx); return [turnRuns(view), turnRuns(members)]; };
  const paused = runTwo({ pipe: 'paused', stop: 'requirement', held: true });
  assert.deepEqual(startable(paused), [7]);
  assert.deepEqual(marked(paused), [[7], [7]]);
  const { view, members } = views(paused);
  for (const m of [view, members]) {
    assert.equal(m.get(2).state, 'paused');
    assert.equal('stop' in m.get(2), false, 'a paused run shows no stop, so no held answer');
    assert.equal('nextTurn' in m.get(2), false);
  }
  // Contrast A (d9-5): the same held answer on a run that is not paused takes the turn.
  const running = runTwo({ stop: 'requirement', held: true });
  assert.deepEqual(startable(running), []);
  assert.deepEqual(marked(running), [[2], [2]]);
  // Contrast B (d9-5): a paused run has the marker only through a held resume, and then the scheduler waits for it.
  const resume = runTwo({ pipe: 'paused', heldResume: 1 });
  assert.deepEqual(startable(resume), []);
  assert.deepEqual(marked(resume), [[2], [2]]);
}));

// ---- R-arch-5: a resumed run takes in what finished meanwhile and records the branch it now builds on -------
// Restart, a person's Resume and a delivered held resume all reach the harness through resume(), whose one take-in call
// is _takeInOnResume(). The runs labelled 7, 8, 9 and 10 here are the card's runs 1 to 4, as above.
test('RS1 (R-arch-5): a resumed run 8 takes run 9 in and records run 9\'s branch as its base, for every base reader', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  const { repo, wt8, fx } = w;
  commitNine(w);
  fx.finish(9, { at: minute(1) });
  const nine = head(repo, 'feat/run-9');
  const eight = waitedRunHarness(w);
  const { start } = eight;
  assert.equal(await eight.h._takeInOnResume(), undefined);

  for (const rec of [eight.record(), eight.h.state.branch]) {
    assert.equal(rec.source, 'feat/run-9', 'the recorded base names the branch the run now builds on');
    assert.equal(rec.sourceFrom, 'feat/run-7');
    assert.deepEqual(rec.tookIn, [{ index: 3, branch: 'feat/run-9', pipelineId: fx.pipelineOf(9), sha: nine }]);
    assert.deepEqual(rec.baseMerged, { base: 'feat/run-9', behind: 1, merged: true, onResume: true }, 'onResume, and no onAnswer key');
    assert.deepEqual([rec.baseSha, rec.diffBase, rec.startHead], [start, start, start], 'the start never moves');
  }
  assert.ok(eight.persisted.some((r) => r.source === 'feat/run-9'), 'the new record is persisted');
  assert.equal(isAncestorExit(repo, nine, 'feat/run-8'), 0, 'run 9\'s commit is in run 8\'s branch');
  assert.equal(noMergeStarted(wt8), true);
  assert.equal(g(repo, 'diff', '--name-only', eight.h.checkpointRefs[eight.key], 'feat/run-8'), 'eight.txt', 'the diff holds only run 8\'s commits');
  assert.ok(featureLog(fx).includes('feat/run-9 moved · run 2 starts from it'), featureLog(fx).join(' | '));

  // Run 8 finishes with that record: Ship, the pull request dialog and the merge-back gate read it.
  fx.finish(8, { at: minute(2), branch: eight.record() });
  const pid = fx.pipelineOf(8);
  assert.equal(smallRunsPrBase(pid), 'feat/run-9', 'Ship');
  assert.deepEqual(chainBaseBranchesOf(pid).slice(-2), ['feat/run-7', 'feat/run-9']);
  assert.equal(stackedPrBase(pid, chainBaseBranchesOf(pid)), 'feat/run-9', 'the pull request dialog\'s call');
  assert.equal(workBranchOf(eight.record()), 'feat/run-8', 'the merge-back gate: the run\'s own branch');
  assert.deepEqual(previousBranchesOf(pid), { sourceBranch: 'feat/run-8' }, 'nothing is pending on a merge back');
}));

test('RS2 (R-arch-5): a clash on resume leaves the head, the files and the record as they were, and the run goes on', () => withEnvVars(ON, async () => {
  const w = clashWorld();
  const eight = waitedRunHarness(w);
  const was = snapshot(w);
  const rec = structuredClone(eight.record());
  await assert.doesNotReject(async () => { await eight.h._takeInOnResume(); });
  assert.deepEqual(snapshot(w), was, 'the head, the refs and the uncommitted eight.txt are unchanged');
  assert.equal(cleanTree(w.wt8), 'M eight.txt', 'still uncommitted');
  assert.equal(noMergeStarted(w.wt8), true);
  assert.deepEqual(eight.record(), rec);
  assert.deepEqual(eight.h.state.branch, rec);
  assert.deepEqual(eight.persisted, [], 'nothing is persisted');
  assert.ok(auditOf(w.fx.pipelineOf(8)).includes(CONFLICT_LINE), auditOf(w.fx.pipelineOf(8)).join(' | '));
  assert.ok(eight.logged.some((l) => l[0] === 'worktree' && l[1] === 'warn' && String(l[2]).includes(CLASH)), JSON.stringify(eight.logged));
}));

test('RS3 (R-arch-5): a sibling still merging its work back does not block the resume; the record and the head stay', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  const { repo, wt8, wt9, fx } = w;
  commitNine(w);
  // Now, not a fixed time: mergeBackPending reads the row as pending only while its finish is recent by the real clock.
  fx.finish(9, { at: new Date().toISOString(), branch: { ...record(9), sameAsSource: true, worktreeDir: wt9 } });
  const tip = head(repo, 'feat/run-8');
  const eight = waitedRunHarness(w);
  const rec = structuredClone(eight.record());
  await assert.doesNotReject(async () => { await eight.h._takeInOnResume(); });
  assert.equal(head(repo, 'feat/run-8'), tip);
  assert.equal(noMergeStarted(wt8), true);
  assert.deepEqual(eight.record(), rec);
  assert.deepEqual(eight.persisted, []);
  assert.deepEqual(eight.logged.map((l) => l.slice(0, 3)),
    [['worktree', 'info', 'waiting for run 3 to finish merging its work back before taking it in']]);
}));

test('RS4 (R-arch-5, flag off): a resume leaves the record deep-equal to the one before and merges nothing', () => withEnvVars({ WORCA_FLAGS: undefined }, async () => {
  const w = siblingWorld();
  const { repo, fx } = w;
  commitNine(w);
  fx.finish(9, { at: minute(1) });
  const was = snapshot(w);
  const eight = waitedRunHarness(w);
  const rec = structuredClone(eight.record());
  await eight.h._takeInOnResume();
  assert.deepEqual(eight.record(), rec);
  assert.deepEqual(eight.h.state.branch, rec);
  assert.deepEqual(eight.persisted, []);
  assert.deepEqual(snapshot(w), was);
  assert.equal(isAncestorExit(repo, head(repo, 'feat/run-9'), 'feat/run-8'), 1, 'run 9\'s commit is not in run 8\'s branch');
}));

// The take-in takes in every finished run the branch lacks, whatever its base: run 9 (from run 7) and run 10 (from run
// 9's branch) both reach run 8, on a resume and on an answered stop alike.
test('RS8: a resumed or answered run 8 takes in run 9 (from run 7) and run 10 (from run 9\'s branch), in finish order', () => withEnvVars(ON, async () => {
  for (const how of ['resume', 'answer']) {
    const w = siblingWorld();
    const { repo, wt8, fx } = w;
    commitNine(w);
    fx.finish(9, { at: minute(1) });
    const ten = finishRunTen(w, { source: 'feat/run-9', from: 'feat/run-9', at: minute(2) });
    const nine = head(repo, 'feat/run-9');
    const eight = waitedRunHarness(w);
    const r = how === 'resume' ? await eight.h._takeInOnResume() : await eight.h.takeInBeforeAnswer();
    if (how === 'answer') assert.deepEqual(r, { ok: true, merged: [{ index: 3, branch: 'feat/run-9' }, { index: 4, branch: 'feat/run-10' }] });
    assert.equal(isAncestorExit(repo, nine, 'feat/run-8'), 0, `${how}: run 9's commit is in run 8's branch`);
    assert.equal(isAncestorExit(repo, ten, 'feat/run-8'), 0, `${how}: run 10's commit is in run 8's branch`);
    const rec = eight.record();
    assert.equal(rec.source, 'feat/run-10', `${how}: the recorded base is the last branch taken in`);
    assert.equal(rec.sourceFrom, 'feat/run-7');
    assert.deepEqual(rec.tookIn.map((t) => [t.index, t.branch]), [[3, 'feat/run-9'], [4, 'feat/run-10']]);
    assert.equal(rec.baseMerged[how === 'resume' ? 'onResume' : 'onAnswer'], true);
    assert.equal(g(repo, 'diff', '--name-only', eight.h.checkpointRefs[eight.key], 'feat/run-8'), 'eight.txt', `${how}: the diff holds only run 8's commits`);
    assert.equal(noMergeStarted(wt8), true);
  }
}));

/** A bare harness whose two take-ins only record their calls; `now` is what _takesInBeforeAnswerNow answers. */
function routedHarness(now) {
  const h = Object.create(RunHarness.prototype);
  const calls = [];
  const logged = [];
  h._takesInBeforeAnswerNow = () => now;
  h.takeInBeforeAnswer = async (_deps, opts) => { calls.push(['takeInBeforeAnswer', opts]); return { ok: true, merged: [] }; };
  h._takeInLatestFinished = async (opts) => { calls.push(['_takeInLatestFinished', opts]); };
  h._log = (...args) => { logged.push(args); };
  return { h, calls, logged };
}

test('RS5 (R-arch-5): a resume runs the stop\'s take-in when a stop\'s answer would, else dev\'s latest-finished merge with the live flag', async () => {
  for (const [now, env, want] of [
    [true, ON, [['takeInBeforeAnswer', { onResume: true }]]],
    [false, ON, [['_takeInLatestFinished', { smallRuns: true }]]],
    [false, { WORCA_FLAGS: undefined }, [['_takeInLatestFinished', { smallRuns: false }]]],
  ]) {
    await withEnvVars(env, async () => {
      const { h, calls } = routedHarness(now);
      await h._takeInOnResume();
      assert.deepEqual(calls, want, `takes in before an answer: ${now}, WORCA_FLAGS: ${env.WORCA_FLAGS}`);
    });
  }
});

test('RS6 (R-arch-5): a resume take-in that throws is logged and is never the resume\'s outcome', () => withEnvVars(ON, async () => {
  for (const [now, method] of [[true, 'takeInBeforeAnswer'], [false, '_takeInLatestFinished']]) {
    const { h, logged } = routedHarness(now);
    h[method] = async () => { throw new Error('boom'); };
    await assert.doesNotReject(async () => { await h._takeInOnResume(); }, method);
    assert.deepEqual(logged.map((l) => l.slice(0, 3)),
      [['worktree', 'warn', 'resume: could not take in the finished work: boom']], method);
  }
}));

test('RS7 (R-arch-5): resume has exactly one take-in call, _takeInOnResume()', () => {
  const body = RunHarness.prototype._resume.toString();
  assert.equal((body.match(/this\._takeInOnResume\(/g) || []).length, 1, 'one call to _takeInOnResume');
  assert.deepEqual(body.match(/this\.(_takeInLatestFinished|takeInBeforeAnswer|_takeInNow|_mergeLatestOnResume)\(/g) || [], [],
    'no other take-in call in the resume');
});
