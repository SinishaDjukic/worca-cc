// test/investigator-pin.test.mjs
// Pinned investigators (D19): a fan-out node with a sub-agent EFFORT pin spawns its children as a
// run-scoped `worca-investigator` definition (--agents: read-only tools, pinned model + effort),
// because Claude Code sets a sub-agent's effort only from its definition.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { buildClaudeArgs, planClaudeInvocation } from '../src/core/claude-runner.mjs';
import { INVESTIGATOR_AGENT, ctxSubagentEffort, investigatorAgents, fanOutDirective, runOpts } from '../src/core/phases.mjs';
import { resolveGraph } from '../src/core/workflows.mjs';
import { loadAgentRegistry, DEFAULT_AGENTS_DIR } from '../src/core/agent-registry.mjs';
import { createOrchestrator, resolvedFromManifest } from '../src/core/orchestrator.mjs';
import { buildGraphManifest } from '../src/shared/graph/manifest.mjs';
import { buildAgentPrompt, allocateOutputs, allocateVerdict } from '../src/core/graph/executor.mjs';

useTempHome(after);
process.env.WORCA_HOST_GUARD = '0';
const dirs = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-invpin-')); dirs.push(d); return d; };

const DEF = { [INVESTIGATOR_AGENT]: { description: 'd', prompt: 'p', tools: ['Read'], model: 'sonnet', effort: 'medium' } };
const pinned = (extra = {}) => ({ node: { fanOut: true, subagentModel: 'opus', subagentEffort: 'high', ...extra } });

test('buildClaudeArgs: --agents rides just before --add-dir; absent keeps the argv byte-identical', () => {
  const base = { prompt: 'p', permissionMode: 'acceptEdits', addDirs: ['/m'] };
  const plain = buildClaudeArgs(base);
  assert.deepEqual(buildClaudeArgs({ ...base, agents: undefined }), plain);
  assert.deepEqual(buildClaudeArgs({ ...base, agents: {} }), plain, 'an empty map is nothing');
  const withAgents = buildClaudeArgs({ ...base, agents: DEF });
  const i = withAgents.indexOf('--agents');
  assert.ok(i > -1);
  assert.deepEqual(JSON.parse(withAgents[i + 1]), DEF);
  assert.equal(withAgents.indexOf('--add-dir'), i + 2, '--add-dir stays last');
});

// Claude Code reads `--agents <file>` only from 2.1.281; the Docker image pins 2.1.278, which
// JSON-parses the value and exits at spawn. So the definition stays inline JSON on the staged
// (over-limit) branch too — only the prompt, system prompt and settings move off the argv.
test('planClaudeInvocation keeps --agents inline JSON on the over-limit branch (never a file)', async () => {
  const dir = await tmp();
  const plan = planClaudeInvocation({ prompt: 'x', systemPrompt: 's'.repeat(30000), permissionMode: 'acceptEdits', agents: DEF }, { dir, limit: 20000 });
  assert.equal(plan.staged, true, 'over the limit: the system prompt is staged');
  assert.ok(plan.files.some((f) => f.path === join(dir, 'system-prompt.md')), 'system prompt staged');
  assert.ok(!plan.files.some((f) => /agents/.test(f.path)), 'no agents file');
  assert.deepEqual(JSON.parse(plan.args[plan.args.indexOf('--agents') + 1]), DEF, 'inline JSON');
  assert.ok(!plan.args.some((a) => a.length > 1000), 'the staged argv carries no long free text (the definition is short)');
});

test('ctxSubagentEffort / investigatorAgents: fan-out + a valid effort pin only', () => {
  assert.equal(ctxSubagentEffort(pinned()), 'high');
  assert.equal(ctxSubagentEffort(pinned({ fanOut: false })), '');
  assert.equal(ctxSubagentEffort(pinned({ subagentEffort: 'turbo' })), '');
  assert.equal(investigatorAgents(pinned({ subagentEffort: '' })), undefined);
  const def = investigatorAgents(pinned())[INVESTIGATOR_AGENT];
  assert.equal(def.model, 'opus');
  assert.equal(def.effort, 'high');
  assert.deepEqual(def.tools, ['Read', 'Grep', 'Glob', 'Bash', 'Skill']);
  assert.equal(investigatorAgents(pinned({ endpointRouted: true }))[INVESTIGATOR_AGENT].model, undefined,
    'a routed node pins no model: the child rides the node\'s endpoint');
  assert.equal(investigatorAgents(pinned({ subagentModel: 'auto' }))[INVESTIGATOR_AGENT].model, undefined, 'no alias -> no model key');
});

test('runOpts carries agents only for a pinned node', () => {
  const call = { role: 'r', prompt: 'p', systemPrompt: 's', allowedTools: ['Read'] };
  assert.ok(runOpts({ ...pinned(), claudeOpts: {}, projectDir: '/x' }, call).agents[INVESTIGATOR_AGENT]);
  assert.equal(runOpts({ node: { fanOut: true }, claudeOpts: {}, projectDir: '/x' }, call).agents, undefined);
});

