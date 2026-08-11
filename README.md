# Worca CC

A **deterministic multi-agent pipeline** that drives Claude Code (headless) through a
**graph of agents** for a software task. You wire the graph; the engine runs it. It
ships three ways to run the same pipeline: a **CLI**, an installable **`/worca`
skill**, and a **web UI**.

Plain Node.js ESM (`.mjs`), **Node `>=22.13.0`** — required by the built-in
`node:sqlite` store (flag-free from Node v22.13 LTS / v23.4+). Minimal dependencies:
`express` + `ws` only. The frontend is vanilla HTML/CSS/JS — no framework, no build step.

---

## What it is

You give the orchestrator a **project folder** and a **prompt** (or a markdown brief),
and pick a **pipeline** — a saved graph of agent nodes wired together. The engine is
fully generic: it knows nothing about any particular agent. It reads each node's
**typed ports** off that agent's metadata sidecar and fires a node as soon as its
inputs are satisfied, so the graph you drew *is* the control flow.

The shipped default graph reproduces the classic sequence — **Clarify -> Plan ->
Refine -> Implement -> Review** — with the refiner looping on itself and the reviewer
looping back into the implementer until neither reports a `critical`/`major` issue:

1. **Clarify** asks conceptual questions — each with **2–4 options plus a free-text
   field** — instead of *assuming* anything. The Q&A is appended to the plan.
2. **Planner** writes an initial plan with code snippets.
3. **Plan Refiner** reviews the plan (including its snippets), writes a refined `-v2`,
   `-v3`, ... and re-runs until only minor/suggestion issues remain (or you approve
   continuing past the cycle cap).
4. **Implementer** follows the latest plan with no deviation, using TDD
   (red-green-refactor).
5. **Code Reviewer** reviews the git diff, writes a review, and hands back to the
   implementer to fix — looping until only minor/suggestion issues remain (or you
   approve continuing past the cap). Its clean review lands on the **End** node,
   whose payload is the run's result.

Swap, delete, or re-wire any of those nodes in the Composer and the engine follows
without a code change.

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
`--permission-mode <m>`, `--workflow <id>` (pick a saved pipeline; default
`wf_default`), `--yes`/`--non-interactive` (auto-answer clarify with the first option
and gates with "continue"). Run `worca --help` for the full list.

### Web UI

```bash
npm start
```

Then open the printed URL (default `http://localhost:4317`). The UI lets you:

- start a run from a **prompt or markdown document**, pointed at any **project folder**,
  with optional extra files;
- watch the **run graph** light up node by node, with per-node cycle counts;
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
| Clarify | `agents/worca-cc-clarify.md` | Asks conceptual questions (2–4 options + free text) before anything is assumed; emits the answers as JSON. |
| Planner | `agents/worca-cc-planner.md` | Initial plan with code snippets; folds the clarify answers into a Q&A section. |
| Plan Refiner | `agents/worca-cc-plan-refiner.md` | Reviews + refines the plan (and its code snippets); writes `-vN`; emits a severity-tagged review per cycle. |
| Plan Review | `agents/worca-cc-plan-reviewer.md` | Reviews the plan (without rewriting it); writes review markdown + JSON; on blocking issues bounces back to the planner for a cold re-plan. |
| Decomposer | `agents/worca-cc-decomposer.md` | Splits a plan into independent task files; its output **fans the implementer out** into one node run per task. |
| Implementer | `agents/worca-cc-implementer.md` | Follows the latest plan with no deviation; TDD red-green-refactor; also runs in "fix" mode against a review. |
| Code Reviewer | `agents/worca-cc-code-reviewer.md` | Reviews the git diff; writes review markdown + JSON; hands back to the implementer to fix. |
| Manual Tests Checklist | `agents/worca-cc-manual-tests-checklist.md` | Drafts manual test cases from the plan and the implemented diff. |
| Manual web UI testing | `agents/worca-cc-manual-web-ui-testing.md` | Runs that checklist against the live web UI via Playwright; emits a pass/fail verdict. |
| Workspace Scan | `agents/worca-cc-workspace-scanner.md` | Off-pipeline: describes how a workspace's member repos interconnect. |
| Workspace Review | `agents/worca-cc-workspace-reviewer.md` | Reviews a change across every member repo of a workspace run. |

