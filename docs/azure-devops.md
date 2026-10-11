# Azure DevOps

Worca works with Git repositories on **Azure DevOps Services** (`dev.azure.com`, and the older
`<org>.visualstudio.com` spelling) next to GitHub. One personal access token (PAT) where Worca runs
is all it needs. Each git call and each REST request gets the credential for its own host, one call
at a time; agents never get it, in any guardrail set.

## What works

- **Ship it.** A finished run's **Create pull request** pushes the branch and opens the pull request
  over the Azure DevOps REST API (7.1). The run page then links to it (**View pull request**) and
  shows whether it can merge. History shows it, and the `until-pr` stop works as on GitHub. A
  description longer than Azure's 4,000 characters is cut, with a note saying so. **Open as draft**
  opens it as a draft. A run that came from a GitHub issue adds no `Closes` line here.
- **Clone.** **Add project → Clone** takes an Azure repository URL (shapes below).
- **Fetch and sync**, including the `worca-metrics` and `worca-policy` branches on an Azure
  `origin`.
- **Team metrics merge dates.** Runs whose branch became an Azure pull request get its creation
  and merge dates, so Shipped, In review and lead time work. The token needs *Code (Read)*.
- **The Azure Boards task source** (the `azure-boards-source` plugin): pick work items as tasks,
  and close them when a run completes if you turn that on. A pull request Worca opens in the same
  organisation links the work item.
