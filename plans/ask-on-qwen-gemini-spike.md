# Chat on every harness — lockdown spikes (Qwen Code, Gemini CLI, OpenCode, Goose, Cursor), chat descriptors, self-test

Status: implemented, 2026-10-24. Branch `claude/chat-descriptor-qwen-gemini` (on `claude/cursor-harness-worca-chat-8u9tgr`).

| Engine | Result | Version checked |
|---|---|---|
| Qwen Code | **passed** — Chat on | 0.26.1 (npm) |
| Gemini CLI | **passed** — Chat on | 0.65.0 (npm) |
| OpenCode | **passed** — Chat on | 1.19.4 (npm `opencode-ai`) |
| Goose | **passed** — Chat on | 1.56.0 (conda-forge `goose-cli`; GitHub release downloads were refused, 403) |
| Cursor | **unverified** — descriptor wired, lockdown `null`, Chat off | not installable here (cursor.com, downloads.cursor.com refused; no npm, PyPI or conda-forge package) |

`ASK_ENGINES = claude, codex, copilot, gemini, goose, opencode, qwen`.

## Goal

Let a Worca Chat (Ask) run on Qwen Code and Gemini CLI with the user's own sign-in, as it runs on Codex and Copilot:
the engine's own shell, file, web, memory and sub-agent tools off, only worca's MCP server reachable. Before this
change `GEMINI_ASK_LOCKDOWN = QWEN_ASK_LOCKDOWN = null` and `runFamilyProcess` threw on `askLockdown`.

Gate: ship an engine only if a lockdown holds on the real binary, verified against a local model endpoint, under a
hostile user config. No partial lockdown.

## Method

Both CLIs installed from npm into a scratch folder: `@qwen-code/qwen-code@0.26.1`, `@google/gemini-cli@0.65.0`.
No real model and no real sign-in: each CLI was pointed at a local stub endpoint.

