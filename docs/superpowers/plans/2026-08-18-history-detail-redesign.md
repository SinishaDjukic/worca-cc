# History Detail Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace History's expand-in-place cards with a redesigned list + a full-screen, hash-addressable run-detail page (slide transition, pill tabs: Diff / Overview / Agents / Clarify / Logs, full patch viewer, "Ship it?" PR modal, confirmModal Archive).

**Architecture:** Vanilla-JS SPA (no framework, no build step). The `[data-view="history"]` section becomes a two-screen shell — the existing list screen plus a new detail screen — animated by a CSS class toggle. Detail is routed as `#history/<projectKey>/<id>` through the existing `parseHash`/`showView` machinery. A new pure module `ui/public/diff-view.mjs` parses unified patches; one new server route family serves the persisted `diff-patch.patch` inline. All shared internals (graph, log stack, sub-agent projections, cost banner, confirmModal) are reused, not forked.

**Tech Stack:** Vanilla ES modules, Express server (`ui/server.mjs`), SQLite-backed core (`src/core/artifacts.mjs`), node:test + jsdom for UI tests.

**Spec:** `docs/superpowers/specs/2026-08-18-history-detail-redesign-design.md` (read it first; its §2 locked decisions D1–D8 are binding).

## Global Constraints

- **Never `git add` anything under `docs/superpowers/`** — plans/specs stay untracked (user rule).
- Baseline suite is fully green; keep it green: `npm test` must pass at every task's end. In a fresh worktree run `npm ci` first (skipping it causes bogus express failures).
- jsdom UI tests boot the REAL `ui/public/index.html` + `ui/public/app.js` (see `test/ui-history.test.mjs:23-96` boot helper); template/markup changes require matching test updates in the same task.
- The diff minus glyph is **U+2212 (−)**, never ASCII hyphen; tests assert it byte-for-byte (`app.js:8515`).
- `fmtDate` is `toLocaleString()` — locale- AND timezone-dependent. **No test may assert a literal day/clock string**; assert presence/segment structure only (`splitDateStamp` degrades to `{day: whole, clock: ''}` on comma-less locales, and the meta painter skips empty segments).
- No new dependencies. No syntax highlighting (spec D4). No model display anywhere (spec D5). No backend diff persistence changes (spec D1). Archive semantics unchanged — copy only (spec D2).
- All new animations must be inert under `@media (prefers-reduced-motion: reduce)` — the global kill switch at `ui/public/style.css:756` must keep covering them (no `transition`/`animation` with `!important`).
- New CSS namespaces: `.hist-*` (list card v2) and `.hd-*` (history detail screen). Do not restyle Running's shared classes (`.run-flow`, `.log-filters`, `.log`, `.subs-*` stay untouched in behavior; History-scoped overrides go under `.hd-sec-logs` etc.).
- Existing endpoints and their shapes are fixed; the ONLY server change is the new `/diff` route pair (Task 2).
- Reuse, do not fork: `buildRunGraph`/`paintHistStepper`, `buildLogFilterBar`/`log-line.mjs`/`log-filter.mjs`/`appendLogRec`/`copyLogToClipboard`, `subsGroupsForRender`/`cycleAwareLabel`/`stepSkillsFromSteps`/`stepGraphifyFromSteps`/`stepStatusByKey`, `renderCostPauseBanner`, `renderRetainedWork`/`addRecoveryPatchLink`/`setupDiscardWorktreeButton`, `confirmModal`, `copyBranchToClipboard`, `runActionQuery`, `historyDetailUrl`/`historyLogUrl`, `fmtDate`/`fmtDuration`/`fmtUsd`/`fmtUsd4`/`estTitle`, `issueList`, `cssEscape`.
- Commit after every task (implementation + test files only). Commit messages in normal English (Conventional Commits style used in this repo, e.g. `feat(ui): …`, `fix(pipeline): …`).

## File Structure

| File | Role |
|---|---|
| `ui/public/diff-view.mjs` (new) | Pure unified-diff parsing + per-file section slicing. DOM-free, unit-tested standalone (pattern: `log-line.mjs`/`log-filter.mjs`). |
| `ui/public/index.html` | History view restructured into `.hist-shell` (list screen + detail screen), new `#hist-card-tpl`, new `#hist-detail-tpl`, new `#shipit-modal`. |
| `ui/public/app.js` | History section rewritten: card builder v2, router param handling, detail screen controller (`openHistDetail`/`closeHistDetail` + tab painters), ship-it modal, removals of accordion painters. |
| `ui/public/style.css` | List-card v2 + `.hd-*` detail styles + slide + modal animation. |
| `ui/server.mjs` | `GET /api/history/:key/:id/diff` + `GET /api/workspaces/:id/runs/:runId/diff`. |
| `test/diff-view.test.mjs` (new) | Parser unit tests. |
| `test/history-api.test.mjs` | + diff-route tests. |
| `test/ui-history*.test.mjs` (12 files) | Adapted per task; new `test/ui-history-detail.test.mjs`, `test/ui-history-routing.test.mjs`, `test/ui-history-shipit.test.mjs`. |

Task order: 1–2 are independent foundations (parser, server). 3 adds routing + the two-screen shell + the detail skeleton **while the old expandable cards keep working** (detail is reachable by hash only until Task 11). 4 detail header actions + banners. 5 tabs machinery. 6–9 the five tab bodies (Diff; Overview; Agents+Clarify; Logs). 10 ship-it modal + PR wiring. 11 flips the list card to the v2 design, points it at the detail page, and removes the accordion machinery + its painters (all old card tests adapt here, when their replacement already exists). 12 CSS polish + dead-code sweep + full verification.

---

### Task 1: `diff-view.mjs` — unified-patch parser

**Files:**
- Create: `ui/public/diff-view.mjs`
- Test: `test/diff-view.test.mjs`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Task 6's Diff tab):
  - `splitPatchSections(text) -> Array<{ project: string|null, path: string|null, oldPath: string|null, raw: string }>` — cheap single pass; `raw` is the file's whole section text (headers + hunks). `project` comes from workspace `# <projectKey>` marker lines.
  - `parseFileSection(raw) -> { binary: boolean, hunks: Array<{ header: string, lines: Array<{ kind: 'ctx'|'add'|'del', text: string }> }> }` — parse one section on demand (lazy per selected file).
  - `patchIndex(sections) -> Map<string, section>` keyed by `sectionKey(project, path)`; `sectionKey(project, path) -> string` (`project ? project + ' ' + path : path`).
  - `MAX_FILE_SECTION_BYTES = 500_000` — sections larger than this are truncated at the limit before parsing; parse result gains `truncated: true`.

- [ ] **Step 1: Write the failing tests**

Create `test/diff-view.test.mjs` (pure node:test, no jsdom — same style as the module tests for `log-filter.mjs`):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitPatchSections, parseFileSection, patchIndex, sectionKey, MAX_FILE_SECTION_BYTES,
} from '../ui/public/diff-view.mjs';

const SIMPLE = `diff --git a/src/a.js b/src/a.js
index 111..222 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1,3 +1,4 @@ top
 line1
-old
+new
+added
 line3
`;

test('splitPatchSections: one modified file', () => {
  const s = splitPatchSections(SIMPLE);
  assert.equal(s.length, 1);
  assert.equal(s[0].path, 'src/a.js');
  assert.equal(s[0].oldPath, 'src/a.js');
  assert.equal(s[0].project, null);
  assert.ok(s[0].raw.startsWith('diff --git'));
});

test('parseFileSection: hunks + line kinds', () => {
  const f = parseFileSection(splitPatchSections(SIMPLE)[0].raw);
  assert.equal(f.binary, false);
  assert.equal(f.hunks.length, 1);
  assert.equal(f.hunks[0].header, '@@ -1,3 +1,4 @@ top');
  assert.deepEqual(f.hunks[0].lines.map((l) => l.kind), ['ctx', 'del', 'add', 'add', 'ctx']);
  assert.equal(f.hunks[0].lines[1].text, 'old');
});

test('new + deleted files resolve path from the surviving side', () => {
  const txt = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/fresh.txt b/fresh.txt
new file mode 100644
--- /dev/null
+++ b/fresh.txt
@@ -0,0 +1 @@
+hi
`;
  const s = splitPatchSections(txt);
  assert.equal(s[0].path, 'gone.txt');   // +++ is /dev/null -> old side
  assert.equal(s[1].path, 'fresh.txt');
});

test('rename keeps both paths', () => {
  const txt = `diff --git a/old-name.js b/new-name.js
similarity index 90%
rename from old-name.js
rename to new-name.js
--- a/old-name.js
+++ b/new-name.js
@@ -1 +1 @@
-x
+y
`;
  const [f] = splitPatchSections(txt);
  assert.equal(f.path, 'new-name.js');
  assert.equal(f.oldPath, 'old-name.js');
});

test('binary section flagged, no hunks', () => {
  const txt = `diff --git a/img.png b/img.png
index 111..222 100644
Binary files a/img.png and b/img.png differ
`;
  const f = parseFileSection(splitPatchSections(txt)[0].raw);
  assert.equal(f.binary, true);
  assert.equal(f.hunks.length, 0);
});

test('workspace "# <projectKey>" markers scope the project + survive as separators', () => {
  const txt = `# proj-alpha-12345678
diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -1 +1 @@
-x
+y
# proj-beta-87654321
diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -1 +1 @@
-p
+q
`;
  const s = splitPatchSections(txt);
  assert.equal(s.length, 2);
  assert.equal(s[0].project, 'proj-alpha-12345678');
  assert.equal(s[1].project, 'proj-beta-87654321');
  const idx = patchIndex(s);
  assert.ok(idx.get(sectionKey('proj-alpha-12345678', 'a.js')));
  assert.ok(idx.get(sectionKey('proj-beta-87654321', 'a.js')));
  assert.notEqual(idx.get(sectionKey('proj-alpha-12345678', 'a.js')),
                  idx.get(sectionKey('proj-beta-87654321', 'a.js')));
});

test('oversized section is truncated and flagged', () => {
  const big = 'diff --git a/big.txt b/big.txt\n--- a/big.txt\n+++ b/big.txt\n@@ -1,1 +1,1 @@\n'
    + '+x\n'.repeat(Math.ceil(MAX_FILE_SECTION_BYTES / 3));
  const f = parseFileSection(splitPatchSections(big)[0].raw);
  assert.equal(f.truncated, true);
  assert.ok(f.hunks.length >= 1);
});

test('empty / junk input -> empty sections', () => {
  assert.deepEqual(splitPatchSections(''), []);
  assert.deepEqual(splitPatchSections('not a diff at all\njust text\n'), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/diff-view.test.mjs`
Expected: FAIL — `Cannot find module .../ui/public/diff-view.mjs`.

- [ ] **Step 3: Implement the module**

Create `ui/public/diff-view.mjs`:

```js
// diff-view.mjs — pure unified-diff parsing for the History Diff tab.
// DOM-free on purpose (pattern: log-line.mjs / log-filter.mjs) so node:test can
// exercise it without jsdom. Input is the persisted diff-patch.patch artifact;
// workspace runs concatenate per-member patches, each prefixed with a
// "# <projectKey>" comment line (src/core/results.mjs persistDiffPatch).

export const MAX_FILE_SECTION_BYTES = 500_000;

// One cheap pass: split the patch into per-file sections. Lines outside any
// "diff --git" section are ignored, EXCEPT "# <key>" markers, which set the
// project context for the sections that follow (workspace patches).
export function splitPatchSections(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  let project = null;
  let cur = null;
  const flush = () => { if (cur) { cur.raw = cur.rawLines.join('\n'); delete cur.rawLines; out.push(cur); cur = null; } };
  for (const line of lines) {
    if (!cur && /^# \S/.test(line)) { project = line.slice(2).trim(); continue; }
    if (line.startsWith('diff --git ')) {
      flush();
      // Reset project on a marker BETWEEN sections; a marker line inside hunk
      // context never starts with "diff --git" so it cannot end a section.
      cur = { project, path: null, oldPath: null, rawLines: [line] };
      continue;
    }
    if (!cur) continue; // markers outside a section were consumed above

    // A workspace marker terminates the current section. (The `^# \S` regex can
    // never match a hunk line: adds are '+…', deletes '-…', context ' …'.)
    if (/^# \S/.test(line)) {
      flush();
      project = line.slice(2).trim();
      continue;
    }
    cur.rawLines.push(line);
    if (cur.oldPath == null && line.startsWith('--- ')) {
      const p = stripSide(line.slice(4));
      if (p) cur.oldPath = p;
    } else if (cur.path == null && line.startsWith('+++ ')) {
      const p = stripSide(line.slice(4));
      if (p) cur.path = p;
    } else if (line.startsWith('rename from ')) {
      cur.oldPath = line.slice('rename from '.length).trim();
    } else if (line.startsWith('rename to ')) {
      cur.path = line.slice('rename to '.length).trim();
    }
  }
  flush();
  // Deleted files have "+++ /dev/null": fall back to the old side; brand-new
  // files have "--- /dev/null": oldPath stays null-ish -> mirror the new side.
  for (const s of out) {
    if (!s.path) s.path = s.oldPath;
    if (!s.oldPath) s.oldPath = s.path;
  }
  return out;
}

