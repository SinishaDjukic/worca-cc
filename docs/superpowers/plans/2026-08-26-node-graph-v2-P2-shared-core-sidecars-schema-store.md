# Node-Graph v2 — P2: Shared graph core + sidecars v2 + schema + store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the ONE source of the v2 graph model — `src/shared/graph/{ports,loops,validate,template,geometry,layout,thumbnail,agent-meta,manifest}.mjs`, pure ESM imported by server, tests and browser alike — plus the dual-shape meta v2 sidecars for the 11 builtins, and the additive DB **V23** schema + `workflows.mjs` v2 row storage / overlays / API deltas underneath it. No engine, no UI: at the end of P2 a v2 template can be validated, saved, listed, archived, overlaid and refused a run with one clean message.

**Architecture:** `src/shared/graph/**` is pure (no `node:` builtins, no DOM, no top-level mutable state) and lives below both `src/core` and `ui/public`; Node imports it by ordinary relative path, the browser by a relative path that walks above the static root onto the `/src/shared` mount P1 added. Ports come from AGENT METADATA (`agents/<key>.meta.json` gains `metaVersion: 2` + typed `inputs`/`outputs` + capability fields while KEEPING every v1 field, so both engines read the same files), never from an embedded table. The validator is the single authority for graph legality: the composer, the server's 422, plugin import and the seed drift guard all call `validateGraph`. Storage is additive: `workflows.graph` holds `{nodes, wires, canvas?}` for `version = 2` rows, `archived_at` hides retired ones, `config_workflow_wires` carries per-wire loop budgets, and every read path (`readWorkflow`, `listWorkflows`, `assertRunnableWorkflow`, `resolveGraph`) is version-aware. The v1 engine stays live and untouched.

**Series position:** P2 of 8 (halves **P2a** pure core + sidecars / **P2b** schema + store); requires P1 landed (sentinel: `export class RunHarness` in `src/core/run-harness.mjs`, `export const SEED_TEMPLATES` in `src/core/graph/seed-templates.mjs`, `src/shared/graph/constants.mjs`, `src/shared/graph/verdict.mjs`); leaves dev green and shippable; v1 engine stays live.

**Tech Stack:** Node ≥ 22 (`node:sqlite`, `node:test`), Express server `ui/server.mjs`, vanilla ESM UI `ui/public/*.mjs` (no build step), jsdom 29 for UI tests, offline fake-claude mocks (`WORCA_MOCK=1`).

**Spec:** `docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` (UNTRACKED — absent in a pipeline worktree; this plan is self-contained and repeats every rule text, port table, formula, DDL and message string it needs).

## Global Constraints
- NEVER `git add` anything under `docs/superpowers/**`. Never `git push`. Product name in every user-facing string: "worca" (never "worca-cc").
- Commits: `worca: Node-graph v2 P2 — <task title>`.
- Run tests as `npm test` (full) or `node --test test/<file>.test.mjs` (one file). Baseline recorded in Task 0; per-half totals recorded in Task 13 and Task B10.
- `src/shared/**` PURITY (a guard test from P1 enforces it): relative imports that stay inside `src/shared`, no `node:` builtins, no `require`, no `process.`, no `window`/`document`/`navigator`/`localStorage`, no `fetch(`, no `import.meta`, no top-level `let`/`var` (use `const`). Shared code may NEVER import `src/core/**` or `ui/public/**` — that is why `MOCK_WRITER_ROLES` is PASSED IN to `agent-meta.mjs` and why the `UI_PHASE` map is COPIED into `manifest.mjs`.
- Test-file names are contracts: `test/graph-<module>.test.mjs` for the pure modules.
- Never hand-write graph error strings in `ui/server.mjs`: a 422 body carries `validateGraph`'s own issues by construction.
- Two module paths are FIXED and must not be renamed: `src/shared/graph/*.mjs` (pure) and `src/core/graph/registry-ports.mjs` (engine-side glue).

---

### Task 0: Branch check, deps, predecessor sentinels, baseline

- [ ] Step 1: `git rev-parse --abbrev-ref HEAD` — you are on the pipeline's branch (by hand: `git checkout -b worca-cc/node-graph-v2-p2` off dev FIRST, outside the run). NEVER `git checkout dev`, never create a branch inside a pipeline run.
- [ ] Step 2: `[ -d node_modules ] || npm ci`
- [ ] Step 3: predecessor sentinel — run and STOP if any line fails:
```bash
grep -q "export class RunHarness" src/core/run-harness.mjs \
  && grep -q "export const SEED_TEMPLATES" src/core/graph/seed-templates.mjs \
  && [ -f src/shared/graph/constants.mjs ] && [ -f src/shared/graph/verdict.mjs ] \
  && echo P1-OK
```
- [ ] Step 4: constants contract — every name this plan imports from P1's `constants.mjs` must exist:
```bash
for n in TEMPLATE_VERSION KINDS FLOW_KINDS PORT_TYPES AWAIT_PORT TASK_PORTS END_PORTS gatePorts \
         NODE_ID_RE WIRE_ID_RE PORT_ID_RE DEFAULT_MAX_CYCLES MAX_PORTS_PER_SIDE LIMITS; do
  grep -q "\b$n\b" src/shared/graph/constants.mjs || echo "MISSING $n"; done
node --input-type=module -e "
import { LIMITS } from './src/shared/graph/constants.mjs';
console.log(JSON.stringify(LIMITS));"
```
  `LIMITS` must expose finite `maxNodes` and `maxWires`. If it does not, ADD them in this task (`maxNodes: 60, maxWires: 120`, keeping every key P1 already put there) and record the deviation in the commit body — V1 enforces them.
- [ ] Step 5: old-branch source availability (this plan borrows pure modules from it):
```bash
git rev-parse --verify origin/worca-cc/v2-orchestrator-bfb6a0ed >/dev/null 2>&1 \
  || git fetch origin worca-cc/v2-orchestrator-bfb6a0ed
```
  Borrowing is OPTIONAL — every module below is embedded in full in this plan. Never paste an old-branch file blind.
- [ ] Step 6: `npm test 2>&1 | tail -5` — record the printed pass count as BASELINE; it must be green before you start.

---

### Task 1: `src/shared/graph/ports.mjs` — port resolution, types, conditional routing

**Files:** create `src/shared/graph/ports.mjs`, `test/graph-ports.test.mjs`. Borrowed from `old:src/core/graph/ports.mjs` (`firedOutputs`, `resolveOrOutType`) and `old:ui/public/graph/graph-model.mjs:27-52` (`portsFnFor`); **edits vs the borrowed code**: (a) `old:ports.mjs:18` imports `hasBlocking` from `../protocol.mjs`, which pulls `node:fs/promises` into the browser — import it from `../verdict.mjs` instead (NEVER borrow that line); (b) `portsFnFor` gains the `known`/`ported` distinction V4 needs; (c) `resolveOrOutType` takes `(tpl, portsFn, orId, seen)` per the module table, not `(node, template, portsFn)`; (d) `classifyLoops`/`isReady`/`makeToken` do NOT live here (loops.mjs / the P3 scheduler own them).

**Interfaces produced:** `flowPorts(node)`, `portsFnFor(agentsByKey)`, `portsOf(portsFn, node) → {known, ported, inputs, outputs, meta}` (never throws), `findPort(ports, portId, dir)`, `typeCompatible(outType, inType)`, `resolveOrOutType(tpl, portsFn, orId, seen)`, `inboundWires(tpl, nodeId, portId?)`, `outboundWires(tpl, nodeId, portId?)`, `firedOutputs(ports, verdict)`.
**Consumes:** `constants.mjs` (`AWAIT_PORT`, `FLOW_KINDS`, `gatePorts`, `TASK_PORTS`, `END_PORTS`), `verdict.mjs` (`hasBlocking`).

- [ ] Step 1: Write the failing test — `test/graph-ports.test.mjs`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flowPorts, portsFnFor, portsOf, findPort, typeCompatible,
  resolveOrOutType, inboundWires, outboundWires, firedOutputs,
} from '../src/shared/graph/ports.mjs';

const REG = {
  planner: { key: 'planner', metaVersion: 2, inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  reviewer: { key: 'reviewer', metaVersion: 2, verdict: { filename: 'r.json' },
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
  legacy: { key: 'legacy' },                       // v1-only sidecar: no inputs/outputs
};
const portsFn = portsFnFor(REG);
const agent = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, config: {} });

test('agent ports carry the synthesized await gate LAST and never mutate the meta', () => {
  const p = portsFn(agent('n1', 'planner'));
  assert.deepEqual(p.inputs.map((i) => i.id), ['task', 'await']);
  assert.equal(p.inputs.at(-1).type, 'any');
  assert.equal(p.inputs.at(-1).required, false);
  assert.equal(p.inputs.at(-1).synthetic, true);
  assert.equal(REG.planner.inputs.length, 1, 'the registry meta is untouched');
});

test('flowPorts: task/end/and/or/combine, arity-driven, unknown kind undefined', () => {
  assert.deepEqual(flowPorts({ kind: 'task' }).outputs, [{ id: 'task', type: 'md', when: 'always' }]);
  assert.deepEqual(flowPorts({ kind: 'task' }).inputs, []);
  assert.deepEqual(flowPorts({ kind: 'end' }).inputs.map((i) => i.id), ['result']);
  assert.equal(flowPorts({ kind: 'end' }).inputs[0].type, 'any');
  assert.deepEqual(flowPorts({ kind: 'end' }).outputs, []);
  const and3 = flowPorts({ kind: 'and', config: { arity: 3 } });
  assert.deepEqual(and3.inputs.map((i) => i.id), ['in1', 'in2', 'in3']);
  assert.equal(and3.outputs[0].type, 'void');
  assert.equal(flowPorts({ kind: 'or' }).outputs[0].type, 'any');
  assert.equal(flowPorts({ kind: 'combine' }).outputs[0].type, 'md');
  assert.deepEqual(flowPorts({ kind: 'combine' }).inputs.map((i) => i.type), ['md', 'md']);
  assert.equal(flowPorts({ kind: 'nope' }), undefined);
});

test('portsOf never throws and distinguishes unknown from un-ported', () => {
  assert.deepEqual(portsOf(portsFn, agent('n', 'nope')), { known: false, ported: false, inputs: [], outputs: [], meta: null });
  const legacy = portsOf(portsFn, agent('n', 'legacy'));
  assert.equal(legacy.known, true);
  assert.equal(legacy.ported, false);
  assert.deepEqual(legacy.inputs, []);
  const ok = portsOf(portsFn, agent('n', 'planner'));
  assert.equal(ok.known && ok.ported, true);
  assert.equal(ok.meta.key, 'planner');
  assert.equal(portsOf(() => { throw new Error('boom'); }, agent('n', 'planner')).known, false);
  assert.equal(portsOf(null, agent('n', 'planner')).known, false);
});

test('findPort + typeCompatible', () => {
  const p = portsFn(agent('n', 'reviewer'));
  assert.equal(findPort(p, 'pass', 'out').type, 'void');
  assert.equal(findPort(p, 'pass', 'in'), null);
  assert.equal(findPort(p, 'await', 'in').type, 'any');
  assert.equal(typeCompatible('md', 'md'), true);
  assert.equal(typeCompatible('json', 'md'), false);
  assert.equal(typeCompatible('json', 'any'), true);
  assert.equal(typeCompatible(null, 'md'), true, 'unresolvable source: caller skips');
});

test('resolveOrOutType walks inbound wires by inK index then wire id, through chained ors', () => {
  const tpl = { version: 2, nodes: [
    agent('n_p', 'planner'), { id: 'or1', kind: 'or', x: 0, y: 0, config: { arity: 2 } },
    { id: 'or2', kind: 'or', x: 0, y: 0, config: { arity: 2 } }],
    wires: [
      { id: 'w2', from: { node: 'or1', port: 'out' }, to: { node: 'or2', port: 'in1' } },
      { id: 'w1', from: { node: 'n_p', port: 'plan' }, to: { node: 'or1', port: 'in1' } },
    ] };
  assert.equal(resolveOrOutType(tpl, portsFn, 'or1'), 'md');
  assert.equal(resolveOrOutType(tpl, portsFn, 'or2'), 'md', 'resolves THROUGH the chained or');
  assert.equal(resolveOrOutType({ version: 2, nodes: [{ id: 'or1', kind: 'or', x: 0, y: 0, config: {} }], wires: [] }, portsFn, 'or1'), null);
});

test('resolveOrOutType terminates on a cyclic or chain (seen-set)', () => {
  const tpl = { version: 2, nodes: [
    { id: 'a', kind: 'or', x: 0, y: 0, config: {} }, { id: 'b', kind: 'or', x: 0, y: 0, config: {} }],
    wires: [
      { id: 'w1', from: { node: 'a', port: 'out' }, to: { node: 'b', port: 'in1' } },
      { id: 'w2', from: { node: 'b', port: 'out' }, to: { node: 'a', port: 'in1' } },
    ] };
  assert.equal(resolveOrOutType(tpl, portsFn, 'a'), null);
});

test('inboundWires / outboundWires filter by node and optional port', () => {
  const tpl = { version: 2, nodes: [agent('a', 'planner'), agent('b', 'reviewer')], wires: [
    { id: 'w1', from: { node: 'a', port: 'plan' }, to: { node: 'b', port: 'plan' } },
    { id: 'w2', from: { node: 'a', port: 'plan' }, to: { node: 'b', port: 'await' } },
  ] };
  assert.deepEqual(inboundWires(tpl, 'b').map((w) => w.id), ['w1', 'w2']);
  assert.deepEqual(inboundWires(tpl, 'b', 'await').map((w) => w.id), ['w2']);
  assert.deepEqual(outboundWires(tpl, 'a', 'plan').map((w) => w.id), ['w1', 'w2']);
  assert.deepEqual(outboundWires(tpl, 'b'), []);
});

test('firedOutputs fires always + exactly one conditional side, in declared order', () => {
  const outs = portsFn(agent('n', 'reviewer')).outputs;
  assert.deepEqual(firedOutputs(outs, { issues: [{ severity: 'major' }] }).map((o) => o.id), ['review']);
  assert.deepEqual(firedOutputs(outs, { issues: [{ severity: 'minor' }] }).map((o) => o.id), ['pass']);
  assert.deepEqual(firedOutputs(outs, null).map((o) => o.id), ['pass']);
  assert.deepEqual(firedOutputs(portsFn(agent('n', 'planner')), null).map((o) => o.id), ['plan'],
    'accepts a resolved ports object as well as an array');
});
```
`Expected: FAIL — Cannot find module '.../src/shared/graph/ports.mjs'`

- [ ] Step 2: Implement — `src/shared/graph/ports.mjs`
```js
// src/shared/graph/ports.mjs
// Port resolution for the v2 graph model — the ONE place that answers "what
// ports does this node have?" for the engine, the validator, the composer and
// the run monitor. Pure: no IO, no state, and NOTHING here throws on a
// malformed template — an unknown agent key (V4), a dangling endpoint (V5) or
// an unknown kind (V3) is an error for the validator to COLLECT, so every
// lookup guards instead of crashing.
import { AWAIT_PORT, FLOW_KINDS, gatePorts, TASK_PORTS, END_PORTS } from './constants.mjs';
import { hasBlocking } from './verdict.mjs';

/** Engine flow-card ports. `undefined` for an unknown kind — V3's error. */
export function flowPorts(node) {
  const kind = node?.kind;
  if (kind === 'task') return { known: true, ported: true, inputs: [], outputs: [...TASK_PORTS.outputs] };
  if (kind === 'end') return { known: true, ported: true, inputs: [...END_PORTS.inputs], outputs: [] };
  if (kind === 'and' || kind === 'or' || kind === 'combine') {
    const arity = Number.isInteger(node?.config?.arity) ? node.config.arity : 2;
    const { inputs, outputs } = gatePorts(kind, Math.max(2, arity));
    return { known: true, ported: true, inputs, outputs };
  }
  return undefined;
}

/**
 * Build the ports function over the merged agent registry (an object or a Map
 * keyed by agent key). Agent nodes get their sidecar's typed ports PLUS the
 * engine-synthesized `await` gate appended LAST; flow cards get flowPorts.
 * Three outcomes, and V4 tells them apart:
 *   unknown key            -> undefined            (known:false)
 *   key without v2 ports   -> {known:true, ported:false}
 *   ported v2 sidecar      -> {known:true, ported:true, inputs:[...meta, await]}
 */
export function portsFnFor(agentsByKey) {
  const index = agentsByKey instanceof Map
    ? agentsByKey
    : new Map(Object.entries(agentsByKey && typeof agentsByKey === 'object' ? agentsByKey : {}));
  return (node) => {
    if (!node || typeof node !== 'object') return undefined;
    if (node.kind !== 'agent') return flowPorts(node);
    const meta = index.get(node.key);
    if (!meta) return undefined;
    if (!Array.isArray(meta.inputs) || !Array.isArray(meta.outputs)) {
      return { ...meta, known: true, ported: false, inputs: [], outputs: [] };
    }
    return { ...meta, known: true, ported: true, inputs: [...meta.inputs, AWAIT_PORT], outputs: [...meta.outputs] };
  };
}

/**
 * Resolve one node's ports defensively. NEVER throws — a portsFn that throws,
 * a missing key and an unknown kind all collapse to `known:false`, and a
 * registry entry with no v2 ports reports `known:true, ported:false` so V4 can
 * say "port its sidecar" instead of "unknown agent".
 * @returns {{known:boolean, ported:boolean, inputs:Array, outputs:Array, meta:object|null}}
 */
export function portsOf(portsFn, node) {
  let resolved = null;
  try { resolved = typeof portsFn === 'function' ? portsFn(node) : null; } catch { resolved = null; }
  if (!resolved || typeof resolved !== 'object') {
    return { known: false, ported: false, inputs: [], outputs: [], meta: null };
  }
  const ported = resolved.ported !== false && Array.isArray(resolved.inputs);
  return {
    known: resolved.known !== false,
    ported,
    inputs: ported && Array.isArray(resolved.inputs) ? resolved.inputs : [],
    outputs: ported && Array.isArray(resolved.outputs) ? resolved.outputs : [],
    meta: resolved,
  };
}

/** One port of a RESOLVED ports object (`portsFn(node)` or `portsOf(...)`). */
export function findPort(ports, portId, dir) {
  const list = dir === 'out' ? ports?.outputs : ports?.inputs;
  return (Array.isArray(list) ? list : []).find((p) => p?.id === portId) || null;
}

/** Wire legality by type: `any` inputs accept everything, otherwise equality.
 *  A null/undefined source type is UNRESOLVABLE (an or with no inbound source)
 *  and compatible by construction — the caller skips it. */
export function typeCompatible(outType, inType) {
  if (outType === null || outType === undefined) return true;
  return inType === 'any' || outType === inType;
}

/**
 * The or card's payload type, resolved from its inbound wires' source outputs:
 * the first resolvable one, walking inbound wires by `inK` index and then by
 * wire id so the answer never depends on insertion order. Chained ors resolve
 * THROUGH (seen-set guarded, so a cyclic or->or chain returns null instead of
 * hanging). `null` = unresolvable (an unwired `inK` is already V12's error).
 */
export function resolveOrOutType(tpl, portsFn, orId, seen = new Set()) {
  if (!orId || seen.has(orId)) return null;
  seen.add(orId);
  const nodes = Array.isArray(tpl?.nodes) ? tpl.nodes : [];
  const byId = new Map(nodes.filter((n) => n && typeof n === 'object').map((n) => [n.id, n]));
  const inbound = inboundWires(tpl, orId)
    .sort((a, b) => portIndex(a.to.port) - portIndex(b.to.port) || compareIds(a.id, b.id));
  for (const w of inbound) {
    const src = byId.get(w?.from?.node);
    if (!src) continue;                                   // dangling endpoint — V5's error
    const out = findPort(portsOf(portsFn, src), w.from.port, 'out');
    if (!out) continue;
    if (out.type && out.type !== 'any') return out.type;
    if (src.kind === 'or') {
      const through = resolveOrOutType(tpl, portsFn, src.id, seen);
      if (through) return through;
    }
  }
  return null;
}

/** Live-or-not, every wire whose `to` (resp. `from`) matches, in template order. */
export function inboundWires(tpl, nodeId, portId) {
  return (Array.isArray(tpl?.wires) ? tpl.wires : []).filter((w) => w?.to?.node === nodeId
    && (portId === undefined || w?.to?.port === portId));
}

export function outboundWires(tpl, nodeId, portId) {
  return (Array.isArray(tpl?.wires) ? tpl.wires : []).filter((w) => w?.from?.node === nodeId
    && (portId === undefined || w?.from?.port === portId));
}

/**
 * Conditional routing (base spec §2): every `when: 'always'` output plus
 * EXACTLY one conditional side — `blocking` iff the verdict carries a critical
 * or major issue, `clean` otherwise. Declared order is preserved and the PORT
 * OBJECTS come back, because the executor needs filename/store/artifactKind.
 * Accepts an outputs array or a resolved ports object.
 */
export function firedOutputs(ports, verdict) {
  const declared = Array.isArray(ports) ? ports : (Array.isArray(ports?.outputs) ? ports.outputs : []);
  const side = hasBlocking(verdict) ? 'blocking' : 'clean';
  return declared.filter((o) => {
    const when = o?.when || 'always';
    return when === 'always' || when === side;
  });
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
```
If P1's `gatePorts(kind, arity)` returns a bare array rather than `{inputs, outputs}`, adapt this one call site (keep `gatePorts`' signature — it is P1's contract) and note it in the commit body.
`Expected: PASS — 8 tests passing` (`node --test test/graph-ports.test.mjs`, and `node --test test/shared-graph-purity.test.mjs` still green)
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — shared ports layer`

---

### Task 2: `src/shared/graph/loops.mjs` — Tarjan SCCs, loop classification, launch order

**Files:** create `src/shared/graph/loops.mjs`, `test/graph-loops.test.mjs`. Borrowed from `old:src/core/graph/ports.mjs` (`classifyLoops`, `tarjan`, `condensationTopo`); **edits**: (a) `tarjanSccs(ids, edges)` becomes a standalone export taking ids + `{from,to}` edges; (b) the return shape is the module table's `{loopWireIds, loopInputs, sccOf, launchOrder}` (was `{loopWires, loopInputs, sccs, order}`); (c) port resolution goes through `portsOf` so an unknown key cannot crash the walk.

**Interfaces produced:** `tarjanSccs(ids, edges) → string[][]` (components sorted, roots visited in id order), `classifyLoops(tpl, portsFn) → {loopWireIds:Set<string>, loopInputs:Set<'<node>.<port>'>, sccOf:Map<string,number>, launchOrder:string[]}`.
**Consumes:** `ports.mjs` (`portsOf`, `findPort`).

Rules (base spec §2 as amended by f): a **loop wire** has both endpoints in ONE nontrivial SCC (or is a self-wire) AND its source output is `when: 'blocking'` — those are the only wires that render amber, carry `config.maxCycles` and count deliveries toward the gate. A **loop input** is any input whose meta declares `loop: true`; it is wiring-independent, so an unwired one is still in the set. AND/OR/End outputs are `always` or absent, so a flow card never contributes a blocking-source edge (`or.out → implementer.fix` is a plain wire inside the SCC).

- [ ] Step 1: Write the failing test — `test/graph-loops.test.mjs`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tarjanSccs, classifyLoops } from '../src/shared/graph/loops.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

