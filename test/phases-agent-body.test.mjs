// test/phases-agent-body.test.mjs
// Prompt resolution unification: the node's resolveWorkflow-loaded agentPrompt is
// the preferred system-prompt body; ctx.agentPrompts[key] and FALLBACK_PROMPTS stay
// as fallbacks. This fixes the decomposer bug (agentPrompts had no `decomposer` key
// and FALLBACK_PROMPTS has no `decomposer` role => EMPTY system prompt).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { resolveAgentBody, buildSystemPrompt } from '../src/core/phases.mjs';
import { writeWorkflow, resolveWorkflow } from '../src/core/workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after);

test('resolveAgentBody prefers node.agentPrompt, falls back to ctx.agentPrompts[key]', () => {
  assert.equal(resolveAgentBody({ node: { agentPrompt: 'NODE BODY' }, agentPrompts: { planner: 'BULK' } }, 'planner'), 'NODE BODY');
  assert.equal(resolveAgentBody({ node: { agentPrompt: '   ' }, agentPrompts: { planner: 'BULK' } }, 'planner'), 'BULK');
  assert.equal(resolveAgentBody({ agentPrompts: { planner: 'BULK' } }, 'planner'), 'BULK');
  assert.equal(resolveAgentBody({}, 'planner'), undefined);
});

test('decomposer bug: node.agentPrompt now reaches the system prompt (was empty)', () => {
  const sp = buildSystemPrompt('', resolveAgentBody({ node: { agentPrompt: 'You are the Decomposer.' }, agentPrompts: {} }, 'decomposer'), 'decomposer');
  assert.match(sp, /You are the Decomposer\./);
  // The pre-fix path: no node prompt, no agentPrompts.decomposer, no FALLBACK role.
  assert.equal(buildSystemPrompt('', resolveAgentBody({ agentPrompts: {} }, 'decomposer'), 'decomposer'), '');
});

test('SOURCE PIN: no phases.mjs runner builds its system prompt from ctx.agentPrompts directly', async () => {
  const src = await readFile(fileURLToPath(new URL('../src/core/phases.mjs', import.meta.url)), 'utf8');
  assert.equal(/buildSystemPrompt\(\s*ctx\.toolInstruction,\s*ctx\.agentPrompts/.test(src), false,
    'every run* must resolve its body via resolveAgentBody(ctx, key)');
});

test('resolveWorkflow stamps a NON-EMPTY agentPrompt on a decomposer node (end-to-end)', async () => {
  const wf = await writeWorkflow({ name: 'Dec', steps: [[{ id: 's0', key: 'decomposer' }]], feedbacks: [] });
  const plan = await resolveWorkflow('/tmp/whatever-proj', wf.id, loadAgentRegistry());
  const node = plan.steps[0][0];
  assert.ok(node.agentPrompt.length > 100, 'worca-cc-decomposer.md body loaded onto the node');
});

test('a USER-layer agent .md (only in ~/.worca-cc/agents) reaches node.agentPrompt via agentPath', async () => {
  const dir = join(worcaHome(), 'agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'specWriter.md'), 'USER LAYER BODY: you write specs.\n');
  writeFileSync(join(dir, 'specWriter.meta.json'), JSON.stringify({
    key: 'specWriter', displayName: 'Spec Writer', description: 'd', color: 'green',
    icon: '<p/>', agentFile: 'specWriter.md', runnerType: 'producer', loopSource: false,
    produces: ['plan'], consumes: ['userPrompt'], connectsTo: '*', order: 42,
  }));
  const wf = await writeWorkflow({ name: 'UL', steps: [[{ id: 's0', key: 'specWriter' }]], feedbacks: [] });
  const plan = await resolveWorkflow('/tmp/whatever-proj', wf.id, loadAgentRegistry());
  assert.equal(plan.steps[0][0].agentPrompt, 'USER LAYER BODY: you write specs.\n');
});
