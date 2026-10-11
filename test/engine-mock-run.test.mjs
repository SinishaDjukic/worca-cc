// test/engine-mock-run.test.mjs — a Codex run makes no Claude call (cascading-settings-design.md D8):
// a whole mock run, its title included, records only codex spawns.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { mockSpawnLog } from '../src/core/claude-runner.mjs';

useTempHome(after);

test('a mock Codex run sends every spawn to codex — the title too, read-only', { timeout: 120000 }, async () => {
  mockSpawnLog.length = 0;
  const orch = createOrchestrator({ projectDir: gitDir('codex-mock-run'), workflowId: 'wf_default', prompt: 'Add a settings page', auto: true, claude: { mock: true, engine: 'codex' } });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  await orch._titlePromise;
  assert.ok(mockSpawnLog.length > 1, JSON.stringify(mockSpawnLog));
  assert.deepEqual([...new Set(mockSpawnLog.map((s) => s.engine))], ['codex']);
  assert.ok(mockSpawnLog.some((s) => s.sandbox === 'read-only'), 'the title spawn is read-only');
  assert.equal(orch.getState().runEngine, 'codex');
});
