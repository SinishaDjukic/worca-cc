# W-004: Work Request Queue


**Goal:** Allow users to enqueue multiple work requests and have the pipeline process them sequentially without manual intervention between runs. A persistent queue file tracks pending, in-progress, and completed items with priority ordering. New CLI flags (`--queue`, `--from-beads`) load the queue and drain it. The worca-ui dashboard gains a queue panel showing queue depth, current item, and per-item status.

**Architecture:** A new `QueueManager` class in `.claude/worca/orchestrator/queue.py` owns all queue state. It reads and writes `.worca/queue.json` atomically. A new top-level CLI entry point `.claude/scripts/run_queue.py` calls `QueueManager.drain()`, which iterates the queue and calls the existing `run_pipeline()` for each item. Failure handling is configurable: `--on-failure skip` (default) or `--on-failure halt`. The worca-ui server exposes `GET /api/queue` and the existing WebSocket file-watcher picks up queue changes automatically (no new watcher needed — queue.json lives in `.worca/`).

**Tech Stack:** Python 3.8+ stdlib (`json`, `fcntl` for atomic writes, `dataclasses`), existing `run_pipeline` / `WorkRequest` / `normalize` machinery, Express REST API, lit-html, Shoelace components, existing WebSocket broadcast infrastructure.

**Depends on:** None — W-004 is self-contained and depends only on the existing pipeline runner.

---

## 1. Scope and Boundaries

### In scope

- `.worca/queue.json` — persistent queue file format with items, priorities, and status
- `QueueManager` class — enqueue, dequeue, reorder, mark items as done/failed, drain
- `run_queue.py` — new CLI entry point that populates and drains the queue
- `--queue <refs...>` — accept a list of prompt strings, gh:issue:N refs, bd:IDs, or spec paths
- `--from-beads` — pull all `bd ready` issues into the queue sorted by beads priority
- `--priority N` — override priority for items added via `--queue` (integer, lower = higher priority)
- `--on-failure skip|halt` — skip failed items and continue (default), or stop the queue
- `GET /api/queue` — REST endpoint returning current queue state for the UI
- WebSocket `queue-changed` broadcast when queue.json changes
- Queue panel in the sidebar with item count badge
- Queue detail view in worca-ui: pending list, current item, completed/failed items
- Unit tests for `QueueManager` and `GET /api/queue`

### Out of scope

- Parallel queue processing (items always run sequentially — W-002 covers parallelism)
- Queue editing from the UI (add/remove/reorder items via the dashboard)
- Recurring or cron-scheduled queues
- Queue items that span multiple projects
- Authentication or authorization
- Persisting queue history beyond the current `.worca/queue.json` file

---

## 2. Queue Persistence Format

### File: `.worca/queue.json`

Written and read by `QueueManager`. Updated after every item transitions state. The runner holds a file lock during writes to prevent corruption if the UI server reads simultaneously.

```json
{
  "version": 1,
  "created_at": "2026-03-10T12:00:00Z",
  "updated_at": "2026-03-10T12:05:32Z",
  "on_failure": "skip",
  "items": [
    {
      "id": "q-001",
      "source_type": "github_issue",
      "source_ref": "gh:42",
      "title": "Add user authentication",
      "description": "",
      "priority": 1,
      "status": "completed",
      "run_id": "20260310-120000",
      "added_at": "2026-03-10T12:00:00Z",
      "started_at": "2026-03-10T12:00:01Z",
      "completed_at": "2026-03-10T12:05:32Z",
      "error": null
    },
    {
      "id": "q-002",
      "source_type": "prompt",
      "source_ref": null,
      "title": "Add logging",
      "description": "Add logging",
      "priority": 2,
      "status": "in_progress",
      "run_id": "20260310-120533",
      "added_at": "2026-03-10T12:00:00Z",
      "started_at": "2026-03-10T12:05:33Z",
      "completed_at": null,
      "error": null
    },
    {
      "id": "q-003",
      "source_type": "beads",
      "source_ref": "bd:bd-abc",
      "title": "Fix login redirect",
      "description": "",
      "priority": 3,
      "status": "pending",
      "run_id": null,
      "added_at": "2026-03-10T12:00:00Z",
      "started_at": null,
      "completed_at": null,
      "error": null
    }
  ]
}
```

**Item status values:**
- `pending` — waiting to run
- `in_progress` — currently being processed by `run_pipeline()`
- `completed` — `run_pipeline()` returned without raising
- `failed` — `run_pipeline()` raised an exception; `error` field contains the message
- `skipped` — item was already completed in a prior queue run (idempotency)

**Priority ordering:** items are sorted ascending by `priority` then by `added_at` (FIFO within the same priority). Priority 1 runs before priority 2, etc. The `--from-beads` flag maps beads priority labels to integers: P1=1, P2=2, P3=3, P4=4.

**Idempotency:** before adding an item, `QueueManager.enqueue()` checks whether an item with the same `source_ref` (or same `title` for prompt items) already exists with `status != "pending"`. If so, it skips adding a duplicate.

