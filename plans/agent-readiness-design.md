# Agent Readiness — Design

A per-project **agent readiness** status: a set of cheap, deterministic checks that tell a
team whether a repository is set up so that the agents Worca runs on it (Claude Code, Codex,
GitHub Copilot, Cursor) can work on it without wasting turns, tokens and review cycles. It is
shown as a chip on every project, computed when a project is added and kept current for
existing projects. Only the tools the project actually uses are judged; the others are shown as
"Not used", never as failing. Every failing check says how to fix it.

UI mockup: <https://claude.ai/artifact/BkK2wE7H9vrLBe5DVfL9MJ> (the popover, three example
scenarios, and the label legend).

## 1. Problem

Worca already depends on what a repository contains, but never says when that is missing or
weak:

- `src/core/run-context.mjs` inlines the project's `CLAUDE.md`, `.claude/CLAUDE.md`,
  `.claude/rules/*.md` and `CLAUDE.local.md` into the run's generated `CLAUDE.md`. When there
  is none, the only trace is the placeholder `*(no CLAUDE.md found in this project)*` inside a
  file nobody reads.
- A run's checkout is a git worktree, which **materializes only committed blobs**
  (run-context.mjs header, E6). Claude gets uncommitted memory because run-context reads the
  real directory; the other engines read their instruction files from the worktree, so an
  uncommitted `AGENTS.md` silently does not exist for Codex, Copilot or Cursor.
- Each harness reads **different files**. A repository well prepared for Claude Code
  (`CLAUDE.md`) can give Codex (`AGENTS.md`) or Copilot (`.github/copilot-instructions.md`)
  nothing at all, and the user picks the engine per run (`run.engine` in the settings cascade).
- Oversized instruction files are truncated by Worca (`contextMaxBytesPerFile`,
  `contextMaxBytesTotal`) and cost tokens on every turn of every agent.
- An agent that cannot find the test command guesses it, runs the wrong thing, or skips
  verification. That shows up later as extra review cycles, which are the most expensive part
  of a pipeline run.

The cost and duration of every run are already recorded (Stats, Team metrics). Nothing links
them to the state of the repository the run worked on.

## 2. Goals

- A **readiness report** per project: a fixed catalog of checks, each `pass | fail | skip |
  error`, with a severity and a one-line fix.
- A **level per used engine**: `ready | partial | not-ready | unknown`, because the files that
  matter differ per harness. An engine the project does not use (§4.6) gets no level, only
  `unused`, so the expected case of a team on one tool is fully green.
- A **repository level** for the checks that are the same for every tool (test command,
  lockfile, …), evaluated and shown once.
- A **chip** on the Projects page and in the project settings, showing the worst of the used
  engines' levels and the repository level, with the full breakdown one click away.
- Computed **on add** and kept **current for existing projects** without a scan storm: the
  result is cached against the repository's HEAD and recomputed when HEAD moves.
- **Never blocking.** Readiness informs; it never refuses a project add or a run start.
- **Evidence.** Every run records the readiness of its project at start, so cost and
  review cycles can later be compared against readiness (§9).
- Per-project **ignore list**, so a team can mute a check that does not apply to them.

## 3. Non-goals (v1)

- An **agentic review** of instruction quality (does `AGENTS.md` say true and useful
  things?). It costs a model run; it is phase 2 (§10).
- A **Fix** action that writes missing files and opens a PR. Phase 2 (§10).
- A numeric score. Levels plus named failing checks only; a number invites gaming and false
  precision.
- Scanning file **contents** for secrets. v1 checks tracked *file names* only.
- Workspace-level readiness. A workspace aggregate (worst of its members, like
  `worstChipState`) is trivial to add later and is phase 2.
- Gating anything: runs, adds, policies, team settings.

## 4. Design

### 4.1 Architecture overview

```
 POST /api/projects ──(add)──┐
 project-sync 'changed' ─────┤                                   ┌─▶ ws 'readiness-changed' {projectKey}
 GET …/readiness?refresh=1 ──┼─▶ readiness/evaluate.mjs ─────────┤
                             │     facts.mjs  (one git ls-files, │
                             │       a few stats, package files) ├─▶ readiness/cache.mjs (memory, keyed by
                             │     checks.mjs (pure: facts → rows)│     projectKey + fingerprint)
                             │     engines.mjs (per-engine level) │
 run-harness (run start) ────┘                                   └─▶ run.json `readiness` snapshot (§4.8)
 GET /api/projects ─────────────▶ cache only (never computes) ─▶ `readiness` summary per project row
```

