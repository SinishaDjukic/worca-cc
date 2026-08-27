# P2 v2 plan — cold fresh-eyes review (Fable 5, max effort, 2026-08-27)

Plan: `docs/superpowers/plans/2026-08-26-node-graph-v2-P2-shared-core-sidecars-schema-store-v2.md` (5763 lines, P2a Tasks 0–14, P2b Tasks B0–B10). Read in full, against the rebuild spec §2/§3/§4/§5.5/§5.8/§6/§7.4/§10.1/§12/§16, the base spec §2 + Amendment f, P1 v2 Tasks 5/6/7/8/9/10, and dev @ e6968e15 (read-only).

Method: every embedded block was extracted into an isolated scratch tree (`SCRATCH/fresheyes-p2/repo`), syntax-checked, and — for the pure half — EXECUTED: P1's `constants.mjs`/`verdict.mjs`/seeds + the plan's nine shared modules, `registry-ports.mjs`, the test helper, `model.mjs`, the 11 sidecar fragments applied to copies of the real sidecars, and Task 8's `claude-runner.mjs` edits applied to a copy. Results are in the "Empirical record" section; nothing in the repo was touched.

## Findings

### CRITICAL

**G1 — Task B2 Step 2, `writeGraphWorkflow`: backticks inside the SQL template literal (plan lines 4448–4449) → `SyntaxError` in `src/core/workflows.mjs`.**
The UPSERT is a JS template literal (`prepare(\`…\`)`) and its SQL comment lines read
```
        -- sends {id, name, nodes, wires} and NO origin, so `origin = excluded.origin`
        -- would silently detach a plugin-owned `wfp_*` row from
```
The first inner backtick terminates the literal; `node --check` on the extracted function fails with `missing ) after argument list`. `workflows.mjs` is imported by `ui/server.mjs`, the CLI, the orchestrator, `agent-store`, `config`-adjacent code and ~every suite, so the module would fail to load and the whole tree goes red at Task B2 — the plan's own `Expected: ℹ pass 7` for `test/workflows-graph-rows.test.mjs` cannot have been produced by this text.
Fix (exact): replace the four comment lines inside the literal with backtick-free text, e.g.
```
        -- COALESCE, never a plain overwrite: the composer's Save on a loaded row
        -- sends {id, name, nodes, wires} and NO origin, so a plain
        -- "origin = excluded.origin" would silently detach a plugin-owned wfp_* row
        -- from removePluginWorkflows' guard. v1's writeWorkflow never touches origin
        -- on conflict either.
```
(or move the comment above the `prepare(` call as a `//` JS comment). Verified: with the backticks stripped the snippet passes `node --check`, and the exact statement runs in `node:sqlite` — a re-save with `origin = NULL` keeps `plugin:demo`.

### MAJOR