---

## 3. CLI Interface

### New entry point: `.claude/scripts/run_queue.py`

```
usage: run_queue.py [--queue REF [REF ...]] [--from-beads]
                    [--priority N] [--on-failure skip|halt]
                    [--settings PATH] [--status-dir PATH]
                    [--msize 1-10] [--mloops 1-10]
                    [--resume-queue] [--dry-run]
```

**Argument semantics:**

`--queue REF [REF ...]`
Each REF is interpreted identically to `run_pipeline.py --source`/`--prompt`:
- Starts with `gh:issue:` → GitHub issue
- Starts with `bd:` → Beads task
- Ends with `.md` and file exists → spec file
- Otherwise → plain text prompt

`--from-beads`
Calls `bd_ready()` and enqueues all returned items sorted by their beads priority field. Mutually exclusive with `--queue`.

`--priority N`
Integer (1–10). Assigns this priority to all items added in this invocation via `--queue`. Ignored when `--from-beads` is used (priority comes from beads).

`--on-failure skip|halt`
`skip` (default): log the failure, mark item as `failed`, continue to next item.
`halt`: mark item as `failed`, stop draining, exit with code 1.

`--resume-queue`
Do not clear or re-add items. Resume draining from the first `pending` item in the existing `queue.json`. Useful when a queue run was interrupted.

`--dry-run`
Print the resolved queue order without running any pipelines. Exits with code 0.

`--msize`, `--mloops`, `--settings`, `--status-dir`
Passed through to each `run_pipeline()` call unchanged.

**Example invocations:**

```bash
# Queue three items and run them
python .claude/scripts/run_queue.py \
  --queue gh:issue:42 gh:issue:55 "Add logging"

# Pull all ready beads issues and run them
python .claude/scripts/run_queue.py --from-beads

# Queue a high-priority item alongside beads
python .claude/scripts/run_queue.py \
  --queue "Critical hotfix" --priority 1

# Resume a previously interrupted queue
python .claude/scripts/run_queue.py --resume-queue

# Halt on first failure
python .claude/scripts/run_queue.py --from-beads --on-failure halt

# Preview queue order without running
python .claude/scripts/run_queue.py --from-beads --dry-run
```

**Exit codes:**
- `0` — all items completed (or dry-run succeeded)
- `1` — one or more items failed (with `--on-failure skip`) or queue halted due to failure
- `2` — queue initialization error (bad args, beads unavailable, etc.)

---

## 4. QueueManager Design

### Class: `QueueManager`

Located at `.claude/worca/orchestrator/queue.py`.

```python
class QueueManager:
    def __init__(self, queue_path: str = ".worca/queue.json"): ...

    def load(self) -> dict: ...
    def save(self, queue: dict) -> None: ...  # atomic write with fcntl lock

    def enqueue(self, items: list[WorkRequest], priority: int = 2,
                on_failure: str = "skip") -> dict: ...
    # Returns updated queue dict. Deduplicates by source_ref/title.

    def enqueue_from_beads(self, on_failure: str = "skip") -> dict: ...
    # Calls bd_ready(), maps priority labels, calls enqueue().

    def next_pending(self, queue: dict) -> dict | None: ...
    # Returns the highest-priority pending item, or None if queue is drained.

    def mark_in_progress(self, queue: dict, item_id: str,
                         run_id: str | None = None) -> dict: ...

    def mark_completed(self, queue: dict, item_id: str, run_id: str) -> dict: ...

    def mark_failed(self, queue: dict, item_id: str, error: str) -> dict: ...

    def drain(self, queue: dict,
              settings_path: str = ".claude/settings.json",
              status_path: str = ".worca/status.json",
              on_failure: str = "skip",
              msize: int = 1,
              mloops: int = 1) -> list[dict]: ...
    # Main loop. Returns list of result dicts (one per item processed).
```

**Atomic write strategy:** `save()` writes to `queue.json.tmp` then calls `os.replace()` (atomic on POSIX). A file lock via `fcntl.flock(fd, fcntl.LOCK_EX)` is held during the write. The UI server reads `queue.json` read-only; no lock needed on the read path.

**`drain()` loop pseudocode:**
```
results = []
while True:
    queue = load()
    item = next_pending(queue)
    if item is None:
        break
    queue = mark_in_progress(queue, item["id"])
    save(queue)
    work_request = item_to_work_request(item)
    try:
        status = run_pipeline(work_request, ...)
        run_id = status.get("run_id")
        queue = load()
        queue = mark_completed(queue, item["id"], run_id)
        save(queue)
        results.append({"item_id": item["id"], "run_id": run_id, "status": "completed"})
    except (PipelineError, LoopExhaustedError, PipelineInterrupted) as e:
        queue = load()
        queue = mark_failed(queue, item["id"], str(e))
        save(queue)
        results.append({"item_id": item["id"], "error": str(e), "status": "failed"})
        if on_failure == "halt":
            raise QueueHaltedError(f"Queue halted: {e}") from e
return results
```

