// test/needs-you.test.mjs — dev's Needs-you rule in its importable home (src/shared/needs-you.mjs). The Runs badge
// (ui/public/runs-list.mjs re-exports it) and Stillhet's bell (ui/public/stillhet/live/live-map.mjs) share it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsYou, needsYouItems, countNeedsYou, dedupeByPr } from '../src/shared/needs-you.mjs';
import * as RL from '../ui/public/runs-list.mjs';

test('needsYou: a pause, a question unless pausing, an unread failure; never a schedule ticket', () => {
  assert.equal(needsYou({ kind: 'live', status: 'paused' }), true);
  assert.equal(needsYou({ kind: 'hist', status: 'paused' }), true);
  assert.equal(needsYou({ kind: 'sched', status: 'paused' }), false);
  assert.equal(needsYou({ kind: 'live', status: 'running', ask: true }), true);
  assert.equal(needsYou({ kind: 'live', status: 'pausing', ask: true }), false);
  assert.equal(needsYou({ kind: 'live', status: 'interrupted', ask: true }), false);
  assert.equal(needsYou({ kind: 'live', status: 'error', unread: true }), true);
  assert.equal(needsYou({ kind: 'live', status: 'error' }), false);
  assert.equal(needsYou({ kind: 'hist', status: 'error', unread: true }), false);
  assert.equal(needsYou({ kind: 'hist', status: 'done', prNeeds: true }), true);
  assert.equal(needsYou({ kind: 'live', status: 'running', prNeeds: true }), false);
});

test('countNeedsYou equals needsYouItems live plus history; a saved row of a live run counts once', () => {
  const live = [{ pipelineId: 'p1', status: 'running', ask: true }, { pipelineId: 'p2', status: 'running' }, { pipelineId: 'p3', status: 'error', unread: true }];
  const history = [{ id: 'p1', status: 'paused' }, { id: 'h1', status: 'paused' }, { id: 'h2', status: 'done' }, { id: 'h3', status: 'error' }];
  const items = needsYouItems({ live, history });
  assert.deepEqual(items.live.map((r) => r.pipelineId), ['p1', 'p3']);
  assert.deepEqual(items.history.map((r) => r.id), ['h1']);
  assert.equal(countNeedsYou({ live, history }), 3);
});

test('dedupe: one Needs-you row per open PR, the newest kept', () => {
  const pr = (url) => ({ url, state: 'open', checks: 'failing' });
  const rows = [{ id: 'a', status: 'done', pr: pr('https://x/pr/1'), mtime: 1 }, { id: 'b', status: 'done', pr: pr('https://x/pr/1/'), mtime: 2 }];
  const { kept, dropped } = dedupeByPr(rows, { at: (r) => r.mtime });
  assert.deepEqual(kept.map((r) => r.id), ['b']);
  assert.equal(dropped.size, 1);
});

test('ui/public/runs-list.mjs re-exports the very same functions', () => {
  for (const name of ['needsYou', 'needsYouItems', 'countNeedsYou', 'roundMarkerOf', 'prUrlsOf', 'dedupeByPr', 'memberPrsOf']) assert.equal(typeof RL[name], 'function', name);
  assert.equal(RL.countNeedsYou, countNeedsYou);
  assert.equal(RL.needsYou, needsYou);
});
