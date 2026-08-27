# Ask Worca — Design

In-app assistant chat for the worca-cc web UI. A Claude Code headless process (the `claude`
CLI) answers questions about past runs and proposes pipeline runs; the user confirms. Threads
and messages are persisted in SQLite. The assistant process runs in a sandbox under
`WORCA_HOME` and can never touch a user project folder.

Status: **approved design, revision 2.1** (2026-08-22; §17 appendix = post-P1 binding amendments) — revision 1 was reviewed by a fresh-eyes
pass (4 critical, 14 major, ~37 minor findings) and every finding is folded in below; the user
then added D15 (workspace targets in v1). The
implementation is split into three plans plus an integration gate (§16). Companion material
(not committed): the mockup at `~/Downloads/Ask Worca chat interface/`, and the recon /
architecture / review reports in the session scratchpad (`recon-backend.md`,
`recon-frontend.md`, `arch-backend.md`, `arch-frontend.md`, `spec-review.md`).

Execution status (2026-08-22): **P1 implemented** — commit `1b02d87b` on branch
`worca-cc/ask-worca-p1-core-runner-implementation-9e4fbeab` (orchestrator pipeline `9e4fbeab`,
77 files, +6806). The executed plan — the authoritative P1 record — is
`/Users/denislavprinov/.worca-cc/store/worca-cc-551183d0/plans/22-08-26-ask-worca-p1-core-runner-implementation--v3.md`
(423 KB, orchestrator refine cycle 2). **P2/P3/P4 planners must read that file first**: its
"Verified facts from the planning probes (F1–F12)" **supersede §14 and any spec line they
refute** (Task sub-agents need `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`; the sub-agent tool
block is named `Agent`, not `Task`; `error_max_turns`/`error_max_budget_usd` exit 1 so the
runner rejects; `~/.claude/CLAUDE.md` treated as not loaded), and its frozen-contract rules
**R-A…R-G** (settle-before-finish, persist card mid-turn, abort branch first, mock markers
mandatory, spawn wiring) bind P2's `turn.mjs`. P2 and P3 are not yet planned. Rev 2.1 copies
those binding sections (F1–F12, frozen contract, R-A…R-G, Q&A) **verbatim into §17 below** —
planners read §17 first; the 423 KB plan file stays the full P1 record.

Every `file:line` reference below was read on branch `dev` at `79dc9256`.

---

## 1. Problem

Worca records everything about a run (prompt, diff, steps, costs, agents) and keeps a catalog
of saved workflows, but the only ways to act on that knowledge are the forms and tables of the
UI. There is no place to ask "what did run 4e1f change in the auth module?" or "start the
review-only pipeline on this for me" in plain language. The existing `src/core/chat/*`
subsystem is a set of messenger transports (Slack/Telegram/Discord/Teams) with a fixed command
grammar — it is not an assistant and deliberately cannot start runs.

## 2. Goals (v1)

