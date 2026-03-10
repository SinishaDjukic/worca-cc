# W-018: Run Annotations


**Goal:** Give users the ability to annotate historical runs with tags, free-text notes, and a pin flag so that "Run abc123" becomes "auth migration, rolled back — hotfix" searchable and sortable across the full run list.

**Architecture:** A new `server/annotations.js` module handles reading and writing per-run annotation files at `.worca/annotations/{run_id}.json`. Two new WebSocket message types (`get-annotation`, `set-annotation`) carry annotation data. The `discoverRuns` watcher merges annotation data into each run object before broadcasting so all existing consumers (run list, run card, run detail) receive it. On the frontend, `run-card.js` shows tags and the pin indicator inline, `run-detail.js` gains a collapsible annotation editor panel, and `run-list.js` gains a tag filter bar and text search input. Auto-tagging runs on annotation creation by extracting keywords from `work_request.title`.

**Tech Stack:** Node.js `fs` (read/write JSON), lit-html, Shoelace `<sl-tag>`, `<sl-input>`, `<sl-textarea>`, `<sl-badge>`, `<sl-icon-button>`, `<sl-tooltip>`, `<sl-details>`, existing WebSocket infrastructure.

**Depends on:** Nothing new — builds on the existing `server/watcher.js` `discoverRuns`, `server/ws.js` message handling, and `app/protocol.js` `MESSAGE_TYPES` pattern from W-000.

---

## 1. Scope and Boundaries

### In scope
- `server/annotations.js` — read/write `.worca/annotations/{run_id}.json`
- `server/watcher.js` — merge annotation data into discovered runs
- `server/ws.js` — `get-annotation` and `set-annotation` WebSocket message handlers
- `app/protocol.js` — add new message types
- `app/views/run-detail.js` — annotation editor panel (tags, notes, pin toggle)
- `app/views/run-card.js` — display tags and pin indicator
- `app/views/run-list.js` — tag filter bar + text search input
- `app/main.js` — annotation state, send/receive handlers, filter state
- Auto-tagging from `work_request.title` on first annotation write
- CSS for all new UI elements

### Out of scope
- Full-text search of run logs (W-012)
- REST API endpoints for annotations (WebSocket is sufficient for this single-user tool)
- Annotation history / versioning
- Shared annotations across multiple users
- Annotation templates or presets

---

## 2. Annotation Storage Format

### File location

```
.worca/
  annotations/
    {run_id}.json
```

One file per run. The `run_id` is the same value produced by `createRunId(status)` in `server/watcher.js` (a 12-character hex hash or the `run_id` field from `status.json`). Directory is created on first write with `mkdirSync(..., { recursive: true })`.

### Schema

```json
{
  "run_id": "abc123def456",
  "tags": ["auth", "hotfix", "rolled-back"],
  "notes": "Auth migration attempt. Rolled back because flaky integration tests on CI. See issue #42.",
  "pinned": true,
  "created_at": "2026-03-10T14:32:00.000Z",
  "updated_at": "2026-03-10T15:01:22.000Z"
}
```

**Field rules:**
- `run_id` — string, matches the run's computed ID (stored for self-description)
- `tags` — array of lowercase strings, max 20 tags per run, each tag max 32 characters, only `[a-z0-9-_]` characters allowed
- `notes` — string, max 4,000 characters, arbitrary UTF-8 text
- `pinned` — boolean, default `false`
- `created_at` — ISO 8601 timestamp, set once on first write
- `updated_at` — ISO 8601 timestamp, updated on every write

### Merge into run objects

`discoverRuns` in `server/watcher.js` is extended to accept an optional `annotationsDir` path. After building the run list it reads the annotation file for each run (if it exists) and merges it under an `annotation` key:

```json
{
  "id": "abc123def456",
  "active": false,
  "started_at": "...",
  "work_request": { "title": "Add auth migration" },
  "stages": { ... },
  "annotation": {
    "tags": ["auth", "hotfix"],
    "notes": "Rolled back due to flaky tests",
    "pinned": true,
    "updated_at": "2026-03-10T15:01:22.000Z"
  }
}
```

If no annotation file exists, `annotation` is `null` (not omitted, so the frontend can distinguish "never annotated" from "loading").

---

## 3. WebSocket API

### `get-annotation`

Fetch the current annotation for a run. Returns the annotation object or `null` if none exists yet.

**Request:**
```json
{ "id": "req-1", "type": "get-annotation", "payload": { "runId": "abc123def456" } }
```

