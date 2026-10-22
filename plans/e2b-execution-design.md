# E2B Execution Environment — Design

Running a pipeline run's agent steps and script steps inside **one self-hosted E2B sandbox
per run**, so that an agent works in a disposable VM instead of on the developer's PC.
worca's UI, orchestrator, database, git commits, pushes and PRs stay on the PC. The layer is
opt-in: `local` (today's behaviour) is the default and does not change.

Status: implemented on branch `feat/e2b-execution-env`. The code under `src/core/exec-env/`
is authoritative; where this document and it differ, the code wins. The template
(`docker/e2b/`) has not been built and no live E2B server was contacted while building it:
§15 lists everything that stays unverified until a live sandbox exists.

---

## 1. Problem

worca drives Claude Code headlessly on the developer's machine. Its guardrails (deny rules,
the host-process guard, the env scrub) are policy evaluated by the CLI itself; a subprocess an
agent spawns can still read anything the user can. The container install path
(`plans/container-isolation-design.md`) moves the whole of worca into a box. This design keeps
worca on the PC and moves only the **agents** out: one isolated VM per run, with the run's
commits, pushes and PRs still made locally, by the same code that makes them today.

## 2. Goals / Non-goals

Goals:
- An `e2b` execution environment, chosen per run, per project or as the user default.
- Every agent step and script step of a run executes in one E2B sandbox.
- Results reach the host after every step, so the UI, the reviewer's diff and the run's
  commit are computed exactly as today.
- `local` stays byte-identical: same argv, env, state, outcome and resume point.

Non-goals (v1):
- workspace (multi-project) runs — refused with a clear preflight error;
- engines other than claude — refused;
- the legacy run-root mode (`WORCA_RUN_ROOT=legacy`, the run-root rollback) — refused: it puts
  the worktree inside the real checkout with no run root, run-root `CLAUDE.md` or `mcp.json`;
- recreating a lost sandbox — a lost sandbox fails the run cleanly;
- a credential store in worca — the model credential comes only from the server's env;
- E2B pause/resume as a wait strategy.

## 3. Options considered → recommendation

**(a) Prompt and argv rewriting vs path mirroring.** Prompts, `MOCK_*` markers, output-port
paths, `--mcp-config`, `--plugin-dir`, `--add-dir` and the script envelope all carry absolute
host paths. Rewriting them would touch every executor. **Mirroring** puts the worktree,
pipeline dir, store plan/review dirs, run root and script support files at the *same absolute
paths* inside the sandbox, so nothing is rewritten, and Claude's `~/.claude/projects/<cwd-key>`
session lookup for `--resume` stays stable. A POSIX host is required (win32 is refused).

**(b) One final patch vs a per-spawn incremental patch.** A final patch leaves the host stale
for the whole run: the UI diff and the reviewer prompts (computed on the host) would be wrong,
and a lost sandbox would lose everything. **An incremental binary patch per spawn** keeps the
host current and satisfies "keep what was already synced back" on loss. Tree diffs compose
under parallel nodes.

**(c) Sync around `_runOnce` vs sync at the spawn boundary.** Executors read their results
inside `runExecution`, right after the spawn (the verdict, the materialised script outputs,
the question file). A sync around the orchestrator's `_runOnce` comes after all those reads.
**Sync at the spawn boundary**: the child-like `RemoteChild` syncs before it emits `close`.

**(d) Keep-alive vs E2B pause/resume while waiting.** Pausing a VM needs free disk equal to
its memory and is unverified on self-hosted E2B; the Q&A chose **keep-alive**: the sandbox
timeout is extended up to a max-wait setting, then the sandbox is released and the step fails.

**(e) A run-status queue vs a waiting flag.** There is no `queued` run status, and every status
set would need a new value. **A flag** (`state.execEnvWaiting`) keeps the run `running` and the
run page shows "waiting for an E2B slot".

## 4. Architecture

