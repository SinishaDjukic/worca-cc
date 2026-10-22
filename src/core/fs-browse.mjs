// src/core/fs-browse.mjs
// Read-only directory listing for the web UI's in-app folder browser (the
// fallback when the native OS dialog is unavailable). Lists ONLY directories —
// it is a folder picker, files are never shown — and hides dotfolders. Worca CC
// is a localhost-only single-user tool (isLocalRequest in ui/server.mjs), so
// this exposes exactly the same trust level as the manual path field it backs.
// On a hosted Worca with the terminal and actions off, the server passes `roots`
// (src/core/fs-scope.mjs) and the listing stays inside them.

import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { normalizeProjectPath } from './projects.mjs';
import { defaultRoot, getProjectsRoot, projectsRootSource } from './settings.mjs';
import { checkInside, insideRoots, isWithin, outsideAllowedError, realOrNull } from './fs-scope.mjs';

function err(message, code) { return Object.assign(new Error(message), { code }); }

/**
 * Where a blank listing opens: a CONFIGURED projects root (env or Settings) if it is a
 * directory, else home. The default (<worcaHome>/projects, U6) is never a start: a blank
 * Folder browse keeps opening at home, where people's projects are.
 */
async function startFolder(home) {
  if (projectsRootSource() === 'default') return home;
  const root = getProjectsRoot();
  try {
    if (root !== home && (await stat(root)).isDirectory()) return root;
  } catch { /* missing or unreadable root: fall back to home */ }
  return home;
}

/**
 * List the sub-directories of `input` (tilde-expanded, resolved). Empty input
 * lists a CONFIGURED projects root (env or Settings) when it is an existing
 * directory, else the OS home directory (normalizeProjectPath returns null for
 * blank input, so this can never fall through to process.cwd()). The default
 * root (<worcaHome>/projects, U6) is never a start: people's folders are under
 * home. In a container, WORCA_PROJECTS_ROOT names the mounted repos while home
 * is an empty /home/worca. `home` stays the OS home (the Home button).
 *
 * With `roots` (real paths from fs-scope.mjs#realRoots, at least one), the listing
 * is limited: the path is resolved through symlinks and must lie inside a root, a
 * blank listing opens a configured projects root (else the first root), `parent` is null at a
 * root, symlinked folders that lead outside are not listed, and the answer carries
 * `limited: true` and `roots` so the UI can offer them.
 * @param {string} input
 * @param {{roots?: string[]|null}} [opts]
 * @returns {Promise<{path:string, parent:string|null, home:string,
 *   dirs:Array<{name:string, path:string}>, limited?:true, roots?:string[]}>}
 *   parent is null at the fs root.
 * @throws {Error & {code:'BAD_REQUEST'}} when the path does not exist, is not
 *   a directory, or cannot be read.
 * @throws {Error & {code:'FS_OUTSIDE_ALLOWED'}} with `roots`, when the path is outside them.
 */
export async function listFolders(input, { roots = null } = {}) {
  if (Array.isArray(roots)) return listLimited(input, roots);
  const home = resolve(defaultRoot());
  const path = normalizeProjectPath(input) || await startFolder(home);
  const dirs = await readDirs(path);
  const parent = dirname(path);
  return { path, parent: parent === path ? null : parent, home, dirs };
}

async function listLimited(input, roots) {
  if (!roots.length) throw err('no folder can be browsed on this server', 'BAD_REQUEST');
  // As startFolder: only a CONFIGURED projects root is a start; with the default, the first root (the OS home).
  const projects = projectsRootSource() === 'default' ? null : await realOrNull(resolve(getProjectsRoot()));
  const home = projects && roots.some((r) => isWithin(projects, r)) ? projects : roots[0];
  const asked = normalizeProjectPath(input);
  let path = home;
  if (asked) {
    const { inside, real } = await checkInside(asked, roots);
    if (!inside) throw outsideAllowedError(asked);
    if (!real) throw err(`no such directory: ${asked}`, 'BAD_REQUEST');
    path = real;
  }
  const all = await readDirs(path);
  const dirs = [];
  for (const d of all) {
    const real = await realOrNull(d.path);
    if (real && insideRoots(real, roots)) dirs.push(d);
  }
  const parent = dirname(path);
  const atRoot = roots.includes(path) || parent === path || !roots.some((r) => isWithin(parent, r));
  return { path, parent: atRoot ? null : parent, home, dirs, limited: true, roots: [...roots] };
}

async function readDirs(path) {
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
  return dirs;
}
