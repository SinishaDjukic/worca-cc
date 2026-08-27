# Cross-plan contract-consistency manifest — node-graph v2 REBUILD (P1–P8)

Adjudicator: Fable 5 (max effort), 2026-08-27. Inputs: the rebuild spec `docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` (wins on every conflict), base spec Amendment f (V-rules / firing), the HANDOFF, `open-points.md` (the writers' own index), the eight plans (25,149 lines), and dev @ e6968e15 read-only (quoted where a decision hinges on a dev fact: `orchestrator.mjs:2834-2900/3074-3412/3746-3818`, `workflows.mjs:91-108`, `ui/server.mjs:1055-1062`, `channels.mjs:279-300`, the old-branch seed for `wf_clarify-implement`). Every `old_string` below was verified to occur exactly once in its plan file (136/136).

## A. Canonical contract sheet

Legend: **decision** = the canonical name/shape/text; *why* = one-clause rationale; → plans that must change. "spec" = `2026-08-26-node-graph-v2-rebuild-design.md`; "f" = base-spec Amendment f.

- **A1 · `resolveGraph` return shape** · `resolveGraph(projectDir, workflowId, registry, agentsDir?, {isWorkspace}) → { template, ports, loops, nodes, wires, agentsByKey, agentKeys }`. `template` = a deep clone of the stored row whose agent `node.key` is the RESOLVED key (workspace substitution applied; `node.config` untouched); `ports = registryPortsFn(agentsByKey)`; `loops = classifyLoops(template, ports)`; `nodes[id]` (agent) = `{ nodeId, kind:'agent', key, authoredKey, meta, runnerType, agentFile, agentPrompt, promptHints, tools, config, model, effort, fanOut, askQuestions, awaitAll, duplicateKey }`, (flow) = `{ nodeId, kind, key:null, config }`; `wires[id] = {maxCycles}` for LOOP wires only (overlay-merged). *why*: P2 already computes `portsFn`+`classifyLoops` internally (returning them is free and removes P4's second Tarjan); on a workspace run P2's own `classifyLoops(tpl, registryPortsFn(agentsByKey))` walks AUTHORED keys against a SUBSTITUTED index — the reviewer's ports vanish and the review loop loses its budget, so the resolved key must be on the template (v1 parity: `resolveWorkflow` returns the substituted plan). → P2 (Task B4 contract + code + Q&A), P4 (Interfaces, `_adoptResolvedGraph` aliases `nodeCtx = resolved.nodes`, `resolvedFromManifest` returns the same shape).
- **A2 · manifest build call** · `buildGraphManifest(g.template, g.agentsByKey, { overlays: { nodes: g.nodes, wires: g.wires } })`; the builder stamps `template:{id,name}` from `tpl.id/name` (the alias row already carries the requested id), reads only `model/effort/fanOut/askQuestions/awaitAll` off each node overlay and `maxCycles` off each wire overlay. *why*: one resolver output feeds both engine and manifest; P4's `_overlays()` re-derivation used the AUTHORED `w.config.maxCycles` (dropping the DB overlay) — deleted. → P4.
- **A3 · scheduler callbacks** · P3's split is canonical: `onAsk(ask) → Promise<answer>` is the ONE ask channel (gate ask payload `{ id:'gate-<wireId>-<deliveryNo>', kind:'gate', wireId, nodeId:<source node>, executionId, issues }`, answer `'another'|'continue'`, anything else = continue); `onGate(gate|null)` is the `state.gate` NOTIFIER (`{wireId, fromNode, toNode, askId}`); `onEvent('gate', {wireId, nodeId, executionId, issues, askId, status:'held'|'another'|'continue'})` is audit-only. No `deliveryNo` field on the ask payload (it is the id's last segment). *why*: P3 lands first, the harness `_ask` already returns `{decision}` for gate asks (dev `_gate :2894`), and one channel keeps `_enqueueAsk` serialization. → P4 (`onAsk: (q) => this._schedulerAsk(q)` mapping `{decision}` → `'another'|'continue'`; `onGate: (g) => { this.state.gate = g ? {...g} : null }`; `_gateAsk` deleted; Q&A P5), P6 (`formatGateHeader` parses the delivery number from `payload.id`).
- **A4 · `question` event fields** · harness `_ask({ id, kind, questions, issues, recovery, agent, nodeId, wireId, executionId })` emits `wireId`/`executionId` only when present (2-arg v1 calls byte-identical) — spec §5.7. → P4 Task 1 (new Step 3b).
- **A5 · pause inside an execution** · `execute` resolves `{ paused: true }` (P3 Task 5 protocol): ledger row `paused`, non-terminal, nothing publishes, `reattach` re-invokes. *why*: `{outputs:{}}` (spec §5.4 literal) would COMPLETE the execution in the scheduler, mark it terminal in the snapshot and hang the resume at quiescence; spec §5.6 ("executions marked paused, non-terminal") is the governing semantics. → P4 (`_execute` catch returns `{ paused: true }`; Q&A E7).
- **A6 · Task-card document** · P4 stamps `ctx.taskArtifact = { text: renderPromptArtifact(this.pipeline.promptText, this.extrasFiles) }` (import from `../channels.mjs` until P8, which re-homes the helper into `phases.mjs` and re-points the import); P3's `runTaskExecution({ node, taskArtifact:{path}|{text}, runCtx })` unchanged. *why*: v1 seeds the task file with exactly that renderer (`orchestrator.mjs:2044`) — byte parity of the produced task document. → P4, P8 (Task 13 Step 1 names the importer).
- **A7 · `getState()` shape** · P3's: `{ active:[{nodeId,executionId}], executions:[…], tokens:{'<node>.<outPort>':{seq,type,path,firedAt}}, wireDeliveries:{[wireId]:n}, ended, endReached, result, warnings:[…], gate, settled }`. → P4 `_syncSchedulerState` reads `wireDeliveries` (not `wires`), `warnings`, `endReached`, `result`.
- **A8 · quiescence text** · ONE literal `finished at quiescence — End not reached`: `export const QUIESCENCE_WARNING` in `src/core/graph/scheduler.mjs` (P3, source of `state.warnings`); P4 imports it and defines none; `run-decor.mjs` keeps the same literal (browser cannot import engine code); CLI summary prints the capitalised display form `Finished at quiescence — End not reached` (spec §8). → P4 (delete its long text; mirror `state.warnings` from the scheduler; `_recordRunWarning` is NOT used for it — it writes the run-root manifest, not `state.warnings`).
- **A9 · slice numbering** · `exec` events with `kind:'task'` carry `taskIndex` (1-based index inside its phase) and `taskTotal` (that phase's task count); the scheduler emits them (also stored on snapshot `execs[]`), the orchestrator writes them on the ledger row and in `exec_meta`, `stepRowToStep` reads them back; the CLI renders `task 3/7`. → P3 (`runSlice` sub record + `emitExec` spread + snapshot doc), P4 (`_execStep`, `writeState` exec_meta, `stepRowToStep`), P6 (already reads them).
- **A10 · ports access path** · `portsFn(node)` for a ported agent = `{ ...meta, known:true, ported:true, inputs:[...meta.inputs, AWAIT_PORT], outputs }` so `ports.verdict` IS the sidecar verdict block; `manifestPortsFn` synthesizes `verdict:{filename:''}`; the executor reads `ctx.ports = portsFn(node)` (P4 `_execCtx` does); `portsOf(portsFn, node)` (`{known, ported, inputs, outputs, meta}`) is the never-throwing wrapper for validator/UI. `firedOutputs(portsOrOutputs, verdict)` accepts an outputs ARRAY or a resolved ports object (P2 shipped); P3 passes the array — the "check P2's signature" hedge is removed. → P3 (Task 2 Consumes note).
- **A11 · view fast paths (the P5⇄P6 seam)** · `view.mjs` (P5a Task 2) ships the run-mode fast paths with P6's vocabulary: `setFooter(nodeId, bands)` — `bands = [] | null | [{kind:'fan', leds, count} | {kind:'strip', leds, summary, expanded} | {kind:'exec', executionId, led, label, right} | {kind:'result', text, path}]`, DOM `.xfoot` rebuilt, card height = `nodeSize(node, ports, {footerRows: bands.length})`; `setNodeChrome(nodeId, {color, gate, totals})` (also stamps `run-node` + `data-id`); `setWireBadge(wireId, badge|null)`. `render(template, {selection, report})` has NO `decor` option and the view has NO `applyDecor`; the ONE decor pass is `applyDecor(view, decor)` in `run-decor.mjs` (P6). *why*: the spec's `setFooter(nodeId, rows)` means the footer's rows (→ `nodeSize`), the view owns every card byte, and P6 must not rewrite P5's function body. → P5 (Task 1 remove `applyDecor`/`decor`; Task 2 code + tests; handoff), P6 (Task 3 becomes consume-only + CSS; Q&A P6-2/P6-3).
- **A12 · nav engagement** · `view.createNav({ wheelPan, onEngaged })` — P5 adds `onEngaged(bool)`; monitor hosts MUST call `view.createNav({ wheelPan:'engaged', onEngaged })` (the view never auto-binds a nav); `run-hosts` toggles `rg-engaged` from the callback and keeps no engagement state of its own; static hosts never call it. → P5 (Task 3 `createNav`), P6 (Task 5 `bind()`; Step 4 deleted).
- **A13 · transform shape** · `{x, y, z}` on `setTransform`/`getTransform`; `fitBounds` returns `{z, tx, ty}` and is mapped at the call site. → P6 (`fitInto` `{zoom}` was a bug).
- **A14 · bounds + fit** · ONE source: `graphBounds(tpl, portsFn, {pad, footerRowsOf(node)})` + `fitBounds(bounds, {width, height}, {zoomMin, zoomMax})` from `src/shared/graph/geometry.mjs`; the view's `bounds()`/`fit()`/`fitToWidth()` and `run-hosts`' `fit()` delegate to them (P6's private `worldBounds`/`fitInto` deleted; P5 Q11 void — `footerRowsOf` is exactly the hook it wanted). → P5 (Task 3), P6 (Task 5).
- **A15 · host clearing** · the view PREPENDS its stage; a host that held v1 columns is cleared (`innerHTML=''`) BEFORE `createGraphView`, never after; `destroy()` = `view.destroy()` then clear. → P6 (already ordered so — recorded, no edit).
- **A16 · HTTP status for non-runnable templates at `POST /api/run`** · 400 for NOT_FOUND (`unknown workflowId "<id>"` — dev's text at `ui/server.mjs:1062`), ARCHIVED (spec §4 text) and P2's interim v2 refusal `template is a graph — runs on the graph engine (not available yet)`; 409 nowhere on this route; CLI `fail()` exit 2; `GET /api/workflows/:id` → 404 (spec). *why*: dev's existing gate on this route is 400 and one status per route beats a semantic argument about 409. → P2 (B7 bullets/tests/code), P4 (already 400 — no change).
- **A17 · harness hooks (P1 as executed)** · `_resolveTopology(registry) → { manifest, agentKeys:Set, workflow:{id, name} }`; `_engineRun({ resume, rehydrated }) → 'done'|'paused'` (fresh run: `{ resume: null }`); `_enginePrePausePoint() → point`; `_engineRehydrate(rp) → { checkpointRef, memberWorktrees, plan?, audit? }` (the base writes `rehydrated.audit`); `_bookend(name, status)` (base; calls `_phase`, which lives on the harness until P8); `_initRunners(opts)` (constructor seam); `_preflightAgentKeys(iterable)` on the harness. GraphOrchestrator implements exactly these: returns `workflow`, supplies `audit`, ignores `rehydrated`, sets `this._runners` in `_initRunners`. *why*: P1 executed green against the 126-test oracle; the extra fields are additive. → P4 (`_resolveTopology`, `_engineRehydrate`, constructor).
- **A18 · telemetry hoist owner** · P4 Task 1 moves `_onAgentEvent` + the five reducers + `_upsertSubAgent`/`_subAgentTransition` + `_recordCost` + their 13 module helpers onto `RunHarness` (pure move, 25-suite oracle, grep-guarded); P1 leaves them in `orchestrator.mjs` as executed and records that P4 moves them. *why*: dev's block reads only `attr.*` and `state.steps[].key` (verified `orchestrator.mjs:3074-3412`), so spec §5.1's "adapted twin" would be byte-identical — a move, not a twin; P1's validated extraction script is not re-cut for it. → P1 (one Q&A line), P4 (no change).
- **A19 · shim rank definition** · one `agents` cell per `rankNodes` rank (longest path, loop wires excluded), nodes in `launchOrder` inside a cell, flow nodes included with `key:null` — for the manifest shim cells AND Ask `shapeWorkflow`; this IS what the spec calls "condensation-topo rank". *why*: pure condensation would fold implementer+reviewer(+OR) into one cell, which no v1 stepper ever showed. → P2 (B8 prose), no P4/P6 change (they consume the cells).
- **A20 · V4 / resolve refusal texts** · ONE text each, double quotes: `unknown agent "<key>" — no such key in the registry` · `agent "<key>" has no v2 ports — port its sidecar to metaVersion 2` · `agent "<key>" declares placeable: false and cannot be a graph node`; the validator's V4 and `resolveGraph`'s throws are byte-equal. *why*: dev's messages quote ids with double quotes (`unknown workflowId "<id>"`). → P2 (Task 3 table/code/tests; B4 unknown-key text).
- **A21 · ARCHIVED / ENGINE_RETIRED texts** · spec §4 ARCHIVED sentence verbatim (P2 B2, P4 Task 7, P6 Task 16 already agree); `V1_RUN_RETIRED = 'paused on the v1 engine before the graph rework — not resumable'` (P8 = spec §5.2). No change.
- **A22 · plugin API-mismatch message** · ONE text, ONE formatter: `apiMismatchMessage(mismatch)` exported from `src/core/plugin-manifest.mjs` returns the spec §9 sentence (`built for plugin API ${builtFor ?? 'an older version'}; this version of worca requires plugin API 3 for agents and pipeline templates — update or reinstall the plugin (${n} agent(s), ${m} template(s) ignored)`); `apiMismatch()` stamps it as `message` on its result; `apiMismatchDetail` is deleted; the Plugins view renders `p.apiMismatch.message`; the doctor's `agents-api` check and `worca plugin list` print the same `message`. *why*: adj-f2 §1.5 + one canonical text per message. → P7 (Task 1, Task 6, Q&A P7.7).
- **A23 · ignored-sidecar log line** · P7's `[agent-registry] <origin>/<file>: built for <plugin API N | an older plugin API> — worca requires plugin API 3 (a metaVersion 2 sidecar with typed ports) — ignored` accepted (a log line, not UI copy); `importPluginWorkflows` uses the same sentence with the `[plugin-workflows]` prefix. No change.
- **A24 · `canWire` reason codes** · P2's `{ok, code?, reason?}` with `V0 same node` · `V5 unknown port` · `V7 already connected` · `V8 <out> → <in> type mismatch` · `V12 or inputs must match: <type>` accepted; the chip renders `reason` (spec §7.5 texts). No change.
- **A25 · `scanLayer` v2 gate** · PLUGIN layers only (P7); builtin/user v1-only sidecars stay loaded for the live v1 engine (spec §6 coexistence + §9 "registry scanLayer … skip non-v2 data" is about plugin data); adj-f2 §1.3 "all layers" superseded. No change.
- **A26 · `phases.mjs` survivors** · P8's survivor set += `runOpts`, `READ_WRITE_TOOLS`, `IMPLEMENTER_TOOLS` (P3 exports them; the executor imports them) and the re-homed `renderPromptArtifact`/`renderAttachmentsBlock` (P4's orchestrator is the importer to re-point). → P8 (Task 13 Interfaces + Step 1/2; Q&A B10).
- **A27 · bookend ids** · `export const BOOKEND_EXECUTION_IDS = Object.freeze(['x:preflight:1', 'x:done:1'])` in `src/shared/graph/constants.mjs` (P1 Task 5); `run-decor.mjs` imports it (its private `BOOKEND_EXECS` goes; `BOOKEND_NODES` stays for pre-P8 rows), `src/cli/render.mjs` imports it and `formatExecLine` returns `''` for a bookend; P8 Task 16 Step 5 becomes a verify. P8's `_bookend` rewrite (`_recordStep(executionId, 0, …)` then stamp exec columns) stands against P1's `_bookend(name, status)` signature. → P1, P6, P8.
- **A28 · `FB_WIRE_MAP` for `wf_clarify-implement`** · V24 uses the STATIC maps only (spec §10.2); the fb↔wire pairing for that seed is a pinned CONVENTION — `fb_0` = the review loop (`w9`), `fb_1` = the refine self-loop (`w5`) — which P3's v1 fixture follows and P1's structural test asserts verbatim. → P1 (test + Q&A P1-q), P8 (no change — static already), P3 (no change — fixture follows the map).
- **A29 · `GRAPH_DEFAULT_WORKFLOW` timestamps** · P1 keeps the byte-identical copy (no stamps); P4's `graphDefaultAliasTemplate()` adds `createdAt/updatedAt = '1970-01-01T00:00:00.000Z'` (dev's `DEFAULT_WORKFLOW` convention, `workflows.mjs:107-108`) so the listed alias row has the same shape as every other template; P8a adds them to the constant at the flip (already conditional). → P4.
- **A30 · constants shapes** · `KINDS`/`FLOW_KINDS`/`PORT_TYPES` are frozen ARRAYS → membership is `.includes()`; P2 validate V3 `KINDS.has` and P3 scheduler `FLOW_KINDS.has` are bugs. `WIRE_ID_RE = /^w_?[a-z0-9]{1,32}$/` (P2 mints `w_…`, seeds use `w1…`) ✓; gate inputs `required:true` ✓ (V12 forces wiring anyway); `LIMITS` keys ✓. → P2, P3.
- **A31 · test helpers + file names** · `test/helpers/graph-ports.mjs` (P2: `realAgentMetas()`, `realRegistryIndex()`, `realPortsFn()`) is the real-sidecar helper for the PURE-module suites; P3's prompt-parity and mock-graph suites deliberately use `registryPortsFn(loadAgentRegistry(agents/, {userAgentsDir:null, includePlugins:false}))` — the REAL registry merge the engine runs on (it stamps `agentFile`/`agentPath`/`origin`), which is the better parity oracle; both read the real sidecars, neither copies a `FIXTURE_PORTS` table (spec §3's rule) — accepted, no edit. Allowed new helpers: `test/helpers/graph-run.mjs` (P3), `test/helpers/engines.mjs`, `test/helpers/git-dir.mjs` (P4), `test/helpers/db-residue-v22.mjs`, `test/helpers/db-collision.mjs` (P8, spec). Allowed extra test files beyond spec §12: P2 `test/graph-registry-ports.test.mjs`, `test/mock-writer-roles.test.mjs`, `test/workflows-resolve-graph.test.mjs`, `test/db-migrate-v23.test.mjs` (+ its other per-task suites); P3 `test/phases-graph-seams.test.mjs`, `test/graph-seed-v1-fixtures.test.mjs`; P4 `test/run-harness-attr.test.mjs`, `test/api-workflows-graph-alias.test.mjs`, `test/artifacts-exec-ledger.test.mjs`, `test/orchestrator-graph-resume.test.mjs`, `test/api-run-engine-dispatch.test.mjs`; P7 `test/ui-agent-port-editor.test.mjs`. → no change.
- **A32 · single ownership** · `_log`/`_artifact`/`_ask` attribution + the telemetry hoist = P4 Task 1 (`subagent`/`stepskills`/`stepgraphify` payloads carry `executionId` from `attr.stepKey` — P6 Task 14 Step 1 verifies); End-artifact routes = P6 (P4 records `_artifact('result', …)`); `assertRunnableWorkflow` on `POST /api/run` + CLI + Ask = P2 B7 (P6 Task 16 Step 1 verifies only); Archived footer = P5 now (renders only when `?archived=1` returns rows — accepted); `EVENT_NAMES` += `exec`,`token` (P4), −`phase` (P8); `style.css`: P5 re-scopes `:1094-1121` / deletes `:1032-1093`,`:1123-1167`; P6 APPENDS one block after the v1 run-flow block (`:1258-1381`, reusing its keyframes); P8 deletes that v1 block and re-homes `.nstat`/`.fan`/keyframes — P6's block must survive P8 (it is scoped `.run-flow .gv-world`). No two plans edit one range incompatibly.
- **A33 · sentinels** · every Task 0 grep matches its producer's literal text: P2←P1 `export class RunHarness`, `export const SEED_TEMPLATES`; P3←P2 `export function validateGraph`, `SCHEMA_VERSION = 23`, `export const MOCK_WRITER_ROLES`, `export function registryPortsFn`, …; P4←P3 `export function createScheduler`, `export function sliceExecutionId`, `export function runAgentExecution`; P4←P1 `class RunHarness extends EventEmitter` (P1 writes `export class RunHarness extends EventEmitter {`); P4←P2 `export async function resolveGraph`, `kind: 'preflight'` (P2 manifest.mjs line `{ kind: 'preflight', nodes: [...] }`), `execution_id`; P5←P4 `export function createGraphOrchestrator`, `wf_default_v2`; P6←P5 `export function createGraphView`, `class="gv-head"`; P7←P6 `export function decorFromState`, `src/cli/render.mjs`; P8←P7 `WORCA_PLUGIN_API = 3`, `agentFormRender`. All consistent — no change.
- **A34 · ledger row + `exec_meta`** · v2 step row = `{ key, executionId, nodeId, kind, ordinal, cycle, agentKey, phase, stepIndex:null, status, startedAt, updatedAt, endedAt, activeMs, runningSince, trigger, taskId?, parentExecutionId?, title?, phaseOrdinal?, taskIndex?, taskTotal?, result?, sessionId?, costUsd? }`; `exec_meta` JSON = `{ taskId, parentExecutionId, title, phaseOrdinal, taskIndex, taskTotal }` (additive to spec §5.9). → P4.
- **A35 · Q&A attribution hygiene** · no invented user answers found except P6 "D2" claiming per-mode zoom clamps as a user decision (D2 = no on-canvas controls + 0.4–1.6; the per-mode clamps are spec §7.6/§8). No `TBD/TODO/see spec/<!--END-->` placeholders in any plan; "worca-cc" appears only in paths, env/manifest keys, temp-dir prefixes, one v1 prompt literal pinned for parity (P3 `V1_CHECKLIST_DETACHED`, dev bytes) — all allowed. → P6 (one Q&A line).
- **A36 · workspace fan-out forcing** · owned by `resolveGraph` (spec §5.10: `fanOut = true` where `meta.workspaceFanOut` on an `isWorkspace` resolve); P4's `_adoptResolvedGraph` no longer re-forces or mutates template nodes. → P4.
- **A37 · v2 resume audit line** · `_engineRehydrate` returns `audit: \`Pipeline **resumed** (graph snapshot at seq ${rp.snapshot?.seq ?? 0}).\`` (the base writes it — A17). → P4.
- **A38 · P4 `_taskArtifact` / `_runFlow`** · `_runFlow` passes `taskArtifact: this._taskArtifact` where `_taskArtifact = { text }` (A6); flow executors receive `{...args, runCtx, taskArtifact, allocatedPath, names}` (P4 shape, consistent with P3's `runTaskExecution({node, taskArtifact, runCtx})` / `runCombineExecution` inputs). No further change.

## B. Edit manifest

Conventions: every edit is an exact-string replacement (`old_string` → `new_string`, both verbatim; indentation and backticks preserved). Verify each `old_string` with `grep -c -F -- '<first line>' <file>` = 1 before applying. Multi-line `old_string`s are shown in fenced blocks; the fence itself is not part of the string. P1/P2 edits stay at the contract level (Interfaces / code signatures / Q&A) because both get full refinement next.

### P1 — `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P1-harness-split-foundations.md`

**P1-E1** (A27 — `BOOKEND_EXECUTION_IDS` lands in the shared constants)
old_string:
```
/** Structural ceilings the validator enforces (override per call with
 *  `validateGraph(tpl, portsFn, { limits })`). */
export const LIMITS = Object.freeze({
```
new_string:
```
/** The two ledger rows every run writes for its own bookends (P8 makes them
 *  `exec` rows keyed exactly so). Shared by the run monitor and the CLI so
 *  neither counts them as executions or progress. */
export const BOOKEND_EXECUTION_IDS = Object.freeze(['x:preflight:1', 'x:done:1']);

/** Structural ceilings the validator enforces (override per call with
 *  `validateGraph(tpl, portsFn, { limits })`). */
export const LIMITS = Object.freeze({
```

**P1-E2** (A27 — test import)
old_string:
```
  gatePorts, NODE_ID_RE, WIRE_ID_RE, PORT_ID_RE, DEFAULT_MAX_CYCLES, MAX_PORTS_PER_SIDE, LIMITS,
} from '../src/shared/graph/constants.mjs';
```
new_string:
```
  gatePorts, NODE_ID_RE, WIRE_ID_RE, PORT_ID_RE, DEFAULT_MAX_CYCLES, MAX_PORTS_PER_SIDE, LIMITS,
  BOOKEND_EXECUTION_IDS,
} from '../src/shared/graph/constants.mjs';
```

**P1-E3** (A27 — one pin; the suite count in this task becomes 10)
old_string:
```
test('LIMITS carries the ceilings the validator reads', () => {
```
new_string:
```
test('BOOKEND_EXECUTION_IDS names the two bookend ledger rows, frozen', () => {
  assert.deepEqual([...BOOKEND_EXECUTION_IDS], ['x:preflight:1', 'x:done:1']);
  assert.ok(Object.isFrozen(BOOKEND_EXECUTION_IDS));
});

test('LIMITS carries the ceilings the validator reads', () => {
```

**P1-E4** (A27 — expected count)
old_string:
```
After Step 1: `node --test test/graph-constants.test.mjs` → `# pass 9`, `# fail 0` (measured 2026-08-27).
```
new_string:
```
After Step 1: `node --test test/graph-constants.test.mjs` → `# pass 10`, `# fail 0` (9 measured 2026-08-27 + the `BOOKEND_EXECUTION_IDS` pin added by the cross-plan pass).
```

**P1-E5** (A27 — Interfaces list of Task 5)
old_string:
```
**Interfaces:** produces `TEMPLATE_VERSION, KINDS, FLOW_KINDS, PORT_TYPES, AWAIT_PORT, TASK_PORTS, END_PORTS, gatePorts(kind, arity), NODE_ID_RE, WIRE_ID_RE, PORT_ID_RE, DEFAULT_MAX_CYCLES, MAX_PORTS_PER_SIDE, LIMITS` — consumed by P2's `ports/loops/validate/template/geometry/layout/manifest` and by the composer in P5. Pure: no imports at all.
```
new_string:
```
**Interfaces:** produces `TEMPLATE_VERSION, KINDS, FLOW_KINDS, PORT_TYPES, AWAIT_PORT, TASK_PORTS, END_PORTS, gatePorts(kind, arity), NODE_ID_RE, WIRE_ID_RE, PORT_ID_RE, DEFAULT_MAX_CYCLES, MAX_PORTS_PER_SIDE, LIMITS, BOOKEND_EXECUTION_IDS` — consumed by P2's `ports/loops/validate/template/geometry/layout/manifest`, by the composer in P5, and (`BOOKEND_EXECUTION_IDS`) by P6's `run-decor.mjs` + `src/cli/render.mjs` and P8's bookend rows. `KINDS`/`FLOW_KINDS`/`PORT_TYPES` are frozen ARRAYS — consumers test membership with `.includes()`, never `.has()`. Pure: no imports at all.
```

**P1-E6** (A28 — pin the `wf_clarify-implement` pairing statically)
old_string:
```
    for (const fbId of Object.keys(map)) assert.match(fbId, /^fb_/, `${wfId}: ${fbId}`);
  }
});
```
new_string:
```
    for (const fbId of Object.keys(map)) assert.match(fbId, /^fb_/, `${wfId}: ${fbId}`);
  }
});

