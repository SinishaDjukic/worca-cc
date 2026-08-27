# Diff syntax highlighting, line numbers, and file tree — refined implementation plan (v2)

**Date:** 2026-08-21

**Baseline:** `2b799cab` on `dev`

**Related design:** `docs/superpowers/specs/2026-08-21-diff-syntax-highlight-design.md`

**Supersedes:** `docs/superpowers/plans/2026-08-21-diff-syntax-highlight.md`

## Outcome

Make the History detail Diff tab easier to scan without making the existing patch viewer depend on syntax highlighting:

- syntax-highlight supported text files;
- show old and new line-number gutters;
- replace the flat file list with a collapsible, project-aware file tree;
- preserve the current plain diff as the immediate and permanent fallback;
- keep file/status/count behavior and the existing patch-fetch race protection intact.

This document is an implementation plan, not authorization to implement it. The planning request permits only this v2 document. Do not commit or push. The implementation plan below also contains no commit steps; an implementation run should leave its changes uncommitted unless the user later says otherwise.

## Baseline verified during refinement

- `npm test` passes at the baseline: 2926 pass, 0 fail.
- The repository requires Node `>=22.13.0`, is ESM-only, has no browser build step, and serves `ui/public/` directly.
- `buildHdDiff` currently lives in `ui/public/app.js`; parsing is already isolated in `ui/public/diff-view.mjs`.
- The current patch pane intentionally renders hunk headers and hunk rows, not the complete `diff --git`/`---`/`+++` file patch.
- Workspace results can contain the same relative path under multiple project keys. The existing History-detail test already exercises this with `a.js` in two projects.
- The working tree contains unrelated untracked content under `docs/superpowers/` and `marketing/`. Preserve it.

Do not use fixed source line numbers as edit anchors. Find the named symbols and selectors with `rg`; the original plan's line numbers are baseline-specific.

## Corrections to the v1 plan and design assumptions

These decisions are intentional amendments where the original plan was incorrect, unsafe, or untestable.

1. **One exact runtime dependency; no duplicate provenance dependency.** Install `@highlightjs/cdn-assets@11.12.0` with an exact version. Do not add `highlight.js`. The v1 “provenance” test had invalid JavaScript, reused a mutated module instance, and proved sample-output parity rather than provenance or byte identity. Exact package metadata plus `package-lock.json` integrity and behavioral contract tests are the useful guarantees here.
2. **Only highlighter assets are lazy.** The small local support modules may be statically imported. Do not claim that the feature adds nothing to the eager path; the accurate claim is that highlight.js core and grammar modules are fetched only when a supported file is selected.
3. **Mapped languages, not every shipped language, are auto-detected.** The server may serve every shipped grammar, but `langForPath` supports a reviewed extension/name map. Every ID in that map must have a corresponding shipped grammar.
4. **Copy fidelity, not complete-patch applicability.** Selected code rows must retain their ASCII prefix and exact source text while line-number gutters stay out of selection. Do not claim the selection alone is accepted by `git apply`; the pane does not render the required file headers. A complete “Copy file patch” control is out of scope.
5. **Workspace identity is project-scoped.** A relative path is display data, not identity. Files and directories use opaque stable keys derived from project scope plus path. Selection, collapse state, DOM lookup, and future comment anchors use those keys.
6. **Directory compaction stops before a file leaf.** Collapse directory-to-directory single-child chains (`ui/public`), but keep `src` as a directory containing `x.js`; never label a directory node `src/x.js` merely because it has one file.
7. **Highlight parsing fails closed.** Invalid markup is rejected, never “sanitized” by deleting characters and never passed through to `innerHTML`.
8. **The size limit measures actual highlighter input.** Count UTF-8 bytes and side rows after building old/new hunk sides, including duplicated context, rather than JavaScript UTF-16 code units.
9. **Base rows render before highlighting completes.** A slow grammar request must not hold the pane blank. Render numbered plain rows first, then enhance the still-current pane asynchronously.
10. **Visual-tree order defines initial selection.** Directories sort before files and names sort deterministically; auto-selection chooses the first file in that rendered order. This intentionally may differ from the old results-array order and is tested explicitly.

## Architecture

Keep responsibilities narrow:

