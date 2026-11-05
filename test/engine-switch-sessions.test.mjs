// test/engine-switch-sessions.test.mjs — which engines can host a session, kept equal to the adapters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, SESSION_SUBAGENTS_VERIFIED, sessionSupport } from '../src/shared/engine-switch.mjs';
import { listEngines } from '../src/core/engines/index.mjs';

test('ENGINES[e].subagents equals the adapter capability', () => {
  for (const e of listEngines().filter((x) => x.name !== 'mock')) assert.equal(ENGINES[e.name].subagents, e.capabilities.subagents !== false, e.name);
  assert.deepEqual(Object.keys(ENGINES).filter((e) => ENGINES[e].subagents), ['claude', 'codex', 'copilot', 'opencode']);
});

test('the gate ships closed on every engine (BUILD-GUIDE rule 4; Tasks 53 and 69 update this pin when they flip one)', () => {
  assert.deepEqual({ ...SESSION_SUBAGENTS_VERIFIED }, { claude: false, codex: false, copilot: false, opencode: false });
  assert.equal(Object.isFrozen(SESSION_SUBAGENTS_VERIFIED), true);
});

test('sessionSupport combines capability and gate', () => {
  assert.deepEqual(sessionSupport('claude'), { subagents: SESSION_SUBAGENTS_VERIFIED.claude === true, shared: true, label: 'Claude' }, 'the default is the shipped gate');
  assert.deepEqual(sessionSupport('claude', { verified: { claude: true } }), { subagents: true, shared: true, label: 'Claude' });
  assert.deepEqual(sessionSupport('cursor', { verified: { cursor: true } }), { subagents: false, shared: true, label: 'Cursor' });
  assert.deepEqual(sessionSupport(undefined, { verified: { claude: true } }), { subagents: true, shared: true, label: 'Claude' }, 'a missing engine is Claude');
  assert.deepEqual(sessionSupport('mock', { verified: { mock: true } }), { subagents: false, shared: true, label: 'mock' }, 'unknown engines never throw');
  assert.deepEqual(sessionSupport('codex', { verified: null }), { subagents: false, shared: true, label: 'Codex' });
});
