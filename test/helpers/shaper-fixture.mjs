// test/helpers/shaper-fixture.mjs — Shaper s2 (D18): the recorded 3-run feature the golden replay plays back. Each frame is
// what the Chat feature card reads at one moment: the planning run's snapshot, the real shaperCard() over the real tables,
// and the members' live snapshots. The outline is the mock planner's (MOCK_SLICES → MOCK_OUTLINE_3); the audit lines are
// run-harness.mjs _auditDecision's words.
import { seedPipelineRow } from './db-seed.mjs';
import { getDb } from '../../src/core/db.mjs';
import { writeClarify, appendAuditById } from '../../src/core/artifacts.mjs';
import { setTicketPipeline } from '../../src/core/scheduler.mjs';
import { createSliceFeature, shaperCard, liveSliceFrom } from '../../src/core/shape/features.mjs';
import { MOCK_OUTLINE_3 } from '../../src/core/engines/mock.mjs';
import { STAGE_LABEL } from '../../src/shared/run-progress.mjs';

const PK = 'proj-00000001';
const DIR = '/tmp/worca-shaper-golden';
const PIDS = ['5a0e0001', '5a0e0002', '5a0e0003'];
const prog = (stage, fraction, tone = 'blue') => ({ mode: 'stages', stage, label: STAGE_LABEL[stage], fraction, tone, text: STAGE_LABEL[stage] });
const snap = (i, status, { pq = null, stage = null, shaping = undefined } = {}) => ({
  source: 'live', terminal: status === 'done', runId: `run-${i + 1}`, pipelineId: PIDS[i], status, pendingQuestion: pq, stageProgress: stage,
  ...(shaping ? { shaping } : {}) });

/** @returns {Promise<Array<{label: string, own: object, card: object, snaps: object}>>} */
export async function recordShaperFeature() {
  for (const id of PIDS.slice(0, 1)) seedPipelineRow({ id, projectKey: PK, status: 'running', title: 'Charts' });
  const frames = [];
  const runs = new Map();                                  // index → live snapshot (the server's runs map)
  const frame = (label) => {
    // liveSliceOf's mapping: approved is the entry's shaping.approved, so a building run reads `running` (Building).
    const live = (pid) => {
      const m = [...runs.values()].find((x) => x.pipelineId === pid && !x.terminal);
      return m ? liveSliceFrom({ runId: m.runId, status: m.status, pendingQuestion: m.pendingQuestion, approved: m.shaping && m.shaping.approved }) : null;
    };
    const own = runs.get(0);
    const snaps = Object.fromEntries([...runs.entries()].filter(([i]) => i > 0).map(([, m]) => [m.pipelineId, m]));
    // shaped: the planning run's live entry carries state.shaping in every frame (the route reads it from the runs map).
    frames.push(JSON.parse(JSON.stringify({ label, own, card: shaperCard(PIDS[0], { live, shaped: () => true }), snaps })));
  };
  const Q = [{ id: 'q1', question: 'Where are charts stored?' }, { id: 'q2', question: 'Which chart kinds?' }];
  runs.set(0, snap(0, 'running', { stage: prog('plan', 0.05), shaping: { rounds: [] } }));
  frame('proposal');
  await writeClarify(PIDS[0], { questions: { questions: Q } });
  runs.set(0, snap(0, 'running', { stage: prog('plan', 0.1, 'amber'), shaping: { rounds: [] }, pq: { id: 'clarify-n_clarify-1', kind: 'clarify' } }));
  frame('clarify');
  await writeClarify(PIDS[0], { answers: { answers: [{ id: 'q1', choice: 'SQLite' }, { id: 'q2', choice: 'Bar and line' }] } });
  runs.set(0, snap(0, 'running', { stage: prog('plan', 0.2, 'amber'), shaping: { rounds: [] }, pq: { id: 'plan-outline-n_plan-1', kind: 'plan', plan: { outline: MOCK_OUTLINE_3, round: 1 } } }));
  frame('split');
  appendAuditById(PIDS[0], 'Slice outline **approve** (round 1).');
  const f = createSliceFeature({ pipelineId: PIDS[0], projectDir: DIR, title: 'Charts', outline: MOCK_OUTLINE_3, perspectives: ['product'], workflowId: 'wf_shape', startedBy: 'ann' });
  const tickets = getDb().prepare('SELECT idx, ticket_id FROM shape_feature_slices WHERE feature_id = ? ORDER BY idx').all(f.id);
  const shaping = { rounds: [], feature: { id: f.id, index: 1, total: 3 } };
  appendAuditById(PIDS[0], 'Plan approval **revise**.');
  runs.set(0, snap(0, 'running', { stage: prog('plan', 0.25, 'amber'), shaping, pq: { id: 'plan-n_refine-1', kind: 'plan', plan: { round: 2 } } }));
  frame('run1-plan');
  appendAuditById(PIDS[0], 'Plan approval **approve**.');
  runs.set(0, snap(0, 'running', { stage: prog('build', 0.5), shaping: { ...shaping, approved: { round: 2 } } }));
  frame('run1-build');
  for (const i of [1, 2]) {
    getDb().prepare('UPDATE pipelines SET status = ? WHERE id = ?').run('done', PIDS[i - 1]);
    if (runs.has(i - 1)) runs.set(i - 1, { ...runs.get(i - 1), status: 'done', terminal: true, stageProgress: prog('ready', 1, 'green') });
    seedPipelineRow({ id: PIDS[i], projectKey: PK, status: 'running', title: `Charts · run ${i + 1}` });
    setTicketPipeline(tickets[i].ticket_id, PIDS[i]);
    // A slice run is shaped too (sliceRequest carries `shape`): shaping.approved lands with its plan approval.
    runs.set(i, snap(i, 'running', { stage: prog('plan', 0.2, 'amber'), shaping: { rounds: [] }, pq: { id: 'plan-n_refine-1', kind: 'plan', plan: { round: 1 } } }));
    frame(`run${i + 1}-plan`);
    appendAuditById(PIDS[i], 'Plan approval **approve**.');
    runs.set(i, snap(i, 'running', { stage: prog(i === 2 ? 'review' : 'build', 0.6), shaping: { rounds: [], approved: { round: 1 } } }));
    frame(`run${i + 1}-${i === 2 ? 'review' : 'build'}`);
  }
  runs.set(2, snap(2, 'running', { stage: prog('review', 0.8, 'amber'), shaping: { rounds: [], approved: { round: 1 } }, pq: { id: 'gate-n_review-1', kind: 'gate' } }));
  frame('gate');
  appendAuditById(PIDS[2], 'Gate **another**.');
  getDb().prepare('UPDATE pipelines SET status = ? WHERE id = ?').run('done', PIDS[2]);
  runs.set(2, { ...runs.get(2), status: 'done', terminal: true, pendingQuestion: null, stageProgress: prog('ready', 1, 'green') });
  frame('ready');
  return frames;
}
