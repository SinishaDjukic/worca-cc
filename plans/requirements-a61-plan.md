# A6.1 Start from a Ticket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A product owner starts a feature from a ticket the team already wrote: **New feature › From a ticket…** finds the ticket in a connected tracker, shows exactly what will be taken (title, description, acceptance criteria, comments, attachments, each with a checkbox), and **Use this ticket** fills the form. **Start the interview** creates the feature at once with the ticked criteria as the product owner's own `R-po-<n>` (marked "from SHOP-124"), the picked comments as one file Worca reads, the picked attachments downloaded server-side and read like A8 files, and the feature linked to its ticket, so Export updates it and a run reports back to it. No model call for the import, nothing written to the tracker; behind the `requirements` flag.

**Architecture:** The Requirements code knows only "a task source that can import": four optional connector ops (`importOptions`, `searchTickets`, `importTicket`, `downloadAttachment`) plus `capabilities().import`, called server-side through the existing `callSource` (plugin API stays 5). A pure module `src/core/requirements/ticket-import.mjs` turns a tracker's answer into what the preview shows and the create stores (criteria section, clip, redaction, the comments file, the reasons, the default ticks). `src/core/requirements/import.mjs` is the service (sources, defaults, options, search, preview, the second read and the create); `src/core/requirements/attachment-fetch.mjs` downloads a picked attachment into a fresh private folder, checks it, writes the checked bytes into A8's store and hands it to A8's read queue. Storage is two columns (schema v80): `req_export_links.origin` and `req_attachments.fetch_json`. Jira's part lives only in `plugins/jira-source/connector/` (REST v2, Cloud and Data Center). The page module `ui/public/requirements-view.mjs` gains the button, two dialogs, the filled form, the Files card's download states and the imported link's export copy; CSS goes into the Requirements block of `ui/public/style.css`.

**Tech Stack:** Node ESM, `node:sqlite`, `node:test`, jsdom, Express (`ui/server.mjs` → `src/core/requirements/routes.mjs`), the plugin shim (`src/core/plugin-shim.mjs`, one child per op, `WORCA_MOCK=1` canned answers), vanilla DOM (`ui/public/*.mjs`), `node:http` fake Jira servers for the connector, headless Chrome over CDP for the browser proof.

**Spec:** `plans/requirements-a61-design.md` (decisions D1–D20 and §3–§11; it wins where this plan is unclear, except where Global Constraints say otherwise). A6: `plans/requirements-a6-design.md`; A8: `plans/requirements-a8-design.md`; A1: `plans/requirements-design.md`.

**Visual reference (UI tasks):** design round 6 of the Claude Design canvas "Requirements — design rounds 1 to 6": board 32 **New feature from a ticket** (`ImportNew.dc.html`), board 33 **Pick a ticket** (`ImportPick.dc.html`), board 34 **Import preview** (`ImportPreview.dc.html`), board 35 **Feature from a ticket** (`ImportFeature.dc.html`, with the export dialog), board 36 **Import states and phone** (`ImportStates.dc.html`). The controller hands the folder holding them to each UI task's dispatch. The boards use upstream's classes (`card`, `btn` (the boards' `btn-mini` is `btn-sm`), `btn-primary`, `badge`, `chip`, `hint`, `select-wrap`, `field`); inline styles are layout hints. Where the design doc deviates from a board the doc wins; what no board shows is listed in design §7 "Not on the boards": build exactly that. The boards' people (two names on board 34) are replaced by "Ann Example", "Bo Example" and "Cy Example" everywhere in code, tests and fixtures.

## Global Constraints

- Work only in this worktree, on branch `feat/req-a61-jira-import` (stacked on `feat/req-a6-jira-export`). Its git identity is already set: never change git config. Commits only in this worktree; never push; no rebase, no amend; a merge is a merge commit (`git merge --no-ff`). Never touch the A6 worktree.
- One commit per task (the last task may add fix commits); subjects start `Requirements:`; every message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (`git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`).
- Never `rm -rf` (or `Remove-Item -Recurse -Force`) anything. Temporary folders the tests make are removed by the tests themselves (`useTempHome`, `rm(…, { recursive: true, force: true })` inside a test); a folder you made by hand stays.
- **No paid calls, no real Jira.** Nothing in this plan calls a model for real. Every tracker call in a test goes to the mock shim (`WORCA_MOCK=1`, `setMockSourceResponses`), an injected `callSource`, or the fake Jira HTTP servers of `test/helpers/fake-jira.mjs` on `127.0.0.1` (Cloud and Data Center, plus a "media" server for Cloud's signed attachment address). The mock shim answers every new op, so the browser proof runs offline. A check against a real Jira happens only after the last task, by hand, with the user's OK, on a test project they name; the last task stops before it.
- **Tests run one file at a time:** `node tools/test.mjs test/<file>.test.mjs` from the worktree root (it gives a hermetic HOME and the guard that stops a real `claude` from starting). Never plain `node --test`. The full suite runs only in the last task, with the same per-file runner, compared test name by test name with the baseline. This repo is developed on Windows, where about 170–200 upstream tests fail on clean `dev`: a failing test is called pre-existing only after the same file was run in the baseline worktree (a detached checkout of this branch's base; its path is given in your task dispatch), written `<baseline>` below — `cd <baseline> && node tools/test.mjs test/<file>.test.mjs` — and the failing test names match.
- No local machine paths anywhere in shipped files, tests, docs, this plan or commit messages (no drive letters, no user folders). Paths in commands are relative to the worktree root. No import from Shaper code; core modules never import `ui/server.mjs`.
- The `requirements` flag gates everything (D18): every new route is in `REQUIREMENTS_ROUTES` behind `requireFlag('requirements')` (the flag-off walk in `test/requirements-api.test.mjs` covers it); changes reach the page only through `requirementsChangeNotifier`'s `requirements-changed` frame; the import books nothing (the files' reads cost and book as A8 reads).
- Schema **v80** (`SCHEMA_VERSION` 79 → 80): `req_export_links.origin TEXT NOT NULL DEFAULT 'export'` and `req_attachments.fetch_json TEXT`, both in `INCREMENTAL_COLUMNS`; the rung `if (current < 80) repairSchemaGaps(db, schemaGaps(db));` right after the v79 rung. No new table. The last task renumbers if the base has taken 80.
- The plugin contract (D2): the four ops are optional and additive; `WORCA_PLUGIN_API` stays 5, `WORCA_PLUGIN_APIS` unchanged, jira-source keeps `"worca-cc-api": ">=5 <6"`. A source can import only when `capabilities()` answers `import: true`; the probe is A6's (one call per plugin, source id and installed version answers both `export` and `import`). None of the four is added to `POST /api/sources/call`'s allowlist.
- Safety (D15): every tracker call is `callSource` from `import.mjs` or `attachment-fetch.mjs` (server-side), with the connection's profile; no response carries a config value. Ticket text is data: the description in `<description>`, the criteria in `<current_spec>`, the comments in `<attachments>`, the import line in `<thread>`, all through the prompts' existing `asData`; the page renders ticket text with `textContent` only, never `innerHTML`. The description, criteria and comment bodies are redacted with `redactAskText` at the import (before the preview and before storage); downloaded attachments are stored as given and redacted on the way to the model (A8). A download writes only to `dest`, the fixed name `body.part` inside a fresh 0700 folder `<worcaHome>/tmp/requirements/att-get-<8 hex>/`; the host trusts nothing there until its checks pass (inside the folder, `lstat` a regular file and no link, size equal to the answer's `bytes` and at most 25 MB, A8's type, sniff and text rules, A8's duplicate rule). People are display names only.
- Timeouts (D17): `IMPORT_TIMEOUT_MS = 60_000` for `importOptions`, `searchTickets`, `importTicket`; `DOWNLOAD_TIMEOUT_MS = 120_000` per `downloadAttachment`; `MAX_DOWNLOAD_JOBS = 2` across all features, separate from A8's `MAX_READ_JOBS` and A1's `MAX_JOBS`; a create waiting for its files' downloads and reads does not hold a `MAX_JOBS` slot (A8-D2); round 1 waits at most `ROUND1_WAIT_MS` (6 minutes) for downloads and reads together.
- **Product copy never shows raw plugin or error text.** The server log gets only the first line of a failure's raw message, at most 200 characters (`firstLine(err)`, exported from `export.mjs` in Task 3, as A6's `trackerCall` logs it: "never a plugin's whole stdout/stderr"), with the op's name. Import (search, preview, create) uses A6's own wording, unchanged (design U1): "Worca could not reach Jira: <reason>." built by `export.mjs`'s `reachSentence(name, err)` / `reachReason(err, name)` — `auth` "the API token was refused", `timeout` "it did not answer within a minute", `protocol` "the Jira plugin gave an answer Worca could not read", a `network` / `rate-limit` / `plugin` message that is product copy (one line, at most 300 characters, no stack frame, path or JS error: the connector's own sentences such as "Jira refused the request: …") that message without its final period, anything else "the Jira plugin stopped unexpectedly". No import phrase table of its own. Download (per file, design D16 adjusted for the build): "Worca could not get this file from Jira: <reason>." with "it did not answer within 2 minutes" (`timeout`), "the API token was refused" (`auth`), "the network connection failed" (`network`), "it asked Worca to slow down" (`rate-limit`), "this connection may not see it" (403), "it is no longer on SHOP-124" (gone), "Jira did not send it" (nothing usable at `dest`), "Worca could not store it" (the host's own folder, write or queue failed), else "it answered with an error" — never the plugin's text. `Jira` is always the source's `displayName`; the Requirements code never names Jira.
- **No real person's names** in fixtures, mocks, tests or screenshots: authors are "Ann Example", "Bo Example", "Cy Example", and the app author "Jira Automation". The fake secret in a comment is `ghp_abcdefghijklmnopqrstuvwxyz0123456789` (the repo's existing test token).
- `ui/public/style.css`: tokens only (no hex, no `rgba(`); font sizes from the type scale (`var(--fs-caption)` 11, `var(--fs-meta)` 12, `var(--fs-body)` 13, 15px for a section heading, 18px for a dialog title — never 11.5, 12.5 or 14px); radii `var(--r-xs|sm|md)` or 0, never 12px or 999px; never `min-height:44px` on `.btn` (44 is off the control scale) — a phone tap area is an absolutely placed `::after` hit area, as A6's `.req-export .req-dlg-btns .btn::after`; shared icons (`icon(ICONS.remove)`, `icon(ICONS.file)`, `icon(ICONS.image)`, `icon(ICONS.info)`, `sharedIcon(document, 'external', 12)`, `sharedIcon(document, 'search', 14)`), never a text glyph such as ×, ✓ or ↗; a picked row or a checkbox is never green-filled (a picked ticket row has an ink border, as A6's `.req-export-mode:has(input:checked)`). Every new rule is a `req-import-*` rule (or extends an existing `req-file*` / `req-history*` rule) inside the Requirements block, which ends right before `/* ── marketplace P3 ── */`. `style.css` and `requirements-view.mjs` are checked out with CRLF line endings on Windows (`git ls-files --eol` shows `w/crlf`): keep them; after an edit `git diff --stat` shows only the lines you changed, never the whole file.
- Dialogs (D19): `role="dialog"` `aria-modal="true"`, labelled by their `h2` (`tabindex="-1"`), opened through the page's `openModal(card, { trigger, first: title, page: true })`, so the focus moves to the title the moment the dialog opens and every other child of `<body>` is inert at every width; the inert page is released on every close path (Cancel, Escape, Back, Use this ticket, a failure that closes) and on the view's `leave()` (already wired to `releaseExport()`); the focus returns to **From a ticket…** on close. Every async answer checks the dialog's generation (`live(g)`, A6's `dlgGen`) and, for a search, its own request number (`st.seq`): an answer for a closed dialog or a superseded search is dropped. No double posts: a button whose request is in flight ignores presses (a `busy` flag set before the first await). Live regions (`role="status"`, `role="alert"`) are persistent nodes whose text changes; they are never rebuilt by an unrelated repaint.
- Phone (D19): at 900 px and narrower both dialogs are full-screen sheets: `.req-dlg-wrap.req-dlg-sheet .card.req-dialog.req-export` (A6's rule: `position:fixed; inset:0`, the viewport's size, never the content's, scrolling inside), so each import dialog carries the classes `req-dialog req-export req-import`; **← New feature** (`aria-label="Back to New feature"`) first; sections stacked; every row and button reaching 44 px through `::after`; buttons full width. The sheet fits a 390 × 844 viewport with its buttons visible.
- Task sizing: every task brief stays under about 450 lines (tests, code and steps together); a task that grows past that is split before it starts (A6's Task 10 stalled twice when it was too big, which is why the review split this plan's downloads and its two dialogs into two tasks each).
- User-facing copy, verbatim (design §2, §7, boards 32–36; `Jira` is the tracker's `displayName`, `SHOP` the tracker project, `SHOP-124` the ticket, `FEAT-8` the new feature, `FEAT-7` another feature, server-local dates as `27 Oct`):
  - New feature (board 32): button "From a ticket…" (`aria-haspopup="dialog"`) at the right of the Describe it label · strip "Starting from" · chip "SHOP-124" with the external icon, named "SHOP-124, opens the ticket in Jira in a new tab" · " · Story · In progress" · "Change ticket…" · × named "Stop using SHOP-124" · "acme.atlassian.net (Cloud) · The new feature stays linked to SHOP-124: Export updates it, and a run can report back to it." (D12, a ticket another feature follows: "acme.atlassian.net (Cloud) · SHOP-123 follows FEAT-7, so the new feature stays unlinked.") · Describe it hint "From SHOP-124's description. Change it as you like: the interview starts from what is here." · empty description hint "SHOP-124 has no description. Describe it in a few sentences." · long description "SHOP-124's description is longer than 20,000 characters. The form keeps the start; the whole text goes along as SHOP-124 description.md." · field "Acceptance criteria" "from SHOP-124" · "They start the spec as your criteria. Edit or remove them on the feature page." · a ticket file chip: name, "Text · 3 KB", chip "SHOP-124", × "Remove <name>" · "Worca gets the SHOP-124 files from Jira when you start the interview." · Replace prompt "Replace the title and description with SHOP-131's?" "Replace" "Keep mine" · create failure (board 36, 8): the server's sentence, then "Nothing was created, and the form keeps what you entered. Try again, or stop using SHOP-124 to start without it."
  - Pick (board 33): "Start from a ticket" · "Pick the ticket this feature starts from. Worca reads it through your Jira connection and changes nothing in Jira." · "Connection" (only with several; option "<profile label>", led by "Jira · " when several trackers can import) · "Jira project" (first option "All projects", then "SHOP — Shop web") · "Find a ticket" · placeholder "Search by key or words" · "Paste a ticket's key or link to find it in any project." · status "Searching SHOP…" / "Searching all projects…" (blue badge) · "Recently updated in SHOP" / "Recently updated" · "4 tickets in SHOP match “cancel”." / "1 ticket in SHOP matches “cancel”." / "4 tickets match “cancel”." · a row: "SHOP-124" "Partial cancel for multi-item orders" "Story · In progress · updated 25 Oct", neutral chip "Linked to FEAT-7" · radio group "Tickets" · "Show more" · "Cancel" · "Continue" · board 36: "No ticket in SHOP matches “partial refund”." / "No ticket matches “partial refund”." with "Try other words, or paste the ticket's key or link." · "SHOP-999 was not found in Jira, or this connection cannot see it." · a failure: the server's sentence, "Nothing was changed." and, at the Advanced level only, " Fix the connection on the Marketplace page (Installed › Jira), then try again." · "Try again".
  - Preview (board 34): "Start from SHOP-124" · "This is what the new feature takes from SHOP-124. Untick what it should not start with. Nothing changes in Jira." · meta "Story · In progress · Medium · acme.atlassian.net (Cloud)" · "Title" · "Description" (region "Description preview") · "Without its Acceptance criteria section, which becomes the criteria below." · "SHOP-124 has no description." · "Worca hid 1 thing that looked like a key or password." / "Worca hid 3 things that looked like keys or passwords." · "Acceptance criteria · 3" / "Acceptance criteria · none" · "found under “Acceptance criteria” in the description" / "found in the Jira field “Acceptance Criteria”" · "Ticked criteria start the spec as R-po-1 to R-po-3, kept as your own edits and marked “from SHOP-124”. Unticked ones are left out; they stay in Jira." (one ticked: "Ticked criteria start the spec as R-po-1, …") · "None found in SHOP-124. Round 1 asks for them." · checkbox names "Use R-po-1: <text>" · "Comments · 5 of 6" / "Comments · none" · "Context for the interview, not spec text. Worca puts the picked ones in one file, SHOP-124 comments.md, and reads it like your other files. Authors are shown by name only." · "Use the comment by Ann Example, 21 Oct" · "1 comment visible only to a Jira group or role is left out." / "2 comments visible only to a Jira group or role are left out." · "and 3 older comments" / "and 1 older comment" · phone "Show all 6 comments" · "Attachments · 3 of 5" / "Attachments · none" · "Picked files become feature files. Worca gets them from Jira when you start the interview and reads each once, like a file you add." · "Add packing-slip.png as a feature file" · "Image · 840 KB" · refused: "Not offered: Worca reads text, images and PDF. Save it as PDF to attach it here." / "Not offered: Worca reads text, images and PDF." / "Not offered: it is over 25 MB." · caps: "A feature takes up to 10 files; 10 are picked." / "Picked files are at 100 MB, a new feature's limit. Add more on the feature page." · D12 (role=alert, amber): "SHOP-123 is linked to FEAT-7 · Cancel an order before it ships. The new feature can start from it but stays unlinked: one ticket follows one feature." · footer "Nothing is sent to Jira." · "Back" · "Use this ticket" · phone "← New feature" named "Back to New feature".
  - Feature page (board 35): working line "Getting 3 files from SHOP-124…" (blue badge, `role="status"`) with "Worca gets the files from Jira and reads them first, then shows round 1."; then A8's "Reading 4 files…" · Files card meta "Text · 3 KB · from SHOP-124" (and " · read for $0.02") · badge "Downloading…" (blue) with "Worca is getting it from SHOP-124. Then it reads it (about $0.10)." (no estimate: "Worca is getting it from SHOP-124. Then it reads it.") · a downloaded file being read: "Downloaded from SHOP-124. Worca is reading it (about $0.06). The next round uses it." · board 36: "Worca could not get this file from Jira: it did not answer within 2 minutes. The interview lists it by name only." with "Try again" · "Worca restarted before it got this file from Jira." with "Try again" · "Worca could not use this file: it is already attached as call-notes.pdf." with no Try again · the page's line after a create: "packing-slip.png was not added: it is no longer on SHOP-124." / "The comment by Ann Example (21 Oct) was not added: it is no longer on SHOP-124." / "refund-matrix.xlsx was not added: Worca reads text, images and PDF. Save it as PDF to attach it here." (an Office file; any other type ends at "… images and PDF.") · the criterion tag "SHOP-124" linking to the ticket, named "SHOP-124, opens the ticket in Jira in a new tab" · History "Imported SHOP-124 from Jira · 27 Oct, 09:12" and the name; unlinked: "Started from SHOP-123 in Jira, not linked: FEAT-7 is. · 27 Oct, 09:12".
  - Export with an imported link (board 35, D11): before the first export "Export FEAT-8 to Jira" · "FEAT-8 started from SHOP-124 on 27 Oct. The spec has changed since. What should happen?" (nothing changed: "FEAT-8 started from SHOP-124 on 27 Oct. The spec has not changed since the import.") · Update hint "Rewrites its summary, description and fields. Its description was written in Jira; Jira keeps the old text in the ticket's history." · comment hint "Lists what changed since the import. The description stays." · "What changed since the import (27 Oct)" · the comment's first line "Updated in Worca since the import (27 Oct)"; after the first export A6's "Export FEAT-8 again" with "SHOP-124 was imported on 27 Oct. The spec has changed since. What should happen?" (nothing changed: "SHOP-124 was imported on 27 Oct. The spec has not changed since the last export (28 Oct).").
  - Server refusals (this plan adds where the design names none): "Choose a connection from the list." · "key must be a ticket key such as SHOP-124" · "fromTicket must be an object" · "Jira cannot import any more." · "Worca is still getting this file from Jira." · "Worca cannot use this file. Remove it from the ⋯ menu." · the A8 caps on a create: "<name> was not added: a feature takes up to 10 files." / "<name> was not added: a new feature's files can be up to 100 MB in all; add more on the feature page." · the refused tails after "Worca could not use this file: ": "it is over 25 MB", "it is not the file Jira described", "its content does not match its type", "Worca reads text, images and PDF", "it is already attached as <name>".
  - Thread line (D14, sent to the model as data): "The product owner started this feature from Jira ticket SHOP-124. Its acceptance criteria are R-po-1 to R-po-3; its comments are in “SHOP-124 comments.md”." · one criterion: "Its acceptance criterion is R-po-1" · none: "It had no acceptance criteria" · without a comments file the part from ";" is left out.

## Review Focus

0. **No tracker call from the browser, no secret out, nothing written to the tracker.** Every op goes through `import.mjs` or `attachment-fetch.mjs` → `callSource`; `/api/sources/call`'s allowlist is unchanged; the import calls no write op (Tasks 3, 6, 7, 9).
1. **The downloaded file is trusted only after the host's checks.** Fresh 0700 folder, fixed `body.part`, `lstat` regular file, size equal to the answer and at most 25 MB, A8's type, sniff, UTF-8 and duplicate rules; the folder removed on every path; a removed file's late download thrown away; the bytes stored are the bytes checked (Tasks 5, 7).
2. **Ticket text is data.** Redacted at the import, escaped by the prompts' `asData`, rendered with `textContent`; the import line is the only new thread line and every other feature's prompts stay byte-identical (Tasks 2, 10, 12).
3. **The create answers at once.** No download is awaited before the 201; round 1 waits for downloads and reads up to `ROUND1_WAIT_MS` without holding a `MAX_JOBS` slot; a failed download marks only its file, and every failure marks it (Tasks 7, 8, 9).
4. **One ticket follows one feature; an imported link behaves as A6's.** D12's unlinked create; Update keeps the ticket's issue type and priority; the comment is "since the import" until the first export; the edited check compares with the import's fingerprint (Tasks 9, 10, 16).
5. **Accessibility and phone.** Dialog roles and names, focus on the title and back to From a ticket…, the page inert while open and released on leave, the radio group, named checkboxes with their reasons, persistent live regions, the 390 px sheet (Tasks 11–17).

## File Structure

| File | Create / Modify | Responsibility |
|---|---|---|
| `src/core/db.mjs` | Modify (Task 1) | v80: two `INCREMENTAL_COLUMNS`, the rung |
| `src/core/requirements/store.mjs` | Modify (Task 1) | `createFeature`'s `criteria`; `saveExportLink`'s `origin`, `toLink`; `linkByTicket`; the `downloading` status, `fetch` on a row, `listDownloadingAttachments` |
| `src/core/requirements/ticket-import.mjs` | Create (Task 2) | pure: `IMPORT_LIMITS`, `splitCriteria`, `clipDescription`, `redactCounted`, `commentsFileName`, `descriptionFileName`, `commentsMarkdown`, `importReason`, `importThreadLine`, `processTicket`, `pickDefaults`, `CAP_FILES`, `CAP_BYTES` |
| `src/core/requirements/export.mjs` | Modify (Tasks 3, 10) | the probe keeps `export` and `import` (`trackersWith`), `connectionLabel`, `sameConn` and `firstLine` exported; the imported link in `planExport`, `linkDates`, `exportView` |
| `src/core/plugin-shim.mjs` | Modify (Task 3) | `MOCK_DEFAULTS`: `capabilities` with `import: true` and the four import ops |
| `src/core/plugin-api.mjs` | Modify (Task 3) | the comment line on the optional import ops |
| `.claude/skills/creating-worca-cc-plugins/SKILL.md` | Modify (Task 3) | the contract table's four rows and a paragraph |
| `plugins/jira-source/connector/index.mjs` | Modify (Tasks 4, 5) | `capabilities().import`, `importOptions`, `searchTickets`, `importTicket`, `downloadAttachment` |
| `plugins/jira-source/connector/markup.mjs` | Modify (Task 4) | `htmlToMarkdown`: images, table rows, profile links; `plainWiki` (the raw wiki fallback) |
| `plugins/jira-source/connector/jira-api.mjs` | Modify (Task 5) | `jiraDownload` |
| `plugins/jira-source/README.md` | Modify (Task 5) | an Import section |
| `src/core/requirements/import.mjs` | Create (Task 6), grows in Task 9 | `IMPORT_TIMEOUT_MS`, `importSources`, `importDefaults`, `importView`, `importOptions`, `searchTickets`, `previewImport`; then `prepareImport`, `createImported` |
| `src/core/requirements/attachment-fetch.mjs` | Create (Task 7) | `DOWNLOAD_TIMEOUT_MS`, `MAX_DOWNLOAD_JOBS`, `insertDownloadRow`, `queueDownloads`, `isDownloading`, `downloadsPending`, `cancelDownload`, `redownload`, `makeFetchFolder`, `checkFetched`, `recoverDownloads` |
| `src/core/requirements/attachment-job.mjs` | Modify (Tasks 7, 8) | `readsSettled` waits for downloads; `enqueueRead`, `settleOwner` (Task 7); `addAttachments`' `from`; Try again, Remove, the edits on a downloading file; boot recovery; the `att-get-*` sweep |
| `src/core/requirements/attachments.mjs` | Modify (Task 8) | the prompt's "being downloaded from <key>"; `fileOrigins` |
| `src/core/requirements/interview.mjs` | Modify (Task 8) | round 1 also waits when a file is downloading |
| `src/core/requirements/ready.mjs` | Modify (Task 8) | a file still downloading counts as one still being read (to ask about; the reading hint) |
| `src/core/requirements/routes.mjs` | Modify (Tasks 8, 9) | `fileView`'s `from`; the four import routes; `POST /api/requirements` with `fromTicket` |
| `src/core/requirements/ticket.mjs`, `markdown.mjs`, `round.mjs` | Modify (Task 10) | the ticket's own key left out of a criterion's source; "since the import"; the import thread line |
| `ui/public/requirements-view.mjs` | Modify (Tasks 11–16) | the button, the pick and preview dialogs, the filled form, the Files card's download states, the working line, the criterion tag, History, the imported link's export copy |
| `ui/public/style.css` | Modify (Tasks 11–15) | `req-import-*` rules inside the Requirements block |
| `tools/verify-requirements-cdp.mjs` | Modify (Task 17) | the A6.1 section (light, dark, 390 px), runnable alone with `--only=a61` |
| `docs/requirements.md`, `docs/storage.md`, `docs/ui-levels.md`, `docs/changelog/unreleased.md` | Modify (Task 17) | Start from a ticket, the two columns and `att-get-*`, the levels, the changelog |
| Tests (Create) | | `test/db-migrate-v80.test.mjs`, `test/requirements-import-store.test.mjs`, `test/requirements-ticket-import.test.mjs`, `test/jira-source-import.test.mjs`, `test/jira-source-download.test.mjs`, `test/requirements-import.test.mjs`, `test/requirements-attachment-fetch.test.mjs`, `test/requirements-import-api.test.mjs`, `test/requirements-view-import.test.mjs`, `test/requirements-view-imported.test.mjs` |
| Tests (Modify) | | `test/db-migrate-v79.test.mjs`, `test/db-migrate-v77.test.mjs` (the new columns), `test/plugin-shim.test.mjs`, `test/requirements-export-trackers.test.mjs`, `test/jira-source-export.test.mjs` (capabilities), `test/helpers/fake-jira.mjs` (seeded issues, attachments, the media server), `test/requirements-export.test.mjs`, `test/requirements-ticket.test.mjs`, `test/requirements-round.test.mjs` (Task 10), `test/requirements-ready.test.mjs` (Task 8) |

The spec puts the Jira tests in `test/jira-source-connector.test.mjs` (its fake `fetch`); this plan follows A6 instead and tests the new ops over real HTTP against `test/helpers/fake-jira.mjs` in two new files, so Cloud's redirect and the stream cap are real.

---

### Task 1: Schema v80 and the store

**Files:**
- Modify: `src/core/db.mjs` (`SCHEMA_VERSION` 79 → 80 at line ~66; two entries in `INCREMENTAL_COLUMNS` at line ~838; the rung after `if (current < 79) db.exec(REQUIREMENTS_EXPORT_DDL);` at line ~2622)
- Modify: `src/core/requirements/store.mjs` (`createFeature` at line ~40; the attachments section at line ~318; the export section at line ~497)
- Modify: `test/db-migrate-v79.test.mjs` (`LINK_COLS`), `test/db-migrate-v77.test.mjs` (`COLS`)
- Create: `test/db-migrate-v80.test.mjs`, `test/requirements-import-store.test.mjs`

**Interfaces:**
- Consumes: `getDb`, `prepare`, `repairSchemaGaps`, `schemaGaps` (`db.mjs`); `clip`, `LIMITS`, `featureId` (`spec.mjs`).
- Produces (`store.mjs`):
  - `createFeature({ scopeType, scopeKey, title, description, criteria = [] }, { by }) → Feature` — `criteria: [{ text, source? }]` become `{ id: 'R-po-<n>', text, edited: true, source }` (empties and case-insensitive repeats left out, at most `LIMITS.items`, each clipped to `LIMITS.item`); `criteriaSeq` is their count.
  - `saveExportLink(seq, { …A6's fields, origin = 'export' }, { by }) → Link`; `Link.origin: 'export' | 'import'` (anything else is stored as `'export'`).
  - `linkByTicket({ plugin, sourceId, profile = null, key }) → { seq, id, title } | null` (archived features included; the key compared without case).
  - `insertAttachment({ …A8's fields, status, fetch = null })` accepts `status: 'downloading'`; `Attachment.fetch: { plugin, sourceId, profile, tracker, key, id, name, bytes } | null`; `updateAttachment` accepts `status: 'downloading'`; `listDownloadingAttachments() → Attachment[]` (rowid order).

- [ ] **Step 1: Write the failing migration test** `test/db-migrate-v80.test.mjs`:

```js
// test/db-migrate-v80.test.mjs — req_export_links.origin and req_attachments.fetch_json (plans/requirements-a61-design.md §3, D13):
// a fresh DB, one at 79 (A6), 78 (A3 only), 77 (A8), and upstream's 76–74 and 71–70 reach 80 with both columns, 'export' and
// NULL on the rows already there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
/** Every table with its columns (sorted: a repaired column is appended, not in DDL order) and every index name. */
function shape(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const out = {};
  for (const { name } of tables) out[name] = cols(db, name).sort();
  out['#indexes'] = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  return out;
}
const FRESH = (() => { const db = new DatabaseSync(':memory:'); migrate(db); return shape(db); })();
function assertComplete(db) {
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'req_export_links').includes('origin'), 'req_export_links.origin');
  assert.ok(cols(db, 'req_attachments').includes('fetch_json'), 'req_attachments.fetch_json');
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
}
const A61 = 'ALTER TABLE req_export_links DROP COLUMN origin; ALTER TABLE req_attachments DROP COLUMN fetch_json;';
const A6 = 'DROP TABLE req_export_setups; DROP TABLE req_export_links;';
const A3 = 'DROP TABLE req_helper_messages; ALTER TABLE req_cost_ledger DROP COLUMN helper_message_id;';
const A8 = 'DROP TABLE req_attachments; ALTER TABLE req_cost_ledger DROP COLUMN attachment_id; ALTER TABLE req_starts DROP COLUMN files_json;';
const FETCH = 'ALTER TABLE req_attachments DROP COLUMN fetch_json;';
const UP76 = 'ALTER TABLE ask_threads DROP COLUMN group_id; DROP TABLE ask_chat_groups;';
const UP75 = 'ALTER TABLE ask_threads DROP COLUMN pinned_at; ALTER TABLE ask_threads DROP COLUMN archived_at;';
const fromStamp = (sql, stamp, seed = '') => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${sql} ${seed} PRAGMA user_version = ${stamp}`);
  migrate(db);
  return db;
};

test('a fresh DB has both columns', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 80);
  assertComplete(db);
});

test("a DB at 79 (A6) gets both columns; its link rows read 'export', its files NULL", () => {
  const seed = `INSERT INTO req_export_links (feature_seq, plugin, source_id, tracker_project, ticket_key, updated_at)
      VALUES (7, 'jira-source', 'jira', 'SHOP', 'SHOP-123', 't');
    INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status, created_at, updated_at)
      VALUES ('ratt_0123456789ab', 'feature', 7, 'a.md', 'text', 'text/markdown', 1, 'x', 'done', 't', 't');`;
  const db = fromStamp(A61, 79, seed);
  assertComplete(db);
  assert.equal(db.prepare('SELECT origin FROM req_export_links WHERE feature_seq = 7').get().origin, 'export');
  assert.equal(db.prepare("SELECT fetch_json FROM req_attachments WHERE id = 'ratt_0123456789ab'").get().fetch_json, null);
});

test('a DB at 78 (A3, no A6 tables) and at 77 (A8) reach the current version complete', () => {
  assertComplete(fromStamp(`${A6} ${FETCH}`, 78));
  assertComplete(fromStamp(`${A6} ${A3} ${FETCH}`, 77));
});

test("a DB at upstream's 76, 75 or 74 (no A8, A3, A6) reaches the current version complete", () => {
  assertComplete(fromStamp(`${A6} ${A3} ${A8}`, 76));
  assertComplete(fromStamp(`${A6} ${A3} ${A8} ${UP76}`, 75));
  assertComplete(fromStamp(`${A6} ${A3} ${A8} ${UP76} ${UP75}`, 74));
});

test('a DB from below 72 (upstream 70 or 71: no requirements tables) reaches the current version complete', () => {
  for (const [stamp, extra] of [[70, ' DROP TABLE utility_cost_ledger;'], [71, '']]) {
    assertComplete(fromStamp(`${A6} DROP TABLE req_helper_messages; DROP TABLE req_attachments; DROP TABLE req_briefs; DROP TABLE req_starts;
      DROP TABLE req_cost_ledger; DROP TABLE req_contexts; DROP TABLE req_turns; DROP TABLE req_features;${extra}`, stamp));
  }
});

test('a DB stamped past this version without the columns is repaired', () => {
  const db = fromStamp(A61, SCHEMA_VERSION + 1);
  assert.ok(cols(db, 'req_export_links').includes('origin'));
  assert.ok(cols(db, 'req_attachments').includes('fetch_json'));
});
```

- [ ] **Step 2: Write the failing store test** `test/requirements-import-store.test.mjs`:

```js
// test/requirements-import-store.test.mjs — A6.1's storage (plans/requirements-a61-design.md §3, D7, D10–D13): a feature created
// with criteria, the link's origin, the feature already linked to a ticket, a file row still to be downloaded.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { LIMITS } from '../src/core/requirements/spec.mjs';
import {
  createFeature, updateFeature, saveExportLink, getExportLink, linkByTicket, insertAttachment, getAttachment, updateAttachment,
  listDownloadingAttachments, mintAttachmentId,
} from '../src/core/requirements/store.mjs';

useTempHome(after, 'worca-req-import-store-');
const SCOPE = { scopeType: 'project', scopeKey: 'shop-1' };
const CONN = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const link = (seq, key, over = {}) => saveExportLink(seq, { ...CONN, trackerProject: 'SHOP', key, url: `https://acme.test/browse/${key}`,
  createdAt: '2026-10-27T09:12:00.000Z', exportedAt: '2026-10-27T09:12:00.000Z', ...over });

test('createFeature with criteria (D7): R-po-1… in order, edited, with their source; empties and repeats left out; criteria_seq is their count', () => {
  const f = createFeature({ ...SCOPE, title: 'Partial cancel', description: 'Some items only', criteria: [
    { text: ' A customer can cancel the items not picked up. ', source: 'SHOP-124' }, { text: '   ', source: 'SHOP-124' },
    { text: 'Shipped items stay on the order.', source: 'SHOP-124' }, { text: 'shipped items stay on the order.', source: 'SHOP-124' }] });
  assert.deepEqual(f.spec.criteria, [
    { id: 'R-po-1', text: 'A customer can cancel the items not picked up.', edited: true, source: 'SHOP-124' },
    { id: 'R-po-2', text: 'Shipped items stay on the order.', edited: true, source: 'SHOP-124' }]);
  assert.equal(f.criteriaSeq, 2);
  const plain = createFeature({ ...SCOPE, title: 'Plain', description: 'No ticket' });
  assert.deepEqual([plain.spec.criteria, plain.criteriaSeq], [[], 0]);
});

test('createFeature: at most 30 criteria, each at most 500 characters', () => {
  const many = Array.from({ length: 35 }, (_, i) => ({ text: `Criterion ${i + 1} ${'x'.repeat(600)}`, source: 'SHOP-9' }));
  const f = createFeature({ ...SCOPE, title: 'Many', description: 'Lots', criteria: many });
  assert.equal(f.spec.criteria.length, LIMITS.items);
  assert.ok(f.spec.criteria.every((c) => c.text.length <= LIMITS.item));
  assert.equal(f.criteriaSeq, LIMITS.items);
});

test("a link's origin (D11, D13): 'export' unless the save says 'import'; a save that passes the link on keeps it", () => {
  const f = createFeature({ ...SCOPE, title: 'Imported', description: 'From a ticket' });
  assert.equal(link(f.seq, 'SHOP-124', { origin: 'import' }).origin, 'import');
  const cur = getExportLink(f.seq);
  assert.equal(saveExportLink(f.seq, { ...cur, exportedAt: '2026-10-28T10:00:00.000Z' }).origin, 'import', 'runExport passes { ...link }');
  assert.equal(link(f.seq, 'SHOP-200').origin, 'export', 'a new ticket is an ordinary export link');
  const g = createFeature({ ...SCOPE, title: 'Exported', description: 'Plain' });
  assert.equal(link(g.seq, 'SHOP-300').origin, 'export');
  assert.equal(link(g.seq, 'SHOP-300', { origin: 'nonsense' }).origin, 'export');
});

test('linkByTicket (D12): the feature linked to that ticket on that connection, archived ones too; another profile or key is no match', () => {
  const f = createFeature({ ...SCOPE, title: 'Cancel an order before it ships', description: 'x' });
  link(f.seq, 'SHOP-123');
  updateFeature(f.seq, { status: 'archived' });
  const want = { seq: f.seq, id: f.id, title: 'Cancel an order before it ships' };
  assert.deepEqual(linkByTicket({ ...CONN, key: 'SHOP-123' }), want);
  assert.deepEqual(linkByTicket({ ...CONN, key: 'shop-123' }), want, 'keys compare without case');
  assert.equal(linkByTicket({ ...CONN, profile: 'beta', key: 'SHOP-123' }), null);
  assert.equal(linkByTicket({ ...CONN, key: 'SHOP-999' }), null);
  const g = createFeature({ ...SCOPE, title: 'Single profile', description: 'x' });
  saveExportLink(g.seq, { plugin: 'mock-source', sourceId: 'main', profile: null, trackerProject: 'M', key: 'M-1' });
  assert.equal(linkByTicket({ plugin: 'mock-source', sourceId: 'main', key: 'M-1' }).seq, g.seq, 'no profile matches no profile');
});

test('a file still to be downloaded (D10, D13): status downloading, where from in fetch, a pending hash; an uploaded file has none', () => {
  const f = createFeature({ ...SCOPE, title: 'Files', description: 'x' });
  const id = mintAttachmentId();
  const fetch = { ...CONN, tracker: 'Jira', key: 'SHOP-124', id: '10041', name: 'packing-slip.png', bytes: 860160 };
  const row = insertAttachment({ id, ownerType: 'feature', ownerId: f.seq, name: 'packing-slip.png', kind: 'image', mime: 'image/png', bytes: 860160,
    sha256: `pending:${id}`, status: 'downloading', fetch });
  assert.deepEqual([row.status, row.sha256, row.fetch], ['downloading', `pending:${id}`, fetch]);
  const id2 = mintAttachmentId();
  insertAttachment({ id: id2, ownerType: 'feature', ownerId: f.seq, name: 'flow.pdf', kind: 'binary', mime: 'application/pdf', bytes: 10,
    sha256: `pending:${id2}`, status: 'downloading', fetch: { ...fetch, id: '10042', name: 'flow.pdf' } });
  assert.deepEqual(listDownloadingAttachments().map((r) => r.id), [id, id2]);
  assert.equal(updateAttachment(id, { status: 'reading', sha256: 'a'.repeat(64) }).status, 'reading');
  assert.deepEqual(listDownloadingAttachments().map((r) => r.id), [id2]);
  assert.deepEqual(getAttachment(id).fetch, fetch, 'the row keeps where it came from');
  const up = mintAttachmentId();
  assert.equal(insertAttachment({ id: up, ownerType: 'feature', ownerId: f.seq, name: 'notes.md', kind: 'text', mime: 'text/markdown', bytes: 3,
    sha256: 'b'.repeat(64) }).fetch, null);
  assert.throws(() => insertAttachment({ id: mintAttachmentId(), ownerType: 'feature', ownerId: f.seq, name: 'x.md', kind: 'text', mime: 'text/plain',
    bytes: 1, sha256: 'c', status: 'fetching' }), /unknown status/);
});
```

- [ ] **Step 3: Run both to see them fail.**

Run: `node tools/test.mjs test/db-migrate-v80.test.mjs` → FAIL (`SCHEMA_VERSION >= 80` false; no `origin` column).
Run: `node tools/test.mjs test/requirements-import-store.test.mjs` → FAIL (`linkByTicket` is not exported).

- [ ] **Step 4: `db.mjs`.** Set `export const SCHEMA_VERSION = 80;`. In `INCREMENTAL_COLUMNS`, right after the `req_starts` line, add:

```js
  req_export_links:       { origin: "TEXT NOT NULL DEFAULT 'export'" },   // v80: where the link came from, 'export' | 'import' (A6.1 D11, D13)
  req_attachments:        { fetch_json: 'TEXT' },   // v80: a tracker file still to be downloaded (A6.1 D10, D13); NULL for an upload
```

After the line `if (current < 79) db.exec(REQUIREMENTS_EXPORT_DDL);` add:

```js
    // v80 requirements A6.1: req_export_links.origin + req_attachments.fetch_json (INCREMENTAL_COLUMNS). The repair runs here, after
    // the v77 and v79 rungs created those tables on a DB coming from below them.
    if (current < 80) repairSchemaGaps(db, schemaGaps(db));
```

- [ ] **Step 5: The two older migration tests name the new columns.** In `test/db-migrate-v79.test.mjs` the `LINK_COLS` list ends `'pending_marker', 'pending_at', 'updated_by', 'updated_at', 'origin'];` (a repaired column is appended). In `test/db-migrate-v77.test.mjs` the `COLS` list ends `'created_by', 'created_at', 'updated_by', 'updated_at', 'fetch_json'];`.

- [ ] **Step 6: `store.mjs`.** Add `clip` to the import from `./spec.mjs`. Replace `createFeature`:

```js
/** A1 §3; A6.1 D7: `criteria` ([{ text, source }]) start the spec as the product owner's own R-po-1… (edited, with their source). */
export function createFeature({ scopeType, scopeKey, title, description, criteria = [] } = {}, { by = null } = {}) {
  checkScope(scopeType, scopeKey);
  const t = requiredText(title, 'title', LIMITS.title, { oneLine: true });   // one line: the Markdown heading cannot break
  const d = requiredText(description, 'description', LIMITS.description);
  const spec = emptySpec();
  const seen = new Set();
  for (const c of Array.isArray(criteria) ? criteria : []) {
    if (spec.criteria.length >= LIMITS.items) break;
    const text = clip(c && c.text, LIMITS.item);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const source = clip(c && c.source, 100);
    spec.criteria.push({ id: `R-po-${spec.criteria.length + 1}`, text, edited: true, ...(source ? { source } : {}) });
  }
  getDb();
  const ts = iso();
  const r = prepare(`INSERT INTO req_features (scope_type, scope_key, title, description, status, spec_json, criteria_seq,
      created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, 'looking', ?, ?, ?, ?, ?, ?)`)
    .run(scopeType, scopeKey.trim(), t, d, JSON.stringify(spec), spec.criteria.length, by, ts, by, ts);
  return getFeature(Number(r.lastInsertRowid));
}
```

In the attachments section: `const ATT_STATUSES = Object.freeze(['downloading', 'reading', 'done', 'failed', 'unread-budget']);`; in `toAttachment` add `fetch: json(r.fetch_json, null),` after `sha256: r.sha256,`; replace `insertAttachment`:

```js
export function insertAttachment({ id, ownerType, ownerId, name, kind, mime, bytes, sha256, status = 'reading', fetch = null } = {}, { by = null } = {}) {
  if (typeof id !== 'string' || !REQ_ATT_ID_RE.test(id)) throw new Error('insertAttachment: refusing an id the store never minted');
  if (!OWNER_TYPES.includes(ownerType)) throw new Error(`insertAttachment: unknown owner type "${ownerType}"`);
  if (!ATT_STATUSES.includes(status)) throw new Error(`insertAttachment: unknown status "${status}"`);
  getDb();
  const ts = iso();
  prepare(`INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status, fetch_json, created_by, created_at,
      updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ownerType, Number(ownerId), name, kind, mime, Number(bytes), sha256, status, fetch ? JSON.stringify(fetch) : null, by, ts, by, ts);
  return getAttachment(id);
}
```

After `listReadingAttachments` add:

```js
/** A6.1 D10: the rows still waiting for their tracker download (a restart turns them failed, recoverDownloads). */
export function listDownloadingAttachments() {
  getDb();
  return prepare("SELECT * FROM req_attachments WHERE status = 'downloading' ORDER BY rowid").all().map(toAttachment);
}
```

In the export section: `toLink` gains `origin: r.origin === 'import' ? 'import' : 'export',` after `pendingAt`; replace `saveExportLink`:

```js
/** The feature's current ticket, whole (D7, D8, D9): written after a create, an update, a comment, a new ticket or a
 *  ticket found again; the pending marker goes. `origin` (A6.1 D11): 'import' for a link an import made; a save that passes
 *  the link on ({ ...link }) keeps it; anything else is 'export'. Keys this table has no column for are ignored. */
export function saveExportLink(seq, { plugin, sourceId, profile = null, trackerProject, key, url = null, createdAt = null, exportedAt = null, spec = null,
  fields = null, fingerprint = null, origin = 'export' } = {}, { by = null } = {}) {
  getDb();
  const ts = iso();
  prepare(`INSERT INTO req_export_links (feature_seq, plugin, source_id, profile, tracker_project, ticket_key, ticket_url, created_at, exported_at,
      spec_json, fields_json, fingerprint, origin, pending_marker, pending_at, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      ON CONFLICT (feature_seq) DO UPDATE SET plugin = excluded.plugin, source_id = excluded.source_id, profile = excluded.profile,
        tracker_project = excluded.tracker_project, ticket_key = excluded.ticket_key, ticket_url = excluded.ticket_url,
        created_at = excluded.created_at, exported_at = excluded.exported_at, spec_json = excluded.spec_json, fields_json = excluded.fields_json,
        fingerprint = excluded.fingerprint, origin = excluded.origin, pending_marker = NULL, pending_at = NULL, updated_by = excluded.updated_by,
        updated_at = excluded.updated_at`)
    .run(Number(seq), plugin, sourceId, profile || null, trackerProject, key, url || null, createdAt || null, exportedAt || null,
      spec ? JSON.stringify(spec) : null, fields ? JSON.stringify(fields) : null, fingerprint || null, origin === 'import' ? 'import' : 'export', by, ts);
  return getExportLink(seq);
}
```

At the end of the file add:

```js
/** A6.1 D12: the feature (archived ones too) already linked to this ticket on this connection, else null. */
export function linkByTicket({ plugin, sourceId, profile = null, key } = {}) {
  getDb();
  const r = prepare(`SELECT l.feature_seq, f.title FROM req_export_links l JOIN req_features f ON f.seq = l.feature_seq
      WHERE l.plugin = ? AND l.source_id = ? AND COALESCE(l.profile, '') = ? AND UPPER(l.ticket_key) = UPPER(?) ORDER BY l.feature_seq LIMIT 1`)
    .get(String(plugin || ''), String(sourceId || ''), profile || '', String(key || ''));
  return r ? { seq: Number(r.feature_seq), id: featureId(r.feature_seq), title: r.title } : null;
}
```

- [ ] **Step 7: Run the tests.**

Run, one at a time: `node tools/test.mjs test/db-migrate-v80.test.mjs`, `node tools/test.mjs test/requirements-import-store.test.mjs`, `node tools/test.mjs test/db-migrate-v79.test.mjs`, `node tools/test.mjs test/db-migrate-v77.test.mjs`, `node tools/test.mjs test/db-migrate-v78.test.mjs`, `node tools/test.mjs test/requirements-store.test.mjs`, `node tools/test.mjs test/requirements-export-store.test.mjs` → all PASS.

- [ ] **Step 8: Commit.**

```bash
git add src/core/db.mjs src/core/requirements/store.mjs test/db-migrate-v80.test.mjs test/requirements-import-store.test.mjs test/db-migrate-v79.test.mjs test/db-migrate-v77.test.mjs
git commit -m "Requirements: schema v80 and the store for starting from a ticket" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The ticket as the preview shows it and the create stores it (pure)

**Files:**
- Create: `src/core/requirements/ticket-import.mjs`
- Create: `test/requirements-ticket-import.test.mjs`

**Interfaces:**
- Consumes: `redactAskText` (`../ask/redact.mjs`); `classifyExtension` (`../ask/attachment-kind.mjs`); `LIMITS`, `clip` (`spec.mjs`); `REQ_ATTACH_LIMITS`, `OFFICE_EXTENSIONS`, `displayName` (`attachments.mjs`); `exportDate` (`ticket.mjs`).
- Produces:
  - `IMPORT_LIMITS = { comments: 50, commentChars: 4000, page: 20 }`
  - `splitCriteria(markdown) → { description: string, items: string[], heading: string | null }`
  - `clipDescription(text) → { text, clipped: boolean }`
  - `redactCounted(text) → { text, hidden: number }`
  - `commentsFileName(key) → '<key> comments.md'`; `descriptionFileName(key) → '<key> description.md'`
  - `commentsMarkdown(key, comments: [{ author, created, body }]) → string`
  - `importReason(name, cls, bytes) → string | null` (`cls` is `classifyExtension(ext)`)
  - `importThreadLine({ tracker, key, criteria: string[], comments: number }) → string`
  - `processTicket(raw, { tracker }) → Processed` where `Processed = { key, url, tracker, meta, title, description, descriptionFile: { name, text, bytes } | null, clipped, redacted, criteria: { from: 'field' | 'section' | null, name, field: { id, name } | null, items: string[] }, comments: [{ id, author, authorKind, created, when, body, bytes }], commentsTotal, restrictedComments, olderComments, attachments: [{ id, name, kind, mime, bytes, refused: string | null }], fingerprint }`
  - `CAP_FILES = 'A feature takes up to 10 files; 10 are picked.'`; `CAP_BYTES = "Picked files are at 100 MB, a new feature's limit. Add more on the feature page."`
  - `pickDefaults(processed, { count = 0, bytes = 0 } = {}) → Processed` with every criterion's `picked: true` (as `criteria.picked: boolean[]`), each comment's `picked` (`authorKind === 'person'`), each attachment's `picked` and `capped: 'files' | 'bytes' | null` (ticked in the ticket's order while the form's files, the comments file, the description file and the ticked attachments stay within 10 files and 100 MB).

- [ ] **Step 1: Write the failing test** `test/requirements-ticket-import.test.mjs`:

```js
// test/requirements-ticket-import.test.mjs — what Worca takes from a ticket (plans/requirements-a61-design.md D5–D9, D14, §4). Pure:
// no store, no tracker. Server-local dates: the fixtures use midday UTC so the day is the same in every zone the suite runs in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS } from '../src/core/requirements/spec.mjs';
import {
  IMPORT_LIMITS, splitCriteria, clipDescription, redactCounted, commentsFileName, descriptionFileName, commentsMarkdown, importReason,
  importThreadLine, processTicket, pickDefaults, CAP_FILES, CAP_BYTES,
} from '../src/core/requirements/ticket-import.mjs';
import { classifyExtension } from '../src/core/ask/attachment-kind.mjs';

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const MB = 1024 * 1024;

test('splitCriteria: a heading, a bold line or a line ending in ":" naming the criteria, then its list; the rest stays', () => {
  const md = 'Customers cannot cancel the rest.\n\n## Acceptance criteria\n\n- A customer can cancel unpicked items.\n- Shipped items stay.\n\n## Notes\n\nMore.';
  assert.deepEqual(splitCriteria(md), { description: 'Customers cannot cancel the rest.\n\n## Notes\n\nMore.',
    items: ['A customer can cancel unpicked items.', 'Shipped items stay.'], heading: 'Acceptance criteria' });
  assert.deepEqual(splitCriteria('Intro.\n**Acceptance Criteria**\n1. One\n2) Two\n\nAfter.').items, ['One', 'Two']);
  assert.deepEqual(splitCriteria('Intro.\n\nAC:\n* [ ] One\n* [x] Two').items, ['One', 'Two'], 'checkboxes and "AC:"');
  assert.deepEqual(splitCriteria('Intro.\n\nAcceptance criterion:\nThe refund covers the cancelled items.\nAnd their shipping share.\n\nTail.'),
    { description: 'Intro.\n\nTail.', items: ['The refund covers the cancelled items.', 'And their shipping share.'], heading: 'Acceptance criterion' },
    'without a list: the lines up to the next blank line');
  assert.deepEqual(splitCriteria('Intro.\n\n- a list item\n- not criteria').items, [], 'no heading, no section');
  assert.equal(splitCriteria('Note: these are acceptance criteria\n- x').heading, null, 'a line that only mentions them');
});

test('splitCriteria: two sections, the first wins; at most 30 items of at most 500 characters', () => {
  const md = '## Acceptance criteria\n- First\n\n## AC\n- Second';
  assert.deepEqual(splitCriteria(md), { description: '## AC\n- Second', items: ['First'], heading: 'Acceptance criteria' });
  const long = `## Acceptance criteria\n${Array.from({ length: 40 }, (_, i) => `- Item ${i} ${'y'.repeat(600)}`).join('\n')}`;
  const r = splitCriteria(long);
  assert.equal(r.items.length, LIMITS.items);
  assert.ok(r.items.every((x) => x.length <= LIMITS.item));
});

test('clipDescription: up to the last paragraph break before 20,000 characters', () => {
  const para = `${'a'.repeat(9000)}\n\n`;
  const text = `${para}${para}${'b'.repeat(5000)}`;
  const r = clipDescription(text);
  assert.equal(r.clipped, true);
  assert.equal(r.text, `${'a'.repeat(9000)}\n\n${'a'.repeat(9000)}`);
  assert.deepEqual(clipDescription('short'), { text: 'short', clipped: false });
  assert.equal(clipDescription('c'.repeat(25000)).text.length, LIMITS.description, 'no break at all: cut at the limit');
});

test('redactCounted: a GitHub token and a PEM block are hidden and counted', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----';
  const r = redactCounted(`token ${TOKEN} and\n${pem}`);
  assert.equal(r.hidden, 2);
  assert.ok(!r.text.includes(TOKEN) && !r.text.includes('MIIabc'));
  assert.deepEqual(redactCounted('nothing here'), { text: 'nothing here', hidden: 0 });
  assert.equal(redactCounted('already ghp_<redacted>').hidden, 0, 'a marker that was there is not counted');
});

test('commentsMarkdown: one file in the ticket order, author and date, the body as Markdown; the file names', () => {
  const md = commentsMarkdown('SHOP-124', [
    { author: 'Ann Example', created: '2026-10-21T12:00:00.000Z', body: 'Warehouse confirms items are picked per parcel.' },
    { author: 'Bo Example', created: '2026-10-22T12:00:00.000Z', body: 'Partial refunds work on cards.\n\n- PayPal too' },
  ]);
  assert.equal(md, '# Comments on SHOP-124\n\n**Ann Example** · 21 Oct 2026\nWarehouse confirms items are picked per parcel.\n\n'
    + '**Bo Example** · 22 Oct 2026\nPartial refunds work on cards.\n\n- PayPal too\n');
  assert.equal(commentsFileName('SHOP-124'), 'SHOP-124 comments.md');
  assert.equal(descriptionFileName('SHOP-124'), 'SHOP-124 description.md');
});

test("importReason (D9): Office, any other type and size, said for a file not added yet; a file A8 takes has none", () => {
  const r = (name, bytes = 10) => importReason(name, classifyExtension(name.slice(name.lastIndexOf('.'))), bytes);
  assert.equal(r('refund-matrix.xlsx'), 'Not offered: Worca reads text, images and PDF. Save it as PDF to attach it here.');
  assert.equal(r('clip.mov'), 'Not offered: Worca reads text, images and PDF.');
  assert.equal(r('scan.pdf', 31 * MB), 'Not offered: it is over 25 MB.');
  assert.equal(r('slip.png', 860160), null);
});

test('importThreadLine (D14): criteria and comments; no criteria; no comments file', () => {
  assert.equal(importThreadLine({ tracker: 'Jira', key: 'SHOP-124', criteria: ['R-po-1', 'R-po-2', 'R-po-3'], comments: 5 }),
    'The product owner started this feature from Jira ticket SHOP-124. Its acceptance criteria are R-po-1 to R-po-3; its comments are in “SHOP-124 comments.md”.');
  assert.equal(importThreadLine({ tracker: 'Jira', key: 'SHOP-131', criteria: [], comments: 2 }),
    'The product owner started this feature from Jira ticket SHOP-131. It had no acceptance criteria; its comments are in “SHOP-131 comments.md”.');
  assert.equal(importThreadLine({ tracker: 'Jira', key: 'SHOP-9', criteria: ['R-po-1'], comments: 0 }),
    'The product owner started this feature from Jira ticket SHOP-9. Its acceptance criterion is R-po-1.');
});

const RAW = () => ({
  key: 'SHOP-124', url: 'https://acme.test/browse/SHOP-124', title: '  Partial cancel\nfor multi-item orders ',
  description: `When an order has several items, customers cannot cancel the rest.\n\n(image: packing-slip.png)\n\n## Acceptance criteria\n\n- Unpicked items can be cancelled.\n- Shipped items stay.\n- The refund covers only the cancelled items, ${TOKEN}.`,
  criteria: null,
  comments: [
    { id: '1', author: 'Ann Example', authorKind: 'person', created: '2026-10-21T12:00:00.000Z', body: 'Picked per parcel.' },
    { id: '2', author: 'Jira Automation', authorKind: 'app', created: '2026-10-23T12:00:00.000Z', body: 'Status changed to In progress.' },
    { id: '3', author: 'Bo Example', authorKind: 'person', created: '2026-10-25T12:00:00.000Z', body: `Sandbox token ${TOKEN}` },
  ],
  commentsTotal: 7, restrictedComments: 1,
  attachments: [
    { id: '10041', name: 'packing-slip.png', mime: 'image/png', bytes: 860160 },
    { id: '10044', name: 'refund-matrix.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: 98304 },
    { id: '10045', name: 'dir/pick-route-scan.pdf', mime: 'application/pdf', bytes: 31 * MB },
  ],
  meta: { project: 'SHOP', projectName: 'Shop web', type: { id: '10001', name: 'Story' }, status: 'In progress', priority: { id: '3', name: 'Medium' } },
  fingerprint: 'fp-1',
});

test('processTicket: title on one line; the criteria section out of the description; redaction counted; comments and attachments as offered', () => {
  const p = processTicket(RAW(), { tracker: 'Jira' });
  assert.equal(p.title, 'Partial cancel for multi-item orders');
  assert.equal(p.description, 'When an order has several items, customers cannot cancel the rest.\n\n(image: packing-slip.png)');
  assert.deepEqual(p.criteria, { from: 'section', name: 'Acceptance criteria', field: null,
    items: ['Unpicked items can be cancelled.', 'Shipped items stay.', 'The refund covers only the cancelled items, ghp_<redacted>.'] });
  assert.equal(p.redacted, 2, 'one in a criterion, one in a comment');
  assert.deepEqual(p.comments.map((c) => [c.id, c.author, c.authorKind, c.when]),
    [['1', 'Ann Example', 'person', '21 Oct'], ['2', 'Jira Automation', 'app', '23 Oct'], ['3', 'Bo Example', 'person', '25 Oct']]);
  assert.equal(p.comments[2].body, 'Sandbox token ghp_<redacted>');
  assert.deepEqual([p.commentsTotal, p.restrictedComments, p.olderComments], [7, 1, 3]);
  assert.deepEqual(p.attachments.map((a) => [a.name, a.kind, a.refused]), [
    ['packing-slip.png', 'image', null],
    ['refund-matrix.xlsx', null, 'Not offered: Worca reads text, images and PDF. Save it as PDF to attach it here.'],
    ['pick-route-scan.pdf', 'binary', 'Not offered: it is over 25 MB.']]);
  assert.deepEqual([p.descriptionFile, p.clipped, p.fingerprint, p.meta.type.name], [null, false, 'fp-1', 'Story']);
});

test('processTicket: criteria from a field leave the description whole; a long description goes along as a file; comments clipped and capped', () => {
  const raw = { ...RAW(), criteria: { field: { id: 'customfield_10070', name: 'Acceptance Criteria' }, items: ['From the field.'] },
    description: `${'p'.repeat(15000)}\n\n${'q'.repeat(9000)}`,
    comments: Array.from({ length: 60 }, (_, i) => ({ id: String(i), author: 'Cy Example', authorKind: 'person', created: '2026-10-20T12:00:00.000Z',
      body: 'z'.repeat(5000) })) };
  const p = processTicket(raw, { tracker: 'Jira' });
  assert.deepEqual([p.criteria.from, p.criteria.name, p.criteria.field.id, p.criteria.items], ['field', 'Acceptance Criteria', 'customfield_10070', ['From the field.']]);
  assert.equal(p.clipped, true);
  assert.equal(p.description, 'p'.repeat(15000));
  assert.deepEqual([p.descriptionFile.name, p.descriptionFile.text.length], ['SHOP-124 description.md', 24002]);
  assert.equal(p.comments.length, IMPORT_LIMITS.comments, 'the newest 50');
  assert.equal(p.comments[0].id, '10', 'oldest first, the ten oldest left out');
  assert.ok(p.comments.every((c) => c.body.length === IMPORT_LIMITS.commentChars));
});

test('pickDefaults (D5, D9): every criterion, every comment by a person; attachments in order within 10 files and 100 MB, counting the form', () => {
  const p = pickDefaults(processTicket(RAW(), { tracker: 'Jira' }), { count: 0, bytes: 0 });
  assert.deepEqual(p.criteria.picked, [true, true, true]);
  assert.deepEqual(p.comments.map((c) => c.picked), [true, false, true]);
  assert.deepEqual(p.attachments.map((a) => [a.picked, a.capped]), [[true, null], [false, null], [false, null]], 'refused ones are never ticked');
  const full = pickDefaults(processTicket(RAW(), { tracker: 'Jira' }), { count: 9, bytes: 0 });
  assert.deepEqual([full.attachments[0].picked, full.attachments[0].capped], [false, 'files'], 'the comments file and nine on the form: no room');
  const heavy = pickDefaults(processTicket(RAW(), { tracker: 'Jira' }), { count: 1, bytes: 99.5 * MB });
  assert.deepEqual([heavy.attachments[0].picked, heavy.attachments[0].capped], [false, 'bytes']);
  assert.equal(CAP_FILES, 'A feature takes up to 10 files; 10 are picked.');
  assert.equal(CAP_BYTES, "Picked files are at 100 MB, a new feature's limit. Add more on the feature page.");
});
```

- [ ] **Step 2: Run it to see it fail.** `node tools/test.mjs test/requirements-ticket-import.test.mjs` → FAIL (`Cannot find module …/ticket-import.mjs`).

- [ ] **Step 3: Write** `src/core/requirements/ticket-import.mjs`:

```js
// src/core/requirements/ticket-import.mjs
// What Worca takes from a tracker ticket (plans/requirements-a61-design.md D5–D9, D14, §4): the description without a criteria
// section, the criteria, the comments as one Markdown file, the attachments with the reason one cannot come along, the default
// ticks within A8's caps, and the thread line. Pure: no I/O. Ticket text is data from the tracker: redacted here (D15) before the
// preview shows it and before anything is stored.
import { redactAskText } from '../ask/redact.mjs';
import { classifyExtension } from '../ask/attachment-kind.mjs';
import { LIMITS, clip } from './spec.mjs';
import { REQ_ATTACH_LIMITS, OFFICE_EXTENSIONS, displayName } from './attachments.mjs';
import { exportDate } from './ticket.mjs';

export const IMPORT_LIMITS = Object.freeze({ comments: 50, commentChars: 4000, page: 20 });
export const CAP_FILES = 'A feature takes up to 10 files; 10 are picked.';
export const CAP_BYTES = "Picked files are at 100 MB, a new feature's limit. Add more on the feature page.";

const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const extOf = (name) => { const i = String(name).lastIndexOf('.'); return i > 0 ? String(name).slice(i).toLowerCase() : ''; };

// D7: a heading, a bold line, or a line ending in ":" that reads "Acceptance criteria", "Acceptance criterion" or "AC"
const NAME_RE = /^(?:acceptance\s+criteri(?:a|on)|ac)$/i;
function headingName(line) {
  const s = line.trim();
  const m = /^#{1,6}\s+(.+?)\s*#*$/.exec(s) || /^\*\*(.+?)\*\*\s*:?$/.exec(s) || /^__(.+?)__\s*:?$/.exec(s) || /^([^:]+):$/.exec(s);
  if (!m) return null;
  const name = m[1].replace(/[:\s]+$/, '').trim();
  return NAME_RE.test(name) ? name : null;
}
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;
const isHeading = (line) => /^\s*#{1,6}\s/.test(line);

/** D7: the first criteria section of a Markdown description: its items (a list, or the lines up to the next heading or blank
 *  line), at most LIMITS.items of LIMITS.item characters, and the description without the section. */
export function splitCriteria(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => headingName(l) !== null);
  if (at < 0) return { description: String(markdown ?? ''), items: [], heading: null };
  const heading = headingName(lines[at]);
  let i = at + 1;
  while (i < lines.length && !lines[i].trim()) i += 1;
  const raw = [];
  if (i < lines.length && LIST_RE.test(lines[i])) {
    for (; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j += 1;
        if (j < lines.length && LIST_RE.test(lines[j])) { i = j - 1; continue; }   // a loose list: a blank line between items
        break;
      }
      if (isHeading(line)) break;
      const m = LIST_RE.exec(line);
      if (m) raw.push(m[1]);
      else if (raw.length) raw[raw.length - 1] += ` ${line.trim()}`;   // a continuation line
      else break;
    }
  } else {
    for (; i < lines.length && lines[i].trim() && !isHeading(lines[i]); i += 1) raw.push(lines[i]);
  }
  const items = raw.map((x) => clip(x, LIMITS.item)).filter(Boolean).slice(0, LIMITS.items);
  const description = [...lines.slice(0, at), ...lines.slice(i)].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { description, items, heading };
}

/** D6: the description the form keeps, up to the last paragraph break before LIMITS.description characters. */
export function clipDescription(text) {
  const s = String(text ?? '');
  if (s.length <= LIMITS.description) return { text: s, clipped: false };
  const cut = s.lastIndexOf('\n\n', LIMITS.description);
  return { text: (cut > 0 ? s.slice(0, cut) : s.slice(0, LIMITS.description)).trimEnd(), clipped: true };
}

const MARK = /<redacted(?:-jwt)?>/g;
const marks = (s) => (String(s).match(MARK) || []).length;
/** D15: redactAskText, and how many things it hid (the preview says so). */
export function redactCounted(text) {
  const s = String(text ?? '');
  const out = redactAskText(s);
  return { text: out, hidden: Math.max(0, marks(out) - marks(s)) };
}

export const commentsFileName = (key) => `${key} comments.md`;
export const descriptionFileName = (key) => `${key} description.md`;

/** §4: the picked comments as one text file, in the ticket's order: "**<author>** · <d Mon yyyy>" and the body. */
export function commentsMarkdown(key, comments = []) {
  const blocks = comments.map((c) => `**${oneLine(c.author) || 'Someone'}** · ${exportDate(c.created)}\n${String(c.body ?? '').trim()}`);
  return `# Comments on ${key}\n\n${blocks.join('\n\n')}\n`;
}

const READS = 'Worca reads text, images and PDF.';
/** D9: why an attachment is not offered, said for a file not added yet; null when A8 can take it. */
export function importReason(name, cls, bytes) {
  if (!cls) return OFFICE_EXTENSIONS.includes(extOf(name)) ? `Not offered: ${READS} Save it as PDF to attach it here.` : `Not offered: ${READS}`;
  if (Number(bytes) > REQ_ATTACH_LIMITS.fileBytes) return 'Not offered: it is over 25 MB.';
  return null;
}

/** D14: the one thread line an import writes (its `export` turn `imported`). The caller escapes it with asData. */
export function importThreadLine({ tracker, key, criteria = [], comments = 0 } = {}) {
  const ids = Array.isArray(criteria) ? criteria : [];
  const crit = !ids.length ? 'It had no acceptance criteria'
    : ids.length === 1 ? `Its acceptance criterion is ${ids[0]}` : `Its acceptance criteria are ${ids[0]} to ${ids.at(-1)}`;
  const files = Number(comments) > 0 ? `; its comments are in “${commentsFileName(key)}”` : '';
  return `The product owner started this feature from ${tracker} ticket ${key}. ${crit}${files}.`;
}

/** D5–D9: a tracker's importTicket answer (§4) as the preview shows it and the create stores it. Redacted, clipped, capped. */
export function processTicket(raw, { tracker }) {
  let redacted = 0;
  const red = (s) => { const r = redactCounted(s); redacted += r.hidden; return r.text; };
  const key = String(raw.key);
  const fromField = raw.criteria && Array.isArray(raw.criteria.items) && raw.criteria.items.some((x) => oneLine(x));
  const split = fromField ? { description: String(raw.description ?? ''), items: raw.criteria.items, heading: null } : splitCriteria(raw.description);
  const whole = red(split.description).trim();
  const clipped = clipDescription(whole);
  const items = split.items.map((x) => clip(red(oneLine(x)), LIMITS.item)).filter(Boolean).slice(0, LIMITS.items);
  const criteria = fromField
    ? { from: 'field', name: oneLine(raw.criteria.field && raw.criteria.field.name) || null, field: raw.criteria.field || null, items }
    : { from: items.length ? 'section' : null, name: items.length ? split.heading : null, field: null, items };
  const all = Array.isArray(raw.comments) ? raw.comments : [];
  const comments = all.slice(-IMPORT_LIMITS.comments).map((c) => {
    const body = clip(red(String(c.body ?? '')), IMPORT_LIMITS.commentChars);
    const author = oneLine(c.author) || 'Someone';
    return { id: String(c.id), author, authorKind: c.authorKind === 'app' ? 'app' : 'person', created: c.created || null,
      when: exportDate(c.created, { year: false }), body,
      bytes: Buffer.byteLength(`**${author}** · ${exportDate(c.created)}\n${body}\n\n`, 'utf8') };
  });
  const commentsTotal = Number.isFinite(Number(raw.commentsTotal)) ? Number(raw.commentsTotal) : all.length;
  const restrictedComments = Math.max(0, Number(raw.restrictedComments) || 0);
  const attachments = (Array.isArray(raw.attachments) ? raw.attachments : []).map((a) => {
    const name = displayName(a.name);
    const cls = classifyExtension(extOf(name));
    const bytes = Math.max(0, Number(a.bytes) || 0);
    return { id: String(a.id), name, kind: cls ? cls.kind : null, mime: cls ? cls.mime : '', bytes, refused: importReason(name, cls, bytes) };
  });
  const descriptionFile = clipped.clipped
    ? { name: descriptionFileName(key), text: whole, bytes: Buffer.byteLength(whole, 'utf8') } : null;
  return {
    key, url: raw.url || null, tracker, meta: raw.meta || {}, title: clip(oneLine(raw.title), LIMITS.title) || key,
    description: clipped.text, descriptionFile, clipped: clipped.clipped, redacted, criteria, comments, commentsTotal, restrictedComments,
    olderComments: Math.max(0, commentsTotal - restrictedComments - comments.length), attachments, fingerprint: raw.fingerprint || null,
  };
}

/** D5, D9: the default ticks. `form`: the files already on the New feature form ({ count, bytes }). */
export function pickDefaults(p, { count = 0, bytes = 0 } = {}) {
  const L = REQ_ATTACH_LIMITS;
  const comments = p.comments.map((c) => ({ ...c, picked: c.authorKind === 'person' }));
  const picked = comments.filter((c) => c.picked);
  let n = count + (picked.length ? 1 : 0) + (p.descriptionFile ? 1 : 0);
  let size = bytes + picked.reduce((s, c) => s + c.bytes, 0) + (p.descriptionFile ? p.descriptionFile.bytes : 0);
  const attachments = p.attachments.map((a) => {
    if (a.refused) return { ...a, picked: false, capped: null };
    if (n + 1 > L.files) return { ...a, picked: false, capped: 'files' };
    if (size + a.bytes > L.requestBytes) return { ...a, picked: false, capped: 'bytes' };
    n += 1;
    size += a.bytes;
    return { ...a, picked: true, capped: null };
  });
  return { ...p, criteria: { ...p.criteria, picked: p.criteria.items.map(() => true) }, comments, attachments };
}
```

- [ ] **Step 4: Run it.** `node tools/test.mjs test/requirements-ticket-import.test.mjs` → PASS. If the description-file length assertion fails, print `p.descriptionFile.text.length` and check the fixture: `15000 + 2 + 9000 = 24002` characters, all of them kept in the file.

- [ ] **Step 5: Commit.**

```bash
git add src/core/requirements/ticket-import.mjs test/requirements-ticket-import.test.mjs
git commit -m "Requirements: what Worca takes from a ticket (pure)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: The shared contract — the import capability, the mock answers, the plugin skill

**Files:**
- Modify: `src/core/requirements/export.mjs` (the probe at lines ~42–98; export `connectionLabel` and `sameConn`; `firstLine` out of `trackerCall`)
- Modify: `src/core/plugin-shim.mjs` (`MOCK_DEFAULTS`, the `node:fs` import)
- Modify: `src/core/plugin-api.mjs` (the comment above `WORCA_PLUGIN_API`)
- Modify: `.claude/skills/creating-worca-cc-plugins/SKILL.md` (the connector contract table and the paragraph after it)
- Modify: `test/requirements-export-trackers.test.mjs`, `test/plugin-shim.test.mjs`

**Interfaces:**
- Consumes: A6's `exportTrackers`, `defaultConnection`, `_resetExportCaches` (`export.mjs`); `setMockSourceResponses` (`plugin-shim.mjs`).
- Produces (`export.mjs`):
  - `trackersWith(cap: 'export' | 'import', d = {}) → Promise<[{ plugin, sourceId, name, multiProfile, profiles: [{ id, label }] }]>` — one cached `capabilities()` probe per plugin, source id and installed version answers both; `exportTrackers(d)` is `trackersWith('export', d)`.
  - `connectionLabel(conn) → string` (now exported); `sameConn(a, b) → boolean` (now exported); `firstLine(err) → string` (new, the log line's first 200 characters; A6's `trackerCall` uses it).
- Produces (the mock shim, `WORCA_MOCK=1`):
  - `capabilities` → `{ writeBack: true, export: true, import: true }`
  - `importOptions` → `{ projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }] }`
  - `searchTickets({ project?, search? })` → four tickets (SHOP-124 "Partial cancel for multi-item orders" Story · In progress · 25 Oct; SHOP-123 "Cancel an order before it ships" Story · To do · 26 Oct; SHOP-131 "Cancel button hidden on the mobile order page" Bug · To do · 24 Oct; SHOP-98 "Refund to store credit after a cancel" Story · Done · 12 Oct), newest first, filtered by every word of `search` or by a pasted key or link.
  - `importTicket({ key })` → board 34's ticket under that key (`{ gone: true }` for `SHOP-999`): the description with an `## Acceptance criteria` section of three items, six comments (Ann Example, Bo Example, Ann Example, "Jira Automation" with `authorKind: 'app'`, Cy Example, Bo Example with the fake `ghp_` token), `commentsTotal: 7`, `restrictedComments: 1`, five attachments `10041` packing-slip.png 860160, `10042` partial-cancel-flow.pdf 1258291, `10043` support-macro.txt 4096, `10044` refund-matrix.xlsx 98304, `10045` pick-route-scan.pdf 32505856.
  - `downloadAttachment({ id, maxBytes, dest })` → writes a tiny valid PNG, PDF or text body to `dest` (`wx`, 0600) and answers `{ name, mime, bytes }`; over `maxBytes` → `{ tooLarge: true, bytes }`; an unknown id → `{ gone: true }`; `WORCA_MOCK_DOWNLOAD_MS` delays it (the browser proof sees **Downloading…**).

- [ ] **Step 1: Write the failing tests.** Append to `test/requirements-export-trackers.test.mjs` (and add `trackersWith` to its import from `../src/core/requirements/export.mjs`):

```js
test('A6.1 D2: one capabilities call answers export and import; a source that only imports is an import source, not an export tracker', async () => {
  _resetExportCaches();
  const callSource = fakeCall({ 'jira-source': { export: true, import: true }, 'mock-source': { writeBack: true, import: true } });
  assert.deepEqual((await trackersWith('import', { callSource })).map((x) => x.plugin), ['jira-source', 'mock-source']);
  assert.deepEqual((await exportTrackers({ callSource })).map((x) => x.plugin), ['jira-source']);
  assert.equal(callSource.calls.length, 2, 'one probe per source answers both');
  _resetExportCaches();
  const truthy = fakeCall({ 'jira-source': { import: 'yes' }, 'mock-source': {} });
  assert.deepEqual(await trackersWith('import', { callSource: truthy }), [], 'import must be true, not truthy');
});
```

In `test/plugin-shim.test.mjs`, change the A6 assertion line to `{ writeBack: true, export: true, import: true }` (and its comment to "A6/A6.1: … the mock source can export and import."), then add a test after that test:

```js
test('A6.1 mock answers (D18): search, a ticket, a gone key, a download into dest, too large and gone', async () => {
  process.env.WORCA_MOCK = '1';
  const dir = mkdtempSync(join(tmpdir(), 'worca-shim-dl-'));
  const call = (op, args) => callSource({ plugin: 'x', sourceId: 'x', op, args });
  try {
    assert.deepEqual((await call('importOptions', {})).projects.map((p) => p.label), ['SHOP — Shop web', 'OPS — Operations']);
    assert.deepEqual((await call('searchTickets', {})).tickets.map((t) => t.key), ['SHOP-123', 'SHOP-124', 'SHOP-131', 'SHOP-98'], 'newest first');
    assert.deepEqual((await call('searchTickets', { search: 'partial cancel' })).tickets.map((t) => t.key), ['SHOP-124']);
    assert.deepEqual((await call('searchTickets', { search: 'https://mock.test/browse/SHOP-131' })).tickets.map((t) => t.key), ['SHOP-131']);
    assert.deepEqual((await call('searchTickets', { project: 'OPS' })).tickets, []);
    const t = await call('importTicket', { key: 'SHOP-124' });
    assert.deepEqual([t.key, t.title, t.comments.length, t.commentsTotal, t.restrictedComments, t.attachments.length],
      ['SHOP-124', 'Partial cancel for multi-item orders', 6, 7, 1, 5]);
    assert.ok(t.comments.some((c) => c.authorKind === 'app' && c.author === 'Jira Automation'));
    assert.ok(t.comments.filter((c) => c.authorKind === 'person').every((c) => / Example$/.test(c.author)), 'made-up names only');
    assert.match(t.description, /## Acceptance criteria/);
    assert.deepEqual(await call('importTicket', { key: 'SHOP-999' }), { gone: true });
    const dest = join(dir, 'body.part');
    const r = await call('downloadAttachment', { key: 'SHOP-124', id: '10042', maxBytes: 25 * 1024 * 1024, dest });
    assert.deepEqual([r.name, r.mime], ['partial-cancel-flow.pdf', 'application/pdf']);
    const { readFileSync } = await import('node:fs');
    assert.equal(readFileSync(dest).length, r.bytes);
    assert.match(readFileSync(dest, 'latin1'), /^%PDF-/);
    assert.deepEqual(await call('downloadAttachment', { key: 'SHOP-124', id: '10045', maxBytes: 25 * 1024 * 1024, dest: join(dir, 'b.part') }),
      { tooLarge: true, bytes: 32505856 });
    assert.deepEqual(await call('downloadAttachment', { key: 'SHOP-124', id: '1', maxBytes: 10, dest: join(dir, 'c.part') }), { gone: true });
  } finally {
    delete process.env.WORCA_MOCK;
    setMockSourceResponses(null);
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run them to see them fail.** `node tools/test.mjs test/requirements-export-trackers.test.mjs` → FAIL (`trackersWith` is not exported). `node tools/test.mjs test/plugin-shim.test.mjs` → FAIL (capabilities lacks `import`; no canned `importOptions`).

- [ ] **Step 3: `export.mjs`.** Replace `probe`, `canExport` and `exportTrackers` (keep `capCache`, `capFailed`, `capInflight`, `versionOf`, `connectionsOf` as they are):

```js
const NO_CAPS = Object.freeze({ export: false, import: false });

async function probe(s, first, d) {
  try {
    const caps = await callOf(d)({ plugin: s.plugin, sourceId: s.sourceId, op: 'capabilities', args: { inputs: {} },
      profile: first.id || undefined, timeoutMs: PROBE_TIMEOUT_MS });
    // A6 D3 and A6.1 D2: one answer says both; only `true` counts
    return { keep: true, caps: { export: !!(caps && caps.export === true), import: !!(caps && caps.import === true) } };
  } catch (err) {
    // A connector without the op can do neither (kept); any other failure stands for PROBE_RETRY_MS (D3)
    return { keep: (err && err.kind) === 'unimplemented', caps: NO_CAPS };
  }
}

async function capsOf(s, first, d) {
  const key = `${s.plugin}/${s.sourceId}@${versionOf(s.plugin)}`;
  if (capCache.has(key)) return capCache.get(key);
  const failKey = `${s.plugin}/${s.sourceId}/${first.id || ''}`;
  if (capFailed.has(failKey) && msOf(d) - capFailed.get(failKey) < PROBE_RETRY_MS) return NO_CAPS;
  if (!capInflight.has(key)) {
    capInflight.set(key, probe(s, first, d).then((r) => {
      if (r.keep) { capCache.set(key, r.caps); capFailed.delete(failKey); } else capFailed.set(failKey, msOf(d));
      return r.caps;
    }).finally(() => capInflight.delete(key)));
  }
  return capInflight.get(key);
}

/** The sources whose capabilities() say `cap` ('export' for A6, 'import' for A6.1): enabled plugin task sources with a
 *  connection (a multi-profile source needs a profile; it is probed with its first, since it refuses a call without one), in
 *  listTaskSources' order. All sources are probed at once, so one slow connector costs a view at most PROBE_TIMEOUT_MS.
 *  Never throws. */
export async function trackersWith(cap, d = {}) {
  let sources = [];
  try { sources = listTaskSources().filter((s) => s.type === 'plugin'); } catch { return []; }
  const found = await Promise.all(sources.map(async (s) => {
    const conns = connectionsOf(s);
    if (!conns.length || !(await capsOf(s, conns[0], d))[cap]) return null;
    return { plugin: s.plugin, sourceId: s.sourceId, name: s.displayName, multiProfile: s.multiProfile === true,
      profiles: conns.map((p) => ({ id: p.id || null, label: String(p.label || p.id || s.displayName) })) };
  }));
  return found.filter(Boolean);
}

/** D1, D3: the sources that can export. */
export const exportTrackers = (d = {}) => trackersWith('export', d);
```

Change `const sameConn = …` to `export const sameConn = …` and `function connectionLabel(conn)` to `export function connectionLabel(conn)`. Above `trackerCall` add the log helper A6's `trackerCall` already inlines, and make `trackerCall` use it (`console.error(\`…failed (${kind}):\`, firstLine(err));` in place of its local `const firstLine = …`):

```js
/** What the server log may keep of a failure: its first line, at most 200 characters — never a plugin's whole stdout/stderr,
 *  which can carry config or environment fragments (A6's final review; A6.1 uses it for every import and download log line). */
export const firstLine = (err) => String((err && err.message) || err).split(/\r?\n/)[0].slice(0, 200);
```

- [ ] **Step 4: The mock answers.** In `src/core/plugin-shim.mjs` change the fs import to `import { readFileSync, writeFileSync } from 'node:fs';`. Right after `const mockUrl = …` add:

```js
// A6.1 (plans/requirements-a61-design.md §4, D18): the import ops' canned answers, so the Requirements browser proof runs offline.
// People are made-up names; the fake token is the repo's test token. A download writes a tiny valid body to `dest`.
const MOCK_SEARCH = Object.freeze([
  { key: 'SHOP-124', title: 'Partial cancel for multi-item orders', type: 'Story', status: 'In progress', updatedAt: '2026-10-25T12:00:00.000Z' },
  { key: 'SHOP-123', title: 'Cancel an order before it ships', type: 'Story', status: 'To do', updatedAt: '2026-10-26T12:00:00.000Z' },
  { key: 'SHOP-131', title: 'Cancel button hidden on the mobile order page', type: 'Bug', status: 'To do', updatedAt: '2026-10-24T12:00:00.000Z' },
  { key: 'SHOP-98', title: 'Refund to store credit after a cancel', type: 'Story', status: 'Done', updatedAt: '2026-10-12T12:00:00.000Z' },
]);
const MOCK_TICKET_DESCRIPTION = [
  'When an order has several items and some have already shipped, customers cannot cancel the rest. Support does it by hand today, about 40 tickets a month.',
  '', 'Customers should be able to cancel the items that have not been picked up yet, from their order history.', '', '(image: packing-slip.png)', '',
  '## Acceptance criteria', '',
  '- A customer can cancel the items of an order that have not been picked up.',
  '- Shipped items stay on the order and cannot be cancelled.',
  '- The refund covers only the cancelled items, including their share of the shipping cost.',
].join('\n');
const MOCK_COMMENTS = Object.freeze([
  ['10231', 'Ann Example', 'person', '2026-10-21T09:30:00.000Z', 'Warehouse confirms items are picked per parcel, not per item. A parcel with two items is picked up as one.'],
  ['10232', 'Bo Example', 'person', '2026-10-22T10:05:00.000Z', 'The payment provider supports partial refunds on cards and PayPal; invoiced orders need a credit note.'],
  ['10233', 'Ann Example', 'person', '2026-10-23T08:40:00.000Z', 'Finance wants the shipping share pro rata by item price.'],
  ['10234', 'Jira Automation', 'app', '2026-10-23T09:00:00.000Z', 'Status changed to In progress.'],
  ['10235', 'Cy Example', 'person', '2026-10-24T14:20:00.000Z', "Support's reply macro for partial cancels is attached (support-macro.txt). Customers ask most about when the refund arrives."],
  ['10236', 'Bo Example', 'person', '2026-10-25T11:10:00.000Z', 'Sandbox for the refund API is ready; token ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
].map(([id, author, authorKind, created, body]) => Object.freeze({ id, author, authorKind, created, body })));
const MOCK_ATTACHMENTS = Object.freeze([
  ['10041', 'packing-slip.png', 'image/png', 860160], ['10042', 'partial-cancel-flow.pdf', 'application/pdf', 1258291],
  ['10043', 'support-macro.txt', 'text/plain', 4096],
  ['10044', 'refund-matrix.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 98304],
  ['10045', 'pick-route-scan.pdf', 'application/pdf', 32505856],
].map(([id, name, mime, bytes]) => Object.freeze({ id, name, mime, bytes, created: '2026-10-21T09:00:00.000Z' })));
const MOCK_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const mockBody = (name) => (/\.png$/i.test(name) ? MOCK_PNG : /\.pdf$/i.test(name) ? Buffer.from('%PDF-1.7\n% Worca mock\n') : Buffer.from(`Mock text of ${name}.\n`));
const mockPasted = (s) => {
  const t = String(s || '').trim();
  if (/^[A-Z][A-Z0-9_]*-\d+$/i.test(t)) return t.toUpperCase();
  const m = /\/browse\/([A-Z][A-Z0-9_]*-\d+)/i.exec(t);
  return m ? m[1].toUpperCase() : null;
};
```

In `MOCK_DEFAULTS`, change `capabilities` to `() => ({ writeBack: true, export: true, import: true }),` (and its comment to "…the mock source can export and import.") and add after `findTicket`:

```js
  importOptions: () => ({ projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }] }),
  searchTickets: (args = {}) => {
    const pasted = mockPasted(args.search);
    const words = pasted ? [] : String(args.search || '').toLowerCase().split(/\s+/).filter(Boolean);
    const hits = MOCK_SEARCH.filter((t) => (pasted ? t.key === pasted
      : (!args.project || t.key.startsWith(`${args.project}-`)) && words.every((w) => t.title.toLowerCase().includes(w))))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { tickets: hits.map((t) => ({ ...t, url: mockUrl(t.key) })) };
  },
  importTicket: (args = {}) => {
    const key = String(args.key || '').toUpperCase();
    if (key === 'SHOP-999') return { gone: true };
    const known = MOCK_SEARCH.find((t) => t.key === key);
    const fp = mockFingerprint(MOCK_TICKET_DESCRIPTION);
    if (!mockFingerprints.has(key)) mockFingerprints.set(key, fp);   // A6's edited check compares with the import's fingerprint
    return {
      key, url: mockUrl(key), title: known ? known.title : MOCK_SEARCH[0].title, description: MOCK_TICKET_DESCRIPTION, criteria: null,
      comments: MOCK_COMMENTS.map((c) => ({ ...c })), commentsTotal: 7, restrictedComments: 1, attachments: MOCK_ATTACHMENTS.map((a) => ({ ...a })),
      meta: { project: key.split('-')[0], projectName: 'Shop web', type: known && known.type === 'Bug' ? { id: '10003', name: 'Bug' } : { id: '10001', name: 'Story' },
        status: known ? known.status : 'In progress', priority: { id: '3', name: 'Medium' } },
      fingerprint: fp,
    };
  },
  downloadAttachment: async (args = {}) => {
    const a = MOCK_ATTACHMENTS.find((x) => x.id === String(args.id));
    if (!a) return { gone: true };
    if (a.bytes > Number(args.maxBytes || Infinity)) return { tooLarge: true, bytes: a.bytes };
    const ms = Number(process.env.WORCA_MOCK_DOWNLOAD_MS) || 0;   // the browser proof sees Downloading… (A6.1 D18)
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    const body = mockBody(a.name);
    writeFileSync(args.dest, body, { flag: 'wx', mode: 0o600 });
    return { name: a.name, mime: a.mime, bytes: body.length };
  },
```

- [ ] **Step 5: The plugin API comment.** In `src/core/plugin-api.mjs`, after the A6 comment lines, add:

```js
// Requirements A6.1 adds optional import ops (capabilities().import, importOptions, searchTickets, importTicket, downloadAttachment).
// Additive in the same way: a connector without them simply cannot import, so the API stays 5.
```

- [ ] **Step 6: The plugin skill.** In `.claude/skills/creating-worca-cc-plugins/SKILL.md`'s connector contract table, change the `capabilities` row's Returns to `` `{writeBack, incrementalSync, export?, import?}`; missing → `writeBack: true`; `export: true` turns on the export ops below, `import: true` the import ops `` and add, after the `findTicket` row:

```markdown
| `importOptions` | `({})` — optional, import | `{projects:[{value,label}]}` |
| `searchTickets` | `({project?, search?, cursor?})` — optional, import | `{tickets:[{key,title,url,type,status,updatedAt}], cursor?}` — no search: most recently updated first; a pasted key or ticket link finds that ticket in any project |
| `importTicket` | `({key, criteriaField?})` — optional, import | `{key, url, title, description, criteria, comments, commentsTotal, restrictedComments, attachments, meta, fingerprint}` \| `{gone:true}` |
| `downloadAttachment` | `({key, id, maxBytes, dest})` — optional, import | the body written to `dest`, and `{name, mime, bytes}` \| `{tooLarge:true, bytes}` \| `{gone:true, forbidden?}` |
```

After the export paragraph add:

```markdown
The import ops (Requirements' **New feature › From a ticket…**) only read. `importTicket` answers the ticket tool-neutrally:
`description` and comment bodies as Markdown (never HTML), `criteria` only from a field (`{field:{id,name}, items}`, else
`null`: Worca finds a criteria section in the description itself), the newest 50 comments oldest first with the author's
display name and `authorKind: 'person' | 'app'` only (never an email, account id or avatar; profile links and mentions become
plain names), comments restricted to a group or role left out and counted in `restrictedComments`, attachments as metadata
`{id, name, mime, bytes, created}`, `meta: {project, projectName, type:{id,name}, status, priority}` and the description's
`fingerprint` as `ticketState` computes it. A ticket the connection cannot see is `{gone:true}`. `downloadAttachment` checks the
attachment belongs to `key`, refuses before downloading when its size is over `maxBytes` (`{tooLarge}`), downloads only from the
site's own address (one redirect at most, `https:` only and without the Authorization header when it leaves the site), streams
the body into `dest` — a fixed file name inside a fresh private folder the host made — creating it exclusively, deletes what it
wrote on any failure or once the body grows past `maxBytes`, and never writes anywhere else. Worca checks the file before it
trusts it.
```

- [ ] **Step 7: Run the tests.** One at a time: `node tools/test.mjs test/requirements-export-trackers.test.mjs`, `node tools/test.mjs test/plugin-shim.test.mjs`, `node tools/test.mjs test/requirements-export.test.mjs`, `node tools/test.mjs test/requirements-export-api.test.mjs`, `node tools/test.mjs test/writeback.test.mjs` → all PASS.

- [ ] **Step 8: Commit.**

```bash
git add src/core/requirements/export.mjs src/core/plugin-shim.mjs src/core/plugin-api.mjs .claude/skills/creating-worca-cc-plugins/SKILL.md test/requirements-export-trackers.test.mjs test/plugin-shim.test.mjs
git commit -m "Requirements: the import capability in the task-source contract, with mock answers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Jira connector reads a ticket (Cloud and Data Center, against a fake Jira)

**Files:**
- Modify: `plugins/jira-source/connector/index.mjs` (`capabilities`; three ops after `findTicket`)
- Modify: `plugins/jira-source/connector/markup.mjs` (`htmlToMarkdown`)
- Modify: `test/helpers/fake-jira.mjs` (seeded issues, `/rest/api/2/field`, the comment page, the import search)
- Modify: `test/jira-source-export.test.mjs` (the capabilities assertion)
- Create: `test/jira-source-import.test.mjs`

**Interfaces:**
- Consumes: the connector's own `jiraFetch`, `issue`, `projectList`, `deployment`, `pastedKey`, `buildJql`, `fingerprintOf`, `exportOp`, `browse`, `requireKey`, `log`.
- Produces (connector ops, all through `exportOp`): `capabilities({ inputs }) → { writeBack, incrementalSync: false, export: true, import: true }`; `importOptions({}) → { projects: [{ value: key, label: '<key> — <name>' }] }`; `searchTickets({ project?, search?, cursor? }) → { tickets: [{ key, title, url, type, status, updatedAt }], cursor? }` (20 a page; never the user's saved JQL); `importTicket({ key, criteriaField? }) → §4's answer | { gone: true }`.
- Produces (`markup.mjs`): `htmlToMarkdown` turns `<img alt>` into `(image: <alt>)` (an image without alt text disappears), each table row into one `| a | b |` line, and a link to a person (`/secure/ViewProfile`, `/jira/people/`, `/people/`) into the plain name; `plainWiki(text) → string` (new: the raw wiki fallback, a mention as "someone", `[text|url]` as "text (url)" for http(s) only).
- Produces (`test/helpers/fake-jira.mjs`): `startFakeJira({ seed: [SeededIssue], forbid: [key] })`; `SeededIssue = { key, project, projectName, summary, description (wiki), rendered (HTML), type: { id, name }, status, priority: { id, name } | null, updated, comments: [{ id, author, created, body, rendered, visibility? }], embedded?: number, attachments: [{ id, filename, mimeType, size, created, body?: Buffer }], custom: { [fieldId]: { name, value, rendered } } }`.

- [ ] **Step 1: Extend the fake Jira.** In `test/helpers/fake-jira.mjs`:
  - add `seed: [], forbid: []` to the defaults of `opt`, and the comment line `// A6.1: seed — issues the import ops read (SeededIssue in the A6.1 plan); forbid — keys whose read answers 403.`
  - after `const issues = new Map();` add `const seeded = new Map((opt.seed || []).map((s) => [s.key, s]));`
  - right before `let m = /^\/rest\/api\/2\/issue\/createmeta…/` add the field list:

```js
    if (p === '/rest/api/2/field') {
      return send(res, 200, BASE_FIELDS.map((f) => ({ id: f.fieldId, name: f.name, custom: /^customfield_/.test(f.fieldId), schema: f.schema })));
    }
```

  - right before `m = /^\/rest\/api\/2\/issue\/([^/]+)\/comment$/.exec(p);` add the comment page of a seeded issue:

```js
    m = /^\/rest\/api\/2\/issue\/([^/]+)\/comment$/.exec(p);
    if (m && req.method === 'GET' && seeded.has(m[1])) {
      const s = seeded.get(m[1]);
      const newest = [...s.comments].reverse().slice(0, Number(url.searchParams.get('maxResults')) || 50);
      return send(res, 200, { total: s.comments.length, startAt: 0, maxResults: newest.length, comments: newest.map((c) => ({ id: c.id, author: c.author,
        created: c.created, body: c.body, ...(c.visibility ? { visibility: c.visibility } : {}),
        ...(/renderedBody/.test(url.searchParams.get('expand') || '') ? { renderedBody: c.rendered } : {}) })) });
    }
```

  - in the `m = /^\/rest\/api\/2\/issue\/([^/]+)$/.exec(p); if (m) {` branch, before `const i = issues.get(m[1]);`, add the seeded read:

```js
      if ((opt.forbid || []).includes(m[1])) return send(res, 403, { errorMessages: ['You do not have the permission to see the specified issue.'], errors: {} });
      if (seeded.has(m[1]) && req.method === 'GET') return send(res, 200, seededAnswer(seeded.get(m[1]), url));
```

  - in the search branch, before `const jql = url.searchParams.get('jql') || '';`, add the import search over seeded issues:

```js
      if (seeded.size) {
        const q = url.searchParams.get('jql') || '';
        const project = (/project = "([^"]+)"/.exec(q) || [])[1];
        const text = ((/text ~ "([^"]+)"/.exec(q) || [])[1] || '').toLowerCase();
        const all = [...seeded.values()].filter((s) => (!project || s.project === project) && (!text || s.summary.toLowerCase().includes(text)))
          .sort((a, b) => b.updated.localeCompare(a.updated));
        const max = Number(url.searchParams.get('maxResults')) || 50;
        const start = cloud ? Number(url.searchParams.get('nextPageToken') || 0) : Number(url.searchParams.get('startAt') || 0);
        const page = all.slice(start, start + max).map((s) => ({ key: s.key, fields: { summary: s.summary, status: { name: s.status },
          issuetype: { id: s.type.id, name: s.type.name }, updated: s.updated } }));
        const more = start + page.length < all.length;
        return send(res, 200, cloud ? { issues: page, isLast: !more, ...(more ? { nextPageToken: String(start + page.length) } : {}) }
          : { issues: page, startAt: start, maxResults: max, total: all.length });
      }
```

  - and, above `export async function startFakeJira`, the seeded answer:

```js
const SYSTEM_NAMES = { summary: 'Summary', description: 'Description', issuetype: 'Issue Type', priority: 'Priority', status: 'Status', project: 'Project',
  attachment: 'Attachment', comment: 'Comment' };
/** A6.1: a seeded issue's GET /rest/api/2/issue/<key>, with only the fields asked for, renderedFields and names when expanded.
 *  `contentOf(attachment)` names an attachment's content address (Task 5). */
function seededAnswer(s, url, contentOf = () => undefined) {
  const want = new Set((url.searchParams.get('fields') || '').split(','));
  const expand = url.searchParams.get('expand') || '';
  const fields = {}; const rendered = {}; const names = {};
  if (want.has('summary')) fields.summary = s.summary;
  if (want.has('description')) { fields.description = s.description; rendered.description = s.rendered ?? null; }
  if (want.has('issuetype')) fields.issuetype = { id: s.type.id, name: s.type.name };
  if (want.has('priority')) fields.priority = s.priority || null;
  if (want.has('status')) fields.status = { name: s.status };
  if (want.has('project')) fields.project = { key: s.project, name: s.projectName };
  if (want.has('updated')) fields.updated = s.updated;
  if (want.has('attachment')) fields.attachment = (s.attachments || []).map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size,
    created: a.created, content: contentOf(a) }));
  if (want.has('comment')) {
    const list = s.comments.slice(0, s.embedded ?? s.comments.length);
    fields.comment = { total: s.comments.length, maxResults: list.length, startAt: 0, comments: list.map((c) => ({ id: c.id, author: c.author, created: c.created,
      body: c.body, ...(c.visibility ? { visibility: c.visibility } : {}) })) };
    rendered.comment = { comments: list.map((c) => ({ id: c.id, body: c.rendered })) };
  }
  for (const [id, c] of Object.entries(s.custom || {})) if (want.has(id)) { fields[id] = c.value; rendered[id] = c.rendered; names[id] = c.name; }
  for (const k of Object.keys(fields)) names[k] = names[k] || SYSTEM_NAMES[k] || k;
  return { key: s.key, fields, ...(/renderedFields/.test(expand) ? { renderedFields: rendered } : {}), ...(/names/.test(expand) ? { names } : {}) };
}
```

- [ ] **Step 2: Write the failing test** `test/jira-source-import.test.mjs`:

```js
// test/jira-source-import.test.mjs — jira-source's import ops against a fake Jira over real HTTP (plans/requirements-a61-design.md §5, D4,
// D7, D8, D15, D16): Cloud and Data Center, the project list, search by words and by a pasted key or link, 20 a page, the ticket with
// its description as Markdown, the criteria field, comments past the embedded page, restricted and app comments, names only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import createTaskSource, { fingerprintOf } from '../plugins/jira-source/connector/index.mjs';
import { htmlToMarkdown } from '../plugins/jira-source/connector/markup.mjs';
import { startFakeJira } from './helpers/fake-jira.mjs';

const open = [];
after(async () => { for (const j of open) await j.close(); });
async function site(o = {}) {
  const jira = await startFakeJira(o);
  open.push(jira);
  const cloud = (o.deployment || 'cloud') === 'cloud';
  const map = new Map();
  const ctx = { apiVersion: 5, profile: 'acme', log: () => {}, config: { baseUrl: jira.base, email: cloud ? 'ann@acme.test' : '', token: 'tok', transitionOnComplete: 'Done' },
    state: { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); } } };
  return { jira, src: createTaskSource(ctx) };
}
const BOTH = ['cloud', 'datacenter'];
const person = (name, id) => ({ displayName: name, accountId: id, accountType: 'atlassian', active: true, name: name.toLowerCase().replace(' ', '.'),
  emailAddress: `${name.toLowerCase().replace(' ', '.')}@example.test`, avatarUrls: { '48x48': 'https://avatars.test/x.png' } });
const ISSUE = (over = {}) => ({
  key: 'SHOP-124', project: 'SHOP', projectName: 'Shop web', summary: 'Partial cancel for multi-item orders',
  description: 'When an order has several items...\n\nh2. Acceptance criteria\n* Unpicked items can be cancelled.',
  rendered: '<p>When an order has several items, customers cannot cancel the rest.</p>'
    + '<p><span class="image-wrap"><img src="/rest/api/2/attachment/content/10041" alt="packing-slip.png" /></span></p>'
    + '<table class="confluenceTable"><tbody><tr><th>Item</th><th>State</th></tr><tr><td>Mug</td><td>Shipped</td></tr></tbody></table>'
    + '<p>Ask <a href="https://acme.test/secure/ViewProfile.jspa?accountId=5b10ac8d82e05b22cc7d4ef5" class="user-hover">Ann Example</a>.</p>'
    + '<h2>Acceptance criteria</h2><ul><li>Unpicked items can be cancelled.</li></ul>',
  type: { id: '10001', name: 'Story' }, status: 'In progress', priority: { id: '3', name: 'Medium' }, updated: '2026-10-25T12:00:00.000+0000',
  comments: [
    { id: '1', author: person('Ann Example', 'acc-ann'), created: '2026-10-21T12:00:00.000+0000', body: 'Picked per parcel.', rendered: '<p>Picked per parcel.</p>' },
    { id: '2', author: { displayName: 'Jira Automation', accountType: 'app', active: true }, created: '2026-10-23T12:00:00.000+0000', body: 'Status changed.',
      rendered: '<p>Status changed.</p>' },
    { id: '3', author: person('Bo Example', 'acc-bo'), created: '2026-10-24T12:00:00.000+0000', body: 'Internal.', rendered: '<p>Internal.</p>',
      visibility: { type: 'group', value: 'jira-staff' } },
    { id: '4', author: { displayName: 'Release Bot', active: false, name: 'releasebot' }, created: '2026-10-25T12:00:00.000+0000', body: 'Built.', rendered: '<p>Built.</p>' },
  ],
  attachments: [{ id: '10041', filename: 'packing-slip.png', mimeType: 'image/png', size: 12, created: '2026-10-21T09:00:00.000+0000' }],
  custom: { customfield_10070: { name: 'Acceptance Criteria', value: '* From the field\n* Second', rendered: '<ul><li>From the field</li><li>Second</li></ul>' } },
  ...over,
});
const OTHERS = [
  ISSUE({ key: 'SHOP-123', summary: 'Cancel an order before it ships', updated: '2026-10-26T12:00:00.000+0000', custom: {} }),
  ISSUE({ key: 'OPS-7', project: 'OPS', projectName: 'Operations', summary: 'Cancel a pick run', updated: '2026-10-20T12:00:00.000+0000', custom: {} }),
];

test("capabilities: import and export are on; write-back still follows the run's input", async () => {
  const { src } = await site();
  assert.deepEqual(src.capabilities({ inputs: { writeBack: 'yes' } }), { writeBack: true, incrementalSync: false, export: true, import: true });
});

test('importOptions: the projects as "SHOP — Shop web" on Cloud and Data Center', async () => {
  for (const deployment of BOTH) {
    const { src } = await site({ deployment });
    assert.deepEqual(await src.importOptions({}), { projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }] }, deployment);
  }
});

test('searchTickets: no words lists the project newest first; words search its text; Cloud at /search/jql, Data Center at /search; never a saved filter', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, seed: [ISSUE(), ...OTHERS] });
    const recent = await src.searchTickets({ project: 'SHOP' });
    assert.deepEqual(recent.tickets.map((t) => t.key), ['SHOP-123', 'SHOP-124'], deployment);
    assert.deepEqual(recent.tickets[1], { key: 'SHOP-124', title: 'Partial cancel for multi-item orders', url: `${jira.base}/browse/SHOP-124`, type: 'Story',
      status: 'In progress', updatedAt: '2026-10-25T12:00:00.000+0000' });
    assert.deepEqual((await src.searchTickets({ project: 'SHOP', search: 'partial' })).tickets.map((t) => t.key), ['SHOP-124']);
    const q = jira.requests.filter((r) => /\/search/.test(r.path));
    assert.equal(q[0].path, deployment === 'cloud' ? '/rest/api/2/search/jql' : '/rest/api/2/search');
    assert.equal(q[0].query.fields, 'summary,status,issuetype,updated');
    assert.equal(q[0].query.maxResults, '20');
    assert.ok(q.every((r) => !/assignee|currentUser/.test(r.query.jql)), 'the import never uses the JQL filter input');
  }
});

test('searchTickets: a pasted key or link finds the ticket in any project; one that is not there is no result (Data Center 403 too)', async () => {
  for (const deployment of BOTH) {
    const { src } = await site({ deployment, seed: [ISSUE(), ...OTHERS], forbid: ['SHOP-5'] });
    assert.deepEqual((await src.searchTickets({ project: 'SHOP', search: 'ops-7' })).tickets.map((t) => t.key), ['OPS-7'], deployment);
    assert.deepEqual((await src.searchTickets({ search: 'https://acme.test/browse/SHOP-123' })).tickets.map((t) => t.key), ['SHOP-123']);
    assert.deepEqual((await src.searchTickets({ search: 'SHOP-999' })).tickets, []);
    if (deployment === 'datacenter') assert.deepEqual((await src.searchTickets({ search: 'SHOP-5' })).tickets, []);
  }
});

test("searchTickets: 20 a page; the cursor is Cloud's nextPageToken or Data Center's startAt", async () => {
  const many = Array.from({ length: 25 }, (_, i) => ISSUE({ key: `SHOP-${200 + i}`, summary: `Ticket ${i}`,
    updated: `2026-10-${String(1 + i).padStart(2, '0')}T12:00:00.000+0000`, custom: {} }));
  for (const deployment of BOTH) {
    const { src } = await site({ deployment, seed: many });
    const first = await src.searchTickets({ project: 'SHOP' });
    assert.equal(first.tickets.length, 20, deployment);
    assert.ok(first.cursor, deployment);
    const next = await src.searchTickets({ project: 'SHOP', cursor: first.cursor });
    assert.equal(next.tickets.length, 5, deployment);
    assert.equal(next.cursor, undefined, deployment);
  }
});

test('importTicket: the description as Markdown; criteria from the field named "Acceptance Criteria"; comments with names only; attachments; meta; fingerprint', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, seed: [ISSUE()] });
    const t = await src.importTicket({ key: 'shop-124' });
    assert.equal(t.key, 'SHOP-124', deployment);
    assert.equal(t.url, `${jira.base}/browse/SHOP-124`);
    assert.equal(t.description, 'When an order has several items, customers cannot cancel the rest.\n\n(image: packing-slip.png)\n\n| Item | State |\n| Mug | Shipped |\n\n'
      + 'Ask Ann Example.\n\n## Acceptance criteria\n\n- Unpicked items can be cancelled.');
    assert.deepEqual(t.criteria, { field: { id: 'customfield_10070', name: 'Acceptance Criteria' }, items: ['From the field', 'Second'] });
    assert.deepEqual(t.comments.map((c) => [c.id, c.author, c.authorKind, c.body]),
      [['1', 'Ann Example', 'person', 'Picked per parcel.'], ['2', 'Jira Automation', 'app', 'Status changed.'], ['4', 'Release Bot', 'app', 'Built.']]);
    assert.deepEqual([t.commentsTotal, t.restrictedComments], [4, 1]);
    assert.deepEqual(t.attachments, [{ id: '10041', name: 'packing-slip.png', mime: 'image/png', bytes: 12, created: '2026-10-21T09:00:00.000+0000' }]);
    assert.deepEqual(t.meta, { project: 'SHOP', projectName: 'Shop web', type: { id: '10001', name: 'Story' }, status: 'In progress', priority: { id: '3', name: 'Medium' } });
    assert.equal(t.fingerprint, fingerprintOf(ISSUE().description));
    const json = JSON.stringify(t);
    for (const secret of ['acc-ann', 'acc-bo', '@example.test', 'avatars.test', '5b10ac8d82e05b22cc7d4ef5', 'tok"']) assert.ok(!json.includes(secret), `${deployment}: no ${secret}`);
    const read = jira.requests.find((r) => r.path === '/rest/api/2/issue/SHOP-124');
    assert.equal(read.query.fields, 'summary,description,issuetype,priority,status,project,attachment,comment,customfield_10070');
    assert.equal(read.query.expand, 'renderedFields,names');
  }
});

test("importTicket: the export setup's criteria field is read when given; without any criteria field, criteria are null", async () => {
  const { jira, src } = await site({ seed: [ISSUE({ custom: { customfield_10071: { name: 'Definition of Done', value: '* Done when shipped',
    rendered: '<ul><li>Done when shipped</li></ul>' } } })] });
  const t = await src.importTicket({ key: 'SHOP-124', criteriaField: 'customfield_10071' });
  assert.deepEqual(t.criteria, { field: { id: 'customfield_10071', name: 'Definition of Done' }, items: ['Done when shipped'] });
  assert.ok(!jira.requests.some((r) => r.path === '/rest/api/2/field'), 'a named field needs no field list');
  const bare = await site({ seed: [ISSUE({ custom: {} })] });
  assert.equal((await bare.src.importTicket({ key: 'SHOP-124' })).criteria, null);
});

test('importTicket: comments past the embedded page are read newest 50 first and answered oldest first', async () => {
  const comments = Array.from({ length: 60 }, (_, i) => ({ id: String(i + 1), author: person('Cy Example', 'acc-cy'),
    created: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T12:00:00.000+0000`, body: `Comment ${i + 1}`, rendered: `<p>Comment ${i + 1}</p>` }));
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, seed: [ISSUE({ comments, embedded: 5 })] });
    const t = await src.importTicket({ key: 'SHOP-124' });
    assert.equal(t.comments.length, 50, deployment);
    assert.deepEqual([t.comments[0].id, t.comments.at(-1).id, t.commentsTotal], ['11', '60', 60]);
    const page = jira.requests.find((r) => r.path === '/rest/api/2/issue/SHOP-124/comment');
    assert.deepEqual([page.query.orderBy, page.query.maxResults, page.query.expand], ['-created', '50', 'renderedBody']);
  }
});

test('importTicket (D8, D15): a site that renders nothing gives the wiki text as plain text; a mention is "someone", never its account id', async () => {
  for (const deployment of BOTH) {
    const wiki = ISSUE({ rendered: null, custom: {},
      description: 'Ask [~accountid:acc-ann] or [~bo.example]; see [the flow|https://docs.acme.test/flow] and [Cy|~accountid:acc-cy].',
      comments: [{ id: '1', author: person('Ann Example', 'acc-ann'), created: '2026-10-21T12:00:00.000+0000', body: 'Thanks [~accountid:acc-ann], done.' }] });
    const { src } = await site({ deployment, seed: [wiki] });
    const t = await src.importTicket({ key: 'SHOP-124' });
    assert.equal(t.description, 'Ask someone or someone; see the flow (https://docs.acme.test/flow) and Cy.', deployment);
    assert.equal(t.comments[0].body, 'Thanks someone, done.', 'a comment without renderedBody falls back to its wiki text');
    const json = JSON.stringify(t);
    for (const secret of ['acc-ann', 'acc-cy', 'bo.example']) assert.ok(!json.includes(secret), `${deployment}: no ${secret}`);
  }
});

test("importTicket: a missing ticket is gone on both; Data Center's 403 is gone too; a Cloud 403 throws Jira's words, never a status or path", async () => {
  for (const deployment of BOTH) {
    const { src } = await site({ deployment, seed: [ISSUE()] });
    assert.deepEqual(await src.importTicket({ key: 'SHOP-999' }), { gone: true }, deployment);
  }
  const dc = await site({ deployment: 'datacenter', seed: [ISSUE()], forbid: ['SHOP-124'] });
  assert.deepEqual(await dc.src.importTicket({ key: 'SHOP-124' }), { gone: true });
  const cloud = await site({ deployment: 'cloud', seed: [ISSUE()], forbid: ['SHOP-124'] });
  await assert.rejects(cloud.src.importTicket({ key: 'SHOP-124' }), (e) => e.kind === 'plugin' && /^Jira refused the request: /.test(e.message) && !/403|\/rest\//.test(e.message));
});

test('htmlToMarkdown (§5): a picture by its alt text, table rows as "| a | b |", people by name only, other links kept', () => {
  assert.equal(htmlToMarkdown('<p><span class="image-wrap"><img src="/rest/api/2/attachment/content/10041" alt="packing-slip.png" /></span></p>'), '(image: packing-slip.png)');
  assert.equal(htmlToMarkdown('<p>Before<img src="x.png"></p>'), 'Before');
  assert.equal(htmlToMarkdown('<table><tbody><tr><th>Item</th><th>State</th></tr><tr><td>Mug</td><td><b>Shipped</b></td></tr></tbody></table>'),
    '| Item | State |\n| Mug | Shipped |');
  assert.equal(htmlToMarkdown('<p>Ask <a href="https://acme.test/secure/ViewProfile.jspa?accountId=5b10" class="user-hover">Ann Example</a>, '
    + '<a href="/jira/people/5b11">Bo Example</a> or <a href="https://acme.test/people/5b12">Cy Example</a>.</p>'), 'Ask Ann Example, Bo Example or Cy Example.');
  assert.equal(htmlToMarkdown('<p>See <a href="https://docs.acme.test/refunds">refunds</a>.</p>'), 'See [refunds](https://docs.acme.test/refunds).');
});
```

- [ ] **Step 3: Run it to see it fail.** `node tools/test.mjs test/jira-source-import.test.mjs` → FAIL (`src.importOptions is not a function`; capabilities lacks `import`).

- [ ] **Step 4: `markup.mjs`.** In `htmlToMarkdown`, insert after the `<pre>` rule and before the `<br>` rule:

```js
    // A6.1 (§5): a picture says where it was (the file itself is one of the ticket's attachments); a table row is one line
    .replace(/<img\b[^>]*>/gi, (tag) => { const alt = /\balt="([^"]*)"/i.exec(tag); return alt && alt[1].trim() ? `(image: ${alt[1].trim()})` : ''; })
    .replace(/<table[^>]*>/gi, '\n\n')
    .replace(/<tr(?=[\s>])[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => `| ${[...row.matchAll(/<t[hd](?=[\s>])[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map((c) => c[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).join(' | ')} |\n`)
    .replace(/<\/table>/gi, '\n\n')
```

and right before the general `<a …href…>` rule:

```js
    // A6.1 (D8, D15): a link to a person (a profile, a mention) is their name only: no account id leaves the connector
    .replace(/<a [^>]*href="[^"]*(?:\/secure\/ViewProfile|\/jira\/people\/|\/people\/)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, '$1')
```

At the end of `markup.mjs` add the fallback for a site that renders nothing (M2 of the plan review: the raw v2 wiki holds a mention as `[~accountid:5b10…]` on Cloud and `[~name]` on Data Center, and D8/D15 let no account id leave the connector):

```js
/** A6.1 (D8, D15): Jira wiki text as plain text, used when a site renders nothing. A mention ([~accountid:…] on Cloud, [~name] on
 *  Data Center) becomes "someone" (the wiki text holds no display name); a link [text|url] becomes "text (url)" for http(s) only, else
 *  its text alone (so [Ann|~accountid:…] is "Ann"). Nothing else is converted: the text stays as Jira holds it. */
export function plainWiki(text) {
  return String(text || '')
    .replace(/\[~[^\]\n]*\]/g, 'someone')
    .replace(/\[([^|\]\n]*)\|([^\]\n]*)\]/g, (_, t, u) => {
      const href = safeHref(u);
      const label = t.trim();
      return href ? (label ? `${label} (${href})` : href) : label;
    })
    .trim();
}
```

Extend the file's header comment: "A6.1: images by their alt text, table rows as `| a | b |` lines, people's links as their names; `plainWiki` for a site that renders nothing." In `index.mjs` import `plainWiki` beside `htmlToMarkdown`.

- [ ] **Step 5: The connector.** In `plugins/jira-source/connector/index.mjs` change `capabilities` to `return { writeBack: yes(inputs?.writeBack), incrementalSync: false, export: true, import: true };`. Above `export default function createTaskSource` add:

```js
// A6.1 (plans/requirements-a61-design.md §4, §5): the optional import ops. They only read; REST v2 as the rest.
const IMPORT_SEARCH_FIELDS = ['summary', 'status', 'issuetype', 'updated'];
const IMPORT_PAGE = 20;
const IMPORT_COMMENTS = 50;
const emailish = (s) => /^[^@\s]+@[^@\s]+$/.test(String(s || ''));
/** D8: an app or automation author: Cloud's accountType, or Data Center's inactive user without an email-shaped name. */
const authorKind = (a) => (a && (a.accountType === 'app' || (a.active === false && !emailish(a.name))) ? 'app' : 'person');
/** A criteria field's text as items: one per list item, else one per line. */
const listItems = (md) => String(md || '').split('\n').map((l) => l.replace(/^\s*(?:[-*+#]|\d+[.)])\s+/, '').trim()).filter(Boolean);
```

Inside `createTaskSource`, after `lastLine`, add:

```js
  const ticketOf = (i) => {
    const f = i.fields || {};
    return { key: i.key, title: f.summary || i.key, url: browse(i.key), type: f.issuetype?.name || null, status: f.status?.name || null, updatedAt: f.updated || null };
  };
  // A6.1 D16: Jira answers 404 for a ticket that does not exist and for one this connection may not see; a Data Center may answer 403
  const notVisible = async (e) => e.status === 404 || (e.status === 403 && (await deployment()) === 'datacenter');
  // D7: the multi-line text field named "Acceptance Criteria", when no criteria field is given (multi-line: a textarea custom
  // field, as exportOptions' criteriaFields filters them)
  async function criteriaFieldId() {
    try {
      const all = await jiraFetch(jira, '/rest/api/2/field');
      const f = (Array.isArray(all) ? all : []).find((x) => x && x.custom && /:textarea$/.test(String(x.schema?.custom || ''))
        && String(x.name || '').trim().toLowerCase() === 'acceptance criteria');
      return f ? String(f.id) : null;
    } catch (e) { log('warn', `the field list could not be read: ${e?.message || e}`); return null; }
  }
```

and after the `findTicket` op:

```js
    // ---- A6.1: import (plans/requirements-a61-design.md §4, §5); read-only, each op through exportOp ----
    importOptions: exportOp(async () => ({ projects: (await projectList()).map((p) => ({ value: p.key, label: `${p.key} — ${p.name}` })) })),
    searchTickets: exportOp(async ({ project, search, cursor } = {}) => {
      const key = pastedKey(search);
      if (key) {
        try { return { tickets: [ticketOf(await issue(key, IMPORT_SEARCH_FIELDS))] }; }
        catch (e) { if (await notVisible(e)) return { tickets: [] }; throw e; }
      }
      const jql = buildJql({ project, jql: '', search });   // never the user's saved filter: the import searches the whole project
      const q = `jql=${enc(jql)}&fields=${IMPORT_SEARCH_FIELDS.join(',')}&maxResults=${IMPORT_PAGE}`;
      if ((await deployment()) === 'cloud') {
        const j = await jiraFetch(jira, `/rest/api/2/search/jql?${q}${cursor ? `&nextPageToken=${enc(cursor)}` : ''}`);
        return { tickets: (j?.issues || []).map(ticketOf), ...(j?.nextPageToken && j?.isLast !== true ? { cursor: j.nextPageToken } : {}) };
      }
      const start = Number(cursor) || 0;
      const j = await jiraFetch(jira, `/rest/api/2/search?${q}&startAt=${start}`);
      const issues = j?.issues || [];
      const next = start + issues.length;
      return { tickets: issues.map(ticketOf), ...(issues.length && next < (j?.total ?? 0) ? { cursor: String(next) } : {}) };
    }),
    importTicket: exportOp(async ({ key, criteriaField } = {}) => {
      const k = requireKey(key);
      const named = /^customfield_\d+$/.test(String(criteriaField || '')) ? String(criteriaField) : await criteriaFieldId();
      const fields = ['summary', 'description', 'issuetype', 'priority', 'status', 'project', 'attachment', 'comment', ...(named ? [named] : [])];
      let i;
      try { i = await issue(k, fields, 'renderedFields,names'); }
      catch (e) { if (await notVisible(e)) return { gone: true }; throw e; }
      const f = i.fields || {};
      const r = i.renderedFields || {};
      // the rendered HTML (the same on Cloud and Data Center) as Markdown; the raw wiki text as plain text when a site renders
      // nothing, through plainWiki so a mention's account id never leaves the connector (D8, D15)
      const description = r.description ? htmlToMarkdown(r.description) : plainWiki(f.description);
      let criteria = null;
      if (named && (r[named] || f[named])) {
        const items = listItems(r[named] ? htmlToMarkdown(r[named]) : String(f[named]));
        if (items.length) criteria = { field: { id: named, name: (i.names && i.names[named]) || named }, items };
      }
      let raw = Array.isArray(f.comment?.comments) ? f.comment.comments : [];
      const total = Number.isFinite(Number(f.comment?.total)) ? Number(f.comment.total) : raw.length;
      // only a comment Jira rendered: one without (null or absent) falls back to its wiki text below
      const rendered = new Map((r.comment?.comments || []).filter((c) => c && c.body).map((c) => [String(c.id), c.body]));
      if (total > raw.length) {
        const page = await jiraFetch(jira, `/rest/api/2/issue/${enc(k)}/comment?orderBy=-created&maxResults=${IMPORT_COMMENTS}&expand=renderedBody`);
        raw = [...(Array.isArray(page?.comments) ? page.comments : [])].reverse();   // the newest 50, oldest first
        for (const c of raw) if (c.renderedBody) rendered.set(String(c.id), c.renderedBody);
      }
      const visible = raw.filter((c) => !c.visibility);   // a comment restricted to a group or role is never offered (D8)
      const comments = visible.slice(-IMPORT_COMMENTS).map((c) => ({ id: String(c.id), author: c.author?.displayName || 'Someone', authorKind: authorKind(c.author),
        created: c.created || null, body: rendered.has(String(c.id)) ? htmlToMarkdown(rendered.get(String(c.id))) : plainWiki(c.body) }));
      return {
        key: i.key, url: browse(i.key), title: f.summary || i.key, description, criteria, comments, commentsTotal: total,
        restrictedComments: raw.length - visible.length,
        attachments: (Array.isArray(f.attachment) ? f.attachment : []).map((a) => ({ id: String(a.id), name: String(a.filename || ''), mime: a.mimeType || '',
          bytes: Number(a.size) || 0, created: a.created || null })),
        meta: { project: f.project?.key || null, projectName: f.project?.name || null,
          type: f.issuetype ? { id: String(f.issuetype.id), name: f.issuetype.name } : null, status: f.status?.name || null,
          priority: f.priority ? { id: String(f.priority.id), name: f.priority.name } : null },
        fingerprint: fingerprintOf(f.description),   // as ticketState computes it, so A6's edited check holds (D11)
      };
    }),
```

Extend the file's header comment: "A6.1 (plans/requirements-a61-design.md §5): the optional import ops read a ticket — its rendered description as Markdown, a criteria field, the visible comments by display name only, the attachments' metadata — and download one attachment into the path the host names."

- [ ] **Step 6: The export test's capabilities.** In `test/jira-source-export.test.mjs`, the first test's two assertions gain `import: true` (`{ writeBack: true, incrementalSync: false, export: true, import: true }` and `{ writeBack: false, incrementalSync: false, export: true, import: true }`) and its name reads "capabilities: export and import are on; …".

- [ ] **Step 7: Run the tests.** `node tools/test.mjs test/jira-source-import.test.mjs`, then `node tools/test.mjs test/jira-source-export.test.mjs`, then `node tools/test.mjs test/jira-source-connector.test.mjs` → all PASS. If the description assertion differs only in blank lines, print `JSON.stringify(t.description)` and fix the markup rule (not the assertion): one blank line between blocks, none between table rows.

- [ ] **Step 8: Commit.**

```bash
git add plugins/jira-source/connector/index.mjs plugins/jira-source/connector/markup.mjs test/helpers/fake-jira.mjs test/jira-source-import.test.mjs test/jira-source-export.test.mjs
git commit -m "Requirements: jira-source reads a ticket for import (Cloud and Data Center)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Jira connector downloads one attachment into the host's folder

**Files:**
- Modify: `plugins/jira-source/connector/jira-api.mjs` (`jiraDownload`)
- Modify: `plugins/jira-source/connector/index.mjs` (`downloadAttachment`; `deps.allowHttpRedirect`)
- Modify: `test/helpers/fake-jira.mjs` (attachment content on the site, a "media" server for Cloud's signed address)
- Modify: `plugins/jira-source/README.md` (an Import section)
- Create: `test/jira-source-download.test.mjs`

**Interfaces:**
- Consumes: `authHeader`, `err` (`jira-api.mjs`); the connector's `issue`, `requireKey`, `exportOp`.
- Produces (`jira-api.mjs`): `jiraDownload(jira, content, { dest, maxBytes, allowHttpRedirect = false }) → Promise<{ bytes } | { tooLarge: true, bytes } | { gone: true, forbidden?: true }>`; throws `kind: 'auth'` on 401, `'rate-limit'` on 429, `'network'` on a failed or stopped transfer, `'plugin'` for an address it refuses (not on the site, not `https:` after leaving it, a second redirect) or an existing file at `dest`. On every failure it deletes what it wrote; it never deletes a file it did not create.
- Produces (connector op): `downloadAttachment({ key, id, maxBytes, dest }) → { name, mime, bytes } | { tooLarge: true, bytes } | { gone: true, forbidden?: true }`; `createTaskSource(ctx, { allowHttpRedirect: true })` lets a test follow Cloud's redirect to a plain-http fake (never set outside tests).
- Produces (`test/helpers/fake-jira.mjs`): `startFakeJira` answers `{ …, media: { base, requests } }`; a seeded attachment may carry `body: Buffer`; options `redirectTwice`, `contentElsewhere`, `contentStatus` (the content route answers that status, e.g. 401, 403, 404).

- [ ] **Step 1: Extend the fake Jira.** In `test/helpers/fake-jira.mjs`:
  - add `redirectTwice: false, contentElsewhere: false, contentStatus: null` to `opt`'s defaults, with the comment `// A6.1 downloads: redirectTwice — the signed address redirects again; contentElsewhere — an attachment's content URL on another origin; contentStatus — the content route answers that status.`
  - before `const server = createServer(…)`, a media server that refuses any Authorization header, and a helper that streams a body in two parts without a length:

```js
  // A6.1: Cloud answers an attachment's content with a 303 to a signed address on another origin, which wants no Authorization header.
  const mediaRequests = [];
  let mediaBase = '';
  const findAttachment = (id) => [...seeded.values()].flatMap((s) => s.attachments || []).find((x) => x.id === id);
  const stream = (res, a) => {   // no content-length: the stream cap is what stops a body larger than its metadata said
    res.writeHead(200, { 'content-type': a.mimeType });
    res.write(a.body.subarray(0, Math.ceil(a.body.length / 2)));
    return res.end(a.body.subarray(Math.ceil(a.body.length / 2)));
  };
  const media = createServer((req, res) => {
    mediaRequests.push({ path: req.url, auth: req.headers.authorization || null });
    if (req.headers.authorization) return send(res, 400, { error: 'An Authorization header is not allowed here.' });
    const id = (/^\/file\/(\d+)/.exec(req.url) || [])[1];
    if (opt.redirectTwice) { res.writeHead(302, { location: `${mediaBase}/file/${id}?again=1` }); return res.end(); }
    const a = findAttachment(id);
    return a ? stream(res, a) : send(res, 404, {});
  });
  await new Promise((r) => media.listen(0, '127.0.0.1', r));
  mediaBase = `http://127.0.0.1:${media.address().port}`;
  const contentOf = (a) => (opt.contentElsewhere ? `${mediaBase}/file/${a.id}`
    : cloud ? `${base}/rest/api/2/attachment/content/${a.id}` : `${base}/secure/attachment/${a.id}/${encodeURIComponent(a.filename)}`);
```

  - in the request handler, right after the auth check line (`if (opt.refuseToken || req.headers.authorization !== auth) return send(res, 401, …);`), declare `let m;` and add the site's content routes (then change the later `let m = /^\/rest\/api\/2\/issue\/createmeta…/` to `m = …`):

```js
    m = /^\/rest\/api\/2\/attachment\/content\/(\d+)$/.exec(p) || /^\/secure\/attachment\/(\d+)\/.+$/.exec(p);
    if (m) {
      if (opt.contentStatus) return send(res, opt.contentStatus, { errorMessages: ['Not allowed.'], errors: {} });
      const a = findAttachment(m[1]);
      if (!a) return send(res, 404, {});
      if (cloud) { res.writeHead(303, { location: `${mediaBase}/file/${a.id}?token=signed` }); return res.end(); }
      return stream(res, a);
    }
```

  - the seeded read passes the addresses: `seededAnswer(seeded.get(m[1]), url, contentOf)`.
  - the returned object gains `media: { get base() { return mediaBase; }, requests: mediaRequests }`, and `close` closes both servers: `close: () => new Promise((r) => { server.closeAllConnections?.(); media.closeAllConnections?.(); media.close(() => server.close(r)); })`.

- [ ] **Step 2: Write the failing test** `test/jira-source-download.test.mjs`:

```js
// test/jira-source-download.test.mjs — jira-source's downloadAttachment against a fake Jira over real HTTP (plans/requirements-a61-design.md
// D9, D15, D16, §5): the Authorization header on the site only, Cloud's one redirect to a signed address without it, a second redirect and
// another origin refused, the size checked before and while streaming, an existing file never overwritten or deleted, nothing left at dest.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import createTaskSource from '../plugins/jira-source/connector/index.mjs';
import { startFakeJira } from './helpers/fake-jira.mjs';

const open = [];
const dirs = [];
after(async () => { for (const j of open) await j.close(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const ISSUE = (attachments) => ({ key: 'SHOP-124', project: 'SHOP', projectName: 'Shop web', summary: 'Partial cancel', description: '', rendered: '',
  type: { id: '10001', name: 'Story' }, status: 'In progress', priority: null, updated: '2026-10-25T12:00:00.000+0000', comments: [], custom: {}, attachments });
const SLIP = (over = {}) => ({ id: '10041', filename: 'packing-slip.png', mimeType: 'image/png', size: PNG.length, created: '2026-10-21T09:00:00.000+0000', body: PNG, ...over });
async function site(o = {}, deps = { allowHttpRedirect: true }) {
  const jira = await startFakeJira({ seed: [ISSUE(o.attachments || [SLIP()])], ...o });
  open.push(jira);
  const cloud = (o.deployment || 'cloud') === 'cloud';
  const map = new Map();
  const ctx = { apiVersion: 5, profile: 'acme', log: () => {}, config: { baseUrl: jira.base, email: cloud ? 'ann@acme.test' : '', token: 'tok' },
    state: { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); } } };
  return { jira, src: createTaskSource(ctx, deps) };
}
const dest = () => { const d = mkdtempSync(join(tmpdir(), 'worca-jira-dl-')); dirs.push(d); return join(d, 'body.part'); };
const MAX = 25 * 1024 * 1024;

test('Cloud: the site answers with the header, then one redirect to the signed address without it; the body lands at dest', async () => {
  const { jira, src } = await site();
  const to = dest();
  assert.deepEqual(await src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: to }), { name: 'packing-slip.png', mime: 'image/png', bytes: PNG.length });
  assert.deepEqual(readFileSync(to), PNG);
  const first = jira.requests.find((r) => r.path === '/rest/api/2/attachment/content/10041');
  assert.ok(first && /^Basic /.test(first.auth), 'the site gets the Authorization header');
  assert.deepEqual(jira.media.requests.map((r) => r.auth), [null], 'the signed address never does');
});

test("Data Center: the site serves /secure/attachment itself, with the bearer token; the answer's bytes are the file's size", async () => {
  const { jira, src } = await site({ deployment: 'datacenter' });
  const to = dest();
  const r = await src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: to });
  assert.equal(r.bytes, readFileSync(to).length);
  assert.ok(jira.requests.some((x) => x.path === '/secure/attachment/10041/packing-slip.png' && x.auth === 'Bearer tok'));
  assert.equal(jira.media.requests.length, 0);
});

test('a second redirect, a plain-http redirect without the test switch and a content address on another origin are refused; nothing is left at dest', async () => {
  const twice = await site({ redirectTwice: true });
  const a = dest();
  await assert.rejects(twice.src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: a }), (e) => e.kind === 'plugin');
  assert.equal(existsSync(a), false);
  const strict = await site({}, {});
  const b = dest();
  await assert.rejects(strict.src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: b }), (e) => e.kind === 'plugin');
  assert.equal(strict.jira.media.requests.length, 0, 'an http address off the site is never asked');
  assert.equal(existsSync(b), false);
  const elsewhere = await site({ contentElsewhere: true });
  const c = dest();
  await assert.rejects(elsewhere.src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: c }), (e) => e.kind === 'plugin');
  assert.equal(elsewhere.jira.media.requests.length, 0, 'a content address on another origin is refused before any request');
  assert.equal(existsSync(c), false);
});

test('the size: over maxBytes on the metadata is tooLarge before any download; a body that grows past it is cut and deleted', async () => {
  const big = await site({ attachments: [SLIP({ size: 40 * 1024 * 1024 })] });
  const a = dest();
  assert.deepEqual(await big.src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: a }), { tooLarge: true, bytes: 40 * 1024 * 1024 });
  assert.ok(!big.jira.requests.some((r) => /attachment\/content/.test(r.path)), 'no download was started');
  const liar = await site({ deployment: 'datacenter', attachments: [SLIP({ size: 4 })] });
  const b = dest();
  const r = await liar.src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: 8, dest: b });
  assert.equal(r.tooLarge, true);
  assert.ok(r.bytes > 8);
  assert.equal(existsSync(b), false, 'the partial file is deleted');
});

test('an existing file at dest is never overwritten or deleted', async () => {
  const { src } = await site({ deployment: 'datacenter' });
  const to = dest();
  writeFileSync(to, 'mine');
  await assert.rejects(src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: to }), (e) => e.kind === 'plugin');
  assert.equal(readFileSync(to, 'utf8'), 'mine');
});

test('401 throws auth; 403 is gone and forbidden; 404 and an attachment not on the ticket are gone; a relative dest is refused; nothing at dest', async () => {
  for (const [status, want] of [[401, null], [403, { gone: true, forbidden: true }], [404, { gone: true }]]) {
    const { src } = await site({ deployment: 'datacenter', contentStatus: status });
    const to = dest();
    if (want) assert.deepEqual(await src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: to }), want, String(status));
    else await assert.rejects(src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: to }), (e) => e.kind === 'auth');
    assert.equal(existsSync(to), false, String(status));
  }
  const { src } = await site();
  assert.deepEqual(await src.downloadAttachment({ key: 'SHOP-124', id: '99999', maxBytes: MAX, dest: dest() }), { gone: true });
  await assert.rejects(src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: 'relative/body.part' }), (e) => e.kind === 'plugin');
});
```

- [ ] **Step 3: Run it to see it fail.** `node tools/test.mjs test/jira-source-download.test.mjs` → FAIL (`src.downloadAttachment is not a function`).

- [ ] **Step 4: `jira-api.mjs`.** Add at the top `import { createWriteStream, rmSync } from 'node:fs';`, `import { Readable, Transform } from 'node:stream';`, `import { pipeline } from 'node:stream/promises';`, and at the end:

```js
/**
 * A6.1 (plans/requirements-a61-design.md D9, D15, §5): one attachment's body streamed into `dest`, a path the host made. Only the
 * site's own content address, with the profile's auth and `redirect: 'manual'`; one redirect at most, to the site with the header,
 * elsewhere only over https: (or plain http when a test allows it) and without it. The size is checked on the response and while
 * it streams; `dest` is created exclusively and deleted on any failure, never a file this call did not create. It has no timeout
 * of its own: the host's callSource kills the child at DOWNLOAD_TIMEOUT_MS (120 s), and a partial body.part left by that kill is
 * removed with the host's single-use folder (the contract, D9).
 */
export async function jiraDownload(jira, content, { dest, maxBytes, allowHttpRedirect = false } = {}) {
  const site = new URL(jira.base).origin;
  let url;
  try { url = new URL(String(content || '')); } catch { throw err('plugin', 'the attachment has no address Jira serves'); }
  if (url.origin !== site) throw err('plugin', "the attachment's address is not on this Jira site");
  const get = (u, withAuth) => jira.fetch(u.href, { method: 'GET', redirect: 'manual',
    headers: { accept: '*/*', 'user-agent': 'worca-cc-jira-source', ...(withAuth ? { authorization: authHeader(jira) } : {}) } });
  const drop = async (r) => { try { await r.body?.cancel(); } catch { /* nothing to read */ } };
  let res;
  try {
    res = await get(url, true);
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location') ? new URL(res.headers.get('location'), url) : null;
      if (!next) throw err('plugin', 'Jira redirected the file without saying where');
      const same = next.origin === site;
      if (!same && next.protocol !== 'https:' && !(allowHttpRedirect && next.protocol === 'http:')) throw err('plugin', 'Jira redirected the file to an address that is not https');
      await drop(res);
      res = await get(next, same);
      if (res.status >= 300 && res.status < 400) { await drop(res); throw err('plugin', 'Jira redirected the file more than once'); }
    }
  } catch (e) {
    if (e && e.kind) throw e;
    throw err('network', `Jira unreachable: ${e?.message || e}`);
  }
  if (res.status === 401) { await drop(res); throw err('auth', 'Jira token invalid or expired (or the email does not match it)', { status: 401 }); }
  if (res.status === 403 || res.status === 404) { await drop(res); return { gone: true, ...(res.status === 403 ? { forbidden: true } : {}) }; }
  if (res.status === 429) { await drop(res); throw err('rate-limit', 'Jira rate limit'); }
  if (!res.ok || !res.body) { await drop(res); throw err('plugin', `Jira did not send the file (${res.status})`, { status: res.status }); }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) { await drop(res); return { tooLarge: true, bytes: declared }; }
  let written = 0;
  let over = false;
  const counter = new Transform({ transform(chunk, _enc, cb) {
    written += chunk.length;
    if (written > maxBytes) { over = true; cb(new Error('the file is larger than allowed')); } else cb(null, chunk);
  } });
  let created = false;
  const out = createWriteStream(dest, { flags: 'wx', mode: 0o600 });
  out.once('open', () => { created = true; });
  try {
    await pipeline(Readable.fromWeb(res.body), counter, out);
  } catch (e) {
    if (created) { try { rmSync(dest, { force: true }); } catch { /* the host removes its folder anyway */ } }
    if (e && e.code === 'EEXIST') throw err('plugin', 'a file is already where the download should go');
    if (over) return { tooLarge: true, bytes: written };
    throw err('network', `the download stopped: ${e?.message || e}`);
  }
  return { bytes: written };
}
```

- [ ] **Step 5: The op.** In `index.mjs` add `import { isAbsolute } from 'node:path';`, import `jiraDownload` beside `jiraFetch`, and after `importTicket`:

```js
    downloadAttachment: exportOp(async ({ key, id, maxBytes, dest } = {}) => {
      const k = requireKey(key);
      if (typeof dest !== 'string' || !isAbsolute(dest)) throw Object.assign(new Error('dest must be an absolute path the host made'), { kind: 'plugin' });
      const max = Number(maxBytes) > 0 ? Number(maxBytes) : 25 * 1024 * 1024;
      let meta;
      try { meta = await issue(k, ['attachment']); }
      catch (e) { if (e.status === 404) return { gone: true }; if (e.status === 403) return { gone: true, forbidden: true }; throw e; }
      const a = (meta?.fields?.attachment || []).find((x) => String(x.id) === String(id));
      if (!a) return { gone: true };   // the attachment must belong to this ticket
      if (Number(a.size) > max) return { tooLarge: true, bytes: Number(a.size) };   // checked before any download
      const r = await jiraDownload(jira, a.content, { dest, maxBytes: max, allowHttpRedirect: deps.allowHttpRedirect === true });
      if (r.gone || r.tooLarge) return r;
      return { name: String(a.filename || ''), mime: a.mimeType || '', bytes: r.bytes };   // never the body in the frame
    }),
```

- [ ] **Step 6: The README.** In `plugins/jira-source/README.md`, after the Export section, add:

```markdown
## Import

Worca's Requirements page can start a feature from a Jira issue (**New feature › From a ticket…**), through the same
connection (profile); the token never leaves the plugin and nothing is written to Jira. The plugin answers `capabilities()`
with `import: true` and implements the optional import ops:

- **importOptions** — the projects, for the picker's project select.
- **searchTickets** — the project's most recently updated issues, or a text search (`text ~ "…"`), 20 a page; a pasted key
  or issue link finds that issue in any project. Never your saved JQL filter.
- **importTicket** — the summary, the rendered description as Markdown (an image becomes "(image: <name>)", a table row
  "| a | b |", a person's link their name), the criteria from a multi-line text field (the export setup's criteria field, else
  one named "Acceptance Criteria"), the newest 50 comments with the author's display name only (comments restricted to a
  group or role are left out and counted; app and automation authors are marked), the attachments' names and sizes, and the
  description's fingerprint (so a later export can tell when it was edited in Jira).
- **downloadAttachment** — one attachment the product owner picked, into a file the host names. Only from the site's own
  address with the connection's auth; Jira Cloud's one redirect to its signed media address is followed over https without
  the token. The size is checked before and during the download (25 MB), and a partial file is deleted.

A 404 (and a Data Center 403) is "not found, or this connection cannot see it".
```

- [ ] **Step 7: Run the tests.** One at a time: `node tools/test.mjs test/jira-source-download.test.mjs`, `node tools/test.mjs test/jira-source-import.test.mjs`, `node tools/test.mjs test/jira-source-export.test.mjs` → all PASS.

- [ ] **Step 8: Commit.**

```bash
git add plugins/jira-source/connector/jira-api.mjs plugins/jira-source/connector/index.mjs plugins/jira-source/README.md test/helpers/fake-jira.mjs test/jira-source-download.test.mjs
git commit -m "Requirements: jira-source downloads a picked attachment into the host's folder" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Start from a ticket (the server)

### Task 6: The import service — sources, defaults, projects, search, preview

**Files:**
- Create: `src/core/requirements/import.mjs`
- Create: `test/requirements-import.test.mjs`

**Interfaces:**
- Consumes: `trackersWith`, `defaultConnection`, `connectionLabel`, `sameConn`, `firstLine` (`export.mjs`, Task 3) and A6's `reachSentence` (`export.mjs`, already exported); `getExportSetup`, `linkByTicket` (`store.mjs`, Task 1); `processTicket`, `pickDefaults`, `IMPORT_LIMITS` (`ticket-import.mjs`, Task 2); `exportDate` (`ticket.mjs`); `callSource` (`plugin-shim.mjs`, or `d.callSource`).
- Produces (`import.mjs`):
  - `IMPORT_TIMEOUT_MS = 60_000`
  - `importSources(d) → Promise<Source[]>` (= `trackersWith('import', d)`)
  - No reach wording of its own (design U1): a tracker failure is A6's `reachSentence(name, err)`, so Import and Export read alike for the same connection.
  - `importDefaults(scope, sources, { memberKeys }) → { defaultConnection: Conn | null, defaultProject: string | null }`
  - `importView(scope, { memberKeys }, d) → { sources: [{ plugin, sourceId, name, profiles: [{ id, label }] }], defaultConnection, defaultProject }`
  - `importOptions(scope, { plugin, sourceId, profile }, d) → { projects: [{ value, label }] }`
  - `searchTickets(scope, { plugin, sourceId, profile, project?, search?, cursor? }, d) → { tickets: [{ key, title, url, type, status, updatedOn, linkedTo: { id, title } | null }], cursor? }`
  - `previewImport(scope, { plugin, sourceId, profile, key, formFiles?: { count, bytes } }, d) → Preview` where `Preview` is `pickDefaults(processTicket(…))` without `fingerprint`, with `descriptionFile: { name, bytes } | null`, `connection` (the profile's label) and `linkedTo`.
  - Internal, used again by Task 9: `sourceFor(body, d)`, `keyOf(v)`, `readTicket(d, t, conn, key, scope)`.
  - Errors: `BAD_REQUEST` "Choose a connection from the list." / "key must be a ticket key such as SHOP-124"; `NOT_FOUND` with `data.gone: true` "SHOP-999 was not found in Jira, or this connection cannot see it."; `TRACKER` with `data.kind` and A6's `reachSentence`, or "Jira cannot import any more." (`unimplemented`). The log keeps `firstLine(err)` only.

- [ ] **Step 1: Write the failing test** `test/requirements-import.test.mjs`:

```js
// test/requirements-import.test.mjs — the import service (plans/requirements-a61-design.md D2–D9, D12, D16) in mock mode: the real callSource
// with the shim's canned answers, jira-source linked with two connections. No tracker, no model, nothing written by a preview.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { createProfile } from '../src/core/plugin-config.mjs';
import { callSource, setMockSourceResponses, PluginOpError } from '../src/core/plugin-shim.mjs';
import { createFeature, saveExportLink, listFeatures } from '../src/core/requirements/store.mjs';
import { saveSetup, _resetExportCaches } from '../src/core/requirements/export.mjs';
import { IMPORT_TIMEOUT_MS, importView, importOptions, searchTickets, previewImport } from '../src/core/requirements/import.mjs';

useTempHome(after, 'worca-req-import-');
const prevMock = process.env.WORCA_MOCK;
process.env.WORCA_MOCK = '1';
after(() => { if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock; setMockSourceResponses(null); });

const SCOPE = { scopeType: 'project', scopeKey: 'shop-1' };
const ACME = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const seen = [];
const d = { callSource: (o) => { seen.push(o); return callSource(o); } };
const reset = () => { seen.length = 0; setMockSourceResponses(null); };

before(async () => {
  await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url)));
  createProfile('jira-source', 'acme', 'acme.atlassian.net (Cloud)');
  createProfile('jira-source', 'beta', 'jira.beta.test (Data Center)');
  _resetExportCaches();
});

test("importView (D2, D3): the sources that can import; defaults from an export setup on an importing connection, else A6's default and All projects", async () => {
  reset();
  assert.equal(IMPORT_TIMEOUT_MS, 60_000);
  const v0 = await importView(SCOPE, {}, d);
  assert.deepEqual(v0.sources, [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira',
    profiles: [{ id: 'acme', label: 'acme.atlassian.net (Cloud)' }, { id: 'beta', label: 'jira.beta.test (Data Center)' }] }]);
  assert.deepEqual([v0.defaultConnection, v0.defaultProject], [ACME, null]);
  await saveSetup(SCOPE, { ...ACME, profile: 'beta', project: 'OPS', projectName: 'OPS — Operations', issueType: '10001', issueTypeName: 'Story' }, { by: 'po' }, d);
  const v1 = await importView(SCOPE, {}, d);
  assert.deepEqual([v1.defaultConnection, v1.defaultProject], [{ ...ACME, profile: 'beta' }, 'OPS']);
  assert.equal(seen.filter((c) => c.op !== 'capabilities').length, 0, 'no tracker call but the probe');
});

test('importView: a source whose capabilities do not say import is not offered', async () => {
  reset();
  _resetExportCaches();
  setMockSourceResponses({ capabilities: { writeBack: true, export: true } });
  assert.deepEqual((await importView(SCOPE, {}, d)).sources, []);
  setMockSourceResponses(null);
  _resetExportCaches();
});

test("importOptions and searchTickets (D4, D12): the connection's projects; the search through it within a minute, each ticket with the feature it follows", async () => {
  reset();
  const f = createFeature({ ...SCOPE, title: 'Cancel an order before it ships', description: 'x' });
  saveExportLink(f.seq, { ...ACME, trackerProject: 'SHOP', key: 'SHOP-123', url: 'https://mock.test/browse/SHOP-123' });
  assert.deepEqual((await importOptions(SCOPE, ACME, d)).projects.map((p) => p.value), ['SHOP', 'OPS']);
  const r = await searchTickets(SCOPE, { ...ACME, project: 'SHOP', search: 'cancel' }, d);
  assert.deepEqual(r.tickets.map((t) => [t.key, t.updatedOn, t.linkedTo && t.linkedTo.id]),
    [['SHOP-123', '26 Oct', f.id], ['SHOP-124', '25 Oct', null], ['SHOP-131', '24 Oct', null], ['SHOP-98', '12 Oct', null]]);
  assert.deepEqual(r.tickets[1], { key: 'SHOP-124', title: 'Partial cancel for multi-item orders', url: 'https://mock.test/browse/SHOP-124', type: 'Story',
    status: 'In progress', updatedOn: '25 Oct', linkedTo: null });
  const call = seen.find((c) => c.op === 'searchTickets');
  assert.deepEqual([call.profile, call.timeoutMs, call.args], ['acme', 60_000, { project: 'SHOP', search: 'cancel' }]);
  assert.equal((await searchTickets(SCOPE, { ...ACME, profile: 'beta' }, d)).tickets[0].linkedTo, null, 'linked through another connection is no link');
  await assert.rejects(searchTickets(SCOPE, { ...ACME, profile: 'gamma' }, d), (e) => e.code === 'BAD_REQUEST' && e.message === 'Choose a connection from the list.');
});

test("a tracker failure (D16, U1): A6's reach sentence — fixed phrases for auth and timeout, the connector's own sentence when it is product copy, else \"the Jira plugin stopped unexpectedly\"; the log keeps the first line only; an op the connector lost says it cannot import", async () => {
  reset();
  const logged = [];
  const was = console.error;
  console.error = (...a) => { logged.push(a.join(' ')); };
  try {
    for (const [kind, message, reason] of [
      ['auth', 'Jira token invalid or expired', 'the API token was refused'],
      ['timeout', 'plugin "jira-source" op "searchTickets" exceeded 60000ms', 'it did not answer within a minute'],
      ['network', 'Jira unreachable: fetch failed.', 'Jira unreachable: fetch failed'],
      ['plugin', 'Jira refused the request: The value \'SHOP\' does not exist for the field \'project\'.',
        "Jira refused the request: The value 'SHOP' does not exist for the field 'project'"],
      ['plugin', 'Jira 500: secret detail (GET /rest/api/2/search)', 'the Jira plugin stopped unexpectedly'],
      ['plugin', 'TypeError: x is not a function\n    at run (file:///plugin/index.mjs:1:1)\nTOKEN=abc123', 'the Jira plugin stopped unexpectedly']]) {
      setMockSourceResponses({ searchTickets: () => { throw new PluginOpError(kind, message); } });
      await assert.rejects(searchTickets(SCOPE, ACME, d), (e) => e.code === 'TRACKER' && e.message === `Worca could not reach Jira: ${reason}.`
        && e.data.kind === kind && !/secret|rest\/|TOKEN/.test(e.message), `${kind}: ${reason}`);
    }
    assert.ok(logged.some((l) => /secret detail/.test(l)), 'the raw first line goes to the log');
    assert.ok(logged.some((l) => /TypeError: x is not a function/.test(l)), 'the first line of a multi-line message is logged');
    assert.ok(!logged.some((l) => /TOKEN=|file:\/\/\/plugin/.test(l)), 'never the lines after it (M3: no plugin stderr in the log)');
    setMockSourceResponses({ searchTickets: undefined });
    await assert.rejects(searchTickets(SCOPE, ACME, d), (e) => e.code === 'TRACKER' && e.message === 'Jira cannot import any more.');
  } finally { console.error = was; setMockSourceResponses(null); }
});

test("previewImport (D5–D9): the ticket as the preview shows it, its default ticks, the connection, a setup's criteria field on the same connection; nothing written", async () => {
  reset();
  const before = listFeatures({ archived: true }).length;
  await saveSetup(SCOPE, { ...ACME, project: 'SHOP', projectName: 'SHOP — Shop web', issueType: '10001', issueTypeName: 'Story',
    criteria: { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' } }, { by: 'po' }, d);
  const p = await previewImport(SCOPE, { ...ACME, key: 'shop-124' }, d);
  assert.deepEqual(seen.find((c) => c.op === 'importTicket').args, { key: 'SHOP-124', criteriaField: 'customfield_10070' });
  assert.deepEqual([p.key, p.tracker, p.connection, p.title], ['SHOP-124', 'Jira', 'acme.atlassian.net (Cloud)', 'Partial cancel for multi-item orders']);
  assert.ok(!/Acceptance criteria/.test(p.description), 'the criteria section is out of the description');
  assert.deepEqual([p.criteria.from, p.criteria.items.length, p.criteria.picked], ['section', 3, [true, true, true]]);
  assert.deepEqual(p.comments.map((c) => c.picked), [true, true, true, false, true, true], 'every comment by a person; the app one unticked');
  assert.equal(p.redacted, 1);
  assert.ok(p.comments.at(-1).body.includes('ghp_<redacted>'));
  assert.deepEqual(p.attachments.map((a) => [a.name, a.picked, a.refused]), [['packing-slip.png', true, null], ['partial-cancel-flow.pdf', true, null],
    ['support-macro.txt', true, null], ['refund-matrix.xlsx', false, 'Not offered: Worca reads text, images and PDF. Save it as PDF to attach it here.'],
    ['pick-route-scan.pdf', false, 'Not offered: it is over 25 MB.']]);
  assert.deepEqual([p.commentsTotal, p.restrictedComments, p.olderComments, p.linkedTo, p.descriptionFile, 'fingerprint' in p], [7, 1, 0, null, null, false]);
  const other = await previewImport(SCOPE, { ...ACME, profile: 'beta', key: 'SHOP-124' }, d);
  assert.deepEqual(seen.filter((c) => c.op === 'importTicket').at(-1).args, { key: 'SHOP-124' }, 'a setup on another connection names no field');
  assert.equal(other.connection, 'jira.beta.test (Data Center)');
  assert.equal(listFeatures({ archived: true }).length, before, 'nothing created');
});

test("previewImport: the caps count the form's own files (D9); a ticket another feature follows says so (D12); a gone key and a bad key", async () => {
  reset();
  const full = await previewImport(SCOPE, { ...ACME, key: 'SHOP-124', formFiles: { count: 8, bytes: 0 } }, d);
  assert.deepEqual(full.attachments.slice(0, 3).map((a) => [a.picked, a.capped]), [[true, null], [false, 'files'], [false, 'files']]);
  const linked = await previewImport(SCOPE, { ...ACME, key: 'SHOP-123' }, d);
  assert.equal(linked.linkedTo.title, 'Cancel an order before it ships');
  await assert.rejects(previewImport(SCOPE, { ...ACME, key: 'SHOP-999' }, d), (e) => e.code === 'NOT_FOUND' && e.data.gone === true
    && e.message === 'SHOP-999 was not found in Jira, or this connection cannot see it.');
  await assert.rejects(previewImport(SCOPE, { ...ACME, key: 'not a key' }, d), (e) => e.code === 'BAD_REQUEST' && e.message === 'key must be a ticket key such as SHOP-124');
});
```

- [ ] **Step 2: Run it to see it fail.** `node tools/test.mjs test/requirements-import.test.mjs` → FAIL (`Cannot find module …/import.mjs`).

- [ ] **Step 3: Write** `src/core/requirements/import.mjs`:

```js
// src/core/requirements/import.mjs
// Start a feature from a tracker ticket (plans/requirements-a61-design.md): the sources that can import, where the picker starts,
// the projects and the search, the preview (D5–D9) and the create (D10–D12, below). The Requirements code knows only "a source that
// can import" (D2): every call runs here, server-side, through callSource with the connection's profile (D15). Nothing is written to
// the tracker. A failure is A6's reach sentence (design U1: Import and Export read alike); the log keeps its first line only.
import { callSource as shimCallSource } from '../plugin-shim.mjs';
import { RequirementsError } from './spec.mjs';
import { getExportSetup, linkByTicket } from './store.mjs';
import { trackersWith, defaultConnection, connectionLabel, sameConn, reachSentence, firstLine } from './export.mjs';
import { exportDate } from './ticket.mjs';
import { IMPORT_LIMITS, processTicket, pickDefaults } from './ticket-import.mjs';

/** D17: importOptions, searchTickets and importTicket (which may page through comments). */
export const IMPORT_TIMEOUT_MS = 60_000;

const callOf = (d) => (d && typeof d.callSource === 'function' ? d.callSource : shimCallSource);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const httpUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/i;

/** D2: the sources that can import (A6's probe, its `import` answer). */
export const importSources = (d = {}) => trackersWith('import', d);

/** One import op through the connection, in IMPORT_TIMEOUT_MS. Any failure is A6's sentence (D16, U1: reachSentence turns a
 *  message that is not product copy into a fixed phrase); the log keeps the first line only (M3: never a plugin's stderr). */
async function trackerCall(d, name, conn, op, args) {
  try {
    return await callOf(d)({ plugin: conn.plugin, sourceId: conn.sourceId, profile: conn.profile || undefined, op, args, timeoutMs: IMPORT_TIMEOUT_MS });
  } catch (err) {
    const kind = (err && err.kind) || 'plugin';
    console.error(`requirements: import op ${op} via ${conn.plugin}/${conn.sourceId} failed (${kind}):`, firstLine(err));
    if (kind === 'unimplemented') throw new RequirementsError('TRACKER', `${name || 'The tracker'} cannot import any more.`, { kind: 'unimplemented' });
    throw new RequirementsError('TRACKER', reachSentence(name, { kind, message: err && err.message }), { kind });
  }
}

/** The connection a request names when it is one of an importing source's (else BAD_REQUEST), and that source. */
export async function sourceFor(body, d) {
  const conn = { plugin: text(body.plugin, 64), sourceId: text(body.sourceId, 64), profile: text(body.profile, 64) || null };
  const t = (await importSources(d)).find((x) => x.plugin === conn.plugin && x.sourceId === conn.sourceId);
  if (!t || !t.profiles.some((p) => (p.id || null) === conn.profile)) throw new RequirementsError('BAD_REQUEST', 'Choose a connection from the list.');
  return { conn, t };
}

/** D3: where the picker starts: the export setup's connection and tracker project when that connection can import, else A6's
 *  default connection and All projects. */
export function importDefaults(scope, sources, { memberKeys = [] } = {}) {
  if (!sources.length) return { defaultConnection: null, defaultProject: null };
  const setup = getExportSetup(scope.scopeType, scope.scopeKey);
  const usable = !!setup && sources.some((s) => s.plugin === setup.plugin && s.sourceId === setup.sourceId
    && s.profiles.some((p) => (p.id || null) === (setup.profile || null)));
  if (usable) return { defaultConnection: { plugin: setup.plugin, sourceId: setup.sourceId, profile: setup.profile || null }, defaultProject: setup.trackerProject || null };
  return { defaultConnection: defaultConnection(scope, sources, { memberKeys }), defaultProject: null };
}

/** GET …/import/:scopeType/:scopeKey (§6): no tracker call but the cached probes. */
export async function importView(scope, { memberKeys = [] } = {}, d = {}) {
  const sources = await importSources(d);
  return { sources: sources.map((s) => ({ plugin: s.plugin, sourceId: s.sourceId, name: s.name, profiles: s.profiles })),
    ...importDefaults(scope, sources, { memberKeys }) };
}

const options = (v) => (Array.isArray(v) ? v.filter((x) => x && x.value != null).map((x) => ({ value: String(x.value), label: String(x.label ?? x.value) })) : []);

/** POST …/options (D3): the connection's projects. */
export async function importOptions(scope, body = {}, d = {}) {
  const { conn, t } = await sourceFor(body, d);
  const r = (await trackerCall(d, t.name, conn, 'importOptions', {})) || {};
  return { projects: options(r.projects) };
}

/** POST …/search (D4, D12): a page of tickets through the connection, each with the feature of this install it is linked to. */
export async function searchTickets(scope, body = {}, d = {}) {
  const { conn, t } = await sourceFor(body, d);
  const project = text(body.project, 100);
  const search = text(body.search, 200);
  const cursor = text(body.cursor, 500);
  const r = (await trackerCall(d, t.name, conn, 'searchTickets', { ...(project ? { project } : {}), ...(search ? { search } : {}), ...(cursor ? { cursor } : {}) })) || {};
  const tickets = (Array.isArray(r.tickets) ? r.tickets : []).filter((x) => x && typeof x.key === 'string' && KEY_RE.test(x.key))
    .slice(0, IMPORT_LIMITS.page).map((x) => {
      const linked = linkByTicket({ ...conn, key: x.key });
      return { key: x.key.toUpperCase(), title: oneLine(x.title).slice(0, 200) || x.key.toUpperCase(), url: httpUrl(x.url), type: x.type ? oneLine(x.type) : null,
        status: x.status ? oneLine(x.status) : null, updatedOn: exportDate(x.updatedAt, { year: false }) || null,
        linkedTo: linked ? { id: linked.id, title: linked.title } : null };
    });
  return { tickets, ...(typeof r.cursor === 'string' && r.cursor ? { cursor: r.cursor } : {}) };
}

export function keyOf(v) {
  const k = text(v, 64);
  if (!KEY_RE.test(k)) throw new RequirementsError('BAD_REQUEST', 'key must be a ticket key such as SHOP-124');
  return k.toUpperCase();
}
const formOf = (v) => ({ count: Math.max(0, Math.floor(Number(v && v.count) || 0)), bytes: Math.max(0, Number(v && v.bytes) || 0) });

/** importTicket through the connection, with the export setup's criteria field when that setup is on the same connection (D7).
 *  A ticket the connection cannot see is NOT_FOUND with `gone` (D16). */
export async function readTicket(d, t, conn, key, scope) {
  const setup = getExportSetup(scope.scopeType, scope.scopeKey);
  const field = setup && sameConn(setup, conn) && setup.criteria && setup.criteria.target === 'field' ? setup.criteria.field : null;
  const r = await trackerCall(d, t.name, conn, 'importTicket', { key, ...(field ? { criteriaField: field } : {}) });
  if (!r || r.gone === true) throw new RequirementsError('NOT_FOUND', `${key} was not found in ${t.name}, or this connection cannot see it.`, { gone: true });
  if (typeof r.key !== 'string' || !KEY_RE.test(r.key)) {
    console.error(`requirements: importTicket for ${key} answered without a ticket key`);
    throw new RequirementsError('TRACKER', reachSentence(t.name, { kind: 'protocol' }), { kind: 'protocol' });
  }
  return { ...r, key: r.key.toUpperCase(), url: httpUrl(r.url) };
}

/** POST …/preview (D5–D9, D12): what the new feature would take, with the default ticks; nothing is stored or sent. */
export async function previewImport(scope, body = {}, d = {}) {
  const { conn, t } = await sourceFor(body, d);
  const key = keyOf(body.key);
  const p = pickDefaults(processTicket(await readTicket(d, t, conn, key, scope), { tracker: t.name }), formOf(body.formFiles));
  const linked = linkByTicket({ ...conn, key: p.key });
  const { fingerprint: _fp, ...shown } = p;
  return { ...shown, descriptionFile: p.descriptionFile ? { name: p.descriptionFile.name, bytes: p.descriptionFile.bytes } : null,
    connection: connectionLabel(conn), linkedTo: linked ? { id: linked.id, title: linked.title } : null };
}
```

- [ ] **Step 4: Run it.** `node tools/test.mjs test/requirements-import.test.mjs` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/core/requirements/import.mjs test/requirements-import.test.mjs
git commit -m "Requirements: the import service — sources, search and the preview of a ticket" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Downloads — the private folder, the checks and the queue (`attachment-fetch.mjs`)

**Files:**
- Create: `src/core/requirements/attachment-fetch.mjs`
- Modify: `src/core/requirements/attachment-job.mjs` (only what this module needs: `pendingFor` counts downloads; `enqueueRead`, `settleOwner`)
- Create: `test/requirements-attachment-fetch.test.mjs`

**Interfaces:**
- Consumes: `callSource` (or `d.callSource`); `firstLine` is copied here (not imported from `export.mjs`, which would pull `export.mjs` into this module's import cycle with `attachment-job.mjs`); `validateAttachmentUploads` (`../attachment-upload.mjs`); `classifyExtension` (`../ask/attachment-kind.mjs`); `REQ_ATTACH_LIMITS`, `displayName`, `uniqueName` (`attachments.mjs`); `mintAttachmentId`, `insertAttachment`, `getAttachment`, `listAttachments`, `updateAttachment`, `appendTurn`, `listDownloadingAttachments` (`store.mjs`); A8's `attachmentsDir`, `attachmentFile` (`attachment-job.mjs`).
- Produces (`attachment-fetch.mjs`):
  - `DOWNLOAD_TIMEOUT_MS = 120_000`, `MAX_DOWNLOAD_JOBS = 2`
  - `insertDownloadRow(owner, { conn, tracker, key, id, name, bytes, from = null }, { by }) → Attachment` — inside the caller's transaction: the `downloading` row (name unique within the owner, kind and mime from the extension, `sha256: 'pending:<id>'`, `fetch` = `{ plugin, sourceId, profile, tracker, key, id, name, bytes }`) and, for a feature, the `file` turn `added` with `from`.
  - `queueDownloads(owner, ids, { by }, deps)` — `deps` as any A8 job's, plus `callSource`, `downloadTimeoutMs` and `writeBody(target, body)` (how the checked body is written into A8's store; a test makes it fail, as A8's `renameBody`/`copyBody`); `isDownloading(id)`; `downloadsPending(ownerKey)`; `cancelDownload(id)`; `redownload(owner, row, { by }, deps)`
  - `makeFetchFolder(base?) → { dir, dest }` (`<base>/att-get-<8 hex>/body.part`, the folder 0700)
  - `checkFetched(dir, dest, answer, maxBytes = 25 MB) → { ok: true, size, body } | { ok: false, why: 'path' | 'missing' | 'not-a-file' | 'empty' | 'too-large' | 'size' }` — `dest` opened once (POSIX `O_NOFOLLOW`), checked with `fstat` against the `lstat` taken before (same inode and size) and read through that one descriptor, so the bytes Worca validates and stores are the bytes it checked.
  - `recoverDownloads() → number`
  - A failed file: `status: 'failed'`, `error: { code: 'DOWNLOAD' | 'REFUSED' | 'INTERRUPTED', message, reason?, job: 'download', at }` with the messages of Global Constraints ("Worca could not get this file from Jira: <reason>.", "Worca could not use this file: <reason>.", "Worca restarted before it got this file from Jira."). Any failure after the connector answered — the folder, A8's store folder, the write, the validator, the read queue — is `DOWNLOAD` "Worca could not store it" with Try again: a row is never left `downloading` without a job.
- Produces (`attachment-job.mjs`): `enqueueRead(owner, id, name, by, deps)`; `settleOwner(owner, deps)`; `pendingFor` (so `readsSettled` and `filesPending`) also counts the owner's downloads.

- [ ] **Step 1: Write the failing test** `test/requirements-attachment-fetch.test.mjs` (Task 8 appends to it):

```js
// test/requirements-attachment-fetch.test.mjs — a picked tracker attachment becomes an A8 file (plans/requirements-a61-design.md D9, D10,
// D14–D17) in mock mode: the real callSource with the shim's canned (or held) downloadAttachment, A8's mock reads. No tracker, no model.
// This file imports attachment-fetch.mjs before attachment-job.mjs on purpose: the two import each other.
import * as fetchJob from '../src/core/requirements/attachment-fetch.mjs';
import * as job from '../src/core/requirements/attachment-job.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { useTempHome } from './helpers/temp-home.mjs';
import { tx } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { callSource, setMockSourceResponses, PluginOpError } from '../src/core/plugin-shim.mjs';
import { createFeature, getFeature, getAttachment, listAttachments, listTurns } from '../src/core/requirements/store.mjs';

useTempHome(after, 'worca-req-fetch-');
const prevMock = process.env.WORCA_MOCK;
process.env.WORCA_MOCK = '1';
after(() => { if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock; setMockSourceResponses(null); });

const CONN = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const seen = [];
const d = { callSource: (o) => { seen.push(o); return callSource(o); }, onChange: () => {}, budget: () => ({ blocked: false }) };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = Buffer.from('%PDF-1.7\nheld\n');
const BODY = { 10041: PNG, 10042: PDF, 10043: Buffer.from('Macro text.\n') };
const feature = (title = 'Partial cancel') => createFeature({ scopeType: 'project', scopeKey: 'shop-f1', title, description: 'From a ticket' });
const own = (f) => ({ type: 'feature', id: f.seq });
const row = (f, id = '10042', name = 'partial-cancel-flow.pdf', bytes = 1258291) => tx(() => fetchJob.insertDownloadRow(own(f),
  { conn: CONN, tracker: 'Jira', key: 'SHOP-124', id, name, bytes, from: { tracker: 'Jira', key: 'SHOP-124' } }, { by: 'po' }));
const queue = async (f, r) => { fetchJob.queueDownloads(own(f), [r.id], { by: 'po' }, d); await job.readsSettled(own(f)); return getAttachment(r.id); };
const waitFor = async (pred, ms = 3000) => { const end = Date.now() + ms; while (!pred()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 5)); } };
const getDirs = () => { try { return readdirSync(join(worcaHome(), 'tmp', 'requirements')).filter((x) => x.startsWith('att-get-')); } catch { return []; } };
const bodies = (id) => { try { return readdirSync(job.attachmentsDir()).filter((n) => n.startsWith(id)); } catch { return []; } };
/** Downloads the test answers by hand: each waits until released, then writes its body to dest. */
function hold() {
  const waiting = [];
  setMockSourceResponses({ downloadAttachment: (args) => new Promise((resolve) => waiting.push({ args, resolve })) });
  return { waiting, release: (i = 0) => { const [w] = waiting.splice(i, 1); writeFileSync(w.args.dest, BODY[w.args.id], { flag: 'wx' });
    w.resolve({ name: 'x', mime: 'x', bytes: BODY[w.args.id].length }); } };
}

test('insertDownloadRow (D10, D14): a downloading row named, typed and sized from the tracker, where from in fetch, a pending hash, an added turn with from', () => {
  const f = feature();
  const r = row(f);
  assert.deepEqual([r.status, r.name, r.kind, r.mime, r.bytes, r.sha256], ['downloading', 'partial-cancel-flow.pdf', 'binary', 'application/pdf', 1258291, `pending:${r.id}`]);
  assert.deepEqual(r.fetch, { ...CONN, tracker: 'Jira', key: 'SHOP-124', id: '10042', name: 'partial-cancel-flow.pdf', bytes: 1258291 });
  const t = listTurns(f.seq).at(-1);
  assert.deepEqual([t.kind, t.payload.action, t.payload.name, t.payload.from], ['file', 'added', 'partial-cancel-flow.pdf', { tracker: 'Jira', key: 'SHOP-124' }]);
  assert.equal(row(f, '10050').name, 'partial-cancel-flow (2).pdf', 'a name already used is made unique');
});

test('a download (D9): a fresh att-get folder and body.part; the body written into the store under the row id; the file read; the folder gone', async () => {
  setMockSourceResponses(null);
  const f = feature();
  const r = row(f, '10041', 'packing-slip.png', 860160);
  fetchJob.queueDownloads(own(f), [r.id], { by: 'po' }, d);
  assert.equal(fetchJob.isDownloading(r.id), true);
  await job.readsSettled(own(f));
  const now = getAttachment(r.id);
  assert.deepEqual([now.status, now.kind, now.mime, now.bytes, now.sha256], ['done', 'image', 'image/png', PNG.length, sha(PNG)]);
  assert.deepEqual(readFileSync(job.attachmentFile(now)), PNG);
  const call = seen.filter((c) => c.op === 'downloadAttachment').at(-1);
  assert.deepEqual([call.profile, call.timeoutMs, call.args.key, call.args.id, call.args.maxBytes], ['acme', 120_000, 'SHOP-124', '10041', 25 * 1024 * 1024]);
  assert.match(call.args.dest.replaceAll('\\', '/'), /\/tmp\/requirements\/att-get-[0-9a-f]{8}\/body\.part$/);
  assert.deepEqual(getDirs(), [], 'the folder is removed');
  assert.equal(now.fetch.key, 'SHOP-124', 'where it came from stays on the row');
});

test('at most two downloads at a time across features; the others wait as downloading (D10, D17)', async () => {
  const h = hold();
  const a = feature('A');
  const b = feature('B');
  const rows = [row(a, '10042'), row(a, '10043', 'support-macro.txt', 4096), row(b, '10041', 'packing-slip.png', 860160)];
  fetchJob.queueDownloads(own(a), [rows[0].id, rows[1].id], {}, d);
  fetchJob.queueDownloads(own(b), [rows[2].id], {}, d);
  await waitFor(() => h.waiting.length === 2);
  assert.equal(fetchJob.MAX_DOWNLOAD_JOBS, 2);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.waiting.length, 2, 'the third waits for a slot');
  assert.ok(rows.every((x) => fetchJob.isDownloading(x.id) && getAttachment(x.id).status === 'downloading'));
  assert.equal(job.filesPending(own(a)), true, "A8's pending check counts a download");
  h.release(0);
  await waitFor(() => h.waiting.length === 2, 3000);
  h.release(0);
  h.release(0);
  await job.readsSettled(own(a));
  await job.readsSettled(own(b));
  assert.deepEqual(rows.map((x) => getAttachment(x.id).status), ['done', 'done', 'done']);
});

test('a failed download marks only that file (D10, D16): a fixed reason by kind, gone, forbidden, nothing sent; downloading again works', async () => {
  const f = feature();
  const cases = [
    [() => { throw new PluginOpError('timeout', 'plugin "jira-source" op "downloadAttachment" exceeded 120000ms'); }, 'it did not answer within 2 minutes'],
    [() => { throw new PluginOpError('auth', 'Jira token invalid'); }, 'the API token was refused'],
    [() => { throw new PluginOpError('plugin', 'Jira 500 (GET /rest/x)'); }, 'it answered with an error'],
    [() => ({ gone: true }), 'it is no longer on SHOP-124'],
    [() => ({ gone: true, forbidden: true }), 'this connection may not see it'],
    [() => ({ name: 'x.pdf', mime: 'application/pdf', bytes: 5 }), 'Jira did not send it'],
  ];
  for (const [answer, reason] of cases) {
    setMockSourceResponses({ downloadAttachment: answer });
    const now = await queue(f, row(f, '10042'));
    assert.deepEqual([now.status, now.error.code, now.error.job, now.error.message],
      ['failed', 'DOWNLOAD', 'download', `Worca could not get this file from Jira: ${reason}.`], reason);
    job.removeAttachment(own(f), now.id, {}, d);
  }
  setMockSourceResponses({ downloadAttachment: () => { throw new PluginOpError('timeout', 'x'); } });
  const r = await queue(f, row(f, '10042'));
  setMockSourceResponses(null);
  assert.equal(fetchJob.redownload(own(f), r, {}, d).status, 'downloading');
  await job.readsSettled(own(f));
  assert.equal(getAttachment(r.id).status, 'done');
  assert.deepEqual(getDirs(), []);
});

test('a body Worca cannot store (plan review M1): the file fails with Try again, never stays downloading; nothing in the store, no folder left; the log keeps one line', async () => {
  setMockSourceResponses(null);
  const f = feature();
  const r = row(f, '10041', 'packing-slip.png', 860160);
  const boom = () => { throw Object.assign(new Error('EBUSY: resource busy or locked\nsecond line'), { code: 'EBUSY' }); };
  const logged = [];
  const was = console.error;
  console.error = (...a) => { logged.push(a.join(' ')); };
  try {
    fetchJob.queueDownloads(own(f), [r.id], { by: 'po' }, { ...d, writeBody: boom });
    await job.readsSettled(own(f));
  } finally { console.error = was; }
  const now = getAttachment(r.id);
  assert.deepEqual([now.status, now.error.code, now.error.job, now.error.message],
    ['failed', 'DOWNLOAD', 'download', 'Worca could not get this file from Jira: Worca could not store it.']);
  assert.deepEqual([bodies(r.id), getDirs(), fetchJob.isDownloading(r.id)], [[], [], false]);
  assert.ok(logged.some((l) => /EBUSY/.test(l)) && !logged.some((l) => /second line/.test(l)), 'the first line only (M3)');
  assert.equal(fetchJob.redownload(own(f), now, {}, d).status, 'downloading');
  await job.readsSettled(own(f));
  assert.equal(getAttachment(r.id).status, 'done');
});

test('a file that arrived but A8 cannot use is refused (D10): too large, a size that lied, not its type, a duplicate', async () => {
  const f = feature();
  const cases = [
    [() => ({ tooLarge: true, bytes: 30 * 1024 * 1024 }), 'it is over 25 MB'],
    [(a) => { writeFileSync(a.dest, PDF, { flag: 'wx' }); return { name: 'x.pdf', mime: 'application/pdf', bytes: PDF.length - 1 }; }, 'it is not the file Jira described'],
    [(a) => { writeFileSync(a.dest, 'not a pdf at all', { flag: 'wx' }); return { name: 'x.pdf', mime: 'application/pdf', bytes: 16 }; }, 'its content does not match its type'],
  ];
  for (const [answer, reason] of cases) {
    setMockSourceResponses({ downloadAttachment: answer });
    const now = await queue(f, row(f, '10042'));
    assert.deepEqual([now.status, now.error.code, now.error.message], ['failed', 'REFUSED', `Worca could not use this file: ${reason}.`], reason);
    assert.deepEqual(bodies(now.id), [], 'nothing stored');
    job.removeAttachment(own(f), now.id, {}, d);
  }
  job.addAttachments(own(f), [{ name: 'call-notes.pdf', kind: 'binary', mime: 'application/pdf', data: PDF, bytes: PDF.length, sha256: sha(PDF) }], {}, d);
  await job.readsSettled(own(f));
  setMockSourceResponses({ downloadAttachment: (a) => { writeFileSync(a.dest, PDF, { flag: 'wx' }); return { name: 'x.pdf', mime: 'application/pdf', bytes: PDF.length }; } });
  const dup = await queue(f, row(f, '10042', 'scan-notes.pdf'));
  assert.equal(dup.error.message, 'Worca could not use this file: it is already attached as call-notes.pdf.');
  assert.deepEqual(getDirs(), []);
});

test('checkFetched (D9, D15, S7): inside the folder, a regular file and no link, at most the cap, the answered size, read through one descriptor; the folder is 0700', () => {
  const { dir, dest } = fetchJob.makeFetchFolder();
  const other = mkdtempSync(join(tmpdir(), 'worca-other-'));
  try {
    assert.deepEqual(fetchJob.checkFetched(dir, dest, { bytes: 3 }), { ok: false, why: 'missing' });
    writeFileSync(dest, 'abc');
    const ok = fetchJob.checkFetched(dir, dest, { bytes: 3 });
    assert.deepEqual([ok.ok, ok.size, String(ok.body)], [true, 3, 'abc'], 'the bytes it checked come back with it');
    assert.deepEqual(fetchJob.checkFetched(dir, dest, { bytes: 4 }), { ok: false, why: 'size' });
    assert.deepEqual(fetchJob.checkFetched(dir, dest, { bytes: 3 }, 2), { ok: false, why: 'too-large' });
    writeFileSync(join(other, 'body.part'), 'abc');
    assert.deepEqual(fetchJob.checkFetched(dir, join(other, 'body.part'), { bytes: 3 }), { ok: false, why: 'path' });
    if (process.platform !== 'win32') {
      assert.equal(statSync(dir).mode & 0o777, 0o700, "the folder is the user's alone");
      rmSync(dest);
      symlinkSync(join(other, 'body.part'), dest);
      assert.deepEqual(fetchJob.checkFetched(dir, dest, { bytes: 3 }), { ok: false, why: 'not-a-file' });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});


```

- [ ] **Step 2: Run it to see it fail.** `node tools/test.mjs test/requirements-attachment-fetch.test.mjs` → FAIL (`Cannot find module …/attachment-fetch.mjs`).

- [ ] **Step 3: Write** `src/core/requirements/attachment-fetch.mjs`:

```js
// src/core/requirements/attachment-fetch.mjs
// A picked tracker attachment arrives as an A8 file (plans/requirements-a61-design.md D9, D10, D15–D17). Its row waits as `downloading`
// (fetch_json says where from) until this queue — MAX_DOWNLOAD_JOBS across every feature, apart from A8's read queue — has the
// connector stream the body to `dest`, a fixed name in a fresh private folder. Worca trusts nothing there until its own checks pass;
// then the bytes it checked are written into A8's store under the row's id and the file joins A8's read queue. A failure marks only
// that file, and every failure marks it: a row is never left `downloading` without a job.
// attachment-job.mjs and this module import each other: neither uses the other's bindings at module top level.
import { chmodSync, closeSync, constants as fsConstants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { callSource as shimCallSource } from '../plugin-shim.mjs';
import { validateAttachmentUploads } from '../attachment-upload.mjs';
import { classifyExtension } from '../ask/attachment-kind.mjs';
import { RequirementsError } from './spec.mjs';
import { REQ_ATTACH_LIMITS, displayName, uniqueName } from './attachments.mjs';
import { mintAttachmentId, insertAttachment, getAttachment, listAttachments, updateAttachment, appendTurn, listDownloadingAttachments } from './store.mjs';
import { attachmentsDir, attachmentFile, enqueueRead, settleOwner } from './attachment-job.mjs';

/** D17: one download (25 MB over a slow link); the op's answer is a few fields, the body is on disk. */
export const DOWNLOAD_TIMEOUT_MS = 120_000;
export const MAX_DOWNLOAD_JOBS = 2;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const L = REQ_ATTACH_LIMITS;
const iso = () => new Date().toISOString();
/** What the log may keep of a failure (export.mjs's firstLine, copied: importing export.mjs here would join its import cycle). */
const firstLine = (err) => String((err && err.message) || err).split(/\r?\n/)[0].slice(0, 200);
const ownerKey = (o) => `${o.type}:${o.id}`;
const extOf = (name) => { const i = String(name).lastIndexOf('.'); return i > 0 ? String(name).slice(i).toLowerCase() : ''; };
const callOf = (d) => (d && typeof d.callSource === 'function' ? d.callSource : shimCallSource);
const trackerOf = (row) => (row && row.fetch && row.fetch.tracker) || 'the tracker';
/** How the checked body goes into A8's store (a test makes it fail). 'w': a leftover of this row's own earlier attempt is replaced. */
const FETCH_DEFAULTS = Object.freeze({ writeBody: (target, body) => writeFileSync(target, body, { mode: FILE_MODE }) });

/** D10: a picked attachment's row before its body exists, inside the caller's transaction: named (unique within the owner), typed
 *  by its extension and sized as the tracker says; `sha256` holds `pending:<id>` (unique) until the body's real hash replaces it. */
export function insertDownloadRow(owner, { conn, tracker, key, id, name, bytes, from = null } = {}, { by = null } = {}) {
  const shown = uniqueName(displayName(name), listAttachments(owner.type, owner.id).map((r) => r.name));
  const cls = classifyExtension(extOf(shown));
  if (!cls) throw new RequirementsError('BAD_REQUEST', `${shown} was not added: Worca reads text, images and PDF.`);
  const size = Math.max(0, Number(bytes) || 0);
  const rowId = mintAttachmentId();
  const row = insertAttachment({ id: rowId, ownerType: owner.type, ownerId: owner.id, name: shown, kind: cls.kind, mime: cls.mime, bytes: size,
    sha256: `pending:${rowId}`, status: 'downloading',
    fetch: { plugin: conn.plugin, sourceId: conn.sourceId, profile: conn.profile || null, tracker, key, id: String(id), name: String(name), bytes: size } }, { by });
  if (owner.type === 'feature') appendTurn(owner.id, { kind: 'file', payload: { action: 'added', id: rowId, name: shown, ...(from ? { from } : {}) } }, { by });
  return row;
}

// ---------------------------------------------------------------- the queue (D10, D17)

const queue = [];          // waiting downloads, in order: { id, owner, by, d }
const running = new Map(); // attachment id → its running download (`cancelled` once its row is removed)
export const isDownloading = (id) => queue.some((e) => e.id === id) || running.has(id);
/** Whether an owner ('feature:<seq>') has a download queued or running (A8's readsSettled waits for these too). */
export const downloadsPending = (key) => queue.some((e) => ownerKey(e.owner) === key) || [...running.values()].some((e) => ownerKey(e.owner) === key);

export function queueDownloads(owner, ids, { by = null } = {}, deps = {}) {
  for (const id of ids || []) if (!isDownloading(id)) queue.push({ id, owner, by, d: deps });
  pump();
}
/** A removed file (D10): a queued download goes; a running one's result is thrown away when it ends. */
export function cancelDownload(id) {
  for (let i = queue.length - 1; i >= 0; i -= 1) if (queue[i].id === id) queue.splice(i, 1);
  const r = running.get(id);
  if (r) r.cancelled = true;
}
/** Try again on a failed download (D10): the row waits again and is queued. */
export function redownload(owner, row, { by = null } = {}, deps = {}) {
  const out = updateAttachment(row.id, { status: 'downloading', error: null }, { by });
  queueDownloads(owner, [row.id], { by }, deps);
  return out;
}
function pump() {
  while (running.size < MAX_DOWNLOAD_JOBS && queue.length) {
    const e = queue.shift();
    running.set(e.id, e);
    void runDownload(e).catch((err) => console.error(`requirements: downloading file ${e.id} failed:`, firstLine(err)))
      .finally(() => { running.delete(e.id); settleOwner(e.owner, e.d); pump(); });
  }
}

// ---------------------------------------------------------------- the folder and the checks (D9, D15)

export const fetchBase = () => join(worcaHome(), 'tmp', 'requirements');
/** A fresh single-use folder for one download (0700, as A8's att-read-* copies) and the fixed name the connector writes. */
export function makeFetchFolder(base = fetchBase()) {
  mkdirSync(base, { recursive: true, mode: DIR_MODE });
  const dir = join(base, `att-get-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { mode: DIR_MODE });
  try { chmodSync(dir, DIR_MODE); } catch { /* no POSIX modes on Windows */ }
  return { dir, dest: join(dir, 'body.part') };
}

// POSIX: open never follows a link at dest. Windows has no O_NOFOLLOW: the lstat before and the fstat after (same inode, same
// size) tell a swapped file apart there.
const OPEN_FLAGS = fsConstants.O_RDONLY | (process.platform !== 'win32' && typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0);

/** D9: `dest` is still the file the host named inside the folder it created: no link, a regular file, not empty, at most the cap,
 *  the size the connector answered. Opened once and read through that descriptor (plan review S7), so the connector cannot swap
 *  the file between the check and the read; the bytes come back with the answer and are the only ones Worca uses. */
export function checkFetched(dir, dest, answer, maxBytes = L.fileBytes) {
  if (dirname(dest) !== dir || basename(dest) !== 'body.part') return { ok: false, why: 'path' };
  let pre;
  try { pre = lstatSync(dest); } catch { return { ok: false, why: 'missing' }; }
  if (pre.isSymbolicLink() || !pre.isFile()) return { ok: false, why: 'not-a-file' };
  try { if (dirname(realpathSync(dest)) !== realpathSync(dir)) return { ok: false, why: 'path' }; } catch { return { ok: false, why: 'missing' }; }
  let fd;
  try { fd = openSync(dest, OPEN_FLAGS); } catch (err) { return { ok: false, why: err && err.code === 'ELOOP' ? 'not-a-file' : 'missing' }; }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.ino !== pre.ino || st.size !== pre.size) return { ok: false, why: 'not-a-file' };   // swapped after the lstat
    if (st.size === 0) return { ok: false, why: 'empty' };
    if (st.size > maxBytes) return { ok: false, why: 'too-large' };
    if (Number(answer && answer.bytes) !== st.size) return { ok: false, why: 'size' };
    const body = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) { const n = readSync(fd, body, off, st.size - off, off); if (n <= 0) break; off += n; }
    if (off !== st.size) return { ok: false, why: 'size' };
    return { ok: true, size: st.size, body };
  } finally { closeSync(fd); }
}

// A8's upload rules (validateAttachmentUploads) on the downloaded body, with codes for messages; each code's tail for "Worca could not use this file: …"
const VALIDATE = Object.freeze({ maxFiles: 1, maxBytesPerFile: L.fileBytes, maxBytesPerBinaryFile: L.fileBytes, maxBytesTotal: L.fileBytes,
  notAllowed: () => 'type', messages: { tooBig: () => 'size', totalTooBig: () => 'size', empty: () => 'content', mismatch: () => 'content',
    notUtf8: () => 'content', nul: () => 'content' } });
const CHECK_TAIL = Object.freeze({ type: 'Worca reads text, images and PDF', size: 'it is over 25 MB', content: 'its content does not match its type' });
// Per-file download reasons: fixed phrases, never the plugin's text (design D16, adjusted for the build)
const REASON = Object.freeze({ timeout: 'it did not answer within 2 minutes', auth: 'the API token was refused', network: 'the network connection failed',
  'rate-limit': 'it asked Worca to slow down' });

/** The file's failure (D10, D16): DOWNLOAD (Try again) or REFUSED (none); a removed file is left alone. */
function fail(row, code, reason, by) {
  if (!getAttachment(row.id)) return;
  const msg = code === 'REFUSED' ? `Worca could not use this file: ${reason}.` : `Worca could not get this file from ${trackerOf(row)}: ${reason}.`;
  updateAttachment(row.id, { status: 'failed', error: { code, message: msg, reason, job: 'download', at: iso() } }, { by });
}

async function runDownload(e) {
  await null;
  const row = getAttachment(e.id);
  if (!row || row.status !== 'downloading' || !row.fetch) return;
  const f = row.fetch;
  const d = { ...FETCH_DEFAULTS, ...(e.d || {}) };
  let dir = null;
  let target = null;   // a body this download wrote into A8's store, until the row owns it (then null)
  try {
    const folder = makeFetchFolder();   // inside the try (M1): a folder that cannot be made fails the file
    dir = folder.dir;
    let r;
    try {
      r = await callOf(d)({ plugin: f.plugin, sourceId: f.sourceId, profile: f.profile || undefined, op: 'downloadAttachment',
        args: { key: f.key, id: f.id, maxBytes: L.fileBytes, dest: folder.dest }, timeoutMs: d.downloadTimeoutMs || DOWNLOAD_TIMEOUT_MS });
    } catch (err) {
      console.error(`requirements: the download of file ${row.id} from ${f.key} failed (${(err && err.kind) || 'plugin'}):`, firstLine(err));
      if (!e.cancelled) fail(row, 'DOWNLOAD', REASON[err && err.kind] || 'it answered with an error', e.by);
      return;
    }
    if (e.cancelled || !getAttachment(row.id)) return;   // removed meanwhile: the result is thrown away (the folder goes below)
    if (r && r.gone) { fail(row, 'DOWNLOAD', r.forbidden ? 'this connection may not see it' : `it is no longer on ${f.key}`, e.by); return; }
    if (r && r.tooLarge) { fail(row, 'REFUSED', 'it is over 25 MB', e.by); return; }
    const c = checkFetched(dir, folder.dest, r);
    if (!c.ok) {
      const unsent = c.why === 'missing' || c.why === 'empty';
      fail(row, unsent ? 'DOWNLOAD' : 'REFUSED', unsent ? `${trackerOf(row)} did not send it` : c.why === 'too-large' ? 'it is over 25 MB'
        : `it is not the file ${trackerOf(row)} described`, e.by);
      return;
    }
    // A8's upload rules on the bytes checkFetched read. Synchronous (base64 out and back, up to 25 MB): acceptable at two downloads at
    // a time, the same cost as an upload of that size (plan review, Minor 9).
    const v = validateAttachmentUploads([{ name: row.name, dataBase64: c.body.toString('base64') }], VALIDATE);
    if (!v.ok) { fail(row, 'REFUSED', CHECK_TAIL[v.error] || CHECK_TAIL.content, e.by); return; }
    const file = v.files[0];
    const twin = listAttachments(row.ownerType, row.ownerId).find((x) => x.id !== row.id && x.sha256 === file.sha256);
    if (twin) { fail(row, 'REFUSED', `it is already attached as ${twin.name}`, e.by); return; }
    mkdirSync(attachmentsDir(), { recursive: true, mode: DIR_MODE });
    target = attachmentFile({ id: row.id, kind: file.kind, mime: file.mime });
    d.writeBody(target, c.body);   // the checked bytes; never a rename of dest, which could have changed after the check (S7)
    try { chmodSync(target, FILE_MODE); } catch { /* no POSIX modes on Windows */ }
    if (e.cancelled || !getAttachment(row.id)) return;   // removed meanwhile: the body goes below
    try {
      updateAttachment(row.id, { kind: file.kind, mime: file.mime, bytes: file.bytes, sha256: file.sha256, status: 'reading', error: null }, { by: e.by });
    } catch (err) {   // a twin stored in the same moment (the per-owner hash index)
      console.error(`requirements: storing downloaded file ${row.id} failed:`, firstLine(err));
      fail(row, 'REFUSED', 'it is already attached', e.by);
      return;   // the body goes below
    }
    enqueueRead(e.owner, row.id, row.name, e.by, d);   // then exactly an A8 file (D9)
    target = null;   // the row owns its body now
  } catch (err) {
    // M1: anything else (the folder, A8's store folder, the write, the validator, the read queue) fails the file with Try again
    console.error(`requirements: storing downloaded file ${row.id} failed:`, firstLine(err));
    if (!e.cancelled) fail(row, 'DOWNLOAD', 'Worca could not store it', e.by);
  } finally {
    if (target) { try { rmSync(target, { force: true }); } catch (x) { console.error('requirements: could not remove a stored body:', firstLine(x)); } }
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch (x) { console.error('requirements: could not remove a download folder:', firstLine(x)); } }
  }
}

/** D10: a row left `downloading` by a restart (its download not queued or running) fails with INTERRUPTED; Try again fetches it. */
export function recoverDownloads() {
  let n = 0;
  for (const r of listDownloadingAttachments()) {
    if (isDownloading(r.id)) continue;
    updateAttachment(r.id, { status: 'failed', error: { code: 'INTERRUPTED', message: `Worca restarted before it got this file from ${trackerOf(r)}.`,
      job: 'download', at: iso() } });
    n += 1;
  }
  return n;
}
```

- [ ] **Step 4: `attachment-job.mjs` — the hook only.** Add the import `import { downloadsPending } from './attachment-fetch.mjs';` (below the `./interview.mjs` import; Task 8 adds the other names). Then:
  - `const pendingFor = (key) => queue.some(…) || [...running.values()].some(…) || downloadsPending(key);`
  - after `function enqueue(e) { … }` add:

```js
/** A6.1: a downloaded file joins the read queue (attachment-fetch.mjs); `deps` as any other job's. */
export function enqueueRead(owner, id, name, by = null, deps = {}) { enqueue({ id, name, owner, kind: 'read', by, d: { ...DEFAULTS, ...deps } }); }
/** A6.1: a download ended (in any way): the owner's frame, and readsSettled and the follow-up once nothing is left (as settle). */
export function settleOwner(owner, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  notifyOwner(owner, d);
  if (release(ownerKey(owner)) && owner.type === 'feature') maybeFollowUpFiles(owner.id, d);
}
```

- [ ] **Step 5: Run the tests.** One at a time: `node tools/test.mjs test/requirements-attachment-fetch.test.mjs`, then A8's `test/requirements-attachment-job.test.mjs` and `test/requirements-attachments.test.mjs` → all PASS (compare any failure with `<baseline>` by test name before calling it pre-existing).

- [ ] **Step 6: Commit.**

```bash
git add src/core/requirements/attachment-fetch.mjs src/core/requirements/attachment-job.mjs test/requirements-attachment-fetch.test.mjs
git commit -m "Requirements: download a ticket's picked attachments into a private folder, check them, store them" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Downloads in A8 — Remove, Try again, round 1's wait, readiness, the restart and the Files view

**Files:**
- Modify: `src/core/requirements/attachment-job.mjs` (`addAttachments`' `from`, `removeAttachment`, `notIdle`, `editSummary`, `readAgain`, `recoverAttachmentReads`, `sweepReadFolders`, `fileView`)
- Modify: `src/core/requirements/attachments.mjs` (`stateNote`; `fileOrigins`)
- Modify: `src/core/requirements/ready.mjs` (`unaskedFiles`, `readingF`)
- Modify: `src/core/requirements/interview.mjs` (`startOrientation`'s `waits`)
- Modify: `src/core/requirements/routes.mjs` (`featureView` passes each file's `from`)
- Modify: `test/requirements-attachment-fetch.test.mjs` (appended), `test/requirements-ready.test.mjs` (appended)

**Interfaces:**
- Consumes: Task 7's `isDownloading`, `downloadsPending`, `cancelDownload`, `recoverDownloads`, `redownload`, `insertDownloadRow`, `queueDownloads`; A8's `notIdle`, `readAgain`, `removeAttachment`, `recoverAttachmentReads`, `sweepReadFolders`, `fileView`, `featureOwner` → `editable()`.
- Produces (`attachment-job.mjs`): `addAttachments(owner, files, { by, from = null }, deps)` (the `added` turn carries `from`); `readAgain` re-downloads a failed download (`CONFLICT` "Worca cannot use this file. Remove it from the ⋯ menu." for `REFUSED`); a downloading file refuses edits, asks and Read again with `CONFLICT` "Worca is still getting this file from Jira."; `removeAttachment` on a downloading file deletes its row at once and throws its download's result away; `recoverAttachmentReads()` also recovers downloads; `sweepReadFolders` also removes `att-get-*`; `fileView(row, { …, from = null })` carries `from` and `fetched: !!row.fetch`.
- Produces (`attachments.mjs`): `renderAttachmentsForPrompt` says "<name> (<kind>, <size>): being downloaded from SHOP-124; known by name only."; `fileOrigins(turns) → Map<id, { tracker, key } | null>`.
- Produces (`ready.mjs`, plan review M4): a file still `downloading` counts as one still being read — it is in `unaskedFiles` (to ask about, A8-D8) and in the interview check's "Reading <n> files…" hint — so readiness never passes "Interview finished" while a ticket's file is on its way.
- Not changed (design D10, U2): the file routes keep A8's rule (`featureOwner` → `editable()`). While round 1 waits for the ticket's files the feature is busy, so Remove and Try again on those files answer A8's busy refusal and the page disables them (`ctx.locked`) until round 1 has started; a file still downloading or failed when round 1 starts is listed by name only. No exception code.

- [ ] **Step 1: Write the failing tests.** Add `fileOrigins` to `test/requirements-attachment-fetch.test.mjs`'s imports (`import { fileOrigins } from '../src/core/requirements/attachments.mjs';`) and append:

```js
test("A8's Try again on a failed download fetches it again; a file Worca refused cannot be tried again; a restart fails a file left downloading (D10)", async () => {
  const f = feature();
  setMockSourceResponses({ downloadAttachment: () => { throw new PluginOpError('timeout', 'x'); } });
  const r = await queue(f, row(f, '10042'));
  setMockSourceResponses(null);
  assert.equal(job.readAgain(own(f), r.id, {}, d).status, 'downloading');
  await job.readsSettled(own(f));
  assert.equal(getAttachment(r.id).status, 'done');
  setMockSourceResponses({ downloadAttachment: () => ({ tooLarge: true, bytes: 30 * 1024 * 1024 }) });
  const big = await queue(f, row(f, '10045', 'pick-route-scan.pdf', 30 * 1024 * 1024));
  assert.throws(() => job.readAgain(own(f), big.id, {}, d), (e) => e.code === 'CONFLICT' && e.message === 'Worca cannot use this file. Remove it from the ⋯ menu.');
  setMockSourceResponses(null);
  const left = row(f, '10043', 'support-macro.txt', 4096);   // nobody queued it: as after a restart
  assert.ok(job.recoverAttachmentReads() >= 1);
  const now = getAttachment(left.id);
  assert.deepEqual([now.status, now.error.code, now.error.job, now.error.message], ['failed', 'INTERRUPTED', 'download', 'Worca restarted before it got this file from Jira.']);
});

test('a link left at dest is refused and never followed (POSIX)', { skip: process.platform === 'win32' ? 'symlinks need privileges on Windows' : false }, async () => {
  const f = feature();
  const secret = join(worcaHome(), 'secret.txt');
  writeFileSync(secret, 'secret');
  setMockSourceResponses({ downloadAttachment: (a) => { symlinkSync(secret, a.dest); return { name: 'x.txt', mime: 'text/plain', bytes: 6 }; } });
  const now = await queue(f, row(f, '10043', 'support-macro.txt', 4096));
  assert.equal(now.error.message, 'Worca could not use this file: it is not the file Jira described.');
  assert.equal(readFileSync(secret, 'utf8'), 'secret');
});

test('a downloading file refuses Read again; removing it deletes its row at once, its late result is thrown away, its folder removed (D10)', async () => {
  const h = hold();
  const f = feature();
  const r = row(f, '10042');
  fetchJob.queueDownloads(own(f), [r.id], {}, d);
  await waitFor(() => h.waiting.length === 1);
  assert.throws(() => job.readAgain(own(f), r.id, {}, d), (e) => e.code === 'CONFLICT' && e.message === 'Worca is still getting this file from Jira.');
  job.removeAttachment(own(f), r.id, {}, d);
  assert.equal(getAttachment(r.id), null);
  assert.equal(listTurns(f.seq).at(-1).payload.action, 'removed');
  h.release(0);
  await job.readsSettled(own(f));
  await waitFor(() => !fetchJob.isDownloading(r.id));
  assert.equal(listAttachments('feature', f.seq).length, 0);
  assert.deepEqual(bodies(r.id), []);
  assert.deepEqual(getDirs(), []);
});

test('round 1 waits for downloads and reads (D10): readsSettled holds while one runs; a file still downloading is in <attachments> by name only', async () => {
  const h = hold();
  const f = feature();
  const r = row(f, '10042');
  fetchJob.queueDownloads(own(f), [r.id], {}, d);
  await waitFor(() => h.waiting.length === 1);
  let done = false;
  const p = job.readsSettled(own(f)).then(() => { done = true; });
  assert.equal(job.filesPending(own(f)), true);
  assert.equal(job.promptFiles(getFeature(f.seq)).attachments, 'partial-cancel-flow.pdf (PDF, 1.2 MB): being downloaded from SHOP-124; known by name only.');
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(done, false);
  h.release(0);
  await p;
  assert.equal(getAttachment(r.id).status, 'done');
});

test("the boot sweep removes att-get folders older than an hour, as A8's att-read ones", () => {
  const base = join(worcaHome(), 'tmp', 'requirements');
  mkdirSync(join(base, 'att-get-0123abcd'), { recursive: true });
  mkdirSync(join(base, 'att-get-89abcdef'), { recursive: true });
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(join(base, 'att-get-0123abcd'), old, old);
  const r = job.sweepReadFolders(base);
  assert.deepEqual(r.removed.map((p) => p.split(/[\\/]/).pop()), ['att-get-0123abcd']);
  assert.equal(existsSync(join(base, 'att-get-89abcdef')), true);
  rmSync(join(base, 'att-get-89abcdef'), { recursive: true, force: true });
});

test("fileOrigins (D14): an import's added file names its ticket; a replaced file loses it; an upload has none", () => {
  const turns = [
    { kind: 'file', payload: { action: 'added', id: 'a', name: 'SHOP-124 comments.md', from: { tracker: 'Jira', key: 'SHOP-124' } } },
    { kind: 'file', payload: { action: 'added', id: 'b', name: 'notes.md' } },
    { kind: 'file', payload: { action: 'added', id: 'c', name: 'slip.png', from: { tracker: 'Jira', key: 'SHOP-124' } } },
    { kind: 'file', payload: { action: 'replaced', id: 'c', name: 'slip2.png', before: 'slip.png' } },
  ];
  const m = fileOrigins(turns);
  assert.deepEqual([m.get('a'), m.get('b'), m.get('c')], [{ tracker: 'Jira', key: 'SHOP-124' }, null, null]);
});
```

Append to `test/requirements-ready.test.mjs` (it has `fileTurn`, `roundTurn` and `file` already):

```js
test('A6.1 D10 (plan review M4): a ticket file still downloading counts as one still being read: to ask about, and the reading hint', () => {
  const f = { spec: { goal: { text: 'g', measure: 'm' }, criteria: [{ id: 'R-po-1', text: 'c' }], assumptions: [], openQuestions: [] } };
  const turns = [fileTurn(1, 'added', 'a'), roundTurn(2)];   // round 1 ran after its wait, without the file in payload.files
  assert.deepEqual(unaskedFiles([file('a', 'downloading')], turns), ['a']);
  const c = readiness(f, { turns, files: [file('a', 'downloading')] }).checks.find((x) => x.key === 'interview');
  assert.deepEqual([c.ok, c.hint], [false, 'Reading 1 file…']);
});
```

- [ ] **Step 2: Run them to see them fail.** `node tools/test.mjs test/requirements-attachment-fetch.test.mjs` → the whole file FAILS (no `fileOrigins` export yet; after Step 4, A8's `readAgain` still reads a file with no body). The POSIX link test is Task 7's behaviour, kept here only for Task 7's size: it passes once the file loads. `node tools/test.mjs test/requirements-ready.test.mjs` → the new test FAILS (`unaskedFiles` skips `downloading`).

- [ ] **Step 3: `attachment-job.mjs`.** Extend Task 7's import to `import { isDownloading, downloadsPending, cancelDownload, recoverDownloads, redownload } from './attachment-fetch.mjs';`. Then:
  - `addAttachments(owner, files, { by = null, from = null } = {}, deps = {})`, and its turn payload `{ action: 'added', id: p.id, name: p.name, ...(from ? { from } : {}) }`.
  - `removeAttachment`: after `stopJobs([row.id]);` add `cancelDownload(row.id);   // A6.1 D10: a download in flight is thrown away`.
  - above `notIdle` add `const gettingOf = (row) => \`Worca is still getting this file from ${(row.fetch && row.fetch.tracker) || 'the tracker'}.\`;` and `const CANNOT_USE = 'Worca cannot use this file. Remove it from the ⋯ menu.';`; `notIdle` begins with `if (row.status === 'downloading' || isDownloading(row.id)) throw new RequirementsError('CONFLICT', gettingOf(row));`
  - `editSummary`: before its `reading` check add the same `downloading` line.
  - `readAgain`: after `if (storeFailed(row)) …` add:

```js
  // A6.1 D10: a tracker file whose download failed is fetched again first; one Worca refused after it arrived is not
  if (row.status === 'failed' && row.error && row.error.job === 'download') {
    if (row.error.code === 'REFUSED') throw new RequirementsError('CONFLICT', CANNOT_USE);
    const out = redownload(owner, row, { by }, d);
    notifyOwner(owner, d);
    return out;
  }
```

  - `recoverAttachmentReads`: `return n + recoverDownloads();` (and its comment: "…; A6.1: a file left `downloading` fails with INTERRUPTED too").
  - `sweepReadFolders`: the name test becomes `/^att-(?:read|get)-[0-9a-f]{8}$/` and its comment "D5, A6.1 D9: read and download folders a restart left behind, older than an hour."
  - `fileView(row, { spec = null, href, doc = false, estimates = null, from = null } = {})` gains `from, fetched: !!row.fetch,` after `asking: …`.

- [ ] **Step 4: `attachments.mjs`.** Replace `stateNote`:

```js
const stateNote = (r) => (r.status === 'downloading' ? `being downloaded from ${(r.fetch && r.fetch.key) || 'the tracker'}`   // A6.1 D10
  : r.status === 'failed' && r.error?.code === 'STORE_FAILED' ? STATE_NOTES.stored : STATE_NOTES[r.status] || STATE_NOTES.reading);
```

and add at the end:

```js
/** A6.1 D14: per file id, the tracker and key an import added it from ({ tracker, key }), else null; a replaced file loses it. */
export function fileOrigins(turns = []) {
  const out = new Map();
  for (const t of turns || []) {
    if (!t || t.kind !== 'file' || !t.payload || !t.payload.id) continue;
    if (t.payload.action === 'added') {
      const f = t.payload.from;
      out.set(t.payload.id, f && f.key ? { tracker: String(f.tracker || ''), key: String(f.key) } : null);
    } else if (t.payload.action === 'replaced') out.set(t.payload.id, null);
  }
  return out;
}
```

- [ ] **Step 5: `ready.mjs` (M4).** In `unaskedFiles` the status test becomes `if (!f || (f.status !== 'reading' && f.status !== 'downloading' && f.status !== 'done')) continue;` and its doc comment gains "A6.1 D10: a file still being downloaded counts as one being read."; in `readiness`, `readingF` becomes `unaskedF.filter((id) => ['reading', 'downloading'].includes(((files || []).find((x) => x && x.id === id) || {}).status));` with the comment "(A6.1: a ticket file still downloading too)".

- [ ] **Step 6: `interview.mjs`.** Import `isDownloading` (`import { isDownloading } from './attachment-fetch.mjs';`) and in `startOrientation` change `waits` to `thenRound && listAttachments('feature', f.seq).some((r) => isReading(r.id) || isDownloading(r.id))`; extend the comment above it: "A6.1 D10: a file still being downloaded counts as one being read."

- [ ] **Step 7: `routes.mjs`.** Import `fileOrigins` from `./attachments.mjs`. In `featureView`, after `const files = …` add `const origins = fileOrigins(turns);   // A6.1 D14: "from SHOP-124"` and the feature files' map becomes `files.map((r) => fileView(r, { spec: f.spec, href: …, estimates, from: origins.get(r.id) || null }))`.

- [ ] **Step 8: Run the tests.** One at a time: `node tools/test.mjs test/requirements-attachment-fetch.test.mjs`, `test/requirements-ready.test.mjs`, then the A8 files `test/requirements-attachment-job.test.mjs`, `test/requirements-attachments.test.mjs`, `test/requirements-attachments-api.test.mjs`, `test/requirements-interview.test.mjs`, `test/requirements-round.test.mjs` → all PASS (compare any failure with `<baseline>` by test name before calling it pre-existing).

- [ ] **Step 9: Commit.**

```bash
git add src/core/requirements/attachment-job.mjs src/core/requirements/attachments.mjs src/core/requirements/ready.mjs src/core/requirements/interview.mjs src/core/requirements/routes.mjs test/requirements-attachment-fetch.test.mjs test/requirements-ready.test.mjs
git commit -m "Requirements: a ticket's files in A8 — Remove, Try again, round 1's wait and readiness" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The create from a ticket and the import routes

**Files:**
- Modify: `src/core/requirements/import.mjs` (`prepareImport`, `createImported`)
- Modify: `src/core/requirements/routes.mjs` (`REQUIREMENTS_ROUTES`, four handlers, `POST /api/requirements`)
- Modify: `test/requirements-run-link.test.mjs` (the allowlist test)
- Create: `test/requirements-import-api.test.mjs`

**Interfaces:**
- Consumes: Task 6's `sourceFor`, `keyOf`, `readTicket`, `importView`, `importOptions`, `searchTickets`, `previewImport`; Task 2's `processTicket`, `commentsMarkdown`, `commentsFileName`; Task 1's `createFeature`, `saveExportLink`, `linkByTicket`; Task 7's `insertDownloadRow`, `queueDownloads`, `isDownloading`; Task 8's `addAttachments` with `from`; A8's `checkNewFiles`, `REQ_ATTACH_LIMITS`, `displayName`; A1's `assertCapacity`, `startOrientation`.
- Produces (`import.mjs`):
  - `prepareImport(scope, fromTicket, { diskFiles = [] }, d) → Plan` — the second read (D10); `Plan = { conn, tracker, key, url, meta, fingerprint, criteriaField: { id, name } | null, criteria: [{ text, source }], comments: number, generated: [Upload], diskFiles: [Upload], downloads: [{ id, name, kind, mime, bytes }], notOnTicket: { key, comments: [id], attachments: [{ id, reason: string | null }] } }`; refuses A8's caps over the form's files, the generated files and the downloads together (`BAD_REQUEST`), the ticket gone (`NOT_FOUND` with `gone`), the tracker (`TRACKER`). Writes nothing.
  - `createImported(scope, { title, description }, plan, { by }, d) → { seq, filesNotStored: [name], notOnTicket }` — one transaction for the feature with its criteria, A6's link (`origin: 'import'`, unless another feature follows the ticket, D12) and the `export` turn `imported`; then the generated files (A8's `addAttachments` with `from`), the `downloading` rows (one transaction) and their queue, then the form's own files. Never awaits a download.
  - The `export` turn `imported` payload: `{ action: 'imported', tracker, key, url, at, linked: boolean, linkedTo?: 'FEAT-7', criteria: ['R-po-1', …], comments: n, files: [name] }`.
- Produces (routes, all behind the flag, before `GET /api/requirements`): `GET /api/requirements/import/:scopeType/:scopeKey` → `importView`; `POST …/options`, `POST …/search`, `POST …/preview`; `POST /api/requirements` with `fromTicket: { plugin, sourceId, profile, key, criteria: [text], comments: [id], attachments: [id], descriptionFile: bool }` → 201 `{ feature, turns, filesNotStored, notOnTicket }`.

- [ ] **Step 1: Write the failing test** `test/requirements-import-api.test.mjs`:

```js
// test/requirements-import-api.test.mjs — the import routes and the create from a ticket (plans/requirements-a61-design.md §6, D10–D12, D14,
// D16, D18) on a bare express app with the requirements routes, in mock mode with jira-source linked: the 201 before any download ends,
// the criteria, the link, the turn, the comments file, the second read, D12's unlinked create, the caps, Try again and Remove.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { createProfile, writePluginConfig } from '../src/core/plugin-config.mjs';
import { setMockSourceResponses, PluginOpError } from '../src/core/plugin-shim.mjs';
import { createFeature, getFeature, getExportLink, saveExportLink, listAttachments, listFeatures, listTurns } from '../src/core/requirements/store.mjs';
import { settled } from '../src/core/requirements/interview.mjs';
import { attachmentFile } from '../src/core/requirements/attachment-job.mjs';
import { isDownloading } from '../src/core/requirements/attachment-fetch.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { registerRequirementsRoutes, REQUIREMENTS_ROUTES } from '../src/core/requirements/routes.mjs';
import { _resetExportCaches } from '../src/core/requirements/export.mjs';

useTempHome(after, 'worca-req-import-api-');
const prev = { flags: process.env.WORCA_FLAGS, mock: process.env.WORCA_MOCK };
process.env.WORCA_FLAGS = 'requirements';
process.env.WORCA_MOCK = '1';
const SECRET = 'tok-SECRET-1234';
let srv; let base; let projKey; let projDir;

before(async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  projDir = mkdtempSync(join(tmpdir(), 'req-import-api-shop-'));
  projKey = (await addProject({ name: 'shop', path: projDir })).find((p) => p.name === 'shop').key;
  await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url)));
  createProfile('jira-source', 'acme', 'acme.atlassian.net (Cloud)');
  writePluginConfig('jira-source', [{ key: 'baseUrl', type: 'text' }, { key: 'email', type: 'text' }, { key: 'token', type: 'text', secret: true }],
    { baseUrl: 'https://acme.atlassian.net', email: 'ann@acme.test', token: SECRET }, 'acme');
  _resetExportCaches();
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  // round 1 waits for the files at most 1.5 s here (6 minutes in the product), so a held download lets the feature be edited again
  registerRequirementsRoutes(app, { broadcast: () => {}, deps: { startRun: async () => ({ status: 200, body: {} }), round1WaitMs: 1500 } });
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
const imp = (path = '') => `${P}/import/project/${projKey}${path}`;
const ACME = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const CRITERIA = ['A customer can cancel the items of an order that have not been picked up.', 'Shipped items stay on the order and cannot be cancelled.',
  'The refund covers only the cancelled items, including their share of the shipping cost.'];
const FROM = (over = {}) => ({ ...ACME, key: 'SHOP-124', criteria: CRITERIA, comments: ['10231', '10232', '10233', '10235', '10236'],
  attachments: ['10041', '10042', '10043'], descriptionFile: false, ...over });
const create = (over = {}, ft = FROM()) => call('POST', P, { scopeType: 'project', scopeKey: projKey, title: 'Partial cancel for multi-item orders',
  description: 'Customers cancel the items not picked up yet.', fromTicket: ft, ...over });
const waitFor = async (pred, ms = 8000) => { const end = Date.now() + ms; while (!(await pred())) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };
const BODY = { 10041: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), 10042: Buffer.from('%PDF-1.7\nx\n'), 10043: Buffer.from('Macro text.\n') };
const getDirs = () => { try { return readdirSync(join(worcaHome(), 'tmp', 'requirements')).filter((x) => x.startsWith('att-get-')); } catch { return []; } };
/** Downloads answered by hand: `drain()` answers every one, also those that start after a slot freed. */
function hold() {
  const waiting = [];
  setMockSourceResponses({ downloadAttachment: (args) => new Promise((resolve) => waiting.push(() => {
    writeFileSync(args.dest, BODY[args.id], { flag: 'wx' });
    resolve({ name: 'x', mime: 'x', bytes: BODY[args.id].length });
  })) });
  return { waiting, drain: async (seq) => waitFor(() => { while (waiting.length) waiting.shift()(); return listAttachments('feature', seq).every((a) => a.status !== 'downloading'); }) };
}

test('the route table: the four import routes, before GET /api/requirements', () => {
  const keys = REQUIREMENTS_ROUTES.map((r) => `${r.method} ${r.path}`);
  const list = keys.indexOf(`GET ${P}`);
  for (const k of [`GET ${P}/import/:scopeType/:scopeKey`, `POST ${P}/import/:scopeType/:scopeKey/options`, `POST ${P}/import/:scopeType/:scopeKey/search`,
    `POST ${P}/import/:scopeType/:scopeKey/preview`]) {
    assert.ok(keys.includes(k) && keys.indexOf(k) < list, k);
  }
});

test('GET import, options, search and preview answer through the routes; no config value ever; a connection not listed is 400; a gone key 404', async () => {
  setMockSourceResponses(null);
  const v = await call('GET', imp());
  assert.equal(v.status, 200);
  assert.deepEqual([v.json.sources.map((s) => s.plugin), v.json.defaultConnection], [['jira-source'], ACME]);
  assert.equal((await call('POST', imp('/options'), ACME)).json.projects[0].value, 'SHOP');
  assert.deepEqual((await call('POST', imp('/search'), { ...ACME, search: 'partial' })).json.tickets.map((t) => t.key), ['SHOP-124']);
  const p = await call('POST', imp('/preview'), { ...ACME, key: 'SHOP-124' });
  assert.deepEqual([p.status, p.json.title], [200, 'Partial cancel for multi-item orders']);
  for (const body of [v.json, p.json]) assert.ok(!JSON.stringify(body).includes(SECRET), 'no token in an answer');
  assert.deepEqual([(await call('POST', imp('/search'), { ...ACME, profile: 'nope' })).status], [400]);
  const g = await call('POST', imp('/preview'), { ...ACME, key: 'SHOP-999' });
  assert.deepEqual([g.status, g.json.gone, g.json.error], [404, true, 'SHOP-999 was not found in Jira, or this connection cannot see it.']);
});

test('Start the interview with a ticket (D10, D11, D14): 201 at once; R-po-1… from SHOP-124; the link with origin import; the comments file; the picked attachments downloading', async () => {
  const h = hold();
  const r = await create();
  assert.equal(r.status, 201);
  const f = r.json.feature;
  assert.deepEqual(f.spec.criteria.map((c) => [c.id, c.text, c.edited, c.source]), CRITERIA.map((t, i) => [`R-po-${i + 1}`, t, true, 'SHOP-124']));
  assert.equal(f.export.link.key, 'SHOP-124', 'the chip from the start (the view carries the origin from Task 10 on)');
  assert.deepEqual(f.attachments.map((a) => a.name), ['SHOP-124 comments.md', 'packing-slip.png', 'partial-cancel-flow.pdf', 'support-macro.txt']);
  assert.ok(['reading', 'done'].includes(f.attachments[0].status));
  assert.deepEqual(f.attachments.slice(1).map((a) => a.status), ['downloading', 'downloading', 'downloading']);
  assert.ok(f.attachments.every((a) => a.from && a.from.key === 'SHOP-124' && a.from.tracker === 'Jira'));
  assert.deepEqual([r.json.filesNotStored, r.json.notOnTicket], [[], { key: 'SHOP-124', comments: [], attachments: [] }]);
  const link = getExportLink(f.seq);
  assert.deepEqual([link.origin, link.trackerProject, link.fields.issueTypeName, link.fields.priorityName, link.fields.labels, link.fields.criteria],
    ['import', 'SHOP', 'Story', 'Medium', ['worca'], { target: 'description' }]);
  assert.match(link.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(link.createdAt, link.exportedAt);
  assert.deepEqual(link.spec.criteria.map((c) => c.id), ['R-po-1', 'R-po-2', 'R-po-3'], 'the spec as created');
  const turn = listTurns(f.seq).find((t) => t.kind === 'export');
  assert.deepEqual([turn.payload.action, turn.payload.key, turn.payload.linked, turn.payload.criteria, turn.payload.comments, turn.payload.files],
    ['imported', 'SHOP-124', true, ['R-po-1', 'R-po-2', 'R-po-3'], 5, ['packing-slip.png', 'partial-cancel-flow.pdf', 'support-macro.txt']]);
  const md = readFileSync(attachmentFile(listAttachments('feature', f.seq)[0]), 'utf8');
  assert.match(md, /^# Comments on SHOP-124\n\n\*\*Ann Example\*\* · 21 Oct 2026\n/);
  assert.ok(!md.includes('Jira Automation') && md.includes('ghp_<redacted>') && !md.includes('ghp_abcdef'));
  await h.drain(f.seq);
  await waitFor(() => listAttachments('feature', f.seq).every((a) => a.status === 'done'));
  await settled(f.seq);
  assert.ok(getFeature(f.seq).rounds >= 1, 'round 1 ran once the files were read');
});

test('the second read (D10): a comment and an attachment no longer on the ticket are left out and named; a refused one with its reason', async () => {
  setMockSourceResponses(null);
  const r = await create({}, FROM({ comments: ['10231', '99999'], attachments: ['10041', '99998', '10044'] }));
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.notOnTicket, { key: 'SHOP-124', comments: ['99999'], attachments: [{ id: '99998', reason: null },
    { id: '10044', reason: 'Not offered: Worca reads text, images and PDF. Save it as PDF to attach it here.' }] });
  assert.deepEqual(r.json.feature.attachments.map((a) => a.name), ['SHOP-124 comments.md', 'packing-slip.png']);
  await settled(r.json.feature.seq);
});

test('the ticket cannot be read at Start the interview (D10, D16): gone 404, unreachable 502; nothing is created', async () => {
  const before = listFeatures({ archived: true }).length;
  const g = await create({}, FROM({ key: 'SHOP-999' }));
  assert.deepEqual([g.status, g.json.gone, g.json.error], [404, true, 'SHOP-999 was not found in Jira, or this connection cannot see it.']);
  setMockSourceResponses({ importTicket: () => { throw new PluginOpError('timeout', 'x'); } });
  const t = await create();
  assert.deepEqual([t.status, t.json.kind, t.json.error], [502, 'timeout', 'Worca could not reach Jira: it did not answer within a minute.']);
  setMockSourceResponses(null);
  assert.equal(listFeatures({ archived: true }).length, before);
});

test('one ticket follows one feature (D12): a ticket another feature follows makes an unlinked feature whose turn names it', async () => {
  setMockSourceResponses(null);
  const other = createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Cancel an order before it ships', description: 'x' });
  saveExportLink(other.seq, { ...ACME, trackerProject: 'SHOP', key: 'SHOP-123' });
  const r = await create({}, FROM({ key: 'SHOP-123', attachments: [] }));
  assert.equal(r.status, 201);
  assert.equal(r.json.feature.export.link, null);
  assert.equal(getExportLink(r.json.feature.seq), null);
  const turn = listTurns(r.json.feature.seq).find((t) => t.kind === 'export');
  assert.deepEqual([turn.payload.linked, turn.payload.linkedTo], [false, other.id]);
  assert.deepEqual(r.json.feature.spec.criteria.map((c) => c.source), ['SHOP-123', 'SHOP-123', 'SHOP-123']);
  await settled(r.json.feature.seq);
});

test("the caps at the create (D9): the form's files, the comments file and the downloads together; over 10 is refused and nothing created", async () => {
  setMockSourceResponses(null);
  const before = listFeatures({ archived: true }).length;
  const files = Array.from({ length: 7 }, (_, i) => ({ name: `notes-${i}.md`, dataBase64: Buffer.from(`note ${i}`).toString('base64') }));
  const r = await create({ attachments: files });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'support-macro.txt was not added: a feature takes up to 10 files.');
  assert.equal(listFeatures({ archived: true }).length, before);
});

test('Try again on a failed download fetches it again (A8 read-again); Remove on a downloading file deletes its row; round 1 does not wait for ever', async () => {
  setMockSourceResponses({ downloadAttachment: () => { throw new PluginOpError('auth', 'x'); } });
  const r = await create({}, FROM({ attachments: ['10042'] }));
  const seq = r.json.feature.seq;
  await settled(seq);
  const pdf = listAttachments('feature', seq).find((a) => a.name === 'partial-cancel-flow.pdf');
  assert.deepEqual([pdf.status, pdf.error.message], ['failed', 'Worca could not get this file from Jira: the API token was refused.']);
  setMockSourceResponses(null);
  assert.equal((await call('POST', `${P}/${seq}/attachments/${pdf.id}/read-again`, {})).status, 202);
  await waitFor(() => listAttachments('feature', seq).find((a) => a.id === pdf.id).status === 'done');
  const h = hold();
  const r2 = await create({}, FROM({ comments: [], attachments: ['10043'] }));
  const seq2 = r2.json.feature.seq;
  await settled(seq2);   // round 1 ran after round1WaitMs with the file still downloading
  const txt = listAttachments('feature', seq2).find((a) => a.name === 'support-macro.txt');
  assert.equal(txt.status, 'downloading');
  assert.ok(getFeature(seq2).rounds >= 1);
  assert.equal((await call('DELETE', `${P}/${seq2}/attachments/${txt.id}`)).status, 200);
  assert.equal(listAttachments('feature', seq2).length, 0);
  while (h.waiting.length) h.waiting.shift()();
  // the released download of the removed file ends now: wait for it, so it never finishes after this test (or after useTempHome's cleanup)
  await waitFor(() => !isDownloading(txt.id));
  assert.deepEqual(getDirs(), [], 'its folder is gone');
});
```

Add to `test/requirements-run-link.test.mjs`, after the export allowlist test:

```js
test('server (a guard: it passes before A6.1 too): the browser cannot drive an import op (A6.1 D2): /api/sources/call refuses all four', async () => {
  for (const op of ['importOptions', 'searchTickets', 'importTicket', 'downloadAttachment']) {
    const r = await call('POST', '/api/sources/call', { plugin: 'jira-source', sourceId: 'jira', op, profile: 'acme', args: {} });
    assert.deepEqual([r.status, r.json.error], [400, `op "${op}" is not allowed for this source`], op);
  }
});
```

- [ ] **Step 2: Run them to see them fail.** `node tools/test.mjs test/requirements-import-api.test.mjs` → FAIL (the import routes are not in the table). `node tools/test.mjs test/requirements-run-link.test.mjs` → the new test PASSES already (the allowlist never named these ops): it is a guard that keeps the rule, not a failing-first test, and does not count as one.

- [ ] **Step 3: `import.mjs`: the second read and the create.** Add to the imports:

```js
import { createHash } from 'node:crypto';
import { tx } from '../db.mjs';
import { redactAskText } from '../ask/redact.mjs';
import { LIMITS, clip } from './spec.mjs';
import { createFeature, saveExportLink, appendTurn, listAttachments } from './store.mjs';
import { REQ_ATTACH_LIMITS, checkNewFiles, displayName } from './attachments.mjs';
import { addAttachments } from './attachment-job.mjs';
import { insertDownloadRow, queueDownloads } from './attachment-fetch.mjs';
import { commentsFileName, commentsMarkdown } from './ticket-import.mjs';
```

(merge `RequirementsError` with `LIMITS, clip` into one `./spec.mjs` import, the store names into one `./store.mjs` import, and `IMPORT_LIMITS, processTicket, pickDefaults, commentsFileName, commentsMarkdown` into one `./ticket-import.mjs` import.) Then add at the end:

```js
// ---- the create (D10–D12): the ticket read again, then the feature at once; downloads run afterwards ----

/** A generated text file (the comments, the long description): A8's text rules hold for it as for an upload (plan review S9):
 *  no NUL (it would be inlined into a prompt) and well-formed UTF-8 (a lone surrogate from the tracker becomes U+FFFD). */
const textFile = (name, body) => {
  const text = String(body).replace(/\u0000/g, '').toWellFormed();
  const data = Buffer.from(text, 'utf8');
  return { name, kind: 'text', mime: 'text/markdown', data, text, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
};
const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x)).slice(0, 200))];

/** D10: the second read. The form's title, description and criteria are the product owner's; the comments and attachments are taken
 *  by id from this fresh read (one no longer there is named in notOnTicket). A8's caps for the New feature form count the form's own
 *  files, the generated ones and the downloads (D9, on the tracker's sizes). Writes nothing. The read keeps the newest 50 comments
 *  (D8), so a comment the product owner picked that newer comments pushed out between the preview and Start is reported as "no
 *  longer on SHOP-124" too (rare; accepted, plan review Minor 6). */
export async function prepareImport(scope, ft, { diskFiles = [] } = {}, d = {}) {
  if (!ft || typeof ft !== 'object' || Array.isArray(ft)) throw new RequirementsError('BAD_REQUEST', 'fromTicket must be an object');
  const { conn, t } = await sourceFor(ft, d);
  const key = keyOf(ft.key);
  const raw = await readTicket(d, t, conn, key, scope);
  const p = processTicket(raw, { tracker: t.name });
  const wantComments = ids(ft.comments);
  const wantFiles = ids(ft.attachments);
  const comments = p.comments.filter((c) => wantComments.includes(c.id));
  const downloads = p.attachments.filter((a) => wantFiles.includes(a.id) && !a.refused);
  const notOnTicket = { key: p.key, comments: wantComments.filter((id) => !p.comments.some((c) => c.id === id)),
    attachments: wantFiles.filter((id) => !downloads.some((a) => a.id === id)).map((id) => ({ id, reason: (p.attachments.find((a) => a.id === id) || {}).refused || null })) };
  const generated = [
    ...(comments.length ? [textFile(commentsFileName(p.key), commentsMarkdown(p.key, comments))] : []),
    ...(ft.descriptionFile === true && p.descriptionFile ? [textFile(p.descriptionFile.name, p.descriptionFile.text)] : []),
  ];
  checkNewFiles('feature', [], [...generated, ...diskFiles]);   // A8: names, duplicates, 10 files
  const all = [...generated, ...diskFiles, ...downloads];
  if (all.length > REQ_ATTACH_LIMITS.files) {
    throw new RequirementsError('BAD_REQUEST', `${displayName(all[REQ_ATTACH_LIMITS.files].name)} was not added: a feature takes up to ${REQ_ATTACH_LIMITS.files} files.`);
  }
  let total = 0;
  for (const x of all) {
    total += Number(x.bytes) || 0;
    if (total > REQ_ATTACH_LIMITS.requestBytes) {
      throw new RequirementsError('BAD_REQUEST', `${displayName(x.name)} was not added: a new feature's files can be up to 100 MB in all; add more on the feature page.`);
    }
  }
  const criteria = (Array.isArray(ft.criteria) ? ft.criteria : []).slice(0, LIMITS.items).map((x) => ({ text: redactAskText(clip(x, LIMITS.item)), source: p.key }));
  return { conn, tracker: t.name, key: p.key, url: p.url, meta: p.meta || {}, fingerprint: p.fingerprint, criteriaField: p.criteria.from === 'field' ? p.criteria.field : null,
    criteria, comments: comments.length, generated, diskFiles, downloads, notOnTicket };
}

/** D11: the link's fields, from the ticket: its own issue type and priority (an Update keeps them), the label, where criteria are. */
const importFields = (plan) => ({
  projectName: plan.meta.projectName || plan.meta.project || null, issueType: plan.meta.type ? plan.meta.type.id : null,
  issueTypeName: plan.meta.type ? plan.meta.type.name : null, priority: plan.meta.priority ? plan.meta.priority.id : null,
  priorityName: plan.meta.priority ? plan.meta.priority.name : null, labels: ['worca'],
  criteria: plan.criteriaField ? { target: 'field', field: plan.criteriaField.id, name: plan.criteriaField.name } : { target: 'description' },
});

/** D10–D12: the feature, its criteria, A6's link (unless another feature follows the ticket) and the `imported` turn in one transaction;
 *  then the generated files (read at once), the downloading rows and their queue, then the form's own files. Nothing awaits a download.
 *  A file that cannot be stored never undoes the feature (A8): its name goes to filesNotStored. Accepted (plan review Minor 5): the
 *  turn's `comments` count (D14's "its comments are in …") is written with the feature, before the comments file is stored, so in the
 *  rare case that file lands in filesNotStored the thread line still names it and the round's <attachments> simply lacks it. */
export function createImported(scope, { title, description } = {}, plan, { by = null } = {}, d = {}) {
  const linked = linkByTicket({ ...plan.conn, key: plan.key });   // D12: one ticket follows one feature
  const at = new Date().toISOString();
  const f = tx(() => {
    const made = createFeature({ ...scope, title, description, criteria: plan.criteria }, { by });
    if (!linked) {
      saveExportLink(made.seq, { ...plan.conn, trackerProject: plan.meta.project || plan.key.split('-')[0], key: plan.key, url: plan.url, createdAt: at,
        exportedAt: at, spec: made.spec, fields: importFields(plan), fingerprint: plan.fingerprint, origin: 'import' }, { by });
    }
    appendTurn(made.seq, { kind: 'export', payload: { action: 'imported', tracker: plan.tracker, key: plan.key, url: plan.url, at, linked: !linked,
      ...(linked ? { linkedTo: linked.id } : {}), criteria: made.spec.criteria.map((c) => c.id), comments: plan.comments,
      files: plan.downloads.map((a) => a.name) } }, { by });
    return made;
  });
  const owner = { type: 'feature', id: f.seq };
  const from = { tracker: plan.tracker, key: plan.key };
  const filesNotStored = [];
  const lost = (names, err) => {
    console.error(`requirements: storing the files of new feature ${f.seq} failed:`, err && err.message ? err.message : err);
    const have = new Set(listAttachments('feature', f.seq).map((r) => r.name));
    filesNotStored.push(...names.filter((n) => !have.has(n)));
  };
  const store = (files, opts) => {
    if (!files.length) return;
    try { addAttachments(owner, files, { by, ...opts }, d); } catch (err) { lost(files.map((x) => x.name), err); }
  };
  store(plan.generated, { from });   // the comments (and description) file first, as board 35 lists them
  let rows = [];
  try {
    rows = tx(() => plan.downloads.map((a) => insertDownloadRow(owner, { conn: plan.conn, tracker: plan.tracker, key: plan.key, id: a.id, name: a.name,
      bytes: a.bytes, from }, { by })));
  } catch (err) { lost(plan.downloads.map((a) => a.name), err); }
  queueDownloads(owner, rows.map((r) => r.id), { by }, d);
  store(plan.diskFiles, {});
  return { seq: f.seq, filesNotStored, notOnTicket: plan.notOnTicket };
}
```

- [ ] **Step 4: `routes.mjs`.** Import `importView, importOptions, searchTickets, previewImport, prepareImport, createImported` from `./import.mjs`. In `REQUIREMENTS_ROUTES`, right after the A6 export-setup entries, add:

```js
  // A6.1 §6: start from a ticket, before the /:seq routes
  ['GET', `${P}/import/:scopeType/:scopeKey`], ['POST', `${P}/import/:scopeType/:scopeKey/options`],
  ['POST', `${P}/import/:scopeType/:scopeKey/search`], ['POST', `${P}/import/:scopeType/:scopeKey/preview`],
```

In `handlers`, after the A6 setup handlers:

```js
    // ---- A6.1: start from a ticket (plans/requirements-a61-design.md §6); every tracker call is server-side ----
    [`GET ${P}/import/:scopeType/:scopeKey`]: async (req, res) => {
      await checkTarget(...scope(req));
      res.json(await importView({ scopeType: req.params.scopeType, scopeKey: req.params.scopeKey }, { memberKeys: await memberKeysOf(...scope(req)) }, d));
    },
    [`POST ${P}/import/:scopeType/:scopeKey/options`]: async (req, res) => {
      await checkTarget(...scope(req));
      res.json(await importOptions({ scopeType: req.params.scopeType, scopeKey: req.params.scopeKey }, req.body || {}, d));
    },
    [`POST ${P}/import/:scopeType/:scopeKey/search`]: async (req, res) => {
      await checkTarget(...scope(req));
      res.json(await searchTickets({ scopeType: req.params.scopeType, scopeKey: req.params.scopeKey }, req.body || {}, d));
    },
    [`POST ${P}/import/:scopeType/:scopeKey/preview`]: async (req, res) => {
      await checkTarget(...scope(req));
      res.json(await previewImport({ scopeType: req.params.scopeType, scopeKey: req.params.scopeKey }, req.body || {}, d));
    },
```

Replace the start of the `POST ${P}` handler (up to and including `const f = createFeature(…)`) with:

```js
    [`POST ${P}`]: fileRoute(async (req, res) => {
      const b = req.body || {};
      await checkTarget(b.scopeType, b.scopeKey);
      const uploads = b.attachments === undefined ? [] : uploadsOf(b.attachments, { owner: 'feature', create: true });
      if (b.fromTicket !== undefined) {
        // A6.1 D10: capacity first; the ticket read again; then the feature at once, without waiting for any download
        assertCapacity();
        const s = { scopeType: b.scopeType, scopeKey: b.scopeKey };
        const plan = await prepareImport(s, b.fromTicket, { diskFiles: uploads }, d);
        assertCapacity();   // again: the read awaited the tracker; from here to the orientation nothing awaits
        const made = createImported(s, { title: b.title, description: b.description }, plan, { by: by(req) }, d);
        startOrientation(made.seq, { by: by(req) }, d);
        onChange(made.seq);
        return res.status(201).json({ ...(await featureView(made.seq, d)), filesNotStored: made.filesNotStored, notOnTicket: made.notOnTicket });
      }
      // A8 D2: the files are checked before anything is created, then stored and queued before the orientation
      const files = checkNewFiles('feature', [], uploads);
      assertCapacity();   // before creating: a refused start must not leave a feature stuck at "looking"
      const f = createFeature({ scopeType: b.scopeType, scopeKey: b.scopeKey, title: b.title, description: b.description }, { by: by(req) });
```

(the rest of the handler stays as it is.)

- [ ] **Step 5: Run the tests.** One at a time: `node tools/test.mjs test/requirements-import-api.test.mjs`, `node tools/test.mjs test/requirements-api.test.mjs` (the flag-off walk now covers the four routes), `node tools/test.mjs test/requirements-attachments-api.test.mjs`, `node tools/test.mjs test/requirements-export-api.test.mjs`, `node tools/test.mjs test/requirements-run-link.test.mjs` → all PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/core/requirements/import.mjs src/core/requirements/routes.mjs test/requirements-import-api.test.mjs test/requirements-run-link.test.mjs
git commit -m "Requirements: start the interview from a ticket, and the import routes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: An imported link in Export, and the import's thread line

**Files:**
- Modify: `src/core/requirements/markdown.mjs` (`criterionLine`, `renderTicketMarkdown`)
- Modify: `src/core/requirements/ticket.mjs` (`buildTicket`'s `ownKey`, `renderExportComment`'s `after`)
- Modify: `src/core/requirements/export.mjs` (`planExport`, `linkDates`, `exportView`'s history)
- Modify: `src/core/requirements/round.mjs` (`threadText`)
- Modify: `test/requirements-export.test.mjs`, `test/requirements-ticket.test.mjs`, `test/requirements-round.test.mjs`

**Interfaces:**
- Consumes: Task 1's `origin`; Task 2's `importThreadLine`; A6's `planExport`, `previewExport`, `runExport`, `exportView`.
- Produces:
  - `criterionLine(c, ownKey = null)` leaves "(from <ownKey>)" out; `renderTicketMarkdown(f, { …, ownKey = null })`; `buildTicket(f, { …, ownKey = null })` (an update passes its link's key; create and a new ticket pass none, so a new ticket keeps "(from SHOP-124)").
  - `renderExportComment(f, changes, { since, reason, after = 'export' })` — `after: 'import'` heads "Updated in Worca since the import (<since>)".
  - `linkDates(link)` (the preview's `link` and the feature view's `export.link`) gains `origin`, `importedOn` ("27 Oct", or null) and `sinceImport` (an imported link with no export since: `exportedAt === createdAt`).
  - `planExport`: an imported link's Update never takes the issue type, priority or criteria target from a setup (`setupRules` off for `origin === 'import'`); a comment on it is "since the import" while `sinceImport`.
  - `exportView(f).history` entries gain `linked: boolean | null` and `linkedTo: string | null`; `action: 'imported'` appears there.
  - `threadText(turns)` writes `asData(importThreadLine(payload))` for an `export` turn with `action: 'imported'`, and nothing for A6's other export turns.

- [ ] **Step 1: Write the failing tests.** Append to `test/requirements-ticket.test.mjs`:

```js
test('A6.1 D7, D11: the ticket built for the ticket a criterion came from leaves that source out; another source stays', () => {
  const f = { id: 'FEAT-8', title: 'Partial cancel', spec: { ...emptySpec(), criteria: [{ id: 'R-po-1', text: 'Cancel unpicked items.', source: 'SHOP-124' },
    { id: 'R-po-2', text: 'Refund the share.', source: 'refund-matrix.pdf' }] } };
  assert.equal(criterionLine(f.spec.criteria[0], 'SHOP-124'), 'R-po-1 Cancel unpicked items.');
  assert.equal(criterionLine(f.spec.criteria[0]), 'R-po-1 Cancel unpicked items. (from SHOP-124)');
  const t = buildTicket(f, { project: 'SHOP', issueType: '10001', exportedOn: '28 Oct 2026', ownKey: 'SHOP-124' });
  assert.match(t.description, /- R-po-1 Cancel unpicked items\.\n- R-po-2 Refund the share\. \(from refund-matrix\.pdf\)\n/);
  const field = buildTicket(f, { project: 'SHOP', issueType: '10001', exportedOn: '28 Oct 2026', ownKey: 'SHOP-124',
    criteria: { target: 'field', field: 'customfield_10070' } });
  assert.deepEqual(field.criteria.items, ['R-po-1 Cancel unpicked items.', 'R-po-2 Refund the share. (from refund-matrix.pdf)']);
});

test('A6.1 D11: the comment after an import says "since the import"', () => {
  assert.equal(renderExportComment({ id: 'FEAT-8' }, [{ kind: 'goal', field: 'text', before: '', after: 'Cancel part' }], { since: '27 Oct', after: 'import' }),
    'Updated in Worca since the import (27 Oct)\n\nGoal: added “Cancel part”\n\nFrom Worca FEAT-8\n');
});
```

Append to `test/requirements-round.test.mjs` (add `threadText` to its import from `round.mjs`, and `import { renderAttachmentsForPrompt } from '../src/core/requirements/attachments.mjs';`):

```js
test("A6.1 D14: an import writes one thread line, as data; A6's other export turns write none, so a feature that was not imported keeps its thread byte for byte", () => {
  const base = [{ id: 1, kind: 'round', payload: { questions: [] } }];
  const exported = [{ id: 2, kind: 'export', payload: { action: 'created', tracker: 'Jira', key: 'SHOP-1' } }];
  assert.equal(threadText([...base, ...exported]), threadText(base));
  const imported = { id: 0, kind: 'export', payload: { action: 'imported', tracker: 'Jira', key: 'SHOP-124', criteria: ['R-po-1', 'R-po-2', 'R-po-3'], comments: 5 } };
  assert.equal(threadText([imported]),
    'The product owner started this feature from Jira ticket SHOP-124. Its acceptance criteria are R-po-1 to R-po-3; its comments are in “SHOP-124 comments.md”.');
  assert.ok(!threadText([{ ...imported, payload: { ...imported.payload, key: 'SHOP-1<b>' } }]).includes('<b>'), 'asData escapes it');
});

test("A6.1 §9 (Prompts): an imported feature's round 1 prompt has the import line in <thread>, the comments file's full text in <attachments>, and a file still downloading by name only", () => {
  const comments = '# Comments on SHOP-124\n\n**Ann Example** · 21 Oct 2026\nWarehouse confirms items are picked per parcel.\n';
  const rows = [
    { id: 'ratt_000000000001', name: 'SHOP-124 comments.md', kind: 'text', bytes: Buffer.byteLength(comments), status: 'done', summary: 'Items are picked per parcel.',
      summaryEdited: false, asks: [] },
    { id: 'ratt_000000000002', name: 'partial-cancel-flow.pdf', kind: 'binary', bytes: 1258291, status: 'downloading', summary: '', summaryEdited: false, asks: [],
      fetch: { tracker: 'Jira', key: 'SHOP-124' } },
  ];
  const attachments = renderAttachmentsForPrompt(rows, { texts: new Map([['ratt_000000000001', comments]]) });
  const turns = [{ id: 1, kind: 'export', payload: { action: 'imported', tracker: 'Jira', key: 'SHOP-124', criteria: ['R-po-1', 'R-po-2', 'R-po-3'], comments: 1 } }];
  const p = buildRoundPrompt({ feature: { id: 'FEAT-8', title: 'Partial cancel', description: 'd', spec: emptySpec() }, turns, attachments, round: 1 });
  const block = (tag) => (new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(p) || [])[1];
  assert.equal(block('thread'),
    'The product owner started this feature from Jira ticket SHOP-124. Its acceptance criteria are R-po-1 to R-po-3; its comments are in “SHOP-124 comments.md”.');
  assert.ok(block('attachments').includes(`SHOP-124 comments.md (text, ${Buffer.byteLength(comments)} B)\nWhat Worca took from it:\nItems are picked per parcel.\nFull text:\n${comments}`));
  assert.ok(block('attachments').includes('partial-cancel-flow.pdf (PDF, 1.2 MB): being downloaded from SHOP-124; known by name only.'));
});
```

Append to `test/requirements-export.test.mjs` (add `saveExportLink` to its store import and `import { exportTime } from '../src/core/requirements/ticket.mjs';`):

```js
// ── A6.1: a link an import made (plans/requirements-a61-design.md D11) ──
const IMPORTED_AT = '2026-10-27T09:12:00.000Z';
/** A Ready feature that started from SHOP-124 (a Bug, High) and has not been exported since. */
function importedFeature(scopeKey = SCOPE.scopeKey) {
  const f = createFeature({ scopeType: 'project', scopeKey, title: 'Partial cancel', description: 'From SHOP-124',
    criteria: [{ text: 'A customer can cancel unpicked items.', source: 'SHOP-124' }] });
  appendTurn(f.seq, { kind: 'export', payload: { action: 'imported', tracker: 'Jira', key: 'SHOP-124', url: 'https://mock.test/browse/SHOP-124', at: IMPORTED_AT,
    linked: true, criteria: ['R-po-1'], comments: 2, files: [] } });
  saveExportLink(f.seq, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', trackerProject: 'SHOP', key: 'SHOP-124', url: 'https://mock.test/browse/SHOP-124',
    createdAt: IMPORTED_AT, exportedAt: IMPORTED_AT, spec: f.spec, fingerprint: 'fp-import', origin: 'import',
    fields: { projectName: 'Shop web', issueType: '10003', issueTypeName: 'Bug', priority: '2', priorityName: 'High', labels: ['worca'], criteria: { target: 'description' } } });
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
  return updateFeature(f.seq, { status: 'done', spec: { ...f.spec, goal: { text: 'Customers cancel part of an order', measure: 'fewer calls' } } });
}

test("A6.1 D11: an imported link's Update keeps the ticket's issue type and priority (a setup on the same connection does not apply) and leaves its own key out", async () => {
  reset();
  const f = importedFeature();
  const p = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
  assert.deepEqual([p.ticket.issueType, p.ticket.priority, p.fields.issueType.label, p.fields.priority.label], ['10003', '2', 'Bug', 'High']);
  assert.match(p.ticket.description, /- R-po-1 A customer can cancel unpicked items\.\n/);
  assert.ok(!/\(from SHOP-124\)/.test(p.ticket.description));
  assert.deepEqual([p.link.origin, p.link.importedOn, p.link.sinceImport], ['import', '27 Oct', true]);
  const r = await runExport(f.seq, { mode: 'update', previewHash: p.previewHash }, { by: 'po', target: TARGET }, d);
  assert.equal(r.action, 'updated');
  const l = getExportLink(f.seq);
  assert.deepEqual([l.origin, l.createdAt, l.exportedAt === IMPORTED_AT], ['import', IMPORTED_AT, false]);
  assert.equal((await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d)).link.sinceImport, false);
});

test("A6.1 D11: the comment is \"since the import\" until the first export; the edited check compares with the import's fingerprint", async () => {
  reset();
  const f = importedFeature();
  const c = await previewExport(f.seq, { mode: 'comment' }, { target: TARGET }, d);
  assert.match(c.comment, /^Updated in Worca since the import \(27 Oct\)\n\n/);
  setMockSourceResponses({ ticketState: () => ({ exists: true, url: 'https://mock.test/browse/SHOP-124', fingerprint: 'fp-edited-in-jira' }) });
  assert.equal((await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d)).edited, true);
  setMockSourceResponses({ ticketState: () => ({ exists: true, url: 'https://mock.test/browse/SHOP-124', fingerprint: 'fp-import' }) });
  assert.equal((await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d)).edited, false);
});

test('A6.1 D11: without an export setup an imported feature still updates; a new ticket needs the setup and makes an ordinary export link', async () => {
  reset();
  const f = importedFeature('shop-no-setup');
  const p = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
  assert.equal((await runExport(f.seq, { mode: 'update', previewHash: p.previewHash }, { by: 'po', target: TARGET }, d)).key, 'SHOP-124');
  await assert.rejects(previewExport(f.seq, { mode: 'new' }, { target: TARGET }, d), (e) => e.message === 'Set up the export first.');
  const g = importedFeature();
  const n = await previewExport(g.seq, { mode: 'new' }, { target: TARGET }, d);
  assert.match(n.ticket.description, /\(from SHOP-124\)/, 'a new ticket keeps where the criterion came from');
  await runExport(g.seq, { mode: 'new', previewHash: n.previewHash }, { by: 'po', target: TARGET }, d);
  assert.equal(getExportLink(g.seq).origin, 'export');
});

test("A6.1: the feature's export view carries the origin and the import's History entry", async () => {
  reset();
  const f = importedFeature();
  const v = await exportView(getFeature(f.seq), listTurns(f.seq), d);
  assert.deepEqual([v.link.origin, v.link.importedOn, v.link.sinceImport], ['import', '27 Oct', true]);
  const h = v.history.find((x) => x.action === 'imported');
  assert.deepEqual([h.key, h.tracker, h.linked, h.linkedTo, h.when], ['SHOP-124', 'Jira', true, null, exportTime(IMPORTED_AT)]);
});
```

- [ ] **Step 2: Run them to see them fail.** `node tools/test.mjs test/requirements-ticket.test.mjs` → FAIL ("(from SHOP-124)" still there). `node tools/test.mjs test/requirements-round.test.mjs` → FAIL (no import line; the prompt test's `<thread>` is empty). `node tools/test.mjs test/requirements-export.test.mjs` → FAIL (`p.ticket.issueType` is the setup's `10001`).

- [ ] **Step 3: `markdown.mjs`.**

```js
/** A criterion as one ticket line (A6 D4): "R-po-1 <text>", with A8's "(from <name>)" — except in the ticket the criterion came
 *  from (A6.1 D7: `ownKey`). */
export const criterionLine = (c, ownKey = null) => `${c.id} ${c.text}${ownKey && c.source === ownKey ? '' : from(c)}`;
```

and `renderTicketMarkdown(f, { reason = null, exportedOn, criteriaInDescription = true, mentionedFiles = [], ownKey = null } = {})` with its criteria line `section('Acceptance criteria', s.criteria.length ? bullets(s.criteria.map((c) => criterionLine(c, ownKey))) : '');`. (The two callers that passed `criterionLine` point-free, `markdown.mjs` here and `ticket.mjs` below, are the only ones in the code; after this task none is left, so `.map` can never hand its index in as `ownKey`. Keep any new caller an arrow.)

- [ ] **Step 4: `ticket.mjs`.** `buildTicket(f, { …, mentionedFiles = [], ownKey = null } = {})`: pass `ownKey` to `renderTicketMarkdown` and use `items: f.spec.criteria.map((c) => criterionLine(c, ownKey))`. `renderExportComment(f, changes, { since, reason = null, after = 'export' } = {})` starts with `const out = [\`Updated in Worca since the ${after === 'import' ? 'import' : 'last export'} (${since})\`];` and its comment adds "A6.1 D11: 'since the import' until the first export of an imported link."

- [ ] **Step 5: `export.mjs`.**
  - above `linkDates`: `/** A6.1 D11: an imported link that no export has touched since. */ const sinceImport = (l) => !!l && l.origin === 'import' && !!l.createdAt && l.exportedAt === l.createdAt;`
  - `linkDates`:

```js
const linkDates = (l) => ({ key: l.key, madeOn: exportDate(l.createdAt, { year: false }), lastOn: exportDate(l.exportedAt, { year: false }),
  origin: l.origin || 'export', importedOn: l.origin === 'import' ? exportDate(l.createdAt, { year: false }) : null, sinceImport: sinceImport(l) });
```

  - in `planExport`: the comment's `renderExportComment(f, changes, { since: exportDate(link.exportedAt, { year: false }), reason, after: sinceImport(link) ? 'import' : 'export' })`; `const setupRules = mode === 'update' && link.origin !== 'import' && setup && sameConn(setup, link) && setup.trackerProject === link.trackerProject;` (comment: "A6.1 D11: an imported ticket keeps its own issue type and priority, so a Bug stays a Bug"); and `buildTicket(f, { …, mentionedFiles: mentionedFiles(f).map(oneLine), ownKey: mode === 'update' ? link.key : null })`.
  - `exportView`'s history mapping gains `linked: t.payload.action === 'imported' ? t.payload.linked !== false : null, linkedTo: t.payload.linkedTo || null,`.

- [ ] **Step 6: `round.mjs`.** Add `import { importThreadLine } from './ticket-import.mjs';` with the comment "(ticket-import.mjs reaches round.mjs back through attachments.mjs; neither uses the other at module top level)". In `threadText`, after the `start` branch:

```js
    } else if (t.kind === 'export') {   // A6: no line; A6.1 D14: the import writes one, as data
      if (t.payload && t.payload.action === 'imported') lines.push(asData(importThreadLine(t.payload)));
```

- [ ] **Step 7: Run the tests.** One at a time: `node tools/test.mjs test/requirements-ticket.test.mjs`, `test/requirements-round.test.mjs`, `test/requirements-export.test.mjs`, `test/requirements-export-api.test.mjs`, `test/requirements-helper.test.mjs` (A3's prompt carries the same thread), `test/requirements-interview.test.mjs` → all PASS. The A2 pinned-literal prompt test in `requirements-round.test.mjs` must still pass unchanged.

- [ ] **Step 8: Commit.**

```bash
git add src/core/requirements/markdown.mjs src/core/requirements/ticket.mjs src/core/requirements/export.mjs src/core/requirements/round.mjs test/requirements-ticket.test.mjs test/requirements-round.test.mjs test/requirements-export.test.mjs
git commit -m "Requirements: an imported link in Export, and the import's thread line" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Start from a ticket (the page)

Every UI task below edits `ui/public/requirements-view.mjs` (CRLF on Windows: keep it) and adds CSS inside the Requirements block of `ui/public/style.css`, right before `/* ── marketplace P3 ── */`. Run `node --check ui/public/requirements-view.mjs` before the tests; after the commit `git diff HEAD~1 --stat` must show only the lines the task changed.

### Task 11: The page — From a ticket… and the pick (boards 32, 33)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`paintNew`: the button and its label row; new functions after `historyCard`)
- Modify: `ui/public/style.css` (the A6.1 block: the pick, desktop)
- Create: `test/requirements-view-import.test.mjs`

**Interfaces:**
- Consumes: Task 9's routes (`GET /api/requirements/import/:scopeType/:scopeKey`, `POST …/options`, `…/search`); A6's page helpers `openModal`, `closeDialog`, `dlgGen`, `live`, `exportSelect`, `syncSelect`, `connValue`, `connFrom`, `errText`; `sharedIcon`.
- Produces (inside `createRequirementsView`; Task 12 consumes exactly these names):
  - `importPrefs` — `{ conn, project } | null`, the page session's last connection and project (D3).
  - `importUrl(scope, path = '') → '/api/requirements/import/<type>/<key><path>'`; `importErr(err) → string` (a gone ticket's 404 says its own sentence); `pickTracker(pickState) → string`; `importBack() → HTMLElement` (the sheet's **← New feature**).
  - `openPick(ctx, keep = null)` — `ctx = { scope: () => ({ scopeType, scopeKey }), trigger: HTMLElement, formFiles: () => ({ count, bytes }), onUse: (ticket, pick) => void }` (`onUse` from Task 12); `keep` is the pick state Back returns to: `{ info, conn, project, projects, search, searched, tickets, cursor, chosen, seq, projSeq }`. **Continue** calls `openImportPreview(ctx, st)`, a stand-in here that Task 12 replaces.
  - `paintNew`: `fromBtn` (`data-ui="import-open"`), `importCtx` (without `onUse` until Task 12).

- [ ] **Step 1: Write the failing test** `test/requirements-view-import.test.mjs` (Tasks 12, 13 and 14 append to it):

```js
// test/requirements-view-import.test.mjs — New feature › From a ticket… in jsdom with a fake API (plans/requirements-a61-design.md §7,
// D1, D3–D9, D12, D19; boards 32–34, 36). No server, no tracker. People are made-up names.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#requirements/new' });
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
    return { ok: status < 400, status, json: async () => out ?? { error: 'not found' }, text: async () => '' };
  };
  return calls;
}
const BASE = { 'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop' }] }, 'GET /api/workspaces': { workspaces: [] },
  'GET /api/requirements': { features: [], interview: null, lookCostUsd: null, briefs: [], readEstimates: {} } };
const IMP = '/api/requirements/import/project/shop-1';
const CONN = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const ACME = { id: 'acme', label: 'acme.atlassian.net (Cloud)' };
const SOURCES = { sources: [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira', profiles: [ACME] }], defaultConnection: CONN, defaultProject: 'SHOP' };
const T = (key, title, type, status, updatedOn, linkedTo = null) => ({ key, title, url: `https://acme.test/browse/${key}`, type, status, updatedOn, linkedTo });
const TICKETS = [T('SHOP-124', 'Partial cancel for multi-item orders', 'Story', 'In progress', '25 Oct'),
  T('SHOP-123', 'Cancel an order before it ships', 'Story', 'To do', '26 Oct', { id: 'FEAT-7', title: 'Cancel an order before it ships' }),
  T('SHOP-131', 'Cancel button hidden on the mobile order page', 'Bug', 'To do', '24 Oct'), T('SHOP-98', 'Refund to store credit after a cancel', 'Story', 'Done', '12 Oct')];
const searchAnswer = (b) => { const s = String(b.search || '').toLowerCase(); return { tickets: TICKETS.filter((t) => !s || t.title.toLowerCase().includes(s) || t.key.toLowerCase() === s) }; };
const PREVIEW = (over = {}) => ({
  key: 'SHOP-124', url: 'https://acme.test/browse/SHOP-124', tracker: 'Jira', connection: 'acme.atlassian.net (Cloud)',
  meta: { project: 'SHOP', projectName: 'Shop web', type: { id: '10001', name: 'Story' }, status: 'In progress', priority: { id: '3', name: 'Medium' } },
  title: 'Partial cancel for multi-item orders',
  description: 'When an order has several items, customers cannot cancel the rest.\n\n(image: packing-slip.png)\n\n<img src=x onerror=alert(1)> stays text',
  descriptionFile: null, clipped: false, redacted: 1,
  criteria: { from: 'section', name: 'Acceptance criteria', field: null, picked: [true, true, true],
    items: ['A customer can cancel the items not picked up.', 'Shipped items stay on the order.', 'The refund covers only the cancelled items.'] },
  comments: [
    { id: '10231', author: 'Ann Example', authorKind: 'person', created: '2026-10-21T09:30:00.000Z', when: '21 Oct', body: 'Picked per parcel.', bytes: 60, picked: true },
    { id: '10234', author: 'Jira Automation', authorKind: 'app', created: '2026-10-23T09:00:00.000Z', when: '23 Oct', body: 'Status changed to In progress.', bytes: 70, picked: false },
    { id: '10236', author: 'Bo Example', authorKind: 'person', created: '2026-10-25T11:10:00.000Z', when: '25 Oct', body: 'Sandbox token ghp_<redacted>', bytes: 66, picked: true }],
  commentsTotal: 4, restrictedComments: 1, olderComments: 0,
  attachments: [
    { id: '10041', name: 'packing-slip.png', kind: 'image', mime: 'image/png', bytes: 860160, refused: null, picked: true, capped: null },
    { id: '10042', name: 'partial-cancel-flow.pdf', kind: 'binary', mime: 'application/pdf', bytes: 1258291, refused: null, picked: true, capped: null },
    { id: '10044', name: 'refund-matrix.xlsx', kind: null, mime: '', bytes: 98304, refused: 'Not offered: Worca reads text, images and PDF. Save it as PDF to attach it here.', picked: false, capped: null }],
  linkedTo: null, ...over });
const ROUTES = (over = {}) => ({ ...BASE, [`GET ${IMP}`]: SOURCES,
  [`POST ${IMP}/options`]: { projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }] },
  [`POST ${IMP}/search`]: searchAnswer, [`POST ${IMP}/preview`]: () => PREVIEW(), ...over });
const make = () => {
  const host = document.createElement('div'); const msgEl = document.createElement('p'); const subEl = document.createElement('div');
  const nav = document.createElement('nav');
  document.body.replaceChildren(nav, host);
  const routed = [];
  const view = createRequirementsView({ host, subEl, msgEl, deps: { route: (p) => routed.push(p) } });
  return { host, msgEl, nav, view, routed };
};
const openNew = async (routes = ROUTES()) => { const calls = fakeApi(routes); const m = make(); await m.view.show('new'); await settle(); return { ...m, calls }; };
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const dlg = () => document.querySelector('.req-dlg-wrap [role="dialog"]');
const q = (ui, root = document) => root.querySelector(`[data-ui="${ui}"]`);
const optionTexts = (sel) => [...sel.options].map((o) => o.textContent);
const others = () => [...document.body.children].filter((el) => !el.classList.contains('req-dlg-wrap'));
const typeSearch = async (value) => { const s = q('pick-search'); s.value = value; s.dispatchEvent(new window.Event('input')); await new Promise((r) => setTimeout(r, 350)); await settle(); };

test('D1 (board 32): From a ticket… sits at the right of Describe it once a connection can import; without one it is absent', async () => {
  const none = await openNew(ROUTES({ [`GET ${IMP}`]: { sources: [], defaultConnection: null, defaultProject: null } }));
  assert.equal(q('import-open', none.host).hidden, true);
  none.view.destroy();
  const m = await openNew();
  const b = q('import-open', m.host);
  assert.deepEqual([b.hidden, b.textContent, b.getAttribute('aria-haspopup'), b.className], [false, 'From a ticket…', 'dialog', 'btn btn-sm req-import-open']);
  assert.ok(b.closest('.req-import-labrow').querySelector('label[for="req-new-desc"]'), 'in the Describe it label row');
  m.view.destroy();
});

test('board 33: Start from a ticket is a modal dialog, its title focused, the page inert; SHOP; recently updated; the radio group "Tickets"; Escape returns the focus', async () => {
  const m = await openNew();
  q('import-open', m.host).click();
  await settle();
  const dl = dlg();
  assert.deepEqual([dl.getAttribute('aria-modal'), dl.getAttribute('aria-labelledby'), text(dl.querySelector('h2'))], ['true', 'req-pick-title', 'Start from a ticket']);
  assert.equal(document.activeElement, dl.querySelector('h2'));
  assert.ok(others().every((el) => el.hasAttribute('inert')), 'every other child of <body> is inert');
  assert.equal(text(dl.querySelector('#req-pick-desc')), 'Pick the ticket this feature starts from. Worca reads it through your Jira connection and changes nothing in Jira.');
  assert.equal(text(dl.querySelector('label[for="req-pick-project"]')), 'Jira project');
  assert.deepEqual([q('pick-project').value, optionTexts(q('pick-project'))], ['SHOP', ['All projects', 'SHOP — Shop web', 'OPS — Operations']]);
  assert.equal(q('pick-conn'), null, 'one connection: no Connection select');
  assert.equal(text(dl.querySelector('.req-import-status')), 'Recently updated in SHOP');
  const group = dl.querySelector('[role="radiogroup"]');
  assert.equal(group.getAttribute('aria-label'), 'Tickets');
  assert.deepEqual([...group.querySelectorAll('input[type="radio"]')].map((r) => r.getAttribute('aria-label')),
    TICKETS.map((t) => `${t.key} ${t.title}`));
  const row = q('pick-SHOP-123').closest('label');
  assert.deepEqual([text(row.querySelector('.hint')), text(row.querySelector('.req-import-linkchip'))], ['Story · To do · updated 26 Oct', 'Linked to FEAT-7']);
  assert.equal(q('pick-continue').disabled, true);
  q('pick-SHOP-124').click();
  assert.equal(q('pick-continue').disabled, false);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(dlg(), null);
  assert.equal(document.activeElement, q('import-open', m.host));
  assert.ok([...document.body.children].every((el) => !el.hasAttribute('inert')), 'the page is released');
  m.view.destroy();
});

test('D4: typing searches 300 ms after the last key, with the last words; the count line; an older answer that lands late is dropped', async () => {
  let first = null;
  const m = await openNew(ROUTES({ [`POST ${IMP}/search`]: (b) => (b.search === 'can'
    ? new Promise((r) => { first = () => r({ tickets: [TICKETS[2]] }); }) : searchAnswer(b)) }));
  q('import-open', m.host).click();
  await settle();
  const box = q('pick-search');
  assert.deepEqual([box.type, box.getAttribute('aria-describedby'), box.placeholder], ['search', 'req-pick-paste', 'Search by key or words']);
  box.value = 'ca'; box.dispatchEvent(new window.Event('input'));
  box.value = 'can'; box.dispatchEvent(new window.Event('input'));
  await new Promise((r) => setTimeout(r, 350));
  await settle();
  assert.deepEqual(m.calls.filter((c) => c.url === `${IMP}/search` && c.body.search).map((c) => c.body.search), ['can'], 'one search, the last words');
  assert.equal(text(dlg().querySelector('.req-import-status .badge')), 'Searching SHOP…');
  await typeSearch('cancel');
  assert.equal(text(dlg().querySelector('.req-import-status')), '4 tickets in SHOP match “cancel”.');
  first();
  await settle();
  assert.equal(dlg().querySelectorAll('[role="radiogroup"] input').length, 4, 'the late answer for "can" changed nothing');
  m.view.destroy();
});

test('D3, D4: Show more adds the next page with its cursor; several connections: a Connection select led by the tracker when several import', async () => {
  const m = await openNew(ROUTES({
    [`GET ${IMP}`]: { sources: [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira', profiles: [ACME, { id: 'beta', label: 'jira.beta.test (Data Center)' }] },
      { plugin: 'gh-issues', sourceId: 'issues', name: 'GitHub', profiles: [{ id: null, label: 'GitHub' }] }], defaultConnection: CONN, defaultProject: null },
    [`POST ${IMP}/search`]: (b) => (b.cursor ? { tickets: [TICKETS[3]] } : { tickets: TICKETS.slice(0, 3), cursor: 'p2' }),
  }));
  q('import-open', m.host).click();
  await settle();
  assert.deepEqual(optionTexts(q('pick-conn')), ['Jira · acme.atlassian.net (Cloud)', 'Jira · jira.beta.test (Data Center)', 'GitHub · GitHub']);
  assert.equal(q('pick-project').value, '', 'no setup: All projects');
  assert.equal(text(dlg().querySelector('.req-import-status')), 'Recently updated');
  q('pick-more').click();
  await settle();
  assert.equal(m.calls.filter((c) => c.url === `${IMP}/search`).at(-1).body.cursor, 'p2');
  assert.equal(dlg().querySelectorAll('[role="radiogroup"] input').length, 4);
  assert.equal(q('pick-more').hidden, true);
  m.view.destroy();
});

test('a search that fails says why with Try again; Try again searches again', async () => {
  let fail = true;
  const m = await openNew(ROUTES({ [`POST ${IMP}/search`]: (b) => (fail ? { __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' } } : searchAnswer(b)) }));
  q('import-open', m.host).click();
  await settle();
  assert.equal(text(dlg().querySelector('.req-export-alert')), 'Worca could not reach Jira: the API token was refused.');
  fail = false;
  q('pick-retry').click();
  await settle();
  assert.deepEqual([text(dlg().querySelector('.req-export-alert')), q('pick-retry').hidden, dlg().querySelectorAll('[role="radiogroup"] input').length], ['', true, 4]);
  m.view.destroy();
});

test('CSS: the pick\'s rules sit inside the Requirements block, use tokens only, and a picked ticket row is an ink border', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  for (const sel of ['.req-import-labrow', '.req-import-search', '.req-import-ticket', '.req-import-results']) {
    const at = css.indexOf(sel);
    assert.ok(at > start && at < end, `${sel} inside the Requirements block`);
  }
  const mine = css.slice(start, end).split('\n').filter((l) => /req-import/.test(l));
  const bad = /#[0-9a-fA-F]{3,8}\b|rgba?\(|font(?:-size)?:[^;}]*\b(?:11\.5|12\.5|14)px|border-radius:(?:12|999)px|min-height:44px|background:var\(--green/;
  assert.ok(mine.every((l) => !bad.test(l)), mine.filter((l) => bad.test(l)).join('\n'));
  assert.match(css, /\.req-import-ticket:has\(input:checked\)\{border-color:var\(--ink\)\}/);
});
```

- [ ] **Step 2: Run it to see it fail.** `node tools/test.mjs test/requirements-view-import.test.mjs` → FAIL (no `[data-ui="import-open"]`).

- [ ] **Step 3: `paintNew` — the button.** After `const desc = h('textarea', …);` add:

```js
    // A6.1 (board 32, D1): From a ticket… at the right of the Describe it label, shown once a connection can import (no nudge without one)
    const scopeNow = () => { const [scopeType, ...rest] = select.value.split(':'); return { scopeType, scopeKey: rest.join(':') }; };
    const fromBtn = h('button', { type: 'button', class: 'btn btn-sm req-import-open', 'data-ui': 'import-open', 'aria-haspopup': 'dialog', hidden: true,
      onclick: () => openPick(importCtx, null) }, 'From a ticket…');
    // the preview's caps count the files already picked on this form (D9); Task 12 adds `onUse` (Use this ticket)
    const importCtx = { scope: scopeNow, trigger: fromBtn, formFiles: () => ({ count: picked.length, bytes: picked.reduce((n, p) => n + p.size, 0) }) };
    if (select.value) {
      const mine = paintNo;
      api('GET', importUrl(scopeNow())).then((r) => { if (mine === paintNo && r && Array.isArray(r.sources) && r.sources.length) fromBtn.hidden = false; }, () => {});
    }
```

Replace the Describe it field in `paintHost(…)`, `field('req-new-desc', ['Describe it ', h('span', { class: 'opt', text: 'who needs it, what they want to do, and why' })], desc),`, with:

```js
        h('div', { class: 'field' },
          h('div', { class: 'req-import-labrow' },
            h('label', { for: 'req-new-desc' }, 'Describe it ', h('span', { class: 'opt', text: 'who needs it, what they want to do, and why' })), fromBtn),
          desc),
```

- [ ] **Step 4: The pick.** After `historyCard` and before `// A repaint from the feature on screen, without a fetch`, add:

```js
  // ---- A6.1: start from a ticket (plans/requirements-a61-design.md §7, boards 32–36). Both dialogs are the page's modal with the page
  // behind inert (openModal's `page`; closeDialog and leave() release it); dlgGen drops an answer for a dialog that is gone and a
  // search's own number drops one a newer search superseded. Ticket text is set with textContent only, never as HTML. ----
  let importPrefs = null;   // D3: the connection and project last used, for the page session: { conn, project }
  const importUrl = (s, path = '') => `/api/requirements/import/${s.scopeType}/${encodeURIComponent(s.scopeKey)}${path}`;
  const SEARCH_MS = 300;
  const pastedKeyOf = (v) => {
    const s = String(v || '').trim();
    if (/^[A-Z][A-Z0-9_]*-\d+$/i.test(s)) return s.toUpperCase();
    const m = /(?:\/browse\/|[?&]selectedIssue=)([A-Z][A-Z0-9_]*-\d+)\b/i.exec(s);
    return m ? m[1].toUpperCase() : null;
  };
  /** An import route's refusal: a gone ticket answers 404 with `gone` and its own sentence, which is not the flag's 404. */
  const importErr = (err) => (err && err.data && err.data.gone && typeof err.data.error === 'string' ? err.data.error : errText(err));
  const sameConnUi = (a, b) => !!a && !!b && a.plugin === b.plugin && a.sourceId === b.sourceId && (a.profile || null) === (b.profile || null);
  /** The tracker's name for a pick's connection (its source's displayName). */
  const pickTracker = (st) => {
    const src = st && st.info && st.conn ? (st.info.sources || []).find((x) => x.plugin === st.conn.plugin && x.sourceId === st.conn.sourceId) : null;
    return (src && src.name) || 'the tracker';
  };
  /** D19 (board 36): a sheet's way back to New feature (shown at 900 px and narrower only, by A6's CSS). */
  const importBack = () => h('button', { type: 'button', class: 'link-btn req-export-back', 'data-ui': 'import-back', 'aria-label': 'Back to New feature',
    onclick: () => { if (dialog && dialog.canClose()) closeDialog(true); } }, '← New feature');

  /** Start from a ticket (board 33; D3, D4, D19). `keep`: the pick Back comes back to (its search, results and choice). */
  function openPick(ctx, keep = null) {
    closeDialog(false);
    const s = ctx.scope();
    const st = keep || { info: null, conn: null, project: '', projects: [], search: '', searched: '', tickets: [], cursor: null, chosen: null, seq: 0, projSeq: 0 };
    let timer = null;
    const title = h('h2', { id: 'req-pick-title', tabindex: '-1', text: 'Start from a ticket' });
    const lead = h('p', { class: 'req-dlg-lead', id: 'req-pick-desc' });
    const connField = h('div', { class: 'field req-export-fld', hidden: true });
    const projLabel = h('label', { for: 'req-pick-project' });
    const projSel = h('select', { id: 'req-pick-project', 'data-ui': 'pick-project' });
    const search = h('input', { type: 'search', id: 'req-pick-search', 'data-ui': 'pick-search', placeholder: 'Search by key or words',
      'aria-describedby': 'req-pick-paste', autocomplete: 'off' });
    const status = h('p', { class: 'req-import-status', role: 'status' });   // one node: "Searching SHOP…", then the count line
    const empty = h('p', { class: 'hint req-import-empty', hidden: true, text: "Try other words, or paste the ticket's key or link." });
    const failEl = h('p', { class: 'form-msg err req-export-alert', role: 'alert' });
    const note = h('p', { class: 'hint req-import-note', hidden: true }, 'Nothing was changed.', h('span', { 'data-min-level': 'advanced' }));
    const retry = h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'pick-retry', hidden: true, onclick: () => { void (st.info ? run() : load()); } }, 'Try again');
    const results = h('div', { class: 'req-import-results', role: 'radiogroup', 'aria-label': 'Tickets' });
    const more = h('button', { type: 'button', class: 'btn btn-sm req-import-more', 'data-ui': 'pick-more', hidden: true, onclick: () => { void run({ next: true }); } },
      'Show more');
    const cont = h('button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'pick-continue', disabled: true,
      onclick: () => { if (!st.chosen) return; importPrefs = { conn: st.conn, project: st.project }; openImportPreview(ctx, st); } }, 'Continue');
    const card = h('section', { class: 'card req-dialog req-export req-import req-import-pick', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'req-pick-title', 'aria-describedby': 'req-pick-desc' },
      importBack(), title, lead, connField,
      h('div', { class: 'field req-export-fld' }, projLabel, h('div', { class: 'select-wrap' }, projSel)),
      h('div', { class: 'field req-export-fld' }, h('label', { for: 'req-pick-search' }, 'Find a ticket'),
        h('div', { class: 'req-import-search' }, sharedIcon(document, 'search', 14), search),
        h('p', { class: 'hint', id: 'req-pick-paste', text: "Paste a ticket's key or link to find it in any project." })),
      status, empty, failEl, note, retry, results, more,
      h('div', { class: 'req-dlg-btns' },
        h('button', { type: 'button', class: 'btn', 'data-ui': 'pick-cancel', onclick: () => closeDialog(true) }, 'Cancel'), cont));
    openModal(card, { trigger: ctx.trigger, first: title, page: true });
    const g = dlgGen;
    const where = () => st.project || null;
    // D16 (board 36, 1): the server's sentence; for a tracker that could not be reached also "Nothing was changed." and, at the
    // Advanced level, where the connection is fixed
    const showFail = (err) => {
      status.textContent = '';
      failEl.textContent = importErr(err);
      note.lastChild.textContent = ` Fix the connection on the Marketplace page (Installed › ${pickTracker(st)}), then try again.`;
      note.hidden = !(err && err.status === 502);
      retry.hidden = false;
    };
    const clearFail = () => { failEl.textContent = ''; note.hidden = true; retry.hidden = true; };
    const countText = () => {
      const typed = st.searched;
      if (!typed) return where() ? `Recently updated in ${where()}` : 'Recently updated';
      const n = st.tickets.length;
      const key = pastedKeyOf(typed);
      if (!n) {
        return key ? `${key} was not found in ${pickTracker(st)}, or this connection cannot see it.`
          : where() ? `No ticket in ${where()} matches “${typed}”.` : `No ticket matches “${typed}”.`;
      }
      const verb = n === 1 ? 'matches' : 'match';
      return where() ? `${plural(n, 'ticket')} in ${where()} ${verb} “${typed}”.` : `${plural(n, 'ticket')} ${verb} “${typed}”.`;
    };
    function render() {
      status.textContent = countText();
      empty.hidden = !(st.searched && !st.tickets.length && !pastedKeyOf(st.searched));
      results.replaceChildren(...st.tickets.map((t) => {
        const radio = h('input', { type: 'radio', name: 'req-pick-ticket', value: t.key, 'data-ui': `pick-${t.key}`, 'aria-label': `${t.key} ${t.title}` });
        radio.checked = st.chosen === t.key;
        radio.addEventListener('change', () => { if (radio.checked) { st.chosen = t.key; cont.disabled = false; } });
        return h('label', { class: 'req-import-ticket' }, radio,
          h('span', { class: 'req-import-ticket-txt' },
            h('span', { class: 'req-import-ticket-head' }, h('b', { text: t.key }), ' ', h('span', { text: t.title })),
            h('span', { class: 'hint', text: [t.type, t.status, t.updatedOn ? `updated ${t.updatedOn}` : null].filter(Boolean).join(' · ') })),
          t.linkedTo ? h('span', { class: 'chip req-import-linkchip', text: `Linked to ${t.linkedTo.id}` }) : null);
      }));
      more.hidden = !st.cursor;
      cont.disabled = !st.chosen;
    }
    async function run({ next = false } = {}) {
      if (!st.conn) return;
      const n = ++st.seq;
      const typed = search.value.trim();
      clearFail();
      status.replaceChildren(h('span', { class: 'badge blue', text: where() ? `Searching ${where()}…` : 'Searching all projects…' }));
      try {
        const r = await api('POST', importUrl(s, '/search'), { ...st.conn, ...(st.project ? { project: st.project } : {}), ...(typed ? { search: typed } : {}),
          ...(next && st.cursor ? { cursor: st.cursor } : {}) });
        if (!live(g) || n !== st.seq) return;   // the dialog is gone, or a newer search superseded this one
        st.searched = typed;
        st.tickets = next ? [...st.tickets, ...(r.tickets || [])] : (r.tickets || []);
        st.cursor = r.cursor || null;
        if (!next && st.chosen && !st.tickets.some((t) => t.key === st.chosen)) st.chosen = null;
        render();
      } catch (err) { if (live(g) && n === st.seq) showFail(err); }
    }
    // The connection's projects. Its own request number (plan review S8): after two quick Connection changes only the last one's
    // answer fills the select; an earlier one (also an earlier failure) is dropped. Answers whether this answer was used.
    async function loadProjects() {
      const n = ++st.projSeq;
      let r;
      try { r = await api('POST', importUrl(s, '/options'), { ...st.conn }); }
      catch (err) { if (live(g) && n === st.projSeq) throw err; return false; }
      if (!live(g) || n !== st.projSeq) return false;
      st.projects = r.projects || [];
      if (st.project && !st.projects.some((p) => p.value === st.project)) st.project = '';
      syncSelect(projSel, [{ value: '', label: 'All projects' }, ...st.projects], st.project);
      return true;
    }
    async function load() {
      clearFail();
      try {
        if (!st.info) {
          const info = await api('GET', importUrl(s));
          if (!live(g)) return;
          st.info = info;
        }
        const sources = st.info.sources || [];
        const conns = sources.flatMap((t) => (t.profiles || []).map((p) => ({ conn: { plugin: t.plugin, sourceId: t.sourceId, profile: p.id || null },
          label: sources.length > 1 ? `${t.name} · ${p.label}` : p.label })));
        if (!st.conn) {
          const pref = importPrefs && conns.find((c) => sameConnUi(c.conn, importPrefs.conn));
          st.conn = pref ? pref.conn : st.info.defaultConnection || (conns[0] && conns[0].conn) || null;
          st.project = pref ? importPrefs.project || '' : st.info.defaultProject || '';
        }
        const name = pickTracker(st);
        lead.textContent = `Pick the ticket this feature starts from. Worca reads it through your ${name} connection and changes nothing in ${name}.`;
        projLabel.textContent = `${name} project`;
        if (conns.length > 1) {
          connField.replaceChildren(h('label', { for: 'req-pick-conn' }, 'Connection'),
            exportSelect({ id: 'req-pick-conn', ui: 'pick-conn', list: conns.map((c) => ({ value: connValue(c.conn), label: c.label })), value: connValue(st.conn),
              onchange: (e) => {
                st.conn = connFrom(e.target.value);
                st.project = '';
                st.chosen = null;
                importPrefs = { conn: st.conn, project: '' };
                void loadProjects().then((used) => (used ? run() : undefined), (err) => { if (live(g)) showFail(err); });
              } }));
          connField.hidden = false;
        }
        await loadProjects();
        if (!live(g)) return;
        if (keep) { search.value = st.search; render(); } else await run();
      } catch (err) { if (live(g)) showFail(err); }
    }
    projSel.addEventListener('change', () => { st.project = projSel.value; importPrefs = { conn: st.conn, project: st.project }; void run(); });
    search.addEventListener('input', () => {
      st.search = search.value;
      clearTimeout(timer);
      timer = setTimeout(() => { if (live(g)) void run(); }, SEARCH_MS);   // D4: 300 ms after the last key
    });
    void load();
  }

  // Task 12 replaces this stand-in with the preview (Continue calls it)
  function openImportPreview() {}
```

- [ ] **Step 5: CSS.** Inside the Requirements block, right before `/* ── marketplace P3 ── */`, add:

```css
/* A6.1 (plans/requirements-a61-design.md §7, boards 32–34): Start from a ticket. Both dialogs are A6's .req-dialog.req-export cards, so its
   900 px sheet rules apply; the pick is 560 px, the preview 880 px in two columns. A picked ticket row has an ink border, never a fill. */
.req-import-labrow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.req-import-labrow > label{margin:0}
.req-import-open[hidden]{display:none}
.req-import-search{display:flex;align-items:center;gap:8px;padding:0 10px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--field);color:var(--ink-2)}
.req-import-search input{flex:1;min-width:0;border:0;background:transparent;padding:7px 0;font-size:var(--fs-body);color:var(--ink)}
.req-import-search input:focus{outline:none}
.req-import-search:focus-within{outline:2px solid var(--ink);outline-offset:1px}
.req-import-status{margin:0;font-size:var(--fs-meta);color:var(--ink-2)}
.req-import-empty,.req-import-note{margin:0}
.req-import-note[hidden],.req-import-empty[hidden]{display:none}
.req-import-results{display:flex;flex-direction:column;gap:6px;max-height:min(46vh,420px);overflow-y:auto}
.req-import-ticket{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-md);cursor:pointer}
.req-import-ticket:has(input:checked){border-color:var(--ink)}
.req-import-ticket input{margin:3px 0 0;flex:none}
.req-import-ticket-txt{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;font-size:var(--fs-body)}
.req-import-ticket-txt .hint{margin:0}
.req-import-linkchip{flex:none;align-self:center}
.req-import-more{align-self:flex-start}
.req-import-more[hidden]{display:none}
```

- [ ] **Step 6: Run the tests.** `node --check ui/public/requirements-view.mjs`, then one at a time `node tools/test.mjs test/requirements-view-import.test.mjs`, `node tools/test.mjs test/requirements-view.test.mjs`, `node tools/test.mjs test/requirements-view-files.test.mjs`, `node tools/test.mjs test/requirements-view-export.test.mjs`, `node tools/test.mjs test/ui-design-language.test.mjs`, `node tools/test.mjs test/dialog-layout.test.mjs` → all PASS.

- [ ] **Step 7: Commit.**

```bash
git add ui/public/requirements-view.mjs ui/public/style.css test/requirements-view-import.test.mjs
git commit -m "Requirements: From a ticket… on New feature, and the pick" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The page — the preview, and Use this ticket (board 34)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`openImportPreview` in place of Task 11's stand-in; `paintNew`'s `importCtx.onUse` and a minimal `useTicket`)
- Modify: `ui/public/style.css` (the A6.1 block: the preview, desktop)
- Modify: `test/requirements-view-import.test.mjs`

**Interfaces:**
- Consumes: Task 11's `importPrefs`, `importUrl`, `importErr`, `pickTracker`, `importBack`, `openPick`, `fromBtn`, `importCtx`; Task 9's `POST …/preview`; A6's `openModal`, `closeDialog`, `dlgGen`, `live`, `stateBox`, `mdBlocks`, `exportField`; A8's `KIND_TITLE`, `sizeText`, `ICONS`, `icon`.
- Produces:
  - `openImportPreview(ctx, pick)` — calls `ctx.onUse(ticket, pick)` on **Use this ticket** after closing itself, with `ticket = { conn, tracker, key, url, meta, connection, linkedTo, title, description, clipped, descriptionFile: { name, bytes } | null, criteria: [text], comments: [{ id, author, when, bytes }], commentsFile: { name, bytes } | null, attachments: [{ id, name, kind, bytes }] }`; a 502 also shows "Nothing was changed." and, at the Advanced level, the Marketplace line (D16, as the pick).
  - `paintNew`: `importCtx.onUse` and `useTicket(ticket, pick)` which (in this task) writes the title and description and focuses **From a ticket…**. Task 14 grows `useTicket`.

- [ ] **Step 1: Write the failing tests.** Append to `test/requirements-view-import.test.mjs`:

```js
const toPreview = async (m) => { q('import-open', m.host).click(); await settle(); await typeSearch('cancel'); q('pick-SHOP-124').click(); q('pick-continue').click(); await settle(); };

test('board 34: Continue opens Start from SHOP-124: its title focused; the description as text; criteria renumbered; ticks; reasons; notices; Back keeps the search', async () => {
  const m = await openNew();
  await toPreview(m);
  const dl = dlg();
  assert.equal(text(dl.querySelector('h2')), 'Start from SHOP-124');
  assert.equal(document.activeElement, dl.querySelector('h2'));
  assert.equal(text(dl.querySelector('#req-ipv-desc')), 'This is what the new feature takes from SHOP-124. Untick what it should not start with. Nothing changes in Jira.');
  assert.deepEqual(m.calls.find((c) => c.url === `${IMP}/preview`).body, { ...CONN, key: 'SHOP-124', formFiles: { count: 0, bytes: 0 } });
  assert.equal(text(dl.querySelector('.req-import-meta')), 'Story · In progress · Medium · acme.atlassian.net (Cloud)');
  const desc = dl.querySelector('[aria-label="Description preview"]');
  assert.ok(desc.textContent.includes('<img src=x onerror=alert(1)> stays text'));
  assert.equal(desc.querySelector('img'), null, 'ticket text is never HTML');
  assert.ok(text(dl).includes('Without its Acceptance criteria section, which becomes the criteria below.'));
  assert.ok(text(dl).includes('Worca hid 1 thing that looked like a key or password.'));
  assert.ok(text(dl).includes('1 comment visible only to a Jira group or role is left out.'));
  assert.ok(text(dl).includes('found under “Acceptance criteria” in the description'));
  const crits = () => [...dl.querySelectorAll('[data-ui^="ipv-crit-"]')].map((b) => b.getAttribute('aria-label'));
  assert.deepEqual(crits(), ['Use R-po-1: A customer can cancel the items not picked up.', 'Use R-po-2: Shipped items stay on the order.',
    'Use R-po-3: The refund covers only the cancelled items.']);
  q('ipv-crit-0').click();
  assert.deepEqual([...dl.querySelectorAll('.req-import-code')].map((c) => c.textContent), ['', 'R-po-1', 'R-po-2']);
  assert.ok(text(dl).includes('Ticked criteria start the spec as R-po-1 to R-po-2, kept as your own edits and marked “from SHOP-124”. Unticked ones are left out; they stay in Jira.'));
  assert.deepEqual([q('ipv-com-10231').checked, q('ipv-com-10234').checked, q('ipv-com-10236').checked], [true, false, true]);
  assert.equal(q('ipv-com-10231').getAttribute('aria-label'), 'Use the comment by Ann Example, 21 Oct');
  assert.ok(text(dl).includes('Comments · 2 of 3'));
  const xlsx = q('ipv-att-10044');
  assert.deepEqual([xlsx.disabled, xlsx.checked, text(document.getElementById(xlsx.getAttribute('aria-describedby')))],
    [true, false, 'Not offered: Worca reads text, images and PDF. Save it as PDF to attach it here.']);
  assert.equal(q('ipv-att-10041').getAttribute('aria-label'), 'Add packing-slip.png as a feature file');
  assert.ok(text(dl).includes('Attachments · 2 of 3'));
  assert.ok(text(dl).includes('Nothing is sent to Jira.'));
  q('ipv-back').click();
  await settle();
  assert.equal(text(dlg().querySelector('h2')), 'Start from a ticket');
  assert.deepEqual([q('pick-search').value, q('pick-SHOP-124').checked, q('pick-continue').disabled], ['cancel', true, false]);
  m.view.destroy();
});

test('D1, D5: Use this ticket only fills the form: the title and the description; the dialog closes, the page is released, the focus on From a ticket…; nothing is posted', async () => {
  const m = await openNew();
  await toPreview(m);
  q('ipv-use').click();
  await settle();
  assert.equal(dlg(), null);
  assert.equal(m.host.querySelector('#req-new-title').value, 'Partial cancel for multi-item orders');
  assert.equal(m.host.querySelector('#req-new-desc').value, PREVIEW().description);
  assert.equal(document.activeElement, q('import-open', m.host));
  assert.ok([...document.body.children].every((el) => !el.hasAttribute('inert')));
  assert.equal(m.calls.filter((c) => c.method === 'POST' && c.url === '/api/requirements').length, 0, 'nothing created');
  m.view.destroy();
});

test("CSS: the preview's rules sit inside the Requirements block", () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  for (const sel of ['.req-import-cols', '.req-import-check', '.req-import-why', '.req-import-linked']) {
    const at = css.indexOf(sel);
    assert.ok(at > start && at < end, `${sel} inside the Requirements block`);
  }
});
```

- [ ] **Step 2: Run them to see them fail.** `node tools/test.mjs test/requirements-view-import.test.mjs` → the new tests FAIL (Continue opens nothing: Task 11's stand-in).

- [ ] **Step 3: `paintNew` — Use this ticket.** In Task 11's `importCtx` add `onUse: (t, pick) => useTicket(t, pick),` and right after it:

```js
    /** Use this ticket (D1): it only fills the form; nothing is created until Start the interview. */
    function useTicket(t) {
      title.value = t.title;
      desc.value = t.description;
      fromBtn.focus();
    }
```

- [ ] **Step 4: The preview.** Replace Task 11's stand-in `function openImportPreview() {}` (and its comment) with:

```js
  /** Start from SHOP-124 (board 34; D5–D9, D12, D19): what the new feature takes, each part with a checkbox. Nothing is imported
   *  until Start the interview; Use this ticket only fills the form. */
  function openImportPreview(ctx, pick) {
    closeDialog(false);
    const s = ctx.scope();
    const key = pick.chosen;
    const name = pickTracker(pick);
    let data = null;
    let loading = false;
    const title = h('h2', { id: 'req-ipv-title', tabindex: '-1', text: `Start from ${key}` });
    const box = stateBox();
    const body = h('div', { class: 'req-import-body' });
    // D16 (plan review S2): a tracker that could not be reached also says nothing changed and, at the Advanced level, where the
    // connection is fixed — the same persistent line as the pick's
    const note = h('p', { class: 'hint req-import-note', hidden: true }, 'Nothing was changed.', h('span', { 'data-min-level': 'advanced' }));
    const retry = h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'ipv-retry', onclick: () => { void load(); } }, 'Try again');
    const use = h('button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'ipv-use', disabled: true,
      onclick: () => { if (!data) return; const t = chosen(); closeDialog(false); ctx.onUse(t, pick); } }, 'Use this ticket');
    const card = h('section', { class: 'card req-dialog req-export req-import req-import-preview', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'req-ipv-title', 'aria-describedby': 'req-ipv-desc' },
      importBack(), title,
      h('p', { class: 'req-dlg-lead', id: 'req-ipv-desc', text: `This is what the new feature takes from ${key}. Untick what it should not start with. Nothing changes in ${name}.` }),
      ...box.els, note, body,
      h('div', { class: 'req-export-foot' }, h('p', { class: 'hint', text: `Nothing is sent to ${name}.` }),
        h('div', { class: 'req-dlg-btns' }, h('button', { type: 'button', class: 'btn', 'data-ui': 'ipv-back', onclick: () => openPick(ctx, pick) }, 'Back'), use)));
    openModal(card, { trigger: ctx.trigger, first: title, page: true });
    const g = dlgGen;
    const ui = { crit: [], comments: new Map(), atts: new Map(), critHead: null, critHint: null, comHead: null, attHead: null };

    function critSection(L) {
      const items = L.criteria.items || [];
      ui.crit = items.map((t, i) => {
        const cb = h('input', { type: 'checkbox', 'data-ui': `ipv-crit-${i}` });
        cb.checked = !Array.isArray(L.criteria.picked) || L.criteria.picked[i] !== false;
        cb.addEventListener('change', sync);
        return { cb, code: h('code', { class: 'req-import-code' }), text: t };
      });
      const found = L.criteria.from === 'field' ? `found in the ${name} field “${L.criteria.name}”`
        : L.criteria.from === 'section' ? `found under “${L.criteria.name}” in the description` : null;
      ui.critHead = h('h3', { class: 'req-import-h' });
      ui.critHint = h('p', { class: 'hint' });
      return h('section', { class: 'req-import-sec' }, ui.critHead, found ? h('p', { class: 'hint', text: found }) : null,
        items.length ? h('ul', { class: 'req-import-list' }, ...ui.crit.map((c) => h('li', {}, h('label', { class: 'req-import-check' }, c.cb, c.code, h('span', { text: c.text })))))
          : null,
        ui.critHint);
    }
    function commentsSection(L) {
      ui.comments.clear();
      ui.comHead = h('h3', { class: 'req-import-h' });
      const rows = L.comments.map((c) => {
        const cb = h('input', { type: 'checkbox', 'data-ui': `ipv-com-${c.id}`, 'aria-label': `Use the comment by ${c.author}, ${c.when}` });
        cb.checked = !!c.picked;
        cb.addEventListener('change', sync);
        ui.comments.set(c.id, cb);
        return h('li', { class: 'req-import-com' }, h('label', { class: 'req-import-check' }, cb,
          h('span', { class: 'req-import-ctext' }, h('span', { class: 'req-import-cby' }, h('b', { text: c.author }), ` · ${c.when}`),
            h('span', { class: 'req-import-cbody', text: c.body }))));
      });
      const restricted = Number(L.restrictedComments) || 0;
      return h('section', { class: 'req-import-sec' }, ui.comHead,
        rows.length ? h('p', { class: 'hint', text: `Context for the interview, not spec text. Worca puts the picked ones in one file, ${L.key} comments.md, and reads it like your other files. Authors are shown by name only.` }) : null,
        rows.length ? h('ul', { class: 'req-import-list' }, ...rows) : null,
        L.olderComments ? h('p', { class: 'hint', text: `and ${plural(L.olderComments, 'older comment')}` }) : null,
        restricted ? h('p', { class: 'hint', text: restricted === 1 ? `1 comment visible only to a ${name} group or role is left out.`
          : `${restricted} comments visible only to a ${name} group or role are left out.` }) : null);
    }
    function attachmentsSection(L) {
      ui.atts.clear();
      ui.attHead = h('h3', { class: 'req-import-h' });
      const rows = L.attachments.map((a) => {
        const cb = h('input', { type: 'checkbox', 'data-ui': `ipv-att-${a.id}`, 'aria-label': `Add ${a.name} as a feature file` });
        cb.checked = !!a.picked && !a.refused;
        cb.disabled = !!a.refused;
        cb.addEventListener('change', sync);
        const why = h('p', { class: 'hint req-import-why', id: `req-ipv-why-${a.id}`, hidden: !a.refused, text: a.refused || '' });
        if (a.refused) cb.setAttribute('aria-describedby', why.id);
        ui.atts.set(a.id, { cb, why, a });
        return h('li', { class: a.refused ? 'req-import-off' : null }, h('label', { class: 'req-import-check' }, cb,
          icon(a.kind === 'image' ? ICONS.image : ICONS.file, { size: 16 }), h('span', { class: 'req-import-aname', text: a.name }),
          h('span', { class: 'hint', text: a.kind ? `${KIND_TITLE[a.kind]} · ${sizeText(a.bytes)}` : sizeText(a.bytes) })), why);
      });
      return h('section', { class: 'req-import-sec' }, ui.attHead,
        rows.length ? h('p', { class: 'hint', text: `Picked files become feature files. Worca gets them from ${name} when you start the interview and reads each once, like a file you add.` }) : null,
        rows.length ? h('ul', { class: 'req-import-list' }, ...rows) : null);
    }
    function render() {
      const L = data;
      const meta = [L.meta && L.meta.type && L.meta.type.name, L.meta && L.meta.status, L.meta && L.meta.priority && L.meta.priority.name, L.connection]
        .filter(Boolean).join(' · ');
      const hidden = Number(L.redacted) || 0;
      body.replaceChildren(
        L.linkedTo ? h('p', { class: 'req-import-linked', role: 'alert',
          text: `${L.key} is linked to ${L.linkedTo.id} · ${L.linkedTo.title}. The new feature can start from it but stays unlinked: one ticket follows one feature.` }) : null,
        h('p', { class: 'hint req-import-meta', text: meta }),
        h('div', { class: 'req-import-cols' },
          h('div', { class: 'req-import-col' },
            exportField(null, 'Title', h('p', { class: 'req-import-title', text: L.title })),
            exportField(null, 'Description', L.description
              ? h('div', { class: 'req-export-desc req-import-desc', role: 'region', 'aria-label': 'Description preview', tabindex: '0' }, ...mdBlocks(L.description))
              : h('p', { class: 'hint', text: `${L.key} has no description.` })),
            L.criteria.from === 'section' ? h('p', { class: 'hint', text: 'Without its Acceptance criteria section, which becomes the criteria below.' }) : null,
            L.clipped ? h('p', { class: 'hint', text: `${L.key}'s description is longer than 20,000 characters. The form keeps the start; the whole text goes along as ${L.key} description.md.` }) : null,
            hidden ? h('p', { class: 'hint', text: hidden === 1 ? 'Worca hid 1 thing that looked like a key or password.' : `Worca hid ${hidden} things that looked like keys or passwords.` }) : null,
            critSection(L)),
          h('div', { class: 'req-import-col' }, commentsSection(L), attachmentsSection(L))));
      sync();
    }
    /** The ticks as they stand: the criteria's future ids, the headings' counts. */
    function sync() {
      const L = data;
      let n = 0;
      for (const c of ui.crit) {
        if (c.cb.checked) { n += 1; c.code.textContent = `R-po-${n}`; c.cb.setAttribute('aria-label', `Use R-po-${n}: ${c.text}`); }
        else { c.code.textContent = ''; c.cb.setAttribute('aria-label', `Use this criterion: ${c.text}`); }
      }
      const items = L.criteria.items || [];
      const k = n || items.length;
      ui.critHead.textContent = items.length ? `Acceptance criteria · ${items.length}` : 'Acceptance criteria · none';
      ui.critHint.textContent = !items.length ? `None found in ${L.key}. Round 1 asks for them.`
        : `Ticked criteria start the spec as ${k === 1 ? 'R-po-1' : `R-po-1 to R-po-${k}`}, kept as your own edits and marked “from ${L.key}”. Unticked ones are left out; they stay in ${name}.`;
      const coms = L.comments.filter((c) => ui.comments.get(c.id).checked);
      ui.comHead.textContent = L.comments.length ? `Comments · ${coms.length} of ${L.comments.length}` : 'Comments · none';
      const atts = [...ui.atts.values()].filter((x) => x.cb.checked);
      ui.attHead.textContent = L.attachments.length ? `Attachments · ${atts.length} of ${L.attachments.length}` : 'Attachments · none';
    }
    /** What Use this ticket hands the form. */
    function chosen() {
      const L = data;
      const comments = L.comments.filter((c) => ui.comments.get(c.id).checked);
      return { conn: pick.conn, tracker: L.tracker, key: L.key, url: L.url, meta: L.meta || {}, connection: L.connection, linkedTo: L.linkedTo || null,
        title: L.title, description: L.description, clipped: !!L.clipped, descriptionFile: L.descriptionFile || null,
        criteria: ui.crit.filter((c) => c.cb.checked).map((c) => c.text),
        comments: comments.map((c) => ({ id: c.id, author: c.author, when: c.when, bytes: c.bytes })),
        commentsFile: comments.length ? { name: `${L.key} comments.md`, bytes: comments.reduce((sum, c) => sum + (Number(c.bytes) || 0), 0) } : null,
        attachments: [...ui.atts.values()].filter((x) => x.cb.checked).map(({ a }) => ({ id: a.id, name: a.name, kind: a.kind, bytes: a.bytes })) };
    }
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const answer = await api('POST', importUrl(s, '/preview'), { ...pick.conn, key, formFiles: ctx.formFiles() });
        if (!live(g)) return;   // Back, Cancel or Escape came first
        data = answer;
        box.clear();
        note.hidden = true;
        render();
        use.disabled = false;
      } catch (err) {
        if (!live(g)) return;
        box.show(importErr(err), { buttons: err && err.data && err.data.gone ? [] : [retry] });
        note.lastChild.textContent = ` Fix the connection on the Marketplace page (Installed › ${name}), then try again.`;
        note.hidden = !(err && err.status === 502);
      } finally { loading = false; }
    }
    void load();
  }
```

- [ ] **Step 5: CSS.** After Task 11's block (still before the marketplace marker) add:

```css
/* A6.1 (board 34): the preview, two columns of checkboxes; a refused row says why under it. */
.req-dlg-wrap .card.req-dialog.req-import-preview{width:min(880px,100%)}
.req-import-body{display:flex;flex-direction:column;gap:12px;min-width:0}
.req-import-meta{margin:0}
.req-import-linked{margin:0;padding:8px 10px;border:1px solid var(--amber-line);border-radius:var(--r-sm);background:var(--amber-bg);color:var(--amber-ink-strong);font-size:var(--fs-meta)}
.req-import-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}
.req-import-col{display:flex;flex-direction:column;gap:12px;min-width:0}
.req-import-col > .hint{margin:0}
.req-import-title{margin:0;font-size:var(--fs-body);font-weight:600}
.req-import-sec{display:flex;flex-direction:column;gap:6px}
.req-import-sec > .hint{margin:0}
.req-import-h{margin:0;font-size:var(--fs-body);font-weight:600}
.req-import-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.req-import-check{display:flex;align-items:flex-start;gap:8px;font-size:var(--fs-body);cursor:pointer}
.req-import-check input{margin:3px 0 0;flex:none}
.req-import-code{flex:none;font-size:var(--fs-meta)}
.req-import-ctext{display:flex;flex-direction:column;gap:2px;min-width:0}
.req-import-cbody{overflow-wrap:anywhere;color:var(--ink-2)}
.req-import-off .req-import-check{cursor:not-allowed;color:var(--ink-2)}
.req-import-why{margin:2px 0 0 24px;font-size:var(--fs-meta)}
.req-import-why[hidden]{display:none}
```

- [ ] **Step 6: Run the tests.** `node --check ui/public/requirements-view.mjs`, then `node tools/test.mjs test/requirements-view-import.test.mjs`, `node tools/test.mjs test/requirements-view.test.mjs`, `node tools/test.mjs test/ui-design-language.test.mjs`, `node tools/test.mjs test/dialog-layout.test.mjs` → all PASS.

- [ ] **Step 7: Commit.**

```bash
git add ui/public/requirements-view.mjs ui/public/style.css test/requirements-view-import.test.mjs
git commit -m "Requirements: the import preview, and Use this ticket" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The page — the caps, the states and the phone sheet (boards 34, 36)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (module constants; `openImportPreview`'s `commentsSection` and `sync`)
- Modify: `ui/public/style.css` (the A6.1 phone rules)
- Modify: `test/requirements-view-import.test.mjs`

**Interfaces:**
- Consumes: Task 12's `openImportPreview` (`ui.atts` entries `{ cb, why, a }`, `ctx.formFiles()`, its `note` line), A8's `REQ_ATTACH` (`maxFiles: 10`, `maxRequestBytes: 100 MB`).
- Produces: `CAP_FILES_UI = 'A feature takes up to 10 files; 10 are picked.'`, `CAP_BYTES_UI = "Picked files are at 100 MB, a new feature's limit. Add more on the feature page."` (module constants); an unticked attachment whose tick would pass a cap is disabled and `aria-describedby` that line, recomputed on every tick; past three comments the rest carry `.folded` and a `Show all <n> comments` button (`data-ui="ipv-showall"`) that CSS shows only at 900 px and narrower.

- [ ] **Step 1: Write the failing tests.** Append to `test/requirements-view-import.test.mjs`:

```js
const KB = (id, name, bytes, extra = {}) => ({ id, name, kind: 'text', mime: 'text/plain', bytes, refused: null, picked: true, capped: null, ...extra });

test('D9 (board 36, 6): a tick that would pass 10 files or 100 MB is disabled with the line; freeing room enables it again', async () => {
  const nine = Array.from({ length: 9 }, (_, i) => KB(`2${i}`, `notes-${i}.md`, 2048));
  const m = await openNew(ROUTES({ [`POST ${IMP}/preview`]: () => PREVIEW({ attachments: [...nine, KB('30', 'notes-9.md', 2048, { picked: false, capped: 'files' })] }) }));
  await toPreview(m);
  const tenth = q('ipv-att-30');
  assert.deepEqual([tenth.disabled, text(document.getElementById(tenth.getAttribute('aria-describedby')))], [true, 'A feature takes up to 10 files; 10 are picked.']);
  q('ipv-att-20').click();
  assert.deepEqual([tenth.disabled, tenth.hasAttribute('aria-describedby'), document.getElementById('req-ipv-why-30').hidden], [false, false, true]);
  q('ipv-att-20').click();
  assert.equal(tenth.disabled, true, 'taking the room back disables it again');
  q('ipv-com-10231').click();
  q('ipv-com-10236').click();
  assert.equal(tenth.disabled, false, 'no comment picked: no comments file, one more room');
  m.view.destroy();
  const MB = 1024 * 1024;
  const big = [KB('40', 'a.pdf', 24 * MB), KB('41', 'b.pdf', 24 * MB), KB('42', 'c.pdf', 24 * MB), KB('43', 'd.pdf', 24 * MB), KB('44', 'e.pdf', 24 * MB, { picked: false, capped: 'bytes' })];
  const h2 = await openNew(ROUTES({ [`POST ${IMP}/preview`]: () => PREVIEW({ attachments: big }) }));
  await toPreview(h2);
  assert.equal(text(document.getElementById(q('ipv-att-44').getAttribute('aria-describedby'))), "Picked files are at 100 MB, a new feature's limit. Add more on the feature page.");
  h2.view.destroy();
});

test('board 36 (1–3): unreachable says what changed and where it is fixed (Advanced); no match; a pasted key that is not there', async () => {
  const m = await openNew(ROUTES({ [`POST ${IMP}/search`]: (b) => (b.search === 'partial refund' ? { tickets: [] } : b.search === 'SHOP-999' ? { tickets: [] }
    : { __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' } }) }));
  q('import-open', m.host).click();
  await settle();
  const dl = dlg();
  assert.equal(text(dl.querySelector('.req-export-alert')), 'Worca could not reach Jira: the API token was refused.');
  const note = dl.querySelector('.req-import-note');
  assert.equal(note.hidden, false);
  assert.equal(text(note), 'Nothing was changed. Fix the connection on the Marketplace page (Installed › Jira), then try again.');
  assert.equal(note.querySelector('[data-min-level="advanced"]').textContent, ' Fix the connection on the Marketplace page (Installed › Jira), then try again.');
  assert.equal(q('pick-retry').hidden, false);
  await typeSearch('partial refund');
  assert.deepEqual([text(dl.querySelector('.req-import-status')), dl.querySelector('.req-import-empty').hidden],
    ['No ticket in SHOP matches “partial refund”.', false]);
  assert.equal(text(dl.querySelector('.req-import-empty')), "Try other words, or paste the ticket's key or link.");
  await typeSearch('SHOP-999');
  assert.deepEqual([text(dl.querySelector('.req-import-status')), dl.querySelector('.req-import-empty').hidden],
    ['SHOP-999 was not found in Jira, or this connection cannot see it.', true]);
  m.view.destroy();
});

test('board 36 (4, 5, 7): the ticket another feature follows (an amber alert above the columns); no criteria, comments or attachments; a long description', async () => {
  const m = await openNew(ROUTES({ [`POST ${IMP}/preview`]: () => PREVIEW({ key: 'SHOP-131', linkedTo: { id: 'FEAT-7', title: 'Cancel an order before it ships' },
    criteria: { from: null, name: null, field: null, items: [], picked: [] }, comments: [], restrictedComments: 0, attachments: [], redacted: 0, clipped: true,
    descriptionFile: { name: 'SHOP-131 description.md', bytes: 24002 } }) }));
  await toPreview(m);
  const dl = dlg();
  const alert = dl.querySelector('.req-import-linked');
  assert.deepEqual([alert.getAttribute('role'), text(alert)], ['alert',
    'SHOP-131 is linked to FEAT-7 · Cancel an order before it ships. The new feature can start from it but stays unlinked: one ticket follows one feature.']);
  assert.ok(alert.compareDocumentPosition(dl.querySelector('.req-import-cols')) & window.Node.DOCUMENT_POSITION_FOLLOWING, 'above the columns');
  for (const s of ['Acceptance criteria · none', 'None found in SHOP-131. Round 1 asks for them.', 'Comments · none', 'Attachments · none',
    "SHOP-131's description is longer than 20,000 characters. The form keeps the start; the whole text goes along as SHOP-131 description.md."]) {
    assert.ok(text(dl).includes(s), s);
  }
  m.view.destroy();
});

test('the preview of a ticket that is gone says its sentence (not the flag text) and offers no Try again; a 502 offers Try again and says nothing changed (D16); a late answer after Back is dropped', async () => {
  const gone = await openNew(ROUTES({ [`POST ${IMP}/preview`]: { __status: 404, body: { gone: true, error: 'SHOP-124 was not found in Jira, or this connection cannot see it.' } } }));
  await toPreview(gone);
  assert.equal(text(dlg().querySelector('.req-export-alert')), 'SHOP-124 was not found in Jira, or this connection cannot see it.');
  assert.equal(q('ipv-retry'), null);
  assert.equal(q('ipv-use').disabled, true);
  assert.equal(dlg().querySelector('.req-import-note').hidden, true, 'a gone ticket is not a connection to fix');
  gone.view.destroy();
  const down = await openNew(ROUTES({ [`POST ${IMP}/preview`]: { __status: 502, body: { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' } } }));
  await toPreview(down);
  const note = dlg().querySelector('.req-import-note');
  assert.deepEqual([text(dlg().querySelector('.req-export-alert')), note.hidden, text(note), !!q('ipv-retry')],
    ['Worca could not reach Jira: the API token was refused.', false,
      'Nothing was changed. Fix the connection on the Marketplace page (Installed › Jira), then try again.', true]);
  assert.equal(note.querySelector('[data-min-level="advanced"]').textContent, ' Fix the connection on the Marketplace page (Installed › Jira), then try again.');
  down.view.destroy();
  let release = null;
  const late = await openNew(ROUTES({ [`POST ${IMP}/preview`]: () => new Promise((r) => { release = () => r(PREVIEW()); }) }));
  await toPreview(late);
  q('ipv-back').click();
  await settle();
  release();
  await settle();
  assert.equal(text(dlg().querySelector('h2')), 'Start from a ticket', 'the pick stays; the late preview changed nothing');
  late.view.destroy();
});

test('board 36 (phone): past three comments the rest fold behind "Show all 6 comments", which unfolds them', async () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, author: i % 2 ? 'Bo Example' : 'Ann Example', authorKind: 'person', created: '2026-10-21T09:30:00.000Z',
    when: '21 Oct', body: `Comment ${i}`, bytes: 40, picked: true }));
  const m = await openNew(ROUTES({ [`POST ${IMP}/preview`]: () => PREVIEW({ comments: six }) }));
  await toPreview(m);
  const rows = [...dlg().querySelectorAll('.req-import-com')];
  assert.deepEqual(rows.map((r) => r.classList.contains('folded')), [false, false, false, true, true, true]);
  const all = q('ipv-showall');
  assert.equal(all.textContent, 'Show all 6 comments');
  all.click();
  assert.ok(rows.every((r) => !r.classList.contains('folded')));
  assert.equal(all.hidden, true);
  m.view.destroy();
});

test('CSS (board 36): at 900 px and narrower one column, author and date only, the fold, 44 px hit areas without min-height on a button', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const at = css.indexOf('/* A6.1 (board 36, D19)');
  assert.ok(at > 0 && at < css.indexOf('/* ── marketplace P3 ── */'));
  const block = css.slice(at, css.indexOf('/* ── marketplace P3 ── */'));
  for (const rule of ['.req-import-cols{grid-template-columns:minmax(0,1fr)}', '.req-import-cbody{display:none}', '.req-import-com.folded{display:none}',
    '.req-import-check::after{content:"";position:absolute;inset:-13px 0}', '.req-import-showall{display:none}']) {
    assert.ok(block.includes(rule), rule);
  }
  assert.ok(!/min-height:44px/.test(block));
});
```

- [ ] **Step 2: Run them to see them fail.** `node tools/test.mjs test/requirements-view-import.test.mjs` → the new tests FAIL (the tenth box is not disabled; no `ipv-showall`; no phone block).

- [ ] **Step 3: The caps and the fold.** Near the top of `ui/public/requirements-view.mjs`, after `const KIND_TITLE = …`, add:

```js
// A6.1 (D9, board 36): A8's caps for the New feature form, said where a ticket's attachment cannot be ticked
const CAP_FILES_UI = 'A feature takes up to 10 files; 10 are picked.';
const CAP_BYTES_UI = "Picked files are at 100 MB, a new feature's limit. Add more on the feature page.";
```

In `openImportPreview`'s `commentsSection`, replace its `return h('section', …)` with:

```js
      // board 36 (phone): author and date only, three at first; the rest fold behind Show all (CSS shows it at 900 px and narrower)
      const folded = rows.length > 3;
      rows.forEach((li, i) => { if (folded && i >= 3) li.classList.add('folded'); });
      const showAll = folded ? h('button', { type: 'button', class: 'link-btn req-import-showall', 'data-ui': 'ipv-showall',
        onclick: () => { for (const li of rows) li.classList.remove('folded'); showAll.hidden = true; } }, `Show all ${rows.length} comments`) : null;
      return h('section', { class: 'req-import-sec' }, ui.comHead,
        rows.length ? h('p', { class: 'hint', text: `Context for the interview, not spec text. Worca puts the picked ones in one file, ${L.key} comments.md, and reads it like your other files. Authors are shown by name only.` }) : null,
        rows.length ? h('ul', { class: 'req-import-list' }, ...rows) : null, showAll,
        L.olderComments ? h('p', { class: 'hint', text: `and ${plural(L.olderComments, 'older comment')}` }) : null,
        restricted ? h('p', { class: 'hint', text: restricted === 1 ? `1 comment visible only to a ${name} group or role is left out.`
          : `${restricted} comments visible only to a ${name} group or role are left out.` }) : null);
```

At the end of `sync()` add:

```js
      // D9: the caps count every file the form would hold: its own files, the comments file, the description file, the ticked attachments.
      // An unticked attachment whose tick would pass one is disabled with that line (aria-describedby); room made frees it again.
      const form = ctx.formFiles();
      let count = form.count + (coms.length ? 1 : 0) + (L.descriptionFile ? 1 : 0) + atts.length;
      let bytes = form.bytes + coms.reduce((sum, c) => sum + (Number(c.bytes) || 0), 0) + (L.descriptionFile ? L.descriptionFile.bytes : 0)
        + atts.reduce((sum, x) => sum + x.a.bytes, 0);
      for (const x of ui.atts.values()) {
        if (x.a.refused) continue;
        const cap = x.cb.checked ? null : count + 1 > REQ_ATTACH.maxFiles ? CAP_FILES_UI : bytes + x.a.bytes > REQ_ATTACH.maxRequestBytes ? CAP_BYTES_UI : null;
        x.cb.disabled = !!cap;
        x.why.textContent = cap || '';
        x.why.hidden = !cap;
        if (cap) x.cb.setAttribute('aria-describedby', x.why.id); else x.cb.removeAttribute('aria-describedby');
      }
```

(`count` and `bytes` are `let` only for readability; `const` is fine too.)

Not built (design §7 does not ask for it; plan review Minor 7): board 36's phone sheet also clamps the description behind **Show all** and lists attachments by size only. Here the description region scrolls inside the sheet and the attachments keep their kind and size, as on the desktop.

- [ ] **Step 4: The phone CSS.** After Task 12's block (still before the marketplace marker) add:

```css
/* A6.1 (board 36, D19): at 900 px and narrower both dialogs are A6's full-screen sheets (← New feature first, full-width buttons); the
   preview is one column, a comment shows its author and date only, three at first; every row and small button reaches 44 px through an
   ::after hit area (a 19–20 px row + 2 × 13; rows 26 px apart, so the areas touch but never overlap; a 28 px .btn-sm + 2 × 9). */
.req-import-showall{display:none}
@media (max-width:900px){
  .req-import-cols{grid-template-columns:minmax(0,1fr)}
  .req-import-cbody{display:none}
  .req-import-com.folded{display:none}
  .req-import-list{gap:26px}
  .req-import-check{position:relative}
  .req-import-check::after{content:"";position:absolute;inset:-13px 0}
  .req-import-showall{display:block;width:100%;position:relative;text-align:left}
  .req-import-showall[hidden]{display:none}
  .req-import-showall::after{content:"";position:absolute;inset:-13px 0}
  .req-import .btn-sm{position:relative}
  .req-import .btn-sm::after{content:"";position:absolute;inset:-9px 0}
  .req-import-results{max-height:none}
}
```

- [ ] **Step 5: Run the tests.** `node --check ui/public/requirements-view.mjs`, then `node tools/test.mjs test/requirements-view-import.test.mjs`, `node tools/test.mjs test/ui-design-language.test.mjs`, `node tools/test.mjs test/dialog-layout.test.mjs` → all PASS.

- [ ] **Step 6: Commit.**

```bash
git add ui/public/requirements-view.mjs ui/public/style.css test/requirements-view-import.test.mjs
git commit -m "Requirements: the import preview's caps, its states and the phone sheet" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The page — the form a ticket filled, and Start the interview with it (board 32, board 36's 8)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`paintNew`)
- Modify: `ui/public/style.css`
- Modify: `test/requirements-view-import.test.mjs`

**Interfaces:**
- Consumes: Task 12's `useTicket`; Task 11's `importCtx`, `fromBtn`, `openPick`, `importErr`; A6's `webHref`; the create route's `fromTicket` and its answer's `filesNotStored` and `notOnTicket` (Task 9); A8's `sync`, `addPicked`, `choose`, `cost`, `note`, `picked`, `create`, `carry`.
- Produces (inside `paintNew`): `imp` (the ticket the form starts from, as `onUse` hands it, or null), `filled` (`{ title, description }` the last fill wrote), `lastPick`; `renderImport()`, `useTicket(t, pick)`, `stopUsing()`, `removeTicketFile(key)`, `ticketFiles() → [{ key, name, kind, bytes }]`, `notOnTicketLines(gone) → string[]`. The create posts `fromTicket: { plugin, sourceId, profile, key, criteria, comments: [id], attachments: [id], descriptionFile }`.

- [ ] **Step 1: Write the failing tests.** Append to `test/requirements-view-import.test.mjs`:

```js
const fillFrom = async (m) => { await toPreview(m); q('ipv-use').click(); await settle(); };
const CREATED = { feature: { seq: 8, id: 'FEAT-8' }, turns: [], filesNotStored: [], notOnTicket: { key: 'SHOP-124', comments: [], attachments: [] } };

test('board 32: Use this ticket fills the strip, the description hint, the criteria and the ticket\'s files; the strip\'s chip opens the ticket', async () => {
  const m = await openNew();
  await fillFrom(m);
  const strip = m.host.querySelector('.req-import-strip');
  assert.equal(strip.hidden, false);
  const chip = q('import-chip', m.host);
  assert.deepEqual([chip.href, chip.target, chip.rel, chip.getAttribute('aria-label')],
    ['https://acme.test/browse/SHOP-124', '_blank', 'noopener', 'SHOP-124, opens the ticket in Jira in a new tab']);
  assert.ok(chip.querySelector('svg, .ic'), 'the shared external icon, not a glyph');
  assert.deepEqual([...strip.querySelector('.req-import-strip-top').children].map(text).filter(Boolean),
    ['Starting from', 'SHOP-124', '· Story · In progress', 'Change ticket…']);
  assert.equal(q('import-stop', m.host).getAttribute('aria-label'), 'Stop using SHOP-124');
  assert.equal(text(strip.querySelector('.req-import-site')),
    'acme.atlassian.net (Cloud) · The new feature stays linked to SHOP-124: Export updates it, and a run can report back to it.');
  assert.equal(text(m.host.querySelector('.req-import-deschint')), "From SHOP-124's description. Change it as you like: the interview starts from what is here.");
  const crit = m.host.querySelector('.req-import-critfield');
  assert.equal(text(crit.querySelector('.req-export-fl')), 'Acceptance criteria from SHOP-124');
  assert.deepEqual([...crit.querySelectorAll('li')].map(text), ['R-po-1 A customer can cancel the items not picked up.', 'R-po-2 Shipped items stay on the order.',
    'R-po-3 The refund covers only the cancelled items.']);
  assert.equal(text(crit.querySelector('.hint')), 'They start the spec as your criteria. Edit or remove them on the feature page.');
  const chips = [...m.host.querySelectorAll('.req-import-chips .req-new-chip')]
    .map((c) => [text(c.querySelector('.req-new-chip-name')), text(c.querySelector('.hint')), text(c.querySelector('.req-import-tchip'))]);
  assert.deepEqual(chips, [['SHOP-124 comments.md', 'Text · 126 B', 'SHOP-124'], ['packing-slip.png', 'Image · 840 KB', 'SHOP-124'],
    ['partial-cancel-flow.pdf', 'PDF · 1.2 MB', 'SHOP-124']]);
  assert.equal(text(m.host.querySelector('.req-import-filesnote')), 'Worca gets the SHOP-124 files from Jira when you start the interview.');
  m.view.destroy();
});

test('board 32: × on a ticket file takes it away and moves the focus; Stop using SHOP-124 keeps what was typed and takes the criteria and files away', async () => {
  const m = await openNew();
  await fillFrom(m);
  q('import-x-10041', m.host).click();
  assert.deepEqual([...m.host.querySelectorAll('.req-import-chips .req-new-chip-name')].map((n) => n.textContent), ['SHOP-124 comments.md', 'partial-cancel-flow.pdf']);
  assert.equal(document.activeElement, q('import-x-10042', m.host));
  m.host.querySelector('#req-new-title').value = 'My own title';
  q('import-stop', m.host).click();
  assert.deepEqual([m.host.querySelector('.req-import-strip').hidden, m.host.querySelector('.req-import-critfield').hidden,
    m.host.querySelectorAll('.req-import-chips .req-new-chip').length, m.host.querySelector('#req-new-title').value], [true, true, 0, 'My own title']);
  assert.equal(document.activeElement, q('import-open', m.host));
  m.view.destroy();
});

test('Start the interview sends the ticket with the picks; the page it opens names what the second read no longer found', async () => {
  const m = await openNew(ROUTES({ 'POST /api/requirements': () => ({ ...CREATED,
    notOnTicket: { key: 'SHOP-124', comments: ['10236'], attachments: [{ id: '10042', reason: null }] } }) }));
  await fillFrom(m);
  [...m.host.querySelectorAll('.req-new-btns .btn-primary')][0].click();
  await settle();
  const post = m.calls.find((c) => c.method === 'POST' && c.url === '/api/requirements');
  assert.deepEqual(post.body.fromTicket, { ...CONN, key: 'SHOP-124', criteria: PREVIEW().criteria.items, comments: ['10231', '10236'], attachments: ['10041', '10042'],
    descriptionFile: false });
  assert.deepEqual([post.body.title, post.body.attachments], ['Partial cancel for multi-item orders', undefined]);
  assert.deepEqual(m.routed, ['feature/8']);
  // the feature page's fixture has every field A6's view tests' feature() has, so the page paints and the carried line stays
  fakeApi({ ...BASE, 'GET /api/requirements/8': { feature: { seq: 8, id: 'FEAT-8', scopeType: 'project', scopeKey: 'shop-1', title: 'Partial cancel for multi-item orders',
    status: 'looking', rounds: 0, costUsd: 0, busy: true, orientation: null, pending: null, lastError: null, state: 'looking',
    spec: { goal: { text: '', measure: '' }, actors: [], flow: [], edgeCases: [], rules: [], outOfScope: [], criteria: [], assumptions: [], openQuestions: [], edited: {} },
    readiness: { ok: false, passed: 0, total: 6, checks: [], overridable: false }, starts: [], unaskedRejections: [], changedSinceStart: [], attachments: [],
    briefDocuments: [], unaskedFiles: [], interview: null, resetPeriod: 'monthly', export: null }, turns: [] } });
  await m.view.show('feature/8');
  await settle();
  assert.equal(m.msgEl.textContent, 'The comment by Bo Example (25 Oct) was not added: it is no longer on SHOP-124. partial-cancel-flow.pdf was not added: it is no longer on SHOP-124.');
  m.view.destroy();
});

test("board 36 (8): Start the interview cannot read the ticket: the sentence and what to do, nothing created, the form keeps everything; a second press posts once", async () => {
  let posts = 0;
  let answer = null;
  const m = await openNew(ROUTES({ 'POST /api/requirements': () => { posts += 1; return new Promise((r) => { answer = r; }); } }));
  await fillFrom(m);
  const go = [...m.host.querySelectorAll('.req-new-btns .btn-primary')][0];
  go.click();
  go.click();
  await settle();
  assert.equal(posts, 1, 'no double post');
  answer({ __status: 502, body: { error: 'Worca could not reach Jira: it did not answer within a minute.', kind: 'timeout' } });
  await settle();
  const fail = m.host.querySelector('.req-import-fail');
  assert.equal(fail.getAttribute('role'), 'alert');
  assert.deepEqual([...fail.children].map(text), ['Worca could not reach Jira: it did not answer within a minute.',
    'Nothing was created, and the form keeps what you entered. Try again, or stop using SHOP-124 to start without it.']);
  assert.deepEqual([m.routed, m.host.querySelector('#req-new-title').value, m.host.querySelector('.req-import-strip').hidden], [[], 'Partial cancel for multi-item orders', false]);
  m.view.destroy();
});

test('Change ticket… after an edit asks "Replace the title and description with SHOP-131\'s?"; Keep mine keeps the text, the criteria and files change either way', async () => {
  const m = await openNew(ROUTES({ [`POST ${IMP}/preview`]: (b) => (b.key === 'SHOP-131'
    ? PREVIEW({ key: 'SHOP-131', title: 'Cancel button hidden on the mobile order page', description: 'The button hides.', url: 'https://acme.test/browse/SHOP-131',
      criteria: { from: null, name: null, field: null, items: [], picked: [] }, attachments: [] }) : PREVIEW()) }));
  await fillFrom(m);
  m.host.querySelector('#req-new-desc').value = 'My words.';
  q('import-change', m.host).click();
  await settle();
  assert.equal(q('pick-SHOP-124').checked, true, 'the pick opens with the current ticket selected');
  q('pick-SHOP-131').click();
  q('pick-continue').click();
  await settle();
  q('ipv-use').click();
  await settle();
  const ask = m.host.querySelector('.req-import-ask');
  assert.equal(text(ask.querySelector('#req-import-ask-q')), "Replace the title and description with SHOP-131's?");
  assert.equal(document.activeElement, q('import-replace', m.host));
  q('import-keep', m.host).click();
  assert.deepEqual([m.host.querySelector('#req-new-desc').value, q('import-chip', m.host).textContent, m.host.querySelector('.req-import-critfield').hidden, ask.hidden],
    ['My words.', 'SHOP-131', true, true]);
  m.view.destroy();
});

test('D12 and D6 on the form: a ticket another feature follows says the feature stays unlinked; an empty description asks for one', async () => {
  const m = await openNew(ROUTES({ [`POST ${IMP}/preview`]: () => PREVIEW({ key: 'SHOP-123', description: '', linkedTo: { id: 'FEAT-7', title: 'x' } }) }));
  await toPreview(m);
  q('ipv-use').click();
  await settle();
  assert.equal(text(m.host.querySelector('.req-import-site')), 'acme.atlassian.net (Cloud) · SHOP-123 follows FEAT-7, so the new feature stays unlinked.');
  assert.equal(text(m.host.querySelector('.req-import-deschint')), 'SHOP-123 has no description. Describe it in a few sentences.');
  m.view.destroy();
});
```

(Ticket files' sizes: the comments file is the sum of the picked comments' `bytes`, 60 + 66 = 126 B.)

- [ ] **Step 2: Run them to see them fail.** `node tools/test.mjs test/requirements-view-import.test.mjs` → the new tests FAIL (no `.req-import-strip`).

- [ ] **Step 3: `paintNew` — the ticket on the form.** Replace Task 12's minimal `useTicket` with:

```js
    // A6.1 (board 32): the ticket the form starts from (Use this ticket) or null, the title and description its fill wrote (Change ticket…
    // asks before replacing what was edited since), and the pick it came from. Leaving New feature drops all of it: nothing was stored.
    let imp = null;
    let filled = null;
    let lastPick = null;
    const strip = h('div', { class: 'req-import-strip', hidden: true });
    const askEl = h('div', { class: 'req-import-ask', role: 'group', 'aria-labelledby': 'req-import-ask-q', hidden: true });
    const descFrom = h('p', { class: 'hint req-import-deschint', id: 'req-import-descfrom', hidden: true });
    const descClip = h('p', { class: 'hint req-import-descclip', hidden: true });
    const critField = h('div', { class: 'field req-import-critfield', hidden: true });
    const ticketChips = h('div', { class: 'req-new-chips req-import-chips' });
    const ticketNote = h('p', { class: 'hint req-import-filesnote', hidden: true });
    const createFail = h('div', { class: 'req-import-fail', role: 'alert' });   // persistent: board 36 (8)
    const ticketFiles = () => (imp ? [
      ...(imp.commentsFile ? [{ key: 'comments', name: imp.commentsFile.name, kind: 'text', bytes: imp.commentsFile.bytes }] : []),
      ...(imp.descriptionFile ? [{ key: 'description', name: imp.descriptionFile.name, kind: 'text', bytes: imp.descriptionFile.bytes }] : []),
      ...imp.attachments.map((a) => ({ key: a.id, name: a.name, kind: a.kind, bytes: a.bytes })),
    ] : []);
    function renderImport() {
      const on = !!imp;
      strip.hidden = !on;
      descFrom.hidden = !on;
      descClip.hidden = !on || !imp.clipped;
      critField.hidden = !on || !imp.criteria.length;
      ticketNote.hidden = !on || !ticketFiles().length;
      if (on) desc.setAttribute('aria-describedby', 'req-import-descfrom'); else desc.removeAttribute('aria-describedby');
      if (!on) { strip.replaceChildren(); critField.replaceChildren(); ticketChips.replaceChildren(); return; }
      const meta = [imp.meta.type && imp.meta.type.name, imp.meta.status].filter(Boolean).join(' · ');
      strip.replaceChildren(
        h('div', { class: 'req-import-strip-top' },
          h('span', { class: 'hint', text: 'Starting from' }),
          // the page's one guard for ticket links (A6's webHref, as exportChip): only an http(s) URL is a link (plan review S4)
          webHref(imp.url) ? h('a', { class: 'chip req-export-chip', 'data-ui': 'import-chip', href: webHref(imp.url), target: '_blank', rel: 'noopener',
            'aria-label': `${imp.key}, opens the ticket in ${imp.tracker} in a new tab` }, h('span', { text: imp.key }), sharedIcon(document, 'external', 12))
            : h('span', { class: 'chip', 'data-ui': 'import-chip', text: imp.key }),
          meta ? h('span', { class: 'hint', text: `· ${meta}` }) : null,
          h('span', { class: 'req-file-gap' }),
          h('button', { type: 'button', class: 'link-btn', 'data-ui': 'import-change', 'aria-haspopup': 'dialog', onclick: () => openPick(importCtx, lastPick) }, 'Change ticket…'),
          icoBtn('remove', `Stop using ${imp.key}`, () => stopUsing(), { cls: 'req-import-x', 'data-ui': 'import-stop' })),
        h('p', { class: 'hint req-import-site', text: imp.linkedTo ? `${imp.connection} · ${imp.key} follows ${imp.linkedTo.id}, so the new feature stays unlinked.`
          : `${imp.connection} · The new feature stays linked to ${imp.key}: Export updates it, and a run can report back to it.` }),
        askEl);
      descFrom.textContent = imp.description ? `From ${imp.key}'s description. Change it as you like: the interview starts from what is here.`
        : `${imp.key} has no description. Describe it in a few sentences.`;
      descClip.textContent = `${imp.key}'s description is longer than 20,000 characters. The form keeps the start; the whole text goes along as ${imp.key} description.md.`;
      critField.replaceChildren(h('span', { class: 'req-export-fl' }, 'Acceptance criteria ', h('span', { class: 'opt', text: `from ${imp.key}` })),
        h('ul', { class: 'req-import-critlist' }, ...imp.criteria.map((t, i) => h('li', {}, h('code', { text: `R-po-${i + 1}` }), ' ', h('span', { text: t })))),
        h('p', { class: 'hint', text: 'They start the spec as your criteria. Edit or remove them on the feature page.' }));
      ticketChips.replaceChildren(...ticketFiles().map((x) => h('span', { class: 'req-new-chip' },
        icon(x.kind === 'image' ? ICONS.image : ICONS.file, { size: 16 }), h('span', { class: 'req-new-chip-name', text: x.name }),
        h('span', { class: 'hint', text: `${KIND_TITLE[x.kind] || 'Text'} · ${sizeText(x.bytes)}` }), h('span', { class: 'req-import-tchip', text: imp.key }),
        icoBtn('remove', `Remove ${x.name}`, () => removeTicketFile(x.key), { cls: 'req-new-chip-x req-import-chip-x', 'data-ui': `import-x-${x.key}` }))));
      ticketNote.textContent = `Worca gets the ${imp.key} files from ${imp.tracker} when you start the interview.`;
    }
    /** Use this ticket (D1): it fills the form; Change ticket… asks before it replaces a title or description edited since (§7). The
     *  criteria and the ticket's files are replaced either way. Nothing is created until Start the interview. */
    function useTicket(t, pick = null) {
      lastPick = pick;
      createFail.replaceChildren();
      const edited = !!imp && !!filled && (title.value !== filled.title || desc.value !== filled.description);
      const fill = () => { title.value = t.title; desc.value = t.description; filled = { title: t.title, description: t.description }; };
      imp = t;
      if (!edited) fill();
      renderImport();
      sync();
      if (!edited) { askEl.hidden = true; fromBtn.focus(); return; }
      const done = (replace) => { if (replace) fill(); askEl.hidden = true; askEl.replaceChildren(); fromBtn.focus(); };
      askEl.replaceChildren(h('p', { id: 'req-import-ask-q', text: `Replace the title and description with ${t.key}'s?` }),
        h('div', { class: 'req-import-askbtns' },
          h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'import-keep', onclick: () => done(false) }, 'Keep mine'),
          h('button', { type: 'button', class: 'btn btn-sm btn-primary', 'data-ui': 'import-replace', onclick: () => done(true) }, 'Replace')));
      askEl.hidden = false;
      askEl.querySelector('[data-ui="import-replace"]').focus();
    }
    /** × "Stop using SHOP-124": what was typed stays; the criteria and the ticket's files go. */
    function stopUsing() {
      imp = null; filled = null; lastPick = null;
      askEl.hidden = true;
      askEl.replaceChildren();
      createFail.replaceChildren();
      renderImport();
      sync();
      fromBtn.focus();
    }
    /** × on a ticket file: it goes; the focus moves to the next chip's ×, else the previous one's, else Choose files. */
    function removeTicketFile(k) {
      if (!imp) return;
      const at = ticketFiles().findIndex((x) => x.key === k);
      imp = k === 'comments' ? { ...imp, comments: [], commentsFile: null } : k === 'description' ? { ...imp, descriptionFile: null }
        : { ...imp, attachments: imp.attachments.filter((a) => a.id !== k) };
      renderImport();
      sync();
      const xs = ticketChips.querySelectorAll('.req-import-chip-x');
      (xs[Math.min(at, xs.length - 1)] || choose).focus();
    }
    /** The feature page's line for what the second read no longer found (D10). */
    const notOnTicketLines = (gone) => {
      if (!gone || !imp) return [];
      const out = [];
      for (const id of gone.comments || []) {
        const c = imp.comments.find((x) => x.id === id);
        if (c) out.push(`The comment by ${c.author} (${c.when}) was not added: it is no longer on ${gone.key}.`);
      }
      for (const a of gone.attachments || []) {
        const x = imp.attachments.find((y) => y.id === a.id);
        if (x) out.push(a.reason ? `${x.name} was not added: ${String(a.reason).replace(/^Not offered: /, '')}` : `${x.name} was not added: it is no longer on ${gone.key}.`);
      }
      return out;
    };
```

In `sync` (A8's chips): `note.hidden = !picked.length && !ticketFiles().length;` and `cost.files([...ticketFiles().map((x) => x.kind), ...picked.map((p) => kindOfName(p.name))]);`. In `addPicked`, `pending:` becomes `[...ticketFiles().map((x) => ({ name: x.name, bytes: x.bytes })), ...picked.map((p) => ({ name: p.name, bytes: p.size }))]` (the caps count everything the form holds, D9).

Replace `create` with:

```js
    // One create at a time: reading the files slows the press down, so a second press while it runs does nothing.
    let sending = false;
    const create = () => {
      if (sending) return undefined;
      sending = true;
      say('');
      createFail.replaceChildren();
      return (async () => {
        try {
          const [scopeType, ...rest] = select.value.split(':');
          const attachments = picked.length ? await Promise.all(picked.map(encodeFile)) : undefined;
          const fromTicket = imp ? { ...imp.conn, key: imp.key, criteria: imp.criteria, comments: imp.comments.map((c) => c.id),
            attachments: imp.attachments.map((a) => a.id), descriptionFile: !!imp.descriptionFile } : undefined;
          const data = await api('POST', '/api/requirements', { scopeType, scopeKey: rest.join(':'), title: title.value, description: desc.value,
            ...(attachments ? { attachments } : {}), ...(fromTicket ? { fromTicket } : {}) });
          // A file the server could not store, and what the ticket no longer has, are named on the feature page (the feature stays).
          const lines = (Array.isArray(data.filesNotStored) ? data.filesNotStored : []).map((n) => `${n} was not added: Worca could not store it. Add it on the feature page.`);
          lines.push(...notOnTicketLines(data.notOnTicket));
          if (lines.length) carry = { param: `feature/${data.feature.seq}`, text: lines.join(' ') };
          route(`feature/${data.feature.seq}`);
        } catch (err) {
          // board 36 (8): the ticket could not be read; nothing was created and the form keeps everything
          if (imp && (err.status === 502 || (err.data && err.data.gone))) {
            createFail.replaceChildren(h('p', { class: 'form-msg err', text: importErr(err) }),
              h('p', { class: 'hint', text: `Nothing was created, and the form keeps what you entered. Try again, or stop using ${imp.key} to start without it.` }));
          } else fail(err);
        } finally { sending = false; }
      })();
    };
```

In `paintHost(…)`: the form card starts with `strip,` (before the Title field); the Describe it field becomes `…, fromBtn), desc, descFrom, descClip),` followed by `critField,`; the Files field's children become `input, zone, privacyNote(interview, 'req-new-files-privacy'), ticketChips, chips, ticketNote, refused`; `createFail` goes right before `actions`.

- [ ] **Step 4: CSS.** After the Task 13 block add:

```css
/* A6.1 (board 32): the form a ticket filled: the strip at its top, the criteria, the ticket's files as chips with the key, the Replace
   question and the create's failure. */
.req-import-strip{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--field)}
.req-import-strip[hidden],.req-import-critfield[hidden],.req-import-filesnote[hidden],.req-import-deschint[hidden],.req-import-descclip[hidden],.req-import-ask[hidden]{display:none}
.req-import-strip-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:var(--fs-body)}
.req-import-strip-top .hint,.req-import-site{margin:0}
.req-import-tchip{font-size:var(--fs-caption);padding:1px 6px;border:1px solid var(--line);border-radius:var(--r-xs);color:var(--ink-2);background:var(--field)}
.req-import-critlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:var(--fs-body)}
.req-import-critlist code{font-size:var(--fs-meta)}
.req-import-deschint,.req-import-descclip,.req-import-filesnote{margin:4px 0 0}
.req-import-ask{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--amber-line);border-radius:var(--r-sm);background:var(--amber-bg);color:var(--amber-ink-strong);font-size:var(--fs-meta)}
.req-import-ask p{margin:0}
.req-import-askbtns{display:flex;gap:8px}
.req-import-fail{display:flex;flex-direction:column;gap:4px}
.req-import-fail:empty{display:none}
.req-import-fail p{margin:0}
@media (max-width:900px){
  .req-import-x,.req-import-chip-x{position:relative}
  .req-import-x::after,.req-import-chip-x::after{content:"";position:absolute;left:50%;top:50%;width:44px;height:44px;transform:translate(-50%,-50%)}
  /* the form's new controls reach 44 px too (plan review Minor 8): From a ticket… is a 28 px .btn-sm, Change ticket… an 18 px line */
  .req-import-open,.req-import-strip .link-btn{position:relative}
  .req-import-open::after{content:"";position:absolute;inset:-8px 0}
  .req-import-strip .link-btn::after{content:"";position:absolute;inset:-13px 0}
}
```

- [ ] **Step 5: Run the tests.** `node --check ui/public/requirements-view.mjs`, then `node tools/test.mjs test/requirements-view-import.test.mjs`, `node tools/test.mjs test/requirements-view.test.mjs`, `node tools/test.mjs test/requirements-view-files.test.mjs`, `node tools/test.mjs test/ui-design-language.test.mjs` → all PASS (A8's New feature tests must pass unchanged: without a ticket the form is A8's).

- [ ] **Step 6: Commit.**

```bash
git add ui/public/requirements-view.mjs ui/public/style.css test/requirements-view-import.test.mjs
git commit -m "Requirements: the New feature form a ticket filled, and Start the interview with it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The page — the Files card while files come from the tracker (board 35, board 36's 9–11)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`readingLine`, `fileNode`, `fileRow`, `failedLine`, `fileMenu`; a new `downloadingBadge`)
- Modify: `ui/public/style.css`
- Create: `test/requirements-view-imported.test.mjs`

**Interfaces:**
- Consumes: the feature view's files (Task 8): `status: 'downloading'`, `from: { tracker, key } | null`, `fetched`, `error: { code: 'DOWNLOAD' | 'REFUSED' | 'INTERRUPTED', message, job: 'download' }`, `estimateUsd`; A8's `read-again` and `DELETE` routes.
- Produces: the working line "Getting <n> files from <key>…" (the same persistent `role="status"` node as A8's "Reading <n> files…"); per file a persistent **Downloading…** badge (`role="status"`), the state lines of board 35, the failure lines of board 36 with **Try again** (none for `REFUSED`), "from <key>" in the meta line, no switch, no Open, no Read again and no link on the file's name while a file has no body (plan review S3: its `href` would answer 404).

- [ ] **Step 1: Write the failing test** `test/requirements-view-imported.test.mjs`:

```js
// test/requirements-view-imported.test.mjs — a feature that started from a ticket, in jsdom with a fake API (plans/requirements-a61-design.md
// §7, D10, D11, D14, D19; boards 35, 36). No server, no tracker.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#requirements' });
for (const k of ['document', 'location', 'Event', 'KeyboardEvent', 'HTMLElement', 'window']) {
  Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
}
window.confirm = () => true;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 12; i += 1) await tick(); };
after(() => window.close());
const { createRequirementsView } = await import('../ui/public/requirements-view.mjs');

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
    return { ok: status < 400, status, json: async () => out ?? { error: 'not found' }, text: async () => '' };
  };
  return calls;
}
const BASE = { 'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop' }] }, 'GET /api/workspaces': { workspaces: [] } };
const F = '/api/requirements/8';
const FROM = { tracker: 'Jira', key: 'SHOP-124' };
const file = (id, name, kind, bytes, status, over = {}) => ({ id, name, kind, mime: kind === 'image' ? 'image/png' : kind === 'binary' ? 'application/pdf' : 'text/markdown',
  bytes, status, error: null, summary: '', summaryEdited: false, asks: [], history: [], sendWithRun: false, costUsd: 0, readAt: null, readModel: null,
  estimateUsd: 0.1, mentions: [], href: `${F}/attachments/${id}`, asking: null, sendable: status === 'done', from: FROM, fetched: false, ...over });
const SPEC = { goal: { text: '', measure: '' }, actors: [], flow: [], edgeCases: [], rules: [], outOfScope: [],
  criteria: [{ id: 'R-po-1', text: 'A customer can cancel the items not picked up.', edited: true, source: 'SHOP-124' },
    { id: 'R-po-2', text: 'The refund follows refund-matrix.pdf.', edited: true, source: 'refund-matrix.pdf' }],
  assumptions: [], openQuestions: [], edited: {} };
const LINK = { key: 'SHOP-124', url: 'https://acme.test/browse/SHOP-124', createdAt: '2026-10-27T09:12:00Z', exportedAt: '2026-10-27T09:12:00Z',
  madeOn: '27 Oct', lastOn: '27 Oct', origin: 'import', importedOn: '27 Oct', sinceImport: true, tracker: 'Jira' };
const XV = (over = {}) => ({ tracker: { name: 'Jira' }, canExport: true, hasSetup: false, link: LINK, exporting: false, doneStatus: null,
  history: [{ action: 'imported', tracker: 'Jira', key: 'SHOP-124', url: LINK.url, reason: null, when: '27 Oct, 09:12', by: 'Ann Example', linked: true, linkedTo: null }], ...over });
const feature = (over = {}) => ({ seq: 8, id: 'FEAT-8', scopeType: 'project', scopeKey: 'shop-1', title: 'Partial cancel for multi-item orders', status: 'looking',
  rounds: 0, costUsd: 0, busy: true, orientation: null, spec: SPEC, pending: null, lastError: null, state: 'looking',
  readiness: { ok: false, passed: 1, total: 6, checks: [], overridable: false }, starts: [], unaskedRejections: [], changedSinceStart: [], briefDocuments: [], unaskedFiles: [],
  interview: null, resetPeriod: 'monthly', export: XV(),
  attachments: [file('ratt_000000000001', 'SHOP-124 comments.md', 'text', 3072, 'reading', { estimateUsd: 0.02 }),
    file('ratt_000000000002', 'packing-slip.png', 'image', 860160, 'reading', { fetched: true, estimateUsd: 0.06 }),
    file('ratt_000000000003', 'partial-cancel-flow.pdf', 'binary', 1258291, 'downloading'),
    file('ratt_000000000004', 'support-macro.txt', 'text', 4096, 'downloading', { estimateUsd: null })], ...over });
const make = () => {
  const host = document.createElement('div'); const msgEl = document.createElement('p'); const subEl = document.createElement('div');
  document.body.replaceChildren(document.createElement('nav'), host);
  const view = createRequirementsView({ host, subEl, msgEl, deps: { route: () => {} } });
  return { host, msgEl, view };
};
const openFeature = async (f, extra = {}) => {
  let current = f;
  const calls = fakeApi({ ...BASE, [`GET ${F}`]: () => ({ feature: current, turns: [] }), ...extra });
  const m = make();
  await m.view.show('feature/8');
  await settle();
  return { ...m, calls, set: (nf) => { current = nf; } };
};
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const q = (ui, root = document) => root.querySelector(`[data-ui="${ui}"]`);
const row = (host, id) => host.querySelector(`[data-file="${id}"]`);

test('board 35: the working line says what is on its way, then what is read, in one role=status node', async () => {
  const m = await openFeature(feature());
  const line = m.host.querySelector('.req-reading');
  assert.equal(line.getAttribute('role'), 'status');
  assert.equal(text(line), 'Getting 2 files from SHOP-124… Worca gets the files from Jira and reads them first, then shows round 1.');
  m.set(feature({ attachments: feature().attachments.map((a) => ({ ...a, status: 'reading' })) }));
  await m.view.changed(8);
  await settle();
  assert.equal(m.host.querySelector('.req-reading'), line, 'the same node');
  assert.equal(text(line), 'Reading 4 files… Worca reads the files first, then shows round 1.');
  m.view.destroy();
});

test('board 35: each file says where it came from and where it is: Downloading…, "Downloaded from SHOP-124", Reading…; no switch, Open or Read again before it is there', async () => {
  const m = await openFeature(feature());
  const pdf = row(m.host, 'ratt_000000000003');
  assert.equal(text(pdf.querySelector('.req-file-meta')), 'PDF · 1.2 MB · from SHOP-124');
  const badge = pdf.querySelector('.badge');
  assert.deepEqual([text(badge), badge.getAttribute('role')], ['Downloading…', 'status']);
  assert.equal(text(pdf.querySelector('.req-file-state')), 'Worca is getting it from SHOP-124. Then it reads it (about $0.10).');
  assert.equal(text(row(m.host, 'ratt_000000000004').querySelector('.req-file-state')), 'Worca is getting it from SHOP-124. Then it reads it.');
  assert.equal(pdf.querySelector('.req-file-send'), null, 'no Send with the run before it is there');
  const nameEl = q('file-name-ratt_000000000003', m.host);
  assert.deepEqual([nameEl.tagName, nameEl.hasAttribute('href'), nameEl.getAttribute('tabindex'), text(nameEl)], ['SPAN', false, '-1', 'partial-cancel-flow.pdf'],
    'no link to a body that is not there yet; still a focus target');
  assert.equal(q('file-name-ratt_000000000002', m.host).tagName, 'A', 'a downloaded file links its body');
  q('file-more-ratt_000000000003', m.host).click();
  assert.deepEqual([q('fmi-open-ratt_000000000003', m.host), q('fmi-again-ratt_000000000003', m.host)], [null, null]);
  assert.ok(q('fmi-remove-ratt_000000000003', m.host), 'Remove stays');
  assert.equal(text(row(m.host, 'ratt_000000000002').querySelector('.req-file-state')),
    'Downloaded from SHOP-124. Worca is reading it (about $0.06). The next round uses it.');
  assert.equal(text(row(m.host, 'ratt_000000000001').querySelector('.req-file-meta')), 'Text · 3 KB · from SHOP-124');
  assert.equal(text(row(m.host, 'ratt_000000000001').querySelector('.req-file-state')), 'Worca is reading it (about $0.02). The next round uses it.');
  await m.view.changed(8);
  await settle();
  assert.equal(row(m.host, 'ratt_000000000003').querySelector('.badge'), badge, 'the badge node survives a repaint');
  m.view.destroy();
});

test('board 36 (9–11): a download that failed (Try again, one post per press), one a restart stopped, one Worca could not use (no Try again)', async () => {
  const dl = (id, name, code, message) => file(id, name, 'binary', 1258291, 'failed', { error: { code, message, job: 'download', at: 't' } });
  const f = feature({ busy: false, status: 'your_turn', rounds: 1, attachments: [
    dl('ratt_000000000003', 'partial-cancel-flow.pdf', 'DOWNLOAD', 'Worca could not get this file from Jira: it did not answer within 2 minutes.'),
    dl('ratt_000000000004', 'support-macro.txt', 'INTERRUPTED', 'Worca restarted before it got this file from Jira.'),
    dl('ratt_000000000005', 'scan-notes.pdf', 'REFUSED', 'Worca could not use this file: it is already attached as call-notes.pdf.')] });
  let release = null;
  const m = await openFeature(f, { [`POST ${F}/attachments/ratt_000000000003/read-again`]: () => new Promise((r) => { release = () => r({ feature: f, turns: [] }); }) });
  const a = row(m.host, 'ratt_000000000003').querySelector('.req-file-failed');
  assert.deepEqual([a.getAttribute('role'), text(a.querySelector('.req-file-failed-text'))],
    ['alert', 'Worca could not get this file from Jira: it did not answer within 2 minutes. The interview lists it by name only.']);
  const again = q('file-retry-ratt_000000000003', m.host);
  again.click();
  again.click();
  await settle();
  assert.equal(m.calls.filter((c) => c.url.endsWith('/read-again')).length, 1, 'no double post');
  release();
  await settle();
  assert.equal(text(row(m.host, 'ratt_000000000004').querySelector('.req-file-failed-text')), 'Worca restarted before it got this file from Jira.');
  assert.equal(q('file-retry-ratt_000000000004', m.host).hidden, false);
  const refused = row(m.host, 'ratt_000000000005');
  assert.equal(text(refused.querySelector('.req-file-failed-text')), 'Worca could not use this file: it is already attached as call-notes.pdf.');
  assert.equal(refused.querySelector('[data-ui^="file-retry-"]').hidden, true, 'no Try again: the same file would be refused again');
  m.view.destroy();
});
```

- [ ] **Step 2: Run it to see it fail.** `node tools/test.mjs test/requirements-view-imported.test.mjs` → FAIL (the working line reads nothing for downloads; no Downloading… badge).

- [ ] **Step 3: The working line.** Replace `readingLine` with:

```js
  // A8 D2, A6.1 D10: a feature created with files gets them (from the tracker) and reads them before round 1. One role=status node for
  // the page, moved into each paint and updated in place: "Getting 3 files from SHOP-124…" while any download runs, then "Reading 4 files…".
  function readingLine(f) {
    const list = (f.attachments || []).filter(Boolean);
    const getting = list.filter((a) => a.status === 'downloading');
    const reading = list.filter((a) => a.status === 'reading').length;
    if ((!getting.length && !reading) || (Number(f.rounds) || 0) > 0 || f.pending) { readingEl = null; return null; }
    if (!readingEl) readingEl = h('p', { class: 'req-reading', role: 'status' }, h('span', { class: 'badge blue' }), ' ', h('span', { class: 'hint' }));
    const from = (getting.find((a) => a.from) || {}).from || null;
    const words = getting.length ? `Getting ${plural(getting.length, 'file')} from ${from ? from.key : 'the tracker'}…` : `Reading ${plural(reading, 'file')}…`;
    const hint = getting.length ? `Worca gets the files from ${from && from.tracker ? from.tracker : 'the tracker'} and reads them first, then shows round 1.`
      : 'Worca reads the files first, then shows round 1.';
    const badgeEl = readingEl.querySelector('.badge');
    const hintEl = readingEl.querySelector('.hint');
    if (badgeEl.textContent !== words) badgeEl.textContent = words;
    if (hintEl.textContent !== hint) hintEl.textContent = hint;
    return readingEl;
  }
```

- [ ] **Step 4: The file row.** After `readingBadge` add:

```js
  /** A6.1 (board 35): the Downloading… badge (role=status), one node per file while its body is on its way from the tracker. */
  function downloadingBadge(a) {
    const n = fileNode(a.id);
    if (!n.dl) n.dl = h('span', { class: 'badge blue', role: 'status', text: 'Downloading…' });
    return n.dl;
  }
```

In `fileRow`:
  - after `const reading = a.status === 'reading';` add `const downloading = a.status === 'downloading';   // A6.1 D10: its body is on its way`, `const waiting = reading || downloading;` and `const absent = downloading || (!!a.error && a.error.job === 'download');   // A6.1: no body yet (downloading, or a download that failed or was refused)`; after `if (!reading) n.badge = null;` add `if (!downloading) n.dl = null;`;
  - the name (plan review S3): `absent ? h('span', { class: 'req-file-name', 'data-ui': \`file-name-${a.id}\`, tabindex: '-1', text: a.name }) : h('a', { class: 'req-file-name', href: a.href, … })` — the same `data-ui` and a `tabindex`, so `ctx.focus('file-name-…')` still lands;
  - `const asking = !waiting && !!a.asking;`;
  - the meta line: `const meta = [\`${KIND_TITLE[a.kind] || 'Text'} · ${sizeText(a.bytes)}\`, a.from ? \`from ${a.from.key}\` : null, a.costUsd > 0 ? \`read for ${usd(a.costUsd)}\` : null].filter(Boolean).join(' · ');`
  - in `top`: `downloading ? downloadingBadge(a) : reading ? readingBadge(a) : null,` in place of `reading ? readingBadge(a) : null,`, and the pencil's condition `hasText && !waiting && !asking`;
  - `state` becomes:

```js
    const est = typeof a.estimateUsd === 'number' ? ` (about ${usd(a.estimateUsd)})` : '';
    const state = downloading
      ? h('p', { class: 'hint req-file-state', text: `Worca is getting it from ${a.from ? a.from.key : 'the tracker'}. Then it reads it${est}.` })
      : reading
        ? h('p', { class: 'hint req-file-state', text: `${a.fetched && a.from ? `Downloaded from ${a.from.key}. ` : ''}Worca is reading it${est}. ${usesIt}` })
        : a.status === 'failed' ? failedLine(a, ctx, replace)
          : a.status === 'unread-budget'
            ? h('p', { class: 'hint req-file-state', text: `The Requirements budget is used up for this ${ctx.period === 'weekly' ? 'week' : 'month'}. Worca reads it when the budget allows; until then ${ctx.doc ? 'interviews list' : 'the interview lists'} it by name only.` })
            : asking ? h('p', { class: 'hint req-file-state req-file-asking', text: `Worca is looking for: “${a.asking}”…` }) : null;
```

  - the switch: `if (!waiting) {` in place of `if (!reading) {`.

In `failedLine`, after `const stuck = storeFailedOf(a);` add `const dl = !!a.error && a.error.job === 'download';   // A6.1 D10: a tracker file that could not be got, or used`; the sentence becomes `const said = stuck ? String(a.error.message || '') : dl ? (a.error.code === 'DOWNLOAD' ? \`${a.error.message} The interview lists it by name only.\` : String(a.error.message || '')) : \`Worca could not read this file…\`;` (the A8 branch unchanged); after the button's label line add `n.failed.btn.hidden = dl && a.error.code === 'REFUSED';   // the same file would be refused again: Remove is in the ⋯ menu`; and the read-again run guards a second press:

```js
    n.failed.run = stuck ? () => replace.click()
      : () => {
        if (n.failed.posting) return;   // one post per press
        n.failed.posting = true;
        act(async () => { await api('POST', `${a.href}/read-again`, {}); ctx.focus(`file-name-${a.id}`); await paint(); })
          .finally(() => { if (n.failed) n.failed.posting = false; });
      };
```

In `fileMenu`: `const reading = a.status === 'reading' || a.status === 'downloading' || !!a.asking;` and `const absent = a.status === 'downloading' || (!!a.error && a.error.job === 'download');   // A6.1: no body yet`; the Open item only when `!absent`, the Read again item only when `!(reading || stuck || absent)` (Try again on the failed line fetches it).

- [ ] **Step 5: CSS.** Add to the A6.1 block:

```css
/* A6.1 (board 35): the Files card while a file comes from the tracker — A8's row, its Downloading… badge blue (blue means active). */
.req-file .badge.blue + .badge{margin-left:6px}
```

- [ ] **Step 6: Run the tests.** `node --check ui/public/requirements-view.mjs`, then `node tools/test.mjs test/requirements-view-imported.test.mjs`, `node tools/test.mjs test/requirements-view-files.test.mjs`, `node tools/test.mjs test/requirements-view.test.mjs` → all PASS.

- [ ] **Step 7: Commit.**

```bash
git add ui/public/requirements-view.mjs ui/public/style.css test/requirements-view-imported.test.mjs
git commit -m "Requirements: the Files card while a ticket's files are downloaded and read" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The page — the imported link: the criterion tag, History and Export (board 35, D11)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`srcTag`, `historyCard`, `startExport`, `openAgain`)
- Modify: `test/requirements-view-imported.test.mjs`

**Interfaces:**
- Consumes: the feature view's `export.link` (`origin`, `importedOn`, `sinceImport`) and `export.history` (`imported`, `linked`, `linkedTo`) from Task 10; A6's `openSetup`, `openPreview`, `openComment`, `linkOf`, `xOf`, `webHref`.
- Produces: a criterion whose source is the link's key shows a link tag to the ticket; History's lines "Imported SHOP-124 from Jira · 27 Oct, 09:12" and "Started from SHOP-123 in Jira, not linked: FEAT-7 is. · 27 Oct, 09:12"; Export to Jira… on a linked feature opens the again dialog also without a setup; until the first export the dialog is "Export FEAT-8 to Jira" with D11's copy; **Create a new ticket** without a setup opens the setup first, then the preview of a new ticket.

- [ ] **Step 1: Write the failing tests.** Append to `test/requirements-view-imported.test.mjs`:

```js
const PREVIEW_URL = `${F}/export/preview`;
const AGAIN = (over = {}) => ({ mode: 'update', tracker: 'Jira', key: 'SHOP-124', ticket: { description: '## Goal\n\nx\n' }, comment: null, previewHash: 'h1',
  changes: [{ line: 'Goal: 1 line added', id: null }, { line: 'Added R-po-4 A parcel that is picked up cannot be cancelled.', id: 'R-po-4' }],
  fields: null, link: { key: 'SHOP-124', madeOn: '27 Oct', lastOn: '27 Oct', origin: 'import', importedOn: '27 Oct', sinceImport: true }, edited: false, gone: false, ...over });
const ready = (over = {}) => feature({ busy: false, status: 'done', rounds: 3, state: 'ready', attachments: [],
  readiness: { ok: true, passed: 6, total: 6, checks: [], overridable: false }, ...over });

test('D7, D19: a criterion from SHOP-124 links to the ticket; one from a file stays the file tag', async () => {
  const m = await openFeature(ready());
  const tags = [...m.host.querySelectorAll('.req-src-tag')];
  assert.deepEqual([tags[0].tagName, tags[0].href, tags[0].target, tags[0].rel, tags[0].getAttribute('aria-label')],
    ['A', 'https://acme.test/browse/SHOP-124', '_blank', 'noopener', 'SHOP-124, opens the ticket in Jira in a new tab']);
  assert.equal(text(tags[1]), 'from refund-matrix.pdf');
  m.view.destroy();
});

test('D12, board 35: History names the import, linked or not', async () => {
  const m = await openFeature(ready({ export: XV({ history: [
    { action: 'imported', tracker: 'Jira', key: 'SHOP-124', url: LINK.url, when: '27 Oct, 09:12', by: 'Ann Example', linked: true, linkedTo: null },
    { action: 'imported', tracker: 'Jira', key: 'SHOP-123', url: 'https://acme.test/browse/SHOP-123', when: '27 Oct, 09:12', by: null, linked: false, linkedTo: 'FEAT-7' }] }) }));
  const lines = [...m.host.querySelectorAll('.req-history-list li')].map((li) => [text(li.firstChild), text(li.querySelector('.hint'))]);
  assert.deepEqual(lines, [['Imported SHOP-124 from Jira · 27 Oct, 09:12', 'Ann Example'], ['Started from SHOP-123 in Jira, not linked: FEAT-7 is. · 27 Oct, 09:12', null]]);
  m.view.destroy();
});

test('D11 (board 35): Export to Jira… on an imported feature without a setup opens "Export FEAT-8 to Jira" with the import\'s words', async () => {
  const m = await openFeature(ready(), { [`POST ${PREVIEW_URL}`]: () => AGAIN() });
  q('menu-export', m.host).click();
  q('mi-export', m.host).click();
  await settle();
  const dl = document.querySelector('.req-dlg-wrap [role="dialog"]');
  assert.equal(text(dl.querySelector('h2')), 'Export FEAT-8 to Jira');
  assert.equal(text(dl.querySelector('#req-again-desc')), 'FEAT-8 started from SHOP-124 on 27 Oct. The spec has changed since. What should happen?');
  const choice = (ui) => { const l = q(ui).closest('label'); return [text(l.querySelector('b')), text(l.querySelector('.hint'))]; };
  assert.deepEqual(choice('again-update'), ['Update SHOP-124',
    "Rewrites its summary, description and fields. Its description was written in Jira; Jira keeps the old text in the ticket's history."]);
  assert.deepEqual(choice('again-comment'), ['Add a comment to SHOP-124', 'Lists what changed since the import. The description stays.']);
  assert.equal(text(dl.querySelector('#req-again-chg')), 'What changed since the import (27 Oct)');
  assert.equal(m.calls.filter((c) => c.url.startsWith('/api/requirements/export-setup')).length, 0, 'no setup asked for');
  m.view.destroy();
});

test("D11: after the first export it is A6's dialog, saying when the ticket was imported", async () => {
  const after1 = { ...LINK, exportedAt: '2026-10-28T10:00:00Z', lastOn: '28 Oct', sinceImport: false };
  const m = await openFeature(ready({ export: XV({ link: after1 }) }), { [`POST ${PREVIEW_URL}`]: () => AGAIN({ link: { ...AGAIN().link, lastOn: '28 Oct', sinceImport: false } }) });
  q('menu-export', m.host).click();
  q('mi-export', m.host).click();
  await settle();
  const dl = document.querySelector('.req-dlg-wrap [role="dialog"]');
  assert.equal(text(dl.querySelector('h2')), 'Export FEAT-8 again');
  assert.equal(text(dl.querySelector('#req-again-desc')), 'SHOP-124 was imported on 27 Oct. The spec has changed since. What should happen?');
  assert.equal(text(dl.querySelector('#req-again-chg')), 'What changed since the last export (28 Oct)');
  m.view.destroy();
});

test('D11: Create a new ticket without a setup opens Set up export first, then the preview of a new ticket', async () => {
  const SETUP_URL = '/api/requirements/export-setup/project/shop-1';
  const m = await openFeature(ready(), {
    [`POST ${PREVIEW_URL}`]: (b) => (b.mode === 'new' ? AGAIN({ mode: 'new', key: null, link: null }) : AGAIN()),
    [`GET ${SETUP_URL}`]: { setup: null, trackers: [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira', multiProfile: true, profiles: [{ id: 'acme', label: 'acme.atlassian.net (Cloud)' }] }],
      defaultProfile: { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' } },
    [`POST ${SETUP_URL}/options`]: { projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }], issueTypes: [{ value: '10001', label: 'Story' }], priorities: [], criteriaFields: [], doneStatus: null },
    [`PUT ${SETUP_URL}`]: (b) => ({ setup: b }),
  });
  q('menu-export', m.host).click();
  q('mi-export', m.host).click();
  await settle();
  q('again-new', m.host.ownerDocument).click();
  q('again-continue', m.host.ownerDocument).click();
  await settle();
  assert.equal(text(document.querySelector('.req-dlg-wrap [role="dialog"] h2')), 'Set up export for shop');
  m.view.destroy();
});
```

- [ ] **Step 2: Run them to see them fail.** `node tools/test.mjs test/requirements-view-imported.test.mjs` → the new tests FAIL (the tag is a span; History has no imported line; the setup opens first).

- [ ] **Step 3: The criterion tag.** At the start of `srcTag`, after `if (!source) return null;`, add:

```js
    // A6.1 D7, D19: a criterion from the feature's own ticket links to it (the tag names the key; a key is not a file name). The link
    // goes through the page's webHref guard, as exportChip (plan review S4); a URL it refuses leaves the plain tag below.
    const l = linkOf(f);
    const ticketHref = l ? webHref(l.url) : null;
    if (ticketHref && String(source).toUpperCase() === String(l.key).toUpperCase()) {
      return h('a', { class: 'req-src-tag req-src-ticket', href: ticketHref, target: '_blank', rel: 'noopener',
        'aria-label': `${l.key}, opens the ticket in ${l.tracker || 'the tracker'} in a new tab` }, l.key, sharedIcon(document, 'external', 11));
    }
```

- [ ] **Step 4: History.** In `historyCard`'s `LINE`, add:

```js
      // A6.1 (board 35, D12): the import, linked to the ticket or not
      imported: (x) => (x.linked === false ? [`Started from ${x.key} in ${tracker(x)}, not linked: ${x.linkedTo || 'another feature'} is.`]
        : ['Imported ', keyLink(x), ` from ${tracker(x)}`]),
```

- [ ] **Step 5: Export.** In `startExport` change the setup line to `if (!x.hasSetup && !linkOf(f)) { … }` (comment: "A6.1 D11: a linked feature updates or comments without a setup; only a new ticket needs one"). In `openAgain`:
  - before `const title = …` add `const lk0 = linkOf(f) || {};` and make the title `text: lk0.origin === 'import' && lk0.sinceImport ? \`Export ${f.id} to ${name}\` : \`Export ${f.id} again\``;
  - `cont`'s onclick becomes:

```js
      onclick: () => {
        if (busy || !data) return;
        if (mode === 'comment') openComment(f, { reason, trigger });
        // A6.1 D11: a new ticket needs the export setup, which a feature that started from a ticket may not have yet
        else if (mode === 'new' && !(xOf(f) || {}).hasSetup) void openSetup(f, { trigger, then: () => openPreview(f, { mode: 'new', reason, trigger }) });
        else openPreview(f, { mode, reason, trigger });
      } }, 'Continue');
```

  - in `render()`, replace the `desc.textContent = …` statement and the `modes.replaceChildren(…)` and `changes.replaceChildren(…)` lines with:

```js
      // A6.1 D11: an imported link says so: until the first export the dialog is about the import, then A6's with "was imported on"
      const imported = L.origin === 'import';
      const first = imported && L.sinceImport;
      title.textContent = first ? `Export ${f.id} to ${name}` : `Export ${f.id} again`;
      desc.textContent = first
        ? (changed ? `${f.id} started from ${L.key} on ${L.importedOn}. The spec has changed since. What should happen?`
          : `${f.id} started from ${L.key} on ${L.importedOn}. The spec has not changed since the import.`)
        : imported
          ? (changed ? `${L.key} was imported on ${L.importedOn}. The spec has changed since. What should happen?`
            : `${L.key} was imported on ${L.importedOn}. The spec has not changed since the last export (${L.lastOn}).`)
          : changed ? `${L.key} was made on ${L.madeOn}. The spec has changed since. What should happen?`
            : `${L.key} was made on ${L.madeOn}. The spec has not changed since the last export (${L.lastOn}).`;
```

and, below the `if (data.gone) { … }` block:

```js
      modes.replaceChildren(
        option('update', `Update ${L.key}`, first ? `Rewrites its summary, description and fields. Its description was written in ${name}; ${name} keeps the old text in the ticket's history.`
          : 'Rewrites its summary, description and fields.'),
        option('comment', `Add a comment to ${L.key}`, first ? 'Lists what changed since the import. The description stays.'
          : 'Lists what changed since the last export. The description stays.', !changed),
        option('new', 'Create a new ticket', 'For example when the feature was split.'));
      modes.hidden = false;
      changes.replaceChildren(h('h3', { id: 'req-again-chg', text: first ? `What changed since the import (${L.importedOn})` : `What changed since the last export (${L.lastOn})` }),
        ...data.changes.map(changeNode));
```

- [ ] **Step 6: Run the tests.** `node --check ui/public/requirements-view.mjs`, then `node tools/test.mjs test/requirements-view-imported.test.mjs`, `node tools/test.mjs test/requirements-view-export.test.mjs` (A6's again dialog unchanged for an export link), `node tools/test.mjs test/requirements-view.test.mjs` → all PASS.

- [ ] **Step 7: Commit.**

```bash
git add ui/public/requirements-view.mjs test/requirements-view-imported.test.mjs
git commit -m "Requirements: an imported feature's ticket tag, History line and Export copy" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: The browser proof (light, dark, 390 px, runnable alone) and the docs

**Files:**
- Modify: `tools/verify-requirements-cdp.mjs`
- Modify: `docs/requirements.md`, `docs/storage.md`, `docs/ui-levels.md`, `docs/changelog/unreleased.md`

**Interfaces:**
- Consumes: everything above, through the real app in mock mode (`WORCA_MOCK=1`): the shim's canned import answers (Task 3), the real routes, the download folder, its checks and the write into the store (Task 7), A8's mock reads.
- Produces: `node --disable-warning=ExperimentalWarning tools/verify-requirements-cdp.mjs --only=a61` runs the boot, the flag and the A6.1 section alone; `npm run verify:requirements` runs every section, A6.1 last.

- [ ] **Step 1: Make the A6 helpers shared and add the switch.** In `tools/verify-requirements-cdp.mjs`:
  - after `const ONLY_A6 = …` add `// --only=a61: the boot, the flag and the A6.1 section (start from a ticket) alone, then the page-error gate.` and `const ONLY_A61 = process.argv.includes('--only=a61');`;
  - after `process.env.WORCA_MOCK_READ_MS = String(READ_MS);` add `process.env.WORCA_MOCK_DOWNLOAD_MS = '2500';   // A6.1: a mock download waits, so "Downloading…" can be seen`;
  - `if (!ONLY_A6) {   // --only=a6 skips to the A6 section` becomes `if (!ONLY_A6 && !ONLY_A61) {   // --only=a6 / --only=a61 skip to their section`;
  - move the A6 block's helpers `shot`, `setTheme`, `lowContrast`, `contrastBoth`, `tabKey` and `tabWalk` (unchanged) out of the block, right above the `// ---- A6: export to a tracker` comment, so the A6.1 section uses them too; the A6 block's opening `{` becomes `if (!ONLY_A61) {`;
  - extend the header comment: "…; start from a ticket (A6.1: jira-source linked in mock mode; New feature › From a ticket…, the search, the preview, Use this ticket, Start the interview with the files downloaded and read, the feature linked to SHOP-124, Export to Jira… on it, the 390 px sheet; `--only=a61` runs it alone)."

- [ ] **Step 2: The A6.1 section.** Right before `await sleep(1000);\ncheck('no page errors', …)`, add:

```js
// ---- A6.1: start from a ticket (boards 32–36), in mock mode: jira-source linked with one connection; the shim's canned import answers
// (four tickets; SHOP-124 with six comments, one by an app, and five attachments, two of them not offered); a mock download writes a tiny
// body after WORCA_MOCK_DOWNLOAD_MS, a mock read takes READ_MS. Runs alone with --only=a61.
if (!ONLY_A6) {
  const { linkPlugin } = await import(new URL('../src/core/plugin-store.mjs', import.meta.url).href);
  const { createProfile } = await import(new URL('../src/core/plugin-config.mjs', import.meta.url).href);
  try { await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url))); } catch { /* the A6 section linked it */ }
  try { createProfile('jira-source', 'acme', 'acme.atlassian.net (Cloud)'); } catch { /* the A6 section made it */ }
  await A.evalJs(`fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ welcomeSeen: true }) })
    .then(() => { document.querySelector('#welcome-modal:not(.hidden) .ob-skip')?.click(); })`);
  await A.send('Emulation.clearDeviceMetricsOverride');
  const DLG = `document.querySelector('.req-dlg-wrap [role="dialog"]')`;
  const HOST = `document.querySelector('#requirements-host')`;
  const othersInert = () => A.evalJs(`[...document.body.children].filter((el) => !el.classList.contains('req-dlg-wrap')).every((el) => el.hasAttribute('inert'))`);
  const noneInert = () => A.evalJs(`[...document.body.children].every((el) => !el.hasAttribute('inert'))`);
  const click = (sel) => A.evalJs(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const search = (words) => A.evalJs(`(() => { const s = document.querySelector('[data-ui="pick-search"]'); s.value = ${JSON.stringify(words)};
    s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const newFeature = async () => {
    await A.evalJs(`location.hash = '#requirements'`);
    await sleep(300);
    await A.evalJs(`location.hash = '#requirements/new'`);
    return until(() => A.evalJs(`(() => { const b = ${HOST}?.querySelector('[data-ui="import-open"]'); return !!b && !b.hidden && !!b.closest('.req-import-labrow'); })()`), 15000);
  };

  check('A6.1 D1 (board 32): New feature shows From a ticket… at the right of the Describe it label', await newFeature());
  await shot('a61-board32-new-feature');
  await click('#requirements-host [data-ui="import-open"]');
  check('A6.1 board 33: Start from a ticket opens with its title focused and four recently updated tickets; every other child of <body> is inert',
    await until(async () => (await A.evalJs(`(() => { const d = ${DLG}; return !!d && d.querySelector('h2').textContent === 'Start from a ticket'
      && document.activeElement === d.querySelector('h2') && d.querySelectorAll('[role="radiogroup"] input').length === 4; })()`)) && (await othersInert()), 15000));
  await search('cancel');
  check('A6.1 D4: the search runs after a pause: "4 tickets in SHOP match “cancel”."',
    await until(() => A.evalJs(`${DLG}?.querySelector('.req-import-status')?.textContent === '4 tickets in SHOP match “cancel”.'`), 15000));
  await shot('a61-board33-pick');
  const pickAA = await contrastBoth(['.req-dlg-wrap .req-import-pick'], 'a61-board33-pick-dark');
  check('A6.1 board 33: the pick is AA in light and dark', pickAA.light.length === 0 && pickAA.dark.length === 0, JSON.stringify(pickAA));
  await click('[data-ui="pick-SHOP-124"]');
  await click('[data-ui="pick-continue"]');
  check('A6.1 board 34: the preview: three criteria ticked, the app comment unticked, the Office file and the 31 MB scan not offered, nothing sent to Jira',
    await until(() => A.evalJs(`(() => { const d = ${DLG}; if (!d || d.querySelector('h2').textContent !== 'Start from SHOP-124') return false;
      const crit = [...d.querySelectorAll('[data-ui^="ipv-crit-"]')]; const app = d.querySelector('[data-ui="ipv-com-10234"]');
      const off = ['10044', '10045'].map((id) => d.querySelector('[data-ui="ipv-att-' + id + '"]'));
      return crit.length === 3 && crit.every((c) => c.checked) && !!app && !app.checked && off.every((x) => !!x && x.disabled && !x.checked)
        && d.textContent.includes('Nothing is sent to Jira.') && d.textContent.includes('Worca hid 1 thing that looked like a key or password.'); })()`), 15000));
  await shot('a61-board34-preview');
  const previewAA = await contrastBoth(['.req-dlg-wrap .req-import-preview'], 'a61-board34-preview-dark');
  check('A6.1 board 34: the preview is AA in light and dark', previewAA.light.length === 0 && previewAA.dark.length === 0, JSON.stringify(previewAA));
  // §9 says "untick the automation comment"; D8 has it unticked already (checked above), so the proof unticks a person's comment
  await click('[data-ui="ipv-com-10235"]');
  await click('[data-ui="ipv-use"]');
  check('A6.1 board 32: Use this ticket fills the form (title, the strip, three criteria, the comments file and three attachments) and releases the page',
    await until(async () => (await A.evalJs(`(() => { const h = ${HOST}; return !${DLG} && h.querySelector('#req-new-title').value === 'Partial cancel for multi-item orders'
      && h.querySelector('[data-ui="import-chip"]')?.textContent === 'SHOP-124' && h.querySelectorAll('.req-import-critlist li').length === 3
      && [...h.querySelectorAll('.req-import-chips .req-new-chip-name')].map((n) => n.textContent).join('|')
        === 'SHOP-124 comments.md|packing-slip.png|partial-cancel-flow.pdf|support-macro.txt'; })()`)) && (await noneInert()), 15000));
  await shot('a61-board32-filled');
  const formAA = await contrastBoth(['#requirements-host .req-import-strip', '#requirements-host .req-import-critfield', '#requirements-host .req-import-chips'],
    'a61-board32-filled-dark');
  check('A6.1 board 32: the strip, the criteria and the ticket files are AA in light and dark', formAA.light.length === 0 && formAA.dark.length === 0, JSON.stringify(formAA));
  await click('#requirements-host .req-new-btns .btn-primary');
  let seq = null;
  check('A6.1 D10 (board 35): Start the interview opens the feature at once: the chip SHOP-124, R-po-1 to R-po-3 tagged SHOP-124, a file Downloading…',
    await until(async () => {
      const r = await A.evalJs(`(() => { const h = ${HOST}; const head = h.querySelector('[data-req-feature]'); if (!head) return null;
        return { seq: head.getAttribute('data-req-feature'), chip: h.querySelector('[data-ui="export-chip"]')?.textContent || '',
          tags: [...h.querySelectorAll('.req-src-ticket')].map((t) => t.textContent),
          downloading: [...h.querySelectorAll('.req-file .badge')].some((b) => b.textContent === 'Downloading…') }; })()`);
      if (!r) return false;
      seq = r.seq;
      return r.chip === 'SHOP-124' && r.tags.length === 3 && r.tags.every((t) => t === 'SHOP-124') && r.downloading;
    }, 20000));
  check('A6.1 board 35: the working line reads "Getting … from SHOP-124…"',
    await until(() => A.evalJs(`/^Getting [1-3] files? from SHOP-124…$/.test(${HOST}.querySelector('.req-reading .badge')?.textContent || '')`), 10000));
  await shot('a61-board35-downloading');
  const filesAA = await contrastBoth(['#requirements-host .req-files', '#requirements-host .req-reading'], 'a61-board35-downloading-dark');
  check('A6.1 board 35: the Files card while files are downloaded is AA in light and dark', filesAA.light.length === 0 && filesAA.dark.length === 0, JSON.stringify(filesAA));
  check('A6.1 D10: every file is downloaded and read, each "from SHOP-124", then round 1 asks',
    await until(() => A.evalJs(`(() => { const h = ${HOST}; const metas = [...h.querySelectorAll('.req-files .req-file-meta')].map((m) => m.textContent);
      return metas.length === 4 && metas.every((m) => m.includes('from SHOP-124'))
        && ![...h.querySelectorAll('.req-file .badge')].some((b) => /Downloading|Reading/.test(b.textContent)) && !!h.querySelector('.qpanel .qopt'); })()`),
      AFTER_HOLD_MS + 30000));
  check('A6.1 board 35: History records the import',
    await until(() => A.evalJs(`/^Imported SHOP-124 from Jira · /.test(${HOST}.querySelector('.req-history li span')?.textContent || '')`), 10000));
  await shot('a61-board35-read');
  // Export ▾ › Export to Jira… on the imported feature: not Ready yet, so A6 asks for a reason first, then the again dialog in the import's words
  await A.evalJs(`(() => { document.querySelector('#requirements-host [data-ui="menu-export"]').click(); document.querySelector('#requirements-host [data-ui="mi-export"]').click(); })()`);
  await until(() => A.evalJs(`!!document.querySelector('[data-ui="export-reason"]')`), 10000);
  await A.evalJs(`(() => { const a = document.querySelector('[data-ui="export-reason"]'); a.value = 'The team refines it in Jira.';
    a.dispatchEvent(new Event('input')); document.querySelector('[data-ui="export-anyway"]').click(); })()`);
  check('A6.1 D11 (board 35): Export to Jira… on it opens "Export FEAT-n to Jira" — "FEAT-n started from SHOP-124 on <day>. …"',
    await until(() => A.evalJs(`(() => { const d = ${DLG}; return !!d && d.querySelector('h2').textContent === 'Export FEAT-${seq} to Jira'
      && /^FEAT-${seq} started from SHOP-124 on \\d{1,2} [A-Z][a-z]{2}\\. The spec has changed since\\. What should happen\\?$/.test(d.querySelector('#req-again-desc').textContent); })()`), 15000));
  await shot('a61-board35-export');
  await click('[data-ui="again-cancel"]');
  await until(() => A.evalJs(`!${DLG}`), 5000);

  // 390 px (board 36, D19): the preview as a full-screen sheet that fits the screen, ← New feature first, three comments then Show all, 44 px targets
  await A.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await newFeature();
  await click('#requirements-host [data-ui="import-open"]');
  await until(() => A.evalJs(`${DLG}?.querySelectorAll('[role="radiogroup"] input').length === 4`), 15000);
  await search('cancel');
  await until(() => A.evalJs(`${DLG}?.querySelector('.req-import-status')?.textContent === '4 tickets in SHOP match “cancel”.'`), 15000);
  await click('[data-ui="pick-SHOP-124"]');
  await click('[data-ui="pick-continue"]');
  await until(() => A.evalJs(`!!${DLG}?.querySelector('[data-ui="ipv-use"]') && !${DLG}.querySelector('[data-ui="ipv-use"]').disabled`), 15000);
  const sheet = await A.evalJs(`(() => { const d = ${DLG}; const r = d.getBoundingClientRect(); const vw = document.documentElement.clientWidth; const vh = window.innerHeight;
    const back = d.querySelector('[data-ui="import-back"]'); const all = d.querySelector('[data-ui="ipv-showall"]');
    const btns = ['ipv-back', 'ipv-use'].map((u) => { const b = d.querySelector('[data-ui="' + u + '"]'); const br = b.getBoundingClientRect();
      const top = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
      return br.left >= 0 && br.top >= 0 && br.right <= vw && br.bottom <= vh && !!top && b.contains(top); });
    return { fixed: getComputedStyle(d).position === 'fixed', fits: Math.round(r.left) === 0 && Math.round(r.top) === 0 && Math.round(r.width) === vw && Math.round(r.height) === vh,
      back: back && getComputedStyle(back).display !== 'none' ? back.getAttribute('aria-label') : null,
      showAll: !!all && getComputedStyle(all).display !== 'none' ? all.textContent : null,
      shown: [...d.querySelectorAll('.req-import-com')].filter((li) => getComputedStyle(li).display !== 'none').length,
      bodyHidden: [...d.querySelectorAll('.req-import-cbody')].every((b) => getComputedStyle(b).display === 'none'),
      btns, noScroll: document.documentElement.scrollWidth === document.documentElement.clientWidth }; })()`);
  check('A6.1 board 36: at 390 x 844 the preview is a full-screen sheet with ← New feature, three comments by author and date, Show all 6 comments, Back and Use this ticket on screen',
    sheet.fixed && sheet.fits && sheet.back === 'Back to New feature' && sheet.showAll === 'Show all 6 comments' && sheet.shown === 3 && sheet.bodyHidden
      && sheet.btns.every(Boolean) && sheet.noScroll, JSON.stringify(sheet));
  const small = await A.evalJs(`(() => { const d = ${DLG}; ${HIT_FN}
    return [...d.querySelectorAll('.btn, .req-export-back, .req-import-check, .req-import-showall')].filter((b) => b.offsetParent !== null)
      .map((b) => [b, hit(b)]).filter(([, s]) => s.hh < 44).map(([b, s]) => (b.getAttribute('data-ui') || b.className) + ':' + Math.round(s.hh)); })()`);
  check('A6.1 D19: every row and button of the sheet is a 44 px target', small.length === 0, JSON.stringify(small));
  await shot('a61-board36-phone-sheet');
  const walk = await tabWalk(24);
  check('A6.1 D19: on the 390 px sheet Tab and Shift+Tab stay inside it', walk.out.length === 0, JSON.stringify({ back: walk.back, fwd: walk.fwd.map((t) => t.el) }));
  const phoneAA = await contrastBoth(['.req-dlg-wrap .req-import-preview'], 'a61-board36-phone-dark');
  check('A6.1 board 36: the sheet is AA in light and dark', phoneAA.light.length === 0 && phoneAA.dark.length === 0, JSON.stringify(phoneAA));
  await A.evalJs(`location.hash = '#runs'`);
  check('A6.1 D19: leaving the Requirements view closes the sheet and puts the page back (nothing left inert)',
    await until(async () => !(await A.evalJs(`!!${DLG}`)) && (await noneInert()), 8000));
  await A.send('Emulation.clearDeviceMetricsOverride');
}
```

- [ ] **Step 3: Run the proof alone, then whole.** `node --disable-warning=ExperimentalWarning tools/verify-requirements-cdp.mjs --only=a61` → `all checks passed`; then `npm run verify:requirements` → `all checks passed` (the A6 section unchanged). With `REQ_SHOTS=<a folder outside the worktree>` the `a61-*.png` screens can be compared with boards 32–36 by eye: the strip, the two columns, the amber linked alert, the blue Downloading… badge, no green fill.

- [ ] **Step 4: `docs/requirements.md`.** Right before `## Export to a tracker` add:

```markdown
## Start from a ticket

**New feature › From a ticket…** starts a feature from a ticket your team already wrote in its tracker (Jira today; other
trackers add the same steps in their own plugins). The button shows once a tracker connection can import; trackers are
connected on the Marketplace page (**Installed › Jira**, Advanced mode). Importing costs nothing and never changes the
ticket: nothing is sent to Jira.

- **Find the ticket.** Pick the connection (only with several) and the Jira project, then search by words, or paste the
  ticket's key or link to find it in any project. An empty search lists the project's most recently updated tickets. A
  ticket another feature already follows says "Linked to FEAT-7".
- **See what comes along.** The preview shows the title, the description, the acceptance criteria Worca found (in a Jira
  field, or under an "Acceptance criteria" heading in the description), the comments and the attachments, each with a
  checkbox. Keys and passwords in the ticket's text are hidden. Comments by people are ticked, those by apps and automation
  are not; comments visible only to a group or role are left out. Attachments Worca cannot read (Office files, other types,
  over 25 MB) are not offered, and a new feature takes up to 10 files and 100 MB in all.
- **Use this ticket** fills New feature: the title, the description (yours to change), the criteria and the ticket's
  files. **Change ticket…** picks another one; × stops using it and keeps what you typed.
- **Start the interview** reads the ticket again and opens the feature at once. The ticked criteria start the spec as your
  own criteria R-po-1…, tagged "SHOP-124"; the picked comments become one file, "SHOP-124 comments.md", that Worca reads
  like your other files; the picked attachments show **Downloading…** while Worca gets them from Jira, then **Reading…**.
  Round 1 waits for them (at most 6 minutes). A file Worca could not get says why, with **Try again**.
- **Linked from the start.** The header shows the ticket (**SHOP-124**), and History records the import. **Export ▾ ›
  Export to Jira…** updates or comments on the same ticket (an update keeps the ticket's issue type and priority), and
  **Start in Worca** offers **Report back to SHOP-124**. A ticket another feature already follows starts the new feature
  unlinked: one ticket follows one feature.
```

- [ ] **Step 5: `docs/storage.md`.** After the A6 lines (the paragraph ending "Every export is also an `export` turn.") add:

```text
                                        Requirements import (v80): req_export_links.origin ('export' | 'import'; a link
                                        an import made keeps the ticket's issue type and priority) and
                                        req_attachments.fetch_json (a tracker file still to be downloaded: the
                                        connection, the ticket key and the attachment id; NULL for an upload).
```

and after the `tmp/requirements/att-read-<8 hex>/` entry add:

```text
  tmp/requirements/att-get-<8 hex>/     one tracker download's folder, mode 0700: the connector writes the body to
                                        body.part, Worca checks it and writes it into requirements/att/; removed when the
                                        download ends (a restart's leftovers older than an hour are swept at boot)
```

- [ ] **Step 6: `docs/ui-levels.md`.** After the row `| Connect a tracker's Open the Marketplace page | A — the Marketplace page is Advanced |` add:

```markdown
| Start from a ticket: New feature's From a ticket…, the pick and the preview and their phone sheets, the filled form (Starting from SHOP-124, Change ticket…, the criteria, the ticket's files), Downloading… and the download states on the Files card, "from SHOP-124", the criteria's ticket tag, History's import line, Export to Jira… on an imported feature | S — product owners are its users |
| Start from a ticket's "Fix the connection on the Marketplace page (Installed › Jira), then try again." | A — the Marketplace page is Advanced |
```

- [ ] **Step 7: The changelog.** In `docs/changelog/unreleased.md`, `## Requirements (experimental)`: append to the paragraph that ends "…and a run started from the feature reports back to the ticket." the sentence " A feature can also start from a ticket: **From a ticket…** on New feature takes its title, description, acceptance criteria, comments and the attachments you pick, and the feature stays linked to it."; the Chips line gains ` · start from a ticket` before ` · experimental: turn it on in Settings › Labs`; the pull-request list gains `- Requirements: start from a ticket`.

- [ ] **Step 8: Commit.**

```bash
git add tools/verify-requirements-cdp.mjs docs/requirements.md docs/storage.md docs/ui-levels.md docs/changelog/unreleased.md
git commit -m "Requirements: the start-from-a-ticket browser proof and docs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Whole-branch check

**Files:** whatever the merge and the comparison show; nothing new by plan.

- [ ] **Step 1: Merge the latest base (merge commits only, never rebase).** `git fetch origin`. The base is `feat/req-a6-jira-export` until A6's pull request is merged into `dev`, then `origin/dev`: check with `gh pr list --head feat/req-a6-jira-export --state all --json number,state,mergedAt`. Merge the right one: `git merge --no-ff feat/req-a6-jira-export` (or `git merge --no-ff origin/dev`). Resolve conflicts keeping both sides' meaning; never drop an upstream change. The places A6.1 shares with A6 and A8: `export.mjs`'s probe and `planExport`, `attachment-job.mjs`'s queue and `readAgain`, `routes.mjs`' table and `POST /api/requirements`, `requirements-view.mjs`'s `paintNew`, `fileRow`, `openAgain`, and the Requirements block of `style.css` (keep the A6.1 rules last, before the marketplace marker).

- [ ] **Step 2: Renumber the schema if the base took 80.** `git show <base>:src/core/db.mjs | grep -n "SCHEMA_VERSION ="`. With 80 or more taken, A6.1's rung becomes the next free number N: `SCHEMA_VERSION = N`, the rung `if (current < N) repairSchemaGaps(db, schemaGaps(db));` after the base's last rung, the comments "v80" → "vN" in `db.mjs` and `docs/storage.md`, and `git mv test/db-migrate-v80.test.mjs test/db-migrate-vN.test.mjs` with one more case: a DB stamped 80 by this branch's early numbering (the two columns, none of the base's v80) reaches N complete. Run `node tools/test.mjs test/db-migrate-vN.test.mjs` and every `test/db-migrate-v7*.test.mjs` and `test/db-migrate-v8*.test.mjs` one at a time → pass. Commit: `Requirements: renumber the import schema rung to vN`.

- [ ] **Step 3: The full suite with the per-file runner, compared test name by test name with the baseline.** In this worktree (Git Bash), into a log folder outside the worktree that you create once (never removed by you):

```bash
mkdir ../a61-logs-<date>
for f in test/*.test.mjs; do timeout 300 node tools/test.mjs "$f" > "../a61-logs-<date>/$(basename "$f").log" 2>&1 || echo "$f" >> ../a61-logs-<date>/failed.txt; done
```

In the baseline (`<baseline>`): `cd <baseline> && git log -1 --oneline` must name the base merged in Step 1; run the same loop there for the files in `failed.txt` only, into `../a61-baseline-logs-<date>/`. For each failed file, list the failing test names in both logs (`grep -E '^\s*(not ok|✖)'`). Every test that fails here and not in the baseline is this branch's to fix (in a commit of its own, `Requirements: …`, then that file again with `node tools/test.mjs test/<file>.test.mjs`); a test failing in both is pre-existing only once its names were compared and match. Never call a failure pre-existing without that comparison; a file that hit the 300 s timeout is a failure to explain, not to skip.

- [ ] **Step 4: Linux (WSL, Node 22).** `mkdir ~/a61-linux-<date> && git archive HEAD | tar -x -C ~/a61-linux-<date>` (`mkdir` fails on a name already used: pick a new one, never `rm -rf` an old one), then in WSL `cd ~/a61-linux-<date> && npm ci`, then the per-file runner with a 300 s timeout per file — never plain `npm test` in WSL:

```bash
mkdir logs
for f in test/*.test.mjs; do timeout 300 node tools/test.mjs "$f" > "logs/$(basename "$f").log" 2>&1 || echo "$f" >> logs/failed.txt; done
npm run smoke
```

Every file passes, or its failure is compared by test name with the same run of the base there. Record the counts (files, passed, failed, timed out).

- [ ] **Step 5: The browser proof again.** `node --disable-warning=ExperimentalWarning tools/verify-requirements-cdp.mjs --only=a61`, then `npm run verify:requirements` → `all checks passed` both times.

- [ ] **Step 6: Syntax and leftovers.** The repo has no lint script: `node --check` each `.mjs` this branch touched (`git diff --name-only <base>... -- '*.mjs'`) → no output; `git diff <base>... | grep -n -E "console\.log|debugger|TODO|FIXME"` → nothing new; `git diff <base>... | grep -n -i -E "[A-Z]:\\\\|/Users/|/home/"` → no local path; `git diff <base>... -- src plugins test tools | grep -n -o -E "(author|displayName): '[^']*'"` → every name is "Ann Example", "Bo Example", "Cy Example", "Jira Automation" or "Release Bot" (no real person's name, and none of board 34's); `git ls-files --eol ui/public/style.css ui/public/requirements-view.mjs` still shows `w/crlf` and `git diff <base>... --stat` shows no whole-file rewrite of either.

- [ ] **Step 7: Stop before any real Jira call.** Report to the controller: the merge, the schema number, the test comparison (files and test names: here, the baseline and Linux), the proof. A check against a real Jira (a test project the user names, by hand: search by words and by a pasted link, the preview of a ticket with a criteria section and with a criteria field, comments with a restricted one, Start the interview with a PNG, a PDF and a text attachment on Cloud — its signed media redirect — and on Data Center as available, Export ▾ › Update on the imported ticket keeping its issue type, a run with Report back) happens **only after the user's explicit OK**, and its findings go into the pull request description. No push: the controller opens the pull request.

---

## Appendix: design decisions and boards → tasks

| Spec point | Task(s) |
|---|---|
| D1 the entry on New feature; it fills the form; shown only with an importing connection | 11, 12, 14 |
| D2 four optional ops, `capabilities().import`, A6's cached probe, API 5, not in `/api/sources/call` | 3, 4, 5, 6, 9 |
| D3 connection and project as A6 chooses them; the page session's last choice | 6, 11 |
| D4 one search box, recently updated first, 300 ms, 20 a page, Show more, Linked to FEAT-7, the radio group | 4, 6, 11 |
| D5 the preview shows exactly what will be imported; default ticks; Back keeps the search; nothing sent | 2, 6, 12, 13 |
| D6 title and description; empty; longer than 20,000 → the description file | 2, 9, 12, 13, 14 |
| D7 criteria as R-po (edited, from SHOP-124): field, else a section; 30 × 500; the tag links the ticket; "(from SHOP-124)" in Markdown, not in SHOP-124's own ticket | 1, 2, 4, 9, 10, 16 |
| D8 comments as one file Worca reads; names only (also the raw wiki fallback); apps unticked; restricted left out; newest 50; 4,000 characters | 2, 4, 9, 12 |
| D9 attachments: offered with reasons; caps over the whole form; downloaded server-side into a 0700 folder; the host's checks; the checked bytes into A8's store | 2, 5, 7, 9, 13, 14 |
| D10 Start the interview: second read, the feature at once, downloads afterwards (two at a time), round 1 waits, readiness counts a downloading file, per-file failures, Try again, a refused file, removal, restart | 7, 8, 9, 14, 15 |
| D11 A6's link with `origin = 'import'`; Export straight to the again dialog, its copy; issue type and priority kept; edited check vs the import; Report back on; Create a new ticket makes an export link | 1, 9, 10, 16 |
| D12 one ticket follows one feature: the preview's alert, the unlinked create, History's line | 1, 6, 9, 12, 13, 14, 16 |
| D13 schema v80, two columns | 1 |
| D14 the import's thread line; `from` on the file turn; "from SHOP-124" in the Files card | 2, 7, 8, 9, 10, 15 |
| D15 server-side calls; data rules; redaction at the import; no account id (rendered or raw); the download's address, redirect and size rules; `dest` and the host's checks; names; the log's first line only | 2, 3, 4, 5, 6, 7 |
| D16 the errors (A6's reach sentence; gone; cannot import; no result; per-file reasons; the restart) | 6, 7, 9, 11, 12, 13, 14, 15 |
| D17 limits and timeouts | 2, 6, 7 |
| D18 flag, routes in `REQUIREMENTS_ROUTES`, no booking, mock answers | 3, 9, 17 |
| D19 dialogs (modal, title focus, focus back, inert), the search's names, checkbox names, the reasons, the strip's ×, the links; the 900 px sheets; 44 px targets on the form's new controls | 11, 12, 13, 14, 16, 17 |
| D20 levels (S; the Marketplace hint A) | 11, 12, 17 |
| U1 (user decision) import failures in A6's wording; `firstLine` | 3, 6 |
| U2 (user decision) Remove / Try again while round 1 waits follow A8's busy rule | 8 |
| §3 data | 1, 7 |
| §4 the contract, the comments file, the mock answers | 2, 3, 4, 5 |
| §5 the Jira connector | 4, 5 |
| §6 API | 6, 8, 9 |
| §7 boards 32–36 and "Not on the boards" | 11–17 |
| §8 code changes | 1–16 |
| §9 testing (pure, service, downloads, export, prompts, migration, Jira, shim, API, UI, real browser, Linux, docs; real Jira only with the user's OK) | 1–18 |
| §10 where A6.1 meets A6, A8, A3 | 7, 8, 10, 18 |
| §11 out of scope | not built |

## Self-review notes

- Code-forced placements and additions, each the smallest the code needs: the preview's body takes `formFiles: { count, bytes }` (D9's caps count the files already on the form, which the server cannot know otherwise); the create answers `notOnTicket: { key, comments: [id], attachments: [{ id, reason }] }` beside A8's `filesNotStored` (whose names keep meaning "could not store it"), and the page words both; `fetch_json` also holds the tracker's display name (a download's failure line and the restart line name it after a restart); `downloadAttachment` answers `{ gone: true, forbidden: true }` for a 403 (D16 tells "may not see it" apart from "no longer on SHOP-124"); the `imported` turn carries `linkedTo` (History's unlinked line names the feature that follows the ticket); "from SHOP-124" is derived from the file turns (`fileOrigins`) rather than stored on the row; jira-source finds the "Acceptance Criteria" field through `/rest/api/2/field` so the issue read keeps §5's explicit field list; `insertDownloadRow` lives in `attachment-fetch.mjs` and A8's `sweepReadFolders` also removes `att-get-*` (one boot sweep); `round.mjs` imports `ticket-import.mjs`, which reaches `round.mjs` back through `attachments.mjs` (no top-level use either way).
- Deviations from the spec, said once (each recorded in the design as "adjusted for the build" or a user decision): search, preview and create failures use A6's own `reachSentence` (design U1, user decision 2026-10-28), and a download's per-file reasons are fixed phrases, never the plugin's text (D16 adjusted); the log keeps a failure's first line only. A downloaded body is read once through a descriptor and those checked bytes are written into A8's store, instead of a rename of `dest` (D9 adjusted; plan review S7 and M1). §8's "the generated files … in one transaction" is two steps: the feature, its link, its turn and (separately) the downloading rows are transactions; the generated files go through A8's `addAttachments` (body first, then row), as A8's create stores its files, and a store failure never undoes the feature. §9's browser step "untick the automation comment" contradicts D8 (app comments are unticked by default): the proof checks it is unticked and unticks a person's comment. §9's "two files Downloading… and two Reading…" depends on timing: the proof checks a Downloading… badge, the working line and then every file read. The Jira tests are two new files over real HTTP instead of `test/jira-source-connector.test.mjs`'s fake `fetch` (A6's precedent). The preview's redaction line sits under the description (§7) where board 34 shows it under the comments (the doc wins). Only attachments are disabled by the preview's caps; the comments file's first tick is checked again by the server's caps at the create.
- Copy this plan adds where the design names none is listed once in Global Constraints (the server refusals, the one-criterion and no-criteria thread lines, "1 ticket … matches", "No ticket matches …", "SHOP-124 has no description.", the D12 strip line, the comment-gone line, "Downloaded from SHOP-124." from board 35, the refused tails "it is not the file Jira described" and "its content does not match its type").
- Task sizes: every task brief stays under about 450 lines. The plan review split the downloads (Task 7, `attachment-fetch.mjs`; Task 8, the A8 integration and readiness) and the two dialogs (Task 11, the button and the pick; Task 12, the preview); Task 13 holds the states, the caps and the phone CSS.
