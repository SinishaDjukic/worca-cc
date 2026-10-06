// test/engine-readiness.test.mjs — which run engines are ready now (engines/readiness.mjs): each adapter's own
// preflight, cached for the TTL; Claude always ready; mock reports every engine ready and spawns nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineReadiness } from '../src/core/engines/readiness.mjs';
import { readyEnginesCached, resetEngineReadiness } from '../src/core/engines/ready-cache.mjs';

test('runs each preflight once per TTL; claude is always ready; a refusal is not ready', async () => {
  resetEngineReadiness();
  let calls = 0;
  const preflights = { codex: async () => { calls++; return {}; }, cursor: async () => { calls++; return { refusal: 'cursor-agent is not signed in' }; } };
  const a = await engineReadiness({ preflights, now: 1000, mock: false });
  assert.deepEqual(a, [
    { name: 'claude', label: 'Claude', ready: true, reason: null },
    { name: 'codex', label: 'Codex', ready: true, reason: null },
    { name: 'cursor', label: 'Cursor', ready: false, reason: 'cursor-agent is not signed in' },
  ]);
  await engineReadiness({ preflights, now: 2000, mock: false });
  assert.equal(calls, 2, 'cached');
  assert.deepEqual(readyEnginesCached(2000), ['claude', 'codex']);
  await engineReadiness({ preflights, now: 2000, force: true, mock: false });
  assert.equal(calls, 4);
});

test('mock: every engine ready, nothing spawned', async () => {
  resetEngineReadiness();
  const list = await engineReadiness({ preflights: { cursor: async () => { throw new Error('spawned'); } }, mock: true, force: true });
  assert.ok(list.every((e) => e.ready));
});

test('a preflight that throws is a warning, still ready', async () => {
  resetEngineReadiness();
  const list = await engineReadiness({ preflights: { codex: async () => ({}), cursor: async () => { throw new Error('boom'); } }, mock: false, force: true });
  assert.deepEqual(list.find((e) => e.name === 'cursor'), { name: 'cursor', label: 'Cursor', ready: true, reason: 'boom' });
});
