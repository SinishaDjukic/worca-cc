---
name: topnav-search-testing
description: Testing the top bar "Search or ask" end to end — where app.js wiring is testable, and how to pin a ranking rule against a fixed catalogue
paths: ui/public/topnav-search.mjs, ui/public/global-search.mjs, test/ui-topnav-search-app.test.mjs, test/ui-global-search.test.mjs
updated: 2026-10-28T20:59:16.170Z
author: Bulibas
---

**App wiring IS testable in jsdom.** `test/ui-topnav-search-app.test.mjs` boots the real app.js (`boot()`; `recv(obj)` feeds a WS frame such as `{type:'flags', flags:{runTags:true}}`). A plan that says "no unit reaches app.js, the live walk covers it" leaves every app-level mutation alive (FEAT-1 refine, 2026-10-28). Set the mode with `doc.documentElement.dataset.level = 'simple'` before typing; drive the mode dialog with `#mode-cards [data-level-choice]`, `#mode-done` and `#lvl-menu [data-level-choice]`.
- Its generic fetch body breaks some pages: routing a row to `#connectors` throws in `mcp-view.mjs` `paint` (an unhandled rejection that fails the test). Use `#marketplace`, or add an arm.
- `test/ui-global-search.test.mjs` "no match" deepEquals the WHOLE `searchRows` result: a new result key reddens it.

**Ranking pins over a hand-written catalogue can be vacuous.** "Name match before alt-word match" looked pinned by "tags", but the card matched through its TAB's name, so deleting the rank branch stayed green. Brute-force it: for every word in the catalogue, compare `searchRows` output between the real module and a `sed` mutant copied to a `.tmp.mjs` beside it; only the queries whose output differs can pin the rule (FEAT-1: just "run").
