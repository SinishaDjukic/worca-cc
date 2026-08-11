// test/agent-registry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadAgentRegistry, normalizeMeta, collectDomains } from '../src/core/agent-registry.mjs';
import { agentSteps } from '../src/core/config.mjs';

test('loadAgentRegistry returns all shipped agents (9 project + 2 workspace)', () => {
  const reg = loadAgentRegistry();
  assert.deepEqual(
    Object.keys(reg).sort(),
    ['clarify', 'decomposer', 'implementer', 'manualTestsChecklist', 'manualWebUiTesting', 'planReviewer', 'planner', 'refiner', 'reviewer', 'workspaceReviewer', 'workspaceScanner'],
  );
  assert.equal(Object.keys(reg).length, 11);
  // The two workspace agents are scope:'workspace-only'; the original 9 are 'project'.
  const projectScoped = Object.values(reg).filter((m) => m.scope !== 'workspace-only').map((m) => m.key).sort();
  assert.deepEqual(projectScoped,
    ['clarify', 'decomposer', 'implementer', 'manualTestsChecklist', 'manualWebUiTesting', 'planReviewer', 'planner', 'refiner', 'reviewer']);
});

test('normalizeMeta.domain: default general, sentinel shared, malformed→general, valid kebab passes', () => {
  const base = {
    metaVersion: 2, key: 'x', order: 1, runnerType: 'producer',
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
  };
  assert.equal(normalizeMeta({ ...base }).domain, 'general');                       // absent
  assert.equal(normalizeMeta({ ...base, domain: 'shared' }).domain, 'shared');      // sentinel
  assert.equal(normalizeMeta({ ...base, domain: 'Marketing!' }).domain, 'general'); // malformed
  assert.equal(normalizeMeta({ ...base, domain: 'financing' }).domain, 'financing'); // valid
  assert.equal(normalizeMeta({ ...base, domain: 'a'.repeat(40) }).domain, 'general'); // too long (>32)
});

test('collectDomains: ordered unique, general pinned last, shared excluded from headers', () => {
  const reg = {
    a: { key: 'a', order: 0, domain: 'coding' },
    b: { key: 'b', order: 1, domain: 'shared' },
    c: { key: 'c', order: 2, domain: 'marketing' },
    d: { key: 'd', order: 3, domain: 'general' },
    e: { key: 'e', order: 4, domain: 'coding' },   // dup
  };
  assert.deepEqual(collectDomains(reg), ['coding', 'marketing', 'general']);
});

test('built-in registry tags: 9 coding + 2 shared (workspace agents)', () => {
  const reg = loadAgentRegistry();
  assert.equal(reg.workspaceScanner.domain, 'shared');
  assert.equal(reg.workspaceReviewer.domain, 'shared');
  assert.equal(reg.planner.domain, 'coding');
});

test('each entry is a well-formed AgentMeta', () => {
  const reg = loadAgentRegistry();
  const COLORS = new Set(['green', 'peach', 'red', 'blue', 'violet', 'amber']);
  for (const [key, m] of Object.entries(reg)) {
    assert.equal(m.key, key);
    assert.equal(typeof m.displayName, 'string');
    assert.ok(COLORS.has(m.color), `bad color for ${key}: ${m.color}`);
    assert.equal(typeof m.icon, 'string');
    assert.ok(m.icon.length > 0);
    assert.ok(['producer', 'verifier', 'clarifier'].includes(m.runnerType));
    assert.equal(m.metaVersion, 2);
    assert.ok(Array.isArray(m.inputs) && Array.isArray(m.outputs), `ports for ${key}`);
    assert.equal(typeof m.order, 'number');
  }
});

test('shipped colors match the mockup palette EXACTLY (pins C5 — coercion would hide a typo)', () => {
  // normalizeMeta coerces an out-of-set color to 'amber', so the generic COLORS.has
  // check above would NOT catch a `blue` -> `bleu` typo. Pin the intended colors.
  const reg = loadAgentRegistry();
  assert.equal(reg.planner.color, 'violet');
  assert.equal(reg.refiner.color, 'green');
  assert.equal(reg.implementer.color, 'peach');
  assert.equal(reg.reviewer.color, 'blue');
  assert.equal(reg.manualTestsChecklist.color, 'blue');   // C5: blue everywhere
  assert.equal(reg.manualWebUiTesting.color, 'violet');
  assert.equal(reg.planReviewer.color, 'amber');
});

