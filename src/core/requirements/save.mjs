// src/core/requirements/save.mjs
// Save to specs/ (plans/requirements-design.md D11): writes specs/FEAT-<n>-<slug>.md into the project's
// checkout and never commits. The checks are those of Shaper's "Save to plans/" (src/core/shape/save.mjs);
// sharing one helper between the two is a possible follow-up.
import { realpath, lstat, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';

const NOT_A_DIR = Object.freeze({ ok: false, status: 409, error: 'specs/ is not a directory' });
const IS_A_DIR = Object.freeze({ ok: false, status: 409, error: 'the spec path is a directory' });
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function specFileName(feature) {
  return `${feature.id}-${slugify(feature.title).slice(0, 60).replace(/-+$/, '') || 'feature'}.md`;
}

export async function saveSpecToCheckout({ projectDir, feature, markdown, overwrite = false }) {
  const root = await realpath(projectDir);
  const dir = join(root, 'specs');
  const st = await lstat(dir).catch(() => null);
  if (st && st.isSymbolicLink()) {
    try { await stat(dir); } catch { return { ok: false, status: 409, error: 'specs/ is a broken link' }; }
  }
  if (st && !st.isSymbolicLink() && !st.isDirectory()) return NOT_A_DIR;
  try { await mkdir(dir, { recursive: true }); }
  catch (err) { if (['EEXIST', 'ENOTDIR'].includes(err?.code)) return NOT_A_DIR; throw err; }
  const real = await realpath(dir);
  if (!(await stat(real)).isDirectory()) return NOT_A_DIR;
  const rel = relative(root, real);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return { ok: false, status: 409, error: 'specs/ points outside the project' };
  const name = specFileName(feature);
  const target = join(real, name);
  const tst = await lstat(target).catch(() => null);
  if (tst && tst.isSymbolicLink()) return { ok: false, status: 409, error: 'refusing to write through a symlink' };
  if (tst && tst.isDirectory()) return IS_A_DIR;
  try {
    await writeFile(target, markdown, { flag: overwrite ? 'w' : 'wx' });
  } catch (err) {
    if (err && err.code === 'EISDIR') return IS_A_DIR;
    if (err && err.code === 'ENOTDIR') return NOT_A_DIR;
    if (err && err.code === 'EEXIST') return { ok: false, status: 409, error: 'exists', path: `specs/${name}` };
    throw err;
  }
  return { ok: true, path: `specs/${name}` };
}
