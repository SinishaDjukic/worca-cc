---
name: suite-reds-run-scratch-tmpdir
description: Seven full-suite reds (workflow-test copies, Shaper classic golden) that are red at the checkpoint too on the Mac run host; read before blaming a diff for them.
updated: 2026-11-27T06:59:14.319Z
author: Denislav Prinov
---

On this Mac, inside a worca run (TMPDIR = `~/.worca-cc/runs/<id>/.scratch`), `npm test` ends with 7 reds that are
red at checkpoint `3f129600b` too (proved 2026-11-27: same 7, alone, on a `git archive <checkpoint>` copy with the
worktree's `node_modules` linked):

- `api-workflow-test-project-try` :268, `api-workflow-test-round2` :55 and :122, `workflow-test-project-copy` :187,
  `workflow-test-project-key` :71. The suite runner moves its tmp to `/tmp/worca-cc-test-tmp-*` when TMPDIR is under a
  `.worca-cc` folder, and these tests compare `/tmp/...` with the realpath `/private/tmp/...`.
- `shape-classic-walk-golden` :186 and :197 (the asked keys are off by one: `1-8` against `1-7`).

`tools-test-runner` :293 "suiteTmpOutsideWorca" also fails alone in a run worktree (it touches no product file).

Attribute any OTHER red the usual way ([[test-suite-known-failures]]): the same file alone, then on a checkpoint copy.
