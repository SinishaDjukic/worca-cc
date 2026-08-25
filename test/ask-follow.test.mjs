// test/ask-follow.test.mjs
// attachRunFollower over a bare EventEmitter (spec §6.1 row): exact notices, no
// flooding, first-sight pipeline id, done-skips-on-error, detach semantics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { attachRunFollower } from '../src/core/ask/follow.mjs';

function harness(extra = {}) {
  const orch = new EventEmitter();
  orch.state = {};
  orch.getState = () => ({ ...orch.state });
  const posts = [];
  const patches = [];
  let detachedCb = 0;
  const follower = attachRunFollower(orch, {
    threadId: 'ask_00000001',
    runId: 'run-uuid-1',
    cardId: 'card_00000001',
    post: (m) => posts.push(m),
    updateStatus: (p) => patches.push(p),
    onDetached: () => { detachedCb += 1; },
    ...extra,
  });
  return { orch, posts, patches, follower, detached: () => detachedCb };
}

test('state: pipeline id captured on first truthy sight only; status mirrored', () => {
  const { orch, patches } = harness();
  orch.emit('state', { id: null, status: 'starting' });
  orch.emit('state', { id: 'a1b2c3d4', status: 'running', title: 'T' });
  orch.emit('state', { id: 'ffffffff', status: 'running' });
  assert.equal(patches.length, 3);
  assert.equal(patches[0].pipelineId, undefined);
  assert.equal(patches[0].status, 'starting');
  assert.equal(patches[1].pipelineId, 'a1b2c3d4');
  assert.equal(patches[2].pipelineId, undefined, 'only the FIRST sight patches the id');
});

test('phase: updateStatus only, status forced running, no message', () => {
  const { orch, posts, patches } = harness();
  orch.emit('phase', { phase: 'implement', cycle: 1, status: 'start' });
  assert.equal(posts.length, 0);
  assert.deepEqual(patches, [{ phase: 'implement', status: 'running' }]);
});

test('question: one notice per question id, capped at 3, wording + href', () => {
  const { orch, posts } = harness();
  orch.emit('state', { id: 'a1b2c3d4', status: 'running', title: 'Fix login' });
  orch.emit('question', { id: 'q1', kind: 'clarify' });
  orch.emit('question', { id: 'q1', kind: 'clarify' });   // duplicate id — dropped
  orch.emit('question', { id: 'q2', kind: 'gate' });
  orch.emit('question', { id: 'q3', kind: 'recovery' });
  orch.emit('question', { id: 'q4', kind: 'clarify' });   // over the cap — dropped
  assert.equal(posts.length, 3);
  assert.equal(posts[0].kind, 'question');
  assert.equal(posts[0].text, 'Run "Fix login" is waiting for your answer (clarify)');
  assert.equal(posts[1].text, 'Run "Fix login" is waiting for your answer (gate)');
  assert.equal(posts[0].href, '#running/run-uuid-1');
});

test('error then done{error}: ONE failed message, card flagged, then detached', () => {
  const { orch, posts, patches, detached } = harness();
  orch.emit('error', { message: 'Preflight failed: 1 workflow agent key(s) do not resolve:\n  - agent "x" is not installed' });
  orch.emit('done', { status: 'error', pipelineDir: null });
  assert.equal(posts.length, 1, 'done{status:error} posts nothing (the richer error already did)');
  assert.equal(posts[0].kind, 'failed');
  assert.match(posts[0].text, /^Run failed: Preflight failed:/);
  const err = patches.find((p) => p.cardFailed);
  assert.ok(err, 'updateStatus carried cardFailed');
  assert.equal(err.status, 'error');
  assert.equal(detached(), 1, 'self-detached exactly once');
  orch.emit('question', { id: 'q9', kind: 'clarify' });
  assert.equal(posts.length, 1, 'detached: later events are ignored');
});