| File | Responsibility |
|---|---|
| `package.json`, `package-lock.json` | Exact `@highlightjs/cdn-assets@11.12.0` runtime dependency |
| `ui/server.mjs` | Serve only the required core module and grammar directory under `/vendor/hljs`; keep vendor misses out of the SPA fallback |
| `ui/public/diff-view.mjs` | Parse hunk ranges and attach old/new numbers to rows |
| `ui/public/syntax-highlight.mjs` (new) | Language mapping, strict highlighted-HTML row balancing, UTF-8 work limits, per-side/per-hunk highlighting |
| `ui/public/hljs-loader.mjs` (new) | Retryable lazy loading and successful-load caching for core/grammars |
| `ui/public/file-tree.mjs` (new) | Project-scoped tree model and accessible DOM renderer |
| `ui/public/app.js` | Build the tree and diff DOM, render plain rows immediately, then apply highlighting if still current |
| `ui/public/style.css` | Tree layout, three-column diff grid, sticky gutters, accessible token colors |

No changes are required in `ui/public/index.html`.

## Global implementation constraints

- Node `>=22.13.0`; ESM only; no build/generation/vendoring step.
- No `git add`, commit, push, reset, or cleanup of unrelated user files.
- Preserve the current `/diff` endpoint, patch artifact, and results payload shapes.
- Preserve ASCII `+`, `-`, and leading space in patch-body code text. U+2212 remains limited to count chips.
- Line numbers and the tree must work when highlighting is unavailable.
- Any highlighter failure must leave already-rendered plain rows intact.
- Keep the existing one-fetch `patchPromise` and `selEpoch` behavior; extend the epoch guard to asynchronous enhancement.
- Use targeted tests while working. Run the full suite after server delivery, after UI integration, and once at the end; require zero failures, not a hard-coded total.

---

## Task 1 — Add the exact dependency and narrow asset delivery

**Files**

- Modify `package.json`
- Modify `package-lock.json`
- Modify `ui/server.mjs`
- Create `test/api-hljs-assets.test.mjs`

### 1.1 Install exactly the reviewed artifact

Run:

```bash
npm install --save-exact @highlightjs/cdn-assets@11.12.0
```

Verify:

- `dependencies["@highlightjs/cdn-assets"]` is exactly `11.12.0`;
- `highlight.js` was not added anywhere;
- `package-lock.json` contains the resolved tarball and integrity hash.

### 1.2 Resolve and expose only required assets

In `ui/server.mjs`, use `createRequire(import.meta.url)` to resolve the installed `es/core.min.js`, then derive its sibling `languages/` directory.

Register the vendor routes after the localhost request guard and before the public static middleware:

- `GET /vendor/hljs/core.min.js` serves only the resolved core file;
- `GET /vendor/hljs/languages/:file` serves only an existing filename matching `^[a-z0-9-]+\.min\.js$` from the resolved language directory;
- no package root, `package.json`, non-minified build, source map, or directory listing is exposed.

If resolution fails, log one concise warning and leave the routes unavailable. Do not crash the rest of the UI. Keep path construction confined to the validated filename and the already-resolved grammar directory.

Reserve both the exact `/vendor` path and every `/vendor/…` path in the SPA fallback. A vendor miss must reach Express's 404 handling, never `index.html`.

### 1.3 Asset-delivery tests

Use the existing ephemeral `http.Server` pattern from the API tests. Cover:

- core returns 200, JavaScript MIME, and a real ESM default export;
- every mapped grammar ID (import `SUPPORTED_LANGUAGE_IDS` once Task 3 exists) returns 200, JavaScript MIME, and a default export; use one representative grammar in Task 1 and tighten this assertion after Task 3;
- a nonexistent grammar returns 404 and not HTML;
- `/vendor`, `/vendor/`, `/vendor/hljs/`, `/vendor/hljs/package.json`, and a non-minified grammar return 404;
- `index.html` contains no highlighter script tag;
- the ordinary SPA fallback still returns `index.html` for a normal client route.