- **Watch PR**, Resolve and the pull request row on the run page and the Overview tab, as on
  GitHub ([below](#watch-pr)).

## What does not work (yet)

- **Forks.** A pull request between two repositories is refused before anything is pushed:
  *Azure DevOps pull requests between repositories (forks) are not supported yet — push to
  origin.* (the message names your base remote). Push to the base repository instead.
- **On-premises Azure DevOps Server** (TFS). Only `dev.azure.com` and `*.visualstudio.com`.
- **Service principals and managed identities.** PAT only.
- **"Push as me."** It is GitHub-only. `WORCA_GH_AS_PERSON=required` does not refuse an Azure
  push; the push uses the deployment's Azure token.
- **"Outside Worca" pull requests and PR authors** in team metrics. They come from the GitHub
  Action's event files; Azure repositories show only the pull requests of recorded runs, without
  their git author.
- **An Azure DevOps MCP server** as a stopgap for Ask Worca and agents. Not shipped: future work.

### "Create PR" with only an Azure token

The History list does not know a row's remote, so it offers **Create PR** whenever *some* pull
request host is available: `gh` is signed in, or an Azure token is set. On a deployment with only
an Azure token and no `gh`, a GitHub project's row still shows **Create PR**. The Ship-it dialog
then names the forge of the chosen base remote and says *GitHub CLI (gh) is not available* before
anything is pushed. The reverse holds too: with `gh` and no Azure token, an Azure project's dialog
says *Azure DevOps is not configured: set WORCA_ADO_TOKEN (a PAT with Code: Read & Write) where
worca runs*.

## Setup

1. In Azure DevOps: **User settings → Personal access tokens → New Token**. Pick the organisation
   (or all accessible organisations) and an expiry, then grant:

   | Use | Scope |
   | --- | --- |
   | push, pull requests (`WORCA_ADO_TOKEN`, or the write token) | **Code (Read & Write)** |
   | clone, fetch, metrics only (the read token) | **Code (Read)** |
   | Watch PR: build logs and the base branch's builds | **Build (Read)**, on the read token |
   | the Boards task source (its own token, below) | **Work Items (Read & Write)** and **Project and Team (Read)** |

2. Set it where Worca runs, and restart Worca:

   | Variable | Meaning |
   | --- | --- |
   | `WORCA_ADO_TOKEN` | one PAT for clone, fetch, push and pull requests |
   | `WORCA_ADO_READ_TOKEN`, `WORCA_ADO_WRITE_TOKEN` | a read/write pair; either one switches to split mode. Reads use `READ` (else the single token), writes use `WRITE` (else the single token) |
   | `AZURE_DEVOPS_EXT_PAT` | the Azure CLI's variable; used as the single token when `WORCA_ADO_TOKEN` is not set |

   The same rules as GitHub's `GH_TOKEN` / `WORCA_GH_READ_TOKEN` / `WORCA_GH_WRITE_TOKEN`.
   Container: [docker.md](docker.md#azure-devops). Railway:
   [deploy-railway.md](deploy-railway.md#azure-devops).

**PATs expire**, after at most a year (what you chose at creation). When one does, pushes and pull
requests fail with *Azure DevOps refused the token (expired, revoked, or missing the Code scope)*
and the team metrics page says the token was refused. Create a new one and set it again.

## Repository URLs

Every spelling below is the same repository to Worca (`dev.azure.com/acme/Shop/api`):

| Remote | Notes |
| --- | --- |
| `https://dev.azure.com/acme/Shop/_git/api` | the canonical form; a `user@` before the host is ignored |
| `https://acme.visualstudio.com/Shop/_git/api` | the older host; an optional `DefaultCollection/` is dropped |
| `git@ssh.dev.azure.com:v3/acme/Shop/api` | ssh, `v3/org/project/repo` only (also `vs-ssh.visualstudio.com`) |
| `https://dev.azure.com/acme/_git/Shop` | the project's default repository: project and repository are both `Shop` |

Names are percent-decoded (`My%20Project` is `My Project`) and compared case-insensitively. An
https URL without `_git` is not a repository URL. Worca's own git calls are https; an ssh remote
pushes with your ssh agent, as for GitHub.

**Clone** takes https only (no port, query or password; a password is refused with a pointer to
`WORCA_ADO_TOKEN`), and clones from `https://dev.azure.com/org/project/_git/repo`.

**`WORCA_CLONE_ALLOW`** matches `dev.azure.com/<org>/<project>/<repo>` for every spelling, any
depth, case-insensitively. An entry ending in `/*` is a prefix:

```
WORCA_CLONE_ALLOW=dev.azure.com/acme/*                  # every project of the acme organisation
WORCA_CLONE_ALLOW=dev.azure.com/acme/shop/*             # every repository of the Shop project
WORCA_CLONE_ALLOW=dev.azure.com/acme/shop/api           # one repository
WORCA_CLONE_ALLOW=dev.azure.com/acme/My%20Project/*     # names may be percent-encoded
```

`dev.azure.com/acme/*` does not match the organisation `acmecorp`. Combine hosts with commas
(`github.com/acme/*,dev.azure.com/acme/*`).

**Egress.** With the container's egress allowlist, add
`dev.azure.com,.visualstudio.com,vssps.dev.azure.com` to `WORCA_EGRESS_ALLOW`. The default list is
not widened for an opt-in host. `ssh.dev.azure.com` is not needed, since Worca's own git calls are
https.

## Watch PR

Watch PR works the same on an Azure pull request as on GitHub (see [UI levels](ui-levels.md)).
These are the Azure DevOps sources it reads:

| GitHub | Azure DevOps |
| --- | --- |
| A check run or commit status on the PR head | A **policy evaluation** of the PR. Azure Repos builds a PR only through a *build validation* policy, so each build policy is a check, named by the policy's display name. A *status check* policy makes an external service's PR status a check. Statuses no policy covers count only when nothing is required. |
| Required (branch protection) | The policy is **Required** (blocking) |
| Re-run the failed jobs once (`gh run rerun --failed`) | **Re-queue** the build policy once (a new build) |
| The failed job's log | The build's failed tasks: name, error issues and the last 200 lines of each task log, then the last 12 KB |
| The base head's checks | The newest build of the same pipeline on the base branch at its live tip, and that commit's statuses |
| Behind the base (`compare`) | The commit diff between the base tip and the PR head (`behindCount`) |
| Merge conflicts | Azure's merge check reports conflicts |
| A review thread | A comment in an *Active* or *Pending* thread. Anyone who can comment on an Azure PR is a member of its project, so every commenter counts. |
| A "changes requested" review | A reviewer's *Rejected* or *Waiting for author* vote, not a group's. A vote fires once, and again only when the reviewer changes it. |
| Reply on the thread | Reply in the thread, which stays active for the reviewer to resolve. A vote gets a PR comment in a new thread created *Closed*, so it never blocks a comment-resolution policy. |

The pull request row's verdict is GitHub's merge box in Azure terms:
- **Changes requested** is a rejecting vote.
- **Review required** is a required reviewer policy (minimum number of reviewers, or required
  reviewers) that is not yet met.
- **Blocked by branch rules** is any other required policy not yet approved, such as linked
  work items or comment resolution.
- **Ready to merge** is every required policy approved and a clean merge check.
- Azure never requires an up-to-date branch, so the row never shows *Out of date*.

**Token scopes.** Reading the checks, threads and the base head needs *Code (Read)*. Reading
build logs and the base branch's builds also needs *Build (Read)*. Replies need *Code (Read &
Write)*, and so does re-queueing a build policy. Without *Build (Read)* the fix task names the
failed build and links to it, but has no log, and every failure counts as the PR's own.

## Azure Boards

The `azure-boards-source` plugin has **its own token field**. It never falls back to
`WORCA_ADO_TOKEN`, so a Code token is never used for work items, and a Boards token is never used
for code. Set the PAT (scopes *Work Items (Read & Write)* and *Project and Team (Read)*, which the
Project picker needs) as `WORCA_ADO_BOARDS_TOKEN` and put
`{"$env":"WORCA_ADO_BOARDS_TOKEN"}` in the plugin's **Personal access token** field. You may
reference `WORCA_ADO_TOKEN` there deliberately, if that PAT also carries those two scopes.

Worca never reads `WORCA_ADO_BOARDS_TOKEN` as its own credential. It strips it from every agent,
script and action it starts, and from the environment of its own `git push` and `git fetch`. Other
local git calls the Worca server makes, such as creating a run's worktree, inherit the server's
environment, as they already do for `GH_TOKEN`. A project's git hooks (for example
`post-checkout`) can therefore see it, so only enable hooks you trust on a server that holds
tokens.

**The default filter** is `[System.AssignedTo] = @Me AND [System.State] <> 'Closed'`. Scrum and
Basic processes call the finished state `Done`, so those teams should set the filter to:

```
[System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed', 'Done', 'Removed')
```

The plugin's [README](../plugins/azure-boards-source/README.md) has the other fields.

## Upgrading

Projects whose `origin` is a `*.visualstudio.com` URL, or the `dev.azure.com/org/_git/repo` short
form, get a new team-metrics and team-policy slug: `dev.azure.com/org/project/repo`. Old records,
delegation and policy markers, and cached homes stay joined, because every comparison
canonicalises the old spellings (`acme.visualstudio.com/shop/api` and `dev.azure.com/acme/shop`
are `dev.azure.com/acme/shop/api` and `dev.azure.com/acme/shop/shop`). The local metrics cache is
fetched again once. Three things do not carry over:

- A **Team MCP set** published by such a policy home shows greyed, and its servers ask for consent
  again. Use **Forget** on the greyed set to remove the old consent, seeds and secrets.
- A **team total-cap acknowledgement** is asked once more.
- A project cloned from `https://<org>.visualstudio.com/_git/<Repo>` (no project in the URL) used
  its folder name as its slug. Its older team-metrics records no longer show in its project view.
  Runs not yet pushed from that machine stay in the old outbox and are not uploaded.

**Upgrade the team together.** An upgraded machine writes the new slug into new follow markers and
new metrics records. A teammate still on an older Worca does not recognise it: it ignores a marker
that names its home under the new slug, so its team policy and metrics follow stop resolving, and
it leaves records stamped with the new slug out of its project view. Nothing is lost. Everything
stays on the branches, and the older machine picks it up once it upgrades.

## Verified against

These Azure DevOps behaviours come from Microsoft's documentation and have **not yet been checked
against a real organisation**. No code path depends on them being exactly right: any 409 on create
is recovered by a search for the active pull request, the metrics listing filters by date locally,
and token shapes are matched leniently. Record each result here once it has been checked.

| Behaviour | Expected | Result |
| --- | --- | --- |
| `git credential fill` for `https://*.visualstudio.com` (wildcard credential helper) | answered | not yet checked (covered by a real-git test) |
| Create a pull request with `WORCA_ADO_TOKEN` | 201 | not yet checked |
| Create the same pull request again | 409, `TF401179` | not yet checked |
| Description cap | 4,000 characters | not yet checked |
| `searchCriteria.minTime` on the pull request listing | honoured | not yet checked |
| `workItemRefs` on create | links the work item | not yet checked |
| Boards project list (`_apis/projects`) with a Work Items + Project and Team (Read) PAT | 200; a Work Items-only PAT gets 401 | not yet checked |
| Comments API `7.1-preview.4` | works | not yet checked |
| Work Item Type States API | `7.1-preview.1` (pinned) required, or `7.1` works too | not yet checked |
| `workitemsbatch` with `errorPolicy: 'Omit'` and a deleted id | a `null` slot | not yet checked |
| Pull request list order | `pullRequestId` descending (newest first) | not yet checked |
| New PAT format | 84 characters, `AZDO` marker | not yet checked |
| Policy evaluations (`_apis/policy/evaluations`, `7.1-preview.1`) with a Code (Read) PAT | 200, `context.buildId` and `settings.buildDefinitionId` on a build policy | not yet checked |
| Re-queue an evaluation (`PATCH _apis/policy/evaluations/{id}`) with a Code (Read & Write) PAT | a new build is queued | not yet checked |
| Build timeline and task log (`_apis/build/builds/{id}/logs/{logId}`, `Accept: text/plain`) | plain text with a timestamp per line | not yet checked |
| Commit diff (`diffs/commits`, base and target as commits) | `behindCount` is the base commits the PR head lacks | not yet checked |
| Thread reply (`parentCommentId: 1`, `commentType: 1`) and a new thread with `status: 4` | 200; the new thread shows *Closed* | not yet checked |
| Reviewer policy evaluation while unmet | not `approved` | not yet checked |
| An HTML comment (`<!-- worca:pr-watch -->`) in a PR comment | kept in `content`, hidden when rendered | not yet checked |
