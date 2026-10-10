// The run page's PR status line: gh's statusCheckRollup folded into passing / pending /
// failing / none, and ghPrChecks reading it with mergeability in one gh call.
// Every command goes through the stubbed runner; no gh is spawned.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { _testing as gitInfo, rollupChecks, ghPrChecks } from '../src/core/git-info.mjs';

const ok = (stdout = '') => ({ ok: true, code: 0, stdout, stderr: '' });
const run = (status, conclusion = '') => ({ __typename: 'CheckRun', name: 'ci', status, conclusion });
const ctx = (state) => ({ __typename: 'StatusContext', context: 'ci', state });

afterEach(() => gitInfo.reset());

test('rollupChecks: any failure wins, then anything still running, then passing; none without checks', () => {
  assert.deepEqual(rollupChecks([]), { state: 'none', total: 0, failed: 0, pending: 0, skipped: 0, inherited: 0 });
  assert.deepEqual(rollupChecks(null), { state: 'none', total: 0, failed: 0, pending: 0, skipped: 0, inherited: 0 });
  assert.equal(rollupChecks([run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'SKIPPED'), run('COMPLETED', 'NEUTRAL'), ctx('SUCCESS')]).state, 'passing');
  assert.deepEqual(rollupChecks([run('COMPLETED', 'SUCCESS'), run('IN_PROGRESS'), run('QUEUED'), ctx('PENDING')]),
    { state: 'pending', total: 4, failed: 0, pending: 3, skipped: 0, inherited: 0 });
  assert.deepEqual(rollupChecks([run('IN_PROGRESS'), run('COMPLETED', 'FAILURE'), run('COMPLETED', 'TIMED_OUT'), ctx('ERROR')]),
    { state: 'failing', total: 4, failed: 3, pending: 1, skipped: 0, inherited: 0 });
  assert.equal(rollupChecks([run('COMPLETED', 'CANCELLED')]).state, 'failing');
  assert.equal(rollupChecks([ctx('EXPECTED')]).state, 'pending');
  // GitHub lists skipped checks apart (PR #658: 9 passed, 1 skipped), so they are not in `total`.
  assert.deepEqual(rollupChecks([...Array(9)].map(() => run('COMPLETED', 'SUCCESS')).concat(run('COMPLETED', 'SKIPPED'))),
    { state: 'passing', total: 9, failed: 0, pending: 0, skipped: 1, inherited: 0 });
  assert.equal(rollupChecks([run('COMPLETED', 'SKIPPED')]).state, 'none', 'only skipped: nothing ran');
});

test('ghPrChecks: one gh pr view for checks and mergeability; null on gh failure, bad JSON or a non-GitHub URL', async () => {
  const PR = 'https://github.com/acme/app/pull/7';
  const calls = [];
  gitInfo.setRunner(async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return ok(JSON.stringify({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', reviewDecision: '', isDraft: false,
      statusCheckRollup: [run('COMPLETED', 'SUCCESS')] }));
  });
  assert.deepEqual(await ghPrChecks({ projectDir: '/p', prUrl: PR }),
    { checks: { state: 'passing', total: 1, failed: 0, pending: 0, skipped: 0, inherited: 0 }, mergeable: 'CONFLICTING', base: null,
      status: { tone: 'bad', label: 'Merge conflicts', detail: 'Check passed' } });
  const gh = calls.filter((c) => c.cmd === 'gh' && c.args[0] === 'pr');
  assert.deepEqual(gh.map((c) => c.args), [['pr', 'view', PR, '--json', 'mergeable,mergeStateStatus,reviewDecision,isDraft,statusCheckRollup']]);
  assert.equal(gh[0].opts.cwd, '/p');

  gitInfo.setRunner(async () => ({ ok: false, code: 1, stdout: '', stderr: 'boom' }));
  assert.equal(await ghPrChecks({ projectDir: '/p', prUrl: PR }), null);
  gitInfo.setRunner(async () => ok('not json'));
  assert.equal(await ghPrChecks({ projectDir: '/p', prUrl: PR }), null);
  assert.equal(await ghPrChecks({ projectDir: '/p', prUrl: 'https://gitlab.com/a/b/-/merge_requests/1' }), null);
});

test('prMergeStatus: the verdict GitHub\'s merge box would lead with, in its order', async () => {
  const { prMergeStatus } = await import('../src/core/git-info.mjs');
  const pass = { state: 'passing', total: 12, failed: 0, pending: 0 };
  const fail = { state: 'failing', total: 11, failed: 3, pending: 0 };
  const runs = { state: 'pending', total: 11, failed: 0, pending: 4 };
  const rows = [
    [{ checks: pass, mergeState: 'CLEAN' }, 'ok', 'Ready to merge', 'All 12 checks passed'],
    [{ checks: { state: 'passing', total: 9, failed: 0, pending: 0, skipped: 1, inherited: 0 }, mergeState: 'CLEAN' }, 'ok', 'Ready to merge', 'All 9 checks passed, 1 skipped'],
    [{ checks: { state: 'failing', total: 10, failed: 2, pending: 0, skipped: 1, inherited: 0 } }, 'bad', '2 of 10 checks failed, 1 skipped', ''],
    [{ checks: pass, mergeState: 'UNSTABLE' }, 'ok', 'Ready to merge', 'All 12 checks passed'],
    [{ checks: pass, draft: true, mergeState: 'DIRTY' }, 'none', 'Draft', 'All 12 checks passed'],
    [{ checks: fail, mergeable: 'CONFLICTING' }, 'bad', 'Merge conflicts', '3 of 11 checks failed'],
    [{ checks: pass, mergeState: 'DIRTY' }, 'bad', 'Merge conflicts', 'All 12 checks passed'],
    [{ checks: pass, reviewDecision: 'CHANGES_REQUESTED', mergeState: 'BLOCKED' }, 'bad', 'Changes requested', 'All 12 checks passed'],
    [{ checks: fail, mergeState: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }, 'bad', '3 of 11 checks failed', ''],
    [{ checks: runs, mergeState: 'BLOCKED' }, 'run', 'Checks running · 7 of 11 done', ''],
    [{ checks: pass, mergeState: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }, 'wait', 'Review required', 'All 12 checks passed'],
    [{ checks: pass, mergeState: 'BEHIND' }, 'wait', 'Out of date with the base branch', 'All 12 checks passed'],
    [{ checks: pass, mergeState: 'BLOCKED' }, 'wait', 'Blocked by branch rules', 'All 12 checks passed'],
    [{ checks: pass, mergeState: 'UNKNOWN' }, 'ok', 'All 12 checks passed', ''],
    [{ mergeState: 'UNKNOWN' }, 'none', '', ''],
  ];
  for (const [input, tone, label, detail] of rows) {
    assert.deepEqual(prMergeStatus(input), { tone, label, detail }, JSON.stringify(input));
  }
});

