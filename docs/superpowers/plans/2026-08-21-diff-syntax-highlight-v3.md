# Diff syntax highlighting, line numbers, and file tree — implementation plan (v3)

**Date:** 2026-08-21

**Baseline:** `2b799cab` on `dev`

**Related design:** `docs/superpowers/specs/2026-08-21-diff-syntax-highlight-design.md`

**Supersedes:** `docs/superpowers/plans/2026-08-21-diff-syntax-highlight-v2.md`

## Outcome

Make History detail's Diff tab easier to scan while keeping the current patch viewer usable when syntax highlighting is missing, slow, invalid, or too expensive:

- syntax-highlight a reviewed set of text-file types;
- show old and new line-number gutters;
- replace the flat file list with a collapsible, project-scoped file tree;
- render numbered plain rows before any highlighter work completes;
- preserve the existing patch-fetch retry and stale-selection protections;
- preserve exact source text and ASCII diff prefixes in the selectable code cells.

This is an implementation plan, not authorization to implement it. An implementation run must not commit, push, reset, stage files, or clean unrelated user content unless separately authorized.

## Baseline facts verified for this revision

- `HEAD` is `2b799cab4cb6e2c8a47ec9f82c8b44fabc8e6e21` on `dev`.
- The package is ESM-only, requires Node `>=22.13.0`, has no browser build step, and serves `ui/public/` directly.
- `buildHdDiff`, `hdDiffFileRows`, and `hdFileCountsHtml` are in `ui/public/app.js`; patch parsing is in `ui/public/diff-view.mjs`.
- `buildHdDiff` already has two load-bearing race controls: one retryable `patchPromise` and a monotonic `selEpoch`.
- Workspace result rows can share a relative path under different project keys. `sectionKey(project, path)` already scopes the patch index correctly.
- `@highlightjs/cdn-assets@11.12.0` contains 193 `es/languages/*.min.js` files, a 20.5 KB grammar-free `es/core.min.js`, and `es/package.json` with `{"type":"module"}`. Its reviewed tarball integrity is `sha512-KvOKXODaiFmId9xaq3xc5xCL66wVLUuOngDbO9B/kewbFTqdGbn2nJxNhN3H5R1cgDTVj6R8vH0zgiNDEGjpDw==`.
- The CDN core default export is an object; grammar defaults are functions. Use `core.default.newInstance()` in behavioral tests so registrations cannot leak between tests.
- Real highlight.js output is not limited to `hljs-*`: embedded sublanguages use safe wrappers such as `<span class="language-javascript">`.
- `parseFileSection` currently truncates by JavaScript string length (UTF-16 code units), despite naming the cap `MAX_FILE_SECTION_BYTES` and displaying “500 KB”. This revision makes that existing limit truthful; the separate highlighting budget is measured in actual UTF-8 bytes.
- The root of `package-lock.json` currently contains a stale `worca-app` bin entry that `package.json` does not contain. `npm install` may normalize that baseline inconsistency; review and explain the lock diff instead of claiming that exactly one lock stanza must change.
- The working tree already contains unrelated untracked content under `docs/superpowers/` and `marketing/`. Preserve it.

Use symbol and selector names as edit anchors. Do not use the source line numbers recorded in older plans.

## Corrections made after reviewing v2

| v2 gap or bug | v3 correction |
|---|---|
| The language map was described as “preserve v1” rather than specified. | Task 3 contains the complete reviewed extension/name map and exports its canonical IDs. |
| The design allowed any shipped grammar filename to be served even though the loader supports only the reviewed map. | Task 3 makes `SUPPORTED_LANGUAGE_IDS` the shared loader/server allowlist; a shipped but unmapped grammar is an intentional plain 404. |
| Reserving `/vendor` from the SPA fallback would still leave Express's default HTML 404. | Task 1 adds an explicit plain-text, `no-store` `/vendor` miss handler before public static delivery. |
| Removing a rejected Promise was treated as a portable native-import retry. | Task 4 gives each retry a monotonically increasing query URL (`?retry=N`) as well as evicting the application Promise. |
| One accumulating highlight.js instance makes output depend on file-selection order because grammars discover already-registered sublanguages. | Task 4 imports the core module once but caches one isolated `newInstance()` per primary language, with only that grammar registered; order-independence is tested against the pinned package. |
| Valid sublanguage wrappers such as `language-javascript` would be rejected. | The strict row parser accepts a first class token beginning with `hljs-` **or** `language-`; every tag, attribute, and class token remains constrained. |
| Structurally safe highlighted HTML could silently change source text. | Task 6 stages every highlighted hunk in detached DOM, verifies exact per-row `textContent`, then commits the whole hunk or none of it. |
| The size guard ran only after a grammar had loaded. | `canHighlightParsed` performs the same UTF-8/per-side preflight before any vendor request; `highlightParsed` repeats it defensively. |
| Highlight-work limits did not bound the permanent plain DOM for a diff containing hundreds of thousands of tiny rows. | Task 2 adds a separate 5,000-item base-render cap that stops at a row boundary and drives the same honest truncation state. |
| The parser's 500,000-unit cap was named and displayed as bytes/KB. | Task 2 renames it to `MAX_FILE_SECTION_CODE_UNITS`; Task 6 uses the honest message “large file — diff truncated”. |
| The loader contract did not spell out returning `hljs.highlight(...).value`. | Task 4's bound closure does so explicitly and pins `{ language, ignoreIllegals:true }`. |
| `.hd-dl{display:contents}` would also erase the hunk row's grid box. | Only source rows receive `.hd-dl-row{display:contents}`; hunk, truncation, and note rows remain real grid items spanning `1 / -1`. |
| Three-column grid styling would place direct-text error/binary states in the first gutter. | `.hd-diff-body.hint` explicitly uses `display:block`. |
| Highlight application had no dedicated source node. | Every code cell contains a permanent sign node plus a separate `.hd-dl-src` node; only the latter is enhanced. |
| Author tree-group display rules could defeat the user-agent `[hidden]` rule. | `.hd-tree-group[hidden]{display:none}` is explicit and tested. |
| The tree renderer contract did not cleanly connect scoped initial selection to pane painting. | `renderFileTree` owns active state by opaque key and calls `onPick(entry, key)`; the app separately invokes `select(first.entry, first.key)` once. |
| Final `git diff` commands omitted every new untracked module/test. | The final audit lists new paths explicitly and reviews them with `sed`; tests import each new module, and a separate whitespace scan covers untracked files. |

## Architecture and ownership

| File | Responsibility |
|---|---|
| `package.json`, `package-lock.json` | exact `@highlightjs/cdn-assets@11.12.0` runtime dependency |
| `ui/server.mjs` | resolve and narrowly serve core/grammar ESM; explicit non-HTML vendor misses |
| `ui/public/diff-view.mjs` | parse hunk ranges and attach dual line numbers |
| `ui/public/syntax-highlight.mjs` (new) | exact language map, work preflight, strict row balancing, per-side/per-hunk highlighting |
| `ui/public/hljs-loader.mjs` (new) | lazy core/grammar imports, one isolated instance per primary language, concurrent deduplication, successful caches, retry URLs |
| `ui/public/file-tree.mjs` (new) | project-scoped tree model and accessible one-build renderer |
| `ui/public/app.js` | tree/pane integration, plain-first DOM, stale guard, transactional DOM enhancement |
| `ui/public/style.css` | tree, three-column diff grid, sticky gutters, contrast-safe token palette |

No `ui/public/index.html` change is needed. Local support modules are static app imports; only highlight.js core and grammar assets are lazy.

## Global constraints

- Preserve the `/diff` endpoints, persisted patch artifact, and results payload shapes.
- Preserve `+`, `-`, and leading ASCII space inside `.hd-dl-code`; U+2212 remains count-chip-only.
- Do not claim selected rows form a complete `git apply` patch: the pane intentionally omits file headers. The guarantee is exact row-copy fidelity.
- Tree, line numbers, tint, file counts, binary/empty states, and patch errors do not depend on highlighting.
- No unvalidated highlighter string reaches connected DOM.
- A highlighter failure never clears or rebuilds already-rendered plain rows.
- Project plus path is identity; relative path alone is display data.
- Keep the one-fetch `patchPromise` behavior and extend `selEpoch`/connected-body checks through asynchronous highlighting.
- Do not add `highlight.js`, a build step, generated assets, vendored files, a script tag, or a production `window.hljs` global.
- Run focused tests after each task and the full suite at integration boundaries. Require zero failures; do not hard-code a total test count.

---

## Task 1 — Add the exact dependency and narrow asset delivery

**Files**

- Modify `package.json`
- Modify `package-lock.json`
- Modify `ui/server.mjs`
- Create `test/api-hljs-assets.test.mjs`

### 1.1 Install and inspect

Run:

```bash
npm install --save-exact @highlightjs/cdn-assets@11.12.0
```

Then verify:

- `dependencies["@highlightjs/cdn-assets"] === "11.12.0"`;
- no `highlight.js` dependency was added;
- the lock entry's integrity matches the reviewed tarball;
- any root-lock normalization, including removal of the stale `worca-app` bin, is understood and limited to npm's package metadata reconciliation.

### 1.2 Resolve once, serve narrowly, and terminate vendor misses

Add `createRequire` from `node:module`. Resolve the ESM core at module initialization, derive its sibling language directory, and warn once if resolution fails.

Register these routes **after** the localhost guard and **before** `express.static(PUBLIC_DIR, ...)`:

```js
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HLJS_LANGUAGE_FILE_RE = /^[a-z0-9][a-z0-9-]{0,63}\.min\.js$/;

function resolveHljsAssets(resolve = require.resolve, warn = (msg) => console.warn(msg)) {
  try {
    const core = resolve('@highlightjs/cdn-assets/es/core.min.js');
    return { core, languages: path.join(path.dirname(core), 'languages') };
  } catch (err) {
    warn(`[worca-ui] syntax-highlighter assets unavailable: ${err?.message || err}`);
    return null;
  }
}

const HLJS_ASSETS = resolveHljsAssets();

// ... localhost Host/Origin guard remains above this point ...
if (HLJS_ASSETS) {
  const sendHljsModule = (file) => (_req, res, next) => {
    res.type('text/javascript');
    res.set('X-Content-Type-Options', 'nosniff');
    res.sendFile(file, (err) => {
      if (!err) return;
      if (res.headersSent) return next(err);
      next(); // the scoped /vendor terminator below owns the clean 404
    });
  };
  app.get('/vendor/hljs/core.min.js', sendHljsModule(HLJS_ASSETS.core));
  app.get('/vendor/hljs/languages/:file', (req, res, next) => {
    const file = String(req.params.file || '');
    if (!HLJS_LANGUAGE_FILE_RE.test(file)) return next();
    const candidate = path.join(HLJS_ASSETS.languages, file);
    try {
      if (!fs.statSync(candidate).isFile()) return next();
    } catch {
      return next();
    }
    return sendHljsModule(candidate)(req, res, next);
  });
}

// This is deliberately before public static and the SPA fallback. It also
// covers the package-unavailable case and prevents Express's HTML final 404.
app.use('/vendor', (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  res.set('Cache-Control', 'no-store');
  const status = err?.status === 400 ? 400 : 404;
  res.status(status).type('text/plain').send(status === 400 ? 'Bad request' : 'Not found');
});
app.use('/vendor', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(404).type('text/plain').send('Not found');
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
```

The language regex makes interpolation path-safe. Query strings used by Task 4 retries do not affect Express route matching. Do not mount the package root and do not expose styles, package metadata, source maps, non-minified files, or directory listings.

### 1.3 API contract tests

Follow the repository's existing API harness exactly: `useTempHome(after)`, import `{app}` without binding the production server, attach it to an ephemeral `http.Server`, and fetch through `127.0.0.1` so the Host guard passes.

The initial test can use `javascript`; Task 3 expands it to every mapped ID. Export `resolveHljsAssets` through the existing `_testing` object and assert that an injected throwing resolver returns `null` and emits one warning. Also pin the package metadata and lock integrity in this suite; do not leave the “exact dependency” claim as a manual check.

Pin the HTTP contract:

```js
test('vendor core and a grammar are exact JavaScript ESM assets', async () => {
  for (const pathname of [
    '/vendor/hljs/core.min.js',
    '/vendor/hljs/languages/javascript.min.js',
    '/vendor/hljs/languages/javascript.min.js?retry=1',
  ]) {
    const res = await fetch(`${base}${pathname}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /javascript/i);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const source = await res.text();
    // The reviewed core is minified as `export{...}` while grammars use
    // `export default`; accept both real ESM spellings before importing it.
    assert.match(source, /export(?:\s+default|\s*\{)/);
    const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    assert.ok(mod.default, `${pathname} has a default export`);
  }
});

