// test/shape-feature-record.test.mjs — Shaper small runs A2 (src/shared/shape/feature-record.mjs): the Care positions,
// the 7 confirming roles, the write validators (refusal codes) and the tolerant readers. Pure, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CARE_POSITIONS, CARE_LABELS, CARE_CHOSEN_BY, CARE_DEFAULT, CONFIRM_ROLES, REQUIREMENT_KINDS,
  normalizeCare, normalizeRequirementKinds, careOfRow, requirementKindsOf,
} from '../src/shared/shape/feature-record.mjs';
import { criterionPerspective } from '../src/shared/shape/requirements.mjs';

const IDS = ['R-po-1', 'R-sec-1', 'R-qa-2'];
const ROLE_NAMES = 'Product, Engineering, Design, DevOps, Security, Compliance or QA';

test('the vocabulary: 3 positions, 2 choosers, 2 kinds, 7 roles, all frozen', () => {
  assert.deepEqual(CARE_POSITIONS, ['lean', 'balanced', 'thorough']);
  assert.deepEqual(CARE_LABELS, { lean: 'Lean', balanced: 'Balanced', thorough: 'Thorough' });
  assert.deepEqual(CARE_CHOSEN_BY, ['default', 'person']);
  assert.deepEqual(CARE_DEFAULT, { position: 'balanced', chosenBy: 'default', worcaPick: null });
  assert.deepEqual(REQUIREMENT_KINDS, ['owned', 'confirmed']);
  assert.deepEqual(CONFIRM_ROLES.map((r) => [r.key, r.label]), [['product', 'Product'], ['engineering', 'Engineering'],
    ['design', 'Design'], ['devops', 'DevOps'], ['security', 'Security'], ['compliance', 'Compliance'], ['qa', 'QA']]);
  for (const v of [CARE_POSITIONS, CARE_LABELS, CARE_CHOSEN_BY, CARE_DEFAULT, CONFIRM_ROLES, REQUIREMENT_KINDS, ...CONFIRM_ROLES]) {
    assert.ok(Object.isFrozen(v));
  }
});

test('a role never changes an id: every sample id still resolves to its perspective', () => {
  const sample = { 'R-po-1': 'product', 'R-arch-2': 'architect', 'R-qa-3': 'qa', 'R-ux-1': 'ux', 'R-sec-1': 'security',
    'R-ops-4': 'devops', 'R-rel-1': 'release' };
  const { ok, kinds } = normalizeRequirementKinds(
    Object.fromEntries(Object.keys(sample).map((id) => [id, { kind: 'confirmed', role: 'compliance' }])), Object.keys(sample));
  assert.equal(ok, true);
  assert.deepEqual(Object.keys(kinds), Object.keys(sample));
  for (const [id, key] of Object.entries(sample)) assert.equal(criterionPerspective(id), key);
});

test('normalizeCare: nothing passed is Balanced, by default, no pick', () => {
  for (const raw of [null, undefined]) {
    assert.deepEqual(normalizeCare(raw), { ok: true, care: { position: 'balanced', chosenBy: 'default', worcaPick: null } });
  }
  assert.deepEqual(normalizeCare({ position: 'lean' }), { ok: true, care: { position: 'lean', chosenBy: 'default', worcaPick: null } });
});

test('normalizeCare: every position, chosen by a person, with every pick', () => {
  for (const position of CARE_POSITIONS) {
    for (const worcaPick of CARE_POSITIONS) {
      assert.deepEqual(normalizeCare({ position, chosenBy: 'person', worcaPick }), { ok: true, care: { position, chosenBy: 'person', worcaPick } });
    }
  }
});

