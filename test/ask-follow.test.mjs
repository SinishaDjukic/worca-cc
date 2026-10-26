// test/ask-follow.test.mjs
// attachRunFollower over a bare EventEmitter (spec §6.1 row): exact notices, no
// flooding, first-sight pipeline id, done-skips-on-error, detach semantics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { attachRunFollower } from '../src/core/ask/follow.mjs';
import { checkRows } from './helpers/rows.mjs';

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

test('follower progress: pipeline id on first sight, exec START names the agent, one notice per question (capped at 3)', async () => {
  await checkRows([
    { name: 'state: pipeline id captured on first truthy sight only; status mirrored', run: async () => {
      const { orch, patches } = harness();
      orch.emit('state', { id: null, status: 'starting' });
      orch.emit('state', { id: 'a1b2c3d4', status: 'running', title: 'T' });
      orch.emit('state', { id: 'ffffffff', status: 'running' });
      assert.equal(patches.length, 3);
      assert.equal(patches[0].pipelineId, undefined);
      assert.equal(patches[0].status, 'starting');
      assert.equal(patches[1].pipelineId, 'a1b2c3d4');
      assert.equal(patches[2].pipelineId, undefined, 'only the FIRST sight patches the id');
    } },
    { name: 'exec: updateStatus only on a START, named by the agent, no message', run: async () => {
      const { orch, posts, patches } = harness();
      orch.emit('exec', { nodeId: 'n_impl', executionId: 'x:n_impl:1', agentKey: 'implementer', ordinal: 1, status: 'start' });
      assert.equal(posts.length, 0);
      assert.deepEqual(patches, [{ phase: 'implementer', status: 'running' }]);
      // A terminal exec is not a status change — only a START names the live agent.
      orch.emit('exec', { nodeId: 'n_impl', executionId: 'x:n_impl:1', agentKey: 'implementer', ordinal: 1, status: 'done' });
      assert.equal(patches.length, 1, 'only the start patched');
      // A flow card has no agentKey: the nodeId names it.
      orch.emit('exec', { nodeId: 'n_or', executionId: 'x:n_or:1', agentKey: null, ordinal: 1, status: 'start' });
      assert.deepEqual(patches[1], { phase: 'n_or', status: 'running' });
    } },
    { name: 'question: one notice per question id, capped at 3, wording + href', run: async () => {
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
    } },
  ]);
});

test('error-then-done and a lone done{error}: one failed message at most (from the error event), card flagged, detached once', async () => {
  await checkRows([
    { name: 'error then done{error}: ONE failed message, card flagged, then detached', run: () => {
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
    } },
    { name: 'a lone done{status:error} (no preceding error event) posts nothing', run: () => {
      // The interlock itself: without a prior `error` (which self-detaches), the
      // done handler must still skip the message for status 'error'.
      const { orch, posts, patches, detached } = harness();
      orch.emit('done', { status: 'error' });
      assert.equal(posts.length, 0, 'the failure notice belongs to the `error` event alone (done-skips-on-error)');
      assert.equal(patches.at(-1).status, 'error');
      assert.equal(detached(), 1);
    } },
  ]);
});

test('done{done|stopped}: one finish message with status, and duration/cost only when present', async () => {
  await checkRows([
    { name: 'done{done} with an unknown step cost: a lower bound, never a known figure', run: () => {
      const { orch, posts } = harness();
      orch.state = { title: 'Fix login', totalActiveMs: 192000, totalCostUsd: 0.42, steps: [{ key: 'x:n_impl:1', costKnown: false }] };
      orch.emit('done', { status: 'done', pipelineDir: '/x' });
      assert.equal(posts.find((p) => p.kind === 'done').text, 'Run finished — "Fix login" · done · 3m12s · ≥ $0.42 (part unknown)');
    } },
    { name: 'done{done}: one finish message with status, duration and cost from getState()', run: () => {
      const { orch, posts, patches } = harness();
      orch.state = { title: 'Fix login', totalActiveMs: 192000, totalCostUsd: 0.42 };
      orch.emit('state', { id: 'a1b2c3d4', status: 'running', title: 'Fix login' });
      orch.emit('done', { status: 'done', pipelineDir: '/x' });
      const fin = posts.find((p) => p.kind === 'done');
      assert.ok(fin);
      assert.equal(fin.text, 'Run finished — "Fix login" · done · 3m12s · $0.42');
      assert.equal(fin.href, '#running/run-uuid-1');
      assert.equal(patches.at(-1).status, 'done');
    } },
    { name: 'done{stopped} wording omits absent duration/cost', run: () => {
      const { orch, posts } = harness();
      orch.emit('done', { status: 'stopped', pipelineDir: '/x' });
      assert.equal(posts[0].text, 'Run finished — "run" · stopped');
    } },
  ]);
});

