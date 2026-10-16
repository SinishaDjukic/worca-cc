// src/core/shape/check.mjs — the shape check + grounding marks on a plan file, for the `plan` ask (spec D6).
// Mechanical failures fix themselves in the plan file first, then the check runs again (D27).
// Never throws: a missing plan or an fs error gives null, and a failing check never blocks approval.
import { readFile, writeFile } from 'node:fs/promises';
import { checkShape } from '../../shared/shape/shape.mjs';
import { checkPaths } from './grounding.mjs';
import { markNewPaths } from './fix.mjs';

/**
 * @param {string|null} file the plan the approval stop holds
 * @param {{projectDir?:string|null, perspectives?:string[], size?:string}} opts `projectDir` null (a workspace
 *   run: paths are per member) skips grounding, so `paths`/the size part of `grounded` are not checked
 * @returns {Promise<null|{ok, items, passed, total, found, grounding, fixed}>} `fixed` lists what D27 repaired
 */
export async function checkPlan(file, { projectDir = null, perspectives, size } = {}) {
  if (!file) return null;
  let markdown;
  try { markdown = await readFile(file, 'utf8'); } catch { return null; }
  const run = async (md) => {
    const grounding = projectDir ? await checkPaths(md, projectDir).catch(() => null) : null;
    return { ...checkShape(md, { perspectives, size, grounding }), grounding };
  };
  const first = await run(markdown);
  // D27: the mechanical failures fix themselves in the plan file, then the check runs again
  const fix = markNewPaths(markdown, first.grounding);
  if (!fix.fixed.length) return { ...first, fixed: [] };
  try { await writeFile(file, fix.markdown, 'utf8'); } catch { return { ...first, fixed: [] }; }
  return { ...(await run(fix.markdown)), fixed: fix.fixed };
}
