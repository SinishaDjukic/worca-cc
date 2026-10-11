// src/core/spec-builder/save.mjs — "Save to plans/" (plans/spec-builder D11). Writes ONE new file under
// <project>/plans/: refuses absolute/dot-segment/odd paths (ask-files refusePathShape), anything that resolves
// outside the project (realpath + isInside — a symlinked plans/ cannot escape), protected basenames
// (the normal guardrail set), and never overwrites (O_EXCL): an existing name gets the next free -vN back.
import { mkdir, writeFile, realpath, access } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { refusePathShape, isInside } from '../ask-files.mjs';
import { isProtectedBasename } from '../ask/tools.mjs';
import { GUARDRAIL_PRESETS } from '../guardrails.mjs';
import { SPEC_PATH_RE } from '../ask/spec-proposal.mjs';

export class SpecSaveError extends Error {
  constructor(message) { super(message); this.code = 'BAD_PATH'; }
}

export function slugify(title) {
  const s = String(title || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return s || 'spec';
}

export function defaultSpecPath(markdown) {
  const title = /^#[ \t]+(.+?)[ \t]*$/m.exec(String(markdown || ''))?.[1] || '';
  return `plans/${slugify(title)}-design.md`;
}

/** plans/x-design.md → plans/x-design-v2.md (… -v99); `exists(rel)` → boolean. */
export async function nextFreeName(rel, exists) {
  const stem = rel.replace(/(?:-v\d+)?\.md$/, '');
  for (let n = 2; n < 100; n++) {
    const cand = `${stem}-v${n}.md`;
    if (!(await exists(cand))) return cand;
  }
  return null;
}

/**
 * @returns {Promise<{ok:true, path:string} | {ok:false, code:'EXISTS', path:string, suggestion:string|null}>}
 * @throws {SpecSaveError} on a refused path
 */
export async function saveSpec({ projectDir, path, markdown }) {
  const rel = (typeof path === 'string' && path.trim()) || defaultSpecPath(markdown);
  const refusal = refusePathShape(rel);
  if (refusal) throw new SpecSaveError(refusal);
  if (!SPEC_PATH_RE.test(rel)) throw new SpecSaveError('path must be plans/<name>.md');
  if (isProtectedBasename(rel, GUARDRAIL_PRESETS.normal.protectedPaths)) throw new SpecSaveError(`${rel} is a protected file`);
  const root = await realpath(projectDir);
  await mkdir(join(root, 'plans'), { recursive: true });
  const plans = await realpath(join(root, 'plans'));
  if (!isInside(root, plans)) throw new SpecSaveError('plans/ resolves outside the project');
  const target = join(plans, basename(rel));
  try {
    await writeFile(target, markdown, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      const exists = async (r) => access(join(plans, basename(r))).then(() => true, () => false);
      return { ok: false, code: 'EXISTS', path: rel, suggestion: await nextFreeName(rel, exists) };
    }
    throw err;
  }
  return { ok: true, path: rel };
}
