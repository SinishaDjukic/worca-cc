# Code review — MAJOR findings only

**Branch:** `worca/diff-highlights-and-file-structure` (3 commits on `dev`, merge-base `2b799cab`)
**Diff reviewed:** `git diff dev...HEAD` — 16 files, +2783 / −132
**Full review:** `docs/superpowers/reviews/2026-08-22-diff-syntax-highlight-code-review.md`
**Verdict:** 0 critical, 2 major (below), 13 minor (see full review).

---

## M1 — Each language gets a single-grammar hljs instance, so every embedded sub-language renders as plain text

**File:** `ui/public/hljs-loader.mjs:77-80`

```js
const hljs = factory.newInstance();
if (!validInstance(hljs)) throw new TypeError('invalid highlight.js instance');
hljs.registerLanguage(lang, grammar);
```

Only the primary grammar is ever registered on the instance. highlight.js core's dispatcher (`if(!i[v.subLanguage])return void R.addText(A)` in the pinned 11.12.0 build) emits any `subLanguage` region unhighlighted when that grammar is absent from the instance's registry. 9 of the 40 shipped grammars declare a sub-language: JSX markup in `.jsx/.tsx`, `<script>`/`<style>` bodies in `.html/.vue/.svg/.xml`, `RUN` arguments in Dockerfiles, inline HTML in Markdown, and so on. The `language-*` branch of `HLJS_CLASS_RE` in `syntax-highlight.mjs` is therefore unreachable in production.

**Evidence.** Run through the production loader against the pinned assets: a real React component highlighted via `forLanguage('javascript')` gets 14.6% of characters coloured versus 89.4% when `xml` and `css` are also registered; `<style>.a{color:red}</style>` under `xml` leaves the CSS unstyled. The only test that exercises `language-` wrappers (`test/syntax-highlight.test.mjs:144-150`) hand-registers two grammars on one instance — a shape production never builds.

**Fix.** Register each grammar's declared sub-language set on its instance before freezing the bound highlighter: `xml → {css, javascript}`, `dockerfile → {bash}`, `markdown → {xml}`, `javascript`/`typescript → {xml, css, graphql}`, etc. Output remains a pure function of the primary language, so the `requested !== lang` guard and the round-trip check are unaffected. Add a production-shaped test: build via `forLanguage('javascript')` only and assert a `language-xml` span appears for JSX.

## M2 — The new 5,000-item render cap silently truncates diffs that `dev` rendered in full

**File:** `ui/public/diff-view.mjs:8, 144-146, 167-169`; note text at `ui/public/app.js:11378`

```js
export const MAX_FILE_SECTION_RENDER_ITEMS = 5_000;
…
if (retainedItems >= MAX_FILE_SECTION_RENDER_ITEMS) { res.truncated = true; break; }
```

**Evidence.** Measured on a 6,000-line single-hunk `package-lock.json` section of 459,920 code units (below the unchanged 500,000 size cap): `dev` → 6000 lines, `truncated=false`; `HEAD` → 4999 lines, `truncated=true`, 1,001 lines dropped. The replacement note `(large file — diff truncated)` dropped the threshold the old message named, so the user cannot tell which of the two caps fired or how much is hidden, and there is no expand affordance.

**Why it matters.** The cap is mandated by the v3 plan (§Task 2), but it is a regression against `dev` on realistic generated/lockfile diffs, and it bakes a DOM budget into a module whose header says "DOM-free on purpose". Both caps share a single `truncated` boolean, so no consumer (future line-comment anchors, copy-full-patch, search) can distinguish the causes.

**Fix.** Preferred: renderer-side windowing with a "show N more lines" affordance, leaving `parseFileSection` complete. Minimum: separate `truncatedBy: 'size' | 'items'` (or two flags), and a note that says "5,000 of 6,000 lines shown".
