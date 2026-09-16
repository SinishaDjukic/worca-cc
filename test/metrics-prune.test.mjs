// test/metrics-prune.test.mjs
// removeProject prunes the metrics worktree that belonged to the removed project (§5.10).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { git, makeOrigin, cloneAs, branchFiles, useGitSandbox } from './helpers/metrics-git.mjs';
import { addProject, removeProject } from '../src/core/projects.mjs';
import {
  enableTeamMetrics, outboxDir, worktreePath, writeOutbox, listOutbox, listOutboxSlugs, sweepOutboxRetention, flushSlug,
} from '../src/core/metrics/sync.mjs';
import { acquireLock } from '../src/core/metrics/lock.mjs';
import { readRunLedger } from '../src/core/metrics/ledger.mjs';
import { makeRecord } from './fixtures/team-metrics/records.mjs';

const skip = process.platform === 'win32' ? 'pre-receive hooks / sh not portable to win32' : false;

const root = mkdtempSync(join(tmpdir(), 'worca-metrics-prune-'));
useGitSandbox(before, after);   // FIRST: pins HOME / USERPROFILE / GIT_CONFIG_GLOBAL (§5.12)
useTempHome(after);
after(() => rmSync(root, { recursive: true, force: true }));

test('removeProject removes the metrics worktree and leaves the clone with one worktree', { skip }, async () => {
  const bare = makeOrigin(root, 'billing-api');
  const clone = cloneAs(root, 'machineA', bare, 'billing-api');
  await addProject({ name: 'billing-api', path: clone });
  await enableTeamMetrics(clone, { mode: 'here' });
  const wt = worktreePath('billing-api');
  assert.ok(existsSync(wt), 'the metrics worktree exists before removal');

  await removeProject('billing-api');

  assert.equal(existsSync(wt), false, 'the metrics worktree directory is gone');
  const list = git(clone, 'worktree', 'list', '--porcelain');
  const entries = list.split('\n\n').filter((e) => e.trim());
  assert.equal(entries.length, 1, 'only the clone itself remains in the worktree list');
});

test('removeProject still removes the metrics worktree when the clone directory is already gone', { skip }, async () => {
  const bare = makeOrigin(root, 'payments-api');
  const clone = cloneAs(root, 'machineB', bare, 'payments-api');
  await addProject({ name: 'payments-api', path: clone });
  await enableTeamMetrics(clone, { mode: 'here' });
  const wt = worktreePath('payments-api');
  assert.ok(existsSync(wt), 'the metrics worktree exists before removal');

  // Do NOT realpathSync `clone` here: this exercises safeReal's longest-existing-prefix walk
  // against the macOS /var vs /private/var alias git wrote into the worktree's `gitdir:` line.
  rmSync(clone, { recursive: true, force: true });
  assert.equal(existsSync(clone), false);

  await removeProject('payments-api');

  assert.equal(existsSync(wt), false, 'the metrics worktree directory is removed by gitdir match, even though the clone is gone');
});

test('removeProject returns within ~10s under a held slug lock, and the prune completes once it is released', { skip, timeout: 20_000 }, async () => {
  const bare = makeOrigin(root, 'gateway');
  const clone = cloneAs(root, 'machineC', bare, 'gateway');
  await addProject({ name: 'gateway', path: clone });
  await enableTeamMetrics(clone, { mode: 'here' });
  const wt = worktreePath('gateway');
  assert.ok(existsSync(wt), 'the metrics worktree exists before removal');

  const release = await acquireLock(join(outboxDir('gateway'), '.lock'));
  try {
    const startedAt = Date.now();
    await removeProject('gateway');
    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs < 10_500, `removeProject should return within ~10s of a held lock, took ${elapsedMs}ms`);
    // The lock was held the whole time: the prune could not have run yet.
    assert.ok(existsSync(wt), 'the worktree is untouched while the slug lock is held');
  } finally {
    await release();
  }

  // Once the lock is free, the background prune (kicked off by the earlier removeProject call)
  // completes on its own.
  const deadline = Date.now() + 5_000;
  while (existsSync(wt) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(existsSync(wt), false, 'the metrics worktree is pruned once the lock is released');
});

test("removeProject also drops the slug's outbox, so a removed project's queue does not re-fail forever (M1)", { skip }, async () => {
  const bare = makeOrigin(root, 'invoicing-api');
  const clone = cloneAs(root, 'machineD', bare, 'invoicing-api');
  await addProject({ name: 'invoicing-api', path: clone });
  await enableTeamMetrics(clone, { mode: 'here' });
  await writeOutbox('invoicing-api', makeRecord({ id: 'runP0001' }));
  assert.equal((await listOutbox('invoicing-api')).length, 1, 'a record is queued before removal');

  await removeProject('invoicing-api');

  assert.equal(existsSync(outboxDir('invoicing-api')), false, 'the outbox directory is gone along with the worktree');
  assert.deepEqual(await listOutbox('invoicing-api'), []);
  assert.ok(!(await listOutboxSlugs()).includes('invoicing-api'),
    'the background tick can no longer find this slug, so it stops scheduling a doomed NO_LOCAL_PROJECT flush');

  // sweepOutboxRetention must not error or resurrect anything for the now-absent slug.
  await assert.doesNotReject(sweepOutboxRetention());
});

test('removeProject keeps the outbox when another local checkout of the same slug can still push it (cycle-2 regression)', { skip }, async () => {
  const bare = makeOrigin(root, 'catalog-svc');
  // Same trailing path segment on both clones so the local-path slug fallback (§4.3) agrees.
  const cloneA = cloneAs(root, 'machineE', bare, 'catalog-svc');
  const cloneB = cloneAs(root, 'machineF', bare, 'catalog-svc');
  await addProject({ name: 'catalog-a', path: cloneA });
  await addProject({ name: 'catalog-b', path: cloneB });
  await enableTeamMetrics(cloneA, { mode: 'here' }); // clone A owns the worktree
  const slug = 'catalog-svc';
  const file = await writeOutbox(slug, makeRecord({ id: 'runQ0001' }));
  assert.deepEqual(await listOutbox(slug), [file], 'a record is queued before removal');

  await removeProject('catalog-a');

  assert.equal(existsSync(worktreePath(slug)), false, "clone A's metrics worktree is pruned");
  assert.deepEqual(await listOutbox(slug), [file],
    'the outbox survives: clone B is still a local checkout of this slug and can push it');
  assert.equal(readRunLedger('runQ0001').state, 'not-enabled', 'the still-pushable record is not marked skipped');

  // The next tick finds clone B as the owner (registered project + matching slug) and flushes fine.
  const res = await flushSlug(slug, { sleep: async () => {} });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(await listOutbox(slug), []);
  assert.ok(branchFiles(bare).includes('.worca-metrics/runs/2026/09/20260910T100000Z-runQ0001.jsonl'));
  assert.equal(readRunLedger('runQ0001').state, 'recorded');
});
