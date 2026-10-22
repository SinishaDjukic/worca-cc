// test/ui-chat-pr-watch-words.test.mjs — Watch PR as chat words: the PR link's watch tooltip, a stopped watch and a fix-run card's outcome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prWatchTooltip, watchStoppedText, fixOutcomeText, prWatchReasonText, PR_WATCH_MAX_FIX_RUNS } from '../ui/public/chat/pr-watch-words.mjs';
import { MAX_FIX_RUNS } from '../src/core/pr-watch.mjs';

const V = (over = {}) => ({ watching: true, status: 'watching', reason: null, activePipelineId: null, resolving: false, mergingBase: null, ...over });

test('the browser copy of MAX_FIX_RUNS is the watcher\'s', () => assert.equal(PR_WATCH_MAX_FIX_RUNS, MAX_FIX_RUNS));

test('s5: the PR link tooltip says the PR is watched; no line', () => {
  assert.equal(prWatchTooltip(781, { watching: true, status: 'watching' }), 'PR #781 · watched');
  assert.equal(prWatchTooltip(781, { watching: true, status: 'fixing' }), 'PR #781 · watched');
  assert.equal(prWatchTooltip(781, V({ watching: false, status: 'fixing', resolving: true })), 'PR #781 · watched');   // Resolve, watch off
  assert.equal(prWatchTooltip(781, { watching: true, status: 'needs-person', reason: 'cap' }), 'PR #781 · watch stopped');
  assert.equal(prWatchTooltip(781, { watching: false, status: 'ended' }), 'PR #781');
  assert.equal(prWatchTooltip(781, null), 'PR #781');
});

test('s5: watchStoppedText names the fix runs and what is still wrong, or the reason', () => {
  const cap = { status: 'needs-person', reason: 'cap', fixRuns: 3 };
  assert.equal(watchStoppedText(cap, ['checks']), 'Watch stopped · 3 fix runs, checks still failing');
  assert.equal(watchStoppedText(cap, ['checks', 'comments']), 'Watch stopped · 3 fix runs, checks still failing and review comments still open');
  assert.equal(watchStoppedText({ status: 'needs-person', reason: 'conflict-markers', fixRuns: 1 }, []), 'Watch stopped · conflict markers were left in');
  assert.equal(watchStoppedText({ status: 'needs-person', reason: 'checkout-locked' }, []), 'Watch stopped · checkout locked');
  assert.equal(watchStoppedText({ status: 'watching' }, []), null);
});

test('fixOutcomeText: pushed, gave up after the last run, the PR ended, failed', () => {
  assert.deepEqual(fixOutcomeText({ kind: 'pushed', sha: 'abc1234', stopped: null, fixRuns: 1 }), { text: 'Pushed the fix (abc1234)', tone: 'ok' });
  assert.deepEqual(fixOutcomeText({ kind: 'pushed', sha: 'abc1234', stopped: 'cap', fixRuns: 3 }), { text: 'Pushed the fix (abc1234) · gave up after 3 fix runs', tone: 'ok' });
  assert.deepEqual(fixOutcomeText({ kind: 'ended', reason: 'merged' }), { text: 'Not pushed: the pull request was merged', tone: 'none' });
  assert.deepEqual(fixOutcomeText({ kind: 'failed', reason: 'no-change' }), { text: 'Not pushed: the fix run changed nothing', tone: 'bad' });
  assert.equal(fixOutcomeText(null), null);
  assert.equal(prWatchReasonText('fix-interrupted'), 'the fix run was interrupted');
});
