# A6 Export to a Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A product owner sends a feature's spec to the team's tracker as a ticket and keeps that ticket in step: **Export ▾ › Export to Jira…** opens a one-time **Set up export for <name>**, then a preview of the ticket exactly as it will be sent; a feature that is not Ready goes only with a recorded reason; after an export the header shows the ticket chip and a **History** card records it; **Export again** updates the ticket, adds a comment (shown before it is sent) or makes a new ticket, and warns before replacing a description edited in the tracker; a run started from the feature reports back to the ticket. No model call, no cost; behind the `requirements` flag.

**Architecture:** The Requirements code knows only "a task source that can export": six optional connector ops (`exportOptions`, `createTicket`, `updateTicket`, `commentTicket`, `ticketState`, `findTicket`) plus `capabilities().export`, called server-side through the existing `callSource` (plugin API stays 5). A pure module `src/core/requirements/ticket.mjs` builds the tool-neutral ticket, the changes since the last export, the comment and the preview hash; `src/core/requirements/export.mjs` is the service (tracker discovery, setup, preview, export with the duplicate guard, Forget the link, the feature's `export` view). Storage is two new tables (schema v79): the export setup per project or workspace and the ticket link per feature; every export is an `export` turn. Jira's part lives only in `plugins/jira-source/connector/index.mjs` (REST v2, wiki markup, Cloud and Data Center). Start gains **Report back**: an in-process `reportTo` makes the run's pipeline row a `plugin` row, so today's write-back reports to the ticket unchanged. The page module `ui/public/requirements-view.mjs` gains the menu items, five dialogs, the chip, the History card and the Report back row; CSS goes into the Requirements block of `ui/public/style.css`.

**Tech Stack:** Node ESM, `node:sqlite`, `node:test`, jsdom, Express (`ui/server.mjs` → `src/core/requirements/routes.mjs`), the plugin shim (`src/core/plugin-shim.mjs`, one child per op, `WORCA_MOCK=1` canned answers), vanilla DOM (`ui/public/*.mjs`), headless Chrome over CDP for the browser proof.

**Spec:** `plans/requirements-a6-design.md` (decisions D1–D20 and §3–§9; it wins where this plan is unclear). A1: `plans/requirements-design.md`; A2: `plans/requirements-a2-design.md`; A8: `plans/requirements-a8-design.md`.

**Visual reference (UI tasks):** design round 5 of the Claude Design canvas "Requirements — design rounds 1 to 5": board 26 **Export setup** (`ExportSetup.dc.html`, with the Export ▾ menu note), board 27 **Preview** and the not-Ready dialog (`ExportPreview.dc.html`), board 28 **After, and again** (`ExportAgain.dc.html`: chip, History, again dialog, comment preview), board 29 **States** (`ExportStates.dc.html`), board 30 the dark theme (`ExportDark.dc.html`: tokens only, nothing to build), board 31 **Phone** (`ExportPhone.dc.html`). The boards use upstream's classes (`card`, `btn` (the boards' `btn-mini` is `btn-sm`), `btn-primary`, `badge`, `chip`, `hint`, `select-wrap`, `field`, `menu` / `menu-item`); inline styles are layout hints. Where the design doc deviates from a board the doc wins; what no board shows is listed in design §7 "Not on the boards": build exactly that.

## Global Constraints

- Work only in this worktree, on branch `feat/req-a6-jira-export`. Its git identity is already set: never change git config. Commits only in this worktree; never push; no rebase, no amend; a merge is a merge commit (`git merge --no-ff`).
- One commit per task (Task 12 may add fix commits); subjects start `Requirements:`; every message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (`git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`).
- Never `rm -rf` (or `Remove-Item -Recurse -Force`) anything. Temporary folders the tests make are removed by the tests themselves (`useTempHome`, `rm(…, { recursive: true, force: true })` inside a test); a folder you made by hand stays.
- **No paid calls, no real Jira.** Nothing in this plan calls a model. Every tracker call in a test goes to the mock shim (`WORCA_MOCK=1`), an injected `callSource`, or the fake Jira HTTP server of Task 4 (`test/helpers/fake-jira.mjs`, on `127.0.0.1`). A check against a real Jira is a separate step after Task 12, only with the user's OK and on a test project they name (Task 12 stops before it).
- **Tests run one file at a time:** `node tools/test.mjs test/<file>.test.mjs` from the worktree root (it gives a hermetic HOME and the guard that stops a real `claude` from starting). Never plain `node --test`. The full suite runs only in Task 12. This repo is developed on Windows, where about 170–200 upstream tests fail on clean `dev`: a failing test is called pre-existing only after the same file was run in the baseline worktree (a detached checkout of the base; its path is given in your task dispatch), written `<baseline>` below — `cd <baseline> && node tools/test.mjs test/<file>.test.mjs` — and the failing test names match.
- No local machine paths in shipped files (code, tests, docs, this plan's commits). No import from Shaper code; core modules never import `ui/server.mjs`.
- The `requirements` flag gates everything (D19): every new route is in `REQUIREMENTS_ROUTES` behind `requireFlag('requirements')` (the flag-off walk in `test/requirements-api.test.mjs` covers it); changes reach the page only through `requirementsChangeNotifier`'s `requirements-changed` frame; nothing is booked in `req_cost_ledger`.
- Schema **v79** (`SCHEMA_VERSION` 77 → 79; 78 is A3's on its sibling branch): `req_export_setups` and `req_export_links` exactly as design §3, `IF NOT EXISTS`, both in `INCREMENTAL_TABLES`; the rung `if (current < 79) db.exec(REQUIREMENTS_EXPORT_DDL);` after the v77 rung; no column on an existing table. Task 12 renumbers if the base has taken 79.
- The plugin contract (D3): the six ops are optional and additive; `WORCA_PLUGIN_API` stays 5, `WORCA_PLUGIN_APIS` unchanged, jira-source keeps `"worca-cc-api": ">=5 <6"`. A source can export only when `capabilities()` answers `export: true`. The new ops are never added to `POST /api/sources/call`'s allowlist.
- Safety (D18): every tracker call is `callSource` from `export.mjs` (server-side); the setup and link tables hold plugin, source id and profile, never a config value; no view or response carries config except `doneStatus`; only the previewed ticket or comment is sent; file contents never, file names only. A preview renders as text nodes (`textContent`), never `innerHTML`.
- Timeouts (D14): every export op `EXPORT_TIMEOUT_MS = 60_000`. A timeout (or any thrown failure) on create or new keeps the pending marker (D10).
- Concurrency (D13): `exporting` is a Set taken before the first await; it lives in the leaf module `starting.mjs` beside `starting` (so `start.mjs` can read it without an import cycle; `export.mjs` re-exports `isExporting`). An export is refused while a round or look runs (`isBusy`), while a start is in flight (`isStarting`), on an archived feature, and while another export of the feature runs; Start is refused while exporting. Setup and preview calls hold no lock.
- `ui/public/style.css`: tokens only (no hex, no `rgba(`); font sizes from the type scale (`var(--fs-caption)` 11, `var(--fs-meta)` 12, `var(--fs-body)` 13, `var(--fs-section)` 15, 18px for a dialog title, never 11.5/12.5/14px); radii `var(--r-xs|sm|md)` or 0, never 12px/999px; no `min-height:44px` (44 is off the control scale) — phone tap areas are a `::after` hit area, as `.req-fpick::after`; shared icons (`icon(ICONS.remove)`, `icon(ICONS.check)`, `sharedIcon(document, 'external', 12)`) never a text glyph such as × or ✓ or ↗; on/off controls never green-filled (the Report back switch is upstream's ink `.switch`). Every new rule is a `req-export-*`, `req-history*` or `req-report*` rule inside the Requirements block, which ends right before `/* ── marketplace P3 ── */`.
- Dialogs (D20): `role="dialog"` `aria-modal="true"`, labelled by their title, through the page's `openModal` (focus trapped, Escape closes when allowed, focus back to the trigger); the focus moves into the dialog the moment it opens: Connect a tracker on **Close**, Not Ready on the reason, every other export dialog (Setup, Preview, Again, Comment) on its `h2`, which is `tabindex="-1"` (a later move — Setup's Connection, Again's default choice — happens only after a successful load); while an export dialog is open every other child of `<body>` is inert, released on close and when the user leaves the Requirements view (`leave()`, called by `app.js`). Every async answer checks the dialog's generation (`dlgGen`) and is dropped when its dialog is gone. Live regions (`role="status"`, `role="alert"`) are persistent nodes whose text changes; they are never rebuilt by an unrelated repaint.
- Phone (D20): at 900 px and narrower (controller decision 2026-10-27; consistent with A3's sheet) an export dialog is a full-screen sheet: `position:fixed; inset:0` (the viewport's size, never the content's), scrolling inside, **← FEAT-7** first, the description folded behind **Show all**, full-width buttons with 44 px hit areas. Board 31's title (user decision 2026-10-26): at 900 px and narrower the preview's heading reads "Export to Jira" with "FEAT-7 · <title>" on a second line (CSS hides the `FEAT-7 ` part of the one `h2`, which still labels the dialog); wider, it stays "Export FEAT-7 to Jira".
- Product copy never shows a raw error, a stack, a path or an HTTP status: a refusal shows the server's product message (`errText`), anything else "Worca could not finish that. Try again.". A tracker failure answers 502 `{ error, kind }` with D11's sentence.
- User-facing copy, verbatim (design §2, §7; `Jira` is the tracker's `displayName`, `SHOP` the tracker project, `SHOP-123` the ticket, `FEAT-7` the feature, `shop` the project or workspace name, `26 Oct` server-local dates):
  - Menu: "Save to specs/" · "Copy Markdown" · "Download .md" · a separator · "Export to Jira…" ("Export to a tracker…" with several trackers and none bound) · "Export setup…" · or "Connect a tracker…"; archived: "Export to Jira…" disabled with "Restore the feature to export it.".
  - Connect a tracker: title "Connect a tracker" · "Trackers are connected on the Marketplace page (Advanced mode), or by whoever set up Worca." · "Close" · at the Advanced level "Open the Marketplace page".
  - Setup (board 26): "Set up export for shop" · "Worca uses these for every export from shop. You can change them for one export in the preview, or for good in Export ▾ › Export setup…" · "Connection" (option: the profile's label, led by "Jira · " when several trackers can export) · "Connections are added on the Marketplace page: Installed › Jira (Advanced mode)." · "Jira project" · "Issue type" · "Labels" · "Add a label" · "Remove label <label>" · "Priority" "optional" · "None" · "Acceptance criteria go to" · "A section of the description" · "A Jira field" · select name "Jira field for acceptance criteria", its options "<field> (custom field)" ("Acceptance Criteria (custom field)", board 26; the saved name is the bare field name) · "The list shows the text fields of SHOP that can hold the criteria." · "Cancel" · "Save and continue" (from Export setup…: "Save") · "This Jira is too old for export setup.".
  - Not Ready (board 27): "Export FEAT-7 before it’s Ready?" · "One check does not pass yet:" / "<n> checks do not pass yet:" · "**<n> open question(s).** <the first one>" · "**A-4 is not decided.** The ticket lists confirmed assumptions only." ("A-4 and A-5 are not decided." for several) · other checks as the Start dialog lists them ("**<label>**: <hint>") · "Why export before it is Ready?" with "required, kept on the feature with your name" · "0 / 500" · "Your reason is recorded on the feature. The preview then adds it at the top of the description: “Exported before Ready: <your reason>”." · "Keep deciding" · "Export anyway".
  - Preview (board 27): "Export FEAT-7 to Jira" (at 900 px and narrower, board 31: "Export to Jira" over "FEAT-7 · Cancel an order before it ships") · "This is the ticket Worca will create in SHOP. Change the issue type, labels or priority for this export." (Update: "This is the ticket Worca will update in SHOP. Change the issue type, labels or priority for this export.") · "Fields" · "Project" · "Saved in the export setup · <connection>" · "Issue type" · "Summary" · "The feature's title" · "Labels" · "worca-FEAT-7 stays: Worca uses this label to find the ticket again." · "Priority" · "Acceptance criteria" · "→ Description" · "A section of the description, as in the export setup" · "→ <field name>" · "Description, as Jira will show it" · name "Description preview" · "Show all" · "Only what you see here is sent to Jira." · "Cancel" · "Create in Jira" (Update: "Update SHOP-123"; a new ticket: "Create in Jira") · phone "← FEAT-7" named "Back to FEAT-7".
  - States (board 29): "Worca could not reach Jira: <reason>." with `<reason>` "the API token was refused" (`auth`), "it did not answer within a minute" (`timeout`), else the plugin's message without a final period · "Try again" · "Nothing was recorded. The preview stays open, so you can try again once the connection is fixed on the Marketplace page (Installed › Jira)." · "Jira needs a value for “Team” in SHOP." / "Jira refused “<field>”: <Jira's message>" · "Change the export setup" · "SHOP-123 no longer exists in Jira." · "It was deleted or moved where this connection cannot see it. Forget the link removes the SHOP-123 chip; the history keeps the export." · "Forget the link" · "New ticket" · "Exporting to Jira…" (blue badge) · "Created SHOP-123" (after an update "Updated SHOP-123", after a comment "Commented on SHOP-123") · "The spec changed since the preview. Look at the preview again.".
  - Again (board 28): "Export FEAT-7 again" · "SHOP-123 was made on 26 Oct. The spec has changed since. What should happen?" · nothing changed: "SHOP-123 was made on 26 Oct. The spec has not changed since the last export (26 Oct)." · radio group "What should happen": "Update SHOP-123" "Rewrites its summary, description and fields." · "Add a comment to SHOP-123" "Lists what changed since the last export. The description stays." · "Create a new ticket" "For example when the feature was split." · "What changed since the last export (26 Oct)" · lines "Added R-po-6 <text>", "Changed R-po-2 <new text>", "Removed R-po-3 <text>", "Business rules: 1 line changed", "Edge cases: 1 line added", "Main flow: 2 lines removed", "Goal: 1 line changed", "Measure: 1 line added", "Confirmed A-4 <text>", "A-2 is no longer confirmed" · "The preview shows the result before anything is sent." · alert "**SHOP-123 was edited in Jira since your last export.** Updating replaces its description." with "Update anyway" · "Add a comment instead" · "Cancel" · "Cancel" · "Continue".
  - Comment (board 28): "Comment on SHOP-123" · "This comment is added to SHOP-123. Its description and fields stay as they are." · name "Comment preview" · "Only what you see here is sent to Jira." · "Back" · "Add comment". The comment (design §4, board 28's punctuation): "Updated in Worca since the last export (26 Oct)", then "Exported before Ready: <reason>" when given, one paragraph per change ("Added R-po-6 <text>", "Changed R-po-2: “<new>” was “<old>”", "Removed R-po-3 <text>", "Business rules: “<new>” was “<old>”", "Edge cases: added “<line>”", "Main flow: removed “<line>”", "Goal: “<new>” was “<old>”", "Measure: added “<new>”", "Confirmed A-4 <text>", "A-2 is no longer confirmed"), then "From Worca FEAT-7".
  - Header and History (board 28): chip "SHOP-123" with the external icon, named "SHOP-123, opens the ticket in Jira in a new tab", `target="_blank" rel="noopener"` · card "History" · lines "Exported to Jira as SHOP-123 · 26 Oct, 10:42" (and a new ticket), "Updated SHOP-123 in Jira · …", "Commented on SHOP-123 in Jira · …", "Linked SHOP-123, which an earlier export made · …", "Forgot the link to SHOP-123 · …", an Export anyway line adding " · before Ready: <reason>", each with the person's name.
  - Report back (board 29): switch "Report back to SHOP-123" · with a status "When the run ends, Worca comments with the result and the pull request link, and moves the ticket to Done (the status named in the Jira connection; without one, it only comments)." · without "When the run ends, Worca comments with the result and the pull request link. The Jira connection names no status to move the ticket to, so it only comments.".
  - Server refusals (design and this plan): "Worca is already exporting this feature." · "Worca is still working on this feature. Try again in a moment." · "this feature is starting a run. Try again in a moment." (`STARTING_MESSAGE`) · "Worca is exporting this feature. Try again in a moment." (Start while exporting) · "this feature is archived; restore it first" · "The spec changed since the preview. Look at the preview again." · "This feature is not Ready. Give a reason to export it anyway." · "the reason must be at most 500 characters" · copy this plan adds where the design names none, said once: "Set up the export first." · "This feature has a ticket already. Export it again instead." · "This feature has no ticket yet." · "Nothing changed since the last export." · "mode must be create, update, comment or new" · "Choose a connection from the list." · "project is required" · "issueType is required" · "criteria.field is required" · "reportBack must be true or false" · "SHOP-123 was edited in Jira since your last export. Updating replaces its description." (the 409 of an update raced by an edit) · "The tracker refused the ticket." (a refusal without a message) · "Jira cannot export any more." (an export op answers `unimplemented` after a cached "yes", e.g. a downgraded connector) · jira-source's message for a request Jira refused without naming a field: "Jira refused the request: <Jira's errorMessages, or "no reason given">" (never the HTTP status or the REST path).

## Review Focus

0. **No tracker call from the browser, no secret out.** Every op goes through `export.mjs` → `callSource`; `/api/sources/call`'s allowlist is unchanged; no response carries a config value (Tasks 3, 5, 6, 7).
1. **Only what the preview shows is sent.** The preview hash covers the exact ticket or comment; the export rebuilds and compares it; labels are normalised in Worca (Tasks 2, 5).
2. **Nothing recorded on a failure; no duplicate on a lost answer.** A failed call writes no link or turn; a create keeps its pending marker until a definite answer; the next export finds the ticket only when label, marker and footer all match; once Jira made the ticket the plugin answers its key even when the marker property or the read-back fails, so Try again never makes a second one (Tasks 4, 5).
3. **Edited in the tracker.** The fingerprint is the plugin's, stored after every create and update, untouched by a comment; Update is refused while it differs unless forced (Tasks 4, 5, 9).
4. **Report back rides the existing write-back.** A start with a linked ticket makes a `plugin` pipeline row (`source_ref` with the link's own connection and `inputs.writeBack: 'yes'`); `_reportTo` is in-process only (Task 7).
5. **The round is unchanged.** An `export` turn writes no thread line, never hides the error line, never changes what Try again re-runs (Tasks 1, 6).
6. **Accessibility and phone.** Dialog roles and names, the radiogroup, persistent live regions, focus return, the page inert while open and released on leave, the 390 px sheet (Tasks 8–11).

## File Structure

| File | Create / Modify | Responsibility |
|---|---|---|
| `src/core/db.mjs` | Modify (Task 1) | v79: `REQUIREMENTS_EXPORT_DDL`, `INCREMENTAL_TABLES`, the rung |
| `src/core/requirements/spec.mjs` | Modify (Task 1, 5) | turn kind `export`; error code `TRACKER` in the JSDoc |
| `src/core/requirements/store.mjs` | Modify (Task 1) | `getExportSetup`, `upsertExportSetup`, `setExportSetupDoneStatus`, `getExportLink`, `setPendingExport`, `saveExportLink`, `clearPendingExport`, `deleteExportLink` |
| `src/core/requirements/markdown.mjs` | Modify (Task 2) | `renderTicketMarkdown`, `criterionLine` (shares `bullets`, `numbered`, `from`) |
| `src/core/requirements/ticket.mjs` | Create (Task 2) | pure: `EXPORT_LIMITS`, `exportLabel`, `normalizeLabels`, `exportDate`, `exportTime`, `buildTicket`, `exportChanges`, `changeSummary`, `renderExportComment`, `ticketHash` |
| `src/core/plugin-shim.mjs` | Modify (Task 3) | `MOCK_DEFAULTS`: `capabilities` and the six export ops |
| `src/core/plugin-api.mjs` | Modify (Task 3) | the comment line on the optional export ops |
| `src/core/requirements/export.mjs` | Create (Task 3), grows in Task 5 | `EXPORT_TIMEOUT_MS`, the capability cache, `exportTrackers`, `defaultConnection`, `reachReason`, `reachSentence`; then `isExporting`, `mentionedFiles`, `exportSetupView`, `exportOptions`, `saveSetup`, `previewExport`, `runExport`, `forgetLink`, `exportView` |
| `src/core/requirements/starting.mjs` | Modify (Task 5) | `markExporting`, `unmarkExporting`, `isExporting`, `EXPORTING_MESSAGE` |
| `plugins/jira-source/connector/index.mjs` | Modify (Task 4) | the six ops, `capabilities().export`, `fingerprintOf` |
| `plugins/jira-source/connector/jira-api.mjs` | Modify (Task 4) | a failed request's error carries Jira's JSON body (`body`) |
| `plugins/jira-source/README.md` | Modify (Task 4) | an Export section |
| `.claude/skills/creating-worca-cc-plugins/SKILL.md` | Modify (Task 3) | the connector contract table: the optional export ops |
| `src/core/requirements/routes.mjs` | Modify (Task 6, 7) | design §6 routes, `TRACKER` → 502, `featureView`'s `export`, the `last` filter; `reportBack` on start |
| `src/core/requirements/interview.mjs` | Modify (Task 6) | `retry`'s filter |
| `src/core/requirements/start.mjs` | Modify (Task 7) | `reportBack`, `reportTo`, the export lock |
| `ui/server.mjs` | Modify (Task 7) | `invokeStartRun` → `req._reportTo` → `createOrchestratorFor({ reportTo })` (project and workspace starts) |
| `src/core/run-harness.mjs` | Modify (Task 7) | `sourceType` / `sourceMeta` from `this.opts.reportTo` |
| `ui/public/requirements-view.mjs` | Modify (Tasks 8, 9, 10) | menu items, Connect, Setup, Not Ready, Preview, Again, Comment, states, chip, History, Report back, `leave()` |
| `ui/public/app.js` | Modify (Task 10) | `requirementsView.leave()` when another view is shown |
| `ui/public/style.css` | Modify (Tasks 8, 9, 10) | `req-export-*`, `req-history*`, `req-report*` inside the Requirements block |
| `tools/verify-requirements-cdp.mjs` | Modify (Task 11) | the A6 section (light, dark, 390 px), runnable alone with `--only=a6` |
| `docs/requirements.md`, `docs/storage.md`, `docs/ui-levels.md`, `docs/changelog/unreleased.md` | Modify (Task 11) | Export to a tracker, the two tables, the levels, the changelog |
| Tests (Create) | | `test/db-migrate-v79.test.mjs`, `test/requirements-export-store.test.mjs`, `test/requirements-ticket.test.mjs`, `test/requirements-export-trackers.test.mjs`, `test/helpers/fake-jira.mjs`, `test/jira-source-export.test.mjs`, `test/requirements-export.test.mjs`, `test/requirements-export-api.test.mjs`, `test/requirements-view-export.test.mjs` |
| Tests (Modify) | | `test/plugin-shim.test.mjs` (mock answers), `test/writeback.test.mjs` (the tolerant default kept explicit), `test/requirements-start.test.mjs` (Report back, the export lock), `test/requirements-run-link.test.mjs` (the plugin row, write-back, `_reportTo` and the allowlist) |

---
### Task 1: Schema v79, the setup and link rows, the `export` turn

**Files:**
- Modify: `src/core/db.mjs` (`SCHEMA_VERSION` 77 → 79 at line ~66; `REQUIREMENTS_EXPORT_DDL` right after `REQUIREMENTS_ATTACHMENTS_DDL` (~line 1345–1369); two `INCREMENTAL_TABLES` entries after `req_attachments` (~line 1418); the rung after the v77 rung (~line 2559))
- Modify: `src/core/requirements/spec.mjs` (`TURN_KINDS`)
- Modify: `src/core/requirements/store.mjs` (append an export section at the end)
- Create: `test/db-migrate-v79.test.mjs`, `test/requirements-export-store.test.mjs`

**Interfaces:**
- Consumes: `getDb`, `prepare` (`db.mjs`); `json`, `iso`, `checkScope` (store.mjs internals); `buildRoundPrompt` (round.mjs, test only).
- Produces (`store.mjs`):
  - `Conn = { plugin: string, sourceId: string, profile: string|null }`
  - `getExportSetup(scopeType, scopeKey) → Setup|null` (throws `RequirementsError('BAD_REQUEST')` for a bad scope)
  - `upsertExportSetup({ scopeType, scopeKey, plugin, sourceId, profile = null, trackerProject, trackerProjectName, issueType, issueTypeName, labels = ['worca'], priority = null, priorityName = null, criteria = { target: 'description' }, doneStatus = null }, { by = null } = {}) → Setup` (`created_by` / `created_at` kept on an update)
  - `setExportSetupDoneStatus(scopeType, scopeKey, doneStatus) → void`
  - `Setup = { scopeType, scopeKey, plugin, sourceId, profile, trackerProject, trackerProjectName, issueType, issueTypeName, labels: string[], priority, priorityName, criteria: { target: 'description' } | { target: 'field', field, name }, doneStatus, createdBy, createdAt, updatedBy, updatedAt }`
  - `getExportLink(seq) → Link|null` (a row that holds only a pending create has `key: null`)
  - `setPendingExport(seq, { plugin, sourceId, profile = null, trackerProject, marker }, { by = null } = {}) → Link` (a new row takes the connection and project; an existing row keeps its connection, project and key and only gets the marker)
  - `saveExportLink(seq, { plugin, sourceId, profile = null, trackerProject, key, url = null, createdAt = null, exportedAt = null, spec = null, fields = null, fingerprint = null }, { by = null } = {}) → Link` (the whole link; clears the pending marker; other keys of the argument are ignored, so `{ ...link, exportedAt }` works)
  - `clearPendingExport(seq) → void` (a row without a key is deleted; a row with one keeps it and loses the marker)
  - `deleteExportLink(seq) → number` (rows deleted)
  - `Link = { featureSeq, plugin, sourceId, profile, trackerProject, key, url, createdAt, exportedAt, spec, fields, fingerprint, pendingMarker, pendingAt, updatedBy, updatedAt }`; `fields = { projectName, issueType, issueTypeName, labels, priority, priorityName, criteria }` as last sent.
- Produces (`spec.mjs`): `TURN_KINDS` includes `'export'`.

- [ ] **Step 1: Write the failing migration test** `test/db-migrate-v79.test.mjs`:

```js
// test/db-migrate-v79.test.mjs — req_export_setups and req_export_links (plans/requirements-a6-design.md §3). A3's sibling
// branch takes v78, so A6 is v79: a DB at 77 (A8), at 78 (stamped by A3's numbering, none of A6's tables), at A8's early 75,
// at upstream's 74–76, from below 72, or a fresh one reaches 79 with both tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const SETUP_COLS = ['scope_type', 'scope_key', 'plugin', 'source_id', 'profile', 'tracker_project', 'tracker_project_name', 'issue_type',
  'issue_type_name', 'labels_json', 'priority', 'priority_name', 'criteria_json', 'done_status', 'created_by', 'created_at', 'updated_by',
  'updated_at'];
const LINK_COLS = ['feature_seq', 'plugin', 'source_id', 'profile', 'tracker_project', 'ticket_key', 'ticket_url', 'created_at', 'exported_at',
  'spec_json', 'fields_json', 'fingerprint', 'pending_marker', 'pending_at', 'updated_by', 'updated_at'];
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

/** Every table with its columns (sorted: a repaired column is appended, not in DDL order) and every index name. */
function shape(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const out = {};
  for (const { name } of tables) out[name] = cols(db, name).sort();
  out['#indexes'] = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((r) => r.name);
  return out;
}
const FRESH = (() => { const db = new DatabaseSync(':memory:'); migrate(db); return shape(db); })();

function assertComplete(db) {
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'req_export_setups'), SETUP_COLS);
  assert.deepEqual(cols(db, 'req_export_links'), LINK_COLS);
  assert.ok(cols(db, 'req_attachments').length, 'req_attachments (v77)');
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
}
const A6 = 'DROP TABLE req_export_setups; DROP TABLE req_export_links;';
const A8 = 'DROP TABLE req_attachments; ALTER TABLE req_cost_ledger DROP COLUMN attachment_id; ALTER TABLE req_starts DROP COLUMN files_json;';
const UP76 = 'ALTER TABLE ask_threads DROP COLUMN group_id; DROP TABLE ask_chat_groups;';
const UP75 = 'ALTER TABLE ask_threads DROP COLUMN pinned_at; ALTER TABLE ask_threads DROP COLUMN archived_at;';
const fromStamp = (sql, stamp) => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${sql} PRAGMA user_version = ${stamp}`);
  migrate(db);
  return db;
};

test('a fresh DB has both export tables', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 79);
  assertComplete(db);
});

test('a DB at 77 (A8) gets both tables', () => assertComplete(fromStamp(A6, 77)));

test("a DB stamped 78 by A3's numbering (none of A6's tables) gets both tables", () => assertComplete(fromStamp(A6, 78)));

test("a DB at A8's early 75 (A8 tables, no upstream v75/v76) reaches the current version complete", () => {
  assertComplete(fromStamp(`${A6} ${UP76} ${UP75}`, 75));
});

test("a DB at upstream's 76, 75 or 74 (no A8, no A6) reaches the current version complete", () => {
  assertComplete(fromStamp(`${A6} ${A8}`, 76));
  assertComplete(fromStamp(`${A6} ${A8} ${UP76}`, 75));
  assertComplete(fromStamp(`${A6} ${A8} ${UP76} ${UP75}`, 74));
});

test('a DB from below 72 (upstream 70 or 71: no requirements tables) reaches the current version complete', () => {
  for (const [stamp, extra] of [[70, ' DROP TABLE utility_cost_ledger;'], [71, '']]) {
    assertComplete(fromStamp(`${A6} DROP TABLE req_attachments; DROP TABLE req_briefs; DROP TABLE req_starts; DROP TABLE req_cost_ledger;
      DROP TABLE req_contexts; DROP TABLE req_turns; DROP TABLE req_features;${extra}`, stamp));
  }
});

test('a DB stamped past this version without the tables is repaired', () => {
  const db = fromStamp(A6, SCHEMA_VERSION + 1);
  assert.deepEqual(cols(db, 'req_export_setups'), SETUP_COLS);
  assert.deepEqual(cols(db, 'req_export_links'), LINK_COLS);
});

test("a setup row takes its defaults: labels '[\"worca\"]', criteria to the description, no priority", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare(`INSERT INTO req_export_setups (scope_type, scope_key, plugin, source_id, tracker_project, tracker_project_name, issue_type,
    issue_type_name, created_at, updated_at) VALUES ('project', 'shop-1', 'jira-source', 'jira', 'SHOP', 'SHOP — Shop web', '10001', 'Story', 't', 't')`).run();
  const r = db.prepare('SELECT * FROM req_export_setups').get();
  assert.deepEqual([r.labels_json, r.criteria_json, r.priority, r.profile, r.done_status], ['["worca"]', '{"target":"description"}', null, null, null]);
  db.prepare("INSERT INTO req_export_links (feature_seq, plugin, source_id, tracker_project, updated_at) VALUES (7, 'jira-source', 'jira', 'SHOP', 't')").run();
  const l = db.prepare('SELECT * FROM req_export_links').get();
  assert.deepEqual([l.ticket_key, l.ticket_url, l.pending_marker, l.fingerprint], [null, null, null, null]);
});
```

- [ ] **Step 2: Run it and see it fail.** `node tools/test.mjs test/db-migrate-v79.test.mjs` → FAIL: `SCHEMA_VERSION >= 79` is false (77) and `no such table: req_export_setups`.

- [ ] **Step 3: Implement the migration** in `src/core/db.mjs`:
  - `export const SCHEMA_VERSION = 79;` (78 is A3's on its sibling branch; a gap is harmless: both rungs are reconcile-safe).
  - Right after `REQUIREMENTS_ATTACHMENTS_DDL`:

```js
// v79 Requirements A6 (plans/requirements-a6-design.md §3): export to a tracker. The setup per project or workspace names
// a connection (plugin, source id, profile; never a config value) and the tracker project, issue type, labels, priority and
// where the criteria go; the link per feature is its current ticket, the spec and fields as last sent, the plugin's
// fingerprint of the stored description, and a pending create's marker (D10). A3's sibling branch takes v78; whichever
// reaches dev second renumbers. Reconcile-safe: IF NOT EXISTS + INCREMENTAL_TABLES.
const REQUIREMENTS_EXPORT_DDL = `
CREATE TABLE IF NOT EXISTS req_export_setups (
  scope_type      TEXT NOT NULL,
  scope_key       TEXT NOT NULL,
  plugin          TEXT NOT NULL, source_id TEXT NOT NULL, profile TEXT,
  tracker_project TEXT NOT NULL, tracker_project_name TEXT NOT NULL,
  issue_type      TEXT NOT NULL, issue_type_name TEXT NOT NULL,
  labels_json     TEXT NOT NULL DEFAULT '["worca"]',
  priority        TEXT, priority_name TEXT,
  criteria_json   TEXT NOT NULL DEFAULT '{"target":"description"}',
  done_status     TEXT,
  created_by TEXT, created_at TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_key)
);
CREATE TABLE IF NOT EXISTS req_export_links (
  feature_seq     INTEGER PRIMARY KEY,
  plugin          TEXT NOT NULL, source_id TEXT NOT NULL, profile TEXT,
  tracker_project TEXT NOT NULL,
  ticket_key      TEXT, ticket_url TEXT,
  created_at      TEXT,
  exported_at     TEXT,
  spec_json       TEXT,
  fields_json     TEXT,
  fingerprint     TEXT,
  pending_marker  TEXT, pending_at TEXT,
  updated_by TEXT, updated_at TEXT NOT NULL
);
`;
```

  - `INCREMENTAL_TABLES`, right after `req_attachments:   REQUIREMENTS_ATTACHMENTS_DDL,`:

```js
  req_export_setups: REQUIREMENTS_EXPORT_DDL,  // v79 (A6)
  req_export_links:  REQUIREMENTS_EXPORT_DDL,  // v79 (A6)
```

  - After the v77 rung (`if (current < 77) { … }`):

```js
    // v79 requirements A6: req_export_setups + req_export_links (v78 is A3's on its sibling branch). New tables only, so no
    // repair call: INCREMENTAL_TABLES creates them for a DB stamped past this rung without them.
    if (current < 79) db.exec(REQUIREMENTS_EXPORT_DDL);
```

- [ ] **Step 4: Run and see it pass.** `node tools/test.mjs test/db-migrate-v79.test.mjs`, then `node tools/test.mjs test/db-migrate-v77.test.mjs`, `node tools/test.mjs test/db-migrate-v74.test.mjs`, `node tools/test.mjs test/db-migrate-v72.test.mjs` → all pass (v77's `assertComplete` compares with a fresh shape, which now has the A6 tables too; its drops leave them in place).

- [ ] **Step 5: Write the failing store test** `test/requirements-export-store.test.mjs`:

```js
// test/requirements-export-store.test.mjs — the export setup per scope, the ticket link per feature and the `export` turn
// (plans/requirements-a6-design.md §3, D2, D7, D10, D12).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  createFeature, appendTurn, listTurns, getExportSetup, upsertExportSetup, setExportSetupDoneStatus, getExportLink, setPendingExport,
  saveExportLink, clearPendingExport, deleteExportLink,
} from '../src/core/requirements/store.mjs';
import { TURN_KINDS } from '../src/core/requirements/spec.mjs';
import { buildRoundPrompt } from '../src/core/requirements/round.mjs';

useTempHome(after, 'worca-req-export-store-');
const CONN = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const SETUP = { ...CONN, trackerProject: 'SHOP', trackerProjectName: 'SHOP — Shop web', issueType: '10001', issueTypeName: 'Story',
  labels: ['worca'], priority: null, priorityName: null, criteria: { target: 'description' }, doneStatus: 'Done' };
const feature = () => createFeature({ scopeType: 'project', scopeKey: 'shop-1', title: 'Cancel order', description: 'Before it ships' });

test('setup: one per project and one per workspace; saving again updates it and keeps who made it; the done status alone', () => {
  assert.equal(getExportSetup('project', 'shop-1'), null);
  const p = upsertExportSetup({ scopeType: 'project', scopeKey: 'shop-1', ...SETUP }, { by: 'po' });
  assert.deepEqual([p.plugin, p.sourceId, p.profile, p.trackerProject, p.trackerProjectName, p.issueType, p.issueTypeName, p.labels, p.priority,
    p.criteria, p.doneStatus, p.createdBy], ['jira-source', 'jira', 'acme', 'SHOP', 'SHOP — Shop web', '10001', 'Story', ['worca'], null,
    { target: 'description' }, 'Done', 'po']);
  const w = upsertExportSetup({ scopeType: 'workspace', scopeKey: 'shop-1', ...SETUP, trackerProject: 'OPS', trackerProjectName: 'OPS — Operations' });
  assert.equal(w.trackerProject, 'OPS');
  assert.equal(getExportSetup('project', 'shop-1').trackerProject, 'SHOP', 'a workspace with the same key is another scope');
  const again = upsertExportSetup({ scopeType: 'project', scopeKey: 'shop-1', ...SETUP, labels: ['worca', 'web'], priority: '3', priorityName: 'Medium',
    criteria: { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' } }, { by: 'ann' });
  assert.deepEqual([again.labels, again.priority, again.priorityName, again.criteria, again.createdBy, again.updatedBy],
    [['worca', 'web'], '3', 'Medium', { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' }, 'po', 'ann']);
  setExportSetupDoneStatus('project', 'shop-1', null);
  assert.equal(getExportSetup('project', 'shop-1').doneStatus, null);
  assert.throws(() => getExportSetup('team', 'x'), /scopeType/);
});

test('link: a pending create has no key yet; clearing it removes the row', () => {
  const f = feature();
  assert.equal(getExportLink(f.seq), null);
  const p = setPendingExport(f.seq, { ...CONN, trackerProject: 'SHOP', marker: 'rexp_000000000001' }, { by: 'po' });
  assert.deepEqual([p.key, p.url, p.pendingMarker, p.plugin, p.profile, p.trackerProject], [null, null, 'rexp_000000000001', 'jira-source', 'acme', 'SHOP']);
  assert.ok(p.pendingAt);
  clearPendingExport(f.seq);
  assert.equal(getExportLink(f.seq), null);
});

test('link: saved; a pending new ticket keeps the current key and connection; clearing keeps the link; delete removes it', () => {
  const f = feature();
  setPendingExport(f.seq, { ...CONN, trackerProject: 'SHOP', marker: 'rexp_000000000002' });
  const spec = { ...f.spec, goal: { text: 'Cancel', measure: 'fewer calls' } };
  const s = saveExportLink(f.seq, { ...CONN, trackerProject: 'SHOP', key: 'SHOP-123', url: 'https://acme.test/browse/SHOP-123',
    createdAt: '2026-10-26T10:42:00.000Z', exportedAt: '2026-10-26T10:42:00.000Z', spec,
    fields: { projectName: 'SHOP — Shop web', issueType: '10001', issueTypeName: 'Story', labels: ['worca'], priority: null, priorityName: null,
      criteria: { target: 'description' } }, fingerprint: 'fp1', junk: 'ignored' }, { by: 'po' });
  assert.deepEqual([s.key, s.url, s.pendingMarker, s.pendingAt, s.fingerprint, s.spec.goal.text, s.fields.issueTypeName, s.updatedBy],
    ['SHOP-123', 'https://acme.test/browse/SHOP-123', null, null, 'fp1', 'Cancel', 'Story', 'po']);
  const pend = setPendingExport(f.seq, { plugin: 'other', sourceId: 'x', profile: null, trackerProject: 'OPS', marker: 'rexp_000000000003' });
  assert.deepEqual([pend.key, pend.plugin, pend.trackerProject, pend.pendingMarker], ['SHOP-123', 'jira-source', 'SHOP', 'rexp_000000000003']);
  clearPendingExport(f.seq);
  assert.deepEqual([getExportLink(f.seq).key, getExportLink(f.seq).pendingMarker], ['SHOP-123', null]);
  const upd = saveExportLink(f.seq, { ...getExportLink(f.seq), exportedAt: '2026-10-27T09:00:00.000Z', fingerprint: 'fp2' });
  assert.deepEqual([upd.createdAt, upd.exportedAt, upd.fingerprint], ['2026-10-26T10:42:00.000Z', '2026-10-27T09:00:00.000Z', 'fp2']);
  assert.equal(deleteExportLink(f.seq), 1);
  assert.equal(getExportLink(f.seq), null);
  assert.equal(deleteExportLink(f.seq), 0);
});

test('turn kind export: stored and listed; a round prompt is byte-identical with or without it', () => {
  assert.ok(TURN_KINDS.includes('export'));
  const f = feature();
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
  const before = buildRoundPrompt({ feature: f, turns: listTurns(f.seq) });
  appendTurn(f.seq, { kind: 'export', payload: { action: 'created', tracker: 'Jira', key: 'SHOP-123', url: 'https://acme.test/browse/SHOP-123',
    at: '2026-10-26T10:42:00.000Z' } }, { by: 'po' });
  const turns = listTurns(f.seq);
  assert.deepEqual([turns.at(-1).kind, turns.at(-1).payload.key, turns.at(-1).by], ['export', 'SHOP-123', 'po']);
  assert.equal(buildRoundPrompt({ feature: f, turns }), before, 'threadText writes no line for an export');
});
```

- [ ] **Step 6: Run it and see it fail.** `node tools/test.mjs test/requirements-export-store.test.mjs` → FAIL: `getExportSetup` is not exported (SyntaxError on import).

- [ ] **Step 7: Implement the turn kind and the store.** In `src/core/requirements/spec.mjs`, replace `TURN_KINDS` with:

```js
export const TURN_KINDS = Object.freeze(['orientation', 'round', 'answers', 'edit', 'assumption', 'finish', 'error', 'followup', 'start',
  'file',     // A8: a file was added, replaced, removed, edited, read or asked about
  'export']); // A6: a ticket was created, updated, commented on, made anew, linked or forgotten (no thread line)
```

  Append to `src/core/requirements/store.mjs`:

```js
// ---- export to a tracker (plans/requirements-a6-design.md §3, D2, D7–D10, D12): the setup per project or workspace (a
// connection and the ticket's defaults, never a config value) and the current ticket per feature ----

function toSetup(r) {
  if (!r) return null;
  return {
    scopeType: r.scope_type, scopeKey: r.scope_key, plugin: r.plugin, sourceId: r.source_id, profile: r.profile || null,
    trackerProject: r.tracker_project, trackerProjectName: r.tracker_project_name, issueType: r.issue_type, issueTypeName: r.issue_type_name,
    labels: json(r.labels_json, ['worca']), priority: r.priority || null, priorityName: r.priority_name || null,
    criteria: json(r.criteria_json, { target: 'description' }), doneStatus: r.done_status || null,
    createdBy: r.created_by || null, createdAt: r.created_at, updatedBy: r.updated_by || null, updatedAt: r.updated_at,
  };
}

export function getExportSetup(scopeType, scopeKey) {
  checkScope(scopeType, scopeKey);
  getDb();
  return toSetup(prepare('SELECT * FROM req_export_setups WHERE scope_type = ? AND scope_key = ?').get(scopeType, scopeKey));
}

export function upsertExportSetup({ scopeType, scopeKey, plugin, sourceId, profile = null, trackerProject, trackerProjectName, issueType, issueTypeName,
  labels = ['worca'], priority = null, priorityName = null, criteria = { target: 'description' }, doneStatus = null } = {}, { by = null } = {}) {
  checkScope(scopeType, scopeKey);
  getDb();
  const ts = iso();
  prepare(`INSERT INTO req_export_setups (scope_type, scope_key, plugin, source_id, profile, tracker_project, tracker_project_name, issue_type,
      issue_type_name, labels_json, priority, priority_name, criteria_json, done_status, created_by, created_at, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (scope_type, scope_key) DO UPDATE SET plugin = excluded.plugin, source_id = excluded.source_id, profile = excluded.profile,
        tracker_project = excluded.tracker_project, tracker_project_name = excluded.tracker_project_name, issue_type = excluded.issue_type,
        issue_type_name = excluded.issue_type_name, labels_json = excluded.labels_json, priority = excluded.priority,
        priority_name = excluded.priority_name, criteria_json = excluded.criteria_json, done_status = excluded.done_status,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(scopeType, scopeKey, plugin, sourceId, profile || null, trackerProject, trackerProjectName || trackerProject, issueType,
      issueTypeName || issueType, JSON.stringify(labels || []), priority || null, priority ? (priorityName || priority) : null,
      JSON.stringify(criteria || { target: 'description' }), doneStatus || null, by, ts, by, ts);
  return getExportSetup(scopeType, scopeKey);
}

/** exportOptions' doneStatus, refreshed on every options call for the setup's own connection (D15). */
export function setExportSetupDoneStatus(scopeType, scopeKey, doneStatus) {
  checkScope(scopeType, scopeKey);
  getDb();
  prepare('UPDATE req_export_setups SET done_status = ? WHERE scope_type = ? AND scope_key = ?').run(doneStatus || null, scopeType, scopeKey);
}

function toLink(r) {
  if (!r) return null;
  return {
    featureSeq: Number(r.feature_seq), plugin: r.plugin, sourceId: r.source_id, profile: r.profile || null, trackerProject: r.tracker_project,
    key: r.ticket_key || null, url: r.ticket_url || null, createdAt: r.created_at || null, exportedAt: r.exported_at || null,
    spec: json(r.spec_json, null), fields: json(r.fields_json, null), fingerprint: r.fingerprint || null,
    pendingMarker: r.pending_marker || null, pendingAt: r.pending_at || null, updatedBy: r.updated_by || null, updatedAt: r.updated_at,
  };
}

export function getExportLink(seq) {
  getDb();
  return toLink(prepare('SELECT * FROM req_export_links WHERE feature_seq = ?').get(Number(seq)));
}

/** D10: recorded before a create or new-ticket call. A first export makes a row without a key (its connection and project);
 *  a feature with a ticket keeps its link and only gets the marker. */
export function setPendingExport(seq, { plugin, sourceId, profile = null, trackerProject, marker } = {}, { by = null } = {}) {
  getDb();
  const ts = iso();
  prepare(`INSERT INTO req_export_links (feature_seq, plugin, source_id, profile, tracker_project, pending_marker, pending_at, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (feature_seq) DO UPDATE SET pending_marker = excluded.pending_marker, pending_at = excluded.pending_at,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(Number(seq), plugin, sourceId, profile || null, trackerProject, marker, ts, by, ts);
  return getExportLink(seq);
}

/** The feature's current ticket, whole (D7, D8, D9): written after a create, an update, a comment, a new ticket or a
 *  ticket found again; the pending marker goes. Keys of the argument this table has no column for are ignored. */
export function saveExportLink(seq, { plugin, sourceId, profile = null, trackerProject, key, url = null, createdAt = null, exportedAt = null, spec = null,
  fields = null, fingerprint = null } = {}, { by = null } = {}) {
  getDb();
  const ts = iso();
  prepare(`INSERT INTO req_export_links (feature_seq, plugin, source_id, profile, tracker_project, ticket_key, ticket_url, created_at, exported_at,
      spec_json, fields_json, fingerprint, pending_marker, pending_at, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      ON CONFLICT (feature_seq) DO UPDATE SET plugin = excluded.plugin, source_id = excluded.source_id, profile = excluded.profile,
        tracker_project = excluded.tracker_project, ticket_key = excluded.ticket_key, ticket_url = excluded.ticket_url,
        created_at = excluded.created_at, exported_at = excluded.exported_at, spec_json = excluded.spec_json, fields_json = excluded.fields_json,
        fingerprint = excluded.fingerprint, pending_marker = NULL, pending_at = NULL, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(Number(seq), plugin, sourceId, profile || null, trackerProject, key, url || null, createdAt || null, exportedAt || null,
      spec ? JSON.stringify(spec) : null, fields ? JSON.stringify(fields) : null, fingerprint || null, by, ts);
  return getExportLink(seq);
}

/** D10: a definite answer (a refusal, or no match found): a first export's row goes, a ticket's link loses only the marker. */
export function clearPendingExport(seq) {
  getDb();
  prepare('DELETE FROM req_export_links WHERE feature_seq = ? AND ticket_key IS NULL').run(Number(seq));
  prepare('UPDATE req_export_links SET pending_marker = NULL, pending_at = NULL WHERE feature_seq = ?').run(Number(seq));
}

/** Forget the link (D12): key, URL, the spec copy, the fingerprint and any pending marker. */
export function deleteExportLink(seq) {
  getDb();
  return Number(prepare('DELETE FROM req_export_links WHERE feature_seq = ?').run(Number(seq)).changes);
}
```

- [ ] **Step 8: Run and see it pass.** `node tools/test.mjs test/requirements-export-store.test.mjs` → pass. Then the files that list turn kinds or touch the store: `node tools/test.mjs test/requirements-store.test.mjs`, `node tools/test.mjs test/requirements-round.test.mjs`, `node tools/test.mjs test/requirements-ready.test.mjs` → pass (a failure there is compared with the same file in `<baseline>` before it is called pre-existing).

- [ ] **Step 9: Commit.**

```bash
git add src/core/db.mjs src/core/requirements/spec.mjs src/core/requirements/store.mjs test/db-migrate-v79.test.mjs test/requirements-export-store.test.mjs
git commit -m "Requirements: export setup and ticket link rows (schema v79)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The tool-neutral ticket, its Markdown, and the changes since the last export (pure)

**Files:**
- Modify: `src/core/requirements/markdown.mjs` (append `criterionLine` and `renderTicketMarkdown`; `renderSpecMarkdown` and `renderTaskMarkdown` unchanged)
- Create: `src/core/requirements/ticket.mjs`
- Create: `test/requirements-ticket.test.mjs`

**Interfaces:**
- Consumes: `bullets`, `numbered`, `from` (markdown.mjs internals); `changedSince` (ready.mjs).
- Produces (`markdown.mjs`):
  - `criterionLine(c) → string` — `"R-po-1 <text>"` plus A8's `" (from <name>)"`
  - `renderTicketMarkdown(f, { reason = null, exportedOn, criteriaInDescription = true, mentionedFiles = [] }) → string` (design D4, board 27's order; an empty section is left out; ends with `"From Worca FEAT-7 · exported <exportedOn>\n"`)
- Produces (`ticket.mjs`, no I/O):
  - `EXPORT_LIMITS = { labels: 10, label: 255 }`
  - `exportLabel(f) → 'worca-FEAT-7'`
  - `normalizeLabels(list, fixed = null) → string[]` (trimmed, each whitespace run → `-`, ≤ 255 characters, empties and duplicates dropped, ≤ 10 in all; `fixed` removed from the list and appended last)
  - `exportDate(iso, { year = true } = {}) → '26 Oct 2026' | '26 Oct'` and `exportTime(iso) → '26 Oct, 10:42'` (server-local time, English month abbreviations; `''` for no date)
  - `Ticket = { project, issueType, title, description, labels, priority, criteria: { target: 'description' } | { target: 'field', field, items: string[] } }` (no `marker`: `runExport` adds it)
  - `buildTicket(f, { project, issueType, labels = [], priority = null, criteria = { target: 'description' }, reason = null, exportedOn, mentionedFiles = [] }) → Ticket`
  - `Change` = `{ kind: 'criterion', id, change: 'added'|'edited'|'removed', before?, after? }` | `{ kind: 'goal', field: 'text'|'measure', before, after }` | `{ kind: 'section', section, pairs: [[old, new]], added: string[], removed: string[] }` | `{ kind: 'assumption', id, change: 'confirmed'|'unconfirmed', text }`
  - `exportChanges(before, after) → Change[]` (D8: criteria, then goal and measure, then the ticket's sections in its order, then assumptions entering or leaving `confirmed`; open questions ignored; `before` null counts everything as added)
  - `changeSummary(changes) → Array<{ line: string, id: string|null }>` (the again dialog's lines)
  - `renderExportComment(f, changes, { since, reason = null }) → string` (Markdown, design §4)
  - `ticketHash(value) → string` (sha256 hex of the canonical JSON: object keys sorted at every level)

- [ ] **Step 1: Write the failing test** `test/requirements-ticket.test.mjs`:

```js
// test/requirements-ticket.test.mjs — the tool-neutral ticket and the changes since the last export (plans/requirements-a6-design.md
// D4, D6, D8, §4). Pure: no store, no tracker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import { renderTicketMarkdown, criterionLine } from '../src/core/requirements/markdown.mjs';
import {
  EXPORT_LIMITS, exportLabel, normalizeLabels, exportDate, exportTime, buildTicket, exportChanges, changeSummary, renderExportComment, ticketHash,
} from '../src/core/requirements/ticket.mjs';

const CRITERIA = [
  { id: 'R-po-1', text: 'A customer can cancel a paid order that has not shipped.' },
  { id: 'R-po-2', text: 'Cancel is refused once the order has shipped, with the reason shown.' },
  { id: 'R-po-3', text: 'A packed order that has not been picked up can still be cancelled.' },
  { id: 'R-po-4', text: 'The customer sees a confirmation with what happens next.' },
  { id: 'R-po-5', text: 'Support sees who cancelled an order and when.' },
];
const SPEC = {
  ...emptySpec(),
  goal: { text: 'Customers cancel an order themselves until it leaves the warehouse.', measure: 'a third fewer “cancel my order” support calls.' },
  actors: ['Customer', 'Support agent'],
  flow: ['The customer opens the order in their order history.', 'They choose Cancel order and confirm.',
    'The order is cancelled, the payment is refunded and the customer sees what happens next.'],
  rules: ['A refund goes back the way the order was paid.', 'Packed but not picked up still counts as not shipped.'],
  edgeCases: ['The parcel is picked up while the customer confirms: cancel is refused with the reason.'],
  outOfScope: ['Returns after delivery.'],
  criteria: CRITERIA,
  assumptions: [
    { id: 'A-1', text: 'Orders paid on account (invoices) can be cancelled the same way.', status: 'confirmed' },
    { id: 'A-2', text: 'The refund is started at once; the payment provider decides when it arrives.', status: 'confirmed' },
    { id: 'A-3', text: 'Support can cancel on the customer\'s behalf.', status: 'confirmed' },
    { id: 'A-4', text: 'Business customers need no approval.', status: 'open' },
  ],
  openQuestions: ['Do business customers need approval before cancelling?'],
};
const F = { seq: 7, id: 'FEAT-7', title: 'Cancel an order before it ships', scopeType: 'project', scopeKey: 'shop-1', description: 'd', spec: SPEC };

// Board 27's description, byte for byte (the ticket shows confirmed assumptions only; open questions are not in it).
const BOARD_27 = [
  '## Goal', '', 'Customers cancel an order themselves until it leaves the warehouse.', '', 'Measure: a third fewer “cancel my order” support calls.', '',
  '## Actors', '', 'Customer · Support agent', '',
  '## Main flow', '', '1. The customer opens the order in their order history.', '2. They choose Cancel order and confirm.',
  '3. The order is cancelled, the payment is refunded and the customer sees what happens next.', '',
  '## Business rules', '', '- A refund goes back the way the order was paid.', '- Packed but not picked up still counts as not shipped.', '',
  '## Edge cases', '', '- The parcel is picked up while the customer confirms: cancel is refused with the reason.', '',
  '## Out of scope', '', '- Returns after delivery.', '',
  '## Acceptance criteria', '', ...CRITERIA.map((c) => `- ${c.id} ${c.text}`), '',
  '## Confirmed assumptions', '', '- A-1 Orders paid on account (invoices) can be cancelled the same way.',
  '- A-2 The refund is started at once; the payment provider decides when it arrives.', '- A-3 Support can cancel on the customer\'s behalf.', '',
  '## Files the spec mentions', '', '- support-tickets.pdf', '',
  'From Worca FEAT-7 · exported 26 Oct 2026', '',
].join('\n');

test("board 27: the ticket's description, in its order, with the footer", () => {
  assert.equal(renderTicketMarkdown(F, { exportedOn: '26 Oct 2026', mentionedFiles: ['support-tickets.pdf'] }), BOARD_27);
});

test('empty sections are left out; the reason leads; criteria to a field leave the description', () => {
  const bare = { ...F, spec: { ...emptySpec(), goal: { text: 'Cancel', measure: '' } } };
  assert.equal(renderTicketMarkdown(bare, { exportedOn: '26 Oct 2026' }), '## Goal\n\nCancel\n\nFrom Worca FEAT-7 · exported 26 Oct 2026\n');
  const why = renderTicketMarkdown(F, { exportedOn: '26 Oct 2026', reason: 'The team estimates in Jira tomorrow.' });
  assert.ok(why.startsWith('Exported before Ready: The team estimates in Jira tomorrow.\n\n## Goal\n\n'));
  const noCrit = renderTicketMarkdown(F, { exportedOn: '26 Oct 2026', criteriaInDescription: false });
  assert.doesNotMatch(noCrit, /## Acceptance criteria/);
  assert.match(noCrit, /## Confirmed assumptions/);
  assert.doesNotMatch(renderTicketMarkdown(F, { exportedOn: '26 Oct 2026' }), /_None yet\._|Open questions|Do business customers|A-4/);
});

test('A8 sources stay on criteria and assumptions: "(from <name>)"', () => {
  const s = { ...SPEC, criteria: [{ id: 'R-po-5', text: 'Support sees who cancelled an order and when.', source: 'support-tickets.pdf' }],
    assumptions: [{ id: 'A-1', text: 'Invoices too.', status: 'confirmed', source: 'mail.txt' }] };
  const md = renderTicketMarkdown({ ...F, spec: s }, { exportedOn: '26 Oct 2026' });
  assert.match(md, /\n- R-po-5 Support sees who cancelled an order and when\. \(from support-tickets\.pdf\)\n/);
  assert.match(md, /\n- A-1 Invoices too\. \(from mail\.txt\)\n/);
  assert.equal(criterionLine(s.criteria[0]), 'R-po-5 Support sees who cancelled an order and when. (from support-tickets.pdf)');
});

test('buildTicket: the neutral ticket; labels normalised with the fixed one; criteria in a field as items', () => {
  const t = buildTicket(F, { project: 'SHOP', issueType: '10001', labels: ['worca'], priority: null, exportedOn: '26 Oct 2026',
    mentionedFiles: ['support-tickets.pdf'] });
  assert.deepEqual(t, { project: 'SHOP', issueType: '10001', title: 'Cancel an order before it ships', description: BOARD_27,
    labels: ['worca', 'worca-FEAT-7'], priority: null, criteria: { target: 'description' } });
  const fld = buildTicket(F, { project: 'SHOP', issueType: '10001', labels: [], priority: '3', exportedOn: '26 Oct 2026',
    criteria: { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' } });
  assert.deepEqual(fld.criteria, { target: 'field', field: 'customfield_10070', items: CRITERIA.map((c) => `${c.id} ${c.text}`) });
  assert.doesNotMatch(fld.description, /## Acceptance criteria/);
  assert.deepEqual([fld.priority, fld.labels], ['3', ['worca-FEAT-7']]);
});

test('labels (D6): trimmed, spaces to "-", at most 255 characters, no duplicates or empties, at most 10 with the fixed one last', () => {
  assert.equal(exportLabel(F), 'worca-FEAT-7');
  const long = 'x'.repeat(300);
  assert.deepEqual(normalizeLabels(['  worca ', 'needs review', 'needs \t  review', 'worca', '', null, long, 'worca-FEAT-7'], 'worca-FEAT-7'),
    ['worca', 'needs-review', 'x'.repeat(EXPORT_LIMITS.label), 'worca-FEAT-7']);
  const many = Array.from({ length: 15 }, (_, i) => `l${i}`);
  const out = normalizeLabels(many, 'worca-FEAT-7');
  assert.equal(out.length, EXPORT_LIMITS.labels);
  assert.deepEqual([out[0], out[8], out[9]], ['l0', 'l8', 'worca-FEAT-7']);
  assert.deepEqual(normalizeLabels(many).length, 10, 'without a fixed label: ten');
  assert.deepEqual(normalizeLabels('nope'), []);
});

test('dates are the server\'s local date with English months, never the browser\'s locale', () => {
  const was = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Auckland';
    assert.equal(exportDate('2026-10-26T12:30:00.000Z'), '27 Oct 2026');
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(exportDate('2026-10-26T12:30:00.000Z'), '26 Oct 2026');
    assert.equal(exportDate('2026-10-26T12:30:00.000Z', { year: false }), '26 Oct');
    assert.equal(exportTime('2026-10-26T17:42:00.000Z'), '26 Oct, 10:42');
    assert.equal(exportDate(null), '');
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
});

// Board 28: R-po-6 added, one business rule reworded, one edge case added.
const BEFORE = { ...SPEC, rules: ['A refund goes back the way the order was paid.', 'Packed orders count as shipped.'] };
const AFTER = { ...SPEC, criteria: [...CRITERIA, { id: 'R-po-6', text: 'An order with some items shipped can cancel only the items not yet picked up.' }],
  edgeCases: [...SPEC.edgeCases, 'A partly shipped order cancels only the items not yet picked up.'] };

test('board 28: what changed since the last export, summarised and as the comment', () => {
  const changes = exportChanges(BEFORE, AFTER);
  assert.deepEqual(changeSummary(changes), [
    { line: 'Added R-po-6 An order with some items shipped can cancel only the items not yet picked up.', id: 'R-po-6' },
    { line: 'Business rules: 1 line changed', id: null },
    { line: 'Edge cases: 1 line added', id: null },
  ]);
  assert.equal(renderExportComment({ ...F, spec: AFTER }, changes, { since: '26 Oct' }), [
    'Updated in Worca since the last export (26 Oct)', '',
    'Added R-po-6 An order with some items shipped can cancel only the items not yet picked up.', '',
    'Business rules: “Packed but not picked up still counts as not shipped.” was “Packed orders count as shipped.”', '',
    'Edge cases: added “A partly shipped order cancels only the items not yet picked up.”', '',
    'From Worca FEAT-7', '',
  ].join('\n'));
  assert.match(renderExportComment({ ...F, spec: AFTER }, changes, { since: '26 Oct', reason: 'Estimating tomorrow.' }),
    /^Updated in Worca since the last export \(26 Oct\)\n\nExported before Ready: Estimating tomorrow\.\n\nAdded R-po-6/);
});

test('D8: assumptions count when they enter or leave confirmed; open questions are ignored; goal, measure, edits and removals', () => {
  const before = { ...SPEC, goal: { text: 'Old goal', measure: '' }, flow: ['a', 'b'],
    criteria: [{ id: 'R-po-1', text: 'old one' }, { id: 'R-po-3', text: 'gone one' }],
    assumptions: [{ id: 'A-2', text: 'Two', status: 'confirmed' }, { id: 'A-4', text: 'Four', status: 'open' }], openQuestions: ['q1'] };
  const after = { ...SPEC, goal: { text: 'New goal', measure: 'fewer calls' }, flow: [],
    criteria: [{ id: 'R-po-1', text: 'new one' }],
    assumptions: [{ id: 'A-2', text: 'Two', status: 'open' }, { id: 'A-4', text: 'Four', status: 'confirmed' }], openQuestions: ['q2', 'q3'] };
  const changes = exportChanges(before, after);
  assert.deepEqual(changeSummary(changes).map((x) => x.line), [
    'Changed R-po-1 new one', 'Removed R-po-3 gone one', 'Goal: 1 line changed', 'Measure: 1 line added', 'Main flow: 2 lines removed',
    'Confirmed A-4 Four', 'A-2 is no longer confirmed',
  ]);
  const md = renderExportComment({ ...F, spec: after }, changes, { since: '26 Oct' });
  for (const line of ['Changed R-po-1: “new one” was “old one”', 'Removed R-po-3 gone one', 'Goal: “New goal” was “Old goal”', 'Measure: added “fewer calls”',
    'Main flow: removed “a”', 'Main flow: removed “b”', 'Confirmed A-4 Four', 'A-2 is no longer confirmed']) assert.ok(md.includes(`\n\n${line}\n\n`), line);
  assert.deepEqual(exportChanges(SPEC, { ...SPEC, openQuestions: [] }), [], 'open questions are not in the ticket');
  assert.equal(exportChanges(null, SPEC).filter((c) => c.kind === 'criterion').length, 5, 'no earlier spec: everything is added');
});

test('ticketHash: canonical (key order never matters), 64 hex, and any value change changes it', () => {
  const a = ticketHash({ mode: 'create', ticket: { b: [1, { d: 3, c: 2 }], a: 'x' } });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, ticketHash({ ticket: { a: 'x', b: [1, { c: 2, d: 3 }] }, mode: 'create' }));
  assert.notEqual(a, ticketHash({ mode: 'create', ticket: { a: 'y', b: [1, { c: 2, d: 3 }] } }));
});
```

- [ ] **Step 2: Run it and see it fail.** `node tools/test.mjs test/requirements-ticket.test.mjs` → FAIL: `renderTicketMarkdown` is not exported / cannot find `ticket.mjs`.

- [ ] **Step 3: Implement the Markdown.** Append to `src/core/requirements/markdown.mjs`:

```js
/** A criterion as one ticket line (A6 D4): "R-po-1 <text>", with A8's "(from <name>)". */
export const criterionLine = (c) => `${c.id} ${c.text}${from(c)}`;

/**
 * The ticket's description (plans/requirements-a6-design.md D4), board 27's order: Goal (text, then "Measure: …"), Actors
 * (" · "), Main flow, Business rules, Edge cases, Out of scope, Acceptance criteria (only when they go to the description),
 * Confirmed assumptions, Files the spec mentions (names only), then the footer. An empty section is left out (the export's
 * "_None yet._" is never sent); open questions, open and rejected assumptions and the first description are not in it. An
 * Export anyway reason leads.
 */
export function renderTicketMarkdown(f, { reason = null, exportedOn, criteriaInDescription = true, mentionedFiles = [] } = {}) {
  const s = f.spec;
  const out = [];
  const section = (title, body) => { if (body) out.push(`## ${title}`, body); };
  if (reason) out.push(`Exported before Ready: ${reason}`);
  section('Goal', [s.goal.text, s.goal.measure ? `Measure: ${s.goal.measure}` : ''].filter(Boolean).join('\n\n'));
  section('Actors', s.actors.join(' · '));
  section('Main flow', s.flow.length ? numbered(s.flow) : '');
  section('Business rules', s.rules.length ? bullets(s.rules) : '');
  section('Edge cases', s.edgeCases.length ? bullets(s.edgeCases) : '');
  section('Out of scope', s.outOfScope.length ? bullets(s.outOfScope) : '');
  if (criteriaInDescription) section('Acceptance criteria', s.criteria.length ? bullets(s.criteria.map(criterionLine)) : '');
  const confirmed = s.assumptions.filter((a) => a.status === 'confirmed');
  section('Confirmed assumptions', confirmed.length ? bullets(confirmed.map((a) => `${a.id} ${a.text}${from(a)}`)) : '');
  section('Files the spec mentions', mentionedFiles.length ? bullets(mentionedFiles) : '');
  out.push(`From Worca ${f.id} · exported ${exportedOn}`);
  return `${out.join('\n\n')}\n`;
}
```

- [ ] **Step 4: Implement the ticket module.** Create `src/core/requirements/ticket.mjs`:

```js
// src/core/requirements/ticket.mjs
// The tool-neutral ticket (plans/requirements-a6-design.md D4, D6, D8, §4): what Worca sends a tracker, built from the spec;
// each tracker plugin maps it to its own format. The changes since the last export, the comment that lists them, and the
// preview hash. Pure: no I/O; dates are the server's local time with English month abbreviations.
import { createHash } from 'node:crypto';
import { changedSince } from './ready.mjs';
import { renderTicketMarkdown, criterionLine } from './markdown.mjs';

export const EXPORT_LIMITS = Object.freeze({ labels: 10, label: 255 });
/** The ticket's sections in board 27's order, with their names (the again dialog and the comment use them too). */
const TICKET_SECTIONS = Object.freeze([['actors', 'Actors'], ['flow', 'Main flow'], ['rules', 'Business rules'], ['edgeCases', 'Edge cases'],
  ['outOfScope', 'Out of scope']]);
const SECTION_NAME = Object.fromEntries(TICKET_SECTIONS);
const MON = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

/** The label Worca always adds and never lets go (D6, D10): how it finds the ticket again. */
export const exportLabel = (f) => `worca-${f.id}`;

/** D6: labels as the preview shows and the tracker receives them. */
export function normalizeLabels(list, fixed = null) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'string') continue;
    const l = raw.trim().replace(/\s+/g, '-').slice(0, EXPORT_LIMITS.label);
    if (!l || l === fixed || out.includes(l)) continue;
    out.push(l);
  }
  const room = fixed ? EXPORT_LIMITS.labels - 1 : EXPORT_LIMITS.labels;
  return [...out.slice(0, room), ...(fixed ? [fixed] : [])];
}

/** "26 Oct 2026" (or "26 Oct"), the server's local date (D8); '' without a date. */
export function exportDate(iso, { year = true } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MON[d.getMonth()]}${year ? ` ${d.getFullYear()}` : ''}`;
}

/** "26 Oct, 10:42" for the History card (D17). */
export function exportTime(iso) {
  const day = exportDate(iso, { year: false });
  if (!day) return '';
  const d = new Date(iso);
  return `${day}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The neutral ticket (D4, §4). `criteria` is the setup's target; with a field the description leaves its criteria out. */
export function buildTicket(f, { project, issueType, labels = [], priority = null, criteria = { target: 'description' }, reason = null, exportedOn,
  mentionedFiles = [] } = {}) {
  const toField = !!(criteria && criteria.target === 'field' && criteria.field);
  return {
    project, issueType, title: f.title,
    description: renderTicketMarkdown(f, { reason, exportedOn, criteriaInDescription: !toField, mentionedFiles }),
    labels: normalizeLabels(labels, exportLabel(f)),
    priority: priority || null,
    criteria: toField ? { target: 'field', field: criteria.field, items: f.spec.criteria.map(criterionLine) } : { target: 'description' },
  };
}

const confirmedOf = (spec) => ((spec && spec.assumptions) || []).filter((a) => a && a.status === 'confirmed');

/** D8: what changed since the last export, reduced to what a ticket shows. Criteria first, then the goal and its measure,
 *  then the sections in the ticket's order (a section's changed lines are its removed and added lines paired in order),
 *  then the assumptions that entered or left `confirmed`. Open questions are not in a ticket and never count. */
export function exportChanges(before, after) {
  const strip = (s) => ({ ...(s || {}), openQuestions: [], assumptions: [] });
  const raw = changedSince(strip(before), strip(after));
  const out = raw.filter((c) => c.kind === 'criterion');
  out.push(...raw.filter((c) => c.kind === 'goal'));
  for (const [section] of TICKET_SECTIONS) {
    const c = raw.find((x) => x.kind === 'section' && x.section === section);
    if (!c) continue;
    const n = Math.min(c.added.length, c.removed.length);
    out.push({ kind: 'section', section, pairs: c.removed.slice(0, n).map((old, i) => [old, c.added[i]]), added: c.added.slice(n), removed: c.removed.slice(n) });
  }
  const was = new Map(confirmedOf(before).map((a) => [a.id, a]));
  const now = new Map(confirmedOf(after).map((a) => [a.id, a]));
  for (const [id, a] of now) if (!was.has(id)) out.push({ kind: 'assumption', id, change: 'confirmed', text: a.text });
  for (const [id, a] of was) if (!now.has(id)) out.push({ kind: 'assumption', id, change: 'unconfirmed', text: a.text });
  return out;
}

const lines = (n) => `${n} line${n === 1 ? '' : 's'}`;
const goalName = (field) => (field === 'measure' ? 'Measure' : 'Goal');

/** The again dialog's lines (board 28): one per criterion and assumption, one per goal field and section. */
export function changeSummary(changes) {
  const out = [];
  for (const c of changes || []) {
    if (c.kind === 'criterion') {
      const text = c.change === 'removed' ? c.before : c.after;
      out.push({ line: `${{ added: 'Added', edited: 'Changed', removed: 'Removed' }[c.change]} ${c.id} ${text}`, id: c.id });
    } else if (c.kind === 'goal') {
      const what = !c.before ? 'added' : !c.after ? 'removed' : 'changed';
      out.push({ line: `${goalName(c.field)}: 1 line ${what}`, id: null });
    } else if (c.kind === 'section') {
      const parts = [];
      if (c.pairs.length) parts.push(`${lines(c.pairs.length)} changed`);
      if (c.added.length) parts.push(`${lines(c.added.length)} added`);
      if (c.removed.length) parts.push(`${lines(c.removed.length)} removed`);
      out.push({ line: `${SECTION_NAME[c.section]}: ${parts.join(', ')}`, id: null });
    } else if (c.kind === 'assumption') {
      out.push(c.change === 'confirmed' ? { line: `Confirmed ${c.id} ${c.text}`, id: c.id } : { line: `${c.id} is no longer confirmed`, id: c.id });
    }
  }
  return out;
}

/** The comment of Add a comment (design §4, board 28): the head, an Export anyway reason, one paragraph per change, the footer. */
export function renderExportComment(f, changes, { since, reason = null } = {}) {
  const out = [`Updated in Worca since the last export (${since})`];
  if (reason) out.push(`Exported before Ready: ${reason}`);
  for (const c of changes || []) {
    if (c.kind === 'criterion') {
      if (c.change === 'added') out.push(`Added ${c.id} ${c.after}`);
      else if (c.change === 'edited') out.push(`Changed ${c.id}: “${c.after}” was “${c.before}”`);
      else out.push(`Removed ${c.id} ${c.before}`);
    } else if (c.kind === 'goal') {
      const name = goalName(c.field);
      if (!c.before) out.push(`${name}: added “${c.after}”`);
      else if (!c.after) out.push(`${name}: removed “${c.before}”`);
      else out.push(`${name}: “${c.after}” was “${c.before}”`);
    } else if (c.kind === 'section') {
      const name = SECTION_NAME[c.section];
      for (const [old, now] of c.pairs) out.push(`${name}: “${now}” was “${old}”`);
      for (const l of c.added) out.push(`${name}: added “${l}”`);
      for (const l of c.removed) out.push(`${name}: removed “${l}”`);
    } else if (c.kind === 'assumption') {
      out.push(c.change === 'confirmed' ? `Confirmed ${c.id} ${c.text}` : `${c.id} is no longer confirmed`);
    }
  }
  out.push(`From Worca ${f.id}`);
  return `${out.join('\n\n')}\n`;
}

const canonical = (v) => (Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);

/** D6: the preview's hash, of the canonical JSON of exactly what will be sent. */
export const ticketHash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
```

- [ ] **Step 5: Run and see it pass.** `node tools/test.mjs test/requirements-ticket.test.mjs` → pass. Then `node tools/test.mjs test/requirements-markdown-save.test.mjs` → pass (the spec export is unchanged).

- [ ] **Step 6: Commit.**

```bash
git add src/core/requirements/markdown.mjs src/core/requirements/ticket.mjs test/requirements-ticket.test.mjs
git commit -m "Requirements: the tool-neutral ticket and what changed since the last export" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: The shared contract — optional export ops, the capability probe, the mock answers

**Files:**
- Modify: `src/core/plugin-shim.mjs` (imports; `setMockSourceResponses`; `MOCK_DEFAULTS`)
- Modify: `src/core/plugin-api.mjs` (the comment above `WORCA_PLUGIN_API`)
- Modify: `.claude/skills/creating-worca-cc-plugins/SKILL.md` (the "Connector contract" table)
- Create: `src/core/requirements/export.mjs` (the discovery part; Task 5 adds the rest)
- Create: `test/requirements-export-trackers.test.mjs`
- Modify: `test/plugin-shim.test.mjs` (the WORCA_MOCK test; a new mock-answers test), `test/writeback.test.mjs` (the first test keeps the missing-op default explicit)

**Interfaces:**
- Consumes: `callSource`, `setMockSourceResponses`, `PluginOpError` (plugin-shim.mjs); `listTaskSources` (sources.mjs; each plugin entry `{ type: 'plugin', plugin, sourceId, displayName, multiProfile, profiles: [{ id, label }] }`); `readPluginsLock` (plugins-lock.mjs); `resolveProfile`, `listBindingsForScope` (source-bindings.mjs).
- Produces (the contract, design §4): optional connector ops, each one args object, each answering within `EXPORT_TIMEOUT_MS`:
  - `capabilities({ inputs })` → adds `export: true` when the source can export
  - `exportOptions({ project?, issueType? })` → `{ projects: [{ value, label }], issueTypes?: [...], priorities?: [...], criteriaFields?: [...], doneStatus: string|null, tooOld?: true }` (`issueTypes` with a project; `priorities` and `criteriaFields` with both; `tooOld` when the tracker cannot list create metadata)
  - `createTicket({ ticket })` (the Task 2 `Ticket` plus `marker`) → `{ key, url, fingerprint }` | `{ refused: { field, message } }`
  - `updateTicket({ key, ticket })` (no `marker`) → `{ key, url, fingerprint }` | `{ gone: true }` | `{ refused: { field, message } }`
  - `commentTicket({ key, body })` (Markdown) → `{ ok: true }` | `{ gone: true }`
  - `ticketState({ key })` → `{ exists: true, url, fingerprint }` | `{ exists: false }`
  - `findTicket({ project, label, marker })` → `{ key, url, fingerprint, lastLine, marker, labels }` | `null`
  - Auth, network, rate-limit, timeout and protocol failures are thrown as today (`PluginOpError`).
- Produces (`plugin-shim.mjs`, mock mode): `MOCK_DEFAULTS` answer the ops above (design §4 "Mock answers"); `capabilities` answers `{ writeBack: true, export: true }`; `setMockSourceResponses(null)` also restarts the mock ticket numbers at 123.
- Produces (`export.mjs`):
  - `EXPORT_TIMEOUT_MS = 60_000`
  - `Tracker = { plugin, sourceId, name, multiProfile: boolean, profiles: Array<{ id: string|null, label: string }> }` (a single-profile source has one entry `{ id: null, label: <displayName> }`)
  - `PROBE_TIMEOUT_MS = 10_000`, `PROBE_RETRY_MS = 60_000` (D3, user decision 2026-10-26)
  - `exportTrackers(d = {}) → Promise<Tracker[]>` (never throws; every source probed at once, each within `PROBE_TIMEOUT_MS`; a "yes" or an `unimplemented` is cached per plugin, source id and installed version; a failed probe is remembered for `PROBE_RETRY_MS` per plugin, source id and profile, and the source counts as unable to export meanwhile; `d.callSource` replaces the shim in tests, `d.now()` the clock)
  - `defaultConnection({ scopeType, scopeKey }, trackers, { memberKeys = [] } = {}) → Conn|null`
  - `reachReason(err) → string`, `reachSentence(name, err) → 'Worca could not reach <name>: <reason>.'`
  - `_resetExportCaches()` (tests)

- [ ] **Step 1: Write the failing tests.** In `test/plugin-shim.test.mjs`, in the test `'WORCA_MOCK=1 short-circuits without spawning (plugin need not exist)'`, replace the two lines

```js
    // …and an op with NO canned response mirrors the real child's kind
    // 'unimplemented' (the capabilities tolerant-default keys on it).
    await rejectsKind(callSource({ plugin: 'x', sourceId: 'x', op: 'capabilities' }), 'unimplemented');
```

with

```js
    // …and an op with NO canned response mirrors the real child's kind
    // 'unimplemented' (the capabilities tolerant-default keys on it).
    await rejectsKind(callSource({ plugin: 'x', sourceId: 'x', op: 'noSuchOp' }), 'unimplemented');
    // A6: capabilities has a canned answer now: write-back stays on, and the mock source can export.
    assert.deepEqual(await callSource({ plugin: 'x', sourceId: 'x', op: 'capabilities', args: { inputs: {} } }), { writeBack: true, export: true });
    // A map entry set to undefined still means "no canned response" (writeback.test.mjs keeps the missing-op default that way).
    setMockSourceResponses({ capabilities: undefined });
    await rejectsKind(callSource({ plugin: 'x', sourceId: 'x', op: 'capabilities' }), 'unimplemented');
```

  and add after that test:

```js
test('WORCA_MOCK=1: the export ops answer (A6 design §4): options, tickets numbered from 123, state follows the last write', async () => {
  process.env.WORCA_MOCK = '1';
  const call = (op, args) => callSource({ plugin: 'not-installed', sourceId: 'x', op, args });
  try {
    setMockSourceResponses(null);
    const o = await call('exportOptions', {});
    assert.deepEqual(o, { projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }], doneStatus: 'Done' });
    assert.deepEqual((await call('exportOptions', { project: 'SHOP' })).issueTypes.map((t) => t.label), ['Story', 'Task', 'Bug']);
    const both = await call('exportOptions', { project: 'SHOP', issueType: '10001' });
    assert.deepEqual(both.priorities.map((p) => p.label), ['Highest', 'High', 'Medium', 'Low']);
    assert.deepEqual(both.criteriaFields, [{ value: 'customfield_10070', label: 'Acceptance Criteria' }, { value: 'customfield_10071', label: 'Definition of Done' }]);
    const made = await call('createTicket', { ticket: { project: 'SHOP', description: 'd1' } });
    assert.deepEqual([made.key, made.url], ['SHOP-123', 'https://mock.test/browse/SHOP-123']);
    assert.match(made.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal((await call('createTicket', { ticket: { project: 'OPS', description: 'd2' } })).key, 'OPS-124');
    assert.deepEqual(await call('ticketState', { key: 'SHOP-123' }), { exists: true, url: 'https://mock.test/browse/SHOP-123', fingerprint: made.fingerprint });
    const upd = await call('updateTicket', { key: 'SHOP-123', ticket: { description: 'd3' } });
    assert.equal(upd.key, 'SHOP-123');
    assert.notEqual(upd.fingerprint, made.fingerprint);
    assert.equal((await call('ticketState', { key: 'SHOP-123' })).fingerprint, upd.fingerprint);
    assert.deepEqual(await call('commentTicket', { key: 'SHOP-123', body: 'c' }), { ok: true });
    assert.equal(await call('findTicket', { project: 'SHOP', label: 'worca-FEAT-1', marker: 'rexp_000000000000' }), null);
    setMockSourceResponses({ ticketState: { exists: false } });   // a test override wins
    assert.deepEqual(await call('ticketState', { key: 'SHOP-123' }), { exists: false });
    setMockSourceResponses(null);
    assert.equal((await call('createTicket', { ticket: { project: 'SHOP', description: 'x' } })).key, 'SHOP-123', 'a reset starts again at 123');
  } finally {
    delete process.env.WORCA_MOCK;
    setMockSourceResponses(null);
  }
});
```

  In `test/writeback.test.mjs`, in the first test (`'done plugin pipeline reports completed with a diffstat summary (capabilities op absent => default writeBack)'`) replace

```js
  setMockSourceResponses({ reportResult: (args) => { calls.push(args); return { ok: true }; } });
```

  (its first line only) with

```js
  // capabilities: undefined = no canned answer, so the op is absent and the tolerant default (writeBack true) is what runs
  setMockSourceResponses({ capabilities: undefined, reportResult: (args) => { calls.push(args); return { ok: true }; } });
```

  and replace the file's header comment lines 2–3 with:

```js
// The first test sets no capabilities answer, so it exercises the tolerant-default: PluginOpError kind 'unimplemented' =>
// writeBack:true. The mock registry's own capabilities answer (A6) keeps writeBack true, so the others behave the same.
```

  Create `test/requirements-export-trackers.test.mjs`:

```js
// test/requirements-export-trackers.test.mjs — which task sources can export (plans/requirements-a6-design.md D1–D3, D11):
// enabled plugin sources with a connection whose capabilities() say export; the answer cached per plugin, source and
// installed version; every source probed at once within 10 s; a failed probe remembered for a minute (user decision
// 2026-10-26); the default connection; the reach sentences.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { createProfile } from '../src/core/plugin-config.mjs';
import { readPluginsLock, writePluginsLock } from '../src/core/plugins-lock.mjs';
import { setBinding } from '../src/core/source-bindings.mjs';
import { PluginOpError } from '../src/core/plugin-shim.mjs';
import {
  EXPORT_TIMEOUT_MS, PROBE_TIMEOUT_MS, PROBE_RETRY_MS, exportTrackers, defaultConnection, reachReason, reachSentence, _resetExportCaches,
} from '../src/core/requirements/export.mjs';

useTempHome(after, 'worca-req-export-trackers-');
const JIRA_DIR = fileURLToPath(new URL('../plugins/jira-source', import.meta.url));
const MOCK_DIR = fileURLToPath(new URL('./fixtures/plugins/mock-source', import.meta.url));

/** A fake callSource answering capabilities per plugin; records every call. */
function fakeCall(answers) {
  const calls = [];
  const fn = async (o) => {
    calls.push(o);
    const a = answers[o.plugin];
    if (typeof a === 'function') return a(o);
    if (a instanceof Error) throw a;
    return a;
  };
  fn.calls = calls;
  return fn;
}

before(async () => {
  await linkPlugin('jira-source', JIRA_DIR);
  await linkPlugin('mock-source', MOCK_DIR);
});

test('no profile yet: a multi-profile source is no tracker (and is not even asked)', async () => {
  _resetExportCaches();
  const callSource = fakeCall({ 'jira-source': { writeBack: false, export: true }, 'mock-source': { writeBack: true } });
  assert.deepEqual(await exportTrackers({ callSource }), []);
  assert.deepEqual(callSource.calls.map((c) => c.plugin), ['mock-source']);
  assert.deepEqual(callSource.calls[0].args, { inputs: {} });
});

test('a source is a tracker when capabilities say export; probed with its first profile; the answer is cached', async () => {
  createProfile('jira-source', 'acme', 'acme.atlassian.net (Cloud)');
  createProfile('jira-source', 'beta', 'jira.beta.test (Data Center)');
  _resetExportCaches();
  const callSource = fakeCall({ 'jira-source': { writeBack: false, export: true }, 'mock-source': { writeBack: true } });
  const t = await exportTrackers({ callSource });
  assert.deepEqual(t, [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira', multiProfile: true,
    profiles: [{ id: 'acme', label: 'acme.atlassian.net (Cloud)' }, { id: 'beta', label: 'jira.beta.test (Data Center)' }] }]);
  assert.deepEqual(callSource.calls.map((c) => [c.plugin, c.op, c.profile, c.timeoutMs]),
    [['jira-source', 'capabilities', 'acme', PROBE_TIMEOUT_MS], ['mock-source', 'capabilities', undefined, PROBE_TIMEOUT_MS]]);
  await exportTrackers({ callSource });
  assert.equal(callSource.calls.length, 2, 'cached for the process');
});

test('every source is probed at once, each within 10 s: a slow connector does not hold the others up (D3)', async () => {
  _resetExportCaches();
  assert.deepEqual([PROBE_TIMEOUT_MS, PROBE_RETRY_MS], [10_000, 60_000]);
  let release;
  const gate = new Promise((r) => { release = r; });
  const callSource = fakeCall({ 'jira-source': async () => { await gate; return { export: true }; }, 'mock-source': { writeBack: true } });
  const pending = exportTrackers({ callSource });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(callSource.calls.map((c) => c.plugin), ['jira-source', 'mock-source'], 'both asked before the first answered');
  release();
  assert.deepEqual((await pending).map((x) => x.plugin), ['jira-source'], "listTaskSources' order is kept");
});

test('the cache is per installed version: a new version is asked again', async () => {
  _resetExportCaches();
  const callSource = fakeCall({ 'jira-source': { export: true }, 'mock-source': { writeBack: true } });
  await exportTrackers({ callSource });
  const lock = readPluginsLock();
  writePluginsLock({ ...lock, 'jira-source': { ...lock['jira-source'], version: '9.9.9' } });
  await exportTrackers({ callSource });
  assert.deepEqual(callSource.calls.filter((c) => c.plugin === 'jira-source').length, 2);
  writePluginsLock(lock);
});

test('a missing op means no export (cached); a failed probe is remembered for a minute, then asked again; any other answer is no', async () => {
  _resetExportCaches();
  let clock = 1_000_000;
  let jira = new PluginOpError('network', 'Jira unreachable: fetch failed');
  const callSource = fakeCall({ 'jira-source': () => { if (jira instanceof Error) throw jira; return jira; },
    'mock-source': new PluginOpError('unimplemented', 'connector does not implement op "capabilities"') });
  const d = { callSource, now: () => clock };
  const asked = () => callSource.calls.filter((c) => c.plugin === 'jira-source').length;
  assert.deepEqual(await exportTrackers(d), []);
  jira = { export: true };
  clock += 30_000;
  assert.deepEqual(await exportTrackers(d), [], 'within the minute the failure stands: no export for that connection');
  assert.equal(asked(), 1, 'and the source is not asked again');
  jira = { writeBack: true, export: 'yes' };
  clock += 31_000;
  assert.deepEqual(await exportTrackers(d), [], 'export must be true, not truthy');
  assert.equal(asked(), 2, 'asked again once the minute is over');
  jira = { export: true };
  clock += 61_000;
  assert.deepEqual(await exportTrackers(d), [], 'the "no" above was cached');
  _resetExportCaches();
  assert.deepEqual((await exportTrackers(d)).map((x) => x.plugin), ['jira-source']);
  assert.equal(callSource.calls.filter((c) => c.plugin === 'mock-source').length, 2, 'unimplemented was cached until the reset');
});

test('a single-profile source that can export is one connection named after it; a disabled plugin is left out', async () => {
  _resetExportCaches();
  const callSource = fakeCall({ 'jira-source': { export: true }, 'mock-source': { writeBack: true, export: true } });
  const t = await exportTrackers({ callSource });
  assert.deepEqual(t.map((x) => [x.plugin, x.name, x.multiProfile, x.profiles]), [
    ['jira-source', 'Jira', true, [{ id: 'acme', label: 'acme.atlassian.net (Cloud)' }, { id: 'beta', label: 'jira.beta.test (Data Center)' }]],
    ['mock-source', 'Mock Tasks', false, [{ id: null, label: 'Mock Tasks' }]],
  ]);
  const lock = readPluginsLock();
  writePluginsLock({ ...lock, 'mock-source': { ...lock['mock-source'], enabled: false } });
  assert.deepEqual((await exportTrackers({ callSource })).map((x) => x.plugin), ['jira-source']);
  writePluginsLock(lock);
});

test('defaultConnection (D2): the scope\'s bound profile, else the first tracker\'s first profile', () => {
  const trackers = [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira', multiProfile: true, profiles: [{ id: 'acme', label: 'a' }, { id: 'beta', label: 'b' }] },
    { plugin: 'mock-source', sourceId: 'mock', name: 'Mock Tasks', multiProfile: false, profiles: [{ id: null, label: 'Mock Tasks' }] }];
  const scope = { scopeType: 'project', scopeKey: 'shop-1' };
  assert.deepEqual(defaultConnection(scope, trackers), { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' });
  setBinding({ scopeType: 'project', scopeKey: 'shop-1', plugin: 'jira-source', sourceId: 'jira' }, 'beta');
  assert.deepEqual(defaultConnection(scope, trackers), { plugin: 'jira-source', sourceId: 'jira', profile: 'beta' });
  assert.deepEqual(defaultConnection({ scopeType: 'project', scopeKey: 'other' }, trackers.slice(1)), { plugin: 'mock-source', sourceId: 'mock', profile: null });
  assert.equal(defaultConnection(scope, []), null);
});

test('reach sentences (D11): the token, a minute, else the plugin\'s own words without the final period', () => {
  assert.equal(EXPORT_TIMEOUT_MS, 60_000);
  assert.equal(reachReason(new PluginOpError('auth', 'Jira token invalid or expired')), 'the API token was refused');
  assert.equal(reachReason(new PluginOpError('timeout', 'plugin "jira-source" op "createTicket" exceeded 60000ms (child killed)')), 'it did not answer within a minute');
  assert.equal(reachReason(new PluginOpError('network', 'Jira unreachable: fetch failed.')), 'Jira unreachable: fetch failed');
  assert.equal(reachSentence('Jira', new PluginOpError('auth', 'x')), 'Worca could not reach Jira: the API token was refused.');
});
```

- [ ] **Step 2: Run them and see them fail.** `node tools/test.mjs test/plugin-shim.test.mjs` → FAIL (the mock `capabilities` is unimplemented; `exportOptions` has no canned answer). `node tools/test.mjs test/requirements-export-trackers.test.mjs` → FAIL: cannot find `export.mjs`. `node tools/test.mjs test/writeback.test.mjs` → pass (it does not depend on the change yet).

- [ ] **Step 3: The mock answers.** In `src/core/plugin-shim.mjs`:
  - add `import { createHash } from 'node:crypto';` after `import { spawn } from 'node:child_process';`
  - replace `setMockSourceResponses` with:

```js
/** Tests: override/extend the canned per-op responses. Pass null to reset (A6: the mock ticket numbers restart at 123). */
export function setMockSourceResponses(map) {
  _mockResponses = map && typeof map === 'object' ? map : null;
  if (!_mockResponses) resetMockTickets();
}
```

  - replace `const MOCK_DEFAULTS = {` … `};` with:

```js
// A6 (plans/requirements-a6-design.md §4, D19): the export ops' canned answers, so the Requirements browser proof runs
// offline. Tickets are numbered <project>-123, -124, … in one sequence; the fingerprint is the description's sha256 and
// ticketState returns the last one written.
let mockTicketNo = 123;
const mockFingerprints = new Map();
function resetMockTickets() { mockTicketNo = 123; mockFingerprints.clear(); }
const mockFingerprint = (text) => createHash('sha256').update(String(text ?? '')).digest('hex');
const mockUrl = (key) => `https://mock.test/browse/${key}`;
const MOCK_DEFAULTS = {
  listTasks: () => ({ tasks: MOCK_TASKS.map((t) => ({ ...t })) }),
  getTask: (args) => ({
    ...MOCK_TASKS[0],
    id: args?.id || MOCK_TASKS[0].id,
    body: 'Mock task body.\n\n1. reproduce\n2. fix\n3. verify',
    meta: { mock: true },
  }),
  reportResult: () => ({ ok: true }),
  validateConfig: () => ({ ok: true }),
  // Write-back stays on (what a missing capabilities op defaulted to before A6), and the mock source can export.
  capabilities: () => ({ writeBack: true, export: true }),
  exportOptions: (args = {}) => ({
    projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }],
    ...(args.project ? { issueTypes: [{ value: '10001', label: 'Story' }, { value: '10002', label: 'Task' }, { value: '10003', label: 'Bug' }] } : {}),
    ...(args.project && args.issueType ? {
      priorities: [{ value: '1', label: 'Highest' }, { value: '2', label: 'High' }, { value: '3', label: 'Medium' }, { value: '4', label: 'Low' }],
      criteriaFields: [{ value: 'customfield_10070', label: 'Acceptance Criteria' }, { value: 'customfield_10071', label: 'Definition of Done' }],
    } : {}),
    doneStatus: 'Done',
  }),
  createTicket: (args = {}) => {
    const t = args.ticket || {};
    const key = `${t.project || 'MOCK'}-${mockTicketNo++}`;
    mockFingerprints.set(key, mockFingerprint(t.description));
    return { key, url: mockUrl(key), fingerprint: mockFingerprints.get(key) };
  },
  updateTicket: (args = {}) => {
    mockFingerprints.set(args.key, mockFingerprint(args.ticket && args.ticket.description));
    return { key: args.key, url: mockUrl(args.key), fingerprint: mockFingerprints.get(args.key) };
  },
  commentTicket: () => ({ ok: true }),
  ticketState: (args = {}) => ({ exists: true, url: mockUrl(args.key), fingerprint: mockFingerprints.get(args.key) ?? null }),
  findTicket: () => null,
};
```

  `mockCall` stays as it is: `op in _mockResponses ? _mockResponses[op] : MOCK_DEFAULTS[op]` already treats `{ capabilities: undefined }` as "no canned response".

- [ ] **Step 4: The contract's comment and doc.** In `src/core/plugin-api.mjs`, after the line `// block (MCP registry) is honoured; nothing else changes.` add:

```js
// Requirements A6 adds optional task-source connector ops (capabilities().export, exportOptions, createTicket,
// updateTicket, commentTicket, ticketState, findTicket). They are additive: a connector without them answers
// 'unimplemented' and simply cannot export, so the API stays 5.
```

  In `.claude/skills/creating-worca-cc-plugins/SKILL.md`, replace the row

```markdown
| `capabilities` | `({inputs})` — optional | `{writeBack, incrementalSync}`; missing → `writeBack: true` |
```

  with

```markdown
| `capabilities` | `({inputs})` — optional | `{writeBack, incrementalSync, export?}`; missing → `writeBack: true`; `export: true` turns on the export ops below |
| `exportOptions` | `({project?, issueType?})` — optional, export | `{projects:[{value,label}], issueTypes?, priorities?, criteriaFields?, doneStatus, tooOld?}` — `issueTypes` with a project, the last two with both |
| `createTicket` | `({ticket})` — optional, export | `{key, url, fingerprint}` \| `{refused:{field, message}}` |
| `updateTicket` | `({key, ticket})` — optional, export | `{key, url, fingerprint}` \| `{gone:true}` \| `{refused}` |
| `commentTicket` | `({key, body})` — optional, export | `{ok:true}` \| `{gone:true}` |
| `ticketState` | `({key})` — optional, export | `{exists:true, url, fingerprint}` \| `{exists:false}` |
| `findTicket` | `({project, label, marker})` — optional, export | `{key, url, fingerprint, lastLine, marker, labels}` \| `null` |
```

  and add after the table's last row (`| custom | … |`) and before the `ctx = …` paragraph:

```markdown
The export ops (Requirements' **Export to a tracker**) receive a tool-neutral ticket: `{project, issueType, title, description
(Markdown), labels (already normalised, never with spaces), priority (id or null), criteria: {target:'description'} |
{target:'field', field, items}, marker?}`. Write the description in your tracker's format, store `marker` invisibly on a
create (Worca finds a ticket whose create answer was lost by it), add labels on an update without removing any, and return
`fingerprint`: a hash of the description as your tracker stores it (read it back), normalised so the same stored text
always gives the same string. Worca compares fingerprints only. A field the tracker refuses and a ticket that is gone are
results (`refused`, `gone`), not throws; every call runs in the host, never from the browser, with a 60 s limit. The
reference implementation is `plugins/jira-source`.
```

- [ ] **Step 5: The discovery part of the service.** Create `src/core/requirements/export.mjs`:

```js
// src/core/requirements/export.mjs
// Export to a tracker (plans/requirements-a6-design.md): a feature's spec becomes a ticket in the team's tracker through the
// task-source contract's optional export ops (D3), never a tracker's own API. This module knows only "a source that can
// export"; each plugin maps the tool-neutral ticket (ticket.mjs) to its own format. Every call runs here, server-side,
// through callSource (D18): the browser never drives one, and no config value leaves the plugin.
import { callSource as shimCallSource } from '../plugin-shim.mjs';
import { listTaskSources } from '../sources.mjs';
import { readPluginsLock } from '../plugins-lock.mjs';
import { resolveProfile, listBindingsForScope } from '../source-bindings.mjs';

/** Every export op's time limit (D14): a create makes up to three tracker calls; exportOptions pages through projects. */
export const EXPORT_TIMEOUT_MS = 60_000;

/** A capability probe's time limit (D3): it runs inside every feature view, so a slow connector must not hold the page. */
export const PROBE_TIMEOUT_MS = 10_000;
/** How long a failed probe stands (D3, user decision 2026-10-26): meanwhile that connection cannot export. */
export const PROBE_RETRY_MS = 60_000;

/** The shim, or a test's stand-in (d.callSource). */
const callOf = (d) => (d && typeof d.callSource === 'function' ? d.callSource : shimCallSource);
/** Milliseconds now, or a test's clock (d.now() → a Date or a number). */
const msOf = (d) => (d && typeof d.now === 'function' ? Number(d.now()) : Date.now());

// D3: capabilities() answers per plugin, source id and installed version, for the process's life ("yes" and "no" alike).
// A failed probe is remembered for PROBE_RETRY_MS per plugin, source id and profile (the source cannot export meanwhile),
// then asked again (user decision 2026-10-26). In-flight probes are shared, so several views at once ask once.
const capCache = new Map();
const capFailed = new Map();   // `${plugin}/${sourceId}/${profile}` → when the probe failed
const capInflight = new Map();
// exportOptions' last doneStatus per connection (Task 5's saveSetup stores it on the setup).
const lastDone = new Map();
/** Tests: forget every probe answer, failure and done status. */
export function _resetExportCaches() { capCache.clear(); capFailed.clear(); capInflight.clear(); lastDone.clear(); }

const versionOf = (plugin) => { try { return String((readPluginsLock()[plugin] || {}).version || ''); } catch { return ''; } };
/** A source's connections: a multi-profile source's profiles; a single-profile source is its one configuration. */
const connectionsOf = (s) => (s.multiProfile === true ? (s.profiles || []) : [{ id: null, label: s.displayName }]);

async function probe(s, first, d) {
  try {
    const caps = await callOf(d)({ plugin: s.plugin, sourceId: s.sourceId, op: 'capabilities', args: { inputs: {} },
      profile: first.id || undefined, timeoutMs: PROBE_TIMEOUT_MS });
    return { keep: true, ok: !!(caps && caps.export === true) };
  } catch (err) {
    // A connector without the op cannot export (kept); any other failure stands for PROBE_RETRY_MS (D3)
    return { keep: (err && err.kind) === 'unimplemented', ok: false };
  }
}

async function canExport(s, first, d) {
  const key = `${s.plugin}/${s.sourceId}@${versionOf(s.plugin)}`;
  if (capCache.has(key)) return capCache.get(key);
  const failKey = `${s.plugin}/${s.sourceId}/${first.id || ''}`;
  if (capFailed.has(failKey) && msOf(d) - capFailed.get(failKey) < PROBE_RETRY_MS) return false;
  if (!capInflight.has(key)) {
    capInflight.set(key, probe(s, first, d).then((r) => {
      if (r.keep) { capCache.set(key, r.ok); capFailed.delete(failKey); } else capFailed.set(failKey, msOf(d));
      return r.ok;
    }).finally(() => capInflight.delete(key)));
  }
  return capInflight.get(key);
}

/** The sources that can export (D1, D3): enabled plugin task sources with a connection (a multi-profile source needs a
 *  profile; it is probed with its first, since it refuses a call without one) whose capabilities() say export: true, in
 *  listTaskSources' order. All sources are probed at once, so one slow connector costs a view at most PROBE_TIMEOUT_MS.
 *  Never throws. */
export async function exportTrackers(d = {}) {
  let sources = [];
  try { sources = listTaskSources().filter((s) => s.type === 'plugin'); } catch { return []; }
  const found = await Promise.all(sources.map(async (s) => {
    const conns = connectionsOf(s);
    if (!conns.length || !(await canExport(s, conns[0], d))) return null;
    return { plugin: s.plugin, sourceId: s.sourceId, name: s.displayName, multiProfile: s.multiProfile === true,
      profiles: conns.map((p) => ({ id: p.id || null, label: String(p.label || p.id || s.displayName) })) };
  }));
  return found.filter(Boolean);
}

const bindingsOf = (scope) => { try { return listBindingsForScope(scope.scopeType, scope.scopeKey); } catch { return []; } };

/** D2: where a new setup's Connection starts: the scope's profile from resolveProfile (a bound tracker first), else the
 *  first tracker's first connection; null without a tracker. */
export function defaultConnection(scope, trackers, { memberKeys = [] } = {}) {
  if (!trackers || !trackers.length) return null;
  const bound = new Set(bindingsOf(scope).map((b) => `${b.plugin}/${b.sourceId}`));
  const isBound = (t) => bound.has(`${t.plugin}/${t.sourceId}`);
  const order = [...trackers.filter(isBound), ...trackers.filter((t) => !isBound(t))];
  for (const t of order) {
    if (!t.multiProfile) continue;
    const r = resolveProfile({ scopeType: scope.scopeType, scopeKey: scope.scopeKey, plugin: t.plugin, sourceId: t.sourceId, memberKeys,
      available: t.profiles.map((p) => p.id) });
    if (r.profile) return { plugin: t.plugin, sourceId: t.sourceId, profile: r.profile };
  }
  const t = order[0];
  return { plugin: t.plugin, sourceId: t.sourceId, profile: t.profiles[0].id || null };
}

/** D11: why a tracker could not be reached, in product words. */
export function reachReason(err) {
  const kind = err && err.kind;
  if (kind === 'auth') return 'the API token was refused';
  if (kind === 'timeout') return 'it did not answer within a minute';
  return String((err && err.message) || 'it did not answer').trim().replace(/\.+$/, '');
}
export const reachSentence = (name, err) => `Worca could not reach ${name || 'the tracker'}: ${reachReason(err)}.`;
```

  `lastDone` is declared here so `_resetExportCaches` covers it; Task 5 uses it.

- [ ] **Step 6: Run and see them pass.** `node tools/test.mjs test/plugin-shim.test.mjs`, `node tools/test.mjs test/requirements-export-trackers.test.mjs`, `node tools/test.mjs test/writeback.test.mjs` → pass. Then the other mock-mode users of the shim: `node tools/test.mjs test/sources.test.mjs`, `node tools/test.mjs test/api-sources.test.mjs`, `node tools/test.mjs test/api-plugins.test.mjs` → pass (compare a failure with `<baseline>`).

- [ ] **Step 7: Commit.**

```bash
git add src/core/plugin-shim.mjs src/core/plugin-api.mjs .claude/skills/creating-worca-cc-plugins/SKILL.md src/core/requirements/export.mjs test/plugin-shim.test.mjs test/writeback.test.mjs test/requirements-export-trackers.test.mjs
git commit -m "Requirements: optional export ops in the task-source contract, the capability probe and mock answers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: The Jira connector's export ops, against a fake Jira (Cloud and Data Center)

**Files:**
- Modify: `plugins/jira-source/connector/jira-api.mjs` (a failed request's error carries Jira's JSON body)
- Modify: `plugins/jira-source/connector/index.mjs` (imports; a project lister shared by `listProjects` and `exportOptions`; the six ops; `capabilities`)
- Modify: `plugins/jira-source/README.md` (an Export section after Write-back)
- Create: `test/helpers/fake-jira.mjs`, `test/jira-source-export.test.mjs`

**Interfaces:**
- Consumes: `jiraFetch(jira, path, { method, body, anonymous })` and its error `{ kind, status }` (jira-api.mjs); `markdownToWiki` (markup.mjs); `buildJql`, `jqlString`, `deployment()` (index.mjs); the Task 3 contract.
- Produces (`plugins/jira-source/connector/index.mjs`):
  - `fingerprintOf(text) → string` (exported): sha256 hex of the text with CRLF → LF, trailing spaces and tabs per line removed, trimmed
  - the connector's `exportOptions`, `createTicket`, `updateTicket`, `commentTicket`, `ticketState`, `findTicket` (design §5) and `capabilities({ inputs })` → `{ writeBack: yes(inputs.writeBack), incrementalSync: false, export: true }`
  - the issue property `worca.export` = `{ marker }`
  - refusal sentences: `Jira needs a value for “<field name>” in <project>.` (Jira's message says "required") or `Jira refused “<field name>”: <Jira's message>`
  - any other `plugin`-kind failure of an export op is rethrown as `{ kind: 'plugin', message: 'Jira refused the request: <Jira's errorMessages, or "no reason given">' }`: never the HTTP status or the `(METHOD path)` part, which the host would show (D11, Global Constraints)
  - once Jira has made the issue (`createTicket`) or taken the edit (`updateTicket`), the op never throws: a refused property PUT is logged (`log('warn', …)`), a failed read-back answers `fingerprint: null` (D10: a throw would keep the host's pending marker and Try again would make a second ticket)
  - `updateTicket` reads the issue's `issuetype` first (the same GET answers 404 → gone) and sends `issuetype` only when it changes: many sites refuse it in an edit
  - `exportOptions` answers `tooOld` only on Data Center; on Cloud a create-metadata 404 (the project is gone or hidden) throws
- Produces (`test/helpers/fake-jira.mjs`): `startFakeJira({ deployment = 'cloud'|'datacenter', token = 'tok', email = 'ann@acme.test', refuseToken, refuseProperties, refusePropertyPut, failReadBack, refuseIssuetypeEdit, fail: { method, path, status, body } | null, oldCreatemeta, requiredField: { id, name } | null, refuseOnUpdate: { id, message } | null, storeCrlf }) → Promise<{ base, issues: Map, requests: Array<{ method, path, query, body, auth }>, close() }>`

- [ ] **Step 1: The fake Jira.** Create `test/helpers/fake-jira.mjs`:

```js
// test/helpers/fake-jira.mjs — a fake Jira (REST v2) on 127.0.0.1 for jira-source's export ops (plans/requirements-a6-design.md
// §5, §9): Cloud or Data Center, in memory, every request recorded. Never a real Jira. Cloud answers create metadata as
// { issueTypes | fields }, Data Center as { values }; Cloud searches at /search/jql, Data Center at /search.
import { createServer } from 'node:http';

const PROJECTS = [{ key: 'SHOP', name: 'Shop web' }, { key: 'OPS', name: 'Operations' }];
const TYPES = [{ id: '10001', name: 'Story', subtask: false }, { id: '10002', name: 'Task', subtask: false }, { id: '10003', name: 'Bug', subtask: false },
  { id: '10004', name: 'Sub-task', subtask: true }];
const BASE_FIELDS = [
  { fieldId: 'summary', name: 'Summary', required: true, schema: { type: 'string', system: 'summary' } },
  { fieldId: 'issuetype', name: 'Issue Type', required: true, schema: { type: 'issuetype', system: 'issuetype' } },
  { fieldId: 'priority', name: 'Priority', required: false, schema: { type: 'priority', system: 'priority' },
    allowedValues: [{ id: '1', name: 'Highest' }, { id: '3', name: 'Medium' }] },
  { fieldId: 'customfield_10070', name: 'Acceptance Criteria', required: false,
    schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } },
  { fieldId: 'customfield_10080', name: 'Sprint goal', required: false,
    schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield' } },
];

export async function startFakeJira(o = {}) {
  // refusePropertyPut: a role that may create issues but not edit them (403 on the property PUT); failReadBack: a description
  // read fails (500); refuseIssuetypeEdit: an edit naming issuetype is refused; fail: one request answers that status and body.
  const opt = { deployment: 'cloud', token: 'tok', email: 'ann@acme.test', refuseToken: false, refuseProperties: false, refusePropertyPut: false,
    failReadBack: false, refuseIssuetypeEdit: false, fail: null, oldCreatemeta: false, requiredField: null, refuseOnUpdate: null, storeCrlf: false, ...o };
  const cloud = opt.deployment === 'cloud';
  const auth = cloud ? `Basic ${Buffer.from(`${opt.email}:${opt.token}`).toString('base64')}` : `Bearer ${opt.token}`;
  const fields = [...BASE_FIELDS, ...(opt.requiredField ? [{ fieldId: opt.requiredField.id, name: opt.requiredField.name, required: true,
    schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } }] : [])];
  const issues = new Map();   // key → { key, project, fields, properties, comments }
  const requests = [];
  let next = 101;
  // Cloud keeps descriptions as ADF and answers v2 reads in wiki markup it re-renders: storeCrlf mimics a re-render that is
  // not byte-equal (CRLF, trailing spaces), which the fingerprint must not count as an edit.
  const stored = (text) => (opt.storeCrlf ? `${String(text ?? '').split('\n').join('  \r\n')}\r\n` : String(text ?? ''));
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  const gone = (res) => send(res, 404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'], errors: {} });
  let base = '';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake');
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : undefined;
    const p = url.pathname;
    requests.push({ method: req.method, path: p, query: Object.fromEntries(url.searchParams), body, auth: req.headers.authorization || null });
    if (p === '/rest/api/2/serverInfo') return send(res, 200, { deploymentType: cloud ? 'Cloud' : 'DataCenter' });
    if (opt.refuseToken || req.headers.authorization !== auth) return send(res, 401, { errorMessages: ['You are not authenticated.'] });
    if (opt.fail && req.method === opt.fail.method && p === opt.fail.path) return send(res, opt.fail.status, opt.fail.body);
    if (cloud && p === '/rest/api/2/project/search') return send(res, 200, { values: PROJECTS, isLast: true });
    if (!cloud && p === '/rest/api/2/project') return send(res, 200, PROJECTS);
    let m = /^\/rest\/api\/2\/issue\/createmeta\/([^/]+)\/issuetypes(?:\/([^/]+))?$/.exec(p);
    if (m) {
      if (opt.oldCreatemeta) return send(res, 404, { errorMessages: ['null for uri'], errors: {} });
      const list = m[2] ? fields : TYPES;
      return send(res, 200, cloud ? { [m[2] ? 'fields' : 'issueTypes']: list, startAt: 0, maxResults: 100, total: list.length }
        : { values: list, startAt: 0, maxResults: 100, total: list.length, isLast: true });
    }
    if (p === '/rest/api/2/issue' && req.method === 'POST') {
      if (body.properties && opt.refuseProperties) {
        return send(res, 400, { errorMessages: [], errors: { properties: "Field 'properties' cannot be set. It is not on the appropriate screen, or unknown." } });
      }
      if (opt.requiredField && !body.fields[opt.requiredField.id]) {
        return send(res, 400, { errorMessages: [], errors: { [opt.requiredField.id]: `${opt.requiredField.name} is required.` } });
      }
      const key = `${body.fields.project.key}-${next++}`;
      issues.set(key, { key, project: body.fields.project.key, fields: { ...body.fields, labels: [...(body.fields.labels || [])], description: stored(body.fields.description) },
        properties: Object.fromEntries((body.properties || []).map((x) => [x.key, x.value])), comments: [] });
      return send(res, 201, { id: String(next), key, self: `${base}/rest/api/2/issue/${key}` });
    }
    m = /^\/rest\/api\/2\/issue\/([^/]+)\/properties\/([^/]+)$/.exec(p);
    if (m) {
      const i = issues.get(m[1]);
      if (!i) return gone(res);
      if (req.method === 'PUT') {
        if (opt.refusePropertyPut) return send(res, 403, { errorMessages: ['You do not have permission to edit issues in this project.'], errors: {} });
        i.properties[m[2]] = body;
        return send(res, 200, {});
      }
      return m[2] in i.properties ? send(res, 200, { key: m[2], value: i.properties[m[2]] }) : send(res, 404, { errorMessages: ['The property was not found.'] });
    }
    m = /^\/rest\/api\/2\/issue\/([^/]+)\/comment$/.exec(p);
    if (m) {
      const i = issues.get(m[1]);
      if (!i) return gone(res);
      i.comments.push(body.body);
      return send(res, 201, { id: String(i.comments.length) });
    }
    m = /^\/rest\/api\/2\/issue\/([^/]+)$/.exec(p);
    if (m) {
      const i = issues.get(m[1]);
      if (!i) return gone(res);
      if (req.method === 'PUT') {
        if (opt.refuseIssuetypeEdit && body.fields && 'issuetype' in body.fields) {
          return send(res, 400, { errorMessages: [], errors: { issuetype: "Field 'issuetype' cannot be set. It is not on the appropriate screen, or unknown." } });
        }
        if (opt.refuseOnUpdate && body.fields && opt.refuseOnUpdate.id in body.fields) {
          return send(res, 400, { errorMessages: [], errors: { [opt.refuseOnUpdate.id]: opt.refuseOnUpdate.message } });
        }
        for (const [k, v] of Object.entries(body.fields || {})) i.fields[k] = k === 'description' ? stored(v) : v;
        for (const op of (body.update && body.update.labels) || []) if (op.add && !i.fields.labels.includes(op.add)) i.fields.labels.push(op.add);
        return send(res, 204);
      }
      if (opt.failReadBack && /description/.test(url.searchParams.get('fields') || '')) return send(res, 500, { errorMessages: [], errors: {} });
      return send(res, 200, { key: i.key, fields: { description: i.fields.description, labels: i.fields.labels, summary: i.fields.summary,
        issuetype: i.fields.issuetype } });
    }
    if ((cloud && p === '/rest/api/2/search/jql') || (!cloud && p === '/rest/api/2/search')) {
      const jql = url.searchParams.get('jql') || '';
      const project = (/project = "([^"]+)"/.exec(jql) || [])[1];
      const label = (/labels = "([^"]+)"/.exec(jql) || [])[1];
      const hits = [...issues.values()].filter((i) => (!project || i.project === project) && (!label || i.fields.labels.includes(label))).reverse()
        .map((i) => ({ key: i.key, fields: { description: i.fields.description, labels: i.fields.labels } }));
      return send(res, 200, cloud ? { issues: hits, isLast: true } : { issues: hits, startAt: 0, total: hits.length });
    }
    return send(res, 404, { errorMessages: [`fake Jira: no route ${req.method} ${p}`] });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, issues, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
```

- [ ] **Step 2: Write the failing test** `test/jira-source-export.test.mjs`:

```js
// test/jira-source-export.test.mjs — jira-source's export ops against a fake Jira over real HTTP (plans/requirements-a6-design.md
// §5, D9–D11, D16): Cloud and Data Center, create metadata as `fields` or `values`, the textarea filter, a required field, a
// refused token, 404 as gone, the property in the create body and its fallback, add-only labels, the fingerprint.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import createTaskSource, { fingerprintOf } from '../plugins/jira-source/connector/index.mjs';
import { markdownToWiki } from '../plugins/jira-source/connector/markup.mjs';
import { startFakeJira } from './helpers/fake-jira.mjs';

const open = [];
after(async () => { for (const j of open) await j.close(); });
async function site(o = {}) {
  const jira = await startFakeJira(o);
  open.push(jira);
  const cloud = (o.deployment || 'cloud') === 'cloud';
  const map = new Map();
  const ctx = { apiVersion: 5, profile: 'acme', log: () => {},
    config: { baseUrl: jira.base, email: cloud ? 'ann@acme.test' : '', token: 'tok', transitionOnComplete: o.done ?? 'Done' },
    state: { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); } } };
  return { jira, src: createTaskSource(ctx) };
}
const DESC = '## Goal\n\nCancel before it ships.\n\nMeasure: fewer calls\n\n## Acceptance criteria\n\n- R-po-1 Cancel while unpaid\n\nFrom Worca FEAT-7 · exported 26 Oct 2026\n';
const TICKET = { project: 'SHOP', issueType: '10001', title: 'Cancel an order before it ships', description: DESC, labels: ['worca', 'worca-FEAT-7'],
  priority: '3', criteria: { target: 'description' } };
const BOTH = ['cloud', 'datacenter'];

test('capabilities: export is on; write-back still follows the run\'s input', async () => {
  const { src } = await site();
  assert.deepEqual(src.capabilities({ inputs: { writeBack: 'yes' } }), { writeBack: true, incrementalSync: false, export: true });
  assert.deepEqual(src.capabilities({}), { writeBack: false, incrementalSync: false, export: true });
});

test('exportOptions: projects as "SHOP — Shop web"; issue types without sub-tasks; priorities; only multi-line text fields; doneStatus', async () => {
  for (const deployment of BOTH) {
    const { src } = await site({ deployment });
    const p = await src.exportOptions({});
    assert.deepEqual(p, { projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }], doneStatus: 'Done' }, deployment);
    assert.deepEqual((await src.exportOptions({ project: 'SHOP' })).issueTypes,
      [{ value: '10001', label: 'Story' }, { value: '10002', label: 'Task' }, { value: '10003', label: 'Bug' }], deployment);
    const both = await src.exportOptions({ project: 'SHOP', issueType: '10001' });
    assert.deepEqual(both.priorities, [{ value: '1', label: 'Highest' }, { value: '3', label: 'Medium' }], deployment);
    assert.deepEqual(both.criteriaFields, [{ value: 'customfield_10070', label: 'Acceptance Criteria' }], `${deployment}: the one-line field is left out`);
  }
  const { src } = await site({ done: '  ' });
  assert.equal((await src.exportOptions({})).doneStatus, null, 'no transition named: null');
});

test('exportOptions: a Data Center older than 8.4 (create metadata 404) answers tooOld', async () => {
  const { src } = await site({ deployment: 'datacenter', oldCreatemeta: true });
  const r = await src.exportOptions({ project: 'SHOP' });
  assert.deepEqual([r.tooOld, r.issueTypes, r.projects.length], [true, [], 2]);
});

test('exportOptions: on Cloud a create-metadata 404 means the project is gone or hidden, not "too old": it throws', async () => {
  const { src } = await site({ deployment: 'cloud', oldCreatemeta: true });
  await assert.rejects(src.exportOptions({ project: 'SHOP' }), (e) => e.kind === 'plugin' && !('tooOld' in e) && !/404|\/rest\//.test(e.message));
});

test('createTicket: wiki markup, labels, priority, the marker as the worca.export property, the URL and the fingerprint of what Jira stores', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, storeCrlf: deployment === 'cloud' });
    const r = await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } });
    assert.deepEqual([r.key, r.url], ['SHOP-101', `${jira.base}/browse/SHOP-101`], deployment);
    const i = jira.issues.get('SHOP-101');
    assert.equal(i.fields.summary, 'Cancel an order before it ships');
    assert.equal(i.fields.description.replace(/ *\r\n/g, '\n').trimEnd(), markdownToWiki(DESC));
    assert.match(i.fields.description, /^h2\. Goal/);
    assert.deepEqual([i.fields.labels, i.fields.priority, i.fields.issuetype, i.fields.project], [['worca', 'worca-FEAT-7'], { id: '3' }, { id: '10001' }, { key: 'SHOP' }]);
    assert.deepEqual(i.properties['worca.export'], { marker: 'rexp_0123456789ab' });
    assert.equal(r.fingerprint, fingerprintOf(i.fields.description));
    assert.equal(r.fingerprint, fingerprintOf(markdownToWiki(DESC)), `${deployment}: CRLF and trailing spaces do not count`);
    const back = jira.requests.at(-1);
    assert.deepEqual([back.method, back.path, back.query.fields], ['GET', '/rest/api/2/issue/SHOP-101', 'description'], 'one read back');
  }
});

test('createTicket: criteria to a field go as a wiki list there; no priority means none sent', async () => {
  const { jira, src } = await site();
  await src.createTicket({ ticket: { ...TICKET, priority: null, criteria: { target: 'field', field: 'customfield_10070', items: ['R-po-1 Cancel while unpaid', 'R-po-2 Refund'] } } });
  const i = jira.issues.get('SHOP-101');
  assert.equal(i.fields.customfield_10070, '* R-po-1 Cancel while unpaid\n* R-po-2 Refund');
  assert.equal('priority' in i.fields, false);
});

test('createTicket: a site that refuses properties in the create gets the property in its own call', async () => {
  const { jira, src } = await site({ deployment: 'datacenter', refuseProperties: true });
  const r = await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } });
  assert.equal(r.key, 'SHOP-101');
  assert.deepEqual(jira.issues.get('SHOP-101').properties['worca.export'], { marker: 'rexp_0123456789ab' });
  assert.deepEqual(jira.requests.filter((q) => q.method !== 'GET').map((q) => [q.method, q.path]), [
    ['POST', '/rest/api/2/issue'], ['POST', '/rest/api/2/issue'], ['PUT', '/rest/api/2/issue/SHOP-101/properties/worca.export']]);
  assert.equal(jira.issues.size, 1, 'one ticket');
});

test('once Jira made the issue or took the edit nothing throws (D10): a refused property PUT and a failed read-back still answer the key', async () => {
  const { jira, src } = await site({ deployment: 'datacenter', refuseProperties: true, refusePropertyPut: true });
  const r = await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } });
  assert.deepEqual([r.key, r.url, jira.issues.size], ['SHOP-101', `${jira.base}/browse/SHOP-101`, 1], 'one issue and its key');
  assert.match(r.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal('worca.export' in jira.issues.get('SHOP-101').properties, false, 'the marker could not be stored; the host links the key anyway');
  const other = await site({ failReadBack: true });
  const made = await other.src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } });
  assert.deepEqual([made.key, made.fingerprint, other.jira.issues.size], ['SHOP-101', null, 1]);
  const upd = await other.src.updateTicket({ key: 'SHOP-101', ticket: { ...TICKET, title: 'Cancel an order' } });
  assert.deepEqual([upd.key, upd.fingerprint, other.jira.issues.get('SHOP-101').fields.summary], ['SHOP-101', null, 'Cancel an order'],
    'a completed edit is not reported as a failure');
});

test('createTicket: a required custom field is a refusal naming it from create metadata; nothing is created', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, requiredField: { id: 'customfield_10050', name: 'Team' } });
    assert.deepEqual(await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } }),
      { refused: { field: 'Team', message: 'Jira needs a value for “Team” in SHOP.' } }, deployment);
    assert.equal(jira.issues.size, 0);
  }
});

test('a refused token throws kind auth (the host says "the API token was refused")', async () => {
  const { src } = await site({ refuseToken: true });
  await assert.rejects(src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } }), (e) => e.kind === 'auth');
  await assert.rejects(src.exportOptions({}), (e) => e.kind === 'auth');
});

test('a request Jira refuses without naming a field: "Jira refused the request: <its words>", never the HTTP status or the REST path (D11)', async () => {
  const { src } = await site({ fail: { method: 'POST', path: '/rest/api/2/issue/SHOP-101/comment', status: 403,
    body: { errorMessages: ['You do not have permission to comment on this issue.'], errors: {} } } });
  await src.createTicket({ ticket: TICKET });
  await assert.rejects(src.commentTicket({ key: 'SHOP-101', body: 'x' }),
    (e) => e.kind === 'plugin' && e.message === 'Jira refused the request: You do not have permission to comment on this issue.');
  const other = await site({ fail: { method: 'GET', path: '/rest/api/2/issue/createmeta/SHOP/issuetypes', status: 500, body: {} } });
  await assert.rejects(other.src.exportOptions({ project: 'SHOP' }),
    (e) => e.kind === 'plugin' && e.message === 'Jira refused the request: no reason given');
});

test('updateTicket: summary, description and fields rewritten, labels only added; a refused field; a deleted ticket is gone', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, refuseOnUpdate: null });
    const made = await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } });
    jira.issues.get('SHOP-101').fields.labels.push('sprint-12');   // the team added a label in Jira
    const r = await src.updateTicket({ key: 'SHOP-101', ticket: { ...TICKET, title: 'Cancel an order', description: `${DESC}\nMore.\n`, labels: ['web', 'worca-FEAT-7'] } });
    const i = jira.issues.get('SHOP-101');
    assert.deepEqual([r.key, i.fields.summary, i.fields.labels], ['SHOP-101', 'Cancel an order', ['worca', 'worca-FEAT-7', 'sprint-12', 'web']], deployment);
    const put = jira.requests.find((q) => q.method === 'PUT' && q.path === '/rest/api/2/issue/SHOP-101');
    assert.equal('labels' in put.body.fields, false, 'labels go in update.add, never in fields');
    assert.equal('project' in put.body.fields, false);
    assert.notEqual(r.fingerprint, made.fingerprint);
    assert.equal(r.fingerprint, fingerprintOf(i.fields.description));
    assert.deepEqual(await src.updateTicket({ key: 'SHOP-999', ticket: TICKET }), { gone: true });
  }
  const { src } = await site({ refuseOnUpdate: { id: 'customfield_10080', message: 'Sprint goal is too long.' } });
  await src.createTicket({ ticket: TICKET });
  assert.deepEqual(await src.updateTicket({ key: 'SHOP-101', ticket: { ...TICKET, criteria: { target: 'field', field: 'customfield_10080', items: ['x'] } } }),
    { refused: { field: 'Sprint goal', message: 'Jira refused “Sprint goal”: Sprint goal is too long.' } });
});

test('updateTicket sends issuetype only when it changes: a site that refuses it in an edit still takes the update', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, refuseIssuetypeEdit: true });
    await src.createTicket({ ticket: TICKET });
    const r = await src.updateTicket({ key: 'SHOP-101', ticket: { ...TICKET, title: 'Cancel an order' } });
    assert.deepEqual([r.key, jira.issues.get('SHOP-101').fields.summary], ['SHOP-101', 'Cancel an order'], deployment);
    const put = jira.requests.find((q) => q.method === 'PUT' && q.path === '/rest/api/2/issue/SHOP-101');
    assert.equal('issuetype' in put.body.fields, false, `${deployment}: the type did not change, so it is not sent`);
    assert.deepEqual((await src.updateTicket({ key: 'SHOP-101', ticket: { ...TICKET, issueType: '10002' } })).refused.field, 'Issue Type',
      `${deployment}: a real change is still sent (and refused here)`);
  }
});

test('commentTicket: the comment as wiki markup; a deleted ticket is gone', async () => {
  const { jira, src } = await site();
  await src.createTicket({ ticket: TICKET });
  assert.deepEqual(await src.commentTicket({ key: 'SHOP-101', body: 'Updated in Worca since the last export (26 Oct)\n\nAdded R-po-6 Cancel [part] of it\n\nFrom Worca FEAT-7\n' }), { ok: true });
  assert.equal(jira.issues.get('SHOP-101').comments[0], 'Updated in Worca since the last export (26 Oct)\n\nAdded R-po-6 Cancel \\[part\\] of it\n\nFrom Worca FEAT-7');
  assert.deepEqual(await src.commentTicket({ key: 'SHOP-999', body: 'x' }), { gone: true });
});

test('ticketState: the same fingerprint as the create; another after an edit in Jira; a deleted ticket does not exist', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, storeCrlf: true });
    const made = await src.createTicket({ ticket: TICKET });
    assert.deepEqual(await src.ticketState({ key: 'SHOP-101' }), { exists: true, url: `${jira.base}/browse/SHOP-101`, fingerprint: made.fingerprint }, deployment);
    jira.issues.get('SHOP-101').fields.description += 'Edited in Jira.';
    assert.notEqual((await src.ticketState({ key: 'SHOP-101' })).fingerprint, made.fingerprint);
    assert.deepEqual(await src.ticketState({ key: 'SHOP-999' }), { exists: false });
  }
});

test('findTicket: by project and label, then the property; another install\'s marker is no match; the last line and labels come back', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment });
    await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_aaaaaaaaaaaa' } });   // another install, same label
    await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_bbbbbbbbbbbb' } });
    const hit = await src.findTicket({ project: 'SHOP', label: 'worca-FEAT-7', marker: 'rexp_bbbbbbbbbbbb' });
    assert.deepEqual([hit.key, hit.url, hit.marker, hit.labels, hit.lastLine], ['SHOP-102', `${jira.base}/browse/SHOP-102`, 'rexp_bbbbbbbbbbbb',
      ['worca', 'worca-FEAT-7'], 'From Worca FEAT-7 · exported 26 Oct 2026'], deployment);
    assert.equal(hit.fingerprint, fingerprintOf(jira.issues.get('SHOP-102').fields.description));
    assert.equal(await src.findTicket({ project: 'SHOP', label: 'worca-FEAT-7', marker: 'rexp_cccccccccccc' }), null);
    assert.equal(await src.findTicket({ project: 'OPS', label: 'worca-FEAT-7', marker: 'rexp_bbbbbbbbbbbb' }), null);
    const search = jira.requests.find((q) => q.path.startsWith('/rest/api/2/search'));
    assert.equal(search.path, deployment === 'cloud' ? '/rest/api/2/search/jql' : '/rest/api/2/search');
    assert.equal(search.query.jql, 'project = "SHOP" AND (labels = "worca-FEAT-7") ORDER BY created DESC');
    assert.equal(search.query.maxResults, '10');
  }
});

test('fingerprintOf: CRLF, trailing spaces and outer blank lines never count; any other change does', () => {
  assert.equal(fingerprintOf('a  \r\nb\t\r\n\r\n'), fingerprintOf('a\nb'));
  assert.notEqual(fingerprintOf('a\nb'), fingerprintOf('a\nc'));
  assert.match(fingerprintOf(''), /^[0-9a-f]{64}$/);
});
```

- [ ] **Step 3: Run it and see it fail.** `node tools/test.mjs test/jira-source-export.test.mjs` → FAIL: `fingerprintOf` is not exported (SyntaxError on import).

- [ ] **Step 4: Carry Jira's body on a failed request.** In `plugins/jira-source/connector/jira-api.mjs` replace

```js
    throw err('plugin', `Jira ${res.status}${detail ? `: ${detail}` : ''} (${method} ${path})`, { status: res.status });
```

  with

```js
    // `body`: Jira's own errors, for an export op that turns a refused field into a result (A6 D11)
    throw err('plugin', `Jira ${res.status}${detail ? `: ${detail}` : ''} (${method} ${path})`, { status: res.status, body: json });
```

- [ ] **Step 5: Implement the ops.** In `plugins/jira-source/connector/index.mjs`:
  - Replace the header comment's last line `// deps.fetch injected by tests.` with:

```js
// A6 (plans/requirements-a6-design.md §5): the optional export ops. A tool-neutral ticket (Markdown description, normalised
// labels) becomes a v2 issue in wiki markup; a create stores Worca's marker as the issue property `worca.export`; after a
// create or update the description is read back once for the fingerprint Worca compares (D9). A refused field and a ticket
// that is gone are results, not errors (D11). deps.fetch injected by tests.
```

  - Add `import { createHash } from 'node:crypto';` as the first import.
  - After `export const isCloud = …;` add:

```js
/** D9: the fingerprint of a description as Jira stores it: what reads back is wiki markup Cloud re-renders from ADF, so line
 *  endings, trailing spaces and outer blank lines never count. Worca compares these opaque strings only. */
export function fingerprintOf(text) {
  const norm = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').trim();
  return createHash('sha256').update(norm).digest('hex');
}
const PROPERTY = 'worca.export';
```

  - In `createTaskSource`, right after `const issue = (key, fields = FIELDS, expand = '') => …;` add:

```js
  // Every project: Data Center lists them at once, Cloud pages (up to 2,000, as listProjects always did).
  async function projectList() {
    if ((await deployment()) !== 'cloud') {
      const all = await jiraFetch(jira, '/rest/api/2/project');
      return (Array.isArray(all) ? all : []).map((p) => ({ key: p.key, name: p.name }));
    }
    const out = [];
    for (let startAt = 0, page = 0; page < 20; page++) {
      const j = await jiraFetch(jira, `/rest/api/2/project/search?orderBy=name&maxResults=100&startAt=${startAt}`);
      const values = j?.values || [];
      out.push(...values.map((p) => ({ key: p.key, name: p.name })));
      if (j?.isLast !== false || !values.length) break;
      startAt += values.length;
    }
    return out;
  }
  // Create metadata (D16): Cloud and Data Center 8.4+, paged; Cloud names the list issueTypes / fields, Data Center values.
  async function createmeta(path, key) {
    const out = [];
    for (let startAt = 0, page = 0; page < 20; page++) {
      const j = await jiraFetch(jira, `${path}?startAt=${startAt}&maxResults=100`);
      const list = Array.isArray(j?.[key]) ? j[key] : Array.isArray(j?.values) ? j.values : [];
      out.push(...list);
      const total = Number(j?.total);
      if (!list.length || j?.isLast === true || (Number.isFinite(total) ? startAt + list.length >= total : list.length < 100)) break;
      startAt += list.length;
    }
    return out;
  }
  const createFields = (project, issueType) => createmeta(`/rest/api/2/issue/createmeta/${enc(project)}/issuetypes/${enc(issueType)}`, 'fields');
  const fieldId = (f) => f.fieldId || f.key || f.id;
  const browse = (key) => `${base}/browse/${key}`;
  // After a create or an update has happened: a failed read-back answers null (the host then skips the edited check once);
  // it never throws, or the host would think nothing was made (D10)
  const readFingerprint = async (key) => {
    try { return fingerprintOf((await issue(key, ['description']))?.fields?.description); }
    catch (e) { log('warn', `${key}: could not read the description back: ${e?.message || e}`); return null; }
  };
  // D11: jira-api's message names the HTTP status and the REST path, which the host would show. An export op's `plugin`
  // failure that is not a refusal or gone says Jira's own words only; auth, network and rate-limit pass unchanged.
  function plainFailure(e) {
    if (!e || e.kind !== 'plugin') return e;
    const said = (e.body?.errorMessages || []).map((m) => String(m).trim()).filter(Boolean).join('; ');
    return Object.assign(new Error(`Jira refused the request: ${said || 'no reason given'}`), { kind: 'plugin', status: e.status });
  }
  const exportOp = (fn) => async (args = {}) => { try { return await fn(args); } catch (e) { throw plainFailure(e); } };
  // The ticket's fields (design §5). Labels arrive normalised (no spaces); the criteria field gets the items as a wiki list.
  function ticketFields(t) {
    const f = { project: { key: t.project }, issuetype: { id: String(t.issueType) }, summary: t.title, description: markdownToWiki(t.description),
      labels: Array.isArray(t.labels) ? t.labels : [] };
    if (t.priority) f.priority = { id: String(t.priority) };
    if (t.criteria?.target === 'field' && t.criteria.field) f[t.criteria.field] = markdownToWiki((t.criteria.items || []).map((i) => `- ${i}`).join('\n'));
    return f;
  }
  // D11: a 400 naming a field is a result the product owner can act on; the field's name comes from create metadata.
  async function refusal(e, project, issueType) {
    if (e?.status !== 400) return null;
    const errors = e.body?.errors && typeof e.body.errors === 'object' ? e.body.errors : {};
    const [id, msg] = Object.entries(errors)[0] || [];
    if (!id) return null;
    let name = id;
    try { const f = (await createFields(project, issueType)).find((x) => fieldId(x) === id); if (f?.name) name = f.name; } catch { /* its id, then */ }
    const message = /\brequired\b/i.test(String(msg)) ? `Jira needs a value for “${name}” in ${project}.` : `Jira refused “${name}”: ${String(msg)}`;
    return { refused: { field: name, message } };
  }
  const refusesProperties = (e) => e?.status === 400 && ('properties' in (e.body?.errors || {})
    || (e.body?.errorMessages || []).some((m) => /propert/i.test(String(m))));
  const lastLine = (text) => String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).at(-1) || '';
```

  - Replace the `listProjects()` method with:

```js
    async listProjects() {
      return (await projectList()).map((p) => ({ value: p.key, label: `${p.name} (${p.key})` }));
    },
```

  - Replace the `capabilities` method with:

```js
    capabilities({ inputs } = {}) { return { writeBack: yes(inputs?.writeBack), incrementalSync: false, export: true }; },
    // ---- A6: export (plans/requirements-a6-design.md §4, §5); each op through exportOp (Jira's words, never a status or path) ----
    exportOptions: exportOp(async ({ project, issueType } = {}) => {
      const projects = (await projectList()).map((p) => ({ value: p.key, label: `${p.key} — ${p.name}` }));
      const doneStatus = String(ctx.config?.transitionOnComplete || '').trim() || null;
      if (!project) return { projects, doneStatus };
      let types;
      try { types = await createmeta(`/rest/api/2/issue/createmeta/${enc(project)}/issuetypes`, 'issueTypes'); }
      catch (e) {
        // only a Data Center before 8.4 lacks this endpoint; on Cloud a 404 means the project is gone or not visible (D16)
        if (e.status === 404 && (await deployment()) === 'datacenter') return { projects, issueTypes: [], tooOld: true, doneStatus };
        throw e;
      }
      const issueTypes = types.filter((t) => !t.subtask).map((t) => ({ value: String(t.id), label: t.name }));
      if (!issueType) return { projects, issueTypes, doneStatus };
      const fields = await createFields(project, issueType);
      const prio = fields.find((f) => fieldId(f) === 'priority');
      return {
        projects, issueTypes, doneStatus,
        priorities: (prio?.allowedValues || []).map((p) => ({ value: String(p.id), label: p.name })),
        // a list needs lines: only multi-line text fields can hold the criteria (D16)
        criteriaFields: fields.filter((f) => /:textarea$/.test(String(f.schema?.custom || ''))).map((f) => ({ value: fieldId(f), label: f.name })),
      };
    }),
    createTicket: exportOp(async ({ ticket } = {}) => {
      const fields = ticketFields(ticket);
      const props = ticket.marker ? [{ key: PROPERTY, value: { marker: ticket.marker } }] : null;
      let made;
      let propertyLater = false;
      try {
        made = await jiraFetch(jira, '/rest/api/2/issue', { method: 'POST', body: { fields, ...(props ? { properties: props } : {}) } });
      } catch (e) {
        if (!(props && refusesProperties(e))) { const r = await refusal(e, ticket.project, ticket.issueType); if (r) return r; throw e; }
        // a site that will not take properties in the create body: create, then set the property
        try { made = await jiraFetch(jira, '/rest/api/2/issue', { method: 'POST', body: { fields } }); }
        catch (e2) { const r = await refusal(e2, ticket.project, ticket.issueType); if (r) return r; throw e2; }
        propertyLater = true;
      }
      // Jira has made the issue: from here nothing throws (D10). A throw would keep the host's pending marker, and since the
      // issue then lacks the property findTicket would not match it, so Try again would make a second ticket.
      if (propertyLater) {
        try { await jiraFetch(jira, `/rest/api/2/issue/${enc(made.key)}/properties/${PROPERTY}`, { method: 'PUT', body: { marker: ticket.marker } }); }
        catch (e) { log('warn', `${made.key}: could not store Worca's marker: ${e?.message || e}`); }
      }
      return { key: made.key, url: browse(made.key), fingerprint: await readFingerprint(made.key) };
    }),
    updateTicket: exportOp(async ({ key, ticket } = {}) => {
      const k = requireKey(key);
      const { project, labels, ...fields } = ticketFields(ticket);
      // Many sites refuse issuetype in an edit (Data Center: a type change is a Move; Cloud: often not on the edit screen), so it
      // is sent only when it changes. The same read finds a ticket that is gone.
      let now;
      try { now = await issue(k, ['issuetype']); }
      catch (e) { if (e.status === 404) return { gone: true }; throw e; }
      if (String(now?.fields?.issuetype?.id ?? '') === fields.issuetype.id) delete fields.issuetype;
      try {
        await jiraFetch(jira, `/rest/api/2/issue/${enc(k)}`, { method: 'PUT',
          body: { fields, update: { labels: labels.map((add) => ({ add })) } } });   // labels are added, never removed (D7)
      } catch (e) {
        if (e.status === 404) return { gone: true };
        const r = await refusal(e, project.key, ticket.issueType);
        if (r) return r;
        throw e;
      }
      // the edit is made: a failed read-back answers fingerprint null, never a failure (D10)
      return { key: k, url: browse(k), fingerprint: await readFingerprint(k) };
    }),
    commentTicket: exportOp(async ({ key, body } = {}) => {
      const k = requireKey(key);
      try { await jiraFetch(jira, `/rest/api/2/issue/${enc(k)}/comment`, { method: 'POST', body: { body: markdownToWiki(body) } }); }
      catch (e) { if (e.status === 404) return { gone: true }; throw e; }
      return { ok: true };
    }),
    ticketState: exportOp(async ({ key } = {}) => {
      const k = requireKey(key);
      try { return { exists: true, url: browse(k), fingerprint: fingerprintOf((await issue(k, ['description']))?.fields?.description) }; }
      catch (e) { if (e.status === 404) return { exists: false }; throw e; }
    }),
    findTicket: exportOp(async ({ project, label, marker } = {}) => {
      const jql = buildJql({ project, jql: `labels = ${jqlString(label)} ORDER BY created DESC` });
      const q = `jql=${enc(jql)}&fields=description,labels&maxResults=10`;
      const j = (await deployment()) === 'cloud'
        ? await jiraFetch(jira, `/rest/api/2/search/jql?${q}`) : await jiraFetch(jira, `/rest/api/2/search?${q}&startAt=0`);
      for (const i of (j?.issues || []).slice(0, 10)) {
        let prop = null;
        try { prop = await jiraFetch(jira, `/rest/api/2/issue/${enc(i.key)}/properties/${PROPERTY}`); }
        catch (e) { if (e.status !== 404) throw e; }
        if (!prop || prop.value?.marker !== marker) continue;
        const description = i.fields?.description;
        return { key: i.key, url: browse(i.key), fingerprint: fingerprintOf(description), lastLine: lastLine(description), marker: prop.value.marker,
          labels: Array.isArray(i.fields?.labels) ? i.fields.labels : [] };
      }
      return null;
    }),
```

  The export ops are arrow functions wrapped by `exportOp`; none uses `this`. `ticketState`'s description read stays a throw (it changes nothing in Jira, so a failure there is an honest "could not reach").

- [ ] **Step 6: Run and see it pass.** `node tools/test.mjs test/jira-source-export.test.mjs` → pass. Then `node tools/test.mjs test/jira-source-connector.test.mjs` → pass (listProjects keeps its labels and calls).

- [ ] **Step 7: The README.** In `plugins/jira-source/README.md`, after the Write-back section, add:

```markdown
## Export

Worca's Requirements page can send a feature's spec to Jira as an issue (**Export ▾ › Export to Jira…**), through the
same connection (profile) as above; the token never leaves the plugin. The plugin answers `capabilities()` with
`export: true` and implements the optional export ops:

- **exportOptions** — the projects, the project's issue types (not sub-tasks), the priorities and the multi-line text
  fields that can hold acceptance criteria, from create metadata (`/rest/api/2/issue/createmeta/<project>/issuetypes`,
  Jira Cloud and Data Center 8.4 or later; an older Data Center cannot be set up for export). `doneStatus` is
  **Transition on completion**.
- **createTicket** — a v2 issue with the description in wiki markup, the labels Worca sends, the priority and the
  criteria field, and Worca's marker as the hidden issue property `worca.export` (in the create body, or set right after
  it where a site refuses that). Worca uses the marker and the label `worca-FEAT-<n>` to find an issue whose create
  answer was lost, instead of making a second one.
- **updateTicket** — rewrites summary, description, issue type, priority and the criteria field; labels are only added,
  so labels the team set in Jira stay. The field has to be on the edit screen.
- **commentTicket** — adds the comment Worca previewed.
- **ticketState** / **findTicket** — read an issue's description back. Each create and update returns a fingerprint of
  the stored description (line endings and trailing spaces do not count), so Worca can tell when the description was
  edited in Jira since the last export.

A field Jira refuses comes back as Jira's message naming it ("Jira needs a value for “Team” in SHOP."), and a deleted
issue as gone; nothing is created then. Run results of a run started with **Report back** are written back as described
above.
```

- [ ] **Step 8: Commit.**

```bash
git add plugins/jira-source/connector/jira-api.mjs plugins/jira-source/connector/index.mjs plugins/jira-source/README.md test/helpers/fake-jira.mjs test/jira-source-export.test.mjs
git commit -m "Requirements: jira-source export ops (create, update, comment, options, fingerprint, find)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: The export service — setup, preview, the four modes, the duplicate guard, errors, locks, Forget the link

**Files:**
- Modify: `src/core/requirements/starting.mjs` (the export lock beside the start lock)
- Modify: `src/core/requirements/spec.mjs` (the `RequirementsError` JSDoc gains `'TRACKER'`)
- Modify: `src/core/requirements/export.mjs` (imports; append the service)
- Create: `test/requirements-export.test.mjs`

**Interfaces:**
- Consumes: Task 1's store functions; Task 2's `buildTicket`, `exportChanges`, `changeSummary`, `renderExportComment`, `ticketHash`, `exportDate`, `exportTime`, `exportLabel`, `normalizeLabels`; Task 3's `exportTrackers`, `defaultConnection`, `reachSentence`, `EXPORT_TIMEOUT_MS`, `callOf`, `lastDone`; `readiness` (ready.mjs); `pendingRound` (round.mjs); `isBusy` (interview.mjs); `REASON_MAX` (start.mjs; `start.mjs` never imports `export.mjs`, so there is no cycle); `mentions` (attachments.mjs); `listProfiles` (plugin-config.mjs); `listTaskSources` (sources.mjs).
- Produces (`starting.mjs`): `markExporting(seq)`, `unmarkExporting(seq)`, `isExporting(seq) → boolean`, `EXPORTING_MESSAGE = 'Worca is exporting this feature. Try again in a moment.'`.
- Produces (`export.mjs`; `scope = { scopeType, scopeKey }`; `d` is the routes' deps: `d.callSource` replaces the shim in tests, `d.now()` the clock):
  - `isExporting(seq)` (re-exported), `ALREADY_EXPORTING = 'Worca is already exporting this feature.'`
  - `mentionedFiles(f) → string[]` (D4: feature files, then the scope brief's documents, whose names the spec mentions)
  - `exportSetupView(scope, { memberKeys = [] } = {}, d) → Promise<{ setup: Setup|null, trackers: Tracker[], defaultProfile: Conn|null }>`
  - `exportOptions(scope, { plugin, sourceId, profile, project?, issueType? }, d) → Promise<{ projects, issueTypes?, priorities?, criteriaFields?, doneStatus, tooOld? }>` (BAD_REQUEST "Choose a connection from the list." for a connection that is not a listed tracker's; refreshes the setup's `doneStatus` when it is the setup's connection)
  - `saveSetup(scope, { plugin, sourceId, profile, project, projectName, issueType, issueTypeName, labels, priority, priorityName, criteria }, { by }, d) → Promise<Setup>`
  - `Preview = { mode, tracker, key, ticket: Ticket|null, comment: string|null, previewHash, changes: Array<{ line, id }>, fields: Fields|null, link: { key, madeOn, lastOn }|null, edited: boolean, gone: boolean }`, `Fields = { conn: Conn, connection, project: { value, label }, issueType: { value, label }, labels, fixedLabel, priority: { value, label }|null, criteria: { target: 'description' } | { target: 'field', name, items }, summary }`
  - `previewExport(seq, { mode, issueType?, issueTypeName?, labels?, priority?, priorityName?, reason? }, { target }, d) → Promise<Preview>`
  - `runExport(seq, { …the preview's body, previewHash, force? }, { by, target }, d) → Promise<{ action: 'created'|'new'|'updated'|'commented', key, url }>`
  - `forgetLink(seq, { by } = {}) → void`
  - `ExportView = { tracker: { name: string|null }|null, canExport, hasSetup, link: { key, url, createdAt, exportedAt, madeOn, lastOn, tracker }|null, exporting, doneStatus, history: Array<{ action, tracker, key, url, reason, when, by }> }`
  - `exportView(f, turns, d) → Promise<ExportView>` (never throws)
  - `history[].by` is `actorLabel(turn.by) || null` (identity.mjs): a single-user install's `'local'` names nobody, as board 28 shows a person's name or nothing
  - An `update` takes its criteria, issue type and priority from the current setup when the setup has the link's connection and tracker project (so **Change the export setup** can fix a refused update), else from the fields last sent
  - Errors (`RequirementsError`): `TRACKER` (502 in Task 6) `{ kind }` (an `unimplemented` op answers "<tracker> cannot export any more."); `CONFLICT` with `{ stale: true }`, `{ refused: true, field }`, `{ gone: true }`, `{ edited: true }`; `NOT_READY { failing }`; `BUSY`; `BAD_REQUEST`.

- [ ] **Step 1: Write the failing test** `test/requirements-export.test.mjs`:

```js
// test/requirements-export.test.mjs — the export job (plans/requirements-a6-design.md D4–D14) in mock mode: the real callSource
// with the shim's canned answers (setMockSourceResponses for gone, edited, refused, reach failures), jira-source linked with
// two connections. No tracker, no model.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { createProfile } from '../src/core/plugin-config.mjs';
import { callSource, setMockSourceResponses, PluginOpError } from '../src/core/plugin-shim.mjs';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import {
  createFeature, getFeature, updateFeature, appendTurn, listTurns, getExportLink, getExportSetup, upsertExportSetup, setPendingExport,
} from '../src/core/requirements/store.mjs';
import { startOrientation, settled, isBusy } from '../src/core/requirements/interview.mjs';
import { markStarting, unmarkStarting } from '../src/core/requirements/starting.mjs';
import {
  saveSetup, exportOptions, exportSetupView, previewExport, runExport, forgetLink, exportView, isExporting, _resetExportCaches,
} from '../src/core/requirements/export.mjs';

useTempHome(after, 'worca-req-export-');
const prevMock = process.env.WORCA_MOCK;
process.env.WORCA_MOCK = '1';
after(() => { if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock; setMockSourceResponses(null); });

const TARGET = { ok: true, label: 'Project shop is registered' };
const SCOPE = { scopeType: 'project', scopeKey: 'shop-1' };
const seen = [];
const d = { callSource: (o) => { seen.push(o); return callSource(o); } };
const reset = () => { seen.length = 0; setMockSourceResponses(null); };
const fp = (text) => createHash('sha256').update(text).digest('hex');   // the mock shim's fingerprint
const waitFor = async (pred) => { for (let i = 0; i < 200 && !pred(); i += 1) await new Promise((r) => setTimeout(r, 5)); };

before(async () => {
  await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url)));
  createProfile('jira-source', 'acme', 'acme.atlassian.net (Cloud)');
  createProfile('jira-source', 'beta', 'jira.beta.test (Data Center)');
  _resetExportCaches();
  await saveSetup(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', project: 'SHOP', projectName: 'SHOP — Shop web',
    issueType: '10001', issueTypeName: 'Story', labels: ['worca'] }, { by: 'po' }, d);
});

const readySpec = () => ({ ...emptySpec(), goal: { text: 'Customers cancel', measure: 'fewer calls' },
  criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }, { id: 'R-po-2', text: 'Refund in 3 days' }],
  assumptions: [{ id: 'A-1', text: 'Full refund', status: 'confirmed' }] });
/** A feature that passes all six checks with TARGET. */
function readyFeature(title = 'Cancel order') {
  const f = createFeature({ ...SCOPE, title, description: 'Before it ships' });
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
  return updateFeature(f.seq, { status: 'done', criteriaSeq: 2, assumptionSeq: 1, spec: readySpec() });
}
async function exportNow(seq, body = { mode: 'create' }) {
  const p = await previewExport(seq, body, { target: TARGET }, d);
  return runExport(seq, { ...body, previewHash: p.previewHash }, { by: 'po', target: TARGET }, d);
}
const exportTurns = (seq) => listTurns(seq).filter((t) => t.kind === 'export');

test("create: the setup's connection, a marker, exactly the previewed ticket; the link and the turn are stored", async () => {
  reset();
  const f = readyFeature();
  const p = await previewExport(f.seq, { mode: 'create' }, { target: TARGET }, d);
  assert.deepEqual([p.mode, p.key, p.tracker, p.comment, p.edited, p.gone, p.link], ['create', null, 'Jira', null, false, false, null]);
  assert.deepEqual(p.ticket.labels, ['worca', `worca-${f.id}`]);
  assert.match(p.ticket.description, new RegExp(`\\nFrom Worca ${f.id} · exported \\d{1,2} [A-Z][a-z]{2} \\d{4}\\n$`));
  assert.deepEqual([p.fields.project, p.fields.issueType, p.fields.connection, p.fields.conn, p.fields.fixedLabel, p.fields.criteria, p.fields.summary],
    [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: '10001', label: 'Story' }, 'acme.atlassian.net (Cloud)',
      { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' }, `worca-${f.id}`, { target: 'description' }, 'Cancel order']);
  assert.equal(seen.filter((c) => c.op !== 'capabilities').length, 0, 'a create preview calls no tracker');
  const r = await runExport(f.seq, { mode: 'create', previewHash: p.previewHash }, { by: 'po', target: TARGET }, d);
  assert.deepEqual(r, { action: 'created', key: 'SHOP-123', url: 'https://mock.test/browse/SHOP-123' });
  const call = seen.find((c) => c.op === 'createTicket');
  assert.deepEqual([call.plugin, call.sourceId, call.profile, call.timeoutMs], ['jira-source', 'jira', 'acme', 60_000]);
  const { marker, ...sent } = call.args.ticket;
  assert.match(marker, /^rexp_[0-9a-f]{12}$/);
  assert.deepEqual(sent, p.ticket, 'only what the preview showed');
  const l = getExportLink(f.seq);
  assert.deepEqual([l.key, l.url, l.profile, l.trackerProject, l.pendingMarker, l.fingerprint, l.spec.goal.text, l.fields.issueTypeName, l.fields.labels],
    ['SHOP-123', 'https://mock.test/browse/SHOP-123', 'acme', 'SHOP', null, fp(p.ticket.description), 'Customers cancel', 'Story', ['worca']]);
  const t = exportTurns(f.seq).at(-1);
  assert.deepEqual([t.payload.action, t.payload.tracker, t.payload.key, t.payload.url, t.by, 'reason' in t.payload],
    ['created', 'Jira', 'SHOP-123', 'https://mock.test/browse/SHOP-123', 'po', false]);
  assert.equal(isExporting(f.seq), false);
});

test('only what the preview shows (D6): an edit after the preview is refused and nothing is sent; overrides go into the ticket, not the setup', async () => {
  reset();
  const f = readyFeature();
  const body = { mode: 'create', issueType: '10002', issueTypeName: 'Task', labels: ['needs review', 'worca'], priority: '3', priorityName: 'Medium' };
  const p = await previewExport(f.seq, body, { target: TARGET }, d);
  assert.deepEqual([p.ticket.issueType, p.ticket.labels, p.ticket.priority, p.fields.priority],
    ['10002', ['needs-review', 'worca', `worca-${f.id}`], '3', { value: '3', label: 'Medium' }]);
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['A new rule'] } });
  await assert.rejects(runExport(f.seq, { ...body, previewHash: p.previewHash }, { by: 'po', target: TARGET }, d),
    (e) => e.code === 'CONFLICT' && e.data.stale === true && e.message === 'The spec changed since the preview. Look at the preview again.');
  await assert.rejects(runExport(f.seq, body, { target: TARGET }, d), (e) => e.data && e.data.stale === true, 'no hash: refused');
  assert.equal(seen.filter((c) => c.op === 'createTicket').length, 0);
  assert.equal(getExportLink(f.seq), null);
  assert.equal((await exportNow(f.seq, body)).action, 'created');
  assert.deepEqual(getExportLink(f.seq).fields, { projectName: 'SHOP — Shop web', issueType: '10002', issueTypeName: 'Task',
    labels: ['needs-review', 'worca'], priority: '3', priorityName: 'Medium', criteria: { target: 'description' } });
  assert.deepEqual(getExportSetup('project', 'shop-1').labels, ['worca'], 'the setup keeps its values');
});

test('not Ready (D5): NOT_READY with the failing keys; a reason leads the description and is recorded; over 500 is refused', async () => {
  reset();
  const f = createFeature({ ...SCOPE, title: 'Half', description: 'd' });
  updateFeature(f.seq, { status: 'done', spec: { ...readySpec(), openQuestions: ['Who pays?'] } });
  await assert.rejects(previewExport(f.seq, { mode: 'create' }, { target: TARGET }, d),
    (e) => e.code === 'NOT_READY' && e.data.failing.includes('interview') && e.data.failing.includes('openQuestions'));
  await assert.rejects(previewExport(f.seq, { mode: 'create', reason: 'x'.repeat(501) }, { target: TARGET }, d), (e) => e.code === 'BAD_REQUEST');
  const why = 'The team estimates in Jira tomorrow.';
  const noFolder = { ok: false, hint: 'the folder of project shop is missing' };
  const p = await previewExport(f.seq, { mode: 'create', reason: why }, { target: noFolder }, d);
  assert.ok(p.ticket.description.startsWith(`Exported before Ready: ${why}\n\n## Goal`), 'every check can be overridden, the target too');
  await runExport(f.seq, { mode: 'create', reason: why, previewHash: p.previewHash }, { by: 'po', target: noFolder }, d);
  assert.equal(exportTurns(f.seq).at(-1).payload.reason, why);
  const ready = readyFeature();
  const q = await previewExport(ready.seq, { mode: 'create', reason: 'ignored' }, { target: TARGET }, d);
  assert.doesNotMatch(q.ticket.description, /Exported before Ready/, 'a Ready feature ignores a reason');
});

test("update (D7, D9): the link's own connection, no marker; edited is refused until forced; gone writes nothing", async () => {
  reset();
  const f = readyFeature();
  await exportNow(f.seq);
  upsertExportSetup({ ...SCOPE, ...getExportSetup('project', 'shop-1'), profile: 'beta' });   // the setup moves on; the ticket stays pinned
  try {
    updateFeature(f.seq, { spec: { ...readySpec(), rules: ['Refunds go back the way they came.'] } });
    seen.length = 0;
    const p = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
    assert.deepEqual([p.key, p.edited, p.gone, p.link.key, p.changes], ['SHOP-123', false, false, 'SHOP-123', [{ line: 'Business rules: 1 line added', id: null }]]);
    assert.deepEqual(seen.map((c) => [c.op, c.profile]), [['ticketState', 'acme']]);
    const r = await runExport(f.seq, { mode: 'update', previewHash: p.previewHash }, { by: 'po', target: TARGET }, d);
    assert.deepEqual(r, { action: 'updated', key: 'SHOP-123', url: 'https://mock.test/browse/SHOP-123' });
    const upd = seen.find((c) => c.op === 'updateTicket');
    assert.deepEqual([upd.profile, upd.args.key, 'marker' in upd.args.ticket], ['acme', 'SHOP-123', false]);
    assert.equal(getExportLink(f.seq).fingerprint, fp(p.ticket.description));
    assert.equal(exportTurns(f.seq).at(-1).payload.action, 'updated');
  } finally { upsertExportSetup({ ...SCOPE, ...getExportSetup('project', 'shop-1'), profile: 'acme' }); }
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['Rule two'] } });
  setMockSourceResponses({ ticketState: { exists: true, url: 'https://mock.test/browse/SHOP-123', fingerprint: 'edited-in-jira' } });
  const q = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
  assert.equal(q.edited, true);
  const n = listTurns(f.seq).length;
  await assert.rejects(runExport(f.seq, { mode: 'update', previewHash: q.previewHash }, { by: 'po', target: TARGET }, d),
    (e) => e.code === 'CONFLICT' && e.data.edited === true && e.message === 'SHOP-123 was edited in Jira since your last export. Updating replaces its description.');
  assert.equal(listTurns(f.seq).length, n, 'nothing recorded');
  assert.equal((await runExport(f.seq, { mode: 'update', previewHash: q.previewHash, force: true }, { by: 'po', target: TARGET }, d)).action, 'updated');
  setMockSourceResponses({ ticketState: { exists: false }, updateTicket: { gone: true } });
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['Rule three'] } });
  const g = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
  assert.equal(g.gone, true);
  const was = getExportLink(f.seq);
  await assert.rejects(runExport(f.seq, { mode: 'update', previewHash: g.previewHash, force: true }, { by: 'po', target: TARGET }, d),
    (e) => e.data.gone === true && e.message === 'SHOP-123 no longer exists in Jira.');
  assert.deepEqual(getExportLink(f.seq), was);
  // the plugin made the edit but could not read the description back: no fingerprint, never the old one (it changed)
  setMockSourceResponses({ updateTicket: { key: 'SHOP-123', url: 'https://mock.test/browse/SHOP-123', fingerprint: null } });
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['Rule four'] } });
  const nf = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
  assert.equal(nf.edited, false);
  assert.equal((await runExport(f.seq, { mode: 'update', previewHash: nf.previewHash }, { by: 'po', target: TARGET }, d)).action, 'updated');
  assert.equal(getExportLink(f.seq).fingerprint, null);
});

test('comment (D7, D8): what changed since the last export; nothing changed is refused; the spec moves on, the fingerprint stays', async () => {
  reset();
  const f = readyFeature();
  await exportNow(f.seq);
  await assert.rejects(previewExport(f.seq, { mode: 'comment' }, { target: TARGET }, d), (e) => e.message === 'Nothing changed since the last export.');
  updateFeature(f.seq, { spec: { ...readySpec(), criteria: [...readySpec().criteria, { id: 'R-po-3', text: 'Support sees who cancelled' }] } });
  const p = await previewExport(f.seq, { mode: 'comment' }, { target: TARGET }, d);
  assert.equal(p.ticket, null);
  assert.match(p.comment, /^Updated in Worca since the last export \(\d{1,2} [A-Z][a-z]{2}\)\n\nAdded R-po-3 Support sees who cancelled\n\nFrom Worca FEAT-\d+\n$/);
  const fp0 = getExportLink(f.seq).fingerprint;
  assert.equal((await runExport(f.seq, { mode: 'comment', previewHash: p.previewHash }, { by: 'po', target: TARGET }, d)).action, 'commented');
  assert.equal(seen.find((c) => c.op === 'commentTicket').args.body, p.comment);
  const l = getExportLink(f.seq);
  assert.deepEqual([l.fingerprint, l.spec.criteria.length], [fp0, 3]);
  await assert.rejects(previewExport(f.seq, { mode: 'comment' }, { target: TARGET }, d), (e) => e.message === 'Nothing changed since the last export.');
  setMockSourceResponses({ commentTicket: { gone: true } });
  updateFeature(f.seq, { spec: readySpec() });
  const q = await previewExport(f.seq, { mode: 'comment' }, { target: TARGET }, d);
  await assert.rejects(runExport(f.seq, { mode: 'comment', previewHash: q.previewHash }, { by: 'po', target: TARGET }, d), (e) => e.data.gone === true);
});

test('modes: create only without a ticket, the others only with one; a new ticket moves the link, the old key stays in the history', async () => {
  reset();
  const f = readyFeature();
  for (const mode of ['update', 'comment', 'new']) {
    await assert.rejects(previewExport(f.seq, { mode }, { target: TARGET }, d), (e) => e.message === 'This feature has no ticket yet.', mode);
  }
  await assert.rejects(previewExport(f.seq, { mode: 'split' }, { target: TARGET }, d), (e) => e.code === 'BAD_REQUEST');
  await exportNow(f.seq);
  await assert.rejects(previewExport(f.seq, { mode: 'create' }, { target: TARGET }, d), (e) => e.message === 'This feature has a ticket already. Export it again instead.');
  const r = await exportNow(f.seq, { mode: 'new' });
  assert.deepEqual([r.action, r.key, getExportLink(f.seq).key], ['new', 'SHOP-124', 'SHOP-124']);
  const v = await exportView(getFeature(f.seq), listTurns(f.seq), d);
  assert.deepEqual(v.history.map((x) => [x.action, x.key]), [['new', 'SHOP-124'], ['created', 'SHOP-123']]);
});

test("refused (D11): the plugin's sentence, nothing created, the pending marker cleared", async () => {
  reset();
  setMockSourceResponses({ createTicket: { refused: { field: 'Team', message: 'Jira needs a value for “Team” in SHOP.' } } });
  const f = readyFeature();
  await assert.rejects(exportNow(f.seq), (e) => e.code === 'CONFLICT' && e.data.refused === true && e.data.field === 'Team'
    && e.message === 'Jira needs a value for “Team” in SHOP.');
  assert.equal(getExportLink(f.seq), null);
  assert.equal(exportTurns(f.seq).length, 0);
});

test('a refused update is fixed by Change the export setup: a setup on the link\'s connection and project gives the criteria, issue type and priority', async () => {
  reset();
  const was = getExportSetup('project', 'shop-1');
  try {
    upsertExportSetup({ ...SCOPE, ...was, criteria: { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' } });
    const f = readyFeature();
    await exportNow(f.seq);
    updateFeature(f.seq, { spec: { ...readySpec(), rules: ['A new rule'] } });
    setMockSourceResponses({ updateTicket: { refused: { field: 'Acceptance Criteria',
      message: 'Jira refused “Acceptance Criteria”: Field cannot be set. It is not on the appropriate screen, or unknown.' } } });
    const p = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
    assert.equal(p.ticket.criteria.target, 'field');
    await assert.rejects(runExport(f.seq, { mode: 'update', previewHash: p.previewHash }, { by: 'po', target: TARGET }, d), (e) => e.data.refused === true);
    setMockSourceResponses(null);
    await saveSetup(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', project: 'SHOP', projectName: 'SHOP — Shop web', issueType: '10002',
      issueTypeName: 'Task', labels: ['worca'], priority: '3', priorityName: 'Medium', criteria: { target: 'description' } }, { by: 'po' }, d);
    const q = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
    assert.deepEqual([q.ticket.criteria, q.fields.criteria, q.ticket.issueType, q.ticket.priority], [{ target: 'description' }, { target: 'description' }, '10002', '3'],
      'the fresh preview has no criteria field');
    assert.match(q.ticket.description, /## Acceptance criteria/);
    assert.equal((await runExport(f.seq, { mode: 'update', previewHash: q.previewHash }, { by: 'po', target: TARGET }, d)).action, 'updated');
  } finally { upsertExportSetup({ ...SCOPE, ...was }); }
});

test('reach failures (D11): the sentence by kind, nothing recorded but the pending marker (D10, D14), no chip', async () => {
  for (const [kind, msg, want] of [['auth', 'Jira token invalid', 'Worca could not reach Jira: the API token was refused.'],
    ['timeout', 'op exceeded', 'Worca could not reach Jira: it did not answer within a minute.'],
    ['network', 'Jira unreachable: fetch failed.', 'Worca could not reach Jira: Jira unreachable: fetch failed.'],
    ['unimplemented', 'connector does not implement op "createTicket"', 'Jira cannot export any more.']]) {   // a downgraded connector
    reset();
    setMockSourceResponses({ createTicket: () => { throw new PluginOpError(kind, msg); } });
    const f = readyFeature();
    await assert.rejects(exportNow(f.seq), (e) => e.code === 'TRACKER' && e.data.kind === kind && e.message === want, kind);
    const l = getExportLink(f.seq);
    assert.deepEqual([l.key, /^rexp_[0-9a-f]{12}$/.test(l.pendingMarker)], [null, true], `${kind}: only the pending marker`);
    assert.equal(exportTurns(f.seq).length, 0);
    assert.equal((await exportView(getFeature(f.seq), listTurns(f.seq), d)).link, null, 'no chip');
  }
});

test('a lost answer (D10): the next export finds the ticket by label, marker and footer, links it and updates it; no duplicate', async () => {
  reset();
  const f = readyFeature();
  setMockSourceResponses({ createTicket: () => { throw new PluginOpError('timeout', 'exceeded'); } });
  await assert.rejects(exportNow(f.seq), (e) => e.data.kind === 'timeout');
  const marker = getExportLink(f.seq).pendingMarker;
  const label = `worca-${f.id}`;
  setMockSourceResponses({ findTicket: (a) => (a.marker === marker && a.label === label && a.project === 'SHOP'
    ? { key: 'SHOP-777', url: 'https://mock.test/browse/SHOP-777', fingerprint: 'f777', lastLine: `From Worca ${f.id} · exported 26 Oct 2026`, marker,
      labels: ['worca', label] } : null) });
  seen.length = 0;
  const r = await exportNow(f.seq);
  assert.deepEqual([r.action, r.key], ['updated', 'SHOP-777']);
  assert.deepEqual(seen.map((c) => c.op), ['findTicket', 'updateTicket'], 'no create, no state check');
  assert.deepEqual(exportTurns(f.seq).map((t) => [t.payload.action, t.payload.key]), [['linked', 'SHOP-777'], ['updated', 'SHOP-777']]);
  assert.deepEqual([getExportLink(f.seq).key, getExportLink(f.seq).pendingMarker], ['SHOP-777', null]);
});

test("findTicket's checks (D10): another install's marker, a wrong footer or a missing label is no match: the marker goes, a ticket is made", async () => {
  for (const wrong of [{ marker: 'rexp_ffffffffffff' }, { lastLine: 'From Worca FEAT-0 · exported 26 Oct 2026' }, { labels: ['worca'] }]) {
    reset();
    const f = readyFeature();
    setPendingExport(f.seq, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', trackerProject: 'SHOP', marker: 'rexp_000000000001' });
    setMockSourceResponses({ findTicket: () => ({ key: 'SHOP-777', url: 'u', fingerprint: 'f', lastLine: `From Worca ${f.id} · exported 26 Oct 2026`,
      marker: 'rexp_000000000001', labels: ['worca', `worca-${f.id}`], ...wrong }) });
    const r = await exportNow(f.seq);
    assert.deepEqual([r.action, r.key], ['created', 'SHOP-123'], JSON.stringify(wrong));
    assert.equal(exportTurns(f.seq).filter((t) => t.payload.action === 'linked').length, 0);
  }
  reset();
  const g = readyFeature();
  await exportNow(g.seq);
  seen.length = 0;
  await exportNow(g.seq, { mode: 'new' });
  assert.equal(seen.some((c) => c.op === 'findTicket'), false, 'no pending marker: no search');
});

test('one export at a time (D13); a start in flight, a round running and an archived feature are refused; a preview takes no lock', async () => {
  reset();
  const f = readyFeature();
  let release = null;
  setMockSourceResponses({ createTicket: () => new Promise((r) => { release = () => r({ key: 'SHOP-123', url: 'https://mock.test/browse/SHOP-123', fingerprint: 'x' }); }) });
  const p = await previewExport(f.seq, { mode: 'create' }, { target: TARGET }, d);
  const first = runExport(f.seq, { mode: 'create', previewHash: p.previewHash }, { by: 'po', target: TARGET }, d);
  assert.equal(isExporting(f.seq), true, 'taken before the first await');
  await assert.rejects(runExport(f.seq, { mode: 'create', previewHash: p.previewHash }, { target: TARGET }, d),
    (e) => e.code === 'BUSY' && e.message === 'Worca is already exporting this feature.');
  assert.equal((await previewExport(f.seq, { mode: 'create' }, { target: TARGET }, d)).previewHash, p.previewHash, 'a preview still answers');
  assert.throws(() => forgetLink(f.seq), (e) => e.code === 'BUSY');
  await waitFor(() => typeof release === 'function');
  release();
  await first;
  assert.equal(isExporting(f.seq), false);
  const g = readyFeature();
  markStarting(g.seq);
  try { await assert.rejects(exportNow(g.seq), (e) => e.code === 'BUSY' && e.message === 'this feature is starting a run. Try again in a moment.'); }
  finally { unmarkStarting(g.seq); }
  // a look that cannot finish until the gate opens (the pattern of requirements-start.test.mjs), so BUSY never races it
  const h = readyFeature();
  const ph = await previewExport(h.seq, { mode: 'create' }, { target: TARGET }, d);
  let open;
  const gate = new Promise((r) => { open = r; });
  const look = { runClaudeImpl: async () => { await gate; return { text: '{"spec":{},"questions":[],"done":true}' }; },
    listModels: async () => [], listProjects: async () => [], workspaceTarget: async () => null,
    openLook: async () => null, openWorkspaceLook: async () => null, onChange: () => {} };
  const job = startOrientation(h.seq, { thenRound: false }, look);
  try {
    assert.equal(isBusy(h.seq), true);
    await assert.rejects(runExport(h.seq, { mode: 'create', previewHash: ph.previewHash }, { by: 'po', target: TARGET }, d),
      (e) => e.code === 'BUSY' && e.message === 'Worca is still working on this feature. Try again in a moment.');
  } finally {
    open();
    await job;
    await settled(h.seq);
  }
  const a = readyFeature();
  const pa = await previewExport(a.seq, { mode: 'create' }, { target: TARGET }, d);
  updateFeature(a.seq, { status: 'archived' });
  await assert.rejects(runExport(a.seq, { mode: 'create', previewHash: pa.previewHash }, { target: TARGET }, d),
    (e) => e.code === 'CONFLICT' && e.message === 'this feature is archived; restore it first');
  await assert.rejects(previewExport(a.seq, { mode: 'create' }, { target: TARGET }, d), (e) => e.code === 'CONFLICT');
});

test('Forget the link (D12): the row goes, a forgot turn, nothing sent; the next export is a first export', async () => {
  reset();
  const f = readyFeature();
  assert.throws(() => forgetLink(f.seq), (e) => e.message === 'This feature has no ticket yet.');
  await exportNow(f.seq);
  seen.length = 0;
  forgetLink(f.seq, { by: 'po' });
  assert.deepEqual([seen.length, getExportLink(f.seq)], [0, null], 'nothing sent; the link is gone');
  const t = exportTurns(f.seq).at(-1);
  assert.deepEqual([t.payload.action, t.payload.key, t.by], ['forgot', 'SHOP-123', 'po']);
  assert.equal((await previewExport(f.seq, { mode: 'create' }, { target: TARGET }, d)).key, null);
  const v = await exportView(getFeature(f.seq), listTurns(f.seq), d);
  assert.deepEqual([v.link, v.history.map((x) => x.action)], [null, ['forgot', 'created']]);
});

test("exportView: the tracker's name, hasSetup, the link and its dates, doneStatus of the link's connection, history newest first", async () => {
  reset();
  const f = readyFeature();
  let v = await exportView(f, listTurns(f.seq), d);
  assert.deepEqual([v.tracker, v.canExport, v.hasSetup, v.link, v.exporting, v.history], [{ name: 'Jira' }, true, true, null, false, []]);
  await exportOptions(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', project: 'SHOP', issueType: '10001' }, d);
  assert.equal(getExportSetup('project', 'shop-1').doneStatus, 'Done', "options refresh the setup's done status");
  await exportNow(f.seq);
  v = await exportView(getFeature(f.seq), listTurns(f.seq), d);
  assert.deepEqual([v.link.key, v.link.url, v.link.tracker, v.doneStatus], ['SHOP-123', 'https://mock.test/browse/SHOP-123', 'Jira', 'Done']);
  assert.match(v.link.madeOn, /^\d{1,2} [A-Z][a-z]{2}$/);
  assert.match(v.history[0].when, /^\d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2}$/);
  assert.deepEqual([v.history[0].action, v.history[0].by, v.history[0].tracker], ['created', 'po', 'Jira']);
  appendTurn(f.seq, { kind: 'export', payload: { action: 'updated', tracker: 'Jira', key: 'SHOP-123', url: null, at: new Date().toISOString() } }, { by: 'local' });
  assert.equal((await exportView(getFeature(f.seq), listTurns(f.seq), d)).history[0].by, null, "a single-user install's 'local' names nobody");
  const archived = await exportView({ ...getFeature(f.seq), status: 'archived' }, [], d);
  assert.deepEqual([archived.tracker, archived.canExport], [{ name: 'Jira' }, false]);
  const other = await exportView({ ...f, scopeKey: 'no-setup' }, [], d);
  assert.deepEqual([other.hasSetup, other.tracker], [false, { name: 'Jira' }], 'one tracker: its name, before any setup');
});

test('saveSetup and exportOptions: the connection must be a listed tracker; a reach failure; the setup holds no config value', async () => {
  reset();
  await assert.rejects(exportOptions(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'nope' }, d),
    (e) => e.code === 'BAD_REQUEST' && e.message === 'Choose a connection from the list.');
  await assert.rejects(saveSetup(SCOPE, { plugin: 'other', sourceId: 'x', project: 'SHOP', issueType: '1' }, {}, d), (e) => e.message === 'Choose a connection from the list.');
  await assert.rejects(saveSetup(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', issueType: '1' }, {}, d), (e) => e.message === 'project is required');
  const o = await exportOptions(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'beta', project: 'SHOP' }, d);
  assert.deepEqual(o.issueTypes.map((x) => x.label), ['Story', 'Task', 'Bug']);
  setMockSourceResponses({ exportOptions: () => { throw new PluginOpError('auth', 'x'); } });
  await assert.rejects(exportOptions(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' }, d), (e) => e.code === 'TRACKER' && e.data.kind === 'auth');
  reset();
  const ws = { scopeType: 'workspace', scopeKey: 'ws-1' };
  const s = await saveSetup(ws, { plugin: 'jira-source', sourceId: 'jira', profile: 'beta', project: 'OPS', projectName: 'OPS — Operations', issueType: '10002',
    issueTypeName: 'Task', labels: ['a b', 'worca'], priority: '', criteria: { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' } }, { by: 'po' }, d);
  assert.deepEqual([s.profile, s.labels, s.priority, s.criteria, s.doneStatus],
    ['beta', ['a-b', 'worca'], null, { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' }, 'Done'], "beta's last options named Done");
  const v = await exportSetupView(ws, {}, d);
  assert.deepEqual([v.setup.trackerProject, v.trackers.length, v.defaultProfile], ['OPS', 1, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' }]);
  assert.doesNotMatch(JSON.stringify(v), /token|baseUrl|email/);
});
```

- [ ] **Step 2: Run it and see it fail.** `node tools/test.mjs test/requirements-export.test.mjs` → FAIL: `saveSetup` is not exported by `export.mjs`.

- [ ] **Step 3: The export lock.** Append to `src/core/requirements/starting.mjs`:

```js

// A6 D13: a feature being exported (between the export's first check and its stored link). Here beside `starting`, so
// start.mjs reads it without importing export.mjs.
const exporting = new Set();
/** What Start answers while the feature is being exported (BUSY). */
export const EXPORTING_MESSAGE = 'Worca is exporting this feature. Try again in a moment.';
export const markExporting = (seq) => { exporting.add(Number(seq)); };
export const unmarkExporting = (seq) => { exporting.delete(Number(seq)); };
export const isExporting = (seq) => exporting.has(Number(seq));
```

  In `src/core/requirements/spec.mjs`, the JSDoc of `RequirementsError` becomes `@param {'BAD_REQUEST'|'NOT_FOUND'|'BUSY'|'CONFLICT'|'BUDGET'|'NOT_READY'|'TOO_LARGE'|'TRACKER'} code` (TRACKER: a tracker could not be reached, A6 D11).

- [ ] **Step 4: The service.** In `src/core/requirements/export.mjs`, replace the import block with:

```js
import { randomBytes } from 'node:crypto';
import { callSource as shimCallSource } from '../plugin-shim.mjs';
import { listTaskSources } from '../sources.mjs';
import { readPluginsLock } from '../plugins-lock.mjs';
import { listProfiles } from '../plugin-config.mjs';
import { resolveProfile, listBindingsForScope } from '../source-bindings.mjs';
import { actorLabel } from '../identity.mjs';
import { tx } from '../db.mjs';
import { RequirementsError } from './spec.mjs';
import {
  requireFeature, listTurns, listAttachments, usableBrief, appendTurn, getExportSetup, upsertExportSetup, setExportSetupDoneStatus, getExportLink,
  setPendingExport, saveExportLink, clearPendingExport, deleteExportLink,
} from './store.mjs';
import { mentions } from './attachments.mjs';
import { readiness } from './ready.mjs';
import { pendingRound } from './round.mjs';
import { isBusy } from './interview.mjs';
import { REASON_MAX } from './start.mjs';
import { isStarting, STARTING_MESSAGE, markExporting, unmarkExporting, isExporting } from './starting.mjs';
import { buildTicket, exportChanges, changeSummary, renderExportComment, ticketHash, exportDate, exportTime, exportLabel, normalizeLabels } from './ticket.mjs';

export { isExporting };
```

  and append to the end of the file:

```js
// ---- the service (Task 5): setup, preview, export, Forget the link, the feature's view ----

const MODES = Object.freeze(['create', 'update', 'comment', 'new']);
const ARCHIVED = 'this feature is archived; restore it first';
const WORKING = 'Worca is still working on this feature. Try again in a moment.';
export const ALREADY_EXPORTING = 'Worca is already exporting this feature.';
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const connOf = (x) => ({ plugin: x.plugin, sourceId: x.sourceId, profile: x.profile || null });
const sameConn = (a, b) => !!a && !!b && a.plugin === b.plugin && a.sourceId === b.sourceId && (a.profile || null) === (b.profile || null);
const connKey = (c) => `${c.plugin}/${c.sourceId}/${c.profile || ''}`;
const nowOf = (d) => (d && typeof d.now === 'function' ? d.now() : new Date());
const mintMarker = () => `rexp_${randomBytes(6).toString('hex')}`;
const options = (v) => (Array.isArray(v) ? v.filter((x) => x && x.value != null).map((x) => ({ value: String(x.value), label: String(x.label ?? x.value) })) : []);

/** A source's display name ("Jira"), also for a link whose plugin can no longer export. */
function sourceName(conn) {
  try {
    const s = listTaskSources().find((x) => x.type === 'plugin' && x.plugin === conn.plugin && x.sourceId === conn.sourceId);
    return (s && s.displayName) || conn.plugin;
  } catch { return conn.plugin; }
}
/** The connection as the setup's select names it: the profile's label, else the source's name. */
function connectionLabel(conn) {
  if (!conn.profile) return sourceName(conn);
  try { return (listProfiles(conn.plugin).find((p) => p.id === conn.profile) || {}).label || conn.profile; } catch { return conn.profile; }
}

/** One op through the connection, in EXPORT_TIMEOUT_MS; any failure is D11's sentence (TRACKER, 502). An op the connector
 *  no longer has (a cached "yes", then a downgrade) says so instead of "connector does not implement op …". */
async function trackerCall(d, name, conn, op, args) {
  try {
    return await callOf(d)({ plugin: conn.plugin, sourceId: conn.sourceId, profile: conn.profile || undefined, op, args, timeoutMs: EXPORT_TIMEOUT_MS });
  } catch (err) {
    if (err && err.kind === 'unimplemented') throw new RequirementsError('TRACKER', `${name || 'The tracker'} cannot export any more.`, { kind: 'unimplemented' });
    throw new RequirementsError('TRACKER', reachSentence(name, err), { kind: (err && err.kind) || 'plugin' });
  }
}
const goneError = (key, name) => new RequirementsError('CONFLICT', `${key} no longer exists in ${name}.`, { gone: true });
const editedError = (key, name) => new RequirementsError('CONFLICT', `${key} was edited in ${name} since your last export. Updating replaces its description.`,
  { edited: true });
const refusedError = (r) => new RequirementsError('CONFLICT', String((r && r.message) || 'The tracker refused the ticket.'), { refused: true, field: (r && r.field) || null });

/** D4: the names of the files the spec mentions: the feature's files, then its scope brief's documents, each name once. */
export function mentionedFiles(f) {
  const brief = usableBrief(f.scopeType, f.scopeKey);
  const rows = [...listAttachments('feature', f.seq), ...(brief ? listAttachments('brief', brief.id) : [])];
  const out = [];
  for (const r of rows) {
    if (!r || !r.name || out.some((n) => n.toLowerCase() === r.name.toLowerCase())) continue;
    if (mentions(f.spec, r.name).length) out.push(r.name);
  }
  return out;
}

/** The setup dialog's data (§6): no tracker call but the (cached) capability probe. */
export async function exportSetupView(scope, { memberKeys = [] } = {}, d = {}) {
  const trackers = await exportTrackers(d);
  return { setup: getExportSetup(scope.scopeType, scope.scopeKey), trackers, defaultProfile: defaultConnection(scope, trackers, { memberKeys }) };
}

/** The connection a request names, when it is one of a listed tracker's (else BAD_REQUEST); its tracker. */
async function trackerFor(body, d) {
  const conn = { plugin: text(body.plugin, 64), sourceId: text(body.sourceId, 64), profile: text(body.profile, 64) || null };
  const t = (await exportTrackers(d)).find((x) => x.plugin === conn.plugin && x.sourceId === conn.sourceId);
  if (!t || !t.profiles.some((p) => (p.id || null) === conn.profile)) throw new RequirementsError('BAD_REQUEST', 'Choose a connection from the list.');
  return { conn, t };
}

/** The setup's selects (D16), each loaded as the one before it changes. Caches doneStatus per connection and refreshes the
 *  setup's when it is the setup's own connection (D15). */
export async function exportOptions(scope, body = {}, d = {}) {
  const { conn, t } = await trackerFor(body, d);
  const project = text(body.project, 100);
  const issueType = text(body.issueType, 100);
  if (issueType && !project) throw new RequirementsError('BAD_REQUEST', 'project is required');
  const r = (await trackerCall(d, t.name, conn, 'exportOptions', { ...(project ? { project } : {}), ...(issueType ? { issueType } : {}) })) || {};
  const out = {
    projects: options(r.projects),
    ...(project ? { issueTypes: options(r.issueTypes) } : {}),
    ...(project && issueType ? { priorities: options(r.priorities), criteriaFields: options(r.criteriaFields) } : {}),
    doneStatus: typeof r.doneStatus === 'string' && r.doneStatus.trim() ? r.doneStatus.trim() : null,
    ...(r.tooOld === true ? { tooOld: true } : {}),
  };
  lastDone.set(connKey(conn), out.doneStatus);
  const setup = getExportSetup(scope.scopeType, scope.scopeKey);
  if (setup && sameConn(setup, conn) && setup.doneStatus !== out.doneStatus) setExportSetupDoneStatus(scope.scopeType, scope.scopeKey, out.doneStatus);
  return out;
}

/** Save the setup (D2): a listed connection, the tracker project and issue type with their names, labels (normalised, the
 *  fixed label is per export), an optional priority, where the criteria go. Never a config value. */
export async function saveSetup(scope, body = {}, { by = null } = {}, d = {}) {
  const { conn } = await trackerFor(body, d);
  const project = text(body.project, 100);
  const issueType = text(body.issueType, 100);
  if (!project) throw new RequirementsError('BAD_REQUEST', 'project is required');
  if (!issueType) throw new RequirementsError('BAD_REQUEST', 'issueType is required');
  const priority = text(body.priority, 100) || null;
  const c = body.criteria && typeof body.criteria === 'object' ? body.criteria : {};
  const criteria = c.target === 'field' ? { target: 'field', field: text(c.field, 100), name: text(c.name, 200) || text(c.field, 100) } : { target: 'description' };
  if (criteria.target === 'field' && !criteria.field) throw new RequirementsError('BAD_REQUEST', 'criteria.field is required');
  const cur = getExportSetup(scope.scopeType, scope.scopeKey);
  const doneStatus = lastDone.has(connKey(conn)) ? lastDone.get(connKey(conn)) : (cur && sameConn(cur, conn) ? cur.doneStatus : null);
  return upsertExportSetup({ ...scope, ...conn, trackerProject: project, trackerProjectName: text(body.projectName, 200) || project, issueType,
    issueTypeName: text(body.issueTypeName, 200) || issueType, labels: normalizeLabels(Array.isArray(body.labels) ? body.labels : ['worca']),
    priority, priorityName: priority ? (text(body.priorityName, 200) || priority) : null, criteria, doneStatus }, { by });
}

/** Everything a preview and an export share (D5–D8): the mode against the link, the setup, readiness with a reason, the
 *  connection, and the ticket or comment with its hash. No tracker call. */
function planExport(f, body = {}, { target = { ok: false }, now = new Date() } = {}) {
  const mode = body.mode;
  if (!MODES.includes(mode)) throw new RequirementsError('BAD_REQUEST', 'mode must be create, update, comment or new');
  const row = getExportLink(f.seq);
  const link = row && row.key ? row : null;
  if (mode === 'create' && link) throw new RequirementsError('CONFLICT', 'This feature has a ticket already. Export it again instead.');
  if (mode !== 'create' && !link) throw new RequirementsError('CONFLICT', 'This feature has no ticket yet.');
  const setup = getExportSetup(f.scopeType, f.scopeKey);
  if ((mode === 'create' || mode === 'new') && !setup) throw new RequirementsError('CONFLICT', 'Set up the export first.');
  const turns = listTurns(f.seq);
  const pending = f.status === 'your_turn' ? pendingRound(turns) : null;
  const r = readiness({ ...f, pending }, { turns, target, files: listAttachments('feature', f.seq) });
  const failing = r.checks.filter((c) => !c.ok).map((c) => c.key);
  const why = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (failing.length) {
    if (!why) throw new RequirementsError('NOT_READY', 'This feature is not Ready. Give a reason to export it anyway.', { failing });
    if (why.length > REASON_MAX) throw new RequirementsError('BAD_REQUEST', `the reason must be at most ${REASON_MAX} characters`);
  }
  const reason = failing.length ? why : null;
  const conn = connOf(mode === 'update' || mode === 'comment' ? link : setup);
  const name = sourceName(conn);
  if (mode === 'comment') {
    const changes = exportChanges(link.spec, f.spec);
    if (!changes.length) throw new RequirementsError('CONFLICT', 'Nothing changed since the last export.');
    const comment = renderExportComment(f, changes, { since: exportDate(link.exportedAt, { year: false }), reason });
    return { mode, link, setup, conn, name, reason, changes, comment, ticket: null, sent: null, fields: null,
      previewHash: ticketHash({ mode, key: link.key, comment }) };
  }
  // update: the fields last sent (D7), except that a setup on the link's connection and tracker project gives the criteria,
  // the issue type and the priority, so Change the export setup can fix a refused update; create and new: the setup's. The
  // preview may change issue type, labels, priority (D6).
  const fromSetup = setup ? { projectName: setup.trackerProjectName, issueType: setup.issueType, issueTypeName: setup.issueTypeName, labels: setup.labels,
    priority: setup.priority, priorityName: setup.priorityName, criteria: setup.criteria } : {};
  const setupRules = mode === 'update' && setup && sameConn(setup, link) && setup.trackerProject === link.trackerProject;
  const base = mode === 'update'
    ? { ...fromSetup, ...(link.fields || {}), project: link.trackerProject,
      ...(setupRules ? { issueType: setup.issueType, issueTypeName: setup.issueTypeName, priority: setup.priority, priorityName: setup.priorityName,
        criteria: setup.criteria } : {}) }
    : { ...fromSetup, project: setup.trackerProject };
  const issueType = text(body.issueType, 100) || base.issueType;
  const issueTypeName = text(body.issueType, 100) ? (text(body.issueTypeName, 200) || issueType) : (base.issueTypeName || issueType);
  const priority = body.priority === undefined ? (base.priority || null) : (text(body.priority, 100) || null);
  const priorityName = !priority ? null : body.priority === undefined ? (base.priorityName || priority) : (text(body.priorityName, 200) || priority);
  const criteria = base.criteria && base.criteria.target === 'field' && base.criteria.field ? base.criteria : { target: 'description' };
  const ticket = buildTicket(f, { project: base.project, issueType, labels: Array.isArray(body.labels) ? body.labels : (base.labels || []), priority, criteria,
    reason, exportedOn: exportDate(now.toISOString()), mentionedFiles: mentionedFiles(f) });
  const fixed = exportLabel(f);
  const sent = { projectName: base.projectName || base.project, issueType, issueTypeName, labels: ticket.labels.filter((l) => l !== fixed), priority,
    priorityName, criteria };
  const fields = {
    conn, connection: connectionLabel(conn), project: { value: base.project, label: sent.projectName }, issueType: { value: issueType, label: issueTypeName },
    labels: ticket.labels, fixedLabel: fixed, priority: priority ? { value: priority, label: priorityName } : null,
    criteria: criteria.target === 'field' ? { target: 'field', name: criteria.name || criteria.field, items: ticket.criteria.items } : { target: 'description' },
    summary: f.title,
  };
  return { mode, link, setup, conn, name, reason, changes: link ? exportChanges(link.spec, f.spec) : [], comment: null, ticket, sent, fields,
    previewHash: ticketHash({ mode, key: link ? link.key : null, ticket }) };
}

const linkDates = (l) => ({ key: l.key, madeOn: exportDate(l.createdAt, { year: false }), lastOn: exportDate(l.exportedAt, { year: false }) });

/** POST …/export/preview (D6, D7, D9): the ticket or the comment exactly as it would be sent, its hash, what changed, and
 *  for a ticket the tracker's answer on it (edited, gone). No lock. */
export async function previewExport(seq, body = {}, { target } = {}, d = {}) {
  const f = requireFeature(seq);
  if (f.status === 'archived') throw new RequirementsError('CONFLICT', ARCHIVED);
  const plan = planExport(f, body, { target, now: nowOf(d) });
  let state = { edited: false, gone: false };
  if (plan.mode === 'update' || plan.mode === 'comment') {
    const s = await trackerCall(d, plan.name, plan.conn, 'ticketState', { key: plan.link.key });
    state = s && s.exists === false ? { edited: false, gone: true }
      : { gone: false, edited: !!(s && s.fingerprint && plan.link.fingerprint && s.fingerprint !== plan.link.fingerprint) };
  }
  return { mode: plan.mode, tracker: plan.name, key: plan.link ? plan.link.key : null, ticket: plan.ticket, comment: plan.comment,
    previewHash: plan.previewHash, changes: changeSummary(plan.changes), fields: plan.fields, link: plan.link ? linkDates(plan.link) : null, ...state };
}

/**
 * POST …/export (D6, D7, D9–D14). One export per feature at a time, taken before the first await; refused while a round or
 * look runs, while a start is in flight, and on an archived feature. The ticket or comment is rebuilt and must match the
 * preview's hash. A pending marker from an earlier create is looked for first: a ticket with the label, the marker and this
 * feature's footer is linked (an `export` turn `linked`) and the export goes on as an update of it. A create records its
 * marker before the call; any thrown failure keeps it (a lost answer), a refusal clears it. Nothing else is written on a
 * failure; a success writes the link and the turn in one transaction.
 */
export async function runExport(seq, body = {}, { by = null, target } = {}, d = {}) {
  const f = requireFeature(seq);
  if (f.status === 'archived') throw new RequirementsError('CONFLICT', ARCHIVED);
  if (isExporting(f.seq)) throw new RequirementsError('BUSY', ALREADY_EXPORTING);
  if (isBusy(f.seq)) throw new RequirementsError('BUSY', WORKING);
  if (isStarting(f.seq)) throw new RequirementsError('BUSY', STARTING_MESSAGE);
  markExporting(f.seq);
  try {
    const now = nowOf(d);
    const plan = planExport(f, body, { target, now });
    if (typeof body.previewHash !== 'string' || body.previewHash !== plan.previewHash) {
      throw new RequirementsError('CONFLICT', 'The spec changed since the preview. Look at the preview again.', { stale: true });
    }
    const label = exportLabel(f);
    const at = now.toISOString();
    const turn = (action, key, url) => appendTurn(f.seq, { kind: 'export',
      payload: { action, tracker: plan.name, key, url: url || null, at, ...(plan.reason ? { reason: plan.reason } : {}) } }, { by });
    let link = plan.link;
    let mode = plan.mode;
    let found = false;
    const row = getExportLink(f.seq);
    if (row && row.pendingMarker) {
      // D10: a first export's row holds its own connection; a pending new ticket was made through the setup's. (Accepted gap:
      // a New ticket whose answer was lost, then a setup changed to another connection, is looked for through the new one;
      // no match there means the marker goes and a ticket is made.)
      const where = row.key && plan.setup ? { conn: connOf(plan.setup), project: plan.setup.trackerProject } : { conn: connOf(row), project: row.trackerProject };
      const hit = await trackerCall(d, plan.name, where.conn, 'findTicket', { project: where.project, label, marker: row.pendingMarker });
      if (hit && typeof hit.key === 'string' && hit.key && hit.marker === row.pendingMarker && Array.isArray(hit.labels) && hit.labels.includes(label)
        && String(hit.lastLine || '').startsWith(`From Worca ${f.id} ·`)) {
        const madeAt = row.pendingAt || at;
        tx(() => {
          saveExportLink(f.seq, { ...where.conn, trackerProject: where.project, key: hit.key, url: hit.url || null, createdAt: madeAt, exportedAt: madeAt,
            spec: row.key ? row.spec : null, fields: row.key ? row.fields : plan.sent, fingerprint: hit.fingerprint || null }, { by });
          turn('linked', hit.key, hit.url);
        });
        link = getExportLink(f.seq);
        found = true;
        if (mode === 'create' || mode === 'new') mode = 'update';
      } else clearPendingExport(f.seq);
    }
    if (mode === 'create' || mode === 'new') {
      const conn = connOf(plan.setup);
      const marker = mintMarker();
      setPendingExport(f.seq, { ...conn, trackerProject: plan.setup.trackerProject, marker }, { by });
      const r = await trackerCall(d, plan.name, conn, 'createTicket', { ticket: { ...plan.ticket, marker } });   // a throw keeps the marker
      if (r && r.refused) { clearPendingExport(f.seq); throw refusedError(r.refused); }
      if (!r || typeof r.key !== 'string' || !r.key) {
        throw new RequirementsError('TRACKER', reachSentence(plan.name, { message: 'it did not name the ticket it made' }), { kind: 'protocol' });
      }
      const action = mode === 'new' ? 'new' : 'created';
      tx(() => {
        saveExportLink(f.seq, { ...conn, trackerProject: plan.setup.trackerProject, key: r.key, url: r.url || null, createdAt: at, exportedAt: at,
          spec: f.spec, fields: plan.sent, fingerprint: r.fingerprint || null }, { by });
        turn(action, r.key, r.url);
      });
      return { action, key: r.key, url: r.url || null };
    }
    const conn = connOf(link);
    if (mode === 'update') {
      if (!found && body.force !== true) {
        const s = await trackerCall(d, plan.name, conn, 'ticketState', { key: link.key });
        if (s && s.exists === false) throw goneError(link.key, plan.name);
        if (s && s.fingerprint && link.fingerprint && s.fingerprint !== link.fingerprint) throw editedError(link.key, plan.name);
      }
      const r = await trackerCall(d, plan.name, conn, 'updateTicket', { key: link.key, ticket: plan.ticket });
      if (r && r.gone) throw goneError(link.key, plan.name);
      if (r && r.refused) throw refusedError(r.refused);
      const url = (r && r.url) || link.url;
      tx(() => {
        // the description changed: a missing read-back (null) skips the edited check once, never compares with the old text
        saveExportLink(f.seq, { ...link, url, exportedAt: at, spec: f.spec, fields: plan.sent, fingerprint: (r && r.fingerprint) || null }, { by });
        turn('updated', link.key, url);
      });
      return { action: 'updated', key: link.key, url };
    }
    const r = await trackerCall(d, plan.name, conn, 'commentTicket', { key: link.key, body: plan.comment });
    if (r && r.gone) throw goneError(link.key, plan.name);
    tx(() => {
      saveExportLink(f.seq, { ...link, exportedAt: at, spec: f.spec }, { by });   // a comment leaves the fingerprint as it was (D9)
      turn('commented', link.key, link.url);
    });
    return { action: 'commented', key: link.key, url: link.url };
  } finally {
    unmarkExporting(f.seq);
  }
}

/** Forget the link (D12): the link row goes (key, URL, spec copy, fingerprint, pending marker), an `export` turn `forgot`;
 *  nothing is sent. A run already started keeps reporting to the ticket its pipeline row names. */
export function forgetLink(seq, { by = null } = {}) {
  const f = requireFeature(seq);
  if (isExporting(f.seq)) throw new RequirementsError('BUSY', ALREADY_EXPORTING);
  const row = getExportLink(f.seq);
  if (!row || !row.key) throw new RequirementsError('CONFLICT', 'This feature has no ticket yet.');
  tx(() => {
    deleteExportLink(f.seq);
    appendTurn(f.seq, { kind: 'export', payload: { action: 'forgot', tracker: sourceName(connOf(row)), key: row.key, url: row.url || null,
      at: new Date().toISOString() } }, { by });
  });
}

/** D1: what the menu names: the setup's tracker, else the scope's bound tracker, else the only one; several and none
 *  bound: a tracker without a name; none: null ("Connect a tracker…"). */
function viewTracker(f, setup, trackers) {
  if (!trackers.length) return null;
  const of = (c) => trackers.find((t) => t.plugin === c.plugin && t.sourceId === c.sourceId);
  if (setup && of(setup)) return { name: of(setup).name };
  const bound = bindingsOf(f).map(of).find(Boolean);
  if (bound) return { name: bound.name };
  return { name: trackers.length === 1 ? trackers[0].name : null };
}

/** The feature view's `export` (§6). Never throws: a failure is "no tracker". */
export async function exportView(f, turns = [], d = {}) {
  try {
    const trackers = await exportTrackers(d);
    const setup = getExportSetup(f.scopeType, f.scopeKey);
    const row = getExportLink(f.seq);
    const link = row && row.key ? row : null;
    const tracker = viewTracker(f, setup, trackers);
    return {
      tracker, canExport: !!tracker && f.status !== 'archived',
      hasSetup: !!setup && trackers.some((t) => t.plugin === setup.plugin && t.sourceId === setup.sourceId),
      link: link ? { key: link.key, url: link.url, createdAt: link.createdAt, exportedAt: link.exportedAt, ...linkDates(link), tracker: sourceName(connOf(link)) } : null,
      exporting: isExporting(f.seq),
      // Report back moves the ticket only to the status its own connection names (D15)
      doneStatus: link && setup && sameConn(setup, link) ? setup.doneStatus || null : null,
      history: (turns || []).filter((t) => t && t.kind === 'export' && t.payload).map((t) => ({ action: t.payload.action, tracker: t.payload.tracker || null,
        key: t.payload.key || null, url: t.payload.url || null, reason: t.payload.reason || null, when: exportTime(t.payload.at || t.at),
        by: actorLabel(t.by) || null }))   // 'local' (a single-user install) names nobody, as board 28
        .reverse(),
    };
  } catch (err) {
    console.error(`requirements: the export view of feature ${f && f.seq} failed:`, err && err.message ? err.message : err);
    return { tracker: null, canExport: false, hasSetup: false, link: null, exporting: false, doneStatus: null, history: [] };
  }
}
```

  `bindingsOf(scope)` (Task 3) takes `{ scopeType, scopeKey }`; a feature has both, so `bindingsOf(f)` works.

- [ ] **Step 5: Run and see it pass.** `node tools/test.mjs test/requirements-export.test.mjs` → pass. Then `node tools/test.mjs test/requirements-export-trackers.test.mjs`, `node tools/test.mjs test/requirements-start.test.mjs`, `node tools/test.mjs test/requirements-interview.test.mjs` → pass (compare a failure with `<baseline>`).

- [ ] **Step 6: Commit.**

```bash
git add src/core/requirements/starting.mjs src/core/requirements/spec.mjs src/core/requirements/export.mjs test/requirements-export.test.mjs
git commit -m "Requirements: the export service (setup, preview, create, update, comment, new ticket, duplicate guard, Forget the link)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: The API — setup, options, preview, export, Forget the link; the feature's `export`

**Files:**
- Modify: `src/core/requirements/routes.mjs` (imports; `STATUS`; `REQUIREMENTS_ROUTES`; `featureView`; the handlers)
- Modify: `src/core/requirements/interview.mjs` (`retry`'s filter, line ~585)
- Create: `test/requirements-export-api.test.mjs`

**Interfaces:**
- Consumes: Task 5's `exportSetupView`, `exportOptions`, `saveSetup`, `previewExport`, `runExport`, `forgetLink`, `exportView`; `workspaceTarget` (already imported); `checkTarget`, `targetFor`, `seqOf`, `scope`, `by`, `changed`, `onChange` (routes.mjs internals).
- Produces (HTTP, all behind `requireFlag('requirements')`, design §6):
  - `GET /api/requirements/export-setup/:scopeType/:scopeKey` → `{ setup, trackers, defaultProfile }`
  - `POST /api/requirements/export-setup/:scopeType/:scopeKey/options` `{ plugin, sourceId, profile, project?, issueType? }` → `exportOptions`' answer
  - `PUT /api/requirements/export-setup/:scopeType/:scopeKey` → `{ setup }` and a `requirements-changed` frame for each open feature of the scope (`listFeatures`, already imported)
  - `POST /api/requirements/:seq/export/preview` → `Preview`
  - `POST /api/requirements/:seq/export` → `{ action, key, url, feature, turns }` and a `requirements-changed` frame
  - `DELETE /api/requirements/:seq/export/link` → the feature view and a frame
  - `GET /api/requirements/:seq` → `feature.export` (`ExportView`)
  - status: `TRACKER` → 502 `{ error, kind }`; `CONFLICT` → 409 with `stale` / `refused` + `field` / `gone` / `edited`; `NOT_READY` → 409 `{ error, failing }`
- The export routes come before the `/:seq` routes in `REQUIREMENTS_ROUTES`, as the brief's do.

- [ ] **Step 1: Write the failing test** `test/requirements-export-api.test.mjs`:

```js
// test/requirements-export-api.test.mjs — the export routes (plans/requirements-a6-design.md §6) on a bare express app with the
// requirements routes, in mock mode with jira-source linked; frames, statuses, the feature's `export`, no config value out, and
// an export turn never hiding the error line or changing what Try again runs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { createProfile, writePluginConfig } from '../src/core/plugin-config.mjs';
import { setMockSourceResponses, PluginOpError } from '../src/core/plugin-shim.mjs';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import { createFeature, updateFeature, appendTurn } from '../src/core/requirements/store.mjs';
import { settled } from '../src/core/requirements/interview.mjs';
import { registerRequirementsRoutes, REQUIREMENTS_ROUTES } from '../src/core/requirements/routes.mjs';
import { _resetExportCaches } from '../src/core/requirements/export.mjs';

useTempHome(after, 'worca-req-export-api-');
const prev = { flags: process.env.WORCA_FLAGS, mock: process.env.WORCA_MOCK };
process.env.WORCA_FLAGS = 'requirements';
process.env.WORCA_MOCK = '1';
const SECRET = 'tok-SECRET-1234';
const frames = [];
let srv; let base; let projKey; let projDir;

before(async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  projDir = mkdtempSync(join(tmpdir(), 'req-export-api-shop-'));
  projKey = (await addProject({ name: 'shop', path: projDir })).find((p) => p.name === 'shop').key;
  await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url)));
  createProfile('jira-source', 'acme', 'acme.atlassian.net (Cloud)');
  writePluginConfig('jira-source', [{ key: 'baseUrl', type: 'text' }, { key: 'email', type: 'text' }, { key: 'token', type: 'text', secret: true }],
    { baseUrl: 'https://acme.atlassian.net', email: 'ann@acme.test', token: SECRET }, 'acme');
  _resetExportCaches();
  const app = express();
  app.use(express.json());
  registerRequirementsRoutes(app, { broadcast: (f) => frames.push(f), deps: { startRun: async () => ({ status: 200, body: {} }) } });
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  for (const [k, v] of [['WORCA_FLAGS', prev.flags], ['WORCA_MOCK', prev.mock]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setMockSourceResponses(null);
  rmSync(projDir, { recursive: true, force: true });
});

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const P = '/api/requirements';
const CONN = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const setupPath = () => `${P}/export-setup/project/${projKey}`;
const readySpec = () => ({ ...emptySpec(), goal: { text: 'Customers cancel', measure: 'fewer calls' }, criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }],
  assumptions: [{ id: 'A-1', text: 'Full refund', status: 'confirmed' }] });
function readyFeature() {
  const f = createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Cancel order', description: 'Before it ships' });
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
  return updateFeature(f.seq, { status: 'done', criteriaSeq: 1, assumptionSeq: 1, spec: readySpec() });
}
const saveSetup = () => call('PUT', setupPath(), { ...CONN, project: 'SHOP', projectName: 'SHOP — Shop web', issueType: '10001', issueTypeName: 'Story', labels: ['worca'] });

test('the route table: the export routes, the setup ones before GET /api/requirements', () => {
  const keys = REQUIREMENTS_ROUTES.map((r) => `${r.method} ${r.path}`);
  for (const k of [`GET ${P}/export-setup/:scopeType/:scopeKey`, `PUT ${P}/export-setup/:scopeType/:scopeKey`, `POST ${P}/export-setup/:scopeType/:scopeKey/options`,
    `POST ${P}/:seq/export/preview`, `POST ${P}/:seq/export`, `DELETE ${P}/:seq/export/link`]) assert.ok(keys.includes(k), k);
  assert.ok(keys.indexOf(`GET ${P}/export-setup/:scopeType/:scopeKey`) < keys.indexOf(`GET ${P}`));
});

test('GET export-setup: the trackers, no setup yet, the default connection; never a config value', async () => {
  const r = await call('GET', setupPath());
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.setup, r.json.trackers.map((t) => [t.plugin, t.name, t.profiles]), r.json.defaultProfile],
    [null, [['jira-source', 'Jira', [{ id: 'acme', label: 'acme.atlassian.net (Cloud)' }]]], CONN]);
  assert.doesNotMatch(JSON.stringify(r.json), new RegExp(`${SECRET}|acme\\.atlassian\\.net"|ann@acme`), 'no token, URL or email');
  assert.equal((await call('GET', `${P}/export-setup/project/nope`)).status, 400, 'an unknown project');
});

test("POST options: the tracker's answer; an unknown connection is 400; a reach failure is 502 with the sentence and its kind", async () => {
  const r = await call('POST', `${setupPath()}/options`, { ...CONN, project: 'SHOP', issueType: '10001' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.projects.length, r.json.issueTypes.length, r.json.priorities.length, r.json.criteriaFields.length, r.json.doneStatus], [2, 3, 4, 2, 'Done']);
  assert.equal((await call('POST', `${setupPath()}/options`, { ...CONN, profile: 'nope' })).status, 400);
  setMockSourceResponses({ exportOptions: () => { throw new PluginOpError('auth', 'Jira token invalid'); } });
  try {
    const bad = await call('POST', `${setupPath()}/options`, CONN);
    assert.deepEqual([bad.status, bad.json], [502, { kind: 'auth', error: 'Worca could not reach Jira: the API token was refused.' }]);
  } finally { setMockSourceResponses(null); }
});

test('PUT setup, preview, export: 200 with the feature (chip data), a frame, the export turn; Forget the link', async () => {
  assert.equal((await saveSetup()).status, 200);
  const f = readyFeature();
  frames.length = 0;
  assert.equal((await saveSetup()).status, 200);
  assert.ok(frames.some((x) => x.type === 'requirements-changed' && x.seq === f.seq), "a saved setup tells the scope's open features");
  let v = (await call('GET', `${P}/${f.seq}`)).json.feature.export;
  assert.deepEqual([v.tracker, v.canExport, v.hasSetup, v.link], [{ name: 'Jira' }, true, true, null]);
  const p = await call('POST', `${P}/${f.seq}/export/preview`, { mode: 'create' });
  assert.equal(p.status, 200);
  assert.match(p.json.previewHash, /^[0-9a-f]{64}$/);
  frames.length = 0;
  const x = await call('POST', `${P}/${f.seq}/export`, { mode: 'create', previewHash: p.json.previewHash });
  assert.equal(x.status, 200, JSON.stringify(x.json));
  assert.deepEqual([x.json.action, x.json.key, x.json.url], ['created', 'SHOP-123', 'https://mock.test/browse/SHOP-123']);
  assert.deepEqual([x.json.feature.export.link.key, x.json.turns.at(-1).kind], ['SHOP-123', 'export']);
  assert.deepEqual(frames, [{ type: 'requirements-changed', seq: f.seq }]);
  assert.doesNotMatch(JSON.stringify(x.json), new RegExp(SECRET));
  frames.length = 0;
  const g = await call('DELETE', `${P}/${f.seq}/export/link`);
  assert.equal(g.status, 200);
  assert.deepEqual([g.json.feature.export.link, g.json.feature.export.history.map((h) => h.action)], [null, ['forgot', 'created']]);
  assert.deepEqual(frames, [{ type: 'requirements-changed', seq: f.seq }]);
  assert.equal((await call('DELETE', `${P}/${f.seq}/export/link`)).status, 409);
});

test('statuses: NOT_READY with the failing keys, stale, refused, gone; nothing written on any', async () => {
  await saveSetup();
  const half = createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Half', description: 'd' });
  const nr = await call('POST', `${P}/${half.seq}/export/preview`, { mode: 'create' });
  assert.deepEqual([nr.status, nr.json.failing.includes('interview')], [409, true]);
  const f = readyFeature();
  const p = await call('POST', `${P}/${f.seq}/export/preview`, { mode: 'create' });
  const stale = await call('POST', `${P}/${f.seq}/export`, { mode: 'create', previewHash: 'nope' });
  assert.deepEqual([stale.status, stale.json.stale, stale.json.error], [409, true, 'The spec changed since the preview. Look at the preview again.']);
  setMockSourceResponses({ createTicket: { refused: { field: 'Team', message: 'Jira needs a value for “Team” in SHOP.' } } });
  const ref = await call('POST', `${P}/${f.seq}/export`, { mode: 'create', previewHash: p.json.previewHash });
  assert.deepEqual([ref.status, ref.json.refused, ref.json.field, ref.json.error], [409, true, 'Team', 'Jira needs a value for “Team” in SHOP.']);
  setMockSourceResponses(null);
  await call('POST', `${P}/${f.seq}/export`, { mode: 'create', previewHash: p.json.previewHash });
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['New rule'] } });
  setMockSourceResponses({ ticketState: { exists: false }, updateTicket: { gone: true } });
  try {
    const u = await call('POST', `${P}/${f.seq}/export/preview`, { mode: 'update' });
    assert.deepEqual([u.status, u.json.gone], [200, true]);
    const gone = await call('POST', `${P}/${f.seq}/export`, { mode: 'update', previewHash: u.json.previewHash, force: true });
    assert.deepEqual([gone.status, gone.json.gone, gone.json.error], [409, true, 'SHOP-123 no longer exists in Jira.']);
  } finally { setMockSourceResponses(null); }
});

test('an export turn never hides the error line, and Try again still re-runs the job the error names (§3)', async () => {
  const f = readyFeature();
  appendTurn(f.seq, { kind: 'error', payload: { code: 'TIMEOUT', message: 'The round took too long. Try again.', job: 'round' } });
  appendTurn(f.seq, { kind: 'export', payload: { action: 'created', tracker: 'Jira', key: 'SHOP-9', url: 'u', at: new Date().toISOString() } });
  const v = (await call('GET', `${P}/${f.seq}`)).json;
  assert.equal(v.feature.lastError, 'The round took too long. Try again.');
  const r = await call('POST', `${P}/${f.seq}/retry`, {});
  assert.equal(r.status, 202, JSON.stringify(r.json));
  await settled(f.seq);
});
```

- [ ] **Step 2: Run it and see it fail.** `node tools/test.mjs test/requirements-export-api.test.mjs` → FAIL: the route table has no export routes; `feature.export` is undefined.

- [ ] **Step 3: The routes.** In `src/core/requirements/routes.mjs`:
  - Import: `import { exportSetupView, exportOptions, saveSetup, previewExport, runExport, forgetLink, exportView } from './export.mjs';`
  - `STATUS` gains `TRACKER: 502`:

```js
const STATUS = Object.freeze({ BAD_REQUEST: 400, NOT_FOUND: 404, BUSY: 409, CONFLICT: 409, BUDGET: 409, NOT_READY: 409, TOO_LARGE: 413, TRACKER: 502 });
```

  - In `REQUIREMENTS_ROUTES`, right before `['GET', P], ['POST', P],` add:

```js
  // A6 §6: the export setup of a project or workspace, before the /:seq routes
  ['GET', `${P}/export-setup/:scopeType/:scopeKey`], ['PUT', `${P}/export-setup/:scopeType/:scopeKey`],
  ['POST', `${P}/export-setup/:scopeType/:scopeKey/options`],
```

    and right after `['POST', `${P}/:seq/start`], ['POST', `${P}/:seq/revert`],` add:

```js
  ['POST', `${P}/:seq/export/preview`], ['POST', `${P}/:seq/export`], ['DELETE', `${P}/:seq/export/link`],
```

  - In `featureView`, replace

```js
  const last = turns.filter((t) => t.kind !== 'file').at(-1);   // A8: a file's turns never hide the error line
```

    with

```js
  const last = turns.filter((t) => t.kind !== 'file' && t.kind !== 'export').at(-1);   // A8 / A6: never hide the error line
```

    and in its returned `feature` object replace the last line `      resetPeriod: resetPeriod() },` with

```js
      resetPeriod: resetPeriod(),
      export: await exportView(f, turns, d) },   // A6 §6: the menu, the chip, the History card, Report back (never throws)
```
  - In `handlers`, right before `[`GET ${P}`]: async (req, res) => {`, add:

```js
    // ---- A6: export to a tracker (plans/requirements-a6-design.md §6) ----
    [`GET ${P}/export-setup/:scopeType/:scopeKey`]: async (req, res) => {
      await checkTarget(...scope(req));
      res.json(await exportSetupView({ scopeType: req.params.scopeType, scopeKey: req.params.scopeKey }, { memberKeys: await memberKeysOf(...scope(req)) }, d));
    },
    [`PUT ${P}/export-setup/:scopeType/:scopeKey`]: async (req, res) => {
      await checkTarget(...scope(req));
      const s = { scopeType: req.params.scopeType, scopeKey: req.params.scopeKey };
      const setup = await saveSetup(s, req.body || {}, { by: by(req) }, d);
      for (const x of listFeatures(s)) onChange(x.seq);   // the scope's open pages learn hasSetup and the tracker's name
      res.json({ setup });
    },
    [`POST ${P}/export-setup/:scopeType/:scopeKey/options`]: async (req, res) => {
      await checkTarget(...scope(req));
      res.json(await exportOptions({ scopeType: req.params.scopeType, scopeKey: req.params.scopeKey }, req.body || {}, d));
    },
```

    and right after the `[`POST ${P}/:seq/revert`]` handler add:

```js
    [`POST ${P}/:seq/export/preview`]: async (req, res) => {
      const seq = seqOf(req);
      res.json(await previewExport(seq, req.body || {}, { target: await targetFor(requireFeature(seq)) }, d));
    },
    [`POST ${P}/:seq/export`]: async (req, res) => {
      const seq = seqOf(req);
      const target = await targetFor(requireFeature(seq));
      const r = await runExport(seq, req.body || {}, { by: by(req), target }, d);   // the export lock is taken inside, before its first await
      onChange(seq);
      res.json({ ...r, ...(await featureView(seq, d)) });
    },
    [`DELETE ${P}/:seq/export/link`]: async (req, res) => {
      const seq = seqOf(req);
      forgetLink(seq, { by: by(req) });
      await changed(res, seq);
    },
```

  - Above `registerRequirementsRoutes`, add:

```js
/** A workspace's member projects (D2: their source bindings decide the default connection when they agree); [] otherwise. */
async function memberKeysOf(scopeType, scopeKey) {
  if (scopeType !== 'workspace') return [];
  try { return (((await workspaceTarget(scopeKey)) || {}).members || []).map((m) => m.projectKey).filter(Boolean); } catch { return []; }
}
```

- [ ] **Step 4: Try again's filter.** In `src/core/requirements/interview.mjs` `retry`, replace

```js
  const turns = listTurns(seq).filter((t) => t.kind !== 'file');   // A8: a file's turns never hide the error Try again answers
```

  with

```js
  // A8 / A6: a file's or an export's turns never hide the error Try again answers
  const turns = listTurns(seq).filter((t) => t.kind !== 'file' && t.kind !== 'export');
```

- [ ] **Step 5: Run and see it pass.** `node tools/test.mjs test/requirements-export-api.test.mjs` → pass. Then the route-table and flag-off walk: `node tools/test.mjs test/requirements-api.test.mjs` (its `fill()` already substitutes `:scopeType/:scopeKey` and `:seq`, so the six routes are walked with the flag off), and `node tools/test.mjs test/requirements-start.test.mjs`, `node tools/test.mjs test/requirements-attachments-api.test.mjs`, `node tools/test.mjs test/requirements-brief-api.test.mjs` → pass (compare a failure with `<baseline>`).

- [ ] **Step 6: Commit.**

```bash
git add src/core/requirements/routes.mjs src/core/requirements/interview.mjs test/requirements-export-api.test.mjs
git commit -m "Requirements: export API routes and the feature's export view" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Start with Report back — a run started from an exported feature reports to its ticket

**Files:**
- Modify: `src/core/requirements/start.mjs` (imports; `startFeature`)
- Modify: `src/core/requirements/routes.mjs` (the start handler passes `reportBack`)
- Modify: `ui/server.mjs` (`invokeStartRun` ~line 3739; `startRunHandler` near `roundOf` ~line 2862; the workspace `createOrchestratorFor` that starts the run ~line 3042 and the project one ~line 3215)
- Modify: `src/core/run-harness.mjs` (the `createPipeline` call ~line 1538)
- Modify: `test/requirements-start.test.mjs`, `test/requirements-run-link.test.mjs`

**Interfaces:**
- Consumes: `getExportLink` (store.mjs); `isExporting`, `EXPORTING_MESSAGE` (starting.mjs); `reportResultForPipeline` (sources.mjs, unchanged); `readPluginState` (plugin-config.mjs; the mock shim records `lastReport` there).
- Produces:
  - `startFeature(seq, { reason, workflowId, sourceBranch, reportBack }, { by }, deps)`: with a linked ticket and `reportBack !== false`, `deps.startRun(body, { runId, startedBy, extrasFiles?, reportTo })` where `reportTo = { plugin, sourceId, profile, taskId: <key>, url, title: <feature title>, inputs: { writeBack: 'yes' } }` (the link's own connection); `reportBack` not a boolean → BAD_REQUEST "reportBack must be true or false"; while exporting → BUSY `EXPORTING_MESSAGE`.
  - `POST /api/requirements/:seq/start` accepts `{ reportBack? }`.
  - `invokeStartRun(body, internal, { …, reportTo = null })` → `req._reportTo` (in-process only) → `createOrchestratorFor({ …, reportTo })` for project and workspace starts.
  - The run harness: with `this.opts.reportTo` and a source that is not a plugin, the pipeline row gets `source_type 'plugin'` and `source_ref` = `{ plugin, sourceId, taskId, profile, inputs, url, title }`; the prompt is still the spec.

- [ ] **Step 1: Write the failing tests.** Append to `test/requirements-start.test.mjs` (its imports gain `saveExportLink` from the store and `markExporting, unmarkExporting` from `../src/core/requirements/starting.mjs`):

```js
// ---- A6 D15: Report back ----
const linkTicket = (seq) => saveExportLink(seq, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', trackerProject: 'SHOP', key: 'SHOP-123',
  url: 'https://acme.test/browse/SHOP-123', createdAt: '2026-10-26T10:42:00.000Z', exportedAt: '2026-10-26T10:42:00.000Z', spec: readySpec(), fingerprint: 'f' });

test('A6 D15: a feature with a ticket reports back by default: reportTo names the link\'s own connection and turns write-back on', async () => {
  reset();
  const f = readyFeature({ title: 'Report me' });
  linkTicket(f.seq);
  const r = await call('POST', `/api/requirements/${f.seq}/start`, {});
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(calls[0].opts.reportTo, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', taskId: 'SHOP-123',
    url: 'https://acme.test/browse/SHOP-123', title: 'Report me', inputs: { writeBack: 'yes' } });
  assert.equal(calls[0].body.promptMarkdown.includes('# FEAT-'), true, 'the task is still the spec');
});

test('A6 D15: reportBack false sends no reportTo; no ticket sends none; a non-boolean is 400', async () => {
  reset();
  const f = readyFeature({ title: 'Quiet' });
  linkTicket(f.seq);
  assert.equal((await call('POST', `/api/requirements/${f.seq}/start`, { reportBack: false })).status, 201);
  assert.equal('reportTo' in calls[0].opts, false);
  reset();
  const g = readyFeature({ title: 'No ticket' });
  assert.equal((await call('POST', `/api/requirements/${g.seq}/start`, { reportBack: true })).status, 201);
  assert.equal('reportTo' in calls[0].opts, false);
  reset();
  const h = readyFeature({ title: 'Bad flag' });
  const bad = await call('POST', `/api/requirements/${h.seq}/start`, { reportBack: 'yes' });
  assert.deepEqual([bad.status, bad.json.error, calls.length], [400, 'reportBack must be true or false', 0]);
});

test('A6 D13: Start is refused while the feature is being exported', async () => {
  reset();
  const f = readyFeature({ title: 'Exporting' });
  markExporting(f.seq);
  try {
    const r = await call('POST', `/api/requirements/${f.seq}/start`, {});
    assert.deepEqual([r.status, r.json.error, calls.length], [409, 'Worca is exporting this feature. Try again in a moment.', 0]);
  } finally { unmarkExporting(f.seq); }
});
```

  Append to `test/requirements-run-link.test.mjs` (its imports gain `import { fileURLToPath } from 'node:url';`):

```js
// ---- A6 D15: a run started from an exported feature is linked to the ticket the way a run started from a ticket is ----
test('server: Start with Report back makes a plugin pipeline row; write-back reports to the ticket (mock); _reportTo from HTTP is ignored', async () => {
  const { linkPlugin } = await import('../src/core/plugin-store.mjs');
  const { createProfile, readPluginState } = await import('../src/core/plugin-config.mjs');
  const { reportResultForPipeline } = await import('../src/core/sources.mjs');
  const { getDb } = await import('../src/core/db.mjs');
  const { emptySpec } = await import('../src/core/requirements/spec.mjs');
  await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url)));
  createProfile('jira-source', 'acme', 'acme.atlassian.net (Cloud)');
  const spec = { ...emptySpec(), goal: { text: 'Cancel', measure: 'fewer calls' }, criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }] };
  const f = store.createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Report back', description: 'd' });
  store.appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
  store.updateFeature(f.seq, { status: 'done', criteriaSeq: 1, spec });
  store.saveExportLink(f.seq, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', trackerProject: 'SHOP', key: 'SHOP-123',
    url: 'https://mock.test/browse/SHOP-123', createdAt: new Date().toISOString(), exportedAt: new Date().toISOString(), spec, fingerprint: 'f' });
  const s = await call('POST', `/api/requirements/${f.seq}/start`, {});
  assert.equal(s.status, 201, JSON.stringify(s.json));
  let runId = s.json.runId;
  try {
    const pid = await waitFor(() => mod.runs.get(runId)?.orch?.pipeline?.id, 10000, 'the pipeline');
    const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(pid);
    assert.equal(row.source_type, 'plugin');
    const ref = JSON.parse(row.source_ref);
    assert.deepEqual([ref.plugin, ref.sourceId, ref.profile, ref.taskId, ref.url, ref.inputs], ['jira-source', 'jira', 'acme', 'SHOP-123',
      'https://mock.test/browse/SHOP-123', { writeBack: 'yes' }]);
    const out = await reportResultForPipeline({ ...row, status: 'done' }, { results: null, branch: null, prUrl: null });
    assert.deepEqual(out, { ok: true });
    const last = JSON.parse(readPluginState('jira-source', 'acme').lastReport);
    assert.deepEqual([last.id, last.status, last.inputs], ['SHOP-123', 'completed', { writeBack: 'yes' }]);
  } finally { await stopRun(runId); }
  // a body's _reportTo from HTTP is never read: the run stays a markdown run
  const r = await call('POST', '/api/run', { projectDir: projDir, promptMarkdown: '# Hello\n\nA run.', title: 'Plain', workflowId: 'wf_auto',
    _reportTo: { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', taskId: 'SHOP-1', inputs: { writeBack: 'yes' } } });
  runId = r.json.runId || r.json.id;
  try {
    const pid = await waitFor(() => mod.runs.get(runId)?.orch?.pipeline?.id, 10000, 'the plain pipeline');
    assert.equal(getDb().prepare('SELECT source_type FROM pipelines WHERE id = ?').get(pid).source_type, 'markdown');
  } finally { await stopRun(runId); }
});

test('server: the browser cannot drive an export op (D18): /api/sources/call refuses createTicket', async () => {
  const r = await call('POST', '/api/sources/call', { plugin: 'jira-source', sourceId: 'jira', op: 'createTicket', profile: 'acme', args: { ticket: {} } });
  assert.deepEqual([r.status, r.json.error], [400, 'op "createTicket" is not allowed for this source']);
});
```

  (`stopRun`, `waitFor`, `call`, `store`, `mod`, `projKey`, `projDir` are the file's own; the second test runs after the first, which linked the plugin.)

- [ ] **Step 2: Run them and see them fail.** `node tools/test.mjs test/requirements-start.test.mjs` → FAIL (`reportTo` is undefined; the exporting feature starts). `node tools/test.mjs test/requirements-run-link.test.mjs` → FAIL (`source_type` is `markdown`).

- [ ] **Step 3: `startFeature`.** In `src/core/requirements/start.mjs`:
  - the store import gains `getExportLink`; replace `import { markStarting, unmarkStarting, isStarting } from './starting.mjs';` with `import { markStarting, unmarkStarting, isStarting, isExporting, EXPORTING_MESSAGE } from './starting.mjs';`
  - the signature becomes `export async function startFeature(seq, { reason, workflowId, sourceBranch, reportBack } = {}, { by = null } = {}, deps = {}) {` and its JSDoc gains: ` * A6 D15: with a linked ticket and reportBack not false, the run is linked to it (reportTo, in-process only): the result,
 * the pull request link and a status move go back through the existing write-back. Refused while the feature is exported (D13).` with the input type `{ reason?:string, workflowId?:string, sourceBranch?:string, reportBack?:boolean }` and the `startRun` opts type gaining `reportTo?:object`.
  - right after the `isStarting` refusal add:

```js
  if (isExporting(f.seq)) throw new RequirementsError('BUSY', EXPORTING_MESSAGE);
  if (reportBack !== undefined && typeof reportBack !== 'boolean') throw new RequirementsError('BAD_REQUEST', 'reportBack must be true or false');
```

  - right after `const runId = newRunId();` add:

```js
    // A6 D15: read once, here: a link forgotten later leaves this run reporting to the ticket its pipeline row names
    const link = getExportLink(f.seq);
    const reportTo = link && link.key && reportBack !== false ? { plugin: link.plugin, sourceId: link.sourceId, profile: link.profile || null,
      taskId: link.key, url: link.url || null, title: f.title, inputs: { writeBack: 'yes' } } : null;   // writeBack: jira-source's reserved "on"
```

  - the `startRun` call becomes:

```js
    const res = await startRun(body, { runId, startedBy: by,
      ...(sent.length ? { extrasFiles: sent.map(({ id, name, path, sha256 }) => ({ id, name, path, sha256 })) } : {}),
      ...(reportTo ? { reportTo } : {}) });
```

  In `src/core/requirements/routes.mjs`, the start handler's call becomes:

```js
      const r = await startFeature(seq, { reason: b.reason, workflowId: b.workflowId, sourceBranch: b.sourceBranch, reportBack: b.reportBack },
        { by: by(req) }, { startRun: d.startRun, target: await targetFor(f) });
```

- [ ] **Step 4: The server and the harness.** In `ui/server.mjs`:
  - `invokeStartRun`'s signature becomes `async function invokeStartRun(body, internal, { startedBy = null, runId = null, prWatchRunId = null, roundOf = null, extrasFiles = null, reportTo = null } = {}) {`, its JSDoc gains "A6 D15: `reportTo` (a requirements start's ticket) is handed over as req._reportTo.", and the `startRunHandler` call inside `run` becomes:

```js
    await startRunHandler({ body, headers: {}, _internal: internal, _startedBy: startedBy, _runId: id,
      _prWatchRunId: prWatchRunId, ...(roundOf ? { _roundOf: roundOf } : {}), ...(extrasPaths ? { _extrasPaths: extrasPaths } : {}),
      ...(reportTo ? { _reportTo: reportTo } : {}) }, res);
```

  - In `startRunHandler`, right after the `const roundOf = …` line add:

```js
    // A6 D15: a requirements start's ticket (Report back). Set in-process by invokeStartRun only, never from HTTP, like _roundOf.
    const reportTo = req._reportTo && typeof req._reportTo === 'object' && typeof req._reportTo.plugin === 'string'
      && typeof req._reportTo.taskId === 'string' ? req._reportTo : null;
```

  - In the workspace `orch = await createOrchestratorFor({ workspace: { … }, prompt: effectivePrompt, …` (the one that starts the run, not the `probe` inside `if (sched)`) and in the project `orch = await createOrchestratorFor({ projectDir, workMode, …`, add after the `...(req._prWatchRunId ? { prWatchRunId: req._prWatchRunId } : {}),` line:

```js
        ...(reportTo ? { reportTo } : {}),   // A6 D15: the pipeline row names the ticket, so write-back reports to it
```

  In `src/core/run-harness.mjs`, right before `this.pipeline = await createPipeline(this.projectDir, {` add:

```js
      // A6 D15 (Report back): a run started from an exported feature carries its ticket. Its task stays the spec; only the
      // row says plugin, with the same source_ref a run started from that ticket would have, so write-back reports to it.
      const reportTo = source.type !== 'plugin' && this.opts.reportTo && typeof this.opts.reportTo === 'object' ? this.opts.reportTo : null;
      const reportMeta = reportTo ? { plugin: reportTo.plugin, sourceId: reportTo.sourceId, taskId: reportTo.taskId, profile: reportTo.profile || null,
        inputs: reportTo.inputs && typeof reportTo.inputs === 'object' ? reportTo.inputs : null, url: reportTo.url ?? null, title: reportTo.title ?? null } : null;
```

  and in the `createPipeline` options replace

```js
        sourceType: source.type,
        sourceMeta: input.sourceMeta || null,
```

  with

```js
        sourceType: reportMeta ? 'plugin' : source.type,
        sourceMeta: input.sourceMeta || reportMeta,
```

- [ ] **Step 5: Run and see them pass.** `node tools/test.mjs test/requirements-start.test.mjs`, `node tools/test.mjs test/requirements-run-link.test.mjs` → pass. Then the files around the run handler and write-back: `node tools/test.mjs test/writeback.test.mjs`, `node tools/test.mjs test/sources.test.mjs`, `node tools/test.mjs test/metrics-record.test.mjs` → pass (a plugin row with a `source_ref` is counted as a ticket-sourced run by `readSource` unchanged; compare a failure with `<baseline>`).

- [ ] **Step 6: Commit.**

```bash
git add src/core/requirements/start.mjs src/core/requirements/routes.mjs ui/server.mjs src/core/run-harness.mjs test/requirements-start.test.mjs test/requirements-run-link.test.mjs
git commit -m "Requirements: Start with Report back links the run to the exported ticket" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: The page — the Export menu's tracker items, Connect a tracker, the export setup (board 26)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (state; `openModal` / `closeDialog`; `header`; a new A6 section before `// A repaint from the feature on screen`)
- Modify: `ui/public/style.css` (inside the Requirements block, right before `/* ── marketplace P3 ── */`)
- Create: `test/requirements-view-export.test.mjs`

**Interfaces:**
- Consumes: `feature.export` (Task 6: `{ tracker: { name }|null, canExport, hasSetup, link, exporting, doneStatus, history }`); `GET/PUT /api/requirements/export-setup/:scopeType/:scopeKey`, `POST …/options` (Task 6); the page's `h`, `icon`, `ICONS`, `api`, `errText`, `menu`, `menuItem`, `openModal`, `closeDialog`, `targetName`, `paint`, `host`, `dialog`.
- Produces (inside `createRequirementsView`, used by Tasks 9 and 10):
  - `dlgGen` (bumped by every `openModal` and `closeDialog`) and `live(g) → boolean`
  - `openModal(card, { trigger, first, canClose, page = false })`: with `page` the wrap gets `req-dlg-sheet` and every other child of `<body>` is inert until `closeDialog`; `dialog.canClose` is kept; the Tab trap skips controls hidden by CSS and wraps Shift+Tab from the dialog's title (an export dialog's `first`, `tabindex="-1"`)
  - `xOf(f)`, `linkOf(f)`, `trackerName(f) → 'Jira' | 'a tracker' | null`, `exportUrl(f, path)`, `setupUrl(f, path)`, `exportTrigger()`
  - `exportSelect({ id, ui, list, value, onchange, label, disabled, describedBy })`, `exportField(labelFor, labelKids, control, hint, hintId)`, `labelsField({ id, ui, labels, fixed, onChange(next, focusUi) })`, `backButton(f)`
  - `exportItems(f)` (the menu's items), `exportArchNote(f)` (the archived item's description, an `sr-only` node outside `role="menu"`), `openConnect(trigger)`, `openSetup(f, { trigger, then })`, `startExport(f, trigger)`, `continueExport(f, trigger)` (Task 9 replaces its body)
  - `data-ui`: `mi-export`, `mi-export-setup`, `mi-connect`, `connect-close`, `connect-market`, `setup-conn`, `setup-project`, `setup-type`, `setup-lab-in`, `setup-lab-x-<i>`, `setup-prio`, `setup-crit-desc`, `setup-crit-field`, `setup-crit-select`, `setup-save`, `setup-cancel`, `export-back`

- [ ] **Step 1: Write the failing test** `test/requirements-view-export.test.mjs`:

```js
// test/requirements-view-export.test.mjs — Export to a tracker on the Requirements page in jsdom with a fake API
// (plans/requirements-a6-design.md §7; design round 5, boards 26–31). No server, no tracker.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#requirements' });
for (const k of ['document', 'location', 'Event', 'KeyboardEvent', 'HTMLElement', 'window']) {
  Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 12; i += 1) await tick(); };
after(() => window.close());
const { createRequirementsView } = await import('../ui/public/requirements-view.mjs');

/** Routes: `METHOD url` → a value, or (body) => value (may be a promise); a value { __status, body } answers that status. */
function fakeApi(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, url, body });
    const hit = routes[`${method} ${url}`];
    let out = typeof hit === 'function' ? await hit(body) : hit;
    let status = out !== undefined ? 200 : 404;
    if (out && out.__status) { status = out.__status; out = out.body; }
    return { ok: status < 400, status, json: async () => out ?? { error: 'not found' }, text: async () => '# md' };
  };
  return calls;
}
const BASE = { 'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop' }] }, 'GET /api/workspaces': { workspaces: [{ id: 'ws-1', name: 'web' }] } };
const KEYS = ['goal', 'criteria', 'interview', 'openQuestions', 'assumptions', 'target'];
const readiness = (failing = []) => ({ ok: !failing.length, passed: 6 - failing.length, total: 6, overridable: failing.length > 0,
  checks: KEYS.map((key) => ({ key, ok: !failing.includes(key), label: { interview: 'Interview finished', openQuestions: 'No open questions',
    assumptions: 'Every assumption decided' }[key] || key, hint: failing.includes(key) ? 'not yet' : '' })) });
const XV = (over = {}) => ({ tracker: { name: 'Jira' }, canExport: true, hasSetup: true, link: null, exporting: false, doneStatus: null, history: [], ...over });
const LINK = { key: 'SHOP-123', url: 'https://acme.test/browse/SHOP-123', createdAt: '2026-10-26T10:42:00Z', exportedAt: '2026-10-26T10:42:00Z',
  madeOn: '26 Oct', lastOn: '26 Oct', tracker: 'Jira' };
const SPEC = { goal: { text: 'Cancel', measure: 'fewer calls' }, actors: [], flow: [], edgeCases: [], rules: [], outOfScope: [],
  criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }], assumptions: [], openQuestions: [], edited: {} };
const feature = (over = {}) => ({ seq: 7, id: 'FEAT-7', scopeType: 'project', scopeKey: 'shop-1', title: 'Cancel an order before it ships', status: 'done',
  rounds: 3, costUsd: 0.62, busy: false, orientation: null, spec: SPEC, pending: null, lastError: null, state: 'ready', readiness: readiness(), starts: [],
  unaskedRejections: [], changedSinceStart: [], attachments: [], briefDocuments: [], unaskedFiles: [], interview: null, resetPeriod: 'monthly',
  export: XV(), ...over });
const F = '/api/requirements/7';
const SETUP_URL = '/api/requirements/export-setup/project/shop-1';
const CONN = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const TRACKERS = [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira', multiProfile: true,
  profiles: [{ id: 'acme', label: 'acme.atlassian.net (Cloud)' }, { id: 'beta', label: 'jira.beta.test (Data Center)' }] }];
const optionsAnswer = (b) => ({
  projects: b.profile === 'beta' ? [{ value: 'OPS', label: 'OPS — Operations' }] : [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }],
  ...(b.project ? { issueTypes: [{ value: '10001', label: 'Story' }, { value: '10002', label: 'Task' }, { value: '10003', label: 'Bug' }] } : {}),
  ...(b.project && b.issueType ? { priorities: [{ value: '1', label: 'Highest' }, { value: '2', label: 'High' }, { value: '3', label: 'Medium' }, { value: '4', label: 'Low' }],
    criteriaFields: [{ value: 'customfield_10070', label: 'Acceptance Criteria' }, { value: 'customfield_10071', label: 'Definition of Done' }] } : {}),
  doneStatus: 'Done' });
const SETUP_ROUTES = (setup = null) => ({ [`GET ${SETUP_URL}`]: { setup, trackers: TRACKERS, defaultProfile: CONN },
  [`POST ${SETUP_URL}/options`]: (b) => optionsAnswer(b), [`PUT ${SETUP_URL}`]: (b) => ({ setup: { ...b } }) });

const make = () => {
  const host = document.createElement('div'); const msgEl = document.createElement('p'); const subEl = document.createElement('div');
  const nav = document.createElement('nav');
  document.body.replaceChildren(nav, host);
  const view = createRequirementsView({ host, subEl, msgEl, deps: { route: () => {}, who: () => 'Ann' } });
  return { host, msgEl, nav, view };
};
const openFeature = async (f, extra = {}) => {
  const calls = fakeApi({ ...BASE, [`GET ${F}`]: () => ({ feature: f, turns: [] }), ...extra });
  const m = make();
  await m.view.show('feature/7');
  await settle();
  return { ...m, calls };
};
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const dlg = () => document.querySelector('.req-dlg-wrap [role="dialog"]');
const q = (ui, root = document) => root.querySelector(`[data-ui="${ui}"]`);
const menuItems = (host) => [...host.querySelectorAll('[data-menu="export"] [role="menuitem"], [data-menu="export"] [role="separator"]')]
  .map((x) => (x.getAttribute('role') === 'separator' ? '—' : text(x)));
const pick = (sel, value) => { sel.value = value; sel.dispatchEvent(new window.Event('change')); };
const optionTexts = (sel) => [...sel.options].map((o) => o.textContent);

// ── the menu (board 26's note, D1) ──

test('board 26: Export ▾ ends with a separator, Export to Jira… and Export setup…', async () => {
  const { host } = await openFeature(feature());
  assert.deepEqual(menuItems(host), ['Save to specs/', 'Copy Markdown', 'Download .md', '—', 'Export to Jira…', 'Export setup…']);
});

test('D1: several trackers and none bound: "Export to a tracker…"; none at all: "Connect a tracker…"; a workspace has no Save to specs/', async () => {
  let m = await openFeature(feature({ export: XV({ tracker: { name: null } }) }));
  assert.equal(text(q('mi-export', m.host)), 'Export to a tracker…');
  m = await openFeature(feature({ export: XV({ tracker: null, canExport: false, hasSetup: false }) }));
  assert.deepEqual(menuItems(m.host), ['Save to specs/', 'Copy Markdown', 'Download .md', '—', 'Connect a tracker…']);
  m = await openFeature(feature({ scopeType: 'workspace', scopeKey: 'ws-1' }));
  assert.deepEqual(menuItems(m.host), ['Copy Markdown', 'Download .md', '—', 'Export to Jira…', 'Export setup…']);
});

test('board 29 (7): an archived feature: Export to Jira… is disabled and says why; Export setup… stays', async () => {
  const { host } = await openFeature(feature({ status: 'archived', state: 'archived', export: XV({ canExport: false }) }));
  const item = q('mi-export', host);
  assert.equal(item.disabled, true);
  const why = host.querySelector(`#${item.getAttribute('aria-describedby')}`);
  assert.deepEqual([text(why), item.title], ['Restore the feature to export it.', 'Restore the feature to export it.']);
  assert.equal(why.closest('[role="menu"]'), null, 'outside the menu: a menu holds only items and separators');
  assert.deepEqual([...host.querySelectorAll('[data-menu="export"] [role="menu"] > *')].map((x) => x.getAttribute('role')),
    ['menuitem', 'menuitem', 'menuitem', 'separator', 'menuitem', 'menuitem']);
  assert.equal(q('mi-export-setup', host).disabled, false);
});

test('Connect a tracker…: a modal dialog with the line, Close focused, the Marketplace button for Advanced; Escape closes, focus returns', async () => {
  const { host, nav } = await openFeature(feature({ export: XV({ tracker: null, canExport: false, hasSetup: false }) }));
  q('menu-export', host).click();
  q('mi-connect', host).click();
  const d = dlg();
  assert.deepEqual([d.getAttribute('aria-modal'), text(document.getElementById(d.getAttribute('aria-labelledby')))], ['true', 'Connect a tracker']);
  assert.equal(text(d.querySelector('.req-dlg-lead')), 'Trackers are connected on the Marketplace page (Advanced mode), or by whoever set up Worca.');
  assert.equal(document.activeElement, q('connect-close'));
  assert.deepEqual([text(q('connect-market')), q('connect-market').getAttribute('data-min-level')], ['Open the Marketplace page', 'advanced']);
  assert.equal(nav.getAttribute('inert'), '', 'the page behind is inert');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(dlg(), null);
  assert.equal(nav.getAttribute('inert'), null, 'released');
  assert.equal(document.activeElement, q('menu-export', host));
});

// ── the setup (board 26, D2, D16) ──

test('board 26: the first Export to Jira… opens Set up export for shop, each select loaded through options as the one before it', async () => {
  const { host, calls } = await openFeature(feature({ export: XV({ hasSetup: false }) }), SETUP_ROUTES());
  q('menu-export', host).click();
  q('mi-export', host).click();
  assert.deepEqual([document.activeElement, dlg().querySelector('h2').getAttribute('tabindex')], [dlg().querySelector('h2'), '-1'],
    'the focus starts in the dialog, on its title');
  await settle();
  const d = dlg();
  assert.equal(text(d.querySelector('h2')), 'Set up export for shop');
  assert.equal(document.activeElement, q('setup-conn'), 'then on the Connection once it loaded');
  assert.equal(text(d.querySelector('.req-dlg-lead')),
    'Worca uses these for every export from shop. You can change them for one export in the preview, or for good in Export ▾ › Export setup…');
  const conn = q('setup-conn');
  assert.deepEqual([conn.value, optionTexts(conn)], ['jira-source|jira|acme', ['acme.atlassian.net (Cloud)', 'jira.beta.test (Data Center)']]);
  assert.equal(text(document.getElementById(conn.getAttribute('aria-describedby'))), 'Connections are added on the Marketplace page: Installed › Jira (Advanced mode).');
  assert.equal(text(d.querySelector('label[for="req-setup-proj"]')), 'Jira project');
  assert.deepEqual([q('setup-project').value, q('setup-type').value], ['SHOP', '10001'], 'Story by default');
  assert.deepEqual(optionTexts(q('setup-prio')), ['None', 'Highest', 'High', 'Medium', 'Low']);
  assert.equal(q('setup-prio').value, '');
  assert.deepEqual([...d.querySelectorAll('.req-export-lab')].map(text), ['worca']);
  assert.equal(d.querySelector('.req-export-x').getAttribute('aria-label'), 'Remove label worca');
  assert.equal(d.querySelector('.req-export-x svg') !== null && !/×/.test(d.querySelector('.req-export-x').textContent), true, 'an icon, not a glyph');
  const group = d.querySelector('[role="radiogroup"]');
  assert.equal(text(document.getElementById(group.getAttribute('aria-labelledby'))), 'Acceptance criteria go to');
  assert.deepEqual([q('setup-crit-desc').checked, q('setup-crit-select').disabled, q('setup-crit-select').getAttribute('aria-label')],
    [true, true, 'Jira field for acceptance criteria']);
  assert.deepEqual([...group.querySelectorAll('.req-export-rad')].map(text), ['A section of the description', 'A Jira field']);
  assert.deepEqual(optionTexts(q('setup-crit-select')), ['Acceptance Criteria (custom field)', 'Definition of Done (custom field)'], 'board 26');
  assert.equal(text(group.querySelector('p.hint')), 'The list shows the text fields of SHOP that can hold the criteria.');
  assert.deepEqual(calls.filter((c) => c.url === `${SETUP_URL}/options`).map((c) => c.body),
    [CONN, { ...CONN, project: 'SHOP' }, { ...CONN, project: 'SHOP', issueType: '10001' }]);
  assert.deepEqual([text(q('setup-save')), q('setup-save').disabled], ['Save and continue', false]);
});

test('setup: labels added (Enter) and removed, a Jira field for the criteria, a priority; Save sends the names; Export setup… says Save and closes', async () => {
  const { host, calls } = await openFeature(feature(), SETUP_ROUTES({ ...CONN, trackerProject: 'SHOP', issueType: '10001', priority: null, labels: ['worca'],
    criteria: { target: 'description' } }));
  q('menu-export', host).click();
  q('mi-export-setup', host).click();
  await settle();
  assert.equal(text(q('setup-save')), 'Save');
  const input = q('setup-lab-in');
  input.value = 'needs review';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual([...dlg().querySelectorAll('.req-export-lab')].map(text), ['worca', 'needs review']);
  assert.equal(document.activeElement, q('setup-lab-in'), 'focus stays in the field');
  q('setup-lab-x-0').click();
  assert.deepEqual([...dlg().querySelectorAll('.req-export-lab')].map(text), ['needs review']);
  q('setup-crit-field').click();
  q('setup-crit-field').dispatchEvent(new window.Event('change'));
  assert.equal(q('setup-crit-select').disabled, false);
  pick(q('setup-crit-select'), 'customfield_10071');
  pick(q('setup-prio'), '2');
  q('setup-save').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { ...CONN, project: 'SHOP', projectName: 'SHOP — Shop web', issueType: '10001', issueTypeName: 'Story',
    labels: ['needs review'], priority: '2', priorityName: 'High', criteria: { target: 'field', field: 'customfield_10071', name: 'Definition of Done' } });
  assert.equal(dlg(), null);
  assert.equal(document.activeElement, q('menu-export', host));
});

test('setup: an answer for a connection no longer chosen is dropped; a failure shows the server\'s sentence; a Jira too old says so', async () => {
  let release;
  const routes = SETUP_ROUTES();
  routes[`POST ${SETUP_URL}/options`] = (b) => (b.profile === 'acme' && !b.project ? new Promise((r) => { release = () => r(optionsAnswer(b)); }) : optionsAnswer(b));
  const { host } = await openFeature(feature({ export: XV({ hasSetup: false }) }), routes);
  q('menu-export', host).click();
  q('mi-export', host).click();
  await settle();
  pick(q('setup-conn'), 'jira-source|jira|beta');
  await settle();
  release();
  await settle();
  assert.deepEqual(optionTexts(q('setup-project')), ['OPS — Operations'], 'the late acme answer did not land');
  routes[`POST ${SETUP_URL}/options`] = () => ({ __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' } });
  pick(q('setup-conn'), 'jira-source|jira|acme');
  await settle();
  assert.equal(text(dlg().querySelector('[role="alert"]')), 'Worca could not reach Jira: the API token was refused.');
  assert.equal(q('setup-save').disabled, true);
  routes[`POST ${SETUP_URL}/options`] = (b) => (b.project ? { ...optionsAnswer(b), issueTypes: [], tooOld: true } : optionsAnswer(b));
  pick(q('setup-conn'), 'jira-source|jira|beta');
  await settle();
  assert.equal(text(dlg().querySelector('[role="alert"]')), 'This Jira is too old for export setup.');
  assert.equal(q('setup-save').disabled, true);
});

test('CSS: the A6 rules sit inside the Requirements block and use tokens only', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  const block = css.slice(start, end);
  for (const sel of ['.req-export-fld', '.req-export-pair', '.req-export-x', '.req-export-rad', '.req-export-alert']) {
    const at = css.indexOf(sel);
    assert.ok(at > start && at < end, `${sel} inside the Requirements block`);
  }
  const mine = block.split('\n').filter((l) => /req-export|req-history|req-report|req-dlg-sheet/.test(l));
  const bad = /#[0-9a-fA-F]{3,8}\b|rgba?\(|font(?:-size)?:[^;}]*\b(?:11\.5|12\.5|14)px|border-radius:(?:12|999)px|min-height:44px/;
  assert.ok(mine.every((l) => !bad.test(l)), mine.filter((l) => bad.test(l)).join('\n'));
});
```

- [ ] **Step 2: Run it and see it fail.** `node tools/test.mjs test/requirements-view-export.test.mjs` → FAIL: the Export menu has no tracker items.

- [ ] **Step 3: The modal can make the whole page inert.** In `ui/public/requirements-view.mjs`:
  - beside `let dialog = null;` add:

```js
  let dlgGen = 0;            // A6: bumped by every dialog open and close; a late answer for a dialog that is gone is dropped
  let exportDone = null;     // A6: { seq, text } — "Created SHOP-123" after an export (board 29)
  let exportDoneEl = null;   // its role=status line, kept across paints
  const reportBack = new Map();   // A6 D15: seq → the Report back switch (on unless switched off)
```

  - in `show()`, in the block that runs when `next !== seqShown`, after `closeDialog(false);` add `exportDone = null; exportDoneEl = null;`.
  - replace `openModal` and `closeDialog` with:

```js
  /** A modal on the page (the start dialog's pattern): Escape closes it when `canClose()`, Tab stays inside, the page
   *  behind is inert; `first` takes the focus, and `closeDialog(true)` hands it back to `trigger`. A6 (`page`): an export
   *  dialog — a full-screen sheet on a phone — makes every other child of <body> inert too, released on close. */
  function openModal(card, { trigger = null, first = null, canClose = () => true, page = false } = {}) {
    const wrap = h('div', { class: `viewer-modal req-dlg-wrap${page ? ' req-dlg-sheet' : ''}` }, card);
    const triggerUi = trigger && trigger.getAttribute ? trigger.getAttribute('data-ui') : null;
    // On the document, in the capture phase: Escape and Tab work wherever the focus is, even after a click
    // on the scrim left it on <body>. Removed on close.
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (canClose()) closeDialog(true); return; }
      if (e.key !== 'Tab') return;
      // a radio group is one stop: its checked radio. A control hidden by CSS (the sheet's ← FEAT-7 on a desktop) is no stop;
      // checkVisibility is Chrome's (jsdom has none, so there every control counts).
      const shown = (el) => typeof el.checkVisibility !== 'function' || el.checkVisibility();
      const all = [...card.querySelectorAll('button, textarea, input, select, a[href], [tabindex="0"]')]
        .filter((el) => !el.disabled && !el.hidden && !(el.type === 'radio' && !el.checked) && shown(el));
      if (!all.length) return;
      const head = all[0], last = all[all.length - 1];
      const at = document.activeElement;
      // the title (tabindex=-1, where an export dialog starts) is before every stop: Shift+Tab from it wraps to the last one
      const atTitle = !!at && at.tagName === 'H2' && card.contains(at);
      if (e.shiftKey && (at === head || atTitle || !card.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !card.contains(at))) { e.preventDefault(); head.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.append(wrap);
    // the page behind cannot be reached while the dialog is open
    host.inert = true; host.setAttribute('inert', '');
    const inerted = [];
    if (page) {
      for (const el of document.body.children) {
        if (el === wrap || el.hasAttribute('inert')) continue;
        el.inert = true; el.setAttribute('inert', '');
        inerted.push(el);
      }
    }
    dlgGen += 1;
    dialog = { wrap, trigger, triggerUi, onKey, canClose, inerted };
    if (first) first.focus();
  }
  function restoreFocus(trigger, triggerUi) {
    const el = trigger && trigger.isConnected ? trigger : triggerUi ? host.querySelector(`[data-ui="${triggerUi}"]`) : null;
    if (el && !el.disabled) el.focus();
  }
  function closeDialog(restore = true) {
    if (!dialog) return;
    const { wrap, trigger, triggerUi, onKey, inerted = [] } = dialog;
    dialog = null;
    dlgGen += 1;
    document.removeEventListener('keydown', onKey, true);
    host.inert = false; host.removeAttribute('inert');
    for (const el of inerted) { el.inert = false; el.removeAttribute('inert'); }
    wrap.remove();
    if (restore) restoreFocus(trigger, triggerUi);
  }
```

  (`restoreFocus` is unchanged; it is repeated here only because it sits between the two.)

- [ ] **Step 4: The menu items.** In `header(f)`, the export menu's item list becomes:

```js
        menu('export', h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'menu-export' }, 'Export', sharedIcon(document, 'chevron-down', 14)), [
          f.scopeType === 'project' ? menuItem('Save to specs/', save, { ui: 'mi-save' }) : null,
          menuItem('Copy Markdown', copy, { ui: 'mi-copy' }),
          h('a', { role: 'menuitem', class: 'menu-item req-menu-item', 'data-ui': 'mi-download', href: `/api/requirements/${f.seq}/markdown?download=1`, download: '' }, 'Download .md'),
          ...exportItems(f),   // A6 D1: Export to <tracker>… and Export setup…, or Connect a tracker…
        ]),
        exportArchNote(f),   // A6: why an archived feature cannot export, outside role="menu" (a menu holds only items)
```

  (The `menu('more', …)` call follows unchanged; `exportArchNote` sits between the two menus inside `.req-head-tools`.)

- [ ] **Step 5: The A6 section.** Insert right before the line `  // A repaint from the feature on screen, without a fetch (a fold, an editor opened, Change, Cancel).`:

```js
  // ---- A6: export to a tracker (plans/requirements-a6-design.md §7, boards 26–31). Every dialog is the page's modal with
  // the page behind inert (openModal's `page`); dlgGen drops an answer for a dialog that is gone. ----
  const xOf = (f) => (f && f.export) || null;
  const linkOf = (f) => (xOf(f) && xOf(f).link) || null;
  /** The menu's tracker name: "Jira", "a tracker" (several, none bound), or null (none can export). */
  const trackerName = (f) => { const x = xOf(f); return x && x.tracker ? (x.tracker.name || 'a tracker') : null; };
  const exportUrl = (f, path = '') => `/api/requirements/${f.seq}/export${path}`;
  const setupUrl = (f, path = '') => `/api/requirements/export-setup/${f.scopeType}/${encodeURIComponent(f.scopeKey)}${path}`;
  const connValue = (c) => `${c.plugin}|${c.sourceId}|${c.profile || ''}`;
  const connFrom = (v) => { const [plugin, sourceId, profile] = String(v || '').split('|'); return { plugin, sourceId, profile: profile || null }; };
  /** The dialog opened as generation `g` is still the one on screen. */
  const live = (g) => g === dlgGen && !!dialog;
  const exportTrigger = () => host.querySelector('[data-ui="menu-export"]');

  const ARCHIVED_NOTE = 'Restore the feature to export it.';
  /** D1: a separator, then Export to <tracker>… and Export setup…, or Connect a tracker…; archived: disabled, with why (its
   *  title, and a description node outside the menu: exportArchNote). */
  function exportItems(f) {
    const x = xOf(f);
    if (!x) return [];
    const sep = h('div', { class: 'menu-sep', role: 'separator' });
    if (!x.tracker) return [sep, menuItem('Connect a tracker…', () => openConnect(exportTrigger()), { ui: 'mi-connect' })];
    const archived = f.status === 'archived';
    const go = menuItem(`Export to ${trackerName(f)}…`, () => startExport(f, exportTrigger()), { disabled: archived || x.exporting, ui: 'mi-export' });
    if (archived) { go.setAttribute('aria-describedby', 'req-export-arch'); go.title = ARCHIVED_NOTE; }
    return [sep, go, menuItem('Export setup…', () => { void openSetup(f, { trigger: exportTrigger() }); }, { ui: 'mi-export-setup' })];
  }
  /** The archived item's description, beside the menu (a role="menu" holds only items and separators). */
  const exportArchNote = (f) => (f.status === 'archived' && xOf(f) && xOf(f).tracker
    ? h('span', { class: 'sr-only', id: 'req-export-arch', text: ARCHIVED_NOTE }) : null);

  /** D2: where trackers are connected. The Marketplace button only at the Advanced level (docs/ui-levels.md). */
  function openConnect(trigger) {
    closeDialog(false);
    const close = h('button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'connect-close', onclick: () => closeDialog(true) }, 'Close');
    const card = h('section', { class: 'card req-dialog req-export req-export-connect', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'req-connect-title' },
      h('h2', { id: 'req-connect-title', text: 'Connect a tracker' }),
      h('p', { class: 'req-dlg-lead', text: 'Trackers are connected on the Marketplace page (Advanced mode), or by whoever set up Worca.' }),
      h('div', { class: 'req-dlg-btns' },
        h('button', { type: 'button', class: 'btn', 'data-ui': 'connect-market', 'data-min-level': 'advanced',
          onclick: () => { closeDialog(false); location.hash = '#marketplace'; } }, 'Open the Marketplace page'),
        close));
    openModal(card, { trigger, first: close, page: true });
  }

  /** A select in upstream's .select-wrap; `list` of { value, label }. */
  function exportSelect({ id = null, ui, list, value, onchange, label = null, disabled = false, describedBy = null }) {
    const s = h('select', { id, 'data-ui': ui, 'aria-label': label, 'aria-describedby': describedBy, disabled, onchange });
    for (const o of list || []) { const op = h('option', { value: o.value, text: o.label }); op.selected = o.value === value; s.append(op); }
    return h('div', { class: 'select-wrap' }, s);
  }
  /** A field: its label (a <label for> when it names a control, else a caption), the control, an optional hint. */
  function exportField(labelFor, labelKids, control, hint = null, hintId = null) {
    return h('div', { class: 'field req-export-fld' },
      labelFor ? h('label', { for: labelFor }, ...[].concat(labelKids)) : h('span', { class: 'req-export-fl' }, ...[].concat(labelKids)),
      ...[].concat(control), hint ? h('p', { class: 'hint', id: hintId, text: hint }) : null);
  }
  /** Labels as chips, each with a remove button, and a field that adds one (Enter or a comma); `fixed` (worca-FEAT-7) last and
   *  for good (D6). onChange(next, focusUi): the caller repaints and puts the focus back in the field. */
  function labelsField({ id, ui, labels, fixed = null, onChange }) {
    const input = h('input', { type: 'text', id, class: 'req-export-labin', placeholder: 'Add a label', 'data-ui': `${ui}-in`,
      'aria-describedby': fixed ? `${id}-fixed` : null });
    const add = () => { const v = input.value.trim(); if (!v) return; input.value = ''; onChange([...labels, v], `${ui}-in`); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } });
    return h('div', { class: 'field req-export-fld' }, h('label', { for: id }, 'Labels'),
      h('div', { class: 'req-export-chips' },
        ...labels.map((l, i) => h('span', { class: 'chip req-export-lab' }, h('span', { text: l }),
          h('button', { type: 'button', class: 'req-export-x', 'aria-label': `Remove label ${l}`, 'data-ui': `${ui}-x-${i}`,
            onclick: () => onChange(labels.filter((_, j) => j !== i), `${ui}-in`) }, icon(ICONS.remove, { size: 12 })))),
        fixed ? h('span', { class: 'chip req-export-lab req-export-fixed', 'aria-describedby': `${id}-fixed`, text: fixed }) : null),
      input,
      fixed ? h('p', { class: 'hint', id: `${id}-fixed`, text: `${fixed} stays: Worca uses this label to find the ticket again.` }) : null);
  }
  /** Board 31: a sheet's way back to the feature (shown at phone width only, by CSS). */
  const backButton = (f) => h('button', { type: 'button', class: 'link-btn req-export-back', 'data-ui': 'export-back', 'aria-label': `Back to ${f.id}`,
    onclick: () => { if (dialog && dialog.canClose()) closeDialog(true); } }, `← ${f.id}`);

  /** Set up export for <name> (board 26, D2, D16), per project or workspace. Each select loads through …/options as the one
   *  before it changes; a later change supersedes an answer still on its way. `then` goes on with the export after Save. */
  async function openSetup(f, { trigger = null, then = null } = {}) {
    closeDialog(false);
    const scopeName = targetName(f);
    const st = { trackers: [], conn: null, projects: [], project: null, types: [], type: null, prios: [], prio: null, fields: [],
      crit: { target: 'description' }, labels: ['worca'], ready: false, tooOld: false, busy: false, loads: 0 };
    const body = h('div', { class: 'req-export-body' });
    const alertEl = h('p', { class: 'form-msg err req-export-alert', role: 'alert' });
    const save = h('button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'setup-save', disabled: true }, then ? 'Save and continue' : 'Save');
    // the focus starts on the title (D20), so it is inside the dialog even when the load below fails
    const title = h('h2', { id: 'req-setup-title', tabindex: '-1', text: `Set up export for ${scopeName}` });
    const card = h('section', { class: 'card req-dialog req-export req-export-setup', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'req-setup-title', 'aria-describedby': 'req-setup-desc' },
      backButton(f),
      title,
      h('p', { class: 'req-dlg-lead', id: 'req-setup-desc',
        text: `Worca uses these for every export from ${scopeName}. You can change them for one export in the preview, or for good in Export ▾ › Export setup…` }),
      body, alertEl,
      h('div', { class: 'req-dlg-btns' },
        h('button', { type: 'button', class: 'btn', 'data-ui': 'setup-cancel', onclick: () => { if (!st.busy) closeDialog(true); } }, 'Cancel'), save));
    openModal(card, { trigger, first: title, canClose: () => !st.busy, page: true });
    const g = dlgGen;
    const nameIn = (list, v) => (list.find((x) => x.value === v) || {}).label || v;
    const trackerNow = () => st.trackers.find((t) => st.conn && t.plugin === st.conn.plugin && t.sourceId === st.conn.sourceId) || null;

    function draw(focusUi = null) {
      const focus = focusUi || (card.contains(document.activeElement) ? document.activeElement.getAttribute('data-ui') : null);
      const tn = (trackerNow() || {}).name || 'the tracker';
      const several = st.trackers.length > 1;
      const conns = st.trackers.flatMap((t) => t.profiles.map((p) => ({ value: connValue({ plugin: t.plugin, sourceId: t.sourceId, profile: p.id }),
        label: `${several ? `${t.name} · ` : ''}${p.label}` })));
      const toField = st.crit.target === 'field';
      const firstField = st.fields[0] || null;
      const radio = (ui, on, onpick, disabled = false) => {
        const r = h('input', { type: 'radio', name: 'req-setup-crit', 'data-ui': ui, disabled, onchange: onpick });
        r.checked = on;
        return r;
      };
      body.replaceChildren(
        exportField('req-setup-conn', 'Connection', exportSelect({ id: 'req-setup-conn', ui: 'setup-conn', list: conns, value: st.conn ? connValue(st.conn) : '',
          describedBy: 'req-setup-conn-h', onchange: (e) => { st.conn = connFrom(e.currentTarget.value); void load('projects'); } }),
        `Connections are added on the Marketplace page: Installed › ${tn} (Advanced mode).`, 'req-setup-conn-h'),
        h('div', { class: 'req-export-pair' },
          exportField('req-setup-proj', `${tn} project`, exportSelect({ id: 'req-setup-proj', ui: 'setup-project', list: st.projects, value: st.project,
            onchange: (e) => { st.project = e.currentTarget.value; void load('types'); } })),
          exportField('req-setup-type', 'Issue type', exportSelect({ id: 'req-setup-type', ui: 'setup-type', list: st.types, value: st.type,
            onchange: (e) => { st.type = e.currentTarget.value; void load('fields'); } }))),
        h('div', { class: 'req-export-pair' },
          labelsField({ id: 'req-setup-lab', ui: 'setup-lab', labels: st.labels, onChange: (next, ui) => { st.labels = next; draw(ui); } }),
          exportField('req-setup-prio', ['Priority ', h('span', { class: 'opt', text: 'optional' })], exportSelect({ id: 'req-setup-prio', ui: 'setup-prio',
            list: [{ value: '', label: 'None' }, ...st.prios], value: st.prio || '', onchange: (e) => { st.prio = e.currentTarget.value || null; } }))),
        h('div', { class: 'field req-export-fld req-export-crit', role: 'radiogroup', 'aria-labelledby': 'req-setup-crit-l' },
          h('span', { class: 'req-export-fl', id: 'req-setup-crit-l', text: 'Acceptance criteria go to' }),
          h('label', { class: 'req-export-rad' }, radio('setup-crit-desc', !toField, () => { st.crit = { target: 'description' }; draw(); }), 'A section of the description'),
          h('div', { class: 'req-export-radrow' },
            h('label', { class: 'req-export-rad' }, radio('setup-crit-field', toField, () => {
              if (firstField) { st.crit = { target: 'field', field: firstField.value, name: firstField.label }; draw(); }
            }, !firstField), `A ${tn} field`),
            // board 26 names them "Acceptance Criteria (custom field)"; the saved name stays the field's own
            exportSelect({ ui: 'setup-crit-select', list: st.fields.map((x) => ({ value: x.value, label: `${x.label} (custom field)` })),
              value: toField ? st.crit.field : (firstField || {}).value,
              label: `${tn} field for acceptance criteria`, disabled: !toField,
              onchange: (e) => { st.crit = { target: 'field', field: e.currentTarget.value, name: nameIn(st.fields, e.currentTarget.value) }; } })),
          h('p', { class: 'hint', text: `The list shows the text fields of ${st.project || tn} that can hold the criteria.` })));
      save.disabled = st.busy || !st.ready;
      if (focus) { const el = card.querySelector(`[data-ui="${focus}"]`); if (el && !el.disabled) el.focus(); }
    }

    async function load(from) {
      const n = ++st.loads;
      st.ready = false;
      alertEl.textContent = '';
      draw();
      const ask = (args) => api('POST', setupUrl(f, '/options'), { ...st.conn, ...args });
      try {
        if (from === 'projects') {
          const r = await ask({});
          if (!live(g) || n !== st.loads) return;
          st.projects = r.projects || [];
          if (!st.projects.some((p) => p.value === st.project)) st.project = (st.projects[0] || {}).value || null;
        }
        if (from !== 'fields' && st.project) {
          const r = await ask({ project: st.project });
          if (!live(g) || n !== st.loads) return;
          st.tooOld = r.tooOld === true;
          st.types = r.issueTypes || [];
          if (!st.types.some((t) => t.value === st.type)) st.type = (st.types.find((t) => t.label === 'Story') || st.types[0] || {}).value || null;
        }
        if (st.project && st.type && !st.tooOld) {
          const r = await ask({ project: st.project, issueType: st.type });
          if (!live(g) || n !== st.loads) return;
          st.prios = r.priorities || [];
          st.fields = r.criteriaFields || [];
          if (st.prio && !st.prios.some((p) => p.value === st.prio)) st.prio = null;
          if (st.crit.target === 'field' && !st.fields.some((x) => x.value === st.crit.field)) st.crit = { target: 'description' };
        }
        if (st.tooOld) alertEl.textContent = `This ${(trackerNow() || {}).name || 'tracker'} is too old for export setup.`;
        st.ready = !!(st.project && st.type) && !st.tooOld;
        draw();
      } catch (err) {
        if (!live(g) || n !== st.loads) return;
        alertEl.textContent = errText(err);
        draw();
      }
    }

    save.addEventListener('click', async () => {
      if (st.busy || !st.ready) return;
      st.busy = true;
      draw();
      try {
        await api('PUT', setupUrl(f), { ...st.conn, project: st.project, projectName: nameIn(st.projects, st.project), issueType: st.type,
          issueTypeName: nameIn(st.types, st.type), labels: st.labels, priority: st.prio, priorityName: st.prio ? nameIn(st.prios, st.prio) : null,
          criteria: st.crit });
        if (!live(g)) return;
        st.busy = false;
        if (then) { then(); return; }   // the next dialog takes over (it closes this one)
        closeDialog(true);
        void paint();
      } catch (err) {
        if (!live(g)) return;
        st.busy = false;
        alertEl.textContent = errText(err);
        draw();
      }
    });

    try {
      const r = await api('GET', setupUrl(f));
      if (!live(g)) return;
      st.trackers = r.trackers || [];
      const s = r.setup;
      st.conn = s ? { plugin: s.plugin, sourceId: s.sourceId, profile: s.profile } : r.defaultProfile;
      if (s) Object.assign(st, { project: s.trackerProject, type: s.issueType, prio: s.priority, labels: s.labels || [], crit: s.criteria || { target: 'description' } });
      draw('setup-conn');
      if (st.conn) await load('projects');
    } catch (err) {
      if (live(g)) { alertEl.textContent = errText(err); draw(); }
    }
  }

  /** Export to <tracker>… (D1, D2): the setup first when the scope has none, then the export goes on. */
  function startExport(f, trigger) {
    const x = xOf(f);
    if (!x || !x.tracker || f.status === 'archived' || x.exporting) return;
    if (!x.hasSetup) { void openSetup(f, { trigger, then: () => continueExport(f, trigger) }); return; }
    continueExport(f, trigger);
  }
  // Task 9 gives this its body (Not Ready, Export again, the preview); until then the setup is where an export stops.
  function continueExport(_f, _trigger) { closeDialog(true); }
```

- [ ] **Step 6: The CSS.** In `ui/public/style.css`, right before `/* ── marketplace P3 ── */`, add:

```css
/* A6 (plans/requirements-a6-design.md §7): Export to a tracker. The dialogs are .req-dialog cards on the page's modal (the
   setup 560 px, board 26); a field is its label over its control, two short fields share a row. The label chips' remove
   button is the shared remove icon. */
.req-dialog.req-export .req-export-body{display:flex;flex-direction:column;gap:14px;min-width:0}
.req-export-fld{display:flex;flex-direction:column;gap:6px;margin:0;min-width:0}
.req-export-fld > label,.req-export-fl{margin:0;font-size:var(--fs-meta);font-weight:600;color:var(--ink-2)}
.req-export-fld .opt{font-weight:400;color:var(--ink-3)}
.req-export-fld > .hint{margin:0}
.req-export-pair{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:14px}
.req-export-chips{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.req-export-lab{display:inline-flex;align-items:center;gap:4px;max-width:100%;overflow-wrap:anywhere}
.req-export-x{display:inline-flex;align-items:center;justify-content:center;padding:2px;border:0;border-radius:var(--r-xs);background:transparent;color:var(--ink-3);cursor:pointer}
.req-export-x:hover{color:var(--ink)}
.req-export-x:focus-visible{outline:2px solid var(--ink);outline-offset:1px}
.req-export-rad{display:flex;align-items:center;gap:10px;font-size:var(--fs-body);color:var(--ink);cursor:pointer}
.req-export-rad input{margin:0}
.req-export-radrow{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
.req-export-radrow .select-wrap{flex:1 1 220px;min-width:0}
.req-export-alert{margin:0}
.req-export-alert:empty{display:none}
```

- [ ] **Step 7: Run and see it pass.** `node tools/test.mjs test/requirements-view-export.test.mjs` → pass. Then the page's other tests and the design language: `node tools/test.mjs test/requirements-view.test.mjs`, `node tools/test.mjs test/requirements-view-files.test.mjs`, `node tools/test.mjs test/requirements-app.test.mjs`, `node tools/test.mjs test/ui-design-language.test.mjs` → pass (the start dialog still opens through `openModal` without `page`; compare a failure with `<baseline>`).

- [ ] **Step 8: Commit.**

```bash
git add ui/public/requirements-view.mjs ui/public/style.css test/requirements-view-export.test.mjs
git commit -m "Requirements: Export menu tracker items, Connect a tracker and the export setup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: The page — the preview, Export anyway, Export again and the comment, the chip, the History card (boards 27, 28)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`header`; `paintFeature`; the A6 section: replace `continueExport`, add the dialogs)
- Modify: `ui/public/style.css` (the Requirements block)
- Modify: `test/requirements-view-export.test.mjs` (append)

**Interfaces:**
- Consumes: Task 8's helpers; `POST /api/requirements/:seq/export/preview` (`Preview`) and `POST /api/requirements/:seq/export` (`{ action, key, url, feature, turns }`) (Task 6); `failingChecks`, `joinAnd`, `sentence`, `REASON_MAX`, `paintFeature`, `paintNo`, `paintedKey`, `seqShown`.
- Produces (inside `createRequirementsView`):
  - `continueExport(f, trigger)`: Not Ready first (D5), then Export again with a ticket (D7), else the preview of a create
  - `openExportNotReady(f, trigger, then(reason))`, `openPreview(f, { mode, reason, force, trigger })`, `openAgain(f, { reason, trigger })`, `openComment(f, { reason, trigger })`
  - `stateBox() → { els, clear(), show(kids, { note, buttons, warn }) }` (one persistent `role="alert"` line per dialog)
  - `showFailure(box, err, ctx)` — this task: the server's sentence only; Task 10 replaces it with board 29's states. `ctx = { f, name, key(), reason, trigger, hideGo(bool), retryLabel(text), reload(), reopen(), setBusy(bool) }`
  - `editedState(box, key, name, { onUpdate, onComment })`, `goneError(key, name)`, `sendExport(f, g, { name, body, statusEl, buttons, setBusy, onFail })`, `exported(f, res)`, `mdBlocks(md)`
  - `exportChip(f)`, `exportDoneLine(f)`, `historyCard(f)`
  - `data-ui`: `export-reason`, `export-anyway`, `export-keep`, `export-type`, `export-lab-in`, `export-lab-x-<i>`, `export-prio`, `export-more`, `export-cancel`, `export-go`, `again-update`, `again-comment`, `again-new`, `again-cancel`, `again-continue`, `export-update-anyway`, `export-comment-instead`, `export-edited-cancel`, `comment-back`, `comment-add`, `export-chip`

- [ ] **Step 1: Write the failing tests.** Append to `test/requirements-view-export.test.mjs`:

```js
// ── Task 9: the preview, Export anyway, Export again, the comment, the chip, History (boards 27, 28) ──
const DESC = ['## Goal', '', 'Customers cancel an order themselves until it leaves the warehouse.', '', 'Measure: a third fewer support calls.', '',
  '## Main flow', '', '1. Open the order.', '2. Cancel it.', '',
  '## Acceptance criteria', '', '- R-po-1 A customer can cancel a paid order.', '- R-po-2 <img src=x onerror=alert(1)> stays text', '',
  'From Worca FEAT-7 · exported 26 Oct 2026', ''].join('\n');
const FIELDS = { conn: CONN, connection: 'acme.atlassian.net (Cloud)', project: { value: 'SHOP', label: 'SHOP — Shop web' },
  issueType: { value: '10001', label: 'Story' }, labels: ['worca', 'worca-FEAT-7'], fixedLabel: 'worca-FEAT-7', priority: null,
  criteria: { target: 'description' }, summary: 'Cancel an order before it ships' };
const preview = (over = {}) => ({ mode: 'create', tracker: 'Jira', key: null, comment: null, previewHash: 'h1', changes: [], fields: FIELDS, link: null,
  edited: false, gone: false, ticket: { project: 'SHOP', issueType: '10001', title: 'Cancel an order before it ships', description: DESC,
    labels: ['worca', 'worca-FEAT-7'], priority: null, criteria: { target: 'description' } }, ...over });
const AGAIN = (over = {}) => preview({ mode: 'update', key: 'SHOP-123', link: { key: 'SHOP-123', madeOn: '26 Oct', lastOn: '26 Oct' },
  changes: [{ line: 'Added R-po-6 An order with some items shipped can cancel only the items not yet picked up.', id: 'R-po-6' },
    { line: 'Business rules: 1 line changed', id: null }, { line: 'Edge cases: 1 line added', id: null }], ...over });
const exportAnswer = (action, key) => ({ action, key, url: `https://acme.test/browse/${key}`, turns: [],
  feature: feature({ export: XV({ link: { ...LINK, key, url: `https://acme.test/browse/${key}` },
    history: [{ action, tracker: 'Jira', key, url: `https://acme.test/browse/${key}`, reason: null, when: '26 Oct, 10:42', by: 'Ann Example' }] }) }) });
const PREVIEW_URL = `${F}/export/preview`;
const EXPORT_URL = `${F}/export`;
const openExport = async (f, routes) => {
  const m = await openFeature(f, { ...SETUP_ROUTES(), ...routes });
  q('menu-export', m.host).click();
  q('mi-export', m.host).click();
  await settle();
  return m;
};
const typeReason = (why) => { q('export-reason').value = why; q('export-reason').dispatchEvent(new window.Event('input')); };

test('board 27: with a setup a Ready feature goes straight to the preview: the fields, the description as text, Create in Jira', async () => {
  const { calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview() });
  const d = dlg();
  assert.equal(text(document.getElementById(d.getAttribute('aria-labelledby'))), 'Export FEAT-7 to Jira');
  const title = d.querySelector('h2');
  assert.deepEqual([document.activeElement, title.getAttribute('tabindex')], [title, '-1'], 'the focus is in the dialog, on its title');
  // board 31's phone title: CSS hides this part at 900 px and narrower and shows the line under the title
  assert.deepEqual([text(title.querySelector('.req-export-tid')), text(d.querySelector('.req-export-sub'))],
    ['FEAT-7', 'FEAT-7 · Cancel an order before it ships']);
  assert.equal(text(d.querySelector('.req-dlg-lead')), 'This is the ticket Worca will create in SHOP. Change the issue type, labels or priority for this export.');
  assert.deepEqual(calls.find((c) => c.url === PREVIEW_URL).body, { mode: 'create' });
  assert.deepEqual([...d.querySelectorAll('.req-export-fields > .req-export-fld')].map((x) => text(x.firstChild)),
    ['Project', 'Issue type', 'Summary', 'Labels', 'Priority', 'Acceptance criteria']);
  const fld = (i) => d.querySelectorAll('.req-export-fields > .req-export-fld')[i];
  const valHint = (i) => [text(fld(i).querySelector('.req-export-val')), text(fld(i).querySelector('.hint'))];
  assert.deepEqual(valHint(0), ['SHOP — Shop web', 'Saved in the export setup · acme.atlassian.net (Cloud)']);
  assert.deepEqual(valHint(2), ['Cancel an order before it ships', "The feature's title"]);
  assert.deepEqual(valHint(5), ['→ Description', 'A section of the description, as in the export setup']);
  assert.deepEqual([...d.querySelectorAll('.req-export-lab')].map(text), ['worca', 'worca-FEAT-7']);
  assert.equal(d.querySelectorAll('.req-export-lab .req-export-x').length, 1, 'the fixed label cannot be removed');
  assert.equal(text(document.getElementById(d.querySelector('.req-export-fixed').getAttribute('aria-describedby'))),
    'worca-FEAT-7 stays: Worca uses this label to find the ticket again.');
  assert.deepEqual(optionTexts(q('export-type')), ['Story', 'Task', 'Bug'], 'the choices loaded through options');
  assert.deepEqual(optionTexts(q('export-prio')), ['None', 'Highest', 'High', 'Medium', 'Low']);
  const desc = d.querySelector('.req-export-desc');
  assert.deepEqual([desc.getAttribute('tabindex'), desc.getAttribute('aria-label')], ['0', 'Description preview']);
  assert.equal(text(d.querySelector('#req-exp-desc-h')), 'Description, as Jira will show it');
  assert.deepEqual([...desc.querySelectorAll('h4')].map(text), ['Goal', 'Main flow', 'Acceptance criteria']);
  assert.deepEqual([...desc.querySelectorAll('ol li')].map(text), ['Open the order.', 'Cancel it.']);
  assert.equal(desc.querySelector('img'), null, 'never HTML');
  assert.ok(text(desc).includes('<img src=x onerror=alert(1)> stays text'));
  assert.equal(text(desc.querySelector('.req-export-sig')), 'From Worca FEAT-7 · exported 26 Oct 2026');
  assert.equal(text(d.querySelector('.req-export-foot > .hint')), 'Only what you see here is sent to Jira.');
  assert.deepEqual([text(q('export-go')), q('export-go').disabled], ['Create in Jira', false]);
});

test('D6: changing the issue type, a label or the priority asks for a fresh preview with it; the focus stays in the labels field', async () => {
  let n = 0;
  const { calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: (b) => { n += 1; return preview({ previewHash: `h${n}`,
    fields: { ...FIELDS, labels: [...(b.labels || ['worca']).map((l) => l.replace(/\s+/g, '-')), 'worca-FEAT-7'] } }); } });
  pick(q('export-type'), '10002');
  await settle();
  q('export-lab-in').value = 'needs review';
  q('export-lab-in').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  assert.equal(document.activeElement, q('export-lab-in'));
  pick(q('export-prio'), '3');
  await settle();
  assert.deepEqual(calls.filter((c) => c.url === PREVIEW_URL).map((c) => c.body), [{ mode: 'create' },
    { mode: 'create', issueType: '10002', issueTypeName: 'Task' },
    { mode: 'create', issueType: '10002', issueTypeName: 'Task', labels: ['worca', 'needs review'] },
    { mode: 'create', issueType: '10002', issueTypeName: 'Task', labels: ['worca', 'needs review'], priority: '3', priorityName: 'Medium' }]);
  assert.deepEqual([...dlg().querySelectorAll('.req-export-lab')].map(text), ['worca', 'needs-review', 'worca-FEAT-7'], 'as the server normalised it');
});

test('board 29 (4, 5): Create in Jira: Exporting to Jira… and the buttons wait; then the chip, "Created SHOP-123", the focus on the chip', async () => {
  let release;
  const { host, calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview(),
    [`POST ${EXPORT_URL}`]: () => new Promise((r) => { release = () => r(exportAnswer('created', 'SHOP-123')); }) });
  q('export-go').click();
  await settle();
  const status = dlg().querySelector('.req-export-status');
  assert.deepEqual([status.getAttribute('role'), text(status), !!status.querySelector('.badge.blue'), q('export-go').disabled, q('export-cancel').disabled],
    ['status', 'Exporting to Jira…', true, true, true]);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(dlg(), 'Escape waits while exporting');
  release();
  await settle();
  assert.deepEqual(calls.find((c) => c.url === EXPORT_URL).body, { mode: 'create', previewHash: 'h1' });
  assert.equal(dlg(), null);
  const chip = q('export-chip', host);
  assert.deepEqual([text(chip), chip.getAttribute('href'), chip.getAttribute('target'), chip.getAttribute('rel'), chip.getAttribute('aria-label')],
    ['SHOP-123', 'https://acme.test/browse/SHOP-123', '_blank', 'noopener', 'SHOP-123, opens the ticket in Jira in a new tab']);
  assert.ok(chip.querySelector('svg') && !/↗/.test(chip.textContent), 'the external icon, not a glyph');
  assert.equal(document.activeElement, chip);
  const done = host.querySelector('.req-export-done');
  assert.deepEqual([done.getAttribute('role'), text(done), !!done.querySelector('svg')], ['status', 'Created SHOP-123', true]);
});

test('board 27: not Ready, its dialog comes first; the checks as the board writes them; Export anyway needs a reason, the preview gets it', async () => {
  const f = feature({ readiness: readiness(['openQuestions', 'assumptions']), state: 'decide',
    spec: { ...SPEC, openQuestions: ['Do business customers need approval before cancelling?'], assumptions: [{ id: 'A-4', text: 'x', status: 'open' }] } });
  const { calls } = await openExport(f, { [`POST ${PREVIEW_URL}`]: (b) => preview({ ticket: { ...preview().ticket, description: `Exported before Ready: ${b.reason}\n\n${DESC}` } }) });
  const d = dlg();
  assert.equal(text(document.getElementById(d.getAttribute('aria-labelledby'))), 'Export FEAT-7 before it’s Ready?');
  assert.equal(text(d.querySelector('.req-dlg-lead')), '2 checks do not pass yet:');
  assert.deepEqual([...d.querySelectorAll('.req-dlg-fail li')].map(text), ['1 open question. Do business customers need approval before cancelling?',
    'A-4 is not decided. The ticket lists confirmed assumptions only.']);
  assert.equal(text(d.querySelector('label[for="req-exp-reason"]')), 'Why export before it is Ready? required, kept on the feature with your name');
  assert.ok([...d.querySelectorAll('.hint')].some((x) => text(x)
    === 'Your reason is recorded on the feature. The preview then adds it at the top of the description: “Exported before Ready: <your reason>”.'));
  assert.equal(document.activeElement, q('export-reason'));
  assert.equal(q('export-anyway').disabled, true);
  typeReason('The team estimates in Jira tomorrow.');
  assert.equal(text(d.querySelector('.req-dlg-count')), '36 / 500');
  q('export-anyway').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.url === PREVIEW_URL).body, { mode: 'create', reason: 'The team estimates in Jira tomorrow.' });
  assert.equal(text(dlg().querySelector('.req-export-desc p')), 'Exported before Ready: The team estimates in Jira tomorrow.');
});

test('board 28: with a ticket: Export FEAT-7 again, the three choices, what changed; Continue previews Update SHOP-123', async () => {
  const { host, calls } = await openFeature(feature({ export: XV({ link: LINK }) }), { ...SETUP_ROUTES(), [`POST ${PREVIEW_URL}`]: (b) => AGAIN({ mode: b.mode }) });
  q('menu-export', host).click();
  q('mi-export', host).click();
  assert.equal(document.activeElement, dlg().querySelector('h2'), 'the focus starts in the dialog, on its title');
  await settle();
  const d = dlg();
  assert.equal(document.activeElement, q('again-update'), 'then on the default choice once the choices loaded');
  assert.equal(text(d.querySelector('h2')), 'Export FEAT-7 again');
  assert.equal(text(d.querySelector('#req-again-desc')), 'SHOP-123 was made on 26 Oct. The spec has changed since. What should happen?');
  const group = d.querySelector('[role="radiogroup"]');
  assert.equal(group.getAttribute('aria-label'), 'What should happen');
  assert.deepEqual([...group.querySelectorAll('.req-export-mode')].map((m) => [text(m.querySelector('b')), text(m.querySelector('.hint'))]), [
    ['Update SHOP-123', 'Rewrites its summary, description and fields.'],
    ['Add a comment to SHOP-123', 'Lists what changed since the last export. The description stays.'],
    ['Create a new ticket', 'For example when the feature was split.']]);
  assert.equal(q('again-update').checked, true);
  assert.equal(text(d.querySelector('#req-again-chg')), 'What changed since the last export (26 Oct)');
  assert.deepEqual([...d.querySelectorAll('.req-export-change')].map(text), ['Added R-po-6 An order with some items shipped can cancel only the items not yet picked up.',
    'Business rules: 1 line changed', 'Edge cases: 1 line added']);
  assert.equal(text(d.querySelector('.req-export-change code')), 'R-po-6');
  assert.ok([...d.querySelectorAll('.hint')].some((x) => text(x) === 'The preview shows the result before anything is sent.'));
  assert.deepEqual(calls.find((c) => c.url === PREVIEW_URL).body, { mode: 'update' }, 'the tracker is asked first (gone, edited)');
  q('again-continue').click();
  await settle();
  assert.deepEqual(calls.filter((c) => c.url === PREVIEW_URL).at(-1).body, { mode: 'update' });
  assert.equal(text(q('export-go')), 'Update SHOP-123');
  assert.equal(text(dlg().querySelector('.req-dlg-lead')), 'This is the ticket Worca will update in SHOP. Change the issue type, labels or priority for this export.');
});

test('again: with nothing changed it says so and Add a comment is disabled; Create a new ticket previews mode new', async () => {
  const { calls } = await openExport(feature({ export: XV({ link: LINK }) }), { [`POST ${PREVIEW_URL}`]: (b) => AGAIN({ mode: b.mode, changes: [] }) });
  const d = dlg();
  assert.equal(text(d.querySelector('#req-again-desc')), 'SHOP-123 was made on 26 Oct. The spec has not changed since the last export (26 Oct).');
  assert.equal(q('again-comment').disabled, true);
  assert.equal(d.querySelector('.req-export-changes').hidden, true);
  q('again-new').click();
  q('again-continue').click();
  await settle();
  assert.deepEqual(calls.filter((c) => c.url === PREVIEW_URL).at(-1).body, { mode: 'new' });
  assert.equal(text(q('export-go')), 'Create in Jira');
});

test('board 28: edited in Jira since the last export: the alert, Update anyway (a forced update) and Add a comment instead', async () => {
  const { calls } = await openExport(feature({ export: XV({ link: LINK }) }), { [`POST ${PREVIEW_URL}`]: (b) => AGAIN({ mode: b.mode, edited: true }),
    [`POST ${EXPORT_URL}`]: () => exportAnswer('updated', 'SHOP-123') });
  const alert = dlg().querySelector('[role="alert"]');
  assert.equal(text(alert), 'SHOP-123 was edited in Jira since your last export. Updating replaces its description.');
  assert.equal(text(alert.querySelector('b')), 'SHOP-123 was edited in Jira since your last export.');
  assert.equal(q('again-continue').hidden, true);
  assert.deepEqual(['export-update-anyway', 'export-comment-instead', 'export-edited-cancel'].map((u) => text(q(u))), ['Update anyway', 'Add a comment instead', 'Cancel']);
  q('again-comment').click();
  assert.deepEqual([q('again-continue').hidden, text(dlg().querySelector('[role="alert"]'))], [false, ''], 'another choice: no alert');
  q('again-update').click();
  q('export-update-anyway').click();
  await settle();
  assert.equal(text(q('export-go')), 'Update SHOP-123');
  q('export-go').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.url === EXPORT_URL).body, { mode: 'update', previewHash: 'h1', force: true });
});

test('board 28: Add a comment: the comment itself, Back to the choices, Add comment sends it with its hash', async () => {
  const COMMENT = 'Updated in Worca since the last export (26 Oct)\n\nAdded R-po-6 An order with some items shipped can cancel only the items not yet picked up.\n\n'
    + 'Business rules: “Packed but not picked up still counts as not shipped.” was “Packed orders count as shipped.”\n\nFrom Worca FEAT-7\n';
  const { host, calls } = await openExport(feature({ export: XV({ link: LINK }) }), { [`POST ${PREVIEW_URL}`]: (b) => (b.mode === 'comment'
    ? AGAIN({ mode: 'comment', ticket: null, fields: null, comment: COMMENT, previewHash: 'c1' }) : AGAIN({ mode: b.mode })),
    [`POST ${EXPORT_URL}`]: () => exportAnswer('commented', 'SHOP-123') });
  q('again-comment').click();
  q('again-continue').click();
  await settle();
  const d = dlg();
  assert.equal(text(d.querySelector('h2')), 'Comment on SHOP-123');
  assert.equal(document.activeElement, d.querySelector('h2'), 'the focus is in the dialog, on its title');
  assert.equal(text(d.querySelector('.req-dlg-lead')), 'This comment is added to SHOP-123. Its description and fields stay as they are.');
  const box = d.querySelector('[aria-label="Comment preview"]');
  assert.deepEqual([box.getAttribute('tabindex'), [...box.querySelectorAll('p')].map(text)], ['0', ['Updated in Worca since the last export (26 Oct)',
    'Added R-po-6 An order with some items shipped can cancel only the items not yet picked up.',
    'Business rules: “Packed but not picked up still counts as not shipped.” was “Packed orders count as shipped.”', 'From Worca FEAT-7']]);
  q('comment-back').click();
  await settle();
  assert.equal(text(dlg().querySelector('h2')), 'Export FEAT-7 again');
  q('again-comment').click();
  q('again-continue').click();
  await settle();
  q('comment-add').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.url === EXPORT_URL).body, { mode: 'comment', previewHash: 'c1' });
  assert.equal(text(host.querySelector('.req-export-done')), 'Commented on SHOP-123');
});

test('D17: the History card right under the header, newest first, as board 28 writes it; none without an export', async () => {
  const at = (action, when, extra = {}) => ({ action, tracker: 'Jira', key: 'SHOP-123', url: 'https://acme.test/browse/SHOP-123', reason: null, when,
    by: 'Ann Example', ...extra });
  const history = [at('forgot', '28 Oct, 08:00'), at('commented', '27 Oct, 09:15'), at('updated', '27 Oct, 09:00'), at('linked', '26 Oct, 11:00', { by: null }),
    at('new', '26 Oct, 10:50', { key: 'SHOP-124', url: 'https://acme.test/browse/SHOP-124' }), at('created', '26 Oct, 10:42', { reason: 'Estimating tomorrow.' })];
  const { host } = await openFeature(feature({ export: XV({ history }) }));
  const card = host.querySelector('.req-history');
  assert.equal(host.querySelector('.req-head').nextElementSibling, card);
  assert.equal(text(document.getElementById(card.getAttribute('aria-labelledby'))), 'History');
  assert.deepEqual([...card.querySelectorAll('li')].map((li) => [text(li.firstChild), text(li.querySelector('.hint'))]), [
    ['Forgot the link to SHOP-123 · 28 Oct, 08:00', 'Ann Example'],
    ['Commented on SHOP-123 in Jira · 27 Oct, 09:15', 'Ann Example'],
    ['Updated SHOP-123 in Jira · 27 Oct, 09:00', 'Ann Example'],
    ['Linked SHOP-123, which an earlier export made · 26 Oct, 11:00', null],
    ['Exported to Jira as SHOP-124 · 26 Oct, 10:50', 'Ann Example'],
    ['Exported to Jira as SHOP-123 · 26 Oct, 10:42 · before Ready: Estimating tomorrow.', 'Ann Example']]);
  const a = card.querySelector('li:last-child a');
  assert.deepEqual([text(a), a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')], ['SHOP-123', 'https://acme.test/browse/SHOP-123', '_blank', 'noopener']);
  assert.equal((await openFeature(feature())).host.querySelector('.req-history'), null);
});
```

- [ ] **Step 2: Run it and see it fail.** `node tools/test.mjs test/requirements-view-export.test.mjs` → the Task 8 tests pass; the new ones FAIL (Export to Jira… with a setup closes nothing / no preview dialog).

- [ ] **Step 3: The chip, the done line and the History card in the page.** In `header(f)`:
  - in `.req-chips`, after `f.savedPath ? h('span', { class: 'chip', text: `Saved as ${f.savedPath}` }) : null` add `, exportChip(f)` (A6 board 28: after the header chips)
  - right after the `.req-chips` div (still inside `.req-head-main`) add `exportDoneLine(f),`

  In `paintFeature`, after `header(f),` add `historyCard(f),`.

- [ ] **Step 4: The dialogs.** In the A6 section, replace

```js
  // Task 9 gives this its body (Not Ready, Export again, the preview); until then the setup is where an export stops.
  function continueExport(_f, _trigger) { closeDialog(true); }
```

  with:

```js
  /** After the setup (or with one): Not Ready asks for a reason first (D5); a feature with a ticket chooses what happens (D7);
   *  else the preview of a create (D6). */
  function continueExport(f, trigger) {
    const next = (reason) => (linkOf(f) ? openAgain(f, { reason, trigger }) : openPreview(f, { mode: 'create', reason, trigger }));
    if (f.readiness && f.readiness.ok) next(null);
    else openExportNotReady(f, trigger, next);
  }

  /** Markdown as the tracker will show it (D6): headings, lists and paragraphs as text nodes, never HTML. */
  function mdBlocks(md) {
    const out = [];
    let list = null;
    for (const line of String(md || '').split('\n')) {
      const hd = /^#{1,6}\s+(.*)$/.exec(line);
      const li = /^(?:(-)|\d+\.)\s+(.*)$/.exec(line);
      if (hd) { list = null; out.push(h('h4', { text: hd[1] })); }
      else if (li) {
        const tag = li[1] ? 'ul' : 'ol';
        if (!list || list.tagName.toLowerCase() !== tag) { list = h(tag); out.push(list); }
        list.append(h('li', { text: li[2] }));
      } else if (line.trim()) { list = null; out.push(h('p', { class: /^From Worca /.test(line) ? 'req-export-sig' : null, text: line })); }
      else list = null;
    }
    return out;
  }

  /** A dialog's state area (boards 28, 29): one persistent role=alert line (its text changes, the node stays), an optional
   *  hint and the state's own buttons. `warn`: the amber caution of board 28's edited alert, not an error. */
  function stateBox() {
    const alert = h('p', { class: 'form-msg err req-export-alert', role: 'alert' });
    const hint = h('p', { class: 'hint req-export-alert-hint', hidden: true });
    const btns = h('div', { class: 'req-export-alert-btns', hidden: true });
    return {
      els: [alert, hint, btns],
      clear() { alert.replaceChildren(); alert.classList.remove('is-warn'); hint.hidden = true; hint.textContent = ''; btns.hidden = true; btns.replaceChildren(); },
      show(kids, { note = null, buttons = [], warn = false } = {}) {
        alert.replaceChildren(...[].concat(kids));
        alert.classList.toggle('is-warn', warn);
        hint.textContent = note || '';
        hint.hidden = !note;
        btns.replaceChildren(...buttons);
        btns.hidden = !buttons.length;
      },
    };
  }
  /** A ticket gone from the tracker, as the server says it (D11). */
  const goneError = (key, name) => ({ status: 409, data: { gone: true, error: `${key} no longer exists in ${name}.` } });
  /** A failure in an export dialog. Task 10 gives board 29's states (Try again, Change the export setup, Forget the link / New
   *  ticket, a fresh preview); here, the server's sentence. */
  function showFailure(box, err) { box.show(errText(err)); }
  /** Board 28: the description was edited in the tracker since the last export (D9). */
  function editedState(box, key, name, { onUpdate, onComment }) {
    box.show([h('b', { text: `${key} was edited in ${name} since your last export.` }), ' Updating replaces its description.'], { warn: true, buttons: [
      h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'export-update-anyway', onclick: onUpdate }, 'Update anyway'),
      h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'export-comment-instead', onclick: onComment }, 'Add a comment instead'),
      h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'export-edited-cancel', onclick: () => closeDialog(true) }, 'Cancel'),
    ] });
  }

  /** Send what the dialog previewed (D6, D13): "Exporting to <tracker>…" on its status line and its buttons wait; on success
   *  the dialog closes and the page says what happened. A late answer for a dialog that is gone only repaints the feature
   *  when the host still shows it (paintedKey; the frame does that too). */
  async function sendExport(f, g, { name, body, statusEl, buttons, setBusy, onFail }) {
    setBusy(true);
    for (const b of buttons) b.disabled = true;
    statusEl.replaceChildren(h('span', { class: 'badge blue', text: `Exporting to ${name}…` }));
    try {
      const res = await api('POST', exportUrl(f), body);
      setBusy(false);
      statusEl.replaceChildren();
      if (!live(g)) { if (paintedKey === `feature/${f.seq}`) void paint(); return; }
      closeDialog(false);
      exported(f, res);
    } catch (err) {
      setBusy(false);
      statusEl.replaceChildren();
      for (const b of buttons) b.disabled = false;
      if (live(g)) onFail(err);
    }
  }
  /** After an export: "Created SHOP-123" (or Updated, Commented on) on the header's status line, the page from the answer,
   *  the focus on the chip. Another feature on screen keeps its paint. */
  function exported(f, res) {
    const verb = { created: 'Created', new: 'Created', updated: 'Updated', commented: 'Commented on' }[res.action] || 'Exported';
    exportDone = { seq: f.seq, text: `${verb} ${res.key}` };
    if (seqShown !== f.seq) return;
    paintNo += 1;   // a fetch already under way would paint the feature as it was before the export
    if (res.feature) { paintFeature(res.feature, res.turns || []); paintedKey = `feature/${seqShown}`; }
    const chip = host.querySelector('[data-ui="export-chip"]');
    if (chip) chip.focus();
  }

  /** Board 27's first dialog (D5): the failing checks as the Start dialog lists them, with the board's words for open questions
   *  and undecided assumptions; a required reason (1–500) that the preview puts at the top of the description. */
  function openExportNotReady(f, trigger, then) {
    closeDialog(false);
    const failing = failingChecks(f);
    const spec = f.spec || {};
    const openQ = spec.openQuestions || [];
    const openA = (spec.assumptions || []).filter((a) => a.status === 'open').map((a) => a.id);
    const line = (c) => {
      if (c.key === 'openQuestions' && openQ.length) return [h('b', { text: `${openQ.length} open question${openQ.length === 1 ? '' : 's'}.` }), ` ${openQ[0]}`];
      if (c.key === 'assumptions' && openA.length) {
        return [h('b', { text: `${joinAnd(openA)} ${openA.length === 1 ? 'is' : 'are'} not decided.` }), ' The ticket lists confirmed assumptions only.'];
      }
      return [h('b', { text: c.label || sentence(c.key) }), c.hint ? `: ${c.hint}` : ''];
    };
    const area = h('textarea', { id: 'req-exp-reason', rows: '3', maxlength: String(REASON_MAX), 'aria-required': 'true',
      'aria-describedby': 'req-exp-count req-exp-reason-h', 'data-ui': 'export-reason' });
    const count = h('span', { class: 'hint req-dlg-count', id: 'req-exp-count', text: `0 / ${REASON_MAX}` });
    const go = h('button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'export-anyway', disabled: true }, 'Export anyway');
    area.addEventListener('input', () => { count.textContent = `${area.value.length} / ${REASON_MAX}`; go.disabled = !area.value.trim(); });
    go.addEventListener('click', () => { const why = area.value.trim(); if (why) then(why); });
    const card = h('section', { class: 'card req-dialog req-export req-export-notready', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'req-exp-nr-title' },
      backButton(f),
      h('h2', { id: 'req-exp-nr-title', text: `Export ${f.id} before it’s Ready?` }),
      h('p', { class: 'req-dlg-lead', text: failing.length === 1 ? 'One check does not pass yet:' : `${failing.length} checks do not pass yet:` }),
      h('div', { class: 'req-dlg-fail' }, h('ul', {}, ...failing.map((c) => h('li', {}, icon(ICONS.circle, { label: 'Not passed' }), h('span', {}, ...line(c)))))),
      h('div', { class: 'field req-dlg-field' },
        h('label', { for: 'req-exp-reason' }, 'Why export before it is Ready? ', h('span', { class: 'opt', text: 'required, kept on the feature with your name' })),
        area, count),
      h('p', { class: 'hint', id: 'req-exp-reason-h',
        text: 'Your reason is recorded on the feature. The preview then adds it at the top of the description: “Exported before Ready: <your reason>”.' }),
      h('div', { class: 'req-dlg-btns' }, h('button', { type: 'button', class: 'btn', 'data-ui': 'export-keep', onclick: () => closeDialog(true) }, 'Keep deciding'), go));
    openModal(card, { trigger, first: area, page: true });
  }

  /** Board 27 (D6): the ticket as the tracker will show it; only this is sent. Issue type, labels and priority change for this
   *  export only, and each change asks for a fresh preview (and hash). `mode`: create, update or new. */
  function openPreview(f, { mode, reason = null, force = false, trigger = null } = {}) {
    closeDialog(false);
    const name = trackerName(f) || 'the tracker';
    const st = { issueType: undefined, issueTypeName: null, labels: null, priority: undefined, priorityName: null, types: null, prios: null };
    let data = null; let busy = false; let n = 0; let forceNow = force; let focusAfter = null;
    const lead = h('p', { class: 'req-dlg-lead' });
    const fieldsEl = h('div', { class: 'req-export-fields' });
    const desc = h('div', { class: 'req-export-desc folded', id: 'req-exp-desc', tabindex: '0', 'aria-label': 'Description preview' });
    const more = h('button', { type: 'button', class: 'btn req-export-more', 'data-ui': 'export-more', 'aria-expanded': 'false', 'aria-controls': 'req-exp-desc',
      onclick: () => { desc.classList.remove('folded'); more.setAttribute('aria-expanded', 'true'); more.hidden = true; desc.focus(); } }, 'Show all');
    const box = stateBox();
    const statusEl = h('p', { class: 'req-export-status', role: 'status' });
    const cancel = h('button', { type: 'button', class: 'btn', 'data-ui': 'export-cancel', onclick: () => { if (!busy) closeDialog(true); } }, 'Cancel');
    const go = h('button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'export-go', disabled: true });
    // Board 31 (user decision 2026-10-26): at 900 px and narrower CSS hides the title's "FEAT-7 " ("Export to Jira") and shows
    // "FEAT-7 · <title>" under it; one h2 still labels the dialog, and takes the focus on open (D20).
    const title = h('h2', { id: 'req-exp-title', class: 'req-export-title', tabindex: '-1' },
      'Export ', h('span', { class: 'req-export-tid', text: `${f.id} ` }), `to ${name}`);
    const card = h('section', { class: 'card req-dialog req-export req-export-preview', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'req-exp-title' },
      backButton(f),
      title,
      h('p', { class: 'hint req-export-sub', text: `${f.id} · ${f.title}` }),
      lead,
      h('div', { class: 'req-export-grid' },
        h('div', { class: 'req-export-col', role: 'group', 'aria-labelledby': 'req-exp-fields-h' }, h('h3', { id: 'req-exp-fields-h', text: 'Fields' }), fieldsEl),
        h('div', { class: 'req-export-col', role: 'group', 'aria-labelledby': 'req-exp-desc-h' },
          h('h3', { id: 'req-exp-desc-h', text: `Description, as ${name} will show it` }), desc, more)),
      ...box.els,
      h('div', { class: 'req-export-foot' }, h('span', { class: 'hint', text: `Only what you see here is sent to ${name}.` }), statusEl,
        h('div', { class: 'req-dlg-btns' }, cancel, go)));
    openModal(card, { trigger, first: title, canClose: () => !busy, page: true });
    const g = dlgGen;
    const key = () => (data && data.key) || (linkOf(f) || {}).key || '';
    const goLabel = () => (mode === 'update' ? `Update ${key()}` : `Create in ${name}`);
    go.textContent = goLabel();
    go.addEventListener('click', () => { if (data) void run(); else void load(); });
    const bodyOf = () => ({ mode, ...(reason ? { reason } : {}),
      ...(st.issueType !== undefined ? { issueType: st.issueType, issueTypeName: st.issueTypeName } : {}),
      ...(st.labels ? { labels: st.labels } : {}),
      ...(st.priority !== undefined ? { priority: st.priority, priorityName: st.priorityName } : {}) });
    const ctx = { f, name, key, reason, trigger, setBusy: (b) => { busy = b; },
      hideGo: (b) => { go.hidden = b; }, retryLabel: (t) => { go.textContent = t; go.disabled = false; },
      reload: () => load({ keep: true }), reopen: () => openPreview(f, { mode, reason, force: forceNow, trigger }) };
    const showEdited = () => {
      go.hidden = true;
      editedState(box, key(), name, { onUpdate: () => { forceNow = true; go.hidden = false; box.clear(); void run(); },
        onComment: () => openComment(f, { reason, trigger }) });
    };

    async function load({ keep = false } = {}) {
      const k = ++n;
      go.disabled = true;
      try {
        const d = await api('POST', exportUrl(f, '/preview'), bodyOf());
        if (!live(g) || k !== n) return;
        data = d;
        if (!keep) box.clear();
        go.hidden = false;
        go.textContent = goLabel();
        go.disabled = busy;
        fill();
        if (d.gone) { go.hidden = true; showFailure(box, goneError(key(), name), ctx); }
        else if (d.edited && mode === 'update' && !forceNow) showEdited();
        if (!st.types) void loadChoices();
      } catch (err) {
        if (!live(g) || k !== n) return;
        data = null;
        showFailure(box, err, ctx);
        if (!go.hidden) { go.textContent = 'Try again'; go.disabled = false; }
      }
    }
    async function loadChoices() {
      const fl = data && data.fields;
      if (!fl) return;
      try {
        const r = await api('POST', setupUrl(f, '/options'), { ...fl.conn, project: fl.project.value, issueType: fl.issueType.value });
        if (!live(g) || !data) return;
        st.types = r.issueTypes || [];
        st.prios = r.priorities || [];
        fill();
      } catch { /* the selects keep the current value alone */ }
    }
    function fill() {
      const fl = data.fields;
      const focus = focusAfter || (card.contains(document.activeElement) ? document.activeElement.getAttribute('data-ui') : null);
      focusAfter = null;
      lead.textContent = `This is the ticket Worca will ${mode === 'update' ? 'update' : 'create'} in ${fl.project.value}. Change the issue type, labels or priority for this export.`;
      const types = st.types && st.types.length ? st.types : [fl.issueType];
      const prios = [{ value: '', label: 'None' }, ...(st.prios && st.prios.length ? st.prios : fl.priority ? [fl.priority] : [])];
      const val = (t) => h('p', { class: 'req-export-val', text: t });
      fieldsEl.replaceChildren(
        exportField(null, 'Project', val(fl.project.label), `Saved in the export setup · ${fl.connection}`),
        exportField('req-exp-type', 'Issue type', exportSelect({ id: 'req-exp-type', ui: 'export-type', list: types, value: fl.issueType.value,
          onchange: (e) => { const o = types.find((x) => x.value === e.currentTarget.value); st.issueType = o.value; st.issueTypeName = o.label; st.types = null; st.prios = null; void load(); } })),
        exportField(null, 'Summary', val(fl.summary), "The feature's title"),
        labelsField({ id: 'req-exp-lab', ui: 'export-lab', labels: fl.labels.filter((l) => l !== fl.fixedLabel), fixed: fl.fixedLabel,
          onChange: (next, ui) => { st.labels = next; focusAfter = ui; void load(); } }),
        exportField('req-exp-prio', 'Priority', exportSelect({ id: 'req-exp-prio', ui: 'export-prio', list: prios, value: fl.priority ? fl.priority.value : '',
          onchange: (e) => { const o = prios.find((x) => x.value === e.currentTarget.value); st.priority = o.value || null; st.priorityName = o.value ? o.label : null; void load(); } })),
        fl.criteria.target === 'field'
          ? exportField(null, 'Acceptance criteria', [val(`→ ${fl.criteria.name}`), h('ul', { class: 'req-export-items' }, ...(fl.criteria.items || []).map((i) => h('li', { text: i })))])
          : exportField(null, 'Acceptance criteria', val('→ Description'), 'A section of the description, as in the export setup'));
      desc.replaceChildren(...mdBlocks(data.ticket.description));
      if (focus) { const el = card.querySelector(`[data-ui="${focus}"]`); if (el && !el.disabled) el.focus(); }
    }
    function run() {
      box.clear();
      return sendExport(f, g, { name, statusEl, buttons: [go, cancel], setBusy: ctx.setBusy,
        body: { ...bodyOf(), previewHash: data.previewHash, ...(forceNow ? { force: true } : {}) },
        onFail: (err) => (err && err.data && err.data.edited ? showEdited() : showFailure(box, err, ctx)) });
    }
    void load();
  }

  /** Board 28 (D7): Export FEAT-7 again. The tracker is asked first (gone, edited: D9, D11); then Update (the default), a
   *  comment (only when something changed) or a new ticket, and Continue shows that result's preview. */
  function openAgain(f, { reason = null, trigger = null } = {}) {
    closeDialog(false);
    const name = trackerName(f) || 'the tracker';
    let data = null; let mode = 'update'; let busy = false;
    const desc = h('p', { class: 'req-dlg-lead', id: 'req-again-desc' });
    const box = stateBox();
    const modes = h('div', { class: 'req-export-modes', role: 'radiogroup', 'aria-label': 'What should happen', hidden: true });
    const changes = h('div', { class: 'req-export-changes', role: 'group', 'aria-labelledby': 'req-again-chg', hidden: true });
    const note = h('p', { class: 'hint', hidden: true, text: 'The preview shows the result before anything is sent.' });
    const cont = h('button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'again-continue', disabled: true,
      onclick: () => (mode === 'comment' ? openComment(f, { reason, trigger }) : openPreview(f, { mode, reason, trigger })) }, 'Continue');
    const title = h('h2', { id: 'req-again-title', tabindex: '-1', text: `Export ${f.id} again` });
    const card = h('section', { class: 'card req-dialog req-export req-export-again', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'req-again-title', 'aria-describedby': 'req-again-desc' },
      backButton(f), title, desc, ...box.els, modes, changes, note,
      h('div', { class: 'req-dlg-btns' },
        h('button', { type: 'button', class: 'btn', 'data-ui': 'again-cancel', onclick: () => { if (!busy) closeDialog(true); } }, 'Cancel'), cont));
    openModal(card, { trigger, first: title, canClose: () => !busy, page: true });   // the title until the choices load (D20)
    const g = dlgGen;
    const key = () => (data && data.link && data.link.key) || (linkOf(f) || {}).key || '';
    const ctx = { f, name, key, reason, trigger, setBusy: (b) => { busy = b; }, hideGo: (b) => { cont.hidden = b; },
      retryLabel: () => {}, reload: () => {}, reopen: () => openAgain(f, { reason, trigger }) };
    const option = (value, title, hint, disabled = false) => {
      const r = h('input', { type: 'radio', name: 'req-again-mode', value, 'data-ui': `again-${value}`, disabled, onchange: () => { mode = value; fill(); } });
      r.checked = mode === value;
      return h('label', { class: `req-export-mode${disabled ? ' off' : ''}` }, r,
        h('span', { class: 'req-export-mode-txt' }, h('b', { text: title }), h('span', { class: 'hint', text: hint })));
    };
    const changeNode = (c) => {
      const i = c.id ? c.line.indexOf(c.id) : -1;
      return h('p', { class: 'req-export-change' }, ...(i >= 0 ? [c.line.slice(0, i), h('code', { text: c.id }), c.line.slice(i + c.id.length)] : [c.line]));
    };
    function fill() {
      const focus = card.contains(document.activeElement) ? document.activeElement.getAttribute('data-ui') : null;
      const L = data.link;
      const changed = data.changes.length > 0;
      desc.textContent = changed ? `${L.key} was made on ${L.madeOn}. The spec has changed since. What should happen?`
        : `${L.key} was made on ${L.madeOn}. The spec has not changed since the last export (${L.lastOn}).`;
      if (data.gone) {
        modes.hidden = true; changes.hidden = true; note.hidden = true; cont.hidden = true;
        showFailure(box, goneError(L.key, name), ctx);
        return;
      }
      if (!changed && mode === 'comment') mode = 'update';
      modes.replaceChildren(option('update', `Update ${L.key}`, 'Rewrites its summary, description and fields.'),
        option('comment', `Add a comment to ${L.key}`, 'Lists what changed since the last export. The description stays.', !changed),
        option('new', 'Create a new ticket', 'For example when the feature was split.'));
      modes.hidden = false;
      changes.replaceChildren(h('h3', { id: 'req-again-chg', text: `What changed since the last export (${L.lastOn})` }), ...data.changes.map(changeNode));
      changes.hidden = !changed;
      note.hidden = false;
      const warn = data.edited && mode === 'update';
      if (warn) editedState(box, L.key, name, { onUpdate: () => openPreview(f, { mode: 'update', reason, force: true, trigger }), onComment: () => openComment(f, { reason, trigger }) });
      else box.clear();
      cont.hidden = warn;
      cont.disabled = false;
      const el = focus && card.querySelector(`[data-ui="${focus}"]`);
      if (el) el.focus();
    }
    api('POST', exportUrl(f, '/preview'), { mode: 'update', ...(reason ? { reason } : {}) }).then((d) => {
      if (!live(g)) return;
      data = d;
      fill();
      // the default choice once the choices exist; a gone ticket keeps the focus on the title (its alert is announced)
      const first = card.querySelector('[data-ui="again-update"], [data-ui="again-new"]');
      if (first) first.focus();
    }, (err) => { if (live(g)) showFailure(box, err, ctx); });
  }

  /** Board 28: the comment itself before it is sent (D7); the description and fields stay. Back returns to the choices. */
  function openComment(f, { reason = null, trigger = null } = {}) {
    closeDialog(false);
    const name = trackerName(f) || 'the tracker';
    const linkKey = (linkOf(f) || {}).key || '';
    let data = null; let busy = false;
    const box = stateBox();
    const statusEl = h('p', { class: 'req-export-status', role: 'status' });
    const body = h('div', { class: 'req-export-desc req-export-comment', tabindex: '0', 'aria-label': 'Comment preview' });
    const back = h('button', { type: 'button', class: 'btn', 'data-ui': 'comment-back', onclick: () => { if (!busy) openAgain(f, { reason, trigger }); } }, 'Back');
    const add = h('button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'comment-add', disabled: true }, 'Add comment');
    const title = h('h2', { id: 'req-cm-title', tabindex: '-1', text: `Comment on ${linkKey}` });
    const card = h('section', { class: 'card req-dialog req-export req-export-commentdlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'req-cm-title' },
      backButton(f),
      title,
      h('p', { class: 'req-dlg-lead', text: `This comment is added to ${linkKey}. Its description and fields stay as they are.` }),
      body, ...box.els,
      h('div', { class: 'req-export-foot' }, h('span', { class: 'hint', text: `Only what you see here is sent to ${name}.` }), statusEl,
        h('div', { class: 'req-dlg-btns' }, back, add)));
    openModal(card, { trigger, first: title, canClose: () => !busy, page: true });
    const g = dlgGen;
    const ctx = { f, name, key: () => linkKey, reason, trigger, setBusy: (b) => { busy = b; }, hideGo: (b) => { add.hidden = b; },
      retryLabel: (t) => { add.textContent = t; add.disabled = false; }, reload: () => load({ keep: true }), reopen: () => openComment(f, { reason, trigger }) };
    async function load({ keep = false } = {}) {
      add.disabled = true;
      try {
        const d = await api('POST', exportUrl(f, '/preview'), { mode: 'comment', ...(reason ? { reason } : {}) });
        if (!live(g)) return;
        data = d;
        if (!keep) box.clear();
        add.hidden = false;
        add.textContent = 'Add comment';
        add.disabled = false;
        body.replaceChildren(...mdBlocks(d.comment));
        if (d.gone) { add.hidden = true; showFailure(box, goneError(linkKey, name), ctx); }
      } catch (err) {
        if (!live(g)) return;
        data = null;
        showFailure(box, err, ctx);
        if (!add.hidden) { add.textContent = 'Try again'; add.disabled = false; }
      }
    }
    add.addEventListener('click', () => {
      if (!data) { void load(); return; }
      box.clear();
      void sendExport(f, g, { name, statusEl, buttons: [add, back], setBusy: ctx.setBusy,
        body: { mode: 'comment', ...(reason ? { reason } : {}), previewHash: data.previewHash }, onFail: (err) => showFailure(box, err, ctx) });
    });
    void load();
  }

  /** Board 28: the ticket chip after the header chips: a link to the ticket, opened in a new tab. */
  function exportChip(f) {
    const l = linkOf(f);
    if (!l) return null;
    const label = `${l.key}, opens the ticket in ${l.tracker || 'the tracker'} in a new tab`;
    return l.url
      ? h('a', { class: 'chip req-export-chip', 'data-ui': 'export-chip', href: l.url, target: '_blank', rel: 'noopener', 'aria-label': label },
        h('span', { text: l.key }), sharedIcon(document, 'external', 12))
      : h('span', { class: 'chip req-export-chip', text: l.key });
  }
  /** Board 29: "Created SHOP-123", one role=status node kept across paints (only its text changes are announced). */
  function exportDoneLine(f) {
    if (!xOf(f) || (!xOf(f).tracker && !linkOf(f))) return null;
    if (!exportDoneEl) exportDoneEl = h('p', { class: 'req-export-done', role: 'status' });
    const want = exportDone && exportDone.seq === f.seq ? exportDone.text : '';
    if (exportDoneEl.dataset.text !== want) {
      exportDoneEl.dataset.text = want;
      exportDoneEl.replaceChildren(...(want ? [icon(ICONS.check, { size: 14, width: 2.4 }), want] : []));
    }
    return exportDoneEl;
  }
  /** D17: the History card, its export lines only, newest first; shown once the feature has one. */
  function historyCard(f) {
    const list = (xOf(f) && xOf(f).history) || [];
    if (!list.length) return null;
    const keyLink = (x) => (x.url ? h('a', { href: x.url, target: '_blank', rel: 'noopener', text: x.key }) : x.key);
    const tracker = (x) => x.tracker || 'the tracker';
    const LINE = {
      created: (x) => [`Exported to ${tracker(x)} as `, keyLink(x)], new: (x) => [`Exported to ${tracker(x)} as `, keyLink(x)],
      updated: (x) => ['Updated ', keyLink(x), ` in ${tracker(x)}`], commented: (x) => ['Commented on ', keyLink(x), ` in ${tracker(x)}`],
      linked: (x) => ['Linked ', keyLink(x), ', which an earlier export made'], forgot: (x) => ['Forgot the link to ', keyLink(x)],
    };
    return h('section', { class: 'card req-history', 'aria-labelledby': 'req-history-h' },
      h('h3', { id: 'req-history-h', text: 'History' }),
      h('ul', { class: 'req-history-list' }, ...list.filter((x) => LINE[x.action]).map((x) => h('li', {},
        h('span', {}, ...LINE[x.action](x), x.when ? ` · ${x.when}` : '', x.reason ? ` · before Ready: ${x.reason}` : ''),
        x.by ? h('span', { class: 'hint', text: x.by }) : null))));
  }
```

- [ ] **Step 5: The CSS.** Append inside the Requirements block, after Task 8's A6 rules:

```css
/* Board 27: the preview (1000 px): Fields beside the description as the tracker will show it, then the footer. The description
   box scrolls inside; on a phone it folds behind Show all (Task 10). */
.req-dlg-wrap .card.req-dialog.req-export-preview{width:min(1000px,100%)}
.viewer-modal.req-dlg-wrap.req-dlg-sheet{padding-top:min(8vh,48px)}
.req-export-grid{display:grid;grid-template-columns:320px minmax(0,1fr);gap:24px;align-items:start}
.req-export-col{display:flex;flex-direction:column;gap:8px;min-width:0}
.req-export-col h3,.req-export-changes h3{margin:0;font-size:var(--fs-body);font-weight:700}
.req-export-fields{display:flex;flex-direction:column;gap:14px}
.req-export-val{margin:0;font-size:var(--fs-body);color:var(--ink);overflow-wrap:anywhere}
.req-export-items{margin:0;padding-left:18px;font-size:var(--fs-meta);color:var(--ink-2)}
.req-export-desc{max-height:548px;overflow:auto;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--bg);
  font-size:var(--fs-body);line-height:1.5;color:var(--ink);overflow-wrap:anywhere}
.req-export-desc:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.req-export-desc h4{margin:12px 0 4px;font-size:var(--fs-body);font-weight:700}
.req-export-desc h4:first-child{margin-top:0}
.req-export-desc p,.req-export-desc ul,.req-export-desc ol{margin:0 0 6px}
.req-export-desc ul,.req-export-desc ol{padding-left:20px}
.req-export-desc .req-export-sig{margin-top:10px;padding-top:8px;border-top:1px solid var(--line);color:var(--ink-2)}
.req-export-comment{max-height:360px}
.req-export-more{display:none}
.req-export-more[hidden]{display:none}
.req-export-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 12px;padding-top:14px;border-top:1px solid var(--line)}
.req-export-foot > .hint{margin:0}
.req-export-foot .req-dlg-btns{margin:0 0 0 auto}
.req-export-status{margin:0}
.req-export-status:empty{display:none}
.req-export-status .badge.blue{color:var(--blue-ink-strong)}   /* AA on --blue-bg (5.0:1; --blue-ink is 3.6:1), as .req-reading's */
/* Board 31 (user decision 2026-10-26): at 900 px and narrower the preview's title is "Export to Jira" over "FEAT-7 · <title>". */
.req-export-sub{display:none;margin:-4px 0 0}
@media (max-width:900px){
  .req-export-title .req-export-tid{display:none}
  .req-export-sub{display:block}
}
.req-export-alert.is-warn{padding:10px 12px;border:1px solid var(--amber-bg);border-radius:var(--r-md);background:var(--amber-wash);color:var(--ink)}
.req-export-alert.is-warn b{font-weight:600}
.req-export-alert-hint{margin:0}
.req-export-alert-btns{display:flex;flex-wrap:wrap;gap:8px}
.req-export-alert-btns[hidden]{display:none}
/* Board 28: Export again — the choices as radio cards (the picked one has an ink border, never a fill), what changed. */
.req-export-modes{display:flex;flex-direction:column;gap:8px}
.req-export-modes[hidden],.req-export-changes[hidden]{display:none}
.req-export-mode{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-md);cursor:pointer}
.req-export-mode:has(input:checked){border-color:var(--ink)}
.req-export-mode.off{cursor:not-allowed;color:var(--ink-3)}
.req-export-mode input{margin:3px 0 0}
.req-export-mode-txt{display:flex;flex-direction:column;gap:2px;font-size:var(--fs-body)}
.req-export-mode-txt b{font-weight:600}
.req-export-mode-txt .hint{margin:0}
.req-export-changes{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border-radius:var(--r-md);background:var(--field)}
.req-export-change{margin:0;font-size:var(--fs-body)}
.req-export-change code{font-size:var(--fs-meta)}
/* Board 28: the ticket chip after the header chips (the shared external icon), the History card; board 29: Created SHOP-123. */
a.chip.req-export-chip{display:inline-flex;align-items:center;gap:4px;text-decoration:none;color:var(--ink-2)}
a.chip.req-export-chip:hover{color:var(--ink)}
a.chip.req-export-chip:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.req-export-done{display:flex;align-items:center;gap:6px;margin:6px 0 0;font-size:var(--fs-body);color:var(--ink)}
.req-export-done:empty{display:none}
.req-export-done > svg{flex:none;color:var(--green-ink-strong)}
.req-history{display:flex;flex-direction:column;gap:8px}
.req-history h3{margin:0;font-size:var(--fs-section);font-weight:600}
.req-history-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.req-history-list li{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;padding:8px 0;border-top:1px solid var(--line);font-size:var(--fs-body)}
.req-history-list li:first-child{border-top:0}
.req-history-list .hint{margin:0}
```

- [ ] **Step 6: Run and see it pass.** `node tools/test.mjs test/requirements-view-export.test.mjs` → pass. Then `node tools/test.mjs test/requirements-view.test.mjs`, `node tools/test.mjs test/requirements-view-files.test.mjs`, `node tools/test.mjs test/ui-design-language.test.mjs` → pass (compare a failure with `<baseline>`).

- [ ] **Step 7: Commit.**

```bash
git add ui/public/requirements-view.mjs ui/public/style.css test/requirements-view-export.test.mjs
git commit -m "Requirements: export preview, Export anyway, Export again with the comment preview, the chip and the History card" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: The page — board 29's states, Report back, the phone sheet, leaving the view

**Files:**
- Modify: `ui/public/requirements-view.mjs` (replace `showFailure`; add `forgotten`, `reportRow`; `buildCard`, `openStartDialog`, `runsCard`, `postStart`; the returned object gains `leave`)
- Modify: `ui/public/app.js` (the `showView` line that shows the Requirements page, ~line 38648)
- Modify: `ui/public/style.css` (the Requirements block)
- Modify: `test/requirements-view-export.test.mjs` (append)

**Interfaces:**
- Consumes: Tasks 8–9 (`stateBox`, `showFailure`'s `ctx`, `openSetup`, `openPreview`, `exportUrl`, `linkOf`, `xOf`, `reportBack`); `makeSwitch` (`ui/public/switch.mjs`, the one switch, already imported by the page); `DELETE /api/requirements/:seq/export/link`; `POST /api/requirements/:seq/start` `{ reportBack }` (Task 7).
- Produces:
  - `showFailure(box, err, ctx)`: 502 → the sentence, "Nothing was recorded…", the main button "Try again"; `refused` → the sentence and **Change the export setup** (the setup, then back to this dialog); `gone` → the sentence, its hint, **Forget the link** and **New ticket**; `stale` → the sentence and a fresh preview; else the sentence
  - `forgotten(f, data)`, `reportRow(f, where)` (`where`: `card` | `dialog` | `runs`; `data-ui="report-<where>"`)
  - the view's `leave()`: closes any dialog (releasing the inert page); `app.js` calls it whenever another view is shown
  - `data-ui`: `export-change-setup`, `export-forget`, `export-new`, `report-card`, `report-dialog`, `report-runs`

- [ ] **Step 1: Write the failing tests.** Append to `test/requirements-view-export.test.mjs`:

```js
// ── Task 10: board 29's states, Report back, the phone sheet, leaving the view ──
test('board 29 (1): Worca cannot reach Jira: the sentence (role=alert), "Nothing was recorded…", Try again sends again; the preview stays', async () => {
  let fail = true;
  const { calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview(),
    [`POST ${EXPORT_URL}`]: () => (fail ? { __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' } }
      : exportAnswer('created', 'SHOP-123')) });
  q('export-go').click();
  await settle();
  const d = dlg();
  assert.ok(d, 'the preview stays open');
  assert.equal(text(d.querySelector('[role="alert"]')), 'Worca could not reach Jira: the API token was refused.');
  assert.equal(text(d.querySelector('.req-export-alert-hint')),
    'Nothing was recorded. The preview stays open, so you can try again once the connection is fixed on the Marketplace page (Installed › Jira).');
  assert.deepEqual([text(q('export-go')), q('export-go').disabled, q('export-cancel').disabled], ['Try again', false, false]);
  fail = false;
  q('export-go').click();
  await settle();
  assert.equal(calls.filter((c) => c.url === EXPORT_URL).length, 2);
  assert.equal(dlg(), null);
});

test('board 29 (2): Jira refuses a field: its sentence and Change the export setup, which comes back to the preview after Save', async () => {
  const { calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview(),
    [`POST ${EXPORT_URL}`]: () => ({ __status: 409, body: { error: 'Jira needs a value for “Team” in SHOP.', refused: true, field: 'Team' } }),
    [`GET ${SETUP_URL}`]: { setup: { ...CONN, trackerProject: 'SHOP', issueType: '10001', priority: null, labels: ['worca'], criteria: { target: 'description' } },
      trackers: TRACKERS, defaultProfile: CONN } });
  q('export-go').click();
  await settle();
  assert.equal(text(dlg().querySelector('[role="alert"]')), 'Jira needs a value for “Team” in SHOP.');
  q('export-change-setup').click();
  await settle();
  assert.deepEqual([text(dlg().querySelector('h2')), text(q('setup-save'))], ['Set up export for shop', 'Save and continue']);
  q('setup-save').click();
  await settle();
  assert.equal(text(dlg().querySelector('h2')), 'Export FEAT-7 to Jira');
  assert.equal(calls.filter((c) => c.url === PREVIEW_URL).length, 2, 'a fresh preview');
});

test('board 29 (3): the ticket is gone: the again dialog says so first; Forget the link drops the chip; New ticket previews mode new', async () => {
  const forgot = { feature: feature({ export: XV({ history: [{ action: 'forgot', tracker: 'Jira', key: 'SHOP-123', url: LINK.url, reason: null,
    when: '26 Oct, 11:00', by: 'Ann Example' }] }) }), turns: [] };
  const gone = { [`POST ${PREVIEW_URL}`]: (b) => AGAIN({ mode: b.mode, gone: b.mode === 'update' || b.mode === 'comment' }),
    [`DELETE ${EXPORT_URL}/link`]: () => forgot };
  let m = await openExport(feature({ export: XV({ link: LINK }) }), gone);
  const d = dlg();
  assert.equal(document.activeElement, d.querySelector('h2'), 'the focus stays in the dialog, on its title (no choices to focus)');
  assert.equal(text(d.querySelector('[role="alert"]')), 'SHOP-123 no longer exists in Jira.');
  assert.equal(text(d.querySelector('.req-export-alert-hint')),
    'It was deleted or moved where this connection cannot see it. Forget the link removes the SHOP-123 chip; the history keeps the export.');
  assert.deepEqual([d.querySelector('[role="radiogroup"]').hidden, q('again-continue').hidden], [true, true]);
  q('export-forget').click();
  await settle();
  assert.equal(dlg(), null);
  assert.equal(q('export-chip', m.host), null);
  assert.equal(document.activeElement, q('menu-export', m.host));
  assert.ok(m.calls.some((c) => c.method === 'DELETE' && c.url === `${EXPORT_URL}/link`));
  m = await openExport(feature({ export: XV({ link: LINK }) }), gone);
  q('export-new').click();
  await settle();
  assert.deepEqual(m.calls.filter((c) => c.url === PREVIEW_URL).at(-1).body, { mode: 'new' });
  assert.equal(text(q('export-go')), 'Create in Jira');
});

test('the spec changed since the preview: the sentence stays and a fresh preview comes', async () => {
  let n = 0;
  const { calls } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => { n += 1; return preview({ previewHash: `h${n}` }); },
    [`POST ${EXPORT_URL}`]: () => ({ __status: 409, body: { error: 'The spec changed since the preview. Look at the preview again.', stale: true } }) });
  q('export-go').click();
  await settle();
  assert.equal(text(dlg().querySelector('[role="alert"]')), 'The spec changed since the preview. Look at the preview again.');
  assert.equal(calls.filter((c) => c.url === PREVIEW_URL).length, 2);
  assert.equal(q('export-go').disabled, false);
});

test('D15, board 29 (6): Report back to SHOP-123 on the Ready to build card, on by default; the hint names the status or says it only comments', async () => {
  let m = await openFeature(feature({ export: XV({ link: LINK, doneStatus: 'Done' }) }),
    { [`POST ${F}/start`]: () => ({ runId: 'r1', version: 1, feature: feature(), turns: [] }) });
  const sw = q('report-card', m.host);
  assert.deepEqual([sw.getAttribute('role'), sw.type, sw.checked, text(sw.closest('label'))], ['switch', 'checkbox', true, 'Report back to SHOP-123']);
  assert.ok(sw.nextElementSibling.classList.contains('switch'), "upstream's switch (ink when on)");
  assert.equal(text(document.getElementById(sw.getAttribute('aria-describedby'))), 'When the run ends, Worca comments with the result and the pull request link, '
    + 'and moves the ticket to Done (the status named in the Jira connection; without one, it only comments).');
  sw.checked = false;
  sw.dispatchEvent(new window.Event('change'));
  q('start-go', m.host).click();
  await settle();
  assert.equal(m.calls.find((c) => c.url === `${F}/start`).body.reportBack, false);
  m = await openFeature(feature({ export: XV({ link: LINK }) }));
  assert.equal(text(document.getElementById(q('report-card', m.host).getAttribute('aria-describedby'))),
    'When the run ends, Worca comments with the result and the pull request link. The Jira connection names no status to move the ticket to, so it only comments.');
  m = await openFeature(feature());
  assert.equal(q('report-card', m.host), null, 'no ticket, no row');
});

test('D15: the start-before-Ready dialog and the runs card carry the same switch; the start sends reportBack', async () => {
  const f = feature({ readiness: readiness(['openQuestions']), state: 'decide', export: XV({ link: LINK }) });
  const { host, calls } = await openFeature(f, { [`POST ${F}/start`]: () => ({ runId: 'r1', version: 1, feature: f, turns: [] }) });
  q('start-anyway', host).click();
  await settle();
  const sw = q('report-dialog');
  assert.deepEqual([sw.checked, text(sw.closest('label'))], [true, 'Report back to SHOP-123']);
  const area = document.getElementById('req-dlg-reason');
  area.value = 'Now.';
  area.dispatchEvent(new window.Event('input'));
  [...dlg().querySelectorAll('.btn-primary')].at(-1).click();
  await settle();
  assert.equal(calls.find((c) => c.url === `${F}/start`).body.reportBack, true);
  const started = await openFeature(feature({ state: 'started', export: XV({ link: LINK }), changedSinceStart: [{ kind: 'goal', field: 'text', before: 'a', after: 'b' }],
    starts: [{ version: 1, runId: 'r1', run: { status: 'running', phase: 'build', costUsd: 0.1, href: '#running/r1' }, failing: [], files: [] }] }));
  assert.ok(q('report-runs', started.host), 'the runs card has it too');
});

test('D20: an export dialog makes every other child of <body> inert; Back closes it and releases; leave() closes it and releases', async () => {
  const { host, nav, view } = await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview() });
  const d = dlg();
  assert.deepEqual([d.getAttribute('role'), d.getAttribute('aria-modal'), d.closest('.req-dlg-wrap').classList.contains('req-dlg-sheet')], ['dialog', 'true', true]);
  assert.deepEqual([nav.getAttribute('inert'), host.getAttribute('inert')], ['', '']);
  const back = q('export-back');
  assert.deepEqual([back.getAttribute('aria-label'), text(back)], ['Back to FEAT-7', '← FEAT-7']);
  back.click();
  assert.equal(dlg(), null);
  assert.deepEqual([nav.getAttribute('inert'), host.getAttribute('inert')], [null, null]);
  q('menu-export', host).click();
  q('mi-export', host).click();
  await settle();
  assert.ok(dlg());
  view.leave();
  assert.equal(dlg(), null, 'leaving the Requirements view closes the sheet');
  assert.deepEqual([nav.getAttribute('inert'), host.getAttribute('inert')], [null, null]);
});

test('a late answer for a dialog that is gone is dropped: a preview arriving after Cancel paints nothing', async () => {
  let release;
  const { host } = await openFeature(feature(), { ...SETUP_ROUTES(), [`POST ${PREVIEW_URL}`]: () => new Promise((r) => { release = () => r(preview()); }) });
  q('menu-export', host).click();
  q('mi-export', host).click();
  await settle();
  q('export-cancel').click();
  assert.equal(dlg(), null);
  release();
  await settle();
  assert.deepEqual([dlg(), document.querySelector('.req-export-desc')], [null, null]);
});

test('board 31: Show all unfolds the description and names what it controls', async () => {
  await openExport(feature(), { [`POST ${PREVIEW_URL}`]: () => preview() });
  const more = q('export-more');
  const desc = document.getElementById(more.getAttribute('aria-controls'));
  assert.deepEqual([text(more), more.getAttribute('aria-expanded'), desc.classList.contains('folded')], ['Show all', 'false', true]);
  more.click();
  assert.deepEqual([more.getAttribute('aria-expanded'), more.hidden, desc.classList.contains('folded'), document.activeElement], ['true', true, false, desc]);
});

test('CSS (board 31): at 600 px an export dialog is a fixed full-viewport sheet; buttons get 44 px hit areas; Back only there', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  const at = css.indexOf('.req-dlg-wrap.req-dlg-sheet .card.req-dialog.req-export{');
  assert.ok(at > 0 && at < end);
  const rule = css.slice(at, css.indexOf('}', at));
  for (const decl of ['position:fixed', 'inset:0', 'max-height:none', 'overflow-y:auto', 'border-radius:0']) assert.ok(rule.includes(decl), decl);
  const phone = css.lastIndexOf('@media (max-width:600px){', at);
  assert.ok(phone > 0 && css.slice(phone, at).split('}').length < 3, 'inside the 600 px media block');
  assert.match(css, /\.req-export \.req-dlg-btns \.btn::after,[^{]*\{content:"";position:absolute;inset:-6px 0\}/);
  assert.match(css, /\.req-export-back\{display:none\}/);
  assert.match(css, /\.req-export-back::after\{content:"";position:absolute;inset:-14px -8px\}/);
  // board 31's title (user decision 2026-10-26): at 900 px and narrower "Export to Jira" over "FEAT-7 · <title>"
  assert.match(css, /\.req-export-sub\{display:none[;}]/);
  assert.match(css, /@media \(max-width:900px\)\{\s*\.req-export-title \.req-export-tid\{display:none\}\s*\.req-export-sub\{display:block\}\s*\}/);
});
```

- [ ] **Step 2: Run it and see it fail.** `node tools/test.mjs test/requirements-view-export.test.mjs` → the Task 8–9 tests pass; the new ones FAIL (no Try again, no Change the export setup, no switch, `view.leave` is not a function).

- [ ] **Step 3: Board 29's states.** Replace Task 9's

```js
  /** A failure in an export dialog. Task 10 gives board 29's states (Try again, Change the export setup, Forget the link / New
   *  ticket, a fresh preview); here, the server's sentence. */
  function showFailure(box, err) { box.show(errText(err)); }
```

  with:

```js
  /** Board 29's states (D11, D12): a tracker that cannot be reached (nothing recorded; the main button tries again), a field it
   *  refuses (Change the export setup, then back here), a ticket that is gone (Forget the link, New ticket), a spec that
   *  changed under the preview (a fresh one). Anything else: the server's sentence. */
  function showFailure(box, err, ctx) {
    const dd = (err && err.data) || {};
    const { f, name, reason, trigger } = ctx;
    if (err && err.status === 502) {
      box.show(errText(err), { note: `Nothing was recorded. The preview stays open, so you can try again once the connection is fixed on the Marketplace page (Installed › ${name}).` });
      ctx.retryLabel('Try again');
    } else if (dd.refused) {
      box.show(errText(err), { buttons: [h('button', { type: 'button', class: 'btn', 'data-ui': 'export-change-setup',
        onclick: () => { void openSetup(f, { trigger, then: ctx.reopen }); } }, 'Change the export setup')] });
    } else if (dd.gone) {
      const key = ctx.key();
      ctx.hideGo(true);
      box.show(dd.error || `${key} no longer exists in ${name}.`, {
        note: `It was deleted or moved where this connection cannot see it. Forget the link removes the ${key} chip; the history keeps the export.`,
        buttons: [
          h('button', { type: 'button', class: 'btn', 'data-ui': 'export-forget', onclick: async () => {
            ctx.setBusy(true);
            try {
              const data = await api('DELETE', exportUrl(f, '/link'));
              ctx.setBusy(false);
              closeDialog(false);
              forgotten(f, data);
            } catch (e) { ctx.setBusy(false); box.show(errText(e)); }
          } }, 'Forget the link'),
          h('button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'export-new', onclick: () => openPreview(f, { mode: 'new', reason, trigger }) }, 'New ticket'),
        ] });
    } else if (dd.stale) {
      box.show(errText(err));
      ctx.reload();
    } else box.show(errText(err));
  }
  /** After Forget the link (D12): the page without the chip (the History card keeps the export); the focus on Export ▾. */
  function forgotten(f, data) {
    exportDone = null;
    if (seqShown !== f.seq) return;
    paintNo += 1;
    if (data && data.feature) { paintFeature(data.feature, data.turns || []); paintedKey = `feature/${seqShown}`; }
    const t = exportTrigger();
    if (t) t.focus();
  }

  /** D15, board 29 (6): Report back to SHOP-123, on by default once the feature has a ticket; the ticket moves only to the status
   *  its connection names. The shared switch (switch.mjs, ink when on). `where` keeps the ids apart: card, dialog, runs. */
  function reportRow(f, where) {
    const l = linkOf(f);
    if (!l) return null;
    const hintId = `req-report-hint-${where}`;
    const done = xOf(f).doneStatus;
    const name = l.tracker || 'the tracker';
    const { row, input } = makeSwitch(document, { label: `Report back to ${l.key}`, checked: reportBack.get(f.seq) !== false,
      rowClass: 'req-report-row', data: { ui: `report-${where}` } });
    input.setAttribute('aria-describedby', hintId);
    input.addEventListener('change', () => {
      reportBack.set(f.seq, input.checked);
      for (const o of document.querySelectorAll('[data-ui^="report-"]')) if (o !== input) o.checked = input.checked;
    });
    return h('div', { class: 'req-report' }, row,
      h('p', { class: 'hint req-report-hint', id: hintId, text: done
        ? `When the run ends, Worca comments with the result and the pull request link, and moves the ticket to ${done} (the status named in the ${name} connection; without one, it only comments).`
        : `When the run ends, Worca comments with the result and the pull request link. The ${name} connection names no status to move the ticket to, so it only comments.` }));
  }
```

- [ ] **Step 4: Report back on the start paths.**
  - `postStart(f, extra = {})` returns:

```js
    return api('POST', `/api/requirements/${f.seq}/start`, { ...extra, workflowId: c.workflowId || AUTO_WORKFLOW, ...(branch ? { sourceBranch: branch } : {}),
      ...(linkOf(f) ? { reportBack: reportBack.get(f.seq) !== false } : {}) });   // A6 D15
```

  - `buildCard(f)`: after `filesForRun(f))` closes `.req-build-main`'s children, i.e. replace `        filesForRun(f)),` with `        filesForRun(f), reportRow(f, 'card')),`.
  - `openStartDialog`: in the card, replace `      h('p', { class: 'hint req-dlg-who', text: `Recorded as: ${who} · started before Ready` }),` with

```js
      h('p', { class: 'hint req-dlg-who', text: `Recorded as: ${who} · started before Ready` }),
      reportRow(f, 'dialog'),   // A6 D15: the same switch as Ready to build's
```

  - `runsCard(f)`: replace `      h('div', { class: 'req-run-rows' }, ...starts.map(row)),` with

```js
      h('div', { class: 'req-run-rows' }, ...starts.map(row)),
      reportRow(f, 'runs'),   // A6 D15: Start again reports back too
```

- [ ] **Step 5: Leaving the view.** The returned object of `createRequirementsView` becomes:

```js
  // leave(): app.js calls it whenever another view is shown. An export dialog (a phone sheet) makes the page inert: leaving
  // closes it and puts the page back, and any answer still on its way is dropped (dlgGen).
  return { show, changed, leave: () => { closeDialog(false); },
    destroy: () => { paintNo += 1; closeDialog(false); offGit(); document.removeEventListener('click', onDocClick, true); host.replaceChildren(); } };
```

  In `ui/public/app.js`, replace

```js
  if (name === 'requirements') void requirementsView.show(param);
```

  with

```js
  if (name === 'requirements') void requirementsView.show(param);
  else requirementsView.leave();   // A6: an export dialog makes the page inert; leaving the view closes it
```

- [ ] **Step 6: The CSS.** Append inside the Requirements block, after Task 9's rules:

```css
/* Board 29 (6), D15: Report back on Ready to build, the start dialog and the runs card (upstream's switch row). */
.req-report{display:flex;flex-direction:column;gap:4px;margin-top:10px}
.req-report .req-report-hint{margin:0 0 0 40px;font-size:var(--fs-meta)}
.req-dialog .req-report{margin-top:0}
/* Board 31 (D20): at 600 px and narrower an export dialog is a full-screen sheet: fixed to the viewport (its size, never the
   content's), its body scrolls inside, ← FEAT-7 first, the description folded behind Show all, full-width buttons whose hit
   areas reach 44 px (::after, as .req-fpick), rows 14–18 px apart so no two areas overlap. */
.req-export-back{display:none}
@media (max-width:600px){
  .viewer-modal.req-dlg-wrap.req-dlg-sheet{padding:0;place-items:stretch}
  .req-dlg-wrap.req-dlg-sheet .card.req-dialog.req-export{position:fixed;inset:0;width:auto;max-width:none;height:auto;max-height:none;border:0;border-radius:0;
    box-shadow:none;overflow-y:auto;overscroll-behavior:contain;padding:12px 16px 24px}
  .req-export-back{display:inline-flex;align-self:flex-start;position:relative;font-size:var(--fs-body)}
  .req-export-back::after{content:"";position:absolute;inset:-14px -8px}   /* an 18 px line box + 28 = 46 px */
  .req-export-grid,.req-export-pair{grid-template-columns:minmax(0,1fr)}
  .req-export-desc.folded{max-height:180px;overflow:hidden}
  .req-export-more{display:block;width:100%;position:relative}
  .req-export-more[hidden]{display:none}
  .req-export-foot{flex-direction:column;align-items:stretch}
  .req-export .req-dlg-btns{flex-direction:column-reverse;align-items:stretch;gap:14px;margin:0}
  .req-export .req-dlg-btns .btn,.req-export .req-export-alert-btns .btn{width:100%;position:relative}
  .req-export .req-dlg-btns .btn::after,.req-export .req-export-alert-btns .btn::after,.req-export-more::after{content:"";position:absolute;inset:-6px 0}
  .req-export .req-export-alert-btns{flex-direction:column;gap:18px}
  .req-export .req-export-alert-btns .btn-sm::after{inset:-8px 0}
  .req-export-x{position:relative}
  .req-export-x::after{content:"";position:absolute;inset:-14px}
}
```

- [ ] **Step 7: Run and see it pass.** `node tools/test.mjs test/requirements-view-export.test.mjs` → pass. Then `node tools/test.mjs test/requirements-view.test.mjs`, `node tools/test.mjs test/requirements-view-files.test.mjs`, `node tools/test.mjs test/requirements-app.test.mjs`, `node tools/test.mjs test/ui-design-language.test.mjs` → pass (the start dialog and the runs card gain a row only with a ticket; compare a failure with `<baseline>`).

- [ ] **Step 8: Commit.**

```bash
git add ui/public/requirements-view.mjs ui/public/app.js ui/public/style.css test/requirements-view-export.test.mjs
git commit -m "Requirements: export failure states, Report back, the phone sheet and leaving the view" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: The browser proof (light, dark, 390 px, runnable alone) and the docs

**Files:**
- Modify: `tools/verify-requirements-cdp.mjs` (an import; the header comment; `ONLY_A6`; the original flow after the check `'flag on: the row appears without a reload'` wrapped in `if (!ONLY_A6) { … }`; `HIT_FN` and the A6 section at the end, after the earlier runs are stopped and before the page-error gate)
- Modify: `docs/requirements.md` (a new `## Export to a tracker` section at the end, after `## After starting`)
- Modify: `docs/storage.md` (under `worca-cc.db` in the layout)
- Modify: `docs/ui-levels.md` (the Requirements table)
- Modify: `docs/changelog/unreleased.md` (the Requirements entry)

**Interfaces:**
- Consumes: everything of Tasks 1–10 in a real browser, in mock mode (`WORCA_MOCK=1`, the proof's own server in this process, so the proof may call the store, `linkPlugin`, `createProfile`, `readPluginState` and `retryWriteback` directly); `A.evalJs`, `A.send`, `until`, `check`, `sleep`, `runs`, `base` (the proof's own).
- Produces: `npm run verify:requirements` checks for boards 26–31 (the A6 section last, before the page-error gate); `node --disable-warning=ExperimentalWarning tools/verify-requirements-cdp.mjs --only=a6` runs the boot, the flag and the A6 section alone, then the gate; the user docs.

- [ ] **Step 1: The A6 section of the proof.** In `tools/verify-requirements-cdp.mjs`:
  - add `import { fileURLToPath } from 'node:url';` after `import path from 'node:path';`
  - in the header comment, after "…at 390 px the Files card fits, its ⋯ menu holds the pencil's entry, 44 px targets);" add " export to a tracker (A6: jira-source linked in mock mode; the Export menu's items, the setup, the preview and its dark theme, Create with the chip, the History card and Created SHOP-123, Export again with the comment preview, Export anyway, the 390 px sheet with its phone title, Back, Show all, 44 px targets and the page inert until the view is left, Start with Report back writing back to the ticket; `--only=a6` runs it alone);"
  - after `const SANDBOX = …;` add:

```js
// --only=a6: the boot, the flag and the A6 section (export to a tracker) alone, then the page-error gate.
const ONLY_A6 = process.argv.includes('--only=a6');
```

  - right after the line `check('flag on: the row appears without a reload', await until(navShown, 2000));` add `if (!ONLY_A6) {   // --only=a6 skips to the A6 section`, and close that block with `}` right after the line `await until(async () => [...runs.values()].every((r) => settled.has(String(r.status || ''))), 30000);` (the earlier runs are stopped by then). Re-indent the lines between by two spaces (a whitespace-only change: `git diff -w` shows just the two lines); nothing after the block uses a name declared inside it.
  - right after that closing `}` and before `await sleep(1000);` and `check('no page errors', …)` (the page-error gate), add the A6 section. It runs last, so the original flow is exactly as before (its Export menu shows "Connect a tracker…", which none of its checks reads), and it makes its features and its run in `shop` only after the earlier runs are stopped:

```js
// A target is its hit area (board 20, style.css): the control's own box, grown by an absolutely placed ::after whose negative
// insets reach past the padding box. Shared by the A6 section (the files section keeps its own copy).
const HIT_FN = `const hit = (b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); const a = getComputedStyle(b, '::after');
  let hh = r.height; let ww = r.width;
  if (a.content !== 'none' && a.position === 'absolute' && cs.position !== 'static') {
    const px = (v) => parseFloat(v) || 0;
    hh = Math.max(hh, r.height - px(cs.borderTopWidth) - px(cs.borderBottomWidth) - px(a.top) - px(a.bottom));
    ww = Math.max(ww, r.width - px(cs.borderLeftWidth) - px(cs.borderRightWidth) - px(a.left) - px(a.right));
  }
  return { hh, ww }; };`;

// ---- A6: export to a tracker (boards 26–31), in mock mode: jira-source linked with one connection; the shim's canned export
// answers (SHOP — Shop web, Story, tickets SHOP-123, 124, …, doneStatus Done). This server runs in this process, so a Ready
// feature is made straight in the store. Runs alone with --only=a6.
{
  const store = await import(new URL('../src/core/requirements/store.mjs', import.meta.url).href);
  const { emptySpec } = await import(new URL('../src/core/requirements/spec.mjs', import.meta.url).href);
  const { linkPlugin } = await import(new URL('../src/core/plugin-store.mjs', import.meta.url).href);
  const { createProfile, readPluginState } = await import(new URL('../src/core/plugin-config.mjs', import.meta.url).href);
  const { retryWriteback } = await import(new URL('../src/core/sources.mjs', import.meta.url).href);
  const { getDb } = await import(new URL('../src/core/db.mjs', import.meta.url).href);
  await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url)));
  createProfile('jira-source', 'acme', 'acme.atlassian.net (Cloud)');
  const projKey = (await (await fetch(`${base}/api/projects`)).json()).projects.find((p) => p.name === 'shop').key;
  const spec = { ...emptySpec(), goal: { text: 'Customers cancel an order themselves until it leaves the warehouse.', measure: 'a third fewer support calls' },
    actors: ['Customer', 'Support agent'], flow: ['Open the order.', 'Cancel it.'], rules: ['A refund goes back the way the order was paid.'],
    criteria: [{ id: 'R-po-1', text: 'A customer can cancel a paid order that has not shipped.' }],
    assumptions: [{ id: 'A-1', text: 'Invoices can be cancelled the same way.', status: 'confirmed' }] };
  const f6 = store.createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Cancel an order before it ships', description: 'Before it ships' });
  store.appendTurn(f6.seq, { kind: 'round', payload: { questions: [], done: true } });
  store.updateFeature(f6.seq, { status: 'done', criteriaSeq: 1, assumptionSeq: 1, spec });
  const f6Hash = `#requirements/feature/${f6.seq}`;
  const DLG = `document.querySelector('.req-dlg-wrap [role="dialog"]')`;
  const openExportMenu = () => A.evalJs(`(() => { document.querySelector('#requirements-host [data-ui="menu-export"]').click();
    document.querySelector('#requirements-host [data-ui="mi-export"]').click(); })()`);
  const inertNow = () => A.evalJs(`[...document.body.children].filter((el) => el.hasAttribute('inert')).length`);
  const inertBefore = await inertNow();
  await A.evalJs(`location.hash = ${JSON.stringify(f6Hash)}`);
  check('A6 D1: Export ▾ ends with a separator, Export to Jira… and Export setup…',
    await until(() => A.evalJs(`(() => { const t = document.querySelector('#requirements-host [data-ui="menu-export"]'); if (!t) return false;
      const items = [...t.parentElement.querySelectorAll('[role="menuitem"], [role="separator"]')].map((x) => (x.getAttribute('role') === 'separator' ? '—' : x.textContent));
      return items.join('|') === 'Save to specs/|Copy Markdown|Download .md|—|Export to Jira…|Export setup…'; })()`), 15000));
  await openExportMenu();
  check('A6 board 26: the first export opens Set up export for shop; the selects load SHOP — Shop web, Story and the priorities',
    await until(() => A.evalJs(`(() => { const d = ${DLG}; if (!d) return false; const sel = (u) => d.querySelector('[data-ui="' + u + '"]');
      return d.querySelector('h2')?.textContent === 'Set up export for shop' && sel('setup-project')?.selectedOptions[0]?.textContent === 'SHOP — Shop web'
        && sel('setup-type')?.selectedOptions[0]?.textContent === 'Story' && sel('setup-prio')?.options.length === 5 && !sel('setup-save').disabled; })()`), 15000));
  await A.evalJs(`document.querySelector('[data-ui="setup-save"]').click()`);
  check('A6 board 27: Save and continue opens the preview: its title, the labels with the fixed one, the description and its footer',
    await until(() => A.evalJs(`(() => { const d = ${DLG}; const desc = d && d.querySelector('.req-export-desc'); if (!desc) return false;
      // 1400 px wide: the desktop title, no phone line under it (board 31's title is for 900 px and narrower)
      return d.querySelector('h2').innerText.trim() === 'Export FEAT-${f6.seq} to Jira'
        && getComputedStyle(d.querySelector('.req-export-sub')).display === 'none' && desc.querySelector('h4')?.textContent === 'Goal'
        && (desc.querySelector('.req-export-sig')?.textContent || '').startsWith('From Worca FEAT-${f6.seq} · exported ')
        && [...d.querySelectorAll('.req-export-lab')].map((x) => x.textContent).join('|') === 'worca|worca-FEAT-${f6.seq}'
        && d.querySelector('[data-ui="export-go"]').textContent === 'Create in Jira' && !d.querySelector('[data-ui="export-go"]').disabled; })()`), 15000));
  // Board 30: the dark theme is the tokens alone: the card, its ink and the description box change; nothing turns transparent.
  const colors = () => A.evalJs(`(() => { const d = ${DLG}; const desc = d.querySelector('.req-export-desc');
    return { card: getComputedStyle(d).backgroundColor, ink: getComputedStyle(d).color, desc: getComputedStyle(desc).backgroundColor }; })()`);
  const themeWas = await A.evalJs(`document.documentElement.dataset.theme || ''`);
  await A.evalJs(`document.documentElement.dataset.theme = 'light'`);
  await sleep(200);
  const lightC = await colors();
  await A.evalJs(`document.documentElement.dataset.theme = 'dark'`);
  await sleep(200);
  const darkC = await colors();
  await A.evalJs(`document.documentElement.dataset.theme = ${JSON.stringify(themeWas)}`);
  check('A6 board 30: the preview in the dark theme comes from the tokens: card, ink and description box change, none transparent',
    lightC.card !== darkC.card && lightC.ink !== darkC.ink && lightC.desc !== darkC.desc
      && ![lightC.card, darkC.card, lightC.desc, darkC.desc].includes('rgba(0, 0, 0, 0)'), JSON.stringify({ lightC, darkC }));
  await A.evalJs(`document.querySelector('[data-ui="export-go"]').click()`);
  check('A6 boards 28, 29: Create in Jira: the dialog closes; the chip SHOP-123 opens the ticket in a new tab; "Created SHOP-123"; History records it',
    await until(() => A.evalJs(`(() => { if (${DLG}) return false; const chip = document.querySelector('#requirements-host [data-ui="export-chip"]');
      return !!chip && chip.textContent === 'SHOP-123' && chip.getAttribute('href') === 'https://mock.test/browse/SHOP-123' && chip.target === '_blank'
        && document.querySelector('#requirements-host .req-export-done')?.textContent === 'Created SHOP-123'
        && /^Exported to Jira as SHOP-123 · /.test(document.querySelector('#requirements-host .req-history li span')?.textContent || ''); })()`), 15000));
  check('A6: the page behind is not inert once the dialog is closed', (await inertNow()) === inertBefore);
  await A.evalJs(`fetch('/api/requirements/${f6.seq}/criteria', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'An order with some items shipped can cancel only the items not yet picked up.' }) })`);
  await until(() => A.evalJs(`!!document.querySelector('#requirements-host [data-criterion="R-po-2"]')`), 10000);
  await openExportMenu();
  check('A6 board 28: Export again: three choices with Update first; what changed lists Added R-po-2',
    await until(() => A.evalJs(`(() => { const d = ${DLG}; if (!d || d.querySelector('h2').textContent !== 'Export FEAT-${f6.seq} again') return false;
      return d.querySelector('[data-ui="again-update"]')?.checked === true && !d.querySelector('[data-ui="again-comment"]').disabled
        && [...d.querySelectorAll('.req-export-change')].some((p) => p.textContent.startsWith('Added R-po-2 ')); })()`), 15000));
  await A.evalJs(`(() => { document.querySelector('[data-ui="again-comment"]').click(); document.querySelector('[data-ui="again-continue"]').click(); })()`);
  check('A6 board 28: the comment is shown before it is sent',
    await until(() => A.evalJs(`(() => { const d = ${DLG}; const box = d && d.querySelector('[aria-label="Comment preview"]'); if (!box) return false;
      return d.querySelector('h2').textContent === 'Comment on SHOP-123' && box.querySelector('p').textContent.startsWith('Updated in Worca since the last export (')
        && [...box.querySelectorAll('p')].some((p) => p.textContent.startsWith('Added R-po-2 ')); })()`), 15000));
  await A.evalJs(`document.querySelector('[data-ui="comment-add"]').click()`);
  check('A6: Add comment: the dialog closes, "Commented on SHOP-123", the History card leads with it',
    await until(() => A.evalJs(`!${DLG} && document.querySelector('#requirements-host .req-export-done')?.textContent === 'Commented on SHOP-123'
      && (document.querySelector('#requirements-host .req-history li span')?.textContent || '').startsWith('Commented on SHOP-123 in Jira · ')`), 15000));
  // Export anyway (D5), then the same preview at 390 px (board 31)
  const half = store.createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Cancel part of an order', description: 'Some items only' });
  store.updateFeature(half.seq, { status: 'done', spec: { ...spec, openQuestions: ['Who pays the return shipping?'] } });
  await A.evalJs(`location.hash = '#requirements/feature/${half.seq}'`);
  await until(() => A.evalJs(`document.querySelector('#requirements-host [data-req-feature]')?.getAttribute('data-req-feature') === '${half.seq}'`), 15000);
  await openExportMenu();
  check('A6 board 27: a feature that is not Ready asks first, the focus in the reason; Export anyway waits for one',
    await until(() => A.evalJs(`(() => { const d = ${DLG}; return !!d && d.querySelector('h2').textContent === 'Export FEAT-${half.seq} before it’s Ready?'
      && document.activeElement === d.querySelector('[data-ui="export-reason"]') && d.querySelector('[data-ui="export-anyway"]').disabled; })()`), 10000));
  await A.evalJs(`(() => { const a = document.querySelector('[data-ui="export-reason"]'); a.value = 'The team estimates in Jira tomorrow.';
    a.dispatchEvent(new Event('input')); document.querySelector('[data-ui="export-anyway"]').click(); })()`);
  check("A6 D5: Export anyway: the preview's description starts with the reason",
    await until(() => A.evalJs(`(${DLG}?.querySelector('.req-export-desc p')?.textContent || '') === 'Exported before Ready: The team estimates in Jira tomorrow.'`), 15000));
  await A.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(300);
  const sheet = await A.evalJs(`(() => { const d = ${DLG}; const r = d.getBoundingClientRect();
    const back = d.querySelector('[data-ui="export-back"]'); const more = d.querySelector('[data-ui="export-more"]');
    const sub = d.querySelector('.req-export-sub');
    const others = [...document.body.children].filter((el) => !el.classList.contains('req-dlg-wrap'));
    return { fixed: getComputedStyle(d).position === 'fixed', left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width),
      vw: document.documentElement.clientWidth, height: Math.round(r.height), vh: window.innerHeight,
      back: back && getComputedStyle(back).display !== 'none' ? back.getAttribute('aria-label') : null,
      title: d.querySelector('h2').innerText.trim(), sub: sub && getComputedStyle(sub).display !== 'none' ? sub.innerText.trim() : null,
      more: !!more && getComputedStyle(more).display !== 'none', folded: d.querySelector('.req-export-desc').getBoundingClientRect().height <= 182,
      inert: others.every((el) => el.hasAttribute('inert')), noScroll: document.documentElement.scrollWidth === document.documentElement.clientWidth }; })()`);
  check('A6 board 31: at 390 px a full-screen sheet (the viewport, not its content) with ← FEAT-n and Show all; the page behind is inert',
    sheet.fixed && sheet.left === 0 && sheet.top === 0 && sheet.width === sheet.vw && sheet.height === sheet.vh && sheet.back === `Back to FEAT-${half.seq}`
      && sheet.more && sheet.folded && sheet.inert && sheet.noScroll, JSON.stringify(sheet));
  check('A6 board 31 (user decision 2026-10-26): the phone title reads "Export to Jira" over "FEAT-n · <title>"',
    sheet.title === 'Export to Jira' && sheet.sub === `FEAT-${half.seq} · Cancel part of an order`, JSON.stringify({ title: sheet.title, sub: sheet.sub }));
  const small = await A.evalJs(`(() => { const d = ${DLG}; ${HIT_FN}
    return [...d.querySelectorAll('.btn, .req-export-x, .req-export-back')].filter((b) => b.offsetParent !== null)
      .map((b) => [b, hit(b)]).filter(([, s]) => s.hh < 44).map(([b, s]) => (b.getAttribute('data-ui') || b.className) + ':' + Math.round(s.hh)); })()`);
  check('A6 D20: every button of the sheet is a 44 px target', small.length === 0, JSON.stringify(small));
  await A.evalJs(`document.querySelector('[data-ui="export-more"]').click()`);
  check('A6 board 31: Show all unfolds the description',
    await A.evalJs(`!${DLG}.querySelector('.req-export-desc').classList.contains('folded') && ${DLG}.querySelector('[data-ui="export-more"]').hidden`));
  await A.evalJs(`location.hash = '#runs'`);
  check('A6 D20: leaving the Requirements view closes the sheet and puts the page back (nothing left inert)',
    await until(async () => !(await A.evalJs(`!!${DLG}`)) && (await inertNow()) === inertBefore, 8000));
  await A.send('Emulation.clearDeviceMetricsOverride');
  // Start with Report back (D15): the run's pipeline row names the ticket; write-back reports to it (the mock records it)
  await A.evalJs(`location.hash = ${JSON.stringify(f6Hash)}`);
  check('A6 D15: Ready to build shows Report back to SHOP-123, on, naming the status the connection moves it to',
    await until(() => A.evalJs(`(() => { const sw = document.querySelector('#requirements-host [data-ui="report-card"]'); if (!sw) return false;
      return sw.checked && sw.closest('label').textContent === 'Report back to SHOP-123'
        && /moves the ticket to Done/.test(document.getElementById(sw.getAttribute('aria-describedby')).textContent); })()`), 15000));
  await A.evalJs(`document.querySelector('#requirements-host [data-ui="start-go"]').click()`);
  let started = null;
  check("A6 D15: Start with Report back: the run's pipeline row names the ticket (source_type plugin, its connection, writeBack yes)",
    await until(async () => {
      const v = await A.evalJs(`fetch('/api/requirements/${f6.seq}').then((r) => r.json())`);
      const runId = v.feature.starts && v.feature.starts[0] && v.feature.starts[0].runId;
      const pid = runId && runs.get(runId)?.orch?.pipeline?.id;
      if (!pid) return false;
      started = { runId, pid };
      const row = getDb().prepare('SELECT source_type, source_ref FROM pipelines WHERE id = ?').get(pid);
      const ref = row && row.source_ref ? JSON.parse(row.source_ref) : {};
      return row.source_type === 'plugin' && ref.taskId === 'SHOP-123' && ref.profile === 'acme' && ref.inputs?.writeBack === 'yes';
    }, 20000));
  if (started) {
    runs.get(started.runId)?.orch?.stop?.();
    await until(() => ['stopped', 'done', 'error', 'paused', 'interrupted'].includes(String(runs.get(started.runId)?.status || '')), 30000);
    const wb = await retryWriteback(started.pid);
    const last = JSON.parse(readPluginState('jira-source', 'acme').lastReport || '{}');
    check('A6 D15: the run reports back to SHOP-123 through the existing write-back', wb.ok === true && last.id === 'SHOP-123', JSON.stringify({ wb, last }));
  }
  for (const r of runs.values()) { try { r.orch?.stop?.(); } catch {} }
}
```

  The existing `await sleep(1000); check('no page errors', …); log(…); await shutdown(…);` lines follow unchanged: with `--only=a6` the run goes boot → flag → A6 → the gate.

- [ ] **Step 2: Run the proof.** `node --disable-warning=ExperimentalWarning tools/verify-requirements-cdp.mjs --only=a6` (Chrome found automatically, or `CHROME_BIN` set) → every A6 check `ok`, ending `all checks passed`. Then the whole proof: `npm run verify:requirements` → `all checks passed` (the A6 section runs last, after the earlier sections, whose checks are unchanged). A failure is fixed in the task it belongs to (the view, the CSS, the service) and the proof run again; a check never passes without having seen its state.

- [ ] **Step 3: `docs/requirements.md`.** At the end of the file, after the `## After starting` section, add:

```markdown
## Export to a tracker

**Export ▾ › Export to Jira…** sends the feature's spec to your team's tracker as a ticket. The item names your tracker
(Jira today; other trackers add the same steps in their own plugins). Without one connected it reads **Connect a
tracker…**: trackers are connected on the Marketplace page (**Installed › Jira**, Advanced mode), or by whoever set up
Worca. Exporting costs nothing: no model is called.

- **Setup.** The first export from a project or workspace asks once: the connection, the Jira project, the issue type
  (Story by default), labels (`worca` by default), an optional priority, and where the acceptance criteria go (a section
  of the description, or a Jira multi-line text field). Change it later in **Export ▾ › Export setup…**. The setup names
  a connection only; the token stays in the plugin.
- **Preview.** Every export shows the ticket as Jira will show it: the fields and the description (goal and its measure,
  actors, main flow, business rules, edge cases, out of scope, acceptance criteria, confirmed assumptions, the names of
  the files the spec mentions, and the footer "From Worca FEAT-7 · exported 26 Oct 2026"). You can change the issue
  type, labels and priority for that export. Only what the preview shows is sent; if the spec changes in the meantime,
  Worca asks you to look at the preview again. The label `worca-FEAT-7` is always added: Worca uses it to find the ticket
  again.
- **Not Ready yet.** A feature that is not Ready can be exported with a reason. The reason is recorded on the feature and
  put at the top of the description: "Exported before Ready: …".
- **After the export.** The header shows the ticket (**SHOP-123**, opening it in a new tab), and the **History** card lists
  every export.
- **Export again.** For a feature with a ticket you choose each time: **Update SHOP-123** (summary, description and
  fields are rewritten; labels are only added), **Add a comment** (what changed since the last export, shown before it is
  sent; the description stays) or **Create a new ticket** (the chip then follows the new one). If the description was
  edited in Jira since your last export, Worca warns before replacing it. If the ticket was deleted, choose **Forget the
  link** or **New ticket**.
- **Report back.** Once a feature has a ticket, **Start in Worca** has **Report back to SHOP-123**, on by default: when the
  run ends, Worca comments on the ticket with the result and the pull request link, and moves it to the status named in
  the Jira connection (**Transition on completion**), if any.
- If Jira cannot be reached or refuses a field, nothing is recorded and the preview stays open. If Worca stopped after
  Jira made a ticket but before it saved the link, the next export finds that ticket instead of making a second one.
- Not in this version: epics and "is blocked by" links, reading changes back from Jira, attachments in Jira.
```

- [ ] **Step 4: `docs/storage.md`.** Right after the line `  worca-cc.db  (+ -wal, -shm)           ALL structured state (SQLite, WAL mode)` add:

```text
                                        Requirements export (v79): req_export_setups (one row per project or
                                        workspace: the connection — plugin, source, profile, never a token —, the
                                        tracker project, issue type, labels, priority, where criteria go, the done
                                        status) and req_export_links (one row per feature: its current ticket, the
                                        spec and fields as last sent, the tracker's fingerprint of the description,
                                        a pending create's marker). Every export is also an `export` turn.
```

- [ ] **Step 5: `docs/ui-levels.md`.** In the `### Requirements (behind the `requirements` flag)` table, after the row that starts `| A feature's header: id, title, state, …`, add:

```markdown
| Export to a tracker: Export ▾'s Export to Jira… and Export setup…, the setup dialog, the preview (fields, labels, the description, Export anyway), Export again and the comment preview, the failure states, the header's ticket chip, "Created SHOP-123", the History card, Report back on Ready to build, the start dialog and the runs card | S — product owners are its users |
| Connect a tracker… (the menu item and its dialog) | S |
| Connect a tracker's Open the Marketplace page | A — the Marketplace page is Advanced |
```

- [ ] **Step 6: The changelog.** In `docs/changelog/unreleased.md`, in `## Requirements (experimental)`:
  - append to the paragraph that ends "…and the files you switch on go to the run." the sentence: " A feature can be exported to the team's tracker (Jira first) as a ticket: a preview shows exactly what is sent, **Export again** updates the ticket or comments on it, and a run started from the feature reports back to the ticket."
  - the Chips line gains ` · export to Jira` before ` · experimental: turn it on in Settings › Labs`
  - the pull-request list gains `- Requirements: export to a tracker` (the number is added when the pull request opens).

- [ ] **Step 7: Commit.**

```bash
git add tools/verify-requirements-cdp.mjs docs/requirements.md docs/storage.md docs/ui-levels.md docs/changelog/unreleased.md
git commit -m "Requirements: the export browser proof and docs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Whole-branch check

**Files:** whatever the merge and the comparison show; nothing new by plan.

- [ ] **Step 1: Merge the latest base (merge commits only, never rebase).** `git fetch origin`. The base is `feat/req-a8-attachments` until A8 (PR #975) is merged into `dev`, then `origin/dev`: check with `gh pr view 975 --json state,mergedAt`. Merge the right one: `git merge --no-ff feat/req-a8-attachments` (or `git merge --no-ff origin/dev`). Resolve conflicts keeping both sides' meaning; never drop an upstream change. If A3 (`feat/req-a3-helper`) reached the base first, two places meet: `requirements-view.mjs`'s returned object (A3's `leave: () => syncSheetInert()` and this branch's `leave: () => { closeDialog(false); }` become `leave: () => { closeDialog(false); syncSheetInert(); }`) and `app.js`'s identical `else requirementsView.leave();` line (keep one); the turn-kind lists and the `last` / `retry` filters keep every kind both sides exclude.

- [ ] **Step 2: Renumber the schema if the base took 79 (or 78 is free and not A3's).** `git show origin/dev:src/core/db.mjs | grep -n "SCHEMA_VERSION ="`. With 79 or more taken, A6's rung becomes the next free number N, as A8's v75 → v77 was: `SCHEMA_VERSION = N`, the rung `if (current < N) db.exec(REQUIREMENTS_EXPORT_DDL);` after the base's last rung, the comments "v79" → "vN" in `db.mjs` and `docs/storage.md`, and `test/db-migrate-v79.test.mjs` renamed with `git mv` to `test/db-migrate-vN.test.mjs` with one more case: a DB stamped 79 by this branch's early numbering (the two export tables, none of the base's v79) reaches N with every table (as `test/db-migrate-v77.test.mjs`'s "stamped 75 by the early A8 numbering" case). With the base at 78 (A3 merged), 79 stays. Run `node tools/test.mjs test/db-migrate-vN.test.mjs` and every `test/db-migrate-v7*.test.mjs` → pass. Commit: `Requirements: renumber the export schema rung to vN`.

- [ ] **Step 3: The full suite, compared test-name by test-name with the baseline.** In this worktree: `node tools/test.mjs > ../a6-test.log 2>&1` (the log outside the worktree, never committed; `npm test` runs the same script). In the baseline (`<baseline>`): `cd <baseline> && git log -1 --oneline` names the commit compared against (it must be the base merged in Step 1), then `cd <baseline> && node tools/test.mjs > ../a6-baseline-test.log 2>&1`. List the failing tests of each run by file and test name; every test that fails here and not there is this branch's to fix (in a commit of its own, `Requirements: …`, then the file run again with `node tools/test.mjs test/<file>.test.mjs`); a test that fails in both is pre-existing only after its names were compared and match. Never call a failure pre-existing without that comparison.

- [ ] **Step 4: Linux.** In WSL (Node 22): `mkdir ~/a6-linux-<date> && git archive HEAD | tar -x -C ~/a6-linux-<date>` (`mkdir` fails on a name already used, so pick a new one: never `rm -rf` an old one), then `cd ~/a6-linux-<date> && npm ci && npm test && npm run smoke`. Every file passes, or its failure is compared with the same run of the base there. Record the counts.

- [ ] **Step 5: The browser proof again.** `node --disable-warning=ExperimentalWarning tools/verify-requirements-cdp.mjs --only=a6`, then `npm run verify:requirements` → `all checks passed` both times.

- [ ] **Step 6: Syntax and leftovers.** The repo has no lint script: `node --check` each `.mjs` this branch touched (`git diff --name-only <base>... -- '*.mjs'`) → no output; `git diff <base>... | grep -n -E "console\.log|debugger|TODO|FIXME"` → nothing new; `git diff <base>... | grep -n -i -E "[A-Z]:\\\\|/Users/|/home/"` → no local path.

- [ ] **Step 7: Stop before any real Jira call.** Report to the controller: the merge, the schema number, the test comparison (files and test names, here, the baseline and Linux), the proof. A check against a real Jira (a test project the user names, by hand: setup, preview, create, update with an edit made in Jira, comment, Forget the link, a run with Report back) happens **only after the user's explicit OK**, and its findings (Cloud and Data Center as available, the fingerprint across an edit in Jira, the property fallback) go into the pull request description. No push: the controller opens the PR.

---

## Appendix: design decisions and boards → tasks

| Spec point | Task(s) |
|---|---|
| D1 one Export entry; menu items; the tracker's name (setup's, bound, only one, "a tracker"); Connect a tracker… | 3 (trackers), 5 (`viewTracker`), 6 (`feature.export`), 8 (menu, Connect), 11 |
| D2 connections on the Marketplace page; setup per project or workspace; default connection from `resolveProfile`; no token | 1, 3 (`defaultConnection`), 5 (`saveSetup`, `exportSetupView`), 6, 8, 11 |
| D3 optional connector ops in API 5; discovery via `capabilities().export`, cached per plugin, source, version; probed with the first profile, all at once within 10 s; a failed probe stands about 60 s per plugin, source and profile | 3, 4 |
| D4 the neutral ticket; description order; names only for files; empty sections out; `(from <name>)` | 2, 5 (`mentionedFiles`) |
| D5 Ready, or Export anyway with a reason (≤ 500), recorded, at the top of the description; every check overridable | 5, 6, 9, 11 |
| D6 only what the preview shows; `previewHash`; 409 stale; labels normalised in Worca; fixed label; per-export overrides; text-only rendering | 2, 5, 6, 9, 10, 11 |
| D7 Export again: update (default) / comment / new; the link's own connection; labels added only; new ticket moves the link; comment disabled when nothing changed | 4, 5, 9, 11 |
| D8 dates not versions; `spec_json` per export; `changedSince` reduced; summary and comment; server-local dates | 1, 2, 5 |
| D9 the plugin's fingerprint after create and update; `ticketState`; comment keeps it; Update anyway (`force`) | 4, 5, 9 |
| D10 pending marker, `findTicket` with label, marker and footer; a match is linked and the export goes on as an update | 1, 4, 5 |
| D11 reach sentences by kind; refused and gone as results; Change the export setup; Forget the link / New ticket; the again dialog checks first | 3 (`reachReason`), 4, 5, 6, 10 |
| D12 Forget the link | 1, 5, 6, 10 |
| D13 one export per feature; BUSY while a round runs; export and start exclude each other; archived refused; no lock on setup and preview | 5, 7, 8 (archived item) |
| D14 `EXPORT_TIMEOUT_MS = 60_000`; a timeout keeps the pending marker | 3, 5 |
| D15 Start with Report back (`reportTo` → `_reportTo` → harness `sourceType: 'plugin'`); `writeBack: 'yes'`; `doneStatus`; metrics count it unchanged | 5 (`doneStatus`), 7, 10, 11 |
| D16 jira-source: REST v2, wiki markup, createmeta (`fields` or `values`), textarea criteria fields, too old | 4 |
| D17 the History card | 5 (`history`), 9, 11 |
| D18 server-side calls only; allowlist unchanged; no config in tables or views; names only for files | 3, 5, 6, 7 |
| D19 flag, `REQUIREMENTS_ROUTES`, frames, no cost; mock answers | 3, 6, 11 |
| D20 dialog roles and names; focus inside on open; radiogroup; alerts and statuses; chip name; label × names; description preview name; phone sheets; board 31's phone title at 900 px and narrower; 44 px | 8, 9, 10, 11 |
| §3 data, the `export` turn, the two filters | 1, 6 |
| §4 the contract, the comment, the mock answers | 2, 3, 4 |
| §5 the Jira connector | 4 |
| §6 API | 6, 7 |
| §7 boards 26–31 and "Not on the boards" | 8, 9, 10, 11 |
| §8 code changes | 1–11 |
| §9 testing (ticket, export job, store / migration, start, Jira, shim, API, UI, real browser, Linux, docs; real Jira only with the user's OK) | 1–12 |
| §10 where A6 meets A2, A8, A3 | 5 (readiness, files), 7, 12 (merge with A3) |
| §11 out of scope | not built |

## Self-review notes

- Code-forced placements this plan adds, each the smallest the code needs: the `exporting` set lives in `starting.mjs` (D13 names `export.mjs`; there `start.mjs` would have to import `export.mjs`, which imports `start.mjs`'s `REASON_MAX`), and `export.mjs` re-exports `isExporting`; `jira-api.mjs`'s error carries Jira's JSON body (`body`), which a refusal needs and the shim's `{ kind, message }` cannot carry; `exportOptions` may answer `tooOld: true` (D16's "This Jira is too old for export setup." needs the setup to know); `findTicket` also returns the candidate's `marker` and `labels`, so Worca checks all three of D10's conditions itself; an update raced by an edit in the tracker answers 409 `{ edited: true }` (the again dialog's check can be stale by the time Update is pressed); the feature's `export` carries `history` with server-formatted times (D8's server-local dates); `export.link` carries `madeOn` / `lastOn` for the same reason; the preview's `fields.conn` names the connection so the page can load the selects' choices.
- Copy this plan adds where the design names none is listed once in Global Constraints (the server refusals, "Updated SHOP-123", "Commented on SHOP-123", the update lead "This is the ticket Worca will update in SHOP. …", the change-summary lines for the goal, the measure, removals and assumptions).
- The comment lines follow board 28's punctuation (no final period); design §4 now says the same (user decision 2026-10-26). Board 31's phone title is built as approved (user decision 2026-10-26, design D20): at 900 px and narrower the preview's `h2` reads "Export to Jira" (CSS hides its `FEAT-7 ` span) with "FEAT-7 · <title>" on a second line; wider it stays "Export FEAT-7 to Jira" (Tasks 9, 10, 11).
- Plan review fixes (2026-10-26): every export dialog moves the focus inside on open (its title, `tabindex="-1"`); once Jira made the issue or took the edit, `createTicket` / `updateTicket` never throw (a refused property PUT is logged, a failed read-back is `fingerprint: null`, and the host then stores null, never the old fingerprint); jira-source's other refusals say "Jira refused the request: …" without a status or path; an update sends `issuetype` only when it changes; `tooOld` only on Data Center; an update takes criteria, issue type and priority from a setup on the link's connection and project; the capability probes run at once within 10 s and a failed one stands for a minute (design D3); History never names `'local'`; Report back uses the shared `makeSwitch`; the archived note sits outside `role="menu"`; a saved setup sends a frame to the scope's open features; the proof's A6 section runs last.
- Accepted, not changed: a preview made before midnight and sent after it answers "The spec changed since the preview. Look at the preview again." (its footer date moved); the sentence is D6's and a fresh preview fixes it. A New ticket whose answer was lost, followed by a setup moved to another connection, is looked for through the new connection (`runExport`'s comment); no match there makes a ticket.
- The suggested split's twelve tasks are kept; the Report back switch (board 29's state 6) is in Task 10 with the other states, the server side of it in Task 7.
