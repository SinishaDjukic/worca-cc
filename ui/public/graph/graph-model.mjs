// ui/public/graph/graph-model.mjs
// The composer's model layer: v2 template normalize/serialize, the node/wire
// factory, client-side wiring legality (canWire) and a live validate adapter.
//
// DUPLICATE-PURE-FUNCTION POLICY. `ui/public` cannot import from `src/core` —
// this is a no-build browser module family. So the engine's small pure
// functions are duplicated here BYTE-IDENTICALLY: `AWAIT_PORT` and the
// flow-port synthesis (src/core/graph/fixtures.mjs), `classifyLoops` +
// `resolveOrOutType` (src/core/graph/ports.mjs) and `validateGraph`
// (src/core/graph/validate.mjs). One authored definition, one policy-sanctioned
// copy, both covered by the SAME fixture assertions plus a `toString()` drift
// guard in test/ui-graph-model.test.mjs. The server stays authoritative: the
// composer only needs V21/V9-class feedback live (Save disables from the
// adapter's errors) while POST /api validation has the final word (422).
//
// Everything here is pure — no DOM, no fetch — so it unit-tests under node:test
// without jsdom.

// ------------------------------------------------------------ engine mirrors

/** The universal synthesized agent input, mirrored from the engine byte-for-byte. */
export const AWAIT_PORT = Object.freeze({ id: 'await', type: 'any', required: false, synthetic: true });

/** Build the ports function over a static port map keyed by agent key: agents
 *  get their table entry plus the synthesized `await` input appended last;
 *  task/end/and/or/combine get their flow ports. */
export function portsFnFor(fixturePorts) {
  return (node) => {
    if (node.kind === 'agent') {
      const m = fixturePorts[node.key];
      if (!m) return m;                      // unknown key — V4's problem; keep the dangling-meta no-crash contract
      return { ...m, inputs: [...m.inputs, AWAIT_PORT] };
    }
    if (node.kind === 'task') {
      return { inputs: [], outputs: [{ id: 'task', type: 'md', when: 'always' }] };
    }
    if (node.kind === 'end') {
      return { inputs: [{ id: 'result', type: 'any', required: true }], outputs: [] };
    }
    if (node.kind === 'and' || node.kind === 'or' || node.kind === 'combine') {
      const arity = node.config?.arity ?? 2;
      const ins = Array.from({ length: arity }, (_, i) => ({
        id: `in${i + 1}`, type: node.kind === 'combine' ? 'md' : 'any', required: true,
      }));
      const out = {   // combine md · or 'any' (resolved later by resolveOrOutType) · and void
        id: 'out', type: node.kind === 'combine' ? 'md' : node.kind === 'or' ? 'any' : 'void', when: 'always',
      };
      return { inputs: ins, outputs: [out] };
    }
    return undefined;                        // unknown kind — V3's problem
  };
}

/**
 * Classify a template's loops and compute the launch order.
 *
 * A **loop wire** (budget + amber styling) is a wire whose endpoints sit in the
 * same nontrivial SCC — or a self-wire — AND whose source output is
 * `when: 'blocking'`. A **loop input** (firing semantics) is any input declared
 * `loop: true` in meta; it is wiring-independent, so an unwired one still lands
 * in the set.
 *
 * @param {object} template  v2 template { nodes, wires }
 * @param {(node:object) => ({inputs?:Array, outputs?:Array}|undefined)} portsFn
 * @returns {{loopWires:Set<string>, loopInputs:Set<string>, sccs:string[][], order:string[]}}
 *          `loopInputs` and `order` are graph-global (`'<nodeId>.<port>'` / node ids).
 */
export function classifyLoops(template, portsFn) {
  const nodes = Array.isArray(template?.nodes) ? template.nodes : [];
  const allWires = Array.isArray(template?.wires) ? template.wires : [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  // Dangling endpoints are V5's problem — never crash here (the validator
  // collects ALL violations, so it must be able to reach them).
  const wires = allWires.filter((w) => nodeById.has(w?.from?.node) && nodeById.has(w?.to?.node));

  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const w of wires) adj.get(w.from.node).push(w.to.node);
  for (const tos of adj.values()) tos.sort();          // determinism of the SCC list itself

  const sccs = tarjan(adj);
  const sccOf = new Map();
  sccs.forEach((scc, i) => scc.forEach((id) => sccOf.set(id, i)));
  const nontrivial = new Set(sccs.map((scc, i) => (scc.length > 1 ? i : -1)).filter((i) => i >= 0));
  const selfWired = new Set(wires.filter((w) => w.from.node === w.to.node).map((w) => w.from.node));

  const loopWires = new Set();
  for (const w of wires) {
    const sameScc = sccOf.get(w.from.node) === sccOf.get(w.to.node)
      && (nontrivial.has(sccOf.get(w.from.node)) || selfWired.has(w.from.node));
    if (!sameScc) continue;
    // An unknown agent key resolves to no meta — guard, don't crash (V4 owns the error).
    const out = (portsFn(nodeById.get(w.from.node))?.outputs || []).find((o) => o.id === w.from.port);
    if (out && out.when === 'blocking') loopWires.add(w.id);   // blocking-source rule
  }

  // Loop INPUTS come from meta `loop: true`, never from wiring. This pass calls
  // portsFn on EVERY node, so the no-meta guard here is not cycle-specific.
  const loopInputs = new Set();
  for (const n of nodes) {
    for (const inp of portsFn(n)?.inputs || []) {
      if (inp.loop) loopInputs.add(`${n.id}.${inp.id}`);
    }
  }

  return { loopWires, loopInputs, sccs, order: condensationTopo(sccs, adj) };
}

