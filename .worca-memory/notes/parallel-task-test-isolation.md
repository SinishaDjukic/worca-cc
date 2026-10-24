---
name: parallel-task-test-isolation
description: Read when writing scoped verify commands for parallel implementer tasks that share one worktree
paths: tools/test.mjs, test/tiers.json
updated: 2026-10-16T12:09:27.739Z
author: Bulibas
---

`npm test` is `node tools/test.mjs` (checked 2026-10-16 at 73f99f0b). With a FILE LIST
(`npm test -- test/a.test.mjs test/b.test.mjs`) it is already isolated: its own WORCA_HOME
(`<tmp>/worca-cc-test-run-*/worca-home`), a fresh temp HOME/USERPROFILE (settings.json resolves under
HOME), the no-real-claude PATH shim, and WORCA_HOST_PID / CLAUDE_CONFIG_DIR / WORCA_FLAGS removed. It never
touches `.worca-cc-test`, and the shard env is ignored. So the scoped verify command of a parallel task is
just `npm test -- <files>`; no hand-made WORCA_HOME is needed.

Only a FULL run (`npm test` with no file list, `test:fast`, `test:slow`) uses `.worca-cc-test` and
`rm -rf`s it first. Two full runs in one worktree still wipe each other's home, so never start two at once.

A raw `node --test <files>` gets none of this. Give it its own WORCA_HOME and HOME:

```bash
W=$(mktemp -d) H=$(mktemp -d) && PATH="$PWD/test/helpers/no-real-claude:$PATH" WORCA_HOME="$W" HOME="$H" \
  node --disable-warning=ExperimentalWarning --test --test-timeout=300000 <files>; rm -rf "$W" "$H"
```

A baseline full `npm test` started in the background must finish before any parallel phase edits
files, or it reads half-edited sources.
