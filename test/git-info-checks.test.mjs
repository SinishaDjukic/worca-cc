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
  assert.deepEqual(rollupChecks([]), { state: 'none', total: 0, failed: 0, pending: 0 });
  assert.deepEqual(rollupChecks(null), { state: 'none', total: 0, failed: 0, pending: 0 });
  assert.equal(rollupChecks([run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'SKIPPED'), run('COMPLETED', 'NEUTRAL'), ctx('SUCCESS')]).state, 'passing');
  assert.deepEqual(rollupChecks([run('COMPLETED', 'SUCCESS'), run('IN_PROGRESS'), run('QUEUED'), ctx('PENDING')]),
    { state: 'pending', total: 4, failed: 0, pending: 3 });
  assert.deepEqual(rollupChecks([run('IN_PROGRESS'), run('COMPLETED', 'FAILURE'), run('COMPLETED', 'TIMED_OUT'), ctx('ERROR')]),
    { state: 'failing', total: 4, failed: 3, pending: 1 });
  assert.equal(rollupChecks([run('COMPLETED', 'CANCELLED')]).state, 'failing');
  assert.equal(rollupChecks([ctx('EXPECTED')]).state, 'pending');
});

test('ghPrChecks: one gh pr view for checks and mergeability; null on gh failure, bad JSON or a non-GitHub URL', async () => {
  const PR = 'https://github.com/acme/app/pull/7';
  const calls = [];
  gitInfo.setRunner(async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return ok(JSON.stringify({ mergeable: 'CONFLICTING', statusCheckRollup: [run('COMPLETED', 'SUCCESS')] }));
  });
  assert.deepEqual(await ghPrChecks({ projectDir: '/p', prUrl: PR }),
    { checks: { state: 'passing', total: 1, failed: 0, pending: 0 }, mergeable: 'CONFLICTING' });
  const gh = calls.filter((c) => c.cmd === 'gh' && c.args[0] === 'pr');
  assert.deepEqual(gh.map((c) => c.args), [['pr', 'view', PR, '--json', 'mergeable,statusCheckRollup']]);
  assert.equal(gh[0].opts.cwd, '/p');

  gitInfo.setRunner(async () => ({ ok: false, code: 1, stdout: '', stderr: 'boom' }));
  assert.equal(await ghPrChecks({ projectDir: '/p', prUrl: PR }), null);
  gitInfo.setRunner(async () => ok('not json'));
  assert.equal(await ghPrChecks({ projectDir: '/p', prUrl: PR }), null);
  assert.equal(await ghPrChecks({ projectDir: '/p', prUrl: 'https://gitlab.com/a/b/-/merge_requests/1' }), null);
});
