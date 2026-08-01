# Worca CC

A **deterministic multi-agent pipeline** that drives Claude Code (headless) through
**Plan -> Refine -> Implement -> Review** for a software task. It ships three ways to
run the same pipeline: a **CLI**, an installable **`/worca` skill**, and a **web
UI**.

Plain Node.js ESM (`.mjs`), **Node `>=22.13.0`** — required by the built-in
`node:sqlite` store (flag-free from Node v22.13 LTS / v23.4+). Minimal dependencies:
`express` + `ws` only. The frontend is vanilla HTML/CSS/JS — no framework, no build step.

> The full, binding contract for every module, event, and on-disk file lives in
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Read it before changing any signature.

---

## What it is

You give the orchestrator a **project folder** and a **prompt** (or a markdown brief).
A deterministic state machine then runs the agents of the selected workflow in sequence, looping until the work
clears quality gates:

1. **Planner** writes an initial plan (with code snippets) and, instead of *assuming*
   anything, asks you conceptual questions — each with **2–4 options plus a free-text
   field**. The Q&A is appended to the plan so reviewers see it.
2. **Plan Refiner** reviews the plan (including its code snippets), writes a refined
   `-v2`, `-v3`, ... and re-runs until only minor/suggestion issues remain (or you
   approve continuing past the cycle cap).
3. **Implementer** follows the latest plan with no deviation, using TDD
   (red-green-refactor).
4. **Code Reviewer** reviews the git diff, writes a review, and hands back to the
   implementer to fix — looping Implement -> Review until only minor/suggestion issues
   remain (or you approve continuing past the cap).

