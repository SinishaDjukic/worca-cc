// src/core/actions/editor-target.mjs — the file the Diff tab's open-in-editor route may open
// (POST /api/runs/:id/open-in-editor, docs/actions.md). A run-relative path is checked for its
// shape, against the protected-path floor, and (after realpath) for staying inside the run's folder.
// Every refusal is an Error with .code: BAD_PATH, PROTECTED_PATH or FILE_NOT_FOUND.
import { realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { refusePathShape, isInside } from '../ask-files.mjs';
import { isSecretPath as isProtectedBasename } from '../secret-paths.mjs';
import { SECURE_PROTECTED_PATHS } from '../diff-anchor.mjs';

const fail = (code, message) => Object.assign(new Error(message), { code });

/**
 * @param {string} folder the run's folder the editor opens (worktree or checkout)
 * @param {string} rel the file, relative to `folder`, `/`-separated
 * @returns {Promise<{ abs: string }>} the lexical path under `folder`
 */
export async function resolveEditorFile(folder, rel, { platform = process.platform } = {}) {
  if (refusePathShape(rel) || (platform === 'win32' && rel.includes('%'))) {
    throw fail('BAD_PATH', `"${rel}" is not a path inside the run's folder.`);
  }
  if (isProtectedBasename(rel, SECURE_PROTECTED_PATHS)) {
    throw fail('PROTECTED_PATH', `"${rel}" is a protected path. Worca does not open credential files.`);
  }
  const abs = join(folder, ...rel.split('/'));
  let root; let real;
  try {
    root = await realpath(folder);
    real = await realpath(abs);
    if (!(await stat(real)).isFile()) real = null;
  } catch { real = null; }
  if (!real) throw fail('FILE_NOT_FOUND', `"${rel}" is not in the run's folder.`);
  if (!isInside(root, real, { fold: platform === 'darwin' || platform === 'win32' })) {
    throw fail('BAD_PATH', `"${rel}" leads outside the run's folder.`);
  }
  return { abs };
}
