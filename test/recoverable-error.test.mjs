// test/recoverable-error.test.mjs — pure classifier unit tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../src/core/recoverable-error.mjs';

test('classifies the reported headless auth failure as auth', () => {
  const e = new Error('claude exited with code 1: Failed to authenticate. API Error: 401 Invalid authentication credentials');
  assert.equal(classifyError(e), 'auth');
});

test('classifies authentication_error / not-logged-in as auth', () => {
  assert.equal(classifyError(new Error('authentication_error: token expired')), 'auth');
  assert.equal(classifyError(new Error('Not logged in. Please run claude login')), 'auth');
});

test('classifies 429 / 529 / overloaded as rate_limit', () => {
  assert.equal(classifyError(new Error('API Error: 429 rate_limit_error')), 'rate_limit');
  assert.equal(classifyError(new Error('API Error: 529 Overloaded')), 'rate_limit');
});

test('classifies credit/quota/billing as quota', () => {
  assert.equal(classifyError(new Error('Your credit balance is too low to access the API')), 'quota');
  assert.equal(classifyError(new Error('usage limit reached')), 'quota');
});

test('classifies the session/usage cap (resets after a wait) as usage_limit', () => {
  // The exact strings the Claude CLI prints when the 5h session cap is hit.
  assert.equal(classifyError(new Error("You've hit your session limit · resets 6pm (Europe/Sofia)")), 'usage_limit');
  assert.equal(classifyError(new Error("You've reached your weekly limit")), 'usage_limit');
  assert.equal(classifyError(new Error('claude exited with code 1: limit reached · resets 11am')), 'usage_limit');
  // A bare 429/credit message must NOT be swallowed by usage_limit.
  assert.equal(classifyError(new Error('API Error: 429 rate_limit_error')), 'rate_limit');
});

test('classifies connectivity failures as network', () => {
  assert.equal(classifyError(new Error('request to https://api.anthropic.com failed, reason: ECONNRESET')), 'network');
  assert.equal(classifyError(new Error('fetch failed')), 'network');
  assert.equal(classifyError(new Error('socket hang up')), 'network');
});

test('classifies the Claude CLI mid-response disconnect as network', () => {
  // The exact strings the headless CLI folds into its reject when the connection
  // drops mid-stream (the reported "stopped my internet" repro).
  assert.equal(
    classifyError(new Error('claude exited with code 1: API Error: Connection closed mid-response. The response above may be incomplete.')),
    'network',
  );
  assert.equal(classifyError(new Error('API Error: Connection closed mid-response.')), 'network');
  assert.equal(classifyError(new Error('Connection error.')), 'network');
});

test('returns null for a plain bug and accepts a raw string / nullish', () => {
  assert.equal(classifyError(new Error('TypeError: x is not a function')), null);
  assert.equal(classifyError('401 Invalid authentication credentials'), 'auth');
  assert.equal(classifyError(null), null);
  assert.equal(classifyError(undefined), null);
});
