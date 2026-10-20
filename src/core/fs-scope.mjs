// src/core/fs-scope.mjs
// Where a hosted Worca may browse and pick server folders. In remote mode with the
// terminal and actions off, a signed-in person must not be able to list (or register,
// or install into) any folder on the server: the folder browser and the routes that
// take a folder path are limited to Worca's own folders — the data dir (the Worca home)
// and the projects root. Containment is checked on REAL paths (symlinks and `..`
// resolved), so a link inside an allowed folder cannot lead out of it. Below a root, a
// hidden folder (a name starting with a dot: .ssh, .config, .git) counts as outside,
// and a root that is the filesystem root or a one-segment folder (/home, /usr, C:\Users)
// is never accepted, whatever the configuration falls back to.
// Pure besides fs reads; the server decides when the limit applies (ui/server.mjs).

import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export const FS_OUTSIDE_ALLOWED = 'FS_OUTSIDE_ALLOWED';

/** The message a refused path answers with: why, and how an administrator lifts it. */
export function outsideAllowedMessage(path) {
  return `${path} is outside Worca's data and projects folders. On a hosted Worca, folders can only be ` +
    'browsed and added inside those folders (hidden folders, whose names start with a dot, excluded) while ' +
    'the terminal and actions are off. An administrator can ' +
    'allow any folder with WORCA_TERMINAL_REMOTE=1 or WORCA_ACTIONS_REMOTE=1.';
}

export function outsideAllowedError(path) {
  return Object.assign(new Error(outsideAllowedMessage(path)), { code: FS_OUTSIDE_ALLOWED });
}

/** realpath, or null when the path does not exist or cannot be resolved. */
export async function realOrNull(p) {
  try { return await realpath(p); } catch { return null; }
}

/** True when `p` is `root` or lies below it. Both must be absolute and normalized. */
export function isWithin(p, root) {
  if (p === root) return true;
  const base = root.endsWith(sep) ? root : root + sep;
  return p.startsWith(base);
}

/** The path's segments, a Windows drive (C:) or UNC host/share not counted. */
function segments(p) {
  const parts = String(p).replace(/^\\\\[^\\/]+[\\/][^\\/]+/, '').split(/[\\/]+/).filter(Boolean);
  if (parts.length && /^[A-Za-z]:$/.test(parts[0])) parts.shift();
  return parts;
}

/** True for a folder too broad to be a root: the filesystem (or drive) root, or one segment below it. */
export function isBroadRoot(p) {
  return segments(p).length < 2;
}

/**
 * The allowed roots as real paths, in order, existing ones only, with any root already
 * inside an earlier one dropped. `candidates` is a list of absolute (or resolvable) paths;
 * blank/non-string entries are ignored, and a broad one (isBroadRoot, judged on the real
 * path) is skipped and reported through `onSkip(candidate, real)`.
 * @param {Array<string|null|undefined>} candidates
 * @param {{onSkip?: (candidate: string, real: string) => void}} [opts]
 * @returns {Promise<string[]>}
 */
export async function realRoots(candidates, { onSkip = null } = {}) {
  const out = [];
  for (const c of candidates) {
    if (typeof c !== 'string' || !c.trim()) continue;
    const r = await realOrNull(resolve(c.trim()));
    if (!r) continue;
    if (isBroadRoot(r)) { if (onSkip) onSkip(c, r); continue; }
    if (out.some((o) => isWithin(r, o))) continue;
    for (let i = out.length - 1; i >= 0; i--) if (isWithin(out[i], r)) out.splice(i, 1);
    out.push(r);
  }
  return out;
}

/**
 * True when `target` (real) lies inside a root with no hidden folder below THAT root. Roots may nest (while no
 * projects root is configured the server adds worca's projects folder, inside a hidden folder of the OS home): any
 * one containing root suffices.
 */
export function insideRoots(target, roots) {
  return roots.some((r) => isWithin(target, r) && !segments(target.slice(r.length)).some((s) => s.startsWith('.')));
}

/**
 * Where `p` (absolute) really points, checked against `roots` (from realRoots).
 * An existing path is resolved through every symlink; a missing one is judged by its
 * nearest existing ancestor (so a missing path outside answers "outside", not "missing",
 * and leaks nothing about what exists there). A hidden folder below a root is outside.
 * @returns {Promise<{inside: boolean, real: string|null}>} real is null when `p` does not exist.
 */
export async function checkInside(p, roots) {
  const abs = resolve(p);
  const real = await realOrNull(abs);
  if (real) return { inside: insideRoots(real, roots), real };
  let probe = abs;
  for (;;) {
    const parent = resolve(probe, '..');
    if (parent === probe) return { inside: false, real: null };
    probe = parent;
    const rp = await realOrNull(probe);
    if (rp) {
      const rest = abs.slice(probe.length).replace(/^[\\/]+/, '');
      const joined = rest ? resolve(rp, rest) : rp;
      return { inside: insideRoots(joined, roots), real: null };
    }
  }
}
