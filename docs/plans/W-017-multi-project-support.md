# W-017: Multi-Project Support


**Goal:** Allow a single worca-ui server instance to monitor multiple project directories simultaneously. Developers who work across several repos currently must run one server per project; after this change, they register all project paths in a global config file and switch between them via a sidebar project picker or view them aggregated on a cross-project dashboard.

**Architecture:** A global config file at `~/.worca/projects.json` holds a list of named project roots. The Express server reads this file at startup and exposes it via a new `GET/POST /api/projects` endpoint. The WebSocket server creates one independent set of file watchers per registered project (each watching its own `.worca/` directory). The client adds a project slug to every WebSocket message that carries run data, uses a two-level `project → run` state shape, extends the router to include a `project` segment, and renders a project picker in the sidebar above the navigation items. The existing single-project behaviour is preserved as the "default" case when only one project is registered.

**Tech Stack:** Node.js `fs.watch`, Express REST API, lit-html, Shoelace select/badge/dialog components, existing WebSocket infrastructure. No new runtime dependencies.

**Depends on:** W-000 Settings REST API (already complete). Requires no changes to the Python pipeline itself.

---

## 1. Scope and Boundaries

### In scope
- `~/.worca/projects.json` config file: list of `{ name, path }` records
- `GET /api/projects` — return the registered project list
- `POST /api/projects` — add or remove a project entry (name + absolute path)
- Multi-project WebSocket server: one watcher set per project, all multiplexed over the single `/ws` connection
- All existing WebSocket messages gain an optional `project` field; server fills it in on every outbound event so the client can route correctly
- Client state: two-level map `{ [projectSlug]: { [runId]: run } }`
- Router extension: `#/project/{slug}/active`, `#/project/{slug}/history`, `#/project/{slug}/active?run=...`; legacy `#/active`, `#/history` routes continue to work and resolve to the default (first) project
- Sidebar project picker: a compact `<sl-select>` or clickable list above the Pipeline section, with an "All Projects" option
- Aggregated dashboard view: shows one summary card per project (active run count, last run status, last run title)
- "Add Project" dialog in Settings for registering new paths
- `list-runs` WebSocket response extended to carry `project` on each run record
- Rebuild frontend bundle after all frontend changes

### Out of scope
- Per-project authentication or access control
- Running pipelines on a different project than the one the server started from (process manager remains project-local)
- Merging or comparing run histories across projects
- Remote project directories (network paths untested, local FS only)
- Auto-discovery of projects from the filesystem

---

## 2. Config File Format

**Path:** `~/.worca/projects.json`

```json
{
  "projects": [
    { "name": "worca-cc",  "path": "/Users/alice/dev/worca-cc" },
    { "name": "my-api",    "path": "/Users/alice/dev/my-api" },
    { "name": "frontend",  "path": "/Users/alice/dev/frontend" }
  ]
}
```

**Rules:**
- `name` — URL-safe slug (letters, digits, hyphens, underscores; max 64 chars). Must be unique within the list. Used as the route segment and as the identifier in WebSocket messages.
- `path` — absolute path to the project root. The server derives `{path}/.worca` as the worcaDir for that project.
- Order in the array determines display order in the sidebar and which project is treated as the default (index 0) when no project slug is in the route.
- If the file does not exist the server synthesises a single default project from the current working directory (same behaviour as today), so no migration is required for existing single-project users.

**Derived slugs:** If the user provides a name that is not a valid slug, the server normalises it on write (lowercase, replace spaces and invalid chars with `-`).

---

## 3. REST API Design

All endpoints follow the existing convention: `{ ok: true, ...data }` on success, `{ ok: false, error: { code, message } }` on failure.

### `GET /api/projects`

Returns the current project list from `~/.worca/projects.json`.

**Response:**
```json
{ "ok": true, "projects": [ { "name": "worca-cc", "path": "/..." } ] }
```

### `POST /api/projects`

Replace the entire project list (the client sends the full updated array after an add or remove operation).

**Request body:**
```json
{ "projects": [ { "name": "...", "path": "..." } ] }
```

**Validation rules:**
- `projects` must be an array
- Each entry must have `name` (non-empty string, max 64 chars, valid slug pattern) and `path` (non-empty string, must be an absolute path)
- Duplicate names rejected (400)
- Maximum 20 projects (400 if exceeded)

**Response on success:**
```json
{ "ok": true, "projects": [ ... ] }
```

After a successful write, the server broadcasts a `projects-updated` WebSocket event with the new list so all connected clients update without a page refresh.

**Response on error:**
```json
HTTP 400: { "ok": false, "error": { "code": "validation_error", "message": "..." } }
```

---

## 4. WebSocket Protocol Changes

