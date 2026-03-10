# W-012: Log Search & Filtering


**Goal:** Transform the worca-ui log viewer from a basic stage-filtered terminal into a fully searchable, filterable, and exportable log analysis tool. Users will be able to search logs with regex, filter by log level, restrict to a time range, bookmark lines, and download filtered output — all without leaving the browser.

**Architecture:** The xterm.js `SearchAddon` (already loaded in `log-viewer.js`) is extended with full options exposure (regex, case, whole-word). A new `log-filter.js` server module adds a `POST /api/logs/search` endpoint that performs server-side grep across log files so large runs do not ship every line to the client. The client gains a collapsible filter bar component rendered in `log-viewer.js`, and a bookmark store that marks xterm.js decoration positions. Log export uses the Blob/URL API to download the currently rendered terminal content, with ANSI codes stripped.

**Tech Stack:** xterm.js SearchAddon (existing), xterm.js DecorationAddon (new), Express REST endpoint, Node.js `fs.readFileSync` for filtered search, lit-html filter bar, Shoelace input/select/checkbox/button/badge components, Web Blob API.

**Depends on:** W-000 Settings REST API (already complete). No other W-series dependency.

---

## 1. Scope and Boundaries

### In scope
- Regex-capable search bar wired to `SearchAddon.findNext` / `findPrevious` with options: case-sensitive, whole-word, regex mode
- Match count badge ("3 of 17 matches") updated on each search tick
- Log level filter: ERROR / WARN / INFO / DEBUG — client-side applied as ANSI-prefix pattern match before writing to terminal
- Time range selector: start/end inputs that slice log lines by the `HH:MM:SS` timestamp prefix already present in each line
- Bookmark toggle on the current xterm.js search result (stored as in-memory array, rendered via DecorationAddon highlights)
- Bookmark navigation (prev/next bookmark buttons)
- Log export: download all lines currently in the terminal as a stripped plain-text file, filename `{runId}-{stage}-{timestamp}.log`
- `POST /api/logs/search` — server-side filtered log endpoint for large archived runs (>5,000 lines), returns matched line objects with stage, iteration, line number, and text
- Keyboard shortcuts: `Cmd/Ctrl+F` to focus search, `Enter`/`Shift+Enter` to navigate matches, `Escape` to clear search

### Out of scope
- Persistent bookmark storage across page reloads (bookmarks live only in memory for the session)
- Full-text index or SQLite FTS across all historical runs (future W-013+ concern)
- Real-time search on the live-output terminal (`live-output.js` is display-only; filter bar only applies to `log-viewer.js`)
- Log level parsing that requires understanding stage-specific log formats beyond the standard `[ERROR]`, `[WARN]`, `[INFO]`, `[DEBUG]` prefix convention
- Any changes to how the pipeline itself emits log lines

---

## 2. REST API Design

### `POST /api/logs/search`

Server-side search for large log files. The client calls this endpoint instead of loading all lines when the total line count for a stage exceeds the `LOG_BULK_THRESHOLD` (5,000 lines).

**Request body:**
```json
{
  "runId": "20240310-143022",
  "stage": "implement",
  "iteration": 2,
  "query": "TypeError",
  "isRegex": false,
  "caseSensitive": false,
  "levels": ["error", "warn"],
  "timeStart": "14:30:00",
  "timeEnd": "14:35:00",
  "maxResults": 500
}
```

**Validation rules:**
- `runId` must be a non-empty string matching `[A-Za-z0-9_-]+`; return 400 if not
- `stage` must be a non-empty string; return 400 if not
- `iteration` optional integer >= 1
- `query` must be a string (empty string matches all lines); max 1,000 chars
- `isRegex`: if true, compile `query` as a `RegExp`; if compilation fails return 400 `{ ok: false, error: "Invalid regex: ..." }`
- `levels` optional array; each element must be one of `["error", "warn", "info", "debug"]`
- `timeStart` / `timeEnd` optional `HH:MM:SS` strings; return 400 if format invalid
- `maxResults` optional integer 1-5,000, default 500

**Behavior:**
1. Resolve log file path: `{worcaDir}/results/{runId}/logs/{stage}/iter-{iteration}.log` (or flat `{stage}.log` for legacy runs)
2. If file does not exist, return `{ ok: true, matches: [], totalLines: 0 }`
3. Read file, split on newline, iterate lines
4. For each line, apply filters in order:
   - Level filter: if `levels` non-empty, check line contains `[ERROR]` / `[WARN]` / `[INFO]` / `[DEBUG]` (case-insensitive)
   - Time filter: if `timeStart` or `timeEnd` set, extract `HH:MM:SS` prefix from line; skip lines outside range
   - Query filter: if `query` non-empty, test line against regex (or literal substring if `isRegex` false)
5. Collect up to `maxResults` matched lines as `{ lineNumber: number, text: string }` objects
6. Return `{ ok: true, matches, totalLines, truncated: boolean }`

**Response on success:**
```json
{
  "ok": true,
  "matches": [
    { "lineNumber": 1042, "text": "14:31:22 [ERROR] TypeError: Cannot read property..." }
  ],
  "totalLines": 28430,
  "truncated": false
}
```

**Response on bad regex:**
```json
HTTP 400: { "ok": false, "error": "Invalid regex: Unterminated character class" }
```

