---
name: ask-panel-card-traps
description: Read before adding an Ask chat card, chip, composer element or Ask CSS — cache shape, repaint signature, real CSS tokens, hidden-page checks, pinned rows.
paths: ui/public/ask-panel.mjs, ui/public/style.css, ui/public/ask-*.mjs, ui/public/chat/*.mjs
updated: 2026-10-26T17:17:08.384Z
author: Bulibas
---

- Periodic work that must pause while the Chat page is off screen (a tick, a 30 s REST re-read) must check
  `el.closest('.hidden, [hidden]')`. `app.js` `showView` hides a whole page with the `.hidden` CLASS
  (`views.forEach(v => v.classList.toggle('hidden', …))`), not the `hidden` attribute. A check for `[hidden]` alone
  keeps polling while the user is on another page, and a jsdom test that sets `.hidden = true` still passes.
  `chat/run-card.mjs` `shown()` is the model. Test both forms (seen 2026-10-18, chat chips prototype).
- An answer's rendered DOM can hold raw inline HTML the model wrote. marked passes it through, and the DOMPurify
  config in `ui/public/ask-markdown.mjs` keeps `<code><a href=…>` (checked 2026-10-18). A post-pass over answer links
  that must leave code alone needs its own `a.closest('pre, code')` check. Markdown-only test answers (backticks,
  fences) never put an `<a>` inside code, so only an answer with raw `<code><a href=…>` pins that check. In the chat
  chips run, removing it stayed green.

- `buildCard` in `ui/public/ask-panel.mjs` caches `{ el, handle, dispose }` in `st.cardEls`, and
  `relayoutCards()` reads `c.handle.parts.graph` on EVERY cached entry that has a `handle`. A new card whose
  factory handle has no `parts` crashes the flush with `Cannot read properties of undefined (reading 'graph')`.
  Return only `{ el, dispose }` from the panel's `build…Card` unless the handle draws a graph.
- `test/ui-ask-style.test.mjs` "the ask section spends tokens, not hex" scans the WHOLE Ask CSS section,
  comments included, for `/#[0-9a-fA-F]{3}\b/`. An issue number in a CSS comment (`/* … (#574) */`) is
  three hex digits and fails it. Write "issue 574" in style.css comments.
- `style.css` has NO generic design-system tokens: `--space-*`, `--border`, `--radius-sm`, `--text-muted`,
  `--font-mono`, `--warning`/`--danger`/`--success` do not exist (plans keep inventing them). Real ones near the
  Ask cards: `--line` (borders), `--r-card` (radius), `--ink`/`--ink-2`/`--ink-3` (text, muted), `--mono`,
  `--amber-line`/`--amber-ink`, `--red-ink`, `--green-ink`; spacing and font sizes are plain px.
- Panel code reaches the thread model as `st.model` (no bare `model`); out-of-turn data enters through the inner
  `pushServerFrame(frame)` (also `panel.pushServerFrame` in tests); a card repaints when the model calls
  `markBlockDirty(rowId, blockId)` — `flushExtra` rebuilds every row in `dirty.blocks`.
  BUT `markBlockDirty` alone is not enough for an assistant row: `buildMessage`'s `renderTail` re-renders its
  cards only when `tailSignature(row)` changes, and that signature reads block id/state/type/runId/error only. A
  card whose look depends on data OUTSIDE the block (the run plan card's `st.model.planOf(id)`) must add that data
  to `tailSignature`, or frames arrive, the row is "refreshed" and nothing changes on screen (seen 2026-10-08).
- Panel jsdom tests: the harness fetch is `deps.fetch` (the panel's bare `fetch` is that). To make the panel
  resync over REST in a test, push an `ask-start` for a new message (seq 1) then a frame with seq 5 (a gap).
  Re-pushing a job frame at an already-used seq is dropped as stale; update a finished row with an `ask-message`
  frame (what `flipCard` broadcasts).
- A composer pill built on `.ask-scope-btn` (display:inline-flex) never hides with `hidden` alone. It needs its
  own `.<class>[hidden]{display:none;}` twin, and the twin list in `test/ui-ask-style.test.mjs` should name it.
- `.ask-pill` is NOT a generic pill: it is the global dock launcher button (`style.css` ~5271: display:flex,
  padding 11px 18px, box-shadow, cursor:pointer, 13.5px bold). Reusing it for a status chip inside a card makes
  every chip look like the launcher. Card chips need their own class (model `.ask-mcard-kind`). Likewise the
  class names `ask-card-kicker`, `ask-card-title`, `ask-card-note`, `ask-card-foot` have NO CSS rule; the existing
  cards use `ask-mcard-*` and an `ask-mcard-actions` row with `ask-card-not-now` / `ask-card-start` buttons. Grep
  `style.css` for every class a new card builds (flagged in the run-plan review, 2026-10-08).
- A new composer-row element after the MCP chip shifts the sibling pin in `test/ask-panel-scope.test.mjs`
  ("row is attach → scope → …"); update that pin with it.
- `.ask-chip` / `renderChips()` in `ask-panel.mjs` already belong to the composer's attachment chips. Pick another
  class prefix for new chips.
- A mid-turn chat's REST snapshot already holds the assistant row (`status: 'streaming'`). When a test pushes only an
  adopting `ask-delta` (no `ask-start`) for that id, `ensureStreamingRow` finds the row and calls no `upsertRow`, and
  `dirty.label` stays false. The row's tail (the `.ask-thinking` orb row) is then not rebuilt, so no orb appears. A
  snapshot WITHOUT that row (most older stream tests) hides this. Replay from seq 1 with `ask-start`, as the server's
  ring replay does (seen 2026-10-18, thread-switch resubscribe fix).

**A reconnect does not re-apply the thread's model pick.** `loadThread` calls `applyThreadPick` only when a DIFFERENT
chat opens (`if (switched)`); a resync or reconnect (`onHello` → `resync` → `loadThread` of the same id) keeps the
picker so a pick whose PATCH has not landed is not undone. So any server-side change to `thread.model`/`engine` made
elsewhere (another tab, an engine switch, #943) is lost by a tab that was offline: its next send posts the old model.
Handle the reconnect path explicitly and test it with `ctx.panel.onHello([])` against a handler whose GET answers the
changed thread (cycle 3 of the #943 refine: two replay-green cycles missed it; an audit lane found it with a probe).
