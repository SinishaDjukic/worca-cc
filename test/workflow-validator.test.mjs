// test/workflow-validator.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateWorkflow } from '../src/core/workflow-validator.mjs';
import { LEGACY_DEFAULT_WORKFLOW } from '../src/core/workflows.mjs';
import { PRESEEDED_CHANNELS } from '../src/core/channels.mjs';

// Inline fake registry (matches Phase 1's AgentMeta shape) so this phase tests
// independently of agent-registry.mjs. Only `key` is consulted by the validator.
const REGISTRY = {
  clarify: { key: 'clarify', runnerType: 'clarifier', agentFile: 'worca-cc-clarifier.md', loopSource: false },
  planner: { key: 'planner', runnerType: 'producer', agentFile: 'worca-cc-planner.md', loopSource: false },
  refiner: { key: 'refiner', runnerType: 'producer', agentFile: 'worca-cc-plan-refiner.md', loopSource: false },
  implementer: { key: 'implementer', runnerType: 'producer', agentFile: 'worca-cc-implementer.md', loopSource: false },
  reviewer: { key: 'reviewer', runnerType: 'verifier', agentFile: 'worca-cc-code-reviewer.md', loopSource: true },
};

// A minimal valid template builder so each test perturbs exactly one rule.
function valid() {
  return {
    id: 'wf_t',
    name: 'T',
    steps: [
      [{ id: 's0_0', key: 'planner' }],
      [{ id: 's1_0', key: 'implementer' }],
      [{ id: 's2_0', key: 'reviewer' }],
    ],
    feedbacks: [{ id: 'fb_0', from: 's2_0', to: 's1_0' }],
  };
}

test('a well-formed workflow passes', () => {
  const { ok, errors } = validateWorkflow(valid(), REGISTRY);
  assert.equal(ok, true, errors.join('; '));
  assert.deepEqual(errors, []);
});

test('LEGACY_DEFAULT_WORKFLOW passes against a registry of its 5 keys', () => {
  const { ok, errors } = validateWorkflow(LEGACY_DEFAULT_WORKFLOW, REGISTRY);
  assert.equal(ok, true, errors.join('; '));
});

test('rejects a workflow with no steps', () => {
  const t = valid();
  t.steps = [];
  const { ok, errors } = validateWorkflow(t, REGISTRY);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /at least one step|no steps|empty/i.test(e)), errors.join('; '));
});

test('rejects an empty step (a step with zero nodes)', () => {
  const t = valid();
  t.steps = [[{ id: 's0_0', key: 'planner' }], [], [{ id: 's2_0', key: 'reviewer' }]];
  const { ok, errors } = validateWorkflow(t, REGISTRY);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /empty step|step 1|no nodes/i.test(e)), errors.join('; '));
});

test('rejects an unknown node key (not in registry)', () => {
  const t = valid();
  t.steps[0][0].key = 'wizard';
  const { ok, errors } = validateWorkflow(t, REGISTRY);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /wizard/.test(e) && /registry|unknown/i.test(e)), errors.join('; '));
});

test('rejects duplicate node ids', () => {
  const t = valid();
  t.steps[1][0].id = 's0_0'; // collide with the planner node id
  const { ok, errors } = validateWorkflow(t, REGISTRY);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /duplicate/i.test(e) && /s0_0/.test(e)), errors.join('; '));
});

test('rejects a node with a missing/blank id', () => {
  const t = valid();
  delete t.steps[1][0].id;
  const { ok, errors } = validateWorkflow(t, REGISTRY);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /id/i.test(e)), errors.join('; '));
});

test('rejects a dangling feedback (from references a non-existent node)', () => {
  const t = valid();
  t.feedbacks = [{ id: 'fb_0', from: 'sX_0', to: 's1_0' }];
  const { ok, errors } = validateWorkflow(t, REGISTRY);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /sX_0/.test(e) && /from|exist|unknown/i.test(e)), errors.join('; '));
});

test('rejects a dangling feedback (to references a non-existent node)', () => {
  const t = valid();
  t.feedbacks = [{ id: 'fb_0', from: 's2_0', to: 'sY_0' }];
  const { ok, errors } = validateWorkflow(t, REGISTRY);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /sY_0/.test(e) && /to|exist|unknown/i.test(e)), errors.join('; '));
});

test('rejects a forward-pointing feedback (target step index >= source step index)', () => {
  const t = valid();
  // from s1_0 (step 1) to s2_0 (step 2) points forward -> illegal.
  t.feedbacks = [{ id: 'fb_0', from: 's1_0', to: 's2_0' }];
  const { ok, errors } = validateWorkflow(t, REGISTRY);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /precede|forward|before|step/i.test(e)), errors.join('; '));
});

test('accepts a self-loop feedback (to step index == from step index is NOT allowed)', () => {
  // The refine loop in DEFAULT is a self-loop (from===to, same node). The rule is
  // "target step index < source step index"; a same-node self-loop has equal
  // indices and must be allowed as a special case (same node id), but a DIFFERENT
  // node in the SAME step pointing back is still forward-equal and rejected.
  const t = valid();
  t.feedbacks = [{ id: 'fb_0', from: 's1_0', to: 's1_0' }];
  const { ok, errors } = validateWorkflow(t, REGISTRY);
  assert.equal(ok, true, errors.join('; '));
});

test('rejects duplicate feedback ids', () => {
  const t = valid();
  t.feedbacks = [
    { id: 'fb_0', from: 's2_0', to: 's1_0' },
    { id: 'fb_0', from: 's2_0', to: 's0_0' },
  ];
  const { ok, errors } = validateWorkflow(t, REGISTRY);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /duplicate/i.test(e) && /fb_0/.test(e)), errors.join('; '));
});

