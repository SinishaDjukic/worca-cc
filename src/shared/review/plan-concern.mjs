// src/shared/review/plan-concern.mjs — #990 s5: the implementer's plan concern ("the plan works, but its design is
// wrong"). Pure: the file contract, its prompt blocks and the planner's feedback section. Read by the orchestrator
// (src/core/orchestrator.mjs) and the prompt builder (src/core/graph/executor.mjs).
import { CRITERION_ID_RE } from './coverage.mjs';

export const PLAN_CONCERN_TITLE_MAX = 200;
export const PLAN_CONCERN_DETAIL_MAX = 4000;
export const REQUIREMENT_CONCERN_IDS_MAX = 64;

const clip = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max).trim() : '');
const oneLine = (s) => s.replace(/\s+/g, ' ');
// Every line break a Markdown reader may honour becomes LF, so the line-by-line quote below covers each line.
const lf = (s) => (typeof s === 'string' ? s.replace(/\r\n?|\u2028|\u2029/g, '\n') : s);

/** { ok:true, concern:{ title, detail?, section?, kind?, requirements? } } | { ok:false, error }. `kind` and
 *  `requirements` are kept only for a requirement concern (Shaper requirements s3), which must name a valid id. */
export function normalizePlanConcern(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'not a JSON object' };
  const title = clip(oneLine(typeof raw.title === 'string' ? raw.title : ''), PLAN_CONCERN_TITLE_MAX);
  if (!title) return { ok: false, error: 'title is missing' };
  const detail = clip(lf(raw.detail), PLAN_CONCERN_DETAIL_MAX);
  const section = clip(oneLine(typeof raw.section === 'string' ? raw.section : ''), PLAN_CONCERN_TITLE_MAX);
  const concern = { title, ...(detail ? { detail } : {}), ...(section ? { section } : {}) };
  if (raw.kind !== 'requirement') return { ok: true, concern };
  const ids = [...new Set((Array.isArray(raw.requirements) ? raw.requirements : [])
    .filter((id) => typeof id === 'string' && CRITERION_ID_RE.test(id)))].slice(0, REQUIREMENT_CONCERN_IDS_MAX);
  if (!ids.length) return { ok: false, error: 'a requirement concern names no requirement' };
  return { ok: true, concern: { ...concern, kind: 'requirement', requirements: ids } };
}

/** The current pass's role-review rounds → the requirement concern, or null. Every finding carrying `requirement`,
 *  across rounds in order, one per id (the first finding wins). The id stays in the detail line only. */
export function requirementConcernOf(rounds) {
  const byId = new Map();
  for (const round of Array.isArray(rounds) ? rounds : []) {
    for (const r of Array.isArray(round?.roles) ? round.roles : []) {
      for (const f of Array.isArray(r?.findings) ? r.findings : []) {
        if (f?.requirement && !byId.has(f.requirement)) byId.set(f.requirement, { f, label: r.label || r.key });
      }
    }
  }
  if (!byId.size) return null;
  const all = [...byId.entries()];
  const [firstId, { f: first }] = all[0];
  const bare = String(first.title || '').replace(new RegExp(`^\\s*${firstId}\\s*[:\u2014\u2013-]?\\s*`), '');
  const out = normalizePlanConcern({
    title: all.length === 1 ? bare || first.title : `${all.length} requirement concerns`,
    detail: all.map(([id, { f, label }]) => `${id} (${label}): ${f.fix || ''}`.trim()).join('\n'),
    section: first.section,
    kind: 'requirement',
    requirements: all.map(([id]) => id),
  });
  return out.ok ? out.concern : null;
}

/** The role reviewer's prompt block when the plan is reviewed against agreed requirements (any workflow). */
export function requirementConcernBlock(ids) {
  if (!Array.isArray(ids) || !ids.length) return '';
  return '## Requirement concerns\n\n' +
    `These requirements are agreed with the person: ${ids.join(', ')}. Do not ask the plan to change, narrow or drop ` +
    'one of them. If you think an agreed requirement itself is wrong or cannot be met, raise that finding with a ' +
    '`"requirement": "R-po-1"` field naming the id it concerns. Such a finding goes to the person as a question at ' +
    'the plan approval and does not send the plan back. Use the field only for the requirement itself, never for how ' +
    'the plan covers it.\n\n';
}

/** Appended to the person's "Ask for changes" feedback when the plan approval carried a requirement concern. */
export function requirementConcernFeedbackSection(concern) {
  const quote = (s) => lf(s).split('\n').map((l) => `> ${l}`).join('\n');
  const ids = Array.isArray(concern?.requirements) ? concern.requirements : [];
  return '\n## Requirement concern\n\n' +
    `A reviewer said these agreed requirements are wrong or cannot be met: ${ids.join(', ')}. The person read the ` +
    'concern and asked for the changes above. Follow their answer.\n\n' +
    `**${concern.title}**\n` +
    (concern.section ? `\nSection: ${concern.section}\n` : '') +
    (concern.detail ? `\n${quote(concern.detail)}\n` : '');
}

/** One file per implementer execution, in the pipeline dir. */
export const planConcernFileName = (nodeId, ordinal) => `${nodeId}-plan-concern-c${ordinal}.json`;

/** The implementer prompt block (offered only below a plan approval stop). */
export function planConcernBlock(file) {
  if (!file) return '';
  return '## Plan concern\n\n' +
    'Build the approved plan. If the plan would work but its design is wrong (a better approach would change what ' +
    'the plan decides, not just how you code it), do not build the part you disagree with. Write ' +
    `\`${file}\` instead:\n\n` +
    '```json\n{ "title": "One line: what is wrong", "detail": "Why, and what you would do instead", ' +
    '"section": "The plan section it concerns" }\n```\n\n' +
    'Build everything else the plan asks for. The person then decides: send the plan back to the planner with your ' +
    'concern, or have you build it as written. Do not write this file for bugs, missing details or anything you can ' +
    'fix while building; record those as deviations as usual.\n\n';
}

/** The re-run's block after the person (or --yes) overrode the concern. */
export function planConcernOverrideBlock(concern) {
  if (!concern || !concern.title) return '';
  return '## Plan concern overridden\n\n' +
    `You raised a plan concern: "${concern.title}". It was overridden: build the plan as written. Build the part you ` +
    'held back, exactly as the plan says, and do not write a plan concern file again.\n\n';
}

/** Appended to the person's "Ask for changes" feedback: the planner's revise input carries the concern.
 *  The agent-written detail is quoted line by line, so its headings cannot pose as feedback sections. */
export function concernFeedbackSection(concern) {
  const quote = (s) => lf(s).split('\n').map((l) => `> ${l}`).join('\n');
  return '\n## The implementer\'s plan concern\n\n' +
    'The person accepted this concern from the implementer. Change the plan so it no longer applies.\n\n' +
    `**${concern.title}**\n` +
    (concern.section ? `\nSection: ${concern.section}\n` : '') +
    (concern.detail ? `\n${quote(concern.detail)}\n` : '');
}