**G2 — Task 10 Steps 4 and 5 name a test file that does not exist: `test/api-agents.test.mjs`.**
Dev has `test/agents-api.test.mjs` and `test/api-agents-domain.test.mjs`; `node --test` aborts the whole command on a missing path, so both verification steps fail as written ("Also `node --test test/agent-registry.test.mjs … test/agents-meta.test.mjs test/api-agents.test.mjs` stays green" and Step 5's `node --test test/api-agents.test.mjs`).
Fix: in Step 4 replace `test/api-agents.test.mjs` with `test/agents-api.test.mjs test/api-agents-domain.test.mjs`; in Step 5 replace `node --test test/api-agents.test.mjs` with `node --test test/agents-api.test.mjs test/api-agents-domain.test.mjs`. (Checked: neither file pins the exact normalized-meta key set, so the v2 fields riding through `/api/agents` break nothing — the claim "those suites deepEqual only v1 fields" holds for every `agent-registry*`/`agents-meta`/`agents-api` suite.)

**G3 — Task B4 Step 2, `setWorkflowNodeDefaults` v2 arm: the insertion anchor "after the `wf_default` refusal and the `readRaw` lookup" is one line too early.**
The snippet reads `patch`, which dev declares AFTER the lookup (`workflows.mjs:319 const patch = map && typeof map === 'object' ? map : {};`). Inserted literally "after the readRaw lookup" (i.e. after `if (!tpl) throw …`) the block throws `ReferenceError: Cannot access 'patch' before initialization` on the first call — the B4 defaults test and `PATCH /api/workflows/:id/defaults` (B5 test 6) go red with no hint pointing at the anchor.
Fix (exact text): "and `setWorkflowNodeDefaults` (`:311`), immediately AFTER the line `const patch = map && typeof map === 'object' ? map : {};` (`:319`) and BEFORE `const steps = tpl.steps.map(…)`:".

### MINOR

**G4 — Task B7 (Files + the `runDir` comment in `test/run-workflow-gate.test.mjs`): the run recipe is cited as `test/api-workflows.test.mjs:104-112`; on dev it is `:173-210`** (`POST /api/run` with a bare `mkdtemp` project dir + `mock: true` → `runId`; `:104-112` is the "appears in the list"/DELETE pair). Anchor drift only — the recipe itself is right: the single-project run path needs no git repo at submit, and the CLI gate fires after only `resolve(flags.project)` + `budgetStatus()`, so a non-git temp dir is fine for both arms.

**G5 — Split-point note: "P2b depends on P2a ONLY through `validateGraph` (the 422 body) and `TEMPLATE_VERSION`" is false.** B4 imports `classifyLoops` + `registryPortsFn`, B5 `registryPortsFn`, B8 `rankNodes`/`classifyLoops`/`registryPortsFn`, and all three need Task 10's merged registry (`inputs/outputs` on the 11 builtins) or every `resolveGraph` throws `agent "planner" has no v2 ports`. B0's sentinels (validate.mjs + `MOCK_WRITER_ROLES` + planner `"metaVersion": 2`) already imply the whole of P2a landed, so only the sentence is wrong. Fix: "P2b depends on all of P2a (the shared modules, `registry-ports.mjs`, the merged registry and the ported sidecars); it does NOT depend on P1's harness split."

**G6 — Task B8: prose vs code on intra-group order.** The task text says "nodes in `launchOrder` inside a group — the SAME rank definition the manifest shim cells use", but `graphSteps` keeps template node order (the manifest shim sorts by launch index). Harmless for the tests (one agent per group) but the two shims can disagree on a fan-out rank. Fix: compute `const loops = classifyLoops(tpl, portsFn)` once in the v2 branch, pass it to both `rankNodes` and the `feedbacks` filter (today `classifyLoops` runs twice), and sort each group by `loops.launchOrder.indexOf(node.id)` — or change the prose to "template order".

**G7 — Task 10 Step 1 parenthetical: "add the three new imports beside the existing ones" — four import lines are listed** (`node:fs` `readdirSync, readFileSync`; `node:url` `fileURLToPath`; `validateMetaV2`; `MOCK_WRITER_ROLES`). Say "four" (a second `import … from 'node:fs'` beside the existing one is legal).

**G8 — Spec §5.8 vs Task 11 manifest shape (deviation to RECORD, not a defect).** The spec's example OR cell lists `ports.inputs: [{id:'in1', type:'md'}, …]` (resolved type, no required/loop/expands); the plan emits `inK` as `type:'any'` with `required:true, loop:false, expands:false` and resolves only `out` — which is what Amendment f §6 says ("OR's `out` row captions the RESOLVED type; `inK` rows stay `any`"), and `manifestPortsFn`'s round-trip depends on it. Add a Q&A line so P6's renderer follows the plan's cell shape, not the §5.8 sample (`fanOut` and `config` on the cell are already recorded).

**G9 — Spec §6 says `validateMetaV2` is used by "agent-store (hard 400)" with the rule texts verbatim; P2 never wires it into `agent-store.mjs`.** After Task 10 an invalid v2 sidecar reaches the store as `normalizeMeta → null → err('invalid agent metadata', 'BAD_REQUEST')` (a 400, but the generic text, plus a server-side `console.warn`) — so Task 7's claim "the rule texts below are the STORE's 400 messages verbatim — the Agents view renders them unchanged" is not true at P2. Either add to Task 10 Step 2 a 3-line hook in `createAgent`/`updateAgent` (before `normalizeMeta(raw)`: `if (raw.metaVersion === 2) { const { errors } = validateMetaV2(raw, { mockWriterRoles: MOCK_WRITER_ROLES }); if (errors.length) throw err(errors.join('; '), 'BAD_REQUEST'); }`) with a one-case test in `test/agent-store.test.mjs`, or state in the handoff that the verbatim store 400 lands with P7's port editor.

**G10 — Task B9 Step 1: the `graph-row-consumers` "extra imports" block is printed after the test bodies.** Say "at the top of the file" (ESM hoists imports, so it works either way, but the assembled file should read top-down).

**G11 — Task 9 `.md` step wording: "Four files have no such section — INSERT the block after the intro paragraph".** Correct on dev, and the anchor table is exact (see E8), but add "followed by ONE blank line before the next `## …` heading" so the four inserts stay byte-consistent with the seven replacements.

## Spec coverage (sections listed in the brief)

- §2 row P2 — every bullet has a task: shared modules (1–7, 11), unit suites named `test/graph-<module>.test.mjs` (1–7, 11), dual-shape sidecars (9), `normalizeMeta` merge + `validateMetaV2` + `registry-ports.mjs` + `MOCK_WRITER_ROLES` + the `:90-99` rewrite (7, 8, 10), seed drift guard 0/0 + Amendment-f pins (13), V23 (B1), v2 rows/archiving/`assertRunnableWorkflow` (B2), `resolveGraph` + precedence (B4), `config_workflow_wires` + `setWireCycles` (B3), `/api/config` wires (B6), `POST /api/workflows` v2 + 422 identity (B5). No gap.
- §3 — module/export table matches Tasks 1–7, 11, 12 name for name (incl. `newWire(from, to, config?)`, `canWire` reasons, `Issue.wireIds`); import convention + depth header (12); purity (P1 guard passes over the new tree, E1); `/api/agents` pass-through verified untouched (10.5). The `--gv-*` set-equality test is P5's (style.css does not exist yet).
- §4 — storage, id rule, `listWorkflows`/`readWorkflow` archived filters, `assertRunnableWorkflow` texts, `GET /api/workflows/:id` 404 mapping, `?archived=1`, overlays/precedence/"effort never inherits", per-wire budgets, `node.defaults` → `node.config`, `PATCH …/defaults` v2 arm, `resolveWorkflow` throw, Ask `shapeWorkflow`, proposal seam, agent-store/plugin-workflows walks, run-setup guards, composer list filter — all present (B2–B9). `deleteWorkflow`/`removePluginWorkflows` untouched as required.
- §5.5 — the 14-role Set + two constants + structural lockstep test (8). `resolveMockRole` is P3.
- §5.8 — head/graph/bookends/shim cells/feedbacks/`ports.await` boolean/resolved OR out/`maxCycles` on loop wires only/icon sanitizing (11); see G8 for the one recorded deviation.
- §6 — schema, reserved `await`, capability fields, rule texts, dual shape, invalid ⇒ skip whole, `.md` `## Ports`, `{diffInstruction}`, the 11-row port table byte-for-byte (7, 9, 10); see G9 for the store's 400.
- §7.4 — constants, zone model, closed forms (incl. the two documented 0-input deviations), bezier, hit tests, fit ≤ 1× (5).
- §10.1 — DDL, `INCREMENTAL_COLUMNS`/`INCREMENTAL_TABLES`, `SCHEMA_VERSION` 23, `db.test.mjs` 18→19, residue gap-heal test (B1).
- §12 — file-name contracts, mutation audit (Task 3 Step 3, spot-verified E2), migration suite on the residue shape (B1), counts recorded per half (14, B10).
- §16 — header/Spec line/self-contained/Task 0 shape/checkbox TDD/commit prefix/Q&A with sources: all present; no invented user answers (D1/D6/D7 and the single-wire/V22 decisions match the user's recorded decisions; everything else is labelled planner default, agent adjudication or Fable critique).

## Contract sanity toward P3/P4/P5/P7

Literal sentinels present: `export function validateGraph(` (validate.mjs), `export const SCHEMA_VERSION = 23;` (B1), `export const MOCK_WRITER_ROLES` (8), `export function registryPortsFn(` (10), `export async function resolveGraph(` (B4); manifest `steps[0].kind === 'preflight'` / `steps.at(-1).kind === 'done'` (11). `portsFn(node)` spreads the meta so `verdict` rides (`portsFnFor`) and `manifestPortsFn` synthesizes `verdict: {filename: ''}` for conditional-output cells; `firedOutputs` accepts an outputs array or a resolved ports object (test pins both); `canWire` codes V0/V5/V7/V8/V12 with the chip texts verbatim; `validateMetaV2(raw, {mockWriterRoles})` is silent by design; `test/helpers/graph-ports.mjs` exports `realAgentMetas/realRegistryIndex/realPortsFn`; `resolveGraph` returns exactly `{template, ports, loops, nodes, wires, agentsByKey, agentKeys}` with the resolved-key deep copy (workspace pin asserts `loopWireIds === ['w5']` and `wires === {w5:{maxCycles:4}}`). Count gates: recounted `test(` blocks — 97 for P2a and 42 for P2b, per file exactly as tabled.

## Empirical record (scratch tree `SCRATCH/fresheyes-p2/repo`; repo untouched)

- E1 P2a executed: `node --test` over the 12 P2a files → **91/91 pass** (ports 8, loops 7, validate 23, template 10, geometry 10, layout 5, thumbnail 2, agent-meta 11, manifest 9, single-source 2, mock-writer-roles 2 (against a copy of dev's `claude-runner.mjs` with Task 8's edits applied — the regex finds exactly 14 arms), registry-ports 2). Seed drift guard (P1's 11 + P2's 3) → 14/14: all 8 graphs 0 errors / 0 warnings against copies of the real sidecars with the plan's fragments inserted after line 2; loop-wire pins hold. The 4 schema-v2 additions → 4/4 against an emulation of the Task 10 merge. `validateMetaV2` on the 11 patched sidecars → `ALL 11 VALID`, no loop/required warnings. P1's purity guard → 3/3 with `ui/public/graph/model.mjs` present (URL == disk path). `JSON.parse` of all 11 fragments and 11 assembled sidecars OK; no fragment key collides with a v1 key.
- E2 Mutation audit spot-check: V7→liveWires, V9 kind guard, V11 `return false`, V15 metaOf, V18(c), V19 end/result, V12 upper bound each → **22/23 (red)**; restored → 23/23.
- E3 `node:sqlite` (Node 25.6.1): `INSERT … ON CONFLICT(project_key, workflow_id, wire_id)` works against the residue table declared `PRIMARY KEY (workflow_id, project_key, wire_id)` (B1/B3 "PK order is inert" holds for `setWireCycles` too); `ALTER TABLE … DROP COLUMN` supported (B1 self-heal test); the G1 UPSERT (backticks removed) runs and `COALESCE` keeps `origin`; `assert.rejects(p, /^Error: …$/)` matches `String(err)` (B2 `resolveWorkflow` test).
- E4 Dev modules (read-only): `sanitizeNodeDefaults({model:'tpl-model', effort:'high'})` keeps both (structural only) → B4's `workflowNodeDefaults` expectation holds; `slugify('Graph One')` → `graph-one`.
- E5 Import graph: `claude-runner.mjs` imports only `model-env`/`recoverable-error`/`preflight` (+ builtins), none of which reach `config.mjs`/`agent-registry.mjs` → the new `agent-registry → claude-runner` import cannot trip config.mjs's module-eval `AGENT_STEPS = agentSteps()`. The only top-level side effect in claude-runner is `DEFAULT_BIN = process.env…` (inert). `case '…':` labels in the file: exactly the 14 switch arms.
- E6 Anchors verified on dev @ e6968e15: every `:line` cited for claude-runner, agent-registry, db.mjs (incl. `:1072 if (current < 22) applySchemaV22(db);`), test/db.test.mjs, workflows.mjs, config.mjs, test/run-config.test.mjs:96, ui/server.mjs (`:1062`, `:2687`, `:2751`, `:2792`, `:3116`, `:3126`, `:3136`, `:3150-3156`, `:3177`, `:3907-3913`, `isTruthy` `:4758`), worca-cc.mjs (`:165 fail`, `:1459 SUBCOMMANDS`, `:1526 createOrchestrator`, `--yes` exists), proposal.mjs `:54-61`/`:104-106`, ask-proposal.test `:15-31`, catalog.mjs `:18`, agent-store `:54`/`:97-99`/`:133`, plugin-workflows `:150-179`, plugins-lock `:26`, app.js `:1973-1976`/`:2533`/`:2561`/`:2669`/`:2813`/`:2879-2882`, ui-composer.test `boot()`/`DEFAULT_WF`/`#composer-saved-list`, phases `:836`/`:1202`/`:1237`. All 11 `.meta.json` have `"key"` on line 2. The seven `## Inputs (from the task prompt)` sections are heading+bullets only at the cited lines; the four insert anchors match. The user_version sweep prints exactly the two prose lines. `ls test | grep mock` = the four named files. Old branch `origin/worca-cc/v2-orchestrator-bfb6a0ed` resolves. `grep "delete or edit those first" test/` empty; `promptHints` readers are only phases.mjs:1202/:1237; `## Inputs (from the task prompt)` referenced nowhere in src/test/ui. BSD `grep "\b…\b"` (Task 0 Step 4) matches on this macOS.
- Doubts FOR THE RE-EXECUTION AGENT (not executed here, repo read-only): (a) every "re-measured"/"dry-run measured" count (Task 0 baselines 3760/3810, Task 8's 23, Task 14's 3907, B10's 3949); (b) B1's ladder test runs the full gap repair on a 3-table seed — the same shape already runs via `applySchemaV22` in ask-db-schema/diff-comments-schema, so expect green, but confirm; (c) B7's CLI arm spawns the real CLI against the shared temp DB (WAL) — confirm exit 2 + stderr text; (d) B9's jsdom case depends on `composer.els.list` after the `#composer` hashchange and on the new `window.__composerRenderList` hook line; (e) Task 12's `test/api-shared-static.test.mjs` walk now serves 11 files — confirm 4/4.

## Verdict

**Not yet — fix G1 (one-line SyntaxError in B2's `writeGraphWorkflow`, mandatory), G2 (non-existent `test/api-agents.test.mjs` in Task 10) and G3 (`setWorkflowNodeDefaults` anchor); then execute.** The pure half is empirically sound (91/91, seeds 0/0, sidecars valid, mutations red); the store half is logically consistent with dev's anchors and SQLite semantics once G1 is applied.

CRITICAL+MAJOR: G1 (B2 backticks inside the SQL template literal → workflows.mjs cannot parse) · G2 (Task 10 Steps 4/5 name `test/api-agents.test.mjs`, which does not exist — use `test/agents-api.test.mjs test/api-agents-domain.test.mjs`) · G3 (B4 `setWorkflowNodeDefaults` v2 arm must go after `const patch = …` (`:319`), not right after the `readRaw` lookup).
