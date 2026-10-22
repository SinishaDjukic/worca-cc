# Core Protection Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each trust boundary one owner (child processes, model credentials, usage ledger, engine
catalog) so that adapters and other call sites stop making security decisions. A guard test fails
on any new copy, and a conformance suite runs over every catalog entry.

**Architecture:** The engine catalog (`ENGINES`, `src/shared/engine-switch.mjs`) becomes the data
source for every engine fact. `src/core/spawn.mjs` (moved from `src/core/engines/spawn.mjs`) owns
child env, argv values, supervision and group kill. `resolveModelRoute` in
`src/core/exec-env/relay-route.mjs` owns credentials. The route meter plus one harness function
`_bookUsage` own spend. Each owner ships with a source-scan guard test.

**Tech Stack:** Node ≥ 22.19 ESM, `node:test`, `tools/test.mjs` tiers, the loopback E2B fake
(`src/core/exec-env/e2b-fake.mjs`), and the relay upstream fake used by `test/exec-env-engine-route.test.mjs`.

**Spec:** [`plans/core-protection-layer-design.md`](core-protection-layer-design.md)

**Base:** `claude/e2b-multi-engine-relay-2343bb` at `04347487a`, after #854 (`5b230160d`) and #826
have merged into `dev`. Rebase this work onto `dev` once both have landed. It ships as five PRs,
each one squashed commit on `dev`:

| PR | Tasks |
|---|---|
| core-1 | Tasks 1-6, including 5b and 5c |
| core-2 | Tasks 7-11 |
| core-3 | Tasks 12-13 (independent of core-2) |
| core-4 | Task 14 (before the engine PR rebases) |
| core-5 | Task 15 (after core-3) |

## Global Constraints

- Owners never branch on an engine name. They read catalog fields only.
- Env allowlists use exact names. No prefix family (`startsWith`, `/^X_/`) appears in any env
  decision.
- The allowlist is always on. `envScrub` no longer gates it. `envAllowlist` adds names on top.
- Every dropped variable is named once per run in one run-log line, in the form
  `env: N variables not passed to <engine> (allowlist): A, B, …`. Names appear, values never do.
