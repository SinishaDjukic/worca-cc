# Team metrics — RunRecord v1

This is the authoritative field reference for the `RunRecord` JSON written to the
`worca-metrics` orphan branch (one JSON-line file per run, see
[`docs/team-metrics.md`](./team-metrics.md) for the sync/git mechanics). It is produced by
the pure builder `buildRunRecord(snap, opts)` in `src/core/metrics/record.mjs`, exported
alongside `RECORD_VERSION`, `TEXT_MAX`, `RECORD_FIELDS`, `redactPaths` and `cleanText`.

## Example (v1)

```json
{
  "v": 1,
  "id": "a1b2c3d4",
  "worca": "1.2.0",
  "recordedAt": "2026-09-15T14:41:03Z",
  "startedAt": "2026-09-15T14:30:12Z",
  "endedAt": "2026-09-15T14:40:58Z",
  "wallMs": 646986,
  "activeMs": 512340,
  "pausedMs": 0,
  "result": "done",
  "failure": null,
  "workflow": { "id": "wf_auto", "name": "Auto", "version": 2, "rev": "1a2b3c4d" },
  "target": { "kind": "project", "project": "acme/billing-api" },
  "title": "Add idempotency keys to POST /invoices",
  "source": {
    "type": "github-issues",
    "ref": "#412",
    "url": "https://github.com/acme/billing-api/issues/412",
    "title": "Idempotency keys for invoices"
  },
  "cost": { "usd": 3.42, "byPhase": { "plan": 0.61, "implement": 2.15, "review": 0.66 } },
  "agents": { "count": 4, "keys": ["planner", "implementer", "reviewer", "refiner"], "models": ["claude-opus-5", "claude-sonnet-5"] },
  "steps": 5,
  "cycles": { "plan": 1, "implement": 2, "review": 2 },
  "interventions": { "questions": 1, "pauses": 0, "resumes": 0 },
  "pr": null,
  "git": { "branch": "worca/idempotency-keys", "head": "8067ff25", "base": "dev", "filesChanged": 12, "insertions": 340, "deletions": 25 },
  "actor": "Siniša Đukić"
}
```

`source.title` and `workflow.rev` are additive fields on top of the design §4.4 example
(see "Versioning" below).

## Field table

| Field | Type | Notes | Source in this codebase |
|---|---|---|---|
| `v` | int | always `1` for this schema | `RECORD_VERSION` |
| `id` | string | the run id | `pipelines.id` |
| `worca` | string | Worca version that recorded the run | `package.json` `version`, or the harness's own `worcaVersion` when supplied |
| `recordedAt` | string | UTC, second precision, `Z` suffix | `now` passed to `buildRunRecord` |
| `startedAt` / `endedAt` | string | UTC, second precision | run start; `state.updatedAt` at the terminal hook (there is no separate `endedAt` field) |
| `wallMs` | int\|null | `endedAt - startedAt` in ms, floored at 0 | derived |
| `activeMs` | int\|null | total active time across steps | `state.totalActiveMs` (`sumStepActive(steps)`, stamped by `_setStatus`) |
| `pausedMs` | int | ms the run spent parked: paused, or dead between a crash and its resume. Leaves the autonomy denominator (`active ÷ (wall − paused)`). Additive: absent on older records = 0 | `_metricsIv.pausedMs`, accumulated by `resume()` from the pause stamp (`pausedAt`) or, for an interrupted row, the last `heartbeat_at` |
| `result` | `done\|failed\|stopped` | mapped from harness status `done\|error\|stopped` | harness terminal status |
| `failure` | object\|null | see "Failure" below | derived |
| `workflow` | object\|null | `{id,name,version,rev}` | `harness.resolved.template`, stepper fallback; `rev` is additive (see below) |
| `target` | object | `{kind:'project',project}` or `{kind:'workspace',workspace,workspaceId,projects,touched,touchedFiles}` | run target / workspace membership |
| `title` | string\|null | cleaned, ≤200 chars | pipeline title |
| `source` | object\|null | `{type,ref,url,title}` | `pipelines.source_type`/`source_ref`, `sourceMeta` |
| `cost` | object | `{usd, byPhase}` | `state.totalCostUsd`, summed/step-derived; `roundUsd` |
| `agents` | object | `{count,keys,models}` | `harness.resolved.agentKeys`; `models` from agent step result frames only |
| `steps` | int | count of steps with a non-null `agentKey` | see "Steps" below |
| `cycles` | object | max `cycle` per UI phase, agent steps only | see "Steps" below |
| `interventions` | object | `{questions,pauses,resumes}` | `rp.interventions`, carried across resume |
| `pr` | object\|null | `{number,url,base}`, usually `null` | `readPrState(pipelineId)` |
| `git` | object | `{branch,head,base,filesChanged,insertions,deletions}` | see "Git" below |
| `actor` | string\|null | git user, `null` under `attribution:'none'` | `git config user.name` |
| `actorKey` | string | optional, right after `actor`: the person key, `sha256("worca:" + lower-cased git email)` first 16 hex. Only when the actor is the checkout's git user; never under `attribution:'none'`; absent on older records | `git config user.email` → `personKey()` |
| `human` | object | `{hours, byPhase}` — optional trailing key, only when hours > 0 | `state.humanHours`, `pipeline_steps.human_hours` |

