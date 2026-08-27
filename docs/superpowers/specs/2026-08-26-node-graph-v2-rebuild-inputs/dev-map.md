# Worca v1 pipeline/workflow system — structural map (dev @ e6968e15, 2026-08-26)

## 1. Template / workflow model

**Shape.** A WorkflowTemplate is *topology + per-node defaults*, nothing more:
`{ id, name, version:1, domain, origin, steps: Array<Array<{id,key,defaults?}>>, feedbacks: Array<{id,from,to}>, createdAt, updatedAt }` — `src/core/workflows.mjs:206-218` (`rowToTpl`). `steps` is a **matrix**: outer array = ordered *stages*, inner array = nodes run **in parallel** in that stage. There is no free-form edge list; forward edges are implicit stage adjacency. `feedbacks` are the only explicit edges (back-edges/self-loops). `maxCycles` is **not** on the template — it comes from per-project run-config, defaulting to `DEFAULT_MAX_CYCLES = 3` (`workflows.mjs:25`, applied at `:451`).

**Built-in.** `DEFAULT_WORKFLOW` (`workflows.mjs:91-109`), id `wf_default`, domain `coding`, 5 single-node stages `s_clarify/clarify → s0_0/planner → s1_0/refiner → s2_0/implementer → s3_0/reviewer`, feedbacks `fb_refine (s1_0→s1_0)` and `fb_review (s3_0→s2_0)`. Frozen, never persisted; `readWorkflow` special-cases it (`:277-280`) and it cannot be deleted (`:341`) or hold defaults (`:312`).

**Storage** (`src/core/db.mjs`, `SCHEMA_VERSION = 22` at `:56`):
- `workflows(id, name, version, steps JSON, feedbacks JSON, created_at, updated_at)` — `db.mjs:185-193`; `+ domain TEXT` (SCHEMA_V9, `:489`), `+ origin TEXT` (`'plugin:<name>'` | NULL); both listed in `INCREMENTAL_COLUMNS` `db.mjs:739`.
- `project_config(project_key, steps JSON, custom_models JSON, active_workflow_id, extra JSON)` — `:199-205`. `steps` is the **legacy per-role** overlay (only applied to `wf_default`).
- `config_workflow_nodes(project_key, workflow_id, node_id, model, effort, fan_out)` — `:209-217`; `+ ask_questions INTEGER` (SCHEMA_V11, `:717-720`).
- `config_workflow_feedbacks(project_key, workflow_id, fb_id, max_cycles)` — `:221-227`.
- Run state: `pipelines` `:234-258` (incl. `stepper` JSON manifest, `resume_point` JSON), `pipeline_steps` `:263-279`, `pipeline_events` `:283-290`, `clarify` `:294-299`, `reviews` `:303-310`, `artifacts` `:325-331`, `sub_agents` `:352-370`, `pipeline_phases`/`pipeline_tasks` `:391-415`, `step_questions` `:505-528`.

**Overlay merge** — `resolveWorkflow` (`workflows.mjs:371-456`). Precedence per node: `config_workflow_nodes` (per-nodeId) → legacy `project_config.steps` (per-role, `wf_default` only, `:380`) → template `node.defaults` → registry sidecar → hard default (`:423-435`). Effort never inherits across a model change (`:427`). Output = **ExecutablePlan** `{id,name,steps:[[Node]],feedbacks:[{id,from,to,maxCycles,gate:'hasBlocking'}]}` where Node adds `nodeId,key,uiPhase,runnerType,agentPrompt,tools,consumes,produces,connectsTo,fanOut,askQuestions,loopSource`. Workspace runs substitute `reviewer → workspaceReviewer` here (`:399`); `workspaceScanner` is rejected as a node (`:402`).

**Validator rules** (`src/core/workflow-validator.mjs`) — messages are plain strings, **no error codes**:

