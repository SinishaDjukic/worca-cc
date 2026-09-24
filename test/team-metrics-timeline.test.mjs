// test/team-metrics-timeline.test.mjs
// Delivery timeline (pure): records → work items, item status from runs + pull requests, and
// the per-window summary strip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord } from './fixtures/team-metrics/records.mjs';
import {
  buildWorkItems, summarizeWindow, workItemKey, prLookupFor, recordRepos, REVIEW_WAIT_DAYS,
} from '../src/shared/team-metrics/timeline.mjs';

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.parse('2026-09-24T14:30:00Z');

function rec({ id, start, minutes = 60, branch = `worca/${id}`, ...rest }) {
  const r = makeRecord({ id, startedAt: new Date(start).toISOString().replace(/\.\d{3}Z$/, 'Z'), ...rest });
  r.endedAt = new Date(Date.parse(r.startedAt) + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  r.wallMs = minutes * 60_000;
  r.git.branch = branch;
  return r;
}
const at = (iso) => Date.parse(iso);
const merged = (number, createdAt, mergedAt, repo = 'acme/billing-api') => ({ repo, number, url: `https://github.com/${repo}/pull/${number}`, state: 'MERGED', createdAt, mergedAt, closedAt: mergedAt });

test('work item key: ticket first, then branch, then the run alone', () => {
  const withUrl = rec({ id: 'a', start: NOW, source: { type: 'github-issues', ref: '#1', url: 'https://github.com/acme/billing-api/issues/1' } });
  const withRef = rec({ id: 'b', start: NOW, source: { type: 'jira', ref: 'ACME-7' } });
  const branchOnly = rec({ id: 'c', start: NOW, branch: 'worca/x' });
  const bare = rec({ id: 'd', start: NOW, branch: null });
  assert.equal(workItemKey(withUrl), 'src:https://github.com/acme/billing-api/issues/1');
  assert.equal(workItemKey(withRef), 'src:acme/billing-api:jira:ACME-7');
  assert.equal(workItemKey(branchOnly), 'br:acme/billing-api:worca/x');
  assert.equal(workItemKey(bare), 'run:d');
});

test('workspace records look PRs up in the touched members (all members when none touched)', () => {
  const touched = rec({ id: 'w1', start: NOW, kind: 'workspace', touched: ['acme/gateway'] });
  const none = rec({ id: 'w2', start: NOW, kind: 'workspace', touched: [] });
  assert.deepEqual(recordRepos(touched), ['acme/gateway']);
  assert.deepEqual(recordRepos(none), ['acme/gateway', 'acme/console']);
  assert.deepEqual(prLookupFor(touched), { id: 'w1', repos: ['acme/gateway'], branch: 'worca/w1', pr: null, endedAt: touched.endedAt });
  const withPr = rec({ id: 'p', start: NOW, pr: { number: 9, url: 'https://github.com/acme/billing-api/pull/9' } });
  assert.deepEqual(prLookupFor(withPr).pr, { url: 'https://github.com/acme/billing-api/pull/9', number: 9 });
});

test('runs on one ticket form one item; spans, attempts, cost and the primary actor', () => {
  const src = { type: 'github-issues', ref: '#468', url: 'https://github.com/acme/billing-api/issues/468', title: 'Responses upstream' };
  const items = buildWorkItems([
    rec({ id: 'r2', start: at('2026-09-15T10:30:00Z'), minutes: 210, source: src, usd: 5, actor: 'Mara', branch: 'b2' }),
    rec({ id: 'r1', start: at('2026-09-14T09:00:00Z'), minutes: 180, source: src, usd: 3, actor: 'Tomás', result: 'stopped', branch: 'b1' }),
    rec({ id: 'r3', start: at('2026-09-16T14:00:00Z'), minutes: 45, source: src, usd: 1.25, actor: 'Mara', branch: 'b2' }),
  ], { now: NOW });
  assert.equal(items.length, 1);
  const it = items[0];
  assert.deepEqual(it.runs.map((r) => r.id), ['r1', 'r2', 'r3']);
  assert.equal(it.title, 'Responses upstream');
  assert.equal(it.first, at('2026-09-14T09:00:00Z'));
  assert.equal(it.lastEnd, at('2026-09-16T14:45:00Z'));
  assert.equal(it.costUsd, 9.25);
  assert.equal(it.actor, 'Mara');
  assert.deepEqual(it.actors, ['Mara', 'Tomás']);
  assert.equal(it.prKnown, false, 'no PR lookup given: unknown, not "no PR"');
  assert.equal(it.status, 'done');
});

test('status: merged PR ships on its merge time; the most final state wins across runs', () => {
  const items = buildWorkItems([
    rec({ id: 'a', start: at('2026-09-14T09:00:00Z'), branch: 'feat' }),
    rec({ id: 'b', start: at('2026-09-15T09:00:00Z'), branch: 'feat' }),
  ], {
    now: NOW,
    prs: {
      a: [{ ...merged(474, '2026-09-16T14:50:00Z', null), state: 'OPEN', mergedAt: null, closedAt: null }],
      b: [merged(474, '2026-09-16T14:50:00Z', '2026-09-22T17:30:00Z')],
    },
  });
  const it = items[0];
  assert.equal(it.status, 'shipped');
  assert.equal(it.mergedAt, at('2026-09-22T17:30:00Z'));
  assert.equal(it.end, it.mergedAt);
  assert.equal(it.prOpenAt, at('2026-09-16T14:50:00Z'));
  assert.equal(it.prs.length, 1);
});

test('status: open PR is in review, and needs attention once it has waited past the limit', () => {
  const fresh = buildWorkItems([rec({ id: 'a', start: NOW - 5 * H })], {
    now: NOW, prs: { a: [{ repo: 'acme/billing-api', number: 1, state: 'OPEN', createdAt: new Date(NOW - 4 * H).toISOString() }] },
  })[0];
  assert.equal(fresh.status, 'review');
  assert.equal(fresh.end, NOW);
  const stale = buildWorkItems([rec({ id: 'b', start: NOW - 5 * DAY })], {
    now: NOW, prs: { b: [{ repo: 'acme/billing-api', number: 2, state: 'OPEN', createdAt: new Date(NOW - (REVIEW_WAIT_DAYS + 1.5) * DAY).toISOString() }] },
  })[0];
  assert.equal(stale.status, 'attention');
  assert.equal(stale.reason, 'Pull request waiting for review for 3 days.');
});

test('status without a PR: failed last attempt needs attention, stopped, closed, done', () => {
  const allFailed = buildWorkItems([
    rec({ id: 'f1', start: NOW - 3 * DAY, result: 'failed', branch: 'fx' }),
    rec({ id: 'f2', start: NOW - 2 * DAY, result: 'failed', branch: 'fx' }),
  ], { now: NOW, prs: { f1: [], f2: [] } })[0];
  assert.equal(allFailed.status, 'attention');
  assert.equal(allFailed.reason, 'All 2 attempts failed.');
  assert.equal(allFailed.prKnown, true);
  const recovered = buildWorkItems([
    rec({ id: 'g1', start: NOW - 3 * DAY, result: 'failed', branch: 'gx' }),
    rec({ id: 'g2', start: NOW - 2 * DAY, branch: 'gx' }),
  ], { now: NOW })[0];
  assert.equal(recovered.status, 'done', 'a later success clears the failure');
  assert.equal(buildWorkItems([rec({ id: 's', start: NOW - DAY, result: 'stopped' })], { now: NOW })[0].status, 'stopped');
  const closed = buildWorkItems([rec({ id: 'c', start: NOW - 2 * DAY })], {
    now: NOW, prs: { c: [{ repo: 'acme/billing-api', number: 3, state: 'CLOSED', createdAt: new Date(NOW - DAY).toISOString(), closedAt: new Date(NOW - H).toISOString() }] },
  })[0];
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closedAt, NOW - H);
});

