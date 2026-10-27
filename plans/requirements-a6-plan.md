# Requirements (A6: Export to a tracker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A product owner sends a feature's spec to the team's tracker as a ticket and keeps that ticket in step: **Export ▾ › Export to Jira…** opens a one-time **Set up export for <name>**, then a preview of the ticket exactly as it will be sent; a feature that is not Ready goes only with a recorded reason; after an export the header shows the ticket chip and a **History** card records it; **Export again** updates the ticket, adds a comment (shown before it is sent) or makes a new ticket, and warns before replacing a description edited in the tracker; a run started from the feature reports back to the ticket. No model call, no cost; behind the `requirements` flag.

**Architecture:** The Requirements code knows only "a task source that can export": six optional connector ops (`exportOptions`, `createTicket`, `updateTicket`, `commentTicket`, `ticketState`, `findTicket`) plus `capabilities().export`, called server-side through the existing `callSource` (plugin API stays 5). A pure module `src/core/requirements/ticket.mjs` builds the tool-neutral ticket, the changes since the last export, the comment and the preview hash; `src/core/requirements/export.mjs` is the service (tracker discovery, setup, preview, export with the duplicate guard, Forget the link, the feature's `export` view). Storage is two new tables (schema v79): the export setup per project or workspace and the ticket link per feature; every export is an `export` turn. Jira's part lives only in `plugins/jira-source/connector/` (REST v2, wiki markup, Cloud and Data Center). Start gains **Report back**: an in-process `reportTo` makes the run's pipeline row a `plugin` row, so today's write-back reports to the ticket unchanged. The page module `ui/public/requirements-view.mjs` gains the menu items, the dialogs, the chip, the History card and the Report back row; CSS goes into the Requirements block of `ui/public/style.css`.

**Tech Stack:** Node ESM, `node:sqlite`, `node:test`, jsdom, Express (`ui/server.mjs` → `src/core/requirements/routes.mjs`), the plugin shim (`src/core/plugin-shim.mjs`, one child per op, `WORCA_MOCK=1` canned answers), vanilla DOM (`ui/public/*.mjs`), headless Chrome over CDP for the browser proof.

**Spec:** `plans/requirements-a6-design.md` (decisions D1–D20 and §3–§11; it wins where this plan is unclear). A1: `plans/requirements-design.md` (A1-D<n>); A2: `plans/requirements-a2-design.md` (A2-D<n>); A8: `plans/requirements-a8-design.md` (A8-D<n>); A3: `plans/requirements-a3-design.md` (A3-D<n>).

**Visual reference (UI tasks):** design round 5 of the Claude Design canvas "Requirements — design rounds 1 to 5": board 26 **Export setup** (with the Export ▾ menu note), board 27 **Preview** and the not-Ready dialog, board 28 **After, and again** (chip, History, again dialog, comment preview), board 29 **States**, board 30 the dark theme (tokens only, nothing to build), board 31 **Phone**. The boards use upstream's classes (`card`, `btn` (the boards' `btn-mini` is `btn-sm`), `btn-primary`, `badge`, `chip`, `hint`, `select-wrap`, `field`, `menu` / `menu-item`); inline styles are layout hints. Where the design doc deviates from a board the doc wins; what no board shows is listed in design §7 "Not on the boards": build exactly that.

## Global Constraints