/**
 * The or card's payload type, resolved from its inbound wires' source output
 * types. Inbound types must be homogeneous — that is V12's error to report; this
 * returns the first resolvable one, walking the inbound wires by `inK` index and
 * then by wire id so the answer never depends on wire insertion order. Chained
 * or cards resolve through (seen-set guarded, so a cyclic or→or chain with no
 * external source resolves to null instead of hanging).
 *
 * @param {object} node  the or node
 * @param {object} template  v2 template { nodes, wires }
 * @param {(node:object) => ({outputs?:Array}|undefined)} portsFn
 * @returns {'md'|'json'|'void'|string|null}  null when unresolvable
 */
export function resolveOrOutType(node, template, portsFn) {
  const nodes = Array.isArray(template?.nodes) ? template.nodes : [];
  const wires = Array.isArray(template?.wires) ? template.wires : [];
  return resolveOrType(node, new Map(nodes.map((n) => [n.id, n])), wires, portsFn, new Set());
}

function resolveOrType(node, nodeById, wires, portsFn, seen) {
  if (!node || seen.has(node.id)) return null;
  seen.add(node.id);
  const inbound = wires
    .filter((w) => w?.to?.node === node.id)
    .sort((a, b) => portIndex(a.to.port) - portIndex(b.to.port) || compareIds(a.id, b.id));
  for (const w of inbound) {
    const src = nodeById.get(w?.from?.node);
    if (!src) continue;                                        // dangling endpoint — V5's problem
    const out = (portsFn(src)?.outputs || []).find((o) => o.id === w.from.port);
    if (!out) continue;
    if (out.type && out.type !== 'any') return out.type;
    // An 'any' source is another or card — resolve THROUGH it.
    if (src.kind === 'or') {
      const through = resolveOrType(src, nodeById, wires, portsFn, seen);
      if (through) return through;
    }
  }
  return null;
}

/**
 * Tarjan's SCC, iterative (an explicit stack — the graphs are small, but
 * recursion depth is not a property worth depending on). Roots are visited in
 * sorted-nodeId order and each component is returned sorted, so the result is
 * reproducible run to run.
 *
 * @param {Map<string, string[]>} adj
 * @returns {string[][]}
 */
function tarjan(adj) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  let counter = 0;

  for (const root of [...adj.keys()].sort()) {
    if (index.has(root)) continue;
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);
    const work = [{ id: root, edges: adj.get(root) || [], at: 0 }];

    while (work.length) {
      const frame = work[work.length - 1];
      if (frame.at < frame.edges.length) {
        const next = frame.edges[frame.at];
        frame.at += 1;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ id: next, edges: adj.get(next) || [], at: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.id, Math.min(low.get(frame.id), index.get(next)));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].id;
        low.set(parent, Math.min(low.get(parent), low.get(frame.id)));
      }
      if (low.get(frame.id) === index.get(frame.id)) {
        const scc = [];
        for (;;) {
          const id = stack.pop();
          onStack.delete(id);
          scc.push(id);
          if (id === frame.id) break;
        }
        sccs.push(scc.sort());
      }
    }
  }
  return sccs;
}

/**
 * Kahn's algorithm over the condensation: ties are broken by the component's
 * minimum node id and each component is emitted in sorted order, which is what
 * makes the launch order reproducible. Parallel wires collapse to one
 * condensation edge so in-degrees stay balanced.
 *
 * @param {string[][]} sccs  components, members sorted
 * @param {Map<string, string[]>} adj
 * @returns {string[]}
 */
function condensationTopo(sccs, adj) {
  const sccOf = new Map();
  sccs.forEach((scc, i) => scc.forEach((id) => sccOf.set(id, i)));
  const succ = sccs.map(() => new Set());
  const indegree = sccs.map(() => 0);
  for (const [from, tos] of adj) {
    const a = sccOf.get(from);
    if (a === undefined) continue;
    for (const to of tos) {
      const b = sccOf.get(to);
      if (b === undefined || b === a || succ[a].has(b)) continue;
      succ[a].add(b);
      indegree[b] += 1;
    }
  }

  const remaining = new Set(sccs.map((_, i) => i));
  const order = [];
  while (remaining.size) {
    let pick = -1;
    for (const i of remaining) {
      // sccs[i][0] is the component's minimum node id (members are sorted).
      if (indegree[i] === 0 && (pick < 0 || sccs[i][0] < sccs[pick][0])) pick = i;
    }
    if (pick < 0) break;                        // a condensation is acyclic — defensive only
    remaining.delete(pick);
    order.push(...sccs[pick]);
    for (const b of succ[pick]) indegree[b] -= 1;
  }
  return order;
}

