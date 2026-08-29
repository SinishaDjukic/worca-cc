// src/shared/graph/validate.mjs
// THE authority on v2 graph legality (base spec §2, V1-V21; V22 is RETIRED —
// subsumed by the restored V7 — and its number stays reserved so V-rule
// references remain stable). Server save (422), plugin import, the composer's
// live report, the run-time check and the seed drift guard all come through
// here, so it is pure, never throws on a malformed template, and every lookup
// guards: a dangling endpoint or an unknown key is an issue to COLLECT.
import { KINDS, NODE_ID_RE, LIMITS } from './constants.mjs';
import { portsOf, findPort, resolveOrOutType } from './ports.mjs';
import { classifyLoops } from './loops.mjs';

const ARITY_SET = new Set(['and', 'or', 'combine']);
const IN_PORT_RE = /^in\d+$/;
const WHENS = new Set(['always', 'blocking', 'clean']);
const AWAIT_PORT_ID = 'await';

/** Known `config` keys PER KIND (V17). Without the per-kind split `planStoreSeed`
 *  would warn on the task node and an agent-only `awaitAll` would pass silently
 *  on a flow card. Unknown keys are PRESERVED and ignored, never stripped. */
const KNOWN_CONFIG = {
  agent: new Set(['model', 'effort', 'fanOut', 'askQuestions', 'awaitAll']),
  task: new Set(['planStoreSeed']),
  and: new Set(['arity']),
  or: new Set(['arity']),
  combine: new Set(['arity']),
  end: new Set(),
};
const KNOWN_WIRE_CONFIG = new Set(['maxCycles']);

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {object} tpl v2 template
 * @param {(node:object) => object|undefined} portsFn  MUST synthesize the await port
 * @param {{limits?:{maxNodes:number, maxWires:number}}} [opts]
 * @returns {{ok:boolean, errors:Array, warnings:Array}}  Issue = {code, message, nodeId?, wireId?, portId?}
 */