The current protocol uses a flat namespace with no project routing. This plan adds a `project` field to relevant message payloads. The single WebSocket connection (`/ws`) continues to serve all projects; the server fills in `project` on every outbound event, and the client includes `project` in subscriptions so the server can scope file-watcher delivery.

### Outbound events (server → client)

**`runs-list`** — extended to carry a `project` field and to batch all projects in one message:
```json
{
  "type": "runs-list",
  "payload": {
    "project": "worca-cc",
    "runs": [ ... ],
    "settings": { ... }
  }
}
```

The server emits one `runs-list` event per project on initial connection and on any file-system change. Clients merge them by `project` into the two-level state map.

**`run-snapshot`** and **`run-update`** — extended with `project`:
```json
{ "type": "run-snapshot", "payload": { "project": "worca-cc", "id": "abc123", ... } }
```

**`projects-updated`** — new broadcast event, emitted after `POST /api/projects` succeeds:
```json
{ "type": "projects-updated", "payload": { "projects": [ ... ] } }
```

### Inbound requests (client → server)

**`list-runs`** — gains an optional `project` field. If omitted, the server responds with data for all projects (one `runs-list` broadcast per project). If supplied, the server scopes to that project only.

**`subscribe-run`** — gains a required `project` field:
```json
{ "type": "subscribe-run", "payload": { "project": "worca-cc", "runId": "abc123" } }
```

**`subscribe-log`** — gains a required `project` field:
```json
{ "type": "subscribe-log", "payload": { "project": "worca-cc", "runId": "abc123", "stage": null } }
```

**`stop-run`**, **`resume-run`**, **`get-agent-prompt`** — each gains a `project` field so the server knows which worcaDir to operate on.

**`get-preferences`**, **`set-preferences`** — no change (preferences are global, not per-project).

### Backward compatibility

If a client sends a message without a `project` field, the server defaults to the first project in the list (index 0). This preserves compatibility with any external tooling that connects to the existing WebSocket API.

---

## 5. Server Architecture Changes

### 5.1 Project Registry Module (`server/project-registry.js`)

A new module responsible for reading and writing `~/.worca/projects.json`, synthesising the default single-project entry, and validating slugs.

**Exports:**

`readProjects(prefsDir)` — reads `{prefsDir}/projects.json`. Returns `Array<{ name, path, worcaDir }>` where `worcaDir = join(path, '.worca')`. If the file does not exist, returns a synthetic single-project entry derived from `process.cwd()`.

`writeProjects(prefsDir, projects)` — validates and writes the array to `{prefsDir}/projects.json`. Returns the normalised array. Throws with a structured error on validation failure.

`validateProjectEntry({ name, path })` — validates a single entry. Returns `{ valid, error }`.

`slugify(name)` — normalises a human name to a URL-safe slug.

### 5.2 Multi-Project WebSocket Server (`server/ws.js`)

The `attachWsServer` function currently accepts a single `{ worcaDir, settingsPath, prefsPath }` config. It will be refactored to accept a `projects` array (derived from the project registry) and create one independent watcher set per project.

**Data structures inside `attachWsServer`:**

```js
// Map from project name to its watcher state
const projectWatchers = new Map(); // name → { worcaDir, statusWatcher, activeRunWatcher, logWatchers, logLineCounts, watchedRunDir }
```

**`setupProjectWatchers(project)`** — a new internal function that replicates the current single-project watcher setup (statusWatcher, activeRunWatcher, logWatchers) for one project entry and stores the handles in `projectWatchers`. Called once per project at startup.

**`scheduleRefresh(projectName)`** — debounced refresh for a specific project. Calls `discoverRuns(worcaDir)` for that project and broadcasts `runs-list` with `{ project: projectName, runs, settings }`.

**`resolveProject(projectName)`** — looks up a project by name in `projectWatchers`. Falls back to the first project if `projectName` is falsy or unknown.

**Subscription tracking** — the per-client `subs` WeakMap is extended:
```js
{ runId: string | null, logStage: string | null, project: string | null }
```

All `broadcastToSubscribers` and `broadcastToLogSubscribers` helpers gain a `project` parameter and filter by both project and runId/stage.

**`stop-run` / `resume-run`** — extract `project` from `req.payload`, resolve the worcaDir, proceed as before.

**`list-runs` with no project** — iterate all registered projects, call `discoverRuns` for each, send one `runs-list` message per project (or batch them if client requested all).

### 5.3 `server/index.js`

Read the project registry at startup. Pass the full `projects` array to both `createApp` and `attachWsServer`.

```js
import { readProjects } from './project-registry.js';
import { homedir } from 'node:os';

const prefsDir = join(homedir(), '.worca');
const projects = readProjects(prefsDir);

const app = createApp({ settingsPath, worcaDir: projects[0].worcaDir, projects, prefsDir });
const server = createServer(app);
const { broadcast } = attachWsServer(server, {
  projects,
  settingsPath,
  prefsPath: join(prefsDir, 'preferences.json'),
});
app.locals.broadcast = broadcast;
```