| Module | Role |
|---|---|
| `src/core/exec-env/backend.mjs` | JSDoc contract (`ExecBackend`, `BackendClient`, `Box`, `RunOptions`, `BuildResult`) + `assertBackend`. No imports. |
| `src/core/exec-env/registry.mjs` | `BACKENDS` map, `getExecBackend`, `listExecBackends`, `execEnvNames`, `describeExecEnvs`, `defaultBuildBackend`, `_registerExecBackendForTests`; registers secrets into host-credentials. |
| `src/core/exec-env/index.mjs` | `EXEC_ENVS` (derived), `isExecEnvName`, `selectExecEnv`, errors with generic codes, `EXEC_ENV_CODES`, re-exports `isSandboxGone`/`isSandboxUnreachable` from the e2b backend. |
| `src/core/exec-env/policy.mjs` | Generic sandbox policy (§11): env allowlist, MCP filter, model credential, run-level timeouts, instance tag, the generic remote-run guards. |
| `src/core/exec-env/remote-env.mjs` | `RemoteExecEnv` — all generic run logic, parameterised by `{ backend, client, environment }`. |
| `src/core/exec-env/e2b-env.mjs` | Thin `E2bExecEnv extends RemoteExecEnv` (constructor from `{ sdk, conn }`), `SCRIPT_SUPPORT_FILES`, `WORK` re-exports. |
| `src/core/exec-env/remote-child.mjs` | The child-like handle; runs the per-spawn sync; calls `env.client.run(env.sandbox, …)`. |
| `src/core/exec-env/shell.mjs` | `shq`, `shellJoin`, `mkdirsScript`. |
| `src/core/exec-env/git-transfer.mjs` | Bundle, overlay, tar, patch apply, the scripts run inside the sandbox. |
| `src/core/exec-env/e2b-fake.mjs` | The loopback fake SDK (tests, `WORCA_MOCK=1`). |
| `src/core/exec-env/backends/e2b.mjs` | The e2b backend definition, `e2bClient(sdk, conn)`, `isSandboxGone`/`isSandboxUnreachable`, `e2bInstalled`. |
| `src/core/exec-env/backends/e2b-template.mjs` | Template sources: version pin, `renderTemplateDockerfile`, `renderProjectDockerfile`, `e2bBaseVersion`. |
| `src/core/exec-env/e2b-config.mjs` | E2B-only config (`e2bConnection`, `e2bPreflight`, SDK request timeouts, defaults) + re-exports of the `policy.mjs` names. |
| `src/core/exec-env/e2b-sdk.mjs` | Unchanged lazy loader; `e2bInstalled` re-exported from the backend. |
| `src/core/exec-env/slots.mjs` | Per-pool counts. |
| `src/core/exec-env/sweep.mjs` | Generic `sweepOrphans({ client, … })`, `sweepBackend`, e2b compat wrappers. |
| `src/core/exec-env/env-spec.mjs` | Spec schema: `normalizeEnvSpec`, `envSpecHash`, `EnvSpecError`. |
| `src/core/exec-env/project-env.mjs` | Per-project record API: spec, backend config, build records, `buildStaleness`, `resolveRunEnvironment`, `projectExecEnvView`. |
| `src/core/exec-env/build.mjs` | Server-only builds: `markServerProcess`, `startEnvironmentBuild`, job map + log. |
| `src/cli/exec-env.mjs` | `worca exec-env list|status|spec|build`. |
| `ui/public/exec-envs.mjs` | Browser list of backends + `fillExecEnvSelect`, labels. |
| `ui/public/exec-env-project-view.mjs` | Project-page panel: template field, read-only spec, build status, Build/Rebuild. |
| `test/helpers/loopback-backend.mjs` | The test-only second backend. |