Note: `load()` is called fresh at the start of each loop iteration so that external modifications (e.g., a user editing `queue.json` manually) are picked up. `run_pipeline()` already manages its own `status.json` lifecycle; `QueueManager.drain()` only tracks the queue-level outcome.

---

## 5. Failure Handling

### `--on-failure skip` (default)

When `run_pipeline()` raises any exception (`PipelineError`, `LoopExhaustedError`, `PipelineInterrupted`, or unexpected `Exception`), the item is marked `failed` with the error message. Draining continues with the next pending item. The final exit code is `1` if any items failed.

A `consecutive_failures` counter is maintained. If it reaches the circuit breaker limit (configurable under `worca.queue.circuit_breaker_limit` in `settings.json`, default `3`), draining stops even with `--on-failure skip`. This prevents runaway failures from burning API budget. The circuit breaker raises `QueueCircuitBreakerError`.

### `--on-failure halt`

The first failure marks the item as `failed` and immediately stops. The queue is left in its current state. The user can fix the issue and re-run with `--resume-queue` to continue from the next pending item.

### `PipelineInterrupted` (SIGTERM/SIGINT)

When the queue runner receives SIGTERM or SIGINT (propagated from the subprocess), the currently running item is marked `failed` with `error="interrupted"`. The drain loop exits and the queue is saved. On next `--resume-queue`, that item will be retried (its status is `failed`, not `in_progress`, so it is not retried automatically — it must be manually reset to `pending` or re-added).

### Stale `in_progress` detection

On queue load, if any item has `status == "in_progress"` but no active pipeline is running (check `.worca/pipeline.pid` for liveness), the item is reset to `pending`. This handles crashes where the runner died without updating the queue.

---

## 6. REST API

### `GET /api/queue`

Returns the current queue state from `.worca/queue.json`.

**Response:**
```json
{
  "ok": true,
  "queue": {
    "version": 1,
    "created_at": "...",
    "updated_at": "...",
    "on_failure": "skip",
    "items": [ ... ]
  }
}
```

Returns `{ "ok": true, "queue": null }` if `queue.json` does not exist (no queue has been started).

Returns HTTP 500 on read errors.

### WebSocket `queue-changed` event

The existing watcher in `server/watcher.js` watches the `.worca/` directory for file changes. When `queue.json` changes, the watcher broadcasts a `queue-changed` message to all connected clients with the updated queue payload. This requires:

1. Adding `queue.json` to the watcher's watch set (or watching the whole `.worca/` directory, which the watcher already does).
2. Adding a `'queue-changed'` handler to the client WebSocket dispatcher.

No additional polling is needed.

---

## 7. UI: Queue Status Display

### 7.1 Sidebar queue badge

Add a "Queue" section to the sidebar between "Pipeline" and the settings footer. Show the count of pending items as a badge.

```html
<div class="sidebar-section">
  <div class="sidebar-section-header">Queue</div>
  <div class="sidebar-item ${route.section === 'queue' ? 'active' : ''}"
       @click=${() => onNavigate('queue')}>
    <span class="sidebar-item-left">
      ${unsafeHTML(iconSvg(ListOrdered, 16))}
      <span>Work Queue</span>
    </span>
    ${pendingCount > 0
      ? html`<sl-badge variant="warning" pill>${pendingCount}</sl-badge>`
      : ''}
  </div>
</div>
```

The `pendingCount` is derived from `state.queue.items.filter(i => i.status === 'pending').length`.

### 7.2 Queue view: `app/views/queue.js`

A new lit-html view function `queueView(state, { onNavigate })` rendered when `route.section === 'queue'`.

**Layout:**
```
┌─ Queue Status ─────────────────────────────────────────┐
│  3 pending  ·  1 in progress  ·  5 completed  ·  0 failed │
├─────────────────────────────────────────────────────────┤
│  IN PROGRESS                                             │
│  ● gh:issue:55  Add user authentication   [P1]  running  │
├─────────────────────────────────────────────────────────┤
│  PENDING (3)                                             │
│  ○ "Add logging"                          [P2]  pending  │
│  ○ bd:bd-abc  Fix login redirect          [P3]  pending  │
│  ○ gh:issue:61  Improve error messages    [P3]  pending  │
├─────────────────────────────────────────────────────────┤
│  COMPLETED (5)  ▸ (collapsed by default)                │
└─────────────────────────────────────────────────────────┘
```

Each in-progress item links to the active run detail. Each completed item links to its historical run (if `run_id` is set). Failed items show the error message inline.

### 7.3 State integration

Add `queue: null` to the initial state in `app/state.js`. The `queue-changed` WebSocket event updates `state.queue`. The `GET /api/queue` REST call on initial page load populates it.

---

## 8. Implementation Tasks

### Task 1: Create `QueueManager` in `.claude/worca/orchestrator/queue.py`