/** `in3` -> 3; anything else sorts last (deterministic, never NaN). */
function portIndex(port) {
  const m = /^in(\d+)$/.exec(String(port ?? ''));
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/** Total order on wire ids (undefined ids sort last, never NaN-compare). */
function compareIds(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  return x < y ? -1 : x > y ? 1 : 0;
}

// -------------------------------------------------- the client validate adapter

/** The kinds that render a 24px caption row (`prompt + attached files` /
 *  `pipeline result` / `forwards freshest input`). The caption is a per-KIND
 *  decision made by the CALLER — graph-geometry never derives it — so the one
 *  authoritative set lives here, beside the rest of the kind vocabulary. */
export const CAPTION_KINDS = new Set(['task', 'end', 'or']);

const NODE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const IN_PORT_RE = /^in\d+$/;
const KINDS = new Set(['agent', 'task', 'and', 'or', 'combine', 'end']);
const ARITY_KINDS = new Set(['and', 'or', 'combine']);
const WHENS = new Set(['always', 'blocking', 'clean']);

/** Known `config` keys PER KIND (V17). Anything else warns, is preserved and is
 *  ignored — without the per-kind split `planStoreSeed` would warn on the task
 *  node and an agent-only `awaitAll` would pass silently on a flow card. */
const KNOWN_CONFIG = {
  agent: new Set(['model', 'effort', 'fanOut', 'askQuestions', 'awaitAll']),
  task: new Set(['planStoreSeed']),
  and: new Set(['arity']),
  or: new Set(['arity']),
  combine: new Set(['arity']),
  end: new Set(),
};
const KNOWN_WIRE_CONFIG = new Set(['maxCycles']);

/** The engine-synthesized gate input, excluded from V18's pair count by name: it
 *  is `any`-typed rather than void, so the void exemption alone does not cover it. */
const AWAIT_PORT_ID = 'await';

/**
 * Validate a v2 template against rules V1-V21.
 *
 * `portsFn` must be a SYNTHESIZING ports function (agent inputs + the appended
 * `await` port), or the seeds' `pass -> node.await` wires fail V5.
 *
 * @param {object} template  v2 template { version, nodes, wires }
 * @param {(node:object) => ({inputs?:Array, outputs?:Array}|undefined)} portsFn
 * @returns {{errors:Array<{code:string, msg:string, nodeId?:string, wireId?:string, wireIds?:string[]}>,
 *            warnings:Array<object>}}
 *          `wireIds` (plural) is V12's or-homogeneity payload — the mismatched
 *          wires; every other rule that points at a wire uses `wireId`.
 */
export function validateGraph(template, portsFn) {
  const errors = [];
  const warnings = [];
  const err = (code, msg, extra = {}) => { errors.push({ code, msg, ...extra }); };
  const warn = (code, msg, extra = {}) => { warnings.push({ code, msg, ...extra }); };

  const ctx = buildContext(template, portsFn);

  v1Shape(template, err);
  v2Nodes(ctx, err);
  v3Kinds(ctx, err);
  v4Keys(ctx, err);
  v5Endpoints(ctx, err);
  v6WireIdentity(ctx, err);
  v7InputCardinality(ctx, err);
  v8Types(ctx, err);
  v9RequiredInputs(ctx, err);
  v10Cycles(ctx, err);
  v11Deadlock(ctx, err);
  v12FlowCards(ctx, err);
  v13WhenAndBudgets(ctx, err);
  v14Expands(ctx, err);
  v15Unreachable(ctx, warn);
  v16AwaitAllNoop(ctx, warn);
  v17UnknownConfig(ctx, warn);
  v18DoubleFire(ctx, warn);
  v19LoopReceiver(ctx, warn);
  v20TaskNode(ctx, err);
  v21EndNode(ctx, err);

  return { errors, warnings };
}

/**
 * Resolve every node's ports once and derive the shared views the rules read.
 *
 * "WIRED" (definition (a), used by V9/V12/V16/V18/V20/V21) means: the wire's
 * endpoints EXIST and BOTH ports resolve. That is the filter `classifyLoops`
 * applies, and it is what makes a deleted task node cascade into V9 — a naive
 * `wires.some()` would report the input as wired and stay silent.
 */
function buildContext(template, portsFn) {
  const nodes = Array.isArray(template?.nodes) ? template.nodes.filter(isObject) : [];
  const wires = Array.isArray(template?.wires) ? template.wires.filter(isObject) : [];

  const nodeById = new Map();
  for (const n of nodes) if (!nodeById.has(n.id)) nodeById.set(n.id, n);

  // portsFn returns undefined for an unknown agent key (V4) or an unknown kind
  // (V3); every consumer below treats that as "no ports" rather than crashing.
  const resolved = new Map();
  for (const n of nodes) if (!resolved.has(n.id)) resolved.set(n.id, portsFn(n) || null);

  const metaOf = (nodeId) => resolved.get(nodeId) || null;
  const inputsOf = (nodeId) => metaOf(nodeId)?.inputs || [];
  const outputsOf = (nodeId) => metaOf(nodeId)?.outputs || [];
  const inputPort = (nodeId, port) => inputsOf(nodeId).find((p) => p?.id === port) || null;
  const outputPort = (nodeId, port) => outputsOf(nodeId).find((p) => p?.id === port) || null;

  const liveWires = wires.filter((w) => nodeById.has(w?.from?.node) && nodeById.has(w?.to?.node)
    && outputPort(w.from.node, w.from.port) && inputPort(w.to.node, w.to.port));

  const inboundByInput = new Map();          // '<nodeId>.<port>' -> first LIVE inbound wire
  for (const w of liveWires) {
    const key = `${w.to.node}.${w.to.port}`;
    if (!inboundByInput.has(key)) inboundByInput.set(key, w);
  }

  const { loopWires, loopInputs, sccs } = classifyLoops(template, portsFn);

  // "Nontrivial SCC" (definition (d)) INCLUDES self-wired singletons — otherwise
  // wf_default's refine self-loop escapes V10 and its maxCycles escapes V13.
  // classifyLoops unions the same set; this repeats the predicate, not the walk.
  const selfWired = new Set(wires
    .filter((w) => nodeById.has(w?.from?.node) && w.from.node === w?.to?.node)
    .map((w) => w.from.node));
  const cycles = sccs.filter((scc) => scc.length > 1 || selfWired.has(scc[0]));

  return {
    template,
    portsFn,
    nodes,
    wires,
    nodeById,
    metaOf,
    inputsOf,
    outputsOf,
    inputPort,
    outputPort,
    liveWires,
    isWired: (nodeId, port) => inboundByInput.has(`${nodeId}.${port}`),
    inboundOf: (nodeId, port) => inboundByInput.get(`${nodeId}.${port}`) || null,
    isLoopInput: (nodeId, port) => loopInputs.has(`${nodeId}.${port}`),
    loopWires,
    cycles,
  };
}

// --------------------------------------------------------------- V1 - V4

/** V1 — object, `version === 2`, non-empty `nodes`, `wires` array. */
function v1Shape(template, err) {
  if (!isObject(template)) {
    err('V1', 'template must be an object');
    return;
  }
  if (template.version !== 2) err('V1', `template version must be 2 (got ${JSON.stringify(template.version)})`);
  if (!Array.isArray(template.nodes) || template.nodes.length === 0) {
    err('V1', 'template must declare a non-empty nodes array');
  }
  if (!Array.isArray(template.wires)) err('V1', 'template must declare a wires array');
}

/** V2 — ids match the id pattern and are unique; x/y are FINITE numbers. */
function v2Nodes({ nodes }, err) {
  const seen = new Set();
  for (const n of nodes) {
    const id = n.id;
    if (typeof id !== 'string' || !NODE_ID_RE.test(id)) {
      err('V2', `node id ${JSON.stringify(id)} must match /^[A-Za-z0-9_-]{1,64}$/`, { nodeId: id });
    } else if (seen.has(id)) {
      err('V2', `duplicate node id '${id}'`, { nodeId: id });
    } else {
      seen.add(id);
    }
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
      err('V2', `node '${id}' must have finite x/y coordinates`, { nodeId: id });
    }
  }
}