Run state, history, and configuration are saved in a single **SQLite database**
(`~/.worca-cc/worca-cc.db`, via the built-in `node:sqlite`), while the agents' **markdown**
outputs (plans, reviews) and any attachments live alongside it in a **machine-wide
external store** (default `~/.worca-cc/store/<projectKey>/`). Both are keyed by repo
identity and kept **outside your project's working tree**, so nothing is ever committed to
your repo. See [Artifact layout](#artifact-layout) for details.

### Preflight tooling

Before planning, the orchestrator probes for optional graph tools and, if present,
tells the agents to use them:

- [`graphify`](https://github.com/safishamsi/graphify)
- [`code-review-graph`](https://github.com/tirth8205/code-review-graph)

If **both** are installed, it **always uses graphify**. All probes fail safe — a
missing tool never breaks a run.

---

## Install

```bash
npm install
```

Requires **Node `>=22.13.0`** (for the built-in `node:sqlite` store — run `nvm use` to
pick up the bundled `.nvmrc`) and the `claude` CLI on your `PATH` for real (non-mock) runs.

---

## Quick start

### CLI

Run a pipeline against a project folder:

```bash
npm run cli -- --project /path/to/your/project --prompt "Add a /search endpoint"
```

Or use a markdown brief as the prompt:

```bash
npm run cli -- --project /path/to/your/project --file ./brief.md --title "Search feature"
```

Useful flags: `--model <m>`,
`--permission-mode <m>`, `--yes`/`--non-interactive` (auto-answer clarify with the
first option and gates with "continue"). See `docs/ARCHITECTURE.md` §4.1 for the full
list.

### Web UI

```bash
npm start
```

Then open the printed URL (default `http://localhost:4317`). The UI lets you:

- start a run from a **prompt or markdown document**, pointed at any **project folder**,
  with optional extra files;
- watch a **steps tracker** (preflight / plan / refine #N / implement / review #N /
  done);
- answer **clarify questions** (2–4 options + free text) and **loop gates** ("Don't have
  another cycle and continue" / "I approve another cycle", with the open critical/major
  issues shown);
- follow a **live streaming log**;
- **Pause** or **Stop** a run;
- browse **history** of past pipelines and read their saved markdown.

There's also an **"Install agents into this folder"** button that copies the agents +
skill into a target project so you can use `/worca` there.

### Pause & resume

A running pipeline can be **paused** and continued later — even from a fresh process:

- **Web UI** — every run card has a **Pause** button next to Stop; a paused pipeline
  shows an amber **Paused** badge in history, and its history card gets a **Resume**
  button.
- **CLI** — the first `Ctrl+C` pauses gracefully (a second stops, a third hard-exits).
  Continue later with:

```bash
npm run cli -- resume <pipelineId>
# or, with the bin on your PATH: worca resume <pipelineId>
```

Pause is graceful: in-flight Claude steps are terminated, the per-pipeline **worktree
is kept** (uncommitted agent work survives), and a **resume point** is persisted to the
database — so resume **survives server restarts** (it rehydrates entirely from the DB).
On resume, interrupted steps **re-attach their Claude session** via
`claude --resume <session_id>`; if the session is gone, the step re-runs fresh and the
fallback is noted in the run's audit log.

### `/worca` skill (inside your own project)

Copy the agents and the skill into your project's `.claude/`:

```bash
npm run install:agents -- /path/to/your/project
# or: node scripts/install.mjs /path/to/your/project [--force]
```

Then open Claude Code in that project and run:

```
/worca Add a /search endpoint with pagination
```

The skill starts the same deterministic orchestrator script.

### Mock demo (offline, no tokens)

The whole pipeline can run **fully offline** without spawning `claude` — it produces
real artifact files using a deterministic mock:

```bash
npm run smoke
```

This is equivalent to:

```bash
WORCA_MOCK=1 node src/cli/worca-cc.mjs --project examples/sandbox --prompt "demo task" --mock --yes
```

Set `WORCA_MOCK=1` (or pass `--mock`) on any run to use the mock path.

---

## The agents

| Agent | File | Role |
| --- | --- | --- |
| Planner | `agents/worca-cc-planner.md` | Initial plan with code snippets; asks conceptual questions (2–4 options + free text) instead of assuming; appends Q&A to the plan. |
| Plan Refiner | `agents/worca-cc-plan-refiner.md` | Reviews + refines the plan (and its code snippets); writes `-vN`; emits a severity-tagged review per cycle. |
| Plan Review | `agents/worca-cc-plan-reviewer.md` | Reviews the plan (without rewriting it); writes review markdown + JSON; on blocking issues bounces back to the planner for a cold re-plan. |
| Implementer | `agents/worca-cc-implementer.md` | Follows the latest plan with no deviation; TDD red-green-refactor; also runs in "fix" mode against a review. |
| Code Reviewer | `agents/worca-cc-code-reviewer.md` | Reviews the git diff; writes review markdown + JSON; hands back to the implementer to fix. |

Worca CC now ships **7 runnable agents** and the agent system is **data-driven**:
each agent is a prompt (`agents/worca-cc-<role>.md`) plus a metadata sidecar
(`agents/<key>.meta.json`), so new agents drop in without engine edits. Beyond
the five above, it adds **Manual Tests Checklist** (drafts manual test cases) and
**Manual web UI testing** (runs them against the live web UI via Playwright and
emits a pass/fail verdict). To add your own, see
[`docs/ADDING-AGENTS.md`](docs/ADDING-AGENTS.md).

---

## The phases and loops

- **Clarify** — planner asks one round of conceptual questions (up to four) before
  planning; answers are persisted and appended to the plan.
- **Refine loop** — Refiner runs repeatedly. It stops when no `critical`/`major` issues
  remain. Past the loop's **max cycles** (default 3) it asks you to **continue** or approve
  **another** cycle, escalating indefinitely.
- **Review loop** — Reviewer -> Implementer(fix) -> Reviewer ... stops when no
  `critical`/`major` issues remain. Past the loop's **max cycles** (default 3) it asks the
  same continue/another gate.

Each feedback loop's max-cycle count is set per loop in the New Pipeline window's
**Pipeline configuration** (default 3), not via a CLI flag.

A run is "blocked" only by `critical` or `major` issues; `minor`/`suggestion` issues do
not hold up the loop.

## Pipeline Composer

The phases above are the **default** pipeline. The **Pipeline Composer** (a view
in the web UI) lets you compose your own: drag agents onto a canvas to build
**sequential steps**, **parallel groups** (a step with more than one agent runs
concurrently), and **feedback loops** (an agent that emits a verdict can loop
back to an earlier step until it passes or hits a cycle cap). Save a layout by
name and it becomes selectable from **New Pipeline**, where you also pick each
agent's model/effort and each loop's cycle count.

The engine is data-driven: it executes whatever workflow you select. The default
workflow reproduces exactly the `Plan → Refine → Implement → Review` behavior
described above, and **Reset to default** on the canvas redraws it. Workflow topology and
per-project model/effort/cycle choices are stored in the central SQLite database
(`~/.worca-cc/worca-cc.db`) — no longer in `~/.worca-cc/workflows/` or
`<projectDir>/.worca-cc/config.json`.

To add a new agent to the palette, see [`docs/ADDING-AGENTS.md`](docs/ADDING-AGENTS.md).

---

## Per-project guardrails

Every project row in the Projects view expands into a guardrails panel
(stored in worca's DB — no migration, older versions ignore it). Pick a level:

- **Permissive** (default) — no restrictions; byte-identical behavior to an
  unconfigured project.
- **Normal** — protects credential files (`.env*`, `*.pem`, `*.key`, SSH keys,
  cert stores) from agent Read/Edit and blocks publication commands
  (`git push`, `npm/yarn/pnpm publish`). Never breaks a pipeline: commits,
  installs, tests, and `curl localhost` all still work.
- **Secure++** — Normal plus: environment scrub on agent spawn (the spawned
  `claude` gets a minimal env: base vars, the proxy/CA connectivity vars
  `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`/`NODE_EXTRA_CA_CERTS`/`SSL_CERT_*`,
  every `ANTHROPIC_*`/`CLAUDE_*` var, and your allowlist — nothing else),
  network egress binaries denied (`curl`, `wget`, `nc`, `ssh`, `scp`, `rsync`, …),
  `gh`/`docker push` and cloud CLIs (`aws`, `gcloud`, `az`) denied,
  `WebFetch`/`WebSearch` denied, and home-dir credential stores (`~/.ssh`,
  `~/.aws`, `~/.config/gh`, `~/.git-credentials`, …) protected from the
  Read/Edit tools.
- **Custom** — the moment you edit anything, the panel switches to Custom;
  Save persists your exact settings. Your custom blob survives switching back
  to a preset (it stays dormant until you select Custom again).

Preset levels track worca upgrades automatically (they resolve from worca's
code, not a snapshot); Custom pins your settings verbatim.

How it's enforced: protected paths and deny rules become Claude Code
`permissions.deny` rules in a single `--settings` payload on every pipeline
spawn (deny rules merge across scopes and cannot be removed by lower scopes —
repo settings can't undo worca policy, plugin-granted tools remain subject to
it). Protected paths expand to `Read(p)` + `Edit(p)` denies (Edit covers
Write/NotebookEdit; a `Write(p)` rule is never consulted and only produces
CLI warnings, so it is not emitted). Workspace runs enforce the deny-safe
UNION of all member projects' guardrails — one Secure++ member hardens the
whole run, and the workspace scanner spawns under that same union. Repo
`.claude/settings.json` `permissions` are honored: natively on
single-project runs (cwd is the project worktree — the toggle can only decide
whether they're *lifted*, it cannot un-load what the worktree loads itself);
on **detached workspace runs (the default)** each member's own `deny` rules
are lifted per-member into the merged `--settings` (a member set to *not*
honor keeps its rules out; `allow`/`ask` rules are never lifted — that would
widen capability and bypass Claude Code's workspace-trust gate; hooks and
statusline still don't apply off-worktree and stay warned). A paused run
re-reads guardrails on resume, so it enforces the latest saved policy.

Honest limitations:
- `Read` denial is the load-bearing secret guard; Claude Code does not consult
  `Write(path)` rules (so worca emits `Read`+`Edit` only), and Bash denies are
  prefix matches — `sh -c "curl …"`, `/usr/bin/curl`, and `git -c k=v push`
  evade them (a leading `VAR=val` or a `timeout`/`nice` wrapper does *not*).
  Env scrub is the real exfil control, but it is **not containment**: with
  `HOME` retained, credential *files* stay readable to any subprocess an agent
  spawns (`node -e` + `fetch`), so deny rules alone don't stop indirect reads —
  for OS-level enforcement use Claude Code's sandbox (out of scope here).
- Env scrub failing a pipeline that needed an unlisted var fails visibly
  (tool errors in the transcript) — add the var to the allowlist; there is no
  silent fallback. Common cases: a corporate TLS-intercepting proxy already
  survives (proxy/CA vars are kept), but **Bedrock/Vertex/Foundry auth needs
  you to allowlist the cloud credential vars** (`AWS_*`,
  `GOOGLE_APPLICATION_CREDENTIALS`, `AZURE_*`), and a run that needs
  git-over-SSH or takes its git identity from the environment must allowlist
  `SSH_AUTH_SOCK` / the relevant `GIT_*` names — neither is in the base
  keep-list. Worca deliberately does **not** set the CLI's own
  `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` marker: on current CLIs setting it forces
  the child's permission mode back to `default`, overriding worca's
  `--permission-mode acceptEdits` and breaking scrubbed pipeline runs.
- Secure++ denies `curl`, which the manual web-UI-testing agent uses to poll a
  dev server — it falls back to the `browser_*` MCP tools (not denied), so that
  flow degrades rather than breaks. `.env*` also matches `.env.example` /
  `.env.sample`, which agents may legitimately edit; a deny list can't carve
  per-file exceptions, so those become read-only under Normal/Secure++ too.
- Exempt from scrub/deny: UI-triggered utility agents outside pipeline runs
  (overview generation, agent generation), the `graphify` graph-build
  subprocess, and the `claude --help`/`--version` capability probe. In-run
  title generation IS scrubbed.

---

## Artifact layout

Worca CC keeps **structured state** (projects, workspaces, workflows, per-project config,
run state + steps + audit events, clarify Q&A, review verdicts) in a single **SQLite
database**, and the agents' **markdown** outputs (+ any attachments) in a machine-wide
**external store**. Neither lives in your project's working tree, so nothing is ever
committed to your repo:

```
<worcaHome>/                            default ~/.worca-cc
  settings.json                         { root } only — the bootstrap that locates the DB
  worca-cc.db  (+ -wal, -shm)           ALL structured state (SQLite, WAL mode)
  backup-<ts>/                          legacy JSON archived on first upgrade (see below)
  store/<projectKey>/
    plans/      <DD-MM-YY>-<name>.md, -v2.md, ...   (plan markdown + refinements)
    reviews/    <DD-MM-YY>-<name>-impl-review.md     (review markdown)
    pipelines/  <DD-MM-YY>-<slug>-<id>/              (one folder per run)
      prompt.md          the prompt text (or copied markdown brief)
      extras/            any optional extra files you attached
```

Everything that used to be a per-run `.json`/`.md` control file —
`clarify.json`, `clarify-answers.json`, `*-review-cycleN.json`, `state.json`,
`pipeline.md`, plus `meta.json` and the per-project `config.json` and global
`workflows/*.json` — is now a **row in `worca-cc.db`** instead. Only the plan/review
**markdown**, `prompt.md`, and `extras/` remain on disk (their existence is indexed in the
database).

- **`<worcaHome>`** = `<base>/.worca-cc`, where `<base>` is `WORCA_HOME` if set, else
  the persisted "Worca CC root folder" from Settings, else your OS home. By default this is
  `~/.worca-cc`, so the DB is `~/.worca-cc/worca-cc.db` and the store is `~/.worca-cc/store/`.
- **`<projectKey>`** = `<repo-basename-slug>-<sha1(canonicalRoot)[:8]>`, derived from the
  repository's identity (the parent of its shared `.git`). It is **stable across all git
  worktrees of the same repo**, so every worktree shares one history.

**First-launch migration.** The first time you run this version, Worca CC imports any
pre-existing JSON state **found under `~/.worca-cc`** into `worca-cc.db` (in a single
transaction) and moves the consumed files into a timestamped `~/.worca-cc/backup-<ts>/`
directory (mirroring the old layout); this is one-way — the new version reads only the
database, so to roll back you stop Worca CC, restore the files from `backup-<ts>/`, and
downgrade. There is **no** migration from the pre-rebrand home directory that older,
differently-named releases used: this version only ever looks at `~/.worca-cc`, so if you
are upgrading you must move your old state there **by hand before the first launch** —
otherwise Worca CC simply starts up empty, with no warning. (Separately, any very old
`<projectDir>/ai-artifacts/` directories from before the external-store change are still
just left in place and ignored.)

Because state is machine-wide and keyed by repo identity, the web UI has an **"All
projects"** view (and `GET /api/history`) that lists runs across every project on the
machine — now backed by indexed SQL queries instead of a directory scan.

The exact table contracts are specified in `docs/ARCHITECTURE.md` §5.

---

## Project structure

```
src/core/        protocol, store, artifacts, preflight, claude-runner, phases, orchestrator
src/cli/         worca-cc.mjs (CLI entry)
scripts/         install.mjs (copy agents + skill into a target project)
agents/          agent prompts + .meta.json sidecars (data-driven set)
skills/          worca/SKILL.md (the /worca skill)
ui/              server.mjs + public/ (single-page web UI)
docs/            ARCHITECTURE.md (single source of truth)
```

Generated plans, reviews, and pipeline run folders are **not** part of this repo: they
live in the machine-wide external store at `<worcaHome>/store/<projectKey>/` (default
`~/.worca-cc/store/...`). See [Artifact layout](#artifact-layout).
