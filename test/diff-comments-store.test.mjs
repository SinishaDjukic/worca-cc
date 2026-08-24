// test/diff-comments-store.test.mjs
// The one mutation module: anchor-validated inserts, the 4000-char cap, the
// resolve/delete/count readers, the change notification, and the archive cascade.
// NOTE useTempHome gives ONE home per FILE, so rows written by an earlier test are
// still there — every assertion below is scoped to its own run's key.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import {
  addDiffComment, listDiffComments, getDiffComment, setDiffCommentResolved,
  deleteDiffComment, unresolvedCounts, onDiffCommentsChanged, stampSentRunId,
  DiffCommentError, COMMENT_BODY_MAX,
} from '../src/core/diff-comments.mjs';
import { archivePipeline } from '../src/core/pipeline-delete.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';

useTempHome(after);

const PATCH = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -1,3 +1,4 @@
 keep
-old
+new
+added
 line3
`;

async function seedRun() {
  const projectDir = mkdtempSync(join(tmpdir(), 'worca-dc-proj-'));
  const seeded = await seedPipeline(projectDir, { title: 'Run', status: 'done' });
  await writeFile(join(seeded.dir, 'diff-patch.patch'), PATCH, 'utf8');
  return { ...seeded, projectDir, patch: PATCH };
}
const mk = (run, path, side, line, body, author = 'user') => addDiffComment({
  storeKey: run.key, pipelineId: run.id, patchText: run.patch, path, side, line, body, author });

test('the body cap is stated once and shared with the MCP schema', () => {
  assert.equal(COMMENT_BODY_MAX, 4000);
  assert.equal(ASK_LIMITS.commentBodyMaxChars, COMMENT_BODY_MAX,
    'the tool description and the store must quote the same number');
});

test('addDiffComment: validates the anchor, captures line_text server-side, mints dc_<8hex>', async () => {
  const run = await seedRun();
  const c = mk(run, 'src/a.js', 'new', 3, '  needs a test  ');
  assert.match(c.id, /^dc_[0-9a-f]{8}$/);
  assert.equal(c.lineText, 'added', 'captured from the patch, never from the caller');
  assert.equal(c.body, 'needs a test', 'trimmed');
  assert.equal(c.author, 'user');
  assert.equal(c.resolved, false);
  assert.equal(c.sentRunId, null);
  assert.equal(c.projectKey, null);
  assert.equal(c.oldPath, 'src/a.js');
  assert.equal(c.storeKey, run.key);
  assert.equal(c.pipelineId, run.id);
  assert.deepEqual(listDiffComments(run.key, run.id).map((x) => x.id), [c.id]);
});

test('addDiffComment: a body over the cap is REFUSED, never silently truncated', async () => {
  const run = await seedRun();
  assert.throws(() => mk(run, 'src/a.js', 'new', 1, 'x'.repeat(COMMENT_BODY_MAX + 1)),
    { name: 'DiffCommentError', message: `body exceeds ${COMMENT_BODY_MAX} characters` });
  assert.doesNotThrow(() => mk(run, 'src/a.js', 'new', 1, 'x'.repeat(COMMENT_BODY_MAX)), 'exactly at the cap is fine');
  assert.throws(() => mk(run, 'src/a.js', 'new', 1, '   '), { message: 'body is required' });
  assert.throws(() => mk(run, 'src/a.js', 'new', 1, 'x', 'nobody'), { message: 'author must be "user" or "ask"' });
});

test('addDiffComment: no patch at all is a DiffCommentError, not an anchor error', async () => {
  const run = await seedRun();
  for (const empty of [null, undefined, '']) {
    assert.throws(() => addDiffComment({
      storeKey: run.key, pipelineId: run.id, patchText: empty,
      path: 'src/a.js', side: 'new', line: 1, body: 'x', author: 'user',
    }), { message: 'this run has no stored diff — comments cannot be created on it' });
  }
});

test('addDiffComment: an anchor refusal arrives as a DiffCommentError with the AnchorError text', async () => {
  const run = await seedRun();
  assert.throws(() => mk(run, 'ghost.js', 'new', 1, 'x'),
    { name: 'DiffCommentError', message: '"ghost.js" is not a file of this run\'s diff' });
});

test('listDiffComments: ordered by path, then line, then CREATION (rowid); status and path filters', async () => {
  const run = await seedRun();
  // a and b land on the same line in the same millisecond — created_at ties, so
  // only the rowid tiebreak (D17) makes this deterministic.
  const third = mk(run, 'src/a.js', 'new', 4, 'c');
  const first = mk(run, 'src/a.js', 'new', 1, 'a');
  const second = mk(run, 'src/a.js', 'new', 1, 'b');
  assert.deepEqual(listDiffComments(run.key, run.id).map((c) => c.body), ['a', 'b', 'c']);
  setDiffCommentResolved(first.id, true);
  assert.deepEqual(listDiffComments(run.key, run.id, { status: 'unresolved' }).map((c) => c.body), ['b', 'c']);
  assert.deepEqual(listDiffComments(run.key, run.id, { status: 'resolved' }).map((c) => c.body), ['a']);
  assert.equal(listDiffComments(run.key, run.id, { path: 'nope' }).length, 0);
  assert.equal(listDiffComments(run.key, run.id, { path: 'src/a.js' }).length, 3);
  assert.ok(second && third);
});

test('listDiffComments: creation order holds for 25 same-millisecond inserts', async () => {
  const run = await seedRun();
  const bodies = Array.from({ length: 25 }, (_, i) => `n${String(i).padStart(2, '0')}`);
  for (const b of bodies) mk(run, 'src/a.js', 'new', 2, b);
  assert.deepEqual(listDiffComments(run.key, run.id).map((c) => c.body), bodies,
    'a random-hex id tiebreak would shuffle these');
});

test('setDiffCommentResolved: toggles resolved_at both ways; delete is hard', async () => {
  const run = await seedRun();
  const c = mk(run, 'src/a.js', 'old', 2, 'why?', 'ask');
  const on = setDiffCommentResolved(c.id, true);
  assert.equal(on.resolved, true);
  assert.ok(on.resolvedAt, 'stamped');
  const off = setDiffCommentResolved(c.id, false);
  assert.equal(off.resolved, false);
  assert.equal(off.resolvedAt, null, 'cleared');
  assert.equal(setDiffCommentResolved('dc_deadbeef', true), null, 'unknown id -> null');
  assert.equal(setDiffCommentResolved('not-an-id', true), null, 'malformed id -> null, never SQL');
  assert.equal(deleteDiffComment(c.id), true);
  assert.equal(getDiffComment(c.id), null);
  assert.equal(deleteDiffComment(c.id), false, 'idempotent');
});

test('stampSentRunId: sets the 8-hex pipeline id and NEVER resolves', async () => {
  const run = await seedRun();
  const c = mk(run, 'src/a.js', 'new', 1, 'fix', 'ask');
  assert.equal(stampSentRunId([c.id, 'dc_00000000', 'garbage'], 'abcd1234'), 1,
    'unknown and malformed ids are ignored');
  const stamped = getDiffComment(c.id);
  assert.equal(stamped.sentRunId, 'abcd1234');
  assert.equal(stamped.resolved, false, 'stamping never auto-resolves');
});

test('unresolvedCounts: keyed "<storeKey>/<pipelineId>", resolved rows excluded', async () => {
  const run = await seedRun();
  const key = `${run.key}/${run.id}`;
  const a = mk(run, 'src/a.js', 'new', 1, 'a');
  mk(run, 'src/a.js', 'new', 2, 'b');
  assert.equal(unresolvedCounts()[key], 2);
  setDiffCommentResolved(a.id, true);
  assert.equal(unresolvedCounts()[key], 1);
});

test('every successful mutation pokes the change listener with ids only', async () => {
  const run = await seedRun();
  const seen = [];
  const off = onDiffCommentsChanged((e) => seen.push(e));
  const c = mk(run, 'src/a.js', 'new', 1, 'a');
  setDiffCommentResolved(c.id, true);
  deleteDiffComment(c.id);
  off();
  setDiffCommentResolved(c.id, false);   // after unsubscribe AND already deleted: no event
  assert.deepEqual(seen, [
    { storeKey: run.key, pipelineId: run.id },
    { storeKey: run.key, pipelineId: run.id },
    { storeKey: run.key, pipelineId: run.id },
  ]);
});

test('a throwing listener never breaks the write', async () => {
  const run = await seedRun();
  const off = onDiffCommentsChanged(() => { throw new Error('sink is broken'); });
  assert.doesNotThrow(() => mk(run, 'src/a.js', 'new', 1, 'still saved'));
  off();
});

test('archiving a run deletes its comments inside the archive transaction', async () => {
  const run = await seedRun();
  const key = `${run.key}/${run.id}`;
  mk(run, 'src/a.js', 'new', 1, 'a');
  assert.equal(listDiffComments(run.key, run.id).length, 1);
  assert.equal(unresolvedCounts()[key], 1);
  const out = await archivePipeline({ key: run.key, id: run.id });
  assert.equal(out.ok, true);
  assert.deepEqual(listDiffComments(run.key, run.id), [], 'archived runs have no comments');
  // Scoped to THIS run: useTempHome is per-file, so other runs' rows are still here.
  assert.equal(unresolvedCounts()[key], undefined);
});