test('normalizeCare: refusals carry a code and the message', () => {
  assert.deepEqual(normalizeCare({ position: 'careful' }),
    { ok: false, code: 'CARE_POSITION_UNKNOWN', error: 'Care must be Lean, Balanced or Thorough.' });
  assert.deepEqual(normalizeCare({ position: 'lean', chosenBy: 'team' }),
    { ok: false, code: 'CARE_CHOSEN_BY_UNKNOWN', error: 'Care is chosen by default or by a person.' });
  assert.deepEqual(normalizeCare({ position: 'lean', worcaPick: 'max' }),
    { ok: false, code: 'CARE_PICK_UNKNOWN', error: "Worca's pick must be Lean, Balanced, Thorough or none." });
  for (const raw of ['lean', 3, ['lean'], {}]) assert.equal(normalizeCare(raw).code, 'CARE_POSITION_UNKNOWN');
});

test('normalizeRequirementKinds: nothing passed is one owned entry per id, in order', () => {
  for (const raw of [null, undefined, {}]) {
    const r = normalizeRequirementKinds(raw, IDS);
    assert.equal(r.ok, true);
    assert.deepEqual(Object.entries(r.kinds), IDS.map((id) => [id, { kind: 'owned' }]));
  }
  assert.deepEqual(normalizeRequirementKinds(null, []), { ok: true, kinds: {} });
});

test('normalizeRequirementKinds: each of the 7 roles is accepted; a label stores its key; an owned role is dropped', () => {
  for (const { key, label } of CONFIRM_ROLES) {
    for (const role of [key, label, `  ${label.toUpperCase()} `]) {
      const r = normalizeRequirementKinds({ 'R-sec-1': { kind: 'confirmed', role } }, IDS);
      assert.deepEqual(r, { ok: true, kinds: { 'R-po-1': { kind: 'owned' }, 'R-sec-1': { kind: 'confirmed', role: key }, 'R-qa-2': { kind: 'owned' } } });
    }
  }
  assert.deepEqual(normalizeRequirementKinds({ 'R-sec-1': { kind: 'confirmed', role: 'Compliance' } }, ['R-sec-1']).kinds,
    { 'R-sec-1': { kind: 'confirmed', role: 'compliance' } });
  assert.deepEqual(normalizeRequirementKinds({ 'R-po-1': { kind: 'owned', role: 'qa' } }, ['R-po-1']).kinds, { 'R-po-1': { kind: 'owned' } });
});

test('normalizeRequirementKinds: a role outside the 7 is refused, and the message lists the 7', () => {
  for (const role of ['Legal', 'architect', 'DevOps and infrastructure', '', '   ', undefined, 7]) {
    const r = normalizeRequirementKinds({ 'R-sec-1': { kind: 'confirmed', role } }, IDS);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'REQUIREMENT_ROLE_NOT_ALLOWED');
    assert.ok(r.error.endsWith(`cannot confirm a requirement. Pick ${ROLE_NAMES}.`), r.error);
    assert.equal('kinds' in r, false);
  }
  assert.equal(normalizeRequirementKinds({ 'R-sec-1': { kind: 'confirmed', role: 'Legal' } }, IDS).error,
    `R-sec-1: "Legal" cannot confirm a requirement. Pick ${ROLE_NAMES}.`);
});

test('normalizeRequirementKinds: an unknown id, a malformed id and an unknown kind are refused; the first refusal wins', () => {
  assert.deepEqual(normalizeRequirementKinds({ 'R-xx-9': { kind: 'owned' } }, IDS),
    { ok: false, code: 'REQUIREMENT_UNKNOWN', error: 'R-xx-9 is not an agreed requirement of this feature.' });
  assert.equal(normalizeRequirementKinds({ 'r-po-1': { kind: 'owned' } }, [...IDS, 'r-po-1']).code, 'REQUIREMENT_UNKNOWN');
  assert.deepEqual(normalizeRequirementKinds({ 'R-qa-2': { kind: 'shared' } }, IDS),
    { ok: false, code: 'REQUIREMENT_KIND_UNKNOWN', error: 'R-qa-2: a requirement is owned by a run or confirmed by a person.' });
  assert.equal(normalizeRequirementKinds({ 'R-qa-2': 'owned' }, IDS).code, 'REQUIREMENT_KIND_UNKNOWN');
  for (const raw of ['owned', 4, ['R-po-1']]) assert.equal(normalizeRequirementKinds(raw, IDS).code, 'REQUIREMENT_KIND_UNKNOWN');
  const first = normalizeRequirementKinds({ 'R-po-1': { kind: 'confirmed', role: 'Legal' }, 'R-xx-9': { kind: 'owned' } }, IDS);
  assert.equal(first.code, 'REQUIREMENT_ROLE_NOT_ALLOWED');
});

