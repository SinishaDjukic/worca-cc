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

## Config

| key | type | default | meaning |
|---|---|---|---|
| token | secret text | — | GitHub token; blank falls back to `gh auth token` (see Auth) |
| closeOnComplete | select yes/no | no | close the issue (`state_reason: completed`) when a run finishes successfully |

## Filter micro-syntax

`assignee:@me state:open label:bug label:api` — `@me` resolves to the token's
login (cached after Test connection); unknown tokens are ignored; free text in
the task browser searches titles client-side.

## Publishing

This directory (`plugins/github-source` in the worca-cc repo) is the source of
truth AND the distribution point: the worca-cc repo is itself a plugin
marketplace (see the root `worca-cc-marketplace.json`), registered by default
in every worca-cc install. Users get this plugin from Plugins → Available, or:

    worca plugin install github-source