test('all vendor misses are plain 404s and never the SPA shell', async () => {
  for (const pathname of [
    '/vendor', '/vendor/', '/vendor/hljs/', '/vendor/hljs/package.json',
    '/vendor/hljs/languages/javascript.js',
    '/vendor/hljs/languages/missing.min.js',
    '/vendor/hljs/languages/%2e%2e%2fcore.min.js',
    '/vendor/hljs/languages/javascript.min.js.map',
  ]) {
    const res = await fetch(`${base}${pathname}`);
    assert.equal(res.status, 404, pathname);
    assert.doesNotMatch(res.headers.get('content-type') || '', /text\/html/i, pathname);
    assert.match(res.headers.get('cache-control') || '', /no-store/i, pathname);
    assert.doesNotMatch(await res.text(), /<!doctype html/i, pathname);
  }
});
```

Also assert that `index.html` has no highlighter script tag, `/vendorish` still receives the SPA shell (the reservation is not overbroad), and an ordinary route such as `/history/example` still receives it. Keep this defense-in-depth check in the final SPA middleware even though the scoped terminator should make it unreachable:

```js
if (req.path === '/vendor' || req.path.startsWith('/vendor/')) return next();
```

Add a separate malformed-encoding request such as `/vendor/hljs/languages/%ZZ`. Express reports a path-decoding error before the normal terminator, so the scoped four-argument middleware must turn it into plain `400 text/plain` with `no-store`, never the framework's HTML error page. Keep the valid traversal-like case above at a plain 404.

Dependency assertions:

```js
assert.equal(pkg.dependencies['@highlightjs/cdn-assets'], '11.12.0');
assert.equal(pkg.dependencies['highlight.js'], undefined);
assert.equal(pkg.devDependencies['highlight.js'], undefined);
const locked = lock.packages['node_modules/@highlightjs/cdn-assets'];
assert.equal(locked.version, '11.12.0');
assert.equal(locked.integrity,
  'sha512-KvOKXODaiFmId9xaq3xc5xCL66wVLUuOngDbO9B/kewbFTqdGbn2nJxNhN3H5R1cgDTVj6R8vH0zgiNDEGjpDw==');
assert.notEqual(locked.dev, true);
assert.equal(lock.packages['node_modules/highlight.js'], undefined);
```

Run:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/api-hljs-assets.test.mjs
npm test
```

---

## Task 2 — Put dual line numbers in the parser model

**Files**

- Modify `ui/public/diff-view.mjs`
- Modify `test/diff-view.test.mjs`

### 2.1 Stable range contract

First rename the pre-existing section cap without changing its truncation algorithm:

```js
export const MAX_FILE_SECTION_CODE_UNITS = 500_000;
export const MAX_FILE_SECTION_RENDER_ITEMS = 5_000;
```

Update every reference and test import. Do not keep a misleading `*_BYTES` alias. This cap exists to bound parsing and remains based on `String#length`; Task 3 introduces a separate `TextEncoder`-measured UTF-8 budget for highlighter work.

The second cap bounds the permanent plain DOM, not syntax work: every retained hunk header and every retained source row consumes one render item. Once the next renderable item would exceed `MAX_FILE_SECTION_RENDER_ITEMS`, stop at that row boundary and set `truncated:true`. Binary markers and non-rendered file-header metadata consume no item. This is required independently of Task 3; a 500,000-code-unit diff can otherwise contain hundreds of thousands of tiny rows and create well over a million gutter/source DOM nodes before highlighting is even considered.

Export:

```text
hunkRange(header) -> { oldStart, oldCount, newStart, newCount } | null
```

Use an anchored unified-header parser. Combined diffs (`@@@`) and unsafe integers fail closed:

```js
const HUNK_RANGE_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;

export function hunkRange(header) {
  const raw = String(header || '');
  const m = HUNK_RANGE_RE.exec(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
  if (!m) return null;
  const values = [m[1], m[2] ?? '1', m[3], m[4] ?? '1'].map(Number);
  if (!values.every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  const [oldStart, oldCount, newStart, newCount] = values;
  const safeRange = (start, count) => {
    if (count === 0) return start >= 0;
    return start >= 1 && start <= Number.MAX_SAFE_INTEGER - (count - 1);
  };
  if (!safeRange(oldStart, oldCount) || !safeRange(newStart, newCount)) return null;
  return {
    oldStart, oldCount, newStart, newCount,
  };
}
```

Every hunk has the same shape. When parsing fails, all four range fields are `null`; do not omit them and do not attach temporary `_o`/`_n` properties.

### 2.2 Number rows with local counters

Replace the hunk creation/body-row branch with the equivalent of:

```js
const structuralLine = line.endsWith('\r') ? line.slice(0, -1) : line;
if (structuralLine.startsWith('Binary files ')
  || structuralLine === 'GIT binary patch') {
  res.binary = true;
  continue;
}
if (structuralLine.startsWith('@@')) {
  if (retainedItems >= MAX_FILE_SECTION_RENDER_ITEMS) {
    res.truncated = true;
    break;
  }
  retainedItems += 1;
  const range = hunkRange(structuralLine);
  hunk = {
    header: structuralLine,
    oldStart: range?.oldStart ?? null,
    oldCount: range?.oldCount ?? null,
    newStart: range?.newStart ?? null,
    newCount: range?.newCount ?? null,
    lines: [],
  };
  oldNo = range?.oldStart ?? null;
  newNo = range?.newStart ?? null;
  oldRemaining = range?.oldCount ?? 0;
  newRemaining = range?.newCount ?? 0;
  res.hunks.push(hunk);
  continue;
}
if (!hunk) continue;
if (line.startsWith('\\')) continue; // metadata, not a source row
if (retainedItems >= MAX_FILE_SECTION_RENDER_ITEMS) {
  res.truncated = true;
  break;
}
retainedItems += 1;

const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
const text = kind === 'ctx'
  ? (line.startsWith(' ') ? line.slice(1) : line)
  : line.slice(1);
const numbered = { kind, text, oldNo: null, newNo: null };
if (kind !== 'add' && oldNo != null && oldRemaining > 0) {
  numbered.oldNo = oldNo++;
  oldRemaining -= 1;
}
if (kind !== 'del' && newNo != null && newRemaining > 0) {
  numbered.newNo = newNo++;
  newRemaining -= 1;
}
hunk.lines.push(numbered);
```

Declare `retainedItems` and all four counter/remaining variables inside `parseFileSection`; initialize the former to zero and reset the counters on every hunk. Stopping at the declared count ensures a malformed overlong body never emits out-of-range or imprecise gutters. Existing `kind` and `text` behavior, including treatment of an unexpected unprefixed body line as context, stays unchanged.

Derive `structuralLine` once per loop iteration, as the snippet shows, and use it only for hunk-header and binary-marker recognition. Continue slicing body source from the original `line`, so a CRLF source row's `\r` is not silently discarded.

### 2.3 Parser tests

Cover:

- explicit counts and omitted counts defaulting to 1;
- `-0,0` / `+0,0`, plus rejection of a default-count range beginning at zero;
- values beyond `Number.MAX_SAFE_INTEGER`, and `MAX_SAFE_INTEGER,2` endpoint overflow, returning `null` and leaving the hunk unnumbered;
- context/delete/add sequencing;
- extra malformed body rows becoming unnumbered after the declared side count is exhausted;
- unrelated ranges in two hunks;
- malformed and combined headers;
- a CRLF hunk header parsing normally while a body row's trailing `\r` remains part of its exact source text;
- `\\ No newline at end of file` advancing neither counter and creating no row;
- truncated sections retaining sequential numbers for all retained rows;
- exactly `MAX_FILE_SECTION_RENDER_ITEMS` retained hunk/source items succeeding, the next renderable item setting `truncated:true` without being emitted, and a many-short-lines section never returning more than the cap;
- all existing `binary`, `truncated`, `kind`, and `text` assertions.

Rename the cap in existing truncation fixtures and add one multibyte case proving that the parser contract is deliberately code-unit-based. The UI-facing truncation message is corrected in Task 6.

Run:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/diff-view.test.mjs
```

---

## Task 3 — Build the bounded, strict, DOM-free highlighting module

**Files**

- Create `ui/public/syntax-highlight.mjs`
- Create `test/syntax-highlight.test.mjs`
- Modify `ui/server.mjs`
- Modify `test/api-hljs-assets.test.mjs`

### 3.1 Public contract and complete language map

Export exactly:

```text
langForPath(path) -> canonical language id | null
SUPPORTED_LANGUAGE_IDS -> frozen sorted array
rowsFromHtml(html) -> balanced HTML row strings | null
canHighlightParsed(parsed) -> boolean
highlightHunk(hunk, lang, highlight) -> boolean
highlightParsed(parsed, lang, highlight) -> boolean
MAX_HIGHLIGHT_INPUT_BYTES = 100_000
MAX_HIGHLIGHT_INPUT_ROWS = 3_000
MAX_HIGHLIGHT_OUTPUT_CHARS = 4_000_000
MAX_HIGHLIGHT_OUTPUT_ROWS = 3_000
MAX_HIGHLIGHT_OUTPUT_SPANS = 20_000
MAX_HIGHLIGHT_NESTING = 64
```

`highlight(text, lang)` is injected and returns only the `.value` string from highlight.js. This module neither imports highlight.js nor touches the DOM.

Use this reviewed map; do not copy an implied map from an older plan:

```js
export const MAX_HIGHLIGHT_INPUT_BYTES = 100_000;
export const MAX_HIGHLIGHT_INPUT_ROWS = 3_000;
export const MAX_HIGHLIGHT_OUTPUT_CHARS = 4_000_000;
export const MAX_HIGHLIGHT_OUTPUT_ROWS = 3_000;
export const MAX_HIGHLIGHT_OUTPUT_SPANS = 20_000;
export const MAX_HIGHLIGHT_NESTING = 64;

const BY_EXT = Object.freeze({
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
});

const BY_NAME = Object.freeze({
  dockerfile: 'dockerfile', makefile: 'makefile', gemfile: 'ruby',
  rakefile: 'ruby', vagrantfile: 'ruby', brewfile: 'ruby',
});

const codeUnitCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const SUPPORTED_LANGUAGE_IDS = Object.freeze(
  [...new Set([...Object.values(BY_EXT), ...Object.values(BY_NAME)])].sort(codeUnitCompare),
);
const SUPPORTED = new Set(SUPPORTED_LANGUAGE_IDS);

export function langForPath(pathname) {
  const base = String(pathname || '').split('/').pop() || '';
  const nameKey = base.toLowerCase();
  if (Object.hasOwn(BY_NAME, nameKey)) return BY_NAME[nameKey];
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null; // extensionless or a dotfile such as .gitignore
  const extKey = base.slice(dot + 1).toLowerCase();
  return Object.hasOwn(BY_EXT, extKey) ? BY_EXT[extKey] : null;
}
```

The `sass -> scss`, `fish -> bash`, and `toml -> ini` entries are deliberate best-effort mappings to shipped grammars. HCL/Terraform (`.hcl`, `.tf`), binaries, unknown extensions, and unreviewed extensionless names remain plain.

Once this module exists, make it the server's single grammar allowlist as well:

```js
import { SUPPORTED_LANGUAGE_IDS } from './public/syntax-highlight.mjs';

const HLJS_LANGUAGE_FILES = new Set(
  SUPPORTED_LANGUAGE_IDS.map((id) => `${id}.min.js`),
);

