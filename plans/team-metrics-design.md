# Team Metrics — Design

A team-wide, git-backed record of every pipeline run (spend, duration, outcome, shape),
and a new top-level **Team metrics** page that aggregates it per project and per
workspace for the people who own budget and pace: project managers, product owners,
solution managers.

UI mockups: [`team-metrics-mockups.html`](team-metrics-mockups.html) — a design canvas
with eight boards (the page in project and workspace scope, the empty state, the
Projects page cells, both enable dialogs, the workspace wizard step, the workspace card
row). Open it in a browser to view and export; the live, editable copy is at
<https://claude.ai/artifact/Gt6YcqYsU81xhJZgkQEJXT>.

## 1. Problem

Everything Worca knows about a run lives in `~/.worca-cc/worca-cc.db` on the machine
that ran it. The **Stats** view (`src/core/stats.mjs`, `ui/public/stats-view.mjs`) is
therefore a *single-developer* view. A team of five has five disjoint histories and no
way to answer "what did this project cost us last month", "how many pipelines did we run
for epic X", or "is our review-cycle count trending down".

Two properties of the current store make it the wrong source of truth for a team:

- it is **per machine** — nothing is shared, nothing survives a laptop swap;
- it is **mutable and relational** — fine for a live orchestrator, useless for merging
  five copies.

## 2. Goals

- A **shared, append-only, git-hosted** record of finished runs that every teammate
  writes to and every teammate can read.
- **Zero merge conflicts by construction**, on any git host, with no reliance on
  `.gitattributes` merge drivers.
- **Explicit opt-in** per project. Nothing is recorded until a team enables it; local
  SQLite recording is unchanged and remains the source for Stats.
- Two aggregation levels with the same KPI set:
  - **project** — runs targeting one repository;
  - **workspace** — runs targeting a set of repositories, whose cost is attributed to
    the workspace as a whole, recorded in one designated *metrics home* project.
- One record per run. USD cost and durations, never tokens. Rich enough metadata that
  engineering and product management can slice by workflow, ticket, actor, PR.
- A new top-level page, **Team metrics**, distinct from Stats in data source and focus.
- v1 reads the whole record on the fly. No cache, no index.

## 3. Non-goals

- Replacing or migrating the local SQLite store or the Stats page.
- Token counts (deliberately dropped — cost in USD is the management currency).
- Step / cycle / sub-agent granularity in the shared record.
- Updating a record after it is written (e.g. PR merge state). Records are immutable.
- Compacting per-run files into monthly files. Layout allows it later (§8).
- A hosted service, a database, or any non-git backend.
- Ask Worca sessions. Only pipeline runs are recorded in v1.
- Recording mock runs (`claude.mock`) or preflight-only failures that never started.

## 4. Design

### 4.1 Architecture overview

```
 run-harness ─ terminal status ─▶ metrics/record.mjs ──▶ outbox (~/.worca-cc/metrics/outbox/<slug>/…)
   (done | error | stopped)      build RunRecord            │
                                                            ▼ flush (serialized, lock-file)
                                                    metrics/sync.mjs
                                                    worktree ~/.worca-cc/metrics/repos/<slug>  ◀── git worktree of the project repo
                                                    fetch → reset --hard origin/worca-metrics
                                                    → copy outbox → commit → push (retry on reject)
                                                            │
 ui/server.mjs  GET /api/team-metrics?scope=…&range=…  ◀────┘ metrics/read.mjs: fetch (rate-limited) → glob → parse → aggregate
        │
 ui/public/team-metrics-view.mjs  (new top-level view, nav "Team metrics")
```

Three new core modules under `src/core/metrics/`: `record.mjs` (build a `RunRecord` from
harness state), `sync.mjs` (outbox + git write loop + enable/discover), `read.mjs`
(fetch, parse, aggregate). Nothing in the run-harness changes except one call at the
terminal choke point (§4.5).

### 4.2 Where the record lives: the `worca-metrics` branch

Metrics do **not** travel with feature branches or PRs. Spend is incurred whether or not
a PR merges; tying the record to the merge would silently drop the runs a budget owner
most wants to see (failed, stopped, abandoned). Instead each metrics-enabled repository
carries a dedicated **orphan branch `worca-metrics`** that only ever contains:

```
README.md                         # one paragraph: what this branch is, do not edit by hand
.worca-metrics/
  config.json                     # team-level switch + policy (schema below)
  runs/
    2026/09/20260915T143012Z-<runId>.jsonl
    2026/09/20260915T151900Z-<runId>.jsonl
    …
```

- **One file per run, one JSON line per file.** Two branches, two machines, two
  developers can never touch the same path, so a push after `fetch` + `reset --hard`
  is always a fast-forward. This holds on GitHub, GitLab, Bitbucket, bare SSH — no merge
  driver, no `.gitattributes`.
- **Month directories** (`YYYY/MM`, by `startedAt` UTC) keep listings bounded and make
  a later compaction (`YYYY/MM.jsonl`) a pure concatenation.
- **Nobody reviews this branch.** It is excluded from PR flow by construction. Teams
  that protect branches by wildcard must exempt `worca-metrics`; the enable flow says so
  and the push error is surfaced verbatim (§4.7).
- The folder keeps the `.worca-metrics/` name even at branch root so that an alternative
  "in-tree on the default branch" mode, or a shared standalone metrics repository, uses
  the identical reader (§8).

`config.json` (committed, team-wide):

```json
{
  "schema": 1,
  "enabledAt": "2026-09-15T12:00:00Z",
  "enabledBy": "Siniša Đukić",
  "attribution": "git-user",
  "notes": ""
}
```

`attribution` ∈ `git-user | none`. With `none`, records carry `actor: null`. It is a
team decision made once at enable time and editable only by committing to the branch
(Worca offers no UI for it in v1; the enable dialog exposes the choice).

### 4.3 Project and workspace identity in the record

`projectKey` is `<slug>-<sha1(canonicalRoot)[:8]>` (`src/core/store.mjs:36`) — it hashes
the **local path**, so the same repository has a different key on every machine. The
shared record therefore identifies projects by a **machine-independent slug**:

```
projectSlug = remoteRepoSlug(parseRemoteUrl(origin))   // "owner/repo" (git-info.mjs:318)
            ?? basename(canonicalRoot)                    // no remote: local name
```

Workspace keys (`wks-<slug>-<sha1(roots)[:8]>`) have the same problem. Workspace runs
record `workspace: { name, projects: [slug…] }` and the reader groups by **name**.

### 4.4 `RunRecord` schema (v1)

One JSON object per finished run. Field order is fixed so diffs stay readable.

```json
{
  "v": 1,
  "id": "20260915-143012-a1b2c3",
  "worca": "1.4.0",
  "recordedAt": "2026-09-15T14:41:03Z",

  "startedAt": "2026-09-15T14:30:12Z",
  "endedAt":   "2026-09-15T14:40:58Z",
  "wallMs":    646000,
  "activeMs":  512340,

  "result":  "done",
  "failure": null,

  "workflow": { "id": "wf_auto", "name": "Auto", "version": 3 },
  "target":   { "kind": "project", "project": "acme/billing-api" },
  "title":    "Add idempotency keys to POST /invoices",
  "source":   { "type": "github-issues", "ref": "#412", "url": "https://github.com/acme/billing-api/issues/412" },

  "cost": { "usd": 3.42, "byPhase": { "plan": 0.61, "implement": 2.15, "review": 0.66 } },

  "agents": { "count": 4, "keys": ["planner", "implementer", "reviewer", "refiner"],
              "models": ["claude-opus-5", "claude-sonnet-5"] },
  "steps": 9,
  "cycles": { "plan": 1, "review": 2 },
  "interventions": { "questions": 1, "pauses": 0, "resumes": 0 },

  "pr":  { "number": 438, "url": "https://github.com/acme/billing-api/pull/438", "base": "dev" },
  "git": { "branch": "worca/idempotency-keys", "head": "8067ff25", "base": "dev",
           "filesChanged": 12, "insertions": 340, "deletions": 25 },

  "actor": "Siniša Đukić"
}
```

Field notes:

| field | source | why a PM / engineer cares |
|---|---|---|
| `wallMs` vs `activeMs` | `endedAt-startedAt`; `state.totalActiveMs` (`run-harness.mjs:3112`) | the gap is waiting on humans → autonomy ratio |
| `pausedMs` (additive) | `_metricsIv.pausedMs`: parked on a pause (stamp → resume) or dead between a crash and its resume (last heartbeat → resume) | not waiting on a human — leaves the autonomy denominator |
| `result` | `done \| failed \| stopped` (harness `done \| error \| stopped`) | success rate; `paused` is non-terminal and never recorded |
| `failure` | `{ kind: "budget" \| "error" \| "preflight" \| "commit", message }` (≤ 200 chars) | why money was lost |
| `workflow` | `topology.workflow` (`run-harness.mjs:911`), template `version` row | spend per workflow; effect of workflow edits |
| `target` | `state.target`, member list for workspaces | project vs workspace roll-up |
| `title` | `state.title` (never the prompt) | human label; prompt is large and may be sensitive |
| `source` | `source_type` / `source_ref` (`run-harness.mjs:958`) | spend per ticket / epic — the key PM join |
| `cost.usd` | `state.totalCostUsd` | the headline |
| `cost.byPhase` | `sumStepCosts` grouped by `step.phase` | where the money goes, without step granularity |
| `agents` | `topology.agentKeys`; distinct `attr.model` seen on result frames | headcount of the workflow; model mix explains cost drift |
| `steps`, `cycles` | `state.steps.length`; max `cycle` per phase | review loops = convergence / quality signal |
| `interventions` | count of `question` emits, pause/resume transitions | how much attention the run needed |
| `pr` | `pr_url`, `pr_number` at record time (`artifacts.mjs:1217`) | join key to the PR; state is *not* recorded (immutable) |
| `git` | `state.branch`, `diffNumstat` (`git-info.mjs:95`) | crude pace: cost and time per changed line |
| `actor` | `git config user.name` of the project, or `null` under `attribution: none` | spend per person; opt-in |

Excluded on purpose: hostname, PID, guardrails id, prompt text, per-step rows,
sub-agent rows, tokens, anything that can change after the run ends.

**Versioning.** `v` is bumped only for breaking shape changes. Additive fields are
allowed under the same `v`; readers must ignore unknown fields and treat missing ones
as `null`. The reader refuses records with `v` greater than it understands and reports
the count in the sync chip (§4.10) instead of failing the page.

**Workspace target.**

```json
"target": { "kind": "workspace", "workspace": "IoT SP Platform",
            "projects": ["acme/gateway", "acme/device-registry"],
            "touched":  ["acme/gateway"] }
```

`projects` is the whole member set; `touched` is the subset with a non-empty commit in
this run (`state.branches[key].sha`, `run-harness.mjs:2290`). The record is written to
the workspace's metrics home (§4.6) regardless of whether that project was touched.

### 4.5 Write path

**Hook point.** All terminal states pass through `_setStatus` (`run-harness.mjs:3108`),
and both success paths (`:1132`, `:1457`) and both failure paths (`:1204`, `:1516`) call
`await this._persist()` right after. The metrics call goes immediately after
`_persist()` in each of those four places, gated on status ∈ `done | error | stopped`,
and *after* `_buildResults()` on the success path so `pr` and `git.numstat` are
available:

```js
// run-harness.mjs (success path, after _reportToSource)
await recordRunMetrics(this, { status: 'done' });   // never throws; logs via _log('metrics', …)
```

`recordRunMetrics` (in `src/core/metrics/record.mjs`) does three things, all
fail-soft:

1. **Resolve the sink.** Project run → the project's own metrics repo if enabled, or
   its delegate (§4.6b). Workspace run → the workspace's configured metrics home, if
   any. No sink → return. Mock run → return.
2. **Build the record** from `harness.state`, `harness.pipeline`, the topology and the
   git worktree (numstat is best-effort; a failed diff leaves `git.filesChanged` null).
3. **Write to the outbox** `~/.worca-cc/metrics/outbox/<slug>/<file>.jsonl`, then
   **schedule a flush**. The outbox write is the durability point: once the file is
   there the run's state can be torn down; the flush can happen later.

**Flush** (`src/core/metrics/sync.mjs`), serialized per slug with an in-process queue
and a lock file `~/.worca-cc/metrics/outbox/<slug>/.lock` (CLI and UI server may both
finish runs):