test('rollupChecks: a failure that also fails on the base branch head is inherited, not the PR\'s', () => {
  const named = (name, conclusion) => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion });
  const items = [...Array(8)].map((_, i) => named(`ok${i}`, 'SUCCESS'))
    .concat(named('mine', 'FAILURE'), named('ui proofs', 'FAILURE'), { __typename: 'StatusContext', context: 'ci/legacy', state: 'ERROR' });
  assert.deepEqual(rollupChecks(items, { baseFailing: ['ui proofs', 'ci/legacy', 'not here'] }),
    { state: 'failing', total: 11, failed: 1, pending: 0, skipped: 0, inherited: 2 });
  // Only inherited failures: the PR's own checks passed.
  assert.equal(rollupChecks(items.filter((c) => c.name !== 'mine'), { baseFailing: ['ui proofs', 'ci/legacy'] }).state, 'passing');
});

test('prMergeStatus: inherited failures are named apart, with the real base branch', async () => {
  const { prMergeStatus } = await import('../src/core/git-info.mjs');
  assert.deepEqual(prMergeStatus({ checks: { state: 'failing', total: 11, failed: 1, pending: 0, skipped: 0, inherited: 2 }, base: 'dev' }),
    { tone: 'bad', label: '1 of 11 checks failed · 2 also failing on dev', detail: '' });
  assert.deepEqual(prMergeStatus({ checks: { state: 'passing', total: 11, failed: 0, pending: 0, skipped: 1, inherited: 2 }, base: 'dev', mergeState: 'BLOCKED' }),
    { tone: 'wait', label: 'Blocked by branch rules', detail: '9 of 11 checks passed, 1 skipped · 2 also failing on dev' });
  assert.equal(prMergeStatus({ checks: { state: 'pending', total: 11, failed: 0, pending: 4, skipped: 0, inherited: 1 }, base: 'main' }).label,
    'Checks running · 7 of 11 done · 1 also failing on main');
  assert.equal(prMergeStatus({ checks: { state: 'failing', total: 3, failed: 1, pending: 0, skipped: 0, inherited: 1 } }).label,
    '1 of 3 checks failed · 1 also failing on the base branch');
});

test('ghPrChecks reads the base head\'s failing checks with the watch snapshot\'s fields and counts them apart', async () => {
  const PR = 'https://github.com/acme/app/pull/7';
  const calls = [];
  gitInfo.setRunner(async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (args[0] === 'api') {
      return ok(JSON.stringify({ data: { repository: { pullRequest: { baseRefName: 'dev', baseRef: { target: { statusCheckRollup: { contexts: { nodes: [
        { __typename: 'CheckRun', name: 'ui proofs', status: 'COMPLETED', conclusion: 'FAILURE' },
        { __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS' },
      ] } } } } } } } }));
    }
    if (args[0] === 'pr') {
      return ok(JSON.stringify({ mergeable: 'MERGEABLE', mergeStateStatus: 'UNSTABLE', reviewDecision: '', isDraft: false,
        statusCheckRollup: [run('COMPLETED', 'SUCCESS'), { __typename: 'CheckRun', name: 'ui proofs', status: 'COMPLETED', conclusion: 'FAILURE' },
          { __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE' }] }));
    }
    return ok('');
  });
  const r = await ghPrChecks({ projectDir: '/p', prUrl: PR });
  assert.deepEqual([r.base, r.checks.failed, r.checks.inherited, r.status.label], ['dev', 1, 1, '1 of 3 checks failed · 1 also failing on dev']);
  const q = calls.find((c) => c.args[0] === 'api').args.join(' ');
  assert.match(q, /baseRefName baseRef\{target\{\.\.\. on Commit\{statusCheckRollup/);

  // The base read failing only drops the split: every failure counts as the PR's.
  gitInfo.setRunner(async (cmd, args) => (args[0] === 'api' ? { ok: false, code: 1, stdout: '', stderr: 'boom' }
    : ok(JSON.stringify({ mergeable: 'MERGEABLE', statusCheckRollup: [{ __typename: 'CheckRun', name: 'ui proofs', status: 'COMPLETED', conclusion: 'FAILURE' }] }))));
  const r2 = await ghPrChecks({ projectDir: '/p', prUrl: PR });
  assert.deepEqual([r2.base, r2.checks.failed, r2.checks.inherited], [null, 1, 0]);
});
