// test/helpers/shape-sixteen-runs.mjs — the real 16-run feature ("CI as a trusted merge gate, and a faster test suite")
// as a fixture: its builds-on links, and a way to put each run in a state (unrun, a pipeline status, an open or held
// stop, asking, approval, being resumed at server start). Everything is built in the temp DB (useTempHome); the real database is never read.
// `startable()` reads the scheduler's own answer (sliceGateState) for every run that has not started.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getDb } from '../../src/core/db.mjs';
import { projectKey } from '../../src/core/store.mjs';
import { getTicket } from '../../src/core/scheduler.mjs';
import { createSliceFeature, liveSliceFrom, sliceGateState } from '../../src/core/shape/features.mjs';
// A namespace read, so a missing liveSliceResuming fails only the tests that use `resuming`, not every importer.
import * as features from '../../src/core/shape/features.mjs';
import { g } from './base-world.mjs';
import { seedPipelineRow } from './db-seed.mjs';

export { g };

/** Run number → the run numbers it builds on (no run is a change run). */
export const SIXTEEN_RUN_LINKS = Object.freeze([
  [1, []], [2, [1]], [3, [1]], [4, [1, 3]], [5, [3, 4]], [6, [3, 5]], [7, [1, 2, 3, 4, 5, 6]], [8, [1, 2]],
  [9, []], [10, [3]], [11, []], [12, [1, 7, 10]], [13, [11]], [14, [11, 13]], [15, [8, 13, 14]], [16, [9, 11, 12, 13, 14, 15]],
].map(([run, dependsOn]) => Object.freeze({ run, dependsOn: Object.freeze(dependsOn) })));

const STOP_KIND = { requirement: 'plan', check: 'gate', objection: 'gate' };
let seq = 0;

/**
 * @param {{projectDir:string, smallRuns?:boolean, held?:object}} o  `smallRuns` marks the origin run (shape_stats), not
 *   the flag. `held`: a held-stops instance (createHeldStops) whose overlay `live` reads, as the server's liveSliceOf does.
 * @returns {{featureId:string, originPipelineId:string, ticketOf:(run:number)=>string|null,
 *   pipelineOf:(run:number)=>string|null, setRun:(run:number, how:any)=>void, live:(pid:string)=>object|null,
 *   useHeld:(held:object)=>void}}  `useHeld` swaps the instance (a restart).
 *   `how`: 'unrun' | { pipe: status } | { stop: reason, held?: boolean } | { asking: true } | { approval: true }
 *   | { pipe: status, resuming: true } (being resumed at server start: no runs-map entry, liveSliceResuming's overlay)
 *   | { pipe: 'paused', heldResume: N } (its resume is held behind run N: liveSliceHeldResume's overlay)
 */
export function sixteenRunFeature({ projectDir, smallRuns = true, held = null }) {
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
  let heldStops = held;
  const useHeld = (h) => { heldStops = h; };
  const live = (pid) => {
    const l = liveMap.get(pid) || null;
    return heldStops?.overlay ? heldStops.overlay(pid, l) : l;
  };
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
    if (how.resuming) liveMap.set(pid, features.liveSliceResuming());
    if (Number.isInteger(how.heldResume)) liveMap.set(pid, features.liveSliceHeldResume(liveMap.get(pid) || null, how.heldResume));
  };
  const cancelTicket = (run) => { db.prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE id = ?").run(ticketOf(run)); };
  const setKind = (run, kind) => { db.prepare('UPDATE shape_feature_slices SET kind = ? WHERE feature_id = ? AND idx = ?').run(kind, f.id, run); };
  return { featureId: f.id, originPipelineId, ticketOf, pipelineOf, setRun, live, useHeld, cancelTicket, setKind };
}

