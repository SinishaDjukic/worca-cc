// test/engine-switch-pause.test.mjs — a session/usage limit an engine hit records that
// engine (`limitEngine`) on the pause: the done payload, the live state, the resume point and
// the saved row's state all carry it, so every pause surface can offer the other engine.
// Any other pause, and a spent OpenRouter free allowance, records none; a resume clears it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume, readPipelineStateById, listPipelines } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';
import { SWITCH_ENGINES, ENGINE_NAMES, MODEL_ENGINE_NAMES, otherEngines, usageLimitSwitches, engineLabel, engineList, engineReportsCost, engineSwitchNote, runCostLabel } from '../src/shared/engine-switch.mjs';
import { ENGINES } from '../src/shared/engine-switch.mjs';
import { MODEL_ENGINES, RUN_ENGINES, HELPER_ENGINES, ASK_ENGINES, helperEngineFor, CURSOR_EFFORTS, effortsForEngine } from '../src/core/model-env.mjs';
import { listEngines } from '../src/core/engines/index.mjs';

useTempHome(after);
process.env.WORCA_RECOVERY_BACKOFF_MS = '0';

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-engswitch-'));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

const LIMIT_ERR = () => new Error("claude exited with code 1: You've hit your session limit · resets 6pm (Europe/Sofia)");
const FREE_DAILY_ERR = () => new Error('claude exited with code 1: API Error: Request rejected (429) · openai: rate limited (429) — Rate limit exceeded: free-models-per-day-high-balance.  [openrouter_free_tier_daily]');
const okVerifier = async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' });

test('one engine table: the lists, model-env and the adapter registry derive from it', () => {
  assert.deepEqual(Object.keys(ENGINES), [...ENGINE_NAMES]);
  for (const e of listEngines().filter((x) => x.name !== 'mock')) assert.equal(ENGINES[e.name].cost, e.capabilities.cost !== false, `${e.name}: cost`);
  assert.deepEqual([...SWITCH_ENGINES], MODEL_ENGINES);
  assert.deepEqual([...MODEL_ENGINE_NAMES], MODEL_ENGINES);
  assert.deepEqual([...ENGINE_NAMES], listEngines().map((e) => e.name).filter((n) => n !== 'mock'));
  assert.deepEqual([...ENGINE_NAMES], RUN_ENGINES);
});

test('every other engine, in order, filtered by readiness', () => {
  assert.deepEqual(otherEngines('claude'), ['codex', 'cursor']);
  assert.deepEqual(otherEngines('cursor'), ['claude', 'codex']);
  assert.deepEqual(otherEngines(null), ['codex', 'cursor'], 'a missing engine is Claude');
  assert.deepEqual(otherEngines('codex', ['claude']), ['claude']);
  assert.deepEqual(otherEngines('gemini'), []);
});

test('a usage limit offers the ready others; any other pause offers none', () => {
  assert.deepEqual(usageLimitSwitches({ reason: 'usage_limit', limitEngine: 'claude' }, ['claude', 'cursor']), ['cursor']);
  assert.deepEqual(usageLimitSwitches({ reason: 'usage_limit', limitEngine: 'codex' }), ['claude', 'cursor'], 'nothing known: every other engine');
  assert.deepEqual(usageLimitSwitches({ reason: 'usage_limit', limitEngine: null }), []);
  assert.deepEqual(usageLimitSwitches({ reason: 'error', limitEngine: 'claude' }), []);
  assert.deepEqual(usageLimitSwitches({}), []);
});

test('labels, lists and cost reporting follow the registry', () => {
  assert.equal(engineLabel('codex'), 'Codex');
  assert.equal(engineLabel(undefined), 'Claude');
  assert.equal(engineLabel('cursor'), 'Cursor');
  assert.equal(engineList(['codex', 'cursor']), 'Codex or Cursor');
  assert.equal(engineList(['claude', 'codex', 'cursor'], (e) => e), 'claude, codex or cursor');
  assert.equal(engineSwitchNote('claude'), "Starts the paused step fresh; a model Claude cannot run falls back to its default.");
  assert.match(engineSwitchNote('cursor'), /a model Cursor cannot run falls back to its default/);
  for (const e of listEngines().filter((x) => x.name !== 'mock')) assert.equal(engineReportsCost(e.name), e.capabilities.cost !== false, e.name);
});

test('runCostLabel: a priced engine formats its total; Cursor reads "cost unknown", never $0.00', () => {
  const fmt = (n) => `$${n.toFixed(2)}`;
  assert.equal(runCostLabel('claude', 0, fmt), '$0.00');
  assert.equal(runCostLabel(undefined, 1.5, fmt), '$1.50');
  assert.equal(runCostLabel('codex', null, fmt), '$0.00');
  assert.equal(runCostLabel('cursor', 0, fmt), 'cost unknown');
  assert.equal(runCostLabel('cursor', 0.42, fmt), "cost unknown (worca's own calls: $0.42)");
});

