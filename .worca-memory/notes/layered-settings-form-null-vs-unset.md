---
name: layered-settings-form-null-vs-unset
description: Read before writing a Settings/project form for a layered config (project > user > team), e.g. night mode.
paths: ui/public/night-mode-form.mjs, src/core/night/config.mjs
updated: 2026-09-27T21:48:38.138Z
author: Bulibas
---

In a layered config (`resolveNightConfig`: project > user > team), an explicit `null` on a
NULLABLE field (window, timeZone, graceMinutes, spendCapUsd) means "off" and STOPS the
fall-through to the next layer. So a form must never turn an empty input into `null`:

- empty input → push the field name onto `__unset` (the setter deletes it, the next layer applies);
- an intended "off" → a separate checkbox ("No window", "No cap", "No grace timeout") that
  writes `null`, disables the input, and paints checked when the stored value is `null`.

Writing `null` for an empty field silently cancelled a team-configured `spendCapUsd` on every
unrelated Save of the user card — a review blocker. Test it by resolving the read-back patch
through `resolveNightConfig({ user, team })` and asserting the team value survives.
