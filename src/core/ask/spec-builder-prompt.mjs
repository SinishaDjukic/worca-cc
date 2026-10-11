// src/core/ask/spec-builder-prompt.mjs
// The first message of a Spec Builder thread (plans/spec-builder §3.5). Pure: the server passes the
// normalized answers, the validated front-matter, the project's plans/ examples and today's date.
import { renderWorcaFrontMatter } from '../../shared/spec-builder/front-matter.mjs';
import { sectionsFor, roleByKey } from '../../shared/spec-builder/roles.mjs';

export const SPEC_BUILDER_MARKER = '[worca spec-builder]';
const SECTION_HINT = {
  problem: 'Product: the problem, the goal, who it is for, numbered success criteria.',
  decisions: 'Architect: a numbered decisions table (| # | Decision |).',
  screens: 'UX: each screen and its states (empty, loading, error), UI levels, accessibility.',
  layout: 'Architect: every file to add or change, by real path, with the functions involved.',
  threats: 'Security: trust boundaries, inputs, secrets, permissions, abuse cases.',
  infra: 'DevOps and infrastructure: environments, CI/CD, infrastructure as code, monitoring and alerts.',
  testing: 'QA if picked: acceptance criteria as testable checks and test files by name; else a short default.',
  rollout: 'Release: migration, feature flag, rollout, rollback.',
  outOfScope: 'What this spec deliberately does not do.',
  openQuestions: 'Anything still undecided, numbered.',
};

function yamlAnswers(a) {
  const lines = [`goal: ${JSON.stringify(a.goal)}`, `kind: ${a.kind}`, `size: ${a.size}`, `roles: [${a.roles.join(', ')}]`];
  if (a.areas.length) lines.push('areas:', ...a.areas.map((p) => `  - ${JSON.stringify(p)}`));
  if (a.flag) lines.push(`flag: { key: ${a.flag.key}, stage: ${a.flag.stage} }`);
  if (a.levels) lines.push(`levels: ${a.levels}`);
  return lines.join('\n');
}

/**
 * @param {{answers:object, fm:object, examples?:string[], projectName?:string, today:string}} p
 *   answers: normalizeAnswers(); fm: a validated front-matter; examples: plans/*.md paths in the project.
 */
export function renderSpecBuilderPrompt({ answers, fm, examples = [], projectName = '', today }) {
  const sections = sectionsFor(fm.roles);
  const skeleton = [
    renderWorcaFrontMatter(fm).trimEnd(),
    `# ${answers.goal}`,
    '',
    `Date: ${today}. Base branch: <base>. Branch: <feat/...>. PR title: <title>.`,
    '',
    ...sections.flatMap((s) => [`## ${s.n}. ${s.title}`, '', `<${SECTION_HINT[s.key]}>`, '']),
  ].join('\n');
  const roleNames = fm.roles.map((k) => roleByKey(k)?.label || k).join(', ');
  return [
    `${SPEC_BUILDER_MARKER} Write a Worca-ready spec${projectName ? ` for the project ${projectName}` : ''}.`,
    '',
    'The wizard answers:',
    '```yaml', yamlAnswers(answers), '```',
    '',
    `Roles that shape it: ${roleNames}. The spec has exactly these sections, in this order:`,
    ...sections.map((s) => `${s.n}. ${s.title} — ${SECTION_HINT[s.key]}`),
    '',
    'Start from this skeleton; keep the front-matter block exactly as it is:',
    '```markdown', skeleton, '```',
    '',
    'Rules:',
    '- Ground every path, function and test file in the real repo: open_worktree on the project (reuse one from list_worktrees), then Read, Grep and Glob under that path; the git tool\'s ls-files and grep help too. Never name a file you have not seen.',
    '- Ask at most 3 questions, and only about what the repo cannot answer. Give each 2–4 suggested answers. If nothing is unclear, ask none.',
    '- Prefer decisions tables to prose. Keep it concrete and short.',
    '- Finish by calling propose_spec with the whole Markdown (and a path like plans/<slug>-design.md). If it returns errors, fix them and call it again.',
    ...(examples.length ? [`- Existing specs in this project to match in tone and depth: ${examples.join(', ')}.`] : []),
  ].join('\n');
}
