---
name: run-card-lane-reload-null-window
description: Read before adding anything to the Chat run card that reads or carries state across `reloadLane` (ask-panel.mjs)
paths: ui/public/ask-panel.mjs
updated: 2026-11-27T06:59:13.409Z
author: Denislav Prinov
---
`reloadLane()` in `ui/public/ask-panel.mjs` sets `local.lane = null` synchronously. It then fills it only when `loadLane` resolves, and a `laneSeq` guard drops every reload except the newest.

Consequence: any handler that reads `local.lane` while a reload is still in flight sees `null`. A second `<select>` change does this: arrowing through a closed select fires `change` for every option. Any state the first reload was carrying, such as a `keep` of edits to lay back, is then lost, because the guard throws away the reload that held it.

Seen in the per-step harness picker run (2026-11-27, review cycle 1, major): `reloadLane({ keep: pinnedEdits(local.lane) })` dropped the user's harness pins when Default harness changed twice before the fetch answered.

Rules:
- Keep carried state on `local` until a lane lands (e.g. `local.pendingKeep`), and fall back to it when `local.lane` is null.
- Pin it with a test that fires two changes and no tick in between.
