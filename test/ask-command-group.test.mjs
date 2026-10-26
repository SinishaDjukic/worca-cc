// test/ask-command-group.test.mjs — command summaries (#911): which chat command cards join one card, and the head.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandRuns, fmtCmdDur, groupHead } from '../ui/public/ask-command-group.mjs';

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

test('groupHead: "3 commands · 6.1s" from the member views', () => {
  assert.equal(groupHead([{ durationMs: 1400 }, { durationMs: 1100 }, { durationMs: 3600 }]), '3 commands · 6.1s');
  assert.equal(groupHead([{ durationMs: 1100 }, null]), '2 commands · 1.1s');
});
