# Bitbucket

Worca works with Git repositories on **Bitbucket Cloud** (`bitbucket.org`) next to GitHub and Azure
DevOps. One token where Worca runs is all it needs. Each git call and each REST request gets the
credential for its own host, one call at a time; agents never get it, in any guardrail set.

## What works

- **Create PR.** A finished run's **Create PR** pushes the branch and opens the pull request over the
  Bitbucket REST API (2.0). **Open as draft** opens it as a draft. When the branch already has an
  open pull request, Worca reuses it instead of opening a second one. The base-branch checks run
  first, as on GitHub: a base the base remote does not have is refused before anything is pushed. A
  run that came from a GitHub issue adds no `Closes` line here.
- **Clone.** **Add project → Clone from URL** takes a Bitbucket repository URL (shapes below). The
  URL Bitbucket's **Clone** button gives you (`https://jdoe@bitbucket.org/…`) is fine: the user name
  is dropped.
- **Fetch and sync**, including the `worca-metrics` and `worca-policy` branches on a Bitbucket
  `origin`, when git is installed where Worca runs.
- **Team metrics merge dates.** Runs whose branch became a Bitbucket pull request get its creation
  and merge dates, so Shipped, In review and lead time work.
- **Watch PR**, Resolve and the pull request row on the run page and the Overview tab, as on GitHub
  ([below](#watch-pr)).
- A pull request closed without merging reads **Declined**.

## What does not work (yet)

- **Forks.** A pull request between two repositories is refused before anything is pushed:
  *Bitbucket pull requests between repositories (forks) are not supported yet — push to origin.*
  (the message names your base remote). Push to the base repository instead. **Publish branch** to a
  fork of a Bitbucket base is refused the same way, as for Azure DevOps.
- **Bitbucket Data Center / Server** (self-hosted, `/scm/` remotes). Only `bitbucket.org`.
- **App passwords.** Use an access token or an Atlassian API token (below).
- **"Push as me."** It is GitHub-only; a Bitbucket push uses the deployment's Bitbucket token.
- **Re-running a failed pipeline** from Worca. Watch PR reads the failed step's log, but never asks
  Bitbucket for a re-run.
- **"Ready to merge" and "Review required"** on the pull request row. Bitbucket's merge checks are
  not readable without admin rights, so the row shows checks, conflicts and *Changes requested* only.
- **Chat chips** for Bitbucket pull request links.
- **A Bitbucket issues task source.** Use Jira through the `atlassian-mcp` plugin.
- **Marketplace publish to Bitbucket.** It is refused with *Bitbucket marketplaces are not supported
  yet: publish to a GitHub or Azure DevOps marketplace*. A Bitbucket plugin marketplace that you
  install with git keeps working.
- **Folder projects without git on a Bitbucket team repository.** Without git, team branches and
  plugin sources work on GitHub only, so a Bitbucket one says: *git is required for Bitbucket
  repositories here: install git where worca runs (without git, team branches and plugin sources
  work on GitHub only)*.
- **"Outside Worca" pull requests** in team metrics. They come from the GitHub Action's event files;
  Bitbucket repositories show only the pull requests of recorded runs.

### "Create PR" with only a Bitbucket token

The History list does not know a row's remote, so it offers **Create PR** whenever *some* pull
request host is available: `gh` is signed in, or an Azure DevOps or Bitbucket token is set. The
Ship-it dialog then names the forge of the chosen base remote and says what is missing before
anything is pushed. With `gh` and no Bitbucket token, a Bitbucket project's dialog says *Bitbucket is
not configured: set WORCA_BB_TOKEN (an access token, or an Atlassian API token with WORCA_BB_EMAIL)
with Repositories and Pull requests: Read & Write, and Pipelines: Read, where worca runs*.

## Setup

1. Create a token. Either kind works:
   - an **access token** for a repository, project or workspace (**Repository settings → Access
     tokens**, or the same page of the project or workspace). It needs no email.
   - an **Atlassian API token** with Bitbucket scopes (**Atlassian account → Security → API
     tokens**). It needs your Atlassian account email in `WORCA_BB_EMAIL`.

   Grant:

   | Use | Access token | Atlassian API token |
   | --- | --- | --- |
   | push, pull requests, Watch PR replies (`WORCA_BB_TOKEN`, or the write token) | **Repositories: Read & Write**, **Pull requests: Read & Write** | `write:repository:bitbucket`, `write:pullrequest:bitbucket` |
   | clone, fetch, metrics, Watch PR reads (the read token) | **Repositories: Read**, **Pull requests: Read** | `read:repository:bitbucket`, `read:pullrequest:bitbucket` |
   | Watch PR: step logs of a failed pipeline | **Pipelines: Read**, on the read token | `read:pipeline:bitbucket` |

2. Set it where Worca runs, and restart Worca:

   | Variable | Meaning |
   | --- | --- |
   | `WORCA_BB_TOKEN` | one token for clone, fetch, push and pull requests |
   | `WORCA_BB_READ_TOKEN`, `WORCA_BB_WRITE_TOKEN` | a read/write pair; either one switches to split mode. Reads use `READ` (else the single token), writes use `WRITE` (else the single token) |
   | `WORCA_BB_EMAIL` | set: every token is an Atlassian API token (REST sends `email:token`, git logs in as `x-bitbucket-api-token-auth`). Unset: every token is an access token (REST sends it as a bearer token, git logs in as `x-token-auth`) |

   The same rules as GitHub's `GH_TOKEN` / `WORCA_GH_READ_TOKEN` / `WORCA_GH_WRITE_TOKEN`. Git gets
   the token through a credential helper scoped to `https://bitbucket.org`; REST calls send it only to
   `https://api.bitbucket.org`. Container: [docker.md](docker.md#bitbucket). Railway:
   [deploy-railway.md](deploy-railway.md#bitbucket).

Without a token, a call that needs one fails with *no Bitbucket credential: set WORCA_BB_TOKEN where
worca runs*.

**Tokens expire or get revoked.** When one does, pushes and pull requests fail with *Bitbucket
refused the token (expired, revoked, or missing a scope)*, a missing scope answers *Bitbucket 403:*
followed by Bitbucket's own message, a refused clone says *Bitbucket refused the credential: check
WORCA_BB_TOKEN (Repositories: Read) and that it can see this repository*, and the team metrics page
says *Bitbucket refused the token in `WORCA_BB_TOKEN`*. Without any token, team metrics say *Merge
dates for Bitbucket repositories need a token*, and clone works for public repositories only.

## Repository URLs

Every spelling below is the same repository to Worca (`bitbucket.org/acme/api`):

| Remote | Notes |
| --- | --- |
| `https://bitbucket.org/acme/api.git` | the canonical form |
| `https://jdoe@bitbucket.org/acme/api.git` | the Clone button's form; the user name is ignored (the helper's user wins) |
| `git@bitbucket.org:acme/api.git` | ssh |
| `ssh://git@altssh.bitbucket.org:443/acme/api.git` | ssh over port 443 |

Names are compared case-insensitively. Worca's own git calls are https; an ssh remote pushes with
your ssh agent, as for GitHub. **Clone from URL** takes https only (a password in the URL is refused
with a pointer to `WORCA_BB_TOKEN`), and clones from `https://bitbucket.org/<workspace>/<repo>.git`.

**Egress.** With the container's egress allowlist, add `bitbucket.org,api.bitbucket.org` to
`WORCA_EGRESS_ALLOW`. Step logs are served from a storage host that the log request redirects to:
add that host too if Watch PR cannot read logs. Worca follows that redirect without the token.

## Watch PR

Watch PR works the same on a Bitbucket pull request as on GitHub (see [UI levels](ui-levels.md)).
These are the Bitbucket sources it reads:

| GitHub | Bitbucket |
| --- | --- |
| A check run or commit status on the PR head | A **commit status** on the PR head. A Bitbucket Pipelines build is one check named `Bitbucket Pipelines`, with a readable log; only the newest build of a commit counts, so a passing re-run clears a failure. Other statuses are checks by their own name. |
| Required (branch protection) | Nothing is required, so every status counts |
| Re-run the failed jobs once (`gh run rerun --failed`) | Not offered |
| The failed job's log | The failed steps of the pipeline: each step's name and the last 200 lines of its log, then the last 12 KB |
| The base head's checks | The commit statuses of the base branch's tip |
| Behind the base (`compare`) | The commits on the base the PR head lacks (up to 100) |
| Merge conflicts | The PR's file conflicts (`pullrequests/<id>/conflicts`) |
| A review thread | A comment and its replies. In a private repository every commenter counts; in a public one only the PR author's and the listed reviewers' comments do. Every general PR comment from such a commenter counts as a review request, as on Azure DevOps. Comments from app users (integrations such as Snyk or Sonar) never count. |
| A "changes requested" review | A participant's **Request changes**. It fires once per reviewer; a reviewer who asks again is heard through their comments. |
| Reply on the thread | A reply under the comment |

**Poll budget.** The watcher polls each watched pull request every minute, about 5 requests a poll:
about 300 requests an hour per watched PR. Bitbucket allows about 1,000 API requests an hour per token
on standard plans, and a rate limit (429) pauses every watch, on every host, for a minute.

**Token scopes.** Reading the checks, comments and the base head needs *Repositories: Read* and
*Pull requests: Read*. Replies need *Pull requests: Read & Write*. Reading step logs needs *Pipelines:
Read* (API token: `read:pipeline:bitbucket`); without it the logs answer 403 and the fix task names the
failed pipeline and links to it, but has no log.

## Verified against

A private Bitbucket Cloud repository (2026-10-26), with an Atlassian API token: clone, push, Create PR as a draft,
Watch PR on a failed commit status (fix run, push, green re-run), on a review comment (fix run, push, threaded reply)
and on a merge conflict (fix run merges the base, push); Mark ready and Close (declined) through the adapter; the
merged PR on the run page and its team metrics creation and merge dates. Not yet checked against a real repository: a
failed Bitbucket Pipelines step log, "Request changes" from a second account, and the request count over an hour.