const REG = {
  planner: { key: 'planner', inputs: [{ id: 'task', type: 'md', required: true },
    { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  reviewer: { key: 'reviewer', verdict: { filename: 'r.json' },
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
};
const portsFn = portsFnFor(REG);
const n = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, config: {} });
const w = (id, fn, fp, tn, tp) => ({ id, from: { node: fn, port: fp }, to: { node: tn, port: tp } });
// planner -> reviewer -> planner (blocking review), plus a task source and an end sink.
const LOOPY = {
  version: 2,
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, n('n_plan', 'planner'),
    n('n_rev', 'reviewer'), { id: 'n_end', kind: 'end', x: 0, y: 0, config: {} }],
  wires: [w('w1', 'n_task', 'task', 'n_plan', 'task'), w('w2', 'n_plan', 'plan', 'n_rev', 'plan'),
    w('w3', 'n_rev', 'review', 'n_plan', 'revise'), w('w4', 'n_rev', 'pass', 'n_end', 'result')],
};

test('tarjanSccs: components sorted, deterministic, singletons included', () => {
  const sccs = tarjanSccs(['c', 'a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]);
  assert.deepEqual(sccs.map((s) => s.join('+')).sort(), ['a+b', 'c']);
  assert.deepEqual(tarjanSccs(['a'], [{ from: 'a', to: 'a' }]), [['a']]);
  assert.deepEqual(tarjanSccs([], []), []);
});

test('classifyLoops finds the blocking-source loop wire and the meta loop inputs', () => {
  const { loopWireIds, loopInputs } = classifyLoops(LOOPY, portsFn);
  assert.deepEqual([...loopWireIds], ['w3']);
  assert.deepEqual([...loopInputs].sort(), ['n_plan.revise']);
});

test('a clean-sourced wire inside the cycle is NOT a loop wire', () => {
  const tpl = { ...LOOPY, wires: [...LOOPY.wires, w('w5', 'n_rev', 'pass', 'n_plan', 'revise')] };
  const { loopWireIds } = classifyLoops(tpl, portsFn);
  assert.equal(loopWireIds.has('w5'), false);
  assert.equal(loopWireIds.has('w3'), true);
});

test('a self-wire with a blocking source is a loop wire (singleton SCC counts)', () => {
  const tpl = { version: 2, nodes: [n('n_rev', 'reviewer')],
    wires: [w('w1', 'n_rev', 'review', 'n_rev', 'plan')] };
  assert.deepEqual([...classifyLoops(tpl, portsFn).loopWireIds], ['w1']);
});

test('a blocking wire OUTSIDE any cycle is not a loop wire', () => {
  const tpl = { version: 2, nodes: [n('n_rev', 'reviewer'), n('n_plan', 'planner')],
    wires: [w('w1', 'n_rev', 'review', 'n_plan', 'revise')] };
  assert.equal(classifyLoops(tpl, portsFn).loopWireIds.size, 0);
});

test('launchOrder is condensation-topo with a nodeId tiebreak, cycle members together', () => {
  const { launchOrder, sccOf } = classifyLoops(LOOPY, portsFn);
  assert.deepEqual(launchOrder, ['n_task', 'n_plan', 'n_rev', 'n_end']);
  assert.equal(sccOf.get('n_plan'), sccOf.get('n_rev'), 'the two loop members share one component');
  assert.notEqual(sccOf.get('n_task'), sccOf.get('n_plan'));
});

test('dangling endpoints and unknown keys never crash the walk', () => {
  const tpl = { version: 2, nodes: [n('n_x', 'nope')], wires: [w('w1', 'ghost', 'out', 'n_x', 'plan')] };
  const r = classifyLoops(tpl, portsFn);
  assert.equal(r.loopWireIds.size, 0);
  assert.deepEqual(r.launchOrder, ['n_x']);
  assert.deepEqual(classifyLoops(null, portsFn).launchOrder, []);
});
```
`Expected: FAIL — Cannot find module '.../src/shared/graph/loops.mjs'`

- [ ] Step 2: Implement — `src/shared/graph/loops.mjs`
```js
// src/shared/graph/loops.mjs
// Loop classification and launch order. Two orthogonal concepts (base spec §2):
//   loop WIRE  (budget + amber styling) = both endpoints in ONE nontrivial SCC
//              (or a self-wire) AND the source output is `when:'blocking'`.
//   loop INPUT (firing semantics)       = an input declared `loop:true` in meta;
//              wiring-independent, so an unwired one is still in the set.
// Pure and crash-free: dangling endpoints and unknown agent keys are the
// validator's errors (V5/V4), so they are filtered, never thrown on.
import { portsOf, findPort } from './ports.mjs';

/**
 * Iterative Tarjan (an explicit stack — recursion depth is not a property worth
 * depending on). Roots are visited in sorted id order and every component is
 * returned sorted, so the result is reproducible run to run.
 * @param {string[]} ids
 * @param {Array<{from:string, to:string}>} edges
 * @returns {string[][]}
 */
export function tarjanSccs(ids, edges) {
  const adj = new Map((Array.isArray(ids) ? ids : []).map((id) => [id, []]));
  for (const e of Array.isArray(edges) ? edges : []) {
    if (adj.has(e?.from) && adj.has(e?.to)) adj.get(e.from).push(e.to);
  }
  for (const tos of adj.values()) tos.sort();
  const index = new Map(); const low = new Map(); const onStack = new Set();
  const stack = []; const sccs = []; let counter = 0;
  for (const root of [...adj.keys()].sort()) {
    if (index.has(root)) continue;
    index.set(root, counter); low.set(root, counter); counter += 1;
    stack.push(root); onStack.add(root);
    const work = [{ id: root, edges: adj.get(root) || [], at: 0 }];
    while (work.length) {
      const frame = work[work.length - 1];
      if (frame.at < frame.edges.length) {
        const next = frame.edges[frame.at];
        frame.at += 1;
        if (!index.has(next)) {
          index.set(next, counter); low.set(next, counter); counter += 1;
          stack.push(next); onStack.add(next);
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
        for (;;) { const id = stack.pop(); onStack.delete(id); scc.push(id); if (id === frame.id) break; }
        sccs.push(scc.sort());
      }
    }
  }
  return sccs;
}

/**
 * @param {object} tpl v2 template { nodes, wires }
 * @param {(node:object) => object|undefined} portsFn
 * @returns {{loopWireIds:Set<string>, loopInputs:Set<string>, sccOf:Map<string,number>, launchOrder:string[]}}
 *          `loopInputs` is graph-global (`'<nodeId>.<port>'`).
 */
export function classifyLoops(tpl, portsFn) {
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter((n) => n && typeof n === 'object');
  const byId = new Map();
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  const wires = (Array.isArray(tpl?.wires) ? tpl.wires : [])
    .filter((w) => byId.has(w?.from?.node) && byId.has(w?.to?.node));

  const ids = [...byId.keys()];
  const sccs = tarjanSccs(ids, wires.map((w) => ({ from: w.from.node, to: w.to.node })));
  const sccOf = new Map();
  sccs.forEach((scc, i) => scc.forEach((id) => sccOf.set(id, i)));
  const nontrivial = new Set(sccs.map((scc, i) => (scc.length > 1 ? i : -1)).filter((i) => i >= 0));
  const selfWired = new Set(wires.filter((w) => w.from.node === w.to.node).map((w) => w.from.node));

  const loopWireIds = new Set();
  for (const w of wires) {
    const a = sccOf.get(w.from.node);
    if (a === undefined || a !== sccOf.get(w.to.node)) continue;
    if (!nontrivial.has(a) && !selfWired.has(w.from.node)) continue;
    const out = findPort(portsOf(portsFn, byId.get(w.from.node)), w.from.port, 'out');
    if (out && out.when === 'blocking') loopWireIds.add(w.id);
  }

  const loopInputs = new Set();
  for (const n of nodes) {
    for (const inp of portsOf(portsFn, n).inputs) {
      if (inp?.loop) loopInputs.add(`${n.id}.${inp.id}`);
    }
  }

  return { loopWireIds, loopInputs, sccOf, launchOrder: condensationTopo(sccs, wires) };
}

/** Kahn over the condensation: ties break by the component's minimum node id
 *  (members are sorted), which is what makes the launch order reproducible.
 *  Parallel wires collapse to one condensation edge so in-degrees stay balanced. */
function condensationTopo(sccs, wires) {
  const sccOf = new Map();
  sccs.forEach((scc, i) => scc.forEach((id) => sccOf.set(id, i)));
  const succ = sccs.map(() => new Set());
  const indegree = sccs.map(() => 0);
  for (const w of wires) {
    const a = sccOf.get(w.from.node);
    const b = sccOf.get(w.to.node);
    if (a === undefined || b === undefined || a === b || succ[a].has(b)) continue;
    succ[a].add(b);
    indegree[b] += 1;
  }
  const remaining = new Set(sccs.map((_, i) => i));
  const order = [];
  while (remaining.size) {
    let pick = -1;
    for (const i of remaining) if (indegree[i] === 0 && (pick < 0 || sccs[i][0] < sccs[pick][0])) pick = i;
    if (pick < 0) break;                                   // acyclic by construction — defensive only
    remaining.delete(pick);
    order.push(...sccs[pick]);
    for (const b of succ[pick]) indegree[b] -= 1;
  }
  return order;
}
```
`Expected: PASS — 7 tests passing`
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — loop classification and launch order`

---

### Task 3: `src/shared/graph/validate.mjs` — the V1–V21 rule table (THE authority)

**Files:** create `src/shared/graph/validate.mjs`, `test/graph-validate.test.mjs`. Borrowed from `old:src/core/graph/validate.mjs`; **edits**: (a) issues use `message` (not `msg`) per the Issue contract, and rules are a `RULES` TABLE (`{code, level, check}`) that `validateGraph` iterates, instead of 21 hand-called functions; (b) `validateGraph(tpl, portsFn, {limits})` returns `{ok, errors, warnings}` (was `{errors, warnings}`) and V1 enforces `LIMITS.maxNodes`/`maxWires`; (c) V4 splits into the two messages `portsOf` now distinguishes; (d) `formatIssue` is new.

**Interfaces produced:** `RULES` (21 entries, V1–V21 in numeric order; V22 RETIRED and absent — its number stays reserved), `validateGraph(tpl, portsFn, {limits} = {}) → {ok:boolean, errors:Issue[], warnings:Issue[]}`, `formatIssue(issue) → string`. `Issue = {code, message, nodeId?, wireId?, portId?}` (+ `wireIds?: string[]` on V12's or-homogeneity issue only — the mismatched wires have no single wire to point at).
**Consumes:** `constants.mjs` (`KINDS`, `PORT_TYPES`, `NODE_ID_RE`, `LIMITS`), `ports.mjs`, `loops.mjs`.

**The rule list (base spec §2 as amended by Amendment f — E = error blocks save/run, W = warning). Message texts are the contract: the server's 422 body IS this list.**

| # | lvl | rule and message |
|---|---|---|
| V1 | E | shape: `template must be an object` · `template version must be 2 (got <json>)` · `template must declare a non-empty nodes array` · `template must declare a wires array` · `template has <n> nodes — the limit is <max>` · `template has <n> wires — the limit is <max>` |
| V2 | E | `node id <json> must match /^[A-Za-z0-9_-]{1,64}$/` · `duplicate node id '<id>'` · `node '<id>' must have finite x/y coordinates` |
| V3 | E | kind ∈ {agent, task, and, or, combine, end}; `key` iff agent: `node '<id>' has unknown kind <json> — expected one of agent, task, and, or, combine, end` · `agent node '<id>' must declare a key` · `node '<id>' of kind '<kind>' must not declare a key` |
| V4 | E | agent key resolves, is ported, and is placeable: `unknown agent "<key>" — no such key in the registry` · `agent "<key>" has no v2 ports — port its sidecar to metaVersion 2` · `agent "<key>" declares placeable: false and cannot be a graph node` (double quotes — the same three sentences `resolveGraph` throws, byte-equal) |
| V5 | E | endpoints + declared ports: `wire '<id>' starts at unknown node '<n>'` · `wire '<id>' ends at unknown node '<n>'` · `wire '<id>': '<n>.<p>' is not a declared output` · `wire '<id>': '<n>.<p>' is not a declared input` (ports checked only where the meta RESOLVED — an unknown key is V4's and re-reporting each wire would bury it) |
| V6 | E | `duplicate wire id '<id>'` · `duplicate wire <n>.<p> -> <n>.<p>` |
| V7 | E | UNIVERSAL single-wire inputs (restored by f; subsumes retired V22): `input '<node>.<port>' already has an inbound wire — every input accepts at most one (fan in through an or card)` — agent meta ports, the synthesized `await`, AND/OR/Combine `inK` and End's `result` alike; counted over ALL wires with no dependency on meta resolution. Fan-OUT is unrestricted |
| V8 | E | per-wire type equality, `any` inputs accept everything: `wire '<id>' type mismatch: <out> -> <in> (<n>.<p> -> <n>.<p>)`. The ONLY resolution in the system is the or valve's: an or's `out` type is `resolveOrOutType` (chained ors, seen-set), so its OUTBOUND wires compare against the resolved type; unresolvable ⇒ skip (V12 owns the unwired `inK`) |
| V9 | E | `required input '<node>.<port>' is unwired` — every required NON-LOOP input; loop inputs exempt |
| V10 | E | `cycle without a blocking-source edge: <ids> (wires <ids|none>)` — every nontrivial SCC needs ≥ 1 loop wire |
| V11 | E | `deadlock: no node in cycle <ids> can start — every member's required inputs come from inside the cycle` |
| V12 | E | AND/OR/Combine: `<kind> node '<id>' needs an integer arity >= 2 (got <json>)` (checked only when `config.arity` is EXPLICIT — flowPorts defaults it to 2) · `<kind> node '<id>' has unwired input '<inK>' — every inK must be wired` · or homogeneity: `or node '<id>' has heterogeneous inbound types (<t>, <t>) — every wire into an or must carry the same payload type` (+ `wireIds`) |
| V13 | E | `output '<n>.<p>' declares unknown when <json>` · `output '<n>.<p>' is when:'<when>' but the node produces no verdict` · `wire '<id>' maxCycles must be an integer >= 1 (got <json>)` · `wire '<id>' carries maxCycles but is not a loop wire` |
| V14 | E | `input '<n>.<p>' declares expands but is '<type>' — expands inputs must be json` |
| V15 | W | `node '<id>' is unreachable from any entry` (entries = nodes whose RESOLVED ports declare zero inputs; a node with unresolved meta is never an entry) |
| V16 | W | `node '<id>' sets awaitAll but has <n> wired non-loop input(s) — the barrier is a no-op` — agent nodes only; a wired `await` port COUNTS (`plan` + `await` = 2) |
| V17 | W | `node '<id>' has unknown config key '<k>' for kind '<kind>' — preserved and ignored` · `wire '<id>' has unknown config key '<k>' — preserved and ignored` (known per kind: agent `model effort fanOut askQuestions awaitAll`, task `planStoreSeed`, and/or/combine `arity`, end none; wire `maxCycles`) |
| V18 | W | `agent node '<id>' has <n> always-sourced payload inputs without awaitAll — it may double-fire on re-runs (enable Await-all or insert an AND card)` — AGENT nodes only (flow cards are outside the rule entirely). FOUR exemptions from the pair count: (a) inputs wired FROM the task node (it fires once by construction), (b) VOID inputs, (c) the synthesized `await` port (payload-less, and `any`-typed so (b) misses it), (d) `loop:true` inputs — LOAD-BEARING: `or.out → implementer.fix` is an always source, so without (d) the double-loop seeds warn forever |
| V19 | W | `blocking output '<n>.<p>' is wired into '<n>.<p>', which is not a loop input` — EXEMPT when the target is an AND/OR `inK` (the canonical loop-valve terminal), End's `result`, or an agent's synthesized `await`; Combine inputs still warn |
| V20 | E | `a template must declare exactly one task node (found <n>)` · `task node '<id>' must declare zero inputs` · `task node '<id>' output 'task' must have at least one wire` |
| V21 | E | `a template must declare exactly one end node (found <n>)` · `end node '<id>' must declare zero outputs` · `end node '<id>' input 'result' must be wired` |

"WIRED" everywhere above means: the wire's endpoints EXIST **and both ports resolve** — the same filter `classifyLoops` applies. A naive `wires.some()` would report a deleted task node's target as wired and swallow V9.

- [ ] Step 1: Write the failing test — `test/graph-validate.test.mjs` (each rule gets an assertion that FAILS if the rule is deleted; the shared `OK` fixture must stay 0/0 so a false positive is caught too)
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, validateGraph, formatIssue } from '../src/shared/graph/validate.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

// Inline fixture registry (the REAL sidecars arrive in test/helpers/graph-ports.mjs
// at Task 9 and are exercised by the seed drift guard, Task 12).
const REG = {
  planner: { key: 'planner', inputs: [{ id: 'task', type: 'md', required: true },
      { id: 'answers', type: 'json', required: false }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  impl: { key: 'impl', inputs: [{ id: 'fix', type: 'md', required: false, loop: true },
      { id: 'task', type: 'json', required: false, expands: true }, { id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'done', type: 'void', when: 'always' }] },
  reviewer: { key: 'reviewer', verdict: { filename: 'r.json' },
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'done', type: 'void', required: false }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
  clarify: { key: 'clarify', inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'answers', type: 'json', when: 'always' }] },
  legacy: { key: 'legacy' },                                     // known but not ported
  hidden: { key: 'hidden', placeable: false, inputs: [], outputs: [{ id: 'out', type: 'md', when: 'always' }] },
};
const portsFn = portsFnFor(REG);
const V = (tpl, opts) => validateGraph(tpl, portsFn, opts);
const codes = (list) => list.map((i) => i.code);
const A = (id, key, config = {}) => ({ id, kind: 'agent', key, x: 0, y: 0, config });
const F = (id, kind, config = {}) => ({ id, kind, x: 0, y: 0, config });
const W = (id, fn, fp, tn, tp, config) => ({ id, from: { node: fn, port: fp }, to: { node: tn, port: tp },
  ...(config ? { config } : {}) });
// task -> planner -> impl -> reviewer -{blocking}-> impl.fix (a loop), reviewer.pass -> end
const ok = () => ({
  id: 'wf_t', name: 'T', version: 2, domain: 'coding',
  nodes: [F('n_task', 'task'), A('n_plan', 'planner'), A('n_impl', 'impl'), A('n_rev', 'reviewer'), F('n_end', 'end')],
  wires: [W('w1', 'n_task', 'task', 'n_plan', 'task'), W('w2', 'n_plan', 'plan', 'n_impl', 'plan'),
    W('w3', 'n_plan', 'plan', 'n_rev', 'plan'), W('w4', 'n_impl', 'done', 'n_rev', 'done'),
    W('w5', 'n_rev', 'review', 'n_impl', 'fix', { maxCycles: 3 }), W('w6', 'n_rev', 'pass', 'n_end', 'result')],
});

test('the rule table is V1..V21 in order, with V22 retired', () => {
  assert.deepEqual(RULES.map((r) => r.code),
    ['V1','V2','V3','V4','V5','V6','V7','V8','V9','V10','V11','V12','V13','V14','V15','V16','V17','V18','V19','V20','V21']);
  assert.deepEqual(RULES.filter((r) => r.level === 'W').map((r) => r.code), ['V15','V16','V17','V18','V19']);
  for (const r of RULES) assert.equal(typeof r.check, 'function', `${r.code} has a check`);
});

test('a legal graph validates clean', () => {
  const r = V(ok());
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  assert.deepEqual(r.warnings, [], JSON.stringify(r.warnings));
  assert.equal(r.ok, true);
});

test('V1 shape + limits', () => {
  assert.deepEqual(codes(V(null).errors).filter((c) => c === 'V1').length ? ['V1'] : [], ['V1']);
  assert.match(V({ ...ok(), version: 1 }).errors.find((e) => e.code === 'V1').message, /version must be 2 \(got 1\)/);
  assert.ok(V({ ...ok(), nodes: [] }).errors.some((e) => e.code === 'V1'));
  assert.ok(V({ ...ok(), wires: undefined }).errors.some((e) => e.code === 'V1'));
  const big = { ...ok(), nodes: [...ok().nodes, ...Array.from({ length: 3 }, (_, i) => A(`x${i}`, 'clarify'))] };
  assert.match(V(big, { limits: { maxNodes: 4, maxWires: 99 } }).errors.find((e) => e.code === 'V1').message,
    /template has 8 nodes — the limit is 4/);
  assert.ok(V(ok(), { limits: { maxNodes: 99, maxWires: 2 } }).errors.some((e) => /wires — the limit is 2/.test(e.message)));
  assert.equal(V(ok(), { limits: { maxNodes: 99, maxWires: 99 } }).ok, true);
});

test('V2 node ids and coordinates', () => {
  const t = ok(); t.nodes[1] = { ...t.nodes[1], id: 'bad id' };
  assert.ok(V(t).errors.some((e) => e.code === 'V2' && /must match/.test(e.message)));
  const d = ok(); d.nodes.push(A('n_plan', 'clarify'));
  assert.ok(V(d).errors.some((e) => e.code === 'V2' && /duplicate node id 'n_plan'/.test(e.message)));
  const c = ok(); c.nodes[1] = { ...c.nodes[1], x: NaN };
  assert.ok(V(c).errors.some((e) => e.code === 'V2' && /finite x\/y/.test(e.message)));
});

test('V3 kinds and the key rule', () => {
  const t = ok(); t.nodes.push(F('n_weird', 'merge'));
  assert.ok(V(t).errors.some((e) => e.code === 'V3' && /unknown kind "merge"/.test(e.message)));
  const k = ok(); k.nodes[1] = { ...k.nodes[1], key: undefined };
  assert.ok(V(k).errors.some((e) => e.code === 'V3' && /must declare a key/.test(e.message)));
  const f = ok(); f.nodes[0] = { ...f.nodes[0], key: 'planner' };
  assert.ok(V(f).errors.some((e) => e.code === 'V3' && /must not declare a key/.test(e.message)));
});

test('V4 unknown agent vs un-ported sidecar vs placeable:false', () => {
  const u = ok(); u.nodes[1] = A('n_plan', 'ghost');
  assert.match(V(u).errors.find((e) => e.code === 'V4').message, /^unknown agent "ghost" — no such key in the registry$/);
  const l = ok(); l.nodes[1] = A('n_plan', 'legacy');
  assert.match(V(l).errors.find((e) => e.code === 'V4').message,
    /^agent "legacy" has no v2 ports — port its sidecar to metaVersion 2$/);
  const p = ok(); p.nodes.push(A('n_hidden', 'hidden'));
  assert.match(V(p).errors.find((e) => e.code === 'V4').message, /placeable: false/);
});

test('V5 endpoints and declared ports', () => {
  const t = ok(); t.wires.push(W('w9', 'ghost', 'task', 'n_plan', 'task'));
  assert.ok(V(t).errors.some((e) => e.code === 'V5' && /starts at unknown node 'ghost'/.test(e.message)));
  const b = ok(); b.wires.push(W('w9', 'n_plan', 'nope', 'n_impl', 'nope2'));
  const msgs = V(b).errors.filter((e) => e.code === 'V5').map((e) => e.message);
  assert.ok(msgs.some((m) => /'n_plan\.nope' is not a declared output/.test(m)));
  assert.ok(msgs.some((m) => /'n_impl\.nope2' is not a declared input/.test(m)));
});

test('V6 duplicate wire ids and duplicate (from,to) pairs', () => {
  const t = ok(); t.wires.push({ ...t.wires[0], id: 'w1' });
  const e = V(t).errors.filter((x) => x.code === 'V6').map((x) => x.message);
  assert.ok(e.some((m) => /duplicate wire id 'w1'/.test(m)));
  assert.ok(e.some((m) => /duplicate wire n_task\.task -> n_plan\.task/.test(m)));
});

test('V7 every input takes at most ONE wire — agent, await, inK and end.result alike', () => {
  const a = ok(); a.wires.push(W('w9', 'n_plan', 'plan', 'n_impl', 'plan'));
  assert.match(V(a).errors.find((e) => e.code === 'V7').message,
    /^input 'n_impl\.plan' already has an inbound wire — every input accepts at most one \(fan in through an or card\)$/);
  const g = ok(); g.wires.push(W('w9', 'n_plan', 'plan', 'n_impl', 'await'),
    W('w10', 'n_task', 'task', 'n_impl', 'await'));
  assert.ok(V(g).errors.some((e) => e.code === 'V7' && /n_impl\.await/.test(e.message)));
  const s = ok(); s.wires.push(W('w9', 'n_plan', 'plan', 'n_end', 'result'));
  assert.ok(V(s).errors.some((e) => e.code === 'V7' && /n_end\.result/.test(e.message)));
});
```
(continues in the next block)

```js
test('V8 per-wire types, any inputs, and the or valve resolution', () => {
  const t = ok(); t.nodes.push(A('n_cl', 'clarify'));
  t.wires.push(W('w7', 'n_task', 'task', 'n_cl', 'task'), W('w8', 'n_cl', 'answers', 'n_impl', 'plan'));
  assert.match(V(t).errors.find((e) => e.code === 'V8').message,
    /^wire 'w8' type mismatch: json -> md \(n_cl\.answers -> n_impl\.plan\)$/);
  const anyOk = ok(); anyOk.wires.push(W('w7', 'n_plan', 'plan', 'n_impl', 'await'));
  assert.equal(V(anyOk).errors.filter((e) => e.code === 'V8').length, 0, 'an any input accepts md');
  // or.out resolves to md from its inbound review wire, so or.out -> impl.fix is legal
  // and or.out -> a json input is not.
  const o = ok();
  o.nodes.push(F('n_or', 'or', { arity: 2 }), A('n_cl', 'clarify'));
  o.wires = [...o.wires.filter((w) => w.id !== 'w5'),
    W('w5', 'n_rev', 'review', 'n_or', 'in1', { maxCycles: 3 }),
    W('w7', 'n_task', 'task', 'n_cl', 'task'), W('w8', 'n_cl', 'answers', 'n_or', 'in2'),
    W('w9', 'n_or', 'out', 'n_impl', 'fix')];
  const r = V(o);
  assert.ok(r.errors.some((e) => e.code === 'V12' && /heterogeneous inbound types/.test(e.message)));
  assert.deepEqual(r.errors.find((e) => e.code === 'V12' && e.wireIds).wireIds.sort(), ['w5', 'w8']);
});

test('V9 required non-loop inputs must be wired; loop inputs exempt', () => {
  const t = ok(); t.wires = t.wires.filter((w) => w.id !== 'w2');
  assert.match(V(t).errors.find((e) => e.code === 'V9').message, /^required input 'n_impl\.plan' is unwired$/);
  assert.equal(V(ok()).errors.filter((e) => e.code === 'V9').length, 0, 'the unwired loop input never warns');
});

test('V10 a cycle needs a blocking-source edge', () => {
  const t = ok();
  t.wires = t.wires.map((w) => (w.id === 'w5'
    ? W('w5', 'n_rev', 'pass', 'n_impl', 'fix') : w));       // clean source: no loop wire left
  assert.match(V(t).errors.find((e) => e.code === 'V10').message,
    /^cycle without a blocking-source edge: n_impl, n_rev \(wires w4, w5\)$/);
});

test('V11 deadlock freedom', () => {
  // planner.task and reviewer.plan each fed from INSIDE the cycle => nothing can start.
  const t = ok();
  t.wires = [W('w1', 'n_task', 'task', 'n_impl', 'plan'), W('w2', 'n_plan', 'plan', 'n_rev', 'plan'),
    W('w3', 'n_rev', 'review', 'n_plan', 'task', { maxCycles: 3 }), W('w4', 'n_rev', 'pass', 'n_end', 'result')];
  assert.match(V(t).errors.find((e) => e.code === 'V11').message,
    /^deadlock: no node in cycle n_plan, n_rev can start — every member's required inputs come from inside the cycle$/);
  assert.equal(V(ok()).errors.filter((e) => e.code === 'V11').length, 0);
});

test('V12 arity, unwired inK and or homogeneity', () => {
  const a = ok(); a.nodes.push(F('n_and', 'and', { arity: 1 }));
  assert.match(V(a).errors.find((e) => e.code === 'V12').message,
    /^and node 'n_and' needs an integer arity >= 2 \(got 1\)$/);
  const u = ok(); u.nodes.push(F('n_and', 'and', { arity: 2 }));
  u.wires.push(W('w7', 'n_plan', 'plan', 'n_and', 'in1'), W('w8', 'n_and', 'out', 'n_impl', 'await'));
  assert.match(V(u).errors.find((e) => e.code === 'V12').message,
    /^and node 'n_and' has unwired input 'in2' — every inK must be wired$/);
  const d = ok(); d.nodes.push(F('n_or', 'or'));               // no explicit arity => 2, legal
  assert.equal(V(d).errors.filter((e) => e.code === 'V12' && /arity/.test(e.message)).length, 0);
});

test('V13 when + verdict + maxCycles placement', () => {
  const t = ok();
  t.wires = t.wires.map((w) => (w.id === 'w2' ? { ...w, config: { maxCycles: 2 } } : w));
  assert.match(V(t).errors.find((e) => e.code === 'V13').message,
    /^wire 'w2' carries maxCycles but is not a loop wire$/);
  const z = ok();
  z.wires = z.wires.map((w) => (w.id === 'w5' ? { ...w, config: { maxCycles: 0 } } : w));
  assert.ok(V(z).errors.some((e) => e.code === 'V13' && /maxCycles must be an integer >= 1 \(got 0\)/.test(e.message)));
  const bad = portsFnFor({ ...REG, reviewer: { ...REG.reviewer, verdict: undefined } });
  const r = validateGraph(ok(), bad);
  assert.ok(r.errors.some((e) => e.code === 'V13' && /is when:'blocking' but the node produces no verdict/.test(e.message)));
});

test('V14 expands inputs must be json', () => {
  const fn = portsFnFor({ ...REG, impl: { ...REG.impl,
    inputs: REG.impl.inputs.map((i) => (i.id === 'task' ? { ...i, type: 'md' } : i)) } });
  assert.match(validateGraph(ok(), fn).errors.find((e) => e.code === 'V14').message,
    /^input 'n_impl\.task' declares expands but is 'md' — expands inputs must be json$/);
  assert.equal(V(ok()).errors.filter((e) => e.code === 'V14').length, 0);
});

test('V15 unreachable node warns', () => {
  const t = ok(); t.nodes.push(A('n_orphan', 'reviewer'));
  t.wires.push(W('w7', 'n_plan', 'plan', 'n_orphan', 'plan'), W('w8', 'n_orphan', 'pass', 'n_impl', 'await'));
  assert.equal(V(t).warnings.filter((w) => w.code === 'V15').length, 0);
  const o = ok(); o.nodes.push(A('n_orphan', 'clarify'));
  o.wires.push(W('w7', 'n_orphan', 'answers', 'n_plan', 'answers'));
  assert.match(V(o).warnings.find((w) => w.code === 'V15').message, /^node 'n_orphan' is unreachable from any entry$/);
});

test('V16 awaitAll no-op counts the wired await port', () => {
  const one = ok();
  one.nodes = one.nodes.map((n) => (n.id === 'n_impl' ? A('n_impl', 'impl', { awaitAll: true }) : n));
  assert.match(V(one).warnings.find((w) => w.code === 'V16').message,
    /^node 'n_impl' sets awaitAll but has 1 wired non-loop input\(s\) — the barrier is a no-op$/);
  const two = { ...one, wires: [...one.wires, W('w7', 'n_task', 'task', 'n_impl', 'await')] };
  assert.equal(V(two).warnings.filter((w) => w.code === 'V16').length, 0, 'plan + await = a real barrier');
});

test('V17 unknown config keys warn per kind and are preserved', () => {
  const t = ok();
  t.nodes = t.nodes.map((n) => (n.id === 'n_impl' ? A('n_impl', 'impl', { planStoreSeed: true }) : n));
  t.wires = t.wires.map((w) => (w.id === 'w5' ? { ...w, config: { maxCycles: 3, colour: 'red' } } : w));
  const ws = V(t).warnings.filter((w) => w.code === 'V17').map((w) => w.message);
  assert.ok(ws.some((m) => /node 'n_impl' has unknown config key 'planStoreSeed' for kind 'agent' — preserved and ignored/.test(m)));
  assert.ok(ws.some((m) => /wire 'w5' has unknown config key 'colour' — preserved and ignored/.test(m)));
  const okTask = ok();
  okTask.nodes = okTask.nodes.map((n) => (n.id === 'n_task' ? F('n_task', 'task', { planStoreSeed: true }) : n));
  assert.equal(V(okTask).warnings.filter((w) => w.code === 'V17').length, 0);
});

test('V18 pair count and its four exemptions', () => {
  const t = ok();                                             // impl: plan (always md) + task json unwired
  t.nodes.push(A('n_cl', 'clarify'));
  t.wires.push(W('w7', 'n_task', 'task', 'n_cl', 'task'), W('w8', 'n_cl', 'answers', 'n_impl', 'task'));
  assert.match(V(t).warnings.find((w) => w.code === 'V18').message,
    /^agent node 'n_impl' has 2 always-sourced payload inputs without awaitAll — it may double-fire on re-runs \(enable Await-all or insert an AND card\)$/);
  const off = { ...t, nodes: t.nodes.map((n) => (n.id === 'n_impl' ? A('n_impl', 'impl', { awaitAll: true }) : n)) };
  assert.equal(V(off).warnings.filter((w) => w.code === 'V18').length, 0);
  // (a) task-sourced, (b) void, (c) await, (d) loop are all exempt: the base graph
  // wires plan+done into the reviewer and plan+fix into the implementer and stays clean.
  assert.equal(V(ok()).warnings.filter((w) => w.code === 'V18').length, 0);
});

test('V19 blocking receivers, with the OR/AND/End/await exemptions', () => {
  const t = ok(); t.wires.push(W('w7', 'n_rev', 'review', 'n_plan', 'answers'));
  assert.match(V(t).warnings.find((w) => w.code === 'V19').message,
    /^blocking output 'n_rev\.review' is wired into 'n_plan\.answers', which is not a loop input$/);
  const o = ok(); o.nodes.push(F('n_or', 'or', { arity: 2 }), A('n_r2', 'reviewer'));
  o.wires = [...o.wires.filter((w) => w.id !== 'w5'),
    W('w5', 'n_rev', 'review', 'n_or', 'in1', { maxCycles: 3 }),
    W('w7', 'n_plan', 'plan', 'n_r2', 'plan'), W('w8', 'n_r2', 'review', 'n_or', 'in2'),
    W('w9', 'n_or', 'out', 'n_impl', 'fix'), W('w10', 'n_r2', 'pass', 'n_impl', 'await')];
  assert.deepEqual(V(o).warnings.filter((w) => w.code === 'V19'), []);
  assert.deepEqual(V(o).errors, [], JSON.stringify(V(o).errors));
});

test('V20/V21 exactly one task and one end', () => {
  const two = ok(); two.nodes.push(F('n_task2', 'task'));
  two.wires.push(W('w7', 'n_task2', 'task', 'n_impl', 'await'));
  assert.match(V(two).errors.find((e) => e.code === 'V20').message,
    /^a template must declare exactly one task node \(found 2\)$/);
  const noEnd = ok(); noEnd.nodes = noEnd.nodes.filter((n) => n.kind !== 'end');
  noEnd.wires = noEnd.wires.filter((w) => w.to.node !== 'n_end');
  assert.match(V(noEnd).errors.find((e) => e.code === 'V21').message,
    /^a template must declare exactly one end node \(found 0\)$/);
  const dangling = ok(); dangling.wires = dangling.wires.filter((w) => w.id !== 'w6');
  assert.ok(V(dangling).errors.some((e) => e.code === 'V21' && /input 'result' must be wired/.test(e.message)));
  const noOut = ok(); noOut.wires = noOut.wires.filter((w) => w.id !== 'w1');
  assert.ok(V(noOut).errors.some((e) => e.code === 'V20' && /output 'task' must have at least one wire/.test(e.message)));
});

test('formatIssue names the offending node or wire', () => {
  const t = ok(); t.wires.push(W('w9', 'n_plan', 'plan', 'n_impl', 'plan'));
  assert.equal(formatIssue(V(t).errors.find((e) => e.code === 'V7')),
    "V7: input 'n_impl.plan' already has an inbound wire — every input accepts at most one (fan in through an or card) (wire w9)");
  assert.equal(formatIssue({ code: 'V4', message: 'x', nodeId: 'n1' }), 'V4: x (node n1)');
  assert.equal(formatIssue(null), '?: ');
});
```
`Expected: FAIL — Cannot find module '.../src/shared/graph/validate.mjs'`

- [ ] Step 2: Implement — `src/shared/graph/validate.mjs` (part 1: context + V1–V11)
```js
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

const ARITY_KINDS = new Set(['and', 'or', 'combine']);
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

/** Resolve every node's ports ONCE and derive the views the rules read. */
function buildContext(template, portsFn, limits) {
  const nodes = (Array.isArray(template?.nodes) ? template.nodes : []).filter(isObject);
  const wires = (Array.isArray(template?.wires) ? template.wires : []).filter(isObject);
  const nodeById = new Map();
  for (const n of nodes) if (!nodeById.has(n.id)) nodeById.set(n.id, n);

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
```
(implementation continues in the next block — the `RULES` table)

```js
/** The rule table — run in numeric order, so `errors` reads outside-in (shape,
 *  nodes, wires, semantics). `add(message, extra)` stamps the rule's own code
 *  and routes to errors/warnings by `level`. */
export const RULES = [
  { code: 'V1', level: 'E', check({ template, limits }, add) {
    if (!isObject(template)) { add('template must be an object'); return; }
    if (template.version !== 2) add(`template version must be 2 (got ${JSON.stringify(template.version)})`);
    if (!Array.isArray(template.nodes) || template.nodes.length === 0) add('template must declare a non-empty nodes array');
    if (!Array.isArray(template.wires)) add('template must declare a wires array');
    const n = Array.isArray(template.nodes) ? template.nodes.length : 0;
    const w = Array.isArray(template.wires) ? template.wires.length : 0;
    if (n > limits.maxNodes) add(`template has ${n} nodes — the limit is ${limits.maxNodes}`);
    if (w > limits.maxWires) add(`template has ${w} wires — the limit is ${limits.maxWires}`);
  } },

  { code: 'V2', level: 'E', check({ nodes }, add) {
    const seen = new Set();
    for (const n of nodes) {
      const id = n.id;
      if (typeof id !== 'string' || !NODE_ID_RE.test(id)) {
        add(`node id ${JSON.stringify(id)} must match /^[A-Za-z0-9_-]{1,64}$/`, { nodeId: id });
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
      else if (metaOf(fromId) && !outputPort(fromId, w.from.port)) {
        add(`wire '${w.id}': '${fromId}.${w.from.port}' is not a declared output`, { wireId: w.id });
      }
      if (!nodeById.has(toId)) add(`wire '${w.id}' ends at unknown node '${toId}'`, { wireId: w.id });
      else if (metaOf(toId) && !inputPort(toId, w.to.port)) {
        add(`wire '${w.id}': '${toId}.${w.to.port}' is not a declared input`, { wireId: w.id });
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
      if (!metaOf(n.id)) continue;                                     // V3/V4 own an unresolved node
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
```
(the table continues in the next block)

```js
  // Arity is checked only when EXPLICITLY present: flowPorts defaults it to 2, so
  // a card authored without one is legal. Combine's "all md" and AND's "any type"
  // ride the declared port types and are enforced per wire by V8; what needs a
  // rule of its own is the or, whose inbound source types must ALL resolve equal.
  { code: 'V12', level: 'E', check(ctx, add) {
    const { nodes, metaOf, inputsOf, isWired, liveWires, nodeById, outputPort } = ctx;
    for (const n of nodes) {
      if (!ARITY_KINDS.has(n.kind)) continue;
      const arity = n.config?.arity;
      if (arity !== undefined && (!Number.isInteger(arity) || arity < 2)) {
        add(`${n.kind} node '${n.id}' needs an integer arity >= 2 (got ${JSON.stringify(arity)})`, { nodeId: n.id });
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
```
`Expected: PASS — 23 tests passing` (`node --test test/graph-validate.test.mjs`)
- [ ] Step 3: Mutation audit — delete each rule's `check` body in turn (or splice the entry out of `RULES`) and confirm `node --test test/graph-validate.test.mjs` FAILS; restore. Any rule whose removal keeps the suite green needs a sharper assertion before you move on.
- [ ] Step 4: Commit — `worca: Node-graph v2 P2 — shared graph validator (V1-V21)`

---

### Task 4: `src/shared/graph/template.mjs` — normalize, factory, `canWire`

**Files:** create `src/shared/graph/template.mjs`, `test/graph-template.test.mjs`. Borrowed from `old:ui/public/graph/graph-model.mjs:851-997`; **edits**: (a) `newNode(kind, key, x, y)` is POSITIONAL per the module table (the old form was `newNode(kind, {key,x,y})`); (b) ids come from `mintId(prefix, taken)` — a `taken` Set makes minting collision-free and testable (the old `randomId` could theoretically repeat); (c) `canWire` gains the `same node` reason and returns `{ok, code?, reason?}` with the V-code that would fire; (d) `removeNode`/`removeWire`/`nodeById`/`wireById` are new.

**Interfaces produced:** `normalizeTemplate(raw)`, `serializeTemplate(tpl)` (stable key order), `newNode(kind, key, x, y)`, `newWire(from, to, config?)`, `mintId(prefix, taken)`, `canWire({tpl, portsFn, from, to}) → {ok, code?, reason?}`, `removeNode(tpl, nodeId)`, `removeWire(tpl, wireId)`, `nodeById(tpl, id)`, `wireById(tpl, id)`.
**canWire reasons (rendered verbatim in the composer's chip, P5):** `same node` (code `V0`) · `unknown port` (`V5`) · `already connected` (`V7`) · `<out> → <in> type mismatch` e.g. `json → md type mismatch` (`V8`) · `or inputs must match: <type>` (`V12`). Note the arrow is U+2192 with spaces.

- [ ] Step 1: Write the failing test — `test/graph-template.test.mjs`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTemplate, serializeTemplate, newNode, newWire, mintId, canWire,
  removeNode, removeWire, nodeById, wireById,
} from '../src/shared/graph/template.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

const REG = {
  planner: { key: 'planner', inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  clarify: { key: 'clarify', inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'answers', type: 'json', when: 'always' }] },
};
const portsFn = portsFnFor(REG);
const tpl = () => normalizeTemplate({
  id: 'wf_t', name: 'T', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0 }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0 },
    { id: 'n_cl', kind: 'agent', key: 'clarify', x: 0, y: 200 }, { id: 'n_or', kind: 'or', x: 600, y: 200, config: { arity: 2 } }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }],
});

test('normalizeTemplate coerces shape, keeps unknown config, drops junk', () => {
  const t = normalizeTemplate({ nodes: [{ id: 'a', kind: 'agent', key: 'planner', x: '5', y: 6, config: { zzz: 1 } }, null],
    wires: [{ id: 'w', from: { node: 'a', port: 'plan' }, to: { node: 'b', port: 'task' }, config: {} }, 7],
    canvas: { x: 1, y: 2, zoom: 0.5 } });
  assert.equal(t.version, 2);
  assert.equal(t.nodes.length, 1);
  assert.deepEqual(t.nodes[0], { id: 'a', kind: 'agent', x: 5, y: 6, config: { zzz: 1 }, key: 'planner' });
  assert.equal(t.wires.length, 1);
  assert.equal('config' in t.wires[0], false, 'an empty wire config is dropped');
  assert.deepEqual(t.canvas, { x: 1, y: 2, zoom: 0.5 });
  assert.equal(normalizeTemplate({ canvas: { x: 1, y: 2 } }).canvas, undefined, 'a half-written canvas is dropped');
  assert.equal(normalizeTemplate(null).nodes.length, 0);
  assert.equal(normalizeTemplate({ nodes: [{ id: 'a', kind: 'task', x: 0, y: 0, key: 'planner' }] }).nodes[0].key,
    undefined, 'only agent nodes keep a key (V3)');
});

test('serializeTemplate has a stable key order and round-trips through JSON', () => {
  const a = serializeTemplate(tpl());
  const b = serializeTemplate(normalizeTemplate(JSON.parse(JSON.stringify(a))));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(Object.keys(a), ['id', 'name', 'version', 'domain', 'nodes', 'wires']);
  assert.deepEqual(Object.keys(a.nodes[1]), ['id', 'kind', 'key', 'x', 'y', 'config']);
  assert.deepEqual(Object.keys(a.wires[0]), ['id', 'from', 'to']);
});

test('mintId: prefix + 8 base36 chars, never a collision with `taken`', () => {
  const id = mintId('n_', new Set());
  assert.match(id, /^n_[0-9a-z]{8}$/);
  const taken = new Set();
  for (let i = 0; i < 200; i += 1) {
    const next = mintId('w_', taken);
    assert.equal(taken.has(next), false);
    taken.add(next);
  }
});

test('newNode / newWire', () => {
  const n = newNode('agent', 'planner', 10, 20);
  assert.match(n.id, /^n_[0-9a-z]{8}$/);
  assert.deepEqual({ kind: n.kind, key: n.key, x: n.x, y: n.y, config: n.config }, { kind: 'agent', key: 'planner', x: 10, y: 20, config: {} });
  assert.equal(newNode('end', null, 0, 0).key, undefined);
  assert.equal(newNode('or', null, 0, 0).config.arity, 2, 'and/or/combine are born with arity 2');
  const w = newWire({ node: 'a', port: 'plan' }, { node: 'b', port: 'task' }, { maxCycles: 3 });
  assert.match(w.id, /^w_[0-9a-z]{8}$/);
  assert.deepEqual(w.config, { maxCycles: 3 });
  assert.equal('config' in newWire({ node: 'a', port: 'p' }, { node: 'b', port: 'q' }), false);
});

test('canWire: legal drop', () => {
  const r = canWire({ tpl: tpl(), portsFn, from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_or', port: 'in1' } });
  assert.deepEqual(r, { ok: true });
});

test('canWire: same node, unknown port, already connected', () => {
  const t = tpl();
  assert.deepEqual(canWire({ tpl: t, portsFn, from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_plan', port: 'task' } }),
    { ok: false, code: 'V0', reason: 'same node' });
  assert.deepEqual(canWire({ tpl: t, portsFn, from: { node: 'n_plan', port: 'nope' }, to: { node: 'n_or', port: 'in1' } }),
    { ok: false, code: 'V5', reason: 'unknown port' });
  assert.deepEqual(canWire({ tpl: t, portsFn, from: { node: 'n_cl', port: 'answers' }, to: { node: 'n_plan', port: 'task' } }),
    { ok: false, code: 'V7', reason: 'already connected' });
});

test('canWire: type mismatch, and `any` inputs accept everything', () => {
  const t = tpl();
  t.nodes.push({ id: 'n_p2', kind: 'agent', key: 'planner', x: 900, y: 0, config: {} });
  assert.deepEqual(canWire({ tpl: t, portsFn, from: { node: 'n_cl', port: 'answers' }, to: { node: 'n_p2', port: 'task' } }),
    { ok: false, code: 'V8', reason: 'json → md type mismatch' });
  assert.equal(canWire({ tpl: t, portsFn, from: { node: 'n_cl', port: 'answers' }, to: { node: 'n_p2', port: 'await' } }).ok, true);
});

test('canWire: or homogeneity mirrors V8/V12', () => {
  const t = tpl();
  t.wires.push(newWire({ node: 'n_plan', port: 'plan' }, { node: 'n_or', port: 'in1' }));
  assert.deepEqual(canWire({ tpl: t, portsFn, from: { node: 'n_cl', port: 'answers' }, to: { node: 'n_or', port: 'in2' } }),
    { ok: false, code: 'V12', reason: 'or inputs must match: md' });
});

test('removeNode drops the node AND its wires; removeWire drops one wire', () => {
  const t = removeNode(tpl(), 'n_plan');
  assert.equal(nodeById(t, 'n_plan'), null);
  assert.deepEqual(t.wires, []);
  const w = removeWire(tpl(), 'w1');
  assert.equal(wireById(w, 'w1'), null);
  assert.equal(w.nodes.length, 4);
  assert.equal(removeNode(tpl(), 'ghost').nodes.length, 4, 'removing an unknown id is a no-op');
});

test('nodeById / wireById', () => {
  assert.equal(nodeById(tpl(), 'n_or').kind, 'or');
  assert.equal(wireById(tpl(), 'w1').to.port, 'task');
  assert.equal(nodeById(null, 'x'), null);
});
```
`Expected: FAIL — Cannot find module '.../src/shared/graph/template.mjs'`

- [ ] Step 2: Implement — `src/shared/graph/template.mjs`
```js
// src/shared/graph/template.mjs
// The editable v2 template: normalize/serialize, the node/wire factory and the
// drop-legality check the composer runs on the POINTER PATH (so it must stay a
// Map lookup plus a type check — never a Tarjan walk).
import { TEMPLATE_VERSION } from './constants.mjs';
import { portsOf, findPort, resolveOrOutType, inboundWires } from './ports.mjs';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const ARITY_KINDS = new Set(['and', 'or', 'combine']);

/** Canonicalize an authored or fetched template: numeric coordinates, a
 *  materialized `config` on every node, non-object nodes/wires dropped, `key`
 *  kept only where V3 allows it. Unknown config keys are PRESERVED (V17 warns
 *  and ignores them; it never strips them). */
export function normalizeTemplate(raw) {
  const t = isObject(raw) ? raw : {};
  const template = {
    id: String(t.id ?? ''),
    name: String(t.name ?? ''),
    version: TEMPLATE_VERSION,
    domain: String(t.domain ?? ''),
    nodes: (Array.isArray(t.nodes) ? t.nodes : []).filter(isObject).map(normalizeNode),
    wires: (Array.isArray(t.wires) ? t.wires : []).filter(isObject).map(normalizeWire),
  };
  const canvas = normalizeCanvas(t.canvas);
  if (canvas) template.canvas = canvas;     // view state, engine-ignored — but it round-trips
  return template;
}

/** The POST body: normalized, stable key order, stripped of anything JSON cannot carry. */
export function serializeTemplate(template) {
  return JSON.parse(JSON.stringify(normalizeTemplate(template)));
}

function normalizeNode(node) {
  const out = { id: String(node.id ?? ''), kind: String(node.kind ?? '') };
  if (out.kind === 'agent' && node.key !== undefined) out.key = String(node.key);
  out.x = Number(node.x);
  out.y = Number(node.y);
  out.config = isObject(node.config) ? { ...node.config } : {};
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

/** `n_`/`w_` + 8 base36 chars, re-drawn until it misses `taken` (a Set of ids). */
export function mintId(prefix, taken) {
  const used = taken instanceof Set ? taken : new Set(Array.isArray(taken) ? taken : []);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let body = '';
    while (body.length < 8) body += Math.random().toString(36).slice(2);
    const id = `${prefix}${body.slice(0, 8)}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}${Date.now().toString(36).slice(-8)}`;   // unreachable in practice
}

/** @param {'agent'|'task'|'end'|'and'|'or'|'combine'} kind @param {string|null} key */
export function newNode(kind, key, x = 0, y = 0, taken) {
  const node = { id: mintId('n_', taken) , kind };
  if (kind === 'agent' && key) node.key = String(key);      // V3: only agent nodes carry a key
  node.x = Number(x) || 0;
  node.y = Number(y) || 0;
  node.config = ARITY_KINDS.has(kind) ? { arity: 2 } : {};
  return node;
}

export function newWire(from, to, config, taken) {
  const wire = {
    id: mintId('w_', taken),
    from: { node: from.node, port: from.port },
    to: { node: to.node, port: to.port },
  };
  if (isObject(config) && Object.keys(config).length) wire.config = { ...config };
  return wire;
}

/**
 * Drop legality, derived entirely from the template — which is what lets it see
 * or-homogeneity and existing wires at all. Reasons, in check order:
 *   same node                 — an output and an input of the SAME card
 *   unknown port              — the endpoint does not resolve (V5)
 *   already connected         — UNIFORM single-wire (V7): ANY wired input rejects,
 *                               agent ports, or `inK`, `end.result` and `await`
 *                               alike. A duplicate (from,to) pair is necessarily a
 *                               second wire into a wired input, so it lands here
 *                               too. Rewiring is remove-then-drop.
 *   <out> → <in> type mismatch — per-wire legality (V8); `any` accepts everything
 *   or inputs must match: <t>  — or homogeneity (V12), mirrored from the resolved
 *                               payload type; an or accepts ANY type until one
 *                               in-wire exists.
 * @returns {{ok:true} | {ok:false, code:string, reason:string}}
 */
export function canWire({ tpl, portsFn, from, to }) {
  const nodes = Array.isArray(tpl?.nodes) ? tpl.nodes : [];
  const byId = new Map(nodes.filter(isObject).map((n) => [n.id, n]));
  const source = byId.get(from?.node);
  const target = byId.get(to?.node);
  if (source && target && source.id === target.id) return deny('V0', 'same node');
  const outPort = source ? findPort(portsOf(portsFn, source), from.port, 'out') : null;
  const inPort = target ? findPort(portsOf(portsFn, target), to.port, 'in') : null;
  if (!outPort || !inPort) return deny('V5', 'unknown port');
  if (inboundWires(tpl, to.node, to.port).length) return deny('V7', 'already connected');

  const sourceType = outPort.type && outPort.type !== 'any'
    ? outPort.type
    : (source.kind === 'or' ? resolveOrOutType(tpl, portsFn, source.id) : outPort.type ?? null);
  if (inPort.type !== 'any' && sourceType !== null && sourceType !== inPort.type) {
    return deny('V8', `${sourceType} → ${inPort.type} type mismatch`);
  }
  if (target.kind === 'or') {
    const resolved = resolveOrOutType(tpl, portsFn, target.id);
    if (resolved !== null && sourceType !== null && sourceType !== resolved) {
      return deny('V12', `or inputs must match: ${resolved}`);
    }
  }
  return { ok: true };
}

const deny = (code, reason) => ({ ok: false, code, reason });

/** Structural edits — always a NEW template; the input is never mutated. */
export function removeNode(tpl, nodeId) {
  const t = normalizeTemplate(tpl);
  return { ...t, nodes: t.nodes.filter((n) => n.id !== nodeId),
    wires: t.wires.filter((w) => w.from.node !== nodeId && w.to.node !== nodeId) };
}

export function removeWire(tpl, wireId) {
  const t = normalizeTemplate(tpl);
  return { ...t, wires: t.wires.filter((w) => w.id !== wireId) };
}

export function nodeById(tpl, id) {
  return (Array.isArray(tpl?.nodes) ? tpl.nodes : []).find((n) => n?.id === id) || null;
}

export function wireById(tpl, id) {
  return (Array.isArray(tpl?.wires) ? tpl.wires : []).find((w) => w?.id === id) || null;
}
```
`Expected: PASS — 10 tests passing`
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — template model and drop legality`

---

### Task 5: `src/shared/graph/geometry.mjs` — the single source of every number

**Files:** create `src/shared/graph/geometry.mjs`, `test/graph-geometry.test.mjs`. Arithmetic lifted from the reference prototype's geometry block (zone model) and `old:ui/public/graph/graph-geometry.mjs` (hit tests, `fitBounds`); **edits**: (a) zones replace the hand-unrolled row arithmetic — a zone is emitted only when non-empty and a 9px separator sits only BETWEEN emitted zones, which is what makes a 0-input Task card degrade correctly; (b) `nodeSize(node, ports, {footerRows})` and `portAnchor(node, ports, portId, dir)` take the NODE (caption is a per-kind decision, not a caller flag); (c) `bezierPath(a, b, {mirror, loop})` gains `mirror` (the ghost cord dragged from an INPUT leaves leftward); (d) `GEOMETRY_CSS_VARS`/`injectGeometry`/`bezierPoint`/`bezierMid`/`graphBounds` are new; (e) NEVER borrow `old:thumbnail.mjs:38-39`'s private bezier constant — `bezierPath` is the only curve in the system.

**Frozen constants:** `NODE_W 220, HEAD_H 34, ROW_H 24, SEP_H 9, PAD_T 8.5, PAD_B 8, BORDER 1.5, DOT 10, FOOT_H 26, EXEC_ROW_H 22, SNAP 11, PORT_HIT_R 14, WIRE_HIT_TOL 6, ZOOM_MIN 0.4, ZOOM_MAX 1.6, ZOOM_K 0.002`, `ROW0 = BORDER + HEAD_H + PAD_T + ROW_H/2 = 56`.
**Closed forms (the tests pin them):** zones top→bottom `inputs → outputs → await (kind 'agent' only) → caption (task/end/or)`; `nodeSize = 2·BORDER + HEAD_H + PAD_T + rows·24 + seps·9 + PAD_B + footer`, `footer = rows ? FOOT_H + (rows−1)·EXEC_ROW_H : 0`; Agent(nIn,nOut) = `95.5 + 24·(nIn+nOut)`; Task/End = `110.5`; arity-2 OR = `167.5`; arity-2 AND = `134.5`. Anchors: input i `(x, y+56+24i)`; output j `(x+220, y+65+24·nIn+24j)`, and on a 0-input card `(x+220, y+56+24j)`; await `(x, y+74+24·(nIn+nOut))`. The executions footer is the bottom-most box, so anchors NEVER move when it expands.
**Bezier:** `dx = clamp(48, 160, 0.45·|b.x−a.x|)`; forward `M a C (a.x+dx, a.y) (b.x−dx, b.y) b`; mirrored `C (a.x−dx, a.y) (b.x+dx, b.y)`; loop drops both control points by `bow = 56 + 0.2·|a.y−b.y|`.

**Interfaces produced:** the constants above, `GEOMETRY_CSS_VARS`, `injectGeometry(el)`, `nodeSize(node, ports, {footerRows})`, `portAnchor(node, ports, portId, dir)`, `bezierPath(a, b, {mirror, loop})`, `bezierPoint(a, b, t, {mirror, loop})`, `bezierMid(a, b, {mirror, loop})`, `snap(v, grid?)`, `hitNode(node, size, pt)`, `hitPort(anchor, pt, r?)`, `hitWire(a, b, pt, {loop, mirror, tol, samples})`, `graphBounds(tpl, portsFn, {pad, footerRowsOf})`, `fitBounds(bounds, viewport, {zoomMin, zoomMax})`.

- [ ] Step 1: Write the failing test — `test/graph-geometry.test.mjs`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_W, ROW0, SNAP, ZOOM_MIN, ZOOM_MAX, ZOOM_K, GEOMETRY_CSS_VARS, injectGeometry,
  nodeSize, portAnchor, bezierPath, bezierPoint, bezierMid, snap,
  hitNode, hitPort, hitWire, graphBounds, fitBounds,
} from '../src/shared/graph/geometry.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

// The reference prototype's 3-card scene (the 2026-08-26 CDP measurement).
const REG = { planner: { key: 'planner',
  inputs: [{ id: 'task', type: 'md' }, { id: 'fix', type: 'md' }],
  outputs: [{ id: 'plan', type: 'md' }, { id: 'review', type: 'json', when: 'blocking' }] } };
const portsFn = portsFnFor(REG);
const N_TASK = { id: 'n_task', kind: 'task', x: 60, y: 143, config: {} };
const N_AGENT = { id: 'n_agent', kind: 'agent', key: 'planner', x: 400, y: 80, config: {} };
const N_END = { id: 'n_end', kind: 'end', x: 760, y: 143, config: {} };
const P = (n) => portsFn(n);

test('the constants are frozen at the spec values', () => {
  assert.equal(NODE_W, 220);
  assert.equal(ROW0, 56);
  assert.equal(SNAP, 11);
  assert.deepEqual([ZOOM_MIN, ZOOM_MAX, ZOOM_K], [0.4, 1.6, 0.002]);
});

test('nodeSize closed forms', () => {
  assert.deepEqual(nodeSize(N_AGENT, P(N_AGENT)), { w: 220, h: 191.5 });   // 95.5 + 24*4
  assert.equal(nodeSize(N_TASK, P(N_TASK)).h, 110.5);
  assert.equal(nodeSize(N_END, P(N_END)).h, 110.5);
  const or2 = { id: 'o', kind: 'or', x: 0, y: 0, config: { arity: 2 } };
  const and2 = { id: 'a', kind: 'and', x: 0, y: 0, config: { arity: 2 } };
  assert.equal(nodeSize(or2, P(or2)).h, 167.5);
  assert.equal(nodeSize(and2, P(and2)).h, 134.5);
  const agentPorts = (nIn, nOut) => ({
    inputs: [...Array.from({ length: nIn }, (_, i) => ({ id: `i${i}`, type: 'md' })),
      { id: 'await', type: 'any', synthetic: true }],
    outputs: Array.from({ length: nOut }, (_, i) => ({ id: `o${i}`, type: 'md' })) });
  const bare = { id: 'x', kind: 'agent', key: 'k', x: 0, y: 0, config: {} };
  for (const [nIn, nOut] of [[1, 1], [2, 2], [3, 2], [1, 3]]) {
    assert.equal(nodeSize(bare, agentPorts(nIn, nOut)).h, 95.5 + 24 * (nIn + nOut), `agent ${nIn}/${nOut}`);
  }
  // A zone is emitted only when NON-EMPTY, so a zero-input agent loses one
  // separator and falls BELOW the closed form (which assumes both zones exist).
  assert.equal(nodeSize(bare, agentPorts(0, 1)).h, 110.5);
});

test('the executions footer grows the card and never moves an anchor', () => {
  assert.equal(nodeSize(N_AGENT, P(N_AGENT), { footerRows: 1 }).h, 191.5 + 26);
  assert.equal(nodeSize(N_AGENT, P(N_AGENT), { footerRows: 3 }).h, 191.5 + 26 + 2 * 22);
  assert.deepEqual(portAnchor(N_AGENT, P(N_AGENT), 'plan', 'out'),
    portAnchor(N_AGENT, P(N_AGENT), 'plan', 'out'));
});

test('port anchors match the measured prototype', () => {
  assert.deepEqual(portAnchor(N_AGENT, P(N_AGENT), 'task', 'in'), { x: 400, y: 136 });
  assert.deepEqual(portAnchor(N_AGENT, P(N_AGENT), 'fix', 'in'), { x: 400, y: 160 });
  assert.deepEqual(portAnchor(N_AGENT, P(N_AGENT), 'plan', 'out'), { x: 620, y: 193 });
  assert.deepEqual(portAnchor(N_AGENT, P(N_AGENT), 'review', 'out'), { x: 620, y: 217 });
  assert.deepEqual(portAnchor(N_AGENT, P(N_AGENT), 'await', 'in'), { x: 400, y: 250 });
  assert.deepEqual(portAnchor(N_TASK, P(N_TASK), 'task', 'out'), { x: 280, y: 199 });
  assert.deepEqual(portAnchor(N_END, P(N_END), 'result', 'in'), { x: 760, y: 199 });
  assert.equal(portAnchor(N_AGENT, P(N_AGENT), 'ghost', 'in'), null);
});

test('bezierPath: forward, mirrored, loop', () => {
  assert.equal(bezierPath({ x: 280, y: 199 }, { x: 400, y: 136 }),
    'M 280 199 C 334 199, 346 136, 400 136');
  assert.equal(bezierPath({ x: 400, y: 160 }, { x: 280, y: 160 }, { mirror: true }),
    'M 400 160 C 346 160, 334 160, 280 160');
  assert.equal(bezierPath({ x: 0, y: 0 }, { x: 0, y: 0 }, { loop: true }), 'M 0 0 C 48 56, -48 56, 0 0');
  assert.equal(bezierPath({ x: 0, y: 0 }, { x: 1000, y: 0 }), 'M 0 0 C 160 0, 840 0, 1000 0', 'dx clamps at 160');
});

test('bezierPoint / bezierMid sample the SAME curve', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 200, y: 100 };
  assert.deepEqual(bezierPoint(a, b, 0), { x: 0, y: 0 });
  assert.deepEqual(bezierPoint(a, b, 1), { x: 200, y: 100 });
  const mid = bezierMid(a, b);
  assert.deepEqual(mid, bezierPoint(a, b, 0.5));
  assert.equal(mid.y, 50);
});

test('hit tests', () => {
  const size = nodeSize(N_AGENT, P(N_AGENT));
  assert.equal(hitNode(N_AGENT, size, { x: 410, y: 90 }), true);
  assert.equal(hitNode(N_AGENT, size, { x: 399, y: 90 }), false);
  assert.equal(hitNode(N_AGENT, size, { x: 410, y: 400 }), false);
  assert.equal(hitPort({ x: 400, y: 136 }, { x: 410, y: 141 }), true);
  assert.equal(hitPort({ x: 400, y: 136 }, { x: 420, y: 136 }), false);
  const a = { x: 0, y: 0 };
  const b = { x: 200, y: 0 };
  assert.equal(hitWire(a, b, { x: 100, y: 2 }), true);
  assert.equal(hitWire(a, b, { x: 100, y: 40 }), false);
  assert.equal(hitWire(a, b, { x: 100, y: 40 }, { loop: true }), true, 'the loop curve bows down to it');
});

test('snap rounds to the 11px half-grid', () => {
  assert.equal(snap(0), 0);
  assert.equal(snap(5), 0);
  assert.equal(snap(6), 11);
  assert.equal(snap(-6), -11);
  assert.equal(snap(100, 10), 100);
});

test('graphBounds + fitBounds reproduce the measured auto-fit', () => {
  const tpl = { version: 2, nodes: [N_TASK, N_AGENT, N_END], wires: [] };
  assert.deepEqual(graphBounds(tpl, portsFn), { x: 60, y: 80, w: 920, h: 191.5 });
  const padded = graphBounds(tpl, portsFn, { pad: 60 });
  assert.deepEqual(padded, { x: 0, y: 20, w: 1040, h: 311.5 });
  assert.deepEqual(fitBounds(padded, { width: 1280, height: 560 }), { z: 1, tx: 120, ty: 104.25 });
  assert.equal(fitBounds(padded, { width: 200, height: 100 }).z, ZOOM_MIN, 'fit clamps at the floor');
  assert.equal(fitBounds(padded, { width: 200, height: 100 }, { zoomMin: 0 }).z < 0.4, true);
  assert.deepEqual(graphBounds({ nodes: [] }, portsFn), null);
});

test('GEOMETRY_CSS_VARS covers every CSS-visible number and injectGeometry writes px', () => {
  assert.deepEqual(Object.keys(GEOMETRY_CSS_VARS).sort(), ['--gv-border', '--gv-dot', '--gv-exec-row-h',
    '--gv-foot-h', '--gv-head-h', '--gv-node-w', '--gv-pad-b', '--gv-pad-t', '--gv-row-h', '--gv-sep-h']);
  assert.equal(GEOMETRY_CSS_VARS['--gv-node-w'], '220px');
  assert.equal(GEOMETRY_CSS_VARS['--gv-pad-t'], '8.5px');
  const written = [];
  injectGeometry({ style: { setProperty: (k, v) => written.push([k, v]) } });
  assert.equal(written.length, 10);
  assert.deepEqual(written.find(([k]) => k === '--gv-row-h'), ['--gv-row-h', '24px']);
  injectGeometry(null);                                    // never throws on a missing host
});
```
`Expected: FAIL — Cannot find module '.../src/shared/graph/geometry.mjs'`

- [ ] Step 2: Implement — `src/shared/graph/geometry.mjs`
```js
// src/shared/graph/geometry.mjs
// THE geometry: card sizing, port anchors, one bezier and model-driven hit
// tests. Framework-free and DOM-free so the whole render path derives from the
// model's x/y — zero getBoundingClientRect on the pointer path, and every claim
// is unit-testable without jsdom. style.css consumes these numbers ONLY through
// the --gv-* custom properties injectGeometry writes, so the CSS box model can
// never drift from nodeSize.
export const NODE_W = 220;
export const HEAD_H = 34;
export const ROW_H = 24;
export const SEP_H = 9;
export const PAD_T = 8.5;
export const PAD_B = 8;
export const BORDER = 1.5;
export const DOT = 10;
export const FOOT_H = 26;
export const EXEC_ROW_H = 22;
export const SNAP = 11;
export const PORT_HIT_R = 14;
export const WIRE_HIT_TOL = 6;
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.6;
export const ZOOM_K = 0.002;
/** First row centre from the top of the card: 1.5 + 34 + 8.5 + 12. */
export const ROW0 = BORDER + HEAD_H + PAD_T + ROW_H / 2;

/** Every CSS-visible number, as the custom properties style.css reads. */
export const GEOMETRY_CSS_VARS = Object.freeze({
  '--gv-node-w': `${NODE_W}px`, '--gv-head-h': `${HEAD_H}px`, '--gv-row-h': `${ROW_H}px`,
  '--gv-sep-h': `${SEP_H}px`, '--gv-pad-t': `${PAD_T}px`, '--gv-pad-b': `${PAD_B}px`,
  '--gv-border': `${BORDER}px`, '--gv-dot': `${DOT}px`, '--gv-foot-h': `${FOOT_H}px`,
  '--gv-exec-row-h': `${EXEC_ROW_H}px`,
});

/** Write the variables onto a host element at mount. Guarded: jsdom hosts and a
 *  missing element are both fine (the caller is a renderer, not a validator). */
export function injectGeometry(el) {
  if (!el || !el.style || typeof el.style.setProperty !== 'function') return;
  for (const [name, value] of Object.entries(GEOMETRY_CSS_VARS)) el.style.setProperty(name, value);
}

const CAPTION_KINDS = new Set(['task', 'end', 'or']);
const metaInputs = (ports) => (Array.isArray(ports?.inputs) ? ports.inputs : []).filter((p) => !p?.synthetic);
const hasAwaitRow = (ports) => (Array.isArray(ports?.inputs) ? ports.inputs : []).some((p) => p?.synthetic);
const outs = (ports) => (Array.isArray(ports?.outputs) ? ports.outputs : []);

/** Zones top to bottom: inputs -> outputs -> await gate (agents) -> caption
 *  (task/end/or). A zone is emitted only when NON-EMPTY and a separator sits
 *  only BETWEEN emitted zones — that is what reproduces the closed forms and
 *  degrades sanely on a 0-input card. */
function zones(node, ports) {
  const z = [];
  const ins = metaInputs(ports).length;
  if (ins) z.push({ kind: 'in', n: ins });
  if (outs(ports).length) z.push({ kind: 'out', n: outs(ports).length });
  if (hasAwaitRow(ports)) z.push({ kind: 'await', n: 1 });
  if (CAPTION_KINDS.has(node?.kind)) z.push({ kind: 'cap', n: 1 });
  return z;
}

/** y offset of a zone's FIRST row centre, or null when the zone is not emitted. */
function zoneTop(node, ports, kind) {
  let y = ROW0;
  for (const z of zones(node, ports)) {
    if (z.kind === kind) return y;
    y += z.n * ROW_H + SEP_H;
  }
  return null;
}

/**
 * @param {{kind:string}} node
 * @param {{inputs:Array, outputs:Array}} ports  RESOLVED ports (await included for agents)
 * @param {{footerRows?:number}} [opts]  0 none · 1 collapsed executions strip · >1 strip + rows
 */
export function nodeSize(node, ports, { footerRows = 0 } = {}) {
  const zs = zones(node, ports);
  const rows = zs.reduce((s, z) => s + z.n, 0);
  const seps = Math.max(0, zs.length - 1);
  const footer = footerRows ? FOOT_H + (footerRows - 1) * EXEC_ROW_H : 0;
  return { w: NODE_W, h: 2 * BORDER + HEAD_H + PAD_T + rows * ROW_H + seps * SEP_H + PAD_B + footer };
}

/** Inputs and the await gate anchor on the LEFT edge, outputs on the RIGHT.
 *  The footer is the bottom-most box, so no anchor depends on it. */
export function portAnchor(node, ports, portId, dir) {
  if (dir === 'in' && portId === 'await' && hasAwaitRow(ports)) {
    return { x: node.x, y: node.y + zoneTop(node, ports, 'await') };
  }
  if (dir === 'in') {
    const i = metaInputs(ports).findIndex((p) => p?.id === portId);
    const top = zoneTop(node, ports, 'in');
    return i < 0 || top === null ? null : { x: node.x, y: node.y + top + ROW_H * i };
  }
  const j = outs(ports).findIndex((p) => p?.id === portId);
  const top = zoneTop(node, ports, 'out');
  return j < 0 || top === null ? null : { x: node.x + NODE_W, y: node.y + top + ROW_H * j };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** ONE cubic for the view, the ghost and the thumbnail.
 *  mirror = the drag STARTED on an input, so the cord leaves leftward.
 *  loop   = a committed loop wire, bowing underneath. */
export function bezierPath(a, b, opts = {}) {
  const [p0, p1, p2, p3] = bezierPoints(a, b, opts);
  return `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
}

function bezierPoints(a, b, { mirror = false, loop = false } = {}) {
  const dx = clamp(Math.abs(b.x - a.x) * 0.45, 48, 160);
  const s = mirror ? -1 : 1;
  const bow = loop ? 56 + Math.abs(a.y - b.y) * 0.2 : 0;
  return [a, { x: a.x + s * dx, y: a.y + bow }, { x: b.x - s * dx, y: b.y + bow }, b];
}

/** The point at parameter t on the SAME curve bezierPath draws. */
export function bezierPoint(a, b, t, opts = {}) {
  const [p0, p1, p2, p3] = bezierPoints(a, b, opts);
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** The cubic midpoint (p0 + 3p1 + 3p2 + p3)/8 — where a loop badge sits. */
export function bezierMid(a, b, opts = {}) {
  return bezierPoint(a, b, 0.5, opts);
}

/** Snap to the 11px half-grid (the 22px dot grid's half step). DRAG only —
 *  loaded templates render at their authored positions, unsnapped. */
export function snap(value, grid = SNAP) {
  return Math.round(value / grid) * grid;
}

export function hitNode(node, size, pt) {
  return pt.x >= node.x && pt.x <= node.x + size.w && pt.y >= node.y && pt.y <= node.y + size.h;
}

export function hitPort(anchor, pt, r = PORT_HIT_R) {
  return Math.hypot(pt.x - anchor.x, pt.y - anchor.y) <= r;
}

/** Within `tol` of the drawn curve. Sampled, not solved: the curves are short,
 *  the tolerance is 6px, and a closed-form cubic distance buys nothing. */
export function hitWire(a, b, pt, { loop = false, mirror = false, tol = WIRE_HIT_TOL, samples = 48 } = {}) {
  let prev = a;
  for (let i = 1; i <= samples; i += 1) {
    const next = bezierPoint(a, b, i / samples, { loop, mirror });
    if (distanceToSegment(pt, prev, next) <= tol) return true;
    prev = next;
  }
  return false;
}

function distanceToSegment(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** The union of the card boxes, optionally padded. `footerRowsOf(node)` lets the
 *  run monitor fit an expanded executions footer. null when there is nothing. */
export function graphBounds(tpl, portsFn, { pad = 0, footerRowsOf } = {}) {
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter(Boolean);
  if (!nodes.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const node of nodes) {
    const ports = (typeof portsFn === 'function' ? portsFn(node) : null) || { inputs: [], outputs: [] };
    const size = nodeSize(node, ports, { footerRows: footerRowsOf ? footerRowsOf(node) : 0 });
    const x = Number(node.x) || 0;
    const y = Number(node.y) || 0;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + size.w); maxY = Math.max(maxY, y + size.h);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

/** Fit `bounds` into a viewport: `screen = world·z + t`. zoomMax defaults to 1 —
 *  auto-fit NEVER magnifies past 1x (spec §7.6). */
export function fitBounds(bounds, viewport, { zoomMin = ZOOM_MIN, zoomMax = 1 } = {}) {
  const width = Number(viewport?.width) || 0;
  const height = Number(viewport?.height) || 0;
  if (!bounds || !(bounds.w > 0) || !(bounds.h > 0) || width <= 0 || height <= 0) return { z: 1, tx: 0, ty: 0 };
  const z = clamp(Math.min(width / bounds.w, height / bounds.h), zoomMin, zoomMax);
  return { z, tx: (width - bounds.w * z) / 2 - bounds.x * z, ty: (height - bounds.h * z) / 2 - bounds.y * z };
}
```
`Expected: PASS — 10 tests passing`
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — shared geometry`

---

### Task 6: `src/shared/graph/layout.mjs` + `thumbnail.mjs`

**Files:** create `src/shared/graph/layout.mjs`, `src/shared/graph/thumbnail.mjs`, `test/graph-layout.test.mjs`, `test/graph-thumbnail.test.mjs`. Borrowed from `old:ui/public/graph/graph-layout.mjs` and `old:ui/public/graph/thumbnail.mjs`; **edits**: (a) `rankNodes(tpl, loops)` takes the `classifyLoops` RESULT (the module table's signature) so a caller that already has it does not re-run Tarjan; (b) the thumbnail draws through `bezierPath` inside one `<g transform>` instead of `old:thumbnail.mjs:38-39`'s private bezier constant (NEVER borrow that); (c) sizes come from `nodeSize(node, ports)`.

**Interfaces produced:** `rankNodes(tpl, loops) → {[nodeId]: rank}`, `autoLayout(tpl, portsFn, opts?) → {[nodeId]: {x, y}}`; `thumbnailSvg(tpl, portsFn, {width, height, pad}) → string`.
**Layout rules:** longest-path ranks over the NON-loop wires (excluding loop wires is what keeps a feedback edge from dragging its target forward — the implementer must rank one past the refiner, not one past the reviewer); `x = 60 + rank·300`; barycenter ordering inside a column (2 sweeps, stable); `y` stacked from 60 with a 40px gap, each row snapped to 11px so the pass is idempotent.

- [ ] Step 1: Write the failing tests
`test/graph-layout.test.mjs`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankNodes, autoLayout } from '../src/shared/graph/layout.mjs';
import { classifyLoops } from '../src/shared/graph/loops.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

const REG = {
  planner: { key: 'planner', inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  impl: { key: 'impl', inputs: [{ id: 'plan', type: 'md', required: true },
      { id: 'fix', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'done', type: 'void', when: 'always' }] },
  reviewer: { key: 'reviewer', verdict: { filename: 'r.json' },
    inputs: [{ id: 'done', type: 'void', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
};
const portsFn = portsFnFor(REG);
const TPL = { version: 2,
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 0, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'impl', x: 0, y: 0, config: {} },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 0, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 0, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_rev', port: 'done' } },
    { id: 'w4', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w5', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] };

test('rankNodes: longest path with loop wires excluded', () => {
  assert.deepEqual(rankNodes(TPL, classifyLoops(TPL, portsFn)),
    { n_task: 0, n_plan: 1, n_impl: 2, n_rev: 3, n_end: 4 });
});

test('rankNodes without loop exclusion would NOT rank the implementer past the reviewer', () => {
  const noLoops = { loopWireIds: new Set(), loopInputs: new Set(), sccOf: new Map(), launchOrder: [] };
  const r = rankNodes(TPL, noLoops);
  assert.equal(r.n_impl <= r.n_rev, true, 'a residual cycle still terminates and ranks bounded');
});

test('autoLayout: x = 60 + rank*300, y snapped to 11, deterministic and idempotent', () => {
  const a = autoLayout(TPL, portsFn);
  assert.deepEqual(Object.keys(a).sort(), ['n_end', 'n_impl', 'n_plan', 'n_rev', 'n_task']);
  assert.equal(a.n_task.x, 60);
  assert.equal(a.n_plan.x, 360);
  assert.equal(a.n_end.x, 1260);
  for (const p of Object.values(a)) assert.equal(p.y % 11, 0, 'every row snaps to the 11px grid');
  const applied = { ...TPL, nodes: TPL.nodes.map((n) => ({ ...n, ...a[n.id] })) };
  assert.deepEqual(autoLayout(applied, portsFn), a, 'idempotent');
  assert.deepEqual(autoLayout(TPL, portsFn), a, 'deterministic');
});

test('autoLayout stacks a column with a 40px gap below the previous card', () => {
  const tpl = { version: 2,
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'a', kind: 'agent', key: 'planner', x: 0, y: 0, config: {} },
      { id: 'b', kind: 'agent', key: 'planner', x: 0, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'a', port: 'task' } },
      { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'b', port: 'task' } }] };
  const p = autoLayout(tpl, portsFn);
  assert.equal(p.a.x, p.b.x);
  // y0 60 snaps to 55; planner card = 95.5 + 24*2 = 143.5, so 55 + 143.5 + 40 = 238.5 -> 242
  assert.equal(p.a.y, 55);
  assert.equal(p.b.y, 242);
});

test('autoLayout on an empty or wireless template never throws', () => {
  assert.deepEqual(autoLayout({ version: 2, nodes: [], wires: [] }, portsFn), {});
  const solo = autoLayout({ version: 2, nodes: [{ id: 'x', kind: 'task', x: 5, y: 5, config: {} }], wires: [] }, portsFn);
  assert.deepEqual(solo, { x: { x: 60, y: 55 } });
});
```
`test/graph-thumbnail.test.mjs`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumbnailSvg } from '../src/shared/graph/thumbnail.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

const portsFn = portsFnFor({ planner: { key: 'planner',
  inputs: [{ id: 'task', type: 'md', required: true }], outputs: [{ id: 'plan', type: 'md', when: 'always' }] } });
const TPL = { version: 2,
  nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 143, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 400, y: 80, config: {} },
    { id: 'n_end', kind: 'end', x: 760, y: 143, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }] };

test('thumbnailSvg: numbers only, wires under cards, deterministic', () => {
  const svg = thumbnailSvg(TPL, portsFn, { width: 120, height: 64 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="120" height="64"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.equal((svg.match(/<rect /g) || []).length, 3);
  assert.equal((svg.match(/<path /g) || []).length, 2);
  assert.ok(svg.indexOf('<path') < svg.indexOf('<rect'), 'wires paint under the cards');
  for (const secret of ['n_task', 'n_plan', 'planner', 'w1']) {
    assert.equal(svg.includes(secret), false, `"${secret}" must never reach the markup`);
  }
  assert.equal(thumbnailSvg(TPL, portsFn, { width: 120, height: 64 }), svg, 'deterministic');
  assert.equal(svg.includes('fill="none"'), true, 'wire paths never fill');
});

test('thumbnailSvg degrades on empty / dangling input', () => {
  assert.equal(thumbnailSvg({ nodes: [], wires: [] }, portsFn, { width: 40, height: 20 }),
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20" role="img" aria-hidden="true"></svg>');
  const dangling = { version: 2, nodes: TPL.nodes,
    wires: [{ id: 'w9', from: { node: 'ghost', port: 'x' }, to: { node: 'n_end', port: 'result' } }] };
  const svg = thumbnailSvg(dangling, portsFn, {});
  assert.equal((svg.match(/<path /g) || []).length, 0);
  assert.equal(svg.includes('NaN'), false);
});
```
`Expected: FAIL — Cannot find module '.../src/shared/graph/layout.mjs'` (and `.../thumbnail.mjs`)

- [ ] Step 2: Implement — `src/shared/graph/layout.mjs`
```js
// src/shared/graph/layout.mjs
// Auto-layout for the composer's header button: longest-path ranks with LOOP
// WIRES EXCLUDED, columns at x = 60 + rank*300, barycenter ordering inside each
// column, y stacked so no two cards touch and snapped to the 11px grid.
// Deterministic by construction — same template in, same positions out, and
// re-running over an already laid-out template reproduces it exactly.
import { classifyLoops } from './loops.mjs';
import { nodeSize, snap } from './geometry.mjs';

export const RANK_X0 = 60;
export const RANK_DX = 300;
export const RANK_Y0 = 60;
export const ROW_GAP = 40;
const SWEEPS = 2;

/** @param {object} tpl @param {{loopWireIds:Set<string>}} loops classifyLoops() output */
export function rankNodes(tpl, loops) {
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter(Boolean);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = nonLoopEdges(tpl, loops, ids);

  const rank = {};
  const indegree = {};
  for (const id of ids) { rank[id] = 0; indegree[id] = 0; }
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
    indegree[e.to] += 1;
  }
  // Kahn with a SORTED frontier: ties break by node id, so the walk order — and
  // therefore the result — never depends on declaration order.
  const ready = [...ids].filter((id) => indegree[id] === 0).sort();
  const settled = new Set();
  while (ready.length) {
    const id = ready.shift();
    settled.add(id);
    for (const next of out.get(id) || []) {
      rank[next] = Math.max(rank[next], rank[id] + 1);
      indegree[next] -= 1;
      if (indegree[next] === 0) insertSorted(ready, next);
    }
  }
  // A residual cycle survives only when no loop wire cuts it (V10 blocks SAVING
  // such a graph, but the editor still has to draw it). Rank the leftovers from
  // whatever settled feeds them, in id order — bounded, never a hang.
  for (const id of [...ids].filter((n) => !settled.has(n)).sort()) {
    rank[id] = edges.filter((e) => e.to === id && settled.has(e.from))
      .reduce((best, e) => Math.max(best, rank[e.from] + 1), 0);
    settled.add(id);
  }
  return rank;
}

/** @returns {{[nodeId:string]: {x:number, y:number}}} — the caller applies them. */
export function autoLayout(tpl, portsFn, { x0 = RANK_X0, dx = RANK_DX, y0 = RANK_Y0, gap = ROW_GAP } = {}) {
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter(Boolean);
  const loops = classifyLoops(tpl, portsFn);
  const rank = rankNodes(tpl, loops);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = nonLoopEdges(tpl, loops, ids);

  const columns = new Map();
  for (const n of nodes) {
    if (!columns.has(rank[n.id])) columns.set(rank[n.id], []);
    columns.get(rank[n.id]).push(n.id);
  }
  const ranksAscending = [...columns.keys()].sort((a, b) => a - b);

  // Barycenter: sweep left to right, ordering each column by the mean row index
  // of its predecessors. A node with no ranked predecessor keeps its index, so
  // the pass is stable.
  const preds = new Map();
  for (const e of edges) {
    if (!preds.has(e.to)) preds.set(e.to, []);
    preds.get(e.to).push(e.from);
  }
  for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
    for (const r of ranksAscending) {
      const rowOf = new Map();
      for (const prevRank of ranksAscending) {
        if (prevRank >= r) break;
        columns.get(prevRank).forEach((id, i) => rowOf.set(id, i));
      }
      const keyed = columns.get(r).map((id, i) => ({ id, i, bary: barycenter(preds.get(id), rowOf, i) }));
      keyed.sort((a, b) => a.bary - b.bary || a.i - b.i);
      columns.set(r, keyed.map((k) => k.id));
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const positions = {};
  for (const r of ranksAscending) {
    let cursor = y0;
    for (const id of columns.get(r)) {
      const node = byId.get(id);
      const ports = (typeof portsFn === 'function' ? portsFn(node) : null) || { inputs: [], outputs: [] };
      const { h } = nodeSize(node, ports);
      const y = snap(cursor);
      positions[id] = { x: x0 + r * dx, y };
      cursor = y + h + gap;                 // stack from the SNAPPED row: idempotent
    }
  }
  return positions;
}

function nonLoopEdges(tpl, loops, ids) {
  const loopWireIds = loops?.loopWireIds instanceof Set ? loops.loopWireIds : new Set();
  return (Array.isArray(tpl?.wires) ? tpl.wires : [])
    .filter((w) => ids.has(w?.from?.node) && ids.has(w?.to?.node)
      && w.from.node !== w.to.node && !loopWireIds.has(w.id))
    .map((w) => ({ from: w.from.node, to: w.to.node }));
}

function barycenter(predecessors, rowOf, fallback) {
  const rows = (predecessors || []).map((id) => rowOf.get(id)).filter((row) => row !== undefined);
  if (!rows.length) return fallback;
  return rows.reduce((sum, row) => sum + row, 0) / rows.length;
}

function insertSorted(list, id) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < id) lo = mid + 1; else hi = mid;
  }
  list.splice(lo, 0, id);
}
```

- [ ] Step 3: Implement — `src/shared/graph/thumbnail.mjs`
```js
// src/shared/graph/thumbnail.mjs
// A v2 template -> a mini-SVG string for the saved-pipeline rows. Pure and
// deterministic, and the markup carries NUMBERS ONLY (no ids, no names, no
// author text), so the result is safe to hand to innerHTML without escaping.
// The whole scene is drawn in WORLD space inside one <g transform>, which is
// what lets it reuse the real bezierPath instead of a second curve constant.
import { bezierPath, graphBounds, fitBounds, nodeSize, portAnchor } from './geometry.mjs';
import { portsOf, findPort } from './ports.mjs';

const DEFAULTS = { width: 120, height: 64, pad: 8, radius: 3 };
const round = (v) => Math.round(v * 100) / 100;

export function thumbnailSvg(tpl, portsFn, opts = {}) {
  const { width, height, pad, radius } = { ...DEFAULTS, ...opts };
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter(Boolean);
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `
    + `viewBox="0 0 ${width} ${height}" role="img" aria-hidden="true">`;
  if (!nodes.length) return `${open}</svg>`;

  const bounds = graphBounds(tpl, portsFn, { pad });
  const { z, tx, ty } = fitBounds(bounds, { width, height }, { zoomMin: 0, zoomMax: 1 });
  const stroke = round(1 / (z || 1));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Wires first so the cards sit on top, exactly like the live canvas.
  const paths = (Array.isArray(tpl?.wires) ? tpl.wires : []).map((w) => {
    const from = byId.get(w?.from?.node);
    const to = byId.get(w?.to?.node);
    if (!from || !to) return '';                                   // dangling (V5) — never draw NaN
    const fromPorts = portsOf(portsFn, from);
    const toPorts = portsOf(portsFn, to);
    if (!findPort(fromPorts, w.from.port, 'out') || !findPort(toPorts, w.to.port, 'in')) return '';
    const a = portAnchor(from, fromPorts, w.from.port, 'out');
    const b = portAnchor(to, toPorts, w.to.port, 'in');
    if (!a || !b) return '';
    return `<path d="${bezierPath(a, b)}" fill="none" stroke="#B7B7BC" stroke-width="${stroke}"/>`;
  }).filter(Boolean).join('');

  const rects = nodes.map((node) => {
    const size = nodeSize(node, portsOf(portsFn, node));
    return `<rect x="${round(Number(node.x) || 0)}" y="${round(Number(node.y) || 0)}" `
      + `width="${round(size.w)}" height="${round(size.h)}" rx="${radius}" `
      + `fill="#FFFFFF" stroke="#C9C9CE" stroke-width="${stroke}"/>`;
  }).join('');

  return `${open}<g transform="translate(${round(tx)} ${round(ty)}) scale(${round(z)})">${paths}${rects}</g></svg>`;
}
```
`Expected: PASS — 7 tests passing` (5 layout + 2 thumbnail)
- [ ] Step 4: Commit — `worca: Node-graph v2 P2 — auto-layout and thumbnails`

---

### Task 7: `src/shared/graph/agent-meta.mjs` — meta v2 normalize + validate

**Files:** create `src/shared/graph/agent-meta.mjs`, `test/graph-agent-meta.test.mjs`. Rule-for-rule port of `old:src/core/agent-registry.mjs:63-330` (`readMetaV2` and its helpers ONLY — never borrow `old:agent-registry.mjs:21`'s `new URL().pathname`, which reintroduces the Windows bug dev fixed at `agent-registry.mjs:29`); **edits**: (a) shared code cannot import `claude-runner.mjs`, so the mock-role vocabulary is PASSED IN as `opts.mockWriterRoles` (a Set); an unknown role is a WARNING and the field is dropped, never a 400; (b) `derivePortSummary(meta)` takes the meta object; (c) `indexByKey(list)` is new; (d) the rule texts below are the STORE's 400 messages verbatim — the Agents view renders them unchanged, so they are a contract.

**Interfaces produced:** `normalizeAgentMeta(raw, {mockWriterRoles, warn} = {}) → {meta, errors}` (`meta` is meaningful only when `errors` is empty), `validateMetaV2(raw, {mockWriterRoles} = {}) → {errors}` (silent — the load path warns), `indexByKey(list) → {[key]: meta}`, `derivePortSummary(meta) → string`.

**Rule texts (verbatim; `<side>` is `inputs`/`outputs`):** `meta must be an object` · `key is required` · `key "<k>" is not a valid agent key` · `sidecar requires metaVersion 2` · `runnerType must be one of producer, verifier, clarifier` · `order must be a number` · `verdict must be an object with a filename` · `verdict filename "<f>" must be a plain basename` · `runnerType "verifier" requires verdict: { filename }` · `<side> must be an array` · `<side>: at most 8 ports per side (got N)` · `<side>: each port must be an object` · `<side>: port id "await" is reserved — the engine synthesizes the await gate port on every agent node` · `<side>: bad port id "<id>"` · `<side>: duplicate port id "<id>"` · `<side>.<id>: type must be one of md, json, void` · `<side>.<id>: void ports carry no filename or store` · `inputs.<id>: expands is only legal on json inputs` · `inputs.<id>: as must be one of file, answers, fix-review, worktree` · `inputs.<id>: as "<as>" requires a <type> port (got <t>)` · `at least one output port is required` · `outputs.<id>: when must be one of always, blocking, clean` · `outputs.<id>: when "<when>" requires the agent to declare verdict: { filename }` · `outputs.<id>: <type> outputs require a filename template` · `outputs.<id>: filename "<f>" must be a plain basename` · `outputs.<id>: filename "<f>" uses unknown token(s) {x}` · `outputs.<id>: store must be one of run, project` · `outputs: filename template "<f>" is shared by ports of different types` · `runnerType "clarifier" requires at least one json output port` · `sideEffect must be "code" when present` · `workspaceStrategy must be one of explore, task, review` · `workspaceVariantOf must be an agent key` · `workspaceVariantOf must not reference the agent itself` · `workspaceVariantOf requires scope "workspace-only"`. Non-fatal WARNINGS (`opts.warn`, never errors): `[agent-registry] inputs.<id>: loop:true forces required:false (a loop receiver is never a barrier)` · `[agent-registry] <key>.mockRole: unknown mock role "<role>"; ignored (the generic mock chain applies)`.

- [ ] Step 1: Write the failing test — `test/graph-agent-meta.test.mjs`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentMeta, validateMetaV2, indexByKey, derivePortSummary } from '../src/shared/graph/agent-meta.mjs';

const ROLES = new Set(['reviewer', 'generic-producer']);
const base = (over = {}) => ({ metaVersion: 2, key: 'docs', displayName: 'Docs', runnerType: 'producer',
  inputs: [{ id: 'plan', type: 'md' }], outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }], order: 8, ...over });
const errs = (raw, opts) => validateMetaV2(raw, opts).errors;

test('a valid v2 sidecar normalizes with materialized defaults', () => {
  const { meta, errors } = normalizeAgentMeta(base(), { mockWriterRoles: ROLES });
  assert.deepEqual(errors, []);
  assert.equal(meta.metaVersion, 2);
  assert.equal(meta.color, 'amber', 'an unknown/absent color fails safe');
  assert.equal(meta.domain, 'general');
  assert.equal(meta.scope, 'project');
  assert.deepEqual(meta.inputs, [{ id: 'plan', type: 'md', required: true, as: 'file' }]);
  assert.deepEqual(meta.outputs, [{ id: 'notes', type: 'md', when: 'always', filename: 'notes.md',
    store: 'run', artifactKind: 'notes' }]);
  assert.equal(meta.portSummary, 'Reads plan; produces notes.');
  assert.equal('verdict' in meta, false, 'absent capabilities stay ABSENT (a v2 entry diffs against its sidecar)');
  assert.equal('sideEffect' in meta, false);
  assert.equal('placeable' in meta, false);
});

test('metaVersion, key, runnerType and order', () => {
  assert.deepEqual(errs(null), ['meta must be an object']);
  assert.ok(errs(base({ key: '' })).includes('key is required'));
  assert.ok(errs(base({ key: '9bad' })).includes('key "9bad" is not a valid agent key'));
  assert.ok(errs(base({ metaVersion: 1 })).includes('sidecar requires metaVersion 2'));
  assert.ok(errs(base({ metaVersion: undefined })).includes('sidecar requires metaVersion 2'));
  assert.ok(errs(base({ runnerType: 'wizard' })).includes('runnerType must be one of producer, verifier, clarifier'));
  assert.ok(errs(base({ order: 'x' })).includes('order must be a number'));
  assert.deepEqual(errs(base({ order: undefined })), [], 'order is optional (agents land last)');
});

test('port ids: reserved await, shape, regex, duplicates, ≤ 8 per side', () => {
  assert.ok(errs(base({ inputs: [{ id: 'await', type: 'md' }] })).includes(
    'inputs: port id "await" is reserved — the engine synthesizes the await gate port on every agent node'));
  assert.ok(errs(base({ outputs: [{ id: 'await', type: 'md', filename: 'a.md' }] })).includes(
    'outputs: port id "await" is reserved — the engine synthesizes the await gate port on every agent node'));
  assert.ok(errs(base({ inputs: [{ id: 'Bad', type: 'md' }] })).includes('inputs: bad port id "Bad"'));
  assert.ok(errs(base({ inputs: [{ id: 'a', type: 'md' }, { id: 'a', type: 'md' }] }))
    .includes('inputs: duplicate port id "a"'));
  assert.ok(errs(base({ inputs: ['nope'] })).includes('inputs: each port must be an object'));
  assert.ok(errs(base({ inputs: 'nope' })).includes('inputs must be an array'));
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, type: 'md' }));
  assert.ok(errs(base({ inputs: nine })).includes('inputs: at most 8 ports per side (got 9)'));
});

test('types, void ports, expands and the `as` renderers', () => {
  assert.ok(errs(base({ inputs: [{ id: 'p', type: 'code' }] })).includes('inputs.p: type must be one of md, json, void'));
  assert.ok(errs(base({ inputs: [{ id: 'p', type: 'void', filename: 'x.md' }] }))
    .includes('inputs.p: void ports carry no filename or store'));
  assert.ok(errs(base({ inputs: [{ id: 'p', type: 'md', expands: true }] }))
    .includes('inputs.p: expands is only legal on json inputs'));
  assert.deepEqual(errs(base({ inputs: [{ id: 'p', type: 'json', expands: true }] })), []);
  assert.ok(errs(base({ inputs: [{ id: 'p', type: 'md', as: 'nope' }] }))
    .includes('inputs.p: as must be one of file, answers, fix-review, worktree'));
  assert.ok(errs(base({ inputs: [{ id: 'p', type: 'md', as: 'answers' }] }))
    .includes('inputs.p: as "answers" requires a json port (got md)'));
  assert.ok(errs(base({ inputs: [{ id: 'p', type: 'md', as: 'worktree' }] }))
    .includes('inputs.p: as "worktree" requires a void port (got md)'));
  const { meta } = normalizeAgentMeta(base({ inputs: [{ id: 'p', type: 'void' }] }));
  assert.equal('as' in meta.inputs[0], false, 'a void input gets no default renderer');
});

test('loop inputs are coerced optional, with a warning', () => {
  const warnings = [];
  const { meta, errors } = normalizeAgentMeta(base({ inputs: [{ id: 'fix', type: 'md', loop: true, required: true }] }),
    { warn: (m) => warnings.push(m) });
  assert.deepEqual(errors, []);
  assert.deepEqual(meta.inputs[0], { id: 'fix', type: 'md', required: false, loop: true, as: 'file' });
  assert.deepEqual(warnings, ['[agent-registry] inputs.fix: loop:true forces required:false (a loop receiver is never a barrier)']);
});

test('outputs: filenames, tokens, stores, when + verdict, shared templates', () => {
  assert.ok(errs(base({ outputs: [] })).includes('at least one output port is required'));
  assert.ok(errs(base({ outputs: [{ id: 'o', type: 'md' }] })).includes('outputs.o: md outputs require a filename template'));
  assert.ok(errs(base({ outputs: [{ id: 'o', type: 'md', filename: '../x.md' }] }))
    .includes('outputs.o: filename "../x.md" must be a plain basename'));
  assert.ok(errs(base({ outputs: [{ id: 'o', type: 'md', filename: '{nope}.md' }] }))
    .includes('outputs.o: filename "{nope}.md" uses unknown token(s) {nope}'));
  assert.deepEqual(errs(base({ outputs: [{ id: 'o', type: 'md', filename: '{base}{vsuffix}-c{cycle}.md' }] })), []);
  assert.ok(errs(base({ outputs: [{ id: 'o', type: 'md', filename: 'o.md', store: 'nowhere' }] }))
    .includes('outputs.o: store must be one of run, project'));
  assert.ok(errs(base({ outputs: [{ id: 'o', type: 'md', filename: 'o.md', when: 'nope' }] }))
    .includes('outputs.o: when must be one of always, blocking, clean'));
  assert.ok(errs(base({ outputs: [{ id: 'o', type: 'md', filename: 'o.md', when: 'blocking' }] }))
    .includes('outputs.o: when "blocking" requires the agent to declare verdict: { filename }'));
  assert.ok(errs(base({ outputs: [{ id: 'a', type: 'md', filename: 'p.md' }, { id: 'b', type: 'json', filename: 'p.md' }] }))
    .includes('outputs: filename template "p.md" is shared by ports of different types'));
  // the refiner's two arms legitimately share ONE template (same type => one path)
  assert.deepEqual(errs(base({ verdict: { filename: 'r.json' },
    outputs: [{ id: 'plan', type: 'md', when: 'clean', filename: '{base}{vsuffix}.md' },
      { id: 'revise', type: 'md', when: 'blocking', filename: '{base}{vsuffix}.md', artifactKind: 'plan' }] })), []);
});

test('runner obligations and verdict shape', () => {
  assert.ok(errs(base({ runnerType: 'verifier' })).includes('runnerType "verifier" requires verdict: { filename }'));
  assert.ok(errs(base({ verdict: {} })).includes('verdict must be an object with a filename'));
  assert.ok(errs(base({ verdict: { filename: 'sub/r.json' } }))
    .includes('verdict filename "sub/r.json" must be a plain basename'));
  assert.ok(errs(base({ runnerType: 'clarifier' })).includes('runnerType "clarifier" requires at least one json output port'));
  assert.deepEqual(errs(base({ runnerType: 'clarifier',
    outputs: [{ id: 'answers', type: 'json', filename: 'clarify.json' }] })), []);
});

test('capability fields', () => {
  assert.ok(errs(base({ sideEffect: 'files' })).includes('sideEffect must be "code" when present'));
  assert.ok(errs(base({ workspaceStrategy: 'ponder' }))
    .includes('workspaceStrategy must be one of explore, task, review'));
  assert.ok(errs(base({ workspaceVariantOf: '9x' })).includes('workspaceVariantOf must be an agent key'));
  assert.ok(errs(base({ workspaceVariantOf: 'docs', scope: 'workspace-only' }))
    .includes('workspaceVariantOf must not reference the agent itself'));
  assert.ok(errs(base({ workspaceVariantOf: 'reviewer' }))
    .includes('workspaceVariantOf requires scope "workspace-only"'));
  const { meta } = normalizeAgentMeta(base({ scope: 'workspace-only', workspaceVariantOf: 'reviewer',
    sideEffect: 'code', wantsRequest: true, workspaceFanOut: true, workspaceStrategy: 'review', placeable: false }));
  assert.equal(meta.workspaceVariantOf, 'reviewer');
  assert.equal(meta.sideEffect, 'code');
  assert.equal(meta.wantsRequest, true);
  assert.equal(meta.workspaceFanOut, true);
  assert.equal(meta.workspaceStrategy, 'review');
  assert.equal(meta.placeable, false);
});

test('mockRole is validated against the injected vocabulary — unknown warns and drops', () => {
  const warnings = [];
  const okMeta = normalizeAgentMeta(base({ mockRole: 'reviewer' }), { mockWriterRoles: ROLES, warn: (m) => warnings.push(m) });
  assert.equal(okMeta.meta.mockRole, 'reviewer');
  const bad = normalizeAgentMeta(base({ mockRole: 'nope' }), { mockWriterRoles: ROLES, warn: (m) => warnings.push(m) });
  assert.deepEqual(bad.errors, [], 'an unknown mock role is NEVER a 400');
  assert.equal('mockRole' in bad.meta, false);
  assert.deepEqual(warnings, ['[agent-registry] docs.mockRole: unknown mock role "nope"; ignored (the generic mock chain applies)']);
  const noVocab = normalizeAgentMeta(base({ mockRole: 'anything' }));
  assert.equal(noVocab.meta.mockRole, 'anything', 'with no vocabulary injected the role rides through');
});

test('questions coherence: an agent that cannot ask is neither locked nor default-on', () => {
  const { meta } = normalizeAgentMeta(base({ asksQuestions: false, questionsLocked: true, questionsDefault: true }));
  assert.deepEqual([meta.asksQuestions, meta.questionsLocked, meta.questionsDefault], [false, false, false]);
});

test('derivePortSummary and indexByKey', () => {
  assert.equal(derivePortSummary({ inputs: [{ id: 'plan', type: 'md' }],
    outputs: [{ id: 'review', type: 'md' }, { id: 'pass', type: 'void' }] }), 'Reads plan; produces review.');
  assert.equal(derivePortSummary({ inputs: [{ id: 'plan', type: 'md' }, { id: 'done', type: 'void' }],
    outputs: [{ id: 'done', type: 'void' }] }), 'Reads plan; produces done.', 'an all-void side falls back to its ids');
  assert.equal(derivePortSummary({ inputs: [], outputs: [{ id: 'plan', type: 'md' }] }), 'Produces plan.');
  assert.equal(derivePortSummary({ inputs: [{ id: 'x', type: 'md' }], outputs: [] }), 'Reads x.');
  assert.equal(derivePortSummary(null), '');
  assert.deepEqual(indexByKey([{ key: 'a' }, { key: 'b' }, null, { key: '' }]), { a: { key: 'a' }, b: { key: 'b' } });
  assert.deepEqual(indexByKey(null), {});
});
```
`Expected: FAIL — Cannot find module '.../src/shared/graph/agent-meta.mjs'`

- [ ] Step 2: Implement — `src/shared/graph/agent-meta.mjs`
```js
// src/shared/graph/agent-meta.mjs
// Agent metadata v2: ONE normalizer + validator for the registry loader (skip +
// warn), the agent store (hard 400), the Agents-view port editor (live hints)
// and agent-gen's read-back check. Pure — shared code cannot import
// claude-runner.mjs, so the mock-role vocabulary is INJECTED.
import { PORT_TYPES, MAX_PORTS_PER_SIDE } from './constants.mjs';

const AGENT_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PORT_ID_RE = /^[a-z][A-Za-z0-9_-]{0,31}$/;
/** The engine synthesizes a type-agnostic `await` gate on every agent node, so
 *  the id is RESERVED on BOTH sides and no sidecar may declare it. */
const RESERVED_PORT_ID = 'await';
const DOMAIN_RE = /^[a-z][a-z0-9-]{0,31}$/;
const COLORS = new Set(['green', 'peach', 'red', 'blue', 'violet', 'amber']);
const RUNNER_TYPES = new Set(['producer', 'verifier', 'clarifier']);
const INPUT_AS = new Set(['file', 'answers', 'fix-review', 'worktree']);
/** The port type each non-default `as` renderer requires. `file` is the default
 *  and is materialized on NON-VOID inputs only, which makes `worktree` the only
 *  `as` a void input takes. */
const AS_REQUIRES_TYPE = { answers: 'json', 'fix-review': 'md', worktree: 'void' };
const OUTPUT_WHEN = new Set(['always', 'blocking', 'clean']);
const OUTPUT_STORES = new Set(['run', 'project']);
const WORKSPACE_STRATEGIES = new Set(['explore', 'task', 'review']);
const FILENAME_TOKENS = new Set(['cycle', 'vsuffix', 'base']);
const DEFAULT_ORDER = 999;
const TYPES = [...PORT_TYPES].filter((t) => t !== 'any');   // `any` is engine-only, never declarable

/** `{key: meta}` from a registry LIST (the /api/agents payload shape). */
export function indexByKey(list) {
  const out = {};
  for (const m of Array.isArray(list) ? list : []) {
    if (m && typeof m === 'object' && typeof m.key === 'string' && m.key) out[m.key] = m;
  }
  return out;
}

/** The palette one-liner and the generic system-prompt fallback: the NON-VOID
 *  ids per side; an all-void side falls back to its declared ids so the sentence
 *  never degenerates to "produces .". */
export function derivePortSummary(meta) {
  const ids = (ports) => {
    const list = Array.isArray(ports) ? ports.filter(Boolean) : [];
    const nonVoid = list.filter((p) => p.type !== 'void');
    return (nonVoid.length ? nonVoid : list).map((p) => p.id);
  };
  const reads = ids(meta?.inputs);
  const writes = ids(meta?.outputs);
  if (!writes.length) return reads.length ? `Reads ${reads.join(', ')}.` : '';
  if (!reads.length) return `Produces ${writes.join(', ')}.`;
  return `Reads ${reads.join(', ')}; produces ${writes.join(', ')}.`;
}

/** Pure validation for the store's 400 path. Silent by design — the load path warns. */
export function validateMetaV2(raw, opts = {}) {
  return { errors: normalizeAgentMeta(raw, { ...opts, warn: () => {} }).errors };
}

/**
 * @param {object} raw parsed sidecar
 * @param {{mockWriterRoles?:Set<string>, warn?:(msg:string)=>void}} [opts]
 * @returns {{meta:object|null, errors:string[]}} meta is meaningful only when errors is empty
 */
export function normalizeAgentMeta(raw, opts = {}) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  const warn = typeof opts.warn === 'function' ? opts.warn : () => {};
  if (!raw || typeof raw !== 'object') return { errors: ['meta must be an object'], meta: null };

  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) err('key is required');
  else if (!AGENT_KEY_RE.test(key)) err(`key "${key}" is not a valid agent key`);
  if (raw.metaVersion !== 2) err('sidecar requires metaVersion 2');
  if (!RUNNER_TYPES.has(raw.runnerType)) err(`runnerType must be one of ${[...RUNNER_TYPES].join(', ')}`);
  const runnerType = RUNNER_TYPES.has(raw.runnerType) ? raw.runnerType : 'producer';

  const order = raw.order === undefined ? DEFAULT_ORDER : Number(raw.order);
  if (!Number.isFinite(order)) err('order must be a number');

  const verdict = readVerdict(raw.verdict, err);
  if (runnerType === 'verifier' && !verdict) err('runnerType "verifier" requires verdict: { filename }');

  const inputs = readInputs(raw.inputs, err, warn);
  const outputs = readOutputs(raw.outputs, !!verdict, err);
  if (runnerType === 'clarifier' && !outputs.some((p) => p.type === 'json')) {
    err('runnerType "clarifier" requires at least one json output port');
  }
  // Two outputs may share one filename template only with an identical type (the
  // refiner's clean/blocking plan arms); allocation then yields ONE path.
  const typeByTemplate = new Map();
  for (const p of outputs) {
    if (!p.filename) continue;
    const prev = typeByTemplate.get(p.filename);
    if (prev === undefined) typeByTemplate.set(p.filename, p.type);
    else if (prev !== p.type) err(`outputs: filename template "${p.filename}" is shared by ports of different types`);
  }

  // Scope coercion mirrors color: anything but the explicit 'workspace-only'
  // marker is a normal project agent, so a typo fails safe to a VISIBLE agent.
  const scope = raw.scope === 'workspace-only' ? 'workspace-only' : 'project';
  if (raw.sideEffect !== undefined && raw.sideEffect !== 'code') err('sideEffect must be "code" when present');
  if (raw.workspaceStrategy !== undefined && !WORKSPACE_STRATEGIES.has(raw.workspaceStrategy)) {
    err(`workspaceStrategy must be one of ${[...WORKSPACE_STRATEGIES].join(', ')}`);
  }
  let workspaceVariantOf = null;
  if (raw.workspaceVariantOf !== undefined) {
    const target = typeof raw.workspaceVariantOf === 'string' ? raw.workspaceVariantOf.trim() : '';
    if (!AGENT_KEY_RE.test(target)) err('workspaceVariantOf must be an agent key');
    else if (target === key) err('workspaceVariantOf must not reference the agent itself');
    else if (scope !== 'workspace-only') err('workspaceVariantOf requires scope "workspace-only"');
    else workspaceVariantOf = target;
  }
  // An unknown mockRole is a WARNING, never a 400: the field is dropped and the
  // generic mock-role fallback chain applies.
  let mockRole = null;
  if (raw.mockRole !== undefined) {
    const role = typeof raw.mockRole === 'string' ? raw.mockRole.trim() : '';
    const vocab = opts.mockWriterRoles instanceof Set ? opts.mockWriterRoles : null;
    if (!vocab || vocab.has(role)) mockRole = role || null;
    else warn(`[agent-registry] ${key || '<unkeyed>'}.mockRole: unknown mock role "${role}"; ignored (the generic mock chain applies)`);
  }

  const asksQuestions = !!raw.asksQuestions;
  const meta = {
    metaVersion: 2,
    key,
    displayName: typeof raw.displayName === 'string' && raw.displayName.trim() ? raw.displayName.trim() : key,
    description: typeof raw.description === 'string' ? raw.description : '',
    color: COLORS.has(raw.color) ? raw.color : 'amber',
    icon: typeof raw.icon === 'string' ? raw.icon : '',
    agentFile: typeof raw.agentFile === 'string' && raw.agentFile.trim() ? raw.agentFile.trim() : null,
    runnerType,
    scope,
    domain: typeof raw.domain === 'string' && DOMAIN_RE.test(raw.domain) ? raw.domain : 'general',
    fanOut: !!raw.fanOut,
    asksQuestions,
    questionsLocked: asksQuestions && !!raw.questionsLocked,
    questionsDefault: asksQuestions && !!raw.questionsDefault,
    order: Number.isFinite(order) ? order : DEFAULT_ORDER,
    promptHints: typeof raw.promptHints === 'string' ? raw.promptHints : '',
    requiresSkills: Array.isArray(raw.requiresSkills)
      ? raw.requiresSkills.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
      : [],
    inputs,
    outputs,
    portSummary: '',
  };
  meta.portSummary = derivePortSummary(meta);
  // Capability defaults are applied at READ time, never written into the entry:
  // an absent field means "the default", so a v2 entry stays diffable against
  // the sidecar that produced it.
  if (verdict) meta.verdict = verdict;
  if (raw.sideEffect === 'code') meta.sideEffect = 'code';
  if (mockRole) meta.mockRole = mockRole;
  if (raw.wantsRequest) meta.wantsRequest = true;
  if (raw.workspaceFanOut) meta.workspaceFanOut = true;
  if (WORKSPACE_STRATEGIES.has(raw.workspaceStrategy)) meta.workspaceStrategy = raw.workspaceStrategy;
  if (workspaceVariantOf) meta.workspaceVariantOf = workspaceVariantOf;
  if (raw.placeable !== undefined && !raw.placeable) meta.placeable = false;
  return { errors, meta };
}

function readVerdict(raw, err) {
  if (raw === undefined) return null;
  const filename = raw && typeof raw === 'object' && typeof raw.filename === 'string' ? raw.filename.trim() : '';
  if (!filename) { err('verdict must be an object with a filename'); return null; }
  if (/[\\/]/.test(filename) || filename.includes('..')) {
    err(`verdict filename "${filename}" must be a plain basename`);
    return null;
  }
  return { filename };
}

function readPortHead(raw, side, seen, err) {
  if (!raw || typeof raw !== 'object') { err(`${side}: each port must be an object`); return null; }
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (id === RESERVED_PORT_ID) {
    err(`${side}: port id "${RESERVED_PORT_ID}" is reserved — the engine synthesizes the await gate port on every agent node`);
    return null;
  }
  if (!PORT_ID_RE.test(id)) { err(`${side}: bad port id "${id}"`); return null; }
  if (seen.has(id)) { err(`${side}: duplicate port id "${id}"`); return null; }
  seen.add(id);
  if (!TYPES.includes(raw.type)) { err(`${side}.${id}: type must be one of ${TYPES.join(', ')}`); return null; }
  const port = { id, type: raw.type };
  if (typeof raw.label === 'string' && raw.label.trim()) port.label = raw.label.trim();
  if (typeof raw.description === 'string' && raw.description.trim()) port.description = raw.description.trim();
  if (raw.type === 'void' && (raw.filename !== undefined || raw.store !== undefined)) {
    err(`${side}.${id}: void ports carry no filename or store`);
  }
  return port;
}

function readInputs(raw, err, warn) {
  if (!Array.isArray(raw)) { err('inputs must be an array'); return []; }
  if (raw.length > MAX_PORTS_PER_SIDE) err(`inputs: at most ${MAX_PORTS_PER_SIDE} ports per side (got ${raw.length})`);
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    const port = readPortHead(p, 'inputs', seen, err);
    if (!port) continue;
    // A loop receiver is excused from the first-execution barrier, so `loop` and
    // `required` can never both hold. Coerced rather than rejected — but it is
    // authoring intent quietly overruled, hence the warning.
    const loop = !!p.loop;
    let required = p.required === undefined ? true : !!p.required;
    if (loop && required) {
      warn(`[agent-registry] inputs.${port.id}: loop:true forces required:false (a loop receiver is never a barrier)`);
      required = false;
    }
    port.required = required;
    if (loop) port.loop = true;
    if (p.expands) {
      if (port.type !== 'json') err(`inputs.${port.id}: expands is only legal on json inputs`);
      else port.expands = true;
    }
    if (p.as !== undefined) {
      const need = Object.hasOwn(AS_REQUIRES_TYPE, p.as) ? AS_REQUIRES_TYPE[p.as] : null;
      if (!INPUT_AS.has(p.as)) err(`inputs.${port.id}: as must be one of ${[...INPUT_AS].join(', ')}`);
      else if (need ? port.type !== need : port.type === 'void') {
        err(`inputs.${port.id}: as "${p.as}" requires a ${need || 'non-void'} port (got ${port.type})`);
      } else port.as = p.as;
    } else if (port.type !== 'void') port.as = 'file';
    if (typeof p.directive === 'string' && p.directive.trim()) port.directive = p.directive;
    out.push(port);
  }
  return out;
}

function readOutputs(raw, hasVerdict, err) {
  if (!Array.isArray(raw)) { err('outputs must be an array'); return []; }
  if (raw.length === 0) err('at least one output port is required');
  if (raw.length > MAX_PORTS_PER_SIDE) err(`outputs: at most ${MAX_PORTS_PER_SIDE} ports per side (got ${raw.length})`);
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    const port = readPortHead(p, 'outputs', seen, err);
    if (!port) continue;
    const when = p.when === undefined ? 'always' : p.when;
    if (!OUTPUT_WHEN.has(when)) err(`outputs.${port.id}: when must be one of ${[...OUTPUT_WHEN].join(', ')}`);
    else {
      if (when !== 'always' && !hasVerdict) {
        err(`outputs.${port.id}: when "${when}" requires the agent to declare verdict: { filename }`);
      }
      port.when = when;
    }
    if (port.type !== 'void') {
      const filename = typeof p.filename === 'string' ? p.filename.trim() : '';
      const tokens = [...filename.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((t) => !FILENAME_TOKENS.has(t));
      if (!filename) err(`outputs.${port.id}: ${port.type} outputs require a filename template`);
      else if (/[\\/]/.test(filename) || filename.includes('..')) {
        err(`outputs.${port.id}: filename "${filename}" must be a plain basename`);
      } else if (tokens.length) {
        err(`outputs.${port.id}: filename "${filename}" uses unknown token(s) ${tokens.map((t) => `{${t}}`).join(', ')}`);
      } else port.filename = filename;
      const store = p.store === undefined ? 'run' : p.store;
      if (!OUTPUT_STORES.has(store)) err(`outputs.${port.id}: store must be one of ${[...OUTPUT_STORES].join(', ')}`);
      else port.store = store;
      port.artifactKind = typeof p.artifactKind === 'string' && p.artifactKind.trim() ? p.artifactKind.trim() : port.id;
    }
    out.push(port);
  }
  return out;
}
```
If P1's `PORT_TYPES` is a Set the `TYPES` line works as written; if it is an array, drop the spread. `MAX_PORTS_PER_SIDE` must be 8.
`Expected: PASS — 11 tests passing`
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — shared agent meta v2 normalizer`

---

### Task 8: `MOCK_WRITER_ROLES` — the mock vocabulary, in lockstep with the switch

**Files:** modify `src/core/claude-runner.mjs` (add the exports beside `MOCK_FANOUT_ROLES` at `:849`; use the two constants as case labels in the role switch at `:1065-1105`), create `test/mock-writer-roles.test.mjs`. Dev has NO such export today — `agent-meta.validateMetaV2` needs the vocabulary, `GET /api/agents` ships it to the Agents view (P7), and P3's `resolveMockRole` picks from it.

**Interfaces produced:** `MOCK_WRITER_ROLES: Set<string>` (14 roles), `MOCK_ROLE_CLARIFY = 'clarify'`, `MOCK_ROLE_DECOMPOSER = 'decomposer'`.
The 14 roles, exactly: `clarify, planner-plan, refiner, decomposer, implementer, reviewer, plan-review, workspace-scan, agent-gen, workspace-reviewer, manual-tests-checklist, manual-web-ui-testing, generic-producer, generic-verifier`. The `ask` arm (`:1034`, the Ask-Worca mock) stays OUTSIDE the set — it is not a writer role.

- [ ] Step 1: Write the failing test — `test/mock-writer-roles.test.mjs`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOCK_WRITER_ROLES, MOCK_ROLE_CLARIFY, MOCK_ROLE_DECOMPOSER } from '../src/core/claude-runner.mjs';

const SRC = readFileSync(fileURLToPath(new URL('../src/core/claude-runner.mjs', import.meta.url)), 'utf8');
const CONSTS = { MOCK_ROLE_CLARIFY, MOCK_ROLE_DECOMPOSER };

test('the 14 mock writer roles are exported as a Set', () => {
  assert.equal(MOCK_WRITER_ROLES instanceof Set, true);
  assert.deepEqual([...MOCK_WRITER_ROLES].sort(), ['agent-gen', 'clarify', 'decomposer', 'generic-producer',
    'generic-verifier', 'implementer', 'manual-tests-checklist', 'manual-web-ui-testing', 'plan-review',
    'planner-plan', 'refiner', 'reviewer', 'workspace-reviewer', 'workspace-scan']);
  assert.equal(MOCK_ROLE_CLARIFY, 'clarify');
  assert.equal(MOCK_ROLE_DECOMPOSER, 'decomposer');
  assert.equal(MOCK_WRITER_ROLES.has('ask'), false, 'the Ask-Worca arm is not a writer role');
});

// Structural audit: the roles the mock runner can actually SERVE are the arms of
// its role switch. Parsing them from the source is what keeps the exported
// vocabulary from drifting when someone adds a mock without updating the Set
// (validateMetaV2 would then reject a legal mockRole, and /api/agents would hide it).
test('MOCK_WRITER_ROLES is in lockstep with the mock role switch', () => {
  const arms = [...SRC.matchAll(/case\s+(?:'([^']+)'|([A-Z][A-Z0-9_]*)):/g)]
    .map((m) => (m[1] !== undefined ? m[1] : CONSTS[m[2]]))
    .filter((v) => typeof v === 'string');
  assert.equal(arms.length, 14, `expected 14 switch arms, found ${arms.length}`);
  assert.deepEqual([...new Set(arms)].sort(), [...MOCK_WRITER_ROLES].sort());
});
```
`Expected: FAIL — SyntaxError: The requested module '../src/core/claude-runner.mjs' does not provide an export named 'MOCK_WRITER_ROLES'`
- [ ] Step 2: Implement — in `src/core/claude-runner.mjs`, directly ABOVE `const MOCK_FANOUT_ROLES = new Set([` (`:849`):
```js
/**
 * The roles the offline mock runner can SERVE — one per arm of the role switch
 * below (the `ask` arm is the Ask-Worca assistant, not a writer role). Exported
 * because three consumers need the vocabulary and none of them may hard-code it:
 * meta v2 validation (an unknown `mockRole` is a warning + drop), GET /api/agents
 * (the Agents view's role picker) and the graph executor's mock-role chain.
 * test/mock-writer-roles.test.mjs parses the switch and pins the lockstep.
 */
export const MOCK_WRITER_ROLES = new Set([
  'clarify', 'planner-plan', 'refiner', 'decomposer', 'implementer', 'reviewer', 'plan-review',
  'workspace-scan', 'agent-gen', 'workspace-reviewer', 'manual-tests-checklist', 'manual-web-ui-testing',
  'generic-producer', 'generic-verifier',
]);

/** Named so the executor's mock-role chain and the switch cannot drift apart. */
export const MOCK_ROLE_CLARIFY = 'clarify';
export const MOCK_ROLE_DECOMPOSER = 'decomposer';
```
  and change exactly two case labels in the switch at `:1065`:
```js
    case MOCK_ROLE_CLARIFY:
      text = await mockClarify(m, cycle, onEvent);
      break;
```
```js
    case MOCK_ROLE_DECOMPOSER:
      text = await mockDecomposer(m, onEvent);
      break;
```
`Expected: PASS — 2 tests passing` (`node --test test/mock-writer-roles.test.mjs`); `node --test test/mock-runner.test.mjs test/mock-graphify.test.mjs` (every existing `mock*` suite) stays green — run `ls test | grep mock` and run them all.
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — export the mock writer role vocabulary`

---

### Task 9: dual-shape sidecars — the 11 builtins GAIN meta v2 (and keep every v1 field)

**Files:** modify all 11 `agents/*.meta.json` and their 11 `agents/*.md` bodies. **Dual shape is mandatory**: `consumes/optionalConsumes/produces/connectsTo/loopSource/uiPhase` STAY until P8, because both engines read the same files during coexistence. Add ONLY the keys below; change nothing else (no reordering of existing keys, no description/icon edits, no frontmatter edits).

**Per-sidecar additions** (`+` = add this key; the port bodies are the §6 table, verified against dev's `phases.mjs` builders):

`agents/clarify.meta.json`
```json
  "metaVersion": 2,
  "mockRole": "clarify",
  "inputs": [{ "id": "task", "type": "md" }],
  "outputs": [{ "id": "answers", "type": "json", "filename": "clarify.json", "artifactKind": "clarify" }],
```
`agents/planner.meta.json`
```json
  "metaVersion": 2,
  "mockRole": "planner-plan",
  "workspaceFanOut": true,
  "workspaceStrategy": "explore",
  "inputs": [
    { "id": "task", "type": "md" },
    { "id": "answers", "type": "json", "required": false, "as": "answers" },
    { "id": "revise", "type": "md", "required": false, "loop": true,
      "directive": "## Revise to address the review\n\nA reviewer found issues with the previous plan. Re-plan from scratch (cold start) and address EVERY critical and major finding in the review below. Preserve the \"## Clarifications (Q&A)\" section." }
  ],
  "outputs": [{ "id": "plan", "type": "md", "filename": "{base}{vsuffix}.md", "store": "project" }],
```
`agents/refiner.meta.json` — the clean and blocking arms share ONE filename template (same type ⇒ one allocated path, one `{vsuffix}` tick)
```json
  "metaVersion": 2,
  "mockRole": "refiner",
  "promptHints": "Mark a finding critical/major only if it must be fixed before implementation.",
  "wantsRequest": true,
  "workspaceFanOut": true,
  "workspaceStrategy": "explore",
  "verdict": { "filename": "refine-review-cycle{cycle}.json" },
  "inputs": [
    { "id": "plan", "type": "md" },
    { "id": "revise", "type": "md", "required": false, "loop": true }
  ],
  "outputs": [
    { "id": "plan", "type": "md", "when": "clean", "filename": "{base}{vsuffix}.md", "store": "project" },
    { "id": "revise", "type": "md", "when": "blocking", "filename": "{base}{vsuffix}.md", "store": "project", "artifactKind": "plan" }
  ],
```
`agents/planReviewer.meta.json`
```json
  "metaVersion": 2,
  "mockRole": "plan-review",
  "promptHints": "Do NOT rewrite the plan. Only critical/major block (the planner then revises).",
  "wantsRequest": true,
  "workspaceFanOut": true,
  "workspaceStrategy": "explore",
  "verdict": { "filename": "plan-review-cycle{cycle}.json" },
  "inputs": [{ "id": "plan", "type": "md" }],
  "outputs": [
    { "id": "review", "type": "md", "when": "blocking", "filename": "{base}-plan-review.md", "store": "project" },
    { "id": "pass", "type": "void", "when": "clean" }
  ],
```
`agents/decomposer.meta.json`
```json
  "metaVersion": 2,
  "mockRole": "decomposer",
  "inputs": [{ "id": "plan", "type": "md" }],
  "outputs": [{ "id": "tasks", "type": "json", "filename": "decomposition.json", "artifactKind": "decomposition" }],
```
`agents/implementer.meta.json` — **the input ORDER is load-bearing**: the single-directive rule (A3) renders the FIRST fresh directive port in DECLARED order, so `fix` must beat `task`, which must beat `plan` (v1 precedence: fix mode > task mode > implement)
```json
  "metaVersion": 2,
  "mockRole": "implementer",
  "sideEffect": "code",
  "workspaceFanOut": true,
  "workspaceStrategy": "task",
  "promptHints": "Work inside the project directory (your cwd). Commit nothing; just edit files and tests.",
  "inputs": [
    { "id": "fix", "type": "md", "required": false, "loop": true, "as": "fix-review",
      "directive": "Address EVERY critical and major issue in the review below, then re-run the tests. Follow the plan; deviate only if something does not work at all." },
    { "id": "task", "type": "json", "required": false, "expands": true,
      "directive": "Implement the task below using TDD (red-green-refactor). The TASK file is a self-contained vertical slice and is AUTHORITATIVE — do exactly what it says and nothing outside its scope. The plan is reference/context only; you do NOT need to read the whole plan." },
    { "id": "plan", "type": "md",
      "directive": "Implement the plan using TDD (red-green-refactor). Follow it with NO deviation; deviate slightly only if a step does not work at all." }
  ],
  "outputs": [{ "id": "done", "type": "void" }],
```
`agents/reviewer.meta.json` — NO `workspaceFanOut` (the workspace variant carries it)
```json
  "metaVersion": 2,
  "mockRole": "reviewer",
  "wantsRequest": true,
  "workspaceStrategy": "review",
  "verdict": { "filename": "impl-review-cycle{cycle}.json" },
  "inputs": [
    { "id": "plan", "type": "md" },
    { "id": "done", "type": "void", "required": false, "as": "worktree" }
  ],
  "outputs": [
    { "id": "review", "type": "md", "when": "blocking", "filename": "{base}-impl-review.md", "store": "project" },
    { "id": "pass", "type": "void", "when": "clean" }
  ],
```
`agents/workspaceReviewer.meta.json` — the port SIGNATURE must stay deep-equal to `reviewer`'s (`id,type,required,loop,expands` per input; `id,type,when` per output; verdict present) or `resolveGraph`'s workspace substitution refuses it
```json
  "metaVersion": 2,
  "mockRole": "workspace-reviewer",
  "workspaceVariantOf": "reviewer",
  "promptHints": "The issue list is the UNION of every per-project critical/major issue (never collapse one), sorted by projectKey then severity, each location prefixed \"<projectKey>: \".",
  "workspaceFanOut": true,
  "workspaceStrategy": "review",
  "verdict": { "filename": "ws-review-cycle{cycle}.json" },
  "inputs": [
    { "id": "plan", "type": "md" },
    { "id": "done", "type": "void", "required": false, "as": "worktree" }
  ],
  "outputs": [
    { "id": "review", "type": "md", "when": "blocking", "filename": "{base}-ws-review.md", "store": "project" },
    { "id": "pass", "type": "void", "when": "clean" }
  ],
```
`agents/manualTestsChecklist.meta.json` — `{diffInstruction}` is substituted by the executor (P3); with the single-project value `via \`git diff\` in your cwd` the sentence is byte-identical to today's
```json
  "metaVersion": 2,
  "mockRole": "manual-tests-checklist",
  "promptHints": "Read the implementation plan and the implemented changes ({diffInstruction}), then write a markdown checklist of concrete manual test cases a human can run against the app. Each case: a `- [ ]` line with steps and the expected result.",
  "inputs": [{ "id": "plan", "type": "md" }],
  "outputs": [{ "id": "checklist", "type": "md", "filename": "manual-tests-checklist.md" }],
```
`agents/manualWebUiTesting.meta.json` — its frontmatter Playwright grants MUST keep reaching `ctx.node.tools` (P3/P4 stamp them; do not touch the `.md` frontmatter here)
```json
  "metaVersion": 2,
  "mockRole": "manual-web-ui-testing",
  "promptHints": "Execute the manual test checklist against the running web UI using the Playwright tools. Severity calibration: a failing manual case is at least major.",
  "verdict": { "filename": "webui-review-cycle{cycle}.json" },
  "inputs": [{ "id": "checklist", "type": "md" }],
  "outputs": [
    { "id": "review", "type": "md", "when": "blocking", "filename": "webui-review-cycle{cycle}.md", "artifactKind": "webui" },
    { "id": "pass", "type": "void", "when": "clean" }
  ],
```
`agents/workspaceScanner.meta.json` — off-pipeline: `placeable: false` keeps it out of the palette AND out of any graph (V4)
```json
  "metaVersion": 2,
  "mockRole": "workspace-scan",
  "placeable": false,
  "inputs": [{ "id": "task", "type": "md" }],
  "outputs": [{ "id": "workspace", "type": "md", "filename": "workspace-description.md" }],
```

**The `.md` bodies.** Seven files carry a `## Inputs (from the task prompt)` section — REPLACE that heading and its bullet list with the `## Ports` block below (everything after it — verdict/clarify JSON contracts, fan-out, workspace and graph-tooling sections, frontmatter — stays VERBATIM). Four files have no such section — INSERT the block right after the intro paragraph, before the next `##` heading. Every block opens with the same sentence.

- `agents/worca-cc-clarify.md` (insert after the intro; no `## Inputs` section today)
```markdown
## Ports

The engine binds every port to an absolute path in the task prompt — never hardcode filenames.

- **in `task`** (md) — the user's task/prompt (plus any attached markdown / extra files).
- **out `answers`** (json) — your questions, in the shape contracted below. The engine folds the user's answers back into this same file.
```
- `agents/worca-cc-planner.md` (insert after the intro)
```markdown
## Ports

The engine binds every port to an absolute path in the task prompt — never hardcode filenames.

- **in `task`** (md) — the user's task/prompt (plus any attachments).
- **in `answers`** (json, optional) — the Clarify agent's questions and the user's answers. Honor them.
- **in `revise`** (md, optional, loop) — a plan review that bounced the plan back. When it is bound, you are in REVISE mode (see below).
- **out `plan`** (md) — the implementation plan you write.
```
- `agents/worca-cc-plan-refiner.md` (replace `## Inputs (from the task prompt)`, line 10)
```markdown
## Ports

The engine binds every port to an absolute path in the task prompt — never hardcode filenames.

- **in `plan`** (md) — the INPUT plan to review (the latest version so far).
- **in `revise`** (md, optional, loop) — your own previous output coming back for another cycle.
- **out `plan`** (md, on a clean verdict) — the refined plan, when nothing blocks any more.
- **out `revise`** (md, on a blocking verdict) — the refined plan when issues remain; it re-enters your `revise` input for the next cycle. Both arms write the SAME plan file.
- **verdict** (json) — the review JSON the orchestrator gates on; its shape is contracted below.

The cycle number, the original task/prompt context, and the plan's own `## Clarifications (Q&A)` section (preserve and respect the user's answers) come with the task prompt.
```
- `agents/worca-cc-plan-reviewer.md` (replace `## Inputs (from the task prompt)`, line 12)
```markdown
## Ports

The engine binds every port to an absolute path in the task prompt — never hardcode filenames.

- **in `plan`** (md) — the plan markdown to review.
- **out `review`** (md, on a blocking verdict) — your review markdown.
- **out `pass`** (void, on a clean verdict) — the no-blocking-issues signal; it carries no file.
- **verdict** (json) — the review JSON the orchestrator gates on; its shape is contracted below.

The original user request (in the task header), any attached files, and the cycle number come with the task prompt. Your cwd is the project repo, so you can inspect the real codebase.
```
- `agents/worca-cc-decomposer.md` (insert after the intro)
```markdown
## Ports

The engine binds every port to an absolute path in the task prompt — never hardcode filenames.

- **in `plan`** (md) — the approved implementation plan to split.
- **out `tasks`** (json) — the decomposition manifest, in the shape contracted below. The per-task markdown files go in the tasks directory the prompt names.
```
- `agents/worca-cc-implementer.md` (insert after the intro)
```markdown
## Ports

The engine binds every port to an absolute path in the task prompt — never hardcode filenames.

- **in `fix`** (md, optional, loop) — a code review to address. When it is bound, you are in FIX mode.
- **in `task`** (json, optional) — one decomposed vertical slice. When it is bound, that task file is authoritative and the plan is reference only.
- **in `plan`** (md) — the approved implementation plan. Always bound.
- **out `done`** (void) — the signal that the working tree now carries your change; it carries no file.
```
- `agents/worca-cc-code-reviewer.md` (replace `## Inputs (from the task prompt)`, line 10)
```markdown
## Ports

The engine binds every port to an absolute path in the task prompt — never hardcode filenames.

- **in `plan`** (md) — the plan that was implemented.
- **in `done`** (void, optional) — the implementer's staged worktree. Review THAT tree's diff.
- **out `review`** (md, on a blocking verdict) — your review markdown.
- **out `pass`** (void, on a clean verdict) — the no-blocking-issues signal; it carries no file.
- **verdict** (json) — the review JSON the orchestrator gates on; its shape is contracted below.

Your cwd is the project repo, so you can run git. The cycle number is in the task prompt.
```
- `agents/worca-cc-workspace-reviewer.md` (replace `## Inputs (from the task prompt)`, line 10)
```markdown
## Ports

The engine binds every port to an absolute path in the task prompt — never hardcode filenames.

- **in `plan`** (md) — the plan that was implemented.
- **in `done`** (void, optional) — the implementer's staged worktrees. Review THOSE trees' diffs.
- **out `review`** (md, on a blocking verdict) — your ONE synthesized review markdown.
- **out `pass`** (void, on a clean verdict) — the no-blocking-issues signal; it carries no file.
- **verdict** (json) — the single synthesized review JSON the orchestrator gates on; its shape is contracted below.

The task prompt also carries the `## Workspace Context` block (the frozen, point-in-time interconnection description), the `## Workspace projects` block listing each member's worktree directory (a sub-agent's cwd) and its checkpoint ref (the diff base), and the cycle number.
```
- `agents/worca-cc-manual-tests-checklist.md` (replace `## Inputs (from the task prompt)`, line 10)
```markdown
## Ports

The engine binds every port to an absolute path in the task prompt — never hardcode filenames.

- **in `plan`** (md) — the approved implementation plan.
- **out `checklist`** (md) — the manual test checklist you author.

The user's original request comes with the task prompt. Access to the implementation is via git: your cwd is the project repo. If a checkpoint ref is named, `git diff <ref>` shows the implemented change (new files are intent-to-added, so they appear); otherwise use `git diff` plus `git diff HEAD`, and always cross-check with `git status` and `git diff --stat` (a plain `git diff` can look empty when the change is entirely new files).
```
- `agents/worca-cc-manual-web-ui-testing.md` (replace `## Inputs (from the task prompt)`, line 10)
```markdown
## Ports

The engine binds every port to an absolute path in the task prompt — never hardcode filenames.

- **in `checklist`** (md) — the manual test checklist to execute (authored by the Manual Tests Checklist agent). Each `- [ ]` item is a case with steps + an Expected result.
- **out `review`** (md, on a blocking verdict) — your findings written up as markdown.
- **out `pass`** (void, on a clean verdict) — the no-blocking-issues signal; it carries no file.
- **verdict** (json) — the review JSON the orchestrator gates on; its shape is contracted below.

The cycle number comes with the task prompt, as does an optional screenshots directory under the pipeline dir for evidence.
```
- `agents/worca-cc-workspace-scanner.md` (replace `## Inputs (from the task prompt)`, line 10)
```markdown
## Ports

The engine binds every port to an absolute path in the task prompt — never hardcode filenames.

- **in `task`** (md) — the scan request.
- **out `workspace`** (md) — the interconnection description you write.

The task prompt also names the member projects — each project's name, `projectKey`, and the directory to investigate (a throwaway worktree when graphify built a graph there, else the project root) — and, per project, whether a `graphify-out/` knowledge graph is available (use it when present; otherwise fall back to `Read`/`Grep`/`Glob`).
```
NO body mentions the synthesized `await` port: it is an engine concern the agent never sees.

- [ ] Step 1: Apply the 11 JSON additions and the 11 `## Ports` blocks above.
- [ ] Step 2: Sanity-check the JSON and the port ids without touching the registry yet:
```bash
node --input-type=module -e "
import { readFileSync, readdirSync } from 'node:fs';
import { validateMetaV2 } from './src/shared/graph/agent-meta.mjs';
import { MOCK_WRITER_ROLES } from './src/core/claude-runner.mjs';
let bad = 0;
for (const f of readdirSync('agents').filter((x) => x.endsWith('.meta.json'))) {
  const raw = JSON.parse(readFileSync('agents/' + f, 'utf8'));
  const { errors } = validateMetaV2(raw, { mockWriterRoles: MOCK_WRITER_ROLES });
  if (errors.length) { bad += 1; console.log(f, errors); }
  for (const k of ['consumes', 'produces', 'connectsTo']) if (!(k in raw) && f !== 'x') { /* v1 fields must survive */ }
}
console.log(bad === 0 ? 'ALL 11 VALID' : 'INVALID');"
```
`Expected: ALL 11 VALID`
- [ ] Step 3: `git diff --stat agents/` — 22 files changed, and `git diff agents/ | grep '^-' | grep -v '^---'` shows ONLY the seven replaced `## Inputs (from the task prompt)` headings and their bullet lists (no v1 JSON key was removed).
- [ ] Step 4: Commit — `worca: Node-graph v2 P2 — dual-shape meta v2 sidecars for the 11 builtins`

---

### Task 10: registry merge, `registryPortsFn`, the real-sidecar test helper

**Files:** modify `src/core/agent-registry.mjs` (`normalizeMeta`, `:189-249`), create `src/core/graph/registry-ports.mjs`, `test/helpers/graph-ports.mjs`; modify `test/agent-registry-schema-v2.test.mjs` (the `:90-99` block asserting `promptHints === ''` for all 11 builtins MUST be rewritten — five builtins now carry hints), create `test/graph-registry-ports.test.mjs`.

Why the merge and not "unknown keys are ignored": `normalizeMeta` returns a FIXED key set and `agent-store.updateAgent` round-trips `{...existing, ...rawMeta}` through it (`agent-store.mjs:86-110`), so a user's v2 sidecar would silently LOSE its ports on the next save. `GET /api/agents` (`ui/server.mjs:3907-3913`) passes normalized metas through untouched, so the v2 fields ride to the browser with NO server edit — verify, do not change it.

**Interfaces produced:** `normalizeMeta(raw)` merges `metaVersion, inputs, outputs, portSummary, verdict?, sideEffect?, mockRole?, wantsRequest?, workspaceFanOut?, workspaceStrategy?, workspaceVariantOf?, placeable?` when `raw.metaVersion === 2`; `registryPortsFn(registry) → portsFn`; `test/helpers/graph-ports.mjs` exports `realAgentMetas()`, `realPortsFn()`, `realRegistryIndex()`.
**Rules:** a v2 sidecar whose validation fails ⇒ `console.warn` + the WHOLE sidecar is skipped (`normalizeMeta` returns null); no `metaVersion` ⇒ today's v1 path with ports ABSENT; the unrelated legacy string field `version` ('1'/'2') is NOT overloaded.

- [ ] Step 1: Write the failing tests — append to `test/agent-registry-schema-v2.test.mjs`
```js
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateMetaV2 } from '../src/shared/graph/agent-meta.mjs';
import { MOCK_WRITER_ROLES } from '../src/core/claude-runner.mjs';

const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url));
const rawSidecars = () => readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.meta.json'))
  .map((f) => JSON.parse(readFileSync(join(AGENTS_DIR, f), 'utf8')));

test('all 11 builtins validate as meta v2', () => {
  const raws = rawSidecars();
  assert.equal(raws.length, 11);
  for (const raw of raws) {
    assert.equal(raw.metaVersion, 2, `${raw.key} declares metaVersion 2`);
    assert.deepEqual(validateMetaV2(raw, { mockWriterRoles: MOCK_WRITER_ROLES }).errors, [], raw.key);
    assert.equal(MOCK_WRITER_ROLES.has(raw.mockRole), true, `${raw.key} names a real mock role`);
  }
});

test('the 11 shipped sidecars keep their v1 shape AND gain v2 ports (dual shape)', () => {
  const reg = loadAgentRegistry(undefined, { userAgentsDir: null });
  assert.equal(Object.keys(reg).length, 11);
  for (const m of Object.values(reg)) {
    assert.deepEqual(m.channelDefs, [], `${m.key} has no channelDefs`);
    assert.ok(Array.isArray(m.consumes) && m.consumes.length, `${m.key} keeps consumes`);
    assert.ok(Array.isArray(m.produces), `${m.key} keeps produces`);
    assert.equal(m.metaVersion, 2, `${m.key} merged v2`);
    assert.ok(Array.isArray(m.inputs) && m.inputs.length, `${m.key} has typed inputs`);
    assert.ok(Array.isArray(m.outputs) && m.outputs.length, `${m.key} has typed outputs`);
    assert.equal(typeof m.portSummary, 'string');
    assert.equal(m.inputs.some((p) => p.id === 'await'), false, 'await is synthesized, never declared');
  }
  assert.deepEqual(reg.planner.consumes, ['userPrompt', 'clarify', 'review']);
  assert.deepEqual(reg.planner.produces, ['plan']);
  // Exactly five builtins carry prompt hints; the other six stay empty (this
  // replaces the old "promptHints === '' for all 11" pin).
  assert.deepEqual(Object.values(reg).filter((m) => m.promptHints).map((m) => m.key).sort(),
    ['manualTestsChecklist', 'manualWebUiTesting', 'planReviewer', 'refiner', 'workspaceReviewer']);
  assert.deepEqual(reg.implementer.inputs.map((p) => p.id), ['fix', 'task', 'plan'],
    'the single-directive rule renders the FIRST fresh directive in DECLARED order');
  assert.equal(reg.reviewer.workspaceFanOut, undefined, 'the reviewer does not fan out per project');
  assert.equal(reg.workspaceReviewer.workspaceVariantOf, 'reviewer');
  assert.equal(reg.workspaceScanner.placeable, false);
});

// The v2 ports and the v1 channels describe the SAME data flow until P8 deletes
// the channel layer. This table is the mapping; the assertion below is what stops
// one side drifting from the other.
const PORT_CHANNELS = {
  clarify: { inputs: { task: 'userPrompt' }, outputs: { answers: 'clarify' } },
  planner: { inputs: { task: 'userPrompt', answers: 'clarify', revise: 'review' }, outputs: { plan: 'plan' } },
  refiner: { inputs: { plan: 'plan', revise: 'plan' }, outputs: { plan: 'plan', revise: 'plan' } },
  planReviewer: { inputs: { plan: 'plan' }, outputs: { review: 'review' } },
  decomposer: { inputs: { plan: 'plan' }, outputs: { tasks: 'decomposition' } },
  implementer: { inputs: { fix: 'review', task: 'decomposition', plan: 'plan' }, outputs: { done: 'code' } },
  reviewer: { inputs: { plan: 'plan', done: 'code' }, outputs: { review: 'review' } },
  workspaceReviewer: { inputs: { plan: 'plan', done: 'code' }, outputs: { review: 'review' } },
  manualTestsChecklist: { inputs: { plan: 'plan' }, outputs: { checklist: 'checklist' } },
  manualWebUiTesting: { inputs: { checklist: 'checklist' }, outputs: { review: 'review' } },
  workspaceScanner: { inputs: { task: 'userPrompt' }, outputs: { workspace: 'workspace' } },
};
// The only sanctioned asymmetries, each with its reason.
const CHANNEL_DELTA = {
  manualTestsChecklist: { missingIn: ['code'] },   // reads the diff from its cwd, not through a port
  manualWebUiTesting: { missingIn: ['code'] },     // drives the live app, not a port
  implementer: { extraIn: ['decomposition'] },     // the expands port; v1 modeled fan-out outside the channels
};

test('ports <-> channels consistency (dual-shape guard until the v1 kill list)', () => {
  const reg = loadAgentRegistry(undefined, { userAgentsDir: null });
  assert.deepEqual(Object.keys(PORT_CHANNELS).sort(), Object.keys(reg).sort());
  for (const [key, meta] of Object.entries(reg)) {
    const map = PORT_CHANNELS[key];
    const delta = CHANNEL_DELTA[key] || {};
    for (const p of meta.inputs) assert.ok(map.inputs[p.id], `${key}: input "${p.id}" is missing from PORT_CHANNELS`);
    for (const p of meta.outputs) {
      if (p.type === 'void' && !map.outputs[p.id]) continue;    // `pass` is a signal, not a channel
      assert.ok(map.outputs[p.id], `${key}: output "${p.id}" is missing from PORT_CHANNELS`);
    }
    const fromPorts = new Set(meta.inputs.map((p) => map.inputs[p.id]));
    const v1In = new Set(meta.consumes);
    assert.deepEqual([...v1In].filter((c) => !fromPorts.has(c)).sort(), (delta.missingIn || []).sort(), `${key} consumes`);
    assert.deepEqual([...fromPorts].filter((c) => !v1In.has(c)).sort(), (delta.extraIn || []).sort(), `${key} ports->consumes`);
    const outChannels = new Set(meta.outputs.map((p) => map.outputs[p.id]).filter(Boolean));
    if (meta.verdict) outChannels.add('review');   // the verdict JSON IS the v1 review channel
    assert.deepEqual([...outChannels].sort(), [...new Set(meta.produces)].sort(), `${key} produces`);
  }
});

test('normalizeMeta: a v2 sidecar merges, an invalid one is skipped, a v1 one has no ports', () => {
  const dir = tmp();
  writeMeta(dir, 'v1only', {});
  writeMeta(dir, 'ported', { metaVersion: 2, inputs: [{ id: 'plan', type: 'md' }],
    outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }], mockRole: 'generic-producer' });
  writeMeta(dir, 'broken', { metaVersion: 2, inputs: [{ id: 'await', type: 'md' }], outputs: [] });
  const warned = [];
  const orig = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  let reg;
  try { reg = load(dir); } finally { console.warn = orig; }
  assert.equal(reg.v1only.metaVersion, undefined);
  assert.equal(reg.v1only.inputs, undefined, 'a v1 sidecar carries NO ports');
  assert.equal(reg.v1only.version, '1', 'the legacy string version field is not overloaded');
  assert.equal(reg.ported.metaVersion, 2);
  assert.deepEqual(reg.ported.inputs.map((p) => p.id), ['plan']);
  assert.equal(reg.ported.mockRole, 'generic-producer');
  assert.deepEqual(reg.ported.consumes, ['userPrompt'], 'the v1 fields survive the merge');
  assert.equal(reg.broken, undefined, 'an invalid v2 sidecar is skipped whole');
  assert.ok(warned.some((w) => /broken/.test(w) && /reserved/.test(w)), warned.join('\n'));
});
```
(`join` is already imported at the top of the file; add the three new imports beside the existing ones and DELETE the old `test('the 11 shipped sidecars are unchanged by v2 (backward compatibility)')` block at `:90-99` — the test above replaces it.)
`test/graph-registry-ports.test.mjs`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { realPortsFn, realAgentMetas } from './helpers/graph-ports.mjs';

test('registryPortsFn resolves builtin ports and synthesizes the await gate', () => {
  const portsFn = registryPortsFn(loadAgentRegistry(undefined, { userAgentsDir: null }));
  const p = portsFn({ id: 'n', kind: 'agent', key: 'implementer', x: 0, y: 0, config: {} });
  assert.deepEqual(p.inputs.map((i) => i.id), ['fix', 'task', 'plan', 'await']);
  assert.deepEqual(p.outputs.map((o) => o.id), ['done']);
  assert.equal(portsFn({ id: 'n', kind: 'agent', key: 'ghost', x: 0, y: 0, config: {} }), undefined);
  assert.deepEqual(portsFn({ id: 'n', kind: 'task', x: 0, y: 0, config: {} }).outputs.map((o) => o.id), ['task']);
  assert.equal(registryPortsFn({})({ kind: 'agent', key: 'x' }), undefined);
});

test('the real-sidecar helper mirrors the registry', () => {
  const metas = realAgentMetas();
  assert.equal(metas.length, 11);
  const a = realPortsFn()({ id: 'n', kind: 'agent', key: 'reviewer', x: 0, y: 0, config: {} });
  const b = registryPortsFn(loadAgentRegistry(undefined, { userAgentsDir: null }))(
    { id: 'n', kind: 'agent', key: 'reviewer', x: 0, y: 0, config: {} });
  assert.deepEqual(a.inputs, b.inputs);
  assert.deepEqual(a.outputs, b.outputs);
});
```
`Expected: FAIL — Cannot find module '.../src/core/graph/registry-ports.mjs'`, and the schema-v2 additions fail on `m.metaVersion` being `undefined`

- [ ] Step 2: Implement — `src/core/agent-registry.mjs`. Add the imports beside the existing ones (`:11-16`):
```js
import { normalizeAgentMeta } from '../shared/graph/agent-meta.mjs'; // meta v2 (one source: registry + store + UI)
import { MOCK_WRITER_ROLES } from './claude-runner.mjs';             // mockRole vocabulary (no cycle: claude-runner imports no registry)
```
  then in `normalizeMeta` (`:189`) assign today's returned literal to `const base = { … };` (unchanged content) and append, right before the closing brace:
```js
  // ── meta v2 merge (dual shape, P2a..P8) ────────────────────────────────────
  // A v2 sidecar KEEPS every v1 field and GAINS typed ports + capabilities, so
  // both engines read the same file during coexistence. normalizeMeta returns a
  // FIXED key set and agent-store round-trips {...existing, ...raw} through it,
  // so a v2 sidecar that only "passed unknown keys through" would lose its ports
  // on the next save. Invalid v2 => warn and SKIP THE WHOLE SIDECAR: half-loading
  // an agent whose ports are wrong is worse than not loading it.
  if (raw.metaVersion !== 2) return base;
  const { meta, errors } = normalizeAgentMeta(raw, {
    mockWriterRoles: MOCK_WRITER_ROLES,
    warn: (msg) => console.warn(msg),
  });
  if (errors.length) {
    console.warn(`[agent-registry] sidecar "${key}" declares metaVersion 2 but is invalid; skipped: ${errors.join('; ')}`);
    return null;
  }
  const merged = {
    ...base,
    metaVersion: 2,
    inputs: meta.inputs,
    outputs: meta.outputs,
    portSummary: meta.portSummary,
  };
  for (const field of ['verdict', 'sideEffect', 'mockRole', 'wantsRequest', 'workspaceFanOut',
    'workspaceStrategy', 'workspaceVariantOf', 'placeable']) {
    if (field in meta) merged[field] = meta[field];
  }
  return merged;
```
- [ ] Step 3: Implement — `src/core/graph/registry-ports.mjs`
```js
// src/core/graph/registry-ports.mjs
// Engine-side glue: a loaded agent registry -> the shared portsFn. Lives in
// src/core (not src/shared) because it exists only to bridge the Node-side
// registry shape; the resolution logic itself is shared.
import { portsFnFor } from '../../shared/graph/ports.mjs';
import { indexByKey } from '../../shared/graph/agent-meta.mjs';

/** @param {Record<string,object>|object[]} registry loadAgentRegistry() output (or a list) */
export function registryPortsFn(registry) {
  const list = Array.isArray(registry) ? registry : Object.values(registry || {});
  return portsFnFor(indexByKey(list));
}
```
- [ ] Step 4: Implement — `test/helpers/graph-ports.mjs`
```js
// test/helpers/graph-ports.mjs
// THE test port source: the REAL agents/*.meta.json, never a copied fixture
// table. A drifting sidecar must break the tests that depend on its ports —
// that is the whole point of the seed drift guard.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { portsFnFor } from '../../src/shared/graph/ports.mjs';
import { indexByKey, normalizeAgentMeta } from '../../src/shared/graph/agent-meta.mjs';
import { MOCK_WRITER_ROLES } from '../../src/core/claude-runner.mjs';

const AGENTS_DIR = fileURLToPath(new URL('../../agents/', import.meta.url));

/** Every builtin sidecar, normalized. Throws (loudly, with the rule text) when
 *  one is invalid — a broken builtin must never silently degrade a test. */
export function realAgentMetas() {
  return readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.meta.json')).sort().map((f) => {
    const raw = JSON.parse(readFileSync(join(AGENTS_DIR, f), 'utf8'));
    const { meta, errors } = normalizeAgentMeta(raw, { mockWriterRoles: MOCK_WRITER_ROLES, warn: () => {} });
    if (errors.length) throw new Error(`agents/${f}: ${errors.join('; ')}`);
    return meta;
  });
}

export function realRegistryIndex() {
  return indexByKey(realAgentMetas());
}

export function realPortsFn() {
  return portsFnFor(realRegistryIndex());
}
```
`Expected: PASS — 6 tests passing` (4 new in `agent-registry-schema-v2` replacing 1 deleted, 2 in `graph-registry-ports`), and `node --test test/agent-registry.test.mjs test/agent-registry-decomposer.test.mjs test/agent-registry-workspace.test.mjs test/agent-registry-layered.test.mjs test/agent-registry-desc-fallback.test.mjs test/agents-meta.test.mjs test/api-agents.test.mjs` stays green (those suites deepEqual only v1 fields).
- [ ] Step 5: Verify `GET /api/agents` needs NO edit — the v2 fields must ride through untouched:
```bash
node --test test/api-agents.test.mjs
grep -n "res.json({ agents" ui/server.mjs        # :3913 — objects pass through; no field list to update
```
  State in the commit body that `ui/server.mjs:3907-3913` was verified unchanged (`channels` → `mockWriterRoles` is P7's swap).
- [ ] Step 6: Commit — `worca: Node-graph v2 P2 — registry merges meta v2 and exposes registryPortsFn`

---

### Task 11: `src/shared/graph/manifest.mjs` — the run-start snapshot (manifest v2)

**Files:** create `src/shared/graph/manifest.mjs`, `test/graph-manifest.test.mjs`. New code (the old branch had no manifest builder).

The manifest is built ONCE at run start (and by `resume()`), persisted as `pipelines.stepper`, and NEVER rewritten mid-run. It must be SELF-SUFFICIENT: History renders it with the registry absent or edited. It also carries the coexistence SHIM — derived `steps` cells and `feedbacks` in `buildStepperManifest`'s exact v1 shape (`workflows.mjs:468-500`) — so `manifestFor`, `buildRunGraph`, `locateInManifest`, `advanceRun` and the CLI keep working untouched until P6/P8. `UI_PHASE` is COPIED here from `workflows.mjs:385-390` because shared code may not import `workflows.mjs`.

**Interfaces produced:** `buildGraphManifest(tpl, agentsByKey, {overlays} = {}) → manifest`, `manifestPortsFn(manifest) → portsFn`, `manifestTemplate(manifest) → template`, `UI_PHASE`.
**Manifest shape:** `{version:2, template:{id,name}, graph:{nodes:[{id,kind,key,x,y,label,uiPhase,ports:{inputs:[{id,type,required,loop,expands}],outputs:[{id,type,when}],await:boolean}, color?,icon?,model?,effort?,askQuestions?,awaitAll?, arity?}], wires:[{id,from,to,loop,maxCycles?}]}, bookends:{preflight:true,done:true}, steps:[…v1 cells], feedbacks:[{id,from,to,maxCycles}]}`. `ports.await` is a BOOLEAN and the await port is NOT listed under `inputs`; an OR's `out.type` is the RESOLVED type; `maxCycles` rides only `loop:true` wires (overlay merged); the icon is sanitized and dropped when > 2KB or when it carries script-ish markup.

- [ ] Step 1: Write the failing test — `test/graph-manifest.test.mjs`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphManifest, manifestPortsFn, manifestTemplate, UI_PHASE } from '../src/shared/graph/manifest.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';

const AGENTS = {
  planner: { key: 'planner', displayName: 'Planner', color: 'violet', icon: '<path d="M1 1"/>',
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  reviewer: { key: 'reviewer', displayName: 'Reviewer', color: 'blue', verdict: { filename: 'r.json' },
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
};
// Two reviewers fan their blocking arms through an OR valve back into the
// planner's loop input — the double-loop seed shape in miniature.
const TPL = { id: 'wf_t', name: 'T', version: 2, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 100, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 360, y: 100, config: { model: 'sonnet', awaitAll: true } },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 660, y: 100, config: {} },
    { id: 'n_rev2', kind: 'agent', key: 'reviewer', x: 660, y: 300, config: {} },
    { id: 'n_or', kind: 'or', x: 960, y: 430, config: { arity: 2 } },
    { id: 'n_end', kind: 'end', x: 1260, y: 100, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
    { id: 'w3', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: 3 } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev2', port: 'plan' } },
    { id: 'w5', from: { node: 'n_rev2', port: 'review' }, to: { node: 'n_or', port: 'in2' }, config: { maxCycles: 3 } },
    { id: 'w6', from: { node: 'n_or', port: 'out' }, to: { node: 'n_plan', port: 'revise' } },
    { id: 'w7', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] };
const build = (over) => buildGraphManifest(TPL, AGENTS, over);

test('manifest head and node cells', () => {
  const m = build();
  assert.equal(m.version, 2);
  assert.deepEqual(m.template, { id: 'wf_t', name: 'T' });
  assert.deepEqual(m.bookends, { preflight: true, done: true });
  const plan = m.graph.nodes.find((n) => n.id === 'n_plan');
  assert.equal(plan.label, 'Planner');
  assert.equal(plan.color, 'violet');
  assert.equal(plan.uiPhase, 'plan');
  assert.equal(plan.model, 'sonnet');
  assert.equal(plan.awaitAll, true);
  assert.deepEqual(plan.ports.inputs, [{ id: 'task', type: 'md', required: true, loop: false, expands: false },
    { id: 'revise', type: 'md', required: false, loop: true, expands: false }]);
  assert.deepEqual(plan.ports.outputs, [{ id: 'plan', type: 'md', when: 'always' }]);
  assert.equal(plan.ports.await, true, 'a boolean — the await port is never listed under inputs');
  assert.equal(plan.ports.inputs.some((p) => p.id === 'await'), false);
});

test('flow nodes: key null, kind uiPhase, resolved or type, arity', () => {
  const m = build();
  const or = m.graph.nodes.find((n) => n.id === 'n_or');
  assert.equal(or.key, null);
  assert.equal(or.label, 'OR');
  assert.equal(or.uiPhase, 'or');
  assert.equal(or.arity, 2);
  assert.equal(or.ports.await, false);
  assert.equal(or.ports.outputs[0].type, 'md', 'or.out carries the RESOLVED payload type');
  assert.equal(m.graph.nodes.find((n) => n.id === 'n_end').label, 'End');
  assert.equal(m.graph.nodes.find((n) => n.id === 'n_task').label, 'Task');
});

test('wires carry loop + maxCycles, overlays win, plain wires carry none', () => {
  const m = build();
  const w3 = m.graph.wires.find((w) => w.id === 'w3');
  assert.equal(w3.loop, true);
  assert.equal(w3.maxCycles, 3);
  const w2 = m.graph.wires.find((w) => w.id === 'w2');
  assert.equal(w2.loop, false);
  assert.equal('maxCycles' in w2, false);
  const over = build({ overlays: { wires: { w3: { maxCycles: 7 } } } });
  assert.equal(over.graph.wires.find((w) => w.id === 'w3').maxCycles, 7);
  const bare = { ...TPL, wires: TPL.wires.map((w) => (w.id === 'w3' ? { id: w.id, from: w.from, to: w.to } : w)) };
  assert.equal(buildGraphManifest(bare, AGENTS).graph.wires.find((w) => w.id === 'w3').maxCycles, 3, 'default');
});

test('node overlays win over template config', () => {
  const m = build({ overlays: { nodes: { n_plan: { model: 'opus', effort: 'high', askQuestions: true } } } });
  const plan = m.graph.nodes.find((n) => n.id === 'n_plan');
  assert.equal(plan.model, 'opus');
  assert.equal(plan.effort, 'high');
  assert.equal(plan.askQuestions, true);
});

test('the icon is sanitized and dropped when oversized or script-ish', () => {
  const evil = { ...AGENTS, planner: { ...AGENTS.planner, icon: '<path onload="x()"/>' } };
  assert.equal(buildGraphManifest(TPL, evil).graph.nodes.find((n) => n.id === 'n_plan').icon, '');
  const huge = { ...AGENTS, planner: { ...AGENTS.planner, icon: `<path d="${'M'.repeat(2100)}"/>` } };
  assert.equal(buildGraphManifest(TPL, huge).graph.nodes.find((n) => n.id === 'n_plan').icon, '');
  assert.equal(build().graph.nodes.find((n) => n.id === 'n_plan').icon, '<path d="M1 1"/>');
});

test('the v1 shim cells reproduce buildStepperManifest exactly', () => {
  const m = build();
  assert.equal(m.steps[0].kind, 'preflight');
  assert.deepEqual(m.steps[0].nodes, [{ id: 'preflight', label: 'Preflight', sub: 'checks' }]);
  assert.equal(m.steps.at(-1).kind, 'done');
  assert.deepEqual(m.steps.at(-1).nodes, [{ id: 'done', label: 'Done', sub: 'complete' }]);
  const cells = m.steps.slice(1, -1);
  assert.ok(cells.every((c) => c.kind === 'agents'));
  // One cell per rank (loop wires excluded), nodes in launch order inside a cell.
  // The OR has no forward predecessor — both its in-wires are loop wires — so it
  // ranks 0 beside the task node.
  assert.deepEqual(cells.map((c) => c.nodes.map((n) => n.id)),
    [['n_task', 'n_or'], ['n_plan'], ['n_rev', 'n_rev2'], ['n_end']]);
  const planCell = cells[1].nodes[0];
  assert.deepEqual(Object.keys(planCell),
    ['id', 'key', 'uiPhase', 'label', 'color', 'sub', 'cycles', 'model', 'effort']);
  assert.equal(planCell.cycles, true, 'the planner has a WIRED loop input');
  assert.equal(cells[2].nodes[0].cycles, false);
  assert.equal(cells[0].nodes[1].key, null, 'flow nodes ride the shim cells too');
});

test('feedbacks mirror the loop wires', () => {
  assert.deepEqual(build().feedbacks, [{ id: 'w3', from: 'n_rev', to: 'n_or', maxCycles: 3 },
    { id: 'w5', from: 'n_rev2', to: 'n_or', maxCycles: 3 }]);
  assert.deepEqual(build({ overlays: { wires: { w3: { maxCycles: 5 } } } }).feedbacks[0],
    { id: 'w3', from: 'n_rev', to: 'n_or', maxCycles: 5 });
});

test('manifestPortsFn + manifestTemplate round-trip the graph WITHOUT the registry', () => {
  const m = build();
  const tpl = manifestTemplate(m);
  assert.equal(tpl.version, 2);
  assert.deepEqual(tpl.nodes.map((n) => n.id), TPL.nodes.map((n) => n.id));
  assert.deepEqual(tpl.wires.map((w) => w.id), TPL.wires.map((w) => w.id));
  const portsFn = manifestPortsFn(m);
  assert.deepEqual(portsFn(tpl.nodes[1]).inputs.map((p) => p.id), ['task', 'revise', 'await']);
  assert.equal(portsFn(tpl.nodes[1]).inputs.at(-1).synthetic, true);
  assert.equal(portsFn({ id: 'ghost', kind: 'agent', key: 'x' }), undefined);
  const r = validateGraph(tpl, portsFn);
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
});

test('UI_PHASE is the v1 map', () => {
  assert.equal(UI_PHASE.planner, 'plan');
  assert.equal(UI_PHASE.workspaceReviewer, 'review');
  assert.equal(UI_PHASE.manualWebUiTesting, 'manual-web');
  assert.equal(UI_PHASE.nope, undefined);
});
```
`Expected: FAIL — Cannot find module '.../src/shared/graph/manifest.mjs'`

- [ ] Step 2: Implement — `src/shared/graph/manifest.mjs`
```js
// src/shared/graph/manifest.mjs
// The run-start snapshot persisted as pipelines.stepper. SELF-SUFFICIENT by
// design: History renders it when the registry is gone or edited, so nothing
// here may be re-resolved later. Built once per run (and by resume()), NEVER
// rewritten mid-run — fan-out lives in the execution ledger, not the manifest.
//
// It also carries the coexistence SHIM: `steps` cells and `feedbacks` in the v1
// buildStepperManifest shape, so every unported v1 consumer keeps working until
// P8 deletes them. UI_PHASE is COPIED here (shared code may not import
// workflows.mjs); P8 deletes both copies together.
import { TEMPLATE_VERSION, AWAIT_PORT, DEFAULT_MAX_CYCLES } from './constants.mjs';
import { portsFnFor, portsOf, resolveOrOutType } from './ports.mjs';
import { classifyLoops } from './loops.mjs';
import { rankNodes } from './layout.mjs';

/** Agent key -> the v1 UI stepper bucket (workflows.mjs:385-390). */
export const UI_PHASE = Object.freeze({
  clarify: 'clarify',
  planner: 'plan', refiner: 'refine', decomposer: 'decompose', implementer: 'implement', reviewer: 'review',
  manualTestsChecklist: 'manual-checklist', manualWebUiTesting: 'manual-web', planReviewer: 'plan-review',
  workspaceReviewer: 'review',
});

const FLOW_LABEL = { task: 'Task', end: 'End', and: 'AND', or: 'OR', combine: 'Combine' };
const ICON_BAD = /<\s*\/?\s*(script|iframe|object|embed|foreignobject)\b|javascript:|\son[a-z]+\s*=/i;
const ICON_MAX = 2048;

/** Inline SVG markup rides the manifest into innerHTML, so anything script-ish
 *  or oversized is dropped whole (never truncated — a half tag is worse). */
function sanitizeIcon(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.length > ICON_MAX || ICON_BAD.test(s)) return '';
  return s;
}

/**
 * @param {object} tpl resolved v2 template
 * @param {Record<string,object>} agentsByKey merged registry metas
 * @param {{overlays?:{nodes?:object, wires?:object}}} [opts] effective per-node config + per-wire budgets
 */
export function buildGraphManifest(tpl, agentsByKey, opts = {}) {
  const overlays = opts.overlays || {};
  const nodeOverlays = overlays.nodes || {};
  const wireOverlays = overlays.wires || {};
  const portsFn = portsFnFor(agentsByKey);
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter(Boolean);
  const wires = (Array.isArray(tpl?.wires) ? tpl.wires : []).filter(Boolean);
  const loops = classifyLoops(tpl, portsFn);
  const ranks = rankNodes(tpl, loops);
  const launchIndex = new Map(loops.launchOrder.map((id, i) => [id, i]));
  const isWired = new Set(wires.map((w) => `${w?.to?.node}.${w?.to?.port}`));

  const manifestNodes = nodes.map((node) => {
    const resolved = portsOf(portsFn, node);
    const meta = node.kind === 'agent' ? (agentsByKey?.[node.key] || null) : null;
    const over = nodeOverlays[node.id] || {};
    const cfg = node.config || {};
    const outType = (port) => (node.kind === 'or' && (!port.type || port.type === 'any')
      ? (resolveOrOutType(tpl, portsFn, node.id) || 'any') : port.type);
    const cell = {
      id: node.id,
      kind: node.kind,
      key: node.kind === 'agent' ? node.key : null,
      x: Number(node.x) || 0,
      y: Number(node.y) || 0,
      label: node.kind === 'agent' ? (meta?.displayName || node.key) : (FLOW_LABEL[node.kind] || node.kind),
      uiPhase: node.kind === 'agent' ? (UI_PHASE[node.key] || node.key) : node.kind,
      ports: {
        inputs: resolved.inputs.filter((p) => !p.synthetic).map((p) => ({
          id: p.id, type: p.type, required: p.required !== false, loop: !!p.loop, expands: !!p.expands })),
        outputs: resolved.outputs.map((p) => ({ id: p.id, type: outType(p), when: p.when || 'always' })),
        await: resolved.inputs.some((p) => p.synthetic),
      },
    };
    if (node.kind === 'agent') {
      cell.color = meta?.color || '';
      cell.icon = sanitizeIcon(meta?.icon);
      cell.model = over.model ?? cfg.model ?? '';
      cell.effort = over.effort ?? cfg.effort ?? '';
      cell.askQuestions = !!(over.askQuestions ?? cfg.askQuestions ?? meta?.questionsDefault ?? false);
      cell.awaitAll = !!(over.awaitAll ?? cfg.awaitAll ?? false);
      cell.fanOut = !!(over.fanOut ?? cfg.fanOut ?? meta?.fanOut ?? false);
    }
    if (node.kind === 'and' || node.kind === 'or' || node.kind === 'combine') {
      cell.arity = Number.isInteger(cfg.arity) ? cfg.arity : 2;
    }
    return cell;
  });

  const manifestWires = wires.map((w) => {
    const loop = loops.loopWireIds.has(w.id);
    const cell = { id: w.id, from: { node: w.from.node, port: w.from.port },
      to: { node: w.to.node, port: w.to.port }, loop };
    // maxCycles rides LOOP wires only: overlay > authored > default.
    if (loop) cell.maxCycles = coerceCycles(wireOverlays[w.id]?.maxCycles ?? w.config?.maxCycles);
    return cell;
  });

  // ── the v1 shim (P4-P7; deleted in P8) ─────────────────────────────────────
  const byRank = new Map();
  for (const node of manifestNodes) {
    const r = ranks[node.id] ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(node);
  }
  const agentCells = [...byRank.keys()].sort((a, b) => a - b).map((r) => ({
    kind: 'agents',
    nodes: byRank.get(r)
      .sort((a, b) => (launchIndex.get(a.id) ?? 0) - (launchIndex.get(b.id) ?? 0))
      .map((n) => ({
        id: n.id,
        key: n.key,
        uiPhase: n.uiPhase,
        label: n.label,
        color: n.color || '',
        sub: (n.key && agentsByKey?.[n.key]?.description) || '',
        cycles: n.ports.inputs.some((p) => p.loop && isWired.has(`${n.id}.${p.id}`)),
        model: n.model || '',
        effort: n.effort || '',
      })),
  }));

  return {
    version: 2,
    template: { id: tpl?.id ?? '', name: tpl?.name ?? '' },
    graph: { nodes: manifestNodes, wires: manifestWires },
    bookends: { preflight: true, done: true },
    steps: [
      { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
      ...agentCells,
      { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
    ],
    feedbacks: manifestWires.filter((w) => w.loop)
      .map((w) => ({ id: w.id, from: w.from.node, to: w.to.node, maxCycles: w.maxCycles })),
  };
}

function coerceCycles(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MAX_CYCLES;
}

/** A portsFn over a MANIFEST — the run monitor never touches the live registry.
 *  The await port is re-synthesized from the boolean so geometry, validation and
 *  hit-testing behave exactly as they do in the composer. */
export function manifestPortsFn(manifest) {
  const byId = new Map((manifest?.graph?.nodes || []).map((n) => [n.id, n]));
  return (node) => {
    const cell = byId.get(node?.id);
    if (!cell) return undefined;
    return {
      known: true,
      ported: true,
      inputs: cell.ports.await ? [...cell.ports.inputs, AWAIT_PORT] : [...cell.ports.inputs],
      outputs: [...cell.ports.outputs],
      displayName: cell.label,
      color: cell.color,
      icon: cell.icon,
      // A verdict-bearing node is one with a conditional output — enough for V13
      // and firedOutputs; the filename itself never leaves the engine.
      verdict: cell.ports.outputs.some((p) => p.when && p.when !== 'always') ? { filename: '' } : undefined,
    };
  };
}

/** The renderable template inside a manifest (id/kind/x/y/config + wires). */
export function manifestTemplate(manifest) {
  return {
    id: manifest?.template?.id ?? '',
    name: manifest?.template?.name ?? '',
    version: TEMPLATE_VERSION,
    domain: '',
    nodes: (manifest?.graph?.nodes || []).map((n) => {
      const node = { id: n.id, kind: n.kind, x: n.x, y: n.y, config: {} };
      if (n.kind === 'agent') node.key = n.key;
      if (n.arity !== undefined) node.config.arity = n.arity;
      if (n.awaitAll) node.config.awaitAll = true;
      return node;
    }),
    wires: (manifest?.graph?.wires || []).map((w) => {
      const wire = { id: w.id, from: { ...w.from }, to: { ...w.to } };
      if (w.loop && w.maxCycles !== undefined) wire.config = { maxCycles: w.maxCycles };
      return wire;
    }),
  };
}
```
`Expected: PASS — 9 tests passing`
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — graph manifest v2 with the v1 shim cells`

---

### Task 12: `ui/public/graph/model.mjs` + the single-source identity guard

**Files:** create `ui/public/graph/model.mjs`, `test/shared-graph-single-source.test.mjs`. P1's purity guard (`test/shared-graph-purity.test.mjs`) has a second test that walks every `ui/public` specifier leaving the static root; until now no such specifier existed, so this task gives it a REAL one — after this task, breaking the import convention fails that guard.

The browser resolves `../../../src/shared/graph/x.mjs` from `/graph/model.mjs` to `/src/shared/graph/x.mjs`, which is exactly where P1's mount serves it; Node resolves the same relative path on disk. Absolute specifiers (`/src/shared/...`) are FORBIDDEN — UI tests import `ui/public/*.mjs` as plain Node modules and would fail with `ERR_MODULE_NOT_FOUND`. No import map.

- [ ] Step 1: Write the failing test — `test/shared-graph-single-source.test.mjs`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as uiModel from '../ui/public/graph/model.mjs';
import * as validate from '../src/shared/graph/validate.mjs';
import * as ports from '../src/shared/graph/ports.mjs';
import * as template from '../src/shared/graph/template.mjs';
import * as geometry from '../src/shared/graph/geometry.mjs';
import * as loops from '../src/shared/graph/loops.mjs';
import * as layout from '../src/shared/graph/layout.mjs';
import * as thumbnail from '../src/shared/graph/thumbnail.mjs';
import * as agentMeta from '../src/shared/graph/agent-meta.mjs';
import * as manifest from '../src/shared/graph/manifest.mjs';

test('ui/public/graph/model.mjs re-exports the SHARED functions — same identity, no copy', () => {
  assert.equal(uiModel.validateGraph, validate.validateGraph);
  assert.equal(uiModel.formatIssue, validate.formatIssue);
  assert.equal(uiModel.portsFnFor, ports.portsFnFor);
  assert.equal(uiModel.portsOf, ports.portsOf);
  assert.equal(uiModel.canWire, template.canWire);
  assert.equal(uiModel.normalizeTemplate, template.normalizeTemplate);
  assert.equal(uiModel.newNode, template.newNode);
  assert.equal(uiModel.bezierPath, geometry.bezierPath);
  assert.equal(uiModel.nodeSize, geometry.nodeSize);
  assert.equal(uiModel.classifyLoops, loops.classifyLoops);
  assert.equal(uiModel.autoLayout, layout.autoLayout);
  assert.equal(uiModel.thumbnailSvg, thumbnail.thumbnailSvg);
  assert.equal(uiModel.indexByKey, agentMeta.indexByKey);
  assert.equal(uiModel.manifestPortsFn, manifest.manifestPortsFn);
});

test('model.mjs imports ONLY by relative path and carries the depth note', () => {
  const src = readFileSync(fileURLToPath(new URL('../ui/public/graph/model.mjs', import.meta.url)), 'utf8');
  const specs = [...src.matchAll(/from\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(specs.length >= 8);
  for (const s of specs) {
    assert.match(s, /^\.\.\/\.\.\/\.\.\/src\/shared\/graph\//, `"${s}" must walk up exactly three levels`);
  }
  assert.match(src, /depth 3/, 'the header states the depth so a moved file is caught by review');
});
```
`Expected: FAIL — Cannot find module '.../ui/public/graph/model.mjs'`
- [ ] Step 2: Implement — `ui/public/graph/model.mjs`
```js
// ui/public/graph/model.mjs                                          (depth 3)
// The browser's door to the ONE graph model. ui/public cannot import src/core,
// but src/shared/** is pure ESM served at /src/shared, so these specifiers
// resolve to the SAME module instance in Node, jsdom and Chrome alike: three
// `..` because this file sits three levels below the repo root. Absolute
// specifiers ('/src/shared/...') are FORBIDDEN — they break the Node ESM
// resolver the UI tests use. NOTHING may be redefined here: this file is
// re-exports only, and test/shared-graph-single-source.test.mjs asserts the
// function IDENTITY against the shared modules.
export {
  flowPorts, portsFnFor, portsOf, findPort, typeCompatible, resolveOrOutType,
  inboundWires, outboundWires, firedOutputs,
} from '../../../src/shared/graph/ports.mjs';
export { tarjanSccs, classifyLoops } from '../../../src/shared/graph/loops.mjs';
export { RULES, validateGraph, formatIssue } from '../../../src/shared/graph/validate.mjs';
export {
  normalizeTemplate, serializeTemplate, newNode, newWire, mintId, canWire,
  removeNode, removeWire, nodeById, wireById,
} from '../../../src/shared/graph/template.mjs';
export {
  NODE_W, HEAD_H, ROW_H, SEP_H, PAD_T, PAD_B, BORDER, DOT, FOOT_H, EXEC_ROW_H, SNAP,
  PORT_HIT_R, WIRE_HIT_TOL, ZOOM_MIN, ZOOM_MAX, ZOOM_K, ROW0, GEOMETRY_CSS_VARS,
  injectGeometry, nodeSize, portAnchor, bezierPath, bezierPoint, bezierMid, snap,
  hitNode, hitPort, hitWire, graphBounds, fitBounds,
} from '../../../src/shared/graph/geometry.mjs';
export { rankNodes, autoLayout } from '../../../src/shared/graph/layout.mjs';
export { thumbnailSvg } from '../../../src/shared/graph/thumbnail.mjs';
export { normalizeAgentMeta, validateMetaV2, indexByKey, derivePortSummary } from '../../../src/shared/graph/agent-meta.mjs';
export { buildGraphManifest, manifestPortsFn, manifestTemplate, UI_PHASE } from '../../../src/shared/graph/manifest.mjs';
export {
  TEMPLATE_VERSION, KINDS, FLOW_KINDS, PORT_TYPES, AWAIT_PORT, TASK_PORTS, END_PORTS,
  gatePorts, DEFAULT_MAX_CYCLES, MAX_PORTS_PER_SIDE, LIMITS,
} from '../../../src/shared/graph/constants.mjs';
```
  (If P1's `constants.mjs` does not export one of the names in the last block, drop that name from the re-export list — Task 0 Step 4 already told you which exist.)
`Expected: PASS — 2 tests passing`; `node --test test/shared-graph-purity.test.mjs test/api-shared-static.test.mjs` stays green (the purity guard now has a real specifier to check, and the static mount serves every new shared file).
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — browser re-export door and the single-source guard`

---

### Task 13: seed drift guard — all 8 graphs validate 0/0 against the REAL sidecars

**Files:** modify `test/graph-seed-templates.test.mjs` (P1 created it with the structural pins; this task APPENDS — do not touch its existing tests). This is the guard that ties the seeds, the validator and the ported sidecars together: if a sidecar's ports drift, or a rule's scope changes, or a seed is edited, exactly one of these three assertions breaks.

Measured on 2026-08-26 against the real (ported) sidecars — every one of the 8 graphs yields **0 errors and 0 warnings**, and the loop wires are exactly the wires `FB_WIRE_MAP` names:

| template | nodes/wires | loop wire ids |
|---|---|---|
| wf_full | 11/17 | w5, w12, w15 |
| wf_no-clarify | 9/13 | w3, w10 |
| wf_provided-plan | 9/14 | w2, w9, w12 |
| wf_full-no-decompose | 10/15 | w5, w10, w13 |
| wf_quick-fix | 5/6 | w5 |
| wf_clarify-implement | 7/10 | w5, w9 |
| wf_clarify-quick-fix | 6/8 | w7 |
| wf_default (GRAPH_DEFAULT_WORKFLOW) | 7/10 | w5, w9 |

Zero warnings is only reachable because of four exemptions — V18(a) task-sourced, V18(b) void, V18(c) `await`, V18(d) loop inputs — and V19's OR/AND/End/await exemption. If a warning appears here, do NOT loosen a rule: the seed or the sidecar is wrong.

- [ ] Step 1: Write the failing test — append to `test/graph-seed-templates.test.mjs`
```js
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { classifyLoops } from '../src/shared/graph/loops.mjs';
import { realPortsFn } from './helpers/graph-ports.mjs';

const LOOP_WIRES = {
  'wf_full': ['w12', 'w15', 'w5'],
  'wf_no-clarify': ['w10', 'w3'],
  'wf_provided-plan': ['w12', 'w2', 'w9'],
  'wf_full-no-decompose': ['w10', 'w13', 'w5'],
  'wf_quick-fix': ['w5'],
  'wf_clarify-implement': ['w5', 'w9'],
  'wf_clarify-quick-fix': ['w7'],
  'wf_default': ['w5', 'w9'],
};
const allGraphs = () => [...SEED_TEMPLATES, GRAPH_DEFAULT_WORKFLOW];

test('every seed graph validates against the REAL sidecars: 0 errors, 0 warnings', () => {
  const portsFn = realPortsFn();
  const graphs = allGraphs();
  assert.equal(graphs.length, 8);
  for (const tpl of graphs) {
    const { ok, errors, warnings } = validateGraph(tpl, portsFn);
    assert.deepEqual(errors, [], `${tpl.id} errors: ${JSON.stringify(errors, null, 1)}`);
    assert.deepEqual(warnings, [], `${tpl.id} warnings: ${JSON.stringify(warnings, null, 1)}`);
    assert.equal(ok, true);
  }
});

test('loop wires are exactly the budgeted feedback wires (Amendment f pins)', () => {
  const portsFn = realPortsFn();
  for (const tpl of allGraphs()) {
    const { loopWireIds } = classifyLoops(tpl, portsFn);
    assert.deepEqual([...loopWireIds].sort(), LOOP_WIRES[tpl.id], `${tpl.id} loop wires`);
    // Every loop wire carries a budget and no plain wire does (V13's placement rule).
    for (const w of tpl.wires) {
      const budgeted = w.config && w.config.maxCycles !== undefined;
      assert.equal(budgeted, loopWireIds.has(w.id), `${tpl.id}.${w.id} budget placement`);
    }
  }
});

test('FB_WIRE_MAP names exactly the loop wires of each seed', () => {
  const portsFn = realPortsFn();
  for (const tpl of SEED_TEMPLATES) {
    const mapped = Object.values(FB_WIRE_MAP[tpl.id] || {}).sort();
    assert.deepEqual(mapped, [...classifyLoops(tpl, portsFn).loopWireIds].sort(), tpl.id);
  }
  assert.deepEqual(Object.values(FB_WIRE_MAP.wf_default).sort(),
    [...classifyLoops(GRAPH_DEFAULT_WORKFLOW, realPortsFn()).loopWireIds].sort());
});
```
  (`SEED_TEMPLATES`, `FB_WIRE_MAP` and `GRAPH_DEFAULT_WORKFLOW` are already imported by P1's version of this file; add only the three new imports. If P1 imported them under different local names, use those.)
`Expected: FAIL — Cannot find module './helpers/graph-ports.mjs'` before Task 10, and after it a real diff if any sidecar or seed drifted.
- [ ] Step 2: Run `node --test test/graph-seed-templates.test.mjs`.
`Expected: PASS — 3 new tests passing` (plus P1's existing ones). If a seed reports an error, the FIRST suspects are: a sidecar port id that does not match the seed's wire (`V5`), a `maxCycles` on a non-loop wire (`V13`), or a missing `metaVersion: 2` (`V4`).
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — seed drift guard against the real sidecars`

---

### Task 14: P2a full suite, count, commit

- [ ] Step 1: `npm test 2>&1 | tail -5`
`Expected: BASELINE + 97 passing, 0 failing` — the 97 net-new P2a tests are: graph-ports 8, graph-loops 7, graph-validate 23, graph-template 10, graph-geometry 10, graph-layout 5, graph-thumbnail 2, graph-agent-meta 11, mock-writer-roles 2, agent-registry-schema-v2 +3 (4 added − 1 deleted), graph-registry-ports 2, graph-manifest 9, shared-graph-single-source 2, graph-seed-templates +3. If your count differs, reconcile BEFORE committing — a missing test is a missing rule.
- [ ] Step 2: Purity + static-serving guards specifically: `node --test test/shared-graph-purity.test.mjs test/api-shared-static.test.mjs`
`Expected: PASS` (every new `src/shared/graph/*.mjs` is pure and GETs 200 `application/javascript` with nosniff).
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — P2a green (shared core + sidecars)`

### — split point: P2b starts here —


> **P2b entry note.** P2b depends on P2a ONLY through `validateGraph` (the 422 body) and `TEMPLATE_VERSION`. It does NOT depend on P1's harness split. If you are executing P2b as its own pipeline run, start at Task B0.

### Task B0: P2b entry check (branch, deps, P2a sentinel, baseline)

- [ ] Step 1: `git rev-parse --abbrev-ref HEAD` — the pipeline's branch (by hand: `worca-cc/node-graph-v2-p2` off dev, created OUTSIDE the run). Never `git checkout dev`.
- [ ] Step 2: `[ -d node_modules ] || npm ci`
- [ ] Step 3: P2a sentinel — STOP if this fails:
```bash
grep -q "export function validateGraph" src/shared/graph/validate.mjs \
  && grep -q "export const MOCK_WRITER_ROLES" src/core/claude-runner.mjs \
  && grep -q '"metaVersion": 2' agents/planner.meta.json && echo P2a-OK
```
- [ ] Step 4: `npm test 2>&1 | tail -5` — record the pass count as BASELINE-B (must be green).

---

### Task B1: DB **V23** — additive schema, `SCHEMA_VERSION` 22 → 23

**Files:** modify `src/core/db.mjs` (`SCHEMA_VERSION` `:56`, `INCREMENTAL_COLUMNS` `:732-745`, `INCREMENTAL_TABLES` `:752-766`, the ladder `:1051-1073`), `test/db.test.mjs` (`EXPECTED_TABLES` `:74-92`, the 18-table assertion `:126`), create `test/db-migrate-v23.test.mjs`.

Every DDL is additive and reconcile-safe: columns go through `INCREMENTAL_COLUMNS` and the table through `INCREMENTAL_TABLES`, so `schemaGaps`/`repairSchemaGaps` heal a DB that a divergent ladder already stamped (`db.mjs:725-760` are those maps; `:845` is `reconcileSchema`, the fast-path heal). No data rewrite, no backup — that is V24's job in P8.
```sql
ALTER TABLE workflows ADD COLUMN graph TEXT;            -- JSON {nodes, wires, canvas?}; NULL on v1 rows
ALTER TABLE workflows ADD COLUMN archived_at TEXT;      -- ISO; NULL = live
CREATE TABLE IF NOT EXISTS config_workflow_wires (
  project_key TEXT NOT NULL, workflow_id TEXT NOT NULL, wire_id TEXT NOT NULL,
  max_cycles INTEGER NOT NULL, PRIMARY KEY (project_key, workflow_id, wire_id));
ALTER TABLE pipeline_steps ADD COLUMN execution_id TEXT;   -- + exec_kind, agent_key, ended_at,
                                                           --   exec_trigger, exec_result, exec_meta
ALTER TABLE pipelines ADD COLUMN outcome TEXT;             -- JSON {endReached, result, warnings, …}
```
The user's live DB already carries `workflows.graph`, `config_workflow_wires` (with the PK columns in the OLD order `(workflow_id, project_key, wire_id)`), `pipeline_steps.execution_id/exec_result/exec_trigger` and `pipelines.outcome` as old-branch residue. Gap-healing makes that safe: `CREATE TABLE IF NOT EXISTS` leaves the existing table alone (the PK column ORDER is irrelevant — every statement names its columns) and `missingColumns` skips a column that is already there.

- [ ] Step 1: Write the failing test — `test/db-migrate-v23.test.mjs`
```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

useTempHome(after);

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const tableNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
const pkOrder = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all()
  .filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
const MINIMAL_SEED = `
  CREATE TABLE pipelines (id TEXT PRIMARY KEY);
  CREATE TABLE pipeline_steps (pipeline_id TEXT);
  CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
`;

test('V23 is the current schema version and a fresh DB carries every new column', () => {
  const db = getDb();
  assert.equal(SCHEMA_VERSION, 23);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 23);
  for (const c of ['graph', 'archived_at']) assert.ok(cols(db, 'workflows').includes(c), `workflows.${c}`);
  for (const c of ['execution_id', 'exec_kind', 'agent_key', 'ended_at', 'exec_trigger', 'exec_result', 'exec_meta']) {
    assert.ok(cols(db, 'pipeline_steps').includes(c), `pipeline_steps.${c}`);
  }
  assert.ok(cols(db, 'pipelines').includes('outcome'));
  assert.ok(tableNames(db).includes('config_workflow_wires'));
  assert.deepEqual(pkOrder(db, 'config_workflow_wires'), ['project_key', 'workflow_id', 'wire_id']);
});

test('ladder: a v22 DB is stamped 23 and gets the columns + the wires table', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec('PRAGMA user_version = 22');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 23);
  assert.ok(cols(db, 'workflows').includes('archived_at'));
  assert.ok(cols(db, 'pipeline_steps').includes('exec_meta'));
  assert.ok(tableNames(db).includes('config_workflow_wires'));
});

// The user's live DB shape: old-branch residue already present, stamped 22, with
// config_workflow_wires in the OLD PK column order. Migrating must be a no-op on
// what exists, must not throw on the duplicate ALTERs, and must stamp 23.
test('gap-heal: old-branch residue migrates cleanly and is left byte-alone', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec(`
    ALTER TABLE workflows ADD COLUMN graph TEXT;
    ALTER TABLE pipeline_steps ADD COLUMN execution_id TEXT;
    ALTER TABLE pipeline_steps ADD COLUMN exec_result TEXT;
    ALTER TABLE pipeline_steps ADD COLUMN exec_trigger TEXT;
    ALTER TABLE pipelines ADD COLUMN outcome TEXT;
    CREATE TABLE config_workflow_wires (
      workflow_id TEXT NOT NULL, project_key TEXT NOT NULL, wire_id TEXT NOT NULL,
      max_cycles INTEGER NOT NULL, PRIMARY KEY (workflow_id, project_key, wire_id));
  `);
  db.prepare('INSERT INTO config_workflow_wires (project_key, workflow_id, wire_id, max_cycles) VALUES (?,?,?,?)')
    .run('proj', 'wf_no-clarify', 'w3', 6);
  db.exec('PRAGMA user_version = 22');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 23);
  assert.deepEqual(pkOrder(db, 'config_workflow_wires'), ['workflow_id', 'project_key', 'wire_id'],
    'the residue table is NOT rewritten — every statement names its columns');
  assert.equal(db.prepare('SELECT max_cycles FROM config_workflow_wires WHERE wire_id = ?').get('w3').max_cycles, 6);
  const stepCols = cols(db, 'pipeline_steps');
  assert.equal(stepCols.filter((c) => c === 'execution_id').length, 1, 'no duplicate ALTER');
  for (const c of ['exec_kind', 'agent_key', 'ended_at', 'exec_meta']) assert.ok(stepCols.includes(c), c);
  assert.ok(cols(db, 'workflows').includes('archived_at'));
  migrate(db);                                   // idempotent: second pass is a clean no-op
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 23);
});

test('self-heal: a DB stamped 23 but missing a v23 column is repaired without a re-stamp', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec('PRAGMA user_version = 22');
  migrate(db);
  db.exec('ALTER TABLE pipelines DROP COLUMN outcome');
  db.exec('DROP TABLE config_workflow_wires');
  migrate(db);                                   // fast path -> reconcileSchema
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 23, 'stamp untouched');
  assert.ok(cols(db, 'pipelines').includes('outcome'), 'column healed');
  assert.ok(tableNames(db).includes('config_workflow_wires'), 'table healed');
});
```
`Expected: FAIL — AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 22 !== 23`

- [ ] Step 2: Implement — `src/core/db.mjs`
  1. `export const SCHEMA_VERSION = 23;` (`:56`).
  2. Add the DDL constant beside the other table DDLs (anywhere above `INCREMENTAL_TABLES`):
```js
/** v23: per-loop-wire cycle budgets, the graph-engine twin of
 *  config_workflow_feedbacks (which becomes vestigial at the v1 kill list, never
 *  dropped). IF NOT EXISTS + an INCREMENTAL_TABLES entry: some DBs already carry
 *  this table from an earlier branch, with the PK columns in a different ORDER —
 *  harmless, because every statement names its columns. */
const CONFIG_WORKFLOW_WIRES_DDL = `
CREATE TABLE IF NOT EXISTS config_workflow_wires (
  project_key  TEXT NOT NULL,
  workflow_id  TEXT NOT NULL,
  wire_id      TEXT NOT NULL,
  max_cycles   INTEGER NOT NULL,
  PRIMARY KEY (project_key, workflow_id, wire_id)
);
`;
```
  3. Extend `INCREMENTAL_COLUMNS` (`:732`) — add to the EXISTING entries, do not reorder:
```js
  pipelines:              { …existing…, outcome: 'TEXT' },
  pipeline_steps:         { session_id: 'TEXT', skills: 'TEXT', graphify_count: 'INTEGER',
                            execution_id: 'TEXT', exec_kind: 'TEXT', agent_key: 'TEXT', ended_at: 'TEXT',
                            exec_trigger: 'TEXT', exec_result: 'TEXT', exec_meta: 'TEXT' },
  workflows:              { domain: 'TEXT', origin: 'TEXT', graph: 'TEXT', archived_at: 'TEXT' },
```
  4. Extend `INCREMENTAL_TABLES` (`:752`): `config_workflow_wires: CONFIG_WORKFLOW_WIRES_DDL,`.
  5. Add the ladder step after `if (current < 22) applySchemaV22(db);` (`:1072`): `if (current < 23) applySchemaV23(db);   // graph columns + config_workflow_wires` and the function beside `applySchemaV22`:
```js
/** v23 (node-graph v2): workflows.graph/archived_at, the pipeline_steps execution
 *  ledger columns, pipelines.outcome and config_workflow_wires. Every piece lives
 *  in INCREMENTAL_COLUMNS/INCREMENTAL_TABLES, so the whole step IS the reconcile —
 *  the applySchemaV22 shape, with nothing to backfill. Purely additive: no row is
 *  read, rewritten or archived here (that is the v24 break). */
function applySchemaV23(db) {
  repairSchemaGaps(db, schemaGaps(db));
}
```
- [ ] Step 3: Implement — `test/db.test.mjs`: add `'config_workflow_wires',` to `EXPECTED_TABLES` (after `'config_workflow_feedbacks'`), change `assert.equal(EXPECTED_TABLES.length, 18, …)` to `19` with the message `'the spec defines exactly 19 tables (v23: +config_workflow_wires)'`, and retitle the test `migrate creates all 19 spec tables`.
- [ ] Step 4: Version-pin sweep — no test may pin the OLD number. Run BEFORE and AFTER:
```bash
grep -rn -A1 "user_version" test/*.mjs | grep -w 22 | grep -v db-migrate-v23
```
`Expected: empty output both times` (the only two hits are comments in `ask-db-schema.test.mjs:80` / `diff-comments-schema.test.mjs:72`, which read `17 -> 22` — update those comments to `17 -> 23` in this task; they are prose, not assertions).
- [ ] Step 5: `node --test test/db-migrate-v23.test.mjs test/db.test.mjs test/ask-db-schema.test.mjs test/diff-comments-schema.test.mjs test/migrate-fs-to-db.test.mjs test/upgrade-integration.test.mjs`
`Expected: PASS — 4 new tests passing; every other suite unchanged` (tests that stamp 15–21 on a minimal seed now run the v23 step too: it is a column-guarded no-op).
- [ ] Step 6: Commit — `worca: Node-graph v2 P2 — DB v23 additive schema`

---

### Task B2: `workflows.mjs` — v2 rows, archiving, `assertRunnableWorkflow`

**Files:** modify `src/core/workflows.mjs` (`rowToTpl :206`, `readRaw :221`, `writeWorkflow :239`, `readWorkflow :277`, `listWorkflows :287`, `resolveWorkflow :371`), create `test/workflows-graph-rows.test.mjs`.

**Interfaces produced:**
- `rowToTpl(r)` — base fields + `archivedAt`; `version === 2` ⇒ `+{nodes, wires, canvas?}` parsed from `graph`; else `+{steps, feedbacks}`. `graph` holds `{nodes, wires, canvas?}` ONLY (id/name/domain/origin stay row columns, so a rename can never drift).
- `writeGraphWorkflow({id?, name, domain?, origin?, nodes, wires, canvas?}) → tpl` — UPSERT with `version = 2, steps = '[]', feedbacks = '[]', archived_at = NULL` (saving over an archived id UN-archives it). Id rule: `body.id` when it matches `SAFE_WORKFLOW_ID` **and** is neither `wf_default` nor `wf_default_v2`, else `wf_${slugify(name)}`.
- `listWorkflows({includeArchived = false} = {})` — `WHERE archived_at IS NULL` by default, both versions returned with `version` visible.
- `readWorkflow(id, {includeArchived = false} = {})` — `null` for an archived row.
- `assertRunnableWorkflow(id) → template`, throwing `Object.assign(new Error(msg), {code})` with `code: 'NOT_FOUND' | 'ARCHIVED'`. ARCHIVED message VERBATIM: `workflow "<id>" was archived by the v2 upgrade (v1 template, not runnable) — pick a v2 pipeline or rebuild it in the Composer`. NOT_FOUND message: `unknown workflowId "<id>"` (the string `POST /api/run` already returns today).
- `resolveWorkflow` (`:371`) throws `template is a graph — runs on the graph engine` when the row is `version === 2` (checked right after the `if (!tpl)` guard).

- [ ] Step 1: Write the failing test — `test/workflows-graph-rows.test.mjs`
```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import {
  writeWorkflow, writeGraphWorkflow, readWorkflow, listWorkflows,
  assertRunnableWorkflow, resolveWorkflow, DEFAULT_WORKFLOW,
} from '../src/core/workflows.mjs';

useTempHome(after);

const GRAPH = {
  name: 'Graph One', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 300, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_end', port: 'result' } }],
};
const archive = (id) => { getDb(); prepare('UPDATE workflows SET archived_at = ? WHERE id = ?').run('2026-08-27T00:00:00Z', id); };

test('writeGraphWorkflow stores version 2 with graph JSON and empty v1 columns', async () => {
  const saved = await writeGraphWorkflow(GRAPH);
  assert.equal(saved.id, 'wf_graph-one');
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.nodes.map((n) => n.id), ['n_task', 'n_end']);
  const row = prepare('SELECT version, graph, steps, feedbacks, archived_at FROM workflows WHERE id = ?').get(saved.id);
  assert.equal(row.version, 2);
  assert.deepEqual(Object.keys(JSON.parse(row.graph)).sort(), ['nodes', 'wires']);
  assert.equal(row.steps, '[]');
  assert.equal(row.feedbacks, '[]');
  assert.equal(row.archived_at, null);
});

test('the id rule: an explicit safe id wins, the reserved ids never do', async () => {
  assert.equal((await writeGraphWorkflow({ ...GRAPH, id: 'wf_custom' })).id, 'wf_custom');
  assert.equal((await writeGraphWorkflow({ ...GRAPH, id: 'wf_default' })).id, 'wf_graph-one');
  assert.equal((await writeGraphWorkflow({ ...GRAPH, id: 'wf_default_v2' })).id, 'wf_graph-one');
  assert.equal((await writeGraphWorkflow({ ...GRAPH, id: '../escape' })).id, 'wf_graph-one');
});

test('rowToTpl is version-aware: v2 rows carry nodes/wires, v1 rows steps/feedbacks', async () => {
  const v2 = await readWorkflow((await writeGraphWorkflow({ ...GRAPH, id: 'wf_v2' })).id);
  assert.equal(v2.version, 2);
  assert.equal('steps' in v2, false);
  assert.ok(Array.isArray(v2.wires));
  const v1 = await writeWorkflow({ name: 'Legacy', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  const back = await readWorkflow(v1.id);
  assert.equal(back.version, 1);
  assert.ok(Array.isArray(back.steps));
  assert.equal('nodes' in back, false);
});

test('archiving hides a row from readWorkflow and listWorkflows', async () => {
  const saved = await writeGraphWorkflow({ ...GRAPH, id: 'wf_arch' });
  archive(saved.id);
  assert.equal(await readWorkflow(saved.id), null);
  assert.equal((await readWorkflow(saved.id, { includeArchived: true })).id, saved.id);
  assert.equal((await listWorkflows()).some((w) => w.id === saved.id), false);
  assert.equal((await listWorkflows({ includeArchived: true })).some((w) => w.id === saved.id), true);
  const again = await writeGraphWorkflow({ ...GRAPH, id: 'wf_arch' });
  assert.equal(again.id, 'wf_arch');
  assert.equal((await readWorkflow('wf_arch')).id, 'wf_arch', 'saving over an archived id un-archives it');
});

test('assertRunnableWorkflow: NOT_FOUND, ARCHIVED (verbatim), and the happy path', async () => {
  const saved = await writeGraphWorkflow({ ...GRAPH, id: 'wf_run' });
  assert.equal((await assertRunnableWorkflow(saved.id)).id, 'wf_run');
  assert.equal((await assertRunnableWorkflow(DEFAULT_WORKFLOW.id)).id, DEFAULT_WORKFLOW.id);
  await assert.rejects(() => assertRunnableWorkflow('wf_ghost'), (e) => {
    assert.equal(e.code, 'NOT_FOUND');
    assert.equal(e.message, 'unknown workflowId "wf_ghost"');
    return true;
  });
  archive('wf_run');
  await assert.rejects(() => assertRunnableWorkflow('wf_run'), (e) => {
    assert.equal(e.code, 'ARCHIVED');
    assert.equal(e.message, 'workflow "wf_run" was archived by the v2 upgrade (v1 template, not runnable) '
      + '— pick a v2 pipeline or rebuild it in the Composer');
    return true;
  });
});

test('resolveWorkflow refuses a graph row', async () => {
  await writeGraphWorkflow({ ...GRAPH, id: 'wf_resolve' });
  await assert.rejects(() => resolveWorkflow(process.cwd(), 'wf_resolve', {}),
    /^Error: template is a graph — runs on the graph engine$/);
});
```
`Expected: FAIL — SyntaxError: The requested module '../src/core/workflows.mjs' does not provide an export named 'writeGraphWorkflow'`
- [ ] Step 2: Implement — `src/core/workflows.mjs`
```js
// rowToTpl (:206) — version-aware. `graph` carries {nodes, wires, canvas?} ONLY:
// id/name/domain/origin stay row columns, so a rename can never drift.
function rowToTpl(r) {
  const base = {
    id: r.id,
    name: r.name,
    version: r.version,
    domain: r.domain || 'general',
    origin: r.origin || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at || null,
  };
  if (r.version === 2) {
    let graph = {};
    try { graph = JSON.parse(r.graph || '{}') || {}; } catch { graph = {}; }
    base.nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    base.wires = Array.isArray(graph.wires) ? graph.wires : [];
    if (graph.canvas && typeof graph.canvas === 'object') base.canvas = graph.canvas;
    return base;
  }
  base.steps = parseArr(r.steps);
  base.feedbacks = parseArr(r.feedbacks);
  return base;
}

const ROW_COLS = 'id, name, version, domain, steps, feedbacks, graph, archived_at, created_at, updated_at, origin';
```
  `readRaw(id)` (`:221`) selects `ROW_COLS`, gains an `{includeArchived}` option and drops its `Array.isArray(tpl.steps)` gate for v2 rows:
```js
function readRaw(id, { includeArchived = false } = {}) {
  if (!isSafeWorkflowId(id)) return null;      // SECURITY: reject path-traversal / unsafe ids
  getDb();
  const r = prepare(`SELECT ${ROW_COLS} FROM workflows WHERE id = ?`).get(id);
  if (!r) return null;
  if (!includeArchived && r.archived_at) return null;
  const tpl = rowToTpl(r);
  if (tpl.version === 2) return Array.isArray(tpl.nodes) ? tpl : null;
  return Array.isArray(tpl.steps) ? tpl : null;   // mirror the legacy steps-array check
}
```
  New `writeGraphWorkflow` (place beside `writeWorkflow`; `writeWorkflow` stays v1 and untouched):
```js
/**
 * Persist a v2 graph template. Saving over an archived id UN-archives it (the
 * user rebuilt it on purpose). v1 columns are written empty so a v1 reader can
 * never mistake a graph row for a step plan.
 * @param {{id?:string, name:string, domain?:string, origin?:string, nodes:Array, wires:Array, canvas?:object}} tpl
 */
export async function writeGraphWorkflow(tpl) {
  const now = new Date().toISOString();
  const name = (tpl && typeof tpl.name === 'string' && tpl.name.trim()) || 'Untitled';
  // The reserved ids belong to the built-in default and its coexistence alias;
  // a save may never claim either, so it falls back to the slug.
  const asked = tpl && typeof tpl.id === 'string' ? tpl.id.trim() : '';
  const id = asked && isSafeWorkflowId(asked) && asked !== 'wf_default' && asked !== 'wf_default_v2'
    ? asked
    : `wf_${slugify(name)}`;
  const domain = normDomain(tpl && tpl.domain);
  const origin = typeof tpl?.origin === 'string' && tpl.origin ? tpl.origin : null;
  const graph = { nodes: Array.isArray(tpl?.nodes) ? tpl.nodes : [], wires: Array.isArray(tpl?.wires) ? tpl.wires : [] };
  if (tpl?.canvas && typeof tpl.canvas === 'object') graph.canvas = tpl.canvas;

  getDb();
  const existing = prepare('SELECT created_at FROM workflows WHERE id = ?').get(id);
  const createdAt = (typeof tpl?.createdAt === 'string' && tpl.createdAt) || existing?.created_at || now;
  tx(() => {
    prepare(`
      INSERT INTO workflows (id, name, version, domain, steps, feedbacks, graph, archived_at, created_at, updated_at, origin)
      VALUES (?, ?, 2, ?, '[]', '[]', ?, NULL, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, version = 2, domain = excluded.domain,
        steps = '[]', feedbacks = '[]', graph = excluded.graph, archived_at = NULL,
        updated_at = excluded.updated_at, origin = excluded.origin
    `).run(id, name, domain, JSON.stringify(graph), createdAt, now, origin);
  });
  return { id, name, version: 2, domain, origin, ...graph, createdAt, updatedAt: now };
}
```
  `readWorkflow` / `listWorkflows` / `assertRunnableWorkflow`:
```js
export async function readWorkflow(id, opts = {}) {
  if (id === DEFAULT_WORKFLOW.id) return DEFAULT_WORKFLOW;
  return readRaw(id, opts);
}

export async function listWorkflows({ includeArchived = false } = {}) {
  getDb();
  const where = includeArchived ? '' : 'WHERE archived_at IS NULL';
  const rows = prepare(`SELECT ${ROW_COLS} FROM workflows ${where} ORDER BY created_at DESC, id`).all();
  return rows.filter((r) => r.id !== DEFAULT_WORKFLOW.id).map(rowToTpl);
}

/** The ONE gate every run path goes through (POST /api/run, the CLI's
 *  --workflow, Ask's proposal validation). Throws with a `code` the callers map
 *  to HTTP/exit codes; the ARCHIVED text is user-facing and verbatim. */
export async function assertRunnableWorkflow(id) {
  const wanted = typeof id === 'string' && id.trim() ? id.trim() : DEFAULT_WORKFLOW.id;
  const live = await readWorkflow(wanted);
  if (live) return live;
  const archived = await readWorkflow(wanted, { includeArchived: true });
  if (archived) {
    throw Object.assign(new Error(`workflow "${wanted}" was archived by the v2 upgrade `
      + '(v1 template, not runnable) — pick a v2 pipeline or rebuild it in the Composer'), { code: 'ARCHIVED' });
  }
  throw Object.assign(new Error(`unknown workflowId "${wanted}"`), { code: 'NOT_FOUND' });
}
```
  and in `resolveWorkflow` (`:371`), immediately after `if (!tpl) throw new Error(...)`:
```js
  // A v2 row is the graph engine's; the v1 dispatcher cannot read nodes/wires.
  if (tpl.version === 2) throw new Error('template is a graph — runs on the graph engine');
```
`Expected: PASS — 6 tests passing`; `node --test test/workflows.test.mjs test/workflows-db.test.mjs test/workflows-questions.test.mjs test/api-workflows.test.mjs test/migrate-fs-to-db.test.mjs` stays green (`writeWorkflow` and the v1 read path are untouched).
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — v2 workflow rows, archiving and the runnable gate`

---

### Task B3: per-wire budgets — `config_workflow_wires` reads and writes

**Files:** modify `src/core/config.mjs` (`readWorkflowsMap :550`, `setFeedbackCycles :674` — add its wire twin beside it, `resetWorkflowConfig :701`, `resolveRunConfig :747`), create `test/config-wire-cycles.test.mjs`.

**Interfaces produced:** `setWireCycles(projectDir, workflowId, wireId, maxCycles)` (coerces to an integer ≥ 1 exactly like `setFeedbackCycles` — a loop runs at least once; it never throws); `readWorkflowsMap` also fills `wires`, so `GET /api/config` emits `config.workflows[wfId] = {nodes, feedbacks, wires}` during coexistence (`feedbacks` from v1 rows, `wires` from v2 rows; `feedbacks` disappears at P8); `resolveRunConfig` returns `{nodes, wires}` — the `feedbacks` key STAYS on it until P8 because the v1 `resolveWorkflow` reads it; `resetWorkflowConfig` deletes the wire rows too.

- [ ] Step 1: Write the failing test — `test/config-wire-cycles.test.mjs`
```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  setWireCycles, setFeedbackCycles, setNodeModel, readRunConfig, resolveRunConfig, resetWorkflowConfig,
} from '../src/core/config.mjs';

useTempHome(after);
const projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-cfg-'));

test('setWireCycles round-trips and coerces to >= 1', async () => {
  await setWireCycles(projectDir, 'wf_g', 'w5', 4);
  await setWireCycles(projectDir, 'wf_g', 'w9', 0);
  await setWireCycles(projectDir, 'wf_g', 'w12', '3.7');
  const { wires } = await resolveRunConfig(projectDir, 'wf_g');
  assert.deepEqual(wires, { w5: { maxCycles: 4 }, w9: { maxCycles: 1 }, w12: { maxCycles: 3 } });
  await setWireCycles(projectDir, 'wf_g', 'w5', 6);
  assert.equal((await resolveRunConfig(projectDir, 'wf_g')).wires.w5.maxCycles, 6, 'upsert, not duplicate');
});

test('GET /api/config shape: nodes + feedbacks (v1) + wires (v2) coexist', async () => {
  await setNodeModel(projectDir, 'wf_g', 'n_plan', { model: 'sonnet' });
  await setFeedbackCycles(projectDir, 'wf_v1', 'fb_0', 2);
  const cfg = await readRunConfig(projectDir);
  assert.deepEqual(cfg.workflows.wf_g.nodes.n_plan, { model: 'sonnet' });
  assert.deepEqual(cfg.workflows.wf_g.wires.w5, { maxCycles: 6 });
  assert.deepEqual(cfg.workflows.wf_g.feedbacks, {});
  assert.deepEqual(cfg.workflows.wf_v1.feedbacks.fb_0, { maxCycles: 2 });
  assert.deepEqual(cfg.workflows.wf_v1.wires, {});
});

test('resetWorkflowConfig clears nodes AND wires for that workflow only', async () => {
  await setWireCycles(projectDir, 'wf_other', 'w1', 5);
  await resetWorkflowConfig(projectDir, 'wf_g');
  const cfg = await readRunConfig(projectDir);
  assert.equal(cfg.workflows.wf_g, undefined);
  assert.deepEqual(cfg.workflows.wf_other.wires.w1, { maxCycles: 5 });
});

test('an unconfigured workflow resolves to empty maps', async () => {
  assert.deepEqual(await resolveRunConfig(projectDir, 'wf_nothing'), { nodes: {}, wires: {}, feedbacks: {} });
});
```
`Expected: FAIL — SyntaxError: The requested module '../src/core/config.mjs' does not provide an export named 'setWireCycles'`
- [ ] Step 2: Implement — `src/core/config.mjs`
  1. In `readWorkflowsMap` (`:550`) give `ensure` a third bucket and read the wire rows:
```js
  const ensure = (wf) => {
    if (!workflows[wf]) workflows[wf] = { nodes: {}, feedbacks: {}, wires: {} };
    return workflows[wf];
  };
```
```js
  // v23: per-loop-wire budgets (the graph twin of config_workflow_feedbacks).
  for (const r of prepare(
    'SELECT workflow_id, wire_id, max_cycles FROM config_workflow_wires WHERE project_key = ?'
  ).all(key)) {
    ensure(r.workflow_id).wires[r.wire_id] = { maxCycles: r.max_cycles };
  }
```
  2. Beside `setFeedbackCycles` (`:674`):
```js
/**
 * Set the cycle budget for ONE loop wire of a v2 workflow. Coerced to an integer
 * >= 1 (a loop runs at least once), exactly like setFeedbackCycles — this never
 * throws, so a stale UI value cannot 500 a save. Writes only config_workflow_wires.
 */
export async function setWireCycles(projectDir, workflowId, wireId, maxCycles) {
  const n = Math.max(1, Math.floor(Number(maxCycles) || 0) || 1);
  const key = projectKey(projectDir);
  tx(() => {
    prepare(`
      INSERT INTO config_workflow_wires (project_key, workflow_id, wire_id, max_cycles)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(project_key, workflow_id, wire_id) DO UPDATE SET max_cycles = excluded.max_cycles
    `).run(key, workflowId, wireId, n);
  });
}
```
  3. In `resetWorkflowConfig` (`:701`), inside the same `tx`, after the feedbacks DELETE:
```js
    prepare('DELETE FROM config_workflow_wires WHERE project_key = ? AND workflow_id = ?').run(key, id);
```
  4. `resolveRunConfig` (`:747`) returns the third map (keep `feedbacks` — the v1 `resolveWorkflow` still reads it):
```js
  return {
    nodes: wf.nodes && typeof wf.nodes === 'object' ? wf.nodes : {},
    wires: wf.wires && typeof wf.wires === 'object' ? wf.wires : {},
    feedbacks: wf.feedbacks && typeof wf.feedbacks === 'object' ? wf.feedbacks : {},
  };
```
`Expected: PASS — 4 tests passing`; `node --test test/config.test.mjs test/config-db.test.mjs test/config-api.test.mjs test/config-questions.test.mjs` stays green.
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — per-wire cycle budgets`

---

### Task B4: `resolveGraph` — overlays, precedence, workspace variants, node defaults

**Files:** modify `src/core/workflows.mjs` (add `resolveGraph` + `workspaceVariants` beside `resolveWorkflow :371`; extend `workflowNodeDefaults :179` and `setWorkflowNodeDefaults :311` with a v2 arm), create `test/workflows-resolve-graph.test.mjs`.

**Interface produced (CONTRACT for P4's `_resolveTopology`, which calls `resolveGraph` and then `buildGraphManifest(g.template, g.agentsByKey, {overlays: {nodes: g.nodes, wires: g.wires}})`, and hands `g.ports`/`g.loops` to the scheduler — P4 never re-resolves, re-indexes or re-classifies):**
```js
resolveGraph(projectDir, workflowId, registry, agentsDir = DEFAULT_AGENTS_DIR, opts = {}) → {
  template,                     // a DEEP COPY of the stored v2 template whose agent nodes carry the
                                // RESOLVED key (workspace substitution applied); node.config UNTOUCHED
  ports,                        // registryPortsFn(agentsByKey) — THE portsFn for this run
  loops,                        // classifyLoops(template, ports) — computed once, here
  nodes: { [nodeId]: { nodeId, kind:'agent', key, authoredKey, meta, runnerType, agentFile, agentPrompt,
                       promptHints, tools, config, model, effort, fanOut, askQuestions, awaitAll,
                       duplicateKey } },                                    // EFFECTIVE per-node config
  wires: { [wireId]: { maxCycles } },                                       // loop wires only (overlay-merged)
  agentsByKey,                  // {key: meta} for every RESOLVED agent key in the graph
  agentKeys,                    // Set<string> — feeds _preflightAgentKeys + collectRequiredSkills
}
```
`opts = { isWorkspace?: boolean }`. Flow nodes get a `nodes` entry too (`{ nodeId, kind, key: null, config }`, no model/effort) so the caller never has to branch on kind. `authoredKey` is the key as saved (the legacy per-role layer and the audit line name it); `duplicateKey` is true when two agent nodes share one resolved key (the executor prefixes their run-store outputs). Returning the resolved template is what makes `classifyLoops` and the manifest see the reviewer's ports on a workspace run — an authored-key template walked against a substituted-key index would report the review node `known:false`.

**Precedence per agent node** (highest first): `config_workflow_nodes[nodeId]` → legacy `project_config.steps[key]` (ONLY for `wf_default`, addressed by agent KEY) → template `node.config` → sidecar meta → hard default. **Effort never inherits across a model change**: an override that names its own model must not drag the lower layer's effort along (`workflows.mjs:427`). `askQuestions`: an agent that cannot ask is ALWAYS false; a locked one ignores every override. **Per loop wire**: `config_workflow_wires[wireId]` → `wire.config.maxCycles` → 3.

**Refusals** (throw, so a run fails fast with a legible message — the THREE V4 sentences, byte-equal): `unknown agent "<key>" — no such key in the registry` · `agent "<key>" has no v2 ports — port its sidecar to metaVersion 2` · `agent "<key>" declares placeable: false and cannot be a graph node`; an unknown workflow id throws `unknown workflowId "<id>"` (the NOT_FOUND text).

**Workspace variants** (generic, meta-driven — no key literals): `workspaceVariants(registry)` maps `target key → variant meta` for every meta with `scope === 'workspace-only'` and a `workspaceVariantOf`; ties break by layer (builtin > user > plugin, from `meta.origin`). On an `isWorkspace` resolve the node's key is swapped, and the variant's PORT SIGNATURE (`id,type,required,loop,expands` per input; `id,type,when` per output; verdict presence — NOT `as`/filename/store) must deep-equal the target's, else `workspace variant "<v>" does not match the port signature of "<t>"`. `fanOut` is FORCED true where the resolved meta declares `workspaceFanOut` (the generic replacement for v1's `FANOUT_ELIGIBLE` list).

- [ ] Step 1: Write the failing test — `test/workflows-resolve-graph.test.mjs`
```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { setNodeModel, setWireCycles, setStep } from '../src/core/config.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import {
  writeGraphWorkflow, resolveGraph, workspaceVariants, workflowNodeDefaults, setWorkflowNodeDefaults,
} from '../src/core/workflows.mjs';

useTempHome(after);
const projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-rg-'));
const REG = () => loadAgentRegistry(undefined, { userAgentsDir: null });
const GRAPH = (over = {}) => ({
  name: 'RG', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: { model: 'tpl-model', effort: 'high' } },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 0, config: {} },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 900, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
    { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_rev', port: 'done' } },
    { id: 'w5', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 4 } },
    { id: 'w6', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }],
  ...over,
});

test('resolveGraph returns the template, per-node effective config, wire budgets and the key set', async () => {
  const { id } = await writeGraphWorkflow({ ...GRAPH(), id: 'wf_rg' });
  const g = await resolveGraph(projectDir, id, REG());
  assert.equal(g.template.version, 2);
  assert.deepEqual(g.template.nodes.find((n) => n.id === 'n_plan').config, { model: 'tpl-model', effort: 'high' },
    'the stored template is NOT mutated by resolution');
  assert.deepEqual([...g.agentKeys].sort(), ['implementer', 'planner', 'reviewer']);
  assert.deepEqual(Object.keys(g.nodes).sort(), ['n_end', 'n_impl', 'n_plan', 'n_rev', 'n_task']);
  assert.equal(g.nodes.n_task.key, null);
  assert.equal(g.nodes.n_plan.model, 'tpl-model', 'template config is the third layer');
  assert.equal(g.nodes.n_plan.effort, 'high');
  assert.equal(g.nodes.n_plan.runnerType, 'producer');
  assert.equal(typeof g.nodes.n_plan.agentPrompt, 'string');
  assert.equal(g.nodes.n_impl.fanOut, true, 'the sidecar default carries');
  assert.equal(g.agentsByKey.planner.metaVersion, 2);
  assert.equal(typeof g.ports, 'function', 'the run portsFn rides the result');
  assert.ok(g.loops.loopWireIds instanceof Set && Array.isArray(g.loops.launchOrder), 'loops are classified once, here');
  assert.equal(g.nodes.n_plan.authoredKey, 'planner');
  assert.equal(g.nodes.n_plan.duplicateKey, false);
  assert.deepEqual(g.nodes.n_plan.config, g.template.nodes.find((n) => n.id === 'n_plan').config);
  assert.deepEqual(g.wires, { w5: { maxCycles: 4 } }, 'loop wires only, authored budget');
});

test('overlay precedence: run-config wins, and effort never inherits across a model change', async () => {
  const { id } = await writeGraphWorkflow({ ...GRAPH(), id: 'wf_rg2' });
  await setNodeModel(projectDir, id, 'n_plan', { model: 'override-model' });
  const g = await resolveGraph(projectDir, id, REG());
  assert.equal(g.nodes.n_plan.model, 'override-model');
  assert.equal(g.nodes.n_plan.effort, undefined, 'the template effort belonged to the template model');
  await setNodeModel(projectDir, id, 'n_plan', { model: 'override-model', effort: 'low' });
  assert.equal((await resolveGraph(projectDir, id, REG())).nodes.n_plan.effort, 'low');
});

test('wire budgets: overlay > authored > 3', async () => {
  const { id } = await writeGraphWorkflow({ ...GRAPH(), id: 'wf_rg3' });
  assert.equal((await resolveGraph(projectDir, id, REG())).wires.w5.maxCycles, 4);
  await setWireCycles(projectDir, id, 'w5', 9);
  assert.equal((await resolveGraph(projectDir, id, REG())).wires.w5.maxCycles, 9);
  const bare = GRAPH();
  bare.wires = bare.wires.map((w) => (w.id === 'w5' ? { id: w.id, from: w.from, to: w.to } : w));
  const { id: id2 } = await writeGraphWorkflow({ ...bare, id: 'wf_rg4' });
  assert.equal((await resolveGraph(projectDir, id2, REG())).wires.w5.maxCycles, 3);
});

test('refusals: unknown key, un-ported sidecar, placeable:false', async () => {
  const ghost = GRAPH();
  ghost.nodes = ghost.nodes.map((n) => (n.id === 'n_plan' ? { ...n, key: 'ghost' } : n));
  const { id } = await writeGraphWorkflow({ ...ghost, id: 'wf_ghost' });
  await assert.rejects(() => resolveGraph(projectDir, id, REG()), /unknown agent "ghost" — no such key in the registry/);
  const legacy = { ...REG(), planner: { ...REG().planner, inputs: undefined, outputs: undefined } };
  const { id: id2 } = await writeGraphWorkflow({ ...GRAPH(), id: 'wf_legacy' });
  await assert.rejects(() => resolveGraph(projectDir, id2, legacy),
    /agent "planner" has no v2 ports — port its sidecar to metaVersion 2/);
  const scanner = GRAPH();
  scanner.nodes = scanner.nodes.map((n) => (n.id === 'n_plan' ? { ...n, key: 'workspaceScanner' } : n));
  const { id: id3 } = await writeGraphWorkflow({ ...scanner, id: 'wf_scanner' });
  await assert.rejects(() => resolveGraph(projectDir, id3, REG()),
    /agent "workspaceScanner" declares placeable: false and cannot be a graph node/);
});

test('workspace resolve substitutes the variant, checks its port signature and forces fan-out', async () => {
  const reg = REG();
  assert.deepEqual(workspaceVariants(reg), { reviewer: reg.workspaceReviewer });
  const { id } = await writeGraphWorkflow({ ...GRAPH(), id: 'wf_ws' });
  const g = await resolveGraph(projectDir, id, reg, undefined, { isWorkspace: true });
  assert.equal(g.nodes.n_rev.key, 'workspaceReviewer');
  assert.equal(g.nodes.n_rev.fanOut, true, 'workspaceFanOut forces it');
  assert.equal(g.nodes.n_plan.fanOut, true);
  assert.equal(g.agentsByKey.workspaceReviewer.key, 'workspaceReviewer');
  assert.equal(g.template.nodes.find((n) => n.id === 'n_rev').key, 'workspaceReviewer', 'the resolved template carries the substituted key');
  assert.equal(g.nodes.n_rev.authoredKey, 'reviewer', 'the authored key is kept for the legacy layer');
  assert.ok(g.loops.loopWireIds.size >= 1, 'loop classification sees the substituted reviewer\'s ports');
  assert.equal((await resolveGraph(projectDir, id, reg)).nodes.n_rev.key, 'reviewer', 'single-project is untouched');
  const drifted = { ...reg, workspaceReviewer: { ...reg.workspaceReviewer,
    inputs: [{ id: 'plan', type: 'json', required: true }] } };
  await assert.rejects(() => resolveGraph(projectDir, id, drifted, undefined, { isWorkspace: true }),
    /workspace variant "workspaceReviewer" does not match the port signature of "reviewer"/);
});

test('the legacy per-role layer applies to wf_default only', async () => {
  await setStep(projectDir, 'planner', { model: 'legacy-model' });
  const { id } = await writeGraphWorkflow({ ...GRAPH(), id: 'wf_rg5' });
  assert.equal((await resolveGraph(projectDir, id, REG())).nodes.n_plan.model, 'tpl-model', 'saved rows ignore it');
});

test('workflowNodeDefaults / setWorkflowNodeDefaults on a v2 row rewrite graph.nodes[].config', async () => {
  const { id } = await writeGraphWorkflow({ ...GRAPH(), id: 'wf_def' });
  assert.deepEqual(workflowNodeDefaults(await readWorkflow(id)), { n_plan: { model: 'tpl-model', effort: 'high' } });
  const updated = await setWorkflowNodeDefaults(id, { n_plan: { model: 'm2', effort: 'low' }, n_impl: { fanOut: true } });
  assert.deepEqual(updated.nodes.find((n) => n.id === 'n_plan').config, { model: 'm2', effort: 'low' });
  assert.deepEqual(updated.nodes.find((n) => n.id === 'n_impl').config, { fanOut: true });
  const cleared = await setWorkflowNodeDefaults(id, { n_plan: null });
  assert.deepEqual(cleared.nodes.find((n) => n.id === 'n_plan').config, {});
  assert.deepEqual(cleared.nodes.find((n) => n.id === 'n_impl').config, { fanOut: true }, 'absent nodes keep theirs');
  await assert.rejects(() => setWorkflowNodeDefaults('wf_default', { x: null }), /cannot store defaults/);
});
```
(add `readWorkflow` to the import list.)
`Expected: FAIL — SyntaxError: The requested module '../src/core/workflows.mjs' does not provide an export named 'resolveGraph'`

- [ ] Step 2: Implement — `src/core/workflows.mjs`, beside `resolveWorkflow`
```js
/** Port SIGNATURE for the workspace-variant check: the fields that change
 *  SCHEDULING (ids, types, cardinality, loop/expands, conditional routing).
 *  Deliberately excludes `as`, filename and store — a variant may render and
 *  store differently, it may not fire differently. */
function portSignature(meta) {
  return JSON.stringify({
    inputs: (meta?.inputs || []).map((p) => ({ id: p.id, type: p.type, required: p.required !== false,
      loop: !!p.loop, expands: !!p.expands })),
    outputs: (meta?.outputs || []).map((p) => ({ id: p.id, type: p.type, when: p.when || 'always' })),
    verdict: Boolean(meta?.verdict),
  });
}

const LAYER_RANK = (origin) => (origin === 'builtin' ? 0 : String(origin || '').startsWith('plugin:') ? 2 : 1);

/**
 * Workspace substitutions, derived from META alone (no agent-key literals): every
 * `scope:'workspace-only'` meta that declares `workspaceVariantOf` claims that
 * target. Ties break by layer — builtin > user > plugin.
 * @returns {Record<string, object>} target key -> variant meta
 */
export function workspaceVariants(registry) {
  const out = {};
  for (const meta of Object.values(registry || {})) {
    if (!meta || meta.scope !== 'workspace-only' || !meta.workspaceVariantOf) continue;
    const prev = out[meta.workspaceVariantOf];
    if (!prev || LAYER_RANK(meta.origin) < LAYER_RANK(prev.origin)) out[meta.workspaceVariantOf] = meta;
  }
  return out;
}

/**
 * Merge a v2 template + the project's run-config + the registry into everything a
 * graph run needs. The template comes back UNMUTATED; effective per-node config
 * lives in `nodes`, per-loop-wire budgets in `wires`. P4's _resolveTopology feeds
 * `nodes`/`wires` to buildGraphManifest as `overlays`.
 * @throws {Error} unknown workflow, a v1 row, an unknown/un-ported/unplaceable agent
 */
export async function resolveGraph(projectDir, workflowId, registry, agentsDir = DEFAULT_AGENTS_DIR, opts = {}) {
  const stored = await readWorkflow(workflowId);
  if (!stored) throw new Error(`unknown workflowId "${workflowId}"`);
  if (stored.version !== 2) throw new Error('template is not a graph — runs on the v1 engine');
  // The RESOLVED template: a private deep copy (the alias row spreads a deep-frozen
  // constant) whose agent nodes carry the RESOLVED key after workspace substitution.
  const tpl = structuredClone(stored);
  const reg = registry && typeof registry === 'object' ? registry : {};
  const isWorkspace = !!opts.isWorkspace;
  const variants = isWorkspace ? workspaceVariants(reg) : {};
  const { nodes: nodeCfg, wires: wireCfg } = await resolveRunConfig(projectDir, workflowId);
  // The legacy per-role layer is the Default workflow's storage only (saved rows
  // use nodeCfg); it is addressed by agent KEY, never by node id.
  const stepsCfg = workflowId === DEFAULT_WORKFLOW.id ? (await readConfig(projectDir)).steps : {};
  const firstDefined = (...vals) => vals.find((v) => v !== undefined);

  const nodes = {};
  const agentsByKey = {};
  const agentKeys = new Set();
  for (const node of Array.isArray(tpl.nodes) ? tpl.nodes : []) {
    if (node.kind !== 'agent') {
      nodes[node.id] = { nodeId: node.id, kind: node.kind, key: null, config: { ...(node.config || {}) } };
      continue;
    }
    const authored = node.key;
    const key = variants[authored]?.key || authored;
    if (key !== authored) node.key = key;          // the resolved template carries the resolved key
    const meta = reg[key];
    if (!meta) throw new Error(`unknown agent "${key}" — no such key in the registry`);
    if (!Array.isArray(meta.inputs) || !Array.isArray(meta.outputs)) {
      throw new Error(`agent "${key}" has no v2 ports — port its sidecar to metaVersion 2`);
    }
    if (meta.placeable === false) throw new Error(`agent "${key}" declares placeable: false and cannot be a graph node`);
    if (key !== authored && portSignature(meta) !== portSignature(reg[authored] || {})) {
      throw new Error(`workspace variant "${key}" does not match the port signature of "${authored}"`);
    }
    const { prompt, tools } = await loadAgentFile(agentsDir, meta.agentFile ?? null, meta.agentPath ?? null);
    const sel = nodeCfg[node.id] || {};
    // Legacy per-role config is keyed by the AUTHORED key, so a substituted
    // variant still inherits the user's model/effort for that role.
    const legacy = stepsCfg[authored] || {};
    const cfg = node.config && typeof node.config === 'object' ? node.config : {};
    nodes[node.id] = {
      nodeId: node.id,
      kind: 'agent',
      key,
      authoredKey: authored,
      meta,
      runnerType: meta.runnerType || 'producer',
      agentFile: meta.agentFile ?? null,
      agentPrompt: prompt,
      promptHints: typeof meta.promptHints === 'string' ? meta.promptHints : '',
      tools,
      config: { ...cfg },
      model: firstDefined(sel.model, legacy.model, cfg.model),
      // An effort only travels with the model that advertises it: an override
      // naming its own model must not inherit the lower layer's effort.
      effort: firstDefined(sel.effort, legacy.effort, (sel.model || legacy.model) ? undefined : cfg.effort),
      // workspaceFanOut forces fan-out on a workspace run (the generic
      // replacement for the v1 FANOUT_ELIGIBLE key list).
      fanOut: isWorkspace && meta.workspaceFanOut
        ? true
        : !!firstDefined(sel.fanOut, legacy.fanOut, cfg.fanOut, meta.fanOut, false),
      askQuestions: !meta.asksQuestions
        ? false
        : (meta.questionsLocked
          ? !!meta.questionsDefault
          : !!firstDefined(sel.askQuestions, legacy.askQuestions, cfg.askQuestions, meta.questionsDefault, false)),
      awaitAll: !!cfg.awaitAll,
    };
    agentsByKey[key] = meta;
    agentKeys.add(key);
  }

  // Two nodes sharing one agent key prefix their run-store outputs (executor dupPrefix).
  const keyCount = new Map();
  for (const nc of Object.values(nodes)) if (nc.kind === 'agent') keyCount.set(nc.key, (keyCount.get(nc.key) || 0) + 1);
  for (const nc of Object.values(nodes)) if (nc.kind === 'agent') nc.duplicateKey = (keyCount.get(nc.key) || 0) > 1;

  // Budgets ride LOOP wires only: overlay > authored > DEFAULT_MAX_CYCLES.
  // portsFn + loops are computed ONCE here and RETURNED — P4 hands them to the
  // scheduler and the manifest builder instead of re-deriving them.
  const portsFn = registryPortsFn(agentsByKey);
  const loops = classifyLoops(tpl, portsFn);
  const { loopWireIds } = loops;
  const wires = {};
  for (const w of Array.isArray(tpl.wires) ? tpl.wires : []) {
    if (!loopWireIds.has(w.id)) continue;
    const raw = Number(wireCfg[w.id]?.maxCycles ?? w.config?.maxCycles);
    wires[w.id] = { maxCycles: Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_MAX_CYCLES };
  }
  return { template: tpl, ports: portsFn, loops, nodes, wires, agentsByKey, agentKeys };
}
```
  with the imports at the top of `workflows.mjs`:
```js
import { classifyLoops } from '../shared/graph/loops.mjs';
import { registryPortsFn } from './graph/registry-ports.mjs';
```
  (`resolveRunConfig`, `readConfig`, `loadAgentFile`, `DEFAULT_AGENTS_DIR` and `DEFAULT_MAX_CYCLES` are already imported/declared in the module.)
  Then the v2 arms of the defaults API — `workflowNodeDefaults` (`:179`) gains, before its `steps` walk:
```js
  if (Array.isArray(tpl?.nodes)) {                       // v2: defaults ARE node.config
    for (const node of tpl.nodes) {
      if (node?.kind !== 'agent') continue;
      const clean = sanitizeNodeDefaults(node.config, node.id);
      if (clean) out[node.id] = clean;
    }
    return out;
  }
```
  and `setWorkflowNodeDefaults` (`:311`), after the `wf_default` refusal and the `readRaw` lookup:
```js
  if (tpl.version === 2) {
    const TUNABLES = ['model', 'effort', 'fanOut', 'askQuestions'];
    const nodes = tpl.nodes.map((node) => {
      if (!Object.prototype.hasOwnProperty.call(patch, node.id)) return node;
      const clean = sanitizeNodeDefaults(patch[node.id], node.id) || {};
      // Only the 4 tunables are defaults; awaitAll/arity/planStoreSeed are
      // TOPOLOGY and must survive a defaults patch untouched.
      const kept = Object.fromEntries(Object.entries(node.config || {}).filter(([k]) => !TUNABLES.includes(k)));
      return { ...node, config: { ...kept, ...clean } };
    });
    const now = new Date().toISOString();
    tx(() => {
      prepare('UPDATE workflows SET graph = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify({ nodes, wires: tpl.wires, ...(tpl.canvas ? { canvas: tpl.canvas } : {}) }), now, id);
    });
    return { ...tpl, nodes, updatedAt: now };
  }
```
`Expected: PASS — 7 tests passing`
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — resolveGraph, workspace variants and v2 node defaults`

---

### Task B5: `/api/workflows` — v2 saves (422 = the validator's issues), archived listing, 404 texts

**Files:** modify `ui/server.mjs` (`GET /api/workflows :3116`, `GET /api/workflows/:id :3126`, `POST /api/workflows :3136`, `PATCH /api/workflows/:id/defaults :3177`), create `test/api-workflows-graph.test.mjs`.

**Rules:**
- `POST /api/workflows` branches on `body.version === 2`: build `{name, domain, origin, nodes, wires, canvas?}`, run `validateGraph(tpl, registryPortsFn(loadAgentRegistry(AGENTS_DIR)))` and, when `errors.length`, respond **422** `{error: 'invalid graph', errors, warnings}` — the issues VERBATIM from the shared validator (never hand-written here), then `writeGraphWorkflow`. v1 bodies keep today's path (400 `invalid workflow`) until P8. The 422 body must satisfy `deepEqual(body.errors, validateGraph(tpl, portsFn).errors)` — that identity is the test.
- `GET /api/workflows?archived=1` returns ONLY archived rows (`listWorkflows({includeArchived:true})` filtered on `archivedAt`); without the flag the list is unchanged: `[DEFAULT_WORKFLOW, ...listWorkflows()]` (the `wf_default_v2` alias row is P4's, not this plan's).
- `GET /api/workflows/:id` goes through `assertRunnableWorkflow` and maps both codes to **404** with `e.message` (so an archived id explains itself).
- `PATCH /api/workflows/:id/defaults` needs no branch of its own — `setWorkflowNodeDefaults` handles v2 — but its response `defaults: workflowNodeDefaults(workflow)` must now read `graph.nodes[].config`; keep the model/effort catalog validation as-is.

- [ ] Step 1: Write the failing test — `test/api-workflows-graph.test.mjs`
```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';

useTempHome(after);
// Boot preamble: COPY the before/after block of test/api-workflows.test.mjs
// verbatim (mkdtemp home + WORCA_MOCK=1 + `const { app } = await import(...)` +
// http.createServer(app).listen(0)) and keep its `base` binding.
const api = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const GOOD = {
  version: 2, name: 'Api Graph', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
};

test('POST /api/workflows with version 2 saves a graph row', async () => {
  const r = await api('POST', '/api/workflows', GOOD);
  assert.equal(r.status, 201);
  assert.equal(r.body.workflow.version, 2);
  assert.deepEqual(r.body.workflow.nodes.map((n) => n.id), ['n_task', 'n_plan', 'n_end']);
  const row = prepare('SELECT version, graph FROM workflows WHERE id = ?').get(r.body.workflow.id);
  assert.equal(row.version, 2);
  assert.ok(JSON.parse(row.graph).wires.length === 2);
});

test('an invalid graph is 422 with the SHARED validator issues, byte for byte', async () => {
  const bad = { ...GOOD, wires: [...GOOD.wires,
    { id: 'w3', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }] };
  const r = await api('POST', '/api/workflows', bad);
  assert.equal(r.status, 422);
  const portsFn = registryPortsFn(loadAgentRegistry(undefined, { userAgentsDir: null }));
  const expected = validateGraph({ ...bad, id: '', name: bad.name }, portsFn);
  assert.deepEqual(r.body.errors, expected.errors);
  assert.deepEqual(r.body.warnings, expected.warnings);
  assert.equal(r.body.errors[0].code, 'V7');
  assert.equal(prepare('SELECT count(*) AS n FROM workflows').get().n, 1, 'nothing was written');
});

test('GET /api/workflows/:id — 404 with the archive message', async () => {
  const saved = (await api('POST', '/api/workflows', { ...GOOD, name: 'Arch Me' })).body.workflow;
  assert.equal((await api('GET', `/api/workflows/${saved.id}`)).status, 200);
  getDb();
  prepare('UPDATE workflows SET archived_at = ? WHERE id = ?').run('2026-08-27T00:00:00Z', saved.id);
  const gone = await api('GET', `/api/workflows/${saved.id}`);
  assert.equal(gone.status, 404);
  assert.match(gone.body.error, /was archived by the v2 upgrade \(v1 template, not runnable\)/);
  const ghost = await api('GET', '/api/workflows/wf_nope');
  assert.equal(ghost.status, 404);
  assert.equal(ghost.body.error, 'unknown workflowId "wf_nope"');
});

test('GET /api/workflows hides archived rows; ?archived=1 shows ONLY them', async () => {
  const live = await api('GET', '/api/workflows');
  assert.equal(live.body.workflows[0].id, 'wf_default');
  assert.equal(live.body.workflows.some((w) => w.name === 'Arch Me'), false);
  const arch = await api('GET', '/api/workflows?archived=1');
  assert.deepEqual(arch.body.workflows.map((w) => w.name), ['Arch Me']);
  assert.ok(arch.body.workflows.every((w) => w.archivedAt));
});

test('PATCH /api/workflows/:id/defaults rewrites a v2 node config', async () => {
  const saved = (await api('POST', '/api/workflows', { ...GOOD, name: 'Defaults' })).body.workflow;
  const r = await api('PATCH', `/api/workflows/${saved.id}/defaults`, { defaults: { n_plan: { fanOut: true } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.defaults, { n_plan: { fanOut: true } });
  assert.deepEqual(r.body.workflow.nodes.find((n) => n.id === 'n_plan').config, { fanOut: true });
});
```
  (Use the port/boot preamble the neighbouring API suites use — copy it verbatim from `test/api-workflows.test.mjs` so the server starts the same way; the assertions above are what matters.)
`Expected: FAIL — 400 invalid workflow` (today's v1 path rejects a body with no `steps`)
- [ ] Step 2: Implement — `ui/server.mjs`
```js
// GET /api/workflows (:3116) — `?archived=1` lists ONLY archived rows.
app.get('/api/workflows', async (req, res) => {
  try {
    if (isTruthy(req.query.archived)) {
      const all = await listWorkflows({ includeArchived: true });
      return res.json({ workflows: all.filter((w) => w.archivedAt) });
    }
    res.json({ workflows: [DEFAULT_WORKFLOW, ...(await listWorkflows())] });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// GET /api/workflows/:id (:3126) — one gate, one message.
app.get('/api/workflows/:id', async (req, res) => {
  try {
    res.json(await assertRunnableWorkflow(req.params.id));
  } catch (err) {
    if (err && (err.code === 'NOT_FOUND' || err.code === 'ARCHIVED')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});
```
  and inside `POST /api/workflows` (`:3136`), FIRST thing after `const body = req.body || {}`:
```js
  // ── v2 graph save ──────────────────────────────────────────────────────────
  // The 422 body is the SHARED validator's issue list, by construction: the
  // composer renders exactly what it would have computed locally, so the server
  // and the client can never disagree about why a graph is illegal.
  if (body.version === 2) {
    const graph = {
      id: typeof body.id === 'string' ? body.id : undefined,
      name: typeof body.name === 'string' ? body.name.trim() : '',
      domain: typeof body.domain === 'string' ? body.domain : undefined,
      nodes: Array.isArray(body.nodes) ? body.nodes : [],
      wires: Array.isArray(body.wires) ? body.wires : [],
      ...(body.canvas && typeof body.canvas === 'object' ? { canvas: body.canvas } : {}),
    };
    if (!graph.name) return badRequest(res, 'name is required');
    try {
      const portsFn = registryPortsFn(loadAgentRegistry(AGENTS_DIR));
      const { errors, warnings } = validateGraph({ ...graph, version: 2 }, portsFn);
      if (errors.length) return res.status(422).json({ error: 'invalid graph', errors, warnings });
      const workflow = await writeGraphWorkflow(graph);
      return res.status(201).json({ workflow, warnings });
    } catch (err) {
      return res.status(500).json({ error: err && err.message ? err.message : String(err) });
    }
  }
```
  with the imports extended: `assertRunnableWorkflow, writeGraphWorkflow` from `../src/core/workflows.mjs`, `registryPortsFn` from `../src/core/graph/registry-ports.mjs`, `validateGraph` from `../src/shared/graph/validate.mjs`.
`Expected: PASS — 5 tests passing`; `node --test test/api-workflows.test.mjs test/api-workflows-warnings.test.mjs` stays green.
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — /api/workflows accepts and validates v2 graphs`

---

### Task B6: `/api/config` — emit and accept `wires`

**Files:** modify `ui/server.mjs` (`PATCH /api/config :2751`, `DELETE /api/config/workflow :2792`), extend `test/api-workflows-graph.test.mjs` (or the neighbouring config API suite) with the three cases below. `GET /api/config` (`:2687`) needs NO edit — it returns `readRunConfig(projectDir)` whole, so the `wires` map Task B3 added rides along automatically; the test proves it.

**Rules:** `PATCH /api/config` accepts `wires?: {[wireId]: {maxCycles}}` beside `nodes`/`feedbacks` (both keys are accepted during coexistence; `feedbacks` starts 400ing only at P8) and requires `workflowId` for it, exactly like the other two. `DELETE /api/config/workflow` needs no server edit — `resetWorkflowConfig` clears the wire rows (Task B3) — but the test pins it.

- [ ] Step 1: Write the failing test — append to `test/api-workflows-graph.test.mjs`
```js
test('PATCH /api/config writes wire budgets and GET /api/config emits them', async () => {
  const patch = await api('PATCH', '/api/config',
    { projectDir: homeDir, workflowId: 'wf_g', wires: { w5: { maxCycles: 4 }, w9: { maxCycles: 0 } } });
  assert.equal(patch.status, 200);
  assert.deepEqual(patch.body.config.workflows.wf_g.wires, { w5: { maxCycles: 4 }, w9: { maxCycles: 1 } });
  const get = await api('GET', `/api/config?projectDir=${encodeURIComponent(homeDir)}`);
  assert.deepEqual(get.body.config.workflows.wf_g.wires.w5, { maxCycles: 4 });
  assert.deepEqual(get.body.config.workflows.wf_g.feedbacks, {}, 'both keys are emitted during coexistence');
});

test('PATCH /api/config without a workflowId refuses wire config', async () => {
  const r = await api('PATCH', '/api/config', { projectDir: homeDir, wires: { w5: { maxCycles: 2 } } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /workflowId is required to set wire config/);
});

test('DELETE /api/config/workflow clears nodes AND wires', async () => {
  await api('PATCH', '/api/config', { projectDir: homeDir, workflowId: 'wf_g', nodes: { n_plan: { model: 'sonnet' } } });
  const res = await fetch(`${base}/api/config/workflow?projectDir=${encodeURIComponent(homeDir)}&workflowId=wf_g`,
    { method: 'DELETE' });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.config.workflows.wf_g, undefined);
});
```
`Expected: FAIL — the wires key is ignored: workflows.wf_g is undefined`
- [ ] Step 2: Implement — in `PATCH /api/config` (`:2751`), directly after the `feedbacks` block:
```js
    if (body.wires && typeof body.wires === 'object') {
      if (!workflowId) return badRequest(res, 'workflowId is required to set wire config');
      for (const [wireId, sel] of Object.entries(body.wires)) {
        await setWireCycles(projectDir, workflowId, wireId, sel && sel.maxCycles);
      }
    }
```
  with `setWireCycles` added to the `../src/core/config.mjs` import list, and the route's doc comment's body line extended to `body: { projectDir, workflowId, nodes?, feedbacks?, wires?:{[wireId]:{maxCycles}}, activeWorkflowId? }`.
`Expected: PASS — 3 tests passing`; `node --test test/config-api.test.mjs` stays green.
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — /api/config carries per-wire budgets`

---

### Task B7: every run path goes through `assertRunnableWorkflow` (and a v2 row refuses cleanly)

**Files:** modify `ui/server.mjs` (`POST /api/run :1062`), `src/cli/worca-cc.mjs` (before `createOrchestrator :1526`), `src/core/ask/proposal.mjs` (`:104-106`), create `test/run-workflow-gate.test.mjs`.

**At P2 a v2 row cannot RUN** — the graph engine lands in P3/P4. The failure must be ONE clean message, never a mid-run crash:
- `POST /api/run` with a v2 `workflowId` ⇒ **400** `{ error: 'template is a graph — runs on the graph engine (not available yet)' }` — the same `badRequest` path today's `unknown workflowId` uses; ONE status for every non-runnable template on this route (NOT_FOUND, ARCHIVED, interim v2). P4 deletes this branch when `createOrchestratorFor` starts routing v2 rows.
- The CLI's `--workflow` with a v2 (or archived, or unknown) id ⇒ stderr `worca: <message>` + exit code **2**.
- Ask's proposal validation reports the same text through its existing error list.
- An ARCHIVED id anywhere ⇒ the §4 message; an UNKNOWN id ⇒ `unknown workflowId "<id>"` (byte-identical to today's `POST /api/run` 400 text, so no client copy changes).

- [ ] Step 1: Write the failing test — `test/run-workflow-gate.test.mjs`
```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
// Boot preamble: copy test/api-workflows.test.mjs's before/after (WORCA_MOCK=1).

test('POST /api/run refuses a graph row with one clean 400', async () => {
  await writeGraphWorkflow({ id: 'wf_graph', name: 'G', nodes: [], wires: [] });
  const r = await api('POST', '/api/run', { projectDir: homeDir, prompt: 'hi', workflowId: 'wf_graph' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'template is a graph — runs on the graph engine (not available yet)');
});

test('POST /api/run: unknown id 400, archived id 400 with the archive message', async () => {
  const unknown = await api('POST', '/api/run', { projectDir: homeDir, prompt: 'hi', workflowId: 'wf_nope' });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'unknown workflowId "wf_nope"');
  await writeGraphWorkflow({ id: 'wf_arch2', name: 'A', nodes: [], wires: [] });
  getDb();
  prepare('UPDATE workflows SET archived_at = ? WHERE id = ?').run('2026-08-27T00:00:00Z', 'wf_arch2');
  const arch = await api('POST', '/api/run', { projectDir: homeDir, prompt: 'hi', workflowId: 'wf_arch2' });
  assert.equal(arch.status, 400);
  assert.match(arch.body.error, /was archived by the v2 upgrade/);
});

test('a v1 row still runs (the gate is not a wall)', async () => {
  const r = await api('POST', '/api/run', { projectDir: homeDir, prompt: 'hi', workflowId: 'wf_default' });
  assert.equal(r.status, 200);
  assert.ok(r.body.runId);
});
```
`Expected: FAIL — expected 400, got 200` (today the v2 row is accepted and dies later inside resolveWorkflow)
- [ ] Step 2: Implement — `ui/server.mjs`, replacing the readWorkflow check at `:1062`:
```js
    // ONE gate for every run entry point, ONE status: unknown (today's text),
    // archived (the upgrade explanation the UI shows verbatim) and — until P4 —
    // a graph row all answer 400 through badRequest. The graph branch dies in
    // P4, when createOrchestratorFor routes v2 rows to the engine.
    let workflowRow;
    try {
      workflowRow = await assertRunnableWorkflow(workflowId);
    } catch (err) {
      return badRequest(res, err && err.message ? err.message : String(err));
    }
    if (workflowRow.version === 2) {
      return badRequest(res, 'template is a graph — runs on the graph engine (not available yet)');
    }
```
  `src/cli/worca-cc.mjs`, immediately before `const orch = createOrchestrator({` (`:1526`):
```js
  // Validate --workflow before spawning anything: an archived or graph template
  // must fail with one line, not a stack trace half-way through a run.
  if (flags.workflow) {
    const { assertRunnableWorkflow } = await import('../core/workflows.mjs');
    let row;
    try { row = await assertRunnableWorkflow(flags.workflow); }
    catch (err) { fail(`${err && err.message ? err.message : String(err)}`); }
    if (row.version === 2) fail('template is a graph — runs on the graph engine (not available yet)');
  }
```
  `src/core/ask/proposal.mjs` (`:104-106`) — keep the existing error-collection shape:
```js
    const workflowId = str(inp.workflowId) || 'wf_default';
    let wf = null;
    try { wf = await assertRunnableWorkflow(workflowId); }
    catch (err) { errors.push(err && err.message ? err.message : PROPOSAL_ERRORS.unknownWorkflow(workflowId)); }
    if (wf && wf.version === 2) errors.push('template is a graph — runs on the graph engine (not available yet)');
```
  (import `assertRunnableWorkflow` beside the existing `readWorkflow` import; leave `PROPOSAL_ERRORS.unknownWorkflow` in place — `assertRunnableWorkflow`'s NOT_FOUND text is the same sentence.)
  (`fail()` at `worca-cc.mjs:165` already writes `worca: <msg>` to stderr and exits 2 — verified on dev; no new helper is needed.)
`Expected: PASS — 3 tests passing`; `node --test test/ask-proposal.test.mjs` and every `test/api-*.test.mjs` that posts a run stay green.
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — one runnable-workflow gate for every run path`

---

### Task B8: Ask `shapeWorkflow` derives steps + feedbacks from a v2 row

**Files:** modify `src/core/ask/catalog.mjs` (`shapeWorkflow :18`), create `test/ask-catalog-graph.test.mjs`.

The LLM-facing catalog shape must not change: Ask's prompt and its `list_workflows` tool render `{id, name, domain, origin, steps: [[{nodeId,key,displayName,description}]], feedbacks: [{id,from,to}]}`. For a v2 row those are DERIVED — one group per `rankNodes` rank (longest path with loop wires excluded, nodes in `launchOrder` inside a group — the SAME rank definition the manifest shim cells use; agent nodes only, flow cards are engine plumbing the assistant must not reason about), and one feedback per loop wire.

- [ ] Step 1: Write the failing test — `test/ask-catalog-graph.test.mjs`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeWorkflow } from '../src/core/ask/catalog.mjs';

const REG = {
  planner: { key: 'planner', displayName: 'Plan', description: 'plans',
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  reviewer: { key: 'reviewer', displayName: 'Review', description: 'reviews', verdict: { filename: 'r.json' },
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
};
const V2 = { id: 'wf_g', name: 'G', version: 2, domain: 'coding', origin: null,
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
    { id: 'w3', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_plan', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w4', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] };

test('a v2 row shapes into the SAME catalog contract as a v1 one', () => {
  const s = shapeWorkflow(V2, REG);
  assert.deepEqual(Object.keys(s), ['id', 'name', 'domain', 'origin', 'steps', 'feedbacks']);
  assert.deepEqual(s.steps, [
    [{ nodeId: 'n_plan', key: 'planner', displayName: 'Plan', description: 'plans' }],
    [{ nodeId: 'n_rev', key: 'reviewer', displayName: 'Review', description: 'reviews' }],
  ], 'agent nodes only, one group per rank — flow cards are engine plumbing');
  assert.deepEqual(s.feedbacks, [{ id: 'w3', from: 'n_rev', to: 'n_plan' }]);
});

test('a v1 row is untouched', () => {
  const v1 = { id: 'wf_v1', name: 'V1', version: 1, domain: 'coding', origin: null,
    steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [{ id: 'fb_0', from: 's1_0', to: 's0_0', maxCycles: 3 }] };
  assert.deepEqual(shapeWorkflow(v1, REG), { id: 'wf_v1', name: 'V1', domain: 'coding', origin: null,
    steps: [[{ nodeId: 's0_0', key: 'planner', displayName: 'Plan', description: 'plans' }]],
    feedbacks: [{ id: 'fb_0', from: 's1_0', to: 's0_0' }] });
});

test('an unknown key falls back to the key itself', () => {
  const g = { ...V2, nodes: V2.nodes.map((n) => (n.id === 'n_plan' ? { ...n, key: 'ghost' } : n)) };
  assert.equal(shapeWorkflow(g, REG).steps[0][0].displayName, 'ghost');
});
```
`Expected: FAIL — steps is [] (shapeWorkflow reads tpl.steps, which a v2 row does not have)`
- [ ] Step 2: Implement — `src/core/ask/catalog.mjs`
```js
import { classifyLoops } from '../../shared/graph/loops.mjs';
import { rankNodes } from '../../shared/graph/layout.mjs';
import { registryPortsFn } from '../graph/registry-ports.mjs';

/** A v2 graph -> the v1-shaped step groups the assistant already understands:
 *  one group per rank (loop wires excluded), agent nodes only. */
function graphSteps(tpl, portsFn) {
  const ranks = rankNodes(tpl, classifyLoops(tpl, portsFn));
  const byRank = new Map();
  for (const node of tpl.nodes) {
    if (node.kind !== 'agent') continue;
    const r = ranks[node.id] ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(node);
  }
  return [...byRank.keys()].sort((a, b) => a - b).map((r) => byRank.get(r));
}
```
  and inside `shapeWorkflow`, before the existing `steps`/`feedbacks` reads:
```js
  if (tpl && tpl.version === 2 && Array.isArray(tpl.nodes)) {
    const portsFn = registryPortsFn(registry);
    const groups = graphSteps(tpl, portsFn);
    const { loopWireIds } = classifyLoops(tpl, portsFn);
    return {
      id: tpl.id,
      name: tpl.name,
      domain: typeof tpl.domain === 'string' && tpl.domain ? tpl.domain : 'general',
      origin: tpl.origin ?? null,
      steps: groups.map((group) => group.map((node) => {
        const meta = registry && registry[node.key] ? registry[node.key] : null;
        return {
          nodeId: node.id,
          key: node.key,
          displayName: meta && meta.displayName ? meta.displayName : node.key,
          description: meta && typeof meta.description === 'string' ? meta.description : '',
        };
      })),
      feedbacks: (tpl.wires || []).filter((w) => loopWireIds.has(w.id))
        .map((w) => ({ id: w.id, from: w.from.node, to: w.to.node })),
    };
  }
```
`Expected: PASS — 3 tests passing`; `node --test test/ask-catalog.test.mjs test/ask-tools.test.mjs test/ask-prompt.test.mjs` stays green (run whatever `ls test | grep ^ask-` reports).
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — Ask catalog understands graph templates`

---

### Task B9: the remaining v1 consumers guard themselves against a v2 row

**Files:** modify `src/core/agent-store.mjs` (`:133`), `src/core/plugin-workflows.mjs` (`referencedPluginAgents :150-178`), `ui/public/app.js` (`buildNodeConfigRows :2669`, `buildFeedbackRows :2813`, `composerRenderList :2561`), create `test/graph-row-consumers.test.mjs`.

Every one of these walks `steps`/`feedbacks`. On a v2 row they must not crash and must not silently under-report:
- `agent-store.deleteAgent`'s reference scan must also walk `wf.nodes[].key`, or deleting an agent used by a saved GRAPH would succeed and break it.
- `plugin-workflows.referencedPluginAgents` must read `nodes[].key` from the `graph` column as well as `steps` (its SQL selects `steps`; add `graph` and walk both).
- Run-setup's `buildNodeConfigRows` / `buildFeedbackRows` must guard `Array.isArray(workflow.steps)` and return `[]` — zero rows, no crash — until P5 adds the real v2 branch.
- The v1 composer list (`composerRenderList`) must SKIP `version === 2` rows: the v1 editor cannot render them and P5 replaces the composer wholesale.

- [ ] Step 1: Write the failing test — `test/graph-row-consumers.test.mjs`
```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { deleteAgent, createAgent } from '../src/core/agent-store.mjs';

useTempHome(after);

test('deleteAgent refuses when a GRAPH row references the agent', async () => {
  await createAgent({ meta: { key: 'docsy', displayName: 'Docsy', runnerType: 'producer', metaVersion: 2,
    inputs: [{ id: 'plan', type: 'md' }], outputs: [{ id: 'notes', type: 'md', filename: 'n.md' }] },
    markdown: '# Docsy\n' });   // createAgent({ meta, markdown }) — agent-store.mjs:53
  await writeGraphWorkflow({ id: 'wf_uses', name: 'Uses Docsy',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_d', kind: 'agent', key: 'docsy', x: 300, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
    wires: [] });
  await assert.rejects(() => deleteAgent('docsy'), (e) => {
    assert.equal(e.code, 'REFERENCED');
    assert.match(e.message, /Uses Docsy/);
    return true;
  });
});
```
  and, for the two `app.js` helpers, a jsdom-free unit assertion in the same file — import them the way `test/ui-composer-wires.test.mjs` boots `app.js` under jsdom, or (simpler) assert through the exported functions if they are reachable; if neither is available in this repo's app.js shape, cover them with a source-level guard instead:
```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('the run-setup builders and the v1 composer list guard against v2 rows', () => {
  const src = readFileSync(fileURLToPath(new URL('../ui/public/app.js', import.meta.url)), 'utf8');
  const fn = (name) => src.slice(src.indexOf(`function ${name}(`), src.indexOf(`function ${name}(`) + 900);
  assert.match(fn('buildNodeConfigRows'), /Array\.isArray\(workflow && workflow\.steps\)/);
  assert.match(fn('buildNodeConfigRows'), /workflow\.version === 2/);
  assert.match(fn('buildFeedbackRows'), /workflow\.version === 2/);
  assert.match(fn('composerRenderList'), /version !== 2/);
});
```
`Expected: FAIL — deleteAgent resolves (the graph row is invisible to the scan)`
- [ ] Step 2: Implement
  `src/core/agent-store.mjs` (`:133`) — walk both shapes:
```js
  const refs = (await listWorkflows({ includeArchived: true }))
    .filter((wf) => (wf.steps || []).some((col) => (col || []).some((n) => n && n.key === key))
      || (wf.nodes || []).some((n) => n && n.key === key))
    .map((wf) => wf.name || wf.id);
```
  `src/core/plugin-workflows.mjs` (`:165-178`) — select and walk `graph` too:
```js
  for (const row of prepare(
    'SELECT id, name, steps, graph FROM workflows WHERE origin IS NULL OR origin != ?',
  ).all(`plugin:${name}`)) {
    const found = new Set();
    let steps;
    try { steps = JSON.parse(row.steps); } catch { steps = null; }
    for (const group of Array.isArray(steps) ? steps : []) {
      for (const node of Array.isArray(group) ? group : []) if (node && keys.has(node.key)) found.add(node.key);
    }
    let graph;
    try { graph = JSON.parse(row.graph || 'null'); } catch { graph = null; }
    for (const node of Array.isArray(graph?.nodes) ? graph.nodes : []) {
      if (node && keys.has(node.key)) found.add(node.key);
    }
    if (found.size) out.push({ workflowId: row.id, name: row.name, keys: [...found].sort() });
  }
```
  `ui/public/app.js` — at the TOP of `buildNodeConfigRows` (`:2669`) and `buildFeedbackRows` (`:2813`):
```js
  // v2 graph rows have no steps/feedbacks: render nothing until the graph
  // run-setup branch lands (P5). Guarding here keeps New Pipeline from throwing
  // on a saved graph the moment one exists.
  if (workflow && workflow.version === 2) return [];
```
  and in `composerRenderList` (`:2561`), right after `const listEl = …`:
```js
  // The v1 composer cannot render a graph; P5 replaces this view wholesale.
  composer.saved = (composer.saved || []).filter((w) => w && w.version !== 2);
```
`Expected: PASS — 2 tests passing`; `node --test test/agent-store.test.mjs test/plugin-workflows.test.mjs test/ui-composer.test.mjs test/composer-ui.test.mjs` stays green.
- [ ] Step 3: Commit — `worca: Node-graph v2 P2 — v1 consumers tolerate graph rows`

---

### Task B10: P2b full suite, count, handoff

- [ ] Step 1: `npm test 2>&1 | tail -5`
`Expected: BASELINE-B + 37 passing, 0 failing` — the 37 new P2b tests are: db-migrate-v23 4, workflows-graph-rows 6, config-wire-cycles 4, workflows-resolve-graph 7, api-workflows-graph 5 + 3 (the B6 config cases), run-workflow-gate 3, ask-catalog-graph 3, graph-row-consumers 2. (If you executed both halves in one run, the total is BASELINE + 134.)
- [ ] Step 2: Version-pin sweep, final: `grep -rn -A1 "user_version" test/*.mjs | grep -w 22 | grep -v db-migrate-v23`
`Expected: empty`
- [ ] Step 3: Manual verification checklist (no browser needed; each line is one command):
```bash
# 1. A v2 row saves, lists, reads, archives and refuses to run — end to end.
WORCA_HOME=$(mktemp -d) node --test test/api-workflows-graph.test.mjs test/run-workflow-gate.test.mjs
# 2. The seeds still validate against the shipped sidecars (P2a's guard, re-run after the store work).
WORCA_HOME=$(mktemp -d) node --test test/graph-seed-templates.test.mjs
# 3. The shared modules are still pure and still served.
node --test test/shared-graph-purity.test.mjs test/api-shared-static.test.mjs
# 4. The schema is 23 and gap-healing is a no-op on old-branch residue.
node --test test/db-migrate-v23.test.mjs
```
- [ ] Step 4: Commit — `worca: Node-graph v2 P2 — P2b green (schema + store)`
- [ ] Step 5: **Handoff.** This plan lives at `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P2-shared-core-sidecars-schema-store.md`. P3 (engine, no callers) requires these sentinels, all now present: `export function validateGraph` in `src/shared/graph/validate.mjs`, `SCHEMA_VERSION = 23` in `src/core/db.mjs`, `export const MOCK_WRITER_ROLES` in `src/core/claude-runner.mjs`. P3 also consumes, and must not redefine: `portsOf`/`firedOutputs`/`resolveOrOutType` (`ports.mjs`), `classifyLoops` (`loops.mjs`), `buildGraphManifest`/`manifestPortsFn`/`manifestTemplate`/`UI_PHASE` (`manifest.mjs`), `registryPortsFn` (`src/core/graph/registry-ports.mjs`), `resolveGraph`/`assertRunnableWorkflow`/`writeGraphWorkflow` (`workflows.mjs`), `setWireCycles` (`config.mjs`) and `test/helpers/graph-ports.mjs`. The interim 400 refusal `template is a graph — runs on the graph engine (not available yet)` in `POST /api/run`, the CLI and Ask is P4's to delete when `createOrchestratorFor` routes v2 rows. `resolveGraph` returns `{ template, ports, loops, nodes, wires, agentsByKey, agentKeys }` (Task B4 contract) — P4 consumes all seven fields and re-derives none.

## Clarifications (Q&A)

- **D1 Landing** — one plan per stage, or one big branch? → **New plan + new implementation on top of dev; the old branch is borrowable source only; 8 plans, each leaving `npm test` green and dev shippable; P2/P5/P6/P8 split into two independently-green halves (user decision 2026-08-26).**
- **D6 Scope** — is the graph core enough without sidecar ports? → **No: engine + composer + monitor + migration + Agents view + agent-gen + plugins + CLI are all in scope, so the sidecars are ported in P2a and every consumer reads ONE port source (user decision 2026-08-26).**
- **D7 Migration** — convert v1 rows or archive them? → **ARCHIVE every non-migrated v1 row (kept, hidden, never listed or runnable, audited); no fingerprint conversion. P2 only adds `archived_at`; V24 in P8 does the archiving (user decision 2026-08-26).**
- **A1–A4 parity** — may the graph engine change agent order, files, gates or budgets? → **No: parity is mandatory; P2 ships the port/loop/budget semantics that make it possible (base spec, Amendment f).**
- **V7 single-wire** — one wire per input, or fan-in at the input? → **Exactly ONE inbound wire per input, uniform across agent ports, the synthesized `await`, AND/OR/Combine `inK` and `end.result`; fan-in is an explicit OR card (Amendment f, superseding Amendment e).**
- **V22** — keep the await-port cardinality rule? → **RETIRED and subsumed by the restored V7; the number stays reserved so V-rule references remain stable (Amendment f).**
- **Shared-core location** — `src/shared/graph/`, `src/core/graph/pure/` or `ui/public/shared/`? → **`src/shared/graph/`, imported by RELATIVE paths that walk above the static root; absolute specifiers and import maps are forbidden (agent adjudication adj-b §Verdict 1–2).**
- **Browser port metadata** — embed a table or fetch it? → **Fetch: `GET /api/agents` already returns normalized meta, so ports ride it as soon as `normalizeMeta` merges v2; `EMBEDDED_AGENTS` is retired in P5 (adj-b §Verdict 3).**
- **Sidecar coexistence** — v2-only sidecars, a parallel file, or dual shape? → **DUAL SHAPE: the 11 builtins gain `metaVersion:2` + ports + capabilities and KEEP every v1 field until the P8 kill list, because both engines read the same files (adj-f1 §2).**
- **An invalid v2 sidecar** — half-load it or skip it? → **Warn and skip the WHOLE sidecar; an agent whose ports are wrong is worse than an agent that is absent (adj-f1 §2).**
- **An unknown `mockRole`** — 400 or warning? → **Warning + the field is dropped; the generic mock chain applies (adj-f1 §1, spec §6).**
- **`MOCK_WRITER_ROLES`** — where does the vocabulary live? → **`claude-runner.mjs` exports the 14-role Set plus `MOCK_ROLE_CLARIFY`/`MOCK_ROLE_DECOMPOSER`, pinned in lockstep with the switch arms by a structural test; shared code never imports it — it is passed in (adj-f2 §3).**
- **V23 shape** — rewrite data or add columns? → **Purely additive (columns + one table), all through `INCREMENTAL_COLUMNS`/`INCREMENTAL_TABLES` gap-healing, no backup, no row touched; the break is V24 in P8 (spec §10.1, adj-e §2 as amended by D7).**
- **`config_workflow_wires` PK order** — rewrite the residue table? → **No: the user's DB already carries it with `(workflow_id, project_key, wire_id)`; every statement names its columns, so the order is inert (adj-e §0).**
- **Legacy per-role overlay** — migrate it to node ids? → **Not migrated: it stays a `wf_default`-only layer addressed by agent KEY (adj-e §2).**
- **`node.defaults`** — keep the 88851499 layer? → **Superseded by `node.config`; `PATCH /api/workflows/:id/defaults` rewrites `graph.nodes[].config` for the 4 tunables on v2 rows (spec §4, adj-e §5).**
- **Running a v2 row at P2** — silently ignore it, or refuse? → **Refuse with ONE message and ONE status: HTTP 400 `template is a graph — runs on the graph engine (not available yet)` through the same `badRequest` path as `unknown workflowId` and the ARCHIVED refusal (CLI: the same text, exit 2). P4 deletes the branch (agent adjudication, cross-plan pass 2026-08-27 — one status per route; dev's gate at `ui/server.mjs:1062` is already 400).**
- **The 422 body** — server-authored text or the validator's? → **The shared validator's issues verbatim, asserted by a deepEqual identity test, so the composer and the server can never disagree (adj-b §Verdict 4).**
- **Shim `steps` cells** — how is a "rank" defined for a graph? → **One `agents` cell per `rankNodes` rank (longest path, loop wires excluded), nodes ordered by `launchOrder` inside a cell; flow nodes included with `key: null`; Ask `shapeWorkflow` groups by the same rank. This IS what the spec's "condensation-topo rank" means — pure condensation would fold a whole loop into one cell, which no v1 stepper ever showed (agent adjudication, cross-plan pass 2026-08-27).**
- **`canWire` reasons** — free text or codes? → **`{ok, code?, reason?}` with `V0 same node`, `V5 unknown port`, `V7 already connected`, `V8 <out> → <in> type mismatch`, `V12 or inputs must match: <type>`; the composer's chip renders `reason` verbatim (planner default; the reason strings are the spec's §7.5 chip texts).**
- **`Issue` fields** — how is V12's homogeneity reported? → **`{code, message, nodeId?, wireId?, portId?}` plus `wireIds?: string[]` on V12's or-homogeneity issue alone — a type clash has no single wire to point at (planner default).**
- **`resolveGraph` return shape** — one merged template or template + overlays? → **`{template, ports, loops, nodes, wires, agentsByKey, agentKeys}`: `template` is a deep copy carrying the RESOLVED agent keys (workspace substitution) with `node.config` untouched, `ports`/`loops` are computed once here, `nodes[id]` adds `authoredKey`, `config` and `duplicateKey`; P4 passes `nodes`/`wires` to `buildGraphManifest` as `overlays`, `ports`/`loops` to the scheduler, and re-derives nothing (agent adjudication, cross-plan pass 2026-08-27: an authored-key template walked against the substituted index would lose the reviewer's loop on workspace runs).**
- **Workspace variants** — key list or meta-driven? → **Meta-driven: `workspaceVariants(registry)` reads `scope:'workspace-only'` + `workspaceVariantOf`, ties break builtin > user > plugin, and the variant's port signature must deep-equal the target's (spec §5.10).**