| # | line | message |
|---|---|---|
|1|`:32`|`workflow must be an object with a steps array` (early return)|
|2|`:35`|`workflow must have at least one step`|
|3|`:44`|`step ${i} is empty (a step must contain at least one node)`|
|4|`:50`|`step ${i} contains a non-object node`|
|5|`:55`|`step ${i} has a node with a missing or blank id`|
|6|`:58`|`duplicate node id "${id}"`|
|7|`:65`|`node "${id}" has a missing or blank key`|
|8|`:67`|`node "${id}" has key "${key}" which is not in the agent registry`|
|9|`:78`|`feedbacks contains a non-object entry`|
|10|`:82`|`a feedback has a missing or blank id`|
|11|`:84`|`duplicate feedback id "${fid}"`|
|12|`:92/:93`|`feedback "…" from/to "…" does not exist`|
|13|`:100`|`feedback "…" target step (N) must precede its source step (M)` (self-loop `from===to` legal)|

Warnings (never block): unreachable `consumes` `:123`, multi-producer of `code`/`plan` in one stage `:133`, stale same-step sibling `:142`, undeclared custom channel `:163`, `connectsTo` governance on forward edges `:176` and feedback edges `:181`.

**Plugin templates** — `src/core/plugin-workflows.mjs`: `importPluginWorkflows(name, versionDir)` `:44` reads `<versionDir>/workflows/*.json`, validates against the merged registry `:68`, upserts id `wfp_<plugin>_<slug>` with `origin='plugin:<name>'` `:74-86`. `removePluginWorkflows` `:105` deletes by origin behind a reference guard (`project_config.active_workflow_id`, non-archived `pipelines.resume_point.workflowId`) throwing `ReferencedError` `:133`. `referencedPluginAgents` `:150` scans user/other-plugin templates for this plugin's agent keys.

## 2. Execution engine

**`src/core/orchestrator.mjs`** — one `EventEmitter` class (`:233`), factory `createOrchestrator` `:229`. Public: `getState` `:400`, `answer` `:411`, `stop` `:423`, `pause` `:446`, `run` `:474`, `resume` `:810`.

`run()` order: resolve registry + `resolveWorkflow` `:492-497` → force `fanOut` on `FANOUT_ELIGIBLE` (`:139`: planner/refiner/implementer/planReviewer/workspaceReviewer) when workspace `:505-511` → `_preflightAgentKeys` `:514`/`:1923` → `buildStepperManifest` → emit `state` `:512` → preflight (`_loadAgentPrompts`, `detectTools`, `resolveStepModels`) `:516-524` → `resolveTaskInput`/`createPipeline` `:539-548` → run-root + worktree(s) `_setupRunRoot` `:1097` → `_dispatch(plan)` `:706` → done/paused/stopped/error branches `:708-793` → `finally` teardown `:797-806`.

