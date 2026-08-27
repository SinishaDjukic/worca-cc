# Syntax-highlighted diff with line numbers and a file tree (History detail)

**Date:** 2026-08-21
**Branch:** `dev`
**Baseline commit:** `2b799cab`
**Status:** approved design, ready for implementation planning
**Highlighter:** `@highlightjs/cdn-assets` — switched from Prism after evaluation; see §10

---

## 1. Problem

The History detail Diff tab (`ui/public/app.js:11101` `buildHdDiff`) renders a
unified patch as flat monospace rows: one `<div class="hd-dl">` per line, tinted
green for adds and red for deletes, with the raw `+`/`-` prefix inside the text.
Files are picked from a flat list of full paths.

Three things are missing against the GitHub view:

1. **No syntax highlighting.** On a 300-row patch the only visual signal is the
   add/delete tint.
2. **No line numbers.** The `@@` header carries the ranges, but individual rows
   don't, so a finding at "line 217" cannot be located by eye.
3. **The file list is flat.** Four unrelated full-path strings with no structure.

## 2. This supersedes D4

`docs/superpowers/specs/2026-08-18-history-detail-redesign-design.md:23` locked
**D4: "Diff viewer: full patch viewer, no syntax highlighting … Vanilla, no new
dependencies."** Reversed here, deliberately. Two consequences:

- `ui/public/style.css:1911` justifies the single-column grid partly with *"D4
  forbids syntax highlighting, so this tint is the pane's only visual signal —
  it has to hold."* The tint invariant it protects **still holds** and is
  re-verified in §5.
- "No new dependencies" is reversed to exactly one runtime dependency,
  `@highlightjs/cdn-assets`, plus one devDependency, `highlight.js`, used only
  by a provenance test.

## 3. Locked decisions

| # | Decision |
|---|---|
| **D1** | **highlight.js ships as `@highlightjs/cdn-assets`**, a real npm `dependency`. `ui/server.mjs` mounts the installed package at `/vendor/hljs`; the browser reaches it with **native dynamic `import()`** — no `<script>` tag, no global, no plugin. Nothing is vendored or generated. |
| **D2** | **Per-hunk, per-side highlighting.** For each hunk, the old side (ctx+del) and the new side (ctx+add) are each joined and highlighted once, then split back into rows. Multi-line constructs stay correctly coloured within a hunk. |
| **D3** | **Every language highlight.js ships** is reachable: `es/core.min.js` (20.5 KB) carries **no** grammars, and each of the 193 `es/languages/*.min.js` files is dynamically imported the first time a file needs it. |
| **D4** | **The flat file list is replaced by a GitHub-style tree.** Single-child directory chains collapse into one row (`ui` + `public` → `ui/public`); directories sort before files; each file carries a status icon. |
| **D5** | **Dual line-number gutters**, GitHub-style. Context rows carry both numbers, deletes only the old, adds only the new. |
| **D6** | **Copying a diff still yields an appliable patch.** Gutters are `user-select:none`; the `+`/`-` sign stays inside the code cell's text. |
| **D7** | **Highlighting is strictly an enhancement.** Missing library, unknown extension, oversized section, failed grammar fetch, or a throw — all degrade to today's plain rows. The Diff tab never fails because of highlighting. |
| **D8** | **The highlighting module is pure and injected.** `syntax-highlight.mjs` receives a `highlight(text, lang) -> htmlString` function; it never imports highlight.js. The browser injects the dynamically-imported instance, node tests inject their own. |
| **D9** | **Workspace runs put the project key at the tree root.** `.hd-diff-proj` is retired. |
| **D10** | **Tree collapse state is per-screen and in-memory.** Expanded by default. Nothing persisted. |
| **D11** | **Every diff row carries `data-path`, `data-old`, `data-new`.** Costs nothing now and is the anchoring substrate a future line-comments feature needs. |

## 4. Components

```
ui/server.mjs            + express.static mount of the cdn-assets package dir
ui/public/diff-view.mjs  + hunk range parsing and per-row old/new line numbers
ui/public/syntax-highlight.mjs   NEW — pure: langForPath, rowsFromHtml, highlightHunk
ui/public/file-tree.mjs          NEW — pure build + DOM render of the tree
ui/public/app.js         buildHdDiff rewires to tree + numbered, highlighted rows
ui/public/style.css      3-column diff grid, .hljs-* token colours, tree rows
```

