// test/recovery-backoff.test.mjs — the ONE backoff rule for recoverable errors:
// the node retry loop (run-harness _backoff) and worca's own helper calls (the
// Auto classifier, title generation) share it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backoffBaseMs, retryAfterMs, recoveryDelayMs, sleepAbortable, withRecoveryRetry,
  RATE_LIMIT_BACKOFF_BASE_MS, NETWORK_BACKOFF_BASE_MS, MAX_RECOVERY_WAIT_MS,
} from '../src/core/recovery-backoff.mjs';

test('base: a rate limit waits longer than a network blip; the env override wins for both', () => {
  assert.equal(backoffBaseMs('rate_limit', {}), RATE_LIMIT_BACKOFF_BASE_MS);
  assert.equal(backoffBaseMs('network', {}), NETWORK_BACKOFF_BASE_MS);
  assert.ok(RATE_LIMIT_BACKOFF_BASE_MS > NETWORK_BACKOFF_BASE_MS);
  assert.equal(backoffBaseMs('rate_limit', { WORCA_RECOVERY_BACKOFF_MS: '0' }), 0);
  assert.equal(backoffBaseMs('network', { WORCA_RECOVERY_BACKOFF_MS: '250' }), 250);
  assert.equal(backoffBaseMs('network', { WORCA_RECOVERY_BACKOFF_MS: 'junk' }), NETWORK_BACKOFF_BASE_MS);
});

test('retryAfterMs reads a retry-after hint from the message, in seconds or ms', () => {
  assert.equal(retryAfterMs(new Error('rate limited — retry-after: 12')), 12_000);
  assert.equal(retryAfterMs('Please retry after 3 seconds'), 3_000);
  assert.equal(retryAfterMs('retry after 1500ms'), 1_500);
  assert.equal(retryAfterMs('rate limited (429)'), null);
  assert.equal(retryAfterMs(null), null);
});

test('recoveryDelayMs: exponential, never below a retry-after hint, capped per wait', () => {
  const env = {};
  assert.equal(recoveryDelayMs({ cls: 'rate_limit', attempt: 1, env }), RATE_LIMIT_BACKOFF_BASE_MS);
  assert.equal(recoveryDelayMs({ cls: 'rate_limit', attempt: 2, env }), RATE_LIMIT_BACKOFF_BASE_MS * 2);
  assert.equal(recoveryDelayMs({ cls: 'network', attempt: 3, env }), NETWORK_BACKOFF_BASE_MS * 4);
  assert.equal(recoveryDelayMs({ cls: 'network', attempt: 1, err: new Error('retry-after: 9'), env }), 9_000);
  assert.equal(recoveryDelayMs({ cls: 'rate_limit', attempt: 1, err: new Error('retry-after: 9999'), env }), MAX_RECOVERY_WAIT_MS);
  assert.equal(recoveryDelayMs({ cls: 'rate_limit', attempt: 30, env }), MAX_RECOVERY_WAIT_MS);
  // The test override (0) means "never wait", hint or not.
  assert.equal(recoveryDelayMs({ cls: 'rate_limit', attempt: 2, err: new Error('retry-after: 9'), env: { WORCA_RECOVERY_BACKOFF_MS: '0' } }), 0);
});

test('sleepAbortable resolves early on abort', async () => {
  const ac = new AbortController();
  const t0 = Date.now();
  const p = sleepAbortable(10_000, ac.signal);
  ac.abort();
  await p;
  assert.ok(Date.now() - t0 < 1000);
  await sleepAbortable(0);   // zero never schedules
});

test('withRecoveryRetry retries a rate_limit then succeeds, reporting each wait', async () => {
  let calls = 0;
  const waits = [];
  const out = await withRecoveryRetry(async () => {
    calls++;
    if (calls < 3) { const e = new Error('rate limited (429)'); e.errorClass = 'rate_limit'; throw e; }
    return 'ok';
  }, { attempts: 3, env: { WORCA_RECOVERY_BACKOFF_MS: '1' }, onRetry: (w) => waits.push(w) });
  assert.equal(out, 'ok');
  assert.equal(calls, 3);
  assert.equal(waits.length, 2);
  assert.deepEqual(waits.map((w) => [w.attempt, w.cls]), [[1, 'rate_limit'], [2, 'rate_limit']]);
  assert.equal(waits[1].delayMs, 2);
});

test('withRecoveryRetry rethrows a non-retryable class at once, and the last error after the budget', async () => {
  let calls = 0;
  await assert.rejects(withRecoveryRetry(async () => { calls++; throw new Error('401 Invalid authentication credentials'); },
    { attempts: 3, env: { WORCA_RECOVERY_BACKOFF_MS: '0' } }), /401/);
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(withRecoveryRetry(async () => { calls++; throw new Error(`ECONNRESET #${calls}`); },
    { attempts: 2, env: { WORCA_RECOVERY_BACKOFF_MS: '0' } }), /ECONNRESET #3/);
  assert.equal(calls, 3, '1 try + 2 retries');
});

test('withRecoveryRetry: `classes` narrows what is retried', async () => {
  let calls = 0;
  await assert.rejects(withRecoveryRetry(async () => { calls++; throw new Error('ECONNRESET'); },
    { classes: ['rate_limit'], env: { WORCA_RECOVERY_BACKOFF_MS: '0' } }), /ECONNRESET/);
  assert.equal(calls, 1, 'network is not in the list: no retry');
});

test('withRecoveryRetry stops retrying once the signal aborts', async () => {
  const ac = new AbortController();
  let calls = 0;
  await assert.rejects(withRecoveryRetry(async () => { calls++; ac.abort(); throw new Error('429'); },
    { attempts: 5, signal: ac.signal, env: { WORCA_RECOVERY_BACKOFF_MS: '0' } }), /429/);
  assert.equal(calls, 1);
});