1. **Propose runs.** Understand a request, pick the best saved workflow for it (from the
   workflow's name and topology — no new schema), pick the target — a project or a workspace —
   from page context or the user's words, and emit a **Start-run card**. The run starts only when the user clicks
   **Start**; the card posts to the existing `POST /api/run`.
2. **Answer questions about past runs** from the run's **user prompt** and **diff**, plus the
   identifying metadata needed to find a run (id, title, project, status, date, branch).
3. **Persist** threads, messages, tool activity, cards and attachments in `worca-cc.db`
   (attachment bodies on disk).
4. **Stream** progress to the browser: text deltas, tool calls, Task sub-agents
   (model · tokens · ≈cost · status), token/cost meters, cards, run notices.
5. **Follow runs** started from a thread: status in place, one notice each for started /
   needs-answer / failed / finished, with links.
6. **Sandbox.** The assistant process (and its Task sub-agents) run with `cwd` under
   `WORCA_HOME`, with **no filesystem, shell or network tools** — only the worca MCP tools.

## 3. Non-goals (v1)

- Controlling live runs from the chat (pause / stop / answering clarify questions).
- Editing workflows, agents, guardrails or settings from the chat.
- Reading run logs, plan/review markdown, sub-agent records or overviews (D4 limits the
  assistant to prompt + diff + metadata).
- Per-member *feature* branch names for workspace proposals (the card carries one feature
  branch default plus per-member **source** overrides, exactly what `POST /api/run` accepts).
- CLI parity — the chat is web-UI only.
- Writing chat spend to `cost_ledger` / Statistics; blocking the chat on the total budget.
- Any access by the assistant to project folders, the live DB, plugin secrets, or the
  user's other MCP servers.
- Voice input, the `Chat | Cowork` segment and other claude.ai chrome in the reference
  screenshots.

## 4. Decisions (locked)

| # | Decision |
|---|---|
| D1 | **Propose → user confirms.** The chat never starts a run; it emits a card. |
| D2 | Target (project or, per D15, workspace) is **inferred from page context** (run-detail page → that run's project/workspace) or the user's text; if ambiguous the assistant asks in the thread. The card always shows the chosen target. |
| D3 | **Compact card, key fields editable**: project, workflow, task brief (assistant-written, editable), guardrails (default **Normal**; the assistant may never propose Permissive), source/feature branch. "Open in New Pipeline" hand-off for everything else. |
| D4 | History data the assistant may read: **run prompt + diff** + identifying metadata. |
| D5 | **Cost shown in chat only** (per turn, per thread). Nothing written to the ledger; not blocked by the total budget. |
| D6 | v1 includes: safe **markdown** rendering; **follow runs** in-thread; **Task sub-agents**; **attachments**. |
| D7 | Sub-agents = Claude Code **Task** sub-agents in the **same sandbox** (same tool pool, no project access). |
| D8 | Model/effort: **composer picker only**, last choice remembered in `localStorage`; initial Opus 5 · high; catalog = predefined ⊕ user global models; efforts `medium|high|xhigh|max`. No Settings entry for the model. |
| D9 | Workflow selection: **no schema change** — the assistant sees name, domain, ordered step groups, parallel nodes, feedback loops and agent display names/descriptions. |
| D10 | Launcher: **bottom-centre pill "Ask Worca ⌘K"** on every page + ⌘K / Ctrl+K toggle. Pill hidden while the sheet is open. No sidebar entry. |
| D11 | Architecture: worca-owned **stdio MCP server** (hand-rolled JSON-RPC 2.0, no new runtime dependency; `@modelcontextprotocol/sdk` is the sanctioned fallback for the *transport* only); **one `claude -p` per turn** chained with `--resume`, with a DB-replay fallback; the sandbox recipe of §6.3; a **self-contained `ask-panel.mjs`** module on the UI side. |
| D12 | Per-turn guards **`--max-turns`** (default 40) and **per-turn `$` cap** (default $2) are **configurable in Settings** and read fresh on every turn. |
| D13 | Thread titles: deterministic immediately (sanitized first message) **and** a background haiku `generateTitle` that replaces it (`ask-title` frame). |
| D14 | Delete-thread confirmation uses the app's existing `confirmModal`; "Not now" keeps a one-line dismissed stub (mockup deviations, §13). |
| D15 | **Workspace targets are in v1.** A proposal targets either one project (`projectKey`) or one workspace (`workspaceId`, multi-repo run); the card shows the workspace and its members with a per-member source-branch override; Start posts the workspace body of `POST /api/run`. History tools cover workspace runs (store key `workspaces/<id>`). |

## 5. Architecture

```
browser ──REST /api/ask/*──▶ ui/server.mjs ──▶ src/core/ask/turn.mjs ──runClaude()──▶ claude -p (sandboxed)
   ▲                            │   ▲                 │  stream-json                    │ --mcp-config
   └──── WS ask-* frames ───────┘   │                 ▼                                 ▼
                                    │        src/core/ask/events.mjs          src/core/ask/mcp-stdio.mjs
                                    │        (pure reducer)                   (worca tools, read-only by contract)
                                    └── askJobs registry (ring buffer per thread, replay on reconnect)
run started from a card ──POST /api/run {askThreadId, askCardId}──▶ wireRun + ask/follow.mjs ──▶ notices
```

Namespace: everything is **`ask`** — `src/core/ask/`, `/api/ask/*`, tables `ask_*`, WS frames
`ask-*`, CSS `.ask-*`, data attributes `data-ask-*`. The words `chat` (messenger subsystem:
`src/core/chat/`, `/api/chat/*`, `chatPrefs`) and `channel` (pipeline data bus) are reserved
and must not be reused.

**Frozen contract between the three plans (§16):** the frame family of §6.6, the block schema
of §7.1, the route table of §8.1, and the settings keys of §6.9. Changing any of them means
changing all three plans.

## 6. Backend

### 6.1 Modules (`src/core/ask/`)

| module | responsibility | pure / injectable |
|---|---|---|
| `store.mjs` | thread / message / attachment / run-link CRUD over `getDb()`; `seq` allocation inside `tx()` | DB from `db.mjs` (temp `WORCA_HOME` in tests) |
| `spawn.mjs` | `buildAskSpawnOptions({thread, turn, limits, mcpConfigPath})` → the `runClaude` option object | pure |
| `prompt.mjs` | `buildSystemPrompt(catalog)` (byte-stable for identical catalog), `buildContextHeader(ctx)`, `buildTurnPrompt(header, text, inlined)`, `buildRestoredPrompt(messages, text)` | pure |
| `catalog.mjs` | `buildCatalog()` → `{projects:[{key,name,path}], workspaces, workflows}` | injected readers |
| `models.mjs` | `askCatalog()` = `listModels('')` filtered to predefined ids ∪ `custom === 'global'` (§6.9); `validateModelEffort(model, effort)` | injected `listModels` |
| `tools.mjs` | `createAskTools(deps)` → `{list(), call(name, input)}` — the MCP tool handlers; **contains no `INSERT`/`UPDATE`/`DELETE`** (asserted by a test that scans the module source) | injected readers |
| `mcp-stdio.mjs` | executable entry: JSON-RPC 2.0 over stdio; `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`; everything else `-32601`; logs to **stderr only** | spawned in protocol tests |
| `proposal.mjs` | `validateProposal(input, deps)` → `{ok, card}` or `{ok:false, errors}`; shared by the MCP child and the server | injected readers |
| `events.mjs` | `createTurnReducer({onFrame, redact, now})` — stream-json events → `ask-*` job frames + final `{text, blocks, usage, costUsd, sessionId, labels}`; **never emits `ask-done`/`ask-error`** | pure |
| `turn.mjs` | `class AskTurn extends EventEmitter` — one turn; `run()` never throws; `stop()`; owns the `AbortController` and the wall-clock timer; emits `ask-done`/`ask-error`; injectable `runClaudeImpl` | `agent-gen.mjs:30-110` shape, `overview-agent.mjs:82` seam |
| `follow.mjs` | `attachRunFollower(orch, {threadId, runId, cardId, post, updateStatus})` | driven by a bare `EventEmitter` in tests |
| `redact.mjs` | `redactAskText(s)` = `chat/redact.mjs#redactSecrets` + extra patterns (`sk-ant-…`, `ghp_`/`github_pat_`, `AKIA[0-9A-Z]{16}`, PEM `-----BEGIN … PRIVATE KEY-----` blocks); **best-effort** | pure |
| `limits.mjs` | fixed constants (§6.9) and `askLimits()` reading the two settings keys | pure + settings |

### 6.2 Turn lifecycle

1. The client creates the thread explicitly (`POST /api/ask/threads {}`) and then posts the
   message (`POST /api/ask/threads/:id/messages`) — **no route accepts a message without a
   thread id**. Empty threads older than 24 h are swept at server start.
2. The message route answers `409 {error:'turn in flight'}` if `askJobs.get(threadId).status === 'running'`
   (a grace-period entry, §8.3, never blocks), `429` if 3 turns are running globally, `400` if
   `model`/`effort` fail `validateModelEffort` (§6.9) or `context` fails its schema (§6.5).
   It persists the user message (+ attachments), creates the assistant message with
   `status:'streaming'`, registers the job, and responds `202 {userMessageId, assistantMessageId}`.
3. Write `<WORCA_HOME>/tmp/ask/mcp-<assistantMessageId>.json` (§6.4). Build the spawn options
   (§6.3) with `resumeSessionId = thread.session_id` when set; start the **15-minute
   wall-clock timer** (`ASK_TURN_TIMEOUT_MS`; the runner has no timeout of its own).
4. `runClaude(...)` (`src/core/claude-runner.mjs:226`). Every `onEvent` goes through the reducer
   (§6.6), which emits job frames to the ring buffer and the WS broadcast. `{type:'session',
   sessionId}` is stored on the thread immediately.
5. A `mcp__worca__propose_run` tool call is intercepted by the reducer: the server re-runs
   `validateProposal` (authoritative — the child's validation only feeds the model's retry
   loop and does not exist in mock mode). Valid → the card block is persisted on the in-flight
   assistant message and `ask-card` is broadcast before the answer finishes. Invalid → a
   `notice` block "Proposal rejected: …" and no card.
6. When `runClaude` **resolves**, `AskTurn` persists text (the reducer's main-stream text;
   `result.result` only as a fallback), blocks, usage, cost, duration, `status:'done'`; updates
   thread totals; emits `ask-done`. A `result` whose `subtype` is `error_max_turns` or
   `error_max_budget_usd` (both emitted by 2.1.239) ends as `ask-done{status:'stopped',
   reason:'max_turns'|'max_budget'}` with a notice "Stopped: reached the N-turn limit / the
   $X per-turn cap (Settings → Ask Worca)".
7. **Resume fallback.** If `resumeSessionId` was set and the runner **rejected before the
   reducer saw any `assistant` frame** (covers the probed `No conversation found with session
   ID` shape — exit 1, zero cost, no API call — and a transcript left unusable by a killed
   turn), retry **once** without `--resume`, replacing the turn prompt with
   `buildRestoredPrompt(lastMessages, text)` — a fenced "Conversation so far (restored)" block of
   the newest messages up to 30 000 characters — then store the new session id and post a
   `notice` "Context restored from history". If the retry also fails, clear `session_id` and
   report the error. Transcripts expire after 30 days by default, so this is a normal path.
8. **Stop** (`POST /api/ask/threads/:id/stop`) → `AbortController.abort()` → SIGTERM, SIGKILL
   after 1.5 s (`claude-runner.mjs:386-404`) → partial text persisted, `status:'stopped'`,
   `costUsd:null` when no `result` arrived, `ask-done{status:'stopped', reason:'user'}`.
   Timer expiry → the same abort with `ask-error{message:'timed out after 15 min'}`.
9. Any other rejection → `ask-error{message}` (the runner's classified message — auth/model
   errors arrive on stdout as `result.is_error`); partial text kept; `status:'error'`; the
   thread stays usable.
10. `finally`: delete the per-turn mcp json; keep the job entry with `status:'done'|'error'`
    for a 30 s grace (replay), then drop it. Title generation (§7.4) runs after **any**
    terminal status of the first turn.

Thread totals (`ask_threads.totals`) sum every turn including stopped/error ones; `costUsd:null`
turns contribute 0 and are counted in `turns`.

Server start sweeps `ask_messages` rows left in `status:'streaming'` and marks them `error`
("interrupted by restart").

### 6.3 Sandbox recipe (security — read carefully)

The probes against `claude` 2.1.239 showed that a default headless invocation is **not** a
sandbox: a one-word prompt auto-connected five user MCP servers, loaded eight plugins and 67
skills, and executed the user's `SessionStart` hook into the model context. The recipe below
removes all of that; every element was observed in the probes except where marked.

```js
// src/core/ask/spawn.mjs — buildAskSpawnOptions(...)  (pure; asserted by test/ask-spawn.test.mjs)
{
  cwd: join(worcaHome(), 'tmp', 'ask'),            // ONE empty scratch dir for all threads; mkdir -p per turn.
                                                   // Never worcaHome() itself (it holds the DB, secrets, repos).
  prompt, systemPrompt,                            // §6.5 — system prompt byte-stable across turns
  model, effort, modelEnv: resolveModelEnv(model), // config.mjs:311 — every aux spawn does this
  permissionMode: 'dontAsk',                       // non-allowlisted tools are denied, never prompt
  allowedTools: ['Task'],
  mcpServerGrants: ['mcp__worca'],                 // server-wildcard grant → --allowedTools Task,mcp__worca
  mcpConfigPath,                                   // --mcp-config <file> (§6.4)
  permissionRules: { deny: [                       // belt-and-braces; --tools already removes these
    'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Skill',
    'Read(//**/.worca-cc/**)',                     // every worca home: DB, store/, runs/**/repos, plugins/*/data/secrets.json
    'Read(//**/worca-cc.db*)', 'Read(//**/secrets.json)', 'Read(//**/.env*)',
    'Read(~/.ssh/**)', 'Read(~/.aws/**)',
  ] },
  envScrub: true, envAllowlist: [],                // PATH/HOME/ANTHROPIC_*/CLAUDE_* kept; WORCA_* and tokens dropped
  resumeSessionId,                                 // --resume <sid> when the thread has one
  // new runner options (all default-off; absent ⇒ argv unchanged):
  tools: ['Task'],                                 // --tools Task        built-in allowlist: no Bash/Read/Write/Edit exist
  strictMcpConfig: true,                           // --strict-mcp-config  drops user/plugin MCP servers
  settingSources: ['project'],                     // --setting-sources project  drops user hooks, plugins, skills
  disableSlashCommands: true,                      // --disable-slash-commands
  includePartialMessages: true,                    // --include-partial-messages  text deltas
  maxTurns: limits.maxTurns,                       // --max-turns (hidden flag, accepted)  default 40
  maxBudgetUsd: limits.maxBudgetUsd,               // --max-budget-usd  default 2; null ⇒ flag omitted
  appendSubagentSystemPrompt: SANDBOX_NOTE,        // hidden flag; repeats "worca tools only" to Task children
}
```

**Path-rule anchoring (important).** In Claude Code permission rules a pattern beginning with
`//` is absolute from the filesystem root; a single leading `/` is relative to the *settings
source* (for inline `--settings` that is the original cwd); a bare `path` or `**/path` is
relative to the **current directory**. Because the process runs in `<WORCA_HOME>/tmp/ask`, a
rule such as `Read(**/worca-cc.db*)` would only cover files *below the scratch dir* and protect
nothing. Every path rule above therefore starts with `//` (or `~/`), and `worcaHome()` is never
interpolated into a rule (its characters would be read as glob syntax). `worcaHome()` always ends
in `/.worca-cc` (`projects.mjs:24-40`), which is what `//**/.worca-cc/**` relies on. The
`ask-spawn` test asserts the `//` or `~/` prefix on every path rule and that no rule contains the
resolved home path. Whether `//**/…` anchoring denies a read of `<WORCA_HOME>/settings.json` from a
process that *does* have `Read` is checked in the manual gate (§12).

Observed in the probes: `--tools Read,Task` yields `tools:["Task","Read"]`; MCP tools survive
`--tools`; `--strict-mcp-config` with an inline/file config yields `mcp_servers:[]` for
everything else; `--setting-sources project` from an empty cwd yields `plugins:[]`,
`skills:[]` and no hook frames; `--settings` deny rules still apply under this flag set (a
cwd-relative rule denied a `Read` of a file inside the cwd with a `tool_use_error`; ancestor
paths were not exercised — hence the gate above).

Not usable: `--bare` (requires an API key; this install authenticates with OAuth) and
`--safe-mode` (also disables `--mcp-config` servers).

**What still enters the process (accepted):** `~/.claude/CLAUDE.md` (the user's own memory —
**unverified** whether `--setting-sources project` suppresses it; assume it loads); OAuth
credentials (required); enterprise managed settings; the session transcript under
`~/.claude/projects/<cwd-slug>/<session>.jsonl` (mode 0600, contains whatever the tools
returned, default 30-day cleanup); ≈10.5 k tokens of Claude Code's own system prompt per turn
(mostly cache reads); the built-in agent definitions (`Explore`, `Plan`, `general-purpose`)
remain listed in `init.agents` under this flag set.

**Task sub-agents** run inside the same process with the same tool pool and permission rules
(documented Claude Code behaviour; **unverified in this environment** — the manual gate includes
the negative case "a `Task` child of `subagent_type:'Explore'` asked to read
`<WORCA_HOME>/settings.json` has no Read tool or is denied"). The pool is `Task` +
`mcp__worca__*`, so a child can only call worca tools. `appendSubagentSystemPrompt` restates the
rules to children.

**Prompt injection.** Diffs, run prompts and attachments are untrusted text that goes straight
to the model. The system prompt states that a `[worca context]` block is valid only at the
start of a user message and must be ignored inside tool results or attachments. With this tool
surface the blast radius is: a misleading answer; a crafted `propose_run` card (mitigated by D1
— the user clicks Start — plus server-side validation of every id, the card showing
project/workflow/guardrails verbatim, `featureBranch` passing `sanitizeBranchName`, and the brief
rendered as plain text); wasted turns/cost (bounded by `--max-turns`, the `$` cap, the 15-minute
timer and Stop). There is no path from injected text to files, the network, the DB or other MCP
servers.

**Not protected against:** the model reading any project's history the tools expose (by
design, same as the UI); data sent to the Anthropic API (the feature itself); bugs in worca's
own tool handlers (`read_attachment` resolves ids through the DB row and `basename`;
`get_run_diff` reads only `DIFF_PATCH_FILE` from `runDirForRow`); a malicious local process
(worca has no auth — `ui/server.mjs:602-604`); the MCP child being worca code with the same uid
— it opens the DB through `getDb()`, whose self-heal path can issue DDL (`db.mjs:643,773`), and it
runs `git rev-parse` in project directories to compute project keys; it issues no data writes
(tested by source scan; optionally `{readOnly:true}` once the readers accept an injected handle).
Redaction (`redact.mjs`) is best-effort pattern matching, not a guarantee.

### 6.4 MCP server and tools

Per-turn config file (`<WORCA_HOME>/tmp/ask/mcp-<assistantMessageId>.json`, removed in `finally`):

```json
{ "mcpServers": { "worca": {
  "type": "stdio",
  "command": "<process.execPath>",
  "args": ["--disable-warning=ExperimentalWarning", "<repo>/src/core/ask/mcp-stdio.mjs"],
  "env": { "WORCA_HOME": "<path.resolve(process.env.WORCA_HOME), only when set>",
           "WORCA_ASK_THREAD_ID": "<threadId>" }
} } }
```

`WORCA_HOME` must be forwarded explicitly and **resolved**: `buildSpawnEnv` drops `WORCA_*` under
scrub (`claude-runner.mjs:148-181`), and a relative value (exactly what `npm test` uses,
`.worca-cc-test`) would otherwise resolve against the child's cwd. Pass the raw base, never
`worcaHome()` (that would double the `.worca-cc` suffix). When the server runs without
`WORCA_HOME`, the child resolves the home the same way (`projects.mjs:24-40`: settings root → OS
home). Claude merging `mcpServers.<name>.env` over the spawn env is documented; **unverified
here** (manual gate, §12). `--disable-warning` keeps the `node:sqlite` ExperimentalWarning off
the child's stderr.

The child imports the normal core readers (`getDb()` second-process access is designed for:
WAL, `busy_timeout=5000`, open-retry — `db.mjs:44-51,123-136`). In `WORCA_MOCK` mode no child is
spawned (the mock runner does not spawn anything).

Tools (MCP names `mcp__worca__<name>`; every handler returns JSON text content):

| tool | input | output |
|---|---|---|
| `list_projects` | `{}` | `{projects:[{key,name,path}], workspaces:[{id,name,projectKeys}]}` — keys via `projectKey(path)` (`store.mjs:36-47`); see the `listProjects` change in §6.8 |
| `list_workflows` | `{}` | `[{id,name,domain,origin,steps:[[{nodeId,key,displayName,description}]],feedbacks:[{id,from,to}]}]` — `wf_default` prepended (`workflows.mjs:93-111,279-295`; registry fields `agent-registry.mjs:208-211`) |
| `list_runs` | `{projectKey?, workspaceId?, status?, limit=20, query?}` | `[{id,title,target:'project'\|'workspace',projectKey?,projectName?,workspaceId?,workspaceName?,status,startedAt,updatedAt,branch,sourceBranch,guardrailsId,totalCostUsd}]` — `listAllPipelines({lite:true, limit:200})` (`artifacts.mjs:1521`, spans project and workspace store keys, non-archived only, no git calls), then `status`/`query` (title substring) filtered in JS, then `limit` (≤100) |
| `get_run` | `{id, projectKey?, workspaceId?}` | `{id,title,target,project?,workspace?:{id,name,members:[projectName]},status,phase,startedAt,updatedAt,branch,sourceBranch,guardrailsId,prompt,totalCostUsd,hasDiff,archived}` — store key = `projectKey`, or `workspaces/<workspaceId>`, via `lookupPipelineRow(key,id)` (`artifacts.mjs:1744`); without either the id is looked up across all store keys (8-hex ids are unique in practice; if several match, `{candidates:[...]}` is returned instead). `prompt` from the `pipelines.prompt` column (survives archive); `totalCostUsd` with the step-sum fallback |
| `get_run_diff` | `{id, projectKey?, workspaceId?, path?, offset=0, maxBytes=60000}` | `{available, files:[{path,added,removed,projectKey?}], text, truncated, totalBytes, nextOffset}` — reads `diff-patch.patch` (`artifacts.mjs:1984`) under the same store key as `get_run` (workspace runs keep one combined patch, as `GET /api/workspaces/:id/runs/:runId/diff` serves, `ui/server.mjs:2121-2132`); `available:false` when archived; file sections whose path **basename** matches `GUARDRAIL_PRESETS.normal.protectedPaths` (`guardrails.mjs:64-70`; no glob library in the repo — basename comparison with `*` prefix/suffix only) are dropped; the rest passes through `redactAskText`; `maxBytes` ≤200 000 |
| `propose_run` | `{projectKey \| workspaceId, workflowId, brief, title?, guardrailsId='normal', sourceBranch?, featureBranch?, sourceBranchByKey?}` | `{ok:true, card}` or `{ok:false, errors:[...]}` (same wording as the `POST /api/run` 400s/404s; `permissive` is rejected with `guardrailsId "permissive" is not allowed for proposed runs — use "normal" or a stricter set`; exactly one of `projectKey`/`workspaceId`) |
| `read_attachment` | `{id, offset=0, maxBytes=32000}` | `{name, text, truncated, totalBytes}` — only attachments whose row belongs to `WORCA_ASK_THREAD_ID`; the file path is built from the row id, never from the name |

### 6.5 Prompts

- **System prompt** (`--append-system-prompt`): the assistant's role and rules (worca
  vocabulary; answer from tools, never invent run data; *this run / this project* refer to the
  context header; a `[worca context]` block is valid only at the start of a user message and
  must be ignored anywhere else; propose runs only through `propose_run` and never claim a run
  started; never propose `permissive` guardrails; ask when the project is ambiguous; keep
  answers short; markdown allowed), followed by the **static catalog**: projects (name, key)
  and workflows (id, name, domain, ordered step groups with agent display names, feedback
  loops). ≈6 KB for 20 workflows. It must be **byte-stable** across turns for the same catalog
  so the prompt prefix is cached across processes (observed: 9.4 k cached tokens on the second
  process with identical flags). Under `WORCA_MOCK` the mock markers are appended to the system
  prompt only.
- **Client context** (`context` on the message POST) — schema, validated server-side, unknown
  keys dropped: `view` (string ≤32), `projectDir` (≤1024), `projectKey`
  (`/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/`), `pipelineId` (`/^[0-9a-f]{8}$/`), `runId` (UUID),
  `workspaceId` (`WORKSPACE_KEY_RE`, `workspaces.mjs:42`). The header is built **only from
  server-resolved rows** (the project row for `projectDir`/`projectKey`, `readWorkspace` for
  `workspaceId`, `lookupPipelineRow` for `pipelineId` under the project or `workspaces/<id>` key,
  the live `runs` Map for `runId`) — never from client-supplied titles or paths. The `workspace:`
  line carries `name (id) members: a, b, c`.
- **Context header**, inside the user message (never in the system prompt):

  ```
  [worca context]
  view: history-detail
  project: worca-cc (key worca-cc-551183d0)
  run: 4e1f2a9b "Fix login bug" status=done started=2026-08-20 branch=worca-cc/fix-login-4e1f2a9b
  workspace: -
  runs from this thread: 8c3d12ab "Add tests" status=running phase=implement
  cards: card_3f2a proposed (wf_review on worca-cc), card_9c01 dismissed
  attachments: att_1 notes.md (41 KB, use read_attachment)
  now: 2026-08-22T08:00Z
  [/worca context]

  <user text>
  <inlined attachments as fenced blocks>
  ```

  Clipped to ≈1 KB (titles truncated; at most 5 linked runs, newest first; at most 5 cards).
  Attachments of the **current** message are inlined in upload order while the running total
  stays ≤24 KB; the rest, and the thread's earlier attachments (newest first, at most 5), are
  listed for `read_attachment`. The last context is stored on the thread.

### 6.6 Event reducer and WS frames

Input: the runner's `{type, raw}` events (`claude-runner.mjs:413-457` forwards every frame with
`raw`; nothing to change there). Probed facts the reducer relies on:

- Text deltas arrive as `stream_event` → `content_block_delta` with `delta.type === 'text_delta'`
  (only with `--include-partial-messages`); `thinking_delta` / `signature_delta` / `input_json_delta`
  are ignored for text. Only frames with `parent_tool_use_id == null` contribute to the answer.
- `assistant` frames arrive **once per content block** with the same `message.id` and the
  **same `usage` repeated** — never sum per-block usage; take usage from `message_delta` and
  the terminal `result` (dedupe by `message.id`). The `assistant` text block is authoritative
  and replaces the accumulated deltas for that message.
- `tool_use` blocks (`id: toolu_…`, `name`, `input`) pair with `user` frames carrying
  `tool_result{tool_use_id, content, is_error}` and a top-level `tool_use_result`
  (string or object; both accepted).
- Sub-agents: `Task` tool_use (`input.description`, `input.subagent_type`, `input.model?`);
  child frames carry `parent_tool_use_id`; the finishing `user` frame's `tool_use_result` is
  an object `{agentId, agentType, resolvedModel, totalDurationMs, totalTokens, usage, …}`
  (shape grep-verified in the binary; **runtime shape unverified**). Per-agent **cost is not
  emitted anywhere**; `result.modelUsage[model].costUSD` is per model. Agent cost is an
  **estimate** — `costUSD × w_agent / Σw` with `w = input + 1.25·cacheCreate + 0.1·cacheRead + 5·output`
  — flagged `estimated:true`. Agent **log lines** are derived from child-stream `tool_use` /
  `tool_result` frames whose `parent_tool_use_id` matches the agent (`→ list_runs {…}`,
  `← ok 0.8s`, `← error: …`), capped at 50, `t` = ms since spawn; the Task `input.prompt` is
  never persisted.
- Terminal `result`: `total_cost_usd`, `usage`, `modelUsage`, `duration_ms`, `num_turns`,
  `session_id`, `permission_denials`, `subagent_stats`. Subtypes: `success`,
  `error_during_execution` (+ `errors[]`), `error_max_turns`, `error_max_budget_usd`;
  `is_error:true` may also appear under `subtype:'success'` (unknown model) with exit 1.
- Noise dropped: `system/status`, `system/thinking_tokens`, `system/hook_*`, `rate_limit_event`.

**Activity label** (`ask-label`, server-derived; the client never guesses): `Thinking` at start;
`Finding runs` on `list_runs`; `Reading run <id>` on `get_run` / `get_run_diff`; `Looking at
workflows` on `list_workflows`; `Preparing a run` on `propose_run`; `Reading <name>` on
`read_attachment`; `Running N sub-agents` while any agent is running; `Writing` on the first
text delta after a tool; on completion the client renders `Worked for <elapsed>` /
`Stopped after <elapsed>` from `ask-done`.

**Two frame classes.** *Job frames* belong to one assistant message: they carry
`{threadId, messageId, seq}` with a per-job monotonic `seq`, are buffered in the job's ring
buffer, replayed on subscribe, and deduped by the client (`seq ≤ lastSeq` dropped).
*Out-of-turn frames* carry `{threadId}` only, are not buffered, are upserted by their own key
(`message.id`, `runId`, or the thread title) and are recovered by the REST re-sync on reconnect.

| frame | class | payload | persisted |
|---|---|---|---|
| `ask-start` | job | `{userMessageId, model, effort, startedAt}` | message row `streaming` |
| `ask-label` | job | `{label}` | no |
| `ask-delta` | job | `{text}` — batched every ≤50 ms or 256 chars; best-effort `redactAskText` per batch | no |
| `ask-block` | job | upsert of one activity block (§7.1 block schema) | final state at turn end; cards immediately |
| `ask-card` | job | `{block}` (kind `card`) | yes |
| `ask-usage` | job | `{usage:{input,output,cacheRead,cacheCreation}, costUsd?}` | thread totals on done |
| `ask-done` | job | `{text, blocks, usage, costUsd, durationMs, model, status:'done'\|'stopped', reason?, threadTotals}` | yes |
| `ask-error` | job | `{message, errorClass?}` | yes (`status:'error'`, partial text kept) |
| `ask-title` | out-of-turn | `{title}` | yes |
| `ask-message` | out-of-turn | `{message}` — a whole persisted message (system notices; user-message echo for other tabs) | yes |
| `ask-run-status` | out-of-turn | `{runId, pipelineId, cardId, status, phase}` | `ask_run_links.status/phase` |

Redaction: `redactAskText` on tool outputs before they reach the model, on the final text
before persistence, and best-effort on each delta batch (a token split across batches can
show briefly in the live view; the persisted copy is clean — documented limitation).

### 6.7 Mock role (`runMock`, `claude-runner.mjs:689-784`)

New `case 'ask'` (marker `MOCK_ROLE: ask`, plus `MOCK_ASK_CARD: {json}`), appended to the
**system prompt only** when mock is enabled. Two ordering rules, because `runMock` parses markers
from the prompt first (`:589`) and its unrelated `MOCK_ASK` arm (`:705-714`) runs before the role
switch and writes a file to an arbitrary path: the `ask` role is detected **before** that arm,
and for the `ask` role markers are parsed from the system prompt **only**, so a chat message
containing `MOCK_ASK: /x.json` can never write a file in mock or smoke mode (regression test).

The scenario is chosen from the **user text** so tests control it:

- `/\b(propose|start|run)\b/i` → three `stream_event` text deltas, an `assistant` text block,
  an `assistant` `tool_use{name:'mcp__worca__propose_run', input: MOCK_ASK_CARD}`, the `user`
  `tool_result`, then the terminal `result`.
- `/\bagents?\b/i` → additionally a `Task` spawn/finish pair with one child-stream tool call
  (`parent_tool_use_id` set) and a finishing `user` frame carrying
  `tool_use_result:{agentId, resolvedModel:'mock-haiku', totalTokens:1234, totalDurationMs:10, usage}`.
- `/\bMOCK_FAIL\b/` → `result{is_error:true, subtype:'error_during_execution'}` and a rejection
  whose message mimics the real one.
- `/\bMOCK_MAX_TURNS\b/` → `result{subtype:'error_max_turns'}`; `/\bMOCK_MAX_BUDGET\b/` →
  `result{subtype:'error_max_budget_usd'}`.
- `/\bMOCK_SLOW\b/` → the default scenario with a 300 ms delay between frames (reconnect tests).
- default → an echo answer.

Every scenario ends with `result{total_cost_usd:0, usage:{…}, modelUsage:{}, duration_ms, num_turns:1, session_id}`.
The mock never spawns the MCP child; the server-side `validateProposal` still runs on the
intercepted card.

### 6.8 Runner and core changes

`src/core/claude-runner.mjs` — new options `tools`, `strictMcpConfig`, `settingSources`,
`disableSlashCommands`, `includePartialMessages`, `maxTurns`, `maxBudgetUsd`,
`appendSubagentSystemPrompt`, each named in **all five gates**: the `runClaude` destructure
(`:232-251`), the `runReal({...})` call (`:267-285`), the `runReal` parameter list (`:338`), the
inner `buildClaudeArgs({...})` call (`:340-343`) and `buildClaudeArgs` itself (`:308-336`). All are
**default-off so every existing argv stays byte-identical** (`test/spawn-args.test.mjs:33-38,65-70`
stay green). `tools: []` emits `--tools ""` (no built-in tools); absent emits nothing. The hidden
`--max-turns` and `--append-subagent-system-prompt` flags are accepted by 2.1.239 (probed); if a
future CLI rejects a flag the runner surfaces the exit error and the turn fails visibly.

`src/core/title.mjs#generateTitle` gains pass-through of the hardening options; the chat calls it
with `tools: []`, `strictMcpConfig`, `settingSources:['project']`, `disableSlashCommands` so the
title call loads neither the user's MCP servers nor their skills (its `effort:'low'` is accepted
by the CLI, probed).

`src/core/projects.mjs#listProjects` returns `{key, name, path, exists}` — the `key` column is
already read by `readRows()` (`:81-86`) and currently dropped (`:94-96`). Keys are never derived
from names or basenames.

`src/core/db.mjs` — §7.2. `src/core/settings.mjs` + `ui/server.mjs` — §6.9.

### 6.9 Limits and settings

| key (`settings.json`, `GET/POST /api/settings`) | default | rule |
|---|---|---|
| `askMaxTurns` | 40 | integer 1–500 |
| `askMaxBudgetUsd` | 2 | `null` (no cap) or number 0.1–100 |

Both are validated **as a set before any write** (the `assertCostLimitInputs` pattern,
`settings.mjs:380-385`); `null` clears. `POST /api/settings` keeps a legacy contract that clears
the Worca root when a body names no known key (`ui/server.mjs:2201-2203`): the guard gains
`has('askMaxTurns') || has('askMaxBudgetUsd')`, and an API test asserts that an ask-only POST
leaves `root` and the budget keys untouched. `settingsState()` includes both keys;
`test/settings-projects-root.test.mjs:309-313` pins the exact key list and is updated in the same
change. The Settings page gains an **Ask Worca** section (two fields, cost-limit form
conventions, no `data-view`/`data-nav`).

