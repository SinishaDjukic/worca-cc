# Requirements (A3: Feature chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A product owner can talk with Worca about the feature they are specifying, beside the spec. Worca answers from what it already knows about the feature, drafts answers to the open interview questions (they fill the question card, marked **drafted by Worca**, and are sent only by **Submit**) and proposes spec changes as cards (**Accept** applies one as the product owner's own edit, **Reject** dismisses it, a card whose target changed says so and offers **Ask again**). One message is one model call, shown per message, booked as Requirements spend and stopped by the spending limit. The chat never blocks or feeds the interview.

**Architecture:** One new module `src/core/requirements/helper.mjs` holds the chat: the pure part (system prompt, limits, the prompt builder, the strict reply check, snapshots and staleness, the mock reply) and the job part (one call per feature in `helperCalls`, a slot of A1's `MAX_JOBS` held through `interview.mjs`'s new `holdSlot()`, Stop through the call's own `AbortController`, Try again, Accept / Reject / Ask again / Clear chat, the view and the cost estimate). Storage is one new table `req_helper_messages` (v78) plus `req_cost_ledger.helper_message_id`. A call is an ordinary A1.1 `callModel(d, { kind: 'round', … })` with overrides; the round's own prompt stays byte-identical (`round.mjs` exports `threadText` and `specBlocks`). Accept goes through the existing edit functions, which gain one option `alsoInTx(fn)` so the edit and the proposal's mark commit together. The page module `ui/public/requirements-view.mjs` gains the **Feature chat** toggle, the panel (right column wider than 900 px, full-screen sheet at 900 px and narrower), Help me answer, the draft chip and the proposal cards.

**Tech Stack:** Node ESM, `node:sqlite`, `node:test`, jsdom, Express (`ui/server.mjs` → `src/core/requirements/routes.mjs`), vanilla DOM (`ui/public/*.mjs`), Claude Code CLI through A1.1's `callModel` (replace mode, hermetic flags, A1.1-D6's sign-in exception).

**Spec:** `plans/requirements-a3-design.md` (decisions D1–D20 win where this plan is unclear). A1: `plans/requirements-design.md` (A1-D<n>); A2: `plans/requirements-a2-design.md` (A2-D<n>); A1.1: `plans/requirements-a11-design.md`; A7: `plans/requirements-a7-design.md`; A8: `plans/requirements-a8-design.md` (A8-D<n>).

**Visual reference (UI tasks):** design round 4 of the Claude Design canvas "Requirements — design rounds 1 to 4": board 22 the chat open beside a feature, board 23 board 22 in the dark theme (tokens only, nothing to build), board 24 the proposal cards (cards 1–9), board 25 the phone sheet. They use upstream's classes (`card`, `btn`, `btn-sm`, `btn-primary`, `badge`, `hint`, `menu` / `menu-item`); inline styles are layout hints. Where the design doc deviates from a board the doc wins and says why; what no board shows is listed in design §6 "Not on the boards": build exactly that, nothing more.

## Global Constraints