/** Named walked states (slice 2 D11): `done` run numbers finished, then each `{run: how}` applied. */
export const SIXTEEN_RUN_STATES = Object.freeze({
  base: { done: [1, 11], states: { 2: { stop: 'requirement' }, 3: { pipe: 'running' } } },
  busy: { done: [1, 3], states: { 2: { stop: 'requirement' }, 4: { stop: 'check' }, 11: { stop: 'check' }, 5: { pipe: 'error' }, 6: { pipe: 'running' } } },
});

/** A fresh feature in a named state (or a literal `{done, states}`); cancels the previous features' scheduled tickets first. */
export function world(projectDir, spec, { held = null } = {}) {
  const { done, states } = typeof spec === 'string' ? SIXTEEN_RUN_STATES[spec] : spec;
  getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
  const fx = sixteenRunFeature({ projectDir, held });
  for (const r of done) fx.setRun(r, { pipe: 'done' });
  for (const [r, how] of Object.entries(states || {})) fx.setRun(Number(r), how);
  return fx;
}

/** The missing-work case, labelled by its run numbers: 8 and 9 build on 7, and 10 builds on 8 and 9. */
const SIBLING_RUNS = Object.freeze([[7, []], [8, [7]], [9, [7]], [10, [8, 9]]]);

/**
 * A small-runs feature of runs 7 to 10 (slices 1 to 4; run 7 is the origin pipeline) whose pipeline rows carry real
 * branch records. Cancels the previous features' scheduled tickets first, as `world` does.
 * @param {{projectDir:string, smallRuns?:boolean}} o  `smallRuns` marks the origin run (shape_stats), not the flag.
 * @returns {{featureId:string, ticketOf:(run:number)=>string|null, pipelineOf:(run:number)=>string|null,
 *   start:(run:number, how:{branch:object})=>void, finish:(run:number, how:{at:string, branch?:object})=>void}}
 *   `start` seeds the run's `running` pipeline and fires its ticket; `finish` marks it `done` at `at` (ISO).
 */
export function siblingRunsFeature({ projectDir, smallRuns = true }) {
  const db = getDb();
  db.prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
  const key = projectKey(projectDir);
  const newPipe = (status, branch) => {
    const id = `5b${String(++seq).padStart(6, '0')}`;   // 8 hex characters: appendAudit reads it from a run dir
    seedPipelineRow({ id, projectKey: key, status, title: id, branch });
    return id;
  };
  const slice = ([run, dependsOn]) => ({ id: `s${run}`, title: `Run ${run}`, goal: `Goal ${run}`, inScope: [`do ${run}`],
    outOfScope: [], acceptance: [`ok ${run}`], dependsOn: dependsOn.map((d) => `s${d}`), estimate: 'M' });
  const originPipelineId = newPipe('done', { source: 'dev', feature: 'feat/run-7' });
  const f = createSliceFeature({ pipelineId: originPipelineId, projectDir, title: 'Sibling runs', smallRuns: false,
    outline: { why: 'because', slices: SIBLING_RUNS.map(slice) }, perspectives: ['product'], workflowId: 'wf_shape' });
  if (smallRuns) db.prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?')
    .run(JSON.stringify({ questions: { asked: 0, skipped: 0 }, revises: [], shapeScore: null, smallRuns: true }), originPipelineId);
  const rows = db.prepare('SELECT * FROM shape_feature_slices WHERE feature_id = ? ORDER BY idx').all(f.id);
  const indexOf = (run) => {
    const i = SIBLING_RUNS.findIndex(([r]) => r === run);
    if (i < 0) throw new Error(`no such run: ${run}`);
    return i;
  };
  const pipes = new Map([[7, originPipelineId]]);
  const ticketOf = (run) => rows[indexOf(run)].ticket_id || null;
  const pipelineOf = (run) => pipes.get(run) || null;
  const start = (run, { branch }) => {
    const ticket = ticketOf(run);
    const pid = newPipe('running', branch);
    pipes.set(run, pid);
    db.prepare('UPDATE scheduled_runs SET status = ?, pipeline_id = ? WHERE id = ?').run('fired', pid, ticket);
  };
  const finish = (run, { at, branch }) => {
    indexOf(run);
    db.prepare("UPDATE pipelines SET status = 'done', updated_at = ? WHERE id = ?").run(at, pipelineOf(run));
    if (branch) db.prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify(branch), pipelineOf(run));
  };
  return { featureId: f.id, ticketOf, pipelineOf, start, finish };
}