// "a/src/x.js" -> "src/x.js"; "/dev/null" and "" -> null. Tab-terminated names
// (git quotes paths with tabs/spaces via a trailing tab) are trimmed.
function stripSide(s) {
  const t = String(s || '').split('\t')[0].trim();
  if (!t || t === '/dev/null') return null;
  return t.replace(/^[ab]\//, '');
}

// Parse ONE section's hunks. Lazy per selected file — never called for the
// whole patch up front.
export function parseFileSection(raw) {
  let text = String(raw || '');
  let truncated = false;
  if (text.length > MAX_FILE_SECTION_BYTES) {
    text = text.slice(0, MAX_FILE_SECTION_BYTES);
    truncated = true;
  }
  const res = { binary: false, truncated, hunks: [] };
  let hunk = null;
  const rows = text.split('\n');
  // A \n-terminated section yields a trailing '' from split (and the workspace
  // '\n\n' join leaves two at each seam); without the pop each becomes a phantom
  // empty context line at the end of the last hunk. A GENUINE empty context line
  // is the row ' ' (one space), never '' — so popping every trailing '' is safe.
  while (rows.length && rows[rows.length - 1] === '') rows.pop();
  for (const line of rows) {
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      res.binary = true;
      continue;
    }
    if (line.startsWith('@@')) {
      hunk = { header: line, lines: [] };
      res.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue; // still in the header block
    if (line.startsWith('+')) hunk.lines.push({ kind: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) hunk.lines.push({ kind: 'del', text: line.slice(1) });
    else if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    else hunk.lines.push({ kind: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line });
  }
  return res;
}

// DESCOPED, by design: git C-quotes unusual paths (non-ASCII / control chars /
// '"' / '\') as `--- "a/caf\303\251.md"`; those sections keep the quoted string
// as their path and won't match results paths, so the pane shows "(no textual
// diff for this file)" — graceful. A future unquoteGitPath() can lift this.
export function sectionKey(project, path) {
  return project ? `${project} ${path}` : String(path || '');
}

export function patchIndex(sections) {
  const m = new Map();
  for (const s of Array.isArray(sections) ? sections : []) {
    if (s && s.path) m.set(sectionKey(s.project, s.path), s);
  }
  return m;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/diff-view.test.mjs`
Expected: PASS (all 8).

- [ ] **Step 5: Commit**

```bash
git add ui/public/diff-view.mjs test/diff-view.test.mjs
git commit -m "feat(ui): unified-patch parser module for the History diff viewer"
```

---

### Task 2: Server — inline diff-patch routes

**Files:**
- Modify: `ui/server.mjs` (insert after the log route block ending at line 1539, and after the workspace log route ending at line 2040)
- Test: `test/history-api.test.mjs`

**Interfaces:**
- Consumes: `readRunArtifactText` + `DIFF_PATCH_FILE` — both already imported in `ui/server.mjs` (lines 24, 27).
- Produces (used by Task 6): `GET /api/history/:key/:id/diff` and `GET /api/workspaces/:id/runs/:runId/diff` → 200 `text/x-diff` body = the persisted patch, inline (no `Content-Disposition`); 404 `{error:'no diff'}` when the artifact is absent; 404 `{error:'pipeline not found'}` on a malformed key. Client URL builder `historyDiffUrl(id, record)` mirrors `historyLogUrl` (`app.js:9082-9092`) — defined in Task 6.

- [ ] **Step 1: Write the failing tests**

Append to `test/history-api.test.mjs` (its harness already boots the real server against a temp `WORCA_HOME` — see lines 26-43; `seedPipeline` returns `{id, key}` and the seeded run dir exists under the store):

```js
import { writeFile } from 'node:fs/promises';
// (merge into the existing import list at the top of the file)

// seedPipeline returns { id, dir, key } and createPipeline already mkdir'd `dir`
// (src/core/artifacts.mjs:805) — capture `alphaDir = seeded.dir` in before() next
// to the existing alphaId/alphaKey captures (test/history-api.test.mjs:37).

test('GET /api/history/:key/:id/diff serves the persisted patch inline', async () => {
  await writeFile(join(alphaDir, 'diff-patch.patch'),
    'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n');
  const r = await fetch(`${base}/api/history/${alphaKey}/${alphaId}/diff`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/x-diff/);
  assert.equal(r.headers.get('content-disposition'), null); // inline, not attachment
  assert.match(await r.text(), /^diff --git a\/x\.js/);
});

test('GET /api/history/:key/:id/diff -> 404 when absent / malformed key', async () => {
  assert.equal((await fetch(`${base}/api/history/${alphaKey}/no-such-id/diff`)).status, 404);
  assert.equal((await fetch(`${base}/api/history/..%2fevil/x/diff`)).status, 404);
});

test('workspace /diff route: key validation + concatenated patch round-trip', async () => {
  // Malformed workspace id -> 404 (WORKSPACE_KEY_RE reject), no seeding needed:
  assert.equal((await fetch(`${base}/api/workspaces/..%2fevil/runs/x/diff`)).status, 404);
  // Positive case: seed a workspace pipeline the way the workspace suites do
  // (grep `test/` for an existing workspace seeding helper/pattern — e.g. the
  // fixture setup in the workspace pipeline API tests — and reuse it), write a
  // '# <projectKey>'-prefixed concatenated patch into its run dir, then:
  //   GET /api/workspaces/<wk>/runs/<id>/diff -> 200, body starts with '# ' and
  //   round-trips byte-for-byte (this is the exact input Task 1's workspace
  //   marker parsing consumes).
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/history-api.test.mjs`
Expected: the two new tests FAIL with 404 on the first (route unknown → express default 404) — the existing tests stay green.

- [ ] **Step 3: Implement the routes**

In `ui/server.mjs`, directly after the `/api/history/:key/:id/log` route (after line 1539):

```js
// ---------------------------------------------------------------------------
// GET /api/history/:key/:id/diff -> the run's persisted diff-patch.patch, inline
// (text/x-diff). Exists only for runs that reached done (results are built on
// the done path only); everything else 404s and the UI shows its empty state.
// Mirrors the /log route's key validation exactly.
// ---------------------------------------------------------------------------
app.get('/api/history/:key/:id/diff', async (req, res) => {
  if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(req.params.key)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    const text = await readRunArtifactText(req.params.key, req.params.id, DIFF_PATCH_FILE);
    if (text == null) return res.status(404).json({ error: 'no diff' });
    res.type('text/x-diff').send(text);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});
```

And directly after the `/api/workspaces/:id/runs/:runId/log` route (after line 2040):

```js
app.get('/api/workspaces/:id/runs/:runId/diff', async (req, res) => {
  if (!WORKSPACE_KEY_RE.test(req.params.id)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    const text = await readRunArtifactText(`workspaces/${req.params.id}`, req.params.runId, DIFF_PATCH_FILE);
    if (text == null) return res.status(404).json({ error: 'no diff' });
    res.type('text/x-diff').send(text);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/history-api.test.mjs`
Expected: PASS, including the pre-existing route tests.

- [ ] **Step 5: Commit**

```bash
git add ui/server.mjs test/history-api.test.mjs
git commit -m "feat(server): serve persisted diff-patch inline for history detail"
```

---

### Task 3: Two-screen shell, hash routing, detail skeleton

**Files:**
- Modify: `ui/public/index.html` (the `[data-view="history"]` section, lines 387-496)
- Modify: `ui/public/app.js` (router at 10529-10639 + a new "History detail" section after `renderHistoryError`, ~line 9610)
- Modify: `ui/public/style.css` (new `.hist-shell`/`.hist-screen`/`.hd-*` block; adjust `body.view-history .main` at line ~217)
- Test: create `test/ui-history-routing.test.mjs`

**Interfaces:**
- Consumes: `parseHash` (`app.js:657`), `showView` (`app.js:10529`), `historyDetailUrl(projectDir, id, record)` (`app.js:9071`), `buildRunGraph`/`paintHistStepper`, `state.historyAll`, `loadHistoryView`.
- Produces (used by Tasks 4-11):
  - Route `#history/<projectKey>/<id>` (projectKey may contain `/` only as the `workspaces/<wk>` prefix).
  - `histDetailParam(p) -> string` and `parseHistDetailParam(param) -> {projectKey, id, workspace} | null`.
  - `openHistDetail({projectKey, id, workspace}, {instant=false}) -> void` — builds the detail screen from `#hist-detail-tpl` into `#hist-detail`, fetches the detail payload, stores it as `histDetailState = { key, id, record, data, screen }` (module-level), paints header row 1 + graph, then calls the section painters added by later tasks (each is a no-op until its task lands: guard with `typeof fn === 'function'` is NOT needed — the painters are defined in this task as empty stubs and filled later).
  - `closeHistDetail({instant = false}) -> void` — removes `.detail-open`, clears `histDetailState`, empties `#hist-detail` after the transition (instant path clears immediately under `.no-anim`; animated path uses a one-shot `transitionend` listener plus a 600ms `setTimeout` fallback — timeout unref-guarded, both paths guarded by the `!histDetailState` check).
  - Empty stubs defined here and filled by later tasks: `paintHdHeaderMeta(screen, record, data)` (Task 4), `setupHdActions(screen, record, data)` (Task 4), `initHdTabs(screen, record, data)` (Task 5).
  - Element refs added to the `el` map (`app.js:134-136` region): `histShell: $('#hist-shell')`, `histDetail: $('#hist-detail')`.

- [ ] **Step 1: Write the failing tests**

Create `test/ui-history-routing.test.mjs`, cloning the boot helper pattern from `test/ui-history.test.mjs:23-96` verbatim (fresh JSDOM, stub `fetch`/`WebSocket`, cache-busted `import(appPath)`), plus these fixtures/handlers:

```js
const KEY = 'proj-alpha-abcd1234';
const ROW = {
  id: 'fcec04e8', projectKey: KEY, projectName: 'Alpha', projectDir: '/tmp/proj',
  title: 'Implement Log-UX Review Fixes', status: 'done',
  startedAt: '2026-08-17T20:54:42Z', branch: 'worca-cc/log-ux-fcec04e8',
  sourceBranch: 'feat/log-ux', survived: true, added: 12, removed: 3,
  totalCostUsd: 153.21, totalActiveMs: 6000000, mtime: 1,
};
const DETAIL = {
  state: { id: ROW.id, title: ROW.title, status: 'done', stepper: null, steps: [],
           subAgents: [], totalCostUsd: 153.21, totalActiveMs: 6000000,
           branch: { source: 'feat/log-ux', feature: ROW.branch, worktreeDir: '/tmp/wt' },
           prompt: 'Fix the log UX.' },
  results: null, overview: null, clarify: { questions: [], answers: [] },
  stepQuestions: [], artifacts: [], auditMarkdown: '# saved',
};
function handler(url) {
  if (url.includes('/api/history/pr')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
  if (url.endsWith('/api/history')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: [ROW], ghAvailable: false }) });
  if (url.includes(`/api/history/${KEY}/${ROW.id}`)) return Promise.resolve({ ok: true, status: 200, json: async () => DETAIL });
  return null;
}
```

Shared helper for every new suite (define locally in each file):

```js
async function settle() { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); }
```

Tests (call `await settle()` after each hash dispatch / click so chained fetch → paint microtasks flush — same idiom as the existing suites):

```js
test('#history/<key>/<id> opens the detail screen and fetches the keyed detail URL', async () => {
  const { window, calls } = await boot({ fetchHandler: handler });
  window.location.hash = `history/${KEY}/${ROW.id}`;
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window); // helper: 3x await setTimeout(0)
  const shell = window.document.querySelector('#hist-shell');
  assert.ok(shell.classList.contains('detail-open'));
  assert.ok(calls.some((c) => c.url.includes(`/api/history/${KEY}/${ROW.id}`)));
  assert.equal(window.document.querySelector('#hist-detail .hd-title').textContent, ROW.title);
});

test('back to #history closes the detail screen', async () => { /* open as above, then */
  window.location.hash = 'history';
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window);
  assert.equal(shell.classList.contains('detail-open'), false);
});

test('Escape with detail open navigates back (no modal open)', async () => { /* open, then */
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'history');
});

test('workspace param routes to the workspace detail endpoint', async () => {
  // ROW2 = { ...ROW, projectKey: 'workspaces/team-a', target: 'workspace', id: 'aa11bb22' }
  // handler serves /api/workspaces/team-a/runs/aa11bb22 -> DETAIL
  // hash 'history/workspaces/team-a/aa11bb22' -> assert that URL was fetched.
});

test('unknown id renders the detail error state with a working Back', async () => {
  // handler returns 404 {error:'pipeline not found'} for the detail URL
  // assert .hd-error text and that clicking .hd-back sets hash to 'history'
});

test('deep-link boot lands on detail without a list paint first', async () => {
  // The existing boot() helper hardcodes the JSDOM url (test/ui-history.test.mjs:24)
  // — this suite's clone must take it as a parameter:
  //   boot({ fetchHandler, url: `http://localhost:4317/#history/${KEY}/${ROW.id}` })
  // -> boot showView routes; assert detail-open + no throw + detail fetch happened.
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/ui-history-routing.test.mjs`
Expected: FAIL — `#hist-shell` is null (markup absent).

- [ ] **Step 3: Restructure the History view markup**

In `ui/public/index.html`, wrap the existing history content in the shell and add the detail screen + template. The section becomes:

```html
<section class="view hidden" data-view="history">
  <div class="hist-shell" id="hist-shell">
    <div class="hist-screen hist-screen-list">
      <div class="topbar"> …unchanged (lines 388-394)… </div>
      <div class="hist-filter" id="historyFilter" aria-label="Filter history by project"></div>
      <div class="run-list" id="history"></div>
      <template id="hist-card-tpl"> …unchanged in this task (lines 403-495)… </template>
    </div>
    <div class="hist-screen hist-screen-detail" id="hist-detail" aria-hidden="true"></div>
  </div>

  <template id="hist-detail-tpl">
    <div class="hd">
      <header class="hd-header">
        <div class="hd-row1">
          <button type="button" class="hd-back btn-ghost" aria-label="Back to history">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Back
          </button>
          <h1 class="hd-title"></h1>
          <span class="hd-sic hist-sic" role="img"></span>
          <span class="hist-merge" hidden></span>
          <button type="button" class="hd-pr" hidden>Create PR</button>
          <a class="hd-pr-link" hidden target="_blank" rel="noopener"></a>
        </div>
        <div class="hd-meta mono"></div>
        <div class="hd-row3">
          <span class="hd-base mono"></span>
          <button type="button" class="hd-branch-copy mono" hidden title="Copy branch name" aria-label="Copy branch name">
            <span class="hd-branch-name"></span>
            <svg class="ico-copy" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" stroke-linecap="round"/></svg>
            <svg class="ico-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 12.5l5.5 5.5L20 6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="hd-copied" hidden>Copied</span>
          <span class="hd-spacer"></span>
          <button type="button" class="hd-resume btn-ghost" hidden>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7z"/></svg>
            Resume
          </button>
          <button type="button" class="hd-archive" hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            Archive
          </button>
        </div>
      </header>
      <div class="hd-body">
        <div class="hd-banners">
          <span class="badge hist-retained-badge" hidden>Work retained</span>
          <div class="retained-banner" role="alert" hidden></div>
          <button type="button" class="hist-discard btn-ghost" hidden>Discard worktree</button>
        </div>
        <div class="hd-graph"><div class="run-flow-wrap"><div class="run-flow"></div></div></div>
        <div class="hd-tabs" role="tablist"></div>
        <div class="hd-sections"></div>
        <div class="hd-error" hidden></div>
      </div>
    </div>
  </template>
</section>
```

Notes:
- The status-icon span `.hist-sic` markup (4 SVG variants) is introduced here because the detail header needs it; Task 11 reuses the exact same span in the card template. Put the 4 icons inside `.hd-sic`:

```html
<span class="hd-sic hist-sic" role="img">
  <svg class="sic sic-done" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <svg class="sic sic-stopped" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
  <svg class="sic sic-paused" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>
  <svg class="sic sic-error" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 6.5v7"/><path d="M12 17.4h.01"/></svg>
</span>
```
- `.hist-merge` sits in row 1 next to the PR controls (relocated from the list card; the list card loses it in Task 11).

- [ ] **Step 4: Implement routing + the detail controller in app.js**

4a. `el` map (after `refreshHistory: $('#refresh-history'),` at `app.js:136`):

```js
  histShell: $('#hist-shell'),
  histDetail: $('#hist-detail'),
```

4b. `showView`'s history branch (`app.js:10590`) becomes:

```js
  if (name === 'history') {
    // List<->detail hops stay in-view: do NOT refetch /api/history on every hop —
    // a reload would re-trigger PR enrichment and (worse) the cache branch strips
    // `pr` from every row, blanking resolved PR pills mid-navigation.
    if (prevView !== 'history') loadHistoryView();
    routeHistoryDetail(param, { instant: prevView !== 'history' });
  }
```

where `prevView` is captured at the top of `showView` before `currentShownView = name;` (`app.js:10551`):

```js
  const prevView = currentShownView;
```

DELIBERATE behavior change: re-clicking the History nav button while already on History no longer refetches (the Refresh button is the refresh affordance; `pipelines-changed` broadcasts still force-reload). Also add a leave-guard next to the existing ones at the top of `showView` (`app.js:10532-10550`) so leaving History resets the track (spec §5.1):

```js
  if (currentShownView === 'history' && name !== 'history') closeHistDetail({ instant: true });
```

4c. New section after `renderHistoryError` (`app.js:9610`):

```js
// ---------------------------------------------------------------------------
// History detail screen (#history/<projectKey>/<id>)
// ---------------------------------------------------------------------------
// The param after "history/" is "<projectKey>/<id>". projectKey itself contains
// a slash ONLY as the fixed "workspaces/<wk>" prefix, and ids never contain "/",
// so splitting at the LAST slash is unambiguous.
function histDetailParam(p) { return `${p.projectKey}/${p.id}`; }

function parseHistDetailParam(param) {
  const s = String(param || '');
  const i = s.lastIndexOf('/');
  if (i <= 0 || i === s.length - 1) return null;
  const projectKey = s.slice(0, i);
  const id = s.slice(i + 1);
  return { projectKey, id, workspace: projectKey.startsWith('workspaces/') };
}

let histDetailState = null; // { key, id, record, data, screen } while open

function routeHistoryDetail(param, { instant = false } = {}) {
  const parsed = parseHistDetailParam(param);
  if (!parsed) { closeHistDetail({ instant }); return; }   // entering the view = no close animation
  // Re-routing to the already-open run is a no-op (hashchange echo).
  if (histDetailState && histDetailState.key === parsed.projectKey && histDetailState.id === parsed.id) return;
  openHistDetail(parsed, { instant });
}

function histRecordFor(parsed) {
  const hit = (state.historyAll || []).find((r) => r && r.id === parsed.id && r.projectKey === parsed.projectKey);
  if (hit) return hit;
  // Deep-link before the list loaded: a minimal record is enough for the keyed
  // detail/log/diff URL builders (they only read projectKey/target).
  return parsed.workspace
    ? { id: parsed.id, projectKey: parsed.projectKey, target: 'workspace' }
    : { id: parsed.id, projectKey: parsed.projectKey };
}

function openHistDetail(parsed, { instant = false } = {}) {
  const host = el.histDetail;
  const shell = el.histShell;
  if (!host || !shell) return;
  const record = histRecordFor(parsed);
  histDetailState = { key: parsed.projectKey, id: parsed.id, record, data: null, screen: null };

  host.innerHTML = '';
  const screen = $('#hist-detail-tpl').content.firstElementChild.cloneNode(true);
  host.appendChild(screen);
  histDetailState.screen = screen;

  screen.querySelector('.hd-back').addEventListener('click', () => { location.hash = 'history'; });
  screen.querySelector('.hd-title').textContent = record.title || parsed.id;
  paintHistStatusIcon(screen.querySelector('.hd-sic'), record);

  if (instant) shell.classList.add('no-anim');
  shell.classList.add('detail-open');
  host.setAttribute('aria-hidden', 'false');
  if (instant) rafSafe(() => shell.classList.remove('no-anim'));

  loadHistDetailScreen(screen, record, parsed);
}

// jsdom has no requestAnimationFrame unless pretendToBeVisual — fall back.
function rafSafe(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
  else setTimeout(fn, 0);
}

function closeHistDetail({ instant = false } = {}) {
  const shell = el.histShell;
  const host = el.histDetail;
  if (!shell || !host) return;
  if (!shell.classList.contains('detail-open')) { histDetailState = null; return; }
  histDetailState = null;
  if (instant) {
    // Entering the view from elsewhere (or leaving it): no 460ms close slide.
    shell.classList.add('no-anim');
    shell.classList.remove('detail-open');
    host.setAttribute('aria-hidden', 'true');
    host.innerHTML = '';
    rafSafe(() => shell.classList.remove('no-anim'));
    return;
  }
  shell.classList.remove('detail-open');
  host.setAttribute('aria-hidden', 'true');
  // Empty the screen after the slide (or via the timeout under reduced motion /
  // jsdom, where transitionend never fires natively).
  const clear = () => { if (!histDetailState) host.innerHTML = ''; };
  host.addEventListener('transitionend', clear, { once: true });
  const t = setTimeout(clear, 600);
  if (t && typeof t.unref === 'function') t.unref();
}

async function loadHistDetailScreen(screen, record, parsed) {
  try {
    const url = historyDetailUrl(record.projectDir || null, parsed.id, record);
    const res = await fetch(url);
    const data = await safeJson(res);
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    if (!data || !data.state) throw new Error('no saved details for this pipeline yet');
    if (!histDetailState || histDetailState.screen !== screen) return; // navigated away mid-fetch
    histDetailState.data = data;

    screen.querySelector('.hd-title').textContent = data.state.title || record.title || parsed.id;
    paintHistStatusIcon(screen.querySelector('.hd-sic'), { ...record, status: data.state.status });

    const flow = screen.querySelector('.run-flow');
    if (flow) buildRunGraph(flow, data.state.stepper);
    paintHistStepper(screen, data.state);

    paintHdHeaderMeta(screen, record, data);   // Task 4
    setupHdActions(screen, record, data);      // Task 4
    initHdTabs(screen, record, data);          // Task 5
  } catch (e) {
    const err = screen.querySelector('.hd-error');
    if (err) { err.hidden = false; err.textContent = `Could not load run: ${e.message}`; }
  }
}

// Status icon + family. Kept table-driven so the card (Task 11) and the detail
// header share one source of truth.
const HIST_STATUS_FAMILY = {
  done: 'done', complete: 'done', completed: 'done',
  stopped: 'stopped', aborted: 'stopped',
  error: 'error', failed: 'error',
  paused: 'paused', pausing: 'paused', interrupted: 'paused',
};
function histStatusMeta(p) {
  const s = String((p && p.status) || '').toLowerCase();
  const family = HIST_STATUS_FAMILY[s]
    || ((p && p.live) || s === 'running' || s === 'starting' ? 'paused' : '');
  const word = s === 'pausing' ? 'Pausing…'
    : s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown';
  return { family: family || 'paused', word };
}
function paintHistStatusIcon(host, p) {
  if (!host) return;
  const { family, word } = histStatusMeta(p);
  host.className = host.className.replace(/\bst-\w+\b/g, '').trim() + ` st-${family}`;
  host.title = word;
  host.setAttribute('aria-label', word);
  for (const svg of host.querySelectorAll('.sic')) {
    svg.toggleAttribute('hidden', !svg.classList.contains(`sic-${family}`));
  }
}

// --- stubs filled by later tasks (keep app.js loadable between tasks) -------
function paintHdHeaderMeta(_screen, _record, _data) {}
function setupHdActions(_screen, _record, _data) {}
function initHdTabs(_screen, _record, _data) {}
```

4d. Escape handler — **capture phase, so it reads modal state BEFORE the bubbling viewer handler at `app.js:9644` closes the viewer in the same keypress** (otherwise one Escape would close the viewer AND slide back to the list):

```js
// Escape on the History detail screen navigates back to the list — but never
// while any overlay modal is open (those own Escape). Capture-phase: the guard
// must see the viewer's pre-close state (its own handler runs in bubble phase).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (currentView() !== 'history') return;
  if (!el.histShell || !el.histShell.classList.contains('detail-open')) return;
  if (!el.viewerCard.classList.contains('hidden')) return;
  if (!el.confirmModal.classList.contains('hidden')) return;
  const plug = document.getElementById('plugin-modal');
  if (plug && !plug.classList.contains('hidden')) return;
  location.hash = 'history';
}, true);
```

Add a routing test for the interplay: open detail → open the saved-markdown viewer (title click) → one Escape closes ONLY the viewer (`detail-open` still set); a second Escape returns to the list.

- [ ] **Step 5: CSS for the shell + skeleton**

Append to `ui/public/style.css` (after the history block, ~line 745):

```css
/* ---------- History two-screen shell ---------- */
/* Flex column so the compact top-nav (<1080px, a sibling ABOVE the views inside
   .main) keeps its own height and the history view takes the REMAINDER — a plain
   height:100% would sit below the topnav and overflow:hidden would clip the
   bottom of both screens off-viewport. */
body.view-history .main{display:flex;flex-direction:column;overflow:hidden;padding:0;}
body.view-history .topnav{margin:12px 12px 0;}
.view[data-view="history"]{flex:1 1 auto;min-height:0;padding:0;position:relative;}
.hist-shell{position:relative;height:100%;overflow:hidden;}
/* NO top padding on the scroller itself — sticky pills must pin flush to the
   scrollport top (the same deliberate arrangement the old view used; see the
   comments at style.css:212 and :723). The 26px inset rides on the topbar. */
.hist-screen{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;padding:0 32px 40px;
  transition:transform .46s cubic-bezier(.65,.02,.28,1);}
.hist-screen-list .topbar{padding-top:26px;}
.hist-screen-list{transform:translateX(0);}
.hist-screen-detail{transform:translateX(100%);padding:0;background:var(--bg);}
.hist-shell.detail-open .hist-screen-list{transform:translateX(-100%);}
.hist-shell.detail-open .hist-screen-detail{transform:translateX(0);}
.hist-shell.no-anim .hist-screen{transition:none;}

.hd-header{background:var(--panel);border-bottom:1px solid var(--line);padding:20px 32px 18px;}
.hd-row1{display:flex;align-items:center;gap:14px;}
.hd-title{margin:0;min-width:0;flex:1;font:700 22px/1.25 var(--sans);letter-spacing:-.02em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.hd-body{padding:0 32px 40px;}
.hd-error{margin-top:24px;color:var(--red-ink);}
.hist-sic{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;
  border-radius:50%;flex:0 0 auto;}
.hist-sic .sic[hidden]{display:none;}
.hist-sic.st-done{background:var(--green-bg);color:var(--green-ink);}
.hist-sic.st-stopped,.hist-sic.st-error{background:var(--red-bg);color:var(--red-ink);}
.hist-sic.st-paused{background:var(--amber-bg);color:var(--amber-ink);}
```

The pills toolbar keeps `position:sticky;top:0` (`style.css:729`) — it now sticks within `.hist-screen-list`'s own scroll, which preserves the existing behavior; delete the now-redundant `.view[data-view="history"]{padding-top:26px}` rule at `style.css:724` (the 26px inset moved onto `.hist-screen-list .topbar` — NOT onto the scroller). Keep `--hist-toolbar-h` mechanics untouched.

- [ ] **Step 6: Run the new + neighboring suites**

Run: `node --test test/ui-history-routing.test.mjs test/ui-history.test.mjs test/ui-history-sticky-header.test.mjs test/ui-history-pills.test.mjs`
Expected: routing + ui-history + pills PASS (the list markup inside `.hist-screen-list` is byte-identical; only its wrapper moved). **`ui-history-sticky-header` breaks by construction and must be rewritten in this task**: its `:40-44` asserts `ruleBody('body.view-history .main')` matches `/padding-top:\s*0/` (the new rule is `overflow:hidden;padding:0` — rewrite the assertion to `/padding(-top)?:\s*0/` or assert `padding:0`), and its `:46-53` asserts `.view[data-view="history"]{…padding-top:26px}` which this task deletes — rewrite it to assert the new invariant: the scroller `.hist-screen` has NO top padding (`/\.hist-screen\{[^}]*padding:\s*0 /`) and the 26px inset lives on `.hist-screen-list .topbar`.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add ui/public/index.html ui/public/app.js ui/public/style.css test/ui-history-routing.test.mjs test/ui-history-sticky-header.test.mjs
git commit -m "feat(ui): hash-routed history detail screen with slide shell"
```

---

### Task 4: Detail header — meta line, branch copy, Resume, Archive, banners

**Files:**
- Modify: `ui/public/app.js` (fill the Task-3 stubs `paintHdHeaderMeta` + `setupHdActions`; extract `resumePipeline` from `setupResumeButton`)
- Modify: `ui/public/style.css` (`.hd-meta`, `.hd-row3`, `.hd-archive`, `.hd-banners`)
- Test: create `test/ui-history-detail.test.mjs`

**Interfaces:**
- Consumes: Task 3's screen + `histDetailState`; existing `splitStamp` does not exist — this task adds `splitDateStamp`; existing `fmtDate`/`fmtDuration`/`fmtUsd`/`estTitle`, `copyBranchToClipboard` (`app.js:3646`), `confirmModal` (`app.js:6015`), `runActionQuery` (`app.js:8616`), `applyHistResumeGate` (`app.js:8796`), `renderCostPauseBanner`, `renderRetainedWork` (`app.js:8635`), `addRecoveryPatchLink` (`app.js:8680`), `setupDiscardWorktreeButton` (`app.js:8701`), `seedResumedLog`, `upsertRun`, `historyLogUrl`.
- Produces:
  - `splitDateStamp(iso) -> { day, clock }` — locale-formatted via `fmtDate`, split at `', '`; `clock` is `''` when the format has no comma.
  - `resumePipeline(p, projectDir, btn, { ignoreCostCap = false }) -> Promise<void>` — the POST /api/resume → upsert → seed-log → land-on-running recipe, extracted verbatim from `setupResumeButton`'s click body (`app.js:8864-8909`); `setupResumeButton` (list, until Task 11) and the detail's Resume + cost-override all call it.
  - Filled `paintHdHeaderMeta(screen, record, data)` and `setupHdActions(screen, record, data)`.
  - Detail root carries `data-pause-reason` so `refreshHistResumeGating` (`app.js:8806`) keeps re-gating: extend that function's selector from `.hist-card` to `.hist-card, .hd` and its button selector to `.hist-resume, .hd-resume`.

- [ ] **Step 1: Write the failing tests**

Create `test/ui-history-detail.test.mjs` (same boot + fixtures as Task 3's suite; export/share the helper via a small local copy — the suites deliberately do not import each other):

```js
test('header meta renders status word · day · clock · duration · cost · +A −R', async () => {
  // DETAIL.results = { summary: { linesAdded: 412, linesRemoved: 188, filesNew: 1, filesChanged: 13, filesDeleted: 0 }, newFiles: [], changedFiles: [], keyThingsToCheck: [] }
  // open detail; then:
  const meta = window.document.querySelector('.hd-meta');
  assert.match(meta.textContent, /Done/);
  assert.match(meta.textContent, /\+412/);
  assert.match(meta.textContent, /−188/);        // U+2212
  assert.match(meta.textContent, /\$153\.21/);
});

test('meta falls back to the live list counts when results are null', async () => {
  // DETAIL.results = null; ROW.survived = true, added: 12, removed: 3 -> "+12 −3"
});

test('branch row copies the feature branch', async () => {
  // click .hd-branch-copy; assert navigator.clipboard.writeText called with ROW.branch
  // (stub window.navigator.clipboard = { writeText: spy } before boot)
});

test('Resume renders for paused AND interrupted, hidden for done/stopped/error', async () => {
  // three boots with DETAIL.state.status + ROW.status varied; assert .hd-resume hidden state
});

test('Resume POSTs /api/resume and lands on running/<newRunId>', async () => {
  // handler for /api/resume -> { ok: true, runId: 'r-9', pipelineId: ROW.id }
  // and for the log URL -> 404 (seedResumedLog tolerates it)
  // click .hd-resume; settle; assert hash is 'running/r-9'
});

test('Archive opens confirmModal with honest copy, DELETEs, navigates back, drops the row', async () => {
  // click .hd-archive; assert #confirm-modal is visible and its message mentions
  // "local branch" and "remote branch"; click #confirm-ok (the real OK button id
  // from index.html's #confirm-modal block); settle;
  // assert DELETE /api/runs/<id>?projectKey=<KEY> was called and hash === 'history'.
  // The row disappears via the archive handler's own model-filter + paintHistory
  // (list<->detail hops don't refetch — Task 3's prevView gate). Still, make the
  // handler STATEFUL (/api/history returns { pipelines: [] } after the DELETE) as
  // a defensive measure for any future reload (e.g. a pipelines-changed force
  // reload) so the assertion can't flake.
});

test('Archive disabled with tooltip when retainedWork present', async () => {
  // ROW.retainedWork = { members: [{ projectKey: KEY, worktreeDir: '/tmp/wt' }] }
  // assert .hd-archive.disabled and title mentions retained work; retained banner visible.
});

test('cost-paused run shows the cost banner and Continue-without-cap resumes with ignoreCostCap', async () => {
  // ROW.status='paused', ROW.pauseReason='cost_cap'; DETAIL.state.status='paused'
  // banner .cb-override click -> confirmModal visible -> OK -> /api/resume body has ignoreCostCap:true
});
```

Read the `#confirm-modal` markup ids from `ui/public/index.html:1097-1113` while writing these (OK/Cancel button ids) and assert against the real ids.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/ui-history-detail.test.mjs`
Expected: FAIL — `.hd-meta` empty, `.hd-resume` always hidden (stubs are no-ops).

- [ ] **Step 3: Implement**

3a. Replace the `paintHdHeaderMeta` stub:

```js
// "8/17/2026, 8:54:42 PM" -> { day, clock } (locale-driven; no comma -> clock '').
function splitDateStamp(iso) {
  const s = fmtDate(iso);
  const i = s.indexOf(', ');
  return i === -1 ? { day: s, clock: '' } : { day: s.slice(0, i), clock: s.slice(i + 2) };
}

function hdDot() {
  const d = document.createElement('span');
  d.className = 'hd-dot';
  d.textContent = '·';
  return d;
}

function paintHdHeaderMeta(screen, record, data) {
  const st = data.state;
  const meta = screen.querySelector('.hd-meta');
  meta.innerHTML = '';
  const { family, word } = histStatusMeta({ status: st.status });
  const w = document.createElement('span');
  w.className = `hd-status-word st-${family}`;
  w.textContent = word;
  meta.appendChild(w);
  const { day, clock } = splitDateStamp(st.startedAt || record.startedAt || record.mtime);
  for (const [cls, text, strong] of [
    ['hd-day', day, false],
    ['hd-clock', clock, false],
    ['hd-dur', typeof st.totalActiveMs === 'number' ? fmtDuration(st.totalActiveMs) : '', true],
    ['hd-cost', typeof st.totalCostUsd === 'number' ? fmtUsd(st.totalCostUsd) : '', true],
  ]) {
    if (!text) continue;
    meta.appendChild(hdDot());
    const el2 = document.createElement('span');
    el2.className = cls + (strong ? ' strong' : '');
    el2.textContent = text;
    if (cls === 'hd-cost') el2.title = estTitle(st.totalCostUsd);
    meta.appendChild(el2);
  }
  // +A −R: persisted results first (done runs), else the live list counts.
  const sums = data.results && data.results.summary;
  const added = sums ? sums.linesAdded : (record.survived ? record.added : null);
  const removed = sums ? sums.linesRemoved : (record.survived ? record.removed : null);
  if (added != null && removed != null) {
    meta.appendChild(hdDot());
    const a = document.createElement('span'); a.className = 'diff-add'; a.textContent = `+${added}`;
    const r = document.createElement('span'); r.className = 'diff-del'; r.textContent = `−${removed}`; // U+2212
    meta.append(a, ' ', r);
  }
  // Branch row.
  const base = screen.querySelector('.hd-base');
  const copyBtn = screen.querySelector('.hd-branch-copy');
  const feature = (st.branch && st.branch.feature) || record.branch || '';
  const source = (st.branch && st.branch.source) || record.sourceBranch || '';
  base.textContent = source ? `${source} →` : '';
  base.hidden = !source;
  copyBtn.hidden = !feature;
  if (feature) {
    screen.querySelector('.hd-branch-name').textContent = feature;
    if (copyBtn.dataset.bound !== '1') {
      copyBtn.dataset.bound = '1';
      copyBtn.addEventListener('click', () => copyBranchToClipboard(copyBtn, feature));
    }
  }
}
```

`copyBranchToClipboard` already does the icon-swap + title feedback (`app.js:3646-3661`), toggling `.copied` on the button for 1200ms. The design + spec §5.2 ALSO show a green "Copied" caption — keep the template's `.hd-copied` span and drive it with pure CSS off that same class window (no extra JS):

```css
.hd-copied{display:none;font:500 11.5px var(--sans);color:var(--green-ink);}
.hd-branch-copy.copied + .hd-copied{display:inline;}
```

(The LIST card keeps its existing icon-swap-only feedback — 997aa083 behavior, unchanged.)

3b. Extract `resumePipeline` and replace the `setupHdActions` stub:

```js
// The POST /api/resume -> upsert -> seed-log -> land-on-running recipe, shared by
// the list card (until Task 11), the detail header, and the cost-override path.
async function resumePipeline(p, projectDir, btn, { ignoreCostCap = false } = {}) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Resuming…';
  try {
    const res = await fetch('/api/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ignoreCostCap ? { pipelineId: p.id, ignoreCostCap: true } : { pipelineId: p.id }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    upsertRun({
      runId: data.runId, title: p.title || p.id, projectDir: p.projectDir || projectDir || '',
      status: 'starting', pipelineId: p.id, local: true,
    });
    const prior = [...runs.values()].find(
      (x) => x.runId !== data.runId && x.pipelineId === p.id && Array.isArray(x.logLines) && x.logLines.length
    );
    await seedResumedLog(data.runId, prior ? prior.logLines : null, prior ? null : historyLogUrl(p.id, p));
    const nr = runs.get(data.runId);
    if (nr) {
      const feat = (prior && prior.branchFeature) || (p.branch && p.branch.feature) || (typeof p.branch === 'string' ? p.branch : null);
      if (feat) { nr.branchFeature = feat; paintRunCard(nr); }
    }
    if (prior) runs.delete(prior.runId);
    hideViewer();
    updateNavCounts();
    location.hash = `running/${data.runId}`;
    renderRunningView();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = label;
    btn.title = `Could not resume: ${err.message}`;
  }
}
```

Rewrite `setupResumeButton`'s click handler (`app.js:8864-8909`) to `btn.addEventListener('click', (e) => { e.stopPropagation(); resumePipeline(p, projectDir, btn); });` and `histCostOverride`'s body (`app.js:8819-8856`) to `const ok = await confirmModal({ ...COST_OVERRIDE_CONFIRM }); if (!ok) return; await resumePipeline(record || { id }, projectDir, btn, { ignoreCostCap: true });` — one recipe, three callers. Note `resumePipeline` reads `p.id`, so `histCostOverride` must pass a record with `id` (it already receives `record`; fall back to `{ id, title: id }`).

Two DELIBERATE behavior changes vs the extracted originals (not regressions — call them out in the commit message body):
1. The branch-label line gains `|| (typeof p.branch === 'string' ? p.branch : null)` — history LIST entries carry `branch` as a string (`artifacts.mjs:1438`), so the old `p.branch && p.branch.feature` read `undefined` for them; this fixes the blank branch label on a list-initiated resume.
2. `histCostOverride` gains the branch-label + `paintRunCard` step it previously lacked (it now rides the shared recipe).

```js
const HD_RESUMABLE = new Set(['paused', 'interrupted']);

function setupHdActions(screen, record, data) {
  const st = data.state;
  const status = String(st.status || '').toLowerCase();
  const root = screen; // .hd

  // Banners (cost pause + retained work) live at the top of the body.
  // retainedWork exists only on LIST rows (rowToState carries none, and the
  // localStorage cache strips it) — so ALSO derive retention from the
  // authoritative state.branch commitFailed stamp; the server's 409 guard is the
  // real protection, this keeps the banner + disabled Archive honest meanwhile.
  const brJson = st.branch && typeof st.branch === 'object' ? st.branch : {};
  if (!record.retainedWork && brJson.commitFailed && brJson.worktreeDir) {
    record.retainedWork = {
      reason: brJson.commitFailed.code || 'unknown',
      members: [{ projectKey: record.projectKey, worktreeDir: brJson.worktreeDir,
                  branch: brJson.feature || null, step: brJson.commitFailed.step || null,
                  message: brJson.commitFailed.message || '' }],
    };
  }
  const pauseReason = typeof record.pauseReason === 'string' ? record.pauseReason : '';
  if (pauseReason) root.dataset.pauseReason = pauseReason;
  if (pauseReason.startsWith('cost_')) {
    const banner = renderCostPauseBanner(
      { pauseReason, pipelineId: record.id, totalCostUsd: st.totalCostUsd },
      { budget: budgetState.budget || {}, fmt: { usd: fmtUsd, usd4: fmtUsd4, duration: fmtDuration, estTitle } });
    const settingsBtn = banner.querySelector('.cb-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', () => { location.hash = 'settings'; });
    const overrideBtn = banner.querySelector('.cb-override');
    if (overrideBtn) overrideBtn.addEventListener('click', () => { histCostOverride(record.projectDir || null, record.id, record, overrideBtn); });
    screen.querySelector('.hd-banners').prepend(banner);
  }
  renderRetainedWork(screen, record);
  setupDiscardWorktreeButton(screen, record.projectDir || null, record);
  addRecoveryPatchLink(screen, record.projectDir || null, record, data.artifacts);

  // Resume: paused + interrupted only (spec D3).
  const resumeBtn = screen.querySelector('.hd-resume');
  if (HD_RESUMABLE.has(status)) {
    resumeBtn.hidden = false;
    applyHistResumeGate(resumeBtn, pauseReason, budgetState.budget);
    resumeBtn.addEventListener('click', () => resumePipeline(record, record.projectDir || null, resumeBtn));
  }

  // Archive: honest copy (spec D2), confirmModal (not window.confirm).
  // Deletability is judged on the AUTHORITATIVE detail status (a deep-link's
  // minimal record has none), plus the record's live flag when present.
  const archiveBtn = screen.querySelector('.hd-archive');
  if (isDeletableEntry({ ...record, status: st.status })) {
    archiveBtn.hidden = false;
    if (record.retainedWork) {
      archiveBtn.disabled = true;
      archiveBtn.title = 'Recover or discard the retained uncommitted work before archiving.';
    } else {
      archiveBtn.addEventListener('click', async () => {
        const ok = await confirmModal({
          title: 'Archive this pipeline?',
          message: `${record.title || record.id}\n\nIt moves out of History. The local branch, worktree, and run artifacts (logs, results, diff) are removed. The remote branch and any open PR stay untouched. Cost and outcome are kept for Statistics. This cannot be undone.`,
          confirmLabel: 'Archive',
        });
        if (!ok) return;
        archiveBtn.disabled = true;
        archiveBtn.textContent = 'Archiving…';
        try {
          const qs = runActionQuery(record.projectDir || null, record);
          const res = await fetch(`/api/runs/${encodeURIComponent(record.id)}?${qs.toString()}`, { method: 'DELETE' });
          const dd = await safeJson(res);
          if (!res.ok) throw new Error((dd && dd.error) || `HTTP ${res.status}`);
          state.historyAll = state.historyAll.filter((r) => !(r && r.id === record.id && r.projectKey === record.projectKey));
          writeHistoryCache(state.historyAll, state.ghAvailable);
          paintHistory();
          location.hash = 'history';
        } catch (err) {
          archiveBtn.disabled = false;
          archiveBtn.textContent = 'Archive';
          const errEl = screen.querySelector('.hd-error');   // spec §5.2: inline error
          if (errEl) { errEl.hidden = false; errEl.textContent = `Could not archive: ${err.message}`; }
        }
      });
    }
  }
}
```

3c. Extend `refreshHistResumeGating` (`app.js:8806-8814`) to also cover the detail screen:

```js
function refreshHistResumeGating() {
  const roots = [];
  if (el.history) roots.push(...el.history.querySelectorAll('.hist-card'));
  if (el.histDetail) roots.push(...el.histDetail.querySelectorAll('.hd'));
  for (const root of roots) {
    const btn = root.querySelector('.hist-resume, .hd-resume');
    if (!btn || btn.hidden) continue;
    applyHistResumeGate(btn, root.dataset.pauseReason || '', budgetState.budget);
  }
}
```

3d. Deep-link record upgrade — a deep-linked detail starts from a minimal `{id, projectKey}` record (no branch, counts, pauseReason, retainedWork, PR eligibility). When the list data lands, upgrade the open detail WITHOUT re-running `setupHdActions` (that would double-bind Resume/Archive listeners). Add:

```js
// Re-run only the IDEMPOTENT painters after the open detail's real list row
// arrives (deep-link case). Never re-runs setupHdActions (listener double-bind).
function refreshHdFromRow() {
  if (!histDetailState || !histDetailState.screen || !histDetailState.data) return;
  const row = (state.historyAll || []).find(
    (r) => r && r.id === histDetailState.id && r.projectKey === histDetailState.key);
  if (!row || row === histDetailState.record) return;
  histDetailState.record = row;
  const { screen, data } = histDetailState;
  paintHdHeaderMeta(screen, row, data);
  paintHdPr(screen, row, data);                      // Task 10 (stub-safe before it)
  if (typeof row.pauseReason === 'string' && row.pauseReason) screen.dataset.pauseReason = row.pauseReason;
  refreshHistResumeGating();
  const banner = screen.querySelector('.retained-banner');
  if (row.retainedWork && banner && banner.hidden) {
    // FIRST reveal only (setupHdActions' state-derived retention may have
    // already bound these; re-running setupDiscardWorktreeButton would
    // double-bind its click handler).
    renderRetainedWork(screen, row);
    setupDiscardWorktreeButton(screen, row.projectDir || null, row);
    addRecoveryPatchLink(screen, row.projectDir || null, row, data.artifacts);
    const archiveBtn = screen.querySelector('.hd-archive');
    if (archiveBtn) {
      archiveBtn.disabled = true;
      archiveBtn.title = 'Recover or discard the retained uncommitted work before archiving.';
    }
  }
}
```

and call `refreshHdFromRow();` at the END of `paintHistory()` (`app.js:8406-8416`) — that single site covers the cache paint, the network repaint, and filter/archive repaints. `paintHdPr` is a Task-10 function; until Task 10 lands, add it to the Task-3 stub block (`function paintHdPr(_s, _r, _d) {}`) so this compiles from Task 4 on. Extend the routing suite: deep-link boot → list arrives → branch row + meta counts appear.

3e. CSS (append):

```css
.hd-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:12px;
  font:400 12.5px var(--mono);color:var(--ink-3);}
.hd-meta .strong{font-weight:700;color:var(--ink);}
.hd-dot{font-weight:700;color:var(--ink);}
.hd-status-word{font:600 12.5px var(--sans);}
/* shared with the Task-11 list card's .hist-status-word (same st-* families) */
.hd-status-word.st-done,.hist-status-word.st-done{color:var(--green-ink);}
.hd-status-word.st-stopped,.hd-status-word.st-error,
.hist-status-word.st-stopped,.hist-status-word.st-error{color:var(--red-ink);}
.hd-status-word.st-paused,.hist-status-word.st-paused{color:var(--amber-ink);}
.hd-row3{display:flex;align-items:center;gap:8px;margin-top:14px;min-width:0;}
.hd-base{color:var(--ink-3);font-size:12px;white-space:nowrap;}
.hd-branch-copy{display:flex;align-items:center;gap:9px;min-width:0;padding:8px 12px;
  border:1px solid var(--line);border-radius:9px;background:var(--field);
  font:700 12px var(--mono);color:var(--ink);cursor:pointer;}
.hd-branch-copy:hover{border-color:var(--ink-3);background:var(--panel);}
.hd-branch-name{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.hd-branch-copy .ico-check{display:none;}
.hd-branch-copy.copied .ico-copy{display:none;}
.hd-branch-copy.copied .ico-check{display:inline;color:var(--green-ink);}
.hd-spacer{flex:1 1 24px;}
.hd-resume{border-radius:999px;}
.hd-archive{display:flex;align-items:center;gap:8px;padding:8px 15px;border:1.5px solid var(--red-bg);
  border-radius:999px;background:var(--panel);font:600 12.5px var(--sans);color:var(--red-ink);cursor:pointer;}
.hd-archive:hover{background:var(--red-bg);border-color:var(--red);}
.hd-archive[disabled]{opacity:.55;cursor:not-allowed;}
.hd-banners:empty{display:none;}
.hd-banners{margin-top:18px;display:flex;flex-direction:column;gap:12px;}
```

(`copyBranchToClipboard` toggles `.copied` on the button — verify the class name at `app.js:3646-3661` and match it; the list card's CSS at `style.css:816-825` is the reference.)

- [ ] **Step 4: Run the suites**

Run: `node --test test/ui-history-detail.test.mjs test/ui-history-routing.test.mjs test/ui-history.test.mjs`
Expected: PASS. The list's Resume/cost-override ride the extracted recipe — also run `node --test test/ui-history-pr.test.mjs test/ui-history-delete.test.mjs test/ui-pause-resume.test.mjs test/ui-cost-paused.test.mjs` (the last two exercise `setupResumeButton`/`histCostOverride` directly).

- [ ] **Step 5: Full suite + commit**

Run: `npm test` → green.

```bash
git add ui/public/app.js ui/public/style.css test/ui-history-detail.test.mjs
git commit -m "feat(ui): history detail header with resume, archive, and banners"
```

---

### Task 5: Section tabs machinery

**Files:**
- Modify: `ui/public/app.js` (fill `initHdTabs`; add the tab registry + lazy section builder stubs)
- Modify: `ui/public/style.css` (`.hd-tabs`, `.hd-tab`, `.hd-sec`)
- Test: extend `test/ui-history-detail.test.mjs`

**Interfaces:**
- Consumes: Task 3's screen skeleton (`.hd-tabs`, `.hd-sections`), the detail payload.
- Produces:
  - `initHdTabs(screen, record, data)` — builds the pill row + one `.hd-sec[data-sec]` host per visible tab; activates the default tab.
  - Tab registry `HD_TABS: Array<{ key, label, badge(data)->string|null, visible(data)->boolean, build(sec, record, data)->void }>` — `build` runs once per visit on first activation (`sec.dataset.loaded`); Tasks 6-9 fill the four real builders, defined here as stubs:
    `buildHdDiff(sec, record, data)`, `buildHdOverview(sec, record, data)`, `buildHdAgents(sec, record, data)`, `buildHdClarify(sec, record, data)`, `buildHdLogs(sec, record, data)`.
  - Default rule (spec §5.4): `data.results ? 'diff' : 'overview'`.
  - Visibility: clarify hidden when no Q&A; logs hidden when no `live-log` artifact; diff/overview/agents always present.

- [ ] **Step 1: Write the failing tests** (extend `test/ui-history-detail.test.mjs`)

```js
test('tabs render with badges; default = Diff when results exist, else Overview', async () => {
  // With DETAIL.results set (13+1 files) and 2 subAgents and clarify {1 q}:
  //   assert 5 .hd-tab buttons, Diff badge '14', Agents badge '2', Clarify badge '1'
  //   assert .hd-tab[data-sec="diff"].active and .hd-sec[data-sec="diff"] visible.
  // With DETAIL.results = null and clarify empty + no live-log artifact:
  //   assert Clarify + Logs tabs are absent and Overview is active.
});

test('clicking a tab switches the visible section and lazy-builds once', async () => {
  // click Agents tab -> .hd-sec[data-sec="agents"] visible, others hidden;
  // click Diff tab, click Agents again -> the agents section DOM node is the SAME element
  // (dataset.loaded caching; compare with a stamp set on first build).
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/ui-history-detail.test.mjs` → new tests FAIL (no tabs rendered).

- [ ] **Step 3: Implement**

Replace the `initHdTabs` stub:

```js
const HD_TAB_ICONS = {
  diff: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 3h8l4 4v14H6z" stroke-linejoin="round"/><path d="M14 3v4h4" stroke-linejoin="round"/></svg>',
  overview: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8"/><path d="M12 8h.01M11 12h1v4h1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  agents: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="12" r="2.4"/><path d="M8 6h5a3 3 0 0 1 3 3v0M8 18h5a3 3 0 0 0 3-3v0" stroke-linecap="round"/></svg>',
  clarify: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.9.4-1.5 1-1.5 2.2M12 17h.01" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  logs: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 6h16M4 12h16M4 18h10" stroke-linecap="round"/></svg>',
};

function hdClarifyCount(data) {
  const q = (data.clarify && Array.isArray(data.clarify.questions)) ? data.clarify.questions.length : 0;
  const stepQ = Array.isArray(data.stepQuestions)
    ? data.stepQuestions.reduce((n, r) => n + ((r && r.questions) || []).length, 0) : 0;
  return q + stepQ;
}

const HD_TABS = [
  // File count = filesNew + filesChanged ONLY: deleted files carry status 'D'
  // INSIDE changedFiles (results.mjs:9,29,37 — NEW_STATUS is {A,C}), so adding
  // filesDeleted would double-count every deletion vs the rendered file list.
  { key: 'diff', label: 'Diff',
    badge: (d) => d.results && d.results.summary
      ? String((d.results.summary.filesNew || 0) + (d.results.summary.filesChanged || 0)) : null,
    visible: () => true, build: (...a) => buildHdDiff(...a) },
  { key: 'overview', label: 'Overview', badge: () => null, visible: () => true, build: (...a) => buildHdOverview(...a) },
  { key: 'agents', label: 'Agents',
    badge: (d) => (Array.isArray(d.state.subAgents) && d.state.subAgents.length) ? String(d.state.subAgents.length) : null,
    visible: () => true, build: (...a) => buildHdAgents(...a) },
  { key: 'clarify', label: 'Clarify',
    badge: (d) => String(hdClarifyCount(d)),
    visible: (d) => hdClarifyCount(d) > 0, build: (...a) => buildHdClarify(...a) },
  { key: 'logs', label: 'Logs', badge: () => null,
    visible: (d) => Array.isArray(d.artifacts) && d.artifacts.some((a) => a && a.kind === 'live-log'),
    build: (...a) => buildHdLogs(...a) },
];

function initHdTabs(screen, record, data) {
  const bar = screen.querySelector('.hd-tabs');
  const secs = screen.querySelector('.hd-sections');
  bar.innerHTML = '';
  secs.innerHTML = '';
  const tabs = HD_TABS.filter((t) => t.visible(data));
  const secEls = new Map();
  for (const t of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hd-tab';
    btn.dataset.sec = t.key;
    btn.setAttribute('role', 'tab');
    btn.innerHTML = HD_TAB_ICONS[t.key];
    btn.appendChild(document.createTextNode(' ' + t.label));
    const badge = t.badge(data);
    if (badge != null) {
      const b = document.createElement('span');
      b.className = 'hd-tab-badge';
      b.textContent = badge;
      btn.appendChild(b);
    }
    bar.appendChild(btn);
    const sec = document.createElement('div');
    sec.className = 'hd-sec';
    sec.dataset.sec = t.key;
    sec.hidden = true;
    secs.appendChild(sec);
    secEls.set(t.key, { tab: t, btn, sec });
    btn.addEventListener('click', () => activate(t.key));
  }
  function activate(key) {
    for (const [k, { tab, btn, sec }] of secEls) {
      const on = k === key;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      sec.hidden = !on;
      if (on && sec.dataset.loaded !== '1') {
        sec.dataset.loaded = '1';
        tab.build(sec, record, data);
      }
    }
  }
  activate(data.results ? 'diff' : 'overview');
}

// --- tab body builders: stubs filled by Tasks 6-9 ---------------------------
function buildHdDiff(_sec, _record, _data) {}
function buildHdOverview(_sec, _record, _data) {}
function buildHdAgents(_sec, _record, _data) {}
function buildHdClarify(_sec, _record, _data) {}
function buildHdLogs(_sec, _record, _data) {}
```

CSS:

```css
.hd-tabs{position:sticky;top:0;z-index:5;display:flex;align-items:center;flex-wrap:wrap;gap:8px;
  padding:18px 0 14px;background:linear-gradient(var(--bg) 78%, rgba(241,241,239,0));}
.hd-tab{display:flex;align-items:center;gap:9px;padding:10px 17px;border:1.5px solid var(--line);
  border-radius:999px;background:var(--panel);font:600 13.5px var(--sans);color:var(--ink-2);cursor:pointer;}
.hd-tab.active{background:var(--ink);color:#fff;border-color:var(--ink);}
.hd-tab-badge{padding:2px 8px;border-radius:999px;background:var(--field);color:var(--ink-3);
  font:600 10.5px var(--mono);}
.hd-tab.active .hd-tab-badge{background:var(--blue-bg);color:var(--blue-ink);}
.hd-sec{margin-top:4px;}
```

- [ ] **Step 4: Run + commit**

Run: `node --test test/ui-history-detail.test.mjs test/ui-history-routing.test.mjs` → PASS; `npm test` → green.

```bash
git add ui/public/app.js ui/public/style.css test/ui-history-detail.test.mjs
git commit -m "feat(ui): history detail section tabs with lazy bodies"
```

---

### Task 6: Diff tab — file list + patch viewer

**Files:**
- Modify: `ui/public/app.js` (fill `buildHdDiff`; add `historyDiffUrl`; add the `diff-view.mjs` import to the top-of-file import block where `projectLogRecord` etc. are imported)
- Modify: `ui/public/style.css` (`.hd-diff*`)
- Test: extend `test/ui-history-detail.test.mjs`

**Interfaces:**
- Consumes: Task 1's `splitPatchSections`/`parseFileSection`/`patchIndex`/`sectionKey`; Task 2's routes; `results.newFiles`/`changedFiles`/`summary` (+ workspace `results.perProject`); `historyLogUrl` as the URL-builder pattern.
- Produces: `historyDiffUrl(id, record) -> string` (mirrors `historyLogUrl`, `app.js:9082-9092`, with `/diff` instead of `/log`).

- [ ] **Step 1: Write the failing tests** (extend `test/ui-history-detail.test.mjs`)

```js
const PATCH = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -1,2 +1,2 @@
 keep
-old
+new
`;
// DETAIL.results = { summary: { filesNew: 0, filesChanged: 1, filesDeleted: 0, linesAdded: 1, linesRemoved: 1, blockingIssues: 0, nitpicks: 0 },
//                    newFiles: [], changedFiles: [{ path: 'src/a.js', status: 'M', added: 1, removed: 1 }], keyThingsToCheck: [], nitpicks: [] }
// handler: /api/history/<KEY>/<id>/diff -> { ok: true, status: 200, text: async () => PATCH }

test('Diff tab lists files and renders the selected file\'s hunks', async () => {
  // open detail (Diff is default because results exist); settle
  const rows = window.document.querySelectorAll('.hd-diff-file');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /src\/a\.js/);
  const pane = window.document.querySelector('.hd-diff-pane');
  assert.match(pane.textContent, /@@ -1,2 \+1,2 @@/);
  assert.ok(pane.querySelector('.hd-dl-add'));   // "+new"
  assert.ok(pane.querySelector('.hd-dl-del'));   // "-old"
});

test('file in results but missing from the patch shows the no-textual-diff note', async () => {
  // changedFiles gains { path: 'assets/logo.png', status: 'M', binary: true }; click its row
  // -> pane shows '(no textual diff for this file)'
});

test('non-done run (results null) shows the empty state and never fetches /diff', async () => {
  // DETAIL.results = null, DETAIL.state.status = 'stopped' -> default tab Overview;
  // click the Diff tab -> 'No diff captured for this run.' + the sub-line;
  // assert no call in `calls` contains '/diff'
});

test('diff fetch failing (404) degrades to file list + per-file note', async () => {
  // results present but /diff handler -> 404: rows render; pane note on select.
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/ui-history-detail.test.mjs` → new tests FAIL.

- [ ] **Step 3: Implement**

3a. Import — the import block sits at `app.js:47-78` (NOT line 1; the file opens with a comment + `$`/`$$` + `state`). Insert after line 58 (`./log-filter.mjs`):

```js
import { splitPatchSections, parseFileSection, patchIndex, sectionKey } from './diff-view.mjs';
```

3b. URL builder (next to `historyLogUrl`, `app.js:9092`):

```js
function historyDiffUrl(id, record) {
  if (record && record.target === 'workspace' && typeof record.projectKey === 'string') {
    const wksId = record.projectKey.replace(/^workspaces\//, '');
    return `/api/workspaces/${encodeURIComponent(wksId)}/runs/${encodeURIComponent(id)}/diff`;
  }
  const key = record && record.projectKey ? record.projectKey : '';
  return `/api/history/${encodeURIComponent(key)}/${encodeURIComponent(id)}/diff`;
}
```

3c. Replace the `buildHdDiff` stub:

```js
// File rows for the Diff tab. Single-project: results.newFiles + changedFiles.
// Workspace: one group per results.perProject[<key>], with the project key carried
// so patch sections resolve per project.
function hdDiffFileRows(results) {
  const rows = [];
  const push = (project, r) => {
    for (const f of r.newFiles || []) rows.push({ project, f, isNew: true });
    for (const f of r.changedFiles || []) rows.push({ project, f, isNew: false });
  };
  if (results.perProject && typeof results.perProject === 'object') {
    for (const [key, r] of Object.entries(results.perProject)) push(key, r || {});
  } else {
    push(null, results);
  }
  return rows;
}

function buildHdDiff(sec, record, data) {
  sec.innerHTML = '';
  const results = data.results;
  if (!results) {
    const empty = document.createElement('div');
    empty.className = 'hd-diff-empty';
    const line = document.createElement('div');
    line.textContent = 'No diff captured for this run.';
    empty.appendChild(line);
    const status = String(data.state.status || '').toLowerCase();
    if (status !== 'done') {
      const sub = document.createElement('div');
      sub.className = 'hint';
      sub.textContent = 'Diffs are captured when a run completes.';
      empty.appendChild(sub);
    }
    sec.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'hd-diff';
  const listCard = document.createElement('div');
  listCard.className = 'hd-diff-list';
  const pane = document.createElement('div');
  pane.className = 'hd-diff-pane';
  grid.append(listCard, pane);
  sec.appendChild(grid);

  const sums = results.summary || {};
  const head = document.createElement('div');
  head.className = 'hd-diff-list-head';
  // Not + filesDeleted: 'D' rows already count in filesChanged (see HD_TABS note).
  const nFiles = (sums.filesNew || 0) + (sums.filesChanged || 0);
  head.innerHTML = `<b>${nFiles} file${nFiles === 1 ? '' : 's'} changed</b>` +
    `<span class="mono"><span class="diff-add">+${sums.linesAdded || 0}</span> ` +
    `<span class="diff-del">−${sums.linesRemoved || 0}</span></span>`; // U+2212
  listCard.appendChild(head);

  const rowsHost = document.createElement('div');
  rowsHost.className = 'hd-diff-rows';
  listCard.appendChild(rowsHost);

  const rows = hdDiffFileRows(results);
  const state2 = { sections: null, index: null, fetched: false, error: null };

  async function ensurePatch() {
    if (state2.fetched) return;
    state2.fetched = true;
    try {
      const res = await fetch(historyDiffUrl(record.id, record));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      state2.sections = splitPatchSections(text);
      state2.index = patchIndex(state2.sections);
    } catch (e) {
      state2.error = e.message;
    }
  }

  async function select(rowEl, entry) {
    for (const r of rowsHost.querySelectorAll('.hd-diff-file')) r.classList.toggle('active', r === rowEl);
    pane.innerHTML = '';
    const ph = document.createElement('div');
    ph.className = 'hd-diff-pane-head mono';
    const counts = entry.f.binary ? 'binary'
      : (entry.f.added != null ? `+${entry.f.added} −${entry.f.removed}` : ''); // U+2212
    ph.innerHTML = `<span class="hd-diff-path">${escapeHtml(entry.f.path)}</span><span>${escapeHtml(counts)}</span>`;
    pane.appendChild(ph);
    await ensurePatch();
    const body = document.createElement('div');
    body.className = 'hd-diff-body mono';
    const section = state2.index && state2.index.get(sectionKey(entry.project, entry.f.path));
    if (!section) {
      body.classList.add('hint'); // keep .hd-diff-body's padding/typography
      body.textContent = state2.error
        ? `Could not load the patch: ${state2.error}`
        : '(no textual diff for this file)';
      pane.appendChild(body);
      return;
    }
    const parsed = parseFileSection(section.raw);
    if (parsed.binary || !parsed.hunks.length) {
      body.classList.add('hint');
      body.textContent = '(no textual diff for this file)';
      pane.appendChild(body);
      return;
    }
    for (const hunk of parsed.hunks) {
      const hh = document.createElement('div');
      hh.className = 'hd-dl hd-dl-hunk';
      hh.textContent = hunk.header;
      body.appendChild(hh);
      for (const line of hunk.lines) {
        const dl = document.createElement('div');
        dl.className = `hd-dl hd-dl-${line.kind}`;
        dl.textContent = (line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ') + line.text; // U+2212 for del
        body.appendChild(dl);
      }
    }
    if (parsed.truncated) {
      const t = document.createElement('div');
      t.className = 'hint';
      t.textContent = '(large file — diff truncated at 500 KB)';
      body.appendChild(t);
    }
    pane.appendChild(body);
  }

  let lastProject = null;
  let first = null;
  for (const entry of rows) {
    if (entry.project && entry.project !== lastProject) {
      lastProject = entry.project;
      const gh = document.createElement('div');
      gh.className = 'hd-diff-proj mono';
      gh.textContent = entry.project;
      rowsHost.appendChild(gh);
    }
    const rowEl = document.createElement('div');
    rowEl.className = 'hd-diff-file' + (entry.f.status === 'D' ? ' deleted' : '') + (entry.isNew ? ' new' : '');
    rowEl.setAttribute('role', 'button');
    rowEl.tabIndex = 0;
    const path = document.createElement('span');
    path.className = 'hd-diff-path mono';
    path.textContent = entry.f.path;
    path.title = entry.f.from ? `${entry.f.from} → ${entry.f.path}` : entry.f.path;
    const counts = document.createElement('span');
    counts.className = 'mono hd-diff-counts';
    counts.innerHTML = entry.f.binary ? '<span class="hint">binary</span>'
      : (entry.f.added != null
        ? `<span class="diff-add">+${entry.f.added}</span> <span class="diff-del">−${entry.f.removed}</span>` // U+2212
        : '');
    rowEl.append(path, counts);
    const pick = () => select(rowEl, entry);
    rowEl.addEventListener('click', pick);
    rowEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    rowsHost.appendChild(rowEl);
    if (!first) { first = { rowEl, entry }; }
  }
  if (first) select(first.rowEl, first.entry);
  else {
    const none = document.createElement('div');
    none.className = 'hint';
    none.style.padding = '18px';
    none.textContent = '(no files changed)';
    pane.appendChild(none); // keep .hd-diff-pane's card styling intact
  }
}
```

3d. CSS:

```css
.hd-diff{display:grid;grid-template-columns:minmax(280px,340px) 1fr;gap:18px;align-items:start;}
@media (max-width:900px){.hd-diff{grid-template-columns:1fr;}}
.hd-diff-list,.hd-diff-pane{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-card);overflow:hidden;}
.hd-diff-list-head,.hd-diff-pane-head{display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:15px 18px;border-bottom:1px solid var(--line);font-size:12.5px;}
.hd-diff-rows{padding:6px;max-height:520px;overflow-y:auto;}
.hd-diff-proj{padding:8px 12px 2px;color:var(--ink-3);font-size:11px;}
.hd-diff-file{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;cursor:pointer;}
.hd-diff-file:hover{background:var(--field);}
.hd-diff-file.active{background:var(--field);}
.hd-diff-file.deleted .hd-diff-path{opacity:.55;text-decoration:line-through;}
.hd-diff-file.new .hd-diff-path{color:var(--green-ink);}
.hd-diff-file .hd-diff-path{flex:1;min-width:0;font-size:12px;color:var(--ink-2);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left;}
.hd-diff-counts{font-size:11.5px;white-space:nowrap;}
.hd-diff-body{padding:12px 0;font:400 12px/1.85 var(--mono);color:var(--ink-2);overflow-x:auto;}
.hd-dl{padding:0 18px;white-space:pre;}
.hd-dl-hunk{color:var(--ink-3);background:var(--field);}
.hd-dl-add{background:var(--green-bg);}
.hd-dl-del{background:var(--red-bg);}
.hd-diff-empty{margin-top:24px;padding:40px;text-align:center;color:var(--ink-2);
  background:var(--panel);border:1px solid var(--line);border-radius:var(--r-card);}
```

- [ ] **Step 4: Run + commit**

Run: `node --test test/ui-history-detail.test.mjs test/diff-view.test.mjs` → PASS; `npm test` → green.

```bash
git add ui/public/app.js ui/public/style.css test/ui-history-detail.test.mjs
git commit -m "feat(ui): history diff tab with per-file patch viewer"
```

---

### Task 7: Overview tab

**Files:**
- Modify: `ui/public/app.js` (fill `buildHdOverview`)
- Modify: `ui/public/style.css` (`.hd-ov*`)
- Test: extend `test/ui-history-detail.test.mjs`

**Interfaces:**
- Consumes: `data.results` (`summary`, `keyThingsToCheck`), `data.state` (`totalActiveMs`, `totalCostUsd`, `steps`, `subAgents`, `prompt`, `branch`), `record` (`retainedWork`, `projectName`, `sourceBranch`), `issueList` (`app.js:9137`), `fmtDuration`/`fmtUsd`/`estTitle`.
- Produces: nothing new for later tasks. The LLM overview UI (`loadOverview`/`paintOverview`/`buildOverviewPanel`) is NOT called from here — spec D6; the functions themselves are deleted in Task 11's sweep.

- [ ] **Step 1: Write the failing tests**

```js
test('Overview: clean verdict + stat cards + task card', async () => {
  // results with keyThingsToCheck: [] -> click Overview tab:
  //   .hd-ov-verdict has class 'clean' and text matches /Clean — no blocking issues flagged\./
  //   stat cards: .hd-ov-card-duration value matches fmtDuration, subtitle /\d+ steps · \d+ cycles?/
  //   .hd-ov-card-cost matches /\$153\.21/ ; .hd-ov-card-worktree matches /released|retained/
  //   .hd-ov-task text includes DETAIL.state.prompt and chips include 'feat/log-ux'
  //   assert NO '.results-overview-btn' exists anywhere in the section (LLM overview UI gone)
});

test('Overview: findings render when keyThingsToCheck is non-empty', async () => {
  // keyThingsToCheck: [{ id:'c1', severity:'major', title:'Check X', detail:'…', location:'a.js:1' }]
  // -> .hd-ov-verdict has class 'warn', text /1 thing to check/, and an .issues list renders beneath.
});

test('Overview: non-done run shows the status verdict line', async () => {
  // results null + status 'stopped' -> verdict text /No review results captured — the run did not complete\./
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** — replace the `buildHdOverview` stub:

```js
function hdStatCard(kind, label, value, sub) {
  const card = document.createElement('div');
  card.className = `hd-ov-card hd-ov-card-${kind}`;
  const l = document.createElement('div'); l.className = 'hd-ov-label'; l.textContent = label;
  const v = document.createElement('div'); v.className = 'hd-ov-value mono'; v.textContent = value;
  card.append(l, v);
  if (sub) { const s = document.createElement('div'); s.className = 'hd-ov-sub mono'; s.textContent = sub; card.appendChild(s); }
  return card;
}

function buildHdOverview(sec, record, data) {
  sec.innerHTML = '';
  const st = data.state;
  const results = data.results;
  const wrap = document.createElement('div');
  wrap.className = 'hd-ov';
  sec.appendChild(wrap);

  // 1) Verdict banner.
  const verdict = document.createElement('div');
  verdict.className = 'hd-ov-verdict';
  // Workspace results have NO top-level keyThingsToCheck — findings live under
  // perProject[<key>].keyThingsToCheck (the rollup summary only counts them).
  const hdChecks = (r) => r.perProject
    ? Object.entries(r.perProject).flatMap(([k, pr2]) =>
        ((pr2 && pr2.keyThingsToCheck) || []).map((c) => ({ ...c, location: c.location ? `${k}: ${c.location}` : k })))
    : (r.keyThingsToCheck || []);
  if (results) {
    const checks = hdChecks(results);
    if (!checks.length) {
      verdict.classList.add('clean');
      verdict.innerHTML = '<span class="hd-ov-chip clean">Clean</span>';
      verdict.appendChild(document.createTextNode(' Clean — no blocking issues flagged.'));
    } else {
      verdict.classList.add('warn');
      verdict.innerHTML = `<span class="hd-ov-chip warn">${checks.length}</span>`;
      verdict.appendChild(document.createTextNode(
        ` ${checks.length} thing${checks.length === 1 ? '' : 's'} to check`));
    }
  } else {
    const { family, word } = histStatusMeta({ status: st.status });
    verdict.classList.add('none');
    verdict.innerHTML = `<span class="hd-ov-chip st-${family}">${escapeHtml(word)}</span>`;
    verdict.appendChild(document.createTextNode(' No review results captured — the run did not complete.'));
  }
  wrap.appendChild(verdict);
  if (results) {
    const checks = hdChecks(results);
    if (checks.length) wrap.appendChild(issueList(checks.map((c) => ({ ...c, origin: 'review' }))));
  }

  // 2) Stat cards.
  const grid = document.createElement('div');
  grid.className = 'hd-ov-grid';
  const steps = Array.isArray(st.steps) ? st.steps : [];
  const maxCycle = steps.reduce((m, s) => Math.max(m, Number(s && s.cycle) || 0), 0) || 1;
  grid.appendChild(hdStatCard('duration', 'DURATION',
    typeof st.totalActiveMs === 'number' ? fmtDuration(st.totalActiveMs) : '—',
    `${steps.length} step${steps.length === 1 ? '' : 's'} · ${maxCycle} cycle${maxCycle === 1 ? '' : 's'}`));
  const costCard = hdStatCard('cost', 'COST',
    typeof st.totalCostUsd === 'number' ? fmtUsd(st.totalCostUsd) : '—',
    `across ${steps.length} step${steps.length === 1 ? '' : 's'}`);
  if (typeof st.totalCostUsd === 'number') costCard.querySelector('.hd-ov-value').title = estTitle(st.totalCostUsd);
  grid.appendChild(costCard);
  const wt = st.branch && typeof st.branch === 'object' ? st.branch : {};
  // worktreeRemoved is only ever WRITTEN as true (never false) — on a paused run
  // it is simply absent, so test !== true, not === false.
  const pausedNow = PAUSED_STATUSES.includes(String(st.status || '').toLowerCase());
  const retained = !!record.retainedWork || (pausedNow && !!wt.worktreeDir && wt.worktreeRemoved !== true);
  grid.appendChild(hdStatCard('worktree', 'WORKTREE',
    retained ? 'retained' : 'released',
    wt.worktreeDir || ''));
  wrap.appendChild(grid);

  // 3) Task card.
  const task = document.createElement('div');
  task.className = 'hd-ov-task';
  const th = document.createElement('div'); th.className = 'hd-ov-task-h'; th.textContent = 'Task';
  task.appendChild(th);
  const prompt = String(st.prompt || '').trim();
  const p = document.createElement('p');
  const LIMIT = 600;
  if (prompt.length > LIMIT) {
    p.textContent = prompt.slice(0, LIMIT) + '…';
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'hd-ov-more';
    more.textContent = 'Show more';
    more.addEventListener('click', () => { p.textContent = prompt; more.remove(); });
    task.append(p, more);
  } else {
    p.textContent = prompt || '(no prompt recorded)';
    task.appendChild(p);
  }
  const chips = document.createElement('div');
  chips.className = 'hd-ov-chips';
  const subCount = Array.isArray(st.subAgents) ? st.subAgents.length : 0;
  for (const text of [
    record.projectName || record.projectKey || '',
    (st.branch && st.branch.source) || record.sourceBranch || '',
    subCount ? `${subCount} sub-agent${subCount === 1 ? '' : 's'}` : '',
  ]) {
    if (!text) continue;
    const c = document.createElement('span');
    c.className = 'hd-ov-tag mono';
    c.textContent = text;
    chips.appendChild(c);
  }
  task.appendChild(chips);
  wrap.appendChild(task);
}
```

CSS:

```css
.hd-ov{display:flex;flex-direction:column;gap:18px;}
.hd-ov-verdict{display:flex;align-items:center;gap:12px;padding:16px 20px;background:var(--panel);
  border:1px solid var(--line);border-radius:var(--r-card);font:500 13.5px var(--sans);}
.hd-ov-verdict.clean{color:var(--green-ink);}
.hd-ov-verdict.warn{color:var(--amber-ink);}
.hd-ov-chip{padding:5px 12px;border-radius:999px;font:600 11.5px var(--sans);}
.hd-ov-chip.clean{background:var(--green-bg);color:var(--green-ink);}
.hd-ov-chip.warn{background:var(--amber-bg);color:var(--amber-ink);}
.hd-ov-chip.st-stopped,.hd-ov-chip.st-error{background:var(--red-bg);color:var(--red-ink);}
.hd-ov-chip.st-paused{background:var(--amber-bg);color:var(--amber-ink);}
.hd-ov-chip.st-done{background:var(--green-bg);color:var(--green-ink);}
.hd-ov-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;}
.hd-ov-card{padding:20px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-card);}
.hd-ov-label{font:600 10.5px var(--sans);letter-spacing:.14em;color:var(--ink-3);}
.hd-ov-value{margin-top:10px;font-size:22px;color:var(--ink);}
.hd-ov-sub{margin-top:6px;font-size:11.5px;color:var(--ink-3);overflow-wrap:anywhere;}
.hd-ov-task{padding:22px 24px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-card);}
.hd-ov-task-h{font:600 13px var(--sans);}
.hd-ov-task p{margin:10px 0 0;max-width:74ch;font:400 13.5px/1.75 var(--sans);color:var(--ink-2);white-space:pre-wrap;}
.hd-ov-more{margin-top:8px;border:none;background:none;color:var(--blue-ink);font:500 12.5px var(--sans);cursor:pointer;padding:0;}
.hd-ov-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;}
.hd-ov-tag{padding:6px 12px;border:1px solid var(--line);border-radius:999px;font-size:11.5px;color:var(--ink-2);}
```

- [ ] **Step 4: Run + commit**

Run: `node --test test/ui-history-detail.test.mjs` → PASS; `npm test` → green.

```bash
git add ui/public/app.js ui/public/style.css test/ui-history-detail.test.mjs
git commit -m "feat(ui): history overview tab with verdict, stat cards, and task card"
```

---

### Task 8: Agents + Clarify tabs

**Files:**
- Modify: `ui/public/app.js` (fill `buildHdAgents` + `buildHdClarify`)
- Modify: `ui/public/style.css` (`.hd-ag*`, `.hd-cl*`)
- Test: extend `test/ui-history-detail.test.mjs` + adapt `test/ui-history-questions.test.mjs` only if it fails (it tests the OLD card accordion, which still exists until Task 11 — it must stay green untouched here).

**Interfaces:**
- Consumes: `subsGroupsForRender` (`app.js:1377`), `cycleAwareLabel` (`app.js:1474`), `stepSkillsFromSteps` (`app.js:1420`), `stepGraphifyFromSteps` (`app.js:1432`), `stepStatusByKey` (`app.js:1405`), `subGroupStatus`/`subRowStatus`/`SUBS_STAT_TEXT` (`app.js:9958-9975`), `skillPillsHtml` (`app.js:9994`), `agentTypePillHtml` (`app.js:10024`), `graphifyCountPillHtml` (`app.js:10033`), `escapeHtml`, `fmtDuration`, `fmtUsd4`, `data.clarify`/`data.stepQuestions` shapes (see `paintClarifyBar`/`renderClarifyPanel`, `app.js:9304-9371`). Sub-agent row fields (verified in `src/core/artifacts.mjs:387-411`): `{ id, label, nodeId, stepIndex, cycle, stepKey, status, startedAt, finishedAt, durationMs, tokens, costUsd, uiPhase, skills, subagentType, graphifyCount }`.
- Produces: `hdSubDuration(s) -> number|null` — `durationMs` else `Date.parse(finishedAt) - Date.parse(startedAt)` when both parse, else null.

- [ ] **Step 1: Write the failing tests**

```js
// DETAIL.state.subAgents = [
//   { id: 't1', label: 'Codebase surveyor', nodeId: 'refine', cycle: 1, status: 'finished',
//     startedAt: '2026-08-17T20:55:00Z', finishedAt: '2026-08-17T20:58:00Z',
//     durationMs: null, costUsd: 1.5, skills: [], subagentType: 'Explore', graphifyCount: null },
//   { id: 't2', label: 'Risk annotator', nodeId: 'refine', cycle: 1, status: 'error',
//     startedAt: null, finishedAt: null, durationMs: 5000, costUsd: null, skills: ['skill:tdd'],
//     subagentType: null, graphifyCount: 2 },
// ];
// DETAIL.state.steps = [{ nodeId: 'refine', cycle: 1, status: 'done', skills: [], graphifyCount: 0 }];
// DETAIL.state.stepper = null  (manifestFor falls back to the legacy default; the group key is 'refine|1')

test('Agents tab groups rows with duration fallback and blank cost', async () => {
  // click Agents tab:
  const rows = window.document.querySelectorAll('.hd-ag-row');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Codebase surveyor/);
  assert.match(rows[0].textContent, /3m/);        // finishedAt - startedAt fallback
  assert.match(rows[0].textContent, /\$1\.5/);    // fmtUsd4
  assert.match(rows[1].textContent, /5s/);        // durationMs direct
  assert.ok(rows[1].querySelector('.st.stop'));   // error row tinted
  assert.ok(rows[1].querySelector('.graphify-pill')); // graphify badge kept
  assert.ok(rows[0].querySelector('.agent-type-pill')); // subagent_type pill kept
});

test('Agents tab empty state', async () => {
  // subAgents: [], steps: [] -> '(no sub-agents recorded)'
});

test('Clarify tab renders ASK/ANS cards + step rounds', async () => {
  // DETAIL.clarify = { questions: [{ id: 'q1', question: 'Which DB?', options: ['a','b'] }],
  //                    answers: [{ id: 'q1', question: 'Which DB?', choice: 'sqlite' }] };
  // DETAIL.stepQuestions = [{ stepKey: '3:impl#2', round: 1, agentKey: 'implementer',
  //                           questions: [{ id: 's1', question: 'Keep flag?' }], answers: [] }];
  // click Clarify (badge shows 2):
  const cards = window.document.querySelectorAll('.hd-cl-card');
  assert.equal(cards.length, 2);
  assert.match(cards[0].textContent, /Which DB\?/);
  assert.match(cards[0].textContent, /sqlite/);
  assert.match(cards[1].textContent, /\(none\)/);
  assert.match(window.document.querySelector('.hd-cl-caption').textContent, /implementer — round 1 · cycle 2/);
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```js
function hdSubDuration(s) {
  if (s && s.durationMs != null && Number.isFinite(Number(s.durationMs))) return Number(s.durationMs);
  const a = s && s.startedAt ? Date.parse(s.startedAt) : NaN;
  const b = s && s.finishedAt ? Date.parse(s.finishedAt) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
}

function buildHdAgents(sec, record, data) {
  sec.innerHTML = '';
  const st = data.state;
  const groups = subsGroupsForRender(st.subAgents, st.steps, st.stepper);
  const keys = Object.keys(groups);
  if (!keys.length) {
    const empty = document.createElement('div');
    empty.className = 'hint hd-ag-empty';
    empty.textContent = '(no sub-agents recorded)';
    sec.appendChild(empty);
    return;
  }
  const labelOf = cycleAwareLabel(st.stepper, st.subAgents, keys);
  const skillsByGroup = stepSkillsFromSteps(st.steps);
  const graphifyByGroup = stepGraphifyFromSteps(st.steps);
  const statusOf = stepStatusByKey(st.steps, st.stepper);

  for (const key of keys) {
    const list = Array.isArray(groups[key]) ? groups[key] : [];
    const card = document.createElement('div');
    card.className = 'hd-ag-group';
    const gstat = list.length ? subGroupStatus(list) : (statusOf[key] || 'done');
    const durSum = list.reduce((n, s) => n + (hdSubDuration(s) || 0), 0);
    const costSum = list.reduce((n, s) => n + (Number(s && s.costUsd) || 0), 0);
    const metaBits = [
      `${list.length} sub-agent${list.length === 1 ? '' : 's'}`,
      durSum ? fmtDuration(durSum) : '',
      costSum ? fmtUsd4(costSum) : '',
    ].filter(Boolean).join(' · ');
    const head = document.createElement('div');
    head.className = 'hd-ag-head';
    head.innerHTML =
      `<b>${escapeHtml(labelOf(key))}</b>` +
      `<span class="subs-stat ${gstat}">${SUBS_STAT_TEXT[gstat]}</span>` +
      graphifyCountPillHtml(graphifyByGroup[key]) +
      `<span class="hd-ag-meta mono">${escapeHtml(metaBits)}</span>` +
      skillPillsHtml(skillsByGroup[key]);
    card.appendChild(head);
    if (!list.length) {
      const note = document.createElement('div');
      note.className = 'hint hd-ag-none';
      note.textContent = 'No sub-agents spawned';
      card.appendChild(note);
    }
    for (const s of list) {
      const rstat = subRowStatus(s && s.status);
      const dur = hdSubDuration(s);
      const row = document.createElement('div');
      row.className = 'hd-ag-row';
      row.innerHTML =
        `<span class="hd-ag-name">${escapeHtml((s && s.label) || (s && s.id) || '')}</span>` +
        agentTypePillHtml(s && s.subagentType) +
        graphifyCountPillHtml(s && s.graphifyCount) +
        skillPillsHtml(s && s.skills) +
        `<span class="st ${rstat}">${rstat === 'run' ? 'running' : rstat === 'stop' ? 'stopped' : 'done'}</span>` +
        `<span class="hd-ag-dur mono">${dur != null ? escapeHtml(fmtDuration(dur)) : ''}</span>` +
        `<span class="hd-ag-cost mono">${s && s.costUsd != null ? escapeHtml(fmtUsd4(s.costUsd)) : ''}</span>`;
      card.appendChild(row);
    }
    sec.appendChild(card);
  }
}

function buildHdClarify(sec, record, data) {
  sec.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'hd-cl';
  sec.appendChild(wrap);
  const questions = (data.clarify && data.clarify.questions) || [];
  const answers = (data.clarify && data.clarify.answers) || [];
  const byId = new Map(answers.map((a) => [a.id, a]));
  const addCard = (q, ans) => {
    const card = document.createElement('div');
    card.className = 'hd-cl-card';
    const qRow = document.createElement('div');
    qRow.className = 'hd-cl-q';
    qRow.innerHTML = '<span class="hd-cl-chip ask mono">ASK</span>';
    const qText = document.createElement('span');
    qText.textContent = typeof q.question === 'string' ? q.question : '';
    qRow.appendChild(qText);
    const aRow = document.createElement('div');
    aRow.className = 'hd-cl-a';
    aRow.innerHTML = '<span class="hd-cl-chip ans mono">ANS</span>';
    const aText = document.createElement('span');
    const chosen = ans && typeof ans.choice === 'string' ? ans.choice.trim() : '';
    aText.textContent = chosen || '(none)';
    aRow.appendChild(aText);
    card.append(qRow, aRow);
    wrap.appendChild(card);
  };
  for (const q of questions) addCard(q, byId.get(q.id));
  for (const r of Array.isArray(data.stepQuestions) ? data.stepQuestions : []) {
    if (!((r && r.questions) || []).length) continue;
    const caption = document.createElement('div');
    caption.className = 'hint hd-cl-caption';
    const cyc = String(r.stepKey || '').split('#')[1];
    caption.textContent = `${r.agentKey || 'agent'} — round ${r.round}${cyc ? ` · cycle ${cyc}` : ''}`;
    wrap.appendChild(caption);
    const rById = new Map((r.answers || []).map((a) => [a.id, a]));
    for (const q of r.questions) addCard(q, rById.get(q.id));
  }
}
```

CSS:

```css
.hd-ag-group{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-card);
  overflow:hidden;margin-bottom:18px;}
.hd-ag-head{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:15px 20px;
  border-bottom:1px solid var(--line);font-size:13px;}
.hd-ag-meta{color:var(--ink-3);font-size:11.5px;margin-left:auto;}
.hd-ag-none{padding:12px 20px;}
.hd-ag-row{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:12px 20px;border-top:1px solid var(--line);}
.hd-ag-row:first-of-type{border-top:none;}
.hd-ag-name{min-width:0;flex:1 1 200px;font:500 13px var(--sans);color:var(--ink);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.hd-ag-dur{width:90px;text-align:right;font-size:11.5px;color:var(--ink-2);}
.hd-ag-cost{width:80px;text-align:right;font-size:11.5px;color:var(--ink-2);}
/* The reused pills' tints are scoped to the OLD subs tree (.subs-step-head .subs-stat,
   .subs-tree li .st / .agent-type-pill) — extend those existing rules' selector lists
   with .hd-ag-head .subs-stat, .hd-ag-row .st, .hd-ag-row .agent-type-pill
   (style.css:1177-1180, 1190-1193, 1215) so the tab isn't plain black text.
   .skill-pill/.graphify-pill/.subs-skills are global already. */
.hd-cl{display:flex;flex-direction:column;gap:14px;}
.hd-cl-card{padding:20px 24px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-card);}
.hd-cl-q,.hd-cl-a{display:flex;gap:12px;align-items:flex-start;}
.hd-cl-a{margin-top:12px;color:var(--ink-2);}
.hd-cl-q > span:last-child{font:600 13.5px/1.6 var(--sans);}
.hd-cl-a > span:last-child{font:400 13.5px/1.7 var(--sans);}
.hd-cl-chip{flex:0 0 auto;padding:3px 9px;border-radius:7px;font-size:10.5px;font-weight:600;}
.hd-cl-chip.ask{background:var(--field);color:var(--ink-2);}
.hd-cl-chip.ans{background:var(--green-bg);color:var(--green-ink);}
.hd-cl-caption{margin:4px 0 -6px;}
```

- [ ] **Step 4: Run + commit**

Run: `node --test test/ui-history-detail.test.mjs test/ui-history-questions.test.mjs` → PASS (the old accordion suite untouched and still green); `npm test` → green.

```bash
git add ui/public/app.js ui/public/style.css test/ui-history-detail.test.mjs
git commit -m "feat(ui): history agents and clarify tabs"
```

---

### Task 9: Logs tab

**Files:**
- Modify: `ui/public/app.js` (fill `buildHdLogs` — it calls the EXISTING `loadLiveLogs` with the tab section as `panel`; no extraction, both callers share the same function)
- Modify: `ui/public/style.css` (`.hd-sec-logs` scoping)
- Test: extend `test/ui-history-detail.test.mjs`

**Interfaces:**
- Consumes: `loadLiveLogs(panel, logUrl)` (`app.js:9399-9462`) — reuse it VERBATIM by calling it with the tab section as `panel`; it builds the filter bar + log box internally and owns fetching/filtering/painting. `historyLogUrl` (`app.js:9082`).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

```js
// DETAIL.artifacts = [{ kind: 'live-log', relPath: 'live-log.ndjson' }];
// handler: /api/history/<KEY>/<id>/log -> ndjson text with 3 lines, one with cycle 2:
const NDJSON = [
  '{"source":"orchestrator","level":"system","text":"pipeline start","ts":"2026-08-17T20:54:42Z"}',
  '{"source":"refiner","level":"phase","text":"Refine Plan","ts":"2026-08-17T20:54:43Z","stepIndex":1,"cycle":1}',
  '{"source":"refiner","level":"phase","text":"Refine Plan (re-run)","ts":"2026-08-17T21:04:12Z","stepIndex":1,"cycle":2}',
].join('\n');

test('Logs tab renders the shared filter bar + lines + cycle separator', async () => {
  // click Logs tab; settle:
  const sec = window.document.querySelector('.hd-sec[data-sec="logs"]');
  assert.ok(sec.querySelector('.log-filters'));            // shared bar, cloned from #run-card-tpl
  assert.equal(sec.querySelectorAll('.log-line').length, 3);
  assert.equal(sec.querySelectorAll('.log-sep').length, 1); // cycle 1 -> 2 separator
});

test('Logs tab filters via the shared selects', async () => {
  // set .log-f-cycle to '2' + dispatch change -> 1 visible .log-line
});
```

(Assert class names against the real `buildLogLine`/`buildLogSeparator` output — check `app.js:3585-3705` while writing; the existing `test/ui-history-logs.test.mjs` has the exact assertion idioms to copy.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** — replace the `buildHdLogs` stub:

```js
function buildHdLogs(sec, record, _data) {
  sec.classList.add('hd-sec-logs');
  loadLiveLogs(sec, historyLogUrl(record.id, record));
}
```

`loadLiveLogs` already does `panel.innerHTML = ''`, appends the shared filter bar + `.log` box, fetches, parses, facets, paints, and wires change/input/copy — zero duplication. Its retry contract (`panel.dataset.loaded = ''` on error, `app.js:9460`) composes with the tab's `sec.dataset.loaded` caching: on a fetch error the tab body will retry on the next activation because `loadLiveLogs` cleared the flag.

CSS (History-scoped, does not touch the live card):

```css
.hd-sec-logs .log{background:var(--panel);border:1px solid var(--line);border-radius:16px;
  min-height:260px;max-height:520px;overflow-y:auto;padding:18px 20px;}
.hd-sec-logs .log-filters{margin-bottom:10px;}
```

- [ ] **Step 4: Run + commit**

Run: `node --test test/ui-history-detail.test.mjs test/ui-history-logs.test.mjs` → PASS; `npm test` → green.

```bash
git add ui/public/app.js ui/public/style.css test/ui-history-detail.test.mjs
git commit -m "feat(ui): history logs tab reusing the shared log stack"
```

---

### Task 10: "Ship it?" PR modal + detail PR wiring

**Files:**
- Modify: `ui/public/index.html` (add `#shipit-modal` after `#confirm-modal`, which spans 1097-1112 — insert at ~1113)
- Modify: `ui/public/app.js` (add `openShipItModal`, `paintHdPr`; call `paintHdPr` from `setupHdActions`)
- Modify: `ui/public/style.css` (`.shipit*` + keyframes)
- Test: create `test/ui-history-shipit.test.mjs`

**Interfaces:**
- Consumes: `setMergePill` (`app.js:8914`), `scheduleMergeRecheck` (`app.js:8933`), `safeJson`, the `#confirm-modal` overlay conventions (`app.js:6015-6048` — same listener-cleanup shape), `state.ghAvailable`, record fields (`pr`, `survived`, `branch`, `sourceBranch`), `data.results.summary`.
- Produces:
  - `openShipItModal(record, data) -> void` — fills + shows `#shipit-modal`; on confirm POSTs `/api/pr` and resolves the UI inline: sets `record.pr = {state:'OPEN', url}`, closes, re-runs `paintHdPr` on the open detail screen, and drives the merge pill (`setMergePill` + conditional `scheduleMergeRecheck`). No callback parameter.
  - `paintHdPr(screen, record, data) -> void` — paints the detail header PR control from the record's PR tri-state; called from `setupHdActions` (Task 4's function gains one line) and re-run by `patchHistoryPr` when the enriched row is the open detail (add that hook).
  - Module flag `pendingShipIt = null | { id, projectKey }` — set by the list card's Create-PR path in Task 11; `openHistDetail` checks + clears it after `setupHdActions`, auto-opening the modal.

- [ ] **Step 1: Write the failing tests**

Create `test/ui-history-shipit.test.mjs` (boot helper as before; `ROW.survived = true`, `ghAvailable: true` in the `/api/history` response, `ROW.pr = null` — resolved, no PR):

```js
test('detail Create PR opens the ship-it modal with summary + branch → base', async () => {
  // open detail; click .hd-pr:
  const modal = window.document.querySelector('#shipit-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  assert.match(modal.textContent, /Ship it\?/);
  assert.match(modal.textContent, /14 files/);            // from results.summary
  assert.match(modal.textContent, /\+412/); assert.match(modal.textContent, /−188/);
  assert.match(modal.textContent, new RegExp(ROW.branch.replace(/[/\\]/g, '.')));
});

test('confirm POSTs /api/pr and swaps the header control to a link + merge pill', async () => {
  // handler: POST /api/pr -> { ok: true, url: 'https://x/pull/7', mergeable: 'MERGEABLE', existed: false }
  // click .shipit-ok; settle:
  assert.ok(calls.some((c) => c.url.endsWith('/api/pr') && c.opts.method === 'POST'));
  assert.equal(modal.classList.contains('hidden'), true);
  const link = window.document.querySelector('.hd-pr-link');
  assert.equal(link.hidden, false);
  assert.equal(link.href, 'https://x/pull/7');
  assert.match(window.document.querySelector('.hist-merge').textContent, /can merge/);
});

test('cancel / Escape / backdrop close without POSTing', async () => { /* three variants */ });

test('PR failure shows the error inside the modal and re-enables confirm', async () => {
  // handler -> { ok: false, status: 500, json: async () => ({ error: 'push failed' }) }
  // assert .shipit-err textContent matches /push failed/ and modal stays open
});

test('OPEN/MERGED records render links, not the button', async () => {
  // ROW.pr = { state: 'MERGED', url: 'https://x/pull/5' } -> .hd-pr hidden, .hd-pr-link 'Merged'
});
```

- [ ] **Step 2: Run to verify failure** — modal element absent.

- [ ] **Step 3: Implement**

3a. Markup (after `#confirm-modal` in `index.html`):

```html
<div id="shipit-modal" class="viewer-modal hidden" role="dialog" aria-modal="true" aria-label="Open a pull request">
  <div class="card shipit-card">
    <div class="shipit-ico-wrap">
      <div class="shipit-spark"></div>
      <div class="shipit-ico">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="6" r="2.4"/><circle cx="6.5" cy="18" r="2.4"/><circle cx="17.5" cy="12" r="2.4"/><path d="M6.5 8.4v7.2M8.9 17c4.1 0 6-1.8 6.2-3.6M8.9 7c4.1 0 6 1.8 6.2 3.6"/></svg>
      </div>
    </div>
    <h2>Ship it?</h2>
    <p class="shipit-sub"></p>
    <div class="shipit-summary mono">
      <span class="shipit-files"></span>
      <span class="diff-add shipit-add"></span>
      <span class="diff-del shipit-del"></span>
      <span class="shipit-break"></span>
      <b class="shipit-branch"></b>
      <span class="shipit-arrow">→</span>
      <span class="shipit-base"></span>
    </div>
    <div class="shipit-err hint err" hidden></div>
    <div class="shipit-actions">
      <button type="button" class="shipit-cancel btn-ghost">Cancel</button>
      <button type="button" class="shipit-ok">Open pull request</button>
    </div>
  </div>
</div>
```

3b. app.js — modal controller + detail wiring (`paintHdPr` REPLACES the Task-4 stub of the same name):

```js
let pendingShipIt = null; // { id, projectKey } set by the list's Create-PR path

function openShipItModal(record, data) {
  const modal = document.getElementById('shipit-modal');
  if (!modal) return;
  if (!modal.classList.contains('hidden')) return; // double-open guard: a second open would stack a second onOk -> two POSTs
  const q = (sel) => modal.querySelector(sel);
  q('.shipit-sub').textContent =
    `This opens a pull request for ${record.title || record.id} and puts it up for review.`;
  const sums = data && data.results && data.results.summary;
  const nFiles = sums
    ? (sums.filesNew || 0) + (sums.filesChanged || 0) : null; // 'D' rows count in filesChanged
  const added = sums ? sums.linesAdded : (record.survived ? record.added : null);
  const removed = sums ? sums.linesRemoved : (record.survived ? record.removed : null);
  q('.shipit-files').textContent = nFiles != null ? `${nFiles} file${nFiles === 1 ? '' : 's'}` : '';
  q('.shipit-add').textContent = added != null ? `+${added}` : '';
  q('.shipit-del').textContent = removed != null ? `−${removed}` : ''; // U+2212
  q('.shipit-branch').textContent = record.branch || '';
  q('.shipit-base').textContent = record.sourceBranch || '';
  const err = q('.shipit-err');
  err.hidden = true; err.textContent = '';
  const okBtn = q('.shipit-ok');
  okBtn.disabled = false; okBtn.textContent = 'Open pull request';
  modal.classList.remove('hidden');
  okBtn.focus();

  const done = () => {
    modal.classList.add('hidden');
    okBtn.removeEventListener('click', onOk);
    q('.shipit-cancel').removeEventListener('click', onCancel);
    modal.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKey);
  };
  const onCancel = () => done();
  const onBackdrop = (e) => { if (e.target === modal) done(); };
  const onKey = (e) => { if (e.key === 'Escape') done(); };
  const onOk = async () => {
    okBtn.disabled = true;
    okBtn.textContent = 'Opening…';
    try {
      const res = await fetch('/api/pr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: record.projectDir || null, projectKey: record.projectKey, id: record.id }),
      });
      const dd = await safeJson(res);
      if (!res.ok) throw new Error((dd && dd.error) || `HTTP ${res.status}`);
      record.pr = { state: 'OPEN', url: dd.url || '#', number: null };
      done();
      const screen = histDetailState && histDetailState.screen;
      if (screen) {
        paintHdPr(screen, record, histDetailState.data);
        const mergeEl = screen.querySelector('.hist-merge');
        if (mergeEl) {
          setMergePill(mergeEl, dd.mergeable);
          if (String(dd.mergeable || 'UNKNOWN').toUpperCase() === 'UNKNOWN') {
            scheduleMergeRecheck(mergeEl, { projectDir: record.projectDir || null, projectKey: record.projectKey, id: record.id });
          }
        }
      }
    } catch (e2) {
      okBtn.disabled = false;
      okBtn.textContent = 'Open pull request';
      err.hidden = false;
      err.textContent = `Could not open PR: ${e2.message}`;
    }
  };
  okBtn.addEventListener('click', onOk);
  q('.shipit-cancel').addEventListener('click', onCancel);
  modal.addEventListener('click', onBackdrop);
  document.addEventListener('keydown', onKey);
}

// Detail-header PR control from the record's tri-state (undefined = enrichment
// pending -> hidden; null = none -> Create when eligible; object = link).
function paintHdPr(screen, record, data) {
  const btn = screen.querySelector('.hd-pr');
  const link = screen.querySelector('.hd-pr-link');
  btn.hidden = true;
  link.hidden = true;
  const pr = record.pr && typeof record.pr === 'object' ? record.pr : null;
  const prState = pr ? String(pr.state || '').toUpperCase() : '';
  if (pr && (prState === 'OPEN' || prState === 'MERGED') && pr.url) {
    link.hidden = false;
    link.href = pr.url;
    link.textContent = prState === 'MERGED' ? 'Merged' : 'View PR';
    link.classList.toggle('merged', prState === 'MERGED');
    return;
  }
  const eligible = state.ghAvailable && record.survived && record.branch && record.sourceBranch;
  if (!eligible || record.pr === undefined) return;
  btn.hidden = false;
  if (btn.dataset.bound !== '1') {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => openShipItModal(record, data));
  }
}
```

3c. Wire-in points:
- `setupHdActions` (Task 4) gains, at its end: `paintHdPr(screen, record, data);`
- `openHistDetail` (Task 3), after `loadHistDetailScreen`'s successful paint (inside `loadHistDetailScreen`, after `initHdTabs(...)`): 

```js
    const ship = pendingShipIt;
    pendingShipIt = null;
    if (ship && ship.id === parsed.id && ship.projectKey === parsed.projectKey) {
      // The list button's click already proved eligibility + "no PR" — but the
      // history CACHE strips `pr` from persisted rows, so after the hop the
      // matched record may read pr === undefined again. Honor the click-time
      // fact instead of re-deriving (else the intent is silently dropped on
      // essentially every cache-warm navigation).
      if (record.pr === undefined) record.pr = null;
      paintHdPr(screen, record, data);
      openShipItModal(record, data);
    }
```
- `patchHistoryPr` (`app.js:8289`) gains the following IMMEDIATELY after the model update (`if (row) row.pr = pr || null;`, line 8293) and BEFORE the `if (!card) return;` early-out at 8299 — appending it at the end would skip the detail repaint exactly when the matching list card is filtered off-screen (the deep-link case this hook exists for): 

```js
  if (histDetailState && histDetailState.id === id && histDetailState.key === projectKey && histDetailState.screen) {
    if (row) histDetailState.record = row;   // a deep-link's minimal record upgrades to the real row
    paintHdPr(histDetailState.screen, histDetailState.record, histDetailState.data);
  }
```
(when the list loaded first, the enriched `row` already IS `histDetailState.record` — `histRecordFor` returns the same object, so the reassignment is a no-op there).
- The Task 3 Escape handler gains a shipit guard: `const ship = document.getElementById('shipit-modal'); if (ship && !ship.classList.contains('hidden')) return;`

3d. CSS:

```css
.shipit-card{width:min(560px,100%);padding:32px 28px 24px;text-align:center;
  animation:shipit-rise .34s cubic-bezier(.2,.7,.3,1) both;}
@keyframes shipit-rise{0%{transform:translateY(10px);opacity:0}100%{transform:translateY(0);opacity:1}}
.shipit-ico-wrap{position:relative;display:grid;place-items:center;width:74px;height:74px;margin:0 auto;}
.shipit-spark{position:absolute;inset:0;border-radius:50%;background:var(--green-bg);
  animation:shipit-spark .9s ease-out .12s both;}
.shipit-ico{position:relative;display:grid;place-items:center;width:60px;height:60px;border-radius:50%;
  background:var(--green-bg);color:var(--green-ink);animation:shipit-pop .42s cubic-bezier(.2,.8,.25,1) both;}
.shipit-card h2{margin:18px 0 0;font:700 20px/1.25 var(--sans);letter-spacing:-.02em;}
.shipit-sub{margin:8px 0 0;font:400 13.5px/1.6 var(--sans);color:var(--ink-2);}
.shipit-summary{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;
  margin-top:18px;padding:14px;background:var(--field);border-radius:14px;font-size:12px;color:var(--ink-2);}
.shipit-break{flex-basis:100%;height:0;}
.shipit-branch{color:var(--ink);word-break:break-all;}
.shipit-actions{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:22px;}
.shipit-ok{padding:11px 22px;border:1.5px solid var(--ink);border-radius:999px;background:var(--ink);
  font:600 13.5px var(--sans);color:#fff;cursor:pointer;}
.shipit-err{margin-top:12px;}
@keyframes shipit-pop{0%{transform:scale(.72);opacity:0}60%{transform:scale(1.06)}100%{transform:scale(1);opacity:1}}
@keyframes shipit-spark{0%{transform:scale(.4);opacity:0}45%{opacity:1}100%{transform:scale(1.9);opacity:0}}
```

**Mandatory in this task:** the reduced-motion block at `style.css:756-759` kills `transition` globally but `animation` only for 4 named selectors (`.pdot,.cur,.child-dot,.child-q`) — the shipit keyframes WOULD run under reduced motion. Extend that existing media block with the TARGETED rule `.shipit-spark,.shipit-ico,.shipit-card{animation:none;}` — NOT a blanket `*{animation:none !important}`, which would also kill the Refresh busy spinner and other progress affordances the block deliberately spares.

- [ ] **Step 4: Run + commit**

Run: `node --test test/ui-history-shipit.test.mjs test/ui-history-detail.test.mjs` → PASS; `npm test` → green.

```bash
git add ui/public/index.html ui/public/app.js ui/public/style.css test/ui-history-shipit.test.mjs
git commit -m "feat(ui): ship-it PR confirm modal on the history detail page"
```

---

### Task 11: List card v2 + accordion removal

The largest task: the card flips to the new design, clicks navigate to the detail page, and every accordion-era code path dies. All old-card tests adapt here — their replacement features (detail page, tabs) already exist and are tested.

**Files:**
- Modify: `ui/public/index.html` (replace `#hist-card-tpl`'s content)
- Modify: `ui/public/app.js` (rewrite `buildHistCard`; retarget `setupPrButton`'s create path; delete dead functions)
- Modify: `ui/public/style.css` (card v2 rules; delete dead rules)
- Test: rewrite/adapt `test/ui-history.test.mjs`, `test/ui-history-pr.test.mjs`, `test/ui-history-pr-phase.test.mjs`, `test/ui-history-delete.test.mjs`, `test/ui-history-diff-overview.test.mjs`, `test/ui-history-logs.test.mjs`, `test/ui-history-questions.test.mjs` (others — pills/cache/boot-count/workspace/sticky — should pass with at most selector touch-ups)

**Interfaces:**
- Consumes: `histStatusMeta`/`paintHistStatusIcon` + the `.hist-sic` markup (Task 3), `splitDateStamp` (Task 4), `histDetailParam` (Task 3), `pendingShipIt` (Task 10), `copyBranchToClipboard`, `sourceBadge`, `renderRetainedWork` (badge-only here: the card keeps `.hist-retained-badge` but has NO `.retained-banner` — `renderRetainedWork` already tolerates a missing banner node, see `app.js:8640-8643`).
- Produces: the final `#hist-card-tpl` shape every remaining History test targets.

- [ ] **Step 1: Replace the card template** (`index.html`)

```html
<template id="hist-card-tpl">
  <section class="card hist-card">
    <div class="hist-head" role="button" tabindex="0">
      <span class="hist-sic" role="img">
        <svg class="sic sic-done" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <svg class="sic sic-stopped" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        <svg class="sic sic-paused" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>
        <svg class="sic sic-error" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 6.5v7"/><path d="M12 17.4h.01"/></svg>
      </span>
      <div class="h-meta">
        <b></b>
        <span class="badge hist-retained-badge" hidden>Work retained</span>
        <div class="hist-meta-line">
          <span class="hist-status-word"></span>
          <span class="hm-seg hist-day-seg"><span class="hm-dot">·</span><small class="hist-day"></small></span>
          <span class="hm-seg hist-clock-seg"><span class="hm-dot">·</span><small class="hist-clock"></small></span>
          <span class="hm-seg hist-time-seg"><span class="hm-dot">·</span><span class="hist-time mono"></span></span>
          <span class="hm-seg hist-total-seg"><span class="hm-dot">·</span><span class="hist-total mono"></span></span>
          <span class="hist-diff-pill" hidden>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 3h8l4 4v14H6z" stroke-linejoin="round"/><path d="M14 3v4h4" stroke-linejoin="round"/></svg>
            <span class="hist-diff mono" aria-label="lines changed"></span>
            <span class="hist-nodiff mono" hidden>no diff</span>
          </span>
        </div>
        <span class="hist-branch mono" hidden>
          <span class="hist-branch-src" hidden></span>
          <svg class="hist-branch-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-label="into" role="img" hidden><path d="M4 12h15M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span class="hist-branch-dst"></span>
          <button type="button" class="hist-branch-copy" title="Copy branch name" aria-label="Copy branch name">
            <svg class="ico-copy" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" stroke-linecap="round"/></svg>
            <svg class="ico-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 12.5l5.5 5.5L20 6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </span>
        <span class="hist-pausenote" hidden></span>
      </div>
      <div class="hist-aside">
        <button type="button" class="hist-pr btn-ghost" hidden>Create PR</button>
        <button type="button" class="hist-open" aria-label="Open run details">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
  </section>
</template>
```

Gone from the template: the status `.badge`, `.hist-merge`, `.hist-resume`, `.chev`, the whole `.hist-detail` block (`retained-banner`, `run-flow`, results section, 5 accordion bars, `.hist-actions`).

- [ ] **Step 2: Rewrite `buildHistCard`** (`app.js:8957-9046`)

```js
function buildHistCard(projectDir, p, ghAvailable = false) {
  const tpl = $('#hist-card-tpl');
  const node = tpl.content.firstElementChild.cloneNode(true);
  const id = p.id || '';
  node.dataset.pipelineId = id;
  node.dataset.projectKey = p.projectKey || '';

  paintHistStatusIcon(node.querySelector('.hist-sic'), p);
  const { word, family } = histStatusMeta(p);
  const wordEl = node.querySelector('.hist-status-word');
  wordEl.textContent = word;
  wordEl.className = `hist-status-word st-${family}`;

  const titleEl = node.querySelector('.h-meta b');
  titleEl.textContent = p.title || id || '(untitled)';
  titleEl.addEventListener('click', (e) => { e.stopPropagation(); viewPipeline(projectDir, id, p.title, p); });
  const src = sourceBadge(p);   // spec §4.1: provenance sits in the META line, not beside the title
  if (src) node.querySelector('.hist-meta-line').appendChild(src);

  const { day, clock } = splitDateStamp(p.startedAt || p.mtime);
  const seg = (name, text) => {
    const el2 = node.querySelector(`.hist-${name}-seg`);
    const val = node.querySelector(`.hist-${name}`);
    if (!text) { el2.hidden = true; return; }
    val.textContent = text;
  };
  seg('day', day);
  seg('clock', clock);
  seg('time', typeof p.totalActiveMs === 'number' ? fmtDuration(p.totalActiveMs) : '');
  seg('total', typeof p.totalCostUsd === 'number' ? fmtUsd(p.totalCostUsd) : '');
  const totalEl = node.querySelector('.hist-total');
  if (typeof p.totalCostUsd === 'number') totalEl.title = estTitle(p.totalCostUsd);

  renderHistDiffPill(node.querySelector('.hist-diff-pill'), p);

  // Branch line: unchanged mechanics from 997aa083.
  const branchEl = node.querySelector('.hist-branch');
  const feature = p.branch || '';
  const source = p.sourceBranch || '';
  branchEl.hidden = !feature;
  branchEl.querySelector('.hist-branch-dst').textContent = feature;
  const srcEl = branchEl.querySelector('.hist-branch-src');
  srcEl.textContent = source;
  srcEl.hidden = !source;
  branchEl.querySelector('.hist-branch-arrow').toggleAttribute('hidden', !source);
  const copyBtn = branchEl.querySelector('.hist-branch-copy');
  copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyBranchToClipboard(copyBtn, feature); });

  // Pause note (Resume + its budget gating live on the detail page now; the
  // stamp survives for parity/debugging, nothing re-reads it on the card).
  const pauseReason = typeof p.pauseReason === 'string' ? p.pauseReason : '';
  if (pauseReason) node.dataset.pauseReason = pauseReason;
  const noteEl = node.querySelector('.hist-pausenote');
  const costPaused = PAUSED_STATUSES.includes(String(p.status || '').toLowerCase()) && pauseReason.startsWith('cost_');
  noteEl.hidden = !costPaused;
  noteEl.textContent = costPaused
    ? (pauseReason === 'cost_total' ? 'paused · total budget' : 'paused · cost limit') : '';
  noteEl.classList.toggle('total', costPaused && pauseReason === 'cost_total');

  renderRetainedWork(node, p);           // badge only — the card has no banner node
  setupPrButton(node, projectDir, p, ghAvailable);

  // Whole-card click -> detail page. Interactive descendants opt out.
  const go = () => { location.hash = `history/${histDetailParam(p)}`; };
  const head = node.querySelector('.hist-head');
  head.addEventListener('click', (e) => {
    if (e.target.closest('button, a')) return;
    go();
  });
  head.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') && !e.target.closest('button, a')) {
      e.preventDefault();
      go();
    }
  });
  node.querySelector('.hist-open').addEventListener('click', (e) => { e.stopPropagation(); go(); });
  return node;
}

// Diff pill: merged PR -> hidden ("the diff is no longer the story"); survived
// with changes -> +A −R; survived with none -> "no diff"; branch gone -> hidden.
function renderHistDiffPill(pill, p) {
  if (!pill) return;
  const merged = p.pr && typeof p.pr === 'object' && String(p.pr.state || '').toUpperCase() === 'MERGED';
  if (!p || !p.survived || merged) { pill.hidden = true; return; }
  pill.hidden = false;
  const added = Number.isFinite(+p.added) ? +p.added : 0;
  const removed = Number.isFinite(+p.removed) ? +p.removed : 0;
  const diffEl = pill.querySelector('.hist-diff');
  const noneEl = pill.querySelector('.hist-nodiff');
  const has = added > 0 || removed > 0;
  noneEl.hidden = has;
  diffEl.hidden = !has;
  if (has) {
    diffEl.innerHTML = '';
    const add = document.createElement('span'); add.className = 'diff-add'; add.textContent = `+${added}`;
    const del = document.createElement('span'); del.className = 'diff-del'; del.textContent = `−${removed}`; // U+2212
    diffEl.append(add, ' ', del);
    pill.title = `${added} added, ${removed} removed vs ${p.sourceBranch || 'source'}`;
  }
}
```

- [ ] **Step 3: Retarget the PR button + patch flows**

- `setupPrButton` (`app.js:8536`): the OPEN/MERGED link branch and eligibility/tri-state gates stay byte-identical. Replace ONLY the create-click body (`app.js:8572-8605`) with navigation:

```js
  btn.hidden = false;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pendingShipIt = { id: p.id, projectKey: p.projectKey };
    location.hash = `history/${histDetailParam(p)}`;
  });
```
  Delete the now-unused `mergeEl` lookup in it.
- `resetPrCluster` (`app.js:8277`): the template no longer has `.hist-merge` — drop the merge half:

```js
function resetPrCluster(card) {
  const aside = card.querySelector('.hist-aside');
  if (!aside) return;
  const freshPr = $('#hist-card-tpl').content.querySelector('.hist-pr').cloneNode(true);
  const curPr = aside.querySelector('.hist-pr, .hist-pr-link');
  if (curPr) curPr.replaceWith(freshPr); else aside.insertBefore(freshPr, aside.querySelector('.hist-open'));
}
```
- `patchHistoryPr` + `finalizeHistoryPr`: after `setupPrButton(...)`, also `renderHistDiffPill(card.querySelector('.hist-diff-pill'), row)` so a MERGED enrichment hides the pill.

- [ ] **Step 4: Delete dead code** (each with a `grep -n "<name>" ui/public/app.js` check that the only remaining references are the deletions themselves):

`toggleHistCard`, `loadHistDetail`, `renderResults`, `fileList`, `paintDiffBar`, `renderDiffPanel`, `paintOverviewBar`, `buildOverviewPanel`, `loadOverview`, `paintOverview`, `paintClarifyBar`, `renderClarifyPanel`, `paintLiveLogsBar`, `setupResumeButton`, `setupDeleteButton`, `historyBadge`, `renderHistDiff`.

**The `window.__np` test seam (`app.js:2656-2732`) references `historyBadge` (:2718), `paintClarifyBar` (:2721), and `setupResumeButton` (:2723)** — prune those entries in the same commit, or app.js throws a ReferenceError at module evaluation and EVERY jsdom suite goes red. Add replacements the adapted tests need (`histStatusMeta`, and whatever detail painters the reworked suites reach for) rather than reaching into module internals.
Keep: `issueList` (Overview tab), `viewPipeline`/`showViewer`, `paintHistStepper`/`histReachedCell`/`histNodeCycle`, `renderRetainedWork`/`addRecoveryPatchLink`/`setupDiscardWorktreeButton` (detail), `histCostOverride`, `applyHistResumeGate`/`refreshHistResumeGating` (detail-only now — simplify its selector to `.hd`), `isDeletableEntry`, `setMergePill`/`scheduleMergeRecheck` (detail), `loadLiveLogs`, `PAUSED_STATUSES`.
The `results-view.mjs` import line (`app.js:59-60`) reduces to `sourceBadge, workflowPickerLabel`: `statusChip`'s only caller was `renderResults` (9111), `diffBadges`'s only caller was `paintDiffBar` (9473), `mergeFindings`'s only caller was `paintOverview` (9197), `reportResultControl`'s only caller was `renderResults` (9118) — all four die with their callers (verified single-caller each). Note: `sourceBadge(p)` in `buildHistCard` is a no-op TODAY too — list entries carry no `source_type`/`source_ref` (`artifacts.mjs:1432-1449`), so it always returns null; keep the call as status quo (wiring provenance into the list feed is out of scope).
Also update the JSDoc/comment blocks that referenced the removed accordions, and delete the `.hist-actions`/`.hist-merge`/`.hist-resume`/`.hist-delete`/`.hist-discard`(list-scoped)/`.chev`(hist-scoped) CSS plus `.hist-row`/`.hist-section`/`.hist-section-title` legacy rules (`style.css:670-675, 716-717`) and `.hist-answer` (`style.css:718` — dies with `renderClarifyPanel`). `.hist-discard` styling must survive for the detail banner button — move it under a `.hd-banners .hist-discard` scope check first.

- [ ] **Step 5: Card v2 CSS**

```css
.hist-head{display:flex;align-items:flex-start;gap:13px;cursor:pointer;}
/* card icon is 36px; scoped so the detail header's 30px .hd-sic (Task 3) keeps its size */
.hist-card .hist-sic{width:36px;height:36px;align-self:center;}
.hist-meta-line{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:5px;}
.hist-meta-line .hm-seg{display:inline-flex;align-items:center;gap:7px;}
.hist-meta-line .hm-seg[hidden]{display:none;}
.hm-dot{font:700 16px/1 var(--mono);color:var(--ink);}
.hist-status-word{font:600 12px var(--sans);display:inline-flex;align-items:center;gap:7px;}
/* the design's 7px status accent dot before the word; currentColor = family ink */
.hist-meta-line .hist-status-word::before{content:'';width:7px;height:7px;border-radius:50%;
  background:currentColor;flex:0 0 auto;}
.hist-day,.hist-clock{font:400 12.5px var(--mono);color:var(--ink-3);}
.hist-time,.hist-total{font:700 12.5px var(--mono);color:var(--ink);}
.hist-diff-pill{display:inline-flex;align-items:center;gap:8px;padding:4px 11px;
  border:1px solid var(--line);border-radius:999px;background:var(--panel);font-size:12px;}
.hist-diff-pill[hidden]{display:none;}
.hist-nodiff{color:var(--ink-3);}
.hist-open{display:flex;align-items:center;justify-content:center;width:30px;height:30px;
  border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--ink-2);cursor:pointer;}
.hist-open:hover{background:var(--ink);color:#fff;border-color:var(--ink);}
```
(The `.hist-status-word.st-*` colors from Task 4 apply here too. Keep `.hist-branch*` rules from `style.css:816-825` as-is.)

- [ ] **Step 6: Adapt the test suites**

- `test/ui-history.test.mjs`: expansion/tint cases become navigation cases — clicking a card sets `#history/<key>/<id>` and the detail screen opens (the graph now renders on the detail screen; move the tint assertions there or drop the ones `ui-history-routing`/`-detail` already cover). Keep the card-anatomy assertions and rewrite them for: status icon family class, status word, day/clock/dur/cost segments (hidden when absent), diff pill states (counts / "no diff" / hidden-when-merged / hidden-when-!survived), branch line (legacy no-source, no-branch, copy-doesn't-navigate).
- `test/ui-history-pr.test.mjs` / `-pr-phase.test.mjs`: keep the tri-state + phase-2 patch mechanics (selectors unchanged: `.hist-pr`, `.hist-pr-link`); replace the "click Create PR POSTs /api/pr" case with "click Create PR navigates to the detail page and auto-opens the ship-it modal" (assert `pendingShipIt` behavior via the DOM: modal visible after settle). Merge-pill list assertions are deleted (pill is detail-only now). Two `aria-expanded`-era assertions must be REWRITTEN, not kept: `ui-history-pr.test.mjs:106` ("copy doesn't expand" asserts `aria-expanded === 'false'` — the attribute no longer exists; assert `location.hash` unchanged instead) and `ui-history-pr-phase.test.mjs:69/71/83` ("expand survived the patch" asserts `aria-expanded === 'true'` — assert instead that the in-place PR patch did not disturb the card node identity / did not navigate).
- `test/ui-history-delete.test.mjs`: card-level Archive tests move to the detail (already covered in `ui-history-detail`); this file keeps the model-level assertions (archived row leaves `state.historyAll`, pills recount) by driving the DETAIL archive flow, or is folded into `ui-history-detail.test.mjs` and deleted — prefer folding + deleting.
- `test/ui-history-diff-overview.test.mjs`, `test/ui-history-logs.test.mjs`, `test/ui-history-questions.test.mjs`: accordion-era; delete the cases that tested bar/panel toggling and keep any pure-helper assertions by moving them next to their new equivalents (Diff tab, Logs tab, Clarify tab tests in `ui-history-detail.test.mjs`). Delete the files once empty.
- `test/ui-history-workspace.test.mjs`: NOT a touch-up — 3 of its 7 tests are accordion/Archive-driven (`:106-128` expand → workspace detail URL + `.detail-error`; `:148-171` and `:173-195` expand → `.hist-delete` DELETE URL assertions). Rewrite them through the new flow: card click → detail screen → assert the workspace detail URL was fetched; archive via `.hd-archive` + `confirmModal` → assert `?workspaceId=` on the DELETE.
- `test/ui-history-cache.test.mjs`, `-pills`, `-boot-count`, `-sticky-header`: run; fix selectors only if something broke.
- **Non-history suites that drive the old card accordion — all must adapt in THIS task** (each currently expands `.hist-head` or dereferences `#hist-card-tpl` internals):
  - `test/ui-cost.test.mjs:87-119` + `test/ui-duration.test.mjs:85-117` — expand → `.hist-detail .run-node` cost/duration text ⇒ drive the detail screen instead (open via hash, assert `.hd .run-node` texts).
  - `test/ui-cost-paused.test.mjs:185-230` — card `.hist-resume` + `.hist-detail .cost-banner` ⇒ `.hd-resume` + `.hd-banners .cost-banner`.
  - `test/ui-pause-resume.test.mjs:45-77` — calls `historyBadge` (deleted) and asserts card Resume visibility ⇒ assert `histStatusMeta` words + detail `.hd-resume` visibility.
  - `test/ui-subagent-views.test.mjs:113-115` + `test/ui-subagent-pulse-scope.test.mjs:128-130` — expand → `.hist-detail` subs/graph ⇒ detail screen equivalents.
  - `test/ui-skill-pills.test.mjs:132-133` — asserts `#hist-card-tpl` contains `.subs-bar` ⇒ retarget `#run-card-tpl` only (History's skills render via the Agents tab now).
  - `test/ui-stepper.test.mjs:89` — asserts `#hist-card-tpl` hosts `.run-flow` ⇒ retarget `#hist-detail-tpl`.
  - `test/ui-agents-dropdown.test.mjs:51-59` — loops `['#run-card-tpl','#hist-card-tpl']` and dereferences `.subs-bar` (throws on null) ⇒ drop `#hist-card-tpl` from the loop.

- [ ] **Step 7: Run everything**

Run: `npm test`
Expected: green — this task is done only when the FULL suite passes.

- [ ] **Step 8: Commit**

```bash
git add ui/public/index.html ui/public/app.js ui/public/style.css test/
git status --short   # verify: nothing under docs/superpowers is staged
git commit -m "feat(ui): history list card v2 navigating to the detail page; retire card accordions"
```

---

### Task 12: Polish, dead-code sweep, real-browser verification

**Files:**
- Modify: `ui/public/style.css` (final polish), `ui/public/app.js` (leftovers only)
- No new tests; the suite + a real-browser check gate this task.

**Interfaces:**
- Consumes: everything Tasks 1-11 produced.
- Produces: nothing new (verification + cleanup only).

- [ ] **Step 1: Reduced-motion + focus audit**

- Read `style.css:756` and `:1230` media blocks; confirm they neutralize `transition` AND `animation` — extend them if animation is uncovered (Task 10 noted this).
- Focus management: on `openHistDetail`, after the slide, `screen.querySelector('.hd-back').focus({ preventScroll: true })`; on `closeHistDetail`, refocus the originating card if it still exists (`el.history.querySelector('.hist-card[data-pipeline-id="<id>"] .hist-head')`). Add both (small, testable by a focus assertion in `ui-history-routing.test.mjs`).

- [ ] **Step 2: Dead-code + dead-CSS sweep**

```bash
grep -n "diff-bar\|overview-bar\|logs-bar\|clarify-bar\|hist-detail\b\|btn-subs" ui/public/app.js ui/public/index.html
```
Every hit must be Running-owned (`#run-card-tpl` and its painters) or `.hd-*`/detail-owned. Remove any orphaned History-side hits. Same for `style.css` history-scoped rules.

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: green, zero skips introduced by this work.

- [ ] **Step 4: Real-browser layout verification (CDP)**

jsdom does no layout — verify the real thing per the project's CDP recipe (headless Chrome + native WebSocket; use `Page.reload` rather than re-navigate when iterating):

1. `node ui/server.mjs` against a store that has at least one done pipeline with results + patch + logs (the dev machine's real `~/.worca-cc` store qualifies; otherwise seed one with `test/helpers/db-seed.mjs` + hand-written artifacts).
2. Headless Chrome via CDP: open `http://localhost:<port>/#history`, screenshot; click a card, screenshot the detail (tabs, graph, diff panes); `#history/<key>/<id>` direct-load, screenshot.
3. Check: no horizontal page scroll on either screen at 1440px and 960px; sticky pills pin FLUSH to the scrollport top after scrolling (the padding-on-scroller trap the old CSS comments at `style.css:212`/`:723` warn about); sticky group headers sit below via `--hist-toolbar-h`; sticky tabs pin under the detail header; slide animates (and does not under emulated `prefers-reduced-motion`); patch pane scrolls internally.
4. Fix CSS regressions found; re-run `npm test` after any JS touch.

- [ ] **Step 5: Manual smoke (whole-feature walkthrough)**

With the real server: list → open detail → all five tabs → copy branch → Esc back → deep-link reload → archive a disposable run via the new modal (confirm the honest copy renders) → Create PR path against a repo without `gh` (button hidden) — every action either works or degrades with its designed message.

- [ ] **Step 6: Final commit**

```bash
git add ui/public ui/server.mjs test
git status --short   # verify: nothing under docs/superpowers is staged
git commit -m "chore(ui): history redesign polish, dead-code sweep, motion + focus audit"
```

---

## Spec coverage map

| Spec section | Task(s) |
|---|---|
| §4.1 list card anatomy | 11 |
| §4.2 list interaction | 11 |
| §5.1 navigation/slide/deep-link | 3, 12 |
| §5.2 header + Resume + Archive + banners | 4, 10 (PR control + merge pill) |
| §5.3 pipeline graph | 3 |
| §5.4 tabs | 5 |
| §5.5 Diff tab (D1, D4) | 1, 2, 6 |
| §5.6 Overview tab (D5, D6) | 7 |
| §5.7 Agents tab | 8 |
| §5.8 Clarify tab | 8 |
| §5.9 Logs tab | 9 |
| §5.10 Ship-it modal | 10 |
| §6 removals | 11, 12 |
| §7 server changes | 2 |
| §8 visual language | 3-11 CSS steps, 12 |
| §9 testing | every task + 12 |
| §10 non-goals | enforced by Global Constraints |



