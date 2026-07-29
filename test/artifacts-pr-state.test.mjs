// test/artifacts-pr-state.test.mjs
// Phase 3.6 — withPr enrichment is unchanged (still shells out via git-info), now
// fed DB rows. Fixtures seed pipelines rows via the production writers (seedPipeline
// -> createPipeline + writeState) + store_meta instead of state.json + meta.json.
// seedPipeline mints the id; look up by the RETURNED id (A15(3)).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

let home, prevHome, repo;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-prs-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests(); // open the DB under this temp home
  repo = await mkdtemp(join(tmpdir(), 'worca-cc-prs-repo-'));
});
after(async () => {
  gitInfo.reset();
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});
beforeEach(() => gitInfo.reset());

// Fake runner: gh present, branch survives, and a PR (state/url) exists for the head.
function stubGh({ state = 'OPEN', url = 'https://gh/x/pull/5', number = 5 } = {}) {
  gitInfo.setRunner((cmd, args) => {
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list')
      return Promise.resolve({ ok: true, stdout: JSON.stringify([{ number, state, url }]), stderr: '', code: 0 });
    if (cmd === 'git' && args[0] === 'rev-parse') return Promise.resolve({ ok: true, stdout: 'ref\n', stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
}

// Seed one finished pipeline (branch points at worca-cc/feat-1) via the production
// writers and return its MINTED id for lookups (A15(3)).
async function seed() {
  const { id } = await seedPipeline(repo, {
    title: 'Feat', status: 'done', startedAt: '2026-06-01T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/feat-1', branchKept: true },
  });
  return id;
}

test('withPr:true attaches the live PR state to each row', async () => {
  const { listPipelines } = await import('../src/core/artifacts.mjs');
  stubGh({ state: 'MERGED', url: 'https://gh/x/pull/5', number: 5 });
  const id = await seed();
  const row = (await listPipelines(repo, { withPr: true })).find((r) => r.id === id);
  assert.deepEqual(row.pr, { state: 'MERGED', url: 'https://gh/x/pull/5', number: 5 });
});

test('withPr defaults off: no pr field, no gh call', async () => {
  const { listPipelines } = await import('../src/core/artifacts.mjs');
  let ghCalled = false;
  gitInfo.setRunner((cmd) => {
    if (cmd === 'gh') ghCalled = true;
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
  const id = await seed();
  const row = (await listPipelines(repo)).find((r) => r.id === id);
  assert.equal(row.pr, undefined);
  assert.equal(ghCalled, false);
});

test('withPr:true but gh unavailable -> pr is null, never throws', async () => {
  const { listPipelines } = await import('../src/core/artifacts.mjs');
  gitInfo.setRunner((cmd, args) =>
    Promise.resolve(cmd === 'gh' && args[0] === '--version'
      ? { ok: false, stdout: '', stderr: 'not found', code: 127 }
      : { ok: true, stdout: '', stderr: '', code: 0 }));
  const id = await seed();
  const row = (await listPipelines(repo, { withPr: true })).find((r) => r.id === id);
  assert.equal(row.pr, null);
});

test('withPr:true with only a closed PR -> pr is null (button re-appears)', async () => {
  const { listPipelines } = await import('../src/core/artifacts.mjs');
  stubGh({ state: 'CLOSED', url: 'https://gh/x/pull/6', number: 6 });
  const id = await seed();
  const row = (await listPipelines(repo, { withPr: true })).find((r) => r.id === id);
  assert.equal(row.pr, null);
});

test('enrichPipelinesPr emits {projectKey,id,pr} batches; pr has no mergeable; final done=true', async () => {
  const { enrichPipelinesPr, writeStoreMeta } = await import('../src/core/artifacts.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  stubGh({ state: 'OPEN', url: 'https://gh/x/pull/7', number: 7 });
  const idA = await seed();
  await seed();
  // listAllPipelines derives each row's projectDir from the store_meta row; pin it
  // to the literal `repo` so the rows are PR-enrich targets.
  writeStoreMeta(projectKey(repo), 'project', { key: projectKey(repo), path: repo, name: 'Repo' });
  const collected = [];
  let finalDone = null;
  await enrichPipelinesPr((items, done) => { collected.push(...items); finalDone = done; }, { batchSize: 1 });
  const a = collected.find((x) => x.id === idA);
  assert.ok(a, 'seeded branch row was enriched');
  assert.deepEqual(Object.keys(a).sort(), ['id', 'pr', 'projectKey'], 'only {projectKey,id,pr}');
  assert.equal(a.pr.state, 'OPEN');
  assert.ok(!('mergeable' in a.pr), 'no live mergeability field in v1 (clarification B)');
  assert.equal(finalDone, true, 'the final batch flags done=true');
});

test('enrichPipelinesPr with gh unavailable emits exactly one empty final batch', async () => {
  const { enrichPipelinesPr } = await import('../src/core/artifacts.mjs');
  gitInfo.setRunner((cmd, args) =>
    Promise.resolve(cmd === 'gh' && args[0] === '--version'
      ? { ok: false, stdout: '', stderr: 'not found', code: 127 }
      : { ok: true, stdout: '', stderr: '', code: 0 }));
  await seed();
  const batches = [];
  await enrichPipelinesPr((items, done) => batches.push({ items, done }));
  assert.equal(batches.length, 1, 'exactly one batch when gh is unavailable');
  assert.deepEqual(batches[0], { items: [], done: true });
});