/** V3 — the kind set is {agent, task, and, or, combine, end}; `key` iff agent. */
function v3Kinds({ nodes }, err) {
  for (const n of nodes) {
    if (!KINDS.has(n.kind)) {
      err('V3', `node '${n.id}' has unknown kind ${JSON.stringify(n.kind)} — expected one of ${[...KINDS].join(', ')}`, { nodeId: n.id });
    } else if (n.kind === 'agent' && !n.key) {
      err('V3', `agent node '${n.id}' must declare a key`, { nodeId: n.id });
    } else if (n.kind !== 'agent' && n.key !== undefined) {
      err('V3', `node '${n.id}' of kind '${n.kind}' must not declare a key`, { nodeId: n.id });
    }
  }
}

/** V4 — the agent key resolves in the merged registry, and a meta declaring
 *  `placeable: false` is never a node. Meta-driven: no key literals live here. */
function v4Keys({ nodes, metaOf }, err) {
  for (const n of nodes) {
    if (n.kind !== 'agent' || !n.key) continue;              // missing key is V3's
    const meta = metaOf(n.id);
    if (!meta) {
      err('V4', `agent '${n.key}' is not loaded — a metaVersion-1 sidecar must be migrated to 2`, { nodeId: n.id });
    } else if (meta.placeable === false) {
      err('V4', `agent '${n.key}' declares placeable: false and cannot be a graph node`, { nodeId: n.id });
    }
  }
}

// --------------------------------------------------------------- V5 - V7

/** V5 — endpoints exist; `from.port` is a declared output, `to.port` a declared
 *  input. Ports are only checked where the meta RESOLVED: an unknown key is V4's
 *  error, and re-reporting each of its wires here would bury it. */
function v5Endpoints({ wires, nodeById, metaOf, inputPort, outputPort }, err) {
  for (const w of wires) {
    const fromId = w?.from?.node;
    const toId = w?.to?.node;
    if (!nodeById.has(fromId)) err('V5', `wire '${w.id}' starts at unknown node '${fromId}'`, { wireId: w.id });
    else if (metaOf(fromId) && !outputPort(fromId, w.from.port)) {
      err('V5', `wire '${w.id}': '${fromId}.${w.from.port}' is not a declared output`, { wireId: w.id });
    }
    if (!nodeById.has(toId)) err('V5', `wire '${w.id}' ends at unknown node '${toId}'`, { wireId: w.id });
    else if (metaOf(toId) && !inputPort(toId, w.to.port)) {
      err('V5', `wire '${w.id}': '${toId}.${w.to.port}' is not a declared input`, { wireId: w.id });
    }
  }
}

/** V6 — wire ids unique; duplicate `(from, to)` pairs rejected. */
function v6WireIdentity({ wires }, err) {
  const seenIds = new Set();
  const seenPairs = new Set();
  for (const w of wires) {
    if (seenIds.has(w.id)) err('V6', `duplicate wire id '${w.id}'`, { wireId: w.id });
    else seenIds.add(w.id);
    const pair = `${w?.from?.node}.${w?.from?.port} -> ${w?.to?.node}.${w?.to?.port}`;
    if (seenPairs.has(pair)) err('V6', `duplicate wire ${pair}`, { wireId: w.id });
    else seenPairs.add(pair);
  }
}

/** V7 — the UNIVERSAL input-cardinality rule (restored; V22's await-port special
 *  case is subsumed): every input — agent meta ports, the synthesized `await`,
 *  and/or/combine `inK`, end's `result` — accepts at most ONE inbound wire. One
 *  payload shape everywhere: the INPUT (nodeId + port in the message) plus the
 *  offending 2nd+ wire. Counted over ALL wires, with no per-kind carve-outs and
 *  no dependency on meta resolution — stacking wires on an input is wrong even
 *  when the node's key is unknown. Fan-OUT stays unrestricted; fan-IN is an OR. */
function v7InputCardinality({ wires }, err) {
  const byInput = new Map();
  for (const w of wires) {
    const key = `${w?.to?.node}.${w?.to?.port}`;
    if (!byInput.has(key)) byInput.set(key, []);
    byInput.get(key).push(w);
  }
  for (const [key, inbound] of byInput) {
    for (const w of inbound.slice(1)) {
      err('V7', `input '${key}' already has an inbound wire — every input accepts at most one (fan in through an or card)`,
        { nodeId: w?.to?.node, wireId: w.id });
    }
  }
}

// --------------------------------------------------------------- V8

