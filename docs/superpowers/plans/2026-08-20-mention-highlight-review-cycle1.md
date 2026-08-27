# Plan review — Blue `@file` mention highlighting (cycle 1)

**Plan:** `docs/superpowers/plans/2026-08-20-mention-highlight.md`
**Spec:** `docs/superpowers/specs/2026-08-20-mention-highlight-design.md`
**Verdict:** BLOCKING — 0 critical, 3 major, 2 minor, 3 suggestions.

Method: every `file:line` the plan cites was opened and checked. The scanner was
re-implemented verbatim and benchmarked in node. The CSS was reproduced against the
**real** `ui/public/style.css` and measured in headless Chrome 151 over CDP, because
jsdom has no layout and three of the plan's central claims are layout claims.

---

## Overview

This is a strong, unusually well-grounded plan. Its citations are accurate
(`app.js:4372/4377/4527-4536/4533/4542/4544/4560/4575/4576/4566-4568/4610/4619/4670-4681/4722-4723/6523-6524/10668/10741/10811`,
`style.css:276/284/381`, `index.html:226/230` — all verified verbatim), its TDD
structure is real, every code step carries literal code with no placeholders, and the
four tasks compose into a coherent whole. The blocking findings are three
**layout/environment** defects that jsdom structurally cannot catch and that the plan's
manual browser checklist does not currently look for.

### What is strong (verified, not assumed)

- **Text-metric parity is genuinely airtight.** I dumped every property that can affect
  glyph advance or line breaking on both a real `#prompt` and a real `.ta-hl-back` under
  the plan's CSS. All 19 match exactly: `font-family` (identical resolved stack),
  `font-size` 14px, `font-weight` 400, `font-style`, `font-variant`, `line-height` 21px,
  `letter-spacing` normal, `word-spacing` 0px, `text-indent` 0px, `tab-size` 8,
  `text-align` start, `direction` ltr, `hyphens` manual, `word-break` normal,
  `overflow-wrap` break-word, `white-space` pre-wrap, `font-kerning` auto,
  `text-rendering` auto, padding/border/box-sizing. The parity comes from putting the
  backdrop in the shared rule at `:276` *plus* the shared inheritance chain — the
  textarea's UA `font: -webkit-small-control` shorthand resets exactly
  family/size/weight/style/variant/line-height, and the shared rule or the plan's own
  block re-specifies every one of those. Nothing is missed. (`mentionAnchor`'s list at
  `:4619-4645` omits `tab-size`/`text-indent`/`word-spacing`/`direction` for the same
  reason — its mirror also lives in the body inheritance chain.) See suggestion S2 for
  the one forward-risk.
- **The wrapper does not mis-anchor the mention popup.** `mentionAnchor` reads
  `ta.getBoundingClientRect()` and `rect.width`; both are properties of the textarea
  itself, unchanged by re-parenting. Measured `taTop` identical modulo the margin bug
  below.
- **Backdrop top edge lands exactly on the textarea's top edge** (measured
  `back.top - ta.top === 0`), so glyph alignment per se is correct.
- **The scrollbar-gutter formula is right and necessary.** Measured
  `offsetWidth 480 - clientWidth 468 - borderX 2 = 10`, exactly the
  `::-webkit-scrollbar` width (`style.css:769`, plan says `:768` — that is the comment
  line, harmless). With a wrapped prompt: `ta.scrollHeight 404` vs `back.scrollHeight
  383` *without* the gutter padding, and `404 / 404` *with* it. The plan invented a real
  fix for a real problem.
- **Attaching to the hidden markdown pane is safe.** With `display:none` on the pane,
  Chrome still resolves `marginTop:11px`, `paddingRight:15px`, `borderLeftWidth:1px`, so
  `padRight`/`borderX` are correct at attach time.
- **The `.value` surface really is closed.** `grep` over the whole of `app.js` finds
  exactly three sites touching these values: `:4533` (`.md` load, hooked), `:4676`
  (`applyMention`, hooked), and the read-only `:6523-6524` submit. There is no form
  reset, no rerun-prefill, no template path. Invariant 2 holds by construction.
- **Initialisation ordering is safe, exactly as the plan claims.** `renderExtrasPills`
  is called only from `:4561` and `:4579` (both event handlers); `syncSourceToggle` is
  called at `:4395`, `:4427`, `:4454` (all handlers / inside async `loadTaskSources`) and
  at `:10811`; `showView` at `:10821` and `:3440`. Nothing reaches a hook before the
  highlighter section at `:4724` is evaluated, so neither `let mentionIndex` nor the
  `const mentionRaf` / boundary regexes can be touched in their TDZ. Confirmed, not
  refuted.
