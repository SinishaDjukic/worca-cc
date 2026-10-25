# Core protection layer: one owner per trust boundary

Status: design, for review (2026-10-22). Docs only; nothing here is built.

**Base:** branch `claude/e2b-multi-engine-relay-2343bb`, commit `04347487a` (PR #826 E2B execution
environment + model relay + the Codex/Copilot/Cursor relay). PR #854 (`origin/fix/security-hardening`,
`5b230160d`) merges first and is assumed present. All `file:line` references are to `04347487a`
unless they are marked **#854** (references to `5b230160d`).

**Owner decisions this design applies (2026-10-22), in the owner's numbering.** Decisions 1 and 2
(the identity header, G6 cards) belong to #854. Decisions 9-11 came in the afternoon, after the
audit of the updated "Engine protection layer" doc (`plans/2026-10-22-protection-doc-audit.md`).

3. Every engine gets an allowlist env, including Claude, even with `envScrub` off. Ship it with a
   release note and one run-log line that names the dropped variables.
4. Native stays the local default, and container or E2B are opt-in. Say plainly that native is not
   a sandbox. Revisit once per-run mounts land.
5. Engines with their own sign-in stay refused under the credential broker. The API-key and PAT
   modes of Codex, Copilot and Cursor are allowed through relay broker slots.
6. Secret paths: a default mask list (`.env*`, `*.pem`, `*.key`, `.npmrc`, `.netrc`, `id_*`) plus
   project additions. Unmasking needs an explicit setting. Masking applies to container mounts and
   to the sandbox upload.
7. The sandbox egress allowlist (E2B `allowOut`/`denyOut`) is opt-in per project for now. Per-path
   rules come later, in worca's proxy.
8. Merge order: #854, then #826 + relay, then this core layer, then the engine PRs.
9. The gate refuses a partly held command rule (Codex prefixes) without `--allow-unguarded-engine`.
   A rule kind that is unverified, or not listed in the catalog, counts as unenforced.
10. Baseline: on every engine with a shell, Claude included, path rules count as "partial under a
    shell". Each run with path rules gets one run-log line saying so. The line never blocks a run.
11. If an engine's sub-agents don't inherit its rules, the core denies the sub-agent tool. The
    catalog can claim inheritance only with a recorded denial as proof.

---

## 1. Why

Three independent reviews found the same root cause. They were the engine PR reviews, the
29-finding security evaluation, and worca run `aef91a37` on #854. In each, a security decision is
made in more than one place, and the copies drift apart. Each copy is reasonable on its own. The bug
is that two of them disagree. Below is what that looks like on the base branch today.

| Decision | Copies | Drift |
|---|---|---|
| Which env vars reach an engine | `buildSpawnEnv` prefix families per adapter (`engines/claude.mjs:564-566`, `codex.mjs:786`, `copilot.mjs:624`, `cursor.mjs:462`). `sandboxEnv` regexes (`exec-env/policy.mjs:41-52`, `:81-91`). `scriptBaseEnv` (`graph/script-runner.mjs:214-218`). `actionBaseEnv`/`terminalEnv` (`terminal/context.mjs:62-85`). `plugin-shim.mjs scrubbedEnv` (`:118-129`). | #854 drops `COPILOT_ALLOW_ALL` on the local path (**#854** `engines/copilot.mjs:10-17`). The sandbox path still passes it, because `ENGINE_SANDBOX.copilot.allow` is `/^COPILOT_/` (`policy.mjs:48`) and only `_(TOKEN\|SECRET\|KEY)$` names are filtered (`policy.mjs:69,84`). |
| Env is scrubbed at all | `envScrub` defaults to off (`guardrails.mjs:22`). With it off, `composeSpawnEnv` hands the child the full `process.env` minus host credentials (`engines/spawn.mjs:98-109`). | A local engine child inherits every server variable, including other engines' keys. |
| Run-start checks see the run's env | `codexPreflight` calls `execFile` with no env (`codex.mjs:665`, `:694`). `copilotPreflight` passes `{...process.env}` (`copilot.mjs:516`). `cursorPreflight` passes `{...process.env, ...env}` (`cursor.mjs:392`). `preflight.mjs:28` passes raw `process.env`. | The preflight's sign-in and version answer comes from a different env than the run uses. |
| Git never walks above the run | `GIT_CEILING_DIRECTORIES` is set at 7 sites: `phases.mjs:808`, `script-runner.mjs:202`, `terminal/context.mjs:77`, `codex.mjs:823`, `copilot.mjs:649`, `workspace-map/detectors/git-submodules.mjs:20`, `exec-env/git-transfer.mjs:157`. | It is missing at `workspace-map/files.mjs:73-77`, the harness `_git` (`run-harness.mjs:6965`) and the cursor adapter's own git (`cursor.mjs:133`). |
| A value can't become a flag | Leading-`-` refusals at about 10 sites (`worktree.mjs:200`, `git-sync.mjs:128`, `clone-project.mjs:26`, `copilot.mjs:103`, …). | There is no check on model values, which go in as `--model <value>` (`claude.mjs:330`, `copilot.mjs:312`, `cursor.mjs:252`). |
| A stop kills the whole tree | Group kill exists in scripts (`script-runner.mjs:316-317`), actions (`actions/spawn.mjs:58`), pty (`terminal/pty.mjs:61`) and the MCP probe (`mcp/test.mjs:105`). | `superviseSpawn` sets `detached` and group-kills only for agent-user spawns (`engines/spawn.mjs:180`, `:215`). A plain local engine's tool shells and MCP servers get no signal. A remote kill (`exec-env/remote-child.mjs:72-75`) has no group handling. |
| Which credential signs a model call | `engineCredential` switch (`policy.mjs:106-131`). `remoteModelRoute`/`engineModelRoute` (`exec-env/relay-route.mjs:45-89`, `:278-284`). `brokerEngineRefusal` hard-codes "not claude" (`broker-client.mjs:26-29`). | The broker refuses every non-Claude engine, even one whose credential is a plain API key the broker could hold. |
| Which model a sandbox may call | The route `allow` list checks method and path only (`model-relay.mjs:92-94`, `:291`). The body is forwarded unread (`:300-307`). | A sandbox can name any model on an allowed path. Copilot silently gets `gpt-5-mini` when no model is named (`copilot.mjs:53`, `:614-616`). |
| Spend is booked on every exit | Claude's `cleanup` emits `relayCost` on every path (`claude.mjs:646-653`). Codex closes with `{cost:true}` (`codex.mjs:911`). | Copilot (`copilot.mjs:724`) and Cursor (`cursor.mjs:550`) close without `cost`, so tokens measured after the last `result` are dropped on error, stop and turn cap (`remote-env.mjs:357-360`). An unpriced model books only its priced part (`run-harness.mjs:7500-7509`), and the step shows $0 (`run-harness.mjs:7929`). |
| Which engines exist and what they can do | `ENGINES` (`shared/engine-switch.mjs:17-22`). `REMOTE_ENGINES` (`shared/exec-env.mjs:8`). `ENGINE_SANDBOX` keys (`policy.mjs:41`). Adapter fields (`engines/index.mjs:50-60`). | `run-harness.mjs` exempts Claude by name: `_engineUnenforced`/`_enginePartial` (`:3258`, `:3267`), the resume gate (`:3298`), the early refusal (`:3364`), MCP warnings (`:3405`). Three lists are kept equal only by tests (`test/engine-switch-pause.test.mjs:38`, `test/exec-env-config.test.mjs:261`). |
| Which files are secret | `NORMAL_PROTECTED` (`guardrails.mjs:38-44`). The Secure preset (`guardrails.mjs:97-110`). `CREDENTIAL_NAMES` (`ask/show-files.mjs:75-90`). `SECURE_PROTECTED_PATHS` (`diff-anchor.mjs:23`). | The E2B upload overlay applies none of them. An untracked `.env` or `id_rsa` goes into the sandbox (`git-transfer.mjs:56`). |

