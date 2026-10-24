---
name: resume-point-and-smoke-identity
description: Read before adding a field to the resume point (orchestrator.mjs _buildResumePoint) or to a run's default options; the 8/8 smoke identity proof compares DB rows
paths: src/core/orchestrator.mjs, src/core/run-harness.mjs, tools/smoke-tree.mjs
updated: 2026-10-02T14:32:37.794Z
author: Bulibas
---

`tools/smoke-tree.mjs` normalises every DB row of the smoke's WORCA_HOME (JSON string columns
parsed and key-sorted, volatile columns dropped). `pipelines.resume_point` is one of those rows.
So any field that `_buildResumePoint` writes on EVERY run (for example `claude: { engine: 'claude' }`)
breaks the "default run must not change" proof: base vs head smokes stop being 8/8 identical.

The convention: the point's `claude` blob carries only the fields that are set, and a value that
equals the default (the Claude engine) is not written. `test/orchestrator-resume-model.test.mjs`
pins a Claude run's blob with `deepEqual({ model, effort })` and `claude === undefined` when
nothing was named. Because of this, a missing field must mean the default when the point is read
back, and that covers points written before the field existed too.

Second trap: after the harness constructor, `this.claude.engine` is always set (`selectRunEngine(... || 'claude')`).
To tell "the caller named an engine" from "the default", read `this.opts.claude?.engine`. The CLI
and the UI server pass `engine` only when they were given one.
