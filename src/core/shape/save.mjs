// src/core/shape/save.mjs — Save to plans/ (spec D10): the plan on the card (the open draft, or the approved one)
// into the person's checkout. Never overwrites without asking, never commits, never writes outside the checkout.
import { readFile, writeFile, mkdir, realpath, lstat } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { slugify } from '../artifacts.mjs';

export const PLANS_DIR = 'plans';

export function planSaveName(title) {
  const s = slugify(String(title || ''));                       // slugify answers 'untitled' for an empty or symbol-only title
  const slug = (s === 'untitled' ? 'plan' : s).slice(0, 60).replace(/-+$/, '') || 'plan';
  return `${slug}-design.md`;
}

const inside = (root, p) => {
  const r = relative(root, p);
  return r === '' || (!isAbsolute(r) && r.split(sep)[0] !== '..');
};

/** @returns {Promise<{ok:true, path:string}|{ok:false, status:number, error:string, path?:string}>} */
export async function savePlanToCheckout({ file, projectDir, title, overwrite = false }) {
  const root = await realpath(projectDir);
  const dir = join(root, PLANS_DIR);
  let st = null;
  try { st = await lstat(dir); } catch (err) { if (err?.code !== 'ENOENT') throw err; }
  // A dangling plans symlink makes mkdir throw EEXIST (a 500): answer it as a refusal instead.
  if (st?.isSymbolicLink() && !(await realpath(dir).then(() => true, () => false))) {
    return { ok: false, status: 409, error: 'plans/ is a broken link' };
  }
  await mkdir(dir, { recursive: true });
  const realDir = await realpath(dir);                            // a symlinked plans/ must still be inside
  if (!inside(root, realDir)) return { ok: false, status: 409, error: 'plans/ points outside the project' };
  const name = planSaveName(title);
  const rel = `${PLANS_DIR}/${name}`;
  const target = join(realDir, name);
  try {
    if ((await lstat(target)).isSymbolicLink()) return { ok: false, status: 409, error: 'refusing to write through a symlink', path: rel };
  } catch (err) { if (err?.code !== 'ENOENT') throw err; }
  const text = await readFile(file, 'utf8');
  try {
    await writeFile(target, text, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
  } catch (err) {
    if (err?.code === 'EEXIST') return { ok: false, status: 409, error: 'exists', path: rel };
    throw err;
  }
  return { ok: true, path: rel };
}
