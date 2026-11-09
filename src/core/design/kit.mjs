// src/core/design/kit.mjs
// The kit a design kind ships (P5 Task 11, P7 Task 3): `assets/design-kit/<folder>/` holds the CONTRACT.md its agents
// follow, where the folder is the kind's (`kitFolder`: `web`, `deck` for presentation and pitch, `video`). Staging
// copies that folder into the design's source folder as `work/.kit/`, where `_kitContract()` reads it and the write
// guard keeps agents out, plus the runtime a deck or a film inlines from there: OpenDeck's three scripts from
// `assets/deck-kit/`, byte for byte, and gsap. Nothing else of the deck kit is staged: its bundler only ever runs
// from the package, and nothing in Design runs its export or audit scripts.

import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gsapPath } from '../../../assets/promo-kit/tools/init-film.mjs';
import { kitFolder, kitScriptNames } from './kinds.mjs';

export const KIT_ROOT = fileURLToPath(new URL('../../../assets/design-kit/', import.meta.url));

const DECK_KIT = fileURLToPath(new URL('../../../assets/deck-kit/', import.meta.url));

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

/** The runtime files a kit folder stages from outside itself, as `[source, name under .kit/]` pairs. `film.js`
 *  arrives with the video folder; `gsapPath()` throws when gsap is not installed. */
function runtimeFiles(folder, kind) {
  if (folder === 'deck') return kitScriptNames(kind).map((name) => [join(DECK_KIT, name), name]);
  if (folder === 'video') return [[gsapPath(), 'gsap.min.js']];
  return [];
}

/**
 * Copy the kind's `assets/design-kit/<folder>/` and its runtime files into `<workDir>/.kit/`, replacing what a
 * previous round staged. Safe to run twice at once: no step unlinks a staged file first.
 * @param {{ kind: string, workDir: string }} opts
 * @returns {Promise<boolean>} false for anything that is not a design kind, or a kind with no kit folder
 */
export async function stageDesignKit({ kind, workDir } = {}) {
  const folder = kitFolder(kind);
  if (!folder) return false;
  const from = join(KIT_ROOT, folder);
  try { await stat(from); } catch { return false; }
  const to = join(workDir, '.kit');
  await stageTree(from, to, '.kit');
  for (const [src, name] of runtimeFiles(folder, kind)) await stageFile(src, join(to, name));
  return true;
}
