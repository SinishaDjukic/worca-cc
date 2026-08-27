// src/shared/graph/constants.mjs
// The frozen vocabulary of the v2 template model: node kinds, port types, the
// synthesized await gate, the flow cards' port tables, id shapes and limits.
// Pure data + one pure function — imported unchanged by the engine, the
// server's 422 path, the tests and the browser (served at /src/shared).

/** Templates this model understands. v1 rows carry `version: 1`. */
export const TEMPLATE_VERSION = 2;

/** Every node kind a template may carry (palette order). */
export const KINDS = Object.freeze(['agent', 'task', 'end', 'and', 'or', 'combine']);

/** The flow cards: every kind that is not a spawned agent. They are pure engine
 *  executions — instant, $0, no spawn. */
export const FLOW_KINDS = Object.freeze(['task', 'end', 'and', 'or', 'combine']);

/** Port payload types. 'any' is engine-internal: it lives only on AND inputs,
 *  OR ports before resolution, End's `result` and the synthesized `await` gate —
 *  never declarable in agent meta. */
export const PORT_TYPES = Object.freeze(['md', 'json', 'void', 'any']);

/** Max ports per side of one card (agent meta inputs/outputs, gate arity). */
export const MAX_PORTS_PER_SIDE = 8;

/** Per-wire loop budget when neither the overlay nor `wire.config` sets one. */
export const DEFAULT_MAX_CYCLES = 3;

/** The universal gate input every agent card gets: synthesized by portsFn and
 *  appended LAST to the agent's declared inputs. Never stored in a template and
 *  never declared in meta ('await' is a reserved port id on both sides). It
 *  accepts a wire from ANY output type and its payload is discarded — pure
 *  sequencing: no file, no renderer, no directive, no mode effect. */
export const AWAIT_PORT = Object.freeze({ id: 'await', type: 'any', required: false, synthetic: true });

/** Task card — the graph's single source: zero inputs, one always-firing md
 *  output carrying the rendered task md. */
export const TASK_PORTS = Object.freeze({
  inputs: Object.freeze([]),
  outputs: Object.freeze([Object.freeze({ id: 'task', type: 'md', when: 'always' })]),
});

/** End card — the graph's single sink: one single-wire input, zero outputs. The
 *  token arriving on its wire completes the run. */
export const END_PORTS = Object.freeze({
  inputs: Object.freeze([Object.freeze({ id: 'result', type: 'any', required: true, loop: false, expands: false })]),
  outputs: Object.freeze([]),
});

/**
 * Ports of a gate card at a given arity. AND is the pure synchronizer (`any`
 * ins, ONE static `void` out, fires when all ins are fresh, payloads discarded);
 * OR is the payload-forwarding valve (fires on any fresh in, re-emits that
 * payload — its in/out types RESOLVE FROM WIRING, so `any` here is the
 * pre-resolution placeholder); Combine is the md AND-join.
 * @param {'and'|'or'|'combine'} kind
 * @param {number} arity clamped to [2, MAX_PORTS_PER_SIDE]
 * @returns {{inputs: Array<object>, outputs: Array<object>}}
 */
export function gatePorts(kind, arity) {
  const n = Math.min(MAX_PORTS_PER_SIDE, Math.max(2, Math.floor(Number(arity)) || 2));
  const inType = kind === 'combine' ? 'md' : 'any';
  const inputs = [];
  for (let i = 1; i <= n; i += 1) {
    inputs.push(Object.freeze({ id: `in${i}`, type: inType, required: true, loop: false, expands: false }));
  }
  const outType = kind === 'and' ? 'void' : kind === 'combine' ? 'md' : 'any';
  return Object.freeze({
    inputs: Object.freeze(inputs),
    outputs: Object.freeze([Object.freeze({ id: 'out', type: outType, when: 'always' })]),
  });
}

/** Minted node ids are `n_` + 8 base36; the seed graphs use readable `n_<word>`
 *  ids. Both shapes match. */
export const NODE_ID_RE = /^n_[a-z0-9]{1,32}$/;

/** Minted wire ids are `w_` + 8 base36; the seed graphs use `w1`..`w17`. Both
 *  shapes match — the underscore is optional. */
export const WIRE_ID_RE = /^w_?[a-z0-9]{1,32}$/;

/** Port ids are lowerCamel, at most 32 chars (`task`, `revise`, `in1`, `await`). */
export const PORT_ID_RE = /^[a-z][A-Za-z0-9]{0,31}$/;

/** The two ledger rows every run writes for its own bookends (P8 makes them
 *  `exec` rows keyed exactly so). Shared by the run monitor and the CLI so
 *  neither counts them as executions or progress. */
export const BOOKEND_EXECUTION_IDS = Object.freeze(['x:preflight:1', 'x:done:1']);

/** Structural ceilings the validator enforces (override per call with
 *  `validateGraph(tpl, portsFn, { limits })`). */
export const LIMITS = Object.freeze({
  maxNodes: 80,
  maxWires: 200,
  maxPortsPerSide: MAX_PORTS_PER_SIDE,
  minArity: 2,
  maxArity: MAX_PORTS_PER_SIDE,
  maxCycles: 20,
  maxNameLen: 80,
});
