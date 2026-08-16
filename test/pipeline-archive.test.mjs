import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { archivePipeline } from '../src/core/pipeline-delete.mjs';
import { countPipelines, listAllPipelines } from '../src/core/artifacts.mjs';

useTempHome(after);

const countVisible = () => countPipelines();
const listAllVisibleIds = async () => (await listAllPipelines()).map((e) => e.id);

test('archive keeps the row + step children, stamps archived_at, reports archived:true', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', {
    status: 'done', totalCostUsd: 1.5,
    // Seed real step children: the old `n >= 0` assertion below held even when a
    // cascade wiped every one of them.
    steps: [
      { key: 'plan', costUsd: 1, activeMs: 1000 },
      { key: 'code', costUsd: 0.5, activeMs: 2000 },
    ],
  });
  const report = await archivePipeline({ projectDir: '/tmp/proj-a', id });
  assert.equal(report.ok, true);
  assert.equal(report.archived, true);
  const row = getDb().prepare('SELECT archived_at, total_cost_usd FROM pipelines WHERE id = ?').get(id);
  assert.ok(row, 'row survives');
  assert.ok(row.archived_at, 'archived_at stamped');
  assert.equal(row.total_cost_usd, 1.5);
  const steps = getDb().prepare('SELECT COUNT(*) n FROM pipeline_steps WHERE pipeline_id = ?').get(id);
  assert.equal(steps.n, 2, 'no cascade fired — steps survive for the stats fallback sums');
  const arts = getDb().prepare('SELECT COUNT(*) n FROM artifacts WHERE pipeline_id = ?').get(id);
  assert.equal(arts.n, 0, 'artifact index rows cleaned (files were unlinked)');
});

test('archive is idempotent: second call reports alreadyArchived and does no second FS pass', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', { status: 'done' });
  await archivePipeline({ projectDir: '/tmp/proj-a', id });
  const again = await archivePipeline({ projectDir: '/tmp/proj-a', id });
  assert.equal(again.alreadyArchived, true);
});

test('active statuses refuse archive (RUNNING error code preserved)', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', { status: 'running' });
  await assert.rejects(() => archivePipeline({ projectDir: '/tmp/proj-a', id }),
    (e) => e.code === 'RUNNING');
});

test('archive refuses a live worktree retained after a commit failure', async () => {
  const retainedDir = await mkdtemp(join(tmpdir(), 'worca-retained-archive-'));
  try {
    const { id } = await seedPipeline('/tmp/proj-a', {
      status: 'done',
      branch: {
        worktreeDir: retainedDir,
        commitFailed: { code: 'commit_failed', step: 'commit', message: 'hook failed' },
      },
    });
    await assert.rejects(() => archivePipeline({ projectDir: '/tmp/proj-a', id }),
      (e) => e.code === 'RETAINED_WORKTREE');
    assert.equal(getDb().prepare('SELECT archived_at FROM pipelines WHERE id = ?').get(id).archived_at, null);
  } finally {
    await rm(retainedDir, { recursive: true, force: true });
  }
});

test('archived rows vanish from list + count reads but stay readable by id', async () => {
  const { id: keep } = await seedPipeline('/tmp/proj-a', { status: 'done' });
  const { id: gone } = await seedPipeline('/tmp/proj-a', { status: 'done' });
  const before = countVisible();
  await archivePipeline({ projectDir: '/tmp/proj-a', id: gone });
  assert.equal(countVisible(), before - 1);
  const listed = await listAllVisibleIds();
  assert.ok(listed.includes(keep));
  assert.ok(!listed.includes(gone));
  const byId = getDb().prepare('SELECT id FROM pipelines WHERE id = ?').get(gone);
  assert.ok(byId, 'by-id read still resolves');
});

test('ledger rows survive archive', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', { status: 'done' });
  getDb().prepare('INSERT INTO cost_ledger (pipeline_id, amount_usd, ts) VALUES (?, ?, ?)')
    .run(id, 0.4, Date.now());
  await archivePipeline({ projectDir: '/tmp/proj-a', id });
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM cost_ledger WHERE pipeline_id = ?').get(id).n, 1);
});

test('unknown id returns null (404 mapping preserved)', async () => {
  assert.equal(await archivePipeline({ projectDir: '/tmp/proj-a', id: 'missing' }), null);
});
