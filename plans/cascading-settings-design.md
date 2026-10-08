# Cascading settings: user → project, with engine-scoped models

Date: 2026-10-02. Branch: `claude/worca-instance-restart-ef1079`.
Builds on the harness bridge's per-run engine picker (§10.4) and the Away mode layering
([`plans/away-mode-design.md`](away-mode-design.md) D8).

## 1. Problem and goal

Settings live at one level: the user's `~/.worca-cc/settings.json`. A developer who wants Codex
for one project and Claude for another, or a tighter pipeline cost cap on one repo, has no place
to say so. The engine is chosen per run and never remembered, so every New pipeline starts on
Claude. Model selection only knows Claude ids; a Codex run drops them and falls back to Codex's
own default model. Worse, a Codex run still calls Claude for its title, the auto-workflow
classifier, the overview and the PR description, so "run this on Codex" is only half true.

Away mode and sync already cascade project > user (> team), each with its own code. This design
generalises that into one cascade for a curated set of settings, and maps model selection onto it
per engine.

**Success:**

- The developer sets "Default engine: Codex" on a project; every New pipeline in that project
  opens on Codex and says where the default came from. Other projects still open on their own
  default.
- The developer sets Codex step models once in Settings; a project can override one role. A Codex
  run uses those ids instead of Codex's built-in default.
- A Codex run makes no Claude calls: its title, classifier, overview and PR description run on
  Codex too.
- Every project field shows what it would inherit and from where ("Same as my settings (Opus)",
  "Team default (…)"), and clearing a field returns it to inherit.

## 2. Decisions (agreed with the developer)

| # | Decision |
|---|---|
| D1 | A **curated** set of settings cascades (§3.1). Machine-scoped keys stay user-only. |
| D2 | Order per field: **project > user > team default > built-in**. Team caps still fold afterwards (`effectiveCap`), unchanged. Absent = inherit. |
| D3 | The project layer lives in the DB (`project_config`), per machine, never committed. Sharing with a team stays team policy's job. |
| D4 | Project settings are edited on a new **Settings** tab on the project page. The Away tab's content moves into it. User Settings keeps its layout. |
| D5 | Model slots are **engine-scoped**: `models.<engine>.steps.<role>` and `models.<engine>.utility.<job>`. A Codex run never inherits a Claude model id and vice versa. |
| D9 | The **model catalog is engine-aware**: every entry carries `engine`. Codex built-ins come from `CODEX_PRICES`; custom models (global, plugin, policy) may name `engine: 'codex'`. A model belongs to an engine through its catalog entry. |
| D10 | **Pickers filter by the engine in effect** where one is known (New pipeline, Settings engine cards, run-scoped jobs); where none is known (composer node, project step models) they show one list grouped "Claude" / "Codex", and a pick of the other engine is skipped at run time (§4.2). |
| D11 | **Utility jobs on Codex run read-only**: `--sandbox read-only`, no writable dirs, bounded by the job's timeout. This replaces Claude's tool lockdown for untrusted input (PR description, titles). |
| D8 | **Every model job uses the engine of what it belongs to.** A run's title, auto-workflow classifier, overview and PR description use the run's engine (§4.3). An Ask Worca chat runs on the chat's engine, and its chat title follows it (D12, §4.6). |
| D12 | **Ask Worca runs on the engine the user picks; the engine is fixed per chat.** A chat's engine is `engineOfModel` of its model at the first turn (no new column). Inside a chat the model picker lists only that engine's models; switching engine means a new chat. Delivered in Plan 2 (§11). |
| D13 | **Ask on Codex has no shell.** Codex runs `--sandbox read-only` with network off and its shell tool disabled; files are read through worca MCP tools (`read_file`, `grep`, `glob`) that enforce Ask's existing allow roots and deny rules (`ASK_DENY_RULES`). If the shell cannot be disabled, Ask on Codex refuses to start. Claude chats keep their native Read/Grep/Glob unchanged. |
| D14 | **Ask caps on Codex are enforced by a worca watchdog**: it counts the turn's tool calls against `askMaxTurns` and its estimated cost against `askMaxBudgetUsd`, stops the turn at the cap and shows the same limit notice. A budget is set and the model has no known price: the turn refuses to start, naming the model. |
| D15 | **Ask on Codex shows whole messages** when Codex's stream has no text deltas (verified in Plan 2's spike); deltas are used if present. Tool rows stream as they happen. |
| D16 | **Attachments on Codex:** images go to Codex with `-i` on the turn that carries them; PDFs show "PDFs need a Claude chat"; text attachments are unchanged. |
| D17 | **Ask engine settings are user-only**: `askEngine` (default `'claude'`) and a per-engine Ask model slot `models.<engine>.ask`. The Ask card in Settings shows one picker per engine. Ask is one panel across pages, so no project layer. |
| D6 | One declared-key registry and one resolver (`src/core/settings-cascade.mjs`) serve every cascadable key, the UI and the run path. Away mode and sync keep their stored data but resolve through it. |
| D7 | The engine is still chosen per run; the resolved default only **prefills** the picker. A run's engine is frozen in its state; resume never re-reads settings. |

