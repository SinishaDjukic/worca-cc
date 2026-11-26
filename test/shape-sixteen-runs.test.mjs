// test/shape-sixteen-runs.test.mjs — Slice 1 (R-arch-5): several live runs of one feature, replayed on the real 16-run
// feature (test/helpers/shape-sixteen-runs.mjs). Each moment asserts the scheduler's own answer (sliceGateState).
// Slice 2 adds the payload tests (T1 to T7): the waitsFor, cannotStart and nextTurn that src/core/shape/features.mjs
// sends in featureView and the Runs list.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { withEnv as withEnvVars } from './helpers/with-env.mjs';
import { getDb } from '../src/core/db.mjs';
import { createTicket, getTicket, predecessorState } from '../src/core/scheduler.mjs';
import { listRunGroups } from '../src/core/run-groups.mjs';
import { busySliceOf, featureView, liveSliceFrom, resumeFeature, setApproveEach, sliceGateState, sliceOfPipeline,
  clashHoldOf, dependencyBranchesOf, featureBase, featureHoldsTicket, setClashHold, ticketHeld } from '../src/core/shape/features.mjs';
import { sliceChainGate, heldStopTurn, latestFinishedSource, sliceSourceOf, sliceCombineGate, combineDependencies } from '../src/core/shape/chain.mjs';
import { SIXTEEN_RUN_LINKS, sixteenRunFeature, siblingRunsFeature, startable, world, SIXTEEN_RUN_STATES } from './helpers/shape-sixteen-runs.mjs';
import { runStatus, namedWaits } from '../src/shared/shape/run-status.mjs';
// Slice 6: a namespace read, so a missing new export fails only its own test, not the whole file.
import * as RS from '../src/shared/shape/run-status.mjs';
import { projectKey } from '../src/core/store.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { g, GITCONFIG } from './helpers/base-world.mjs';
import { checkBaseMerge, mergeBaseInto } from '../src/core/git-sync.mjs';
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

test('M5a (boot race, follow-up run before slice 2): run 8 resuming at boot reads as a paused row with no live entry, so run 10 starts', () => {
  const m4 = world(root, { done: M4_DONE, states: { 5: { pipe: 'paused' } } });
  const boot = world(root, { done: M4_DONE, states: { 5: { pipe: 'paused' }, 8: { pipe: 'paused' } } });
  const status = (fx, run) => getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(fx.pipelineOf(run)).status;
  // The gate cannot tell run 8 (boot resume) from run 5 (person pause): the same paused row, live null.
  assert.equal(status(m4, 5), 'paused');
  assert.equal(status(boot, 8), 'paused');
  assert.equal(m4.live(m4.pipelineOf(5)), null);
  assert.equal(boot.live(boot.pipelineOf(8)), null);
  assert.deepEqual(startable(boot), [10]);
});

test('M5b: runs 8 and 10 going while run 5 is paused: nothing starts; a stop answer of run 5 would wait for run 8 (a resume reads no turn)', () => {
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
// A1 and A4 assert TODAY'S outcome of the waited run's take-in (slice 3 changes it); A2 and A3 assert that a run starts
// with the work of every run it builds on (slice 2). The cause, in short (the full write-up with file:line is
// missing-work-cause.md in slice 1's pipeline folder):
// 1. A waited run's take-in runs before the finished sibling's work is committed: run 9 sends `done` before its teardown
//    commits onto feat/run-9, so checkBaseMerge reads up-to-date and the take-in skips silently (A1); while the sibling
//    is still merging back, latestFinishedSource returns {pending:true} and the take-in skips too (A4).
// 2. A run's start ignores dependsOn: sliceSourceOf starts run 10 from the branch of the run that finished last only,
//    so the other sibling's work is missing whichever finishes last (A2, A3).

const commitFile = (cwd, file) => { writeFileSync(join(cwd, file), `${file}\n`); g(cwd, 'add', file); g(cwd, 'commit', '-qm', file); };
/** Commit src/a.mjs (a fixture file of the temp repo) with `value` on its one line. */
const writeShared = (cwd, value) => {
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'a.mjs'), `export const a = '${value}';\n`);
  g(cwd, 'add', 'src/a.mjs');
  g(cwd, 'commit', '-qm', `a ${value}`);
};
const head = (cwd, ref) => g(cwd, 'rev-parse', ref);
// The raw probes drop an inherited GIT_DIR / GIT_WORK_TREE so they always read the repo at cwd.
const probeEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'GIT_DIR' && k !== 'GIT_WORK_TREE'));
const isAncestorExit = (cwd, commit, ref) => spawnSync('git', ['merge-base', '--is-ancestor', commit, ref], { cwd, encoding: 'utf8', env: probeEnv() }).status;
const filesOn = (cwd, ref) => g(cwd, 'ls-tree', '-r', '--name-only', ref).split('\n').sort();
const minute = (n) => new Date(Date.UTC(2026, 0, 1, 12, n)).toISOString();
const record = (run, source = 'feat/run-7') => ({ source, feature: `feat/run-${run}` });

