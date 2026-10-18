// Perspective checklists in review (spec D7): the reviewer's `checklist` field, the major issues an incomplete
// checklist raises, the tally, and the Markdown the review file and the PR carry. Pure and browser-safe: the
// orchestrator, protocol.mjs, results.mjs, the server and the UI all import it (slice 3, C1).
import { CHECKLIST_ID_RE } from './checklist.mjs';
import { perspectiveByKey } from './perspectives.mjs';

export const CHECKLIST_STATUSES = Object.freeze(['met', 'unmet', 'na']);
/** A plan item the review did not report. Set by applyChecklist, never taken from a reviewer. */
export const CHECKLIST_MISSING = 'missing';
export const CHECKLIST_EVIDENCE_MAX = 500;
export const CHECKLIST_PR_MARKER = '<!-- worca:perspective-checklist -->';

const NA_ALIASES = new Set(['na', 'n/a', 'n.a.', 'not applicable', 'not-applicable']);
const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const major = (title, detail, location) => ({ severity: 'major', title, detail, location });

function normalizeStatus(v) {
  const s = oneLine(v).toLowerCase();
  if (s === 'met' || s === 'unmet') return s;
  if (NA_ALIASES.has(s)) return 'na';
  return 'unmet';   // an unknown status never passes silently (C2)
}

/** The reviewer's raw `checklist` → [{id, status, evidence}], or null when it is not an array (omitted). */
export function normalizeReviewChecklist(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const id = oneLine(it.id);
    if (!CHECKLIST_ID_RE.test(id)) continue;
    out.push({ id, status: normalizeStatus(it.status), evidence: oneLine(it.evidence).slice(0, CHECKLIST_EVIDENCE_MAX) });
  }
  return out;
}

/**
 * Merge a normalized review with the approved plan's items (`extractChecklist`). Every item gets the reviewer's
 * status, or `missing`. Each gap becomes a major issue after the reviewer's own (C2). With no items, the review
 * comes back without a `checklist` key.
 * @param {{issues?:Array, summary?:string, checklist?:Array|null}} review
 * @param {Array<{id:string, perspective:string, text:string}>} items
 * @returns {{issues:Array, summary:string, checklist?:Array}}
 */
export function applyChecklist(review, items) {
  const { checklist: reported = null, ...rest } = review || {};
  const base = { ...rest, issues: Array.isArray(rest.issues) ? [...rest.issues] : [],
    summary: typeof rest.summary === 'string' ? rest.summary : '' };
  if (!Array.isArray(items) || !items.length) return base;
  const byId = new Map();
  for (const r of Array.isArray(reported) ? reported : []) if (r && !byId.has(r.id)) byId.set(r.id, r);
  const checklist = items.map((it) => {
    const r = byId.get(it.id);
    return { id: it.id, perspective: it.perspective, text: it.text,
      status: r ? r.status : CHECKLIST_MISSING, evidence: r ? r.evidence : '' };
  });
  const added = [];
  if (!Array.isArray(reported)) {
    added.push(major('Perspective checklist missing from the review',
      `The approved plan has ${plural(items.length, 'checklist item')} (${items.map((i) => i.id).join(', ')}) and the ` +
      'review JSON has no "checklist" array. Report every item as met (with evidence), unmet or na.',
      'review JSON: checklist'));
  } else {
    for (const c of checklist) {
      if (c.status === 'unmet') {
        added.push(major(`${c.id} not met: ${c.text}`, c.evidence || 'The review marked this checklist item unmet.',
          `plan checklist ${c.id}`));
      } else if (c.status === 'met' && !c.evidence) {
        added.push(major(`${c.id} marked met without evidence`,
          `"${c.text}" needs evidence: the test, the file:line, or the command and its output that shows it.`,
          `plan checklist ${c.id}`));
      }
    }
    const missing = checklist.filter((c) => c.status === CHECKLIST_MISSING).map((c) => c.id);
    if (missing.length) {
      added.push(major(`Checklist ${missing.length === 1 ? 'item' : 'items'} not reported: ${missing.join(', ')}`,
        'Every item of the approved plan needs a status in the review JSON "checklist": met (with evidence), unmet or na.',
        'review JSON: checklist'));
    }
  }
  return { ...base, issues: [...base.issues, ...added], checklist };
}

