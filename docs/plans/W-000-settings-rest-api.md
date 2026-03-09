# W-000: Settings REST API

**Status:** Canonical plan (supersedes `2026-03-09-settings-page.md` and `2026-03-09-pipeline-stage-editor.md`)

**Scope:** REST endpoints for loading and saving pipeline configuration, plus frontend wiring to consume them.

---

## 1. Goal

The worca-ui Settings page needs to read and write pipeline configuration stored in `.claude/settings.json`. This plan covers the REST API layer (`GET /api/settings`, `POST /api/settings`) on the Express server, input validation, safe merge semantics, and any remaining frontend gaps in consuming these endpoints.

### Out of Scope

- Python backend changes to `stages.py` / `runner.py` (those are covered by the pipeline-stage-editor plan and are already landed).
- CSS styling changes (the settings view styles are already in place).
- Preferences (theme toggle) -- handled via WebSocket `set-preferences` / `get-preferences`, not REST.

---

## 2. Current State

### What Exists

| Component | File | Status |
|-----------|------|--------|
| Express server shell | `.claude/worca-ui/server/app.js` | Serves static files only. No JSON body parsing. No `/api/settings` routes. |
| Settings reader (read-only) | `.claude/worca-ui/server/settings-reader.js` | Reads `worca` namespace. Used by WS `list-runs` handler only. No write capability. |
| Server entry | `.claude/worca-ui/server/index.js` | Creates app via `createApp()` with no options. `settingsPath` is already computed for WS but not passed to `createApp`. |
| WS server | `.claude/worca-ui/server/ws.js` | Uses `readSettings(settingsPath)` for the `list-runs` response. Has `settingsPath` in its config. |
| Frontend settings view | `.claude/worca-ui/app/views/settings.js` | Fully built: 4 tabs (Agents, Pipeline, Governance, Preferences). Calls `fetch('/api/settings')` for GET and POST. **These calls currently 404 because the endpoints do not exist.** |
| Frontend routing | `.claude/worca-ui/app/main.js` | Settings route wired at `#/settings`. Calls `loadSettings()` on navigation and bootstrap. |
| Settings file | `.claude/settings.json` | Contains `hooks`, `permissions`, and `worca` namespace with `stages`, `agents`, `loops`, `milestones`, and `governance` sections. |

### What Is Missing

1. **`GET /api/settings` endpoint** -- server does not expose settings over HTTP.
2. **`POST /api/settings` endpoint** -- server cannot write settings.
3. **JSON body parsing middleware** -- `app.js` does not call `express.json()`.
4. **`settingsPath` passed to `createApp()`** -- the factory takes no options.
5. **Input validation** -- nothing prevents writing invalid models, negative max_turns, or corrupting the `hooks`/`permissions` namespaces.
6. **Write helper** -- `settings-reader.js` is read-only; need a corresponding `writeSettings` or inline write logic.
7. **Error handling** -- no structured error responses defined for the REST layer.

---

## 3. Architecture

### Endpoint Design

```
GET  /api/settings  -->  200 { worca: {...}, permissions: {...} }
POST /api/settings  -->  200 { worca: {...}, permissions: {...} }
                    -->  400 { error: { code, message, details[] } }
                    -->  500 { error: { code, message } }
```

### GET /api/settings

Reads `.claude/settings.json`, returns the `worca` and `permissions` namespaces. Never exposes `hooks` (those are system-managed).

**Response schema:**

```
{
  worca: {
    stages:     { [stageName]: { agent: string, enabled: boolean } },
    agents:     { [agentName]: { model: string, max_turns: number } },
    loops:      { implement_test: number, code_review: number, pr_changes: number, restart_planning: number },
    milestones: { plan_approval: boolean, pr_approval: boolean, deploy_approval: boolean },
    governance: {
      guards:           { [guardKey]: boolean },
      test_gate_strikes: number,
      dispatch:          { [agentName]: string[] }
    }
  },
  permissions: {
    allow: string[]
  }
}
```

### POST /api/settings

Accepts a partial or full replacement of the `worca` and `permissions` namespaces. Uses **deep merge** semantics: the caller sends the complete desired state for sections they want to update. Sections not included in the payload are left untouched. The `hooks` namespace is never modified by this endpoint.