export function validateGraph(tpl, portsFn, opts = {}) {
  const limits = { ...LIMITS, ...(isObject(opts?.limits) ? opts.limits : {}) };
  // The ceilings are enforced HERE, before anything walks the graph. buildContext
  // resolves every node's ports and runs classifyLoops -> condensationTopo, which
  // is O(n^2): on the raw uncapped input a multi-megabyte body blocked the single
  // event loop for tens of seconds and then answered with an N+3-entry error
  // array — more bytes out than in. Returning the V1 issue ALONE keeps both the
  // work and the 422 body O(1). Rule V1 still owns the message (one source), so
  // the in-limit path is byte-for-byte what it always was.
  const over = limitIssue(tpl, limits);
  if (over) return { ok: false, errors: [over], warnings: [] };
  const ctx = buildContext(tpl, portsFn, limits);
  const errors = [];
  const warnings = [];
  for (const rule of RULES) {
    const sink = rule.level === 'W' ? warnings : errors;
    rule.check(ctx, (message, extra = {}) => sink.push({ code: rule.code, message, ...extra }));
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** One line per issue, for logs and CLI output. */
export function formatIssue(issue) {
  const where = issue?.wireId ? ` (wire ${issue.wireId})` : issue?.nodeId ? ` (node ${issue.nodeId})` : '';
  return `${issue?.code || '?'}: ${issue?.message || ''}${where}`;
}

/** The ONE structural-ceiling check, shared by validateGraph's pre-pass and rule
 *  V1. Counts only — it must never touch a node's contents, or it would be the
 *  very O(n) walk the pre-pass exists to avoid. Returns the V1 issue, or null
 *  when the template is inside both ceilings. At most ONE issue by design: the
 *  caller's job is to say "too big", not to enumerate. */
function limitIssue(template, limits) {
  const n = Array.isArray(template?.nodes) ? template.nodes.length : 0;
  const w = Array.isArray(template?.wires) ? template.wires.length : 0;
  if (n > limits.maxNodes) return { code: 'V1', message: `template has ${n} nodes — the limit is ${limits.maxNodes}` };
  if (w > limits.maxWires) return { code: 'V1', message: `template has ${w} wires — the limit is ${limits.maxWires}` };
  return null;
}

/** Resolve every node's ports ONCE and derive the views the rules read. */
function buildContext(template, portsFn, limits) {
  const nodes = (Array.isArray(template?.nodes) ? template.nodes : []).filter(isObject);
  const wires = (Array.isArray(template?.wires) ? template.wires : []).filter(isObject);
  const nodeById = new Map();
  // STRING ids only. Index a node under the key `undefined` and a wire with a
  // missing `from`/`to` passes every `nodeById.has(w?.from?.node)` guard, so the
  // next non-optional dereference throws instead of collecting V2/V5.
  for (const n of nodes) if (typeof n.id === 'string' && !nodeById.has(n.id)) nodeById.set(n.id, n);

  const resolved = new Map();
  for (const n of nodes) if (!resolved.has(n.id)) resolved.set(n.id, portsOf(portsFn, n));

  const portsFor = (id) => resolved.get(id) || { known: false, ported: false, inputs: [], outputs: [], meta: null };
  // metaOf is null for BOTH V4 cases (unknown key, un-ported sidecar) so no other
  // rule piles onto a node V4 already named.
  const metaOf = (id) => (portsFor(id).ported ? portsFor(id).meta : null);
  const inputsOf = (id) => portsFor(id).inputs;
  const outputsOf = (id) => portsFor(id).outputs;
  const inputPort = (id, port) => findPort(portsFor(id), port, 'in');
  const outputPort = (id, port) => findPort(portsFor(id), port, 'out');

  const liveWires = wires.filter((w) => nodeById.has(w?.from?.node) && nodeById.has(w?.to?.node)
    && outputPort(w.from.node, w.from.port) && inputPort(w.to.node, w.to.port));
  const inboundByInput = new Map();
  for (const w of liveWires) {
    const key = `${w.to.node}.${w.to.port}`;
    if (!inboundByInput.has(key)) inboundByInput.set(key, w);
  }

  const { loopWireIds, loopInputs, sccOf } = classifyLoops(template, portsFn);
  const components = [];
  for (const [id, i] of sccOf) { (components[i] = components[i] || []).push(id); }
  const selfWired = new Set(wires
    .filter((w) => nodeById.has(w?.from?.node) && w.from.node === w?.to?.node).map((w) => w.from.node));
  // A "nontrivial SCC" INCLUDES self-wired singletons — otherwise a self-loop
  // escapes V10 and its maxCycles escapes V13.
  const cycles = components.filter(Boolean).map((c) => [...c].sort())
    .filter((c) => c.length > 1 || selfWired.has(c[0]));

  return {
    template, portsFn, limits, nodes, wires, nodeById, metaOf, inputsOf, outputsOf,
    inputPort, outputPort, liveWires, loopWireIds, cycles,
    portsFor,
    isWired: (id, port) => inboundByInput.has(`${id}.${port}`),
    inboundOf: (id, port) => inboundByInput.get(`${id}.${port}`) || null,
    isLoopInput: (id, port) => loopInputs.has(`${id}.${port}`),
  };
}

/** The payload type a wire carries: the declared output type, except on an or
 *  card, where it resolves from the or's own inbound wires (chained ors walk
 *  through, seen-set guarded). */
function sourceTypeOf(ctx, sourceNode, outPort) {
  if (outPort?.type && outPort.type !== 'any') return outPort.type;
  if (sourceNode?.kind === 'or') return resolveOrOutType(ctx.template, ctx.portsFn, sourceNode.id);
  return outPort?.type ?? null;
}

/** The rule table — run in numeric order, so `errors` reads outside-in (shape,
 *  nodes, wires, semantics). `add(message, extra)` stamps the rule's own code
 *  and routes to errors/warnings by `level`. */
export const RULES = [
  { code: 'V1', level: 'E', check({ template, limits }, add) {
    if (!isObject(template)) { add('template must be an object'); return; }
    if (template.version !== 2) add(`template version must be 2 (got ${JSON.stringify(template.version)})`);
    if (!Array.isArray(template.nodes) || template.nodes.length === 0) add('template must declare a non-empty nodes array');
    if (!Array.isArray(template.wires)) add('template must declare a wires array');
    // A non-object entry is REJECTED here, not silently filtered by buildContext:
    // a filtered `null` node validates clean, is written, and then crashes every
    // consumer that does not filter (Ask's shapeWorkflow, the layout, the
    // thumbnail). V1 owns the shape, so this is the one place it can be named.
    (Array.isArray(template.nodes) ? template.nodes : []).forEach((entry, i) => {
      if (!isObject(entry)) add(`nodes[${i}] must be an object (got ${JSON.stringify(entry)})`);
    });
    (Array.isArray(template.wires) ? template.wires : []).forEach((entry, i) => {
      if (!isObject(entry)) add(`wires[${i}] must be an object (got ${JSON.stringify(entry)})`);
    });
    // Unreachable through validateGraph (its pre-pass short-circuits an overflow
    // before any context exists), but the rule keeps OWNING the ceiling so a
    // caller walking RULES directly still gets it, and so the message has one home.
    const over = limitIssue(template, limits);
    if (over) add(over.message);
  } },

  { code: 'V2', level: 'E', check({ nodes }, add) {
    const seen = new Set();
    for (const n of nodes) {
      const id = n.id;
      if (typeof id !== 'string' || !NODE_ID_RE.test(id)) {
        add(`node id ${JSON.stringify(id)} must match ${NODE_ID_RE}`, { nodeId: id });
      } else if (seen.has(id)) add(`duplicate node id '${id}'`, { nodeId: id });
      else seen.add(id);
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
        add(`node '${id}' must have finite x/y coordinates`, { nodeId: id });
      }
    }
  } },

  { code: 'V3', level: 'E', check({ nodes }, add) {
    for (const n of nodes) {
      if (!KINDS.includes(n.kind)) {           // KINDS is a frozen ARRAY (P1 constants)
        add(`node '${n.id}' has unknown kind ${JSON.stringify(n.kind)} — expected one of ${[...KINDS].join(', ')}`, { nodeId: n.id });
      } else if (n.kind === 'agent' && !n.key) add(`agent node '${n.id}' must declare a key`, { nodeId: n.id });
      else if (n.kind !== 'agent' && n.key !== undefined) {
        add(`node '${n.id}' of kind '${n.kind}' must not declare a key`, { nodeId: n.id });
      }
    }
  } },

  { code: 'V4', level: 'E', check({ nodes, portsFor }, add) {
    for (const n of nodes) {
      if (n.kind !== 'agent' || !n.key) continue;                       // a missing key is V3's
      const p = portsFor(n.id);
      if (!p.known) add(`unknown agent "${n.key}" — no such key in the registry`, { nodeId: n.id });
      else if (!p.ported) add(`agent "${n.key}" has no v2 ports — port its sidecar to metaVersion 2`, { nodeId: n.id });
      else if (p.meta?.placeable === false) {
        add(`agent "${n.key}" declares placeable: false and cannot be a graph node`, { nodeId: n.id });
      }
    }
  } },

  { code: 'V5', level: 'E', check({ wires, nodeById, metaOf, inputPort, outputPort }, add) {
    for (const w of wires) {
      const fromId = w?.from?.node;
      const toId = w?.to?.node;
      if (!nodeById.has(fromId)) add(`wire '${w.id}' starts at unknown node '${fromId}'`, { wireId: w.id });
      else if (metaOf(fromId) && !outputPort(fromId, w?.from?.port)) {
        add(`wire '${w.id}': '${fromId}.${w?.from?.port}' is not a declared output`, { wireId: w.id });
      }
      if (!nodeById.has(toId)) add(`wire '${w.id}' ends at unknown node '${toId}'`, { wireId: w.id });
      else if (metaOf(toId) && !inputPort(toId, w?.to?.port)) {
        add(`wire '${w.id}': '${toId}.${w?.to?.port}' is not a declared input`, { wireId: w.id });
      }
    }
  } },

  { code: 'V6', level: 'E', check({ wires }, add) {
    const seenIds = new Set();
    const seenPairs = new Set();
    for (const w of wires) {
      if (seenIds.has(w.id)) add(`duplicate wire id '${w.id}'`, { wireId: w.id });
      else seenIds.add(w.id);
      const pair = `${w?.from?.node}.${w?.from?.port} -> ${w?.to?.node}.${w?.to?.port}`;
      if (seenPairs.has(pair)) add(`duplicate wire ${pair}`, { wireId: w.id });
      else seenPairs.add(pair);
    }
  } },

  // V7 counts over ALL wires with no per-kind carve-out and no dependency on meta
  // resolution: stacking two wires on an input is wrong even when the key is unknown.
  { code: 'V7', level: 'E', check({ wires }, add) {
    const byInput = new Map();
    for (const w of wires) {
      const key = `${w?.to?.node}.${w?.to?.port}`;
      if (!byInput.has(key)) byInput.set(key, []);
      byInput.get(key).push(w);
    }
    for (const [key, inbound] of byInput) {
      for (const w of inbound.slice(1)) {
        add(`input '${key}' already has an inbound wire — every input accepts at most one (fan in through an or card)`,
          { nodeId: w?.to?.node, portId: w?.to?.port, wireId: w.id });
      }
    }
  } },

  { code: 'V8', level: 'E', check(ctx, add) {
    const { liveWires, nodeById, inputPort, outputPort } = ctx;
    for (const w of liveWires) {
      const inPort = inputPort(w.to.node, w.to.port);
      if (inPort.type === 'any') continue;
      const sourceType = sourceTypeOf(ctx, nodeById.get(w.from.node), outputPort(w.from.node, w.from.port));
      if (sourceType === null) continue;                               // unresolvable or card — V12 owns it
      if (sourceType !== inPort.type) {
        add(`wire '${w.id}' type mismatch: ${sourceType} -> ${inPort.type} `
          + `(${w.from.node}.${w.from.port} -> ${w.to.node}.${w.to.port})`, { wireId: w.id });
      }
    }
  } },

  { code: 'V9', level: 'E', check({ nodes, metaOf, inputsOf, isWired, isLoopInput }, add) {
    for (const n of nodes) {
      // AGENT inputs only. P1 marks the gate `inK` ports and End's `result`
      // `required: true`, and V12/V21 already own them with a card-specific
      // sentence — without this guard one unwired `n_and.in2` reports TWICE.
      if (n.kind !== 'agent' || !metaOf(n.id)) continue;               // V3/V4 own an unresolved node
      for (const inp of inputsOf(n.id)) {
        if (!inp?.required || inp.loop || isLoopInput(n.id, inp.id)) continue;
        if (!isWired(n.id, inp.id)) add(`required input '${n.id}.${inp.id}' is unwired`, { nodeId: n.id, portId: inp.id });
      }
    }
  } },

  { code: 'V10', level: 'E', check({ cycles, liveWires, loopWireIds }, add) {
    for (const scc of cycles) {
      const members = new Set(scc);
      const inner = liveWires.filter((w) => members.has(w.from.node) && members.has(w.to.node));
      if (inner.some((w) => loopWireIds.has(w.id))) continue;
      add(`cycle without a blocking-source edge: ${scc.join(', ')} (wires ${inner.map((w) => w.id).join(', ') || 'none'})`);
    }
  } },

  { code: 'V11', level: 'E', check({ cycles, metaOf, inputsOf, inboundOf, isLoopInput }, add) {
    for (const scc of cycles) {
      const members = new Set(scc);
      const canStart = scc.some((id) => {
        if (!metaOf(id)) return true;                                  // V4 owns it; do not pile on
        return inputsOf(id).every((inp) => {
          if (!inp?.required || inp.loop || isLoopInput(id, inp.id)) return true;
          const w = inboundOf(id, inp.id);
          return Boolean(w) && !members.has(w.from.node);
        });
      });
      if (!canStart) {
        add(`deadlock: no node in cycle ${scc.join(', ')} can start — every member's required inputs come from inside the cycle`);
      }
    }
  } },

  // Arity is checked only when EXPLICITLY present: flowPorts defaults it to 2, so
  // a card authored without one is legal. Combine's "all md" and AND's "any type"
  // ride the declared port types and are enforced per wire by V8; what needs a
  // rule of its own is the or, whose inbound source types must ALL resolve equal.
  { code: 'V12', level: 'E', check(ctx, add) {
    const { nodes, metaOf, inputsOf, isWired, liveWires, nodeById, outputPort, limits } = ctx;
    for (const n of nodes) {
      if (!ARITY_SET.has(n.kind)) continue;                          // local Set, not a P1 array
      const arity = n.config?.arity;
      // BOTH bounds: gatePorts clamps to MAX_PORTS_PER_SIDE, so `arity: 99`
      // would validate, store, ship `arity: 99` in the manifest and only ever
      // render in1..in8 — an unwirable card with no error.
      if (arity !== undefined
        && (!Number.isInteger(arity) || arity < limits.minArity || arity > limits.maxArity)) {
        add(`${n.kind} node '${n.id}' needs an integer arity between ${limits.minArity} and ${limits.maxArity}`
          + ` (got ${JSON.stringify(arity)})`, { nodeId: n.id });
      }
      if (!metaOf(n.id)) continue;
      for (const inp of inputsOf(n.id)) {
        if (!isWired(n.id, inp.id)) {
          add(`${n.kind} node '${n.id}' has unwired input '${inp.id}' — every inK must be wired`,
            { nodeId: n.id, portId: inp.id });
        }
      }
      if (n.kind !== 'or') continue;
      const typed = [];
      for (const w of liveWires) {
        if (w.to.node !== n.id) continue;
        const type = sourceTypeOf(ctx, nodeById.get(w.from.node), outputPort(w.from.node, w.from.port));
        if (type !== null) typed.push({ wireId: w.id, type });
      }
      const distinct = [...new Set(typed.map((t) => t.type))];
      if (distinct.length < 2) continue;
      add(`or node '${n.id}' has heterogeneous inbound types (${distinct.join(', ')}) — `
        + 'every wire into an or must carry the same payload type',
      { nodeId: n.id, wireIds: typed.map((t) => t.wireId) });
    }
  } },

  // maxCycles belongs on LOOP WIRES only: an always-sourced in-SCC wire such as
  // `or.out -> fix` is budget-less by construction (the budgets sit on the
  // blocking wires INTO the or).
  { code: 'V13', level: 'E', check({ nodes, wires, metaOf, outputsOf, loopWireIds }, add) {
    for (const n of nodes) {
      const meta = metaOf(n.id);
      if (!meta) continue;
      for (const out of outputsOf(n.id)) {
        const when = out?.when || 'always';
        if (!WHENS.has(when)) {
          add(`output '${n.id}.${out.id}' declares unknown when ${JSON.stringify(out.when)}`, { nodeId: n.id, portId: out.id });
        } else if (when !== 'always' && !meta.verdict) {
          add(`output '${n.id}.${out.id}' is when:'${when}' but the node produces no verdict`, { nodeId: n.id, portId: out.id });
        }
      }
    }
    for (const w of wires) {
      const budget = w?.config?.maxCycles;
      if (budget === undefined) continue;
      if (!Number.isInteger(budget) || budget < 1) {
        add(`wire '${w.id}' maxCycles must be an integer >= 1 (got ${JSON.stringify(budget)})`, { wireId: w.id });
      }
      if (!loopWireIds.has(w.id)) add(`wire '${w.id}' carries maxCycles but is not a loop wire`, { wireId: w.id });
    }
  } },

  { code: 'V14', level: 'E', check({ nodes, metaOf, inputsOf }, add) {
    for (const n of nodes) {
      if (!metaOf(n.id)) continue;
      for (const inp of inputsOf(n.id)) {
        if (inp?.expands && inp.type !== 'json') {
          add(`input '${n.id}.${inp.id}' declares expands but is '${inp.type}' — expands inputs must be json`,
            { nodeId: n.id, portId: inp.id });
        }
      }
    }
  } },

  // The ENTRY SET is the nodes whose RESOLVED ports declare zero inputs, EXCLUDING
  // nodes whose meta did not resolve — an unknown-key node otherwise looks like an
  // entry and suppresses the whole cascade.
  { code: 'V15', level: 'W', check({ nodes, metaOf, inputsOf, liveWires }, add) {
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
    for (const n of nodes) if (!reached.has(n.id)) add(`node '${n.id}' is unreachable from any entry`, { nodeId: n.id });
  } },

  { code: 'V16', level: 'W', check({ nodes, metaOf, inputsOf, isWired, isLoopInput }, add) {
    for (const n of nodes) {
      if (n.kind !== 'agent' || !n.config?.awaitAll || !metaOf(n.id)) continue;
      const wired = inputsOf(n.id).filter((inp) => !isLoopInput(n.id, inp.id) && isWired(n.id, inp.id));
      if (wired.length < 2) {
        add(`node '${n.id}' sets awaitAll but has ${wired.length} wired non-loop input(s) — the barrier is a no-op`,
          { nodeId: n.id });
      }
    }
  } },

  { code: 'V17', level: 'W', check({ nodes, wires }, add) {
    for (const n of nodes) {
      const known = KNOWN_CONFIG[n.kind];
      if (!known) continue;                                            // unknown kind — V3's error
      for (const key of Object.keys(n.config || {})) {
        if (known.has(key)) continue;
        add(`node '${n.id}' has unknown config key '${key}' for kind '${n.kind}' — preserved and ignored`, { nodeId: n.id });
      }
    }
    for (const w of wires) {
      for (const key of Object.keys(w.config || {})) {
        if (KNOWN_WIRE_CONFIG.has(key)) continue;
        add(`wire '${w.id}' has unknown config key '${key}' — preserved and ignored`, { wireId: w.id });
      }
    }
  } },

  // Exemptions: (a) task-sourced, (b) void, (c) the synthesized await (any-typed,
  // so (b) misses it), (d) loop inputs — (d) is LOAD-BEARING: `or.out -> fix` is an
  // always source, so without it every double-loop seed would warn permanently.
  { code: 'V18', level: 'W', check({ nodes, nodeById, metaOf, inputsOf, inboundOf, outputPort, isLoopInput }, add) {
    for (const n of nodes) {
      if (n.kind !== 'agent' || n.config?.awaitAll || !metaOf(n.id)) continue;
      let paired = 0;
      for (const inp of inputsOf(n.id)) {
        if (inp.id === AWAIT_PORT_ID || inp.synthetic) continue;                    // (c)
        if (inp.type === 'void') continue;                                          // (b)
        if (inp.loop || isLoopInput(n.id, inp.id)) continue;                         // (d)
        const w = inboundOf(n.id, inp.id);
        if (!w) continue;
        if (nodeById.get(w.from.node)?.kind === 'task') continue;                    // (a)
        if ((outputPort(w.from.node, w.from.port)?.when || 'always') !== 'always') continue;
        paired += 1;
      }
      if (paired >= 2) {
        add(`agent node '${n.id}' has ${paired} always-sourced payload inputs without awaitAll — `
          + 'it may double-fire on re-runs (enable Await-all or insert an AND card)', { nodeId: n.id });
      }
    }
  } },

  // An or `inK` is THE canonical loop-valve terminal (the double-loop seeds land
  // their blocking review wires there by design); AND/End/await are explicit
  // flow-control sinks. Combine inputs are payload-bearing and still warn.
  { code: 'V19', level: 'W', check({ liveWires, nodeById, outputPort, isLoopInput }, add) {
    for (const w of liveWires) {
      if (outputPort(w.from.node, w.from.port)?.when !== 'blocking') continue;
      if (isLoopInput(w.to.node, w.to.port)) continue;
      const target = nodeById.get(w.to.node);
      if ((target.kind === 'and' || target.kind === 'or') && IN_PORT_RE.test(w.to.port)) continue;
      if (target.kind === 'end' && w.to.port === 'result') continue;
      if (target.kind === 'agent' && w.to.port === AWAIT_PORT_ID) continue;
      add(`blocking output '${w.from.node}.${w.from.port}' is wired into '${w.to.node}.${w.to.port}', `
        + 'which is not a loop input', { wireId: w.id });
    }
  } },

  { code: 'V20', level: 'E', check({ nodes, metaOf, inputsOf, liveWires }, add) {
    const taskNodes = nodes.filter((n) => n.kind === 'task');
    if (taskNodes.length !== 1) add(`a template must declare exactly one task node (found ${taskNodes.length})`);
    for (const t of taskNodes) {
      if (!metaOf(t.id)) continue;
      if (inputsOf(t.id).length) add(`task node '${t.id}' must declare zero inputs`, { nodeId: t.id });
      if (!liveWires.some((w) => w.from.node === t.id && w.from.port === 'task')) {
        add(`task node '${t.id}' output 'task' must have at least one wire`, { nodeId: t.id });
      }
    }
  } },

  { code: 'V21', level: 'E', check({ nodes, metaOf, outputsOf, isWired }, add) {
    const endNodes = nodes.filter((n) => n.kind === 'end');
    if (endNodes.length !== 1) add(`a template must declare exactly one end node (found ${endNodes.length})`);
    for (const e of endNodes) {
      if (!metaOf(e.id)) continue;
      if (outputsOf(e.id).length) add(`end node '${e.id}' must declare zero outputs`, { nodeId: e.id });
      if (!isWired(e.id, 'result')) add(`end node '${e.id}' input 'result' must be wired`, { nodeId: e.id });
    }
  } },
];