/** V8 — plain per-wire type equality (each input carries at most one wire, per
 *  V7), with `any` inputs accepting every source. PLUS the or-resolution clause,
 *  scoped to the or card alone: an or's `out` type resolves from its wiring, so
 *  its OUTBOUND wires compare against `resolveOrOutType` rather than the declared
 *  `any` (null ⇒ unresolvable ⇒ skip; the unwired `inK` is already V12's error).
 *  and.out is STATIC void and end/await inputs are plain `any` — no other
 *  resolution exists anywhere in the system. */
function v8Types(ctx, err) {
  const { liveWires, nodeById, inputPort, outputPort } = ctx;
  for (const w of liveWires) {
    const inPort = inputPort(w.to.node, w.to.port);
    if (inPort.type === 'any') continue;
    const sourceType = sourceTypeOf(ctx, nodeById.get(w.from.node), outputPort(w.from.node, w.from.port));
    if (sourceType === null) continue;                       // unresolvable or card
    if (sourceType !== inPort.type) {
      err('V8', `wire '${w.id}' type mismatch: ${sourceType} -> ${inPort.type} `
        + `(${w.from.node}.${w.from.port} -> ${w.to.node}.${w.to.port})`, { wireId: w.id });
    }
  }
}

/** The payload type a wire actually carries: the declared output type, except on
 *  an or card, where it resolves from the or's own inbound wires (chained ors walk
 *  through, seen-set guarded inside resolveOrOutType). */
function sourceTypeOf({ template, portsFn }, sourceNode, outPort) {
  if (outPort.type && outPort.type !== 'any') return outPort.type;
  if (sourceNode?.kind === 'or') return resolveOrOutType(sourceNode, template, portsFn);
  return outPort.type ?? null;
}

// --------------------------------------------------------------- V9 - V11

/** V9 — every required non-loop input must be wired (no seeding exemption).
 *  Defence in depth: V12 owns the same statement for flow-card `inK`s and reports
 *  it first, so V9 is never the sole reporter there. */
function v9RequiredInputs({ nodes, metaOf, inputsOf, isWired, isLoopInput }, err) {
  for (const n of nodes) {
    if (!metaOf(n.id)) continue;                             // unresolved meta — V3/V4 own it
    for (const inp of inputsOf(n.id)) {
      if (!inp?.required || inp.loop || isLoopInput(n.id, inp.id)) continue;
      if (!isWired(n.id, inp.id)) {
        err('V9', `required input '${n.id}.${inp.id}' is unwired`, { nodeId: n.id });
      }
    }
  }
}

/** V10 — every nontrivial SCC needs ≥ 1 loop wire (a blocking-source edge), else
 *  nothing in the cycle can ever settle. The offending wires are NAMED IN THE
 *  MESSAGE: a cycle has no single wire to point at, and `wireIds` is reserved for
 *  V12's homogeneity payload. */
function v10Cycles({ cycles, liveWires, loopWires }, err) {
  for (const scc of cycles) {
    const members = new Set(scc);
    const inner = liveWires.filter((w) => members.has(w.from.node) && members.has(w.to.node));
    if (inner.some((w) => loopWires.has(w.id))) continue;
    err('V10', `cycle without a blocking-source edge: ${scc.join(', ')} (wires ${inner.map((w) => w.id).join(', ') || 'none'})`);
  }
}

/** V11 — deadlock freedom: every nontrivial SCC needs ≥ 1 node whose required
 *  inputs are ALL satisfiable from outside the SCC (an external wire, an optional
 *  input, or a loop input). An unwired required input is V9's error, not a
 *  deadlock on its own — but it cannot start the cycle either, so it does not
 *  count as satisfiable. */
function v11Deadlock({ cycles, metaOf, inputsOf, inboundOf, isLoopInput }, err) {
  for (const scc of cycles) {
    const members = new Set(scc);
    const canStart = scc.some((id) => {
      if (!metaOf(id)) return true;                          // unresolved meta — V4 owns it, do not pile on
      return inputsOf(id).every((inp) => {
        if (!inp?.required || inp.loop || isLoopInput(id, inp.id)) return true;
        const w = inboundOf(id, inp.id);
        return Boolean(w) && !members.has(w.from.node);
      });
    });
    if (!canStart) {
      err('V11', `deadlock: no node in cycle ${scc.join(', ')} can start — every member's required inputs come from inside the cycle`);
    }
  }
}

// --------------------------------------------------------------- V12

/** V12 — and/or/combine: an integer `arity ≥ 2`, every `inK` wired, and or
 *  homogeneity. Arity is only checked when EXPLICITLY present (definition (c)):
 *  portsFnFor defaults it to 2, so a card authored without one is legal. Combine's
 *  "all md" and AND's "any output type" are encoded in the declared input types
 *  and enforced per wire by V8; what needs a rule of its own is the OR, whose
 *  inbound source types must ALL resolve equal — the error NAMES THE MISMATCHED
 *  WIRES via `wireIds`, using the same seen-set walk as V8's clause. */
function v12FlowCards(ctx, err) {
  const { nodes, metaOf, inputsOf, isWired } = ctx;
  for (const n of nodes) {
    if (!ARITY_KINDS.has(n.kind)) continue;
    const arity = n.config?.arity;
    if (arity !== undefined && (!Number.isInteger(arity) || arity < 2)) {
      err('V12', `${n.kind} node '${n.id}' needs an integer arity >= 2 (got ${JSON.stringify(arity)})`, { nodeId: n.id });
    }
    if (!metaOf(n.id)) continue;
    for (const inp of inputsOf(n.id)) {
      if (!isWired(n.id, inp.id)) {
        err('V12', `${n.kind} node '${n.id}' has unwired input '${inp.id}' — every inK must be wired`, { nodeId: n.id });
      }
    }
    if (n.kind === 'or') v12OrHomogeneity(ctx, n, err);
  }
}

