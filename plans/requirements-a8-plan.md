# Requirements (A8: attachments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A product owner can give Worca the material a feature comes with (emails, support tickets, a spec, screenshots, a mockup). Worca reads each file once, when it is added, writes down "What Worca took from it" (editable; the product owner's text wins), and every interview round uses that. Files can be added, replaced, asked about, read again and removed under the same rules as the product owner's other edits; spec items that came from a file name it; on Start the files switched on go to the run as its attached files and the start records which ones. A made Product brief can keep documents that every feature of its scope uses.

**Architecture:** Pure attachment logic (limits, ids, display names, refusals, the reader's prompts and reply checks, the `<attachments>` and documents blocks, mentions) in a new `src/core/requirements/attachments.mjs`; the base64 upload validation, extracted from Ask's messages route with no Ask behaviour change, in a new `src/core/attachment-upload.mjs`; the job (bodies on disk, the read queue, the one read per file through A1.1's `callModel`, ask / replace / read again, spend, recovery, the boot sweep, estimates, and what rounds, views and starts read) in a new `src/core/requirements/attachment-job.mjs`. A read that opens a file is confined by a new fail-closed PreToolUse hook, the file-read guard (`src/core/file-read-guard.mjs` and `file-read-guard-cli.mjs`), carried by the runner in its one `--settings` payload. One new table `req_attachments` (v77) with `req_cost_ledger.attachment_id` and `req_starts.files_json`. The interview gains one prompt block, the follow-up for files and spec sources in small hunks of `round.mjs` / `interview.mjs` / `ready.mjs`; the brief gains documents in `brief.mjs` / `brief-job.mjs`; the run hand-off reuses the extras path of `ui/server.mjs`. The page module `ui/public/requirements-view.mjs` gains the Files field, the Files card, its menus and dialogs, the Ready row and the brief's Documents card.

**Tech Stack:** Node ESM, `node:sqlite`, `node:test`, jsdom, Express (`ui/server.mjs`), vanilla DOM (`ui/public/*.mjs`), Claude Code CLI through A1.1's `callModel` (replace mode, hermetic flags).

**Spec:** `plans/requirements-a8-design.md` (decisions D1–D18 win where this plan is unclear). A1: `plans/requirements-design.md` (A1-D<n>); A2: `plans/requirements-a2-design.md` (A2-D<n>); A1.1: `plans/requirements-a11-design.md` (A1.1-D<n>); A7: `plans/requirements-a7-design.md` (A7-D<n>).

**Visual reference (UI tasks):** design round 3 of the Claude Design canvas "Requirements — design rounds 1, 2 and 3", boards 15–21: board 15 New feature with files, board 16 the feature page's Files card (every state), board 17 board 16 in the dark theme (tokens only, nothing to build), board 18 Ready to build with Files for the run, board 19 the brief's Documents card, board 20 the Files card at 390 px, board 21 a file's ⋯ menu, Replace, Ask about this file and source tags. They use upstream's classes (`card`, `btn`, `btn-sm`, `badge`, `chip`, `hint`, `menu` / `menu-item`, the shared switch of `switch.mjs`); inline styles are layout hints. Where the design doc deviates from a board the doc wins; what no board shows is listed in design §6 "Not on the boards": build exactly that, nothing more.

## Global Constraints

- One commit per task; subjects start `Requirements:`; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Flag (D18).** Every new route is in `REQUIREMENTS_ROUTES` behind `requireFlag('requirements')`; the upload parsers sit behind the same gate, so an upload with the flag off is answered 404 without being parsed; file results reach the page only through `requirementsChangeNotifier` (a feature's `seq` frame) and `requirementsBriefNotifier` (a brief's `brief` frame).
- **Schema v77** (`SCHEMA_VERSION` 76 → 77): `req_attachments` exactly as design §3, `IF NOT EXISTS`, in `INCREMENTAL_TABLES`; `req_cost_ledger.attachment_id` and `req_starts.files_json` in `INCREMENTAL_COLUMNS`; the v77 rung runs `repairSchemaGaps` after its DDL.
- **Limits** (`REQ_ATTACH_LIMITS`): 10 files per feature, 10 documents per brief, 25 MB per file, 100 MB per upload request; the upload routes' JSON window is Ask's formula, `ceil(100 MB × 4 / 3) + 1 MiB`.
- **Text caps:** a summary at most 1,500 characters (the product owner's too); an answer at most 600; a question 1–200; at most 20 answers per file; a history of at most 10 entries, newest first; one file's summary and answers at most 3,000 characters in a prompt (newest answers first, older ones cut with "(… N earlier answers)").
- **The 24 KB budget** (`ASK_LIMITS.inlineAttachmentsMaxBytes`): a text file of at most 24 KB is read inline; `<attachments>` carries the full redacted text of text files, in upload order, while they stay within 24 KB in all.
- **One read per file (D3):** one read-only call through `callModel` with `interviewModel(d)`'s model and effort (passed explicitly), `ATTACHMENT_SYSTEM_PROMPT`, replace mode and the hermetic flags (A1.1-D6's sign-in exception included). Inline: `kind: 'round'`, no tools. Opened with Read (image, PDF, text over 24 KB): `kind: 'look'`, `tools: ['Read']`, one allow rule in Ask's `//**/` pattern form naming the copy (no drive, no home), `maxTurns: 5`, in a fresh `<worcaHome>/tmp/requirements/att-read-<8 hex>/` folder holding only the copy (a text file's copy is its redacted text), removed on every path. `READ_TIMEOUT_MS = 180_000` for either form.
- **The read is enforced, not only intended (D3, D15).** The engine allows a Read its allow list does not name, so every Read-form read and ask carries the **file-read guard**: matcher `*`, it lets `Read` open only the one copy and denies every other path and tool; a path is decided lexically first (absolute, no `..` step, equal to the copy or its real path, case-insensitive on Windows; UNC, device and 8.3 forms refused) and only a match is looked up. Its CLI exits 2 unless it explicitly allows and logs every decision to a file the runner names; a read whose tool calls are not all covered by logged decisions (`guardDecisionsCover`) is discarded. It is the runner option `readGuard` (a caller's `extraSettings` never carries `hooks`), with `disableAllHooks: false`. Every read and ask (both forms) and the brief look carry `permissionRules: { deny: REQUIREMENTS_READ_DENY_RULES }` and `noSessionPersistence: true` (`--no-session-persistence`: Claude Code keeps no session transcript of the call): Ask's deny rules plus Worca's stored attachments, Ask's threads and more credential folders, with Ask's tmp deny narrowed to every tmp folder but `tmp/requirements/`.
- **Concurrency:** at most `MAX_READ_JOBS = 2` reads and asks at once across all features and briefs, separate from `MAX_JOBS` (4) and `MAX_BRIEF_JOBS` (2); the others wait in order. Round 1 of a feature created with files waits for its reads at most `ROUND1_WAIT_MS = 360_000`, and a create that waits does not count against `MAX_JOBS`.
- **File types** are Ask's tables (`classifyExtension`, `sniffMime`): text `.md .markdown .txt .json .csv .log .html .htm` (UTF-8, no NUL), images `.png .jpg .jpeg .gif .webp` and `.pdf` (magic number checked); `.docx .xlsx .pptx` are refused with the PDF hint. Ask keeps its own limits, engine refusals and messages byte for byte.
- **Storage (D9):** bodies at `<worcaHome>/requirements/att/<id><ext>`, the path built only from the store-minted id `ratt_<12 hex>` (checked against `REQ_ATT_ID_RE` first) and `extensionForAttachment`; body first, then row; removal deletes the row, then the body; a display name is never a path.
- **Spend (D5):** every read and ask is booked in `req_cost_ledger` with `attachment_id`: a feature file under `feature_seq` (and `req_features.cost_usd`), a brief document under `brief_id` with `feature_seq = 0`, never in `req_briefs.cost_usd` or the brief estimate. The budget is checked before every read (a stopped read is `unread-budget`, nothing spent) and at an ask's press (409 `BUDGET`) and again before its call.
- **Real reads spend money:** every automated test uses a fake runner or mock mode; a capped manual real-read check exists (`tools/requirements-real-read.mjs`, `--max-usd`).
- **Prompts as data:** files, their names, summaries and answers always go through `asData` and are named in the prompts' data rules; without files and documents every round, look and brief **user** prompt is byte-identical to A7's (the stored expectations stay green; the system prompts change in Tasks 6–8).
- **Mock mode** (`WORCA_MOCK=1`, A1-D13): no copy, no spawn, cost 0; `[mock]` summaries and answers (D17); the mock round's first criterion carries the first file's name as its source; `WORCA_MOCK_READ_MS` (mock only) delays a mock read so the browser proof sees the reading states.
- **Downloads (D10):** Ask's headers through `attachmentDisposition` (`inline`), `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-cache`, `ETag` = the `sha256`.
- **Busy refusals:** feature file routes refuse while the feature is busy (A1 lock), archived or starting (`isStarting`); a file being read refuses edit, replace, ask and read again (409 "Worca is reading this file."); brief document routes need a made brief and are allowed while a refresh runs (A7-D6).
- **Imports:** `interview.mjs` and `attachment-job.mjs` import each other and use each other's bindings only inside functions (both load orders are tested); no import from Shaper code; core modules never import `ui/server.mjs`.
- **Copy:** every user-facing string is design §6 / D7 / D9–D15 verbatim. Where the design names none, this plan adds, in product language: "What Worca took from it cannot be empty." · "This file has 20 answers already." · "<name> was not added: add up to 100 MB at a time." · "Worca could not answer “<question>”: <reason>." (without a reason: "Worca could not answer “<question>”.") · "Remove <name>? The file and what Worca took from it are deleted from Worca." (a file or a document) · "<name> cannot go with the run: Worca could not open the stored file. Replace it, or leave it out of the run." · "Worca stopped this read: it could not confirm the read stayed inside this file. Try again." · "Read it again first: Worca could not read this file." · "This is the same version as <name>." · the badge "Asking…" with "Worca is looking for: “<question>”…" · for documents, "Interviews use it once it is read." / "Interviews list it by name only." in place of the feature lines.
- `style.css`: tokens only (no hex, no `rgba(`); every new rule goes inside the existing Requirements block (it ends right before `/* ── marketplace P3 ── */`), never at the end of the file.
- No local machine paths in shipped files (code, tests, docs, plans).
- Route errors: `{ error }` with 400 / 404 / 409 / 413 / 500 (413 is new, code `TOO_LARGE`).
- One test file: `node tools/test.mjs test/<file>.test.mjs`; each task runs its own files. Full suite: `npm test`, compared with the base branch file by file (Task 18). POSIX-only tests are skipped on Windows and run on Linux.

## Review Focus

1. **The read is confined.** The guard allows only the copy and denies a sibling, a `..` escape, a symlink out of the folder, another absolute path (POSIX and Windows forms) and every other tool; a read and an ask carry it and the deny rules, the brief look carries the deny rules, and no other call's options change; a read whose tool calls the guard did not decide is discarded (Tasks 3, 4, 6, 17).
2. **Ask is unchanged.** `POST /api/ask/threads/:id/messages` answers every refusal with the same status and message as before, and `startAskTurn` receives the same file objects (Task 2).
3. **The read call.** A 30 KB text and a PDF reach the runner in replace mode with `ATTACHMENT_SYSTEM_PROMPT`, `tools: ['Read']`, one allow rule naming the copy, `maxTurns: 5`, the interview model and effort; the folder holds only the copy and is gone afterwards, also after a throw, a timeout or a removal; a small text goes inline, redacted, with no tools (Task 4).
4. **Spend and the budget.** A blocked budget leaves the file `unread-budget` with no call and no ledger row; the next round with the budget open reads it; a document's read books `feature_seq = 0`, `brief_id`, `attachment_id` and leaves the brief's cost and estimate alone (Tasks 1, 4, 6).
5. **Byte-identity.** Without files and documents the round, look and brief prompts equal A7's stored text; with files `<attachments>` is the last block of `stable`, and two rounds with the same files share `stable` (Task 6).
6. **The change rules (D8).** A file added after the interview finished fails "Interview finished" with "<name> to ask about", starts one follow-up round by itself once its read ends (at most 3 questions, outside the round cap), or offers **Ask about <name>** when it cannot start; after a start no round; documents never start one (Tasks 8, 14).
7. **The run hand-off.** Start copies the switched-on files into the run's extras folder under their display names made legal by `downloadFilename`'s rules (reserved names, 255 UTF-8 bytes; a repeated name gets " (2)"), `startRunHandler` uses `req._extrasPaths` (never from HTTP), the start row records `files`; switching, removing or replacing shows in Changed since the run started; Undo puts the feature files' switches back (Task 10).
8. **Flag off.** Every new route 404 by the gate; an upload is not parsed; no frame (Task 9).

## Files

| File | Task(s) | Responsibility |
|---|---|---|
| `src/core/file-read-guard.mjs`, `file-read-guard-cli.mjs` (new) | 3 | the guard's decision, its hook entry, the CLI and its decision log |
| `src/core/engines/claude.mjs`, `src/core/claude-runner.mjs` | 3 | the runner option `readGuard` in the one `--settings` payload |
| `src/core/ask/deny-rules.mjs` | 3 | `REQUIREMENTS_READ_DENY_RULES` (Ask's lists unchanged) |
| `src/core/attachment-upload.mjs` (new) | 2 | `validateAttachmentUploads`, shared by Ask and Requirements |
| `src/core/requirements/attachments.mjs` (new) | 1, 2, 4–7, 9 | pure: limits, ids, names, refusals, prompts, reply checks, prompt blocks, sources, mentions |
| `src/core/requirements/attachment-job.mjs` (new) | 4–6, 8–10 | bodies, the read queue, reads, asks, replace, spend, recovery, sweep, estimates, views, run files |
| `src/core/db.mjs`, `requirements/spec.mjs`, `requirements/store.mjs`, `cost-budget.mjs` | 1 | v77, turn kind `file`, `TOO_LARGE`, attachment rows, start `files`, file spend |
| `src/core/requirements/interview.mjs`, `round.mjs`, `ready.mjs` | 3, 4, 6–8, 10 | call overrides, round 1 waits, `<attachments>`, sources, the follow-up for files, readiness |
| `src/core/requirements/brief.mjs`, `brief-job.mjs` | 6, 7 | documents in the brief prompts, sources on brief items |
| `src/core/requirements/edits.mjs`, `markdown.mjs`, `start.mjs` | 7, 10 | source survives an edit, "(from <name>)", Undo's switches, the run's files |
| `src/core/requirements/routes.mjs`, `ui/server.mjs` | 2, 9, 10 | §5 routes, upload windows, boot wiring, the extras hand-off |
| `ui/public/attach-files.mjs`, `requirements-view.mjs`, `style.css` | 11–15 | boards 15, 16, 18, 19, 20, 21 |
| `tools/requirements-real-read.mjs` (new) | 17 | the capped manual real-read check |
| `tools/verify-requirements-cdp.mjs`; `docs/requirements.md`, `storage.md`, `ui-levels.md`, `changelog/unreleased.md` | 16 | the browser proof; docs, levels, changelog |

---

### Task 1: Schema v77, the attachments store and file spend

The table, its two columns and the store rows every later task reads; the first, pure part of `attachments.mjs` (limits and names).

**Files:**
- Modify: `src/core/db.mjs` (`SCHEMA_VERSION`, `REQUIREMENTS_ATTACHMENTS_DDL` after `REQUIREMENTS_BRIEFS_DDL`, `INCREMENTAL_TABLES`, `INCREMENTAL_COLUMNS`, the v77 rung after v74's), `src/core/requirements/spec.mjs`, `src/core/requirements/store.mjs`, `src/core/cost-budget.mjs`
- Create: `src/core/requirements/attachments.mjs`
- Test: create `test/db-migrate-v77.test.mjs`, `test/requirements-attachments.test.mjs`; modify `test/db-migrate-v72.test.mjs` (pinned ledger columns gain `attachment_id`), `test/db-migrate-v73.test.mjs` (`files_json`)

**Interfaces:**
- `attachments.mjs`: `REQ_ATTACH_LIMITS` (frozen: files, fileBytes, requestBytes, summary, answer, question, asks, history, entry, inlineBytes, name); `REQ_ATT_ID_RE = /^ratt_[0-9a-f]{12}$/`; `displayName(raw)` (last segment of either separator, well formed, no control or bidi characters, at most 200); `uniqueName(name, taken)` (" (2)", " (3)" before the extension, ignoring case); `sizeLabel(bytes)`; `KIND_TITLES` / `KIND_WORDS` (text, image, PDF).
- `store.mjs`: `mintAttachmentId()`, `insertAttachment({ id, ownerType, ownerId, name, kind, mime, bytes, sha256, status }, { by })`, `getAttachment`, `listAttachments(ownerType, ownerId)` (upload order), `updateAttachment(id, patch, { by })` (unknown fields throw), `addAttachmentCost`, `deleteAttachmentRow`, `deleteOwnerAttachments` (returns the rows, for their bodies), `listReadingAttachments`, `recentReadCosts(kind, limit = 10)`, `getBriefById`; `createStart` takes `files`; `recentBriefCosts` leaves `attachment_id` rows out; `deleteBrief` deletes the documents' rows in its transaction and keeps its boolean result.
- `spec.mjs`: `TURN_KINDS` gains `'file'`; `RequirementsError` code `'TOO_LARGE'`. `cost-budget.mjs`: `recordRequirementsCostDelta({ …, attachmentId = null })`.

**Tests:** the table, indexes and both columns on a fresh database, one stamped 74, one from below 72, upstream's 70, 71, 75 and 76, the first A8 numbering's 75, and one stamped past this version without the table (repaired); limits and names (never a path, unique names); the store mints the id and refuses one it did not mint before writing; JSON and booleans round-trip; one content per owner (another owner may hold the same bytes); owner deletes return their rows; read costs per kind; ledger rows under a feature and under a brief, the brief estimate reading looks only; starts record their files (`[]` without); deleting a brief deletes its documents' rows.

---

### Task 2: The shared upload validation (Ask unchanged)

Extract the base64 JSON upload check from Ask's messages route into one module both pages use; Ask's limits, engine refusals and messages stay byte for byte.

**Files:**
- Create: `src/core/attachment-upload.mjs`
- Modify: `ui/server.mjs` (the `POST /api/ask/threads/:id/messages` attachment loop calls it; drop the imports it leaves unused), `src/core/requirements/attachments.mjs`
- Test: create `test/attachment-upload.test.mjs`; Ask's route and kind tests stay green unchanged

**Interfaces:**
- `validateAttachmentUploads(list, { maxFiles, maxBytesPerFile, maxBytesPerBinaryFile, maxBytesTotal, refuse?, notAllowed?, messages? })` → `{ ok: true, files: [{ name, kind, mime, data, text?, bytes, sha256 }] }` or `{ ok: false, status: 400 | 413, error }`; defaults are Ask's messages.
- `attachments.mjs`: `OFFICE_EXTENSIONS`, `officeRefusal(name, ext)`, `reqUploadOptions({ owner: 'feature' | 'brief', create = false })` (the Requirements caps and D7 messages, the New feature total on create).

**Tests:** every allowed type passes with Ask's kinds, the body and a `sha256` of the uploaded bytes; Ask's refusals and messages byte for byte, a file's own refusal before the total in Ask's order; the Requirements options: types, Office's own message, 25 MB, 10 files, 10 documents, the New feature total.

---

### Task 3: The file-read guard

The engine reads a path its allow list does not name, and under A1.1-D6's sign-in exception the user's own settings may allow every Read; an attached file is third-party content, so a read must not open anything but its copy. The guard is built like the host guard (`src/core/host-guard.mjs`): a pure decision, a hook CLI, an entry the runner merges into the one `--settings` payload.

**Files:**
- Create: `src/core/file-read-guard.mjs`, `src/core/file-read-guard-cli.mjs`
- Modify: `src/core/engines/claude.mjs` (`buildSettingsPayload`, `buildSettingsArgs`, `buildClaudeArgs`, `planClaudeInvocation`, `runClaudeProcess`), `src/core/claude-runner.mjs` (`runClaude`), `src/core/ask/deny-rules.mjs`, `src/core/requirements/interview.mjs` (`CALL_KEYS`, `interviewCallOptions`)
- Test: create `test/file-read-guard.test.mjs`; modify `test/requirements-interview.test.mjs`; the runner's argv and settings tests stay green

**Interfaces:**
- `file-read-guard.mjs`: `readGuardHookEntry(allowedPath, { log })` → `{ matcher: '*', hooks: [{ type: 'command', command }] }` (throws on a relative path); `lexicalPath(p, { platform })`; `evaluateFileRead(payload, allowedPath, { platform, real })` → `null` (allow) or the refusal reason; `decisionEntry`, `readGuardDecisions(file)`, `toolCalls(events)`, `guardDecisionsCover(events, logLines)`.
- The CLI: `node src/core/file-read-guard-cli.mjs <allowed path>`; stdin the PreToolUse payload; exit 0 allow, exit 2 deny with the reason on stderr; an unreadable payload is denied; each decision appended to the named log.
- Runner: `runClaude({ …, readGuard })` adds the entry and `disableAllHooks: false` to the payload and returns `readGuardDecisions`; without `readGuard` every payload and argv is byte-identical.
- `REQUIREMENTS_READ_DENY_RULES` (design D15's list). `interviewCallOptions(kind, { …, permissionRules, readGuard })` emits each only when given and throws on a `readGuard` that is not an absolute path; every existing call's options are unchanged.

**Tests:** POSIX forms (the copy allowed; a sibling, a `..` escape, another absolute path and a bare name refused); Windows forms (either separator, any case, the `/c/` form; another drive or folder refused); every other tool, a Read without a path and a non-payload refused; a symlink out of the folder refused, a link to the copy allowed (POSIX); the CLI's exit codes, fail-closed; the settings payload with and without the guard; `runClaude` forwards it into the spawn argv (POSIX, fake claude); the two call overrides leave every other call unchanged.

---

### Task 4: The read job and its prompt

One read per file on upload (D3, D4, D5): the reader's prompt and reply check, the job module with bodies, the queue, spend, recovery and the sweep.

**Files:**
- Create: `src/core/requirements/attachment-job.mjs`
- Modify: `src/core/requirements/attachments.mjs`, `src/core/requirements/interview.mjs` (the `allowedTools` override; `callModel` takes a caller `signal` and passes back `readGuardDecisions`)
- Test: create `test/requirements-attachment-job.test.mjs`; modify `test/requirements-attachments.test.mjs`, `test/requirements-interview.test.mjs`

**Interfaces:**
- `attachments.mjs`: `ATTACHMENT_SYSTEM_PROMPT` (design §4 verbatim); `buildReadPrompt({ feature?, scopeName?, file, text?, dir?, path? })` (name, kind and size inside `<file>`; the inline text or A1.1's working-directory line naming the copy by its absolute path); `normalizeSummary(text)` (clip at 1,500; empty or unparseable → `RoundError`, `BAD_REPLY`); `mockSummary(name)`; `checkNewFiles(ownerType, existing, files)` (the cap counts files already there; a duplicate refused by name; names made unique); `readRule(path)`.
- `interview.mjs`: `interviewCallOptions(kind, { …, allowedTools })` (default: the call's `tools`); `callModel(d, { kind, cwd, prompt, model, timeoutMs, signal = null, ...overrides })`.
- `attachment-job.mjs`: `MAX_READ_JOBS = 2`, `READ_TIMEOUT_MS`, `READ_MAX_TURNS = 5`; `attachmentsDir()`, `attachmentFile(row)`, `ownAttachment(owner, id)` (404 when not the owner's); `addAttachments(owner, files, { by }, deps)`, `removeAttachment`, `stopJobs(ids)`, `removeOwnerBodies(rows)`, `editSummary`, `setSend`, `isReading(id)`, `isAsking(id)`, `readsSettled(owner)`, `queueUnread(seq, deps)`, `recoverAttachmentReads()`, `sweepReadFolders(base, { olderThanMs, now })`, `readEstimate(kind)` (median of the last 10 finished reads of a kind, `null` without any). `owner = { type: 'feature', id: seq } | { type: 'brief', id, scopeType, scopeKey }`; `deps` carry the runner, models, projects, budget, the two notifiers, mock mode and the timeout.
- A Read-form read or ask whose tool calls are not all covered by the guard's decisions is discarded (no summary stored, cost still booked).

**Tests:** bodies built from id and kind only; a small text inline, redacted, no tools, the interview model and effort, the stored body the upload; an image, a PDF and a 30 KB text through Read from a one-file folder that is gone afterwards; a throw, an unreadable reply and an empty summary fail with their code, cost booked, no folder left; a timeout is `TIMEOUT`; the budget before every read (`unread-budget`, nothing spent) and `queueUnread` reading the budget only when a file waits; at most 2 at once, the rest in order; a document books under the brief; remove stops a running read and drops its result; edit marks the text and writes a `file` turn, refused while reading; mock mode spawns nothing; recovery turns `reading` rows into `failed` `INTERRUPTED`; the sweep removes only `att-read-*` folders older than an hour; `callModel` aborts with the caller's signal.

---

### Task 5: Replace, ask about a file, read again

D11 and D12 in the job: a focused ask, a re-read of the same body, and Replace that keeps the file's place.

**Files:**
- Modify: `src/core/requirements/attachments.mjs`, `src/core/requirements/attachment-job.mjs` (the queue runs asks too)
- Test: modify `test/requirements-attachments.test.mjs`, `test/requirements-attachment-job.test.mjs`

**Interfaces:**
- `attachments.mjs`: `buildAskPrompt({ …, summary, question })` (the read prompt plus `<what_worca_took_from_it>` and `<question>` before the reply line); `normalizeAnswer(text)` (≤ 600; empty → `RoundError`); `mockAnswer(question)`; `pushHistory(history, entry)` (newest first, ≤ 10).
- `attachment-job.mjs`: `readAgain(owner, id, { by }, deps)`, `askAttachment(owner, id, question, { by }, deps)`, `replaceAttachment(owner, id, upload, { keepSummary = false, by }, deps)`. Replace writes the new body to a temporary file and renames it over the live one only after the row commits.

**Tests:** the ask prompt's blocks and order; answers clipped, the mock answer, the history cap; an ask stores its answer apart from the summary and books its cost; 409 `BUDGET` at the press, a limit reached before the call records a failed ask, at most 20 answers, one question at a time; read again moves an edited summary to the history and clears the mark, the answers stay, refused while reading; an unasked-for read of an edited file puts its own summary into the history (D4); Replace keeps the place and the switch, rewrites or keeps the text, moves the answers to the old version's entry, refuses a duplicate and the same bytes; a failed row update leaves the old body and row, and no temp file.

---

### Task 6: Files in the round prompts and in the brief

D2, D5 and D6: round 1 waits for a new feature's reads, every round carries `<attachments>`, a brief's documents ride in `<product_brief>` and the brief job's prompt.

**Files:**
- Modify: `src/core/requirements/attachments.mjs`, `attachment-job.mjs`, `round.mjs` (the data line and the do-not-ask rule of `ROUND_SYSTEM_PROMPT`; `roundPromptParts`), `interview.mjs` (`briefFor`, `startOrientation`, `runRound`), `brief.mjs` (`BRIEF_SYSTEM_PROMPT`'s data line; `renderBriefForPrompt`, `buildBriefPrompt`), `brief-job.mjs` (documents into the prompt; the deny rules on the brief look), `tools/requirements-replay.mjs` (its header says a replay carries no files)
- Test: modify `test/requirements-attachments.test.mjs`, `test/requirements-round.test.mjs` (the pinned system lines), `test/requirements-interview.test.mjs`, `test/requirements-brief.test.mjs`, `test/requirements-brief-job.test.mjs`

**Interfaces:**
- `attachments.mjs`: `selectInlineAttachments(rows, readText, budget)` → `Map<id, text>`; `renderAttachmentsForPrompt(rows, { texts })` (design §4's entries and states); `renderDocumentsForPrompt(rows)`; `sourceNames(files, documents)`.
- `attachment-job.mjs`: `promptFiles(f)` → `{ rows, docs, attachments, documents, sources }`.
- `round.mjs`: `roundPromptParts({ …, attachments = null })`: the block last in `stable`, only with files. `interview.mjs`: `ROUND1_WAIT_MS`; `assertCapacity()` counts only jobs not waiting for a create's reads; `runRound` calls `queueUnread` first. `brief.mjs`: `renderBriefForPrompt(sections, { provenance, documents = '' })` ("Documents:" after the four sections, outside their cap); `buildBriefPrompt({ …, documents })` (`<brief_documents>` before the working-directory line).

**Tests:** the block's text, states, the 3,000-character entry cap and the 24 KB full-text budget; documents as "<name>: <summary>"; `<attachments>` last in `stable`, `asData`-escaped; without files and documents A7's round and brief texts; two rounds with the same files share `stable`; a feature created with files reads them before round 1 and round 1 uses them; five creates whose reads end together run round 1 at most 4 at a time; waiting creates do not count against `MAX_JOBS`, and round 1 runs after `ROUND1_WAIT_MS` with a file still being read; a file the limit stopped is read when the next round starts with the budget open; the brief look carries the deny rules and gets the documents on a refresh.

---

### Task 7: Spec sources

D13: criteria, assumptions, questions and brief items may name the file or document they came from.

**Files:**
- Modify: `src/core/requirements/round.mjs` (the source rule and JSON lines of `ROUND_SYSTEM_PROMPT`; `applyRound`, `normalizeQuestions`, `mockRoundReply`), `interview.mjs` (passes `sources`), `edits.mjs` (`editCriterion`), `markdown.mjs`, `brief.mjs` (`BRIEF_SYSTEM_PROMPT`'s JSON lines; `normalizeBrief`, `parseSectionValue`, `renderBriefMarkdown`), `brief-job.mjs`
- Test: modify `test/requirements-round.test.mjs`, `test/requirements-edits.test.mjs`, `test/requirements-markdown-save.test.mjs`, `test/requirements-brief.test.mjs`, `test/requirements-brief-job.test.mjs`

**Interfaces:**
- `applyRound(prev, raw, { …, sources = [] })`: a listed name (matched case-insensitively) is stored with the listed spelling, anything else dropped; a new item keeps its source, an unedited criterion or open unedited assumption takes the reply's, an edited one keeps its own. `mockRoundReply(feature, final, { followUp, sources })`: the first criterion carries `sources[0]` (D17).
- `normalizeBrief(text, { cwds, members, sources = [] })`: users, terms and areas may carry `source`; `parseSectionValue` keeps it by name.
- `renderSpecMarkdown`, `renderTaskMarkdown`, `renderBriefMarkdown` write "(from <name>)".

**Tests:** the pinned system lines; listed names kept, others dropped; unedited items follow the reply, edited ones keep theirs; the mock source; an owner's edit keeps the source; "(from <name>)" in the Markdown and the run task; brief items keep a source among the documents and through edits.

---

### Task 8: The change rules (D8) and readiness

A file changed after the interview finished is unasked until a round carried it; Ready waits for that, and one short follow-up round asks about it.

**Files:**
- Modify: `src/core/requirements/ready.mjs`, `round.mjs` (thread lines for `file` turns and a `followup` with files; the follow-up line; the data line names the quoted file names), `interview.mjs` (`followUp`, `runRound`, `maybeFollowUpFiles`, `retry`), `attachment-job.mjs` (`promptFiles().carried`; settling and removal call `maybeFollowUpFiles`)
- Test: modify `test/requirements-ready.test.mjs`, `test/requirements-round.test.mjs`, `test/requirements-interview.test.mjs`

**Interfaces:**
- `ready.mjs`: `unaskedFiles(files, turns)` → ids (a file being read counts, `failed` and `unread-budget` do not; a later round whose payload `files` lists it asks it); `readiness(feature, { turns, target, files = [] })`: the interview check fails with "<name> to ask about" / "N files to ask about".
- A round's payload gains `files` (the files whose text it carried) and, for a follow-up, `followUpFiles`; both are absent without files, so A2's payload is unchanged.
- `roundPromptParts({ …, followUpFiles })` (design §4's follow-up line, beside the rejection line); `followUp(seq, { by, filesOnly = false }, deps)` covers unasked files; `maybeFollowUpFiles(seq, deps)` → boolean, never throws, called when a feature has nothing left to read or answer.

**Tests:** `unaskedFiles` across rounds, read states and a start; readiness hints, waiting questions first; thread lines for attached, replaced, removed and edited files (reads and asks add none); the follow-up line with and without rejections; a file added after `done` gets one follow-up round by itself after its read; when it cannot start, the file stays unasked, Ready fails and `POST …/follow-up` asks about it; no follow-up during the interview, after a start or for documents; a file being read when a round runs is not asked by it; Try again ignores `file` turns and retries a failed files follow-up.

---

### Task 9: Routes, views and server wiring

Design §5: the feature and brief file routes, the raised upload window behind the flag, the views, and boot recovery.

**Files:**
- Modify: `src/core/requirements/routes.mjs`, `attachments.mjs` (`mentions`), `attachment-job.mjs` (`fileView`), `ui/server.mjs` (the upload windows before the global 8 MB JSON parser; `recoverAttachmentReads()` after `recoverBriefs()`; `sweepReadFolders` after the requirements repo-look sweep)
- Test: create `test/requirements-attachments-api.test.mjs`; modify `test/requirements-api.test.mjs` (the route walk fills `:attId`)

**Interfaces:**
- Routes (all in `REQUIREMENTS_ROUTES`, the brief ones before `/:seq`): `POST /api/requirements` takes `attachments`; `POST /:seq/attachments`; `GET`, `PATCH { summary?, sendWithRun? }`, `DELETE /:seq/attachments/:attId`; `POST …/:attId/replace { attachments: [one], keepSummary? }`, `…/ask { question }`, `…/read-again` (202); `POST /:seq/follow-up` covers files; the same set under `/brief/:scopeType/:scopeKey/documents` with `sendWithEveryRun`; `DELETE /brief/…` also stops and removes the documents and their bodies. `:attId` must match `REQ_ATT_ID_RE` and belong to the owner, else 404.
- `REQUIREMENTS_UPLOAD_ROUTES` (the POST paths), `REQUIREMENTS_UPLOAD_JSON_LIMIT`; `STATUS.TOO_LARGE = 413`.
- `mentions(spec, name)` → criteria then assumptions whose source is the name or whose text contains it (ignoring case). `fileView(row, { spec, href, doc, estimates })` → design §5's file shape.
- `featureView` adds `attachments`, `briefDocuments`, `unaskedFiles`, `interview`, `resetPeriod` (one model resolution and one estimate read per view; readiness with the files); `briefPage` adds `documents`, `interview`, `resetPeriod`; the list adds `readEstimates`.

**Tests:** create with two files stores them, reads them before round 1, and round 1 names the first as a source; add, download (headers for text and PDF), edit, switch, remove, and the D7 / D9 refusals; replace, ask and read again answer 202, 409 while reading; busy, archived and starting refusals; brief documents need a made brief; flag off: every new route 404 and an upload is not parsed; boot turns `reading` rows into failed and removes old read folders.

---

### Task 10: The run hand-off (D14)

On Start the switched-on files and documents go to the run through the existing extras path; the start records them, and later changes show as changes since the start.

**Files:**
- Modify: `src/core/requirements/attachment-job.mjs`, `start.mjs`, `ready.mjs` (`changedSince`), `edits.mjs` (`revertToStart`), `routes.mjs`, `ui/server.mjs` (`invokeStartRun`, `startRunHandler`)
- Test: modify `test/requirements-start.test.mjs`, `test/requirements-ready.test.mjs`, `test/requirements-run-link.test.mjs`, `test/requirements-attachment-job.test.mjs`; `test/api-ask-run-extras.test.mjs` stays green

**Interfaces:**
- `runFiles(f)` → `[{ id, name, sha256, from: 'feature' | 'brief', path }]`; `withStagedRunFiles(runId, list, start, { base })`: copies into `orchestrator-extras-<runId>` under `stagedName` (the display name by `downloadFilename`'s rules: reserved device names, 200 code points and 255 UTF-8 bytes) and `uniqueStagedName` (" (2)" for a repeat, within the same caps), checks each copy against its `sha256` (a body gone or changed answers 409 naming the file; a copy that fails on the temp side while the body is intact answers 500), removes the folder after a refusal or a throw.
- `start.mjs`: readiness with the files; `startRun(body, { runId, startedBy, extrasFiles })` with `extrasFiles: [{ id, name, path, sha256 }]` only when files go; the start row's `files: [{ id, name, sha256, from }]`; a start view carries `files`.
- `invokeStartRun(…, { extrasFiles })` hands the staged paths to `startRunHandler` as `req._extrasPaths` (in-process only), used instead of `writeExtras(runId, body.extras)`.
- `changedSince(before, after, { filesBefore, filesNow })`: `{ kind: 'file', change: 'added' | 'removed' | 'replaced', name }` lines, feature files only; `revertToStart` turns the feature files' switches back (never bodies, never documents).

**Tests:** the three change lines; Start sends switched-on files and documents and records them; no `extrasFiles` key without files; a start in flight refuses Add files; Changed since the run started and Undo; the server copies the files under their display names into the run's extras folder; staging names, repeats, cleanup and the 409.

---

### Task 11: New feature with files (board 15) and the reading line

**Files:**
- Modify: `ui/public/attach-files.mjs`, `ui/public/requirements-view.mjs` (`costHint`, `paintNew`, `paint`, the reading line in `conversation`), `ui/public/style.css`
- Test: modify `test/attach-files.test.mjs`; create `test/requirements-view-files.test.mjs`; Ask's composer and drop tests stay green

**Interfaces:**
- `attach-files.mjs`: `checkAttachment(file, { pending, engine, limits, typeMessage })` (Ask's defaults unchanged); `REQ_ATTACH`, `reqLimits({ owner, create })`, `reqTypeMessage(name, ext)`.
- `requirements-view.mjs`: `sizeText(bytes)`, `uploadBatches(files)` (at most 100 MB per request), and the helpers `privacyNote(interview)`, `encodeFile(file)`, `readRange(kinds, estimates)`.

**Tests:** the Files field after Describe it with the drop zone, its limits and the privacy note naming the model (or "the interview model"); dropped and pasted files become chips; a refused one shows the amber alert and is not added; the cost words with files ("$0.05–0.20" without estimates), led by the look's part when the target has no brief; Start the interview sends the files; the feature page shows "Reading N files…" (`role="status"`) until round 1; sizes and batches; the rules sit inside the Requirements block, tokens only.

---

### Task 12: The Files card (boards 16, 17, 20)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (file view state; `fileRow`, `editBox`, `filePicker`, `uploadFiles`, `filesCard`; the right column: Ready to start?, then Files, then Spec; the header chip "N files"; the question card's "From <name>:"; What Worca knows with files), `ui/public/style.css`
- Test: modify `test/requirements-view-files.test.mjs`

**Interfaces:** view-internal, used by Tasks 13–15: `fu(id)` (a file's open editor, ask text, Show all and history fold); `fileRow(a, ctx)` with `ctx = { doc, locked, period, redraw, focus }`; `filePicker(onFiles, { multiple })`; `uploadFiles({ url, key, existing, owner, rerender }, files)`; `fileMsgs` (the last pick's refusals per owner).

**Tests:** the card's place, head, hint, Add files and privacy note; a read file's name link, "kind · size · read for $X", pencil, summary and switch with its `aria-label`; "· edited by you" and the editor (1,500 at most, Save, Cancel); reading with and without an estimate, failed with each reason and **Try again**, not read yet for a month or a week; no files yet; Add files disabled while busy or archived; the history fold at the advanced level; Add files posts accepted picks and names refused ones; "From <name>:" and "and the files below"; at 390 px the layout of board 20 with 44 px targets; tokens only.

---

### Task 13: A file's menu, Replace, Ask about this file, Read again, Remove, source tags (board 21)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`openModal`, extracted from `openStartDialog` with no change to that dialog; `fileMenu`, `openReplace`, `askPanel`; `fileRow` gains the menu and the ask panel; `srcTag` in the spec card), `ui/public/style.css`
- Test: modify `test/requirements-view-files.test.mjs`; A2's start-dialog tests stay green

**Interfaces:** `openModal(card, { trigger, first, canClose })`; `fileMenu(a, ctx)`; `openReplace(a, ctx, file)`; `askPanel(a, ctx)`; `srcTag(f, source)`.

**Tests:** the ⋯ menu named for its file with Open, Edit, Ask, Replace, Read again, a separator and Remove (red); Edit, Ask, Replace and Read again off while reading; the ask panel, its estimate, Ask posting the question, the answer line and a failed ask's line; Replace opens the picker, then the dialog, with rewrite (default) or keep only on an edited summary; Escape and Cancel close it, a refused pick never opens it; Read again confirms on an edited summary; Remove confirms; source tags link while the file exists and turn plain once it is gone; below 600 px the pencil lives in the menu.

---

### Task 14: Files for the run, the changes since a start, Ask about a new file (board 18)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`filesForRun` in `buildCard`; `changeLine`, `changedNotice`; `decideCard`, `decideNeeded`), `ui/public/style.css`
- Test: modify `test/requirements-view-files.test.mjs`; A2's Decide and changed-since tests stay green

**Interfaces:** `filesForRun(f)` → the `role="group"` row or `null` (no files and no documents).

**Tests:** the row's heading and "n of m go with it", a chip per file then "From the brief" and the documents, the notes and the mentions; a chip (`aria-pressed`) flips the file's Send with the run or the document's Send with every run; no row without files; the three file lines of Changed since the run started and the Undo note; Decide reads **Ask about <name>**, or **Ask about A-4 and <name>** with a rejection waiting; tokens only.

---

### Task 15: The brief's Documents card (board 19)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`docsCard`; `briefSide`; `briefChips`; "(from <name>)" in `briefSectionBody`; the delete confirmation in `moreMenu`), `ui/public/style.css`
- Test: modify `test/requirements-view-files.test.mjs`; A7's brief-page tests stay green

**Interfaces:** `docsCard(data, name)`, built from Task 12's `fileRow`, `filePicker`, `uploadFiles` and Task 13's `fileMenu`, with the switch **Send with every run** and the document variants of the reading and failure lines.

**Tests:** the first card of the right column with its head, hint, Add documents, rows and footer; the chip "N documents"; How Worca uses it with documents; brief items from a document end in "(from <name>)"; Add documents posts to the brief and the switch sends `sendWithEveryRun`; a brief not made yet shows board 11 unchanged; Delete the brief names its documents; tokens only.

---

### Task 16: Real-browser proof, docs, levels and the changelog

**Files:**
- Modify: `tools/verify-requirements-cdp.mjs`, `docs/requirements.md`, `docs/storage.md`, `docs/ui-levels.md`, `docs/changelog/unreleased.md`

- [ ] **Proof** (mock, with `WORCA_MOCK_READ_MS` so the reading states can be seen): New feature with two files → "Reading 2 files…" → round 1; the Files card states; a summary edit and "edited by you"; Ask and Replace; the ⋯ menu's entries; a source tag; the Ready row's chips flip the switches; Start sends the files (the run's `extras` folder holds them, the staged folder is gone); Decide's **Ask about <file>**; Remove; the brief's Documents card; at 390 px the Files card fits, its ⋯ menu holds the pencil's entry, and the hit targets are 44 px. A failing check is fixed in the task that owns the behaviour.
- [ ] **Docs:** `docs/requirements.md` gains **Files** after **Product brief** (what Worca reads and sends, the switches, the privacy note, the costs, the change rule, sources, documents; product language, short); `docs/storage.md` the `requirements/att/` bodies and the `att-read-*` folders; `docs/ui-levels.md` the rows of design §8 (**S**, the history **A**); the Requirements entry of the changelog.
- [ ] Check that docs and plans carry no local path; run `npm run verify:requirements` → all checks passed.

---

### Task 17: The capped real-read check

Mock mode skips the whole D3 path, so a manual tool proves the real one: that a replace-mode call with `Read`, a one-file folder, five turns and `ATTACHMENT_SYSTEM_PROMPT` reads a PDF and a PNG and returns parseable JSON on the pinned CLI, what happens to an image over the API's size limit, and above all that the file-read guard runs and blocks (what the PR's run showed: design §8). A trusted probe tells the model to Read a canary file outside its copy and then the copy: the canary must be refused by the guard and the copy read must work. If the guard does not block, no read path ships.

**Files:**
- Create: `tools/requirements-real-read.mjs`
- Create: `test/requirements-real-read-tool.test.mjs` (never spends)

**Interfaces:**
- `node tools/requirements-real-read.mjs [--max-usd <n>] [--probe-only] [--sandbox <dir>] [--out <file.json>] [--allow-routed] [--yes]`. Without `--yes` it is a dry run: it lists the probe and the six reads, sends nothing and makes no folder. It refuses mock mode; refuses routing to another endpoint unless `--allow-routed`, from the sources it checks: this shell's environment, the `env` block and `apiKeyHelper` / `awsAuthRefresh` / `awsCredentialExport` of Claude Code's user settings and of its managed settings (`managed-settings.json` at the platform's managed path), and Worca's model entry; it names the keys, never their values; refuses a sandbox folder the read deny rules cover. `--max-usd` (default 1.00) is a hard cap: every call gets what is left as its `--max-budget-usd`, and no call starts once nothing is left.
- The six reads go through `addAttachments` and the real runner in a sandbox `WORCA_HOME`: a small inline text, a PDF, a PNG, a text over 24 KB, an image over the API's size limit, and a text that asks the reader to open a file outside its copy.
- Exit 0: done and the guard blocked; 1: a read or check failed or the cap stopped it; 2: usage or a refusal; 3: the guard did not block.
- Exports `pdfBytes(lines)`, `pngBytes(width, height, pixel)`, `fixtures(canaryPath)`, `probeVerdict(tools, { canary, copy })`, `settingsFileRoutingKeys(path)`, `userSettingsRoutingKeys({ env, home })`, `managedSettingsPaths(platform)`, `main(argv, { log, env, home, managedPaths, runner, modelEnvOf })`.

**Tests:** mock mode refused first; the dry run calls nothing and makes no folder; a covered sandbox folder refused; the fixtures are what they claim (a real PDF and PNG, sizes over the limits, the injected escape); every call of a fake runner gets the budget left, and the tool stops at zero; routing from the shell, the Claude Code user settings (env and apiKeyHelper), its managed settings or the model entry refused before any call; the probe's verdict is `blocked` only with a refused canary Read and a working copy Read.

A reviewer can run `node tools/test.mjs test/requirements-real-read-tool.test.mjs` and `node tools/requirements-real-read.mjs` (the dry run) at no cost; a real run needs `--yes` and a signed-in Claude Code, and its report (per read: status, the summary's first line, cost, tool calls, the probe's verdict) goes into the PR description.

---

### Task 18: Whole-branch check

**Files:** whatever this task finds to fix (no new feature code).

- [ ] Merge `dev`. If it took more schema numbers, renumber this migration past them (the DDL, the rung, `test/db-migrate-v77.test.mjs` and the design's §3 note move together), and keep the pinned ledger columns in step.
- [ ] `npm test` on the branch; run every failing file on the base branch as well. A file that fails here and passes there is this branch's to fix; record both counts.
- [ ] Every test that slices `style.css` gives the same result as on the base.
- [ ] The full suite on Linux, from a clean export of the committed tree, so the POSIX-only tests run (the guard's symlink test and the runner argv through the fake claude among them); a failure that also fails on the base is not this branch's.
- [ ] `npm run verify:requirements` → all checks passed.
- [ ] Fix what is this branch's in the module of the task that owns it, its test first; commit `Requirements: whole-branch fixes` if anything changed.

---

## Appendix: design decisions and boards → tasks

| Spec point | Task(s) |
|---|---|
| D1 Send with the run / every run; "The spec mentions this file (ids)" | 1, 4 (`setSend`), 9 (`mentions`, `fileView`), 12, 15 |
| D2 New feature (reads before round 1, `ROUND1_WAIT_MS`, outside `MAX_JOBS`), the Files card, the brief's Documents | 6, 9, 11, 12, 15 |
| D3 one read per file, inline or Read in a one-file folder, the guard and deny rules | 3, 4, 17 |
| D4 the summary, edited by you, history | 1, 4, 5 |
| D5 spend, the budget before every read, retry at the next round, `MAX_READ_JOBS`, recovery and sweep | 1, 4, 6, 9 |
| D6 prompts: `<attachments>`, documents in `<product_brief>` and `<brief_documents>`, data rules, byte-identity | 6, 8 |
| D7 types and limits, their refusals, the New feature total | 2, 4, 11, 12, 17 (image size) |
| D8 change rules, follow-up, Decide | 8, 9, 14 |
| D9 storage, v77, paths from id and kind, duplicates, display names | 1, 4, 5 |
| D10 API, shared validation, the JSON window behind the flag, downloads, lock and starting refusals | 2, 5, 9, 10 |
| D11 Replace and Read again; D12 Ask about this file | 5, 13 |
| D13 sources, "(from …)" | 7, 12, 13, 15 |
| D14 runs: `extrasFiles`, staged copies, `_extrasPaths`, start `files`, changes since a start, Undo, Files for the run | 10, 14 |
| D15 privacy note, confinement, data rules, headers | 3, 4, 6, 9, 11–15, 17 |
| D16 accessibility | 11–14, 16 |
| D17 mock mode; D18 the flag | 4, 5, 7, 9, 16 |
| §3 turns and start rows; §5 views; §8 docs, levels, Linux run, real reads | 1, 4, 8, 9, 10, 16, 17, 18 |
| Boards 15 / 16–17 / 18 / 19 / 20 / 21 | 11 / 12 / 14 / 15 / 12, 13, 16 / 13 |
| "Not on the boards" (empty cards, confirmations, history, change lines, Decide label, delete-brief sentence) | 12–15 |
