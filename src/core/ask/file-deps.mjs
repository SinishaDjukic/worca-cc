// src/core/ask/file-deps.mjs
// Worca's read-only file tools for Codex chats (cascading-settings-design.md D13, §4.6): read_file, grep, glob.
// Codex has no permission engine, so these are a Codex chat's ONLY view of the disk. The reader itself is
// file-reader.mjs; this module adds the chat's roots under the Worca home. Present in the MCP child only for a
// Codex chat (WORCA_ASK_ENGINE=codex); a Claude chat keeps its native Read/Grep/Glob.
import { join } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { createAskFileReader } from './file-reader.mjs';

export { AskFileError, ASK_FILE_LIMITS, createAskFileReader } from './file-reader.mjs';

const THREAD_RE = /^ask_[0-9a-f]{8}$/;

/** The three roots a Codex chat may read: its worktrees, its attachments, the memory mount. */
export function askFileRoots({ home = worcaHome(), threadId } = {}) {
  if (typeof threadId !== 'string' || !THREAD_RE.test(threadId)) return [];
  return [join(home, 'ask', threadId, 'wt'), join(home, 'ask', threadId, 'att'), join(home, 'ask', 'memory')];
}

/** The MCP child's file bundle: present only for a Codex chat (the parent sets WORCA_ASK_ENGINE=codex in the child's env). */
export function defaultFileDeps({ threadId = null, env = process.env, signal = null } = {}) {
  if (!env || env.WORCA_ASK_ENGINE !== 'codex') return {};
  return { engine: 'codex', files: createAskFileReader({ roots: askFileRoots({ threadId }), signal }) };
}
