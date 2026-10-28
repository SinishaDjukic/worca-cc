# Requirements A6.1: start a requirements interview from a tracker ticket (Jira first)

Date: 2026-10-27. Base: `feat/req-a6-jira-export` (4f79c83ac, schema v79, with A3 Feature chat and A8 files from `dev`).
Branch: `feat/req-a61-jira-import`. Part A6.1 of the requirements track, the follow-up to A6. A1 is
`plans/requirements-design.md` (A1-D<n>), A2 `plans/requirements-a2-design.md` (A2-D<n>), A1.1
`plans/requirements-a11-design.md` (A1.1-D<n>), A7 `plans/requirements-a7-design.md` (A7-D<n>), A8
`plans/requirements-a8-design.md` (A8-D<n>), A3 `plans/requirements-a3-design.md` (A3-D<n>), A6
`plans/requirements-a6-design.md` (A6-D<n>). The screens are mocked as canvas boards 32–36 ("Requirements — design round 6:
A6.1 start from a ticket"); nothing is built before they are approved.

The user approved the requirements below before leaving and delegated the rest. Every decision this document makes in
their absence is marked **(decided in the user's absence; review on return)**; what is not marked is the user's own
requirement. Each marked decision says why, and the alternative where there is a real one. After the plan's review
(2026-10-28) the user settled two spec-level points, marked **(user decision 2026-10-28)**; what the implementation plan
had to change against this document is marked **(adjusted for the build)**.

**Approved requirements (binding):** a separate follow-up after A6 export. Import from a ticket: title, description,
acceptance criteria and comments become the new feature's starting content and context. The ticket's attachments are
offered as feature files (A8): the import lists them with checkboxes; picked ones are downloaded through the plugin,
server-side, and read like A8 files, with A8's types and size limits; Office files are refused as in A8. Tool-neutral
like A6: optional connector ops in the shared task-source contract, Jira first, and the Requirements code never names
Jira. It reuses the Jira connection (Marketplace › Installed › Jira profiles), A6's export setup and connection choice,
and A6's FEAT↔ticket link: an imported feature is linked to its ticket from the start, so a later Export updates or
comments on the same ticket and Start can Report back. Design-first: the screens are boards before any build.

## 1. Goal

**A product owner can start a feature from a ticket the team already wrote.** New feature fills itself from the ticket:
its title and description, its acceptance criteria as the product owner's starting criteria, its comments as context for
the interview, and the attachments the product owner picks as the feature's files. The feature stays linked to the
ticket, so Export updates that ticket and a run reports back to it. The Requirements code knows only "a task source that
can import"; Jira is the first plugin that can.

**Success:**
1. With a tracker connected that can import, New feature shows **From a ticket…** next to **Describe it**.
2. The product owner finds the ticket by key, link or words in the chosen connection and project, and sees what will be
   imported before anything is: title, description, the acceptance criteria found (or "none"), the comments and the
   attachments, each with a checkbox, sizes and the reasons a file cannot come along.
3. **Use this ticket** fills the form; nothing is created and nothing is downloaded until **Start the interview**.
4. Start the interview creates the feature at once, with the criteria as R-po-1… marked "from SHOP-124" and the picked
   comments as one file Worca reads; the picked attachments show **Downloading…**, then **Reading…**, while Worca gets them
   server-side and reads them like A8 files; round 1 waits for them as for files added on New feature.
5. The feature page shows the ticket chip **SHOP-124 ↗** from the start and the History card says it was imported; Export
   then updates or comments on SHOP-124, and Start offers **Report back to SHOP-124**.
6. The import itself makes no model call and costs nothing; reading the files costs what A8 reads cost. Nothing is ever
   written to the tracker by an import. With the `requirements` flag off nothing of this shows or answers.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **The entry is on New feature, and it fills the form** (decided in the user's absence; review on return). **From a ticket…** (`.btn .btn-mini`, `aria-haspopup="dialog"`) sits at the right end of the **Describe it** label row. It opens **Start from a ticket** (pick, D4), then **Start from SHOP-124** (the preview, D5); **Use this ticket** writes the title and description into the form, adds the criteria field and the files, and shows the ticket strip at the top of the form (board 32). The product owner can still change everything; **Start the interview** creates the feature as today, with the ticket (D10). The button is shown only when at least one connection can import (D2); without one it is absent, with no "Connect a tracker…" nudge here (Export ▾ already has one, A6-D1). Recommended over a "Describe it / From a ticket" tab: the imported content needs the same form (title, description, files, For), and a tab would hide what is imported behind a switch. Starting an existing feature's link from a ticket ("link FEAT-5 to SHOP-124") is out of scope (§11). |
| D2 | **Four new optional ops in the shared contract, API stays 5** (decided in the user's absence; review on return). `importOptions`, `searchTickets`, `importTicket` and `downloadAttachment` (§4), discovered through the existing `capabilities()` op, which gains `import: true`, cached exactly as A6-D3 caches `export` (one probe per plugin, source id and installed version; a failed probe stands 60 s per connection; 10 s per probe). Additive, so `WORCA_PLUGIN_API` stays 5 and jira-source keeps `"worca-cc-api": ">=5 <6"`. **Why not `listTasks` / `getTask` directly:** `listTasks` takes the manifest's own inputs (jira-source's `project` and `jql`), so the Requirements code would have to name Jira's input keys, and `getTask` returns one Markdown body with the comments merged in and no attachments, criteria or fingerprint. The new ops reuse their code inside jira-source (`pastedKey`, `buildJql`, the Cloud and Data Center search paths, `htmlToMarkdown`), so the search behaves as the New pipeline task browser does. `downloadAttachment` writes the file to a path the host gives it (`dest`) instead of answering the bytes: the plugin child is spawned by `callSource` on the same machine as the host, as the same user, so a host path means the same file to both, and a 25 MB attachment never travels as about 33 MB of base64 through the child's stdout (D9). None of the four is added to `POST /api/sources/call`'s allowlist: the browser never calls them. |
| D3 | **Connection and project, as A6 chooses them** (decided in the user's absence; review on return). The picker's **Connection** select lists every connection that can import (option text: the profile's label, led by "<tracker> · " when several trackers can import, as A6's setup); it is shown only when there is more than one. It starts at the connection of the chosen target's export setup (the form's **For**) when that connection can import, else A6's `defaultConnection(scope)`. The **<tracker> project** select (`importOptions().projects`, first option **All projects**) starts at the export setup's tracker project when the connection is the setup's, else All projects. A pasted key or ticket link finds the ticket in any project of the connection (jira-source's `pastedKey`). The last connection and project are kept for the page session. |
| D4 | **Pick: one search box, recent tickets first** (decided in the user's absence; review on return). An empty box lists the project's most recently updated tickets under "Recently updated in SHOP"; typing searches after 300 ms ("<n> tickets in SHOP match “cancel”."). 20 per page and **Show more**. Each result: key, title, "<type> · <status> · updated <d Mon>"; a ticket already linked to a feature of this install shows the neutral chip "Linked to FEAT-7" (D12). The results are a `role="radiogroup"` "Tickets"; **Continue** is enabled once one is picked. |
| D5 | **The preview shows exactly what will be imported, and nothing is imported yet** (decided in the user's absence; review on return). `POST …/import/…/preview` calls `importTicket` and answers the processed ticket (D6–D9): title, description as the form will get it, the criteria found with a checkbox each, the comments with a checkbox each, the attachments with a checkbox, kind and size each, and the reason any of them cannot come along. Ticked by default: every criterion, every comment by a person, every attachment that A8 can take within the caps. **Use this ticket** only fills the form; **Back** returns to the pick with the search kept. The preview never changes the tracker, and says so: "Nothing is sent to Jira." |
| D6 | **Title and description** (decided in the user's absence; review on return). Title: the ticket's summary, one line, at most `LIMITS.title` (200). Description: the connector's Markdown of the ticket's description (§5), less a criteria section it found (D7), redacted (D15), written into **Describe it**, where the product owner can change it. An empty description leaves Describe it empty with the hint "SHOP-124 has no description. Describe it in a few sentences." (the form's own rule then applies). Longer than `LIMITS.description` (20,000): the form keeps the text up to the last paragraph break before the limit and the whole text comes along as a picked text file **SHOP-124 description.md**, with the line "SHOP-124's description is longer than 20,000 characters. The form keeps the start; the whole text goes along as SHOP-124 description.md." |
| D7 | **Acceptance criteria become the product owner's own starting criteria R-po-1… (`edited: true`), marked "from SHOP-124"** (decided in the user's absence; review on return). Found in this order: a criteria field the connector names (§5: the export setup's criteria field on the same connection, else a multi-line field named "Acceptance criteria"), else a section of the description found by the host (`splitCriteria`, §8: a heading, a bold line or a line ending in ":" that reads "Acceptance criteria", "Acceptance criterion" or "AC", followed by list items, or by lines up to the next heading or blank line), else none ("None found in SHOP-124. Round 1 asks for them."). At most 30 (`LIMITS.items`), each at most 500 characters. Ticked ones are written into the new feature's spec as `{ id: 'R-po-<n>', text, edited: true, source: 'SHOP-124' }`; unticked ones are left out ("Unticked ones are left out; they stay in Jira."). **Why, against "context for round 1":** a ticket's acceptance criteria are the team's agreed contract and usually the product owner's own words; as R-po items they are ground truth the interview may ask about but never rewrites (A1-D6), so round 1 asks about the gaps instead of re-deriving them; they show in the spec at once, the product owner can edit or remove them, and an Update writes them back to the same ticket (into the same field when they came from one, D11). As context, the model would write its own criteria from them (unedited items it may reword in any later round), the product owner would have to check each again, and the binding list would be lost. The risk, a wrong or vague criterion, is met by the checkboxes and the ordinary edits. The source tag shows "SHOP-124" after the criterion's text and links to the ticket (A8-D13's tag; a key is not a file name, so the view links it to the feature's ticket URL when the link names that key, else shows it plain); the Markdown export writes "(from SHOP-124)"; the ticket built for SHOP-124 itself leaves that one source out (D11). |
| D8 | **Comments are context only, as one file Worca reads** (decided in the user's absence; review on return). The picked comments become one text file, **SHOP-124 comments.md** (§4's layout: per comment "**<author>** · <d Mon yyyy>" and its Markdown), added to the feature as an A8 file: Worca reads it once before round 1 ("What Worca took from it"), every round carries its summary and, while small, its full text in `<attachments>` as data; the product owner can edit what Worca took, ask about it or remove it; **Send with the run** is off (A8-D1). They are never spec text. **Authors by name only:** the connector returns a comment's display name and whether it was written by an app or automation (`authorKind`), never an email, account id or avatar; profile links and @mentions in comment bodies become plain names (§5). App comments are unticked by default. Comments restricted to a tracker group or role are never offered ("1 comment visible only to a Jira group or role is left out."). The newest 50 are offered (older ones: "and <n> older comments"), each at most 4,000 characters. **Why a file and not a prompt block:** it reuses A8's prompt block, budgets, data rule, redaction and edit controls without changing a prompt, and the product owner sees what Worca took from the comments; the cost is one small read (a text file within 24 KB goes inline, no tools, A8-D3). |
| D9 | **Attachments: offered with checkboxes, downloaded server-side after Start into a private host folder, then exactly A8 files** (decided in the user's absence; review on return). The preview lists each attachment with its name, kind and size (from the tracker's metadata) and a checkbox. One A8 cannot take is shown unticked and disabled with A8's reason, said for a file not added yet: "Not offered: Worca reads text, images and PDF. Save it as PDF to attach it here." (Office), "Not offered: Worca reads text, images and PDF." (any other type), "Not offered: it is over 25 MB.". Ticked by default within the caps, in the ticket's order. The caps are A8's for the New feature form and count everything the form holds (D7's and D8's generated files, the ticket's attachments and files picked from disk): 10 files ("A feature takes up to 10 files; 10 are picked.") and 100 MB in all ("Picked files are at 100 MB, a new feature's limit. Add more on the feature page."); a checkbox that would pass a cap is disabled with that line. In the form the picked attachments are file chips with a neutral "SHOP-124" chip and the hint "Worca gets the SHOP-124 files from Jira when you start the interview."; × removes one. The bytes never reach the browser. **How a file arrives:** for each download the host makes a fresh private folder, `<worcaHome>/tmp/requirements/att-get-<8 hex>/` (mode 0700, the same kind of single-use folder as A8's `att-read-*` copies), and passes `dest`, a fixed name inside it (`body.part`), never derived from the attachment's name. The connector streams the body to `dest`, creates it exclusively (`wx`, 0600), stops and deletes the partial file once `maxBytes` is passed, and answers `{ name, mime, bytes }`. The host then checks that `dest` is still the file it named inside the folder it created (resolved path inside that folder, `lstat` a regular file and no link, its size the answered `bytes` and at most `maxBytes`), validates it as an upload (A8's `validateAttachmentUploads` rules: type by extension and sniffed content, UTF-8 and no NUL for text, the size and duplicate rules), and writes it into A8's store as `<worcaHome>/requirements/att/<id><ext>` under the row's store-minted id (adjusted for the build: `dest` is opened once — on POSIX without following a link — checked against the `lstat` taken before it (same inode and size) and read through that one descriptor, and exactly those checked bytes are validated and written into the store; a `rename` of `dest`, as first planned, would let the file change between the check and the move. A failure of the host's own steps — the folder, the store's folder, the write, the read queue — fails that file with "Worca could not store it" and **Try again**; a row is never left downloading). The folder is removed on every path; the boot sweep removes `att-get-*` folders older than an hour, as A8's. |
| D10 | **Start the interview creates the feature at once; the ticket is read again; the downloads run afterwards** (decided in the user's absence; review on return). `POST /api/requirements` gains `fromTicket` (§6). The server calls `assertCapacity`, then `importTicket` again (the form's title, description and criteria are the product owner's; the comments and attachments are taken by id from this fresh read). The ticket cannot be read (D16) or is gone: nothing is created and the form keeps everything. Otherwise, without waiting for any download, it creates the feature with its criteria, the link (D11) and the `export` turn `imported` (§3); stores the comments file (and the description file) as ordinary A8 files, read at once; adds one A8 file row per picked attachment in the new state `downloading` (§3), named, typed and sized from the tracker's metadata; starts the orientation; and answers 201 with the feature view. The page opens FEAT-8 immediately: its working line reads **Getting 3 files from SHOP-124…** (`role="status"`), then A8's **Reading 4 files…**; each file shows the blue badge **Downloading…** and "Worca is getting it from SHOP-124. Then it reads it (about $X)." until its body arrives, then A8's **Reading…**. Downloads run in their own queue, at most `MAX_DOWNLOAD_JOBS = 2` at a time across all features (a waiting one also shows Downloading…), each within `DOWNLOAD_TIMEOUT_MS`; a finished one goes into A8's read queue. **Round 1 waits for them exactly as for files added on New feature** (A8-D2): `readsSettled` also waits for the feature's downloads, at most `ROUND1_WAIT_MS` (6 minutes) in all; then round 1 runs and lists a file still downloading or reading by name only ("being downloaded from SHOP-124; known by name only." in `<attachments>`). **A failed download marks only that file** (`failed`; the feature stays usable and the interview goes on): "Worca could not get this file from Jira: <reason>. The interview lists it by name only." (`role="alert"`) with **Try again**, which downloads it again through the same connection (A8's `read-again` route; a file with no body is fetched first). A file that arrived but A8 refuses is `failed` with "Worca could not use this file: <reason>." and no Try again (reasons: A8's tails, e.g. "it is over 25 MB", "Worca reads text, images and PDF", "it is already attached as <name>"); the product owner removes it from the ⋯ menu. A comment or attachment no longer on the ticket at the second read is left out, and the feature page says so once: "<name> was not added: it is no longer on SHOP-124." (adjusted for the build: the create's answer carries `notOnTicket: { key, comments: [id], attachments: [{ id, reason }] }` beside A8's `filesNotStored`, which keeps meaning "could not store it"; the page words both, naming comments and files from its own preview state). Like a file being read (A8-D8), a file still downloading counts as one to ask about, so readiness never passes "Interview finished" while a ticket's file is on its way. Removing a downloading file deletes its row at once; its download's result is thrown away and its folder removed. **While the feature waits for its ticket files before round 1, it counts as busy** (A8's rule: the file routes go through `editable()`), so Remove and Try again on those files work once round 1 has started; a file still downloading or failed when round 1 starts is listed by name only. No special exception code (user decision 2026-10-28, U2). On boot, `recoverAttachmentReads()` turns every file left `downloading` into `failed` with "Worca restarted before it got this file from Jira." and Try again. |
| D11 | **The link is A6's, made at the import, with its origin** (decided in the user's absence; review on return). The create writes A6's `req_export_links` row: the connection (plugin, source id, profile), `tracker_project` (the ticket's project), `ticket_key`, `ticket_url`, `created_at` and `exported_at` the import time, `spec_json` the spec as created (the ticked criteria and nothing else), `fields_json` `{ projectName, issueType, issueTypeName, priority, priorityName, labels: ['worca'], criteria }` from the ticket (criteria: its field, or the description), `fingerprint` the ticket's own (§5, the same normalisation as `ticketState`), and the new `origin = 'import'` (§3). **Effect on Export (A6):** Export to Jira… on a linked feature goes straight to the again dialog, also without an export setup (only **Create a new ticket** needs one, and opens it first); until the first export it is titled **Export FEAT-8 to Jira** with "FEAT-8 started from SHOP-124 on 27 Oct. The spec has changed since. What should happen?"; **Update SHOP-124** (default) adds "Its description was written in Jira; Jira keeps the old text in the ticket's history."; **Add a comment** lists everything added since the import ("What changed since the import (27 Oct)", the comment's first line "Updated in Worca since the import (27 Oct)"); after the first export the dialog is A6's with "SHOP-124 was imported on 27 Oct." for "was made on". An imported link keeps the ticket's own issue type and priority on every Update (A6's `setupRules` does not apply to `origin = 'import'`), so a Bug stays a Bug; labels are added, never removed (A6-D7). A6's "edited in Jira" check compares with the fingerprint taken at the import, so a description changed in Jira after the import warns before an Update. **Report back** (A6-D15) is on by default because the link exists; it moves the ticket only when an export setup on the same connection names a done status, else it only comments. **Forget the link** works as A6-D12. **Create a new ticket** moves the link and makes it an ordinary export link (`origin = 'export'`). |
| D12 | **One ticket follows one feature** (decided in the user's absence; review on return). When any feature of this install, archived ones included, is linked to the same ticket on the same connection, the preview says "SHOP-123 is linked to FEAT-7 · Cancel an order before it ships. The new feature can start from it but stays unlinked: one ticket follows one feature." (`role="alert"`, amber), and the new feature is created without a link and without the chip; its History card still records the import ("Started from SHOP-123 in Jira, not linked: FEAT-7 is."). Recommended: two features writing to one ticket would overwrite each other's description and both report back. Alternative: move the link to the new feature, which would silently change FEAT-7's Export and Report back. |
| D13 | **Schema v81: two columns** (decided in the user's absence; review on return). A6's link table already holds everything but where a link came from, which decides D11's copy and keeps an imported ticket's issue type and priority: `req_export_links.origin TEXT NOT NULL DEFAULT 'export'` (`'export'` \| `'import'`). A file that is still to be downloaded must say where from, also after a restart and for a feature left unlinked (D12): `req_attachments.fetch_json TEXT` (NULL for every uploaded file). Both join `INCREMENTAL_COLUMNS`. No new table: the comments and attachments become ordinary A8 rows, the criteria ordinary spec items, the import an `export` turn. Alternative without a column: derive the origin from the turns (the oldest `export` turn being `imported`), which breaks after Forget the link and a later re-link and costs a turn scan on every view. |
| D14 | **Round 1 is told where the feature came from** (decided in the user's absence; review on return). A6's `export` turns write no thread line; the `imported` one writes one: "The product owner started this feature from Jira ticket SHOP-124. Its acceptance criteria are R-po-1 to R-po-3; its comments are in “SHOP-124 comments.md”." ("It had no acceptance criteria." without any; the comments part only with a comments file; `<tracker>` and the key come from the turn, so the Requirements code still never names Jira). Inside `<thread>`, so it is data under the round's existing data rule. Every feature that was not imported keeps byte-identical prompts. A file added by the import records `from: { tracker, key }` on its A8 `file` turn `added`; the Files card shows "from SHOP-124" in its meta line ("Text · 3 KB · from SHOP-124 · read for $0.02"); a replaced file loses it. |
| D15 | **Safety** (decided in the user's absence; review on return). Every tracker call runs server-side through `callSource` with the connection's profile; the token stays in the plugin's config and the browser sees none, and the new routes answer no config value. **Ticket text is data, never instructions:** the description goes into `<description>`, the criteria into `<current_spec>`, the comments into `<attachments>`, the import line into `<thread>`, all `asData`-escaped under the prompts' existing data rules; the page renders ticket text as text nodes, never as HTML. **Secrets:** unlike an uploaded file (stored as given, redacted on the way to the model, A8-D15), the description, the criteria and the comment bodies are redacted with `redactAskText` at the import, before the preview and before storage, because the product owner did not write them and they land in text every prompt, the Markdown export and the run's task carry; the preview says "Worca hid <n> thing(s) that looked like keys or passwords." Downloaded attachments follow A8 exactly (stored as given, redacted on the way to the model). **Downloads:** only the attachment's own content address on the connection's own site, with the connection's auth; one redirect at most, followed only to `https:`, without the Authorization header when it leaves the site (Jira Cloud's signed media address); the size is checked on the metadata before the download and again while it streams (§5). The bytes go only to `dest`, a fixed name inside a fresh 0700 folder the host made for that one download (D9), never through the browser and never to a path built from the attachment's name; the host trusts nothing at `dest` until it has checked that the path is inside the folder it created, that it is a regular file and not a link, and that its size and content pass A8's validation. The child runs on the host's machine as the same user (installed plugins are trusted code, as for every task-source op); `dest` is a contract, not a sandbox, and the host's checks are what keep a wrong file out of the store. **Names:** A8's display names (last segment, no controls, at most 200 characters), never a path. People's names are the tracker's display names only (D8). |
| D16 | **Errors** (decided in the user's absence; review on return). A thrown `PluginOpError` in search, preview or create is A6's sentence "Worca could not reach Jira: <reason>.", built by A6's own `reachSentence` / `reachReason` in `export.mjs` as they are after A6's merge, with no import phrase table of its own (user decision 2026-10-28, U1): "the API token was refused" for `auth`, "it did not answer within a minute" for `timeout`, "the Jira plugin gave an answer Worca could not read" for `protocol`, the connector's own one-line sentence when it is product copy (Jira's refusal words, "Jira refused the request: …"), and "the Jira plugin stopped unexpectedly" for any message that is not; so Import and Export read alike for the same connection. The server log keeps only the first line of the raw message, at most 200 characters. With it: "Nothing was changed. Fix the connection on the Marketplace page (Installed › Jira), then try again." (the Marketplace part only at the Advanced level), in the pick and in the preview. `{ gone: true }` from `importTicket` is "SHOP-999 was not found in Jira, or this connection cannot see it." (Jira answers 404 for both, and a Data Center may answer 403 for the second; the connector maps both to `gone`). A source that stopped importing: "Jira cannot import any more.". A search with no result: "No ticket in SHOP matches “partial refund”." with "Try other words, or paste the ticket's key or link.". A download's failures are per file and never undo the feature (D10); the reasons in "Worca could not get this file from Jira: <reason>.": "it did not answer within 2 minutes" (`timeout`), "the API token was refused" (`auth`), "this connection may not see it" (403), "it is no longer on SHOP-124" (gone), and (adjusted for the build: fixed phrases, never the plugin's text) "the network connection failed" (`network`), "it asked Worca to slow down" (`rate-limit`), "Jira did not send it" (nothing usable at `dest`), "Worca could not store it" (the host's own steps, D9), else "it answered with an error"; a restart has its own line (D10). The create's own refusals stay A1's and A8's (capacity, target, the form's fields). |
| D17 | **Limits and timeouts** (decided in the user's absence; review on return). `IMPORT_TIMEOUT_MS = 60_000` for `importOptions`, `searchTickets` and `importTicket` (A6's export timeout; `importTicket` may page through comments); `DOWNLOAD_TIMEOUT_MS = 120_000` per `downloadAttachment` (25 MB over a slow link; the op's answer is a few fields, the body is on disk). `MAX_DOWNLOAD_JOBS = 2` across all features, separate from A8's `MAX_READ_JOBS` (2) and A1's `MAX_JOBS` (4); a waiting create does not hold a `MAX_JOBS` slot (A8-D2). `IMPORT_LIMITS`: `comments: 50`, `commentChars: 4000`, `page: 20`. The criteria and description limits are A1's (`LIMITS`), the file limits A8's (`REQ_ATTACH_LIMITS`), checked on the tracker's metadata before the create and again on the downloaded file. `assertCapacity` runs before the create, as today. |
| D18 | **Flag, archive, cost, mock** (decided in the user's absence; review on return). Every route joins `REQUIREMENTS_ROUTES` (the flag-off walk covers them); with the flag off the button and the routes are gone. The import makes no model call and books nothing; the files' reads cost and book as A8 reads. An archived feature keeps its link as A6 does; import only creates new features, so archiving needs nothing new. A plugin disabled or uninstalled later: the button goes; linked features keep their link and chip (A6). Mock mode (`WORCA_MOCK=1`): `MOCK_DEFAULTS` gain the four ops and `capabilities` adds `import: true` (§4); the mock `downloadAttachment` writes a tiny valid body to `dest`, so the browser proof runs offline through the real folder, checks and move. |
| D19 | **Accessibility and phone** (decided in the user's absence; review on return). Both dialogs are `role="dialog"` `aria-modal`, labelled by their titles, focus their title on open, return the focus to **From a ticket…** on close, and make every other child of `<body>` inert (A6-D20). The search box is `type="search"` labelled "Find a ticket", with `aria-describedby` the paste hint; "Searching SHOP…" and the result count are `role="status"`; the results are a `role="radiogroup"` "Tickets", each row one radio whose label is key and title. Each preview checkbox names what it adds ("Use R-po-1: A customer can cancel …", "Use the comment by Ann Example, 21 Oct", "Add packing-slip.png as a feature file"; adjusted for the build: made-up names, §4); a disabled one is `aria-describedby` its reason. The strip's × is "Stop using SHOP-124"; the chip and the criteria tag are links "SHOP-124, opens the ticket in Jira in a new tab" (`target="_blank" rel="noopener"`). At 900 px and narrower both dialogs are full-screen sheets with **← New feature** ("Back to New feature"), sections stacked, every row and button at least 44 px, buttons full width (board 36). |
| D20 | **Levels** (decided in the user's absence; review on return). Everything of A6.1 is **S** (product owners are its users), like A6's export: the button, both dialogs, the strip, the criteria field, the ticket's file chips, the import line in History, the "from SHOP-124" meta and tags. The reach error's Marketplace hint is shown only at **A**, as A6's Connect a tracker… button. |

## 3. Data

Migration **v81**, after A3's v78, `dev`'s v79 (`run_groups.name_source`) and A6's v80 (A6.1 was first written as v80 on A6's
v79 and renumbered when A6 met dev's 79). Two columns, no table:

```sql
-- INCREMENTAL_COLUMNS: req_export_links.origin TEXT NOT NULL DEFAULT 'export'   -- 'export' | 'import' (D11, D13)
--                      req_attachments.fetch_json TEXT                           -- a tracker file to download (D10, D13):
--                        { plugin, sourceId, profile, tracker, key, id, name, bytes }; NULL for an uploaded file
```

`fetch_json` also holds `tracker`, the source's display name (adjusted for the build: a download's failure line and the
restart line name the tracker after a reboot, also for a feature left unlinked). The rung is `if (current < 81) repairSchemaGaps(db, schemaGaps(db));`, so a database stamped 80, or coming from below
A6's v80 (whose table is created by its own rung first), gets the column in the same migration. `test/db-migrate-v81.test.mjs`:
fresh, 80 (A6), 80 (A6.1's early numbering, without dev's `run_groups.name_source`), 79 (dev), 78 (A3 only), 77 (A8) and
upstream's 70–76 all reach 81 with both columns (`origin` `'export'` and
`fetch_json` NULL on existing rows). Whichever of A6.1 and any other branch reaches `dev` second takes the next free number, as A8 and A6 did.

**Store:** `createFeature({ …, criteria })` writes the ticked criteria into the new spec with `criteria_seq` = their
count; `saveExportLink` takes `origin` (default `'export'`; a `new` ticket writes `'export'`, an update keeps the row's);
`toLink` reads it; `linkByTicket({ plugin, sourceId, profile, key })` finds a feature already linked (D12).

**Turns.** A6's `export` turn gains the action `imported`: `{ action: 'imported', tracker, key, url, at, linked: true |
false, linkedTo?: 'FEAT-7', criteria: ['R-po-1', …], comments: <n>, files: ['packing-slip.png', …] }` (`linkedTo`, adjusted
for the build: History's unlinked line names the feature that follows the ticket), written by the product owner with
the feature's first turns. Unlike the other `export` actions it writes one thread line (D14); like them it never hides
the error line or changes what Try again re-runs (A6 §3's filters already cover `export`). A8's `file` turn `added` may
carry `from: { tracker, key }` (D14).

**Files to download.** `req_attachments.status` (TEXT, no check constraint) gains the value `downloading` before A8's
`reading | done | failed | unread-budget`. Such a row has no body yet: `name` is A8's display name of the tracker's file
name, `kind` and `mime` come from its extension, `bytes` from the tracker's size, and `sha256` holds the placeholder
`pending:<id>` (unique, so A8's per-owner hash index holds) until the downloaded body's real hash replaces it; a body
whose hash another file of the feature already has is A8's duplicate (`failed`, D10). `error_json` takes the codes
`DOWNLOAD` (with the reason), `REFUSED` and `INTERRUPTED`. The body is written to A8's store path only after the host's
checks (D9), then the row turns `reading` in the same step that queues A8's read.

**Nothing else is stored:** the preview is not kept (the create reads the ticket again, D10); the comments file and the
attachments are ordinary `req_attachments` rows and bodies (A8 §3).

## 4. The import contract

**New optional ops** (each takes one args object; all optional, discovered by `capabilities().import`; Worca calls them
only server-side):

| Op | Args | Answers |
|---|---|---|
| `capabilities` (existing) | `{ inputs }` | adds `import: true` when the source can import |
| `importOptions` | `{}` | `{ projects: [{ value, label }] }` |
| `searchTickets` | `{ project?, search?, cursor? }` | `{ tickets: [{ key, title, url, type, status, updatedAt }], cursor? }`; no search: the most recently updated first; a pasted key or ticket link finds that ticket in any project |
| `importTicket` | `{ key, criteriaField? }` | `{ key, url, title, description, criteria, comments, commentsTotal, restrictedComments, attachments, meta, fingerprint }` or `{ gone: true }` (below) |
| `downloadAttachment` | `{ key, id, maxBytes, dest }` | the body streamed to `dest`, and `{ name, mime, bytes }`; `{ tooLarge: true, bytes }` or `{ gone: true }` (`{ gone: true, forbidden: true }` for a 403, adjusted for the build: D16 tells "may not see it" apart from "no longer on SHOP-124") with nothing left at `dest` |

`importTicket`'s answer, tool-neutral:

```
{ key: 'SHOP-124', url: 'https://acme.atlassian.net/browse/SHOP-124', title: 'Partial cancel for multi-item orders',
  description: '<Markdown>',                                    // the tracker's own text, converted; never HTML
  criteria: { field: { id: 'customfield_10070', name: 'Acceptance Criteria' }, items: ['…', …] } | null,   // only from a field
  comments: [{ id: '10231', author: 'Ann Example', authorKind: 'person' | 'app', created: '<ISO>', body: '<Markdown>' }],   // newest 50, oldest first
  commentsTotal: 7, restrictedComments: 1,                     // restricted ones are never in `comments`
  attachments: [{ id: '10044', name: 'packing-slip.png', mime: 'image/png', bytes: 860160, created: '<ISO>' }],
  meta: { project: 'SHOP', projectName: 'Shop web', type: { id: '10001', name: 'Story' }, status: 'In progress',
          priority: { id: '3', name: 'Medium' } | null },
  fingerprint: '<the stored description's fingerprint, as ticketState>' }
```

`criteriaField` is the export setup's criteria field when that setup is on the same connection (D7). A section of the
description is found by the host, not the plugin (§8 `splitCriteria`), so every tracker gets it. Auth, network,
rate-limit and timeout failures are thrown as today (`PluginOpError`). `downloadAttachment` checks that the attachment
belongs to `key`, refuses before downloading when the tracker's size is over `maxBytes`, and stops a download that grows
past it (`tooLarge`). **`dest`** is an absolute path the host made: a fixed file name inside a fresh private folder of
its own (D9). The connector runs in a child process the host spawned on the same machine, so it can write there; it
creates the file exclusively, writes only the attachment's body, deletes what it wrote on any failure or refusal, and
never writes anywhere else. The host checks the path is inside the folder it created before it reads anything there.

**The comments file** (`commentsMarkdown`, §8), one text file, redacted, in the ticket's order (people here and everywhere in
code, tests, fixtures and screenshots are "Ann Example", "Bo Example" and "Cy Example", adjusted for the build: board 34's
real-looking names are not used):

```
# Comments on SHOP-124

**Ann Example** · 21 Oct 2026
Warehouse confirms items are picked per parcel, not per item. A parcel with two items is picked up as one.

**Bo Example** · 22 Oct 2026
…
```

**Mock answers** (D18): `capabilities` `{ writeBack: true, export: true, import: true }`; `importOptions` SHOP — Shop web
and OPS — Operations; `searchTickets` filters SHOP-124 "Partial cancel for multi-item orders" (Story, In progress),
SHOP-123 "Cancel an order before it ships" (Story, To do), SHOP-131 "Cancel button hidden on the mobile order page"
(Bug, To do) and SHOP-98 "Refund to store credit after a cancel" (Story, Done) by key or words; `importTicket` answers
board 34's ticket for any key (`{ gone: true }` for `SHOP-999`), with the criteria in a description section, six
comments (by Ann, Bo and Cy Example, one by "Jira Automation", `authorKind: 'app'`, and one holding a fake `ghp_` token), one restricted comment, and
five attachments (`packing-slip.png`, `partial-cancel-flow.pdf`, `support-macro.txt`, `refund-matrix.xlsx`,
`pick-route-scan.pdf` at 31 MB); `downloadAttachment` writes a tiny valid PNG, PDF or text to `dest`. `setMockSourceResponses`
overrides them in tests (gone, auth, timeout, too large, a lying size, a file left at `dest` as a link, an answer whose
`bytes` differ from the file).

## 5. The Jira connector

`plugins/jira-source/connector/index.mjs` gains the four ops; `capabilities` answers `{ writeBack, incrementalSync: false,
export: true, import: true }`. REST v2 throughout, as A6-D16, so Cloud and Data Center share one path; `deployment()`
tells them apart where they differ.

- **importOptions:** `projectList()` (A6), as `{ value: key, label: '<key> — <name>' }`.
- **searchTickets:** `listTasks`' code with Worca's own JQL: `pastedKey(search)` first (`GET /rest/api/2/issue/{key}`, 404
  is no result); else `buildJql({ project, jql: '', search })` (`text ~ "…"`, `ORDER BY updated DESC`) through Cloud's
  `/rest/api/2/search/jql` (`nextPageToken`) or Data Center's `/rest/api/2/search` (`startAt`), `maxResults=20`, fields
  `summary,status,issuetype,updated`. Never the user's saved JQL filter (the import searches the whole project).
- **importTicket:** `GET /rest/api/2/issue/{key}?fields=summary,description,issuetype,priority,status,project,attachment,comment[,<criteriaField>]&expand=renderedFields,names`.
  404 (and 403 on a Data Center) is `{ gone: true }`. Comments beyond the issue's embedded page (`comment.total` >
  `comments.length`) are read from `GET /rest/api/2/issue/{key}/comment?orderBy=-created&maxResults=50&expand=renderedBody`.
  A comment with `visibility` (a group or role) is counted in `restrictedComments` and dropped. `authorKind` is `'app'`
  when `author.accountType` is `app` (Cloud) or the author is not `active` and has no email-shaped name (Data Center's
  automation users), else `'person'`; `author` is `author.displayName` only.
- **Description formats → Markdown.** Atlassian has three: wiki markup (the raw v2 `description` on both Cloud, which
  converts its ADF to wiki for v2, and Data Center), rendered HTML (`renderedFields`, on both) and ADF (REST v3 JSON, Cloud
  only). The connector uses the rendered HTML through `htmlToMarkdown` (as `getTask` does), falling back to the raw wiki
  text as plain text when a site renders nothing (through `plainWiki`: a mention `[~accountid:…]` or `[~name]` becomes
  "someone", since the wiki text holds no display name, and `[text|url]` becomes "text (url)" for http(s) only; the same for a
  comment Jira did not render, so no account id leaves the connector on either path); ADF and v3 are not used (A6-D16). `htmlToMarkdown` gains three small
  rules: `<img alt>` becomes "(image: <alt>)" so the description says where a picture was (the file itself is in
  `attachments`); table rows become "| a | b |" lines; links to user profiles (`/secure/ViewProfile`, `/jira/people/`,
  `/people/`) and mention spans become the plain display name, so no account id leaves the connector.
- **Criteria from a field:** `criteriaField`, else the multi-line (`…:textarea`) custom field named "Acceptance Criteria"
  (case-insensitive) whose value is not empty, found through `GET /rest/api/2/field` (adjusted for the build: the only way to
  know its id while the issue read names its fields explicitly); its rendered HTML → Markdown → one item per list item (or per line). Nothing else is
  searched in the connector.
- **fingerprint:** `fingerprintOf(fields.description)`, the function `ticketState` uses, so A6's edited check (D11) holds.
- **downloadAttachment:** `GET /rest/api/2/issue/{key}?fields=attachment`; the attachment with `id` must be there, else
  `{ gone: true }`; its `size` over `maxBytes` is `{ tooLarge: true, bytes: size }` before any download. Then
  `jiraDownload(jira, content, { dest, maxBytes, timeoutMs })` (new, `jira-api.mjs`): the `content` URL must have the
  profile's `baseUrl` origin; the request carries `authHeader` (Cloud: Basic email:token; Data Center: Bearer PAT) and
  `redirect: 'manual'`. A 3xx is followed once: to the same origin with the header, to another origin only over `https:`
  and without it (Cloud answers 303 to a signed `api.media.atlassian.com` address; Data Center serves
  `/secure/attachment/{id}/{name}` itself). The response body is piped (`stream.pipeline`) into
  `fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 })` through a counter that aborts past `maxBytes`; on that abort
  or any failure the partial file is unlinked before the op answers (`tooLarge`, or the thrown error). 401 throws `auth`,
  403 is `{ gone: true, forbidden: true }` and 404 `{ gone: true }` ("this connection may not see it" / "it is no longer on
  SHOP-124", D16; `forbidden` adjusted for the build). The answer is
  `{ name: filename, mime: mimeType, bytes: <the bytes written> }`; no body in the frame.
- **Refusals and words:** each op goes through A6's `exportOp` wrapper (`plainFailure`), so a failure says Jira's own words,
  never an HTTP status or REST path.

`plugins/jira-source/README.md` gains an **Import** section; `.claude/skills/creating-worca-cc-plugins/SKILL.md`'s contract
table gains the four rows and a paragraph like A6's (what a ticket answer holds; names only for people; restricted
comments left out; downloads only from the site, size checked first).

## 6. API

All behind `requireFlag('requirements')`, in `REQUIREMENTS_ROUTES` before the `/:seq` routes. Errors as A1 §5; a tracker
failure answers 502 `{ error, kind }` with D16's sentence, a gone ticket 404 `{ error, gone: true }`.

| Route | Does |
|---|---|
| `GET /api/requirements/import/:scopeType/:scopeKey` | `{ sources: [{ plugin, sourceId, name, profiles: [{ id, label }] }], defaultConnection, defaultProject }` (no tracker call but the cached probes; D3) |
| `POST /api/requirements/import/:scopeType/:scopeKey/options` `{ plugin, sourceId, profile }` | `importOptions` (the projects) |
| `POST /api/requirements/import/:scopeType/:scopeKey/search` `{ plugin, sourceId, profile, project?, search?, cursor? }` | `searchTickets`, each ticket with `linkedTo: { id, title } \| null` (D4, D12) |
| `POST /api/requirements/import/:scopeType/:scopeKey/preview` `{ plugin, sourceId, profile, key, formFiles? }` (`formFiles: { count, bytes }`, the files already on the form, adjusted for the build: D9's default ticks count them) | the processed ticket (D5–D9): `{ key, url, tracker, meta, title, description, descriptionFile?, redacted, criteria: { from: 'field' \| 'section' \| null, name?, items }, comments: [{ id, author, authorKind, created, body, picked }], commentsTotal, restrictedComments, attachments: [{ id, name, kind, bytes, picked, refused? }], linkedTo }` |
| `POST /api/requirements` | also takes `fromTicket: { plugin, sourceId, profile, key, criteria: [text], comments: [id], attachments: [id], descriptionFile: bool }` (D10); answers 201 with the feature view as soon as the feature, its link and its `downloading` file rows exist (no download is awaited), plus A8's `filesNotStored` (could not store it) and `notOnTicket: { key, comments: [id], attachments: [{ id, reason }] }` for what the second read no longer found (adjusted for the build, D10) |
| `POST /api/requirements/:seq/attachments/:attId/read-again` | A8's route; for a `failed` file with `fetch_json` and no body it queues the download again (D10's Try again), then the read |
| `DELETE /api/requirements/:seq/attachments/:attId` | A8's route; on a `downloading` file it deletes the row and discards the download when it ends |
| `GET /api/requirements/:seq` | `feature.export.link` gains `origin` and, for `'import'`, `importedOn` ("27 Oct"); `feature.export.history` shows `imported` lines (§7); a file in the view may have `status: 'downloading'` and carries `from: { tracker, key } \| null`; the working line counts files downloading and reading |

The source in every body must be one of `GET …/import`'s `sources` (else 400 "Choose a connection from the list.", as A6).
`cursor` is the plugin's, passed through. None of these routes needs A8's raised JSON window except `POST /api/requirements`,
which already has it.

## 7. Screens (boards 32–36)

Built with upstream's classes as A6 and A8 are (`.card`, `.btn` / `.btn-mini` / `.btn-primary`, `.badge`, `.chip`,
`.select-wrap`, `.field`, the modal overlay of `openModal`); CSS as `req-import-*` rules in the Requirements block of
`ui/public/style.css`, tokens only; the shared icons (search, file, image, x, info, alert); no green fills.

- **New feature** (board 32): **From a ticket…** at the right of the Describe it label (D1). After **Use this ticket** the
  form starts with the ticket strip: "Starting from" **SHOP-124 ↗** "· Story · In progress", **Change ticket…** and ×
  ("Stop using SHOP-124", which empties nothing the product owner typed but takes the criteria and the ticket's files
  away), and "acme.atlassian.net (Cloud) · The new feature stays linked to SHOP-124: Export updates it, and a run can
  report back to it." Describe it gets the hint "From SHOP-124's description. Change it as you like: the interview starts
  from what is here." A new field **Acceptance criteria** "from SHOP-124" lists the ticked criteria with their future ids
  and "They start the spec as your criteria. Edit or remove them on the feature page."; the Files field shows the ticket's
  files as chips with the "SHOP-124" chip and D9's hint. The cost line is A8's. Start the interview answers at once and
  opens the feature (D10); nothing on New feature waits for a download.
- **Pick** (board 33): **Start from a ticket**, "Pick the ticket this feature starts from. Worca reads it through your Jira
  connection and changes nothing in Jira."; **Connection** (only with several), **Jira project**, **Find a ticket** with
  "Search by key or words" and "Paste a ticket's key or link to find it in any project."; the count line, the results,
  **Show more**; **Cancel**, **Continue**.
- **Preview** (board 34): **Start from SHOP-124**, "This is what the new feature takes from SHOP-124. Untick what it should
  not start with. Nothing changes in Jira."; left: **Title**, **Description** (focusable, "Description preview"),
  "Without its Acceptance criteria section, which becomes the criteria below.", the redaction line, **Acceptance criteria**
  with where they were found ("found under “Acceptance criteria” in the description" / "found in the Jira field
  “Acceptance Criteria”") and "Ticked criteria start the spec as R-po-1 to R-po-3, kept as your own edits and marked “from SHOP-124”. Unticked ones
  are left out; they stay in Jira." (hidden while no criterion is ticked, with no other wording: the user, copy Q1); a ticked
  criterion's checkbox is "Use R-po-1: <text>", an unticked one's "Use this criterion: <text>" (the user, copy Q2); right: **Comments · 5 of 6** with "Context for the interview, not spec text. Worca
  puts the picked ones in one file, SHOP-124 comments.md, and reads it like your other files. Authors are shown by name
  only." and the restricted line; **Attachments · 3 of 5** with "Picked files become feature files. Worca gets them from
  Jira when you start the interview and reads each once, like a file you add." and the refused rows; footer "Nothing is
  sent to Jira.", **Back**, **Use this ticket**. The linked warning of D12 above the columns when it applies.
- **The imported feature** (board 35): FEAT-8 just after Start, status **Looking**, with the chip **SHOP-124 ↗**; the working
  line **Getting 3 files from SHOP-124…** and "Worca gets the files from Jira and reads them first, then shows round 1.";
  the Files card with "from SHOP-124" in each meta line and each file in its own state: SHOP-124 comments.md and
  packing-slip.png **Reading…**, partial-cancel-flow.pdf and support-macro.txt **Downloading…** ("Worca is getting it from
  SHOP-124. Then it reads it (about $0.10)."); the spec card's criteria R-po-1 to R-po-3 with the "SHOP-124" tag; the
  **History** card's "Imported SHOP-124 from Jira · 27 Oct, 09:12" and the name; then, once round 1 came, its question card
  showing "From SHOP-124 comments.md:"; and, opened from Export ▾, **Export FEAT-8 to Jira** with D11's copy.
- **States and phone** (board 36): D16's lines in place (search failure, no result, not found, linked elsewhere, no
  criteria, the caps, the long description, Start the interview unable to read the ticket) and, per file on the Files card,
  a download that failed (with **Try again**), one interrupted by a restart, and one A8 refused after it arrived (no Try
  again); and the preview as a 390 px sheet (D19). A search failure offers **Try again**. Start the interview's failure to read the ticket keeps the form and
  adds "Nothing was created, and the form keeps what you entered. Try again, or stop using SHOP-124 to start without
  it.". On the phone the comments show their author and date only, three at first, then **Show all 6 comments**.

**Not on the boards** (smallest behaviour, said here rather than invented in code):
- Picker loading: "Searching SHOP…" (blue badge, `role="status"`); with All projects: "Searching all projects…", "<n> tickets
  match “…”.", "Recently updated".
- A preview whose ticket has no comments: **Comments · none**; no attachments: **Attachments · none**.
- History lines: "Started from SHOP-123 in Jira, not linked: FEAT-7 is." (D12).
- The description clipped: D6's line under the description preview and in the form.
- **Change ticket…** reopens the pick with the current ticket selected; picking another replaces the strip, the criteria
  and the ticket's file chips, and asks first when the product owner edited the title or description since: "Replace the
  title and description with SHOP-131's?" **Replace** / **Keep mine** (the criteria and files are replaced either way).
- Leaving New feature drops the import (nothing was stored).
- Build's "Files for the run" line for a tracker file whose download failed or was refused (the user, copy Q3; A8's "<name>
  cannot go with the run: …"): "<name> cannot go with the run: <the download's reason>.", e.g. "partial-cancel-flow.pdf cannot
  go with the run: it did not answer within 2 minutes." and "scan-notes.pdf cannot go with the run: it is already attached as
  call-notes.pdf."; a file a restart cut off has no reason of its own and keeps the server's sentence: "restart-cut.png cannot
  go with the run: Worca restarted before it got this file from Jira."

## 8. Code changes

- `src/core/requirements/ticket-import.mjs` (new, pure): `IMPORT_LIMITS`, `splitCriteria(markdown)` → `{ description,
  items, heading }`, `clipDescription(text)` → `{ text, clipped }`, `redactCounted(text)` → `{ text, hidden }`,
  `commentsMarkdown(key, comments)`, `commentsFileName(key)`, `descriptionFileName(key)`, `importReason(name, cls, bytes)`
  (D9's "Not offered:" lines from A8's `officeRefusal` tails), `importThreadLine(payload)`.
- `src/core/requirements/import.mjs` (new): `IMPORT_TIMEOUT_MS`, `importSources(d)` (A6's probe, reading `import`),
  `importDefaults(scope, sources)`, `importOptions`, `searchTickets` (with `linkedTo`), `previewImport`, `prepareImport(body,
  d)` (the second read, the generated files and the rows to download, with the lines for what is gone; no download; D10),
  each through `callSource` with the connection's profile.
- `src/core/requirements/attachment-fetch.mjs` (new): `DOWNLOAD_TIMEOUT_MS`, `MAX_DOWNLOAD_JOBS`, the download queue
  (`queueDownloads(owner, ids)`, `isDownloading(id)`), `makeFetchFolder()` (`att-get-<8 hex>`, 0700), `checkFetched(folder,
  dest, answer)` (inside the folder, `lstat` regular and no link, size; read once through a descriptor), the write of the
  checked bytes into A8's store (adjusted for the build, D9), the `failed` codes, and
  `sweepFetchFolders` (boot, with A8's sweep). `attachment-job.mjs`: `insertDownloadRow` (the `downloading` row, the
  `pending:<id>` hash), `readsSettled` also waits for downloads, `readAgain` re-downloads a file with no body,
  `removeAttachment` on a downloading file, `recoverAttachmentReads` turns `downloading` into `INTERRUPTED`,
  `renderAttachmentsForPrompt`'s "being downloaded from <key>; known by name only." (`attachments.mjs`); `ready.mjs`: a file
  still downloading counts as one being read (D10).
- `src/core/requirements/export.mjs`: the probe keeps the whole capabilities answer (`export` and `import` from one call);
  `planExport` skips `setupRules` for `origin = 'import'`; `linkDates` and `exportView` carry `origin` / `importedOn`; the
  history maps `imported`. `ticket.mjs`: `renderExportComment` and `changeSummary` take `since: 'import' | 'export'`;
  `buildTicket` drops a criterion's source equal to the ticket's own key.
- `store.mjs`: `createFeature`'s `criteria`, `saveExportLink`'s `origin`, `toLink`, `linkByTicket`, the attachment row's
  `fetchJson`. `db.mjs`: v81 (both columns).
- `routes.mjs`: §6; `POST /api/requirements` with `fromTicket` (capacity first, then `prepareImport`, then the create, the
  generated files, the link, the turn and the `downloading` rows in one transaction, then `queueDownloads` and the
  orientation, then 201); `round.mjs` `threadText`: the `imported` line (D14); `attachment-job.mjs`
  `addAttachments` takes `from` for the `file` turn.
- `src/core/plugin-shim.mjs`: `MOCK_DEFAULTS` (§4). `src/core/plugin-api.mjs`: the comment line.
- `plugins/jira-source/connector/index.mjs`, `jira-api.mjs` (`jiraDownload`), `markup.mjs` (the three rules of §5),
  `README.md`; the plugin skill's contract table.
- `ui/public/requirements-view.mjs`: the button, the pick and preview dialogs, the strip, the criteria field, the ticket's
  file chips and the caps; the Files card's **Downloading…** state, its failure lines and Try again, and the working line's
  "Getting <n> files from <key>…"; the source tag linking a ticket key; the Files card's "from <key>"; the History
  lines; the export entry going straight to the again dialog for a linked feature; D11's copy. `ui/public/style.css`: §7.
- `tools/verify-requirements-cdp.mjs`; docs (§9).

## 9. Testing

- **Pure** (`test/requirements-ticket-import.test.mjs`): `splitCriteria` on headings, bold lines, "AC:", numbered and
  bulleted lists, lines up to a blank line, no section, two sections (the first wins), 30-item and 500-character caps;
  `clipDescription` at a paragraph; `redactCounted` with a `ghp_` token and a PEM block; `commentsMarkdown` byte for byte;
  the thread line's three forms; `importReason` for Office, other types and size.
- **Import service** (`test/requirements-import.test.mjs`, mock shim with `setMockSourceResponses`): sources with and
  without `import`; defaults from the export setup and from `defaultConnection`; search with `linkedTo`; preview's ticks
  (people on, apps off, restricted absent), caps counting the form's own files; the create: second read, criteria R-po-1…
  with the source, the comments file; the 201 answered before any download ends (a download held open by the test);
  the ticket gone and `auth` (nothing created); the link row with `origin = 'import'`, the fingerprint and the spec copy;
  D12's unlinked create; the turn.
- **Downloads** (`test/requirements-attachment-fetch.test.mjs`, mock shim): rows `downloading` with `fetch_json` and the
  `pending:` hash; at most two at a time across features, the rest waiting; a finished file moved into the store under
  its id and read; round 1 waiting for downloads and reads up to `ROUND1_WAIT_MS`, then listing a file still downloading
  by name only; per-file failures (timeout, `auth`, gone, 403) marking only that file, the feature usable, Try again
  downloading again; a refused type, a sniff mismatch, a duplicate and a size that lied (`tooLarge`, or a file bigger
  than the answered `bytes`) as `REFUSED`; the host's checks refusing a `dest` replaced by a link, a missing file and a
  path outside the folder; the folder 0700 (POSIX) and removed on every path; removing a downloading file; a restart
  turning `downloading` into `INTERRUPTED`; the `att-get-*` sweep.
- **Export with an imported link** (`test/requirements-export.test.mjs`): the again dialog's data without a setup; Update
  keeps the ticket's type and priority with a setup on the same connection; the comment since the import; edited after
  the import; Create a new ticket turns the origin to `'export'`; Report back defaults on.
- **Prompts:** an imported feature's round 1 prompt carries the thread line and the comments file in `<attachments>`; a
  feature that was not imported keeps its stored expectation byte for byte.
- **Store / migration:** `test/db-migrate-v81.test.mjs` (§3).
- **Jira** (`test/jira-source-connector.test.mjs`, its fake `fetch`): each op on Cloud and Data Center; the comment page
  beyond the embedded ones; restricted and app comments; profile links and mentions to names; `<img>` and tables;
  criteria from a named field and from `criteriaField`; 404 and Data Center 403 as gone. **Downloads against a fake Jira
  server** (`node:http` on two loopback ports, one the site and one a "media" host; the test passes
  `deps.allowHttpRedirect` because the fake has no TLS): the header on the same origin, none after a cross-origin
  redirect, a second redirect refused, a `content` URL on another origin refused, the metadata size check before any
  request, the stream cap deleting the partial file at `dest`, an existing file at `dest` refused (`wx`), the answer's
  `bytes` equal to the file's size, 401, 403, 404 (nothing left at `dest`).
- **Shim** (`test/plugin-shim.test.mjs`): the four mock answers; `capabilities`' mock keeps write-back and export.
- **API:** the flag-off walk covers every new route; no route answers a config value; `POST /api/sources/call` still
  refuses the four ops.
- **UI (jsdom):** boards 32–36: the button only with an importing source; the pick (debounce, paste hint, Show more,
  Linked to FEAT-7); the preview's checkboxes, disabled rows and caps; Use this ticket filling the form; Change ticket…
  and its Replace / Keep mine; the `aria-*` of D19.
- **Real browser:** `npm run verify:requirements` (mock) gains: New feature → From a ticket… → "cancel" → SHOP-124 →
  untick the automation comment → Use this ticket → Start the interview → FEAT-8 with the chip, R-po-1 to R-po-3 tagged
  SHOP-124 at once, a file Downloading… and the working line "Getting … from SHOP-124…", then every file read, then round 1
  (adjusted for the build: the proof checks the states, not "two Downloading… and two Reading…", which depend on timing); Export ▾ › Export to Jira… opens Export FEAT-8 to Jira; light, dark and
  390 px.
- **Real Jira:** only with the user's OK, by hand, on a test project they name (no call to a real Jira in this branch's
  tests).
- **Linux:** the full `npm test` and `npm run smoke`; failures compared with `dev` as before (the Windows baseline).
- **Docs:** `docs/requirements.md` (a **Start from a ticket** section), `docs/storage.md` (the two columns and the `att-get-*` folders),
  `docs/ui-levels.md` (one row, **S**, and the Marketplace hint **A**), the changelog's Requirements entry.

## 10. Where A6.1 meets A6, A8 and A3

- **A6.** The link, the again dialog, the edited check, Forget the link and Report back are A6's, used as they are with
  D11's copy and one rule (an imported ticket keeps its issue type and priority). Import never writes to the tracker;
  only a later Export or Report back does. A6's duplicate guard is not involved (no create).
- **A8.** Comments and attachments become A8 files, read, budgeted, edited, asked about, replaced and sent with a run
  exactly as uploaded files; A8's limits, types, Office refusal, names and duplicate rule hold. The additions are the
  `downloading` state before `reading` (its own queue of two, its folder and checks, Try again, the restart line), the
  row's `fetch_json`, the file turn's `from`, and round 1's wait covering downloads.
- **A3.** Feature chat sees what any round sees: the description, the R-po criteria, the comments file's summary. It
  neither imports nor calls the tracker.

## 11. Out of scope

- Linking an existing feature to a ticket, or importing into one.
- Pulling later changes from the ticket into the spec (only A6's fingerprint is read).
- Sub-tasks, epics, linked issues and the ticket's other fields (story points, components, sprints).
- Comments' attachments and images inside comments (they are the ticket's attachments, offered as such).
- Converting Office files (refused, A8-D7) and video or audio.
- Importing several tickets into one feature.
- GitHub Issues and Azure Boards: their plugins add the same ops later.
- Jira's ADF (REST v3).
