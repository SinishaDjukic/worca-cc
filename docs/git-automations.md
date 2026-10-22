# Git event automations and Auto-handle

> Experimental: turn on **Git event automations** in Settings › Labs (flag `gitAutomations`), or run
> `worca flags on gitAutomations`. While it is off nothing polls GitHub, every `/api/automations` route
> and the webhook answer 404, and rules you already made stay stored but do nothing.

Worca can start a run when something happens on GitHub, without anyone opening New run. An automation
works like a hook: **when an event happens in a project and matches a filter, Worca runs a workflow.**

Two events are supported today:

| Event | Fires when |
|---|---|
| Issue opened | A new issue is opened. If Worca skipped it because its author is not a collaborator, it looks again when a label is added (see [Who can start a run](#who-can-start-a-run)). |
| PR opened or ready | A pull request is opened, or a draft is marked ready for review. A review rule also looks at every new head commit pushed to the PR. |

Editing an issue or a PR never starts a run. Neither do Worca's own comments or Worca's own PRs.

## Auto-handle

**Settings › Automations** (or **Automations** on a project page) has three switches per project:

- **New issue → propose a fix.** Worca reproduces the issue where it can, finds the root cause and
  writes a fix plan. It posts the plan as an issue comment and stops. No code is changed until a person
  approves: **Approve the fix** in Worca, or a `/worca approve` comment on the issue from a collaborator
  (OWNER, MEMBER or COLLABORATOR). The fix then runs with the approved plan, as below.
- **New issue → full fix.** Worca fixes the issue, opens a **draft** pull request whose description says
  `Closes #N`, turns on Watch PR for it, and links the PR in an issue comment.
- **New PR → automatic review.** Worca reviews the PR's head and posts **one** review with inline comments
  where a finding names a line in the diff (the rest go in the review's body). It never approves, never
  requests changes and never merges, and it skips drafts and Worca's own PRs. A new push gets a new review.

"Propose a fix" and "full fix" both answer new issues, so turning one on turns the other off.

## Rules

**Add rule** makes a rule of your own: the event, what to do (propose a fix, full fix, review, or run any
workflow), and optionally:

- **Only with these labels** — the issue or PR must carry one of them.
- **Trigger label** (default `worca`) — see below.
- **Also trust these logins** — people who are not collaborators but may start runs.
- **Limits** — runs per day (default 10), a cost cap per run (default $5) and how many event runs may
  run at once in the project (default 1).

A rule that is turned off and on again does not pick up what was opened while it was off.

## Ready-made workflows

The actions use these workflows. Each is a normal saved workflow that Worca writes the first time it
needs it; open it in the Workflows view and edit it like any other. Worca never overwrites one that exists.

| Workflow | Used by |
|---|---|
| Bug → reproduce and root-cause | Propose a fix |
| Issue → plan only | Pick it in a "run a workflow" rule |
| Issue → fix and open a draft PR | Full fix, and the fix after an approval |
| PR → review | Automatic review |

None of them has a Clarify step: nobody is watching an event run.

## Delivery

- **Local install (polling).** Worca checks each repository that has an enabled rule once a minute, using
  conditional requests and a stored cursor. A project with no rules polls nothing.
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

**Check now** in Settings › Automations polls at once.

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

## Activity and chat

Every start, skip, queue, approval request, finish and failure goes to the Activity feed (Schedules ›
Activity) and to your chat channels, with its reason. A run started by an automation names who triggered
it ("issue #42, opened by @alice") in its started-by field and its audit log.

## Credentials

Comments, reviews and pull requests use Worca's own GitHub credential (the `gh` login, a token, or the
GitHub App). Per-project GitHub identities (#705) will be used once they exist.

## Not covered yet

- Azure DevOps repositories, and workspace (multi-project) runs.
- More events: label added as its own event, `/worca` comment commands besides `approve`, PR review
  comments, pushes to a branch, and CI failing on the default branch.
- An Automations step in Add project (use the project page's **Automations** button).
- Waking a suspended hosted instance on a webhook.

## API

All routes need the flag; they answer 404 while it is off.

| Route | |
|---|---|
| `GET /api/automations?projectDir=` | `{ rules, events, autoHandle, repo, switches, templates, webhook, polling }` |
| `POST /api/automations/rules` | `{ projectDir, event, action, workflowId?, filter?, limits?, guardrailsId?, enabled? }` → 201 `{ rule }` |
| `PATCH /api/automations/rules/:id` | `{ enabled?, filter?, limits?, workflowId?, guardrailsId? }` |
| `DELETE /api/automations/rules/:id` | |
| `PUT /api/automations/auto-handle` | `{ projectDir, key: propose \| fix \| review, on }` → `{ autoHandle }` |
| `POST /api/automations/events/:id/approve` | Start the fix of a proposed plan |
| `POST /api/automations/poll` | Poll now |
| `POST /api/ingress/github` | The signed webhook |
