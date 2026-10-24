---
name: cli-add-positional-is-name-not-path
description: worca add <path> registers the project under the wrong path — the positional arg is NAME, not PATH. Use --path.
paths: src/cli/worca-cc.mjs
updated: 2026-10-02T17:50:33.303Z
author: Bulibas
---

`worca add <arg>` (src/cli/worca-cc.mjs, `parseAddArgs`/`cmdAdd`) treats a bare positional
argument as the project's **name**, not its path. With no `--path` flag, `target` falls back to
`resolve(process.cwd())` — the directory you ran the CLI from — and `name` becomes whatever
string you passed positionally (even a full path string, verbatim, since a truthy `rawName`
skips the `basename(target)` fallback).

Symptom: `worca add /tmp/some/sandbox/dir` from inside this worktree silently registers THIS
worktree's own path under the name `"/tmp/some/sandbox/dir"` — `worca list` then shows a project
whose "name" column is a path and whose "path" column is wherever your shell happened to be.
No error, no warning.

Fix: always pass `--path <dir>` explicitly: `worca add --path /tmp/some/sandbox/dir`. Add
`--name <short>` too if you don't want the path's basename as the display name (plain `--name`
without `--clone` is otherwise rejected: `--branch and --name go with --clone`).

Relevant when registering a throwaway sandbox project for a manual browser/API check (plan Step
6.4-style proofs): verify with `worca list` or `GET /api/projects` that `path` is actually the
sandbox dir before driving any run against it — otherwise the run targets your own repo
worktree.