// Inside /vendor/hljs/languages/:file, before stat/sendFile:
if (!HLJS_LANGUAGE_FILE_RE.test(file) || !HLJS_LANGUAGE_FILES.has(file)) return next();
```

Keep the Task 1 filename regex as defense in depth. Extend the HTTP test with a grammar known to exist in the package but absent from the reviewed map, such as `brainfuck.min.js`, and require a plain no-store 404. This proves the server does not turn package inventory into public feature support.

### 3.2 Parse highlight output as a narrow language

Do not sanitize arbitrary markup into something acceptable. Parse only the exact subset emitted by the reviewed renderer, and reject everything else.

Allowed open-tag classes are:

```js
// Normal scopes can have tier classes such as "hljs-title class_". Embedded
// sublanguages use one "language-*" class. Arbitrary second classes are not
// allowed: the application has global classes such as .hidden.
const HLJS_CLASS_RE = /^(?:hljs-[A-Za-z0-9_-]+(?: [A-Za-z0-9-]+_+)*|language-[A-Za-z0-9_-]+)$/;
const OPEN_RE = /<span class="([^"]+)">/y;
const ENTITY_RE = /&(amp|lt|gt|quot|#x27);/y;
const TEXT_RE = /[^<&\n\u0000]+/y;
const ENTITIES = Object.freeze({
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'",
});
```

The internal parser returns both balanced markup and decoded text. Its core loop should have this shape:

```js
function parseHighlightedRows(html) {
  if (typeof html !== 'string' || html.length > MAX_HIGHLIGHT_OUTPUT_CHARS) return null;
  const rows = [{ html: '', text: '' }];
  const stack = [];
  let i = 0;
  let renderedSpans = 0;
  let balancedChars = 0;

  const row = () => rows[rows.length - 1];
  const reopen = () => stack.map((cls) => `<span class="${cls}">`).join('');
  const appendHtml = (text) => {
    balancedChars += text.length;
    if (balancedChars > MAX_HIGHLIGHT_OUTPUT_CHARS) return false;
    row().html += text;
    return true;
  };

  while (i < html.length) {
    if (html.startsWith('</span>', i)) {
      if (!stack.length || !appendHtml('</span>')) return null;
      stack.pop();
      i += 7;
      continue;
    }
    if (html[i] === '<') {
      OPEN_RE.lastIndex = i;
      const m = OPEN_RE.exec(html);
      if (!m || !HLJS_CLASS_RE.test(m[1])) return null;
      renderedSpans += 1;
      if (renderedSpans > MAX_HIGHLIGHT_OUTPUT_SPANS
        || stack.length >= MAX_HIGHLIGHT_NESTING) return null;
      if (!appendHtml(m[0])) return null;
      stack.push(m[1]);
      i += m[0].length;
      continue;
    }
    if (html[i] === '\n') {
      if (!appendHtml('</span>'.repeat(stack.length))) return null;
      if (rows.length >= MAX_HIGHLIGHT_OUTPUT_ROWS) return null;
      const opened = reopen();
      renderedSpans += stack.length; // these become real DOM elements too
      if (renderedSpans > MAX_HIGHLIGHT_OUTPUT_SPANS) return null;
      balancedChars += opened.length;
      if (balancedChars > MAX_HIGHLIGHT_OUTPUT_CHARS) return null;
      rows.push({ html: opened, text: '' });
      i += 1;
      continue;
    }
    if (html[i] === '&') {
      ENTITY_RE.lastIndex = i;
      const m = ENTITY_RE.exec(html);
      if (!m || !appendHtml(m[0])) return null;
      row().text += ENTITIES[m[0]];
      i += m[0].length;
      continue;
    }
    TEXT_RE.lastIndex = i;
    const m = TEXT_RE.exec(html);
    if (!m) return null;
    // HTML tokenization normalizes a literal CR to LF. A generated numeric
    // reference preserves the source CR when the detached holder parses it.
    const serialized = m[0].replaceAll('\r', '&#13;');
    if (!appendHtml(serialized)) return null;
    row().text += m[0];
    i += m[0].length;
  }

  if (stack.length) return null;
  return { rows, balancedChars, renderedSpans };
}

export function rowsFromHtml(html) {
  const parsed = parseHighlightedRows(html);
  return parsed ? parsed.rows.map((r) => r.html) : null;
}
```

Closing and reopening the logical stack at each newline makes every returned row independently balanced. Every reopened span increments `renderedSpans`, because it becomes a real detached/connected DOM element just like an original open tag. Requiring the logical stack to be empty at end-of-input still rejects genuinely unclosed renderer output. Raw text may contain `>`, quote, or CR characters, but never raw `<`, `&`, or NUL; only the five reviewed highlight.js input entities are decoded for the fidelity check. Literal CR is reserialized as the parser-generated `&#13;` so HTML tokenization does not normalize it to LF in Task 6. NUL fails closed because HTML tokenization would replace it. Sticky regexes parse at the current index without repeatedly slicing the unconsumed suffix, keeping the walk linear. Raw renderer length, rebalanced output length, row count, actual rendered-span count, and nesting depth all fail closed at centralized limits before detached DOM construction.

### 3.3 Measure the actual work before loading a grammar

Use one side-input builder everywhere. For each hunk:

- old side: context plus deletion lines;
- new side: context plus addition lines;
- each side is joined with `\n` exactly as it will be passed to the grammar;
- row work is `old.lines.length + new.lines.length`, so context counts twice;
- byte work is the sum of `new TextEncoder().encode(side.text).byteLength` for those exact per-hunk side strings.

Do not estimate UTF-8 from `String#length`, and do not add separator bytes between hunks because the highlighter never receives such a combined string.

```js
const encoder = new TextEncoder();

function sideInputs(hunk) {
  const oldLines = [];
  const newLines = [];
  for (const line of hunk.lines || []) {
    if (line.kind !== 'add') oldLines.push(line);
    if (line.kind !== 'del') newLines.push(line);
  }
  return {
    old: { lines: oldLines, text: oldLines.map((x) => x.text).join('\n') },
    new: { lines: newLines, text: newLines.map((x) => x.text).join('\n') },
  };
}

function validSideRange(start, count) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || count < 0) return false;
  if (count === 0) return start >= 0;
  return start >= 1 && start <= Number.MAX_SAFE_INTEGER - (count - 1);
}

function eligibleSides(hunk) {
  if (!validSideRange(hunk?.oldStart, hunk?.oldCount)
    || !validSideRange(hunk?.newStart, hunk?.newCount)) return null;
  const sides = sideInputs(hunk);
  if (sides.old.lines.length !== hunk.oldCount
    || sides.new.lines.length !== hunk.newCount) return null;
  return sides;
}

function withinInputBudget(eligible) {
  let rows = 0;
  let bytes = 0;
  for (const sides of eligible) {
    for (const side of [sides.old, sides.new]) {
      rows += side.lines.length;
      bytes += encoder.encode(side.text).byteLength;
      if (rows > MAX_HIGHLIGHT_INPUT_ROWS || bytes > MAX_HIGHLIGHT_INPUT_BYTES) return false;
    }
  }
  return rows > 0;
}

function eligibleInputs(parsed) {
  return (parsed?.hunks || []).map(eligibleSides).filter(Boolean);
}

export function canHighlightParsed(parsed) {
  return withinInputBudget(eligibleInputs(parsed));
}
```

The app calls this before `loader.forLanguage`; `highlightParsed` and the exported direct `highlightHunk` path repeat the same eligibility and input-budget checks. Malformed/incomplete hunks are not work the implementation will lex, so they neither trigger a grammar load nor consume the budget that could otherwise suppress a later valid hunk.

### 3.4 Make source fidelity and hunk atomicity explicit

At the start of every attempt, delete any pre-existing own `html` property from the affected lines. This prevents a failed retry or an over-limit call from leaving stale markup behind.

For a hunk to be eligible, both side ranges must independently repeat Task 2's nonnegative/start/end-point checks, and the actual old/new side row counts must equal the header counts. Malformed, combined, truncated, short, or overlong hunks remain visible, plain, and unnumbered where appropriate. For each nonempty side (meaning at least one row, even if its joined text is empty):

1. call the injected highlighter once;
2. run `parseHighlightedRows`;
3. require exactly one result per input row;
4. require every decoded result's `text` to equal that input line's exact `text`;
5. stage assignments in local arrays;
6. assign deletion markup from the old side, and context/addition markup from the new side, only after both sides pass.

Use property presence, not truthiness—`html === ''` is valid for an empty source line:

```js
const newOutputBudget = () => ({
  rawChars: 0, balancedChars: 0, rows: 0, spans: 0, exhausted: false,
});

function countOutputRows(html) {
  let rows = 1;
  for (let i = html.indexOf('\n'); i !== -1; i = html.indexOf('\n', i + 1)) rows += 1;
  return rows;
}

function highlightEligibleHunk(hunk, { old, new: next }, lang, highlight, budget) {
  const run = (side) => {
    if (!side.lines.length) return [];
    if (budget.exhausted) return null;
    // A fully consumed aggregate dimension reserves no speculative next call,
    // even if that call might add zero to one of the character/span dimensions.
    if (budget.rawChars >= MAX_HIGHLIGHT_OUTPUT_CHARS
      || budget.balancedChars >= MAX_HIGHLIGHT_OUTPUT_CHARS
      || budget.rows >= MAX_HIGHLIGHT_OUTPUT_ROWS
      || budget.spans >= MAX_HIGHLIGHT_OUTPUT_SPANS) {
      budget.exhausted = true;
      return null;
    }
    const html = highlight(side.text, lang);
    if (typeof html !== 'string') return null;
    budget.rawChars += html.length;
    if (budget.rawChars > MAX_HIGHLIGHT_OUTPUT_CHARS) {
      budget.exhausted = true;
      return null;
    }
    const outputRows = countOutputRows(html);
    budget.rows += outputRows;
    if (budget.rows > MAX_HIGHLIGHT_OUTPUT_ROWS) {
      budget.exhausted = true;
      return null;
    }
    const parsed = parseHighlightedRows(html);
    if (!parsed) return null;
    if (parsed.rows.length !== outputRows) return null;
    budget.balancedChars += parsed.balancedChars;
    budget.spans += parsed.renderedSpans;
    if (budget.balancedChars > MAX_HIGHLIGHT_OUTPUT_CHARS
      || budget.spans > MAX_HIGHLIGHT_OUTPUT_SPANS) {
      budget.exhausted = true;
      return null;
    }
    if (parsed.rows.length !== side.lines.length) return null;
    if (parsed.rows.some((row, i) => row.text !== side.lines[i].text)) return null;
    return parsed.rows;
  };

  try {
    const oldRows = run(old);
    if (oldRows === null) return false;
    const newRows = run(next);
    if (newRows === null) return false;
    const staged = [];
    old.lines.forEach((line, i) => {
      if (line.kind === 'del') staged.push([line, oldRows[i].html]);
    });
    next.lines.forEach((line, i) => staged.push([line, newRows[i].html]));
    for (const [line, html] of staged) line.html = html;
    return staged.length > 0;
  } catch {
    return false;
  }
}

export function highlightHunk(hunk, lang, highlight) {
  for (const line of hunk?.lines || []) delete line.html;
  const sides = eligibleSides(hunk);
  if (!sides || !SUPPORTED.has(lang) || typeof highlight !== 'function'
    || !withinInputBudget([sides])) return false;
  return highlightEligibleHunk(hunk, sides, lang, highlight, newOutputBudget());
}

export function highlightParsed(parsed, lang, highlight) {
  for (const hunk of parsed?.hunks || []) {
    for (const line of hunk.lines || []) delete line.html;
  }
  if (!SUPPORTED.has(lang) || typeof highlight !== 'function') return false;
  const eligible = (parsed?.hunks || []).map((hunk) => ({ hunk, sides: eligibleSides(hunk) }))
    .filter((item) => item.sides);
  if (!withinInputBudget(eligible.map((item) => item.sides))) return false;
  const budget = newOutputBudget();
  let any = false;
  for (const { hunk, sides } of eligible) {
    any = highlightEligibleHunk(hunk, sides, lang, highlight, budget) || any;
  }
  return any;
}
```

Failure remains atomic per hunk: one bad hunk is wholly plain without discarding valid markup from an independent hunk. The whole file is plain when the file-level input-work budget fails before the first call. Count newline-delimited output rows before strict parsing, so even malformed or decoded-text-mismatching renderer output consumes the aggregate row budget; do not let repeated rejected calls allocate thousands of rows apiece. Once any aggregate raw-character, row, balanced-character, or rendered-span dimension is fully consumed, fail closed before invoking a later side—even if that speculative result might add zero to that particular dimension. Exact-cap output is therefore accepted only when it is the last nonempty side to run. Already validated independent hunks remain enhanced.

### 3.5 Tests, including the real package

Create fresh highlight.js instances in behavioral tests:

```js
const coreModule = await import('@highlightjs/cdn-assets/es/core.min.js');
const hljs = coreModule.default.newInstance();
const grammar = await import('@highlightjs/cdn-assets/es/languages/javascript.min.js');
hljs.registerLanguage('javascript', grammar.default);
const highlight = (text, lang) => hljs.highlight(text, {
  language: lang,
  ignoreIllegals: true,
}).value;
```

Cover all of the following:

- every extension/name mapping above, mixed case, compound suffixes, dotfiles, empty/unknown/binary paths, HCL/Terraform remaining `null`, and inherited-object names/extensions (`constructor`, `__proto__`, `toString`) remaining `null`;
- `SUPPORTED_LANGUAGE_IDS` being frozen, unique, sorted, and exactly equal to the map values;
- every mapped grammar module importing, default-exporting a function, registering on a fresh core, appearing in `getLanguage`, and highlighting a minimal string whose output `rowsFromHtml` accepts with exact text round-trip;
- exact and one-over UTF-8 byte/row limits, including multibyte code points, join newlines, and context counted on both sides;
- malformed-only input returning false without calls, a huge ineligible hunk not suppressing a later valid hunk, and direct `highlightHunk` calls enforcing the same input limits;
- exact and one-over raw/rebalanced output-character, output-row, actual DOM-span, and nesting limits, including multiline close/reopen amplification across both sides and multiple hunks; for each aggregate dimension, an exact-cap result followed by another eligible side proves that the later highlighter/parser call is suppressed, while exact-cap output on the final side remains accepted;
- the preflight returning false for no work and performing no highlighter call over either limit;
- multiline comments, strings/template literals, nested scope tiers, and a dedicated parser fixture built from a fresh core with both XML and JavaScript deliberately registered so real `language-javascript` wrapper output is accepted; this multi-grammar fixture tests the parser, not Task 4's isolated loader policy;
- source containing literal `<`, `>`, `&`, quotes, apostrophes, and text such as `onload` round-tripping exactly;
- CRLF-source rows preserving `\r` through strict parsing and detached jsdom `innerHTML`/`textContent` round-trip via the generated `&#13;` form;
- valid empty-line markup (`html === ''`) being retained as an own property;
- raw/unknown `&`, an invalid entity, raw `<`, raw NUL, `<img>`, forged attributes, multiple arbitrary classes (including `hidden`), invalid first classes, unmatched closes, and unclosed spans all rejecting;
- exact row-count and decoded-text mismatches rejecting;
- thrown highlighters, negative/unsafe/end-point-overflow ranges, malformed/combined ranges, and under/over-count or truncated hunk bodies leaving no `html` properties;
- context using new-side markup, deletion using old-side markup, and add using new-side markup;
- one valid hunk plus one invalid hunk preserving only the first hunk's markup;
- repeated success/failure/oversize calls clearing stale markup.

For each accepted row, parse it in jsdom and assert exact `textContent`, only `SPAN` elements, only `class` attributes, and no executable/foreign elements. Do not reject source merely because its text contains a hostile-looking word.

Finally, extend the Task 1 HTTP suite to iterate `SUPPORTED_LANGUAGE_IDS` and assert every `/vendor/hljs/languages/<id>.min.js` response has JavaScript MIME, a default export, and can be imported. This connects the pure map to the actual server allowlist.

Run:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test \
  test/syntax-highlight.test.mjs test/api-hljs-assets.test.mjs
```

---

## Task 4 — Add a native-import loader that really retries

**Files**

- Create `ui/public/hljs-loader.mjs`
- Create `test/hljs-loader.test.mjs`

### 4.1 Contract

Export:

```text
createHljsLoader({ loadCore?, loadGrammar? } = {})
  -> { forLanguage(lang) -> Promise<{ lang, highlight } | null> }
```

Browser defaults dynamically import only:

```text
/vendor/hljs/core.min.js?retry=<core-attempt>
/vendor/hljs/languages/<lang>.min.js?retry=<attempt-for-that-language>
```

Native module maps cache failed fetches by resolved module URL. Evicting only an application Promise is therefore insufficient; a later retry must have a distinct query URL. The first attempt is `0`, the next is `1`, and so on. Query parameters do not expand the server allowlist.

### 4.2 Implementation shape

Import and cache one successful core **factory module** for the loader's lifetime, but never accumulate unrelated registrations in one highlighter. Cache one successful grammar function and one isolated `newInstance()` binding per primary language. Each instance registers only its requested primary grammar. This deliberately leaves optional embedded sublanguages plain: otherwise loading JavaScript before XML changes later XML output, making the same file render differently based on selection history. Keep one in-flight core Promise, one in-flight grammar Promise per language, one in-flight complete binding per language, and per-resource attempt counters.

```js
import { SUPPORTED_LANGUAGE_IDS } from './syntax-highlight.mjs';

const LANGUAGE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ALLOWED_LANGUAGES = new Set(SUPPORTED_LANGUAGE_IDS);
const coreUrl = (attempt) => `/vendor/hljs/core.min.js?retry=${attempt}`;
const grammarUrl = (lang, attempt) =>
  `/vendor/hljs/languages/${lang}.min.js?retry=${attempt}`;

export function createHljsLoader(options = {}) {
  const loadCore = options.loadCore || ((attempt) => import(coreUrl(attempt)));
  const loadGrammar = options.loadGrammar
    || ((lang, attempt) => import(grammarUrl(lang, attempt)));

  let coreFactory = null;
  let corePending = null;
  let nextCoreAttempt = 0;
  const grammarPending = new Map();
  const grammarFunctions = new Map();
  const nextGrammarAttempt = new Map();
  const languagePending = new Map();
  const languageReady = new Map();

  const validInstance = (value) => value
    && typeof value.getLanguage === 'function'
    && typeof value.registerLanguage === 'function'
    && typeof value.highlight === 'function';

  function getCoreFactory() {
    if (coreFactory) return Promise.resolve(coreFactory);
    if (corePending) return corePending;
    const attempt = nextCoreAttempt++;
    const pending = Promise.resolve()
      .then(() => loadCore(attempt))
      .then((mod) => {
        const exported = mod?.default;
        if (typeof exported?.newInstance !== 'function') {
          throw new TypeError('core module has no newInstance factory');
        }
        coreFactory = exported;
        return coreFactory;
      })
      .catch(() => null)
      .finally(() => {
        if (corePending === pending) corePending = null;
      });
    corePending = pending;
    return pending;
  }

  function getGrammar(lang) {
    if (grammarFunctions.has(lang)) return Promise.resolve(grammarFunctions.get(lang));
    const existing = grammarPending.get(lang);
    if (existing) return existing;
    const attempt = nextGrammarAttempt.get(lang) || 0;
    nextGrammarAttempt.set(lang, attempt + 1);
    const pending = Promise.resolve()
      .then(() => loadGrammar(lang, attempt))
      .then((mod) => {
        if (typeof mod?.default !== 'function') throw new TypeError('invalid grammar module');
        grammarFunctions.set(lang, mod.default);
        return mod.default;
      })
      .catch(() => null)
      .finally(() => {
        if (grammarPending.get(lang) === pending) grammarPending.delete(lang);
      });
    grammarPending.set(lang, pending);
    return pending;
  }

  function buildLanguage(lang) {
    if (languageReady.has(lang)) return Promise.resolve(languageReady.get(lang));
    const existing = languagePending.get(lang);
    if (existing) return existing;
    const pending = Promise.all([getCoreFactory(), getGrammar(lang)])
      .then(([factory, grammar]) => {
        if (!factory || !grammar) return null;
        const hljs = factory.newInstance();
        if (!validInstance(hljs)) throw new TypeError('invalid highlight.js instance');
        hljs.registerLanguage(lang, grammar);
        if (!hljs.getLanguage(lang)) throw new TypeError('grammar did not register');
        const bound = Object.freeze({
          lang,
          highlight(text, requested = lang) {
            if (requested !== lang) throw new TypeError('language mismatch');
            const result = hljs.highlight(String(text), {
              language: lang,
              ignoreIllegals: true,
            });
            if (typeof result?.value !== 'string') {
              throw new TypeError('invalid highlight result');
            }
            return result.value;
          },
        });
        languageReady.set(lang, bound);
        return bound;
      })
      .catch(() => null)
      .finally(() => {
        if (languagePending.get(lang) === pending) languagePending.delete(lang);
      });
    languagePending.set(lang, pending);
    return pending;
  }

  return Object.freeze({
    async forLanguage(input) {
      try {
        const lang = String(input ?? ''); // normalize once before regex/Map/URL use
        if (!LANGUAGE_ID_RE.test(lang) || !ALLOWED_LANGUAGES.has(lang)) return null;
        return await buildLanguage(lang);
      } catch {
        return null;
      }
    },
  });
}

export const _testing = Object.freeze({ coreUrl, grammarUrl });
```

`getLanguage`, `newInstance`, registration, highlighting, and imports may all throw; the boundaries convert every case to `null` or, for the synchronous bound highlighter, let Task 3 catch it without an unhandled rejection. A rejected resource/binding Promise is never retained. Successful core modules and grammar functions are cached, while a registration failure leaves no ready binding and the next call constructs a fresh isolated instance. Requiring `newInstance()` is intentional—the reviewed package provides it, and falling back to its shared default object would reintroduce order-dependent registrations.

### 4.3 Tests

Use injected async functions and fake cores to cover:

- invalid/empty/traversal-like IDs, a shipped-but-unmapped grammar, and an input whose `toString` throws never calling either loader or rejecting;
- concurrent first calls for two languages sharing one core-module request but receiving distinct instances that each contain only their own primary grammar;
- concurrent calls for one language sharing one grammar request and one complete binding construction;
- successful core-module, grammar-function, and per-language binding caches being reused;
- failed core attempt `0` followed by successful attempt `1`;
- failed grammar attempt `0` followed by successful attempt `1`, independently per language;
- `_testing.coreUrl` and `grammarUrl` producing distinct `?retry=0` / `?retry=1` URLs;
- bad module/default shapes, throwing `newInstance`, `getLanguage`, `registerLanguage`, and `highlight` degrading without an unhandled rejection;
- a registration that returns without making `getLanguage` truthy rejecting;
- fail-once `newInstance`/registration/lookup followed by success constructing a fresh isolated binding from the already-cached core factory and grammar function, with both resource loaders still called exactly once;
- the closure returning `.value`, not the whole highlight.js result;
- the closure pinning `language` and `ignoreIllegals:true`, and rejecting a mismatched requested language;
- with real 11.12.0 modules, highlighting the same XML source before and after loading JavaScript produces byte-identical output, and the inverse ordering is also stable; assert each factory instance registered only its primary language rather than asserting that embedded JavaScript must be highlighted.

Run:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/hljs-loader.test.mjs
```

---

## Task 5 — Build a deterministic, project-scoped file tree

**Files**

- Create `ui/public/file-tree.mjs`
- Create `test/file-tree.test.mjs`

### 5.1 Model contract

Export:

```text
buildFileTree(rows) -> node[]
renderFileTree(nodes, { doc, onPick, counts, initialKey }) -> HTMLElement
firstFile(nodes) -> file node | null
fileStatus(entry) -> add | del | mod
```

Use these node shapes:

```text
project: { type:'project', key, name, project, children }
dir:     { type:'dir', key, name, path, project, children }
file:    { type:'file', key, name, path, project, entry }
```

Every key is an opaque JSON tuple:

```js
const nodeKey = (project, type, fullPath) =>
  JSON.stringify([project ?? null, type, fullPath]);
```

Build trie children with `Map`, never `{}`, so path segments such as `__proto__` are ordinary data. Namespace each internal child by both type and segment—for example `JSON.stringify(['dir', segment])` versus `JSON.stringify(['file', segment])`—because a real diff can delete file `a` while adding `a/b` in the same result. Keep the first input entry for an exact duplicate `(project,path)` and ignore later duplicates; sorting the finished nodes must not replace that chosen entry.

Model rules:

- a workspace's project keys are sorted, static, non-collapsible root headings;
- single-project rows with `project === null` begin directly at their directories/files;
- directories sort before files;
- within each type, compare `name.toLowerCase()` by raw code units, then raw `name` by code units—never `localeCompare`;
- numeric-looking names remain lexical (`a10` before `a2`);
- collapse only a directory whose sole child is another directory;
- never merge a project root and never absorb a file basename into a directory label;
- a collapsed node keeps the deepest directory's full `path` and key;
- empty/missing paths are skipped rather than creating an unselectable leaf;
- `firstFile` follows the final rendered order.

The key transformation and comparison should be directly testable:

```js
const cmpText = (a, b) => {
  const af = a.toLowerCase();
  const bf = b.toLowerCase();
  return af < bf ? -1 : af > bf ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

function compactDir(node) {
  let current = node;
  const names = [current.name];
  while (current.children.length === 1 && current.children[0].type === 'dir') {
    current = current.children[0];
    names.push(current.name);
  }
  return {
    ...current,
    name: names.join('/'),
    children: current.children.map((child) =>
      child.type === 'dir' ? compactDir(child) : child),
  };
}

export function fileStatus(entry) {
  if (entry?.isNew || entry?.f?.status === 'A' || entry?.f?.status === 'C') return 'add';
  if (entry?.f?.status === 'D') return 'del';
  return 'mod';
}
```

### 5.2 Renderer contract

Render a `<nav class="hd-tree" aria-label="Changed files">`. Project nodes are static `<div class="hd-tree-project" role="heading" aria-level="3">` labels followed by their groups. Directory and file actions are native `<button type="button">` elements; do not add a manual Enter/Space key handler, and do not claim ARIA `tree` semantics without implementing the complete arrow-key pattern. Give every directory group a renderer-generated safe ID and connect its button with `aria-controls`. Every directory starts expanded (`aria-expanded="true"`, sibling `hidden === false`, accessible action “Collapse directory …”), so the initially selected first file is visible; collapse begins only with an explicit user action.

IDs must be unique across the whole document, not merely within one render. Use a module-level tree-instance counter plus a local group counter; never derive an ID from a project/path:

```js
let nextTreeInstance = 0;

export function renderFileTree(nodes, options = {}) {
  const idPrefix = `hd-tree-${nextTreeInstance++}`;
  let nextGroup = 0;
  // For each directory/project child group:
  // group.id = `${idPrefix}-group-${nextGroup++}`;
  // button.setAttribute('aria-controls', group.id);
  // ...build once and return the nav...
}
```

Build every branch once. A directory click only changes its `aria-expanded` value and the sibling group's `hidden` property:

```js
dirButton.addEventListener('click', () => {
  const expanded = dirButton.getAttribute('aria-expanded') === 'true';
  dirButton.setAttribute('aria-expanded', String(!expanded));
  group.hidden = expanded;
  dirButton.setAttribute('aria-label',
    `${expanded ? 'Expand' : 'Collapse'} directory ${fullLabel}`);
});
```

The stylesheet must contain `.hd-tree-group[hidden]{display:none}` because an author `display` rule otherwise outranks the browser's default `[hidden]` rule.

For files:

- retain `.hd-diff-file` and add `.hd-tree-file` plus `new`/`deleted` status classes;
- visible text is the basename only;
- `title` and `aria-label` contain status, project when present, full path, and rename source when present;
- because an explicit `aria-label` replaces descendant count-chip text in the accessible name, the label also says “N lines added, N lines removed” or “binary file”; derive those words from `entry.f`, not by scraping the rendered count Node;
- set `data-file-key`, `data-project`, and `data-path` by property assignment;
- append the Node returned by `counts(entry)`; never consume count HTML;
- decorative icons/SVGs use `aria-hidden="true"` and cannot receive focus;
- the click closure passes the exact captured `(entry, key)` to `onPick`.

Keep a `Map<key,button>` and one `activeButton` reference. Activation removes `.active` and `aria-current` from the old button, then sets `.active` and `aria-current="true"` on exactly one new button. `initialKey` performs only this visual initialization; it must not call `onPick`. Resolve it with `fileButtons.get(initialKey)` and activate only when that lookup returns a button—an unknown key leaves no active row and never calls `activate(undefined)`. The app invokes the first selection separately.

Representative file-button construction:

```js
const fileButtons = new Map();
let activeButton = null;

function activate(button) {
  if (activeButton && activeButton !== button) {
    activeButton.classList.remove('active');
    activeButton.removeAttribute('aria-current');
  }
  activeButton = button;
  button.classList.add('active');
  button.setAttribute('aria-current', 'true');
}

function renderFile(node, depth) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = `hd-diff-file hd-tree-file ${fileStatus(node.entry)}`;
  if (fileStatus(node.entry) === 'add') button.classList.add('new');
  if (fileStatus(node.entry) === 'del') button.classList.add('deleted');
  button.dataset.fileKey = node.key;
  button.dataset.project = node.project ?? '';
  button.dataset.path = node.path;
  button.style.setProperty('--tree-indent', `${10 + depth * 14}px`);
  const f = node.entry?.f || {};
  const status = ({ A: 'Added', C: 'Copied', D: 'Deleted', R: 'Renamed', M: 'Modified' })[f.status]
    || (node.entry?.isNew ? 'Added' : 'Changed');
  const scope = node.project ? ` in project ${node.project}` : '';
  const identity = f.from
    ? `from ${String(f.from)} to ${node.path}`
    : `file ${node.path}`;
  const amount = f.binary
    ? 'binary file'
    : `${Number(f.added) || 0} lines added, ${Number(f.removed) || 0} lines removed`;
  button.setAttribute('aria-label', `${status} ${identity}${scope}, ${amount}`);
  // Append icon, a textContent-built .hd-diff-path, and counts(entry) here.
  button.addEventListener('click', () => {
    activate(button);
    onPick?.(node.entry, node.key);
  });
  fileButtons.set(node.key, button);
  return button;
}
```

Do not recover nodes with a selector containing a key/path. Selector-sensitive strings stay inert because selection uses captured references and `Map` lookups.

### 5.3 Tests

Cover:

- exact directory/file order, case ties, Unicode/code-unit ties, and numeric lexical order;
- a `ui/public` directory chain collapsing while a branching chain does not;
- a directory with one file remaining two visible labels (`src` then `x.js`);
- simultaneous file `a` and directory `a/` (for example delete `a`, add `a/b`) both surviving and sorting directory-first;
- project roots never collapsing and same relative paths/directories in two projects having different keys;
- exact duplicates keeping the first entry;
- `__proto__`, quotes, backslashes, brackets, hashes, and other selector-sensitive strings not corrupting the model or selection;
- empty/bad rows, empty trees, and recursive `firstFile`;
- `A`, `C`, explicit `isNew`, `D`, `M`, and rename statuses;
- project heading role/level, native button type, navigation label, directory accessible names, unique safe group IDs, every `aria-controls` resolving to its sibling group, initially expanded/unhidden groups, file `aria-current`, and decorative icon hiding; append two separately rendered trees to one document and require disjoint ID sets with every control resolving inside its own nav;
- valid initialization marking exactly one visible row without calling `onPick`, and an unknown `initialKey` leaving the renderer stable with no active row or callback;
- file accessible names/titles containing status, project scope, full path, and rename source/current path while visible text remains the basename; numeric entries announce added/removed counts and binary entries announce that fact even though the explicit label suppresses descendant chip text;
- a directory toggle changing no child node identities and not invoking `onPick`;
- active selection surviving collapse/expand;
- one active row across duplicate relative paths, with project B returning project B's captured entry;
- independent collapse state for same-named directories in two projects;
- a counts callback returning a Node whose text appears without `innerHTML`.

Selector-hostile paths in this unit suite prove DOM/key safety, not patch lookup for Git C-quoted paths; that parser limitation remains explicitly out of scope.

Run:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/file-tree.test.mjs
```

---

## Task 6 — Integrate the tree, plain-first rows, and transactional enhancement

**Files**

- Modify `ui/public/app.js`
- Modify `test/ui-history-detail.test.mjs`

### 6.1 Wire imports and one explicit test seam

Add static imports for the three local modules:

```js
import {
  splitPatchSections, parseFileSection, patchIndex, sectionKey,
} from './diff-view.mjs';
import {
  langForPath, canHighlightParsed, highlightParsed,
} from './syntax-highlight.mjs';
import { createHljsLoader } from './hljs-loader.mjs';
import {
  buildFileTree, renderFileTree, firstFile,
} from './file-tree.mjs';

// A cache-busted app module is constructed once per jsdom test. Production does
// not publish highlight.js; this hook substitutes only the loader boundary.
const diffHljsLoader = window.__worcaTestHooks?.hljsLoader ?? createHljsLoader();
```

Extend the existing `boot` test helper with an optional loader and install it on the jsdom window **before** the cache-busted `app.js` import:

```js
async function boot({ fetchHandler, url = 'http://localhost:4317/', hljsLoader = null } = {}) {
  // ... existing JSDOM/global setup ...
  if (hljsLoader) window.__worcaTestHooks = { hljsLoader };
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  // ...
}

async function bootDetail({
  rows = [ROW], detail = DETAIL, budget = okBudget(), arms = null,
  deepLink = false, hljsLoader = null,
} = {}) {
  // ... existing box/base construction ...
  const ctx = await boot({
    fetchHandler: (url, opts) => (arms && arms(url, opts, box)) || base(url, opts),
    url: deepLink ? `http://localhost:4317/#${detailHash}` : 'http://localhost:4317/',
    hljsLoader,
  });
  // ... existing return ...
}
```

Do not add `window.hljs` or production fallback globals. The singleton belongs in `app.js`, not `syntax-highlight.mjs`, so pure-module tests remain deterministic.

### 6.2 Replace HTML-string count helpers with Nodes

Replace `hdFileCountsHtml` with a Node builder used by the tree and pane head. Persisted paths and counts must be assigned with `textContent`; `innerHTML = ''` remains acceptable only as a clearing operation.

```js
function hdFileCountsNode(doc, f) {
  const out = doc.createElement('span');
  out.className = 'mono hd-diff-counts';
  if (f.binary) {
    const binary = doc.createElement('span');
    binary.className = 'hint';
    binary.textContent = 'binary';
    out.appendChild(binary);
    return out;
  }
  if (f.added == null) return out;
  const add = doc.createElement('span');
  add.className = 'diff-add';
  add.textContent = `+${f.added}`;
  const del = doc.createElement('span');
  del.className = 'diff-del';
  del.textContent = `−${f.removed}`; // U+2212 remains count-only
  out.append(add, doc.createTextNode(' '), del);
  return out;
}
```

Build the list summary head the same way. This removes the need to reason about escaping in two different display paths.

### 6.3 Establish the source-row DOM contract

Only source rows receive `.hd-dl-row`; hunk headers do not. Each row is:

```html
<div class="hd-dl hd-dl-row hd-dl-add"
     data-file-key="…" data-project="…" data-path="…"
     data-old-path="…" data-new-path="…" data-old="" data-new="12">
  <span class="hd-dl-n hd-dl-n-old" aria-hidden="true"></span>
  <span class="hd-dl-n hd-dl-n-new"><span class="hd-dl-n-v" aria-hidden="true">12</span><span class="sr-only">New line 12</span></span>
  <span class="hd-dl-code"><span class="hd-dl-sign">+</span><span class="hd-dl-src">source</span></span>
</div>
```

Use a helper that returns both the row and its permanent `.hd-dl-src` reference:

```js
function diffSectionMeta(entry, fileKey, section) {
  const path = String(section?.path ?? entry?.f?.path ?? '');
  return {
    fileKey: String(fileKey ?? ''),
    project: String(entry?.project ?? ''),
    path,
    oldPath: String(section?.oldPath ?? entry?.f?.from ?? path),
    newPath: path,
  };
}

function setSectionData(el, meta) {
  el.dataset.fileKey = String(meta.fileKey ?? '');
  el.dataset.project = String(meta.project ?? '');
  el.dataset.path = String(meta.path ?? '');
  el.dataset.oldPath = String(meta.oldPath ?? '');
  el.dataset.newPath = String(meta.newPath ?? '');
}

function hdDiffRow(doc, line, meta) {
  const row = doc.createElement('div');
  row.className = `hd-dl hd-dl-row hd-dl-${line.kind}`;
  setSectionData(row, meta);
  row.dataset.old = line.oldNo == null ? '' : String(line.oldNo);
  row.dataset.new = line.newNo == null ? '' : String(line.newNo);

  const gutter = (side, no) => {
    const cell = doc.createElement('span');
    cell.className = `hd-dl-n hd-dl-n-${side}`;
    if (no == null) {
      cell.setAttribute('aria-hidden', 'true');
    } else {
      const visible = doc.createElement('span');
      visible.className = 'hd-dl-n-v';
      visible.setAttribute('aria-hidden', 'true');
      visible.textContent = String(no);
      const spoken = doc.createElement('span');
      spoken.className = 'sr-only';
      spoken.textContent = `${side === 'old' ? 'Old' : 'New'} line ${no}`;
      cell.append(visible, spoken);
    }
    return cell;
  };

  const code = doc.createElement('span');
  code.className = 'hd-dl-code';
  const sign = doc.createElement('span');
  sign.className = 'hd-dl-sign';
  sign.textContent = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
  const source = doc.createElement('span');
  source.className = 'hd-dl-src';
  source.textContent = line.text;
  code.append(sign, source);
  row.append(gutter('old', line.oldNo), gutter('new', line.newNo), code);
  return { row, source };
}
```

Invariants:

- `.hd-dl-code.textContent` is exactly the ASCII diff prefix plus original source, before and after enhancement;
- gutters are outside the code cell and `user-select:none`; visible digits are `aria-hidden`, a tested `.sr-only` label supplies “Old/New line N”, and blank gutters are wholly hidden from assistive technology;
- line numbers remain ordinary decimal text, never part of the source;
- a valid empty line may replace `.hd-dl-src` with zero child nodes;
- only `.hd-dl-src` changes during enhancement; the row, gutters, sign, focus, scroll, and tint never do.

Hunk and truncation elements also receive the five section identity attributes. Hunk rows use `.hd-dl-hunk` and `grid-column:1/-1`; truncation uses `.hd-diff-note.hd-diff-trunc`. Neither is a `.hd-dl-row`.

Compute one safe gutter width from retained line numbers:

```js
let digits = 3;
for (const hunk of parsed.hunks) {
  for (const line of hunk.lines) {
    for (const no of [line.oldNo, line.newNo]) {
      if (Number.isSafeInteger(no)) digits = Math.max(digits, String(no).length);
    }
  }
}
body.style.setProperty('--hd-gutter-width', `calc(${digits}ch + 16px)`);
```

`digits` is derived only from safe parser integers, so it cannot inject CSS. The nested loops deliberately avoid `flatMap`, intermediate arrays, and spreading an attacker-sized argument list into `Math.max`.

Construct `const meta = diffSectionMeta(entry, fileKey, section)` once per selected section and pass that same normalized object to every hunk, note, and source-row helper. This pins `data-path`/`data-new-path` to the parsed current path, falls back to `f.from` for the old path, and prevents missing values from stringifying as the literal word `undefined`.

### 6.4 Render the base pane before highlighter work

Keep `ensurePatch`'s existing shared/retryable Promise logic unchanged. Refactor `select` to receive `(entry, fileKey)` rather than a row element; the tree renderer owns active-row state.

After `await ensurePatch()`, strengthen the existing epoch check with screen ownership. Navigating away does not necessarily increment this tab's epoch, and the old pane can remain connected during its close transition:

```js
await ensurePatch();
if (epoch !== pstate.selEpoch
  || !pane.isConnected
  || !histDetailState?.screen?.contains(pane)) return;
```

Only then resolve the section with the exact scoped identity:

```js
const section = pstate.index?.get(sectionKey(entry.project, entry.f.path));
```

For a valid textual section:

1. parse it;
2. create the body and all hunk/source rows;
3. retain `Map<line, .hd-dl-src>` references;
4. append the completed **plain** body to the pane;
5. only then consider syntax highlighting.

For missing, failed, binary, or non-textual sections, append a `.hd-diff-note` built with `textContent`. A hint-only body must also have `.hint`, whose CSS switches it back to block layout. Change the inaccurate truncation copy to:

```text
(large file — diff truncated)
```

Use the new/surviving path for grammar selection on both sides of a rename:

```js
const syntaxPath = section.path || entry.f.path || section.oldPath;
const lang = langForPath(syntaxPath);
if (lang && canHighlightParsed(parsed)) {
  const ownsBody = () => epoch === pstate.selEpoch
    && body.isConnected
    && pane.isConnected
    && pane.contains(body)
    && histDetailState?.screen?.contains(pane);
  void enhanceDiffBody({ parsed, lang, refs, ownsBody }).catch(() => {});
}
```

Thus a cross-extension rename intentionally uses the new grammar for both old and new streams. Deleted files use the surviving mirrored path from `splitPatchSections`. Unknown and oversized files never call the loader.

### 6.5 Yield a paint opportunity, then enhance detached DOM

A cached dynamic import can settle in microtasks before the browser paints. Use a small paint gate with a timer fallback so background tabs and jsdom do not hang:

```js
function afterDiffPaint(win = window) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      win.clearTimeout(timer);
      resolve();
    };
    const timer = win.setTimeout(finish, 50);
    if (typeof win.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(() => win.setTimeout(finish, 0));
    } else {
      win.setTimeout(finish, 0);
    }
  });
}
```

Start the module load, await the paint gate, then await the module. Check ownership before synchronous lexing, after it, and before each commit:

```js
async function enhanceDiffBody({ parsed, lang, refs, ownsBody }) {
  const loading = diffHljsLoader.forLanguage(lang);
  await afterDiffPaint();
  const loaded = await loading;
  if (!loaded || !ownsBody()) return;
  if (!highlightParsed(parsed, lang, loaded.highlight) || !ownsBody()) return;

  for (const hunk of parsed.hunks) {
    const marked = hunk.lines.filter((line) => Object.hasOwn(line, 'html'));
    if (!marked.length) continue;
    if (marked.length !== hunk.lines.length) continue; // defensive hunk atomicity

    const staged = [];
    let valid = true;
    for (const line of hunk.lines) {
      const liveSource = refs.get(line);
      const holder = document.createElement('span'); // detached
      holder.innerHTML = line.html;
      const elements = [...holder.querySelectorAll('*')];
      if (!liveSource || holder.textContent !== line.text
        || elements.some((el) => el.tagName !== 'SPAN'
          || [...el.attributes].some((a) => a.name !== 'class'))) {
        valid = false;
        break;
      }
      staged.push({ liveSource, nodes: [...holder.childNodes] });
    }
    if (!valid || !ownsBody()) continue;
    for (const { liveSource, nodes } of staged) liveSource.replaceChildren(...nodes);
  }
}
```

`ownsBody` is created inside `select`, where `pstate`, `epoch`, `body`, and `pane` are in scope; the reusable enhancement helper receives the closure instead of reaching into `buildHdDiff` locals. This is the only `innerHTML` assignment allowed for highlighter output, and it targets a detached node after Task 3's strict parser and decoded-text check. Moving those validated nodes into `.hd-dl-src` avoids reparsing the string in connected DOM. One invalid staged row discards the entire hunk.

### 6.6 Replace the flat list exactly once

For a results-backed Diff section, prepend a real visually hidden `<h2 class="sr-only">Changed files and diff</h2>` before the two-column grid. It supplies the missing level between the run-detail H1 and both branches of this section. Project labels remain level-3 headings inside the navigation. Build the selected pane path as a real `<h3 class="hd-diff-path">`, not a generic span or a synthetic level-4 heading; reset its default margin in Task 7. Thus single-project and workspace views both have an H1 -> H2 -> H3 outline, while project headings and the selected-file heading remain peers in their respective navigation/pane branches.

Build and render the tree after `hdDiffFileRows(results)`:

```js
const nodes = buildFileTree(rows);
const first = firstFile(nodes);
const tree = renderFileTree(nodes, {
  doc: document,
  initialKey: first?.key ?? null,
  counts: (entry) => hdFileCountsNode(document, entry.f),
  onPick: (entry, key) => { select(entry, key).catch(() => {}); },
});
rowsHost.appendChild(tree);
if (first) select(first.entry, first.key).catch(() => {});
```

Project headings remain static; directories toggle their already-built child groups; file selection alone paints the pane. Preserve the existing no-files state.

Pane and tree visible labels show the new/current path. Do not rely on `aria-label` on a generic `span`, whose role does not support naming consistently. For a rename, retain the `<h3>`'s visible current full path, set its `title` to `${from} → ${path}`, and set its `aria-label` to `Renamed from ${from} to ${path}`. The tree button keeps its model-derived accessible label and visible basename. U+2192 is limited to the human-readable `title` and never enters patch source.

### 6.7 Integration tests

Update current assertions by intent:

- source content assertions target `.hd-dl-code`, not the whole three-cell row;
- file lookup uses `data-project` plus `data-path` or captured Nodes, never visible full-path text or sorted array positions;
- retain and extend the existing duplicate-workspace fixture rather than creating a contradictory one;
- keep summary counts consistent with fixture file arrays.

Add tests for:

- old/new gutters on context/delete/add rows, omitted hunk counts, zero ranges, and multiple hunks;
- gutter visible/spoken-label separation, blank-gutter hiding, and `.hd-dl-code` exact ASCII/source text;
- all section/line data attributes, including null project and a rename's old/new paths;
- a real visually hidden level-2 section heading, level-3 project headings, and a real level-3 selected-file heading in both single-project and workspace outlines; for a rename, also verify visible current path, `from → path` title, and spoken “Renamed from … to …” label;
- hunk/truncation/note rows not carrying `.hd-dl-row` and spanning conceptually as distinct items;
- the honest truncation message containing no “KB” claim;
- a many-short-lines section stopping at `MAX_FILE_SECTION_RENDER_ITEMS`, connecting no more than that many hunk/source items, showing the truncation note, and computing gutter width without throwing or allocating flattened number arrays;
- numbered plain rows being connected while an injected loader Promise is unresolved;
- unsupported and over-limit files making zero loader calls;
- successful valid markup adding token spans while preserving every code cell's `textContent`, source row identity, sign node identity, and gutter identity;
- a highlighted CRLF-source row preserving its trailing `\r` through detached staging instead of falling back or becoming LF;
- valid empty-line HTML committing via `Object.hasOwn` semantics;
- thrown loading/highlighting, rejected classes/tags/entities, decoded-text mismatch, and row-count mismatch leaving the relevant hunk plain;
- valid hunk plus invalid hunk committing only the valid hunk;
- stale file-A completion not mutating file B;
- a deferred **patch** response resolving after navigation away not appending a body or starting a grammar load, even while the retired screen is still connected for its close transition;
- a pending completion after navigating away doing nothing and producing no unhandled rejection;
- cross-extension rename requesting only the new grammar;
- tree shape, counts, statuses (including `C`), project headings, and visual-order auto-selection;
- duplicate workspace paths having one active file, exact project-scoped patch selection, and independent directory collapse;
- directory collapse not repainting the pane or issuing a fetch;
- rapid file selection still sharing one patch request and only the final selection appending a body;
- failed patch fetch still re-arming on a later selection;
- binary, missing-patch, empty, and no-files states selected by identity rather than position.

A useful deferred-loader fixture is:

```js
let release;
const gate = new Promise((resolve) => { release = resolve; });
const calls = [];
const hljsLoader = {
  forLanguage(lang) {
    calls.push(lang);
    return gate;
  },
};
// Assert plain .hd-dl-src text now, then:
release({
  lang: 'javascript',
  highlight: (text) => text.replace(/const/g, '<span class="hljs-keyword">const</span>'),
});
```

Run the entire integration slice, then the full suite because `app.js` is shared by every UI screen:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test \
  test/diff-view.test.mjs test/syntax-highlight.test.mjs \
  test/hljs-loader.test.mjs test/file-tree.test.mjs \
  test/api-hljs-assets.test.mjs test/ui-history-detail.test.mjs
npm test
```

