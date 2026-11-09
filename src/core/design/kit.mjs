// src/core/design/kit.mjs
// The kit a design kind ships (P5 Task 11, P7 Task 3): `assets/design-kit/<folder>/` holds the CONTRACT.md its agents
// follow, where the folder is the kind's (`kitFolder`: `web`, `deck` for presentation and pitch, `video`). Staging
// copies that folder into the design's source folder as `work/.kit/`, where `_kitContract()` reads it and the write
// guard keeps agents out, plus the runtime a deck or a film inlines from there: OpenDeck's three scripts from
// `assets/deck-kit/`, byte for byte, and gsap. Nothing else of the deck kit is staged: its bundler only ever runs
// from the package, and nothing in Design runs its export or audit scripts. work/ is the owner's agents' to write
// (P8), so `.kit` is staged through folders held open (paths.mjs inFolder): a link or another user's folder at `.kit` is
// replaced, one swapped in meanwhile redirects nothing, and a folder planted at a kit file's name is set aside.

import { randomBytes } from 'node:crypto';
import { constants, copyFileSync, lstatSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gsapPath } from '../../../assets/promo-kit/tools/init-film.mjs';
import { kitFolder, kitScriptNames } from './kinds.mjs';
import { inFolder, setAside } from './paths.mjs';

export const KIT_ROOT = fileURLToPath(new URL('../../../assets/design-kit/', import.meta.url));

const DECK_KIT = fileURLToPath(new URL('../../../assets/deck-kit/', import.meta.url));

/** Puts the kit file `src` at `<to>/<name>`, `to` held (stageTree): copied under a temp name and renamed over, so a
 *  file once staged is never missing, not even while another staging runs, and a link there is replaced, never written
 *  through. A folder there (a consented engine's lead can write `.kit`) is set aside in `to` (paths.mjs setAside) and
 *  the rename tried once more, so it never fails every later staging (P8). */
function stageFile(src, to, name) {
  const dest = join(to, name);
  const tmp = `${dest}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    copyFileSync(src, tmp, constants.COPYFILE_EXCL);
    try {
      renameSync(tmp, dest);
    } catch (err) {
      if (!lstatSync(dest, { throwIfNoEntry: false })?.isDirectory()) throw err;
      setAside(to, name);
      renameSync(tmp, dest);
    }
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Stages the kit folder `from` into `<workDir>/<parts...>` and `extra` (`[source, name]` pairs) beside it, each
 *  folder made when missing and reached through the one above it held open (inFolder): a link, a file or another
 *  user's folder at a level is replaced, never written through. */
function stageTree(from, workDir, parts, extra = []) {
  const dirs = [];
  inFolder(workDir, parts, { create: true }, (to) => {
    for (const e of readdirSync(from, { withFileTypes: true })) {
      if (e.isDirectory()) dirs.push(e.name);
      else if (e.isFile()) stageFile(join(from, e.name), to, e.name);
    }
    for (const [src, name] of extra) stageFile(src, to, name);
  });
  for (const name of dirs) stageTree(join(from, name), workDir, [...parts, name]);
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
 * previous round staged; a `.kit` an agent made a link, a file or its own folder is replaced first (stageTree). Safe to
 * run twice at once: no step unlinks a staged file first.
 * @param {{ kind: string, workDir: string }} opts
 * @returns {Promise<boolean>} false for anything that is not a design kind, or a kind with no kit folder
 */
export async function stageDesignKit({ kind, workDir } = {}) {
  const folder = kitFolder(kind);
  if (!folder) return false;
  const from = join(KIT_ROOT, folder);
  try { await stat(from); } catch { return false; }
  stageTree(from, workDir, ['.kit'], runtimeFiles(folder, kind));
  return true;
}
