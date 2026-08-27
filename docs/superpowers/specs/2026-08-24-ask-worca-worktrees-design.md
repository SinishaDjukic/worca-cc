# Ask Worca Worktrees (P4) — Design Spec

Date: 2026-08-24
Status: Approved design, spec for implementation planning
Baseline: Ask Worca P1–P3 (commits 1b02d87b, dbb47f68, cb8b1ff4) + cost statistics (2aa4a2f3)

## 1. Overview

Ask Worca chat sessions (threads) gain the ability to create **git worktrees** in worca
home — the way pipeline runs do — so the assistant can check out any ref of any
registered project (including the feature branch of a history record), navigate refs,
and diff against arbitrary bases. Worktrees are per-thread resources: persisted in the
DB, deterministically removed when the thread is deleted, visible in the chat panel,
and manually deletable there at any time.

The assistant works **only inside its worktrees** — it never reads or runs anything in
the user's live project directories. It cannot edit code, push, or open PRs; fixes are
proposed through the existing `propose_run` card flow.

## 2. Locked decisions

- **D1 — Checkout scope**: any branch/tag/commit of any registered project, plus
  run-id sugar that resolves a history record to its feature branch (workspace records
  need a member `projectKey`).
- **D2 — Access model**: native `Read`/`Grep`/`Glob` builtins, allow-scoped to the
  thread's worktree subtree only. Requires narrowing today's blanket
  `Read(//**/.worca-cc/**)` deny into an enumerated deny list (§7).
- **D3 — Worktree-only reading**: no access to live project dirs. The agent reads
  exclusively from its own checkouts. Only server-side create/remove primitives touch
  the source repo (`git worktree add/remove`, cwd = projectDir — same as pipelines).
- **D4 — Detached HEAD always**: worktrees are created with `--detach` and every
  `checkout`/`switch` inside them re-detaches. No branch is ever created, locked, or
  deleted by chat worktrees; zero interference with the pipeline M2
  branch-in-use check.
- **D5 — git tool**: one generic MCP tool `git({worktreeId, args})` with a subcommand
  allowlist — read set + detached navigation + `fetch`. Everything else rejected.
  No `pull` (meaningless on detached HEAD; rejected with a fetch hint).
- **D6 — No code editing, no push, no PRs**: `Write`/`Edit`/`Bash` still do not exist
  in the agent process; `push`/`remote`/config-mutation subcommands are blocked; fixes
  go through `propose_run`.
- **D7 — Placement**: `<worcaHome>/ask/<threadId>/wt/<wtId>/`, inside the existing
  per-thread dir, so the thread-dir `rmSync` remains a natural backstop.
- **D8 — Persistence**: new `ask_worktrees` table with `thread_id` FK
  `ON DELETE CASCADE`; thread deletion first runs proper git removal per row, then the
  SQL cascade and dir removal. Boot sweep reconciles rows vs dirs both ways.
- **D9 — Caps**: 5 worktrees per thread, 15 global. No TTL in v1; lifecycle is
  agent-remove / user-remove / thread-delete cascade / boot sweep.
- **D10 — UI**: composer "N worktrees" button (hidden at 0) → popover styled like the
  run-info ("Agents this chat") popover, one row per worktree with a trash button.
  Manual delete allowed mid-turn.
- **D11 — Creation is direct**: opening a worktree is a plain tool call (no approval
  card) — it is read-only resource allocation, capped and visible. Starting *work*
  (pipelines) still requires the user to start the card.
- **D12 — fetch allowed, restricted**: configured remote names or `--all` only, no
  URLs, no custom refspecs. Credentials handling per empirical gate E3.
- **D13 — Empirical gates before implementation** (§12): Grep/Glob path scoping under
  `dontAsk`; git reachable from the scrubbed MCP child; fetch credentials. Each gate
  has a specified fallback; the plan pins the outcomes.

## 3. Worktree engine

New primitives in `src/core/worktree.mjs` (module stays DB-free):

- `createDetachedWorktree({projectDir, worktreeDir, ref, signal})`:
  1. validate `ref` resolves: `git rev-parse --verify --quiet <ref>^{commit}`
     (reuse `isValidSourceRef` machinery);
  2. `git worktree prune` (cwd = projectDir);
  3. `git worktree add --detach -- <worktreeDir> <ref>` (cwd = projectDir,
     `SLOW_GIT_TIMEOUT_MS` timeout, AbortError stamping as in `createWorktree`);
  4. return `{worktreeDir, commit}` where commit = `git -C <worktreeDir> rev-parse HEAD`.
- Removal: existing `removeWorktree({projectDir, worktreeDir, branch: null, force: true})`
  — already does `git worktree remove --force`, rm-rf backstop, `git worktree prune`.
  Passing `branch: null` means no branch is ever deleted. A moved/deleted source repo
  degrades to the rm-rf backstop (steps reported, not thrown).

