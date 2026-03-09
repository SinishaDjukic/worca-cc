# W-014: Browser Notifications

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Notify users via the Web Notifications API when pipeline events need attention, so they can switch to other work and be pulled back only when action is required.

**Scope:** A new frontend notification manager module that hooks into existing WebSocket state updates, a permission request flow, per-event-type preferences stored in `~/.worca/preferences.json`, and click-to-navigate behavior that focuses the browser tab and routes to the relevant run.

**Tech Stack:** Web Notifications API, lit-html, Shoelace Web Components (sl-switch, sl-details), existing reactive store and WebSocket client.

---

## 1. Notification Events

The following pipeline events trigger browser notifications. Each has an event key used in preferences and a severity level that determines default behavior.

| Event Key | Trigger Condition | Severity | Default |
|---|---|---|---|
| `run_completed` | Run reaches terminal state with all stages `completed` | info | on |
| `run_failed` | Run reaches terminal state with any stage in `error` | critical | on |
| `approval_needed` | Stage `plan` or `pr` enters `waiting_approval` status | critical | on |
| `test_failures` | Stage `test` iteration ends with `failed` result | warning | on |
| `loop_limit_warning` | Any stage loop iteration count reaches `max - 1` (one away from limit) | warning | on |

### Event Detection Logic

Events are detected by diffing the previous run state against incoming `run-snapshot` / `run-update` WebSocket payloads:

- **run_completed:** `run.active` transitions from `true` to `false` AND no stage has `status === 'error'`.
- **run_failed:** `run.active` transitions from `true` to `false` AND at least one stage has `status === 'error'`.
- **approval_needed:** Any stage's `status` transitions to `'waiting_approval'` (does not exist in the previous snapshot or was a different value).
- **test_failures:** The `test` stage gains a new iteration entry whose result is `'failed'`.
- **loop_limit_warning:** For any stage with a configured loop limit (from `settings.worca.loops`), the iteration count reaches `limit - 1`. Only fires once per stage per run (tracked via a `Set` of already-warned stage keys).

---

## 2. Web Notifications API Integration

### 2a. Permission Request Flow

The browser requires explicit user permission before showing notifications. The permission request must be triggered by a user gesture (click).

**Permission states:** `'default'` (not yet asked), `'granted'`, `'denied'`.

- On app boot, read `Notification.permission` and store it in module state.
- When permission is `'default'`, show a non-intrusive prompt banner at the top of the main content area: "Enable browser notifications to stay informed about pipeline events" with an "Enable" button.
- Clicking "Enable" calls `Notification.requestPermission()` and stores the result.
- If `'denied'`, the banner changes to: "Notifications blocked. Enable in browser settings." (no button, dismissible).
- If `'granted'`, the banner disappears and the notification toggles in Settings become active.
- The banner is rendered by the notification manager and injected into the main render via a function call from `main.js`.

### 2b. Notification Content

Each event type maps to specific notification content:

| Event Key | Title | Body | Tag (dedup) |
|---|---|---|---|
| `run_completed` | "Pipeline Complete" | `"{run title}" finished successfully` | `worca-complete-{runId}` |
| `run_failed` | "Pipeline Failed" | `"{run title}" failed at {stage} stage` | `worca-failed-{runId}` |
| `approval_needed` | "Approval Required" | `"{run title}" is waiting for {plan/PR} approval` | `worca-approval-{runId}-{stage}` |
| `test_failures` | "Tests Failed" | `"{run title}" test iteration {N} failed` | `worca-test-{runId}-iter{N}` |
| `loop_limit_warning` | "Loop Limit Warning" | `"{run title}" {stage} stage approaching loop limit ({N}/{max})` | `worca-loop-{runId}-{stage}` |

- `icon`: Use `/favicon.svg` (or a pipeline-specific icon if one exists; fall back to the app favicon).
- `requireInteraction`: `true` for `approval_needed` (keeps notification visible until dismissed). `false` for all others.
- `tag`: Prevents duplicate notifications for the same event on the same run.

### 2c. Click Behavior

When the user clicks a notification:

- Call `window.focus()` to bring the browser tab to front.
- Navigate to the relevant run detail view using `navigate('active', runId)` (imported from `router.js`).
- Close the notification via `notification.close()`.

