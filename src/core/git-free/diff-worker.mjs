// src/core/git-free/diff-worker.mjs
// The update review's text diffs (plugin-repo.mjs treeChanges), off the server's thread: one file's jsdiff runs for up to
// its time budget, and the server answers nothing while it does. One message per file, answered in order: the hunk lines,
// or null past jsdiff's edit/time budget.
import { parentPort } from 'node:worker_threads';
import { structuredPatch } from 'diff';

const hunkRange = (start, n) => (n === 0 ? `${start - 1},0` : n === 1 ? `${start}` : `${start},${n}`);

parentPort.on('message', ({ oldText, newText, options }) => {
  const patch = structuredPatch('', '', oldText, newText, '', '', options);
  parentPort.postMessage(patch === undefined ? null
    : patch.hunks.flatMap((h) => [`@@ -${hunkRange(h.oldStart, h.oldLines)} +${hunkRange(h.newStart, h.newLines)} @@`, ...h.lines]));
});
