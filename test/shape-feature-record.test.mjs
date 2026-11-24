// test/shape-feature-record.test.mjs — Shaper small runs A2 (src/shared/shape/feature-record.mjs): the Care positions,
// the 7 confirming roles, the write validators (refusal codes) and the tolerant readers. Pure, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CARE_POSITIONS, CARE_LABELS, CARE_CHOSEN_BY, CARE_DEFAULT, CONFIRM_ROLES, REQUIREMENT_KINDS,
  normalizeCare, normalizeRequirementKinds, careOfRow, requirementKindsOf, roleKey, roleNames,
  CARE_TRIGGERS, CARE_SUBSYSTEMS, CARE_TABLE, careFactsOf, worcaCarePick, careDescription, careGivesUp, careGivesUpSentence, careModelRoles,
  careRecordLine, normalizeStartCare, confirmedKindsOf,
} from '../src/shared/shape/feature-record.mjs';
import { RUN_REQUIREMENTS_MAX } from '../src/shared/shape/slices.mjs';
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

test('confirmedKindsOf: the outline\'s confirmed list as kinds, {} for any other shape; normalizeRequirementKinds takes them', () => {
  const kinds = confirmedKindsOf({ confirmed: [{ id: 'R-sec-1', role: 'Security' }, null, { role: 'QA' }] });
  assert.deepEqual(kinds, { 'R-sec-1': { kind: 'confirmed', role: 'Security' } });
  assert.deepEqual(normalizeRequirementKinds(kinds, IDS).kinds['R-sec-1'], { kind: 'confirmed', role: 'security' });
  for (const o of [null, undefined, {}, { confirmed: 'x' }, { confirmed: [] }]) assert.deepEqual(confirmedKindsOf(o), {});
});

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
  assert.deepEqual([...src.matchAll(/^import .* from '(.*)';$/gm)].map((m) => m[1]), ['../review/coverage.mjs', './perspectives.mjs']);
});

test('A3: roleKey and roleNames are exported for the split check', () => {
  assert.equal(roleKey(' compliance '), 'compliance');
  assert.equal(roleKey('Compliance'), 'compliance');
  assert.equal(roleKey('Legal'), null);
  assert.equal(roleNames(), ROLE_NAMES);
});

// ---- B2: the Start step's pick, facts and Care table ----

const pickOf = (prompt, size = 'small') => worcaCarePick(careFactsOf({ prompt, size }));

test('B2 worcaCarePick: each of the 5 triggers picks Thorough, and the reason names it', () => {
  const cases = [
    ['add sign-in with accounts', 'sign-in or accounts'],
    ["store users' personal data", 'personal data'],
    ['take payments', 'payments'],
    ['meet SOC 2 compliance requirements', 'security or compliance requirements'],
    ['a data migration of the runs table', 'a data migration'],
  ];
  for (const [prompt, label] of cases) {
    const p = pickOf(prompt);
    assert.equal(p.position, 'thorough', prompt);
    assert.ok(p.reason.includes(label), `${prompt}: ${p.reason}`);
    assert.ok(p.reason.startsWith('Worca picks Thorough: it touches '), p.reason);
  }
  assert.deepEqual(CARE_TRIGGERS.map((t) => t.key), ['accounts', 'personalData', 'payments', 'security', 'migration']);
  assert.equal(pickOf('add sign-in with accounts and store personal data').reason, 'Worca picks Thorough: it touches sign-in or accounts and personal data');
});

test('B2 worcaCarePick: small with one part and no screen is Lean; 0 parts says nothing sensitive', () => {
  const one = pickOf('add a health endpoint to the server');
  assert.deepEqual(one, { position: 'lean', reason: 'Worca picks Lean: about 3 requirements in one part (the server), no screen' });
  const none = pickOf('rename a label');
  assert.equal(none.position, 'lean');
  assert.equal(none.reason, 'Worca picks Lean: about 3 requirements, nothing sensitive, no screen');
});

