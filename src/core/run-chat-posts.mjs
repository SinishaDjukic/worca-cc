// src/core/run-chat-posts.mjs — cross-chat messaging slice 2, the run side: an agent step writes updates for a chat
// into a per-execution file the orchestrator reads after the agent exits (the same file protocol as the questions
// file). Pure except readChatPosts, which reads the agent-written file without following a link.
import { join } from 'node:path';
import { readRegularText } from './folder-copy.mjs';
import { safeParseJson } from './protocol.mjs';
import { NIGHT_ACTOR } from './night/config.mjs';
import { NETWORK_ACTOR } from './network-wait.mjs';

/** At most this many posts are taken per read; the rest are dropped and counted. */
export const RUN_CHAT_POSTS_MAX = 5;

/** `resolvePending` reasons that mean "answered, or not ours to close": the chat record stays as it is. */
export const RUN_QUESTION_KEEP_REASONS = new Set(['answered', 'night-mode', 'network-back', 'resolved']);

/** Absolute chat-posts file of one execution: chat-posts-x-<nodeIdSafe>-c<ordinal>.json (the _questionsPath rule). */
export function chatPostsPath(pipelineDir, nodeId, ordinal) {
  const nodeIdSafe = String(nodeId).replace(/[^A-Za-z0-9_-]/g, '_');
  return join(pipelineDir, `chat-posts-x-${nodeIdSafe}-c${ordinal}.json`);
}

/**
 * Read one chat-posts file. A missing file is "nothing to post"; a link, a FIFO, any read error, bad JSON or a top
 * level without a `posts` array is `malformed`. Entries that are not `{chatId:string, text:string}` and entries past
 * the 5th are counted in `dropped`. The id format is not checked here: the messenger refuses it with a code.
 * @returns {Promise<{posts:Array<{chatId:string, text:string}>, dropped:number, malformed:boolean}>}
 */
export async function readChatPosts(absPath) {
  let text;
  try {
    text = await readRegularText(absPath);
  } catch (e) {
    return { posts: [], dropped: 0, malformed: e?.code !== 'ENOENT' };
  }
  const parsed = safeParseJson(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.posts)) return { posts: [], dropped: 0, malformed: true };
  const posts = [];
  let dropped = 0;
  for (const e of parsed.posts) {
    const valid = !!e && typeof e === 'object' && typeof e.chatId === 'string' && typeof e.text === 'string';
    if (!valid || posts.length >= RUN_CHAT_POSTS_MAX) { dropped += 1; continue; }
    posts.push({ chatId: e.chatId, text: e.text });
  }
  return { posts, dropped, malformed: false };
}

/** The agent prompt's chat-posts section; '' unless the step may post (prompts stay byte-identical when off). */
export function chatPostsPromptBlock(ctx) {
  if (!ctx || !ctx.chatPostsEnabled || !ctx.chatPostsFile) return '';
  return (
    '\n\n## Posting to a chat (enabled)\n\n' +
    'You can post short updates into a worca chat. Write ' +
    '{"posts":[{"chatId":"ask_<8 hex>","text":"…"}]} ' +
    `(at most ${RUN_CHAT_POSTS_MAX} posts, each text at most 4000 characters) to: ${ctx.chatPostsFile}\n` +
    'Name only chat ids the task gives you; never guess one.\n' +
    'Keep working after writing the file: the posts go out when you finish.\n' +
    (ctx.questionsEnabled
      ? 'To ask your questions in a chat too, add "chat":"ask_<8 hex>" to the questions JSON.\n'
      : '')
  );
}

/** The chat record's actor for a run's `answeredBy` value. */
export function actedByOf(answeredBy) {
  const by = typeof answeredBy === 'string' ? answeredBy : '';
  if (by === NIGHT_ACTOR) return { kind: 'away', label: 'Away mode' };
  if (by === NETWORK_ACTOR) return { kind: 'worca', label: by };
  if (by) return { kind: 'person', label: by };
  return { kind: 'worca', label: 'worca' };
}