**Main loop — `_dispatch` `:1961-2140`.** Builds `nodeStepIndex`, `fbByFrom` (`:1985-1993`), `loopState{fbId:{cycle}}`, `stepCycle[]`, and the **typed channel bus** `:2002-2026` (`userPrompt, clarify, decomposition, plan, review, checklist, code, workspace`). Seeds entry channels from the prompt `:2044-2052`. `while (i < steps.length)`: `_runStep` → for each feedback originating at `i`, `_loopFired` (`:2807`, gates on the *from* node's review having blocking issues) → if `cycle < maxCycles` rewind `i = fb.toIdx` and bump `stepCycle[toIdx..i]` `:2094-2105`; else `_gate` the user `:2110-2124`. Every boundary persists a resume point `:2131`.

**`_runStep` `:2176-2227`**: single node → direct; >1 → `Promise.all` (parallel), each reading a **frozen bus snapshot** `:2210`. Results merge in node order; `_publishNodeIo` `:2787`; reviews persisted `:2218`; `_stageWorkingTree` once after producers of `code` `:2225`.

**Node execution**: `_runNode` `:2403` → `_nodeCtx` `:2971` + `_bindNodeIo` `:2726` (channels `bindInputs`/`allocate`/`legacyFields`) → `_runNodeAttempts` `:2437` (recoverable-error retries, `RECOVERY_MAX_AUTO_ATTEMPTS` `:144`) → `_runOnce` `:2467` dispatching `this._runners[node.runnerType]` → `_questionsLoop` `:2517` (ask-then-resume, `MAX_QUESTION_ROUNDS = 3` `:150`).

**Clarify**: `_runClarifyNode` `:2704` calls `runClarify` then `_ask({kind:'clarify'})`; answers normalized `:4345` and written to the `clarify` table.

**Decomposition / fan-out**: `_runStep` detects `implementer` + `bus.decomposition` + no review `:2181-2188` → `_runDecomposedImplement` `:2249` (phases sequential, tasks parallel) using synthetic nodes from `decomposedTaskNode` `:190` (`nodeId = s_impl_p<ordinal>_t<n>`), manifest rewritten by `rewriteStepperForDecomposition` (`workflows.mjs:518`). `src/core/fanout.mjs` is *orchestrator-owned* IO concurrency only: `fanoutCap()` `:17` (`WORCA_FANOUT_CAP`, default 4), `mapWithCap` `:34` (input-ordered results).

**Workspaces / worktrees**: `workspaces.mjs` is pure registry CRUD (`workspaceKey` `:88`, `readWorkspace` `:172`). The orchestrator holds `_setupRunRoot` `:1097`, `_resolveMemberBranches` `:1352`, `_buildWorktreeGraphAll` `:1419`, `_teardownWorktreeAll` `:1509`, `_teardownRunRoot` `:1575`, `_commitWork` `:1814`. `worktree.mjs`: `createWorktree` `:234`, `removeWorktree` `:319`, `createDetachedWorktree` `:352`, `snapshotWorktreePatch` `:413`, `sweepRunRoots` `:503`.

**Resume**: `_buildResumePoint` `:2141` serializes `{version,kind:'boundary'|'node'|'gate', stepIndex, stepCycle, loopState, bus, stepModels, workflowId, guardrailsId, plan, nodes[{nodeId,key,sessionId}], gate, toolInstruction}`; `resume()` `:810` replays it, re-attaching claude sessions for the interrupted step only (`:2054-2058`).

**Mock**: `WORCA_MOCK`/`ORCH_MOCK` at `orchestrator.mjs:283`, `claude-runner.mjs:237`, `plugin-shim.mjs:71`, `chat/channel-host.mjs:45`, `ui/server.mjs:1054`, `src/cli/worca-cc.mjs:733`.

**Events → UI**: emitted via `_emit` `:3903`; the bridge subscribes exactly `EVENT_NAMES = ['phase','log','question','artifact','state','done','error','subagent','stepskills','stepgraphify','title']` (`ui/server.mjs:251`), tagged with `runId` in `wireRun` `:515-560` and broadcast over WS `:380`. Payloads: `phase {phase,cycle,status,nodeId}` (`orchestrator.mjs:3053`), `state` = full `this.state` (shape at `:369-396`: `{id,title,status,phase,cycle,steps[],stepper,tools,branch,branches,checkpointRefs,totalCostUsd,totalActiveMs,subAgents[]}`), `question {id,kind,questions,issues,recovery,agent,nodeId}` `:2853`, `done {status,pipelineDir,reason?}`, `artifact {kind,path}` `:3882`, `title {title,provisional,pipelineId}` `:3942`.

**Persistence**: `run-context.mjs:1012 assembleRunContext` (CLAUDE.md/MCP/skills assembly), `run-manifest.mjs:48 writeRunManifest` (`run.json`, `rmGuarded` `:98`), `run-log.mjs:23 createRunLogWriter` (`live-log.ndjson`), state via `artifacts.mjs#writeState` (`_persist` `:3947`).

**`src/core/phases.mjs`** — prompt assembly + one function per agent: `buildSystemPrompt` `:293`, `taskHeader` `:449`, `runOpts` `:397`, `fanOutDirective` `:122`, `workspaceFanOutDirective` `:183`, `questionsPromptBlock` `:349`. Phases: `runClarify` `:607`, `runPlannerPlan` `:637` (writes plan md), `runRefiner` `:674` (plan + review JSON), `runDecomposer` `:712`, `runImplementer` `:822` (implement|fix mode), `runReviewer` `:852` (git-diff review md+json), `runPlanReviewer` `:901`, `runWorkspaceReviewer` `:944`, `runWorkspaceScan` `:992`, `runManualTestsChecklist` `:1063`, `runManualWebUiTesting` `:1108`, `runGenericProducer` `:1192`, `runGenericVerifier` `:1225`.

**`src/core/runners.mjs`** — exactly two runner types (`producer` `:54`, `verifier`), plus `clarifier` accepted by the registry (`agent-registry.mjs:31`). `producer` switches on `ctx.node.key` `:55`; `verdict()` `:38` maps a protocol review to `status: 'blocked'|'ok'`.

**`src/core/agent-registry.mjs`** — sidecars `agents/<key>.meta.json` paired with `agents/<key>.md`. `DEFAULT_AGENTS_DIR` `:28`, `DEFAULT_SPEC` (built-in channel/governance per key) `:50-75`, `normalizeMeta` `:189`, three layers built-in > user (`userAgentsDir` `:257`) > plugin (`pluginAgentLayers` `:272`), merged by `loadAgentRegistry` `:358` (collisions skipped). Built-in keys (11): `clarify, planner, refiner, decomposer, implementer, reviewer, planReviewer, manualTestsChecklist, manualWebUiTesting, workspaceReviewer, workspaceScanner` (last two `scope:'workspace-only'`). `registryToSteps` `:415` derives the legacy per-role list. Custom agents: `agent-store.mjs` (`createAgent` `:54`, `updateAgent` `:77`, `deleteAgent` `:118`) and LLM drafting via `agent-gen.mjs:28 createAgentGen`.

## 3. Composer UI

**`ui/public/composer-core.mjs`** (DOM-free, unit-tested): `topology()` `:14` re-stamps canvas-local ids to contract ids `s<step>_<member>` and mints `fb_<n>`; `metaLine` `:34`; `distinctAgents` `:44`; `EMBEDDED_AGENTS` fallback palette `:57-102` (**duplicates 8 built-in agent metas including icons/connectsTo**); `mergePalette` `:107`; `groupPaletteByDomain` `:136`; `defaultTopologyFromTemplate` `:151`; `SOFT_PRESEEDED` `:176`; `canConnect` `:186` (hard `connectsTo` gate + soft produces/consumes warning).

**`ui/public/app.js` ranges**
- 834–943 — steps tracker / `normalizePhase` (`:842`), legacy fallback manifest `:864`.
- **944–1215 — run/history node graph**: `manifestFor` `:876`, `runNode` `:1019`, `runGraphNodeIds` `:1061`, `buildRunGraph` `:1071`, `loopCounts` `:1120`, `manifestStepsForWires` `:1131`, `paintRunGraph` `:1140`.
- 1216–1303 multi-run engine; 1304–1808 per-run event handlers (`onPhase` `:1307`, `onStepSkills` `:1792`).
- 1809–1882 per-step model/effort accordion state.
- 1883–1934 composer API wrappers (`listWorkflows` `:1896`, `saveWorkflow` `:1917`, `deleteWorkflow` `:1928`).
- **1935–2648 — Pipeline Composer (template editor)**: `initComposer` `:1991`, palette `composerBuildPalette` `:2051` / filter `:2095` / pill `:2150`, **stage/node cards** `composerNodeEl` `:2192`, `composerMakeStrip` `:2224`, `composerMakeCol` `:2246`, `composerRefresh` `:2278`, `composerRemoveNode` `:2300`, **feedback wires** `composerAddFeedback` `:2309`, `composerToggleSelf` `:2323`, link mode `:2335-2352`, `composerPaintWires` `:2353` (shared with the run graph via `window.__np` `:1205`), `composerReset` `:2441`, `composerSave` `:2462`, read-only preview `:2514-2552`, saved list `composerRenderList` `:2561`.
- **2649–3075 — New-pipeline pure helpers**: `buildNodeConfigRows` `:2669` (4-layer resolution), `pruneNodeSelection` `:2783`, `buildFeedbackRows` `:2813`.
- **3076–3831 — "New pipeline" run-setup view**: hard-coded fallback default workflow `:3036-3055`, `loadWorkflowsInto` `:3135`, `refreshNewPipelinePickers` `:3162`, `renderWorkflowConfig` `:3228`, `renderFeedbackRows` `:3470`, writers `saveStep` `:3556` / `saveNode` `:3624` / `saveFeedback` `:3646` / `saveActiveWorkflow` `:3667`.
- 7401–7571 run submit (`POST /api/run` `:7506`, `workflowId` `:7438`).
- **10606–10671 — history graph**: `histNodeCycle` `:10606`, `paintHistStepper` `:10619`, `histReachedCell` `:10653`.
- 15310–15320 router `VIEW_NAMES` includes `'composer'`.

**`index.html`**: `<section class="view" data-view="composer">` `:1062-1118` — `#composer-reset`, `#composer-agent-filter`, `#composer-palette`, `#composer-canvas-wrap`, `#composer-decomposer-hint`, `.flow#composer-flow`, `svg.wires#composer-wires`, `#composer-link-banner`, `#composer-clear`, `#composer-save`, `#composer-saved-list`. Run-setup view `:121-351` (`#workflowSelect` `:210`, `.agents-wf#agentsWorkflow` `:302`, `#agentsPromote` `:305`). Graph hosts: run card `.run-flow-wrap > .run-flow` `:430`, running detail `.rd-graph` `:494`, history detail `.hd-graph` `:654`.

**`style.css`**: composer block `:1032-1185` (`.palette`, `.flow`, `.wires`, `.strip`, `.col`, `.node`, `.node .nx/.loop/.selfloop`, `.link-banner`, `.saved-list`); run-graph block `:1258-1381` (`.run-flow*`, `.nstat`, `.is-pending/-active/-done/-paused/-stopped`, `.fan .sq`, `.loop-badge`, `.wire-dim/.wire-live`).

## 4. Server API (`ui/server.mjs`)

| Method + path | line | reads/writes |
|---|---|---|
|`POST /api/run`|`972`|validates `workflowId` via `readWorkflow` `:1062`, guardrails `:1077`, mints run, `createOrchestrator`, `wireRun`|
|`POST /api/answer` / `/api/stop` / `/api/pause` / `/api/resume`|`1437`/`1453`/`1469`/`1634`|`orch.answer/stop/pause`; resume rehydrates `resume_point`|
|`GET /api/runs`, `/api/runs/:id`|`1651`,`1699`|live run summaries + state|
|`DELETE /api/runs/:id`|`2086`|`pipeline-delete.mjs`|
|`GET /api/history`, `/api/history/:key/:id[/log|/diff]`|`1793`,`1859`,`1875`,`2064`|persisted pipelines + stepper manifest|
|`GET /api/workflows`|`3116`|`[DEFAULT_WORKFLOW, ...listWorkflows()]`|
|`GET /api/workflows/:id`|`3126`|`readWorkflow`|
|`POST /api/workflows`|`3136`|validates node `defaults` against model catalog `:3155`, `validateWorkflow` `:3161`, `writeWorkflow` `:3164`|
|`PATCH /api/workflows/:id/defaults`|`3177`|`setWorkflowNodeDefaults` + `workflowNodeDefaults`|
|`DELETE /api/workflows/:id`|`3200`|`deleteWorkflow`; refuses `wf_default` `:3203`|
|`GET /api/config`|`2687`|`readRunConfig` + `listModels` + `agentSteps()`|
|`POST /api/config`|`2721`|`setStep` (legacy per-role)|
|`PATCH /api/config`|`2751`|`setNodeModel`, `setFeedbackCycles`, `setActiveWorkflow`|
|`DELETE /api/config/workflow`|`2792`|`resetWorkflowConfig`|
|`GET /api/agents`|`3907`|`listAgents()` + `collectChannelIds`; filters `workspace-only` unless `?all=1`|
|`POST /api/agents/generate` / `/stop`|`3975`/`4004`|`createAgentGen`, `agentgen-*` WS family|
|`GET/POST/PUT/DELETE /api/agents[/:key]`|`4014`,`4026`,`4036`,`4047`|`agent-store.mjs`|
|`GET /api/guardrails*`|`3231-3296`|guardrail sets|
|`POST /api/plugins/install`, `/:name/update`, `DELETE /:name`|`4192`,`4220`,`4253`|triggers `importPluginWorkflows` / `removePluginWorkflows`|

## 5. Tests

438 files. Grouped (names only): **workflow model** — `workflows.test.mjs`, `workflows-db.test.mjs`, `workflows-questions.test.mjs`, `workflow-node-defaults.test.mjs`, `workflow-validator.test.mjs`, `api-workflows.test.mjs`, `api-workflows-warnings.test.mjs`, `api-workflow-defaults.test.mjs`, `plugin-workflows.test.mjs`. **Orchestrator/engine** — `orchestrator-{custom-agent,db-authoritative,decompose,guardrails,heartbeat,partial-diff,pause,questions,recovery,results,resume,session-capture,stepper-timing,title,workspace,worktree}.test.mjs`, `pause-resume-e2e`, `server-pause-resume`, `cli-resume`, `clarify.test.mjs`, `clarify-node.test.mjs`, `stepper-rewrite`, `decomposition-db`, `decomposed-{error-line,phase-abort}`, `preflight-missing-agent`. **Runners/phases/channels** — `runners.test.mjs`, `runners-generic`, `runner-{args,cost,decomposer,error-surface}`, `phases-{agent-body,implementer-task,prompt,questions,workspace}`, `channels*.test.mjs` (6), `fanout{,-api,-trigger}`, `implementer-fanout`, `workspace-runners`, `workspace-channel`, `graph-build`. **Registry/agents** — `agent-registry*.test.mjs` (7), `agent-store`, `agent-gen`, `agents-api`, `agents-meta`, `api-agents-domain`, `ui-agent*`. **Composer/run-graph UI** — `composer-ui.test.mjs`, `ui-composer{,-hint,-legend,-palette-desc,-palette-filter,-steptag,-wires}.test.mjs`, `ui-run-graph.test.mjs`, `ui-run-graph-paint`, `ui-stepper`, `ui-hello-stepper-seed`, `ui-server-stepper-seed`, `ui-history-graph-log-link`, `ui-phase-label`, `ui-agents-accordion`, plus ~25 `ui-subagent-*`/`subagent-*`.

## 6. Ask Worca chat subsystem

`src/core/ask/` and `src/core/chat/` are **independent of the pipeline engine**: neither imports `orchestrator.mjs`, `phases.mjs`, `runners.mjs`, `fanout.mjs`, `run-context.mjs` or `run-manifest.mjs`. Ask shares lower-level modules: `claude-runner.mjs` (its own spawn path, `ask/spawn.mjs`), `worktree.mjs` (own detached `ask_worktrees` table), `workspaces.mjs`, `artifacts.mjs`, `config.mjs`, `guardrails.mjs`/`guardrail-store.mjs`, `agent-registry.mjs`, `results.mjs`, `git-info.mjs`. Its only *workflow* coupling is read-only catalog/validation: `ask/catalog.mjs:9,45-57` (`listWorkflows` + `DEFAULT_WORKFLOW`, shaped for the LLM via `shapeWorkflow`) and `ask/proposal.mjs:9,104-106,160` (validates a proposed `workflowId`, defaults to `'wf_default'`). Run *launch* from a proposal goes through the same `POST /api/run` (`server.mjs:972`), and `ask/follow.mjs:3` attaches to an orchestrator's `state`/`phase`/`done` events by duck-typing — no import. **v2 must keep**: `readWorkflow`/`listWorkflows` signatures, `DEFAULT_WORKFLOW` (`{id,name,steps,feedbacks}` walkable by `shapeWorkflow`), and the 11-name event vocabulary.

## 7. Plugins

`plugin-api.mjs:12-13`: `WORCA_PLUGIN_API = 2`, `WORCA_PLUGIN_APIS = [1,2]`; manifests declare `engines.worca-cc-api` as a range checked by `plugin-manifest.mjs:47` (`apiSatisfies`). A plugin ships `agents/<key>.md` + `agents/<key>.meta.json` pairs (validated `plugin-manifest.mjs:402-424`: key regex, key===stem, sibling `.md` required), `skills/<name>/SKILL.md` `:426-434`, and `workflows/*.json` that may reference **only that plugin's own agent keys** `:436-447`. Entry into the registry: agents through the third layer `pluginAgentLayers()` (`agent-registry.mjs:272`, enabled plugins only, lexicographic collision order, `origin='plugin:<name>'`, paths through `current/`); workflows through `importPluginWorkflows` at install/update (`plugin-workflows.mjs:44`) into the same `workflows` table with `origin`.

## Coupling hot-spots (v1 concepts hard-coded outside the engine)

1. **`ui/public/app.js:3036-3055`** — a verbatim duplicate of `DEFAULT_WORKFLOW` (node ids `s0_0/s1_0/s2_0/s3_0`, keys `clarify/planner/refiner/implementer/reviewer`, `fb_refine`/`fb_review`) as the offline fallback.
2. **`ui/public/composer-core.mjs:57-102`** — `EMBEDDED_AGENTS`: 8 agent keys with display names, colors, `order`, icons and `connectsTo` allowlists duplicated from `agents/*.meta.json`.
3. **`ui/public/app.js:11686`** — `{ plan:'planner', refine:'refiner', implement:'implementer', review:'reviewer' }` uiPhase→key reverse map (plus the phase-key list at `:11645` and color switch at `:13958`).
4. **`ui/public/app.js:842-874`** — `normalizePhase` substring matching on `'refine'|'review'|'implement'|'plan'|'clarify'` and the hard-coded fallback stepper manifest for pre-manifest runs.
5. **`ui/public/app.js:2293`** — composer decomposer hint keyed on `n.key === 'decomposer'`; `:2442` resets the canvas by fetching `'wf_default'`; `:2597`/`:3229`/`:3793` branch on `wf_default` for the legacy per-role config path.
6. **`ui/server.mjs:1061`, `:3203`, `:3647`** — `'wf_default'` string literal as run default, delete-refusal, and mock-proposal default.
7. **`src/core/channels.mjs:189-236`** — `legacyRoleFields` switches on agent key to name the runner ABI fields; `CHANNEL_IDS` `:12` and `PRESEEDED_CHANNELS` `:22` are closed literals the validator imports.
8. **`src/core/runners.mjs:54-…`** — `producer` dispatches on `ctx.node.key` with a per-key `switch`.
9. **`src/core/agent-registry.mjs:50-75` (`DEFAULT_SPEC`) and `:101-106` (`LEGACY_LABELS`)** — built-in channel/governance wiring and short labels keyed by the four original roles, mirrored again in `workflows.mjs:385-390` (`UI_PHASE`) and `orchestrator.mjs:139` (`FANOUT_ELIGIBLE`).
10. **`src/cli/worca-cc.mjs:213`, `:246`** — `--workflow` defaults to `wf_default`; cycle rendering hard-codes `phase === 'refine'|'review'|'implement'|'clarify'`.

Runner-up: `orchestrator.mjs:2181-2188` special-cases `key === 'implementer'` for decomposition fan-out, and `workflows.mjs:399/518-537` special-cases `reviewer`/`implementer` for workspace substitution and manifest rewrite.
