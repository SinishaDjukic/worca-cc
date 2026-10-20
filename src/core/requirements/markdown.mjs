// src/core/requirements/markdown.mjs
// The spec as Markdown (plans/requirements-design.md D11): Copy, Download and Save to specs/ all use it.
const STATUS_LABEL = { looking: 'Looking at the code', thinking: 'Interview running', your_turn: 'Interview running', done: 'Interview done', archived: 'Archived' };
const none = '_None yet._';
const bullets = (list) => (list.length ? list.map((s) => `- ${s}`).join('\n') : none);
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
    '## Acceptance criteria', s.criteria.length ? s.criteria.map((c) => `- **${c.id}** ${c.text}`).join('\n') : none,
    '## Assumptions', s.assumptions.length ? s.assumptions.map((a) => `- **${a.id}** (${a.status}) ${a.text}`).join('\n') : none,
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
