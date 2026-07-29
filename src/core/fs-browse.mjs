// src/core/fs-browse.mjs
// Read-only directory listing for the web UI's in-app folder browser (the
// fallback when the native OS dialog is unavailable). Lists ONLY directories —
// it is a folder picker, files are never shown — and hides dotfolders. Worca CC
// is a localhost-only single-user tool (isLocalRequest in ui/server.mjs), so
// this exposes exactly the same trust level as the manual path field it backs.

import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { normalizeProjectPath } from './projects.mjs';
import { defaultRoot } from './settings.mjs';

function err(message, code) { return Object.assign(new Error(message), { code }); }

/**
 * List the sub-directories of `input` (tilde-expanded, resolved). Empty input
 * lists the OS home directory (normalizeProjectPath returns null for blank
 * input, so this can never fall through to process.cwd()).
 * @param {string} input
 * @returns {Promise<{path:string, parent:string|null, home:string,
 *   dirs:Array<{name:string, path:string}>}>} parent is null at the fs root.
 * @throws {Error & {code:'BAD_REQUEST'}} when the path does not exist, is not
 *   a directory, or cannot be read.
 */
export async function listFolders(input) {
  const home = resolve(defaultRoot());
  const path = normalizeProjectPath(input) || home;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') throw err(`no such directory: ${path}`, 'BAD_REQUEST');
    if (e.code === 'ENOTDIR') throw err(`not a directory: ${path}`, 'BAD_REQUEST');
    if (e.code === 'EACCES' || e.code === 'EPERM') throw err(`permission denied: ${path}`, 'BAD_REQUEST');
    throw err(`cannot read directory: ${e.message}`, 'BAD_REQUEST');
  }
  const dirs = [];
  for (const d of entries) {
    if (d.name.startsWith('.')) continue;
    let isDir = d.isDirectory();
    if (!isDir && d.isSymbolicLink()) {
      try { isDir = (await stat(join(path, d.name))).isDirectory(); } catch { isDir = false; }
    }
    if (isDir) dirs.push({ name: d.name, path: join(path, d.name) });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const parent = dirname(path);
  return { path, parent: parent === path ? null : parent, home, dirs };
}