test('B2 worcaCarePick: medium, a screen, two parts and an unknown size are Balanced', () => {
  assert.equal(pickOf('rename a label', 'medium').position, 'balanced');
  assert.equal(pickOf('add a button to the settings page').position, 'balanced');
  assert.deepEqual(pickOf('show the server status on the page'), { position: 'balanced', reason: 'Worca picks Balanced: it touches the screens and the server' });
  assert.equal(pickOf('cache the server responses in the database').position, 'balanced');
  const unknown = pickOf('rename a label', null);
  assert.deepEqual(unknown, { position: 'balanced', reason: 'Worca picks Balanced: it touches nothing sensitive, and its size is not known' });
  const unknownTrigger = pickOf('take payments', null);
  assert.equal(unknownTrigger.position, 'thorough');
  assert.ok(unknownTrigger.reason.includes('its size is not known'));
});

test('B2 careFactsOf: the facts in table order, whole words, never throws', () => {
  assert.deepEqual(careFactsOf({ prompt: 'Show the API status on the Page', size: 'large' }),
    { touches: [], requirements: 16, subsystems: ['screens', 'server'], screens: true, size: 'large' });
  assert.deepEqual(careFactsOf({ prompt: 42, size: 'huge' }), { touches: [], requirements: null, subsystems: [], screens: false, size: null });
  assert.deepEqual(careFactsOf({ prompt: 'paged apis' }).subsystems, [], 'whole words only');
  assert.deepEqual(careFactsOf(undefined).touches, []);
  assert.deepEqual(CARE_SUBSYSTEMS.map((s) => s.key), ['screens', 'server', 'store', 'engine', 'cli']);
});

test('B2 CARE_TABLE: 8 rows; Run size matches RUN_REQUIREMENTS_MAX; no model id literal in the module', () => {
  assert.equal(CARE_TABLE.length, 8);
  const run = CARE_TABLE.find((r) => r.key === 'runSize');
  for (const p of CARE_POSITIONS) assert.equal(run.text[p], `up to ${RUN_REQUIREMENTS_MAX[p]} requirements`);
  const src = readFileSync(new URL('../src/shared/shape/feature-record.mjs', import.meta.url), 'utf8');
  assert.ok(!/claude-|gpt-|opus|sonnet|haiku|gemini/i.test(src));
});

const NAMES = { everyday: 'Sonnet', strong: 'Opus', second: 'GPT' };
test('B2 careGivesUp: the literal row lists below the pick, none at or above', () => {
  assert.deepEqual(careGivesUp('lean', 'balanced', NAMES), [
    'Requirements: the asker role plus one challenge round instead of all picked roles add and challenge once',
    'Prototype: only when asked for instead of when there are screen requirements',
    'Build approach: tests first, by the Implementer instead of tests first, by a separate Test writer',
    'Reviewers: Product and one more role instead of the run\'s roles',
    'Challenger: off instead of at the split',
    'Models: Sonnet for every agent instead of Opus plans and reviews, Sonnet builds',
    'Fix cycles: 1 instead of 2',
  ]);
  const bt = careGivesUp('balanced', 'thorough', NAMES);
  assert.equal(bt.length, 7);
  assert.ok(!bt.some((l) => l.startsWith('Build approach')));
  assert.ok(bt.includes('Run size: up to 3 requirements instead of up to 2 requirements'));
  assert.ok(bt.includes('Models: Opus plans and reviews, Sonnet builds instead of Opus plans and reviews; Product reviews on GPT'));
  assert.equal(careGivesUp('lean', 'thorough', NAMES).length, 8);
  for (const [a, b] of [['balanced', 'balanced'], ['thorough', 'balanced'], ['balanced', 'lean'], ['lean', 'lean']]) assert.deepEqual(careGivesUp(a, b, NAMES), []);
  assert.ok(careGivesUp('lean', 'balanced', {}).includes('Models: the everyday model for every agent instead of the strong model plans and reviews, the everyday model builds'));
});

test('B2 careGivesUpSentence: one sentence from the differing Reviewers, Challenger and Fix cycles rows; empty at or above', () => {
  assert.equal(careGivesUpSentence('lean', 'thorough'), 'Product and one more role review each run instead of every role; no Challenger; 1 fix cycle instead of 3.');
  assert.equal(careGivesUpSentence('lean', 'balanced'), 'Product and one more role review each run instead of every role; no Challenger; 1 fix cycle instead of 2.');
  assert.equal(careGivesUpSentence('balanced', 'thorough'), 'Every role reviews together instead of each on its own; Challenger at the split only, not on each plan; 2 fix cycles instead of 3.');
  for (const [a, b] of [['balanced', 'balanced'], ['thorough', 'balanced'], ['balanced', 'lean'], ['nope', 'lean']]) assert.equal(careGivesUpSentence(a, b), '');
});