Worca CC ships **11 agents** and the agent system is **data-driven**: an agent is a
prompt (`agents/worca-cc-<role>.md`) plus a metadata sidecar (`agents/<key>.meta.json`)
that declares its **typed ports** and its capability flags. The engine never names an
agent — it reads ports. Dropping a new sidecar in adds a node to the palette with no
core edit, and the **Agents** view in the web UI writes one for you.

Capabilities a sidecar can declare (all optional): `verdict` (emit a severity-tagged
review JSON, which unlocks conditional `blocking`/`clean` outputs), `sideEffect: 'code'`
(the node writes to the working tree), `wantsRequest` (inject the original request text),
`fanOut` (spawn parallel sub-agents), `workspaceFanOut` / `workspaceStrategy` (how the
node behaves on a multi-repo workspace run), `askQuestions` (ask-then-resume mid-run),
and `placeable: false` (usable by the engine, hidden from the palette).

---

## The pipeline model

A pipeline is a **directed graph**, not a list of phases. It has three kinds of parts.

**Nodes.** An **agent node** runs one agent. Five **flow cards** carry no agent:

| Card | What it does |
| --- | --- |
| **Task** | The source. Holds the user's prompt/brief; exactly one per pipeline. |
| **End** | The sink. Exactly one per pipeline; whatever lands on its `result` input is the run's result. |
| **AND** | Pure synchronizer. Fires once every one of its inputs is fresh; emits `void`. |
| **OR** | Payload valve. Fires when *any* input is fresh and forwards that payload onward. |
| **Combine** | Concatenates its markdown inputs into one document. |

**Ports.** Every node declares typed inputs and outputs — `md`, `json`, `any`, or
`void`. A wire is legal only when the types agree (`any` accepts anything). Agents
declare their ports in their sidecar; the flow cards get theirs from their kind. On
top of its declared inputs, **every agent node also gets a universal `await` gate
port**: wire anything into it and the node simply waits for that signal before
running, without consuming a payload. That is how you sequence two nodes that
exchange no artifact.

**Wires.** An output may fan out to as many inputs as you like, but **every input
accepts exactly one wire**. To fan *in*, drop an **OR** card: it takes N inputs and
forwards whichever payload arrived most recently. That is why the loop templates
route both the first-pass and the fix-pass edges through an OR rather than wiring two
sources into the same input.

A node fires when its required inputs are satisfied, so **the graph is the control
flow** — there is no phase list to keep in sync. Loops are just cycles in the graph:
an output marked `blocking` wired back into an input marked `loop` is a feedback edge,
and its wire carries a **`maxCycles`** budget (default 3). When a loop hits its cap the
run asks you to **continue** or approve **another** cycle. A run is blocked only by
`critical` or `major` issues; `minor`/`suggestion` never hold up a loop.

Before a pipeline can be saved or run it goes through one shared validator (rules
**V1–V21**) covering id/type/wiring legality, cardinality, cycle liveness, deadlock
freedom, and the Task/End bookends. Errors block the save; warnings (unreachable
node, no-op `awaitAll`, unknown config key, double-fire risk, a blocking output wired
into a non-loop input) are advisory.

### Pipeline Composer

The **Composer** (a view in the web UI) is where you draw that graph: drag agent
pills and flow cards from the palette onto the canvas and connect ports. Save a
layout by name and it becomes selectable from **New Pipeline**, where you also set the
**run parameters** — per-node model and effort, per-node fan-out and ask-questions
toggles, and each loop wire's cycle cap. Seven pipelines ship pre-drawn (Full, No
Clarify, Provided Plan, FULL-NO-Decompose, Quick Fix, Clarify -> Implement, Clarify ->
Quick Fix) alongside the default.

