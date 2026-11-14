// test/readiness-cli-run-row.test.mjs — a readiness run started without a run setup (the CLI command `worca add` prints,
// or a start whose setup could not be kept) still carries its workflow id on its pipelines row, so the chip and the
// one-run guard (readinessRunInfo) see it live and then as the last run. Save setup as preset still has nothing to save.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';
import { projectKey } from '../src/core/store.mjs';
import { readRunSetup } from '../src/core/run-presets-store.mjs';
import { readinessRunInfo, READINESS_CHECK_WORKFLOW_ID, READINESS_SETUP_WORKFLOW_ID } from '../src/core/repo-readiness/projects.mjs';

useTempHome(after);
delete process.env.WORCA_READINESS;

const dirs = [];
after(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {}); });
beforeEach(() => { _resetForTests(); });

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-rcli-'));
  dirs.push(dir);
  await writeFile(join(dir, 'index.js'), 'export {};\n', 'utf8');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

const deps = { mock: false, hasCode: () => true, listWorkflows: async () => [{ id: READINESS_CHECK_WORKFLOW_ID }, { id: READINESS_SETUP_WORKFLOW_ID }] };

// The harness as the CLI drives it (no runSetup), with a stub engine: the row is written by the real createPipeline call.
class StubEngine extends RunHarness {
  async _resolveTopology() {
    return { manifest: { version: 99, steps: [{ kind: 'stub' }], feedbacks: [] }, agentKeys: new Set(['planner']), workflow: { id: this.workflowId, name: 'Stub' } };
  }
  async _engineRun() {
    this.seenLive = await readinessRunInfo({ key: projectKey(this.projectDir), path: this.projectDir }, deps);
    return 'done';
  }
  _enginePrePausePoint() { return { version: 99 }; }
}

test('a CLI-started readiness run (no run setup) is found live while it runs and as the last run after', async () => {
  const dir = await makeRepo();
  const orch = new StubEngine({ projectDir: dir, prompt: 'check', workflowId: READINESS_CHECK_WORKFLOW_ID, claude: { mock: true }, auto: true });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res).slice(0, 600));
  assert.equal(orch.seenLive.live?.pipelineId, orch.pipeline.id, 'live while it runs');
  const after = await readinessRunInfo({ key: projectKey(dir), path: dir }, deps);
  assert.equal(after.lastCheck?.pipelineId, orch.pipeline.id, 'the last check run');
  assert.equal(after.live, null);
  const row = getDb().prepare('SELECT run_setup FROM pipelines WHERE id = ?').get(orch.pipeline.id);
  assert.equal(JSON.parse(row.run_setup).workflowId, READINESS_CHECK_WORKFLOW_ID);
  assert.equal(readRunSetup(orch.pipeline.id).setup, null, 'the id alone is no setup to save as a preset');
});

test('a kept run setup without a workflow id gets the run\'s; one with an id is written as is', async () => {
  const dir = await makeRepo();
  const kept = JSON.stringify({ guardrailsId: 'normal', mock: true });
  const orch = new StubEngine({ projectDir: dir, prompt: 'set up', workflowId: READINESS_SETUP_WORKFLOW_ID, runSetup: kept, claude: { mock: true }, auto: true });
  assert.equal((await orch.run()).status, 'done');
  const setup = readRunSetup(orch.pipeline.id).setup;
  assert.deepEqual(setup, { guardrailsId: 'normal', mock: true, workflowId: READINESS_SETUP_WORKFLOW_ID });
  const full = JSON.stringify({ workflowId: READINESS_SETUP_WORKFLOW_ID, guardrailsId: 'normal' });
  const o2 = new StubEngine({ projectDir: dir, prompt: 'set up', workflowId: READINESS_SETUP_WORKFLOW_ID, runSetup: full, claude: { mock: true }, auto: true });
  assert.equal((await o2.run()).status, 'done');
  assert.equal(getDb().prepare('SELECT run_setup FROM pipelines WHERE id = ?').get(o2.pipeline.id).run_setup, full);
});
