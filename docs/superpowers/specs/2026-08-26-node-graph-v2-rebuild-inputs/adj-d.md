# Agent D — Run monitor v2 (adjudication, 2026-08-26; dev @ e6968e15)

## 0. Data flow
```
ENGINE (scheduler → orchestrator)
  exec{executionId,nodeId,kind,ordinal,status,agentKey,trigger,taskId?,result?}   (replaces `phase`)
  token{seq,from,type,path,forced,firedAt}     gate→audit only     question{..., wireId?}
  log/artifact/subagent/stepskills/stepgraphify  +{nodeId,executionId}
  state = { stepper:MANIFEST v2 (first `state`, orchestrator.mjs:512, before preflight — pinned by
            test/orchestrator-stepper-timing), steps[] = EXECUTION LEDGER (one row per execution),
            active[], endReached, result, warnings[], wireDeliveries{}, tokens{}, gate, subAgents[] }
        │ _persist (orchestrator.mjs:3947) → writeState (artifacts.mjs:985)
DB   pipelines.stepper (manifest JSON) · pipelines.outcome (JSON, NEW) · pipeline_steps (+cols, NEW)
     sub_agents.step_key = executionId · step_questions.step_key = executionId · pipeline_tasks unchanged
SERVER  WS: EVENT_NAMES (server.mjs:251) + exec, token (phase kept only while v1 engine lives)
        subscribe → replayEntry → sendStateSnapshot (:354/:370)  hello ← summarizeRuns (:458, stepper only)
        REST: /api/runs/:id (:1699) · /api/history/:key/:id (:1859) · /api/workspaces/:id/runs/:runId
              → readPipelineByKey (artifacts.mjs:1918) → rowToState: SAME state shape as live snapshot
        NEW: GET /api/history/:key/:id/artifact?rel= (+ workspace twin) — End result chip target
CLIENT  decorFromState(st,{live,now}) → ONE decor bag → ONE renderer (graph-view + run-decor):
        mode A Running LIST card (Detailed): auto-fit, static, click→detail
        mode B Running DETAIL .rd-graph: pan/zoom (engaged wheel), footer, qpanel scroll
        mode C History DETAIL .hd-graph: pan/zoom, footer, log links; v1 rows → chip strip
        CLI: exec lines + End summary
```

## 1. Manifest v2 (pipelines.stepper)
Builder buildGraphManifest(resolved) in workflows.mjs replacing buildStepperManifest (:468) and rewriteStepperForDecomposition (:518, dies). Called once in run() before first state emit (orchestrator.mjs:512) and by resume(); NEVER rewritten mid-run (manifestSig DOM swaps in onState app.js:1728 become no-op guard). Fan-out = ledger rows kind:'task' under the implementer node.
Shape (self-sufficient — History renders with registry absent):
```json
{ "version": 2,
  "template": { "id": "wf_full", "name": "Full" },
  "graph": {
    "nodes": [ { "id":"n_plan", "kind":"agent", "key":"planner", "x":600, "y":200,
                 "label":"Planner", "color":"violet", "icon":"<sanitized svg inner markup>",
                 "model":"claude-…", "effort":"high", "askQuestions":true, "awaitAll":false,
                 "ports": { "inputs":[{"id":"task","type":"json","required":true,"loop":false,"expands":false},
                                      {"id":"revise","type":"md","required":false,"loop":true,"expands":false}],
                            "outputs":[{"id":"plan","type":"md","when":"always"},
                                       {"id":"questions","type":"json","when":"always"}],
                            "await": true } },
               { "id":"n_or", "kind":"or", "key":null, "x":2010,"y":430, "label":"OR", "color":"", "icon":"",
                 "arity":2, "ports":{ "inputs":[{"id":"in1","type":"md"},{"id":"in2"}],
                                      "outputs":[{"id":"out","type":"md","when":"always"}], "await":false } } ],
    "wires": [ { "id":"w12", "from":{"node":"n_review","port":"review"}, "to":{"node":"n_or","port":"in1"}, "loop":true, "maxCycles":3 },
               { "id":"w17", "from":{"node":"n_or","port":"out"}, "to":{"node":"n_impl","port":"fix"}, "loop":false } ] },
  "bookends": { "preflight": true, "done": true } }
```
Decisions: loopInputs[] DROPPED (redundant with inputs[].loop); ports.await is a boolean, await port NOT listed in inputs; icon included (sanitized at registry load, ≤2 KB); OR out.type = resolved type; maxCycles only on loop:true wires (overlay merged); template{id,name} for CLI/History headers. Model/effort ride the manifest (Running D13); History ignores them (D5).