Import graph (static edges only): `settings.mjs → exec-env/index.mjs → registry.mjs → {backend.mjs,
backends/e2b.mjs, host-credentials.mjs}`; `backends/e2b.mjs → {e2b-config.mjs, backends/e2b-template.mjs}`;
`e2b-config.mjs → policy.mjs → host-credentials.mjs`. The SDK loader (`e2b-sdk.mjs`, which reaches
`projects.mjs` and so `settings.mjs`) is imported only dynamically, inside the backend's `open()`.
`project-env.mjs` and `build.mjs` (which import `config.mjs`) are imported only by the harness, the server and
the CLI, never by `index.mjs` or the registry.

**The seam** is `superviseSpawn` (src/core/engines/spawn.mjs) for agents and `spawnScript`
(src/core/graph/script-runner.mjs) for scripts. Each takes an optional `execEnv`; when it is
remote, `execEnv.spawn()` returns a `RemoteChild` instead of a host child process. Engines and
the stream parsers stay unaware of where they run.

**The `RemoteChild` contract:** stdout/stderr streams, `exit`/`close`/`error`, `kill()`,
`exitCode`, `signalCode`, `stdin = null` (stdin goes in as a sandbox file). `pid` stays
`undefined` — no host code may ever signal an E2B pid — and the sandbox pid is kept as
`remotePid`. `close` is emitted only **after** the files and code were synced back.

**Local mode is the absence of the layer.** No exec-env object exists on a local run; every new
branch is `if (execEnv?.remote)` or `if (this.execEnv)`.

## 5. Run lifecycle

1. **Preflight** at run start (and before a resume is committed): engine, workspace, run-root
   mode, platform, E2B key, model credential (unless the broker is on), Node version, `e2b` package, `E2B_DEBUG`.
2. **Slot**: the capacity queue (§9).
3. **Create** the sandbox from the template with metadata (`worca`, `worcaInstance`,
   `worcaRunId`, `worcaProject`) and a 30-minute timeout.
4. **Mirrored dirs** are created as root, component by component, each new one handed to
   `user` (host paths sit under root-owned parents such as `/Users` and `/var/folders`).
5. **Bundle clone** of the run branch, then the **overlay**, then the **baseline tree**.
6. **Support files**: the filtered `mcp.json`, the run-root `CLAUDE.md`, the script harness
   files (`script-child.mjs`, `worca_script.py`).
7. **Heartbeat**: every 5 minutes the 30-minute timeout is refreshed.

Per spawn: upload the host's changed step files → run the command → pull files and code →
`close`. Then park/unpark around asks and pauses, a final sync at the top of `_buildResults`,
worca's commit (`_commitWork`) in teardown, and `Sandbox.kill`.

Sequence of one run:
- `_run` → engine gate → exec-env refusal gate → worktree, context, memory mount, engine config
- `_startExecEnv` → slot → create → dirs → clone → overlay → baseline → support → heartbeat
- for each node: `RemoteChild` → `beforeSpawn` (pull, then upload) → command → `afterSpawn`
  (pull files, pull code) → `close` → the executor reads the verdict and outputs
- `_buildResults` → final `syncBack`
- finally → `_finishExecEnv` (sync, kill, release the slot) → `_teardownRunRoot` → `_commitWork`

## 6. Code in / code out

**In.** A `git bundle` of the feature branch (or HEAD when detached) is uploaded and cloned in
the sandbox; the clone's `origin` remote is removed. A tar of what the clone lacks — dirty and
untracked (non-ignored) files, the §8.8 injected paths (the `.claude/rules/worca` memory
mount, skills, engine config files) and `graphify-out/` (which ignores itself) — is extracted
over it, and the host's deletions are replayed. The resulting tree is the sync baseline. No
GitHub token or remote is involved.

