// test/read-pipeline-by-key.test.mjs
// Phase 3.7 — readPipelineByKey/readWorkspacePipeline reconstruct {state,
// auditMarkdown} from the DB (rowToState + buildAuditMarkdown), matching by short
// id OR run-dir basename. Fixtures seed pipelines rows via the production writers
// (seedPipeline / seedWorkspacePipeline -> createPipeline + writeState) + a couple of
// pipeline_events instead of state.json / pipeline.md files. seedPipeline mints the
// id + projectKey; look up by the RETURNED id/key (A15(3)).
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPipelineByKey, readWorkspacePipeline, listWorkspacePipelines } from '../src/core/artifacts.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-rbk-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
});
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

function addEvent(id, ts, text) {
  getDb().prepare('INSERT INTO pipeline_events (pipeline_id, ts, text) VALUES (?,?,?)').run(id, ts, text);
}

test('readPipelineByKey reconstructs state + auditMarkdown from the DB', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-rbk-proj-'));
  const { id, key } = await seedPipeline(proj, { title: 'Demo', status: 'done',
    startedAt: '2026-06-02T00:00:00Z', prompt: 'demo prompt' });
  addEvent(id, '2026-06-02T00:00:01Z', `Pipeline created (id ${id}).`);

  const byShort = await readPipelineByKey(key, id);
  assert.equal(byShort.state.title, 'Demo');
  assert.match(byShort.auditMarkdown, /# Pipeline: Demo/);
  assert.match(byShort.auditMarkdown, /## Timeline/);
  assert.match(byShort.auditMarkdown, new RegExp(`- \`2026-06-02T00:00:01Z\` Pipeline created \\(id ${id}\\)\\.`));

  // A run-dir basename (…-<id>) resolves to the same row via the DIR_ID_RE fallback.
  const byDir = await readPipelineByKey(key, `02-06-26-demo-${id}`);
  assert.equal(byDir.state.id, id);

  assert.equal(await readPipelineByKey(key, 'nope'), null);
  assert.equal(await readPipelineByKey('missing-key', id), null);
});

test('readPipelineByKey accepts the composite "workspaces/<key>" path segment', async () => {
  const wkey = 'wks-demo-9f3a1c20';
  const primary = await mkdtemp(join(tmpdir(), 'worca-cc-rbk-wsprim-'));
  const projects = [{ projectKey: 'm1-00000001', projectDir: '/abs/one', projectName: 'm1' }];
  const { id } = await seedWorkspacePipeline(primary, wkey, {
    title: 'WS', status: 'done', workspaceName: 'WS', startedAt: '2026-06-02T00:00:00Z',
  }, projects);
  addEvent(id, '2026-06-02T00:00:01Z', 'Pipeline created.');

  const byKey = await readPipelineByKey(`workspaces/${wkey}`, id);
  assert.equal(byKey.state.title, 'WS');
  assert.equal(byKey.state.target, 'workspace');
  assert.match(byKey.auditMarkdown, /# Pipeline: WS/);

  const byWs = await readWorkspacePipeline(wkey, id);
  assert.equal(byWs.state.id, id);
  assert.equal(await readWorkspacePipeline(wkey, 'nope'), null);
  assert.equal(await readWorkspacePipeline('wks-missing-00000000', id), null);

  const list = await listWorkspacePipelines(wkey, '/abs/primary');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
});