Run:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/api-hljs-assets.test.mjs
npm test
```

---

## Task 2 — Make diff line numbers part of the parser model

**Files**

- Modify `ui/public/diff-view.mjs`
- Modify `test/diff-view.test.mjs`

### 2.1 Contract

Export:

```text
hunkRange(header) -> {
  oldStart, oldCount, newStart, newCount
} | null
```

Rules:

- accept standard unified headers shaped like `@@ -a[,b] +c[,d] @@` with optional trailing context;
- omitted counts mean 1;
- zero starts/counts for new and deleted files are valid;
- every parsed start/count must be a nonnegative `Number.isSafeInteger`; otherwise return `null` rather than render imprecise line numbers;
- malformed and combined-diff headers return `null` rather than guessed values.

Extend each parsed hunk with the four range values when its header parses. Extend every hunk line with:

```text
oldNo: number | null
newNo: number | null
```

Numbering rules:

- context consumes and displays both counters;
- deletion consumes/displays only the old counter;
- addition consumes/displays only the new counter;
- `\ No newline at end of file` is not a source row and advances neither counter;
- a malformed header produces `null` numbers for the whole hunk;
- counters reset at every hunk;
- truncation may end a hunk early, but all retained row numbers remain sequential.

Keep counters local to `parseFileSection`; do not attach scratch `_o`/`_n` fields and delete them later.

### 2.2 Tests

Add cases for:

- explicit and omitted counts;
- `-0,0` and `+0,0` ranges;
- integers beyond JavaScript's safe range staying unnumbered;
- context/delete/add sequencing;
- two hunks resetting to unrelated ranges;
- malformed headers staying unnumbered;
- the no-newline marker not advancing either side;
- a truncated section retaining correct numbers for retained rows;
- all existing `kind` and `text` behavior remaining unchanged.

Run:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/diff-view.test.mjs
```

---

## Task 3 — Build a strict, DOM-free syntax-highlighting module

**Files**

- Create `ui/public/syntax-highlight.mjs`
- Create `test/syntax-highlight.test.mjs`

### 3.1 Public contract

Export:

```text
langForPath(path) -> canonical language id | null
SUPPORTED_LANGUAGE_IDS -> frozen array of every canonical id the map can return
rowsFromHtml(html) -> string[] | null
highlightHunk(hunk, lang, highlight) -> boolean
highlightParsed(parsed, lang, highlight) -> boolean
MAX_HIGHLIGHT_INPUT_BYTES = 100_000
MAX_HIGHLIGHT_INPUT_ROWS = 3_000
```

`highlight(text, lang)` is injected and returns highlight.js HTML. This module never imports highlight.js.

### 3.2 Language mapping

Map reviewed extensions and extensionless names to canonical grammar filenames. Preserve the useful mappings from v1 (`jsx` to `javascript`, `tsx` to `typescript`, `toml` to `ini`, `html`/`svg`/`vue` to `xml`, and so on), but do not describe unmapped grammars as auto-detectable.

Requirements:

- case-insensitive extension and basename matching;
- dotfiles without a reviewed name return `null`;
- unsupported/binary extensions return `null`;
- every value in `SUPPORTED_LANGUAGE_IDS` must import successfully from `@highlightjs/cdn-assets/es/languages/<id>.min.js` in the test suite.

### 3.3 Strict row balancing

highlight.js may wrap a token around a newline. `rowsFromHtml` must close the open spans at the end of one visual row and reopen them on the next.

Treat the highlighter output as a narrow grammar, not arbitrary HTML. Accept only:

- exact `<span class="…">` open tags whose first class is `hljs-*` and whose class tokens contain only ASCII letters, digits, `_`, and `-`;
- balanced `</span>` close tags;
- newlines;
- already-escaped text containing no raw `<`.

Reject by returning `null` on:

- a non-string highlighter result;
- any other tag or raw `<`;
- attributes other than the one valid `class` attribute;
- an invalid class string;
- an unmatched close or unclosed span.

Do not rewrite an invalid class into a valid-looking class. A rejected result causes plain fallback for that hunk.

### 3.4 Per-hunk, per-side highlighting

For each hunk:

- old input is `context + deletion` rows joined with `\n`;
- new input is `context + addition` rows joined with `\n`;
- invoke the injected highlighter once per nonempty side;
- validate and split both sides before mutating any line;
- assign deletion markup from the old side;
- assign context and addition markup from the new side;
- on any throw, invalid markup, or row-count mismatch, assign no markup in that hunk and return `false`.

