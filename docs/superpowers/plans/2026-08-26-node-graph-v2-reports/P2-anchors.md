# P2 plan — anchor fact-check (Opus, 2026-08-27)

Plan: `docs/superpowers/plans/2026-08-26-node-graph-v2-P2-shared-core-sidecars-schema-store.md` (5226 lines).
Tree: `/Users/denislavprinov/Develop/worca-cc` @ `dev e6968e15` (READ-ONLY; nothing was modified).
Old branch: `origin/worca-cc/v2-orchestrator-bfb6a0ed` = `0e6cee6f`.
Method: every anchor opened and quoted; every P2 pure module + its test EXTRACTED from the plan text into
`…/scratchpad/p2-anchors/` and RUN under Node 25.6.1 / SQLite 3.53 against the plan's own sidecar bodies merged
onto dev's real `agents/*.meta.json`; the 8 seed graphs validated with the plan's real `validateGraph`.

Verdicts: **OK** = matches reality · **DRIFT** = exists, wrong line/±lines · **WRONG** = factually false / would fail ·
**MISSING** = does not exist.

---

## 1. Predecessor (P1) contract — Task 0

| # | Plan location | Claim | Verdict | Correction |
|---|---|---|---|---|
| 1 | Task 0 Step 3 | sentinels `export class RunHarness`, `export const SEED_TEMPLATES`, `src/shared/graph/{constants,verdict}.mjs` | OK | P1 Task 2/9/5/6 produce exactly these; none exist on dev yet (correct — P1 is the predecessor). |
| 2 | Task 0 Step 4 | all 14 names (`TEMPLATE_VERSION KINDS FLOW_KINDS PORT_TYPES AWAIT_PORT TASK_PORTS END_PORTS gatePorts NODE_ID_RE WIRE_ID_RE PORT_ID_RE DEFAULT_MAX_CYCLES MAX_PORTS_PER_SIDE LIMITS`) exist in P1's `constants.mjs` | OK | Verified by importing P1's module text: exports are exactly those 14. |
| 3 | Task 0 Step 4 | "`LIMITS` must expose finite `maxNodes`/`maxWires`. If it does not, ADD them (`maxNodes: 60, maxWires: 120`)" | WRONG (dead + contradictory) | P1 already ships `LIMITS = {maxNodes: 80, maxWires: 200, maxPortsPerSide: 8, minArity: 2, maxArity: 8, maxCycles: 20, maxNameLen: 80}`. Replace the fallback sentence with: "P1 ships `maxNodes: 80, maxWires: 200` — verify, do not add. Any other value is a P1 regression, not a P2 deviation." |
| 4 | Task 0 Step 5 | old branch fetchable | OK | `origin/worca-cc/v2-orchestrator-bfb6a0ed` resolves to `0e6cee6f`; all borrowed files present. |
| 5 | Header "Series position" | P2b depends on P2a only through `validateGraph` + `TEMPLATE_VERSION` | OK | B5 imports `validateGraph`+`registryPortsFn`; B4 imports `classifyLoops`+`registryPortsFn`; B8 imports `classifyLoops`+`rankNodes`+`registryPortsFn`. (So the note under-states it: B4/B8 also need `loops.mjs`, `layout.mjs` and `registry-ports.mjs`.) Amend the P2b entry note accordingly. |

## 2. THE BLOCKER — `KINDS.has` (Task 3)

