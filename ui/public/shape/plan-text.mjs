// ui/public/shape/plan-text.mjs — pure helpers of the plan and question cards (spec §3.3, §3.4).
import { SECTIONS, perspectiveByKey, ownersOf, splitSections } from '../../../src/shared/shape/perspectives.mjs';
import { askKindOf } from '../ask/registry.mjs';

export const SHAPE_ATTENTION = '~3 min of your time now';

export const isShapingRun = (r) => !!(r && r.shaping && typeof r.shaping === 'object');

export function planStats(md) {
  const text = String(md || '');
  const sections = (text.match(/^##\s+\S/gm) || []).length;
  const words = (text.replace(/```[\s\S]*?```/g, ' ').match(/\S+/g) || []).length;
  return { sections, words };
}

const labelOf = (k) => (perspectiveByKey(k) || {}).label || k;
const list = (keys) => keys.map(labelOf).join(', ');

export function perspectiveChangeFeedback(before, after) {
  const was = new Set(before); const now = new Set(after);
  const added = after.filter((k) => !was.has(k)); const dropped = before.filter((k) => !now.has(k));
  const parts = [];
  if (added.length) parts.push(`add ${list(added)}`);
  if (dropped.length) parts.push(`drop ${list(dropped)}`);
  return `Perspectives changed: ${parts.join('; ')}. Rewrite the plan for ${list(after)}: every section and checklist `
    + 'each picked perspective owns, and nothing for a dropped one.';
}

export function fixFeedback(item) {
  return `The shape check fails "${item.label}"${item.detail ? `: ${item.detail}` : ''}. Fix the plan so this check passes.`;
}

/** The perspectives that own a `## <title>` section (perspective tags on the plan, spec §3.4). */
export function sectionOwners(title, perspectives) {
  const t = String(title || '').trim().replace(/^\d+[.)]\s*/, '').toLowerCase();
  const s = SECTIONS.find((x) => x.title.toLowerCase() === t);
  return s ? ownersOf(s.key, perspectives) : [];
}

/** Skip, draft with defaults (D3): every question gets its recommended option, or the first. */
export function defaultAnswers(pq) {
  const qs = Array.isArray(pq && pq.questions) ? pq.questions : [];
  return {
    answers: qs.filter((q) => q && q.id != null).map((q) => {
      const opts = Array.isArray(q.options) ? q.options.filter((o) => typeof o === 'string') : [];
      const choice = typeof q.recommended === 'string' && opts.includes(q.recommended) ? q.recommended : (opts[0] || '');
      return { id: q.id, question: q.question || '', choice };
    }),
  };
}

/** The card's 2–3 lines (D30): the first paragraph of Problem and goal, else the first prose paragraph. */
export function planSummary(md, max = 280) {
  const prose = (text) => String(text || '').split(/\n\s*\n/)
    .map((p) => p.split('\n')
      .filter((l) => l.trim() && !/^\s*(#|\||[-*_]{3,}\s*$)/.test(l))
      .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
      .join(' ').trim())
    .find(Boolean) || '';
  const secs = splitSections(String(md || ''));
  const problem = secs.find((s) => s.key === 'problem');
  let text = problem ? prose(problem.text) : '';
  if (!text) for (const s of secs) { text = prose(s.text); if (text) break; }
  // Strip paired markup only, so `snake_case` and `2*3` survive.
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/g, '$1$2')
    .replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text;
}

/** Run 4 (D10): what each failing check means, in plain words (ids: src/shared/shape/shape.mjs SHAPE_IDS). */
const UNMET_WORDS = Object.freeze({ sections: 'missing sections', testable: 'goals you cannot check', decisions: 'open decisions',
  paths: 'file paths not in the repo', tests: 'no test plan', placeholders: 'placeholders left in', checklists: 'missing checklists',
  grounded: 'decisions not tied to the code' });
const failing = (check) => (check && Array.isArray(check.items) ? check.items : []).filter((it) => !it.pass);

/** "Shape 5/8 · 3 to fix" — the card's one check line (D30); the outline card passes 'Outline'. */
export function checkLine(check, name = 'Shape') {
  const n = failing(check).length;
  const score = check && Number.isFinite(check.total) ? `${name} ${check.passed}/${check.total}` : `${name} check`;
  return n ? `${score} · ${n} to fix` : score;
}

/** A shaping round's coverage counts `{ passed, total }` as a check for `checkLine`: `total - passed` failing rows. */
export function roundCheck(cov) {
  if (!cov || !Number.isInteger(cov.passed) || !Number.isInteger(cov.total) || cov.total < 1 || cov.total < cov.passed) return null;
  return { passed: cov.passed, total: cov.total,
    items: Array.from({ length: cov.total }, (_, i) => ({ id: `r${i + 1}`, label: `r${i + 1}`, pass: i < cov.passed })) };
}

/** The engine's coverage (`R-ops-1 · not covered by any step`, detail = the criterion text) as the card draws it: an
 *  uncovered row reads `R-ops-1 · <the criterion>` with the reason as its detail; a covered row keeps the engine's label. */
export function displayCoverage(cov) {
  const items = (cov && Array.isArray(cov.items) ? cov.items : []).map((it) => {
    if (it.pass || !it.detail) return it;
    return { ...it, label: `${it.id} · ${it.detail}`, detail: 'not covered by any step' };
  });
  return { ...cov, items };
}

/** "Still to fix: missing sections, no test plan" — under the buttons when the check fails (D32). */
export function unmetLine(check) {
  const bad = failing(check);
  if (!bad.length) return '';
  return `Still to fix: ${bad.map((it) => UNMET_WORDS[it.id] || it.label || it.id).join(', ')}`;
}

/** One revise for every failing check (D32 "Fix all"); a single failure reads as today's fixFeedback. The uncovered
 *  agreed `requirements` (coverage rows) follow on their own line, worded as requirements, not as shape checks. */
export function fixAllFeedback(items, requirements = []) {
  const bad = (Array.isArray(items) ? items : []).filter((it) => !it.pass);
  const req = (Array.isArray(requirements) ? requirements : []).filter((it) => !it.pass);
  const checkPart = () => {
    if (bad.length === 1) return fixFeedback(bad[0]);
    return `The shape check fails ${bad.length} checks:\n${bad.map((it) => `- "${it.label}"${it.detail ? `: ${it.detail}` : ''}`).join('\n')}\n`
      + 'Fix the plan so these checks pass.';
  };
  if (!req.length) return checkPart();
  // the engine label ("R-ops-1 · not covered by any step") would repeat the sentence: name it by id and criterion
  const name = (it) => (it.detail ? `${it.id}: ${it.detail}` : it.id || it.label);
  const reqPart = req.length === 1
    ? `The agreed requirement ${name(req[0])} is not covered by any step. Fix the plan so a step delivers it and names it on a \`Covers:\` line.`
    : `${req.length} agreed requirements are not covered by any step:\n${req.map((it) => `- ${name(it)}`).join('\n')}\n`
      + 'Fix the plan so a step delivers each and names it on a `Covers:` line.';
  return [bad.length ? checkPart() : '', reqPart].filter(Boolean).join('\n');
}

/** The plan card's primary names its outcome, never "anyway" (D32); every plan approval starts a build (the split is
 *  asked before any plan). The Split card's label is outline-body's approveRunsLabel. */
export const approveLabel = () => 'Approve and build';

/** Slice 4: a plan ask's primary names the open critical/major findings it accepts; else approveLabel's own words. */
export const planApproveLabel = (plan, open = 0) =>
  (open > 0 && !(plan && plan.outline) ? `Approve with ${open} open issue${open === 1 ? '' : 's'}` : approveLabel(plan));

/** A shaped run waiting on Shaper's own step (Clarify or the plan): the run page's waiting layout. Null otherwise. */
export function shaperWait(r, gateOn) {
  if (!gateOn || !isShapingRun(r) || !r.pendingQuestion) return null;
  const k = askKindOf(r.pendingQuestion);
  return k === 'plan' || k === 'clarify' ? k : null;
}