**Out.** After every spawn the sandbox writes its working tree as a tree object through a
private `GIT_INDEX_FILE` (the agent's own index is untouched); the injected paths are removed
from that index (the same filter as `_excludePathspecs`). A `git diff --binary --full-index`
from the last synced tree is downloaded and applied on the host worktree with
`git apply --binary`, `--check` first so a failure changes nothing. `git apply` refuses `..`,
`.git/` and beyond-symlink paths. On failure the patch is saved as
`<pipeline>/e2b-unapplied-<n>.patch` and the run fails terminally (`EXEC_ENV_PATCH_REJECTED`).

**Commits are flattened; merges are refused.** A content patch carries no commits: an agent's
commits reach the host as working-tree changes and land in worca's teardown commit. A merge
commit made in the sandbox fails the sync with `EXEC_ENV_MERGE_COMMIT` (flattened, it would push a
branch that still conflicts). Worca's own merge runs — Watch PR's conflict and "behind" fixes
and the Resolve run — always start with `execEnv: 'local'`.

**Crash safety.** The synced tree id is written to a host state file
(`<worcaHome>/tmp/e2b/<runId>/synced-tree`) after every applied patch. A reconnect after a
crash prefers it to the resume point's copy (the resume point is written on scheduler
snapshots, so it can lag by one parallel pull), and accepts a patch the host already holds in
full (a reverse-apply check).

## 7. Step I/O sync

**Synced roots:** the pipeline dir, and the store plans/reviews dirs — there limited to this
run's own files (modified after the run started) plus the inputs bound to a node (an older
plan). **The known map:** `_known` holds, per sandbox path, the `size:mtimeMs` signature it had
when it was last synced in either direction. A `node -e` snapshot of the roots is compared with
it; every differing path is downloaded one by one. A per-path map, unlike one global baseline,
cannot lose a file a parallel node wrote while another node's spawn started.

**Path validation:** a downloaded path must be normalized, strictly inside a synced root, not a
host symlink, ≤ 128 MiB (above the 100 MiB run-extras limit, so every attachment a prompt names
gets through), and not an excluded name (`live-log.ndjson`, `e2b-unapplied-*`, temp names
containing `.e2b-`). Downloads are written to a temp name and renamed.

**Merges:** `directions.ndjson` has two writers (a user direction on the host, a consumption
record in the sandbox), so it is merged line-wise instead of overwritten.

**Host → sandbox:** before each spawn, host files changed since the last sync are uploaded as
one tar, and files deleted on the host are deleted in the sandbox. The memory-mount
(`.claude/rules/worca`) is re-uploaded when the host refreshes it; it ignores itself, so it
never shows in a patch. Files an agent deletes in the synced roots are not deleted on the host.

## 8. Questions, resume, waiting

The cwd is the same mirrored path at every step, so Claude's `--resume` finds its session.
While an ask is pending **and** no spawn runs, the sandbox parks: its timeout becomes
`e2bMaxWaitMin` (default 240) and the heartbeat stops. A host timer runs only while parked; at
max wait it releases the sandbox and fails the run with "No answer within N min". Waits are
counted, so overlapping asks unpark only when the last one ends. A spawn starting during a
park unparks.

On pause or drain the sandbox syncs and parks (held: no ask can unpark it) until a reconnect
or close. On resume worca reconnects (`Sandbox.connect`), pulls the code first, then re-overlays
and re-baselines (resume re-assembly rewrites the memory mount and skills). A sandbox that is
gone on resume fails the run: "could not be reached on resume", or, past the wait, "it may
have outlived the N-minute wait".

## 9. Capacity

An in-process semaphore plus the E2B server's count of running sandboxes (`Sandbox.list`)
keep a run "waiting for an E2B sandbox slot" until both are below `e2bMaxSandboxes`
(default 4). The in-process count has no race inside one server. Two worca processes can still
both see `cap - 1` and both start: this race is accepted; E2B itself refuses past its real
capacity, which surfaces as a terminal "sandbox setup failed". A reconnecting run takes its
slot by force (it already holds its sandbox).

## 10. Abort, crash, orphans

Stop → `CommandHandle.kill()` (SIGKILL; E2B has no gentler signal) → the spawn's own sync →
`_buildResults` → teardown commit → `Sandbox.kill`. A server crash leaves the sandbox to
expire within ≤ 30 minutes. Sandboxes carry the metadata `worca`, `worcaInstance` (a hash of
the worca home and host name), `worcaRunId` and `worcaProject`. Orphans — tagged with this
instance but owned by no paused or interrupted run — are swept at boot (`bootMaintenance`)
and by `worca e2b sweep`.

