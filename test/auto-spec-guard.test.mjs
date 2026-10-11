import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySpecGuard, guardClassifiedShape } from '../src/core/auto/spec-guard.mjs';
import { normalizeShape } from '../src/shared/graph/assemble.mjs';
import { renderWorcaFrontMatter } from '../src/shared/spec-builder/front-matter.mjs';
import { sectionsFor } from '../src/shared/spec-builder/roles.mjs';

const specText = (fm) => `${renderWorcaFrontMatter(fm)}# Spec\n\n${sectionsFor(fm.roles).map((s) => `## ${s.n}. ${s.title}\n\ntext\n`).join('\n')}`;
const planned = normalizeShape({ name: 'p', taskKind: 'plan-partial', stages: [{ agent: 'planner' }, { agent: 'implementer' }, { agent: 'reviewer' }] });
const KNOWN = new Set(['planner', 'refiner', 'implementer', 'reviewer', 'manualTestsChecklist', 'manualWebUiTesting']);
const clean = () => [];
const text = specText({ kind: 'feature', size: 'large', roles: ['product'] });

test('applySpecGuard: no block or a bad block → the same object back', () => {
  assert.equal(applySpecGuard(planned, '# no block'), planned);
  assert.equal(applySpecGuard(planned, '---\nworca:\n  kind: epic\n---\n# x'), planned);
});

test('guardClassifiedShape: feedback → untouched', () => {
  const r = guardClassifiedShape(planned, { taskText: text, feedback: ['x'], known: KNOWN, checkModels: clean });
  assert.equal(r.shape, planned);
  assert.equal(r.warning, null);
});

test('guardClassifiedShape: an unknown recipe agent → unguarded + SPEC_GUARD_SKIPPED', () => {
  const r = guardClassifiedShape(planned, { taskText: text, feedback: [], known: new Set(['planner', 'implementer', 'reviewer']), checkModels: clean });
  assert.equal(r.shape, planned);
  assert.equal(r.warning.code, 'SPEC_GUARD_SKIPPED');
});

test('guardClassifiedShape: a model issue on the guarded shape → unguarded + SPEC_GUARD_SKIPPED', () => {
  const r = guardClassifiedShape(planned, { taskText: text, feedback: [], known: KNOWN, checkModels: () => [{ code: 'MISSING_MODEL', message: 'stage "s1": needs a model' }] });
  assert.equal(r.shape, planned);
  assert.match(r.warning.message, /MISSING_MODEL|needs a model/);
});

test('guardClassifiedShape: clean → the guarded, normalized shape', () => {
  const r = guardClassifiedShape(planned, { taskText: text, feedback: [], known: KNOWN, checkModels: clean });
  assert.equal(r.warning, null);
  assert.equal(r.shape.taskKind, 'plan-complete-detailed');
  assert.deepEqual(r.shape.stages.map((s) => s.agent), ['refiner', 'implementer', 'reviewer']);
  assert.ok(r.shape.stages[0].selfLoop);
});

test('guardClassifiedShape: untouched stages keep their models through re-normalization', () => {
  const good = normalizeShape({ name: 'g', taskKind: 'plan-complete-detailed', stages: [{ agent: 'implementer', model: 'claude-opus-5-5' }, { agent: 'reviewer' }] });
  const r = guardClassifiedShape(good, { taskText: specText({ kind: 'fix', size: 'small', roles: ['product'] }), feedback: [], known: KNOWN, checkModels: clean });
  assert.equal(r.warning, null);
  assert.equal(r.shape.stages[0].tunables.model, 'claude-opus-5-5');   // normalizeShape reads nested tunables (idempotent)
  assert.equal(r.shape.size, 'small');
});