---

## Task 7 — Finish layout, interaction styling, and measured contrast

**Files**

- Modify `ui/public/style.css`
- Create `test/ui-diff-style.test.mjs`

### 7.1 Three-column source grid

Retain the existing single scrolling `.hd-diff-body`, but give it two fixed sticky gutter tracks and one code track sized by the widest source row:

```css
.hd-diff-body{
  --hd-gutter-width:calc(3ch + 16px);
  padding:12px 0;
  display:grid;
  grid-template-columns:var(--hd-gutter-width) var(--hd-gutter-width) minmax(max-content,1fr);
  max-height:520px;
  overflow:auto;
  font:400 12px/1.85 var(--mono);
  color:var(--ink-2);
}
.hd-diff-body.hint{display:block;margin-top:0;padding:18px;color:var(--ink-2);}
.hd-diff-none{padding:18px;color:var(--ink-2);}
.hd-dl-row{display:contents;}
.hd-dl-n{
  position:sticky;
  z-index:2;
  padding:0 8px;
  text-align:right;
  color:var(--ink-2);
  background:var(--panel);
  user-select:none;
}
.hd-dl-n-old{left:0;}
.hd-dl-n-new{left:var(--hd-gutter-width);}
.hd-dl-code{min-width:100%;padding:0 18px 0 10px;white-space:pre;}
.hd-dl-hunk,.hd-diff-note{grid-column:1/-1;padding-inline:18px;}
.hd-dl-hunk{white-space:pre;color:var(--ink-2);background:var(--field);}
.hd-diff-trunc{padding-top:10px;color:var(--ink-2);}
.hd-dl-row.hd-dl-add > *{background:var(--green-bg);}
.hd-dl-row.hd-dl-del > *{background:var(--red-bg);}
.hd-diff-pane-head .hd-diff-path{margin:0;}
```