Fallback is atomic per hunk, not per file: one malformed hunk stays wholly plain without removing valid markup from independent hunks. Test that mixed outcome explicitly.

Before highlighting a parsed file, measure the actual old/new inputs across all hunks:

- UTF-8 bytes via `TextEncoder`, including join newlines and duplicated context;
- side-row count, also including duplicated context.

If either limit is exceeded, perform no highlighter calls and leave all rows plain.

### 3.5 Tests

Use the runtime package's core plus a small set of registered grammars for behavioral tests. Cover:

- representative path/name mappings and exhaustive importability of every mapped ID;
- exact-boundary and over-boundary UTF-8 limits, including multibyte text;
- one output row per source row and exact DOM `textContent` round-trip;
- multiline comments, strings/template literals, and nested spans;
- context receiving new-side markup while deletion receives old-side markup;
- partial/illegal hunk fragments using `ignoreIllegals: true` in the injected closure;
- thrown highlighter, row mismatch, invalid class, unbalanced spans, raw `<img>`, and forged attributes all falling back transactionally;
- a valid first hunk plus invalid second hunk preserving the first and leaving the second wholly plain;
- empty sides and empty hunks;
- unsupported language/no highlighter as no-ops.

For hostile source tests, parse each validated row in jsdom and assert:

- exact source `textContent` survives, including words such as `onload` when they were source text;
- every created element is a `span`;
- every element has only a safe `class` attribute;
- no `img`, `script`, `svg`, `iframe`, event attribute, or other executable DOM exists.

Do not use substring assertions that ban words present in the source.

Run:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/syntax-highlight.test.mjs
```

---

## Task 4 — Add a retryable lazy-loader

**Files**

- Create `ui/public/hljs-loader.mjs`
- Create `test/hljs-loader.test.mjs`

### 4.1 Contract

Export a factory with injectable module-loading functions:

```text
createHljsLoader({ loadCore?, loadGrammar? })
  -> { forLanguage(lang) -> Promise<{ lang, highlight } | null> }
```

Browser defaults dynamically import:

- `/vendor/hljs/core.min.js`;
- `/vendor/hljs/languages/<lang>.min.js`.

The returned `highlight` closure always calls `hljs.highlight` with `ignoreIllegals: true`.

Loader requirements:

- validate the language ID before interpolating it into a URL;
- deduplicate concurrent core and same-grammar requests;
- cache successful core/grammar loads;
- remove failed promises from caches so a later selection retries;
- gate `highlight` behind a successful `getLanguage(lang)`;
- catch import rejection, invalid module shape, `getLanguage` throws, and `registerLanguage` throws;
- return `null` for every failure; never reject into the pane renderer.

The app may provide a test-only injected core through a loader hook. Keep that seam clearly test-only; highlight.js is not exposed as a production browser global.

### 4.2 Tests

With injected loaders, cover:

- no grammar import when already registered;
- one core fetch and one grammar fetch across repeated/concurrent calls;
- core failure followed by a successful retry;
- grammar failure followed by a successful retry;
- bad module/default export;
- throwing `getLanguage` and `registerLanguage`;
- invalid language IDs never reaching the loader;
- returned closure passing `ignoreIllegals: true`.

Run:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/hljs-loader.test.mjs
```

---

## Task 5 — Build a project-scoped, accessible file tree

**Files**

- Create `ui/public/file-tree.mjs`
- Create `test/file-tree.test.mjs`

### 5.1 Model contract

Export:

```text
buildFileTree(rows) -> node[]
renderFileTree(nodes, { doc, onPick, counts, initialKey }) -> Element
firstFile(nodes) -> file node | null
fileStatus(entry) -> add | del | mod
```

Every node has a stable opaque `key`. Build it from a tuple that includes project scope, node type, and full relative path; a JSON-encoded tuple is sufficient. Keep `name`, `path`, and `project` as separate display/data fields. Never use a CSS selector containing an untrusted path to recover a node.

Tree rules:

- workspace project keys are non-collapsible root scopes;
- directories sort before files;
- names use one documented deterministic comparison with a raw-string tie-break, independent of process locale;
- only directory-to-directory single-child chains collapse;
- file leaves always keep their basename;
- the same relative path in two projects produces distinct file keys and distinct directory keys;
- `firstFile` follows rendered tree order.

