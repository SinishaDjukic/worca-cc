# Agent readiness

Worca checks whether a project is ready for the coding agents it runs, and says what to fix. The result is a
chip next to the project's name, in the Projects list and on the project page header:

- **Agent-ready**: every check that applies passes.
- **Partly ready** (with a count): only should-fix checks fail.
- **Not agent-ready** (with a count): a must-fix check fails.

Click the chip for the report: the tools this project uses, what each one is missing and how to fix it, the
repository checks, and the checks that pass or are skipped. **Recheck** runs the checks again; **Settings**
opens the project's Settings tab, where **View report** brings the report back.

The check reads the project folder and its git state. It never runs an agent and never changes the project.

## Which tools are judged

Only the tools a project uses are judged, so a project that only uses Claude Code is not marked "not ready"
because it has no Codex files. A tool counts as used when:

- **runs use it**: the project's Run engine, always;
- **the project has its own instruction file** (`CLAUDE.md`, `.github/copilot-instructions.md`,
  `.cursor/rules/`, `GEMINI.md`, `QWEN.md`, `.goosehints`). `AGENTS.md` alone marks no tool: several read it;
- **a run used it in the last 90 days**.

Each tool can be set to **Detect** (the default: Worca decides as above), **Used** or **Not used** in the
project's **Settings › Agent readiness** card, or with **Not used here** in the report (with Undo). The Run
engine cannot be set to Not used. The setting is `readiness.tools` in the project's settings, for example
`{ "readiness": { "tools": { "codex": "used", "cursor": "unused" } } }`.

## The checks

Repository checks run once:

| Check | Severity | Passes when |
|---|---|---|
| `git.repo` Git repository | must fix | the folder is a git work tree (runs check out a worktree of it) |
| `commands.test` Test command discoverable | should fix | a test command can be found: a package.json script, a Makefile target, pytest/tox/nox in pyproject.toml, or implied by Cargo.toml or go.mod |
| `commands.build` / `commands.lint` | advice | the same, for a build and a lint command |
| `deps.lockfile` Lockfile committed | should fix | each manifest has its lockfile tracked (`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `uv.lock`, `Cargo.lock`, `go.sum`, …) |
| `ignore.heavy-dirs` Heavy dirs ignored | should fix | `node_modules`, `dist`, `.venv` and the like are git-ignored |
| `secrets.tracked-names` No secret-looking tracked files | should fix | no tracked `.env`, private key (`id_rsa`, `id_ed25519`; a `.pub` is fine), `.pem`, `.p12`, keystore or `credentials.json` |
| `instructions.single-source` Single source of truth | advice | `CLAUDE.md` and `AGENTS.md` do not drift apart (one imports or names the other) |
| `repo.map` Monorepo map present | advice | a monorepo's instructions name its packages |

Tool checks run for each tool that is judged, on the files that tool reads:

| Check | Severity | Passes when |
|---|---|---|
| `instructions.present` | must fix | at least one of the tool's instruction files exists |
| `instructions.committed` | should fix | those files are committed: runs check out a worktree, which holds committed files only |
| `instructions.size` | should fix | each file is within 20 KB, and they total at most 64 KB |

The files each tool reads in a Worca run, from each tool's own documentation:

| Tool | Instruction files |
|---|---|
| Claude Code | `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md`, `CLAUDE.local.md` |
| OpenAI Codex | `AGENTS.override.md`, else `AGENTS.md` (the first non-empty one) |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `GEMINI.md` |
| Cursor | `.cursor/rules/**/*.mdc`, `AGENTS.md`, `CLAUDE.md` |
| Gemini CLI | `GEMINI.md` |
| Qwen Code | `QWEN.md`, `AGENTS.md` |
| goose | `AGENTS.md`, `.goosehints` |
| OpenCode | `AGENTS.md`, `CLAUDE.md` |

**Claude Code and `AGENTS.md`.** Claude Code reads `AGENTS.md` only when no `CLAUDE.md` is in its working folder
or above it, and a Worca run writes its own `CLAUDE.md` above the checkout. So in a run, Claude Code never reads
`AGENTS.md` by itself. To share one file between tools, keep the instructions in `AGENTS.md` and add a line
`@AGENTS.md` to `CLAUDE.md`: Worca resolves that import from the project folder.

Claude Code's files are read from the project folder itself, so for Claude Code an uncommitted file is fine.

## Folder projects

A Folder project (a plain folder without git, or any project when git is not installed) runs on a copy of the
folder, and Worca never runs git in it. Its check reads the files from disk: **Git repository** is skipped, and so
are the checks that need git (committed, ignored, tracked names). Uncommitted instruction files count, since the copy
holds them.

## Skipping a check

Switch a check on in **Settings › Agent readiness** to skip it for this project. It stays in the report as
skipped and never counts. The setting is `readiness.ignore`, a list of check ids, for example
`{ "readiness": { "ignore": ["repo.map"] } }`.

## When it checks

- when a project is added (a toast says so if it is not ready);
- when the Projects page or a project page asks for it, re-using the last result while the project's HEAD and its
  instruction files are unchanged;
- after a run ends, after its HEAD moves, after a readiness setting or the Run engine changes (project, user
  settings or team policy), and on **Recheck**.

A new run also records the result for its own engine in the run's details.

## From the terminal

```bash
worca readiness                          # the project in the current folder
worca readiness --project shop           # a registered project, by key or name, or a path
worca readiness --engine codex           # judge this tool only (repeat for more)
worca readiness --json                   # the full report
```

Exit codes: `0` ready or partly ready, `2` not ready (a judged must-fix check fails), `1` unknown or an error.

## Turning it off

Set `WORCA_READINESS=0` (or `false`) in the environment of `worca ui` and the CLI: no chips, no checks.
`worca readiness --force` runs the checks anyway.

## Git and security

Every git call the check makes goes through Worca's git guard (`src/core/git-guard.mjs`): a repository's own
config can never make it run a command (`core.fsmonitor`, a filter or diff driver, …). A repository whose config
the guard refuses shows every check as an error with the reason, and the result is unknown.