Loss is decided by the control plane. `SandboxNotFoundError` and `SandboxNotRunningError`
mark the env lost. `SandboxUnreachableError` also covers a dropped SSH tunnel, so
`Sandbox.getInfo` is asked first: only when it too says the sandbox is gone is the run lost;
otherwise the step fails with an ordinary, retryable error. A lost sandbox or a refused patch
is `execEnvFatal`: the orchestrator skips its retry, recovery and pause policy.

## 11. Hooks, MCP, credentials, engines

- **Host guard off** inside the sandbox (with a warning): it protects the worca server PID,
  and no worca server runs there.
- **MCP:** a sandbox-specific `mcp.json` is uploaded at the mirrored `--mcp-config` path. It
  keeps only `url` servers whose host is not loopback and that carry no literal secret (a GitHub
  token or any `mcpSecretFindings` hit); every dropped server is named in the run log. Env vars
  (MCP registry secrets `MCPSECRET_*` among them) enter the sandbox only when a **kept** server
  references them, and the run log names them per kept server.
- **Env** is an allowlist (`ANTHROPIC_*`, `CLAUDE_*`, `MCP_*`, `DISABLE_*`, locale,
  `API_TIMEOUT_MS`, `API_FORCE_IDLE_TIMEOUT`; the allowlist itself passes no secret-named var)
  plus the script contract's `WORCA_*` (one var per input, output and param, the run context,
  `WORCA_ENVELOPE`) and the run's declared `keep` keys: kept-MCP-server secrets `MCPSECRET_*` and script
  secrets pass even when secret-named (any case). A model entry's env is kept too, but none of its
  secret-named keys enters: its credential keys are relay-owned (below) and any other secret-named
  key refuses the claude spawn in the route (`relay-route.mjs`). The model credential
  (`MODEL_CREDENTIAL_KEYS`), `ANTHROPIC_BASE_URL` and `ANTHROPIC_CUSTOM_HEADERS` are relay-owned
  (`RELAY_OWNED_KEYS`) and never enter, even if declared. Then `stripHostCredentials`. No other `WORCA_*` (host config and host secrets
  such as `WORCA_HEARTBEAT_TOKEN`), no `OTEL_*` (exporter endpoints and headers), and never an
  `E2B_*`, `WORCA_E2B_*`, `GH_*` or `GITHUB_*` var. Host `PATH`, `HOME`, `TMPDIR` never enter.