/** {met, unmet, na, missing, total} of a merged checklist. */
export function checklistTally(list) {
  const t = { met: 0, unmet: 0, na: 0, missing: 0, total: 0 };
  for (const c of Array.isArray(list) ? list : []) {
    t[CHECKLIST_STATUSES.includes(c?.status) ? c.status : CHECKLIST_MISSING] += 1;
    t.total += 1;
  }
  return t;
}

/** "Checklist: 3 met · 1 unmet · 1 n/a" (+ " · 2 not reported"). */
export function checklistTallyText(t, { prefix = 'Checklist: ' } = {}) {
  const n = (k) => Number(t?.[k]) || 0;
  return `${prefix}${n('met')} met · ${n('unmet')} unmet · ${n('na')} n/a` +
    (n('missing') ? ` · ${n('missing')} not reported` : '');
}

/** "Checklist 12/14": met over the items that apply (n/a left out; a not-reported item counts against). */
export function checklistScore(t) {
  const n = (k) => Number(t?.[k]) || 0;
  return `Checklist ${n('met')}/${n('met') + n('unmet') + n('missing')}`;
}

/** The newest review row (readPipelineExtras shape) that carries a checklist: {kind, cycle, checklist}, or null. */
export function latestChecklist(reviews) {
  let best = null;
  for (const r of Array.isArray(reviews) ? reviews : []) {
    if (!r || !Array.isArray(r.checklist) || !r.checklist.length) continue;
    if (!best || (Number(r.cycle) || 0) > (Number(best.cycle) || 0)) best = r;
  }
  return best ? { kind: best.kind, cycle: best.cycle, checklist: best.checklist } : null;
}

/** The PR description's closing section (C6), or '' for an empty list. */
export function checklistMarkdown(list) {
  const rows = (Array.isArray(list) ? list : []).map((c) => {
    const id = oneLine(c?.id);
    const text = oneLine(c?.text);
    const ev = oneLine(c?.evidence);
    if (c?.status === 'met') return `- [x] **${id}** ${text}${ev ? ` — ${ev}` : ''}`;
    if (c?.status === 'na') return `- [ ] ~~**${id}** ${text}~~ — Not applicable${ev ? `: ${ev}` : ''}`;
    if (c?.status === 'unmet') return `- [ ] **${id}** ${text} — Not met${ev ? `: ${ev}` : ''}`;
    return `- [ ] **${id}** ${text} — Not reported by the review`;
  });
  return rows.length ? `${CHECKLIST_PR_MARKER}\n## Perspective checklist\n\n${rows.join('\n')}\n` : '';
}

/** The section the orchestrator writes into the review Markdown the Implementer reads (F7). */
export function checklistFindingsMarkdown(issues) {
  return '## Perspective checklist (added by Worca)\n\n' +
    'The approved plan\'s checklist is not complete. Fix each item below; the reviewer checks them again.\n\n' +
    issues.map((i) => `- **[${i.severity}]** ${i.title} — ${i.detail} (\`${i.location}\`)`).join('\n') + '\n';
}

/** The reviewer's prompt block (C5), or '' without items. */
export function reviewChecklistBlock(items) {
  if (!Array.isArray(items) || !items.length) return '';
  const label = (k) => perspectiveByKey(k)?.label || k;
  return '## Perspective checklist\n\n' +
    `The approved plan promises ${plural(items.length, 'checklist item')}. Check each one against the diff:\n\n` +
    items.map((i) => `- \`${i.id}\` (${label(i.perspective)}): ${oneLine(i.text)}`).join('\n') + '\n\n' +
    'Report every id above in the review JSON as `"checklist": [{ "id": "R-…", "status": "met" | "unmet" | "na", ' +
    '"evidence": "…" }]`, one entry per id:\n' +
    '- `met`: the diff does it. `evidence` names the test, the file:line, or the command and its output that shows ' +
    'it. `met` without evidence counts as a major issue.\n' +
    '- `unmet`: it is not done, or not shown. Say what is missing in `evidence`. Worca turns every unmet item into ' +
    'a major issue, so do not repeat it in `issues`.\n' +
    '- `na`: it does not apply to this change. Give the reason in `evidence`.\n\n' +
    'A review JSON without `checklist`, or one that leaves an id out, counts as a major issue.\n';
}
