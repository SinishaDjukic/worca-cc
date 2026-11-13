# Gitea and Forgejo

Worca works with Git repositories on your own **Gitea** or **Forgejo** instances next to GitHub,
Azure DevOps, Bitbucket and [Codeberg](codeberg.md). Gitea is a self-hosted code host; Forgejo is
its community fork with the same API for everything Worca uses. There is no fixed host name, so you
name your instances, and each one gets its own token. Each git call and each REST request gets the
credential for its own host, one call at a time; agents never get it, in any guardrail set.

## What works

- **Create PR.** A finished run's **Create PR** pushes the branch and opens the pull request over the
  instance's REST API (v1). **Open as draft** opens it with the `WIP:` title prefix, which is how
  these hosts mark a draft. When the branch already has an open pull request, Worca reuses it. The
  base-branch checks run first, as on GitHub. A run that came from a GitHub issue adds no `Closes`
  line here.
- **Clone.** **Add project → Clone from URL** takes a repository URL on a listed host.
- **Fetch and sync**, including the `worca-metrics` and `worca-policy` branches on an `origin` on a
  listed host, when git is installed where Worca runs.
- **Team metrics merge dates.** Runs whose branch became a pull request get its creation and merge
  dates, so Shipped, In review and lead time work. The metrics page reports each host on its own.
