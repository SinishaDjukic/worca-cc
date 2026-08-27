# Code review — History diff syntax highlighting, line numbers and file tree

**Branch:** `worca/diff-highlights-and-file-structure` (3 commits on `dev`, merge-base `2b799cab`)
**Commits:** `6c50f690` feat: improve history diff viewer · `af97baea` fix: address diff viewer review findings · `18d36821` Files browser visual refinment
**Diff reviewed:** `git diff dev...HEAD` — 16 files, +2783 / −132
**Spec / plan:** `docs/superpowers/specs/2026-08-21-diff-syntax-highlight-design.md`, `docs/superpowers/plans/2026-08-21-diff-syntax-highlight-v3.md`
**Suite at HEAD:** 2994 pass / 0 fail
**Verdict:** MERGEABLE WITH FIXES — 0 critical, 13 minor. No crash, data loss, or injection path found.
The 2 major findings (sub-language grammars, 5,000-item render cap) were fixed on 2026-08-22 and removed from this document.

Note: `master` is far behind in this repository (`master..HEAD` is the entire history, 2049 files). The review base is `dev`.

## Method

Nine independent finder angles over the diff (correctness, security, performance, accessibility, CSS/layout, tests, API/server, regressions vs `dev`, conventions — the last returned empty by construction: the only CLAUDE.md in effect defines a `/graphify` trigger and nothing else). 67 raw candidates → 46 deduplicated mechanisms → 8 verifier agents, one vote each, with reproductions in node, jsdom and headless Chrome 151 over CDP where the claim is a layout claim. One candidate refuted; a sweep added 5 more, all confirmed. 15 of 49 survivors are reported below; the remaining ~34 are NITs or choices the plan mandates and are listed at the end.

Severity scale: **critical** = crash, data loss, security hole; **major** = user-visible defect or regression vs `dev` on realistic input; **minor** = real but narrow, latent, or cosmetic; **nit** = style/hygiene.

---

## MINOR

### m1 — `HUNK_RANGE_RE` rejects hunk headers whose function context contains U+2028/U+2029 or an embedded CR

**File:** `ui/public/diff-view.mjs:10`

The trailing `(?: .*)?$` uses `.`, which excludes exactly LF, CR, U+2028 and U+2029 (exhaustive scan of all 0x110000 code points). A header such as `@@ -5,7 +5,7 @@ function outer(sep = "<U+2028>") {` — produced verbatim by real `git diff` in a throwaway repo — fails `hunkRange`, so `parseFileSection` assigns `oldNo/newNo = null` to every row (lines 173-186 only number when the range exists), `eligibleSides` rejects the hunk via `validSideRange(null)`, and a single-hunk file gets both gutters blank and no highlighting. Git's default `xfuncname` matches any letter-initial line, so prose exported from Word/Pages (`.txt`/`.md`) triggers it too.

**Fix:** `(?:[^]*)?$` (or `[\s\S]*`).

### m2 — Per-hunk, per-side highlighting has no continuation state across hunk boundaries

**File:** `ui/public/syntax-highlight.mjs:203` — `const html = highlight(side.text, lang);`

Verified with the real javascript grammar: a hunk whose first context row is ` */` (closing a JSDoc block above the hunk) leaves it unclassified; a hunk whose first row is `/* disabled` paints all following real code as `hljs-comment` to the end of the hunk; a hunk starting inside a backtick template paints `const y = 2;` as `hljs-string`. The text round-trip check passes, so `highlightParsed` returns `true` and the wrong colours are committed.

Spec D2 chose per-hunk per-side highlighting; the consequence is undocumented and untested.

**Fix:** Thread hljs `continuation` (`_top`) state across consecutive hunks of the same side, or at minimum record the limitation in the spec and add a test pinning the current behaviour.

### m3 — Pane-head path renders bold after becoming an `<h3>`; head count chips shrank

**File:** `ui/public/app.js:11315`; `ui/public/style.css` rule `.hd-diff-pane-head .hd-diff-path{margin:0;…font-size:12px;}`