**Response (found):**
```json
{
  "id": "req-1", "ok": true, "type": "get-annotation",
  "payload": {
    "runId": "abc123def456",
    "annotation": { "tags": ["auth"], "notes": "...", "pinned": false, "updated_at": "..." }
  }
}
```

**Response (not found):**
```json
{ "id": "req-1", "ok": true, "type": "get-annotation", "payload": { "runId": "abc123def456", "annotation": null } }
```

**Validation:** `payload.runId` must be a non-empty string. Returns `makeError` with `bad_request` if missing.

### `set-annotation`

Write or update the annotation for a run. Partial updates are merged with existing data (you can send only `{ "pinned": true }` to toggle the pin without clearing tags or notes).

**Request:**
```json
{
  "id": "req-2", "type": "set-annotation",
  "payload": {
    "runId": "abc123def456",
    "tags": ["auth", "hotfix"],
    "notes": "Rolled back due to flaky tests.",
    "pinned": true
  }
}
```

**Validation rules (server-enforced):**
- `payload.runId` — required, non-empty string
- `payload.tags` — if present, must be an array; each element must match `/^[a-z0-9_-]{1,32}$/`; max 20 elements; duplicates are deduplicated
- `payload.notes` — if present, must be a string with length <= 4,000
- `payload.pinned` — if present, must be a boolean

**Response on success:**
```json
{
  "id": "req-2", "ok": true, "type": "set-annotation",
  "payload": {
    "runId": "abc123def456",
    "annotation": { "tags": ["auth", "hotfix"], "notes": "...", "pinned": true, "updated_at": "..." }
  }
}
```

After a successful write, the server broadcasts `annotation-updated` to all connected clients:
```json
{
  "id": "evt-...", "ok": true, "type": "annotation-updated",
  "payload": { "runId": "abc123def456", "annotation": { ... } }
}
```

This lets other open tabs update immediately without waiting for a file-watcher cycle.

---

## 4. Auto-Tagging

When `set-annotation` is called for a run that has **no existing annotation file** (first write only), the server automatically extracts candidate tags from `work_request.title` using the run's `status.json` and prepends them to whatever tags the user supplied.

**Extraction algorithm** (implemented in `annotations.js`):

```javascript
function autoTagsFromTitle(title) {
  if (!title) return [];
  const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'with', 'add', 'fix', 'update', 'implement', 'create', 'remove', 'refactor']);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')      // strip non-slug chars
    .split(/\s+/)
    .map(w => w.replace(/\s+/g, '-'))
    .filter(w => w.length >= 3 && w.length <= 32 && !STOP_WORDS.has(w))
    .slice(0, 5);                         // at most 5 auto tags
}
```

The auto-tags are merged with any user-supplied tags (user tags take precedence; duplicates deduplicated). The result is stored in the annotation file as the initial tag set. On subsequent writes, auto-tagging does not run.

The server must resolve the run's `work_request.title` at write time by reading the run's `status.json`. The `run_id` in the annotation payload maps to a file at `.worca/runs/{run_id}/status.json` or `.worca/results/{run_id}/status.json` (same lookup logic as `discoverRuns`).

---

## 5. Frontend Design

### 5.1 Run Card — tags and pin indicator

`run-card.js` is updated to render annotation data when `run.annotation` is present.

**Pin indicator:** A small filled pin icon (`<sl-icon name="pin-fill">` or an inline SVG from `icons.js`) appears at the top-right corner of the card when `run.annotation?.pinned === true`.

**Tags strip:** Below the stage badges row, if `run.annotation?.tags?.length > 0`, render a flex row of `<sl-badge variant="neutral" pill class="run-card-tag">` elements for each tag.

**Card ordering:** Pinned runs are sorted to the top of the run list in `run-list.js`. Within the pinned group and within the unpinned group, runs remain sorted by `started_at` descending (most recent first).

### 5.2 Run Detail — annotation editor panel

In `run-detail.js`, a new `annotationPanelView(run, annotation, callbacks)` function renders a `<sl-details>` panel positioned immediately after the `run-info-section` div and before the `stage-panels` div.

**Panel header:** "Annotations" with a tag count badge (`2 tags`) and a note indicator (a small note icon if `notes` is non-empty). The panel is collapsed by default unless the run has existing annotations, in which case it opens.

**Panel body contents:**

