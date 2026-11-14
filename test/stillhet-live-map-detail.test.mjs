// test/stillhet-live-map-detail.test.mjs — one short detail line for Pulse, the bell and the task card (live-map.mjs
// shortDetail): at most 2 parts after the project, never a newline, a ✗ or a >= comparison.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shortDetail, failureItems, stageOfStep, updateOf, updateOfOutcome, taskOfSaved, taskOfLive } from '../ui/public/stillhet/live/live-map.mjs';
import { stageOfStep as pageStage } from '../ui/public/stillhet/live/task-page.mjs';

const clean = (s) => { assert.doesNotMatch(s, /\n|✗|>=/); assert.ok(s.split(' · ').length <= 2, s); return s; };

test('a multi-line ✗ failure reads its stage and the count', () => {
  const pauseDetail = 'Tests failed\n✗ test/a.test.mjs: timeout\n✗ test/b.test.mjs: expected 2\n✗ test/c.test.mjs: boom';
  assert.equal(clean(shortDetail({ status: 'paused', pauseReason: 'error', pauseDetail })), 'Build · 3 tests failed');
  assert.equal(clean(shortDetail({ status: 'failed', error: 'x ✗ only one', step: { agentKey: 'reviewer' } })), 'Review · 1 test failed');
  assert.deepEqual(failureItems('Tests ✗ a  ✗ b'), ['a', 'b']);
  assert.deepEqual(failureItems('no marks here'), []);
});

test('a cost pause reads the cap it reached, or the cap alone', () => {
  assert.equal(clean(shortDetail({ status: 'paused', pauseReason: 'cost_pipeline', pauseDetail: 'pipeline cost limit reached ($0.80 >= $0.50)' })), 'Cost cap · reached $0.50');
  assert.equal(clean(shortDetail({ status: 'paused', pauseReason: 'cost_total' })), 'Cost cap');
});

test('free error text keeps its first line, with no ✗ and no comparison', () => {
  const out = clean(shortDetail({ status: 'error', error: '✗ lint broke (12 >= 10)\nsecond line', step: { agentKey: 'planner' } }));
  assert.match(out, /^Plan · /);
  assert.equal(out, 'Plan · 1 test failed');
  const free = clean(shortDetail({ status: 'failed', error: 'The agent crashed (3 >= 2) while writing\nstack…' }));
  assert.equal(free, 'Build · The agent crashed while writing');
  assert.ok(clean(shortDetail({ status: 'failed', error: 'x'.repeat(200) })).length <= 'Build · '.length + 60);
});

test('another pause reads its word; an empty paused row reads Paused; a calm row reads nothing', () => {
  assert.equal(shortDetail({ status: 'paused', pauseReason: 'usage_limit', pauseDetail: 'usage limit hit\nresets 18:00' }), 'Usage limit');
  assert.equal(shortDetail({ status: 'paused' }), 'Paused');
  assert.equal(shortDetail({ status: 'running' }), '');
  assert.equal(shortDetail({ status: 'done' }), '');
});

test('updateOfOutcome: a capped run is the cost cap event, its meta the cap; updateOf shortens a scheduler pause', () => {
  const u = updateOfOutcome({ id: 'p1', status: 'paused', pauseReason: 'cost_pipeline', pauseDetail: 'pipeline cost limit reached ($0.80 >= $0.50)', projectName: 'web-app', mtime: 1, title: 'T' }, { now: 2 });
  assert.equal(u.e, 'run.cost_cap'); assert.equal(u.title, 'Cost cap reached · T'); assert.equal(u.meta, 'web-app · paused at $0.50');
  const f = updateOfOutcome({ id: 'p2', status: 'paused', pauseReason: 'error', pauseDetail: 'Tests failed ✗ a ✗ b', projectName: 'web-app', mtime: 1, title: 'T' }, { now: 2 });
  assert.equal(clean(f.meta.replace(/^web-app · /, '')), 'Build · 2 tests failed');
  const n = updateOf({ id: 1, kind: 'run_paused', title: 'Nightly', message: 'paused (cost pipeline): pipeline cost limit reached ($0.80 >= $0.50). Raise the cap.', createdAt: 1 }, { now: 2 });
  assert.equal(n.meta, 'Cost cap · reached $0.50');
});

test('the task rows read the same short line', () => {
  const pauseDetail = 'Tests failed ✗ a ✗ b ✗ c';
  assert.equal(taskOfSaved({ id: 'p', status: 'paused', pauseReason: 'error', pauseDetail }).detail, 'Build · 3 tests failed');
  assert.equal(taskOfLive({ runId: 'r', status: 'paused', pauseReason: 'cost_pipeline', pauseDetail: 'pipeline cost limit reached ($1.00 >= $0.50)' }).detail, 'Cost cap · reached $0.50');
});

test('one module for the rule: stageOfStep lives in live-map, task-page re-exports it, live-map never imports task-page', () => {
  assert.equal(pageStage, stageOfStep);
  assert.doesNotMatch(readFileSync('ui/public/stillhet/live/live-map.mjs', 'utf8'), /from '\.\/task-page\.mjs'/);
});

test('an ask\'s line: a plan waits for your OK; a long question is clipped to one short line; a PR that needs you names why', () => {
  assert.equal(taskOfLive({ runId: 'r', status: 'running', pendingQuestion: { id: 'q', kind: 'plan', plan: {} } }).detail, 'Waits for your OK on the plan');
  const q = 'How should the feature handle invalid input — fail fast, coerce, or ignore it entirely when it arrives?';
  const d = taskOfLive({ runId: 'r', status: 'running', pendingQuestion: { questions: [{ question: q }] } }).detail;
  assert.ok(d.length <= 60 && d.endsWith('…'), d);
  assert.equal(taskOfLive({ runId: 'r', status: 'running', pendingQuestion: { questions: [{ question: 'Which format?' }] } }).detail, 'Which format?');
  const pr = { url: 'https://github.com/o/r/pull/43', state: 'OPEN', mergeable: 'MERGEABLE', checks: { state: 'failing', total: 3, failed: 1, pending: 0 } };
  assert.equal(taskOfSaved({ id: 'p', status: 'done', pr }, { needs: true, checks: { checks: pr.checks, mergeable: 'MERGEABLE' } }).detail, '1 check failing');
  assert.equal(taskOfSaved({ id: 'p', status: 'done', pr: { ...pr, mergeable: 'CONFLICTING' } }, { needs: true, checks: { checks: { state: 'passing', total: 3 }, mergeable: 'CONFLICTING' } }).detail, 'Conflicts with its base');
});

test('a missed start\'s note reads when it was due, never dev\'s raw timestamp', () => {
  const due = new Date(2026, 10, 13, 3, 0).toISOString();
  const n = updateOf({ id: 2, kind: 'missed', title: 'Nightly', message: `was due at ${due}. Worca was not running.`, createdAt: 1, ticketId: 't' }, { now: 2 });
  assert.equal(n.meta, 'Worca was not running at 03:00');
});
