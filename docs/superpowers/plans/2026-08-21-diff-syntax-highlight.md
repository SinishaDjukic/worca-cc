# Diff syntax highlighting, line numbers and file tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the History detail Diff tab read like GitHub — syntax-highlighted code, dual old/new line-number gutters, and a collapsible file tree in place of the flat file list.

**Architecture:** Three pure, DOM-light modules do the thinking (`syntax-highlight.mjs`, `file-tree.mjs`, and additions to `diff-view.mjs`); `buildHdDiff` in `app.js` only wires them to the DOM. highlight.js arrives as `@highlightjs/cdn-assets` — a real npm dependency whose `es/` tree is self-contained browser ESM — mounted straight from `node_modules` by `ui/server.mjs` and reached with native dynamic `import()`. No `<script>` tag, no global, no plugin, nothing vendored or generated. Highlighting is a strict enhancement: every failure path falls back to the rows rendered today.

**Tech Stack:** Vanilla ES modules, no build step. `@highlightjs/cdn-assets@^11.12.0` (one new runtime dependency, BSD-3-Clause) and `highlight.js@^11.12.0` (devDependency, used only by the provenance test). `node:test` + `jsdom`. Express 4 static middleware.

**Spec:** `docs/superpowers/specs/2026-08-21-diff-syntax-highlight-design.md`

---

## Global Constraints

- **Node ≥ 22.13.0**, ESM only, no build step.
- **One new runtime dependency:** `@highlightjs/cdn-assets`, in `dependencies` (npm consumers of `@worca/app` need it at runtime). **One new devDependency:** `highlight.js`, used by `test/hljs-provenance.test.mjs` and nothing else. No other package.
- **Nothing generated is committed.** No vendored build, no concatenation script. Decided against explicitly; see spec §10.
- **`ui/public/index.html` is not modified by this plan.** The browser reaches the highlighter with dynamic `import()`; there is no script tag to add.
- **Full-suite command:** `npm test` → `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/*.mjs`
- **Single-file command:** `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/<file>.mjs`
- **Baseline: `npm test` at `2b799cab` is 2926 pass / 0 fail** (measured 2026-08-21, 66.5 s). Zero-fail at the end of every task. A red test you did not write is a regression, not a pre-existing failure.
- **U+2212 (`−`) stays in count chips only.** The patch body keeps ASCII `+`/`-` so copied output survives `git apply` (`app.js:11202-11205`).
- **Highlighting never breaks the pane.** Every failure degrades to plain rows (spec §6).
- Plans and specs under `docs/superpowers/` are **untracked by convention** — never `git add` them.

---

## Facts established empirically — do not re-derive

Measured 2026-08-21 against `@highlightjs/cdn-assets@11.12.0` and `highlight.js@11.12.0`. The three pure algorithms were prototyped and their output verified before this plan was written.

1. **`@highlightjs/cdn-assets` `es/` is real, self-contained browser ESM** — `export { highlight as default }`, **zero bare imports** anywhere in the tree. Node imports the identical files, so the browser and the tests share one artifact.
2. **`es/core.min.js` is 20.5 KB and registers NO grammars** — `listLanguages()` returns `[]`. Every language, javascript included, is a dynamic import of `es/languages/<id>.min.js` (193 files).
3. The mainline `highlight.js` package **cannot** serve this role: its `es/core.js` is a 202-byte shim importing `../lib/core.js`, which is CommonJS. That is why the dependency is `@highlightjs/cdn-assets`.
4. **`hljs.highlight()` THROWS `Error: Unknown language` for an unregistered id** and logs a console warning. Always gate on `hljs.getLanguage(id)` first.
5. `ignoreIllegals: true` is passed on every call. Diff hunk sides are partial, often syntactically invalid fragments; the javascript grammar tolerated every fragment tested, but other grammars define `illegal` rules that would throw.
6. **Provenance:** cdn-assets and highlight.js share the same four npm maintainers (`marcosc`, `joshgoebel`, `isagalaev`, `highlightjs_bot`), the same `repository.url`, and the **same npm signing key** `SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`. Output is byte-identical at `11.12.0`. Task 1 pins this with a test rather than trusting it.
7. **The SPA fallback (`ui/server.mjs:3474-3480`) serves `index.html` for every unmatched GET outside `/api/` and `/ws`.** Without the `/vendor/` exclusion in Task 1, a missing grammar returns 200-HTML and `import()` fails with a confusing parse error instead of a clean 404.
8. jsdom never resolves `import('/vendor/hljs/...')`, so tests exercise the **plain fallback** by default. That is why every existing Diff assertion keeps passing, and why the highlighting tests inject a highlighter explicitly.
9. **Language ids**, resolved against the shipped file list: `jsx`→`javascript`, `tsx`→`typescript`, `toml`→`ini`, `json5`/`jsonc`→`json`, `vue`→`xml`, `yml`→`yaml`, `sh`/`zsh`→`bash`. **No grammar exists for `hcl`/`tf`** — those must map to null and render plain.
10. Global `*{box-sizing:border-box}` (`style.css:52`) — the gutter width variable must include its own padding, hence `calc(Nch + 16px)`.
11. `rowsFromHtml` verified on a 3-line block comment plus a template literal with a nested `${}` spanning a line break: 6 rows, every row's spans balanced, exact text round-trip.
12. `buildFileTree` verified against the reference screenshot: `ui` + `public` collapse to `ui/public`, while a `src` holding both `deep/` and `x.js` correctly does not collapse.
13. **XSS:** both the library output and the re-balancer were fed five hostile source lines and parsed into a real DOM — zero non-`<span>` elements created, zero non-`class` attributes, exact text round-trip. highlight.js escapes inside the library, so `rowsFromHtml` passes escaped text through and must **not** re-escape.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | `@highlightjs/cdn-assets` in `dependencies`, `highlight.js` in `devDependencies` |
| `ui/server.mjs` | mount the package dir at `/vendor/hljs`; exclude `/vendor/` from the SPA fallback |
| `ui/public/diff-view.mjs` | **extended** — `@@` range parsing, per-row `oldNo`/`newNo` |
| `ui/public/syntax-highlight.mjs` | **new, pure** — `langForPath`, `rowsFromHtml`, `highlightHunk`, `highlightParsed` |
| `ui/public/file-tree.mjs` | **new** — `buildFileTree` (pure), `renderFileTree` (DOM) |
| `ui/public/app.js` | `buildHdDiff` wiring only, plus the dynamic-import loader |
| `ui/public/style.css` | 3-column diff grid, `.hljs-*` token colours, tree rows |
| `test/api-hljs-assets.test.mjs` | **new** — the mount serves, the fallback does not swallow |
| `test/hljs-provenance.test.mjs` | **new** — the served build matches mainline highlight.js |
| `test/syntax-highlight.test.mjs` | **new** |
| `test/file-tree.test.mjs` | **new** |
| `test/diff-view.test.mjs` | **extended** |
| `test/ui-history-detail.test.mjs` | **extended** |

`ui/public/index.html` appears nowhere: there is nothing to add to it.

---

## Task 1: highlight.js as a dependency, served from node_modules

**Files:**
- Modify: `package.json` (dependencies + devDependencies, `package.json:53-58`)
- Modify: `ui/server.mjs:16` (imports), `ui/server.mjs:594` (static mounts), `ui/server.mjs:3476` (SPA fallback)
- Test: `test/api-hljs-assets.test.mjs` (create), `test/hljs-provenance.test.mjs` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `GET /vendor/hljs/es/core.min.js` and `GET /vendor/hljs/es/languages/<id>.min.js`, both real browser ESM, importable from `app.js` with dynamic `import()`.

- [ ] **Step 1: Install the dependencies**

```bash
npm install @highlightjs/cdn-assets@^11.12.0 --save
npm install highlight.js@^11.12.0 --save-dev
```

`@highlightjs/cdn-assets` is the runtime dependency the browser loads. `highlight.js` is the 26.6M-downloads mainline package and is used by exactly one test, which is why it is a devDependency and never ships. Confirm both landed on the right side:

```bash
node -e "const p=require('./package.json');console.log('dep:',p.dependencies['@highlightjs/cdn-assets'],'| devDep:',p.devDependencies['highlight.js'])"
```
Expected: `dep: ^11.12.0 | devDep: ^11.12.0`

- [ ] **Step 2: Write the failing mount test**

Create `test/api-hljs-assets.test.mjs`. The harness is the minimal one from `test/api-models.test.mjs:35-54` — import the app so no port is bound, then wrap it in an ephemeral `http.Server`.

```js
// test/api-hljs-assets.test.mjs — @highlightjs/cdn-assets is mounted read-only at
// /vendor/hljs so app.js can reach it with a dynamic import(). Its `es/` tree is
// self-contained browser ESM, which is why there is no <script> tag anywhere.
//
// The SPA fallback (ui/server.mjs:3474-3480) answers EVERY unmatched GET with
// index.html, so a missing grammar would return 200 text/html and import() would
// fail on a confusing parse error instead of a clean 404. The /vendor/ exclusion
// is what prevents that, and it is pinned here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let srv, base, homeDir, worcaHomeDir;
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
};

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-hljs-home-'));
  worcaHomeDir = await mkdtemp(join(tmpdir(), 'worca-cc-hljs-whome-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir;
  process.env.WORCA_HOME = worcaHomeDir;
  const { app } = await import('../ui/server.mjs'); // imported => does not bind a port
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await Promise.all([homeDir, worcaHomeDir].map((d) => rm(d, { recursive: true, force: true })));
});

test('the ESM core and a lazily-loaded grammar are both served', async () => {
  const core = await fetch(`${base}/vendor/hljs/es/core.min.js`);
  assert.equal(core.status, 200);
  assert.match(core.headers.get('content-type') || '', /javascript/);
  const src = await core.text();
  assert.match(src, /export\s*\{[^}]*as default\s*\}/, 'must be real ESM, not a CJS shim');
  assert.doesNotMatch(src, /module\.exports/);

  // core registers NO grammars, so every language is a separate import.
  const py = await fetch(`${base}/vendor/hljs/es/languages/python.min.js`);
  assert.equal(py.status, 200);
  assert.match(await py.text(), /export default/);
});

test('a missing grammar 404s instead of falling through to index.html', async () => {
  const miss = await fetch(`${base}/vendor/hljs/es/languages/not-a-language.min.js`);
  assert.equal(miss.status, 404, 'the SPA fallback must not answer for /vendor/');
  assert.doesNotMatch(await miss.text(), /<!DOCTYPE html>/i);
});

test('the mount serves no directory listing', async () => {
  const dir = await fetch(`${base}/vendor/hljs/es/languages/`);
  assert.equal(dir.status, 404);
});

test('index.html loads no highlighter script — the import is dynamic', async () => {
  const html = await (await fetch(`${base}/index.html`)).text();
  assert.doesNotMatch(html, /vendor\/hljs/, 'no script tag: app.js imports it on demand');
  assert.match(html, /<script src="\/app\.js" type="module"><\/script>/);
});
```

