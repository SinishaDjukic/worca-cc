---
name: composer-selection-traps
description: Read when changing the Composer's selection, gestures or canvas keys (composer.mjs, view.mjs, the shell toolbar), or writing their jsdom tests or CDP checks. Tr
paths: ui/public/graph/composer.mjs, ui/public/graph/view.mjs, ui/public/workflows/shell.mjs, test/ui-composer*, test/ui-workflows-session-menu*, tools/verify-composer-cdp.mjs, src/shared/graph/canvas-ops.mjs
updated: 2026-11-01T15:11:33.200Z
author: Denislav Prinov
---

Found by replaying the Shift+click plan (2026-11-01). Live checks: [[real-browser-view-probe]], [[ui-cdp-audit-traps]].

## Rings and focus
- `.gv-world .node:focus-visible` paints the same ring as `.gv-world .node.sel`. A script `focus()` matches `:focus-visible` in Chrome when focus came from a field or the keyboard, so a card that LEFT a multi-selection keeps a ring while it still holds the focus. jsdom cannot see it. Move the focus to a card still selected, and prove it with `el.matches(':focus-visible')` over CDP after a caret in `#wfv-name`.
- A focused `.gv-sess-head` is a button: Enter and Space select its session unless `already` says otherwise. Anything leaving the focus on a strip needs that rule to know about it.

## Fixtures
- A plain press settles a card on the 11 px grid and commits a `move` when it was off it (`x: 400` becomes `396`, `y: 80` becomes `77`). The existing `chain()` fixtures sit off the grid, so a test that presses a card and then checks `undoDepth` or undoes is off by one. Use multiples of 11 (`396 + i * 319`, `77`), or read depths after the press.
- `normalizeTemplate` does not snap; only that press does.
- `c.spawn` mints random ids, and step order breaks ties among unwired cards by id. A deepEqual on an order that includes a spawned id flakes by the id's first letter: compare sorted.
- The fixture `portsFn`'s `BASE` has no `combine` entry, so a combine card has no `out` port there. `sessionGraph` does not care; a test that reads ports does.

## A flag in a CDP proof
`document.documentElement.dataset.flags` alone is half: `#flag-gates` CSS still hides every `[data-flag~=key]`, so a gated control measures 0 px wide and the proof fails with a baffling toolbar width. Also empty `#flag-gates` for that page. `PATCH /api/flags` works but writes `settings.json` under `HOME`, which `verify-composer-cdp.mjs` does not sandbox.

The text-selection row of check (21) stays green with `.gv-canvas{user-select:none}` removed: `onDown`'s `preventDefault` on pointerdown also stops Chrome extending a selection. Do not read that row as pinning the CSS.

## V27's words are load-bearing
`newRealErrors` (`canvas-ops.mjs`) compares errors by `code|message` unless told otherwise. A message that names a card (`'x' runs between…`) turns "the batch swapped x" into "a new error", and the chat refuses the whole batch. Rewording a validator message can change what the chat may do; key such a code by its subject (V27 by `sessionId`).

## Keys during a held press
`onKeyDown` has no gesture guard. A commit during a drag snapshots half-moved cards into the undo stack, and the release commits again. At the base (2026-11-01, not fixed): plain card drag + Delete + release throws in `onUp` (`n` is null) and leaves the gesture stuck until Escape; an arrow during a plain press double-commits; ⌘Z during a strip drag then release wipes redo. The picks drag cancels first on any commit key. Anything new reusing the `session` gesture needs the same.

## Toolbar
`data-flag` on a toolbar control is what hides it the moment Labs flips; `flagOn` in the signature only repaints at the next render, and nothing renders while the user is on Settings. Re-check the flag in the click too: jsdom has no gate CSS, so a test can only reach that guard by clicking.