## 3. Keys and storage

### 3.1 Cascadable keys

| Group | Key(s) | Value | Built-in default | Team key |
|---|---|---|---|---|
| Engine | `run.engine` | `'claude' \| 'codex'` (validated by `selectRunEngine`) | `'claude'` | none |
| Step models | `models.<engine>.steps.<role>` for engine ∈ {claude, codex}, role ∈ `agentSteps()` | `{ model?: string, effort?: string }` | none (falls through, §4.2) | `models.steps` (Claude only, as today) |
| Utility models | `models.<engine>.utility.<job>`, job ∈ {title, classifier, overview, prDescription} | `{ model?: string, effort?: string }` | Claude: today's key (`titleModel`, `autoWorkflowModel`, run model, `prDescriptionModel`); Codex: none (Codex's own default) | as today, Claude only |
| Own-run models | `memoryDefrag`, `workspaceScan`, per engine (`models.<engine>.memoryDefrag`, `models.<engine>.workspaceScan`) | as today's setters accept | Claude: today's keys; Codex: none | as today, Claude only |
| Cost | `pipelineCostLimitUsd`, `humanRateUsdPerHour` | as today | as today | as today (cap / default) |
| Ask | `askMaxTurns`, `askMaxBudgetUsd`, `askWeb` | as today; `askWeb` is replaced whole, never merged | as today | as today |
| Context & memory | `contextMaxBytesPerFile`, `contextMaxBytesTotal`, `skillMount`, memory caps and defrag thresholds (`memoryCaps()`) | as today | as today | none |
| Away mode | `nightMode` fields | as today | as today | as today |

**User-only on purpose:** `totalCostLimitUsd` and `costLimitResetPeriod` cap this machine's total
spend; a per-project value would need per-project spend accounting (out of scope). Every other
key not listed (paths, theme, uiLevel, providers, pythonPath, actions, schedule, sync's own keys,
chat, onboarding, debug) stays user-only. `askEngine` and `models.<engine>.ask` are user-only by
decision (D17). Sync keeps its existing per-project layer and API.

### 3.1a Engine-aware catalog

- `composeCatalog` (`src/core/config.mjs`) emits `engine` on every row: predefined, global,
  plugin, policy and legacy project rows are `'claude'` unless they say otherwise; a codex
  built-ins loop adds one row per `CODEX_PRICES` key (`engine: 'codex'`, `builtin: true`).
  `PREDEFINED_MODELS` itself stays unchanged (its shape is pinned by tests).