test('FB_WIRE_MAP pins the fb_N ↔ wire PAIRING of wf_clarify-implement (a convention, not a DB fact)', () => {
  // That seed is absent from the reference DB, so its v1 feedback ORDER is a
  // convention shared with P3's v1 fixture (test/fixtures/workflows-v1/wf_clarify-implement.json):
  // fb_0 = the review loop (n_review.review -> n_impl.fix, w9), fb_1 = the refiner
  // self-loop (n_refine.revise -> n_refine.revise, w5). V24 applies the STATIC
  // maps only (spec §10.2), so this pairing is load-bearing and pinned verbatim.
  const t = byId['wf_clarify-implement'];
  assert.deepEqual({ ...FB_WIRE_MAP['wf_clarify-implement'] }, { fb_0: 'w9', fb_1: 'w5' });
  assert.deepEqual([t.wires.find((w) => w.id === 'w9').to.port, t.wires.find((w) => w.id === 'w5').to.port], ['fix', 'revise']);
});
```

**P1-E7** (A28 — mutation audit (c) no longer claims a dynamic V24)
old_string:
```
(c) change `FB_WIRE_MAP['wf_clarify-implement']` to `{ fb_0: 'w5', fb_1: 'w9' }` → the resolver test still passes (the mapping is a SET equality plus a per-wire resolve, and both wires are budget-bearing) — this is deliberate: the fb_N ↔ wire pairing for that template is unverifiable (the row is absent from the reference DB), which is exactly why V24 uses the dynamic resolver and not the static map for that case. Note it and move on;
```
new_string:
```
(c) change `FB_WIRE_MAP['wf_clarify-implement']` to `{ fb_0: 'w5', fb_1: 'w9' }` → the resolver test still passes (SET equality + per-wire resolve) but the PAIRING pin test fails — that pin is the contract V24's static overlay map (spec §10.2, static maps only) and P3's v1 fixture both follow;
```

**P1-E8** (A28 + A18 — Q&A)
old_string:
```
- **P1-q** — What proves `FB_WIRE_MAP` right? → **A dynamic `(from,to)` resolver written inside the test (unique `maxCycles`-bearing wire, following `and`/`or`/`combine` valves ≤ 4 hops) plus set-equality with each graph's budget-bearing wires. The fb_N ↔ wire PAIRING for `wf_clarify-implement` is unverifiable (that row is absent from the reference DB) — which is exactly why V24 resolves dynamically and uses the static map only as a fallback** (adj-e §2/§3).
```
new_string:
```
- **P1-q** — What proves `FB_WIRE_MAP` right? → **A dynamic `(from,to)` resolver written inside the test (unique `maxCycles`-bearing wire, following `and`/`or`/`combine` valves ≤ 4 hops) plus set-equality with each graph's budget-bearing wires. The fb_N ↔ wire PAIRING for `wf_clarify-implement` cannot be read off a DB row (that row is absent from the reference DB), so it is a pinned CONVENTION — `fb_0` = the review loop `w9`, `fb_1` = the refiner self-loop `w5` — asserted verbatim here and followed by P3's v1 fixture; V24 (P8) applies the STATIC maps only, exactly as spec §10.2 says** (agent adjudication, cross-plan pass 2026-08-27; adj-e §2/§3 for the resolver).
- **P1-r** — Do `_onAgentEvent`, the sub-agent/skills/graphify reducers and `_recordCost` move to the harness here? → **No. They stay in `orchestrator.mjs` in this plan (spec §5.1 lists them as SHARED-BUT-SHAPE-CHANGES); P4 Task 1 moves them onto `RunHarness` verbatim, because the only v2 difference is the VALUE of `attr.stepKey`, which the caller sets — the refiner must not fold that move into this plan's extraction script** (agent adjudication, cross-plan pass 2026-08-27).
```

### P2 — `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P2-shared-core-sidecars-schema-store.md`

**P2-E1** (A30 — `KINDS` is an array)
old_string:
```
      if (!KINDS.has(n.kind)) {
```
new_string:
```
      if (!KINDS.includes(n.kind)) {           // KINDS is a frozen ARRAY (P1 constants)
```

**P2-E2** (A20 — V4 texts, table row)
old_string:
```
| V4 | E | agent key resolves, is ported, and is placeable: `unknown agent '<key>' — no such key in the registry` · `agent '<key>' has no v2 ports — port its sidecar to metaVersion 2` · `agent '<key>' declares placeable: false and cannot be a graph node` |
```
new_string:
```
| V4 | E | agent key resolves, is ported, and is placeable: `unknown agent "<key>" — no such key in the registry` · `agent "<key>" has no v2 ports — port its sidecar to metaVersion 2` · `agent "<key>" declares placeable: false and cannot be a graph node` (double quotes — the same three sentences `resolveGraph` throws, byte-equal) |
```

**P2-E3** (A20 — V4 code)
old_string:
```
      if (!p.known) add(`unknown agent '${n.key}' — no such key in the registry`, { nodeId: n.id });
      else if (!p.ported) add(`agent '${n.key}' has no v2 ports — port its sidecar to metaVersion 2`, { nodeId: n.id });
      else if (p.meta?.placeable === false) {
        add(`agent '${n.key}' declares placeable: false and cannot be a graph node`, { nodeId: n.id });
      }
```
new_string:
```
      if (!p.known) add(`unknown agent "${n.key}" — no such key in the registry`, { nodeId: n.id });
      else if (!p.ported) add(`agent "${n.key}" has no v2 ports — port its sidecar to metaVersion 2`, { nodeId: n.id });
      else if (p.meta?.placeable === false) {
        add(`agent "${n.key}" declares placeable: false and cannot be a graph node`, { nodeId: n.id });
      }
```

**P2-E4** (A20 — V4 tests)
old_string:
```
  assert.match(V(u).errors.find((e) => e.code === 'V4').message, /^unknown agent 'ghost' — no such key in the registry$/);
  const l = ok(); l.nodes[1] = A('n_plan', 'legacy');
  assert.match(V(l).errors.find((e) => e.code === 'V4').message,
    /^agent 'legacy' has no v2 ports — port its sidecar to metaVersion 2$/);
```
new_string:
```
  assert.match(V(u).errors.find((e) => e.code === 'V4').message, /^unknown agent "ghost" — no such key in the registry$/);
  const l = ok(); l.nodes[1] = A('n_plan', 'legacy');
  assert.match(V(l).errors.find((e) => e.code === 'V4').message,
    /^agent "legacy" has no v2 ports — port its sidecar to metaVersion 2$/);
```

**P2-E5** (A1 — the `resolveGraph` contract block)
old_string:
```
**Interface produced (CONTRACT for P4's `_resolveTopology`, which calls `resolveGraph` and then `buildGraphManifest(g.template, g.agentsByKey, {overlays: {nodes: g.nodes, wires: g.wires}})`):**
```js
resolveGraph(projectDir, workflowId, registry, agentsDir = DEFAULT_AGENTS_DIR, opts = {}) → {
  template,                     // the stored v2 template, node.config UNTOUCHED (authored values)
  nodes: { [nodeId]: { nodeId, kind, key, meta, runnerType, agentFile, agentPrompt, promptHints, tools,
                       model, effort, fanOut, askQuestions, awaitAll } },   // EFFECTIVE per-node config
  wires: { [wireId]: { maxCycles } },                                       // loop wires only
  agentsByKey,                  // {key: meta} for every agent key in the graph (workspace-substituted)
  agentKeys,                    // Set<string> — feeds _preflightAgentKeys + collectRequiredSkills
}
```
`opts = { isWorkspace?: boolean }`. Flow nodes get a `nodes` entry too (`kind`, `key: null`, no model/effort) so the caller never has to branch on kind.
```
new_string:
```
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
```

**P2-E6** (A1/A16 — read + clone)
old_string:
```
  const tpl = await readWorkflow(workflowId);
  if (!tpl) throw new Error(`workflow not found: ${workflowId}`);
  if (tpl.version !== 2) throw new Error('template is not a graph — runs on the v1 engine');
```
new_string:
```
  const stored = await readWorkflow(workflowId);
  if (!stored) throw new Error(`unknown workflowId "${workflowId}"`);
  if (stored.version !== 2) throw new Error('template is not a graph — runs on the v1 engine');
  // The RESOLVED template: a private deep copy (the alias row spreads a deep-frozen
  // constant) whose agent nodes carry the RESOLVED key after workspace substitution.
  const tpl = structuredClone(stored);
```

**P2-E7** (A1/A20 — substitution on the template + unknown-key text)
old_string:
```
    const key = variants[authored]?.key || authored;
    const meta = reg[key];
    if (!meta) throw new Error(`agent "${key}" is not in the registry`);
```
new_string:
```
    const key = variants[authored]?.key || authored;
    if (key !== authored) node.key = key;          // the resolved template carries the resolved key
    const meta = reg[key];
    if (!meta) throw new Error(`unknown agent "${key}" — no such key in the registry`);
```

**P2-E8** (A1 — entry fields)
old_string:
```
      nodeId: node.id,
      kind: 'agent',
      key,
      meta,
      runnerType: meta.runnerType || 'producer',
```
new_string:
```
      nodeId: node.id,
      kind: 'agent',
      key,
      authoredKey: authored,
      meta,
      runnerType: meta.runnerType || 'producer',
```

**P2-E9** (A1 — entry `config`)
old_string:
```
      tools,
      model: firstDefined(sel.model, legacy.model, cfg.model),
      // An effort only travels with the model that advertises it: an override
```
new_string:
```
      tools,
      config: { ...cfg },
      model: firstDefined(sel.model, legacy.model, cfg.model),
      // An effort only travels with the model that advertises it: an override
```

**P2-E10** (A1 — duplicateKey, ports/loops computed once)
old_string:
```
  // Budgets ride LOOP wires only: overlay > authored > DEFAULT_MAX_CYCLES.
  const portsFn = registryPortsFn(agentsByKey);
  const { loopWireIds } = classifyLoops(tpl, portsFn);
```
new_string:
```
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
```

**P2-E11** (A1 — return)
old_string:
```
  return { template: tpl, nodes, wires, agentsByKey, agentKeys };
```
new_string:
```
  return { template: tpl, ports: portsFn, loops, nodes, wires, agentsByKey, agentKeys };
```

**P2-E12** (A1 — tests: the resolver returns ports/loops)
old_string:
```
  assert.equal(g.agentsByKey.planner.metaVersion, 2);
```
new_string:
```
  assert.equal(g.agentsByKey.planner.metaVersion, 2);
  assert.equal(typeof g.ports, 'function', 'the run portsFn rides the result');
  assert.ok(g.loops.loopWireIds instanceof Set && Array.isArray(g.loops.launchOrder), 'loops are classified once, here');
  assert.equal(g.nodes.n_plan.authoredKey, 'planner');
  assert.equal(g.nodes.n_plan.duplicateKey, false);
  assert.deepEqual(g.nodes.n_plan.config, g.template.nodes.find((n) => n.id === 'n_plan').config);
```

**P2-E13** (A1 — tests: workspace substitution reaches the template)
old_string:
```
  assert.equal(g.agentsByKey.workspaceReviewer.key, 'workspaceReviewer');
```
new_string:
```
  assert.equal(g.agentsByKey.workspaceReviewer.key, 'workspaceReviewer');
  assert.equal(g.template.nodes.find((n) => n.id === 'n_rev').key, 'workspaceReviewer', 'the resolved template carries the substituted key');
  assert.equal(g.nodes.n_rev.authoredKey, 'reviewer', 'the authored key is kept for the legacy layer');
  assert.ok(g.loops.loopWireIds.size >= 1, 'loop classification sees the substituted reviewer\'s ports');
```

**P2-E14** (A20 — refusal test regex)
old_string:
```
  await assert.rejects(() => resolveGraph(projectDir, id, REG()), /agent "ghost" is not in the registry/);
```
new_string:
```
  await assert.rejects(() => resolveGraph(projectDir, id, REG()), /unknown agent "ghost" — no such key in the registry/);
```

**P2-E15** (A20 — refusals prose)
old_string:
```
**Refusals** (throw, so a run fails fast with a legible message): `agent "<key>" is not in the registry` (unknown key) · `agent "<key>" has no v2 ports — port its sidecar to metaVersion 2` (v1-only sidecar — the same text V4 reports) · `agent "<key>" declares placeable: false and cannot be a graph node`.
```
new_string:
```
**Refusals** (throw, so a run fails fast with a legible message — the THREE V4 sentences, byte-equal): `unknown agent "<key>" — no such key in the registry` · `agent "<key>" has no v2 ports — port its sidecar to metaVersion 2` · `agent "<key>" declares placeable: false and cannot be a graph node`; an unknown workflow id throws `unknown workflowId "<id>"` (the NOT_FOUND text).
```

**P2-E16** (A16 — B7 bullet)
old_string:
```
- `POST /api/run` with a v2 `workflowId` ⇒ **409** `{ error: 'template is a graph — runs on the graph engine (not available yet)' }`. (Planner default: 409 = "the request is valid, the server cannot serve it in this state"; P4 deletes this branch when `createOrchestratorFor` starts routing v2 rows.)
```
new_string:
```
- `POST /api/run` with a v2 `workflowId` ⇒ **400** `{ error: 'template is a graph — runs on the graph engine (not available yet)' }` — the same `badRequest` path today's `unknown workflowId` uses; ONE status for every non-runnable template on this route (NOT_FOUND, ARCHIVED, interim v2). P4 deletes this branch when `createOrchestratorFor` starts routing v2 rows.
```

**P2-E17** (A16 — B7 test names/asserts)
old_string:
```
test('POST /api/run refuses a graph row with one clean 409', async () => {
```
new_string:
```
test('POST /api/run refuses a graph row with one clean 400', async () => {
```
old_string:
```
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'template is a graph — runs on the graph engine (not available yet)');
```
new_string:
```
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'template is a graph — runs on the graph engine (not available yet)');
```
old_string:
```
test('POST /api/run: unknown id 400, archived id 409 with the archive message', async () => {
```
new_string:
```
test('POST /api/run: unknown id 400, archived id 400 with the archive message', async () => {
```
old_string:
```
  assert.equal(arch.status, 409);
```
new_string:
```
  assert.equal(arch.status, 400);
```
old_string:
```
`Expected: FAIL — expected 409, got 200` (today the v2 row is accepted and dies later inside resolveWorkflow)
```
new_string:
```
`Expected: FAIL — expected 400, got 200` (today the v2 row is accepted and dies later inside resolveWorkflow)
```

**P2-E18** (A16 — B7 server code)
old_string:
```
    // ONE gate for every run entry point: unknown -> 400 (today's text), archived
    // or graph -> 409 with an explanation the UI can show verbatim. The graph
    // branch dies in P4, when createOrchestratorFor routes v2 rows to the engine.
    let workflowRow;
    try {
      workflowRow = await assertRunnableWorkflow(workflowId);
    } catch (err) {
      if (err && err.code === 'ARCHIVED') return res.status(409).json({ error: err.message });
      return badRequest(res, err && err.message ? err.message : String(err));
    }
    if (workflowRow.version === 2) {
      return res.status(409).json({ error: 'template is a graph — runs on the graph engine (not available yet)' });
    }
```
new_string:
```
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

**P2-E19** (A19 — B8 prose)
old_string:
```
For a v2 row those are DERIVED — one group per condensation-topo rank (agent nodes only; flow cards are engine plumbing the assistant must not reason about), and one feedback per loop wire.
```
new_string:
```
For a v2 row those are DERIVED — one group per `rankNodes` rank (longest path with loop wires excluded, nodes in `launchOrder` inside a group — the SAME rank definition the manifest shim cells use; agent nodes only, flow cards are engine plumbing the assistant must not reason about), and one feedback per loop wire.
```

**P2-E20** (A16 — handoff sentence)
old_string:
```
The 409 refusal `template is a graph — runs on the graph engine (not available yet)` in `POST /api/run`, the CLI and Ask is P4's to delete when `createOrchestratorFor` routes v2 rows.
```
new_string:
```
The interim 400 refusal `template is a graph — runs on the graph engine (not available yet)` in `POST /api/run`, the CLI and Ask is P4's to delete when `createOrchestratorFor` routes v2 rows. `resolveGraph` returns `{ template, ports, loops, nodes, wires, agentsByKey, agentKeys }` (Task B4 contract) — P4 consumes all seven fields and re-derives none.
```

**P2-E21** (A16/A19/A1 — Q&A)
old_string:
```
- **Running a v2 row at P2** — silently ignore it, or refuse? → **Refuse with ONE message: HTTP 409 `template is a graph — runs on the graph engine (not available yet)` (CLI: the same text, exit 2). P4 deletes the branch (planner default).**
```
new_string:
```
- **Running a v2 row at P2** — silently ignore it, or refuse? → **Refuse with ONE message and ONE status: HTTP 400 `template is a graph — runs on the graph engine (not available yet)` through the same `badRequest` path as `unknown workflowId` and the ARCHIVED refusal (CLI: the same text, exit 2). P4 deletes the branch (agent adjudication, cross-plan pass 2026-08-27 — one status per route; dev's gate at `ui/server.mjs:1062` is already 400).**
```
old_string:
```
- **`resolveGraph` return shape** — one merged template or template + overlays? → **`{template, nodes, wires, agentsByKey, agentKeys}` with the template UNMUTATED; P4's `_resolveTopology` passes `nodes`/`wires` to `buildGraphManifest` as `overlays` (planner default — P4 must not re-resolve).**
```
new_string:
```
- **`resolveGraph` return shape** — one merged template or template + overlays? → **`{template, ports, loops, nodes, wires, agentsByKey, agentKeys}`: `template` is a deep copy carrying the RESOLVED agent keys (workspace substitution) with `node.config` untouched, `ports`/`loops` are computed once here, `nodes[id]` adds `authoredKey`, `config` and `duplicateKey`; P4 passes `nodes`/`wires` to `buildGraphManifest` as `overlays`, `ports`/`loops` to the scheduler, and re-derives nothing (agent adjudication, cross-plan pass 2026-08-27: an authored-key template walked against the substituted index would lose the reviewer's loop on workspace runs).**
```
old_string:
```
- **Shim `steps` cells** — how is a "rank" defined for a graph? → **One `agents` cell per `rankNodes` rank (longest path, loop wires excluded), nodes ordered by `launchOrder` inside a cell; flow nodes included with `key: null` (planner default over the spec's "condensation-topo rank" wording).**
```
new_string:
```
- **Shim `steps` cells** — how is a "rank" defined for a graph? → **One `agents` cell per `rankNodes` rank (longest path, loop wires excluded), nodes ordered by `launchOrder` inside a cell; flow nodes included with `key: null`; Ask `shapeWorkflow` groups by the same rank. This IS what the spec's "condensation-topo rank" means — pure condensation would fold a whole loop into one cell, which no v1 stepper ever showed (agent adjudication, cross-plan pass 2026-08-27).**
```

### P3 — `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P3-engine-no-callers.md`

**P3-E0** (status banner — insert directly under the title line)
old_string:
```
# Node-Graph v2 — P3: Engine, no callers Implementation Plan
```
new_string:
```
# Node-Graph v2 — P3: Engine, no callers Implementation Plan

> **Status: v1 draft (contract-aligned 2026-08-27). Re-anchor + refine per the house recipe before execution — anchors valid for dev @ e6968e15 only.**
```

**P3-E1** (A30 — `FLOW_KINDS` is an array)
old_string:
```
  const isFlow = (node) => FLOW_KINDS.has(node.kind);
```
new_string:
```
  const isFlow = (node) => FLOW_KINDS.includes(node.kind);   // FLOW_KINDS is a frozen ARRAY (P1)
```

**P3-E2** (A10 — settled `firedOutputs` signature)
old_string:
```
If P2's `firedOutputs` turns out to take the whole ports OBJECT rather than the outputs array, change the one call site (`publish`) to pass `portsOf(node)` — check with `sed -n '/export function firedOutputs/,/^}/p' src/shared/graph/ports.mjs` before writing the module.
```
new_string:
```
P2's `firedOutputs(portsOrOutputs, verdict)` accepts EITHER an outputs array or a resolved ports object (settled by the cross-plan pass); `publish` passes `portsOf(node).outputs`.
```

**P3-E3** (A9 — slice record carries its number)
old_string:
```
      title: task.title || task.id,
      parentExecutionId: entry.executionId,
```
new_string:
```
      title: task.title || task.id,
      parentExecutionId: entry.executionId,
      taskIndex: index + 1,                                   // 1-based within its phase (the CLI's "task 3/7")
      taskTotal: (Array.isArray(ph.tasks) ? ph.tasks : []).length,
```

**P3-E4** (A9 + A34 — the slice's execute args carry the lineage the adapter writes on the ledger row)
old_string:
```
      signal: AbortSignal.any([controller.signal, phaseAbort.signal]),
      kind: 'task',
```
new_string:
```
      signal: AbortSignal.any([controller.signal, phaseAbort.signal]),
      kind: 'task',
      parentExecutionId: sub.parentExecutionId,   // the adapter's ledger row + exec_meta read these three
      taskIndex: sub.taskIndex,
      taskTotal: sub.taskTotal,
```

**P3-E5** (A9 — the `exec` event)
old_string:
```
        ? { phase: entry.phase, taskId: entry.taskId, title: entry.title, parentExecutionId: entry.parentExecutionId }
```
new_string:
```
        ? { phase: entry.phase, taskId: entry.taskId, title: entry.title, parentExecutionId: entry.parentExecutionId,
            taskIndex: entry.taskIndex, taskTotal: entry.taskTotal }
```

**P3-E6** (A9 — snapshot shape doc)
old_string:
```
          taskId?, title?, phase?, parentExecutionId?, expandsPort?, error?}],
```
new_string:
```
          taskId?, title?, phase?, parentExecutionId?, taskIndex?, taskTotal?, expandsPort?, error?}],
```

**P3-E7** (A9 — Q&A)
old_string:
```
- **P3-16** — The v2 questions filename (`questions-x-<nodeIdSafe>-c<ordinal>-r<round>.json`)? → **NOT implemented here: `_questionsLoop` and `_questionsPath` are the ADAPTER's (P4). P3 only pins the clarifier ask id `clarify-<nodeId>-<ordinal>` (rebuild spec §5.4).**
```
new_string:
```
- **P3-16** — The v2 questions filename (`questions-x-<nodeIdSafe>-c<ordinal>-r<round>.json`)? → **NOT implemented here: `_questionsLoop` and `_questionsPath` are the ADAPTER's (P4). P3 only pins the clarifier ask id `clarify-<nodeId>-<ordinal>` (rebuild spec §5.4).**
- **P3-18** — Do slice executions know their position? → **Yes: `kind:'task'` exec events, snapshot `execs[]` rows and the slice's `execute` args carry `taskIndex` (1-based inside its phase), `taskTotal` (the phase's task count) and `parentExecutionId`; P4 writes all three onto the ledger row + `exec_meta`, and the CLI renders `task 3/7` (agent adjudication, cross-plan pass 2026-08-27 — additive to spec §5.7).**
- **P3-19** — Which constants are arrays? → **`KINDS`/`FLOW_KINDS`/`PORT_TYPES` are frozen ARRAYS (P1); membership is `.includes()` (cross-plan pass 2026-08-27 — `FLOW_KINDS.has` was a bug).**
```

### P4 — `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P4-graph-orchestrator-dispatch.md`

**P4-E0** (status banner)
old_string:
```
# Node-Graph v2 — P4: GraphOrchestrator + dispatch Implementation Plan
```
new_string:
```
# Node-Graph v2 — P4: GraphOrchestrator + dispatch Implementation Plan

> **Status: v1 draft (contract-aligned 2026-08-27). Re-anchor + refine per the house recipe before execution — anchors valid for dev @ e6968e15 only.**
```

**P4-E1** (A1 — the `resolveGraph` contract P4 consumes)
old_string:
```
  - `resolveGraph(projectDir, workflowId, registry, agentsDir?, { isWorkspace }) → { template, ports, nodeCtx }` (P2b, `src/core/workflows.mjs`). `ports` is a `portsFn(node) → {inputs:[{id,type,required,loop,expands,as?,directive?}], outputs:[{id,type,when,filename?,store?,artifactKind?}], known, ported}`. `nodeCtx[nodeId]` = `{ nodeId, kind, key, templateKey, meta, runnerType, agentFile, agentPrompt, promptHints, tools, config, model, effort, fanOut, askQuestions, awaitAll, duplicateKey }` for agents, `{ nodeId, kind, key:null, config }` for flow cards. `resolveGraph` owns overlays, the generic `workspaceVariants(registry)` substitution + port-signature assertion, the `placeable:false` throw, and the per-loop-wire `maxCycles` merge.
```
new_string:
```
  - `resolveGraph(projectDir, workflowId, registry, agentsDir?, { isWorkspace }) → { template, ports, loops, nodes, wires, agentsByKey, agentKeys }` (P2b, `src/core/workflows.mjs`; the P2 Task B4 contract). `template` is a deep copy whose agent nodes carry the RESOLVED key (workspace substitution applied); `ports` is `registryPortsFn(agentsByKey)` — `portsFn(node) → {...meta, inputs:[{id,type,required,loop,expands,as?,directive?}, …, await], outputs:[{id,type,when,filename?,store?,artifactKind?}], verdict?, known, ported}`; `loops` is `classifyLoops(template, ports)` computed once; `nodes[nodeId]` = `{ nodeId, kind:'agent', key, authoredKey, meta, runnerType, agentFile, agentPrompt, promptHints, tools, config, model, effort, fanOut, askQuestions, awaitAll, duplicateKey }` for agents, `{ nodeId, kind, key:null, config }` for flow cards; `wires[wireId] = {maxCycles}` for loop wires (overlay-merged); `agentKeys` is a `Set`. `resolveGraph` owns overlays, the generic `workspaceVariants(registry)` substitution + port-signature assertion, the `placeable:false` throw, the `workspaceFanOut` forcing (spec §5.10) and the per-loop-wire `maxCycles` merge. This class calls the resolver's per-node table `nodeCtx` (`this.resolved.nodeCtx === resolved.nodes`).
```

**P4-E2** (A8 — `QUIESCENCE_WARNING` is P3's export)
old_string:
```
- Produces: `export class GraphOrchestrator extends RunHarness`, `export function createGraphOrchestrator(opts)`, `export function resolvedFromManifest(manifest, registry)`, `export const QUIESCENCE_WARNING`.
```
new_string:
```
- Produces: `export class GraphOrchestrator extends RunHarness`, `export function createGraphOrchestrator(opts)`, `export function resolvedFromManifest(manifest, registry, agentsDir)` (returns the `resolveGraph` shape). Consumes `QUIESCENCE_WARNING` from `src/core/graph/scheduler.mjs` (P3 — the ONE quiescence text, `finished at quiescence — End not reached`; this module defines no text of its own) and `renderPromptArtifact` from `../channels.mjs` (until P8 re-homes it into `phases.mjs`).
```

**P4-E3** (A8 — delete the local constant)
old_string:
```
/** Amendment f (1): a graph that drains without binding End is a legitimate
 *  completion, but the run monitor has to say so. Recorded via _recordRunWarning
 *  (run log + run.json.warnings) and surfaced as state.warnings[]. */
export const QUIESCENCE_WARNING =
  'finished at quiescence — the End card was never reached, so this run bound no result';
```
new_string:
```
// Amendment f (1): a graph that drains without binding End is a legitimate
// completion. The scheduler owns the warning text and state.warnings[] mirrors
// its getState().warnings (see _syncSchedulerState); this module only logs +
// audits it. Import: `import { createScheduler, sliceExecutionId, QUIESCENCE_WARNING } from './scheduler.mjs';`
// and `import { renderPromptArtifact } from '../channels.mjs';` (P8 re-points it to phases.mjs).
```

**P4-E4** (A17 — `_initRunners` is the constructor seam; A1 — comment)
old_string:
```
    this._runners = { ...(this.opts.runners || {}) };
    this.resolved = null;        // { template, ports, nodeCtx, loops } from resolveGraph
```
new_string:
```
    // (this._runners is assigned by the _initRunners hook the base constructor calls.)
    this.resolved = null;        // resolveGraph's { template, ports, loops, nodes→nodeCtx, wires, agentsByKey, agentKeys }
```
old_string:
```
  // ── hook 1: topology ───────────────────────────────────────────────────────
```
new_string:
```
  // ── hook 6: the runner registry (constructor seam, P1) ─────────────────────
  /** The test seam (§5.4). NO defaultRunners and NO bound clarifier: executor
   *  selection is node.kind -> meta.runnerType, never an agent key. */
  _initRunners(opts) {
    this._runners = { ...((opts && opts.runners) || {}) };
  }

  // ── hook 1: topology ───────────────────────────────────────────────────────
```

**P4-E5** (A1/A2/A17/A36 — `_resolveTopology` + adoption; `_overlays`/`_agentKeys` deleted)
old_string:
```
  async _resolveTopology(registry) {
    const resolved = await resolveGraph(this.projectDir, this.workflowId, registry, this.agentsDir, {
      isWorkspace: this.isWorkspace,
    });
    this._adoptResolvedGraph(resolved);
    const manifest = buildGraphManifest(this.resolved.template, registry, {
      overlays: this._overlays(),
    });
    manifest.template = { id: this.workflowId, name: this.resolved.template.name || this.workflowId };
    return { manifest, agentKeys: this._agentKeys() };
  }
```
new_string:
```
  async _resolveTopology(registry) {
    const resolved = await resolveGraph(this.projectDir, this.workflowId, registry, this.agentsDir, {
      isWorkspace: this.isWorkspace,
    });
    this._adoptResolvedGraph(resolved);
    // The manifest is built from the RESOLVED template, the resolver's registry
    // slice and its EFFECTIVE per-node/per-wire values (P2 contract): the run
    // monitor shows exactly what the engine will run. The builder stamps
    // template {id, name} from the (alias-aware) template itself.
    const manifest = buildGraphManifest(this.resolved.template, this.resolved.agentsByKey, {
      overlays: { nodes: this.resolved.nodeCtx, wires: this.resolved.wires },
    });
    return {
      manifest,
      agentKeys: new Set(this.resolved.agentKeys),
      workflow: { id: this.workflowId, name: this.resolved.template.name || this.workflowId },
    };
  }
```

**P4-E6** (A1/A36 — adoption is an alias; forcing and Tarjan are the resolver's)
old_string:
```
  /**
   * Adopt a resolveGraph result. Workspace fan-out forcing lives HERE and is the
   * ONLY in-orchestrator topology change a workspace run makes: an agent whose
   * sidecar declares `workspaceFanOut` gets fanOut = true, unlocking the Task/
   * Agent tool downstream. It is a META flag, not a key set — v1's
   * FANOUT_ELIGIBLE literal (orchestrator.mjs:139) has no v2 counterpart.
   * `loops` is derived once, here, and handed to the scheduler and the manifest.
   */
  _adoptResolvedGraph(resolved) {
    this.resolved = { ...resolved, loops: classifyLoops(resolved.template, resolved.ports) };
    if (!this.isWorkspace) return;
    for (const node of this.resolved.template.nodes || []) {
      const nc = this.resolved.nodeCtx[node.id];
      if (nc?.kind === 'agent' && nc.meta?.workspaceFanOut) {
        nc.fanOut = true;
        node.fanOut = true;      // ctxFanOut reads the node first
      }
    }
  }

  /** The RESOLVED (already 4-layer-merged) per-node + per-wire values the manifest
   *  must display, so the run monitor shows exactly what the engine will run. */
  _overlays() {
    const nodes = {};
    for (const nc of Object.values(this.resolved.nodeCtx || {})) {
      if (nc.kind !== 'agent') continue;
      nodes[nc.nodeId] = {
        model: nc.model, effort: nc.effort, fanOut: !!nc.fanOut,
        askQuestions: !!nc.askQuestions, awaitAll: !!nc.awaitAll,
      };
    }
    const wires = {};
    for (const w of this.resolved.template.wires || []) {
      if (this.resolved.loops.loopWireIds.has(w.id)) wires[w.id] = { maxCycles: w.config?.maxCycles };
    }
    return { nodes, wires };
  }

  /** Every RESOLVED agent key in the graph (post workspace substitution). */
  _agentKeys() {
    const keys = new Set();
    for (const nc of Object.values(this.resolved.nodeCtx || {})) {
      if (nc.kind === 'agent' && nc.key) keys.add(nc.key);
    }
    return keys;
  }
```
new_string:
```
  /**
   * Adopt a resolveGraph result (P2 contract: { template, ports, loops, nodes,
   * wires, agentsByKey, agentKeys }). The resolver has ALREADY applied the
   * workspace substitution AND the workspaceFanOut forcing (spec §5.10 — a META
   * flag, never a key set; v1's FANOUT_ELIGIBLE literal has no v2 counterpart)
   * and classified the loops ONCE. This class names the per-node table
   * `nodeCtx`; nothing is re-derived and no template node is mutated here.
   */
  _adoptResolvedGraph(resolved) {
    this.resolved = { ...resolved, nodeCtx: resolved.nodes };
  }
```

**P4-E7** (A1 — rehydrate uses the resolver's key set)
old_string:
```
    this._preflightAgentKeys(this._agentKeys());
```
new_string:
```
    this._preflightAgentKeys(this.resolved.agentKeys);
```

**P4-E8** (A17 — `_engineRun` signature/JSDoc; A6 — the task document)
old_string:
```
   * @param {{resume?:boolean}} [o]
```
new_string:
```
   * @param {{resume?:object|null, rehydrated?:object|null}} [o] the base passes
   *   `{ resume: rp, rehydrated }` on a resume and `{ resume: null }` on a fresh run;
   *   `rehydrated` is v1-only (the frozen plan) and ignored here
```
old_string:
```
  async _engineRun({ resume = false } = {}) {
```
new_string:
```
  async _engineRun({ resume = null } = {}) {
```
old_string:
```
    this._taskArtifact = {
      path: null,
      promptText: this.pipeline.promptText,
      extras: this.extrasFiles,
    };
```
new_string:
```
    // Byte-identical to v1's seeded task file (orchestrator.mjs:2044): the same
    // renderer, so the Task card's document matches what v1 handed its entry node.
    this._taskArtifact = { text: renderPromptArtifact(this.pipeline.promptText, this.extrasFiles) };
```

**P4-E9** (A3 — the two scheduler callbacks)
old_string:
```
      onGate: (g) => this._gateAsk(g),
      onAsk: (q) => this._enqueueAsk(() => this._ask(q)),
```
new_string:
```
      // P3 contract: onGate is the state.gate NOTIFIER ({wireId, fromNode, toNode,
      // askId} | null); onAsk is the ONE ask channel (gates today).
      onGate: (g) => { this.state.gate = g ? { ...g } : null; this._emit('state', this.getState()); },
      onAsk: (q) => this._schedulerAsk(q),
```

**P4-E10** (A8 — warnings come from the scheduler)
old_string:
```
    if (!this.state.endReached) await this._recordRunWarning(QUIESCENCE_WARNING);
```
new_string:
```
    if (!this.state.endReached) {
      // state.warnings already carries the scheduler's text (_syncSchedulerState);
      // this is the run log + audit trail for it.
      this._log('orchestrator', 'warn', QUIESCENCE_WARNING);
      if (this.pipeline) await appendAudit(this.pipeline.dir, `Run **${QUIESCENCE_WARNING}**.`).catch(() => {});
    }
```

**P4-E11** (A7 — `_syncSchedulerState` reads P3's `getState()` shape)
old_string:
```
    const s = this._scheduler ? this._scheduler.getState() : null;
    if (!s) return;
    if (Array.isArray(s.active)) this.state.active = s.active.map((a) => ({ nodeId: a.nodeId, executionId: a.executionId }));
    if (s.wires) {
      const d = {};
      for (const [wireId, w] of Object.entries(s.wires)) d[wireId] = w?.deliveries ?? 0;
      this.state.wireDeliveries = d;
    }
```
new_string:
```
    const s = this._scheduler ? this._scheduler.getState() : null;
    if (!s) return;
    // P3's getState(): { active, executions, tokens, wireDeliveries, ended,
    // endReached, result, warnings, gate, settled }.
    if (Array.isArray(s.active)) this.state.active = s.active.map((a) => ({ nodeId: a.nodeId, executionId: a.executionId }));
    if (s.wireDeliveries && typeof s.wireDeliveries === 'object') this.state.wireDeliveries = { ...s.wireDeliveries };
    if (Array.isArray(s.warnings)) this.state.warnings = [...s.warnings];
    if (s.endReached === true) { this.state.endReached = true; if (s.result) this.state.result = { ...s.result }; }
```
old_string:
```
    this.state.gate = s.gate
      ? {
          wireId: s.gate.wireId,
          fromNode: s.gate.nodeId ?? s.gate.fromNode ?? null,
          toNode: s.gate.toNode ?? null,
          askId: s.gate.askId ?? `gate-${s.gate.wireId}-${s.gate.deliveryNo ?? ''}`,
        }
      : null;
```
new_string:
```
    // s.gate is already the §5.7 shape ({wireId, fromNode, toNode, askId} | null).
    this.state.gate = s.gate ? { ...s.gate } : null;
```

**P4-E12** (A3 — the ask adapter replaces `_gateAsk`)
old_string:
```
  /**
   * The scheduler's loop-budget gate. Rides the SAME serialized ask queue as
   * recovery prompts and step questions, so only ONE prompt is ever open, and
   * answers arrive through the unchanged POST /api/answer {id} path.
   * @param {{wireId:string, nodeId:string, executionId:string, deliveryNo:number, issues:Array}} g
   * @returns {Promise<'another'|'continue'>}
   */
  async _gateAsk({ wireId, nodeId, executionId, deliveryNo, issues }) {
    const payload = await this._enqueueAsk(() => this._ask({
      id: `gate-${wireId}-${deliveryNo}`,
      kind: 'gate',
      wireId,
      nodeId,
      executionId,
      issues,
    }));
    return payload?.decision === 'another' ? 'another' : 'continue';
  }
```
new_string:
```
  /**
   * The scheduler's ask channel (P3 `onAsk`). A gate ask arrives as
   * `{ id:'gate-<wireId>-<deliveryNo>', kind:'gate', wireId, nodeId, executionId, issues }`
   * and is answered 'another' | 'continue'. It rides the SAME serialized ask
   * queue as recovery prompts and step questions, so only ONE prompt is ever
   * open, and answers arrive through the unchanged POST /api/answer {id} path
   * (the harness's _ask resolves a gate with `{decision}` — dev `_gate :2894`).
   * @param {{id:string, kind:string, wireId?:string, nodeId?:string, executionId?:string, issues?:Array, questions?:Array}} q
   * @returns {Promise<'another'|'continue'|any>}
   */
  async _schedulerAsk(q) {
    const payload = await this._enqueueAsk(() => this._ask(q));
    if (q.kind === 'gate') return payload?.decision === 'another' ? 'another' : 'continue';
    return payload;
  }
```

**P4-E13** (A5 — pause answer)
old_string:
```
        endMark = 'paused';
        return { outputs: {} };
```
new_string:
```
        endMark = 'paused';
        // P3 protocol: a paused execution answers { paused: true } — the scheduler
        // keeps its row NON-TERMINAL (nothing publishes) and reattach() re-invokes
        // it on resume. `{ outputs: {} }` would COMPLETE it and strand the resume.
        return { paused: true };
```

**P4-E14** (A9/A34 — ctx carries the slice lineage)
old_string:
```
  1. In the Step 2f ctx object literal, add `parentExecutionId: args.parentExecutionId ?? null,` on the line after `slice,` — the scheduler passes it for a `kind:'task'` execution and `_execStep` writes it into the ledger row.
```
new_string:
```
  1. In the Step 2f ctx object literal, add `parentExecutionId: args.parentExecutionId ?? null,`, `taskIndex: args.taskIndex ?? null,` and `taskTotal: args.taskTotal ?? null,` on the lines after `slice,` — the scheduler passes all three for a `kind:'task'` execution (P3 `runSlice` args) and `_execStep` writes them into the ledger row.
```

**P4-E15** (A34 — ledger row)
old_string:
```
          ? { taskId: ctx.slice.id, parentExecutionId: ctx.parentExecutionId ?? null, title: ctx.slice.title ?? null, phaseOrdinal: ctx.slice.phase ?? null }
```
new_string:
```
          ? { taskId: ctx.slice.id, parentExecutionId: ctx.parentExecutionId ?? null, title: ctx.slice.title ?? null, phaseOrdinal: ctx.slice.phase ?? null,
              taskIndex: ctx.taskIndex ?? null, taskTotal: ctx.taskTotal ?? null }
```

**P4-E16** (A34 — `exec_meta` write + read)
old_string:
```
      const meta = (st.taskId != null || st.parentExecutionId != null || st.title != null || st.phaseOrdinal != null)
        ? s({ taskId: st.taskId ?? null, parentExecutionId: st.parentExecutionId ?? null,
              title: st.title ?? null, phaseOrdinal: st.phaseOrdinal ?? null })
        : null;
```
new_string:
```
      const meta = (st.taskId != null || st.parentExecutionId != null || st.title != null || st.phaseOrdinal != null)
        ? s({ taskId: st.taskId ?? null, parentExecutionId: st.parentExecutionId ?? null,
              title: st.title ?? null, phaseOrdinal: st.phaseOrdinal ?? null,
              taskIndex: st.taskIndex ?? null, taskTotal: st.taskTotal ?? null })
        : null;
```
old_string:
```
    if (em.phaseOrdinal != null) step.phaseOrdinal = em.phaseOrdinal;
```
new_string:
```
    if (em.phaseOrdinal != null) step.phaseOrdinal = em.phaseOrdinal;
    if (em.taskIndex != null) step.taskIndex = em.taskIndex;
    if (em.taskTotal != null) step.taskTotal = em.taskTotal;
```

**P4-E17** (A1 — `resolvedFromManifest` returns the resolver shape)
old_string:
```
- Produces: `_engineRehydrate(rp) → { checkpointRef, memberWorktrees, plan:null }`; `resolvedFromManifest(manifest, registry, agentsDir) → { template, ports, nodeCtx }`.
```
new_string:
```
- Produces: `_engineRehydrate(rp) → { checkpointRef, memberWorktrees, plan:null, audit }` (the base writes `audit`); `resolvedFromManifest(manifest, registry, agentsDir) → { template, ports, loops, nodes, wires, agentsByKey, agentKeys }` — the SAME shape `resolveGraph` returns, so `_adoptResolvedGraph` has one input contract.
```
old_string:
```
      nodeId: mn.id, kind: 'agent', key: mn.key, templateKey: mn.key, meta,
```
new_string:
```
      nodeId: mn.id, kind: 'agent', key: mn.key, authoredKey: mn.key, meta,
```
old_string:
```
  return { template, ports, nodeCtx, agentsDir };
```
new_string:
```
  // Loop budgets and the registry slice, so the result has resolveGraph's shape.
  const wires = {};
  for (const w of manifest.graph?.wires || []) {
    if (w.loop) wires[w.id] = { maxCycles: Number.isInteger(w.maxCycles) && w.maxCycles >= 1 ? w.maxCycles : DEFAULT_MAX_CYCLES };
  }
  const agentsByKey = {};
  const agentKeys = new Set();
  for (const nc of Object.values(nodeCtx)) {
    if (nc.kind !== 'agent') continue;
    agentsByKey[nc.key] = nc.meta;
    agentKeys.add(nc.key);
  }
  return { template, ports, loops: classifyLoops(template, ports), nodes: nodeCtx, wires, agentsByKey, agentKeys };
```
(add `DEFAULT_MAX_CYCLES` to the module's `../../shared/graph/constants.mjs` import; `classifyLoops` is already imported.)

**P4-E18** (A17/A37 — the v2 resume audit line)
old_string:
```
      plan: null,   // v2 has no frozen ExecutablePlan; the manifest is the topology
```
new_string:
```
      plan: null,   // v2 has no frozen ExecutablePlan; the manifest is the topology
      // The base writes this line (P1 hook 4 contract); v1's is "from <kind> at step <n>".
      audit: `Pipeline **resumed** (graph snapshot at seq ${rp.snapshot?.seq ?? 0}).`,
```

**P4-E19** (A29 — the alias row has the standard template shape)
old_string:
```
  return { ...GRAPH_DEFAULT_WORKFLOW, id: GRAPH_DEFAULT_ALIAS_ID, name: 'Default (graph)' };
```
new_string:
```
  // Same epoch stamps DEFAULT_WORKFLOW carries (workflows.mjs:107-108): every
  // listed template has createdAt/updatedAt. P8 moves them into the constant.
  return {
    ...GRAPH_DEFAULT_WORKFLOW, id: GRAPH_DEFAULT_ALIAS_ID, name: 'Default (graph)',
    createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z',
  };
```

**P4-E20** (A4 — `question` events name the wire and the execution; insert as Step 3b of Task 1)
old_string:
```
- [ ] **Step 4: Move the telemetry block to `run-harness.mjs`** (skip if Step 1 printed `1`).
```
new_string:
```
- [ ] **Step 3b: `_ask` passes the v2 attribution through** (`run-harness.mjs`, moved verbatim from dev `orchestrator.mjs:2834`; two additive keys, spec §5.7 "`question` gains `wireId?` and `executionId?`"). Change the signature to `async _ask({ id, kind, questions, issues, recovery, agent, nodeId, wireId, executionId }) {` and the emit to:
```js
    this._emit('question', {
      id, kind, questions, issues, recovery, agent, nodeId,
      ...(wireId != null ? { wireId } : {}),           // v2 gates name their wire
      ...(executionId != null ? { executionId } : {}), // v2 asks name their execution
    });
```
  Every v1 call passes neither key, so v1's `question` payload is byte-identical. Add to `test/run-harness-attr.test.mjs`: `orch.on('question', …)`; `orch._ask({ id: 'gate-w9-3', kind: 'gate', wireId: 'w9', executionId: 'x:n_rev:3', issues: [] })` under `auto: true` resolves `{ decision: 'continue' }` and the captured event carries `wireId === 'w9'` and `executionId === 'x:n_rev:3'`; a plain `_ask({ id:'q1', kind:'gate', issues: [] })` event has neither key.

- [ ] **Step 4: Move the telemetry block to `run-harness.mjs`** (skip if Step 1 printed `1`).
```

**P4-E21** (Q&A — A5, A8, A2, A3)
old_string:
```
- **E7** — What happens on a pause inside a composite slice? → **`_execute` returns `{outputs:{}}`, the ledger row is marked `paused`, and the `pipeline_tasks` row stays `running` — the resume re-runs the whole composite (spec §5.4; dev 885fb013).**
```
new_string:
```
- **E7** — What happens on a pause inside an execution (composite slice included)? → **`_execute` returns `{ paused: true }` (P3's execute protocol — the scheduler keeps the row NON-TERMINAL and re-invokes it on resume), the ledger row is marked `paused`, and the `pipeline_tasks` row stays `running` — the resume re-runs the whole composite (spec §5.6 "executions marked paused, non-terminal"; dev 885fb013; the `{outputs:{}}` literal in spec §5.4 would complete the execution and strand the resume — agent adjudication, cross-plan pass 2026-08-27).**
```
old_string:
```
- **P3** — What text does a quiescent run record? → **`finished at quiescence — the End card was never reached, so this run bound no result` (planner default; the UI banner copy in §8 is P6's).**
```
new_string:
```
- **P3** — What text does a quiescent run record? → **`finished at quiescence — End not reached` — P3's `QUIESCENCE_WARNING` (scheduler.mjs), imported here; `state.warnings` mirrors the scheduler's `getState().warnings`, this class only logs + audits it, the UI banner and the CLI summary print the same sentence (agent adjudication, cross-plan pass 2026-08-27: one text, one owner).**
```
old_string:
```
- **P4** — What shape does `buildGraphManifest`'s `overlays` take here? → **`{ nodes: {[nodeId]: {model, effort, fanOut, askQuestions, awaitAll}}, wires: {[wireId]: {maxCycles}} }`, built from the RESOLVED `nodeCtx`/wire configs so the manifest shows exactly what the engine will run (planner default).**
```
new_string:
```
- **P4** — What shape does `buildGraphManifest`'s `overlays` take here? → **The resolver's own tables, verbatim: `{ nodes: resolved.nodes, wires: resolved.wires }` (P2 Task B4 contract — effective `model/effort/fanOut/askQuestions/awaitAll` per agent node, overlay-merged `maxCycles` per loop wire; the builder reads only those keys), with `agentsByKey = resolved.agentsByKey`; nothing is re-derived here (agent adjudication, cross-plan pass 2026-08-27).**
```
old_string:
```
- **P5** — How are the scheduler's human gate and generic ask wired? → **`onGate({wireId, nodeId, executionId, deliveryNo, issues}) → 'another'|'continue'` and `onAsk(payload) → answer`, both riding `_enqueueAsk` so only one prompt is ever open; the gate ask id is `gate-<wireId>-<deliveryNo>` and answers arrive through the unchanged `POST /api/answer {id}` (spec §5.3; signature detail = planner default).**
```
new_string:
```
- **P5** — How are the scheduler's human gate and generic ask wired? → **P3's contract: `onAsk(ask)` is the ONE ask channel — `_schedulerAsk(q)` rides `_enqueueAsk` → `_ask(q)` and maps a gate's `{decision}` to `'another'|'continue'` (gate ask id `gate-<wireId>-<deliveryNo>`, payload `{id, kind:'gate', wireId, nodeId, executionId, issues}`, answered through the unchanged `POST /api/answer {id}`); `onGate(gate|null)` only mirrors `state.gate = {wireId, fromNode, toNode, askId}` and emits `state` (agent adjudication, cross-plan pass 2026-08-27).**
- **P10** — Which resolver fields does this class consume? → **All seven of `resolveGraph`'s `{ template, ports, loops, nodes, wires, agentsByKey, agentKeys }`; `_adoptResolvedGraph` aliases `nodeCtx = nodes` and re-derives nothing (no second `classifyLoops`, no `_overlays()`, no workspace fan-out forcing — that is the resolver's, spec §5.10); `resolvedFromManifest` returns the same shape (agent adjudication, cross-plan pass 2026-08-27).**
- **P11** — Slice numbering for the CLI's `task 3/7`? → **The scheduler (P3) puts `taskIndex`/`taskTotal`/`parentExecutionId` on the slice's execute args and `exec` events; `_execCtx` copies them, `_execStep` writes them on the ledger row, `writeState` stores them in `exec_meta`, `stepRowToStep` reads them back (agent adjudication, cross-plan pass 2026-08-27; additive to spec §5.7/§5.9).**
```

### P5 — `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P5-composer-v2.md`

**P5-E0** (status banner)
old_string:
```
# Node-Graph v2 — P5: Composer v2 Implementation Plan
```
new_string:
```
# Node-Graph v2 — P5: Composer v2 Implementation Plan

> **Status: v1 draft (contract-aligned 2026-08-27). Re-anchor + refine per the house recipe before execution — anchors valid for dev @ e6968e15 only.**
```

**P5-E1** (A14 — Task 1 Interfaces: the view consumes the shared bounds/fit)
old_string:
```
bezierMid(a, b, {loop}), snap, hitNode, hitPort, hitWire`), `ports.mjs`
```
new_string:
```
bezierMid(a, b, {loop}), snap, hitNode, hitPort, hitWire, graphBounds(tpl, portsFn, {pad, footerRowsOf}), fitBounds(bounds, {width, height}, {zoomMin, zoomMax}) → {z, tx, ty}`), `ports.mjs`
```

**P5-E2** (A11 — `render` takes no decor; the view has no `applyDecor`)
old_string:
```
    if (state.decor) view.applyDecor(state.decor);
```
new_string:
```
    // (No decor here: run-decor.mjs's applyDecor(view, decor) — P6 — is the ONE
    // decor pass, run AFTER render through the fast paths below.)
```
old_string:
```
- [ ] Step 3: `render` calls `view.setSelection` and `view.applyDecor`, so both land in THIS task (their dedicated tests arrive in Task 2). Add them inside the returned object, above `setAgents`:
```
new_string:
```
- [ ] Step 3: `render` calls `view.setSelection`, so it lands in THIS task (its dedicated test arrives in Task 2). Add it inside the returned object, above `setAgents`:
```
old_string:
```
    /** Decor bag from the run monitor: {status:{nodeId:status}, wireLive:[wireId], footers:{nodeId:rows}} */
    applyDecor(decor = {}) {
      for (const [id, st] of Object.entries(decor.status || {})) view.setStatus(id, st);
      if (decor.footers) for (const [id, rows] of Object.entries(decor.footers)) view.setFooter(id, rows);
      if (decor.wireLive) view.setWireLive(decor.wireLive);
    },
```
new_string:
```
    // (no applyDecor on the view: run-decor.mjs's applyDecor(view, decor) — P6 — owns the decor pass)
```
old_string:
```
`applyDecor` is only reached from `render` when `state.decor` is present (already the case), and `setStatus`/`setFooter`/`setWireLive` arrive in Task 2 — so no Task 1 test path enters it.
```
new_string:
```
The view carries NO `applyDecor` and `render` accepts NO `decor`: P6's `run-decor.mjs` exports `applyDecor(view, decor)` and drives the Task 2 fast paths (`setStatus`/`setFooter`/`setNodeChrome`/`setWireBadge`/`setWireLive`) after every `render` — one decor owner (cross-plan pass 2026-08-27).
```

**P5-E3** (A11 — Task 2 Interfaces)
old_string:
```
**Interfaces:** produces (all bypass `render`, all O(1)/O(incident)) `view.moveNode(id)`, `view.setGhost(d, cls)`, `view.paintWire(wireId)`, `view.setStatus(nodeId, status)`, `view.setFooter(nodeId, rows)`, `view.setWireLive(ids)`, `view.centerOn(nodeId)`. `setFooter` re-runs `nodeSize` so the card GROWS — run-decor NEVER sets `card.style.height` itself (the PR #359 defect `old:run-decor.mjs:457-461`).
```
new_string:
```
**Interfaces:** produces (all bypass `render`, all O(1)/O(incident)) `view.moveNode(id)`, `view.setGhost(d, cls)`, `view.paintWire(wireId)`, `view.setStatus(nodeId, status)`, `view.setFooter(nodeId, bands)`, `view.setNodeChrome(nodeId, {color, gate, totals})`, `view.setWireBadge(wireId, badge)`, `view.setWireLive(ids)`, `view.centerOn(nodeId)`. The run-mode vocabulary (consumed by P6's `applyDecor(view, decor)` in `run-decor.mjs`; the composer never calls these three):
```js
// view.setFooter(nodeId, bands)  — bands = [] | null clears the footer; the card height is
// nodeSize(node, ports, { footerRows: bands.length }) — 26px for the first band, 22px each extra.
//   { kind:'fan',    leds:('run'|'done')[], count:number }
//   { kind:'strip',  leds:NodeStatus[], summary:string, expanded:boolean }
//   { kind:'exec',   executionId, led:NodeStatus, label:string, right:string }
//   { kind:'result', text:string, path:string|null }
// view.setNodeChrome(nodeId, { color:''|paletteToken -> --c, gate:null|{wireId,title} -> .ngate pip,
//                             totals:null|{dur,cost} -> .nrun })  — also stamps class run-node + data-id
// view.setWireBadge(wireId, badge)  badge = null | { text, title }   -> .wbadge[data-wire-id] .wfired
```
`setFooter` re-runs `nodeSize` so the card GROWS — run-decor NEVER sets `card.style.height` itself (the PR #359 defect `old:run-decor.mjs:457-461`); this view is the ONE writer of every run-mode card byte.
```

**P5-E4** (A11 — Task 2 test: bands, plus the two chrome/badge pins; insert the new tests BEFORE the existing one)
old_string:
```
test('setStatus / setWireLive / setFooter are classList + height only', async () => {
```
new_string:
```
test('setNodeChrome paints --c, the gate pip and the header totals; nulls clear them', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS });
  view.render(fixture(), {});
  const card = view.nodeEl('n_agent');
  view.setNodeChrome('n_agent', { color: 'violet', gate: { wireId: 'w1', title: 'waiting on a loop gate' }, totals: { dur: '2m 10s', cost: '$0.42' } });
  assert.equal(card.style.getPropertyValue('--c'), 'var(--violet)');
  assert.equal(card.querySelector(':scope > .ngate').dataset.wireId, 'w1');
  assert.equal(card.querySelector(':scope > .nrun .dur').textContent, '2m 10s');
  assert.equal(card.querySelector(':scope > .nrun .cost').textContent, '$0.42');
  assert.ok(card.classList.contains('run-node') && card.dataset.id === 'n_agent', 'the 1s tick hook selects .run-node[data-id] .dur');
  view.setNodeChrome('n_agent', { color: '', gate: null, totals: null });
  assert.equal(card.querySelector(':scope > .ngate'), null);
  assert.equal(card.querySelector(':scope > .nrun'), null);
});

test('setWireBadge writes an amber cycle badge on a loop wire and clears it', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS });
  view.render(fixture(), {});                             // w4 is the fixture's loop wire (badge host)
  view.setWireBadge('w4', { text: '2×', title: '2 of 3 cycles' });
  const badge = host.querySelector('.wbadge[data-wire-id="w4"] .wfired');
  assert.equal(badge.textContent, '2×');
  assert.equal(badge.title, '2 of 3 cycles');
  view.setWireBadge('w4', null);
  assert.equal(host.querySelector('.wfired'), null);
  view.setWireBadge('w1', { text: '1×' });                // a plain wire has no badge host: no-op
  assert.equal(host.querySelector('.wfired'), null);
});

test('setStatus / setWireLive / setFooter are classList + height only', async () => {
```
old_string:
```
  view.setFooter('n_agent', 1);                          // collapsed strip: +26
  assert.equal(card.style.height, '217.5px');
  view.setFooter('n_agent', 3);                          // +26 + 2*22
  assert.equal(card.style.height, '261.5px');
  view.setFooter('n_agent', 0);
  assert.equal(card.style.height, '191.5px');
```
new_string:
```
  view.setFooter('n_agent', [{ kind: 'strip', leds: ['done'], summary: '1 run · $0.10', expanded: false }]);   // collapsed strip: +26
  assert.equal(card.style.height, '217.5px');
  assert.equal(card.querySelectorAll(':scope > .xfoot .xtoggle').length, 1);
  assert.equal(card.querySelector(':scope > .xfoot .xsum').textContent, '1 run · $0.10');
  view.setFooter('n_agent', [                            // +26 + 2*22
    { kind: 'strip', leds: ['done', 'active'], summary: '2 runs · $1.12', expanded: true },
    { kind: 'exec', executionId: 'x:n_agent:1', led: 'done', label: 'cycle 1', right: '1m 3s · $0.12' },
    { kind: 'exec', executionId: 'x:n_agent:2', led: 'active', label: 'cycle 2 · fix', right: '4s' },
  ]);
  assert.equal(card.style.height, '261.5px');
  assert.deepEqual([...card.querySelectorAll(':scope > .xfoot .xrow')].map((r) => r.dataset.executionId), ['x:n_agent:1', 'x:n_agent:2']);
  assert.equal(card.querySelectorAll(':scope > .xfoot .xrow')[1].className, 'xrow is-active');
  view.setFooter('n_agent', []);
  assert.equal(card.style.height, '191.5px');
  assert.equal(card.querySelector(':scope > .xfoot'), null, 'clearing removes the footer');
```
(the Step 1 "Expected: FAIL" list of this task gains `setNodeChrome`/`setWireBadge`; the task's green count grows by 2.)

**P5-E5** (A11 — Task 2 code: the band footer + chrome + badge fast paths)
old_string:
```
    /** Grow/shrink the executions footer box. Anchors are top-relative, so no
     *  wire re-routes (D8) — only height, hit box and fit bounds change. */
    setFooter(nodeId, rows) {
      const node = ctx && ctx.byId.get(nodeId);
      const el = nodeEls.get(nodeId);
      if (!node || !el) return;
      const n = Number.isInteger(rows) && rows > 0 ? rows : 0;
      if ((footers.get(nodeId) || 0) === n) return;
      if (n) footers.set(nodeId, n); else footers.delete(nodeId);
      el.style.height = `${sizeOf(node).h}px`;
    },
```
new_string:
```
    /** Replace the executions footer with `bands` (the run monitor's vocabulary,
     *  see the Interfaces block) and RE-SIZE the card from the band count. Anchors
     *  are top-relative, so no wire re-routes (D8) — only height, hit box and fit
     *  bounds change. The ONE place a run-mode card height is written. */
    setFooter(nodeId, bands) {
      const node = ctx && ctx.byId.get(nodeId);
      const el = nodeEls.get(nodeId);
      if (!node || !el) return;
      const list = Array.isArray(bands) ? bands.filter(Boolean) : [];
      for (const stale of el.querySelectorAll(':scope > .xfoot')) stale.remove();
      if (list.length) {
        const foot = h('div', 'xfoot');
        foot.dataset.nodeId = nodeId;
        for (const band of list) foot.appendChild(bandEl(nodeId, band));
        el.appendChild(foot);
      }
      if (list.length) footers.set(nodeId, list.length); else footers.delete(nodeId);
      el.style.height = `${sizeOf(node).h}px`;
    },
    /** Per-card ornaments: agent colour, gate pip, header duration · cost. */
    setNodeChrome(nodeId, { color = '', gate = null, totals = null } = {}) {
      const el = nodeEls.get(nodeId);
      if (!el) return;
      el.style.setProperty('--c', color ? `var(--${color})` : '');
      // Keep the 1 s elapsed tick (app.js `.run-node[data-id] .dur`) working on v2 cards.
      el.classList.add('run-node');
      el.dataset.id = nodeId;
      for (const stale of el.querySelectorAll(':scope > .ngate')) stale.remove();
      if (gate) {
        const pip = h('div', 'ngate', '?');
        pip.dataset.wireId = gate.wireId || '';
        pip.title = gate.title || '';
        el.appendChild(pip);
      }
      let run = el.querySelector(':scope > .nrun');
      if (!totals) { if (run) run.remove(); return; }
      if (!run) { run = h('div', 'nrun'); run.append(h('span', 'dur'), h('span', 'cost')); el.appendChild(run); }
      run.querySelector('.dur').textContent = totals.dur || '';
      run.querySelector('.cost').textContent = totals.cost || '';
    },
    /** The amber `N×` delivery badge on a loop wire's bow (no-op on a plain wire). */
    setWireBadge(wireId, badge) {
      const host = badgeEls.get(wireId);
      if (!host) return;
      for (const stale of host.querySelectorAll('.wfired')) stale.remove();
      if (!badge) return;
      const b = h('span', 'wfired', badge.text || '');
      if (badge.title) b.title = badge.title;
      host.appendChild(b);
    },
```
and, as module-private helpers next to `placeCard` (they close over `doc` and Task 1's `h(tag, cls, text)`):
```js
  const svgChevron = () => {
    const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'chev'); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.innerHTML = '<path d="M6 9l6 6 6-6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
    return s;
  };
  /** One footer band -> one element (the run monitor's vocabulary; see Interfaces). */
  function bandEl(nodeId, band) {
    if (band.kind === 'fan') {
      const fan = h('div', 'fan');
      for (const led of band.leds || []) fan.appendChild(h('i', `sq${led === 'run' ? ' on' : ''}`));
      fan.appendChild(h('span', 'fl', `×${band.count}`));
      return fan;
    }
    if (band.kind === 'strip') {
      const btn = doc.createElement('button');
      btn.type = 'button'; btn.className = 'xtoggle'; btn.dataset.nodeId = nodeId;
      btn.setAttribute('aria-expanded', band.expanded ? 'true' : 'false');
      const sq = h('span', 'xsq');
      for (const led of band.leds || []) sq.appendChild(h('i', `xq is-${led}`));
      btn.append(sq, h('span', 'xsum', band.summary || ''), svgChevron());
      return btn;
    }
    if (band.kind === 'exec') {
      const row = h('div', `xrow is-${band.led || 'pending'}`);
      row.dataset.executionId = band.executionId || '';
      row.dataset.nodeId = nodeId;
      row.append(h('i', 'led'), h('span', 'xl', band.label || ''), h('span', 'xr', band.right || ''));
      return row;
    }
    const res = h('div', 'xresult');           // kind: 'result'
    if (!band.path) { res.textContent = band.text || ''; return res; }
    const a = h('a', null, band.text || '');
    a.href = '#'; a.dataset.path = band.path; a.title = band.path;
    res.appendChild(a);
    return res;
  }
```
(The `.xfoot/.xtoggle/.xrow/.xresult/.ngate/.nrun/.wfired/.fan` CSS is P6's — these fast paths are structure only; the jsdom pins above never read styles.)

**P5-E6** (A14 — Task 3: bounds/fit through the shared geometry)
old_string:
```
  /** MODEL bounds (no DOM measure): the union of the nodeSize boxes, padded. */
  function bounds(pad = 0) {
    if (!current || !current.nodes.length) return null;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const n of current.nodes) {
      const s = sizeOf(n);
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + s.w); y1 = Math.max(y1, n.y + s.h);
    }
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  }
```
new_string:
```
  /** MODEL bounds (no DOM measure): the shared `graphBounds` over the rendered
   *  template, with this view's footer rows (only the view knows them). */
  function bounds(pad = 0) {
    if (!current || !current.nodes.length) return null;
    return graphBounds(current, portsAt, { pad, footerRowsOf: (n) => footers.get(n.id) || 0 });
  }
  /** `fitBounds` → `{z, tx, ty}` mapped onto this view's `{x, y, z}` transform. */
  const applyFit = (b, width, height, zoomMax) => {
    const f = fitBounds(b, { width, height }, { zoomMin: zMin, zoomMax });
    setTransform({ x: f.tx, y: f.ty, z: f.z });
  };
```
old_string:
```
    fit({ insetRight = 0, pad = 60 } = {}) {
      const r = view.readRect();
      const b = bounds(pad);
      if (!b) return;
      const vw = Math.max(1, (r.width || 0) - insetRight);
      const vh = Math.max(1, r.height || 0);
      const z = clamp(Math.min(vw / b.w, vh / b.h), zMin, 1);
      setTransform({ x: (vw - b.w * z) / 2 - b.x * z, y: (vh - b.h * z) / 2 - b.y * z, z });
    },
```
new_string:
```
    fit({ insetRight = 0, pad = 60 } = {}) {
      const r = view.readRect();
      const b = bounds(pad);
      if (!b) return;
      applyFit(b, Math.max(1, (r.width || 0) - insetRight), Math.max(1, r.height || 0), 1);   // never past 1×
    },
```
old_string:
```
    fitToWidth(w) {
      const r = view.readRect();
      const b = bounds(60);
      if (!b) return;
      const vw = Math.max(1, w || r.width || 0);
      const z = clamp(Math.min(vw / b.w, 1), zMin, 1);
      setTransform({ x: (vw - b.w * z) / 2 - b.x * z, y: (Math.max(1, r.height || 0) - b.h * z) / 2 - b.y * z, z });
    },
```
new_string:
```
    fitToWidth(w) {
      const r = view.readRect();
      const b = bounds(60);
      if (!b) return;
      const vw = Math.max(1, w || r.width || 0);
      const f = fitBounds(b, { width: vw, height: Number.MAX_SAFE_INTEGER }, { zoomMin: zMin, zoomMax: 1 });   // width decides z
      setTransform({ x: f.tx, y: (Math.max(1, r.height || 0) - b.h * f.z) / 2 - b.y * f.z, z: f.z });
    },
```
(import `graphBounds, fitBounds` from `../../../src/shared/graph/geometry.mjs` next to `nodeSize`; the `clamp` helper stays for `zoomAbout`.)

**P5-E7** (A12 — `createNav` reports engagement)
old_string:
```
    createNav({ wheelPan: pan = wheelPan } = {}) {
      if (mode === 'static') return { destroy() {} };
      let engaged = pan === 'always';
```
new_string:
```
    createNav({ wheelPan: pan = wheelPan, onEngaged = null } = {}) {
      if (mode === 'static') return { destroy() {} };
      let engaged = pan === 'always';
      const setEngaged = (v) => { if (engaged !== v) { engaged = v; if (onEngaged) onEngaged(v); } };
```
old_string:
```
      const engage = () => { engaged = true; };
      const disengage = (ev) => { if (pan !== 'always' && !stage.contains(ev.target)) engaged = false; };
      const onKey = (ev) => { if (ev.key === 'Escape' && pan !== 'always') engaged = false; };
```
new_string:
```
      const engage = () => setEngaged(true);
      const disengage = (ev) => { if (pan !== 'always' && !stage.contains(ev.target)) setEngaged(false); };
      const onKey = (ev) => { if (ev.key === 'Escape' && pan !== 'always') setEngaged(false); };
```
(Task 3 Interfaces: `view.createNav({wheelPan, onEngaged}) → {isEngaged, destroy}`; add to the "monitor nav" test: `const seen = []; view.createNav({ wheelPan: 'engaged', onEngaged: (v) => seen.push(v) })` → after the pointerdown `seen` is `[true]`, after Escape `[true, false]`.)

**P5-E8** (A11/A12 — handoff)
old_string:
```
P6 consumes `createGraphView(host, {mode:'monitor'|'static', portsFn, agents, raf, viewport, zoomMin, zoomMax, wheelPan})`, the fast paths `setStatus`/`setFooter`/`setWireLive`/`applyDecor`/`moveNode`/`setTransform`/`fit`/`fitToWidth`/`centerOn`, `view.createNav({wheelPan:'engaged'})` for the detail pages, and `mountStaticGraph(host, tpl, …)` + `thumbnailFor(tpl, portsFn, …)` for the Running list card.
```
new_string:
```
P6 consumes `createGraphView(host, {mode:'monitor'|'static', portsFn, agents, raf, viewport, zoomMin, zoomMax, wheelPan})`, the fast paths `setStatus`/`setFooter(nodeId, bands)`/`setNodeChrome`/`setWireBadge`/`setWireLive`/`moveNode`/`setTransform({x,y,z})`/`fit`/`fitToWidth`/`centerOn` plus `nodeEl(id)`/`wireEl(id)` (the view has NO `applyDecor` — P6's `run-decor.mjs` owns that pass), `view.createNav({wheelPan:'engaged', onEngaged})` for the detail pages (the view never auto-binds a nav), and `mountStaticGraph(host, tpl, …)` + `thumbnailFor(tpl, portsFn, …)` for the Running list card. Cards carry `data-node-id`, wire paths `data-wire-id`, loop badges `.wbadge[data-wire-id]`.
```

**P5-E9** (Q&A)
old_string:
```
- **Q6** — `decor` bag shape accepted by `render`? → **`{status:{nodeId:status}, footers:{nodeId:rows}, wireLive:[wireId]}`, applied through the same fast paths (planner default; P6 owns the real decor contract).**
```
new_string:
```
- **Q6** — Does `render` accept a `decor` bag? → **No. The view exposes the run-mode fast paths — `setStatus`, `setFooter(nodeId, bands)` (band vocabulary `fan | strip | exec | result`), `setNodeChrome`, `setWireBadge`, `setWireLive` — and P6's `run-decor.mjs` `applyDecor(view, decor)` is the ONE decor pass, run after every `render` (agent adjudication, cross-plan pass 2026-08-27: the view owns every card byte, P6 owns the decor reducer, no plan rewrites another's function body).**
```
old_string:
```
- **Q11** — Does the view use `graphBounds`/`fitBounds` from the shared geometry module? → **No: the view computes bounds locally from `nodeSize`, because only the view knows each card's `footerRows` and the fit band needs the inspector inset + the ≤ 1× cap (planner default; flagged for the cross-plan pass).**
```
new_string:
```
- **Q11** — Does the view use `graphBounds`/`fitBounds` from the shared geometry module? → **Yes: `bounds()` delegates to `graphBounds(current, portsAt, {pad, footerRowsOf})` (the view supplies its footer rows through that hook) and `fit`/`fitToWidth` map `fitBounds`'s `{z, tx, ty}` onto the view transform with the inspector inset applied to the viewport width and `zoomMax: 1`; P6's run-hosts use the same two functions — one source of truth (agent adjudication, cross-plan pass 2026-08-27).**
- **Q13** — Who reports nav engagement to a host? → **`view.createNav({wheelPan, onEngaged})` calls `onEngaged(true|false)` on every change; a monitor host toggles its `rg-engaged` class from it and keeps no engagement state of its own (agent adjudication, cross-plan pass 2026-08-27).**
```

### P6 — `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P6-run-monitor-v2-cli.md`

**P6-E0** (status banner)
old_string:
```
# Node-Graph v2 — P6: Run monitor v2 + CLI Implementation Plan
```
new_string:
```
# Node-Graph v2 — P6: Run monitor v2 + CLI Implementation Plan

> **Status: v1 draft (contract-aligned 2026-08-27). Re-anchor + refine per the house recipe before execution — anchors valid for dev @ e6968e15 only.**
```

**P6-E1** (A27 — bookend ids from the shared constants; `formatExecLine` skips them)
old_string:
```
/** Ledger keys the bookends own; never executions, never progress. */
const BOOKEND_EXECS = new Set(['x:preflight:1', 'x:done:1']);
```
new_string:
```
/** Ledger keys the bookends own; never executions, never progress (P1's shared
 *  constant — `import { BOOKEND_EXECUTION_IDS } from '../../../src/shared/graph/constants.mjs'`). */
const BOOKEND_EXECS = new Set(BOOKEND_EXECUTION_IDS);
```
old_string:
```
  if (!ev || !ev.nodeId || ev.status === 'skipped') return '';
```
new_string:
```
  if (!ev || !ev.nodeId || ev.status === 'skipped') return '';
  if (BOOKEND_EXECUTION_IDS.includes(ev.executionId)) return '';   // P8's preflight/done rows render nothing
```
old_string:
```
        .filter((s) => s && !['x:preflight:1', 'x:done:1'].includes(s.executionId || s.key)).length;
```
new_string:
```
        .filter((s) => s && !BOOKEND_EXECUTION_IDS.includes(s.executionId || s.key)).length;
```
(`src/cli/render.mjs` imports `BOOKEND_EXECUTION_IDS` from `../shared/graph/constants.mjs`; add to the Task 15 Interfaces: "`formatExecLine` returns `''` for a bookend executionId".)

**P6-E2** (A11 — Task 3 consumes P5's fast paths; no `view.mjs` edit here)
old_string:
```
**Files:** modify `ui/public/graph/view.mjs`; modify `ui/public/style.css` (append a new block after the v1 run-flow block that ends at `style.css:1373`); create `test/ui-run-hosts.test.mjs`.
```
new_string:
```
**Files:** modify `ui/public/style.css` (append a new block after the v1 run-flow block that ends at `style.css:1373`); create `test/ui-run-hosts.test.mjs`. `ui/public/graph/view.mjs` is NOT modified: P5a Task 2 ships `setFooter(nodeId, bands)`, `setNodeChrome` and `setWireBadge` with exactly the vocabulary below (cross-plan pass 2026-08-27) — the three view tests in this task are consumer-side PINS of that contract.
```
old_string:
```
**Interfaces produced (additive — the composer never calls them, so `edit` mode is untouched):**
```
new_string:
```
**Interfaces consumed (P5a Task 2 — the composer never calls them, so `edit` mode is untouched):**
```
old_string:
```
- [ ] Step 3: Implement — inside `createGraphView` in `ui/public/graph/view.mjs`, add the three fast paths next to the existing ones (`setStatus`, `setWireLive`, …) and expose them on the returned object. The view already keeps `nodeEls: Map<nodeId, el>`, `wireEls`, `badgeEls` and `world`; cards carry `data-node-id`. If a `setFooter` already exists from P5, REPLACE its body with this one (the band vocabulary is the contract this plan's decor speaks).
```
new_string:
```
- [ ] Step 3: Verify P5 shipped the three fast paths — `grep -n "setFooter(nodeId, bands)\|setNodeChrome(nodeId\|setWireBadge(wireId" ui/public/graph/view.mjs` prints three lines. If any is missing, STOP: P5a Task 2 owns them (its `test/ui-graph-view.test.mjs` pins them) — never re-implement or replace a view function body from this plan. **The code block below is P5's implementation, kept here for REFERENCE only (do not apply it):**
```
old_string:
```
> `nodeOf(id)` / `portsOfNode(node)` are the view's own lookups (the rendered template's node by id and `portsFn(node)`); use whatever they are already called in `view.mjs`. `nodeSize` is imported from `../../../src/shared/graph/geometry.mjs` — P5 already imports it.
```
new_string:
```
> (Reference block ends. In P5's view the lookups are `ctx.byId.get(nodeId)` / `portsAt(node)` / `sizeOf(node)` and the height write goes through the view's own `footers` map — see P5 Task 2.)
```

**P6-E3** (A14 — run-hosts use the shared bounds/fit)
old_string:
```
import { nodeSize } from '../../../src/shared/graph/geometry.mjs';
```
new_string:
```
import { graphBounds, fitBounds } from '../../../src/shared/graph/geometry.mjs';
```
old_string:
```
/** World bounds of the manifest, including whatever footers the decor adds. */
export function worldBounds(stepper, portsFn, footerRowsOf) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of manifestNodes(stepper)) {
    const { w, h } = nodeSize(n, portsFn(n), { footerRows: footerRowsOf(n.id) });
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Centre `b` in a vw×vh viewport; fit NEVER magnifies past 1x (spec §7.6). */
export function fitInto(b, vw, vh, { pad = 24, zoomMin = 0.3, zoomMax = 1.6 } = {}) {
  const bw = b.w + pad * 2, bh = b.h + pad * 2;
  if (bw <= 0 || bh <= 0 || vw <= 0 || vh <= 0) return { x: 0, y: 0, zoom: 1 };
  const zoom = clamp(Math.min(vw / bw, vh / bh, 1), zoomMin, zoomMax);
  return { x: (vw - b.w * zoom) / 2 - b.x * zoom, y: (vh - b.h * zoom) / 2 - b.y * zoom, zoom };
}
```
new_string:
```
/** World bounds of the manifest incl. whatever footers the decor adds — the
 *  SHARED geometry (`graphBounds`) over the manifest's template, with this
 *  host's footer rows supplied through `footerRowsOf(node)`. */
export function worldBounds(stepper, portsFn, footerRowsOf, pad = 0) {
  return graphBounds(manifestTemplate(stepper), portsFn, { pad, footerRowsOf: (n) => footerRowsOf(n.id) })
    || { x: 0, y: 0, w: 0, h: 0 };
}

/** Centre `b` (already padded) in a vw×vh viewport through the SHARED `fitBounds`;
 *  fit NEVER magnifies past 1× (spec §7.6). Returns the view's `{x, y, z}`. */
export function fitInto(b, vw, vh, { zoomMin = 0.3 } = {}) {
  const f = fitBounds(b, { width: vw, height: vh }, { zoomMin, zoomMax: 1 });
  return { x: f.tx, y: f.ty, z: f.z };
}
```
old_string:
```
    const b = worldBounds(stepper, portsFn, footerRowsOf);
    const r = rect();
    if (isStatic) {
      view.setTransform(fitInto(b, Math.max(0, r.width - STATIC_INSET), STATIC_HOST_H - STATIC_INSET, { pad: 16, zoomMin, zoomMax }));
      return;
    }
    // Two-pass: the WIDTH decides the zoom, the zoom decides the host height.
    const vw = Math.max(0, r.width);
    const zw = clamp(Math.min(vw / (b.w + 48), 1), zoomMin, zoomMax);
    const hostH = clamp(Math.round(b.h * zw + DETAIL_PAD_H), DETAIL_MIN_H, DETAIL_MAX_H);
    wrap.style.setProperty('--gv-host-h', `${hostH}px`);
    view.setTransform(fitInto(b, vw, hostH, { pad: 24, zoomMin, zoomMax }));
```
new_string:
```
    const r = rect();
    if (isStatic) {
      const b = worldBounds(stepper, portsFn, footerRowsOf, 16);
      view.setTransform(fitInto(b, Math.max(0, r.width - STATIC_INSET), STATIC_HOST_H - STATIC_INSET, { zoomMin }));
      return;
    }
    // Two-pass: the WIDTH decides the zoom, the zoom decides the host height.
    const b = worldBounds(stepper, portsFn, footerRowsOf, 24);
    const vw = Math.max(0, r.width);
    const zw = clamp(Math.min(vw / b.w, 1), zoomMin, 1);
    const hostH = clamp(Math.round((b.h - 48) * zw + DETAIL_PAD_H), DETAIL_MIN_H, DETAIL_MAX_H);   // b is padded 24 each side
    wrap.style.setProperty('--gv-host-h', `${hostH}px`);
    view.setTransform(fitInto(b, vw, hostH, { zoomMin }));
```

**P6-E4** (A12 — monitor hosts bind the nav and get engagement from it)
old_string:
```
        wheelPan: isStatic ? 'always' : 'engaged' });
```
new_string:
```
        wheelPan: isStatic ? 'always' : 'engaged' });
      // The view never auto-binds a nav: monitor hosts ask for one (D8 engaged-only)
      // and learn engagement from it — run-hosts keeps NO engagement state of its own.
      if (!isStatic) nav = view.createNav({ wheelPan: 'engaged', onEngaged: (on) => wrap.classList.toggle('rg-engaged', on) });
```
old_string:
```
    const engage = () => wrap.classList.add('rg-engaged');
    const release = () => wrap.classList.remove('rg-engaged');
    on(wrap, 'pointerdown', engage);
    on(wrap, 'focusin', engage);
    on(doc, 'pointerdown', (e) => { if (!wrap.contains(e.target)) release(); }, true);
    on(doc, 'keydown', (e) => { if (e.key === 'Escape') release(); });
```
new_string:
```
    // (engage/disengage listeners live in the view's nav — see createGraphView above)
```
old_string:
```
- [ ] Step 4: If `view.mjs` does not honor `wheelPan`, add it to its wheel handler: `if (wheelPan === 'engaged' && !ev.ctrlKey && !ev.metaKey && !engaged) return;` BEFORE `preventDefault()` (engagement = a `pointerdown` inside the stage or `focus`, cleared on Escape / an outside pointerdown), so the page keeps scrolling over a graph nobody clicked into.
```
new_string:
```
- [ ] Step 4: `view.mjs` is NOT edited here. P5's `createNav({wheelPan:'engaged', onEngaged})` implements the D8 policy (plain wheel only while engaged — pointerdown inside / focus; ⌘/Ctrl+wheel always; Escape / outside pointerdown disengages) and reports every change through `onEngaged`; `destroy()` must call `nav.destroy()` (declare `let nav = null;` beside `view`) before `view.destroy()`.
```
(Task 5 prose "Wheel policy (D8, engaged-only) — … if `view.mjs` does not yet honor `wheelPan`, add it there (same policy, one `if`)": delete the trailing clause — P5 ships it.)

**P6-E5** (A3 — the gate ask carries no `deliveryNo`; the CLI derives it from the id)
old_string:
```
  const n = payload && payload.deliveryNo ? Number(payload.deliveryNo) : max;
```
new_string:
```
  // P3 gate ask ids are `gate-<wireId>-<deliveryNo>` (spec §5.3); no deliveryNo field rides the payload.
  const m2 = /-(\d+)$/.exec(String((payload && payload.id) || ''));
  const n = m2 ? Number(m2[1]) : max;
```
old_string:
```
  assert.equal(formatGateHeader({ kind: 'gate', wireId: 'w9', deliveryNo: 3 }, M), '? Loop gate · Reviewer → Implementer  3/3 cycles used');
```
new_string:
```
  assert.equal(formatGateHeader({ id: 'gate-w9-3', kind: 'gate', wireId: 'w9' }, M), '? Loop gate · Reviewer → Implementer  3/3 cycles used');
```

**P6-E6** (Q&A)
old_string:
```
- **D2** — Zoom clamps per surface?
```
new_string:
```
- **D2 / spec §7.6–§8** — Zoom clamps per surface? (D2 itself fixes only "no on-canvas controls" and the composer's 0.4–1.6; the per-mode clamps are the spec's.)
```
old_string:
```
- **P6-2** — How does the footer reach the view without run-decor writing heights?
```
new_string:
```
- **P6-2** (P5a Task 2 ships it; this plan consumes) — How does the footer reach the view without run-decor writing heights?
```
old_string:
```
- **P6-3** — Where do the per-card ornaments live?
```
new_string:
```
- **P6-3** (P5a Task 2 ships them; this plan consumes) — Where do the per-card ornaments live?
```
old_string:
```
- **P6-13** — Where do the CLI's `task 3/7` numbers come from?
```
new_string:
```
- **P6-13** (settled: P3 emits `taskIndex`/`taskTotal` on `kind:'task'` exec events, P4 persists them — cross-plan pass 2026-08-27) — Where do the CLI's `task 3/7` numbers come from?
```

### P7 — `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P7-agents-view-agent-gen-plugin-api-3.md`

**P7-E0** (status banner)
old_string:
```
# Node-Graph v2 — P7: Agents view port editor + agent-gen v2 + plugin API 3 Implementation Plan
```
new_string:
```
# Node-Graph v2 — P7: Agents view port editor + agent-gen v2 + plugin API 3 Implementation Plan

> **Status: v1 draft (contract-aligned 2026-08-27). Re-anchor + refine per the house recipe before execution — anchors valid for dev @ e6968e15 only.**
```

**P7-E1** (A22 — one message, one formatter, server-side)
old_string:
```
**Interfaces produced:** `WORCA_PLUGIN_API = 3`, `WORCA_PLUGIN_APIS = [1, 2, 3]`; `declaredApi(range) → number|null`; `dataContractIssues(absDir) → { agentsV1: string[], workflowsV1: string[] }`; `apiMismatch(range, issues) → null | { builtFor, host: 3, agents: number, workflows: number }`.
```
new_string:
```
**Interfaces produced:** `WORCA_PLUGIN_API = 3`, `WORCA_PLUGIN_APIS = [1, 2, 3]`; `declaredApi(range) → number|null`; `dataContractIssues(absDir) → { agentsV1: string[], workflowsV1: string[] }`; `apiMismatchMessage(mismatch) → string` (the ONE user-facing sentence, spec §9 wording); `apiMismatch(range, issues) → null | { builtFor, host: 3, agents: number, workflows: number, message: string }` (`message = apiMismatchMessage(...)` — the browser, the doctor and the CLI all print this field; no other formatter exists).
```
old_string:
```
  return { builtFor: declaredApi(range) || null, host: WORCA_PLUGIN_API, agents, workflows };
}

/** Server-side one-liner for `worca plugin doctor` / `worca plugin list`. The
 *  Plugins view renders its own, longer sentence (plugins-view.apiMismatchMessage). */
export function apiMismatchDetail(mismatch) {
  if (!mismatch) return `agents and pipeline templates are plugin API ${WORCA_PLUGIN_API} (meta v2 + graph templates)`;
  const { agents, workflows } = mismatch;
  return `${agents} agent sidecar(s) and ${workflows} pipeline template(s) are not plugin API ${WORCA_PLUGIN_API} — update or reinstall the plugin`;
}
```
new_string:
```
  const mismatch = { builtFor: declaredApi(range) || null, host: WORCA_PLUGIN_API, agents, workflows };
  mismatch.message = apiMismatchMessage(mismatch);
  return mismatch;
}

/**
 * THE user-facing sentence (spec §9 wording, "worca" is the product name) —
 * rendered verbatim by the Plugins view (`p.apiMismatch.message`), the doctor's
 * `agents-api` check and `worca plugin list`. An API-outdated plugin is NOT
 * corrupt: it installed fine and its connector or chat channel still works —
 * worca simply ignores the agents and pipeline templates it ships.
 */
export function apiMismatchMessage(mismatch) {
  if (!mismatch) return '';
  const { builtFor, agents, workflows } = mismatch;
  return `built for plugin API ${builtFor ?? 'an older version'}; this version of worca requires `
    + `plugin API ${WORCA_PLUGIN_API} for agents and pipeline templates — update or reinstall the plugin `
    + `(${agents} agent(s), ${workflows} template(s) ignored)`;
}
```
old_string:
```
  const m = apiMismatch('>=1 <2', issues);
```
new_string:
```
  const m = apiMismatch('>=1 <2', issues);
  assert.equal(m.message, 'built for plugin API 1; this version of worca requires plugin API 3 for agents and pipeline templates — update or reinstall the plugin (1 agent(s), 1 template(s) ignored)');
  assert.match(apiMismatch('', issues).message, /^built for plugin API an older version; /);
```
(adjust the `(1 agent(s), 1 template(s) ignored)` counts to whatever `issues` the test builds; the other assertions on `m` compare the remaining fields — use `assert.deepEqual({ ...m, message: undefined }, …)` or per-field equality.)

**P7-E2** (A22 — Task 6: no browser formatter)
old_string:
```
**Interfaces produced:** `listInstalledPlugins()[i].apiMismatch: null | {builtFor, host, agents, workflows}`; `dirChecks` gains an `agents-api` check; `apiMismatchMessage(mismatch) → string` exported from `ui/public/plugins-view.mjs`.
```
new_string:
```
**Interfaces produced:** `listInstalledPlugins()[i].apiMismatch: null | {builtFor, host, agents, workflows, message}`; `dirChecks` gains an `agents-api` check whose `detail` is `apiMismatch.message` (or the healthy line). The browser has NO formatter: `plugins-view.mjs` renders `p.apiMismatch.message` verbatim (one text, one owner — Task 1's `apiMismatchMessage`).
```
old_string:
```
// test/plugins-view.test.mjs (append; import apiMismatchMessage alongside renderPluginList)
```
new_string:
```
// test/plugins-view.test.mjs (append) — the fixture carries the server-built `message`
```
old_string:
```
      apiMismatch: { builtFor: 2, host: 3, agents: 1, workflows: 1 } },
```
new_string:
```
      apiMismatch: { builtFor: 2, host: 3, agents: 1, workflows: 1,
        message: 'built for plugin API 2; this version of worca requires plugin API 3 for agents and pipeline templates — update or reinstall the plugin (1 agent(s), 1 template(s) ignored)' } },
```
old_string:
```
test('apiMismatchMessage degrades when the declared API is unknown', () => {
  assert.match(apiMismatchMessage({ builtFor: null, host: 3, agents: 2, workflows: 0 }),
    /^built for plugin API an older version; /);
  assert.equal(apiMismatchMessage(null), '');
});
```
new_string:
```
test('a card without apiMismatch renders no note (the browser has no formatter of its own)', () => {
  const el = renderPluginList([{ name: 'fine', version: '1.0.0', enabled: true, contributions: {} }], { doc });
  assert.equal(el.querySelector('.pl-api-note'), null);
});
```
old_string:
```
  assert.deepEqual(p.apiMismatch, { builtFor: 1, host: 3, agents: 1, workflows: 0 });
```
new_string:
```
  assert.deepEqual(p.apiMismatch, { builtFor: 1, host: 3, agents: 1, workflows: 0,
    message: 'built for plugin API 1; this version of worca requires plugin API 3 for agents and pipeline templates — update or reinstall the plugin (1 agent(s), 0 template(s) ignored)' });
```
old_string:
```
`ui/public/plugins-view.mjs` — add the exported formatter above `contribSummary` (`:32`):
```js
// An API-outdated plugin is NOT corrupt: it installed fine and its connector or
// chat channel still works — worca simply ignores the agents and pipeline
// templates it ships, because they are still on the old data contract.
// `broken` alone would read as "reinstall me" and say nothing about why.
export function apiMismatchMessage(mismatch) {
  if (!mismatch) return '';
  const { builtFor, agents, workflows } = mismatch;
  return `built for plugin API ${builtFor ?? 'an older version'}; this version of worca requires `
    + 'plugin API 3 for agents and pipeline templates — update or reinstall the plugin '
    + `(${agents} agent(s), ${workflows} template(s) ignored)`;
}
```
```
new_string:
```
`ui/public/plugins-view.mjs` — NO formatter here: the sentence arrives on `p.apiMismatch.message` (Task 1's `apiMismatchMessage`, server-side). `broken` alone would read as "reinstall me" and say nothing about why, hence the separate badge + note:
```
old_string:
```
    if (p.apiMismatch) card.appendChild(h(doc, 'small', 'pl-api-note hint err', apiMismatchMessage(p.apiMismatch)));
```
new_string:
```
    if (p.apiMismatch) card.appendChild(h(doc, 'small', 'pl-api-note hint err', p.apiMismatch.message || ''));
```
old_string:
```
import { normalizeManifest, validatePluginDir, apiSatisfies, dataContractIssues, apiMismatch, apiMismatchDetail } from './plugin-manifest.mjs';
```
new_string:
```
import { normalizeManifest, validatePluginDir, apiSatisfies, dataContractIssues, apiMismatch } from './plugin-manifest.mjs';
```
old_string:
```
    c('agents-api', !mismatch, apiMismatchDetail(mismatch));
```
new_string:
```
    c('agents-api', !mismatch, mismatch ? mismatch.message : 'agents and pipeline templates are plugin API 3 (meta v2 + graph templates)');
```
old_string:
```
          if (p.apiMismatch) out(c('yellow', `  ${manifestMod.apiMismatchDetail(p.apiMismatch)}`));
```
new_string:
```
          if (p.apiMismatch) out(c('yellow', `  ${p.apiMismatch.message}`));
```

**P7-E3** (Q&A)
old_string:
```
- **P7.7** — Does the doctor/CLI repeat that sentence?
```
new_string:
```
- **P7.7** — Does the doctor/CLI repeat that sentence? → **Yes — it is the ONLY sentence: `apiMismatchMessage(mismatch)` lives in `plugin-manifest.mjs`, `apiMismatch()` stamps it as `message`, and the Plugins view, the doctor's `agents-api` detail and `worca plugin list` all print that field verbatim; there is no second formatter and no browser copy (agent adjudication, cross-plan pass 2026-08-27 — one canonical text per message; supersedes the answer below).** Original answer, superseded:
```

### P8 — `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P8-break-kill-list-docs.md`

**P8-E0** (status banner)
old_string:
```
# Node-Graph v2 — P8: The break + kill list + docs Implementation Plan
```
new_string:
```
# Node-Graph v2 — P8: The break + kill list + docs Implementation Plan

> **Status: v1 draft (contract-aligned 2026-08-27). Re-anchor + refine per the house recipe before execution — anchors valid for dev @ e6968e15 only.**
```

**P8-E1** (A26 — `phases.mjs` survivors include the executor's imports)
old_string:
```
plus P3's exports `siblingsBlock`, `mockMarkers`, `diffInstruction`, and the two helpers re-homed in Step 2.
```
new_string:
```
plus P3's exports `siblingsBlock`, `mockMarkers`, `diffInstruction`, `runOpts :397`, `READ_WRITE_TOOLS`, `IMPLEMENTER_TOOLS` (the v2 executor imports all six — `grep -n "from '../phases.mjs'" src/core/graph/executor.mjs` is the authority; whatever it names survives), and the two helpers re-homed in Step 1.
```
old_string:
```
`renderPromptArtifact` is used by the harness's entry-prompt artifact — `grep -rn "renderPromptArtifact" src ui` and re-point every importer at `phases.mjs`.
```
new_string:
```
`renderPromptArtifact` is used by the graph orchestrator's Task-card document (`src/core/graph/orchestrator.mjs` imports it from `../channels.mjs` since P4 — A6 of the cross-plan pass) and by the dying v1 entry-prompt seed — `grep -rn "renderPromptArtifact" src ui` and re-point every surviving importer at `phases.mjs`.
```

**P8-E2** (A27 — the bookend ids are P1's shared constant)
old_string:
```
**Interfaces:** produces `BOOKEND_EXECUTION_IDS = new Set(['x:preflight:1', 'x:done:1'])` exported from `ui/public/graph/run-decor.mjs`;
```
new_string:
```
**Interfaces:** consumes `BOOKEND_EXECUTION_IDS` (frozen array `['x:preflight:1', 'x:done:1']`) from `src/shared/graph/constants.mjs` (P1) — already imported by `run-decor.mjs` and `src/cli/render.mjs` since P6, which already exclude those rows from progress/execution counts and render nothing for them;
```
old_string:
```
- [ ] Step 5: Bookends must not inflate the UI. In `ui/public/graph/run-decor.mjs` add and use:
```
new_string:
```
- [ ] Step 5: Bookends must not inflate the UI — VERIFY, do not add: `grep -n "BOOKEND_EXECUTION_IDS" src/shared/graph/constants.mjs ui/public/graph/run-decor.mjs src/cli/render.mjs` prints the P1 export plus one import and one use in each consumer (P6 shipped them). Run `node --test test/ui-run-decor.test.mjs test/cli-exec-render.test.mjs` with a ledger carrying the two bookend rows: progress/executions exclude them and `formatExecLine` returns `''`. If a consumer lacks the filter, add exactly this (P6's contract):
```
old_string:
```
  and filter at the top of `decorFromState`: `const rows = steps.filter((s) => !BOOKEND_EXECUTION_IDS.has(s.executionId || s.key));`
```
new_string:
```
  and filter at the top of `decorFromState`: `const rows = steps.filter((s) => !BOOKEND_EXECUTION_IDS.includes(s.executionId || s.key));` (an ARRAY — `.includes`, never `.has`)
```

**P8-E3** (Q&A)
old_string:
```
- **B10** — What survives in `phases.mjs`?
```
new_string:
```
- **B10** (amended by the cross-plan pass 2026-08-27: the survivor set also carries `runOpts`, `READ_WRITE_TOOLS`, `IMPLEMENTER_TOOLS` — P3's executor imports them — and `renderPromptArtifact`'s surviving importer is `src/core/graph/orchestrator.mjs`) — What survives in `phases.mjs`?
```
old_string:
```
- **B11** — How do bookends reach the CLI and the decor?
```
new_string:
```
- **B11** (amended by the cross-plan pass 2026-08-27: `BOOKEND_EXECUTION_IDS` is P1's export in `src/shared/graph/constants.mjs`, consumed by P6's `run-decor.mjs` + `render.mjs` from the start — this plan verifies, it does not add) — How do bookends reach the CLI and the decor?
```

## C. Adjudicated open points

Numbering follows `open-points.md` (plan · item). Verdict vocabulary: **accept** (plan stands), **fix** (see edit ids), **superseded** (another plan's contract wins), **no change**.

### P4 (12 tasks) — assumed shapes 1–15, choices 16–35
- **C1** · P4 · 1 `resolveGraph → {template, ports, nodeCtx}` with rich `nodeCtx` · **superseded by A1**: P2's `{template, ports, loops, nodes, wires, agentsByKey, agentKeys}`; P4 aliases `nodeCtx = nodes`; `templateKey`→`authoredKey`, `config`/`duplicateKey` added by P2; `loops` returned by P2 (no second Tarjan) · P2-E5…E13, P4-E1, P4-E5, P4-E6.
- **C2** · P4 · 2 `loops.loopWireIds`/`launchOrder` field names · **accept** (P2 ships exactly those) · no change.
- **C3** · P4 · 3 `buildGraphManifest(tpl, agentsByKey, {overlays})`, `agentsByKey` = raw registry, overlays = EFFECTIVE values · **fix (A2)**: `agentsByKey = resolved.agentsByKey` (the substituted slice — the raw registry lacks nothing but the resolved template's keys are what the builder indexes), overlays = the resolver's `nodes`/`wires` tables verbatim (effective values; extra keys ignored); `uiPhase`, `ports.await` boolean, shim cells + feedbacks all confirmed in P2 Task 11 · P4-E5, P4-E6.
- **C4** · P4 · 4 P4 stamps `manifest.template` itself · **fix**: P2's builder stamps `template:{id,name}` from `tpl.id/name` (the alias row already carries the requested id) — P4's post-stamp deleted · P4-E5.
- **C5** · P4 · 5 `manifestTemplate`/`manifestPortsFn` shapes · **accept** (P2 Task 11 code matches) · no change.
- **C6** · P4 · 6 `createScheduler` options + `reattach` before `run()`, no `taskArtifact` option · **accept**; `taskArtifact` rides `ctx` (A6) · P4-E8.
- **C7** · P4 · 7 `onGate(...) → 'another'|'continue'`, `onAsk(payload) → answer` · **superseded by A3** (P3's split) · P4-E9, P4-E11, P4-E12, P4-E21.
- **C8** · P4 · 8 `getState()` = `{active, wires, tokens, gate, ended}` · **superseded by A7** (P3's shape: `wireDeliveries`, `warnings`, `endReached`, `result` …) · P4-E11.
- **C9** · P4 · 9 execute args carry `parentExecutionId` on slices · **fix**: P3's `runSlice` args did NOT carry it (only `slice`) — P3 now passes `parentExecutionId`, `taskIndex`, `taskTotal` (A9) · P3-E4, P4-E14.
- **C10** · P4 · 10 `allocateOutputs`/`allocateVerdict` signatures, `runCtx.planVersion` a function · **accept** (P3 Task 6 matches) · no change.
- **C11** · P4 · 11 `RunHarness` named export; no `rp.version` literal in the base · **accept** (P1 S8 seam) · no change.
- **C12** · P4 · 12 `_preflightAgentKeys(Set)` on the base · **accept** (P1: iterable) · no change.
- **C13** · P4 · 13 `assertRunnableWorkflow` codes; `readWorkflow(id, {includeArchived})` · **accept** · no change.
- **C14** · P4 · 14 `writeGraphWorkflow({…})` for test seeding · **accept** · no change.
- **C15** · P4 · 15 fixture names + `FB_WIRE_MAP[wfId][fbId] = wireId` · **accept** · no change.
- **C16** · P4 · 16 hoist of `_onAgentEvent` + reducers + `_recordCost` + 13 helpers into `RunHarness` · **accept (A18)** — owner stays P4 Task 1; spec §5.1's "adapted twin" is void (dev's block is `attr`-only, verified `orchestrator.mjs:3074-3412`); P1 records it · P1-E8 (P1-r).
- **C17** · P4 · 17 exported pure helpers from `run-harness.mjs` · **accept** · no change.
- **C18** · P4 · 18 `export` on `loadAgentFile` · **accept** · no change.
- **C19** · P4 · 19 `_artifact(kind, path, attr)` additive keys · **accept** (A32) · no change.
- **C20** · P4 · 20 `_log` gains `executionId` · **accept**; `_ask` ALSO gains `wireId`/`executionId` passthrough (A4) · P4-E20.
- **C21** · P4 · 21 `nodeIdSafe` + questions filename · **accept** · no change.
- **C22** · P4 · 22 `QUIESCENCE_WARNING` long text · **superseded by A8** (P3's `finished at quiescence — End not reached`, imported) · P4-E2, P4-E3, P4-E10, P4-E21.
- **C23** · P4 · 23 `rp.manifest` REQUIRED · **accept** · no change.
- **C24** · P4 · 24 `resolvedFromManifest(manifest, registry, agentsDir)` · **fix**: returns the resolver shape (A1) · P4-E17.
- **C25** · P4 · 25 `state.resumePoint` refreshed on every clean snapshot · **accept** (engineering merit: crash-reconciled v2 runs stay resumable; the cadence is v2-only) · no change.
- **C26** · P4 · 26 `outcome`/`exec_meta` JSON; `cycle → ordinal` alias · **accept + extend (A34)**: `exec_meta` += `taskIndex`, `taskTotal` · P4-E16.
- **C27** · P4 · 27 `_verdictKind` derivation · **accept** · no change.
- **C28** · P4 · 28 shim order pinned (`phase` right after its `exec`) · **accept** · no change.
- **C29** · P4 · 29 `createOrchestratorFor` optional `opts.template` hint · **accept** · no change.
- **C30** · P4 · 30 constructor default `wf_default_v2`; `this._runners = {...opts.runners}` · **accept the default; fix the seam (A17)**: `_runners` is assigned in the `_initRunners(opts)` hook P1's base constructor calls · P4-E4.
- **C31** · P4 · 31 `POST /api/run` 400 wording · **accept (A16)**; P2 aligns to 400 · P2-E16…E18, E21.
- **C32** · P4 · 32 parity normalization table · **accept** · no change.
- **C33** · P4 · 33 `test/helpers/git-dir.mjs`, `engines.mjs` · **accept (A31)** · no change.
- **C34** · P4 · 34 five new test files · **accept (A31)** · no change.
- **C35** · P4 · 35 `state.gate.askId` derived with `deliveryNo` · **superseded by A3**: the scheduler's gate record carries `askId`; `state.gate = onGate(g)` verbatim · P4-E9, P4-E11.

### P7 (13 tasks) — assumptions 1–5, choices 6–19
- **C36** · P7 · 1 `validateMetaV2(raw)` with no `mockWriterRoles` → no 400 for `mockRole` · **accept** (P2 item 15: uninjected vocabulary rides through) · no change.
- **C37** · P7 · 2 `Issue = {code, message}`; formats `${code}: ${message}` · **accept** (P2's `formatIssue` yields the same head; either is fine) · no change.
- **C38** · P7 · 3 `portsFnFor` answers flow kinds · **accept** (P2 `portsFnFor` → `flowPorts` for non-agents) · no change.
- **C39** · P7 · 4 `normalizeAgentMeta(raw).meta` carries defaulted ports · **accept** · no change.
- **C40** · P7 · 5 `GET /api/agents` v2 fields present after P2 · **accept** (P2 Task 10 Step 5 verifies pass-through) · no change.
- **C41** · P7 · 6 `agentFormRender(host, meta, {markdown, mockWriterRoles, registryKeys})` · **accept** · no change.
- **C42** · P7 · 7 ignored-sidecar log string · **accept (A23)** · no change.
- **C43** · P7 · 8 `scanLayer` gate plugin-layer only · **accept (A25)** — spec §6 coexistence wins over adj-f2 §1.3 · no change.
- **C44** · P7 · 9 `pluginAgentLayers()` gains `builtFor`; deepEqual pin updated · **accept** · no change.
- **C45** · P7 · 10 `apiMismatch(range, issues)` content-gated · **accept + extend (A22)**: result gains `message` · P7-E1.
- **C46** · P7 · 11 `dataContractIssues` returns basenames · **accept** · no change.
- **C47** · P7 · 12 two message functions · **fix (A22)**: ONE `apiMismatchMessage` in `plugin-manifest.mjs`; `apiMismatchDetail` deleted; browser renders `message` · P7-E1, P7-E2, P7-E3.
- **C48** · P7 · 13 `agentFormRead` omission set · **accept** · no change.
- **C49** · P7 · 14 client `AS_TYPE` hint · **accept** (hint only; the store is authoritative) · no change.
- **C50** · P7 · 15 `.row-3` + port-editor CSS · **accept** · no change.
- **C51** · P7 · 16 wizard/card mount shape · **accept** · no change.
- **C52** · P7 · 17 `_runClaude(metaOnly)` seam · **accept** · no change.
- **C53** · P7 · 18 plugin-workflows keeps its own upsert; `graph` = `{nodes, wires, canvas?}` · **accept** (matches P2 `rowToTpl`) · no change.
- **C54** · P7 · 19 `test/ui-agent-port-editor.test.mjs` · **accept (A31)** · no change.

### P6 (17 tasks) — decor/view 1–6, app 7–12, server 13, filter 14–16, CLI 17–23
- **C55** · P6 · 1 decor bag shape; host adds `run/runId/mode/histKey` · **accept** · no change.
- **C56** · P6 · 2 `setFooter(nodeId, bands)` redefinition · **fix (A11)**: the band vocabulary is right, the OWNER is P5 — P5a Task 2 ships it, P6 consumes (its tests stay as consumer pins) · P5-E3…E5, P6-E2, P6-E6.
- **C57** · P6 · 3 `setNodeChrome`/`setWireBadge` · **fix (A11)**: shipped by P5a Task 2 (same code), consumed here · P5-E3…E5, P6-E2.
- **C58** · P6 · 4 view internals (`data-node-id`, Maps, `data-wire-id`, `.wbadge[data-wire-id]`, `destroy()`, `setTransform({x,y,zoom})`, world transform string) · **accept except the transform key (A13)**: `{x, y, z}` · P6-E3 (`fitInto` returns `z`).
- **C59** · P6 · 5 `nodeOf`/`portsOfNode` names · **moot** (no view.mjs edit in P6) · P6-E2.
- **C60** · P6 · 6 `wheelPan:'engaged'` honored by the nav · **fix (A12)**: the host must CALL `view.createNav({wheelPan:'engaged', onEngaged})`; P5 adds `onEngaged`; Step 4 deleted · P5-E7, P6-E4.
- **C61** · P6 · 7 `paintGraphFor(host, stepper, decor)`; host `innerHTML=''` on first v2 mount · **accept (A15)** — clear BEFORE `createGraphView` (already so) · no change.
- **C62** · P6 · 8 `activeNodes(r)`/`activeCopy(r)` · **accept** · no change.
- **C63** · P6 · 9 `run-hosts.mjs` + `mountRunGraph` · **accept**; bounds/fit through the shared geometry (A14) · P6-E3.
- **C64** · P6 · 10 two-pass detail sizing · **accept** (formula kept, now over `graphBounds`) · P6-E3.
- **C65** · P6 · 11 `.rc-seg.rc-prog` markup · **accept** · no change.
- **C66** · P6 · 12 CSS anchor drift + new classes; `.is-error/.is-skipped` overlap with P5's state classes · **accept**: P5 lists the class NAMES on cards, P6 owns their run-mode CSS (`.run-flow .gv-world …`), no double definition · no change.
- **C67** · P6 · 13 artifact routes + `resolveIndexedArtifact` · **accept (A32)** · no change.
- **C68** · P6 · 14 filter field names, `__setLogFilter` · **accept** · no change.
- **C69** · P6 · 15 `execKey(...)`; requires `executionId` on `subagent`/`stepskills`/`stepgraphify` · **accept**; P4 Task 1 owns the emission (`attr.stepKey = executionId` reaches the reducers' payloads — P6 Task 14 Step 1 verifies) · no change.
- **C70** · P6 · 16 `cycleAwareLabel` 4th arg · **accept** · no change.
- **C71** · P6 · 17 two `fmtDur`s (CLI `1m03s` vs UI `1m 3s`) · **accept** — different surfaces, spec §8 fixes the CLI shape explicitly · no change.
- **C72** · P6 · 18 `ev.taskIndex`/`ev.taskTotal` · **fix (A9)**: P3 emits them (1-based, per phase) · P3-E3…E7, P4-E14…E16.
- **C73** · P6 · 19 paused/skipped CLI lines · **accept**; bookend rows also render `''` (A27) · P6-E1.
- **C74** · P6 · 20 `formatGateHeader` reads `payload.deliveryNo` · **fix (A3)**: parse from `payload.id` (`gate-<wireId>-<n>`) · P6-E5.
- **C75** · P6 · 21 ARCHIVED text = spec §4 · **accept (A21)** · no change.
- **C76** · P6 · 22 `--workflow` guard ownership · **accept**: P2 B7 wires it; Task 16 Step 1 verifies (idempotent add stays as fallback) · no change.
- **C77** · P6 · 23 `phase` double-print guard · **accept** · no change.
- **C78** · P6 · Q&A "D2" attribution of per-mode clamps · **fix (A35)** · P6-E6.

### P8 (21 tasks) — B2…B13, sidecars, phases-*, timestamps
- **C79** · P8 · 1 (B2) backup path from `PRAGMA database_list` · **accept** · no change.
- **C80** · P8 · 2 (B3) report JSON shape · **accept** · no change.
- **C81** · P8 · 3 (B4) `json_valid` guard on the sweep · **accept** · no change.
- **C82** · P8 · 4 (B5) `reconcileAfterFsImport(db)` after `maybeMigrateFromFs` · **accept** (adj-e §2 prescribed; spec silent; without it fs-imported v1 rows stay live post-break) · no change.
- **C83** · P8 · 5 (B6) `DEFAULT_WORKFLOW` → `LEGACY_DEFAULT_WORKFLOW` (P8a) → deleted (P8b); importers listed incl. `ask/catalog.mjs` · **accept**; the Task 7 grep sweep (`DEFAULT_WORKFLOW` outside the two names must be empty) covers `ask/proposal.mjs` and any importer dev-map §6 names · no change.
- **C84** · P8 · 6 (B7) v1 rejection text `v1 pipeline templates are no longer accepted — save a graph (version 2)` · **accept** (spec fixes only "rejects v1") · no change.
- **C85** · P8 · 7 (B8) `writeWorkflow` kept with a guard · **accept** (not on §11's list; four suites call it; the guard pins no production caller) · no change.
- **C86** · P8 · 8 (B9) `paintLegacyStrip` beside `paintGraphFor`; assumes `fmtDur`/`fmtUsd`/`COMPOSER_COLORS` in app.js · **accept** (P5 keeps `COMPOSER_COLORS` re-homed — P5 item 11) · no change.
- **C87** · P8 · 9 (B10) `phases.mjs` survivors vs P3's exports · **fix (A26)**: += `runOpts`, `READ_WRITE_TOOLS`, `IMPLEMENTER_TOOLS`; `renderPromptArtifact` importer named · P8-E1, P8-E3.
- **C88** · P8 · 10 (B11) bookends via `_recordStep(executionId, 0, …)`; `BOOKEND_EXECUTION_IDS` export · **fix (A27)**: the constant is P1's (`constants.mjs`), consumed by P6 from the start; P8 verifies; the `_bookend` rewrite stands · P1-E1…E5, P6-E1, P8-E2, P8-E3.
- **C89** · P8 · 11 (B12) CSS re-home of keyframes/.nstat/.fan · **accept** (P6's block reuses those names — consistent, A32) · no change.
- **C90** · P8 · 12 (B13) `registryToSteps`/`DEFAULT_SPEC`/`LEGACY_LABELS` kept, wiring fields deleted · **accept** — spec §11 says "v1 arms", and `config.mjs#agentSteps` feeds the legacy per-role editor `resolveGraph` still honours for `wf_default` · no change.
- **C91** · P8 · 13 sidecar deletions list (no `uiPhase` key exists) · **accept** · no change.
- **C92** · P8 · 14 all five `phases-*` suites kept · **accept** with P8's own rule (retire a file only if it imports a deleted builder); P3's prompt-parity suite pins the v2 assembly, `phases-*` pin the surviving helpers — complementary, not duplicate · no change.
- **C93** · P8 · 15 `GRAPH_DEFAULT_WORKFLOW` timestamps · **accept (A29)**: P8a adds them (already conditional); P4's alias row stamps them meanwhile · P4-E19.

### P5 (19 tasks) — items 1–18
- **C94** · P5 · 1 `createGraphView` options + `MODE_ZOOM` · **accept** · no change.
- **C95** · P5 · 2 the view OWNS the stage (prepends) · **accept (A15)**; P6 clears before creating · no change.
- **C96** · P5 · 3 `render({decor})` + `view.applyDecor` · **fix (A11)**: removed from the view; `run-decor.mjs` `applyDecor(view, decor)` is the ONE pass · P5-E2, P5-E8, P5-E9.
- **C97** · P5 · 4 `createComposer(hostEls, {…})` 18 hosts / 8 api methods · **accept** · no change.
- **C98** · P5 · 5 element ids/classes; `.is-error/.is-skipped` overlap · **accept** (C66) · no change.
- **C99** · P5 · 6 storage key `worca.composer.inspector` · **accept** · no change.
- **C100** · P5 · 7 `wheelPan` on `createGraphView` + `view.createNav({wheelPan})` · **accept + extend (A12)**: `createNav({wheelPan, onEngaged})` · P5-E7.
- **C101** · P5 · 8 `graphBounds`/`fitBounds` not used by the view · **fix (A14)**: the view delegates to them · P5-E1, P5-E6, P5-E9.
- **C102** · P5 · 9 assumed P2 signatures; local hit-testing instead of `hitPort/hitNode/hitWire` · **accept the signatures**; hit-testing: **accept** the composer's local port/node hit-test (it reads the view's cached anchors/sizes — zero layout reads, the spec's real constraint) PROVIDED the wire hit uses `hitWire` from geometry.mjs for the sampled cubic (spec §7.2 "48-sample cubic at 6px"); the refiner checks the composer's `hitWireAt` calls `hitWire` rather than re-sampling — residual D-item, not a manifest edit.
- **C103** · P5 · 10 style.css ranges · **accept (A32)** · no change.
- **C104** · P5 · 11 `app.js` composer block partially kept (`COMPOSER_COLORS` etc. shared with the v1 run graph) · **accept** · no change.
- **C105** · P5 · 12 `agentMetaCache`/`ensureAgentMeta()` · **accept** · no change.
- **C106** · P5 · 13 extra retired/edited tests · **accept** · no change.
- **C107** · P5 · 14 Archived footer shipped now · **accept** (renders only with ≥1 archived row) · no change.
- **C108** · P5 · 15 `PATCH /api/config` body `{projectDir, workflowId, wires:{[id]:{maxCycles}}}` · **accept** (matches P2 B6) · no change.
- **C109** · P5 · 16 `composerExit()` = `suspend()`; `resume()/suspend()` · **accept** · no change.
- **C110** · P5 · 17 `window.__gv()` CDP seam · **accept** · no change.
- **C111** · P5 · 18 test counts · **accept**; Task 2 count +2 (A11 tests) — the refinement re-measures · no change.

### P3 (13 tasks) — items 1–20
- **C112** · P3 · 1 `onAsk`/`onGate`/`onEvent('gate')` split · **accept (A3)**; P4 aligned · P4-E9, P4-E11, P4-E12.
- **C113** · P3 · 2 `reattach(snapshot)` before `run()` · **accept** (P4 already does) · no change.
- **C114** · P3 · 3 `execute` may return `{paused:true}` · **accept (A5)**; P4 returns it · P4-E13, P4-E21.
- **C115** · P3 · 4 snapshot `execs[]` carries `bindings`+`trigger` · **accept**; += `taskIndex/taskTotal` (A9) · P3-E6.
- **C116** · P3 · 5 `getState()` shape · **accept (A7)**; P4 aligned · P4-E11.
- **C117** · P3 · 6 no `skipped` exec rows · **accept** (adj-d; P6 `statusOf` derives it; base spec §3 "report skipped" is satisfied at the monitor) · no change.
- **C118** · P3 · 7 `exec` fields; no `taskIndex/taskTotal` · **fix (A9)**: added on `kind:'task'` · P3-E3, P3-E5.
- **C119** · P3 · 8 `token` event fields · **accept** (matches spec §5.7) · no change.
- **C120** · P3 · 9 `taskArtifact` via `ctx.taskArtifact` `{path}|{text}` · **accept (A6)**; P4 stamps `{text}` from `renderPromptArtifact` · P4-E2, P4-E8.
- **C121** · P3 · 10 `runExecution`/`publishable` exports · **accept** · no change.
- **C122** · P3 · 11 `phases.mjs` export-only additions (`runOpts`, tool lists) · **accept**; P8 survivors extended (A26) · P8-E1.
- **C123** · P3 · 12 `ports.verdict.filename` via `portsFn(node)` · **accept (A10)** — P2's `portsFnFor` spreads the meta, `manifestPortsFn` synthesizes it · no change.
- **C124** · P3 · 13 `firedOutputs(outputs, verdict)` vs `(ports, verdict)` · **settled (A10)**: dual-accepting; hedge removed · P3-E2.
- **C125** · P3 · 14 `isLoopPort` = classification OR meta `loop:true` · **accept** (Amendment f readiness excuses meta-loop inputs; `classifyLoops.loopInputs` is the classification set — both feed readiness, the meta flag is the load-bearing one for the OR-valve seeds) · no change.
- **C126** · P3 · 15 `registryPortsFn(loadAgentRegistry(...))` vs `test/helpers/graph-ports.mjs` · **accept (A31)** — the real registry merge is the better parity oracle; both read the real sidecars · no change.
- **C127** · P3 · 16 `runCtx` fields · **accept** (P4 matches; `duplicateKey` now comes from the resolver, A1) · no change.
- **C128** · P3 · 17 ctx field table · **accept**; P4 `_execCtx` adds `parentExecutionId/taskIndex/taskTotal` (A9) · P4-E14.
- **C129** · P3 · 18 questions filename deferred to P4; ask ids · **accept** · no change.
- **C130** · P3 · 19 extra test files · **accept (A31)** · no change.
- **C131** · P3 · 20 sidecar-repair allowance for parity literals · **accept** (P2 is refined before P3 executes; a residual byte gap is P2's defect and the pin is the contract) · no change.
- **C132** · P3 · `FLOW_KINDS.has` · **fix (A30)** · P3-E1.

### P1 (12 tasks) — items 1–16
- **C133** · P1 · 1 `_resolveTopology` += `workflow:{id,name}` · **accept (A17)**; P4 returns it · P4-E5.
- **C134** · P1 · 2 `_engineRehydrate` += `audit?` · **accept (A17/A37)**; P4 supplies the v2 sentence · P4-E18.
- **C135** · P1 · 3 `_engineRun({resume, rehydrated})` · **accept (A17)**; P4 ignores `rehydrated` · P4-E8.
- **C136** · P1 · 4 `_phase` on the harness · **accept** (oracle-forced); P4's shim emits `phase` through its own emitter, not `_phase`; P8 deletes `_phase` with the two ported suites · no change.
- **C137** · P1 · 5 `_preflightAgentKeys(iterable)` on the harness · **accept** · no change.
- **C138** · P1 · 6 sixth hook `_initRunners(opts)` · **accept**; P4 implements it (A17) · P4-E4.
- **C139** · P1 · 7 `collectRequiredSkills(registry, planOrKeys)` · **accept** · no change.
- **C140** · P1 · 8 `createOrchestratorFor` v1-only at P1; `Number(raw) === 2` · **accept** · no change.
- **C141** · P1 · 9 `LIMITS` keys · **accept** (P2 reads `maxNodes/maxWires`) · no change.
- **C142** · P1 · 10 `gatePorts` types; all gate inputs `required:true` · **accept** (V12 requires every `inK` wired anyway; V5 agrees) · no change.
- **C143** · P1 · 11 arrays not Sets · **accept (A30)**; P2/P3 `.has` fixed · P2-E1, P3-E1.
- **C144** · P1 · 12 `WIRE_ID_RE` `w_?` · **accept** (P2 mints `w_`, seeds `w1…`) · no change.
- **C145** · P1 · 13 protocol.mjs re-exports five names · **accept** · no change.
- **C146** · P1 · 14 seed files byte-identical, stale V17 comments · **accept (A29)**; timestamps via P4 alias / P8 constant · P4-E19.
- **C147** · P1 · 15 `FB_WIRE_MAP` pairing for `wf_clarify-implement` unpinned; "V24 resolves dynamically" · **fix (A28)**: static maps only; pairing pinned as a convention · P1-E6, P1-E7, P1-E8.
- **C148** · P1 · 16 anchor drift list · **accept** (dev wins) · no change.
- **C149** · P1 · NOT DONE: telemetry hoist · **accept (A18)**: P4 owns it · P1-E8 (P1-r).

### P2 (P2a 15 + P2b 11 tasks) — items 1–32
- **C150** · P2 · 1 V4 texts single-quoted vs `resolveGraph` double-quoted · **fix (A20)**: double quotes, byte-equal · P2-E2…E4, E7, E14, E15.
- **C151** · P2 · 2 `RULES` shape, `validateGraph` result · **accept** · no change.
- **C152** · P2 · 3 LIMITS enforced by V1 with node/wire-count messages · **accept** · no change.
- **C153** · P2 · 4 `Issue.wireIds?` on V12 · **accept** · no change.
- **C154** · P2 · 5 `formatIssue` shape · **accept** · no change.
- **C155** · P2 · 6 `portsOf` returns `{known, ported, inputs, outputs, meta}`; `portsFnFor` spreads meta; `firedOutputs` dual · **accept (A10)** · no change.
- **C156** · P2 · 7 `resolveOrOutType(tpl, portsFn, orId, seen)` · **accept** · no change.
- **C157** · P2 · 8 `classifyLoops` return · **accept** · no change.
- **C158** · P2 · 9 `tarjanSccs(ids, edges)` with `{from,to}` edges · **accept** · no change.
- **C159** · P2 · 10 `newNode(kind, key, x, y, taken?)`/`newWire(from, to, config?, taken?)` · **accept** (P5's calls are compatible) · no change.
- **C160** · P2 · 11 `canWire` codes · **accept (A24)** · no change.
- **C161** · P2 · 12 geometry shapes; closed form caveat for 0-input agents; `fitBounds`/`graphBounds` · **accept**; both are now consumed by P5 and P6 (A14) · P5-E6, P6-E3.
- **C162** · P2 · 13 `thumbnailSvg` world-space `<g>` · **accept** · no change.
- **C163** · P2 · 14 `autoLayout` y-origin snap 55 · **accept** · no change.
- **C164** · P2 · 15 `normalizeAgentMeta`/`validateMetaV2` injected vocabulary · **accept** (C36) · no change.
- **C165** · P2 · 16 `derivePortSummary` wording · **accept** · no change.
- **C166** · P2 · 17 `{diffInstruction}` token in `manualTestsChecklist.promptHints`; detached-workspace arm · **accept**; P3 Task 9's repair allowance covers a residual byte gap (C131) · no change.
- **C167** · P2 · 18 `decomposer.tasks.artifactKind` · **accept** · no change.
- **C168** · P2 · 19 implementer input order `fix, task, plan` + plan directive · **accept** (spec §6 table says "declared in THIS order") · no change.
- **C169** · P2 · 20 ports↔channels mapping deltas · **accept** · no change.
- **C170** · P2 · 21 invalid v2 sidecar ⇒ skip whole · **accept** · no change.
- **C171** · P2 · 22 manifest cell shapes; icon sanitizer · **accept** · no change.
- **C172** · P2 · 23 shim ranks = `rankNodes` + `launchOrder` · **accept (A19)**; B8 prose aligned · P2-E19, P2-E21.
- **C173** · P2 · 24 `manifestPortsFn` synthesizes `verdict:{filename:''}` · **accept (A10)** · no change.
- **C174** · P2 · 25 `assertRunnableWorkflow` texts · **accept (A21)** · no change.
- **C175** · P2 · 26 v2-run refusal 409; ARCHIVED 409 at `POST /api/run` · **fix (A16)**: 400 · P2-E16…E18, E20, E21.
- **C176** · P2 · 27 `resolveGraph` return `{template, nodes, wires, agentsByKey, agentKeys}` template unmutated · **fix (A1)**: += `ports`, `loops`; resolved-key template (deep copy); entries += `authoredKey`, `config`, `duplicateKey` · P2-E5…E13, E21.
- **C177** · P2 · 28 `resolveRunConfig` returns `{nodes, wires, feedbacks}` · **accept** · no change.
- **C178** · P2 · 29 422 body `{error:'invalid graph', errors, warnings}` · **accept** · no change.
- **C179** · P2 · 30 `setWorkflowNodeDefaults` v2 arm keeps non-tunables · **accept** · no change.
- **C180** · P2 · 31 `deleteAgent` scans with `includeArchived:true` · **accept** · no change.
- **C181** · P2 · 32 `GET /api/agents` needs no edit · **accept** · no change.
- **C182** · P2 · `KINDS.has` in V3 · **fix (A30)** · P2-E1.

## D. Residual

Items no mechanical edit can settle (a writer/refiner pass is needed), plus product questions for the user.

- **D1 · P6 Task 3 reference block** (plan `2026-08-26-node-graph-v2-P6-run-monitor-v2-cli.md`, Task 3 Step 3): after P6-E2 the ~95-line view-code block stays in the document as a clearly labelled REFERENCE copy of P5's implementation. The P6 refiner should delete it (or collapse it to the Interfaces block) — a mechanical `old_string` for a 95-line fenced block is too fragile to put in this manifest.
- **D2 · P5 composer hit-testing** (P5 Task 10; C102): the composer hit-tests ports/nodes from the view's cached anchors/sizes (fine — zero layout reads) but the plan says wires are hit "by sampling cached `d`". Spec §7.2 names `hitWire` (geometry.mjs, 48-sample cubic at 6px) as the one wire hit-test. The P5 refiner must make `hitWireAt` call `hitWire(a, b, pt, {loop, tol})` from `src/shared/graph/geometry.mjs` rather than re-sampling, or justify the deviation in Q&A. Not expressible as a string edit without the Task 10 body in hand.
- **D3 · P5 view internals used by the new fast paths** (P5 Task 2, P5-E5): the band/chrome/badge code assumes Task 1's `h(tag, cls, text)` helper sets `className` and `textContent` and that loop-wire badge hosts are created by `render` for every `ctx.loopWireIds` wire (P5 Task 1 test line ~216 implies so). The P5 dry-run must confirm both; if `h` differs, the refiner adapts the three functions (structure is the contract, not the helper).
- **D4 · P4 `_engineRun` resume flag** (P4 Task 3 Step 2c): after P4-E8 the base passes `{ resume: rp, rehydrated }` (P1 A17); P4's `if (resume && this._resumeSnapshot)` still works (truthy object) but the P4 refiner should read `resume` as the resume POINT, not a boolean, throughout Task 6 (e.g. the `_engineRehydrate` ↔ `_engineRun` hand-off comments).
- **D5 · P4 `resolvedFromManifest` on resume** (P4 Task 6): the manifest's `agentsByKey` slice is rebuilt from the LIVE registry (`reg[mn.key]`) for renderer fields; with A1 the returned `agentsByKey` therefore carries live metas — acceptable (spec §5.6: ports come from the snapshot, meta from the registry), but the refiner should assert in `test/orchestrator-graph-resume.test.mjs` that a changed sidecar cannot change port IDENTITY on resume (the `merge` in `resolvedFromManifest` already guarantees it).
- **D6 · P7 `test/plugin-manifest.test.mjs` assertions** (P7-E1 third edit): the existing `assert.deepEqual(m, {...})`-style checks on `apiMismatch(...)`'s result (if any) must be re-shaped to tolerate the new `message` field — the manifest gives the rule, the exact assertion text depends on the test body the applier sees.
- **D7 · Counts**: every "Expected: # pass N" that this manifest shifts (P1 Task 5 +1 (done), P5 Task 2 +2, P2 Task B4 +0, P6 Task 3 unchanged) is re-measured by the refinement dry-runs; no other count was edited on purpose.
- **True product questions for the user: none.** Every conflict above was an engineering call inside the approved spec (D1–D8 untouched). One item to SURFACE, not ask: A16 makes `POST /api/run` answer 400 for an archived template (the UI shows the message verbatim either way).
