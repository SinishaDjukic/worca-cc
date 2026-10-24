// src/core/ask/file-deps.mjs
// Worca's read-only file tools for Codex chats (cascading-settings-design.md D13, §4.6): read_file, grep, glob.
// A locked-down chat (every engine but Claude: Codex, Copilot, Gemini CLI, Qwen Code) has no file tool of its own, so these are its ONLY view of the disk. The reader itself is
// file-reader.mjs; this module adds the chat's roots under the Worca home (plus, for a turn with set skills, that
// message's skill mount). Present in the MCP child only for a
// locked-down chat (WORCA_ASK_ENGINE names its engine); a Claude chat keeps its native Read/Grep/Glob.
import { join, isAbsolute, resolve, dirname, basename } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { createAskFileReader } from './file-reader.mjs';
import { lockedChatEngine } from '../model-env.mjs';
import { ENGINES, chatEnginesTaking } from '../../shared/engine-switch.mjs';

export { AskFileError, ASK_FILE_LIMITS, createAskFileReader } from './file-reader.mjs';

const THREAD_RE = /^ask_[0-9a-f]{8}$/;
const MESSAGE_RE = /^askm_[0-9a-f]{8}$/;

/** The roots a Codex chat may read: its worktrees, its attachments, the memory mount — and, for a turn with set skills
 *  (#635), `skillRoot`: that message's mount. Only a path that is exactly `<home>/ask/<this thread>/skills/<message id>`
 *  is taken, never the thread's whole skills folder or another chat's; anything else is dropped. */
export function askFileRoots({ home = worcaHome(), threadId, skillRoot = null } = {}) {
  if (typeof threadId !== 'string' || !THREAD_RE.test(threadId)) return [];
  const roots = [join(home, 'ask', threadId, 'wt'), join(home, 'ask', threadId, 'att'), join(home, 'ask', 'memory')];
  if (typeof skillRoot === 'string' && isAbsolute(skillRoot) && resolve(skillRoot) === skillRoot
    && dirname(skillRoot) === join(home, 'ask', threadId, 'skills') && MESSAGE_RE.test(basename(skillRoot))) roots.push(skillRoot);
  return roots;
}

/** The MCP child's file bundle: present only for a locked-down chat, whose own file tools are off (the parent sets
 *  WORCA_ASK_ENGINE in the child's env). */
export function defaultFileDeps({ threadId = null, env = process.env, signal = null } = {}) {
  if (!env || !lockedChatEngine(env.WORCA_ASK_ENGINE)) return {};
  // chatImages / chatPdfs: whether this chat's engine forwards an image / a PDF block of a tool result to its model
  // (read_attachment and read_file send them); mediaElsewhere names the chats that do, for the note when it does not.
  const chat = ENGINES[env.WORCA_ASK_ENGINE].chat;
  return { engine: env.WORCA_ASK_ENGINE, chatImages: chat.images === true, chatPdfs: chat.pdfs === true,
    mediaElsewhere: (what) => `${chatEnginesTaking(what)} chats can`,
    // Where a media block reaches this engine's model, in its own words (engine-switch.mjs `chat.media`).
    mediaNote: typeof chat.media === 'string' ? (kind) => chat.media.replace('{kind}', kind) : null,
    files: createAskFileReader({ roots: askFileRoots({ threadId, skillRoot: env.WORCA_ASK_SKILL_ROOT || null }), signal }) };
}