- **The validity engine is correct.** I ran the scanner verbatim against all nine Task-2
  cases plus the greedy/overlap ones: `@a.txt.bak` before `@a.txt`, `@my report.pdf`,
  `bob@example.com`, `@a.txt2`, `@a.txt.`/`@a.txt,`, `@README.MD`. All produce the
  asserted result. The `i = end - 1` advance genuinely prevents overlaps.
- **Performance is fine and the design is right.** Worst case at the 20 000-char cap with
  50 attached names all sharing one first-character bucket: **0.85 ms/scan**; a
  19 999-char string of pure `@` is 0.26 ms; realistic prose with 340 mentions is
  0.11 ms — and it is coalesced to once per frame. `replaceChildren` node counts stay
  under ~13 k even for pathological input, well inside engine spread limits. The three
  claimed layers (index-on-change, single pass, rAF + signature) are the right three.
- **jsdom assumptions verified empirically**: `getComputedStyle(ta).marginTop === "11px"`,
  `marginRight === "0"`, `paddingRight === "0"`, `borderLeftWidth === "medium"`
  (so `parseFloat(v) || 0` is the correct guard, and `try/catch` is correctly banned),
  `requestAnimationFrame` undefined, `replaceChildren` present, `File.prototype.text`
  present, `offsetWidth/clientWidth === 0`, `ta.style.margin = '0px'` clears the inline
  `margin-top`. jsdom 29.1.1. The `boot()`/`pickFiles` harness matches
  `test/ui-newpipeline-extras.test.mjs:13-56` verbatim. 79 test files import `app.js`
  (plan's number is exact) and the five named regression files all exist.

---

## Blocking issues

### MAJOR-1 — The wrapper's box model: the margin transfer deletes the 11px gap, and the backdrop is 6px taller than the textarea

*Location: Task 1 Step 4 (`attachMentionHighlight`, the margin-transfer loop) and Task 1 Step 3 (`.ta-hl` / `.ta-hl-back` CSS); spec §3.1 "Margin transfer".*

Measured in Chrome 151 against the real `style.css`, running the plan's
`attachMentionHighlight` verbatim on a faithful reproduction of `index.html:225-227`:

| | pane.top → textarea.top | pane height | backdrop.height − textarea.height |
|---|---|---|---|
| today | **11px** | 171 | — |
| plan as written | **0px** | 160 | **+6px** |

Two independent root causes, one shared fix:

1. **`margin-top` collapses out.** The textarea is `display:inline-block` (UA default —
   measured). Inline-level margins never collapse, which is why the inline
   `style="margin-top:11px"` at `index.html:226`/`:230` works today. Moving it onto a
   **block** wrapper makes it a collapsible block margin: it collapses through
   `.source-pane` (no border, no padding — there is no `.source-pane` rule in
   `style.css` at all) and through `.field`, then merges with the preceding sibling's
   `margin-bottom:18px` as `max(18, 11) = 18`. Net effect: the 11px simply disappears and
   the prompt box and everything below it move up 11px.
2. **`inset:0` is not the textarea's box.** Because the textarea stays `inline-block`
   inside the wrapper, the wrapper's line box adds a ~6px strut descender below it
   (body `font-size:14px`/`line-height:1.5`). The backdrop therefore paints
   `background:var(--field)` — and `#fff` under `:focus-within` — as a 6px band with its
   own `border-radius:14px` sticking out below the textarea's rounded border.

The plan's stated rationale is also factually wrong in both directions: "*Left in place
it would collapse through a wrapper that has no border or padding, and the backdrop's
top edge would land above the textarea's first line.*" Inline-block margins do not
collapse; and had the margin collapsed through, the wrapper's padding box would have
moved down **with** the textarea, so `inset:0` would still have aligned.

**Fix.** Make the wrapper's box exactly the textarea's box and keep the 11px inside the
pane. Verified starting point (measured: gap back to **11px**, `backdrop.height −
textarea.height === 0`, `backdrop.top − textarea.top === 0`):

```css
.ta-hl{position:relative;display:inline-block;width:100%;vertical-align:top;}
.ta-hl > textarea.textarea{display:block;}
```

That still leaves the pane 6px shorter than today (171 → 165), so finish the job with a
measured browser check rather than by eye. Also **replace the Task-1 test**
`assert.equal(ta.parentNode.style.marginTop, '11px')`: it asserts the implementation
detail that *causes* the regression and passes happily while the gap is gone. jsdom
cannot assert the gap, so this belongs in Task 4 Step 7 as "the prompt box and every
field below it are in exactly the same place as on `master`".

### MAJOR-2 — The scrollbar gutter goes stale on every geometry change that is not a repaint, and a stale gutter is a whole-line wrap divergence

*Location: Task 4 Step 4 (`syncMentionGutter`), plan Architecture paragraph, spec §5 "Scroll and metrics sync".*

`syncMentionGutter` runs only from `repaintMentionHighlight`, which runs only from
`input`, the four programmatic hooks, and the two reveal hooks. Nothing re-measures on a
pure geometry change. Measured cost of being wrong by the 10px scrollbar on a wrapped
prompt: `ta.scrollHeight 404` vs `back.scrollHeight 383` — a **full 21px line**, not a
sub-pixel nudge. Every mention below the first divergent wrap point then paints blue on
the wrong characters.

Real triggers, none of which fire `input`:

- **`resize:vertical` grip dragged shorter** until the content overflows → scrollbar
  appears → gutter stale. Most likely of all, since the grip is right there.
- **Window resize**, including crossing `@media (max-width:1080px)` where
  `.sidebar{display:none}` widens the column and can remove a scrollbar.
- **Poppins swapping in** (`font-display:swap`, `style.css:4-7`): alignment itself is
  safe — both layers use the same `var(--sans)` and reflow in one pass — but the line
  count changes, so a scrollbar can appear or vanish between fallback paint and webfont
  paint.
- Browser zoom / OS text-size change.

The plan's Architecture says "*resize-drag and reflow need no observers*". That is true
for the wrapper's **size** and false for the **gutter**.

Not gaps, checked and dismissed: `#source-seg` plugin buttons wrapping
(`loadTaskSources()` at `:4404`) and `<details id="advanced-config">` opening both change
vertical position only, never the textarea's width; autofill does not apply to
textareas; undo/redo, cut, drag-and-drop of text into the textarea, and IME commit all
fire `input`; the two programmatic writers are both hooked.

**Fix.** Add a geometry-only refresh that never rescans: `window.addEventListener(
'resize', ...)` plus a `typeof ResizeObserver === 'function'`-guarded observer per
textarea, both calling `syncMentionGutter` + `syncMentionScroll`. The `typeof` guard is
value-based, so it satisfies the plan's own jsdom constraint (`ResizeObserver` is simply
absent there and the branch is skipped). Add to the Task 4 Step 7 checklist: "drag the
grip shorter until a scrollbar appears — the colours must not shift; then widen the
window past 1080px and re-check."