**Files:**
- Create: `.claude/worca/orchestrator/queue.py`

Implement the full `QueueManager` class as described in Section 4.

**Detailed requirements:**

`__init__(self, queue_path)`:
- Store `queue_path`; no I/O at construction time.

`load(self) -> dict`:
- If `queue.json` does not exist, return a fresh empty queue dict:
  ```python
  {"version": 1, "created_at": now_iso(), "updated_at": now_iso(),
   "on_failure": "skip", "items": []}
  ```
- Read and `json.load()` the file.
- Run stale `in_progress` recovery: for each item with `status == "in_progress"`, check if `.worca/pipeline.pid` refers to a live process. If not, reset to `pending`.

`save(self, queue: dict) -> None`:
- Update `queue["updated_at"]` to current UTC ISO.
- Write to `queue_path + ".tmp"` then `os.replace()`.
- Use `fcntl.flock` for exclusive lock during write on POSIX. On Windows (no `fcntl`), skip locking with a comment.

`enqueue(self, items, priority, on_failure)`:
- Set `queue["on_failure"] = on_failure`.
- For each WorkRequest: compute dedup key (`source_ref` if set, else `title`). Skip if an item with the same key exists and `status != "pending"`.
- Append new items with `id = f"q-{uuid4().hex[:6]}"`, `status = "pending"`, `priority = priority`, `added_at = now_iso()`, all other timestamps `None`.
- Call `save()` and return updated queue.

`enqueue_from_beads(self, on_failure)`:
- Call `bd_ready()` from `worca.utils.beads`.
- Map priority: P1→1, P2→2, P3→3, P4→4, unknown→2.
- Build `WorkRequest` list using `normalize_beads_task()` for each item.
- Call `enqueue()` with the appropriate priority per item (each item gets its own priority).
- Return updated queue.

`next_pending(self, queue) -> dict | None`:
- Filter items with `status == "pending"`.
- Sort by `(priority, added_at)` ascending.
- Return first, or `None` if empty.

`mark_in_progress(self, queue, item_id, run_id=None) -> dict`:
- Find item by `id`. Set `status = "in_progress"`, `started_at = now_iso()`, optionally `run_id`.
- Return updated queue (caller must call `save()`).

`mark_completed(self, queue, item_id, run_id) -> dict`:
- Find item. Set `status = "completed"`, `completed_at = now_iso()`, `run_id = run_id`, `error = None`.

`mark_failed(self, queue, item_id, error) -> dict`:
- Find item. Set `status = "failed"`, `completed_at = now_iso()`, `error = str(error)`.

