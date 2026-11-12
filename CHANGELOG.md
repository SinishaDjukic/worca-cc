# Changelog

## Unreleased

### Per-model prompt add-ons and effort intents

- Per-model-family prompt add-ons: Role reviews: no blocking findings.
- Per-step effort intents mapped per model family: Role reviews: no blocking findings.
- Refusal stop reason surfaces as a clear step error: Role reviews: no blocking findings.

### Instance contract for hosting platforms

- New [Instance contract](docs/instance-contract.md) page: what a hosted Worca instance is made of (the `worca`, `broker` and `cloudflared` containers, their start commands, ports and volumes) and everything a management interface sets or expects: every variable per container, the identity token, the heartbeat and what a receiver should do with it, stopping and draining, rotation and versions. For running Worca for others without a hosting platform, or for building a management interface of your own.
- `docker/compose.instance.yml`: the same shape in Docker on top of `compose.yml` and `compose.broker.yml`, with `cloudflared` under the `tunnel` profile and the hosted-mode variables commented.

### Agents left running by a killed server are stopped at the next start (#1144)

- On Linux, macOS and WSL, a Claude, Codex or Copilot process (and anything it started) no longer keeps running after the Worca server or a CLI run is killed with SIGKILL, for example by the out-of-memory killer under WSL2. Each process records its agent process groups in `<worca home>/agent-groups/`, and the next server start stops the ones whose owner is gone, so they no longer hold memory and make the next kill more likely. A PID that another process has taken since (after a reboot or `wsl --shutdown`, or in a restarted container, whose PIDs start again from 1) is never touched: each group is recorded with its boot id and start time.

### Shaper: shape the requirements first

- Requirements stage and plan coverage (3-card UX, behind a Labs flag): Unchanged since cycle 2: fix cycle 2 edited no file (newest edit 10:43, before the cycle 2 review at 10:46; DEVIATIONS 14).
- Build by requirements: slices and code reviews carry the R-*: Cycle 4: the cycle-3 blocker (R-qa-6) is fixed.
- Close the loop: requirement concerns, acceptance and changes after ship: Cycle 4 fixes both web UI review majors.
- Cleanup: drop dead paths after the requirements stage settles: The slice is verification-only, as the v3 plan says.

### Independent review gates, engine-first (#990)

- Engine role-review step, model per role, Shaper plan review moved onto it: Both cycle-1 blockers are fixed and tested.
- No silent fallbacks, picks per role in the Shaper card, diversity default: The cycle 1 major issue is fixed.
- Finding dispositions and structured review counts: The diff implements the plan's contracts and invariants.
- Code role reviews on Shaper's review node, by configuration: The cycle-2 critical is fixed.
- plan_concern pauses at the plan approval gate: The cycle-1 major is fixed.
- Review-quality API from structured counts: The diff implements the plan as specified: a pure counts-only aggregation module, a COALESCE-kept pipelines.review_stats column with no version bump, the reviewQuality reader and the guarded route, the parity row, the docs, and a real mock-run seeded-defect test.
- Cleanup: drop dead paths, keep old-data readers: The diff implements D1, D3-D8 exactly as planned and keeps every old-data reader (K1-K9).

### One Node: 24 for the image, CI and releases

- The Docker image moves from Node 22 to Node 24 (`node:24-bookworm-slim`). `.nvmrc` names Node 24, and every CI job, the release build and the image follow it; CI's fast tests also run the exact floor (22.19.0) and the newest LTS (26). The supported range for an npm install is unchanged: Node 22.19.0 or newer.

### Node 22.19 or newer

- Worca now needs Node 22.19.0 or newer (was 22.13.0): undici 8, which routes fetch() through `HTTP(S)_PROXY`, needs it. On an older Node the CLI says so and exits; `nvm use` picks up the bundled `.nvmrc`.

### "Push as me" covers clones and fetches too

- With `WORCA_GH_AS_PERSON`, worca's GitHub reads (a clone, a fetch, a pull request's status) also use the acting person's own GitHub when they connected it on the key page, so a person can clone and open pull requests on what their own account reaches (pull request status shown to everyone still needs the deployment's credential), even when the deployment has no GitHub credential. Without a connected GitHub (or with no one behind the call) reads use the deployment's credential, also under `required`, which only refuses writes. Their token is kept in memory for up to a minute for reads. Only reads on a project for that person opt in (clone, fetch, finding their own pull request when they open one); pull request status, checks and chips, the watcher, automations, plugin and skill installs, the git-free API and metrics keep the deployment's credential. A repository cloned with a person's token is visible to everyone on that worca, and the clone card and key page say so.
- Settings › **My credentials** (was My model credentials) lists model keys and, with "push as me" on, your GitHub account in its own group with what connecting does; GitHub makes Manage keys the primary action only under `required`. The key page's hint sits on its own line above the button.
- The clone card, Ask Worca's hosting rules (`githubAsPerson=` on the deployment line) and the key page's GitHub row say so, and the key page names the permissions a token needs.

### Credential broker: "Push as me" with a pasted token, no GitHub App needed

- In multi mode the broker's GitHub row is always on the key page. Without `WORCA_BROKER_GITHUB_CLIENT_ID` it is paste-only: each person pastes a fine-grained token (checked with GitHub, kept sealed) and Worca's pushes and pull requests with `WORCA_GH_AS_PERSON` go out as them. The client ID now only adds "Sign in with GitHub" (and, with the secret, the renewal of GitHub App user tokens). A sign-in's token due for renewal on a broker without a client ID counts as expired.
- Worca warns at start about `WORCA_GH_AS_PERSON` only when the broker has no GitHub slot at all (single mode without a client ID), no longer for a multi-mode broker without one.

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
