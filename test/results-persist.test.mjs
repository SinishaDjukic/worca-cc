// test/results-persist.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { persistResults, persistDiffPatch, readRunContextBundle } from '../src/core/results.mjs';
import { listArtifacts } from '../src/core/artifacts.mjs';

let home, prevHome, pipelineDir, id;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-resp-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  // seedPipeline(projectDir) routes through production writers; returns { id, dir, key }.
  ({ id, dir: pipelineDir } = await seedPipeline(join(home, 'proj')));
  await mkdir(pipelineDir, { recursive: true });
});

after(async () => {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

test('persistResults writes results.json and indexes it', async () => {
  await persistResults(pipelineDir, { summary: { filesNew: 1 } });
  const onDisk = JSON.parse(await readFile(join(pipelineDir, 'results.json'), 'utf8'));
  assert.equal(onDisk.summary.filesNew, 1);
  const arts = await listArtifacts(id);
  assert.ok(arts.some((a) => a.kind === 'results' && a.relPath === 'results.json'));
});

test('persistDiffPatch writes diff-patch.patch and indexes it', async () => {
  await persistDiffPatch(pipelineDir, 'diff --git a b\n');
  const txt = await readFile(join(pipelineDir, 'diff-patch.patch'), 'utf8');
  assert.match(txt, /diff --git/);
  const arts = await listArtifacts(id);
  assert.ok(arts.some((a) => a.kind === 'diff-patch'));
});

test('readRunContextBundle returns the persisted bundle', async () => {
  assert.equal(typeof readRunContextBundle, 'function');
  const bundle = await readRunContextBundle(pipelineDir, id);
  assert.equal(bundle.results.summary.filesNew, 1);
  assert.match(bundle.diffPatch, /diff --git/);
  assert.ok(Array.isArray(bundle.reviews));
});
