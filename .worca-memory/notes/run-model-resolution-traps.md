---
name: run-model-resolution-traps
description: Read before changing run model/effort resolution, per-run overlays, the run engine, settings.json keys, policy fields, catalog cost/tiers or bridge translators
paths: src/core/workflows.mjs, src/core/orchestrator.mjs, src/core/run-harness.mjs, src/core/run-overlay.mjs, src/core/phases.mjs, src/core/config.mjs, src/core/settings.mjs, src/core/settings-cascade.mjs, src/core/model-env.mjs, src/core/model-tiers.mjs, src/core/policy/**, src/core/bridge/**, src/core/night/analysis.mjs, src/core/title.mjs, src/core/auto/classify.mjs, src/core/ask/proposal.mjs, src/shared/graph/manifest.mjs, ui/server.mjs, ui/public/app.js, ui/public/models-view.mjs, ui/public/bridge-view.mjs, test/bridge-*.test.mjs, test/settings-api.test.mjs
updated: 2026-10-24T15:55:36.602Z
author: Denislav Prinov
---

The Ask run card's lane UI: [[ask-running-turn-state]].

## Model / effort resolution
- The run-level model (`claude.model`: CLI `--model`, a CLI-made schedule) is only a FALLBACK: the executor uses `nc.model || this.claude.model` and `resolveGraph` fills `nc.model` from `firstDefined(sel, legacy per-role, team models.steps, template node.config)` — a template `config.model` (`wf_memory_defrag`'s `n_defrag`) makes `--model` a no-op. Reach a node at `resolveGraph` (an `agentPair`-style option replacing model AND effort). `POST /api/run` reads `model`/`effort` only WITH a `memoryScope` (a pair sent wins: settled).
- `this.claude.effort` is NOT run-wide; agent nodes and aux calls never inherit it (Away uses `deciderEffort`). Resume never re-resolves (the manifest freezes each cell). A degrade warning names what the run really falls back to (compose after `resolveGraph`).
- "Models this run may dispatch" is hand-listed in `_brokerPreflight` and `_mcpModels`; policy `models.allowed` sees only `stepModels`; aux spawns (Away, title) are in none. `needsSignIn` covers bridged entries only.
- `setNodeModel` REPLACES model and effort on every save (`row.storedPair` re-sends a locked pick). Start surfaces show node config (`buildGraphNodeRows`): a run-time override needs a template marker and locked controls (`row.pinned`); re-render on `settings-changed`, which a route clearing a setting as a side effect must emit. Request "leads" may cite unmerged code: `git merge-base --is-ancestor <sha> HEAD`.

## Per-run node overlays (`resolveGraph(…, {overlay})`)
- `mergeMaps` merges PER KEY over the project node entry: an overlay `{model}` KEEPS the project's stored effort (and fanOut, askQuestions, subagentModel). Send the effort with the model (`''` = model default; `ownedPair` treats `''` as unset, so an overlay cannot express "inherit").
- On `wf_default` the legacy per-role layer is keyed by AGENT KEY, node overrides by NODE ID; a wrong-engine model is dropped silently (model and effort); unknown node ids are ignored — validate first.
- `createOrchestratorFor` strips only `template`: a new body key arrives as `this.opts.<key>`. `startRunHandler` parses inline; a schedule stores the whole body and a firing ticket re-enters with `req._internal`, re-running the shape parse — a parser treating `''` as absent drops canonical `effort:''` on scheduled runs only. Canonicalise in `_resolveTopology` (`t.model && t.effort === undefined ? {...t, effort:''}`).
- The manifest cell is not the resolver: `cell.effort = over.effort ?? cfg.effort ?? ''`, so an effort the resolver leaves undefined becomes the TEMPLATE's, shown and spawned on RESUME. Test with a template carrying an effort (`wf_default` nodes have `config: {}`).
- Any `model` key ANYWHERE in the manifest counts as dispatched (`manifestModels` walks the stepper for `_brokerPreflight`, `_mcpModels`, `_codexNeedsSignIn`): skip request records like `manifest.runOverlay`. Mock runs skip the preflight.
- Team policy allowed models = warn AND record: `_resolvePolicy` feeds `deviationsFor` role-slot `stepModels` only — a new channel (overlay, node pick) must join (`overlayStepModels`: models a cell really ran). `catalogs.models` are definitions; the allow-list is `fields['models.allowed']`.
- Run engine: request `engine` → project → user → `claude` (`resolveRunEngine`, `GET /api/run-defaults`; workspaces skip project). NO team layer (`run.engine` has no `teamKey`): "else the team's" text is wrong; card and validators use the same helper.

## Catalog cost and tiers
- `cost:{free:true}` has two meanings: Copilot imports (`catalogEntryForCopilotModel`) get it only so recorded spend reads $0 (Copilot bills premium requests), while OpenRouter zero-price and local endpoints are really free. `free → cheapest tier` labels Copilot Opus "economy · free". Tell them apart by connection (`row.bridged === 'copilot'`/`connection.provider`); test with a real copilot row through `listModelsForAsk()`.
- The `premium` tier (Fable 5.1) warning (`proposal.mjs` `premiumPick`) fires only on `f.tier === 'premium'`; `priceOf` looks up `row.id`, never `upstreamModel`, so Copilot Fable imports, gateway aliases without `cost` and `subagentModel:'fable'` get no warning; `checkShapeModels` has no tier check. Review any tier guard route by route.
- The CLI prices unknown ids at $0: only step spawns book real bridged cost (`resolveModelEnv(model, {tag: executionId})`, `bridgeCostFor`); aux spawns (Away, title, classify, ask turn) pass no tag and miss run total, ledger and `spendCapUsd` — unique tag per call, book `bridgeCostFor(tag)?.costUsd` else `resolveModelCost`, `forgetBridgeTag`. Step tags repeat across concurrent runs; clarifier asks carry no `executionId`. The mock emits no usage-bearing `assistant` frames.

## settings.json and pickers
- No setter is serialized (pre-existing; do not flag) EXCEPT callers fanning out: Ask's parallel change_setting calls lost uiLevel beside theme — serialize check → write → re-read.
- Only CATALOG writers are guarded under node:test (`assertTestSettingsAccess`); plain setters write wherever HOME points. Spawned-CLI tests need sandbox `HOME`, `USERPROFILE` AND `WORCA_TEST_ALLOW_HOME_FALLBACK:'1'`.
- A catalog swap (`renameStoredModelPins`) moves DB pins only (`titleModel`, `autoWorkflowModel`, `memory.defrag.model` stay; `removeGlobalModelAndRefs` misses the first two). Duplicate/"Edit a copy" drop `upstream`; reads drop the WHOLE `upstream` on any `assertModelUpstream` throw. `listGlobalModels()` efforts are EFFECTIVE.
- Retiring a key: move it to `RETIRED_SETTINGS_KEYS` (dropping it from `SETTINGS_POST_KEYS` turns a body naming only it into the root-clearing body); `settings-api` lists every post key; `ui-instance.mjs` detects old servers by `'askMaxTurns' in /api/settings`. A deleted policy `FIELDS` row joins `RETIRED_FIELDS` (old-build caches keep the key: make `staleRead` fire on keys with no `fieldMeta`; `policy-effective` `by[key]` throws on it); `team-policy-view` has its own registry (swap rows, never empty a group).
- Pickers: `buildTitleModelOptions` uses optgroups, `buildAutoModelOptions` is flat; both drop `custom === 'project'`; shared builders live in a sibling module, not app.js. `GET /api/away-mode` without `projectDir` answers defaults only.

## Bridge translators (`src/core/bridge`)
- Captures (`docs/superpowers/specs/2026-09-23-bridge-openai-responses-probes/*.jsonl`) are gitignored: read the MAIN checkout; print the capture count and fail on 0; skip line 0; rewrite markers with `encodeReasoningMarker(<upstreamModel>, 'ENC')`.
- The CLI's LAST message is often `role:'system'`: skip trailing system messages before "last message" heuristics (copilot billed continuations as premium).
- Overflow by code AND wording: `context_length_exceeded` → the CLI's `prompt is too long` (`isContextOverflow(code, message)`); inside a 200 (`response.failed`) codes decide first. CLI 2.1.280: SSE `event: error` has no status; in-stream errors retry only for `overloaded_error`. Request byte identity: `git show <ckpt>:src/core/bridge/translate/request.mjs` loads standalone.