function v12OrHomogeneity(ctx, node, err) {
  const { liveWires, nodeById, outputPort } = ctx;
  const typed = [];
  for (const w of liveWires) {
    if (w.to.node !== node.id) continue;
    const type = sourceTypeOf(ctx, nodeById.get(w.from.node), outputPort(w.from.node, w.from.port));
    if (type !== null) typed.push({ wireId: w.id, type });
  }
  const distinct = [...new Set(typed.map((t) => t.type))];
  if (distinct.length < 2) return;
  err('V12', `or node '${node.id}' has heterogeneous inbound types (${distinct.join(', ')}) — every wire into an or must carry the same payload type`,
    { nodeId: node.id, wireIds: typed.map((t) => t.wireId) });
}

// --------------------------------------------------------------- V13 - V14

/** V13 — `when ∈ {always, blocking, clean}` and a non-always output needs the
 *  node to produce a verdict; `wire.config.maxCycles` is an int ≥ 1 and belongs
 *  on LOOP WIRES only (an always-sourced in-SCC wire such as `or.out -> fix` is
 *  budget-less by construction — the budgets sit on the blocking wires INTO the
 *  or). Self-wired singletons count as cycles (definition (d)), so wf_default's
 *  refine self-loop keeps its budget legally. */
function v13WhenAndBudgets({ nodes, wires, metaOf, outputsOf, loopWires }, err) {
  for (const n of nodes) {
    const meta = metaOf(n.id);
    if (!meta) continue;
    for (const out of outputsOf(n.id)) {
      const when = out?.when || 'always';
      if (!WHENS.has(when)) {
        err('V13', `output '${n.id}.${out.id}' declares unknown when ${JSON.stringify(out.when)}`, { nodeId: n.id });
      } else if (when !== 'always' && !meta.verdict) {
        err('V13', `output '${n.id}.${out.id}' is when:'${when}' but the node produces no verdict`, { nodeId: n.id });
      }
    }
  }
  for (const w of wires) {
    const budget = w?.config?.maxCycles;
    if (budget === undefined) continue;
    if (!Number.isInteger(budget) || budget < 1) {
      err('V13', `wire '${w.id}' maxCycles must be an integer >= 1 (got ${JSON.stringify(budget)})`, { wireId: w.id });
    }
    if (!loopWires.has(w.id)) {
      err('V13', `wire '${w.id}' carries maxCycles but is not a loop wire`, { wireId: w.id });
    }
  }
}

/** V14 — an `expands` input (§5 fan-out) must be `json`. */
function v14Expands({ nodes, metaOf, inputsOf }, err) {
  for (const n of nodes) {
    if (!metaOf(n.id)) continue;
    for (const inp of inputsOf(n.id)) {
      if (inp?.expands && inp.type !== 'json') {
        err('V14', `input '${n.id}.${inp.id}' declares expands but is '${inp.type}' — expands inputs must be json`, { nodeId: n.id });
      }
    }
  }
}

// --------------------------------------------------------------- V15 - V19

/** V15 — a node never eligible from any entry. The ENTRY SET (definition (e)) is
 *  the nodes whose RESOLVED ports declare zero inputs, EXCLUDING nodes whose meta
 *  does not resolve: an unknown-key node otherwise looks like an entry and
 *  suppresses the whole cascade. Reachability follows live wires only. */
