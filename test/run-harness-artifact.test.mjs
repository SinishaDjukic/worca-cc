// test/run-harness-artifact.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';
import { listRunArtifacts } from '../src/core/artifacts.mjs';

useTempHome(after);

test('_artifact emits cycle on the WS event and records the row with attribution', async () => {
  const { id, dir } = await seedPipeline(process.cwd(), { title: 'A', status: 'running' });
  const h = Object.create(RunHarness.prototype);
  h.pipeline = { id, dir };
  h.isWorkspace = false;
  h.projectDir = process.cwd();
  const events = [];
  h._emit = (name, evt) => events.push({ name, evt });

  writeFileSync(join(dir, 'checklist.md'), '- [ ] x\n');
  h._artifact('checklist', join(dir, 'checklist.md'), { nodeId: 'implement', executionId: 'exec-3', port: null, cycle: 1 });

  const evt = events.find((e) => e.name === 'artifact').evt;
  assert.equal(evt.cycle, 1);
  assert.equal(evt.nodeId, 'implement');
  assert.equal(evt.kind, 'checklist');
  assert.equal(evt.path, join(dir, 'checklist.md'));
  const rows = await listRunArtifacts(id, { kind: 'checklist' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stepKey, 'exec-3');
  assert.equal(rows[0].nodeId, 'implement');
  assert.equal(rows[0].cycle, 1);
});

test('_artifact emits a questions event for the live view but never indexes the scratch file', async () => {
  const { id, dir } = await seedPipeline(process.cwd(), { title: 'Q', status: 'running' });
  const h = Object.create(RunHarness.prototype);
  h.pipeline = { id, dir };
  h.isWorkspace = false;
  h.projectDir = process.cwd();
  const events = [];
  h._emit = (name, evt) => events.push({ name, evt });

  writeFileSync(join(dir, 'questions.json'), '[]');
  h._artifact('questions', join(dir, 'questions.json'), { nodeId: 'clarify', executionId: 'exec-4', port: null, cycle: 0 });

  const evt = events.find((e) => e.name === 'artifact').evt;
  assert.equal(evt.kind, 'questions');
  assert.equal(evt.nodeId, 'clarify');
  assert.equal(evt.cycle, 0);
  // The orchestrator rm()s the file once the round is answered; an index row
  // would only ever 404 from read_run_artifact / the artifact viewer.
  assert.deepEqual(await listRunArtifacts(id, { kind: 'questions' }), [], 'no questions row in the artifacts index');
});

test('_artifact 2-arg form emits the byte-identical {kind, path} payload', async () => {
  const { id, dir } = await seedPipeline(process.cwd(), { title: 'B', status: 'running' });
  const h = Object.create(RunHarness.prototype);
  h.pipeline = { id, dir };
  h.isWorkspace = false;
  h.projectDir = process.cwd();
  const events = [];
  h._emit = (name, evt) => events.push({ name, evt });
  h._artifact('pipeline', dir);
  const evt = events.find((e) => e.name === 'artifact').evt;
  assert.deepEqual(evt, { kind: 'pipeline', path: dir });
});