test('B2 careDescription, careModelRoles and careRecordLine', () => {
  assert.equal(careDescription('lean', NAMES), 'The asker role plus one challenge round; Challenger off; 1 fix cycle');
  assert.equal(careDescription('thorough', NAMES), 'Roles challenge until no objection, at most 3 rounds; Challenger at the split and on each plan; 3 fix cycles');
  assert.deepEqual(careModelRoles('lean'), { deep: 'everyday', everyday: 'everyday', quick: 'quick' });
  assert.deepEqual(careModelRoles('balanced'), { deep: 'deep', everyday: 'everyday', quick: 'quick' });
  assert.deepEqual(careModelRoles('thorough'), { deep: 'deep', everyday: 'everyday', quick: 'quick' });
  assert.equal(careRecordLine({ position: 'lean', chosenBy: 'person', worcaPick: 'thorough' }), 'Care: Lean · your choice · Worca recommended Thorough');
  assert.equal(careRecordLine({ position: 'thorough', chosenBy: 'default', worcaPick: 'thorough' }), "Care: Thorough · Worca's pick");
});

test('B2 normalizeStartCare: the stored Start Care; bad position and bad facts are refused', () => {
  const facts = careFactsOf({ prompt: 'take payments', size: 'small' });
  const raw = { position: 'lean', chosenBy: 'person', worcaPick: 'thorough', reason: 'r', facts, at: '2026-11-21T10:00:00.000Z' };
  assert.deepEqual(normalizeStartCare(raw), { ok: true, care: raw });
  assert.equal(normalizeStartCare({ ...raw, position: 'max' }).code, 'CARE_POSITION_UNKNOWN');
  assert.equal(normalizeStartCare(null).code, 'CARE_POSITION_UNKNOWN');
  assert.equal(normalizeStartCare({ ...raw, facts: { touches: ['x'] } }).code, 'CARE_FACTS_INVALID');
  assert.equal(normalizeStartCare({ ...raw, at: 'soon' }).code, 'CARE_FACTS_INVALID');
  assert.equal(normalizeStartCare({ ...raw, reason: 'x'.repeat(201) }).code, 'CARE_FACTS_INVALID');
});

// Small runs B3: the ONE mapping between the perspective keys and the confirming roles.
test('ROLE_OF_PERSPECTIVE: every value is a CONFIRM_ROLES key, it round-trips for all 7, and release or fit has no role', async () => {
  const { ROLE_OF_PERSPECTIVE, roleOfPerspective, perspectiveOfRole } = await import('../src/shared/shape/feature-record.mjs');
  const keys = Object.keys(ROLE_OF_PERSPECTIVE);
  assert.equal(keys.length, 7);
  for (const k of keys) {
    assert.ok(CONFIRM_ROLES.some((r) => r.key === ROLE_OF_PERSPECTIVE[k]), k);
    assert.equal(perspectiveOfRole(roleOfPerspective(k)), k);
  }
  assert.equal(roleOfPerspective('architect'), 'engineering');
  assert.equal(roleOfPerspective('ux'), 'design');
  assert.equal(roleOfPerspective('fit'), null);
  assert.equal(roleOfPerspective('release'), null);
  assert.equal(perspectiveOfRole('release'), null);
  assert.equal(perspectiveOfRole('fit'), null);
});

test('exactly one perspective-to-role table exists: the UI and the shared modules hold no second one', () => {
  for (const f of ['ui/public/answerer.mjs', 'ui/public/shape/requirements-body.mjs', 'ui/public/shape/role-rows.mjs']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /architect:\s*'engineering'|architect:\s*'Engineering'/, f);
  }
});

test('C1 (D3): prototypeCare reads the Prototype row: Lean skips, Thorough reviews, an unknown position is the default', async () => {
  const { prototypeCare } = await import('../src/shared/shape/feature-record.mjs');
  assert.deepEqual(CARE_POSITIONS.map((p) => prototypeCare(p)), [
    { primary: 'skip', review: false }, { primary: 'build', review: false }, { primary: 'build', review: true }]);
  assert.deepEqual(prototypeCare('nope'), prototypeCare('balanced'));
});