Model catalog for the chat — `askCatalog()` (`models.mjs`): `listModels('')` (`config.mjs:293-297`)
**filtered** to entries whose id is a predefined id (`PREDEFINED_MODELS`, `config.mjs:64-76`,
case-insensitive) or whose `custom === 'global'`. `listModels` alone is not "predefined ⊕ global":
it also contains plugin entries, and a plugin that shadows a predefined id re-emits it with
`custom:'plugin'` (`:194-199`). The same function backs `GET /api/ask/models` (picker) and
`validateModelEffort` (message POST; effort must be in the entry's `efforts`).

Fixed limits (`limits.mjs`): 1 running turn per thread; 3 globally (`429`); 15-minute wall clock
per turn; attachments per §7.3; context header ≤1 KB; inlined attachments ≤24 KB; restored
conversation ≤30 000 chars; persisted tool input/output ≤2 KB per block; agent log ≤50 lines;
`list_runs` limit ≤100; `get_run_diff.maxBytes` ≤200 000; brief ≤8 000 chars.

## 7. Persistence

### 7.1 Schema

```sql
CREATE TABLE IF NOT EXISTS ask_threads (
  id          TEXT PRIMARY KEY,            -- 'ask_' + 8 hex
  title       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  model       TEXT,                        -- last model / effort used
  effort      TEXT,
  session_id  TEXT,                        -- claude session for --resume; NULL = fresh
  context     TEXT,                        -- JSON: last page context
  totals      TEXT NOT NULL DEFAULT '{}'   -- JSON {costUsd,input,output,cacheRead,cacheCreation,turns,agents}
);
CREATE TABLE IF NOT EXISTS ask_messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES ask_threads(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,            -- MAX(seq)+1 allocated inside tx()
  role        TEXT NOT NULL,               -- user | assistant | system
  text        TEXT NOT NULL DEFAULT '',
  blocks      TEXT,                        -- JSON array (below)
  status      TEXT,                        -- assistant: streaming | done | stopped | error
  reason      TEXT,                        -- stopped: user | max_turns | max_budget
  model       TEXT,
  effort      TEXT,
  usage       TEXT,                        -- JSON {input,output,cacheRead,cacheCreation}
  cost_usd    REAL,                        -- NULL when the turn ended before a `result`
  duration_ms INTEGER,
  created_at  TEXT NOT NULL,
  UNIQUE (thread_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_ask_messages_thread ON ask_messages (thread_id, seq);
CREATE TABLE IF NOT EXISTS ask_attachments (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES ask_threads(id) ON DELETE CASCADE,
  message_id  TEXT,
  name        TEXT NOT NULL,               -- sanitized basename (display only)
  bytes       INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ask_run_links (
  thread_id   TEXT NOT NULL REFERENCES ask_threads(id) ON DELETE CASCADE,
  run_id      TEXT NOT NULL,               -- runs-Map UUID from POST /api/run
  pipeline_id TEXT,                        -- short id, from the first `state` event
  card_id     TEXT,
  status      TEXT,                        -- last seen status
  phase       TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (thread_id, run_id)
);
```

`foreign_keys=ON` is set per connection (`db.mjs:133`), so cascades work. No FK from
`pipeline_id` to `pipelines` (a run that fails preflight never gets a row — `orchestrator.mjs:502`
runs after `POST /api/run` answered). `seq` is allocated as `MAX(seq)+1` inside a `tx()` because
follower notices interleave with turns.

Block schema (`ask_messages.blocks`, one vocabulary for live frames and persisted rows):

```
{kind:'tool',   id, name, input, status:'running'|'done'|'error', durationMs, error?}
{kind:'agent',  id, label, type, model, tokens, costUsd, estimated:true, status:'running'|'done'|'error', durationMs, log:[{t,text}]}
{kind:'card',   id, state:'proposed'|'started'|'dismissed'|'failed',
                card:{target:'project'|'workspace',
                      projectKey?,projectName?,projectDir?,                          -- target project
                      workspaceId?,workspaceName?,members?:[{projectKey,projectName,projectDir}],  -- target workspace
                      workflowId,workflowName,guardrailsId,brief,title,
                      sourceBranch,featureBranch,sourceBranchByKey?:{[projectKey]:branch}},
                runId?, error?}
{kind:'notice', text, href?}
{kind:'attachment', id, name, bytes}          -- on user messages
```

A `proposed` card stays actionable after later messages; the header lists open cards (§6.5).

### 7.2 Migration

The ask DDL is applied in **two** places, following the v17 `model_cost_flags` pattern
(`db.mjs:545-550, 606-625, 793`):

1. `SCHEMA_VERSION` is bumped to `N = current SCHEMA_VERSION + 1` **at merge time** (the
   `task-source-profiles` branch already claims 18) with a ladder step
   `if (current < N) db.exec(ASK_DDL)`; and
2. `schemaGaps()` probes `sqlite_master` for `ask_threads`; `repairSchemaGaps()` executes
   `ASK_DDL` when missing; `reconcileSchema`'s early return includes the new gap.

Reason: the live DB on the author's machine is already stamped `user_version = 18` by another
branch, so a ladder-only migration would never run there. All DDL is `IF NOT EXISTS`. Nothing is
`ALTER`ed, so no `INCREMENTAL_COLUMNS` entry is needed; any later column added to an `ask_*`
table must be registered there (`db.mjs:567-576`).

### 7.3 Files

- Attachments: `<WORCA_HOME>/ask/<threadId>/att/<attachmentId>.txt` — a new top-level root
  (not `store/`, which is the pipeline artifact store). `docs/storage.md` documents it.
  Wire format: `attachments:[{name, dataBase64}]` inside the message POST (base64 end-to-end,
  the `fileToBase64` pattern of `app.js:5265-5276`; `express.json` limit is 8 MB,
  `ui/server.mjs:600`). Server validation on the decoded bytes: extensions `.md .markdown .txt
  .json .csv .log`, valid UTF-8 (`TextDecoder('utf-8', {fatal:true})`), no NUL bytes, ≤512 KB
  per file, ≤8 per message, ≤4 MB per thread; names reduced to `basename` for display; the
  stored path uses the row id only. The download route sends `text/plain; charset=utf-8`,
  `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`.
- Scratch: `<WORCA_HOME>/tmp/ask/` (cwd) and the per-turn `mcp-*.json` inside it.
- Claude's own transcripts live under `~/.claude/projects/…` and are not managed by worca.

### 7.4 Titles (D13)

On the first user message: `title = sanitizeTitle(text.slice(0, 80))` (`title.mjs:17-25`) so
the list never shows an empty title. After the first turn reaches **any** terminal status:
fire-and-forget `generateTitle(firstText, {cwd: scratch, signal, ...hardening})`
(`title.mjs:34-63`, haiku, never throws, ≈$0.01, not shown in meters); a non-empty result
replaces the title and is broadcast as `ask-title` — unless the user renamed the thread in the
meantime (`PATCH /api/ask/threads/:id {title}`), in which case it is discarded.

### 7.5 Deletion

`DELETE /api/ask/threads/:id`: abort the in-flight turn → detach any run followers → delete the
thread row in a transaction (cascades) → `rm -rf <WORCA_HOME>/ask/<threadId>` → drop the job
entry. No soft-delete.

## 8. Server API

### 8.1 REST (`ui/server.mjs`, all behind the loopback guard)

Ids: `ask_` + 8 hex (threads), `askm_` + 8 hex (messages), `att_` + 8 hex, `card_` + 8 hex;
route params validated with `/^[a-z]+_[0-9a-f]{8}$/` (`400` on shape, `404` when unknown).

| route | body / query | response |
|---|---|---|
| `GET /api/ask/threads?limit=50` | — | `{threads:[{id,title,updatedAt,model,effort,totals,inFlight,runLinks}]}` newest first |
| `POST /api/ask/threads` | `{title?}` | `{thread}` |
| `GET /api/ask/threads/:id` | — | `{thread, messages (blocks parsed), attachments, runLinks, inFlight:{messageId}\|null}` · `404` |
| `PATCH /api/ask/threads/:id` | `{title}` (≤120 chars) | `{thread}` · `404` |
| `DELETE /api/ask/threads/:id` | — | `{ok:true}` · `404` |
| `POST /api/ask/threads/:id/messages` | `{text, model, effort, context?, attachments?}` | `202 {userMessageId, assistantMessageId}` · `409 {error:'turn in flight'}` · `429` · `400` (model/effort/context/attachments) · `413` (size) · `404` |
| `POST /api/ask/threads/:id/stop` | — | `{ok:true}` (idempotent, like `/api/agents/generate/stop`, `ui/server.mjs:2933-2941`) |
| `POST /api/ask/threads/:id/cards/:cardId` | `{state:'dismissed'}` | `{block}` · `409` unless the card is `proposed` · `404` |
| `GET /api/ask/threads/:id/attachments/:attId` | — | `text/plain` (§7.3 headers) · `404` |
| `GET /api/ask/models` | — | `{models:[{id,label,efforts,custom}], efforts}` from `askCatalog()` |
| `POST /api/run` (existing) | + optional `askThreadId`, `askCardId` | unchanged `{runId}`. Both or neither; shape-validated; the thread must exist and the card must be `proposed`, else `400` **before** the run is created; a card already `started|dismissed|failed` → `409`. The link row, the card flip to `started` and the "Run started" notice happen **synchronously between `wireRun(entry)` and `announceRun(entry)`** (`ui/server.mjs:996-998`) so no event can precede them |
| `GET/POST /api/settings` (existing) | `askMaxTurns`, `askMaxBudgetUsd` | §6.9 |

### 8.2 WebSocket

`{type:'subscribe', threadId}` (or `?threadId=` at connect, next to `runId/scanId/genId`,
`ui/server.mjs:218-255`) replays the job ring buffer for that thread. `hello` gains
`ask:[{threadId, messageId}]` for running turns and the client passes it to
`askPanel.onHello(msg.ask)`. Frames are broadcast to every socket (the existing flat `sockets`
set); clients filter by `threadId`, then apply the two-class rule of §6.6.

### 8.3 Registry

A separate `askJobs: Map<threadId, {turn, messageId, events:[], status:'running'|'done'|'error'}>`
— not the shared `runs` Map: the client's Running badge counts every live entry regardless of
`kind` (`app.js:12564-12571`), and a thread id is the natural subscription key. *In flight* ⇔
`status === 'running'`; a grace entry (`done`/`error`, kept 30 s for replay) never causes
`409`/`429` and is replaced atomically by the next turn. Buffer/replay helpers mirror
`bufferEvent`/`replayEntry` (`ui/server.mjs:293-334`).

## 9. Run proposal → start → follow

1. **Tool call** `propose_run({projectKey | workspaceId, workflowId, brief, title?, guardrailsId, sourceBranch?, featureBranch?, sourceBranchByKey?})`.
2. **Validation** — `validateProposal`: exactly one target. *Project*: key → `projectDir` via
   `listProjects()` (§6.8). *Workspace*: id matches `WORKSPACE_KEY_RE`, `readWorkspace(id)`
   (`workspaces.mjs:172`) exists, every member path exists and is a git repo (`isGitRepo`,
   `workspaces.mjs:59`) — the same checks and strings as `POST /api/run` (`ui/server.mjs:873-892`:
   `workspace not found`, `workspace member path is missing`, `workspace member is not a git
   repository: <dir>`); members sorted by `projectKey` (primary first, `:897`). Workflow via
   `readWorkflow(id)` (`workflows.mjs:279`, includes `wf_default`); guardrails via
   `readGuardrailSet(id)` (`guardrail-store.mjs:80`; built-ins are virtual,
   `guardrail-store.mjs:32-40`, so `normal` always exists), default **`normal`**, `permissive`
   rejected; `brief` non-empty ≤8 000 chars; `sourceBranch` syntactic only (no leading `-`,
   ref-format regex) — for a project the real ref check `isValidSourceRef` (`worktree.mjs:172`)
   stays in `POST /api/run`; for a workspace `sourceBranch`/`featureBranch` are per-member
   defaults and `POST /api/run` deliberately does not ref-check them (`ui/server.mjs:899-906`);
   `sourceBranchByKey` keys must be member keys and values pass the same injection guard
   (`firstInjectionSource`, `:912`); `featureBranch` via `sanitizeBranchName` (`worktree.mjs:86`),
   default `suggestBranchName` (`:116`); `title` via `sanitizeTitle`. Error strings match the
   `POST /api/run` responses (`ui/server.mjs:829, 839-846, 873-892, 904, 967`) so the model can
   self-correct.
3. **Card** persisted as a `card` block (`state:'proposed'`) on the in-flight assistant message;
   `ask-card` broadcast. The card's guardrails `<select>` lists every set **including
   Permissive** — the user's explicit choice, exactly as on the New Pipeline page.
4. **Start** — the UI posts the exact New-Pipeline body (`app.js:7073-7101`). Project:
   `{projectDir, prompt: brief, workflowId, guardrailsId, title, sourceBranch, featureBranch,
   mock:false, askThreadId, askCardId}`. Workspace: `{workspaceId, prompt: brief, workflowId,
   guardrailsId, title, sourceBranch, featureBranch, sourceBranchByKey, mock:false, askThreadId,
   askCardId}` (`guardrailsId` is sent always, unlike New Pipeline's omit-when-default). The
   server validates the ask fields (§8.1), creates the `ask_run_links` row, flips the card to
   `started` with `runId`, posts the system message "Run started — *title*" linking
   `#running/<runId>`, and attaches the follower (the entry kind is `run` or `workspace-run`;
   `wireRun` handles both, `ui/server.mjs:413-476`). The browser **does not navigate**.
5. **Follower** (`follow.mjs`, shaped like `chatNotifier.attach`, `chat/notifier.mjs:67-99`,
   exception-guarded): `state` → store `pipeline_id` on first sight, `ask-run-status` (no
   message); `phase` → `ask-run-status`; `question` → one system message per question id
   ("Run *title* is waiting for your answer (clarify) → link"); `error` → "Run failed: …" and
   card `failed` (this covers the post-200 roster preflight failure, `orchestrator.mjs:1869-1890`);
   `done` → one message with status / duration / cost / link (`renderDone` wording,
   `chat/renderers.mjs:53-74`), skipped when the status is `error`. At most 3–4 messages per run.
6. **Next turn**: the context header lists linked runs with live status and open cards;
   `get_run` works on the pipeline id once it exists.

`POST /api/run` failures (400 validation, 403 budget) are shown inline on the card; the card
stays `proposed`.

## 10. Frontend

### 10.1 Modules (`ui/public/`)

- `ask-panel.mjs` — `createAskPanel({doc, win, fetch, sendWs, confirm, getPageContext,
  openNewPipeline, loadMarkdown, hljsLoader, storage, raf, now})` → `Object.freeze({root, open,
  close, toggle, isOpen, pushServerFrame, onHello, ownsKey, destroy})`. Builds all markup with
  DOM APIs (`textContent` only), binds its own listeners on the injected `doc`. **All state lives
  in the factory closure**; nothing is captured from `globalThis` at module evaluation (the
  module is evaluated once per test file even though app.js is re-imported with a cache-buster).
- `ask-model.mjs` — DOM-free thread model and frame reducer: `apply(frame)` (drops frames for
  other threads; job frames with `seq ≤ lastSeq`; out-of-turn frames upserted by key),
  `load(snapshot)`, `totals()`, dirty-block tracking.
- `ask-markdown.mjs` — `createMarkdownRenderer({doc, load, hljsLoader})` (§10.7).

### 10.2 app.js seams (~40 lines, all additive)

1. **Mount** after the boot `showView(...)` (`app.js:14263-14271`): create the panel, append
   `root` to `document.body` as a sibling of `div.app` (like the seven overlays,
   `index.html:1226-1377`, but created by JS so `test/ui-shell.test.mjs` is untouched). No
   network at boot (86 tests boot the app with stubbed fetch).
2. **WS** — in `handleServerMessage` (`:541`) an early branch next to the scan/agent-gen ones
   (`:556-567`) and **before** `if (!msg.runId) return;` (`:604`):
   `if (typeof msg.type === 'string' && msg.type.startsWith('ask-')) { askPanel.pushServerFrame(msg); return; }`
3. **Reconnect** — `onHello` (`:697`) calls `askPanel.onHello(msg.ask)` after the backfill loop
   (`:742-750`); the panel re-subscribes its thread when it is running and re-syncs over REST.
   `sendWs` is a closure over `state.ws` resolved at call time (shape of `:6937`).
4. **Escape** — both capture-phase document handlers (`:12463-12478`, `:12483-12494`) get
   `if (askPanel.ownsKey(e)) return;` after their `Escape` check. Rule: **Escape is routed by
   focus location** — inside the sheet the panel handles it (closes the topmost popover; nothing
   open → no-op, per mockup); outside, the page behaves as today. `confirmModal`'s own handler
   (`:6747`) wins during delete.
5. **Rail offset** — `applySidebarCollapsed()` (`:367-369`) toggles `body.rail-collapsed`
   (precedent `body.view-history`, `:14147-14148`).
6. **Page context** — `getPageContext()` from `parseHash()` (`:766`): `#running/<runId>` →
   `runs.get(runId)` (`:1162`) → `runId`, `pipelineId`, and `workspaceId` when the entry's
   `kind === 'workspace-run'` else `projectDir`; `#history/<key>/<id>` → `parseHistDetailParam`
   (`:9985`) → `pipelineId` plus `workspaceId` (key `workspaces/<id>` stripped) or `projectKey`;
   New Pipeline with the workspace target selected → that `workspaceId`; otherwise
   `selectedProjectPath()` (`:5335`) → `projectDir`. Only the §6.5 keys are sent.
7. **New Pipeline prefill** — new module-level `newPipelinePrefill` applied at the end of the
   `name === 'new'` arm of `showView` (`:14183`): `setRunTarget(card.target)` (`:5645`) and the
   prompt source toggle (`syncSourceToggle`, `:4646`) forced to prompt, then the project select +
   `onProjectChanged()` (`:5388`) or the workspace select (and the per-member source inputs
   that feed `sourceBranchByKey`, `:7095`), `#prompt` + `refreshMentionHighlights()` (`:5245`), `#title`,
   `loadWorkflowsInto` (`:3063`), `loadGuardrailsInto` (`:3114`) with `#advanced-config` opened,
   `#featureBranch`, `refreshBranches(dir)` (`:5447`) then `#sourceBranch`. `openNewPipeline(prefill)`
   closes the sheet, sets the prefill and navigates to `#new`.

The panel must never be mounted inside a `section.view`, and never carries `data-view` /
`data-nav` (`test/ui-shell.test.mjs` enumerates both).

### 10.3 Layout and CSS

- `.ask-dock`: `position:fixed; top:0; bottom:0; right:0; left:298px; z-index:40;
  pointer-events:none; display:flex; flex-direction:column; align-items:center;
  justify-content:flex-end; padding:0 28px 26px`. `body.rail-collapsed .ask-dock{left:76px}`;
  `@media (max-width:1080px){.ask-dock{left:0}}`. Children `.ask-sheet`, `.ask-pill` restore
  `pointer-events:auto`. z-index 40 sits above sticky tab lists (5) and below `.viewer-modal`
  (50) and `#confirm-modal` (60) so page modals dim the sheet and `confirmModal` is reusable.
- `.ask-sheet`: `width:min(782px,100%)`, `height:min(669px,calc(100% - 20px))`, `--panel`
  background, `1px solid var(--line-2)`, radius `--r-card` (24px), shadow
  `0 18px 60px rgba(25,25,27,.14), 0 2px 6px rgba(25,25,27,.06)`, `animation: wr-rise .26s …`
  (existing keyframes only). Three rows: header / transcript (`flex:1; min-height:0;
  overflow-y:auto; overscroll-behavior:contain`) / composer.
- `.ask-pill`: bottom-centre launcher (favicon + "Ask Worca" + `⌘K` kbd chip), hidden while open.
- Tokens only (`style.css:10-49` already hold every mockup colour; `test/ui-theme.test.mjs:61-72`
  requires some hex values to appear exactly once). New CSS is inserted **before** the final
  reduced-motion block (`style.css:2799`), which gains `.ask-dock *{animation:none !important;}`.
  Every new `.ask-*` container that can be hidden gets an explicit `[hidden]{display:none}` twin.
  Bare `textarea`/`select` rules (`style.css:308-320`) are overridden for the composer
  (`.ask-composer textarea.ask-input`).
- Focus rings on every new interactive element (`outline:2px solid var(--ink); outline-offset:2px`).

### 10.4 Interaction contract

- ⌘K / Ctrl+K **toggles** (`preventDefault`, ignore `e.repeat` and `e.isComposing`, bound on
  the injected `doc`). Open focuses the textarea (`preventScroll`); close restores the previous
  focus if still connected, else the pill. No focus trap; sheet is `role="dialog"
  aria-label="Ask Worca"` without `aria-modal`; a visually hidden `aria-live="polite"` line
  announces "answer finished" / "run needs an answer" (never the streaming text).
- Capture-phase `pointerdown` outside `[data-ask-sheet]` closes the sheet — except targets
  inside `.viewer-modal`, `#confirm-modal`, `.info-bubble`, `.mention-popup`.
- Enter sends, Shift+Enter inserts a newline (composer textarea only; the card's brief textarea
  keeps native Enter).
- Scroll pinning: `pinned = scrollHeight - scrollTop - clientHeight < 24`; when not pinned a
  "Jump to latest" pill appears; re-pin on open and after loading a thread (a hidden sheet has
  no scroll geometry).
- Elapsed counters use the panel's own 1 s interval (started on send, cleared on done/error/stop).
- Picking a thread whose `inFlight` is non-null subscribes to it immediately.

### 10.5 Blocks

- **user** — right-aligned bubble (`--field`, radius 16/16/4/16, max-width 78 %), attachment
  pills (`.extra-pill` family, no ×).
- **activity** — left gutter `1.5px solid var(--line)`; head row: dot (`--violet` + `wr-pulse`
  while running → `--green` when done), the server-sent label, mono elapsed, right-aligned
  `11.2k tok · $0.14`; tool rows (uppercase op column 38 px / truncating target / note);
  "Sub-agents" section with collapsible rows `name · model · tokens · ≈$ · status` and a mono
  log panel (`--field`, max-height 104 px, `mm:ss` timestamps). Expanded state survives patches.
- **answer** — no bubble; markdown-rendered (§10.7), max-width 92 %, re-rendered from the
  accumulated text on each animation frame while streaming; code blocks highlighted on
  `ask-done`.
- **card** — bordered card (`1.5px var(--line)`, radius 16). Target row: a `Project | Workspace`
  segment (initial value = the proposal's `target`) followed by either a project `<select>`
  (from `GET /api/projects`, value = path, "(missing)" suffix like `renderProjectOptions`,
  `app.js:5357`) or a workspace `<select>` (`GET /api/workspaces`, `ui/server.mjs:1897`)
  with the member names listed beneath it. Workflow `<select>` (`GET /api/workflows`, labels via
  `workflowPickerLabel`), guardrails `<select>` (`GET /api/guardrails`, every set incl.
  Permissive, default `normal`), brief `<textarea>` (auto-grow), feature branch `<input>`.
  Source branch — project: `<select>` (lazy `GET /api/branches?projectDir=`, "current branch
  (auto)" first, reloaded on project change); workspace: a default `<input>` ("auto" when
  empty) plus a collapsed "Per-member source branches" `<details>` with one `<input>` per
  member feeding `sourceBranchByKey` (mirrors the New Pipeline workspace controls). Buttons
  **Not now** (ghost) / **Start** (black) and an "Open in New Pipeline" link (prefill sets the
  target accordingly, §10.2 seam 7). `started` → link `#running/<runId>` (`targetHash`,
  `app.js:14131`), fields read-only; `dismissed` → one-line stub; `failed` → stub with the
  error; errors inline in `.ask-card-err`, Start re-enabled. **`beginRun` (`app.js:7176`) is
  never called** — it navigates to the Running view; the rail picks the run up from the
  `run-created` broadcast.
- **notice** — `--ink-3` text with a `--blue-ink` link (run started / needs answer / failed /
  finished; "context restored"; "proposal rejected"; "stopped: limit reached").
- **error** — `--red-ink` line.

### 10.6 Composer, popovers, threads

- Composer: textarea (≤120 px, auto-grow); `+` → hidden `<input type=file multiple
  accept=".md,.markdown,.txt,.json,.csv,.log,text/*">` (the same extension list as the server),
  read with `File.arrayBuffer()` → base64, deduped by name (newest wins), chips `.extra-pill`
  with ×, caps mirrored client-side, errors in `.ask-composer-msg` (no toast system exists);
  meter bar (thread tokens | cost | agents) opening the **run-info** popover (agents this chat
  with model · meter · status); **model · effort** button opening the picker; send (black
  circle) / stop.
- Popover primitive `.ask-pop` (absolute **inside** the sheet, not the body-level
  `.mention-popup`): `role="menu"`, arrow/Home/End/Enter/Space, Escape → trigger, click-away via
  the sheet's single capture listener. Used for threads, run info and the model picker.
- Model picker: catalog from `GET /api/ask/models`; primary list = first entry per family
  (`opus|fable|sonnet|haiku`, in `PREDEFINED_MODELS` order, `config.mjs:64-76`) + user globals;
  the rest (1M twins, older versions) under "More models ›"; per-model efforts from the entry;
  "Effort ›" secondary pane; persisted as `localStorage['worca-cc.ask.model'] = {model, effort}`
  in try/catch; validated against the catalog on load (unknown → initial default); initial
  `claude-opus-5` / `high`.
- Header: title (thread title, else "Ask Worca"), **Recent chats** popover (`GET /api/ask/threads`
  on open; live dot; meter `18.4k tok · $0.21 · 3 agents`; trash → `confirm({title:'Delete this
  chat?', message:'“…” and its transcript are removed. This cannot be undone.', confirmLabel:'Delete',
  danger:true})` → `DELETE`; focus returns to the textarea), new thread (clears the model and
  `threadId`; the thread row is created on the first send, §6.2.1), close. Last active thread in
  `localStorage['worca-cc.ask.thread']`.

### 10.7 Markdown safety

`marked` and `dompurify` are added as **runtime dependencies**, pinned, and served through two
narrow routes next to the hljs ones (`ui/server.mjs:615-648`): `GET /vendor/marked/marked.esm.js`
and `GET /vendor/dompurify/purify.es.mjs`, resolved with **`import.meta.resolve`** (Node ≥20.6;
the CJS `require.resolve('dompurify')` resolves to the CJS build and `dompurify/package.json` is
not exported), `Content-Type: text/javascript`, `nosniff`; misses fall into the existing `/vendor`
404 no-store catch-all. The client lazily `import()`s both on first answer; failure → plain-text
fallback (never an endless retry). Module shapes (verified): `marked.esm.js` has **no default
export** (use `mod.marked`); `purify.es.mjs` default-exports a factory that must be called with a
window (`DOMPurify(win)`) — tests instantiate it with the jsdom window.

Rendering: `marked.parse(text, {gfm:true, breaks:true, async:false})` →
`DOMPurify.sanitize(html, {ALLOWED_TAGS:[p,br,strong,em,del,code,pre,ul,ol,li,a,h1-h6,blockquote,hr,table,thead,tbody,tr,th,td,input],
ALLOWED_ATTR:[href,class,type,checked,disabled,align], ALLOWED_URI_REGEXP:/^(?:https?:|mailto:|#)/i, RETURN_DOM_FRAGMENT:true})`.
No `img`, `style`, `id`, `name`. `class` re-validated (`language-*` on `code`, `hljs-*` on spans).
Anchors: `http(s)`/`mailto` → `target="_blank" rel="noopener noreferrer"`; `#…` left as in-app
hash links. Answers over 200 KB render as plain `pre-wrap`. Code blocks: map `language-X` into
`SUPPORTED_LANGUAGE_IDS` (`syntax-highlight.mjs:34`), highlight via the app's `diffHljsLoader`
with the same detached-staging commit rules as `hdApplyHighlights` (`app.js:11244-11257`).
hljs colour variables are widened from `.hd-diff-pane{--hd-syntax-…}` (`style.css:1877-1884`)
to `.hd-diff-pane,.ask-md{…}` without restating any hex.

### 10.8 Streaming render and replay

Model + targeted DOM patching (not full re-render): block builders return `{el, update}`;
frames mark blocks dirty; one flush per animation frame (`raf` falls back to `setTimeout 0` —
jsdom has no `requestAnimationFrame`); tool rows and agent log lines append-only; agent rows
keyed by id and patched in place; the live answer block re-rendered from accumulated text
unless it contains a non-collapsed selection (then retried next frame); static blocks never
re-render. Replay: `lastSeq` per job, `seq ≤ lastSeq` dropped; a gap or a reconnect re-fetches
`GET /api/ask/threads/:id` (persisted blocks and the in-flight job's accumulated state share
one schema) and re-subscribes.

## 11. Error handling

| situation | behaviour |
|---|---|
| claude exits non-zero | `ask-error` with the runner's classified message; partial text kept; thread usable |
| resume unusable (gone, or left dangling by a killed turn) | one transparent retry with DB replay + "Context restored from history" notice; second failure clears `session_id` and reports |
| `--max-turns` / `--max-budget-usd` reached | `ask-done{status:'stopped', reason}` + "Stopped: reached … (Settings → Ask Worca)" notice |
| turn exceeds 15 min | abort → `ask-error "timed out after 15 min"` |
| MCP child crash / tool error | claude receives a `tool_result{is_error}`; the assistant reports it; server logs the child's stderr |
| server re-validation rejects a card the child accepted | "Proposal rejected: …" notice, no card |
| attachment invalid / over limits | `400`/`413`, inline in the composer |
| `POST /api/run` 400/403/409 | inline on the card, Start re-enabled |
| preflight failure after `200 {runId}` | run `error` event → "Run failed" notice, card `failed` |
| server restart mid-turn | turn lost; message marked `error` by the startup sweep; UI shows it on next load |
| WS drop | `onHello` re-subscribe + REST re-sync; job frames idempotent by `seq`, out-of-turn frames by key |
| picker model missing from the catalog | falls back to the initial default on load |
| diff archived | `get_run_diff{available:false}`; the system prompt tells the assistant to say so |
| thread deleted while a run is followed | follower detached; the run continues unaffected |

## 12. Testing

All `node:test`, offline (`WORCA_MOCK=1` for API tests, injected implementations for unit tests).
Fixtures: the captured probe frames are saved as `test/fixtures/ask/*.jsonl` **after
sanitising** (home path, session ids, plugin/MCP server names, hook output).

**Pure / core**: `ask-tools` (fake readers + one temp-home test with a seeded project pipeline and a
seeded workspace pipeline under `workspaces/<id>`, each with a written `diff-patch.patch`:
paging, protected-basename stripping, archived ⇒ `available:false`, key-less `get_run`,
`workspaceId` lookups, `list_runs` carrying `target`, `read_attachment` refuses another
thread's id; a source scan asserts no
`INSERT`/`UPDATE`/`DELETE` in `tools.mjs`); `ask-proposal` (error strings equal the `/api/run`
400s/404s for both targets — unknown workspace, missing member path, non-git member; exactly
one of `projectKey`/`workspaceId`; `sourceBranchByKey` restricted to member keys; default
`normal`; `permissive` rejected; branch sanitising); `ask-prompt` (system prompt
byte-stable for identical catalogs; header clipping and the client-context schema; inline vs
listed attachments; restore builder cap); `ask-events` (probe fixtures: deltas → text, per-block
usage dedupe, tool lifecycle, Task result object and string, child-stream log lines, card
extraction, cost-estimate arithmetic, redaction, `error_max_turns`/`error_max_budget_usd`
shapes, frames with `parent_tool_use_id` ignored for text, the two frame classes); `ask-models`
(plugin-shadowed predefined id survives the filter; plugin-only entries excluded); `ask-store`
(CRUD on a temp home; `seq` allocation under interleaving; migration test: a DB stamped at
`SCHEMA_VERSION` **without** the ask tables gets them from `reconcileSchema`); `ask-spawn`
(cwd under `<WORCA_HOME>/tmp/ask`, `dontAsk`, `tools:['Task']`, no Bash/Read/Write/Edit in
`allowedTools`, every path deny rule starts with `//` or `~/` and none contains the resolved
home; `buildClaudeArgs` output **contains** `--tools Task`, `--strict-mcp-config`,
`--setting-sources project`, `--disable-slash-commands`, `--include-partial-messages`,
`--max-turns 40`, `--max-budget-usd 2` and never `--add-dir`; **plus a fake-bin argv-capture
case** (technique of `test/spawn-args.test.mjs:95-123`) proving each new flag reaches the
spawned argv through all five gates; the existing baseline argv test stays byte-identical);
`ask-mcp-stdio` (spawn the script with a temp `WORCA_HOME`, send `initialize` / `tools/list` /
`tools/call`, assert responses and that stdout never carries non-JSON); `ask-follow` (bare
emitter → exact notices, no flooding); runner `ask` mock role (frame sequence per scenario; a
prompt containing `MOCK_ASK: /x.json` writes nothing); a fake-bin real-parser test replaying the
bogus-resume stdout/stderr + exit 1 (technique of `test/claude-runner-session.test.mjs:38-49`);
`ask-redact` (extra patterns).

**API**: `ask-api` (copy of the `test/agentgen-api.test.mjs:31-59` boot: temp `WORCA_HOME`,
`WORCA_MOCK=1`, dynamic import, listen for WS): threads CRUD incl. 404s; message → frames until
`ask-done`; a card with `guardrailsId:'normal'` and the seeded project; mid-turn reconnect replay
(`MOCK_SLOW`); `POST /api/run` with `askThreadId` → "Run started" and `done` notices from the mock
pipeline, for a project card and for a workspace card (entry kind `workspace-run`), `400` on a
bad/missing pair, `409` on a non-proposed card; `409` while in flight and
not during the grace period; `stop` idempotent; `DELETE` removes rows and the directory;
attachment validation (`400`/`413`, UTF-8, NUL); `GET /api/ask/models`; settings: ask-only POST
leaves `root` and budget keys untouched, range validation, `settingsState()` key list
(`test/settings-projects-root.test.mjs:309-313` updated). `api-ask-vendor-assets` (copy of
`test/api-hljs-assets.test.mjs`: 200 + `text/javascript` + `nosniff`, importable via `data:` URL
asserting `mod.marked` / `mod.default`, version pins, misses 404 no-store).

**UI**: `ask-model` (reducer: frame table → blocks, replay identical, late job frames after done
ignored, out-of-turn upserts, load round-trip, totals); `ask-panel` (injected `doc/win/fetch/
confirm/getPageContext/openNewPipeline/loadMarkdown/raf`, no app boot: persisted render per block
kind; frame sequence → dot, label, tool rows, agent expand/log, delta accumulation, meters; scroll
pinning with instrumented accessors; popovers; model pick persists; attachments via
`defineProperty(input,'files')` → base64 body; `onHello` → subscribe + re-fetch; Enter vs
Shift+Enter; stop POST; thread pick subscribes when in flight); `ask-markdown` (real
`marked`/`DOMPurify(window)` under jsdom: script, `img onerror`, `javascript:`/`data:` hrefs,
iframe, form, DOM clobbering, `style`, `on*`, `svg onload` all neutralised; `https:` links get
`_blank noopener noreferrer`; `#history/p/1` kept; hostile hljs output falls back to text;
>200 KB → plain; failing `load` → fallback); `ui-ask-integration` (app boot with the running-page
recipe + rAF stub + `window.__worcaTestHooks.askMarkdown`: dock present and closed, no `/api/ask`
fetch at boot, ⌘K/Ctrl+K toggle with `defaultPrevented`, survives `go('running')` /
`go('history')` / `go('settings')`, Escape on the textarea with History detail open leaves the
hash unchanged while Escape on `document` still routes, `ask-delta` reaches the transcript while
`runId` frames are untouched, `body.rail-collapsed` follows the sidebar, delete → `#confirm-ok` →
`DELETE` + focus back, pointerdown inside an open `.viewer-modal` keeps the sheet open);
`ui-ask-card` (seeded project card and seeded workspace card; edits incl. switching target and
per-member source overrides; Start → `/api/run` body deep-equals the expected project body /
the expected workspace body with `sourceBranchByKey`, hash unchanged; `{runId}` → link +
`started`; 403 → `.ask-card-err`; Not now → `dismissed`; Open in New Pipeline → `#new` prefilled
with the matching target and source forced); `ui-ask-style` (raw `style.css` assertions
compatible with `ui-theme` / `ui-diff-style`: `.ask-dock{` has `position:fixed`, `z-index:40`,
`pointer-events:none`; rail arms; no 6-digit hex in the ask section; final reduced-motion block
contains `.ask-dock *`); `ui-settings` additions for the Ask Worca section.

**Regression fences that must stay green**: `spawn-args`, `claude-runner-session`,
`settings-projects-root`, `ui-shell` (no new `data-view`/`data-nav`), `ui-theme`, `ui-diff-style`,
`ui-boot`, `agentgen-api` (registry untouched), `api-hljs-assets`.

**Manual gate before merge** (cannot be automated offline; results recorded in the plan's
verification section): one real haiku turn through the full recipe confirming (1) the MCP
handshake and an `mcp__worca__list_runs` call under `dontAsk`; (2) `mcpServers.env` forwarding
(the child sees `WORCA_HOME`); (3) a Task sub-agent calling a worca tool; (4) the negative case —
a `Task` child of `subagent_type:'Explore'` asked to read `<WORCA_HOME>/settings.json` has no Read
tool or is denied; (5) a probe with `--tools Read` showing `Read(//**/.worca-cc/**)` denies
`<WORCA_HOME>/settings.json`; (6) `--resume` after a Stop mid-tool-call, or the fallback path
engaging.

## 13. Mockup deviations

- Models/efforts come from the real catalog (the mockup lists Opus 4.6 / Sonnet 4.5 / Haiku 4.5
  and a "Low" effort that does not exist).
- Delete confirmation uses the app's `confirmModal` (z-60) instead of the in-sheet card.
- "Not now" leaves a one-line dismissed stub instead of removing the block.
- The sheet is positioned with a fixed dock (the mockup's `position:absolute` inside `<main>`
  would scroll away in the real layout).
- Sub-agent cost is an estimate (the CLI emits none) and is marked "≈".
- No close animation in v1 (reduced-motion fence); open uses the existing `wr-rise`.
- No voice button, no `Chat | Cowork` segment, no `+` menu beyond file attachment.

## 14. Verification ledger

| claim | status |
|---|---|
| flags `--include-partial-messages`, `--input-format`, `--strict-mcp-config`, `--mcp-config` (file or JSON), `--tools`, `--setting-sources`, `--disable-slash-commands`, `--permission-mode dontAsk`, `--settings`, `--append-system-prompt`, `--effort` (incl. `low`), `--resume`, `--max-budget-usd` | probed (`claude --help`, 2.1.239) |
| hidden `--max-turns`, `--append-subagent-system-prompt` accepted | probed |
| `result.subtype` values `error_max_turns` / `error_max_budget_usd` exist | grep-verified in the binary; runtime shape **unverified** |
| stream-json shapes of §6.6 (deltas, per-block `assistant` frames, `tool_use`/`tool_result`, `parent_tool_use_id`, `result` fields) | probed |
| `--resume` across processes; bogus session ⇒ exit 1 / `No conversation found` / $0 | probed |
| `--tools` allowlist, MCP tools surviving it, `--strict-mcp-config`, `--setting-sources project`; a cwd-relative deny rule biting under the recipe | probed |
| `//`-anchored deny rules covering ancestor paths (`Read(//**/.worca-cc/**)`) | documented semantics; **unverified** — manual gate (5) |
| `--bare` (OAuth) and `--safe-mode` (kills MCP) unusable | probed |
| prompt-prefix caching across processes with identical flags | probed |
| `DatabaseSync` second-process access to the WAL DB | code + probed |
| Task `tool_use_result` object shape | grep-verified in the binary; runtime **unverified** |
| `mcpServers.<name>.env` merged over the scrubbed spawn env | documented; **unverified** — manual gate (2) |
| sub-agents inherit the tool pool and permission rules | documented; **unverified** — manual gate (3)(4) |
| `~/.claude/CLAUDE.md` still loaded under `--setting-sources project` | **unverified**; assumed loaded |
| `--allowedTools mcp__worca` wildcard under `dontAsk` | verified by the pipeline under `acceptEdits` only; fallback `acceptEdits` if MCP calls are denied — manual gate (1) |
| resume after SIGTERM mid-tool-call | **unverified**; the fallback of §6.2.7 engages on any early rejection — manual gate (6) |
| `File.arrayBuffer()` in jsdom 29; `import.meta.resolve` on Node ≥20.6; `marked.esm.js` no default export; `purify.es.mjs` factory default | verified at the shell |

## 15. Rollout

Feature branch `worca/ask-worca` off `dev`. Implementation via three written plans and an
integration gate (§16), executed with the house flow (Fable refiners/reviewers, Opus
implementers, TDD). The suite (~3000 tests) must stay green; `docs/storage.md` gains the `ask/`
root; `docs/guardrails.md` gains an "Ask Worca sandbox" paragraph including the `//` anchoring
rule; `README.md` gains one feature bullet. The manual gate of §12 runs before merge to `dev`.

## 16. Plan decomposition

The frozen contract (§5) is written first; then:

| plan | scope | tests it can run alone |
|---|---|---|
| **P1 — core & runner** ✅ **DONE** (commit `1b02d87b`; executed plan: see Execution status at the top) | runner options through all five gates; `generateTitle` pass-through; `listProjects` key; DDL + ladder + `schemaGaps`; `store`, `limits`, settings keys + root-guard + `settingsState`; `models`, `catalog`, `prompt`, `proposal`, `tools`, `events`, `spawn`, `redact`; `mcp-stdio`; mock `ask` role; sanitised fixtures | every "Pure / core" test of §12, `settings-projects-root` |
| **P2 — server** (after P1) | `turn`, `askJobs`, REST routes, WS subscribe/hello, startup sweeps, `follow` + `/api/run` link, `GET /api/ask/models`, vendor routes, docs | `ask-api`, `api-ask-vendor-assets`, regression fences |
| **P3 — frontend** (after P1; parallel with P2) | `ask-model`, `ask-markdown`, `ask-panel`, CSS, the seven app.js seams, Settings section, dependency pins | all "UI" tests of §12 against fixture frames and a stubbed `/api/ask/*` |
| **P4 — integration gate** | end-to-end in mock mode, then the manual gate (§12) against the real CLI; README/docs | full suite + the six manual checks |

---

## 17. Appendix — rev 2.1 (2026-08-22): post-P1 binding amendments

Copied **verbatim** from the executed P1 plan (`/Users/denislavprinov/.worca-cc/store/worca-cc-551183d0/plans/22-08-26-ask-worca-p1-core-runner-implementation--v3.md`, the authoritative P1 record) so P2/P3/P4 planning does not depend on that 423 KB file. Where anything below conflicts with §6/§14 of this spec, **this appendix wins** (probe-measured on `claude` 2.1.239). Heading levels demoted one step; content otherwise unchanged.

### Verified facts from the planning probes (2026-08-22, `claude` 2.1.239) — binding for P1–P4

These were measured with the exact sandbox recipe (haiku, 14 runs, ≈ $0.20; raw captures in the session scratchpad `probe2/`). Where they differ from the spec they **supersede** it.

| # | fact | consequence in this plan |
|---|---|---|
| F1 | **Task sub-agents run in the BACKGROUND by default** under the recipe: the parent's `tool_result` arrives immediately with `tool_use_result:{isAsync:true,status:'async_launched',…}`, child frames interleave with the parent's answer, a **second `system/init`** (same session) and **two `result` frames** (cumulative cost) follow. Setting env **`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`** restores the foreground shape the spec assumes (one `result`, finishing `user` frame with a `tool_use_result` object). | `spawn.mjs` adds the variable through `modelEnv` (merged last, `CLAUDE_` prefix survives scrub, not reserved — `model-env.mjs:26-31`); the reducer still takes the LAST `result`, never sums `costUsd`, and tolerates a second `init`. Supersedes spec §6.3 (the spec file is unchanged — P2–P4 read this table first). |
| F2 | The sub-agent tool_use block is named **`Agent`** (`{name:'Agent', input:{subagent_type, description, prompt}}`), while `init.tools` lists `Task` and `--tools Task` is the right flag. | The reducer matches `name === 'Task' || name === 'Agent'`. |
| F3 | Foreground finishing frame: `user` with `message.content:[{type:'tool_result',tool_use_id,content:[{type:'text',text:<answer>},{type:'text',text:'agentId: …\n<usage>…</usage>'}]}]` and top-level `tool_use_result:{status:'completed',prompt,agentId,agentType,content,resolvedModel,totalDurationMs,totalTokens,totalToolUseCount,usage:{input_tokens,cache_creation_input_tokens,cache_read_input_tokens,output_tokens,…},toolStats}`. Child frames carry `parent_tool_use_id` and are only `user*` (the prompt), `assistant*` tool_use blocks and `user*` tool_result blocks — **no child text/thinking deltas, no child `init`, no `tool_use_result` on child frames**. Extra `system` subtypes: `task_started`, `task_progress{usage:{total_tokens,tool_uses,duration_ms},last_tool_name}`, `task_updated`, `task_notification`, `background_tasks_changed`; every run also carries `system/status`, many `system/thinking_tokens` frames and a top-level `rate_limit_event` frame type (D3 capture: 3–41 `thinking_tokens` per run). | Agent block fields come from `tool_use_result`; log lines from child `tool_use`/`tool_result` pairs; the `system/task_*` subtypes are noise (dropped). `prompt` fields are never persisted. |
| F4 | `tool_use_result` has **four shapes**: a string `Error: …` (any tool error, incl. MCP `isError:true` content AND JSON-RPC error responses — indistinguishable to the model), an **array** `[{type:'text',text}]` (MCP success), `{type:'text',file:{…}}` (Read), the agent object (F3). `tool_result.content` is an array for successes and a plain string for errors. | The reducer reads `tool_result.content` (string or array) and only inspects `tool_use_result` when it is an object with `agentId`. |
| F5 | `--max-turns 1` ends with `result{subtype:'error_max_turns',is_error:true,errors:['Reached maximum number of turns (1)'],terminal_reason:'max_turns',num_turns:2}` and **exit code 1 with empty stderr**; `--max-budget-usd 0.0001` ends with `result{subtype:'error_max_budget_usd',terminal_reason:'budget_exhausted',errors:['Reached maximum budget ($0.0001)'],is_error:true}`, exit 1. `--max-turns N` still executes the N-th message's tool calls. The runner therefore **rejects** with `` `${bin} exited with code 1: ${detail}` `` (`claude-runner.mjs:501-519`) where `detail` = stderr tail, else the `result` frame's `result`/`error` string when `is_error` (`claude-runner.mjs:434-441`), else `'no stderr'` — these limit frames carry `errors[]` but no `result` string, so the message is `claude exited with code 1: no stderr`; never parse it, read the reducer instead. | The reducer records `resultSubtype`/`errors`; P2's `turn.mjs` must consult `reducer.snapshot().resultSubtype` **before** classifying a rejection (supersedes spec §6.2.6: read "when `runClaude` resolves" as "when it settles"; the spec file is unchanged). The mock `ask` role mirrors this: it emits the `result` frame and then rejects. |
| F6 | `Read(//**/.worca-cc/**)` and `Read(//**/secrets.json)` DENY ancestor/sibling paths (`tool_result{content:'<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>',is_error:true}`); the cwd-relative `Read(**/…)` forms READ them. Denials never appear in `result.permission_denials` (stays `[]`). | Spec §6.3 rules confirmed; manual-gate item (5) is closed. A denial is just an errored tool block. |
| F7 | `mcpServers.<name>.env` is merged OVER the (scrubbed) parent env and wins collisions; `claude` forwards its whole env to the MCP child and adds `CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_PROJECT_DIR` (= cwd); the child's cwd is `claude`'s cwd. | Manual-gate item (2) is closed. `mcp-stdio.mjs` also accepts `--home/--thread` argv (written into the config) so nothing depends on env forwarding. |
| F8 | Under `--tools Task` an `Explore` child has **no Read tool** (the canary file never appeared — the child inherits the tool POOL; inheritance of the deny RULES by a child was not separately exercised); `--append-subagent-system-prompt` reaches children verbatim and the parent never sees it. | Manual-gate items (3)(4) closed. `SANDBOX_NOTE` stays a runner option. |
| F9 | **Stop:** SIGTERM mid-tool-call makes `claude` exit itself (code 143, ~600 ms, no SIGKILL needed) after writing a synthetic `user` `tool_result{content:'Connection closed',is_error:true}`; no `result` frame. **`--resume` of that session afterwards works** (exit 0, cache hit). A bogus session id fails with exit 1, `result{subtype:'error_during_execution',errors:['No conversation found with session ID: …']}`, `$0`, no `assistant` frame. | Manual-gate item (6) closed; the §6.2.7 fallback is only for the "no conversation found" case; the reducer exposes `sawInit` / `errors` / `sawAssistant` for P2's predicate (rule R-C). |
| F10 | `--tools ""` is accepted: `init.tools` = the MCP tools only. `--strict-mcp-config` works with **and without** `--mcp-config` (title-style call, probe `R6-title`: exit 0, `total_cost_usd 0.014699`, `terminal_reason:'completed'`). `--effort low` accepted. `~/.claude/CLAUDE.md` is **NOT loaded** under `--setting-sources project` (skills/plugins/slash commands empty, no hook frames). `--permission-mode dontAsk` + `--allowedTools Task,mcp__worca` executes every MCP call. | Runner contract `tools:[]` ⇒ `--tools ""`. Manual-gate item (1) closed for a synthetic server. Supersedes the spec §6.3 "what still enters" entry for CLAUDE.md (evidence = the model's self-report plus zero hint hits; treat as "not loaded, not guaranteed"; the spec file is unchanged). |
| F11 | MCP wire (complete): `initialize{protocolVersion:'2025-11-25',capabilities:{roots:{listChanged:true},elicitation:{}},clientInfo{name:'claude-code',version}}` with **`id: 0`** → `notifications/initialized` (no id) → `tools/list` (id 1) → `tools/call{name,arguments,_meta:{'claudecode/toolUseId',progressToken}}`. Advertising only `capabilities:{tools:{}}` means `resources/*`, `prompts/*`, `roots/*`, `ping` are never sent. Connect timeout 30 s; connected in 47 ms. `claude` closes the child's stdin on shutdown. | `mcp-stdio.mjs`: notification check is `id === undefined || id === null` (ids start at 0), echo the requested `protocolVersion`, exit on stdin `end`. |
| F12 | `assistant` frames arrive once per content block with the same `message.id` and the **message-start** `usage` repeated (`output_tokens: 8` vs `301` in the `message_delta`); `message_delta.usage` is the only reliable per-call figure; `result.usage`/`total_cost_usd` are authoritative. `result.modelUsage` carries **two keys per canonical model** — e.g. `claude-haiku-4-5` and `claude-haiku-4-5-20251001`; the dated key is the CLI's own `ai-title` side call (≈ $0.001/turn, counted in `total_cost_usd` and against `--max-budget-usd`); each entry has `canonicalModel`. | Usage dedupe by `message.id` with `message_delta` winning; agent cost estimate matches the agent's model against `modelUsage` keys by exact id first, then `canonicalModel`. |

### Frozen P1 → P2/P3 contract

P2 (server) and P3 (frontend) are written against exactly these names. Changing any of them means changing those plans too.

```js
// ── src/core/claude-runner.mjs — 8 new runClaude options (all default-off) ──
// tools?: string[]                → --tools a,b   ([] → --tools "")
// strictMcpConfig?: boolean       → --strict-mcp-config
// settingSources?: string[]       → --setting-sources a,b   ([]/absent → nothing)
// disableSlashCommands?: boolean  → --disable-slash-commands
// includePartialMessages?: boolean→ --include-partial-messages
// maxTurns?: number               → --max-turns N   (positive safe integer, else omitted)
// maxBudgetUsd?: number|null      → --max-budget-usd N (finite > 0, else omitted; null ⇒ omitted)
// appendSubagentSystemPrompt?: string → --append-subagent-system-prompt text (non-empty)
// runClaude still resolves {text, exitCode} ONLY (claude-runner.mjs:522) and rejects on exit≠0 / abort.

// ── src/core/title.mjs ──
generateTitle(prompt, opts)   // opts gains: tools, strictMcpConfig, settingSources, disableSlashCommands, mcpConfigPath

// ── src/core/projects.mjs ──
listProjects() → Promise<Array<{key, name, path, exists}>>

// ── src/core/artifacts.mjs (additive exports) ──
export function totalsFor(row) → {cost:number|null, active:number|null}
export function findPipelineRowById(id) → row|null       // every store key, archived included (pipelines.id is the PRIMARY KEY)

// ── src/core/settings.mjs ──
DEFAULT_ASK_MAX_TURNS = 40; DEFAULT_ASK_MAX_BUDGET_USD = 2
askMaxTurns() → 1..500 ; askMaxBudgetUsd() → 0.1..100 | null (null = no cap)
assertAskLimitInputs({askMaxTurns?, askMaxBudgetUsd?})   // throws Error(message)
setAskMaxTurns(input) → {askMaxTurns} ; setAskMaxBudgetUsd(input) → {askMaxBudgetUsd}
// GET/POST /api/settings carry `askMaxTurns`, `askMaxBudgetUsd`; an ask-only POST never clears `root`.

// ── src/core/ask/limits.mjs ──
ASK_LIMITS (frozen constants, see Task 5) ; askLimits({readMaxTurns?, readMaxBudgetUsd?}) → {maxTurns, maxBudgetUsd}

// ── src/core/ask/redact.mjs ──
redactAskText(s) → string ; ASK_EXTRA_PATTERNS

// ── src/core/ask/models.mjs ──
createAskModels({listModels?, predefinedIds?}) → {askCatalog, validateModelEffort}
askCatalog() → Promise<{models:[{id,label,efforts,custom:false|'global'}], efforts:string[]}>
validateModelEffort(model, effort) → Promise<{ok:true, model, effort} | {ok:false, error}>

// ── src/core/ask/catalog.mjs ──
createCatalog(deps?) → {buildCatalog} ; buildCatalog() → Promise<{projects, workspaces, workflows}> ; shapeWorkflow(tpl, registry)

// ── src/core/ask/prompt.mjs (pure) ──
ASK_SYSTEM_RULES ; buildSystemPrompt(catalog) ; validateClientContext(raw) ; buildContextHeader(ctx, {maxChars}) ;
selectInlineAttachments(list, {maxBytes}) ; buildTurnPrompt(header, text, inlined) ; buildRestoredPrompt(messages, turnPrompt, {maxChars})

// ── src/core/ask/proposal.mjs ──
createProposalValidator(deps?) → {validateProposal} ; validateProposal(input, {cardId?}) → Promise<{ok:true, card} | {ok:false, errors}>
isSyntacticRef(s) ; PROPOSAL_ERRORS

// ── src/core/ask/tools.mjs ──
createAskTools(deps) → {list(), call(name, input)} ; class AskToolError ; splitUnifiedDiff ; isProtectedBasename ; sliceBytes

// ── src/core/ask/mcp-stdio.mjs (executable) ──
// node --disable-warning=ExperimentalWarning src/core/ask/mcp-stdio.mjs --home <base> --thread <askId>   (env WORCA_HOME / WORCA_ASK_THREAD_ID also honoured; argv wins)

// ── src/core/ask/spawn.mjs (pure) ──
buildAskSpawnOptions({thread, turn, limits, mcpConfigPath, scratchDir}) → runClaude options
buildMcpConfig({homeBase, threadId, execPath?, serverPath}) → {mcpServers:{worca:{…}}}
buildMockMarkers(card) → string ; ASK_DENY_RULES ; SANDBOX_NOTE

// ── src/core/ask/events.mjs (pure) ──
createTurnReducer({onFrame, redact?, now?, setTimeout?, clearTimeout?, onProposal?, attachmentNames?, limits?})
  → {push(event), flush(), snapshot(), finish(), addBlock(block), updateBlock(id, patch)}
// frames handed to onFrame are BARE: {type:'ask-label'|'ask-delta'|'ask-block'|'ask-card'|'ask-usage', ...payload};
// P2 stamps {threadId, messageId, seq}. The reducer never emits ask-start/ask-done/ask-error.
// finish() → Summary {text, blocks, usage, costUsd, sessionId, status:'done'|'stopped', reason, resultSubtype, isError,
//                     errors, numTurns, durationMs, sawInit, sawAssistant, sawResult, agents, labels, reducerErrors}
normalizeUsage(u) ; estimateAgentCosts(agents, result) ; labelForTool(name, input, attachmentNames)

// ── src/core/ask/store.mjs (sync, over db.mjs) ──
ASK_ID_RE ; newAskId(prefix) ; askRoot() ; attachmentsDir(threadId)
createThread, getThread, listThreads, updateThread, setThreadTitle, addThreadTotals, deleteThread, sweepEmptyThreads
appendMessage, getMessage, listMessages, finishMessage, setMessageBlocks, findCard, updateCardBlock, sweepStreamingMessages
addAttachment, listAttachments, getAttachment, readAttachmentText, threadAttachmentBytes
linkRun, updateRunLink, listRunLinks

// ── src/core/claude-runner.mjs mock ──
// system prompt markers `MOCK_ROLE: ask` + `MOCK_ASK_CARD: <one-line json>` select the ask role (Task 16);
// scenarios are chosen from the USER text: /\b(propose|start|run)\b/i, /\bagents?\b/i, MOCK_FAIL, MOCK_MAX_TURNS, MOCK_MAX_BUDGET, MOCK_SLOW.
// export function mockEnabled(opts) → boolean   // WORCA_MOCK / ORCH_MOCK truthy (not '0'/'false') or opts.mock — P2 uses it to decide `turn.mock = {card}`

// ── further exports P2/P3 may rely on ──
// spawn.mjs:     ASK_PERMISSION_MODE, ASK_BUILTIN_TOOLS, ASK_MCP_GRANTS, ASK_SPAWN_ENV, ASK_MCP_SERVER_PATH (absolute path of mcp-stdio.mjs)
// events.mjs:    matchModelKey(model, modelUsage) ; reducer.settle() → Promise<void>  (see rule R-A)
// tool-deps.mjs: defaultToolDeps({threadId}), readDiffPatch(row), hasDiffPatch(row)
// mcp-stdio.mjs: parseArgv(argv), createRpcServer({tools, write, log?, serverVersion?}), main(opts)
// store.mjs:     listThreads() rows carry `runLinks` = a COUNT (number), not the link rows — GET /api/ask/threads exposes that count
// BLOCK SHAPES P3 RENDERS (beyond spec §7.1): a tool block's `input` is the original object OR `{_truncated:true, preview:string}` (≤ 2 KB of JSON;
//   render `preview` verbatim, mono); agent blocks carry `usage:{input,output,cacheRead,cacheCreation}|null`, `tokens:number|null`, `estimated:true`.
// summary.sawAssistant is true once a MAIN-stream message_start OR assistant frame arrived (= an API call happened), not "an answer exists".
// P3 FIXTURE FRAMES: replay test/fixtures/ask/*.jsonl through createTurnReducer({onFrame, setTimeout:(fn)=>(fn(),1), clearTimeout(){}}) and stamp
//   {threadId, messageId, seq} yourself — the committed fixtures are raw claude frames, not ask-* frames.
```

**Rules for P2 (`turn.mjs` / routes) that P1 cannot enforce — binding:**

- **R-A — settle before finish.** `onProposal` is called synchronously from the reducer; P2's hook runs `validateProposal` (async DB/git readers) and then `reducer.addBlock(card)`. The `result` frame and the process `close` can land before that promise resolves, so `turn.mjs` MUST `await reducer.settle()` (which awaits every value returned by `onProposal`) BEFORE calling `finish()`; `addBlock`/`updateBlock` called after `finish()` return `null` and count in `reducerErrors` — the card would otherwise be broadcast after `ask-done` and never persisted. **Persist the card immediately:** right after `reducer.addBlock(card)` (and after every notice added mid-turn) call `setMessageBlocks(assistantMessageId, reducer.snapshot().blocks)` so `findCard`/`updateCardBlock` (rule R-B) see the card while the turn streams and a server restart cannot lose it; `finishMessage` at turn end re-writes the same array (after R-B's live flips). `settle()` has no timeout of its own — race it against the turn's abort signal (`Promise.race([reducer.settle(), abortedPromise])`).
- **R-B — in-flight card flips.** A `proposed` card is actionable while its message is still streaming. `POST /api/run` / the dismiss route MUST update BOTH the store (`updateCardBlock(threadId, cardId, patch)`) and, when `askJobs.get(threadId)?.status === 'running'`, the live reducer (`askJobs.get(threadId).turn.reducer.updateBlock(cardId, patch)`, which re-emits the `ask-card` job frame) — otherwise `finishMessage(id, {blocks: summary.blocks})` at turn end reverts the flip with the reducer's stale copy.
- **R-C — classifying a runner rejection.** `const s = reducer.snapshot()`. **First the abort branch:** if `err.name === 'AbortError'` (`claude-runner.mjs:495-499`; the mock's `abortIfNeeded` throws the same) NEVER retry — if the abort came from the 15-minute wall clock (set a `timedOut` flag before calling `abort()`) → `ask-error{message:'timed out after 15 min'}`, `status:'error'`; else → `ask-done{status:'stopped', reason:'user', costUsd: s.sawResult ? s.costUsd : null}` with the partial text (spec §6.2.8). **Then:** if `/max_turns|max_budget/.test(s.resultSubtype ?? '')` → `ask-done{status:'stopped', reason: s.reason}` (probe F5: the CLI exits 1 on those). **Then:** if `resumeSessionId && (!s.sawInit || s.errors.some((e) => /No conversation found/.test(e)))` → the §6.2.7 retry without `--resume` (this narrower predicate avoids clearing a healthy `session_id` on an unrelated auth/network failure where `sawAssistant` is also false). **Else** `ask-error{message}`. Notices ("Stopped: reached …", "Context restored from history", "Proposal rejected: …") are added with `reducer.addBlock({kind:'notice', …})` BEFORE `finish()` — after `finish()` `addBlock` returns `null`. In every branch call `settle()` then `finish()` exactly once.
- **R-D — the title call.** `generateTitle(firstText, {cwd: scratchDir, signal, tools: [], strictMcpConfig: true, settingSources: ['project'], disableSlashCommands: true, envScrub: true, envAllowlist: []})` — T2 forwards nothing unless given.
- **R-E — writes are not atomic across calls.** "link row + card flip + notice" is three store calls; `tx()` is not re-entrant, so never wrap store writers in a route-level `tx()`.
- **R-F — mock markers are mandatory.** Whenever `mockEnabled({})` is true (`WORCA_MOCK`/`ORCH_MOCK` truthy), EVERY ask spawn — including the §6.2.7 retry and the title call — sets `turn.mock = {card}` so `buildMockMarkers` lands in the system prompt; without the markers `runMock` falls through to the pipeline roles, whose `MOCK_ASK` arm writes a file to the path named in the PROMPT. P1 also hardens the runner (T16 step 3c: the arm is skipped under `permissionMode:'dontAsk'`, which the ask recipe always uses), and `ask-api` (P2) repeats T16's regression at the route level: POST a message whose text is `MOCK_ASK: <tmp path>` and assert the file does not exist.
- **R-G — spawn wiring (what the caller computes for the pure `spawn.mjs`).** `scratchDir = join(worcaHome(), 'tmp', 'ask')` (`mkdir -p` per turn, ONE dir for all threads); `homeBase = process.env.WORCA_HOME?.trim() ? path.resolve(process.env.WORCA_HOME) : dirname(worcaHome())` — the RAW base, never `worcaHome()` itself (it ends in `/.worca-cc`; passing it doubles the suffix and every tool call opens an empty DB); `mcpConfigPath = join(scratchDir, `mcp-${assistantMessageId}.json`)` written with `buildMcpConfig({homeBase, threadId, serverPath: ASK_MCP_SERVER_PATH})` and deleted in `finally`; `turn.modelEnv = resolveModelEnv(model)` (`config.mjs:311`); `limits = askLimits()` read fresh per turn (D12).

**Deviations from the spec §6.1 signature table (deliberate, P2/P3 read THIS block, not the spec table):** `validateProposal(input, deps)` → `createProposalValidator(deps).validateProposal(input, {cardId})`; `buildAskSpawnOptions({thread, turn, limits, mcpConfigPath})` gains `scratchDir` (pure — the caller resolves it); `createTurnReducer({onFrame, redact, now})` gains `setTimeout`, `clearTimeout`, `onProposal`, `attachmentNames`, `limits`; `askCatalog()` / `validateModelEffort()` are **async**; `store.mjs`'s CRUD is synchronous; the mock's `agents` scenario ends with a non-empty `result.modelUsage` (the cost-estimate path needs it — spec §6.7 says `{}`; P2 tests must not pin `{}`); `test/ask-follow` is deferred to P2 (it needs `turn.mjs`'s emitter) although spec §16 lists it among P1's tests.

### Clarifications (Q&A)

No orchestrator CLARIFY round ran for this plan (it arrived as a finished v3 plan, not as a task prompt). The decisions below are the ones the plan already relies on, carried forward verbatim from the approved spec (rev 2, D1–D15 locked, spec §4) and from the planning/review history recorded in this document; they are listed here so downstream agents treat them as answered, not as open questions. Nothing here is new; refine cycle 2 carried the section forward unchanged (its findings were execution rules and hint corrections, not decisions).

1. **Q: Which decisions are locked and must not be re-opened?** — A: Spec D1–D15 (spec §4), including: the `ask` namespace everywhere and the reserved words `chat`/`channel` (spec §5); proposals default to the `normal` guardrail set and `permissive` is refused (D3); `claude-opus-5` / `high` is the initial model/effort choice (D8); workflow step groups are read from the stored template, no topology algorithm (D9); the MCP server is hand-rolled JSON-RPC over stdio, no SDK dependency (D11); the per-turn limits are read fresh from settings on every turn (D12); the background title replaces the deterministic one only while the title is still the deterministic one (D13).
2. **Q: Are the probe results (F1–F12) or the spec text authoritative where they disagree?** — A: The probe results (measured on `claude` 2.1.239, 2026-08-22) supersede the spec; the spec file stays unchanged and P2–P4 read the "Verified facts" table first. Specifically: Task sub-agents run in the foreground only with `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` (F1); the sub-agent tool block is named `Agent` (F2); `--max-turns`/`--max-budget-usd` end with exit code 1 (F5); `~/.claude/CLAUDE.md` is treated as "not loaded, not guaranteed" under `--setting-sources project` (F10).
3. **Q: How are the stream-json fixtures obtained?** — A: Captured fresh from the real CLI during P1 by `scripts/ask-capture-fixtures.mjs` (haiku, < $0.30), sanitised, and committed as test data; never copied from the planning probes and never hand-written (user decision of 2026-08-22). Tests assert structure, never literal ids/tokens/durations.
4. **Q: `askMaxBudgetUsd` — what do `null` and `''` mean?** — A: The literal `null` is a STORED value meaning "no cap" (the flag is omitted); `''`/`undefined` clear the key back to the default `2`. For `askMaxTurns`, `''`/`null`/`undefined` all clear to the default `40` (it has no "no cap" meaning). Resolves the two readings of spec §6.9.
5. **Q: Which spec §6.1 signatures are deliberately deviated from?** — A: Exactly the list in "Deviations from the spec §6.1 signature table" (`createProposalValidator(deps).validateProposal(input, {cardId})`; `buildAskSpawnOptions` gains `scratchDir`; `createTurnReducer` gains `setTimeout`/`clearTimeout`/`onProposal`/`attachmentNames`/`limits`; `askCatalog`/`validateModelEffort` are async; `store.mjs` is synchronous; the mock `agents` scenario ends with a non-empty `result.modelUsage`; `test/ask-follow` moves to P2). P2/P3 are written against the "Frozen P1 → P2/P3 contract" block, not the spec table.
6. **Q: What is committed and what is not?** — A: Code, tests and the captured fixtures are committed per task on the pipeline branch; nothing under `docs/superpowers/` (plans, specs) is ever added; the companion reports are scratchpad evidence only.
7. **Q: Which branch does this run's work land on?** — A: The orchestrator's run worktree branch `worca-cc/ask-worca-p1-core-runner-implementation-9e4fbeab` (HEAD `79dc9256` = `dev`). The spec's `worca/ask-worca` branch name applies only to the developer's manual workflow and is not created in this run (refine cycle 1 decision, consistent with the orchestrator's contract).
