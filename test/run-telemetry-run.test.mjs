// test/run-telemetry-run.test.mjs — Run telemetry end to end on a mock run: with the Labs flag on the
// run writes telemetry.ndjson beside live-log.ndjson; off, it writes none; either way the run is the same.
// A paused run's harness closes its recorder; the resumed (or stopping) harness appends its own run…end.
import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { TELEMETRY_FILE } from '../src/core/telemetry/recorder.mjs';
import { summarizeTelemetry } from '../src/core/telemetry/summary.mjs';
import { execSync } from 'node:child_process';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { createOrchestratorFor } from '../src/core/engine-select.mjs';
import { BOOKEND_EXECUTION_IDS } from '../src/shared/graph/constants.mjs';

const homes = [];
let prevFlags;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-tel-home-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  prevFlags = process.env.WORCA_FLAGS;
});
afterEach(() => {
  if (prevFlags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prevFlags;
});
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

async function mockRun() {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-tel-proj-'));
  homes.push(projectDir);
  const orch = createOrchestrator({ projectDir, prompt: 'demo task', auto: true, claude: { mock: true } });
  const res = await orch.run();
  return { res, orch };
}

test('flag on: the run records steps, calls, harness work and an end record', async () => {
  process.env.WORCA_FLAGS = 'runTelemetry';
  const { res, orch } = await mockRun();
  assert.equal(res.status, 'done');
  const text = await readFile(join(res.pipelineDir, TELEMETRY_FILE), 'utf8');
  const recs = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(recs[0].t, 'run');
  assert.equal(recs[recs.length - 1].t, 'end');
  assert.ok(Number.isFinite(recs[recs.length - 1].dbBytes), 'the database size is recorded');
  const stepKeys = new Set(orch.getState().steps.map((s) => s.key));
  const stepRecs = recs.filter((r) => r.t === 'step');
  assert.ok(stepRecs.length >= 2, 'step transitions recorded');
  assert.ok(stepRecs.every((r) => stepKeys.has(r.step)), 'keyed by the step key (the execution id)');
  assert.ok(recs.some((r) => r.t === 'result' || r.t === 'call'), 'the mock engine\'s usage recorded');
  assert.ok(recs.some((r) => r.t === 'harness' && r.persists > 0), 'state saves measured');
  const s = summarizeTelemetry(text);
  assert.ok(Object.keys(s.steps).length > 0);
});

test('flag off: no telemetry file, same outcome', async () => {
  process.env.WORCA_FLAGS = '-runTelemetry';
  const { res, orch } = await mockRun();
  assert.equal(res.status, 'done');
  assert.equal(orch.telemetry, null);
  await assert.rejects(() => access(join(res.pipelineDir, TELEMETRY_FILE)));
});

const readRecs = async (dir) => (await readFile(join(dir, TELEMETRY_FILE), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** A mock run in a git project, paused through the real pause path once its first graph node is done. */
async function pausedMockRun() {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-tel-proj-'));
  homes.push(projectDir);
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: projectDir });
  const orch = createOrchestrator({ projectDir, prompt: 'demo task', auto: true, claude: { mock: true } });
  let pausedOnce = false;
  orch.on('exec', ({ status, nodeId, executionId }) => {
    if (!pausedOnce && status === 'done' && nodeId && !BOOKEND_EXECUTION_IDS.includes(executionId)
        && orch.state.status === 'running') {
      pausedOnce = true;
      orch.pause();
    }
  });
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  // The paused harness let its recorder go: closed, its window timer cleared with it.
  assert.ok(orch.telemetry, 'the flag gave the run a recorder');
  assert.equal(orch.telemetry.isClosed(), true, 'the paused harness closed its recorder');
  return { projectDir, id: orch.state.id, pipelineDir: res.pipelineDir };
}

test('flag on, pause then resume: each harness records its own run and end, the steps add up', async () => {
  process.env.WORCA_FLAGS = 'runTelemetry';
  const { projectDir, id, pipelineDir } = await pausedMockRun();
  const atPause = await readRecs(pipelineDir);
  assert.equal(atPause.filter((r) => r.t === 'run').length, 1);
  assert.equal(atPause.at(-1).t, 'end', 'the paused harness wrote its end record last');

  const orch2 = createOrchestrator({ projectDir, claude: { mock: true }, auto: true, resume: readPipelineForResume(id) });
  const res = await orch2.resume();
  assert.equal(res.status, 'done', 'the resumed run still finishes');
  assert.equal(orch2.telemetry.isClosed(), true);

  const recs = await readRecs(pipelineDir);
  assert.deepEqual(recs.slice(0, atPause.length), atPause, 'the resumed harness appends; nothing from the paused one after its end');
  const kinds = recs.map((r) => r.t);
  assert.equal(kinds.filter((t) => t === 'run').length, 2, 'a second run record from the resumed harness');
  assert.equal(kinds.filter((t) => t === 'end').length, 2, 'an end record from each harness');
  assert.equal(recs[atPause.length].t, 'run', 'the resumed harness starts right after the paused one ended');
  assert.equal(kinds.at(-1), 'end');

  const s = summarizeTelemetry(recs);
  const resumed = recs.slice(atPause.length).filter((r) => r.t === 'step').map((r) => r.step);
  assert.ok(resumed.length > 0, 'the resumed harness recorded steps');
  for (const key of new Set(resumed)) {
    const st = s.steps[key];
    assert.ok(st, `summary for ${key}`);
    assert.ok(st.status !== 'start', `${key} ended: ${st.status}`);
    assert.ok(Number.isFinite(st.wallMs) && st.wallMs >= 0, `${key} wallMs ${st.wallMs}`);
    assert.ok(st.startupMs == null || st.startupMs >= 0);
    assert.ok(st.modelMs >= 0 && st.toolMs >= 0);
  }
  // Wall time counts running stretches only: never more than the step's first start to last end.
  for (const st of Object.values(s.steps)) {
    const steps = recs.filter((r) => r.t === 'step' && r.step === st.key);
    if (st.wallMs != null) assert.ok(st.wallMs <= steps.at(-1).ts - steps[0].ts, `${st.key} wall within its span`);
  }
});

test('flag on, pause then stop: the stopping harness records its own run and end', async () => {
  process.env.WORCA_FLAGS = 'runTelemetry';
  const { projectDir, id, pipelineDir } = await pausedMockRun();
  const atPause = await readRecs(pipelineDir);
  const stopper = await createOrchestratorFor({ projectDir, claude: { mock: true }, resume: readPipelineForResume(id) });
  const res = await stopper.stopPaused('ada');
  assert.equal(res.status, 'stopped');
  assert.equal(stopper.telemetry.isClosed(), true, 'the stop closed its recorder');
  const recs = await readRecs(pipelineDir);
  const added = recs.slice(atPause.length);
  assert.equal(added[0]?.t, 'run');
  assert.equal(added.at(-1).t, 'end');
  assert.doesNotThrow(() => summarizeTelemetry(recs));
});
