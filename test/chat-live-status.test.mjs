// test/chat-live-status.test.mjs — the live status message's words: an Ask turn frame → a plain activity (never a
// tool argument, path or secret), and the elapsed time at a coarse step so a progress edit happens only when it moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityOf, elapsedLabel, statusText, WORKING } from '../src/core/chat/live-status.mjs';

const tool = (name, input = {}) => ({ type: 'ask-block', block: { kind: 'tool', id: 't1', name, input, status: 'running' } });

test('activityOf: plain words per tool family; arguments never show', () => {
  assert.equal(activityOf(tool('Read', { file_path: '/home/ada/.ssh/id_rsa' })), 'Reading files…');
  assert.equal(activityOf(tool('Grep', { pattern: 'ghp_secret' })), 'Searching files…');
  assert.equal(activityOf(tool('Bash', { command: 'curl -H "Authorization: Bearer sk-live" x' })), 'Running a command…');
  assert.equal(activityOf(tool('Edit', { file_path: '/x' })), 'Editing files…');
  assert.equal(activityOf(tool('WebSearch', { query: 'q' })), 'Searching the web…');
  assert.equal(activityOf(tool('mcp__worca__get_run', { id: '1234abcd-5678-90ef-0000-000000000000' })), 'Looking at run 1234abcd…');
  assert.equal(activityOf(tool('mcp__worca__get_run_diff', { id: 'not a run id; rm -rf /' })), 'Looking at a run…');
  assert.equal(activityOf(tool('mcp__worca__list_runs')), 'Looking at runs…');
  assert.equal(activityOf(tool('mcp__worca__propose_run', { prompt: 'p' })), 'Preparing a proposal…');
  assert.equal(activityOf(tool('mcp__worca__list_projects')), 'Checking worca…');
  assert.equal(activityOf(tool('mcp__github__create_issue', { token: 'x' })), 'Using a connected tool…');
  assert.equal(activityOf(tool('SomethingNew', { secret: 'x' })), 'Working…');
  assert.equal(activityOf({ type: 'ask-block', block: { kind: 'agent', id: 'a1', name: 'Explore' } }), 'Working with a helper agent…');
  assert.equal(activityOf({ type: 'ask-delta', text: 'The answer is 42' }), 'Writing the answer…');
  // Nothing to say: a finished tool row, other frames, junk.
  assert.equal(activityOf({ type: 'ask-block', block: { kind: 'tool', name: 'Read', status: 'done' } }), null);
  assert.equal(activityOf({ type: 'ask-usage' }), null);
  assert.equal(activityOf(null), null);
  assert.equal(activityOf({ type: 'ask-block', block: { kind: 'tool', name: { toString: 0 }, status: 'running' } }), 'Working…');
});

test('elapsedLabel: 5 s steps, minutes past one minute', () => {
  assert.equal(elapsedLabel(0), '0 s');
  assert.equal(elapsedLabel(4999), '0 s');
  assert.equal(elapsedLabel(12_000), '10 s');
  assert.equal(elapsedLabel(60_000), '1 min');
  assert.equal(elapsedLabel(125_000), '2 min 5 s');
  assert.equal(elapsedLabel(-5), '0 s');
});

test('statusText: the first post, then elapsed time and the activity', () => {
  assert.equal(WORKING, '⏳ Working on it… this message will update.');
  assert.equal(statusText({ elapsedMs: 25_000, activity: 'Reading files…' }), '⏳ Working on it… · 25 s\nReading files…');
  assert.equal(statusText({ elapsedMs: 7_000, activity: null }), '⏳ Working on it… · 5 s');
});