The companion rule resets the UA `h3` margin and font-size but leaves `font-weight:bold`. Measured in headless Chrome against the real stylesheet: `h3.hd-diff-path` → `font-weight 700 / 12px`; `dev` markup (`<span class="hd-diff-path">`, `2b799cab`) → `400 / 12.5px`. The same commit routes both head count chips through `hdFileCountsNode`'s `.hd-diff-counts` (11.5px) beside the 12.5px bold "13 files changed" label. `test/ui-diff-style.test.mjs:72-74` asserts only margin and font-size on the selector.

**Fix:** add `font-weight:400`; decide whether `.hd-diff-counts` should apply to the totals.

### m4 — Placeholder note is double-padded inside `.hd-diff-body.hint`

**File:** `ui/public/style.css:1926` — `.hd-dl-hunk,.hd-diff-note{grid-column:1/-1;padding-inline:18px;}`

Stacks on `.hd-diff-body.hint{display:block;…padding:18px;}` now that the placeholder is a child `<div class="hd-diff-note">` instead of the body's own textContent. Measured: note text inset 36px left/right, 22px top; the sibling `.hd-diff-none` empty state and the `dev` rendering both measure 18px. Triggered by selecting a binary file, a file with no hunks, or any file after a failed patch fetch. `grid-column` is inert under the parent's `display:block`.

**Fix:** `.hd-diff-body.hint .hd-diff-note{padding-inline:0}` or scope the note padding to the grid case.

### m5 — Loader memoises successes only; permanent `/vendor` failure becomes an unbounded request storm

**File:** `ui/public/hljs-loader.mjs:31` (`nextCoreAttempt++`, `nextGrammarAttempt.set(lang, attempt + 1)`, `.catch(() => null)`, `.finally` clearing the pending slot)

Verified with an always-rejecting `loadCore`: 40 selections → 80 failed imports, attempt index reaches 39, no ceiling. Realistic triggers: `resolveHljsAssets()` returned null at boot (pruned or partially installed `@highlightjs/cdn-assets` — `server.mjs` warns once and registers no routes, so `/vendor/hljs/*` 404s forever), a blocking proxy, or offline. Clicking through a 200-file diff then produces 400 doomed requests and 400 console errors, and the module map accumulates a new `?retry=N` specifier per attempt. Retry-on-next-call is tested and fine for a blip.

**Fix:** add a failure counter — give up after ~3 consecutive failures per resource (or after a core failure) for the page's lifetime.

### m6 — `sendHljsModule` flattens real 500s into a silent 404

**File:** `ui/server.mjs:617`

```js
(err) => { if (!err) return; if (res.headersSent) return next(err); next(); }
```

Discards `err.code`/`err.status`. Reproduced on the repo's express 4.22.2 / send 0.19.2 with a verbatim copy of lines 614-646: EACCES on a whitelisted grammar → callback sees status 500, `headersSent=false` → bare `next()` → `/vendor` catch-all → `404 text/plain 'Not found'`, `Cache-Control: no-store`, no log line. (The `/vendor` error middleware at 637-642 would also flatten 500→404.) Combined with m5, a botched install or restrictive umask becomes an invisible request storm with zero diagnostics.

**Fix:** log `err.code` when it is not ENOENT/ENOTDIR/ENAMETOOLONG; let genuine 500s through.

### m7 — `enhanceDiffBody` retains superseded diff DOM across the grammar await and can leak an unhandled rejection

**File:** `ui/public/app.js:11203`

```js
const loading = diffHljsLoader.forLanguage(lang);
await afterDiffPaint();
const loaded = await loading;
```