This is done by setting an `onclick` handler on the `Notification` object when it is created.

---

## 3. Notification Preferences

### 3a. Preference Schema

Stored in `~/.worca/preferences.json` under a `notifications` key:

```
{
  "theme": "dark",
  "notifications": {
    "enabled": true,
    "sound": false,
    "events": {
      "run_completed": true,
      "run_failed": true,
      "approval_needed": true,
      "test_failures": true,
      "loop_limit_warning": true
    }
  }
}
```

- `notifications.enabled`: Master toggle. When `false`, no notifications fire regardless of per-event settings.
- `notifications.sound`: When `true`, play a short audio cue for `critical` severity events (`run_failed`, `approval_needed`).
- `notifications.events.*`: Per-event-type toggles.

### 3b. Defaults

All events default to `true`. Sound defaults to `false`. Master toggle defaults to `true`.

### 3c. Persistence

Preferences are read/written via the existing `get-preferences` / `set-preferences` WebSocket messages, which call `readPreferences()` / `writePreferences()` on the server. No new server-side code is needed for storage -- the existing merge logic in `server/ws.js` (`set-preferences` handler at line 468) merges arbitrary keys into `preferences.json`.

---

## 4. Frontend Module Design

### New file: `.claude/worca-ui/app/notifications.js`

This is a self-contained module exporting a notification manager object.

**Exports:**

- `createNotificationManager({ store, ws, getSettings })` -- factory function returning the manager.

**Manager object API:**

- `manager.checkPermission()` -- returns current `Notification.permission` string.
- `manager.requestPermission()` -- calls `Notification.requestPermission()`, updates internal state.
- `manager.handleRunUpdate(runId, newRun, prevRun)` -- called from `main.js` when `run-snapshot` or `run-update` arrives. Performs event detection and fires notifications if appropriate.
- `manager.renderBanner()` -- returns a lit-html template for the permission prompt banner (or `nothing` if not needed).
- `manager.getPreferences()` -- returns current notification preferences from the store.
- `manager.dispose()` -- cleans up any resources (audio elements, etc).

**Internal state (module-scoped within the factory closure):**

- `permissionState` -- cached `Notification.permission`.
- `warnedLoops` -- `Set<string>` tracking `{runId}-{stage}` keys that have already fired loop warnings.
- `previousRuns` -- `Map<string, object>` storing the last-seen run snapshot for diffing.
- `audioElement` -- lazily created `Audio` element for sound notifications.
- `bannerDismissed` -- boolean, true if user dismissed the "denied" banner.

**Detection flow inside `handleRunUpdate`:**

1. Retrieve notification prefs from `store.getState().preferences.notifications`.
2. If `!enabled` or `Notification.permission !== 'granted'`, return early.
3. Get `prevRun` from `previousRuns` map. Store `newRun` as new previous.
4. Run each detector function (one per event type). Each returns `null` or a notification descriptor `{ event, title, body, tag, requireInteraction, runId }`.
5. For each non-null descriptor, check `events[descriptor.event]` preference. If enabled, call `fireNotification(descriptor)`.
6. `fireNotification` creates a `new Notification(title, { body, icon, tag, requireInteraction })`, sets `onclick`, and optionally plays sound.

---

## 5. Integration with Existing Code

### 5a. Hooking into WebSocket events (`main.js`)

The `run-snapshot` and `run-update` handlers in `main.js` (lines 55-69) already call `store.setRun(payload.id, payload)`. The notification manager needs to intercept these payloads **before** the store update, to have access to both old and new state.

**Approach:** Wrap the existing handlers to call `manager.handleRunUpdate()` before updating the store.

### 5b. Rendering the permission banner (`main.js`)

In the `rerender()` function (line 403), insert `manager.renderBanner()` just inside the `<main>` element, above `contentHeaderView()`.

### 5c. State store changes (`state.js`)

The `preferences` object in the store initializer (line 12-15) and the equality check (lines 35-41) need to accommodate nested `notifications` preferences. Since the store already does a shallow spread on `preferences`, and the notification manager reads `preferences.notifications` as an opaque object, no deep-equality changes are needed -- any `setState({ preferences: { notifications: {...} } })` call will always trigger a re-render because the `notifications` sub-object reference will change. However, the equality check on line 39-40 only compares `theme` and `sidebarCollapsed`. It must also compare the `notifications` reference.