`drain(self, queue, settings_path, status_path, on_failure, msize, mloops) -> list`:
- Implement the drain loop as described in Section 4.
- Maintain `consecutive_failures` counter; read circuit breaker limit from `settings.json` at `worca.queue.circuit_breaker_limit` (default 3).
- Catch `PipelineInterrupted` separately and re-raise after marking item failed (so the caller's signal handler can exit gracefully).

Also define:
```python
class QueueHaltedError(Exception): ...
class QueueCircuitBreakerError(Exception): ...
```

Helper `_item_to_work_request(item: dict) -> WorkRequest`:
- Reconstruct a `WorkRequest` from a queue item dict without re-fetching from GitHub/Beads (title and description are stored in the item).

---

### Task 2: Create `run_queue.py` CLI entry point

**Files:**
- Create: `.claude/scripts/run_queue.py`

**Argument parsing:**

```python
parser = argparse.ArgumentParser(description="Run a queue of work requests")
group = parser.add_mutually_exclusive_group(required=True)
group.add_argument("--queue", nargs="+", metavar="REF",
                   help="One or more work request refs or prompts")
group.add_argument("--from-beads", action="store_true",
                   help="Enqueue all bd ready issues")
group.add_argument("--resume-queue", action="store_true",
                   help="Resume draining an existing queue")
parser.add_argument("--priority", type=int, default=2,
                    choices=range(1, 11), metavar="[1-10]",
                    help="Priority for --queue items (default: 2)")
parser.add_argument("--on-failure", choices=["skip", "halt"],
                    default="skip",
                    help="Failure handling strategy (default: skip)")
parser.add_argument("--settings", default=".claude/settings.json")
parser.add_argument("--status-dir", default=".worca")
parser.add_argument("--msize", type=int, default=1,
                    choices=range(1, 11), metavar="[1-10]")
parser.add_argument("--mloops", type=int, default=1,
                    choices=range(1, 11), metavar="[1-10]")
parser.add_argument("--dry-run", action="store_true",
                    help="Print queue order without running pipelines")
```

**`main()` logic:**

1. Build `queue_path = os.path.join(args.status_dir, "queue.json")`.
2. Instantiate `qm = QueueManager(queue_path)`.
3. If `--resume-queue`: load existing queue, validate it has pending items (error and exit 2 if none).
4. If `--from-beads`: call `qm.enqueue_from_beads(on_failure=args.on_failure)`.
5. If `--queue`: for each REF, call `normalize()` with auto-detection:
   - `gh:issue:N` → `normalize("source", ref)`
   - `bd:*` → `normalize("source", ref)`
   - `*.md` and file exists → `normalize("spec", ref)`
   - Otherwise → `normalize("prompt", ref)`
   - Collect into a `WorkRequest` list. Call `qm.enqueue(requests, priority=args.priority, on_failure=args.on_failure)`.
6. If `--dry-run`: load queue, print items in drain order (priority, then added_at), exit 0.
7. Otherwise: call `qm.drain(queue, settings_path=args.settings, status_path=os.path.join(args.status_dir, "status.json"), on_failure=args.on_failure, msize=args.msize, mloops=args.mloops)`.
8. Print summary: `"Queue complete: N completed, M failed"`.
9. Exit code: 0 if no failures, 1 if any failures.
10. Catch `QueueHaltedError` → print message, exit 1.
11. Catch `QueueCircuitBreakerError` → print message, exit 1.
12. Catch `Exception` → print traceback, exit 2.

---

### Task 3: Add `GET /api/queue` to `server/app.js`

**Files:**
- Modify: `.claude/worca-ui/server/app.js`

**Change:** After the existing `POST /api/settings` handler and before the static file middleware, add:

```javascript
// GET /api/queue
app.get('/api/queue', (_req, res) => {
  if (!options.worcaDir) {
    return res.status(501).json({ ok: false, error: 'worcaDir not configured' });
  }
  const queuePath = join(options.worcaDir, 'queue.json');
  if (!existsSync(queuePath)) {
    return res.json({ ok: true, queue: null });
  }
  try {
    const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
    res.json({ ok: true, queue });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

Add `import { existsSync, readFileSync } from 'node:fs'` and `import { join } from 'node:path'` at the top if not already present (they likely are from the watcher import).

Update `createApp(options)` signature to accept `{ settingsPath, worcaDir }`. The `worcaDir` is already passed in W-009; confirm it is threaded through from `server/index.js`.

---

### Task 4: Add `queue-changed` WebSocket broadcast in `server/ws.js`

**Files:**
- Modify: `.claude/worca-ui/server/ws.js`
- Modify: `.claude/worca-ui/app/protocol.js`

**In `server/ws.js`:**

The existing file watcher fires on changes to `.worca/`. Add a handler that detects changes to `queue.json` specifically and broadcasts `queue-changed`:

Locate the section where the watcher emits file-change events (look for `chokidar` or `fs.watch` usage). In the change handler, add a condition:

```javascript
if (changedPath.endsWith('queue.json')) {
  const queuePath = changedPath;
  try {
    const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
    broadcast('queue-changed', { queue });
  } catch {
    broadcast('queue-changed', { queue: null });
  }
}
```

**In `app/protocol.js`:**

Add `'queue-changed'` to the `MESSAGE_TYPES` array.

---

### Task 5: Add queue state to `app/state.js`

**Files:**
- Modify: `.claude/worca-ui/app/state.js`

**Change:** Add `queue: null` to the initial state object. This field holds the parsed `queue.json` content or `null` if no queue file exists.

```javascript
const initialState = {
  runs: {},
  queue: null,       // <-- add this
  preferences: { ... },
  // ...
};
```

---

### Task 6: Fetch initial queue state on page load in `app/main.js`

**Files:**
- Modify: `.claude/worca-ui/app/main.js`

**Changes:**

After the initial `fetch('/api/settings')` call (or alongside it in parallel using `Promise.all`), add:

```javascript
fetch('/api/queue')
  .then(r => r.json())
  .then(data => {
    if (data.ok) store.setState({ queue: data.queue });
  })
  .catch(() => {});
```

Register a WebSocket handler for `queue-changed`:

```javascript
ws.on('queue-changed', (payload) => {
  store.setState({ queue: payload.queue });
});
```

Add navigation handler for the queue section:

```javascript
// In the route/navigation section
case 'queue':
  // render queueView
  break;
```

Pass `queue: state.queue` into the queue view rendering call.

---

### Task 7: Create `app/views/queue.js`

**Files:**
- Create: `.claude/worca-ui/app/views/queue.js`

**Exported function:** `queueView(state, { onNavigate })`

**Template structure:**

```javascript
import { html } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, ListOrdered, CircleCheck, CircleAlert, Clock } from '../utils/icons.js';

