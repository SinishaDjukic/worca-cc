import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runners } from '../src/core/runners.mjs';

test('decomposer producer writes decomposition.json + task files (mock)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-decomp-run-'));
  try {
    const ctx = {
      projectDir: dir,
      pipelineDir: dir,
      taskPrompt: 'demo',
      agentPrompts: { decomposer: '' },
      planPath: join(dir, 'plan.md'),
      decompositionPath: join(dir, 'decomposition.json'),
      cycle: 1,
      node: { key: 'decomposer', runnerType: 'producer' },
      claudeOpts: { mock: true },
      onEvent: () => {},
    };
    const res = await runners.producer(ctx);
    assert.equal(res.status, 'ok');
    assert.ok(Array.isArray(res.decomposition.phases) && res.decomposition.phases.length >= 1);
    const manifest = JSON.parse(await readFile(join(dir, 'decomposition.json'), 'utf8'));
    assert.ok(Array.isArray(manifest.phases));
    const taskFiles = await readdir(join(dir, 'tasks'));
    assert.ok(taskFiles.length >= 1, 'expected at least one task file');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
