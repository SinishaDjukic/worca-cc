import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWERS_MARKER, FIX_MARKER, THREAD_TITLE_MAX, specThreadTitle, answersMessage, fixMessage } from '../src/shared/spec-builder/messages.mjs';

test('specThreadTitle: first non-empty line, Markdown heading/list marks dropped', () => {
  assert.equal(specThreadTitle('# Charts\n- x'), 'Spec: Charts');
  assert.equal(specThreadTitle('\n\n- 1. Add export'), 'Spec: 1. Add export');
  assert.equal(specThreadTitle(''), 'Spec: Untitled');
});

test('specThreadTitle: capped at THREAD_TITLE_MAX (120) chars', () => {
  assert.equal(THREAD_TITLE_MAX, 120);
  assert.equal(specThreadTitle('x'.repeat(500)).length, 120);
});

test('answersMessage: starts with ANSWERS_MARKER and names every question id', () => {
  const m = answersMessage([{ id: 'q1', text: 'Who?' }, { id: 'q2', text: 'When?' }], { q1: ' admins ' });
  assert.ok(m.startsWith(ANSWERS_MARKER));
  assert.match(m, /- q1 — Who\? → admins/);
  assert.match(m, /- q2 — When\? → \(no answer/);
});

test('fixMessage: starts with FIX_MARKER and names every failing id', () => {
  const m = fixMessage([{ id: 'goal', label: 'Has a goal', detail: 'missing' }, { id: 'scope', label: 'Has scope' }]);
  assert.ok(m.startsWith(FIX_MARKER));
  assert.match(m, /- goal — Has a goal: missing/);
  assert.match(m, /- scope — Has scope$/);
});
