# Requirements A6: export a feature to a tracker (Jira first)

Date: 2026-10-26. Base: `dev` (with A8 merged as #975 and A3 as #989; schema v78). Branch: `feat/req-a6-jira-export`.
Part A6 of the requirements track. A1 is `plans/requirements-design.md` (A1-D<n>), A2 is `plans/requirements-a2-design.md`
(A2-D<n>), A1.1 is `plans/requirements-a11-design.md` (A1.1-D<n>), A7 is `plans/requirements-a7-design.md` (A7-D<n>), A8
is `plans/requirements-a8-design.md` (A8-D<n>), A3 is `plans/requirements-a3-design.md` (A3-D<n>); all six are on `dev`.
The screens were agreed as a mock first (Claude Design canvas "Requirements — design rounds 1 to 5", boards 26–31);
their copy is approved product copy and is used verbatim here. This document is the build contract for them. Where a
decision differs from the boards or fills a gap they leave, it says what the code forces and, where there is one, the
alternative.

## 1. Goal

**A product owner can send a feature's spec to the team's tracker as a ticket, and keep that ticket in step.** The
Requirements code knows only "a task source that can export"; each tracker plugin turns a tool-neutral ticket into its
own format. Jira is the first; GitHub Issues and Azure Boards add the same steps later in their own plugins.

**Success:**
1. With a tracker connected on the Marketplace page, Export ▾ offers **Export to Jira…**; the first time in a project or
   workspace it opens **Set up export for <name>**, then the preview; later it goes straight to the preview.
2. The preview shows the ticket as the tracker will show it (fields and description); only what it shows is sent.
3. A feature that is not Ready can be exported only with a reason, which is recorded on the feature and put at the top
   of the description.
4. After an export the header shows the ticket chip (**SHOP-123 ↗**) and the History card records it.
5. **Export again** lets the product owner update the ticket, add a comment (shown before it is sent) or create a new
   ticket, and warns before replacing a description that was edited in the tracker.
6. A run started from an exported feature reports back to the ticket (result and pull request link, and a status move
   when the connection names one), switchable per start.
7. No model call, no cost. With the `requirements` flag off nothing of this shows or answers; without a connected
   tracker the menu says where to connect one.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **One Export entry; Start unchanged.** The header's Export ▾ menu (`menu('export', …)` in `header(f)`) keeps **Save to specs/**, **Copy Markdown**, **Download .md**, then a separator (`menu-sep`) and either **Export to <tracker>…** and **Export setup…**, or, when no tracker can export, **Connect a tracker…**. `<tracker>` is the task source's `displayName` ("Jira"): the setup's source once a setup exists; before that the scope's bound source (`source_bindings`) when it can export, else the only source that can; with several and none bound, "Export to a tracker…". A source that cannot export (D3) never appears. Export works on its own (the team builds in the tracker) and next to Start (the ticket tracks the run, D15). |
| D2 | **Connections live on the Marketplace page; the export setup only names one.** A connection is a task-source profile (`plugin-config.mjs` `listProfiles`; Installed › Jira, Advanced level, docs/ui-levels.md). **Connect a tracker…** opens a short dialog: "Trackers are connected on the Marketplace page (Advanced mode), or by whoever set up Worca." The setup is saved **per project or workspace** (`scopeType`, `scopeKey` of the feature): connection (plugin, source id, profile), tracker project, issue type (default "Story" when the tracker lists it), labels (default `worca`), priority (optional, default none), and where the criteria go (a section of the description, or a field). Its connection defaults to the scope's profile from `resolveProfile` (`source-bindings.mjs`) when that resolves, else the first profile. It never stores or sees a token (D18). |
| D3 | **The export steps are optional connector ops in the existing contract, in plugin API 5**. `callSource({ plugin, sourceId, op, args, profile, timeoutMs })` dispatches any op name; the shim child passes the single `args` object to every op but `getTask` and `reportResult`, and answers kind `unimplemented` for an op the connector lacks. Adding optional ops is additive, so `WORCA_PLUGIN_API` stays 5 and jira-source keeps `"worca-cc-api": ">=5 <6"`; `plugin-api.mjs`'s comment gains the line. **Discovery** goes through the existing optional `capabilities()` op, which gains `export: true` (a missing op or `export` not `true` means no export); a "yes" (or a missing op) is cached per plugin, source id and installed manifest version for the process's life, and probed with the source's first profile (a multi-profile source refuses a call without one). A **failed** probe is remembered for about 60 seconds per plugin, source id and profile, and meanwhile the Export menu treats export as unavailable for that connection; then it is asked again. All sources are probed at once, each within 10 seconds, so a slow or broken connector delays a feature page at most once a minute and by at most 10 seconds. Alternative: a manifest key on the task source, which needs `KNOWN_SOURCE` and `normalizeManifest` changes and warns on older hosts. |
| D4 | **The neutral ticket** (`buildTicket`, new, `src/core/requirements/ticket.mjs`): `{ project, issueType, title, description, labels, priority, criteria, marker }` (§4). `title` is the feature's title; `description` is Markdown built by `renderTicketMarkdown` (new, `markdown.mjs`), which reuses the Markdown export's helpers (`bullets`, `numbered`, `from`) in board 27's order: Goal (text, then "Measure: <measure>"), Actors (joined with " · "), Main flow, Business rules, Edge cases, Out of scope, Acceptance criteria ("R-po-1 <text>", only when they go to the description), Confirmed assumptions ("A-1 <text>"), Files the spec mentions (names only: feature files and brief documents with a non-empty A8 `mentions`), then the footer "From Worca FEAT-7 · exported 26 Oct 2026". Criteria and assumptions keep A8's "(from <name>)". An empty section is left out (the export's "_None yet._" is not sent). Open questions, open and rejected assumptions and "Description, as first given" are not in the ticket, as approved; the Export anyway reason says why the feature is not Ready. |
| D5 | **Ready, or Export anyway with a reason.** Export reads A2's `readiness` (with A8's files). Ready: the preview opens. Not Ready: the dialog **Export FEAT-7 before it’s Ready?** lists the failing checks and asks "Why export before it is Ready?" (1–`REASON_MAX` = 500 characters, as Start anyway); **Export anyway** opens the preview, whose description starts with "Exported before Ready: <reason>". The reason is recorded on the feature in the export's `export` turn with the product owner's name (D17). Unlike Start, every failing check can be overridden: the tracker needs no project folder. |
| D6 | **Only what the preview shows is sent.** `POST …/export/preview` builds the ticket (or the comment) and answers it with `previewHash`, the sha256 of its canonical JSON; `POST …/export` rebuilds it from the current spec and the same choices and refuses 409 "The spec changed since the preview. Look at the preview again." when the hash differs (a round or an edit landed meanwhile). Labels are normalised in Worca, not in the plugin, so the preview shows the sent value: trimmed, each whitespace run turned into "-", at most 255 characters, duplicates dropped, at most 10; `worca-FEAT-<n>` is always added and cannot be removed ("worca-FEAT-7 stays: Worca uses this label to find the ticket again."). Issue type, labels and priority can be changed for one export in the preview; the setup keeps its values. The description is rendered as plain text in structure (headings, lists, paragraphs as text nodes), never as HTML. |
| D7 | **Export again: the product owner chooses each time.** A feature with a link opens **Export FEAT-7 again** with three choices: **Update SHOP-123** (default; rewrites summary, description, issue type, priority and the criteria field), **Add a comment to SHOP-123** (what changed since the last export; the description stays) and **Create a new ticket** (e.g. after a split). Then **Continue** opens the preview of the result (board 28: the comment itself for a comment). Update and comment go through the link's own connection, pinned on the link like `source_ref`; a new ticket uses the current setup. **Labels on update are added, never removed**, so labels the team set in the tracker stay (replacing them would drop, for example, sprint labels). **A new ticket moves the link** to the new ticket (the chip and Report back follow it; the old key stays in the History card). Add a comment is disabled when nothing changed since the last export. |
| D8 | **Exports are named by their date, not a spec version.** Spec versions belong to Start (`req_starts.version`). The footer says "exported <d Mon yyyy>", the again dialog "SHOP-123 was made on 26 Oct." and "What changed since the last export (26 Oct)". Every export (create, update, comment, new) stores the spec it sent (`spec_json`) and its time; the changes are `changedSince(sentSpec, currentSpec)` (`ready.mjs`), reduced to what a ticket shows (D4): the `openQuestions` section is dropped, and an assumption counts as added or removed when it enters or leaves `confirmed`. The dialog summarises per section ("Business rules: 1 line changed", "Edge cases: 1 line added"; a section's changed lines are its removed and added lines paired in order) and per criterion ("Added R-po-6 <text>"); the comment spells them out (§4). Dates use the server's local date with English month abbreviations, never the browser locale, so the footer is the same for every viewer. |
| D9 | **"Edited in Jira" is a fingerprint the plugin computes.** jira-source writes descriptions as REST v2 wiki markup (D16), and Jira Cloud stores them as ADF, so what reads back is not byte-equal to what was sent. So after every create and update the connector reads the description back once and returns `fingerprint`, the sha256 of that stored text normalised (CRLF to LF, trailing spaces per line removed, trimmed); `ticketState` returns the same fingerprint of the current text. Worca compares the two opaque strings and never parses a tracker format. A comment does not change the stored fingerprint. A differing fingerprint on **Update** shows the alert of board 28 with **Update anyway** (`force: true`), **Add a comment instead** and **Cancel**. |
| D10 | **Duplicate guard: a marker per attempt, then the label.** Several Worca installs may share a tracker project and number their features alike, so the label `worca-FEAT-7` and the footer alone cannot tell this install's ticket. Before a create (or new ticket) call, the link row records `pending_marker` (`rexp_<12 hex>`) and the ticket carries it; jira-source stores it as the issue property `worca.export` (`{ marker }`, in the create request's `properties`; invisible in the ticket). If Jira made the ticket but Worca stopped before saving the key, the next export of that feature first calls `findTicket({ project, label, marker })` through the same connection: a candidate is linked only when it has the label, its property's marker equals the pending one, and its description's last line starts with "From Worca FEAT-7 ·". A match is linked (an `export` turn `linked`) and the chosen export goes on as Export again; no match clears the pending marker and creates. No pending marker: no search. The marker is needed because Worca has no install id to put in the approved footer. Accepted gaps, all rare: a New ticket whose answer was lost, followed by a setup moved to another connection, is looked for through the new connection (no match there: the marker goes and a ticket is made); an update after a re-link from another site (a link with no fields last sent) while the setup is on another connection may send that site's issue type or priority id; a comment carries no marker, so a comment whose answer was lost and is sent again can appear twice. |
| D11 | **Errors.** A failed call records nothing and keeps the preview open. A thrown `PluginOpError` (kinds `auth`, `network`, `rate-limit`, `timeout`, `protocol`, `plugin`) shows "Worca could not reach Jira: <reason>." with **Cancel** and **Try again**; `<reason>` is "the API token was refused" for `auth`, "it did not answer within a minute" for `timeout`, "the Jira plugin gave an answer Worca could not read" for `protocol`, else the plugin's message without a final period when it is a plain sentence (one line, no stack, path or the shim's own words), otherwise "the Jira plugin stopped unexpectedly"; the server log gets the kind and the first line of the raw message (at most 200 characters). The shim carries only `{ kind, message }`, so a tracker that refuses a field and a ticket that is gone are **results**, not errors: `{ refused: { field, message } }` and `{ gone: true }`. A refusal shows the plugin's own sentence (jira-source: "Jira needs a value for “Team” in SHOP." for a required field, else "Jira refused “<field>”: <Jira's message>") with **Cancel** and **Change the export setup**; nothing was created. Gone shows "SHOP-123 no longer exists in Jira." with **Forget the link** and **New ticket**; the again dialog checks this first (`ticketState`), so the product owner meets it before choosing. |
| D12 | **Forget the link** deletes the feature's link row (key, URL, the stored spec copy, fingerprint and any pending marker) and writes an `export` turn `forgot`; nothing is sent to the tracker. The chip goes, the History card keeps every export, the next export is a first export (a fresh preview, no "again"), and Report back is gone for later starts; a run already started keeps reporting to the ticket its pipeline row names. |
| D13 | **Concurrency and refusals.** One export per feature at a time: `exporting`, a set beside the start lock (`starting.mjs`, re-exported by `export.mjs`), taken before the first await; a second `POST …/export` answers 409 "Worca is already exporting this feature." and the button stays disabled ("Exporting to Jira…"). An export waits for the interview: while a round or look runs (`isBusy(seq)`) it answers BUSY "Worca is still working on this feature. Try again in a moment.", the A1 lock; the preview hash (D6) still guards an edit made between preview and Create. Refused: archived (CONFLICT "this feature is archived; restore it first"; the menu item is disabled with "Restore the feature to export it."). An export and a start of the same feature exclude each other (a start reads the link once): export answers BUSY `STARTING_MESSAGE` while `isStarting`, Start answers BUSY "Worca is exporting this feature. Try again in a moment." while exporting. Setup and preview calls hold no lock. |
| D14 | **Timeouts.** Every export op gets `EXPORT_TIMEOUT_MS = 60_000` (callSource's default is 30 s): a create does three tracker calls (create, read back, plus the property on sites that refuse it in the create body), and `exportOptions` pages through up to 2,000 Cloud projects as `listProjects` does. A timeout on create or new is exactly D10's lost answer: the pending marker stays. |
| D15 | **Start with Report back.** The Ready to build card gets the switch **Report back to SHOP-123**, on by default once the feature has a linked ticket, hidden without one. A run started from a feature is a `markdown` run (`promptMarkdown`, source `{ type: 'markdown' }`), and `/api/run` refuses `source` together with a prompt, so today it cannot carry a ticket. Small extension: `startFeature` passes `reportTo: { plugin, sourceId, profile, taskId, url, title, inputs: { writeBack: 'yes' } }` in the `startRun` options; `invokeStartRun` hands it to `startRunHandler` as `req._reportTo` (in-process only, never from HTTP, like `_roundOf` and `_extrasPaths`), which passes `reportTo` to `createOrchestratorFor`; the run harness writes `sourceType: 'plugin'` and `sourceMeta: reportTo` when `this.opts.reportTo` is set and the source is not a plugin. The task stays the spec; `reportResultForPipeline`, `retryWriteback` and the results view's Report result work unchanged. `inputs.writeBack: 'yes'` is the reserved write-back input's on value (jira-source's `yes()`); the contract names it. The ticket moves only when the connection names a status: `exportOptions` returns `doneStatus` (jira-source: its `transitionOnComplete`, else null), cached on the setup. A run whose pipeline row is `plugin` is counted as a Jira-sourced run in team metrics (`metrics/record.mjs` `readSource`). |
| D16 | **The Jira part.** jira-source uses REST v2 throughout with wiki markup (`markdownToWiki`) so Cloud and Data Center share one path; A6 follows it (no ADF, no v3). Issue types and fields come from create metadata per project and issue type, `GET /rest/api/2/issue/createmeta/{project}/issuetypes` and `…/issuetypes/{id}` (Cloud, and Data Center 8.4 and later; the field list is read from `fields` or `values`, whichever the site answers; an older Data Center answers 404 and the setup says "This Jira is too old for export setup."). Priorities are the `priority` field's `allowedValues` there; without one the select offers only "None". Criteria fields are the custom fields whose `schema.custom` ends with `:textarea` (multi-line text; a one-line field cannot hold a list). An update also needs the field on the edit screen: when it is not, Jira refuses it (D11). |
| D17 | **History card.** The feature page has no history today. Board 28 adds a **History** card; A6 fills it with the `export` turns only, newest first, each "Exported to Jira as SHOP-123 · 26 Oct, 10:42" and the name (board copy), and shows the card only once the feature has one. Board 28's other lines ("You added R-po-6", "Interview done") are left out of A6, since the thread already shows edits to rounds. |
| D18 | **Safety.** Every tracker call runs server-side through `callSource`; the browser never drives it (the new ops are not added to `POST /api/sources/call`'s allowlist). The token stays in the plugin's config, read only by `callSource` and piped to the child on stdin; the setup and link tables hold plugin, source id and profile, never config values, and no view carries config except `doneStatus`. Only the previewed ticket or comment is sent; file contents never, names only. |
| D19 | **Flag, cost, mock.** Every route joins `REQUIREMENTS_ROUTES` (the flag-off walk covers them); frames go through `requirementsChangeNotifier`. No model call and nothing booked in `req_cost_ledger`. Mock mode (`WORCA_MOCK=1`): `plugin-shim.mjs` `MOCK_DEFAULTS` gain `capabilities` (`{ writeBack: true, export: true }`, which keeps today's mock write-back answer), `exportOptions`, `createTicket`, `updateTicket`, `commentTicket`, `ticketState` and `findTicket` (§4), so the browser check runs offline with jira-source linked and one profile. |
| D20 | **Accessibility and phone.** The dialogs are `role="dialog"` `aria-modal`, labelled by their titles; the mode choice is a `role="radiogroup"` "What should happen"; the alerts are `role="alert"`, "Exporting to Jira…" and "Created SHOP-123" `role="status"`; the chip is a link "SHOP-123, opens the ticket in Jira in a new tab" (`target="_blank" rel="noopener"`); the label × buttons are "Remove label <label>"; the description preview is focusable and labelled "Description preview". At 900 px and narrower (where the Requirements page drops to one column and Feature chat becomes a sheet, A3-D2) the dialogs become full-screen sheets with **← FEAT-7** ("Back to FEAT-7"), the description folds behind **Show all**, and buttons are full width at 44 px (board 31). At every width an open export dialog makes every other child of `<body>` inert; closing it, and leaving the Requirements view (`leave()`), release it. Board 31's title is built as approved: at 900 px and narrower the preview's heading is **Export to Jira** (the tracker's display name) with "FEAT-7 · <title>" on a second line; wider it stays **Export FEAT-7 to Jira**. One heading labels the dialog either way. Every export dialog moves the focus inside when it opens (its title, or the dialog's own first control). |

## 3. Data

Migration **v80**, after A3's v78 (`req_helper_messages`) and `dev`'s v79 (`run_groups.name_source`); A6 was first written
as v79 and renumbered when it met dev's. The rung is reconcile-safe (`IF NOT EXISTS` and
`INCREMENTAL_TABLES`), so a database stamped past it without the tables is repaired.

```sql
CREATE TABLE IF NOT EXISTS req_export_setups (
  scope_type      TEXT NOT NULL,                 -- 'project' | 'workspace' (the feature's scope)
  scope_key       TEXT NOT NULL,
  plugin          TEXT NOT NULL, source_id TEXT NOT NULL, profile TEXT,   -- the connection (never its config)
  tracker_project TEXT NOT NULL, tracker_project_name TEXT NOT NULL,      -- 'SHOP', 'SHOP — Shop web'
  issue_type      TEXT NOT NULL, issue_type_name TEXT NOT NULL,           -- the tracker's id and name
  labels_json     TEXT NOT NULL DEFAULT '["worca"]',
  priority        TEXT, priority_name TEXT,                               -- NULL: none
  criteria_json   TEXT NOT NULL DEFAULT '{"target":"description"}',       -- or {"target":"field","field":"customfield_10070","name":"Acceptance Criteria"}
  done_status     TEXT,                                                   -- exportOptions' doneStatus, refreshed on every options call
  created_by TEXT, created_at TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_key)
);
CREATE TABLE IF NOT EXISTS req_export_links (
  feature_seq     INTEGER PRIMARY KEY,           -- one current ticket per feature (D7)
  plugin          TEXT NOT NULL, source_id TEXT NOT NULL, profile TEXT,
  tracker_project TEXT NOT NULL,
  ticket_key      TEXT, ticket_url TEXT,         -- NULL while only a pending create exists
  created_at      TEXT,                          -- when the ticket was made ("was made on 26 Oct")
  exported_at     TEXT,                          -- the last create, update or comment
  spec_json       TEXT,                          -- the spec as last exported (D8)
  fields_json     TEXT,                          -- { issueType, labels, priority, criteria } as last sent
  fingerprint     TEXT,                          -- the plugin's fingerprint of the stored description (D9)
  pending_marker  TEXT, pending_at TEXT,         -- D10
  updated_by TEXT, updated_at TEXT NOT NULL
);
```

The rung is `if (current < 80) db.exec(REQUIREMENTS_EXPORT_DDL);` with both tables in `INCREMENTAL_TABLES`; no column
is added to an existing table. `test/db-migrate-v80.test.mjs`: fresh, 77, 78 (A3), 79 (A6's early numbering, without dev's
`run_groups.name_source`), A8's earlier 75, upstream's 74–76, below 72, and stamped past 80 without the tables all reach
the current version with both tables.

**Turns.** `TURN_KINDS` (`spec.mjs`) gains `export`: `{ action: 'created' | 'updated' | 'commented' | 'new' | 'linked' |
'forgot', tracker, key, url, at, reason? }` (`reason` only for Export anyway), written by the product owner (`created_by`).
`threadText` writes no line for it, so every round, look and helper prompt stays byte-identical. Like A8's `file` turns,
it never hides the error line (`featureView`'s `last`, routes.mjs) or changes what Try again re-runs (`retry`,
interview.mjs): both filters become `t.kind !== 'file' && t.kind !== 'export'`.

## 4. The export contract

**The neutral ticket** (Worca to plugin):

```
{ project: 'SHOP', issueType: '10001', title: 'Cancel an order before it ships',
  description: '<Markdown, D4>', labels: ['worca', 'worca-FEAT-7'], priority: '3' | null,
  criteria: { target: 'description' } | { target: 'field', field: 'customfield_10070', items: ['R-po-1 …', …] },
  marker: 'rexp_3f9a…' }          // only on create
```

With a field target the description leaves out its Acceptance criteria section and the plugin writes `items` into the
field as a list. A comment is Markdown (`renderExportComment`, new): "Updated in Worca since the last export (26 Oct)",
one line per change ("Added R-po-6 <text>", "Changed R-po-2: “<new>” was “<old>”", "Removed R-po-3 <text>", "Business
rules: “<new>” was “<old>”", "Edge cases: added “<line>”", "<Section>: removed “<line>”", "Goal: “<new>” was
“<old>”", "Measure: added “<new>”", "Confirmed A-4 <text>", "A-2 is no longer confirmed"), "Exported before Ready:
<reason>" after the first line with Export anyway, and the footer "From Worca FEAT-7". The lines
follow board 28's punctuation, with no final period.

**New optional ops** (each takes one args object; all optional; each answers in at most `EXPORT_TIMEOUT_MS`):

| Op | Args | Answers |
|---|---|---|
| `capabilities` (existing) | `{ inputs }` | adds `export: true` when the source can export |
| `exportOptions` | `{ project?, issueType? }` | `{ projects: [{ value, label }], issueTypes?: […], priorities?: […], criteriaFields?: […], doneStatus: string \| null, tooOld?: true }`; `issueTypes` with a project, the last two with both; `tooOld` when the tracker cannot list create metadata (jira-source: a Data Center before 8.4) |
| `createTicket` | `{ ticket }` | `{ key, url, fingerprint }` or `{ refused: { field, message } }` |
| `updateTicket` | `{ key, ticket }` (no `marker`) | `{ key, url, fingerprint }`, `{ gone: true }` or `{ refused }` |
| `commentTicket` | `{ key, body }` (Markdown) | `{ ok: true }` or `{ gone: true }` |
| `ticketState` | `{ key }` | `{ exists: true, url, fingerprint }` or `{ exists: false }` |
| `findTicket` | `{ project, label, marker }` | `{ key, url, fingerprint, lastLine, marker, labels }` or `null`; the candidate's own `marker` and `labels` come back so Worca checks all three D10 conditions itself |

Auth, network, rate-limit and timeout failures are thrown as today (`PluginOpError`). The host side lives in
`export.mjs` (new): `exportTrackers(scope)` (enabled sources with profiles whose cached `capabilities` say export),
`exportOptions`, `previewExport`, `runExport`, `forgetLink`, `exportView(f)`, each calling `callSource` with the setup's
or the link's plugin, source id and profile.

**Mock answers** (D19): `exportOptions` SHOP — Shop web and OPS — Operations; Story, Task, Bug; Highest to Low; the
fields "Acceptance Criteria" and "Definition of Done"; `doneStatus: 'Done'`. `createTicket` `<project>-123` (then 124,
…) at `https://mock.test/browse/<key>`, fingerprint the sha256 of the description; `updateTicket` the same key;
`commentTicket` ok; `ticketState` exists with the last fingerprint; `findTicket` null. `setMockSourceResponses` overrides
them in tests (gone, edited, refused).

## 5. The Jira connector

`plugins/jira-source/connector/index.mjs` (`createTaskSource`) gains the ops above; it reuses `jiraFetch` and
`authHeader` (`jira-api.mjs`), `deployment()` / `probeDeployment()` for Cloud vs Data Center, `listProjects` for
`exportOptions`' projects, `buildJql` and `jqlString` for `findTicket`, and `markdownToWiki` (`markup.mjs`), which gains
nothing but is now also fed the ticket and comment Markdown (its headings, `-` and `1.` lists and paragraphs cover D4).

- **createTicket:** `POST /rest/api/2/issue` with `fields: { project: { key }, issuetype: { id }, summary, description:
  markdownToWiki(description), labels, priority?: { id }, [field]?: markdownToWiki(items as "- " lines) }` and `properties:
  [{ key: 'worca.export', value: { marker } }]`; a site that refuses `properties` gets `PUT
  /rest/api/2/issue/{key}/properties/worca.export` instead. Then `GET /rest/api/2/issue/{key}?fields=description` for the
  fingerprint (D9). URL `${base}/browse/${key}`.
- **updateTicket:** `PUT /rest/api/2/issue/{key}` with summary, description, issue type, priority and the criteria field
  in `fields`, labels as `update: { labels: [{ add }] }` (D7); then the read back. 404 is `{ gone: true }`.
- **commentTicket:** `POST /rest/api/2/issue/{key}/comment` `{ body: markdownToWiki(body) }`, as `reportResult` does.
- **ticketState:** `GET /rest/api/2/issue/{key}?fields=description`; 404 is `{ exists: false }`.
- **findTicket:** JQL `project = "SHOP" AND labels = "worca-FEAT-7" ORDER BY created DESC` (Cloud `/search/jql`, Data
  Center `/search`, as `listTasks`), at most 10, then `GET /rest/api/2/issue/{key}/properties/worca.export` for each.
- **exportOptions:** createmeta as D16; `doneStatus` is `ctx.config.transitionOnComplete` trimmed, else null.
- **Refusals:** a 400 whose `errors` names a field becomes `{ refused: { field: <the field's name from createmeta, else its
  id>, message } }` with the sentence of D11; any other failure throws as today.
- **Labels** arrive normalised (D6). `capabilities` answers `{ writeBack: yes(inputs?.writeBack), incrementalSync: false,
  export: true }`.

## 6. API

All behind `requireFlag('requirements')`, in `REQUIREMENTS_ROUTES` (the setup routes before the `/:seq` routes). Errors as
A1 §5 (`RequirementsError` codes); a tracker failure answers 502 `{ error, kind }` with D11's sentence, a refusal 409
`{ error, refused: true }`, a gone ticket 409 `{ error, gone: true }`.

| Route | Does |
|---|---|
| `GET /api/requirements/export-setup/:scopeType/:scopeKey` | `{ setup, trackers: [{ plugin, sourceId, name, profiles: [{ id, label }] }], defaultProfile }` (no tracker call) |
| `POST /api/requirements/export-setup/:scopeType/:scopeKey/options` `{ plugin, sourceId, profile, project?, issueType? }` | `exportOptions` (D16); the source must be one of `trackers` |
| `PUT /api/requirements/export-setup/:scopeType/:scopeKey` `{ plugin, sourceId, profile, project, projectName, issueType, issueTypeName, labels, priority?, priorityName?, criteria }` | saves the setup (D2) |
| `POST /api/requirements/:seq/export/preview` `{ mode, issueType?, labels?, priority?, reason? }` | the ticket (or comment), `previewHash`, `changes`, and for a link `edited` and `gone` (`ticketState`); NOT_READY `{ failing }` without a reason |
| `POST /api/requirements/:seq/export` `{ mode, issueType?, labels?, priority?, reason?, previewHash, force? }` | D6, D10, D11, D13; answers the feature view and `{ key, url }` |
| `DELETE /api/requirements/:seq/export/link` | Forget the link (D12) |
| `POST /api/requirements/:seq/start` | also `{ reportBack? }` (default true when the feature has a linked ticket; D15) |
| `GET /api/requirements/:seq` | `feature.export`: `{ tracker: { name } \| null, canExport, hasSetup, link: { key, url, createdAt, exportedAt, madeOn, lastOn, tracker } \| null, exporting, doneStatus, history }`; `turns` carries the `export` turns |

`mode` is `create`, `update`, `comment` or `new` (`create` only without a link, the others only with one). A success
sends the feature's `requirements-changed` frame.

## 7. Screens (boards 26–31)

Built with upstream's classes as the shipped Requirements pages are (`.card`, `.btn` / `.btn-sm` / `.btn-primary`,
`.badge`, `.chip`, `.select-wrap`, `.field`, `.menu` / `.menu-item` through the page's `menu()` and `menuItem()`, the
modal overlay of `openModal`); CSS as `req-export-*` rules in the Requirements block of `ui/public/style.css`, tokens only.
Board 30 is board 27 in the dark theme and needs nothing but the tokens.

- **Setup** (board 26): **Set up export for <name>**, "Worca uses these for every export from <name>. You can change
  them for one export in the preview, or for good in Export ▾ › Export setup…"; **Connection** (option text: the
  profile's label, led by "<tracker> · " when several trackers can export) with "Connections are added on the
  Marketplace page: Installed › Jira (Advanced mode)."; **Jira project**, **Issue type**, **Labels** (chips with ×, "Add
  a label"), **Priority** "optional" (None first); **Acceptance criteria go to**: "A section of the description" or "A
  Jira field" with its select, and "The list shows the text fields of SHOP that can hold the criteria."; **Cancel**,
  **Save and continue** (from Export setup…: **Save**). Each select loads through `…/options` as the one before it changes.
- **Preview** (board 27): **Export FEAT-7 to Jira**, "This is the ticket Worca will create in SHOP. Change the issue
  type, labels or priority for this export."; **Fields**: Project ("Saved in the export setup · <connection>"), Issue type,
  Summary ("The feature's title"), Labels (with the fixed `worca-FEAT-7` and its hint), Priority, Acceptance criteria
  ("→ Description", "A section of the description, as in the export setup"; with a field, "→ <field name>" and its
  items under it); **Description, as Jira will show it**; "Only what you see here is sent to Jira."; **Cancel**, **Create
  in Jira** (Update: **Update SHOP-123**; new ticket: **Create in Jira**). Not Ready: board 27's dialog first (D5): the
  lead as the Start dialog writes it ("One check does not pass yet:" / "<n> checks do not pass yet:"), the open
  questions as "**<n> open question(s).** <the first one>", undecided assumptions as "**A-4 is not decided.** The ticket
  lists confirmed assumptions only.", other checks as the Start dialog lists them; "Your reason is recorded on the
  feature. The preview then adds it at the top of the description: “Exported before Ready: <your reason>”."; **Keep
  deciding**, **Export anyway**.
- **After, and again** (board 28): the chip **SHOP-123 ↗** after the header chips; the **History** card (D17); **Export
  FEAT-7 again** with its radio cards, **What changed since the last export (26 Oct)**, "The preview shows the result
  before anything is sent.", the edited alert when `edited` (D9); **Comment on SHOP-123** with "This comment is added to
  SHOP-123. Its description and fields stay as they are.", the comment, "Only what you see here is sent to Jira.",
  **Back**, **Add comment**.
- **States** (board 29): the failure lines of D11: "Worca could not reach Jira: <reason>." with "the API token was
  refused", "it did not answer within a minute", "the Jira plugin gave an answer Worca could not read", the plugin's own
  plain sentence, or "the Jira plugin stopped unexpectedly"; "Nothing was recorded. The preview stays open, so you can try again
  once the connection is fixed on the Marketplace page (Installed › Jira)."; **Exporting to Jira…** (blue badge) with the
  primary button disabled; "Created SHOP-123" (green check, ink text) after the dialog closes; the Ready to build card's
  **Report back to SHOP-123** switch with "When the run ends, Worca comments with the result and the pull request link,
  and moves the ticket to <doneStatus> (the status named in the Jira connection; without one, it only comments)."; the
  archived menu (Export to Jira… disabled, "Restore the feature to export it.").
- **Phone** (board 31): D20.

**Not on the boards** (smallest behaviour, said here rather than invented in code):
- Report back without a status: "When the run ends, Worca comments with the result and the pull request link. The Jira
  connection names no status to move the ticket to, so it only comments." Start anyway's dialog and the runs card's
  Start again carry the same switch row.
- The again dialog with nothing changed: "SHOP-123 was made on 26 Oct. The spec has not changed since the last export
  (26 Oct)."; Add a comment is disabled.
- History lines besides board 28's: "Updated SHOP-123 in Jira", "Commented on SHOP-123 in Jira", "Linked SHOP-123, which
  an earlier export made", "Forgot the link to SHOP-123"; an Export anyway line adds "· before Ready: <reason>".
- The setup on a Data Center older than 8.4: "This Jira is too old for export setup." (D16).
- The preview after the spec changed under it: "The spec changed since the preview. Look at the preview again." with a
  fresh preview.
- **Connect a tracker…**'s dialog: title **Connect a tracker**, the line of D2, **Close**; at the Advanced level also
  **Open the Marketplace page**.
- A refused field that is not a required one: "Jira refused “<field>”: <Jira's message>" (D11).
- The setup's Connection select when the saved connection is gone (or none is chosen yet): it leads with "Choose a
  connection", and picking one loads its projects.
- An export op the connector no longer has after its capability said yes (a downgraded plugin): "Jira cannot export any
  more."
- A comment on a ticket Worca has no spec copy for (linked from another connection or project): "Update <KEY> once
  to give Worca a starting point for comments." ("Update SHOP-123 once to give Worca a starting point for comments.")
- An export within two minutes of a create whose answer was lost (a timeout, a network failure, a protocol failure, or
  Worca stopped) that does not find the ticket yet (D10): "Worca is still checking whether Jira made the ticket. Try
  again in a moment." A create the tracker refused (auth, rate limit) made no ticket and does not wait.
- A ticket an earlier export made, found by the next export (D10): with the same connection and tracker project, and a
  preview for that ticket (a create, or an update of it), it is linked and the export goes on as an update of it with
  what the preview shows (History: "Linked SHOP-123, which an earlier export made", then "Updated SHOP-123 in Jira").
  When the setup moved to another connection or project since, or a lost New ticket turns up while the preview was for
  the old ticket, it is only linked: Export again opens for it saying "Linked <KEY>, which an earlier export made.
  Nothing was sent." ("Linked SHOP-123, which an earlier export made. Nothing was sent.")
- The Report back switch is upstream's ink `.switch` (switch.mjs), never green or blue.

## 8. Code changes

- `src/core/requirements/ticket.mjs` (new, pure): `buildTicket`, `normalizeLabels`, `exportChanges(before, after)`,
  `changeSummary`, `renderExportComment`, `ticketHash`, `exportDate`, `EXPORT_LIMITS` (`labels: 10`, `label: 255`).
- `src/core/requirements/export.mjs` (new): `EXPORT_TIMEOUT_MS`, `isExporting(seq)` (the set lives in `starting.mjs`), `exportTrackers`,
  the capability cache, `exportOptions`, `saveSetup`, `previewExport`, `runExport` (pending marker, `findTicket`, the
  call, the link and the turn in one `tx`), `forgetLink`, `exportView`, `reachReason(err)`.
- `markdown.mjs`: `renderTicketMarkdown(f, { reason, exportedOn, criteriaInDescription, mentionedFiles })`, sharing the
  export's helpers; `renderSpecMarkdown` unchanged.
- `store.mjs`: `getExportSetup`, `upsertExportSetup`, `getExportLink`, `setPendingExport`, `saveExportLink`,
  `clearPendingExport`, `deleteExportLink`.
- `spec.mjs`: turn kind `export`. `routes.mjs`: §6, `featureView`'s `export`, the `last` filter (§3).
  `interview.mjs`: `retry`'s filter (§3). `start.mjs`: `reportBack`, `reportTo` in the `startRun` options, the export
  lock (D13).
- `src/core/db.mjs`: `REQUIREMENTS_EXPORT_DDL`, `INCREMENTAL_TABLES`, v80.
- `ui/server.mjs`: `invokeStartRun` takes `reportTo` and sets `req._reportTo`; `startRunHandler` passes it to the project and
  workspace `createOrchestratorFor` calls that start the run (not the workspace probe). `src/core/run-harness.mjs`: `sourceType` / `sourceMeta` from `this.opts.reportTo` (D15).
- `src/core/plugin-shim.mjs`: `MOCK_DEFAULTS` (D19). `src/core/plugin-api.mjs`: the comment line (D3).
- `plugins/jira-source/connector/index.mjs`: §5; `jira-api.mjs`: a failed request's error carries Jira's JSON body;
  `plugins/jira-source/README.md`: an Export section.
- `ui/public/app.js`: the Requirements view's `leave()` when another view is shown (D20).
- `ui/public/requirements-view.mjs`: the menu items, the dialogs, the chip, the History card, the Report back row;
  `ui/public/style.css`: §7.
- `tools/verify-requirements-cdp.mjs` (links jira-source with `linkPlugin` and one profile); docs (§9).

## 9. Testing

- **Ticket** (`test/requirements-ticket.test.mjs`): board 27's description from its fixture byte for byte; empty sections
  out; the reason line; criteria in the description or a field; sources; mentioned files; label normalisation and the
  fixed label; `exportChanges` against D8 (assumptions entering and leaving `confirmed`, open questions ignored); board
  28's summary and comment; `exportDate` in another time zone.
- **Export job** (`test/requirements-export.test.mjs`, mock shim with `setMockSourceResponses`): each mode; the hash
  guard; Export anyway's reason and NOT_READY; edited (fingerprints differ) and `force`; gone; refused; reach failures by
  kind; one export at a time; export vs start; archived; the pending marker kept on a timeout and `findTicket`'s three
  checks (another install's marker, a wrong footer, a match); Forget the link; links pinned to their connection;
  nothing written on any failure.
- **Store / migration:** `test/db-migrate-v80.test.mjs` (§3); setup per project and per workspace.
- **Start** (`test/requirements-start.test.mjs`, `test/requirements-run-link.test.mjs`): `reportBack` on by default with a
  link, off on request, absent without one; the pipeline row gets `source_type 'plugin'` and the `source_ref`;
  `reportResultForPipeline` reports to the ticket (`lastReport` in the mock state); a body's `_reportTo` from HTTP is
  ignored.
- **Jira** (`test/jira-source-export.test.mjs`, against a fake Jira HTTP server, `test/helpers/fake-jira.mjs`): each op on
  Cloud and Data Center; createmeta's
  `fields` and `values`; the textarea filter; a required custom field; a refused token; 404 as gone; the property in the
  create body and the fallback PUT; add-only labels; the fingerprint's normalisation.
- **Shim** (`test/plugin-shim.test.mjs`): the new mock answers; `capabilities`' mock keeps write-back's default.
- **API:** the flag-off walk covers every new route; no route reaches a token; the browser allowlist unchanged.
- **UI (jsdom):** boards 26–29 and 31; the menu with no tracker, one, several, archived; `aria-*` of D20.
- **Real browser:** `npm run verify:requirements` (mock) gains: setup → preview → Create → chip and History → Export again
  → comment preview → Add comment; Export anyway; Start with Report back (the mock state records the report); light,
  dark and 390 px.
- **Real Jira:** a check by hand on a test project (setup, preview, create, update after an edit in Jira, comment,
  Forget the link, a run with Report back) before export leaves Labs.
- **Linux:** the full `npm test` and `npm run smoke`; failures compared with `dev` as before.
- **Docs:** `docs/requirements.md` (an **Export to a tracker** section), `docs/storage.md` (the two tables),
  `docs/ui-levels.md` (the setup, preview, again dialog, chip, History card and Report back row — **S**; Connect a
  tracker… — **S**, its Marketplace button **A**), the Requirements entry of `docs/changelog/unreleased.md`.

## 10. Where A6 meets A2, A8 and A3

- **A2.** Export reuses `readiness` and Start anyway's reason rule; it never starts a run, never writes `req_starts`, and
  an export is not a start (no version, no "Changed since the run started"). Start gains only Report back (D15) and the
  lock of D13.
- **A8.** The ticket names files only ("Files the spec mentions", "(from <name>)"); nothing of a file's body or summary
  goes to the tracker. Attachments in the tracker are out of scope.
- **A3.** Feature chat neither exports nor sees exports (`export` turns write no thread line). A change it proposes and
  the product owner accepts is an ordinary edit, so it shows in "What changed since the last export". A3 took schema 78,
  A6 is 80 (§3; dev took 79). Both make the page behind them inert at 900 px and narrower: an export dialog closed over an open
  Feature chat sheet leaves that sheet modal, and leaving the Requirements view releases both.

## 11. Out of scope

- Epics and "is blocked by" links (A5).
- Reading changes back from the tracker into the spec; only the fingerprint is read (D9).
- Attachments in the tracker.
- Export for GitHub Issues and Azure Boards: their plugins add the same ops later.
- Jira's ADF (REST v3) and Data Center before 8.4's createmeta.
- Several current tickets per feature (a new ticket moves the link, D7).