The `worcaDir` passed to `createApp` remains the first project's worcaDir for backward compatibility with the settings endpoint (which is per-project-root).

### 5.4 `server/app.js`

Add `projects` and `prefsDir` to the `options` object. Add two new route handlers before the static middleware:

**`GET /api/projects`:**
```js
app.get('/api/projects', (_req, res) => {
  try {
    const projects = readProjects(options.prefsDir);
    res.json({ ok: true, projects: projects.map(({ name, path }) => ({ name, path })) });
  } catch (err) {
    res.status(500).json({ ok: false, error: { code: 'read_error', message: err.message } });
  }
});
```

**`POST /api/projects`:**
```js
app.post('/api/projects', (req, res) => {
  const { projects } = req.body || {};
  try {
    const saved = writeProjects(options.prefsDir, projects);
    // Notify all WS clients
    if (app.locals.broadcast) {
      app.locals.broadcast('projects-updated', { projects: saved.map(({ name, path }) => ({ name, path })) });
    }
    res.json({ ok: true, projects: saved.map(({ name, path }) => ({ name, path })) });
  } catch (err) {
    const status = err.code === 'validation_error' ? 400 : 500;
    res.status(status).json({ ok: false, error: { code: err.code || 'error', message: err.message } });
  }
});
```

---

## 6. Client-Side Architecture Changes

### 6.1 State Shape (`app/state.js`)

The current state has a flat `runs` map: `{ [runId]: run }`.

New shape:

```js
{
  projects: [],            // Array<{ name, path }> — registered projects
  activeProject: null,     // string | null — currently selected project slug (null = "All")
  projectRuns: {},         // { [projectName]: { [runId]: run } }
  runs: {},                // kept for backward compat — mirrors projectRuns[activeProject] or merged view
  preferences: {},
  logLines: [],
}
```

**`store.setProjectRuns(project, runs)`** — sets `projectRuns[project]` and rebuilds the flat `runs` map from `activeProject`.

**`store.setActiveProject(name)`** — sets `activeProject`, rebuilds the flat `runs` map.

**`store.setProjects(projects)`** — sets the `projects` array.

The flat `runs` map is preserved as a derived view to avoid touching the many call sites in views that read `state.runs`.

### 6.2 Router (`app/router.js`)

Extend `parseHash` and `buildHash` to support the project segment:

**New hash format:** `#/project/{slug}/{section}?run={runId}`

**Legacy format preserved:** `#/{section}?run={runId}` — treated as `project = projects[0].name`.

```js
export function parseHash(hash) {
  const clean = (hash || '').replace(/^#\/?/, '');
  const projectMatch = clean.match(/^project\/([^/]+)\/(.+)/);
  if (projectMatch) {
    const [, project, rest] = projectMatch;
    const [path, query] = rest.split('?');
    const params = new URLSearchParams(query || '');
    return { project, section: path || 'active', runId: params.get('run') || null };
  }
  // Legacy: no project prefix
  const [path, query] = clean.split('?');
  const params = new URLSearchParams(query || '');
  return { project: null, section: path || 'active', runId: params.get('run') || null };
}

export function buildHash(project, section, runId) {
  const base = project ? `#/project/${project}/${section}` : `#/${section}`;
  return runId ? `${base}?run=${runId}` : base;
}

export function navigate(project, section, runId) {
  location.hash = buildHash(project, section, runId);
}
```

All `navigate()` call sites in `main.js` are updated to pass the current project. The legacy two-argument `navigate(section, runId)` form is kept as a shim that passes `null` as the project.

### 6.3 Main (`app/main.js`)

**Route object** gains a `project` field. When `route.project` is null (legacy URL), the code resolves it to `projects[0].name` once the projects list is loaded.

**`handleNavigate(section)`** — updated to `handleNavigate(project, section)`, defaults project to the current active project.

**`handleSelectRun(runId)`** — passes `route.project` to `navigate`.

**`handleSwitchProject(name)`** — new action:
1. Sets `store.setActiveProject(name)`
2. Unsubscribes from current run/logs
3. Navigates to `#/project/{name}/active`
4. Sends `list-runs` with `{ project: name }` to trigger initial data load

**WS event handlers** — updated to extract `payload.project` and call `store.setProjectRuns(project, runs)` instead of `store.setState({ runs })` directly.

**`ws.on('runs-list', ...)`:**
```js
ws.on('runs-list', (payload) => {
  const runs = {};
  for (const run of (payload.runs || [])) runs[run.id] = run;
  store.setProjectRuns(payload.project || projects[0]?.name, runs);
  if (payload.settings) settings = payload.settings;
});
```