export function queueView(state, { onNavigate } = {}) {
  const queue = state.queue;

  if (!queue) {
    return html`
      <div class="queue-view">
        <div class="empty-state">
          <p>No queue active.</p>
          <p>Run <code>run_queue.py --queue ... </code> or
             <code>run_queue.py --from-beads</code> to start a queue.</p>
        </div>
      </div>
    `;
  }

  const items = queue.items || [];
  const pending = items.filter(i => i.status === 'pending');
  const inProgress = items.filter(i => i.status === 'in_progress');
  const completed = items.filter(i => i.status === 'completed');
  const failed = items.filter(i => i.status === 'failed');

  return html`
    <div class="queue-view">
      <div class="queue-stats-bar">
        <span class="queue-stat queue-stat--pending">${pending.length} pending</span>
        <span class="queue-stat queue-stat--active">${inProgress.length} in progress</span>
        <span class="queue-stat queue-stat--done">${completed.length} completed</span>
        <span class="queue-stat queue-stat--failed">${failed.length} failed</span>
        <span class="queue-stat queue-stat--policy">on-failure: ${queue.on_failure}</span>
      </div>

      ${inProgress.length > 0 ? html`
        <div class="queue-section">
          <div class="queue-section-title">In Progress</div>
          ${inProgress.map(item => queueItemView(item, { onNavigate }))}
        </div>
      ` : ''}

      ${pending.length > 0 ? html`
        <div class="queue-section">
          <div class="queue-section-title">Pending (${pending.length})</div>
          ${pending.map(item => queueItemView(item, { onNavigate }))}
        </div>
      ` : ''}

      ${failed.length > 0 ? html`
        <div class="queue-section">
          <div class="queue-section-title queue-section-title--failed">Failed (${failed.length})</div>
          ${failed.map(item => queueItemView(item, { onNavigate }))}
        </div>
      ` : ''}

      ${completed.length > 0 ? html`
        <details class="queue-section queue-section--collapsible">
          <summary class="queue-section-title">Completed (${completed.length})</summary>
          ${completed.map(item => queueItemView(item, { onNavigate }))}
        </details>
      ` : ''}
    </div>
  `;
}

function queueItemView(item, { onNavigate }) {
  const statusIcon = {
    pending: html`<span class="queue-item-dot queue-item-dot--pending"></span>`,
    in_progress: html`<span class="queue-item-dot queue-item-dot--active queue-item-dot--pulse"></span>`,
    completed: html`<span class="queue-item-dot queue-item-dot--done"></span>`,
    failed: html`<span class="queue-item-dot queue-item-dot--failed"></span>`,
  }[item.status] || '';

  const clickable = item.run_id && (item.status === 'completed' || item.status === 'in_progress');

  return html`
    <div class="queue-item queue-item--${item.status}"
         @click=${clickable ? () => onNavigate('run', item.run_id) : null}
         style="${clickable ? 'cursor:pointer' : ''}">
      ${statusIcon}
      <div class="queue-item-body">
        <div class="queue-item-title">${item.title}</div>
        ${item.source_ref ? html`<div class="queue-item-ref">${item.source_ref}</div>` : ''}
        ${item.error ? html`<div class="queue-item-error">${item.error}</div>` : ''}
      </div>
      <sl-badge variant="neutral" class="queue-item-priority">P${item.priority}</sl-badge>
    </div>
  `;
}
```

---

### Task 8: Update sidebar to show queue badge in `app/views/sidebar.js`

**Files:**
- Modify: `.claude/worca-ui/app/views/sidebar.js`

**Change:** Import a new icon (`ListOrdered` or equivalent from `../utils/icons.js`). Add a queue section after the existing Pipeline section:

```javascript
const queue = state.queue;
const pendingCount = queue ? (queue.items || []).filter(i => i.status === 'pending').length : 0;
const inProgressCount = queue ? (queue.items || []).filter(i => i.status === 'in_progress').length : 0;

// In the sidebar template, after the Pipeline section:
html`
  <div class="sidebar-section">
    <div class="sidebar-section-header">Queue</div>
    <div class="sidebar-item ${route.section === 'queue' ? 'active' : ''}"
         @click=${() => onNavigate('queue')}>
      <span class="sidebar-item-left">
        ${unsafeHTML(iconSvg(ListOrdered, 16))}
        <span>Work Queue</span>
      </span>
      ${inProgressCount > 0
        ? html`<sl-badge variant="primary" pill>${inProgressCount}</sl-badge>`
        : pendingCount > 0
          ? html`<sl-badge variant="warning" pill>${pendingCount}</sl-badge>`
          : ''}
    </div>
  </div>
`
```

Update `sidebarView(state, route, connectionState, { onNavigate })` to accept `state` (it currently accesses `state.runs` and `state.preferences`; add access to `state.queue`).

---

### Task 9: Wire queue view into routing in `app/main.js`

**Files:**
- Modify: `.claude/worca-ui/app/main.js`

**Changes:**

Import `queueView`:
```javascript
import { queueView } from './views/queue.js';
```

In the `rerender()` function's content switch (where it dispatches on `route.section`), add a `'queue'` case:
```javascript
case 'queue':
  contentHtml = queueView(state, { onNavigate: handleNavigate });
  break;
```

In `handleNavigate(section, runId)`, add `'queue'` to the valid sections list so it updates `route.section = 'queue'` and rerenders.

---

### Task 10: Add CSS for queue view in `app/styles.css`

**Files:**
- Modify: `.claude/worca-ui/app/styles.css`

Add styles for:

```css
/* Queue view */
.queue-view { padding: var(--space-4); }