- **E2B credentials stay in the server:** `stripHostCredentials` drops `E2B_*` and `WORCA_E2B_*`
  (the e2b backend's `secretEnv`, §17) from every host child too (agents, scripts, actions, git).
- **No model credential in the sandbox.** A relay process in the sandbox carries Claude Code's
  model calls over the command's stdin/stdout to worca, which adds the credential (the server's
  `CLAUDE_CODE_OAUTH_TOKEN`, else `ANTHROPIC_API_KEY`; a model entry's own gateway key; or the
  spawn's broker token) and forwards to a fixed upstream. The credential broker works with E2B,
  and the bridge and loopback `ANTHROPIC_BASE_URL` models are reachable through the relay. An
  `ANTHROPIC_BASE_URL` gateway from the server's own env (no model entry base URL, the same URL)
  gets the server's `ANTHROPIC_AUTH_TOKEN` (Bearer), else `ANTHROPIC_API_KEY` (`x-api-key`), and
  is refused when the server has neither; `CLAUDE_CODE_OAUTH_TOKEN` never goes to a third party.
  An entry's keyless gateway gets no credential (logged once per origin). A base URL with a query
  or fragment is refused.
  Bedrock/Vertex/Foundry models and model entries with a secret in an unusual variable are
  refused for remote spawns. Scripts get no model credential and no model route. Design:
  `plans/model-relay-design.md`.
- **`agentSpawn` / sudo isolation** applies on the host only; there is no pool in a sandbox.
- **Other engines** are refused.

## 12. Settings and UI

- `run.execEnv` cascade (user, project, per run), default `local`.
- `e2bMaxSandboxes` (1–64, default 4) and `e2bMaxWaitMin` (5–1440, default 240), user level.
- New pipeline: a "Runs in" picker next to the engine picker; the body carries `execEnv`
  only when it differs from the server's default.
- The project page: an "Execution environment" card.
- Settings → Runs: an "Execution environment" card.
- The run page: an "E2B sandbox" chip (live header and History), "waiting for an E2B slot"
  while queued.
- CLI: `--exec-env local|e2b` (or any registered backend; `worca exec-env list`); `worca e2b sweep [--dry-run] [--all]`;
  `worca exec-env status|spec|build` (§18).

## 13. Template

`docker/e2b/e2b.Dockerfile` is the agent's half of `docker/Dockerfile`: `node:22-bookworm`,
git, python, build toolchains and the pinned Claude Code (`docker/CLAUDE_CODE_VERSION`), user
`user` with home `/home/user`. Single stage, no `SHELL` line, no `COPY --from` (E2B's Dockerfile
converter refuses or ignores those). `docker/e2b/build.mjs` (`npm run e2b:build`) substitutes
the pinned version and builds through `Template.build`.

## 14. Testing

- **The fake** (`e2b-fake.mjs`) is a loopback: a sandbox is a host directory exposed as
  `pathPrefix`, commands run with real `bash`. It mirrors the real error split (envd calls on a
  killed sandbox raise `SandboxNotRunningError`, control-plane calls `SandboxNotFoundError`).
- **Mock mode + e2b** (`WORCA_MOCK=1`) uses the fake, and the in-process mock engine runs
  through `execEnv.runInProcess()`, which syncs like a `RemoteChild`.
- Tests: `exec-env-config`, `exec-env-fake`, `exec-env-sync`, `exec-env-remote-child`,
  `exec-env-script-roots`, `graph-script-runner` (e2b block), `exec-env-slots`,
  `exec-env-sweep`, `exec-env-pipeline`, `api-run-exec-env`, `ui-engine-picker`, `pr-watch`,
  `e2b-template`; local mode is proven unchanged by the existing suite and the smoke.
- `test/e2b-live.test.mjs` runs only with `E2B_API_URL` and `E2B_API_KEY` set; it never calls
  a model.

## 15. Unverified until a live sandbox exists

- the self-hosted API serves `/v2/sandboxes`, `/v2/sandboxes/{id}/connect`, `GET /sandboxes/{id}`
  (`getInfo`) and `/v3/templates`;
- `E2B_SANDBOX_URL` (:3002) routes on the `E2b-Sandbox-Id` header;
- `commands.run({ user: 'root' })` works, and root can create `/Users/...` and `/var/folders/...`
  mirrored dirs;
- `files.write` creates parent directories as the request's user;
- large uploads (bundle, overlay) finish within `FILE_REQUEST_TIMEOUT_MS` over the SSH tunnel;
- background `onStdout` latency is fine for live UI streaming;
- a 24 h command `timeoutMs` is accepted;
- Claude Code signs in from `CLAUDE_CODE_OAUTH_TOKEN` inside the VM;
- `--resume` works across commands in one sandbox (session files persist under `/home/user/.claude`);
- the max `setTimeout` value the self-hosted server accepts (≥ `e2bMaxWaitMin`), and whether it
  counts from now;
- the template builds with `Template.fromDockerfile` and the `usermod` rename (user `user`, home
  `/home/user`), and E2B's build does not try to create `user` itself;
- the sandbox has egress to the Anthropic API;
- file-size limits on `files.write` / `files.read`;
- which error a dropped tunnel raises (`SandboxUnreachableError` is assumed);
- orchestrator restart semantics (it kills running sandboxes, so the run fails cleanly);
- envd's command RPC accepts the full `bash -c` string (inline argv stays ≤ `ARGV_INLINE_LIMIT`
  = 20 000 chars; Linux caps one argv string at 128 KiB).