**Request body schema:**

```
{
  worca?: {
    stages?:     { ... },
    agents?:     { ... },
    loops?:      { ... },
    milestones?: { ... },
    governance?: { ... }
  },
  permissions?: {
    allow?: string[]
  }
}
```

**Merge strategy (important):**

- Top-level keys under `worca` (stages, agents, loops, milestones, governance) are replaced wholesale when present in the request. This avoids partial-merge confusion where old keys linger.
- The `hooks` key is never touched regardless of what the client sends.
- `permissions` is replaced wholesale when present.
- After merge, the entire file is rewritten with `JSON.stringify(raw, null, 2) + '\n'`.

**Response:** Same shape as GET (returns the full post-merge state).

### Data Flow

```
Browser (settings.js)                    Server (app.js)               Disk
  |                                        |                            |
  |-- fetch GET /api/settings ------------>|                            |
  |                                        |-- readFileSync ----------->|
  |                                        |<-- JSON ----- settings.json|
  |<-- { worca, permissions } -------------|                            |
  |                                        |                            |
  |-- fetch POST /api/settings { body } -->|                            |
  |                                        |-- validate(body)           |
  |                                        |-- readFileSync ----------->|
  |                                        |<-- JSON ----- settings.json|
  |                                        |-- merge(raw, body)         |
  |                                        |-- writeFileSync ---------->|
  |                                        |                            |-- settings.json
  |<-- { worca, permissions } -------------|                            |
```

---

## 4. Implementation Tasks

### Task 1: Add JSON body parsing and `settingsPath` option to `createApp`

**Files to modify:**

- `.claude/worca-ui/server/app.js`
- `.claude/worca-ui/server/index.js`

**Changes to `server/app.js`:**

- Change `createApp()` signature to accept an `options` object with `settingsPath` property.
- Add `app.use(express.json())` before route definitions so POST bodies are parsed.
- Routes (Tasks 2-3) will be added in subsequent tasks but the options plumbing goes in here.

**Changes to `server/index.js`:**

- Compute `settingsPath` (already done on line 22 for WS config: `join(cwd, '.claude', 'settings.json')`).
- Pass `{ settingsPath }` to `createApp()`.

### Task 2: Implement `GET /api/settings`

**Files to modify:**

- `.claude/worca-ui/server/app.js`

**Changes:**

- Add `app.get('/api/settings', ...)` handler before the static/SPA fallback routes.
- Guard on `options.settingsPath` being defined; if not, return 501.
- Read the file with `readFileSync`, parse JSON.
- Extract `worca` and `permissions` from the parsed object. Omit `hooks`.
- Return `{ worca: raw.worca || {}, permissions: raw.permissions || {} }`.
- On parse/read failure, return 500 with `{ error: { code: 'read_error', message: err.message } }`.

### Task 3: Implement `POST /api/settings` with validation

**Files to modify:**

- `.claude/worca-ui/server/app.js`

**Changes:**

- Add `app.post('/api/settings', ...)` handler.
- Read current file state (same as GET).
- Validate the incoming body (see Section 5 for rules). On validation failure, return 400.
- Merge incoming `worca` sub-keys into `raw.worca`, replacing each top-level sub-key wholesale.
- If `permissions` is present in the body, replace `raw.permissions`.
- Never modify `raw.hooks`.
- Write back with `writeFileSync(settingsPath, JSON.stringify(raw, null, 2) + '\n', 'utf8')`.
- Return the merged `{ worca: raw.worca, permissions: raw.permissions }`.
- On write failure, return 500 with `{ error: { code: 'write_error', message: err.message } }`.

### Task 4: Add validation logic

**Files to modify:**

- `.claude/worca-ui/server/app.js` (inline) or create `.claude/worca-ui/server/settings-validator.js` if the logic exceeds ~40 lines.

**Changes:**

- Implement a `validateSettingsPayload(body)` function that returns `{ valid: true }` or `{ valid: false, details: [...] }`.
- Validation rules are enumerated in Section 5 below.
- Call this function at the top of the POST handler before any merge/write.

### Task 5: Update frontend `loadSettings` response handling (if needed)

**Files to modify:**

- `.claude/worca-ui/app/views/settings.js`

