---
name: plugin-config-write-merges
description: Restoring a chat plugin's config in a test with writePluginConfig(name, schema, CFG) does NOT remove keys a case added
paths: test/chat-*.test.mjs, src/core/plugin-config.mjs
updated: 2026-11-01T14:36:22.565Z
author: Bulibas
---
`writePluginConfig` MERGES into the stored config: an `undefined` (absent) key keeps its prior value, only `null`
clears it (`src/core/plugin-config.mjs` writePluginConfig). So a case that sets `allowedUserIds: 'U7'` and "restores"
with `writePluginConfig(NAME, SCHEMA, CFG)` leaves `U7` in place. Every later case in the file then fails silently:
the freeform bridge ignores a sender outside Allowed user IDs without a reply, so the next `waitFor` just times out
after 10 s (freeform e2e, 2026-11-01: cases 5c and 21 red for this reason only).

Restore with an explicit null: `writePluginConfig(NAME, SCHEMA, { ...CFG, allowedUserIds: null })`.
A plan that says "restore the config" should spell this out.