## 16. Trade-offs taken

- Full-history bundles: the upload grows with the repository.
- LFS and submodules are unsupported.
- Git-ignored build outputs are not synced back.
- Helper jobs (title, PR description, classifier, Away decider, graphify, flow cards) stay on
  the host.
- Scripts that need host services, or npm packages outside the template, fail in the sandbox.
- Worktree edits made on the host mid-run are not pushed into the sandbox (except the memory
  mount), and they make the next patch fail to apply (reported).
- A direction appended on the host in the instant between a spawn's pull and its upload can be
  overwritten by a parallel node's consumption record (rare).
- Claude Code in the sandbox sees no host `~/.claude` (personal skills, global `CLAUDE.md`,
  plugins).
- Agent commits are flattened into worca's teardown commit (their messages are lost); merge
  commits are refused.
- The sandbox clone holds only the run's branch and its history: no other branches, no remote.
- The host worktree, and with it the UI's live diff, updates once per finished spawn, not
  while an agent works.
- Away mode's grace (`nightMode.graceMinutes`, default 30) must stay below `e2bMaxWaitMin`, or
  the sandbox is released before Away answers (the run log warns).
- Files an agent deletes from the synced roots are not deleted on the host.

## 17. Adding a backend

E2B is one backend of a pluggable layer. A second provider (Daytona, Modal, a Docker host, an SSH box) is ONE
module plus one registry line; the run harness, the orchestrator and the engines do not change. Local stays the
absence of an exec-env object.

**The contract** is `src/core/exec-env/backend.mjs`. A backend exports a frozen *definition*: `name` (the registry
key, the run-log channel and the resume record's `kind`), `label` ('E2B sandbox'), `title` ('E2B'),
`environmentNoun` ('template'), an optional `workDir` (scratch inside the sandbox), `capabilities`
(`pause`, `buildEnvironment`, `defaultMaxConcurrent`, `defaultMaxWaitMin`), an optional `limitSettings`, the
`secretEnv` RegExp, optional `projectFields`, and the functions `preflight`, `configured`, `open`,
`resolveEnvironment` (plus `baseVersion` and `environmentName` when it can build). `open()` returns a *client*
bound to one connection: `create`, `connect`, `info`, `list`, `remove`, optional `countRunning`, `run`,
`readFile`, `writeFile`, `setTimeout`, `classifyError`, optional `describe` and `buildEnvironment`. Every client
method takes the backend's own opaque handle (`box`). `RemoteExecEnv` (`remote-env.mjs`) holds every generic step.

**The five steps:**
1. Write `src/core/exec-env/backends/<name>.mjs`, exporting the frozen definition and its client.
2. Add one `register(<name>Backend)` line in `src/core/exec-env/registry.mjs`.
3. Declare `secretEnv` (stripped from every host child). Declare `limitSettings` only if you also add user
   settings; otherwise `capabilities.defaultMaxConcurrent` and `defaultMaxWaitMin` apply.
4. Keep the module's top-level imports light: no `settings.mjs`, `db.mjs` or `projects.mjs` (the registry loads
   from `exec-env/index.mjs`, which `settings.mjs` imports). Load the provider SDK inside `open()`.
5. Test it with a fake client, as `test/helpers/loopback-backend.mjs` does.

**What a backend gets for free:** the code and step-file sync, patches and their failure handling, waiting and
parking, pause and resume, the capacity slots (one pool per backend), the boot sweep, the "Runs in" pickers
(`GET /api/exec-envs`), its own log channel, and the run chips.