### 5d. Settings view changes (`views/settings.js`)

Add notification controls to the existing Preferences tab inside `preferencesTab()` (line 349).

### 5e. Accessing loop limits for `loop_limit_warning`

The loop limit configuration comes from `settings.worca.loops` which is loaded via `list-runs` response (stored in module-level `settings` variable in `main.js`, line 39). The notification manager needs access to this, hence the `getSettings` parameter in the factory.

---

## 6. Implementation Tasks

### Task 1: Create the notification manager module

**Files:**
- Create: `.claude/worca-ui/app/notifications.js`

**Changes:**
- Define `NOTIFICATION_EVENTS` constant array: `['run_completed', 'run_failed', 'approval_needed', 'test_failures', 'loop_limit_warning']`.
- Define `EVENT_CONFIG` map with `{ severity, defaultEnabled, title, bodyTemplate, requireInteraction }` for each event.
- Implement `createNotificationManager({ store, ws, getSettings })` factory:
  - Initialize `permissionState` from `Notification.permission` (guard with `typeof Notification !== 'undefined'` for SSR safety).
  - Implement `checkPermission()` returning the cached state.
  - Implement `requestPermission()` calling the browser API, updating `permissionState`.
  - Implement `handleRunUpdate(runId, newRun, prevRun)`:
    - Guard: return if notifications not supported, not granted, or master toggle off.
    - Call each detector: `detectRunCompleted`, `detectRunFailed`, `detectApprovalNeeded`, `detectTestFailures`, `detectLoopLimitWarning`.
    - Each detector receives `(runId, newRun, prevRun, settings)` and returns a descriptor or `null`.
    - For `detectLoopLimitWarning`, use `getSettings()` to access `worca.loops` and check `warnedLoops` set.
    - Fire each valid descriptor via `fireNotification()`.
  - Implement `fireNotification({ event, title, body, tag, requireInteraction, runId })`:
    - Create `new Notification(title, { body, icon: '/favicon.svg', tag, requireInteraction })`.
    - Set `notification.onclick` to call `window.focus()`, `navigate('active', runId)`, `notification.close()`.
    - If `sound === true` and event severity is `critical`, play a short beep via an `Audio` element with a data-URI encoded tone (or a small bundled wav file).
  - Implement `renderBanner()`:
    - If `Notification.permission === 'default'`: return a lit-html template with an info banner and "Enable Notifications" button. The button calls `requestPermission()` then triggers a re-render.
    - If `Notification.permission === 'denied'` and not dismissed: return a warning banner with dismiss button.
    - Otherwise return `nothing`.
  - Implement `getPreferences()` reading from `store.getState().preferences.notifications` with defaults applied.
  - Implement `dispose()` to clean up audio element.

---

### Task 2: Update state store equality check

**Files:**
- Modify: `.claude/worca-ui/app/state.js`

**Changes:**
- In the `setState` method (line 29), extend the equality check on lines 35-41 to also compare `next.preferences.notifications === state.preferences.notifications`. Add it as an additional `&&` condition in the `if` guard. This ensures that notification preference changes trigger re-renders.
- In the initial state (line 12-15), add `notifications: initial.preferences?.notifications ?? null` to the preferences default so the key exists from the start.
- In the `setState` merge on line 33, no change needed -- the existing spread `{ ...state.preferences, ...(patch.preferences || {}) }` already handles adding `notifications`.

---

### Task 3: Integrate notification manager into main.js

**Files:**
- Modify: `.claude/worca-ui/app/main.js`

**Changes:**

**Step 3a: Import and create the manager.**
- Add import: `import { createNotificationManager } from './notifications.js';`
- After `const ws = createWsClient();` (line 33), add:
  `const notificationManager = createNotificationManager({ store, ws, getSettings: () => settings });`

**Step 3b: Hook into run-snapshot and run-update handlers.**
- In the `ws.on('run-snapshot', ...)` handler (line 55), before `store.setRun(payload.id, payload)`:
  - Get previous run state: `const prevRun = store.getState().runs[payload.id] ?? null;`
  - Call: `notificationManager.handleRunUpdate(payload.id, payload, prevRun);`