### 5.2 Renderer contract

Build the branch DOM once. Collapse/expand by toggling the relevant child group instead of repainting the entire host.

Use native `<button type="button">` rows (or implement the full equivalent keyboard semantics if a non-button is retained). Requirements:

- the host is a navigation region labeled “Changed files”; do not claim ARIA `tree` semantics unless the complete arrow-key tree interaction is implemented;
- directory controls expose `aria-expanded` and an accessible full-path/project label;
- file controls retain `.hd-diff-file`, expose status and full path in their accessible name, and use `aria-current="true"` for the one active file;
- decorative SVGs are `aria-hidden="true"`;
- `onPick` receives the exact entry captured for that file node, not the result of a path-only lookup;
- selecting a file clears the old active state and activates exactly one row;
- collapsing a branch does not clear selection or repaint the diff pane;
- collapse state is independent for identically named directories in different projects;
- count chips are supplied by the caller and remain results-shape agnostic.

### 5.3 Tests

Cover:

- directory/file ordering and `ui/public`-style chain collapse;
- a branching directory that must not collapse;
- a directory containing one file remaining `src` -> `x.js`;
- deterministic ordering with case/numeric near-misses;
- project roots and duplicate relative file paths;
- duplicate `src` directories collapsing independently;
- exactly one active duplicate-path row;
- clicking project B's duplicate path returning project B's entry;
- click activation and native button/ARIA contracts;
- active selection surviving collapse/expand;
- new/deleted/modified status and count-chip placement, including `status:'A'` when `isNew` is false;
- quotes, backslashes, and other selector-sensitive path characters not breaking selection or focus;
- empty input and `firstFile` behavior.

Run:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/file-tree.test.mjs
```

---

## Task 6 — Integrate plain-first rows, asynchronous highlighting, and the tree

**Files**

- Modify `ui/public/app.js`
- Modify `test/ui-history-detail.test.mjs`

### 6.1 Update existing tests before changing the renderer

Locate affected assertions by selector and intent, not by old line number or a claimed count.

- Reads of an add/delete row's content should target `.hd-dl-code` after the new DOM exists.
- Hunk-header text and “row is absent” assertions remain unchanged.
- Tree file labels are basenames; tests that need identity should locate a row by scoped key/project plus full path, not full visible text or array position.
- Hoist and reuse the existing workspace duplicate-path fixture rather than introducing a conflicting second fixture.
- Keep summary counts consistent with the file arrays.

### 6.2 Row DOM contract

Create one helper that renders a parsed line as:

```html
<div class="hd-dl hd-dl-<kind>"
     data-file-key="…" data-project="…" data-path="…"
     data-old-path="…" data-new-path="…"
     data-old="…" data-new="…">
  <span class="hd-dl-n hd-dl-n-old">…</span>
  <span class="hd-dl-n hd-dl-n-new">…</span>
  <span class="hd-dl-code"><span class="hd-dl-sign">+</span>source</span>
