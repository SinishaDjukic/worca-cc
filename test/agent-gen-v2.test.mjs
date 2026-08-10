// test/agent-gen-v2.test.mjs — the agent-creation wizard on meta v2.
// "Define whatever agents you want" only works if the GENERATOR knows the whole
// surface, so _metaSchemaBlock enumerates every meta v2 field (typed ports,
// capability flags, the reserved `await` gate id) and _neighborBlock shows the
// neighbours' PORTS instead of the dead v1 channel vocabulary. Drafts that break
// a v2 rule are rejected by the very gate agent-gen's run() applies
// (normalizeMeta, i.e. validateMetaV2's rules), so an unusable draft can never
// reach the store.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAgentGen } from '../src/core/agent-gen.mjs';
import { normalizeMeta, validateMetaV2 } from '../src/core/agent-registry.mjs';

useTempHome(after);

const gen = (opts = {}) => createAgentGen({ name: 'Spec Writer', purpose: 'write specs', ...opts });

/** A draft the generator could plausibly write; spread `extra` to break one rule. */
function draft(extra = {}) {
  return {
    metaVersion: 2, key: 'specWriter', displayName: 'Spec Writer', description: 'writes specs',
    color: 'blue', runnerType: 'producer', order: 99,
    inputs: [{ id: 'plan', type: 'md' }],
    outputs: [{ id: 'spec', type: 'md', filename: 'spec.md' }],
    ...extra,
  };
}

/** Both gates agree: agent-gen's run() throws on `!normalizeMeta(raw)`, and the
 *  store 400s with validateMetaV2's rule text. Assert the rule, not just the no. */
function rejected(meta, re) {
  const errs = validateMetaV2(meta).errors;
  assert.ok(errs.some((e) => re.test(e)), `expected an error matching ${re}, got ${JSON.stringify(errs)}`);
  const warn = console.warn;
  console.warn = () => {};
  try { assert.equal(normalizeMeta(meta), null, 'agent-gen rejects the draft too'); } finally { console.warn = warn; }
}

// ── the schema block teaches the WHOLE v2 surface ───────────────────────────

test('_metaSchemaBlock enumerates the meta v2 core: metaVersion, runnerType trio, typed ports', () => {
  const block = gen()._metaSchemaBlock();
  assert.match(block, /"metaVersion": 2/, 'pins the version discriminator');
  assert.match(block, /"runnerType"/);
  for (const runner of ['producer', 'verifier', 'clarifier']) {
    assert.match(block, new RegExp(`"${runner}"`), `names the ${runner} runner`);
  }
  assert.match(block, /"inputs"/);
  assert.match(block, /"outputs"/);
  assert.match(block, /"md"\|"json"\|"void"/, 'the closed port type set');
  assert.match(block, /at least one output/i, 'outputs are mandatory');
});

test('_metaSchemaBlock enumerates every port field, both sides', () => {
  const block = gen()._metaSchemaBlock();
  for (const field of ['"id"', '"type"', '"label"', '"required"', '"loop"', '"expands"', '"as"', '"directive"']) {
    assert.ok(block.includes(field), `input field ${field} is missing from the schema block`);
  }
  for (const field of ['"when"', '"filename"', '"store"', '"artifactKind"']) {
    assert.ok(block.includes(field), `output field ${field} is missing from the schema block`);
  }
  assert.match(block, /"always"\|"blocking"\|"clean"/, 'the closed when set');
  assert.match(block, /"run"\|"project"/, 'the closed store set');
  assert.match(block, /"file"\|"answers"\|"fix-review"\|"worktree"/, 'the closed as set');
});