- [ ] **Step 3: Write the failing provenance test**

Create `test/hljs-provenance.test.mjs`:

```js
// test/hljs-provenance.test.mjs — @highlightjs/cdn-assets is what the browser
// loads (~64k weekly downloads); highlight.js is the mainline package (~26.6M).
// Same npm maintainers, same repository, same signing key — but this asserts the
// equivalence instead of trusting it. If the CDN build ever diverges from
// mainline, or the two versions drift apart in package.json, this goes red before
// it ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// A: mainline, CommonJS. Note the exports map has no ".js" on these subpaths.
const mainline = require('highlight.js/lib/core');
// B: the ESM build we actually serve.
const cdn = (await import('@highlightjs/cdn-assets/es/core.min.js')).default;

const LANGS = ['javascript', 'python', 'xml'];
for (const id of LANGS) {
  mainline.registerLanguage(id, require(`highlight.js/lib/languages/${id}`));
  cdn.registerLanguage(id, (await import(`@highlightjs/cdn-assets/es/languages/${id}.min.js`)).default);
}

test('both packages are the same version', () => {
  assert.equal(cdn.versionString, mainline.versionString);
});

test('the served build highlights byte-identically to mainline', () => {
  const SAMPLES = [
    ['javascript', 'const a = 1;\n/* block\n   spans */\nconst s = `tpl ${a}\nstill`;'],
    // The escaping path: this is the one that matters for XSS.
    ['javascript', 'const s = "<img src=x onerror=alert(1)>";'],
    ['javascript', '  } else {'],                     // a partial hunk side
    ['python', 'def f(x):\n    return """a\nb"""'],
    ['xml', '<div class="x">&amp;</div>'],
  ];
  for (const [lang, src] of SAMPLES) {
    assert.equal(
      cdn.highlight(src, { language: lang, ignoreIllegals: true }).value,
      mainline.highlight(src, { language: lang, ignoreIllegals: true }).value,
      `${lang}: ${JSON.stringify(src.slice(0, 40))}`);
  }
});

test('core ships no grammars, so every language really is lazy', () => {
  const fresh = (await import('@highlightjs/cdn-assets/es/core.min.js')).default;
  // Same module instance as `cdn` above, which we registered into — so assert on
  // the documented fact instead: a never-registered id is absent and throws.
  assert.equal(fresh.getLanguage('rust'), undefined);
  assert.throws(() => fresh.highlight('fn main() {}', { language: 'rust' }), /Unknown language/);
});
```

> If `await import(...)` at module top level trips the runner, hoist the three
> `await` calls into a `before()` block and declare `cdn` with `let`. Node 22's
> test runner supports top-level await in ESM test files; use the simpler form
> unless it actually fails.

- [ ] **Step 4: Run both tests to verify they fail**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/api-hljs-assets.test.mjs test/hljs-provenance.test.mjs`
Expected: the provenance file PASSES immediately (it only needs the packages installed); the mount file FAILS — every asset returns `index.html` because nothing is mounted yet.

- [ ] **Step 5: Add the mount**

In `ui/server.mjs`, extend the imports at `ui/server.mjs:16`:

```js
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
```

Immediately after `app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));` (`ui/server.mjs:594`):

```js
// highlight.js, served straight out of the installed package rather than
// vendored into ui/public. @highlightjs/cdn-assets ships `es/` as self-contained
// browser ESM, so app.js reaches core and each grammar with a plain dynamic
// import() — no <script> tag, no global, no loader plugin.
// Resolved, not path-joined, so pnpm/yarn layouts and hoisting all work.
try {
  const hljsDir = path.dirname(createRequire(import.meta.url).resolve('@highlightjs/cdn-assets/package.json'));
  app.use('/vendor/hljs', express.static(hljsDir, { index: false }));
} catch {
  // Not installed -> no mount. The Diff tab renders plain rows (spec §6);
  // nothing else in the app depends on it.
}
```

- [ ] **Step 6: Stop the SPA fallback swallowing /vendor/**

In `ui/server.mjs:3476`, add the `/vendor/` clause:

```js
  if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) return next();
  // /vendor/* is served by a static mount or not at all. Without this, an
  // unmounted or misspelled asset answers 200 text/html and the browser's
  // module loader reports a parse error instead of a plain 404.
  if (req.path.startsWith('/vendor/')) return next();
```

- [ ] **Step 7: Run both tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/api-hljs-assets.test.mjs test/hljs-provenance.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: 2933 pass / 0 fail (2926 baseline + 7 new).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json ui/server.mjs test/api-hljs-assets.test.mjs test/hljs-provenance.test.mjs
git commit -m "feat(ui): serve highlight.js from node_modules at /vendor/hljs"
```

---

## Task 2: Line numbers in the diff parser

**Files:**
- Modify: `ui/public/diff-view.mjs:98-151` (`parseFileSection`)
- Test: `test/diff-view.test.mjs` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `parseFileSection(raw)` hunks additionally carry `oldStart:number` and `newStart:number`; every entry of `hunk.lines` additionally carries `oldNo:number|null` and `newNo:number|null`. Also exports `hunkRange(header) -> {oldStart,oldCount,newStart,newCount}|null`.

- [ ] **Step 1: Write the failing test**

Append to `test/diff-view.test.mjs`:

```js
test('hunkRange reads both sides, and an omitted count means 1', () => {
  assert.deepEqual(hunkRange('@@ -10,6 +12,7 @@ trailing context'),
    { oldStart: 10, oldCount: 6, newStart: 12, newCount: 7 });
  // git omits ",1" for single-line ranges — without this branch the count is NaN.
  assert.deepEqual(hunkRange('@@ -1 +1 @@'),
    { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 });
  assert.deepEqual(hunkRange('@@ -0,0 +1,3 @@'),
    { oldStart: 0, oldCount: 0, newStart: 1, newCount: 3 });
  assert.equal(hunkRange('not a hunk header'), null);
  assert.equal(hunkRange(undefined), null);
});

test('parseFileSection numbers every row the way a two-gutter view needs', () => {
  const parsed = parseFileSection(SIMPLE);
  const h = parsed.hunks[0];
  assert.equal(h.oldStart, 1);
  assert.equal(h.newStart, 1);
  // SIMPLE is: ' line1', '-old', '+new', '+added', ' line3' from @@ -1,3 +1,4 @@
  assert.deepEqual(h.lines.map((l) => [l.kind, l.oldNo, l.newNo]), [
    ['ctx', 1, 1],
    ['del', 2, null],   // a delete advances the old side only
    ['add', null, 2],   // an add advances the new side only
    ['add', null, 3],
    ['ctx', 3, 4],      // context resumes on both, now two apart
  ]);
});

test('a hunk header that does not parse leaves the rows unnumbered rather than wrong', () => {
  const parsed = parseFileSection([
    'diff --git a/x.js b/x.js', '--- a/x.js', '+++ b/x.js',
    '@@ garbage @@', ' keep', '+add',
  ].join('\n'));
  const h = parsed.hunks[0];
  assert.equal(h.oldStart, undefined);
  assert.deepEqual(h.lines.map((l) => [l.oldNo, l.newNo]), [[null, null], [null, null]]);
});
```

Extend the import at `test/diff-view.test.mjs:3-5` with `hunkRange`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/diff-view.test.mjs`
Expected: FAIL with `hunkRange is not a function`.

- [ ] **Step 3: Implement**

In `ui/public/diff-view.mjs`, add above `parseFileSection`:

```js
// "@@ -12,7 +12,9 @@ optional context" -> both side ranges. git OMITS the count
// for a single-line range ("@@ -1 +1 @@"), which must read as 1, not NaN.
export function hunkRange(header) {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(String(header || ''));
  if (!m) return null;
  return {
    oldStart: Number(m[1]), oldCount: m[2] == null ? 1 : Number(m[2]),
    newStart: Number(m[3]), newCount: m[4] == null ? 1 : Number(m[4]),
  };
}
```

Inside `parseFileSection`, replace the `if (line.startsWith('@@'))` branch (`diff-view.mjs:130-134`) with:

```js
    if (line.startsWith('@@')) {
      const r = hunkRange(line);
      hunk = { header: line, lines: [] };
      if (r) { hunk.oldStart = r.oldStart; hunk.newStart = r.newStart; }
      // Counters ride on the hunk, not on module state: a malformed header
      // leaves them null so the gutters render empty instead of confidently wrong.
      hunk._o = r ? r.oldStart : null;
      hunk._n = r ? r.newStart : null;
      res.hunks.push(hunk);
      continue;
    }
```

Replace the three `hunk.lines.push(...)` calls at the end of the loop with a single numbered push:

```js
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
    const text = kind === 'ctx'
      ? (line.startsWith(' ') ? line.slice(1) : line)
      : line.slice(1);
    const numbered = { kind, text, oldNo: null, newNo: null };
    if (hunk._o != null) {
      if (kind !== 'add') numbered.oldNo = hunk._o++;
      if (kind !== 'del') numbered.newNo = hunk._n++;
    }
    hunk.lines.push(numbered);