The new code lives in `src/core/repo-readiness/` (not `readiness`: `src/core/engines/readiness.mjs`
already means "engine signed in and runnable", and the two must not be confused):

| Module | Purpose | Depends on |
|---|---|---|
| `facts.mjs` | Collect the facts every check reads, once per evaluation: tracked file list (`git ls-files -z`), HEAD sha, a fingerprint, sizes of candidate instruction files, parsed `package.json` / `pyproject.toml` / `Makefile` targets, `git check-ignore` for known heavy dirs present on disk. | `node:fs`, `git` via the same spawn helpers `git-sync.mjs` uses |
| `checks.mjs` | The catalog: an array of `{id, title, scope, severity, engines, run(facts) → {status, detail}}` plus fix text. **Pure** — no I/O. | facts shape only |
| `engines.mjs` | Per-engine instruction sources and the rule "which checks apply to this engine"; computes each engine's level, the repository level and the project level from check rows. | `engines/index.mjs#listEngines` |
| `used.mjs` | `usedEngines()`: which engines the project uses and why (§4.6), from settings, `run.engine`, run history and the facts. Read on every report read, not cached. | settings cascade, `db.mjs`, facts |
| `evaluate.mjs` | `evaluateReadiness({dir, projectKey, ignore})` → `ReadinessReport`. Never throws. | the three above |
| `cache.mjs` | In-memory cache keyed by `projectKey`, valid while the fingerprint matches; emits `'changed'`. | evaluate |

**Why not persist the report in the DB:** it is derived entirely from the repository on disk
(the same principle as `onboarding.mjs`: computed, never written by the client). Evaluation is
a handful of git spawns; recomputing after a server restart is cheaper than a migration. The
only persisted readiness data is the per-run snapshot (§4.8) and the `readiness.*` settings
(§4.7). Run history is read from columns that already exist (§4.6).

### 4.2 Facts and the fingerprint

`facts.mjs#collectFacts(dir)` runs, under one timeout (`INTERACTIVE_TIMEOUT_MS`):

1. `git rev-parse --show-toplevel HEAD` — not a repo → the `git.repo` check fails, everything
   else is `skip`.
2. `git ls-files -z` — the tracked set. Capped at 200 000 entries; past the cap the report
   carries `truncated: true` and size-based checks are `skip`.
3. `git status --porcelain -z -- <instruction candidates>` — which candidate instruction files
   exist but are untracked or modified.
4. `stat` of each candidate instruction file present on disk (bytes).
5. Read and parse, if tracked: `package.json`, `pyproject.toml`, `Makefile` / `makefile`
   (target names only), `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle(.kts)`, the
   workspace manifests `pnpm-workspace.yaml` / `package.json#workspaces`.
6. `git check-ignore --stdin` for the heavy directories that **exist on disk**:
   `node_modules`, `dist`, `build`, `out`, `target`, `.venv`, `venv`, `__pycache__`,
   `.next`, `coverage`.

**Fingerprint** = `HEAD sha` + a hash of the porcelain lines from step 3. A commit, a checkout,
or editing an instruction file changes it; editing ordinary source files does not. The cache
answers from memory while the fingerprint is equal; checking the fingerprint costs two git
spawns, so the Projects page can afford it on every open.

### 4.3 Check catalog (v1)

Severity: **blocker** makes the level `not-ready`; **warn** makes it `partial`; **info** never
changes the level, it is advice.

The catalog has two **scopes**:

- **tool** checks depend on which engine reads the repository. They are evaluated once per
  *used* engine (§4.6) and make up that engine's level.
- **repository** checks are the same for every engine. They are evaluated once and make up
  the repository level. They are never repeated per engine.

