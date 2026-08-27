# Blue highlighting of valid `@file` mentions in the New Pipeline prompt

**Date:** 2026-08-20
**Branch:** `feat/newpipeline-extras-pills`
**Status:** approved design, ready for implementation planning

---

## 1. Problem

Branch `feat/newpipeline-extras-pills` (commit `31d833a1`) added two things to the
New Pipeline form:

- extra files render as removable pills (`#extrasPills`), backed by the mutable
  module-level array `extrasFiles` (`ui/public/app.js:4542`);
- typing `@` in `#prompt` or `#promptMarkdown` opens a completion popup listing
  the attached file names (`ui/public/app.js:4583-4723`).

Once a mention is inserted it becomes indistinguishable plain text. The user
cannot tell, by looking at the prompt, whether `@spec.md` still refers to an
attached file or to a file they removed three edits ago. A mention that no
longer resolves is silently wrong: the agent receives the literal `@spec.md`
in the prompt text and a separate `## Attached files` list that does not contain
it (`src/core/channels.mjs:279-287`).

**Goal:** a mention that resolves to a currently-attached file renders blue.
Everything else stays the normal ink colour. The blue state must stay correct
under every way the text or the attachment set can change — typing, pasting,
picking from the popup, hand-typing a name without the popup, adding files,
removing files.

---

## 2. Locked decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Truth source: attached extras only.** A mention is valid iff it matches the `name` of a `File` currently in `extrasFiles`. | Purely client-side, zero network, synchronous. There is no repo-file-listing endpoint today — `GET /api/fs/dirs` returns directories only (`src/core/fs-browse.mjs:44`). |
| D2 | **Greedy longest-match** against the attached names, so names containing spaces (`@my report.pdf`) highlight in full. | Also removes a latent bug: `applyMention` inserts `` `@${name} ` `` for any name, including one with spaces, which today's `mentionTokenAt` can never re-parse. |
| D3 | **Both textareas** — `#prompt` and `#promptMarkdown`. | Both already carry `attachMentionAutocomplete`. |
| D4 | **Case-sensitive** name match for the blue state. | The server copies extras by `basename` verbatim (`ui/server.mjs:3379-3402`, `src/core/artifacts.mjs:823-837`). A blue `@README.MD` against an on-disk `README.md` would be a lie the agent pays for. The *completion popup* keeps its case-insensitive filtering — that is a search affordance, not a claim of validity. |
| D5 | **Invalid mentions get no styling at all** — normal `var(--ink)`, no red, no underline. | Requested. Absence of blue is the signal. |
| D6 | Approach: **backdrop mirror layer** behind a transparent-text textarea. | See §3. |
| D7 | `index.html` is **not** modified; the wrapper and backdrop are created in JS at attach time. | Keeps the two textareas and any future one symmetric behind a single `attachMentionHighlight(ta)` call, mirroring `attachMentionAutocomplete(ta)`. |

---

## 3. Approach

### 3.1 Chosen: backdrop mirror layer

For each target textarea, at init:

```
div.ta-hl                 position:relative   (wrapper, created in JS)
├── div.ta-hl-back        position:absolute; inset:0; pointer-events:none
└── textarea#prompt       background:transparent; color:transparent; caret-color:var(--ink)
```

The backdrop renders the *same characters* as the textarea, with valid mentions
wrapped in `<span class="mention-ok">` (blue). Because the two elements share
identical font, padding, border and wrapping metrics, the backdrop's glyphs land
exactly under the textarea's invisible ones.

**Wrapper box model.** Both textareas carry an inline `style="margin-top:11px"`
(`index.html:226`, `:230`). Left on the textarea it would push it 11px below the
backdrop's top edge, so the margin moves to the wrapper. Two details are load-
bearing, both measured in Chrome 151 against the real stylesheet:

- the wrapper is **`display:inline-block; width:100%; vertical-align:top`**, not
  block. A textarea is `inline-block` by UA default, so today's `margin-top:11px`
  does not collapse; on a *block* wrapper the same margin becomes a collapsible
  block margin that escapes through `.source-pane` (which has no CSS rule) and
  `.field` and merges with the preceding `margin-bottom:18px` — the 11px gap
  disappears and everything below moves up;
- the textarea becomes **`display:block`** inside the wrapper. Left inline-block,
  it sits in a line box whose strut adds a ~6px descender, and the backdrop's
  `inset:0` fill then spills past the textarea's rounded border.