**Current state:** `loadSettings()` (line 52-84) calls `fetch('/api/settings')` and expects `res.json()` to return an object with a `worca` key. It also reads `settingsData.permissions`. This already matches the proposed GET response schema.

**Changes (conditional):**

- Verify that `saveSettings()` (line 86-116) sends the body in the correct format. Currently it sends `JSON.stringify(data)` where `data` is `{ worca: {...}, permissions: {...} }`. This matches the POST schema. **No change needed if the shapes match.**
- If the POST response shape changes (e.g., wrapping in `{ ok: true, ... }`), update `saveSettings` to unwrap accordingly. Currently the frontend expects `result.worca` and `result.permissions` directly from the response JSON, which matches the proposed response.

### Task 6: Rebuild the frontend bundle

**Files to modify:**

- `.claude/worca-ui/app/main.bundle.js`
- `.claude/worca-ui/app/main.bundle.js.map`

**Changes:**

- Run `npx esbuild app/main.js --bundle --outfile=app/main.bundle.js --sourcemap --format=esm --platform=browser` from the `.claude/worca-ui/` directory.
- Only needed if Task 5 required frontend changes.

---

## 5. Validation Rules

The POST handler must reject payloads that would corrupt settings. All validation errors return HTTP 400 with body `{ error: { code: 'validation_error', message: '...', details: [...] } }`.

### worca.agents

| Field | Rule |
|-------|------|
| `model` | Must be one of `'opus'`, `'sonnet'`, `'haiku'` if present. |
| `max_turns` | Must be an integer between 1 and 500 (inclusive) if present. |
| Agent name keys | Must be one of `planner`, `coordinator`, `implementer`, `tester`, `guardian`. Unknown agent names are rejected. |

### worca.stages

| Field | Rule |
|-------|------|
| Stage name keys | Must be one of `plan`, `coordinate`, `implement`, `test`, `review`, `pr`. Unknown stage names are rejected. |
| `agent` | Must be one of the five known agent names if present. |
| `enabled` | Must be a boolean if present. |

### worca.loops

| Field | Rule |
|-------|------|
| Loop keys | Must be one of `implement_test`, `code_review`, `pr_changes`, `restart_planning`. |
| Values | Must be non-negative integers, max 100. |

### worca.milestones

| Field | Rule |
|-------|------|
| Milestone keys | Must be one of `plan_approval`, `pr_approval`, `deploy_approval`. |
| Values | Must be booleans. |

### worca.governance

| Field | Rule |
|-------|------|
| `guards` keys | Must be one of `block_rm_rf`, `block_env_write`, `block_force_push`, `restrict_git_commit`. Values must be booleans. |
| `test_gate_strikes` | Must be an integer between 1 and 20 if present. |
| `dispatch` keys | Must be known agent names. Values must be arrays of known agent names. |

### permissions

| Field | Rule |
|-------|------|
| `allow` | Must be an array of strings if present. Each string must be non-empty. No further pattern validation (the format is enforced by Claude Code itself). |

### General

- The request body must be a JSON object (not null, not an array).
- Unknown top-level keys (anything other than `worca` and `permissions`) are silently ignored (they are not merged into the file).
- The `hooks` key is never writable via this endpoint, even if included in the body.

---

## 6. Testing Strategy

### Unit Tests (server-side)

Create `.claude/worca-ui/server/test/settings-api.test.js` (or colocate with existing test patterns).

**Test cases for GET /api/settings:**

1. Returns 200 with `worca` and `permissions` from a valid settings file.
2. Returns empty `worca: {}` and `permissions: {}` when the file has no worca/permissions keys.
3. Never includes `hooks` in the response.
4. Returns 500 when the settings file does not exist.
5. Returns 500 when the settings file contains invalid JSON.

**Test cases for POST /api/settings:**

1. Merges `worca.agents` correctly -- replaces the agents sub-object.
2. Merges `worca.loops` correctly -- replaces the loops sub-object.
3. Merges `worca.stages` correctly -- replaces the stages sub-object.
4. Merges `worca.governance` correctly -- replaces the governance sub-object.
5. Preserves `hooks` even if the client sends a `hooks` key.
6. Preserves unrelated worca sub-keys not mentioned in the request.
7. Replaces `permissions` wholesale when provided.
8. Returns the full merged state in the response.
9. Written file is valid JSON with 2-space indent and trailing newline.

