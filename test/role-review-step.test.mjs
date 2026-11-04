// test/role-review-step.test.mjs — the engine role-review step (src/shared/graph/role-review-step.mjs): the spec and
// its one predicate, every refusal message, which roles run, and the moved round helpers on roles that are not
// Shaper perspectives. Plus the needle: the orchestrator holds one expand and one finish, neither Shaper-specific.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEGACY_ROLE_REVIEW, ROLE_CHECKLISTS, roleReviewOf, roleReviewIssues, runningRoles, rolesForRound, roleRecord,
  findingsMarkdown, genericRoleBrief,
} from '../src/shared/graph/role-review-step.mjs';
import { PERSPECTIVE_ROLE_CHECKLIST } from '../src/shared/shape/role-review.mjs';
import { PERSPECTIVES } from '../src/shared/shape/perspectives.mjs';

const CS = [{ key: 'correctness', label: 'Correctness' }, { key: 'security', label: 'Security', model: 'claude-haiku-4-5' }];
const SPEC = { roles: CS, source: 'declared', target: 'plan', sink: 'refiner' };
const PERSPECTIVE_ROLES = PERSPECTIVES.map(({ key, label }) => ({ key, label }));

test('roleReviewOf: true reads as the legacy spec with the provider\'s roles; a valid object is filled; junk is null', () => {
  assert.deepEqual(roleReviewOf({ roleReview: true }), { ...LEGACY_ROLE_REVIEW, roles: PERSPECTIVE_ROLES });
  assert.deepEqual(roleReviewOf(true), roleReviewOf({ roleReview: true }));
  assert.equal(ROLE_CHECKLISTS.perspectives, PERSPECTIVE_ROLE_CHECKLIST);
  assert.deepEqual(roleReviewOf({ roleReview: { roles: CS, target: 'plan', sink: 'refiner' } }), {
    roles: CS, source: 'declared', target: 'plan', sink: 'refiner',
  });
  assert.deepEqual(roleReviewOf({ roleReview: { source: 'picked', target: 'plan', checklist: 'perspectives', sink: 'refiner' } }).roles,
    PERSPECTIVE_ROLES, 'roles omitted: the provider declares them');
  for (const junk of [undefined, null, {}, { roleReview: false }, { roleReview: 'yes' }, { roleReview: { ...SPEC, target: 'diff' } }]) {
    assert.equal(roleReviewOf(junk), null, JSON.stringify(junk));
  }
});

test('roleReviewIssues: one named message per problem; none for absent, true or a valid spec', () => {
  for (const ok of [undefined, {}, { roleReview: true }, { roleReview: SPEC }]) assert.deepEqual(roleReviewIssues(ok), []);
  const issues = (rr) => roleReviewIssues({ roleReview: rr });
  assert.deepEqual(issues({ ...SPEC, roles: [CS[0], { key: 'Sec-1', label: 'Security' }] }), ['roleReview.roles[1].key "Sec-1" must be 1–24 lowercase letters']);
  assert.deepEqual(issues({ ...SPEC, target: 'diff' }), ['roleReview.target "diff" is not supported yet (plan only)']);
  assert.deepEqual(issues({ ...SPEC, sink: 'implementer' }), ['roleReview.sink "implementer" is not supported yet (refiner only)']);
  assert.deepEqual(issues({ ...SPEC, checklist: 'x' }), ['roleReview.checklist "x" is unknown (known: perspectives)']);
  assert.deepEqual(issues({ source: 'declared', target: 'plan', sink: 'refiner' }), ['roleReview.roles is required without a checklist provider']);
  assert.deepEqual(issues({ ...SPEC, roles: [CS[0], CS[0]] }), ['roleReview.roles[1].key "correctness" is declared twice']);
  assert.deepEqual(issues({ ...SPEC, roles: [{ key: 'qa', label: '' }] }), ['roleReview.roles[0].label must be 1–60 characters']);
  assert.deepEqual(issues({ ...SPEC, roles: [] }), ['roleReview.roles must be a list of 1–12 roles']);
  assert.deepEqual(issues({ ...SPEC, source: 'random' }), ['roleReview.source "random" must be declared or picked']);
  assert.deepEqual(issues('yes'), ['roleReview must be true or an object']);
});

test('runningRoles: declared, picked with a provider, picked without one, and an empty pick — declared order', () => {
  assert.deepEqual(runningRoles(roleReviewOf({ roleReview: SPEC }), ['security']), CS, 'declared: every role, the pick ignored');
  const shaper = roleReviewOf({ roleReview: true });
  assert.deepEqual(runningRoles(shaper, null).map((r) => r.key), ['product', 'architect', 'qa'], 'null: the provider\'s defaults');
  assert.deepEqual(runningRoles(shaper, ['ux', 'qa']).map((r) => r.key), ['product', 'qa', 'ux'], 'declared order, product on');
  assert.deepEqual(runningRoles(shaper, ['nope']).map((r) => r.key), ['product'], 'an invalid list: product');
  const picked = roleReviewOf({ roleReview: { ...SPEC, source: 'picked' } });
  assert.deepEqual(runningRoles(picked, ['security', 'correctness']).map((r) => r.key), ['correctness', 'security']);
  assert.deepEqual(runningRoles(picked, []).map((r) => r.key), ['correctness'], 'an empty pick: the first declared role');
  assert.deepEqual(runningRoles(picked, null).map((r) => r.key), ['correctness']);
});

test('the moved rolesForRound / roleRecord work on roles that are not perspectives', () => {
  const r1 = { roles: [
    roleRecord(CS[0], 1, { issues: [{ severity: 'minor', title: 't', fix: 'f' }] }, []),
    roleRecord(CS[1], 1, { issues: [{ severity: 'critical', title: 'x', fix: 'y' }] }, []),
  ] };
  assert.deepEqual(r1.roles.map((r) => [r.key, r.label, r.findings[0].id]), [['correctness', 'Correctness', 'correctness-1-1'], ['security', 'Security', 'security-1-1']]);
  assert.deepEqual(rolesForRound(CS, 1, null), [{ key: 'correctness', label: 'Correctness', skip: false }, { key: 'security', label: 'Security', skip: false }]);
  assert.deepEqual(rolesForRound(CS, 2, r1).map((r) => [r.key, r.skip]), [['correctness', true], ['security', false]], 'round 2 skips the clean role');
  const md = findingsMarkdown(1, '/p/plan.md', r1.roles);
  assert.match(md, /^## Correctness$/m);
  assert.match(md, /\*\*security-1-1\*\* \[critical\]/);
});

test('genericRoleBrief: this role only, no perspective text', () => {
  const b = genericRoleBrief(CS[1], 'plan');
  assert.match(b, /^## Your role: Security\n/);
  assert.match(b, /do not see the other roles' reviews/);
  assert.doesNotMatch(b, /R-|checklist|perspective/i);
});

test('the orchestrator holds one expand and one finish path, neither reading Shaper\'s perspectives', () => {
  const src = readFileSync(new URL('../src/core/orchestrator.mjs', import.meta.url), 'utf8');
  const body = (name) => {
    const defs = [...src.matchAll(new RegExp(`^  async ${name}\\(`, 'gm'))];
    assert.equal(defs.length, 1, `exactly one ${name}`);
    const from = defs[0].index;
    return src.slice(from, src.indexOf('\n  }\n', from));
  };
  for (const name of ['_expandRoleReview', '_finishRoleReview']) {
    const b = body(name);
    assert.doesNotMatch(b, /_shapePerspectives|perspectiveByKey|FIT_KEY/, `${name} is engine code`);
  }
});
