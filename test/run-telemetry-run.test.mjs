// test/run-telemetry-run.test.mjs — Run telemetry end to end on a mock run: with the Labs flag on the
// run writes telemetry.ndjson beside live-log.ndjson; off, it writes none; either way the run is the same.
import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { TELEMETRY_FILE } from '../src/core/telemetry/recorder.mjs';
import { summarizeTelemetry } from '../src/core/telemetry/summary.mjs';

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