test('follower robustness: throwing sinks never break the emitter; manual detach removes listeners once; the detach latch stops late events', async () => {
  await checkRows([
    { name: 'a throwing post/updateStatus never breaks the emitter (guard)', run: async () => {
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
    } },
    { name: 'manual detach removes every listener and fires onDetached once', run: async () => {
      const { orch, posts, follower, detached } = harness();
      follower.detach();
      follower.detach();
      assert.equal(detached(), 1);
      assert.equal(orch.listenerCount('state') + orch.listenerCount('phase')
        + orch.listenerCount('question') + orch.listenerCount('error') + orch.listenerCount('done'), 0);
      orch.emit('question', { id: 'q1', kind: 'clarify' });
      assert.equal(posts.length, 0);
    } },
    { name: 'the detach latch stops late events even when the emitter keeps its listeners', run: async () => {
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
    } },
  ]);
});

// Review of PR #376: done{status:'paused'} was treated as terminal — "Run
// finished … · paused" — and resumeRun never re-attached a follower, so a
// paused-then-resumed card run never reported its real outcome.
test('done{paused} (with and without reason:error): one paused notice, never "finished", card stays paused, detached', async () => {
  await checkRows([
    { name: 'done{paused}: one "paused" notice (never "finished"), status paused, then detached for the resumed lineage', run: () => {
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
    } },
    { name: 'done{paused, reason:error}: the notice carries the error detail; the card stays paused (resumable), never failed', run: () => {
      const { orch, posts, patches, follower, detached } = harness();
      orch.state = { title: 'T' };
      orch.emit('done', { status: 'paused', reason: 'error', detail: 'claude exited with code 1: disk full' });
      assert.equal(posts.length, 1);
      assert.equal(posts[0].kind, 'paused');
      assert.match(posts[0].text, /^Run paused after an error — "T": claude exited with code 1: disk full · resume it from Running$/);
      assert.equal(posts[0].href, '#running/run-uuid-1');
      assert.deepEqual(patches, [{ status: 'paused' }], 'no cardFailed: the run is parked, not dead');
      assert.equal(follower.detached, true);
      assert.equal(detached(), 1);
    } },
  ]);
});

// The `state` handler mirrors LIVE progress, and a terminal status is not
// progress — it is the run ending. The thread's terminal NOTICE is posted by the
// `done` handler, which the orchestrator emits only after _persist, appendAudit,
// _buildResults (git) and _reportToSource (the task-source write-back). Mirroring
// a terminal status from `state` therefore published "this run finished" to
// ask_run_links while the message saying so was still several awaits away, so a
// consumer that stops reading once the link is terminal never saw one.
test('state: done/stopped/error/paused are withheld from the state handler; the done handler supplies status + notice together', async () => {
  await checkRows([
    { name: 'state: a terminal status is left to the done handler, so the status and its notice land together', run: () => {
      const { orch, posts, patches } = harness();
      orch.emit('state', { id: 'a1b2c3d4', status: 'running', title: 'T' });
      orch.emit('state', { id: 'a1b2c3d4', status: 'done', title: 'T' });
      assert.deepEqual(patches.filter((p) => p.status).map((p) => p.status), ['running'],
        'the terminal state frame mirrors no status');
      assert.equal(posts.length, 0, 'and posts nothing');

      orch.emit('done', { status: 'done' });
      assert.equal(patches[patches.length - 1].status, 'done', 'the done handler supplies the terminal status');
      assert.equal(posts.length, 1, 'together with the one terminal notice');
      assert.equal(posts[0].kind, 'done');
    } },
    { name: 'state: stopped/error/paused are withheld too — each has a done event behind it', run: () => {
      // Same rule for every terminal value the orchestrator can stamp: stop() sets
      // 'stopped' synchronously and the run loop then unwinds into the async stopped
      // path that emits `done`, and _completePaused stamps 'paused' before its own
      // done{status:'paused'} — so in both cases the authoritative event is still coming.
      for (const status of ['stopped', 'error', 'paused']) {
        const { orch, patches } = harness();
        orch.emit('state', { id: 'a1b2c3d4', status: 'running' });
        orch.emit('state', { id: 'a1b2c3d4', status });
        assert.deepEqual(patches.filter((p) => p.status).map((p) => p.status), ['running'],
          `${status} is withheld from the state handler`);
      }
    } },
  ]);
});
