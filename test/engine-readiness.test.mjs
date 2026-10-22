// test/engine-readiness.test.mjs — which run engines are ready now (engines/readiness.mjs): each adapter's own
// preflight, cached for the TTL; Claude always ready; mock reports every engine ready and spawns nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineReadiness } from '../src/core/engines/readiness.mjs';
import { readyEnginesCached, resetEngineReadiness } from '../src/core/engines/ready-cache.mjs';

test('runs each preflight once per TTL; claude is always ready; a refusal is not ready', async () => {
  resetEngineReadiness();
  let calls = 0;
  const preflights = { codex: async () => { calls++; return {}; }, copilot: async () => { calls++; return { refusal: 'cannot run copilot' }; }, cursor: async () => { calls++; return { refusal: 'cursor-agent is not signed in' }; },
    gemini: async () => { calls++; return {}; },
    goose: async () => { calls++; return { warning: 'could not check goose' }; },
    opencode: async () => { calls++; return { warning: 'no provider credentials' }; },
    qwen: async () => { calls++; return { refusal: 'qwen is not signed in' }; } };
  const a = await engineReadiness({ preflights, now: 1000, mock: false, backends: () => [] });
  assert.deepEqual(a, [
    { name: 'claude', label: 'Claude', ready: true, reason: null },
    { name: 'codex', label: 'Codex', ready: true, reason: null },
    { name: 'copilot', label: 'Copilot', ready: false, reason: 'cannot run copilot' },
    { name: 'cursor', label: 'Cursor', ready: false, reason: 'cursor-agent is not signed in' },
    { name: 'gemini', label: 'Gemini CLI', ready: true, reason: null },
    { name: 'goose', label: 'Goose', ready: true, reason: 'could not check goose' },
    { name: 'opencode', label: 'OpenCode', ready: true, reason: 'no provider credentials' },
    { name: 'qwen', label: 'Qwen Code', ready: false, reason: 'qwen is not signed in' },
  ]);
  await engineReadiness({ preflights, now: 2000, mock: false, backends: () => [] });
  assert.equal(calls, 7, 'cached');
  assert.deepEqual(readyEnginesCached(2000), ['claude', 'codex', 'gemini', 'goose', 'opencode']);
  await engineReadiness({ preflights, now: 2000, force: true, mock: false, backends: () => [] });
  assert.equal(calls, 14);
});

test('mock: every engine ready, nothing spawned', async () => {
  resetEngineReadiness();
  const list = await engineReadiness({ preflights: { cursor: async () => { throw new Error('spawned'); } }, mock: true, force: true, backends: () => [] });
  assert.ok(list.every((e) => e.ready));
});

test('a preflight that throws is a warning, still ready', async () => {
  resetEngineReadiness();
  const list = await engineReadiness({ preflights: { codex: async () => ({}), copilot: async () => ({}), cursor: async () => { throw new Error('boom'); }, gemini: async () => ({}), goose: async () => ({}), opencode: async () => ({}), qwen: async () => ({}) }, mock: false, force: true, backends: () => [] });
  assert.deepEqual(list.find((e) => e.name === 'cursor'), { name: 'cursor', label: 'Cursor', ready: true, reason: 'boom' });
});

test('sandbox sign-in: each engine says whether it can sign in inside a remote sandbox, only when a backend is configured', async () => {
  const preflights = { codex: async () => ({}), copilot: async () => ({}), cursor: async () => ({}), claude: async () => ({}) };
  const backends = () => [{ title: 'E2B', configured: () => true }];
  const env = { CURSOR_API_KEY: 'k', COPILOT_GITHUB_TOKEN: `ghp_${'x'.repeat(36)}` };
  const list = await engineReadiness({ force: true, mock: false, preflights, backends, env });
  const by = Object.fromEntries(list.map((e) => [e.name, e.sandbox]));
  assert.deepEqual(by.cursor, { titles: ['E2B'], ready: true, reason: null });
  assert.equal(by.copilot.ready, false); assert.match(by.copilot.reason, /classic token.*fine-grained/);
  assert.equal(by.codex.ready, false); assert.match(by.codex.reason, /CODEX_API_KEY or OPENAI_API_KEY/);
  assert.equal(by.claude.ready, false);
  const none = await engineReadiness({ force: true, mock: false, preflights, backends: () => [{ title: 'E2B', configured: () => false }], env });
  assert.equal(none.some((e) => 'sandbox' in e), false, 'no configured backend: the entries are today`s');
});
