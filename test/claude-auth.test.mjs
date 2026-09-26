// test/claude-auth.test.mjs
// src/core/claude-auth.mjs#failedBecauseSignedOut — probe and routing are injected,
// so nothing here spawns a claude binary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failedBecauseSignedOut } from '../src/core/claude-auth.mjs';

const probeSays = (state, calls = []) => async (o) => { calls.push(o); return { state, source: 'cli', detail: null }; };
const notRouted = () => false;

test('the CLI\'s own "Not logged in" text is enough — no probe', async () => {
  const calls = [];
  assert.equal(await failedBecauseSignedOut({ message: 'claude exited with code 1: Not logged in · Please run /login', probe: probeSays('signed-in', calls), routed: notRouted }), true);
  assert.equal(calls.length, 0);
});

test('any other failure on a first-party model asks a FRESH `auth status`', async () => {
  const calls = [];
  const message = 'claude exited with code 1: [claude-code:unrecognized_model] {"model":"claude-opus-5-5"}';
  assert.equal(await failedBecauseSignedOut({ message, model: 'claude-opus-5-5', bin: 'claude', probe: probeSays('signed-out', calls), routed: notRouted }), true);
  assert.deepEqual(calls, [{ bin: 'claude', force: true }]);
  assert.equal(await failedBecauseSignedOut({ message, model: 'claude-opus-5-5', probe: probeSays('signed-in'), routed: notRouted }), false);
  assert.equal(await failedBecauseSignedOut({ message, probe: probeSays('unknown'), routed: notRouted }), false, 'unknown never counts');
});

test('a model routed to an endpoint / the bridge never blames the CLI sign-in', async () => {
  const calls = [];
  assert.equal(await failedBecauseSignedOut({ message: 'claude exited with code 1: 401', model: 'glm-4.7', probe: probeSays('signed-out', calls), routed: () => true }), false);
  assert.equal(calls.length, 0);
});

test('never throws', async () => {
  assert.equal(await failedBecauseSignedOut({ message: 'x', probe: async () => { throw new Error('boom'); }, routed: notRouted }), false);
});
