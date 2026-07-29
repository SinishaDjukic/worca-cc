# github-source (worca-cc plugin)

Pull tasks from GitHub Issues into worca-cc's New Pipeline, and write results
back as an issue comment (optionally closing the issue).

## Install

    worca plugin add https://github.com/denislavprinov/maestro-plugins
    worca plugin install github-source --repo https://github.com/denislavprinov/maestro-plugins

## Auth

The `token` config field (stored in `~/.worca-cc/plugins/github-source/data/secrets.json`,
mode 0600, never in the DB). Any of:

1. A fine-grained PAT with **Issues: Read and write** + **Metadata: Read-only**
   on the repos you want to pull from (github.com/settings/personal-access-tokens).
2. Environment indirection — set the field value to `{"$env":"GH_TOKEN"}` and
   export `GH_TOKEN`; the token then never touches disk.
3. `gh auth token` prints a ready token if you use the GitHub CLI.

Verify with "Test connection" in the settings UI, or:

    worca plugin exec github-source github validateConfig

## Config

| key | type | default | meaning |
|---|---|---|---|
| token | secret text | — | GitHub token (see Auth) |
| closeOnComplete | select yes/no | no | close the issue (`state_reason: completed`) when a run finishes successfully |

## Filter micro-syntax

`assignee:@me state:open label:bug label:api` — `@me` resolves to the token's
login (cached after Test connection); unknown tokens are ignored; free text in
the task browser searches titles client-side.

## Publishing

This directory (`examples/plugins/github-source` in the worca-cc repo) is the
SOURCE OF TRUTH. Publish by copying it verbatim into the
`denislavprinov/maestro-plugins` repo (as top-level dir `github-source`, so
discovery finds the manifest at depth 1) and committing; users then get it via
`worca plugin add` / `worca plugin update github-source`.