Custom agents are first-class here: the **Agents** view writes a sidecar with your
ports and capability flags, and it appears in the palette immediately — the engine
needs no edit, because it only ever reads ports.

Graph topology and per-project model/effort/cycle choices are stored in the central
SQLite database (`~/.worca-cc/worca-cc.db`) — no longer in `~/.worca-cc/workflows/` or
`<projectDir>/.worca-cc/config.json`.

### v2 changes

Template v1 is removed **except** for the 7 re-seeded pipelines, which are now v2
graphs with their overlays migrated. Plugin API is now **2**. **v1 paused runs are not
resumable.**

- Every pipeline now terminates in an **End** node, and its payload is the run result.
  A run that quiesces without reaching End completes with a warning.
- The **Await flow node is gone**, replaced by AND/OR cards plus the universal await
  gate port on every agent — the old checklist `start` port is that await port now.
- A template hand-edited to remove its End node fails validation (**V21**).
- **Inputs take exactly one wire**; fan-in goes through the OR card, which forwards the
  freshest payload. The old two-loops-into-fix templates are re-seeded with an OR.
- **V22 is retired** — subsumed by the restored V7.
- v1 **USER sidecars are soft-skipped** at load with a warning naming the fix (they need
  `metaVersion: 2`). A `worca agents migrate` helper is a possible follow-up, not part
  of this work.
- Interleaved-loop **cycle filenames are now monotonic per node**. v1 reused cycle
  numbers and silently overwrote `impl-review-cycle2.json` and the cycle-2 reviews row;
  v2 ordinals append `cycle4`, `cycle5`, … (parity divergence D3, accepted as an
  improvement).

---

## Guardrails (per run)

Guardrails are **named sets**, selected **per pipeline run**. The **Guardrails**
view lists the built-ins — **Permissive**, **Normal**, **Strict** — alongside
your own sets ("Create guardrails" starts from any of them, or blank), with an
editor for the five policy fields (honor project settings, env scrub, env
allowlist, protected paths, deny rules). The New Pipeline form has a
**Guardrails** picker next to the workflow picker: the selected set is the
run's entire policy, applied uniformly to every agent the run spawns — and,
for a workspace run, uniformly to every member project.

**Guardrails apply per run; runs without a selection run unguarded
(Permissive).** The picker defaults to Permissive — no restrictions,
byte-identical to runs before guardrails existed — so protection is an
explicit per-run choice, not a persistent project property. (This is a
deliberate tradeoff of the per-run model: there is no per-project default to
fall back on, and one set applies to all workspace members. If you want a
stricter habitual posture, pick Normal/Strict — or your org set — when you
start the run.)

The built-in tiers:

- **Permissive** (default) — no restrictions; byte-identical behavior to a
  run with no selection.
- **Normal** — protects credential files (`.env*`, `*.pem`, `*.key`, SSH keys,
  cert stores) from agent Read/Edit and blocks publication commands
  (`git push`, `npm/yarn/pnpm publish`). Never breaks a pipeline: commits,
  installs, tests, and `curl localhost` all still work.
- **Strict** (wire id `secure`) — Normal plus: environment scrub on agent
  spawn (the spawned `claude` gets a minimal env: base vars, the proxy/CA
  connectivity vars, every `ANTHROPIC_*`/`CLAUDE_*` var, and the set's
  allowlist — nothing else), network egress binaries denied (`curl`, `wget`,
  `nc`, `ssh`, `scp`, `rsync`, ...), `gh`/`docker push` and cloud CLIs
  (`aws`, `gcloud`, `az`) denied, `WebFetch`/`WebSearch` denied, and home-dir
  credential stores (`~/.ssh`, `~/.aws`, `~/.config/gh`,
  `~/.git-credentials`, ...) protected from the Read/Edit tools.

