import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_AGENTS_DIR } from '../src/core/agent-registry.mjs';
import { normalizeAnswers, frontMatterFromAnswers } from '../src/shared/spec-builder/front-matter.mjs';
import { renderSpecBuilderPrompt, loadPlannerInstructions, sectionOf, RESHAPE_RULES, SPEC_BUILDER_MARKER } from '../src/core/ask/spec-builder-prompt.mjs';

const answers = normalizeAnswers({ idea: 'Add dark mode\n- a toggle', mode: 'reshape', roles: ['qa', 'architect'] });
const fm = frontMatterFromAnswers(answers);
const instructions = loadPlannerInstructions();
const render = (over = {}) => renderSpecBuilderPrompt({ answers, fm, instructions, projectName: 'app', today: '2026-10-12', ...over });

test('carries the shipped Clarify and PLAN sections, fence-aware', () => {
  const t = render();
  assert.ok(t.includes('## What to do') && t.includes('## PLAN') && t.includes('## Cardinal rule: NEVER ASSUME, NEVER PAD'));
  assert.ok(t.includes('## Clarifications (Q&A)'));                 // only the quoted PLAN section carries this heading line …
  assert.ok(t.includes('Do not start refining or implementing'));   // … and the text AFTER its fenced example is kept
  assert.ok(!t.includes('## REVISE FROM REVIEW'));
});

test('a change to the agent file changes the prompt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-agents-'));
  for (const f of ['worca-cc-clarify.md', 'worca-cc-planner.md']) await copyFile(join(DEFAULT_AGENTS_DIR, f), join(dir, f));
  const plan = await readFile(join(dir, 'worca-cc-planner.md'), 'utf8');
  await writeFile(join(dir, 'worca-cc-planner.md'), plan.replace('## PLAN\n', '## PLAN\n\nZEBRA-RULE-42\n'));
  assert.ok(render({ instructions: loadPlannerInstructions(dir) }).includes('ZEBRA-RULE-42'));
  await writeFile(join(dir, 'worca-cc-planner.md'), plan.replace('## PLAN\n', '## PLANNING\n'));
  assert.throws(() => loadPlannerInstructions(dir), /has no "## PLAN" section/);
});

test('Reshape rules only in reshape mode; checklist lines per role; deterministic', () => {
  assert.ok(render().includes(RESHAPE_RULES));
  assert.ok(!render({ answers: { ...answers, mode: 'draft' } }).includes(RESHAPE_RULES));
  assert.ok(render().includes('R-qa-<n>') && render().includes('R-arch-<n>') && !render().includes('R-product'));
  assert.equal(render(), render());
  assert.ok(render().startsWith(`${SPEC_BUILDER_MARKER} Reshape`));
});

test('sectionOf: a fenced "## " line does not end the section; the next real heading does', () => {
  const md = ['## A', 'one', '```', '## inside', '```', 'two', '~~~~', '## also inside', '~~~~', '## B', 'three'].join('\n');
  const a = sectionOf(md, 'A');
  assert.ok(a.includes('## inside') && a.includes('## also inside') && a.includes('two'));
  assert.ok(!a.includes('three') && !a.includes('## B'));
  assert.throws(() => sectionOf(md, 'C', 'x.md'), /x\.md has no "## C" section/);
});

test('the idea fence is a ~ run longer than any ~ run in the idea', () => {
  const idea = 'Fix this\n```js\nx\n```\n~~~\nmore\n~~~~~\n';
  const t = render({ answers: { ...answers, idea } });
  assert.ok(t.includes(`\n~~~~~~text\n${idea}\n~~~~~~\n`));
});