function v15Unreachable({ nodes, metaOf, inputsOf, liveWires }, warn) {
  const out = new Map();
  for (const w of liveWires) {
    if (!out.has(w.from.node)) out.set(w.from.node, []);
    out.get(w.from.node).push(w.to.node);
  }
  const reached = new Set();
  const queue = nodes.filter((n) => metaOf(n.id) && inputsOf(n.id).length === 0).map((n) => n.id);
  for (const id of queue) reached.add(id);
  while (queue.length) {
    for (const next of out.get(queue.shift()) || []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  for (const n of nodes) {
    if (!reached.has(n.id)) warn('V15', `node '${n.id}' is unreachable from any entry`, { nodeId: n.id });
  }
}

/** V16 — `awaitAll` on a node with < 2 wired non-loop inputs is a no-op. Scope is
 *  AGENT NODES (definition (f)): awaitAll is an agent-only config key, and the
 *  flow cards ignore it entirely. A wired `await` port counts as one of the two —
 *  `plan` + `await` makes awaitAll meaningful. */
function v16AwaitAllNoop({ nodes, metaOf, inputsOf, isWired, isLoopInput }, warn) {
  for (const n of nodes) {
    if (n.kind !== 'agent' || !n.config?.awaitAll || !metaOf(n.id)) continue;
    const wired = inputsOf(n.id).filter((inp) => !isLoopInput(n.id, inp.id) && isWired(n.id, inp.id));
    if (wired.length < 2) {
      warn('V16', `node '${n.id}' sets awaitAll but has ${wired.length} wired non-loop input(s) — the barrier is a no-op`, { nodeId: n.id });
    }
  }
}

/** V17 — unknown `config` keys warn once, per kind (definition (b)); the key is
 *  PRESERVED and ignored, never stripped. */
function v17UnknownConfig({ nodes, wires }, warn) {
  for (const n of nodes) {
    const known = KNOWN_CONFIG[n.kind];
    if (!known) continue;                                    // unknown kind — V3's error
    for (const key of Object.keys(n.config || {})) {
      if (known.has(key)) continue;
      warn('V17', `node '${n.id}' has unknown config key '${key}' for kind '${n.kind}' — preserved and ignored`, { nodeId: n.id });
    }
  }
  for (const w of wires) {
    for (const key of Object.keys(w.config || {})) {
      if (KNOWN_WIRE_CONFIG.has(key)) continue;
      warn('V17', `wire '${w.id}' has unknown config key '${key}' — preserved and ignored`, { wireId: w.id });
    }
  }
}

/** V18 — two `always`-sourced non-void non-loop inputs on an AGENT node without
 *  `awaitAll` (double-fire risk on re-runs; the fix is Await-all or an AND card).
 *  Flow cards are outside the rule entirely — AND/Combine fire all-fresh, OR
 *  any-fresh and End completes, all by design. FOUR exemptions from the pair
 *  count: (a) task-node-sourced — the task node fires exactly once by
 *  construction; (b) VOID inputs — pure sequencing, no payload to double-bind;
 *  (c) the synthesized `await` port — payload-less, and `any`-typed rather than
 *  void, so (b) does not cover it; (d) `loop: true` inputs — re-firing is their
 *  purpose, and since the OR valve `or.out -> implementer.fix` is an ALWAYS
 *  source, without (d) every double-loop seed would warn permanently. */
function v18DoubleFire({ nodes, nodeById, metaOf, inputsOf, inboundOf, outputPort, isLoopInput }, warn) {
  for (const n of nodes) {
    if (n.kind !== 'agent' || n.config?.awaitAll || !metaOf(n.id)) continue;
    let paired = 0;
    for (const inp of inputsOf(n.id)) {
      if (inp.id === AWAIT_PORT_ID || inp.synthetic) continue;              // (c)
      if (inp.type === 'void') continue;                                    // (b)
      if (inp.loop || isLoopInput(n.id, inp.id)) continue;                  // (d)
      const w = inboundOf(n.id, inp.id);
      if (!w) continue;
      if (nodeById.get(w.from.node)?.kind === 'task') continue;             // (a)
      if ((outputPort(w.from.node, w.from.port)?.when || 'always') !== 'always') continue;
      paired += 1;
    }
    if (paired >= 2) {
      warn('V18', `agent node '${n.id}' has ${paired} always-sourced payload inputs without awaitAll — `
        + 'it may double-fire on re-runs (enable Await-all or insert an AND card)', { nodeId: n.id });
    }
  }
}

/** V19 — a `when:'blocking'` output wired into an input without `loop: true` is
 *  probably a mis-wired loop. Exempt when the target is an and/or `inK` (an or
 *  `inK` is THE canonical loop-valve terminal — the double-loop seeds' blocking
 *  review wires land there by design), end's `result`, or an agent's synthesized
 *  `await` port: those are explicit flow-control sinks, not forgotten loop
 *  receivers. Combine inputs are payload-bearing and still warn. */
function v19LoopReceiver({ liveWires, nodeById, outputPort, isLoopInput }, warn) {
  for (const w of liveWires) {
    if (outputPort(w.from.node, w.from.port)?.when !== 'blocking') continue;
    if (isLoopInput(w.to.node, w.to.port)) continue;
    const target = nodeById.get(w.to.node);
    if ((target.kind === 'and' || target.kind === 'or') && IN_PORT_RE.test(w.to.port)) continue;
    if (target.kind === 'end' && w.to.port === 'result') continue;
    if (target.kind === 'agent' && w.to.port === AWAIT_PORT_ID) continue;
    warn('V19', `blocking output '${w.from.node}.${w.from.port}' is wired into '${w.to.node}.${w.to.port}', `
      + 'which is not a loop input', { wireId: w.id });
  }
}

// --------------------------------------------------------------- V20 - V21

/** V20 — exactly ONE task node; it has zero inputs and its `task` output carries
 *  at least one wire. */
function v20TaskNode({ nodes, metaOf, inputsOf, liveWires }, err) {
  const taskNodes = nodes.filter((n) => n.kind === 'task');
  if (taskNodes.length !== 1) {
    err('V20', `a template must declare exactly one task node (found ${taskNodes.length})`);
  }
  for (const t of taskNodes) {
    if (!metaOf(t.id)) continue;
    if (inputsOf(t.id).length) err('V20', `task node '${t.id}' must declare zero inputs`, { nodeId: t.id });
    if (!liveWires.some((w) => w.from.node === t.id && w.from.port === 'task')) {
      err('V20', `task node '${t.id}' output 'task' must have at least one wire`, { nodeId: t.id });
    }
  }
}

/** V21 — exactly ONE end node (the mirror of V20); zero outputs, and its `result`
 *  input wired — with ONE wire like every input (V7); alternative terminals fan
 *  through an or card. */
function v21EndNode({ nodes, metaOf, outputsOf, isWired }, err) {
  const endNodes = nodes.filter((n) => n.kind === 'end');
  if (endNodes.length !== 1) {
    err('V21', `a template must declare exactly one end node (found ${endNodes.length})`);
  }
  for (const e of endNodes) {
    if (!metaOf(e.id)) continue;
    if (outputsOf(e.id).length) err('V21', `end node '${e.id}' must declare zero outputs`, { nodeId: e.id });
    if (!isWired(e.id, 'result')) err('V21', `end node '${e.id}' input 'result' must be wired`, { nodeId: e.id });
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ------------------------------------------------------ normalize / serialize

/**
 * Canonicalize an authored or fetched template into the editable v2 shape:
 * numeric coordinates, a materialized `config` on every node, non-object nodes
 * and wires dropped, and `key` kept only where V3 allows it. Unknown `config`
 * keys are PRESERVED (V17 warns and ignores them; it never strips them).
 *
 * @param {object} raw
 * @returns {{id:string, name:string, version:2, domain:string, nodes:Array, wires:Array, canvas?:object}}
 */
export function normalizeTemplate(raw) {
  const t = isObject(raw) ? raw : {};
  const template = {
    id: String(t.id ?? ''),
    name: String(t.name ?? ''),
    version: 2,
    domain: String(t.domain ?? ''),
    nodes: (Array.isArray(t.nodes) ? t.nodes : []).filter(isObject).map(normalizeNode),
    wires: (Array.isArray(t.wires) ? t.wires : []).filter(isObject).map(normalizeWire),
  };
  const canvas = normalizeCanvas(t.canvas);
  if (canvas) template.canvas = canvas;         // view state, engine-ignored — but it round-trips
  return template;
}

/** The POST body: normalized and stripped of anything JSON cannot carry. */
export function serializeTemplate(template) {
  return JSON.parse(JSON.stringify(normalizeTemplate(template)));
}

function normalizeNode(node) {
  const out = {
    id: String(node.id ?? ''),
    kind: String(node.kind ?? ''),
    x: Number(node.x),
    y: Number(node.y),
    config: isObject(node.config) ? { ...node.config } : {},
  };
  if (out.kind === 'agent' && node.key !== undefined) out.key = String(node.key);
  return out;
}

function normalizeWire(wire) {
  const out = {
    id: String(wire.id ?? ''),
    from: { node: String(wire.from?.node ?? ''), port: String(wire.from?.port ?? '') },
    to: { node: String(wire.to?.node ?? ''), port: String(wire.to?.port ?? '') },
  };
  if (isObject(wire.config) && Object.keys(wire.config).length) out.config = { ...wire.config };
  return out;
}

/** All three fields or nothing — a half-written canvas is worse than none. */
function normalizeCanvas(canvas) {
  if (!isObject(canvas)) return null;
  const { x, y, zoom } = canvas;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return null;
  return { x, y, zoom };
}

// ------------------------------------------------------------------- factory

/**
 * @param {'agent'|'task'|'end'|'and'|'or'|'combine'} kind
 * @param {{key?:string, x?:number, y?:number, config?:object}} [spec]
 */
export function newNode(kind, { key, x = 0, y = 0, config = {} } = {}) {
  const node = { id: randomId('n_'), kind, x, y, config: { ...config } };
  if (kind === 'agent' && key) node.key = key;   // V3: only agent nodes carry a key
  return node;
}

/**
 * @param {{node:string, port:string}} from  an output endpoint
 * @param {{node:string, port:string}} to    an input endpoint
 * @param {{maxCycles?:number}} [config]
 */
export function newWire(from, to, config) {
  const wire = {
    id: randomId('w_'),
    from: { node: from.node, port: from.port },
    to: { node: to.node, port: to.port },
  };
  if (isObject(config) && Object.keys(config).length) wire.config = { ...config };
  return wire;
}

/** 8 base36 chars, looped so a short `Math.random()` never yields a short id. */
function randomId(prefix) {
  let body = '';
  while (body.length < 8) body += Math.random().toString(36).slice(2);
  return prefix + body.slice(0, 8);
}

// ------------------------------------------------------------------- canWire

/**
 * Client-side drop legality, derived entirely from the template — which is what
 * lets it see or-homogeneity and existing wires at all (the old positional
 * 3-arg form could not).
 *
 * Reasons, in the order they are checked:
 *   `already connected`         — UNIFORM single-wire (V7): ANY input with an
 *                                 existing wire rejects, agent inputs, or `inK`,
 *                                 `end.result` and the synthesized `await` alike.
 *                                 A duplicate (from,to) pair is necessarily a
 *                                 second wire into a wired input, so it lands
 *                                 here too — V6 stays the validate adapter's
 *                                 report, not a canWire reason. Rewiring is
 *                                 remove-then-drop.
 *   `json → md type mismatch`   — per-wire type legality (V8); `any` inputs
 *                                 accept every source.
 *   `or inputs must match: md`  — or homogeneity, mirrored from the already
 *                                 resolved payload type. An or's ins accept any
 *                                 type UNTIL one in-wire exists.
 *
 * @param {{template:object, portsFn:Function, from:{node:string, port:string}, to:{node:string, port:string}}} spec
 * @returns {{ok:boolean, reason:string}}
 */
export function canWire({ template, portsFn, from, to }) {
  const nodes = Array.isArray(template?.nodes) ? template.nodes : [];
  const wires = Array.isArray(template?.wires) ? template.wires : [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const source = nodeById.get(from?.node);
  const target = nodeById.get(to?.node);
  const outPort = source ? (portsFn(source)?.outputs || []).find((p) => p.id === from.port) : null;
  const inPort = target ? (portsFn(target)?.inputs || []).find((p) => p.id === to.port) : null;
  if (!outPort || !inPort) return deny('unknown port');

  if (wires.some((w) => w?.to?.node === to.node && w?.to?.port === to.port)) return deny('already connected');

  const sourceType = payloadTypeOf(source, outPort, template, portsFn);
  if (inPort.type !== 'any' && sourceType !== null && sourceType !== inPort.type) {
    return deny(`${sourceType} → ${inPort.type} type mismatch`);
  }

  if (target.kind === 'or') {
    const resolved = resolveOrOutType(target, template, portsFn);
    if (resolved !== null && sourceType !== null && sourceType !== resolved) {
      return deny(`or inputs must match: ${resolved}`);
    }
  }

  return { ok: true, reason: '' };
}

/** The same rule as the validator's `sourceTypeOf`: an or card's declared `any`
 *  resolves through its own inbound wires; null means unresolvable, so allow. */
function payloadTypeOf(sourceNode, outPort, template, portsFn) {
  if (outPort.type && outPort.type !== 'any') return outPort.type;
  if (sourceNode?.kind === 'or') return resolveOrOutType(sourceNode, template, portsFn);
  return outPort.type ?? null;
}

function deny(reason) {
  return { ok: false, reason };
}
