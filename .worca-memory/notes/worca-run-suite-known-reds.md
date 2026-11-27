---
name: worca-run-suite-known-reds
description: Test rows that are red inside a Worca run on macOS at checkpoint 124232963, before any change; read before attributing a red full suite
updated: 2026-11-27T06:59:19.255Z
author: Denislav Prinov
---

Inside a Worca run, TMPDIR is the run's scratch folder under `~/.worca-cc/runs/<id>/`, so `tools/test.mjs`
(`suiteTmpOutsideWorca`) moves the suite's temp files to `/tmp/worca-cc-test-tmp-<pid>-*`. On macOS `/tmp` is a symlink
to `/private/tmp`, and 7 rows that compare a path with its realpath go red, scoped (`node tools/test.mjs <file>`) and in
the full suite alike (`'/private/tmp/…' !== '/tmp/…'`, or an `existsSync` of the unresolved spelling is false):

- `api-workflow-test-project-try.test.mjs:268` run-root mode legacy
- `api-workflow-test-round2.test.mjs:55` rowToState, `:122` the other places that turn a row into a folder
- `shape-classic-walk-golden.test.mjs:186` classic flow flag off, `:197` flag on no marker (409 `HEAD_MISSING_WORK`)
- `workflow-test-project-copy.test.mjs:187` an enclosing repository is never written
- `workflow-test-project-key.test.mjs:71` a git run in the copy

Full suite only (green when the file runs alone): `egress-policy.test.mjs:204` "child env: proxy variables only while
enforcing" (`'on' !== 'off'`) and `:254` "notice: an invalid mode and a replaced proxy" (the notice says "forwarded
to the corporate proxy", no "replaced").

Seen 2026-11-26 on a checkpoint clone and on the Design-start tree alike: exactly these 9 names red, 28,961-28,964 tests,
~1300 s per run (a checkpoint run also had `suiteTmpOutsideWorca` red once, not again). Attribute by NAMES against a
`git clone` at the checkpoint (a `git archive` copy has no `.git` and reds more). Do not "fix" these in an unrelated
change.
