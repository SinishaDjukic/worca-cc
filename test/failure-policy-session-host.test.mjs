// test/failure-policy-session-host.test.mjs — a misbehaving main agent is retried on the same host, then parks the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFailure, RECOVERY_MAX_AUTO_ATTEMPTS } from '../src/core/failure-policy.mjs';
import { classifyError } from '../src/core/recoverable-error.mjs';
import { SessionHostError, SESSION_HOST_CODES, isSessionHostError } from '../src/core/engines/session-dispatch.mjs';

test('every watchdog code classifies as session_host, whatever its message says', () => {
  for (const code of SESSION_HOST_CODES) {
    const e = new SessionHostError(code, 'network timeout 429 limit resets 6pm', { agentCalls: 0 });
    assert.equal(classifyError(e), 'session_host', code);
    assert.equal(isSessionHostError(e), true);
    assert.equal(e.name, 'SessionHostError');
  }
});

test('session_host retries RECOVERY_MAX_AUTO_ATTEMPTS times, then pauses as an error, in both modes', () => {
  for (const auto of [true, false]) {
    for (let a = 1; a <= RECOVERY_MAX_AUTO_ATTEMPTS; a += 1) assert.deepEqual(resolveFailure({ site: 'node', cls: 'session_host', auto, attempt: a }), { outcome: 'retry' });
    assert.deepEqual(resolveFailure({ site: 'node', cls: 'session_host', auto, attempt: RECOVERY_MAX_AUTO_ATTEMPTS + 1 }), { outcome: 'pause', reason: 'error' });
  }
});

test('v5 — the error carries its code and detail; the codes are the pinned six; nothing else is a SessionHostError', () => {
  assert.deepEqual([...SESSION_HOST_CODES], ['SESSION_HOST_NO_DISPATCH', 'SESSION_HOST_MULTI_DISPATCH', 'SESSION_HOST_STRAY_TOOL',
    'SESSION_HOST_VANISHED', 'SESSION_HOST_CAP', 'SESSION_HOST_BUDGET']);
  assert.equal(Object.isFrozen(SESSION_HOST_CODES), true);
  const e = new SessionHostError('SESSION_HOST_CAP', 'cap reached', { dispatches: 24 });
  assert.ok(e instanceof Error);
  assert.equal(e.code, 'SESSION_HOST_CAP');
  assert.equal(e.message, 'cap reached');
  assert.deepEqual(e.detail, { dispatches: 24 });
  assert.deepEqual(new SessionHostError('SESSION_HOST_VANISHED', 'gone').detail, {});
  for (const x of [new Error('SESSION_HOST_CAP'), Object.assign(new Error('x'), { errorClass: 'session_host', code: 'SESSION_HOST_CAP' }), null, undefined]) {
    assert.equal(isSessionHostError(x), false, String(x));
  }
});
