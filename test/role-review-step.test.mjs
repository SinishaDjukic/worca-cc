// test/role-review-step.test.mjs — the engine role-review step (src/shared/graph/role-review-step.mjs): the spec and
// its one predicate, every refusal message, which roles run, and the moved round helpers on roles that are not
// Shaper perspectives. Plus the needle: the orchestrator holds one expand and one finish, neither Shaper-specific.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEGACY_ROLE_REVIEW, ROLE_CHECKLISTS, roleReviewOf, roleReviewIssues, runningRoles, rolesForRound, roleRecord,
  findingsMarkdown, genericRoleBrief, refinerVerdict, ROLE_REVIEW_SINKS, ROLE_REVIEW_TARGETS, roleTargetOf, roleBlockingIssues, roleRoutingVerdict,
} from '../src/shared/graph/role-review-step.mjs';
import { dispositionsBlock } from '../src/shared/review/findings.mjs';
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
  for (const junk of [undefined, null, {}, { roleReview: false }, { roleReview: 'yes' }, { roleReview: { ...SPEC, target: 'code' } }]) {
    assert.equal(roleReviewOf(junk), null, JSON.stringify(junk));
  }
});

test('roleReviewIssues: one named message per problem; none for absent, true or a valid spec', () => {
  for (const ok of [undefined, {}, { roleReview: true }, { roleReview: SPEC }]) assert.deepEqual(roleReviewIssues(ok), []);
  const issues = (rr) => roleReviewIssues({ roleReview: rr });
  assert.deepEqual(issues({ ...SPEC, roles: [CS[0], { key: 'Sec-1', label: 'Security' }] }), ['roleReview.roles[1].key "Sec-1" must be 1–24 lowercase letters']);
  assert.deepEqual(issues({ ...SPEC, target: 'diff', sink: 'implementer' }), [], 'a diff target into the implementer is accepted');
  assert.deepEqual(issues({ ...SPEC, target: 'code' }), ['roleReview.target "code" is not supported yet (plan or diff or requirements)']);
  assert.deepEqual(issues({ roles: CS, sink: 'refiner' }), ['roleReview.target is required (plan or diff or requirements)']);
  assert.deepEqual(issues({ ...SPEC, sink: 'implementer' }), [], 'an implementer sink is accepted');
  assert.deepEqual(issues({ ...SPEC, sink: 'planner' }), ['roleReview.sink "planner" is not supported yet (refiner or implementer)']);
  assert.deepEqual(issues({ roles: CS, target: 'plan' }), ['roleReview.sink is required (refiner or implementer)']);
  assert.deepEqual(ROLE_REVIEW_SINKS, ['refiner', 'implementer']);
  assert.equal(roleReviewOf({ roleReview: { ...SPEC, sink: 'implementer' } }).sink, 'implementer');
  assert.deepEqual(issues({ ...SPEC, checklist: 'x' }), ['roleReview.checklist "x" is unknown (known: perspectives, requirements, coverage)']);
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
  assert.doesNotMatch(md, /## Dispositions/, 'no path: no block');
  const withPath = findingsMarkdown(1, '/p/plan.md', r1.roles, { dispositionsPath: '/p/x-role-findings-r1-dispositions.json' });
  assert.ok(withPath.startsWith(md), 'each finding line is unchanged');
  assert.ok(withPath.endsWith(dispositionsBlock('/p/x-role-findings-r1-dispositions.json')), 'it ends in the ## Dispositions block');
});

test('genericRoleBrief: this role only, no perspective text', () => {
  const b = genericRoleBrief(CS[1], 'plan');
  assert.match(b, /^## Your role: Security\n/);
  assert.match(b, /do not see the other roles' reviews/);
  assert.doesNotMatch(b, /R-|checklist|perspective/i);
});

test('the target table: plan, diff and requirements, frozen; an unknown or missing target reads as plan', () => {
  assert.deepEqual(Object.keys(ROLE_REVIEW_TARGETS), ['plan', 'diff', 'requirements']);
  assert.ok(Object.isFrozen(ROLE_REVIEW_TARGETS) && Object.isFrozen(ROLE_REVIEW_TARGETS.diff));
  assert.deepEqual(ROLE_REVIEW_TARGETS.diff, {
    findingsPort: 'review', continuePort: 'done', mockRole: 'code-review', noun: 'diff', sectionHint: 'the file and line',
    reviewedPort: 'plan', reviewedHead: 'Diff reviewed against the plan',
  });
  assert.deepEqual(ROLE_REVIEW_TARGETS.requirements, {
    findingsPort: 'findings', continuePort: 'revise', mockRole: 'requirements-review', noun: 'requirements', sectionHint: 'the criterion id',
    reviewedPort: 'requirements', reviewedHead: 'Requirements reviewed',
  });
  assert.equal(ROLE_REVIEW_TARGETS.plan.reviewedPort, 'plan');
  assert.equal(ROLE_REVIEW_TARGETS.plan.reviewedHead, 'Plan reviewed');
  assert.equal(roleTargetOf({ target: 'requirements' }), ROLE_REVIEW_TARGETS.requirements);
  assert.equal(roleTargetOf({ target: 'diff' }), ROLE_REVIEW_TARGETS.diff);
  for (const spec of [null, {}, { target: 'plan' }, { target: 'code' }]) assert.equal(roleTargetOf(spec), ROLE_REVIEW_TARGETS.plan);
});

test('roleRoutingVerdict: only the non-skipped roles\' critical/major findings, the refiner\'s reviewer list unchanged', () => {
  const roles = [
    roleRecord(CS[0], 2, { issues: [{ severity: 'major', title: 'race', section: 'src/a.mjs:4', fix: 'lock it' }, { severity: 'minor', title: 'n', fix: 'f' }] }, []),
    { ...roleRecord(CS[1], 1, { issues: [{ severity: 'critical', title: 'old', fix: 'f' }] }, []), skipped: true },
  ];
  assert.deepEqual(roleBlockingIssues(roles), [{ severity: 'major', title: 'correctness-2-1: race', detail: 'lock it', location: 'src/a.mjs:4' }]);
  assert.deepEqual(roleRoutingVerdict(roles), { summary: 'Role reviews: 1 blocking finding(s) from Correctness.', issues: roleBlockingIssues(roles) });
  const two = [roleRecord(CS[0], 1, { issues: [{ severity: 'major', title: 'a', fix: 'f' }] }, []), roleRecord(CS[1], 1, { issues: [{ severity: 'critical', title: 'b', fix: 'f' }] }, [])];
  assert.equal(roleRoutingVerdict(two).summary, 'Role reviews: 2 blocking finding(s) from Correctness, Security.');
  assert.deepEqual(roleRoutingVerdict([roleRecord(CS[0], 1, { issues: [] }, [])]), { summary: 'Role reviews: no blocking findings.', issues: [] });
  assert.deepEqual(refinerVerdict({ roles: two }, { issues: [] }).verdict.issues, roleBlockingIssues(two));
});

test('findingsMarkdown and genericRoleBrief for a diff: the diff header and the file and line; the plan bytes unchanged', () => {
  const roles = [roleRecord(CS[0], 1, { issues: [{ severity: 'major', title: 't', fix: 'f' }] }, [])];
  const plan = findingsMarkdown(1, '/p/plan.md', roles);
  assert.match(plan, /^Plan reviewed: \/p\/plan\.md$/m);
  assert.equal(findingsMarkdown(1, '/p/plan.md', roles, { target: 'plan' }), plan);
  const diff = findingsMarkdown(1, '/p/plan.md', roles, { target: 'diff' });
  assert.match(diff, /^Diff reviewed against the plan: \/p\/plan\.md$/m);
  assert.doesNotMatch(diff, /Plan reviewed:/);
  assert.equal(diff.replace('Diff reviewed against the plan: ', 'Plan reviewed: '), plan, 'only the header differs');
  const b = genericRoleBrief(CS[0], 'diff');
  assert.match(b, /^## Your role: Correctness\n/);
  assert.match(b, /You review this diff as \*\*Correctness\*\* only\./);
  assert.match(b, /do NOT fix it/);
  assert.match(b, /`section` \(the file and line\)/);
  assert.doesNotMatch(b, /plan section/);
  assert.equal(genericRoleBrief(CS[0]), genericRoleBrief(CS[0], 'plan'));
  assert.match(genericRoleBrief(CS[0]), /You review this plan as \*\*Correctness\*\* only\. Find what is wrong; do NOT rewrite it\./);
  assert.match(genericRoleBrief(CS[0]), /`section` \(the plan section\)/);
});

test('findingsMarkdown names what each target reviewed with its reviewedHead', () => {
  const roles = [roleRecord(CS[0], 1, { issues: [] }, [])];
  for (const [target, t] of Object.entries(ROLE_REVIEW_TARGETS)) {
    assert.ok(typeof t.reviewedPort === 'string' && t.reviewedPort, `${target} has a reviewedPort`);
    const md = findingsMarkdown(1, '/p/x.md', roles, { target });
    assert.equal(md.split('\n')[2], `${t.reviewedHead}: /p/x.md`, target);
  }
});

test('the role-review bind, finish and revise-target bodies read the target table, never a literal plan or a target compare', () => {
  const orch = readFileSync(new URL('../src/core/orchestrator.mjs', import.meta.url), 'utf8');
  const sched = readFileSync(new URL('../src/core/graph/scheduler.mjs', import.meta.url), 'utf8');
  const method = (src, re) => {
    const m = re.exec(src);
    assert.ok(m, `found ${re}`);
    const rest = src.slice(m.index + m[0].length);
    const next = /\n {2}(?:async )?_?[A-Za-z]\w*\(|\n {2}function \w+\(|\n {2}\/\*\*/.exec(rest);
    return m[0] + rest.slice(0, next ? next.index : undefined);
  };
  const bodies = {
    _rolePlanBinding: method(orch, /\n {2}_rolePlanBinding\(/),
    _finishRoleReview: method(orch, /\n {2}async _finishRoleReview\(/),
    reviseTargetOf: method(sched, /\n {2}function reviseTargetOf\(/),
  };
  for (const [name, b] of Object.entries(bodies)) {
    assert.doesNotMatch(b, /target ===/, `${name}: no target compare`);
    assert.doesNotMatch(b, /'plan'/, `${name}: no 'plan' literal`);
    assert.match(b, /reviewedPort/, `${name} reads reviewedPort`);
  }
});

test('no code-role twin in src/, and the orchestrator never compares a role review target', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name))
    : /\.m?js$/.test(e.name) ? [join(dir, e.name)] : []));
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const twins = walk(src).filter((f) => /_expandCodeRoleReview|_codeRolesOn/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(twins, []);
  const orch = readFileSync(new URL('../src/core/orchestrator.mjs', import.meta.url), 'utf8');
  assert.deepEqual(orch.split('\n').filter((l) => /target ===/.test(l)), []);
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

test('coverage spec without a requirements role is rejected', () => {
  const spec = { roles: CS, source: 'declared', target: 'diff', checklist: 'coverage', sink: 'implementer' };
  assert.deepEqual(roleReviewIssues({ roleReview: spec }), ['roleReview.roles needs a role with key "requirements" for the coverage checklist']);
  assert.deepEqual(roleReviewIssues({ roleReview: { ...spec, roles: [...CS, { key: 'requirements', label: 'Requirements' }] } }), []);
});

test('coverage spec with no roles materialises the 4 provider roles', () => {
  const rr = roleReviewOf({ roleReview: { source: 'declared', target: 'diff', checklist: 'coverage', sink: 'implementer' } });
  assert.deepEqual(rr.roles.map((r) => r.key), ['correctness', 'security', 'fit', 'requirements']);
  assert.equal(rr.checklist, 'coverage');
});
