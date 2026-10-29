---
name: search-highlight-css-traps
description: Read before widening the `is-found` highlight or styling top bar search rows in style.css; two traps no jsdom test shows
paths: ui/public/style.css, ui/public/topnav-search.mjs
updated: 2026-10-29T14:54:35.293Z
author: Bulibas
---

**`is-found` on more elements: never in the same rule as `.settings-card`.** `test/ui-addon-pages-surface.test.mjs`
("no rule boxes a list row or restyles a list card") fails any rule whose selector names both `[data-view="models"]`
and `settings-card`. So a widened `:is(.settings-card, .view[data-view="models"] > .card, …).is-found` turns the full
suite red, while every search and app test passes. Keep `.settings-card.is-found{…}` on its own and add a second
rule for the new elements. Do the same inside the reduced-motion `@media` block. The test's regex parser never reads
inside `@media`, so a mixed rule there passes, but it breaks the pin's intent.
The same file also forbids `background`/`border`/`box-shadow` on a one-class `.mv-pv-card`/`.mk-row` rule. A rule
with a space in its selector (`> .card`) is not checked.

**A sub line squeezes the row meta.** `.tsearch-tx` (title plus `.tsearch-sub`) and `.tsearch-meta` are both
`flex-shrink:1` and shrink by their basis. A long sub (a plugin description, ~120 chars) cut the meta to "Ins…" at
1280 px (FEAT-2, 2026-10-29). jsdom has no layout, so only a live walk shows it. A row whose meta carries state gets
`flex-shrink:0` on the meta; its `max-width:55%` still caps it (`.tsearch-opt-plugin .tsearch-meta`). Chat rows with a
long snippet may have the same squeeze on their time.
