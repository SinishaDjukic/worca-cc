# Team metrics

Team metrics is a **git-backed, team-wide record of finished runs**. Every teammate whose
Worca has a project enabled writes one small JSON file per finished run to an orphan branch
(`worca-metrics`) on the project's own `origin` remote. There is no separate metrics server:
the branch itself is the shared store, fetched and pushed like any other git ref. A **Team
metrics** page (top-level, alongside History and Statistics) reads that branch back and
aggregates spend, runs, duration, autonomy and review cycles per project or per workspace.

Nothing about a run's own branch or history changes — `worca-metrics` carries only
`.worca-metrics/` and is never merged into anything.

## Enable and join

A project turns team metrics on from its **Projects** cell (`Enable…`), in one of two modes:

- **Here, on this repository** — Worca creates the orphan branch `worca-metrics` on `origin`,
  holding only `.worca-metrics/`, and pushes it. Every finished run — done, failed or stopped —
  is then pushed there as one file, by every teammate whose Worca sees the branch.
- **In another project that already records** (**delegate**) — Worca writes a tiny marker
  branch on this project's own origin that points at the target project's slug. This
  project's single-project runs land on the target's branch, still labelled with this project's
  name. A delegate must be a project (or workspace member/home) Worca already knows about on
  this machine; delegating to a project that itself delegates ("chains") is rejected.

If a teammate has already enabled the branch on `origin` before you do, clicking **Enable…**
here **joins** it instead of creating a second orphan history — the push-not-fast-forward from
a race is exactly this case, handled the same way.

At enable time you also pick an **attribution** policy for the whole team, once: record the
git user name on every run, or none. This can only be changed later by editing the config file
on the branch by hand.

Discovery keeps each project's local view of the branch current: the web server refreshes it on
a schedule and on demand ("Check now" on the workspace card), and a CLI-only machine — no UI
server running — refreshes it only when you run `worca add` or `worca metrics push`.

## "Record my runs"

Once a project is enabled (or delegating), its own switch — "Record my runs" — controls whether
*your* runs on that project are recorded at all. Turning it off does not touch the branch or
anyone else's records; it only stops your own machine from pushing new ones for that project.
For a workspace run, this checks the workspace's **metrics home** project's toggle, not the
run's own member projects.

## Workspace metrics home, delegation and "Route all members"

A workspace records through one designated **metrics home**: a member project (or any project
Worca knows locally) that already records. The workspace card shows the home's slug, status dot
and run count, with a **Choose…** / **Change…** action that opens the same picker used during
enable.

Once a home is set, the workspace card's **Members** row offers **Route all members here**:
every member project that is not already recording gets set up to delegate to the home in one
action, and the row reports how many records locally, how many are now routed to the home, and
how many still aren't recording (with each one's reason, e.g. "no origin remote").

## The sync chip and push failures

Each enabled project's cell shows one status line — the "sync chip" — that reflects the state of
its outbox and its last push, not just whether the toggle is on:

| Chip state | Meaning | Action shown |
|---|---|---|
| Off | Not enabled | `Enable…` |
| Not available | No `origin` remote on this repository | none |
| On (green) | Enabled, nothing pending, last push (if any) succeeded | — |
| On · N pending (amber) | Runs are queued in the local outbox, not yet pushed | `Push now` |
| Push failed / Push rejected · branch protection (red) | The last push attempt failed; runs stay queued | `Retry` |
| Delegated (green, "recorded in `<slug>`") | Enabled via delegation, sink resolves | "Record my runs" switch |
| Delegate invalid (red) | The delegation marker points at a target that no longer records, chains to another delegate, or is not a project Worca knows on this machine | `Change…` |
| Blocked (amber, "branch not read yet") | Enabled, but the branch's config has never been successfully read (`configKnown:false`) — runs are being skipped until the next successful fetch | none |

A push failure never loses a run: the file stays in the local outbox and is retried on the next
flush (scheduled, `Push now`, or `worca metrics push`), up to 5 attempts before it is reported as
failed in the UI. The most common rejection is a branch-protection rule on `worca-metrics`
itself — see the next section.

## Branch-protection exemption

Worca pushes to `worca-metrics` directly, without opening a pull request. If your repository
protects branches by a wildcard rule (e.g. `*` or `worca-*`), you must add an exemption for
`worca-metrics` — otherwise every push is rejected and the sync chip shows **Push rejected ·
branch protection**. The enable dialog and the rejected-chip hint both say this.

## Disabling for the team

