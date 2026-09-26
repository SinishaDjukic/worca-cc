// test/auto-runnable-models.test.mjs
// Auto must only design with models this install can RUN. On a host where Claude Code is
// signed out (a hosted worca that reaches models only through OpenRouter), a first-party id the
// classifier picks — or the "default model" a stage without one falls back to — dies at its
// first spawn with "Not logged in" (worca-01, 2026-09-26: planner/reviewer on claude-opus-5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoModelsFor } from '../src/core/auto/runnable.mjs';
import { buildClassifierSystemPrompt, checkShapeModels } from '../src/core/auto/classify.mjs';
import { normalizeShape } from '../src/shared/graph/assemble.mjs';

const CATALOG = [
  { id: 'claude-opus-5', efforts: ['high'] },
  { id: 'claude-sonnet-5', efforts: ['medium'] },
  { id: 'openrouter-nemotron', efforts: ['medium'], bridged: 'openai' },
  { id: 'gateway-model', efforts: ['medium'] },                       // an env-routed entry (ANTHROPIC_BASE_URL)
  { id: 'copilot-gpt', efforts: ['medium'], bridged: 'copilot', needsSignIn: true },
];
const routed = (id) => id === 'openrouter-nemotron' || id === 'gateway-model' || id === 'copilot-gpt';

test('autoModelsFor: signed in — everything but a bridged model whose provider is not set up; no model required', () => {
  const r = autoModelsFor(CATALOG, { auth: 'signed-in', routed });
  assert.deepEqual(r.models.map((m) => m.id), ['claude-opus-5', 'claude-sonnet-5', 'openrouter-nemotron', 'gateway-model']);
  assert.equal(r.requireModel, false);
  assert.equal(r.note, null);
});

test('autoModelsFor: signed out — only endpoint-routed / bridged models that are ready, and every stage must name one', () => {
  const r = autoModelsFor(CATALOG, { auth: 'signed-out', routed });
  assert.deepEqual(r.models.map((m) => m.id), ['openrouter-nemotron', 'gateway-model']);
  assert.equal(r.requireModel, true);
  assert.match(r.note, /isn't signed in/);
  assert.match(r.note, /2 model/);
});

test('autoModelsFor: an unknown sign-in state changes nothing (never narrows on a guess)', () => {
  const r = autoModelsFor(CATALOG, { auth: 'unknown', routed });
  assert.equal(r.models.length, 4);
  assert.equal(r.requireModel, false);
});

test('autoModelsFor: signed out with nothing routed — keeps the list and says why the run will fail', () => {
  const r = autoModelsFor(CATALOG.slice(0, 2), { auth: 'signed-out', routed });
  assert.deepEqual(r.models.map((m) => m.id), ['claude-opus-5', 'claude-sonnet-5']);
  assert.equal(r.requireModel, false);
  assert.match(r.note, /no endpoint or provider model/i);
});

test('classifier prompt: requireModel replaces "omit to use the default model" with "every stage names a model"', () => {
  const models = [{ id: 'openrouter-nemotron', efforts: ['medium'] }];
  const plain = buildClassifierSystemPrompt({ models });
  assert.match(plain, /omit both "model" and "effort" to run on the default model/);
  const req = buildClassifierSystemPrompt({ models, requireModel: true });
  assert.doesNotMatch(req, /omit both "model" and "effort" to run on the default model/);
  assert.match(req, /every stage MUST name one of these models/);
});

test('checkShapeModels: requireModel flags a stage without a model', () => {
  const models = [{ id: 'openrouter-nemotron', efforts: ['medium'] }];
  const shape = normalizeShape({ name: 'x', reasoning: 'r', size: 's', signals: [], stages: [{ agent: 'planner' }, { agent: 'implementer', model: 'openrouter-nemotron', effort: 'medium' }] });
  assert.deepEqual(checkShapeModels(shape, models), []);
  const issues = checkShapeModels(shape, models, { requireModel: true });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'MISSING_MODEL');
  assert.match(issues[0].message, /needs a model/);
});