test('fanOutDirective: a pinned investigator replaces the BEST-FIT sentence; default bytes unchanged', () => {
  const plain = fanOutDirective(true, { subagentModel: 'opus' });
  const withPin = fanOutDirective(true, { subagentModel: 'opus', investigator: true });
  assert.match(withPin, /subagent_type: "worca-investigator"/);
  assert.doesNotMatch(withPin, /BEST-FIT/);
  assert.match(plain, /BEST-FIT/);
  assert.equal(fanOutDirective(true, { subagentModel: 'opus', investigator: false }), plain);
});

test('resolveGraph: subagentPin pins subagentModel + subagentEffort; an off-list alias is ignored', async () => {
  const projectDir = await tmp();
  const reg = loadAgentRegistry();
  const r = await resolveGraph(projectDir, 'wf_workspace_scan', reg, DEFAULT_AGENTS_DIR, { isWorkspace: true, subagentPin: { model: 'fable', effort: 'xhigh' } });
  assert.equal(r.nodes.n_scan.subagentModel, 'fable');
  assert.equal(r.nodes.n_scan.subagentEffort, 'xhigh');
  const bad = await resolveGraph(projectDir, 'wf_workspace_scan', reg, DEFAULT_AGENTS_DIR, { isWorkspace: true, subagentPin: { model: 'haiku', effort: 'xhigh' } });
  assert.notEqual(bad.nodes.n_scan.subagentModel, 'haiku', 'only sonnet | opus | fable pin');
  const plain = await resolveGraph(projectDir, 'wf_default', reg, DEFAULT_AGENTS_DIR, {});
  for (const nc of Object.values(plain.nodes)) if (nc.kind === 'agent') assert.equal(nc.subagentEffort, '', 'no pin, no template value -> none');
});

// The wiring between the resolved node and the spawn: without these, the pin could reach the
// manifest (what Task 8's tests read) and still never reach a dispatched ctx or the prompt.
test('the pin reaches the dispatched ctx (_execCtx) and survives a manifest round trip (resume)', async () => {
  const reg = loadAgentRegistry();
  const r = await resolveGraph(await tmp(), 'wf_workspace_scan', reg, DEFAULT_AGENTS_DIR, { isWorkspace: true, subagentPin: { model: 'opus', effort: 'high' } });
  const manifest = buildGraphManifest(r.template, r.agentsByKey, { overlays: { nodes: r.nodes, wires: r.wires } });
  assert.equal(resolvedFromManifest(manifest, reg).nodes.n_scan.subagentEffort, 'high', 'resume rebuild keeps the pin');
  const repo = await tmp();
  const g = (a) => spawnSync('git', a, { cwd: repo });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(repo, 'README.md'), '# hi\n'); g(['add', '-A']); g(['commit', '-qm', 'init']);
  const orch = createOrchestrator({ projectDir: repo, prompt: 'x', auto: true, claude: { mock: true } });
  orch.pipeline = { id: 'p1', dir: await tmp(), promptText: 'x' };
  orch.resolved = { ports: () => ({ inputs: [], outputs: [] }) };
  const ctx = orch._execCtx({ id: 'n_scan', kind: 'agent', key: 'workspaceScanner', config: {} }, r.nodes.n_scan, { executionId: 'x:n_scan:1', ordinal: 1 });
  assert.equal(ctx.node.subagentEffort, 'high');
  assert.equal(investigatorAgents(ctx)[INVESTIGATOR_AGENT].effort, 'high');
});

test('the executor prompt dispatches worca-investigator for a pinned node', async () => {
  const r = await resolveGraph(await tmp(), 'wf_workspace_scan', loadAgentRegistry(), DEFAULT_AGENTS_DIR, { isWorkspace: true, subagentPin: { model: 'opus', effort: 'high' } });
  const pipelineDir = await tmp();
  const nc = r.nodes.n_scan;
  const node = { id: 'n_scan', kind: 'agent', key: 'workspaceScanner', config: {}, fanOut: true, subagentModel: nc.subagentModel, subagentEffort: nc.subagentEffort, agentPrompt: 'x', tools: [] };
  const ports = r.ports(node);
  const runCtx = { pipelineDir, projectDir: pipelineDir, baseName: 'f', datePrefix: '01-01-26', planVersion: () => 1 };
  const base = { node, nodeId: 'n_scan', executionId: 'x:n_scan:1', ordinal: 1, cycle: 1, template: r.template, ports, meta: ports,
    bindings: { task: { type: 'md', path: '/abs/task.md' } }, trigger: { wireIds: [], freshPorts: ['task'] },
    outputs: allocateOutputs({ node, ports, ordinal: 1, runCtx }), verdict: allocateVerdict({ node, ports, ordinal: 1, runCtx }),
    expandsPort: null, runCtx, priorAnswers: [], projectDir: pipelineDir, pipelineDir, taskPrompt: 'scan', toolInstruction: 'T',
    extras: [], checkpointRef: 'abc', workspace: null, agentPrompts: {}, claudeOpts: { mock: true } };
  const p = buildAgentPrompt(base);
  assert.match(p, /subagent_type: "worca-investigator"/);
  assert.doesNotMatch(p, /BEST-FIT/);
  assert.match(buildAgentPrompt({ ...base, node: { ...node, subagentEffort: '' } }), /BEST-FIT/);
});
