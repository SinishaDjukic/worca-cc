// test/helpers/prompt-ctx.mjs
// The ctx `runAgentExecution` hands buildAgentPrompt, assembled from the REAL agents/*.meta.json sidecars —
// shared by the prompt parity pin and the prompt behaviour tests. Never a fixture.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentRegistry } from '../../src/core/agent-registry.mjs';
import { registryPortsFn } from '../../src/core/graph/registry-ports.mjs';
import { allocateOutputs, allocateVerdict, expandsOutputPort } from '../../src/core/graph/executor.mjs';

export const AGENTS_DIR = fileURLToPath(new URL('../../agents/', import.meta.url));
/** Builtin layer only — the eight presentation-domain builtins (wf_presentation) are not part of the
 *  coding-prompt pin, so they are excluded. */
const RAW_REGISTRY = loadAgentRegistry(AGENTS_DIR, { userAgentsDir: null, includePlugins: false });
export const REGISTRY = Object.fromEntries(Object.entries(RAW_REGISTRY).filter(([, m]) => m.domain !== 'presentation'));
export const portsFn = registryPortsFn(REGISTRY);

export const TASK_PROMPT = 'BUILD THE THING';
export const ORDINAL = 2;                       // proves {cycle} still renders the cycle

// Only two wire facts matter to the prompt: which ports a `kind:'task'` node feeds
// (the request/attachments gate), and which output lands on an `expands` input (the
// decomposer's contract block + MOCK markers). Everything else is sidecar data.

export const nodeId = (key) => `n_${key}`;
export const BUILTIN_KEYS = Object.keys(REGISTRY).sort();

export const PARITY_TPL = {
  id: 'wf_parity', name: 'Parity', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    ...BUILTIN_KEYS.map((key, i) => ({ id: nodeId(key), kind: 'agent', key, x: 200 + i * 40, y: 0, config: {} })),
  ],
  wires: [
    { id: 'w_t_clarify', from: { node: 'n_task', port: 'task' }, to: { node: nodeId('clarify'), port: 'task' } },
    { id: 'w_t_planner', from: { node: 'n_task', port: 'task' }, to: { node: nodeId('planner'), port: 'task' } },
    { id: 'w_dec_impl', from: { node: nodeId('decomposer'), port: 'tasks' }, to: { node: nodeId('implementer'), port: 'task' } },
  ],
};

/** The frontmatter `tools:` line of an agent .md — what resolveGraph stamps onto
 *  `node.tools` in production (workflows.mjs#parseFrontmatterTools, private). */
export function frontmatterTools(key) {
  const file = REGISTRY[key].agentFile;
  const text = readFileSync(join(AGENTS_DIR, file), 'utf8');
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  const line = m ? m[1].split(/\r?\n/).find((l) => /^tools\s*:/.test(l)) : null;
  return line ? line.replace(/^tools\s*:/, '').split(',').map((s) => s.trim()).filter(Boolean) : [];
}

const tok = (over = {}) => ({ seq: 1, type: 'md', ...over });

/** Bind a port to a plausible absolute artifact path; a void port binds a
 *  payload-free token (which is exactly what an `as:'worktree'` input gets). */
function bind(port) {
  if (port.type === 'void') return tok({ type: 'void' });
  return tok({ type: port.type, path: `/abs/${port.id}.${port.type === 'json' ? 'json' : 'md'}` });
}

/**
 * `ctxFor(key, opts)` over the given scratch dirs: the ctx `runAgentExecution` hands its builder, assembled
 * the way `prepare` does — real sidecar meta, real allocation, graph-derived expands port. `only` names the
 * ports to bind; absent it, every REQUIRED input is bound (the steady-state first execution). Optional
 * inputs (the reviewer's `as:'worktree'` `done`, the planner's `answers`/`revise`) are bound only when named.
 */
export function makeCtxFor({ pipelineDir, projectDir }) {
  return function ctxFor(key, { only = null, workspace = null, extras = [], slice = null, runRoot = null } = {}) {
    const meta = REGISTRY[key];
    const node = {
      id: nodeId(key), kind: 'agent', key, x: 0, y: 0, config: {},
      fanOut: !!meta.fanOut, agentPrompt: `You are ${meta.displayName}.`, tools: frontmatterTools(key),
    };
    const ports = portsFn(node);                 // spreads the meta: ports.verdict IS the sidecar block
    let v = 0;
    const runCtx = {
      pipelineDir, projectDir, baseName: 'feature', datePrefix: '01-01-26',
      workspaceKey: null, duplicateKey: false, slice: slice?.id ?? null,
      planVersion: () => { v += 1; return v; },
    };
    const chosen = (ports.inputs || []).filter((p) => p.id !== 'await' && (only ? only.includes(p.id) : p.required));
    const bindings = {};
    for (const port of chosen) bindings[port.id] = bind(port);
    const executionId = `x:${node.id}:${ORDINAL}`;
    return {
      node, nodeId: node.id, ports, meta, bindings,
      trigger: { wireIds: [], freshPorts: Object.keys(bindings) },
      ordinal: ORDINAL, cycle: ORDINAL, executionId, runCtx, slice,
      outputs: allocateOutputs({ node, ports, executionId, ordinal: ORDINAL, runCtx }),
      verdict: allocateVerdict({ node, ports, ordinal: ORDINAL, runCtx }),
      expandsPort: expandsOutputPort(PARITY_TPL, portsFn, node.id),
      projectDir, pipelineDir, taskPrompt: TASK_PROMPT, toolInstruction: 'TOOLS',
      checkpointRef: 'abc1234', extras, workspace, runRoot, template: PARITY_TPL,
      priorAnswers: [], agentPrompts: {}, claudeOpts: { mock: true },
    };
  };
}