---

## 3. Server-Side Filter Module

### New file: `server/log-filter.js`

A pure utility module with no side effects. Imported by `server/app.js` for the REST endpoint.

**Exports:**

`searchLogFile(filePath, { query, isRegex, caseSensitive, levels, timeStart, timeEnd, maxResults })`:
- Opens the file synchronously with `readFileSync` (log files are append-only; no streaming needed for filtered search)
- Builds level pattern set from `levels` array: `{ error: /\[ERROR\]/i, warn: /\[WARN\]/i, info: /\[INFO\]/i, debug: /\[DEBUG\]/i }`
- Parses `timeStart` / `timeEnd` into seconds-since-midnight integers for numeric comparison
- Compiles query into `RegExp` if `isRegex`, otherwise uses `String.prototype.includes` (or case-folded variant if `!caseSensitive`)
- Iterates lines, applies filters, collects matches up to `maxResults + 1` (the +1 detects truncation)
- Returns `{ matches: Array<{lineNumber, text}>, totalLines, truncated }`

`resolveSearchLogPath(worcaDir, runId, stage, iteration)`:
- Mirrors existing `resolveLogPath` / `resolveIterationLogPath` from `log-tailer.js` but resolves against `results/{runId}` (archived run directory)
- Returns the path string (may not exist; caller checks existence)

---

## 4. Frontend Architecture

### State additions to `main.js`

New module-level search/filter state (alongside existing `autoScroll`, `currentLogStage`, etc.):

```javascript
// Search state
let searchQuery = '';
let searchIsRegex = false;
let searchCaseSensitive = false;
let searchWholeWord = false;
let searchMatchIndex = 0;      // current match position (1-based display)
let searchMatchTotal = 0;      // total matches found by SearchAddon

// Filter state
let filterLevels = new Set();  // active level filters: 'error', 'warn', 'info', 'debug'
let filterTimeStart = '';      // 'HH:MM:SS' or ''
let filterTimeEnd = '';        // 'HH:MM:SS' or ''

// Bookmark state
let bookmarks = [];            // Array<{ row: number, marker: object, decoration: object }>
let bookmarkIndex = -1;        // currently focused bookmark index

// Export state
let exportInProgress = false;
```

### Handler functions added to `main.js`

- `handleSearchInput(value)` — updates `searchQuery`, calls `doSearch()`
- `handleSearchOptions({ isRegex, caseSensitive, wholeWord })` — updates option flags, calls `doSearch()`
- `handleSearchNext()` — calls `searchTerminal(...)`, increments `searchMatchIndex`
- `handleSearchPrev()` — calls `searchTerminalPrev(...)`, decrements `searchMatchIndex`
- `handleLevelFilter(level, enabled)` — adds/removes level from `filterLevels`, calls `reloadLogWithFilters()`
- `handleTimeFilter(start, end)` — updates `filterTimeStart/End`, calls `reloadLogWithFilters()`
- `handleToggleBookmark()` — adds/removes bookmark at current xterm.js viewport midpoint via DecorationAddon
- `handleBookmarkNext()` / `handleBookmarkPrev()` — scrolls to next/prev bookmark row
- `handleExportLogs()` — collects rendered terminal lines, strips ANSI codes, triggers Blob download
- `reloadLogWithFilters()` — clears the terminal and re-writes all `state.logLines` through the current filter

### Keyboard shortcut wiring in `main.js`

Add to `window.addEventListener('keydown', ...)`:

```javascript
if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
  const input = document.getElementById('log-search-input');
  if (input) { e.preventDefault(); input.focus(); }
}
```

The `<sl-input>` for search gets `id="log-search-input"`. `Enter` / `Shift+Enter` call `handleSearchNext()` / `handleSearchPrev()` from the input's `@keydown` handler.

---

## 5. Frontend Components

### 5.1 Updated `searchTerminal()` in `log-viewer.js`

Current signature: `searchTerminal(term)` — calls `searchAddon.findNext(term, { incremental: true })`.

New signature: `searchTerminal(term, options = {})`:

```javascript
export function searchTerminal(term, options = {}) {
  if (!searchAddon) return { resultIndex: 0, resultCount: 0 };
  const opts = {
    incremental: options.incremental ?? true,
    regex: options.regex ?? false,
    caseSensitive: options.caseSensitive ?? false,
    wholeWord: options.wholeWord ?? false,
    decorations: {
      matchBackground: '#854d0e',
      matchBorder: '#d97706',
      activeMatchBackground: '#c2410c',
      activeMatchBorder: '#ea580c',
    },
  };
  return searchAddon.findNext(term, opts) || { resultIndex: 0, resultCount: 0 };
}

export function searchTerminalPrev(term, options = {}) {
  if (!searchAddon) return { resultIndex: 0, resultCount: 0 };
  return searchAddon.findPrevious(term, { ...options }) || { resultIndex: 0, resultCount: 0 };
}

export function clearSearch() {
  if (!searchAddon) return;
  searchAddon.clearDecorations();
}
```

The `SearchAddon.findNext` return value contains `resultIndex` and `resultCount` (xterm.js v5+). The match badge in the UI reads these.

### 5.2 Bookmark support in `log-viewer.js`

Load the `@xterm/addon-decoration` addon alongside the existing addons:

```javascript
const [{ Terminal }, { FitAddon }, { SearchAddon }, { DecorationAddon }] = await Promise.all([
  import('xterm'),
  import('@xterm/addon-fit'),
  import('@xterm/addon-search'),
  import('@xterm/addon-decoration'),
]);
```

Add `decorationAddon` to the module-level singleton and include `overviewRulerWidth: 12` in the Terminal constructor options.

New exports:

```javascript
export function addBookmark(row) {
  if (!decorationAddon || !terminal) return null;
  const marker = terminal.registerMarker(row - terminal.buffer.active.viewportY);
  const decoration = decorationAddon.registerDecoration({
    marker,
    backgroundColor: '#1e3a5f',
    foregroundColor: '#93c5fd',
    overviewRulerColor: '#3b82f6',
  });
  return { marker, decoration };
}

export function removeBookmark(decoration) {
  decoration?.dispose();
}

export function scrollToRow(row) {
  if (!terminal) return;
  terminal.scrollToLine(row);
}
```

Bookmarks appear as colored ticks in the xterm.js overview ruler (the scrollbar gutter). The `overviewRulerColor` property controls this.

### 5.3 ANSI stripping for export in `log-viewer.js`

```javascript
const ANSI_STRIP_RE = /\x1b\[[0-9;]*m/g;

export function getTerminalLines() {
  if (!terminal) return [];
  const lines = [];
  const buffer = terminal.buffer.active;
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines;
}

export function exportLogs(filename) {
  const raw = getTerminalLines().join('\n');
  const clean = raw.replace(ANSI_STRIP_RE, '');
  const blob = new Blob([clean], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

### 5.4 Client-side level and time filtering in `log-viewer.js`

A filter function applied before writing each line to the terminal. Exported for use in `main.js` `reloadLogWithFilters()`:

```javascript
const LEVEL_PATTERNS = {
  error: /\[ERROR\]/i,
  warn:  /\[WARN\]/i,
  info:  /\[INFO\]/i,
  debug: /\[DEBUG\]/i,
};

const TIMESTAMP_RE = /(\d{2}):(\d{2}):(\d{2})/;

function toSeconds(hh, mm, ss) {
  return parseInt(hh) * 3600 + parseInt(mm) * 60 + parseInt(ss);
}