const outline = { why: 'w', agreed: [{ id: 'R-po-1', text: 'a' }, { id: 'R-sec-1', text: 'b' }, { id: 'R-qa-2', text: 'c' }, { id: 'R-ops-1', text: 'd' }],
  slices: [{ id: 's1', requirements: ['R-po-1'] }, { id: 's2', requirements: ['R-qa-2', 'R-sec-1'] }, { id: 's3', requirements: ['R-qa-2'] }] };

test('requirementKindsOf: the run of an owned id, null for an id in no run, the role of a confirmed id', () => {
  assert.deepEqual(requirementKindsOf({ 'R-sec-1': { kind: 'confirmed', role: 'compliance' } }, outline), [
    { id: 'R-po-1', kind: 'owned', run: 1 }, { id: 'R-sec-1', kind: 'confirmed', role: 'compliance' },
    { id: 'R-qa-2', kind: 'owned', run: 2 }, { id: 'R-ops-1', kind: 'owned', run: null },
  ]);
  // An id agreed after the kinds were stored reads as owned.
  assert.deepEqual(requirementKindsOf({ 'R-po-1': { kind: 'owned' } }, outline).map((k) => k.kind), ['owned', 'owned', 'owned', 'owned']);
  assert.deepEqual(requirementKindsOf(null, { why: 'w', slices: [{ id: 's1' }] }), []);
});

test('tolerant read: stored data it does not understand reads as the default and never throws', () => {
  for (const stored of [{ 'R-sec-1': { kind: 'shared' } }, { 'R-sec-1': { kind: 'confirmed', role: 'Legal' } }, { 'R-sec-1': { kind: 'confirmed' } },
    { 'R-sec-1': 'confirmed' }, { 'R-sec-1': null }, 'x', 5, [], null, undefined]) {
    assert.deepEqual(requirementKindsOf(stored, outline)[1], { id: 'R-sec-1', kind: 'owned', run: 2 });
  }
  for (const o of [null, undefined, 'x', {}, { agreed: 'x' }, { agreed: [null, 3, { id: 'R-po-1' }], slices: 'x' }, { agreed: [{ id: 'R-po-1' }], slices: [null, 4] }]) {
    assert.doesNotThrow(() => requirementKindsOf({ 'R-po-1': { kind: 'confirmed', role: 'qa' } }, o));
  }
  assert.deepEqual(requirementKindsOf(null, { agreed: [null, { id: 'R-po-1' }], slices: 'x' }), [{ id: 'R-po-1', kind: 'owned', run: null }]);
  assert.deepEqual(careOfRow({ care: 'x', care_chosen_by: 'team', care_worca_pick: 'max' }), { position: 'balanced', chosenBy: 'default', worcaPick: null });
  assert.deepEqual(careOfRow({ care: 'lean', care_chosen_by: 'person', care_worca_pick: 'thorough' }), { position: 'lean', chosenBy: 'person', worcaPick: 'thorough' });
  for (const row of [null, undefined, {}, 'x']) assert.deepEqual(careOfRow(row), { position: 'balanced', chosenBy: 'default', worcaPick: null });
});

test('the shared module never reads the flag and imports nothing from core', () => {
  const src = readFileSync(new URL('../src/shared/shape/feature-record.mjs', import.meta.url), 'utf8');
  assert.ok(!src.includes('flagEnabled'));
  assert.ok(!/core\//.test(src));
  assert.deepEqual([...src.matchAll(/^import .* from '(.*)';$/gm)].map((m) => m[1]), ['../review/coverage.mjs']);
});
