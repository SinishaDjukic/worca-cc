# github-source (worca-cc plugin)

Pull tasks from GitHub Issues **and PR comment threads** into worca-cc's New
Pipeline, and write results back — as an issue comment (optionally closing the
issue), or as a reply on the review thread (optionally resolving it).

Two task sources ship in this plugin:

| id | displayName | task = |
|---|---|---|
| `github` | GitHub Issues | one issue |
| `github-pr-comments` | GitHub PR comments | one comment thread on a pull request |

## Install

    worca plugin install github-source

## Auth

The `token` config field is **optional** (stored in
`~/.worca-cc/plugins/github-source/data/secrets.json`, mode 0600, never in the
DB) and **shared by both sources** — it is declared in each source's config form,
but there is one stored value. Any of:

1. A fine-grained PAT with **Issues: Read and write** + **Metadata: Read-only**
   on the repos you want to pull from (github.com/settings/personal-access-tokens).
   For the **PR comments source** add **Pull requests: Read and write** — replying
   on a thread and resolving it are writes; without the scope the run still
   completes but the write-back logs a `GitHub API 403` warning.
2. Environment indirection — set the field value to `{"$env":"GH_TOKEN"}` and
   export `GH_TOKEN` in the worca server's environment; the token never touches disk.
3. Leave it blank. The connector then runs `gh auth token` and uses whatever
   account the GitHub CLI is logged in as — the same identity worca uses for
   `gh pr create`. It works under the connector's scrubbed env because `PATH`
   finds the binary and `HOME` finds `~/.config/gh` (and the OS keyring).

Blank is the least setup and the **most** privilege: a `gh auth login` token
typically carries `repo`, `workflow`, `read:org` and `gist` across every repo
your account can reach, where option 1 grants Issues on named repos only. Prefer
a PAT wherever the extra scope matters. Blank also means one identity for all
profiles — two profiles pointed at different accounts each need their own token.

If the CLI is missing or logged out, ops fail with an `auth` error naming `gh`'s
own stderr; nothing silently falls through to an anonymous request.

Verify with "Test connection" in the settings UI, or:

    worca plugin exec github-source github validateConfig
    worca plugin exec github-source github-pr-comments validateConfig

## Config

| key | source | type | default | meaning |
|---|---|---|---|---|
| token | both (one shared value) | secret text | — | GitHub token; blank falls back to `gh auth token` (see Auth) |
| closeOnComplete | `github` | select yes/no | no | close the issue (`state_reason: completed`) when a run finishes successfully |
| resolveOnComplete | `github-pr-comments` | select yes/no | no | resolve the review thread (GraphQL `resolveReviewThread`) after replying, when a run finishes successfully. Only diff-anchored review threads can be resolved |

The Plugins view shows one config form per source; saving either form keeps the
other's values (the store merges per key).

## Issues source — filter micro-syntax

`assignee:@me state:open label:bug label:api` — `@me` resolves to the token's
login (cached after Test connection); unknown tokens are ignored; free text in
the task browser searches titles client-side.

## PR comments source

Pick a repository, narrow the pull requests with the **PR filter**, then choose
one **comment thread** in the task browser. Threads from **every matching PR**
are listed together, newest first, each row labelled with its PR number
(`PR #42`), its kind, and — for review threads — `unresolved`/`resolved`,
`outdated`, and `draft` when the PR is a draft.

### Filter micro-syntax

Default: `state:open review-requested:@me` (PRs where your review is requested,
unresolved threads not written by you).