1. **Tags editor:**
   - A flex-wrap row of existing tags rendered as `<sl-tag removable size="small">` elements. Clicking the remove button emits the tag removal.
   - An inline `<sl-input size="small" placeholder="Add tag..." maxlength="32">` at the end of the row. On Enter or blur (if non-empty), the value is validated client-side (`/^[a-z0-9_-]{1,32}$/`) and sent via `set-annotation`.
   - If the input value fails validation, a small error message appears inline.

2. **Notes editor:**
   - A `<sl-textarea label="Notes" rows="3" maxlength="4000" placeholder="Add notes about this run...">` with the current notes value.
   - An autosave debounce of 1,500 ms: after the user stops typing, `set-annotation` is sent automatically. A subtle "Saved" indicator appears for 2 seconds after a successful save.

3. **Pin toggle:**
   - A `<sl-switch>` labeled "Pin to top of history". Toggling immediately sends `set-annotation` with `{ pinned: !current }`.

**Callbacks accepted by `annotationPanelView`:**
- `onSetAnnotation({ tags?, notes?, pinned? })` — called for all mutation operations

### 5.3 Run List — filter bar and search

`run-list.js` is updated to accept a `filterState` object and `onFilterChange` callback from `main.js`.

**Filter bar layout** (rendered above the run cards):

```
[ Search: [_______________] ]  [ Tag: [all v] [auth x] [hotfix x] ]  [ Pinned only: [ ] ]
```

- **Text search input:** `<sl-input size="small" placeholder="Search runs..." clearable>` — filters on `work_request.title`, `work_request.description`, and `annotation.notes` (case-insensitive substring match, client-side only).
- **Active tag filter chips:** When a tag is selected for filtering, it appears as a removable chip. Clicking a tag chip on a run card adds it to the active filter.
- **"Pinned only" toggle:** `<sl-switch size="small">` — when active, only runs with `annotation.pinned === true` are shown.
- **Clear all filters link:** Shown when any filter is active. Resets everything.

**Filtering logic (client-side, in `run-list.js`):**

```javascript
function applyFilters(runs, filterState) {
  let result = runs;
  if (filterState.pinnedOnly) {
    result = result.filter(r => r.annotation?.pinned === true);
  }
  if (filterState.activeTags.length > 0) {
    result = result.filter(r =>
      filterState.activeTags.every(tag => r.annotation?.tags?.includes(tag))
    );
  }
  if (filterState.searchText.trim()) {
    const q = filterState.searchText.toLowerCase();
    result = result.filter(r =>
      (r.work_request?.title || '').toLowerCase().includes(q) ||
      (r.work_request?.description || '').toLowerCase().includes(q) ||
      (r.annotation?.notes || '').toLowerCase().includes(q)
    );
  }
  // Pinned runs first, then by started_at descending
  return result.sort((a, b) => {
    const pa = a.annotation?.pinned ? 1 : 0;
    const pb = b.annotation?.pinned ? 1 : 0;
    if (pb !== pa) return pb - pa;
    return (b.started_at || '').localeCompare(a.started_at || '');
  });
}
```

**Clickable tags:** Clicking a tag chip on a run card calls `onTagClick(tag)` which adds the tag to `filterState.activeTags` and navigates to `#/history` if not already there.

---

## 6. Implementation Tasks

### Task 1: Create `server/annotations.js`

**Files:**
- Create: `.claude/worca-ui/server/annotations.js`

This module encapsulates all annotation file I/O. It has no dependencies on Express or WebSocket.

**Exports:**

`readAnnotation(annotationsDir, runId)`:
- Reads `{annotationsDir}/{runId}.json`
- Returns the parsed object on success, or `null` if the file does not exist or is malformed
- Wraps all fs calls in try/catch

`writeAnnotation(annotationsDir, runId, patch, existingAnnotation)`:
- `patch` is a partial object with any subset of `{ tags, notes, pinned }`
- `existingAnnotation` is the result of a prior `readAnnotation` (may be `null` for first write)
- Merges patch into existing (existing fields not in patch are preserved)
- Generates `created_at` on first write (when `existingAnnotation` is null), always updates `updated_at`
- Validates: tags array items match `/^[a-z0-9_-]{1,32}$/`, max 20 after dedup; notes string max 4,000 chars; pinned is boolean
- Throws a descriptive `Error` on validation failure (caught by the ws handler)
- Calls `mkdirSync(annotationsDir, { recursive: true })` before writing
- Writes with `writeFileSync` using `JSON.stringify(data, null, 2) + '\n'`
- Returns the final written object

