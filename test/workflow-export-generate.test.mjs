import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { applyExport, planExport, distinctAgents } from '../src/core/workflow-export.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeKeyGraph, writeLevelsGraph } from './helpers/export-fixtures.mjs';

useTempHome(after);

// distinctAgents returns the ordered unique node keys across the topological steps.
// (The v1 composer-core twin this used to be drift-guarded against was retired with the
// v1 composer; the exporter now owns the only copy.)
test('distinctAgents returns ordered unique node keys across steps', () => {
  assert.deepEqual(distinctAgents([]), []);
  assert.deepEqual(distinctAgents([[{ key: 'planner' }]]), ['planner']);
  assert.deepEqual(
    distinctAgents([[{ key: 'planner' }], [{ key: 'implementer' }, { key: 'implementer' }], [{ key: 'reviewer' }], [{ key: 'planner' }]]),
    ['planner', 'implementer', 'reviewer'],
  );
  assert.deepEqual(
    distinctAgents([[{ key: 'a' }, { key: 'b' }], [{ key: 'b' }, { key: 'a' }, { key: 'c' }]]),
    ['a', 'b', 'c'],
  );
});

const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'wf-exp-')); dirs.push(d); return d; };
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

test('default workflow → SKILL.md preserves step order, marks parallel groups, derives gate names on both sides', async () => {
  const dest = await tmp();
  await applyExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const skill = await readFile(join(dest, '.claude/skills/default/SKILL.md'), 'utf8');
  assert.ok(skill.indexOf('## Step 1') < skill.indexOf('## Step 2'));
  assert.match(skill, /## Invariants/);
  // reviewer→implementer gate is 'impl-review' on both write (produces) and read (loop)
  assert.match(skill, /impl-review-cycle<N>\.json/);            // loop read
  assert.match(skill, /\$RUN_DIR\/impl-review-cycle1\.json/);   // reviewer's produces line
  // implementer CONSUMES the reviewer's review (producer-aware) → also impl-review, not refine-review
  const implBlock = skill.slice(skill.indexOf('Dispatch `worca-cc-implementer`'));
  assert.match(implBlock.slice(0, 400), /Consumes:.*impl-review-cycle1\.json/);
  // the refine self-loop uses 'refine-review'
  assert.match(skill, /refine-review-cycle<N>\.json/);
});

test('askQuestions node emits the emit-questions + body-asks pattern; fanOut adds Agent + clause', async () => {
  const dest = await tmp();
  await applyExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const skill = await readFile(join(dest, '.claude/skills/default/SKILL.md'), 'utf8');
  assert.match(skill, /YOU\*\* call\s+`AskUserQuestion`/s);      // hoist proven in SKILL body
  const clarify = await readFile(join(dest, '.claude/agents/worca-cc-clarify.md'), 'utf8');
  assert.match(clarify, /\{"questions":\[\{"question"/);         // emit-as-JSON clause in the agent
});

test('parallel group in one step is marked "dispatch all nodes in parallel"', async () => {
  const dest = await tmp();
  // Two nodes in one step (a parallel group): planner + reviewer.
  const tpl = await writeLevelsGraph({
    name: 'Parallel Fixture',
    levels: [['clarify'], ['planner', 'reviewer'], ['implementer']],
  });
  await applyExport({ workflowId: tpl.id, destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const skill = await readFile(join(dest, `.claude/skills/parallel-fixture/SKILL.md`), 'utf8');
  assert.match(skill, /## Step 2 \(dispatch all nodes in parallel\)/);
});

test('feedback loops name the real dispatch agents, not raw node keys', async () => {
  const dest = await tmp();
  await applyExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const skill = await readFile(join(dest, '.claude/skills/default/SKILL.md'), 'utf8');
  // refiner self-loop and reviewer→implementer loop must use dispatch names on BOTH sides.
  assert.match(skill, /## Feedback loop: worca-cc-plan-refiner → itself/);
  assert.match(skill, /## Feedback loop: worca-cc-code-reviewer → worca-cc-implementer/);
  assert.match(skill, /re-dispatch `worca-cc-plan-refiner`/);
  // the raw node keys must never appear as a loop's dispatch target
  assert.doesNotMatch(skill, /## Feedback loop: refiner →/);
  assert.doesNotMatch(skill, /## Feedback loop: reviewer →/);
});

test('exported skill isolates the run on a branch and never commits', async () => {
  const dest = await tmp();
  await applyExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const skill = await readFile(join(dest, '.claude/skills/default/SKILL.md'), 'utf8');
  // Setup: reuse a named branch or auto-create; guarded on being inside a git work tree.
  assert.match(skill, /git rev-parse --is-inside-work-tree/);
  assert.match(skill, /git switch "\$BRANCH" 2>\/dev\/null \|\| git switch -c "\$BRANCH"/);
  assert.match(skill, /BRANCH="worca\/default-\$\(date/);
  // artifacts kept local-only (never committed) via the repo-local exclude file
  assert.match(skill, /\.git\/info\/exclude/);
  // invariant: never add/commit/push; leave changes uncommitted
  assert.match(skill, /Never `git add`, `git commit`, or `git push`/);
  assert.match(skill, /uncommitted/);
});

// REGRESSION GUARD (#2): a clarify CONSUMER must be pointed at the answers the runner writes
// (clarify-answers.json), not the producer's questions (clarify.json). The producing (ask) node
// still writes clarify.json.
test('clarify consumer reads clarify-answers.json; producer writes clarify.json', async () => {
  const dest = await tmp();
  await applyExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const skill = await readFile(join(dest, '.claude/skills/default/SKILL.md'), 'utf8');
  // The planner consumes 'clarify' → its Consumes line names the ANSWERS file.
  const plannerBlock = skill.slice(skill.indexOf('Dispatch `worca-cc-planner`'));
  assert.match(plannerBlock.slice(0, 400), /Consumes:.*clarify-answers\.json/);
  assert.doesNotMatch(plannerBlock.slice(0, 400), /Consumes:.*[^-]clarify\.json/);
  // The ask hoist still writes the QUESTIONS to clarify.json.
  assert.match(skill, /\$RUN_DIR\/clarify\.json/);
});

// (The v1 "ambiguous 'review' producer" warning was removed with the v1 connectsTo
// heuristic: v2 data flow is explicit wires, so a consumed review resolves to exactly
// the wired producer — there is no ambiguity to warn about.)

// REGRESSION GUARD: a workflow name containing a newline must not break the SKILL.md YAML
// frontmatter — the description is collapsed to a single line (as makeAgentMd already does).
test('a newline in the workflow name yields a single-line YAML description', async () => {
  const dest = await tmp();
  const wf = await writeKeyGraph({ name: 'My Flow\nv2', keys: ['planner', 'implementer', 'reviewer'] });
  await applyExport({ workflowId: wf.id, destination: 'project', projectDir: dest, slug: 'nl-test', onConflict: 'overwrite' });
  const skill = await readFile(join(dest, '.claude/skills/nl-test/SKILL.md'), 'utf8');
  assert.match(skill, /description: 'Run the "My Flow v2" workflow/);   // newline collapsed; YAML single-quoted
  const fm = skill.slice(0, skill.indexOf('\n---', 4));                 // the frontmatter block
  assert.doesNotMatch(fm, /\nv2"/, 'name fragment must not leak onto its own frontmatter line');
});

// REGRESSION GUARD: a workflow name containing YAML-hostile characters (':' + space, ' #') must be
// emitted as a quoted scalar so the `---` frontmatter fence stays valid. Unquoted, `: ` would make
// the parser see a nested mapping ("bad indentation"), and ` #` would truncate the value as a comment.
test('a workflow name with YAML metacharacters yields a valid quoted description', async () => {
  const dest = await tmp();
  const name = 'Fix: login bug #123';
  const wf = await writeKeyGraph({ name, keys: ['planner', 'implementer', 'reviewer'] });
  await applyExport({ workflowId: wf.id, destination: 'project', projectDir: dest, slug: 'yaml-test', onConflict: 'overwrite' });
  const skill = await readFile(join(dest, '.claude/skills/yaml-test/SKILL.md'), 'utf8');
  const fm = skill.slice(3, skill.indexOf('\n---', 4));                 // between the opening --- and its close
  const descLine = fm.split('\n').find((l) => l.startsWith('description:'));
  // Value is a single-quoted scalar carrying the full name (':' and '#' inside the quotes, not
  // interpreted), on ONE line — so nothing after ': ' or ' #' was dropped or turned into a key.
  assert.match(descLine, /^description: '.*'$/, 'description must be a single-quoted one-line scalar');
  assert.ok(descLine.includes(name), 'the full name (incl. ":" and "#") survives inside the quotes');
  // Every frontmatter mapping line is one of the two keys we emit — the injected ':' created none.
  for (const l of fm.split('\n')) {
    if (l === '' || l.startsWith(' ')) continue;
    assert.ok(/^(name|description): /.test(l), `unexpected frontmatter key from an unescaped scalar: ${l}`);
  }
});

// REGRESSION GUARD: exporting WITHOUT agents leaves the SKILL.md dispatching subagent_types whose
// .md files are never written — a runtime-only failure. buildExportSet must warn loudly.
test('includeAgents=false warns that dispatched agents are not exported', async () => {
  const dest = await tmp();
  const plan = await planExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest, includeAgents: false });
  assert.ok(
    (plan.warnings || []).some((w) => /agents NOT exported/i.test(w) && /worca-cc-planner/.test(w)),
    'a loud warning must name the un-exported dispatched agents',
  );
  // And no agent files are part of the plan.
  assert.equal([...plan.created, ...plan.updated].some((p) => p.includes(`${sep}agents${sep}`)), false);
});

// (Removed with the v1 engine: the "two feedback loops target one consumer" warning and
// the connectsTo-based "producer-aware review basename" heuristic. In v2 a consumer's
// review gate is whatever OUTPUT PORT its input is wired from — see the default-workflow
// test above, which proves reviewer→implementer resolves to impl-review and the refiner
// self-loop to refine-review straight from the ports/wires, no heuristic needed.)
