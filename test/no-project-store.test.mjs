// test/no-project-store.test.mjs — P3: rows, meta, History tagging and schedule refusals for the reserved key.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { useTempHome } from './helpers/temp-home.mjs';
import { createPipeline, newPipelineId, findPipelineRowById, readStoreMeta, readPipelineByKey, listAllPipelines } from '../src/core/artifacts.mjs';
import { NO_PROJECT_KEY, noProjectWorkDir } from '../src/core/store.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { createTicket, createSchedule, resolveAfterRef } from '../src/core/scheduler.mjs';

useTempHome(after, 'worca-np-store-');
const nightly = { freq: 'daily', time: '02:00', tz: 'Europe/Berlin', anchor: '2026-09-18' };

test('createPipeline on a work folder: the given id, the reserved key, the No project meta', async () => {
  const id = newPipelineId();
  assert.match(id, /^[0-9a-f]{8}$/);
  const p = await createPipeline(noProjectWorkDir(id), { prompt: 'a deck', id, projectKey: NO_PROJECT_KEY });   // the S52 path
  assert.equal(p.id, id);
  assert.ok(p.dir.startsWith(join(worcaHome(), 'store', NO_PROJECT_KEY, 'pipelines')), p.dir);
  assert.equal(findPipelineRowById(id).project_key, NO_PROJECT_KEY);
  const meta = readStoreMeta(NO_PROJECT_KEY);
  assert.deepEqual([meta.key, meta.path, meta.name], [NO_PROJECT_KEY, join(worcaHome(), 'runs'), 'No project']);
  assert.equal((await readPipelineByKey(NO_PROJECT_KEY, id)).state.projectDir, noProjectWorkDir(id));
  const row = (await listAllPipelines()).find((r) => r.id === id);
  assert.deepEqual([row.projectKey, row.projectName, row.projectDir], [NO_PROJECT_KEY, 'No project', noProjectWorkDir(id)]);
  await assert.rejects(createPipeline(noProjectWorkDir(id), { prompt: 'again', id }), { message: `createPipeline: pipeline id ${id} is already taken` });
  const g = newPipelineId();                    // no projectKey given: the projectKey(work) guard yields the same store
  assert.equal(findPipelineRowById((await createPipeline(noProjectWorkDir(g), { prompt: 'guard', id: g })).id).project_key, NO_PROJECT_KEY);
  await assert.rejects(createPipeline(noProjectWorkDir(id), { prompt: 'x', id: 'XYZ' }), { message: 'createPipeline: id must be 8 hex characters' });
});

test('schedules refuse a run without a project; a resume ticket for one is allowed', async () => {
  const id = newPipelineId();
  await createPipeline(noProjectWorkDir(id), { prompt: 'x', id });
  const runAtMs = Date.now() + 3600_000;
  assert.throws(() => createTicket({ projectDir: noProjectWorkDir(id), runAtMs, request: {} }), { message: 'a run without a project cannot be scheduled yet' });
  assert.throws(() => createSchedule({ projectDir: noProjectWorkDir(id), request: {}, rule: nightly }), { message: 'a run without a project cannot be scheduled yet' });
  assert.equal(createTicket({ projectDir: noProjectWorkDir(id), runAtMs, request: {}, resumePipelineId: id }).resumePipelineId, id);
  assert.deepEqual(resolveAfterRef({ kind: 'pipeline', id }, { projectDir: '/some/project' }), { ok: false, error: 'a run without a project cannot be scheduled yet' });
  const proj = mkdtempSync(join(tmpdir(), 'worca-np-proj-'));
  const plain = await createPipeline(proj, { prompt: 'a project run' });
  assert.deepEqual(resolveAfterRef({ kind: 'pipeline', id: plain.id }, { projectDir: noProjectWorkDir(id) }), { ok: false, error: 'a run without a project cannot be scheduled yet' });
  rmSync(proj, { recursive: true, force: true });
});