### MAJOR-3 — Forced-colors / Windows High Contrast paints both layers' text at once and erases the blue

*Location: Task 1 Step 3 CSS; spec §3.2 "Visual contract".*

Measured with `Emulation.setEmulatedMedia { forced-colors: active }` in Chrome 151:

| element | property | value under forced colors |
|---|---|---|
| `textarea` | `color` | `rgb(0,0,0)` — **`transparent` is forced away** |
| `textarea` | `background-color` | `rgba(255,255,255,0)` — stays transparent |
| `.ta-hl-back` | `background-color` | `rgb(255,255,255)` |
| `.mention-ok` | `color` | `rgb(0,0,0)` — the blue is gone |

So in High Contrast Mode both copies of the prompt text paint on top of each other
(double-struck / smeared antialiasing, and any future sub-pixel drift doubles the text),
and the feature's only signal is removed. The spec's justification — "*There is no dark
theme in this codebase … so one palette suffices*" — conflates theming with
forced-colors; `prefers-color-scheme` and `forced-colors` are unrelated.

**Fix.** One block in Task 1 Step 3, opting the whole two-layer trick out:

```css
@media (forced-colors: active){
  .ta-hl-back{display:none;}
  .ta-hl > textarea.textarea,
  .ta-hl > textarea.textarea:focus{color:CanvasText;background:Canvas;}
}
```

Everything else about accessibility is sound: `aria-hidden="true"` on the backdrop plus
an untouched, still-focusable textarea means AT reads `.value` exactly as today, and
`caret-color:var(--ink)` keeps the caret visible.

---

## Non-blocking

### MINOR-1 — Two of the four "verify it fails" states are wrong

- **Task 2 Step 2** says "3 PASS (Task 1's), 9 FAIL". With `const marks = []` still
  hard-coded, four of the nine new tests assert `deepEqual(blues(window), [])` and
  therefore already pass: *an @ that does not start a word…*, *a mention must end on a
  boundary*, *matching is case-sensitive…*, *with no attached files nothing is
  highlighted*. True red state: **7 PASS / 5 FAIL**.