- One commit per task; subjects start `Requirements:`; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Flag (D16).** Every new route is in `REQUIREMENTS_ROUTES` behind `requireFlag('requirements')`, so the flag-off walk of `test/requirements-api.test.mjs` covers it; replies reach the page only through the flag-checking `requirements-changed` frame (`requirementsChangeNotifier`).
- **Schema v78** (`SCHEMA_VERSION` 77 → 78): `req_helper_messages` exactly as design §3, `IF NOT EXISTS`, in `INCREMENTAL_TABLES`; `req_cost_ledger.helper_message_id INTEGER` in `INCREMENTAL_COLUMNS`; the v78 rung runs `repairSchemaGaps` after its DDL. If the base takes 78 first, the rung is renumbered as A8's was.
- **The call (D3):** one `callModel(d, { kind: 'round', … })` per message with `systemPrompt: HELPER_SYSTEM_PROMPT`, `tools: []`, `noSessionPersistence: true`, `cwd: scratchDir()`, the interview model and effort (`interviewModel(d)`, effort passed explicitly), `timeoutMs: HELPER_TIMEOUT_MS` (`180_000`) and the call's own `signal`. `CALL_KINDS` stays `look` / `round`; no new `CALL_KEYS`; every existing call's options stay byte for byte.
- **Limits:** `HELPER_LIMITS = { message: 2000, reply: 3000, why: 300, reason: 200, drafts: 3, proposals: 5, history: 12000 }`; a drafted text at most `LIMITS.item` (500); at most `MAX_QUESTIONS` (3) drafts, one per question.
- **Concurrency (D11):** one helper call per feature (`helperCalls`), holding one of `MAX_JOBS` (4) through `holdSlot()`; the chat never makes a feature busy (`isBusy` stays the interview's `jobs` only).
- **Not part of the interview (D15):** no turn kind is added; helper messages never reach `req_turns`, rounds, looks or the brief.
- **Spend (D13):** the budget is checked before every call (a refused send writes nothing); every attempt's cost is booked on the feature and in `req_cost_ledger` with `helper_message_id` and no `turn_id`, in the same transaction as Worca's row.
- **Real calls spend money:** every automated test uses a fake runner (`runClaudeImpl`) or mock mode; a capped manual real-call check exists (`tools/requirements-real-helper.mjs`, `--max-usd`).
- **Mock mode (D19, `WORCA_MOCK=1`):** no spawn, cost 0; the reply is `[mock] Worca's answer to: <message>` with, when a round is pending, a draft picking the first option of its first question that is not the recommended one, and one proposal adding the criterion `[mock] A criterion Worca suggests.`. `WORCA_MOCK_HELPER_MS` (mock only) delays a reply so the browser proof sees **Answering…** and can press **Stop** (as A8's `WORCA_MOCK_READ_MS`).
- **Prompts as data (D17):** every block goes through `asData` and is named in the system prompt's data rule; the product owner's request is only the text inside `<message>`.
- **Copy:** every user-facing string is design §2 / §6 verbatim. Where the design names none, this plan adds, in product language: "This change was already decided." · "This change is not out of date." · "Worca was already asked again about this change." · "Worca is not answering." · "There is nothing to try again." · "This message is no longer in the chat." · "This change is no longer in the chat.". Product copy never shows a raw error, a stack, a path or an HTTP status: a refusal shows the server's product message (`errText`), anything else "Worca could not finish that. Try again."; a failed call is stored with product copy only (the reason goes to the server log).
- `style.css`: tokens only (no hex, no `rgba(`); every new rule is a `req-help-*` rule inside the existing Requirements block (it ends right before `/* ── marketplace P3 ── */`), never at the end of the file. On/off controls are never green-filled: the pressed **Feature chat** button has an ink border; Accepted is green ink, never a fill.
- No local machine paths in shipped files (code, tests, docs, plans). No import from Shaper code; core modules never import `ui/server.mjs`.
- Route errors: `{ error }` with 400 / 404 / 409; a budget refusal is 409 `{ code: 'BUDGET', error }`.
- One test file: `node tools/test.mjs test/<file>.test.mjs`; each task runs its own files. Full suite: `npm test`, compared with the base branch file by file (Task 11). POSIX-only tests are skipped on Windows and run on Linux.

## Review Focus

1. **The round is unchanged.** `buildRoundPrompt` stays byte-identical (the pinned literal in `test/requirements-round.test.mjs`), `CALL_KINDS` / `CALL_KEYS` are untouched, and every existing interview, look, read and brief call keeps its options (Tasks 2, 3).
2. **The call.** A helper call reaches the runner with `systemPromptMode: 'replace'`, `HELPER_SYSTEM_PROMPT`, `tools: []`, `allowedTools: []`, `noSessionPersistence: true`, the scratch `cwd`, the interview model and effort, no `maxTurns`, and a `signal` (Task 3).
3. **Spend.** The budget before every call; every attempt booked with `helper_message_id` and no `turn_id`, with Worca's row, in one transaction; a stopped call books what the runner reported (Tasks 1, 3).
4. **Not busy, one slot.** While the helper answers the feature is not busy (Submit, edits and a round work); a held slot counts toward `MAX_JOBS` and its release wakes a waiting create (Task 3).
5. **Accept is a hand edit.** Each change kind goes through its edit function with the turn, `edited` mark and id a hand edit writes; the proposal's mark commits in the same transaction; a stale snapshot is refused on the server; refusals while a round runs, while answering, and on an archived feature (Task 4).
6. **Drafts never send themselves.** Help me answer only fills the composer; a draft fills the question card and is sent only by Submit; × returns the recommended pick; a hand pick removes the mark (Task 7).
7. **Flag off.** Every new route answers the flag gate's 404 (Task 5).

## Files

| File | Task(s) | Responsibility |
|---|---|---|
| `src/core/db.mjs` | 1 | v78: `req_helper_messages`, its index, `req_cost_ledger.helper_message_id` |
| `src/core/requirements/store.mjs`, `src/core/cost-budget.mjs` | 1 | helper message rows, helper costs; `helperMessageId` on a ledger row |
| `src/core/requirements/round.mjs`, `ready.mjs` | 2 | export `threadText`, new `specBlocks(feature)` (the round's text unchanged); export `diffList` |
| `src/core/requirements/helper.mjs` (new) | 2–5 | pure: prompt, limits, reply check, snapshots, mock; job: send, Stop, Try again, estimate, Accept / Reject / Ask again / Clear chat, the view |
| `src/core/requirements/interview.mjs` | 3 | export `assertBudget`, `scratchDir`, `briefFor`; new `holdSlot()`, `chargeHelper()`; `activeJobs()` counts held slots |
| `src/core/requirements/edits.mjs` | 4 | `setSection`, `addCriterion`, `editCriterion`, `removeCriterion`, `setAssumption` accept `alsoInTx(fn)` |
| `src/core/requirements/routes.mjs` | 5 | design §5 routes; `featureView`'s `helper` |
| `ui/public/requirements-view.mjs`, `style.css` | 6–8 | boards 22, 24, 25: toggle, panel and sheet, composer, lines, Help me answer, drafts, cards |
| `tools/verify-requirements-cdp.mjs`; `docs/requirements.md`, `storage.md`, `ui-levels.md`, `changelog/unreleased.md` | 9 | the browser proof; docs, levels, changelog |
| `tools/requirements-real-helper.mjs` (new) | 10 | the capped manual real-call check |

---

### Task 1: Schema v78, the helper's rows and helper spend

The table, the ledger column and the store rows every later task reads.

**Files:**
- Modify: `src/core/db.mjs` (`SCHEMA_VERSION`, `REQUIREMENTS_HELPER_DDL` after `REQUIREMENTS_ATTACHMENTS_DDL`, `INCREMENTAL_TABLES`, `INCREMENTAL_COLUMNS`, the v78 rung after v77's), `src/core/requirements/store.mjs`, `src/core/cost-budget.mjs`
- Test: create `test/db-migrate-v78.test.mjs`, `test/requirements-helper-store.test.mjs`; modify `test/db-migrate-v72.test.mjs` (pinned ledger columns gain `helper_message_id`)

**Interfaces:**
- `store.mjs`: `insertHelperMessage({ featureSeq, role: 'po' | 'worca', text, focus, roundTurnId, drafts, proposals, error, costUsd, model }, { by })`, `getHelperMessage(id)`, `listHelperMessages(seq)` (oldest first), `countHelperMessages(seq)` (the feature view's count, without parsing rows), `updateHelperMessage(id, patch, { by })` (fields `text drafts proposals error costUsd model`; anything else throws), `deleteHelperMessages(seq)` (rows deleted), `recentHelperCosts(limit = 10)` (amounts of the newest ledger rows with a `helper_message_id`, newest first). A row is `{ id, featureSeq, role, text, focus, roundTurnId, drafts, proposals, error, costUsd, model, createdBy, createdAt, updatedBy, updatedAt }`.
- `cost-budget.mjs`: `recordRequirementsCostDelta({ …, helperMessageId = null })`.

**Tests:** the table, its index and the column on a fresh database, one at 77, one at A8's early 75, upstream's 74–76, one from below 72, and one stamped past this version without them (repaired); a row's defaults; rows round-trip oldest first, JSON and null fields round-trip, a bad role and an unknown field are refused; a ledger row carries `helper_message_id` and no turn, and `recentHelperCosts` reads only those, newest first; clearing a feature deletes its rows and keeps its ledger rows.

---

### Task 2: The helper's prompt and the strict reply check (pure)

D4–D9 and D17 as pure functions; the round's text stays byte for byte.

**Files:**
- Modify: `src/core/requirements/round.mjs` (`threadText` exported; new `specBlocks`, used by `roundPromptParts`), `src/core/requirements/ready.mjs` (`diffList` exported)
- Create: `src/core/requirements/helper.mjs` (the pure part)
- Test: create `test/requirements-helper.test.mjs`; `test/requirements-round.test.mjs` stays green unchanged

**Interfaces:**
- `round.mjs`: `threadText(turns)`; `specBlocks(feature)` → `[currentSpecBlock, editedBlock]`, exactly the two blocks a round's changing part writes. `ready.mjs`: `diffList(before, after)` → `{ added, removed }`.
- `helper.mjs`: `HELPER_TIMEOUT_MS`, `HELPER_LIMITS`, `ASK_AGAIN_TEXT` ("Propose this again for the current spec."), `HELPER_SYSTEM_PROMPT` (design §4 verbatim); `buildHelperPrompt({ feature, context, turns, brief, attachments, pending, history, focus, message })` (`stable` from `roundPromptParts`, then `<thread>`, `<current_spec>`, `<edited_by_product_owner>`, `<open_questions>` with a pending round, `<chat>`, `<question_in_focus>` with a focus, `<message>` and the reply line); `normalizeHelperReply(raw, { spec, pending, removed })` → `{ text, drafts, proposals }` (throws `RoundError` without an object or text); `snapshotOf(spec, proposal)` (`undefined` when the target is gone), `isStale(spec, proposal)`; `mockHelperReply(pending, message)` (goes through `normalizeHelperReply` like a real reply).

**Tests:** the system prompt pinned as a literal; `stable` equals a round's for the same feature; the changing blocks in order, without open questions or focus when there is none; every block `asData`-escaped; `<chat>` lines with each proposal's state, error rows left out, the 12,000-character cut newest first then back in order with "(… N earlier messages)"; Ask again's focus block; reply text bounds; drafts for the pending round only (an exact option or a text of at most 500, one per question, at most 3); proposals per target (sections `set`, criteria `add` / `reword` / `remove`, assumptions `confirm` / `reject`), numbered from 1 with their snapshot; dropped: unknown targets and ids, assumption text, no-op changes, a criterion that exists or was removed, no reason, bad values, more than 5; staleness after a change and not after its undo, an add stale once its text is a criterion; the mock reply; `diffList`; the round's pinned prompt unchanged.

---

### Task 3: The call: Send, Stop, Try again, the slot and the spend

D3, D11–D13, D15, D19 and D20 in the job part of `helper.mjs`.

**Files:**
- Modify: `src/core/requirements/interview.mjs` (`activeJobs`, `scratchDir`, `assertBudget`, `chargeHelper` after `charge`, `briefFor`), `src/core/requirements/helper.mjs` (the job part)
- Test: create `test/requirements-helper-job.test.mjs`; modify `test/requirements-interview.test.mjs` (`holdSlot`)

**Interfaces:**
- `interview.mjs`: `scratchDir()`, `assertBudget(d)` and `briefFor(f, documents)` exported unchanged; `holdSlot()` → `release()` (BUSY "Worca is working on several features; try again in a moment." when full; the release frees once and wakes waiting creates); `chargeHelper(seq, costUsd, model, writeRow)` (one transaction: Worca's row first, then, with a positive cost, `addFeatureCost` and the ledger row with that row's id, no turn).
- `helper.mjs`: `sendMessage(seq, { text, focus }, { by }, deps)` (throws `RequirementsError` synchronously on a refusal; otherwise writes the product owner's row and returns the call's promise, which never rejects); `retryMessage(seq, { by }, deps)` (re-asks the newest message without a reply or with an error reply, D20); `stopHelper(seq)` (aborts the running call; CONFLICT "Worca is not answering." when none); `isAnswering(seq)`, `helperSettled(seq)`, `helperEstimate()` (lowest and highest of the last 10 helper costs, or `null` before any). Worca's row: `{ role: 'worca', text, roundTurnId, drafts, proposals, error: null | { code: 'BAD_REPLY' | 'TIMEOUT' | 'FAILED' | 'STOPPED' | 'BUDGET', message }, costUsd, model }`. `deps`: `runClaudeImpl`, `budget`, `onChange`, and through `interviewModel` / `callModel` the model list, the interview slot and the sign-in.
- A focus is stored as `{ roundTurnId, questionId, n }`, numbered by the server; a focus that names no pending question is dropped and the message still sent.

**Tests:** one message is one round-kind call with the helper prompt, no tools, no session, the scratch folder, the interview model and effort; no estimate before any booked call; every attempt booked on the feature and in the ledger with `helper_message_id` and no turn, and the chat writes no turn; two unreadable replies give `BAD_REPLY`, a runner failure `FAILED`, both with product copy only; a spent budget refuses the send (409 `BUDGET`) and writes nothing, and stops a second attempt; Stop aborts, keeps the message and records `STOPPED` with the reported cost; Try again re-asks without its own message in the history; mock mode spawns nothing and costs nothing, and `WORCA_MOCK_HELPER_MS` lets Stop catch it; Send and Try again refused while answering, starting, archived, or while a round or look runs; while the helper answers an edit, Submit and a round work, and the round never sees the chat; a held slot counts toward `MAX_JOBS`, a send past them is BUSY and writes nothing, the release frees it.

---

### Task 4: Proposals: Accept, Reject, Ask again, Clear chat

D7–D10 and D14: a proposal applied as the product owner's own edit, marked in the same transaction.

**Files:**
- Modify: `src/core/requirements/edits.mjs` (`setSection`, `addCriterion`, `editCriterion`, `removeCriterion`, `setAssumption`), `src/core/requirements/helper.mjs` (the decisions)
- Test: modify `test/requirements-edits.test.mjs`; create `test/requirements-helper-proposals.test.mjs`

**Interfaces:**
- `edits.mjs`: each of the five takes `{ by, alsoInTx }` and calls `alsoInTx(writtenFeature)` inside its own transaction, after the turn and the feature are written; a throw rolls both back. Without `alsoInTx` nothing changes.
- `helper.mjs`: `acceptProposal(seq, msgId, n, { by })` → the updated Worca row (refusals: `editable()`'s NOT_FOUND / BUSY / archived CONFLICT; BUSY while answering; NOT_FOUND "This message is no longer in the chat." / "This change is no longer in the chat."; CONFLICT "This change was already decided."; CONFLICT "The spec changed since Worca proposed this." when stale, D9). The proposal gains `state: 'accepted'`, `decidedBy`, `decidedAt` and, for an add, `appliedId`. `rejectProposal(seq, msgId, n, { by })` (allowed while answering; refused on an archived feature); `askAgain(seq, msgId, n, { by }, deps)` (a stale, undecided proposal only, once; then Send's refusals; sends `ASK_AGAIN_TEXT` with the focus `{ askAgain: { msgId, n } }`); `clearChat(seq)` (refused archived or while answering; deletes the feature's rows).

**Tests:** `alsoInTx` sees the written feature and a throw rolls the edit back; accepting a section is the product owner's edit with its turn and `edited` mark; a list section takes its whole new list; an added criterion gets the next `R-po` id and the card records it; reword and remove as hand edits, and a removed criterion is never proposed again; confirm and reject an assumption, and a rejected one after the interview gets A2-D4's follow-up offer; stale when the spec changed during the call (refused, stays proposed); an add whose text is now a criterion is stale, never added twice, and acceptable again once reworded away; stale after a hand edit, acceptable again after Undo, and after a start the change shows as a change since the start; Accept waits while a round runs; Accept and Clear chat wait while the helper answers, Reject does not; archived refusals; unknown messages and proposals, a decided proposal not decided again; Ask again a stale proposal only, once; Clear chat keeps accepted changes, their edit turns and the ledger rows.

---

### Task 5: The API: routes, the helper's view, the feature's `helper`

Design §5 behind the flag.

**Files:**
- Modify: `src/core/requirements/helper.mjs` (`helperView`), `src/core/requirements/routes.mjs` (`REQUIREMENTS_ROUTES`, `featureView`, the handlers)
- Test: create `test/requirements-helper-api.test.mjs`; modify `test/requirements-api.test.mjs` (the flag-off walk fills `:msgId` and `:n`)

**Interfaces:**
- `helperView(seq)` → `{ messages, answering, estimate }`; a message as design §5, a draft with `dropped`, a proposal with `stale` (computed: `proposed` and `isStale`), `added` / `removed` for a list section (D8) and `askedAgain` (a later message asked again about it).
- `dropped` is decided once, when Worca's row is written: a draft is dropped when its round was answered while Worca was still answering, and stays so; a draft the product owner keeps and submits later was used, not dropped.
- Routes: `GET` and `DELETE /api/requirements/:seq/helper`; `POST …/helper/messages { text, focus? }` (202), `…/helper/stop`, `…/helper/retry` (202); `POST …/helper/messages/:msgId/proposals/:n/accept | reject | ask-again`. Every write answers the helper body; Accept, Reject, Clear chat and the call's start and end send the feature's frame. `GET /api/requirements/:seq` carries `feature.helper = { answering, messages }` (`messages` is the count). `:msgId` must be a Worca row of this feature and `:n` one of its proposals, else 404.

**Tests:** the chat in mock mode over HTTP: send, a draft and a proposal, Accept, a used draft after Submit not dropped, Clear chat, the frames; a draft dropped only when its round was answered while Worca answered, and it stays so; the 2,000-character cap, unknown messages and proposals, Stop with nothing running, nothing to try again; while Worca answers Send and Clear chat wait, Stop keeps the message and records `STOPPED`, Try again asks it again; Ask again a stale proposal only (202) and the card says it was asked again; Worca's add is stale once the spec has its text and Accept answers 409; an archived feature's chat reads but refuses writes; flag off: every chat route answers the gate's 404.

---

### Task 6: The panel: toggle, right column and sheet, composer, lines (boards 22, 23, 25)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (the chat state; `show`, `paint`, `capture`, `conversation` (takes the moved cards); a Feature chat section before `header`; the toggle in `.req-head-tools`; `paintFeature`), `ui/public/style.css`
- Test: create `test/requirements-view-helper.test.mjs`; the page's other view tests stay green

**Interfaces:** view-internal, used by Tasks 7 and 8: `helperOpen` (per feature, for the page session), `helperData` (the last helper body), `helperUi = { text, focus, opener, error, budget }`, `helperApplied`, `helpLabel(p)`, `helperPost(f, method, path, focusUi)`, `helperExtras(f, m, ctx)`, `setComposer(text)`, `ctx = { answering, archived, locked, working, newest }`. `data-ui`: `helper-toggle`, `helper-more`, `helper-clear`, `helper-close`, `helper-back`, `helper-in`, `helper-send`, `helper-stop`, `helper-retry`, `helper-starter-<0..2>`.

**Tests:** **Feature chat** sits before Export, closed by default, `aria-pressed`; open it takes the right column and the cards move under the current card; the head, the log (`role="log"`), the first-open text and three questions that send at once; the composer's label, model and cost line (the range of the last calls, one value when they agree, "$0.05" before any), Enter sends, Shift+Enter does not, the count past 1,800; the product owner's bubble; while Worca answers: **Answering…**, Stop and the hint, Send and Clear chat wait, Stop keeps the message; a failed reply and Try again on the newest row only; the spending-limit line for the month or week; a refused send keeps the text and says why, never a raw HTTP status; the archived line in place of the composer; Clear chat asks first; Escape, Close and Back give the focus back to the toggle (not while an input method composes); live repaints keep the log, unchanged messages and the composer; a double press posts once; a reply for another feature, or for an earlier visit, changes nothing; a chat that could not be loaded shows the line and Try again; at 900 px and narrower the sheet stretches between its insets, the page behind it is inert while it is open (and freed by Back, Escape, leaving the page or widening the window), a dialog over it stays operable; the rules sit inside the Requirements block, tokens only, the pressed toggle with an ink border.

---

### Task 7: Help me answer and Worca's drafts in the question card (boards 22, 25)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`questionCard`; `helpMeAnswer`, `applyHelperDrafts`, `draftWhy`, `helperExtras`), `ui/public/style.css`
- Test: modify `test/requirements-view-helper.test.mjs`; the question card's tests stay green

**Interfaces:** the question card's `draft.drafted: { [questionId]: msgId }` (the pending card only); `data-ui` `help-<roundTurnId>-<i>` (`.req-help-ask` beside the question's text) and `undraft-<roundTurnId>-<i>` (the chip's ×); `.req-help-drafted-row`, `.req-help-drafted`, `.req-help-draft-why`, `.req-help-dropped`.

**Tests:** **Help me answer** on each pending question opens the panel with the question and its cap in the composer, and sends nothing; each button is described by its own question; the message goes with its focus and its bubble carries the cap; an earlier round being changed has none; a draft fills the question card, marked **drafted by Worca** with its reason after the options, the panel staying closed; × puts the question back to the recommended pick; a hand pick or a typed answer removes the mark, and a repaint never applies it again; Submit sends drafted answers as any answer; a draft whose round is no longer pending is not applied and its reply says it was dropped; Back keeps the drafts and a reload applies the stored draft again; the chip is dashed blue (blue means active) and Help me answer is a 44 px line on a phone.

---

### Task 8: Proposal cards (board 24) and their accessibility

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`proposalSuffix`, `proposalRows`, `proposalCard`; `helperExtras`), `ui/public/style.css`
- Test: modify `test/requirements-view-helper.test.mjs`

**Interfaces:** `.req-help-card` (`role="group"`, `aria-label` "Proposed change: <section or id>", `data-proposal` `<msgId>-<n>`, `is-proposed | is-stale | is-accepted | is-rejected`) with its head, Before / After / New / Remove / Confirm / Reject rows, "Why: …", the buttons `prop-accept-*`, `prop-reject-*`, `prop-ask-again-*` and the state line (`role="status"`) or the stale alert (`role="alert"`).

**Tests:** cards 1–3 (a section's Before / After, a reworded criterion, a rejected assumption; Why, Reject and Accept); cards 4–6 (Accepted with the id it got and a green check, Rejected, the spec changed meanwhile); a pending add shows **New** without an id; a criterion removal; an assumption confirm; a goal's changed measure reads as the spec card does; Accept, Reject and Ask again post to their proposal and fetch the feature again, a refusal shows under the composer; Accept and Ask again wait while Worca answers or a round runs, nothing is decided on an archived feature, and an asked-again card keeps only its alert; a decided card's name says so; Accept, Reject and a card going stale replace only that card; rows keep their nodes across a send and a round; a focused Reject keeps its focus when a reply lands, and after a decision the focus moves to the card; tokens only, Accepted green ink, the stale line the amber alert, 44 px targets on a phone.

---

### Task 9: Real-browser proof, docs, levels and the changelog

**Files:**
- Modify: `tools/verify-requirements-cdp.mjs`, `docs/requirements.md`, `docs/storage.md`, `docs/ui-levels.md`, `docs/changelog/unreleased.md`

- [ ] **Proof** (mock, with `WORCA_MOCK_HELPER_MS` so **Answering…** can be seen): a new feature waits for round 1 with the chat closed and **Help me answer** on each question; Help me answer → Send → a draft in the question card → Submit; a proposal accepted shows in the spec as the product owner's edit; a stale card after a hand edit and **Ask again**; Stop keeps the message; Clear chat; light, dark and 390 px (the sheet, Back, 44 px targets). A failing check is fixed in the task that owns the behaviour.
- [ ] **Docs:** `docs/requirements.md` gains **Feature chat** after **Files** (what it knows, drafts, proposed changes, costs and Stop, the chat and the interview, Clear chat; product language, short); `docs/storage.md` the `req_helper_messages` rows and the ledger column; `docs/ui-levels.md` the rows of design §8 (**S**); the Requirements entry of the changelog (one sentence, the chip, and "Requirements: Feature chat" under its pull requests).
- [ ] Check that docs and plans carry no local path; `node tools/test.mjs test/ui-levels.test.mjs` and `test/docs-site-changelog.test.mjs` pass; `npm run verify:requirements` → all checks passed.

---

### Task 10: The capped real-call check

Mock mode skips the call, so a manual tool proves the real one: that a replace-mode, no-tools helper call on the pinned CLI returns parseable JSON, what a message costs, and whether helper calls of one feature share a cached prefix (D4).

**Files:**
- Create: `tools/requirements-real-helper.mjs`
- Create: `test/requirements-real-helper-tool.test.mjs` (never spends)

**Interfaces:**
- `node tools/requirements-real-helper.mjs [--max-usd <n>] [--sandbox <dir>] [--out <file.json>] [--allow-routed] [--yes]`. Without `--yes` it is a dry run: it lists the five messages, sends nothing and makes no folder. It refuses mock mode, and refuses routing to another endpoint unless `--allow-routed`, with A8's checks imported from `tools/requirements-real-read.mjs` (this shell's environment, Claude Code's user and managed settings, Worca's model entry; key names only, never values). `--max-usd` (default 1.00) is a hard cap: every call gets what is left as its `--max-budget-usd` (the larger of the CLI's reported and Worca's booked spend is taken off), and no call starts once nothing is left.
- The fixture: a feature waiting for round 1's answers, with a made product brief and one read file (rows only, no call). The five messages: three general questions, Help me answer on question 1, and a change request, each through `sendMessage` and the real runner in a sandbox `WORCA_HOME`.
- Per call: cost, cache reads and writes, duration, whether the reply parsed, the drafts and proposals it kept. Exit 0: every reply parsed; 1: a reply failed or the cap stopped it; 2: usage, mock mode or refused routing.
- Exports `MESSAGES`, `makeFixture(store)`, `main(argv, { log, env, home, managedPaths, runner, modelEnvOf })`.

**Tests:** mock mode refused; the dry run lists the five messages, calls nothing and makes no folder; a bad cap is usage; routing in this shell refused before any call; every call of a fake runner gets the budget left, the tool stops at zero and reports cache use; a call that fails without a result event still counts, its booked cost shrinks the next budget and the run stops at the cap.

A reviewer can run `node tools/test.mjs test/requirements-real-helper-tool.test.mjs` and `node tools/requirements-real-helper.mjs` (the dry run) at no cost; a real run needs `--yes` and a signed-in Claude Code, and its report goes into the PR description.

---

### Task 11: Whole-branch check

**Files:** whatever this task finds to fix (no new feature code).

- [ ] Merge `dev`. If it took schema 78, renumber this migration past it (the rung, `test/db-migrate-v78.test.mjs` and the design's §3 note move together, with a case for a database stamped by the early numbering), and keep the pinned ledger columns in step.
- [ ] `npm test` on the branch; run every failing file on the base branch as well. A file that fails here and passes there is this branch's to fix; record both counts.
- [ ] Every test that slices `style.css` gives the same result as on the base.
- [ ] The full suite and `npm run smoke` on Linux, from a clean export of the committed tree, so the POSIX-only tests run; a failure that also fails on the base is not this branch's.
- [ ] `npm run verify:requirements` → all checks passed.
- [ ] `node --check` every `.mjs` the branch touched; no new `console.log`, `debugger`, `TODO` or `FIXME`.
- [ ] Fix what is this branch's in the module of the task that owns it, its test first; commit `Requirements: whole-branch fixes` if anything changed.
- [ ] The real-call check (Task 10) with `--yes` and a capped budget; its figures (cost per message, duration, whether each reply parsed) set the composer's starting estimate (D13) and go into the PR description.

---

## Appendix: design decisions and boards → tasks

| Spec point | Task(s) |
|---|---|
| D1 two openers, closed by default, the focus cap, never sends by itself | 3 (focus stored, numbered by the server), 6, 7, 9 |
| D2 right column wider than 900 px, cards move and go back, sheet at 900 px and narrower, Back keeps drafts | 6, 7, 9 |
| D3 one `round`-kind call per message with the helper's overrides; no new kind or key | 3 |
| D4 the prompt: a round's `stable` verbatim, the changing blocks, the 12,000-character history | 2, 3, 10 (measures the prefix) |
| D5 strict JSON reply, one retry, `BAD_REPLY` | 2, 3 |
| D6 drafts: pending round only, option or text, the chip, ×, hand pick, dropped (decided once, stored), reload re-applies | 2, 5, 7, 9 |
| D7 proposal kinds and drop rules | 2, 4 |
| D8 a list section's whole list, the card's changed lines (`diffList`) | 2, 5, 8 |
| D9 snapshot staleness, computed, server re-check; an add stale once its text is a criterion | 2, 4, 5, 8, 9 |
| D10 Accept / Reject / Ask again, `alsoInTx`, `appliedId`, edit rules, changes since a start | 4, 5, 8, 9 |
| D11 own lock, one call per feature, held slot in `MAX_JOBS`, refusals, feature never busy | 3, 4, 6, 8 |
| D12 Stop | 3, 5, 6, 9 |
| D13 budget before every call, booking, estimate and cost line | 1, 3, 5, 6, 11 |
| D14 storage v78, Clear chat | 1, 4, 5, 6, 9 |
| D15 the chat is not part of the interview | 3 |
| D16 archived reads, refused writes; the flag | 3, 4, 5, 6, 8 |
| D17 `asData` everywhere, no tools | 2, 3 |
| D18 `role="log"`, group / alert / status, names, 44 px, Enter / Shift+Enter, Escape | 6, 7, 8, 9 |
| D19 mock mode; D20 restarts, Try again on the newest row | 2, 3, 6, 9 |
| §3 data; §4 prompts; §5 API | 1; 2; 5 |
| Boards 22 / 23 / 24 / 25 | 6, 7 / 6 (tokens) / 8 / 6, 7, 9 |
| "Not on the boards" (stopped line, refused send, character count, Ask again's bubble) | 6, 8 |
| §8 testing: Linux run, real calls | 11, 10 |