## 2. Decor data model & persistence
VERDICT: state.steps[] IS the executions ledger — no second executions array. Row = one execution, key === executionId (x:<nodeId>:<ordinal>[:p<P>t<T>]). Every dev derivation (durByNode :1431, costByNode :1442, stepSkillsFromSteps :1601, subsGroupsForRender :1557, 1 s tick :15475, 20 subagent-* suites) keys on steps[]/nodeId|cycle; writeState already delete-all-rewrites pipeline_steps from it. Row shape:
```
{ key, executionId, nodeId, kind:'cycle'|'task', ordinal, cycle:ordinal /*alias*/,
  agentKey|null, phase:agentKey /*legacy column*/, stepIndex:null,
  status:'start'|'done'|'error'|'stopped'|'paused', startedAt, updatedAt, endedAt,
  activeMs, runningSince, costUsd, sessionId, skills, graphifyCount,
  trigger:{wireIds[], freshPorts[]}, taskId?, parentExecutionId?, title?, phaseOrdinal?, result? }
```
state additionally: active:[{nodeId,executionId}], endReached, result ({type,path?,value?}|null), warnings[], wireDeliveries:{wireId:n} (scheduler counters — authoritative), tokens:{"<node>.<port>":{seq,type,path,firedAt}} (latest per port), gate:{wireId,fromNode,toNode,askId}|null. phase/cycle scalars written null during coexistence (v1 rows still fill them), die at cut-over.
Persistence: additive columns, no new table. pipeline_steps (db.mjs:263) gains execution_id, exec_kind, agent_key, ended_at, exec_trigger JSON, exec_result JSON, exec_meta JSON{taskId,parentExecutionId,title,phaseOrdinal}; pipelines gains outcome JSON {endReached,result,warnings,wireDeliveries,tokens}. INCREMENTAL_COLUMNS (:737). sub_agents.step_key/step_questions.step_key TEXT hold executionId (stepIndex null). Reconstruction: rowToState maps rows→steps[] (+fields), active=[], outcome spread onto state. All three REST reads go through readPipelineByKey, so one client decorFromState(st,{live,now,subsOf}) builds the bag for both surfaces. /api/runs (:1651) and hello stay list-shaped (stepper only); ledger via subscribe→sendStateSnapshot.

