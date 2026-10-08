// Base conflicts (#620, D9): the harness checks a finished run's kept branch against its fetched base AFTER
// teardown (so the record survives the final _persist), records `branch.resolves` for a Resolve-in-a-pipeline
// run, does the same for a run stopped while paused, and skips a workspace scan. Mock runs, real git.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { ENGINES } from './helpers/engines.mjs';
import { findPipelineRowById, readPipelineForResume } from '../src/core/artifacts.mjs';
import { createOrchestratorFor } from '../src/core/engine-select.mjs';
import { projectKey } from '../src/core/store.mjs';
import { WORKSPACE_SCAN_WORKFLOW_ID } from '../src/core/graph/builtin-workflows.mjs';
import { GITCONFIG, world as makeWorld, teammatePush, commitOnFeat } from './helpers/base-world.mjs';

useTempHome(after);
const prevControlCheckMs = process.env.WORCA_CONTROL_CHECK_MS;
process.env.WORCA_CONTROL_CHECK_MS = '25';
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-rhbc-'));
const envKeys = ['HOME', 'USERPROFILE', 'WORCA_RUN_ROOT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'];
const prevEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
before(() => {
  writeFileSync(join(scratch, 'gitconfig'), GITCONFIG);
  Object.assign(process.env, { HOME: scratch, USERPROFILE: scratch, WORCA_RUN_ROOT: 'legacy',
    GIT_CONFIG_GLOBAL: join(scratch, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' });
});
after(() => {
  for (const k of envKeys) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  if (prevControlCheckMs === undefined) delete process.env.WORCA_CONTROL_CHECK_MS;
  else process.env.WORCA_CONTROL_CHECK_MS = prevControlCheckMs;
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

const engine = ENGINES[0];
const okVerifier = async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' });
const okProducer = async () => ({ status: 'ok', issues: [], summary: '' });
/** feat and origin/dev both edit f.txt. */
function conflictWorld() {
  const w = makeWorld(join(scratch, 'worlds'));
  commitOnFeat(w, 'f.txt', 'feature\n'); teammatePush(w, 'f.txt', 'upstream\n');
  return w;
}

test('a finished run records its base check after teardown, and a resolve run its `resolves` marker', async () => {
  const w = conflictWorld();
  const key = projectKey(w.a);
  const orch = engine.create({ projectDir: w.a, prompt: 'resolve', auto: true, claude: { mock: true },
    branch: { source: 'dev', feature: 'feat', resolves: { runId: 'ORIG', member: key } },
    runners: { producer: okProducer, verifier: okVerifier } });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  const br = JSON.parse(findPipelineRowById(orch.state.id).branch);
  assert.equal(br.feature, 'feat');
  assert.equal(br.baseCheck.status, 'conflicts', 'checked AFTER teardown, recorded on the row');
  assert.deepEqual(br.baseCheck.files, ['f.txt']);
  assert.deepEqual(br.resolves, { runId: 'ORIG', member: key });
  assert.equal(orch.state.branch.baseCheck.status, 'conflicts', 'mirrored into memory: a later _persist keeps it');
});

test('a run stopped while paused is checked after its teardown', async () => {
  const w = conflictWorld();
  let orch;
  orch = engine.create({ projectDir: w.a, prompt: 'demo', auto: true, claude: { mock: true },
    branch: { source: 'dev', feature: 'feat' },
    runners: {
      producer: async (ctx) => {
        queueMicrotask(() => orch.pause());
        return new Promise((_res, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort();
          else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      },
      verifier: okVerifier,
    } });
  const paused = await orch.run();
  assert.equal(paused.status, 'paused');
  const id = orch.state.id;
  assert.equal(JSON.parse(findPipelineRowById(id).branch).baseCheck, undefined, 'a pause is not checked');
  const o = await createOrchestratorFor({ projectDir: w.a, claude: { mock: true }, resume: readPipelineForResume(id) });
  const res = await o.stopPaused('ada');
  assert.equal(res.status, 'stopped');
  const br = JSON.parse(findPipelineRowById(id).branch);
  assert.equal(br.baseCheck.status, 'conflicts');
  assert.deepEqual(br.baseCheck.files, ['f.txt']);
});

test('a workspace scan run is never checked', async () => {
  const orch = engine.create({ projectDir: mkdtempSync(join(scratch, 'scan-')), prompt: 'x', claude: { mock: true } });
  const logs = [];
  orch.on('log', (l) => logs.push(String(l.text || '')));
  orch.isWorkspace = true;
  orch.workflowId = WORKSPACE_SCAN_WORKFLOW_ID;
  orch.state.id = 'nope';
  orch.state.status = 'done';
  await orch._checkBaseAfterRun();
  assert.ok(!logs.some((t) => /base check/.test(t)), 'nothing ran');
  orch.isWorkspace = false;
  await orch._checkBaseAfterRun();
  assert.ok(logs.some((t) => /base check skipped/.test(t)), 'the same harness, not a scan, does run the check');
});