- Apply the same pattern to the `ws.on('run-update', ...)` handler (line 65).

**Step 3c: Render the permission banner.**
- In the `rerender()` function, inside the `<main class="main-content">` template (line 413), insert `${notificationManager.renderBanner()}` as the first child, before `${contentHeaderView()}`.

---

### Task 4: Add notification preferences UI to Settings

**Files:**
- Modify: `.claude/worca-ui/app/views/settings.js`

**Changes:**

**Step 4a: Import the Bell icon.**
- Add `Bell` to the icon imports from `'../utils/icons.js'`. If `Bell` does not exist in `icons.js`, add a Bell SVG path constant to `icons.js` first (simple bell outline, 24x24 viewBox, single path).

**Step 4b: Add a "Notifications" tab to the settings tab group.**
- In `settingsView()` (line 389), add a new `<sl-tab>` and `<sl-tab-panel>` pair after the Preferences tab:
  ```
  <sl-tab slot="nav" panel="notifications">{Bell icon} Notifications</sl-tab>
  <sl-tab-panel name="notifications">{notificationsTab(preferences, rerender)}</sl-tab-panel>
  ```

**Step 4c: Implement the `notificationsTab(preferences, rerender)` function.**
- Render a "Browser Notifications" section title.
- Show current permission status as a badge: "Granted" (success), "Blocked" (danger), or "Not Yet Asked" (neutral).
- If permission is `'default'`, show an "Enable Notifications" button that calls `Notification.requestPermission()`.
- Render a master toggle: `<sl-switch id="notif-enabled">` bound to `notifications.enabled`.
- Render a "Sound for critical events" toggle: `<sl-switch id="notif-sound">` bound to `notifications.sound`.
- Render a "Notification Events" sub-section with one `<sl-switch>` per event type:
  - `id="notif-evt-run_completed"` -- "Run Completed"
  - `id="notif-evt-run_failed"` -- "Run Failed"
  - `id="notif-evt-approval_needed"` -- "Approval Required"
  - `id="notif-evt-test_failures"` -- "Test Failures"
  - `id="notif-evt-loop_limit_warning"` -- "Loop Limit Warning"
  - Each has a brief description string rendered as `.settings-switch-desc`.
- Render a "Save Notifications" button that:
  - Reads all switch states from DOM via `document.getElementById()`.
  - Constructs a `notifications` object.
  - Calls the existing `savePreferences` pattern: `ws.send('set-preferences', { notifications: { ... } })` (requires passing `ws` or a callback down -- see approach below).

**Step 4d: Plumb notification save through to preferences.**
- The `preferencesTab` currently receives `(preferences, onThemeToggle)`. Extend the callbacks object to include `onSaveNotifications(notifPrefs)`.
- In `main.js`, define `handleSaveNotifications(notifPrefs)` which calls `ws.send('set-preferences', { notifications: notifPrefs })` and updates the store.
- Pass it through: `settingsView(state.preferences, { rerender, onThemeToggle: handleThemeToggle, onSaveNotifications: handleSaveNotifications })`.
- Update `settingsView` signature and thread it to `notificationsTab`.

---

### Task 5: Add Bell icon to icons utility

**Files:**
- Modify: `.claude/worca-ui/app/utils/icons.js`

**Changes:**
- Add a `Bell` constant with the Lucide bell icon SVG path data (single `<path>` element).
- Export it alongside the existing icon constants.

---

### Task 6: Add notification banner CSS

**Files:**
- Modify: `.claude/worca-ui/app/styles.css` (or wherever global styles live)

**Changes:**
- Add `.notification-banner` class: flex row, padding 0.75rem 1rem, border-radius 8px, gap 0.75rem, align-items center, margin-bottom 1rem.
- `.notification-banner--info`: background `var(--sl-color-primary-50)`, border `1px solid var(--sl-color-primary-200)`.
- `.notification-banner--warning`: background `var(--sl-color-warning-50)`, border `1px solid var(--sl-color-warning-200)`.
- `.notification-banner-text`: flex 1, font-size 0.875rem.
- `.notification-banner-btn`: no extra styles needed (uses `<sl-button>` directly).
- `.notification-banner-dismiss`: cursor pointer, no border/bg, opacity 0.6, hover 1.0.