Replace the existing `.hd-diff-body` / `.hd-dl` / `.hd-dl-hunk` / `.hd-dl-add` / `.hd-dl-del` / `.hd-diff-trunc` block as one unit; do not leave the old one-column, row-padding, or row-background declarations competing with these rules. The tint applies to all three cells because a `display:contents` row has no paint box. Sticky gutter backgrounds therefore remain opaque while matching add/delete tint. Hunk/note items are real boxes spanning the complete grid, and `.hint` bodies cannot accidentally auto-place text into the first gutter.

Verify the longest code cell establishes the third track width, all shorter tinted cells stretch to that width, horizontal scrolling occurs on the one body, and gutter `z-index` beats code while staying below surrounding app overlays.

### 7.2 File-tree controls

Reset native buttons while retaining a clear focus indicator. The renderer computes a safe pixel `--tree-indent` from its numeric recursion depth; use that value on the logical inline-start side and never interpolate path text into CSS.

```css
.hd-tree{display:block;}
.hd-tree-group{display:block;}
.hd-tree-group[hidden]{display:none;}
.hd-tree-project{padding:9px 12px 4px;color:var(--ink-2);font:600 11px var(--mono);}
.hd-tree-dir,.hd-tree-file{
  width:100%;
  border:0;
  margin:0;
  padding-block:9px;
  padding-inline-end:12px;
  background:transparent;
  color:inherit;
  font:inherit;
  text-align:left;
  appearance:none;
  display:flex;
  align-items:center;
  gap:8px;
  cursor:pointer;
}
.hd-tree-dir,.hd-tree-file{padding-inline-start:var(--tree-indent,10px);}
.hd-tree-dir:hover,.hd-tree-file:hover,.hd-tree-file.active{background:var(--field);}
.hd-tree-dir:focus-visible,.hd-tree-file:focus-visible{
  outline:2px solid var(--ink);
  outline-offset:-2px;
}
.hd-tree-file .hd-diff-path{
  direction:ltr;
  text-align:left;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.hd-tree-file .hd-diff-path::before{content:none;}
.hd-tree-file.deleted .hd-diff-path{opacity:1;color:var(--ink-2);text-decoration:line-through;}
```

