---
name: app-js-no-toast-helper
description: Read before claiming a UI helper is missing from ui/public/app.js, when choosing how a History-detail action reports its result, or when a jsdom test asserts to
paths: ui/public/app.js, test/ui-*.test.mjs, test/helpers/feedback.mjs
updated: 2026-10-17T23:53:21.858Z
author: Bulibas
---

`ui/public/app.js` DOES have a toast: `notify({ tone, title, detail, key })` is IMPORTED from `./feedback.mjs`
(`app.js:97`, 60+ call sites). It is not defined in app.js itself, so a grep for `function notify` in app.js finds
nothing. A refine cycle (#620, 2026-10-07) wrongly called it missing because of that. Before you call any helper
missing, check app.js's import lines too.

For per-row or per-member results, Publish's pattern still fits: status text on an element the painter owns
(`paintHdPublish`, `r.statusEl.textContent = …`). For a painter that rebuilds its DOM on every repaint, keep the
message in a Map keyed by member and render it again. Use `notify` for errors that concern no single row.

Two traps in jsdom tests of these surfaces (seen 2026-10-18, team memory 1b):
- `feedback.mjs` keeps at most `TOAST_MAX` (3) toasts and drops the oldest non-error one. A test that compares
  `toastTitles(doc).length` before and after a step sees no new toast once three are up. Clear `#toasts`
  (`doc.getElementById('toasts').replaceChildren()`) before the step, then assert exactly one.
- The `click()` helpers in test/ dispatch a plain `Event`, and that fires listeners on a DISABLED button too. A
  click-through never proves a control was enabled again, so a guard that re-enables controls after a refusal stays
  untested (a review found four). Assert `.disabled === false` after each refusal.