---

### Task 7: Add notification sound asset

**Files:**
- Create: `.claude/worca-ui/app/assets/notify.mp3` (or use a base64 data URI inline)

**Changes:**
- Option A (preferred): Embed a short sine-wave beep as a base64 data URI in `notifications.js`. This avoids adding a binary asset. Generate a ~200ms 440Hz tone programmatically using `AudioContext` in the `playSound()` function instead of loading a file.
- Option B: Add a small MP3 file (< 5KB) and reference it as `/assets/notify.mp3`.
- The plan recommends Option A (AudioContext) to keep the project dependency-free. Implement `playSound()` in `notifications.js`:
  - Create an `AudioContext` lazily (reuse across calls).
  - Create an `OscillatorNode` at 440Hz, connect to destination, start for 200ms, then stop.
  - Wrap in try/catch for browsers that block autoplay.

---

### Task 8: Update protocol.js MESSAGE_TYPES (if needed)

**Files:**
- Review: `.claude/worca-ui/app/protocol.js`

**Changes:**
- No changes needed. The `set-preferences` message type already exists and handles arbitrary preference keys. The notification preferences piggyback on the existing `set-preferences` / `get-preferences` flow.

---

### Task 9: Add the `stop-run` and `resume-run` to MESSAGE_TYPES

**Files:**
- Review: `.claude/worca-ui/app/protocol.js`

**Changes:**
- **NOTE:** This is a pre-existing gap unrelated to notifications. The `stop-run` and `resume-run` message types are handled by the server but not listed in `MESSAGE_TYPES` on line 8. If the `ws.send()` call for these types is failing due to the `MESSAGE_TYPES.includes(type)` guard in `ws.js` line 139, they need to be added. However, since `main.js` already calls `ws.send('stop-run')` and it works, either the guard is not enforced or they were added elsewhere. **Skip this task if stop/resume already work.** Otherwise, add `'stop-run'` and `'resume-run'` to the `MESSAGE_TYPES` array.

---

## 7. Testing Strategy

Browser notifications cannot be meaningfully unit-tested because:
- `Notification` constructor is not available in Node.js test environments.
- Permission state is a browser-level API.
- The `onclick` behavior requires a real browser context.

### Manual Testing Checklist

| # | Test Case | Steps | Expected Result |
|---|---|---|---|
| 1 | Permission prompt appears | Open app in browser with notifications permission reset (clear site data). | Info banner appears at top of main content: "Enable browser notifications..." with Enable button. |
| 2 | Grant permission | Click "Enable" on the banner. Click "Allow" in browser prompt. | Banner disappears. `Notification.permission` is `'granted'`. |
| 3 | Deny permission | Click "Enable" on the banner. Click "Block" in browser prompt. | Banner changes to "Notifications blocked" with dismiss button. |
| 4 | Dismiss denied banner | Click dismiss (X) on the "blocked" banner. | Banner disappears for the session. |
| 5 | Run completed notification | Start a pipeline run. Wait for successful completion. | Browser notification: "Pipeline Complete" with run title in body. |
| 6 | Run failed notification | Start a pipeline run that will fail (e.g., invalid test). | Browser notification: "Pipeline Failed" with failing stage name. |
| 7 | Approval needed notification | Start a pipeline run. Wait for plan approval gate. | Browser notification: "Approval Required" with run title. Notification stays visible (`requireInteraction`). |
| 8 | Test failures notification | Start a run where tests will fail. | Browser notification: "Tests Failed" with iteration number. |
| 9 | Loop limit warning | Configure a loop limit of 2. Run pipeline that loops. When iteration reaches 1 (limit - 1), notification fires. | Browser notification: "Loop Limit Warning" with stage and count. Only fires once per stage per run. |
| 10 | Click notification navigates | Click any notification from tests 5-9. | Browser tab focuses. App navigates to the run detail view for the correct run. |
| 11 | Master toggle off | Go to Settings > Notifications. Disable master toggle. Trigger an event. | No notification appears. |
| 12 | Per-event toggle off | Disable only "Run Completed". Complete a run. | No notification for completion. Other events still fire. |
| 13 | Sound plays on critical | Enable sound toggle. Trigger a `run_failed` event. | Short beep plays alongside the notification. |
| 14 | Sound silent on non-critical | Enable sound toggle. Trigger `run_completed`. | No sound, only visual notification. |
| 15 | No duplicate notifications | Trigger the same event twice rapidly (e.g., two fast `run-update` messages). | Only one notification visible (same `tag` replaces). |
| 16 | Preferences persist | Toggle some notification settings. Refresh the page. Go to Settings > Notifications. | Saved state is restored. |
| 17 | Tab already focused | Trigger an event while the worca-ui tab is already focused and visible. | Notification still fires (user may have the tab open but be looking at another monitor). |
| 18 | Settings UI states | With permission denied: notification toggles should be visually disabled/grayed out with a note. | Toggles are disabled when permission is not granted. |

