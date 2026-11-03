---
name: plugin-config-write-merges
description: writePluginConfig merges (null clears) and validates nothing; redactedConfig hides $env names; listTaskSources has no configSchema
paths: test/chat-*.test.mjs, src/core/plugin-config.mjs, src/core/sources.mjs, ui/routes/marketplace/plugins.mjs
updated: 2026-11-03T22:44:08.077Z
author: Bulibas
---
`writePluginConfig` MERGES into the stored config: an `undefined` (absent) key keeps its prior value, only `null`
clears it (`src/core/plugin-config.mjs` writePluginConfig). So a case that sets `allowedUserIds: 'U7'` and "restores"
with `writePluginConfig(NAME, SCHEMA, CFG)` leaves `U7` in place. Every later case in the file then fails silently:
the freeform bridge ignores a sender outside Allowed user IDs without a reply, so the next `waitFor` just times out
after 10 s (freeform e2e, 2026-11-01: cases 5c and 21 red for this reason only).

Restore with an explicit null: `writePluginConfig(NAME, SCHEMA, { ...CFG, allowedUserIds: null })`.
A plan that says "restore the config" should spell this out.

**No validation anywhere on the write path** (checked 2026-11-04, #1074 planning). `writePluginConfig` stores any key
and any JSON value: keys outside the schema land in `config.json`; type, `required` and select `options` are checked
only in the browser (`ui/public/marketplace/setup-fields.mjs flagMissing`), and `PUT /api/plugins/:name/config` adds
nothing. A new writer (a chat card, a CLI) must validate against the manifest schema itself.
- `redactedConfig` shows a `{"$env":"VAR"}` reference as `{set:true}`, so it cannot tell the variable name; a reader
  that must show `${VAR}` needs its own view of the raw buckets (`readBucket` is private).
- `listTaskSources()` (sources.mjs) drops `configSchema`; read the normalized manifest for it.
- `PUT /api/source-bindings` checks only that the profile exists for the plugin (not that the plugin is enabled, the
  source is multi-profile, or the project exists) and emits no change event.