No `ownsBody()` check between the awaits and no handler on `loading` during the macrotask gap. Retention measured in jsdom through the real code path at the 5,000-item cap: 59,993 nodes / 2.6 MB per body held via `refs` (a span per row) and the `ownsBody` closure; on a cold grammar, N rapid same-language clicks all suspend on the same `languagePending` promise and hold N bodies simultaneously — bounded only by a localhost fetch today, unbounded if `/vendor` is slow or hung (no timeout; e.g. `WORCA_HOST=0.0.0.0` over LAN). A rejecting loader fires an `unhandledRejection` the call-site `.catch(() => {})` at line 11392 cannot absorb (reproduced under `node --unhandled-rejections=strict`, exit 1); no production or test loader rejects today, so it is latent through the documented `window.__worcaTestHooks.hljsLoader` seam — and the comment at `app.js:11694` names exactly this `node --test` misattribution hazard.

**Fix:**
```js
const loading = Promise.resolve(diffHljsLoader.forLanguage(lang)).catch(() => null);
await afterDiffPaint();
if (!ownsBody()) return;
```

### m8 — The lone-high-surrogate guard has zero test coverage

**File:** `test/diff-view.test.mjs:238`; guard at `ui/public/diff-view.mjs:117-119`

The new test "section cap is deliberately measured in UTF-16 code units" puts its only real assertion behind `if (parsed.hunks[0]?.lines[0])`, which is always false (the 250,010-emoji line snaps to the newline after the `@@` header, yielding zero lines). The older "no half-line at the cut" test (lines 140-147) now only sees item-cap rows. Mutation test: deleting the guard → 17/17 pass. The guard is real (on a single newline-free line the mutant leaves `len=500000` ending in `0xD83D`, `isWellFormed() === false`).

**Fix:** `parseFileSection('@@@' + '\u{1F600}'.repeat(CAP))` and assert `isWellFormed()` on the header.

### m9 — Tree buttons: `aria-label === title`, no singular form, full-path tooltip lost

**File:** `ui/public/file-tree.mjs:220`

Rendered in jsdom with `{path:'src/a.js', status:'M', added:1, removed:1}`: `ariaLabel === title === 'Modified file src/a.js, 1 lines added, 1 lines removed'`; visible text `a.js`. Per accname/HTML-AAM an identical `title` becomes the accessible description, so a screen reader announces the sentence twice; a ±1 change (the most common row) reads ungrammatically; and the mouse tooltip regressed from `dev`'s bare full path (`path.title = from ? \`${from} → ${path}\` : path`) to a sentence with the path buried mid-string while the visible label is now only the basename. `test/file-tree.test.mjs:148-150` only asserts the old path appears somewhere.

**Fix:** drop `title` (or set it to the bare full path / `from → path`); pluralise.

### m10 — 10,000 sticky gutter cells at the item cap

**File:** `ui/public/style.css:1914` — `.hd-dl-n{position:sticky;z-index:2;…}`

Applies to both gutter cells of every row (`.hd-dl-row{display:contents}` means there is no row box to stick instead), so a file at the cap puts 10,000 sticky boxes and stacking contexts inside the single `.hd-diff-body{overflow:auto}` scroller. Measured in headless Chrome at the cap: rAF frame time identical to static gutters on an M-series core (8.3ms), but at 6× CPU throttle the median frame rises to 25.1ms (p95 34ms) — ~40fps — and layout-reading scroll steps cost 0.8ms vs 0.002ms. Invisible on modern hardware; a real cliff on low-end machines or whenever anything reads layout during scroll.

**Fix:** row virtualisation / `content-visibility:auto` on hunks, or take horizontal overflow off the body so the gutters need not stick.

### m11 — `afterDiffPaint` has a TDZ hazard on synchronous timers

**File:** `ui/public/app.js:11190`

`finish` calls `win.clearTimeout(timer)` but `const timer = win.setTimeout(finish, 50)` is declared three lines later. Reproduced with `win = { setTimeout: (fn) => { fn(); return 1; }, clearTimeout(){} }` → `ReferenceError: Cannot access 'timer' before initialization` inside the Promise executor, so the promise rejects. `win` is the function's only injectable parameter and exists for exactly this kind of fake clock; the sole caller passes nothing today, so it is latent — but when it fires, `enhanceDiffBody` rejects into `.catch(() => {})` and highlighting silently never applies with a green suite. jsdom 29 has no `requestAnimationFrame`, so the rAF branch at line 11194 is production-only and untested.

