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

test('_artifact emits a clarify event and indexes it as a non-browsable row', async () => {
  const { id, dir } = await seedPipeline(process.cwd(), { title: 'C', status: 'running' });
  const h = Object.create(RunHarness.prototype);
  h.pipeline = { id, dir };
  h.isWorkspace = false;
  h.projectDir = process.cwd();
  const events = [];
  h._emit = (name, evt) => events.push({ name, evt });

  writeFileSync(join(dir, 'clarify.json'), '{}');
  h._artifact('clarify', join(dir, 'clarify.json'), { nodeId: 'clarify', executionId: 'exec-5', port: null, cycle: 0 });

  const evt = events.find((e) => e.name === 'artifact').evt;
  assert.equal(evt.kind, 'clarify');
  assert.equal(evt.cycle, 0);
  // Indexed: clarify.json is a durable step-folder file under the run-folder layout,
  // and the row is what stops the step scan re-indexing it as a browsable 'json'.
  assert.deepEqual((await listRunArtifacts(id, { kind: 'clarify' })).map((a) => a.relPath), ['clarify.json']);
  // ...but never listed: the Q&A has its own panel (NON_BROWSABLE_KINDS).
  assert.deepEqual(await listRunArtifacts(id, { kind: 'clarify', browsableOnly: true }), []);
});

// Artifact events were emitted to the live socket but NEVER persisted: only
// `_log` pushes to the logWriter. So live-log.ndjson held no artifact records,
// and History — plus any live run reloaded in the browser — rendered its log
// from records with no path/kind and therefore showed no clickable artifact
// links at all. projectLogRecord already carries path/kind through; the records
// just had to exist.
//
// Capped per burst, with the same threshold the Artifacts tab collapses on: a
// folder sweep indexes one file per slide, and persisting 43 lines would put
// back in History exactly the flood the live view suppresses.
function bench(id, dir) {
  const h = Object.create(RunHarness.prototype);
  h.pipeline = { id, dir };
  h.isWorkspace = false;
  h.projectDir = process.cwd();
  h._emit = () => {};
  const pushed = [];
  h.logWriter = { push: (rec) => pushed.push(rec) };
  return { h, pushed };
}

test('_artifact persists a log record carrying path and kind', async () => {
  const { id, dir } = await seedPipeline(process.cwd(), { title: 'P', status: 'running' });
  const { h, pushed } = bench(id, dir);
  writeFileSync(join(dir, 'deck-manifest.md'), '# m\n');

  h._artifact('deck-manifest', join(dir, 'deck-manifest.md'), { nodeId: 'n_build', executionId: 'x:n_build:1', cycle: 1 });

  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].level, 'artifact');
  assert.equal(pushed[0].kind, 'deck-manifest');
  assert.equal(pushed[0].path, join(dir, 'deck-manifest.md'));
  assert.equal(pushed[0].nodeId, 'n_build');
  assert.equal(pushed[0].executionId, 'x:n_build:1');
  assert.ok(pushed[0].ts, 'and a timestamp, like every other log record');
});

test('_artifact caps a folder sweep instead of persisting one line per file', async () => {
  const { id, dir } = await seedPipeline(process.cwd(), { title: 'Q', status: 'running' });
  const { h, pushed } = bench(id, dir);
  for (let i = 1; i <= 12; i++) {
    writeFileSync(join(dir, `s${i}.png`), 'x');
    h._artifact('deck-shot', join(dir, `s${i}.png`), { nodeId: 'n_audit', executionId: 'x:n_audit:1' });
  }
  assert.equal(pushed.length, 5, 'the first few of the sweep, not all twelve');

  // A later cycle is its own sweep and logs its own first few.
  for (let i = 1; i <= 12; i++) h._artifact('deck-shot', join(dir, `s${i}.png`), { nodeId: 'n_audit', executionId: 'x:n_audit:2' });
  assert.equal(pushed.length, 10);
});

test('_artifact persists nothing for a kind no one can open', async () => {
  const { id, dir } = await seedPipeline(process.cwd(), { title: 'R', status: 'running' });
  const { h, pushed } = bench(id, dir);
  // 'pipeline' is the run DIR, 'questions' a scratch file the orchestrator
  // deletes — a link to either 404s, which is why the viewer never lists them.
  // The files exist: a MISSING path is a different branch (_artifact's
  // "was not written" warning), not what this test is about.
  writeFileSync(join(dir, 'questions.json'), '{}');
  writeFileSync(join(dir, 'live-log.ndjson'), '');
  h._artifact('pipeline', dir, {});
  h._artifact('questions', join(dir, 'questions.json'), {});
  h._artifact('live-log', join(dir, 'live-log.ndjson'), {});
  assert.deepEqual(pushed, []);
});
