// test/workflow-tests-branch-naming.test.mjs — P35: a workflow-test try's branch is always `worca-cc/…`, even with Smart
// run naming on (a try lives only in Worca's copy, and the boot sweep removes `worca-cc/*` leftovers only).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

useTempHome(after);
const repo = templateRepo('wft-branch', { branch: 'main', user: true, files: { 'seed.txt': 'seed\n' } });
after(() => rm(repo, { recursive: true, force: true }));

const resolve = (extra) => {
  const orch = createOrchestrator({ projectDir: repo, prompt: 'Rate limiter for the api', auto: true, claude: { mock: true }, branch: { source: 'main' }, ...extra });
  orch.pipeline = { id: 'a1b2c3d4e5f6', promptText: 'Rate limiter for the api' };
  return orch._resolveSingleBranches();
};

test('Smart run naming on: a workflow-test try gets a worca-cc/ branch; a normal run keeps the smart name', async () => {
  const prev = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = 'smartRunNaming';
  try {
    const t = await resolve({ workflowTest: true });
    assert.match(t.featureRaw, /^worca-cc\/.+-a1b2c3d4$/);
    const n = await resolve({});
    assert.equal(n.featureRaw, 'feat/rate-limiter-api');
  } finally {
    if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev;
  }
});
