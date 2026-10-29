# Contributing to Worca

Thanks for your interest in contributing! This document covers developing Worca
from source: setup, testing, the PR workflow, and how releases are cut.

Everyone taking part in this project is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). Report unacceptable behavior to
[conduct@worca.dev](mailto:conduct@worca.dev).

> Just want to **use** Worca? You don't need this repo at all — install it from
> npm as described in the [install guide](docs/install.md).

## The two branch lines

This repository hosts two product lines that **never converge**:

| Branch | Line | Stack | Packages |
| --- | --- | --- | --- |
| `dev` (default) | Worca 1.x | Pure Node.js | [`@worca/app`](https://www.npmjs.com/package/@worca/app) |
| `master` | worca-cc 0.x | Python + Node dashboard | `worca-cc` (PyPI), `@worca/ui` (npm) |

**All new contributions target `dev`.** Nothing is ported between the lines —
don't cherry-pick commits, skills, or docs across them.

## Development setup

Requirements:

- **Node.js >= 22.13.0** — required by the built-in `node:sqlite` store. Run
  `nvm use` to pick up the bundled `.nvmrc`.
- The **`claude` CLI** on your `PATH` — only for real (non-mock) pipeline runs.
  Everything else, including the full test suite, works without it.

```bash
git clone https://github.com/SinishaDjukic/worca-cc.git
cd worca-cc          # the default branch is dev
npm install
```

There is **no build step**: the backend is plain Node ESM (`.mjs`), the
frontend is vanilla HTML/CSS/JS served from `ui/public/`. Runtime dependencies
are `express` + `ws` only.

Run from source:

```bash
npm start                                 # web UI (default http://localhost:4317)
npm run cli -- ui stop                    # stop it (also: status | restart | --port <n>)
npm run cli -- --project <dir> --prompt "<task>"   # CLI pipeline run
```

Development state stays out of your real Worca home: set `WORCA_HOME` to point
the SQLite database and artifact store at a throwaway directory (the test and
smoke scripts already do this — `.worca-cc-test` / `.worca-cc-smoke`).

### Trying a change a Worca run made

When you use Worca to work on Worca, don't start the UI from a run's own
checkout (`~/.worca-cc/runs/<id>/…` or `<project>/.worca-cc/worktrees/<id>`).
Worca deletes those folders when the run is discarded or archived, and the
server would lose its own code, so `npm start` refuses to start there. Running
the tests in that folder is fine.

To try the run's branch `X` in a UI, give it a folder of its own. The run's
checkout still holds `X`, so take its commit detached:

```bash
git worktree add --detach ../try-X X
cd ../try-X && npm install
HOME=/tmp/worca-try WORCA_HOME=/tmp/worca-try PORT=4400 npm start
```

Use a separate `HOME` as well as `WORCA_HOME`: settings live under
`$HOME/.worca-cc`, and a second server on your real home shares the live UI's
database and runs its startup sweeps against your real runs. To commit fixes on
`X` itself, discard the run's checkout first, then `git worktree add ../try-X X`.

## Mock mode

The whole pipeline runs **fully offline** — no `claude` spawn, no tokens — with
a deterministic mock that still produces real artifact files:

```bash
npm run smoke              # single mock pipeline into .worca-cc-smoke
npm run smoke:workspace    # mock workspace (multi-project) run
npm run smoke:plugin       # mock plugin-sourced run
```

Set `WORCA_MOCK=1` (or pass `--mock`) on any run to use the mock path. Use it
for UI work, engine work, and reproducing bugs cheaply.

## Testing

```bash
npm test
```

This runs the full `node:test` suite (`test/*.mjs`) against an isolated
`WORCA_HOME`. No network, no Claude, no API keys needed.

CI runs on every pull request and every push to `dev`: the fast tier always,
the slow tier when the change touches what it exercises (`test/tiers.json`;
`npm run test:fast` and `npm run test:slow` run one tier locally). It skips
docs-only changes, and it does not run the smoke scripts. Run `npm test` (and
the relevant smoke script if you touched the engine, workspace, or plugin
paths) locally before opening or updating a PR, and say so in the PR
description.

While you work, `npm run test:related` runs only the test files your
uncommitted changes can affect (`-- --base origin/dev` for everything on your
branch). It follows imports and the paths tests load by name, and falls back to
the full suite when you change the runner, its config or `package.json`. It
can't see every link, so run the full `npm test` once before you hand the
change over.

### In a container

The container image ([`docs/docker.md`](docs/docker.md)) is built from the
`npm pack` tarball, so it is a test of the *package*, not the source tree:

```bash
npm run docker:build        # packs this checkout, builds ghcr.io/sinishadjukic/worca:dev
npm run docker:smoke        # offline: CLI mock run, UI health + Host guard, SIGTERM, volume
```

Touch `docker/**`, `package.json` `files`, or anything the CLI needs at runtime,
and run both. To hack on Worca *inside* the box (a Linux `claude`, your edits
live):

```bash
cd docker
docker compose -f compose.yml -f compose.dev.yml up               # server from this checkout
docker compose -f compose.yml -f compose.dev.yml run --rm worca npm test
```

The Claude Code version baked into the image is pinned in
`docker/CLAUDE_CODE_VERSION`; bump it by PR.

## Project structure

```
src/core/        engine: protocol, store (SQLite), artifacts, preflight,
                 claude-runner, phases, orchestrator
src/cli/         worca-cc.mjs — the `worca` bin
ui/              server.mjs (express + ws) + public/ (vanilla single-page UI)
agents/          data-driven agent set: prompt (worca-cc-<role>.md)
                 + metadata sidecar (<key>.meta.json) per agent
skills/          worca/SKILL.md — the installable /worca skill
scripts/         built-in script cards: <key>.meta.json + the program it names (see agents/)
tools/           install.mjs (copy agents + skill into a project), smoke runners, CDP verifiers
test/            node:test suite
docs/            RELEASING.md and other docs
```

Note: `agents/` (the shipped, data-driven agent set) is **not** the same thing
as `.claude/agents/` (Claude Code agents used to develop this repo). Changes to
pipeline agent behavior belong in `agents/`.

## UI levels

The web UI has an interface mode — **Simple**, **Advanced**, **Expert** — that
decides how much is on screen. Anything you add to `ui/public/` that a user can
see needs a level. [`docs/ui-levels.md`](docs/ui-levels.md) has the questions
that decide it, the few rules the mode never breaks (a blocking prompt is never
hidden; a non-default value stays visible; the mode is a view preference, not a
permission), how to tag an element, and the catalogue to update.
`test/ui-levels.test.mjs` fails on a nav item, Settings tab or card, or detail
tab with no level.

## Feature flags

New experimental UI ships behind a flag, off by default: one entry in
`src/shared/flags/registry.mjs`, then `data-flag="key"` in markup or `flagOn('key')` in code, and
`requireFlag('key')` on its routes. Every flag has an owner and a review date at most 90 days out;
CI fails when a flag is past it or when code names a flag the registry does not have. How to add,
graduate and remove one: [`docs/feature-flags.md`](docs/feature-flags.md).

## Pull request workflow

- Branch from `dev`, open the PR with **base `dev`**.
- PRs are integrated with **merge commits** (no squash, no rebase-merge).
- Once a PR is under review, **never rebase or force-push it** — reviewers'
  context must stay valid. To pick up newer `dev`, **merge `dev` into your
  branch** instead.
- Stacked PRs are fine: base the child PR on the parent's branch
  (`--base feat/<parent>`) and retarget it to `dev` after the parent merges.
- Run the tests locally first (see [Testing](#testing)); CI runs too, but it
  may skip the slow tier and never runs the smoke scripts.
- A PR that adds UI names the level of each new element and updates the
  catalogue in [`docs/ui-levels.md`](docs/ui-levels.md).

## Releasing

Releases are **tag-driven**: pushing an annotated `worca-app-v<version>` tag
(created by `npm version`) triggers the GitHub Actions workflow that tests and
publishes `@worca/app` to npm with provenance. Nobody runs `npm publish` by
hand for an established package.

See [`docs/RELEASING.md`](docs/RELEASING.md) for the full process, including
release candidates (`-rc.N`), dist-tags, and the one-time setup for new
package names.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
