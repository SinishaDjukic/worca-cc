// test/session-trace-e2e.test.mjs — R-TRACE: from a dollar to its turn and sub-agent, from the file alone.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineStateById } from '../src/core/artifacts.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { tracePath, readTrace, traceRecordProblems, reduceTrace, turnRows } from '../src/core/session-trace.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { _testing as mockT } from '../src/core/engines/mock-session.mjs';
import { pauseMidTurn } from './helpers/session-host-fakes.mjs';

useTempHome(after);
const SID = 's_aaaaaaaa';
let st; let raw; let records;
before(async () => {
  process.env.WORCA_FLAGS = 'sessionGroups';
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix'));
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
  await writeGraphWorkflow({ ...t, id: 'wf_trace_e2e', name: 'Trace e2e' });
  const o = createOrchestrator({ projectDir: gitDir('trace-e2e'), workflowId: 'wf_trace_e2e', prompt: 'BUILD IT', auto: true, claude: { mock: true } });
  assert.equal((await o.run()).status, 'done');
  st = o.getState();
  raw = readFileSync(tracePath(st.pipelineDir, SID), 'utf8');
  ({ records } = await readTrace(tracePath(st.pipelineDir, SID)));
});
after(() => { delete process.env.WORCA_FLAGS; });

test('schema and order', () => {
  for (const r of records) assert.deepEqual(traceRecordProblems(r), [], JSON.stringify(r));
  assert.deepEqual(records.map((r) => r.seq), records.map((_, i) => i + 1));
});

test('no prompt bytes', () => {
  for (const needle of ['BUILD IT', 'MOCK_', 'You are ', 'Begin your step', '## Original request']) assert.equal(raw.includes(needle), false, needle);
});

test('the view rebuilt from the file equals the live state and the persisted row', () => {
  assert.deepEqual(reduceTrace(records), st.sessionHosts[SID]);
  const saved = readPipelineStateById(st.id);
  assert.deepEqual(reduceTrace(records), saved.sessionHosts[SID]);
  const live = st.steps.filter((s) => s.session).map((s) => [s.key, s.session]);
  assert.ok(live.length >= 2);
  assert.deepEqual(saved.steps.filter((s) => s.session).map((s) => [s.key, s.session]), live, 'step.session survives exec_meta');
});

test('every booked dollar names its turn, its dispatch and its sub-agent; turns never collide', () => {
  for (const row of turnRows(records).filter((r) => r.costSource !== 'none')) {
    assert.match(row.turnId, /^t:s_aaaaaaaa:\d+$/);
    assert.match(row.dispatchId, /^d:x:n_(impl|review):\d+:a\d+$/);
    assert.ok(row.memberAgentId);
    assert.ok(row.memberTranscriptId, 'C7: the link to the sub-agent\'s own transcript');
  }
  const costs = records.filter((r) => r.kind === 'cost');
  assert.equal(new Set(costs.map((r) => r.turnId)).size, costs.length);
  const turns = records.filter((r) => r.kind === 'turn_start').map((r) => r.turnId);
  assert.equal(new Set(turns).size, turns.length);
});

test('suggestion 4 — paused, resumed by a second writer, restarted on a vanished host: one coherent file', { timeout: 180000 }, async () => {
  const { orch, id } = await pauseMidTurn({ workflowId: 'wf_trace_e2e', nodeId: 'n_review' });
  mockT.behave = ({ resume }) => (resume ? 'vanished' : null);
  const o2 = createOrchestrator({ projectDir: orch.projectDir, workflowId: 'wf_trace_e2e', auto: true, claude: { mock: true }, resume: readPipelineForResume(id) });
  assert.equal((await o2.resume()).status, 'done');
  mockT.behave = null;
  const st2 = o2.getState();
  const r = await readTrace(tracePath(st2.pipelineDir, SID));
  assert.deepEqual([r.torn, r.invalid, r.seqGaps], [0, 0, 0]);
  assert.deepEqual(r.records.map((x) => x.seq), r.records.map((_, i) => i + 1), 'the second writer continued seq');
  assert.deepEqual([...new Set(r.records.map((x) => x.hostEpoch))].filter((e) => e > 0).sort(), [1, 2]);
  assert.deepEqual(reduceTrace(r.records), st2.sessionHosts[SID]);
  for (const x of r.records) assert.deepEqual(traceRecordProblems(x), [], JSON.stringify(x));
});