`autoTagsFromTitle(title)`:
- Pure function, exported for testing
- Implementation as described in section 4

`mergeAutoTags(existingAnnotation, title, userTags)`:
- If `existingAnnotation` is non-null (file already existed), returns `userTags` unchanged
- If `existingAnnotation` is null (first write), computes `autoTagsFromTitle(title)`, prepends auto tags to `userTags`, deduplicates, returns result capped at 20

---

### Task 2: Extend `server/watcher.js` to Merge Annotations

**Files:**
- Modify: `.claude/worca-ui/server/watcher.js`

Update `discoverRuns(worcaDir)` signature to `discoverRuns(worcaDir, annotationsDir = null)`.

After the full runs array is assembled, if `annotationsDir` is provided, iterate over the runs and attach annotation data:

```javascript
if (annotationsDir) {
  for (const run of runs) {
    run.annotation = readAnnotation(annotationsDir, run.id);
  }
}
```

Import `readAnnotation` from `./annotations.js`.

**Changes to `server/ws.js`:**

The existing call to `discoverRuns(worcaDir)` in `scheduleRefresh()` and in message handlers must pass `annotationsDir`. In `ws.js`, derive `annotationsDir` from `worcaDir`:

```javascript
const annotationsDir = join(worcaDir, 'annotations');
```

Pass it in all `discoverRuns` calls:
```javascript
discoverRuns(worcaDir, annotationsDir)
```

---

### Task 3: Add `get-annotation` and `set-annotation` Handlers to `server/ws.js`

**Files:**
- Modify: `.claude/worca-ui/server/ws.js`

Add imports at the top:
```javascript
import { readAnnotation, writeAnnotation, mergeAutoTags, autoTagsFromTitle } from './annotations.js';
```

Derive `annotationsDir` once after `worcaDir`:
```javascript
const annotationsDir = join(worcaDir, 'annotations');
```

**Handler: `get-annotation`**

```javascript
if (req.type === 'get-annotation') {
  const { runId } = req.payload || {};
  if (!runId || typeof runId !== 'string') {
    ws.send(JSON.stringify(makeError(req, 'bad_request', 'payload.runId required')));
    return;
  }
  const annotation = readAnnotation(annotationsDir, runId);
  ws.send(JSON.stringify(makeOk(req, { runId, annotation })));
  return;
}
```

**Handler: `set-annotation`**

```javascript
if (req.type === 'set-annotation') {
  const { runId, tags, notes, pinned } = req.payload || {};
  if (!runId || typeof runId !== 'string') {
    ws.send(JSON.stringify(makeError(req, 'bad_request', 'payload.runId required')));
    return;
  }
  const patch = {};
  if (tags !== undefined) patch.tags = tags;
  if (notes !== undefined) patch.notes = notes;
  if (pinned !== undefined) patch.pinned = pinned;

  // Resolve work_request.title for auto-tagging (only needed on first write)
  const existing = readAnnotation(annotationsDir, runId);
  if (existing === null && patch.tags !== undefined) {
    const runs = discoverRuns(worcaDir);
    const run = runs.find(r => r.id === runId);
    const title = run?.work_request?.title || '';
    patch.tags = mergeAutoTags(existing, title, patch.tags);
  }

  let annotation;
  try {
    annotation = writeAnnotation(annotationsDir, runId, patch, existing);
  } catch (err) {
    ws.send(JSON.stringify(makeError(req, 'validation_error', err.message)));
    return;
  }

  ws.send(JSON.stringify(makeOk(req, { runId, annotation })));
  // Broadcast so other tabs update immediately
  broadcast('annotation-updated', { runId, annotation });
  // Also trigger a runs-list refresh so pinned order updates
  scheduleRefresh();
  return;
}
```

---

### Task 4: Update `app/protocol.js`

**Files:**
- Modify: `.claude/worca-ui/app/protocol.js`

Add to the `MESSAGE_TYPES` array:
- `'get-annotation'`
- `'set-annotation'`
- `'annotation-updated'`

Update the `@typedef` JSDoc string to include these three new types.

---

### Task 5: Add Annotation State to `app/main.js`

**Files:**
- Modify: `.claude/worca-ui/app/main.js`

**New module-level state:**