- **One row per id** (amended after Plan 1's review): a stored pick names a bare id, so two engines' rows for one id would be ambiguous. Shadowing is keyed on the lowercased id, and every user layer (global, plugin, team policy) owns an id a Codex built-in also has; the row keeps the owner's engine. `hideBuiltinModels` / team
  `models.hideBuiltins` hide Claude built-ins only.
- Custom models (`sanitizeGlobalModel`, plugin manifest models, policy catalog models) accept an
  optional `engine` (default `'claude'`). A codex entry refuses `env` / `upstream` / connection
  fields (codex ignores routing env).
- Efforts are per engine: Claude `['medium','high','xhigh','max']` (today's `EFFORTS`), Codex
  `['minimal','low','medium','high']`. `assertEfforts`, `setStep`, `setNodeModel` and workflow
  `nodeDefaultsError` validate against the entry's engine.
- Helpers: `engineOfModel(id) → 'claude' | 'codex' | null` (catalog first; an unknown id falls back
  to today's Claude-alias regex → `'claude'`, else `null`) and `catalogHasModel(id, { engine })`.

### 3.2 Storage

- **User layer:** `settings.json`, unchanged keys. New user keys: `runEngine`,
  `stepModels: { claude: { <role>: {model, effort} }, codex: { … } }` and
  `utilityModels: { codex: { title, classifier, overview, prDescription, memoryDefrag, workspaceScan } }`.
  Claude's utility slots keep reading today's keys (`titleModel`, `autoWorkflowModel`,
  `prDescriptionModel`, `memoryDefrag`, `workspaceScan`), so Claude behaviour is unchanged.
- **Project layer:**
  - Claude step models stay in the existing `project_config.steps` column (already sparse: an
    unset role is absent), so existing project choices become project overrides with no migration.
  - Everything else goes in `project_config.extra.settings`, sparse: an absent key inherits.
    Codex step models live there as `stepModels.codex`, utility slots as `utilityModels.<engine>`.
  - Away mode keeps `project_config.extra.nightMode`.

### 3.3 Registry entry

Each cascadable key is declared once:

```js
{
  id: 'run.engine',
  validate(v) { /* throws on invalid */ },
  default: 'claude',
  teamKey: null,                         // or the team-policy key whose `default` entry applies
  readUser(settings) { … }, readProject(row) { … },   // layer readers
  writeUser(settings, v) { … }, writeProject(extra, v) { … },
}
```

## 4. Resolution

### 4.1 Resolver

- `resolveSetting(id, { projectDir })` → `{ value, source, layers: { project, user, team, default } }`,
  `source` ∈ `'project' | 'user' | 'team' | 'default'`.
- `resolveAll(projectDir)` → the whole map from one read of each store (UI, run start).
- Each layer's value is validated on read. An invalid value is skipped with a one-time
  `[worca]` warning naming the key and layer; the next layer applies. It never throws.
- `projectDir` omitted (or a workspace run): the project layer is skipped, giving user > team >
  default, exactly today's answers.

### 4.2 Engine and models in a run

**Engine:** run body / CLI `--engine` > project > user > `'claude'`. `runEngineOpts`
(`ui/server.mjs`) and the CLI's flag assembly (`src/cli/worca-cc.mjs`) resolve it when the request
omits it. The result goes into run state as today; resume reads the state, never settings.

**Model per agent node**, first match wins:

1. The workflow node's model, when the run's engine owns that id.
2. The engine's step slot for the node's role: project > user > team default.
3. Claude: the run's `--model`. Codex: no `-m` (Codex's own default).

Effort follows the same chain. "Owns" means `engineOfModel(id) === run engine` (§3.1a).
`isClaudeModelId` (`src/core/run-harness.mjs`) is replaced by `engineOfModel`, so `_engineModel`,
`_engineGate` and `_claudeCallModel` stop treating codex catalog ids as Claude.

**Run state stores the engine.** Today it lives only in `resumePoint.claude.engine`; the run's
state gains `runEngine` (`state.engine` already holds the graph engine version `2`), stored in the row's `outcome` JSON and written at start only for a non-Claude engine, read by the run page, the run report, the
overview and the PR description. Runs without it read as `'claude'`.

**Resume** keeps the saved run model only when `engineOfModel(saved) === engine`
(today: `catalogHasModel(saved)`), so a resume never hands one engine the other's id.
`resolveStepModels(projectDir, fallback)` gains an `engine` argument and reads through the
resolver.

### 4.3 Run-scoped utility jobs follow the run's engine

| Job | Where | When |
|---|---|---|
| Run title | `title.mjs` via `run-harness.mjs` `generateTitle` | run start |
| Auto-workflow classifier | `auto/classify.mjs` via `orchestrator.mjs` | run start (`--workflow auto`) |
| Run overview | `overview-agent.mjs` via `ui/server.mjs` | on demand, run page |
| PR description | `pr-description.mjs` via `ui/server.mjs` | on demand, "Ship it?" |
| Night decider | `night/analysis.mjs` via `run-harness.mjs` `_nightAnalyze` | Away mode, per ask |

- Each job reads the engine from the **run's state**, never from settings, so an overview or PR
  description made later matches the run even after the default changed.
- It passes `engine` to `runClaude` (which already routes by `engine` to the adapter) and the
  model from `models.<engine>.utility.<job>`: project > user > team > default (§3.1). For Codex an
  empty slot runs `CODEX_DEFAULT_MODEL` (codex.mjs), named with `-m` so the call is priced.
- The night decider has no utility slot: its model is Away mode's "Decided by" when the run's engine
  owns it, else the run's model on that engine, else that engine's default.
- Memory defragment and workspace scan are runs of their own: they follow their own run's engine
  and its `memoryDefrag` / `workspaceScan` slot.
- Ask Worca chats and their titles follow the chat's engine (§4.6), not a run's.
- **The engine gate** judges the whole run, utility jobs included. These jobs are tool-less text
  generation, so they need no rule the gate can refuse.
- **Read-only on Codex (D11).** Utility jobs pass `sandbox: 'read-only'` and no `writableDirs`;
  the codex adapter maps it to `--sandbox read-only` (it always used `workspace-write`). The
  classifier's repo look and the night decider read the checkout through worca's `read_file` /
  `grep` / `glob` (`engines/codex-files-mcp.mjs`, the run-read deny rules); the adapter caps their
  tool calls at `maxTurns`.
- **Routing env** (`resolveModelEnv`) is skipped for a non-Claude engine; the bridged-provider
  readiness check never fires for Codex.
- **No silent fallback to Claude.** A failing Codex utility job: the title falls back to the
  plain non-model title it already uses on failure; the classifier fails through its existing
  retry and failure policy; overview and PR description show their error.

### 4.4 Other getters

`pipelineCostLimitUsd`, `humanRateUsdPerHour`, `askMaxTurns`, `askMaxBudgetUsd`, `askWeb`,
`memoryCaps`, `contextMaxBytesPerFile`, `contextMaxBytesTotal` and `skillMount` take an optional `projectDir` and delegate to the resolver. Without it they return
today's value. Call sites that know their project pass it: the run harness (`this.projectDir`),
ask spawn, run-context, orchestrator. Values stay read-at-use, so a save mid-run reaches the next
step, as cost caps already do.

Away mode's `nightLayers` / `effectiveNightConfig` are rewritten on the resolver with identical
output; its existing tests pin that.

### 4.5 Auto workflow, model test, cost, display

- `auto/model.mjs pickCatalogModel` and the classifier prompt's model list choose from the run
  engine's models only; Codex prefers its first built-in by price order instead of `/^claude-sonnet/`.
  Readiness for an auto run on Codex is `codexPreflight`, not Claude sign-in.
  `_autoFallbackDefault` writes only a run-engine model.
- `model-test.mjs testModel` passes the entry's `engine` to `runClaude` and shows a Codex hint on
  failure instead of the Claude sign-in hint.
- Cost: `liveCostRates` returns Codex rows from `CODEX_PRICES`; a Codex run passes its resolved
  model, so `estimateCodexCostUsd` stops returning null for known models.
- Run page step pills (`stepModelPillHtml`) and `run-report.mjs` show the model the node actually
  ran with (the resolved one for the run's engine), not the configured pick.

### 4.6 Ask Worca on Codex (Plan 2)

Today every Ask turn and chat title runs on Claude (`turn.mjs` calls `runClaude` with no `engine`;
`title.mjs` likewise). Plan 2 makes a chat run on its engine. **A Claude chat stays
byte-identical**: argv, system prompt, stored rows and existing tests do not change.

**Engine of a chat (D12).** `chatEngine(thread) = engineOfModel(thread.model) ?? 'claude'`. A new
chat takes its model from the Ask model slot of `askEngine` (D17). `validateModelEffort` refuses a
model of another engine in an existing chat ("this chat runs on Codex; start a new chat to use
Claude"). A stored Codex session id keeps its `codex:` prefix; the Claude adapter already refuses
prefixed ids, so a mismatched resume can never cross engines.

**Tools (D13).** The worca stdio MCP server (`mcp-stdio.mjs`) is unchanged. The codex adapter
gains MCP support: `mcpConfigPath` is translated into per-call overrides
(`-c mcp_servers.worca.command=…`, `args`, `env`; verified that codex accepts per-call MCP
servers). The normalizer already names codex `mcp_tool_call` items `mcp__worca__<tool>`, so
proposal cards and worca events (`events.mjs`) key on the same names. Codex wraps MCP results as
content; the normalizer unwraps `{content:[{type:'text',text}]}` to its text so the cards'
`JSON.parse` sees what Claude's stream gives. Registry MCP copies are offered in Claude chats only;
a Codex chat shows "Your MCP servers are available in Claude chats" once.

New worca tools, registered only for Codex chats: `read_file({path, offset?, limit?})`,
`grep({pattern, path?, glob?})`, `glob({pattern, path?})`. Each resolves the path, allows it only
under the thread's `wt/**`, `att/**` and memory roots, and refuses anything `ASK_DENY_RULES` denies
(one shared matcher with the Claude rule list, so the two engines cannot drift). `read_attachment`
answers a Codex chat with the attachment's text, or for an image "attached to this turn".

**Lockdown (D13).** Codex spawn for Ask: `sandbox: 'read-only'`, network off, shell tool
disabled, approval `never`, no writable dirs (memory is read through `read_file`, never an
`--add-dir` writable root). Native `--search` stays off; the web goes only through
`web_fetch` / `web_search` as today. The host-process-protection preamble is still prepended. A
spike (§11) verifies: the flag that disables the shell, network off in read-only, MCP child env
passthrough (`SSH_AUTH_SOCK`, web key var), the MCP result wrapper, and whether `exec --json`
emits text deltas and usage. Any lockdown item the spike cannot confirm makes Ask on Codex refuse.

**Prompt.** `prompt.mjs` gets a Codex variant: rules naming Read/Grep/Glob, sub-agents, WebFetch
and "the claude CLI" are rewritten for Codex (worca file tools, no sub-agents). The Claude prompt
text is unchanged.

**Streaming (D15).** The codex normalizer emits each `agent_message` with a `messageId` (the item
id) so `events.mjs` keeps it, and streams deltas when the spike finds them. Usage events feed the
context meter when Codex reports usage; the context window comes from a Codex model table when
known, otherwise the meter is hidden. Reasoning is dropped, as Claude's thinking is today.

**Caps (D14).** A watchdog in `turn.mjs` counts `tool` events and sums `costUsd` deltas; at the cap
it aborts the spawn and emits a result with `subtype` `error_max_turns` / `error_max_budget_usd`,
so the existing limit notice shows unchanged. The 30-minute turn timeout still applies.

**Attachments (D16).** Images attached on a turn are passed with `-i` (and `exec resume -i`);
PDFs on a Codex chat are refused at attach time with "PDFs need a Claude chat".

**Resume.** The "Context restored" retry predicate gets a Codex variant of "no conversation
found", matched against the codex adapter's error class.

**Failure.** Before a Codex turn, `turn.mjs` runs `codexPreflight`. A `refusal` ends the turn with
`ask-error` code `codex-not-ready` and the refusal text; the panel shows "Codex isn't ready:
<reason>" with a link to the Codex setup docs. A `warning` proceeds. A Codex error mid-turn is
shown with its own text (`classifyCodexError`); it is never retried on Claude.

**Chat title.** `_kickoffTitle` passes the chat's engine; on Codex the title spawn is read-only
(D11) with the Ask model slot's model.

## 5. API

- `GET /api/projects/:key/settings` → `{ own, effective: { <id>: { value, source } }, layers }`
  for every cascadable key.
- `PATCH /api/projects/:key/settings` with a sparse body: a value sets an override, `null` clears
  it to inherit. An unknown key or invalid value → 400 naming the key; nothing is written. The
  write is one transaction over `project_config.extra` (and `steps` for Claude step models).
- `GET /api/settings` adds `runEngine`, `stepModels` and `utilityModels`; `POST /api/settings` accepts them
  (`SETTINGS_POST_KEYS` grows).
- `GET /api/run-defaults?projectDir=` → `{ engine: { value, source } }` for the New pipeline form.
- `PATCH /api/config` keeps accepting `nightMode` for compatibility.

## 6. UI

- **User Settings › Models:** an engine section: a Default engine row, then a card per engine
  with one row per role and one per utility job (model + effort). Claude rows use the existing
  model picker and are the same stored keys as today's utility pickers, which move into the
  Claude card; Codex rows take a free-text model id and an effort choice.
- **Project page › Settings tab** (`PROJ_TABS` gains `settings`; the `away` route redirects to
  it): the same cards for cascadable keys only, Away mode as one card. Each field shows its
  inherited value as a placeholder ("Same as my settings (Opus)", "Team default (…)",
  "Worca default (…)"); an override shows a "Project" badge and a clear control.
- **Model pickers (D10).** Filter by engine: New pipeline agent rows (`renderModelEffortPair`,
  re-filtered on engine switch; `node-tunables.mjs` heal drops a pick of the other engine and the
  row shows the inherited default), Settings engine cards, utility pickers inside each engine card,
  "Add model" from New pipeline. Grouped Claude / Codex: composer node inspector, project step
  models. Sub-agent model select: Claude only (hidden on a Codex run, which has no sub-agents).
  Ask Worca (Plan 2, D12/D17): the Settings Ask card shows one model picker per engine plus the
  Ask engine choice; the Ask panel's new-chat picker groups models by engine; inside a chat the
  picker lists only the chat's engine; the run-proposal card's per-agent model select follows the
  proposed run's engine. Models tab: Codex built-ins group, engine selector on the custom-model editor
  (env / connection / upstream hidden for Codex, Codex efforts). Team policy catalog editor and
  plugin view show the engine.
- **One field component** renders the inherit / override states; `night-mode-form.mjs` is rebuilt
  on it.
- **New pipeline:** the engine picker prefills the resolved engine with a hint ("Default from
  project" / "from your settings"). Changing it stays per run and is never saved back. The
  current Codex hint ("…on its own default model. Titles, the classifier and overviews stay on
  Claude.") is replaced by: "Codex runs this pipeline, including titles and summaries. Models:
  Settings › Models › Codex" (or "project Settings" when a project override applies).

## 7. Errors and migration

- Strict validation on write, lenient on read (§4.1).
- A Codex run whose resolved step model Codex rejects fails as an invalid `-m` does today; the
  run error names the slot and its source ("codex model 'x' from project settings").
- No schema migration. Existing user keys keep their names and meaning. Existing project
  `steps` become the Claude project layer. Paused runs resume on the engine in their state.

## 8. Testing (`node --test`, test-first)

1. Resolver: layer order per key type, sparse inherit, `null` clears, invalid layer skipped, team
   default and team cap folding.
2. Getters: unchanged answer without `projectDir` (regression); project override with it.
3. Engine: body > project > user > claude in both `runEngineOpts` and the CLI; resume ignores
   changed settings.
4. Step models: engine-owned node model > slot > fallback, per engine; `ownsModel`; `_engineModel`.
5. Catalog: `engine` on every row; codex built-ins; `(engine,id)` shadowing; per-engine efforts;
   `engineOfModel`; codex custom entries refuse routing env.
6. Blockers: a codex catalog id is not Claude (`_engineModel`, `_engineGate`,
   `_claudeCallModel`); resume across engines drops a saved model of the other engine.
7. Utility jobs: title, classifier, overview and PR description pass the run state's engine and
   its utility slot to `runClaude`; a Codex run spawns no Claude process (mock engine records the
   adapter per spawn); a changed default does not affect a later overview of an older run; a
   Claude chat's title spawn carries no `engine` option; failure paths as §4.3; codex utility
   spawns get `--sandbox read-only`.
8. Auto workflow picks only run-engine models; model test uses the entry's engine; Codex cost is
   non-null for built-ins; run page / report show the model actually run.
9. Pickers: New pipeline rows re-filter on engine switch and heal; grouped pickers; validators
   reject a model of the wrong engine with a 400 naming it.
10. API: project settings GET/PATCH round trip, 400 on bad input, `null` back to inherit.
11. UI: field component inherit/override states; New pipeline prefill and source hint.
12. Existing away-mode and sync suites stay green unchanged.
13. `npm run smoke` stays green.
14. Ask on Codex (Plan 2): a Claude chat's spawn argv, prompt and stored rows are byte-identical
    to today; a Codex chat spawns codex with `--sandbox read-only`, shell disabled, the worca MCP
    server and no writable dirs; `chatEngine` from the model; another engine's model is refused
    inside a chat.
15. Ask file tools: `read_file` / `grep` / `glob` allow `wt/**`, `att/**`, memory; refuse every
    `ASK_DENY_RULES` path (DB, `secrets.json`, `.env*`, `~/.ssh`, …) and anything outside the
    roots, sharing one matcher with the Claude rules.
16. Ask stream on Codex: messages carry `messageId` and reach the panel; MCP result wrapper
    unwrapped so proposal cards fire; watchdog stops at `askMaxTurns` / `askMaxBudgetUsd` with the
    existing notice; budget set + unpriced model refuses.
17. Ask failure and resume on Codex: `codexPreflight` refusal → `codex-not-ready`; mid-turn error
    shown, never retried on Claude; codex "not found" resume retries fresh.
18. Attachments on Codex: images passed with `-i`; PDF refused with the notice.

## 9. Impact (every surface the change reaches)

| Surface | Today | After |
|---|---|---|
| `isClaudeModelId` (run-harness) | catalog membership or Claude regex | `engineOfModel` (§4.2) |
| Resume model carry-over | kept if in catalog | kept only if same engine |
| Run state | engine only in resume point | `runEngine` in `outcome` JSON |
| Catalog (`composeCatalog`, global/plugin/policy models) | Claude only | `engine` per row, codex built-ins (§3.1a) |
| Effort validation | one `EFFORTS` list | per engine |
| Step / node / workflow / utility validators | full catalog | entry's engine must match where known |
| New pipeline agent rows | full catalog | run engine only, heal on switch |
| Settings utility pickers | full catalog | inside each engine card |
| Composer inspector, project step models | full catalog | grouped Claude / Codex |
| Sub-agent select, agent gen | Claude | unchanged (Claude by design) |
| Away analysis (night decider) | Claude | run's engine (follow-up to #577) |
| Ask Worca turn (`ask/turn.mjs`, `spawn.mjs`) | Claude | chat's engine (Plan 2, §4.6) |
| Ask chat title | Claude | chat's engine (Plan 2) |
| Ask tools (`tools.mjs`, `mcp-stdio.mjs`) | 69 worca MCP tools | same + `read_file` / `grep` / `glob` for Codex chats |
| Codex adapter MCP | none (`mcpTools:false`) | per-call `mcp_servers.*` overrides, result unwrap; later every spawn's stdio servers (`mcpTools:true`) |
| Ask prompt (`prompt.mjs`) | Claude tool names | Claude text unchanged; Codex variant |
| Ask stream (`events.mjs`, codex normalizer) | codex text dropped (no `messageId`) | `messageId` per message, deltas if present |
| Ask caps | Claude `--max-turns` / `--max-budget-usd` | Codex: worca watchdog |
| Ask attachments | Read tool | Codex: images `-i`, PDF refused |
| Ask models / pickers (`ask/models.mjs`, `ask-panel.mjs`) | full catalog | per chat engine; Settings Ask card per engine |
| Ask not-ready | `claude-signed-out` | + `codex-not-ready` from `codexPreflight` |
| Title, classifier, overview, PR description | Claude | run's engine, read-only on Codex |
| Auto workflow model pick / readiness | Claude sign-in, sonnet preference | run engine's models and readiness |
| Model test | Claude | entry's engine |
| Cost rates | Anthropic only; Codex model dropped → null | Codex rows; model passed |
| Run page pill, run report | configured model | model actually run |
| Routing env, broker slots | all models | Claude only |
| Models tab, policy editor, plugin view | no engine | engine shown / editable |

## 10. Out of scope

Per-project spend caps, a workspace layer, a committed in-repo config file, a "Save as project
default" action on the New pipeline form, team-policy keys for the engine or Codex models,
registry MCP copies in Codex chats, PDF attachments on Codex, and switching a chat's engine
mid-chat.

## 11. Delivery

- **Plan 1, engine completeness**: D8 for runs, D9, D10,
  D11; §3.1a; §4.2 engine of a model, run state, resume; §4.3; §4.5; the picker parts of §6;
  tests 5–9. Ask Worca stays on Claude in Plan 1: its catalog lists Claude models only and a
  Claude chat's title spawn carries no `engine`.
- **Plan 2, cascade and Ask on Codex**: the resolver, project Settings tab, engine default,
  per-engine model slots and engine cards (§3–§6), then Ask on Codex (D12–D17, §4.6), which
  starts with a spike against a real `codex` binary verifying the §4.6 lockdown and stream
  items; tests 10–18.
