// test/phases-agent-body.test.mjs
// Prompt resolution unification: the node's resolveGraph-loaded agentPrompt is the
// preferred system-prompt body and ctx.agentPrompts[key] is the fallback. The v1
// FALLBACK_PROMPTS role table died with the per-role runners — an empty body now
// falls through to ONE generic last-resort line.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { resolveAgentBody, buildSystemPrompt } from '../src/core/phases.mjs';
import { writeWorkflow, resolveGraph } from '../src/core/workflows.mjs';
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
});

test('an empty body falls through to the ONE generic last-resort line', () => {
  const meta = {
    displayName: 'Split Plan', description: 'Splits a plan into tasks.',
    inputs: [{ id: 'plan' }], outputs: [{ id: 'tasks' }],
  };
  const sp = buildSystemPrompt('', resolveAgentBody({ agentPrompts: {} }, 'decomposer'), 'decomposer', undefined, meta);
  assert.equal(sp, 'You are the "Split Plan" agent. Splits a plan into tasks. It reads: plan. It writes: tasks.');
  // No meta at all: still a sentence, still no role lookup.
  assert.equal(buildSystemPrompt('', undefined, 'decomposer'), 'You are the "decomposer" agent.');
});

test('SOURCE PIN: nothing builds its system prompt from ctx.agentPrompts directly', async () => {
  for (const rel of ['../src/core/phases.mjs', '../src/core/graph/executor.mjs']) {
    const src = await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    assert.equal(/buildSystemPrompt\(\s*ctx\.toolInstruction,\s*ctx\.agentPrompts/.test(src), false,
      `${rel} must resolve its body via resolveAgentBody(ctx, key)`);
  }
});

test('resolveGraph stamps a NON-EMPTY agentPrompt on a decomposer node (end-to-end)', async () => {
  const wf = await writeWorkflow({
    name: 'Dec', version: 2,
    nodes: [{ id: 'n_dec', kind: 'agent', key: 'decomposer', x: 0, y: 0 }], wires: [],
  });
  const { nodeCtx } = await resolveGraph('/tmp/whatever-proj', wf.id, loadAgentRegistry());
  assert.ok(nodeCtx.n_dec.agentPrompt.length > 100, 'worca-cc-decomposer.md body loaded onto the node');
});

test('a USER-layer agent .md (only in ~/.worca-cc/agents) reaches node.agentPrompt via agentPath', async () => {
  const dir = join(worcaHome(), 'agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'specWriter.md'), 'USER LAYER BODY: you write specs.\n');
  writeFileSync(join(dir, 'specWriter.meta.json'), JSON.stringify({
    metaVersion: 2,
    key: 'specWriter', displayName: 'Spec Writer', description: 'd', color: 'green',
    icon: '<p/>', agentFile: 'specWriter.md', runnerType: 'producer',
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
    order: 42,
  }));
  const wf = await writeWorkflow({
    name: 'UL', version: 2,
    nodes: [{ id: 'n_spec', kind: 'agent', key: 'specWriter', x: 0, y: 0 }], wires: [],
  });
  const { nodeCtx } = await resolveGraph('/tmp/whatever-proj', wf.id, loadAgentRegistry());
  assert.equal(nodeCtx.n_spec.agentPrompt, 'USER LAYER BODY: you write specs.\n');
});