```javascript
// Annotation editor state
let annotationCache = {};        // { [runId]: annotation | null }
let annotationSavePending = {};  // { [runId]: boolean }
let annotationSaveTimer = null;  // debounce timer ref

// Run list filter state
let runFilter = {
  searchText: '',
  activeTags: [],
  pinnedOnly: false,
};
```

**New handler functions:**

`handleGetAnnotation(runId)`:
- Sends `{ type: 'get-annotation', payload: { runId } }` via the existing ws client
- On response: stores result in `annotationCache[runId]`, calls `rerender()`

`handleSetAnnotation(runId, patch)`:
- Merges `patch` into `annotationCache[runId]` optimistically for instant UI feedback, calls `rerender()`
- Sends `{ type: 'set-annotation', payload: { runId, ...patch } }` via ws
- On response: stores the server-confirmed annotation in `annotationCache[runId]`, calls `rerender()`
- On error: reverts optimistic update, shows error

`handleSetAnnotationDebounced(runId, patch)`:
- Used for the notes textarea autosave
- Clears `annotationSaveTimer`, merges into `annotationCache` immediately, sets a 1,500 ms timer that calls `handleSetAnnotation`

`handleAnnotationUpdated(payload)`:
- WebSocket event handler for `annotation-updated` broadcasts from other tabs
- Stores `payload.annotation` in `annotationCache[payload.runId]`, calls `rerender()`

`handleTagFilterClick(tag)`:
- Adds `tag` to `runFilter.activeTags` if not already present
- Navigates to `#/history` if current route is not history
- Calls `rerender()`

`handleFilterChange(filterPatch)`:
- Merges `filterPatch` into `runFilter`, calls `rerender()`

**In `rerender()`:**
- When rendering `runDetailView`, look up `annotationCache[selectedRunId]` and pass it as `annotation`
- When rendering `runListView`, pass `runFilter` and `onFilterChange`, `onTagClick` callbacks
- Fetch annotation if viewing a run detail and `annotationCache[selectedRunId] === undefined` (not yet loaded): call `handleGetAnnotation(selectedRunId)`

**WebSocket event registration** (alongside existing `ws.on` calls):
```javascript
ws.on('annotation-updated', (payload) => {
  handleAnnotationUpdated(payload);
});
```

---

### Task 6: Add `annotationPanelView` to `app/views/run-detail.js`

**Files:**
- Modify: `.claude/worca-ui/app/views/run-detail.js`

Add new imports:
```javascript
import { Tag, Pin, FileText as NoteIcon } from '../utils/icons.js';
```

**New function `annotationPanelView(runId, annotation, callbacks)`:**

`annotation` is the value from `annotationCache` — it may be `undefined` (not yet loaded), `null` (loaded, no annotation exists), or an object.

`callbacks` shape:
```javascript
{
  onAddTag: (runId, tag) => void,
  onRemoveTag: (runId, tag) => void,
  onNotesChange: (runId, notes) => void,  // debounced
  onTogglePin: (runId, pinned) => void,
}
```

**Template (abbreviated):**

```javascript
function annotationPanelView(runId, annotation, callbacks) {
  const tags = annotation?.tags || [];
  const notes = annotation?.notes || '';
  const pinned = annotation?.pinned || false;
  const hasContent = tags.length > 0 || notes.length > 0 || pinned;

  return html`
    <sl-details class="annotation-panel" ?open=${hasContent}>
      <div slot="summary" class="annotation-panel-header">
        <span class="annotation-panel-icon">${unsafeHTML(iconSvg(Tag, 14))}</span>
        <span class="annotation-panel-label">Annotations</span>
        ${tags.length > 0 ? html`<sl-badge variant="neutral" pill class="annotation-tag-count">${tags.length}</sl-badge>` : nothing}
        ${notes.length > 0 ? html`<span class="annotation-note-indicator">${unsafeHTML(iconSvg(NoteIcon, 12))}</span>` : nothing}
        ${pinned ? html`<span class="annotation-pin-indicator">${unsafeHTML(iconSvg(Pin, 12))}</span>` : nothing}
      </div>

      <div class="annotation-panel-body">
        ${annotation === undefined ? html`<div class="annotation-loading">Loading...</div>` : html`
          <div class="annotation-tags-section">
            <div class="annotation-tags-row">
              ${tags.map(tag => html`
                <sl-tag size="small" removable @sl-remove=${() => callbacks.onRemoveTag(runId, tag)}>
                  ${tag}
                </sl-tag>
              `)}
              <sl-input
                class="annotation-tag-input"
                size="small"
                placeholder="Add tag..."
                maxlength="32"
                @keydown=${(e) => {
                  if (e.key === 'Enter') {
                    const val = e.target.value.trim().toLowerCase();
                    if (/^[a-z0-9_-]{1,32}$/.test(val)) {
                      callbacks.onAddTag(runId, val);
                      e.target.value = '';
                    }
                  }
                }}
              ></sl-input>
            </div>
          </div>

          <div class="annotation-notes-section">
            <sl-textarea
              label="Notes"
              rows="3"
              maxlength="4000"
              placeholder="Add notes about this run..."
              .value=${notes}
              @sl-input=${(e) => callbacks.onNotesChange(runId, e.target.value)}
            ></sl-textarea>
          </div>

          <div class="annotation-pin-section">
            <sl-switch
              .checked=${pinned}
              @sl-change=${(e) => callbacks.onTogglePin(runId, e.target.checked)}
            >
              Pin to top of history
            </sl-switch>
          </div>
        `}
      </div>
    </sl-details>
  `;
}
```