- **Watch PR**, Resolve and the pull request row on the run page and the Overview tab, as on GitHub
  ([below](#watch-pr)).

## What does not work (yet)

- **Hosts that are not listed.** A remote on a host missing from `WORCA_GITEA_HOSTS` and
  `WORCA_FORGEJO_HOSTS` is plain git to Worca: push and fetch use the machine's own credentials,
  and there is no Create PR for it. Worca cannot tell a Gitea instance from any other host without
  being told.
- **A web or API port other than 443.** The instance has to answer on `https://<host>/`. An ssh
  remote on any port is fine.
- **Forks.** A pull request between two repositories is refused before anything is pushed:
  *Gitea pull requests between repositories (forks) are not supported yet — push to origin.* Push
  to the base repository instead.
- **"Push as me."** It is GitHub-only; a push uses the deployment's token for that host.
- **Approving or requesting changes** from Worca on its own pull request. Gitea and Forgejo refuse
  that for the author, so Watch PR replies as comments only.
- **Re-running a failed Actions job** from Worca. Watch PR reads the failed job's log, but never
  asks for a re-run.
- **"Ready to merge" and "Review required"** on the pull request row. Branch protection is not
  readable without admin rights, so the row shows checks, conflicts and *Changes requested* only.
- **Chat chips** for pull request links on these hosts.
- **An issues task source.** Use a plugin that speaks the instance's API, if you have one.
- **Marketplace publish.** It is refused with *Gitea marketplaces are not supported yet: publish to
  a GitHub or Azure DevOps marketplace*. A plugin marketplace on a listed host that you install with
  git keeps working.
- **Folder projects without git** on a team repository hosted there. Without git, team branches
  and plugin sources work on GitHub only, so such a project says: *git is required for Gitea
  repositories here: install git where worca runs*.
- **"Outside Worca" pull requests** in team metrics. They come from the GitHub Action's event
  files; these hosts show only the pull requests of recorded runs.

## Setup

1. **List your instances.** Host names only, comma-separated, no scheme, port or path. A host goes
   in the list of the software it runs:

   | Variable | Meaning |
   | --- | --- |
   | `WORCA_GITEA_HOSTS` | your Gitea instances, for example `git.example.org,gitea.lan` |
   | `WORCA_FORGEJO_HOSTS` | your Forgejo instances |

   The two lists differ in how Worca reads Actions runs and replies on review threads. A Forgejo
   host put in the Gitea list still opens pull requests, but Watch PR reads its builds wrongly.

2. **Create a token per instance.** On the instance: your avatar → **Settings → Applications →
   Manage Access Tokens**. Grant **repository: Read and Write** (reads only need **Read**). A token
   is bound to the account that created it, so pushes and pull requests appear under that account.

3. **Set each token where Worca runs**, named after its host, and restart Worca. The host becomes a
   suffix: uppercase, every character that is not a letter or digit becomes `_`.

   | Variable | Meaning |
   | --- | --- |
   | `WORCA_GITEA_TOKEN_<HOST>` | one token for clone, fetch, push and pull requests on that host |
   | `WORCA_GITEA_READ_TOKEN_<HOST>`, `WORCA_GITEA_WRITE_TOKEN_<HOST>` | a read/write pair; either one switches that host to split mode. Reads use `READ` (else the single token), writes use `WRITE` (else the single token) |
   | `WORCA_FORGEJO_TOKEN_<HOST>` and its `READ_` / `WRITE_` pair | the same for a Forgejo host |

   For example:

   ```
   WORCA_GITEA_HOSTS=git.example.org,gitea.lan
   WORCA_GITEA_TOKEN_GIT_EXAMPLE_ORG=…
   WORCA_GITEA_READ_TOKEN_GITEA_LAN=…
   WORCA_GITEA_WRITE_TOKEN_GITEA_LAN=…
   WORCA_FORGEJO_HOSTS=forge.example.org
   WORCA_FORGEJO_TOKEN_FORGE_EXAMPLE_ORG=…
   ```

   There is no token that applies to every host. A plain `WORCA_GITEA_TOKEN`, or a token whose
   suffix matches no listed host, is logged at start-up by name and ignored. Git gets a token through
   a credential helper scoped to `https://<host>`; REST calls send it only to `https://<host>/api/v1`.
   Container: [docker.md](docker.md#gitea-and-forgejo).

A listed host without a token is **not configured**: the Ship-it dialog says *Gitea host
git.example.org has no token: set WORCA_GITEA_TOKEN_GIT_EXAMPLE_ORG where worca runs*, team
metrics say *Merge dates for Gitea repositories on git.example.org need a token*, and clone works
for public repositories only.

**Tokens expire or get revoked.** When one does, pushes and pull requests fail with *Gitea
git.example.org refused the token (expired, revoked, or missing a scope)*, a missing scope answers
*Gitea 403:* followed by the instance's own message, a refused clone says *Gitea refused the
credential: check WORCA_GITEA_TOKEN_GIT_EXAMPLE_ORG and that it can see this repository*, and the
team metrics page names the host and the variable.

## Repository URLs

Every spelling below is the same repository to Worca (`git.example.org/acme/api`):

| Remote | Notes |
| --- | --- |
| `https://git.example.org/acme/api.git` | the canonical form |
| `git@git.example.org:acme/api.git` | ssh |
| `ssh://git@git.example.org:2222/acme/api.git` | ssh on another port; the port is not part of the identity |

Names are compared case-insensitively. Worca's own git calls are https; an ssh remote pushes with
your ssh agent, as for GitHub. **Clone from URL** takes https only and clones from
`https://<host>/<owner>/<repo>.git`.

**Egress.** With the container's egress allowlist, add every listed host to `WORCA_EGRESS_ALLOW`.

## Watch PR

Watch PR works the same on these hosts as on GitHub (see [UI levels](ui-levels.md)). These are
the sources it reads:

| GitHub | Gitea / Forgejo |
| --- | --- |
| A check run or commit status on the PR head | A **commit status** on the PR head. Each Actions job is one, named `<workflow> / <job> (<event>)`, with a readable log; the newest status per name counts. Other statuses are checks by their own name. |
| Required (branch protection) | Nothing is required, so every status counts |
| Re-run the failed jobs once | Not offered |
| The failed job's log | The failed jobs of the run: each job's name, its failed step, and the last 200 lines of its log, then the last 12 KB |
| The base head's checks | The commit statuses of the base branch's tip |
| Behind the base (`compare`) | The commits on the base the PR head lacks |
| Merge conflicts | The pull request's own merge verdict, which the host computes after each push |
| A review thread | An inline review comment and the comments on the same file and line. In a private repository every commenter counts; in a public one only the PR author's and the requested reviewers' do. A general PR comment from such a commenter counts as a review request, as on Azure DevOps. |
| A "changes requested" review | A review with **Request changes** that is not dismissed, one per reviewer |
| Reply on the thread | Gitea: a new review with one comment on the same file and line. Forgejo: a comment added to the reviewer's review. |

**Poll budget.** The watcher polls each watched pull request every minute, about 5 requests a poll.
Gitea and Forgejo have no API rate limit by default; a 429 from a reverse proxy pauses every watch,
on every host, for a minute.
