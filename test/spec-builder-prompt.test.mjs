import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSpecBuilderPrompt, SPEC_BUILDER_MARKER } from '../src/core/ask/spec-builder-prompt.mjs';
import { normalizeAnswers, frontMatterFromAnswers, renderWorcaFrontMatter } from '../src/shared/spec-builder/front-matter.mjs';
import { sectionsFor } from '../src/shared/spec-builder/roles.mjs';

const answers = normalizeAnswers({ goal: 'Add dark mode', kind: 'feature', size: 'medium', roles: ['qa', 'ux'], areas: ['ui/public/style.css'] });
const fm = frontMatterFromAnswers(answers);
const render = (over = {}) => renderSpecBuilderPrompt({ answers, fm, projectName: 'app', today: '2026-10-11', ...over });

test('deterministic for a fixed today, and starts with the marker', () => {
  assert.equal(render(), render());
  assert.ok(render().startsWith(`${SPEC_BUILDER_MARKER} Write a Worca-ready spec for the project app.`));
});

test('carries the front-matter, every section heading in order, and the rules', () => {
  const t = render();
  assert.ok(t.includes(renderWorcaFrontMatter(fm).trimEnd()));
  let at = -1;
  for (const s of sectionsFor(fm.roles)) {
    const i = t.indexOf(`## ${s.n}. ${s.title}`);
    assert.ok(i > at, s.title);
    at = i;
  }
  for (const w of ['open_worktree', 'propose_spec', 'at most 3 questions', 'Date: 2026-10-11.']) assert.ok(t.includes(w), w);
  assert.ok(t.includes('  - "ui/public/style.css"'));
});

test('lists the examples when given, and omits the line when there are none', () => {
  assert.ok(render({ examples: ['plans/a-design.md', 'plans/b-design.md'] }).includes('- Existing specs in this project to match in tone and depth: plans/a-design.md, plans/b-design.md.'));
  assert.ok(!render().includes('Existing specs in this project'));
});
