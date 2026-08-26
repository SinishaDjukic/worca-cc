// src/core/ask/worktree-deps.mjs
// The WRITE-CAPABLE dep bundle of the worktree tools (ask-worca-worktrees-
// design.md §8). Deliberately separate from tool-deps.mjs, whose source is
// scanned as read-only: everything that creates/removes checkouts or updates
// ask_worktrees rows is reachable ONLY through here, and
// test/ask-worktree-tools.test.mjs pins this module's import surface.
import {
  openAskWorktree, listAskWorktrees, getAskWorktree, removeAskWorktree,
  noteWorktreeNavigation,
} from './worktrees.mjs';
import { runGitCapture } from '../worktree.mjs';
import { validateGitArgs } from './git-allowlist.mjs';

/** @param {{threadId:string}} opts  every operation is scoped to this thread */
export function defaultWorktreeDeps({ threadId }) {
  return {
    worktrees: {
      open: (input) => openAskWorktree({ ...input, threadId }),
      list: () => listAskWorktrees(threadId),
      get: (wtId) => getAskWorktree(threadId, wtId),
      remove: (wtId) => removeAskWorktree({ threadId, wtId }),
      noteNav: (wtId, patch) => noteWorktreeNavigation(threadId, wtId, patch),
      runGit: (cwd, args, opts) => runGitCapture(cwd, args, opts),   // opts passthrough (timeout) for callers; the tool dispatcher passes none today
      validateGitArgs,
    },
  };
}
