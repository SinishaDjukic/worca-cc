# W-016: Pipeline Templates


**Goal:** Eliminate repetitive pipeline reconfiguration by introducing named templates that capture complete `worca` pipeline configurations. Users pick a template when starting a new run, can save their current settings as a custom template, and can manage their template library from the Settings UI.

**Architecture:** Templates are stored as JSON files in `.claude/templates/`. Four built-in preset templates ship with worca. The Express server exposes a `GET/POST/DELETE /api/templates` REST API. The settings UI gains a "Templates" tab for management. The "New Run" dialog (added in W-009) gains a template picker that applies a template's settings to `settings.json` transiently before spawning the pipeline, without permanently overwriting user settings.

**Tech Stack:** Node.js `fs` for template file I/O, Express REST API, lit-html, Shoelace `sl-select` / `sl-dialog` / `sl-card` / `sl-badge` components, existing `GET/POST /api/settings` infrastructure.

**Depends on:** W-009 Pipeline Control Actions (the "New Run" dialog and `POST /api/runs` endpoint must already exist).

---

## 1. Scope and Boundaries

### In scope
- Template JSON format and schema (stages, agents, loops, milestones)
- Four built-in preset templates shipped as static files: `bugfix`, `feature`, `refactor`, `quick-fix`
- `GET /api/templates` -- list all templates (built-in + user)
- `GET /api/templates/:id` -- fetch a single template by ID
- `POST /api/templates` -- save a new user template (or overwrite existing user template)
- `DELETE /api/templates/:id` -- delete a user template (built-ins are read-only)
- "Templates" tab in Settings UI for browsing, previewing, and deleting templates
- "Save as Template" action on the Settings > Pipeline tab
- Template picker in the "New Run" dialog (optional, collapses if no templates exist)
- Template application: write a merged settings payload to `settings.json` before pipeline start, then restore after pipeline completes
- Template application approach: template values are merged into the existing `worca` config for the run, reverting automatically after the run ends

### Out of scope
- Template versioning or history
- Template sharing / export to remote registries
- Per-agent prompt customization in templates (future work)
- Template inheritance or composition
- Authentication or access control (single-user local tool)

---

## 2. Template JSON Format

Templates are stored as JSON files under `.claude/templates/`. Built-in presets live at `.claude/templates/builtin/`. User-created templates live at `.claude/templates/user/`.

### Schema

```json
{
  "id": "bugfix",
  "name": "Bugfix",
  "description": "Skip planner and coordinator. Focuses on direct implementation and testing. Best for well-understood bugs with a clear fix.",
  "builtin": true,
  "created_at": "2026-03-10T00:00:00Z",
  "tags": ["fast", "no-plan"],
  "config": {
    "stages": {
      "plan":       { "agent": "planner",     "enabled": false },
      "coordinate": { "agent": "coordinator", "enabled": false },
      "implement":  { "agent": "implementer", "enabled": true  },
      "test":       { "agent": "tester",      "enabled": true  },
      "review":     { "agent": "guardian",    "enabled": true  },
      "pr":         { "agent": "guardian",    "enabled": true  }
    },
    "agents": {
      "planner":     { "model": "opus",   "max_turns": 100 },
      "coordinator": { "model": "opus",   "max_turns": 300 },
      "implementer": { "model": "sonnet", "max_turns": 300 },
      "tester":      { "model": "sonnet", "max_turns": 100 },
      "guardian":    { "model": "opus",   "max_turns": 50  }
    },
    "loops": {
      "implement_test":    5,
      "code_review":       3,
      "pr_changes":        2,
      "restart_planning":  1
    },
    "milestones": {
      "plan_approval":   false,
      "pr_approval":     true,
      "deploy_approval": false
    }
  }
}
```

### Field definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | URL-safe identifier, unique within its scope (builtin or user). Max 64 chars, `[a-z0-9\-]` only. |
| `name` | string | yes | Human-readable display name. Max 80 chars. |
| `description` | string | yes | One or two sentences explaining when to use this template. Max 500 chars. |
| `builtin` | boolean | yes | `true` for shipped presets, `false` for user-created. |
| `created_at` | ISO 8601 | yes | Creation timestamp. |
| `tags` | string[] | no | Short labels shown as badges. Max 5 tags, 20 chars each. |
| `config` | object | yes | Subset of the `worca` namespace from `settings.json`. Only `stages`, `agents`, `loops`, and `milestones` are included. `governance`, `pricing`, `plan_path_template` are excluded. |

### Config merging rules

When a template is applied, its `config` is deep-merged into the current `worca` settings. Excluded fields (`governance`, `pricing`, `plan_path_template`) are left untouched. The merge is shallow per sub-key: `config.stages` replaces `worca.stages` wholesale; `config.agents` replaces `worca.agents` wholesale; etc.

This means a template must specify all stages and agents it wants to control -- partial stage configs are not supported. The merger in `template-manager.js` applies the template's `config` as a complete replacement of those four sub-keys.