Remove the retired `.hd-diff-proj` rule and the old `direction:rtl`/LRM workaround rather than leaving conflicting declarations. Remove the obsolete “D4 forbids syntax highlighting” comment. Ensure hover/active styling, chevrons, status markers, count alignment, basename ellipsis, and project labels all remain legible at narrow widths. Do not reduce deleted-file opacity; opacity would lower every descendant's measured contrast.

### 7.3 Use a palette that passes on every row tint

Scope the syntax variables to the diff pane and map all highlight.js scopes to this small set. Unlisted scopes inherit `--ink-2`, which also passes.

```css
.hd-diff-pane{
  --hd-syntax-comment:#5B6167;
  --hd-syntax-keyword:#B31D28;
  --hd-syntax-type:#9A3E00;
  --hd-syntax-string:#176B4D;
  --hd-syntax-literal:#713BB8;
  --hd-syntax-title:#075C82;
}
.hd-diff{
  --hd-count-add:#176B4D;
  --hd-count-del:#B31D28;
}
.hd-diff .diff-add{color:var(--hd-count-add);}
.hd-diff .diff-del{color:var(--hd-count-del);}
.hd-diff-pane :is(.hljs-comment,.hljs-quote,.hljs-punctuation){color:var(--hd-syntax-comment);}
.hd-diff-pane :is(.hljs-keyword,.hljs-operator,.hljs-meta,.hljs-deletion){color:var(--hd-syntax-keyword);}
.hd-diff-pane :is(.hljs-type,.hljs-built_in,.hljs-attr,.hljs-attribute,
  .hljs-selector-class,.hljs-selector-id,.hljs-selector-tag){color:var(--hd-syntax-type);}
.hd-diff-pane :is(.hljs-string,.hljs-regexp,.hljs-addition){color:var(--hd-syntax-string);}
.hd-diff-pane :is(.hljs-number,.hljs-literal,.hljs-symbol,.hljs-bullet,
  .hljs-variable,.hljs-template-variable){color:var(--hd-syntax-literal);}
.hd-diff-pane :is(.hljs-title,.hljs-section,.hljs-name){color:var(--hd-syntax-title);}
.hd-diff-pane :is(.hljs-comment,.hljs-quote){font-style:italic;}
.hd-diff-pane .hint,.hd-diff-list .hint,.hd-tree .hint,.hd-diff-note{color:var(--ink-2);}
```