- Claude subscription sign-in keeps working:
  - locally (keychain, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`);
  - under the broker (`Bearer` + `anthropic-beta: oauth-2025-04-20`);
  - in a sandbox (the relay prefers OAuth).
- Every other engine's own sign-in keeps working locally with the broker off. It is refused only
  under the broker.
- Local `direct` credentials stay the default. Each run logs one warning line in the form
  `<engine> signs in with <NAME> from worca's environment; the agent can read it. Use a sandbox or
  the credential broker to keep it out.`
- An unpriced model or a `cost: false` engine sets `costKnown = false`. It never books $0 as a
  known cost.
- In `direct`/`own` mode the child env holds exactly one credential name: the one the resolver
  picked.
- A rule kind that is `unverified` or not listed in the catalog counts as `unenforced`. The gate
  refuses `partial`, `unverified`, `unenforced` and unlisted kinds without `--allow-unguarded-engine`.
- `held` needs both a translation fixture and a recorded denial.
- On a `shell: true` engine, Claude included, a run with path rules logs one line that never
  blocks: `engine <name>: path rules (<rules>) bind <name>'s own tools; its shell can still reach those paths`.
- Sub-agents: unless `subagents.inheritsRules === 'yes'` with a recorded denial as proof, the core
  denies the sub-agent tool. An engine that cannot deny it is refused without
  `--allow-unguarded-engine`.
- Every native run logs and shows: `This run executes on this machine as you, not in a sandbox: the
  agent can read and change what you can. Pick Container or E2B to isolate it.`
- With a pipeline or total cost cap set, a run whose cost worca cannot count (a `cost: false`
  engine, or an unpriced model) is refused at start. Without a cap, it warns once.
- Relay refusal messages start with `worca-relay: ` (existing contract).
- Default secret paths are `.env*`, `*.pem`, `*.key`, `.npmrc`, `.netrc` and `id_*`, plus the
  project's `secretPaths` additions.
- Sandbox egress defaults to `open`. `allow` is opt-in.
- Every PR is one commit on `dev`, and no PR branch carries a dev merge.

## Review Focus

Each line is an input class or failure mode that no task's main tests exercise. The test that pins
it lives in the task named.

1. **A Bedrock/Vertex user with `AWS_PROFILE`/`GOOGLE_APPLICATION_CREDENTIALS` in the server env and
   no allowlist.** The run must say exactly what was dropped and how to add it, not fail with an
   opaque auth error. Test `drops cloud vars with a named run-log line` (Task 2).
2. **macOS keychain sign-in for Claude when `HOME` is set but `USER`/`LOGNAME` are not inherited.**
   The keychain lookup must still work. Test `claude keeps HOME, USER, LOGNAME and PATH for every
   sign-in mode` (Task 2).
3. **A stopped step whose agent launched a background dev server (`npm run dev &`).** The server must
   die with the step, locally and in a sandbox. Test `abort kills a backgrounded grandchild` (Task 3).
4. **A model id that came from a catalog entry the user edited (`-c foo`).** It must be refused
   before spawn on every engine, including the helper engine. Test `helper model values go through
   argValue` (Task 3).
5. **A relay stream that breaks mid-reply after usage was sent.** Its tokens must be booked once,
   not zero times and not twice. Test `broken stream books measured tokens once` (Task 10).

---

### Task 1: Extend the engine catalog

**Files:**
- Modify: `src/shared/engine-switch.mjs:6-22` (doc comment + `ENGINES`)
- Modify: `src/shared/exec-env.mjs:8` (`REMOTE_ENGINES` derived)
- Modify: `src/core/exec-env/policy.mjs:36-60` (`ENGINE_SANDBOX`, `engineSandbox` read the catalog)
- Create: `test/fixtures/engine-rules/{claude,codex,copilot,cursor}/<kind>.json` (translation) and
  `<kind>.denial.jsonl` (a recorded denial from a real CLI run, for every `held` kind)
- Test: `test/boundary-catalog.test.mjs` (new)
- Modify: `test/engine-switch-pause.test.mjs:35-38`, `test/exec-env-config.test.mjs:261` (fold into the new test)

**Interfaces:**
- Produces, per `ENGINES[name]`, beside the existing `label`, `models`, `cost`, `helpers`, `beta`:
  - `remote: boolean`
  - `env: { names: string[], hostOnly: string[], relayOwned: string[], home: {env, dir} | null }`
  - `signIn: { modes: Array<{ id: string, kind: 'own'|'key'|'oauth', env: string[], files?: string[], brokerSlot?: string }> }`
  - `relay: { protocol: 'anthropic'|'openai'|'connect', upstream: string, modelCheck: 'body'|'partial', auxModels: string[] } | null`
  - `shell: boolean`
  - `rules: Record<RuleKind, 'held'|'partial'|'unverified'|'unenforced'>`, where `RuleKind` is one of
    the permission-rule tool names the gate parses: `Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash`,
    `WebFetch`, `mcp`. A missing kind means `unenforced`.
  - `subagents: { tool: string|null, inheritsRules: 'yes'|'no'|'unverified', proof: string|null }`.
    `proof` is a path under `test/fixtures/engine-rules/<engine>/`.
  - `requiresExplicitModel: boolean`
  - `sessions: 'managed-home'|'user-store'|'none'`
  - `defaultModel: string | null`
- Produces: `ENGINE_SANDBOX` keeps its shape for callers (`remote-env.mjs:602-610`). It is built
  from `ENGINES[e].env`. `allow` becomes `(k) => names.includes(k)`, and `relayOwned` becomes a
  name test.

- [ ] **Step 1: Write the failing tests** in `test/boundary-catalog.test.mjs`.
  - `catalog keys equal the adapter registry minus mock`: `deepEqual(ENGINE_NAMES, listEngines().map(e => e.name).filter(n => n !== 'mock'))`.
  - `cost flag equals adapter capability`: carried over from `test/engine-switch-pause.test.mjs:35`.
  - `REMOTE_ENGINES is the remote catalog entries`: `deepEqual(REMOTE_ENGINES, ENGINE_NAMES.filter(e => ENGINES[e].remote))`.
  - `env names are exact`: for every entry, every string in `env.names`, `env.relayOwned` and
    `signIn.modes[].env` matches `/^[A-Z][A-Z0-9_]*$/`. There is no RegExp anywhere in `env`.
  - `copilot does not list COPILOT_ALLOW_ALL or COPILOT_ASSISTED_APPROVAL`.
  - `claude declares its subscription sign-in names`: Claude's `signIn.modes` env union ⊇
    `['HOME','USER','LOGNAME','CLAUDE_CONFIG_DIR','CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL']`.
  - `every held or partial rule kind has a translation fixture`: `existsSync(\`test/fixtures/engine-rules/${e}/${kind}.json\`)`.
  - `every held kind has a recorded denial`: `<kind>.denial.jsonl` exists, and the adapter's stream
    parser finds at least one denial event in it.
  - `rule values are known`: every value is in `['held','partial','unverified','unenforced']`.
  - `inheritance needs proof`: when `subagents.inheritsRules === 'yes'`, `subagents.proof` names an
    existing file.
  - `shell engines are declared`: `ENGINES.claude.shell === true`, and so is every engine whose
    adapter grants a shell tool.
- [ ] **Step 2: Run the test and confirm it fails.** Run `node --test test/boundary-catalog.test.mjs`. Expected: FAIL (`remote` undefined).
- [ ] **Step 3: Fill in the catalog entries.**
  - Values come from the design §3 and §4.4. Carry today's facts over:
    - `ENGINE_SANDBOX` lists (`policy.mjs:41-52`): turn each prefix into the exact names that the
      adapter actually reads. Grep each adapter for `env.X` / `'X'` to find them.
    - `CODEX_COMMAND_RULE_REACH` and the per-adapter `partialRules`.
    - Copilot's `defaultModel` is `null`. `gpt-5-mini` is dropped (Task 9).
    - A kind with no recorded denial is `partial` or `unverified`, never `held`. Capture denials
      with `npm run test:live -- --capture-denials <engine>` (added in this task to
      `test/live/run.mjs`). It runs each kind's deny rule against the real CLI and saves the stream.
    - `subagents.inheritsRules` starts as `unverified` for every engine except where a capture
      exists.
  - Write each fixture from the current `*RulePlan` output (`codex.mjs:120`, `copilot.mjs:136`,
    `cursor.mjs:92`, plus the Claude settings deny list). A fixture's shape is
    `{ rules, expected }`.
  - Derive `REMOTE_ENGINES` and `ENGINE_SANDBOX` from the catalog.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `node --test test/boundary-catalog.test.mjs test/exec-env-config.test.mjs test/engine-switch-pause.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git commit -m "feat(engines): engine catalog holds env, sign-in, relay, rule and sub-agent facts"`.

### Task 2: One child env builder

**Files:**
- Move: `src/core/engines/spawn.mjs` to `src/core/spawn.mjs`. Keep `src/core/engines/spawn.mjs` as
  a one-line re-export until Task 4 removes the last importer.
- Modify: `src/core/spawn.mjs`, replacing `buildSpawnEnv`/`composeSpawnEnv` (`:62-109`)
- Modify: `src/core/exec-env/policy.mjs:81-91` (`sandboxEnv` uses catalog names via `childEnv`'s
  remote rules)
- Test: `test/spawn-child-env.test.mjs` (new)

**Interfaces:**
- Consumes: `ENGINES[e].env`, `ENGINES[e].signIn` (Task 1).
- Produces:
  - `childEnv({ kind, engine = null, signInMode = null, cwd, root, runEnv = null, overlay = null, declared = [], allowlist = [], remote = false, hostPid = null, base = process.env }) → { env: Record<string,string>, dropped: string[] }`
    - `kind` is one of `'engine'|'script'|'terminal'|'plugin'|'git'|'preflight'`.
    - `root` is the run's work root. `GIT_CEILING_DIRECTORIES = dirname(root)` is merged with any
      existing value using `path.delimiter`. `PWD = cwd`.
  - `formatDropped(engine, dropped) → string | null`: the run-log line from the Global Constraints,
    or null when `dropped` is empty.
  - `SPAWN_ENV_BASE` (unchanged).

- [ ] **Step 1: Write the failing tests** in `test/spawn-child-env.test.mjs`.
  - `exact names only`: given `base = { PATH:'p', HOME:'h', COPILOT_ALLOW_ALL:'1', COPILOT_HOME:'/c', OPENAI_API_KEY:'k' }`,
    `childEnv({ kind:'engine', engine:'copilot', cwd:'/w', root:'/w' }).env` has no
    `COPILOT_ALLOW_ALL` and no `OPENAI_API_KEY`, and `dropped` includes both.
  - `same answer remote`: the same input with `remote: true` also drops `COPILOT_ALLOW_ALL`
    (regression for `policy.mjs:48`).
  - `ceiling and PWD`: `env.GIT_CEILING_DIRECTORIES === '/runs/r1'` for `root:'/runs/r1/work'`, and
    `env.PWD === cwd`. An existing ceiling `/x` is kept as `'/runs/r1' + delimiter + '/x'`.
  - `claude keeps HOME, USER, LOGNAME and PATH for every sign-in mode`: for each
    `ENGINES.claude.signIn.modes[i].id`, those four survive.
  - `subscription token survives only for its mode`: `CLAUDE_CODE_OAUTH_TOKEN` is kept with
    `signInMode:'oauth-env'`. It is dropped with `signInMode:'relayed'`.
  - `drops cloud vars with a named run-log line`: `formatDropped('claude', ['AWS_PROFILE'])` equals
    `'env: 1 variable not passed to claude (allowlist): AWS_PROFILE'`. An allowlist
    `['AWS_PROFILE']` keeps the variable.
  - `never a host credential or broker secret`: `GH_TOKEN`, `WORCA_BROKER_SECRET` and an E2B key are
    absent even when they are in `allowlist`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test test/spawn-child-env.test.mjs`. Expected: FAIL (no `childEnv` export).
- [ ] **Step 3: Implement `childEnv` and `formatDropped`.**
  - Keep the order `composeSpawnEnv` applies today (`spawn.mjs:98-109`): base, then runEnv, then
    overlay, then `WORCA_HOST_PID`, then strip, then `withNoGitPath`. The allowlist filter runs
    *before* runEnv and overlay, which are declared keys.
  - When `remote` is true, apply `ENGINES[e].env.hostOnly` and `relayOwned` plus the existing
    `HOST_ONLY`/`NEVER`/`SCRIPT_CONTRACT` sets (`policy.mjs:64-75`).
  - `sandboxEnv` becomes `childEnv({ …, remote: true }).env`.
- [ ] **Step 4: Point each engine adapter's env build at `childEnv`.** That is
  `claude.mjs:564-566`, `codex.mjs:786`, `copilot.mjs:624`, `cursor.mjs:462`. Remove the
  `prefixes` argument. The harness logs `formatDropped` once per run beside the engine gate
  (`run-harness.mjs:3142`).
- [ ] **Step 5: Run the tests and confirm they pass.** Run `node --test test/spawn-child-env.test.mjs test/exec-env-config.test.mjs` and then `npm run test:related -- src/core/spawn.mjs`. Expected: PASS.
- [ ] **Step 6: Commit.** Run `git commit -m "feat(spawn): one allowlist child env for every engine, local and remote"`.

### Task 3: Supervision, group kill, argv values, preflight env

**Files:**
- Modify: `src/core/spawn.mjs`, specifically `superviseSpawn` (`:158-312` before the move)
- Modify: `src/core/exec-env/remote-child.mjs:50-75` (`exec setsid -w` + group kill from a second command)
- Modify: `src/core/engines/{claude,codex,copilot,cursor}.mjs`. Change the argv model pushes
  (`claude.mjs:330`, `copilot.mjs:312`, `cursor.mjs:252`) and the preflights (`codex.mjs:665`,
  `:694`, `copilot.mjs:516`, `:555`, `cursor.mjs:392`).
- Modify: `src/core/preflight.mjs:28`
- Create: `test/fixtures/fake-engine.mjs`. It records argv, env, cwd and pgid to `$FAKE_OUT`,
  forks a `sleep 600` grandchild that writes its pid, and replays `$FAKE_STREAM` lines.
- Test: `test/spawn-supervise.test.mjs` (new)

**Interfaces:**
- Consumes: `childEnv` (Task 2).
- Produces:
  - `argValue(value: string, what: string) → string`. It throws an `Error` with
    `errorClass: 'config'` and the message `` `${what} "${value}" cannot start with "-"` ``, or
    `` `${what} is empty` ``.
  - `execCheck(file, args, { spec, timeoutMs }) → Promise<{ code: number|null, stdout: string, stderr: string, error?: Error }>`.
    `spec` is the exact `childEnv` spec the run will use.
  - `superviseSpawn(o)` keeps its signature. A local POSIX child is always `detached`. Abort sends
    `kill(-pid,'SIGTERM')`, and after `sigkillGraceMs()` sends `kill(-pid,'SIGKILL')`.
  - The remote child's `kill()` runs the second command `kill -TERM -- -<remotePid>`. After the
    grace it runs `kill -KILL -- -<remotePid>`, through the env's shell, and then calls
    `handle.kill()` as a backstop. The pgid equals `remotePid`, because the line runs as
    `exec setsid -w <cmd>` (`plans/2026-10-22-e2b-kill-egress-checks.md` §1).

- [ ] **Step 1: Write the failing tests** in `test/spawn-supervise.test.mjs`.
  - `abort kills a backgrounded grandchild`: spawn the fake with `superviseSpawn` and abort after
    its pid file appears. Within `sigkillGraceMs()+1000` ms, `process.kill(grandPid, 0)` throws
    `ESRCH`. Set `WORCA_SIGKILL_GRACE_MS=200`.
  - `abort kills a sandbox grandchild per step`: the same through `e2b-fake.mjs` and a
    `RemoteChild`. The sandbox stays up afterwards (`env.lost === false`), and the relay command is
    still running.
  - `remote line runs under setsid`: the fake SDK records the command line, which starts
    `exec setsid -w `. The stop commands are `kill -TERM -- -<pid>`, then `kill -KILL -- -<pid>`.
  - `argValue refuses flags`: `throws(() => argValue('-oProxyCommand=x','model'), { errorClass:'config' })`.
    `argValue('','model')` throws. `argValue('gpt-5','model') === 'gpt-5'`.
  - `helper model values go through argValue`: a source scan of `src/core/engines/*.mjs` finds no
    `push('--model', ` that is not followed by `argValue(`.
  - `preflight env equals run env`: run `codexPreflight` and a codex run against the fake, using
    the same spec. The recorded env objects are `deepEqual`, ignoring `WORCA_HOST_PID`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test test/spawn-supervise.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement the changes.**
  - Group kill in `superviseSpawn`. Keep the agent-user `killAgentGroup` branch (`spawn.mjs:215`).
  - The remote command line becomes `exec setsid -w <cmd>`, keeping the existing `< stdinFile`
    redirect. There is no pgid file. Never signal envd's default group.
  - Add `argValue` at the argv sites.
  - Add `execCheck`, and convert every preflight to it with the adapter's run spec. Adapters gain a
    `spawnSpec(opts)` helper that both `run` and `preflight` call.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `node --test test/spawn-supervise.test.mjs` and then `npm run test:related -- src/core/spawn.mjs src/core/exec-env/remote-child.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git commit -m "feat(spawn): group kill everywhere, argv value guard, preflight on the run env"`.

### Task 4: Move scripts, terminal, plugin children and workspace-map git onto the owner

**Files:**
- Modify: `src/core/graph/script-runner.mjs` (`:10` import; `:214-218` `scriptBaseEnv`; `:316`, `:356-362` spawn/kill)
- Modify: `src/core/terminal/pty.mjs:5` and `src/core/terminal/context.mjs:62-85` (env via `childEnv({kind:'terminal'})`)
- Modify: `src/core/plugin-shim.mjs:15,118-129,218-220`, `src/core/chat/channel-host.mjs:18,243-245,526`, `src/core/plugin-store.mjs:9,281,286`
- Modify: `src/core/workspace-map/files.mjs:7,73-77`, `src/core/workspace-map/detectors/git-submodules.mjs:7,20-22`
- Modify: `src/core/spawn.mjs`. Add `runCapture(file, args, { spec, cwd, timeoutMs, maxBuffer, input })`
  for one-shot commands, built on `execFile` and `childEnv`.
- Delete: the `src/core/engines/spawn.mjs` re-export
- Test: `test/boundary-child-process.test.mjs` (new)

**Interfaces:**
- Consumes: `childEnv`, `superviseSpawn`, `execCheck` (Tasks 2-3).
- Produces: `runCapture(...) → Promise<{ code, stdout, stderr }>`, and the frozen `RATCHET` list in
  the test.

- [ ] **Step 1: Write the failing tests** in `test/boundary-child-process.test.mjs`.
  - `only spawn.mjs and the ratchet import child_process`: walk `src/**/*.mjs` and `ui/server.mjs`,
    and match `/from ['"](node:)?child_process['"]|import\(['"](node:)?child_process['"]\)/`. The
    set of importers must equal `new Set(['src/core/spawn.mjs', ...RATCHET])`.
    - `RATCHET` is today's inventory, minus the files this task moves: `worktree.mjs`, `git-lock.mjs`,
      `run-harness.mjs`, `git-info.mjs`, `git-sync.mjs`, `workspace-import.mjs`, `workspaces.mjs`,
      `store.mjs`, `mcpjson-approval.mjs`, `script-bench.mjs`, `run-context.mjs`, `checkout.mjs`,
      `project-create.mjs`, `clone-project.mjs`, `git-available.mjs`, `metrics/sync.mjs`,
      `metrics/prs.mjs`, `skills-registry/import.mjs`, `terminal/worktrees.mjs`,
      `exec-env/git-transfer.mjs`, `exec-env/e2b-fake.mjs`, `agent-user.mjs`, `actions/spawn.mjs`,
      `actions/registry.mjs`, `mcp/launch.mjs`, `mcp/test.mjs`, `keep-awake.mjs`,
      `folder-dialog.mjs`, `graph/python-probe.mjs`, `plugin-repo.mjs`, `plugin-inventory.mjs`,
      `marketplace-publish.mjs`, `cli/extension.mjs`, `cli/container.mjs`, `cli/worca-cc.mjs`,
      `ui/server.mjs`.
    - Each entry carries a comment naming its owner-to-be: git-guard for git, spawn for the rest.
  - `the ratchet only shrinks`: every `RATCHET` file still imports child_process, so a stale entry
    fails.
  - `no raw env in engines`: `src/core/engines/*.mjs` contains none of `buildSpawnEnv(`,
    `...process.env`, `env: process.env`.
  - `workspace-map git has a ceiling`: `gitOutput(dir, ['rev-parse','--show-toplevel'])` run on a
    fixture dir nested in a repo returns null.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test test/boundary-child-process.test.mjs`. Expected: FAIL. The listed files still import child_process directly.
- [ ] **Step 3: Move each caller onto the owner.**
  - script-runner keeps its `live` reaper and Windows `taskkill` path by passing them through
    `superviseSpawn` options. Do not fork a second supervisor.
  - The plugin children's env becomes `childEnv({ kind:'plugin' })`, with PATH and HOME exactly as
    `scrubbedEnv` gives today.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `node --test test/boundary-child-process.test.mjs` and then `npm run test:fast`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git commit -m "refactor(spawn): scripts, terminal, plugin children and workspace-map git spawn through the owner"`.

### Task 5: Remove the harness's Claude exemptions

**Files:**
- Modify: `src/core/run-harness.mjs`:
  - `_engineUnenforced`/`_enginePartial` (`:3256-3271`)
  - resume gate (`:3298`)
  - early refusal (`:3364`)
  - MCP warnings and refusal (`:3405`, `:3421`)
  - `_engineRefusal` (`:3207-3255`)
- Modify: `src/core/engines/index.mjs:42-60` (`unenforcedRules`/`partialRules` derived from catalog
  `rules` plus the adapter's `*RulePlan`)
- Modify: `src/core/run-harness.mjs:3150-3185` (run-start lines: the shell baseline line, the native
  line, and the host-guard line moved out of `if (caps.permissionRules !== false)` at `:3171`/`:3181`)
- Modify: the run page's engine notice (the UI file that renders the run-start lines) to show the
  native line
- Test: extend `test/boundary-catalog.test.mjs`, `test/engine-gate.test.mjs`

**Interfaces:**
- Consumes: `ENGINES[e].rules`, `ENGINES[e].shell`, the rule fixtures (Task 1).
- Produces:
  - `ruleSupport(engine, rules) → { refused: string[], partial: string[], shellPaths: string[] }` in
    `src/core/engines/index.mjs`. It is the one function the gate reads. `refused` holds the
    unenforced, unverified and unlisted kinds; `partial` holds the partial kinds (refused too,
    without the flag); `shellPaths` holds the path rules covered by the baseline line.
  - `NATIVE_NOTICE`: the native line from the Global Constraints, exported from
    `src/shared/engine-switch.mjs` for the CLI and the UI.

- [ ] **Step 1: Write the failing tests.**
  - In `test/boundary-catalog.test.mjs`, `no security gate names an engine`: the gate method bodies
    `_engineRefusal`, `_engineUnenforced`, `_enginePartial`, `_engineChecks`, the resume gate and the
    early refusal are extracted by name with a small brace-matching helper. They contain no
    `'claude'`, `'codex'`, `'copilot'` or `'cursor'` literal.
  - In `test/engine-gate.test.mjs`, `claude passes the gate on its declaration`: temporarily set
    `ENGINES.claude.rules.WebFetch = 'unverified'` (through a test seam that clones the catalog).
    The gate then refuses a `WebFetch` deny rule without `--allow-unguarded-engine`.
  - `unlisted kind fails closed`: a deny rule `Foo(x)` on any engine is refused without the flag.
  - `partial command rule is refused`: a codex run with `Bash(rm:*)` denied and no flag throws
    `engineRefusal`. With the flag it starts, and the log names the rule as partial.
  - `shell baseline line, never a block`: Claude with `Read(./secrets/**)` denied starts, and the
    log contains exactly one line matching `/^engine claude: path rules .* its shell can still reach those paths$/`.
  - `native line`: a local native run logs `NATIVE_NOTICE`. An E2B run does not.
  - `host-guard line without permission rules`: with the host guard on and a cloned catalog entry
    whose adapter has `permissionRules: false`, the log has `the host-guard hook does not run on`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test test/boundary-catalog.test.mjs test/engine-gate.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement `ruleSupport`, and make the gate methods call it.** Product branches
  (`:3546-3592`, `:8058`) stay unchanged.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `node --test test/engine-gate.test.mjs test/copilot-engine-gate.test.mjs test/boundary-catalog.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git commit -m "refactor(harness): engine gate reads the catalog, Claude is no longer exempt by name"`.

### Task 5b: Deny the sub-agent tool unless inheritance is proven

**Files:**
- Modify: `src/core/run-harness.mjs` (the engine gate and the spawn options it hands adapters)
- Modify: `src/core/engines/index.mjs`. Each adapter exports `denySubagentTool(spawnOpts) → spawnOpts | null`.
  It returns null when the engine cannot deny the tool.
- Modify: `src/core/engines/codex.mjs`. Add `--disable multi_agent --disable multi_agent_v2` for
  pipeline runs, the same flags as `CODEX_ASK_LOCKDOWN` (`codex.mjs:70-77`).
- Modify: `src/core/engines/copilot.mjs`, `cursor.mjs` (their sub-agent tools, per catalog `subagents.tool`)
- Test: `test/engine-subagents.test.mjs` (new)

**Interfaces:**
- Consumes: `ENGINES[e].subagents` (Task 1) and `ruleSupport` (Task 5).
- Produces: `subagentPolicy(engine) → 'allow'|'deny'|'refuse'`. It returns `allow` only when
  `inheritsRules === 'yes'` and `proof` exists. It returns `deny` when the adapter's
  `denySubagentTool` is not null, and `refuse` otherwise.

- [ ] **Step 1: Write the failing tests.**
  - `codex pipeline denies multi_agent`: a codex pipeline spawn's argv contains
    `--disable multi_agent` and `--disable multi_agent_v2`.
  - `proven inheritance keeps the tool`: a cloned catalog with
    `{ inheritsRules:'yes', proof:'codex/subagent.denial.jsonl' }` and the file present gives argv
    without the flags.
  - `cannot deny means refuse`: a cloned adapter whose `denySubagentTool` returns null makes the
    gate refuse without `--allow-unguarded-engine`. The message names the sub-agent tool.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test test/engine-subagents.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement `subagentPolicy` and each adapter's `denySubagentTool`.**
- [ ] **Step 4: Run the tests and confirm they pass.** Run `node --test test/engine-subagents.test.mjs test/codex-guardrails-subagents.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git commit -m "feat(engines): deny the sub-agent tool unless the catalog proves rules reach sub-agents"`.

### Task 5c: Remove a run's engine sessions when it is archived

**Files:**
- Modify: `src/core/pipeline-delete.mjs:147` (`archivePipeline`)
- Modify: `src/core/engines/index.mjs`. Each adapter whose catalog `sessions` is not `none` exports
  `removeSessions(run) → Promise<string[]>`, which returns the paths it removed.
- Modify: `src/core/engines/{claude,codex,copilot,cursor}.mjs`
- Test: `test/engine-sessions-archive.test.mjs` (new)

**Interfaces:**
- Consumes: `ENGINES[e].sessions` (Task 1).
- Produces: `removeRunSessions(run) → Promise<{ engine: string, removed: string[] }>`, called once by
  `archivePipeline`.

- [ ] **Step 1: Write the failing tests.**
  - `archive removes this run's sessions only`: for each engine, under a temp HOME with two runs'
    session files, archiving run A removes A's files and leaves B's.
  - `sign-in files survive`: the engine's sign-in files under the temp HOME (`auth.json`,
    `.credentials.json` and similar) are byte-identical before and after.
  - `archive still succeeds when removal fails`: a read-only session dir logs one warning, and the
    archive completes.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test test/engine-sessions-archive.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement `removeSessions` per adapter, and `removeRunSessions`.** Never follow
  links out of the session dir. Use `isWithin` (`fs-scope.mjs`).
- [ ] **Step 4: Run the tests and confirm they pass.** Run `node --test test/engine-sessions-archive.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git commit -m "feat(engines): archiving a run removes its engine sessions, never the sign-in"`.

### Task 6: Conformance suite, part 1 (process rows)

**Files:**
- Create: `test/engine-conformance.test.mjs`
- Create: `test/fixtures/engines/<name>/stream.jsonl` for each catalog entry (taken from the existing
  adapter tests' captured lines)

**Interfaces:**
- Consumes: everything from Tasks 1-5, and `test/fixtures/fake-engine.mjs`.
- Produces: `conformanceRow(name, title, fn)`. Task 11 adds rows with it.

- [ ] **Step 1: Write the rows** C-ENV-EXACT, C-CEILING, C-ARGV, C-GROUPKILL, C-PREFLIGHT-ENV,
  C-RULES, C-SUBAGENT and C-SESSIONS (design §5). Write each as `for (const e of ENGINE_NAMES) test(\`${e}: ${row}\`, …)`, with
  the assertions from the design table. C-GROUPKILL covers local plain and sandbox (fake).
- [ ] **Step 2: Run them.** Run `node --test test/engine-conformance.test.mjs`. Expected: PASS for all four engines. A failure here is a gap in Tasks 2-5: fix it there.
- [ ] **Step 3: Register the file in the fast tier.** That means `tools/test.mjs`'s tier list, if
  the tier is not inferred.
- [ ] **Step 4: Commit.** Run `git commit -m "test(engines): conformance suite over every catalog entry (process rows)"`, then squash Tasks 1-6 into the core-1 PR.

### Task 7: Route resolver

**Files:**
- Modify: `src/core/exec-env/relay-route.mjs`. Add `resolveModelRoute`. `remoteModelRoute`
  (`:45-89`) and `engineModelRoute` (`:278-284`) become internal helpers it calls.
- Modify: `src/core/exec-env/policy.mjs:100-131`. `engineCredential` reads `ENGINES[e].signIn` and
  moves into `relay-route.mjs`. `policy.mjs` re-exports it for one release.
- Modify: `src/core/broker-client.mjs:23-29` (`brokerEngineRefusal` derived)
- Modify: `src/core/exec-env/remote-env.mjs:302-345`. `openModelRoute`/`openEngineRoute` take a
  resolved `Route`.
- Modify: the adapters. They call `resolveModelRoute` once per spawn and pass `route.signInMode` to
  `childEnv`.
- Test: `test/route-resolver.test.mjs` (new), `test/broker-engines.test.mjs`

**Interfaces:**
- Consumes: `ENGINES[e].signIn`, `ENGINES[e].relay` (Task 1), and `childEnv({ signInMode })` (Task 2).
- Produces:
  - `resolveModelRoute({ engine, model, remote, serverEnv, broker: { on, slots } , spawnEnv, endpoint }) → { kind: 'relayed'|'brokered'|'own'|'direct', signInMode: string, warning: string|null, route?: object, refusal?: string }`
    - `route` has today's route shape (`relay-route.mjs:156-161`) plus `models: string[]`.
    - `refusal` is set when the run cannot sign in under this mode. Its wording reuses today's
      problems (`policy.mjs:111-129`) and the broker text (`broker-client.mjs:28`).
  - `brokerEngineRefusal(engine, env)` keeps its signature. It returns non-null only when every
    sign-in mode of the engine is `kind: 'own'` or has no `brokerSlot`.

- [ ] **Step 1: Write the failing tests** in `test/route-resolver.test.mjs`.
  - `local, broker off, keychain claude is own`: with an empty serverEnv,
    `resolveModelRoute({ engine:'claude', remote:false, broker:{on:false} }).kind === 'own'`.
  - `local OAuth env claude is direct with a warning`: with
    `serverEnv:{CLAUDE_CODE_OAUTH_TOKEN:'t'}`, the kind is `'direct'` and `warning` matches the
    Global Constraints line.
  - `sandbox claude prefers OAuth`: with both credentials set, `route.secrets[0] === 't'` and the
    route's `authHeaders({})['anthropic-beta']` includes `'oauth-2025-04-20'`.
  - `broker on, codex API key slot is brokered`: `broker:{on:true, slots:['openai']}` gives
    `kind === 'brokered'`.
  - `broker on, codex ChatGPT sign-in is refused`: `broker:{on:true, slots:[]}` gives a `refusal`
    that matches `/signs in with its own credentials/`.
  - `sandbox own-sign-in is refused`: `engine:'codex', remote:true`, with no key, gives a `refusal`
    equal to today's `policy.mjs:118` text.
  - `exactly one named key`: with `serverEnv:{CODEX_API_KEY:'a', OPENAI_API_KEY:'b'}` locally, the
    result names `signInMode` for `CODEX_API_KEY` only. `childEnv` with that mode keeps
    `CODEX_API_KEY` and drops `OPENAI_API_KEY`.
  - In `test/broker-engines.test.mjs`: `brokerEngineRefusal('codex')` is null when an `openai` slot
    exists, and `brokerEngineRefusal('cursor')` is non-null until Task 8 adds the slot.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test test/route-resolver.test.mjs test/broker-engines.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement `resolveModelRoute`, then rewire the adapters and both route openers.**
  Under `brokered`, a local spawn gets the slot base URL (`broker-client.mjs:184 slotBaseUrl`) and
  its `wbt_` token, as `runViaBroker` (`claude.mjs:871-874`) does. Generalise `runViaBroker` into a
  shared helper and do not copy it.
- [ ] **Step 4: Add the credential guard** to `test/boundary-credentials.test.mjs`. Outside
  `src/core/exec-env/relay-route.mjs` and `src/broker/`, no source file under `src/core/engines/`,
  `src/core/run-harness.mjs` or `src/core/exec-env/remote-env.mjs` reads any name in any
  `signIn.modes[].env` or `env.relayOwned` through `.NAME` or `['NAME']`.
- [ ] **Step 5: Run the tests and confirm they pass.** Run `node --test test/route-resolver.test.mjs test/boundary-credentials.test.mjs test/exec-env-engine-route.test.mjs test/exec-env-model-relay.test.mjs`. Expected: PASS.
- [ ] **Step 6: Commit.** Run `git commit -m "feat(credentials): one route resolver decides how every model call is signed"`.

### Task 8: Broker slots for Codex, Copilot and Cursor

**Files:**
- Modify: `src/broker/slots.mjs:33-82`. The `openai` slot is reused for Codex. Add a `cursor` slot
  (protocol `connect`, auth `cursor-exchange`). Add a `copilot-pat` auth style for a fine-grained
  PAT; this depends on the owner's answer to design §9.
- Modify: `src/broker/service.mjs`. Add the `cursor-exchange` auth. Move the key-to-token exchange
  out of `relay-route.mjs:224-248` into `src/broker/cursor.mjs`, and have `relay-route.mjs` import
  it, so one copy remains.
- Test: `test/broker-slots-engines.test.mjs` (new)

**Interfaces:**
- Consumes: `resolveModelRoute` (Task 7).
- Produces: `cursorAccessToken({ apiKey, origin, fetchImpl, now, cache, secrets }) → Promise<string>`,
  exported from `src/broker/cursor.mjs`. It is the same contract as today's `cursorToken`.

- [ ] **Step 1: Write the failing tests.**
  - `cursor slot exchanges the key once per expiry`: against a fake upstream, two calls within the
    expiry make one `POST /auth/exchange_user_api_key`.
  - `copilot slot refuses a classic token`: `ghp_…` is refused with the `policy.mjs:122` wording.
  - `codex through the openai slot books spend per person`: a fake Responses reply with usage
    yields one `usage.mjs` row whose `bill_to` is the spawn's.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test test/broker-slots-engines.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement the slots and the shared exchange.**
- [ ] **Step 4: Run the tests and confirm they pass.** Run `node --test test/broker-slots-engines.test.mjs test/broker-engines.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git commit -m "feat(broker): Codex, Copilot (PAT) and Cursor sign in through broker slots"`.

### Task 9: Model check at the relay; drop Copilot's hidden default

**Files:**
- Modify: `src/core/exec-env/model-relay.mjs:291-307`. After `allows()`, check `route.models` for
  protocols with `modelCheck: 'body'`.
- Modify: `src/core/engines/copilot.mjs:53,612-617`. Delete `COPILOT_REMOTE_DEFAULT_MODEL`.
- Modify: `src/core/run-harness.mjs` engine gate. Refuse a remote step with no model and no catalog
  `defaultModel`. Refuse a local step with no model on an engine whose `requiresExplicitModel` is
  true.
- Modify: `src/core/db.mjs`. Add a `provider` column on runs and steps, in the same schema bump as
  Task 10's `cost_known`. Land Task 9 and Task 10's migration together.
- Test: extend `test/exec-env-model-relay.test.mjs`, `test/copilot-adapter.test.mjs`

**Interfaces:**
- Consumes: `route.models` (Task 7) and `ENGINES[e].relay.auxModels`/`defaultModel` (Task 1).
- Produces: the refusal body `worca-relay: model "<m>" is not this step's model`, with status 403
  and type `permission_error`, in the route protocol's shape (`refusalBody`, `model-relay.mjs:95`).

- [ ] **Step 1: Write the failing tests.**
  - `relay refuses another model`: a route with `models:['claude-haiku-4-5']` sent
    `{"model":"claude-opus-4"}` answers 403, and the body's message starts `worca-relay: model "claude-opus-4"`.
  - `relay passes aux models`: a model listed in `auxModels` answers 200 from the upstream fake.
  - `relay passes a body it cannot parse only on partial routes`: a `connect` route forwards. An
    `openai` route answers 400 `worca-relay: the request body is not JSON`.
  - `remote copilot without a model is refused at start`: the gate error equals
    `Copilot in a sandbox needs a model; pick one for this step.`
  - `requiresExplicitModel refuses locally`: with a cloned catalog entry where it is true, a local
    step with no model is refused with `<Label> needs a model; pick one for this step.`
  - `provider is recorded`: a step run through the Copilot route stores `provider = 'copilot'` on
    its step row.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test test/exec-env-model-relay.test.mjs test/copilot-adapter.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Parse only up to `MAX_REQUEST_BYTES`, which is already enforced at
  `:296`. Read the top-level `model` string.
- [ ] **Step 4: Run the tests and confirm they pass.** Same command as Step 2. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git commit -m "feat(relay): check each call's model against the step's; Copilot has no hidden sandbox default"`.

### Task 10: Usage ledger on every exit path

**Files:**
- Modify: `src/core/exec-env/remote-env.mjs:340-360`. Drop the `cost` option.
  `meteredEvents`/`closeEngineRoute`/`closeModelRoute` emit `{ type:'usage', source:'relay', messages, byModel }`.
- Modify: `src/core/spawn.mjs`. `superviseSpawn` accepts `route` and closes it in its single
  `cleanup`.
- Modify: `src/core/engines/{claude,codex,copilot,cursor}.mjs`. Remove adapter-side route closes
  (`claude.mjs:646-653`, `codex.mjs:872,911`, `copilot.mjs:660,682,724`, `cursor.mjs:475,550`).
- Modify: `src/core/run-harness.mjs:7420-7510`. Add `_bookUsage(e, attr)`, which replaces
  `_relayedCost` and `_onRelayCostEvent`. Change `_costStep` at `:7927-7930` to keep `costKnown`.
- Modify: `src/core/db.mjs`. Bump the schema: a `cost_known INTEGER NOT NULL DEFAULT 1` column on
  steps, with a migration and its test.
- Modify: `src/shared/engine-switch.mjs:55-59` (`runCostLabel(engine, costUsd, fmt, known = true)`),
  and the UI cost cell
- Modify: the adapters. Emit `{ type:'usage', source:'engine', costUsd?, usage }` as soon as the
  engine reports spend, and stop holding it until success. Today Claude's comes from `result`,
  and codex's rollout settle (`codex.mjs:879-896`) already runs on every exit.
- Modify: `src/core/run-harness.mjs:3157-3163`. The cost-cap check covers every engine and every
  unpriced model: with a cap set it refuses at start, and without one it warns once. Mid-run, a
  step whose `costKnown` turns false under a cap pauses the run.
- Test: `test/usage-ledger.test.mjs` (new), `test/boundary-ledger.test.mjs` (new)

**Interfaces:**
- Consumes: the route meter (`relay-usage.mjs:196-233`).
- Produces: `_bookUsage({ source: 'relay'|'engine'|'broker', costUsd?, messages?, byModel?, usage? }, attr) → void`
  and `step.costKnown: boolean`.

- [ ] **Step 1: Write the failing tests.**
  - `test/usage-ledger.test.mjs`, one test per exit, for `copilot` and `cursor`: exit 0, exit 1,
    turn cap and abort mid-stream. The relay fake sends usage `{input_tokens: 100, output_tokens: 20}`.
    The step's booked tokens equal `{100, 20}` exactly once, with no `result` frame needed.
  - `broken stream books measured tokens once`: the upstream fake sends usage and then destroys the
    socket. Tokens are booked once.
  - `unpriced model is cost unknown`: `byModel: { 'mystery-model': usage }` with no rates gives
    `step.costKnown === false`, and the CLI label is `cost unknown`, not `$0.00`.
  - `local spend survives every exit`: the fake engine emits a `usage` event with `costUsd: 0.12`,
    then exits 0, exits 1, hits the turn cap, or is aborted. In each case the step books `0.12`
    once.
  - `cost cap refuses unknown cost`: with `pipelineCostLimitUsd` set, a run on a `cost: false` engine
    is refused at start, and so is a run on a `cost: true` engine whose model has no price. Without
    a cap, both start with one warning line.
  - `test/boundary-ledger.test.mjs`: no file under `src/core/engines/` calls `closeEngineRoute(` or
    `closeModelRoute(`. Only `_bookUsage` calls `_recordCost(` in `run-harness.mjs`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test test/usage-ledger.test.mjs test/boundary-ledger.test.mjs`. Expected: FAIL. Copilot drops tokens on exit 1 (`copilot.mjs:724` has no `cost`).
- [ ] **Step 3: Implement.** Keep `_relayedCost`'s policy: the relay wins over the sandbox figure,
  a gap of more than 25% is logged, and with an unpriced model the result is
  `max(cli, measured)` (`run-harness.mjs:7486-7497`). The only change is that `costKnown` turns
  false instead of the step silently holding a partial figure.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `node --test test/usage-ledger.test.mjs test/boundary-ledger.test.mjs test/exec-env-relay-cost.test.mjs test/engine-cost.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git commit -m "feat(ledger): book relay-measured spend on every exit path; unpriced is cost unknown"`.

### Task 11: Conformance suite, part 2 (credential rows)

**Files:**
- Modify: `test/engine-conformance.test.mjs`
- Modify: `test/live/run.mjs`. Add the live rows Claude-subscription-local, -broker and -sandbox,
  which use the local Lima E2B.

**Interfaces:**
- Consumes: `conformanceRow` (Task 6), `resolveModelRoute` (Task 7), `_bookUsage` (Task 10).

- [ ] **Step 1: Write the rows** C-CANARY, C-SIGNIN, C-LEDGER and C-MODEL (design §5).
  - C-CANARY sets `CANARY_9f3a…` under every name in every catalog `signIn.modes[].env` and
    `env.relayOwned`, plus `CANARY_TOKEN`. It asserts the value appears in none of the fake's
    recorded env, argv, staged files, MCP child env or preflight env, in local, broker (fake broker
    from `test/broker-*.test.mjs`) and sandbox modes. The one allowed exception is the single name
    the resolver picked in `direct`/`own` mode. Every other credential name of the same engine is
    absent.
  - C-LEDGER covers the relayed and the local exits (design §5). C-MODEL covers the local
    `requiresExplicitModel` refusal and the `provider` column.
  - C-SIGNIN runs per declared mode, as specified in design §3.
- [ ] **Step 2: Run them.** Run `node --test test/engine-conformance.test.mjs`. Expected: PASS.
- [ ] **Step 3: Run the live tier for Claude.** Run `npm run test:live -- --only claude-signin`. Expected: three passes. Record the run ids in the PR description.
- [ ] **Step 4: Commit.** Run `git commit -m "test(engines): conformance credential, sign-in, ledger and model rows"`, then squash Tasks 7-11 into the core-2 PR.

### Task 12: Secret-path owner and the upload overlay

**Files:**
- Create: `src/core/secret-paths.mjs`
- Modify: `src/core/ask/tools.mjs:290`. Move `isProtectedBasename` to `secret-paths.mjs` and
  re-export it.
- Modify: `src/core/guardrails.mjs:38-44`, `src/core/ask/show-files.mjs:75-90`,
  `src/core/diff-anchor.mjs:19-23`. Build each list from `DEFAULT_SECRET_PATHS` plus that module's
  own additions.
- Modify: `src/core/exec-env/git-transfer.mjs:49-66`, specifically `overlayFiles`.
- Modify: the project settings schema. Add `secretPaths: string[]`.
- Test: `test/secret-paths.test.mjs` (new; no test covers `overlayFiles` today, so its overlay cases live here)

**Interfaces:**
- Produces:
  - `DEFAULT_SECRET_PATHS: readonly string[]`, equal to
    `['.env*', '*.pem', '*.key', '.npmrc', '.netrc', 'id_*']`
  - `secretPathsFor(project) → string[]`: the defaults plus the project's `secretPaths`
  - `isSecretPath(rel, patterns) → boolean`: the semantics of `isProtectedBasename`
  - `maskPlan(projectDir, patterns) → Promise<string[]>`: relative paths that exist and match
  - `overlayFiles(...)`, which now returns `{ files, mounts, deleted, masked: string[], trackedSecrets: string[] }`

- [ ] **Step 1: Write the failing tests.**
  - `defaults`: `isSecretPath('a/b/.env.local')`, `isSecretPath('id_ed25519')`,
    `isSecretPath('deploy/key.pem')` and `isSecretPath('.npmrc')` are true, and
    `isSecretPath('src/env.ts')` is false.
  - `project additions`: `secretPathsFor({ secretPaths: ['*.tfvars'] })` includes `'*.tfvars'`.
  - `overlay drops untracked secrets`: in a fixture repo with an untracked `.env` and `a.txt`,
    `overlayFiles` gives `files` that do not include `.env`, `masked` equal to `['.env']`, and a
    run-log line `sandbox upload: 1 secret file kept on this machine: .env`.
  - `tracked secret is warned about, not masked`: a committed `.env` lands in `trackedSecrets`.
  - `one list`: a source scan finds the literal `'*.pem'` only in `src/core/secret-paths.mjs`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test test/secret-paths.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement it, and log `masked`/`trackedSecrets` from `remote-env.mjs _overlay` (`:376-391`).**
- [ ] **Step 4: Run the tests and confirm they pass.** Run `node --test test/secret-paths.test.mjs` and then `npm run test:related -- src/core/exec-env/git-transfer.mjs src/core/guardrails.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git commit -m "feat(secrets): one secret-path list for guardrails, chat, diffs and the sandbox upload"`.

### Task 13: Opt-in sandbox egress allowlist

**Facts** (checked on SDK 2.56.0, `plans/2026-10-22-e2b-kill-egress-checks.md` §2-3):
- Host names in `allowOut` need `denyOut: ['0.0.0.0/0']`. `denyOut` rejects host names.
- `*.x` does not match the apex `x`.
- Any other shape gets a 400 at create.

**Files:**
- Modify: `src/core/exec-env/backends/e2b.mjs:68`. Pass `network` when the env's `egress` is `allow`.
- Modify: `src/core/egress-policy.mjs`. Export
  `sandboxEgress(project) → { allowOut, denyOut } | null`, built from `DEFAULT_ALLOW`
  (`egress-proxy.mjs:37-40`) and `WORCA_EGRESS_ALLOW`/`WORCA_EGRESS_DENY`. Also export
  `toE2bAllow(list)`, which maps `.x` to `x` + `*.x` and keeps IPs/CIDRs.
  - `denyOut` is always `['0.0.0.0/0']`.
  - A host-name entry in `WORCA_EGRESS_DENY` removes that host from `allowOut`, because E2B's
    `denyOut` rejects names. IP and CIDR denies go into `denyOut` as they are.
- Modify: the exec-env settings schema. Add `egress: 'open' | 'allow'`, default `'open'`.
- Test: `test/egress-policy.test.mjs`, `test/exec-env-config.test.mjs`

**Interfaces:**
- Consumes: `DEFAULT_ALLOW`, which is the list `docker/compose.egress.yml:10-14` documents.
- Produces: `sandboxEgress(project)`.

- [ ] **Step 1: Write the failing tests.**
  - `open by default`: `sandboxEgress({})` is `null`, and `Sandbox.create` is called without
    `network` (assert on the fake SDK's recorded options).
  - `allow uses the shared list`: with `egress:'allow'`, `sandboxEgress` returns
    `allowOut: ['api.anthropic.com','github.com','*.github.com','githubusercontent.com','*.githubusercontent.com','registry.npmjs.org']`
    and `denyOut: ['0.0.0.0/0']`.
  - `empty list is deny-all`: `allowOut` is absent and `denyOut` is `['0.0.0.0/0']`.
  - `create 400 is a config error`: the fake SDK rejects with status 400, and the env start rejects
    with `errorClass: 'config'`.
  - `relay works with egress closed`: on `e2b-fake.mjs` with `allowOut: []`, a Claude step's model
    call through the relay still answers 200.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test test/egress-policy.test.mjs test/exec-env-config.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement it.** The setting's help text reads: `Stops casual network access from the sandbox, not a determined agent: an allowed host name can be spoofed to reach any address, any host name opens DNS, and ssh git remotes fail (use HTTPS).`
- [ ] **Step 4: Run the tests and confirm they pass.** Same command as Step 2. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git commit -m "feat(exec-env): opt-in sandbox egress allowlist shared with compose.egress"`, then squash Tasks 12-13 into the core-3 PR.

### Task 14: Build the UI's engine surfaces from the catalog (core-4)

**Files:**
- Modify: every UI file that lists engines, effort levels, sign-in text or helper notes by hand,
  and the engine options in `index.html`. Find them with
  `grep -rln "'codex'\|'copilot'\|'cursor'\|Codex\|Copilot\|Cursor" ui/public src/shared`. The
  audit counts 42 files shared by the engine PRs.
- Modify: `src/shared/engine-switch.mjs`. Add catalog fields the UI needs: `efforts: string[]`,
  `signIn.modes[].label`, and `helpersNote: string|null`.
- Test: `test/boundary-ui-catalog.test.mjs` (new)

**Interfaces:**
- Consumes: `ENGINES` (Task 1).
- Produces: `engineOptions({ surface }) → Array<{ value, label, beta, disabled?, note? }>` in
  `src/shared/engine-switch.mjs`. It is the one list every picker renders.

- [ ] **Step 1: Write the failing test.** `no engine name in UI code outside the catalog`: a scan
  of `ui/public/**/*.{mjs,js,html}` finds no `'codex'`, `'copilot'` or `'cursor'` string literal,
  and no hard-coded engine `<option>`. There is a frozen allow list for test ids and CSS class
  names, and it may only shrink.
- [ ] **Step 2: Run the test and confirm it fails.** Run `node --test test/boundary-ui-catalog.test.mjs`. Expected: FAIL, listing today's files.
- [ ] **Step 3: Move each surface onto `engineOptions` and catalog fields.** Run the existing UI
  tests after each file.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `node --test test/boundary-ui-catalog.test.mjs` and then `npm run test:fast`. Expected: PASS.
- [ ] **Step 5: Commit and squash into core-4.** Run `git commit -m "refactor(ui): engine pickers, efforts and sign-in text come from the catalog"`.

### Task 15: Per-run container mount with secret masks (core-5)

This task starts with a short design doc, `plans/<date>-per-run-container-mount-design.md`. No
per-run container exists in `src/core` today: the container is the whole server under
`docker/compose.yml`. Its inputs are fixed by this plan:
- one project path per run, replacing the `${WORCA_PROJECTS}` bind (`docker/compose.yml:32`);
- `maskPlan(projectDir, secretPathsFor(project))` from Task 12. Each path gets an empty read-only
  overlay.

- [ ] **Step 1: Write the design doc.** It must cover how a run's container is started, mounted and
  stopped, and how clone-in (`compose.clonein.yml:16-19`) relates. Have the owner review it.
- [ ] **Step 2: Plan it** as its own task list, with the conformance row C-MASK: inside a run's
  container, every `maskPlan` path reads as empty, and no other project is visible.

---

## After the core PRs: engine PR rebases

Each rebase does the same steps. They run after core-2 and core-4 land.

1. Drop the PR's own env builder, preflight `execFile`, route close and any `name === '<engine>'`
   gate branch. The guard tests name each one.
2. Add the `ENGINES` entry with every Task 1 field, the adapter (importing only `src/core/spawn.mjs`
   and `relay-route.mjs`), and `test/fixtures/engines/<name>/` plus
   `test/fixtures/engine-rules/<name>/`.
3. Run `node --test test/engine-conformance.test.mjs test/boundary-*.test.mjs`. Expected: all rows pass for the new entry.

Per-engine notes:

- **#643.**
  - Gemini is `own` (Google login) and `remote: false`. A `gemini` relay protocol and meter parser
    are a follow-up.
  - Qwen is `relayed` on `openai`. Qwen's `agent`/`cron_create` tools are denied (C-SUBAGENT).
  - Gemini Grep/Glob gets a recorded denial, or is marked `partial`.
  - The full cleaned run env stops reaching Gemini/Qwen (`gemini-family.mjs:278`); C-CANARY checks
    it.
- **#819 Goose.**
  - Its per-session MCP wrappers spawn through `superviseSpawn`.
  - It emits a `usage` event on `complete` and on every exit (`goose.mjs:456-477` books on success
    only today).
  - MCP env leaves goose's own env (`goose.mjs:117-119`).
- **#672 OpenCode.**
  - Its `--pure` config goes under `env.home`. It needs no stdin hack, because `superviseSpawn`
    always closes stdin.
  - It emits `part.cost` as `usage` events on every exit (`opencode.mjs:563-615`).
  - Its model refusal moves to `requiresExplicitModel: true`.
- **Follow-ups.** A `gemini` relay protocol and meter parser, and broker slots for Qwen, Goose and
  OpenCode. Relay spike 2 found every API-key mode relayable.