```

After the loop, before `return res;`, drop the scratch counters so they never leak into a consumer or a deepEqual:

```js
  for (const h of res.hunks) { delete h._o; delete h._n; }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/diff-view.test.mjs`
Expected: PASS — the three new tests plus every pre-existing one (the change is additive; `kind` and `text` are unchanged).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: 2936 pass / 0 fail.

- [ ] **Step 6: Commit**

```bash
git add ui/public/diff-view.mjs test/diff-view.test.mjs
git commit -m "feat(ui): carry old/new line numbers through the diff parser"
```

---


## Task 3: The syntax-highlight module

**Files:**
- Create: `ui/public/syntax-highlight.mjs`
- Test: `test/syntax-highlight.test.mjs` (create)

**Interfaces:**
- Consumes: `parseFileSection` output from Task 2 (`{hunks:[{header, lines:[{kind, text, oldNo, newNo}]}]}`).
- Produces:
  - `langForPath(path) -> string|null`
  - `rowsFromHtml(html) -> string[]` — one HTML string per source line
  - `highlightHunk(hunk, lang, highlight) -> boolean` — sets `line.html` on success
  - `highlightParsed(parsed, lang, highlight) -> boolean`
  - `MAX_HIGHLIGHT_BYTES = 100_000`, `MAX_HIGHLIGHT_ROWS = 3000`
- `highlight` is injected — `(text, lang) => htmlString`. The module never imports highlight.js (spec D8).

- [ ] **Step 1: Write the failing test**

Create `test/syntax-highlight.test.mjs`:

```js
// test/syntax-highlight.test.mjs — the pure half of diff highlighting. The
// highlighter is INJECTED (spec D8): the browser passes a closure over the
// dynamically-imported hljs, this suite passes one over the same package's node
// import. The module under test is identical on both paths.
//
// highlight.js escapes inside the library, so rowsFromHtml passes escaped text
// through and must NOT escape again — the round-trip assertions below are what
// pin that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  langForPath, rowsFromHtml, highlightHunk, highlightParsed,
  MAX_HIGHLIGHT_ROWS,
} from '../ui/public/syntax-highlight.mjs';

const hljs = (await import('@highlightjs/cdn-assets/es/core.min.js')).default;
for (const id of ['javascript', 'python', 'xml']) {
  hljs.registerLanguage(id, (await import(`@highlightjs/cdn-assets/es/languages/${id}.min.js`)).default);
}
const highlight = (text, lang) => hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
const strip = (html) => html.replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

test('langForPath maps by extension and gives up quietly', () => {
  assert.equal(langForPath('ui/public/app.js'), 'javascript');
  assert.equal(langForPath('src/core/orchestrator.mjs'), 'javascript');
  assert.equal(langForPath('a/b/c.test.mjs'), 'javascript', 'a compound suffix still resolves');
  assert.equal(langForPath('x.ts'), 'typescript');
  assert.equal(langForPath('c.tsx'), 'typescript', 'hljs has no separate tsx grammar');
  assert.equal(langForPath('c.jsx'), 'javascript', 'nor a separate jsx grammar');
  assert.equal(langForPath('style.css'), 'css');
  assert.equal(langForPath('index.html'), 'xml', 'hljs calls markup "xml"');
  assert.equal(langForPath('package.json'), 'json');
  assert.equal(langForPath('a/b.jsonc'), 'json');
  assert.equal(langForPath('Cargo.toml'), 'ini', 'toml is an alias of hljs ini');
  assert.equal(langForPath('conf.yml'), 'yaml');
  assert.equal(langForPath('README.md'), 'markdown');
  assert.equal(langForPath('Dockerfile'), 'dockerfile', 'extensionless names matched whole');
  // hljs ships NO hcl/terraform grammar — mapping it would make highlight() throw.
  assert.equal(langForPath('main.tf'), null);
  assert.equal(langForPath('.gitignore'), null);
  assert.equal(langForPath('assets/logo.png'), null);
  assert.equal(langForPath(''), null);
  assert.equal(langForPath(undefined), null);
});

test('rowsFromHtml emits one row per source line and round-trips the text exactly', () => {
  const src = "const a = 1;\nconst b = 'two';";
  const rows = rowsFromHtml(highlight(src, 'javascript'));
  assert.equal(rows.length, 2);
  assert.equal(rows.map(strip).join('\n'), src);
  assert.match(rows[0], /<span class="hljs-keyword">const<\/span>/);
});

test('a token spanning lines colours every row it covers', () => {
  // The whole point of highlighting per SIDE instead of per line (spec D2): a
  // block comment opened on one row must stay a comment on the rows beneath it.
  const rows = rowsFromHtml(highlight('/* one\n   two\n   three */', 'javascript'));
  assert.equal(rows.length, 3);
  for (const [i, r] of rows.entries()) {
    assert.match(r, /class="hljs-comment"/, `row ${i + 1} continues the comment`);
  }
  // Every row's spans are balanced — the stack is closed at the break and reopened.
  for (const r of rows) {
    assert.equal((r.match(/<span/g) || []).length, (r.match(/<\/span>/g) || []).length);
  }
});

test('nested tokens survive a line break', () => {
  const src = 'const s = `a${1}\nb`;';
  const rows = rowsFromHtml(highlight(src, 'javascript'));
  assert.equal(rows.length, 2);
  assert.match(rows[1], /class="hljs-string"/, 'the outer token reopens on row 2');
  assert.equal(rows.map(strip).join('\n'), src);
});

test('hostile source text stays text — nothing is re-escaped, nothing leaks', () => {
  const src = 'const s = "<img src=x onerror=alert(1)>";';
  const rows = rowsFromHtml(highlight(src, 'javascript'));
  const html = rows.join('');
  assert.doesNotMatch(html, /<img/, 'the source tag must not become a real element');
  assert.match(html, /&lt;img/);
  // Double-escaping would turn &lt; into &amp;lt; and break the round-trip.
  assert.equal(strip(rows[0]), src);
});

test('a span breakout attempt cannot forge markup', () => {
  const src = `const t = '</span><span class="x" onload="evil()">';`;
  const rows = rowsFromHtml(highlight(src, 'javascript'));
  assert.doesNotMatch(rows.join(''), /onload/);
  assert.equal(strip(rows[0]), src);
});

test('class names are filtered to a safe character set before being re-emitted', () => {
  // Nothing hljs emits carries a quote today, but rowsFromHtml reconstructs the
  // attribute, so it refuses anything outside [A-Za-z0-9 _-] by construction.
  const rows = rowsFromHtml('<span class="evil&quot; onload=&quot;x">hi</span>');
  assert.doesNotMatch(rows[0], /onload/);
});

test('highlightHunk highlights each side once and assigns html per row', () => {
  const hunk = { header: '@@ -1,3 +1,3 @@', lines: [
    { kind: 'ctx', text: "import x from 'y';" },
    { kind: 'del', text: 'const old = /* stale' },
    { kind: 'del', text: '   note */ 1;' },
    { kind: 'add', text: 'const s = `a${1}' },
    { kind: 'add', text: 'b`;' },
  ]};
  assert.equal(highlightHunk(hunk, 'javascript', highlight), true);
  for (const l of hunk.lines) assert.equal(typeof l.html, 'string');
  // The comment opened on the first deleted row continues on the second, and the
  // template literal opened on the first added row continues on the second —
  // neither is possible if you highlight a diff line at a time.
  assert.match(hunk.lines[2].html, /class="hljs-comment"/);
  assert.match(hunk.lines[4].html, /class="hljs-string"/);
  // Deleted rows never contaminate the new side's markup.
  assert.equal(strip(hunk.lines[3].html), 'const s = `a${1}');
});

test('highlightHunk bails without assigning html when the highlighter misbehaves', () => {
  const hunk = { header: '@@ -1,1 +1,1 @@', lines: [{ kind: 'ctx', text: 'a' }] };
  assert.equal(highlightHunk(hunk, 'javascript', () => { throw new Error('boom'); }), false);
  assert.equal(hunk.lines[0].html, undefined, 'a throw degrades to plain rows');

  // A row count that does not match the line count would shift colours onto the
  // wrong lines — refuse instead.
  const shifted = { header: '@@ -1,2 +1,2 @@', lines: [
    { kind: 'ctx', text: 'a' }, { kind: 'ctx', text: 'b' },
  ]};
  assert.equal(highlightHunk(shifted, 'javascript', () => 'a\nb\nextra'), false);
  assert.equal(shifted.lines[0].html, undefined);
});

test('highlightParsed refuses oversized sections', () => {
  const big = { hunks: [{ header: '@@ -1,1 +1,1 @@', lines:
    Array.from({ length: MAX_HIGHLIGHT_ROWS + 1 }, () => ({ kind: 'ctx', text: 'x' })) }] };
  assert.equal(highlightParsed(big, 'javascript', highlight), false);
  assert.equal(big.hunks[0].lines[0].html, undefined);

  const wide = { hunks: [{ header: '@@ -1,1 +1,1 @@', lines:
    [{ kind: 'ctx', text: 'x'.repeat(100_001) }] }] };
  assert.equal(highlightParsed(wide, 'javascript', highlight), false);
});

test('highlightParsed is a no-op without a language or a highlighter', () => {
  const parsed = { hunks: [{ header: '@@ -1,1 +1,1 @@', lines: [{ kind: 'ctx', text: 'a' }] }] };
  assert.equal(highlightParsed(parsed, null, highlight), false);
  assert.equal(highlightParsed(parsed, 'javascript', null), false);
  assert.equal(parsed.hunks[0].lines[0].html, undefined);
});

test('a partial, syntactically invalid hunk side still highlights', () => {
  // Every hunk side is a fragment: half an if, an unterminated string, a stray
  // brace. ignoreIllegals in the injected closure is what keeps these from
  // throwing on grammars that define illegal rules.
  const hunk = { header: '@@ -1,2 +1,2 @@', lines: [
    { kind: 'add', text: '  } else {' },
    { kind: 'add', text: '    const s = `unterminated' },
  ]};
  assert.equal(highlightHunk(hunk, 'javascript', highlight), true);
  assert.equal(strip(hunk.lines[0].html), '  } else {');
});

