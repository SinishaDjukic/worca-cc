# W-010: Approval Gate UI


**Goal:** When the pipeline hits an approval gate — currently gated in the terminal — the worca-ui should interrupt with a modal dialog that lets the user review context, type a decision, and unblock the pipeline from the browser. Today, a user watching the UI sees the pipeline stalled with no way to act; they must switch to the terminal and type a response by hand. This feature adds a bidirectional approval channel: the runner writes a pending approval request to `.worca/approvals/{run_id}.json`, the WebSocket server detects the file, broadcasts an `approval-pending` event to all connected clients, and the UI renders a blocking modal. The user approves, rejects, or provides feedback; the server writes the resolution back to the same file; the runner polls the file, reads the decision, and continues. Timeout support auto-rejects after a configurable number of seconds so an unattended pipeline does not hang forever.

**Architecture:** A new approval file protocol lives entirely on the filesystem under `.worca/approvals/`. The Python runner writes a request object (gate type, run ID, context payload) and polls the file for a `decision` field. The Node WebSocket server watches the approvals directory with `fs.watch`, reads new request files, and broadcasts `approval-pending` events to subscribers. A new `submit-approval` WebSocket message carries the user's decision back to the server, which writes the decision into the approval file. A new `approval-gate-dialog` view renders a Shoelace `<sl-dialog>` with context-appropriate content (plan text for plan gates, PR metadata for PR gates). Timeout countdown is tracked client-side and server-side; on expiry the server writes `decision: "rejected"` automatically. The existing WebSocket subscription model is extended: any client subscribed to a run receives `approval-pending` and `approval-resolved` events for that run.

**Tech Stack:** Python `time.sleep` polling loop in `runner.py`, Node.js `fs.watch` on `.worca/approvals/`, existing WebSocket broadcast infrastructure in `server/ws.js`, lit-html, Shoelace `<sl-dialog>` / `<sl-button>` / `<sl-textarea>` / `<sl-badge>` / `<sl-tab-group>` components, existing `makeOk` / `makeError` protocol helpers.

**Depends on:** W-000 Settings REST API (complete). W-009 Pipeline Control Actions (the `broadcast` function and WebSocket subscription model established there are extended here).

---

## 1. Scope and Boundaries

### In scope
- Approval file protocol: schema for request and resolution objects written to `.worca/approvals/{run_id}.json`
- Python runner: `_wait_for_approval(gate_type, run_id, context, approvals_dir, timeout_s)` helper that writes a request and polls for a decision
- Plan gate: after the PLAN stage produces its output, the runner writes an approval request containing the plan file path and summary; pipeline halts until decision arrives
- PR gate: after the PR stage completes, the runner writes an approval request containing PR URL, branch, and test result summary; pipeline halts until decision arrives
- `server/ws.js`: watch `.worca/approvals/` directory for new and modified files, broadcast `approval-pending` event to run subscribers, handle new `submit-approval` WebSocket message, write decision to file, broadcast `approval-resolved`
- `server/ws.js`: server-side timeout watchdog — if no decision arrives within the configured window, write `decision: "rejected"` and broadcast `approval-resolved`
- New view: `.claude/worca-ui/app/views/approval-gate-dialog.js` — a Shoelace dialog with tab-separated context sections and Approve / Reject / Request Changes buttons
- `app/main.js`: approval gate state management, WebSocket event handlers, render approval dialog on top of the main shell
- `app/protocol.js`: add `approval-pending`, `approval-resolved`, `submit-approval` to `MESSAGE_TYPES`
- `server/status.js` (Python): expose gate state (`awaiting_approval`) in `status.json` so the run card and run detail header can show a "Waiting for approval" badge
- CSS: approval dialog layout, countdown timer, diff/plan text styling
- Bundle rebuild

### Out of scope
- Multi-gate queuing (only one gate is active at a time per run)
- Rich diff rendering (plan text shown as preformatted text, not a syntax-highlighted diff)
- GitHub PR integration (PR URL shown as a clickable link; fetching actual diff from GitHub API is not in scope)
- Authentication (single-user local tool)
- Persistent approval history beyond the current run's `.worca/approvals/` file
- Mobile / responsive layout (desktop-first, same as existing UI)

---

## 2. Approval File Protocol

All approval activity for a run lives in a single JSON file:

```
.worca/approvals/{run_id}.json
```

### Request object (written by Python runner)

```json
{
  "run_id": "20260310-143022",
  "gate_type": "plan",
  "requested_at": "2026-03-10T14:30:22Z",
  "timeout_s": 300,
  "context": {
    "plan_file": "docs/plans/20260310-143022-add-user-auth.md",
    "plan_summary": "...",
    "approach": "..."
  },
  "decision": null,
  "decided_at": null,
  "feedback": null,
  "timed_out": false
}
```

For PR gates, `context` contains:

```json
{
  "pr_url": "https://github.com/owner/repo/pull/42",
  "branch": "worca/add-user-auth-xYz",
  "test_passed": true,
  "test_summary": "12 passed, 0 failed",
  "review_outcome": "approve"
}
```

### Resolution (written by server or timeout watchdog)

The server merges into the existing file:

```json
{
  "decision": "approved",
  "decided_at": "2026-03-10T14:32:01Z",
  "feedback": "",
  "timed_out": false
}
```

Valid `decision` values: `"approved"`, `"rejected"`, `"changes_requested"`.