.queue-stats-bar {
  display: flex; gap: var(--space-3); flex-wrap: wrap;
  margin-bottom: var(--space-4);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-2);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}
.queue-stat { color: var(--text-muted); }
.queue-stat--pending { color: var(--color-warning); }
.queue-stat--active { color: var(--color-primary); }
.queue-stat--done { color: var(--color-success); }
.queue-stat--failed { color: var(--color-error); }

.queue-section { margin-bottom: var(--space-4); }
.queue-section-title {
  font-size: var(--text-xs); font-weight: 600; text-transform: uppercase;
  color: var(--text-muted); letter-spacing: 0.05em;
  margin-bottom: var(--space-2); padding-bottom: var(--space-1);
  border-bottom: 1px solid var(--border-color);
}
.queue-section-title--failed { color: var(--color-error); }
.queue-section--collapsible > summary { cursor: pointer; list-style: none; }
.queue-section--collapsible > summary::before { content: '▸ '; }
.queue-section--collapsible[open] > summary::before { content: '▾ '; }

.queue-item {
  display: flex; align-items: flex-start; gap: var(--space-3);
  padding: var(--space-3); border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  margin-bottom: var(--space-2);
  background: var(--surface-1);
  transition: background 0.15s;
}
.queue-item:hover { background: var(--surface-2); }
.queue-item--failed { border-color: var(--color-error-muted); }

.queue-item-dot {
  width: 10px; height: 10px; border-radius: 50%;
  margin-top: 4px; flex-shrink: 0;
}
.queue-item-dot--pending { background: var(--color-warning-muted); border: 2px solid var(--color-warning); }
.queue-item-dot--active { background: var(--color-primary); }
.queue-item-dot--pulse { animation: pulse 1.5s infinite; }
.queue-item-dot--done { background: var(--color-success); }
.queue-item-dot--failed { background: var(--color-error); }

@keyframes pulse {
  0%, 100% { opacity: 1; } 50% { opacity: 0.4; }
}

