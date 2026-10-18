// test/ui-chat-pr-watch-words.test.mjs — Watch PR as chat words: the PR card's watch line and a fix-run card's outcome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prWatchLine, fixOutcomeText, prWatchReasonText, PR_WATCH_MAX_FIX_RUNS } from '../ui/public/chat/pr-watch-words.mjs';
import { MAX_FIX_RUNS } from '../src/core/pr-watch.mjs';

const V = (over = {}) => ({ watching: true, status: 'watching', reason: null, activePipelineId: null, resolving: false, mergingBase: null, ...over });

test('the browser copy of MAX_FIX_RUNS is the watcher\'s', () => assert.equal(PR_WATCH_MAX_FIX_RUNS, MAX_FIX_RUNS));

test('prWatchLine: words while watched or while a fix run works on the PR; null otherwise', () => {
  const rows = [
    [V(), { text: 'Watching', tone: 'none' }],
    [V({ status: 'starting' }), { text: 'Starting a fix run', tone: 'run' }],
    [V({ status: 'fixing', activePipelineId: 'f1' }), { text: 'Fixing', tone: 'run' }],
    [V({ status: 'publishing' }), { text: 'Pushing the fix', tone: 'run' }],
    [V({ status: 'fixing', resolving: true }), { text: 'Resolving conflicts', tone: 'run' }],
    [V({ status: 'fixing', mergingBase: 'dev' }), { text: 'Merging dev in', tone: 'run' }],
    [V({ watching: false, status: 'fixing', resolving: true }), { text: 'Resolving conflicts', tone: 'run' }],   // Resolve, watch off
    [V({ status: 'needs-person', reason: 'cap' }), { text: `Stopped: gave up after ${MAX_FIX_RUNS} fix runs`, tone: 'bad' }],
    [V({ status: 'needs-person', reason: 'checkout-locked' }), { text: 'Stopped: checkout locked', tone: 'bad' }],
    [V({ watching: false }), null],
    [V({ watching: false, status: 'ended', reason: 'merged' }), null],
    [null, null],
  ];
  for (const [view, want] of rows) assert.deepEqual(prWatchLine(view), want, JSON.stringify(view));
});

test('fixOutcomeText: pushed, gave up after the last run, the PR ended, failed', () => {
  assert.deepEqual(fixOutcomeText({ kind: 'pushed', sha: 'abc1234', stopped: null, fixRuns: 1 }), { text: 'Pushed the fix (abc1234)', tone: 'ok' });
  assert.deepEqual(fixOutcomeText({ kind: 'pushed', sha: 'abc1234', stopped: 'cap', fixRuns: 3 }), { text: 'Pushed the fix (abc1234) · gave up after 3 fix runs', tone: 'ok' });
  assert.deepEqual(fixOutcomeText({ kind: 'ended', reason: 'merged' }), { text: 'Not pushed: the pull request was merged', tone: 'none' });
  assert.deepEqual(fixOutcomeText({ kind: 'failed', reason: 'no-change' }), { text: 'Not pushed: the fix run changed nothing', tone: 'bad' });
  assert.equal(fixOutcomeText(null), null);
  assert.equal(prWatchReasonText('fix-interrupted'), 'the fix run was interrupted');
});