export function linePassesFilter(line, { levels, timeStart, timeEnd }) {
  // Level filter: if any levels active, line must match at least one
  if (levels && levels.size > 0) {
    const matchesLevel = [...levels].some(lvl => LEVEL_PATTERNS[lvl]?.test(line));
    if (!matchesLevel) return false;
  }

  // Time filter
  if (timeStart || timeEnd) {
    const m = TIMESTAMP_RE.exec(line);
    if (!m) return !timeStart && !timeEnd;
    const lineSeconds = toSeconds(m[1], m[2], m[3]);
    if (timeStart) {
      const sm = TIMESTAMP_RE.exec(timeStart);
      if (sm && lineSeconds < toSeconds(sm[1], sm[2], sm[3])) return false;
    }
    if (timeEnd) {
      const em = TIMESTAMP_RE.exec(timeEnd);
      if (em && lineSeconds > toSeconds(em[1], em[2], em[3])) return false;
    }
  }

  return true;
}
```

This function is called from `writeLogLine()` — if it returns false, the line is not written to the terminal.

### 5.5 Updated `logViewerView()` in `log-viewer.js`

Extend the function signature to accept new callbacks and state:

```javascript
export function logViewerView(state, {
  onStageFilter, onIterationFilter,
  onSearch, onSearchOptions, onSearchNext, onSearchPrev,
  onLevelFilter, onTimeFilter,
  onToggleBookmark, onBookmarkNext, onBookmarkPrev,
  onExportLogs,
  onToggleAutoScroll,
  autoScroll, stageIterations, runStages,
  searchQuery, searchIsRegex, searchCaseSensitive, searchWholeWord,
  searchMatchIndex, searchMatchTotal,
  filterLevels, filterTimeStart, filterTimeEnd,
  bookmarkCount, exportInProgress,
})
```

The filter bar renders inside `.log-history-body`, below the existing stage/iteration selectors and above the terminal wrapper. It is conditionally shown only when a stage is selected (`hasStageSelected` is true).

**Filter bar HTML structure** (replaces the bare `<sl-input class="log-search">` and auto-scroll button):

```html
<div class="log-filter-bar">

  <!-- Search row -->
  <div class="log-search-row">
    <sl-input
      id="log-search-input"
      class="log-search"
      type="text"
      placeholder="Search logs\u2026"
      size="small"
      clearable
      .value=${searchQuery}
      @sl-input=${(e) => onSearch(e.target.value)}
      @keydown=${(e) => {
        if (e.key === 'Enter' && e.shiftKey) onSearchPrev();
        else if (e.key === 'Enter') onSearchNext();
        else if (e.key === 'Escape') onSearch('');
      }}
    >
      <span slot="prefix">${unsafeHTML(iconSvg(Search, 14))}</span>
    </sl-input>

    ${searchMatchTotal > 0 ? html`
      <sl-badge variant="neutral" pill>${searchMatchIndex} / ${searchMatchTotal}</sl-badge>
    ` : nothing}

    <sl-icon-button
      name="chevron-up"
      title="Previous match (Shift+Enter)"
      ?disabled=${!searchQuery || searchMatchTotal === 0}
      @click=${onSearchPrev}
    ></sl-icon-button>
    <sl-icon-button
      name="chevron-down"
      title="Next match (Enter)"
      ?disabled=${!searchQuery || searchMatchTotal === 0}
      @click=${onSearchNext}
    ></sl-icon-button>

    <sl-tooltip content="Case sensitive">
      <sl-icon-button
        name="type-bold"
        ?data-active=${searchCaseSensitive}
        @click=${() => onSearchOptions({ caseSensitive: !searchCaseSensitive })}
      ></sl-icon-button>
    </sl-tooltip>
    <sl-tooltip content="Whole word">
      <sl-icon-button
        name="alphabet"
        ?data-active=${searchWholeWord}
        @click=${() => onSearchOptions({ wholeWord: !searchWholeWord })}
      ></sl-icon-button>
    </sl-tooltip>
    <sl-tooltip content="Regular expression">
      <sl-icon-button
        name="regex"
        ?data-active=${searchIsRegex}
        @click=${() => onSearchOptions({ isRegex: !searchIsRegex })}
      ></sl-icon-button>
    </sl-tooltip>
  </div>

  <!-- Level + time + bookmark + export row -->
  <div class="log-level-row">
    <span class="log-filter-label">Level:</span>
    ${['error', 'warn', 'info', 'debug'].map(lvl => html`
      <sl-badge
        class="log-level-badge log-level-badge--${lvl} ${filterLevels.has(lvl) ? 'active' : ''}"
        @click=${() => onLevelFilter(lvl, !filterLevels.has(lvl))}
      >${lvl.toUpperCase()}</sl-badge>
    `)}

    <span class="log-filter-label log-filter-label--time">Time:</span>
    <sl-input
      type="text"
      size="small"
      placeholder="HH:MM:SS"
      maxlength="8"
      class="log-time-input"
      .value=${filterTimeStart}
      @sl-change=${(e) => onTimeFilter(e.target.value, filterTimeEnd)}
    ></sl-input>
    <span class="log-filter-sep">\u2013</span>
    <sl-input
      type="text"
      size="small"
      placeholder="HH:MM:SS"
      maxlength="8"
      class="log-time-input"
      .value=${filterTimeEnd}
      @sl-change=${(e) => onTimeFilter(filterTimeStart, e.target.value)}
    ></sl-input>

    <sl-icon-button
      name="bookmark"
      title="Toggle bookmark at current position"
      @click=${onToggleBookmark}
    ></sl-icon-button>
    ${bookmarkCount > 0 ? html`
      <sl-badge variant="primary" pill>${bookmarkCount}</sl-badge>
      <sl-icon-button name="chevron-bar-up" title="Previous bookmark" @click=${onBookmarkPrev}></sl-icon-button>
      <sl-icon-button name="chevron-bar-down" title="Next bookmark" @click=${onBookmarkNext}></sl-icon-button>
    ` : nothing}

    <sl-button
      size="small"
      variant="default"
      class="log-export-btn"
      @click=${onExportLogs}
      ?loading=${exportInProgress}
    >
      ${unsafeHTML(iconSvg(Download, 14))}
      Export
    </sl-button>

    <sl-button
      size="small"
      variant="${autoScroll ? 'primary' : 'default'}"
      @click=${onToggleAutoScroll}
    >
      ${unsafeHTML(iconSvg(autoScroll ? ArrowDown : Pause, 14))}
      ${autoScroll ? 'Auto' : 'Paused'}
    </sl-button>
  </div>