## v1 notes

- `human` (money-saved design): hours, 2 dp; `byPhase` keyed like `cost.byPhase`. Absent on runs that earned nothing. Readers that do not know it ignore it.

- **`cost.byPhase` / `cycles` keys are UI phases** (`plan`, `implement`, `review`, …), not
  agent keys. On the graph engine `step.phase` holds the agent key; `snapshotFromHarness`
  (a later phase) rewrites each agent step's `phase` to its UI phase
  (`graph.nodes[nodeId].uiPhase ?? UI_PHASE[agentKey] ?? agentKey`) before the pure builder
  in this file ever sees it. `buildRunRecord` itself does no such mapping — it trusts
  `snap.steps[].phase` to already be a UI phase.
- **`workflow.version`** is the template/graph format version (today always `2`); it is not
  a count of edits.
- **`workflow.rev`** is an additive field (allowed by the versioning rules below): the first
  8 hex characters of a sha1 over the graph's structure and effective loop budget. A value
  that is not exactly 8 lowercase hex characters is recorded as `null`.
- **`failure.kind` derives from the last pause, not only the terminal error**, for
  budget-parked runs. Cost caps and setup failures *pause* a run (`failure-policy.mjs`)
  before any terminal status is reached, so:
  - a run terminating `failed` after its last pause was a cost cap (`cost_pipeline` /
    `cost_total`), or whose error text matches `/budget|cost cap|cost limit/i`, records
    `failure.kind:'budget'`;
  - a run terminating `failed` with a row but no agent step at all records
    `failure.kind:'preflight'` (a cost cap tripping on the Auto classifier's preflight cost
    wins over `preflight`, since budget evidence is checked first);
  - any other `failed` run records `failure.kind:'error'`;
  - a run terminating `stopped` records `failure:null`, **except** one stopped while still
    parked by a cost cap (its last pause was a cost cap and resume never rehydrated it), which
    records `{kind:'budget', message:<pause detail>}`.
  - the last pause is forgotten once `resume()` rehydrates a run, so a run that parked on a
    cost cap, was given more budget, resumed, and later failed or was stopped for an
    unrelated reason is not mislabelled `budget`.