test('done{done}: one finish message with status, duration and cost from getState()', () => {
  const { orch, posts, patches } = harness();
  orch.state = { title: 'Fix login', totalActiveMs: 192000, totalCostUsd: 0.42 };
  orch.emit('state', { id: 'a1b2c3d4', status: 'running', title: 'Fix login' });
  orch.emit('done', { status: 'done', pipelineDir: '/x' });
  const fin = posts.find((p) => p.kind === 'done');
  assert.ok(fin);
  assert.equal(fin.text, 'Run finished — "Fix login" · done · 3m12s · $0.42');
  assert.equal(fin.href, '#running/run-uuid-1');
  assert.equal(patches.at(-1).status, 'done');
});

test('done{stopped} wording omits absent duration/cost', () => {
  const { orch, posts } = harness();
  orch.emit('done', { status: 'stopped', pipelineDir: '/x' });
  assert.equal(posts[0].text, 'Run finished — "run" · stopped');
});

test('a throwing post/updateStatus never breaks the emitter (guard)', () => {
  const orch = new EventEmitter();
  orch.state = {};
  orch.getState = () => ({});
  attachRunFollower(orch, {
    threadId: 't', runId: 'r', cardId: null,
    post: () => { throw new Error('boom'); },
    updateStatus: () => { throw new Error('boom'); },
  });
  assert.doesNotThrow(() => {
    orch.emit('state', { id: 'a1b2c3d4' });
    orch.emit('question', { id: 'q1', kind: 'clarify' });
    orch.emit('error', { message: 'x' });
    orch.emit('done', { status: 'error' });
  });
});

test('manual detach removes every listener and fires onDetached once', () => {
  const { orch, posts, follower, detached } = harness();
  follower.detach();
  follower.detach();
  assert.equal(detached(), 1);
  assert.equal(orch.listenerCount('state') + orch.listenerCount('phase')
    + orch.listenerCount('question') + orch.listenerCount('error') + orch.listenerCount('done'), 0);
  orch.emit('question', { id: 'q1', kind: 'clarify' });
  assert.equal(posts.length, 0);
});

test('a lone done{status:error} (no preceding error event) posts nothing', () => {
  // The interlock itself: without a prior `error` (which self-detaches), the
  // done handler must still skip the message for status 'error'.
  const { orch, posts, patches, detached } = harness();
  orch.emit('done', { status: 'error' });
  assert.equal(posts.length, 0, 'the failure notice belongs to the `error` event alone (done-skips-on-error)');
  assert.equal(patches.at(-1).status, 'error');
  assert.equal(detached(), 1);
});

test('the detach latch stops late events even when the emitter keeps its listeners', () => {
  // A foreign / already-torn-down orchestrator whose removeListener no-ops:
  // only the `detached` latch inside guard() can stop the flood.
  const orch = new EventEmitter();
  orch.getState = () => ({});
  orch.removeListener = () => orch;
  const posts = [];
  attachRunFollower(orch, {
    threadId: 'ask_00000001', runId: 'r', cardId: null,
    post: (m) => posts.push(m), updateStatus: () => {},
  });
  orch.emit('done', { status: 'done' });
  assert.equal(posts.length, 1);
  orch.emit('question', { id: 'q1', kind: 'clarify' });
  orch.emit('done', { status: 'done' });
  assert.equal(posts.length, 1, 'the detached latch no-ops every later handler');
});

// Review of PR #376: done{status:'paused'} was treated as terminal — "Run
// finished … · paused" — and resumeRun never re-attached a follower, so a
// paused-then-resumed card run never reported its real outcome.
test('done{paused}: one "paused" notice (never "finished"), status paused, then detached for the resumed lineage', () => {
  const { orch, posts, patches, follower, detached } = harness();
  orch.state = { title: 'T' };
  orch.emit('done', { status: 'paused' });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].kind, 'paused');
  assert.match(posts[0].text, /Run paused — "T"/);
  assert.doesNotMatch(posts[0].text, /finished/i);
  assert.equal(posts[0].href, '#running/run-uuid-1');
  assert.deepEqual(patches, [{ status: 'paused' }]);
  assert.equal(follower.detached, true, 'this orchestrator is done; the resume creates a new one');
  assert.equal(detached(), 1);
});