Team metrics has no per-project "off" switch that affects the branch itself — disabling for
everyone means deleting the shared branch on `origin`:

```bash
git push origin --delete worca-metrics
```

Any teammate with push access can run this. It is shown as the title/tooltip of the status text
on every enabled project's cell, so it is discoverable without reading this document. After
deletion, the project's local outbox is retained for 30 days from the moment the branch is
observed gone, then dropped — re-enabling within that window does not resurrect old queued
files.

## `worca metrics push`

```bash
worca metrics push [--project <path>]
```

Flushes pending run records to their `worca-metrics` branch — every outbox on the machine
without `--project`, or just one project's with it. This is the CLI-only counterpart to the
web server's background flush and the page's `Push now` button; it also refreshes discovery
first (best-effort, offline keeps the cached verdicts), so a branch a teammate enabled since the
last discovery is picked up. A CLI-driven run also awaits any in-flight flush for up to 30
seconds before the process exits, so a run's own record isn't stranded in the outbox; anything
still queued after that is covered by a later `worca metrics push`. Exit code `0` means every
outbox pushed (or nothing was pending); `1` means at least one could not be pushed.

## Requirements

- **git ≥ 2.31** on every machine that records or reads team metrics.
- Metrics commits and pushes **bypass the repository's client hooks and commit signing** — the
  metrics git worktree shares `.git/hooks` (and `core.hooksPath`) with the project, so every
  metrics git command runs with an empty `core.hooksPath` and `commit.gpgsign=false` /
  `push.gpgSign=false`. This is deliberate: a project's own `pre-commit`/`pre-push`/
  `post-checkout`/`reference-transaction` hooks are not meant to run against an orphan branch
  they don't know about, and a signing prompt cannot be answered headlessly.
- The `worca-metrics` branch must be exempt from branch protection / rulesets on `origin` (see
  above) — Worca never opens a pull request for it.

## Privacy

A run record carries no hostnames or local filesystem paths: any absolute path inside an error
message is replaced with the literal `<path>` before the record is written (URLs are left
intact, so a GitHub issue or PR link in an error stays readable). What it does carry: the task
title, the source it came from (if any) and its own URL, cost and timing, git branch/diff stats,
and — unless the team chose "No attribution" when enabling — the git user name of whoever ran
it. Anyone with read access to the repository can read every record on `worca-metrics`, and
anyone with push access can write to it; there is no additional access control layer on top of
your existing git permissions.

## v1 limits and known costs

Team metrics v1 has a few honest gaps and costs, documented rather than hidden:

- Spend on a run that pauses (e.g. a cost cap or a setup failure) and is then abandoned is
  **not recorded**. Only a run that reaches a terminal state (`done`, `error`, `stopped`) is
  ever recorded; a run left parked forever never gets there.
- `git.head` is usually `null`. At the moment a run is recorded, the worktree's `HEAD` is still
  the pre-run checkpoint — the agent's own commit happens after that point — so recording `HEAD`
  then would mislabel the previous commit as this run's.
- A CLI-only machine (no UI server running) refreshes its discovery cache only when you run
  `worca add` or `worca metrics push` — there is no hourly background loop without the server.
- A page load can wait behind a running flush of the same slug: flush and read share the same
  per-slug lock.
- "Check now" and the workspace member scan discover **sequentially**, project by project, so a
  large workspace with a slow remote takes a while to refresh fully.
- The `malformed` / `needs a newer Worca` counts shown in the sync chip are **per branch**, so a
  delegate home's counts are shown for every project that delegates to it, not split per
  delegating project.
- A run recorded twice — once as `stopped`, then again as `done` after a resume — rewrites the
  **same** file on the branch: the last terminal state wins. This is a deliberate exception to
  "records are immutable" (the alternative, two files for one run, would double-count that
  run's spend in every KPI).

## Local layout

Team metrics keeps its own working state under `~/.worca-cc/metrics/` (see
[`docs/storage.md`](./storage.md) for the full directory layout):

- `repos/` — one detached git worktree per recording project, checked out at
  `origin/worca-metrics`.
- `outbox/` — pending run records per project (the durability point before a push succeeds),
  plus the cross-process lock file for that project's slug.
- `ledger/` — one small per-run status file used by the History header to show whether a run's
  record made it to the branch.

## Record schema

The full field-by-field reference for the JSON written to the branch — including the v1 field
table, versioning rules and worked examples — lives in
[`docs/team-metrics-record-v1.md`](./team-metrics-record-v1.md).
