# Requirements (A6.1: Start from a ticket) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A product owner starts a feature from a ticket the team already wrote: **New feature › From a ticket…** finds the ticket in a connected tracker, shows exactly what will be taken (title, description, acceptance criteria, comments, attachments, each with a checkbox), and **Use this ticket** fills the form. **Start the interview** creates the feature at once with the ticked criteria as the product owner's own `R-po-<n>` (marked "from SHOP-124"), the picked comments as one file Worca reads, the picked attachments downloaded server-side and read like A8 files, and the feature linked to its ticket, so Export updates it and a run reports back to it. No model call for the import, nothing written to the tracker; behind the `requirements` flag.

**Architecture:** The Requirements code knows only "a task source that can import": four optional connector ops (`importOptions`, `searchTickets`, `importTicket`, `downloadAttachment`) plus `capabilities().import`, called server-side through the existing `callSource` (plugin API stays 5). A pure module `src/core/requirements/ticket-import.mjs` turns a tracker's answer into what the preview shows and the create stores (criteria section, clip, redaction, the comments file, the reasons, the default ticks). `src/core/requirements/import.mjs` is the service (sources, defaults, options, search, preview, the second read and the create); `src/core/requirements/attachment-fetch.mjs` downloads a picked attachment into a fresh private folder, checks it, writes the checked bytes into A8's store and hands it to A8's read queue. Storage is two columns (schema v81): `req_export_links.origin` and `req_attachments.fetch_json`. Jira's part lives only in `plugins/jira-source/connector/` (REST v2, Cloud and Data Center). The page module `ui/public/requirements-view.mjs` gains the button, two dialogs, the filled form, the Files card's download states and the imported link's export copy; CSS goes into the Requirements block of `ui/public/style.css`.

**Tech Stack:** Node ESM, `node:sqlite`, `node:test`, jsdom, Express (`ui/server.mjs` → `src/core/requirements/routes.mjs`), the plugin shim (`src/core/plugin-shim.mjs`, one child per op, `WORCA_MOCK=1` canned answers), vanilla DOM (`ui/public/*.mjs`), `node:http` fake Jira servers for the connector, headless Chrome over CDP for the browser proof.

**Spec:** `plans/requirements-a61-design.md` (decisions D1–D20, U1, U2, the copy points Q1–Q3 and §3–§11; it wins where this plan is unclear, except where Global Constraints say otherwise). A6: `plans/requirements-a6-design.md` (A6-D<n>); A8: `plans/requirements-a8-design.md` (A8-D<n>); A1: `plans/requirements-design.md` (A1-D<n>).

**Visual reference (UI tasks):** design round 6 of the Claude Design canvas "Requirements — design rounds 1 to 6": board 32 **New feature from a ticket**, board 33 **Pick a ticket**, board 34 **Import preview**, board 35 **Feature from a ticket** (with the export dialog), board 36 **Import states and phone**. The boards use upstream's classes (`card`, `btn` (the boards' `btn-mini` is `btn-sm`), `btn-primary`, `badge`, `chip`, `hint`, `select-wrap`, `field`); inline styles are layout hints. Where the design doc deviates from a board the doc wins; what no board shows is listed in design §7 "Not on the boards": build exactly that. The boards' people are replaced by "Ann Example", "Bo Example" and "Cy Example" everywhere in code, tests and fixtures.

## Global Constraints