```
ensureWorktree(slug)            # git worktree add ~/.worca-cc/metrics/repos/<slug> worca-metrics
git fetch origin worca-metrics
git reset --hard origin/worca-metrics
copy outbox/*.jsonl → .worca-metrics/runs/YYYY/MM/
git add -A && git commit -m "metrics: <n> run(s)"        # author = git user, or "Worca <worca@local>" under attribution:none
git push origin worca-metrics
  rejected (non-fast-forward)? → fetch, reset --hard, re-copy, commit, push  (≤ 5 attempts, jittered backoff)
  ok? → delete flushed outbox files
  other error? → keep outbox, record lastError, retry on next trigger
```

Because no two commits ever touch the same path, `reset --hard` + re-copy is a complete
conflict resolution; there is no rebase and nothing to merge.

**Flush triggers:** after every record; on UI server start; when the Team metrics page
opens; via **Push now** in the sync chip. The outbox is visible in the UI (§4.10), so a
developer who works offline for a day sees "3 runs pending push" and nothing is lost.

**Why a worktree, not a clone.** `git worktree add` shares the object store and the
remote/credential configuration of the project the developer already has. The worktree
lives outside the project directory (under `worcaHome()`), so it is invisible to the
project's tooling and is pruned when the project is removed from Worca
(`removeProject`, `projects.mjs:151`).

### 4.6 Enabling and discovery

**Team-level switch = the branch exists.** Enabling is a one-time, committed act:

```
POST /api/projects/:key/team-metrics/enable   { attribution: 'git-user' | 'none' }
  → requires an `origin` remote
  → if origin/worca-metrics already exists: fetch it, done ("joined")
  → else: create orphan branch in the worktree, write README.md + .worca-metrics/config.json, push -u
```

**Discovery.** Teammates never click anything. `git ls-remote --heads origin
worca-metrics` runs on project add, on UI server start, and at most once per hour
thereafter; the result is cached in `project_config.extra.teamMetrics`:

```json
{ "enabled": true, "checkedAt": "…", "remote": "origin", "slug": "acme/billing-api" }
```

A **local opt-out** (`project_config.extra.teamMetrics.record = false`, Projects page
toggle "Record my runs") lets an individual stop contributing without disabling the team
switch; the page still reads.

**Disabling for the team** is deleting the remote branch. Worca offers no button for
that in v1 (it is destructive and visible to everyone); the project card shows the
command.

### 4.6b Delegation: one branch for many projects

Teams mix single-project and workspace runs on the same repositories. A workspace of
ten projects with one metrics home would otherwise scatter its members'
single-project runs across ten branches, most of which nobody enables. A project can
therefore **delegate** its recording to another project that records locally:

```json
{ "schema": 1, "enabledAt": "…", "enabledBy": "…", "delegateTo": "acme/gateway" }
```

- The delegating project still has its own `worca-metrics` branch — that is what makes
  the choice **team-wide and discoverable** through the same hourly remote check
  (§4.6). Its branch holds only `config.json`, never a run file.
- The sink resolver (§4.5 step 1) follows `delegateTo` once: a single-project run on
  `acme/billing-api` is written to `acme/gateway`'s branch. The record is unchanged and
  still carries `target.project: "acme/billing-api"`; the home's branch simply holds
  records for several projects.
- **No chains.** The delegate must record locally. A `delegateTo` that points at a
  project which itself delegates, or has no branch, is a configuration error: the
  resolver logs it, records nothing, and the Projects page cell shows it in red.
- **One target per project.** A project in two workspaces with different homes still
  delegates to exactly one of them; each workspace's own runs go to that workspace's
  home (§4.8). The team makes the choice once, in the enable dialog, from the list of
  projects already recording.
- Attribution follows the **delegate's** policy (the branch the record lands on); the
  delegating project's `config.json` carries no `attribution` field.
- Delegation is a local choice for nobody: a developer's "Record my runs" opt-out
  (§4.6) still applies, but *where* records go is fixed by the branch.

**Batch routing from a workspace.** The workspace card offers *Route all members to the
metrics home*, which creates a marker branch on every member that has neither a branch
nor a delegation, all pointing at the home. Nine origins, nine pushes, nine chances to
hit branch protection — the result list names each failure.

### 4.7 Push failures

Surfaced, never swallowed:

| situation | behaviour |
|---|---|
| no `origin` remote | enable refused with a clear message; nothing recorded |
| branch protection rejects push | outbox keeps the files; sync chip shows the git stderr and a hint to exempt `worca-metrics` |
| offline | outbox keeps the files; retried on the next trigger |
| remote branch deleted by the team | discovery flips `enabled=false`; outbox retained for 30 days, then dropped with a log line |
| worktree corrupted | sync removes and recreates it (it holds nothing that is not on the remote or in the outbox) |

### 4.8 Workspace metrics home

A workspace run's cost is attributed to the workspace, and written into exactly one of
its member repositories: the **metrics home**. The choice is **local to the developer
machine** (the workspaces table is local) and stored as a new nullable column
`workspaces.metrics_project` holding the member's **absolute path** (same convention as
`workspace_projects.project_key`, `db.mjs:185`). Read-side annotation derives the slug.

- **Create wizard.** After the project pick (step 1) and before the scan, a new step
  **Team metrics** runs `POST /api/workspaces/metrics-scan { projectPaths }`, which
  reports, per member, whether `origin/worca-metrics` exists. The step offers radio
  buttons for the enabled members, "Enable on … now" for the rest, and **Skip** (no
  home, workspace runs are not recorded). If exactly one member is enabled it is
  pre-selected.
- **Workspace card.** A "Metrics home" row on the card (`ws-card-tpl`,
  `ui/public/index.html:704`) shows the current home with **Change** → the same
  picker in a sheet, backed by `PATCH /api/workspaces/:id { metricsProject }`. **Re-scan**
  on the card also refreshes the member discovery.
- **Stale home.** If the home's branch disappears or the project leaves the workspace,
  the card shows a red badge and the run-time sink resolves to *none* (logged, not
  fatal).

Because the home is chosen per machine, two teammates could pick different homes for the
"same" workspace. The wizard mitigates this by pre-selecting the only enabled member
(the common case), and the read side tolerates it by letting the Team metrics page list
workspace-kind records from *every* enabled project the workspace contains and grouping
them by workspace **name** (§4.3) — so a split still aggregates correctly.

### 4.9 Read path

`src/core/metrics/read.mjs`:

```
readScope({ kind:'project', slug })        → resolve delegate (§4.6b) → fetch that branch (≤ once / 60 s unless refresh=1)
                                             → glob .worca-metrics/runs/**/*.jsonl → parse
                                             → keep records with target.kind='project' && target.project === slug
readScope({ kind:'workspace', id })        → for each member that records locally: same, keep records with
                                             target.kind='workspace' && target.workspace === name
aggregate(records, { range, groupBy })     → KPIs + series + breakdowns (pure, tested in isolation)
```

- Project scope **always filters by slug**, for the home as much as for a delegating
  project, so a home's own numbers are never inflated by the runs it hosts for others.
- Reads come straight from the worktree files after `reset --hard origin/worca-metrics`;
  no `git show` per file.
- Malformed lines are counted and skipped, never fatal. Unknown `v` likewise.
- **Scale check.** 1 KB per record × 1 000 runs/month ≈ 1 MB/month, 12 MB/year; parsing
  is tens of milliseconds. v1 needs no cache. The page re-aggregates client-side for
  range and group-by changes, so one fetch serves the whole session.

**Ranges:** `this month | last month | quarter | year | all`, plus custom `from/to`.
The default is *this month*, matching budget cycles (Stats defaults the same way).

**KPIs** (all scopes):

| tile | formula |
|---|---|
| Spend | Σ `cost.usd` |
| Runs | count, with done / failed / stopped split and success rate |
| Cost per run | Σ usd / runs (median shown as secondary) |
| Duration | median `wallMs`; secondary: Σ `activeMs` as "machine time" |
| Autonomy | Σ `activeMs` / Σ max(0, `wallMs` − `pausedMs`) — records without `pausedMs` park nothing |
| Review cycles | mean `cycles.review` |
| Interventions | mean questions + pauses per run |
| Cost per merged PR | not available (PR state is not recorded) — shows *cost per run with a PR* instead |

**Series:** spend per week (stacked by workflow) and runs per week (stacked by result).

**Breakdowns** (tables, sortable, each row → filter): by workflow · by source
(ticket) · by actor (only when any record has one) · by project (workspace scope only,
using `target.touched`) · by model mix.