**`ws.on('run-snapshot', ...)`** — reads `payload.project` and routes to the correct run slot.

**`ws.on('projects-updated', ...)`** — calls `store.setProjects(payload.projects)` and rerenders.

**Connection handler** — on `open`, iterates all registered projects and sends `list-runs` for each:
```js
for (const p of store.getState().projects) {
  ws.send('list-runs', { project: p.name }).catch(() => {});
}
```

**`subscribe-run` / `subscribe-log`** — include `project: route.project` in the payload.

**`stop-run` / `resume-run`** — include `project: route.project` in the payload.

### 6.4 Sidebar (`app/views/sidebar.js`)

Add a project picker section above the Pipeline section. When only one project is registered, the picker is hidden to preserve the existing look for single-project users.

**New section rendered when `projects.length > 1`:**
```html
<div class="sidebar-section">
  <div class="sidebar-section-header">Project</div>
  ${projects.map(p => html`
    <div class="sidebar-item ${activeProject === p.name ? 'active' : ''}"
         @click=${() => onSwitchProject(p.name)}>
      <span class="sidebar-item-left">
        <span class="project-dot"></span>
        <span>${p.name}</span>
      </span>
      ${projectActiveCount(p.name) > 0
        ? html`<sl-badge variant="primary" pill>${projectActiveCount(p.name)}</sl-badge>`
        : ''}
    </div>
  `)}
  <div class="sidebar-item sidebar-item--add"
       @click=${onAddProject}>
    <span class="sidebar-item-left">
      <span>+ Add project</span>
    </span>
  </div>
</div>
```

The Running / History counts in the Pipeline section reflect only the active project (or all projects if `activeProject` is null/"all").

**Function signature update:**
```js
export function sidebarView(state, route, connectionState, { onNavigate, onSwitchProject, onAddProject })
```

### 6.5 Aggregated Dashboard (`app/views/dashboard.js`)

When `activeProject` is null (the "All Projects" synthetic option), `dashboardView` receives runs from all projects and renders one summary card per project instead of the single-project stats layout.

**Per-project card structure:**
```html
<div class="project-card">
  <div class="project-card-name">${project.name}</div>
  <div class="project-card-stats">
    <span class="stat-label">Active</span>
    <span class="stat-value">${activeCount}</span>
  </div>
  <div class="project-card-last-run">
    <span>${lastRun?.work_request?.title || 'No runs yet'}</span>
    <sl-badge variant="${statusVariant}">${statusLabel}</sl-badge>
  </div>
</div>
```

Clicking a project card calls `onSwitchProject(name)`.