`ui/public/index.html` is **not touched** — there is nothing to add to it.

### 4.1 `syntax-highlight.mjs` (new, pure)

- `langForPath(path) -> string|null` — extension → highlight.js language id.
- `rowsFromHtml(html) -> string[]` — one HTML string per source line.
  highlight.js emits a controlled subset (`<span class="hljs-x">`, `</span>`,
  escaped text), so a single regex walk with a stack of open classes closes the
  spans at each `\n` and reopens them on the next row. Class names are filtered
  to `[A-Za-z0-9 _-]` before being re-emitted.
- `highlightHunk(hunk, lang, highlight) -> boolean` — D2. Assigns `line.html`.
  Returns false and assigns nothing when the row count does not match the line
  count, so a surprise degrades instead of shifting colours onto wrong lines.
- `highlightParsed(parsed, lang, highlight) -> boolean` — applies the size guard
  once (100 KB / 3000 rows), then every hunk.

### 4.2 `diff-view.mjs` (extended)

`parseFileSection` gains, per hunk, `oldStart`/`newStart` parsed from
`@@ -a[,b] +c[,d] @@` (an omitted count means 1), and per line `oldNo`/`newNo`.
Purely additive.

### 4.3 `file-tree.mjs` (new)

- `buildFileTree(rows) -> node[]` — pure; directories first, then files, both
  alphabetical, single-child chains collapsed (D4), project keys as roots (D9).
- `renderFileTree(nodes, {doc, onPick, counts, initialPath}) -> Element` — the
  tree owns the selection by path, so a folder toggle repaints without losing it.
  **File rows keep the `hd-diff-file` class**, so existing selection CSS, focus
  styling and test helpers keep working.

### 4.4 Row DOM

`.hd-diff-body` becomes a three-column grid — `max-content max-content
minmax(max-content,1fr)`. Each `.hd-dl` is `display:contents`, so its three cells
are the grid's items and the columns align across every row. Tint moves from the
row to the cells. Gutters are `position:sticky`.

## 5. The tint invariant

`style.css:1903-1911` records a measured regression: `width:max-content` sized
each row by its own content, producing 11 different widths in a 336-row patch and
tint bands that stopped mid-pane. The fix was one `minmax(max-content,1fr)`
column plus stretch.

Under the new grid the code column keeps exactly that sizing and the cells still
stretch, so the widest row still sizes the column and every tint band still spans
it. A regression test pins this.

## 6. Degradation (D7)

| Condition | Result |
|---|---|
| `import('/vendor/hljs/…')` fails (jsdom, mount missing, offline) | plain rows, tint and numbers intact |
| Extension not mapped to a language | plain rows |
| A grammar module fails to import | plain rows for that file |
| Section > 100 KB or > 3000 rows | plain rows |
| `highlight` throws, or row counts misalign | plain rows for that hunk |
| `require.resolve('@highlightjs/cdn-assets')` fails at server boot | no mount; `/vendor/*` 404s cleanly; plain rows |

Line numbers and the file tree do **not** depend on the highlighter.

## 7. Testing

| File | Covers |
|---|---|
| `test/api-hljs-assets.test.mjs` (new) | the mount serves core + a lazy grammar; a miss 404s instead of falling through to `index.html` |
| `test/hljs-provenance.test.mjs` (new) | the served cdn-assets build is byte-identical to mainline `highlight.js` at the same version |
| `test/syntax-highlight.test.mjs` (new) | row splitting, multi-line comment and template literal, escaping, exact text round-trip, unknown language, size guard, misalignment bail |
| `test/file-tree.test.mjs` (new) | chain collapsing, ordering, workspace roots, render depth, chevron toggle, `hd-diff-file` retention |
| `test/diff-view.test.mjs` (extended) | `@@` range parsing including omitted counts, per-row numbering |
| `test/ui-history-detail.test.mjs` (extended) | gutters, sign inside `.hd-dl-code`, comment anchors, highlighted output when a highlighter is injected, plain fallback when it is not, tree replaces the list, tint invariant |

## 8. Out of scope