test('helper jobs run on the run engine when it runs them, else on Claude', () => {
  assert.deepEqual(HELPER_ENGINES, ['claude', 'codex']);
  assert.equal(helperEngineFor('claude'), 'claude');
  assert.equal(helperEngineFor('codex'), 'codex');
  assert.equal(helperEngineFor('cursor'), 'claude');
  assert.equal(helperEngineFor('copilot'), 'copilot', 'Copilot runs its own helper jobs on its default model');
  assert.equal(helperEngineFor(undefined), 'claude');
  for (const e of HELPER_ENGINES) assert.ok(MODEL_ENGINES.includes(e));
  assert.deepEqual(ASK_ENGINES, ['claude', 'codex'], 'Ask never runs on Cursor (CURSOR_ASK_LOCKDOWN = null)');
  assert.deepEqual(CURSOR_EFFORTS, []);
  assert.equal(effortsForEngine('cursor'), CURSOR_EFFORTS);
});

test('a usage limit an agent hit records its engine on every copy of the pause', async () => {
  const dir = gitDir();
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: async () => { throw LIMIT_ERR(); }, verifier: okVerifier },
  });
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  assert.equal(res.reason, 'usage_limit');
  assert.equal(res.limitEngine, 'claude', 'the done payload names the engine');
  assert.equal(orch.getState().limitEngine, 'claude', 'the live state too');
  const saved = readPipelineForResume(orch.state.id);
  assert.equal(saved.resumePoint.limitEngine, 'claude', 'the resume point keeps it across a restart');
  assert.equal(readPipelineStateById(orch.state.id).limitEngine, 'claude', 'the saved row\'s state reads it back');
  const row = (await listPipelines(dir)).find((p) => p.id === orch.state.id);
  assert.equal(row.limitEngine, 'claude', 'the history list row too');
  const audit = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(orch.state.id).map((e) => e.text).join('\n');
  assert.match(audit, /Resume after the reset, or continue now on Codex or Cursor, or resume with another model\./);

  // A resume clears it, like the reason.
  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: { producer: async () => ({ status: 'ok', summary: 'done' }), verifier: okVerifier }, resume: saved });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done', JSON.stringify(r2));
  assert.equal(orch2.getState().limitEngine, null);
});

test('a spent free-model allowance and an error pause record no engine', async () => {
  for (const err of [FREE_DAILY_ERR, () => new Error('boom: a plain bug')]) {
    const dir = gitDir();
    const orch = createOrchestrator({
      projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
      runners: { producer: async () => { throw err(); }, verifier: okVerifier },
    });
    const res = await orch.run();
    assert.equal(res.status, 'paused', err().message);
    assert.equal(res.limitEngine, null, err().message);
    assert.equal('limitEngine' in readPipelineForResume(orch.state.id).resumePoint, false, err().message);
  }
});

// Harness ⟂ provider: whose limit it is follows from the step's connection (src/shared/connections.mjs).
test('a usage limit on a provider model names the provider and offers no other engine; any usage limit offers another model', async (t) => {
  const { addGlobalModel } = await import('../src/core/settings.mjs');
  // settings.json follows HOME, not WORCA_HOME (useTempHome): sandbox it for the catalog write, put it back after.
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  const home = mkdtempSync(join(tmpdir(), 'worca-cc-engswitch-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  t.after(() => { for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  await addGlobalModel({ id: 'gw-limited', upstream: { provider: 'openai', api: 'openai-chat', model: 'x', baseUrl: 'http://127.0.0.1:9/v1' } });
  const dir = gitDir();
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true, model: 'gw-limited' },
    runners: { producer: async () => { throw LIMIT_ERR(); }, verifier: okVerifier },
  });
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  assert.equal(res.reason, 'usage_limit');
  assert.equal(res.limitEngine, null, 'another harness on the same provider would hit it too');
  assert.match(res.detail, /^OpenAI-compatible limit — /);
  const audit = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(orch.state.id).map((e) => e.text).join('\n');
  assert.match(audit, /Resume after the reset, or resume with another model\./);
  assert.doesNotMatch(audit, /continue now on/);
});

test('resume with another model: every remaining step runs on it, and later resumes keep it', async () => {
  const dir = gitDir();
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: async () => { throw LIMIT_ERR(); }, verifier: okVerifier },
  });
  await orch.run();
  const saved = readPipelineForResume(orch.state.id);
  const seen = [];
  const orch2 = createOrchestrator({
    projectDir: dir, auto: true, claude: { mock: true, model: 'claude-haiku-4-5', effort: 'high', modelForAll: true },
    runners: { producer: async (ctx) => { seen.push(orch2._nodeModelPair({ model: 'claude-opus-5-5', effort: 'max' })); throw LIMIT_ERR(); }, verifier: okVerifier },
    resume: saved,
  });
  await orch2.resume();
  assert.deepEqual(seen[0], { model: 'claude-haiku-4-5', effort: 'high' }, 'a node pinned to another model runs on the picked one');
  const again = readPipelineForResume(orch2.state.id);
  assert.equal(again.resumePoint.claude.model, 'claude-haiku-4-5');
  assert.equal(again.resumePoint.claude.modelForAll, true, 'rides the resume point');
});
