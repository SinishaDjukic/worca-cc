// test/policy-effective.test.mjs
// What applies where (src/core/policy/effective.mjs, team-policy design §6): the fold of a
// document with the developer's settings, per run kind; the deviation codes a run records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldsForRun, effectiveCap, effectiveDefault, effectiveRows, deviationsFor, capSummary, fieldCount } from '../src/core/policy/effective.mjs';
import { normalizePolicyDoc } from '../src/core/policy/registry.mjs';

const doc = normalizePolicyDoc({
  schema: 1,
  fields: {
    'cost.pipelineLimitUsd': { kind: 'soft', value: 10, onBreach: 'pause' },
    'cost.totalLimitUsd': { kind: 'default', value: 150 },
    'cost.resetPeriod': { kind: 'default', value: 'weekly' },
    'cost.pooledBudgetUsd': { kind: 'soft', value: 1200, window: 'monthly' },
    'guardrails.minimum': { kind: 'soft', value: 'normal' },
    'guardrails.default': { kind: 'default', value: 'gp:gateway-normal' },
    'models.allowed': { kind: 'soft', value: ['claude-opus-5', 'Claude-Sonnet-5'] },
    'plugins.required': { kind: 'soft', value: [{ name: 'github-source' }, { name: 'acme-jira', minVersion: '1.2.0' }] },
    'plugins.blocked': { kind: 'soft', value: ['old-plugin'] },
    'worca.minVersion': { kind: 'hard', value: '1.4.0' },
    'metrics.record': { kind: 'soft', value: true },
    'run.humanInLoop': { kind: 'default', value: false },
  },
  workspaceRuns: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 25, onBreach: 'warn' }, 'guardrails.default': { kind: 'default', value: 'secure' } },
}).doc;

test('fieldsForRun: workspaceRuns replaces fields key by key; hard reads as soft', () => {
  const p = fieldsForRun(doc);
  assert.equal(p['cost.pipelineLimitUsd'].value, 10);
  assert.equal(p['guardrails.default'].value, 'gp:gateway-normal');
  assert.equal(p['worca.minVersion'].kind, 'soft'); assert.equal(p['worca.minVersion'].declaredKind, 'hard');
  const w = fieldsForRun(doc, { workspaceRun: true });
  assert.equal(w['cost.pipelineLimitUsd'].value, 25); assert.equal(w['cost.pipelineLimitUsd'].onBreach, 'warn'); assert.equal(w['cost.pipelineLimitUsd'].fromWorkspaceRuns, true);
  assert.equal(w['guardrails.default'].value, 'secure');
  assert.equal(w['cost.totalLimitUsd'].value, 150, 'falls through to fields');
  assert.deepEqual(fieldsForRun(null), {});
});

test('effectiveCap: default starts the developer off, soft takes the tighter, ties go to local', () => {
  assert.deepEqual(effectiveCap({ local: null, team: null }), { cap: null, binding: null, team: null });
  assert.equal(effectiveCap({ local: 7, team: null }).binding, 'local');
  const dflt = { kind: 'default', value: 20 };
  assert.deepEqual(effectiveCap({ local: null, team: dflt }), { cap: 20, binding: 'team-default', team: dflt });
  assert.deepEqual(effectiveCap({ local: 50, team: dflt }), { cap: 50, binding: 'local', team: dflt });
  const soft = { kind: 'soft', value: 10 };
  assert.equal(effectiveCap({ local: null, team: soft }).binding, 'team');
  assert.deepEqual(effectiveCap({ local: 25, team: soft }), { cap: 10, binding: 'team', team: soft });
  assert.deepEqual(effectiveCap({ local: 5, team: soft }), { cap: 5, binding: 'local', team: soft });
  assert.equal(effectiveCap({ local: 10, team: soft }).binding, 'local', 'equal numbers: no team pause');
  assert.deepEqual(effectiveDefault({ local: { value: 'monthly', set: true }, team: { value: 'weekly' } }), { value: 'monthly', source: 'local' });
  assert.deepEqual(effectiveDefault({ local: { value: 'monthly', set: false }, team: { value: 'weekly' } }), { value: 'weekly', source: 'team-default' });
});

