# Changelog

## Unreleased

### Gemini CLI, Qwen Code, Goose and OpenCode in E2B sandboxes and under the credential broker

- Every engine now runs in an E2B sandbox. Gemini CLI, Qwen Code, Goose and OpenCode go through worca's model relay per sign-in: the one the step resolves to (as a local run picks it) names the vendor API and the key in the worca server's environment that signs each call on the server. Each CLI gets the relay URL and a placeholder key, and its telemetry, model catalog fetches and updates are off. No model key enters a sandbox.
- Under the credential broker they take the slot of that sign-in: a new `google` slot holds a Gemini API key (`x-goog-api-key`), and Qwen Code, Goose and OpenCode also use the `openai`, `anthropic` and `openrouter` slots. No endpoint, key or sign-in setting of theirs reaches the CLI from worca's environment, the allowlist or the run env.
- The relay and the broker meter the Gemini API's usage. Worca books the relay's count in a sandbox: tokens for Gemini CLI and Qwen Code, the relay's price for Goose and OpenCode, never the CLI's own figures there.
- **Upgrade notes.**
  - Refused in a sandbox: Gemini CLI's Google login, Vertex AI with Google's Application Default Credentials or an access token, Qwen OAuth, a key a CLI keeps in its own config, Goose on Bedrock, Vertex AI or GitHub Copilot, and OpenCode's GitHub Copilot sign-in. Under the broker, Gemini CLI's Google login stays refused, and so does a provider with no slot (Azure OpenAI, Databricks, OpenCode Zen).
  - A Goose, OpenCode or Qwen Code step in a sandbox or under the broker needs a model.
  - The E2B template pins gemini 0.63.0, qwen 0.25.0, goose 1.55.0 (checked against its release SHA-256) and opencode 1.18.23. Rebuild your template (`npm run e2b:build`) before a run on one of them.

### Engine gate refusals name the options that exist

- `worca --guardrails <id>` picks a run's guardrail set. A run the engine gate refuses for its set's rules names that flag (`--guardrails permissive`) and `--allow-unguarded-engine` on the CLI, and the Permissive set and Allow unguarded in the UI. A resume keeps the set its run pinned, so its refusal points at a new run on the Permissive set instead.

### Security: the merged engines move onto the engine catalog (core protection layer)