With both in place the pane→textarea gap is back to 11px and
`backdrop.height − textarea.height` is 0.

**Why the backdrop is `position:absolute`:** it is out of flow, so the wrapper is
sized by the textarea alone. The user dragging the `resize:vertical` grip, a
window reflow at the `max-width:760px` breakpoint, or the `#source-seg` buttons
wrapping and shifting the layout all resize the wrapper automatically. **No
`ResizeObserver` is needed** — which matters, because jsdom does not provide one.

**Rejected — background tint only** (textarea text stays black, backdrop paints
only a `--blue-bg` chip behind the tag): fully native selection and spellcheck,
zero artifacts, but the tag text never turns blue. Fails the requirement.

**Rejected — `contenteditable`:** real styled text and inline pills, but it
rewrites `.value` semantics across the submit path (`ui/public/app.js:6523-6570`),
the mention caret anchoring, paste sanitisation, the undo stack, and the 79 jsdom
tests that load `ui/public/app.js`. Cost far exceeds the feature.

### 3.2 Visual contract

| Element | Style |
|---|---|
| Valid mention (`.mention-ok`) | `color: var(--blue-ink)` (`#3782A8`) — **colour only**. Any metric-affecting property (`font-weight`, `letter-spacing`, `font-style`) would advance the backdrop's glyphs differently from the textarea's invisible ones and drift the two layers apart. |
| Everything else in the backdrop | `color: var(--ink)` (`#19191B`) — identical to today's textarea text |
| Textarea | `color: transparent`, `background: transparent`, `caret-color: var(--ink)` |
| Backdrop background | carries the field fill the textarea gave up: `var(--field)` at rest, `#fff` under `.ta-hl:focus-within` — pure CSS, no JS focus listener |
| Border and radius | stay on the **textarea** (unchanged rules at `style.css:276`/`:284`); the backdrop's own border stays `transparent` and exists only so the two boxes have identical metrics |
| `::selection` on the textareas | semi-transparent (`rgba(25,25,27,.16)`) so backdrop glyphs stay legible under a selection band |

There is no dark theme in this codebase (a single `:root` block, zero
`prefers-color-scheme`), so one palette suffices — but `forced-colors` is an
unrelated media feature and is **not** covered by that. Under Windows High
Contrast the textarea's `color:transparent` is forced back to `CanvasText` while
its background stays transparent, so both layers' glyphs paint at once, and
`--blue-ink` flattens to black. The two-layer trick therefore opts out entirely:

```css
@media (forced-colors: active){
  .ta-hl-back{display:none;}
  .ta-hl > textarea.textarea,
  .ta-hl > textarea.textarea:focus{color:CanvasText;background:Canvas;}
}
```

The prompt then renders exactly once, in system colours, with no mention
colouring — the correct degradation for a mode whose whole point is that the
page does not choose colours.

The `::placeholder` rule (`style.css:282`) sets its own colour and therefore wins
over the element's `color: transparent` — the placeholder still shows.

Spellcheck squiggles are decorations, not glyphs, and remain visible.

---

## 4. Validity rules

A mention is the maximal run `@NAME` where:

1. the `@` is at index 0 **or** the preceding character matches `` /[\s([{'"`,;:]/ `` — the same
   left-boundary class `mentionTokenAt` already uses (`ui/public/app.js:4610`), so
   `email@example.com` never highlights;
2. `NAME` is, character-for-character, the `name` of a file currently in
   `extrasFiles` (case-sensitive, D4);
3. among all attached names that match at that position, the **longest** wins (D2);
4. the match ends cleanly: the following character is end-of-text or whitespace,
   or it is punctuation from `` /[)\]}'"`,;:.!?]/ `` that is *itself* followed by
   end-of-text, whitespace, or more punctuation.

Trailing punctuation needs the second clause. Treating it as an unconditional
terminator would let an attached `a.txt` light up inside `@a.txt.bak`, claiming
a file that is not attached; forbidding it outright would kill `@a.txt.` at the
end of a sentence. The two-step test keeps `@a.txt.`, `@a.txt,`, `@a.txt...`,
`(@a.txt)` and `"@a.txt".` blue, and leaves `@a.txt.bak`, `@a.txt,bak` and
`@a.txt2` entirely black.

Overlaps are impossible: the scanner advances past the end of each accepted match.

---

## 5. Performance

Three independent layers, each removing work from the keystroke path.

**L1 — the name index is rebuilt only when the attachment set changes.**
`extrasFiles` mutates at exactly three sites (`ui/public/app.js:4560`, `:4575`,
`:4576`), all of which already funnel through `renderExtrasPills()`. That single
function becomes the rebuild hook. The index is:

```js
{ byFirstChar: Map<char, string[]> }   // each bucket sorted longest-first
```

Per keystroke the scanner allocates nothing for the name list and never re-sorts.

**L2 — the scan is one left-to-right pass, and does work only at `@`.**
`indexOf('@', i)` skips non-mention text at native speed. At each `@` the scanner
reads the bucket for the following character and tries its names longest-first
with `startsWith` — bounded by the number of attached files sharing that first
character, which is realistically 1–3. Total cost is O(text length) plus a
negligible constant per `@`.

**L3 — repaint is coalesced and skipped when nothing changed.**
Scan + DOM rebuild are deferred into one `requestAnimationFrame` per textarea
(falling back to `setTimeout(fn, 0)` where rAF is absent — jsdom's `JSDOM` is
constructed without `pretendToBeVisual`, so it has no `requestAnimationFrame`).
Before touching the DOM the highlighter compares the text and a joined marks key
against the last painted pair and returns early if both are equal. The two are
compared, never concatenated into one signature string — concatenating would
allocate a fresh copy of the whole prompt on every repaint, including the ones
that exist precisely to do nothing.
This makes redundant triggers (pane reveal, view reveal, extras re-render with an
unchanged set) free.

**Degradation caps:**

- above `MENTION_HL_MAX_CHARS = 20000` the backdrop renders a single text node and
  no scan runs, so a pasted novel cannot cause pathological reflow.

A hidden pane is deliberately **not** special-cased. The obvious gate
(`ta.offsetParent === null`) is hard-coded to `null` under jsdom and would
disable the feature in every test; the saving — one paint of an invisible
textarea when the attachment set changes — is far below the signature
short-circuit's cost. The reveal hooks below still refresh the scrollbar gutter
once a pane becomes measurable.

**Scroll and metrics sync** (no rescan involved):

- `scroll` on the textarea → copy `scrollTop`/`scrollLeft` onto the backdrop's
  transform/scroll offsets;
- on each repaint, absorb the textarea's scrollbar: when content overflows, the
  browser takes ~10px (`style.css:768`) out of the textarea's content width, so
  the backdrop's `padding-right` is increased by
  `ta.offsetWidth - ta.clientWidth - borderX` to keep wrapping identical. The value
  is measured once per repaint and only written when it changes.

---

## 6. Triggers

| Trigger | Site | Action |
|---|---|---|
| Typing, paste, cut, drag-drop, undo/redo, IME commit | `input` listener on each textarea | schedule repaint |
| Popup completion inserted | `applyMention` (`app.js:4676`, programmatic `.value =`, fires no `input`) | schedule repaint |
| `.md` file loaded into the markdown textarea | `el.mdFile` change handler (`app.js:4533`, programmatic `.value =`, fires no `input`) | schedule repaint |
| File attached or pill removed | `renderExtrasPills()` (`app.js:4544`) | rebuild index, then schedule repaint for **both** textareas |
| Prompt/markdown pane revealed | `syncSourceToggle()` (`app.js:4373`) | schedule repaint (a pane hidden at paint time was skipped) |
| New Pipeline view revealed | `showView('new')` (`app.js:10741`) | schedule repaint |
| Textarea scrolled | `scroll` listener | offset sync only, no scan |
| Focus / blur | — | handled in CSS by `.ta-hl:focus-within`; no listener |

Programmatic writes are hooked with an explicit `scheduleMentionHighlight(ta)`
call at the two call sites rather than by synthesising an `input` event — an
`input` event would also re-enter `refreshMentionPopup`, and relying on that path
happening to be a no-op is a subtlety with no upside.

---

## 7. Security

File names are user-controlled and may contain `<`, `>`, `&`, or quotes. The
backdrop is built exclusively with `document.createTextNode` /
`document.createElement` + `textContent`. `innerHTML` is never used anywhere in
the highlighter. A test asserts that a file named
`<img src=x onerror=alert(1)>.txt` produces no element node in the backdrop
beyond the expected `span.mention-ok`.

---

## 8. Invariants

1. `backdrop.textContent === textarea.value` at all times after a paint — the
   backdrop must never drop, duplicate, or reorder a character. A trailing `\n`
   needs the usual `white-space: pre-wrap` care: append a zero-width guard so the
   final empty line occupies its row identically in both layers.
2. No code path reads or writes `textarea.value` other than the existing ones.
   The submit payload (`ui/public/app.js:6523-6570`) is byte-identical to today.
3. Nothing throws when geometry is unavailable. Under jsdom every measurement
   returns `0` *without* raising, so guards must be value-based, not `try/catch`.
4. With zero attached files the feature is inert: the index is empty, no scan
   runs, the backdrop is one text node, and the rendering is visually identical
   to today.

---

## 9. Files touched

| File | Change |
|---|---|
| `ui/public/app.js` | New `attachMentionHighlight(ta)` section (~80 lines) beside the existing mention block; 5 one-line hooks at `renderExtrasPills`, `applyMention`, the `mdFile` change handler, `syncSourceToggle`, `showView`. |
| `ui/public/style.css` | `.ta-hl`, `.ta-hl-back`, `.mention-ok`, the `::selection` softening, and adding `.ta-hl-back` to the shared control-metrics selector at `:276` so padding/border/font can never drift from `.textarea`. |
| `test/ui-newpipeline-mention-highlight.test.mjs` | New jsdom test file. |
| `ui/public/index.html` | None. |

---

## 10. Test plan

Geometry is unobservable under jsdom (`getBoundingClientRect` is hard-coded to
zeros, `offsetLeft`/`offsetTop`/`offsetWidth` to `0`, no `ResizeObserver`, no
`requestAnimationFrame`). Every assertion is therefore structural — element
presence, class names, `textContent` — following the harness in
`test/ui-newpipeline-extras.test.mjs:13-64`.

1. Attach `a.txt`, type `@a.txt` → exactly one `.mention-ok` with text `@a.txt`.
2. Type `@nope.txt` with `a.txt` attached → zero `.mention-ok`.
3. Valid mention present, then remove the pill → zero `.mention-ok`; the backdrop
   text is unchanged.
4. Remove one of two attached files → only the removed one loses its blue.
5. Paste (set `.value` + dispatch `input`) a paragraph containing one valid and
   one invalid mention → exactly one `.mention-ok`, the right one.
6. Hand-typed mention without ever opening the popup → highlighted.
7. Attach `my report.pdf`, type `@my report.pdf and more` → one `.mention-ok`
   spanning the full name (greedy longest-match).
8. Attach both `a.txt` and `a.txt.bak`; `@a.txt.bak` highlights the longer name.
9. `email@example.com` with `example.com` attached → zero `.mention-ok`
   (left-boundary rule).
10. `@a.txt2` with `a.txt` attached → zero `.mention-ok` (right-boundary rule).
11. `@a.txt.` at end of sentence → one `.mention-ok` reading `@a.txt`.
12. Case: `@A.TXT` with `a.txt` attached → zero `.mention-ok` (D4).
13. Both textareas behave identically (repeat the core case on `#promptMarkdown`).
14. Completion via the popup (`Tab`) leaves the inserted mention highlighted —
    proves the programmatic-write hook fires.
15. `.md` file load populates the markdown backdrop — proves the second
    programmatic-write hook fires.
16. `backdrop.textContent === ta.value` after each of the above.
17. XSS: a file named `<img src=x onerror=alert(1)>.txt` yields no injected
    element.
18. No-op repaint does not replace backdrop child nodes (node identity preserved)
    — proves the signature short-circuit works.
19. Zero attached files → backdrop is a single text node, no `.mention-ok`.

Run with `npm test` (node:test, `test/*.mjs`). The full suite must stay green;
the 79 jsdom tests that load `ui/public/app.js` — several of which set
`#prompt.value` directly and submit — are the regression net for invariant 2.

---

## 11. Out of scope

- Validating mentions against repository files (needs a new server endpoint and a
  cached, invalidated file index). The resolver lives behind one function so a
  second source can be added later without touching the scanner or the renderer.
- Any change to what the server or the agent does with `@` tokens; the prompt text
  remains a verbatim pass-through end to end.
- Restyling the completion popup, the pills, or the markdown pane.
- Clicking a blue mention to reveal or remove the file.
