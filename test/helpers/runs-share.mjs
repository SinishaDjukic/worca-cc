// test/helpers/runs-share.mjs — a minimal run for the run-sharing publisher (run sharing s1): an EventEmitter with the
// fields attachRunShare reads, backed by a real pipelines row (recordFromRow), plus a counting git runner.
// Tests using it delete WORCA_MOCK / ORCH_MOCK in before(): isMockRun reads them.
import { EventEmitter } from 'node:events';
import { getDb } from '../../src/core/db.mjs';
import { runGit } from '../../src/core/metrics/sync.mjs';
import { seedPipelineRow } from './db-seed.mjs';

/**
 * @param {{projectDir:string, projectKey:string, runId:string, status?:string}} o
 * @returns {EventEmitter & {emitState(patch:object):void, emitDone(status:string):void}}
 */
export function shareHarness({ projectDir, projectKey, runId, status = 'running' }) {
  const h = new EventEmitter();
  const at = new Date().toISOString();
  h.pipeline = { id: runId, dir: null, promptText: 'a prompt' };
  h.claude = { mock: false };
  h.members = [{ projectKey, projectDir }];
  h.projectDir = projectDir;
  h.workflowId = 'wf_default';
  h.state = { id: runId, status, phase: 'plan', totalCostUsd: 0, startedAt: at, updatedAt: at, steps: [] };
  seedPipelineRow({ id: runId, projectKey, status, phase: 'plan', startedAt: at, updatedAt: at, title: 'a title', prompt: 'a prompt' });
  h.emitState = (patch = {}) => {
    Object.assign(h.state, patch, { updatedAt: new Date().toISOString() });
    h.emit('state', h.state);
  };
  h.emitDone = (end = 'done') => {
    Object.assign(h.state, { status: end, phase: end === 'done' ? 'done' : h.state.phase, updatedAt: new Date().toISOString() });
    getDb().prepare('UPDATE pipelines SET status = ?, phase = ?, updated_at = ?, total_cost_usd = ? WHERE id = ?')
      .run(end, h.state.phase, h.state.updatedAt, h.state.totalCostUsd || 0, runId);
    h.emit('done', { status: end, pipelineDir: null });
  };
  return h;
}

/** runGit, recording every argv in `.calls`. */
export function gitCounter() {
  const calls = [];
  const fn = (cwd, args, opts) => { calls.push(args); return runGit(cwd, args, opts); };
  fn.calls = calls;
  return fn;
}
