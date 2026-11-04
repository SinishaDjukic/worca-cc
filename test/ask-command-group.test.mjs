// test/ask-command-group.test.mjs — command summaries (#911): which chat command cards join one card, and the head.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandRuns, fmtCmdDur, groupHead, groupHeadParts, groupOpen, isFailed } from '../ui/public/ask-command-group.mjs';

test('commandRuns: consecutive commands with a blank piece between them join; text or a non-command breaks a run', () => {
  // pieces[i] is the text BEFORE card i (pieces[0] before the first card)
  assert.deepEqual(commandRuns([true, true, true], ['Sync first.', '', '\n\n', '']), [[0, 2]]);
  assert.deepEqual(commandRuns([true, true, true], ['', '', 'Both rendered.', '']), [[0, 1]]);
  assert.deepEqual(commandRuns([true, false, true], ['', '', '', '']), []);
  assert.deepEqual(commandRuns([true], ['', '']), []);
});

test('fmtCmdDur: one decimal under 10 s, run-card durations from 10 s', () => {
  assert.equal(fmtCmdDur(1400), '1.4s');
  assert.equal(fmtCmdDur(200), '0.2s');
  assert.equal(fmtCmdDur(38_000), '38s');
  assert.equal(fmtCmdDur(130_000), '2m 10s');
});

test('groupHead: "Ran 3 commands · 6.1s" from the member views', () => {
  assert.equal(groupHead([{ durationMs: 1400 }, { durationMs: 1100 }, { durationMs: 3600 }]), 'Ran 3 commands · 6.1s');
  assert.equal(groupHead([{ durationMs: 1100 }, null]), 'Ran 2 commands · 1.1s');
});

test('groupHead: Ran / Running, "N failed" only when some failed, the live total', () => {
  const ok = { status: 'done', exitCode: 0 };
  assert.equal(groupHead([{ ...ok, durationMs: 1000 }, { status: 'done', exitCode: 1, durationMs: 500 }]), 'Ran 2 commands · 1 failed · 1.5s');
  const now = 50_000;
  assert.equal(groupHead([{ status: 'done', exitCode: 2, durationMs: 1000 }, { status: 'running', startedAt: now - 2000 }], now),
    'Running 2 commands · 1 failed · 3.0s');
  assert.deepEqual(groupHeadParts([{ status: 'stopped', durationMs: 100 }, ok], 0), { lead: 'Ran 2 commands', count: '', failed: 0, dur: '0.1s', running: false },
    'a stopped command is not a failed one');
  assert.equal(groupHead([ok, null], 0, true), 'Running 2 commands · 0.0s', 'live turn: a card with no frame yet runs');
  assert.equal(isFailed({ status: 'done', exitCode: null }), false);
});

test('groupHead: a running group leads with the running command\'s line, then the count', () => {
  const now = 50_000;
  assert.equal(groupHead([{ status: 'done', exitCode: 0, durationMs: 1000 }, { status: 'running', startedAt: now - 2000 }], now, false, 'Run the ui tests'),
    'Run the ui tests · 2 commands · 3.0s');
  const ok = { status: 'done', exitCode: 0, durationMs: 1000 };
  assert.equal(groupHead([ok, ok], now, false, 'Run the ui tests'), 'Ran 2 commands · 2.0s',
    'done: the line is dropped');
});

test('groupOpen: folded until the person opens it, running or failed alike', () => {
  assert.equal(groupOpen(undefined), false);
  assert.equal(groupOpen(true), true);
  assert.equal(groupOpen(false), false);
});
