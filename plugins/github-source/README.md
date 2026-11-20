# github-source (worca-cc plugin)

Pull tasks from GitHub Issues into worca-cc's New Pipeline, and write results
back as an issue comment (optionally closing the issue).

## Install

    worca plugin install github-source

## Auth

The `token` config field is **optional** (stored in
`~/.worca-cc/plugins/github-source/data/secrets.json`, mode 0600, never in the
DB). Any of:

1. A fine-grained PAT with **Issues: Read and write** + **Metadata: Read-only**
   on the repos you want to pull from (github.com/settings/personal-access-tokens).
2. Environment indirection — set the field value to `{"$env":"GH_TOKEN"}` and
   export `GH_TOKEN` in the worca server's environment; the token never touches disk.
3. Leave it blank. The connector then runs `gh auth token` and uses whatever
   account the GitHub CLI is logged in as — the same identity the `gh` CLI
   uses on this machine. It works under the connector's scrubbed env because
   `PATH` finds the binary and `HOME` finds `~/.config/gh` (and the OS keyring).

Blank is the least setup and the **most** privilege: a `gh auth login` token
typically carries `repo`, `workflow`, `read:org` and `gist` across every repo
your account can reach, where option 1 grants Issues on named repos only. Prefer
a PAT wherever the extra scope matters. Blank also means one identity for all
profiles — two profiles pointed at different accounts each need their own token.

If the CLI is missing or logged out, ops fail with an `auth` error naming `gh`'s
own stderr; nothing silently falls through to an anonymous request.

Verify with "Test connection" in the settings UI, or:

    worca plugin exec github-source github validateConfig

## Config

| key | type | default | meaning |
|---|---|---|---|
| token | secret text | — | GitHub token; blank falls back to `gh auth token` (see Auth) |
| closeOnComplete | select yes/no | no | the old setting: once **Ticket updates** is saved (Labs flag `ticketUpdates`), Worca no longer uses it. Until then: close the issue (`state_reason: completed`) when a run finishes successfully |

## Ticket updates

With the Labs flag **Ticket updates** on, Worca decides what a finished run does to its issue (Marketplace › Installed ›
GitHub Issues › Settings › **Ticket updates**). A repository is a project (`owner/repo`): **Projects you work on** picks
repositories, and New run's **Repository** list shows only those. The plugin answers `capabilities()` with
`ticketUpdates: true` and:

- **listProjects** — the Repository input's list (the 100 repositories updated last), each with its name for the chips.
  `listRepos`, its old name, still answers.
- **listStatuses** — the same three for every repository: Open (to do), Closed (done) and Closed as not planned
  (cancelled). An issue closed as a duplicate counts as cancelled. Projects (v2) status fields are not used.
- **legacyMove** — what **Close issue on completion** means (Yes: Any Done status), so the section starts from it.
- **reportResult with a move** — the issue changes first, then one comment: the run summary, its links, and a last line
  saying what happened. **Any Done status** closes an open issue as completed; a closed issue stays as it is (one closed as
  not planned is never turned into completed). A rule may also pick Closed as not planned, or Open to reopen. Last lines:
  - `Moved to Closed.` / `Moved to Closed as not planned.` / `Moved to Open.` / `Already in Closed as not planned.`
  - `Not moved: GitHub refused the move to Closed: <GitHub's message>.` — a 4xx other than 401, 429 and a rate limit;
    `GitHub gave no reason` when GitHub sends no message.

  In every case above the comment is still posted. A refused token, a rate limit, a server error (5xx), a network error or a
  timeout fails the write-back, so it can be tried again.

Until Ticket updates is saved, write-back works as before: a comment, and with `closeOnComplete: yes` the issue is closed.

## Filter micro-syntax

`assignee:@me state:open label:bug label:api` — `@me` resolves to the token's
login (cached after Test connection); unknown tokens are ignored; free text in
the task browser searches titles client-side.

Pasting an issue reference into the search box skips the Filter and fetches
that one issue, whatever its state or assignee: a full URL
(`https://github.com/owner/repo/issues/123`), `owner/repo#123`, or `#123` /
`123` against the selected repo. A pull request or a missing issue shows no
results.

## Publishing

This directory (`plugins/github-source` in the worca-cc repo) is the source of
truth AND the distribution point: the worca-cc repo is itself a plugin
marketplace (see the root `worca-cc-marketplace.json`), registered by default
in every worca-cc install. Users get this plugin from Marketplace → Browse, or:

    worca plugin install github-source
