// test/engine-ready-cache.test.mjs — the import-free readiness cache the text surfaces read (engines/ready-cache.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeReadiness, readyEnginesCached, resetEngineReadiness, READINESS_TTL_MS } from '../src/core/engines/ready-cache.mjs';

test('nothing checked: null (callers offer every other engine); a fresh answer: the ready names; stale: null', () => {
  resetEngineReadiness();
  assert.equal(readyEnginesCached(1000), null);
  storeReadiness([{ name: 'claude', ready: true }, { name: 'codex', ready: true }, { name: 'cursor', ready: false }], 1000);
  assert.deepEqual(readyEnginesCached(1000 + READINESS_TTL_MS - 1), ['claude', 'codex']);
  assert.equal(readyEnginesCached(1000 + READINESS_TTL_MS), null);
});
