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
import { MODEL_ENGINES } from '../src/core/model-env.mjs';
import { SWITCH_ENGINES, engineLabel, otherEngine, usageLimitSwitch, engineSwitchNote } from '../src/shared/engine-switch.mjs';

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

test('engine-switch: the other engine, its label, and when a pause offers it', () => {
  assert.deepEqual([...SWITCH_ENGINES], MODEL_ENGINES, 'one engine list for the switch and the catalog');
  assert.equal(otherEngine('codex'), 'claude');
  assert.equal(otherEngine('claude'), 'codex');
  assert.equal(otherEngine(null), 'codex', 'a missing engine is Claude');
  assert.equal(otherEngine('gemini'), null);
  assert.equal(engineLabel('codex'), 'Codex');
  assert.equal(engineLabel(undefined), 'Claude');
  assert.equal(usageLimitSwitch({ reason: 'usage_limit', limitEngine: 'codex' }), 'claude');
  assert.equal(usageLimitSwitch({ reason: 'usage_limit', limitEngine: null }), null, 'not an engine limit');
  assert.equal(usageLimitSwitch({ reason: 'error', limitEngine: 'codex' }), null);
  assert.equal(usageLimitSwitch({}), null);
  assert.equal(engineSwitchNote('claude'), "Starts the paused step fresh; the model falls back to Claude's default.");
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
  assert.match(audit, /Resume after the reset, or continue now on Codex\./);

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