## 3. Node visual states
statusOf(node) precedence (old run-decor.mjs:200-225): step row paused|stopped → any error → in active → last done → (run resolved ? stopped : active); no rows → pending; on a done run, never-fired → skipped (End included when endReached:false). Stopped/error runs keep never-fired pending.
CSS (extend style.css:1258-1381 — reuse .nstat, nodeGlow*, wireFlow, sqPulse): pending .5; active agent-colour glow via --c (any number concurrent); done green pip; paused amber pip + glow; stopped red ring + × pip; NEW .is-error red ring + × pip, .is-skipped .35 + dashed border, .ngate amber "?" pip (top-right, pulsing; flow cards ink glow).
End card: pending until bound; then done pip + .xresult row: basename link when result.path, "— completed" for void. Click → showViewer (app.js:13747, #viewer-card index.html:1268) fed by NEW GET /api/history/:key/:id/artifact?rel= (+ /api/workspaces/:id/runs/:runId/artifact) serving only a rel_path present in the artifacts table for that pipeline (listArtifacts, artifacts.mjs:109) — same posture as /diff (server.mjs:2064). Engine records the End-bound path via recordArtifact. Live Running detail: chip becomes link once pipelineId + historyKeyForRun (app.js:13617) resolve. Same chip in History header meta.
Quiescence banner ("finished at quiescence — End not reached", amber): Running .rd-banners (index.html:490) + History .hd-banners (:649); one-line note in History Overview verdict banner. List card: no banner (End reads skipped).
Progress = done agent-nodes / agent-nodes: card .rc-meta gains `3/6`; compact chip STEP n/m → `3/6 done` (D15 forbids a bar, not a number); detail .rd-step → `3/6 done · Planner`; Overview ELAPSED sub-line same; History Overview DURATION sub-line → "9 executions · 2 loop deliveries" (replaces app.js:12790).

## 4. Executions footer, log filter, sub-agents
Footer per agent node once ≥1 row (borrow old run-decor.mjs footer()/CSS .xfoot/.xtoggle/.xsq/.xrow, old style.css:1195-1214): collapsed 26 px = 7 px squares + "3 runs · $1.12" + chevron; expanded rows 22 px: led · label (`cycle 2 · fix` from trigger.freshPorts ∩ loop inputs, or task title for kind:'task') · right `2m10s · $0.42`; flow nodes no cost pill. [D proposed overlay footer; main-loop adjudication: footer grows the card via view.setFooter → nodeSize (Agent C), no re-route, anchors unchanged.] One node expanded per surface (accordion); state in-memory Map<runId, nodeId> per surface. Header dur·cost = sum over rows (keeps .run-node[data-id] .dur hook app.js:15475).
Log tagging: _log (orchestrator.mjs:3866) gains executionId; cycle = ordinal; stepIndex null. Filter (D9 lock: one markup, cloned): in #run-card-tpl .log-filters (index.html:432) the .log-f-step select is RE-PURPOSED as the node select (options = manifest nodes that logged; v1 records fall back to stepIndex "step N") + one hidden chip .log-f-exec ("Implementer #2 · task 3" with ×). log-filter.mjs gains node + execution axes (rec.nodeId / rec.executionId; attribution-less lines only under "all"); step axis retained until cut-over. Footer row click → filter.execution = executionId (+ scroll to log) on Running detail and History; manual node/cycle choice clears the chip. Graph node click (History wireHdGraphLogLinks :11706 keyed data-log-source) → data-node-id → node select; LEGACY_PHASE_SOURCE (:11685) dies with v1. cycleSeparatorBefore keeps working on ordinal.
Sub-agents: subagent events (orchestrator.mjs:3360) gain executionId; stepKey = executionId. subsByNodeCycleArrays (:1524) keys by executionId when present (else nodeId|cycle); cycleAwareLabel labels from ledger ("Implementer #1 · Add schema"). Node-level .fan squares stay.

## 5. Hosting
A — Running Detailed card (.rc-detailed > .run-flow-wrap > .run-flow, index.html:430): FIXED HEIGHT 300 px (today ≈224 px: .run-flow padding 66+52 style.css:1265 + .col 28 + node ≈78; v2 cards 110–215 px, loop corridor y 430 ⇒ 300 holds two rows at fit zoom). Fit both axes into (width−32, 300−32), zoom clamp 0.3–1.0; wider than floor → overflow-x:auto (native scroll, no wheel capture). Non-interactive: no pointer handlers, pointer-events:none on world; click anywhere → location.hash = running/<id> (extends buildRunCard go() :14090). Re-fit on ResizeObserver of wrap. Compact density: no graph.
B/C — detail pages (.rd-graph :494, .hd-graph :654): height = clamp(360px, fitted world height + 48px, 600px), auto-fit on build, zoom clamp 0.3–1.6 (composer 0.4–1.6; wf_full ≈2980 world px vs ≈1130 px body). WHEEL POLICY: plain wheel pans only while the graph is ENGAGED (focus: pointerdown inside, or Tab); ⌘/Ctrl+wheel and pinch always captured over the graph; Escape / outside pointerdown disengages; hover hint chip "click to pan · ⌘+scroll to zoom" while not engaged. One flag on the shared nav controller (wheelPan:'always'|'engaged'), composer stays 'always'. Space+drag / middle-drag pan. .rd-graph.settled (paintRdTerminal :13646) keeps disabling ants.

## 6. Ants, loop badges, gate pip
Ants: .wire-live (reuse wireFlow style.css:1372) on union of trigger.wireIds of active executions; none on resolved runs; drain publishes after End animate nothing. Loop badge: amber `N×` at the loop wire's bow from state.wireDeliveries[wireId], wire.loop only, N≥1, title "2 of 3 cycles" — replaces composer's ≤N budget badge in run mode. Gate pip: state.gate.fromNode; click → card: scrollIntoView + focus .qpanel (index.html:436); detail: .rd-questions (:495). History never has a pending gate. renderGateBody (:4438) intro gains "on Reviewer → Implementer (w9)".

## 7. Legacy v1 rows and coexistence
Branch point: exactly one — paintGraphFor(host, stepper, decor): stepper?.version === 2 → v2 renderer; else existing v1 painters. Callers: paintStepper (:14296), paintRdGraph (:14916), openHistDetail (:10875-10876). Likewise statusPill (:13982), runDotClass (:13945), runStepLabel (:14307), rdStateCopy (:13305) branch on version → v2 helpers activeNodes(r) (colour/label of most recently started active node; ≥2 → "2 agents running"). v2 runs never receive phase [main-loop note: Agent A's shim DOES emit derived phase; the branch on stepper.version makes the shim irrelevant for surfaces ported in P5 — shim serves un-ported consumers only]. EVENT_NAMES adds exec, token, keeps phase while v1 lives; wireRun (:537) treats exec like phase for entry.status.
At kill-list: History rows version 1/absent → paintLegacyStrip (~40 LOC: .run-strip > .rchip.is-<status> "Planner · 2m · $0.40", statuses from step rows by nodeId else phase→uiPhase; old app.js:765-800 as source). Deleted: app.js 842-943 (normalizePhase, CLIENT_DEFAULT_STEPPER, locateInManifest, nodeKindFor, advanceRun), 1019-1215 (v1 column renderer), run-mode arms of composerPaintWires (:2353), 10606-10665 (histNodeCycle, paintHistStepper, histReachedCell), 11685-11693, 14147-14154 (runStatusOf), 14273-14286 (frontier scan), 14307-14338, phaseKey switches (:13953, :14000), r.phaseKey/cycle/phaseStatus/nodeStatus/nodeCycle/maxCellIdx in makeRun (:1239), style.css v1 graph block 1258-1381 except shared keyframes/.nstat/.fan re-homed, buildStepperManifest/rewriteStepperForDecomposition, _nodeStep phase emit (orchestrator.mjs:3053), CLI phaseLabel (:245), step filter axis, tests ui-run-graph*, ui-stepper, ui-*-stepper-seed, stepper-rewrite, ui-run-flow-css, ui-phase-label.

## 8. CLI (src/cli/worca-cc.mjs)
Replace orch.on('phase') (:375) with exec; phaseLabel (:245) dies. Lines (labels/wire sources from manifest, ids never shown):
```
▶ Implementer #2 · fix ← Reviewer            start (loop port from trigger.freshPorts, source = wire.from node)
  ▶ task 3/7 · Add schema                     kind:'task' sub-execution (indented)
✓ Implementer #2  1m03s · $0.12               done   (dim `· AND` / `· OR → Implementer` for flow nodes)
✗ Reviewer #1  error                          error
? Loop gate · Reviewer → Implementer  3/3 cycles used   (askGate header, :328)
⏹ End ← Reviewer.pass → plan-review.md        End bound
```
Summary (:450-463): `Pipeline complete.` then `Result: <path>` or amber `Finished at quiescence — End not reached`, then `9 executions · 12m active · $1.23`, then the directory line.

## 9. Consumers that must change (anchors + constraint)
- orchestrator.mjs :369-396 state shape, :3027 _nodeStep→_execStep, :3053 phase emit → exec, :2853 question +wireId, :3360 subagent +executionId, :3866 _log +executionId, :2944 _stepKeyFor dies.
- workflows.mjs :468/:518 → buildGraphManifest. artifacts.mjs :985 writeState (+cols), toPipelineRow (+outcome), rowToState/stepRowToStep (+fields). db.mjs :56 version, :263 DDL, :737 healing.
- server.mjs :251 EVENT_NAMES, :537 wireRun status arm, new artifact route beside :2064 (same key regex, no user-supplied paths). ask/follow.mjs:61 and chat/command-router.mjs:184 read phase/state.phase → switch to exec/active at cut-over (keep phase until then).
- app.js :554 router (+exec,token → onExec/onToken; phase kept), :1239 makeRun (+ledger fields), :1307 onPhase (v1 only), :1685 onState, :1769 onSubagent (+executionId), :1425 stepBucketKey, :1524/:1557 grouping by executionId, :1656 labels, :4002 onLog (+nodeId/executionId), :4059/:4103 facets, :9463-9480 buildLogFilterBar/readLogFilterFrom (+node/exec), :10571 __setLogSource → __setLogFilter({node|execution}), :11706 wireHdGraphLogLinks (data-node-id), :12790 History stats line, :13224 buildRdLogs, :13305/:13321 rdStateCopy/rdOvStats, :13945/:13982 dot/pill, :14070 buildRunCard, :14296 paintStepper, :14362 paintRunCard (+progress), :14740 paintRunDetail, :14916 paintRdGraph, :14937 paintRdHeader — only .rd-meta segment list changes; C16 disabled-rule block and .rd-pause single control (C6) untouched; RD_TERMINAL once at :14616, :15136 renderPipelineTabs, :15475 tick.
- index.html :430/:494/:654 hosts, :432 shared filter markup (+chip, D9), #viewer-card reused. style.css :2376-2390 density rules untouched; new .rc-detailed .run-flow-wrap{height:300px}.
- Locks: D5 History never renders model/effort; D13 compact model line from active node's manifest model; D15 numeric chip; History D7 and Running D17 are scope fences superseded at exactly two seams (graph host painter, log-filter axes).

## 10. Cost
Engine/state/persistence ≈350 LOC + ~8 test files; run-decor.mjs ≈500 + host adapter ≈250 + CSS ≈150; app.js ≈400 changed; log-filter +50; server route +40; CLI +80; ~15 suites. Fits two plans: "ledger + events + persistence" (engine-side, dark under v1 painter) and "run monitor v2" (UI + CLI).
