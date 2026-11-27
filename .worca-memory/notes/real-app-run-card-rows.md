---
name: real-app-run-card-rows
description: How to write an "in the real app" jsdom row for a Chat run card (app.js boot), and two test-rig traps in the Requirements view tests.
paths: test/ui-chat-page-app.test.mjs, test/requirements-view-note.test.mjs, test/requirements-view.test.mjs
updated: 2026-11-27T06:59:12.171Z
author: Denislav Prinov
---

**A run card inside the booted app (no earlier example existed; worked 2026-11-27, model columns picker fix cycle).**
Reviews demand one row per app.js wiring line (`engineRows: readyEngineRows`, `openAddModel` → `addModelOn`) that
`makePanel`-based card tests cannot reach because they inject those deps.
- Boot `test/ui-chat-page-app.test.mjs`'s `boot({ hash: '#chat/<TID>', fetchHandler })`. The hash must name the
  thread: `stored: TID` with `#chat` boots Chat home and never loads the stored chat.
- `recv` an `ask-start` (seq 1) first, then an `ask-card` (seq 2) for that thread and message. A seq'd frame for a
  message the panel has not seen is dropped. Then `settle(12)`.
- The lane needs answers for `/api/workflows/<id>`, `/api/agents`, `/api/config`, `/api/run-defaults`,
  `/api/projects`, `/api/workflows`, `/api/guardrails`, `/api/workspaces` and `/api/branches`.
- Add model from the picker lands on `#models`. The harness shows as `.mdl-hx-t[aria-pressed="true"]`; OpenCode opens
  at `.mdl-add[data-step="2"]`.

**Requirements rigs:**
- `test/requirements-view-note.test.mjs`: the run setup overlay mounts on `document.body`, not on the view's host. A
  test that leaves it open (an error or "Start cancelled.") makes the NEXT test's `[data-ui=...]` lookups click the
  stale overlay of another view. The posts still show up, but `opened` stays empty. End such a test with
  `overlay()?.remove()`.
- `test/requirements-view.test.mjs`'s `fakeApi` calls a route function with NO argument (the note file's passes the
  call). `(c) => c.body…` throws inside fetch and reads as a network error. Use a call counter there.
