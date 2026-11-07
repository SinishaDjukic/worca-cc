// test/plan-concern.test.mjs — #990 s5: the implementer's plan concern contract (src/shared/review/plan-concern.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlanConcern, planConcernFileName, planConcernBlock, planConcernOverrideBlock, concernFeedbackSection,
  requirementConcernOf, requirementConcernBlock, requirementConcernFeedbackSection, PLAN_CONCERN_TITLE_MAX, PLAN_CONCERN_DETAIL_MAX } from '../src/shared/review/plan-concern.mjs';

test('normalizePlanConcern keeps title, detail and section, trimmed; the title is one line', () => {
  assert.deepEqual(normalizePlanConcern({ title: ' Store jobs\nin the DB ', detail: ' A restart loses them. ', section: 'Decisions' }),
    { ok: true, concern: { title: 'Store jobs in the DB', detail: 'A restart loses them.', section: 'Decisions' } });
});

test('normalizePlanConcern rejects a missing title and a non-object', () => {
  assert.equal(normalizePlanConcern({ detail: 'x' }).ok, false);
  assert.equal(normalizePlanConcern({ title: '   ' }).ok, false);
  assert.equal(normalizePlanConcern(null).ok, false);
  assert.equal(normalizePlanConcern(['x']).ok, false);
  assert.equal(normalizePlanConcern({ detail: 'x' }).error, 'title is missing');
  assert.equal(normalizePlanConcern(['x']).error, 'not a JSON object');
});

test('normalizePlanConcern clips an over-long title, section and detail', () => {
  const r = normalizePlanConcern({ title: 'x'.repeat(500), section: 's'.repeat(500), detail: 'd'.repeat(9000) });
  assert.equal(r.concern.title.length, PLAN_CONCERN_TITLE_MAX);
  assert.equal(r.concern.section.length, PLAN_CONCERN_TITLE_MAX);
  assert.equal(r.concern.detail.length, PLAN_CONCERN_DETAIL_MAX);
});