When `changes_requested`, the `feedback` field carries the free-text comment. The runner maps decisions to pipeline actions:

| `decision` | `gate_type: plan` | `gate_type: pr` |
|---|---|---|
| `approved` | Continue to COORDINATE | Mark PR merged |
| `rejected` | Raise `PipelineError("Plan rejected")` | Raise `PipelineError("PR rejected")` |
| `changes_requested` | Loop back to PLAN | Loop back to IMPLEMENT |

---

## 3. Python Runner Changes

### New helper: `_wait_for_approval`

Introduced in `.claude/worca/orchestrator/runner.py`. Called after PLAN and PR stages.

```python
def _wait_for_approval(
    gate_type: str,
    run_id: str,
    context: dict,
    approvals_dir: str,
    timeout_s: int = 300,
    poll_interval_s: float = 2.0,
) -> tuple[str, str | None]:
    """
    Write an approval request file and poll until a decision arrives or timeout.

    Returns (decision, feedback) where decision is one of:
      "approved", "rejected", "changes_requested"
    and feedback is a string (may be empty or None).

    Raises PipelineInterrupted if _shutdown_requested is set while waiting.
    Raises PipelineError("Approval timed out") on timeout.
    """
```

**Implementation steps:**

1. `os.makedirs(approvals_dir, exist_ok=True)`
2. Build request dict with `gate_type`, `run_id`, `requested_at` (UTC ISO), `timeout_s`, `context`, `decision: None`.
3. Write to `{approvals_dir}/{run_id}.json` atomically (write to temp file, rename).
4. `_log(f"Waiting for {gate_type} approval (timeout {timeout_s}s)...")`
5. Poll loop:
   - Check `_shutdown_requested` — if set, raise `PipelineInterrupted`.
   - Read the file, parse JSON.
   - If `data["decision"]` is not None, return `(data["decision"], data.get("feedback"))`.
   - If `time.time() - t0 > timeout_s`, write `timed_out: true, decision: "rejected"` to file, raise `PipelineError("Approval timed out")`.
   - `time.sleep(poll_interval_s)`.

### Plan gate integration

In `run_pipeline()`, after the PLAN stage result is validated and `_log("PLAN approved")` would be called, instead invoke:

```python
if get_approval_gates_enabled(settings_path, "plan"):
    decision, feedback = _wait_for_approval(
        gate_type="plan",
        run_id=status["run_id"],
        context={
            "plan_file": status["plan_file"],
            "plan_summary": result.get("approach", ""),
            "approach": result.get("approach", ""),
        },
        approvals_dir=os.path.join(worca_dir, "approvals"),
        timeout_s=get_approval_timeout(settings_path),
    )
    if decision == "rejected":
        raise PipelineError("Plan rejected by user")
    elif decision == "changes_requested":
        # Thread feedback into prompt builder and loop back
        prompt_builder.update_context("plan_feedback", feedback)
        _next_trigger[Stage.PLAN.value] = "changes_requested"
        stage_idx = stage_order.index(Stage.PLAN)
        continue
    # else: approved — fall through
```

### PR gate integration

After the PR stage completes (the current `else:` branch for stages without special handling), insert:

```python
if current_stage == Stage.PR and get_approval_gates_enabled(settings_path, "pr"):
    decision, feedback = _wait_for_approval(
        gate_type="pr",
        run_id=status["run_id"],
        context={
            "pr_url": result.get("pr_url", ""),
            "branch": branch_name,
            "test_passed": status.get("stages", {}).get("test", {}).get("status") == "completed",
            "review_outcome": result.get("outcome", ""),
        },
        approvals_dir=os.path.join(worca_dir, "approvals"),
        timeout_s=get_approval_timeout(settings_path),
    )
    if decision == "rejected":
        raise PipelineError("PR rejected by user")
    elif decision == "changes_requested":
        prompt_builder.update_context("pr_feedback", feedback)
        _next_trigger[Stage.IMPLEMENT.value] = "pr_feedback"
        stage_idx = stage_order.index(Stage.IMPLEMENT)
        continue
```

### Settings helpers

Add two small helpers in `runner.py` (reading from `settings_path`):

```python
def get_approval_gates_enabled(settings_path: str, gate: str) -> bool:
    """Return True if the named approval gate is enabled in settings."""
    try:
        with open(settings_path) as f:
            s = json.load(f)
        return s.get("worca", {}).get("approval_gates", {}).get(gate, True)
    except Exception:
        return True  # gates enabled by default

def get_approval_timeout(settings_path: str) -> int:
    """Return approval timeout in seconds from settings (default 300)."""
    try:
        with open(settings_path) as f:
            s = json.load(f)
        return int(s.get("worca", {}).get("approval_timeout_s", 300))
    except Exception:
        return 300
```

### Status file: surface gate state

In the polling loop of `_wait_for_approval`, update `status.json` to expose the gate state so the UI can show a badge. Before entering the poll loop:

```python
update_stage(status, current_stage.value, gate_status="awaiting_approval", gate_type=gate_type)
save_status(status, actual_status_path)
```

After the decision arrives:

```python
update_stage(status, current_stage.value, gate_status="approved" if decision == "approved" else "gate_resolved")
save_status(status, actual_status_path)
```

The `update_stage` function in `worca/state/status.py` should be checked to ensure it accepts arbitrary keyword arguments (kwargs) and merges them into the stage dict.

---

## 4. WebSocket Server Changes

### 4.1 Approvals Directory Watcher