</div>
```

Requirements:

- blank gutter values render as empty strings;
- gutter cells are excluded from text selection;
- numbered gutter cells have an explicit accessible label such as “Old line 12”; blank cells are hidden from assistive technology;
- `.hd-dl-code.textContent` is exactly the ASCII sign/space plus original source text before and after highlighting;
- only HTML accepted by `rowsFromHtml` may be assigned through `innerHTML`;
- hunk headers contain no gutter cells and span the full grid;
- anchors include the project-scoped file key, not only the relative path;
- rename-aware anchors carry the section's old and new paths separately. For non-renames they are equal; for a row absent on one side, its line number is blank but the section path remains available.

Compute one shared gutter width from the widest retained old/new number. Keep the global border-box rule in mind when including padding.

### 6.3 Plain-first enhancement flow

After the patch fetch and `selEpoch` check:

1. parse the selected section;
2. render and append numbered plain rows immediately;
3. retain the line-to-code-cell association needed to update markup;
4. start `loader.forLanguage(langForPath(path))` without delaying the base pane;
5. when it resolves, verify the selection epoch still matches and the body is still the selected connected body;
6. call `highlightParsed` and update only code content for rows with validated markup;
7. preserve the sign node, exact `textContent`, tint, numbers, scroll position, and focus;
8. catch every enhancement error and leave plain rows untouched.

A failed load is not cached permanently by Task 4, so reselecting later may retry. A stale completion from file A must never mutate file B.

### 6.4 Replace the flat list

Build the tree from `hdDiffFileRows(results)`. Render count chips with the existing `hdFileCountsHtml`. Select `firstFile(tree)` by its scoped key. The existing async `select` function remains the only code that paints the pane.

Preserve:

- one patch fetch shared by concurrent selections;
- patch-fetch retry after a failure;
- pane-head full path and rename title;
- binary/no-textual-diff/empty states;
- U+2212 only in count displays;
- exact project + path lookup through `sectionKey(entry.project, entry.f.path)`.

### 6.5 Integration tests

Add or adapt tests for:

- both gutters on context/delete/add rows and multiple hunks;
- scoped `data-file-key`, `data-project`, `data-path`, `data-old-path`, `data-new-path`, `data-old`, and `data-new`, including a rename fixture;
- hunk and truncation rows spanning all columns;
- plain numbered rows appearing while a deferred highlighter is still pending;
- successful highlighting adding token spans without changing code text;
- missing/unknown/throwing/invalid/oversized highlighting leaving plain rows;
- a stale highlighter completion not changing the newer selection;
- file tree shape, counts, status, and visual-order auto-selection;
- workspace duplicate paths: exactly one active row, selecting the second project renders its patch, and collapse state is independent;
- patch fetch still happening once during rapid selection;
- patch-fetch retry still working;
- binary and missing-patch rows found by identity rather than sorted position.

Run:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test \
  test/ui-history-detail.test.mjs test/diff-view.test.mjs \
  test/syntax-highlight.test.mjs test/hljs-loader.test.mjs test/file-tree.test.mjs
```

---

## Task 7 — Finish layout, contrast, and interaction styling

**Files**

- Modify `ui/public/style.css`
- Create `test/ui-diff-style.test.mjs` or extend the most relevant existing CSS contract suite

### 7.1 Diff grid

Convert `.hd-diff-body` to aligned old-number/new-number/code columns while preserving the existing “widest code row sizes the tint band” invariant.

Required behavior:

- `.hd-dl` contributes its cells to the parent grid;
- hunk headers use `grid-column:1/-1`;
- `.hd-diff-trunc` also uses `grid-column:1/-1`;
- number gutters are sticky with explicit opaque backgrounds and a `z-index` above scrolling code;
- the second gutter's `left` equals the computed gutter width;
- add/delete tint is painted on all three cells because `display:contents` has no paint box;
- the code column stretches across the pane and remains horizontally scrollable;
- reduced-motion behavior remains unchanged.

### 7.2 Token colors

Do not copy the v1 color table unchanged. Several proposed colors fail WCAG 2.1 AA at 12px on the add/delete tints. Define a small scoped diff-token palette whose foregrounds have at least 4.5:1 contrast against all backgrounds on which they can appear:

- `--panel` (`#FFFFFF`);
- `--green-bg` (`#E2F3DF`);
- `--red-bg` (`#FBE3E0`).

Use `--ink-2`, not `--ink-3`, for visible gutter numbers unless a separately tested color is chosen. Starting candidates that clear the tinted backgrounds include `#5B6167` for comments/punctuation, `#B31D28` for keywords/deletions, and `#9A3E00` for types; verify every final token, do not assume these cover the full table.

Add an automated WCAG relative-luminance/contrast test that reads the actual CSS colors and proves every syntax/gutter foreground meets 4.5:1 on its possible backgrounds.

### 7.3 File tree styling

Style the native row buttons without browser-default borders/background/font while retaining a visible focus ring. Keep indentation, chevrons, status colors, truncation, and count alignment.

Remove or override the old `direction:rtl` plus LRM `::before` workaround for tree file names. Tree leaves display basenames, so they use normal LTR ellipsis; full paths remain available in title/accessibility text and in the pane head.

Test structural CSS invariants without matching one large minified rule verbatim. Read the relevant rule bodies and assert the individual properties that protect layout, tint, sticky gutters, truncation span, focus, and LTR leaf names.