---

## 3. Preset Templates

### 3.1 `bugfix` -- Bugfix

**File:** `.claude/templates/builtin/bugfix.json`

**Use when:** The bug is understood, reproduction is clear, and the fix is localized. No planning or task decomposition needed.

| Setting | Value |
|---------|-------|
| plan | disabled |
| coordinate | disabled |
| implement | enabled, sonnet, 300 turns |
| test | enabled, sonnet, 100 turns |
| review | enabled, opus, 50 turns |
| pr | enabled, opus, 50 turns |
| implement_test loops | 5 |
| pr_changes loops | 2 |
| plan_approval | false |
| pr_approval | true |

Tags: `fast`, `no-plan`

### 3.2 `feature` -- Feature Development

**File:** `.claude/templates/builtin/feature.json`

**Use when:** Implementing a new user-facing feature that requires planning, task breakdown, and a full review cycle.

| Setting | Value |
|---------|-------|
| plan | enabled, opus, 100 turns |
| coordinate | enabled, opus, 300 turns |
| implement | enabled, sonnet, 300 turns |
| test | enabled, sonnet, 100 turns |
| review | enabled, opus, 50 turns |
| pr | enabled, opus, 50 turns |
| implement_test loops | 10 |
| code_review loops | 5 |
| pr_changes loops | 3 |
| restart_planning loops | 2 |
| plan_approval | true |
| pr_approval | true |
| deploy_approval | true |

Tags: `full-pipeline`, `requires-approval`

### 3.3 `refactor` -- Refactor

**File:** `.claude/templates/builtin/refactor.json`

**Use when:** Restructuring existing code without changing behavior. Plan is needed for coordination, but no PR is created -- the branch is ready for manual review.

| Setting | Value |
|---------|-------|
| plan | enabled, opus, 100 turns |
| coordinate | enabled, opus, 300 turns |
| implement | enabled, sonnet, 300 turns |
| test | enabled, sonnet, 100 turns |
| review | enabled, opus, 50 turns |
| pr | disabled |
| implement_test loops | 10 |
| code_review loops | 8 |
| pr_changes loops | 0 |
| restart_planning loops | 2 |
| plan_approval | true |
| pr_approval | false |
| deploy_approval | false |

Tags: `no-pr`, `extra-test`

### 3.4 `quick-fix` -- Quick Fix

**File:** `.claude/templates/builtin/quick-fix.json`

**Use when:** A trivial one-liner fix, typo correction, or config tweak. Implementer only. No coordination, no review loop. High risk -- use only when the change is obviously safe.

| Setting | Value |
|---------|-------|
| plan | disabled |
| coordinate | disabled |
| implement | enabled, sonnet, 100 turns |
| test | disabled |
| review | disabled |
| pr | enabled, opus, 50 turns |
| implement_test loops | 0 |
| plan_approval | false |
| pr_approval | false |
| deploy_approval | false |

Tags: `minimal`, `fast`, `no-review`

---

## 4. REST API Design

All endpoints are prefixed `/api/`. Responses follow the existing convention `{ ok: true, ...data }` on success, `{ ok: false, error: string }` on failure.

### `GET /api/templates`

Return all available templates (built-in + user), sorted: built-ins first (by id), then user templates (by `created_at` descending).

**Response:**
```json
{
  "ok": true,
  "templates": [
    {
      "id": "bugfix",
      "name": "Bugfix",
      "description": "...",
      "builtin": true,
      "tags": ["fast", "no-plan"],
      "created_at": "2026-03-10T00:00:00Z"
    }
  ]
}
```

Note: The `config` field is omitted from the list response for brevity. Use `GET /api/templates/:id` to fetch the full template including config.

### `GET /api/templates/:id`

Fetch a single template by ID. Searches builtin first, then user.

**Response on success:**
```json
{ "ok": true, "template": { ...full template object including config... } }
```

**Response if not found:**
```json
HTTP 404: { "ok": false, "error": "Template 'xyz' not found" }
```

### `POST /api/templates`

Create or replace a user template. Built-in templates cannot be overwritten via this endpoint (reject if `id` matches a built-in).

**Request body:**
```json
{
  "id": "my-fast-run",
  "name": "My Fast Run",
  "description": "Custom template for quick iterations.",
  "tags": ["custom"],
  "config": { ...stages, agents, loops, milestones... }
}
```

**Validation rules:**
- `id` must match `[a-z0-9\-]{1,64}`
- `name` must be non-empty string, max 80 chars
- `description` must be non-empty string, max 500 chars
- `tags` optional, max 5 entries, each max 20 chars, each matching `[a-z0-9\-]`
- `config` must be an object; sub-keys `stages`, `agents`, `loops`, `milestones` validated individually (same rules as the existing `POST /api/settings` validator)
- Cannot use a `builtin` id (`bugfix`, `feature`, `refactor`, `quick-fix`)

**Response on success:**
```json
{ "ok": true, "template": { ...saved template... } }
```