test('the file name is per execution; the blocks are empty without input', () => {
  assert.equal(planConcernFileName('n_impl', 2), 'n_impl-plan-concern-c2.json');
  assert.equal(planConcernBlock(''), '');
  assert.equal(planConcernOverrideBlock(null), '');
  assert.match(planConcernBlock('/p/n_impl-plan-concern-c1.json'), /^## Plan concern\n[\s\S]*`\/p\/n_impl-plan-concern-c1\.json`/);
  assert.match(planConcernOverrideBlock({ title: 'Use the DB' }), /## Plan concern overridden[\s\S]*"Use the DB"/);
});

test('concernFeedbackSection names the concern for the planner and quotes the detail', () => {
  const s = concernFeedbackSection({ title: 'Use the DB', section: 'Decisions', detail: 'Restarts lose jobs.\n## Not a heading' });
  assert.match(s, /## The implementer's plan concern/);
  assert.match(s, /\*\*Use the DB\*\*/);
  assert.match(s, /Section: Decisions/);
  assert.match(s, /^> Restarts lose jobs\.$/m);
  assert.match(s, /^> ## Not a heading$/m);
  assert.doesNotMatch(s, /^## Not a heading$/m);
});

test('a CR, CR LF or Unicode line separator in the detail cannot open an unquoted heading', () => {
  const r = normalizePlanConcern({ title: 'T', detail: 'a\r## H1\r\n## H2\u2028## H3\u2029## H4' });
  assert.equal(r.concern.detail, 'a\n## H1\n## H2\n## H3\n## H4');
  const s = concernFeedbackSection(r.concern);
  for (const h of ['H1', 'H2', 'H3', 'H4']) {
    assert.match(s, new RegExp(`^> ## ${h}$`, 'm'));
    assert.doesNotMatch(s, new RegExp(`^## ${h}$`, 'm'));
  }
  assert.doesNotMatch(s, /[\r\u2028\u2029]/);
  // concernFeedbackSection is safe on its own too (a caller that skipped normalize):
  assert.match(concernFeedbackSection({ title: 'T', detail: 'a\r## Raw' }), /^> ## Raw$/m);
});

// Shaper requirements s3 (D3): a requirement concern is a plan concern of kind 'requirement'.
test('normalizePlanConcern keeps kind and requirements for a requirement concern; ids are deduped and valid', () => {
  assert.deepEqual(normalizePlanConcern({ title: 'Export needs a server', kind: 'requirement', requirements: ['R-po-1', 'R-po-1', 'bad', 'R-sec-2'] }),
    { ok: true, concern: { title: 'Export needs a server', kind: 'requirement', requirements: ['R-po-1', 'R-sec-2'] } });
  assert.deepEqual(normalizePlanConcern({ title: 'T', kind: 'requirement', requirements: ['nope'] }),
    { ok: false, error: 'a requirement concern names no requirement' });
  assert.equal(normalizePlanConcern({ title: 'T', kind: 'requirement' }).error, 'a requirement concern names no requirement');
});

test('normalizePlanConcern strips kind and requirements on an implementer concern', () => {
  assert.deepEqual(normalizePlanConcern({ title: 'Use the DB', kind: 'implementer', requirements: ['R-po-1'] }),
    { ok: true, concern: { title: 'Use the DB' } });
});

const rnd = (round, roles) => ({ round, roles });
const qa = (findings) => ({ key: 'qa', label: 'QA', findings });
test('requirementConcernOf: null without a flagged finding, the bare title for one, the count for two', () => {
  assert.equal(requirementConcernOf(undefined), null);
  assert.equal(requirementConcernOf([rnd(1, [qa([{ id: 'qa-1-1', severity: 'major', title: 'x', fix: 'y' }])])]), null);
  const one = requirementConcernOf([rnd(1, [qa([{ id: 'qa-1-1', severity: 'major', title: 'R-po-1: Export needs a server we do not have',
    section: 'Decisions', fix: 'Drop the export.', requirement: 'R-po-1' }])])]);
  assert.deepEqual(one, { title: 'Export needs a server we do not have', detail: 'R-po-1 (QA): Drop the export.', section: 'Decisions',
    kind: 'requirement', requirements: ['R-po-1'] });
  const two = requirementConcernOf([
    rnd(1, [qa([{ id: 'qa-1-1', severity: 'major', title: 'a', fix: 'fa', section: 'S1', requirement: 'R-po-1' }])]),
    rnd(2, [qa([{ id: 'qa-2-1', severity: 'major', title: 'again', fix: 'fb', requirement: 'R-po-1' },
      { id: 'qa-2-2', severity: 'critical', title: 'b', fix: 'fc', requirement: 'R-sec-2' }])]),
  ]);
  assert.equal(two.title, '2 requirement concerns');
  assert.deepEqual(two.requirements, ['R-po-1', 'R-sec-2']);
  assert.equal(two.detail, 'R-po-1 (QA): fa\nR-sec-2 (QA): fc');
  assert.equal(two.section, 'S1');
});

test('requirementConcernOf dedupes across rounds: the first finding of an id wins', () => {
  const c = requirementConcernOf([rnd(1, [qa([{ id: 'qa-1-1', severity: 'major', title: 'first', fix: 'f1', requirement: 'R-po-1' }])]),
    rnd(2, [qa([{ id: 'qa-2-1', severity: 'major', title: 'second', fix: 'f2', requirement: 'R-po-1' }])])]);
  assert.equal(c.title, 'first');
  assert.equal(c.detail, 'R-po-1 (QA): f1');
});

test('requirementConcernBlock names the agreed ids and the requirement field; empty without ids', () => {
  assert.equal(requirementConcernBlock([]), '');
  const b = requirementConcernBlock(['R-po-1', 'R-sec-2']);
  assert.match(b, /^## Requirement concerns\n/);
  assert.match(b, /R-po-1, R-sec-2/);
  assert.match(b, /"requirement": "R-po-1"/);
});

test('requirementConcernFeedbackSection quotes the concern for the planner', () => {
  const s = requirementConcernFeedbackSection({ title: '2 requirement concerns', kind: 'requirement', requirements: ['R-po-1', 'R-sec-2'],
    detail: 'R-po-1 (QA): fa\n## R-sec-2 (UX): fb' });
  assert.match(s, /^\n## Requirement concern\n/);
  assert.match(s, /R-po-1, R-sec-2/);
  assert.match(s, /^> R-po-1 \(QA\): fa$/m);
  assert.match(s, /^> ## R-sec-2 \(UX\): fb$/m);
});
