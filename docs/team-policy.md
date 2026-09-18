# Team policy

Team policy is a **git-backed set of team-wide expectations** Worca reads for a repository:
cost caps, an advisory pooled budget, Ask Worca limits, guardrail defaults, allowed models,
required plugins and marketplaces, a default workflow. A product manager or lead publishes it
to an orphan branch `worca-policy` on the project's own `origin`; every teammate's Worca reads
it on start and hourly. There is no server and no account: **authority is push permission on
that branch**, so protect it on your git host so only maintainers can push (the opposite of
`worca-metrics`, which every teammate must be able to push to).

Nothing about a run's own branches changes — `worca-policy` carries only `.worca-policy/policy.json`
and a README, and is never merged into anything.

## Soft by design

Every value in a policy carries a **kind**:

| kind | meaning |
|---|---|
| `default` | A starting value. Applies when you have not set the field yourself; changing it locally is silent. |
| `soft` | An expectation. For a cap, the tighter of team and local applies; you can go past it after a confirmation, and the overshoot is recorded to team metrics. For a list (allowed models, required plugins, a minimum guardrail tier), a deviation is a warning plus a record. |
| `hard` | Reserved. Accepted and treated as soft with a note in the run log; the editor does not offer it. A later version can enforce it without a format change. |

No run is ever blocked by a policy. A soft cap that would pause an **unattended** run
(`--yes`) warns instead — nobody is there to click "continue past" — and the record says so.

## What a policy can set

| field | governs | kinds |
|---|---|---|
| Per-pipeline cap (USD) | the pipeline cost limit; soft caps carry `onBreach: pause | warn` and `requireReason` | default · soft |
| Total cap per period (USD) | the windowed total limit, per developer; acknowledged once per window per home | default · soft |
| Reset period | weekly / monthly, when you have not stored one | default |
| Pooled budget (USD) | the whole team's figure, read from team metrics; advisory only | soft |
| Ask Worca turn limit, per-turn cap | Settings › Ask Worca, when you have not stored them | default |
| Guardrails default set / minimum tier | what the New pipeline picker starts on; a run below the tier warns | default / soft |
| Allowed models, step defaults, hide built-ins | pickers warn on an off-list model; roles you have not configured start from the team's | soft / default |
| Marketplaces, required plugins, blocked plugins | marketplaces are added once (metadata only); required plugins go through the setup checklist with consent; blocked ones warn | default / soft |
| Default workflow, human in the loop | when the project has no active workflow / switch of its own | default |
| Record runs to team metrics, minimum Worca version | a hint when "Include my runs" is off; a banner on an older client | soft |
| Catalogs: guardrail sets, models | distributed as read-only rows with a **policy** badge; model env may use `${VAR}` indirection only — secrets never go on the branch | — |

A document may also carry a **`workspaceRuns`** block: the same fields, applied instead of the
project-run values to runs that target a workspace (they span several repositories and are
usually larger, so one cap is normally wrong for one of the two).

## Homes, following, workspaces

- A project **carries** a policy on its own `worca-policy` branch, or **follows** another
  project's with a tiny marker branch (`{ "delegateTo": "acme/gateway" }`). No chains.
- A **workspace** has no origin of its own: it points at a **policy home**, a member that carries
  or follows a policy, and uses that policy (with its `workspaceRuns` block) for workspace runs.
  Member projects' own policies are never unioned into a workspace run; the run log names a
  member with a tighter cap. The pointer is per machine, like the metrics home, and defaults to
  the metrics home when that member's policy resolves. "Route all to policy home" writes a
  marker on every member that has no branch yet.
- Set up from the **Projects** page cell (`Set up team policy…`: here, or follow), the workspace
  card, or `worca policy init --here | --follow <slug>`.

## What applies where

Resolution is field by field: the home's `workspaceRuns` (workspace runs only) → the home's
`fields` → your local settings → Worca's defaults. The **Team policy** page shows the fold for a
project or workspace: the team value, yours, and what your next run will use, with a struck-through
local value where yours is looser than a soft team cap.

- **Cost gates.** At every step boundary the tighter of your cap and a soft team cap applies. A
  team breach pauses the run on a policy reason (`Paused — team cost cap reached`) with
  "Continue past team cap"; the override persists on the run. The team total cap is acknowledged
  once per reset window per home. Your own local caps keep their existing behaviour and are never
  bypassed by a team acknowledgement.
