// src/core/preflight-host.mjs
// Startup preflight for WHERE the UI server runs from. Worca deletes a run's
// folders on its own: Discard, the checkout cap, archive, discarding retained
// work, freeBranchCheckout and the boot sweeps. A server started from one of
// those folders loses its own agents/ and ui/public/ but keeps running: every
// page answers 500 and every run fails preflight with `agent "implementer" is
// not installed`. Refusing to start there covers every removal path at once.

import fs from 'node:fs';
import path from 'node:path';

/** The resolved real path of `p`, or `p` resolved when it does not exist yet. */
function real(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function isUnder(child, parent) {
  return child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

/**
 * The run folder that `codeRoot` sits in, or null. Run folders are
 * `<worcaHome>/runs/*` (detached run roots and on-demand checkouts) and
 * `<project>/.worca-cc/worktrees/*` (legacy run worktrees).
 */
export function runFolderHosting(codeRoot, worcaHome) {
  const root = real(codeRoot);
  const runs = real(path.join(worcaHome, 'runs'));
  if (isUnder(root, runs)) return path.join(runs, path.relative(runs, root).split(path.sep)[0]);
  const legacy = `${path.sep}.worca-cc${path.sep}worktrees${path.sep}`;
  const at = root.indexOf(legacy);
  if (at === -1) return null;
  const rest = root.slice(at + legacy.length).split(path.sep)[0];
  return rest ? root.slice(0, at + legacy.length) + rest : null;
}