**Run table:** every record in range, newest first, with title, workflow, result, cost,
duration, cycles, PR link, actor. **Export CSV** of the filtered rows.

### 4.10 UI: the Team metrics page

New top-level view `data-view="team-metrics"`, nav entry **Team metrics** under
*Activity* directly below *Stats* (sidebar and compact top-nav). Same page skeleton as
Stats (`topbar` → filter row → body) so the two feel related; the difference is stated
in the subtitle: *"Shared across the team from the `worca-metrics` branch · costs are
Claude Code estimates, not billing"*.

Filter row, left to right: **Scope** select (grouped: Projects / Workspaces; only
enabled projects and workspaces with a home are listed; an empty state explains how to
enable), **Range** segmented control, **Group** select for the series (workflow / result
/ actor / project). The **sync chip** sits in the topbar's right slot (the filter row
is full at 1080 px): `synced 2 min ago · 3 runs pending push` with **Refresh** and
**Push now**.

Mockups: [`team-metrics-mockups.html`](team-metrics-mockups.html) — boards *Team
metrics · project scope*, *Team metrics · workspace scope* and *Team metrics · nothing
enabled yet*.

Empty states:

- nothing enabled anywhere → a card with the two ways in: enable on a project, or
  pick a metrics home for a workspace, each a deep link.
- enabled but no records in range → the KPI row renders zeros and the run table says so.

Stats stays as it is. The only cross-link is a small "Team-wide view →" hint on Stats
when at least one scope is enabled.

### 4.11 Settings and surfaces

| surface | addition |
|---|---|
| Projects page, project card ([mockup](team-metrics-mockups.html), board *Projects · team metrics status per project*) | "Team metrics" row: status (`off` / `on since …` / `on · recorded in acme/gateway` / `pending push n` / `delegate invalid`), **Enable** button, local **Record my runs** toggle |
| Enable dialog ([mockup](team-metrics-mockups.html), boards *Enable dialog · record here* / *· record in another project*) | *Where to record*: **here** (creates the branch, asks attribution) or **in another project** (picks from projects already recording, writes a delegation marker) |
| Workspace wizard ([mockup](team-metrics-mockups.html), board *Workspace wizard · new step*) | new step *Team metrics* (§4.8) |
| Workspace card ([mockup](team-metrics-mockups.html), board *Workspace cards · metrics home row*) | "Metrics home" row + **Change** + **Route all members to the metrics home** (§4.6b) |
| Settings | nothing new in v1 |
| Nav | "Team metrics" under Activity |
| Run detail (History) | small "recorded to team metrics ✓ / pending / not enabled" line in the run header |

### 4.12 Security and privacy

- The branch is readable by anyone with read access to the repository. Records contain
  the run **title**, ticket reference, PR URL, branch name, aggregate cost and,
  under `attribution: git-user`, the actor's git name. They never contain the prompt,
  code, diffs, logs, tokens, hostnames or paths.
- Pushes use the developer's own git credentials and remote configuration; Worca adds no
  tokens and no new network endpoints.
- The worktree lives under `worcaHome()` and is never exposed by the UI server's static
  routes.
- `title` is truncated to 200 characters; `failure.message` to 200 characters; the
  writer strips control characters and newlines so one record is always one line.

## 5. Testing

- **record.mjs** — unit: harness-state fixtures (single project, workspace touched /
  untouched, failed with budget, stopped, resumed) → exact `RunRecord`; field order;
  truncation; `attribution: none` → `actor: null`; mock run → no record; a delegating
  project's record keeps its own `target.project` and takes the delegate's attribution.
- **sync.mjs** — integration against a local bare repository as `origin`:
  enable creates the orphan branch; join when the branch exists; delegation marker
  resolves to the delegate's worktree; a chained or dangling `delegateTo` records
  nothing and reports; two outboxes flushed
  from two worktrees in interleaved order both land without conflict; a rejected push
  (simulated with a pre-receive hook) leaves the outbox intact and surfaces stderr;
  reset-and-retry after a concurrent push; lock-file serialization across two
  processes.
- **read.mjs** — unit: aggregation over synthetic records (ranges, month boundaries in
  UTC, unknown `v`, malformed lines, workspace grouping by name across two homes).