test('window summary: shipped in window, in review at the cut, attention, lead time, spend', () => {
  const sep = { startMs: at('2026-09-01T00:00:00Z'), endMs: at('2026-10-01T00:00:00Z'), now: NOW };
  const items = buildWorkItems([
    rec({ id: 'm1', start: at('2026-09-02T10:00:00Z'), usd: 2 }),                // merged Sep 4
    rec({ id: 'm2', start: at('2026-08-28T10:00:00Z'), usd: 4 }),                // merged Sep 2, started in Aug
    rec({ id: 'o1', start: at('2026-09-24T09:00:00Z'), usd: 1 }),                // open, fresh
    rec({ id: 'x1', start: at('2026-09-18T09:00:00Z'), usd: 3, result: 'failed' }),
    rec({ id: 'old', start: at('2026-07-01T09:00:00Z'), usd: 9 }),               // merged in July
  ], {
    now: NOW,
    prs: {
      m1: [merged(1, '2026-09-02T12:00:00Z', '2026-09-04T10:00:00Z')],
      m2: [merged(2, '2026-08-28T12:00:00Z', '2026-09-02T10:00:00Z')],
      o1: [{ repo: 'acme/billing-api', number: 3, state: 'OPEN', createdAt: '2026-09-24T10:00:00Z' }],
      x1: [],
      old: [merged(4, '2026-07-01T12:00:00Z', '2026-07-03T09:00:00Z')],
    },
  });
  const s = summarizeWindow(items, sep);
  assert.deepEqual(s.shipped.map((i) => i.runs[0].id).sort(), ['m1', 'm2']);
  assert.deepEqual(s.inReview.map((i) => i.runs[0].id), ['o1']);
  assert.deepEqual(s.attention.map((i) => i.runs[0].id), ['x1']);
  assert.equal(s.medianLeadMs, ((2 * DAY) + (5 * DAY)) / 2);
  assert.equal(s.spendUsd, 6, 'runs started in September only');
  assert.equal(s.prKnown, true);
  assert.ok(!s.visible.some((i) => i.runs[0].id === 'old'));
  // August: m2 was in review at the end of the month.
  const aug = summarizeWindow(items, { startMs: at('2026-08-01T00:00:00Z'), endMs: at('2026-09-01T00:00:00Z'), now: NOW });
  assert.deepEqual(aug.inReview.map((i) => i.runs[0].id), ['m2']);
  assert.equal(aug.shipped.length, 0);
  // A future window has no "in review" yet.
  assert.equal(summarizeWindow(items, { startMs: at('2026-10-01T00:00:00Z'), endMs: at('2026-11-01T00:00:00Z'), now: NOW }).inReview.length, 0);
});

