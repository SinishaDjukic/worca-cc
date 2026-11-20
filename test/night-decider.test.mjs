// test/night-decider.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAsk } from '../src/core/night/decider.mjs';
import { NIGHT_DEFAULTS } from '../src/core/night/config.mjs';
import { RECOVERY_MAX_AUTO_ATTEMPTS } from '../src/core/failure-policy.mjs';

const cfg = { ...NIGHT_DEFAULTS, strategy: 'weights' };

test('clarify/questions: per-question answers + aggregate', async () => {
  const r = await decideAsk({ kind: 'questions', id: 'k', questions: [
    { id: 'a', question: '?', options: ['x', 'y'], confidence: [90, 10], recommended: 'x' },
    { id: 'b', question: '?', options: ['p', 'q'] }] }, { config: cfg });
  assert.deepEqual(r.payload, { answers: [{ id: 'a', choice: 'x' }, { id: 'b', choice: 'p' }] });
  assert.equal(r.record.flagged, true, 'any flagged question flags the decision');
  assert.equal(r.record.strategy, 'weights');
});

test('clarify with analysis: ONE analysis call for all questions', async () => {
  let calls = 0;
  const analyze = async (qs) => { calls += 1; return Object.fromEntries(qs.map((q) => [q.id, { choice: q.options[1], confidence: 90, rationale: 'r', reversible: true, scores: {} }])); };
  const r = await decideAsk({ kind: 'clarify', id: 'c', questions: [
    { id: 'a', question: '?', options: ['x', 'y'] }, { id: 'b', question: '?', options: ['p', 'q'] }] },
  { config: { ...NIGHT_DEFAULTS, strategy: 'analysis' }, analyze });
  assert.deepEqual(r.payload.answers.map((a) => a.choice), ['y', 'q']);
  assert.equal(calls, 1);
  assert.equal(r.record.flagged, false);
});

test('form: defaults, then the strategy for enum fields without a default, else autoValues', async () => {
  const answerSchema = { type: 'object', properties: {
    size: { type: 'string', enum: ['s', 'm'], default: 'm' },
    color: { type: 'string', enum: ['red', 'blue'] },
    note: { type: 'string' } } };
  const r = await decideAsk({ kind: 'form', id: 'f', form: 'pick', version: 1, answerSchema, autoValues: { size: 'm', color: 'red', note: '' } },
    { config: { ...NIGHT_DEFAULTS, strategy: 'weights' } });
  assert.deepEqual(r.payload, { form: 'pick', version: 1, values: { size: 'm', color: 'red', note: '' } });
  assert.equal(r.record.flagged, true, 'color decided without a recommendation');
});

test('gate uses extra cycles from the counter', async () => {
  const cfg = { ...NIGHT_DEFAULTS, strategy: 'weights', maxExtraCycles: 1 };
  const r = await decideAsk({ kind: 'gate', id: 'g', wireId: 'w', issues: [{ severity: 'critical' }] }, { config: cfg, gateCyclesUsed: () => 0 });
  assert.deepEqual(r.payload, { decision: 'another' });
  assert.equal(r.record.meta.wireId, 'w');
  const spent = await decideAsk({ kind: 'gate', id: 'g', wireId: 'w', issues: [{ severity: 'critical' }] }, { config: cfg, gateCyclesUsed: () => 1 });
  assert.deepEqual([spent.payload.decision, spent.record.flagged], ['continue', true]);
  const major = await decideAsk({ kind: 'gate', id: 'g', wireId: 'w', issues: [{ severity: 'major' }] }, { config: cfg, gateCyclesUsed: () => 0 });
  assert.deepEqual([major.payload.decision, major.record.reversible], ['another', true], 'a major-only hold gets the extra round');
});

test('workflow accepts the proposal by name', async () => {
  const r = await decideAsk({ kind: 'workflow', id: 'auto-1', workflow: { name: 'wf' } }, { config: cfg });
  assert.deepEqual(r.payload, { decision: 'accept', name: 'wf', nodes: {} });
});

test('recovery waits the backoff then retries', async () => {
  let waited = 0;
  const r = await decideAsk({ kind: 'recovery', id: 'r', recovery: { cls: 'network', attempt: 2 } }, { config: cfg, sleep: async (ms) => { waited = ms; } });
  assert.deepEqual(r.payload, { decision: 'retry' });
  assert.ok(waited > 0);
});

test('the recovery retry budget is per node execution (the failed attempt), not per run', async () => {
  const decide = (attempt) => decideAsk({ kind: 'recovery', id: 'r', recovery: { cls: 'rate_limit', attempt } }, { config: cfg, sleep: async () => {} });
  assert.equal((await decide(1)).payload.decision, 'retry', 'a fresh execution always gets its retries, however many other steps failed tonight');
  assert.equal((await decide(RECOVERY_MAX_AUTO_ATTEMPTS)).payload.decision, 'retry');
  const spent = await decide(RECOVERY_MAX_AUTO_ATTEMPTS + 1);
  assert.equal(spent.payload.decision, 'pause');
  assert.equal(spent.record.flagged, true);
});

test('neverDecide kinds return null (wait for the user)', async () => {
  assert.equal(await decideAsk({ kind: 'gate', id: 'g', issues: [] }, { config: { ...cfg, neverDecide: ['gate'] } }), null);
});

test('neverDecide clarify/questions also covers a form the clarifier or an agent asked with', async () => {
  const f = (origin) => ({ kind: 'form', origin, id: 'f', form: 'pick', version: 1, answerSchema: { type: 'object', properties: {} }, autoValues: {} });
  assert.equal(await decideAsk(f('clarify'), { config: { ...cfg, neverDecide: ['clarify'] } }), null);
  assert.equal(await decideAsk(f('questions'), { config: { ...cfg, neverDecide: ['questions'] } }), null);
  assert.notEqual(await decideAsk(f('questions'), { config: { ...cfg, neverDecide: ['clarify'] } }), null, 'only the matching origin');
});
