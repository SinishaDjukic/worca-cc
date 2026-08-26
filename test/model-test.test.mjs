// test/model-test.test.mjs — unit tests for the model connectivity check
// (Models-view Test button). testModel takes an injectable `run` so no claude
// binary is ever spawned; hintFor is pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testModel, hintFor } from '../src/core/model-test.mjs';

test('testModel: success returns ok + first-line capped reply and forwards the minimal run shape', async () => {
  let seen = null;
  const run = async (o) => { seen = o; return { text: '  OK\nsecond line ignored', exitCode: 0 }; };
  const res = await testModel('glm-4.7', { run });
  assert.deepEqual(res, { ok: true, text: 'OK' });
  assert.equal(seen.model, 'glm-4.7');
  assert.equal(seen.effort, 'low');
  assert.deepEqual(seen.allowedTools, []);
  assert.ok(seen.signal instanceof AbortSignal, 'timeout signal is wired');
  assert.ok(seen.prompt.length > 0);
  // modelEnv is whatever resolveModelEnv says for this id (undefined in the
  // sandboxed test env) — the key must be NAMED in the call either way.
  assert.ok('modelEnv' in seen);
});

test('testModel: long replies are capped', async () => {
  const run = async () => ({ text: 'x'.repeat(500), exitCode: 0 });
  const res = await testModel('m', { run });
  assert.equal(res.ok, true);
  assert.equal(res.text.length, 100);
});

test('testModel: run failure returns ok:false with the runner errorClass', async () => {
  const run = async () => {
    const err = new Error('claude exited with code 1: 401 authentication_error');
    err.errorClass = 'auth';
    throw err;
  };
  const res = await testModel('m', { run });
  assert.equal(res.ok, false);
  assert.equal(res.errorClass, 'auth');
  assert.match(res.message, /authentication_error/);
});

test('testModel: errorClass falls back to classifyError on unstamped errors', async () => {
  const run = async () => { throw new Error('ECONNREFUSED 127.0.0.1:9999'); };
  const res = await testModel('m', { run });
  assert.equal(res.ok, false);
  assert.equal(res.errorClass, 'network');
});

test('testModel: abort surfaces as timeout', async () => {
  const run = async ({ signal }) => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    if (signal?.aborted) throw err;
    throw err; // caller-aborted before the spawn behaves the same
  };
  const ctrl = new AbortController();
  ctrl.abort();
  const res = await testModel('m', { signal: ctrl.signal, run });
  assert.equal(res.ok, false);
  assert.equal(res.errorClass, 'timeout');
  assert.match(res.message, /[Tt]imed out|aborted/);
});

test('testModel: empty reply is a failure, not a silent pass', async () => {
  const run = async () => ({ text: '   ', exitCode: 0 });
  const res = await testModel('m', { run });
  assert.equal(res.ok, false);
  assert.match(res.message, /empty reply/i);
});

test('hintFor maps recovery classes to actionable text', () => {
  assert.match(hintFor('auth'), /token|secret|authentication/i);
  assert.match(hintFor('network'), /ANTHROPIC_BASE_URL|unreachable/i);
  assert.match(hintFor('rate_limit'), /rate|overloaded/i);
  assert.match(hintFor('quota'), /quota|billing|credit/i);
  assert.match(hintFor('usage_limit'), /limit/i);
  assert.match(hintFor('timeout'), /timed out/i);
  assert.equal(hintFor(null), '');
  assert.equal(hintFor('unknown-class'), '');
});