In `server/ws.js`, inside `attachWsServer`, add a watcher for the `.worca/approvals/` directory alongside the existing `statusWatcher` and `activeRunWatcher`.

**New module-level watcher variable:**
```javascript
let approvalsWatcher = null;
```

**New function `setupApprovalsWatcher()`:**

```javascript
function setupApprovalsWatcher() {
  const approvalsDir = join(worcaDir, 'approvals');
  if (approvalsWatcher) approvalsWatcher.close();
  if (!existsSync(approvalsDir)) {
    // Directory doesn't exist yet — watch worcaDir for when it's created
    return;
  }
  try {
    approvalsWatcher = watch(approvalsDir, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.json')) return;
      handleApprovalFileChange(filename.replace('.json', ''));
    });
  } catch { /* ignore */ }
}
```

Watch the top-level `.worca/` directory's existing `activeRunWatcher` to also detect creation of the `approvals/` subdirectory, calling `setupApprovalsWatcher()` when seen.

**New function `handleApprovalFileChange(runId)`:**

```javascript
function handleApprovalFileChange(runId) {
  const filePath = join(worcaDir, 'approvals', `${runId}.json`);
  if (!existsSync(filePath)) return;
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch { return; }

  if (data.decision === null || data.decision === undefined) {
    // Pending: broadcast to run subscribers
    broadcastToSubscribers(runId, 'approval-pending', {
      runId,
      gateType: data.gate_type,
      requestedAt: data.requested_at,
      timeoutS: data.timeout_s,
      context: data.context,
    });
    // Start server-side timeout watchdog
    scheduleApprovalTimeout(runId, data.timeout_s, data.requested_at);
  } else {
    // Resolved: broadcast resolution
    broadcastToSubscribers(runId, 'approval-resolved', {
      runId,
      gateType: data.gate_type,
      decision: data.decision,
      feedback: data.feedback,
      timedOut: data.timed_out,
    });
    cancelApprovalTimeout(runId);
  }
}
```

### 4.2 Server-Side Timeout Watchdog

The server implements a timeout watchdog independent of the Python poller. This ensures that even if the server crashes and restarts, a stale approval request does not block forever.

```javascript
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const approvalTimeouts = new Map();

function scheduleApprovalTimeout(runId, timeoutS, requestedAtIso) {
  cancelApprovalTimeout(runId);
  const requestedMs = new Date(requestedAtIso).getTime();
  const expiresMs = requestedMs + (timeoutS * 1000);
  const remainingMs = expiresMs - Date.now();
  if (remainingMs <= 0) {
    writeApprovalDecision(runId, 'rejected', null, true);
    return;
  }
  const timer = setTimeout(() => {
    approvalTimeouts.delete(runId);
    writeApprovalDecision(runId, 'rejected', null, true);
  }, remainingMs);
  timer.unref?.();
  approvalTimeouts.set(runId, timer);
}

function cancelApprovalTimeout(runId) {
  const t = approvalTimeouts.get(runId);
  if (t) { clearTimeout(t); approvalTimeouts.delete(runId); }
}

function writeApprovalDecision(runId, decision, feedback, timedOut = false) {
  const filePath = join(worcaDir, 'approvals', `${runId}.json`);
  if (!existsSync(filePath)) return;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    data.decision = decision;
    data.decided_at = new Date().toISOString();
    data.feedback = feedback || null;
    data.timed_out = timedOut;
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    // fs.watch will fire again and call handleApprovalFileChange -> broadcast resolved
  } catch { /* ignore */ }
}
```

Add `writeFileSync` to the existing `import { watch, existsSync, readFileSync, unlinkSync, readdirSync, statSync } from 'node:fs'` import line.

### 4.3 New WebSocket Message: `submit-approval`

Add a new handler inside `handleMessage()`:

```javascript
// submit-approval
if (req.type === 'submit-approval') {
  const { runId, decision, feedback } = req.payload || {};
  if (!runId || !decision) {
    ws.send(JSON.stringify(makeError(req, 'bad_request', 'payload.runId and payload.decision required')));
    return;
  }
  const validDecisions = ['approved', 'rejected', 'changes_requested'];
  if (!validDecisions.includes(decision)) {
    ws.send(JSON.stringify(makeError(req, 'bad_request', `decision must be one of: ${validDecisions.join(', ')}`)));
    return;
  }
  if (decision === 'changes_requested' && !feedback) {
    ws.send(JSON.stringify(makeError(req, 'bad_request', 'feedback is required when decision is changes_requested')));
    return;
  }
  const filePath = join(worcaDir, 'approvals', `${runId}.json`);
  if (!existsSync(filePath)) {
    ws.send(JSON.stringify(makeError(req, 'NOT_FOUND', `No approval request found for run ${runId}`)));
    return;
  }
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (data.decision !== null && data.decision !== undefined) {
      ws.send(JSON.stringify(makeError(req, 'already_decided', 'Approval already resolved')));
      return;
    }
    writeApprovalDecision(runId, decision, feedback || null, false);
    ws.send(JSON.stringify(makeOk(req, { submitted: true, runId, decision })));
  } catch (e) {
    ws.send(JSON.stringify(makeError(req, 'write_error', e.message)));
  }
  return;
}
```

### 4.4 Reconnect Recovery

When a client sends `subscribe-run`, after sending the run snapshot, check for an existing pending approval:

```javascript
// After sending the run snapshot in the subscribe-run handler:
const approvalPath = join(worcaDir, 'approvals', `${runId}.json`);
if (existsSync(approvalPath)) {
  try {
    const approvalData = JSON.parse(readFileSync(approvalPath, 'utf8'));
    if (approvalData.decision === null || approvalData.decision === undefined) {
      ws.send(JSON.stringify({
        id: `evt-${Date.now()}`, ok: true, type: 'approval-pending',
        payload: {
          runId,
          gateType: approvalData.gate_type,
          requestedAt: approvalData.requested_at,
          timeoutS: approvalData.timeout_s,
          context: approvalData.context,
        }
      }));
    }
  } catch { /* ignore */ }
}
```

This ensures a user who opens the UI mid-gate, or whose browser reconnects, immediately sees the approval dialog.

### 4.5 Cleanup on WSS Close

In the `wss.on('close', ...)` handler, add:

```javascript
if (approvalsWatcher) approvalsWatcher.close();
for (const t of approvalTimeouts.values()) clearTimeout(t);
approvalTimeouts.clear();
```

---

## 5. Frontend Changes

### 5.1 Protocol Types

**File:** `.claude/worca-ui/app/protocol.js`

Add to `MESSAGE_TYPES`:

```javascript
'approval-pending', 'approval-resolved', 'submit-approval'
```

Update the `@typedef` JSDoc comment to include the new types.

### 5.2 New View: `app/views/approval-gate-dialog.js`

**File:** `.claude/worca-ui/app/views/approval-gate-dialog.js`

**Exported function:**

```javascript
export function approvalGateDialogView(approval, { onApprove, onReject, onRequestChanges, onDismiss })
```

Where `approval` is `null` (not shown) or an object:

```javascript
{
  runId: string,
  gateType: 'plan' | 'pr',
  requestedAt: string,      // ISO timestamp
  timeoutS: number,
  context: object,
  secondsRemaining: number, // computed by main.js countdown
}
```

**Template structure:**

```javascript
export function approvalGateDialogView(approval, callbacks) {
  if (!approval) return nothing;
  const { onApprove, onReject, onRequestChanges } = callbacks;
  const isPlan = approval.gateType === 'plan';
  const isPr = approval.gateType === 'pr';

  return html`
    <sl-dialog
      class="approval-gate-dialog"
      label="${isPlan ? 'Plan Approval Required' : 'PR Approval Required'}"
      ?open=${true}
      @sl-request-close=${(e) => e.preventDefault()}
    >
      ${_countdownBanner(approval.secondsRemaining, approval.timeoutS)}
      ${isPlan ? _planContent(approval.context) : _prContent(approval.context)}
      ${_feedbackSection()}
      <div slot="footer" class="approval-gate-footer">
        <sl-button variant="danger" @click=${onReject}>
          Reject
        </sl-button>
        <sl-button variant="warning" @click=${() => onRequestChanges(_getFeedback())}>
          Request Changes
        </sl-button>
        <sl-button variant="success" @click=${onApprove}>
          Approve
        </sl-button>
      </div>
    </sl-dialog>
  `;
}
```

**`_countdownBanner(secondsRemaining, timeoutS)`:** renders an `<sl-alert variant="warning">` showing "Auto-reject in X seconds" when `secondsRemaining < 60`, otherwise shows "Waiting for approval — {X}s timeout". The urgency class is `countdown--urgent` when `< 30s` to show a red tint.

**`_planContent(context)`:** renders:
- A `<sl-badge variant="primary">Plan</sl-badge>` label
- The `context.plan_summary` / `context.approach` in a `<pre class="approval-plan-text">` block
- A link-style element showing `context.plan_file` with a note that it has been written to disk

**`_prContent(context)`:** renders:
- A `<sl-badge variant="success">PR</sl-badge>` label
- PR URL as `<a href="${context.pr_url}" target="_blank">`
- Branch name in a `<code>` element
- Test status badge: `<sl-badge variant="${context.test_passed ? 'success' : 'danger'}">Tests: ${context.test_summary || (context.test_passed ? 'passed' : 'failed')}</sl-badge>`
- Review outcome badge

**`_feedbackSection()`:** renders a `<sl-textarea id="approval-feedback" label="Feedback (required for Request Changes)" rows="3">` component. This textarea is always present but only required when clicking "Request Changes".

**`_getFeedback()`:** a module-local helper:

```javascript
function _getFeedback() {
  const el = document.querySelector('sl-textarea#approval-feedback');
  return el ? el.value : '';
}
```

The dialog uses `@sl-request-close=${(e) => e.preventDefault()}` to prevent accidental dismissal via Escape or clicking outside — the user must use an explicit Approve/Reject/Request Changes button.

### 5.3 State and Handlers in `app/main.js`

**New module-level state variables:**

```javascript
let approval = null;          // null | { runId, gateType, requestedAt, timeoutS, context, secondsRemaining }
let approvalCountdownTimer = null;
let approvalSubmitting = false;
let approvalError = null;
```

**New handlers:**

