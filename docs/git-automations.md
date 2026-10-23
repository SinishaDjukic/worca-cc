# Git event automations and Auto-handle

> Experimental: turn on **Git event automations** in Settings › Labs (flag `gitAutomations`), or run
> `worca flags on gitAutomations`. While it is off nothing polls GitHub or Azure DevOps, every
> `/api/automations` route and both webhooks answer 404, and rules you already made stay stored but do nothing.

Worca can start a run when something happens on GitHub or Azure DevOps, without anyone opening New run. An automation
works like a hook: **when an event happens in a project and matches a filter, Worca runs a workflow.** A workspace
can have automations too: they watch every member's repository (see [Workspaces](#workspaces)).

Two events are supported today:

| Event | Fires when |
|---|---|
| Issue opened | A new issue is opened. If Worca skipped it because its author is not a collaborator, it looks again when a label is added (see [Who can start a run](#who-can-start-a-run)). |
| PR opened or ready | A pull request is opened, or a draft is marked ready for review. A review rule also looks at every new head commit pushed to the PR. |

Editing an issue or a PR never starts a run. Neither do Worca's own comments or Worca's own PRs.

A project's repository is its `origin` remote when that is on github.com or dev.azure.com, else the first remote
that is. On Azure DevOps see [Azure DevOps](#azure-devops) for what each event means there.

## Auto-handle

Each project's **Automations** tab (on its project page) has three switches, each with a line on what it does and
the limits it runs under. A workspace page has the same tab. **Settings › Automations** is the overview: which
projects and workspaces automate what, how events arrive, and the latest activity across them.

- **New issue → triage and propose.** Worca first decides what kind of issue it is (see [Triage](#triage)):
  - a **bug**: it reproduces the issue where it can, finds the root cause and writes a fix plan;
  - a **feature request**: it writes a plan for the change;
  - a **question**, or **unclear**: no run. One comment says so, or asks for the details that are missing.

  It posts the plan as an issue comment and stops. No code is changed until a person approves:
  **Approve** in Worca, or a `/worca approve` comment on the issue from a collaborator
  (OWNER, MEMBER or COLLABORATOR). The fix then implements the approved plan (no new planning), reviews it,
  and opens a draft PR as below.
- **New issue → full fix.** Worca fixes the issue, opens a **draft** pull request whose description says
  `Closes #N`, turns on Watch PR for it, and links the PR in an issue comment.
- **New PR → automatic review.** Worca reviews the PR's head and posts **one** review with inline comments
  where a finding names a line in the diff (the rest go in the review's body). It never approves, never
  requests changes and never merges, and it skips drafts and Worca's own PRs. A new push gets a new review.

"Triage and propose" and "full fix" both answer new issues, so turning one on turns the other off.

### Triage

1. **The issue's own signal first**, free and predictable: its type (GitHub's issue type; on Azure DevOps the
   work item type: Bug is a bug, User Story, Feature, Product Backlog Item, Epic or Requirement a feature), then its
   labels: `bug`, `defect`, `regression`, `crash` → bug; `enhancement`, `feature`, `feature request`,
   `improvement`, `idea` → feature; `question`, `support` → question (`type: bug`, `kind/feature` and the like
   count too).
2. **Only when there is none**, one cheap model call reads the title, labels and body (as untrusted data) and
   answers bug, feature, question or unclear. It runs on the Smart run naming model (Models › Helper jobs › Run
   naming, else the cheapest ready Claude model at its lowest effort), is recorded as utility spend `triage`, and
   is never billed to a run. Worca then adds the matching label (`bug`, `enhancement`, `question`,
   `needs-info`; a tag on Azure DevOps) where its credential may. Without an answer (no model, the total budget
   spent) it proposes a root-cause plan, as before triage existed.

A question or an unclear issue is not looked at again until someone gives it a bug or feature label (or type):
then it runs on that word, without another model call. In mock mode (`WORCA_MOCK=1`) a fixed reading of the title
stands in for the model.

## Rules

**Add rule** makes a rule of your own: the event, what to do (propose a fix, full fix, review, or run any
workflow), and optionally:

- **Only with these labels** — the issue or PR must carry one of them.
- **Trigger label** (default `worca`) — see below.
- **Also trust these logins** — people who are not collaborators but may start runs.
- **Limits** — runs per day (default 10), a cost cap per run (default $5) and how many event runs may
  run at once in the project (default 1).

A rule that is turned off and on again does not pick up what was opened while it was off.

## Workspaces

A workspace page has its own **Automations** tab with the same switches and rules. It watches the repository of every
member project that has a GitHub or Azure DevOps remote (the tab lists them, and names a member it cannot watch).

- **An issue starts a workspace run.** For an issue in any member repository, a workspace rule always starts a run
  across the whole workspace, never a project run. The task names every repository and says which one the issue was
  opened in; the planner may leave repositories untouched.
- **Full fix, and the fix after an approval,** end with one **draft** pull request per member the run changed (a
  member it left untouched gets none). The PRs are linked to each other (each one's description lists the others,
  on GitHub), and Watch PR follows each of them. Only the PR in the issue's own repository says `Closes #N`; one
  issue comment lists all the PRs.
- **Triage and propose** works as in a project: the plan covers the workspace, and the fix after an approval is a
  workspace run that implements it.
- **Automatic review stays per PR.** A pull request belongs to one repository: its review runs in that member's
  project, as a project rule's would.
- **Limits.** A workspace rule's defaults are **5 runs a day, $15 per run, 1 at a time** (in the whole workspace).
  Each rule's own limits can be changed when it is added.

**Workspace and project rules on the same repository.** When a repository has project rules and also belongs to a
workspace with rules for the **same event**, the workspace's rules win for that event: the project's rules for it do
nothing while the workspace's are on (its rules for other events still run). The project's Automations tab says
which workspace takes which events over. A repository in two workspaces with rules is handled by both.

On Azure DevOps a work item belongs to the Azure DevOps project, not to a repository: a workspace with a member
repository in that project is the single owner of its work items. One work item is one event and one run, whichever
repository it is seen through, and project rules on repositories of that Azure DevOps project leave its work items to
the workspace. The PR of the workspace's first member in that project (in member order) links the work item; the
other members' PRs do not.

## Ready-made workflows

The actions use these workflows. Each is a normal saved workflow that Worca writes the first time it
needs it; open it in the Workflows view and edit it like any other. Worca never overwrites one that exists.

| Workflow | Used by |
|---|---|
| Bug → reproduce and root-cause | Triage and propose, for a bug |
| Issue → plan only | Triage and propose, for a feature request; or pick it in a "run a workflow" rule |
| Issue → fix and open a draft PR | Full fix |
| Approved plan → implement and open a draft PR | The fix after an approval: Implement ⇄ Review on the approved plan, no planner |
| PR → review | Automatic review |

None of them has a Clarify step: nobody is watching an event run.

## Delivery

- **Local install (polling).** Worca checks each repository that has an enabled rule once a minute, using
  conditional requests and a stored cursor; a workspace rule adds every member's repository, each with its own
  cursor, and a repository is read once however many rules watch it. A project with no rules polls nothing.
- **Hosted (webhooks).** Set `WORCA_GH_WEBHOOK_SECRET` and point a GitHub webhook at
  `https://<your worca>/api/ingress/github` with the same secret (content type `application/json`;
  events: Issues, Pull requests, Issue comments). With a GitHub App, set the App's webhook URL and secret
  instead and give it Issues and Pull requests read and write. Polling keeps running every 5 minutes as a
  catch-up pass. Behind Cloudflare Access, add a **Bypass** policy for `/api/ingress/*` only
  ([remote access](remote-access.md)); the rest of the API stays behind Access.

The webhook answers **404** to anything that is not signed with the secret (the body is never logged),
and to everything while the flag is off or no secret is set. A delivery GitHub sends again (same
`X-GitHub-Delivery`) is acknowledged and dropped.

`WORCA_AUTOMATIONS_POLL=0` turns polling off.

**Check now** in a project's Automations tab polls at once.

On Azure DevOps, set `WORCA_ADO_WEBHOOK_SECRET` and add service hooks (Project settings › Service hooks ›
Web Hooks) to `https://<your worca>/api/ingress/azure` for **Work item created**, **Work item updated**,
**Work item commented on**, **Pull request created** and **Pull request updated**, with **Basic authentication**:
any user name, the secret as the password (service hooks cannot sign a body). Anything without that password
gets 404, and a notification sent again (same `id`) is dropped.

### Nothing twice, no backlog

Each rule records one decision per issue or PR (per head commit for a review). A restart, a missed poll,
or a webhook and a poll seeing the same issue never start it twice. The first poll of a repository only
stores where it is; an item opened before its rule was turned on, or more than 6 hours before Worca first
saw it (Worca was not running), is never replayed: the same rule missed schedule slots follow.

## Who can start a run

Only trusted authors start runs: OWNER, MEMBER or COLLABORATOR on the repository (the rule Watch PR
applies to review comments), plus the logins a rule adds. An issue from anyone else starts nothing and
costs nothing; it shows in Activity as skipped. A maintainer starts it by adding the rule's trigger label
(only people with triage access can label).

Issue and PR text is untrusted input. It reaches the agents quoted and framed as a description of the
problem, never as instructions. Event runs use the **Strict** guardrail set by default, and agents still
never get a GitHub credential. Worca's own comments, reviews and PRs carry a marker and are never treated
as events.

## Azure DevOps

The same rules, switches and templates work on a repository on dev.azure.com (`dev.azure.com/<org>/<project>/<repo>`
in the rule list). What changes:

- **Issue opened is a work item created** in the repository's Azure DevOps project (any type), and a work item
  whose tags change is looked at again. Tags are the labels of a rule's filters. A work item belongs to the
  project, not a repository: when several Worca projects use repositories of the same Azure DevOps project, each
  one's rules see it, so narrow them with a tag filter, or put the projects in a workspace with automations, which
  then owns the project's work items (see [Workspaces](#workspaces)).
- **Who can start a run:** every author counts as a member. Azure DevOps has no outside contributors: only
  people in your organization can open a work item or a PR, or comment.
- **Triage and propose** reads the work item type first; it posts the plan as a work item comment; `/worca approve` in a comment starts the fix.
- **Full fix** opens a draft PR that **links the work item** (Azure's form of `Closes #N`), and Watch PR follows it.
- **Automatic review** posts one summary thread (closed, for information) and one active thread per finding on its
  line. It never votes and never completes a PR. PRs from a fork are not reviewed yet.
- **Credentials:** `WORCA_ADO_TOKEN` (Code: Read & Write) for repositories and PRs; for work items
  `WORCA_ADO_BOARDS_TOKEN` (Work Items: Read & Write), else the Code token, which then needs that scope too.

## Activity and chat

Every start, skip, queue, approval request, finish and failure goes to the Activity feed (Schedules ›
Activity) and to your chat channels, with its reason. A run started by an automation names who triggered
it ("issue #42, opened by @alice") in its started-by field and its audit log.

## Credentials

Comments, reviews and pull requests use Worca's own GitHub credential (the `gh` login, a token, or the
GitHub App). Per-project GitHub identities (#705) will be used once they exist.

## Not covered yet

- GitHub Enterprise Server and Azure DevOps Server (on-premises).
- More events: label added as its own event, `/worca` comment commands besides `approve`, PR review
  comments, pushes to a branch, and CI failing on the default branch.
- An Automations step in Add project (use the project page's **Automations** tab).
- Assignee filters (start only for issues assigned to someone).
- Cross-linking the PRs of a workspace fix on Azure DevOps (their descriptions do not list each other yet).
- Waking a suspended hosted instance on a webhook.

## API

All routes need the flag; they answer 404 while it is off.

| Route | |
|---|---|
| `GET /api/automations?projectDir=` | `{ scope: 'project', rules, events, autoHandle, repo, forge, overriddenBy, switches, templates, defaultLimits, webhook, azureWebhook, polling }`; `overriddenBy` is `[{ workspaceId, name, events }]`, the workspaces whose rules take this repository's events over |
| `GET /api/automations?workspaceId=` | `{ scope: 'workspace', workspaceId, name, repos: [{ name, projectKey, repo, forge }], rules, events, autoHandle, … }` |
| `GET /api/automations` | Every rule and the latest events (the overview); a workspace's are keyed `workspaces/<id>` |
| `POST /api/automations/rules` | `{ projectDir \| workspaceId, event, action, workflowId?, filter?, limits?, guardrailsId?, enabled? }` → 201 `{ rule }` (`rule.scope` is `project` or `workspace`) |
| `PATCH /api/automations/rules/:id` | `{ enabled?, filter?, limits?, workflowId?, guardrailsId? }` |
| `DELETE /api/automations/rules/:id` | |
| `PUT /api/automations/auto-handle` | `{ projectDir \| workspaceId, key: propose \| fix \| review, on }` → `{ autoHandle }` |
| `POST /api/automations/events/:id/approve` | Start the fix of a proposed plan |
| `POST /api/automations/poll` | Poll now |
| `POST /api/ingress/github` | The signed GitHub webhook |
| `POST /api/ingress/azure` | The Azure DevOps service hook (Basic authentication) |