- **Stub endpoint.** Qwen: OpenAI chat completions (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`). Gemini: the
  Gemini API (`generateContent` / `streamGenerateContent`, `GOOGLE_GEMINI_BASE_URL`, `GEMINI_API_KEY`, auth type
  `gemini-api-key`). The stub logs every request's offered tool list and answers with scripted tool calls; a request
  that offers no tool (Gemini's routing call, next-speaker checks) gets a short JSON answer and is not counted.
- **Probe MCP server** named `worca`, with `list_projects` and, later, the worca tool names that clash with the CLIs'
  built-ins (`read_file`, `glob`, `grep`, `web_fetch`, `web_search`, `git`). It logs each call.
- **Scripted calls**, in order: `run_shell_command` (`id > /tmp/…`, a canary), built-in `read_file`, `write_file`,
  `web_fetch`, the sub-agent tool (Qwen `agent`, Gemini `invoke_agent`), a user MCP server's tool (`mcp__evil__…` /
  `mcp_evil_…`), Qwen's `tool_call` bridge onto `run_shell_command`, Gemini's discovered tool and `activate_skill`, then
  worca's `list_projects`.
- **Hostile scratch HOME.** `~/.qwen` / `~/.gemini` `settings.json` with: an `evil` MCP server and a second `worca`
  server (a name clash), `mcp.allowed: [evil, worca]`, `tools.core` naming the shell, file and web tools, `tools.allowed`
  / `permissions.allow` for the shell, a `SessionStart` hook writing a file, `tools.discoveryCommand` /
  `tools.callCommand` (a script that writes a file and declares a tool), folder trust off, extra context file names.
  Plus `QWEN.md` / `GEMINI.md` and `EVIL.md` with injected instructions, a user agent, a user skill, a user-tier policy
  that allows every tool (Gemini), an extension with its own MCP server and context file (Gemini), and `.env` files in
  `~/.qwen`, `~/.gemini` and `~` (see Qwen (iii)). A hostile workspace too: `.qwen/settings.json` and `QWEN.md` /
  `GEMINI.md` in the cwd.

## Qwen Code 0.26.1 — PASS

### What did not work

- **`--core-tools` alone.** It is an allowlist of the *core* built-ins only (`CORE_TOOLS`: read_file, write_file, edit,
  glob, grep_search, run_shell_command, web_fetch, web_search, …). With it naming none, the model was still offered
  `agent`, `enter_worktree`, `exit_worktree`, `get_goal`, `update_goal`, `list_agents`, `record_artifact`,
  `report_findings`, `send_message`, `skill`, `task_stop` — once tool search was off (below). A sub-agent tool: fail.
- **Tool search hides the truth.** With `tools.toolSearch.enabled` (default on) MCP tools and many built-ins are
  *deferred*: not in the request's tool list, but reachable through `tool_search` + `tool_call`. The offered list then
  under-reports what the model can call. Off, every registered tool is declared, so the offered list is the whole set.
- **`--bare`** ignores `--core-tools`: its fixed small set includes `run_shell_command`, `read_file`, `edit`; the
  scripted shell call ran (canary written). Fail.
- **`--safe-mode`** ignores `--core-tools` and settings ("Safe mode: --core-tools flag is ignored"): every built-in
  offered. Fail.
- **Background memory agent.** After a turn, Qwen's managed-memory extraction starts an agent with its own
  `read_file`, `grep_search`, `write_file`, `edit` — registered through a scoped permission manager that ignores
  `--core-tools` and `--exclude-tools`. Off with `memory.enableManagedAutoMemory: false` in system settings; but
  `QWEN_CODE_MEMORY_TEAM=1` in `~/.qwen/.env` turned a memory agent with those four tools back on (seen as a 10th
  request in the stub log). `.env` files fill any env name that is unset or **empty**, and `~/.qwen/.env` bypasses
  `advanced.excludedEnvVars`. `QWEN_CODE_SAFE_MODE=1` there flips safe mode (core allowlist dropped).
- **Hooks and tool discovery** from user settings would run commands; discovery would register tools.
- Context file suppression (`context.fileName` in system settings) did not keep `~/.qwen/QWEN.md` out.

### The lockdown (engines/qwen.mjs `QWEN_ASK_LOCKDOWN`)

- argv: `--core-tools __worca_no_core_tool__` (the allowlist on, naming no core tool), `--exclude-tools <every name in
  Qwen's ToolNames table>` (`QWEN_BUILTIN_TOOLS`, 69 names, comma-separated), `--allowed-mcp-server-names worca`, plus the
  adapter's usual `--approval-mode yolo`, `--session-id`/`--resume`, `--append-system-prompt`.
- System settings (`QWEN_CODE_SYSTEM_SETTINGS_PATH`, merged last, so they win over user and workspace; the machine's
  own system settings are merged in underneath): worca's MCP server; `tools.toolSearch.enabled: false`;
  `tools.discoveryCommand: ''`, `tools.callCommand: ''`, `mcp.serverCommand: ''`; `disableAllHooks: true`;
  `memory.{enableManagedAutoMemory, enableManagedAutoDream, enableAutoSkill, enableTeamMemory, enableTeamMemorySync,
  enableStructuredRecall}: false`, `memory.mem0: null`.
- Env (`QWEN_ASK_ENV`, non-empty so a `.env` file cannot fill them): `QWEN_CODE_SAFE_MODE=0`, `QWEN_CODE_MEMORY_TEAM=0`,
  `QWEN_CODE_MEMORY_TEAM_SYNC=0`, `QWEN_CODE_MEMORY_STRUCTURED_RECALL=0`, `QWEN_CODE_ENABLE_AGENT_TEAM=0`,
  `QWEN_CODE_ENABLE_AGENT_COLLABORATION=0`, `QWEN_CODE_ENABLE_WORKFLOWS=0`, `QWEN_CODE_DISABLE_WORKFLOWS=1`,
  `QWEN_CODE_ENABLE_ARTIFACT=0`, `QWEN_CODE_DISABLE_ARTIFACT=1`, `QWEN_CODE_ENABLE_OMNI=0`, `QWEN_CODE_DISABLE_CRON=1`.

### Results

- **(i) Offered tools**: `mcp__worca__list_projects`, `mcp__worca__read_file` (and later every probe name) — nothing
  else, in every request, clean home and hostile home alike. No meta tool is offered (no `tool_search`, `tool_call`,
  `skill`, `task_stop`).
- **(ii) Refused calls**: `run_shell_command`, `read_file`, `write_file`, `web_fetch`, `agent` → "Qwen Code requires
  permission to use "…", but that permission was declined. Matching deny rule: "…""; `mcp__evil__list_projects` → "not
  in the allow-list (mcp.allowed / --allowed-mcp-server-names)"; `tool_call` → "[tool_call bridge refused] … Matching
  deny rule: "tool_call"". No canary file.
- **(iii) Hostile user config**: the `evil` server never started; the user's `worca` server lost to the system
  settings' one (calls reached worca's log, none the evil log); `tools.core`, `tools.allowed`, `permissions.allow`,
  `tools.eager`, `toolSearch.enabled: true`, the hook, the discovery command and folder-trust-off changed nothing; with
  the pinned env, a `.env` turning on team memory, agent team, workflows, artifacts, collaboration and safe mode
  changed nothing (no 10th request, core allowlist held). Context files (`QWEN.md`, `EVIL.md`, the workspace's) reach
  the prompt as text; they add no tool.
- **(iv) worca's tools work**: `list_projects` answered through the probe; then, end to end through the real adapter
  and worca's real MCP child (`createAskTurn` → `runClaude` → `runQwenProcess` → qwen → `mcp-stdio.mjs`): 82 tools
  offered, all `mcp__worca__*`; `list_projects` done; `read_file /etc/passwd` refused by worca's own reader; `glob`
  answered worca's "no worktree yet"; the turn finished `done` with the stub's reply. A second turn resumed the stored
  `qwen:<uuid>` session (no fallback). A scripted shell call in a real turn was refused by Qwen (no canary) and the
  turn's watchdog stopped the turn as designed ("Qwen Code tried to run a shell command…").

## Gemini CLI 0.65.0 — PASS

### What did not work

- **A deny-all admin policy alone** (`toolName = "*"` deny at priority 900, worca's server allowed at 999) held every
  scripted call ("Tool "…" not found") and outranked the user-tier allow-all — but it also **hid worca's own
  `read_file`**: Gemini statically excludes a denied built-in's name and matches excluded names against an MCP tool's
  *unprefixed* name too (`ToolRegistry.isActiveTool`). worca's `read_file`, `glob` and `web_fetch` would vanish.
- **A rule with no `toolName`** is rejected in 0.65 ("Schema validation failed … rule.0.toolName").
- The user's **hook** ran and the **discovery command** ran (its tool was then denied) under the policy alone.
- The user's extensions loaded their context file (text) under the policy alone (their MCP server was filtered).

### The lockdown (engines/gemini.mjs `GEMINI_ASK_LOCKDOWN`)

- `--admin-policy` (`geminiAskPolicyToml`): `toolName = "*"` deny, priority 900; per worca server, `mcpName = "<name>"`,
  `toolName = "*"` allow, priority 999. The admin tier outranks user and workspace policies. When the machine's
  system policy folder holds a `.toml`, Gemini skips `--admin-policy` files: the support check refuses the chat then.
- The chat folder's `.gemini/settings.json` (a folder of the chat's own under worca's temp folder; trusted with
  `GEMINI_CLI_TRUST_WORKSPACE=true`; workspace settings win over user settings): worca's MCP server;
  `tools.core: ["__worca_no_core_tool__"]` (registers **no** built-in, so nothing of a built-in's name is excluded and
  worca's same-named tools stay offered); `tools.discoveryCommand: ''`, `tools.callCommand: ''`;
  `hooksConfig.enabled: false`. Removed after each spawn (it names the thread).
- argv: `--extensions none`, `--allowed-mcp-server-names worca`, plus the adapter's `--approval-mode yolo`,
  `--session-id`/`--resume`. The system prompt is folded into stdin, as for a pipeline.

### Results

- **(i) Offered tools**: worca's tools only (`mcp_worca_list_projects`, `mcp_worca_read_file`, `mcp_worca_glob`,
  `mcp_worca_grep`, `mcp_worca_web_fetch`, `mcp_worca_web_search`, `mcp_worca_git`, …), clean and hostile home. No meta
  tool.
- **(ii) Refused calls**: `run_shell_command`, `read_file`, `write_file`, `web_fetch`, `invoke_agent`,
  `mcp_evil_list_projects`, `discovered_tool_evil_discovered`, `activate_skill` → "Tool "…" not found. Did you mean …".
  A bare built-in name was never routed to worca's same-named MCP tool. No canary.
- **(iii) Hostile user config**: user policy allow-all, `tools.core`, `tools.allowed`, user MCP servers (the user's
  `worca` lost to the chat folder's), the extension's MCP server, agents, skills, hook (did not run), discovery command
  (did not run): no widening. `~/.gemini/GEMINI.md`, `EVIL.md` and skill descriptions reach the prompt as text. A user
  whose `security.auth.selectedType` is `oauth-personal` still gets the chat folder's auth type for the self-test.
- **(iv) worca's tools work**: as for Qwen, end to end through `createAskTurn` and worca's real MCP child: 82 tools
  offered, all worca's; `list_projects` done; `read_file /etc/passwd` refused by worca; the turn finished `done`; a
  second turn resumed the stored `gemini:<uuid>` session in the same chat folder.

## OpenCode 1.19.4 — PASS

Stub: an OpenAI-compatible provider in `OPENCODE_CONFIG_CONTENT` (`@ai-sdk/openai-compatible`, `baseURL` the stub; OpenCode
fetched the package from npm on first use). Hostile `~/.config/opencode/opencode.json`: an `evil` MCP server and a second
`worca` one, `permission: {"*": "allow", "bash": "allow", …}`, `tools: {bash: true, evil_tool: true}`, `instructions`, an
agent `worca-chat` with `permission: {bash: "allow"}`, an `evil` sub-agent; `tool/evil_tool.ts` (a custom tool writing a
file), `plugin/evil.js` (a plugin writing a file), `agent/evil2.md`, `AGENTS.md`. Hostile workspace: `opencode.json` with
`"*": "allow"` and an MCP server, `AGENTS.md`.

- Baseline: `bash, edit, glob, grep, read, skill, task, todowrite, webfetch, write` + worca's tools.
- Global `permission` deny-all and per-tool denies both work on a clean home, but OpenCode resolves permissions "last
  match wins" over the merged user and inline config (key order), so a user's `"bash": "allow"` placed after `"*"`
  could win. An **agent's** permission is evaluated after the global one.
- **The lockdown** (engines/opencode.mjs `OPENCODE_ASK_LOCKDOWN`): a chat agent named `worca-chat-<random>` per spawn
  (no user config can name it) with `permission: {"*": "deny", "<server>_*": "allow"}`; worca's server attached under
  `worca<random>` per spawn (so a user server named `worca_x` cannot match the allow pattern; the stream's names are
  mapped back to `mcp__worca__…`); `agent.general` / `agent.explore` `disable: true`; `--pure`;
  `OPENCODE_DISABLE_PROJECT_CONFIG=1`; no `instructions`; a model is required and `opencode/…` (Zen) is refused.
- **(i)** offered: worca's tools only, every request, clean and hostile home + hostile workspace. **(ii)** `bash`, `read`,
  `write`, `webfetch`, `task`, `evil_list_projects`, `evil_tool` → "Model tried to call unavailable tool 'invalid'.
  Available tools: worca_…". No canary, the custom tool and the plugin did not run. **(iii)** as (i)/(ii) with the hostile
  config; the user's `worca` server lost to the inline one. The user's MCP servers still **start** (their tools are not
  offered); `AGENTS.md` / `instructions` text reaches the prompt. **(iv)** end to end through `createAskTurn` and worca's
  real MCP child: 82 tools, all worca's; `list_projects` done; worca's `read_file` refused `/etc/passwd`; done; a second
  turn resumed the stored `opencode:ses_…`. A scripted `bash` call: refused by OpenCode, then the watchdog stopped the turn.
- Self-test: passes on the real binary (~5 s), refuses the pipeline spawn path ("offered tools a chat must not have
  (bash, edit, glob, …)").

## Goose 1.56.0 — PASS

Installed from conda-forge (`goose-cli-1.56.0-h19ae16a_0.conda`, unpacked with python `zstandard`); GitHub release
downloads, crates.io and the Homebrew API were refused here. Stub: goose's `openai` provider (`OPENAI_HOST`,
`OPENAI_BASE_PATH`, `OPENAI_API_KEY`). Found on the way: the probe MCP server answered unknown methods with an empty
result, and goose opens with `server/discover` and falls back to `initialize` only on "method not found" — fixed in
engines/chat-probe-mcp.mjs (a self-test that sees no worca tool fails closed anyway).

Hostile home: `~/.config/goose/config.yaml` enabling `developer`, `extensionmanager`, `todo`, `chatrecall`, `summon`,
`skills` and an `evil` stdio extension; `.goosehints`; skills in `~/.config/goose/skills`, `~/.claude/skills`,
`~/.agents/skills`; a plugin in `~/.agents/plugins/evilplug` with `.mcp.json`, `hooks/hooks.json` (SessionStart,
PreToolUse, UserPromptSubmit commands writing a file) and a skill.

- `--no-profile` + `--with-builtin developer` (the pipeline argv): `edit, read_image, shell, tree, write, load_skill`.
- `--no-profile`, no builtin: worca's tools + `load_skill`. The config's extensions (developer, extension manager, todo,
  evil…) are not loaded: "Tool '…' is not available". Without `--no-profile`, goose adds `delegate`, `apps__*`,
  `extensionmanager__*`, `analyze`, `load`: fail.
- **But the user's home is still read**: the plugin's **hook ran** (file written) under `--no-profile`, and `load_skill`
  served the user's skills and their supporting files (a `../` path was refused: "not found. Available: …").
- **The lockdown** (engines/goose.mjs `GOOSE_ASK_LOCKDOWN`): `--no-profile`, no `--with-builtin`, worca's server as the
  only `--with-extension`, and `HOME` + `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_STATE_HOME` / `XDG_CACHE_HOME` in
  `<worca home>/engines/goose/chat-home` (stable, so sessions resume). worca's MCP child gets the real `HOME` back (git,
  ssh). Env scrub keeps `GOOSE_*` and the chat model's provider's own names only. A provider that is an agent CLI
  (`*-acp`, `claude-code`, `codex`, `cursor-agent`, `gemini-cli`, …) is refused: its tools are that CLI's.
- **Meta tool kept: `load_skill`.** In the chat's home it knows only goose's built-in skills (`goose-doc-guide`,
  `web-search`: instruction text); it refuses a path outside a skill's folder. It reads and writes nothing else and runs
  nothing. The watchdog and the self-test allow it (chat descriptor `metaTools`) and nothing else.
- **(i)** offered: worca's tools + `load_skill`, every request. **(ii)** `developer__shell`, `shell`,
  `extensionmanager__manage_extensions`, `evil__list_projects`, `todo__todo_write` → "Tool '…' is not available";
  `load_skill` of the user's skill → "Skill 'evil' not found"; traversal from a built-in skill → "has no supporting
  files". No canary, no hook. **(iii)** the hostile home is not read at all. **(iv)** end to end through `createAskTurn`:
  83 tools (82 worca + `load_skill`); `list_projects` done; worca's `read_file` refused `/etc/passwd`; done; resume kept
  the `goose:worca-…` session. A scripted shell call: "not available", then the watchdog stopped the turn.
- Self-test: passes on the real binary (<1 s), refuses the pipeline spawn path ("offered tools a chat must not have
  (edit, read_image, shell, tree, write)").

## Cursor — UNVERIFIED (Chat stays off)

`cursor-agent` could not be installed: cursor.com and downloads.cursor.com are refused by this environment's proxy, and
there is no npm, PyPI or conda-forge package of it. Wired: `cursorChat` (engines/cursor.mjs) with
`CURSOR_ASK_LOCKDOWN = null`, its self-test returning a refusal (`CURSOR_NO_SELF_TEST`), and engine-switch.mjs
`cursor.chat.verified: false`, so it is no Ask engine and its models are not offered. To turn it on, every item below
must hold on the real binary, then set the lockdown, the self-test and `verified`:

1. A way to point cursor-agent at a local model endpoint (a base-URL setting or env). Without one the self-test cannot
   run, and Chat stays off however the lockdown looks. (Cursor's models are served by Cursor; none is known.)
2. The candidate lockdown: `--mode ask` (read-only mode: does it remove the shell and file-write tools from the
   offered list, or only refuse them?) plus `<cwd>/.cursor/cli.json` `permissions.deny: ["Shell(*)", "Read(**)",
   "Write(**)", …]` for every tool kind its list shows (web fetch, search, MCP of other servers), and `allow` only for
   worca's server's tools.
3. That `~/.cursor/cli-config.json` (its permissions merge in, "deny winning" per the adapter notes) and
   `~/.cursor/mcp.json` (user MCP servers) cannot widen it: a hostile user `allow: ["Shell(*)"]`, a user MCP server, a
   name clash with `worca`.
4. Cursor's rules (`.cursor/rules`, `~/.cursor` user rules, `AGENTS.md`) and any sub-agent / background-agent feature:
   whether they add a tool.
5. That denied tools are absent from the request's tool list (criterion (i)), not just refused when called.
6. Resume (`--resume <chat id>`) and the not-found message (`CURSOR_RESUME_NOT_FOUND_RE`) on the chat path.
Hosts that would need allowing for the spike: cursor.com, downloads.cursor.com (install), api2.cursor.sh (its model API).

## Chat descriptors (the refactor)

Each adapter that supports Chat exports one descriptor (`engines/chat-descriptor.mjs` `makeChatDescriptor`):
`lockdown()`, `askSupport(o, impl)`, `selfTest(o, impl)` (or null), `preflight({model}, impl)`, `modelPriced`,
`reportsCost`, `resumeNotFound(err)`, `notReady {code, docsUrl, prefix, setupLabel, flag}`, `noLockdownMessage`,
`shellTrippedMessage`, `images` / `pdfs`, `titles`, `suggestionModel`, `prompt {cli, attachments, composerBinary,
webOff}`, and `ownFolder` (Gemini). The adapter registry carries it (`engines/index.mjs` `chat`); `engines/chat.mjs`
collects them.

- `ASK_ENGINES` (model-env.mjs) is the `chat` flag of `src/shared/engine-switch.mjs` `ENGINES` — model-env.mjs and the
  browser may not import an adapter. `engines/chat.mjs` derives `CHAT_ENGINES` from the adapters that export a
  descriptor and **refuses to load** when the two differ, or when a descriptor's attachments differ from the flag.
  `ui/public/ask-engine.mjs` `ASK_CHAT_ENGINES` and `attachRefusal` read the same flag (`chatAttachRefusal`).
- turn.mjs: one `_engineGate` (lockdown → cost cap → mock → support → self-test → relay → preflight) replaces
  `_codexGate` / `_copilotGate`; the watchdog's shell message, the resume-not-found branch, the title (`titles`) and
  the not-ready notice read the descriptor. A test's per-engine stand-ins keep their names (`codexAskSupport`,
  `copilotPreflight`, `qwenSelfTest`, …): `<engine><Preflight|AskSupport|Lockdown|ModelPriced|SelfTest>`.
- models.mjs offers an engine's rows when its descriptor has a lockdown (`<engine>Available` overrides for tests); an
  engine with no effort vocabulary gets one hidden placeholder effort (`noEffort`). spawn.mjs builds one locked-down
  spawn for every engine (`buildLockedAskOptions`; images only where the descriptor takes them; Gemini's own folder).
  prompt.mjs builds every locked-down rule variant from the Codex rewrites and the descriptor's words; Codex's output
  is byte-identical. suggest.mjs reads `suggestionModel`. The MCP child's file tools, the MCP picker, the relay env and
  the attachment refusal use `lockedChatEngine` / the shared flag.
- Codex and Copilot moved onto descriptors with no behaviour change: every existing test passes unchanged, except those
  that pin the engine lists (`engine-switch-pause`, `ask-chat-engine` defaults) and the two adapter tests that pinned
  `GEMINI_ASK_LOCKDOWN = QWEN_ASK_LOCKDOWN = null` / "Ask spawns refuse".

## Runtime self-test (engines/chat-selftest.mjs)

Before the first chat turn on a Qwen Code or Gemini CLI binary, the turn gate runs the adapter once with
`askLockdown` — the exact chat spawn — against an in-process stub endpoint (127.0.0.1, both protocols) and the probe MCP
server (`engines/chat-probe-mcp.mjs`), with the user's real HOME, settings, extensions and env files. Script: a shell
call (`touch <canary>`), worca's `worca_probe`, then text. Pass = every request offered only the probe server's tools
(wire names), the clashing names all present, no canary, the probe called. Cached per engine, binary realpath,
`--version` and a fingerprint (size, mtime) of the user/machine config files (`qwenConfigFiles`,
`geminiConfigFiles`), in memory and in `<worca home>/engines/chat-selftest.json`; a failure is never cached. Refusal:
"<Label> isn't ready: …" with code `<engine>-not-ready` and the docs link. Runs in ~2 s (Qwen) / ~6 s (Gemini).
Verified on the real binaries: pass with the lockdown (clean, hostile and OAuth homes); refusal "offered tools a chat
must not have (edit, glob, grep_search, …)" when the same probe runs without the lockdown. The `_watch` watchdog stays
the runtime backstop.

## Not verified / limits

- **Real models and real sign-ins.** No Google account, AI Studio key or Qwen provider here: every run used the stub
  endpoint with API-key auth. Gemini with `oauth-personal` (Code Assist) or Vertex, and Qwen's own OAuth or other
  providers, were not exercised in a chat. The self-test forces the stub's auth type, so it proves the tool set on the
  API-key code path; a different auth path offering other tools is caught by the watchdog, not the self-test.
- **Background agents that start late.** The self-test is a three-request conversation. Qwen's memory agent appeared
  in the spike only after a longer one; in the final lockdown it did not appear even with `QWEN_CODE_MEMORY_TEAM=1`
  over 11 requests (the system settings switch it off), but the self-test would not see an agent that a future Qwen
  starts only after many turns. Such an agent's calls do not reach the stream, so the watchdog would not see them
  either; the pinned env and settings are the guard there.
- **Env switches not yet known.** `QWEN_ASK_ENV` pins the switches found in 0.26.1. A new `.env`-settable switch that
  adds a tool is caught by the self-test (the user's real `.env` is read); one that adds a background agent may not be.
- **Relay mode** (agents under their own users) was not exercised: the self-test runs as the server user, and a
  Gemini chat folder written by the server must be readable by the agent user.
- **Windows and macOS**: Linux only. A Goose chat refuses on Windows (its MCP wrappers are POSIX scripts there).
- **Goose's keyring** with the moved home: provider keys from worca's environment were used; the keyring path (and a
  provider configured only in `~/.config/goose`, which a chat no longer reads) was not checked.
- **OpenCode's user MCP servers still start** as processes (their tools are not offered). OpenCode fetches the
  self-test's provider package from npm on first use: offline, the self-test (and the chat) refuse.
- **Telemetry.** Both CLIs phone home on their own (Qwen: an aliyuncs RUM host and models.dev, refused by this
  sandbox's proxy). Not changed here.
- **Context files** (`GEMINI.md`, `QWEN.md`, skill descriptions) reach the model as text. Copilot's
  `--no-custom-instructions` has no equivalent that worked.
- ~~An Auto-workflow proposal from a Qwen or Gemini chat classifies on Claude.~~ It classifies on the chat's engine now
  (see "Every feature on every engine" below).

## Tests

`test/qwen-gemini-ask-adapter.test.mjs` (argv, settings and policy files, pinned env, MCP env references, support
check, resume left to the turn), `test/opencode-goose-ask-adapter.test.mjs` (OpenCode's per-spawn agent and server
names, permission, names mapped back, Zen refused; Goose's argv, its own home, the real HOME and spawn env for worca's
child, the provider env, agent-CLI providers), `test/ask-qwen-gemini.test.mjs` (all four engines: spawn options, MCP
child, catalog, prompt, panel, turn gate order, self-test refusal, cost cap, mock, watchdog, resume fallback, title;
models an engine rules out; Goose's meta tool), `test/chat-selftest.test.mjs`
(verdict, both stub protocols, the probe server over stdio, cache and its keys), `test/chat-descriptor.test.mjs`
(registry invariants, Codex and Copilot words unchanged). Pinned lists updated in `engine-switch-pause`,
`ask-chat-engine`, `gemini-adapter`, `qwen-adapter`.

## Every feature on every engine (2026-10-24, branch `claude/chat-uniform-engines`)

Goal: a chat behaves the same whatever harness runs it. Every feature is delivered through worca (its MCP tools, its
spawn options), never by turning a CLI tool back on; the lockdowns, the self-test and the watchdog are unchanged except
where noted.

### Method

Real binaries, worca's in-process stub endpoint, scratch `WORCA_HOME`/`HOME`, end to end through `createAskTurn` with the
real adapter and worca's real MCP child (`mcp-stdio.mjs`). Versions: Qwen Code 0.26.1, Gemini CLI 0.65.0, OpenCode 1.19.4
(npm), Goose 1.56.0 (conda-forge), **Codex 0.164.0 and GitHub Copilot CLI 1.0.103 (npm `@openai/codex`, `@github/copilot`;
new this round)**. The stub gained a Responses protocol (Codex), and two ways in for engines that have no API-key login:

- **Copilot**: its BYOK env — `COPILOT_PROVIDER_BASE_URL`, `COPILOT_PROVIDER_API_KEY`, `COPILOT_MODEL`, `COPILOT_OFFLINE=true`
  (OpenAI chat completions). No GitHub sign-in needed.
- **Codex**: a global model entry with an OpenAI Responses `upstream` pointing at the stub (worca's own custom-endpoint
  path, codex-endpoint.mjs): codex ignores `OPENAI_BASE_URL`. MCP tools are reached through code mode (`exec` with
  `tools.mcp__<server>__<tool>(…)`), so the stub scripts a `custom_tool_call`.

Each check reads the request bodies the stub received (the base64 of a marker PNG/PDF, the offered tool list,
`reasoning_effort` / `thinkingConfig`, the copy's secret in a tool result).

### Results

| Feature | Claude | Codex | Copilot | Gemini CLI | Qwen Code | Goose | OpenCode |
|---|---|---|---|---|---|---|---|
| Image via `read_attachment` / `read_file` | (native) | **works** (code mode `image()`) | **not shipped** (a) | **works** | **works** (b) | **works** | **works** (b) |
| PDF via `read_attachment` / `read_file` | (native) | **not possible** (c) | **not shipped** (a) | **works** | **works** (b) | **not possible** (d) | **works** (b) |
| Registry MCP copies (launcher + secret) | yes | **works** (stdio only) | **works** | **works** | **works** | **works** (stdio only) | **works** |
| Cost cap / spend priced by worca | yes | **works** | **works** (e) | **works** | **works** | **works** (e) | **works** (e) |
| Title on the chat's engine, no tools | yes | **works** (f) | **works** | **works** | **works** | **works** (g) | **works** |
| Suggestion on the chat's engine, no tools | yes | **works** (f, h) | **works** | **works** | **works** | **works** (g) | **works** |
| Auto classifier on the chat's engine | Claude | **works** (f) | **unverified** (i) | **works** | **works** | **works** (g) | **works** |
| Effort | yes | yes | yes | **works** (j) | **works** (j) | yes | yes |

(a) Copilot converts an MCP image into its `binaryResultsForLlm` (seen in its session events) but sent no image to the
BYOK model under any model id tried (gpt-4o, gpt-5, claude-sonnet-4.5, claude-sonnet-5.5, gpt-6.1-sol, gemini-3.8-flash),
with or without the lockdown: under BYOK its models declare no vision. A signed-in Copilot's catalog does declare vision,
but no sign-in was available here, so `chat.images/pdfs` stay false for Copilot ("verify against the real binary").
(b) Model-gated by the CLI itself: Qwen Code forwards an image to a model its modality table marks as image-capable
(`gpt-*`, `gemini-*`, `claude-*`, `qwen*-vl`, …) and a PDF to `gemini-*`/`claude-*`; otherwise it sends the model
"[image: image/png]". OpenCode forwards per the model's models.dev capabilities and otherwise tells the model "this model
does not support image input. Inform the user." (c) Codex's code mode forwards an image block (`image()`) but has no
helper for a document; the PDF reaches the model only as JSON text of the block. (d) Goose decodes an embedded PDF
resource into text (the raw PDF bytes): unusable. (e) Engines that report no cost (Copilot, Gemini CLI, Qwen Code) are
priced from their token usage with worca's rates; Goose and OpenCode keep their own figure, re-priced by a Models page
price. A Gemini CLI and a Qwen Code chat tripped `max_budget` on a priced model in the end-to-end run. (f) Codex offers its
locked-down set (`exec` without MCP tools, `wait`, `request_user_input`, `clock`, `collaboration`) — the same set as a
chat; its sub-agents inherit the lockdown. (g) Goose offers `load_skill`, its one justified meta tool. (h) The suggestion
model `gpt-5.6-luna` is not the stub's, so only the title was seen end to end on Codex; the suggestion path is the same
call. (i) Copilot strips its BYOK `COPILOT_PROVIDER_*` env from MCP children (checked with an env-dumping server: every
other allowlisted name and `HOME`, `PATH` reach it), so the nested classifier inside worca's MCP child cannot reach the
stub. A signed-in Copilot reads its credentials from `HOME`, which the child has; not verified. (j) Gemini CLI: the chat
folder's settings `modelConfigs.customOverrides` on `chat-base-3` (`thinkingLevel` LOW/MEDIUM/HIGH) and `chat-base-2.5`
(`thinkingBudget` 1024/8192/24576); the requests showed the level on gemini-3.x and the budget on gemini-2.5. Qwen Code:
`model.reasoningEffort` in worca's system settings; the request carried `reasoning_effort`.

### What changed (code)

- **Media** (`tools.mjs` `MCP_CONTENT`, `mediaResult`; `rpc-server.mjs`): `read_attachment` and `read_file` return an MCP
  `image` block, or an embedded `resource` with `application/pdf`, after the JSON text, on an engine whose `chat` flag
  takes that kind (`engine-switch.mjs`: Codex/Goose images; Gemini/Qwen/OpenCode both; Copilot neither); 20 MB cap. The
  attachment refusal names the chats that do view the kind. Codex keeps `-i` for the message's own images
  (`turnImages`). The relay mode passes the extra blocks unchanged (the server runs the same RPC server).
- **Titles, suggestions, classifier** (`title.mjs` `auxTextCall`, `classify.mjs`, `workflow-deps.mjs`): `askLockdown: true`
  and no `--mcp-config` — the chat's own lockdown with no MCP server — instead of a read-only helper mode. Gemini CLI's
  helper calls run in a folder of their own (it writes the lockdown's settings into the cwd). worca's MCP child learns the
  chat's model (`WORCA_ASK_MODEL`), the engines' binary overrides, and the engine's sign-in env names (descriptor
  `signIn`), so the nested classifier signs in as the chat does.
- **Cost** (`ask/chat-price.mjs`, `turn.mjs` `_priced`, descriptor `listRates`): one rule on every engine.
- **Registry copies** (`ask/mcp.mjs` `mcpForEngine`, `spawn.mjs`, `ui/server.mjs`): the copies the engine can attach
  (its adapter's `unattachableMcp`) ride the per-turn config beside `worca`; secrets in `spawnEnv`, redacted; keep-list
  names in the env allowlist for the launcher. The watchdog now allows `mcp__worca__*` and this turn's copies only (plus
  Codex's own `mcp__codex__*_mcp_resource*` tools, as `metaTools`) — before, any `mcp__*` passed.
- **Self-test**: a second probe server (`mcpcopy`) beside `worca`; it must be offered and answer (a lockdown that allowed
  only `worca` would hide a chat's copies). OpenCode's per-spawn alias is per server in the self-test. Cache key bumped
  (`r2`), so earlier passes run again once. Verified on the four binaries (2.2 s, 4.8 s, 0.5 s, 5.1 s); the Qwen run
  without the lockdown is still refused.
- **Effort**: `GEMINI_EFFORTS = low, medium, high`, `QWEN_EFFORTS = low … max`; capability `effort` true on both
  (pipelines included).

### Still not verified / not possible

- Copilot images and PDFs, and the Copilot classifier, with a real sign-in (see (a), (i)).
- Codex and Goose PDFs: not possible with these CLIs' MCP handling ((c), (d)); worca has no PDF renderer to send pages
  as images.
- Real models: every run used the stub. A real model's reply to an image was not seen; the request carried it.
- Cursor: still not installable here (cursor.com, downloads.cursor.com and api2.cursor.sh refused; the npm package
  `cursor-agent` is an unrelated third-party tool). Its to-verify list above is unchanged.
- Registry copies with a remote (HTTP) server on Gemini/Qwen/OpenCode/Copilot: only stdio copies were run end to end.
- Context files stay text in the prompt: a chat folder `context.fileName` (plus `discoveryMaxDirs: 0`) did not keep
  `~/.gemini/GEMINI.md` out of a Gemini CLI request (checked with a marker), as the spike found for Qwen Code.
- Full suite: `node tools/test.mjs` — 15 905 tests, the same 9 failures as the base branch (git/clone/export/HTTP-timeout
  and `ui-history-shipit`), nothing else.