test('_metaSchemaBlock enumerates the runner obligations: verdict, clarifier json output', () => {
  const block = gen()._metaSchemaBlock();
  assert.match(block, /"verdict": \{ "filename"/, 'the verdict shape');
  assert.match(block, /"verifier"[^\n]*verdict/i, 'a verifier must declare one');
  assert.match(block, /"clarifier"[^\n]*json output/i, 'a clarifier must write answers');
});

test('_metaSchemaBlock enumerates the capability flags', () => {
  const block = gen()._metaSchemaBlock();
  for (const field of [
    '"sideEffect": "code"', '"scope"', '"workspace-only"', '"domain"', '"order"', '"fanOut"',
    '"asksQuestions"', '"questionsLocked"', '"questionsDefault"', '"requiresSkills"', '"promptHints"',
    '"wantsRequest"', '"workspaceFanOut"', '"workspaceStrategy"', '"workspaceVariantOf"',
    '"placeable"', '"mockRole"',
  ]) {
    assert.ok(block.includes(field), `capability field ${field} is missing from the schema block`);
  }
  assert.match(block, /"explore"\|"task"\|"review"/, 'the closed workspaceStrategy set');
  assert.match(block, /mockRole[\s\S]{0,200}?(omit unless|dropped)/i, 'mockRole is opt-in and forgiving');
});

test('_metaSchemaBlock declares the port id "await" reserved for the engine gate', () => {
  const block = gen()._metaSchemaBlock();
  assert.match(block, /"await"[\s\S]{0,120}reserved/i, 'names the reserved id');
  assert.match(block, /never declare it/i, 'and forbids declaring it');
});

test('_metaSchemaBlock no longer teaches the dead v1 channel fields', () => {
  const block = gen()._metaSchemaBlock();
  for (const dead of ['consumes', 'optionalConsumes', 'connectsTo', 'loopSource']) {
    assert.ok(!block.includes(dead), `v1 field "${dead}" still taught by the schema block`);
  }
});

test('_metaSchemaBlock keeps the palette-blurb + questions contract', () => {
  const block = gen()._metaSchemaBlock();
  assert.match(block, /palette blurb/i);
  assert.match(block, /160/);
  assert.match(block, /75/);
  assert.match(block, /asksQuestions=true/);
});

// ── the neighbour block is port-based ───────────────────────────────────────

test('_neighborBlock lists neighbour PORTS (ids + types + when), not channels', () => {
  const before = {
    key: 'planner', displayName: 'Plan',
    inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always', filename: 'plan.md' }],
  };
  const afterA = {
    key: 'reviewer', displayName: 'Review',
    inputs: [{ id: 'done', type: 'void' }],
    outputs: [{ id: 'fix', type: 'md', when: 'blocking', filename: 'review-{cycle}.md' }],
  };
  const block = gen({ expectedBefore: [before], expectedAfter: [afterA], channels: ['plan', 'review'] })._neighborBlock();
  assert.match(block, /"id": "plan"/, 'a neighbour output port id');
  assert.match(block, /"type": "md"/, 'its type');
  assert.match(block, /"when": "blocking"/, 'the conditional route is visible');
  assert.match(block, /"id": "done"/, 'a neighbour input port id');
  assert.match(block, /"type": "void"/);
  assert.ok(!/Channel vocabulary/i.test(block), 'the channel-vocabulary block is gone');
  for (const dead of ['consumes', 'produces', 'connectsTo']) {
    assert.ok(!block.includes(dead), `v1 channel field "${dead}" survives in the neighbour block`);
  }
});

// ── a draft that breaks a v2 rule never becomes an agent ────────────────────

test('a generated draft with ZERO outputs is rejected', () => {
  rejected(draft({ outputs: [] }), /at least one output port is required/);
});

test('a generated CLARIFIER draft with no json output is rejected', () => {
  rejected(
    draft({ runnerType: 'clarifier', outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }] }),
    /clarifier.*requires at least one json output port/,
  );
});

test('a generated draft declaring the reserved `await` port is rejected', () => {
  rejected(draft({ inputs: [{ id: 'await', type: 'void' }] }), /"await" is reserved/);
});
