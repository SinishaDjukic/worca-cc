---
name: shared-purity-guard-window-token
description: Read before adding or moving any module into src/shared/ (the bare word `window` fails), and before writing the word `import` next to a quote anywhere in ui/pub
paths: src/shared/**, ui/public/*.js, ui/public/*.mjs, test/shared-graph-purity.test.mjs
updated: 2026-10-16T12:42:26.629Z
author: Bulibas
---

`test/shared-graph-purity.test.mjs` scans every file under `src/shared/**` (comments stripped) with
`/\b(window|document|navigator|localStorage)\b/` as a "DOM global" check. It is a plain word match, so
`config.window`, an object key `window: {...}`, or the string `'window'` all FAIL it — not only real
DOM access. Night/Away-mode config has a `window` field, so moving `src/core/night/activation.mjs`
into `src/shared/` breaks `npm test` with "activation.mjs: DOM global", while the night tests pass.

Verify: run `test/shared-graph-purity.test.mjs` after any change under `src/shared/` (the focused
night/away test lists do not include it).

Fix that keeps real DOM access caught (checked: `window.foo`, `typeof window`, `document.body`,
`navigator.x`, `localStorage.getItem` still fail; `config.window`, `{ window: 1 }` pass):
`/(?<![.\w$])(window|document|navigator|localStorage)\b(?!\s*:)/`. A quoted `'window'` string still
fails it — avoid that literal in src/shared or widen the lookbehind.

Also: `git mv a/x.mjs src/shared/new-dir/x.mjs` fails ("No such file or directory") unless
`mkdir -p src/shared/new-dir` runs first.

**The ui/public half of the same test (cost two refine cycles, 2026-10-16).** "ui/public leaves the
static root only into src/shared" runs `IMPORT_RE` (`:17`, `…|\bimport\s*\(?\s*['"]([^'"]+)['"]`,
case-sensitive) over the RAW source of every ui/public `.js`/`.mjs` file: comments and string
literals too. The lowercase word `import` directly before `'`, `"` or `(` becomes a "specifier" that
must be relative, and the suite goes red. Real failures: the comment `Merge one import's rows`, the
comment `purpose 'import')`, and the call `pickFolder('import', …)`. A value cannot be reworded
away: rename it (that dialog purpose became `'repos'`). `Import` with a capital I, `import-candidates`
and identifiers like `importWizardPaths` pass. Run this test after every app.js edit; feature test
lists rarely include it.