test('a non-javascript grammar works the same way', () => {
  const hunk = { header: '@@ -1,3 +1,3 @@', lines: [
    { kind: 'add', text: 'def f(x):' },
    { kind: 'add', text: '    return """a' },
    { kind: 'add', text: 'b"""' },
  ]};
  assert.equal(highlightHunk(hunk, 'python', highlight), true);
  assert.match(hunk.lines[0].html, /class="hljs-keyword">def</);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/syntax-highlight.test.mjs`
Expected: FAIL — `Cannot find module '.../ui/public/syntax-highlight.mjs'`.

- [ ] **Step 3: Implement**

Create `ui/public/syntax-highlight.mjs`:

```js
// syntax-highlight.mjs — the pure half of Diff-tab highlighting.
//
// The highlighter is INJECTED, never imported (spec D8): the browser hands in a
// closure over the hljs instance it dynamic-imported from /vendor/hljs, node
// tests hand in one over the same package. That keeps this module free of the
// one thing that differs between the two environments.
//
// Everything here degrades rather than throws. A caller that gets `false` back
// renders the plain rows the Diff tab rendered before highlighting existed.

export const MAX_HIGHLIGHT_BYTES = 100_000;
export const MAX_HIGHLIGHT_ROWS = 3000;

// Extension -> highlight.js language id. Ids are canonical, never aliases, and
// every one of them must exist as es/languages/<id>.min.js — a mapping to a
// grammar hljs does not ship makes highlight() THROW rather than degrade.
// Notably: hljs has no jsx/tsx/toml/vue/hcl grammars of its own.
const BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  json: 'json', jsonc: 'json', json5: 'json',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  md: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', properties: 'properties',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  py: 'python', rb: 'ruby', php: 'php', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift', scala: 'scala',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', sql: 'sql', graphql: 'graphql', gql: 'graphql',
  proto: 'protobuf', lua: 'lua', pl: 'perl', r: 'r', dart: 'dart',
  ex: 'elixir', exs: 'elixir', erl: 'erlang', hs: 'haskell', clj: 'clojure',
  diff: 'diff', patch: 'diff', nix: 'nix', gradle: 'gradle',
};

// Names that carry their language without an extension.
const BY_NAME = {
  dockerfile: 'dockerfile', makefile: 'makefile', gemfile: 'ruby',
  rakefile: 'ruby', vagrantfile: 'ruby', brewfile: 'ruby',
};

export function langForPath(path) {
  const base = String(path || '').split('/').pop() || '';
  const named = BY_NAME[base.toLowerCase()];
  if (named) return named;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;                       // no dot, or a dotfile like .gitignore
  return BY_EXT[base.slice(dot + 1).toLowerCase()] || null;
}

// Class names arrive from highlight.js's own markup. They are written back into
// an attribute, so anything outside this set is dropped rather than trusted.
const safeClass = (s) => String(s).replace(/[^A-Za-z0-9 _-]/g, '');

// Split highlight.js output into ONE html string per source line.
//
// Its output is a narrow, predictable subset — `<span class="hljs-x">`, `</span>`
// and already-escaped text, nothing else — so a single regex walk suffices. The
// stack of open classes is closed at every '\n' and reopened on the next row, so
// a token that spans lines (block comment, template literal, heredoc) colours
// every row it covers AND every row's spans stay balanced.
//
// Text is passed through VERBATIM: highlight.js already escaped it, and escaping
// again would render `&amp;lt;` to the user.
export function rowsFromHtml(html) {
  const rows = [];
  const stack = [];
  let cur = '';
  const reopen = () => stack.map((c) => `<span class="${c}">`).join('');
  // Order matters: the open-tag and close-tag alternatives must precede the
  // catch-all, and the trailing `<` catches a stray angle bracket that is not a
  // span (which highlight.js never emits, but which must not hang the loop).
  const re = /<span class="([^"]*)">|<\/span>|\n|[^<\n]+|</g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tok = m[0];
    if (m[1] !== undefined) {
      const cls = safeClass(m[1]);
      stack.push(cls);
      cur += `<span class="${cls}">`;
    } else if (tok === '</span>') {
      if (stack.length) { stack.pop(); cur += tok; }   // never emit an unmatched close
    } else if (tok === '\n') {
      rows.push(cur + '</span>'.repeat(stack.length));
      cur = reopen();
    } else {
      cur += tok;
    }
  }
  rows.push(cur + '</span>'.repeat(stack.length));
  return rows;
}

// Highlight each SIDE of a hunk once — old = ctx+del, new = ctx+add — and hand
// the rows back positionally. Assigns `line.html`; returns false and assigns
// NOTHING when anything is off, so the caller renders plain text.
export function highlightHunk(hunk, lang, highlight) {
  if (!hunk || !lang || typeof highlight !== 'function') return false;
  const oldSide = [];
  const newSide = [];
  for (const l of hunk.lines || []) {
    if (l.kind !== 'add') oldSide.push(l);
    if (l.kind !== 'del') newSide.push(l);
  }
  let oldRows, newRows;
  try {
    oldRows = oldSide.length ? rowsFromHtml(highlight(oldSide.map((l) => l.text).join('\n'), lang)) : [];
    newRows = newSide.length ? rowsFromHtml(highlight(newSide.map((l) => l.text).join('\n'), lang)) : [];
  } catch {
    return false;                                  // a grammar blew up; plain rows
  }
  // A count mismatch would shift colours onto the wrong lines. Refuse rather
  // than render a lie.
  if (oldRows.length !== oldSide.length || newRows.length !== newSide.length) return false;
  oldSide.forEach((l, i) => { if (l.kind === 'del') l.html = oldRows[i]; });
  newSide.forEach((l, i) => { l.html = newRows[i]; });   // ctx + add both come from the new side
  return true;
}