A rule written once per call site will drift again with the next engine: #643 Gemini/Qwen, #819
Goose and #672 OpenCode each bring a new adapter. So the fix is structural. Each boundary gets one
module that owns the decision. Call sites ask that module. A test makes a second copy fail CI.

## 2. Goals, non-goals, anti-goals

**Goals**

- Each trust boundary in §4 has exactly one owner module. Adapters, the harness, scripts, the
  terminal and plugin hosts call that owner and decide nothing about the boundary themselves.
- Each owner has a guard test that fails when a new copy appears: an importer scan, a pattern
  scan, or a catalog-equality check.
- A parameterised conformance suite runs every check in §5 against every catalog entry. A new
  engine passes it by adding a catalog entry, an adapter and fixtures, and nothing else.
- Sign-in keeps working in every mode it works in today (§3).

**Non-goals**

- Changing the guardrail rule model, the host guard, or the permission prompts.
- Moving every git call in worca behind the child-process owner in this change. Git env is owned by
  `git-guard.mjs` (#854). The other git callers move behind the owner on a ratchet (§4.1).
- Making local native runs sandboxed. Decision 4 keeps the default and adds a warning.
- Per-run containers. None exist in `src/core` today: "container" means the whole server under
  `docker/compose.yml`. §4.6 defines the hook that a container backend calls.

**Anti-goals** (any of these makes the change a failure, even if it works)

- **A per-engine escape hatch in an owner.** An owner can depend on catalog data. It must never test
  `engine === 'x'`.
- **A sign-in regression.** No mode that signs in today may stop signing in because the allowlist
  dropped a variable.
- **Silent drops.** Every variable the allowlist drops is named once in the run log, by name only,
  never by value.
- **A fallback that puts a credential where the relay design forbids it**
  (`plans/e2b-model-relay-design.md` §2 anti-goals).

## 3. Sign-in in every mode (explicit constraint)

Claude subscription sign-in must keep working in every mode after this change. The same holds for
every other engine's own sign-in, which keeps working locally whenever the broker is off. Here is
what each mode uses today, and what the catalog must declare so the allowlist keeps it.

| Engine | Local, broker off | Broker on | Sandbox (E2B) |
|---|---|---|---|
| Claude | Its own `claude` login. Credentials live in the macOS keychain or under `~/.claude`/`CLAUDE_CONFIG_DIR`, or come from `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` in the env. | The broker holds the subscription token. Its proxy signs as `Bearer` + `anthropic-beta: oauth-2025-04-20` (`broker/service.mjs:80-86`, `:190-197`). | The relay signs with the server's `CLAUDE_CODE_OAUTH_TOKEN`, preferring OAuth over `ANTHROPIC_API_KEY` (`policy.mjs:25-29`, `relay-route.mjs:71-77`). |
| Codex | ChatGPT `auth.json` via `CODEX_HOME`, linked into the managed home (`codex.mjs:152`, `:182-195`), or `CODEX_API_KEY`/`OPENAI_API_KEY`. | Today: refused (`broker-client.mjs:26-29`). After this change: an API key in a broker slot. ChatGPT sign-in is still refused. | Server `CODEX_API_KEY`/`OPENAI_API_KEY` through the relay (`policy.mjs:113-118`). |
| Copilot | `copilot login` (keychain) or `COPILOT_GITHUB_TOKEN` (`copilot.mjs:491`). | Today: refused. After: a fine-grained PAT in a broker slot. Keychain login is still refused. | Server fine-grained PAT through the relay (`policy.mjs:119-124`). |
| Cursor | `cursor-agent login` (keychain) or `CURSOR_API_KEY` (`cursor.mjs:17-18`, `:386-399`). | Today: refused. After: `CURSOR_API_KEY` in a broker slot, with the key-to-token exchange in the broker. Keychain login is still refused. | Server `CURSOR_API_KEY`, exchanged by the relay (`relay-route.mjs:224-266`). |
| Gemini (#643) | Google login (`~/.gemini`) or `GEMINI_API_KEY`. | Google login refused; an API key slot comes once a `gemini` relay protocol exists. | Not remote until it has a relay protocol. |

The rules this design adds:

- **Each catalog entry declares the exact names its sign-ins need** (`signIn.modes[].env`,
  `signIn.modes[].files`). The allowlist always keeps them for the sign-in mode the run uses.
  - Claude declares: `HOME`, `USER`, `LOGNAME`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`,
    `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`.
  - On macOS the keychain also needs `HOME` + `USER` to resolve the login keychain. It needs `PATH`
    to reach `/usr/bin/security`. All three are in the base set.
  - Codex declares `CODEX_HOME` and its API key names. Copilot declares `COPILOT_GITHUB_TOKEN` and
    `COPILOT_HOME`. Cursor declares `CURSOR_API_KEY` and `CURSOR_CONFIG_DIR`.
- **The allowlist never decides sign-in.** `childEnv` (§4.1) takes the sign-in mode from the
  credential owner (§4.2) and keeps exactly that mode's names. A relayed mode keeps none: the relay
  signs.
- **Own sign-in under the broker is refused, and nothing else is** (decision 5). A relayable mode
  whose credential sits in a broker slot is allowed (§4.2).
- **Conformance row C-SIGNIN** (§5) proves this. For every catalog entry and every declared sign-in
  mode, a fake engine binary fails unless it sees that mode's declared names and no other
  credential. The modes covered are local, broker, and sandbox (fake E2B). Real sign-ins run in the
  live tier (`npm run test:live`): Claude subscription locally, under the broker, and in the local
  Lima E2B.

## 4. The boundaries and their owners

### 4.1 Child processes: `src/core/spawn.mjs`

**Owner.** `src/core/engines/spawn.mjs` moves to `src/core/spawn.mjs`, because scripts, the terminal
and plugin hosts are not engines. It becomes the only module, other than ratchet-exempt git callers,
that imports `node:child_process`. It owns four things.

**1. `childEnv(spec) → { env, dropped }`.** This is the one env builder, for every kind of child:
`engine | script | terminal | plugin | git | preflight`.

- It starts from an allowlist of **exact names**, never prefix families. The names are:
  - `SPAWN_ENV_BASE` (`engines/spawn.mjs:39-43`);
  - the catalog entry's `env.names` and the active sign-in mode's names (§3);
  - the run's `envAllowlist`;
  - keys the caller declared (model env, kept MCP secrets, script contract vars, the `MCPCHILD_*`
    set).
- The remote branch applies `sandboxEnv` rules from the same catalog data. `ENGINE_SANDBOX` regexes
  (`policy.mjs:41-52`) become catalog name lists. `COPILOT_ALLOW_ALL` is then dropped on both paths,
  because no catalog lists it.
- It always applies `stripHostCredentials`, removes `WORCA_BROKER_SECRET(_FILE)`, and applies
  `withNoGitPath`, as `composeSpawnEnv` does today (`engines/spawn.mjs:104-107`).
- It sets `PWD` to the child's cwd. Nothing sets it today (`policy.mjs:73` only drops it remotely).
- It sets `GIT_CEILING_DIRECTORIES` to `dirname(root)`, where `root` is the run's work root. That is
  the worktree for a project run and `work/` for a no-project run. It is merged with any value the
  run already has. This replaces the 7 call-site copies.
- It returns `dropped`, the names it withheld. The harness logs them once per run as one line, for
  example `env: 14 variables not passed to codex (allowlist): AWS_PROFILE, …`. This is decision 3.
- `envScrub` stops being a switch. The allowlist is always on. `envAllowlist` stays as the project's
  additions. A release note covers the change for anyone relying on inheritance today, such as
  Bedrock/Vertex users who must now allowlist `AWS_*`/`GOOGLE_APPLICATION_CREDENTIALS` by name. That
  is already the documented way under scrub (`engines/spawn.mjs:36-38`).

**2. `superviseSpawn(o)`** (today `engines/spawn.mjs:158-312`), generalised to every long-lived child.

- On POSIX, a local child always gets `detached: true`. An abort sends `process.kill(-pid, SIGTERM)`,
  then `SIGKILL` to the group after `sigkillGraceMs()`. The agent-user path keeps `killAgentGroup`.
- A remote child gets the same treatment, per step, so a stopped step's grandchildren die while the
  sandbox lives on. This was checked on the local Lima E2B
  ([`plans/2026-10-22-e2b-kill-egress-checks.md`](2026-10-22-e2b-kill-egress-checks.md) §1).
  - Today envd starts every command in envd's own process group and session, inside one shared
    cgroup (`/user`). `handle.kill()` (SIGKILL), like an envd SIGTERM, reaches that one pid only, so
    descendants keep running.
  - `RemoteChild` runs the line as `exec setsid -w <cmd>`. The handle's pid then leads a new group
    and session, so the pgid is `remotePid` and no pgid file is needed. `setsid` is present in
    `worca-agent`.
  - On stop, worca runs a second command, `kill -TERM -- -<pid>`. After `sigkillGraceMs()` it runs
    `kill -KILL -- -<pid>`, and then calls `handle.kill()` as a backstop.
  - The model relay is a separate command with its own pid and group, so a step's group kill never
    reaches it. Worca never signals envd's default group.
  - `e2b-fake.mjs:22-23` already models this group kill.
  - Known gap: a grandchild that calls `setsid` itself, or double-forks, survives the group kill
    (the OpenCode own-session case). A stronger mode is tested and does catch escapees: a root
    wrapper moves itself into a per-step cgroup under `/sys/fs/cgroup/user`, then runs
    `runuser -u user --`, and stop is `echo 1 > cgroup.kill` as root, then `rmdir`. It is used only
    if C-GROUPKILL (§5) finds an engine whose children leave their session.
  - `user` has passwordless sudo in the sandbox, so both modes stop accidental survivors, not a
    hostile agent. `Sandbox.kill` at a whole-run stop is the only hard boundary.

**3. `argValue(v, what)`.** Every value that lands in argv after a flag (a model id, branch, path or
rule word) goes through it. It throws (`errorClass: 'config'`) when the value is empty or starts
with `-`. Adapters build `['--model', argValue(model, 'model')]`. The existing call-site checks
(`worktree.mjs:200`, `git-sync.mjs:128`, …) move to it.

**4. `execCheck(file, args, { spec })`.** This is the run-start check runner. It builds its env with
`childEnv(spec)` from the same spec the run will spawn with, so the preflight env equals the run env.
It replaces the raw `execFile` calls in `codex.mjs:665`, `:694`, `copilot.mjs:516`, `:555`,
`cursor.mjs:392` and `preflight.mjs:28`.

**Callers moved in this change.** The child-process inventory lists about 45 importers. These move:

- engines: `codex.mjs:22`, `copilot.mjs:38`, `cursor.mjs:34`, `preflight.mjs:12`
- scripts: `graph/script-runner.mjs:10`, which keeps its `killTree` semantics through
  `superviseSpawn`
- terminal: `terminal/pty.mjs:5`, with `terminal/context.mjs` building its env through `childEnv`
- plugin children: `plugin-shim.mjs:15`, `chat/channel-host.mjs:18`, `plugin-store.mjs:9`
- workspace-map git: `workspace-map/files.mjs:7`, `workspace-map/detectors/git-submodules.mjs:7`

**Guard test** `test/boundary-child-process.test.mjs`. It scans `src/` and `ui/server.mjs` for
`node:child_process` / `'child_process'` imports.

- Allowed: `src/core/spawn.mjs`, plus a frozen `RATCHET` list of the remaining git and host-tool
  callers (`worktree.mjs`, `git-info.mjs`, `run-harness.mjs`, `keep-awake.mjs`, …).
- The test fails on any importer not on the list. It also fails when a listed file no longer imports
  child_process, so the list can only shrink.
- A second scan fails on `buildSpawnEnv(`, `{ ...process.env` or `env: process.env` in `src/core/engines/`.

### 4.2 Model credentials: the route resolver in `exec-env/relay-route.mjs`

**Owner.** `resolveModelRoute({ engine, mode, model, serverEnv, broker, spawnEnv }) → Route` is the
only function that decides where a model call goes and what signs it. It absorbs `engineCredential`
(`policy.mjs:106-131`), `remoteModelRoute` (`relay-route.mjs:45-89`), `engineModelRoute`
(`:278-284`) and `brokerEngineRefusal` (`broker-client.mjs:26-29`). The result says one of four
things.

- **`relayed`.** The call goes through the relay. Worca adds the credential on its side.
  - Sources:
    - the server env, as today;
    - a broker slot, where the relay's upstream is the broker's `/p/<slot>/…`
      (`broker/service.mjs:328`) and worca's side adds the spawn's `wbt_` token
      (`broker/tokens.mjs:3-9`);
    - a codex endpoint model's own key (`relay-route.mjs:140-148`).
  - The spawn gets the relay URL and a dummy credential, as today (`relay-route.mjs:101`, `:160`,
    `:213`, `:264`).
- **`brokered`.** This is a local run under the broker. The CLI is pointed at the slot URL with its
  `wbt_` token, which is what `runViaBroker` does for Claude today (`claude.mjs:871-874`). It is
  extended to Codex (the `openai` slot, `broker/slots.mjs:45`) and to Copilot. Cursor needs a new
  `cursor` slot, because none exists (`broker/slots.mjs:33-82`).
- **`own`.** The engine's own sign-in, as declared in its catalog `signIn.modes`. This is allowed
  locally with the broker off. It is refused under the broker (decision 5) and refused in a sandbox.
- **`direct`.** This is a local run with the broker off whose credential is in the server env. It is
  today's behaviour and stays the default (decision 4). The run log carries one plain line:
  `codex signs in with OPENAI_API_KEY from worca's environment; the agent can read it. Use a sandbox
  or the credential broker to keep it out.`

**Exactly one named key.** In `direct` and `own` mode the resolver picks *one* credential name, for
example `OPENAI_API_KEY` and not `CODEX_API_KEY` as well. `childEnv` keeps only that name out of all
the engine's credential names. Every other engine's credential names, and this engine's unpicked
ones, are dropped. C-CANARY's single exception is that one name.

`brokerEngineRefusal` is replaced by this rule: refuse when the broker is on and the engine has no
`brokered` or `relayed` mode for the protocol. Today that refuses only own sign-ins.

The one copy of the relay transport. A local `relayed` route (opt-in, §9) reuses `ModelRelay`
unchanged by running `sandbox-relay.mjs` as a local child through `superviseSpawn`. The relay already
speaks only JSON lines over the child's stdio (`model-relay.mjs:1-4`), so no second relay is written.

**Model check at the relay.** Each route carries `models`: the dispatched model plus the catalog's
`relay.auxModels(dispatched)`. Claude Code's small-fast model is one example.

- For `anthropic` and `openai` protocols, `ModelRelay._request` parses the JSON body's `model` field.
  It already holds the decoded body (`model-relay.mjs:300`). A model outside `models` is refused
  with 403 `worca-relay: model … is not this step's model`.
- `connect` (Cursor) names the model inside protobuf. Its catalog entry declares
  `relay.modelCheck: 'partial'` with a fixture, and the gate names it, as a partial rule is named
  today.
- `COPILOT_REMOTE_DEFAULT_MODEL` (`copilot.mjs:53`, `:614-616`) is deleted. A remote Copilot step
  with no model takes the catalog's `defaultModel` (step resolution, `run-harness.mjs:1465`). If
  there is none, the run is refused at start: `Copilot in a sandbox needs a model; pick one for this
  step.`

**Guard test** `test/boundary-credentials.test.mjs`. It fails when a file outside
`relay-route.mjs`/`broker/` reads any catalog-declared credential name from an env object (a
pattern scan for `.CODEX_API_KEY`, `['ANTHROPIC_API_KEY']`, …). It also fails when an adapter calls
`openEngineRoute`/`openModelRoute` with anything but the resolver's result.

### 4.3 Usage ledger: `exec-env/relay-usage.mjs` + one harness booking path

**Owner.** The route meter (`relay-usage.mjs:196-206`) is the ledger's source for every relayed or
brokered spawn. The harness's `_bookUsage(e, attr)` is the one place a step's cost changes. It
replaces the split between `_relayedCost` (`run-harness.mjs:7486`) and `_onRelayCostEvent`
(`:7500`).

- **Every exit path books.** `closeEngineRoute` loses its `cost` option (`remote-env.mjs:357-360`).
  A route close always emits `{ type: 'usage', source: 'relay', messages, byModel }` for what no
  `result` covered. `superviseSpawn`'s single `cleanup` (`engines/spawn.mjs:143`) calls it, so
  success, error, turn cap and stop are one path. Adapters no longer close routes themselves
  (`copilot.mjs:724`, `cursor.mjs:550`, `claude.mjs:648-653`, `codex.mjs:911`).
- **Engine-reported figures** (local `direct`/`own` runs: Claude's `total_cost_usd`, codex's rollout
  estimate at `codex.mjs:879-896`) are booked with `source: 'engine'`. Under a relay, the relay's
  figure wins, as `_relayedCost` already decides (`run-harness.mjs:7486-7497`).
- **Local runs book on every exit too.** A local run has no relay meter, so the spend the engine
  reported before an error, a turn cap or a stop must not be lost.
  - Adapters emit `{ type: 'usage', source: 'engine', costUsd?, usage }` as soon as the engine
    reports spend. Examples: Claude's `result`, codex's rollout (`codex.mjs:879-896`, already
    booked on every exit), OpenCode's `part.cost`, Goose's `complete`.
  - `_bookUsage` books each event as it arrives, never only at success.
  - The audit found two engine PRs that book only on success: #672 (`opencode.mjs:563-615`) and #819
    (`goose.mjs:456-477`). Their rebases emit these events.
  - Today the harness's `_closeOpenTurns` turns unbooked spend into a display-only floor. That floor
    becomes a real booking.
- **Unpriced means cost unknown, never $0.** A message whose model has no price, or a step on an
  engine whose catalog says `cost: false`, sets `step.costKnown = false`. The token counts are still
  booked. Totals that include an unknown part read "≥ $x (part unknown)" in the CLI and chat.
  `runCostLabel` (`engine-switch.mjs:55-59`) and the UI cost cell read the flag. Today an unpriced
  relay message books only its priced part (`run-harness.mjs:7503-7508`), and the step shows
  `(step.costUsd || 0)` (`:7929`). This needs a schema bump: a `cost_known` column on the steps table.
- **Unknown cost and cost caps, for every engine.** A step with `costKnown = false` is treated the
  same on every engine, including `cost: true` engines whose model has no price. With no cost cap
  set, the run start warns once. With a pipeline or total cost cap set, the run refuses at start
  when it can tell already (the engine is `cost: false`, or the model is unpriced). A step that turns
  `costKnown = false` mid-run pauses the run with the cap named.
  - Today only `cost: false` engines get a run-start line (`run-harness.mjs:3157-3163`), and nothing
    refuses.
- #854 already prices every broker call and never books $0 for an unpriced model (**#854**
  `broker/service.mjs`, `broker/usage.mjs`). The ledger reads that figure as `source: 'broker'`.

**Guard test** `test/boundary-ledger.test.mjs`. It fails when anything outside `_bookUsage` calls
`_recordCost`, or when an engine adapter calls `closeEngineRoute`/`closeModelRoute`.

### 4.4 Engine catalog: `ENGINES` in `src/shared/engine-switch.mjs`

**Owner.** `ENGINES` (`engine-switch.mjs:17-22`) becomes the only place an engine's facts live. It
stays import-free and browser-served, and it holds data only, no secrets. New fields per entry:

```js
codex: {
  label, models, cost, helpers, beta,                       // as today
  remote: true,                                             // replaces REMOTE_ENGINES (shared/exec-env.mjs:8)
  env: { names: ['CODEX_HOME', 'OPENAI_ORG_ID', …],         // exact names, no prefixes
         hostOnly: ['CODEX_HOME'], relayOwned: ['CODEX_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'],
         home: { env: 'CODEX_HOME', dir: '.codex' } },      // replaces ENGINE_SANDBOX (policy.mjs:41-52)
  signIn: { modes: [
    { id: 'chatgpt', kind: 'own',  env: ['CODEX_HOME'], files: ['auth.json'] },
    { id: 'api-key', kind: 'key',  env: ['CODEX_API_KEY', 'OPENAI_API_KEY'], brokerSlot: 'openai' } ] },
  relay: { protocol: 'openai', upstream: 'openai', allow: [['POST', '/responses'], ['GET', '/models']],
           modelCheck: 'body', auxModels: [] },
  shell: true,                                              // runs an unrestricted shell (decision 10)
  rules: { Read: 'held', Edit: 'held', Write: 'held', Bash: 'partial', mcp: 'held', WebFetch: 'unverified' },
  subagents: { tool: 'multi_agent', inheritsRules: 'unverified', proof: null },   // codex.mjs:70-77, :276
  requiresExplicitModel: false,
  sessions: 'managed-home',                                 // where the engine keeps run sessions
}
```

- **`rules` is keyed by rule kind**, meaning the permission-rule tool names the gate parses (`Read`,
  `Grep`, `Glob`, `Edit`, `Write`, `Bash`, `WebFetch`, `mcp`). Each value is `held | partial |
  unverified | unenforced`. It describes the engine's *own* tools, and it replaces the per-adapter
  `unenforcedRules`/`partialRules` split *as a declaration*.
  - The adapter's `*RulePlan` (`codex.mjs:120`, `copilot.mjs:136`, `cursor.mjs:92`) still translates
    the rules. The gate now reads the catalog.
  - **Fail closed** (decision 9). A kind the catalog does not list, or lists as `unverified`, counts
    as `unenforced`.
- **"Held" needs a recorded denial, not just a translation** (audit C6). Each `held` kind has two
  fixtures under `test/fixtures/engine-rules/<engine>/`:
  - `<kind>.json`: rules in, expected engine config out. This proves the translation.
  - `<kind>.denial.jsonl`: a captured stream from a real CLI run in which the engine refused the
    action. This proves the denial.

  The catalog test fails on a `held` kind that lacks either fixture. Without a denial capture, a
  kind must be `partial` or `unverified`. Gemini's Grep/Glob (#643 `gemini.mjs:98`, `:111`) is the
  first case: it needs a capture in the #643 rebase, or it drops to `partial`. #643's
  `policy-denied.jsonl` is the model for the file.
- **The gate** reads `ruleSupport(engine, rules)` and refuses without `--allow-unguarded-engine`
  when any of these holds:
  - a deny rule's kind is `unenforced`, `unverified` or unlisted;
  - a deny rule's kind is `partial` (decision 9 makes this explicit for command rules such as
    Codex's prefix rules; today's gate already refuses partial kinds, `engines/index.mjs:42-46`);
  - the engine's sub-agents do not inherit its rules and the sub-agent tool cannot be denied
    (below).
- **One baseline: a shell weakens path rules on every engine** (decision 10). An engine with
  `shell: true` can reach a file through the shell that a `Read`/`Edit`/`Write`/`Grep`/`Glob` rule
  denies to its own tools. That includes Claude.
  - So a run with path rules on a shell engine gets one run-log line:
    `engine <name>: path rules (Read(…), Edit(…)) bind <name>'s own tools; its shell can still reach those paths`.
  - The line never blocks, and it is not a `partial` declaration. It is the same on every shell
    engine, so Qwen's `Edit/Write(path)` and OpenCode's path rules no longer look weaker than
    Claude's.
- **Sub-agents** (decision 11). `subagents.tool` names the engine's sub-agent tool (`Task`,
  `multi_agent`, Qwen's `agent` and `cron_create`), or `null`. `subagents.inheritsRules` is
  `yes | no | unverified`. `yes` needs `proof`: a recorded denial from inside a sub-agent,
  `<engine>/subagent.denial.jsonl`.
  - Unless the value is `yes` with proof, the core denies the sub-agent tool. It does this through
    the adapter's own deny mechanism, for example codex's `--disable multi_agent --disable
    multi_agent_v2` (`codex.mjs:70-77`, already used in Ask lockdown).
  - An engine that cannot deny the tool is refused by the gate without `--allow-unguarded-engine`.
  - This covers Codex sub-agents in pipeline runs, which today keep `multi_agent`, and Qwen's
    `agent`/`cron_create`, which are denied in the #643 rebase.
  - C-SUBAGENT (§5) checks it.
- **Claude is a catalog entry like any other.** `_engineUnenforced`/`_enginePartial`
  (`run-harness.mjs:3256-3271`), the resume gate (`:3298`), the early refusal (`:3364`) and the MCP
  warnings (`:3405`, `:3421`) lose their `name === 'claude'` branch. Claude passes the gate on its
  declarations and fixtures. It gets the same shell baseline line as everyone.
- **Run-start lines every engine gets**, beside the engine gate:
  - **Native is not a sandbox** (decision 4). A local native run logs, and the run page shows:
    `This run executes on this machine as you, not in a sandbox: the agent can read and change what
    you can. Pick Container or E2B to isolate it.`
  - **The host-guard line for every engine.** Today `engine <name>: the host-guard hook does not run
    on <name>` is printed only inside `if (caps.permissionRules !== false)`
    (`run-harness.mjs:3171`, `:3181`), so an engine without permission rules (Goose) gets only the
    generic capability line. It moves out of that block and is printed for every engine without
    `hookTelemetry`/host-guard support.
- **`requiresExplicitModel`** (audit P4a). When true, a step with no model is refused at run start,
  locally and remotely, with `<Label> needs a model; pick one for this step.` This replaces #672's
  adapter-side refusal (`WORCA_OPENCODE_ALLOW_DEFAULT_MODEL`) in the #672 rebase. A `provider`
  column on runs and steps records which provider a model call went to. It shares the schema bump
  with `cost_known` (§4.3).
- **`sessions`** says where the engine keeps run sessions (`managed-home`, `user-store` or `none`).
  When a run is archived (`archivePipeline`, `pipeline-delete.mjs:147`), the core calls the
  adapter's `removeSessions(run)` for `managed-home` and `user-store` engines.
  - Only that run's session files are removed. The sign-in files (`auth.json`, the keychain,
    `~/.claude/.credentials.json`) are never touched.
  - C-SESSIONS (§5) checks both.
- Not all engine-name branches go. Those that are about product behaviour stay, for example the
  helper engine, effort mapping and the title model (`run-harness.mjs:3546-3592`, `:8058`). This
  design removes only the branches that make a security decision. The guard test lists those lines.
- `REMOTE_ENGINES`, `ENGINE_SANDBOX`, `engineCredential`'s switch and `brokerEngineRefusal`'s name
  test are derived from the catalog or deleted. The two equality tests (`test/engine-switch-pause.test.mjs:38`,
  `test/exec-env-config.test.mjs:261`) become one: catalog keys equal the adapter registry minus
  the mock.

**UI from the catalog** (core-4). The engine pickers, effort lists, sign-in text, helper notes and
the `index.html` engine options are built from `ENGINES`, so an engine PR touches no UI file. The
audit counts 42 files shared by the engine PRs today. It lands before the engine PR rebases, or the
conflicts stay.

**Guard test** `test/boundary-catalog.test.mjs`. It fails on `=== 'claude'`, `!== 'claude'`,
`=== 'codex'` (and the rest) in `run-harness.mjs` lines tagged as security gates, in
`exec-env/policy.mjs` and in `broker-client.mjs`. It fails on any engine-name array literal in
`src/` outside the catalog (`['claude', 'codex'`…). It fails on any catalog field that names a
fixture which does not exist.

### 4.5 Conformance suite

See §5. It is the guard for 4.1 to 4.4 together: a new adapter passes it, or CI fails.

### 4.6 Part 2 hooks (secret paths, project mount, egress)

These are built behind the same owners so the later work changes data, not call sites.

- **Secret paths: `src/core/secret-paths.mjs`.**
  - It holds one list: `DEFAULT_SECRET_PATHS` = `.env*`, `*.pem`, `*.key`, `.npmrc`, `.netrc`,
    `id_*`, plus the project's `secretPaths` additions (decision 6). It has one matcher, moved from
    `ask/tools.mjs:290 isProtectedBasename`.
  - `NORMAL_PROTECTED` (`guardrails.mjs:38-44`), `CREDENTIAL_NAMES` (`ask/show-files.mjs:75-90`) and
    `SECURE_PROTECTED_PATHS` (`diff-anchor.mjs:23`) import it, and their extra entries stay as
    those modules' own additions.
  - `overlayFiles` (`git-transfer.mjs:49-66`) drops matching untracked and dirty files from the
    upload and names them once in the run log. A *tracked* secret is already in the git bundle; it
    is warned about, not masked, because masking it would make the sandbox clone differ from git.
  - `maskPlan(projectDir)` returns the paths a container backend must cover with an empty
    read-only file or tmpfs. Nothing calls it until a per-run container exists. The compose bind of
    the whole projects tree (`docker/compose.yml:32`) is documented as unmasked.
- **Per-run project mount (core-5, after core-3).** The container mounts only the run's project, not
  the whole `${WORCA_PROJECTS}` tree (`docker/compose.yml:32`), and covers each `maskPlan` path with
  an empty read-only overlay (decisions 4 and 6). Clone-in (`compose.clonein.yml:16-19`) is already
  the strongest mode and stays. The design of the per-run container is core-5's own doc. This
  design fixes only its inputs: one project path and `maskPlan`.
- **Sandbox egress allowlist, opt-in** (decision 7). This is a project or exec-env setting
  `egress: 'open' | 'allow'`, default `open`.
  - With `allow`, `backends/e2b.mjs:68` passes
    `network: { allowOut: toE2bAllow(list), denyOut: ['0.0.0.0/0'] }` to `Sandbox.create`. The list
    comes from the one owner, `egress-policy.mjs` / `DEFAULT_ALLOW` (`egress-proxy.mjs:37-40`), which
    `compose.egress.yml` (`WORCA_EGRESS_ALLOW`, `:10-14`) already uses. These are the facts checked
    on SDK 2.56.0 against the local Lima E2B (`plans/2026-10-22-e2b-kill-egress-checks.md` §2-3):
    - **Shape.** `allowOut` takes host names, IPs and CIDRs. It takes host names only together with
      `denyOut: ['0.0.0.0/0']`; without it, create fails with a 400. `denyOut` rejects host names.
      `toE2bAllow` maps worca's `.x` to `['x', '*.x']`, because `*.x` does not match the apex. IPs
      and CIDRs pass through unchanged.
    - **Empty list.** An empty list sends `denyOut: ['0.0.0.0/0']` alone.
    - **Errors.** E2B's 400 becomes a `config` error at create, not a lost sandbox.
    - **The relay still works.** It rides the command's stdio and loopback, and loopback works
      under deny-all, so `allow` with an empty list still runs agents.
    - **Enforcement.** Filtering happens outside the guest, so the sandbox user's sudo cannot lift
      it.
  - **What `allow` does not stop.** The UI and docs say E2B `allow` stops casual egress, not a
    determined agent, and name three gaps:
    - Host-name rules match on TLS SNI or the HTTP `Host` header, so a client that names an allowed
      host reaches any IP. compose's forward proxy holds better, so the docs must not call the two
      equivalent.
    - Any host-name rule opens DNS to the sandbox's resolver for every name, which leaves a DNS
      tunnel. An IP-only list does not.
    - ssh on port 22 is blocked, so `git@` remotes fail. HTTPS remotes work.
  - Raw sockets, ICMP and IPv6 do not get out.

## 5. Conformance suite

`test/engine-conformance.test.mjs` runs one parameterised block per catalog entry (`for (const
[name, entry] of Object.entries(ENGINES))`).

- **Binary.** It runs the real adapter against a fake binary, `test/fixtures/fake-engine.mjs`. The
  fake records argv, env, cwd and pgid, spawns a grandchild, and emits that engine's stream
  vocabulary from a per-engine fixture.
- **Sandbox.** Sandbox rows use `e2b-fake.mjs`.
- **Relay.** Relay rows use the loopback upstream fake already used by `test/exec-env-engine-route.test.mjs`.

| Row | Check |
|---|---|
| C-CANARY | A canary value is set under every credential name of every engine, plus `CANARY_TOKEN`, in the server env. It never appears in the child's env, argv, staged files, MCP child env (`mcp/launch.mjs`), or preflight env. Local, broker and sandbox. The one exception is the single name the resolver picked in `direct`/`own` mode; every other name of the same engine is absent. |
| C-ENV-EXACT | The child env has only base names, catalog names, active sign-in names and declared keys. `dropped` names the rest. `COPILOT_ALLOW_ALL` set on the server is in `dropped` for copilot, local and sandbox. |
| C-SIGNIN | §3. Each sign-in mode sees exactly its declared names. Claude subscription works locally (`CLAUDE_CODE_OAUTH_TOKEN` present, `HOME`/`USER` present), under the broker (`wbt_` + slot URL, no OAuth token) and in a sandbox (relay URL + route id, no token). Own sign-ins under the broker are refused with the catalog's wording. |
| C-CEILING | A no-project run's child has `GIT_CEILING_DIRECTORIES` = `dirname(work/)`. A project run's child has `dirname(worktree)`. `PWD` = cwd. |
| C-ARGV | A model `-oProxyCommand=x`, a branch `--upload-pack=x` and an empty model are refused with `errorClass: 'config'` before anything spawns. |
| C-GROUPKILL | An abort kills the fake and its grandchild within `sigkillGraceMs() + 1 s`. Local plain, local agent-user (where available) and sandbox (fake) per step. In the sandbox the model relay command survives the step's kill. A grandchild that calls `setsid` is recorded per engine: if one survives, that engine needs the cgroup mode. |
| C-LEDGER | Relayed: the relay fake answers with usage. The fake engine then exits 0, or exits 1, or hits the turn cap, or is aborted mid-stream. In each case the step's tokens equal the relay's and are booked exactly once. Local: the fake engine emits its engine-reported spend, then takes each of the same four exits, and the step books that spend exactly once. An unpriced model leaves `costKnown === false`, not $0. With a cost cap set, a `costKnown === false` engine or model is refused at start. |
| C-RULES | Each `held` kind has a translation fixture that equals the adapter's rule plan output, and a recorded denial. Each `partial` kind has a translation fixture. The gate refuses `partial`, `unverified`, `unenforced` and unlisted kinds without `--allow-unguarded-engine`. A shell engine with a path rule logs the baseline line and is not refused for it. |
| C-SUBAGENT | An engine whose `subagents.inheritsRules` is not `yes` with proof has its sub-agent tool denied in the spawn (argv or config shows the deny). One that cannot deny it is refused by the gate. An engine that claims `yes` has `subagent.denial.jsonl`. |
| C-SESSIONS | After a run is archived, the fake engine's session files for that run are gone. A fresh run's sign-in check still passes (the sign-in files are untouched). |
| C-MODEL | With `relay.modelCheck: 'body'`, a request naming another model gets a 403 `worca-relay:` refusal. With `'mode'`, the same holds on each relayable sign-in mode's route, where its protocol names the model: the body, or a Gemini call's path. A remote step with no model and no catalog default is refused at start. Locally, a `requiresExplicitModel` engine with no model is refused at start, and the step row records `provider`. |
| C-PREFLIGHT-ENV | The env the fake sees from `preflight` equals the env it sees from `run` for the same spec. |

The suite has one fixture set per engine, `test/fixtures/engines/<name>/` (stream lines, rule
fixtures, sign-in modes). That is the only per-engine test work an engine PR adds.

## 6. Migration order

1. **#854 merges** (git-guard, G13 default guardrails, G14 engine tool approval). This design keeps
   #854's local Copilot allow list (**#854** `copilot.mjs:10-17`) and makes the sandbox path agree.
2. **#826 + relay merges** (`04347487a`). It is the base: `superviseSpawn`'s remote branch
   (`engines/spawn.mjs:176-177`), `openEngineRoute`/`envFor` (`remote-env.mjs:332`, `:587`), and the
   route meter.
3. **Core layer**, as five single-commit PRs on `dev`, in order:
   - **core-1, catalog + child processes.** Catalog fields (§4.4), `src/core/spawn.mjs` (§4.1),
     the conformance harness with C-ENV-EXACT/C-CEILING/C-ARGV/C-GROUPKILL/C-PREFLIGHT-ENV/C-RULES,
     the harness exemption removal, and the guard tests. Plan tasks 1-6, 5b, 5c.
   - **core-2, credentials + ledger.** The resolver (§4.2), the broker slots for Codex, Copilot and
     Cursor, the relay model check, the ledger (§4.3), and C-CANARY/C-SIGNIN/C-LEDGER/C-MODEL. Plan
     tasks 7-11.
   - **core-3, Part 2 hooks** (§4.6). Plan tasks 12-13. It is independent of core-2 and can land
     before it.
   - **core-4, UI from the catalog** (§4.4). Plan task 14. It lands before the engine PR rebases.
   - **core-5, per-run container mount + masks** (§4.6). Plan task 15. It comes after core-3.

   core-1 also carries the gate semantics (decisions 9-11), the shell baseline line, the native and
   host-guard lines, C-SUBAGENT and C-SESSIONS. core-2 carries local spend on every exit, unknown
   cost with caps, `requiresExplicitModel` + `provider`, and the one-named-key rule.
4. **Engine PRs rebase** after core-2 and core-4. Each becomes a catalog entry, an adapter that imports only
   `src/core/spawn.mjs` and `relay-route.mjs`, and `test/fixtures/engines/<name>/`.
   - **#643 Gemini/Qwen.** Two entries. Gemini's Google login is `own`. `remote: false` until a
     `gemini` relay protocol and meter parser exist (follow-up). Qwen's OpenAI-compatible key is
     `relayed` on the `openai` protocol.
   - **#819 Goose.** Provider keys are `relayed` through the provider's protocol. Its per-session MCP
     wrappers spawn through `superviseSpawn`.
   - **#672 OpenCode.** Same as Goose. Its `--pure` config writes go through the catalog's `env.home`.

   A rebase that adds a prefix family, a raw `execFile`, an engine-name branch in the harness or an
   adapter-side route close fails a guard test, not a review. The same goes for the secret-reaching
   paths the audit found in the engine PRs: #643 passes the whole cleaned run env into Gemini/Qwen
   (`gemini-family.mjs:278`), and #819 puts MCP env on goose's own env as `WORCAMCP<i>_*`
   (`goose.mjs:117-119`). `childEnv` and C-CANARY catch both.

   Per engine, the audit adds:
   - #643 denies Qwen's `agent`/`cron_create` (C-SUBAGENT) and records Gemini Grep/Glob denials, or
     marks them `partial`.
   - #672 and #819 emit engine-reported usage events (C-LEDGER local).
   - #672's model refusal moves to `requiresExplicitModel`.
5. **Found in passing; these block the order:**
   - **#826:** `git-transfer.mjs:160-161` runs `git apply --include` with
     `{...process.env, GIT_CEILING_DIRECTORIES}`, not `guardedGitEnv`. This is fixed in #826 itself.
   - **The relay follow-up undoes #854's G14 when it is rebased.** It sits on #826's old base, so
     Copilot still passes `--allow-all-tools` and `/^COPILOT_/` lets `COPILOT_ALLOW_ALL` into
     sandboxes. Rebase it onto the #826-on-#854 commit and take #854's allow list plus exact names.
6. **Follow-ups after the engine rebases:** a `gemini` relay protocol and meter parser, and broker
   slots for Qwen, Goose and OpenCode. Relay spike 2 found every API-key mode of those CLIs
   relayable.

## 7. What changes for users

- Local runs no longer inherit the whole server env. A run log line names what was dropped. A
  project that relied on, say, `AWS_PROFILE` adds it to its env allowlist. The release note says so.
- Local `direct` credentials get one plain warning line per run.
- A Copilot sandbox step with no model is refused instead of silently running `gpt-5-mini`.
- Codex, Copilot (PAT) and Cursor (API key) run under the broker.
- A cost the relay could not price shows as unknown, never $0. With a cost cap set, a run whose cost
  worca cannot count is refused at start.
- Every native run says plainly that it is not a sandbox.
- A run with path rules on a shell engine, Claude included, says the shell can still reach those
  paths.
- An engine whose sub-agents are not proven to inherit its rules runs without its sub-agent tool.
- Archiving a run removes its engine sessions. Sign-ins stay.

## 8. Remaining risks

- The local `direct` default still puts a credential in reach of the agent (decision 4). Only the
  warning is new.
- Cursor's model check is partial, because the model is inside protobuf.
- A sandbox grandchild that starts its own session survives a step's group kill, unless the cgroup
  mode is on (§4.1 item 2). E2B `allow` egress can be bypassed by SNI/Host spoofing and DNS
  tunnelling (§4.6).
- The prefix-to-name move can miss a variable an engine reads. C-SIGNIN and the live tier cover
  sign-in. Other knobs show up in the dropped line and are fixed in the catalog.

## 9. Calls to check before building

- **E2B group kill: answered** (`plans/2026-10-22-e2b-kill-egress-checks.md` §1). See §4.1 item 2.
- **E2B egress API: answered** (same file, §2-3). See §4.6.
- **Sandbox sudo.** `user` has passwordless sudo in `base` and `worca-agent`, so it can leave a
  process group or cgroup. Owner decision: keep it, or drop it from the templates?
- **Leaked stdout on normal exit.** A remote command whose process exits while a background child
  still holds its stdout does not finish until that child exits: `commands.run('sleep 8 & echo x')`
  took 8.0 s. A `RemoteChild` step can then look hung rather than done. The group kill fixes this
  only for stop. Owner decision for a follow-up: after a step's final `result` frame and a grace
  period, should worca group-kill what the step left behind? That also fixes the same case
  locally.
- **Claude Code's small-fast model.** Which model ids does a step really call? Read a relay meter
  `byModel` from a real run, then set Claude's `relay.auxModels`.
- **Broker Copilot slot.** The existing slot is a GitHub device-flow token (`broker/slots.mjs:60`,
  `broker/copilot.mjs`). The sandbox relay accepts only a fine-grained PAT (`policy.mjs:95`,
  `:119-124`). Owner decision: does the broker slot take a PAT, or does the relay accept the
  device-flow token?
- **Local relayed mode.** Should a local run with a worca-held credential relay by default later?
  This design ships it as opt-in only (`relay: 'local'` setting), so decision 4 holds.