test('a PR merged on an unknown date ships at the last run and never counts as in review', () => {
  const it = buildWorkItems([rec({ id: 'l', start: at('2026-09-10T10:00:00Z') })], {
    now: NOW, prs: { l: [{ repo: 'acme/billing-api', number: 5, state: 'MERGED', createdAt: '2026-09-10T12:00:00Z' }] },
  });
  assert.equal(it[0].status, 'shipped');
  assert.equal(it[0].mergedAt, null);
  const s = summarizeWindow(it, { startMs: at('2026-09-01T00:00:00Z'), endMs: at('2026-10-01T00:00:00Z'), now: NOW });
  assert.equal(s.shipped.length, 1);
  assert.equal(s.inReview.length, 0);
  assert.equal(s.medianLeadMs, null);
});

test('without any PR data the summary falls back to completed work', () => {
  const items = buildWorkItems([
    rec({ id: 'a', start: at('2026-09-10T10:00:00Z') }),
    rec({ id: 'b', start: at('2026-09-11T10:00:00Z'), result: 'failed' }),
  ], { now: NOW });
  const s = summarizeWindow(items, { startMs: at('2026-09-01T00:00:00Z'), endMs: at('2026-10-01T00:00:00Z'), now: NOW });
  assert.equal(s.prKnown, false);
  assert.equal(s.shipped.length, 0);
  assert.deepEqual(s.completed.map((i) => i.runs[0].id), ['a']);
});

test('records with a malformed startedAt are skipped', () => {
  const bad = rec({ id: 'z', start: NOW });
  bad.startedAt = 'nope';
  assert.equal(buildWorkItems([bad], { now: NOW }).length, 0);
});
