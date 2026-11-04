// test/plan-concern.test.mjs — #990 s5: the implementer's plan concern contract (src/shared/review/plan-concern.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlanConcern, planConcernFileName, planConcernBlock, planConcernOverrideBlock, concernFeedbackSection,
  PLAN_CONCERN_TITLE_MAX, PLAN_CONCERN_DETAIL_MAX } from '../src/shared/review/plan-concern.mjs';

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
