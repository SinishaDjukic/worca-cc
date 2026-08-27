# Node-Graph Pipelines v2 — Design Spec

Date: 2026-08-10
Status: Approved (design presented and approved in-session)
Amended 2026-08-10-b: Merge flow node (OR-join), `loop: true` input flag, blocking-source loop-wire rule — gaps found while re-expressing the saved "Full" template (two review loops into one `implementer.fix` input).
Amended 2026-08-10-c: explicit **Task node** replaces implicit prompt-seeding of unwired inputs (user request); `seed` meta flag removed; V9 simplified, V20 added.
Amended 2026-08-10-e (user decision): **inputs accept MULTIPLE wires** — an input is a native OR fan-in binding its FRESHEST inbound token; per-wire loop budgets. The **Merge node is REMOVED** (it was a pure forward-the-freshest valve; direct multi-wire binding is trace-equivalent, so the Amendment-b parity result stands). V7 input-cardinality dropped; V12 loses its merge clauses; V8's merge-resolution clause superseded (await-chain resolution only); V18 gains a wire-level clause; V19's merge exemption replaced by the loop-input condition alone. Await (+ per-node awaitAll) remains the AND-join for genuine wait-for-both. `loop: true` inputs and the blocking-source loop-wire rule from Amendment b are unchanged. Inline edits marked ⟨e⟩.
Amended 2026-08-10-d (empirical: dual-engine parity simulation + executed Phase-1 dry-run + genericity adjudication; user decisions: fully generic engine, V17 re-seeds the 7 saved templates): **A1** loop-budget arithmetic = v1 parity (allowance `maxCycles − 1` deliveries; gate on the would-be `maxCycles`-th; maxCycles caps total source firings); **A2** Task-node `config.planStoreSeed`; **A3** fresh-trigger mode selection; **A4** forced-token payload rule; V3 kind set includes `task`; V4 via meta `placeable:false` (no key literal); V8 resolves merge outs like await outs; V18 exempts task-node-sourced AND void-typed inputs; §5 gains capability fields (`as`, `directive`, `artifactKind`, `wantsRequest`, `workspaceFanOut`, `workspaceStrategy`, `workspaceVariantOf`, `placeable`, validated `mockRole`); clarifier executor selected by `runnerType`, never key; plugin templates use the full kind set; merge same-drain collapse documented; §6 legend/pill/loop-chip/stacked-row refresh. Inline edits below are marked ⟨d⟩.
Amended 2026-08-10-f (user decision; revised in place same day — single-wire course correction, before any implementation consumed it): **universal `await` gate + AND/OR/End flow cards; SINGLE-WIRE inputs restored; the Await node and the `start` ports are REMOVED.** Every `kind:'agent'` node gets one engine-synthesized, type-agnostic input port `await` — synthesized by portsFn, never declared in meta (`await` is a reserved port id, §5), appended LAST in the resolved input list and rendered as the card's bottom gate zone; accepts a wire from ANY output type; payload discarded (pure sequencing — no file, no renderer, no directive, no mode/A3 effect, never in the Ports block, exempt from V18 counting); optional, but when wired the FIRST execution additionally requires its delivered token and a fresh token re-fires the node per the standard freshness rule — semantics identical to the old checklist `start` port; it counts among "wired non-loop inputs" for the awaitAll re-run rule (and for V16). **Amendment e's multi-wire clause is REVERSED**: EVERY input in the graph — agent meta inputs, the synthesized `await` port, AND/OR/Combine `inK`, End's `result` — accepts exactly ONE inbound wire; **V7 is RESTORED** as the universal cardinality error (V22 retired as subsumed); fan-OUT (one output → many inputs) is untouched; all freshest-binds multi-wire machinery dies (the §3 binding rule, the readiness any-wire clause, V18's wire-level clause, the composer add-on-drop rule — a drop on a wired input is now rejected "already connected"). New flow cards **AND** (`and`) and **OR** (`or`) REPLACE the Await node (removed exactly like Merge in ⟨e⟩), both `config.arity ≥ 2` with inputs `in1..inN`: **AND** is the pure synchronizer — inputs `any`, ONE STATIC output `out` type `void` `when:'always'`, fires when ALL inputs are fresh, every execution (the old Await readiness rule), payloads discarded; **OR** is the payload-forwarding VALVE (the Amendment-b Merge, generalized) — fires on ANY fresh input, binds the FRESHEST and re-emits ITS payload with a new seq (several fresh in one drain ⇒ ONE emission), its in/out types RESOLVED FROM WIRING, not stored: all inbound sources must share one type, `out` = that type (`resolveOrOutType`, seen-set for chained ORs — V8's ⟨f⟩ clause; resolution machinery deliberately re-admitted SCOPED TO OR — the Await-node machinery `resolveAwaitOutType` + its V8 clause stays dead). Both are pure engine executions (instant, $0, no spawn, exec/token events). Loop budgets sit on the blocking wires INTO an OR — existing loop classification already yields this (`or.out → fix` is always-source in-SCC ⇒ plain, budget-less); gates hold the token BEFORE the OR, per in-wire. Combine is unchanged (md AND-join). `start` void ports are DELETED from implementer and manualTestsChecklist meta; seeds rewire `reviewer.pass → checklist.await` (reviewer.done STAYS — `as:'worktree'`, real payload semantics). New flow node **End** (`end`): exactly ONE per template (new **V21**, mirror of V20), one SINGLE-WIRE input `result` type `any`, zero outputs; the token arriving on its one wire completes the run as today's natural completion (launching stops, in-flight executions run to completion and publish — recorded, nothing downstream fires — run resolves `'done'`; End's payload is the pipeline result, §7); multi-terminal graphs fan alternatives through an OR card; quiescence WITHOUT an End token ⇒ `'done'` + explicit warning "finished at quiescence — End not reached". Palette Flow group = Task · End · AND · OR · Combine (Task and End pills disabled once placed); new canvases preload Task + End; all 8 builtin graphs (7 seeds + wf_default) gain an End wired from their v1-terminal clean output (`webui.pass` else `reviewer.pass`), and the three double-loop seeds (wf_full, wf_provided-plan, wf_full-no-decompose) route both review loops through an OR: `reviewer.review → or.in1`, `webui.review → or.in2` (each wire keeping its own maxCycles), `or.out → implementer.fix` — so every agent input carries at most one connection. awaitAll per-node toggle unchanged. Parity: start ≡ await (identical readiness algebra); End is trace-neutral (pure sink; seed terminals fire at natural quiescence); the OR valve is byte-for-byte the Amendment-b Merge topology, whose trace-verified adjudication is the operative lineage — see Parity carryover. Inline edits marked ⟨f⟩.
Scope: Complete rework of the orchestrator execution model, the pipeline composer, agent metadata, and agent definitions — from linear steps+feedbacks to a typed-port node graph.

> NEVER git-commit this file (untracked working artifact by project convention).

---

## 0. Summary and goals

Replace the linear pipeline model (`steps[][]` + back-edge `feedbacks[]`, implicit all-to-all channel wiring) with an explicit **node graph**:

- Blocks (nodes) with named **typed ports** (inputs left, outputs right).
- **Wires** connect one output to one input. Many-to-many ⟨e⟩: one output may feed many inputs, and one input may accept many wires — a multi-wire input binds its FRESHEST inbound token (OR fan-in; two review loops feed `implementer.fix` directly).
- **Loops are literal cycles** driven by **conditional outputs** (a reviewer's `review` output fires only on a blocking verdict; its `pass` output fires when clean).
- New builtin **flow nodes**: `Await` (AND-join; forwards a payload) and `Combine` (AND-join; concatenates md inputs). Agent blocks get a per-block **Await-all** toggle. (`Merge` existed between Amendments b and e; removed — multi-wire inputs are the native OR fan-in ⟨e⟩.)
- **A single Task node is the graph's source** (Amendment c): it emits the rendered task document (prompt + attached-file paths) once at run start; all entry consumers are wired from it explicitly. No implicit seeding.
- **Clean break**: template schema v2; saved v1 templates are dropped (user decision, no converter); one authoring model, one engine.
- Full parity: all 11 builtin agents, decomposer dynamic fan-out, workspace runs + reviewer substitution, plugin agents/workflows (plugin API v2).
- Run monitor: loop re-runs and fan-out implementers render as **collapsible executions under their single block** (user requirement).

User decisions locked (2026-08-10): clean break + drop saved templates; cycles + conditional outputs; vanilla free-form canvas editor; full parity scope; executions collapsible under one block.

---

## 1. Template schema v2

Stored in the existing `workflows` table; topology moves to a new `graph` TEXT column; `version = 2`.

```ts
Template = {
  id: string,                    // /^[A-Za-z0-9_-]+$/ (SAFE_WORKFLOW_ID kept)
  name: string,
  version: 2,
  domain: string,                // same normalization as v1
  nodes: Node[],
  wires: Wire[],
  canvas?: { x: number, y: number, zoom: number },   // view state, engine-ignored
  createdAt: string, updatedAt: string,
}

Node = {
  id: string,                    // stable random 'n_' + 8 base36; builtins may be readable (n_plan)
  kind: 'agent' | 'task' | 'await' | 'combine',   // ⟨e⟩ 'merge' removed
  key?: string,                  // agentKey, present iff kind === 'agent'
  x: number, y: number,          // canvas px, ints, persisted
  config: {
    model?: string, effort?: string,
    fanOut?: boolean,            // research sub-agent fan-out (prompt flag), NOT task fan-out
    askQuestions?: boolean,
    awaitAll?: boolean,          // per-block Await chip; see §3 firing rule
    arity?: number,              // await/combine only, >= 2 (ports in1..inN) ⟨e⟩
  },
}

Wire = {
  id: string,                    // 'w_' + 8 base36
  from: { node: string, port: string },   // an output port
  to:   { node: string, port: string },   // an input port
  config?: { maxCycles?: number },        // legal ONLY on loop wires (see §2); default 3
}
```

Notes:
- Port definitions are NOT stored in the template; they come from agent meta v2 (§5) or the engine (flow nodes). The template stores wiring against port ids.
- Per-project run-config overlay (existing `config_workflow_nodes`) still overrides `node.config` per (workflowId, nodeId); a new `max_cycles` overlay keyed by wire id replaces `config_workflow_feedbacks` (which becomes vestigial).
- `wf_default` is re-expressed as a builtin v2 graph constant (same five agents; refine self-loop and review→implement loop become literal cycles). It remains never-persisted and undeletable.

### wf_default as a v2 graph (canonical example)

```json
{ "id": "wf_default", "name": "Default", "version": 2, "domain": "coding",
  "nodes": [
    { "id": "n_task",    "kind": "task",                        "x": 40,   "y": 200, "config": {} },
    { "id": "n_clarify", "kind": "agent", "key": "clarify",     "x": 320,  "y": 200, "config": {} },
    { "id": "n_plan",    "kind": "agent", "key": "planner",     "x": 600,  "y": 200, "config": {} },
    { "id": "n_refine",  "kind": "agent", "key": "refiner",     "x": 880,  "y": 200, "config": {} },
    { "id": "n_impl",    "kind": "agent", "key": "implementer", "x": 1160, "y": 200, "config": {} },
    { "id": "n_review",  "kind": "agent", "key": "reviewer",    "x": 1440, "y": 200, "config": {} }
  ],
  "wires": [
    { "id": "w1", "from": {"node":"n_task","port":"task"},       "to": {"node":"n_clarify","port":"task"} },
    { "id": "w2", "from": {"node":"n_task","port":"task"},       "to": {"node":"n_plan","port":"task"} },
    { "id": "w3", "from": {"node":"n_clarify","port":"answers"}, "to": {"node":"n_plan","port":"answers"} },
    { "id": "w4", "from": {"node":"n_plan","port":"plan"},       "to": {"node":"n_refine","port":"plan"} },
    { "id": "w5", "from": {"node":"n_refine","port":"revise"},   "to": {"node":"n_refine","port":"revise"},
      "config": { "maxCycles": 3 } },
    { "id": "w6", "from": {"node":"n_refine","port":"plan"},     "to": {"node":"n_impl","port":"plan"} },
    { "id": "w7", "from": {"node":"n_refine","port":"plan"},     "to": {"node":"n_review","port":"plan"} },
    { "id": "w8", "from": {"node":"n_impl","port":"done"},       "to": {"node":"n_review","port":"done"} },
    { "id": "w9", "from": {"node":"n_review","port":"review"},   "to": {"node":"n_impl","port":"fix"},
      "config": { "maxCycles": 3 } }
  ] }
```

Entry: the **Task node** (Amendment c) — exactly one per template, zero inputs, fires once at run start. Its `task` output is wired explicitly to every consumer (`n_clarify.task`, `n_plan.task`); n_plan additionally waits on its wired `answers` input per the firing rule. No implicit seeding exists.

---

## 2. Type system, wiring legality, loops, validation

### Types
- `md` — markdown/string documents (UI caption `md`; long-form "markdown | string" in tooltips).
- `json` — structured contracts (clarify answers, decomposition).
- `void` — pure sequencing triggers; no file.
- `any` — engine-internal wildcard, allowed only on Await inputs; never declarable in agent meta.

No coercions. Wire legality: `to`-port type must equal `from`-port type (or `any` on the input side). `code`/worktree is NOT a port — implementation is an implicit side effect; sequencing after it uses `void` ports.

### Conditional outputs
`when: 'always' | 'blocking' | 'clean'` per output port (default `always`). Evaluated after each execution from the node's **verdict JSON** (existing `protocol.mjs` contract: severities critical/major/minor/suggestion; blocking = critical|major; `hasBlocking`). Exactly one side fires: `blocking` outputs iff hasBlocking, `clean` outputs otherwise; `always` outputs always fire. `when ≠ 'always'` is legal only on nodes whose meta declares `verdict: { filename }`.

### Loop classification (Amended 2026-08-10-b)
Two orthogonal concepts (split found while re-expressing the saved "Full" template, which has TWO review loops targeting `implementer.fix` — since ⟨e⟩, wired into it directly):

- **Loop input** (firing semantics) = an input declared `loop: true` in agent meta (`implementer.fix`, `refiner.revise`, `planner.revise`). Excused from the first-execution barrier; a fresh token on ANY of its wires re-fires the node. Static and wiring-independent.
- **Loop wire** (budget + styling) = a wire whose endpoints are in the same nontrivial SCC (or a self-wire, Tarjan) AND whose source output is `when: 'blocking'`. Only these render amber, carry `config.maxCycles` (default 3), and count deliveries toward the gate. `clean`-source wires inside a cycle (e.g. `reviewer.pass → checklist.start` when checklist/webui sit inside the big loop) stay plain forward wires.

### Validation rules v2 (replaces workflow-validator.mjs; E = error blocks save/run, W = warning)
1. E Template shape: object, `version === 2`, non-empty `nodes`, `wires` array.
2. E Node ids match `/^[A-Za-z0-9_-]{1,64}$/`, unique; `x`,`y` finite numbers.
3. E `kind ∈ {agent, task, await, combine}` ⟨d: `task` was missing — Amendment-c staleness⟩ ⟨e: `merge` removed⟩; `key` present iff kind = agent.
4. E Agent key resolves in the merged registry; a key whose meta declares `placeable: false` is rejected as a node ⟨d: meta-driven — workspaceScanner sets the flag; no key literal in the rule⟩.
5. E Wire endpoints exist; `from.port` is a declared output; `to.port` is a declared input.
6. E Wire ids unique; duplicate `(from, to)` pairs rejected.
7. ⟨e⟩ DROPPED (was: one inbound wire per input). Multi-wire inputs are legal; duplicate `(from, to)` pairs stay rejected (V6) and every inbound wire must type-match the input (V8, checked per wire). Number kept reserved so V1–V20 references stay stable.
8. E Type compatibility per the table above, checked PER WIRE on multi-wire inputs ⟨e⟩. ⟨d⟩ Await output types resolve before comparison (first resolvable inbound source type of in1, seen-set for chained awaits). Unresolvable (unwired in1 — already V12) ⇒ V8 skips. (The merge-resolution clause of ⟨d⟩ is superseded — no Merge node ⟨e⟩.)
9. E Every required non-loop input must be wired (no seeding exemption — Amendment c).
10. E Every nontrivial SCC contains ≥ 1 loop wire ("cycles need a blocking-source edge"); error names the offending wires.
11. E Deadlock freedom: every nontrivial SCC has ≥ 1 node whose required inputs are all satisfiable from outside the SCC (external wire, optional, or loop input).
12. E Await/Combine ⟨e — merge clauses dropped⟩: integer `arity ≥ 2`; combine inputs all wired and all `md`; await `in1` wired (output type resolution).
13. E `when ∈ {always, blocking, clean}`; non-always requires node verdict; `wire.config.maxCycles` only on loop wires, int ≥ 1.
14. E `expands` inputs (§5) must be `json`.
15. W Unreachable node (never eligible from any entry).
16. W `awaitAll` on a node with < 2 wired non-loop inputs (no-op).
17. W Unknown config keys (preserved, warned once).
18. W Two `always`-sourced **non-void** inputs wired to a node without `awaitAll` (double-fire risk on re-runs; UI suggests enabling Await-all or inserting Await node). ⟨e⟩ The same warning fires when a SINGLE non-loop input carries ≥2 always-source wires (each arrival re-fires the node; loop inputs exempt — re-firing is their purpose). ⟨d⟩ Two exemptions from the pair count: (a) inputs wired FROM the task node (it fires exactly once by construction) — without this wf_default itself warns permanently (n_plan: task + answers); (b) VOID-typed inputs — pure sequencing, no payload to double-bind; without this the universal `X.plan + implementer.done` idiom warns (wf_quick-fix / wf_clarify-quick-fix reviewers, whose plan comes from the planner's unconditional output; `awaitAll` is no fix there — it would block fix-cycle re-fires).
19. W A `when:'blocking'` output wired into an input without `loop: true` (likely a mis-wired loop) ⟨e — the merge-input exemption is gone with the node⟩.
20. E Exactly ONE `task` node per template; it has zero inputs and its `task` output must have ≥ 1 wire.

`connectsTo` allowlists are removed entirely (types + ports now encode compatibility). `DEFAULT_SPEC` in agent-registry dies with them.

---

## 3. Execution engine v2

### Tokens and state
- Each output port holds one latched token: `{ seq, type, path?, value?, meta?, firedAt, sourceExecutionId, forced? }`. Global monotonic `seq` assigned under the scheduler lock at publish.
- Consumers track `consumed[node][inputPort] = seq` at bind time. "Fresh" = token seq > consumed seq. ⟨e⟩ A multi-wire input considers every inbound wire's source token and BINDS THE FRESHEST (max seq); `consumed` stays per input, so binding the freshest spends the older ones too. Two wires fresh in one drain ⇒ one execution binds the freshest, the older token is spent (formerly the "merge same-drain collapse" — now the natural binding rule).
- Loop wires carry `{ deliveries, allowance }` counters (allowance = maxCycles − 1 — ⟨d/A1⟩, see Loops below).

### Firing rule (readiness)
- **First execution** of a node: every **wired non-loop** input has a token (validation guarantees required non-loop inputs are wired; the Task node is the only zero-input node and auto-fires at t0). Loop inputs (meta `loop: true`) are excused (implement fires before any review exists), regardless of what — or how many wires — feed them ⟨e⟩.
- **Re-execution**, `awaitAll` off (default): ≥ 1 fresh token on any input (loop or not); other inputs bind their latched values. A fresh `fix` token re-fires the implementer in fix mode with the plan latched.
- **Re-execution**, `awaitAll` on: every wired non-loop input must be fresh — OR a fresh loop token alone (the loop path always re-fires).
- **Await/Combine**: all inputs fresh, every execution. ⟨e⟩ (Merge removed — OR fan-in is the multi-wire input itself.)
- Ready nodes launch in deterministic (condensation-topo, nodeId) order. Agent executions run under a global semaphore (default 4, `WORCA_MAX_PARALLEL`); flow nodes bypass it. `rerunPending` coalescing: readiness reached while running sets a one-shot flag, never queues.

### Publish / conditional routing
On execution completion: if the node has `sideEffect:'code'`, stage the worktree BEFORE publishing. Read verdict JSON if declared; fire `always` outputs plus exactly the matching conditional side, in declared port order; each fired port gets a new token; downstream freshness cascades (this replaces the `publish-clears-review` hack — staleness is solved by seq-superseding).

### Loops, maxCycles, gates
⟨d/A1 — parity-mandatory⟩ The wire's delivery **allowance = maxCycles − 1**; the gate fires when a blocking verdict would trigger delivery number `maxCycles`. `maxCycles` therefore caps TOTAL source firings around the loop, exactly like v1's `st.cycle < fb.maxCycles` (orchestrator.mjs:1856). (As previously written — allowance = maxCycles — every loop ran one extra iteration vs today: measured 4-vs-3 refiner executions, 7-vs-6 under a maxCycles-6 overlay.)
Delivering onto a loop wire past its allowance HOLDS the token and asks the human gate (existing ask flow):
- "another" → allowance += 1, deliver, loop continues.
- "continue" → held token discarded; the source node's `clean` outputs are force-fired (`forced: true`, carrying the open issues in meta) so the graph proceeds forward. No wired clean output ⇒ that path is terminal. ⟨d/A4⟩ The forced token's payload reuses the HELD blocking token's path/value when the port types match (refiner: plan/revise share one file, so downstream reads the file the refiner last wrote — v1 parity), else the clean port's latched payload, else null.
Auto/non-interactive mode answers "continue" (today's behavior).

### Completion / failure
Run is done at **quiescence**: nothing running, nothing ready, no held gates, no pending ask. Nodes that never fired report `skipped` (untaken conditional branches — legal). Fail-fast: first execution error after retries aborts all in-flight and errors the run. Pause/abort/cost checks run at every launch decision.

### Mode selection is port FRESHNESS ⟨d/A3 — parity-mandatory⟩
- implementer: `fix` FRESH (triggering) this execution ⇒ fix mode; else `task` fresh ⇒ decomposed mode; else implement.
- planner: `revise` fresh ⇒ REVISE; refiner: `revise` fresh ⇒ refine that file, else refine `plan`.
- A LATCHED loop-input token never selects the mode — this is the token-model equivalent of v1's publish-clears-review (channels.mjs:150); without it a later fresh-plan re-fire binds a stale fix and wrongly enters fix mode. First executions treat every bound port as fresh. The scheduler hands the executor `trigger.freshPorts`.
- The `reviewKind !== 'plan-review'` provenance hack dies: planReviewer.review wires to planner.revise, so a plan review can never reach implementer.fix.

### Decomposer fan-out (graph-native)
implementer's `task` input is declared `expands: true` in meta. A fresh token binding an expands input (and no fresh `fix` trigger) runs ONE **composite execution**: parse decomposition `{phases[{tasks[]}]}`; phases sequential; task sub-executions parallel under the semaphore, each recorded `{ executionId, nodeId, kind:'task', ordinal, phase, taskId }` under the SAME node; sibling-failure abort kept; worktree staged after the last phase; the node's outputs fire ONCE at the end. A later fix-cycle re-fire runs a single normal execution on the combined diff (today's semantics). `rewriteStepperForDecomposition` dies; the UI collapses task executions under the node.

### Executors (runners v1 dies)
⟨d⟩ Executor selection is `node.kind` + `meta.runnerType` — NEVER an agent key: `task`, `await`, `combine` (pure engine, instant, $0, still emit exec events ⟨e — merge executor removed⟩), `clarifier` (ANY agent with `runnerType:'clarifier'`: agent spawn → questions json on its first json output port → interactive answer gate → engine rewrites the file to `{questions, answers}` → publishes the self-contained token; nodeId-scoped ask ids; any number of clarifiers per graph), and `agent` (one generic executor for producers and verifiers — generalization of runGenericProducer/Verifier). `runners.mjs` and the nine bespoke prompt builders die; `phases.mjs` shrinks to a prompt library (taskHeader, buildSystemPrompt, questionsPromptBlock, markers, workspace blocks — FALLBACK_PROMPTS deleted ⟨d⟩: sidecars with missing/empty agentFile bodies are skipped at registry load; buildSystemPrompt keeps one generic role-free last-resort line).
⟨e⟩ (The ⟨d⟩ merge same-drain note moved to §3 Tokens as the multi-wire binding rule.)

### Prompt assembly
System prompt = tool instruction ⊕ workspace context ⊕ agent .md body (unchanged sources). Task prompt = taskHeader + `## What to do` from meta `promptHints` + generated **"## Ports (this run)"** block binding every port to an absolute path (generalized genericIoBlock; per-port `as` renderers cover the old bespoke arms: `file` default, `answers`, `fix-review`, `worktree`) + questions block + MOCK markers. Builtin prompt quality is pinned by snapshot tests asserting every load-bearing line of today's prompts survives.

### Output allocation
Per (node, port, execution) from meta `filename` templates. Tokens: `{cycle}` (execution ordinal), `{vsuffix}` (run-global plan version counter: '' first, `-v<n>` after — replaces the planner=cycle / refiner=cycle+1 rule), `{base}` (run baseName). `store: 'run'` → pipelineDir; `store: 'project'` → external store (plans/reviews keep today's homes and filenames: `impl-review-cycleN.json`, `plan-review-cycleN.json`, etc.). Verdict JSON is a node-level allocation, not a port. Two outputs may share one filename template only with identical type (refiner plan/revise).

### Resume v2
Snapshot after every publish: `{ version: 2, seq, graph, tokens{...}, consumed{...}, ordinals{...}, wires{deliveries,allowance}, execs[{executionId,nodeId,kind,ordinal,status,sessionId,task?}], gate, ask, stepModels, workflowId, guardrailsId, pipelineDir, ... }`. Paused in-flight executions re-attach sessions one-shot. `resume()` accepts only version 2; v1 resume code dies; startup sweep flips paused v1 rows to `interrupted` ("paused before the graph engine rework — not resumable"). Crash reconciliation/heartbeat unchanged.

### Events & state
- `phase` → **`exec`** `{ nodeId, executionId, kind:'cycle'|'task', ordinal, status:'start'|'done'|'error'|'paused'|'skipped', agentKey, trigger?:{wireIds[]}, phase?, taskId? }`.
- New **`token`** `{ seq, from:{node,port}, type, path?, forced?, firedAt }`.
- `log`/`artifact`/`subagent`/`stepskills`/`stepgraphify` keep names, gain `{nodeId, executionId}`.
- `state`: `phase`/`cycle` scalars die → `active: [{nodeId, executionId}]`, `executions` ledger, `graph` (resolved runtime graph) included in the first state.
- Question event gains `wireId?` for gates.

### Mock mode v2
Marker names unchanged; ⟨d⟩ `MOCK_ROLE` resolves by the generic 5-step chain — (1) validated `meta.mockRole` (builtins pin today's writer table), (2) `runnerType:'clarifier'` ⇒ `clarify` (with `MOCK_PRIOR` = answered-question count, terminating clarifier loops offline), (3) an output wired into an `expands` input ⇒ `decomposer` (valid decomposition + `MOCK_TASKS_DIR`), (4) `meta.verdict` ⇒ `generic-verifier`, (5) `generic-producer`. `MOCK_CYCLE` = execution ordinal → cycle-decreasing severities keep terminating loops offline; `MOCK_JSON` whenever `meta.verdict`; flow nodes never spawn; `MOCK_ASK` unchanged. Any all-custom graph completes under WORCA_MOCK=1.

### Workspace runs
reviewer→workspaceReviewer substitution stays a resolve-time key rewrite; the pair must declare identical port signatures (asserted at registry load). Scanner stays off-pipeline (`scope: 'workspace-only'`). Detached runroot, per-project worktrees, checkpointRefs unchanged; staging per code-producing execution.

---

## 4. Flow nodes

### Task (Amended 2026-08-10-c — the source)
- Exactly ONE per template (V20). Zero inputs; one `md` output `task`, `when: 'always'`.
- Fires once at run start (pure engine execution, instant, $0): emits the rendered task document — run title, the user's prompt markdown, and an "Attached files" section listing absolute paths of extras copied under `pipelineDir/extras/` (exactly what `renderPromptArtifact` produces today). Consumers Read attached files from those paths; the files themselves are not tokens.
- Replaces implicit seeding entirely: entry is a visible wire (`Task.task → clarify.task`); mid-stream templates wire `Task.task → refiner.plan` or `Task.task → manualWebUiTesting.checklist` (generalizes v1 `entrySeedChannels`).
- ⟨d/A2 — parity-mandatory for wf_provided-plan⟩ Optional `config.planStoreSeed: true`: the task execution ALSO writes its rendered document to `planPath(projectDir, baseName, 1, datePrefix, workspaceKey)`, the emitted token's path IS that plans-store file, and the run's plan-version counter starts consumed at 1 (the next plan-store write allocates `-v2`). Reproduces v1's seeding of the `plan` channel into the plans store for mid-stream entries.
- New canvases preload one Task node; deletable, but validation blocks save/run without it.

### Await
- Ports: `in1` = **payload** (type = resolved type of its wire; md/json/void all legal — void payload ⇒ void trigger out), `in2..inN` = sync (`any`). One output `out`.
- Fires when ALL inputs are fresh; re-emits the payload token with a new seq. Pure engine execution.

### Combine
- Ports: `in1..inN` all `md`; one `md` output. Fires when all fresh; concatenates payloads in port order with `## From <node name>` headings; writes one md artifact; fires one token.

### Merge — REMOVED (Amendment e supersedes Amendment b's node)
- Amendment b introduced Merge because inputs accepted exactly one wire and Await/Combine are AND-joins (two loops that never fire in the same iteration — reviewer.review and webui.review both looping to `implementer.fix` — would deadlock an AND-join).
- ⟨e⟩ Inputs now accept multiple wires, so the OR fan-in is native: `reviewer.review → implementer.fix` AND `webui.review → implementer.fix` wire DIRECTLY; the input binds the freshest token. Loop budgets sit per blocking wire (each loop gates independently) — exactly where they sat on the wires into the merge. Trace-equivalent to the Merge shape (Merge was a pure forward-the-freshest valve), so the Amendment-b parity verification carries over.

Task, Await, and Combine appear in the palette under a pinned **Flow** group (Task's pill disabled once one is placed); they are engine builtins — no sidecar, no .md, not in the agent registry. Visuals: dark-ink headers (deliberate deviation from the violet mockup — violet is planner's color; flow nodes must read "system").

---

## 5. Agent metadata v2 + definitions + creation flow

### Sidecar schema v2 (agents/<key>.meta.json)

```
{ metaVersion: 2,                          // REQUIRED literal (old 'version' field dropped)
  key, displayName, description?, color?, icon?, agentFile,
  runnerType: 'producer'|'verifier'|'clarifier',
  scope?: 'project'|'workspace-only', domain?, order?: number,   // order optional, UI-sort only
  fanOut?, asksQuestions?, questionsLocked?, questionsDefault?,
  requiresSkills?: string[], promptHints?: string,
  mockRole?: string,                       // ⟨d⟩ validated against claude-runner's exported MOCK_WRITER_ROLES;
                                           //     unknown value ⇒ warning + dropped (generic mock chain applies)
  sideEffect?: 'code',
  verdict?: { filename },                  // required iff runnerType='verifier'; legal on producers (refiner)
  // ⟨d⟩ capability fields — the generic engine reads ONLY these, never agent keys:
  wantsRequest?: bool,                     // default false; true = task prompt carries '## Original request'
                                           // even off the entry path (refiner/reviewer/planReviewer today)
  workspaceFanOut?: bool,                  // default false; true = workspace runs force fanOut on
                                           // (replaces the v1 FANOUT_ELIGIBLE key set)
  workspaceStrategy?: 'explore'|'task'|'review',  // selects the workspace fan-out prompt block; absent = none
  workspaceVariantOf?: string,             // this agent substitutes for <key> on workspace runs; must be
                                           // scope 'workspace-only'; port signatures must deep-equal the
                                           // target's (asserted at resolve); winner by layer builtin>user>plugin
  placeable?: bool,                        // default true; false = never a graph node (drives V4, palette filter)
  inputs:  [ { id, type:'md'|'json'|'void', label?, description?,
               required?: bool (default true),
               loop?: bool (loop receiver: implies required:false; excused from first-run
                            barrier, fresh token re-fires the node),
               expands?: bool (json only),
               as?: 'file'|'answers'|'fix-review'|'worktree',  // ⟨d⟩ Ports-block renderer (default file;
                                           // answers⇒json, fix-review⇒md, worktree⇒void ports only)
               directive?: string } ],     // ⟨d⟩ markdown appended to the task prompt ONLY when this port is
                                           // bound FRESH ({path} substituted) — hosts the old fix/REVISE/slice arms
  outputs: [ { id, type, label?, description?,
               when?: 'always'|'blocking'|'clean' (default always),
               filename?: string,          // required for md|json; basename template {cycle}{vsuffix}{base}
               store?: 'run'|'project' (default run),
               artifactKind?: string } ] } // ⟨d⟩ artifact-event label (default = port id; builtins pin the
                                           //     v1 kinds: clarify.answers→'clarify', webui md→'webui')
```

DEAD v1 fields: `consumes`, `optionalConsumes`, `produces`, `connectsTo`, `loopSource`, `uiPhase`, `channelDefs`. Shipped sidecar files become the single source of truth (DEFAULT_SPEC deleted).

### The 11 builtins (port contract)

| agent (runner) | inputs | outputs | verdict |
|---|---|---|---|
| clarify (clarifier) | task:md | answers:json | — |
| planner (producer) | task:md · answers:json opt · revise:md **loop** | plan:md → `{base}{vsuffix}.md` [project] | — |
| refiner (producer) | plan:md · revise:md **loop** (self) | plan:md clean · revise:md blocking (same file) | refine-review-cycle{cycle}.json |
| planReviewer (verifier) | plan:md | review:md blocking → `{base}-plan-review.md` [project] · pass:void clean | plan-review-cycle{cycle}.json |
| decomposer (producer) | plan:md | tasks:json → decomposition.json | — |
| implementer (producer, sideEffect:code) | plan:md · fix:md **loop** · task:json opt expands · start:void opt | done:void | — |
| reviewer (verifier) | plan:md · done:void opt | review:md blocking → `{base}-impl-review.md` [project] · pass:void clean | impl-review-cycle{cycle}.json |
| workspaceReviewer (verifier, ws-only) | plan:md · done:void opt | review:md blocking → `{base}-ws-review.md` [project] · pass:void clean | ws-review-cycle{cycle}.json |
| manualTestsChecklist (producer) | plan:md · start:void opt | checklist:md → manual-tests-checklist.md | — |
| manualWebUiTesting (verifier) | checklist:md | review:md blocking → webui-review-cycle{cycle}.md · pass:void clean | webui-review-cycle{cycle}.json |
| workspaceScanner (producer, ws-only, off-pipeline) | task:md | workspace:md → workspace-description.md | — |

Refiner's verdict privacy is structural: verdict file exists, no review-md output port.
Loop-back inputs are dedicated ports (`fix`, `revise`) — one-wire-per-input holds by construction; no Combine needed for builtin loops.

### Meta validation (registry load: skip+warn; agent-store save: hard 400)
metaVersion===2 else v1 skip path; key regex; inputs/outputs arrays, ≥1 output, ≤8 ports per side; port id `/^[a-z][A-Za-z0-9_-]{0,31}$/` unique per side; type in closed set; void ports: no filename/store (⟨d⟩ `seed` died in Amendment c; void inputs also carry no `as`); md|json outputs require basename-only filename with tokens ⊆ {cycle, vsuffix, base}; `when` rules per §2; verifier ⇒ verdict required; `loop: true` coerces `required: false` (never both); `expands` only on json inputs; clarifier ⇒ ≥1 json output; shared filename templates require identical type; color/scope/domain/questions coercions as v1; order defaults 999.

### .md bodies
`## Inputs (from the task prompt)` → `## Ports` (semantics per port; "the engine binds every port to an absolute path in the task prompt — never hardcode filenames"). Verdict/clarify JSON contracts stay VERBATIM. Fan-out, workspace, graph-tooling sections stay verbatim. Frontmatter unchanged (tools:/description: still the only consumed fields). ⟨d⟩ FALLBACK_PROMPTS deleted — a v2 sidecar with a missing/empty agentFile body is skipped at registry load with a warning; buildSystemPrompt keeps one generic role-free last-resort line.

### Creation flow & registry
- agent-gen `_metaSchemaBlock` rewritten to v2 (guardrails: ≥1 output, closed types); neighbor context becomes port lists; channel-vocabulary block dies.
- Agents view gets a port editor exposing the FULL v2 surface ⟨d⟩: port rows id/type/required/loop/expands/when/filename/store + per-port `as` select and `directive` textarea; agent panel runnerType (incl. clarifier), verdict filename, sideEffect:code, validated mockRole select, wantsRequest, workspaceFanOut/Strategy/VariantOf, placeable (with a "not placeable" badge); save surfaces the 400 rule text verbatim.
- New `portSummary` derived text = "Reads <non-void input ids>; produces <non-void output ids>." (the existing `descriptionDerived` boolean flag keeps its current meaning and test).
- Old user v1 sidecars: soft-skip + loud actionable warning (never brick the registry). Templates referencing skipped keys fail validation with a message naming the fix.

### Plugins (API v2)
`WORCA_PLUGIN_API = 2`. Sidecars must pass v2 normalize (hard error listing the failed rule) — ALL capability fields available to plugins; plugin `workflows/*.json` must be v2 graphs (same pure validator; agent keys ⊆ plugin's own — deliberate isolation, kept; ⟨d⟩ FULL kind set `{agent, task, await, combine}` ⟨e — merge removed⟩ — the pre-d "agent/await/combine" contradicted V20, no plugin graph could validate). Installed v1 plugins auto-drop at load via the engines gate with a Plugins-view message ("built for worca-cc-api 1; this host requires 2 — update or reinstall"); never deleted. EMBEDDED_AGENTS fallback regenerated with v2 ports.

### Skills / install
- install.mjs unchanged (copies .md only; bodies remain valid standalone subagents).
- skills/worca/SKILL.md: fix stale `--max-refine/--max-review` lines; one sentence noting template-defined pipelines.
- `.claude/skills/orchestrate` (prose v1 clone): FREEZE with a staleness note; follow-up ticket.

---

## 6. Composer UI (new `ui/public/graph/` family)

Vanilla ES modules, no framework, no build step. Computed geometry (node W fixed 220px; H = f(port counts); all anchors/hit-tests derive from model x/y — zero getBoundingClientRect in the render path → jsdom-testable). Rendering = DOM node cards + ONE SVG wire layer inside one `#world` div; pan/zoom = CSS transform on `#world` only.

### Modules (LOC budgets)
| module | contents | LOC | DOM |
|---|---|---|---|
| graph-model.mjs | normalize/serialize v2, node factory, legality, SCC/loop detect, topo order, entryInputs, validate adapter | 280 | no |
| graph-geometry.mjs | nodeSize, portAnchor, bezierPath (cp clamp 48–160, 0.45·dx; loop wires bow), hitNode/hitPort(r14)/hitWire(<6px), fitBounds, snap(11) | 220 | no |
| graph-layout.mjs | auto-layout: longest-path ranks (loop wires excluded), barycenter, x = rank·300, deterministic | 180 | no |
| graph-view.mjs | shared renderer (composer editable / run live / static preview), incremental repaint | 420 | yes |
| composer-editor.mjs | pointer interactions, ghost wire, selection, keyboard, pan/zoom, undo ring (50), palette drag-in, dirty tracking | 520 | yes |
| inspector.mjs | node panel (model/effort/fanOut/questions/awaitAll), wire panel (maxCycles), task-node panel | 220 | yes |
| run-decor.mjs | manifest+state → node states/badges, execution rows, cost/dur sums, legacy-v1 chip strip | 300 | thin |
| agents-meta.mjs | EMBEDDED_AGENTS v2, mergePalette, groupPaletteByDomain, paletteDesc v2 | 200 | no |
| thumbnail.mjs | pure graph → mini-SVG string | 60 | no |
| save-dialog.mjs | `<dialog>` save modal (name + domain datalist) | 120 | yes |

Dies: column composer (app.js:1669-2350; the modelById/option helpers at :2352-:2361 stay — run/new-pipeline views use them), buildRunGraph/paintRunGraph, composerPaintWires, buildNodeConfigRows, composer-core.mjs (survivors move to agents-meta), both `window.prompt` saves. app.js keeps view routing/WS/runs-map/qpanel/logs; shrinks ~900 lines. New CSS ~450 lines replaces composer+run-graph blocks.

### Interactions
Palette pill drag-in (pointer-based; click = add at center) · node drag with 11px snap · drag from any port dot → ghost wire, live legality (legal target: 1.35× scale + green ring; illegal: red ring + reason chip: "json → md type mismatch", "already connected" for a duplicate (from,to)) · ⟨e⟩ drop on a wired input ADDS a wire (multi-wire fan-in; remove by deleting the old wire) · click wire = select (ink 2.5px + midpoint ⊗; Del deletes; loop wire selection opens maxCycles inspector) · Esc/canvas-click clears · Del deletes node+wires · arrows nudge · Cmd+Z / Shift+Cmd+Z · wheel/trackpad pan, space/middle-drag pan, pinch/Cmd+wheel zoom 0.4–1.6 about cursor, bottom-right [− % + ⛶fit] cluster, dots fade < 0.6 · auto-layout button · new canvas preloads one Task node; empty-state copy: "Wire agents from the Task node — outputs → inputs". No multi-select, no context menu, no touch (YAGNI).

### Visual spec (tokens from style.css)
- Card 220px, r16, 1.5px --line-2, white, --shadow-soft (hover --shadow); selected: 2px ink outline offset 2. v1 left accent bar + .nic chip die.
- Header 34px agent-tint bg, agent-ink 13px/600 title + 16px icon. Flow nodes: ink bg, white title.
- Port rows 24px, **STACKED zones ⟨d⟩: all inputs first, 9px separator rule, then all outputs** (full-row width for conditional captions; separate zones prevent wiring mis-drops; anchors: input i at y+56+24i, output j at y+65+24·nIn+24j). Input dots (10px) overhang the left border (−5px); name 12.5px/500; type caption 10px mono ink-3 (`md`/`json`/`void`). Output rows right-aligned. Port hit target 22px. Loop inputs carry an amber `loop` chip ⟨d⟩.
- Dot colors by TYPE: md solid ink; json blue; void hollow (2px ink-3 ring); conditional output = 8px amber diamond + caption "on blocking"/"on clean".
- Await chip: amber-tint pill "AWAIT" 10px/700, node footer, shown when `awaitAll` on.
- Wires: 2px beziers; data #B7B7BC solid (dashes die); hover/selected ink; loop wires amber solid + midpoint "≤3" pill (white bg, 1.5px amber stroke); run mode: both-ends-done green, firing edge marching ants (reuse wireFlow), others dimmed .26; 9px arrowheads.
- Canvas: #FBFBF9 + 22px radial dot grid. Legend ⟨d⟩: "grey = data · amber = loop · ◆ = conditional · ⤫N = fan-out".
- Validation: red node pip (tooltip) / red wire stroke; Save disabled with error-count chip; toast click centers offender.
- Palette: 264px left rail, domain chips + filter kept; pill line 2 = lowercase port ids, e.g. "in plan · out plan, revise" (10.5px mono) ⟨d — v1 channel-name example was stale⟩; pinned Flow group (Task, Await, Combine ⟨e⟩; Task pill disabled once placed); `placeable:false` agents never listed ⟨d⟩.
- Unsaved-changes label + filled Save; save modal replaces prompts; saved rows get mini-SVG thumbnails; expanded preview = static graph-view.
- Motion: --t-fast 120ms / --t-med 200ms; reduced-motion parity extended. Light theme only (app has no dark mode).

### New-pipeline (run setup) view
Keeps: workflow picker (+ read-only mini-graph), guardrails, mock, budget. Per-node config moved to composer inspector; run setup keeps a collapsed "Per-run overrides" disclosure (topo-ordered model/effort rows). Entry v1: the single prompt textarea (+ extras attachments) feeds the Task node (multi-param entry is out of scope).

---

## 7. Run monitor v2

Same graph renderer, live decor:
- Node states: pending .5 opacity · active agent-color glow (multiple concurrent actives; frontier int dies) · done/paused/stopped pips · NEW `skipped` (.35 + dashed border) · NEW `error` (red ring + × pip). Card progress = done agent-nodes / total.
- **Executions footer** per agent node once ≥ 1 execution: collapsed = 7px squares + "3 runs · $1.12" + chevron; expanded in-card rows (22px): status led, label ("cycle 2 · fix" / truncated task title), right "2m10s · $0.42"; row click filters the run log to that executionId (log filter gains an execution dimension); running execution pulses. Node header cost/duration = sum over executions. Default collapsed.
- Loop badge on loop wires: fired count "2×" amber circle.
- Gate/question: amber "?" pip on the node; click scrolls to qpanel.
- Live wire ants on the edge(s) in the active execution's `trigger.wireIds`.
- Old v1 history rows (stepper version 1 / absent): flat horizontal chip strip (label + status tint + cost/dur, ~40 LOC). Old painter deleted.

---

## 8. Persistence & migration

DB migration **V17** ⟨d — re-seed decision 2026-08-10 supersedes the plain drop⟩:
- `ALTER TABLE workflows ADD COLUMN graph TEXT;`
- **Re-seed**: the 7 known saved templates (wf_full, wf_no-clarify, wf_provided-plan, wf_full-no-decompose, wf_quick-fix, wf_clarify-implement, wf_clarify-quick-fix) are UPDATEd in place to version 2 with hand-written graph re-expressions (trace-verified v1 parity; constants in `src/core/graph/seed-templates.mjs`); their `config_workflow_nodes` overlays migrate to the new node ids and `config_workflow_feedbacks.max_cycles` rows migrate into `config_workflow_wires` via static mappings (incl. wf_default's).
- `DELETE FROM workflows WHERE version = 1;` (now only NON-reseeded rows, e.g. `wfp_*` plugin imports; audit log line + release note)
- `ALTER TABLE pipeline_steps ADD COLUMN execution_id TEXT;` — ⟨d⟩ the step key IS the executionId (`x:<nodeId>:<ordinal>[:p<P>t<T>]`), stored in `pipeline_steps.execution_id`
- overlay storage for per-wire maxCycles (`max_cycles` keyed by wire id); `config_workflow_feedbacks` becomes unread
- INCREMENTAL_COLUMNS healing entries updated.

`pipelines.stepper` column keeps its name; content = manifest v2 `{ version: 2, graph: {nodes[...with ports/loop flags/model/effort], wires[{...,loop}]}, bookends: {preflight: true, done: true} }`. Preflight/done stay UI chrome, not graph nodes.

---

## 9. Kill list (v1 code that dies)

`_dispatch`/rewind/stepCycle/`_loopFired`/`_gate` loop arms, `_runStep`, `_runDecomposedImplement`, `_bindNodeIo`, `_buildResumePoint` v1 (~1100 lines of orchestrator.mjs) · `channels.mjs` entirely · `runners.mjs` · nine bespoke run* builders in phases.mjs · `workflow-validator.mjs` v1 rules · `legacyFields`/`BESPOKE_BASE`/`DEFAULT_SPEC`/`connectsTo`/`uiPhase` map · `entrySeedChannels`/`SEEDABLE`/`CHANNEL_IDS` · column composer, strips, stepper painter, CLIENT_DEFAULT_STEPPER, window.prompt saves · resume v1 branch · `config_workflow_feedbacks` reads · `rewriteStepperForDecomposition`. Tests: ~15 of 88 ui-* suites die, others port; workflows/dispatcher/channels suites replaced by graph suites.

---

## 10. Engine file map & landing seams (clean break, reviewable increments)

- NEW `src/core/graph/ports.mjs` (~150): tokens, SCC/loop classification, conditional groups, readiness.
- NEW `src/core/graph/scheduler.mjs` (~450): loop, wire counters, gates, quiescence, snapshot/restore.
- NEW `src/core/graph/executor.mjs` (~400): agent/clarify/await/combine executors, port binding, allocation templates, verdict routing, composite fan-out.
- NEW `src/core/graph/validate.mjs` (shared pure validator, used by server + plugins + UI adapter).
- REWRITE `orchestrator.mjs` → ~2400 (keeps run() setup, attempts/questions/recover/ask, cost, sub-agents, heartbeat).
- Phasing: PR1 pure graph modules + exhaustive unit tests (no callers) → PR2 executor + meta v2 + builtin sidecars/md + prompt snapshot tests → PR3 THE BREAK (orchestrator swap, events/resume/manifest v2, V17, server routes, UI graph family) — engine+UI+agents land atomically → PR4 decompose composite, workspace parity, mock table, plugin API v2, kill-list deletions, smoke.

---

## 11. Risks

1. Builtin prompt drift when bespoke builders die → PR2 snapshot tests pin every load-bearing prompt line.
2. Loop cascades re-run the downstream cone each iteration — inherent to chosen semantics; bounded by wire allowances + per-launch cost gate.
3. PR3 is a large atomic landing — mitigated by PR1/PR2 being fully tested and caller-free, and a shared `graph/fixtures.mjs` canonical template+state used by engine AND UI tests (schema drift shows as fixture diffs).
4. V17 deletes saved templates silently — audit log + release notes.
5. Double-fire on multi-always-input nodes without awaitAll — validator W18 + UI suggestion.
6. v1 user sidecars vanish from palette (soft-skip) — warning text names the fix; optional `worca agents migrate` helper is a follow-up.
7. Old paused v1 runs are unresumable — startup sweep marks them interrupted with an explicit reason.

## 12. Out of scope (explicit)

Multi-param entry forms (per-port run parameters) · expression-language `when` predicates · dark mode · touch/mobile canvas · multi-select/marquee · `.claude/skills/orchestrate` rewrite (frozen) · template import/export bundles · migration converter for v1 templates (user-declined).

---

## Amendment f — full text

> Lineage ⟨f⟩: Amendment f was revised in place on 2026-08-10 (single-wire course correction, user decision) before any implementation consumed it — this is the authoritative text; do not stack a further amendment for it. It SUPERSEDES Amendment e's multi-wire clause: inputs are single-wire everywhere (V7 restored), and the OR card — the Amendment-b Merge, generalized — is the explicit fan-in valve; per-blocking-wire loop budgets survive on the wires INTO it (exactly where they sat on Merge's in-wires). Amendment e's `loop: true` carry-over and the b-era blocking-source loop-wire rule stand; e's Merge-removal rationale (direct multi-wire trace-equivalence) is superseded. Base-section passages marked ⟨e⟩ that assert multi-wire inputs are to be read as replaced by the texts below.

### §0 Summary and goals — deltas

Replace the wires bullet with:

- **Wires** connect one output to one input. Fan-out only ⟨f — Amendment e's multi-wire clause reversed⟩: one output may feed many inputs; every input accepts exactly ONE wire (V7). Fan-IN is an explicit OR card — the two review loops feed an OR whose `out` feeds `implementer.fix`.

Replace the flow-node bullet with:

- New builtin **flow nodes**: `AND` (pure synchronizer; static `void` out) and `OR` (payload-forwarding valve — the b-era Merge generalized; types resolved from wiring) ⟨f — replacing `Await`⟩, `Combine` (AND-join; concatenates md inputs), and `End` (the graph's single sink ⟨f⟩). Every agent card carries one engine-synthesized `await` gate input ⟨f⟩. Agent blocks keep the per-block **Await-all** toggle. (`Merge` existed between Amendments b and e; `Await` existed before f — both removed; the OR card is Merge's direct successor ⟨f⟩.)

In the Task-node bullet, extend "**A single Task node is the graph's source**" with: "and a single **End node** is its sink ⟨f⟩: its one wire's token finishes the run".

### §1 Template schema v2 — deltas

Replace the `Node.kind` line and the `arity` comment:

```ts
  kind: 'agent' | 'task' | 'and' | 'or' | 'combine' | 'end',   // ⟨e⟩ 'merge' removed ⟨f⟩ 'await' removed; 'and'/'or'/'end' added
```
```ts
    arity?: number,              // and/or/combine only, >= 2 (ports in1..inN) ⟨f⟩
```

Add to Notes:

- ⟨f⟩ Every `kind:'agent'` node's resolved input list is its meta inputs PLUS one engine-synthesized gate input appended LAST: `{ id: 'await', type: 'any', required: false }`. Synthesized by portsFn for every agent node — never stored in the template, never declared in meta (§5 reserves the id on both sides). It participates in V5/V7/V8/readiness exactly like a declared optional input (one inbound wire, like every input — V7); its bound payload is discarded.

wf_default canonical example — add one node and one wire (all other lines unchanged):

```json
    { "id": "n_end",     "kind": "end",                         "x": 1720, "y": 200, "config": {} }
```
```json
    { "id": "w10", "from": {"node":"n_review","port":"pass"},   "to": {"node":"n_end","port":"result"} }
```

After the "Entry:" paragraph add:

Exit ⟨f⟩: the **End node** — exactly one per template (V21), zero outputs, `result` input single-wire like every input (V7; multi-terminal graphs fan alternatives through an OR card). `n_review.pass → n_end.result` finishes the run; End is trace-neutral here (reviewer.pass fires at v1's natural completion with nothing else in flight — Parity carryover).

### §2 Type system, wiring legality, loops, validation — deltas

Replace the `any` type line:

- `any` — engine-internal wildcard: accepts a wire from any output type. Lives only on AND `in1..inN`, OR ports BEFORE resolution (an OR's in/out types resolve from wiring — V8 ⟨f⟩), End's `result`, and the synthesized agent `await` port ⟨f — was "allowed only on Await inputs"⟩; never declarable in agent meta.

(The wire-legality sentence — "`to`-port type must equal `from`-port type (or `any` on the input side)" — is unchanged; the ONLY output-type resolution in the system is the OR valve's, V8 ⟨f⟩.) Conditional outputs are unchanged. Loop classification: rules unchanged (AND/OR/End outputs are `always`/absent, so a card never contributes a blocking-source edge) — but read the base §2 passages through the valve ⟨f⟩: the "Full" template's two review loops terminate on `or.in1`/`or.in2` (each blocking in-wire is a loop wire in the big SCC and keeps its own `maxCycles`/gate; `or.out → implementer.fix` is always-source in-SCC ⇒ plain, budget-less — the existing classification yields this with no new rule), the loop-input sentence "a fresh token on ANY of its wires" reads "on its wire" (one wire since ⟨f⟩), and the `clean`-source example `reviewer.pass → checklist.start` reads `→ checklist.await`.

Validation rules — changed/new rules quoted whole (V1, V2, V4–V6, V9–V11, V13–V15, V17, V20 unchanged; V7 RESTORED below; V22 retired):

7. E ⟨f — RESTORED, reversing ⟨e⟩'s drop⟩ Every input accepts at most ONE inbound wire — uniform across the graph: agent meta inputs, the synthesized `await` port, AND/OR/Combine `inK`, End's `result`. A second wire into a wired input is an error naming the input; duplicate `(from, to)` pairs remain V6's. Fan-out from one output is unrestricted; fan-IN is expressed with an OR card.

3. E `kind ∈ {agent, task, and, or, combine, end}` ⟨d: `task` was missing — Amendment-c staleness⟩ ⟨e: `merge` removed⟩ ⟨f: `await` removed; `and`/`or`/`end` added⟩; `key` present iff kind = agent.

8. E Type compatibility per the table above, checked for every wire (each input carries at most one — V7 ⟨f⟩). ⟨f⟩ OR resolution — scoped to OR alone: an OR's `out` type resolves from wiring — `resolveOrOutType` = the first resolvable inbound source type, recursing through chained ORs with a seen-set — and ALL wires into that OR must carry the SAME resolved type (homogeneity — the error is V12's, naming the mismatched wires; V8's clause is the shared mechanism and additionally checks or.out's outbound wires against the resolved type). Unresolvable (unwired `inK` — already a V12 error) ⇒ V8 skips that OR. AND outs are STATIC `void`; the ⟨d⟩ AWAIT-resolution clause and its chained-await seen-set stay dead with the Await node.

12. E AND/OR/Combine ⟨f — Await clauses replaced⟩: integer `arity ≥ 2` (ports `in1..inN`); every `inK` input wired — Combine's all `md`, AND's from any output type, OR's homogeneous per V8's resolution clause ⟨f⟩.

16. W `awaitAll` on a node with < 2 wired non-loop inputs (no-op). ⟨f⟩ The synthesized `await` port counts when wired — `plan` + `await` = 2 wired non-loop inputs, and awaitAll then meaningfully requires both fresh on re-runs.

18. W Two `always`-sourced **non-void, non-loop** inputs wired to an **agent** node ⟨f — flow nodes are outside V18 entirely: AND/Combine fire all-fresh (nothing to double-bind), OR's any-fresh firing and End's completion are their purpose⟩ without `awaitAll` (double-fire risk on re-runs; UI suggests enabling Await-all or inserting an AND card ⟨f — was "Await node"⟩). (The ⟨e⟩ wire-level clause is REMOVED with multi-wire inputs ⟨f⟩ — one wire per input makes it unconstructible.) ⟨d/f⟩ Four exemptions from the pair count: (a) inputs wired FROM the task node (it fires exactly once by construction) — without this wf_default itself warns permanently (n_plan: task + answers); (b) VOID-typed inputs — pure sequencing, no payload to double-bind; without this the universal `X.plan + implementer.done` idiom warns (wf_quick-fix / wf_clarify-quick-fix reviewers, whose plan comes from the planner's unconditional output; `awaitAll` is no fix there — it would block fix-cycle re-fires); (c) ⟨f⟩ the synthesized `await` port — payload-less by definition, same rationale as (b); (d) ⟨f single-wire⟩ LOOP inputs (meta `loop: true`) never enter the pair count — re-firing is their purpose (the deleted ⟨e⟩ wire-level clause's loop exemption, carried over to the pair count; LOAD-BEARING since the OR valve: `or.out → implementer.fix` is an ALWAYS-sourced non-void input, and without this exemption wf_full and wf_provided-plan would pair it with `decomposer.tasks → implementer.task` and warn — the zero-warning seed guard could not pass).

19. W A `when:'blocking'` output wired into an input without `loop: true` (likely a mis-wired loop). ⟨f⟩ Exempt when the target is an AND/OR `inK`, End's `result`, or an agent's synthesized `await` port: OR inputs are the CANONICAL loop-valve terminals — the double-loop seeds' blocking review wires end on `or.in1`/`or.in2` by design, so this exemption is load-bearing for the zero-warning seed guard — and AND/End/await targets are explicit flow-control sinks (deliberate sequencing/escalation, e.g. review.blocking → OR → agent.await, or fail-out into End), not a forgotten loop receiver, which is the payload-input shape this heuristic hunts. Combine inputs still warn (payload-bearing). (This restores, generalized, the merge-input exemption that ⟨e⟩ removed with the Merge node.)

21. E ⟨f⟩ Exactly ONE `end` node per template (mirror of V20); it has zero outputs and its `result` input must be wired (one wire, like every input — V7; fan alternative terminals through an OR card).

22. ⟨f⟩ RETIRED — subsumed by the restored V7: the await port's single-wire cap is now the universal input rule, not a special case. Number reserved so V-rule references stay stable.

### §3 Execution engine v2 — deltas

Tokens and state — replace the consumers bullet with ⟨f⟩:

- Consumers track `consumed[node][inputPort] = seq` at bind time. "Fresh" = token seq > consumed seq. Every input has exactly ONE wire (V7 ⟨f⟩ — the ⟨e⟩ multi-wire freshest-binding rule is REMOVED; the OR card is the explicit freshest-binding valve, §4). The `await` binding records `consumed[node]['await']` like any input, but the bound token's payload is discarded at bind.

Firing rule (readiness) — replace the four bullets with:

- **First execution** of a node: every **wired non-loop** input has a token (validation guarantees required non-loop inputs are wired; the Task node is the only zero-input node and auto-fires at t0). Loop inputs (meta `loop: true`) are excused (implement fires before any review exists), regardless of what feeds them (one wire since ⟨f⟩). ⟨f⟩ A wired synthesized `await` port is a wired non-loop input: the first execution additionally requires its delivered token (the old checklist-`start` barrier, now universal).
- **Re-execution**, `awaitAll` off (default): ≥ 1 fresh token on any input (loop or not); other inputs bind their latched values. A fresh `fix` token re-fires the implementer in fix mode with the plan latched. ⟨f⟩ A fresh `await` token re-fires the node exactly like any other fresh input — but binds no payload, renders nothing, and never selects a mode.
- **Re-execution**, `awaitAll` on: every wired non-loop input must be fresh (a wired `await` port included ⟨f⟩) — OR a fresh loop token alone (the loop path always re-fires).
- **AND / Combine** ⟨f — was "Await/Combine"⟩: all inputs fresh, every execution (first included — the old Await readiness rule). **OR** ⟨f⟩: ≥ 1 fresh input, every execution (no first-run barrier); binds the FRESHEST fresh input (max seq) and re-emits ITS payload; several inputs fresh in one drain ⇒ ONE emission binding the freshest (the b-era Merge collapse, now the valve's own rule). **End** ⟨f⟩: a fresh token on its single `result` wire; binding it completes the run (see Completion). (Merge removed ⟨e⟩; the OR card is its successor ⟨f⟩.)

Ready-launch bullet unchanged (flow nodes still bypass the semaphore).

Publish / conditional routing, Loops/maxCycles/gates: unchanged (End fires no outputs; AND/OR fire `out` unconditionally). ⟨f⟩ In the double-loop shape the loop wires are the blocking wires INTO the OR — each carries its own maxCycles/allowance (A1 arithmetic per wire) and the gate holds the token BEFORE the OR, per in-wire; `or.out → fix` is always-source in-SCC ⇒ plain, no budget (existing classification, no new rule).

Completion / failure — replace the whole paragraph with:

Run is done in one of two ways ⟨f⟩:
- **End reached** (the normal path): a token binding End's `result` completes the run exactly as today's natural completion — the scheduler stops launching new executions and stops re-evaluating readiness; in-flight executions run to completion and PUBLISH (tokens latch and token events emit — recorded, nothing downstream fires; loop-wire delivery accounting and gates are skipped during this drain; pending asks are withdrawn); the run resolves `'done'`. End executes at most once, binding its single wire's token (V7 ⟨f⟩); its received payload (path/value) is the pipeline result (§7); a void token ⇒ result-less completion.
- **Quiescence without an End token**: nothing running, nothing ready, no held gates, no pending ask ⇒ the run resolves `'done'` with an explicit warning `finished at quiescence — End not reached` (state `endReached: false`; §7 banner). Reachable only via conditional dead-ends (e.g. a forced-continue whose source has no wired clean output) — never on the 8 builtin graphs (Parity carryover).

Nodes that never fired report `skipped` (untaken conditional branches, and anything cut off by the End drain — legal). Fail-fast: first execution error after retries aborts all in-flight and errors the run — an error during the End drain still errors the run ⟨f⟩. Pause/abort/cost checks run at every launch decision.

Mode selection ⟨d/A3⟩ — add one line: ⟨f⟩ The synthesized `await` port never participates: its payload is discarded at bind — no directive, no `as` renderer, no mode selection, no A3 interaction, absent from `trigger.freshPorts`-driven rendering and from the Ports block.

Executors — replace the selection list clause with: ⟨d⟩ Executor selection is `node.kind` + `meta.runnerType` — NEVER an agent key: `task`, `and`, `or`, `end`, `combine` (pure engine, instant, $0, no process spawn, still emit exec/token events ⟨e — merge executor removed⟩ ⟨f — await executor removed; and/or/end added⟩), `clarifier` (unchanged), and `agent` (unchanged). (Rest of the paragraph unchanged; the trailing ⟨e⟩ line "merge same-drain note moved to §3 Tokens as the multi-wire binding rule" is superseded ⟨f⟩ — the same-drain collapse now lives INSIDE the OR valve, §4.)

Prompt assembly — add: (⟨f⟩ the synthesized `await` input is never listed in the "## Ports (this run)" block.)

Resume v2 — replace the snapshot line with:

Snapshot after every publish: `{ version: 2, seq, graph, tokens{...}, consumed{...}, ordinals{...}, wires{deliveries,allowance}, ended, execs[{executionId,nodeId,kind,ordinal,status,sessionId,task?}], gate, ask, stepModels, workflowId, guardrailsId, pipelineDir, ... }` — ⟨f⟩ `ended: null | { nodeId, executionId, seq, result: { type, path?, value? } }`, set once a token binds End; a restored scheduler with `ended` set launches nothing and only re-attaches/awaits in-flight executions (drain resume). Everything else unchanged.

Events & state — deltas:
- `exec`: flow-node executions (task/and/or/end/combine ⟨f⟩) emit the same shape with `agentKey: null` and `kind: 'cycle'`; End's `status:'done'` event additionally carries `result: { type, path?, value? }` ⟨f⟩. (The run monitor distinguishes flow cards via `node.kind` in the resolved `graph` of the first state event — no new event fields for and/or.)
- `token`: unchanged shape; AND emits `{ ..., from:{node,port:'out'}, type:'void', path:null }`; OR re-emits the bound token's payload — resolved type, path/value preserved, NEW seq ⟨f⟩; End emits none (zero outputs) ⟨f⟩.
- `state`: additionally carries `result` (End's bound `{type,path?,value?}` or null) and `endReached: boolean` once the run resolves ⟨f⟩ — `endReached:false` on a quiescence finish drives the §7 warning banner. Persisted through the existing state JSON; no DB change.

Mock mode v2 — inline edit: "flow nodes (task/and/or/end/combine ⟨f⟩) never spawn"; the resolution chain is untouched.

Workspace runs: unchanged.

### §4 Flow nodes — fully rewritten section

### Task (Amended 2026-08-10-c — the source)
Unchanged, except the last bullet becomes: "New canvases preload one Task node AND one End node ⟨f⟩; each is deletable, but validation blocks save/run without it (V20/V21)."

### End ⟨f — the sink⟩
- Exactly ONE per template (V21 — mirror of V20's Task rule). One input `result`, type `any`, single-wire like every input (V7 — multi-terminal graphs fan alternatives through an OR card); ZERO outputs; no config.
- Pinned in the palette Flow group like Task; deletable, but save/run are blocked without it; new canvases preload Task + End.
- A token reaching End completes the run as natural completion (§3 Completion): launching stops, in-flight executions run to completion and publish (recorded; nothing downstream fires), the run resolves `'done'`. End executes at most once, binding its wire's token; the bound payload (path/value) is the pipeline result shown in the run monitor (§7); void tokens ⇒ result-less completion.
- Pure engine execution (instant, $0, no spawn); emits an exec event whose `done` carries `result` — the monitor lights the card.

### AND ⟨f — the pure synchronizer⟩
- Palette name "AND"; kind `and`. Ports: `in1..inN` (`config.arity ≥ 2`), type `any` — accept a wire from ANY output type; ONE output `out`, type `void`, `when:'always'` (STATIC — no resolution).
- Fires when ALL inputs are fresh, every execution (the old Await readiness rule) — the reusable AND-join for genuine wait-for-all sequencing.
- Payloads discarded (void out — pure sequencing; contrast OR, which forwards). Pure engine execution: instant, $0, no spawn; emits exec/token events; ordinal counts emissions.
- Typical wiring: multiple gate sources → AND → an agent's `await` port (or End's `result`); cards may chain (AND's void out is a legal source for any `any` input or a homogeneous void OR).

### OR ⟨f — the payload-forwarding valve (the Amendment-b Merge, generalized)⟩
- Palette name "OR"; kind `or`. Ports: `in1..inN` (`config.arity ≥ 2`); ONE output `out`, `when:'always'`. Types are RESOLVED FROM WIRING, not stored: all inbound wire sources must share ONE type (md/json/void all legal — V8 homogeneity) and `out` = that type (`resolveOrOutType`; chained ORs recurse with a seen-set; unresolvable — unwired `inK`, already V12 — ⇒ V8 skips).
- Fires on ANY fresh input, every execution (no first-run barrier); binds the FRESHEST fresh input and re-emits ITS payload (path/value) with a NEW seq; several inputs fresh in one drain ⇒ ONE emission binding the freshest.
- Pure engine execution: instant, $0, no spawn; emits exec/token events; ordinal counts emissions.
- Uses: an `md` OR is the fix-loop valve — `reviewer.review → or.in1`, `webui.review → or.in2`, `or.out → implementer.fix` (the double-loop seeds' shape; every agent input keeps exactly one connection); a `void` OR combines gate signals for an agent's `await` port or End's `result`.
- Loop budgets: the blocking wires INTO an OR inside an SCC are the loop wires (amber, per-wire `maxCycles`, gates hold the token BEFORE the OR); `or.out` is always-source ⇒ never a loop wire (existing §2 classification, no new rule).
- Honest note: this DELIBERATELY re-admits type-resolution machinery, scoped to OR alone — AND stays static void, and the dead Await-node machinery (`resolveAwaitOutType` + its V8 clause) stays dead.

### Combine
Unchanged — the payload-bearing md AND-join: `in1..inN` all `md`, one `md` output, all-fresh firing, port-order concatenation with `## From <node name>` headings, one md artifact.

### Await — REMOVED (Amendment f splits it into the universal `await` port + AND/OR ⟨f⟩)
- Await carried two jobs: synchronization (fire when all inputs fresh) and payload forwarding (re-emit in1's token) — bundled in one node with a distinguished `in1` payload port and its own dynamic-typing machinery (`resolveAwaitOutType`, V8's ⟨d⟩ resolution clause, the chained-await seen-set).
- ⟨f⟩ The synchronization job moves to the static-void AND card and the synthesized per-agent `await` gate input; the forwarding job moves to the OR valve (freshest-of-N, all-homogeneous — no distinguished payload port) and, for carrying a payload PAST a gate, to direct wiring: payload source straight to the consumer's payload input, gate source (or an AND of several) to the consumer's `await` port. No seed ever placed an Await node, so the removal itself changes no seed topology.
- The Await-NODE machinery dies with the node (§9): `resolveAwaitOutType` and its V8 clause never ship. (OR's own scoped resolution, `resolveOrOutType`, is a new, separate mechanism — see OR above.) Combine remains the payload-bearing md AND-join.

### Merge — REMOVED (Amendment e supersedes Amendment b's node)
Tombstone kept, with an ⟨f⟩ coda appended to it: Amendment e's replacement (native multi-wire fan-in) is itself superseded — inputs are single-wire again (V7 restored) and the OR card is Merge's direct successor: the same forward-the-freshest valve, generalized to N homogeneous inputs of any one type, with loop budgets on its blocking in-wires exactly where they sat on Merge's. The b-era Merge parity adjudication is the operative lineage (Parity carryover).

Task, End, AND, OR, and Combine appear in the palette under a pinned **Flow** group (Task's and End's pills disabled once one is placed ⟨f⟩); they are engine builtins — no sidecar, no .md, not in the agent registry. Visuals: dark-ink headers (deliberate deviation from the violet mockup — violet is planner's color; flow nodes must read "system").

### §5 Agent metadata v2 — deltas

Sidecar schema: add to the `inputs` comment block — ⟨f⟩ `id` may never be `await` (reserved on BOTH sides): the engine synthesizes the type-agnostic gate input under that name on every agent node; a sidecar declaring it fails validation.

Builtin table — replace two rows (all other rows unchanged):

| implementer (producer, sideEffect:code) | plan:md · fix:md **loop** · task:json opt expands | done:void | — |
| manualTestsChecklist (producer) | plan:md | checklist:md → manual-tests-checklist.md | — |

Add below the table: ⟨f⟩ The `start` void ports died — their job is the synthesized `await` gate, which EVERY agent row additionally carries (engine-added, deliberately absent from the table; seeds wire `reviewer.pass → checklist.await`). reviewer.done / workspaceReviewer.done STAY (`as:'worktree'` — real payload semantics: they gate on the staged worktree and render the worktree arm; not pure gates).

Meta validation — extend the rule list: ...port id `/^[a-z][A-Za-z0-9_-]{0,31}$/` unique per side **and never the reserved id `await` (either side) ⟨f⟩**; ... (all other clauses unchanged).

.md bodies — ⟨f⟩ implementer's and manualTestsChecklist's `## Ports` sections drop the `start` row; NO body mentions the synthesized `await` port (engine concern — the agent never sees the binding).

Creation flow & registry — ⟨f⟩ the Agents-view port editor rejects `await` as a port id with the reserved-id rule text; nothing else changes (the gate is not editable surface).

Plugins (API v2) — replace the kind-set clause: plugin `workflows/*.json` validate with the FULL kind set `{agent, task, and, or, combine, end}` ⟨f⟩; V21 applies to plugin templates too — every plugin graph carries exactly one End node.

Skills / install: unchanged.

### §6 Composer UI — deltas

- Palette: pinned Flow group becomes **Task · End · AND · OR · Combine** ⟨f⟩ (Task and End pills disabled once one is placed); pill line 2 lists META ports only — the universal `await` gate is not repeated on every pill ⟨f⟩.
- Card anatomy ⟨f⟩: every agent card renders ONE synthesized gate row `await · any` as a dedicated BOTTOM zone — below the output zone, after a second 9px separator, dot on the LEFT edge (user decision: the await port sits at the bottom-left of every card) — always present, subdued until wired. Meta-input and output anchors are UNCHANGED (the output-anchor `nIn` counts META inputs only); closed forms: await anchor = (X, Y+74+24·(nInMeta+nOut)); agent card H = 95.5+24·(nInMeta+nOut). AND/OR/End render as flow cards (ink headers): AND shows `in1..inN · any` and `out · void`; OR's `out` row captions the RESOLVED type (`any` until resolvable); `inK` rows stay `any` ⟨f⟩; End shows the single `result · any` row and no output zone; flow nodes carry NO await row. Exact visual language (dot glyph, subdued treatment) is the mockup's job; the rows and anchors above are normative.
- Legend ⟨f⟩: "grey = data · amber = loop · ◆ = conditional · ○ = gate · ⤫N = fan-out".
- Interactions ⟨f⟩: drag onto an agent's `await` row (or any AND/OR/End input) is legal from ANY output type (live-legality green; OR additionally requires type homogeneity with its already-wired ins — mismatch shows the V8 reason chip). Dropping on ANY wired input is REJECTED with reason chip "already connected" (V7 ⟨f⟩ — reverses the ⟨e⟩ add-a-wire rule; the chip formerly reserved for duplicate `(from,to)` now covers every second wire; rewire by deleting the old wire first). New canvas preloads one Task node AND one End node; empty-state copy: "Wire agents from the Task node to the End node — outputs → inputs."
- Inspector ⟨f⟩: AND/OR panel = arity stepper (the old await/combine arity control); Combine unchanged; End panel is informational (no config) and, in run mode, hosts the result display (§7).
- Everything else (geometry constants, stacked zones, wires, validation affordances, save flow, run-setup view) unchanged.

### §7 Run monitor v2 — deltas

- ⟨f⟩ End card: pending until the run's terminal token lands; then done pip + a **result chip** — the bound payload's basename when the token carries a path (click opens the artifact view; the run summary row carries the same chip), a bare "complete" state for void/result-less tokens. AND/OR cards light like other flow executions (exec events, $0 rows).
- ⟨f⟩ Quiescence-without-End: a done run with `endReached: false` shows an amber warning banner "finished at quiescence — End not reached" on the run monitor.
- ⟨f⟩ Drain legibility: executions that publish after End binds render as normal done executions; their tokens latch but no downstream wire animates (recorded, not routed).
- Node states, executions footer, loop badges, gate pips, ants: unchanged.

### §8 Persistence & migration — deltas

V17 re-seed bullet — extend with: ⟨f⟩ the hand-written re-expressions now include each template's End node — one `n_end` per graph wired from the v1-terminal agent's clean output (`webui.pass` where manualWebUiTesting exists, else `reviewer.pass` — the last agent in v1 linear order) — and rewire `reviewer.pass → manualTestsChecklist.await` where the checklist exists (same wire ids, only `to.port` changes; the `start` port died). ⟨f⟩ The three double-loop templates (wf_full, wf_provided-plan, wf_full-no-decompose — wf_no-clarify is NOT one: its `webui.review` is unwired, so its single `reviewer.review → implementer.fix` wire stays direct) route their two review loops through an OR valve `n_or`: the existing blocking wires RETARGET to `n_or.in1` (reviewer.review) and `n_or.in2` (webui.review), each keeping its wire id AND its own `maxCycles` (they remain the loop wires; gates hold before the valve), plus one NEW plain wire `n_or.out → n_impl.fix` — every agent input carries exactly one connection (V7). `NODE_ID_MAP`/`FB_WIRE_MAP` are unchanged: End/OR nodes take no overlays, no existing wire id moves, and the FB maps' targets (the blocking wires) still exist under the same ids.

Manifest v2 — ⟨f⟩ manifest node port lists include the synthesized `await` input on agent nodes and the and/or/end ports (the run monitor renders from the manifest). Preflight/done bookends stay UI chrome, not graph nodes — End is a graph node inside the graph, not a replacement for the "done" bookend chip.

### §9 Kill list — additions ⟨f⟩

The Await node everywhere (kind, palette pill, executor, EMBEDDED flow entry, fixtures) · `resolveAwaitOutType` + V8's AWAIT-resolution clause + the chained-await seen-set (die unshipped — NOT resurrected by the OR: `resolveOrOutType` is a NEW, OR-scoped, seen-set-guarded mechanism, the only resolution that ships ⟨f⟩) · `start` input ports in implementer/manualTestsChecklist sidecars, FIXTURE_PORTS, and their .md `## Ports` rows (the v1-compat shim's "void `start` dropped" mapping row becomes moot) · the "`any` allowed only on Await inputs" type note · ⟨f⟩ the ⟨e⟩ multi-wire machinery: the §3 freshest-binding-at-inputs rule, the readiness "any of its wires" clause, V18's wire-level clause, the composer add-on-drop rule.

### §10 Engine file map — delta

executor.mjs line reads: agent/clarify/and/or/end/combine executors ⟨f⟩ (rest unchanged; End/drain logic lives in scheduler.mjs).

### §11 Risks — addition

8. ⟨f⟩ End-drain legibility: an in-flight execution that publishes after End binds is recorded but routed nowhere — run-monitor copy must keep "recorded, not routed" legible (§7 drain statement); low exposure: the 8 builtin graphs always have an empty drain (terminals fire at quiescence).

### §12 Out of scope

Unchanged. (Multi-End templates are FORBIDDEN by V21, not deferred; no new exclusions.)

---

### Parity carryover

**start ≡ await (the 2026-08-10 dual-engine adjudication transfers unchanged).** The old `manualTestsChecklist.start` was: void, optional, non-loop, payload-less, single-wire by construction (dedicated port), wired `reviewer.pass → checklist.start`. The synthesized `await` port is: `any`-typed, optional, non-loop, payload-discarding, single-wire by rule (V7, like every input ⟨f⟩). For every scheduler decision the two are the same object: (1) first-run barrier — both are "a wired non-loop input whose token must be present", so the checklist's first execution still waits for reviewer.pass while its plan token sits latched; (2) re-fire — a fresh token on either re-fires the node under the standard freshness rule; (3) awaitAll counting — both count as wired non-loop inputs; (4) V18 — start was exempt as void ⟨d⟩(b), await is exempt as ⟨f⟩(c); (5) prompt/mode/A3 — both contribute nothing (start: void, no `as`, no directive; await: payload discarded, never in the Ports block). The ONLY formal difference is the declared input type (void vs any), which affects wire legality (V8) alone, never scheduling — and the rewired source (`reviewer.pass`, void) is legal into both. Therefore `reviewer.pass → checklist.await` is decision-for-decision identical to `reviewer.pass → checklist.start` in every one of the adjudication's 8 pipelines × 6 verdict scripts, and the A1–A4 parity result carries over without re-simulation. `implementer.start` is unwired in all 7 seeds, wf_default, and FIXTURE_FLOW, so its deletion is trace-invisible.

**End is trace-neutral on all 8 builtin graphs.** (1) End is a pure sink: zero outputs, so it can alter no readiness — nothing is downstream of it. (2) Its wire adds only fan-out to an existing clean output: source firing is unaffected (outputs fan out freely); it cannot create or join an SCC (no path leaves End), so loop classification and wire budgets are untouched; V18 ignores it (flow node); condensation-topo launch order gains one terminal vertex without reordering any existing pair. (3) Timing: in every adjudicated trace, the terminal clean output (`webui.pass` or `reviewer.pass`) fires exactly at v1's natural completion — nothing in flight, nothing ready. The End token therefore lands at quiescence: the "stop launching" decision stops nothing, the drain set is empty, and `'done'` resolves at the same instant, after the same agent executions in the same order producing the same files, gates, and budgets. The only additions are End's own $0 exec/token bookkeeping and `state.result`. (4) The quiescence-without-End warning is unreachable on the builtin graphs: under A4, a gate "continue" force-fires the source's clean side, so the terminal `pass` always eventually fires — naturally or forced — and reaches End; error runs fail-fast exactly as before. Plan parity tasks may cite (1)–(4) as the argument that the trace-identical mandate (A1–A4) holds for the End-bearing seeds.

**The OR valve is the Amendment-b Merge — b's adjudication is the operative lineage.** The three double-loop seeds now read `reviewer.review → or.in1`, `webui.review → or.in2`, `or.out → implementer.fix` — byte-for-byte the Amendment-b Merge topology: per-blocking-in-wire budgets and gates, a forward-the-freshest valve, one wire into the `loop:true` input. That shape's v1 parity was trace-verified BEFORE Amendment e replaced it, and the 2026-08-10 dry-run executed the Merge-shaped scheduler case green (plan v2 Task 4 case 11 note: "the equivalent Merge-shaped case ran empirically green — Merge was a forward-the-freshest valve, binding math identical"). Amendment e's direct-multi-wire adjudication applied to a shape that no longer exists and is superseded as rationale — but because its binding math was identical to the valve's (freshest-of-several resolved at one consumer), no trace changes either way: in every adjudicated script the two loops fire in different iterations, each blocking emission passes the valve as the single fresh delivery of that drain, per-wire budgets/allowances (A1) and gates act on the wires INTO the valve at the same publish instants as before, the forwarded token carries the same review-file path, and the implementer re-fires once per emission in the same order with the same fix payload. The valve adds one $0 engine execution and one token re-emission (new seq, same path) per loop iteration — bookkeeping invisible to agent executions, files, budgets, gates, and ordering. Same-drain double-blocking (both loops in one iteration) remains unconstructible in the seeds (webui runs only after reviewer.pass). Single-loop seeds (wf_no-clarify, wf_quick-fix, wf_clarify-implement, wf_clarify-quick-fix, wf_default) keep their direct `review → fix` wire, identical under b, e, and f. Plan parity tasks cite THIS lineage for the double-loop seeds — not e's.

---

### Consequences index (plan-visible)

- **Deleted (never ship):** `resolveAwaitOutType` (Task 2 interface), V8 AWAIT-resolution + chained-await seen-set (Task 3), `runAwaitExecution` + `await` executor entry (Task 8), Await palette pill / EMBEDDED flow entry (Tasks 15/16), kind `'await'` in V3, portsFnFor, plugin kind set; ⟨f single-wire⟩ the ⟨e⟩ multi-wire machinery — §3 freshest-binding at inputs, isReady's "any of its wires" clause, `existingWiresIntoInput`-accepting `canWire` legality (Task 15), V18's wire-level clause, the composer add-on-drop rule, Task 4 case 11's direct-multi-wire construction.
- **Deleted (existing surface):** `start` input on implementer + manualTestsChecklist (sidecars, FIXTURE_PORTS, .md `## Ports` rows, §5 table); shim's "void `start` dropped" row moot (Task 6 note).
- **New engine surface:** portsFn appends `{id:'await', type:'any', required:false}` LAST on every kind:'agent' node; kind `and` (arity≥2, `any` ins, STATIC `void` out, all-fresh synchronizer, payloads discarded); kind `or` (arity≥2, types RESOLVED FROM WIRING — `resolveOrOutType`, NEW, OR-scoped, seen-set guarded; any-fresh firing, binds the freshest, re-emits ITS payload with a new seq, drain-collapse to one emission — the b-era Merge valve); kind `end` (single-wire `result:any` input, no outputs, at-most-once execution); executor names `runAndExecution`/`runOrExecution`/`runEndExecution`; scheduler End-drain (stop launching, in-flight publish recorded, loop-delivery/gates skipped, pending asks withdrawn, error still fails the run); snapshot field `ended: null | {nodeId, executionId, seq, result}` (drain resume: launch nothing).
- **New/changed validation:** V7 RESTORED (universal single-wire input cardinality — agents incl. `await`, AND/OR/Combine ins, End.result); V22 RETIRED (subsumed by V7; number reserved); V21 (one End, `result` wired); V3/V8 (or.out resolution clause)/V12 (arity + or-homogeneity error)/V16/V18 (wire-level clause removed)/V19 (OR-input exemption, load-bearing for seed zero-warning) texts per this amendment; meta validation reserves port id `await` (both sides, registry skip+warn / store 400); `any` allowed on AND ins, OR ports pre-resolution, end.result, synthesized await.
- **Events/state:** flow execs `agentKey:null`, `kind:'cycle'`; End `done` exec carries `result:{type,path?,value?}`; state gains `result` + `endReached`; AND token events void/`path:null`; OR token events forward the bound payload (resolved type, path preserved, new seq); End emits no token.
- **Seed deltas — End pass (all 8 graphs, already applied to the seed JSONs):** add `n_end` (kind `end`, y = row y, x = last node + 300; wf_default +280 ⇒ x 1720/y 200; wf_full 2760, wf_no-clarify 2460, wf_provided-plan 2160, wf_full-no-decompose 2460, wf_quick-fix 1260, wf_clarify-implement 1860, wf_clarify-quick-fix 1560, all y 198) + terminal wire (new ids: wf_default w10 `n_review.pass→n_end.result`; wf_full w16, wf_no-clarify w13, wf_provided-plan w13, wf_full-no-decompose w14 from `n_webui.pass`; wf_quick-fix w6, wf_clarify-implement w10, wf_clarify-quick-fix w8 from `n_review.pass`); rewire checklist gates keeping wire ids, `to.port` start→await: wf_full w13, wf_no-clarify w11, wf_provided-plan w10, wf_full-no-decompose w11.
- **Seed deltas — OR pass ⟨f single-wire⟩ (the 3 double-loop graphs ONLY; verified against the seed files — wf_no-clarify's webui.review is unwired, so it and all single-loop seeds keep their direct `review → fix` wire):** add `n_or` (kind `or`, `config.arity: 2`, on the loop corridor below the main row, y 430 — wf_full x 2010, wf_provided-plan x 1410, wf_full-no-decompose x 1710, matching the seed files); RETARGET the two blocking wires to it, keeping ids and `config.maxCycles` — wf_full w12 `n_review.review → n_or.in1` + w15 `n_webui.review → n_or.in2`; wf_provided-plan w9 → in1 + w12 → in2; wf_full-no-decompose w10 → in1 + w13 → in2; add ONE new plain wire `n_or.out → n_impl.fix` — wf_full w17, wf_provided-plan w14, wf_full-no-decompose w15. NODE_ID_MAP/FB_WIRE_MAP unchanged by both passes (End/OR take no overlays; the FB maps' wire ids w12/w15, w9/w12, w10/w13 all survive as the valve's in-wires).
- **Pin-count updates (plan Task 5):** wf_full 11 nodes/17 wires; wf_no-clarify 9/13; wf_provided-plan 9/14; wf_full-no-decompose 10/15; wf_quick-fix 5/6; wf_clarify-implement 7/10; wf_clarify-quick-fix 6/8; wf_default 7/10. Structural pins reworded: "templates with checklist wire `reviewer.pass → checklist.await`"; "every template wires its v1-terminal clean output → `n_end.result`"; "double-loop templates wire `reviewer.review → n_or.in1` AND `webui.review → n_or.in2` (each with its own maxCycles 3) and `n_or.out → n_impl.fix`" — replacing the ⟨e⟩ "both directly into implementer.fix" pin.
- **Fixtures/tests:** FIXTURE_FLOW re-shaped (9 nodes/14 wires): a payload-forwarding md OR (`planner.plan → or.in1`, `refiner.plan → or.in2`, `or.out → n_check.plan`) + a static AND (`refiner.plan → in1`, `reviewer.pass → in2`, `out → n_check.await`) + an End node per V21 (every fixture template needs one); Task 4 case 4 rewritten as the OR/AND/await drain (payload forwarding + supersession through the valve); Task 4 case 11 REVERTS to the valve construction — two verdict nodes' blocking outs → `or.in1`/`or.in2` (per-wire maxCycles) → `or.out` → the consumer's `loop:true` input, blocking in different iterations ⇒ one re-fire per emission, same-iteration ⇒ ONE valve emission binding the freshest (the empirically-green Merge-shaped case, restored); Task 15 legality matrix: second wire into ANY input REJECTED (V7), OR homogeneity checked live; Task 26 manual mockup line: await → AND card; seed drift guard still zero-errors/zero-warnings (V18(c) + V19's OR exemption load-bearing).
- **UI:** palette Flow group Task · End · AND · OR · Combine (Task/End pills disabled once placed); Task+End preloaded on new canvases; empty-state copy updated; agent-card `await` gate row rendered as a bottom zone below the outputs (meta anchors unchanged; await anchor = (X, Y+74+24·(nInMeta+nOut)), agent H = 95.5+24·(nInMeta+nOut) — Task 15 geometry); `any` dot treatment + legend "○ = gate"; drop-on-await legality (any type); UNIFORM single-wire rejection — a drop on ANY wired input shows "already connected" (V7; the special "await takes one wire" chip is gone with V22 ⟨f⟩); OR rows caption resolved types; AND/OR arity inspector; End result chip + run-summary chip; `endReached:false` warning banner; palette pills list meta ports only.
- **Plugins:** kind set `{agent, task, and, or, combine, end}`; plugin graphs need one End (V21); mock-source fixture `workflows/mock-flow.json` gains task + end nodes.
- **Parity citations:** start≡await argument, End trace-neutrality argument, and the OR-valve = Amendment-b-Merge lineage (Parity carryover above; the double-loop seeds cite b's trace-verified Merge adjudication + the dry-run's empirically-green Merge-shaped scheduler case — NOT e's direct-multi-wire adjudication, whose shape no longer exists) — cite from `test/saved-pipeline-parity.test.mjs` and the Task 21/26 parity passes; no re-simulation required.
