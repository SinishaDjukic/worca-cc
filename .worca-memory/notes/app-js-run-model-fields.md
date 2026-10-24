---
name: app-js-run-model-fields
description: A new field on the client run model must be added to makeRun's parameter list, or a hello frame drops it for a new run.
paths: ui/public/app.js
updated: 2026-09-30T22:26:40.705Z
author: Bulibas
---

In `ui/public/app.js`, `upsertRun(partial)` builds a run it has not seen yet with `makeRun(partial)`.
`makeRun` destructures a FIXED parameter list and returns a fixed object, so any key it does not name is silently
dropped. Only an EXISTING run gets every defined key of the partial copied over.

Trap: the hello handler passes a field (e.g. `night: r0.night`) and it reads as wired, but on the first hello of a
run the field is lost until the next `state` frame sets it. A jsdom test that dispatches only a `hello` then sees
`r.<field>` undefined.

Rule: when a hello (or any `upsertRun`) field must be readable at once, add it to BOTH `makeRun`'s parameter list
and its returned object. Verify with a boot test that dispatches a single `hello` and reads the field off the run
page (test/ui-night-mode.test.mjs `openRun` pattern).