### Automated Testing (Limited)

The event detection logic (the `detect*` functions) can be unit-tested in isolation since they are pure functions that take old/new run state and return notification descriptors:

- Create: `.claude/worca-ui/app/notifications.test.js`
- Test each detector with mock run data:
  - `detectRunCompleted` returns descriptor when `active` goes `true` -> `false` with no errors.
  - `detectRunCompleted` returns `null` when run has errors (that is `detectRunFailed`).
  - `detectRunFailed` returns descriptor with the failed stage name in the body.
  - `detectApprovalNeeded` returns descriptor when a stage transitions to `waiting_approval`.
  - `detectTestFailures` returns descriptor when test iterations increase with a failed result.
  - `detectLoopLimitWarning` returns descriptor at `limit - 1`, returns `null` at lower counts, and returns `null` on second call for same stage (dedup via `warnedLoops`).
- These tests use plain objects, no mocking of `Notification` needed.
- Export the detector functions separately (named exports alongside the factory) to make them testable.

---

## 8. File Summary

| Action | File Path | Description |
|---|---|---|
| Create | `.claude/worca-ui/app/notifications.js` | Notification manager module with event detection, permission flow, and notification firing |
| Create | `.claude/worca-ui/app/notifications.test.js` | Unit tests for event detector functions |
| Modify | `.claude/worca-ui/app/main.js` | Import manager, hook into WS handlers, render permission banner |
| Modify | `.claude/worca-ui/app/state.js` | Add `notifications` to preferences defaults and equality check |
| Modify | `.claude/worca-ui/app/views/settings.js` | Add Notifications tab with per-event toggles and permission status |
| Modify | `.claude/worca-ui/app/utils/icons.js` | Add Bell icon SVG path constant |
| Modify | `.claude/worca-ui/app/styles.css` | Add notification banner CSS classes |

---

## 9. Sequencing and Dependencies

```
Task 5 (Bell icon)     ──┐
Task 6 (Banner CSS)    ──┼── Task 1 (notifications.js) ── Task 3 (main.js integration)
Task 2 (state.js)      ──┘                               Task 4 (settings UI)
Task 7 (sound)         ── included in Task 1
```

- Tasks 2, 5, 6 can be done in parallel (no dependencies on each other).
- Task 1 depends on Task 5 (needs Bell icon for banner) and Task 6 (banner CSS).
- Task 3 depends on Tasks 1 and 2.
- Task 4 depends on Tasks 1, 3, and 5.
- Task 7 is implemented inline within Task 1 (AudioContext approach).
- Task 8 is a review-only step, no code changes expected.

---

## 10. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Browser blocks notification permission request if not triggered by user gesture | Always call `requestPermission()` from a click handler, never on page load. |
| AudioContext blocked by browser autoplay policy | Wrap in try/catch. Create AudioContext on first user interaction (the Enable button click also serves as the gesture). |
| Notification spam if pipeline sends rapid state updates | Use `tag` property for dedup. Debounce is not needed because the `tag` replaces existing notifications with the same tag. |
| Service worker not available (required for some notification features on some browsers) | We use simple `new Notification()` which works without a service worker in most desktop browsers. Service worker notifications are out of scope. |
| User has multiple tabs open to worca-ui | Each tab fires its own notification. The `tag` property ensures the OS deduplicates them into one visible notification. |
| `Notification` API not available (e.g., insecure context, old browser) | Guard all access with `typeof Notification !== 'undefined'`. Degrade gracefully -- banner shows "Notifications not supported in this browser." |