**Fix:** hoist `let timer;` above `finish`.

### m12 — CR is stripped from the hunk header but kept on body rows

**File:** `ui/public/diff-view.mjs:151` — `header: structuralLine`

Verified on a CRLF section: HEAD header `'@@ -1,3 +1,3 @@ function main() {'` with `lines[0].text` `'const a = 1;\r'`; `dev` kept CR on both. Row heights are identical in Chrome so nothing shows on screen, but `Selection.toString()` over the pane returns mixed EOLs (`…@@\n const a = 1;\r\n-const b = 2;\r\n…`). The strip itself is needed — it is what makes `structuralLine === 'GIT binary patch'` work on CRLF patches, which `dev` got wrong — and it is why `syntax-highlight.mjs:116` must re-encode CR as `&#13;`.

**Fix:** store `header: line` and use `structuralLine` only for the `startsWith`/equality tests, or normalise CR once at the section boundary.

### m13 — The verbatim-copy invariant is no longer tested and its rationale comment was deleted

**File:** `ui/public/app.js:11146`

The property the deleted comment protected ("this is a verbatim patch a user may copy — a U+2212 here yields something `git apply` rejects") now rests entirely on `.hd-dl-n{user-select:none}`: `hdDiffRow` makes `row.textContent` `'2Old line 2-old'`, the old whole-row assertion was narrowed to `.hd-dl-code`, and the comment was dropped rather than relocated. Verified in Chrome: `getSelection().selectNodeContents(body).toString()` still returns the exact patch, and unprefixed `user-select` is honoured by Chrome/Firefox/Edge and Safari 17+, so nothing is broken today — but a future change to `.hd-dl-n` (or a Safari ≤16 user) would put `'1Old line 11New line 1 keep'` on the clipboard with the suite green.

**Fix:** add a jsdom/Chrome assertion on the selected text; restore the comment on `hdDiffRow`.

---

## Verified but cut (NIT or plan-mandated)

- Dead `new`/`deleted` classes and a no-op `.deleted` rule, pinned by `test/ui-diff-style.test.mjs`.
- Cross-extension renames highlight deleted lines with the new path's grammar (deliberate per test).
- The `requested !== lang` guard couples loader and highlighter ids — a future alias silently disables highlighting.
- Per-row `innerHTML` re-validation ≈ 74% of a 17ms post-paint stall at 3,000 rows.
- Five constant `data-*` attributes per row (~35k at cap, test-only readers) — plan-mandated (D11).
- sr-only gutter twins (+20k nodes at cap) — plan-mandated.
- Context lines double-counted in the input budget — plan-mandated.
- `compactDir` re-compacts (8× calls, identical output).
- Unreachable SPA `/vendor` guard and redundant `statSync` — plan prescribes both verbatim.
- Bare `hd-dl` class with no rule on every row; orphan project-group ids.
- `.hd-diff .diff-add` override is a justified WCAG fix (`--red-ink` is 4.45:1 on the hovered row) but its eight hex tokens are the stylesheet's only non-`:root` colours.
- Stale `.hd-diff-file` focus-ring comment at `style.css:2170`.
- `package-lock.json` change is benign (lock caught up with the already-declared `worca` bin); `files` includes `ui/public/` and cdn-assets is a runtime dependency, so the published package ships everything needed.

## Refuted

- `histDetailState.screen.contains(pane)` vs identity check — equivalent, because `openHistDetail` always clones a fresh screen.

## Suggested order of work

1. One-liners: m1 (regex), m3 (`font-weight:400`), m4 (note padding), m11 (`let timer`), m7 (`ownsBody` + catch).
2. m5 + m6 together (loader failure cap + server logging).
3. m2, m8, m9, m10, m12, m13 as follow-ups.