- **Run start.** New pipeline lists the policy's notes (off-list model, missing plugin, guardrails
  below the minimum) — nothing there blocks Start run. `POST /api/run` and `worca run` refuse only
  a team total cap that has not been acknowledged; `pastTeamCap` / `--past-team-cap [--reason]`
  records the acknowledgement and proceeds.
- **Recording.** A run that saw a policy carries a `policy` object in its team-metrics record:
  the home and commit, caps continued past (`overrides`), caps passed under warn (`exceeded`),
  off-policy findings (`deviations`), whether the run was unattended, and the reason (dropped
  under `attribution: none`). Team metrics shows an Off-policy tile and an Overrides column.

## Plugins: guided, never automatic

A policy can add **marketplaces** (metadata only, done automatically once; a marketplace you
remove is remembered and not re-added) and require **plugins** with a minimum version. Installing
runs code, so Worca never installs without your click: the Plugins page shows a "Required by team
policy" strip and a setup checklist with one combined consent per plugin (source, commit,
inventory). A per-home **trust switch** on this machine may install and update required plugins
automatically; it is off by default and revocable. Versions are floors, not pins: update whenever
you like through the normal update preview; when the policy raises the floor you are told.
Non-secret plugin config (a base URL, a project key) may be seeded at install; secrets are yours.

## Reading and freshness

Discovery runs on server start and hourly, together with team metrics discovery. The document is
cached in the project's config row; **no git call sits on a run's path** — only a project with no
cache at all pays one bounded fetch. A CLI-only machine refreshes with `worca policy pull`.
A missing, unreadable or newer-schema policy means your local settings apply, with one loud line
in the run log and a red note on the Projects cell.

## Editing

The **Team policy** page's editor writes one commit to the home's branch. A rejection
(a protected branch you cannot push to) is shown verbatim with the recovery paths: copy the
JSON and open a pull request against `worca-policy`, or ask a maintainer. Hand edits are fine:
the reader drops a malformed field with a warning and never fails the page.

## Ask Worca

The chat reads the team policy and can propose changes to it, the same way it handles team
metrics. It works with homes, following, fields and caps. It never sees worktrees or branch
mechanics.

- **`list_projects`** gives each project a policy status: carries, follows, off, no origin or
  invalid, with the home, the caps and the field count. Each workspace gets its policy home, what
  its `workspaceRuns` block changes, and where each member's policy comes from.
- **`get_team_policy`** takes a project or a workspace, or the scope pinned for the chat. It
  answers what applies on this machine and why, as the Team policy page does:
  - the home and commit, and whether the project follows another project's policy;
  - one row per field, with its kind, the team value, your value, the effective value and its
    source;
  - the `workspaceRuns` block;
  - the policy's own guardrail sets and models;
  - required and blocked plugins, and their state here;
  - your deviations;
  - whether the policy can be published from this machine.

  A scope without a policy answers `policy: null` with the reason.
- **`get_run`** includes the run's policy state: overrides, overshoots, deviations and the
  override reason. A run paused at a team cap also gets a plain-words explanation of the pause.
- **`get_team_metrics`** and **`list_team_metrics_runs`** include the policy counts, and each
  run recorded under a policy includes its `policy` details.
- **`propose_policy_change`** prepares a card. The change happens only when the user clicks.
  - `enable`: set up a policy here, or follow another project's.
  - `edit`: set and unset fields, in `fields` or in the `workspaceRuns` block, and change the
    title and notes. It publishes as one commit to the home.
  - `workspace_home`: set or clear a workspace's policy home.
  - `route_members`: route a workspace's members to its home.

  An edit card lists each change as before → after. When you apply it, Worca re-reads the
  policy and applies the changes on top. A teammate's publish made since the proposal is kept.

Continuing past a team cap is deliberately not something the chat can do. That override carries
a person's reason, so it stays on the pause banner and in History. When the Team policy page is
open, the chat is told which scope it shows.

## CLI

```
worca policy show [--project <path>] [--json]        the effective policy for a project
worca policy pull [--project <path>]                 fetch the branch now
worca policy init --here | --follow <slug>           create the branch, or a marker
worca policy setup [--install]                       the setup checklist; --install runs it
worca … --past-team-cap [--reason "<why>"]           continue past a soft team cap
worca resume <id> --past-team-cap [--reason "<why>"]
```

## Compatibility

Projects without a `worca-policy` branch behave byte-identically to before. Older Worca
versions ignore the branch. Team-metrics records gain an optional `policy` key under the same
record version; older readers ignore it. The database gains two additive columns
(`pipelines.policy_state`, `workspaces.policy_project`, schema v31).