test('rejects a null/non-object template', () => {
  assert.equal(validateWorkflow(null, REGISTRY).ok, false);
  assert.equal(validateWorkflow({}, REGISTRY).ok, false);
});

test('validator warns: unreachable required channel + illegal connectsTo edge', () => {
  const registry = {
    planner: { key: 'planner', produces: ['plan'], consumes: ['userPrompt'], connectsTo: ['refiner'] },
    // synthetic consumer that REQUIRES `review` (not pre-seeded, not optional):
    auditor: { key: 'auditor', produces: [], consumes: ['review'], connectsTo: '*' },
  };
  const tpl = { steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'auditor' }]], feedbacks: [] };
  const res = validateWorkflow(tpl, registry);
  assert.equal(res.ok, true);                                   // warnings don't fail validity
  assert.ok(Array.isArray(res.warnings));
  assert.ok(res.warnings.some((w) => /review/.test(w)), 'reachability warning for review');
  assert.ok(res.warnings.some((w) => /connect/i.test(w)), 'governance warning planner->auditor');
});

test('validator warns: two producers of code in one parallel step (multi-producer)', () => {
  const registry = {
    implementer: { key: 'implementer', produces: ['code'], consumes: ['plan', 'review'], optionalConsumes: ['review'], connectsTo: '*' },
  };
  const tpl = { steps: [[{ id: 's0_0', key: 'implementer' }, { id: 's0_1', key: 'implementer' }]], feedbacks: [] };
  const res = validateWorkflow(tpl, registry);
  assert.ok(res.warnings.some((w) => /code/.test(w) && /producer/i.test(w)));
});

test('default workflow has no warnings (pre-seeded channels never warn)', () => {
  const registry = {
    planner: { key: 'planner', produces: ['plan'], consumes: ['userPrompt'], connectsTo: ['refiner', 'implementer'] },
    refiner: { key: 'refiner', produces: ['plan', 'review'], consumes: ['plan'], connectsTo: ['implementer', 'refiner'] },
    implementer: { key: 'implementer', produces: ['code'], consumes: ['plan', 'review'], optionalConsumes: ['review'], connectsTo: ['reviewer', 'manualTestsChecklist'] },
    reviewer: { key: 'reviewer', produces: ['review'], consumes: ['plan', 'code'], connectsTo: ['implementer', 'manualTestsChecklist'] },
  };
  const tpl = { steps: [[{id:'s0_0',key:'planner'}],[{id:'s1_0',key:'refiner'}],[{id:'s2_0',key:'implementer'}],[{id:'s3_0',key:'reviewer'}]],
    feedbacks: [{id:'fb_refine',from:'s1_0',to:'s1_0'},{id:'fb_review',from:'s3_0',to:'s2_0'}] };
  const res = validateWorkflow(tpl, registry);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.warnings, []);
});

// ── custom channels + derived PRESEEDED (open vocabulary hardening) ────────────

test('PRESEEDED derives from channels.mjs (single source; no hardcoded copy)', async () => {
  assert.deepEqual(PRESEEDED_CHANNELS, ['userPrompt', 'plan', 'checklist', 'code']);
  const src = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../src/core/workflow-validator.mjs', import.meta.url), 'utf8'));
  assert.doesNotMatch(src, /\[\s*'userPrompt'\s*,\s*'plan'\s*,\s*'checklist'\s*,\s*'code'\s*\]/,
    'the validator must import PRESEEDED_CHANNELS, not restate it');
});

test('custom channel produced upstream then consumed downstream: ok, no warnings', () => {
  const registry = {
    specWriter: { key: 'specWriter', produces: ['spec'], consumes: ['plan'], connectsTo: '*',
      channelDefs: [{ id: 'spec', kind: 'md', filename: 'api-spec.md' }] },
    specAuditor: { key: 'specAuditor', produces: ['review'], consumes: ['spec'], connectsTo: '*' },
  };
  const tpl = { steps: [[{ id: 's0', key: 'specWriter' }], [{ id: 's1', key: 'specAuditor' }]], feedbacks: [] };
  const res = validateWorkflow(tpl, registry);
  assert.equal(res.ok, true, res.errors.join('; '));
  assert.deepEqual(res.warnings, []);
});

test('custom channel consumed with NO upstream producer warns (not pre-seeded)', () => {
  const registry = {
    specAuditor: { key: 'specAuditor', produces: ['review'], consumes: ['spec'], connectsTo: '*' },
  };
  const tpl = { steps: [[{ id: 's0', key: 'specAuditor' }]], feedbacks: [] };
  const res = validateWorkflow(tpl, registry);
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => /"spec"/.test(w) && /no upstream/.test(w)), res.warnings.join('; '));
});

test('a produced custom channel with no channelDef anywhere warns once (defaults to markdown)', () => {
  const registry = {
    a: { key: 'a', produces: ['spec'], consumes: ['userPrompt'], connectsTo: '*' },
    b: { key: 'b', produces: ['spec'], consumes: ['spec'], connectsTo: '*' },
  };
  const tpl = { steps: [[{ id: 's0', key: 'a' }], [{ id: 's1', key: 'b' }]], feedbacks: [] };
  const res = validateWorkflow(tpl, registry);
  assert.equal(res.ok, true);
  const defWarnings = res.warnings.filter((w) => /channelDef/.test(w));
  assert.equal(defWarnings.length, 1, 'one warning per channel, not per producer');
  assert.match(defWarnings[0], /"spec"/);
  assert.match(defWarnings[0], /spec\.md/);
});