/** A local repo with no remote and the incident's moment: run 7 done; runs 8 and 9 branched from it, each in its own
 *  worktree; run 8 has committed and is running; run 9 has written nine.txt and not committed it. Run 9's row is
 *  `running` until the test finishes it. */
function siblingWorld({ shared = false } = {}) {
  const dir = mkdtempSync(join(root, 'siblings-'));
  const repo = join(dir, 'repo');
  const wt8 = join(dir, 'wt8');
  const wt9 = join(dir, 'wt9');
  g(dir, 'init', '-q', '-b', 'dev', 'repo');
  commitFile(repo, 'base.txt');
  g(repo, 'checkout', '-q', '-b', 'feat/run-7');
  commitFile(repo, 'seven.txt');
  if (shared) writeShared(repo, 'seven');   // src/a.mjs, which runs 8 and 9 may both change
  g(repo, 'checkout', '-q', 'dev');
  g(repo, 'worktree', 'add', '-q', '-b', 'feat/run-8', wt8, 'feat/run-7');
  g(repo, 'worktree', 'add', '-q', '-b', 'feat/run-9', wt9, 'feat/run-7');
  commitFile(wt8, 'eight.txt');
  writeFileSync(join(wt9, 'nine.txt'), 'nine.txt\n');
  const fx = siblingRunsFeature({ projectDir: repo });
  fx.finish(7, { at: minute(0), branch: { feature: 'feat/run-7' } });
  fx.start(8, { branch: record(8) });
  fx.start(9, { branch: record(9) });
  return { repo, wt8, wt9, fx };
}

/** Run 8's harness with only what the take-in reads, recording what it logs and each merge it asks for. */
function waitedRunHarness({ repo, wt8, fx }) {
  const h = Object.create(RunHarness.prototype);
  h.runShape = { slice: { feature: fx.featureId } };
  h.branchInfo = { branch: 'feat/run-8', worktreeDir: wt8 };
  h.members = [{ projectDir: repo, projectKey: projectKey(repo) }];
  h.pipeline = { id: fx.pipelineOf(8) };
  h.isWorkspace = false;
  const logged = [];
  h._log = (...args) => { logged.push(args); };
  const merges = [];
  h._mergeLatestOnResume = (m, info, base, opts) => {
    merges.push({ base, opts });
    return RunHarness.prototype._mergeLatestOnResume.call(h, m, info, base, opts);
  };
  return { h, logged, merges };
}

const noMergeStarted = (wt) => spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: wt, env: probeEnv() }).status !== 0;

// Cause 1 (report above): run 9's row reads `done` before teardown commits its work, so run 8's take-in finds nothing
// newer on feat/run-9 and skips with no log. Slice 3 adds the take-in of committed sibling work and its own live-order
// test (the order `done` frame, delivery, teardown commit is read from the code, not driven here).
test('A1 (R-qa-1): run 8 goes on while run 9 reads done with uncommitted work: the take-in finds nothing and never takes run 9 in', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  const { repo, wt8, wt9, fx } = w;
  fx.finish(9, { at: minute(1) });
  assert.deepEqual(latestFinishedSource(fx.featureId, { exclude: fx.pipelineOf(8) }),
    { pipelineId: fx.pipelineOf(9), sourceBranch: 'feat/run-9' });
  assert.equal(head(repo, 'feat/run-9'), head(repo, 'feat/run-7'), 'run 9\'s branch still sits at run 7\'s tip');
  const early = await checkBaseMerge(repo, { base: 'feat/run-9', feature: 'feat/run-8' });
  assert.deepEqual([early.status, early.behind, early.baseRef], ['up-to-date', 0, 'feat/run-9']);

  const eight = head(repo, 'feat/run-8');
  const { h, logged, merges } = waitedRunHarness(w);
  await h._takeInLatestFinished({ smallRuns: true, onAnswer: true });
  assert.deepEqual(merges, [{ base: 'feat/run-9', opts: { onAnswer: true } }], 'the take-in reached the merge check');
  assert.equal(head(repo, 'feat/run-8'), eight);
  assert.equal(noMergeStarted(wt8), true);
  assert.deepEqual(logged, []);

  // Run 9's teardown commit lands a moment later.
  g(wt9, 'add', 'nine.txt');
  g(wt9, 'commit', '-qm', 'nine.txt');
  const late = await checkBaseMerge(repo, { base: 'feat/run-9', feature: 'feat/run-8' });
  assert.deepEqual([late.status, late.behind], ['clean', 1]);
  assert.equal(isAncestorExit(repo, head(repo, 'feat/run-9'), 'feat/run-8'), 1, 'run 9\'s commit is not in run 8\'s branch');
}));

