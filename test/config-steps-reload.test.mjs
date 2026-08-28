// test/config-steps-reload.test.mjs
// agentSteps() recomputes from the layered registry per call, so a user agent
// dropped into ~/.worca-cc/agents shows up WITHOUT a process restart, while the
// boot-time AGENT_STEPS snapshot stays import-compatible.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { agentSteps, AGENT_STEPS, setStep, resolveStepModels } from '../src/core/config.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after);
const proj = mkdtempSync(join(tmpdir(), 'worca-cc-cfg-proj-'));
after(() => rmSync(proj, { recursive: true, force: true }));

function writeUserAgent(key) {
  const dir = join(worcaHome(), 'agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.md`), `# ${key}\n`);
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
    key, displayName: 'Spec Writer', description: 'writes specs', color: 'green',
    icon: '<path d="M0 0"/>', agentFile: `${key}.md`, runnerType: 'producer', order: 42,
  }));
}

test('agentSteps() sees a user agent added AFTER module load; AGENT_STEPS snapshot does not', async () => {
  assert.ok(!AGENT_STEPS.some((s) => s.key === 'specWriter'), 'boot snapshot has no specWriter');
  writeUserAgent('specWriter');
  const live = agentSteps();
  const entry = live.find((s) => s.key === 'specWriter');
  assert.ok(entry, 'live steps include the user agent');
  assert.equal(entry.label, 'Spec Writer');
  assert.ok(!AGENT_STEPS.some((s) => s.key === 'specWriter'), 'snapshot is unchanged (compat)');
});

test('setStep + resolveStepModels accept a runtime-added user agent key', async () => {
  writeUserAgent('specWriter');
  const cfg = await setStep(proj, 'specWriter', { model: 'claude-opus-4-8', effort: 'high' });
  assert.deepEqual(cfg.steps.specWriter, { model: 'claude-opus-4-8', effort: 'high' });
  const models = await resolveStepModels(proj, 'fallback-model');
  assert.equal(models.specWriter.model, 'claude-opus-4-8');
  assert.equal(models.specWriter.effort, 'high');
});