These reviewed contrast ratios are against `--panel`, `--green-bg`, and `--red-bg`, respectively:

| Foreground | Panel | Add tint | Delete tint |
|---|---:|---:|---:|
| `--ink-2` `#5C5C63` | 6.63 | 5.72 | 5.42 |
| comment `#5B6167` | 6.27 | 5.41 | 5.12 |
| keyword `#B31D28` | 6.72 | 5.80 | 5.50 |
| type `#9A3E00` | 6.86 | 5.92 | 5.60 |
| string `#176B4D` | 6.47 | 5.58 | 5.29 |
| literal `#713BB8` | 6.95 | 6.00 | 5.68 |
| title `#075C82` | 7.34 | 6.33 | 6.00 |

The scoped add/delete count roles reuse the string/keyword colors and are also tested against the active/hover `--field` background: 5.98:1 and 6.21:1. This replaces the global `--red-ink` for Diff counts, whose `#C5483A` is only about 4.45:1 on `--field`. All scoped values clear 4.5:1. By comparison, current `--ink-3` is approximately 2.80:1 on the panel and must not be used for 12px gutter, hunk, truncation, note, tree, project-label, or binary-count text.

### 7.4 CSS contract tests

In `test/ui-diff-style.test.mjs`, read the real stylesheet and test individual rule bodies rather than one whitespace-sensitive mega-string.

Assert:

- exactly three tracks in the required order;
- `.hd-dl-row`, but not every `.hd-dl`, uses `display:contents`;
- hunk, truncation, and note items span `1/-1`;
- `.hint` bodies are block layout;
- both gutters are sticky, opaque, non-selectable, and use correct left offsets/z-index;
- add/delete tint targets all row children;
- the code track/cell retains widest-row horizontal scrolling behavior;
- the real selected-file H3 resets its user-agent margin without losing the existing pane-path ellipsis;
- tree groups explicitly hide, directory/file buttons have explicit flex/alignment/gap/cursor/block/end padding rather than UA-dependent directory styling, hover and active states remain visible, controls keep focus styles, leaf names are LTR, and the LRM content is absent;
- deleted file labels have no opacity reduction;
- no new diff/tree text rule uses `--ink-3`;
- all syntax, `--ink-2`, and scoped count foreground variables meet at least 4.5:1 against every possible background; include `--field` for hunk text and for counts inside hover/active tree rows;
- every syntax selector references one of the tested variables and no rule adds a token background that obscures row tint.

Implement the standard sRGB relative-luminance formula in the test—do not pin only the table above as magic assertions. Fail with a message naming foreground, background, and computed ratio.

Run:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test \
  test/ui-diff-style.test.mjs test/ui-history-detail.test.mjs
npm test
```

---

## Task 8 — Real-browser verification and final audit

### 8.1 Use disposable state and a controlled fixture

Plain `npm start` reads the normal Worca home, runs boot maintenance, and starts channel workers. Never aim this verification at the developer's ordinary state.

History is DB-backed, so hand-writing `state.json` cannot create a visible fixture. Use the production-backed `seedWorkspacePipeline`, capture its minted run ID, and write results/diff artifacts through `persistResults` and `persistDiffPatch`. The following one-off seeder runs from the repository root, creates only disposable project repositories/state, and adds no repository file:

```bash
qa_home="$(mktemp -d /tmp/worca-diff-qa.XXXXXX)"
qa_fixture="$qa_home/fixture"
mkdir -p "$qa_fixture/alpha" "$qa_fixture/beta"
git -C "$qa_fixture/alpha" init -q
git -C "$qa_fixture/beta" init -q

WORCA_HOME="$qa_home" QA_FIXTURE_ROOT="$qa_fixture" \
node --input-type=module <<'NODE'
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { _resetForTests } from './src/core/db.mjs';
import { projectKey } from './src/core/store.mjs';
import { persistDiffPatch, persistResults, rollupSummary } from './src/core/results.mjs';
import { seedWorkspacePipeline } from './test/helpers/db-seed.mjs';
import { MAX_FILE_SECTION_RENDER_ITEMS } from './ui/public/diff-view.mjs';

const root = process.env.QA_FIXTURE_ROOT;
if (!root) throw new Error('QA_FIXTURE_ROOT is required');
const alphaDir = join(root, 'alpha');
const betaDir = join(root, 'beta');
await Promise.all([mkdir(alphaDir, { recursive: true }), mkdir(betaDir, { recursive: true })]);
_resetForTests();

const alphaKey = projectKey(alphaDir);
const betaKey = projectKey(betaDir);
const workspaceKey = 'wks-diff-qa-12345678';
const longPath = `src/long-${'x'.repeat(180)}.js`;

const alpha = [
  {
    path: 'src/app.js', status: 'M', hunks: [
      { oldStart: 1, newStart: 1, rows: [
        { kind: 'del', text: 'const oldValue = 1;' },
        { kind: 'add', text: 'const value = 2;' },
        { kind: 'ctx', text: '/* renderer-looking source:' },
        { kind: 'ctx', text: '<script>alert("not markup")</script>' },
        { kind: 'ctx', text: '*/' },
      ] },
      { oldStart: 10, newStart: 10, rows: [
        { kind: 'ctx', text: 'console.log(value);' },
        { kind: 'del', text: 'return oldValue;' },
        { kind: 'add', text: '' },
        { kind: 'add', text: 'return value;' },
      ] },
    ],
  },
  {
    path: 'tools/new.py', from: 'tools/old.ts', status: 'R', hunks: [{
      oldStart: 1, newStart: 1, rows: [
        { kind: 'del', text: 'export const answer: number = 41;' },
        { kind: 'add', text: 'answer = 42' },
      ],
    }],
  },
  { path: 'src/shared.js', status: 'M', hunks: [{ oldStart: 1, newStart: 1, rows: [
    { kind: 'del', text: 'export const owner = "old-alpha";' },
    { kind: 'add', text: 'export const owner = "alpha";' },
  ] }] },
  { path: 'src/over-limit.js', status: 'A', hunks: [{ oldStart: 0, newStart: 1, rows: [
    { kind: 'add', text: `const payload = "${'x'.repeat(100_001)}";` },
  ] }] },
  { path: 'src/truncated.js', status: 'A', hunks: [{ oldStart: 0, newStart: 1, rows: [
    { kind: 'add', text: 'z'.repeat(500_100) },
  ] }] },
  { path: 'src/many-lines.js', status: 'A', hunks: [{
    oldStart: 0, newStart: 1,
    // The hunk header is item 1; cap source rows make the section exactly one over.
    rows: Array.from({ length: MAX_FILE_SECTION_RENDER_ITEMS }, (_, i) => ({
      kind: 'add', text: `const n${i} = ${i};`,
    })),
  }] },
  { path: '.gitignore', status: 'M', hunks: [{ oldStart: 1, newStart: 1, rows: [
    { kind: 'del', text: 'tmp/' }, { kind: 'add', text: '.cache/' },
  ] }] },
  { path: longPath, status: 'A', hunks: [{ oldStart: 0, newStart: 1, rows: [
    { kind: 'add', text: `const wide = "${'w'.repeat(350)}";` },
  ] }] },
  { path: 'assets/logo.png', status: 'A', binary: true, hunks: [] },
];

const beta = [
  { path: 'src/shared.js', status: 'M', hunks: [{ oldStart: 1, newStart: 1, rows: [
    { kind: 'del', text: 'export const owner = "old-beta";' },
    { kind: 'add', text: 'export const owner = "beta";' },
  ] }] },
  { path: 'main.py', status: 'M', hunks: [{ oldStart: 1, newStart: 1, rows: [
    { kind: 'del', text: 'print("old")' }, { kind: 'add', text: 'print("python")' },
  ] }] },
  { path: 'lib.rs', status: 'M', hunks: [{ oldStart: 1, newStart: 1, rows: [
    { kind: 'del', text: 'let n = 1;' }, { kind: 'add', text: 'let n: usize = 2;' },
  ] }] },
  { path: 'main.go', status: 'M', hunks: [{ oldStart: 1, newStart: 1, rows: [
    { kind: 'del', text: 'println("old")' }, { kind: 'add', text: 'fmt.Println("go")' },
  ] }] },
  { path: 'main.tf', status: 'M', hunks: [{ oldStart: 1, newStart: 1, rows: [
    { kind: 'del', text: 'enabled = false' }, { kind: 'add', text: 'enabled = true' },
  ] }] },
];

function hunkText({ oldStart, newStart, rows }) {
  const oldCount = rows.reduce((n, row) => n + (row.kind === 'add' ? 0 : 1), 0);
  const newCount = rows.reduce((n, row) => n + (row.kind === 'del' ? 0 : 1), 0);
  const prefix = { ctx: ' ', del: '-', add: '+' };
  return [
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...rows.map((row) => `${prefix[row.kind]}${row.text}`),
  ].join('\n');
}

function patchFor(file) {
  const oldPath = file.from || file.path;
  const lines = [`diff --git a/${oldPath} b/${file.path}`];
  if (file.status === 'A') lines.push('new file mode 100644');
  if (file.from) lines.push('similarity index 80%', `rename from ${file.from}`, `rename to ${file.path}`);
  if (file.binary) {
    lines.push('index 0000000..1111111', `Binary files /dev/null and b/${file.path} differ`);
    return lines.join('\n');
  }
  lines.push(`--- ${file.status === 'A' ? '/dev/null' : `a/${oldPath}`}`);
  lines.push(`+++ ${file.status === 'D' ? '/dev/null' : `b/${file.path}`}`);
  for (const hunk of file.hunks) lines.push(hunkText(hunk));
  return lines.join('\n');
}

function resultEntry(file) {
  let added = 0;
  let removed = 0;
  for (const hunk of file.hunks) for (const row of hunk.rows) {
    if (row.kind === 'add') added += 1;
    if (row.kind === 'del') removed += 1;
  }
  const out = { path: file.path, status: file.status };
  if (file.from) out.from = file.from;
  if (file.binary) out.binary = true;
  else Object.assign(out, { added, removed });
  if (!['A', 'C'].includes(file.status)) out.issues = [];
  return out;
}

function projectResults(files) {
  const entries = files.map(resultEntry);
  const newFiles = entries.filter((file) => ['A', 'C'].includes(file.status));
  const changedFiles = entries.filter((file) => !['A', 'C'].includes(file.status));
  return {
    summary: {
      filesNew: newFiles.length,
      filesChanged: changedFiles.length,
      filesDeleted: changedFiles.filter((file) => file.status === 'D').length,
      linesAdded: entries.reduce((n, file) => n + (file.added || 0), 0),
      linesRemoved: entries.reduce((n, file) => n + (file.removed || 0), 0),
      blockingIssues: 0,
      nitpicks: 0,
    },
    newFiles, changedFiles, keyThingsToCheck: [], nitpicks: [],
  };
}

const projects = [
  { projectKey: alphaKey, projectDir: alphaDir, projectName: 'Alpha' },
  { projectKey: betaKey, projectDir: betaDir, projectName: 'Beta' },
];
const { id, dir } = await seedWorkspacePipeline(alphaDir, workspaceKey, {
  title: 'Diff syntax QA', status: 'done', phase: 'done',
  workspaceKey, workspaceId: workspaceKey, workspaceName: 'Diff Syntax QA',
  projectKeys: projects.map(({ projectKey: key }) => key), projects,
}, projects);
const perProject = {
  [alphaKey]: projectResults(alpha),
  [betaKey]: projectResults(beta),
};
await persistResults(dir, { summary: rollupSummary(perProject), perProject });
const patch = [
  `# ${alphaKey}\n${alpha.map(patchFor).join('\n\n')}`,
  `# ${betaKey}\n${beta.map(patchFor).join('\n\n')}`,
].join('\n\n');
await persistDiffPatch(dir, `${patch}\n`);
console.log(JSON.stringify({ workspaceKey, runId: id, alphaKey, betaKey, qaHome: process.env.WORCA_HOME }, null, 2));
NODE

