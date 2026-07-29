// test/results-read-api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { persistResults } from '../src/core/results.mjs';
import { readPipelineByKey } from '../src/core/artifacts.mjs';

let home, prevHome, id, dir, key;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-rapi-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  ({ id, dir, key } = await seedPipeline(join(home, 'proj')));
  await mkdir(dir, { recursive: true });
  await persistResults(dir, { summary: { filesNew: 2 }, newFiles: [], changedFiles: [], keyThingsToCheck: [], nitpicks: [] });
});

after(async () => {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

test('readPipelineByKey includes persisted results and null overview', async () => {
  const data = await readPipelineByKey(key, id);
  assert.ok(data, 'pipeline found');
  assert.equal(data.results.summary.filesNew, 2);
  assert.equal(data.overview, null);
});
