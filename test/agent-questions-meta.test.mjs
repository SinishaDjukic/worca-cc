// test/agent-questions-meta.test.mjs
// Manifest schema for the per-agent user-questions feature (spec 2026-07-11):
// asksQuestions / questionsLocked / questionsDefault normalization + builtin pins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMeta, loadAgentRegistry, registryToSteps } from '../src/core/agent-registry.mjs';

const base = { key: 'demo', order: 99 };

test('normalizeMeta defaults the questions fields to false', () => {
  const m = normalizeMeta({ ...base });
  assert.equal(m.asksQuestions, false);
  assert.equal(m.questionsLocked, false);
  assert.equal(m.questionsDefault, false);
});

test('normalizeMeta coerces truthy/falsy questions fields to booleans', () => {
  const m = normalizeMeta({ ...base, asksQuestions: 1, questionsLocked: 'yes', questionsDefault: {} });
  assert.equal(m.asksQuestions, true);
  assert.equal(m.questionsLocked, true);
  assert.equal(m.questionsDefault, true);
});

test('coherence: locked/default are forced false when asksQuestions is false', () => {
  const m = normalizeMeta({ ...base, asksQuestions: false, questionsLocked: true, questionsDefault: true });
  assert.equal(m.asksQuestions, false);
  assert.equal(m.questionsLocked, false);
  assert.equal(m.questionsDefault, false);
});

test('builtin sidecars: clarify locked-ON; workspaceScanner off; all others capable+off', () => {
  const reg = loadAgentRegistry(undefined, { userAgentsDir: null });
  assert.deepEqual(
    { asks: reg.clarify.asksQuestions, locked: reg.clarify.questionsLocked, def: reg.clarify.questionsDefault },
    { asks: true, locked: true, def: true },
  );
  assert.equal(reg.workspaceScanner.asksQuestions, false);
  const others = ['planner', 'refiner', 'decomposer', 'implementer', 'reviewer',
    'planReviewer', 'manualTestsChecklist', 'manualWebUiTesting', 'workspaceReviewer'];
  for (const k of others) {
    assert.deepEqual(
      { k, asks: reg[k].asksQuestions, locked: reg[k].questionsLocked, def: reg[k].questionsDefault },
      { k, asks: true, locked: false, def: false },
    );
  }
});

test('registryToSteps carries the questions defaults per step', () => {
  const steps = registryToSteps(loadAgentRegistry(undefined, { userAgentsDir: null }));
  const clarify = steps.find((s) => s.key === 'clarify');
  assert.deepEqual(
    { asks: clarify.asksQuestions, locked: clarify.questionsLocked, def: clarify.questionsDefault },
    { asks: true, locked: true, def: true },
  );
  const planner = steps.find((s) => s.key === 'planner');
  assert.deepEqual(
    { asks: planner.asksQuestions, locked: planner.questionsLocked, def: planner.questionsDefault },
    { asks: true, locked: false, def: false },
  );
});