</div>
```

---

## 6. Implementation Tasks

### Task 1: Create `server/log-filter.js`

**Files:**
- Create: `.claude/worca-ui/server/log-filter.js`

Implement the server-side search utility.

**`searchLogFile(filePath, options)`:**
- Import `readFileSync`, `existsSync` from `node:fs`
- Guard: if `!existsSync(filePath)` return `{ matches: [], totalLines: 0, truncated: false }`
- Read file with `readFileSync(filePath, 'utf8')`; split on `\n`; filter empty strings
- Build `queryRe`: if `options.isRegex` compile `new RegExp(options.query, options.caseSensitive ? '' : 'i')`; wrap in try/catch, rethrow as `{ code: 'invalid_regex', message }` for the route handler to catch
- If not regex: use a case-folded `includes` check — fold both `line` and `query` to lowercase when `!caseSensitive`
- Build `levelPat` set from `options.levels` using the `LEVEL_PATTERNS` map (null if levels empty/missing)
- Build `timeRange`: parse `options.timeStart` and `options.timeEnd` into seconds-since-midnight; null if not provided
- Iterate lines with index; apply level filter, then time filter, then query filter
- Push matches as `{ lineNumber: index + 1, text: line }` into accumulator
- Stop iterating after `(options.maxResults || 500) + 1` matches to detect truncation
- Return `{ matches: matches.slice(0, maxResults), totalLines: lines.length, truncated: matches.length > maxResults }`

**`resolveSearchLogPath(worcaDir, runId, stage, iteration)`:**
- Base: `join(worcaDir, 'results', runId)`
- With iteration number: return `join(base, 'logs', stage, 'iter-${iteration}.log')`
- Without iteration: try nested dir `join(base, 'logs', stage)` — if it exists and is a directory, return the dir path; otherwise return `join(base, 'logs', '${stage}.log')`
- Caller determines whether to read the dir vs the file

---

### Task 2: Add `POST /api/logs/search` to `server/app.js`

**Files:**
- Modify: `.claude/worca-ui/server/app.js`

Import at top:
```javascript
import { searchLogFile, resolveSearchLogPath } from './log-filter.js';
```

Add the route after the existing `/api/settings` handlers, before the static-file middleware.

**Route handler body:**

1. Destructure from `req.body`: `runId`, `stage`, `iteration`, `query`, `isRegex`, `caseSensitive`, `levels`, `timeStart`, `timeEnd`, `maxResults`
2. Validate `runId`: must match `/^[A-Za-z0-9_-]+$/` and be non-empty; return 400 with `{ ok: false, error: '...' }` if not
3. Validate `stage`: non-empty string; return 400 if not
4. Validate `query`: string, max 1,000 chars; default to `''`
5. Validate `levels` if present: must be an array; each element in `['error','warn','info','debug']`; return 400 if invalid element
6. Validate `timeStart` / `timeEnd` if present: must match `/^\d{2}:\d{2}:\d{2}$/`; return 400 if malformed
7. Validate `maxResults` if present: coerce to integer, clamp to 1-5000; default 500
8. Call `resolveSearchLogPath(options.worcaDir, runId, stage, iteration)` to get `filePath`
9. Try/catch around `searchLogFile(filePath, { query, isRegex, caseSensitive, levels, timeStart, timeEnd, maxResults })`
   - Catch error with `error.code === 'invalid_regex'`: return HTTP 400 `{ ok: false, error: error.message }`
   - Catch other errors: return HTTP 500 `{ ok: false, error: 'Internal error' }`
10. Return `{ ok: true, matches, totalLines, truncated }` on success

---

### Task 3: Update `log-viewer.js` — Extend Search and Add Utilities

**Files:**
- Modify: `.claude/worca-ui/app/views/log-viewer.js`

**Changes:**

1. Add `decorationAddon` to the module-level singleton variables alongside `terminal`, `fitAddon`, `searchAddon`.

2. In `ensureTerminal`, extend the `Promise.all` import block:
   ```javascript
   const [{ Terminal }, { FitAddon }, { SearchAddon }, { DecorationAddon }] = await Promise.all([
     import('xterm'),
     import('@xterm/addon-fit'),
     import('@xterm/addon-search'),
     import('@xterm/addon-decoration'),
   ]);
   ```

3. Add `overviewRulerWidth: 12` to the Terminal constructor options object.

4. After `terminal.loadAddon(searchAddon)`:
   ```javascript
   decorationAddon = new DecorationAddon();
   terminal.loadAddon(decorationAddon);
   ```

5. Replace the current `searchTerminal(term)` export with the new full-options signature from section 5.1. Add `searchTerminalPrev` and `clearSearch` exports.

6. Add `linePassesFilter(line, { levels, timeStart, timeEnd })` from section 5.4 as an export.

7. Add `addBookmark`, `removeBookmark`, `scrollToRow` exports from section 5.2.

8. Add `getTerminalLines`, `exportLogs` exports from section 5.3, including the `ANSI_STRIP_RE` constant.

9. Update `clearTerminal()` and `disposeTerminal()` to also null and dispose `decorationAddon`:
   ```javascript
   if (decorationAddon) { decorationAddon.dispose?.(); decorationAddon = null; }
   ```

10. Update `writeLogLine(entry)` signature to `writeLogLine(entry, filter = null)`:
    ```javascript
    export function writeLogLine(entry, filter = null) {
      if (!terminal) return;
      const msg = entry.line || entry;
      if (filter && !linePassesFilter(msg, filter)) return;
      const ts = entry.timestamp ? `${DIM}${entry.timestamp}${RESET} ` : '';
      const stage = entry.stage ? `${stageColor(entry.stage)}[${entry.stage.toUpperCase()}]${RESET} ` : '';
      terminal.writeln(`${ts}${stage}${msg}`);
    }
    ```

11. Import `Download` from `../utils/icons.js` at the top of the file (alongside existing icon imports).

12. Replace the existing search input and auto-scroll button in `logViewerView()` with the full filter bar template from section 5.5. Update the function signature to accept all new props.

---

### Task 4: Add `Download` Icon to `utils/icons.js`

**Files:**
- Modify: `.claude/worca-ui/app/utils/icons.js`

Inspect the file first. If a download icon already exists under any name, use that. If not, add:

```javascript
export const Download = `<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />`;
```

This follows the same pattern as existing icons (`Search`, `ArrowDown`, `Pause`, `Star`, `Clock`, `Activity`): a string of SVG `<path>` elements, used by the `iconSvg(icon, size)` helper.

---

### Task 5: Update `main.js` — Search, Filter, Bookmark, and Export State and Handlers

**Files:**
- Modify: `.claude/worca-ui/app/main.js`

**New module-level state variables** (add near existing log viewer state):

```javascript
let searchQuery = '';
let searchIsRegex = false;
let searchCaseSensitive = false;
let searchWholeWord = false;
let searchMatchIndex = 0;
let searchMatchTotal = 0;
let filterLevels = new Set();
let filterTimeStart = '';
let filterTimeEnd = '';
let bookmarks = [];
let bookmarkIndex = -1;
let exportInProgress = false;
```

**New handler functions:**

`handleSearchInput(value)`:
```javascript
function handleSearchInput(value) {
  searchQuery = value;
  if (!value) {
    clearSearch();
    searchMatchIndex = 0;
    searchMatchTotal = 0;
    rerender();
    return;
  }
  const result = searchTerminal(value, {
    regex: searchIsRegex,
    caseSensitive: searchCaseSensitive,
    wholeWord: searchWholeWord,
  });
  searchMatchIndex = (result?.resultIndex ?? 0) + 1;
  searchMatchTotal = result?.resultCount ?? 0;
  rerender();
}
```

`handleSearchOptions(patch)`:
```javascript
function handleSearchOptions(patch) {
  if ('isRegex' in patch) searchIsRegex = patch.isRegex;
  if ('caseSensitive' in patch) searchCaseSensitive = patch.caseSensitive;
  if ('wholeWord' in patch) searchWholeWord = patch.wholeWord;
  handleSearchInput(searchQuery);
}
```

`handleSearchNext()` / `handleSearchPrev()`:
```javascript
function handleSearchNext() {
  if (!searchQuery) return;
  const result = searchTerminal(searchQuery, {
    incremental: false,
    regex: searchIsRegex,
    caseSensitive: searchCaseSensitive,
    wholeWord: searchWholeWord,
  });
  searchMatchIndex = (result?.resultIndex ?? 0) + 1;
  searchMatchTotal = result?.resultCount ?? 0;
  rerender();
}

