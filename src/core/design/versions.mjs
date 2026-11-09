// src/core/design/versions.mjs
// Design P5 Task 10 (M2, L5.6): `versions/<n>/` are plain copies of a design's work/ source, one per finished round
// (P2's done path calls snapshotVersion before the terminal frame) and one per restore, so work/ always equals
// `versions/<design.version>`. Their only UI is `Back to before this` on a round's receipt. The engine's dot entries
// (`.kit`, `.asks`, `.crew.json`) and anything that is not a plain file or folder (links) are never copied; the last
// KEEP_VERSIONS stay. Folders are replaced entry by entry, never renamed while a handle may be open (Windows).

import { readdirSync, statSync } from 'node:fs';
import { cp, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { assembleDesign, readConfined } from './assemble.mjs';
import { asksDir, crewFile, designWorkDir, versionDir, versionsDir } from './paths.mjs';
import { validatePlan } from './plan.mjs';
import { requireDesign, updateDesign } from './store.mjs';

export const KEEP_VERSIONS = 20;

const RM = Object.freeze({ recursive: true, force: true, maxRetries: 5 });
const VERSION_NAME_RE = /^[1-9]\d*$/;

const messageOf = (err) => (err && typeof err.message === 'string' ? err.message : String(err));

/** A plain file or folder: links (and FIFOs, sockets) are never copied, so a copy cannot reach outside work/. */
async function plainEntry(src) {
  const st = await lstat(src);
  return st.isFile() || st.isDirectory();
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
 * and drops the versions that fall out of the last KEEP_VERSIONS. Top-level dot entries are the engine's, not the
 * source, and are skipped.
 * @param {{ designId: string }} opts
 * @returns {Promise<number>} the new version
 */
export async function snapshotVersion({ designId } = {}) {
  const design = requireDesign(designId);
  const n = design.version + 1;
  const work = designWorkDir(designId);
  const root = versionsDir(designId);
  await mkdir(root, { recursive: true });
  for (const name of await readdir(root)) {
    if (name.endsWith('.tmp')) await rm(join(root, name), RM);
  }
  const tmp = join(root, `${n}.tmp`);
  const dest = versionDir(designId, n);
  await cp(work, tmp, {
    recursive: true,
    filter: async (src) => {
      if (src !== work && dirname(src) === work && basename(src).startsWith('.')) return false;
      return plainEntry(src);
    },
  });
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
 * Puts `versions/<n>` back as work/'s source: every top-level non-dot entry of work/ is removed, the version's
 * entries are copied in, the stale questions (`.asks`) and crew (`.crew.json`) go, the kit (`.kit`) stays. `dist/` is
 * rebuilt (the design is then `done`), and the result is snapshot as a new version.
 * @param {{ designId: string, n: number }} opts
 * @returns {Promise<{ version: number, restoredFrom: number }>} rejects with `.status = 404` when `versions/<n>` is gone
 */
export async function restoreVersion({ designId, n } = {}) {
  const design = requireDesign(designId);
  const from = versionDir(designId, n);
  let st = null;
  try { st = await lstat(from); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  if (!st?.isDirectory()) {
    const err = new Error(`version ${n} is no longer kept`);
    err.status = 404;
    throw err;
  }
  const work = designWorkDir(designId);
  await mkdir(work, { recursive: true });
  for (const name of await readdir(work)) {
    if (!name.startsWith('.')) await rm(join(work, name), RM);
  }
  for (const name of await readdir(from)) {
    await cp(join(from, name), join(work, name), { recursive: true, filter: plainEntry });
  }
  await rm(asksDir(designId), RM);
  await rm(crewFile(designId), RM);
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
