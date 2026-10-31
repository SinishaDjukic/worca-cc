// src/core/requirements/markdown.mjs
// The spec as Markdown (plans/requirements-design.md D11): Copy, Download and Save to specs/ all use it.
const STATUS_LABEL = { looking: 'Looking at the code', thinking: 'Interview running', your_turn: 'Interview running', done: 'Interview done', archived: 'Archived' };
const none = '_None yet._';
const bullets = (list) => (list.length ? list.map((s) => `- ${s}`).join('\n') : none);
const from = (x) => (x.source ? ` (from ${x.source})` : '');   // A8 D13: an item a file gave
const numbered = (list) => (list.length ? list.map((s, i) => `${i + 1}. ${s}`).join('\n') : none);

export function renderSpecMarkdown(f, { targetName = null } = {}) {
  const s = f.spec;
  const target = `**${f.scopeType === 'workspace' ? 'Workspace' : 'Project'}:** ${targetName || f.scopeKey || ''}`;
  const goal = s.goal.text ? `${s.goal.text}${s.goal.measure ? `\n\n**Success measure:** ${s.goal.measure}` : ''}` : none;
  return [
    `# ${f.id}: ${f.title}`,
    `${target} · **Status:** ${STATUS_LABEL[f.status] || f.status}`,
    '## Goal', goal,
    '## Actors', bullets(s.actors),
    '## Main flow', numbered(s.flow),
    '## Edge cases', bullets(s.edgeCases),
    '## Business rules', bullets(s.rules),
    '## Out of scope', bullets(s.outOfScope),
    '## Acceptance criteria', s.criteria.length ? s.criteria.map((c) => `- **${c.id}** ${c.text}${from(c)}`).join('\n') : none,
    '## Assumptions', s.assumptions.length ? s.assumptions.map((a) => `- **${a.id}** (${a.status}) ${a.text}${from(a)}`).join('\n') : none,
    '## Open questions', bullets(s.openQuestions),
    '## Description, as first given', f.description.split(/\r?\n/).map((l) => `> ${l}`).join('\n'),
  ].join('\n\n') + '\n';
}

/** The first paragraph of every run task (A2 D7). */
export const TASK_PREAMBLE = 'Build this feature. The acceptance criteria `R-po-<n>` are the definition of done; keep their ids in the plan '
  + 'and the review. Confirmed assumptions are decisions; open ones are guesses the product owner accepted when starting. '
  + 'Rejected assumptions are not to be built.';

/** The task a run started from a feature gets (A2 D7): the preamble, then the given (frozen) spec as
 *  renderSpecMarkdown renders it, its heading naming the version (`# FEAT-7 v2: …`). */
export function renderTaskMarkdown(feature, { spec = feature.spec, targetName = null, version = 1 } = {}) {
  const lines = renderSpecMarkdown({ ...feature, spec }, { targetName }).split('\n');
  lines[0] = `# ${feature.id} v${version}: ${feature.title}`;
  return `${TASK_PREAMBLE}\n\n${lines.join('\n')}`;
}

/** A criterion as one ticket line (A6 D4): "R-po-1 <text>", with A8's "(from <name>)". */
export const criterionLine = (c) => `${c.id} ${c.text}${from(c)}`;

/**
 * The ticket's description (plans/requirements-a6-design.md D4), board 27's order: Goal (text, then "Measure: ..."), Actors
 * (" · "), Main flow, Business rules, Edge cases, Out of scope, Acceptance criteria (only when they go to the description),
 * Confirmed assumptions, Files the spec mentions (names only), then the footer. An empty section is left out (the export's
 * "_None yet._" is never sent); open questions, open and rejected assumptions and the first description are not in it. An
 * Export anyway reason leads.
 */
export function renderTicketMarkdown(f, { reason = null, exportedOn, criteriaInDescription = true, mentionedFiles = [] } = {}) {
  const s = f.spec;
  const out = [];
  const section = (title, body) => { if (body) out.push(`## ${title}`, body); };
  if (reason) out.push(`Exported before Ready: ${reason}`);
  section('Goal', [s.goal.text, s.goal.measure ? `Measure: ${s.goal.measure}` : ''].filter(Boolean).join('\n\n'));
  section('Actors', s.actors.join(' · '));
  section('Main flow', s.flow.length ? numbered(s.flow) : '');
  section('Business rules', s.rules.length ? bullets(s.rules) : '');
  section('Edge cases', s.edgeCases.length ? bullets(s.edgeCases) : '');
  section('Out of scope', s.outOfScope.length ? bullets(s.outOfScope) : '');
  if (criteriaInDescription) section('Acceptance criteria', s.criteria.length ? bullets(s.criteria.map(criterionLine)) : '');
  const confirmed = s.assumptions.filter((a) => a.status === 'confirmed');
  section('Confirmed assumptions', confirmed.length ? bullets(confirmed.map((a) => `${a.id} ${a.text}${from(a)}`)) : '');
  section('Files the spec mentions', mentionedFiles.length ? bullets(mentionedFiles) : '');
  out.push(`From Worca ${f.id} · exported ${exportedOn}`);
  return `${out.join('\n\n')}\n`;
}