**Response on validation error:**
```json
HTTP 400: { "ok": false, "error": "...", "details": [...] }
```

**Response if id matches a built-in:**
```json
HTTP 409: { "ok": false, "error": "Cannot overwrite built-in template 'bugfix'" }
```

### `DELETE /api/templates/:id`

Delete a user template. Built-in templates cannot be deleted.

**Response on success:**
```json
{ "ok": true, "deleted": true }
```

**Response if built-in:**
```json
HTTP 403: { "ok": false, "error": "Cannot delete built-in template" }
```

**Response if not found:**
```json
HTTP 404: { "ok": false, "error": "Template 'xyz' not found" }
```

---

## 5. Template Application Logic

When a user picks a template in the "New Run" dialog and submits the form, the frontend sends both the template ID and the standard run parameters to `POST /api/runs`. The server-side template application works as follows:

### Run-scoped config override (server-side)

The `POST /api/runs` endpoint is extended to accept an optional `templateId` field. When present:

1. Load the template via `templateManager.getTemplate(templateId)`
2. Read current `settings.json`
3. Merge `template.config` into the `worca` section using `applyTemplateConfig(currentWorca, templateConfig)`, producing a merged `worca` object
4. Write a temporary settings file to `{worcaDir}/runs/{runId}/settings-override.json` containing the full settings JSON with the merged worca section
5. Spawn `run_pipeline.py` with `--settings {runId}/settings-override.json` instead of the default `.claude/settings.json`
6. The override file lives only in the run's directory and is naturally cleaned up when the run is archived

This approach keeps the user's persistent `settings.json` untouched. The pipeline's `runner.py` already accepts `settings_path` as a parameter and passes it through to all sub-calls (`get_stage_config`, `get_enabled_stages`, `check_loop_limit`), so no changes to runner logic are needed.

### `applyTemplateConfig(currentWorca, templateConfig)` merge function

```javascript
function applyTemplateConfig(currentWorca, templateConfig) {
  return {
    ...currentWorca,
    ...(templateConfig.stages    && { stages:     templateConfig.stages }),
    ...(templateConfig.agents    && { agents:     templateConfig.agents }),
    ...(templateConfig.loops     && { loops:      templateConfig.loops }),
    ...(templateConfig.milestones && { milestones: templateConfig.milestones }),
  };
}
```

Fields not present in the template config (`governance`, `pricing`, `plan_path_template`) are inherited from the user's current settings.

---

## 6. Implementation Tasks

### Task 1: Create Preset Template JSON Files

**Files to create:**
- `.claude/templates/builtin/bugfix.json`
- `.claude/templates/builtin/feature.json`
- `.claude/templates/builtin/refactor.json`
- `.claude/templates/builtin/quick-fix.json`

Write each preset as a complete JSON object following the schema in Section 2 and the per-template specs in Section 3.

All four files have `"builtin": true`. The `created_at` field should be set to `2026-03-10T00:00:00Z` for all built-ins (stable, deterministic).

The `id` field in `quick-fix.json` is `"quick-fix"` (hyphen, matching the filename).

No code changes required for this task. The files are consumed by the template manager in Task 2.

---

### Task 2: Create `server/template-manager.js`

**File to create:** `.claude/worca-ui/server/template-manager.js`

A stateless module that handles all template file I/O. Consumers call it with explicit directory paths (testable without mocking `process.cwd()`).

**Exports:**

```javascript
export function listTemplates(builtinDir, userDir)
// Returns array of template summary objects (id, name, description, builtin, tags, created_at)
// Sorted: built-ins first (alphabetical by id), then user templates (newest first by created_at)
// Gracefully handles missing userDir (returns only built-ins)

export function getTemplate(id, builtinDir, userDir)
// Returns full template object (including config) or null if not found
// Searches builtinDir first, then userDir
// Parses and returns parsed JSON; throws TemplateError on malformed JSON

export function saveTemplate(template, userDir)
// Validates template object; throws TemplateError with details array on validation failure
// Throws TemplateError with code 'builtin_conflict' if id matches a built-in id
// Writes to {userDir}/{template.id}.json
// Returns the saved template object with builtin: false and created_at set to now

export function deleteTemplate(id, builtinDir, userDir)
// Throws TemplateError with code 'builtin' if id is a built-in
// Throws TemplateError with code 'not_found' if file does not exist in userDir
// Deletes {userDir}/{id}.json, returns { deleted: true }

export function applyTemplateConfig(currentWorca, templateConfig)
// Returns merged worca object; see Section 5 for merge logic

export class TemplateError extends Error {
  constructor(message, code, details = [])
  // code: 'not_found' | 'builtin' | 'builtin_conflict' | 'validation_error' | 'parse_error'
}
```

**Implementation notes:**