test('registry insertion order follows .order ascending', () => {
  const reg = loadAgentRegistry();
  const orders = Object.values(reg).map((m) => m.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  // clarify (order 0) sorts first; workspaceScanner (order 0.5) sorts next;
  // workspaceReviewer (order 4.5) sorts between reviewer (4) and manualTestsChecklist (5).
  assert.deepEqual(Object.keys(reg), [
    'clarify', 'workspaceScanner', 'planner', 'refiner', 'decomposer', 'implementer', 'reviewer', 'workspaceReviewer',
    'manualTestsChecklist', 'manualWebUiTesting', 'planReviewer',
  ]);
});

test('agentSteps() labels every step with the agent\'s own displayName — no key table', () => {
  const steps = agentSteps();
  // clarify is steps[0]; the decomposer (order 2.5) sits at steps[3] between refiner
  // and implementer. fanOut defaults ON for every agent role. The label is whatever the
  // sidecar calls itself: the v1 short-label table for the original four is gone.
  assert.deepEqual(steps.slice(1, 6), [
    { key: 'planner', label: 'Plan', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false },
    { key: 'refiner', label: 'Refine Plan', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false },
    { key: 'decomposer', label: 'Decompose', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false },
    { key: 'implementer', label: 'Implementation', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false },
    { key: 'reviewer', label: 'Review Implementation', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false },
  ]);
  for (const s of steps) assert.equal(s.label, loadAgentRegistry()[s.key].displayName);
});

test('agentSteps() appends the new agents with their display names', () => {
  const steps = agentSteps();
  assert.equal(steps.length, 9);
  assert.deepEqual(steps[0], { key: 'clarify', label: 'Clarify', fanOut: true, asksQuestions: true, questionsLocked: true, questionsDefault: true });
  assert.deepEqual(steps[3], { key: 'decomposer', label: 'Decompose', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false });
  assert.deepEqual(steps[6], { key: 'manualTestsChecklist', label: 'Manual Tests Checklist', fanOut: false, asksQuestions: true, questionsLocked: false, questionsDefault: false });
  assert.deepEqual(steps[7], { key: 'manualWebUiTesting', label: 'Manual web UI testing', fanOut: false, asksQuestions: true, questionsLocked: false, questionsDefault: false });
  assert.deepEqual(steps[8], { key: 'planReviewer', label: 'Plan Review', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false });
});

test('every agentFile points at an existing prompt under agents/', () => {
  const reg = loadAgentRegistry();
  const agentsDir = new URL('../agents/', import.meta.url).pathname;
  for (const m of Object.values(reg)) {
    assert.ok(m.agentFile, `${m.key} has no agentFile`);
    assert.ok(
      existsSync(join(agentsDir, m.agentFile)),
      `missing prompt file for ${m.key}: ${m.agentFile}`,
    );
  }
});

test('original four agentFiles match the orchestrator AGENT_FILES map', () => {
  const reg = loadAgentRegistry();
  // Mirror of orchestrator.mjs:48-53 (the hardcoded map a later phase replaces).
  const LEGACY_AGENT_FILES = {
    planner: 'worca-cc-planner.md',
    refiner: 'worca-cc-plan-refiner.md',
    implementer: 'worca-cc-implementer.md',
    reviewer: 'worca-cc-code-reviewer.md',
  };
  for (const [key, file] of Object.entries(LEGACY_AGENT_FILES)) {
    assert.equal(reg[key].agentFile, file, `agentFile mismatch for ${key}`);
  }
});

test('conditional routing replaces loopSource: a verdict + when-gated outputs', () => {
  const reg = loadAgentRegistry();
  const branching = Object.values(reg).filter((m) => m.verdict).map((m) => m.key).sort();
  // The four v1 loopSources, PLUS the refiner: a producer whose clean/blocking
  // arms are what drive the refine self-loop (v1 modelled that as loopSource:false
  // and dispatched it out of band).
  assert.deepEqual(branching, ['manualWebUiTesting', 'planReviewer', 'refiner', 'reviewer', 'workspaceReviewer']);
  for (const m of Object.values(reg)) {
    assert.ok(!Object.hasOwn(m, 'loopSource'), `${m.key}: loopSource is a dead v1 field`);
    if (m.runnerType === 'verifier') assert.ok(m.verdict, `${m.key} verifier must declare a verdict`);
    if (m.verdict) assert.ok(m.outputs.some((p) => p.when !== 'always'), `${m.key} must route conditionally`);
  }
});

test('registry entries carry v2 PORTS only — no derived channel view', () => {
  // v2 legality is a matter of port TYPES, not an authored adjacency allowlist, so
  // the derived channel view (and the key-mapped tables behind it) is gone entirely.
  const reg = loadAgentRegistry(); // real agents/ dir
  assert.deepEqual(reg.planner.inputs.map((p) => p.id), ['task', 'answers', 'revise']);
  assert.deepEqual(reg.planner.outputs.map((p) => p.id), ['plan']);
  assert.deepEqual(reg.refiner.inputs.map((p) => p.id), ['plan', 'revise']);
  assert.deepEqual(reg.refiner.outputs.map((p) => p.id), ['plan', 'revise']);
  assert.deepEqual(reg.implementer.inputs.map((p) => p.id), ['plan', 'fix', 'task']);
  assert.deepEqual(reg.implementer.outputs.map((p) => p.id), ['done']);
  assert.equal(reg.implementer.sideEffect, 'code');
  assert.deepEqual(reg.reviewer.inputs.map((p) => p.id), ['plan', 'done']);
  assert.deepEqual(reg.planReviewer.inputs.map((p) => p.id), ['plan']);
  for (const key of ['planner', 'refiner', 'implementer', 'reviewer', 'planReviewer']) {
    for (const dead of ['consumes', 'optionalConsumes', 'produces', 'connectsTo']) {
      assert.equal(Object.hasOwn(reg[key], dead), false, `${key}.${dead} must not exist`);
    }
  }
});
