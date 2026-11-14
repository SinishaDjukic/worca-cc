// test/ask-run-snapshot.test.mjs — the Chat run card's snapshot, moved to src/shared/ask-run-snapshot.mjs (D3): with
// run-decor's decorFromState injected it is dev's card snapshot exactly; without it, no decor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFromState, workModeOf, TERMINAL_RUN_STATUS, PROGRESS_CARD_TYPE, activeAgents } from '../src/shared/ask-run-snapshot.mjs';
import * as card from '../ui/public/ask-run-card.mjs';
import * as runKind from '../ui/public/run-kind.mjs';
import { isGraphManifest } from '../src/shared/graph/manifest.mjs';
import * as decor from '../ui/public/graph/run-decor.mjs';
import { RUN_STATE } from './helpers/stillhet-live-fixture.mjs';

test('the shared snapshot with decorFromState equals dev card\'s, for a live and a finished run', () => {
  for (const st of [RUN_STATE(), RUN_STATE({ status: 'done', active: [], steps: RUN_STATE().steps.map((s) => ({ ...s, status: 'done' })) })]) {
    assert.deepEqual(snapshotFromState(st, { now: 0, decorOf: decor.decorFromState }), card.snapshotFromState(st, { now: 0 }));
  }
  const done = snapshotFromState(RUN_STATE({ status: 'done' }), { now: 0 });
  assert.equal(done.pendingQuestion, null, 'a REST row has no question: memory-only fields stay absent');
  assert.equal(done.shaping, undefined);
  assert.equal(done.decor, null, 'no decorOf: no decor');
  assert.equal(done.terminal, true);
  assert.ok(done.stageProgress, 'stages still counted from the manifest');
});

test('the moved names are the ones dev imports', () => {
  assert.equal(card.TERMINAL_RUN_STATUS, TERMINAL_RUN_STATUS);
  assert.equal(card.PROGRESS_CARD_TYPE, PROGRESS_CARD_TYPE);
  assert.equal(card.activeAgents, activeAgents);
  assert.equal(runKind.workModeOf, workModeOf);
  assert.equal(decor.isGraphManifest, isGraphManifest);
});