```javascript
function handleApprovalPending(payload) {
  approval = {
    runId: payload.runId,
    gateType: payload.gateType,
    requestedAt: payload.requestedAt,
    timeoutS: payload.timeoutS,
    context: payload.context,
    secondsRemaining: _computeSecondsRemaining(payload.requestedAt, payload.timeoutS),
  };
  approvalSubmitting = false;
  approvalError = null;
  _startApprovalCountdown();
  rerender();
}

function handleApprovalResolved(payload) {
  approval = null;
  approvalSubmitting = false;
  _stopApprovalCountdown();
  rerender();
}

function _computeSecondsRemaining(requestedAtIso, timeoutS) {
  const expiresMs = new Date(requestedAtIso).getTime() + (timeoutS * 1000);
  return Math.max(0, Math.round((expiresMs - Date.now()) / 1000));
}

function _startApprovalCountdown() {
  _stopApprovalCountdown();
  approvalCountdownTimer = setInterval(() => {
    if (!approval) { _stopApprovalCountdown(); return; }
    approval = { ...approval, secondsRemaining: _computeSecondsRemaining(approval.requestedAt, approval.timeoutS) };
    if (approval.secondsRemaining <= 0) {
      _stopApprovalCountdown();
      // Server will auto-resolve; wait for approval-resolved event
    }
    rerender();
  }, 1000);
}

function _stopApprovalCountdown() {
  if (approvalCountdownTimer) { clearInterval(approvalCountdownTimer); approvalCountdownTimer = null; }
}

function handleApprove() {
  _submitApproval('approved', null);
}

function handleReject() {
  _submitApproval('rejected', null);
}

function handleRequestChanges(feedback) {
  if (!feedback || !feedback.trim()) {
    approvalError = 'Feedback is required when requesting changes.';
    rerender();
    return;
  }
  _submitApproval('changes_requested', feedback.trim());
}

function _submitApproval(decision, feedback) {
  if (!approval || approvalSubmitting) return;
  approvalSubmitting = true;
  approvalError = null;
  rerender();
  ws.send('submit-approval', { runId: approval.runId, decision, feedback })
    .then(() => {
      // approval-resolved event will clear the dialog
    })
    .catch((err) => {
      approvalSubmitting = false;
      approvalError = err?.message || 'Failed to submit approval';
      rerender();
    });
}
```

**WebSocket event wiring** (add alongside existing `ws.on(...)` calls):

```javascript
ws.on('approval-pending', (payload) => {
  if (payload) handleApprovalPending(payload);
});

ws.on('approval-resolved', (payload) => {
  if (payload) handleApprovalResolved(payload);
});
```

**Render integration:**

In the `rerender()` function, import and render `approvalGateDialogView` after the existing `actionError` dialog:

```javascript
import { approvalGateDialogView } from './views/approval-gate-dialog.js';

// In rerender(), inside the render() call, after the actionError dialog:
${approvalGateDialogView(approval, {
  onApprove: handleApprove,
  onReject: handleReject,
  onRequestChanges: handleRequestChanges,
})}
```

### 5.4 "Awaiting Approval" Badge in Run Header

**File:** `.claude/worca-ui/app/main.js`

In `contentHeaderView()`, inside the `if (run)` block where `badge` is set, add a check for `gate_status`:

```javascript
// Check if any stage is awaiting approval
const awaitingApproval = run.stages && Object.values(run.stages).some(
  s => s.gate_status === 'awaiting_approval'
);
if (awaitingApproval) {
  badge = html`<sl-badge variant="warning" pill class="badge--pulse">
    ${unsafeHTML(statusIcon('in_progress', 12))}
    Awaiting Approval
  </sl-badge>`;
}
```

This badge replaces the normal "Running" badge when in gate state, providing a visual cue even before the dialog appears (e.g., if the browser connects while gated).

### 5.5 CSS

**File:** `.claude/worca-ui/app/styles.css`

Add the following styles:

```css
/* Approval Gate Dialog */
.approval-gate-dialog {
  --width: 640px;
}

.approval-gate-dialog::part(body) {
  padding: 0;
}

.approval-gate-countdown {
  padding: var(--sl-spacing-medium);
  border-bottom: 1px solid var(--sl-color-neutral-200);
  font-size: var(--sl-font-size-small);
}

.approval-gate-countdown--urgent {
  background: var(--sl-color-danger-50);
  color: var(--sl-color-danger-700);
}

.approval-gate-content {
  padding: var(--sl-spacing-medium);
}

.approval-plan-text {
  background: var(--sl-color-neutral-50);
  border: 1px solid var(--sl-color-neutral-200);
  border-radius: var(--sl-border-radius-medium);
  padding: var(--sl-spacing-medium);
  font-size: var(--sl-font-size-small);
  font-family: var(--sl-font-mono);
  max-height: 280px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.approval-gate-footer {
  display: flex;
  gap: var(--sl-spacing-small);
  justify-content: flex-end;
}

.approval-feedback {
  padding: var(--sl-spacing-medium);
  border-top: 1px solid var(--sl-color-neutral-200);
}

.approval-pr-meta {
  display: grid;
  gap: var(--sl-spacing-small);
}

.approval-pr-meta-row {
  display: flex;
  align-items: center;
  gap: var(--sl-spacing-small);
  font-size: var(--sl-font-size-small);
}

.approval-error {
  color: var(--sl-color-danger-600);
  font-size: var(--sl-font-size-small);
  padding: var(--sl-spacing-x-small) var(--sl-spacing-medium);
}

/* Pulsing badge for awaiting approval state */
@keyframes badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
.badge--pulse {
  animation: badge-pulse 1.5s ease-in-out infinite;
}
```

---

## 6. Settings Schema Extension

