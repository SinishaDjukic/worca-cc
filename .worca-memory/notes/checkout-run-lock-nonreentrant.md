---
name: checkout-run-lock-nonreentrant
description: Read when extending checkout operations or serializing multi-step run branch mutations
paths: src/core/checkout.mjs, ui/server.mjs
updated: 2026-10-08T05:58:57.479Z
author: Bulibas
---

The per-run lock exported as `withRunLock` is a promise-chain lock and is **not reentrant**. Calling the public
`checkoutRun()` while already inside `withRunLock(id, ...)` deadlocks because `checkoutRun()` queues behind the
currently executing lock holder.

When checkout must be one step in a larger atomic run operation, hold `withRunLock(id, ...)` around the whole
sequence and call `checkoutRunUnderLock()` inside it. The caller-locked helper must never be used without that
outer lock. Re-read the pipeline row and member inside the callback; values captured before waiting on the lock
can preserve the race the lock is meant to prevent.
