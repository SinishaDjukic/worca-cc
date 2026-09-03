// test/helpers/export-fixtures.mjs
// v2 graph + agent fixtures for the workflow-export suites. Before the Node-graph v2
// break these suites hand-built v1 `{ steps, feedbacks }` templates and v1-sidecar
// agents; the exporter now reads a node/wire graph with typed ports, so the v2
// equivalents are built here once instead of in every file.
import { writeGraphWorkflow } from '../../src/core/workflows.mjs';
import { createAgent } from '../../src/core/agent-store.mjs';
import { loadAgentRegistry } from '../../src/core/agent-registry.mjs';
import { portsFnFor, portsOf } from '../../src/shared/graph/ports.mjs';

// An agent's primary port: the first file-bearing, non-synthetic one; else the first
// non-synthetic port of any type. Used to wire a linear chain deterministically.
function primaryPort(list) {
  const real = (list || []).filter((p) => !p.synthetic);
  return real.find((p) => p.type !== 'void') || real[0] || null;
}

/**
 * Persist a v2 graph workflow from an ordered list of agent keys:
 * `task → keys[0] → keys[1] → … → end`, wiring each consecutive pair through a
 * best-effort compatible port (the exporter derives consumes/produces from these
 * wires). Returns the stored template row.
 * @param {{name:string, domain?:string, keys:string[], id?:string, registry?:object}} o
 */
export async function writeKeyGraph({ name, domain = 'coding', keys = [], id, createdAt, registry } = {}) {
  const portsFn = portsFnFor(registry || loadAgentRegistry());
  // Each key may be a bare string or `{ key, config }` (per-node model/effort/etc.).
  const spec = keys.map((k) => (typeof k === 'string' ? { key: k, config: {} } : { key: k.key, config: k.config || {} }));
  const nodes = [
    { id: 'n_task', kind: 'task', x: 0, y: 100, config: {} },
    ...spec.map((s, i) => ({ id: `n${i}_${s.key}`, kind: 'agent', key: s.key, x: 120 + i * 120, y: 100, config: s.config })),
    { id: 'n_end', kind: 'end', x: 120 + spec.length * 120, y: 100, config: {} },
  ];
  const outPort = (node) => primaryPort(portsOf(portsFn, node).outputs);
  const inPort = (node) => primaryPort(portsOf(portsFn, node).inputs);
  const wires = [];
  let w = 0;
  if (keys.length) {
    const first = nodes[1];
    wires.push({ id: `w${++w}`, from: { node: 'n_task', port: 'task' },
      to: { node: first.id, port: inPort(first)?.id || 'task' } });
    for (let i = 1; i < keys.length; i++) {
      const a = nodes[i], b = nodes[i + 1];
      const op = outPort(a), ip = inPort(b);
      if (op && ip) wires.push({ id: `w${++w}`, from: { node: a.id, port: op.id }, to: { node: b.id, port: ip.id } });
    }
    const last = nodes[keys.length];
    const op = outPort(last);
    if (op) wires.push({ id: `w${++w}`, from: { node: last.id, port: op.id }, to: { node: 'n_end', port: 'result' } });
  }
  return writeGraphWorkflow({ id, name, domain, nodes, wires, ...(createdAt ? { createdAt } : {}) });
}

/**
 * Persist a v2 graph from ordered LEVELS of agent keys — each inner array runs in
 * parallel at one topological rank: `task → level0 → level1 → … → end`. Every node in
 * level i is wired from the first node of level i-1 (so ranks match the level index).
 * @param {{name:string, domain?:string, levels:string[][], id?:string, registry?:object}} o
 */
export async function writeLevelsGraph({ name, domain = 'coding', levels = [], id, registry } = {}) {
  const portsFn = portsFnFor(registry || loadAgentRegistry());
  const nodes = [{ id: 'n_task', kind: 'task', x: 0, y: 100, config: {} }];
  levels.forEach((level, li) => level.forEach((k, ni) => {
    nodes.push({ id: `n${li}_${ni}_${k}`, kind: 'agent', key: k, x: 120 + li * 140, y: 60 + ni * 110, config: {} });
  }));
  nodes.push({ id: 'n_end', kind: 'end', x: 120 + levels.length * 140, y: 100, config: {} });
  const nodeAt = (li, ni) => nodes.find((n) => n.id === `n${li}_${ni}_${levels[li][ni]}`);
  const outPort = (node) => primaryPort(portsOf(portsFn, node).outputs);
  const inPort = (node) => primaryPort(portsOf(portsFn, node).inputs);
  const wires = [];
  let w = 0;
  levels.forEach((level, li) => level.forEach((k, ni) => {
    const node = nodeAt(li, ni);
    const src = li === 0 ? { node: 'n_task', port: 'task' } : (() => {
      const prev = nodeAt(li - 1, 0); const op = outPort(prev);
      return op ? { node: prev.id, port: op.id } : null;
    })();
    if (src) wires.push({ id: `w${++w}`, from: src, to: { node: node.id, port: inPort(node)?.id || 'task' } });
  }));
  for (const n of (levels[levels.length - 1] || []).map((_, ni) => nodeAt(levels.length - 1, ni))) {
    const op = outPort(n);
    if (op) wires.push({ id: `w${++w}`, from: { node: n.id, port: op.id }, to: { node: 'n_end', port: 'result' } });
  }
  return writeGraphWorkflow({ id, name, domain, nodes, wires });
}

/**
 * Create a v2 custom agent with sensible defaults (a producer with one md in/out).
 * Idempotent across a shared temp home (swallows DUPLICATE/BUILTIN). Returns the key.
 * @param {object} over meta overrides + `{ tools?:string, markdown?:string }`
 */
export async function createV2Agent(over = {}) {
  const key = over.key;
  const runnerType = over.runnerType || 'producer';
  const meta = {
    metaVersion: 2, key, displayName: over.displayName || key, description: over.description || `${key} agent`,
    runnerType, order: over.order ?? 50,
    inputs: over.inputs || [{ id: 'task', type: 'md' }],
    outputs: over.outputs || (runnerType === 'clarifier'
      ? [{ id: 'answers', type: 'json', filename: `${key}.json` }]
      : [{ id: 'out', type: 'md', filename: `${key}.md` }]),
  };
  if (runnerType === 'verifier') meta.verdict = over.verdict || { filename: `${key}-review-cycle{cycle}.json` };
  if (over.requiresSkills) meta.requiresSkills = over.requiresSkills;
  if (over.asksQuestions) meta.asksQuestions = true;
  if (over.scope) meta.scope = over.scope;
  if (over.fanOut) meta.fanOut = true;
  const markdown = over.markdown
    || `---\nname: ${key}\n${over.tools ? `tools: ${over.tools}\n` : ''}---\n# ${over.displayName || key}\nBody.\n`;
  try { await createAgent({ meta, markdown }); }
  catch (e) { if (e.code !== 'DUPLICATE' && e.code !== 'BUILTIN') throw e; }
  return key;
}
