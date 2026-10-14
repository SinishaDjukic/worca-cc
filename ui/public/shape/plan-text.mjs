// ui/public/shape/plan-text.mjs — pure helpers of the plan and question cards (spec §3.3, §3.4).
import { SECTIONS, perspectiveByKey, ownersOf } from '../../../src/shared/shape/perspectives.mjs';

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
