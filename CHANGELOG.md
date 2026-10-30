# Changelog

## Unreleased

### Flag Runs That Finish Without Doing Work

- Catch a run that finished without doing the work and flag it done-unsuccessful: Cycle 2: Slice 1 is implemented faithfully and conservatively against the approved v5 plan.
- Show 'done, unsuccessful' with its reason everywhere a run result appears: Clean cycle-2 implementation of slice 2.
- Route swallowed step failures through _recover instead of ending done: Faithful, minimal implementation of plan v5.

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