- **API** — `GET /api/team-metrics` shapes, empty scopes, `refresh=1` rate limiting,
  `metrics-scan`, `PATCH workspaces` validation (home must be a member).
- **UI** — existing smoke harness: nav entry, scope select population, KPI row renders,
  sync chip states, wizard step, workspace card row.
- **Harness** — one test per terminal path asserting `recordRunMetrics` is called
  exactly once with the right status and never throws into the run.

## 6. Implementation order

1. `src/core/metrics/record.mjs` + schema doc + fixtures. (no behaviour change yet)
2. `sync.mjs`: worktree, enable/join, delegation marker + resolver, discovery cache,
   outbox, flush with retry, lock.
3. Harness hook at the four terminal sites; run-detail "recorded" line.
4. `read.mjs` + `GET /api/team-metrics`, `scopes`, `flush`, project enable/status
   routes, `metrics-scan`, `workspaces.metrics_project` (schema v30) + `PATCH`.
5. Projects page rows; workspace wizard step; workspace card row.
6. Team metrics page: filter row, KPI tiles, two charts, breakdowns, run table, CSV.
7. Docs (`docs/`), README section, `worca metrics push` CLI verb for headless flushes.

Steps 1–3 can ship dark behind the absence of an enabled project.

## 7. Decision log

- **Separate top-level page, not a Stats tab.** Different audience, different source;
  a tab would invite "why do the numbers differ" questions. Numbers legitimately differ
  (team-wide vs this machine).
- **`.worca-metrics/`, not `.worca-cc/metrics`.** The existing dotfolder is gitignored
  and holds worktrees; un-ignoring a subfolder fights every user's ignore rules.
- **One file per run, not one file per month.** Git conflicts on both appends and
  prepends to the same file, and add/add-conflicts on a new month file created on two
  branches. The `merge=union` driver fixes it locally but is not honoured reliably by
  hosted PR merges. Per-run files are conflict-free everywhere. Monthly files remain a
  compaction target.
- **Dedicated `worca-metrics` branch, direct push, no PR.** Spend is real whether or
  not a PR merges; failed and stopped runs must be counted. Also removes the "workspace
  run must open an extra PR in the metrics home" problem: every run, single or
  workspace, is one push to one branch.
- **One line per run, no step/cycle/sub-agent rows.** Management questions are answered
  at run granularity; `cost.byPhase` and `cycles` carry the useful part of the step
  detail in a few bytes.
- **USD and time only, no tokens.** Tokens are an implementation detail of a model;
  cost is the comparable quantity across models and time.
- **Machine-independent identity by remote slug.** Local project keys hash the path
  and differ per machine.
- **Workspace metrics home is a local choice.** Workspaces themselves are local
  definitions; the reader tolerates split choices by grouping on workspace name.
- **Outbox before git.** The run must finish and tear down independent of network
  state; the file in the outbox is the durability point.
- **`reset --hard` + re-copy instead of rebase.** Correct because paths are unique;
  simpler and immune to any local drift in the worktree.
- **Records are immutable.** PR merge state and later cost corrections are not
  back-filled. Keeps the writer trivial and the branch append-only.
- **Delegation lives in the delegating project's branch, not in a local setting.**
  A local "send my runs to X" would route one project's runs to different homes
  depending on who ran them. A marker branch makes the choice team-wide and reuses the
  discovery path; the cost is one extra tiny branch per delegating repository.

## 8. Out of scope / future

- **Compaction** of closed months into `runs/YYYY/MM.jsonl` (safe once no outbox on
  any machine can still hold that month — e.g. two months back).
- **Standalone metrics repository** (one repo for many workspaces): the sink is
  `{ remote, branch, root }`; only the UI to point at a foreign remote is missing.
- **In-tree mode** (`.worca-metrics/` on the default branch via PR) for teams that
  forbid direct pushes entirely. Same reader, different writer.
- **PR outcome reconciliation** — a periodic job that emits *separate* `pr-state`
  records (never edits run records) so "cost per merged PR" becomes computable.
- **Ask Worca sessions** as a second record kind.
- **Local cache / incremental parse** once a repository exceeds a few hundred thousand
  records.
- **Budget alerts** on team-wide spend (Stats has per-machine caps today).