**Validation rejection tests:**

10. Rejects unknown agent names (e.g., `worca.agents.hacker`).
11. Rejects invalid model values (e.g., `model: 'gpt4'`).
12. Rejects `max_turns` outside 1-500 range.
13. Rejects `max_turns` when it is not an integer (e.g., `3.5`).
14. Rejects unknown stage names.
15. Rejects `enabled` when it is not a boolean.
16. Rejects loop values that are negative.
17. Rejects non-boolean milestone values.
18. Rejects `test_gate_strikes` outside 1-20.
19. Rejects dispatch arrays containing unknown agent names.
20. Rejects non-object request bodies (null, array, string).

**Test approach:** Use `supertest` (or plain `fetch` against a test server) with a temporary settings file created in a `tmp` directory per test. The `createApp({ settingsPath })` factory makes this straightforward.

### Integration Tests (manual or Playwright)

1. Start the server, navigate to `#/settings`.
2. Verify all 4 tabs load with correct values from settings.json.
3. Change an agent model, click Save Agents, refresh -- verify persistence.
4. Toggle a stage off in Pipeline, save, refresh -- verify persistence.
5. Change a governance guard, save, refresh -- verify persistence.
6. Verify `hooks` in settings.json are untouched after any save.

---

## 7. Dependencies and Risks

### Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Express.js | Installed | Already in the server; `express.json()` middleware is built-in. |
| `fs.readFileSync` / `writeFileSync` | Available | Node.js built-in. Synchronous is acceptable for a single-user dev tool. |
| Frontend settings.js | Complete | All 4 tabs are built and already call the endpoints. |
| Frontend routing | Complete | `#/settings` route and `loadSettings()` bootstrap are wired. |
| Shoelace components | Installed | Tab group, switch, input, select, alert, button all imported in main.js. |
| `settings-reader.js` | Exists | Used by WS handler. The REST GET can reuse it or read directly. |

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Concurrent writes** -- two browser tabs saving simultaneously could cause one write to clobber the other. | Low | Single-user tool. Acceptable for now. Future mitigation: add an `etag`/`If-Match` header for optimistic concurrency. |
| **File corruption on crash** -- `writeFileSync` could leave a partial file if the process is killed mid-write. | Low | Write to a temp file then rename (atomic on most filesystems). Not critical for a dev tool but worth noting. |
| **`hooks` corruption** -- a bug in merge logic could overwrite the hooks namespace, breaking Claude Code's tool-use guards. | High | The POST handler must explicitly preserve `raw.hooks` by never assigning to it. Validation must reject `hooks` in the body. Test case #5 covers this. |
| **Frontend bundle staleness** -- if no frontend changes are needed, the bundle does not need rebuilding. But if the response shape changes, the bundle must be rebuilt. | Low | Task 6 is conditional. |
| **Validation gaps** -- new settings keys added in the future won't be validated until the validator is updated. | Medium | Use an allowlist approach (reject unknown keys) rather than a denylist. This is already specified in the validation rules. |

---

## 8. File Summary

Files that **will be modified:**

| File | Change |
|------|--------|
| `.claude/worca-ui/server/app.js` | Add `express.json()`, accept options, add GET and POST `/api/settings` routes with validation. |
| `.claude/worca-ui/server/index.js` | Pass `{ settingsPath }` to `createApp()`. |

Files that **may be created:**

| File | Purpose |
|------|---------|
| `.claude/worca-ui/server/settings-validator.js` | Validation logic, if it exceeds ~40 lines inline. |
| `.claude/worca-ui/server/test/settings-api.test.js` | Unit tests for the REST endpoints. |

Files that **should not be modified:**

| File | Reason |
|------|--------|
| `.claude/settings.json` | Only modified at runtime by the POST endpoint, not by this implementation. |
| `.claude/worca-ui/app/views/settings.js` | Already correctly calls the endpoints with the right request/response shapes. |
| `.claude/worca-ui/server/ws.js` | WS handler is unrelated to REST endpoints. |
| `.claude/worca-ui/server/settings-reader.js` | Read-only utility used by WS. The REST handler reads directly to avoid coupling. |
