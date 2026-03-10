# E2E Visual Test Procedures

Manual visual tests using Playwright MCP browser tools.

## Prerequisites

1. Start the dev server: `node bin/serve.js`
2. Open browser to `http://localhost:3000`

## Test Cases

### 1. Sidebar Renders
- [ ] Sidebar appears on left side with WORCA logo
- [ ] "Running" and "History" nav items visible under "Pipeline" section
- [ ] "New Pipeline" button visible
- [ ] Settings button at bottom of sidebar
- [ ] Connection indicator shows "Connected" (green dot)

### 2. Theme Toggle
- [ ] Navigate to Settings page via sidebar button
- [ ] Toggle theme from light to dark
- [ ] Verify background, text, and component colors update
- [ ] Refresh page — theme persists

### 3. Empty Dashboard
- [ ] On first load, dashboard shows stat cards (Total: 0, Active: 0, Completed: 0, Errors: 0)
- [ ] "No running pipelines" empty state shown
- [ ] "New Pipeline" button visible

### 4. Active Run Appears
- [ ] Start a pipeline run externally
- [ ] Dashboard active count increments
- [ ] Sidebar "Running" badge count updates
- [ ] Run card appears in Active Runs section with title, branch, status badge

### 5. Run Detail
- [ ] Click on a run card to navigate to run detail
- [ ] Run header shows title, status badge, branch, duration
- [ ] PR link visible if `pr_url` present
- [ ] Timing strip shows Started/Finished/Duration
- [ ] Pipeline cost shown when iterations have `cost_usd`

### 6. Stage Timeline States
- [ ] Pending stages show circle icon (gray)
- [ ] In-progress stage shows spinner icon with pulse animation
- [ ] Completed stages show check icon (green)
- [ ] Error stages show alert icon (red)
- [ ] Interrupted stages show pause icon (yellow) for inactive runs
- [ ] Connector lines between stages, completed connectors highlighted
- [ ] Loop indicator shows iteration count with refresh icon

### 7. Stage Detail Panels
- [ ] Each stage has an expandable panel (sl-details)
- [ ] In-progress stage auto-expanded
- [ ] Panel header shows icon, label, iteration count, cost, time, duration, status badge
- [ ] Single iteration: shows timing strip, agent/model info, turns, cost
- [ ] Multiple iterations: shows tab group with tabs per iteration
- [ ] Copy button copies stage data as JSON
- [ ] Agent Instructions section expandable with user prompt and system prompt

### 8. Log Viewer
- [ ] Log History panel at bottom of run detail (collapsible)
- [ ] Stage filter dropdown lists orchestrator + pipeline stages
- [ ] Selecting a stage loads xterm terminal with colored log output
- [ ] Iteration selector appears when stage has multiple iterations
- [ ] Search input filters within terminal (xterm search addon)
- [ ] Auto-scroll toggle (Auto/Paused)
- [ ] Without stage selected: shows "Select a stage" prompt

### 9. Generic Stages
- [ ] Stages are derived entirely from data (status.json)
- [ ] No hardcoded stage names — adding a new stage key renders correctly
- [ ] Stage labels come from settings `ui.stages[key].label` or title-cased key

### 10. Connection Status
- [ ] When server is running: green dot, "Connected"
- [ ] Stop server: dot turns red, "Disconnected"
- [ ] Restart server: auto-reconnects, dot turns green, "Connected"
- [ ] During reconnect: "Reconnecting..." shown

### 11. Live Update
- [ ] With run in progress, stage status changes reflect in real-time
- [ ] Stage timeline updates as stages complete
- [ ] Run card status badge updates
- [ ] Log lines stream in real-time to terminal

### 12. Run List Views
- [ ] "Running" section shows only active runs
- [ ] "History" section shows only completed/inactive runs
- [ ] Empty states shown when no runs match filter

### 13. New Pipeline Page
- [ ] "New Pipeline" button opens new-run form
- [ ] Form fields for prompt, branch, model selection
- [ ] Submit starts a pipeline run
