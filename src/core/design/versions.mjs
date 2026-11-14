// src/core/design/versions.mjs
// Design P5 Task 10 (M2, L5.6): `versions/<n>/` are plain copies of a design's work/ source, one per finished round
// (P2's done path calls snapshotVersion before the terminal frame) and one per restore, so work/ always equals
// `versions/<design.version>`. Their only UI is `Back to before this` on a round's receipt. Dot entries at every depth
// are the engine's (`.kit`, `.asks`, `.crew.json`, and P8's `<section>/.ctx`, `<section>/.asks` and an engine's own
// folder), and they and anything that is not a plain file or folder (links) are never copied; the last
// KEEP_VERSIONS stay. Folders are replaced entry by entry, never renamed while a handle may be open (Windows).
// work/ is the owner's agents' to write (P8): it is never walked by path. A snapshot reads it by descriptor
// (copyTreeOut), and a restore removes and writes in it only through folders held open (inWorkFolder, removeWorkEntry,
// placeWorkFile). What an agent makes there never stops a restore part-way: each file is renamed over its name from a
// temp (written again when an agent removes it first), and what worca cannot remove is set aside.

import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { lstat, mkdir, readdir, realpath, rename, rm } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { assembleDesign, readConfined } from './assemble.mjs';
import { copyTreeOut, designWorkDir, inWorkFolder, placeWorkFile, removeWorkEntry, versionDir, versionsDir } from './paths.mjs';
import { validatePlan } from './plan.mjs';
import { requireDesign, updateDesign } from './store.mjs';

export const KEEP_VERSIONS = 20;

const RM = Object.freeze({ recursive: true, force: true, maxRetries: 5 });
const VERSION_NAME_RE = /^[1-9]\d*$/;

const messageOf = (err) => (err && typeof err.message === 'string' ? err.message : String(err));

/** Refuses a `work` that exists and is not a real folder (P8, L8.28): a restore removes every non-dot entry of work/,
 *  which through a link is another folder's contents, worca's own files included. `missing` lets a restore make it. */
async function checkWork(work, { missing = false } = {}) {
  let st;
  try {
    st = await lstat(work);
  } catch (err) {
    if (missing && err.code === 'ENOENT') return;
    throw err;
  }
  if (!st.isDirectory()) throw Object.assign(new Error('the design\'s work folder is not a folder'), { code: 'ENOTDIR' });
}

