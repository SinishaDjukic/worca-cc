// test/agent-registry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadAgentRegistry, registryToSteps, normalizeMeta, collectDomains } from '../src/core/agent-registry.mjs';
import { AGENT_STEPS } from '../src/core/config.mjs';

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
  const base = { key: 'x', order: 1 };
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
    assert.equal(m.metaVersion, 2, `${key} must be a meta v2 sidecar`);
    assert.ok(Array.isArray(m.inputs) && Array.isArray(m.outputs), `${key} declares typed ports`);
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

test('registryToSteps matches the legacy AGENT_STEPS for the original 4', () => {
  const reg = loadAgentRegistry();
  const steps = registryToSteps(reg);
  // clarify is now steps[0]; the original four keep their labels, but the decomposer
  // (order 2.5) now sits at steps[3] between refiner and implementer. fanOut now
  // defaults ON for every agent role (planner/refiner/implementer/reviewer AND the
  // decomposer splitter).
  assert.deepEqual(steps.slice(1, 6), [
    { key: 'planner', label: 'Plan', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false },
    { key: 'refiner', label: 'Refine', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false },
    { key: 'decomposer', label: 'Decompose', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false },
    { key: 'implementer', label: 'Implement', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false },
    { key: 'reviewer', label: 'Review', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false },
  ]);
  // And config.AGENT_STEPS (derived from the registry in Task 6) stays equal to it.
  assert.deepEqual(steps, AGENT_STEPS);
});

test('registryToSteps appends the new agents with their display names', () => {
  const steps = registryToSteps(loadAgentRegistry());
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

test('exactly the loop sources carry a verdict, and each declares both arms', () => {
  // `loopSource` was the v1 way of saying "this agent can send work back". The v2
  // vocabulary is the VERDICT: whoever declares one also declares a
  // when:'blocking' output (the loop arm) and a when:'clean' output (the exit).
  // The refiner is a PRODUCER that loops on itself, which is exactly the case the
  // v1 `runnerType === 'verifier' => loopSource` rule could not express.
  const reg = loadAgentRegistry();
  const withVerdict = Object.values(reg).filter((m) => m.verdict).map((m) => m.key).sort();
  assert.deepEqual(withVerdict, ['manualWebUiTesting', 'planReviewer', 'refiner', 'reviewer', 'workspaceReviewer']);
  for (const m of Object.values(reg)) {
    if (m.runnerType === 'verifier') assert.ok(m.verdict, `${m.key} verifier declares a verdict`);
    if (!m.verdict) continue;
    assert.ok(m.outputs.some((p) => p.when === 'blocking'), `${m.key} declares its blocking output`);
    assert.ok(m.outputs.some((p) => p.when === 'clean'), `${m.key} declares its clean output`);
  }
});

test('the built-ins declare the typed ports the shipped graphs wire', () => {
  // The v1 channel spec (consumes/optionalConsumes/produces/connectsTo) is gone:
  // the sidecar's PORTS are the wiring vocabulary, and a wire is legal because
  // the two port TYPES match — not because a connectsTo list allows it.
  const reg = loadAgentRegistry(); // real agents/ dir
  const ids = (list) => list.map((p) => p.id);
  assert.deepEqual(ids(reg.planner.inputs), ['task', 'answers', 'revise']);
  assert.deepEqual(ids(reg.planner.outputs), ['plan']);
  assert.deepEqual(ids(reg.refiner.outputs), ['plan', 'revise']);
  assert.deepEqual(ids(reg.implementer.inputs), ['fix', 'task', 'plan']);
  assert.deepEqual(ids(reg.implementer.outputs), ['done']);
  assert.deepEqual(ids(reg.reviewer.inputs), ['plan', 'done']);
  assert.deepEqual(ids(reg.reviewer.outputs), ['review', 'pass']);
  assert.deepEqual(ids(reg.planReviewer.inputs), ['plan']);
  assert.deepEqual(ids(reg.planReviewer.outputs), ['review', 'pass']);
  // A loop wire is a type match: the reviewer's blocking `review` (md) feeds the
  // implementer's `fix` (md) — the v2 replacement for connectsTo.
  assert.equal(reg.reviewer.outputs.find((p) => p.id === 'review').type,
    reg.implementer.inputs.find((p) => p.id === 'fix').type);
});
