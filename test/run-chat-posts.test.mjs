// test/run-chat-posts.test.mjs — cross-chat messaging slice 2, the run side's pure helpers
// (src/core/run-chat-posts.mjs): the chat-posts file reader, its prompt block, the actor mapping and the keep set.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  RUN_CHAT_POSTS_MAX, RUN_QUESTION_KEEP_REASONS, chatPostsPath, readChatPosts, chatPostsPromptBlock, actedByOf,
} from '../src/core/run-chat-posts.mjs';

const dirs = [];
async function tmp() { const d = await mkdtemp(join(tmpdir(), 'worca-chatposts-')); dirs.push(d); return d; }
after(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));

const post = (n) => ({ chatId: 'ask_0000abcd', text: `update ${n}` });

test('chatPostsPath: per-execution name in the pipeline dir, node id made safe', () => {
  assert.equal(chatPostsPath('/p', 'n_plan', 2), join('/p', 'chat-posts-x-n_plan-c2.json'));
  assert.equal(basename(chatPostsPath('/p', '../x y', 1)), 'chat-posts-x-___x_y-c1.json');
});

test('readChatPosts: valid, malformed, skipped entries, the 5 cap, missing, symlink', async () => {
  const d = await tmp();
  const ok = join(d, 'ok.json');
  await writeFile(ok, JSON.stringify({ posts: [post(1), post(2)] }));
  assert.deepEqual(await readChatPosts(ok), { posts: [post(1), post(2)], dropped: 0, malformed: false });

  const bad = join(d, 'bad.json');
  await writeFile(bad, 'not json');
  assert.deepEqual(await readChatPosts(bad), { posts: [], dropped: 0, malformed: true });
  const noArr = join(d, 'noarr.json');
  await writeFile(noArr, JSON.stringify({ posts: 'x' }));
  assert.equal((await readChatPosts(noArr)).malformed, true);

  const skip = join(d, 'skip.json');
  await writeFile(skip, JSON.stringify({ posts: [post(1), { chatId: 'ask_0000abcd' }] }));
  assert.deepEqual(await readChatPosts(skip), { posts: [post(1)], dropped: 1, malformed: false });

  const many = join(d, 'many.json');
  await writeFile(many, JSON.stringify({ posts: [1, 2, 3, 4, 5, 6, 7].map(post) }));
  const m = await readChatPosts(many);
  assert.equal(m.posts.length, RUN_CHAT_POSTS_MAX);
  assert.equal(m.dropped, 2);

  const extra = join(d, 'extra.json');
  await writeFile(extra, JSON.stringify({ posts: [{ ...post(1), runId: 'ffffffff', from: { kind: 'run' } }] }));
  assert.deepEqual((await readChatPosts(extra)).posts, [post(1)], 'extra keys are dropped');

  assert.deepEqual(await readChatPosts(join(d, 'nope.json')), { posts: [], dropped: 0, malformed: false });

  const link = join(d, 'link.json');
  await symlink(ok, link);
  assert.deepEqual(await readChatPosts(link), { posts: [], dropped: 0, malformed: true }, 'a symlink is never followed');
});

test('chatPostsPromptBlock: empty when off or no file; the file and the chat sentence when on', () => {
  assert.equal(chatPostsPromptBlock({ chatPostsEnabled: false, chatPostsFile: '/p/f.json' }), '');
  assert.equal(chatPostsPromptBlock({ chatPostsEnabled: true }), '');
  assert.equal(chatPostsPromptBlock(null), '');
  const on = chatPostsPromptBlock({ chatPostsEnabled: true, chatPostsFile: '/p/f.json' });
  assert.match(on, /## Posting to a chat \(enabled\)/);
  assert.ok(on.includes('/p/f.json'));
  assert.ok(on.includes('{"posts":[{"chatId":"ask_<8 hex>","text":"…"}]}'));
  assert.ok(!on.includes('"chat":"ask_<8 hex>"'), 'no questions sentence while questions are off');
  const withQ = chatPostsPromptBlock({ chatPostsEnabled: true, chatPostsFile: '/p/f.json', questionsEnabled: true });
  assert.ok(withQ.includes('"chat":"ask_<8 hex>"'));
});

test('actedByOf maps the run attribution to the record actor', () => {
  assert.deepEqual(actedByOf('night-mode'), { kind: 'away', label: 'Away mode' });
  assert.deepEqual(actedByOf('ada@x'), { kind: 'person', label: 'ada@x' });
  assert.deepEqual(actedByOf(''), { kind: 'worca', label: 'worca' });
  assert.deepEqual(actedByOf(null), { kind: 'worca', label: 'worca' });
  assert.deepEqual(actedByOf('worca (network watch)'), { kind: 'worca', label: 'worca (network watch)' });
});

test('RUN_QUESTION_KEEP_REASONS holds exactly the four keep reasons', () => {
  assert.deepEqual([...RUN_QUESTION_KEEP_REASONS].sort(), ['answered', 'network-back', 'night-mode', 'resolved']);
});
