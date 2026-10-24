---
name: scratch-home-git-identity
description: Read before running worca tests (or npm test) with a scratch HOME — git commits in ~20 test files then fail
paths: test/**
updated: 2026-10-03T13:12:26.788Z
author: Bulibas
---

Running tests with `HOME="$(mktemp -d)"` (to protect the real `~/.worca-cc/settings.json`) breaks every test that
runs `git commit` without `-c user.name/-c user.email` — about 20 files (`ask-api-memory-mount`, `ask-turn`,
`ask-prompt`, `ask-store`, `db`, …). git fails with `fatal: unable to auto-detect email address (got '<user>@Mac.(none)')`.
In a base-vs-head suite comparison they fail on both sides, read as "pre-existing", and hide real regressions.

Fix: keep git pointed at the real global config while HOME moves. It must come before `HOME=` in the prefix:

```bash
GIT_CONFIG_GLOBAL="$HOME/.gitconfig" HOME="$(mktemp -d)" npm test
```

Verified on git 2.50.1 (macOS). Tests that swap `process.env.HOME` in-process inherit the env var too, so their child
`git` calls work as well.