// Cause 1, its second silent skip (report above): a finished run still merging back reads {pending:true}, and the
// take-in neither logs nor retries. Slice 3 adds the take-in of committed sibling work and its own live-order test.
test('A4 (R-qa-1): while the latest finished run still merges back, the take-in skips with nothing logged', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  const { repo, wt8, wt9, fx } = w;
  // Run 9's work is committed, so only the pending merge back can be what keeps it out.
  g(wt9, 'add', 'nine.txt');
  g(wt9, 'commit', '-qm', 'nine.txt');
  // Now, not a fixed time: mergeBackPending reads the row as pending only while its finish is recent by the real clock.
  fx.finish(9, { at: new Date().toISOString(), branch: { ...record(9), sameAsSource: true, worktreeDir: wt9 } });
  assert.deepEqual(latestFinishedSource(fx.featureId, { exclude: fx.pipelineOf(8) }), { pending: true });

  const eight = head(repo, 'feat/run-8');
  const { h, logged, merges } = waitedRunHarness(w);
  await h._takeInLatestFinished({ smallRuns: true, onAnswer: true });
  assert.deepEqual(merges, [], 'no merge is asked for');
  assert.equal(head(repo, 'feat/run-8'), eight);
  assert.equal(noMergeStarted(wt8), true);
  assert.deepEqual(logged, []);
}));

// ---- Slice 2 (R-po-1, R-arch-4a): a run starts with the work of every run it builds on ------------------------------
// The card's run numbers are the slice numbers: the runs labelled 7, 8, 9 and 10 here are the card's runs 1 to 4.
const CLASH = 'runs 2 and 3 clash in src/a.mjs';
const refsOf = (repo) => g(repo, 'for-each-ref');
const cleanTree = (wt) => g(wt, 'status', '--porcelain');
const auditOf = (id) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY rowid').all(id).map((r) => r.text);
const combinedLine = (card, run) => `Combined the work of run ${card} (\`feat/run-${run}\`) into \`feat/run-10\` before the first agent.`;

/** Runs 8 and 9 both committed and done, neither holding the other's work. `clash`: both change the same line of
 *  src/a.mjs. */
function doneSiblings({ eightAt = minute(2), nineAt = minute(1), clash = false } = {}) {
  const w = siblingWorld({ shared: clash });
  if (clash) {
    writeShared(w.wt8, 'eight');
    writeFileSync(join(w.wt9, 'src', 'a.mjs'), "export const a = 'nine';\n");
  }
  g(w.wt9, 'add', '-A');
  g(w.wt9, 'commit', '-qm', 'nine.txt');
  w.fx.finish(8, { at: eightAt });
  w.fx.finish(9, { at: nineAt });
  return { ...w, eight: head(w.repo, 'feat/run-8'), nine: head(w.repo, 'feat/run-9') };
}

let tenSeq = 0;
/** Run 10's worktree on a new branch from `source` (as createWorktree makes it), and a harness with only what the
 *  combine reads and writes. */
function runTen({ repo, fx }, source) {
  const wt10 = join(dirname(repo), 'wt10');
  g(repo, 'worktree', 'add', '-q', '-b', 'feat/run-10', wt10, source);
  const start = head(repo, 'feat/run-10');
  const id = `a10${String(++tenSeq).padStart(5, '0')}`;   // 8 hex characters: appendAudit reads it from the run dir
  const key = projectKey(repo);
  seedPipelineRow({ id, projectKey: key, status: 'running', title: id, branch: { source, feature: 'feat/run-10' } });
  const h = Object.create(RunHarness.prototype);
  h.runShape = { slice: { feature: fx.featureId, index: 4 } };
  h.members = [{ projectDir: repo, projectKey: key }];
  h.isWorkspace = false;
  h.pipeline = { id, dir: join(root, `run-ten-${id}`) };
  h.state = { branches: { [key]: { source, feature: 'feat/run-10', worktreeDir: wt10, baseSha: start, diffBase: start, startHead: start } } };
  h.checkpointRefs = { [key]: start };
  const logged = [];
  h._log = (...args) => { logged.push(args); };
  const combine = () => h._combineDependencies(h.members[0], { branch: 'feat/run-10', worktreeDir: wt10 }, h.runShape.slice);
  const record = () => h.state.branches[key];
  const checkpoint = () => h.checkpointRefs[key];
  return { h, wt10, start, id, logged, combine, record, checkpoint };
}

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