| id | Scope | Severity | Fails when | Fix text (abridged) |
|---|---|---|---|---|
| `instructions.present` | tool | blocker | none of that engine's instruction sources (§4.4) is tracked or present | Per tool. Claude Code: Add `AGENTS.md` (OpenAI Codex and GitHub Copilot read it too) or `CLAUDE.md`. OpenAI Codex: Add `AGENTS.md`. GitHub Copilot: Add `AGENTS.md` or `.github/copilot-instructions.md`. |
| `instructions.committed` | tool (codex, copilot, cursor) | warn | an instruction source for that engine exists on disk but is untracked or has uncommitted changes | Commit it: runs on this engine see only committed files. |
| `instructions.size` | tool | warn | one of that engine's instruction sources exceeds the effective `contextMaxBytesPerFile`, or their sum exceeds `contextMaxBytesTotal` | Trim it or split into `.claude/rules/*.md`; it is truncated and costs tokens every turn. |
| `git.repo` | repository | blocker | the folder is not inside a git work tree | Runs check out a git worktree; `git init` and commit. |
| `instructions.single-source` | repository | info | both `CLAUDE.md` and `AGENTS.md` are tracked and neither references the other (`@AGENTS.md` import, a symlink, or a mention of the other file name) | Keep one source of truth: put the content in `AGENTS.md` and `@AGENTS.md` from `CLAUDE.md`. |
| `commands.test` | repository | warn | no test command is discoverable (§4.5) | Add a `test` script/target, or name the command in the instruction file. |
| `commands.build` | repository | info | a build step is expected for the detected ecosystem but none is discoverable | Same as above, for build. |
| `commands.lint` | repository | info | no lint/format command is discoverable | Same as above, for lint. |
| `deps.lockfile` | repository | warn | a dependency manifest is tracked without its ecosystem's lockfile | Commit the lockfile so an agent's install matches CI. |
| `ignore.heavy-dirs` | repository | warn | a heavy directory exists on disk and is not ignored | Add it to `.gitignore`; agents read and grep it otherwise. |
| `secrets.tracked-names` | repository | warn | a tracked path matches `.env`, `.env.*` (not `.env.example`/`.env.sample`/`.env.template`), `*.pem`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `*.keystore`, `credentials.json` | Remove it from the repo and rotate it: agents read the file and send it to the model provider. |
| `repo.map` | repository | info | the repo is a multi-package monorepo (workspace manifest, or ≥ 3 tracked `package.json`/`pyproject.toml`/`go.mod`/`Cargo.toml` below the root) and no tracked instruction file of any engine mentions at least half of the package directories by name | Add a short map of the packages to the instruction file. |