- Stacked on `feat/req-a6-jira-export`. One commit per task (review fixes as their own commits); subjects start `Requirements:`; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. A merge of the base is a merge commit; no rebase, no amend.
- **No model call, no real tracker in tests.** Every tracker call in a test goes to the mock shim (`WORCA_MOCK=1`, `setMockSourceResponses`), an injected `callSource`, or the fake Jira HTTP servers of `test/helpers/fake-jira.mjs` on `127.0.0.1` (Cloud and Data Center, plus a "media" server for Cloud's signed attachment address). The mock shim answers every new op, so the browser proof runs offline.
- **Flag (D18).** Every new route is in `REQUIREMENTS_ROUTES` behind `requireFlag('requirements')`, so the flag-off walk of `test/requirements-api.test.mjs` covers it; changes reach the page only through the `requirements-changed` frame; the import books nothing (the files' reads cost and book as A8 reads).
- **Schema v81** (first written as v80 on A6's v79; A6 took 80 when it met `dev`'s 79, so Task 18 renumbered it): `req_export_links.origin TEXT NOT NULL DEFAULT 'export'` and `req_attachments.fetch_json TEXT`, both in `INCREMENTAL_COLUMNS`; the rung `if (current < 81) repairSchemaGaps(db, schemaGaps(db));` right after A6's v80 rung. No new table.
- **The contract (D2):** the four ops are optional and additive; `WORCA_PLUGIN_API` stays 5, jira-source keeps `"worca-cc-api": ">=5 <6"`. A source can import only when `capabilities()` answers `import: true`; A6's probe (one call per plugin, source id and installed version) answers both `export` and `import`. None of the four is added to `POST /api/sources/call`'s allowlist.
- **Safety (D15):** every tracker call is `callSource` from `import.mjs` or `attachment-fetch.mjs`, with the connection's profile; no response carries a config value. Ticket text is data: the description in `<description>`, the criteria in `<current_spec>`, the comments in `<attachments>`, the import line in `<thread>`, all through the prompts' existing `asData`; the page renders it with `textContent` only. The description, criteria and comment bodies are redacted with `redactAskText` at the import (before the preview, before storage, before any clip); downloaded attachments are stored as given and redacted on the way to the model (A8). A download writes only to `dest`, the fixed name `body.part` inside a fresh 0700 folder `<worcaHome>/tmp/requirements/att-get-<8 hex>/`; the host trusts nothing there until its checks pass. People are display names only, never an email or account id.
- **Timeouts (D17):** `IMPORT_TIMEOUT_MS = 60_000` for `importOptions`, `searchTickets`, `importTicket`; `DOWNLOAD_TIMEOUT_MS = 120_000` per `downloadAttachment`; `MAX_DOWNLOAD_JOBS = 2` across all features, separate from A8's `MAX_READ_JOBS` and A1's `MAX_JOBS`; a create waiting for its files does not hold a `MAX_JOBS` slot; round 1 waits at most `ROUND1_WAIT_MS` (6 minutes) for downloads and reads together.
- **Errors (D16, U1):** search, preview and create failures use A6's own `reachSentence` / `reachReason` ("Worca could not reach Jira: <reason>."), with no phrase table of their own. A download's failure is per file, "Worca could not get this file from Jira: <reason>.", with fixed reasons by kind, never the plugin's text. The server log gets only the first line of a raw message, at most 200 characters (`firstLine`). `Jira` is always the source's `displayName`; the Requirements code never names Jira.
- **Copy:** every user-facing string is design §2 / §7 verbatim (`SHOP` the tracker project, `SHOP-124` the ticket, `FEAT-8` the new feature, `FEAT-7` another feature, server-local dates). Where the design names none, this plan adds, in product language: "Choose a connection from the list." · "key must be a ticket key such as SHOP-124" · "fromTicket must be an object" · "Jira cannot import any more." · "Worca is still getting this file from Jira." · "Worca cannot use this file. Remove it from the ⋯ menu." · the A8 caps on a create ("<name> was not added: a feature takes up to 10 files." and the 100 MB line) · the refused tails "it is not the file Jira described" and "its content does not match its type" · "1 ticket in SHOP matches …", "No ticket matches …", "SHOP-124 has no description." · the D12 strip line · the comment-gone line · "Downloaded from SHOP-124." (board 35) · the thread line's one-criterion and no-criteria forms.
- `style.css`: tokens only (no hex, no `rgba(`); font sizes from the type scale; radii `var(--r-xs|sm|md)` or 0; a phone tap area is an absolutely placed `::after` hit area, never `min-height:44px` on `.btn`; shared icons, never a text glyph; a picked row or checkbox is never green-filled (a picked ticket row has an ink border). Every new rule is a `req-import-*` rule (or extends `req-file*` / `req-history*`) inside the Requirements block. `style.css` and `requirements-view.mjs` keep their CRLF line endings.
- **Dialogs (D19):** `role="dialog"` `aria-modal="true"`, labelled by their `h2`, opened through `openModal(card, { trigger, first: title, page: true })`: the focus moves to the title, every other child of `<body>` is inert at every width, released on every close path and on the view's `leave()`; the focus returns to **From a ticket…**. Every async answer checks the dialog's generation and, for a search, its request number; a busy button ignores presses; live regions are persistent nodes.
- **Phone (D19):** at 900 px and narrower both dialogs are A6's full-screen sheet (`req-dialog req-export req-import`), **← New feature** first, sections stacked, 44 px hit areas, full-width buttons; the sheet fits 390 × 844 with its buttons visible.
- No local machine paths and no real person's names in shipped files, tests, docs or plans. No import from Shaper code; core modules never import `ui/server.mjs`.
- Tests run one file at a time (`node tools/test.mjs test/<file>.test.mjs`); the full suite only in Task 18, compared test name by test name with the base. Every task brief stays under about 450 lines; the plan review split the downloads (Tasks 7, 8) and the two dialogs (Tasks 11, 12) for that reason.

## Review Focus

1. **No tracker call from the browser, no secret out, nothing written to the tracker.** Every op goes through `import.mjs` or `attachment-fetch.mjs` → `callSource`; `/api/sources/call`'s allowlist is unchanged; the import calls no write op (Tasks 3, 6, 7, 9).
2. **The downloaded file is trusted only after the host's checks.** Fresh 0700 folder, fixed `body.part`, `lstat` a regular file, size equal to the answer and at most 25 MB, A8's type, sniff, UTF-8 and duplicate rules; the folder removed on every path; a removed file's late download thrown away; the bytes stored are the bytes checked (Tasks 5, 7).
3. **Ticket text is data.** Redacted at the import, escaped by `asData`, rendered with `textContent`; the import line is the only new thread line, and every other feature's prompts stay byte-identical (Tasks 2, 10, 12).
4. **The create answers at once.** No download is awaited before the 201; round 1 waits up to `ROUND1_WAIT_MS` without a `MAX_JOBS` slot; a failed download marks only its file, and every failure marks it (Tasks 7, 8, 9).
5. **One ticket follows one feature; an imported link behaves as A6's.** D12's unlinked create; Update keeps the ticket's issue type and priority; the comment is "since the import" until the first export; the edited check compares with the import's fingerprint (Tasks 9, 10, 16).
6. **Accessibility and phone.** Dialog roles and names, focus on the title and back to From a ticket…, the inert page, the radio group, named checkboxes with their reasons, persistent live regions, the 390 px sheet (Tasks 11–17).

## Files

| File | Task(s) | Responsibility |
|---|---|---|
| `src/core/db.mjs` | 1, 18 | v81: two `INCREMENTAL_COLUMNS`, the rung |
| `src/core/requirements/store.mjs` | 1 | `createFeature`'s `criteria`; `saveExportLink`'s `origin`; `linkByTicket`; the `downloading` status, `fetch` on a row, `listDownloadingAttachments` |
| `src/core/requirements/ticket-import.mjs` (new) | 2 | pure: the criteria section, the clip, counted redaction, the comments file, the reasons, the thread line, `processTicket`, `pickDefaults` |
| `src/core/requirements/export.mjs` | 3, 10 | one probe for `export` and `import` (`trackersWith`); `connectionLabel`, `sameConn`, `firstLine` exported; the imported link in `planExport`, `linkDates`, `exportView` |
| `src/core/plugin-shim.mjs`, `src/core/plugin-api.mjs` | 3 | mock answers for `capabilities` and the four ops; the contract comment |
| `.claude/skills/creating-worca-cc-plugins/SKILL.md` | 3 | the contract table's four rows and a paragraph |
| `plugins/jira-source/connector/index.mjs`, `markup.mjs` | 4, 5 | `capabilities().import`, the four ops; `htmlToMarkdown`'s images, tables and people; `plainWiki` |
| `plugins/jira-source/connector/jira-api.mjs`, `README.md` | 5 | `jiraDownload`; an Import section |
| `src/core/requirements/import.mjs` (new) | 6, 9 | sources, defaults, the view, options, search, preview; then `prepareImport`, `createImported` |
| `src/core/requirements/attachment-fetch.mjs` (new) | 7 | the download row, the queue, the folder, `checkFetched`, the failures, the restart |
| `src/core/requirements/attachment-job.mjs`, `attachments.mjs`, `ready.mjs`, `interview.mjs` | 7, 8 | round 1 waits for downloads; Remove, Try again and edits on a downloading file; the prompt's "being downloaded"; readiness; the boot sweep |
| `src/core/requirements/routes.mjs` | 8, 9 | the files' `from`; the four import routes; `POST /api/requirements` with `fromTicket` |
| `src/core/requirements/ticket.mjs`, `markdown.mjs`, `round.mjs` | 10 | the ticket's own key left out of a criterion's source; "since the import"; the import thread line |
| `ui/public/requirements-view.mjs`, `ui/public/style.css` | 11–16 | the button, the pick and preview, the filled form, the Files card's download states, the working line, the criterion tag, History, the imported link's export copy |
| `tools/verify-requirements-cdp.mjs`; `docs/requirements.md`, `storage.md`, `ui-levels.md`, `changelog/unreleased.md` | 17 | the browser proof (alone with `--only=a61`); docs, levels, changelog |

The spec put the Jira tests in `test/jira-source-connector.test.mjs` (a fake `fetch`); the plan follows A6 instead and tests the new ops over real HTTP against `test/helpers/fake-jira.mjs`, so Cloud's redirect and the stream cap are real.

---

### Task 1: Schema v80 (now v81) and the store

**Files:** `src/core/db.mjs`, `src/core/requirements/store.mjs`; tests `test/db-migrate-v81.test.mjs` (new; written as v80), `test/requirements-import-store.test.mjs` (new), `test/db-migrate-v79.test.mjs` and `-v77` (the new columns).

**Interfaces:** `createFeature({ …, criteria = [] })` writes `{ id: 'R-po-<n>', text, edited: true, source }` (empties and repeats left out, at most 30 of 500 characters; `criteriaSeq` their count); `saveExportLink(seq, { …, origin = 'export' })` and `Link.origin`; `linkByTicket({ plugin, sourceId, profile, key }) → { seq, id, title } | null` (archived included); `insertAttachment` / `updateAttachment` accept `status: 'downloading'`, `Attachment.fetch: { plugin, sourceId, profile, tracker, key, id, name, bytes } | null`; `listDownloadingAttachments()`.

**Tests:** both columns on a fresh database and from A6's 80, A6.1's early 80, dev's 79, A3's 78, A8's 77, upstream's 74–76 and below 72, and one stamped past this version without them (repaired); existing rows read `'export'` and NULL; criteria order, source and caps; a link's origin; `linkByTicket` across profiles and keys; a downloading row with its pending hash.

---

### Task 2: The ticket as the preview shows it and the create stores it (pure)

**Files:** `src/core/requirements/ticket-import.mjs` (new); `test/requirements-ticket-import.test.mjs` (new).

**Interfaces:** `IMPORT_LIMITS = { comments: 50, commentChars: 4000, page: 20 }`; `splitCriteria(md) → { description, items, heading }`; `clipDescription(text) → { text, clipped }`; `redactCounted(text) → { text, hidden }`; `commentsFileName`, `descriptionFileName`, `commentsMarkdown(key, comments)`; `importReason(name, cls, bytes)` (D9's "Not offered:" lines); `importThreadLine({ tracker, key, criteria, comments })`; `processTicket(raw, { tracker })` (the processed ticket: meta, title, description and its file, redaction count, criteria and where they came from, comments, attachments with their reasons, fingerprint); `pickDefaults(processed, { count, bytes })` (every criterion, every comment by a person, attachments in order within 10 files and 100 MB counting the form's own files); `CAP_FILES`, `CAP_BYTES`.

**Tests:** `splitCriteria` on headings, bold lines, "AC:", lists, lines to a blank line, two sections (the first wins), the 30 × 500 caps; the clip at a paragraph; a `ghp_` token and a PEM block hidden and counted, before any split or clip; the comments file byte for byte; the reasons; the thread line's three forms; `processTicket` with criteria from a section and from a field, a long description, comments clipped and capped; the default ticks.

---

### Task 3: The shared contract: the import capability, the mock answers, the plugin skill

**Files:** `src/core/requirements/export.mjs` (the probe), `src/core/plugin-shim.mjs` (`MOCK_DEFAULTS`), `src/core/plugin-api.mjs` (the comment), the plugin skill's contract table; tests `test/requirements-export-trackers.test.mjs`, `test/plugin-shim.test.mjs`.

**Interfaces:** `trackersWith('export' | 'import', d)` (one cached `capabilities()` probe answers both; `exportTrackers(d)` is `trackersWith('export', d)`); `connectionLabel`, `sameConn`, `firstLine` exported. Mock mode: `capabilities` `{ writeBack: true, export: true, import: true }`; `importOptions` SHOP and OPS; `searchTickets` four tickets (SHOP-124, SHOP-123, SHOP-131, SHOP-98) filtered by words or a pasted key or link; `importTicket` board 34's ticket for any key (`{ gone: true }` for SHOP-999: a criteria section, six comments with one by an app and one holding a fake token, one restricted, five attachments of which an Office file and a 31 MB scan are not offered); `downloadAttachment` writes a tiny valid body to `dest` (`wx`, 0600), `WORCA_MOCK_DOWNLOAD_MS` delays it.

**Tests:** one capabilities call answers export and import, and a source that only imports is no export tracker; the mock answers (search, a ticket, a gone key, a download into `dest`, too large, gone).

---

### Task 4: The Jira connector reads a ticket (Cloud and Data Center, against a fake Jira)

**Files:** `plugins/jira-source/connector/index.mjs`, `markup.mjs`; `test/helpers/fake-jira.mjs` (seeded issues, `/rest/api/2/field`, the comment page, the import search); `test/jira-source-import.test.mjs` (new); `test/jira-source-export.test.mjs` (capabilities).

**Interfaces:** `capabilities` adds `import: true`; `importOptions({}) → { projects: [{ value, label: '<key> — <name>' }] }`; `searchTickets({ project?, search?, cursor? })` (a pasted key first, else Worca's own JQL `text ~ "…" ORDER BY updated DESC`, Cloud's `/search/jql` with `nextPageToken` or Data Center's `/search` with `startAt`, 20 a page, never the saved filter); `importTicket({ key, criteriaField? })` → design §4's answer or `{ gone: true }` (404, and 403 on Data Center). `htmlToMarkdown` turns `<img alt>` into "(image: <alt>)", table rows into `| a | b |`, and links to people into plain names; `plainWiki` is the raw wiki fallback, a mention becoming "someone".

**Tests:** capabilities keep write-back's input; projects on both; search newest first, by words, by a pasted key or link, paging by each cursor; the description as Markdown, criteria from the field named "Acceptance Criteria" or from `criteriaField`, comments with names only (restricted dropped, apps marked), past the embedded page newest 50 first; a site that renders nothing gives plain wiki text with no account id; gone on both, a Cloud 403 in Jira's words; the markup rules.

---

### Task 5: The Jira connector downloads one attachment into the host's folder

**Files:** `plugins/jira-source/connector/jira-api.mjs` (`jiraDownload`), `index.mjs` (`downloadAttachment`), `README.md` (an Import section); `test/helpers/fake-jira.mjs` (attachment content and a "media" server); `test/jira-source-download.test.mjs` (new).

**Interfaces:** `downloadAttachment({ key, id, maxBytes, dest }) → { name, mime, bytes } | { tooLarge: true, bytes } | { gone: true, forbidden?: true }`. The attachment must belong to `key`; its metadata size is checked first; the `content` URL must be on the site; one redirect at most, the Authorization header only on the site's own origin and the other origin only over `https:`; the body is streamed into `dest` (`wx`, 0600) through a counter that stops past `maxBytes`; every failure deletes what it wrote and never a file it did not create. 401 throws `auth` only when the request carried the token (final review M2: a 401 from Cloud's signed address is "it answered with an error").

**Tests:** Cloud's redirect to the signed address without the header; Data Center's `/secure/attachment` with the bearer token; a second redirect, plain http and another origin refused; the size before and during the stream; an existing file at `dest` never overwritten or deleted; 401, 403 (gone and forbidden), 404 and an attachment not on the ticket, with nothing left at `dest`.

---

### Task 6: The import service: sources, defaults, projects, search, preview

**Files:** `src/core/requirements/import.mjs` (new); `test/requirements-import.test.mjs` (new).

**Interfaces:** `IMPORT_TIMEOUT_MS`; `importSources(d)`; `importDefaults(scope, sources)` (the export setup's connection and project when it can import, else A6's `defaultConnection` and All projects); `importView`; `importOptions`; `searchTickets` (each ticket with `linkedTo: { id, title } | null`); `previewImport(scope, { …conn, key, formFiles })` (the processed ticket with its default ticks, the connection's label and `linkedTo`; no fingerprint). Errors: `BAD_REQUEST` "Choose a connection from the list."; `NOT_FOUND` with `gone` ("SHOP-999 was not found in Jira, or this connection cannot see it."); `TRACKER` with `kind` and A6's reach sentence, or "Jira cannot import any more.".

**Tests:** the sources that can import and their defaults; a source whose capabilities do not say import is not offered; projects and search through the connection within a minute, with `linkedTo`; a tracker failure in A6's words; the preview with its ticks, a setup's criteria field on the same connection, the caps counting the form's files, a ticket another feature follows, a gone key and a bad key; nothing written.

---

### Task 7: Downloads: the private folder, the checks and the queue

**Files:** `src/core/requirements/attachment-fetch.mjs` (new); `attachment-job.mjs` (`enqueueRead`, `settleOwner`, `pendingFor` counts downloads); `test/requirements-attachment-fetch.test.mjs` (new).

**Interfaces:** `DOWNLOAD_TIMEOUT_MS`, `MAX_DOWNLOAD_JOBS`; `insertDownloadRow(owner, { conn, tracker, key, id, name, bytes, from })` (the `downloading` row, `sha256: 'pending:<id>'`, the `added` turn with `from`); `queueDownloads(owner, ids, { by }, deps)`, `isDownloading`, `downloadsPending`, `cancelDownload`, `redownload`; `makeFetchFolder()`; `checkFetched(dir, dest, answer, maxBytes)` (inside the folder, `lstat` a regular file and no link, the answered size; opened once, on POSIX without following a link, checked against the `lstat` and read through that one descriptor); `recoverDownloads()`. A failed file is `DOWNLOAD` (Try again) or `REFUSED` (none); any failure of the host's own steps is `DOWNLOAD` "Worca could not store it", so a row is never left `downloading` without a job.

**Tests:** the download row; a download into a fresh folder, written into the store under the row id, then read, the folder gone; two at a time across features; per-file failures by kind (fixed reasons, gone, forbidden) and downloading again; a body Worca cannot store; a refused file (too large, a size that lied, not its type, a duplicate); `checkFetched`'s refusals and the 0700 folder.

---

### Task 8: Downloads in A8: Remove, Try again, round 1's wait, readiness, the restart, the Files view

**Files:** `attachment-job.mjs` (`addAttachments`' `from`, `removeAttachment`, `readAgain`, the edits, `recoverAttachmentReads`, `sweepReadFolders`, `fileView`), `attachments.mjs` (`stateNote`, `fileOrigins`), `ready.mjs`, `interview.mjs`, `routes.mjs` (each file's `from`); tests appended to `test/requirements-attachment-fetch.test.mjs` and `test/requirements-ready.test.mjs`.

**Interfaces:** Try again re-downloads a failed download ("Worca cannot use this file. Remove it from the ⋯ menu." for `REFUSED`); a downloading file refuses edits, asks and Read again ("Worca is still getting this file from Jira."); Remove deletes its row at once and throws its late result away; the boot turns `downloading` into `INTERRUPTED` and sweeps `att-get-*` older than an hour; the prompt says "<name> (<kind>, <size>): being downloaded from SHOP-124; known by name only."; `fileOrigins(turns)`; a file still downloading counts as one still being read, so readiness never passes "Interview finished" while it is on its way (plan review M4). Unchanged (U2): the file routes keep A8's busy rule, so Remove and Try again on those files wait until round 1 has started.

**Tests:** Try again, a refused file, the restart; a link left at `dest` refused (POSIX only); a downloading file refusing Read again and its removal; round 1 waiting and listing a downloading file by name only; the sweep; `fileOrigins`; readiness.

---

### Task 9: The create from a ticket and the import routes

**Files:** `import.mjs` (`prepareImport`, `createImported`), `routes.mjs`; `test/requirements-import-api.test.mjs` (new), `test/requirements-run-link.test.mjs` (the allowlist).

**Interfaces:** `prepareImport(scope, fromTicket, { diskFiles })` (the second read: the criteria as the form sent them, comments and attachments by id from the fresh read, the generated files, the downloads, `notOnTicket` for what is gone; A8's caps over all of them; writes nothing). `createImported` (one transaction for the feature, its criteria, A6's link with `origin: 'import'` unless another feature follows the ticket, and the `export` turn `imported` `{ action, tracker, key, url, at, linked, linkedTo?, criteria, comments, files }`; then the generated files, the downloading rows and their queue; never awaits a download). Routes, before `GET /api/requirements`: `GET /api/requirements/import/:scopeType/:scopeKey`, `POST …/options`, `…/search`, `…/preview`; `POST /api/requirements` with `fromTicket` → 201 `{ feature, turns, filesNotStored, notOnTicket }`.

**Tests:** the route table; the four routes with no config value, an unlisted connection 400, a gone key 404; Start the interview answering 201 at once with R-po-1… from SHOP-124, the link, the comments file and the downloading rows; the second read naming what is gone; gone 404 and unreachable 502 creating nothing; D12's unlinked feature; the caps at the create; Try again and Remove over HTTP; `/api/sources/call` refusing all four ops.

---

### Task 10: An imported link in Export, and the import's thread line

**Files:** `markdown.mjs`, `ticket.mjs`, `export.mjs`, `round.mjs`; tests `test/requirements-export.test.mjs`, `test/requirements-ticket.test.mjs`, `test/requirements-round.test.mjs`.

**Interfaces:** `criterionLine(c, ownKey)`, `renderTicketMarkdown` and `buildTicket` leave "(from <ownKey>)" out on an update of that ticket; `renderExportComment(…, { after: 'import' })` heads "Updated in Worca since the import (<date>)"; `linkDates` gains `origin`, `importedOn`, `sinceImport`; `planExport` keeps an imported link's issue type, priority and criteria target (no `setupRules`); History gains `imported` with `linked` and `linkedTo`; `threadText` writes the import line as data and nothing for A6's other export turns.

**Tests:** the own source left out, another kept; the comment since the import; one thread line for an import and a byte-identical thread otherwise; an imported feature's round 1 prompt (the line, the comments file, a downloading file by name); Update keeping type and priority; the edited check against the import's fingerprint; an update without a setup, and a new ticket needing one and making an export link; the export view's origin and History.

---

### Task 11: The page: From a ticket… and the pick (boards 32, 33)

**Files:** `ui/public/requirements-view.mjs` (`paintNew`'s button and label row; the pick), `style.css`; `test/requirements-view-import.test.mjs` (new).

**Interfaces:** `importPrefs` (the session's last connection and project, D3); `importUrl`, `importErr`, `pickTracker`, `importBack`; `openPick(ctx, keep)` with `ctx = { scope, trigger, formFiles, onUse }`; `data-ui` `import-open`, `pick-*`.

**Tests:** the button only with an importing connection; Start from a ticket as a modal (title focused, page inert, Escape returns the focus) with the recently updated tickets as the radio group "Tickets"; the 300 ms search with the count line and a late answer dropped; Show more with its cursor; several connections; a failed search with Try again; the CSS inside the Requirements block.

---

### Task 12: The page: the preview, and Use this ticket (board 34)

**Files:** `requirements-view.mjs` (`openImportPreview`; `useTicket`'s first part), `style.css`; `test/requirements-view-import.test.mjs`.

**Interfaces:** `openImportPreview(ctx, pick)` hands `ctx.onUse(ticket, pick)` the ticket as the form needs it (connection, meta, title, description, criteria, picked comments and the comments file, picked attachments); a 502 adds "Nothing was changed." and, at Advanced, the Marketplace line.

**Tests:** Continue opens Start from SHOP-124 with its title focused, the description as text, the criteria renumbered as ticked, the ticks, reasons and notices, and Back keeping the search; Use this ticket only fills the form, closes the dialog, releases the page and posts nothing.

---

### Task 13: The page: the caps, the states and the phone sheet (boards 34, 36)

**Files:** `requirements-view.mjs`, `style.css`; `test/requirements-view-import.test.mjs`.

**Interfaces:** `CAP_FILES_UI`, `CAP_BYTES_UI`; an unticked attachment whose tick would pass a cap is disabled and described by that line, recomputed on every tick; past three comments the rest fold behind **Show all <n> comments** at 900 px and narrower.

**Tests:** the caps and freeing room; unreachable (what changed, where to fix it at Advanced), no match, a pasted key that is not there; a ticket another feature follows (amber alert), no criteria, comments or attachments, a long description; a gone preview with no Try again; the phone fold; the phone CSS with 44 px hit areas.

---

### Task 14: The page: the form a ticket filled, and Start the interview with it (board 32, board 36's 8)

**Files:** `requirements-view.mjs` (`paintNew`), `style.css`; `test/requirements-view-import.test.mjs`.

**Interfaces:** `imp`, `filled`, `lastPick`; `renderImport`, `useTicket`, `stopUsing`, `removeTicketFile`, `ticketFiles`, `notOnTicketLines`; the create posts `fromTicket: { plugin, sourceId, profile, key, criteria, comments, attachments, descriptionFile }`.

**Tests:** the strip, the description hint, the criteria and the ticket's files; × on a file and Stop using SHOP-124 (keeps what was typed); the create's body and the page naming what the second read no longer found; a create that cannot read the ticket keeps the form and posts once per press; Change ticket… with Replace / Keep mine; the unlinked and empty-description lines.

---

### Task 15: The page: the Files card while files come from the tracker (board 35, board 36's 9–11)

**Files:** `requirements-view.mjs` (`readingLine`, `fileNode`, `fileRow`, `failedLine`, `fileMenu`, `downloadingBadge`), `style.css`; `test/requirements-view-imported.test.mjs` (new).

**Interfaces:** the working line "Getting <n> files from <key>…" in A8's persistent `role="status"` node; a persistent **Downloading…** badge per file; "from <key>" in the meta line; no switch, Open, Read again or name link while a file has no body; the failure lines with **Try again** (none for `REFUSED`); Build's line "<name> cannot go with the run: <the download's reason>." (Q3).

**Tests:** the working line from downloading to reading in one node; each file's state and origin; a failed download (one post per press), one a restart stopped, one Worca could not use.

---

### Task 16: The page: the imported link: the criterion tag, History and Export (board 35, D11)

**Files:** `requirements-view.mjs` (`srcTag`, `historyCard`, `startExport`, `openAgain`); `test/requirements-view-imported.test.mjs`.

**Interfaces:** a criterion whose source is the link's key links to the ticket; History's "Imported SHOP-124 from Jira · 27 Oct, 09:12" and "Started from SHOP-123 in Jira, not linked: FEAT-7 is."; Export to Jira… on a linked feature opens the again dialog without a setup, titled "Export FEAT-8 to Jira" with D11's copy until the first export; Create a new ticket without a setup opens the setup first.

**Tests:** the tag (and a file's tag unchanged); both History lines; the dialog before and after the first export; a new ticket through the setup.

---

### Task 17: The browser proof, docs, levels and the changelog

**Files:** `tools/verify-requirements-cdp.mjs` (an A6.1 section, last; `--only=a61` runs the boot, the flag and that section alone; A6's screenshot and contrast helpers shared), `docs/requirements.md` (**Start from a ticket** before **Export to a tracker**), `docs/storage.md` (the two columns and `att-get-*`), `docs/ui-levels.md` (one row **S**, the Marketplace hint **A**), `docs/changelog/unreleased.md`.

- [ ] **Proof** (mock mode, jira-source linked with one profile): From a ticket… on New feature; the pick and a search for "cancel"; the preview (the app comment unticked, the Office file and the 31 MB scan not offered) in light and dark, AA; Use this ticket; Start the interview → FEAT-8 with the chip, R-po-1 to R-po-3 tagged SHOP-124, a Downloading… badge and the working line, then every file read; Export ▾ › Export to Jira… opening Export FEAT-8 to Jira; the 390 px sheet (← New feature, Tab kept inside, AA) and leaving the view releasing it.
- [ ] **Docs** in product language, including that reading the picked files costs what any file read costs and that `WORCA_MOCK_DOWNLOAD_MS` sits beside `WORCA_MOCK_READ_MS`.
- [ ] `test/ui-levels.test.mjs` and `test/docs-site-changelog.test.mjs` pass; `--only=a61` and `npm run verify:requirements` → all checks passed.

---

### Task 18: Whole-branch check

- [ ] Merge the base (`feat/req-a6-jira-export` until A6 merges, then `dev`) with merge commits only; keep both sides where A6.1 meets A6 and A8 (`export.mjs`'s probe and `planExport`, `attachment-job.mjs`'s queue and `readAgain`, the route table, `paintNew`, `fileRow`, `openAgain`, the Requirements block of `style.css`).
- [ ] Renumber the schema past the base's (now 81), with a case for a database stamped 80 by the early numbering.
- [ ] The full suite file by file on Windows, every failing file run alone on the base, compared by test name; a failure only here is this branch's to fix.
- [ ] The full suite and `npm run smoke` on Linux (WSL, Node 22) from a clean archive of the committed tree, compared with A6 the same way.
- [ ] `--only=a61` and `npm run verify:requirements` → all checks passed.
- [ ] `node --check` every touched `.mjs`; no new `console.log`, `debugger`, `TODO` or `FIXME`; no local path; only the made-up names in fixtures; no whole-file rewrite of the CRLF files.
- [ ] A final review of the whole branch; its fixes as their own commits, each test first.
- [ ] A check against a real Jira (by hand, on a test project) before the import leaves Labs; its findings go into the pull request.

---

## Delivered

Each task landed as one commit; review fixes landed as their own commits.

| Task | Delivered | Tested by |
|---|---|---|
| 1 | the two columns (v80, renumbered to v81 in Task 18); criteria on create; the link's origin; `linkByTicket`; download rows | `db-migrate-v81` (9 tests), `requirements-import-store` (5) |
| 2 | `ticket-import.mjs`; review fix: redaction before the split and the clip | `requirements-ticket-import` (18) |
| 3 | one probe for export and import; the mock answers; the contract and the plugin skill | `requirements-export-trackers`, `plugin-shim` |
| 4 | jira-source's `importOptions`, `searchTickets`, `importTicket`; the markup rules and `plainWiki`; review fixes: criteria wiki through `plainWiki`, a bounded Cloud search, nested lists | `jira-source-import` (18) against a fake Jira, Cloud and Data Center |
| 5 | `downloadAttachment` and `jiraDownload`; the README's Import section | `jira-source-download` (7) |
| 6 | the import service up to the preview | `requirements-import` (8) |
| 7, 8 | `attachment-fetch.mjs`; downloads inside A8 (Remove, Try again, round 1's wait, readiness, the restart, the sweep) | `requirements-attachment-fetch` (14; the link-at-`dest` test is POSIX only), `requirements-ready` |
| 9 | the create from a ticket and the four routes | `requirements-import-api` (8), the flag-off walk, `requirements-run-link` |
| 10 | the imported link in Export; the import's thread line | `requirements-export`, `requirements-ticket`, `requirements-round` |
| 11–14 | the button, the pick, the preview, the caps, the states, the phone sheet, the filled form and its create; review fixes for focus, described rows, Show more, long names on a phone, tap areas | `requirements-view-import` (46) |
| 15, 16 | the Files card's download states, the criterion tag, History, the imported link's Export copy; review fixes for the menu and the lock, Build's chip for a file never got, a New ticket after a gone ticket | `requirements-view-imported` (18) |
| 17 | the A6.1 section of the browser proof (light, dark, 390 px; alone with `--only=a61`); the docs, levels and changelog; the criteria label's AA in light | `npm run verify:requirements` |
| 18 | the merges of A6 (with `dev`); the renumber to v81; the full suite on Windows and Linux; the final review's fixes: the preview's checkboxes as listed pickers, a database error after a stored download offering Try again, a 401 from Cloud's signed address not reported as the token, no clipped search cursor, criteria redacted before clipping at Start, the R-po hint hidden with nothing ticked (Q1), Build's line in A8's words (Q3), the docs on read costs and a download's 403 | the files above, the full suite, the smokes, the proof |

## Known and not done

- **Real Jira:** not yet checked end to end against a real Jira site (Task 18's last step). On Windows with Node 24 the plugin child can crash on exit, an upstream bug already on `dev`; the import on Windows needs that fix, which is a separate pull request.
- **Follow-ups:** the preview's caps count the form's files and the attachments but not yet the comments and description files (D9; the server's caps check them at the create); a local disk error during a download reads as a network error; after leaving the page while a feature is being created, the page still opens it when the create answers.

## Deviations from the spec

Each is recorded in the design as "(adjusted for the build)" or as U1, U2 or Q1–Q3.
- **Errors (U1, D16):** search, preview and create failures use A6's `reachSentence`; a download's reasons are fixed phrases, never the plugin's text; the log keeps a failure's first line only.
- **The body is read once (D9):** `dest` is opened once, checked against its `lstat` and read through that descriptor, and those checked bytes are written into A8's store, instead of a rename of `dest`, which would let the file change between the check and the move.
- **Two transactions, not one (§8):** the feature, its link and its turn are one; the downloading rows another; the generated files go through A8's `addAttachments`, and a store failure never undoes the feature.
- **Small additions the code needed:** the preview takes `formFiles: { count, bytes }`; the create answers `notOnTicket` beside A8's `filesNotStored`; `fetch_json` holds the tracker's display name; a 403 download answers `forbidden`; the `imported` turn carries `linkedTo`; "from SHOP-124" is derived from the file turns (`fileOrigins`); jira-source finds the "Acceptance Criteria" field through `/rest/api/2/field`; an empty attachment is "Not offered: it is empty.".
- **The proof:** §9's "untick the automation comment" contradicts D8 (app comments start unticked), so the proof checks it is unticked and unticks a person's comment; it checks the download states, not a timing-dependent count.
- **Busy while round 1 waits (U2):** the file routes keep A8's busy rule; no exception code.
- **The preview's redaction line** sits under the description (§7) where board 34 shows it under the comments (the doc wins).

---

## Appendix: design decisions and boards → tasks

| Spec point | Task(s) |
|---|---|
| D1 the entry on New feature; it fills the form; only with an importing connection | 11, 12, 14 |
| D2 four optional ops, `capabilities().import`, A6's cached probe, API 5, not in `/api/sources/call` | 3, 4, 5, 6, 9 |
| D3 connection and project as A6 chooses them; the session's last choice | 6, 11 |
| D4 one search box, recently updated first, 300 ms, 20 a page, Show more, Linked to FEAT-7, the radio group | 4, 6, 11 |
| D5 the preview shows exactly what will be imported; default ticks; Back keeps the search; nothing sent | 2, 6, 12, 13 |
| D6 title and description; empty; longer than 20,000 → the description file | 2, 9, 12, 13, 14 |
| D7 criteria as R-po (edited, from SHOP-124): a field, else a section; 30 × 500; the tag links the ticket | 1, 2, 4, 9, 10, 16 |
| D8 comments as one file Worca reads; names only; apps unticked; restricted left out; newest 50 | 2, 4, 9, 12 |
| D9 attachments with reasons; caps over the whole form; the 0700 folder; the host's checks; the checked bytes stored | 2, 5, 7, 9, 13, 14 |
| D10 the feature at once, downloads afterwards, round 1 waits, readiness, per-file failures, Try again, removal, restart | 7, 8, 9, 14, 15 |
| D11 A6's link with `origin = 'import'`; Export's copy; type and priority kept; edited check; Report back; a new ticket | 1, 9, 10, 16 |
| D12 one ticket follows one feature | 1, 6, 9, 12, 13, 14, 16 |
| D13 schema v81, two columns | 1, 18 |
| D14 the import's thread line; `from` on the file turn; "from SHOP-124" | 2, 7, 8, 9, 10, 15 |
| D15 server-side calls; data rules; redaction at the import; no account id; the download's rules; `dest` and the checks | 2, 3, 4, 5, 6, 7 |
| D16 the errors; U1 A6's wording | 3, 6, 7, 9, 11–15 |
| D17 limits and timeouts | 2, 6, 7 |
| D18 flag, routes, no booking, mock answers | 3, 9, 17 |
| D19 dialogs, names, focus, the inert page, the 900 px sheets, 44 px | 11–14, 16, 17 |
| D20 levels (S; the Marketplace hint A) | 11, 12, 17 |
| U2 Remove and Try again while round 1 waits follow A8's busy rule | 8 |
| Q1–Q3 the hidden R-po hint, the unticked checkbox's name, Build's line | 12, 15, 18 |
| §3 data; §4 the contract, the comments file, the mock answers; §5 the Jira connector; §6 API | 1, 7; 2–5; 4, 5; 6, 8, 9 |
| §7 boards 32–36 and "Not on the boards" | 11–17 |
| §9 testing; §10 where A6.1 meets A6, A8 and A3; §11 out of scope | 1–18; 7, 8, 10, 18; not built |
