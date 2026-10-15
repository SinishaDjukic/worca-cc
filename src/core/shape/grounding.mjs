// src/core/shape/grounding.mjs — V9 grounding marks: does each backticked repo path in a plan exist in the
// project? Read-only; every path goes through the project-file guard (ask-files refusePathShape + realpath +
// isInside) BEFORE anything is stat'ed, so a dot-segment or a symlink leaving the project is never stat'ed.
import { realpath as fsRealpath, stat as fsStat, readFile as fsReadFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { refusePathShape, isInside } from '../ask-files.mjs';
import { repoPaths, groundKey } from '../../shared/shape/shape.mjs';

export const GROUNDING_MAX_PATHS = 200;
/** Lines in a text file; a trailing newline ends the last line, it does not start another (R21). */
export const lineCount = (t) => (t === '' ? 0 : t.split('\n').length - (t.endsWith('\n') ? 1 : 0));
export const LINE_CHECK_MAX_BYTES = 2 * 1024 * 1024;
const FOLD = process.platform === 'win32' || process.platform === 'darwin';

/**
 * @returns {Promise<Array<{path:string, line?:number, found:boolean, isNew:boolean, missing?:boolean}>>} one entry per
 *   distinct path:line; `missing` marks a path that does not exist, cited without :line (D27: fixable)
 */
export async function checkPaths(markdown, projectDir, { fs = { realpath: fsRealpath, stat: fsStat, readFile: fsReadFile }, fold = FOLD } = {}) {
  const root = projectDir ? await fs.realpath(projectDir).catch(() => null) : null;
  const byKey = new Map();
  for (const p of repoPaths(markdown)) {
    const key = groundKey(p);
    const prev = byKey.get(key);
    if (prev) { prev.isNew = prev.isNew || p.isNew; continue; }
    if (byKey.size >= GROUNDING_MAX_PATHS) break;
    byKey.set(key, { path: p.path, ...(p.line != null ? { line: p.line } : {}), found: false, isNew: p.isNew });
  }
  for (const g of byKey.values()) {
    if (!root || refusePathShape(g.path)) continue;
    try {
      const real = await fs.realpath(resolve(root, ...g.path.split('/').filter(Boolean)));
      if (!isInside(root, real, { fold })) continue;
      const st = await fs.stat(real);
      g.found = st.isFile() || st.isDirectory();
      if (g.found && g.line != null) {
        if (!st.isFile()) g.found = false;
        else if (st.size <= LINE_CHECK_MAX_BYTES) g.found = lineCount(String(await fs.readFile(real, 'utf8'))) >= g.line;
      }
    } catch (err) {
      g.found = false;
      // D27: the one mechanical case, the path itself does not exist. A :line past the end, a refused path and a
      // symlink leaving the project never throw here (or are not ENOENT), so they stay unfixable.
      if (err?.code === 'ENOENT' && g.line == null) g.missing = true;
    }
  }
  return [...byKey.values()];
}