Run:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test \
  test/ui-diff-style.test.mjs test/ui-history-detail.test.mjs
npm test
```

---

## Task 8 — Real-browser verification and final audit

Automated jsdom tests cannot prove module fetches, sticky positioning, selection/clipboard behavior, or visual contrast in the rendered page. Start the server in a controlled terminal, perform the checks, then stop it; do not leave `npm start` running.

Verify in a real browser:

1. Open History -> completed run -> Diff. Numbered plain rows appear immediately; supported files become highlighted without a pane rebuild.
2. Context rows show both numbers; deletions only old; additions only new; a second hunk resets correctly.
3. A wide file scrolls horizontally while both opaque gutters remain pinned above the code.
4. Add/delete tint reaches the full code width, including the longest row.
5. Selecting visible code rows copies ASCII prefixes and exact source text without gutter numbers. Record this as row-copy fidelity, not a complete appliable patch.
6. `.js`, `.py`, `.rs`, and `.go` selections fetch core once and each needed grammar once from `/vendor/hljs/`; an unmapped/binary file makes no grammar request.
7. Temporarily force a grammar request to fail, reselect the file, and confirm plain fallback followed by a retry rather than a permanently cached failure.
8. Select two workspace files with the same relative path. Only one is active, and each renders the correct project's section.
9. Collapse the same-named directory under one workspace project. The other project's branch remains expanded and the pane selection remains intact.
10. Keyboard through directory and file buttons. Focus remains visible, directory state is announced, and the active file exposes `aria-current` plus status/path.
11. Check the pane at 200% zoom as well as a narrow viewport; controls, gutters, and tree rows remain reachable without clipping.
12. Check dotfiles, long basenames, a truncated large file, and add/delete syntax colors.

Final commands:

```bash
npm test
git diff --check
git status --short
git diff -- package.json package-lock.json ui/server.mjs ui/public/diff-view.mjs \
  ui/public/syntax-highlight.mjs ui/public/hljs-loader.mjs ui/public/file-tree.mjs \
  ui/public/app.js ui/public/style.css test/
```

Expected final state:

- all tests pass with zero failures;
- no generated or vendored highlighter files exist in the repository;
- only the planned implementation/test files and the exact dependency lock changes are present, aside from pre-existing user files;
- no commit or push has been made.

## Failure and degradation matrix

| Condition | Required result |
|---|---|
| Package cannot be resolved at server boot | One warning; app otherwise starts; vendor requests 404; Diff remains plain |
| Vendor path or grammar is missing | Clean 404, never SPA HTML |
| File extension/name is unmapped | No highlighter request; numbered plain rows |
| Core/grammar is slow | Numbered plain rows are already visible |
| Core/grammar import fails | Plain rows; cache entry cleared so a later selection retries |
| Module shape, registration, or language lookup is invalid | Plain rows; no rejection escapes |
| Highlighter throws or emits invalid markup/misaligned rows | That hunk remains entirely plain |
| Actual side inputs exceed byte/row limit | No highlighter calls; whole selected file remains plain |
| User selects another file during load | Old completion is dropped by epoch/body checks |
| Duplicate workspace paths/directories | Scoped selection, lookup, anchors, and collapse remain independent |
| Patch fetch fails | Existing per-file error and retry behavior remains unchanged |

Residual risk: highlight.js lexing is synchronous on the browser main thread. The UTF-8 byte/side-row guard sharply bounds normal work but is not a hard execution-time guarantee for every grammar/input pair. Keep the limits centralized and treat a future worker-based highlighter as a separate performance project if browser measurements show jank.

## Definition of done

- Exact dependency and narrow vendor delivery are tested.
- Parser-produced dual line numbers are correct across real unified-diff edge cases.
- Highlighting is lazy, retryable, strict, bounded by actual UTF-8 work, and never blocks base rendering.
- No unvalidated highlighter HTML reaches the DOM.
- Tree identity is correct for duplicate workspace paths and accessible interaction is preserved.
- Line anchors include project-scoped file identity.
- Copy fidelity is stated and tested honestly.
- Sticky gutters, tint width, truncation layout, basename direction, and token contrast have regression coverage.
- Targeted tests, the full suite, and the real-browser checklist pass.
- Changes remain uncommitted and unpushed.
