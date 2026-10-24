---
name: ask-script-tools-traps
description: Read before touching Ask/Workflows-chat tools, the Ask prompt, the MCP child (mcp-stdio), proposal validators or composer deps, or driving a real chat turn
paths: src/core/ask/**, src/shared/graph/canvas-ops.mjs, ui/server.mjs, test/ask-*.test.mjs, test/ui-settings-ask.test.mjs
updated: 2026-10-24T15:55:36.602Z
author: Denislav Prinov
---

Chat tools call the same bench/store engine as the CLI ([[script-bench-consumer-traps]]): drive changes through the REAL store/bench/MCP child. Running turns and panel: [[ask-running-turn-state]].

## Script tools and the bench
- A bench `caseId` run takes cwd AND timeoutMs from the CASE: a caller promising "the pinned project only" or "max N s" reads the case and refuses a cwd ≠ the pin or an effective timeout (`case.timeoutMs ?? meta.timeoutMs ?? 600000`) above its ceiling.
- `normalizeReview` caps nothing (3 000 issues = 3.19 MB): every consumer handing a verdict to a model or API caps it.
- Every md/json output needs a filename and is written every run whatever its `when`; `exitCodes` is shell-only; a `code` param needs `language`. A verdict counts only when the meta declares `verdict:{filename}` (else dropped; a shell `exit 1` reports `status:'clean'`).
- `PORT_ID_RE = /^[a-z][A-Za-z0-9]{0,31}$/`, `CASE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/`. `probePython(opts)` with ANY option bypasses its 60 s cache: call it bare in product code.
- `updateScript` merges the sent meta (omitted kept, `null` removed); `readScript` answers `sourceWin32: ''` for no variant; registry meta carries computed `portSummary` (+ `frontmatter` on plugins) a write-side strip list must include; a sidecar tool uses the sidecar's field names (`additionalProperties:false`).

## MCP child (`mcp-stdio.mjs`)
- Probe: copy `runChild` from `test/ask-mcp-stdio.test.mjs` (`process.execPath ['--disable-warning=ExperimentalWarning', 'src/core/ask/mcp-stdio.mjs', '--home', home, '--thread', id]`); one request, wait for its line, then the next (closing stdin fires `life.abort()`); `result.content[0].text` is the tool JSON. `HOME` is in `SPAWN_ENV_BASE`: launch with sandbox homes and assert `list_scripts` shows only sandbox keys.
- The child inherits `NODE_TEST_CONTEXT` (`listGlobalModels()` = `[]`): pass `HOME`/`USERPROFILE` = a mkdtemp holding `.worca-cc/settings.json {models}` + `WORCA_TEST_ALLOW_HOME_FALLBACK:'1'`. Workspace members must be git repos; propose_run workflows need node ids `/^n_[a-z0-9]{1,32}$/` (else "no longer matches the agents it uses"). Cached team policy: `writeTeamPolicyPrefs(projectKey(dir), …)` as in `test/run-overlay-policy-record.test.mjs`.
- Sign-in without probes: `WORCA_ASK_CLAUDE_AUTH` (signed-in|signed-out|unknown) in the child env; without it and with a Claude-run routed model the child spawns `claude auth status` — set `WORCA_CLAUDE_BIN=ORCH_CLAUDE_BIN=/usr/bin/false` or `ANTHROPIC_BASE_URL`.
- A raw U+2028/U+2029 in an argument kills the call (`readline` splits on them): test such input on the validator directly.
- **The validator runs twice in two envs:** `validateProposal` runs in the child (the result the MODEL sees) and again in the parent (`turn.mjs` `_onProposal`, which alone makes the card or "Proposal rejected"). Child env = scrubbed (`buildSpawnEnv` + `envAllowlist`: `${VAR}` provider keys missing → `needsSignIn`, list_models `ready:false`) + the chat model's routing env (`ANTHROPIC_BASE_URL` → `probeClaudeAuth()` signed-in from env while the parent says signed-out) + `WORCA_HOME`, `WORCA_ASK_THREAD_ID`, `MCP_FORWARD_ENV` (not `WORCA_BROKER_URL`/`WORCA_MOCK`). The cwd differs too (`<worcaHome>/tmp/ask` vs the server's): refuse non-absolute, non-`~` model-typed paths in the shared validator before any fs call. Relay mode (`askAgentRelay`) runs tools in the server: no divergence.
- Fix: compute env/readiness/sign-in inputs once per turn in the parent (only when they can change a verdict, at the turn's top), hand them to the child via `buildMcpConfig` env and to `_onProposal`'s re-validation; or keep the check parent-only. Never an unconditional `await probeClaudeAuth()` before the spawn (delays every turn; its 60 s cache keeps failures). Strip `needsSignIn` for anything both must agree on. The suite's fake claude answers signed in: no test catches this; reproduce by running the child with the key var empty and set.

## Prompt and tool pins
- A new tool family reddens: `ask-mcp-stdio` (`tools/list` names); `ask-prompt` "system rules" (rule 1's list = EXACT SET of `createAskTools({scripts:{enabled:true}, models, clones, workspaceChanges, actions}).list()` minus `propose_run`/`propose_workflow`/`save_script`/`test_script`; a conditional family adds its stub dep there); `ui-settings-ask` (Save body, TWO tests); `ask-prompt-codex`. `askSystemPromptFor` has a JSDoc: a body-only "replace" fence stacks a second.
- `src/core/ask/tools.mjs` has ZERO imports (pinned "imports nothing"/"stays import-free"): helpers enter via `tool-deps.mjs#defaultToolDeps` (no `writeFile`/`mkdir`/`rmSync`/`tx(`; `node:fs/promises` exactly `readFile, access`), read as `deps.<name>` with a null-safe default, pinned by `typeof defaultToolDeps({threadId:null}).<name> === 'function'`. Tools are METHODS of `handlers`; tests pass `limits: ASK_LIMITS`.
- Per-THREAD toolsets need no env plumbing: `createAskToolServer` (child AND relay) reads `getThread(threadId)`; filter `list()` AND refuse in `call()`.
- A tool's RESULT never reaches the browser: add a reducer hook beside `onWorkflowResult` (`reducer.addBlock({kind:'card', id:newAskId('card'), …})` + `_persistBlocks()`); every card flip through the cards route starts a PAID turn unless its branch returns first. Hooks fire on main-stream results only: forbid `Task` (sub-agents share the child and mutate with no card).
- Shared renderers (`renderCatalog`, `renderScriptsSection`, `renderWebSection`, `ASK_HOSTING_RULE`) name Ask-only tools: restricted chats need variants; pin `doesNotMatch(/propose_|save_script/)` with scripts + web on, hosted. `redactAskText` keeps a token's prefix (`ghp_<redacted>`): pin the VALUE absent.

## Workflows chat (composer) parity
- The browser places only `GET /api/agents` (no `?all=1`, `workspace-only` filtered): filter the child's registry the same. `catalog.agents` is Auto's coding vocabulary (cap 32); the composer prompt renders `catalog.allAgents`; Ask keeps `agents`.
- `createScript` refuses device stems, reserved keys and case twins; track each draft's KIND. `composerCardFrom` returns null past `COMPOSER_LIMITS.card` (the tool refuses itself). `applyCanvasOps` add_node seeds `config.ports` from `defaultPorts`.
- `defaultComposerDeps` fails CLOSED (`{askMode:'composer'}`); READ tools `redactDeep`. Prompt byte identity: checkpoint `prompt.mjs` with imports rewritten to worktree `file://` URLs, compare `buildSystemPrompt` over the option grid.
- Scope pill = Ask's pin: `project: X (key K) [pinned by the user]`, its memory (`--add-dir <home>/ask/memory/<K>`), policy, `test_script cwd:"project"`; nothing else. An unregistered key: 202, no project line, `test_script` answers `not registered`.

## Driving turns
- No spawn: mkdtemp `WORCA_HOME` (PARENT of `.worca-cc`)/`HOME` before import, `createThread({mode:'composer'})` + `updateThread(id, {composer:{sessionId, docToken, graph, selection:null, drafts:[]}})`, `createAskToolServer({threadId, signal, env, write})`, JSON-RPC `tools/call` lines (`await srv.idle()`).
- No model: a stub `claude` reading `--mcp-config`, spawning that child, speaking JSON-RPC and printing stream-json keyed on prompt words; unset `WORCA_MOCK`, stub other engines first on PATH; listen on the exported `server`.
- Real CLI: in-process server with mkdtemp homes, `WORCA_CLAUDE_BIN` = a wrapper exporting the REAL home; strip `CLAUDE*`/`npm_*`/`WORCA_*`; afterwards remove `~/.claude/projects/<cwd-slug>` and the CLI cache dir. On `--resume` `total_cost_usd` is SESSION-cumulative: per-turn cost = difference of consecutive results.