WORCA_HOME="$qa_home" WORCA_MOCK=1 PORT=4318 npm start
```

The printed ID is authoritative; `seedWorkspacePipeline` mints it. Open the corresponding completed workspace run from History rather than guessing an ID. The fixture intentionally covers:

| Fixture | Contract exercised |
|---|---|
| `alpha/src/app.js` | JavaScript, two hunks, multiline comment, literal `<script>` source, empty added line |
| `alpha/tools/old.ts -> tools/new.py` | cross-extension rename selecting the new Python grammar |
| both `src/shared.js` files | duplicate relative paths with project-scoped identity |
| `src/over-limit.js` | supported file over 100,000 UTF-8 input bytes; zero loader calls |
| `src/truncated.js` | section over 500,000 code units; honest truncation note |
| `src/many-lines.js` | one-over base-render-item cap; bounded plain DOM and no spread crash |
| `.gitignore` and the generated long basename/line | dotfile fallback, ellipsis, narrow layout, horizontal scroll |
| `assets/logo.png` | binary result/patch state |
| Beta `.py`, `.rs`, `.go`, and `.tf` | three mapped grammars plus unsupported Terraform/HCL fallback |

Record the disposable path, stop the server with Ctrl-C after verification, and remove only that exact temporary directory if cleanup is desired. Do not reuse a normal Worca data directory.

### 8.2 Browser checklist

Verify in a real browser with the Network, Elements, and Accessibility panes available:

1. Open History -> completed fixture -> Diff. The deterministic first leaf is the Alpha binary under `assets/`, so explicitly select `alpha/src/app.js`; with DevTools cache disabled and the grammar request throttled, numbered plain rows connect first, then gain token spans without replacing their source rows.
2. Context rows show both numbers, deletion only old, addition only new, and the second hunk resets to its declared ranges.
3. A wide row scrolls horizontally while both opaque gutters remain pinned; add/delete tint extends to the widest code column for every shorter row.
4. Selecting only code rows copies ASCII prefixes and exact source text, with no gutter numbers. Describe this as row-copy fidelity, not a complete `git apply` patch because file headers are intentionally absent.
5. Retry scenario: on a fresh page, block only the exact first-attempt Python URL ending in `/python.min.js?retry=0`, select an as-yet-unvisited Python file, wait for the plain fallback, remove that exact block, and reselect it. Confirm `/python.min.js?retry=1` succeeds. Do not leave a broad grammar block enabled.
6. Stale-selection scenario: reload into a fresh document with DevTools cache disabled and strong throttling, start an unvisited grammar for file A, then immediately select file B before A settles. Let the request finish; no token span or body from A appears in B.
7. Stale-navigation scenario: reload fresh with the same cache/throttle controls, start an unvisited grammar, navigate away while it is pending, then let it finish. The retired pane is not mutated and the console has no unhandled rejection.
8. Success/cache scenario last: reload into a fresh document, clear the Network log, and remove throttling/blocking. Selecting `.js`, `.py`, `.rs`, and `.go` imports the core module once and one grammar per language; repeated selections add no request. Unsupported/binary/over-limit files make no grammar request.
9. Select both copies of a workspace-relative path. Exactly one file has `aria-current`, and each pane resolves its own project section.
10. Collapse one of two same-named project directories. The other stays open, active selection remains, and no patch/network request is triggered.
11. Keyboard through directory and file buttons. Enter/Space work natively, focus remains visible, expansion is announced, and active file status/full path are accessible.
12. Verify a rename shows the current basename/path while its accessible/title text carries the old -> new relationship; cross-extension rename requests the new grammar.
13. Inspect a multiline token and embedded `<script>` source: row spans remain balanced, source `textContent` is exact, and no highlighter element other than `span[class]` exists.
14. Test 200% zoom, a narrow viewport, a dotfile, a long basename, an empty source line, and a truncated file. Controls and both gutters remain reachable, with no “500 KB” claim.
15. Sample token, gutter, hunk, note, and tree colors against panel/add/delete backgrounds in DevTools and reconcile them with the automated contrast test.

### 8.3 Final automated and repository audit

Run from the repository root:

```bash
npm ls @highlightjs/cdn-assets
npm test
test "$(git rev-parse HEAD)" = "2b799cab4cb6e2c8a47ec9f82c8b44fabc8e6e21"
test "$(git branch --show-current)" = "dev"
git diff --check
git diff --cached --quiet
git status --short
git diff -- package.json package-lock.json ui/server.mjs ui/public/diff-view.mjs \
  ui/public/app.js ui/public/style.css test/
```

`git diff` does not show untracked files. Read every new path explicitly:

```bash
for planned_file in \
  ui/public/syntax-highlight.mjs ui/public/hljs-loader.mjs ui/public/file-tree.mjs \
  test/api-hljs-assets.test.mjs test/syntax-highlight.test.mjs \
  test/hljs-loader.test.mjs test/file-tree.test.mjs test/ui-diff-style.test.mjs
do
  if ! test -f "$planned_file"; then
    echo "missing planned file: $planned_file" >&2
    exit 1
  fi
  sed -n '1,$p' "$planned_file"
done
```

Then scan both tracked and new planned files for trailing whitespace and missing final newlines:

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs';
const files = [
  'package.json', 'package-lock.json', 'ui/server.mjs',
  'ui/public/diff-view.mjs', 'ui/public/syntax-highlight.mjs',
  'ui/public/hljs-loader.mjs', 'ui/public/file-tree.mjs',
  'ui/public/app.js', 'ui/public/style.css',
  'test/api-hljs-assets.test.mjs', 'test/diff-view.test.mjs',
  'test/syntax-highlight.test.mjs', 'test/hljs-loader.test.mjs',
  'test/file-tree.test.mjs', 'test/ui-history-detail.test.mjs',
  'test/ui-diff-style.test.mjs',
];
let bad = false;
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  source.split('\n').forEach((line, i) => {
    if (/[ \t]+$/.test(line)) {
      console.error(`${file}:${i + 1}: trailing whitespace`);
      bad = true;
    }
  });
  if (source && !source.endsWith('\n')) {
    console.error(`${file}: missing final newline`);
    bad = true;
  }
}
if (bad) process.exitCode = 1;
NODE
```

Finally confirm:

- the complete suite has zero failures without relying on a hard-coded test count;
- the lock contains the exact cdn-assets version/integrity and no `highlight.js` package;
- no generated/vendor asset was copied into `ui/public` or elsewhere;
- `/vendor` misses are plain 404s and ordinary SPA fallback still works;
- any root-lock normalization is understood and called out;
- changes are limited to the planned implementation/test paths plus pre-existing user content;
- HEAD is still the pinned baseline and the branch is still `dev`, proving no local commit or branch switch occurred;
- no file was staged, reset, or cleaned. No push is authorized; local repository state cannot prove the absence of a remote push, so treat that as a procedural prohibition and record that no push command was run rather than claiming a mechanical check.

---

## Failure and degradation matrix

| Condition | Observable behavior | Retry/cache rule |
|---|---|---|
| Package resolution fails at server startup | One warning; app starts; all `/vendor` requests are plain 404; numbered diff stays usable | Restart after dependency is restored |
| Unknown or traversal-like vendor path | Plain `404 text/plain`, never SPA HTML or package data | Not applicable |
| Malformed percent-encoding under `/vendor` | Plain `400 text/plain`, never Express's HTML error page | Not applicable |
| Extension/name is unmapped | Numbered plain rows; no core or grammar request | Not applicable |
| File exceeds the base render-item cap | At most 5,000 hunk/source items plus an honest truncation note are connected | Reselect is deterministic; changing the cap requires a new parse |
| Parsed file exceeds actual highlighting work limits | Entire file stays numbered/plain; no loader call | Re-evaluate only if input/limits change |
| Core/grammar is slow | Plain body is already connected and paint-gated | Concurrent requests share one in-flight Promise |
| Core import or module shape fails | Plain body; no rejection escapes | Failed Promise evicted; next URL uses next core attempt |
| Grammar import or default-export shape fails | Plain body; no rejection escapes | Failed grammar Promise evicted; next request uses the next per-language URL |
| Isolated instance creation, grammar registration, or lookup fails | Plain body; no rejection escapes | No ready binding is cached; next call constructs a fresh instance from the successfully cached core factory/grammar function, with no network retry |
| Highlighter throws | Affected hunk remains plain | Reselect may try highlighting again; successful modules stay cached |
| Aggregate highlighter output budget is exhausted | Current/later hunks stay plain and no later highlighter calls run; earlier validated hunks remain enhanced | A new selection creates a fresh bounded attempt |
| Markup grammar, entity, row count, or decoded source differs | Affected hunk remains wholly plain | No connected DOM mutation |
| Detached DOM fidelity check differs | Affected hunk remains wholly plain | No partial hunk commit |
| User selects another file during patch fetch | Only newest selection appends a body | Existing `selEpoch`; one shared patch Promise |
| User navigates away during patch fetch | Retired screen appends no body and starts no grammar load, even during its close transition | Epoch + current-screen ownership check after the patch await |
| User selects/navigates during highlighter load | Old completion is discarded | Epoch + connected/body ownership checks |
| Patch fetch fails | Existing error note appears | Patch Promise resets; later selection retries |
| Binary, mode-only, or missing textual section | Existing plain explanatory note | Highlighting is never consulted |
| Duplicate workspace relative paths | Project-scoped active key and patch lookup | Collapse and selection state remain independent |

## Explicit non-goals and residual risks

- Git C-quoted unusual paths remain a known parser limitation. They fail gracefully to “no textual diff”; selector-hostile tree tests do not claim to fix patch decoding.
- The pane omits file headers, so copied source rows are not a complete patch even though their prefixes/text are exact.
- highlight.js lexing remains synchronous on the browser main thread. The measured byte/row caps and paint gate bound common work and preserve first paint, but cannot guarantee a time ceiling for every grammar/input. A Worker architecture is a separate follow-up if real measurements show jank.
- Project roots are intentionally static headings. Directories are the collapsible units; implementing complete ARIA-tree arrow-key behavior is not part of this change.
- No auto-detection is performed. Only the exact reviewed path map loads grammars.
- Optional sublanguage dependency closures are not loaded. Each primary language runs in an isolated instance with only its own grammar, so embedded regions may remain plain but output cannot change with file-selection order.

## External contracts verified for this plan

- The official [highlight.js README](https://github.com/highlightjs/highlight.js/blob/main/README.md) documents browser ESM/core usage, and the [Core API](https://highlightjs.readthedocs.io/en/latest/api.html) documents `registerLanguage`, `getLanguage`, `newInstance`, and `highlight`.
- The pinned [11.12.0 HTML renderer source](https://github.com/highlightjs/highlight.js/blob/11.12.0/src/lib/html_renderer.js#L50-L79) is the basis for accepting normal `hljs-*` scopes, tier suffix classes, and `language-*` sublanguage wrappers; its pinned [escape helper](https://github.com/highlightjs/highlight.js/blob/11.12.0/src/lib/utils.js) is the basis for the five accepted text entities.
- The exact runtime artifact is [@highlightjs/cdn-assets 11.12.0](https://www.npmjs.com/package/%40highlightjs/cdn-assets).
- The HTML Standard's [module map](https://html.spec.whatwg.org/multipage/webappapis.html#module-map) keys module loads by URL, which is why retries change the query URL.

These external observations are pinned by local package/API/behavioral tests so the implementation fails visibly if a future dependency change invalidates an assumption.

## Definition of done

- The exact dependency and every mapped grammar are reachable only through the narrow, tested vendor routes.
- Parser ranges and old/new line numbers are safe, consistent, and correct across unified-diff edge cases.
- Plain rendering is capped independently of highlighting, stops at a row boundary, and reports truncation honestly.
- Plain numbered rows render before optional work and remain the permanent fallback.
- Highlight work is preflighted in actual UTF-8 bytes/side rows before loading, then rechecked by the pure module.
- Only strict, source-equivalent, hunk-atomic `span[class]` markup reaches connected DOM.
- Failed native imports can genuinely retry via distinct URLs without losing concurrent deduplication or successful caches.
- Highlight output is deterministic across file-selection order because each cached primary-language binding owns an isolated core instance.
- Tree ordering, compaction, identity, active state, and collapse state are deterministic and project-scoped.
- Native control semantics, focus, accessible names, gutter labels, and `aria-current` are verified.
- Sticky gutters, full-width tint, hint/truncation placement, LTR basename ellipsis, and all new small-text colors have regression coverage.
- Existing patch-fetch retry and rapid-selection behavior still pass.
- Targeted suites, the full suite, repository/whitespace audit, and controlled real-browser checklist all pass.
- Only planned files changed; pre-existing user content is preserved; nothing was committed or pushed.
