// test/ask-diff-comment-tools.test.mjs
// The four comment tools: shape + validation + the fail-closed read filter over the
// real bundle on a temp home.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { defaultToolDeps } from '../src/core/ask/tool-deps.mjs';
import { defaultCommentDeps } from '../src/core/ask/comment-deps.mjs';
import { addDiffComment, getDiffComment, listDiffComments } from '../src/core/diff-comments.mjs';
import { getDb } from '../src/core/db.mjs';
import { GUARDRAIL_PRESETS } from '../src/core/guardrails.mjs';

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
diff --git a/ok.txt b/ok.txt
--- a/ok.txt
+++ b/ok.txt
@@ -1 +1 @@
-before
+after
diff --git a/.env b/.env
--- a/.env
+++ b/.env
@@ -1 +1 @@
-A=ghp_abcdefghijklmnopqrstuvwxyz0123456789
+A=2
`;

async function realTools(extra = {}) {
  const projectDir = mkdtempSync(join(tmpdir(), 'worca-dct-proj-'));
  const seeded = await seedPipeline(projectDir, { title: 'Run', status: 'done' });
  await writeFile(join(seeded.dir, 'diff-patch.patch'), PATCH, 'utf8');
  const deps = { ...defaultToolDeps({ threadId: 'ask_00000001' }), ...defaultCommentDeps(), ...extra };
  return { tools: createAskTools(deps), run: seeded, deps };
}

test('list(): eighteen tools, the four comment tools in place, all with JSON-Schema inputs', async () => {
  const { tools } = await realTools();
  assert.deepEqual(tools.list().map((d) => d.name), ['list_projects', 'list_workflows', 'list_runs',
    'get_run', 'get_run_diff', 'propose_run', 'read_attachment',
    'list_diff_comments', 'add_diff_comment', 'resolve_diff_comment', 'delete_diff_comment',
    'open_worktree', 'list_worktrees', 'remove_worktree', 'git',
    'list_run_artifacts', 'read_run_artifact', 'get_run_progress']);
  const byName = (n) => tools.list().find((d) => d.name === n);
  assert.deepEqual(byName('add_diff_comment').inputSchema.required, ['id', 'path', 'side', 'line', 'body']);
  assert.deepEqual(byName('delete_diff_comment').inputSchema.required, ['commentId']);
  assert.deepEqual(byName('list_diff_comments').inputSchema.required, ['id']);
  assert.equal(byName('resolve_diff_comment').inputSchema.properties.resolved.type, 'boolean');
  assert.equal(byName('propose_run').inputSchema.properties.commentIds.type, 'array');
  for (const n of ['list_diff_comments', 'add_diff_comment', 'resolve_diff_comment', 'delete_diff_comment']) {
    assert.equal(byName(n).inputSchema.additionalProperties, false);
    assert.ok(byName(n).description.length > 20);
  }
});

test('add_diff_comment: author ask, anchor validated, line_text captured, then listed with context', async () => {
  const { tools, run } = await realTools();
  const added = await tools.call('add_diff_comment', { id: run.id, path: 'src/a.js', side: 'new', line: 3, body: 'flaky' });
  assert.match(added.comment.id, /^dc_[0-9a-f]{8}$/);
  assert.equal(added.comment.author, 'ask');
  assert.equal(added.comment.lineText, 'added');
  assert.equal(added.comment.runId, run.id, 'the reducer poke reads this');
  const listed = await tools.call('list_diff_comments', { id: run.id });
  assert.equal(listed.comments.length, 1);
  assert.equal(listed.comments[0].lineText, 'added');
  // radius 3 around index 3 of a 5-row hunk clips to the whole hunk.
  assert.deepEqual(listed.comments[0].context, [' keep', '-old', '+new', '+added', ' line3']);
  assert.equal(listed.comments[0].projectKey, null, 'always present so anchors round-trip');
  assert.equal(listed.patchAvailable, true);
});

test('add_diff_comment: a bad anchor is an AskToolError the model can act on', async () => {
  const { tools, run } = await realTools();
  for (const [input, re] of [
    [{ id: run.id, path: 'ghost.js', side: 'new', line: 1, body: 'x' }, /not a file of this run's diff/],
    [{ id: run.id, path: 'src/a.js', side: 'new', line: 99, body: 'x' }, /no new-side line 99/],
    [{ id: run.id, path: '.env', side: 'new', line: 1, body: 'x' }, /protected path/],
    [{ id: run.id, path: 'src/a.js', side: 'new', line: 1, body: 'x', memberProjectKey: 'p-00000001' }, /single project/],
  ]) {
    await assert.rejects(() => tools.call('add_diff_comment', input),
      (e) => { assert.equal(e.name, 'AskToolError'); assert.match(e.message, re); return true; }, JSON.stringify(input));
  }
  await assert.rejects(() => tools.call('add_diff_comment', { id: 'aaaaaaaa', path: 'a', side: 'new', line: 1, body: 'x' }),
    { message: 'add_diff_comment: run not found' });
});

test('list_diff_comments: status filter, path filter, and a comment on a NOW-protected file is omitted', async () => {
  const { tools, run } = await realTools();
  const keep = await tools.call('add_diff_comment', { id: run.id, path: 'src/a.js', side: 'new', line: 2, body: 'keep' });
  // ok.txt is innocent under the secure preset, so this write succeeds; a NARROWED
  // tool bundle then proves the READ filter is the authority.
  addDiffComment({ storeKey: run.key, pipelineId: run.id, patchText: PATCH,
    path: 'ok.txt', side: 'new', line: 1, body: 'later-protected', author: 'user' });
  assert.equal((await tools.call('list_diff_comments', { id: run.id })).comments.length, 2, 'both visible today');
  const narrowed = createAskTools({
    ...defaultToolDeps({ threadId: 'ask_00000001' }), ...defaultCommentDeps(),
    protectedPaths: [...GUARDRAIL_PRESETS.secure.protectedPaths, 'ok.txt'],
  });
  assert.deepEqual((await narrowed.call('list_diff_comments', { id: run.id })).comments.map((c) => c.body), ['keep']);
  // The read filter is not list-only: resolve_diff_comment echoes path and line_text
  // too, so it re-checks as well (D5, "the read is the authority"). Without this a
  // comment created before the preset grew stays echoable by id.
  const hidden = listDiffComments(run.key, run.id).find((c) => c.path === 'ok.txt');
  await assert.rejects(() => narrowed.call('resolve_diff_comment', { commentId: hidden.id }),
    { message: 'resolve_diff_comment: comment not found' }, 'a now-protected comment is not echoable by id');
  assert.equal(getDiffComment(hidden.id).resolved, false, 'and it was not mutated either');
  // The schema is advisory (mcp-stdio validates only that `arguments` is an object),
  // so a non-boolean must be refused rather than coerced to "resolve".
  await assert.rejects(() => tools.call('resolve_diff_comment', { commentId: keep.comment.id, resolved: 'false' }),
    { message: 'resolve_diff_comment: resolved must be true or false' });
  assert.equal((await tools.call('list_diff_comments', { id: run.id, status: 'resolved' })).comments.length, 0);
  await tools.call('resolve_diff_comment', { commentId: keep.comment.id });
  assert.equal((await tools.call('list_diff_comments', { id: run.id, status: 'resolved' })).comments.length, 1);
  assert.equal((await tools.call('list_diff_comments', { id: run.id, path: 'src/a.js' })).comments.length, 1);
  await assert.rejects(() => tools.call('list_diff_comments', { id: run.id, status: 'nope' }),
    { message: 'list_diff_comments: status must be all, unresolved or resolved' });
});

test('list_diff_comments: body, line_text and context all go through redact()', async () => {
  const { tools, run } = await realTools();
  await tools.call('add_diff_comment', { id: run.id, path: 'src/a.js', side: 'new', line: 2,
    body: 'pasted ghp_abcdefghijklmnopqrstuvwxyz0123456789 by mistake' });
  const out = await tools.call('list_diff_comments', { id: run.id });
  assert.doesNotMatch(JSON.stringify(out), /ghp_abcdefghijklmnopqrstuvwxyz/);
});

test('resolve_diff_comment toggles; delete_diff_comment is permanent; unknown ids are tool errors', async () => {
  const { tools, run } = await realTools();
  const c = (await tools.call('add_diff_comment', { id: run.id, path: 'src/a.js', side: 'old', line: 2, body: 'x' })).comment;
  assert.equal((await tools.call('resolve_diff_comment', { commentId: c.id })).comment.resolved, true);
  assert.equal((await tools.call('resolve_diff_comment', { commentId: c.id, resolved: false })).comment.resolved, false);
  const gone = await tools.call('delete_diff_comment', { commentId: c.id });
  // The `comment` echo carries the run the poke needs — the shape is FINAL here.
  assert.deepEqual(gone, { ok: true, commentId: c.id, comment: { runId: run.id, storeKey: run.key } });
  assert.equal(getDiffComment(c.id), null);
  await assert.rejects(() => tools.call('delete_diff_comment', { commentId: c.id }),
    { message: 'delete_diff_comment: comment not found' });
  await assert.rejects(() => tools.call('resolve_diff_comment', { commentId: '' }),
    { message: 'resolve_diff_comment: commentId is required' });
  await assert.rejects(() => tools.call('resolve_diff_comment', { commentId: 'nope' }),
    { message: 'resolve_diff_comment: comment not found' });
});

test('list_diff_comments: a patch-less run still lists, just without context', async () => {
  const { run } = await realTools();
  const withPatch = createAskTools({ ...defaultToolDeps({ threadId: 'ask_00000001' }), ...defaultCommentDeps() });
  await withPatch.call('add_diff_comment', { id: run.id, path: 'src/a.js', side: 'new', line: 1, body: 'x' });
  const noPatch = createAskTools({
    ...defaultToolDeps({ threadId: 'ask_00000001' }), ...defaultCommentDeps(),
    readDiffPatch: async () => null,
  });
  const out = await noPatch.call('list_diff_comments', { id: run.id });
  assert.equal(out.patchAvailable, false);
  assert.equal(out.comments[0].lineText, 'keep', 'the snapshot is always present');
  assert.equal(out.comments[0].context, undefined, 'context is omitted, never faked');
});

test('source scan: tools.mjs is still write-free and db-free; comment-deps holds only the comment bundle', () => {
  const tools = readFileSync(new URL('../src/core/ask/tools.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(tools, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(tools, /from '\.\.\/db\.mjs'|getDb\(|\btx\(|node:sqlite/);
  assert.equal(tools.split('\n').filter((l) => /^import /.test(l)).length, 0, 'tools.mjs stays import-free');
  const deps = readFileSync(new URL('../src/core/ask/comment-deps.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(deps, /node:sqlite|from '\.\.\/db\.mjs'/);
  assert.ok(deps.includes("from '../diff-comments.mjs'"), 'writes go through the one mutation module');
  const stdio = readFileSync(new URL('../src/core/ask/mcp-stdio.mjs', import.meta.url), 'utf8');
  // Match the WIRING, not the import line (the ask-worktree-tools precedent).
  assert.match(stdio, /createAskTools\(\{[\s\S]*?defaultCommentDeps/, 'the MCP child spreads the comment bundle');
});

// A row persisted BEFORE Task 2's anchor fix keeps its quoted old_path, and the
// read filter re-tests that literal — so `"a/old\tsecret.pem"` sails past `*.pem`
// and the model gets line_text + context for a file get_run_diff refuses to show.
// Simulated with a raw UPDATE because add_diff_comment can no longer create one.
test('the read filter unquotes, so a legacy C-quoted path is still refused', async () => {
  const { tools, run } = await realTools();
  const c = (await tools.call('add_diff_comment',
    { id: run.id, path: 'src/a.js', side: 'new', line: 3, body: 'legacy' })).comment;
  getDb().prepare('UPDATE diff_comments SET old_path = ? WHERE id = ?')
    .run('"a/old\\tsecret.pem"', c.id);

  const listed = await tools.call('list_diff_comments', { id: run.id });
  assert.deepEqual(listed.comments.map((x) => x.id), [],
    'the quoted old path is unquoted before the glob test, so the row is dropped');
  await assert.rejects(() => tools.call('resolve_diff_comment', { commentId: c.id }),
    { message: 'resolve_diff_comment: comment not found' },
    'and it is not echoable by id either');
});

test('delete_diff_comment applies the SAME protected-path guard as resolve, and never touches a user comment', async () => {
  const { tools, run } = await realTools();
  // m1: innocent under today's preset, so the write succeeds; a NARROWED bundle
  // then proves delete re-checks at read time exactly as list and resolve do.
  const doomed = addDiffComment({ storeKey: run.key, pipelineId: run.id, patchText: PATCH,
    path: 'ok.txt', side: 'new', line: 1, body: 'later-protected', author: 'ask' });
  const narrowed = createAskTools({
    ...defaultToolDeps({ threadId: 'ask_00000001' }), ...defaultCommentDeps(),
    protectedPaths: [...GUARDRAIL_PRESETS.secure.protectedPaths, 'ok.txt'],
  });
  await assert.rejects(() => narrowed.call('delete_diff_comment', { commentId: doomed.id }),
    { message: 'delete_diff_comment: comment not found' },
    'a comment the guard hides is not destroyable by id either');
  assert.ok(getDiffComment(doomed.id), 'and the row is still there');
  // Same text as resolve's refusal: the guard must not become an existence oracle.
  await assert.rejects(() => narrowed.call('delete_diff_comment', { commentId: 'dc_00000000' }),
    { message: 'delete_diff_comment: comment not found' });

  // M4: the user's own notes are not the model's to destroy — injected text in a
  // diff or a run prompt reaches the model, and this is the only capability that
  // was irreversible. The user still deletes them from the Diff tab.
  const mine = addDiffComment({ storeKey: run.key, pipelineId: run.id, patchText: PATCH,
    path: 'src/a.js', side: 'new', line: 2, body: 'my note', author: 'user' });
  await assert.rejects(() => tools.call('delete_diff_comment', { commentId: mine.id }),
    /only comments Ask wrote can be deleted/);
  assert.ok(getDiffComment(mine.id), 'still there');
  assert.equal((await tools.call('resolve_diff_comment', { commentId: mine.id })).comment.resolved, true,
    'resolve is still allowed on a user comment — that is the 90% case');

  // Ask's own comment still deletes, with the response shape unchanged.
  const ok = (await tools.call('add_diff_comment', { id: run.id, path: 'src/a.js', side: 'new', line: 3, body: 'x' })).comment;
  assert.deepEqual(await tools.call('delete_diff_comment', { commentId: ok.id }),
    { ok: true, commentId: ok.id, comment: { runId: run.id, storeKey: run.key } });
  assert.equal(getDiffComment(ok.id), null);
});

test('list_diff_comments hands the protected filter DOWN, so a guarded row never costs a parse', async () => {
  const { run } = await realTools();
  const real = defaultCommentDeps();
  const base = defaultToolDeps({ threadId: 'ask_00000001' });
  await createAskTools({ ...base, ...real }).call('add_diff_comment', { id: run.id, path: 'src/a.js', side: 'new', line: 2, body: 'keep' });
  addDiffComment({ storeKey: run.key, pipelineId: run.id, patchText: PATCH,
    path: 'ok.txt', side: 'new', line: 1, body: 'later-protected', author: 'user' });
  let opts = null;
  const narrowed = createAskTools({
    ...base,
    comments: { ...real.comments, list: (k, id, o) => { opts = o; return real.comments.list(k, id, o); } },
    protectedPaths: [...GUARDRAIL_PRESETS.secure.protectedPaths, 'ok.txt'],
  });
  const out = await narrowed.call('list_diff_comments', { id: run.id });
  assert.deepEqual(out.comments.map((c) => c.body), ['keep'], 'the guarded row is still omitted');
  // The BEHAVIOUR m6 is about: the bundle never even builds a context for the row
  // it is going to drop. Asserted at the bundle's own seam, not by spying on the
  // call, because the wasted parse is invisible from the tool's output.
  assert.equal(opts.keep({ path: 'ok.txt', oldPath: null }), false, 'the caller\'s guard reached the bundle');
  // The bundle itself drops before it maps, so no context object is ever built
  // for the row it drops.
  const rows = real.comments.list(run.key, run.id, { patchText: PATCH, keep: (c) => c.path !== 'ok.txt' });
  assert.deepEqual(rows.map((r) => r.path), ['src/a.js']);
  assert.ok(Array.isArray(rows[0].context) && rows[0].context.length, 'the kept row still gets its context');
});
