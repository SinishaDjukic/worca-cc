// test/shape-sixteen-runs.test.mjs — Slice 1 (R-arch-5): several live runs of one feature, replayed on the real 16-run
// feature (test/helpers/shape-sixteen-runs.mjs). Each moment asserts the scheduler's own answer (sliceGateState).
// Slice 2 adds the payload tests (T1 to T7): the waitsFor, cannotStart and nextTurn that src/core/shape/features.mjs
// sends in featureView and the Runs list.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { withEnv as withEnvVars } from './helpers/with-env.mjs';
import { getDb } from '../src/core/db.mjs';
import { createTicket, getTicket, predecessorState } from '../src/core/scheduler.mjs';
import { listRunGroups } from '../src/core/run-groups.mjs';
import { busySliceOf, featureView, liveSliceFrom, resumeFeature, setApproveEach, sliceGateState, sliceOfPipeline } from '../src/core/shape/features.mjs';
import { sliceChainGate, heldStopTurn } from '../src/core/shape/chain.mjs';
import { SIXTEEN_RUN_LINKS, sixteenRunFeature, startable, world, SIXTEEN_RUN_STATES } from './helpers/shape-sixteen-runs.mjs';
import { runStatus, namedWaits } from '../src/shared/shape/run-status.mjs';
// Slice 6: a namespace read, so a missing new export fails only its own test, not the whole file.
import * as RS from '../src/shared/shape/run-status.mjs';
import { projectKey } from '../src/core/store.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';

useTempHome(after, 'worca-shape-sixteen-');
const root = mkdtempSync(join(tmpdir(), 'worca-shape-sixteen-proj-'));
after(() => rmSync(root, { recursive: true, force: true }));
before(() => { getDb(); });

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