// ---- Real git branches for the sibling runs (7 to 10) ----------------------------------------------------------------
export const commitFile = (cwd, file) => { writeFileSync(join(cwd, file), `${file}\n`); g(cwd, 'add', file); g(cwd, 'commit', '-qm', file); };
/** Commit src/a.mjs (a fixture file of the temp repo) with `value` on its one line. */
export const writeShared = (cwd, value) => {
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'a.mjs'), `export const a = '${value}';\n`);
  g(cwd, 'add', 'src/a.mjs');
  g(cwd, 'commit', '-qm', `a ${value}`);
};
export const head = (cwd, ref) => g(cwd, 'rev-parse', ref);
// The raw probes drop an inherited GIT_DIR / GIT_WORK_TREE so they always read the repo at cwd.
export const probeEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'GIT_DIR' && k !== 'GIT_WORK_TREE'));
export const isAncestorExit = (cwd, commit, ref) => spawnSync('git', ['merge-base', '--is-ancestor', commit, ref], { cwd, encoding: 'utf8', env: probeEnv() }).status;
export const minute = (n) => new Date(Date.UTC(2026, 0, 1, 12, n)).toISOString();
export const record = (run, source = 'feat/run-7') => ({ source, feature: `feat/run-${run}` });

/**
 * The git worlds and the harness stand-ins of the sibling runs, writing under the caller's temp `root`. `RunHarness`
 * is passed in, so a file that only seeds rows through this helper does not load the harness. The caller sets
 * useTempHome and a temp GIT_CONFIG_GLOBAL.
 */
export function siblingKit({ root, RunHarness }) {
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

  let eightSeq = 0;
  /** Run 8's harness with only what the take-in reads and writes (the card's run 2), recording what it logs, how often
   *  it persists and each answer it is handed. */
  function waitedRunHarness({ repo, wt8, fx }) {
    const key = projectKey(repo);
    const id = fx.pipelineOf(8);
    const start = head(repo, 'feat/run-7');
    const rec = () => ({ source: 'feat/run-7', feature: 'feat/run-8', worktreeDir: wt8, baseSha: start, diffBase: start, startHead: start });
    const h = Object.create(RunHarness.prototype);
    h.runShape = { slice: { feature: fx.featureId, index: 2 } };
    h.branchInfo = { branch: 'feat/run-8', worktreeDir: wt8 };
    h.members = [{ projectDir: repo, projectKey: key }];
    h.memberByKey = new Map(h.members.map((m) => [m.projectKey, m]));
    h.projectDir = repo;
    h.isWorkspace = false;
    h.workMode = 'git';
    h.execEnvKind = 'local';
    h.workDirs = new Map([[key, wt8]]);
    h.checkpointRefs = { [key]: start };
    h.pipeline = { id, dir: join(root, `run-eight-${++eightSeq}-${id}`) };
    h.state = { status: 'running', branch: rec(), branches: { [key]: rec() } };
    const persisted = [];
    h._persist = async () => { persisted.push(structuredClone(h.state.branches[key])); return true; };
    const logged = [];
    h._log = (...args) => { logged.push(args); };
    const answers = [];
    h.answer = (qid, payload, by) => { answers.push({ id: qid, payload, by }); };
    const record = () => h.state.branches[key];
    return { h, logged, answers, persisted, key, start, record };
  }

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

  return { siblingWorld, waitedRunHarness, doneSiblings, runTen };
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
