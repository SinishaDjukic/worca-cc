// test/phases-agent-body.test.mjs
// Prompt resolution unification: the node's resolveGraph-loaded agentPrompt is
// the preferred system-prompt body; ctx.agentPrompts[key] is the fallback. This
// fixes the decomposer bug (agentPrompts had no `decomposer` key, so the system
// prompt came out EMPTY).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { resolveAgentBody, buildSystemPrompt } from '../src/core/phases.mjs';
import { writeGraphWorkflow, resolveGraph } from '../src/core/workflows.mjs';
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
  // The pre-fix path: no node prompt and no agentPrompts.decomposer.
  assert.equal(buildSystemPrompt('', resolveAgentBody({ agentPrompts: {} }, 'decomposer'), 'decomposer'), '');
});

test('SOURCE PIN: no phases.mjs runner builds its system prompt from ctx.agentPrompts directly', async () => {
  const src = await readFile(fileURLToPath(new URL('../src/core/phases.mjs', import.meta.url)), 'utf8');
  assert.equal(/buildSystemPrompt\(\s*ctx\.toolInstruction,\s*ctx\.agentPrompts/.test(src), false,
    'every run* must resolve its body via resolveAgentBody(ctx, key)');
});

const oneAgentGraph = (id, name, key) => ({
  id, name,
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_a', kind: 'agent', key, x: 240, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 480, y: 0, config: {} },
  ],
  wires: [],
});

test('resolveGraph stamps a NON-EMPTY agentPrompt on a decomposer node (end-to-end)', async () => {
  const wf = await writeGraphWorkflow(oneAgentGraph('wf_dec', 'Dec', 'decomposer'));
  const resolved = await resolveGraph('/tmp/whatever-proj', wf.id, loadAgentRegistry());
  assert.ok(resolved.nodes.n_a.agentPrompt.length > 100, 'worca-cc-decomposer.md body loaded onto the node');
});

test('a USER-layer agent .md (only in ~/.worca-cc/agents) reaches node.agentPrompt via agentPath', async () => {
  const dir = join(worcaHome(), 'agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'specWriter.md'), 'USER LAYER BODY: you write specs.\n');
  writeFileSync(join(dir, 'specWriter.meta.json'), JSON.stringify({
    key: 'specWriter', displayName: 'Spec Writer', description: 'd', color: 'green',
    icon: '<p/>', agentFile: 'specWriter.md', runnerType: 'producer', order: 42,
    metaVersion: 2,
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
  }));
  const wf = await writeGraphWorkflow(oneAgentGraph('wf_ul', 'UL', 'specWriter'));
  const resolved = await resolveGraph('/tmp/whatever-proj', wf.id, loadAgentRegistry());
  assert.equal(resolved.nodes.n_a.agentPrompt, 'USER LAYER BODY: you write specs.\n');
});

// C-1: a stamped agentPath that cannot be read is an EMPTY prompt — never the
// same basename resolved against the BUILT-IN agents dir, which would hand a
// plugin/user sidecar a built-in's prompt and its tool grants.
test('loadAgentFile never falls back from a stamped agentPath into the built-in dir', async () => {
  const { loadAgentFile } = await import('../src/core/workflows.mjs');
  const { DEFAULT_AGENTS_DIR } = await import('../src/core/agent-registry.mjs');
  const r = await loadAgentFile(DEFAULT_AGENTS_DIR, 'worca-cc-manual-web-ui-testing.md',
    join(worcaHome(), 'plugins', 'evil', 'current', 'agents', 'worca-cc-manual-web-ui-testing.md'));
  assert.deepEqual(r, { prompt: '', tools: [] });
  // the hand-built-registry path (no agentPath) still joins onto agentsDir
  const b = await loadAgentFile(DEFAULT_AGENTS_DIR, 'worca-cc-planner.md', null);
  assert.ok(b.prompt.length > 0 && b.tools.includes('Read'));
});