// Whole-file entry point: applies the size guard once, then every hunk.
export function highlightParsed(parsed, lang, highlight) {
  if (!parsed || !lang || typeof highlight !== 'function') return false;
  let rows = 0;
  let bytes = 0;
  for (const h of parsed.hunks || []) {
    for (const l of h.lines || []) { rows++; bytes += l.text.length; }
  }
  if (rows > MAX_HIGHLIGHT_ROWS || bytes > MAX_HIGHLIGHT_BYTES) return false;
  let any = false;
  for (const h of parsed.hunks || []) any = highlightHunk(h, lang, highlight) || any;
  return any;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/syntax-highlight.test.mjs`
Expected: PASS, 13 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: 2949 pass / 0 fail.

- [ ] **Step 6: Commit**

```bash
git add ui/public/syntax-highlight.mjs test/syntax-highlight.test.mjs
git commit -m "feat(ui): pure per-hunk syntax highlighting module"
```

---

## Task 4: The file-tree module

**Files:**
- Create: `ui/public/file-tree.mjs`
- Test: `test/file-tree.test.mjs` (create)

**Interfaces:**
- Consumes: the row shape `hdDiffFileRows` already produces (`app.js:11079-11092`): `{project: string|null, f: {path, status, added, removed, binary?, from?}, isNew: boolean}`.
- Produces:
  - `buildFileTree(rows) -> node[]` where a node is `{type:'dir', kind?:'project', name, path, children}` or `{type:'file', name, path, entry}`
  - `renderFileTree(nodes, {doc, onPick, counts, initialPath}) -> Element` — the `.hd-tree` host
  - `fileStatus(entry) -> 'add'|'del'|'mod'`
  - `firstFile(nodes) -> node|null`

- [ ] **Step 1: Write the failing test**

Create `test/file-tree.test.mjs`:

```js
// test/file-tree.test.mjs — the Diff tab's file tree. buildFileTree is pure and
// needs no DOM; renderFileTree gets a jsdom document injected, the same shape
// source-pane.mjs uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildFileTree, renderFileTree, fileStatus, firstFile } from '../ui/public/file-tree.mjs';

const doc = () => new JSDOM('<!doctype html><body></body>').window.document;
const f = (path, over = {}) => ({
  project: null, isNew: false,
  f: { path, status: 'M', added: 1, removed: 0, ...over },
});
// A compact "v [dir] / ± file" rendering of the tree, for whole-shape assertions.
const shape = (nodes, d = 0) => nodes.flatMap((n) => (
  n.type === 'dir'
    ? [`${'  '.repeat(d)}[${n.name}]`, ...shape(n.children, d + 1)]
    : [`${'  '.repeat(d)}${n.name}`]
));

test('buildFileTree reproduces the GitHub layout, collapsing single-child dir chains', () => {
  const tree = buildFileTree([
    f('ui/public/style.css'), f('README.md'),
    f('test/ui-sidebar-collapse.test.mjs', { status: 'A' }),
    f('ui/public/app.js'), f('test/ui-budget-indicator.test.mjs'),
    f('ui/public/index.html'), f('ui/public/stats-view.mjs'),
  ]);
  assert.deepEqual(shape(tree), [
    '[test]',
    '  ui-budget-indicator.test.mjs',
    '  ui-sidebar-collapse.test.mjs',
    '[ui/public]',                       // "ui" holds only "public" -> one row
    '  app.js',
    '  index.html',
    '  stats-view.mjs',
    '  style.css',
    'README.md',                         // directories first, then files
  ]);
});

test('a directory with more than one child never collapses', () => {
  const tree = buildFileTree([f('src/deep/y.js'), f('src/x.js')]);
  assert.deepEqual(shape(tree), ['[src]', '  [deep]', '    y.js', '  x.js']);
});

test('a collapsed chain keeps the full path of its deepest segment', () => {
  const [dir] = buildFileTree([f('a/b/c/x.js')]);
  assert.equal(dir.name, 'a/b/c');
  assert.equal(dir.path, 'a/b/c', 'the path is the real directory, not the first segment');
});

test('workspace runs put each project key at the root and never merge it into a chain', () => {
  const w = (project, path) => ({ project, isNew: false, f: { path, status: 'M', added: 1, removed: 0 } });
  const tree = buildFileTree([w('a-1111', 'src/x.js'), w('a-1111', 'src/deep/y.js'), w('b-2222', 'README.md')]);
  assert.deepEqual(shape(tree), [
    '[a-1111]', '  [src]', '    [deep]', '      y.js', '    x.js',
    '[b-2222]', '  README.md',
  ]);
  assert.equal(tree[0].kind, 'project');
  // Same relative path under two projects must stay two distinct nodes.
  const dup = buildFileTree([w('a-1111', 'src/x.js'), w('b-2222', 'src/x.js')]);
  assert.equal(dup.length, 2);
  assert.equal(dup[0].children[0].name, 'src/x.js', 'single file under a project collapses its chain');
});

test('fileStatus reads new/deleted/modified off the entry', () => {
  assert.equal(fileStatus({ isNew: true, f: { status: 'A' } }), 'add');
  assert.equal(fileStatus({ isNew: false, f: { status: 'D' } }), 'del');
  assert.equal(fileStatus({ isNew: false, f: { status: 'M' } }), 'mod');
});

test('firstFile finds the first file in document order, descending into dirs', () => {
  const tree = buildFileTree([f('README.md'), f('test/a.mjs')]);
  assert.equal(firstFile(tree).path, 'test/a.mjs', 'dirs sort first, so the dir wins');
  assert.equal(firstFile([]), null);
});

test('renderFileTree keeps the hd-diff-file contract the pane already relies on', () => {
  const d = doc();
  const tree = buildFileTree([f('ui/app.js'), f('gone.txt', { status: 'D' }), f('new.txt', { status: 'A' })]);
  tree[0].children[0].entry.isNew = false;
  const host = renderFileTree(tree, { doc: d });
  const files = [...host.querySelectorAll('.hd-tree-file')];
  assert.equal(files.length, 3);
  for (const el of files) {
    assert.ok(el.classList.contains('hd-diff-file'), 'existing selection CSS and tests key off this');
    assert.equal(el.getAttribute('role'), 'button');
    assert.equal(el.tabIndex, 0);
  }
  const byName = (n) => files.find((el) => el.querySelector('.hd-diff-path').textContent === n);
  assert.ok(byName('gone.txt').classList.contains('deleted'));
  assert.ok(byName('new.txt').classList.contains('new'));
  assert.equal(byName('app.js').dataset.depth, '1', 'nested one level under [ui]');
});

test('clicking or Entering a file row calls onPick with its entry', () => {
  const d = doc();
  const picked = [];
  const host = renderFileTree(buildFileTree([f('a.js'), f('b.js')]), {
    doc: d, onPick: (entry, el) => picked.push([entry.f.path, el.className]),
  });
  const rows = [...host.querySelectorAll('.hd-tree-file')];
  rows[0].dispatchEvent(new d.defaultView.MouseEvent('click', { bubbles: true }));
  rows[1].dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(picked.map((p) => p[0]), ['a.js', 'b.js']);
});

test('a directory row toggles its children and its own aria-expanded', () => {
  const d = doc();
  const host = renderFileTree(buildFileTree([f('ui/a.js'), f('ui/b.js'), f('top.md')]), { doc: d });
  const dir = host.querySelector('.hd-tree-dir');
  assert.equal(dir.getAttribute('aria-expanded'), 'true', 'expanded by default (spec D10)');
  assert.equal(host.querySelectorAll('.hd-tree-file').length, 3);

  dir.dispatchEvent(new d.defaultView.MouseEvent('click', { bubbles: true }));
  assert.equal(host.querySelector('.hd-tree-dir').getAttribute('aria-expanded'), 'false');
  assert.equal(host.querySelectorAll('.hd-tree-file').length, 1, 'only the root-level file remains');

  host.querySelector('.hd-tree-dir').dispatchEvent(new d.defaultView.MouseEvent('click', { bubbles: true }));
  assert.equal(host.querySelectorAll('.hd-tree-file').length, 3);
});

test('collapsing a directory does not disturb the active file row', () => {
  const d = doc();
  const host = renderFileTree(buildFileTree([f('ui/a.js'), f('top.md')]), { doc: d, initialPath: 'ui/a.js' });
  assert.ok(host.querySelector('.hd-tree-file').classList.contains('active'), 'initialPath paints the row');
  const dir = host.querySelector('.hd-tree-dir');
  dir.dispatchEvent(new d.defaultView.MouseEvent('click', { bubbles: true }));
  dir.dispatchEvent(new d.defaultView.MouseEvent('click', { bubbles: true }));
  assert.ok(host.querySelector('.hd-tree-file').classList.contains('active'),
    're-render restores the selection rather than clearing the pane out from under the user');
});

test('counts elements are placed by the injected builder, keeping results shape out of this module', () => {
  const d = doc();
  const host = renderFileTree(buildFileTree([f('a.js', { added: 4, removed: 2 })]), {
    doc: d,
    counts: (entry) => {
      const s = d.createElement('span');
      s.textContent = `+${entry.f.added} -${entry.f.removed}`;
      return s;
    },
  });
  assert.match(host.querySelector('.hd-tree-file').textContent, /\+4 -2/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/file-tree.test.mjs`
Expected: FAIL — `Cannot find module '.../ui/public/file-tree.mjs'`.

- [ ] **Step 3: Implement**

Create `ui/public/file-tree.mjs`:

```js
// file-tree.mjs — the Diff tab's file browser. Replaces the flat path list with
// a GitHub-style tree (spec D4).
//
// buildFileTree is pure and DOM-free so node:test can exercise the interesting
// half without jsdom; renderFileTree takes `doc` injected, the same shape
// source-pane.mjs uses. It knows nothing about the `results` payload: the caller
// supplies count chips through `counts`.

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Rows -> tree. Directories sort before files, both alphabetically, and a
// directory whose ONLY child is a directory merges with it ("ui" + "public" ->
// "ui/public") — the compaction GitHub does, without which every nested project
// wastes a row per segment.
export function buildFileTree(rows) {
  const roots = [];
  const dirOf = new Map();
  for (const entry of Array.isArray(rows) ? rows : []) {
    if (!entry || !entry.f || !entry.f.path) continue;
    const parts = String(entry.f.path).split('/');
    const file = parts.pop();
    const key = entry.project || '';
    let list = roots;
    let prefix = '';
    if (entry.project) {
      // '|' separates the project scope from the path so two projects sharing a
      // relative path stay two nodes.
      let p = dirOf.get(`${key}|`);
      if (!p) {
        p = { type: 'dir', kind: 'project', name: entry.project, path: entry.project, children: [] };
        dirOf.set(`${key}|`, p);
        roots.push(p);
      }
      list = p.children;
    }
    for (const seg of parts) {
      prefix = prefix ? `${prefix}/${seg}` : seg;
      const id = `${key}|${prefix}`;
      let node = dirOf.get(id);
      if (!node) {
        node = { type: 'dir', name: seg, path: prefix, children: [] };
        dirOf.set(id, node);
        list.push(node);
      }
      list = node.children;
    }
    list.push({ type: 'file', name: file, path: entry.f.path, entry });
  }
  const sort = (list) => {
    list.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    for (const n of list) if (n.type === 'dir') sort(n.children);
  };
  const collapse = (list) => list.map((n) => {
    if (n.type !== 'dir') return n;
    n.children = collapse(n.children);
    // A project root is an addressing scope, not a path segment — never merge it
    // into the chain, in either direction.
    while (n.kind !== 'project'
           && n.children.length === 1
           && n.children[0].type === 'dir'
           && n.children[0].kind !== 'project') {
      const only = n.children[0];
      n.name = `${n.name}/${only.name}`;
      n.path = only.path;
      n.children = only.children;
    }
    return n;
  });
  sort(roots);
  return collapse(roots);
}

export function fileStatus(entry) {
  if (!entry) return 'mod';
  if (entry.f && entry.f.status === 'D') return 'del';
  if (entry.isNew || (entry.f && entry.f.status === 'A')) return 'add';
  return 'mod';
}

export function firstFile(nodes) {
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (n.type === 'file') return n;
    const found = firstFile(n.children);
    if (found) return found;
  }
  return null;
}

const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>';
const FOLDER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" '
  + 'd="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h9A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"></path></svg>';
// One page glyph, three inner marks: + new, − deleted, ± modified.
const MARK = { add: 'M12 10v5M9.5 12.5h5', del: 'M9.5 12.5h5', mod: 'M12 10v3M9.5 11.5h5M9.5 14.5h5' };
const fileIcon = (status) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + `stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 3h7l5 5v13H6z"></path>`
  + `<path d="${MARK[status]}"></path></svg>`;

// renderFileTree(nodes, {doc, onPick, counts}) -> the `.hd-tree` host element.
// Collapse state lives in this closure and dies with the screen (spec D10). A
// toggle re-renders the whole host, so the active row is restored from the path
// rather than from a surviving node.
export function renderFileTree(nodes, { doc = globalThis.document, onPick, counts, initialPath } = {}) {
  const host = h(doc, 'div', 'hd-tree');
  const collapsed = new Set();
  // The selection is tracked by PATH, not by a node reference: a toggle repaints
  // the whole host, so a caller that marked a row `.active` itself would have it
  // silently wiped the first time a folder collapses.
  let activePath = initialPath || null;

  const dirRow = (node, depth) => {
    const el = h(doc, 'div', 'hd-tree-dir');
    el.dataset.depth = String(depth);
    el.dataset.path = node.path;
    el.style.setProperty('--depth', String(depth));
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.setAttribute('aria-expanded', collapsed.has(node.path) ? 'false' : 'true');
    const chev = h(doc, 'span', 'hd-tree-chev');
    chev.innerHTML = CHEVRON;
    const ico = h(doc, 'span', 'hd-tree-ico hd-tree-folder');
    ico.innerHTML = FOLDER;
    el.append(chev, ico, h(doc, 'span', 'hd-tree-name', node.name));
    return el;
  };

  const fileRow = (node, depth) => {
    const status = fileStatus(node.entry);
    // `hd-diff-file` is kept ON PURPOSE: the pane's selection CSS, its
    // focus-visible ring and existing tests all key off that class.
    const el = h(doc, 'div', `hd-tree-file hd-diff-file st-${status}`
      + (status === 'del' ? ' deleted' : '') + (status === 'add' ? ' new' : ''));
    el.dataset.depth = String(depth);
    el.dataset.path = node.path;
    el.style.setProperty('--depth', String(depth));
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    if (node.path === activePath) el.classList.add('active');
    const ico = h(doc, 'span', 'hd-tree-ico');
    ico.innerHTML = fileIcon(status);
    const name = h(doc, 'span', 'hd-diff-path mono', node.name);
    name.title = node.entry.f.from ? `${node.entry.f.from} → ${node.path}` : node.path;
    el.append(ico, name);
    const chip = counts ? counts(node.entry) : null;
    if (chip) el.appendChild(chip);
    return el;
  };

  const paint = () => {
    host.replaceChildren();
    const walk = (list, depth) => {
      for (const node of list) {
        if (node.type === 'file') { host.appendChild(fileRow(node, depth)); continue; }
        host.appendChild(dirRow(node, depth));
        if (!collapsed.has(node.path)) walk(node.children, depth + 1);
      }
    };
    walk(Array.isArray(nodes) ? nodes : [], 0);
  };

  const act = (target) => {
    const dir = target.closest('.hd-tree-dir');
    if (dir) {
      const p = dir.dataset.path;
      if (collapsed.has(p)) collapsed.delete(p); else collapsed.add(p);
      paint();
      const again = host.querySelector(`.hd-tree-dir[data-path="${CSS_ESC(p)}"]`);
      if (again) again.focus();
      return;
    }
    const file = target.closest('.hd-tree-file');
    if (!file) return;
    activePath = file.dataset.path;
    for (const r of host.querySelectorAll('.hd-tree-file')) r.classList.toggle('active', r === file);
    const node = findByPath(nodes, activePath);
    if (node && onPick) onPick(node.entry, file);
  };

  host.addEventListener('click', (e) => act(e.target));
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    act(e.target);
  });

  paint();
  return host;
}

// Attribute-selector escaping: a path can contain quotes and backslashes.
function CSS_ESC(s) { return String(s).replace(/["\\]/g, '\\$&'); }

function findByPath(nodes, path) {
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (n.type === 'file') { if (n.path === path) return n; continue; }
    const found = findByPath(n.children, path);
    if (found) return found;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/file-tree.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: 2960 pass / 0 fail.

- [ ] **Step 6: Commit**

```bash
git add ui/public/file-tree.mjs test/file-tree.test.mjs
git commit -m "feat(ui): GitHub-style file tree module for the Diff tab"
```

---


## Task 5: Numbered, highlighted rows in the pane

**Files:**
- Modify: `ui/public/app.js:63` (imports), `ui/public/app.js:11172-11225` (`select` inside `buildHdDiff`)
- Modify: `ui/public/style.css:1912-1919`
- Test: `test/ui-history-detail.test.mjs` (extend, and update 9 existing assertions)

**Interfaces:**
- Consumes: `parseFileSection` numbering (Task 2); `langForPath`, `highlightParsed` (Task 3); `GET /vendor/hljs/...` (Task 1).
- Produces: each diff row is `<div class="hd-dl hd-dl-{kind}" data-path data-old data-new>` containing `<span class="hd-dl-n hd-dl-n-old">`, `<span class="hd-dl-n hd-dl-n-new">`, `<span class="hd-dl-code">`. The code cell's `textContent` is the sign plus the line text, unchanged from today's row `textContent`.

- [ ] **Step 1: Update the existing assertions that read a row's textContent**

Nine assertions in `test/ui-history-detail.test.mjs` read a whole row where they now want the code cell. Change each `.hd-dl-add` / `.hd-dl-del` **content** read to go through `.hd-dl-code` — lines 834, 835, 836, 1036, 1037, 1043, 1044, 1273. Line 908 (`assert.equal(pane.querySelector('.hd-dl-add'), null, …)`) asserts absence and stays as it is.

Example — `test/ui-history-detail.test.mjs:834-836` becomes:

```js
  // ASCII +/- in the patch BODY on purpose: these lines are a verbatim unified
  // diff a user may copy, and a U+2212 yields a patch `git apply` rejects. The
  // sign lives INSIDE the code cell so a copy still produces an appliable patch;
  // the number gutters are user-select:none.
  assert.equal(pane.querySelector('.hd-dl-add .hd-dl-code').textContent, '+new');
  assert.equal(pane.querySelector('.hd-dl-del .hd-dl-code').textContent, '-old');
  assert.equal(pane.querySelector('.hd-dl-hunk').textContent, '@@ -1,2 +1,2 @@');
```

- [ ] **Step 2: Write the failing tests**

Append to the Diff-tab section of `test/ui-history-detail.test.mjs`:

```js
test('every row carries its old and new line numbers', async () => {
  const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const pane = paneOf(ctx.window.document);

  // PATCH is @@ -1,2 +1,2 @@ over ' keep', '-old', '+new'.
  const rows = [...pane.querySelectorAll('.hd-dl:not(.hd-dl-hunk)')];
  const nums = rows.map((r) => [
    r.querySelector('.hd-dl-n-old').textContent,
    r.querySelector('.hd-dl-n-new').textContent,
  ]);
  assert.deepEqual(nums, [['1', '1'], ['2', ''], ['', '2']]);
});

test('every row carries the anchors a future comments feature needs', async () => {
  // spec D11: cheap now, and it is the whole addressing substrate for threads.
  const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const rows = [...paneOf(ctx.window.document).querySelectorAll('.hd-dl:not(.hd-dl-hunk)')];
  assert.deepEqual(rows.map((r) => [r.dataset.path, r.dataset.old, r.dataset.new]), [
    ['src/a.js', '1', '1'],
    ['src/a.js', '2', ''],
    ['src/a.js', '', '2'],
  ]);
});

test('the hunk header spans the gutters and carries no numbers', async () => {
  const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const hunk = paneOf(ctx.window.document).querySelector('.hd-dl-hunk');
  assert.equal(hunk.querySelector('.hd-dl-n'), null);
  assert.equal(hunk.textContent, '@@ -1,2 +1,2 @@');
});

test('without a highlighter the pane renders plain rows and still numbers them', async () => {
  // jsdom cannot resolve import('/vendor/hljs/...'), so this is the default in
  // every other test in this file — the degradation path from spec §6.
  const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const pane = paneOf(ctx.window.document);
  assert.equal(pane.querySelector('[class^="hljs-"]'), null, 'no token markup without a highlighter');
  assert.equal(pane.querySelector('.hd-dl-add .hd-dl-code').textContent, '+new');
  assert.equal(pane.querySelector('.hd-dl-add .hd-dl-n-new').textContent, '2');
});

test('with a highlighter present the code cell is tokenized and its text is unchanged', async () => {
  const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(JS_PATCH) });
  // Stand in for the module app.js would have imported from /vendor/hljs.
  ctx.window.__worcaHljs = HLJS;
  await openDetail(ctx);
  await settle(ctx.window);
  const pane = paneOf(ctx.window.document);

  const add = pane.querySelector('.hd-dl-add .hd-dl-code');
  assert.match(add.innerHTML, /<span class="hljs-keyword">const<\/span>/);
  // The copy contract survives highlighting: sign + exact source, no numbers.
  assert.equal(add.textContent, "+const greeting = 'hi';");
});

test('an unhighlightable file still renders — the pane never depends on the highlighter', async () => {
  const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
  // A highlighter that throws is indistinguishable to the pane from a missing one.
  ctx.window.__worcaHljs = {
    getLanguage: () => ({}),
    highlight() { throw new Error('boom'); },
  };
  await openDetail(ctx);
  await settle(ctx.window);
  const pane = paneOf(ctx.window.document);
  assert.equal(pane.querySelector('[class^="hljs-"]'), null);
  assert.equal(pane.querySelector('.hd-dl-add .hd-dl-code').textContent, '+new');
});

test('the tint invariant holds: the code column is the one that stretches', async () => {
  // style.css:1903-1911 records a measured regression — per-row max-content sizing
  // produced 11 different row widths in a 336-row patch and tint bands that
  // stopped mid-pane. The grid moved from one column to three; the property that
  // fixed it must survive that move.
  const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
  const body = /\.hd-diff-body\{[^}]*\}/.exec(css)[0];
  assert.match(body, /grid-template-columns:max-content max-content minmax\(max-content,1fr\)/,
    'the code column keeps minmax(max-content,1fr) — the widest ROW sizes it, not each row itself');
  assert.match(css, /\.hd-dl\{display:contents;\}/,
    'rows are display:contents so their three cells are the grid items and columns align');
  assert.match(css, /\.hd-dl-add \.hd-dl-n,\.hd-dl-add \.hd-dl-code\{background:var\(--green-bg\);\}/,
    'display:contents paints no background, so the tint must live on the cells');
});
```

Add the fixtures next to `PATCH` (`test/ui-history-detail.test.mjs:785`):

```js
// A patch whose content is real JavaScript, for the highlighting path.
const JS_PATCH = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -1,2 +1,2 @@
 keep
-const greeting = "old";
+const greeting = 'hi';
`;
```

and, at the top of the file next to the other imports:

```js
// The same package the browser dynamic-imports from /vendor/hljs. jsdom cannot
// resolve that URL, so tests that want the highlighting path inject this instead.
const HLJS = (await import('@highlightjs/cdn-assets/es/core.min.js')).default;
HLJS.registerLanguage('javascript',
  (await import('@highlightjs/cdn-assets/es/languages/javascript.min.js')).default);
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-detail.test.mjs`
Expected: FAIL — `.hd-dl-code` is null, so the updated assertions throw on `textContent` of null.

- [ ] **Step 4: Extend the app.js imports**

At `ui/public/app.js:63`, extend the diff-view import and add the highlighter:

```js
import { splitPatchSections, parseFileSection, patchIndex, sectionKey } from './diff-view.mjs';
import { langForPath, highlightParsed } from './syntax-highlight.mjs';
```

- [ ] **Step 5: Add the highlighter loader and the row builder**

Insert immediately above `function buildHdDiff` (`ui/public/app.js:11101`):

```js
// highlight.js is reached by dynamic import from the /vendor/hljs mount — no
// script tag, no global, no loader plugin. Core registers NO grammars, so every
// language is its own import, memoized here. `window.__worcaHljs` is the test
// seam: jsdom cannot resolve those URLs, so suites inject an instance instead.
//
// Everything is best-effort. Any miss returns null and the pane renders the
// plain rows it rendered before highlighting existed.
let hdHljsCore = null;
const hdHljsLangs = new Map();
async function hdHighlighterFor(path) {
  const lang = langForPath(path);
  if (!lang) return null;                          // unmapped extension
  if (!hdHljsCore) {
    hdHljsCore = window.__worcaHljs
      ? Promise.resolve(window.__worcaHljs)
      : import('/vendor/hljs/es/core.min.js').then((m) => m.default).catch(() => null);
  }
  const hljs = await hdHljsCore;
  if (!hljs) return null;                          // not installed, or offline
  if (!hljs.getLanguage(lang)) {
    if (!hdHljsLangs.has(lang)) {
      // `lang` is a value from syntax-highlight.mjs's fixed table, never a path.
      hdHljsLangs.set(lang, import(`/vendor/hljs/es/languages/${lang}.min.js`)
        .then((m) => { hljs.registerLanguage(lang, m.default); })
        .catch(() => {}));
    }
    await hdHljsLangs.get(lang);
    // highlight() THROWS on an unregistered id and logs a warning, so this gate
    // is load-bearing, not defensive decoration.
    if (!hljs.getLanguage(lang)) return null;
  }
  // ignoreIllegals: a hunk side is a fragment — half an if, an unterminated
  // string — and grammars that define illegal rules would otherwise throw.
  return { lang, highlight: (text, l) => hljs.highlight(text, { language: l, ignoreIllegals: true }).value };
}

// One diff row: two number gutters plus the code cell.
//
// The +/- sign is a span INSIDE the code cell rather than a fourth column, so
// `.hd-dl-code`'s text stays "+import x" and a copied selection is still a patch
// `git apply` accepts (app.js's original note, preserved). The gutters are
// user-select:none in CSS, so they never join that selection.
//
// data-path/-old/-new are the anchors a future line-comments feature needs
// (spec D11): they cost nothing now and save a re-render pass later.
function hdDiffRow(line, path) {
  const row = document.createElement('div');
  row.className = `hd-dl hd-dl-${line.kind}`;
  row.dataset.path = path;
  row.dataset.old = line.oldNo == null ? '' : String(line.oldNo);
  row.dataset.new = line.newNo == null ? '' : String(line.newNo);
  const oldN = document.createElement('span');
  oldN.className = 'hd-dl-n hd-dl-n-old';
  oldN.textContent = row.dataset.old;
  const newN = document.createElement('span');
  newN.className = 'hd-dl-n hd-dl-n-new';
  newN.textContent = row.dataset.new;
  const code = document.createElement('span');
  code.className = 'hd-dl-code';
  const sign = document.createElement('span');
  sign.className = 'hd-dl-sign';
  sign.textContent = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
  code.appendChild(sign);
  if (typeof line.html === 'string') {
    // Built by syntax-highlight.mjs from highlight.js's own escaped output, with
    // every class name filtered to [A-Za-z0-9 _-] there.
    const span = document.createElement('span');
    span.innerHTML = line.html;
    code.appendChild(span);
  } else {
    code.appendChild(document.createTextNode(line.text));
  }
  row.append(oldN, newN, code);
  return row;
}
```

- [ ] **Step 6: Rewire the render loop**

In `select`, replace `ui/public/app.js:11196-11224` — everything from `const parsed = parseFileSection(section.raw);` down to and including the `pane.appendChild(body);` at `:11224` that follows the truncation note:

```js
    const parsed = parseFileSection(section.raw);
    if (parsed.binary || !parsed.hunks.length) {
      body.classList.add('hint');
      body.textContent = '(no textual diff for this file)';
      pane.appendChild(body);
      return;
    }

    // Best-effort: core and the grammar may both need fetching, which means
    // another await and therefore another epoch check before touching the pane.
    const hl = await hdHighlighterFor(entry.f.path);
    if (epoch !== pstate.selEpoch) return;
    if (hl) highlightParsed(parsed, hl.lang, hl.highlight);

    // Both gutters get the same width so the sticky offset of the second one is a
    // single value. border-box is global (style.css:52), so the padding is in it.
    let widest = 0;
    for (const hunk of parsed.hunks) {
      for (const line of hunk.lines) widest = Math.max(widest, line.oldNo || 0, line.newNo || 0);
    }
    body.style.setProperty('--gut', `calc(${String(widest || 1).length}ch + 16px)`);

    for (const hunk of parsed.hunks) {
      const hh = document.createElement('div');
      hh.className = 'hd-dl hd-dl-hunk';
      hh.textContent = hunk.header;
      body.appendChild(hh);
      for (const line of hunk.lines) body.appendChild(hdDiffRow(line, entry.f.path));
    }
    if (parsed.truncated) {
      const t = document.createElement('div');
      t.className = 'hint hd-diff-trunc';
      t.textContent = '(large file — diff truncated at 500 KB)';
      body.appendChild(t);
    }
    pane.appendChild(body);
```

- [ ] **Step 7: Update the CSS**

Replace `ui/public/style.css:1912-1919` (from `.hd-diff-body{` through `.hd-dl-del{…}`) with:

```css
/* Three columns now — old gutter, new gutter, code — but the property the
   comment above is about is unchanged: the CODE column is still
   minmax(max-content,1fr), so the WIDEST ROW sizes it and every tint band spans
   the pane. Rows are display:contents so their cells are the grid's items and
   the two gutters line up across every row; that also means a row paints no
   background of its own, so the tint moved onto the cells. */
.hd-diff-body{padding:12px 0;font:400 12px/1.85 var(--mono);color:var(--ink-2);
  display:grid;grid-template-columns:max-content max-content minmax(max-content,1fr);
  max-height:520px;overflow-x:auto;overflow-y:auto;}
.hd-diff-body.hint,.hd-diff-none{padding:18px;display:block;}
.hd-dl{display:contents;}
/* Same specificity as `.hd-dl`, so this MUST stay below it to win. */
.hd-dl-hunk{display:block;grid-column:1/-1;padding:0 18px;white-space:pre;
  color:var(--ink-3);background:var(--field);}
.hd-dl-n{min-width:var(--gut,4ch);padding:0 8px;text-align:right;white-space:pre;
  color:var(--ink-3);background:var(--panel);position:sticky;
  user-select:none;-webkit-user-select:none;}
.hd-dl-n-old{left:0;}
.hd-dl-n-new{left:var(--gut,4ch);}
.hd-dl-code{padding:0 18px 0 0;white-space:pre;}
.hd-dl-sign{user-select:auto;}
.hd-dl-add .hd-dl-n,.hd-dl-add .hd-dl-code{background:var(--green-bg);}
.hd-dl-del .hd-dl-n,.hd-dl-del .hd-dl-code{background:var(--red-bg);}

/* highlight.js tokens, scoped to the pane. Hand-written against the :root
   palette rather than shipping one of hljs's themes: they assume their own
   background and fight this one. Class list per hljs 11 CSS class reference. */
.hd-diff-body .hljs-comment,.hd-diff-body .hljs-quote{color:#6A737D;font-style:italic;}
.hd-diff-body .hljs-punctuation{color:#5B6167;}
.hd-diff-body .hljs-keyword,.hd-diff-body .hljs-selector-tag,
.hd-diff-body .hljs-literal,.hd-diff-body .hljs-doctag{color:#D73A49;}
.hd-diff-body .hljs-string,.hd-diff-body .hljs-regexp,
.hd-diff-body .hljs-addition,.hd-diff-body .hljs-attribute,
.hd-diff-body .hljs-meta .hljs-string{color:#032F62;}
.hd-diff-body .hljs-number,.hd-diff-body .hljs-variable,
.hd-diff-body .hljs-template-variable,.hd-diff-body .hljs-attr,
.hd-diff-body .hljs-selector-attr,.hd-diff-body .hljs-selector-pseudo{color:#005CC5;}
.hd-diff-body .hljs-title,.hd-diff-body .hljs-section,
.hd-diff-body .hljs-title.function_,.hd-diff-body .hljs-title.class_{color:#6F42C1;}
.hd-diff-body .hljs-type,.hd-diff-body .hljs-built_in,
.hd-diff-body .hljs-class .hljs-title{color:#E36209;}
.hd-diff-body .hljs-meta,.hd-diff-body .hljs-symbol,.hd-diff-body .hljs-bullet,
.hd-diff-body .hljs-link{color:#005CC5;}
.hd-diff-body .hljs-deletion{color:#B31D28;}
.hd-diff-body .hljs-emphasis{font-style:italic;}
.hd-diff-body .hljs-strong{font-weight:700;}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-detail.test.mjs`
Expected: PASS — the 7 new tests plus all pre-existing ones.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: 2967 pass / 0 fail.

- [ ] **Step 10: Commit**

```bash
git add ui/public/app.js ui/public/style.css test/ui-history-detail.test.mjs
git commit -m "feat(ui): line-number gutters and syntax highlighting in the diff pane"
```

---

## Task 6: The tree replaces the flat file list

**Files:**
- Modify: `ui/public/app.js:63` (imports), `ui/public/app.js:11227-11266` (the row loop in `buildHdDiff`)
- Modify: `ui/public/style.css:1873-1889`
- Test: `test/ui-history-detail.test.mjs` (extend)

**Interfaces:**
- Consumes: `buildFileTree`, `renderFileTree`, `firstFile` (Task 4); `hdDiffFileRows` and `hdFileCountsHtml` unchanged (`app.js:11079`, `app.js:11095`).
- Produces: `.hd-diff-rows` now hosts a `.hd-tree`. `.hd-diff-proj` is gone; project keys are tree roots.

- [ ] **Step 1: Write the failing tests**

Append to `test/ui-history-detail.test.mjs`:

```js
test('the file list is a tree, and its file rows still drive the pane', async () => {
  const results = diffResults({ results: { changedFiles: [
    { path: 'ui/public/app.js', status: 'M', added: 2, removed: 1 },
    { path: 'ui/public/style.css', status: 'M', added: 1, removed: 0 },
    { path: 'README.md', status: 'M', added: 1, removed: 0 },
  ]}});
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const doc = ctx.window.document;

  // "ui" holds only "public", so they render as one row.
  const dirs = [...doc.querySelectorAll('#hist-detail .hd-tree-dir .hd-tree-name')].map((n) => n.textContent);
  assert.deepEqual(dirs, ['ui/public']);
  const files = [...doc.querySelectorAll('#hist-detail .hd-tree-file .hd-diff-path')].map((n) => n.textContent);
  assert.deepEqual(files, ['app.js', 'style.css', 'README.md']);

  // The pane still follows a click, through the same select() it always did.
  click(ctx.window, [...doc.querySelectorAll('#hist-detail .hd-tree-file')][1]);
  await settle(ctx.window);
  assert.match(doc.querySelector('#hist-detail .hd-diff-pane-head').textContent, /ui\/public\/style\.css/);
});

test('the tree auto-selects the first file exactly as the flat list did', async () => {
  const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const doc = ctx.window.document;
  assert.ok(doc.querySelector('#hist-detail .hd-tree-file').classList.contains('active'));
  assert.equal(doc.querySelectorAll('#hist-detail .hd-diff-body').length, 1);
});

test('per-file count chips survive the move into the tree', async () => {
  const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const row = ctx.window.document.querySelector('#hist-detail .hd-tree-file');
  assert.match(row.querySelector('.hd-diff-counts').textContent, /\+1/);
  assert.match(row.querySelector('.hd-diff-counts').textContent, /−1/, 'U+2212 stays in COUNT chips');
});

test('a workspace run roots the tree at each project key instead of a group header', async () => {
  const ctx = await bootDetail({ detail: diffDetail(WORKSPACE_RESULTS), arms: patchArm(WORKSPACE_PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd-diff-proj'), null, 'the group header is retired');
  const roots = [...doc.querySelectorAll('#hist-detail .hd-tree-dir')]
    .filter((el) => el.dataset.depth === '0')
    .map((el) => el.querySelector('.hd-tree-name').textContent);
  assert.deepEqual(roots, ['proj-a', 'proj-b']);
});

test('collapsing a directory hides its files without touching the pane', async () => {
  const results = diffResults({ results: { changedFiles: [
    { path: 'ui/public/app.js', status: 'M', added: 2, removed: 1 },
    { path: 'README.md', status: 'M', added: 1, removed: 0 },
  ]}});
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const doc = ctx.window.document;
  const headBefore = doc.querySelector('#hist-detail .hd-diff-pane-head').textContent;

  click(ctx.window, doc.querySelector('#hist-detail .hd-tree-dir'));
  await settle(ctx.window);
  assert.equal(doc.querySelectorAll('#hist-detail .hd-tree-file').length, 1);
  assert.equal(doc.querySelector('#hist-detail .hd-diff-pane-head').textContent, headBefore,
    'toggling a folder is not a selection change');
});
```

Reuse the existing workspace fixtures if `test/ui-history-detail.test.mjs:1029` already defines them under other names; otherwise add beside `PATCH`:

```js
const WORKSPACE_RESULTS = {
  summary: { filesNew: 0, filesChanged: 2, filesDeleted: 0, linesAdded: 2, linesRemoved: 1, blockingIssues: 0, nitpicks: 0 },
  perProject: {
    'proj-a': { newFiles: [], changedFiles: [{ path: 'src/one.js', status: 'M', added: 1, removed: 1 }] },
    'proj-b': { newFiles: [], changedFiles: [{ path: 'src/two.js', status: 'M', added: 1, removed: 0 }] },
  },
  keyThingsToCheck: [], nitpicks: [],
};
const WORKSPACE_PATCH = `# proj-a
diff --git a/src/one.js b/src/one.js
--- a/src/one.js
+++ b/src/one.js
@@ -1,2 +1,2 @@
 keep
-one
+alpha
# proj-b
diff --git a/src/two.js b/src/two.js
--- a/src/two.js
+++ b/src/two.js
@@ -1,1 +1,2 @@
 keep
+beta
`;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-detail.test.mjs`
Expected: FAIL — no `.hd-tree-dir` exists.

- [ ] **Step 3: Extend the app.js imports**

At `ui/public/app.js:64` (below the syntax-highlight import added in Task 5):

```js
import { buildFileTree, renderFileTree, firstFile } from './file-tree.mjs';
```

- [ ] **Step 4: Replace the row loop**

In `buildHdDiff`, replace `ui/public/app.js:11227-11266` — from `let lastProject = null;` at `:11227` through the `}` at `:11266` that closes the `else` appending `.hd-diff-none`. Nothing above `:11227` and nothing from `:11267` (the function's closing brace) moves:

```js
  // The tree owns its own rows, its own collapse state and its own keyboard
  // handling; `select` is unchanged and still the only thing that paints the pane.
  const tree = buildFileTree(rows);
  const firstNode = firstFile(tree);
  const treeEl = renderFileTree(tree, {
    doc: document,
    // The tree owns the selection so a folder toggle repaints without losing it.
    initialPath: firstNode ? firstNode.path : null,
    counts: (entry) => {
      const el = document.createElement('span');
      el.className = 'mono hd-diff-counts';
      el.innerHTML = hdFileCountsHtml(entry.f);
      return el;
    },
    // `select` is async and fire-and-forget from both call sites, so it needs an
    // explicit sink: node --test fails the WHOLE file on an unhandled rejection
    // and pins it on whichever test happens to be in flight.
    onPick: (entry, rowEl) => { select(rowEl, entry).catch(() => {}); },
  });
  rowsHost.appendChild(treeEl);

  if (firstNode) {
    select(treeEl.querySelector('.hd-tree-file.active'), firstNode.entry).catch(() => {});
  } else {
    const none = document.createElement('div');
    none.className = 'hint hd-diff-none';
    none.textContent = '(no files changed)';
    pane.appendChild(none);
  }
```

- [ ] **Step 5: Add the tree CSS**

Replace `ui/public/style.css:1874` (the `.hd-diff-proj` rule, now dead) and add tree rules after `.hd-diff-file`'s existing block (`style.css:1875-1889`), keeping every existing `.hd-diff-file` rule intact — the tree's file rows still carry that class:

```css
/* .hd-diff-proj is retired: a workspace run's project key is now a tree root. */
.hd-tree{display:flex;flex-direction:column;}
.hd-tree-dir,.hd-tree-file{display:flex;align-items:center;gap:8px;
  padding:7px 12px 7px calc(12px + var(--depth,0) * 16px);border-radius:9px;cursor:pointer;}
.hd-tree-dir:hover{background:var(--field);}
.hd-tree-dir:focus-visible,.hd-tree-file:focus-visible{outline:2px solid var(--ink);outline-offset:-2px;}
.hd-tree-name{font-size:12.5px;font-weight:600;color:var(--ink);
  min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.hd-tree-chev,.hd-tree-ico{display:grid;place-items:center;flex:0 0 auto;}
.hd-tree-chev svg{width:14px;height:14px;color:var(--ink-3);transition:transform .12s ease;}
.hd-tree-dir[aria-expanded="true"] .hd-tree-chev svg{transform:rotate(90deg);}
.hd-tree-ico svg{width:16px;height:16px;}
.hd-tree-folder svg{color:#54A0E8;}
.hd-tree-file .hd-tree-ico svg{color:var(--ink-3);}
.hd-tree-file.st-add .hd-tree-ico svg{color:var(--green-ink);}
.hd-tree-file.st-del .hd-tree-ico svg{color:var(--red-ink);}
/* A file row has no chevron, so it indents by one chevron's worth to line its
   icon up under the folder icon of the directory above it. */
.hd-tree-file{padding-left:calc(28px + var(--depth,0) * 16px);}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-detail.test.mjs`
Expected: PASS. The pre-existing workspace test at `test/ui-history-detail.test.mjs:1029` asserts `.hd-diff-proj` group headers — update it to read the tree roots the way the new workspace test does, and keep its `.hd-dl-add .hd-dl-code` assertions from Task 5.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: 2972 pass / 0 fail.

- [ ] **Step 8: Verify in the real browser**

Highlighting cannot be proven under jsdom — it never runs the `<script>` tags. Confirm the real path once:

```bash
npm start
```

Open `http://localhost:4317`, go to History → any completed run → Diff. Check, in order:
1. Code is coloured, and the colours are stable while scrolling.
2. Both gutters show numbers, deletes have only a left number, adds only a right one.
3. Scroll a wide file horizontally — the gutters stay pinned.
4. Select rows across an add/delete boundary and copy: the clipboard has `+`/`-` signs and **no** line numbers.
5. Open `.py`, `.rs` and `.go` files and confirm in DevTools → Network that `es/core.min.js` is fetched once and `es/languages/<lang>.min.js` once per language, both from `/vendor/hljs/`, and that the code colours.
6. Collapse and expand a folder; the pane keeps its selection.

- [ ] **Step 9: Commit**

```bash
git add ui/public/app.js ui/public/style.css test/ui-history-detail.test.mjs
git commit -m "feat(ui): replace the diff file list with a collapsible file tree"
```

---


## Self-review

**Spec coverage:**

| Spec item | Task |
|---|---|
| D1 dependency + mount, no script tag | 1 |
| D2 per-hunk, per-side | 3 (`highlightHunk`), 5 (wiring) |
| D3 all languages, lazily imported | 1 (mount), 5 (`hdHighlighterFor`) |
| D4 tree replaces the list | 4, 6 |
| D5 dual gutters | 2 (numbers), 5 (DOM + CSS) |
| D6 copy stays appliable | 5 (sign in the code cell, `user-select:none` gutters) |
| D7 degradation | 3 (bail paths), 5 (fallback tests) |
| D8 pure, injected | 3 |
| D9 project keys as roots | 4, 6 |
| D10 in-memory collapse state | 4 |
| D11 `data-path`/`data-old`/`data-new` anchors | 5 |
| §5 tint invariant | 5 (Step 7 CSS + its regression test) |
| §6 degradation table | 1 (mount try/catch, `/vendor/` 404), 3 (guards), 5 (tests) |
| §7 test matrix | 1, 2, 3, 4, 5, 6 |
| §9 provenance pinned by a test | 1 |

**Naming consistency:** `highlightParsed(parsed, lang, highlight)` is defined in Task 3 and called with that exact signature in Task 5. `langForPath` returns the same canonical hljs ids Task 5's loader interpolates into `es/languages/<id>.min.js`. `buildFileTree`/`renderFileTree`/`firstFile`/`fileStatus` are defined in Task 4 and used with those names in Task 6. `hunkRange` is defined in Task 2 and imported by name in that task's test. `hdDiffRow` and `hdHighlighterFor` are defined and used within Task 5. `--gut` is written by Task 5 Step 6 and read by Task 5 Step 7's CSS. `window.__worcaHljs` is the test seam, introduced in Task 5 Step 5 and used by Task 5 Step 2's tests.

**Cumulative pass counts:** 2926 baseline → 2933 (T1, +7) → 2936 (T2, +3) → 2949 (T3, +13) → 2960 (T4, +11) → 2967 (T5, +7) → 2972 (T6, +5). Treat a different total with zero failures as fine; treat any failure as a regression.

**Known soft spot:** Task 1's provenance test and Task 3's test both use top-level `await import(...)` in a test file. Node 22 supports it in ESM; if the runner objects, hoist the awaits into `before()` and declare the bindings with `let`. This is called out inline in Task 1 Step 3.
