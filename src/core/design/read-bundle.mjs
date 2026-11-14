// src/core/design/read-bundle.mjs
// What a builder off the hook row reads (P8, L8.7, Contract issue 4). Its cwd is its section, and no such engine can
// be given work/ as an extra folder (`writableRootsInWorcaHome` refuses one inside the home), so before each of its
// processes the build copies the shared files it reads into `<section>/.ctx/`: plan.json, brand.md, `.crew.json` as
// crew.json, tokens.css, global.css and the kit's CONTRACT.md, each when present. The folder is the agent's to write,
// so staging never follows a link: the section folder and `.ctx` are reached through no planted link and, on Linux,
// through the folders above them held open (`inWorkFolder`: a `sections`, section or `.ctx` link is removed, never
// followed, and a level swapped for one afterwards redirects nothing), `.ctx` is removed whole (`removeWorkEntry`: a
// link goes, never its target, and no retry resolves a path through work/), or set aside in the section when worca
// cannot remove it (an agent's 0555 folder in it must not fail every later builder), and made again, and each copy is
// a new file (`O_EXCL|O_NOFOLLOW`, the default mode, so an `asAgent` builder reads it through its group), read through
// `readConfined` (a source linked out of work/ is skipped). Dot names never reach dist, a snapshot, an export, the
// preview or the drafts.

import { closeSync, constants as fsc, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfined } from './assemble.mjs';
import { designWorkDir, inWorkFolder, removeWorkEntry, sectionDir } from './paths.mjs';

/** `[source under work/, name in .ctx]`. */
const SOURCES = Object.freeze([
  ['plan.json', 'plan.json'],
  ['brand.md', 'brand.md'],
  ['.crew.json', 'crew.json'],
  ['tokens.css', 'tokens.css'],
  ['global.css', 'global.css'],
  [join('.kit', 'CONTRACT.md'), 'CONTRACT.md'],
]);
/** A new file only: never an existing entry, never through a link at the path itself. */
const NEW_FILE = fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL | (fsc.O_NOFOLLOW ?? 0);

/**
 * Stages the read bundle of section `sectionId` afresh, in a real section folder (made when missing). Throws when the
 * folder cannot be made or a copy written (a name planted between the remove and the write is refused, never written
 * through), or with the paths' `DesignError` for a bad id.
 * @param {{ designId: string, sectionId: string }} opts
 * @returns {{ dir: string, files: string[] }} the folder and the names copied, sorted
 */
export function stageReadBundle({ designId, sectionId }) {
  const work = designWorkDir(designId);
  const dir = join(sectionDir(designId, sectionId), '.ctx');
  inWorkFolder(designId, ['sections', sectionId], { create: true }, (section) => removeWorkEntry(designId, section, '.ctx', { aside: true }));
  const files = inWorkFolder(designId, ['sections', sectionId, '.ctx'], { create: true }, (ctx) => {
    const names = [];
    for (const [src, name] of SOURCES) {
      const text = readConfined(work, src);
      if (text === null) continue;
      const fd = openSync(join(ctx, name), NEW_FILE, 0o666);
      try {
        writeFileSync(fd, text);
      } finally {
        closeSync(fd);
      }
      names.push(name);
    }
    return names;
  });
  return { dir, files: files.sort() };
}

/** Removes the read bundle of section `sectionId`, if any (a link goes, never its target; a planted `sections` or
 *  section link is removed and nothing behind it is reached, nor behind one swapped in meanwhile; one worca cannot
 *  remove is set aside in the section). */
export function removeReadBundle({ designId, sectionId }) {
  sectionDir(designId, sectionId);
  inWorkFolder(designId, ['sections', sectionId], {}, (section) => removeWorkEntry(designId, section, '.ctx', { aside: true }));
}
