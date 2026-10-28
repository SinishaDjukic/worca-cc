// test/cost-cumulative-result.test.mjs — Claude Code's `result.total_cost_usd` is the SESSION's running
// total, not the turn's. One `claude -p` process emits a second `result` when a background-task or
// Monitor notification re-wakes it, and a `--resume`d process restores the session's earlier cost from
// the transcript (cost-state) into its first result. The harness books only what each figure adds to
// the last one it saw for that session, and keeps that figure on the step so a resumed run (a new
// harness) starts from it. Usage on a result is per turn, so a {perMtok} model prices each result as is.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { prepare } from '../src/core/db.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';
import { createClaudeNormalizer } from '../src/core/engines/claude-events.mjs';

useTempHome(after);
// settings.json lives under $HOME/.worca-cc: the {perMtok} model below must never reach the real one.
const home = mkdtempSync(join(tmpdir(), 'worca-cumulative-home-'));
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(home, { recursive: true, force: true });
});

/** A stream-json `result` frame as the CLI prints it, wrapped the way the runner hands it on. */
const resultFrame = (sessionId, total, usage = { input_tokens: 2, output_tokens: 4 }) =>
  ({ type: 'result', costUsd: total, raw: { type: 'result', subtype: 'success', session_id: sessionId, total_cost_usd: total, usage } });

function unitHarness(stepKey, model = null) {
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'worca-cumulative-unit'), claude: { mock: true } });
  orch._persist = async () => {};
  orch.state.steps.push({ key: stepKey, executionId: stepKey, nodeId: stepKey.split(':')[1], costUsd: 0 });
  return { orch, attr: { stepKey, executionId: stepKey, model } };
}

test('the Claude normalizer marks a result\'s cost as the session total', () => {
  const [e] = createClaudeNormalizer()(resultFrame('s1', 0.5));
  assert.equal(e.costUsd, 0.5);
  assert.equal(e.cumulativeCost, true);
});

test('a re-woken process: results of 1.6936 then 1.9886 book 1.9886 on the step, the total and the ledger', { timeout: 60_000 }, async () => {
  const producer = async (ctx) => {
    ctx.onEvent(resultFrame('sess-a', 1.6936));
    ctx.onEvent({ type: 'system', raw: { type: 'system', subtype: 'init', session_id: 'sess-a', model: 'claude-sonnet-5-5' } });   // the re-wake
    ctx.onEvent(resultFrame('sess-a', 1.9886));
    const outputs = {};
    for (const p of ctx.ports?.outputs || []) outputs[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
    return { outputs, verdict: ctx.verdict ? { issues: [], summary: '' } : null, summary: 'x' };
  };
  const orch = createOrchestrator({ projectDir: gitDir('cumulative-cost'), prompt: 'demo', auto: true,
    claude: { mock: true, model: 'claude-sonnet-5-5' }, runners: { producer } });
  await orch.run();
  const st = orch.getState();
  const step = st.steps.find((s) => s.sessionCosts);
  assert.ok(step, 'the step that ran the session keeps its last figure');
  assert.equal(step.costUsd, 1.9886);
  assert.equal(st.totalCostUsd, st.steps.reduce((a, s) => a + (s.costUsd || 0), 0));
  const ledger = prepare('SELECT SUM(amount_usd) AS s FROM cost_ledger WHERE pipeline_id = ? AND step_key = ?').get(st.id, step.key);
  assert.ok(Math.abs(ledger.s - 1.9886) < 1e-9, `ledger ${ledger.s}`);
  const back = readPipelineForResume(st.id).steps.find((s) => s.key === step.key);
  assert.deepEqual(back.sessionCosts, { 'sess-a': 1.9886 }, 'the last figure rides exec_meta, for a resumed run');
});

test('a resumed session books what it adds; a new session books its whole figure', () => {
  const { orch, attr } = unitHarness('x:n_impl:1');
  const feed = (sid, total) => { for (const e of createClaudeNormalizer()(resultFrame(sid, total))) orch._onAgentEvent('implementer', e, attr); };
  feed('sess-a', 0.4);            // first process
  feed('sess-a', 0.7);            // `--resume sess-a` (a question round): the CLI restored 0.4
  feed('sess-b', 0.25);           // a retry started a fresh session
  const step = orch.state.steps[0];
  assert.equal(step.costUsd, 0.95);
  assert.deepEqual(step.sessionCosts, { 'sess-a': 0.7, 'sess-b': 0.25 });
});

test('a reloaded step resumes from its kept figure', () => {
  const { orch, attr } = unitHarness('x:n_impl:1');
  Object.assign(orch.state.steps[0], { costUsd: 1.9886, sessionCosts: { 'sess-a': 1.9886 } });   // as readPipelineForResume returns it
  orch._onAgentEvent('implementer', createClaudeNormalizer()(resultFrame('sess-a', 2.5))[0], attr);
  assert.equal(orch.state.steps[0].costUsd, 2.5);
});

test('a session figure below the kept one books nothing and becomes the new baseline', () => {
  // A process killed before it wrote its cost-state leaves the CLI an older, lower total to restore.
  const { orch, attr } = unitHarness('x:n_impl:1');
  orch.state.steps[0].sessionCosts = { 'sess-a': 1.0 };
  const feed = (total) => orch._onAgentEvent('implementer', createClaudeNormalizer()(resultFrame('sess-a', total))[0], attr);
  feed(0.8);
  assert.equal(orch.state.steps[0].costUsd, 0);
  feed(0.9);
  assert.equal(orch.state.steps[0].costUsd, 0.1);
});

test('a {perMtok} model prices each result from its own per-turn usage', async () => {
  await addGlobalModel({ id: 'priced-cumulative', cost: { perMtok: { input: 1, output: 1 } } });
  const { orch, attr } = unitHarness('x:n_impl:1', 'priced-cumulative');
  const turn = { input_tokens: 100_000, output_tokens: 0 };      // $0.10 a turn
  orch._onAgentEvent('implementer', createClaudeNormalizer()(resultFrame('sess-a', 3.0, turn))[0], attr);
  orch._onAgentEvent('implementer', createClaudeNormalizer()(resultFrame('sess-a', 6.0, turn))[0], attr);
  assert.equal(orch.state.steps[0].costUsd, 0.2);
});

test('a result whose cost is already per turn (no cumulativeCost flag) still accumulates', () => {
  const { orch, attr } = unitHarness('x:n_impl:1');
  orch._onAgentEvent('implementer', { type: 'result', costUsd: 0.1, sessionId: 'codex:t1' }, attr);
  orch._onAgentEvent('implementer', { type: 'result', costUsd: 0.2, sessionId: 'codex:t1' }, attr);
  assert.equal(orch.state.steps[0].costUsd, 0.3);
  assert.equal(orch.state.steps[0].sessionCosts, undefined);
});
