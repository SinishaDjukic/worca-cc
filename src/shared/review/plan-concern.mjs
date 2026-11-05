// src/shared/review/plan-concern.mjs — #990 s5: the implementer's plan concern ("the plan works, but its design is
// wrong"). Pure: the file contract, its prompt blocks and the planner's feedback section. Read by the orchestrator
// (src/core/orchestrator.mjs) and the prompt builder (src/core/graph/executor.mjs).

export const PLAN_CONCERN_TITLE_MAX = 200;
export const PLAN_CONCERN_DETAIL_MAX = 4000;

const clip = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max).trim() : '');
const oneLine = (s) => s.replace(/\s+/g, ' ');
// Every line break a Markdown reader may honour becomes LF, so the line-by-line quote below covers each line.
const lf = (s) => (typeof s === 'string' ? s.replace(/\r\n?|\u2028|\u2029/g, '\n') : s);

/** { ok:true, concern:{ title, detail?, section? } } | { ok:false, error } */
export function normalizePlanConcern(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'not a JSON object' };
  const title = clip(oneLine(typeof raw.title === 'string' ? raw.title : ''), PLAN_CONCERN_TITLE_MAX);
  if (!title) return { ok: false, error: 'title is missing' };
  const detail = clip(lf(raw.detail), PLAN_CONCERN_DETAIL_MAX);
  const section = clip(oneLine(typeof raw.section === 'string' ? raw.section : ''), PLAN_CONCERN_TITLE_MAX);
  return { ok: true, concern: { title, ...(detail ? { detail } : {}), ...(section ? { section } : {}) } };
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