When `activeProject` is set to a specific project, the existing dashboard layout is shown unchanged (filtering `state.runs` to the active project's runs, which is already handled by the state derived view).

### 6.6 Settings View (`app/views/settings.js`)

Add a "Projects" tab (using the existing Shoelace `<sl-tab-group>`) alongside the existing configuration tab.

**Projects tab content:**
- A list of registered projects (name + path), each with a "Remove" button
- An "Add Project" button that opens the add-project dialog
- Inline validation feedback on the path field

**This replaces the dedicated "Add Project" dialog** — the dialog is rendered from within the settings view so it is accessible from both the sidebar "+" shortcut and the settings panel.

### 6.7 Add-Project Dialog (`app/views/add-project-dialog.js`)

A new lit-html component rendered as a `<sl-dialog>`.

**Fields:**
- Project name: `<sl-input label="Name" placeholder="my-project">` — auto-populated by slugifying the directory name when path is entered
- Project path: `<sl-input label="Absolute path" placeholder="/Users/you/dev/my-project">`
- Validation error display

**Submit behaviour:**
1. Reads existing projects from store
2. Appends the new entry
3. Calls `POST /api/projects` with the full updated array
4. On success: closes dialog, broadcasts via the returned `projects-updated` WS event (handled automatically)
5. On error: shows validation error inline

---

## 7. Implementation Tasks

### Task 1: Create `server/project-registry.js`

**Files:**
- Create: `.claude/worca-ui/server/project-registry.js`

Implement the module with no dependencies beyond Node.js built-ins.

**`readProjects(prefsDir)`:**
- Build `filePath = join(prefsDir, 'projects.json')`
- If `!existsSync(filePath)`, return `[{ name: slugify(basename(process.cwd())), path: process.cwd(), worcaDir: join(process.cwd(), '.worca') }]`
- Parse and return the JSON, adding `worcaDir = join(p.path, '.worca')` to each entry

**`writeProjects(prefsDir, projects)`:**
- Validate the array (non-empty, each entry has name and path, no duplicate names, max 20)
- Normalise each name with `slugify`
- Ensure `prefsDir` exists (`mkdirSync(prefsDir, { recursive: true })`)
- Write `JSON.stringify({ projects }, null, 2) + '\n'`
- Return the normalised array with `worcaDir` added

**`validateProjectEntry({ name, path })`:**
- Name: non-empty, matches `/^[a-z0-9_-]{1,64}$/i` after slugification
- Path: non-empty, starts with `/` (absolute)
- Returns `{ valid: boolean, error: string | null }`

**`slugify(name)`:**
- Lowercase, replace `[^a-z0-9_-]` with `-`, collapse repeated `-`, trim leading/trailing `-`

---

### Task 2: Refactor `server/ws.js` for Multi-Project

**Files:**
- Modify: `.claude/worca-ui/server/ws.js`

**Signature change:**
```js
export function attachWsServer(httpServer, config) {
  // config: { projects: Array<{name, path, worcaDir}>, settingsPath, prefsPath }
```

**Replace all single-project watcher variables with a `projectWatchers` Map.**

For each entry in `config.projects`, call a new internal `setupProjectWatchers(proj)` function that replicates the current watcher setup (statusWatcher, activeRunWatcher, logWatchers, logLineCounts, watchedRunDir) and stores them in `projectWatchers.get(proj.name)`.

**`scheduleRefresh(projectName)`** — closes over the project's worcaDir:
```js
function scheduleRefresh(projectName) {
  const pw = projectWatchers.get(projectName);
  if (!pw) return;
  if (pw.refreshTimer) clearTimeout(pw.refreshTimer);
  pw.refreshTimer = setTimeout(() => {
    pw.refreshTimer = null;
    try {
      const runs = discoverRuns(pw.worcaDir);
      const settings = readSettings(settingsPath);
      broadcast('runs-list', { project: projectName, runs, settings });
      const active = runs.find(r => r.active);
      if (active) broadcastToSubscribers(projectName, active.id, 'run-snapshot', { project: projectName, ...active });
    } catch { /* ignore */ }
  }, REFRESH_DEBOUNCE_MS);
}
```

**Subscription tracking** — extend the `subs` WeakMap entry:
```js
s = { runId: null, logStage: null, project: null }
```

**`broadcastToSubscribers(project, runId, type, payload)`** — filter by both `s.project === project` and `s.runId === runId`.

**`broadcastToLogSubscribers(project, stage, type, payload)`** — filter by `s.project === project` and stage match.

**Message handler changes:**

`list-runs`: extract optional `payload.project`. If provided, discover and respond for that project only. If omitted, iterate all projects, discover each, send one `runs-list` broadcast per project.

`subscribe-run`: extract `payload.project`, set `s.project = project`, scope the run discovery.

`subscribe-log`: extract `payload.project`, look up the project's worcaDir for log resolution.

`stop-run`, `resume-run`, `get-agent-prompt`: extract `payload.project`, resolve worcaDir.

**Backward compat:** When `payload.project` is missing, fall back to `config.projects[0]`.

**Cleanup (`wss.on('close', ...)`):** iterate `projectWatchers`, close all watchers for all projects.

---

### Task 3: Update `server/index.js`

**Files:**
- Modify: `.claude/worca-ui/server/index.js`

```js
import { readProjects } from './project-registry.js';
import { homedir } from 'node:os';

const prefsDir = join(homedir(), '.worca');
const projects = readProjects(prefsDir);

const app = createApp({
  settingsPath: join(projectRoot, '.claude', 'settings.json'),
  worcaDir: projects[0].worcaDir,   // backward compat for existing settings endpoint
  projects,
  prefsDir,
});
const server = createServer(app);

const { broadcast } = attachWsServer(server, {
  projects,
  settingsPath: join(projectRoot, '.claude', 'settings.json'),
  prefsPath: join(prefsDir, 'preferences.json'),
});
app.locals.broadcast = broadcast;
```

Remove the old single-`worcaDir` `attachWsServer` call.

---

### Task 4: Add REST Endpoints to `server/app.js`

**Files:**
- Modify: `.claude/worca-ui/server/app.js`

Add `import { readProjects, writeProjects } from './project-registry.js'` at the top.

Add two routes before the static middleware:

**`GET /api/projects`** — as described in section 5.4.

**`POST /api/projects`** — as described in section 5.4.

The existing settings endpoints are unchanged.

---

### Task 5: Update `app/protocol.js`

**Files:**
- Modify: `.claude/worca-ui/app/protocol.js`

Add to `MESSAGE_TYPES`:
- `'projects-updated'`

Update the `@typedef` JSDoc to include the `project` field on the relevant existing types.

---

### Task 6: Update `app/router.js`

**Files:**
- Modify: `.claude/worca-ui/app/router.js`

Replace `parseHash`, `buildHash`, and `navigate` with the three-argument versions described in section 6.2. Keep the old two-argument `navigate(section, runId)` exported as a shim that passes `null` for project, to avoid breaking any call sites not yet updated.

---

### Task 7: Update `app/state.js`

**Files:**
- Modify: `.claude/worca-ui/app/state.js`

Add `projects`, `activeProject`, and `projectRuns` fields to the initial state. Add the three new store methods:

**`store.setProjectRuns(project, runs)`:**
```js
setProjectRuns(project, runs) {
  this.state.projectRuns = { ...this.state.projectRuns, [project]: runs };
  this._rebuildRunsView();
  this._notify();
},
_rebuildRunsView() {
  const { activeProject, projectRuns } = this.state;
  if (activeProject && projectRuns[activeProject]) {
    this.state.runs = projectRuns[activeProject];
  } else {
    // Merge all projects for the "All" view
    const merged = {};
    for (const pr of Object.values(projectRuns)) Object.assign(merged, pr);
    this.state.runs = merged;
  }
},
```

**`store.setActiveProject(name)`:**
```js
setActiveProject(name) {
  this.state.activeProject = name;
  this._rebuildRunsView();
  this._notify();
},
```

**`store.setProjects(projects)`:**
```js
setProjects(projects) {
  this.state.projects = projects;
  this._notify();
},
```

---

### Task 8: Update `app/main.js`

**Files:**
- Modify: `.claude/worca-ui/app/main.js`

This is the largest single-file change. Work through it section by section.

**Module-level additions:**
```js
let projects = [];   // Array<{ name, path }>
```

**Update `route` parsing** to use the new three-field `{ project, section, runId }` shape. After the initial `parseHash`, if `route.project` is null, set it to the first project name once `projects` is loaded (in the `runs-list` / `projects-updated` handlers).

**Add `handleSwitchProject(name)`** (described in section 6.3).

**Add `handleAddProject()`** — opens the add-project dialog (sets `addProjectDialogOpen = true`).

**Update `handleNavigate(section)`** to pass `route.project` to `navigate`.

**Update `handleSelectRun(runId)`** to pass `route.project`.

**Update `handleBack()`** to pass `route.project` to `navigate`.

**WS event handlers:**

`ws.on('runs-list', ...)` — use `store.setProjectRuns(payload.project, runs)`.

`ws.on('run-snapshot', ...)` — extract `payload.project`, call `store.setProjectRuns` to merge the updated run.

`ws.on('projects-updated', ...)` — new handler that calls `store.setProjects(payload.projects)` and updates the module-level `projects` variable.

**Connection handler** — send `list-runs` per project:
```js
const state = store.getState();
if (state.projects.length > 0) {
  for (const p of state.projects) {
    ws.send('list-runs', { project: p.name }).catch(() => {});
  }
} else {
  ws.send('list-runs').catch(() => {});  // fallback for no-config case
}
```

**Include `project: route.project` in:**
- `subscribe-run` payload
- `subscribe-log` payload
- `stop-run` payload
- `resume-run` payload
- `get-agent-prompt` payload (already has `runId` and `stage`)

**Update `rerender()`** to pass `onSwitchProject: handleSwitchProject` and `onAddProject: handleAddProject` to `sidebarView`.

**Fetch `GET /api/projects` at startup** (in the bootstrap section), then call `store.setProjects(projects)` and seed the module-level `projects` variable:
```js
fetch('/api/projects').then(r => r.json()).then(data => {
  if (data.ok) {
    projects = data.projects;
    store.setProjects(projects);
    rerender();
  }
}).catch(() => {});
```

---

### Task 9: Update `app/views/sidebar.js`

**Files:**
- Modify: `.claude/worca-ui/app/views/sidebar.js`

Update the function signature to accept `onSwitchProject` and `onAddProject` callbacks. Add the project picker section as described in section 6.4.

Helper inside the view:
```js
function projectActiveCount(name) {
  const pr = state.projectRuns?.[name] || {};
  return Object.values(pr).filter(r => r.active).length;
}
```

The picker is rendered only when `state.projects.length > 1`.

The Running / History item badges reflect the currently active project's counts (or merged counts when showing "All"):
```js
const runList = Object.values(state.runs);  // already scoped by _rebuildRunsView
const activeCount = runList.filter(r => r.active).length;
const historyCount = runList.filter(r => !r.active).length;
```

No change needed to the badge logic — the derived `state.runs` already provides the correct scope.

---

### Task 10: Update `app/views/dashboard.js`

**Files:**
- Modify: `.claude/worca-ui/app/views/dashboard.js`

Update the function signature:
```js
export function dashboardView(state, { onSelectRun, onNewRun, onSwitchProject })
```

Add a branch for the aggregated view:
```js
if (!state.activeProject && state.projects.length > 1) {
  return aggregatedDashboardView(state, { onSwitchProject });
}
// existing single-project dashboard
```

**`aggregatedDashboardView(state, { onSwitchProject })`** — a local function that renders one project card per entry in `state.projects`:
```js
state.projects.map(p => {
  const runs = Object.values(state.projectRuns?.[p.name] || {});
  const activeRuns = runs.filter(r => r.active);
  const lastRun = runs.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))[0];
  return projectCard(p, activeRuns.length, lastRun, { onSwitchProject });
});
```

---

### Task 11: Create `app/views/add-project-dialog.js`

**Files:**
- Create: `.claude/worca-ui/app/views/add-project-dialog.js`

```js
export function addProjectDialogView(isOpen, existingProjects, { onSubmit, onClose })
```

**Template:**
- `<sl-dialog label="Add Project" ?open=${isOpen} @sl-after-hide=${onClose}>`
- `<sl-input id="add-project-path" label="Project path" placeholder="/Users/you/dev/my-repo">`
  - On `sl-input` event: auto-populate name field by calling `slugify(basename(value))`
- `<sl-input id="add-project-name" label="Project name (slug)">`
- Error message `<div class="add-project-error">` shown when validation fails
- Footer: Cancel + "Add Project" primary button

**Submit logic:**
1. Read name and path from the inputs
2. Client-side validate (non-empty, path starts with `/`, name matches slug pattern)
3. Build new array: `[...existingProjects, { name, path }]`
4. Call `fetch('/api/projects', { method: 'POST', body: JSON.stringify({ projects }) })`
5. On success: call `onSubmit()` (closes dialog; `projects-updated` WS event does the state update)
6. On error: show error message in the dialog

---

### Task 12: Update Settings View (`app/views/settings.js`)

**Files:**
- Modify: `.claude/worca-ui/app/views/settings.js`

Add a "Projects" tab inside the existing `<sl-tab-group>`. The tab panel lists each project with a Remove button and an "Add Project" button at the bottom.

**Remove project logic:**
- Filter the project out of `state.projects`
- `POST /api/projects` with the reduced array
- The `projects-updated` WS event updates all state

**Import and render `addProjectDialogView`** within the settings view when `addProjectDialogOpen` is true (module-level state in `settings.js` since the dialog is local to this view).

---

### Task 13: Add CSS

**Files:**
- Modify: `.claude/worca-ui/app/styles.css`

Add styles for:

**Project picker in sidebar:**
```css
.project-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--sl-color-primary-500);
  flex-shrink: 0;
}
.sidebar-item--add { opacity: 0.6; font-style: italic; }
.sidebar-item--add:hover { opacity: 1; }
```

**Aggregated dashboard project cards:**
```css
.project-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 24px; }
.project-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 20px; cursor: pointer; transition: border-color 0.15s; }
.project-card:hover { border-color: var(--sl-color-primary-500); }
.project-card-name { font-weight: 600; font-size: 1rem; margin-bottom: 12px; }
.project-card-stats { display: flex; gap: 24px; margin-bottom: 12px; }
.project-card-last-run { display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; color: var(--text-muted); }
```

**Add-project dialog:**
```css
.add-project-error { color: var(--sl-color-danger-600); font-size: 0.85rem; margin-top: 8px; }
.add-project-field { margin-bottom: 16px; }
```

---

### Task 14: Rebuild Frontend Bundle

**Files:**
- Run the existing build command from `package.json`

After all frontend changes, rebuild `app/main.bundle.js`. Check `package.json` for the build script (likely `npm run build` which calls `esbuild`). The bundle must be regenerated since the server serves `main.bundle.js` as a compiled static asset.

---

## 8. Testing Strategy

### Unit Tests

**`server/project-registry.test.js`** (new file):
- `readProjects` returns synthetic default when file missing
- `readProjects` parses a valid `projects.json` and adds `worcaDir` to each entry
- `writeProjects` validates required fields (missing name, missing path, duplicate names)
- `writeProjects` rejects more than 20 projects
- `writeProjects` normalises names via `slugify`
- `slugify` converts spaces, special chars, and uppercase correctly
- `validateProjectEntry` rejects non-absolute paths
- `validateProjectEntry` rejects names with invalid characters before slugification

**`server/ws.test.js`** (extend existing if present):
- `attachWsServer` with a two-project config creates two watcher sets
- `scheduleRefresh` broadcasts with correct `project` field
- `list-runs` with no `project` payload triggers responses for all projects
- `list-runs` with a specific `project` payload scopes to that project
- `subscribe-run` with `project` routes to the correct worcaDir
- Backward compat: message without `project` defaults to `projects[0]`

**`server/app.test.js`** (extend existing):
- `GET /api/projects` returns the project list
- `POST /api/projects` with valid array writes and returns the list
- `POST /api/projects` with duplicate names returns 400
- `POST /api/projects` with non-absolute path returns 400
- `POST /api/projects` with more than 20 projects returns 400
- Successful `POST /api/projects` triggers `projects-updated` broadcast

### Manual Integration Checklist

- Start server with no `~/.worca/projects.json` — behaves exactly as before (single project, no project picker visible)
- Create `~/.worca/projects.json` with two entries — project picker appears in sidebar; Running/History badges reflect only the active project
- Click a project in the sidebar — route changes to `#/project/{name}/active`, run list updates
- Navigate to a run in project A, switch to project B — run detail clears, log terminal clears
- Dashboard with two projects, `activeProject = null` — aggregated card view renders; click a card switches project
- Add a project via Settings → Projects tab; verify it appears in the sidebar without a page reload
- Remove a project via Settings → Projects tab; verify the project disappears and the active project resets to the first remaining one
- Open two tabs; add a project in one — both tabs update via `projects-updated` WS event
- Open a legacy URL `#/active` — resolves to the first project, no redirect loop
- Verify `stop-run` and `resume-run` operate on the correct project's worcaDir when multiple projects are registered

### Edge Cases to Verify

- Project path does not exist on disk — server sets up watchers but `discoverRuns` returns empty array gracefully; no crash
- Two projects have runs with the same `run_id` — state map is keyed by `{ project, runId }` pair; no collision (projectRuns separates them)
- `projects.json` is deleted while the server is running — next watcher event falls back to the synthetic default without crashing
- All projects are removed via the API — server broadcasts `projects-updated` with an empty array; client shows no project picker; sidebar shows no runs (empty state)
- Rapidly switching projects — each switch sends `unsubscribe-run` and `unsubscribe-log` before the new subscription; no orphaned watchers

---

## 9. File Summary

### New files
| File | Purpose |
|------|---------|
| `.claude/worca-ui/server/project-registry.js` | Read/write `~/.worca/projects.json`; validate and slugify project entries |
| `.claude/worca-ui/server/project-registry.test.js` | Unit tests for the registry module |
| `.claude/worca-ui/app/views/add-project-dialog.js` | "Add Project" Shoelace dialog component |

### Modified files
| File | Changes |
|------|---------|
| `.claude/worca-ui/server/index.js` | Load project registry; pass `projects` array to `createApp` and `attachWsServer` |
| `.claude/worca-ui/server/app.js` | Add `GET /api/projects` and `POST /api/projects` endpoints |
| `.claude/worca-ui/server/ws.js` | Refactor to multi-project watcher map; add `project` field to all broadcasts; extend subscription tracking |
| `.claude/worca-ui/app/protocol.js` | Add `'projects-updated'` to `MESSAGE_TYPES` |
| `.claude/worca-ui/app/router.js` | Three-argument `parseHash` / `buildHash` / `navigate` supporting `#/project/{slug}/...` |
| `.claude/worca-ui/app/state.js` | Add `projects`, `activeProject`, `projectRuns`; add `setProjectRuns`, `setActiveProject`, `setProjects` |
| `.claude/worca-ui/app/main.js` | Add project switching, aggregated WS event routing, project-scoped subscriptions, startup project fetch |
| `.claude/worca-ui/app/views/sidebar.js` | Add project picker section; pass `onSwitchProject` / `onAddProject` callbacks |
| `.claude/worca-ui/app/views/dashboard.js` | Add aggregated project card view for multi-project mode |
| `.claude/worca-ui/app/views/settings.js` | Add "Projects" tab with add/remove project controls |
| `.claude/worca-ui/app/styles.css` | Add project picker, project card, and add-project dialog styles |
| `.claude/worca-ui/app/main.bundle.js` | Rebuilt from source after all changes |

---

## 10. Rollout Order

Tasks must be implemented in this order due to dependencies:

1. **Task 1** (project-registry.js) — foundation, no dependencies
2. **Task 5** (protocol.js) — small, independent; adds the new message type
3. **Task 6** (router.js) — independent; new URL shape
4. **Task 7** (state.js) — depends on Task 6 conceptually; independent in implementation
5. **Task 2** (ws.js multi-project) — depends on Task 1 (project-registry)
6. **Task 3** (index.js) — depends on Tasks 1 and 2
7. **Task 4** (app.js REST endpoints) — depends on Task 1; depends on Task 3 for `app.locals.broadcast`
8. **Task 8** (main.js) — depends on Tasks 5, 6, 7
9. **Task 9** (sidebar.js) — depends on Task 8 for callback signatures
10. **Task 10** (dashboard.js) — depends on Task 8 for the state shape
11. **Task 11** (add-project-dialog.js) — depends on Task 4 for the REST endpoint
12. **Task 12** (settings.js) — depends on Tasks 4 and 11
13. **Task 13** (CSS) — after all view changes are settled
14. **Task 14** (rebuild bundle) — final step; depends on all frontend tasks