Built-ins resolve from worca's code at read time (never snapshotted), so
preset improvements ship with upgrades; your named sets resolve by reference
at read time too — editing a set applies to every future run that picks it,
and to paused runs on resume. Built-ins are undeletable; editing one offers
"Save as new set". A set pinned by a paused run cannot be deleted (the API
answers 409 with the pinning runs); finished runs record the set id in
History and `run.json` (`guardrails.guardrailsId` beside the compact
envScrub/deny/protected counts — an id, not a content snapshot, since sets
stay editable). Resume re-reads the set by id and enforces its latest
definition; a set missing at resume is a LOUD warn in the run log and the
run proceeds Permissive (fail-open).

How it's enforced: protected paths and deny rules become Claude Code
`permissions.deny` rules in a single `--settings` payload on every pipeline
spawn (deny rules merge across scopes and cannot be removed by lower scopes —
repo settings can't undo worca policy, plugin-granted tools remain subject to
it). Protected paths expand to `Read(p)` + `Edit(p)` denies (Edit covers
Write/NotebookEdit; a `Write(p)` rule is never consulted and only produces
CLI warnings, so it is not emitted). A workspace run enforces the run's ONE
selected set uniformly on every member — nothing is unioned across member
projects anymore — and the workspace scanner is not subject to guardrails at
all (a scan takes no guardrails selection and spawns permissive). Repo
`.claude/settings.json` `permissions` are honored: natively on
single-project runs (cwd is the project worktree — the toggle can only decide
whether they're *lifted*, it cannot un-load what the worktree loads itself);
on **detached workspace runs (the default)** each member's own `deny` rules
are lifted per-member into the merged `--settings` when the run's set honors
project settings (that honor flag is uniform across members now — it comes
from the selected set, not from each project; `allow`/`ask` rules are never
lifted — that would widen capability and bypass Claude Code's workspace-trust
gate; hooks and statusline still don't apply off-worktree and stay warned). A
paused run re-reads its selected set by id on resume, so it enforces the set's
latest definition.

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
- Not setting that marker is not the same as blocking it: if **your own shell**
  exports `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, it survives the scrub (the
  `CLAUDE_*` keep-rule passes it through) and inflicts exactly the breakage
  above on every spawned `claude` — unset it before launching worca, or expect
  degraded runs.
- Strict denies `curl`, which the manual web-UI-testing agent uses to poll a
  dev server — it falls back to the `browser_*` MCP tools (not denied), so that
  flow degrades rather than breaks. `.env*` also matches `.env.example` /
  `.env.sample`, which agents may legitimately edit; a deny list can't carve
  per-file exceptions, so those become read-only under Normal/Strict too.
- Exempt from scrub/deny: UI-triggered utility agents outside pipeline runs
  (overview generation, agent generation), the `graphify` graph-build
  subprocess, **workspace scans**, and the `claude --help`/`--version`
  capability probe. In-run title generation IS scrubbed.

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

---

## Project structure

```
src/core/        protocol, store, artifacts, preflight, claude-runner, phases, orchestrator
src/core/graph/  the v2 engine: validate, ports, executor, scheduler, seed templates
src/cli/         worca-cc.mjs (CLI entry)
scripts/         install.mjs (copy agents + skill into a target project)
agents/          agent prompts + .meta.json sidecars (data-driven set)
skills/          worca/SKILL.md (the /worca skill)
ui/              server.mjs + public/ (single-page web UI)
ui/public/graph/ the Composer + run-graph client (graph-model, view, inspector)
```

Generated plans, reviews, and pipeline run folders are **not** part of this repo: they
live in the machine-wide external store at `<worcaHome>/store/<projectKey>/` (default
`~/.worca-cc/store/...`). See [Artifact layout](#artifact-layout).
