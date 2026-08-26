// test/ask-diff-comment-launch.test.mjs
// propose_run commentIds -> ask_card_comments -> ask_run_links.comment_ids ->
// diff_comments.sent_run_id, stamped on the FIRST state event and never at launch.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { createThread, linkRun, updateRunLink, listRunLinks } from '../src/core/ask/store.mjs';
import {
  addDiffComment, getDiffComment, deleteDiffComment,
  setPendingCardComments, peekPendingCardComments, clearPendingCardComments, stampSentRunId,
  onDiffCommentsChanged,
} from '../src/core/diff-comments.mjs';

useTempHome(after);

const PATCH = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-a\n+b\n';
const UUID_A = '3f2a9c01-1111-4222-8333-444455556666';
const UUID_B = 'aaaaaaaa-1111-4222-8333-444455556666';

async function seedComment() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-dcl-'));
  const run = await seedPipeline(dir, { title: 'Run', status: 'done' });
  await writeFile(join(run.dir, 'diff-patch.patch'), PATCH, 'utf8');
  const c = addDiffComment({ storeKey: run.key, pipelineId: run.id, patchText: PATCH,
    path: 'a.js', side: 'new', line: 1, body: 'fix me', author: 'user' });
  return { run, c, projectDir: dir };
}

test('pending card comments are recorded, consumed once, and unknown ids dropped', async () => {
  const { c } = await seedComment();
  assert.equal(setPendingCardComments('card_3f2a9c01', [c.id, 'dc_00000000', 'garbage']), 1);
  assert.deepEqual(peekPendingCardComments('card_3f2a9c01'), [c.id]);
  assert.deepEqual(peekPendingCardComments('card_3f2a9c01'), [c.id], 'peek does NOT consume');
  assert.equal(clearPendingCardComments('card_3f2a9c01'), 1);
  assert.deepEqual(peekPendingCardComments('card_3f2a9c01'), [], 'cleared');
  assert.equal(setPendingCardComments('', [c.id]), 0);
  assert.equal(setPendingCardComments('card_00000002', []), 0);
});

test('deleting a comment cascades its pending-card rows away', async () => {
  const { c } = await seedComment();
  setPendingCardComments('card_00000003', [c.id]);
  deleteDiffComment(c.id);
  assert.deepEqual(peekPendingCardComments('card_00000003'), [],
    'the ask_card_comments cascade fires (foreign_keys=ON on the getDb handle)');
});

test('ask_run_links carries commentIds as JSON and round-trips through the row mapper', async () => {
  const { c } = await seedComment();
  const thread = createThread();
  linkRun(thread.id, { runId: UUID_A, cardId: 'card_3f2a9c01' });
  assert.deepEqual(listRunLinks(thread.id)[0].commentIds, [], 'absent -> []');
  updateRunLink(thread.id, UUID_A, { commentIds: [c.id] });
  assert.deepEqual(listRunLinks(thread.id)[0].commentIds, [c.id]);
  updateRunLink(thread.id, UUID_A, { commentIds: [] });
  assert.deepEqual(listRunLinks(thread.id)[0].commentIds, [], 'empty array stores NULL, reads back []');
  updateRunLink(thread.id, UUID_A, { status: 'running' });
  assert.equal(listRunLinks(thread.id)[0].status, 'running', 'the other scalar patches still work');
});

test('stampSentRunId writes the pipeline id of a real run and never resolves', async () => {
  const { c, projectDir } = await seedComment();
  const target = await seedPipeline(projectDir, { title: 'Fix run', status: 'running' });
  stampSentRunId([c.id], target.id);
  const stamped = getDiffComment(c.id);
  assert.equal(stamped.sentRunId, target.id);
  assert.equal(stamped.resolved, false);
});

test('stampSentRunId is scoped to the launched run\'s store and pokes the comment\'s own run', async () => {
  const { run, c, projectDir } = await seedComment();
  const otherDir = mkdtempSync(join(tmpdir(), 'worca-dcl-other-'));
  const other = await seedPipeline(otherDir, { title: 'Elsewhere', status: 'done' });
  const seen = [];
  const off = onDiffCommentsChanged((e) => seen.push(e));
  // m4: nothing ever un-stamps sent_run_id, so a wrong marker is permanent.
  assert.equal(stampSentRunId([c.id], other.id), 0, 'cross-project stamp writes nothing');
  assert.equal(getDiffComment(c.id).sentRunId, null);
  assert.deepEqual(seen, [], 'nothing to repaint either');

  const fix = await seedPipeline(projectDir, { title: 'Fix run', status: 'running' }); // same project => same store key
  assert.equal(stampSentRunId([c.id], fix.id), 1);
  assert.equal(getDiffComment(c.id).sentRunId, fix.id);
  // m5: the Diff tab's cards repaint only from diff-comments-changed, and no run
  // event touches them — so the marker needed a reopen to appear.
  assert.deepEqual(seen, [{ storeKey: run.key, pipelineId: run.id }],
    'the poke names the run whose Diff tab shows the pill, not the run it was sent to');
  off();
  assert.equal(stampSentRunId([c.id], 'nosuchid'), 0, 'an unknown run stamps nothing');
});

test('no state event -> sent_run_id stays NULL and the pending link remains', async () => {
  const { c } = await seedComment();
  const thread = createThread();
  linkRun(thread.id, { runId: UUID_B, cardId: 'card_00000001' });
  updateRunLink(thread.id, UUID_B, { commentIds: [c.id] });
  assert.equal(getDiffComment(c.id).sentRunId, null, 'a proposal that never started stamps nothing');
  assert.equal(listRunLinks(thread.id)[0].pipelineId, null);
  assert.deepEqual(listRunLinks(thread.id)[0].commentIds, [c.id], 'the pending link remains');
});