- One commit per task; subjects start `Requirements:`; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. A merge of the base is a merge commit.
- **No model call, no real tracker in tests.** Every tracker call in a test goes to the mock shim (`WORCA_MOCK=1`), an injected `callSource`, or the fake Jira HTTP server of Task 4 (on `127.0.0.1`).
- **Flag (D19).** Every new route is in `REQUIREMENTS_ROUTES` behind `requireFlag('requirements')`, so the flag-off walk of `test/requirements-api.test.mjs` covers it; changes reach the page only through the flag-checking `requirements-changed` frame (`requirementsChangeNotifier`); nothing is booked in `req_cost_ledger`.
- **Schema v79:** `req_export_setups` and `req_export_links` exactly as design §3, `IF NOT EXISTS`, both in `INCREMENTAL_TABLES`; the rung `if (current < 79) db.exec(REQUIREMENTS_EXPORT_DDL);` after A3's v78 rung; no column on an existing table. If the base takes 79 first, the rung is renumbered as A8's was.
- **The contract (D3):** the six ops are optional and additive; `WORCA_PLUGIN_API` stays 5, jira-source keeps `"worca-cc-api": ">=5 <6"`. A source can export only when `capabilities()` answers `export: true`. The new ops are never added to `POST /api/sources/call`'s allowlist.
- **Safety (D18):** every tracker call is `callSource` from `export.mjs` (server-side); the setup and link tables hold plugin, source id and profile, never a config value; no view or response carries config except `doneStatus`; only the previewed ticket or comment is sent; file names only, never file contents. A preview renders as text nodes, never `innerHTML`. A plugin URL is kept only when it is `http(s)`.
- **Timeouts (D14):** every export op `EXPORT_TIMEOUT_MS = 60_000`. A timeout (or any thrown failure) on a create or a new ticket keeps the pending marker (D10).
- **Concurrency (D13):** the `exporting` set lives beside `starting` in the leaf module `starting.mjs` (so `start.mjs` reads it without an import cycle; `export.mjs` re-exports `isExporting`), taken before the first await. An export is refused while a round or look runs (`isBusy`), while a start is in flight, on an archived feature, and while another export of the feature runs; Start is refused while exporting. Setup and preview calls hold no lock.
- **The round is unchanged:** an `export` turn writes no thread line, so every round, look and Feature chat prompt stays byte-identical; it never hides the error line (`featureView`'s `last`) or changes what Try again re-runs (`retry`).
- **Errors:** a tracker failure answers 502 `{ error, kind }` with D11's sentence; refused, gone, edited and stale are 409 with their flag; NOT_READY is 409 `{ error, failing }`. Product copy never shows a raw error, a stack, a path or an HTTP status: a refusal shows the server's product message (`errText`), anything else "Worca could not finish that. Try again.". The server log gets the error kind and the first line of the raw message, at most 200 characters.
- **Copy:** every user-facing string is design §2 / §7 verbatim (`Jira` is the tracker's `displayName`). Where the design names none, this plan adds, in product language: "Set up the export first." · "This feature has a ticket already. Export it again instead." · "This feature has no ticket yet." · "Nothing changed since the last export." · "Choose a connection from the list." · "The tracker refused the ticket." · "Updated SHOP-123" · "Commented on SHOP-123" · the update lead "This is the ticket Worca will update in SHOP. …" · the change-summary lines for the goal, the measure, removals and assumptions.
- `style.css`: tokens only (no hex, no `rgba(`); font sizes from the type scale; radii `var(--r-xs|sm|md)`; phone tap areas are a `::after` hit area; shared icons, never a text glyph; on/off controls are never green-filled (Report back is upstream's ink `.switch`). Every new rule is a `req-export-*`, `req-history*` or `req-report*` rule inside the Requirements block (it ends right before `/* ── marketplace P3 ── */`).
- **Dialogs (D20):** `role="dialog"` `aria-modal="true"`, labelled by their title, through the page's `openModal` (focus trapped, Escape closes when allowed, focus back to the trigger); the focus moves inside the moment a dialog opens; while an export dialog is open every other child of `<body>` is inert, released on close and when the user leaves the Requirements view (`leave()`). Every async answer checks the dialog's generation and is dropped when its dialog is gone. Live regions are persistent nodes whose text changes.
- **Phone (D20):** at 900 px and narrower (the Requirements page's one-column breakpoint, as Feature chat's sheet) an export dialog is a full-screen sheet of the viewport's size, scrolling inside, **← FEAT-7** first, the description folded behind **Show all**, full-width buttons with 44 px hit areas; the preview's heading reads "Export to Jira" with "FEAT-7 · <title>" on a second line (board 31).
- No local machine paths in shipped files (code, tests, docs, plans). No import from Shaper code; core modules never import `ui/server.mjs`.
- One test file: `node tools/test.mjs test/<file>.test.mjs`; each task runs its own files. Full suite: `npm test`, compared with the base branch file by file (Task 12). POSIX-only tests are skipped on Windows and run on Linux.

## Review Focus

1. **No tracker call from the browser, no secret out.** Every op goes through `export.mjs` → `callSource`; `/api/sources/call`'s allowlist is unchanged; no response carries a config value; the server log gets one capped line per failure (Tasks 3, 5, 6, 7).
2. **Only what the preview shows is sent.** The preview hash covers the exact ticket or comment and the connection; the export rebuilds and compares it; labels are normalised in Worca (Tasks 2, 5).
3. **Nothing recorded on a failure; no duplicate on a lost answer.** A failed call writes no link or turn; a create keeps its pending marker until a definite answer; the next export finds the ticket only when label, marker and footer all match; once Jira made the ticket the plugin answers its key even when the marker property or the read-back fails (Tasks 4, 5).
4. **Edited in the tracker.** The fingerprint is the plugin's, stored after every create and update, untouched by a comment; Update is refused while it differs unless forced (Tasks 4, 5, 9).
5. **Report back rides the existing write-back.** A start with a linked ticket makes a `plugin` pipeline row (`source_ref` with the link's own connection and `inputs.writeBack: 'yes'`); `_reportTo` is in-process only (Task 7).
6. **The round is unchanged.** An `export` turn writes no thread line, never hides the error line, never changes what Try again re-runs (Tasks 1, 6).
7. **Accessibility and phone.** Dialog roles and names, the radiogroup, persistent live regions, focus return, the page inert while open and released on leave, the 390 px sheet, and A3's Feature chat sheet left modal under a closed export dialog (Tasks 8–11).

## Files

| File | Task(s) | Responsibility |
|---|---|---|
| `src/core/db.mjs` | 1 | v79: `REQUIREMENTS_EXPORT_DDL`, `INCREMENTAL_TABLES`, the rung |
| `src/core/requirements/spec.mjs` | 1, 5 | turn kind `export`; error code `TRACKER` |
| `src/core/requirements/store.mjs` | 1 | export setup and link rows |
| `src/core/requirements/markdown.mjs` | 2 | `renderTicketMarkdown`, `criterionLine` (sharing the Markdown export's helpers) |
| `src/core/requirements/ticket.mjs` (new) | 2 | pure: the neutral ticket, labels, dates, the changes since the last export, the comment, the hash |
| `src/core/plugin-shim.mjs`, `src/core/plugin-api.mjs` | 3 | mock answers for `capabilities` and the six ops; the contract comment |
| `.claude/skills/creating-worca-cc-plugins/SKILL.md` | 3 | the connector contract table gains the optional export ops |
| `src/core/requirements/export.mjs` (new) | 3, 5 | discovery and reach sentences; then the service: setup, options, preview, export, Forget the link, the view |
| `src/core/requirements/starting.mjs` | 5 | the export lock beside the start lock |
| `plugins/jira-source/connector/index.mjs`, `jira-api.mjs`, `README.md` | 4 | the six ops, `capabilities().export`, `fingerprintOf`; a failed request carries Jira's body; an Export section |
| `src/core/requirements/routes.mjs`, `interview.mjs` | 6, 7 | design §6 routes, statuses, `featureView`'s `export`, the `last` and `retry` filters; `reportBack` on start |
| `src/core/requirements/start.mjs`, `ui/server.mjs`, `src/core/run-harness.mjs` | 7 | `reportBack` → `reportTo` → `req._reportTo` → the harness's `plugin` pipeline row |
| `ui/public/requirements-view.mjs`, `ui/public/app.js`, `style.css` | 8–10 | menu items, Connect a tracker, Setup, Not Ready, Preview, Again, Comment, states, chip, History, Report back, the phone sheet, `leave()` |
| `tools/verify-requirements-cdp.mjs`; `docs/requirements.md`, `storage.md`, `ui-levels.md`, `changelog/unreleased.md` | 11 | the browser proof (runnable alone with `--only=a6`); docs, levels, changelog |

---

### Task 1: Schema v79, the setup and link rows, the `export` turn

The tables and the store rows every later task reads.

**Files:**
- Modify: `src/core/db.mjs` (`SCHEMA_VERSION`, `REQUIREMENTS_EXPORT_DDL`, `INCREMENTAL_TABLES`, the v79 rung), `src/core/requirements/spec.mjs` (`TURN_KINDS`), `src/core/requirements/store.mjs`
- Test: create `test/db-migrate-v79.test.mjs`, `test/requirements-export-store.test.mjs`

**Interfaces:**
- `store.mjs`: `getExportSetup(scopeType, scopeKey)`, `upsertExportSetup({ scopeType, scopeKey, plugin, sourceId, profile, trackerProject, trackerProjectName, issueType, issueTypeName, labels = ['worca'], priority, priorityName, criteria = { target: 'description' }, doneStatus }, { by })` (who made it is kept on an update), `setExportSetupDoneStatus(scopeType, scopeKey, doneStatus)`; `getExportLink(seq)` (a row holding only a pending create has `key: null`), `setPendingExport(seq, { plugin, sourceId, profile, trackerProject, marker }, { by })` (an existing row keeps its connection, project and key), `saveExportLink(seq, link, { by })` (the whole link; clears the pending marker), `clearPendingExport(seq)` (a keyless row is deleted), `deleteExportLink(seq)`. A link is `{ featureSeq, plugin, sourceId, profile, trackerProject, key, url, createdAt, exportedAt, spec, fields, fingerprint, pendingMarker, pendingAt, updatedBy, updatedAt }`.
- `spec.mjs`: `TURN_KINDS` includes `'export'`.

**Tests:** both tables and their columns on a fresh database, one at 77 (A8), one stamped 78 by A3, one at A8's early 75, upstream's 74–76, one from below 72, and one stamped past this version without them (repaired); a setup row's defaults; one setup per project and one per workspace, saving again keeps who made it, the done status alone; a pending create has no key and clearing it removes the row; a saved link, a pending new ticket keeps the current key and connection, clearing keeps the link, delete removes it; the `export` turn is stored and listed, and a round prompt is byte-identical with or without it.

---

### Task 2: The tool-neutral ticket and what changed since the last export (pure)

D4, D6 and D8 as pure functions; the Markdown export stays byte for byte.

**Files:**
- Modify: `src/core/requirements/markdown.mjs` (`criterionLine`, `renderTicketMarkdown`; `renderSpecMarkdown` unchanged)
- Create: `src/core/requirements/ticket.mjs`
- Test: create `test/requirements-ticket.test.mjs`

**Interfaces:**
- `markdown.mjs`: `criterionLine(c)` ("R-po-1 <text>" plus A8's " (from <name>)"); `renderTicketMarkdown(f, { reason, exportedOn, criteriaInDescription, mentionedFiles })` in board 27's order, empty sections left out, ending with "From Worca FEAT-7 · exported <date>".
- `ticket.mjs` (no I/O): `EXPORT_LIMITS = { labels: 10, label: 255 }`, `exportLabel(f)` (`worca-FEAT-7`), `normalizeLabels(list, fixed)`, `exportDate(iso)`, `exportTime(iso)` (server-local, English months), `buildTicket(f, { project, issueType, labels, priority, criteria, reason, exportedOn, mentionedFiles })` → `{ project, issueType, title, description, labels, priority, criteria }`, `exportChanges(before, after)` (criteria, goal and measure, the ticket's sections, assumptions entering or leaving `confirmed`; open questions ignored), `changeSummary(changes)` (the again dialog's lines), `renderExportComment(f, changes, { since, reason })`, `ticketHash(value)` (sha256 of canonical JSON, keys sorted at every level).

**Tests:** board 27's description from its fixture byte for byte; empty sections left out, the reason leads, criteria to a field leave the description; A8 sources stay on criteria and assumptions; the neutral ticket with labels normalised and the fixed label last; labels trimmed, spaces to "-", capped, duplicates and empties dropped; dates in the server's time zone; board 28's summary and comment; assumptions counted when they enter or leave confirmed, open questions ignored, goal, measure, edits and removals; `ticketHash` independent of key order and changed by any value.

---

### Task 3: The shared contract: optional export ops, the capability probe, the mock answers

D3, D11's reach sentences and D19's mock answers.

**Files:**
- Modify: `src/core/plugin-shim.mjs` (`MOCK_DEFAULTS`, `setMockSourceResponses`), `src/core/plugin-api.mjs` (the comment above `WORCA_PLUGIN_API`), `.claude/skills/creating-worca-cc-plugins/SKILL.md`
- Create: `src/core/requirements/export.mjs` (the discovery part)
- Test: create `test/requirements-export-trackers.test.mjs`; modify `test/plugin-shim.test.mjs` (the mock answers), `test/writeback.test.mjs` (the missing-op default kept explicit)

**Interfaces:**
- The contract (design §4): `capabilities` adds `export: true`; `exportOptions({ project?, issueType? })` → `{ projects, issueTypes?, priorities?, criteriaFields?, doneStatus, tooOld? }`; `createTicket({ ticket })` → `{ key, url, fingerprint }` or `{ refused: { field, message } }`; `updateTicket({ key, ticket })` → the same or `{ gone: true }`; `commentTicket({ key, body })` → `{ ok: true }` or `{ gone: true }`; `ticketState({ key })` → `{ exists, url, fingerprint }`; `findTicket({ project, label, marker })` → `{ key, url, fingerprint, lastLine, marker, labels }` or `null`. Auth, network, rate-limit, timeout and protocol failures are thrown as today.
- Mock mode: `capabilities` answers `{ writeBack: true, export: true }`; tickets are numbered from 123 (`setMockSourceResponses(null)` restarts them); `ticketState` follows the last write.
- `export.mjs`: `EXPORT_TIMEOUT_MS`, `PROBE_TIMEOUT_MS = 10_000`, `PROBE_RETRY_MS = 60_000`; `exportTrackers(d)` (never throws; every source probed at once with its first profile; a "yes" or a missing op cached per plugin, source id and installed version; a failed probe remembered for a minute per connection); `defaultConnection(scope, trackers, { memberKeys })`; `reachReason(err, name)` and `reachSentence(name, err)` ("Worca could not reach Jira: <reason>.").

**Tests:** a multi-profile source with no profile is no tracker and is not asked; a source is a tracker when its capabilities say export, probed with its first profile and cached; every source probed at once within 10 s, a slow connector holding none of the others; a new installed version is asked again; a missing op is cached as no export, a failed probe is remembered for a minute and then asked again; a single-profile source is one connection named after it, a disabled plugin is left out; the default connection follows the scope's binding; the reach sentences per kind; the mock answers (options, tickets from 123, state following the last write).

---

### Task 4: The Jira connector's export ops, against a fake Jira (Cloud and Data Center)

D9, D10, D11 and D16 in jira-source.

**Files:**
- Modify: `plugins/jira-source/connector/jira-api.mjs` (a failed request's error carries Jira's JSON body), `plugins/jira-source/connector/index.mjs` (a project lister shared by `listProjects` and `exportOptions`; the six ops; `capabilities`), `plugins/jira-source/README.md` (an Export section after Write-back)
- Create: `test/helpers/fake-jira.mjs`, `test/jira-source-export.test.mjs`

**Interfaces:**
- `fingerprintOf(text)` (exported): sha256 of the text with CRLF → LF, trailing spaces per line removed, trimmed.
- The ops as design §5: REST v2 with wiki markup; createmeta for issue types, priorities and multi-line text fields; the marker as the issue property `worca.export` (in the create body, or a PUT where a site refuses it); labels only added on update; `issuetype` sent on update only when it changes; `tooOld` only on Data Center; a field Jira refuses is `{ refused }` with "Jira needs a value for “<field>” in <project>." or "Jira refused “<field>”: <message>"; any other refusal is "Jira refused the request: <Jira's errorMessages>", never the HTTP status or the REST path.
- Once Jira made the issue or took the edit the op never throws: a refused property PUT is logged, a failed or unreadable read-back answers `fingerprint: null`.
- `startFakeJira({ deployment, token, refuseProperties, refusePropertyPut, failReadBack, refuseIssuetypeEdit, fail, oldCreatemeta, requiredField, refuseOnUpdate, storeCrlf })` → `{ base, issues, requests, close() }`.

**Tests (Cloud and Data Center):** capabilities answer export and keep write-back's input; options list projects, issue types without sub-tasks, priorities, only multi-line text fields and the done status; too old on a Data Center before 8.4 (by `versionNumbers` or the version string), a missing project on a newer one, and a throw on Cloud; a create in wiki markup with labels, priority, the marker property, the URL and the fingerprint of what Jira stores; criteria to a field as a wiki list; the property in its own call where the create refuses it; a refused property PUT and a failed read-back still answer the key; a required custom field is a refusal naming it and nothing is created; a refused token throws `auth`; a refusal without a field never shows the status or path; update rewrites summary, description and fields and only adds labels, a refused field, a deleted ticket gone; `issuetype` only when it changes; comment in wiki markup, gone; `ticketState` gives the create's fingerprint and another after an edit in Jira; `findTicket` by project and label then the property, another install's marker no match, fingerprint and last line from the issue itself; a hang after the key is known times out and still answers the key; no token or Authorization value in a log, a thrown message or an answer; rate limit and unreachable keep their kind; `fingerprintOf`'s normalisation.

---

### Task 5: The export service: setup, preview, the four modes, the duplicate guard, errors, locks, Forget the link

D2, D5–D14 and D17 in `export.mjs`.

**Files:**
- Modify: `src/core/requirements/starting.mjs` (the export lock), `src/core/requirements/spec.mjs` (`TRACKER` in `RequirementsError`'s codes), `src/core/requirements/export.mjs` (the service)
- Test: create `test/requirements-export.test.mjs`

**Interfaces:**
- `starting.mjs`: `markExporting(seq)`, `unmarkExporting(seq)`, `isExporting(seq)`, `EXPORTING_MESSAGE`.
- `export.mjs`: `mentionedFiles(f)` (D4); `exportSetupView(scope, { memberKeys }, d)` → `{ setup, trackers, defaultProfile }`; `exportOptions(scope, { plugin, sourceId, profile, project?, issueType? }, d)` (refreshes the setup's `doneStatus`); `saveSetup(scope, body, { by }, d)`; `previewExport(seq, { mode, issueType?, labels?, priority?, reason? }, { target }, d)` → `{ mode, tracker, key, ticket, comment, previewHash, changes, fields, link, edited, gone }`; `runExport(seq, { …the preview's body, previewHash, force? }, { by, target }, d)` → `{ action: 'created' | 'new' | 'updated' | 'commented', key, url }`; `forgetLink(seq, { by })`; `exportView(f, turns, d)` → `{ tracker, canExport, hasSetup, link, exporting, doneStatus, history }` (never throws; History names nobody for a single-user install's `local`).
- `mode` is `create` (no link), `update`, `comment` or `new` (a link). An update goes through the link's own connection and takes its criteria, issue type and priority from the setup when the setup is on the link's connection and project, else from the fields last sent.
- Errors: `TRACKER { kind }` (an op the connector no longer has: "Jira cannot export any more."); `CONFLICT` with `stale`, `refused` + `field`, `gone`, `edited` or `linked`; `NOT_READY { failing }`; `BUSY`; `BAD_REQUEST`.

**Tests:** a create through the setup's connection with a marker sends exactly the previewed ticket and stores the link and the turn; an edit after the preview is refused and nothing is sent, overrides go into the ticket and not the setup; not Ready gives the failing keys, a reason leads the description and is recorded, over 500 is refused, a reason is one line; update through the link's connection with no marker, edited refused until forced, gone writes nothing; a comment lists what changed, nothing changed is refused, the fingerprint stays; modes only with or without a ticket, a new ticket moves the link and the old key stays in History; a refusal clears the pending marker; Change the export setup fixes a refused update; reach failures by kind record nothing but the pending marker; a failure that is not product copy (a crash, garbage, the shim's own words) gives a fixed phrase and logs only its kind and first line; a URL that is not http(s) is no link; a lost answer is found by label, marker and footer, linked and updated, never duplicated, and a wrong marker, footer or label is no match; a keyless pending row is looked for where it was made; a lost New ticket never takes over a later Update or Comment; the hash covers the connection; a link without a spec copy gets no comment until one update; the tracker's search lag keeps a marker younger than two minutes after an unclear failure, not after a refused token or a rate limit, and after a restart; one export at a time, a start in flight, a round running and an archived feature refused, a preview takes no lock; Forget the link sends nothing; the view's tracker name, link dates, done status and History newest first; the setup holds no config value; a preview made before midnight is sent after it.

---

### Task 6: The API: setup, options, preview, export, Forget the link; the feature's `export`

Design §6 behind the flag.

**Files:**
- Modify: `src/core/requirements/routes.mjs` (`STATUS`, `REQUIREMENTS_ROUTES`, `featureView`, the handlers), `src/core/requirements/interview.mjs` (`retry`'s filter)
- Test: create `test/requirements-export-api.test.mjs`

**Interfaces:**
- `GET /api/requirements/export-setup/:scopeType/:scopeKey` → `{ setup, trackers, defaultProfile }`; `POST …/options`; `PUT …` → `{ setup }` and a frame for each open feature of the scope.
- `POST /api/requirements/:seq/export/preview` → the preview; `POST /api/requirements/:seq/export` → `{ action, key, url, feature, turns }` and a frame (also on a 409 that linked a found ticket); `DELETE /api/requirements/:seq/export/link` → the feature view and a frame; `GET /api/requirements/:seq` carries `feature.export`.
- Statuses: `TRACKER` → 502 `{ error, kind }`; `CONFLICT` → 409 with its flags; `NOT_READY` → 409 `{ error, failing }`. The export routes come before the `/:seq` routes.

**Tests:** the route table with the setup routes before `GET /api/requirements`; the setup view without a config value; options for an unknown connection 400, a reach failure 502 with its sentence and kind; setup, preview, export over HTTP with the chip data, the frame and the turn, then Forget the link; NOT_READY, stale, refused and gone write nothing; an export turn never hides the error line and Try again still re-runs the named job; every error data field reaches the client unchanged (linked on a stale find, then the comment starting point); an Update raced by an edit in Jira is 409 edited, an op Jira no longer has is 502; flag off: every new route answers the gate's 404.

---

### Task 7: Start with Report back

D15: a run started from an exported feature reports to its ticket through today's write-back.

**Files:**
- Modify: `src/core/requirements/start.mjs` (`startFeature`), `src/core/requirements/routes.mjs` (the start handler passes `reportBack`), `ui/server.mjs` (`invokeStartRun` → `req._reportTo` → the project and workspace `createOrchestratorFor`), `src/core/run-harness.mjs` (`sourceType` / `sourceMeta` from `this.opts.reportTo`)
- Test: modify `test/requirements-start.test.mjs`, `test/requirements-run-link.test.mjs`

**Interfaces:**
- `startFeature(seq, { reason, workflowId, sourceBranch, reportBack }, { by }, deps)`: with a linked ticket and `reportBack !== false`, `deps.startRun(body, { …, reportTo })` where `reportTo = { plugin, sourceId, profile, taskId: <key>, url, title, inputs: { writeBack: 'yes' } }` (the link's own connection); a non-boolean `reportBack` is 400; while exporting BUSY `EXPORTING_MESSAGE`.
- The harness: with `reportTo` and a source that is not a plugin, the pipeline row gets `source_type 'plugin'` and that `source_ref`; the prompt is still the spec.

**Tests:** a feature with a ticket reports back by default with the link's own connection and write-back on; `reportBack: false` and no ticket send no `reportTo`, a non-boolean is 400; Start is refused while exporting; over HTTP a start with Report back makes a `plugin` pipeline row and write-back reports to the ticket (mock state), and `_reportTo` from an HTTP body is ignored; `/api/sources/call` refuses `createTicket`.

---

### Task 8: The page: the Export menu's tracker items, Connect a tracker, the export setup (board 26)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (state; `openModal` / `closeDialog`; `header`; an export section), `ui/public/style.css`
- Test: create `test/requirements-view-export.test.mjs`

**Interfaces:** view-internal, used by Tasks 9 and 10: the dialog generation (`dlgGen`, `live(g)`); `openModal(card, { trigger, first, canClose, page })` (with `page` every other child of `<body>` is inert until close; the Tab trap skips hidden controls); `trackerName(f)`, `exportUrl`, `setupUrl`; `exportSelect`, `exportField`, `labelsField`, `backButton`; `exportItems(f)`, `openConnect`, `openSetup(f, { trigger, then })`, `startExport`, `continueExport`. `data-ui`: `mi-export`, `mi-export-setup`, `mi-connect`, `connect-close`, `connect-market`, `setup-*`, `export-back`.

**Tests:** Export ▾ ends with a separator, Export to Jira… and Export setup…; several trackers and none bound read "Export to a tracker…", none read "Connect a tracker…", a workspace has no Save to specs/; an archived feature's item is `aria-disabled` and says why outside `role="menu"`; Connect a tracker is a modal with Close focused and the Marketplace button at the Advanced level; the first export opens Set up export for shop, each select loaded through options as the one before it changes; labels added and removed, a Jira field for the criteria, a priority, Save sends the names; an answer for a connection no longer chosen or a closed dialog is dropped; a failure shows the server's sentence; a Jira too old says so; a gone connection leads with "Choose a connection"; a label being typed keeps its text and caret while options land; while saving Escape and Cancel wait and a second Save does not post; Shift+Tab wraps from the title; Escape and Enter while composing text do nothing; the rules sit inside the Requirements block, tokens only.

---

### Task 9: The page: the preview, Export anyway, Export again and the comment, the chip, the History card (boards 27, 28)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`header`, `paintFeature`, the export dialogs), `ui/public/style.css`
- Test: modify `test/requirements-view-export.test.mjs`

**Interfaces:** `continueExport(f, trigger)` (Not Ready first, D5; then Export again with a ticket, D7; else the preview of a create); `openExportNotReady`, `openPreview(f, { mode, reason, force, trigger })`, `openAgain`, `openComment`; `stateBox()` (one persistent `role="alert"` line per dialog); `showFailure(box, err, ctx)`; `sendExport`, `exported`; `exportChip(f)`, `exportDoneLine(f)`, `historyCard(f)`. The preview names the tracker its answer carries; an update, Again and Comment name the link's tracker.

**Tests:** with a setup a Ready feature goes straight to the preview (fields, the description as text, Create in Jira); changing the issue type, a label or the priority asks for a fresh preview and keeps the focus; Create in Jira shows Exporting to Jira… and the waiting buttons, then the chip, "Created SHOP-123" and the focus on the chip; not Ready lists the checks as the board writes them and Export anyway needs a reason; with a ticket the again dialog's three choices and what changed, Continue previews Update SHOP-123; nothing changed disables Add a comment, a new ticket previews mode new; edited in Jira shows the alert with Update anyway and Add a comment instead, under the choices so no card moves; the comment preview, Back and Add comment with its hash; History right under the header, newest first; a URL that is not http(s) shows the key as text; a stale preview is replaced; a found and linked ticket opens Export again; no double post; answers after Cancel dropped; live regions keep their nodes; the description and comment previews are named regions; the picked choice is an ink border, "Created SHOP-123" green ink, the edited alert `--amber-line`.

---

### Task 10: The page: board 29's states, Report back, the phone sheet, leaving the view

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`showFailure`, `forgotten`, `reportRow`; `buildCard`, `openStartDialog`, `runsCard`, `postStart`; the view's `leave`), `ui/public/app.js` (`requirementsView.leave()` when another view is shown), `ui/public/style.css`
- Test: modify `test/requirements-view-export.test.mjs`

**Interfaces:** `showFailure`: 502 → the sentence, "Nothing was recorded…" and Try again; refused → the sentence and Change the export setup (the setup, then back); gone → the sentence, Forget the link and New ticket; stale → a fresh preview. `reportRow(f, where)` (`card` | `dialog` | `runs`) with upstream's `makeSwitch`; `leave()` closes any dialog and releases the inert page. `data-ui`: `export-change-setup`, `export-forget`, `export-new`, `report-card`, `report-dialog`, `report-runs`.

**Tests:** Worca cannot reach Jira: the sentence as an alert, "Nothing was recorded…", Try again sends again, the preview stays; a preview that never loaded says why without "The preview stays open…"; a later failing preview keeps the one on screen; a refused field and Change the export setup back to the preview; a gone ticket in the again dialog and on send, Forget the link drops the chip, New ticket previews mode new; Report back on the Ready to build card on by default, its hint naming the status or saying it only comments; the start-before-Ready dialog and the runs card carry the same switch and the start sends `reportBack`; no ticket, no `reportBack`; Forget the link resets the choice; focus after a failed Try again, a gone answer and a failed send; NOT_READY mid-dialog lists the feature as it is now; every other child of `<body>` inert while a dialog is open, at every width and across a resize, released by Back, close and `leave()`; an export dialog closed over an open Feature chat sheet leaves that sheet modal; every export dialog of a feature leads with ← FEAT-7; Show all names what it controls; Tab stays inside the sheet; a change of feature closes the sheet; at 900 px and narrower the sheet is the viewport's size with its buttons at the bottom.

---

### Task 11: The browser proof, docs, levels and the changelog

**Files:**
- Modify: `tools/verify-requirements-cdp.mjs` (an A6 section, last before the page-error gate; `--only=a6` runs the boot, the flag and that section alone), `docs/requirements.md` (**Export to a tracker** after **After starting**), `docs/storage.md` (the two tables), `docs/ui-levels.md` (design §9's rows), `docs/changelog/unreleased.md` (the Requirements entry)

- [ ] **Proof** (mock mode, jira-source linked with one profile): the Export ▾ items; the first export's setup (board 26) with its selects loading; the preview (board 27) in light and dark, its text AA; Create in Jira, the chip opening the ticket in a new tab and the page released; Export again with Update first and what changed; the comment preview and Add comment; Export anyway with a reason; at 390 px the full-screen sheet (← FEAT-n, the phone title, Show all, 44 px targets, Tab kept inside) and leaving the view releasing it; Worca cannot reach Jira, Try again after a refused token, a preview that cannot load and then loads; Report back on the Ready to build card, Start with it, and the write-back reaching the ticket. A failing check is fixed in the task that owns the behaviour.
- [ ] **Docs:** `docs/requirements.md` describes the export in product language (setup, preview, Export anyway, Export again, edited in the tracker, the states, Forget the link, Report back); `docs/storage.md` the two tables; `docs/ui-levels.md` the setup, preview, again dialog, chip, History card and Report back row (**S**), Connect a tracker… (**S**) and its Marketplace button (**A**); the changelog's Requirements entry.
- [ ] `node tools/test.mjs test/ui-levels.test.mjs` and `test/docs-site-changelog.test.mjs` pass; `npm run verify:requirements` → all checks passed.

---

### Task 12: Whole-branch check

**Files:** whatever this task finds to fix (no new feature code).

- [ ] Merge `dev`. If it took schema 79, renumber this migration past it (the rung, `test/db-migrate-v79.test.mjs` and the design's §3 note move together, with a case for a database stamped by the early numbering). Where A3 (Feature chat) meets this branch, keep both: the view's `leave()` releases the export dialog and the Feature chat sheet, `app.js` keeps one `leave()` line, the CSS blocks sit side by side inside the Requirements block.
- [ ] `npm test` on the branch; run every failing file on the base branch as well. A test that fails here and passes there, compared by name and run alone, is this branch's to fix; record both counts.
- [ ] The full suite and `npm run smoke` (with `smoke:auto` and `smoke:workspace`) on Linux, from a clean export of the committed tree, so the POSIX-only tests run; a failure that also fails on the base is not this branch's.
- [ ] `npm run verify:requirements` alone → all checks passed.
- [ ] `node --check` every `.mjs` the branch touched; no new `console.log`, `debugger`, `TODO` or `FIXME`; no local path; no real person's name in a fixture.
- [ ] Fix what is this branch's in the module of the task that owns it, its test first.
- [ ] A check against a real Jira (a test project, by hand: setup, preview, create, update after an edit in Jira, comment, Forget the link, a run with Report back) before export leaves Labs; its findings go into the pull request.

---

## Delivered

Each task landed as one commit; review fixes landed as their own commits.

| Task | Delivered | Tested by |
|---|---|---|
| 1 | v79 with both tables; setup and link rows; the `export` turn | `db-migrate-v79` (8 tests), `requirements-export-store` (4) |
| 2 | `ticket.mjs`, `renderTicketMarkdown`, the changes and the comment | `requirements-ticket` (9) |
| 3 | the optional ops in the contract and the plugin skill; the probe and its cache; mock answers; reach sentences | `requirements-export-trackers` (8), `plugin-shim`, `writeback` |
| 4 | jira-source's six ops, `fingerprintOf`, the README's Export section; the key always answered once Jira made the ticket; version-based "too old" | `jira-source-export` (24) against a fake Jira, Cloud and Data Center |
| 5 | the export service with the duplicate guard and the search grace; the export lock | `requirements-export` (26) |
| 6 | the routes, the statuses, `feature.export`, the two filters | `requirements-export-api` (8), the flag-off walk |
| 7 | Report back from Start to the harness's `plugin` row | `requirements-start`, `requirements-run-link` |
| 8–10 | the menu, Connect a tracker, setup, Not Ready, preview, again, comment, chip, History, states, Report back, the phone sheet, `leave()` | `requirements-view-export` (69) |
| 11 | the A6 section of the browser proof (36 checks in light, dark and 390 px); the docs, levels and changelog | `npm run verify:requirements` |
| 12 | merges of `dev` (A8, A3 and later); the final review's fixes: a neutral name in the fixtures, fixed reach phrases for a crashed or unreadable plugin with only the kind and the first line logged, http(s)-only ticket URLs, the tracker named by the preview, the found-and-linked frame, the Feature chat sheet kept modal under a closed export dialog | the files above, the full suite on Windows and Linux, the smokes, the proof |

Known and accepted (design D10): an update after a re-link from another site may send that site's issue type or priority id; a comment whose answer was lost can be posted twice. Not done in this branch: the preview's Markdown view and the wiki the plugin sends can differ on inline marks; the workspace start path for Report back has no test of its own; the real-Jira check (Task 12).

---

## Appendix: design decisions and boards → tasks

| Spec point | Task(s) |
|---|---|
| D1 one Export entry, the menu items, the tracker's name, Connect a tracker… | 3, 5, 6, 8, 11 |
| D2 connections on the Marketplace page; setup per project or workspace; the default connection; no token | 1, 3, 5, 6, 8, 11 |
| D3 optional connector ops in API 5; discovery via `capabilities().export`, cached; probes at once within 10 s; a failed probe stands a minute | 3, 4 |
| D4 the neutral ticket; description order; file names only; empty sections out | 2, 5 |
| D5 Ready, or Export anyway with a reason, recorded, at the top of the description | 5, 6, 9, 11 |
| D6 only what the preview shows; `previewHash`; labels normalised; the fixed label; per-export overrides; text-only rendering | 2, 5, 6, 9, 10, 11 |
| D7 Export again: update / comment / new; the link's own connection; labels only added; a new ticket moves the link | 4, 5, 9, 11 |
| D8 dates not versions; the spec per export; the summary and the comment; server-local dates | 1, 2, 5 |
| D9 the plugin's fingerprint; `ticketState`; Update anyway | 4, 5, 9 |
| D10 the pending marker; `findTicket` with label, marker and footer; the search grace; the accepted gaps | 1, 4, 5 |
| D11 reach sentences by kind; refused and gone as results; the capped server log | 3, 4, 5, 6, 10 |
| D12 Forget the link | 1, 5, 6, 10 |
| D13 one export per feature; busy while a round runs; export and start exclude each other; archived | 5, 7, 8 |
| D14 `EXPORT_TIMEOUT_MS`; a timeout keeps the pending marker | 3, 5 |
| D15 Start with Report back; `writeBack: 'yes'`; `doneStatus` | 5, 7, 10, 11 |
| D16 jira-source: REST v2, wiki markup, createmeta, textarea criteria fields, too old | 4 |
| D17 the History card | 5, 9, 11 |
| D18 server-side calls only; allowlist unchanged; no config in tables or views | 3, 5, 6, 7 |
| D19 flag, frames, no cost, mock answers | 3, 6, 11 |
| D20 dialog roles and names, focus, radiogroup, live regions, the phone sheet at 900 px and narrower, board 31's title, 44 px | 8, 9, 10, 11 |
| §3 data, the `export` turn, the two filters | 1, 6 |
| §4 the contract, the comment, the mock answers; §5 the Jira connector; §6 API | 2, 3, 4; 4; 6, 7 |
| §7 boards 26–31 and "Not on the boards" | 8, 9, 10, 11 |
| §9 testing; §10 where A6 meets A2, A8 and A3; §11 out of scope | 1–12; 5, 7, 12; not built |