- **Task 3 Step 2** says "12 PASS, 6 FAIL" and names one already-green test. *a pasted
  prompt is validated on arrival* is also already green — its only trigger is `input`
  (wired in Task 1) and `rebuildMentionIndex` is wired in Task 2 Step 5. True red state:
  **14 PASS / 5 FAIL**.
- Task 1 Step 2 and Task 4 Step 2 are correct as stated (I traced all three Task-1 tests
  and both the XSS and no-churn tests).

This matters because an executor is instructed to verify a specific red state; a
mismatch invites "fixing" a non-bug. Correct both counts and name the already-green
tests, the way Task 3 already does for *the markdown textarea highlights on its own
input too*. It is also worth stating plainly that a negative assertion can never be a
red-first test — those four are still falsifiable (a too-greedy scanner breaks them),
they just do not drive the implementation.

### MINOR-2 — Three added behaviours are asserted nowhere, and the Self-Review overstates coverage

- The **`syncSourceToggle` hook** (Task 3 Step 4d) and the **`showView('new')` hook**
  (4e) are added with no test at all. Both are observable in jsdom: attach a file, type a
  mention in `#promptMarkdown` while its pane is hidden, remove the pill, then flip the
  `source` radio / call the nav and assert the backdrop is correct. Right now the only
  thing standing behind two of the five hooks is prose.
- `attachMentionHighlight`'s idempotency guard (`if (ta._mentionHl) return`) is untested.
- The Self-Review claims "§10 tests 1–19 … all 19 present. **No gaps.**" Spec test 19 is
  "*backdrop is a single text node*", which the mandatory trailing `<br>` makes false;
  the plan silently substitutes a different assertion. State the deviation instead of
  claiming full coverage. (The one deviation the plan *does* declare — dropping the
  hidden-pane gate — is well argued and I agree with it.)

Not an issue, for the record: *a pasted prompt is validated on arrival* does not actually
paste. jsdom cannot mutate a textarea from a `ClipboardEvent`, so value-set + `input` is
the honest model and the plan says so. Adding `inputType: 'insertFromPaste'` to the
dispatched event would document the intent at zero cost. Likewise `syncMentionScroll`
and `syncMentionGutter` are correctly left to the browser step — jsdom pins
`scrollTop`/`offsetWidth` to 0, so any assertion there would be theatre.

### SUGGESTION-1 — `sig` allocates a full copy of the prompt to decide to do nothing

`const sig = \`${marks.join(',')}|${text}\`` builds a fresh 20 000-char string plus a
joined marks string on **every** repaint, including the ones that short-circuit — so the
comment "*cost one string compare and touch no DOM*" is not quite what happens. Keeping
`st.text` and `st.marksKey` separately, and comparing `text !== st.text` first, is
strictly cheaper and identical in effect. Practically this is sub-millisecond; it is
polish, and it slightly undercuts a plan whose headline is performance.

### SUGGESTION-2 — Turn "no metric-affecting property may differ" into a runtime check

The Global Constraints list nine properties and reads as exhaustive; the real set is
about twenty (it omits `tab-size`, `text-indent`, `word-spacing`, `direction`,
`text-align`, `hyphens`, `word-break`, `font-variant`, `font-style`, `text-rendering`,
`font-kerning`). All of them happen to match today — parity comes from the shared rule
plus the shared inheritance chain, not from the list — but a future
`.textarea{letter-spacing:-.01em}` would drift the layers with nothing to catch it.
Reframe the constraint accordingly and add one line to Task 4 Step 7: with wrapped text,
`ta.scrollHeight === back.scrollHeight`. That single equality is a perfect drift
detector (it reads 404 vs 383 the moment one metric diverges, as the gutter measurement
above shows).

### SUGGESTION-3 — `mentionIndex.maxLen` is dead weight

It is only ever read as `if (!maxLen) return marks`, i.e. as "are any files attached" —
`byFirstChar.size` says the same. Either drop it, or use it for a real early-out
(`if (text.length - i - 1 < shortestNameLength) continue`).

---

## Verdict

Blocking. The design is right, the grounding is excellent, and the validity engine and
performance story hold up under measurement. What needs fixing before building is the
part jsdom cannot see: the wrapper's box model (MAJOR-1), the stale scrollbar gutter
(MAJOR-2), and forced-colors (MAJOR-3) — plus the two wrong TDD red states and the two
untested hooks. All five fixes are small and local; none of them touch the architecture.