function handleSearchPrev() {
  if (!searchQuery) return;
  const result = searchTerminalPrev(searchQuery, {
    regex: searchIsRegex,
    caseSensitive: searchCaseSensitive,
    wholeWord: searchWholeWord,
  });
  searchMatchIndex = (result?.resultIndex ?? 0) + 1;
  searchMatchTotal = result?.resultCount ?? 0;
  rerender();
}
```

`handleLevelFilter(level, enabled)`:
```javascript
function handleLevelFilter(level, enabled) {
  if (enabled) filterLevels.add(level);
  else filterLevels.delete(level);
  reloadLogWithFilters();
}
```

`handleTimeFilter(start, end)`:
```javascript
function handleTimeFilter(start, end) {
  filterTimeStart = start;
  filterTimeEnd = end;
  reloadLogWithFilters();
}
```

`reloadLogWithFilters()`:
```javascript
function reloadLogWithFilters() {
  const t = getTerminalInstance();
  if (!t) return;
  t.clear();
  const filter = {
    levels: filterLevels,
    timeStart: filterTimeStart,
    timeEnd: filterTimeEnd,
  };
  for (const entry of state.logLines) {
    writeLogLine(entry, filter);
  }
  rerender();
}
```

`handleToggleBookmark()`:
```javascript
function handleToggleBookmark() {
  const t = getTerminalInstance();
  if (!t) return;
  const currentRow = t.buffer.active.viewportY + Math.floor(t.rows / 2);
  const existingIdx = bookmarks.findIndex(b => b.row === currentRow);
  if (existingIdx >= 0) {
    removeBookmark(bookmarks[existingIdx].decoration);
    bookmarks.splice(existingIdx, 1);
    if (bookmarkIndex >= bookmarks.length) bookmarkIndex = bookmarks.length - 1;
  } else {
    const result = addBookmark(currentRow);
    if (result) {
      bookmarks.push({ row: currentRow, ...result });
      bookmarks.sort((a, b) => a.row - b.row);
      bookmarkIndex = bookmarks.findIndex(b => b.row === currentRow);
    }
  }
  rerender();
}
```

`handleBookmarkNext()` / `handleBookmarkPrev()`:
```javascript
function handleBookmarkNext() {
  if (bookmarks.length === 0) return;
  bookmarkIndex = (bookmarkIndex + 1) % bookmarks.length;
  scrollToRow(bookmarks[bookmarkIndex].row);
  rerender();
}

