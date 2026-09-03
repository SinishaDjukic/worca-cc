import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyExport } from '../src/core/workflow-export.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeKeyGraph, createV2Agent } from './helpers/export-fixtures.mjs';

useTempHome(after);

const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'wf-exp-ag-')); dirs.push(d); return d; };
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

test('every subagent_type dispatched in SKILL.md has a matching agent .md whose name is identical', async () => {
  const dest = await tmp();
  await applyExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const skill = await readFile(join(dest, '.claude/skills/default/SKILL.md'), 'utf8');
  const dispatched = [...skill.matchAll(/Dispatch `([^`]+)`/g)].map((m) => m[1]);
  assert.ok(dispatched.length >= 5);
  for (const name of dispatched) {
    const md = await readFile(join(dest, `.claude/agents/${name}.md`), 'utf8');
    assert.match(md, new RegExp(`^---\\nname: ${name}\\n`, 'm'));
  }
});

test('agent body carries the console-adaptation preamble', async () => {
  const dest = await tmp();
  await applyExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const planner = await readFile(join(dest, '.claude/agents/worca-cc-planner.md'), 'utf8');
  assert.match(planner, /## Console adaptation \(read first\)/);
  assert.match(planner, /The absolute file paths in your dispatch prompt are authoritative/);
});

// REGRESSION GUARD (#6): a node that declares ONLY AskUserQuestion must NOT be refused. That
// tool is compatible-via-hoist (the ask-user hoist), not a dropped subagent-incompatible tool,
// so it must be excluded from the "all tools stripped" refusal — the agent inherits all tools.
test('an ask-only node (declares only AskUserQuestion) exports and inherits tools', async () => {
  const dest = await tmp();
  await createV2Agent({
    key: 'askOnlyExp', displayName: 'Ask Only', description: 'asks only',
    runnerType: 'clarifier', asksQuestions: true, order: 0, tools: 'AskUserQuestion',
  });
  const tpl = await writeKeyGraph({ name: 'Ask Only Flow', keys: ['askOnlyExp', 'planner'] });
  await applyExport({ workflowId: tpl.id, destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const md = await readFile(join(dest, '.claude/agents/askOnlyExp.md'), 'utf8');   // stem = key (store-owned)
  assert.doesNotMatch(md, /^tools:/m, 'no tools: line → inherits all tools (declared none but the hoisted ask tool)');
});

// REGRESSION GUARD (#1): a node declaring AskUserQuestion ALONGSIDE another subagent-incompatible
// tool (e.g. Workflow) must be treated like an ask-only node — AskUserQuestion is compatible-via-
// hoist, so the export must not abort. The other stripped tool is warned about, not fatal.
test('a node declaring AskUserQuestion + another stripped tool exports (does not abort)', async () => {
  const dest = await tmp();
  await createV2Agent({
    key: 'askPlusExp', displayName: 'Ask Plus', description: 'asks + workflow',
    runnerType: 'clarifier', asksQuestions: true, order: 0, tools: 'AskUserQuestion, Workflow',
  });
  const tpl = await writeKeyGraph({ name: 'Ask Plus Flow', keys: ['askPlusExp', 'planner'] });
  const applied = await applyExport({ workflowId: tpl.id, destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const md = await readFile(join(dest, '.claude/agents/askPlusExp.md'), 'utf8');
  assert.doesNotMatch(md, /^tools:/m, 'all declared tools stripped → no tools: line → inherits all');
  assert.ok(applied.warnings.some((w) => /Workflow/.test(w)), 'the dropped Workflow tool is warned about');
});

test('model baked to frontmatter; effort as prose and never without a model', async () => {
  const dest = await tmp();
  const tpl = await writeKeyGraph({
    name: 'Model Effort',
    keys: [
      { key: 'planner', config: { model: 'opus', effort: 'high' } },
      { key: 'implementer', config: { effort: 'high' } },
      'reviewer',
    ],
  });
  await applyExport({ workflowId: tpl.id, destination: 'project', projectDir: dest, onConflict: 'overwrite' });

  const planner = await readFile(join(dest, '.claude/agents/worca-cc-planner.md'), 'utf8');
  assert.match(planner, /^model: opus$/m);                       // model baked
  assert.match(planner, /Work at \*\*high\*\* effort\./);        // effort as prose

  const impl = await readFile(join(dest, '.claude/agents/worca-cc-implementer.md'), 'utf8');
  assert.doesNotMatch(impl, /^model:/m);                          // no model line
  assert.doesNotMatch(impl, /Work at \*\*high\*\* effort\./);     // effort-without-model dropped

  // SKILL.md mirrors: planner gets a Model + Effort line; implementer neither.
  const skill = await readFile(join(dest, '.claude/skills/model-effort/SKILL.md'), 'utf8');
  const plannerBlock = skill.slice(skill.indexOf('Dispatch `worca-cc-planner`'), skill.indexOf('Dispatch `worca-cc-implementer`'));
  assert.match(plannerBlock, /Model: dispatch with `model: opus`/);
  assert.match(plannerBlock, /Effort: instruct the subagent to work at \*\*high\*\*/);
});