Path safety mirrors pipeline rules: `wtId` matches `/^wt_[0-9a-f]{8}$/`, `threadId`
matches the existing `ASK_ID_RE`, parent dir realpath'd, containment asserted
(`worktreeDir.startsWith(baseReal + sep)`).

## 4. Persistence

New table (next free schema version — determine the number at implementation time;
do not assume v20):

```sql
CREATE TABLE ask_worktrees (
  id              TEXT PRIMARY KEY,          -- 'wt_' + 8 hex
  thread_id       TEXT NOT NULL REFERENCES ask_threads(id) ON DELETE CASCADE,
  project_key     TEXT NOT NULL,
  project_dir     TEXT NOT NULL,             -- source repo at creation time
  ref             TEXT NOT NULL,             -- last ref the agent checked out (label)
  resolved_commit TEXT NOT NULL,             -- HEAD sha after last navigation
  run_id          TEXT,                      -- set when created via run-id sugar
  worktree_dir    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_ask_worktrees_thread ON ask_worktrees(thread_id);
```

Orchestration module `src/core/ask/worktrees.mjs` owns create/list/remove/row
bookkeeping and the sweep. It uses the `worktree.mjs` primitives plus the ask store's
DB access; `worktree.mjs` itself stays DB-free (adapter pattern, as with
`runRootSweepLookups`).

## 5. Lifecycle

**Create** (`open_worktree` tool, §8):
1. resolve target: `(projectKey, ref)` directly, or `runId` → pipeline row →
   `state.branch.feature` (workspace: `workspace_meta.branches[projectKey].feature`;
   missing `projectKey` on a workspace record → error listing member keys);
2. registered-project check (project must exist in the projects table; its dir must be
   a git repo);
3. deleted-branch check for run sugar: if the feature branch no longer exists, error
   with a hint to `get_run_diff` (the durable diff artifact);
4. cap check (5/thread, 15 global);
5. mint `wtId`, `mkdir -p <worcaHome>/ask/<threadId>/wt/`, `createDetachedWorktree`,
   insert row.

**Remove** (tool, UI, or cascade): `removeWorktree(force: true)` → delete row. Tool
and endpoint both tolerate an already-missing dir (prune + row delete).

**Thread delete** (`DELETE /api/ask/threads/:id`, ui/server.mjs:3110): order becomes
stop turn → detach followers → **remove all thread worktrees (git-proper)** →
`askDeleteThread` (SQL cascade removes rows; `rmSync` of the thread dir is the
backstop) → job/timer cleanup.

**Boot sweep** `sweepAskWorktrees()` — added to `bootMaintenance()` (after existing
sweeps) and to `worca doctor`:
- dir `<worcaHome>/ask/*/wt/*` without a matching row → `removeWorktree(force)` best
  effort (prune covers stale git metadata);
- row without a dir → `git worktree prune` in `project_dir` (best effort), delete row;
- three-state doctrine: a DB lookup *throw* (≠ "no row") skips the candidate untouched
  and is reported in the sweep summary — never guess-delete.

**Navigation updates**: after a successful `checkout`/`switch`/`fetch` the tool
updates the row (`ref` = requested ref for checkout/switch, `resolved_commit` =
`rev-parse HEAD`, `updated_at`), so `list_worktrees` and the UI always show where each
worktree actually points.

**Mid-turn manual delete**: allowed. The agent's next operation on a removed worktree
gets a clean tool error ("worktree removed").

## 6. Spawn changes (`src/core/ask/spawn.mjs`)

- `ASK_BUILTIN_TOOLS = ['Task', 'Read', 'Grep', 'Glob']` → both `--tools` and
  `--allowedTools` (MCP grants unioned as today).
- Per-turn **allow rule** (thread-specific, built with the rest of the spawn options):
  `Read(//**/.worca-cc/ask/<threadId>/wt/**)`. One rule covers every worktree of the
  thread, present and future. `threadId` is `ask_` + 8 hex — glob-safe for
  interpolation. If gate E1 shows Grep/Glob need their own rules, mirror the same
  pattern for them.