function handleBookmarkPrev() {
  if (bookmarks.length === 0) return;
  bookmarkIndex = (bookmarkIndex - 1 + bookmarks.length) % bookmarks.length;
  scrollToRow(bookmarks[bookmarkIndex].row);
  rerender();
}
```

`handleExportLogs()`:
```javascript
async function handleExportLogs() {
  exportInProgress = true;
  rerender();
  try {
    const runId = state.selectedRunId || 'unknown';
    const stage = state.currentLogStage || 'all';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    exportLogs(`${runId}-${stage}-${ts}.log`);
  } finally {
    exportInProgress = false;
    rerender();
  }
}
```

**Keyboard shortcut** — add to the existing `keydown` listener or a new one at module init:
```javascript
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    const input = document.getElementById('log-search-input');
    if (input) { e.preventDefault(); input.focus(); }
  }
});
```

**Update imports** at top of `main.js` to include the new exports from `log-viewer.js`:
```javascript
import {
  writeLogLine, clearTerminal, disposeTerminal, mountTerminal,
  writeIterationSeparator, searchTerminal, searchTerminalPrev, clearSearch,
  getTerminalInstance, addBookmark, removeBookmark, scrollToRow, exportLogs,
  linePassesFilter,
} from './views/log-viewer.js';
```

**Update the `rerender()` call** to `logViewerView()` — pass all new state and handlers in the callbacks object.

**Update `writeLogLine` call sites** in main.js (the `log-line` WebSocket handler and `log-bulk` replay loop) to pass the active filter:
```javascript
const filter = {
  levels: filterLevels,
  timeStart: filterTimeStart,
  timeEnd: filterTimeEnd,
};
writeLogLine(entry, filter);
```

**Reset search and filter state** in the stage/run change code path (wherever `clearTerminal()` is called):
```javascript
searchQuery = '';
searchMatchIndex = 0;
searchMatchTotal = 0;
filterLevels = new Set();
filterTimeStart = '';
filterTimeEnd = '';
bookmarks = [];
bookmarkIndex = -1;
```

---

### Task 6: Add Protocol Types for Log Search

**Files:**
- Modify: `.claude/worca-ui/app/protocol.js`

Add `'log-search'` to the `MESSAGE_TYPES` array and the `@typedef` JSDoc:

```javascript
/** @typedef {'subscribe-run'|...|'log-search'} MessageType */

export const MESSAGE_TYPES = [
  ...existing entries...,
  'log-search',
];
```

This documents the reserved type for a future WebSocket-based path on live runs. The REST endpoint used in this implementation does not require a protocol type, but keeping the inventory complete avoids a later collision.

---

### Task 7: Add CSS for Filter Bar

**Files:**
- Modify: `.claude/worca-ui/app/styles.css`

Add styles after the existing `.log-controls` block:

```css
/* Log filter bar */
.log-filter-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px;
  background: rgba(15, 23, 42, 0.6);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.log-search-row,
.log-level-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.log-search-row .log-search {
  flex: 1;
  min-width: 160px;
}

/* Dim option toggle buttons; highlight when active */
.log-search-row sl-icon-button[data-active] {
  color: var(--sl-color-primary-600);
}

.log-filter-label {
  font-size: 11px;
  color: var(--sl-color-neutral-400);
  white-space: nowrap;
}

.log-filter-label--time {
  margin-left: 8px;
}

/* Level filter badges — clickable, color-coded */
.log-level-badge {
  cursor: pointer;
  opacity: 0.4;
  transition: opacity 0.15s;
  user-select: none;
}
.log-level-badge.active { opacity: 1; }

