// src/core/ask/comment-deps.mjs
// The WRITE-CAPABLE dep bundle of the diff-comment tools. Deliberately separate
// from tool-deps.mjs, whose source is scanned as read-only
// (test/ask-tools.test.mjs): every row that is created, resolved or deleted is
// reachable ONLY through here, and test/ask-diff-comment-tools.test.mjs pins this
// module's import surface. Same shape as worktree-deps.mjs — one namespaced
// sub-object.
//
// Everything writes through src/core/diff-comments.mjs — the one mutation module —
// so the MCP path and the REST path share anchor validation, the body cap and the
// change notification. Reads add the surrounding hunk lines here (tools.mjs has no
// imports at all); tools.mjs owns the protected-path filter and the redaction, so
// the fail-closed read rules live next to get_run_diff's.
import {
  addDiffComment, listDiffComments, getDiffComment, setDiffCommentResolved, deleteDiffComment,
} from '../diff-comments.mjs';
import { hunkContext } from '../diff-anchor.mjs';

/** Rows either side of an anchor served to the model. */
export const COMMENT_CONTEXT_RADIUS = 3;

// COST NOTE, deliberate: hunkContext() re-runs splitPatchSections + patchIndex +
// parseFileSection over the WHOLE patch once per comment, so listing N comments
// on a run costs N full parses. That is the price of using the ONE parser (D3)
// instead of a second, faster, divergent one. It is bounded in practice — this
// runs in the MCP child, once per tool call, on runs with a handful of comments
// — and the REST list path does not do it at all. If a real run ever makes this
// hurt, memoize the parsed index per (patchText) inside this closure; do NOT
// hand-roll a cheaper scan.

/** No thread scoping: comments belong to RUNS, not to chat threads. */
export function defaultCommentDeps() {
  return {
    comments: {
      /** Comments of a run, each with `context` when the patch is readable. */
      list: (storeKey, pipelineId, { status = 'all', path = null, patchText = null } = {}) =>
        listDiffComments(storeKey, pipelineId, { status, path }).map((c) => (patchText == null ? c : {
          ...c,
          context: hunkContext(patchText, { project: c.projectKey, path: c.path, side: c.side, line: c.line },
            COMMENT_CONTEXT_RADIUS),
        })),
      add: (input) => addDiffComment({ ...input, author: 'ask' }),
      get: (id) => getDiffComment(id),
      setResolved: (id, resolved) => setDiffCommentResolved(id, resolved),
      remove: (id) => deleteDiffComment(id),
    },
  };
}