**Every check returns a `detail` when it passes too**, saying what it found ("`npm test` in
package.json", "`CLAUDE.md`, 6 KB"). The popover lists passed checks with that reason (§5).

The catalog is versioned (`CATALOG_VERSION`, an integer bumped on any change to ids, rules or
scopes) so a run snapshot (§4.8) says which rules it was judged by.

### 4.4 Per-engine instruction sources

Each engine's sources are declared **next to its adapter**, the way `CURSOR_PROJECT_FILES`
already is, and imported by `repo-readiness/engines.mjs`. A new adapter without a declaration
gets `instructions.*` as `skip` and its level from the other checks only.

| Engine | Sources (any one satisfies `instructions.present`) | Export |
|---|---|---|
| claude | `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md`, `CLAUDE.local.md` (the run-context set); with none of `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, it reads `AGENTS.md` and `.claude/AGENTS.md` instead (Claude Code v2.1.277+) | `CLAUDE_INSTRUCTION_FILES` in `engines/claude.mjs` (or reuse run-context's list) |
| codex | `AGENTS.override.md`, else `AGENTS.md`: Codex reads only the first non-empty one per directory, so an empty file counts as missing and only the file it reads is sized and checked for commit | `CODEX_INSTRUCTION_FILES` in `engines/codex.mjs` |
| copilot | `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `GEMINI.md`; the CLI combines every one it finds, so all of them count toward the size budget | `COPILOT_INSTRUCTION_FILES`, `COPILOT_INSTRUCTION_GLOBS` in `engines/copilot.mjs` |
| cursor | `.cursor/rules/**/*.mdc` (a plain `.md` there is ignored), `AGENTS.md`, `CLAUDE.md` at the project root | `CURSOR_INSTRUCTION_FILES`, `CURSOR_INSTRUCTION_GLOBS` in `engines/cursor.mjs` |

Sources for the table (each CLI's own documentation; Worca runs the CLIs, so IDE-only behavior does not count):

- Claude Code: https://code.claude.com/docs/en/memory#agents-md
- OpenAI Codex: https://learn.chatgpt.com/docs/agent-configuration/agents-md (was developers.openai.com/codex/guides/agents-md); `AGENTS.override.md` replaces `AGENTS.md` in its directory, 32 KiB combined by default (`project_doc_max_bytes`)
- GitHub Copilot CLI: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions. The IDE page (https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/customize-copilot/configure-custom-instructions/add-repository-instructions-in-your-ide) lists fewer files per IDE; it does not apply to runs.
- Cursor CLI: https://cursor.com/docs/cli/using#rules (reads `.cursor/rules`, plus `AGENTS.md` and `CLAUDE.md` at the project root) and https://cursor.com/docs/rules (rule files are `.mdc`; keep each under 500 lines)

**Verify before relying on these.** The adapters state their facts against a named CLI version
("checked against @github/copilot 1.0.92", "codex-cli 0.146 and 0.154"). The implementation
must confirm, in the same style and against the same versions, that each CLI loads these files
from a worktree cwd, and record the version next to each export. A source not confirmed is left
out, not guessed.

`CLAUDE.local.md` is untracked by convention, so it is exempt from `instructions.committed`, and
Claude is exempt from that check entirely (run-context reads the real directory).

### 4.5 Command discovery

`commands.test`, `commands.build` and `commands.lint` pass when any of these holds:

| Ecosystem (detected by tracked manifest) | test | build | lint |
|---|---|---|---|
| `package.json` | `scripts.test` present and not npm's default `echo "Error: no test specified" && exit 1` | `scripts.build` | `scripts.lint` or `scripts.format` or `scripts.check` |
| `pyproject.toml` | `[tool.pytest.ini_options]`, or `pytest`/`tox`/`nox` in deps, or `tox.ini`/`noxfile.py` tracked | n/a (pass) | `[tool.ruff]`, `[tool.black]`, `[tool.flake8]`, or `.flake8`/`ruff.toml` tracked |
| `go.mod` | pass (`go test ./...` is implicit) | pass | `.golangci.yml`/`.golangci.yaml` tracked |
| `Cargo.toml` | pass (`cargo test`) | pass | pass (`cargo clippy`) |
| `pom.xml` / `build.gradle(.kts)` | pass (`mvn test` / `gradle test`) | pass | info only |
| `Makefile` (any ecosystem) | a `test`/`check` target | a `build`/`all` target | a `lint`/`fmt`/`format` target |
| any | an instruction source contains a fenced or inline code span with the word `test` (resp. `build`, `lint`) | | |

No manifest and no Makefile → `commands.*` are `skip` (a docs-only repository is not penalized).
`commands.build` is `skip` for ecosystems marked n/a.

### 4.6 Which tools the project uses

Most teams use one tool. A missing `AGENTS.md` costs nothing to a team that never runs Codex,
so a tool is judged only when the project uses it. `repo-readiness/used.mjs#usedEngines({dir,
projectKey, facts})` returns every engine with `used` and the reasons for it.

**Each tool has a setting with three states**, `readiness.tools` (§4.7):

| State | Meaning | Reason shown |
|---|---|---|
| `detect` (default; a tool not listed is `detect`) | Used when one of the signals below holds | the signal, e.g. "used in 3 runs" |
| `used` | Always judged, whatever the signals say | "set by you" |
| `unused` | Never judged, whatever the signals say | named in the popover's "Not judged" line |

The setting is per tool, so marking one tool never switches off detection for the others.
**The tool Worca runs with is the one exception:** the engine `run.engine` resolves to is always
judged, even if it is set to `unused`, because hiding it would hide the readiness of the tool
every run uses. Its row says why, and the UI does not offer "Not used here" for it (§5).

**Signals for a tool in `detect`.** It is used when any of these holds:

| Signal | Reason shown | Source | Notes |
|---|---|---|---|
| Worca's runs use it | "runs use it" | effective `run.engine` (`resolveRunEngine`, settings cascade: project, user, team, default `claude`) | Always yields exactly one engine. The built-in default counts, because it is what a run will use. |
| A run on this project used it in the last 90 days | "used in N runs" | `runEngineCounts` over `RUN_ENGINE_SQL` (below) | Covers teams that pick the engine per run without changing the setting. |
| The repository has that tool's own instruction file | "‹file› in repo" | `facts.mjs`: tracked `CLAUDE.md` or `.claude/CLAUDE.md` → claude; `.github/copilot-instructions.md` or `.github/instructions/**` → copilot; `.cursor/rules/**` → cursor | Covers developers who use the tool directly in their editor, outside Worca. |

**`AGENTS.md` alone marks no engine as used.** Codex, Copilot and Cursor all read it, so it
says nothing about which one the team uses. Codex has no file of its own (`AGENTS.override.md`
is a local override, not a team signal), so Codex is used only through its setting,
`run.engine` or run history.

**Why a "not used" state is needed.** Detection can be wrong in one direction: a leftover
`.github/copilot-instructions.md` from an old experiment, or one trial run on Codex, makes a tool
count as used and can turn the chip red for a tool the team dropped. `unused` is how a person says
so, and it holds until they change it.

**Not a signal:** which engines are signed in on this instance (`engineReadiness()`). That says
what is installed on one machine, not what the team uses.

**Run history.** A run's engine is already queryable: `RUN_ENGINE_SQL` in `src/core/artifacts.mjs`
reads `outcome.runEngine`, else the resume point's `claude.engine`, and NULL means `claude`.
`runEngineCounts(projectKey, sinceIso)` groups the project's runs of the last `HISTORY_DAYS` (90)
by that expression, using `idx_pipelines_project_started`. No schema change. Ask Worca chats are
not a signal: `ask_threads` has no project link.

**Every engine that is not used** (except `mock`) is reported with level `unused`, with
its tool checks still evaluated so the popover can say what is missing if the team starts using
it. An engine locked by the credential broker (`engineLocks()`) is reported as `locked` and is
never used, whatever the signals say.

### 4.7 Levels, ignore list, settings

For each **used** engine: take its tool checks, drop checks in the ignore list; then `not-ready`
if any blocker fails, else `partial` if any warn fails, else `ready`. The **repository level** is
computed the same way from the repository checks. A check that ended in `error` (it threw, or
its git spawn timed out) never counts as a failure, but if `git.repo` or the fact collection
itself failed, every level is `unknown`.

The **project level**, which the chip shows, is the worst of the used engines' levels and the
repository level (`not-ready` > `partial` > `ready`). Unused and locked engines never affect it.

New settings in the cascade, edited in project settings:

```
readiness.ignore:  string[]   // project layer. Check ids; unknown ids are kept (a newer catalog may know them)
readiness.tools:  { [engine]: 'used' | 'unused' }   // project layer (team layer: follow-up); a missing engine = 'detect'
```

`readiness.tools` resolves **per tool**, not as one value: for each engine, the project layer's
entry wins, then the team layer's, then `detect`. A team can say "we never use GitHub Copilot"
once, and one project can still set it to `used`. The cascade entry needs a custom reader for
this (the other cascade ids resolve as a single scalar); `PATCH /api/projects/:key/settings`
writes one tool's entry, and writing `detect` deletes the entry. Unknown engine names are kept,
like unknown check ids.

**Implemented now: the project layer only.** The team layer of `readiness.tools` (and its Team
policy rows) is a follow-up: team values go through the policy field schema
(`src/core/policy/effective.mjs#FIELDS`) and the Team policy page, which is its own piece of work.

The popover writes only one value: "Not used here" sets the project layer's entry to `unused`,
and its toast's **Undo** restores the previous value. Every other change (`used`, back to
`detect`, or undoing `unused` later) is made in project settings, so each choice has one home.

Instance kill switch: env `WORCA_READINESS=0` disables evaluation, routes return
`{disabled: true}`, and the chip is hidden.

### 4.8 Run snapshot

At run start, after the checkout exists, run-harness reads the cache (computing if missing, with
the same timeout; a failure records nothing) and writes into `run.json`:

```json
"readiness": { "catalogVersion": 1, "engine": "codex", "level": "partial",
               "failing": ["instructions.committed", "commands.test"] }
```

`engine` is the run's engine. `level` is the worst of that engine's tool level and the repository
level, and `failing` lists both scopes' failing ids. The run's engine is judged here even if the
report calls it `unused`: a run on it is the strongest evidence of use. Only ids are stored,
never details or file paths. The run card shows nothing new in v1; the snapshot is for the
analysis in §9.

### 4.9 Report shape and API

```ts
type Level = 'ready' | 'partial' | 'not-ready' | 'unknown';
type ReadinessReport = {
  projectKey: string; dir: string; headSha: string | null; fingerprint: string;
  checkedAt: string; catalogVersion: number; truncated?: true; error?: string;
  level: Level;                                  // the project level (§4.7): what the chip shows
  repository: { level: Level; failing: string[] };
  engines: Record<string, {
    used: boolean;
    setting: 'detect' | 'used' | 'unused';         // the resolved readiness.tools entry (§4.7)
    detected: boolean;                             // whether a signal holds, whatever the setting
    reasons: Array<{ kind: 'setting'|'run-engine'|'history'|'file'; text: string }>;   // e.g. "used in 3 runs"
    level: Level | 'unused' | 'locked';          // 'unused' for an engine that is not used
    failing: string[]; locked?: string }>;
  checks: Array<{ id: string; title: string; scope: 'tool'|'repository'; severity: 'blocker'|'warn'|'info';
                  engine?: string;               // set on tool-scope rows: one row per engine
                  status: 'pass'|'fail'|'skip'|'error'|'ignored';
                  detail?: string;               // why it failed or passed, e.g. "AGENTS.md is untracked"
                  fix: string }>;
};
```

The report is cached by fingerprint (§4.2), but the used-engine signals are not part of the
fingerprint: they come from settings and the run table. `cache.mjs` therefore stores the check
rows and recomputes `engines[*].used`, the levels and `level` on every read. That is cheap (one
settings read and one indexed query) and means a settings change or a new run never needs a
re-evaluation.

Routes in `ui/server.mjs`, beside the `/api/projects/:key/sync` group:

| Route | Behavior |
|---|---|
| `GET /api/projects/:key/readiness` | Cached report if the fingerprint matches, else evaluate. `?refresh=1` always evaluates. 404 for an unknown project; `{disabled:true}` under the kill switch. |
| `GET /api/projects` | Each row gains `readiness: {level, usedEngines, failingCount} \| null` **from the cache only**; never evaluates, so the list stays fast. `failingCount` counts failing blockers and warns across the used engines and the repository. |
| ws `readiness-changed` `{projectKey}` | Emitted when a re-evaluation or a change to `readiness.*` settings changes the project level, any used engine's level, or a failing set. |

The ignore list and the engine list go through the existing `PATCH /api/projects/:key/settings`.

### 4.10 When evaluation runs

| Trigger | What happens |
|---|---|
| Project added (`POST /api/projects`, `/bulk`, clone) | Evaluate in the background right after `addProject`, like `discoverProject`; emit `readiness-changed`. Bulk adds evaluate under `fanoutCap()`. |
| Projects page opened | The client asks `GET …/readiness` for rows whose summary is `null` or whose cache is stale, one at a time, visible rows first. This is how **existing projects** get a status without a startup scan. |
| `projectSyncEvents 'changed'` | Re-evaluate that project if its fingerprint changed (a fast-forward moved HEAD). |
| Run start | §4.8. |
| "Recheck" button | `?refresh=1`. |

There is no timer of its own and no startup sweep.

## 5. UI

The mockup linked at the top shows this section.

- **Projects page, project row:** a chip next to the sync chip, showing the project level (§4.7):
  - `ready`: a quiet "Agent-ready" in the green tone (D3), with no number.
  - `partial`: "Partly ready" plus a solid amber number disc with `failingCount`.
  - `not-ready`: "Not agent-ready" in the red tone, plus a solid red number disc with
    `failingCount`.
  - `unknown` or not yet computed: no chip.

  `failingCount` is the number of **open problems**: failing blocker and warn checks across the
  judged tools and the repository. Advice (`info`) never counts, so a green chip never has a
  number. The disc reuses the app's number-disc shape; its number is regular weight (500, not
  bold) and takes `--panel` so it reads in both themes. Like every label in Worca, the chip has
  no border or outline ring, also on hover (the branch's current `.pl-rd:hover` ring goes). Hovering the chip gives the breakdown, which is also the chip's accessible name:
  "1 must fix, 1 should fix. 5 of 9 checks pass."

  **Not "passed/total" on the chip** (D12): the total changes with which tools are judged, what is
  ignored and what does not apply, so the same project could read 8/11 and later 8/9 with nothing
  fixed; advice would make a ready project look incomplete; and a ratio reads as a score (§3).
  The ratio is shown in the popover instead, where it can be explained.
- **Status labels** everywhere in this feature use the existing pill shape (`.sync-pill`,
  `.hd-ov-chip`): green **Ready**, amber **Partly ready**, red **Not ready**, and grey
  **Not used** for an engine the project does not use. A used engine can be red; an unused one
  never is. Labels are text on a tinted pill with **no leading dot** and no border: the tint and
  the word carry the state, and the dot only cost width (the branch's `.rd-dot` in
  `readiness-chip.mjs` goes).
- **Chip click → popover**, anchored **below** the chip (`createFlyout` mode `down`, never over
  the chip or the sidebar), 460px wide, with a fixed header and footer and only the body
  scrolling. A sheet at narrow widths. Top to bottom:
  1. **Header:** "Agent readiness", the project name, the project level's label, and a link-style
     line "‹passed› of ‹applicable› checks pass" (the repository's checks plus each judged tool's
     own checks; skipped and ignored checks are left out). Clicking it opens "N checks pass" and
     scrolls to it.
  2. **Tools this project uses:** one row per used engine: its name (from `engineLabel()`), the
     reason it counts in muted text ("runs use it", "used in 3 runs", "`CLAUDE.md` in repo", "set
     by you"), its label, and for a failing engine the detail and the fix. Under it, one quiet
     text button, **Not used here** (sets `unused`, then shows the app's toast "‹tool› marked as
     not used" with an **Undo** button). The tool Worca runs with has no button; its row says "Runs use this tool.
     To stop judging it, change the engine in Settings."

     Below the rows, when any tool is not judged, one muted line: "Not judged: OpenAI Codex,
     GitHub Copilot. **Change in Settings**". The link opens the project settings at the Agent
     readiness card. Tools that are not judged get no rows, labels or buttons in the popover:
     choosing Used or Detect for them happens in settings.
  3. **Repository** ("Applies to every tool"): the failing repository checks, Must fix first,
     then Should fix, then Advice. Each row has a severity dot, title, detail, fix as plain text
     with inline code for file names, and a quiet **Ignore** text button on the row.
  4. **"N checks pass"**, collapsed: opens to list each passed check with its `detail`. The
     summary's green tick is the only mark: the rows have none of their own, and their text and
     dividers start where the summary text starts.
  5. **"N ignored for this project"**, collapsed, only when the ignore list is non-empty: each
     ignored check with a **Stop ignoring** button.
  6. **Footer**, always visible: "Checked 8 min ago", a **Settings** link (to the same card), and
     **Recheck**.

  The collapsed sections (4 and 5) share one box style: the same grey box, edges, padding,
  leading mark (a green tick for passed, a grey dot for ignored), text start and chevron position, so they line
  up as one group. Their open/closed state is kept while the popover is open. No engine
  tabs: tool rows are short enough to list together, and repository checks are not repeated.
- **Add project:** no new step and no blocking. When the background evaluation lands, the new
  row's chip appears. If a **used** engine is `not-ready`, a one-time toast: "‹name› is missing
  agent instructions for ‹engine› — see what to add". Unused engines never toast.
- **Project settings view** (`ui/public/project-settings-view.mjs`): an "Agent readiness" section
  with one row per tool and a three-way `.seg.seg-sm` control, **Detect / Used / Not used**, showing
  under it what Detect currently finds and whether the tool is judged (for example "Detect finds:
  copilot-instructions.md in repo. Not judged."). This is the only place to set Used or Detect; the tool Worca runs with has Not used disabled with the
  same hint as the popover. Then the ignore list as toggles. The team policy view's rows for the
  team layer are a follow-up (§4.7).
- **Getting-started checklist:** no new step in v1.

Copy rule: every failing row says what to do, in one line, in the product's voice. No scores
or percentages.

## 6. CLI

`worca-cc readiness [--project <key|path>] [--engine <name>…] [--json]` prints the report: the
used engines with their reasons, then one line per failing check with its fix, and exits `0`
when the project level is ready or partial, `2` for not-ready, and `1` for errors. `--engine`
(repeatable) judges exactly those engines, overriding §4.6, so a repository's CI can say which
tools it supports. The exit code makes it usable in a repository's own CI as a lint step. It reuses
`evaluateReadiness` directly, needs no server, and ignores the kill switch only with `--force`.

## 7. Error handling

- `evaluateReadiness` never throws. A failed fact collection gives `{error, level: 'unknown'}`
  with every level `unknown`; a failed run-history query drops only the history signal (the
  other signals still apply) and logs once; a single check that throws gives that row `status: 'error'` and a log line
  `[worca-ui] readiness <check>: <message>`.
- All git spawns share one deadline per evaluation; on timeout the facts collected so far are
  used and the remaining checks are `error`.
- A missing project folder (`exists: false`) is not evaluated; the row has no chip, as with sync.
- Concurrent requests for the same project share one in-flight evaluation (a per-key promise in
  `cache.mjs`).
- Large repositories: past the 200 000-file cap, `truncated: true` and size-dependent checks skip.

## 8. Testing

- `checks.mjs` is pure: table-driven unit tests, one fixture facts object per pass/fail/skip
  case of each check.
- `facts.mjs` and `evaluate.mjs`: tests against real temp git repositories built in the test
  (`test/helpers/temp-home.mjs`), covering untracked/modified instruction files, the ignore
  check, a non-repo folder, and the timeout path (injected spawn).
- `engines.mjs`: level computation per scope, the project level as the worst of used engines
  and repository, ignore list, locked engines, and an adapter without a declaration.
- `used.mjs`, table-driven: `used` and `unused` win over every signal, per tool, and setting one
  tool leaves the others on `detect`; project entries beat team entries per tool; the `run.engine`
  tool is judged even when set to `unused`; `run.engine` from each
  layer including the default; history inside and outside the 90-day window and `NULL` rows;
  each tool-specific file; `AGENTS.md` alone marks nothing; a locked engine is never used. A
  fixture for each row of the scenarios in the mockup (one tool set up, one tool without
  instructions, two tools) asserting the chip level, and that the expected one-tool case has no
  red label.
- Run history: `runEngineCounts` counts runs per engine inside the window; a NULL engine counts as
  `claude`.
- Cache: a change to `readiness.tools` or a new run changes `used` and the levels without a
  re-evaluation (spy on `evaluateReadiness`).
- Passed checks: every check returns a `detail` on pass.
- Routes: cache hit vs. refresh, `GET /api/projects` never evaluating (spy), kill switch, 404.
- Run snapshot: run-harness writes `readiness` into `run.json` in mock mode, and writes nothing
  when evaluation fails.
- CLI: exit codes and `--json` shape.
- A test asserting every non-mock adapter in `listEngines()` either exports instruction sources
  or is on an explicit allowlist, so a new engine cannot be silently skipped.

## 9. Measuring whether it matters

The snapshot in §4.8 makes this possible without new UI in v1. After a few weeks of runs, compare,
per engine and workflow, median cost, duration and review cycles of runs whose project was
`ready` against `partial`/`not-ready`, and per failing check id. That analysis decides which
checks keep their severity, which get dropped, and whether a "readiness vs. cost" panel in Stats
(phase 2) is worth building. If no difference shows up for a check, it is demoted to `info` or
removed: the catalog has to earn its place.

## 10. Phase 2 (not in this spec's implementation)

- **Agentic review**: a built-in workflow (`wf_readiness_review`, modeled on
  `wf_workspace_scan`) that reads the instruction files against the code and reports
  inaccuracies and gaps. Explicit, priced, user-started.
- **Fix with a PR**: a run that writes the missing `AGENTS.md`/Copilot instructions (deriving
  from `CLAUDE.md` where it exists), adds `@AGENTS.md` to `CLAUDE.md`, and opens a PR through the
  existing PR flow.
- **Workspace chip**: worst member level, like `worstChipState`.
- **Stats panel**: readiness vs. cost and review cycles, from the run snapshots.
- **Team policy**: a team-level ignore list or required level, via the existing policy home.

## 11. Decisions made in this spec (please confirm or override)

- **D1 — v1 is deterministic only.** No model calls; agentic review and Fix are phase 2.
- **D2 — Only used engines are judged** (§4.6), and the chip shows the worst of them and the
  repository level. Judging every engine would make the expected case, a team on one tool, show
  red for tools it never uses. *(Replaces the first draft's "chip shows the primary engine",
  which still repeated repository checks per engine.)*
- **D3 — `ready` shows a quiet chip** rather than nothing, so "checked and fine" differs from
  "not checked". Hiding it is a one-line change if the Projects row gets too busy.
- **D4 — The report is not persisted.** Only the run snapshot and the two `readiness.*`
  settings are. Cost: one evaluation per
  project after each server restart, done lazily.
- **D5 — The name is "agent readiness"** in the UI and `repo-readiness` in code, to stay
  distinct from the existing engine readiness (`engines/readiness.mjs`).
- **D6 — The CLI command is in v1.** It is small and makes the checks usable in CI.
- **D7 — `AGENTS.md` is not a usage signal**, and installed or signed-in engines are not either.
  Both would mark tools as used that the team does not use.
- **D8 — Run history needs no new column.** `RUN_ENGINE_SQL` already exposes each run's engine.
- **D9 — Each tool has a Detect / Used / Not used setting** (`readiness.tools`), replacing an
  all-or-nothing list of used engines. Detection can mistake a leftover file or a one-off run for
  use; "Not used here" corrects that for one tool without switching off detection for the rest.
- **D11 — Tools that are not judged get one line in the popover, not a section.** The popover
  shows results; project settings is where tools are chosen. A second place with "Use with this
  project" and "Detect automatically" buttons would duplicate the settings card. "Not used here"
  stays on judged rows because that is where a wrongly detected tool is noticed, and its toast
  covers the immediate undo.
- **D12 — The chip counts open problems, not passed/total.** A number disc with the failing
  blockers and warnings says how much work is left and is stable; passed/total moves with the set
  of judged tools and reads as a score. The ratio lives in the popover header.
- **D10 — Full engine names app-wide.** `engineLabel()` in `src/shared/engine-switch.mjs` says
  **Claude Code**, **OpenAI Codex**, **GitHub Copilot** and **Cursor**; every picker, run card and
  message follows, and the popover has no names of its own. `HARNESS_NAMES` in
  `src/shared/connections.mjs`, which existed only because the labels were short, is removed.