- Gemini CLI and Qwen Code: each gets one sign-in's names and never worca's other keys: the sign-in its own settings choose, else the first one worca's environment names. Of the run's environment, only the values its MCP servers reference reach it. Qwen Code's sub-agent tools (`agent`, `send_message`, `cron_create`) are switched off. Archiving a run removes their sessions (`~/.gemini/tmp`, `~/.qwen`), never a sign-in file. When Gemini CLI refuses a tool call on its own (with no terminal it refuses a shell command that reuses a flag or path from earlier tool output, and edits to build files such as `package.json`), the run log says it was not a worca rule.
- Goose: the step's `provider/model` id names the provider, and Goose gets that provider's key only (no model: the provider Goose is configured with). Its MCP servers' env values no longer ride Goose's own environment, where every tool call saw them: each sits in a file beside the server's wrapper. A step that ends early (an error, the turn cap, a stop) books what Goose recorded, and a reply Goose could not price is cost unknown, never $0. Archiving a run removes its Goose sessions from Goose's database.
- OpenCode: every step must name a model (the catalog's rule; nothing lifts it), and the step's provider gives OpenCode its one key. Its `task` tool is switched off. A step that ends early books what OpenCode priced, its sub-agents included, and their tool calls reach the run log; a step that says cost 0 for its tokens (OpenCode Zen's free models, a custom provider) is cost unknown, never $0. A Goose or OpenCode model id whose provider or model half starts with `-` is refused.
- **Upgrade notes.**
  - Gemini CLI holds `Edit`, `Bash`, `Grep` and `Glob` rules only in part (no edit refusal was captured), and `WebFetch`, `WebSearch` and MCP rules are unverified; Qwen Code holds `Bash` only in part, and `Write`, `Grep`, `Glob`, `WebFetch` and `WebSearch` are unverified. Each of those needs `--allow-unguarded-engine`.
  - Every rule kind needs `--allow-unguarded-engine` on Goose: it holds no rule per spawn. Amazon Bedrock with a Bedrock API key (`AWS_BEARER_TOKEN_BEDROCK` handed to Goose) is refused, also for a step with no model while `GOOSE_PROVIDER` is `aws_bedrock`: sign Goose in with an AWS profile. On Windows, a Goose MCP server that declares env values is not attached. Under a cost cap, a Goose step starts only on a model worca can price itself (a Models page price, or an `anthropic/…` or `openai/…` list price).
  - `WORCA_OPENCODE_ALLOW_DEFAULT_MODEL` is no longer read, and the sign-in mode `zen` is now `opencode`. OpenCode holds `Bash`, `Read`, `Edit` and `Write` rules only in part, and `WebFetch`, `WebSearch` and MCP rules are unverified: each needs `--allow-unguarded-engine`. Under a cost cap, an OpenCode step starts only on a model worca can price itself, as on Goose.

### Security: one owner per engine boundary (core protection layer, part 1)

- Every engine's agents get an allowlist environment, Claude's included and with env scrub off: the base names, the engine's own exact names from its catalog entry (`src/shared/engine-switch.mjs`), its sign-in names and the guardrail set's allowlist. No prefix family (`CLAUDE_*`, `COPILOT_*`) passes any more, locally or in a sandbox, so `COPILOT_ALLOW_ALL` and another engine's keys never reach an agent. Each run names what it withheld in one log line (`env: N variables not passed to <engine> (allowlist): …`), names only.
- Chat spawns go through the same allowlist: every chat engine's turn, its title, suggestion and classifier helper calls, and the MCP servers they start get the allowlist environment with the one sign-in its model uses, never worca's whole env.
- A stop kills an agent's whole process tree: a backgrounded dev server or MCP server started by the agent dies with the step, locally and in an E2B sandbox (the step runs under `setsid` and its group is signalled; the sandbox and its model relay keep running).
- The engine gate reads the catalog for every engine, Claude included: a rule kind that is not proven held (a recorded denial under `test/fixtures/engine-rules/`) is refused without `--allow-unguarded-engine`. A run with path rules on an engine with a shell logs that the shell can still reach those paths. A local native run says it is not a sandbox.
- An engine's sub-agent tool is switched off unless the catalog proves its sub-agents keep the run's rules (Codex `multi_agent`, Copilot `task`; Claude's are proven).
- Archiving a run removes its engine sessions (Claude Code transcripts, codex rollouts, Copilot session state, Cursor chats), never a sign-in file.
- A model id that starts with `-` is refused before anything spawns; run-start checks run under the run's own env.
- **Upgrade notes.**
  - Bedrock, Vertex and Foundry users must allowlist their cloud variables by name (`AWS_PROFILE`, `AWS_REGION`, `GOOGLE_APPLICATION_CREDENTIALS`, …) in the guardrail set's environment allowlist, scrub on or off. The run log names every variable it did not pass.
  - Claude Code 2.1.308 does not consult `Write(…)` rules (Edit rules cover every file-editing tool) and has no Grep or Glob tool: such rules now need `--allow-unguarded-engine` on Claude too. Its `Read`, `Edit`, `Bash`, `WebFetch`, `WebSearch` and MCP rules are held (each has a recorded denial) and need no flag.
  - The gate now also reads the project's own `.claude/settings.json` deny rules on Claude, as on the other engines: a project that denies `Write(…)`, `Grep` or `Glob` there needs `--allow-unguarded-engine` to start on Claude.
  - On Codex, Copilot and Cursor a bare `Bash`, `WebSearch`, `WebFetch` or MCP rule needs the flag as well: no rule kind of theirs has a recorded denial yet.

### Security: worca's trust boundaries

- Worca's own git calls in a project or run checkout never run a hook or config command an agent planted in the shared `.git`, including a filter behind a conditional include on `git worktree add` (runs, terminal branch folders, team metrics, policy and memory). Model-chosen code in the chat (`test_script` with a draft, a `command`/`code` param, or a built-in or plugin script) runs only behind an approval card that shows every value it runs. Under agent isolation, every caller on the box (all of 127.0.0.0/8 included) needs the instance token. `/answer`, `/approve`, `/retry`, `/abort` and `/cancel` follow the `/direct` rule in group chats. The credential broker gives the body budget back at a deadline and books paused readers, large JSON answers and every stream flag. Artifact routes read the file the link check passed. A relayed chat's MCP config is readable only by that person's agent user.
- **Upgrade notes.**
  - Schema v81. Existing installs keep Permissive guardrails through the `store_meta` row; new installs start on Normal. Unmerged branches that add a schema version must renumber.
  - On Normal, a run on any engine but Claude is refused: the others cannot fully hold its rules. Pick another set (`worca --project … --prompt … --guardrails permissive`) or pass `--allow-unguarded-engine`.
  - Broker: multi mode without agent users exits 78 unless `WORCA_AGENT_ISOLATION=0` is set. `WORCA_IDENTITY_HEADER` in multi mode needs `WORCA_IDENTITY_TRUSTED_PROXIES`. A Responses call with `background: true` is refused (its cost could not be booked). A request body must keep arriving and be complete within 120 s.
  - UI server: `WORCA_IDENTITY_HEADER` is read only from `WORCA_IDENTITY_TRUSTED_PROXIES` (IPs or CIDRs), and worca does not start with the header set but no trusted proxy.
  - With agents under their own users, worca does not start while `WORCA_BROKER_SECRET_FILE` is readable by its group or by others: make it `0600`, owned by the user worca runs as.
  - Network: on bare metal with `WORCA_HOST=0.0.0.0` in local mode, LAN callers now get 403. A local proxy that rewrites Host while the browser's Origin keeps another port gets 403 too.
  - Isolation: callers of the API from inside the box (curl scripts, the Railway probe) must send `X-Worca-UI-Token` from `ui.json`; the `worca` CLI does.
  - Image: rebuild for the `worca-plugin` user (uid 1002). The entrypoint re-permissions `plugins/` on each boot and makes `tmp/ask` sticky.
  - Chat: in a group chat `/direct` and the answer commands need a sender in `allowedUserIds`, or `directInGroups: anyone`. On Discord every chat is a group (the bot receives no direct messages).
### Run telemetry (experimental, flag `runTelemetry`)

- With the flag on, a run records every model call's context size, tokens, timing and tools, tool run times, retries, compactions and sub-agent calls, plus Worca's own state saves, live-update sizes and event loop delay, to `telemetry.ndjson` in the run folder. Recording only: runs behave the same, and with the flag off nothing is written.
- The run page's Agents tab shows each agent's context peak against the model's window, calls, sessions, time split and a context-over-time chart, and a line of Worca's own figures. `GET /api/runs/:id/telemetry` answers the same as JSON. See [Run telemetry](docs/run-telemetry.md).

### Chat sidebar aligned with Runs + shared list keyboard

- Shared list keyboard: Runs aligned + Keyboard shortcuts sheet: Cycle 2 fixes the web UI review's one major issue.
- Chats column with the Runs anatomy: sections, View menu, pin, archive (busy-blocked), search in the top bar, New chat +: Both webui cycle-1 majors are fixed: ask-history-cleared now empties (full) or prunes (scoped threadIds) the Chats column and refetches, and the head meter is a start-aligned block so its ellipsis applies.
- Topic groups for chats: Add to group, group dialog with suggested names, Group by Topic: Cycle 2 fixes both web UI majors: the Date view's Older count now counts the chats behind each group row (no phantom Older), and multi-project groups get their own 'Several projects' section.

### Run card: "Where the work is" route + group page jump

- Run page head: fixed 32px head row and full-width stage bar: The CSS-only s1 change matches plan v3 exactly: a 32px (40px touch) head row, the status block subgridded across the head so the stage bar is full width, no overhang, and a 16px gap.
- 'Where the work is' route replaces the delivery tracker and Branch row: Both cycle-1 majors are fixed and tested.
- Feature (group) page: no layout jump during live updates: The web UI review's major is fixed: keepUnchanged now refocuses the matching member link (same class, href and row data-key) after replacing a changed table.

- Run page: a 'Where the work is' route replaces the tracker, the Branch row and the PR fact rows; a feature run no longer reads 'Merged into' the previous run's branch.

### Command summaries in chat (#911)

- Chat: one-line command summaries, grouped cards, 760px column: Clean: the cycle-1 web UI major (the group head total froze while a grouped command ran) is fixed.
- Command summaries helper job: fallback summaries for chat commands: The diff implements plan v3 file by file: a redacted-command-only summariser with an in-flight-deduped LRU cache, the commandSummaryModel setting copied from namingModel, the flipCard write-back with one ask-command-summary frame, and the flag-gated Helper jobs row.
- Run logs: Bash descriptions with a Summaries / Raw switch: Cycle 3 fixes the three web UI cycle-2 findings with CSS only, gated on the flag and on containers that hold the switch: the drawer controls get flex:none, the switch padding is 7px at 480px and below, and the Logs bar wraps with content-width selects.

### Corporate proxy (experimental, flag `corporateProxy`)

- With the flag on, Worca's local proxy logs in to a corporate proxy (NTLMv2, or Basic when `networkProxy.auth` is `basic`; from `settings.json` `networkProxy.upstream` or an existing `HTTP(S)_PROXY`) and every child (agents, git, MCP servers, plugins, chat channels) and Worca's own fetch go through `http://127.0.0.1:<port>`, a URL without credentials, so plugins get it too. After one rejected login Worca stops sending credentials and answers 407 "proxy needs login", so the account is not locked. A hosting platform's outbound network policy now forwards to that proxy instead of replacing it.
- Log in once: `worca proxy login` or Settings › Runs › Network proxy saves the domain, user and NT hash (never the password) in a file only you can read (0600; owner-only ACL on Windows), and every boot uses it.
- `worca proxy status|test|logout`; the Test button and `worca proxy test` check github.com and api.anthropic.com.
- A rejected login is remembered across restarts, and a new login clears "proxy needs login" without a restart.
- Boot line `Corporate proxy: via host:port (NTLMv2)`.
- Kept-alive logins, Negotiate, Digest and a fixed port: plain-HTTP requests reuse one NTLM-logged-in connection until it idles out (`networkProxy.timeouts.idleMs`); a proxy that offers only `Negotiate` gets NTLMv2 inside it; `networkProxy.auth: "digest"` answers RFC 7616 Digest with the password from `HTTPS_PROXY`; `networkProxy.fixedPort` (or Local proxy port on the card) pins the local proxy to `127.0.0.1:<port>`, shown by `worca proxy status`; Playwright and Chrome launches in runs get the local proxy explicitly.
- Chat reads (`get_network_proxy`) and tests (`test_network_proxy`) the corporate proxy, and proposes settings changes and turning the flag on as cards you apply ("Restart Worca to apply"). It never handles the proxy password: logging in stays on Settings › Runs › Network proxy or `worca proxy login`.

### Run page: the PR details move from the tracker to the facts list

- The three-step tracker carries fixed labels only: Changes done · Pull request · Merged. The last step no longer names the base branch, so a long branch name can no longer push its circle out of line; a label that wraps keeps its circle and connector on its first line.
- The facts list (Group, Project, Branch) gains the rows the steps used to carry: **Merged** (the base branch the work is in, copyable like Branch, Advanced and up), **Kept work** (Download patch, Commit it yourself), **Pull request** (the shared PR chip: git-state icon, "PR #412", state word, opening GitHub in a new tab), **Checks** (the checks line in its colour) and **Watch** (its words, View fix run, and the Watch-stopped hint). GitHub's verdict stays in the status line only; Checks and Watch hide once the PR is merged.
- A workspace run lists its PRs one per line under **Pull requests**, the member names in one column, and Watch only for members whose watch is doing something.
- Fact labels never wrap.

### Projects: New never overrides; Remove deletes worca's own folders

- New by name names what blocks it: a registered project by its stored name, a folder by its path ("<path> is already registered as "<name>""), in the dialog, over the API and on Ask cards; a refusal from Create itself keeps Create off until the name changes.
- Remove project on a Folder project whose folder worca made in its projects folder (`<worcaHome>/projects`) now deletes that folder too, after a red confirm naming it (`DELETE /api/projects?…&deleteFolder=1`; without it such a removal answers 409). Git projects, folders added from elsewhere, custom projects roots and symlinks are only unregistered, as before. Removal is refused (409) while a run of the project is running or paused.

### Implement Run Presets Feature

- Save, pick and manage run presets in New run: The web UI review's blocking findings are fixed with tests: Agents-row edits in preset mode now store concrete booleans (presetNodePick), so Start, Update preset and Save as new no longer get a 400; the hidden-settings note counts only model picks (4 agent picks); preset menu and Settings labels load workspaces and repaint after projects load.
- Save a finished run's setup as a preset, and start from the Chat home: Cycle 2 fixes the web UI review's one major issue: a Chat home chip and Settings › Presets Use now both go through usePresetOnNewRun, which awaits applyPreset and focuses the empty prompt, and each path has a test.
- Presets in schedules, the CLI and Ask Worca: The diff matches plan v5: v62 preset_id columns; the preset is read at fire time as its stored owner; worca run goes only through the probed server; Ask propose_run takes presetId through the shared validator and refuses a Permissive preset; the flag moves to beta.