**Update `runDetailView` signature:**

```javascript
export function runDetailView(run, settings = {}, options = {})
```

`options` gains two new fields:
- `options.annotation` — the annotation object (from `annotationCache`)
- `options.annotationCallbacks` — the callbacks object

Inside the function, after the `run-info-section` div and before the `stage-panels` div, insert:

```javascript
${annotationPanelView(run.id, options.annotation, options.annotationCallbacks || {})}
```

---

### Task 7: Update `app/views/run-card.js` to Show Tags and Pin

**Files:**
- Modify: `.claude/worca-ui/app/views/run-card.js`

Add imports for icons (Pin, Tag) from `../utils/icons.js`.

Update `runCardView(run, { onClick, onTagClick } = {})` to accept an `onTagClick` callback.

**Pin indicator:** Inside `.run-card-top`, after the title span, conditionally render:
```javascript
${run.annotation?.pinned ? html`<span class="run-card-pin">${unsafeHTML(iconSvg(Pin, 12))}</span>` : nothing}
```

**Tags strip:** After the `.run-card-stages` div, add:
```javascript
${run.annotation?.tags?.length > 0 ? html`
  <div class="run-card-tags">
    ${run.annotation.tags.map(tag => html`
      <sl-badge
        variant="neutral" pill class="run-card-tag"
        @click=${onTagClick ? (e) => { e.stopPropagation(); onTagClick(tag); } : null}
      >${tag}</sl-badge>
    `)}
  </div>
` : nothing}
```

---

### Task 8: Update `app/views/run-list.js` with Filter Bar and Search

**Files:**
- Modify: `.claude/worca-ui/app/views/run-list.js`

Update function signature:
```javascript
export function runListView(runs, filter, { onSelectRun, onTagClick, onFilterChange, runFilter = {} })
```

**Add `applyFilters(runs, runFilter)` function** (as described in section 5.3) at the top of the file.

**Add `filterBarView(runFilter, onFilterChange)` function:**

```javascript
function filterBarView(runFilter, onFilterChange) {
  const hasFilters = runFilter.searchText || runFilter.activeTags?.length > 0 || runFilter.pinnedOnly;
  return html`
    <div class="run-list-filter-bar">
      <sl-input
        class="run-list-search"
        size="small"
        placeholder="Search runs..."
        clearable
        .value=${runFilter.searchText || ''}
        @sl-input=${(e) => onFilterChange({ searchText: e.target.value })}
        @sl-clear=${() => onFilterChange({ searchText: '' })}
      ></sl-input>

      <div class="run-list-tag-filters">
        ${(runFilter.activeTags || []).map(tag => html`
          <sl-tag size="small" removable @sl-remove=${() => onFilterChange({
            activeTags: runFilter.activeTags.filter(t => t !== tag)
          })}>${tag}</sl-tag>
        `)}
      </div>

      <sl-switch
        size="small"
        .checked=${runFilter.pinnedOnly || false}
        @sl-change=${(e) => onFilterChange({ pinnedOnly: e.target.checked })}
      >Pinned only</sl-switch>

      ${hasFilters ? html`
        <button class="run-list-clear-filters" @click=${() => onFilterChange({
          searchText: '', activeTags: [], pinnedOnly: false
        })}>Clear filters</button>
      ` : nothing}
    </div>
  `;
}
```

