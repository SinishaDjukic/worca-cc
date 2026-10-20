// git-info addition for Publish branch (#618): the local and remote-tracking tips of a
// run's feature branch, read from refs only (no network). Every command goes through
// the stubbed runner; no git is spawned.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { _testing as gitInfo, branchTips, tipsRelation } from '../src/core/git-info.mjs';
import { checkRows } from './helpers/rows.mjs';

const ok = (stdout = '') => ({ ok: true, code: 0, stdout, stderr: '' });
const fail = (stderr = 'boom') => ({ ok: false, code: 1, stdout: '', stderr });

function stub(answer) {
  const calls = [];
  gitInfo.setRunner(async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return answer(cmd, args, opts);
  });
  return calls;
}

afterEach(() => gitInfo.reset());

test('branchTips: local and remote-tracking shas of one branch, exact ref names only', async () => {
  await checkRows([
    { name: 'branchTips: reads both refs with one for-each-ref', run: async () => {
      const calls = stub(() => ok('refs/heads/worca-cc/x aaa\nrefs/remotes/origin/worca-cc/x bbb\n'));
      assert.deepEqual(await branchTips('/p', 'worca-cc/x', 'origin'), { local: 'aaa', remote: 'bbb' });
      assert.equal(calls[0].cmd, 'git');
      assert.deepEqual(calls[0].args, ['for-each-ref', '--format=%(refname) %(objectname)',
        'refs/heads/worca-cc/x', 'refs/remotes/origin/worca-cc/x']);
      assert.equal(calls[0].opts.cwd, '/p');
    } },
    { name: 'branchTips: a ref under the branch name (prefix match) is not the branch', run: async () => {
      stub(() => ok('refs/heads/feat/sub ccc\r\nrefs/heads/feat aaa\r\n'));
      assert.deepEqual(await branchTips('/p', 'feat', 'origin'), { local: 'aaa', remote: null });
    } },
    { name: 'branchTips: no remote reads the local tip only', run: async () => {
      const calls = stub(() => ok('refs/heads/feat aaa\n'));
      assert.deepEqual(await branchTips('/p', 'feat', null), { local: 'aaa', remote: null });
      assert.deepEqual(calls[0].args, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/feat']);
    } },
    { name: 'branchTips: null on git failure or missing input (no spawn)', run: async () => {
      stub(() => fail());
      assert.equal(await branchTips('/p', 'feat', 'origin'), null);
      const calls = stub(() => ok());
      assert.equal(await branchTips(null, 'feat', 'origin'), null);
      assert.equal(await branchTips('/p', '', 'origin'), null);
      assert.equal(calls.length, 0);
    } },
  ]);
});

test('tipsRelation: which side of a published branch has commits the other lacks', async () => {
  await checkRows([
    { name: 'tipsRelation: equal tips are the same, with no spawn', run: async () => {
      const calls = stub(() => ok());
      assert.equal(await tipsRelation('/p', 'aaa', 'aaa'), 'same');
      assert.equal(calls.length, 0);
    } },
    { name: 'tipsRelation: counts remote...local with one rev-list in the repo', run: async () => {
      const calls = stub(() => ok('0\t2\n'));
      assert.equal(await tipsRelation('/p', 'loc', 'rem'), 'ahead');
      assert.deepEqual(calls[0].args, ['rev-list', '--left-right', '--count', 'rem...loc']);
      assert.equal(calls[0].opts.cwd, '/p');
    } },
    { name: 'tipsRelation: commits only on the remote are behind (the PR\'s Update branch, a collaborator push)', run: async () => {
      stub(() => ok('3\t0\n'));
      assert.equal(await tipsRelation('/p', 'loc', 'rem'), 'behind');
    } },
    { name: 'tipsRelation: commits on both sides are diverged', run: async () => {
      stub(() => ok('1\t4\n'));
      assert.equal(await tipsRelation('/p', 'loc', 'rem'), 'diverged');
    } },
    { name: 'tipsRelation: null when git fails, answers nothing usable, or a tip is missing', run: async () => {
      stub(() => fail());
      assert.equal(await tipsRelation('/p', 'loc', 'rem'), null);
      stub(() => ok(''));
      assert.equal(await tipsRelation('/p', 'loc', 'rem'), null);
      const calls = stub(() => ok('0\t1\n'));
      assert.equal(await tipsRelation('/p', null, 'rem'), null);
      assert.equal(await tipsRelation('/p', 'loc', null), null);
      assert.equal(await tipsRelation(null, 'loc', 'rem'), null);
      assert.equal(calls.length, 0);
    } },
  ]);
});
