import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rolesForRound, roleBriefBlock, houseBriefBlock, roleRecord, roleItems, refinerVerdict, applyAddressed, openBlocking, findingsMarkdown }
  from '../src/shared/shape/role-review.mjs';

// A recorded Shaper plan (real data): the 18 Oct "Shaper as chat cards" plan v2, copied verbatim.
const PLAN = readFileSync(new URL('./fixtures/role-review/recorded-plan.md', import.meta.url), 'utf8');

test('roleBriefBlock: the UX brief carries every R-ux item and no other role\'s', () => {
  const ux = roleBriefBlock('ux', PLAN);
  assert.match(ux, /## Your role: UX/);
  for (let n = 1; n <= 8; n += 1) assert.match(ux, new RegExp(`\`R-ux-${n}\``));
  assert.doesNotMatch(ux, /R-qa-|R-arch-|## Your role: QA/);
  assert.match(roleBriefBlock('product', PLAN), /judge "Problem and goal" and "Out of scope"/);
});

test('roleRecord: a checklist id the reviewer left out is unmet', () => {
  const r = roleRecord('qa', 1, { issues: [], checklist: [{ id: 'R-qa-1', status: 'met' }, { id: 'R-ux-1', status: 'met' }] },
    ['R-qa-1', 'R-qa-2']);
  assert.deepEqual(r.checklist.map((c) => [c.id, c.status]), [['R-qa-1', 'met'], ['R-qa-2', 'unmet']]);
});

test('rolesForRound: round 2 skips a clean, fully met role and keeps a blocked one', () => {
  const last = { roles: [
    roleRecord('qa', 1, { issues: [], checklist: [{ id: 'R-qa-1', status: 'met' }] }, ['R-qa-1']),
    roleRecord('ux', 1, { issues: [{ severity: 'major', title: 't', fix: 'f' }] }, []),
  ] };
  assert.deepEqual(rolesForRound(['qa', 'ux'], 2, last),
    [{ key: 'product', skip: false }, { key: 'qa', skip: true }, { key: 'ux', skip: false }]);
});

test('refinerVerdict: a critical reviewer finding blocks; minors and the refiner\'s own majors do not route', () => {
  const r = { roles: [roleRecord('ux', 1, { issues: [{ severity: 'critical', title: 'x', fix: 'y' }] })] };
  assert.equal(refinerVerdict(r, { issues: [] }).verdict.issues[0].severity, 'critical');
  const m = { roles: [roleRecord('ux', 1, { issues: [{ severity: 'minor', title: 'x', fix: 'y' }] })] };
  const out = refinerVerdict(m, { issues: [{ severity: 'major', title: 'own' }, { severity: 'minor', title: 'nit' }] });
  assert.deepEqual(out.verdict.issues.map((i) => i.severity), ['minor']);
  assert.equal(out.refinerIssues.length, 1);
});

test('applyAddressed: fixed findings carry the version, the rest stay open', () => {
  const round = { roles: [roleRecord('ux', 1, { issues: [
    { severity: 'major', title: 'a', fix: 'b' }, { severity: 'major', title: 'c', fix: 'd' }] })] };
  applyAddressed(round, ['ux-1-1'], 2);
  assert.deepEqual(round.roles[0].findings.map((f) => [f.status, f.fixedIn]), [['fixed', 2], ['open', undefined]]);
  assert.equal(openBlocking({ rounds: [round] }), 1);
});

test('findingsMarkdown: one section per role, ids and unmet items listed', () => {
  const md = findingsMarkdown(1, '/p/plan.md', [roleRecord('ux', 1, { issues: [{ severity: 'major', title: 't', fix: 'f' }] },
    roleItems('ux', PLAN).map((i) => i.id))]);
  assert.match(md, /^## UX$/m);
  assert.match(md, /\*\*ux-1-1\*\* \[major\]/);
  assert.match(md, /R-ux-1: unmet/);
});

const FIT_PLAN = readFileSync(new URL('./fixtures/fit-review/check-row-duplicate-plan.md', import.meta.url), 'utf8');

test('roleBriefBlock(fit) names the five rules and lists the plan\'s R-fit items', () => {
  const b = roleBriefBlock('fit', FIT_PLAN);
  assert.match(b, /## Your role: Project fit/);
  for (let i = 1; i <= 5; i++) assert.match(b, new RegExp(`\`R-fit-${i}\``));
  assert.doesNotMatch(b, /`R-qa-|`R-arch-/);
});

test('houseBriefBlock: the brief for fit only, a plain line when there is none', () => {
  const brief = '# House brief\n\n## Components\n- ui/public/shape/check-row.mjs — rows\n';
  assert.match(houseBriefBlock('fit', brief), /## Project fit: the house brief[\s\S]*# House brief[\s\S]*check-row\.mjs/);
  for (const k of ['product', 'ux', 'qa', 'architect', 'security']) assert.equal(houseBriefBlock(k, brief), '', k);
  assert.match(houseBriefBlock('fit', ''), /no house brief yet/);
  assert.doesNotMatch(houseBriefBlock('fit', ''), /# House brief/);
});
