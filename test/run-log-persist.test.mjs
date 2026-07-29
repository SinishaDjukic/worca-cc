// test/run-log-persist.test.mjs
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { listArtifacts } from '../src/core/artifacts.mjs';
import { RUN_LOG_FILE, RUN_LOG_KIND } from '../src/core/run-log.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-rlp-home-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
});
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

test('a mock run persists the full log stream to live-log.ndjson and indexes it', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-rlp-proj-'));
  const orch = createOrchestrator({ projectDir, prompt: 'demo task', auto: true, claude: { mock: true } });
  const emitted = [];
  orch.on('log', (l) => emitted.push(l));
  const res = await orch.run();
  assert.equal(res.status, 'done', 'pipeline converges');

  const id = orch.getState().id;
  // (a) indexed as an artifact, dir-relative, kind 'live-log'
  const arts = await listArtifacts(id);
  assert.ok(arts.some((a) => a.kind === RUN_LOG_KIND && a.relPath === RUN_LOG_FILE), 'live-log indexed');

  // (b) on-disk NDJSON parses and carries the SAME stream the run emitted (uncapped)
  const ndjson = await readFile(join(res.pipelineDir, RUN_LOG_FILE), 'utf8');
  const lines = ndjson.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(lines.length >= emitted.length, 'every emitted line persisted (no cap)');
  assert.ok(lines.every((l) => typeof l.ts === 'string' && 'text' in l), 'line shape == event shape');
  // the preflight line is emitted BEFORE the pipeline dir exists -> proves pre-bind buffering
  assert.ok(lines.some((l) => l.source === 'preflight'), 'pre-pipeline (preflight) lines captured');
});
