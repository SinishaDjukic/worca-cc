# Contributing to Worca

Thanks for your interest in contributing! This document covers developing Worca
from source: setup, testing, the PR workflow, and how releases are cut.

> Just want to **use** Worca? You don't need this repo at all — install it from
> npm as described in the [README](README.md#install).

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
npm run cli -- --project <dir> --prompt "<task>"   # CLI pipeline run
```

Development state stays out of your real Worca home: set `WORCA_HOME` to point
the SQLite database and artifact store at a throwaway directory (the test and
smoke scripts already do this — `.worca-cc-test` / `.worca-cc-smoke`).

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

**There is no CI on pull requests** — run `npm test` (and the relevant smoke
script if you touched the engine, workspace, or plugin paths) locally before
opening or updating a PR, and say so in the PR description.

## Project structure

```
src/core/        engine: protocol, store (SQLite), artifacts, preflight,
                 claude-runner, phases, orchestrator
src/cli/         worca-cc.mjs — the `worca` bin
ui/              server.mjs (express + ws) + public/ (vanilla single-page UI)
agents/          data-driven agent set: prompt (worca-cc-<role>.md)
                 + metadata sidecar (<key>.meta.json) per agent
skills/          worca/SKILL.md — the installable /worca skill
scripts/         install.mjs (copy agents + skill into a project), smoke runners
test/            node:test suite
docs/            RELEASING.md and other docs
```

Note: `agents/` (the shipped, data-driven agent set) is **not** the same thing
as `.claude/agents/` (Claude Code agents used to develop this repo). Changes to
pipeline agent behavior belong in `agents/`.

## Pull request workflow

- Branch from `dev`, open the PR with **base `dev`**.
- PRs are integrated with **merge commits** (no squash, no rebase-merge).
- Once a PR is under review, **never rebase or force-push it** — reviewers'
  context must stay valid. To pick up newer `dev`, **merge `dev` into your
  branch** instead.
- Stacked PRs are fine: base the child PR on the parent's branch
  (`--base feat/<parent>`) and retarget it to `dev` after the parent merges.
- Run the tests locally first (see [Testing](#testing)) — there is no CI
  safety net on PRs.

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