**File:** `.claude/settings.json` (the project's settings file)

Add approval gate configuration to the `worca` namespace:

```json
{
  "worca": {
    "approval_gates": {
      "plan": true,
      "pr": true
    },
    "approval_timeout_s": 300
  }
}
```

**File:** `.claude/worca-ui/server/settings-validator.js`

Extend the validator to allow (but not require) `worca.approval_gates` (object with boolean values `plan`, `pr`) and `worca.approval_timeout_s` (integer, 30–3600).

---

## 7. Implementation Tasks

### Task 1: Approval file protocol helpers in `runner.py`

**File:** `.claude/worca/orchestrator/runner.py`

Add the following to the existing `runner.py`:

1. Import `from worca.state.status import update_stage` (already imported via `update_stage`; verify it accepts **kwargs).
2. Add `get_approval_gates_enabled(settings_path, gate)` function — reads `settings_path`, returns `bool` from `worca.approval_gates.{gate}`, defaults to `True`.
3. Add `get_approval_timeout(settings_path)` function — reads `settings_path`, returns `int` from `worca.approval_timeout_s`, defaults to `300`.
4. Add `_wait_for_approval(gate_type, run_id, context, approvals_dir, timeout_s, poll_interval_s)` function as specified in section 3. Use atomic write: write to `{approvals_dir}/{run_id}.json.tmp` then `os.replace()`.
5. Verify `update_stage` in `.claude/worca/state/status.py` accepts extra kwargs and merges them into the stage dict. If not, update it to do so.

---

### Task 2: Plan gate in `run_pipeline()`

**File:** `.claude/worca/orchestrator/runner.py`

In `run_pipeline()`, locate the `if current_stage == Stage.PLAN:` block (around line 846). After the existing PLAN approval check (`if not approved:`), add the human approval gate:

```python
# After plan_approved milestone is set and plan is auto-approved:
if get_approval_gates_enabled(settings_path, "plan"):
    _log("PLAN stage awaiting human approval...")
    update_stage(status, Stage.PLAN.value, gate_status="awaiting_approval", gate_type="plan")
    save_status(status, actual_status_path)
    decision, feedback = _wait_for_approval(
        gate_type="plan",
        run_id=status["run_id"],
        context={
            "plan_file": status.get("plan_file", ""),
            "plan_summary": result.get("approach", ""),
            "approach": result.get("approach", ""),
        },
        approvals_dir=os.path.join(worca_dir, "approvals"),
        timeout_s=get_approval_timeout(settings_path),
    )
    update_stage(status, Stage.PLAN.value, gate_status="gate_resolved")
    save_status(status, actual_status_path)
    if decision == "rejected":
        raise PipelineError("Plan rejected by user")
    elif decision == "changes_requested":
        prompt_builder.update_context("plan_feedback", feedback)
        complete_iteration(status, Stage.PLAN.value, **iter_extras)
        update_stage(status, Stage.PLAN.value, **stage_extras)
        save_status(status, actual_status_path)
        _next_trigger[Stage.PLAN.value] = "changes_requested"
        stage_idx = stage_order.index(Stage.PLAN)
        continue
    _log("PLAN approved by user", "ok")
```

---

### Task 3: PR gate in `run_pipeline()`

**File:** `.claude/worca/orchestrator/runner.py`

In `run_pipeline()`, locate the `else:` branch at the bottom of the stage handling block (the default completion path, around line 967). Before `stage_idx += 1`, check if the current stage is PR and gates are enabled:

```python
# At the bottom of the while loop, before stage_idx += 1:
if current_stage == Stage.PR and get_approval_gates_enabled(settings_path, "pr"):
    _log("PR stage awaiting human approval...")
    update_stage(status, Stage.PR.value, gate_status="awaiting_approval", gate_type="pr")
    save_status(status, actual_status_path)
    decision, feedback = _wait_for_approval(
        gate_type="pr",
        run_id=status["run_id"],
        context={
            "pr_url": result.get("pr_url", "") if isinstance(result, dict) else "",
            "branch": branch_name,
            "test_passed": status.get("stages", {}).get("test", {}).get("status") == "completed",
            "review_outcome": result.get("outcome", "") if isinstance(result, dict) else "",
        },
        approvals_dir=os.path.join(worca_dir, "approvals"),
        timeout_s=get_approval_timeout(settings_path),
    )
    update_stage(status, Stage.PR.value, gate_status="gate_resolved")
    save_status(status, actual_status_path)
    if decision == "rejected":
        raise PipelineError("PR rejected by user")
    elif decision == "changes_requested":
        prompt_builder.update_context("pr_feedback", feedback)
        _next_trigger[Stage.IMPLEMENT.value] = "pr_feedback"
        stage_idx = stage_order.index(Stage.IMPLEMENT)
        continue
    _log("PR approved by user", "ok")
```

---

### Task 4: Update `worca/state/status.py` to accept gate fields

**File:** `.claude/worca/state/status.py`

Read the current `update_stage` function. If it does not already accept `**kwargs` and merge them into the stage dict, update the signature:

```python
def update_stage(status: dict, stage_key: str, **kwargs) -> None:
    """Update stage fields in the status dict. kwargs are merged directly."""
    if "stages" not in status:
        status["stages"] = {}
    if stage_key not in status["stages"]:
        status["stages"][stage_key] = {}
    status["stages"][stage_key].update(kwargs)
```

This is backward compatible since all existing callers use keyword arguments.

---

### Task 5: Add approvals directory watcher in `server/ws.js`

**File:** `.claude/worca-ui/server/ws.js`

1. Add `writeFileSync` to the existing `fs` import.
2. Declare `let approvalsWatcher = null;` alongside other watcher variables.
3. Declare `const approvalTimeouts = new Map();` alongside other module-level state.
4. Add `setupApprovalsWatcher()`, `handleApprovalFileChange(runId)`, `scheduleApprovalTimeout(runId, timeoutS, requestedAtIso)`, `cancelApprovalTimeout(runId)`, and `writeApprovalDecision(runId, decision, feedback, timedOut)` functions as specified in section 4.1 and 4.2.
5. Call `setupApprovalsWatcher()` at server startup (after `setupStatusWatcher()`).
6. In the `activeRunWatcher` callback, when the `approvals` directory is created, call `setupApprovalsWatcher()`.
7. In the `wss.on('close', ...)` handler, add cleanup for `approvalsWatcher` and `approvalTimeouts`.

---

### Task 6: Add `submit-approval` handler and reconnect recovery in `server/ws.js`

**File:** `.claude/worca-ui/server/ws.js`

1. Add the `submit-approval` message handler in `handleMessage()` as specified in section 4.3. Place it after the `resume-run` handler.
2. In the `subscribe-run` handler, after sending the run snapshot, add the reconnect recovery code from section 4.4 that sends `approval-pending` if a pending approval file exists.

---

### Task 7: Create `app/views/approval-gate-dialog.js`

**File:** `.claude/worca-ui/app/views/approval-gate-dialog.js`

Create the new file with the `approvalGateDialogView` function as specified in section 5.2. Include:

- `import { html, nothing } from 'lit-html'`
- `_countdownBanner(secondsRemaining, timeoutS)` — private function
- `_planContent(context)` — private function
- `_prContent(context)` — private function
- `_feedbackSection()` — private function
- `_getFeedback()` — private helper reading `sl-textarea#approval-feedback`
- `export function approvalGateDialogView(approval, { onApprove, onReject, onRequestChanges })`

The dialog must use `@sl-request-close=${(e) => e.preventDefault()}` to block dismissal. Only the three explicit action buttons should be able to close it.

Register no additional Shoelace components in this file — `<sl-dialog>`, `<sl-button>`, `<sl-textarea>`, `<sl-badge>` are already imported in `main.js`.

---

### Task 8: Add approval state and handlers to `app/main.js`

**File:** `.claude/worca-ui/app/main.js`

1. Import `approvalGateDialogView` from `'./views/approval-gate-dialog.js'` at the top of the file.
2. Add module-level approval state variables: `approval`, `approvalCountdownTimer`, `approvalSubmitting`, `approvalError`.
3. Add all approval handler functions: `handleApprovalPending`, `handleApprovalResolved`, `_computeSecondsRemaining`, `_startApprovalCountdown`, `_stopApprovalCountdown`, `handleApprove`, `handleReject`, `handleRequestChanges`, `_submitApproval`.
4. Add `ws.on('approval-pending', ...)` and `ws.on('approval-resolved', ...)` event registrations alongside the existing `ws.on(...)` calls.
5. In `contentHeaderView()`, add the "Awaiting Approval" badge override when `gate_status === 'awaiting_approval'` is detected in any stage.
6. In `rerender()`, render `approvalGateDialogView(approval, { ... })` inside the top-level `render(html\`...\`, appEl)` call, after the existing `actionError` dialog block.

---

### Task 9: Update `app/protocol.js`

**File:** `.claude/worca-ui/app/protocol.js`

Add to `MESSAGE_TYPES`:

```javascript
'submit-approval',
'approval-pending', 'approval-resolved',
```

Update the `@typedef` comment to include all three new types.

---

### Task 10: Add CSS for approval gate dialog

**File:** `.claude/worca-ui/app/styles.css`

Append the CSS rules from section 5.5 to the end of the existing stylesheet.

---

### Task 11: Extend settings validator

**File:** `.claude/worca-ui/server/settings-validator.js`

Read the existing validation logic. Add rules to accept (not require) the following in the `worca` payload:

- `approval_gates`: object with optional boolean fields `plan` and `pr`
- `approval_timeout_s`: integer in range 30–3600

These fields should be silently ignored if absent and validated if present. Add them to the existing field whitelist so they are not rejected as unknown keys.

---

### Task 12: Rebuild frontend bundle

**Files:**
- Run the build script to regenerate `.claude/worca-ui/app/main.bundle.js`

Check `package.json` in `.claude/worca-ui/` for the build command. It is likely one of:
- `npm run build`
- `npx esbuild app/main.js --bundle --outfile=app/main.bundle.js --format=esm`

Run the build command from `.claude/worca-ui/` to regenerate `main.bundle.js` and `main.bundle.js.map`. The bundle must be regenerated since the server serves it as a static file.

---

## 8. Testing Strategy

### Unit Tests

**Python (`tests/orchestrator/test_runner_approval.py`):**
- Test `_wait_for_approval` returns `("approved", None)` when approval file is written with `decision: "approved"` after 1 poll cycle
- Test `_wait_for_approval` returns `("changes_requested", "add tests")` when decision file contains feedback
- Test `_wait_for_approval` raises `PipelineError("Approval timed out")` when timeout expires
- Test `_wait_for_approval` raises `PipelineInterrupted` when `_shutdown_requested` is set during poll
- Test `get_approval_gates_enabled` returns `True` by default and respects settings
- Test `get_approval_timeout` returns `300` by default and reads from settings
- Use `tmp_path` fixture to create temp approval dirs; mock `time.sleep` to avoid delays

**Node.js (`server/ws-approval.test.js` or extend `server/approval.test.js`):**
- Test `handleApprovalFileChange` broadcasts `approval-pending` when file has `decision: null`
- Test `handleApprovalFileChange` broadcasts `approval-resolved` when file has `decision: "approved"`
- Test `writeApprovalDecision` writes the correct fields to the file
- Test `scheduleApprovalTimeout` fires after the computed remaining duration
- Test `submit-approval` WebSocket handler rejects unknown decision values
- Test `submit-approval` handler rejects when approval file not found
- Test `submit-approval` handler rejects when approval already decided
- Test reconnect recovery sends `approval-pending` on `subscribe-run` if file is pending
- Mock `fs` operations; use in-memory fixture objects for approval files

### Manual Integration Test Checklist

- Start a pipeline with `plan` gate enabled; verify the approval dialog appears in the UI within 2 seconds of the plan stage completing
- Approve the plan; verify the pipeline continues to the COORDINATE stage
- Reject the plan; verify the pipeline stops with `PipelineError("Plan rejected by user")` and status shows `error`
- Click "Request Changes" without feedback; verify validation error appears in dialog
- Click "Request Changes" with feedback; verify pipeline loops back to PLAN stage with feedback context
- Let the timeout expire (set a short `approval_timeout_s` in settings, e.g. 15s); verify the dialog auto-closes and the pipeline raises `PipelineError("Approval timed out")`
- Open the UI mid-gate (navigate away and back); verify the approval dialog reappears immediately on reconnect
- Open two browser tabs; submit approval from one; verify the other tab's dialog closes via `approval-resolved` event
- Test with `approval_gates.plan: false` in settings; verify the gate is skipped and the pipeline runs straight through
- Test with `approval_gates.pr: true`; verify the PR gate dialog shows PR metadata (branch, test status)

### Edge Cases to Verify

- Pipeline crashes during approval wait: `.worca/approvals/{run_id}.json` remains on disk; next time the UI connects it shows the gate dialog; clicking approve writes the decision but the pipeline is gone (the file just sits there — no harm)
- Server restart during approval wait: `setupApprovalsWatcher()` re-reads existing approval files on startup; a pending file triggers `approval-pending` broadcast to the next client that subscribes
- Rapid double-click on Approve: `approvalSubmitting = true` prevents the second send; server also rejects the second `submit-approval` with `already_decided`
- Very long plan text: `<pre class="approval-plan-text">` has `max-height: 280px; overflow-y: auto` to prevent the dialog from growing unbounded

---

## 9. File Summary

### New files

| File | Purpose |
|------|---------|
| `.claude/worca-ui/app/views/approval-gate-dialog.js` | Shoelace dialog with Approve / Reject / Request Changes buttons, plan and PR context rendering, countdown |

### Modified files

| File | Changes |
|------|---------|
| `.claude/worca/orchestrator/runner.py` | Add `get_approval_gates_enabled`, `get_approval_timeout`, `_wait_for_approval` helpers; insert plan gate after PLAN stage; insert PR gate after PR stage |
| `.claude/worca/state/status.py` | Ensure `update_stage` accepts `**kwargs` for `gate_status` and `gate_type` fields |
| `.claude/worca-ui/server/ws.js` | Add approvals directory watcher, `handleApprovalFileChange`, timeout watchdog, `writeApprovalDecision`, `submit-approval` message handler, reconnect recovery in `subscribe-run` |
| `.claude/worca-ui/app/main.js` | Import and render approval dialog; add approval state variables; add `approval-pending` / `approval-resolved` WS event handlers; add `handleApprove`, `handleReject`, `handleRequestChanges`, `_submitApproval` functions; add countdown timer logic; add "Awaiting Approval" badge |
| `.claude/worca-ui/app/protocol.js` | Add `'submit-approval'`, `'approval-pending'`, `'approval-resolved'` to `MESSAGE_TYPES` and typedef |
| `.claude/worca-ui/server/settings-validator.js` | Accept `worca.approval_gates` and `worca.approval_timeout_s` fields |
| `.claude/worca-ui/app/styles.css` | Add approval gate dialog layout, countdown, plan text, PR meta, and pulse-badge CSS |
| `.claude/worca-ui/app/main.bundle.js` | Rebuilt from source after all frontend changes |

---

## 10. Rollout Order

Tasks must be implemented in this order:

1. **Task 4** (`status.py` `update_stage` kwargs) — prerequisite for Tasks 2 and 3
2. **Task 1** (approval helpers in `runner.py`) — no external dependencies
3. **Task 2** (plan gate in `run_pipeline`) — depends on Tasks 1 and 4
4. **Task 3** (PR gate in `run_pipeline`) — depends on Tasks 1 and 4
5. **Task 9** (`protocol.js` types) — small, independent
6. **Task 7** (`approval-gate-dialog.js` view) — independent frontend work
7. **Task 5** (approvals watcher in `ws.js`) — independent server work
8. **Task 6** (`submit-approval` handler + reconnect recovery) — depends on Task 5
9. **Task 8** (`main.js` approval state and handlers) — depends on Tasks 6, 7, 9
10. **Task 10** (CSS) — after view is settled
11. **Task 11** (settings validator) — independent, can be done any time
12. **Task 12** (bundle rebuild) — final step, after all frontend changes
