// src/shared/review/requirements-coverage.mjs — diff coverage of the agreed requirements: the checklist provider the
// engine's role-review step reads for `checklist: 'coverage'`. One role, Requirements, checks the bound R-ids; every
// other role keeps the generic diff brief. An id the diff does not deliver is a `major` issue with a fixed title, so
// the step's existing routing blocks on it. Also the per-slice check a slice row draws. Pure and browser-safe.
import { criteriaList, criterionIds } from './coverage.mjs';
import { genericRoleBrief } from '../graph/role-review-step.mjs';

export const COVERAGE_ROLE = Object.freeze({ key: 'requirements', label: 'Requirements' });

/** Shaper's three code roles (the code review of wf_shape), as data. */
export const SHAPE_CODE_ROLES = Object.freeze([
  Object.freeze({ key: 'correctness', label: 'Correctness' }),
  Object.freeze({ key: 'security', label: 'Security' }),
  Object.freeze({ key: 'fit', label: 'Project fit' }),
]);

/** The one title an uncovered id is filed under: the reviewer's contract and the slice row's failing label. */
export const uncoveredTitle = (id) => `${id} · not covered by the diff`;

/** A requirements text narrowed to the criterion lines of `ids`, re-emitted as `- **id** text` in input order.
 *  `ids` null returns the text unchanged. */
export function onlyCriteria(markdown, ids) {
  if (ids === null || ids === undefined) return markdown;
  const keep = new Set(ids);
  return criteriaList(markdown).filter((c) => keep.has(c.id)).map((c) => `- **${c.id}** ${c.text}`.trimEnd()).join('\n') + '\n';
}

/** The slice row's check: one row per id, unmet only when an issue carries the id's uncovered title (a role prefix
 *  `requirements-N-M: ` allowed), so a same-id plan item or a passing mention leaves it met. Null for no ids. */
export function requirementsCheck(ids, texts = {}, issues = []) {
  const list = Array.isArray(ids) ? ids : [];
  if (!list.length) return null;
  const titles = (Array.isArray(issues) ? issues : []).map((i) => String(i?.title ?? ''));
  const items = list.map((id) => {
    const title = uncoveredTitle(id);
    const pass = !titles.some((t) => t === title || t.endsWith(`: ${title}`));
    return { id, label: pass ? `${id} · covered by the diff` : uncoveredTitle(id), pass, detail: String(texts?.[id] ?? '') };
  });
  return { items, passed: items.filter((i) => i.pass).length, total: items.length };
}

const ROLES = Object.freeze([...SHAPE_CODE_ROLES, COVERAGE_ROLE]);

function coverageBrief() {
  return genericRoleBrief(COVERAGE_ROLE, 'diff') +
    '## Requirements coverage\n\n' +
    'Read your bound `requirements` input: it lists the agreed criteria (`R-…` ids) this change must deliver. Judge ' +
    'each one against the diff only. Add `"checklist": [{ "id": "R-…", "status": "met" | "unmet" | "na", "evidence": "…" }]`, ' +
    'one entry per criterion id. File every id the diff does not deliver as a `major` issue titled exactly ' +
    `\`${uncoveredTitle('R-x-n')}\` (with the real id) and \`section\` set to the id.\n\n`;
}

/** The provider for `checklist: 'coverage'`. */
export const REQUIREMENTS_COVERAGE_CHECKLIST = Object.freeze({
  roles: () => ROLES.map(({ key, label }) => ({ key, label })),
  normalizePicked: () => ROLES.map((r) => r.key),
  items: (key, planText, requirementsText) => (key === COVERAGE_ROLE.key ? criterionIds(requirementsText) : []),
  brief(key) {
    if (key === COVERAGE_ROLE.key) return coverageBrief();
    return genericRoleBrief({ key, label: ROLES.find((r) => r.key === key)?.label || key }, 'diff');
  },
  wantsHouseBrief: () => false,
  feedsPlanChecklist: (key) => key !== COVERAGE_ROLE.key,
});