- All other hardening unchanged: `permissionMode: 'dontAsk'` (paths that are neither
  allowed nor denied auto-deny), `envScrub` + empty allowlist (subject to E3),
  `strictMcpConfig`, `settingSources: ['project']` (cwd stays the scratch dir, so a
  checked-out repo's own `.claude/` settings are never loaded), scratch cwd,
  `disableSlashCommands`, `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`.

## 7. Deny-list restructure

Deny beats allow, so the blanket `Read(//**/.worca-cc/**)` must be replaced by an
enumerated list. New `ASK_DENY_RULES`:

```js
[
  'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Skill',
  'Read(//**/worca-cc.db*)',
  'Read(//**/.worca-cc/store/**)',
  'Read(//**/.worca-cc/runs/**)',
  'Read(//**/.worca-cc/plugins/**)',
  'Read(//**/.worca-cc/backup-*/**)',
  'Read(//**/.worca-cc/tmp/**)',
  'Read(//**/.worca-cc/ask/*/att/**)',   // attachments only via the scoped MCP tool
  'Read(//**/.worca-cc/settings.json)',
  'Read(//**/secrets.json)',
  'Read(//**/.env*)',
  'Read(~/.ssh/**)',
  'Read(~/.aws/**)',
]
```

Notes:
- `//`-anchoring is load-bearing (documented in spawn.mjs / docs/guardrails.md);
  `worcaHome()` is never interpolated into rules.
- Checked-out repos may themselves contain `.env*` / `secrets.json` — the global
  denies still block those inside worktrees; the redaction floor (§8) covers the same
  paths in git *output*.
- Defense in depth: the allow rule opens exactly `ask/<threadId>/wt/**`; everything
  else in the home is (a) denied above where sensitive and (b) auto-denied by
  `dontAsk` anyway. A **pin test** asserts every top-level entry of the home layout
  documented in `docs/storage.md` is covered by a deny or is the `ask` subtree, so a
  future home subdir cannot silently become readable.
- `docs/guardrails.md` §Ask-Worca section updated to describe the new model.

## 8. MCP tool surface

New tools registered in `src/core/ask/tools.mjs`, deps injected from a **new**
`src/core/ask/worktree-deps.mjs` bundle. The existing test asserting
`tool-deps.mjs` is write-free stays intact; a new scan pins `worktree-deps.mjs` to
worktree operations only (git spawn, mkdir of the wt dir, row writes for
`ask_worktrees`, nothing else).

- `open_worktree({projectKey?, ref?, runId?})` → `{worktreeId, path, projectKey, ref,
  commit}`. Exactly one of `(projectKey + ref)` or `(runId [+ projectKey])`.
  Errors: unknown project/run, unresolvable ref, workspace member required, branch
  deleted (hint → `get_run_diff`), cap reached (hint → `remove_worktree` or reuse via
  `list_worktrees`).
- `list_worktrees()` → `{worktrees: [{worktreeId, projectKey, ref, commit, path,
  createdAt}]}` (thread-scoped).
- `remove_worktree({worktreeId})` → `{ok}`.
- `git({worktreeId, args})` — `args` is an **argv array** (no shell), spawned with
  cwd = the worktree, `SLOW_GIT_TIMEOUT_MS`, pager disabled (`GIT_PAGER=cat`,
  `GIT_TERMINAL_PROMPT=0`), output capped (reuse the `get_run_diff` cap), and the
  **redaction floor** (`GUARDRAIL_PRESETS.secure.protectedPaths`, as in
  `tool-deps.mjs`) applied to all output.

### git subcommand allowlist

| Tier | Subcommands | Constraints |
|---|---|---|
| Read | `diff`, `log`, `show`, `status`, `blame`, `rev-parse`, `merge-base`, `grep`, `shortlog`, `describe`, `ls-files`, `ls-tree`, `cat-file` | — |
| List-only | `branch`, `tag` | list forms only: bare, `--list`, `-a`, `-r`, `--contains`, `--merged`, `--format`; reject positional creation and `-d/-D/-m/-M/-c/-C/-f` |
| Navigate | `checkout`, `switch` | `--detach` auto-injected when absent; reject `-b/-B/--orphan/--track` and pathspec (`--`) forms; ref must resolve |
| Sync | `fetch` | positional arg must be a configured remote name (validated against `git remote`) or `--all`; `--prune` allowed; **no URLs, no refspecs** (a refspec like `+master:master` could overwrite local branches) |

Rejected with specific hints: `pull` ("fetch, then checkout/diff origin/<branch>"),
`push`/`remote` ("chat cannot publish — propose a pipeline"), everything else with a
generic not-allowed error.

### Global argument blocklist (any position)

`-c`, `--config-env`, `--exec-path`, `--git-dir`, `--work-tree`, `-C`, `--ext-diff`,
`--textconv`, `--output`/`-o`, `--upload-pack`, `--receive-pack`,
`--open-files-in-pager` — closes config-injection / arbitrary-exec / file-write
vectors. `submodule` is not in the allowlist (network + exec risk); submodule dirs
simply stay empty in checkouts.

### Effects on shared state

`fetch` updates the real project's remote-tracking refs (shared `.git` object store) —
identical to the user running fetch; benign and documented in the prompt rules.
No other allowed subcommand mutates the object store or any branch.

## 9. Prompt rules (`src/core/ask/prompt.mjs`)

`ASK_SYSTEM_RULES` additions:
- worktrees are read-only inspection copies; open them to examine refs/history, prefer
  reusing an existing worktree (`list_worktrees`) over opening a new one; remove them
  when done; caps exist;
- never edit code anywhere — propose a pipeline (`propose_run`) when a change is
  needed;
- fetch is available for freshening `origin/*`; pushing/publishing is impossible.

## 10. Server API + UI

**Endpoints** (ui/server.mjs, ask section):
- `GET /api/ask/threads/:id` → response gains `worktrees: [...]` (same shape as
  `list_worktrees`).
- `DELETE /api/ask/threads/:id/worktrees/:wtId` → 400 bad id shapes, 404 unknown row,
  200 `{ok, steps}` from `removeWorktree`. Allowed while a turn is in flight.
- Thread DELETE flow extended per §5.

**Chat panel** (`ui/public/ask-panel.mjs`):
- Composer meter cluster gains a **"N worktrees"** button next to "N agents", hidden
  at 0. Click → popover (reuse `openPopover` + run-info row styling): per row —
  project name · `ref@sha7` · age · mono path line (click = copy) · trash button.
- Trash → existing confirm pattern → DELETE endpoint → refetch + count update.
- Data: popover refetches `GET /api/ask/threads/:id` on open; count refreshes on turn
  end (worktree create/remove/checkout during a turn is also visible in the transcript
  as ordinary MCP tool blocks — no new frame types needed).
- Thread trash confirm text: "also removes N worktrees" when N > 0.

## 11. Caps and limits

`src/core/ask/limits.mjs`: `WORKTREES_PER_THREAD = 5`, `WORKTREES_GLOBAL = 15`.
Constants in v1 (no settings UI); revisit if real usage hits them. No TTL/idle
expiry in v1. Disk usage is not computed (path visible in UI; caps bound the count).

## 12. Empirical gates (run before/at the start of implementation)

- **E1 — Grep/Glob scoping**: verify on the pinned claude version that `Grep`/`Glob`
  honor path allow/deny rules under `dontAsk` (i.e., cannot search outside the
  worktree allow scope). Fallback: drop them from `ASK_BUILTIN_TOOLS` and add a
  server-side `search_worktree` MCP tool (ripgrep over the worktree, redaction floor).
- **E2 — git in the MCP child**: verify `git` spawns successfully from
  `mcp-stdio.mjs` under the scrubbed env (PATH). Fallback: absolute git path
  resolution at server start, passed via the MCP server config.
- **E3 — fetch credentials**: verify fetch against a private remote under the
  scrubbed env. Default decision: allowlist the credential env the child needs
  (`SSH_AUTH_SOCK`, `HOME` for the keychain helper) into the MCP child only —
  acceptable because push is blocked at the tool layer; if unacceptable in testing,
  fetch degrades to public remotes and the tool error says so.

## 13. Testing

- `test/worktree.test.mjs` additions: `createDetachedWorktree` (HEAD detached
  verified via `git symbolic-ref -q HEAD` failing + `rev-parse` succeeding), prune
  behavior, invalid-ref error, containment/id-shape rejections. FreshRepo local
  helper pattern as elsewhere.
- New `test/ask-worktrees.test.mjs`: lifecycle under `useTempHome` + seeded projects
  (`db-seed.mjs`); caps (6th per thread, 16th global → typed errors); run-id sugar —
  single-project, workspace member, missing member key, deleted branch; row updates
  after checkout; removal tolerating missing dir; sweep both directions + DB-throw
  skip.
- New `test/ask-git-tool.test.mjs`: allowlist matrix — every allowed subcommand
  passes; `push`/`pull`/`commit`/`config`/`-c`/URL-fetch/refspec-fetch/`branch
  foo`/`checkout -b` rejected; `--detach` injection; redaction floor on `diff`/`show`
  output containing a protected path; output cap; argv (no shell) semantics.
- Permissions: spawn snapshot test — tools list, allow-rule shape, enumerated denies;
  **pin test** denies ⊇ sensitive home layout from `docs/storage.md`.
- Deps scans: existing `tool-deps` write-free scan untouched; new scan for
  `worktree-deps.mjs`.
- Server: new endpoint (200/404/400), thread GET shape, thread DELETE leaves
  `git worktree list` clean in the source repo, boot sweep wiring order.
- UI: extend the existing ask-panel test surface (popover render, count, delete
  flow) following the current ui test patterns.

## 14. Out of scope (v1)

Editing inside worktrees; Bash; push/PR/publish of any kind; TTL/idle expiry; disk
quotas; non-registered repos; submodule materialization; sparse/partial checkout;
settings UI for caps; worktree visibility outside the chat panel (doctor covers
maintenance).