| # | Plan location | Claim | Verdict | Correction |
|---|---|---|---|---|
| 6 | Task 3 Step 2, `validate.mjs` rule V3 | `if (!KINDS.has(n.kind)) {` | **WRONG — hard TypeError** | P1's `KINDS` is `Object.freeze(['agent','task','end','and','or','combine'])` — an **Array**, which has no `.has`. Every `validateGraph()` call throws `TypeError: KINDS.has is not a function`. Measured: all 8 seed graphs threw, all 23 `graph-validate` tests fail, and `graph-manifest`'s round-trip test fails. Fix: `if (!KINDS.includes(n.kind)) {`. (Everything else in the shared core is Array/Set-agnostic: `[...PORT_TYPES]`, `[...KINDS].join`, `gatePorts` destructuring all work.) |
| 7 | Task 3 rule table, row V3 | message "`expected one of agent, task, and, or, combine, end`" | DRIFT | The code emits `[...KINDS].join(', ')` = `agent, task, end, and, or, combine` (P1's KINDS order). Fix the table prose to `— expected one of agent, task, end, and, or, combine`. |
| 8 | Task 3 rule table, row V2 + code | message `node id <json> must match /^[A-Za-z0-9_-]{1,64}$/` | WRONG | The test is `NODE_ID_RE.test(id)` and P1's `NODE_ID_RE` is `/^n_[a-z0-9]{1,32}$/` — the message names a regex the validator never applies (it would accept `s0_0`, `Bad-Id`, and reject nothing the message implies). Fix both table and code to: `` add(`node id ${JSON.stringify(id)} must match ${NODE_ID_RE}`, { nodeId: id }); `` (or hard-code `/^n_[a-z0-9]{1,32}$/`). |

## 3. Pure core (Tasks 1–7, 11, 12) — empirically run

Every module + test below was extracted verbatim from the plan and executed. **With correction #6 applied, all
95 embedded assertions pass.** Without it, the 23 validate tests and 1 manifest test fail.

| # | Plan location | Claim | Verdict | Correction |
|---|---|---|---|---|
| 9 | Task 1 Step 2 | `Expected: PASS — 8 tests passing` (ports) | OK | Measured `# pass 8`. |
| 10 | Task 2 Step 2 | `Expected: PASS — 7 tests passing` (loops) | OK | Measured `# pass 7`. |
| 11 | Task 3 Step 2 | `Expected: PASS — 23 tests passing` (validate) | OK *after #6* | Measured `# pass 23` once `KINDS.includes` is used. |
| 12 | Task 4 Step 2 | `Expected: PASS — 10 tests passing` (template) | OK | Measured `# pass 10`. |
| 13 | Task 5 Step 2 | `Expected: PASS — 10 tests passing` (geometry) | OK | Measured `# pass 10`. |
| 14 | Task 6 Step 4 | `Expected: PASS — 7 tests passing (5 layout + 2 thumbnail)` | OK | Measured 5 + 2. |
| 15 | Task 7 Step 3 | `Expected: PASS — 11 tests passing` (agent-meta) | OK | Measured `# pass 11`. |
| 16 | Task 11 Step 2 | `Expected: PASS — 9 tests passing` (manifest) | OK *after #6* | Measured `# pass 9` (its round-trip test calls `validateGraph`). |
| 17 | Task 1 Step 2 note | "If P1's `gatePorts` returns a bare array rather than `{inputs, outputs}`, adapt this one call site" | OK (dead branch) | P1's `gatePorts` returns `Object.freeze({inputs, outputs})`; the destructuring in `flowPorts` works as written. Harmless, can stay. |
| 18 | Task 7 Step 2 note | "If P1's `PORT_TYPES` is a Set the `TYPES` line works as written; if it is an array, drop the spread." | DRIFT (advice is wrong) | `PORT_TYPES` **is** an array and `[...PORT_TYPES].filter(...)` works unchanged. Replace with: "`PORT_TYPES` is a frozen array in P1; the spread is a defensive copy and stays." |
| 19 | Task 7 Step 2 note | "`MAX_PORTS_PER_SIDE` must be 8" | OK | P1: `export const MAX_PORTS_PER_SIDE = 8`. |
| 20 | Task 5 "Frozen constants" + closed forms | `191.5 / 110.5 / 167.5 / 134.5`, `ROW0 = 56`, anchors `task(400,136) fix(400,160) plan(620,193) review(620,217) await(400,250) n_task.task(280,199) n_end.result(760,199)`, `fitBounds → {z:1, tx:120, ty:104.25}`, mirrored `d = M 400 160 C 346 160, 334 160, 280 160`, `dx = clamp(48,160,0.45·|Δx|)`, `bow = 56 + 0.2·|Δy|` | OK | All reproduced under `node -e`. Byte-identical to spec §7.4 and to `…rebuild-inputs/composer-proto/proto.html:94-172` (`G = {NODE_W:220,…}`, `ROW0` at :100, `bezierPath` at :168-170, `snap` at :172, fit clamp `min(vw/b.w, vh/b.h), ZOOM_MIN, 1` at :378). Spec's AND/OR form `3+34+8.5+(N+1)·24+9+8` → 134.5 / +9+24 = 167.5 ✓. |
| 21 | Task 5 note (e) | "NEVER borrow `old:thumbnail.mjs:38-39`'s private bezier constant" | OK | Old `ui/public/graph/thumbnail.mjs` does carry its own curve constant; the plan's `thumbnail.mjs` draws through `bezierPath`. |
| 22 | Task 5 | `WIRE_HIT_TOL 6` is a "frozen constant" from the prototype | DRIFT (source) | The prototype defines no `WIRE_HIT_TOL` (it only hit-tests ports). Spec §7.4 does list it. Reword: "from spec §7.4 (the prototype hit-tests ports only)". |
| 23 | Task 12 | "P1's purity guard … has a **second** test that walks every `ui/public` specifier" | DRIFT | It is the **third** test (`ui/public leaves the static root only into src/shared…`). Cosmetic. |
| 24 | Task 12 | the nine new `src/shared/graph/*.mjs` pass P1's purity regexes | OK | Verified against P1's exact regex list (`/['"]node:/`, `/\brequire\s*\(/`, `/\bprocess\./`, `/\b(window\|document\|navigator\|localStorage)\b/`, `/\bfetch\s*\(/`, `/import\.meta\b/`, `/^(let\|var)\s/m`): zero hits in ports/loops/validate/template/geometry/layout/thumbnail/agent-meta/manifest. |
| 25 | Task 12 | `ui/public/graph/model.mjs`'s `../../../src/shared/graph/*` specifiers satisfy "browser URL == disk path" | OK | `new URL('../../../src/shared/graph/ports.mjs','http://x/graph/model.mjs').pathname` = `/src/shared/graph/ports.mjs` = `'/' + relative(ROOT, onDisk)`. `ui/public/graph/` does not exist on dev (Task 12 creates it). |
| 26 | Task 12 test | `assert.match(src, /depth 3/)`; `specs.length >= 8` | OK | The header line contains `(depth 3)`; model.mjs has 9 `from '…'` specifiers, all matching `^\.\./\.\./\.\./src/shared/graph/`. |
| 27 | Task 12 | every name re-exported from `constants.mjs` exists in P1 | OK | `TEMPLATE_VERSION KINDS FLOW_KINDS PORT_TYPES AWAIT_PORT TASK_PORTS END_PORTS gatePorts DEFAULT_MAX_CYCLES MAX_PORTS_PER_SIDE LIMITS` — all present. |

## 4. Task 8 — `MOCK_WRITER_ROLES` / `claude-runner.mjs`

| # | Plan location | Claim | Verdict | Correction |
|---|---|---|---|---|
| 28 | Task 8 Files | `MOCK_FANOUT_ROLES` at `claude-runner.mjs:849` | OK | `:849 const MOCK_FANOUT_ROLES = new Set([` … `:852 ]);` (members: planner-plan, refiner, implementer, plan-review, workspace-reviewer, workspace-scan). |
| 29 | Task 8 Files | role switch at `:1065-1105`, 14 arms | OK | `:1065 switch (role) {`; case labels at 1066/1069/1072/1075/1078/1081/1084/1087/1090/1093/1096/1099/1102/1105 in exactly the plan's order. (The switch **block** closes at :1113 — 1105 is the last *label*. If the plan means the label range, it is exact.) |
| 30 | Task 8 | the `ask` arm is at `:1034` and OUTSIDE the switch | OK | `:1034 if (sysMarkers.MOCK_ROLE === 'ask' \|\| permissionMode === 'dontAsk') {`. |
| 31 | Task 8 Step 1 test | the regex finds exactly 14 arms file-wide | OK | `grep -c -E "case[[:space:]]+'[^']+':" src/core/claude-runner.mjs` → **14**; there is no second switch and no `case UPPER_CONST:` today. After the two label swaps the regex yields 12 string + 2 const = 14, and `CONSTS[m[2]]` resolves both. |
| 32 | Task 8 Step 2 | "no cycle: claude-runner imports no registry" | OK | claude-runner.mjs imports only `node:child_process`, `node:readline`, `./model-env.mjs`, `./recoverable-error.mjs`, `./preflight.mjs`, `node:fs/promises`. Zero `agent-registry` hits. |
| 33 | Task 8 | dev has NO `MOCK_WRITER_ROLES` export today | OK | Repo-wide grep: absent. |
| 34 | Task 8 Step 2 verify | "`ls test \| grep mock` … run them all" | DRIFT | `ls test \| grep mock` → `claude-runner-ask-mock.test.mjs`, `skill-mock.test.mjs`, `subagent-mock.test.mjs`, `workspace-mock.test.mjs`. There is **no** `test/mock-runner.test.mjs` or `test/mock-graphify.test.mjs` (those are old-branch names). Replace the sample command line with those four real files. |

## 5. Task 9 — the 11 dual-shape sidecars

| # | Plan location | Claim | Verdict | Correction |
|---|---|---|---|---|
| 35 | Task 9 preamble | every added key is genuinely NEW on dev (`metaVersion, inputs, outputs, verdict, mockRole, promptHints, wantsRequest, workspaceFanOut, workspaceStrategy, workspaceVariantOf, sideEffect, placeable`) | OK | Grep over all 11 dev sidecars: zero occurrences of any of them. Dev is 100 % v1. (The word "verdict" appears only inside two `description` strings.) A merge script confirmed **no key collisions** between dev and the plan's blocks. |
| 36 | Task 9 `implementer.meta.json` | adds top-level `"promptHints": "Work inside the project directory (your cwd). Commit nothing; just edit files and tests."` | **WRONG (self-contradiction)** | Task 10's replacement test asserts exactly five hint-bearing builtins: `['manualTestsChecklist','manualWebUiTesting','planReviewer','refiner','workspaceReviewer']`. With Task 9 as written the set is **six** (implementer added) and the `deepEqual` fails. The old branch's `implementer.meta.json` carries **no** `promptHints`. Fix: delete the `promptHints` line from Task 9's implementer block (the three per-port `directive`s already carry that guidance), OR add `'implementer'` to Task 10's array and change "Exactly five" → "Exactly six" in the comment. |
| 37 | Task 9 | port bodies match spec §6 row-by-row | OK | All 11 rows (inputs/outputs/when/filename/store/as/directive/loop/expands/verdict/mockRole/capabilities) match spec §6 exactly. |
| 38 | Task 9 | port bodies borrowed from the old branch | DRIFT (3 deliberate deltas, all spec-correct) | vs `old:agents/*`: (a) `decomposer.tasks` gains `"artifactKind": "decomposition"`; (b) `implementer` inputs reordered `plan,fix,task` → `fix,task,plan` **and** the `plan` port gains a `directive`; (c) `manualTestsChecklist.promptHints` templates `via \`git diff\` in your cwd` → `{diffInstruction}`. All three match spec §6; the other 8 sidecars are byte-identical. Worth stating explicitly in the plan so a reviewer does not "restore" them. |
| 39 | Task 9 `.md` section | SEVEN files carry `## Inputs (from the task prompt)`; cited lines 10/12/10/10/10/10/10 | OK | `grep -n "^## Inputs" agents/*.md` → exactly 7, at plan-refiner:10, plan-reviewer:12, code-reviewer:10, workspace-reviewer:10, manual-tests-checklist:10, manual-web-ui-testing:10, workspace-scanner:10. Byte-exact. |
| 40 | Task 9 `.md` section | FOUR files have no such section (clarify, planner, decomposer, implementer) | OK, one caveat | Confirmed absent in all four. `worca-cc-decomposer.md` has an `# Your role` H1 at :8 and its intro at :10-13 with the next `##` at :15 — the insert point is still well-defined but differs structurally from the other three (intro at :8, next `##` at :10). Add that note. |
| 41 | Task 9 `.md` section | file ↔ key mapping via `agentFile` | OK | `reviewer→worca-cc-code-reviewer.md`, `refiner→worca-cc-plan-refiner.md`, `planReviewer→worca-cc-plan-reviewer.md`, rest 1:1. No mapping error. |
| 42 | Task 9 Step 3 | `git diff --stat agents/` → 22 files changed | OK | `ls agents/*.meta.json` = 11, `ls agents/*.md` = 11. |
| 43 | Task 9 | `manualWebUiTesting`'s frontmatter Playwright grants must keep reaching `ctx.node.tools` and must not be touched | OK | Frontmatter present with 15 `mcp__plugin_playwright_playwright__*` tools + `model: inherit`. |
| 44 | Task 9 Step 2 | the sanity script prints `ALL 11 VALID` | OK | Reproduced: all 11 merged sidecars normalize with **0 errors and 0 warnings** through the plan's own `agent-meta.mjs`. |

## 6. Task 10 — registry merge + real-sidecar helper

| # | Plan location | Claim | Verdict | Correction |
|---|---|---|---|---|
| 45 | Task 10 Files | `normalizeMeta` at `agent-registry.mjs:189-249` | DRIFT (−1) | `export function normalizeMeta(raw) {` is at **:189**; the function ends at **:248** (`:249` is blank). Its `return { … };` spans :216-:247, and `key` (`:191`) + `raw` are in scope, so the "assign to `const base` / append before the closing brace" recipe works. Cite `:189-248`. |
| 46 | Task 10 Step 2 | imports "beside the existing ones (`:11-16`)" | OK | :11-16 are exactly the six imports. |
| 47 | Task 7 Files | "never borrow `old:agent-registry.mjs:21`'s `new URL().pathname`, which reintroduces the Windows bug dev fixed at `agent-registry.mjs:29`" | DRIFT (−1) | The `fileURLToPath` fix is at **:28** (`export const DEFAULT_AGENTS_DIR = fileURLToPath(new URL('../../agents/', import.meta.url));`); :29 is blank. |
| 48 | Task 10 Rules | "a v2 sidecar whose validation fails ⇒ `normalizeMeta` returns null ⇒ the WHOLE sidecar is skipped" | OK | Returning `null` is an existing convention (4 sites) and `scanLayer` already does `const meta = normalizeMeta(parsed); if (!meta) continue;` (:330-331). |
| 49 | Task 10 test | `reg.v1only.version === '1'` ("the legacy string version field is not overloaded") | OK | `:242 version: typeof raw.version === 'string' \|\| typeof raw.version === 'number' ? String(raw.version) : '1',` — defaults to `'1'` (overridable by the sidecar, which `writeMeta` never sets). |
| 50 | Task 10 Why-paragraph | `agent-store.updateAgent` round-trips `{...existing, ...rawMeta}` (`agent-store.mjs:86-110`) | DRIFT | Real code at **:97-99**: `const base = { ...existing }; if (base.descriptionDerived) base.description = ''; const raw = { ...base, ...rawMeta };`. The *argument* (a v2 sidecar would lose its ports without the merge) holds. Cite `:97-99` and quote the real 3 lines. |
| 51 | Task 10 Step 5 | `grep -n "res.json({ agents" ui/server.mjs` → `:3913`; handler passes normalized metas through untouched; `ui/server.mjs:3907-3913` needs no edit | OK | `3913:    res.json({ agents, channels: collectChannelIds(all) });`; `app.get('/api/agents'` at :3907; the array is `listAgents()` output filtered only by `scope !== 'workspace-only'`. No field list to update. (`collectChannelIds` is defined locally at `ui/server.mjs:3890`.) |
| 52 | Task 10 Files | rewrite `test/agent-registry-schema-v2.test.mjs:90-99` (`promptHints === ''` for all 11) | OK, exact | The test block is exactly :90-:99 and asserts `assert.equal(m.promptHints, '')` at :95 inside a loop guarded by `Object.keys(reg).length === 11` at :92. |
| 53 | Task 10 Step 1 | `join` already imported; add three new imports | OK | `:10 import { join } from 'node:path';`. `node:fs` is already imported as `{ mkdtempSync, writeFileSync, rmSync }` — the new `{ readdirSync, readFileSync }` names do not collide; `AGENTS_DIR` / `rawSidecars` are free. Helpers `tmp()` (:14), `writeMeta(dir, key, fields)` (:17, **three** params) and `load(dir)` (:24) all exist as the new tests use them. |
| 54 | Task 10 test | PORT_CHANNELS / CHANNEL_DELTA match dev's real `consumes`/`produces` | OK | Replayed for all 11: `manualTestsChecklist.consumes=['plan','code']` ⇒ missingIn `['code']` ✓; `manualWebUiTesting.consumes=['checklist','code']` ⇒ missingIn `['code']` ✓; `implementer.consumes=['plan','review']` ⇒ extraIn `['decomposition']` ✓; `planner.consumes=['userPrompt','clarify','review']`, `produces=['plan']` ✓; `refiner.produces=['plan','review']` explained by the verdict rule ✓. `channelDefs` normalizes to `[]` for all 11 ✓. |

## 7. P2b — DB, store, API (Tasks B1–B9)

| # | Plan location | Claim | Verdict | Correction |
|---|---|---|---|---|
| 55 | B1 Files | `SCHEMA_VERSION :56` | OK | `:56 export const SCHEMA_VERSION = 22;` |
| 56 | B1 Files | `INCREMENTAL_COLUMNS :732-745` | DRIFT (−3) | Real range **:732-742**. Current entries: `pipelines` :733-736 (13 keys), `pipeline_steps: { session_id: 'TEXT', skills: 'TEXT', graphify_count: 'INTEGER' }` :737, `workflows: { domain: 'TEXT', origin: 'TEXT' }` :739 — all exactly as the plan's "add to the EXISTING entries" edit assumes. Cite `:732-742`. |
| 57 | B1 Files | `INCREMENTAL_TABLES :752-766` | OK, exact | `:752 const INCREMENTAL_TABLES = {` … `:766 };` |
| 58 | B1 Files | "the ladder `:1051-1073`"; insert after `if (current < 22) applySchemaV22(db);` (`:1072`) | DRIFT (start −2), anchor OK | The ladder starts at **:1049** (`if (current < 1)`); `:1051` is `if (current < 3) db.exec(SCHEMA_V3);`. The load-bearing line is exact: `:1072 if (current < 22) applySchemaV22(db);` and `:1073` stamps `PRAGMA user_version`. Cite `:1049-1073`. |
| 59 | B1 prose | "`db.mjs:725-760` are those maps; `:845` is `reconcileSchema`, the fast-path heal" | DRIFT (+10 on :845) | `:845` is JSDoc prose. Real: `schemaGaps` **:814**, `repairSchemaGaps` **:834**, `reconcileSchema` **:855**. Cite `db.mjs:732-766` for the maps and `:855` for `reconcileSchema`. (Spec §10.1 carries the same stale `:845`.) |
| 60 | B1 Step 2 | `applySchemaV23(db) { repairSchemaGaps(db, schemaGaps(db)); }` mirrors `applySchemaV22` | OK | `:1013-1015 function applySchemaV22(db) { repairSchemaGaps(db, schemaGaps(db)); }` — byte-identical shape. |
| 61 | B1 | none of the v23 columns/table exist on dev | OK | `workflows` (id,name,version,steps,feedbacks,created_at,updated_at + domain,origin) has no `graph`/`archived_at`; `pipeline_steps` has none of execution_id/exec_kind/agent_key/ended_at/exec_trigger/exec_result/exec_meta; `pipelines` has no `outcome`; `config_workflow_wires` has zero hits. |
| 62 | B1 | `getDb`, `migrate`, `prepare`, `tx` (and `SCHEMA_VERSION`) are exported | OK | :69, :1031, :1139, :1115, :56. |
| 63 | B1 DDL block | matches spec §10.1 verbatim | OK | Statement-for-statement identical; the plan only appends trailing `--` comments. |
| 64 | B1 test | `ALTER TABLE pipelines DROP COLUMN outcome` works; `PRAGMA table_info` preserves declared PK order | OK | Verified on this machine: Node **25.6.1**, `node:sqlite` **SQLite 3.53.0** — DROP COLUMN succeeds; a `PRIMARY KEY (b,a,c)` reports pk order `["b","a","c"]`, so both `pkOrder` assertions hold. |
| 65 | B1 Step 3 | `test/db.test.mjs` `EXPECTED_TABLES :74-92`, 18-table assertion `:126` | DRIFT (+1 on end) | Real `EXPECTED_TABLES` is **:74-93** (18 entries, `config_workflow_feedbacks` at :81 followed by `pipelines`). `:126 assert.equal(EXPECTED_TABLES.length, 18, 'the spec defines exactly 18 tables (v11: +step_questions)');` ✓ and the title at `:120` is `migrate creates all 18 spec tables` ✓. Cite `:74-93`. |
| 66 | B1 Step 4 + B10 Step 2 | pin sweep `grep -rn -A1 "user_version" test/*.mjs \| grep -w 22 \| grep -v db-migrate-v23` → **`Expected: empty output both times`** | **WRONG** | On dev today it prints **6 lines**. `grep -w 22` matches the *line number* `:22:` as a word, so `db-pause-schema.test.mjs:22`, `subagent-migration-v7.test.mjs:22`, `subagent-migration-v6.test.mjs-22-`, `subagent-migration-v8.test.mjs:22` are permanent false positives no edit can remove. Only 2 of the 6 are the real prose comments (`ask-db-schema.test.mjs:80`, `diff-comments-schema.test.mjs:72`, both reading `17 -> 22`). Fix the command to `grep -rnE "user_version[^0-9]*=[^0-9]*22" test/*.mjs \| grep -v db-migrate-v23` and set `Expected:` to the two comment lines before the edit, empty after. |
| 67 | B1 Step 4 | the two comments are at `ask-db-schema.test.mjs:80` and `diff-comments-schema.test.mjs:72`, reading `17 -> 22` | OK, exact | Both quoted verbatim. |

| # | Plan location | Claim | Verdict | Correction |
|---|---|---|---|---|
| 68 | B2 Files | `rowToTpl :206`, `readRaw :221`, `writeWorkflow :239`, `readWorkflow :277`, `listWorkflows :287`, `resolveWorkflow :371` | OK — all six exact | `:206 function rowToTpl(r) {`, `:221 function readRaw(id) {`, `:239 export async function writeWorkflow(tpl) {`, `:277 export async function readWorkflow(id) {`, `:287 export async function listWorkflows() {`, `:371 export async function resolveWorkflow(projectDir, workflowId, registry, agentsDir = DEFAULT_AGENTS_DIR, opts = {}) {`. |
| 69 | B2 Step 2 | `readRaw`'s current SELECT column list | OK | `:225 'SELECT id, name, version, domain, steps, feedbacks, created_at, updated_at, origin FROM workflows WHERE id = ?'` — the plan's `ROW_COLS` adds `graph, archived_at` to exactly this list. |
| 70 | B2 Step 2 | `resolveWorkflow` — insert "immediately after `if (!tpl) throw new Error(...)`" | OK | `:372-373 const tpl = await readWorkflow(workflowId); if (!tpl) throw new Error(\`workflow not found: ${workflowId}\`);`. |
| 71 | B2 | `writeGraphWorkflow` needs `slugify`, `normDomain`, `isSafeWorkflowId`, `tx`, `prepare` in scope | OK | `slugify` imported at `workflows.mjs:18` from `./artifacts.mjs`; `normDomain` local `:32`; `SAFE_WORKFLOW_ID` `:196` / `isSafeWorkflowId` `:197` (module-private, same file); `tx`/`prepare` imported `:15`. `slugify('Graph One')` → `graph-one`, so `saved.id === 'wf_graph-one'` ✓. |
| 72 | B4 Files | `workflowNodeDefaults :179`, `setWorkflowNodeDefaults :311`, `resolveWorkflow :371`, effort line `:427` | OK — all four exact | `:427 effort: firstDefined(sel.effort, legacy.effort, (sel.model \|\| legacy.model) ? undefined : wfDef.effort),`. |
| 73 | B4 | `resolveRunConfig`, `readConfig`, `loadAgentFile`, `DEFAULT_AGENTS_DIR`, `DEFAULT_MAX_CYCLES` "are already imported/declared in the module" | OK | `resolveRunConfig`+`readConfig` imported `:17`; `loadAgentFile` local `:47`; `DEFAULT_AGENTS_DIR` imported `:19`; `DEFAULT_MAX_CYCLES = 3` local `:25`. |
| 74 | B4 | `workspaceVariants(reg)` deep-equals `{ reviewer: reg.workspaceReviewer }` | OK | Only `workspaceReviewer` and `workspaceScanner` carry `scope: "workspace-only"` on dev, and Task 9 gives only `workspaceReviewer` a `workspaceVariantOf`. `LAYER_RANK(meta.origin)` works: `scanLayer` stamps `origin` as `'builtin' \| 'user' \| 'plugin:<name>'` (`agent-registry.mjs:332`, callers :359/:364/:385). |
| 75 | B4 Step 2 | `resolveGraph` builds `const portsFn = registryPortsFn(agentsByKey)` and derives `loopWireIds` from it | **WRONG on a workspace resolve** | `agentsByKey` is keyed by the **substituted** key (`workspaceReviewer`) while `tpl.nodes[].key` is still the **authored** key (`reviewer`) — and `registryPortsFn` re-keys through `indexByKey`, i.e. by `meta.key`. So on `{isWorkspace:true}` every substituted node resolves `known:false`, `classifyLoops` finds **no loop wires**, and `resolveGraph` returns `wires: {}` — every per-wire budget silently lost. The same map is then handed to `buildGraphManifest(g.template, g.agentsByKey, …)` per B4's stated P4 contract, so the whole manifest would come back portless (empty `ports.inputs/outputs`, `label` falling back to the key, no `feedbacks`). B4's own workspace test never asserts `g.wires`, so it passes. Fix: keep a parallel `const metaByAuthored = {}` (`metaByAuthored[authored] = meta`) and use `portsFnFor(metaByAuthored)` for `classifyLoops`; return it (e.g. as `agentsByNodeKey`) so P4 can pass it to `buildGraphManifest`. |
| 76 | B4 Refusals | `resolveGraph` throws `workflow not found: <id>` for an unknown id | DRIFT (inconsistent with B2) | B2's `assertRunnableWorkflow` throws `unknown workflowId "<id>"` for the same condition. Not a bug (different callers), but pick one text or note the divergence. |
| 77 | B3 Files | `readWorkflowsMap :550`, `setFeedbackCycles :674`, `resetWorkflowConfig :701`, `resolveRunConfig :747` in `src/core/config.mjs` | OK — all four exact | `:550 function readWorkflowsMap(key) {`, `:674 export async function setFeedbackCycles(projectDir, workflowId, fbId, maxCycles) {`, `:701 export async function resetWorkflowConfig(projectDir, workflowId) {`, `:747 export async function resolveRunConfig(projectDir, workflowId) {`. |
| 78 | B3 Step 2 | `ensure` currently builds `{nodes:{},feedbacks:{}}`; `resolveRunConfig` currently returns `{nodes, feedbacks}` | OK | `:553-556` and `:747-753` confirmed verbatim. `projectKey` is imported into config.mjs from `./store.mjs` (`:15`), so `setWireCycles` can use it. |
| 79 | B5 Files | `GET /api/workflows :3116`, `GET /:id :3126`, `POST :3136`, `PATCH …/defaults :3177` | OK — all four exact | Also `:3155 if (err) return badRequest(res, err);`, `:3161`/`:3164` comment + catch, `:3200 app.delete('/api/workflows/:id'`. |
| 80 | B5 Step 2 | insert "FIRST thing after `const body = req.body || {}`" | OK | `:3137 const body = req.body || {};` is literally the first line of the POST handler. Today's v1 path 400s with `{ error: 'invalid workflow', errors, warnings }` (`:3160`) — matches the plan's "v1 bodies keep today's path". |
| 81 | B5 Step 2 | `badRequest(res, msg)`, `isTruthy(...)`, `AGENTS_DIR`, `loadAgentRegistry(AGENTS_DIR)` all available in `ui/server.mjs` | OK | `badRequest` :795-797, `isTruthy` :4758-4762, `AGENTS_DIR = path.join(PROJECT_ROOT,'agents')` :166, `loadAgentRegistry(AGENTS_DIR)` already called at :3158 (single positional arg). |
| 82 | B5 Step 2 | `GET /api/workflows` handler signature | DRIFT (silent) | Dev has `app.get('/api/workflows', async (_req, res) => {` — the plan's replacement uses `req.query.archived`, so the `_req` → `req` rename is mandatory. The plan's code block already writes `(req, res)`; add an explicit note so a diff-minded executor does not keep `_req`. |
| 83 | B5 Step 2 | ui/server.mjs's workflows import must gain `assertRunnableWorkflow, writeGraphWorkflow` | OK | Current: `import { DEFAULT_WORKFLOW, listWorkflows, readWorkflow, writeWorkflow, deleteWorkflow, setWorkflowNodeDefaults, workflowNodeDefaults } from '../src/core/workflows.mjs';` (:94-97). |
| 84 | B6 Files | `PATCH /api/config :2751`, `DELETE /api/config/workflow :2792`, `GET /api/config :2687` needs no edit | OK — all three exact | The PATCH doc comment today reads `// body: { projectDir, workflowId, nodes?:{[id]:{model,effort}}, feedbacks?:{[id]:{maxCycles}}, activeWorkflowId? }` and the two existing guards are `'workflowId is required to set node config'` / `'workflowId is required to set feedback config'` — so the plan's new `'workflowId is required to set wire config'` follows the house pattern exactly. (`POST /api/config` is `:2721`.) |
| 85 | B7 Files | `POST /api/run :1062` | OK, exact | `:1062 if (!(await readWorkflow(workflowId))) return badRequest(res, \`unknown workflowId "${workflowId}"\`);` — the 400 text is byte-identical to `assertRunnableWorkflow`'s NOT_FOUND, as the plan claims. `workflowId` is normalized to `'wf_default'` at `:1061`, so routing it through `assertRunnableWorkflow` is behavior-preserving. |
| 86 | B7 Files | CLI: `createOrchestrator({` at `worca-cc.mjs:1526`; `fail()` at `:165` writes `worca: <msg>` and exits 2 | OK — both exact | `:165-168 function fail(msg) { process.stderr.write(\`worca: ${msg}\n\`); process.exit(2); }`. `--workflow` is wired at :88 (takesValue), :101 (flag map), :213 (help), :1532 (`workflowId: flags.workflow \|\| undefined`). A second `createOrchestrator({` at :809 is the resume path and does not set `workflowId` — the plan's single insertion point is correct. |
| 87 | B7 Files | `src/core/ask/proposal.mjs:104-106` and `:160` | OK — exact | `:104-106` are the three lines the plan replaces; `readWorkflow` is imported at `:9` as `realReadWorkflow` and injected at `:57`, so `assertRunnableWorkflow` must be injected the same way (the plan's snippet calls it as a bare import — note the injection seam). `PROPOSAL_ERRORS.unknownWorkflow` = `` `unknown workflowId "${id}"` `` (:23) ✓. |
| 88 | B8 Files | `shapeWorkflow :18`, catalog wiring `:45-57` | OK | `:18 export function shapeWorkflow(tpl, registry = {}) {`; return key order is exactly `id, name, domain, origin, steps, feedbacks` and `feedbacks` today maps to `{id, from, to}` only (no `maxCycles`) — matching B8's test expectations. |
| 89 | B9 Files | `agent-store.mjs:133` is the reference scan | OK, exact | `:133-135` is the `listWorkflows()` filter the plan replaces; `:137` throws code `'REFERENCED'`. `createAgent` is at **:54**, not `:53` (`:53` is its JSDoc) — DRIFT (+1) in the B9 test comment `// createAgent({ meta, markdown }) — agent-store.mjs:53`; the destructured signature `({ meta: rawMeta, markdown } = {})` is otherwise correct. |
| 90 | B9 | `listWorkflows({includeArchived:true})` in `deleteAgent` | OK (ordering) | `listWorkflows()` today takes **zero** parameters; the option is added in B2, which precedes B9. Note this is also a small behavior change: an archived workflow will now block an agent deletion. |
| 91 | B9 Files | `plugin-workflows.mjs:150-178`, SQL `'SELECT id, name, steps FROM workflows WHERE origin IS NULL OR origin != ?'` | OK (SQL byte-exact); DRIFT (+1 end) | `referencedPluginAgents` is `:150-179`; the SQL at `:166` is byte-identical to the plan's quote. |
| 92 | B9 Files | `app.js` `composerRenderList :2561`, `buildNodeConfigRows :2669`, `buildFeedbackRows :2813`; `const listEl = …` at the top of `composerRenderList`; `composer.saved` | OK — all exact | `:2669 function buildNodeConfigRows(workflow, registry, runConfig, opts = {}) {` (first param is literally `workflow`); `composerRenderList`'s second line is `const listEl = composer.els.list, cntEl = composer.els.count;` (one combined `const` — the insert goes after the whole statement); `composer.saved` is the real state property. |
| 93 | B5 test | boot preamble lifted from `test/api-workflows.test.mjs` provides `homeDir` and `base` | OK | `:17 let homeDir, srv, base, prevHome;`, `useTempHome(after)` `:15`, `WORCA_MOCK='1'` `:25`, `const { app } = await import('../ui/server.mjs')` `:26`, `http.createServer(app).listen(0)` `:27-28`, `base = \`http://127.0.0.1:${srv.address().port}\`` `:29`. |

## 8. Task 13 — the seed drift guard (reproduced end-to-end)

| # | Plan location | Claim | Verdict | Correction |
|---|---|---|---|---|
| 94 | Task 13 preamble | "every one of the 8 graphs yields **0 errors and 0 warnings**" against the real (ported) sidecars | **OK — reproduced** | Harness: P1's `constants.mjs`+`verdict.mjs` + P2's `ports/loops/validate/agent-meta` extracted verbatim, the 11 dev sidecars merged with Task 9's v2 blocks and normalized through `normalizeAgentMeta` (0 errors, 0 warnings), then `validateGraph` over `SEED_TEMPLATES` + `GRAPH_DEFAULT_WORKFLOW` from the old branch. Result per graph: wf_full 11/17 **0E/0W**, wf_no-clarify 9/13 **0E/0W**, wf_provided-plan 9/14 **0E/0W**, wf_full-no-decompose 10/15 **0E/0W**, wf_quick-fix 5/6 **0E/0W**, wf_clarify-implement 7/10 **0E/0W**, wf_clarify-quick-fix 6/8 **0E/0W**, wf_default 7/10 **0E/0W**. **Caveat: only after correction #6** — unpatched, all 8 throw `TypeError: KINDS.has is not a function`. |
| 95 | Task 13 `LOOP_WIRES` table | node/wire pin counts and loop-wire sets | OK — all 8 match exactly | `classifyLoops` returned exactly `wf_full [w12,w15,w5]`, `wf_no-clarify [w10,w3]`, `wf_provided-plan [w12,w2,w9]`, `wf_full-no-decompose [w10,w13,w5]`, `wf_quick-fix [w5]`, `wf_clarify-implement [w5,w9]`, `wf_clarify-quick-fix [w7]`, `wf_default [w5,w9]` (default lexicographic `.sort()`, as the test uses). |
| 96 | Task 13 third test | `FB_WIRE_MAP` names exactly the loop wires of each seed | OK | Every `Object.values(FB_WIRE_MAP[id]).sort()` equals the measured loop-wire set, `wf_default` included. |
| 97 | Task 13 second test | `const budgeted = w.config && w.config.maxCycles !== undefined; assert.equal(budgeted, loopWireIds.has(w.id), …)` | **WRONG — always fails** | For every wire with **no** `config` key (the majority in all 8 seeds), `w.config && …` evaluates to `undefined`, and `node:assert/strict`'s `assert.equal` is `strictEqual`: `undefined !== false` throws `Expected values to be strictly equal: undefined !== false`. Verified. Fix: `const budgeted = Boolean(w.config && w.config.maxCycles !== undefined);` |
| 98 | Task 13 note | `SEED_TEMPLATES`, `FB_WIRE_MAP`, `GRAPH_DEFAULT_WORKFLOW` "are already imported by P1's version of this file" | OK | P1 Task 10's file imports `{ SEED_TEMPLATES, NODE_ID_MAP, FB_WIRE_MAP }` from `src/core/graph/seed-templates.mjs` and `{ GRAPH_DEFAULT_WORKFLOW, deepFreeze }` from `src/core/graph/builtin-workflows.mjs`. |
| 99 | Task 13 | "Zero warnings is only reachable because of V18(a)(b)(c)(d) and V19's OR/AND/End/await exemption" | OK | Confirmed by construction in the run: every seed's blocking wires land on `or.inK`, a `loop:true` input, or a self-wire; the checklist/webui nodes are `await`- and `task`-fed. |

## 9. V1–V21 rule texts vs the old branch and Amendment f

Old branch `src/core/graph/validate.mjs` (579 lines) is **already Amendment-f-shaped**. Rule-by-rule, the ONLY
changes beyond `msg` → `message` are the four the plan itself declares (RULES table, `{ok,errors,warnings}`,
V1 limits, V4 split, `formatIssue`), plus two additive `portId`/`wireIds` extras. Amendment f's own text for
V7 (universal single-wire, counted over ALL wires), V8 (OR valve resolution), V12 (arity ≥ 2 + inK wired +
OR homogeneity), V16 (a wired `await` counts), V18 (exactly four exemptions, (d) load-bearing), V19
(AND/OR `inK` + End `result` + agent `await` exempt, Combine still warns), V20/V21 and V22 (RETIRED,
number reserved) all match the plan word-for-word.

| # | Plan location | Claim | Verdict | Correction |
|---|---|---|---|---|
| 100 | Task 3 preamble, edits (a)–(d) | "the only change vs the old branch is `msg`→`message` + the four listed edits" | OK, with 2 undeclared additive extras | V7 now also stamps `nodeId`/`portId`, V9 stamps `portId` — neither existed in the old branch. Harmless; mention them in the edits list for completeness. |
| 101 | Task 3 "Consumes" line | `validate.mjs` consumes `constants.mjs` (`KINDS, PORT_TYPES, NODE_ID_RE, LIMITS`) | DRIFT | The code imports only `{ KINDS, NODE_ID_RE, LIMITS }`; `PORT_TYPES` is never used in `validate.mjs`. Drop it from the Consumes line. |
| 102 | Task 1 "Consumes" line | `ports.mjs` consumes `FLOW_KINDS` | DRIFT (dead import) | `ports.mjs` imports `FLOW_KINDS` but `flowPorts` compares kind strings directly and never reads it. Either drop the import or use it (`if (!FLOW_KINDS.includes(kind)) return undefined;`). |
| 103 | Task 7 impl | `agent-meta.mjs` re-declares `const PORT_ID_RE = /^[a-z][A-Za-z0-9_-]{0,31}$/` instead of importing P1's | DRIFT (single-source violation) | P1's shared `PORT_ID_RE` is `/^[a-z][A-Za-z0-9]{0,31}$/` (its test explicitly pins `in-1`/`in_1` as NON-matching), while Amendment f's prose and the local copy allow `_`/`-`. As written, `constants.mjs`'s `PORT_ID_RE` is consumed by nothing except Task 0's existence grep. Decide one: relax P1's constant to `[A-Za-z0-9_-]` and import it, or state in Task 7 that the port-id shape deliberately differs from the node-id family and that P1's `PORT_ID_RE` is unused by P2. |
| 104 | P1 contract | `WIRE_ID_RE` is "consumed by P2's ports/loops/validate/template/geometry/layout/manifest" | DRIFT | P2 never uses `WIRE_ID_RE` (wire ids are only checked for uniqueness, V6 — matching old-branch parity). Either add a V2-style wire-id shape check or note that `WIRE_ID_RE` stays unconsumed until P5. |
| 105 | Task 3 | `LIMITS` are "the structural ceilings the validator enforces" | DRIFT (2 of 7 wired) | Only `maxNodes`/`maxWires` are read (V1). `minArity`/`maxArity` are not (V12 hard-codes `< 2` and never rejects an oversized arity — `gatePorts` silently clamps to 8, so `config.arity: 99` renders 8 ports with no error), `maxCycles` is not (V13 checks only `>= 1`), `maxNameLen` is not. Either wire them into V12/V13 or scope the sentence to "`maxNodes`/`maxWires`; the other keys are reserved for P5". |

## 10. Counts, texts and commands

| # | Plan location | Claim | Verdict | Correction |
|---|---|---|---|---|
| 106 | Task 14 Step 1 | `BASELINE + 97` — itemised 8+7+23+10+10+5+2+11+2+3+2+9+2+3 | OK | Arithmetic checks out (97) and every measurable term was measured. |
| 107 | Task B10 Step 1 | `BASELINE-B + 37` — 4+6+4+7+(5+3)+3+3+2 | OK | Arithmetic checks out (37); each test file's `test(...)` count matches. |
| 108 | Every `Expected: FAIL — Cannot find module …` | Node's real text | OK | Node 25.6.1 prints `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<abs path>' imported from <abs path>`. |
| 109 | Task 8 Step 1 `Expected: FAIL — SyntaxError: The requested module '…' does not provide an export named 'MOCK_WRITER_ROLES'` | Node's real text | OK | Verified verbatim (Node prints the RESOLVED specifier, not the source text — cosmetic). |
| 110 | B1 Step 1 `Expected: FAIL — AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 22 !== 23` | Node's real text | OK | `assert/strict` prints `Expected values to be strictly equal:\n\n22 !== 23`. |
| 111 | Task 9 Step 3 | `git diff agents/ \| grep '^-' \| grep -v '^---'` shows ONLY the 7 replaced headings and their bullets | OK | The 7 `## Inputs` sections are the only deletions the plan's edits produce; the JSON edits are pure additions. |
| 112 | Global Constraints | "Never hand-write graph error strings in `ui/server.mjs`: a 422 body carries `validateGraph`'s own issues by construction" | OK | B5's handler passes `errors`/`warnings` straight through; the B5 test's `deepEqual` identity holds because no V-rule reads `tpl.id` (the test's `id: ''` vs the server's `id: undefined` cannot diverge). |
| 113 | Header | "Node ≥ 22 (`node:sqlite`, `node:test`)" | OK | This machine runs Node 25.6.1 / SQLite 3.53.0; `node:sqlite` still emits an `ExperimentalWarning` (pre-existing, not P2's). |

---

## The 10 most consequential corrections

1. **Task 3 `validate.mjs` V3 — `KINDS.has(n.kind)` throws.** P1's `KINDS` is a frozen **array**. Every
   `validateGraph()` call dies with `TypeError: KINDS.has is not a function` — the seed drift guard, all 23
   validate tests, the manifest round-trip, the 422 path, `canWire`'s siblings and the composer's live report.
   → `if (!KINDS.includes(n.kind)) {`

2. **Task 9 `implementer.meta.json` vs Task 10's test — six hints, not five.** Task 9 adds a top-level
   `"promptHints": "Work inside the project directory (your cwd). Commit nothing; just edit files and tests."`,
   which Task 10's `assert.deepEqual(… ['manualTestsChecklist','manualWebUiTesting','planReviewer','refiner','workspaceReviewer'])`
   rejects. The old branch's implementer carries no `promptHints`.
   → Delete that one line from Task 9's implementer block (its three per-port `directive`s already say it),
   or add `'implementer'` to Task 10's array and change "Exactly five" to "Exactly six".

3. **Task 13 seed guard — the budget-placement assertion can never pass.**
   `const budgeted = w.config && w.config.maxCycles !== undefined;` yields `undefined` for every config-less wire
   and `assert.equal(undefined, false)` throws under `node:assert/strict`.
   → `const budgeted = Boolean(w.config && w.config.maxCycles !== undefined);`

4. **Task B4 `resolveGraph` loses every loop budget on a workspace run.** `registryPortsFn(agentsByKey)` re-keys
   by `meta.key` (the **substituted** key) while the template still holds the **authored** key, so `classifyLoops`
   sees no ported agents, `wires` returns `{}`, and the manifest P4 builds from the same map is portless.
   → Keep `const metaByAuthored = {}` alongside `agentsByKey`, use `portsFnFor(metaByAuthored)` for
   `classifyLoops`, and return it so P4 can feed `buildGraphManifest` the authored-key map.

5. **Tasks B1 Step 4 / B10 Step 2 — the version-pin sweep can never print empty.**
   `grep -w 22` matches the *line number* `:22:`, so four `subagent-migration-*` / `db-pause-schema` hits survive
   any edit; only two of the six lines are the real `17 -> 22` comments.
   → `grep -rnE "user_version[^0-9]*=[^0-9]*22" test/*.mjs | grep -v db-migrate-v23`, and set
   `Expected:` to "the two comment lines before the edit, empty after".

6. **Task 3 V2 — the error message names a regex the validator never applies.** The code tests
   `NODE_ID_RE` = `/^n_[a-z0-9]{1,32}$/` but reports `/^[A-Za-z0-9_-]{1,64}$/` (the old branch's local constant).
   → `` add(`node id ${JSON.stringify(id)} must match ${NODE_ID_RE}`, { nodeId: id }); `` and fix the rule table row.

7. **Task 3 V3 — the rule table's message order contradicts the code.** Table says
   `agent, task, and, or, combine, end`; `[...KINDS].join(', ')` emits `agent, task, end, and, or, combine`.
   → Fix the table prose (KINDS' order is P1's contract) or build the message from a display-order copy.

8. **Task 0 Step 4 — the `LIMITS` fallback is dead and its numbers contradict P1.** P1 ships
   `maxNodes: 80, maxWires: 200`; the plan tells the executor to add `60 / 120`.
   → "P1 ships `maxNodes: 80, maxWires: 200` — verify, do not add."

9. **Two db.mjs anchors are stale (they also appear in spec §10.1).** `reconcileSchema` is at **:855**, not `:845`
   (`:845` is JSDoc prose); `INCREMENTAL_COLUMNS` is **:732-742**, not `:732-745`; the ladder starts at **:1049**,
   not `:1051` (the load-bearing `:1072 if (current < 22) applySchemaV22(db);` is exact). `test/db.test.mjs`'s
   `EXPECTED_TABLES` is **:74-93** (18 entries), not `:74-92`.
   → Update the four citations in Task B1's Files line and prose.

10. **Small anchor drifts that would send an executor to the wrong line.**
    `normalizeMeta` ends at **:248** (not `:249`); the Windows `fileURLToPath` fix is at
    `agent-registry.mjs:28` (not `:29`); `createAgent` is at `agent-store.mjs:54` (not `:53`);
    `referencedPluginAgents` ends at `plugin-workflows.mjs:179` (not `:178`); `updateAgent`'s round-trip is
    `{ ...base, ...rawMeta }` at **:97-99** (not `{...existing, ...rawMeta}` at `:86-110`); the mock test files
    are `claude-runner-ask-mock / skill-mock / subagent-mock / workspace-mock`, not
    `mock-runner.test.mjs` / `mock-graphify.test.mjs`.

## Verdict counts

| Verdict | Count |
|---|---|
| OK | 86 |
| DRIFT | 20 |
| WRONG | 7 |
| MISSING | 0 |
| **Total claims checked** | **113** |

**The 7 WRONG rows:** #3 (Task 0's dead `LIMITS 60/120` fallback) · #6 (`KINDS.has` — TypeError) ·
#8 (V2's message names a regex the code never applies) · #36 (Task 9's implementer `promptHints` breaks
Task 10's five-hint assertion) · #66 (the version-pin sweep's `Expected: empty output`) ·
#75 (workspace `resolveGraph` drops every loop budget) · #97 (Task 13's `budgeted` assertion can never pass).

Nothing was MISSING: every file, symbol, route, test and helper the plan names exists (or is correctly
identified as produced by P1 / by P2 itself). The `.md`/`.meta.json` line citations in Task 9 are byte-exact,
`claude-runner.mjs`'s 14 switch arms are exactly where and what the plan says, and all four `config.mjs`
and all six `workflows.mjs` anchors hit dead-on.

## Seed validation — the headline empirical result

**All 8 shipping graphs validate 0 errors / 0 warnings against the real (Task-9-ported) sidecars, and every
loop-wire set matches the plan's table and `FB_WIRE_MAP` exactly — but only after `KINDS.has` → `KINDS.includes`.**
Unpatched, `validateGraph` throws on the first node of every template, so Task 13 as written cannot pass.

Reproduction: `/private/tmp/claude-501/-Users-denislavprinov-Develop-worca-cc/ea320046-44d4-4f4c-b84b-0707426277b2/scratchpad/p2-anchors/`
(`run-seeds.mjs`, `shared/graph/*.mjs`, `test/*.test.mjs`, `agents/*.meta.json`). No repo file was modified.
