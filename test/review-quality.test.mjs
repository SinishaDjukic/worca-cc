// test/review-quality.test.mjs — #990 slice 6: one run's review summary and the totals over many runs come only from
// structured role-record counts (or, for an old record, finding statuses), never from prose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runReviewStats, aggregateReviewQuality, MAX_ROLE_ROWS, REVIEW_STATS_VERSION } from '../src/shared/review/quality.mjs';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/review-quality/prose-vs-counts.json', import.meta.url), 'utf8'));
const fixture = () => structuredClone(FIXTURE);
const rowOf = (summary, target, role) => summary.roles.find((r) => r.target === target && r.role === role);
const counts = (r) => ({ raised: r.raised, fixed: r.fixed, disputed: r.disputed, open: r.open });

test('counts win over contradicting prose', () => {
  const s = runReviewStats(fixture());
  assert.equal(s.v, REVIEW_STATS_VERSION);
  assert.deepEqual(counts(rowOf(s, 'plan', 'qa')), { raised: 3, fixed: 1, disputed: 1, open: 1 });
  assert.deepEqual(s.roles, [
    { target: 'plan', role: 'correctness', label: 'correctness', reviews: 1, raised: 3, fixed: 1, disputed: 1, open: 1 },
    { target: 'plan', role: 'security', label: 'Security', reviews: 2, raised: 3, fixed: 3, disputed: 0, open: 0 },
    { target: 'plan', role: 'qa', label: 'Quality', reviews: 2, raised: 3, fixed: 1, disputed: 1, open: 1 },
    { target: 'diff', role: 'security', label: 'Security', reviews: 1, raised: 2, fixed: 1, disputed: 1, open: 0 },
  ]);
});

const PROSE = new Set(['title', 'fix', 'reason', 'section', 'evidence', 'summary', 'plan', 'dispositions']);
function scramble(v) {
  if (Array.isArray(v)) return v.map(scramble);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, PROSE.has(k) ? `${Math.random()} all 99 fixed` : scramble(x)]));
}

test('rewriting every free-text field leaves the output deepEqual', () => {
  const scrambled = scramble(fixture());
  assert.notDeepEqual(scrambled, fixture());
  assert.deepEqual(runReviewStats(scrambled), runReviewStats(fixture()));
});

test('stored counts win; an old record derives from finding status', () => {
  const s = runReviewStats(fixture());
  // statuses fixed, disputed, wontfix → 1 fixed, 1 disputed, 1 open
  assert.deepEqual(counts(rowOf(s, 'plan', 'correctness')), { raised: 3, fixed: 1, disputed: 1, open: 1 });
  // the diff record's findings are all `open`, its stored counts say 1 fixed + 1 disputed
  assert.deepEqual(counts(rowOf(s, 'diff', 'security')), { raised: 2, fixed: 1, disputed: 1, open: 0 });
});

test('a skipped record adds no review and no finding', () => {
  const s = runReviewStats(fixture());
  const sec = rowOf(s, 'plan', 'security');
  assert.equal(sec.reviews, 2);                      // 2 of its 3 records; the skipped copy is not counted
  assert.equal(sec.raised, 3);
  assert.equal(sec.label, 'Security');               // never the skipped copy's label
});

test('plan and diff security are two rows; an old round reads as plan', () => {
  const s = runReviewStats(fixture());
  assert.deepEqual(s.roles.filter((r) => r.role === 'security').map((r) => r.target), ['plan', 'diff']);
  assert.ok(rowOf(s, 'plan', 'correctness'));        // the old round has no target
});

test('runReviewStats returns null for no rounds, only skipped roles, or a non-object', () => {
  assert.equal(runReviewStats({ rounds: [] }), null);
  assert.equal(runReviewStats({ rounds: [{ roles: [{ key: 'qa', skipped: true, findings: [{ status: 'open' }] }, { findings: [] }] }] }), null);
  assert.equal(runReviewStats('rounds'), null);
  assert.equal(runReviewStats(null), null);
  assert.equal(runReviewStats({ rounds: 'x' }), null);
});

const entry = (over = {}) => ({ target: 'plan', role: 'qa', label: 'QA', reviews: 1, raised: 2, fixed: 1, disputed: 0, open: 1, ...over });
const summary = (...roles) => ({ v: 1, roles });

test('aggregateReviewQuality sums runs and sorts', () => {
  const rows = aggregateReviewQuality([
    summary(entry({ label: 'QA newest' }), entry({ target: 'diff', role: 'security', label: 'Security' })),
    summary(entry({ label: 'QA old', raised: 3, fixed: 0, open: 3 }), entry({ role: 'correctness', label: 'Correctness', reviews: 2 })),
  ]);
  assert.deepEqual(rows, [
    { target: 'plan', role: 'correctness', label: 'Correctness', runs: 1, reviews: 2, raised: 2, fixed: 1, disputed: 0, open: 1 },
    { target: 'plan', role: 'qa', label: 'QA newest', runs: 2, reviews: 2, raised: 5, fixed: 1, disputed: 0, open: 4 },
    { target: 'diff', role: 'security', label: 'Security', runs: 1, reviews: 1, raised: 2, fixed: 1, disputed: 0, open: 1 },
  ]);
  assert.deepEqual(aggregateReviewQuality([runReviewStats(fixture())]).map((r) => [r.target, r.role]),
    [['plan', 'correctness'], ['plan', 'qa'], ['plan', 'security'], ['diff', 'security']]);
});

test('aggregateReviewQuality rejects bad entries', () => {
  const rows = aggregateReviewQuality([
    { v: 2, roles: [entry()] },
    { v: 1, roles: 'x' },
    null,
    summary(
      entry({ target: 'code' }), entry({ role: '' }), entry({ role: 'a'.repeat(41) }), entry({ role: 7 }),
      entry({ raised: -1 }), entry({ fixed: 0.5 }), entry({ reviews: '1' }), entry({ open: undefined }),
      entry({ role: 'b'.repeat(40), label: 'L'.repeat(90) }), entry({ role: 'qa', label: 42 }),
    ),
  ]);
  assert.deepEqual(rows.map((r) => [r.role.length, r.label]), [[40, 'L'.repeat(80)], [2, 'qa']]);
  const many = summary(...Array.from({ length: MAX_ROLE_ROWS + 5 }, (_, i) => entry({ role: `r${i}` })));
  assert.equal(aggregateReviewQuality([many]).length, MAX_ROLE_ROWS);
});