In the main `runListView` body, render the filter bar first (for the history/completed filter only — not for the active runs view), then apply `applyFilters` before rendering run cards.

---

### Task 9: Add CSS for All New Elements

**Files:**
- Modify: `.claude/worca-ui/app/styles.css`

**Annotation panel:**
```css
.annotation-panel {
  margin-bottom: var(--sl-spacing-medium);
  border: 1px solid var(--sl-color-neutral-200);
  border-radius: var(--sl-border-radius-medium);
}
.annotation-panel-header {
  display: flex;
  align-items: center;
  gap: var(--sl-spacing-x-small);
  font-weight: 500;
}
.annotation-panel-icon { color: var(--sl-color-neutral-500); }
.annotation-tag-count { font-size: 0.7rem; }
.annotation-note-indicator,
.annotation-pin-indicator { color: var(--sl-color-warning-600); }
.annotation-panel-body {
  display: flex;
  flex-direction: column;
  gap: var(--sl-spacing-medium);
  padding-top: var(--sl-spacing-small);
}
.annotation-tags-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sl-spacing-x-small);
}
.annotation-tag-input {
  width: 120px;
  flex-shrink: 0;
}
.annotation-pin-section {
  display: flex;
  align-items: center;
}
.annotation-save-indicator {
  font-size: 0.75rem;
  color: var(--sl-color-success-600);
  margin-left: var(--sl-spacing-small);
}
```

**Run card tags and pin:**
```css
.run-card-pin {
  margin-left: auto;
  color: var(--sl-color-warning-500);
}
.run-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: var(--sl-spacing-x-small);
}
.run-card-tag {
  cursor: pointer;
  font-size: 0.7rem;
}
.run-card-tag:hover {
  filter: brightness(0.9);
}
```

**Filter bar:**
```css
.run-list-filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sl-spacing-small);
  padding: var(--sl-spacing-small) 0 var(--sl-spacing-medium);
  border-bottom: 1px solid var(--sl-color-neutral-200);
  margin-bottom: var(--sl-spacing-medium);
}
.run-list-search {
  min-width: 200px;
}
.run-list-tag-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.run-list-clear-filters {
  background: none;
  border: none;
  color: var(--sl-color-primary-600);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0 4px;
  text-decoration: underline;
}
```

---

### Task 10: Add Unit Tests for `server/annotations.js`

**Files:**
- Create: `.claude/worca-ui/server/annotations.test.js`

**Tests to cover:**

`readAnnotation`:
- Returns `null` for a non-existent file
- Returns `null` for a malformed JSON file (does not throw)
- Returns parsed object for a valid file

`writeAnnotation`:
- First write: sets `created_at` and `updated_at`, stores correct data
- Subsequent write: preserves `created_at`, updates `updated_at`, merges fields
- Partial patch: fields not in patch are preserved from existing
- Validation: rejects tag with invalid chars (e.g. `"has space"`)
- Validation: rejects tag longer than 32 chars
- Validation: deduplicates tags
- Validation: caps tags at 20 after dedup
- Validation: rejects notes longer than 4,000 chars
- Validation: rejects non-boolean `pinned`
- Creates annotations directory if it does not exist

`autoTagsFromTitle`:
- Returns empty array for empty/null title
- Filters stop words
- Filters words shorter than 3 chars
- Returns max 5 tags
- Lowercases and slugifies

`mergeAutoTags`:
- When `existingAnnotation` is non-null: returns `userTags` unchanged
- When `existingAnnotation` is null: prepends auto tags, deduplicates

Use Node.js built-in `assert` and a temp dir from `os.tmpdir()` for I/O tests (matching the pattern in `server/preferences.test.js`).

---

### Task 11: Rebuild Frontend Bundle

**Files:**
- Run: the existing bundle build step

After all frontend `.js` changes, rebuild `app/main.bundle.js`. Check `package.json` for the build command (likely `npx esbuild app/main.js --bundle --outfile=app/main.bundle.js`). The bundle must be regenerated since the app serves `main.bundle.js` as the static entry point.

---

## 7. Testing Strategy

### Unit tests

`server/annotations.test.js` (Task 10) covers all server-side logic.

### Manual testing checklist

**Annotation creation:**
- Open any completed run in the detail view
- Expand the Annotations panel — it should be collapsed with no content initially
- Type a tag in the input and press Enter — tag appears as a chip
- Type in the notes area — "Saved" indicator appears after 1.5 seconds of inactivity
- Toggle the "Pin to top of history" switch — card immediately moves to top of history list