test('effectiveRows: display, source and the notes the table shows', () => {
  const local = {
    'cost.pipelineLimitUsd': { value: 25, set: true },
    'cost.totalLimitUsd': { value: 120, set: true },
    'cost.resetPeriod': { value: 'monthly', set: false },
    'metrics.record': { value: false, set: true },
  };
  const rows = effectiveRows({ doc, local });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by['cost.pipelineLimitUsd'].effective.display, '$10.00');
  assert.equal(by['cost.pipelineLimitUsd'].effective.source, 'team');
  assert.match(by['cost.pipelineLimitUsd'].note, /looser/);
  assert.equal(by['cost.totalLimitUsd'].effective.source, 'local'); // default kind, local set
  assert.equal(by['cost.resetPeriod'].effective.display, 'weekly'); assert.equal(by['cost.resetPeriod'].effective.source, 'team-default');
  assert.equal(by['cost.pooledBudgetUsd'].effective.source, 'advisory'); assert.equal(by['cost.pooledBudgetUsd'].effective.display, '$1200.00 / monthly');
  assert.equal(by['models.allowed'].effective.source, 'team');
  assert.match(by['metrics.record'].note, /Include my runs/);
  assert.equal(by['ask.maxTurns'].shown, false); assert.equal(by['worca.minVersion'].shown, true);
  assert.equal(by['worca.minVersion'].team.declaredKind, 'hard');
  const ws = effectiveRows({ doc, workspaceRun: true, local });
  assert.equal(ws.find((r) => r.key === 'cost.pipelineLimitUsd').effective.display, '$25.00');
});

test('deviationsFor: codes and copy for every rule', () => {
  const f = fieldsForRun(doc);
  const dev = deviationsFor(f, {
    guardrailsId: 'permissive', guardrailSet: { settings: { deny: [], protectedPaths: [], envScrub: false } },
    stepModels: [{ role: 'planner', model: 'claude-opus-4-8' }, { role: 'implementer', model: 'claude-sonnet-5' }, { role: 'reviewer', model: 'claude-opus-4-8' }],
    installed: { 'acme-jira': { version: '1.1.0', enabled: true }, 'old-plugin': { version: '0.1.0', enabled: true } },
    worcaVersion: '1.3.0', metricsRecord: false,
  });
  const codes = dev.map((d) => d.code);
  assert.deepEqual(codes, [
    'guardrails:permissive<normal', 'model:claude-opus-4-8', 'plugin-missing:github-source', 'plugin-outdated:acme-jira',
    'plugin-blocked:old-plugin', 'worca-version:1.3.0<1.4.0', 'metrics-off',
  ]);
  assert.match(dev[1].text, /planner's model claude-opus-4-8 is not in the allowed list/);
  assert.equal(dev[6].level, 'info');
  // A compliant selection has nothing to say.
  const ok = deviationsFor(f, { guardrailsId: 'normal', stepModels: [{ role: 'planner', model: 'claude-sonnet-5' }], installed: { 'github-source': { version: '1.0.0', enabled: true }, 'acme-jira': { version: '1.2.0', enabled: true } }, worcaVersion: '1.4.0', metricsRecord: true });
  assert.deepEqual(ok, []);
  assert.deepEqual(deviationsFor({}, {}), []);
});

test('capSummary and fieldCount', () => {
  const s = capSummary(doc);
  assert.deepEqual(s.pipeline, { kind: 'soft', value: 10, onBreach: 'pause', requireReason: false });
  assert.equal(s.total.kind, 'default'); assert.equal(s.resetPeriod, 'weekly'); assert.deepEqual(s.pooled, { value: 1200, window: 'monthly' });
  assert.equal(capSummary(doc, { workspaceRun: true }).pipeline.value, 25);
  assert.equal(fieldCount(doc), 14); assert.equal(fieldCount(null), 0);
});
