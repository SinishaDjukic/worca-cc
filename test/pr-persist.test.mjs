// test/pr-persist.test.mjs
// Task 12 — PR facts (url/number/state/checked_at) are persisted onto the pipelines
// row at three write points: POST /api/pr, the History PR enrichment pass, and the
// archive-time final refresh. persistPrState is best-effort and NEVER touches
// updated_at (the stats layer uses updated_at as the terminal-write proxy).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { persistPrState, readPrState, enrichPipelinesPr, writeStoreMeta } from '../src/core/artifacts.mjs';
import { archivePipeline } from '../src/core/pipeline-delete.mjs';
import { _testing as gitInfo } from '../src/core/git-info.mjs';

useTempHome(after);

// A throwaway repo dir: only its projectKey + the store_meta `path` matter, every
// git/gh call goes through the stubbed runner below.
const repo = mkdtempSync(join(tmpdir(), 'worca-cc-prp-repo-'));
after(() => {
  gitInfo.reset();
  rmSync(repo, { recursive: true, force: true });
});

// gh present; `gh pr list` answers with `rows`. Local branch lookups deliberately
// FAIL so branchExists() is false and the archive path never reaches removeWorktree
// (there is no real worktree/branch to clean in a bare tmpdir).
function stubGhList(rows) {
  gitInfo.setRunner((cmd, args) => {
    if (cmd === 'gh' && args[0] === '--version') {
      return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    }
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
      return Promise.resolve({ ok: true, stdout: JSON.stringify(rows), stderr: '', code: 0 });
    }
    if (cmd === 'git' && args[0] === 'rev-parse') {
      return Promise.resolve({ ok: false, stdout: '', stderr: '', code: 1 });
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
}

// enrichPipelinesPr only targets rows where BOTH projectDir AND branch resolve, and
// projectDir comes from the store_meta row (not the pipelines row) — so seeding the
// branch JSON is only half the recipe; the store_meta path pin is the other half.
async function seedPipelineWithBranch({ feature, status = 'done' }) {
  const { id, key } = await seedPipeline(repo, {
    status, branch: { source: 'main', feature, branchKept: true },
  });
  writeStoreMeta(key, 'project', { key, name: 'Repo', path: repo });
  return id;
}

const runEnrichment = () => enrichPipelinesPr(() => {});

test('persistPrState writes pr_* and leaves updated_at untouched', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', { status: 'done' });
  const before = getDb().prepare('SELECT updated_at FROM pipelines WHERE id = ?').get(id).updated_at;
  persistPrState(id, { url: 'https://github.com/o/r/pull/7', number: 7, state: 'OPEN' });
  const row = getDb().prepare(
    'SELECT pr_url, pr_number, pr_state, pr_checked_at, updated_at FROM pipelines WHERE id = ?').get(id);
  assert.equal(row.pr_url, 'https://github.com/o/r/pull/7');
  assert.equal(row.pr_number, 7);
  assert.equal(row.pr_state, 'OPEN');
  assert.ok(row.pr_checked_at);
  assert.equal(row.updated_at, before);
});

test('persistPrState ignores missing url / missing id (no throw, no write)', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', { status: 'done' });
  persistPrState(id, null);
  persistPrState(id, {});
  persistPrState('', { url: 'x' });
  assert.equal(getDb().prepare('SELECT pr_url FROM pipelines WHERE id = ?').get(id).pr_url, null);
});

test('enrichPipelinesPr persists positive observations only', async () => {
  const id = await seedPipelineWithBranch({ feature: 'feat/x' });
  stubGhList([{ number: 9, state: 'MERGED', url: 'https://github.com/o/r/pull/9' }]);
  await runEnrichment();
  let row = getDb().prepare('SELECT pr_state FROM pipelines WHERE id = ?').get(id);
  assert.equal(row.pr_state, 'MERGED');
  stubGhList([]);                                        // now gh finds nothing
  await runEnrichment();
  row = getDb().prepare('SELECT pr_state FROM pipelines WHERE id = ?').get(id);
  assert.equal(row.pr_state, 'MERGED');                  // null observation never clears
});

test('readPrState returns the persisted facts or null', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', { status: 'done' });
  assert.equal(readPrState(id), null);
  persistPrState(id, { url: 'https://github.com/o/r/pull/2', number: 2, state: 'OPEN' });
  assert.deepEqual(readPrState(id), { url: 'https://github.com/o/r/pull/2', number: 2, state: 'OPEN' });
  assert.equal(readPrState(''), null);
});

test('enrichPipelinesPr resolves a row with a persisted pr_url via gh pr view <url>, not the branch search', async () => {
  const id = await seedPipelineWithBranch({ feature: 'feat/z' });
  const URL21 = 'https://github.com/up/repo/pull/21';
  persistPrState(id, { url: URL21, number: 21, state: 'OPEN' });
  const seen = [];
  gitInfo.setRunner((cmd, args) => {
    seen.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      // Answer ONLY this row's url. Other rows in the shared DB (feat/x from the test
      // above carries its own pr_url) get an empty view → branch search → [] → null.
      return args[2] === URL21
        ? Promise.resolve({ ok: true, stdout: JSON.stringify({ number: 21, state: 'MERGED', url: URL21 }), stderr: '', code: 0 })
        : Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
    }
    if (cmd === 'git' && args[0] === 'rev-parse') return Promise.resolve({ ok: false, stdout: '', stderr: '', code: 1 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });   // gh pr list → '' → [] → null
  });
  await runEnrichment();
  assert.equal(getDb().prepare('SELECT pr_state FROM pipelines WHERE id = ?').get(id).pr_state, 'MERGED');
  assert.ok(seen.some((c) => c[0] === 'gh' && c[2] === 'view' && c[3] === URL21));
  assert.ok(!seen.some((c) => c[0] === 'gh' && c[2] === 'list' && c[4] === 'feat/z'),
    'no branch search for the row whose pr_url is known');
});

test('archive runs a final PR refresh before FS cleanup', async () => {
  const id = await seedPipelineWithBranch({ feature: 'feat/y', status: 'done' });
  stubGhList([{ number: 11, state: 'MERGED', url: 'https://github.com/o/r/pull/11' }]);
  await archivePipeline({ projectDir: repo, id });
  const row = getDb().prepare('SELECT pr_state, pr_number, archived_at FROM pipelines WHERE id = ?').get(id);
  assert.equal(row.pr_state, 'MERGED');
  assert.equal(row.pr_number, 11);
  assert.ok(row.archived_at);
});
