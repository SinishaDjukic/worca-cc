---
name: topnav-search-testing
description: Testing the top bar "Search or ask" end to end — where app.js wiring is testable, and how to pin a ranking rule against a fixed catalogue
paths: ui/public/topnav-search.mjs, ui/public/global-search.mjs, test/ui-topnav-search-app.test.mjs, test/ui-global-search.test.mjs
updated: 2026-10-29T15:27:25.771Z
author: Bulibas
---

**App wiring IS testable in jsdom.** `test/ui-topnav-search-app.test.mjs` boots the real app.js (`boot()`; `recv(obj)` feeds a WS frame such as `{type:'flags', flags:{runTags:true}}`). A plan that says "no unit reaches app.js, the live walk covers it" leaves every app-level mutation alive (FEAT-1 refine, 2026-10-28). Set the mode with `doc.documentElement.dataset.level = 'simple'` before typing; drive the mode dialog with `#mode-cards [data-level-choice]`, `#mode-done` and `#lvl-menu [data-level-choice]`.
- Its generic fetch body breaks some pages: routing a row to `#connectors` throws in `mcp-view.mjs` `paint` (an unhandled rejection that fails the test). Use `#marketplace`, or add an arm.
- `test/ui-global-search.test.mjs` "no match" deepEquals the WHOLE `searchRows` result: a new result key reddens it.
- **Its generic GET body has no `uiLevel`, so mode races are invisible there.** `levelCtl.choose()` paints the mode BEFORE `save()` sends the POST; anything that routes on `worca:level` reaches `loadSettings()` → `levelCtl.confirm(data.uiLevel)` while the POST is still in `persistSettings`, and the GET (sync file read) answers the OLD mode, hiding the target card (FEAT-1 refine cycle 2: four review passes missed it). To reproduce, after `boot()` swap `globalThis.fetch = ctx.window.fetch` for a wrapper that holds the `/api/settings` POST and answers GETs with `{ ...generic, uiLevel: 'simple' }`, then assert `documentElement.dataset.level` before releasing the POST.

**New catalogue words can break exact-title pins in other files.** Matching is a substring test over the title, the tab or page title, and the alt words. Several tests pin the WHOLE row list for a query:
- `test/ui-topnav-search.test.mjs`: `login`, `guardrails`, `fix`, `nightly`, `zzzzqq`, `zzqx`, `theme`.
- `test/ui-topnav-search-app.test.mjs`: `login`, `team`, `proj project`.

A new static Settings or Add-ons entry whose title or alts contain one of those words reddens those tests. Grep the new block before adding it.
- **Rows from lazy reads arrive late.** `searchPick` types right after ⌘K, before `loadTopnavLazy` settles. Rows from the lazy reads (workflows, schedules, and since the plugins plan also plugins, marketplaces and MCP servers) are missing at that point. Settle about 8 ticks after ⌘K before typing.
- **Plugin manifests have no `displayName`, `keywords` or `tags`.** `KNOWN_TOP` in `plugin-manifest.mjs` has only description. So a plugin search can match name and description only.

**Landing helpers' guards go untested by default.** A pick that routes to a page and then flashes a row (`reveal*`,
`open*Target`, `showConnectors`) carries two kinds of guard that stayed green when removed, even though every mutant
the plan listed was killed (plugins plan cycle 1, 2026-10-29, 18 of 44 survived):
- the `parseHash()[1] !== param` / `currentView()` / `location.hash !== hash` bail after the async load;
- each field a "clear the page's own filters" helper resets (`mvState.filter`, `collapsed`, `justImported`), where the
  test only narrowed one of them.

Pin the bail by holding the arm's answer in a deferred promise, navigating away, then releasing it. Pin each reset
with its own row. Pin the cache's failed-read path with `boot({ down: { '/api/marketplaces': 500 } })`.
`boot()` takes `holds` (path → promise) and both `holds` and `down` stay mutable after boot: add the hold AFTER the
search's own lazy read, just before the click, or the search list never fills. A `currentView() !== X` check and a
`parseHash()[1] !== param` check each need their own move: a same-view hash with another tail (`#models`) kills only
the param check, and only a hash on ANOTHER view with the SAME tail (`#providers/model/my-gpt`, `#models/openai`)
kills the view check. "Just imported" is reachable only through the Copilot import dialog (`#model-import-btn`, tick
`.mvi-cb`, `#mimp-go`, arm `/api/providers/copilot/import-models`). All 16 such guards killed this way (2026-10-29).

**Ranking pins over a hand-written catalogue can be vacuous.** "Name match before alt-word match" looked pinned by "tags", but the card matched through its TAB's name, so deleting the rank branch stayed green. Brute-force it: for every word in the catalogue, compare `searchRows` output between the real module and a `sed` mutant copied to a `.tmp.mjs` beside it; only the queries whose output differs can pin the rule (FEAT-1: just "run").