- **`commit` is reserved in the `failure.kind` enum but never emitted in v1.** Whether the
  post-run commit failed (`branch.commitFailed`) is only known after teardown
  (`_commitWork` inside `_teardownRunRoot()`'s `finally`), which runs *after* every hook
  site. A future version may move the hook or backfill this field; v1 does not.
- **`pr` is usually `null`.** PRs are normally opened later, from the UI, well after the
  run's terminal hook fires. This is expected, not a bug in the builder.
- **`git.head` is usually `null` in v1.** At every hook site the worktree `HEAD` is still
  the pre-run checkpoint — the agent's work is committed only by `_commitWork` inside
  `_teardownRunRoot()`'s `finally`, which runs after the hook. Recording `HEAD` at hook time
  would silently record the *previous* run's commit as if it were this run's, so `head` is
  `null` unless the branch record already carries a stamped commit.
- **Runs that pause and are then abandoned, or are stopped while parked (other than the
  cost-cap case above), are not recorded in v1.** A run left in a non-terminal `paused`
  state never reaches a hook site (documented as a known v1 limit, decision 2 of the
  implementation plan). This is a consequence of the spec's hook points, not something this
  builder works around.
- **`title` may be a provisional value.** If a harness fills in a first-prompt-line title
  before LLM title generation completes, that provisional title can be what gets recorded.
- **`failure.message` has local paths replaced with the literal string `<path>`** before
  truncation (§4.12, "no local paths in a record"); URLs are left intact, so a GitHub issue
  or PR link inside an error message is still readable. Redaction runs before the 200-char
  truncation, so a URL is never partially eaten by a path match that happens to precede it.

## Where v1 differs from design §4.4's field notes

The design cites a few symbols that either do not exist at HEAD or do not mean what the
prose implies. This table exists so a reader who goes looking for those symbols does not
mislabel the column.

| design §4.4 says | v1 actually records | why |
|---|---|---|
| `state.branches[key].sha` | `state.branch.commit`, first 8 chars, normally `null` | there is no `sha` field on `state.branches[key]`; `commit` is stamped by `_commitWork` during teardown, i.e. *after* every hook site |
| `steps = state.steps.length` | count of rows with a non-null `agentKey` | the two bookend rows (`x:preflight:1`, `x:done:1`) and other flow rows carry `agentKey: null` and are not steps |
| `git.filesChanged` via `diffNumstat` | `summary.filesNew + summary.filesChanged` from `results.json` | `_buildResults()` has already computed the same diff; the summary's `filesChanged` **already includes** deleted files, so `summary.filesDeleted` must never be added again |

## Versioning

`v` is the schema major version and only increments for a breaking change to the meaning or
shape of an existing field. New, optional fields (e.g. `source.title`, `workflow.rev`) may
be added to a given `v` without a version bump — readers must ignore fields they do not
recognise. `RECORD_FIELDS` fixes the serialised key order for `v:1` so that diffs between
two records of a run stay readable; it is not itself part of the semantic schema.

## Workspace target

For a workspace run, `target` is:

```json
{ "kind": "workspace", "workspace": "IoT SP Platform", "workspaceId": "wks-iot-sp-0123abcd", "projects": ["acme/device-registry", "acme/gateway"], "touched": ["acme/gateway"] }
```

`workspaceId` is the workspace's stable id on the machine that ran it (additive since 1.x; `null` in older records). The reader matches a record to a workspace by this id first and only falls back to a case-insensitive `workspace` name match when it is absent, so renaming a workspace no longer orphans its history.

`projects` is the full workspace member set; `touched` is the subset whose `results.json`
`perProject[key].summary` shows any changed file. `touched` is `[]`, never omitted, when no
member was touched.

`touchedFiles` (additive since 1.x) maps each touched member to *its own* changed-file count
(`filesNew + filesChanged` of that member's summary — the per-member share of `git.filesChanged`).
The Team metrics page's "By project touched" table sums it per project; a record without it
counts as unknown there, so the table shows "–" rather than attributing the run's total to every
project it touched. Spend has no per-project equivalent: a run's cost is not attributable to one
member, so that table shows no spend at all (runs touched, files changed and the share of runs
that touched the project); clicking a project filters every panel to the runs that touched it.

## Exclusions

The following are deliberately **not** part of a v1 record: compaction state, a standalone
metrics repo, in-tree mode, PR reconciliation, Ask session detail, a read cache/index,
budget-alert state, token counts, mock runs, preflight-only failures beyond
`failure.kind:'preflight'`, and any disable/undo state. See the implementation plan's
"Out of scope" for the full list.

## Text fields: the 200-char / control-char rule

`title`, `failure.message`, and other free-text fields are passed through `cleanText`,
which is applied by the record author, never by a reader:

- control characters (C0, DEL, C1) and the two JS line separators (`U+2028`, `U+2029`) are
  replaced with a single space, so a record is always exactly one JSON line;
- runs of two or more spaces collapse to one, and the result is trimmed;
- the text is then truncated to `TEXT_MAX` (200) Unicode code points.

`failure.message` is redacted with `redactPaths` (replacing absolute POSIX/Windows/home
paths with `<path>`, but never touching `http:`/`https:` URLs) **before** it is cleaned and
truncated.

## `.worca-metrics/config.json`

Written once per enabled or delegating project, at the root of the `worca-metrics` orphan
branch. Two variants:

```json
{ "schema": 1, "enabledAt": "2026-09-15T12:00:00Z", "enabledBy": "Siniša Đukić", "attribution": "git-user", "notes": "" }
```

```json
{ "schema": 1, "enabledAt": "2026-09-15T12:00:00Z", "enabledBy": "Mara K.", "delegateTo": "acme/gateway" }
```

A delegation marker never carries run files; the resolver treats it as a pointer to another
slug's sink.

## PR event files (`.worca-metrics/prs/<number>.json`)

Written by the optional merge-tracking GitHub Action (`worca metrics pr-workflow`, see
[`docs/team-metrics.md`](./team-metrics.md) "Merge tracking"), never by Worca itself: one JSON
line per pull request of the repository, rewritten with its latest state on every open, reopen
and close.

```json
{"v":1,"kind":"pr","repo":"acme/billing-api","number":474,"url":"https://github.com/acme/billing-api/pull/474","title":"Idempotency keys for invoices","head":"worca/idempotency-keys-a1b2c3d4","base":"dev","author":"mara-k","authorName":"Mara Kovač","authorKey":"3f9a0c1e7b2d4a55","state":"MERGED","createdAt":"2026-09-16T14:50:00Z","mergedAt":"2026-09-22T17:30:00Z","closedAt":"2026-09-22T17:30:00Z","updatedAt":"2026-09-22T17:30:00Z"}
```

| Field | Notes |
|---|---|
| `v`, `kind` | always `1` and `"pr"`; anything else is ignored |
| `repo` | `owner/repo` as GitHub spells it; matched case-insensitively to record slugs |
| `number`, `url`, `title` | the PR; `title` cleaned of control characters, ≤200 chars |
| `head`, `base` | branch names; `head` is what a run's `git.branch` is matched against |
| `authorName` | the git author name of most of the PR's commits (machine identities `*@local` skipped); `null` when none (additive) |
| `authorKey` | that author's person key, `sha256("worca:" + lower-cased email)` first 16 hex, as `actorKey` on runs (additive) |
| `author` | the PR author's GitHub login, a fallback for the two above (additive) |

Under `attribution: "none"` all three are `null`.
| `state` | `OPEN`, `MERGED` or `CLOSED` (closed without merge) |
| `createdAt`, `mergedAt`, `closedAt`, `updatedAt` | GitHub's timestamps, UTC; `null` when not yet |

Readers apply the same guards as for run files (regular files only, no symlinks, bounded size)
and ignore files not named `<number>.json`.

## Run file naming

One run is one file: `records/YYYY/MM/<YYYYMMDDTHHMMSSZ>-<runId>.jsonl`, where the timestamp
is the run's `startedAt` in UTC. A run recorded once (e.g. `stopped`) and again after a
resume (e.g. `done`) has the **same** `startedAt` and therefore lands on the same path — the
second flush rewrites the file already on the branch, and the last terminal state wins. This
is a deliberate exception to "records are immutable": the alternative (two files for one
run) would double-count that run's spend in every KPI. If a caller ever produces two records
for the same run with *different* `startedAt` values, both files exist on the branch and a
reader is expected to dedupe by `id`, keeping the first one seen.
