// test/agent-registry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAgentRegistry, registryToSteps, normalizeMeta, collectDomains } from '../src/core/agent-registry.mjs';
import { AGENT_STEPS } from '../src/core/config.mjs';
import { checkRows } from './helpers/rows.mjs';

test('loadAgentRegistry returns all shipped agents (10 coding + 8 presentation + 4 workspace + 2 architecture + 8 video)', () => {
  const reg = loadAgentRegistry();
  assert.deepEqual(
    Object.keys(reg).sort(),
    ['architect', 'architectSetup', 'clarify', 'deckAudit', 'deckBuilder', 'deckClarify', 'deckExport', 'deckNarrative', 'deckOutputs', 'deckReviewer', 'deckSystem',
      'decomposer', 'implementer', 'manualTestsChecklist', 'manualWebUiTesting', 'memoryDefragmenter',
      'planReviewer', 'planner',
      'promoCapture', 'promoExplorer', 'promoMascot', 'promoReview', 'promoScenes', 'promoSetup', 'promoVoice', 'promoWriter',
      'refiner', 'reviewer', 'workspaceReviewer', 'workspaceScanner',
      'workspaceSynthesizer', 'workspaceUsageMapper'],
  );
  assert.equal(Object.keys(reg).length, 32);
  // The four workspace agents are scope:'workspace-only'; the other 28 are 'project'.
  const projectScoped = Object.values(reg).filter((m) => m.scope !== 'workspace-only').map((m) => m.key).sort();
  assert.deepEqual(projectScoped,
    ['architect', 'architectSetup', 'clarify', 'deckAudit', 'deckBuilder', 'deckClarify', 'deckExport', 'deckNarrative', 'deckOutputs', 'deckReviewer', 'deckSystem',
      'decomposer', 'implementer', 'manualTestsChecklist', 'manualWebUiTesting', 'memoryDefragmenter',
      'planReviewer', 'planner',
      'promoCapture', 'promoExplorer', 'promoMascot', 'promoReview', 'promoScenes', 'promoSetup', 'promoVoice', 'promoWriter',
      'refiner', 'reviewer']);
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

test('registry insertion order follows .order ascending', () => {
  const reg = loadAgentRegistry();
  const orders = Object.values(reg).map((m) => m.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  // clarify (order 0) sorts first; the scan's workspaceScanner (0.5), workspaceUsageMapper (0.6) and
  // workspaceSynthesizer (0.7) sort next; workspaceReviewer (order 4.5) sorts between reviewer (4) and
  // manualTestsChecklist (5). The architecture pair (architectSetup 63, architect 64) follows, and
  // the promo video crew (70–77, in workflow order) sorts last.
  assert.deepEqual(Object.keys(reg), [
    'clarify', 'workspaceScanner', 'workspaceUsageMapper', 'workspaceSynthesizer', 'planner', 'refiner', 'decomposer', 'implementer', 'reviewer', 'workspaceReviewer',
    'manualTestsChecklist', 'manualWebUiTesting', 'planReviewer', 'memoryDefragmenter',
    'deckClarify', 'deckNarrative', 'deckSystem', 'deckBuilder', 'deckAudit', 'deckReviewer', 'deckExport', 'deckOutputs',
    'architectSetup', 'architect',
    'promoSetup', 'promoVoice', 'promoExplorer', 'promoWriter', 'promoCapture', 'promoMascot', 'promoScenes', 'promoReview',
  ]);
});

test('registryToSteps: 28 project steps with labels, fanOut and questions flags, equal to AGENT_STEPS', async () => {
  const steps = registryToSteps(loadAgentRegistry());
  await checkRows([
    { name: 'registryToSteps matches the legacy AGENT_STEPS for the original 4', run: () => {
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
    } },
    { name: 'registryToSteps appends the new agents with their display names', run: () => {
      assert.equal(steps.length, 28);
      assert.deepEqual(steps[0], { key: 'clarify', label: 'Clarify', fanOut: true, asksQuestions: true, questionsLocked: true, questionsDefault: true });
      assert.deepEqual(steps[3], { key: 'decomposer', label: 'Decompose', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false });
      assert.deepEqual(steps[6], { key: 'manualTestsChecklist', label: 'Manual Tests Checklist', fanOut: false, asksQuestions: true, questionsLocked: false, questionsDefault: false });
      assert.deepEqual(steps[7], { key: 'manualWebUiTesting', label: 'Manual web UI testing', fanOut: false, asksQuestions: true, questionsLocked: false, questionsDefault: false });
      assert.deepEqual(steps[8], { key: 'planReviewer', label: 'Plan Review', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false });
      // memoryDefragmenter sits at index 9 (upstream's tenth coding step); the eight
      // presentation steps append after it, then the two architecture steps, then the
      // eight promo video steps.
      assert.equal(steps[9].key, 'memoryDefragmenter');
      assert.deepEqual(steps.slice(10).map((s) => s.key),
        ['deckClarify', 'deckNarrative', 'deckSystem', 'deckBuilder', 'deckAudit', 'deckReviewer', 'deckExport', 'deckOutputs',
          'architectSetup', 'architect',
          'promoSetup', 'promoVoice', 'promoExplorer', 'promoWriter', 'promoCapture', 'promoMascot', 'promoScenes', 'promoReview']);
      assert.deepEqual(steps[18], { key: 'architectSetup', label: 'C4: setup', fanOut: false, asksQuestions: true, questionsLocked: true, questionsDefault: true });
      assert.deepEqual(steps[19], { key: 'architect', label: 'C4: architect', fanOut: true, asksQuestions: false, questionsLocked: false, questionsDefault: false });
      assert.deepEqual(steps[20], { key: 'promoSetup', label: 'Promo: setup', fanOut: false, asksQuestions: true, questionsLocked: true, questionsDefault: true });
      assert.deepEqual(steps[23], { key: 'promoWriter', label: 'Promo: script', fanOut: false, asksQuestions: true, questionsLocked: false, questionsDefault: true });
      assert.deepEqual(steps[26], { key: 'promoScenes', label: 'Promo: scenes', fanOut: true, asksQuestions: false, questionsLocked: false, questionsDefault: false });
    } },
  ]);
});

test('every agentFile points at an existing prompt under agents/', () => {
  const reg = loadAgentRegistry();
  const agentsDir = fileURLToPath(new URL('../agents/', import.meta.url));
  for (const m of Object.values(reg)) {
    assert.ok(m.agentFile, `${m.key} has no agentFile`);
    assert.ok(
      existsSync(join(agentsDir, m.agentFile)),
      `missing prompt file for ${m.key}: ${m.agentFile}`,
    );
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
  assert.deepEqual(withVerdict, ['deckAudit', 'deckExport', 'deckReviewer', 'manualWebUiTesting', 'planReviewer', 'promoReview', 'refiner', 'reviewer', 'workspaceReviewer']);
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
