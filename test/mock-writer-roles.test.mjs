import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOCK_WRITER_ROLES, MOCK_ROLE_CLARIFY, MOCK_ROLE_DECOMPOSER } from '../src/core/claude-runner.mjs';

const SRC = readFileSync(fileURLToPath(new URL('../src/core/claude-runner.mjs', import.meta.url)), 'utf8');
const CONSTS = { MOCK_ROLE_CLARIFY, MOCK_ROLE_DECOMPOSER };

test('the 14 mock writer roles are exported as a Set', () => {
  assert.equal(MOCK_WRITER_ROLES instanceof Set, true);
  assert.deepEqual([...MOCK_WRITER_ROLES].sort(), ['agent-gen', 'clarify', 'decomposer', 'generic-producer',
    'generic-verifier', 'implementer', 'manual-tests-checklist', 'manual-web-ui-testing', 'plan-review',
    'planner-plan', 'refiner', 'reviewer', 'workspace-reviewer', 'workspace-scan']);
  assert.equal(MOCK_ROLE_CLARIFY, 'clarify');
  assert.equal(MOCK_ROLE_DECOMPOSER, 'decomposer');
  assert.equal(MOCK_WRITER_ROLES.has('ask'), false, 'the Ask-Worca arm is not a writer role');
});

// Structural audit: the roles the mock runner can actually SERVE are the arms of
// its role switch. Parsing them from the source is what keeps the exported
// vocabulary from drifting when someone adds a mock without updating the Set
// (validateMetaV2 would then reject a legal mockRole, and /api/agents would hide it).
test('MOCK_WRITER_ROLES is in lockstep with the mock role switch', () => {
  const arms = [...SRC.matchAll(/case\s+(?:'([^']+)'|([A-Z][A-Z0-9_]*)):/g)]
    .map((m) => (m[1] !== undefined ? m[1] : CONSTS[m[2]]))
    .filter((v) => typeof v === 'string');
  assert.equal(arms.length, 14, `expected 14 switch arms, found ${arms.length}`);
  assert.deepEqual([...new Set(arms)].sort(), [...MOCK_WRITER_ROLES].sort());
});