/** The numbered folders of `versions/`, ascending; links and `<n>.tmp` leftovers are not versions. */
function versionNumbers(designId) {
  let entries;
  try {
    entries = readdirSync(versionsDir(designId), { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries.filter((e) => e.isDirectory() && VERSION_NAME_RE.test(e.name)).map((e) => Number(e.name)).sort((a, b) => a - b);
}

/**
 * Copies work/ to `versions/<design.version + 1>` (through `<n>.tmp` and a rename), sets the design's version to it
 * and drops the versions that fall out of the last KEEP_VERSIONS. Dot entries at every depth are the engine's, not the
 * source, and are skipped, as the assembler skips them (P8). A work/ that is not a real folder (a link) is refused, and
 * work/ is read by descriptor (copyTreeOut): a folder an agent swaps for a link meanwhile is skipped, never followed.
 * @param {{ designId: string }} opts
 * @returns {Promise<number>} the new version
 */
export async function snapshotVersion({ designId } = {}) {
  const design = requireDesign(designId);
  const n = design.version + 1;
  const work = designWorkDir(designId);
  await checkWork(work);
  const root = versionsDir(designId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const name of await readdir(root)) {
    if (name.endsWith('.tmp')) await rm(join(root, name), RM);
  }
  const tmp = join(root, `${n}.tmp`);
  const dest = versionDir(designId, n);
  copyTreeOut(work, [], tmp);
  await rm(dest, RM);
  await rename(tmp, dest);
  updateDesign(designId, { version: n });
  for (const old of versionNumbers(designId)) {
    if (old <= n - KEEP_VERSIONS) await rm(versionDir(designId, old), RM);
  }
  return n;
}

/**
 * Rebuilds `dist/` from the restored source as P2's done path does; no valid plan skips it, a refusal is logged.
 * @returns {boolean} true only when `dist/` was rebuilt
 */
function rebuildDist(design, work) {
  const text = readConfined(work, 'plan.json');
  const check = text === null ? null : validatePlan(text, { kind: design.kind });
  if (!check?.ok) return false;
  try {
    assembleDesign({ workDir: work, plan: check.plan, mode: 'dist' });
    return true;
  } catch (err) {
    console.error(`[worca-design] dist not rebuilt: ${messageOf(err)}`);
    return false;
  }
}

/**
 * Copies the plain entries of `from` (a version's folder, worca's own) into `work/<parts...>` (P8): each folder of
 * work/ reached through the one above it held open (inWorkFolder, which replaces a link or another user's folder at a
 * level and looks again at a name filled meanwhile), whatever an agent planted at a folder's name removed or set aside
 * first (removeWorkEntry), and each file renamed over its name from a new temp (placeWorkFile, mode 0660), so nothing is
 * ever written through a link and nothing an agent makes at a name meanwhile stops the copy. `plainIn` says what to copy.
 */
function copyVersionIn(designId, from, parts, plainIn) {
  const dirs = [];
  inWorkFolder(designId, parts, { create: true }, (base) => {
    for (const name of readdirSync(from)) {
      const st = plainIn(join(from, name));
      if (!st) continue;
      if (st.isDirectory()) {
        removeWorkEntry(designId, base, name, { aside: true });
        dirs.push(name);
      } else {
        placeWorkFile(designId, base, name, join(from, name));
      }
    }
  });
  for (const name of dirs) copyVersionIn(designId, join(from, name), [...parts, name], plainIn);
}

/** Removes the top-level entry `name` of work/ through work/ held open, never by path (P8: rm walks by path); what
 *  worca cannot remove (an agent's 0555 folder) is set aside, never a restore stopped part-way. */
const clearWork = (designId, name) => inWorkFolder(designId, [], {}, (w) => removeWorkEntry(designId, w, name, { aside: true }));

/**
 * Puts `versions/<n>` back as work/'s source: every top-level non-dot entry of work/ is removed (or set aside), and so
 * are the stale questions (`.asks`) and crew (`.crew.json`), the kit (`.kit`) stays, then the version's entries are
 * copied in. `dist/` is rebuilt (the design is then `done`), and the result is snapshot as a new version. A work/ that
 * exists and is not a real folder (a link) is refused before anything is removed. Every entry copied must resolve inside the real
 * `versions/<n>` checked first (P8): one swapped for a link meanwhile throws `ELOOP`, its target never copied. work/
 * is removed from and written to only through folders held open (clearWork, copyVersionIn), never walked by path: an
 * agent swapping one of its folders for a link meanwhile redirects nothing.
 * @param {{ designId: string, n: number }} opts
 * @returns {Promise<{ version: number, restoredFrom: number }>} rejects with `.status = 404` when `versions/<n>` is gone
 */
export async function restoreVersion({ designId, n } = {}) {
  const design = requireDesign(designId);
  const from = versionDir(designId, n);
  let st = null;
  try { st = await lstat(from); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  const realFrom = st?.isDirectory() ? await realpath(from) : null;
  if (!realFrom || realFrom !== join(await realpath(versionsDir(designId)), String(n))) {
    const err = new Error(`version ${n} is no longer kept`);
    err.status = 404;
    throw err;
  }
  /** A plain file or folder inside the real `versions/<n>`: its lstat; null for a link, FIFO or socket. */
  const plainIn = (src) => {
    const entry = lstatSync(src);
    if (!entry.isFile() && !entry.isDirectory()) return null;
    const real = realpathSync(src);
    if (real === realFrom || real.startsWith(`${realFrom}${sep}`)) return entry;
    throw Object.assign(new Error(`version ${n} was replaced while it was restored`), { code: 'ELOOP' });
  };
  const work = designWorkDir(designId);
  await checkWork(work, { missing: true });
  await mkdir(work, { recursive: true });
  for (const name of await readdir(work)) {
    if (!name.startsWith('.')) clearWork(designId, name);
  }
  clearWork(designId, '.asks');
  clearWork(designId, '.crew.json');
  copyVersionIn(designId, from, [], plainIn);
  // P6: a finished page exports only when `done`; a stale dist/ must not, so `done` follows only a rebuilt one.
  if (rebuildDist(design, work)) updateDesign(designId, { status: 'done' });
  const version = await snapshotVersion({ designId });
  return { version, restoredFrom: n };
}

/**
 * The kept versions, ascending (API only, per M2).
 * @param {string} designId
 * @returns {{ n: number, createdAt: string }[]}
 */
export function listVersions(designId) {
  return versionNumbers(designId).map((n) => ({ n, createdAt: statSync(versionDir(designId, n)).mtime.toISOString() }));
}
