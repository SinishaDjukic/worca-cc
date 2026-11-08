// src/core/design/kit.mjs
// The kit a design kind ships (P5 Task 11): `assets/design-kit/<kind>/` holds the CONTRACT.md its agents follow.
// Staging copies that folder into the design's source folder as `work/.kit/`, where `_kitContract()` reads it and the
// write guard keeps agents out. A kind with no folder yet stages nothing; P7 adds its kinds by adding folders.

import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KIT_ROOT = fileURLToPath(new URL('../../../assets/design-kit/', import.meta.url));

const KIND_RE = /^[a-z]+$/;

/** Puts the kit file `src` at `dest`: copied under a temp name and renamed over, so a file once staged is never
 *  missing, not even while another staging runs, and a link at `dest` is replaced, never written through. */
async function stageFile(src, dest) {
  const tmp = `${dest}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await copyFile(src, tmp, constants.COPYFILE_EXCL);
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Stages the kit folder `from` into `to`, made when missing; a `to` that is a link or a file is refused before
 *  anything is written through it. */
async function stageTree(from, to, name) {
  await mkdir(to, { recursive: true });
  if (!(await lstat(to)).isDirectory()) throw new Error(`${name} is not a folder`);
  for (const e of await readdir(from, { withFileTypes: true })) {
    if (e.isDirectory()) await stageTree(join(from, e.name), join(to, e.name), `${name}/${e.name}`);
    else if (e.isFile()) await stageFile(join(from, e.name), join(to, e.name));
  }
}

/**
 * Copy `assets/design-kit/<kind>/` into `<workDir>/.kit/`, replacing what a previous round staged. Safe to run twice
 * at once: no step unlinks a staged file first.
 * @param {{ kind: string, workDir: string }} opts
 * @returns {Promise<boolean>} false for a kind that is not lowercase letters or has no kit folder
 */
export async function stageDesignKit({ kind, workDir } = {}) {
  if (typeof kind !== 'string' || !KIND_RE.test(kind)) return false;
  const from = join(KIT_ROOT, kind);
  try { await stat(from); } catch { return false; }
  await stageTree(from, join(workDir, '.kit'), '.kit');
  return true;
}
