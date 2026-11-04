// test/undo-tokens.test.mjs — one-shot Undo tokens for Add to group (src/core/undo-tokens.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rememberUndo, takeUndo, UNDO_TTL_MS } from '../src/core/undo-tokens.mjs';

test('a token runs once, for its scope and actor, until it expires', () => {
  const fn = () => 'ran';
  const t = rememberUndo(fn, { scope: 'run-groups', by: 'ana', now: 1000 });
  assert.equal(takeUndo(t, { scope: 'ask-groups', by: 'ana', now: 1001 }), null, 'another scope');
  assert.equal(takeUndo(t, { scope: 'run-groups', by: 'bo', now: 1001 }), null, 'another actor');
  assert.equal(takeUndo(t, { scope: 'run-groups', by: 'ana', now: 1001 }), fn);
  assert.equal(takeUndo(t, { scope: 'run-groups', by: 'ana', now: 1002 }), null, 'one use');
  const old = rememberUndo(fn, { scope: 'run-groups', now: 0 });
  assert.equal(takeUndo(old, { scope: 'run-groups', now: UNDO_TTL_MS + 1 }), null, 'expired');
});