- `listTemplates` reads all `.json` files from `builtinDir` and `userDir` using `fs.readdirSync`. Skip files that fail to parse (log a warning but don't throw).
- `getTemplate` reads a single file by constructing `{builtinDir}/{id}.json` and `{userDir}/{id}.json`. Check builtin first.
- `saveTemplate` validation:
  - `id`: required, `[a-z0-9\-]{1,64}`
  - `name`: required, string, 1-80 chars
  - `description`: required, string, 1-500 chars
  - `tags`: optional, array, max 5 elements, each `[a-z0-9\-]{1,20}`
  - `config`: required object; each present sub-key (`stages`, `agents`, `loops`, `milestones`) must match structure expected by `settings-validator.js` (reuse the existing validation helpers)
  - Collect all violations into `details` array before throwing
- `saveTemplate` creates `userDir` with `fs.mkdirSync(..., { recursive: true })` if it does not exist.
- Built-in IDs are loaded lazily by reading `builtinDir` at call time, not hardcoded. This means a new built-in added to `builtinDir` is automatically protected.

---

### Task 3: Add Template REST Endpoints to `server/app.js`

**File to modify:** `.claude/worca-ui/server/app.js`

Add import at the top:
```javascript
import { listTemplates, getTemplate, saveTemplate, deleteTemplate, TemplateError } from './template-manager.js';
```

Update `createApp(options)` to accept `{ settingsPath, worcaDir, templatesDir }`. The `templatesDir` defaults to `join(dirname(settingsPath), '../templates')` if not provided.

Add these route handlers after the existing `/api/settings` routes and before the static file middleware:

**`GET /api/templates`:**
```javascript
app.get('/api/templates', (_req, res) => {
  try {
    const templates = listTemplates(
      join(options.templatesDir, 'builtin'),
      join(options.templatesDir, 'user')
    );
    res.json({ ok: true, templates });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

**`GET /api/templates/:id`:**
```javascript
app.get('/api/templates/:id', (req, res) => {
  try {
    const template = getTemplate(
      req.params.id,
      join(options.templatesDir, 'builtin'),
      join(options.templatesDir, 'user')
    );
    if (!template) return res.status(404).json({ ok: false, error: `Template '${req.params.id}' not found` });
    res.json({ ok: true, template });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

**`POST /api/templates`:**
```javascript
app.post('/api/templates', (req, res) => {
  try {
    const saved = saveTemplate(req.body, join(options.templatesDir, 'user'));
    res.json({ ok: true, template: saved });
  } catch (err) {
    if (err instanceof TemplateError) {
      if (err.code === 'builtin_conflict') return res.status(409).json({ ok: false, error: err.message });
      if (err.code === 'validation_error') return res.status(400).json({ ok: false, error: err.message, details: err.details });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

**`DELETE /api/templates/:id`:**
```javascript
app.delete('/api/templates/:id', (req, res) => {
  try {
    const result = deleteTemplate(
      req.params.id,
      join(options.templatesDir, 'builtin'),
      join(options.templatesDir, 'user')
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof TemplateError) {
      if (err.code === 'not_found') return res.status(404).json({ ok: false, error: err.message });
      if (err.code === 'builtin') return res.status(403).json({ ok: false, error: err.message });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

**Changes to `server/index.js`:**

Pass `templatesDir` to `createApp`:
```javascript
const templatesDir = join(cwd, '.claude', 'templates');
const app = createApp({ settingsPath, worcaDir, templatesDir });
```

---

### Task 4: Extend `POST /api/runs` to Accept `templateId`

**File to modify:** `.claude/worca-ui/server/app.js` (or `process-manager.js` if that's where `POST /api/runs` lives after W-009)

Extend the `POST /api/runs` handler to accept an optional `templateId` field in the request body.

**Changes to the handler:**

After validating `inputType`, `inputValue`, `msize`, `mloops` (existing validation), add:

```javascript
const { templateId } = req.body;
let overrideSettingsPath = null;

if (templateId) {
  // Load template
  const template = getTemplate(templateId, builtinDir, userDir);
  if (!template) {
    return res.status(400).json({ ok: false, error: `Template '${templateId}' not found` });
  }

  // Read current settings
  const rawSettings = JSON.parse(readFileSync(options.settingsPath, 'utf8'));

  // Merge template config into worca section
  rawSettings.worca = applyTemplateConfig(rawSettings.worca || {}, template.config);

  // Write override file into a temp location
  const overrideDir = join(options.worcaDir, 'template-overrides');
  mkdirSync(overrideDir, { recursive: true });
  const overrideFile = join(overrideDir, `${Date.now()}-${templateId}.json`);
  writeFileSync(overrideFile, JSON.stringify(rawSettings, null, 2));
  overrideSettingsPath = overrideFile;
}

// Pass overrideSettingsPath to startPipeline
const result = await startPipeline(options.worcaDir, {
  inputType, inputValue, msize, mloops,
  settingsPath: overrideSettingsPath || options.settingsPath,
});
```

**Changes to `process-manager.js` `startPipeline()`:**

Add optional `settingsPath` parameter. When provided and different from the default, append `--settings {settingsPath}` to the spawn args:

```javascript
if (opts.settingsPath && opts.settingsPath !== defaultSettingsPath) {
  args.push('--settings', opts.settingsPath);
}
```

**Changes to `run_pipeline.py`:**

The script already accepts `--settings` (or needs it added). Check if it exists; if not, add a `--settings` CLI argument that overrides the default `.claude/settings.json` path and passes it through to `run_pipeline()` as the `settings_path` parameter. `runner.py`'s `run_pipeline()` already takes `settings_path` as a keyword argument, so this is a one-line addition to the CLI arg parser.

The override file in `worcaDir/template-overrides/` is cleaned up the next time `POST /api/runs` is called (scan and delete files older than 24 hours on each `POST /api/runs` call). This prevents accumulation without requiring a separate cleanup job.

---

### Task 5: Create `app/views/templates.js`

**File to create:** `.claude/worca-ui/app/views/templates.js`

A lit-html view module for the Settings > Templates tab.

**Exported function:** `templatesTab(templates, { onDelete, onSaveAsTemplate })`

Where `templates` is the array from `GET /api/templates` (summary objects, no config).

**Template structure:**

```javascript
export function templatesTab(templates, { onDelete, onSaveAsTemplate }) {
  return html`
    <div class="settings-tab-content">
      <div class="templates-header">
        <h3 class="settings-section-title">Pipeline Templates</h3>
        <sl-button size="small" variant="primary" @click=${onSaveAsTemplate}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save Current as Template
        </sl-button>
      </div>

      ${templates.length === 0
        ? html`<div class="empty-state">No templates found.</div>`
        : html`
          <div class="templates-grid">
            ${templates.map(t => templateCard(t, { onDelete }))}
          </div>
        `
      }
    </div>
  `;
}
```

**`templateCard(template, { onDelete })`:**

Renders an `sl-card` per template. Each card shows:
- Template name (bold) + `sl-badge variant="neutral" pill` for `builtin` or `sl-badge variant="success" pill` for user-created
- Tags rendered as small `sl-badge` elements in a row
- Description text (truncated to 2 lines with CSS)
- Delete button (`variant="danger"`, `size="small"`) -- disabled and greyed out for built-ins, with a tooltip: "Built-in templates cannot be deleted"
- On delete click: call `onDelete(template.id)`

```html
<sl-card class="template-card">
  <div class="template-card-header" slot="header">
    <span class="template-name">${template.name}</span>
    ${template.builtin
      ? html`<sl-badge variant="neutral" pill>built-in</sl-badge>`
      : html`<sl-badge variant="success" pill>custom</sl-badge>`}
  </div>
  <div class="template-tags">
    ${(template.tags || []).map(tag => html`<sl-badge variant="primary" pill size="small">${tag}</sl-badge>`)}
  </div>
  <p class="template-description">${template.description}</p>
  <div slot="footer" class="template-card-actions">
    <sl-button
      variant="danger" size="small"
      ?disabled=${template.builtin}
      title=${template.builtin ? 'Built-in templates cannot be deleted' : ''}
      @click=${() => !template.builtin && onDelete(template.id)}
    >
      Delete
    </sl-button>
  </div>
</sl-card>
```

---

### Task 6: Create `app/views/save-template-dialog.js`

**File to create:** `.claude/worca-ui/app/views/save-template-dialog.js`

A Shoelace dialog that lets users save the current pipeline settings as a named template.

**Exported function:** `saveTemplateDialogView(isOpen, { onSubmit, onClose })`

**Dialog fields:**
- Template name: `<sl-input id="tmpl-name" label="Template Name" placeholder="My Fast Run" maxlength="80">`
- Template description: `<sl-textarea id="tmpl-desc" label="Description" placeholder="When to use this template..." rows="2" maxlength="500">`
- Tags (optional): `<sl-input id="tmpl-tags" label="Tags (comma-separated)" placeholder="fast, no-plan" maxlength="120">`
- ID (auto-derived from name, shown as read-only hint): `Saved as: my-fast-run`
- Footer: Cancel + "Save Template" primary button

**ID derivation:** `name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64)`

**Behavior:**
- On submit: read fields from DOM, call `onSubmit({ id, name, description, tags })`
- The caller (`main.js`) handles the actual `POST /api/templates` call
- On cancel: call `onClose`
- Disable "Save Template" button while `isSubmitting` is true

---

### Task 7: Add Template Picker to "New Run" Dialog

**File to modify:** `.claude/worca-ui/app/views/new-run-dialog.js`

Add a template picker section at the top of the dialog, above the input type selector. The section is collapsible via an `sl-details` element with summary "Pipeline Template (optional)".

**Module-level state to add:**
```javascript
let selectedTemplateId = null;
let availableTemplates = [];
```

**New function:** `loadTemplatesForPicker()` -- calls `GET /api/templates`, populates `availableTemplates`, rerenders. Called once when the dialog opens.

**Template picker section:**
```html
<sl-details summary="Pipeline Template (optional)" class="new-run-template-picker">
  ${availableTemplates.length === 0
    ? html`<span class="settings-muted">No templates available.</span>`
    : html`
      <sl-select
        id="new-run-template"
        placeholder="None (use current settings)"
        clearable
        @sl-change=${(e) => { selectedTemplateId = e.target.value || null; rerender(); }}
      >
        ${availableTemplates.map(t => html`
          <sl-option value="${t.id}">
            ${t.name}
            ${t.builtin ? html`<sl-badge slot="suffix" variant="neutral" pill size="small">built-in</sl-badge>` : ''}
          </sl-option>
        `)}
      </sl-select>
      ${selectedTemplateId ? templatePreviewBadges(availableTemplates.find(t => t.id === selectedTemplateId)) : ''}
    `
  }
</sl-details>
```

**`templatePreviewBadges(template)`:** Renders the selected template's tags and a one-line description summary below the selector.

**Include `templateId` in form submission:**
The `onSubmit` callback in `new-run-dialog.js` is updated to include `selectedTemplateId`:
```javascript
onSubmit({ inputType, inputValue, msize, mloops, templateId: selectedTemplateId });
```

**Reset on close:** Set `selectedTemplateId = null` when the dialog closes.

---

### Task 8: Add "Templates" Tab and "Save as Template" to Settings

**File to modify:** `.claude/worca-ui/app/views/settings.js`

**Module-level state to add:**
```javascript
let templatesData = null;        // array from GET /api/templates
let templatesLoadError = null;
```

**New functions:**

```javascript
export async function loadTemplates() {
  try {
    const res = await fetch('/api/templates');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    templatesData = data.templates || [];
    templatesLoadError = null;
  } catch (err) {
    templatesData = [];
    templatesLoadError = 'Failed to load templates: ' + err.message;
  }
}
```

**Add "Templates" tab to `settingsView()`:**

Add a new tab nav entry and tab panel in the `sl-tab-group`:

```html
<sl-tab slot="nav" panel="templates">
  ${unsafeHTML(iconSvg(LayoutTemplate, 14))}
  Templates
</sl-tab>
...
<sl-tab-panel name="templates">
  ${templatesTab(templatesData || [], {
    onDelete: handleDeleteTemplate,
    onSaveAsTemplate: handleOpenSaveAsTemplate,
  })}
</sl-tab-panel>
```

**`handleDeleteTemplate(id)`:**
- Call `fetch('/api/templates/' + id, { method: 'DELETE' })`
- On success: reload `templatesData` via `loadTemplates()`, rerender
- On error: show `saveMessage` error toast

**"Save as Template" on the Pipeline tab:**

Add a secondary button next to "Save Pipeline" on the pipeline tab footer:
```html
<sl-button variant="default" size="small" @click=${onOpenSaveAsTemplate}>
  ${unsafeHTML(iconSvg(LayoutTemplate, 14))}
  Save as Template
</sl-button>
```

Update `pipelineTab(worca, rerender, { onOpenSaveAsTemplate })` signature to accept this callback.

**`handleOpenSaveAsTemplate()`:** Sets `saveTemplateDialogOpen = true`, rerenders. The dialog reads current pipeline settings from DOM (same way "Save Pipeline" does) and submits them bundled with the template metadata.

**`handleSaveAsTemplate({ id, name, description, tags })`:**
1. Read current pipeline config from DOM (call `readStagesFromDom()`, `readPipelineFromDom()`, `readAgentsFromDom()`)
2. Read milestones from settings (currently not editable in UI -- read from `settingsData.worca.milestones`)
3. Build `config = { stages, agents, loops, milestones }`
4. `POST /api/templates` with `{ id, name, description, tags, config }`
5. On success: reload templates, close dialog, show success toast
6. On error: show error in dialog

**New icon import:** Add `LayoutTemplate` to the icon imports (use an existing layout icon or add a simple SVG path). If `LayoutTemplate` is not in the current `icons.js`, add a minimal inline SVG for it.

---

### Task 9: Wire Everything Together in `main.js`

**File to modify:** `.claude/worca-ui/app/main.js`

**New module-level state:**
```javascript
let saveTemplateDialogOpen = false;
let saveTemplateSubmitting = false;
let saveTemplateError = null;
```

**New handler functions:**

```javascript
function handleOpenSaveAsTemplate() {
  saveTemplateDialogOpen = true;
  saveTemplateError = null;
  rerender();
}

function handleCloseSaveAsTemplate() {
  saveTemplateDialogOpen = false;
  saveTemplateError = null;
  saveTemplateSubmitting = false;
  rerender();
}

async function handleSaveAsTemplate(templateData) {
  saveTemplateSubmitting = true;
  saveTemplateError = null;
  rerender();
  try {
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(templateData),
    });
    const data = await res.json();
    if (!res.ok) {
      saveTemplateError = data.error || 'Failed to save template';
      return;
    }
    // Reload templates in settings view
    await loadTemplates();
    handleCloseSaveAsTemplate();
  } catch (err) {
    saveTemplateError = err.message;
  } finally {
    saveTemplateSubmitting = false;
    rerender();
  }
}
```

**Updates to `handleSubmitNewRun()`:**

Pass `templateId` through to `POST /api/runs`:
```javascript
async function handleSubmitNewRun({ inputType, inputValue, msize, mloops, templateId }) {
  // ...existing code...
  body: JSON.stringify({ inputType, inputValue, msize, mloops, ...(templateId && { templateId }) })
  // ...
}
```

**Render `saveTemplateDialogView` and import `loadTemplates`:**

Add to the `rerender()` function body (alongside existing dialogs):
```javascript
render(saveTemplateDialogView(saveTemplateDialogOpen, {
  isSubmitting: saveTemplateSubmitting,
  error: saveTemplateError,
  onSubmit: handleSaveAsTemplate,
  onClose: handleCloseSaveAsTemplate,
}), document.getElementById('save-template-dialog-mount'));
```

Add a `<div id="save-template-dialog-mount"></div>` to `index.html` (alongside the existing dialog mounts).

**Call `loadTemplates()` on settings tab open:** If templates haven't been loaded yet when the settings view is first shown, trigger `loadTemplates()` and rerender.

**Call `loadTemplatesForPicker()` when the "New Run" dialog opens** (in `handleOpenNewRunDialog()`).

---

### Task 10: Add CSS for Templates

**File to modify:** `.claude/worca-ui/app/styles.css`

Add the following styles:

```css
/* Templates tab */
.templates-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.template-card {
  --padding: 12px;
}

.template-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.template-name {
  font-weight: 600;
  font-size: 14px;
  flex: 1;
}

.template-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 6px 0;
}

.template-description {
  font-size: 12px;
  color: var(--muted);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.template-card-actions {
  display: flex;
  justify-content: flex-end;
}

/* New Run dialog: template picker */
.new-run-template-picker {
  margin-bottom: 12px;
}

.template-preview-desc {
  font-size: 11px;
  color: var(--muted);
  margin-top: 4px;
}

.template-preview-tags {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

/* Save as Template dialog */
.save-template-field {
  margin-bottom: 12px;
}

.save-template-id-hint {
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
}
```

---

### Task 11: Create `server/template-manager.test.js`

**File to create:** `.claude/worca-ui/server/template-manager.test.js`

Unit tests for the template manager module using Node's built-in `node:test` runner (consistent with existing test files in the project).

**Test cases:**

`listTemplates`:
- Returns built-in templates from the builtin dir, sorted alphabetically
- Returns user templates after built-ins, sorted newest-first
- Gracefully handles missing user dir (returns only built-ins)
- Skips unparseable JSON files without throwing

`getTemplate`:
- Returns full template object for a known built-in id
- Returns full template object for a user template id
- Returns null for unknown id
- Searches builtin before user (builtin wins on id collision)

`saveTemplate`:
- Saves valid template object to user dir with `builtin: false`
- Injects `created_at` timestamp on save
- Creates user dir if it does not exist
- Throws `TemplateError` with code `builtin_conflict` when id matches a built-in
- Throws `TemplateError` with code `validation_error` for invalid `id` (spaces, uppercase, too long)
- Throws `TemplateError` with code `validation_error` for missing `name`
- Throws `TemplateError` with code `validation_error` for too many tags
- Collects multiple violations into `details` array before throwing

`deleteTemplate`:
- Deletes user template file from disk
- Throws `TemplateError` code `not_found` for unknown user template
- Throws `TemplateError` code `builtin` for built-in template id

`applyTemplateConfig`:
- Merges template stages, agents, loops, milestones into currentWorca
- Preserves `governance`, `pricing`, `plan_path_template` from currentWorca
- Handles partial template config (e.g. only `stages` present -- other keys unchanged)
- Returns new object (does not mutate either input)

Use `os.tmpdir()` / `fs.mkdtempSync` for temp directories in all file-system tests.

---

### Task 12: Rebuild Frontend Bundle

**Command:**
```bash
cd .claude/worca-ui && npm run build
```

(Or the equivalent `npx esbuild` command from `package.json`.) This regenerates `app/main.bundle.js` from all the modified and new source files.

Run after all Tasks 1-11 are complete and verified.

---

## 7. Testing Strategy

### Unit Tests

Covered by Task 11 (`template-manager.test.js`). Run via:
```bash
cd .claude/worca-ui && node --test server/template-manager.test.js
```

### Manual Integration Checklist

**Template API:**
- `GET /api/templates` returns four built-ins and any user templates
- `GET /api/templates/bugfix` returns full config including all six stages
- `POST /api/templates` with valid body creates file in `.claude/templates/user/`
- `POST /api/templates` with `id: "bugfix"` returns HTTP 409
- `POST /api/templates` with `id: "INVALID ID"` returns HTTP 400 with details
- `DELETE /api/templates/{user-id}` removes file and returns `{ ok: true, deleted: true }`
- `DELETE /api/templates/bugfix` returns HTTP 403

**Settings UI -- Templates tab:**
- All four built-ins appear as cards with `built-in` badge
- Built-in delete buttons are disabled and show tooltip
- "Save Current as Template" button opens the dialog
- Filling in name auto-derives the ID
- Saving creates a new card in the Templates tab
- Deleting a custom template removes its card

**Settings UI -- Pipeline tab:**
- "Save as Template" secondary button appears next to "Save Pipeline"
- Clicking it opens the save-as-template dialog
- Submitting creates the template from the current DOM state (not from saved settings)

**New Run dialog -- template picker:**
- `sl-details` is collapsed by default
- Expanding it shows all templates in the `sl-select`
- Selecting "Bugfix" shows the description and tags below the selector
- Clearing the selection (clearable) removes the preview
- Starting a run with a template selected: the spawned pipeline uses the template's stage config (verify by checking the override settings file written to `worcaDir/template-overrides/`)
- Starting a run without a template: no override file is written, pipeline uses `settings.json` directly

**Run isolation:**
- After a templated run completes, `settings.json` is unchanged
- Starting a second run without a template still uses the original `settings.json`

### Edge Cases to Verify

- Template ID with 64 chars (boundary valid)
- Template ID with 65 chars (boundary invalid, rejected with 400)
- Template `config` with only `stages` specified (other config keys inherited from current settings)
- User dir does not exist yet (created automatically on first save)
- Builtin dir is empty or missing (list returns empty array, no crash)
- Two browser tabs open: delete a template in one tab, refresh templates in the other tab

---

## 8. File Summary

### New files

| File | Purpose |
|------|---------|
| `.claude/templates/builtin/bugfix.json` | Bugfix preset template |
| `.claude/templates/builtin/feature.json` | Feature development preset template |
| `.claude/templates/builtin/refactor.json` | Refactor preset template |
| `.claude/templates/builtin/quick-fix.json` | Quick fix preset template |
| `.claude/worca-ui/server/template-manager.js` | Template file I/O, validation, merge logic |
| `.claude/worca-ui/server/template-manager.test.js` | Unit tests for template manager |
| `.claude/worca-ui/app/views/templates.js` | Settings > Templates tab view |
| `.claude/worca-ui/app/views/save-template-dialog.js` | "Save as Template" dialog component |

### Modified files

| File | Changes |
|------|---------|
| `.claude/worca-ui/server/app.js` | Add `GET/POST/DELETE /api/templates` endpoints; extend `POST /api/runs` to accept `templateId` |
| `.claude/worca-ui/server/index.js` | Pass `templatesDir` to `createApp` |
| `.claude/worca-ui/server/process-manager.js` | Accept `settingsPath` override in `startPipeline()` |
| `.claude/worca-ui/app/views/settings.js` | Add "Templates" tab, `loadTemplates()`, "Save as Template" button on Pipeline tab, `handleDeleteTemplate`, `handleSaveAsTemplate` |
| `.claude/worca-ui/app/views/new-run-dialog.js` | Add template picker section, `selectedTemplateId` state, `loadTemplatesForPicker()`, include `templateId` in submit payload |
| `.claude/worca-ui/app/main.js` | Add `saveTemplateDialog` state and handlers; pass `templateId` through `handleSubmitNewRun`; trigger `loadTemplates` and `loadTemplatesForPicker` at appropriate points; render `saveTemplateDialogView` |
| `.claude/worca-ui/app/styles.css` | Add template card grid, template picker, save-as-template dialog styles |
| `.claude/worca-ui/app/main.bundle.js` | Rebuilt from source after all changes |
| `.claude/scripts/run_pipeline.py` | Add `--settings` CLI argument if not already present |

---

## 9. Rollout Order

Tasks should be implemented in this order due to dependencies:

1. **Task 1** (preset JSON files) -- no code dependencies; can be written first and verified by inspection
2. **Task 2** (template-manager.js) -- depends on Task 1 to test against real built-in files
3. **Task 11** (template-manager.test.js) -- depends on Task 2; run tests immediately after
4. **Task 3** (REST endpoints in app.js + index.js) -- depends on Task 2
5. **Task 4** (extend POST /api/runs + process-manager.js + run_pipeline.py) -- depends on Task 2; can run in parallel with Task 3 after Task 2 is done
6. **Task 5** (templates.js view) -- frontend work, depends only on the API contract from Task 3
7. **Task 6** (save-template-dialog.js) -- independent frontend component; can run in parallel with Task 5
8. **Task 7** (template picker in new-run-dialog.js) -- depends on Task 4 (API contract) and Task 5 (preview logic pattern)
9. **Task 8** (settings.js changes) -- depends on Tasks 5, 6, 7
10. **Task 9** (main.js wiring) -- depends on Tasks 5, 6, 7, 8
11. **Task 10** (CSS) -- after all view components are settled
12. **Task 12** (rebuild bundle) -- final step
