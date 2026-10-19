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