- The `↕` expand-unchanged-context rows (needs a new endpoint reading file
  contents at the run's commit, with its own caching and archived-run behaviour).
- Word-level intra-line diffing; side-by-side view; a tree filter box.
- Line comments themselves — D11 only lays the anchors.
- Persisting tree collapse state or the selected file.
- Any change to the patch artifact, the `/diff` endpoint, or `results` shape.

## 9. Measured facts

Established empirically on 2026-08-21. The plan depends on these; do not
re-derive them.

**Delivery**
- `@highlightjs/cdn-assets@11.12.0` ships `es/` as **real, self-contained browser
  ESM** — `export { highlight as default }`, **zero bare imports** anywhere in the
  tree. Node imports the identical files, so browser and tests share one artifact.
- `es/core.min.js` is **20.5 KB and registers no grammars** (`listLanguages()` is
  `[]`). All 193 `es/languages/*.min.js` are imported on demand.
- The mainline `highlight.js` package cannot serve this role: its `es/core.js` is
  a 202-byte shim importing `../lib/core.js`, which is CommonJS.
- **`highlight()` throws `Error: Unknown language` for an unregistered id** and
  logs a console warning — always gate on `getLanguage(id)` first.

**Provenance**
- `@highlightjs/cdn-assets` and `highlight.js` share the **same four npm
  maintainers** (`marcosc`, `joshgoebel`, `isagalaev`, `highlightjs_bot`), the
  same `repository.url`, and the **same npm signing key**
  (`SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`).
- Output is **byte-identical** between the two packages at `11.12.0`, including
  the HTML-escaping path. Pinned by `test/hljs-provenance.test.mjs`.
- Caveat accepted: cdn-assets is ~64k weekly downloads vs highlight.js's 26.6M.
  The provenance test is the mitigation.

**Safety**
- Both candidate pipelines were fed five hostile source lines (`<img onerror>`,
  `</span><script>`, `"><svg onload>`, `<iframe src=javascript:>`, span
  breakout) and parsed into a real DOM: **zero non-`<span>` elements created,
  zero non-`class` attributes, exact text round-trip**.
- highlight.js escapes inside the library (`.value` is pre-escaped), so our code
  passes its HTML through rather than owning the escaping.
- Advisory history: highlight.js has 2 published advisories (both medium, both
  2020); Prism has 6 (4 high, 2 medium, most recent 2025-03). Neither project's
  advisories touch the APIs used here. The live risk class for any regex lexer is
  ReDoS, bounded here by the 100 KB / 3000-row guard and by the input being the
  user's own diffs on a localhost-only single-user tool.

**Algorithms** (prototyped, output verified)
- `rowsFromHtml` on a 3-line block comment plus a template literal with a nested
  `${}` spanning a line break: 6 rows, every row's spans balanced, exact text
  round-trip.
- `buildFileTree` reproduces the reference screenshot, including `ui` + `public`
  collapsing to `ui/public` while a `src` holding both `deep/` and `x.js` does not.

**Language ids** — resolved against the shipped file list:
`jsx`→`javascript`, `tsx`→`typescript`, `toml`→`ini`, `json5`/`jsonc`→`json`,
`vue`→`xml`, `yml`→`yaml`, `md`→`markdown`, `sh`/`zsh`→`bash`. **No grammar for
`hcl`/`tf`** — those render plain.

**Context**
- Current eager payload: `app.js` 647 KB, `style.css` 183 KB. Nothing is added to
  the eager path at all, because there is no `<script>` tag.

## 10. Clarifications answered

- **Highlighter** — Prism was specced first, then replaced with highlight.js via
  `@highlightjs/cdn-assets` after measurement. Reasons, in order: native browser
  ESM (no `<script>` tag, no `window` global, no autoloader plugin); one artifact
  shared by browser and tests; 20.5 KB eager vs 64 KB; escaping owned by the
  library rather than by us; 2 advisories vs 6; released 9 days ago vs 17 months.
  Prism's remaining advantages — 297 languages vs 193, a documented `tokenize()`
  API — were judged not to outweigh those, the latter because the HTML
  re-balancer was built and verified correct. Do not re-propose Prism.
- **Delivery** — a real dependency, never a vendored or generated build. This was
  decided against vendoring explicitly.
- **Fidelity** — per-hunk, per-side (D2), not per-line and not
  full-file-from-server.
- **File list** — replaced by the tree, not a toggle and not a filter (D4).
- **Future line comments** — investigated; they are a diff-model and DOM feature
  and are highlighter-independent. D11 adds the row anchors now so the feature is
  additive later.
