// src/core/shape/check.mjs — the shape check + grounding marks on a plan file, for the `plan` ask (spec D6).
// Never throws: a missing plan or an fs error gives null, and a failing check never blocks approval.
import { readFile } from 'node:fs/promises';
import { checkShape } from '../../shared/shape/shape.mjs';
import { checkPaths } from './grounding.mjs';

/**
 * @param {string|null} file the plan the approval stop holds
 * @param {{projectDir?:string|null, perspectives?:string[], size?:string}} opts `projectDir` null (a workspace
 *   run: paths are per member) skips grounding, so `paths`/the size part of `grounded` are not checked
 * @returns {Promise<null|{ok, items, passed, total, found, grounding}>}
 */
export async function checkPlan(file, { projectDir = null, perspectives, size } = {}) {
  if (!file) return null;
  let markdown;
  try { markdown = await readFile(file, 'utf8'); } catch { return null; }
  const grounding = projectDir ? await checkPaths(markdown, projectDir).catch(() => null) : null;
  return { ...checkShape(markdown, { perspectives, size, grounding }), grounding };
}
