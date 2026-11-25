// test/helpers/shape-sixteen-runs.mjs — the real 16-run feature ("CI as a trusted merge gate, and a faster test suite")
// as a fixture: its builds-on links, and a way to put each run in a state (unrun, a pipeline status, an open or held
// stop, asking, approval). Everything is built in the temp DB (useTempHome); the real database is never read.
// `startable()` reads the scheduler's own answer (sliceGateState) for every run that has not started.
import { getDb } from '../../src/core/db.mjs';
import { projectKey } from '../../src/core/store.mjs';
import { getTicket } from '../../src/core/scheduler.mjs';
import { createSliceFeature, liveSliceFrom, sliceGateState } from '../../src/core/shape/features.mjs';
import { seedPipelineRow } from './db-seed.mjs';

/** Run number → the run numbers it builds on (no run is a change run). */
export const SIXTEEN_RUN_LINKS = Object.freeze([
  [1, []], [2, [1]], [3, [1]], [4, [1, 3]], [5, [3, 4]], [6, [3, 5]], [7, [1, 2, 3, 4, 5, 6]], [8, [1, 2]],
  [9, []], [10, [3]], [11, []], [12, [1, 7, 10]], [13, [11]], [14, [11, 13]], [15, [8, 13, 14]], [16, [9, 11, 12, 13, 14, 15]],
].map(([run, dependsOn]) => Object.freeze({ run, dependsOn: Object.freeze(dependsOn) })));

const STOP_KIND = { requirement: 'plan', check: 'gate', objection: 'gate' };
let seq = 0;

/**
 * @param {{projectDir:string, smallRuns?:boolean}} o  `smallRuns` marks the origin run (shape_stats), not the flag.
 * @returns {{featureId:string, originPipelineId:string, ticketOf:(run:number)=>string|null,
 *   pipelineOf:(run:number)=>string|null, setRun:(run:number, how:any)=>void, live:(pid:string)=>object|null}}
 *   `how`: 'unrun' | { pipe: status } | { stop: reason, held?: boolean } | { asking: true } | { approval: true }
 */
export function sixteenRunFeature({ projectDir, smallRuns = true }) {
  const db = getDb();
  const key = projectKey(projectDir);
  const newPipe = (status) => {
    const id = `s16-${String(++seq).padStart(5, '0')}`;   // 9 characters: a run reference GET /api/ask/runs/:id takes (ASK_RUN_REF_RE)
    seedPipelineRow({ id, projectKey: key, status, title: id, branch: { source: 'main', feature: `feat/${id}` } });
    return id;
  };
  const slice = ({ run, dependsOn }) => ({ id: `s${run}`, title: `Run ${run}`, goal: `Goal ${run}`, inScope: [`do ${run}`],
    outOfScope: [], acceptance: [`ok ${run}`], dependsOn: dependsOn.map((d) => `s${d}`), estimate: 'M' });
  const originPipelineId = newPipe('done');
  const f = createSliceFeature({ pipelineId: originPipelineId, projectDir, title: 'CI as a trusted merge gate', smallRuns: false,
    outline: { why: 'because', slices: SIXTEEN_RUN_LINKS.map(slice) }, perspectives: ['product'], workflowId: 'wf_shape' });
  if (smallRuns) db.prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?')
    .run(JSON.stringify({ questions: { asked: 0, skipped: 0 }, revises: [], shapeScore: null, smallRuns: true }), originPipelineId);
  const rows = db.prepare('SELECT * FROM shape_feature_slices WHERE feature_id = ? ORDER BY idx').all(f.id);
  const ticketOf = (run) => rows[run - 1]?.ticket_id || null;
  const pipes = new Map([[1, originPipelineId]]);
  const liveMap = new Map();
  const live = (pid) => liveMap.get(pid) || null;
  const pipelineOf = (run) => pipes.get(run) || null;

  const setRun = (run, how) => {
    if (how === 'unrun') throw new Error('a run cannot go back to unrun');
    const status = how.pipe || 'running';
    let pid = pipes.get(run);
    if (!pid) {
      pid = newPipe(status);
      pipes.set(run, pid);
      db.prepare('UPDATE scheduled_runs SET status = ?, pipeline_id = ? WHERE id = ?').run('fired', pid, ticketOf(run));
    } else db.prepare('UPDATE pipelines SET status = ? WHERE id = ?').run(status, pid);
    liveMap.delete(pid);
    let pq = null;
    let heldStop = null;
    if (how.stop) {
      pq = { id: `q${run}`, kind: STOP_KIND[how.stop], stop: { reason: how.stop, run } };
      if (how.held) heldStop = { id: `q${run}`, after: Number.isInteger(how.after) ? how.after : 2 };   // s4 D14: held behind any run
    } else if (how.asking) pq = { id: `q${run}`, kind: 'questions' };
    else if (how.approval) pq = { id: `q${run}`, kind: 'plan' };
    if (pq) liveMap.set(pid, liveSliceFrom({ runId: `r${run}`, status: 'running', approved: true, pendingQuestion: pq, heldStop }));
  };
  const cancelTicket = (run) => { db.prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE id = ?").run(ticketOf(run)); };
  const setKind = (run, kind) => { db.prepare('UPDATE shape_feature_slices SET kind = ? WHERE feature_id = ? AND idx = ?').run(kind, f.id, run); };
  return { featureId: f.id, originPipelineId, ticketOf, pipelineOf, setRun, live, cancelTicket, setKind };
}

/** Named walked states (slice 2 D11): `done` run numbers finished, then each `{run: how}` applied. */
export const SIXTEEN_RUN_STATES = Object.freeze({
  base: { done: [1, 11], states: { 2: { stop: 'requirement' }, 3: { pipe: 'running' } } },
  busy: { done: [1, 3], states: { 2: { stop: 'requirement' }, 4: { stop: 'check' }, 11: { stop: 'check' }, 5: { pipe: 'error' }, 6: { pipe: 'running' } } },
});

/** A fresh feature in a named state (or a literal `{done, states}`); cancels the previous features' scheduled tickets first. */
export function world(projectDir, spec) {
  const { done, states } = typeof spec === 'string' ? SIXTEEN_RUN_STATES[spec] : spec;
  getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
  const fx = sixteenRunFeature({ projectDir });
  for (const r of done) fx.setRun(r, { pipe: 'done' });
  for (const [r, how] of Object.entries(states || {})) fx.setRun(Number(r), how);
  return fx;
}

/** The sorted run numbers of the runs not started yet (ticket scheduled, no pipeline) that the scheduler's gate lets start. */
export function startable(fx) {
  const out = [];
  for (let run = 2; run <= SIXTEEN_RUN_LINKS.length; run++) {
    const t = getTicket(fx.ticketOf(run));
    if (!t || t.status !== 'scheduled' || fx.pipelineOf(run)) continue;
    if (sliceGateState(t, { live: fx.live })?.state === 'ok') out.push(run);
  }
  return out.sort((a, b) => a - b);
}