.queue-item-body { flex: 1; min-width: 0; }
.queue-item-title { font-size: var(--text-sm); font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.queue-item-ref { font-size: var(--text-xs); color: var(--text-muted); margin-top: 2px; }
.queue-item-error { font-size: var(--text-xs); color: var(--color-error); margin-top: 4px; font-family: monospace; }
.queue-item-priority { flex-shrink: 0; }
```

---

### Task 11: Write unit tests for `QueueManager`

**Files:**
- Create: `.claude/worca/orchestrator/test_queue.py`

Tests to cover:

**`QueueManager.load()`:**
- Returns empty queue structure when file does not exist
- Parses valid `queue.json` correctly
- Resets stale `in_progress` items when no pipeline PID is alive

**`QueueManager.enqueue()`:**
- Adds new items with correct defaults (`status=pending`, `run_id=None`)
- Deduplicates by `source_ref` — does not re-add a ref that is already `completed`
- Deduplicates by `title` for prompt items
- Sets `on_failure` on the queue

**`QueueManager.enqueue_from_beads()`:**
- Correctly maps beads priority strings P1→1, P2→2, P3→3, P4→4
- Skips refs already in the queue as `completed`
- (Mock `bd_ready()` to return a controlled list)

**`QueueManager.next_pending()`:**
- Returns `None` for empty pending list
- Returns highest priority item (lowest `priority` integer)
- Breaks ties by `added_at` (FIFO)

**`QueueManager.mark_in_progress()` / `mark_completed()` / `mark_failed()`:**
- Correctly update item fields
- Do not mutate other items
- Raise `ValueError` when `item_id` not found

**`QueueManager.drain()` (with `run_pipeline` mocked):**
- Processes all pending items in priority order
- Marks each item `completed` after successful `run_pipeline()` call
- With `on_failure=skip`: marks failed item, continues to next item
- With `on_failure=halt`: marks failed item, raises `QueueHaltedError`
- Respects circuit breaker: raises `QueueCircuitBreakerError` after N consecutive failures

Use `pytest` with `tmp_path` fixture for isolated queue file per test.

---

### Task 12: Write unit test for `GET /api/queue`

**Files:**
- Modify or create: `.claude/worca-ui/server/test/queue-api.test.js`

Tests (using `supertest` and `vitest` or the existing test framework):

- `GET /api/queue` returns `{ ok: true, queue: null }` when `queue.json` absent
- `GET /api/queue` returns `{ ok: true, queue: { ... } }` with valid queue file
- `GET /api/queue` returns HTTP 500 when `queue.json` is malformed JSON
- `GET /api/queue` returns HTTP 501 when `worcaDir` not configured

---

### Task 13: Rebuild frontend bundle

**Files:**
- Run build script for worca-ui (check `package.json` for the esbuild command)
- Regenerates: `.claude/worca-ui/app/main.bundle.js`

After all frontend JS changes (Tasks 5–10), rebuild the bundle. The exact command is in the `scripts` section of `.claude/worca-ui/package.json`. It is typically:

```bash
npx esbuild app/main.js --bundle --outfile=app/main.bundle.js --sourcemap
```

This must be the final step after all frontend source files are edited.

---

## 9. Rollout Order

Tasks must be implemented in this order due to dependencies:

1. **Task 1** (`queue.py` — `QueueManager`) — foundation, no dependencies
2. **Task 11** (unit tests for `QueueManager`) — validate Task 1 before proceeding
3. **Task 2** (`run_queue.py` CLI) — depends on Task 1
4. **Task 3** (`GET /api/queue` in `app.js`) — independent server change
5. **Task 12** (test for `GET /api/queue`) — validates Task 3
6. **Task 4** (`queue-changed` WebSocket broadcast) — depends on Task 3 context
7. **Task 5** (queue state in `state.js`) — small, independent
8. **Task 7** (`queue.js` view component) — independent frontend
9. **Task 8** (sidebar badge in `sidebar.js`) — depends on Task 5 (state shape)
10. **Task 9** (routing in `main.js`) — depends on Tasks 5, 6, 7
11. **Task 6** (initial fetch + WS handler in `main.js`) — depends on Tasks 4, 5
12. **Task 10** (CSS) — after all view changes settled
13. **Task 13** (rebuild bundle) — final step

---

## 10. Testing Strategy

### Python unit tests

Run with `pytest .claude/worca/orchestrator/test_queue.py -v`.

### JavaScript unit tests

Run with the existing test runner (check `package.json` — likely `vitest` or `jest`): `npm test` in `.claude/worca-ui/`.

### Manual integration checklist

- `python .claude/scripts/run_queue.py --queue "Fix auth" gh:issue:42 --dry-run` prints items in priority order and exits 0
- `python .claude/scripts/run_queue.py --from-beads` when beads is empty prints "Queue complete: 0 completed, 0 failed"
- `python .claude/scripts/run_queue.py --from-beads` with 2 ready issues writes `queue.json`, processes both items sequentially, updates their status
- After the queue runs, `GET /api/queue` returns the correct `queue.json` content
- Opening the UI shows the "Work Queue" sidebar item with the correct pending count badge
- Navigating to the queue view shows pending, in-progress, and completed sections
- While a queue is running, the in-progress item's dot pulses
- Clicking a completed queue item navigates to its run detail
- `python .claude/scripts/run_queue.py --resume-queue` when `queue.json` has pending items continues from the first pending item
- `python .claude/scripts/run_queue.py --on-failure halt` stops after the first pipeline failure
- Circuit breaker fires after 3 consecutive failures even with `--on-failure skip`
- Stale `in_progress` item in `queue.json` (from a crashed runner) is reset to `pending` on next load

### Edge cases to verify

- Empty `--queue` argument list — `argparse` requires at least one, error message is clear
- `--queue` with an invalid source ref (`gh:issue:nonexistent`) — `normalize()` raises; item is added with `status=failed` and appropriate error
- `queue.json` is deleted mid-drain — `load()` creates a fresh queue, `next_pending()` returns `None`, drain exits cleanly
- Two simultaneous `run_queue.py` processes — the second fails with `PipelineError("Pipeline already running")` on the first `run_pipeline()` call (enforced by the existing PID lock in `runner.py`)
- Very long queue (50+ items) — `queue.json` remains valid; UI renders without performance issues (items list is not virtualized, but 50 items is well within DOM limits)

---

## 11. File Summary

### New files

| File | Purpose |
|------|---------|
| `.claude/worca/orchestrator/queue.py` | `QueueManager` class, queue persistence, drain loop |
| `.claude/worca/orchestrator/test_queue.py` | Pytest unit tests for `QueueManager` |
| `.claude/scripts/run_queue.py` | CLI entry point for queue operations |
| `.claude/worca-ui/app/views/queue.js` | Queue status view component |
| `.claude/worca-ui/server/test/queue-api.test.js` | Unit tests for `GET /api/queue` |

### Modified files

| File | Changes |
|------|---------|
| `.claude/worca-ui/server/app.js` | Add `GET /api/queue` endpoint; accept `worcaDir` in options |
| `.claude/worca-ui/server/ws.js` | Broadcast `queue-changed` on `queue.json` file changes |
| `.claude/worca-ui/app/protocol.js` | Add `'queue-changed'` to `MESSAGE_TYPES` |
| `.claude/worca-ui/app/state.js` | Add `queue: null` to initial state |
| `.claude/worca-ui/app/main.js` | Fetch initial queue, handle `queue-changed` WS event, add queue routing |
| `.claude/worca-ui/app/views/sidebar.js` | Add queue section with pending count badge |
| `.claude/worca-ui/app/styles.css` | Add queue view and queue item styles |
| `.claude/worca-ui/app/main.bundle.js` | Rebuilt from source after all JS changes |