.log-level-badge--error  { --sl-color-neutral-0: #fca5a5; }
.log-level-badge--warn   { --sl-color-neutral-0: #fcd34d; }
.log-level-badge--info   { --sl-color-neutral-0: #93c5fd; }
.log-level-badge--debug  { --sl-color-neutral-0: #d1d5db; }

/* Time range inputs */
.log-time-input {
  width: 84px;
}

.log-filter-sep {
  color: var(--sl-color-neutral-500);
  font-size: 12px;
}

/* Export button pushed to the right */
.log-export-btn {
  margin-left: auto;
}
```

---

### Task 8: Create `server/log-filter.test.js`

**Files:**
- Create: `.claude/worca-ui/server/log-filter.test.js`

Unit tests for `searchLogFile`. Mock `readFileSync` and `existsSync` from `node:fs`.

**Test cases:**

- Returns `{ matches: [], totalLines: 0, truncated: false }` when file does not exist
- Returns all lines when `query` is empty string and no other filters are set
- Finds a literal substring match (case-insensitive by default)
- Respects `caseSensitive: true` — does not match wrong case
- Finds a regex match when `isRegex: true`
- Throws `{ code: 'invalid_regex', message: ... }` for an invalid regex pattern (e.g., `[unclosed`)
- Level filter `['error']` returns only lines containing `[ERROR]`
- Level filter `['error', 'warn']` returns lines with either `[ERROR]` or `[WARN]`
- Level filter `['info']` excludes a line that only contains `[ERROR]`
- Time start filter excludes lines with timestamps before `timeStart`
- Time end filter excludes lines with timestamps after `timeEnd`
- Combined time range: excludes lines outside `[timeStart, timeEnd]`
- Combined query + level + time filter: applies all three correctly
- Lines without a `HH:MM:SS` timestamp are included when no time filter is active
- Lines without a `HH:MM:SS` timestamp are excluded when a time filter is active
- `maxResults` limit: stops collecting after limit; sets `truncated: true`
- `totalLines` always reflects the total non-empty line count regardless of filters
- `resolveSearchLogPath` returns the correct path for a stage with a specific iteration
- `resolveSearchLogPath` returns the correct path for a stage without iteration (flat file fallback)

---

### Task 9: Rebuild Frontend Bundle

**Files:**
- Run the build command in `.claude/worca-ui/`

Before rebuilding, install the decoration addon if it is not already in `package.json`:
```
npm install @xterm/addon-decoration
```

Then run the bundle build (check `package.json` scripts — likely `npm run build` which invokes esbuild). The output `app/main.bundle.js` must be regenerated for all frontend changes to take effect.

---

## 7. Testing Strategy

### Unit Tests

**`server/log-filter.test.js`** (Task 8) covers the server-side filter utility with mocked file I/O (all 18 cases listed above).

### Integration Tests

**`POST /api/logs/search` endpoint** — add to `server/test/settings-api.test.js` or a new sibling file:
- Happy path: valid `runId`, `stage`, `query` — returns `{ ok: true, matches, totalLines, truncated }`
- Invalid regex: returns HTTP 400 with `error` string
- Missing `runId`: returns HTTP 400
- Missing `stage`: returns HTTP 400
- Invalid `levels` element: returns HTTP 400
- Malformed `timeStart`: returns HTTP 400
- Non-existent log file: returns `{ ok: true, matches: [], totalLines: 0 }`
- `maxResults` larger than 5000: clamped, no error

### Manual Testing Checklist

- Open the log viewer for a completed run, select a stage, verify the filter bar renders with all controls
- Type a literal search term; verify xterm.js highlights matches with amber background; badge shows "1 / N"
- Press `Enter` / `Shift+Enter`; verify match navigation moves forward/backward
- Toggle "case sensitive" (type-bold button); re-run search; verify results change appropriately
- Toggle "regex" button; enter a pattern like `err.*:.*Cannot`; verify regex matching works
- Enter an invalid regex like `[unclosed`; verify 0 matches shown (no crash or empty-string fallback)
- Click the `[ERROR]` level badge to activate it; verify only error lines appear in the terminal; click again to deactivate; all lines return
- Click `[ERROR]` and `[WARN]`; verify combined filter works
- Enter `14:30:00` in the start time field; verify earlier lines disappear; clear the field; all lines return
- Enter a valid time range; verify only lines within the range are shown
- Click the bookmark button; verify a navy-highlighted decoration row appears and the scrollbar gutter shows a blue tick
- Navigate bookmarks with the up/down bookmark buttons; verify the terminal scrolls to each bookmarked row
- Click Export; verify a `.log` file downloads; open it and confirm it contains plain text with no ANSI escape codes
- Press `Cmd+F` (or `Ctrl+F`); verify keyboard focus jumps to the search input
- Switch to a different stage; verify search query, filter badges, time fields, and bookmarks all reset to their default/empty states
- For a large archived run (>5,000 lines), open the log viewer; check the browser Network panel to confirm `POST /api/logs/search` is called and results populate correctly

### Edge Cases to Verify

- Empty log file: filter bar renders; export downloads an empty file; search shows 0 matches with no error
- Log lines with no timestamps: time filter silently excludes all such lines; terminal shows empty; no crash
- Very long single log line (exceeds terminal column width): `getTerminalLines()` / `translateToString` handles it; ANSI strip produces clean output
- Rapid level filter toggling: `reloadLogWithFilters` does not queue concurrent rewrites; last write wins
- Run switches mid-search: `disposeTerminal()` clears `decorationAddon`; old decorations do not leak to the new terminal instance
- `@xterm/addon-decoration` import failure (graceful degradation): `addBookmark` returns null; bookmark buttons do not render; rest of the filter bar works normally

---

## 8. File Summary

### New files
| File | Purpose |
|------|---------|
| `.claude/worca-ui/server/log-filter.js` | Server-side log search and filtering utility |
| `.claude/worca-ui/server/log-filter.test.js` | Unit tests for log-filter |

### Modified files
| File | Changes |
|------|---------|
| `.claude/worca-ui/server/app.js` | Add `POST /api/logs/search` route; import `log-filter.js` |
| `.claude/worca-ui/app/views/log-viewer.js` | Extend `searchTerminal` options; add `searchTerminalPrev`, `clearSearch`, `linePassesFilter`, `addBookmark`, `removeBookmark`, `scrollToRow`, `getTerminalLines`, `exportLogs`; load `DecorationAddon`; update `writeLogLine` filter arg; update `logViewerView` signature and filter bar template |
| `.claude/worca-ui/app/utils/icons.js` | Add `Download` icon constant |
| `.claude/worca-ui/app/main.js` | Add search/filter/bookmark/export state and handlers; update `rerender()` to pass new props; update `writeLogLine` calls to pass filter; reset state on stage/run change; add `Cmd+F` keyboard shortcut |
| `.claude/worca-ui/app/protocol.js` | Add `'log-search'` to `MESSAGE_TYPES` |
| `.claude/worca-ui/app/styles.css` | Add filter bar, level badge, time input, and export button styles |
| `.claude/worca-ui/app/main.bundle.js` | Rebuilt from source after all changes |

---

## 9. Rollout Order

Tasks should be implemented in this order due to dependencies:

1. **Task 4** (Download icon in `icons.js`) — one-line addition, no dependencies; unblocks Task 3 template work
2. **Task 1** (`server/log-filter.js`) — pure server module, no frontend dependency; foundation for Task 2
3. **Task 8** (`server/log-filter.test.js`) — depends on Task 1; write and run immediately after
4. **Task 2** (REST endpoint in `app.js`) — depends on Task 1
5. **Task 6** (`protocol.js` types) — small, independent; can be done at any point
6. **Task 3** (`log-viewer.js` extensions) — depends on Task 4; the core frontend change
7. **Task 5** (`main.js` state and handlers) — depends on Task 3; wires everything together
8. **Task 7** (CSS) — depends on Tasks 3 and 5 so the full HTML structure is settled
9. **Task 9** (bundle rebuild) — final step; run `npm install @xterm/addon-decoration && npm run build` once all source changes are complete