| token | narrows | values |
|---|---|---|
| `state:` | PRs | `open` (default) · `closed` · `all` |
| `review-requested:` | PRs | `@me` or a login |
| `pr-author:` | PRs | `@me` or a login (the PR's author) |
| `pr:` | PRs | a PR number — lists that single PR's threads (skips the search) |
| `label:` | PRs | a label; repeatable |
| `resolved:` | threads | `unresolved` (default) · `all` |
| `author:` | threads | `not-me` (default) · `any` · a login — the thread's **root** comment author |

Unknown tokens are ignored. Free text in the task browser searches thread
titles and comment bodies client-side. The search is capped at **20 PRs** (the
first 20 by GitHub's ranking); when more match, the op logs a warning naming the
count — narrow the filter (e.g. `pr:<n>`).

### Thread kinds

| kind | label | what it is | write-back |
|---|---|---|---|
| review thread | `review-thread` | a diff-anchored comment + its replies (file, line, side, `diff_hunk`) | reply on the thread; with `resolveOnComplete: yes` the thread is resolved after a successful run |
| review | `review` | a review summary body (`CHANGES_REQUESTED` / `COMMENTED` / `APPROVED` with text). Empty bodies and pending reviews are skipped | a PR conversation comment quoting + linking the review |
| comment | `comment` | a PR conversation (issue) comment | a PR conversation comment quoting + linking the original |

Only review threads have a resolution state; `resolved:unresolved` never hides
reviews or conversation comments.

### Task text

The pipeline prompt is the thread: the PR (`owner/repo#42 — title`, head →
base, draft flag), the file and line(s) with the side, the `diff_hunk`, and
every comment with its author and timestamp. Task ids are opaque
(`owner/repo#42:thread:<node id>`, `…:review:<id>`, `…:comment:<id>`).

### Branch behaviour — the run works ON the PR branch

For a PR whose head lives in the same repository, the source returns a
`checkout` hint and the run **attaches to the PR head branch** instead of
forking a `worca-cc/…` branch off your current branch:

- The run fetches `origin/<head>` **non-interactively** — a git credential for
  `origin` must already be cached/configured (keychain helper, SSH agent); with
  none, the run fails within seconds instead of hanging on a prompt.
- A missing local branch is created at the remote tip; a local branch that is
  **behind** origin is fast-forwarded first.
- Commits land **on the PR head branch**, in a disposable worktree. **Nothing is
  pushed**: commits accumulate locally across runs on the same PR and are kept —
  a later run on another thread of the same PR works on top of them (the run
  log says "N local commit(s) not on origin"). The run's diff and review cover
  only what *that* run changed (the checkpoint is the branch tip at start).
- `state.branch` records `{ source: <PR base>, feature: <PR head>, attached: true }`.
  **Create PR** pushes the branch (every local run's commits) and, because the
  PR already exists, returns its URL. Deleting the pipeline never deletes an
  attached branch — only its checkout.
- An explicit feature branch typed in New Pipeline **wins** over the hint (the
  run then forks as usual); the branch-select's default source branch does not.

The run **fails loudly** (no silent fallback to the default branch) when:

- the PR head branch is **checked out in your working tree** (or held by
  another pipeline's worktree): "Cannot work on `x`: it is checked out in
  `<path>`" — switch your checkout to another branch and retry, finish/delete
  the other pipeline, or type a feature branch to fork instead of attaching;
- the local branch has **truly diverged** from origin (both sides have commits
  the other lacks, e.g. after a force-push upstream): push or rebase it first;
  `git branch -f <head> origin/<head>` only if you want to **discard** the local
  commits;
- the branch no longer exists on origin, there is no `origin` remote, or no
  usable credential.

PRs from a **fork** get no hint: the task text says so and the run branches off
the project's default branch as any other task. Workspace (multi-project) runs
ignore the hint with a warning.

A run that fails before it starts (e.g. any of the setup errors above) still
posts a reply on the thread saying the run ended in `error` — the same behaviour
as the Issues source. It never resolves the thread.

## Publishing

This directory (`plugins/github-source` in the worca-cc repo) is the source of
truth AND the distribution point: the worca-cc repo is itself a plugin
marketplace (see the root `worca-cc-marketplace.json`), registered by default
in every worca-cc install. Users get this plugin from Plugins → Available, or:

    worca plugin install github-source