**Auto-tagging:**
- Create a fresh annotation for a run whose `work_request.title` is "Add user authentication"
- Send only `{ tags: ["custom"] }` — verify the returned tags include auto-extracted words like "user", "authentication", "custom"
- Make a second save — verify auto-tags do not re-run (custom edits preserved)

**Tag management:**
- Add three tags — all appear as chips
- Click remove on a chip — it disappears immediately
- Try to add a tag with a space in it — input should not accept it or show validation error

**Run card:**
- Pinned run shows the pin icon on its card
- Tags appear as small badges on the card below stage badges
- Clicking a tag badge navigates to history with that tag pre-selected in the filter bar

**Filter bar:**
- Type "auth" in search — only runs with "auth" in title, description, or notes appear
- Select a tag filter — only runs with that tag appear
- Enable "Pinned only" — only pinned runs appear
- Combine search + tag + pinned filters — all three applied simultaneously
- Click "Clear filters" — all runs reappear

**Real-time sync:**
- Open two browser tabs on the same run
- Annotate in tab 1 — tab 2 should update within seconds via `annotation-updated` broadcast

**Persistence:**
- Annotate a run, restart the server, reload the page — annotations survive

### Edge cases to verify

- Run with no `work_request.title` — auto-tagging returns empty array, does not crash
- Annotation file deleted externally — UI falls back to empty state gracefully
- 20-tag limit — 21st tag is rejected server-side with a clear error message
- 4,000-character note limit — textarea enforces maxlength client-side; server enforces it server-side
- Rapidly toggling pin — optimistic update prevents flicker; server confirms final state
- Active (in-progress) run — annotation panel is available; does not interfere with live status updates

---

## 8. File Summary

### New files

| File | Purpose |
|------|---------|
| `.claude/worca-ui/server/annotations.js` | Read/write `.worca/annotations/{run_id}.json`, auto-tag extraction |
| `.claude/worca-ui/server/annotations.test.js` | Unit tests for the annotations module |

### Modified files

| File | Changes |
|------|---------|
| `.claude/worca-ui/server/watcher.js` | Accept `annotationsDir` param, merge annotation into each run object |
| `.claude/worca-ui/server/ws.js` | Derive `annotationsDir`; pass it to `discoverRuns`; add `get-annotation` and `set-annotation` handlers; broadcast `annotation-updated` |
| `.claude/worca-ui/app/protocol.js` | Add `'get-annotation'`, `'set-annotation'`, `'annotation-updated'` to `MESSAGE_TYPES` |
| `.claude/worca-ui/app/main.js` | Add `annotationCache`, `runFilter` state; add handlers for get/set annotation, filter changes, tag clicks; register `annotation-updated` ws event; pass annotation props to `runDetailView` and `runListView` |
| `.claude/worca-ui/app/views/run-detail.js` | Add `annotationPanelView`; insert panel between run-info-section and stage-panels; accept `annotation` and `annotationCallbacks` in `options` |
| `.claude/worca-ui/app/views/run-card.js` | Show pin icon and tags strip; accept `onTagClick` callback |
| `.claude/worca-ui/app/views/run-list.js` | Add `filterBarView`; add `applyFilters` with sort by pin; accept filter state and callbacks; pass `onTagClick` to `runCardView` |
| `.claude/worca-ui/app/styles.css` | Add styles for annotation panel, tag chips, pin indicator, filter bar |
| `.claude/worca-ui/app/main.bundle.js` | Rebuilt from source after all changes |

---

## 9. Rollout Order

Tasks depend on each other as follows:

1. **Task 1** (`annotations.js`) — foundation, no dependencies
2. **Task 10** (unit tests for `annotations.js`) — depends on Task 1; write tests immediately after the module
3. **Task 2** (extend `watcher.js`) — depends on Task 1
4. **Task 3** (ws handlers) — depends on Tasks 1 and 2
5. **Task 4** (`protocol.js`) — small, independent; do it alongside Task 3
6. **Task 5** (`main.js` state and handlers) — depends on Tasks 3 and 4
7. **Task 6** (`run-detail.js` annotation panel) — depends on Task 5
8. **Task 7** (`run-card.js` tags and pin) — depends on Task 5
9. **Task 8** (`run-list.js` filter bar) — depends on Tasks 5 and 7
10. **Task 9** (CSS) — after all view changes settled
11. **Task 11** (rebuild bundle) — final step