**What the client must guarantee:** paths are mirrored under the handle's `pathPrefix`; `run` rejects a non-zero
exit with an error carrying a numeric `exitCode` (and `stderr`), in the foreground and through a background
handle's `wait()`; the sandbox image has `bash`, `git`, `node`, `tar`, `python3` (script nodes) and the `claude`
CLI on `PATH`; `user: 'root'` is honoured or safely ignored; `classifyError` tells 'gone' from 'unreachable'.

**Generic guards.** `policy.mjs remotePreflight` (single-project runs, the claude engine, the detached run root,
a POSIX host) and `remoteRefusesDefault` (a saved default does not apply to workspace runs or other engines; the
New run dialog applies the same rule from `src/shared/exec-env.mjs`) apply to every backend automatically. A backend's `preflight` adds only its own checks (keys, SDK, endpoint).
Its `secretEnv` keys never reach agents, scripts, actions, git or the Ask agent terminal; the person's own
terminal pane keeps them, so `worca run --exec-env <name>` typed there still works.

Error codes are generic: `EXEC_ENV_LOST`, `EXEC_ENV_PATCH_REJECTED`, `EXEC_ENV_MERGE_COMMIT`
(`EXEC_ENV_CODES` in `index.mjs`).

## 18. Per-project environments

**Storage.** One JSON value per project in `project_config.extra.execEnvProject`:
`{ config: { <backend>: { <field>: value } }, spec: EnvSpec|null, builds: { <backend>: BuildRecord } }`. It is read
and written through `config.mjs` (`readProjectExecEnv`, `updateProjectExecEnv`, one transaction per change: a
template Save, a spec change and a finished build can race). It lives in worca's DB, never in the repo.

**The spec** (`env-spec.mjs`) is backend-neutral and holds tools only:
`{ version: 1, tools: [{ name, version }], apt: [name], hash, updatedAt }`. Tool names follow mise
(`node`, `npm:prettier`, `pipx:black`), versions must be pinned (`latest` is refused), apt names follow Debian's
rule. No env vars, files, paths or secrets. `hash` is sha256 over the canonical (sorted, deduplicated) tools and
apt list, never `updatedAt`. The Toolchain setup workflow's lock maps onto it later: `kind: 'mise'` rows become
tools, `kind: 'system'` rows named `apt:<pkg>` become apt packages. In this version the spec is set only through
`PUT /api/projects/:key/exec-env/spec` and `worca exec-env spec --set <file>`; the project page shows it read-only.

**Template precedence (e2b).** The project's "E2B template" setting, else the project's successful build record,
else `WORCA_E2B_TEMPLATE`, else `worca-agent`. The run log names the template and where it came from.

**Builds.** A project build is ONE single-stage Dockerfile: `docker/e2b/e2b.Dockerfile` at the pinned Claude Code
plus a tool layer (apt packages, then mise `2026.10.7` installing the tools under `/opt/mise`, shims on `PATH`
through `ENV` and `/etc/profile.d/mise.sh`). It is not `Template().fromTemplate('worca-agent')`: the base
template's Claude Code version and Dockerfile cannot be read back from E2B, so the build's base version would be a
guess. The build is named `worca-agent-<projectKey>` (cut to 63 characters, keeping the key's hash). Builds run
only in the worca server process (`build.mjs markServerProcess`), which alone holds the backend keys; `worca
exec-env build` asks the running server over HTTP. A build needs a stored spec (409 `EXEC_ENV_NO_SPEC`). Only a
successful build replaces the record; a failed one leaves the previous record and template in place, and the job
keeps its error and log tail in memory for an hour.

**Staleness.** A recorded build is stale when the spec's hash changed since the build, the spec was removed, or the
backend's base version moved (`claude-code@<pin>+worca-agent@<hash of the base Dockerfile's instructions>+mise@<pin>`).
A run on a stale build warns in the run log and still uses it. Runs never block on a build and never rebuild.

**Unverified:** mise's `curl | sh` installer inside E2B's Dockerfile builder (self-hosted); whether a failed
`Template.build` under an existing name keeps serving the previous build; E2B's template-name length limit for
long project keys.
