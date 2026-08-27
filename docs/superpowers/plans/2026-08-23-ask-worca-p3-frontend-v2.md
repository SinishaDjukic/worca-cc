# Ask Worca P3 — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The browser side of the Ask Worca assistant chat — a floating ⌘K sheet (`ask-panel.mjs` + `ask-model.mjs` + `ask-markdown.mjs`), its CSS, seven surgical `app.js` seams, and the Settings "Ask Worca" section — against the P1+P2 server already implemented on this branch.

**Architecture:** Three new self-contained ES modules under `ui/public/` (a DOM-free thread model / frame reducer, a sandboxed markdown renderer over the P2-vendored `marked`+`dompurify`, and a single-factory panel that builds all markup with DOM APIs), mounted by ~40 additive lines in `app.js`. Live turns stream over the existing WS broadcast as stamped `ask-*` job frames deduped by per-job `seq`; recovery is always REST re-fetch + ring-buffer replay. Nothing in `index.html` changes except the Settings card; no server code changes at all.

**Tech Stack:** Vanilla ES modules, node:test + jsdom 29 (offline, `WORCA_MOCK=1` for the two app-boot suites), `marked@18.0.10` + `dompurify@3.4.14` served from the P2 vendor routes, the app's existing hljs loader.

**Spec:** `docs/superpowers/specs/2026-08-22-ask-worca-design.md` rev 2.1 — §10 (frontend), §12 "UI" tests, §13 (mockup deviations), §17 (binding appendix). **That file is untracked and therefore ABSENT in a pipeline worktree — this plan is self-contained and never requires reading it.** Where this plan quotes a contract (routes, frames, block shapes, notice strings) the quote was verified against the as-built code at `dbb47f68` on 2026-08-23; the as-built code is the authority.

**v2 (2026-08-23):** both executed dry-runs (D1: Tasks 0-5 deep + 24 mutations; D2: Tasks 0-13 full + 14 mutations) are folded in — every snippet in this revision ran green in a clone at `dbb47f68`; the interval-hang, sanitizer, guardrails-envelope and prefill-clobber defects of v1 are fixed here; counts are measured. Survivor mutations M1/M10/M21/M1b are closed by the four added/extended tests.

**Base:** branch `worca-cc/ask-worca-p2-server-implementation-plan-70aea22b`, HEAD `dbb47f68` ("worca: Implement Ask Worca P2 Server", = dev `79dc9256` + P1 `1b02d87b` + P2). Every `file:line` in this plan was read at that commit. P1/P2 touched **zero** files under `ui/public/` — the frontend surface is greenfield.

## Global Constraints

- **Namespace:** everything is `ask` — files `ui/public/ask-*.mjs`, CSS `.ask-*`, data attributes `data-ask-*`, localStorage `worca-cc.ask.*`. The words `chat` and `channel` are reserved (messenger subsystem / pipeline bus) and must not be used for anything new. NB the identifier prefix `ask` is already taken inside `app.js` by the agent-questions feature (`askQuestions`, `asksQuestions`, `.run-ask-banner`, `.sic-ask`) — new app.js identifiers use `askPanel*` / `newPipelinePrefill`, and every CSS/test regex over `.ask-` must be anchored (the `ruleBody` helper below), or it matches `.run-ask-banner`.
- **Locked decisions D1–D15 and the §13 mockup deviations are binding** and restated inline where they matter. Do not re-open them.
- **No server / core changes.** `ui/server.mjs`, `src/core/**`, `package.json`, `package-lock.json` are all read-only for P3 (the §16 letter lists "dependency pins" under P3; the adjudicated single-lockfile-owner override moved them to P2, where they shipped: `marked@18.0.10`, `dompurify@3.4.14`, exact pins, `package.json:54,56`).
- **No `index.html` change except the Settings card (Task 12).** The panel is built in JS and appended to `document.body`; `test/ui-shell.test.mjs:8` counts the raw substring `data-view` (must stay 14) — even an HTML comment containing it goes red.
- **No network at boot.** The panel performs zero fetches until the sheet first opens (catalog + stored thread) or a frame/`hello` arrives. Empirically verified: one unguarded boot `fetch('/api/ask/threads')` failed 24 of 28 tests across 3 sampled suites — the 86 app-booting suites use a generic catch-all fetch stub, so the failure is a *shape* error surfacing as an unhandled rejection attributed to unrelated tests.
- **CSS: tokens only.** Zero 6-digit hex literals in the new ask section (`var(--token)` for every colour; `rgba(25,25,27,…)` shadows and 3-digit `#fff` are exempt from the fence). `test/ui-theme.test.mjs:61-72` pins six hexes to appear *exactly once* in the raw file, comments included: `#FEF7EC #FEFAF3 #F5D9A8 #D6D6D2 #8C7FD6 #B5751A`.
- **Keyframes:** reuse `wr-rise` / `wr-pulse` by name — three tests pin each `@keyframes` to a single declaration (`ui-theme:76`, `ui-running-detail:621`, `ui-running-routing:520`). All `animation:wr-*` uses must sit before the FINAL reduced-motion block (`ui-theme:80-93` ordering fence).
- **Test conventions:** `node:test` `test()` only (no describe/it), `import assert from 'node:assert/strict'`, files `test/<topic>.test.mjs`, servers always `listen(0, '127.0.0.1')`, bounded waits via a hand-rolled `waitFor(pred, ms)` polling 15 ms. **No shared UI boot harness** — the house convention is copying the boot preamble verbatim per suite with a header comment naming its source file:lines (`test/ui-running-routing.test.mjs:12-16` states it). `--test-force-exit` on RED runs only; green runs must exit by themselves.
- **Timers:** any interval the panel starts must be cleared on terminal states and owned by the factory; nothing at module scope (`app.js:14253`'s `.unref()` comment explains why — a leaked timer hangs all 86 app-booting suites).
- **jsdom 29.1.1 facts (probed):** no `requestAnimationFrame`, no `DataTransfer` (constructor throws), no `matchMedia`/`ResizeObserver`/`structuredClone`/`Element.animate`/`scrollIntoView`; `File` + `File.prototype.arrayBuffer` work; `defineProperty(input,'files')` works and `change` listeners see the injected list; `getSelection()` exists (collapsed); `scrollHeight`/`clientHeight` are 0 but redefinable, `scrollTop` plain-writable; `focus({preventScroll:true})` works.
- **Suite baseline at `dbb47f68`: 3230 pass / 0 fail / 0 skip (~71 s, node v25.6.1)** after `npm ci`. Per-task counts are MEASURED by the executed dry-runs (plus the three survivor-killer tests added in v2); the re-execution pass confirms them.
- **`npm ci` is mandatory before any test run in a fresh worktree.** The author's main checkout demonstrates the failure: `package.json` pins marked+dompurify but `node_modules` lacks them → the two `/vendor` routes silently unregister and `test/api-ask-vendor-assets.test.mjs` (no skip guard) goes red for a reason unrelated to P3.

---
## Verified facts (P3-F1…F14) — measured at `dbb47f68`, binding

| # | fact | consequence |
|---|---|---|
| P3-F1 | P1/P2 changed nothing under `ui/public/` (`git diff --stat 79dc9256 dbb47f68 -- ui/public/` is empty). app.js = 14271 lines, index.html = 1381, style.css = 2820. | Spec §10.2 anchors hold with three cosmetic drifts: `if (!msg.runId) return;` is at `app.js:603-604` (comment+return; the insert anchor is the agentgen block at `:566` either way); the Running Escape handler is `:12483-12493`; the final reduced-motion `@media` is at `style.css:2804` (its section comment at :2799). |
| P3-F2 | The WS client URL is bare `/ws` (`app.js:298-300`); the client never uses `?threadId=` connects. Subscribe rides the open socket: `{type:'subscribe', threadId}` (server `ui/server.mjs:307-310`). Frames are **broadcast to every socket** (`:359-371`, `:3030`); subscribing only triggers a **ring-buffer replay** (`:3018-3020`). | The panel filters by `threadId` itself; subscribe = replay request, not a data tap. |
| P3-F3 | Replay is not idempotent server-side: the guard is `askJobs.has(threadId)` — a job finished ≤30 s ago (grace window) replays its FULL buffer including `ask-done`; a second subscribe replays everything again. `seq` starts at 1, per-job monotonic; buffer cap 5000 frames with splice eviction (`:2992,3025-3032`). | Client-side `seq ≤ lastSeq` dropping from frame one; a replayed `ask-done` must not look like a fresh completion; a seq gap ⇒ REST re-fetch + resubscribe. |
| P3-F4 | Job frames all carry `{threadId, messageId, seq}`; out-of-turn frames (`ask-message`/`ask-title`/`ask-run-status`) carry `threadId` only. The user-message echo is an out-of-turn `ask-message` broadcast BEFORE the turn's job frames. | **The job-frame discriminator is `typeof frame.seq === 'number'`**, never the `ask-` prefix alone (P2's `ask-api-messages.test.mjs:71-78` comment). |
| P3-F5 | `ask-usage.costUsd` is ALWAYS present and is `null` until a `result` frame (mock: 0). `ask-done` has no `effort` key; `reason` key only when truthy; `threadTotals` is `null` if the thread was deleted mid-turn. `ask-error.errorClass` is omitted only when strictly `undefined` (the mock's `errorClass:null` IS present). | The live meter renders tokens during the stream and takes cost from `ask-done.threadTotals`; never print `$0.00` from a null. |
| P3-F6 | Mid-turn, the streaming assistant row is persisted with `text:''` — only cards/notices are persisted mid-turn (`src/core/ask/turn.mjs:112-117`). `finishMessage` then overwrites all 7 columns. A mid-turn GET therefore cannot restore the answer text. | Recovery is GET → `load()` → subscribe-replay from seq 1 (rebuilds the text); `ask-done.text` is the final authority (also heals a ring-evicted prefix). |
| P3-F7 | Card flips: `flipCard` (`ui/server.mjs:3463-3473`) patches the store (whitelist `['state','runId','error']` — the `card` payload is never mutated) and then EITHER re-emits a stamped `ask-card` job frame (turn still streaming) OR broadcasts the whole message as out-of-turn `ask-message` (settled message). | The card builder's `update` runs on both paths: `ask-card` dirt AND whole-row replacement. Local field edits survive `proposed`-state patches (only state/runId/error can change); a non-`proposed` state re-renders the read-only/stub form. |
| P3-F8 | Follower notice texts are frozen strings rendered VERBATIM (`src/core/ask/follow.mjs:38-43,66-83`; started notice lives in the `/api/run` seam `ui/server.mjs:1106-1107`): `Run started — "<title>"` · `Run "<title>" is waiting for your answer (<kind>)` · `Run failed: <message>` · `Run finished — "<name>" · <status>[ · <dur>][ · <cost>]`. All four `href` = `#running/<runId>` (runs-Map UUID). | P3 renders `block.text` / `message.text` as-is, never re-formats. The aria-live "run needs an answer" announcement keys off `/is waiting for your answer/`. |
| P3-F9 | The limit-stop notice strings are `` `Stopped: reached the $${maxBudgetUsd} per-turn cap (Settings → Ask Worca)` `` / `` `Stopped: reached the ${maxTurns}-turn limit (Settings → Ask Worca)` `` (`turn.mjs:211-217`; defaults 2 / 40). | The fixture helper reproduces them for the stopped scenarios. |
| P3-F10 | Mock (`WORCA_MOCK=1`) echo: the `[worca context]` header is stripped and the answer is `` `[mock] ${first non-empty line of the user text, ≤200 chars}` ``. Scenario regexes over the USER text: `/\b(propose|start|run)\b/i` (card), `/\bagents?\b/i`, `\bMOCK_FAIL\b`, `\bMOCK_MAX_TURNS\b`, `\bMOCK_MAX_BUDGET\b`, `\bMOCK_SLOW\b` (300 ms/frame). An empty page context makes the propose scenario's card FAIL validation (`unknown projectKey "mock-project-00000000"`) → a "Proposal rejected: …" notice instead of a card. | Integration tests choose message texts to avoid accidental scenario words (`start`/`run` in a card-free test text triggers the card path). |
| P3-F11 | Tool-block `input` is NOT redacted (only clipped to ≤2 KB as `{_truncated:true, preview}`); block `error` and agent `log` lines are redacted; delta batches are redacted per batch; `ask-done.text` is redacted. | Render `input` (or `preview`) verbatim in mono; no client-side redaction exists or is added. |
| P3-F12 | The committed fixtures `test/fixtures/ask/*.jsonl` replayed through `createTurnReducer({onFrame, setTimeout:(fn)=>(fn(),1), clearTimeout(){}})` emit ONLY `ask-label` / `ask-delta` / `ask-block` / `ask-usage` (+`ask-card` via `onProposal`) as BARE frames. `ask-start`/`ask-done`/`ask-error` and every out-of-turn frame are stamped by turn.mjs/routes — UI tests synthesize them (Task 1's helper). Fixture inventory: `plain-text` (answer "pong"), `tool-list-runs`, `task-subagent` (agent hydrates to `{model:'claude-haiku-4-5', tokens:5321, usage:{input:10,output:69,cacheRead:4564,cacheCreation:678}, costUsd≈0.0017, estimated:true, log:[{t:0,'→ list_runs {}'},{t:1,'← ok 0.0s'}]}`), `propose-run`, `max-turns` (`finish()` → `status:'stopped', reason:'max_turns'`), `max-budget`, `bogus-resume` (not exposed to the UI — it reaches the panel only as `ask-error`). | The Task 1 helper is the single fixture entry point for all UI suites; hand-authored `stampFrames` arrays are the right tool for card flips, `ask-error`, out-of-turn frames and gap sequences (the "never hand-write fixtures" rule governs the captured CLI files, not test frame arrays). |
| P3-F13 | Agent/`tokens` arithmetic: an agent's `tokens` = input+output+cacheRead+cacheCreation (fixture: 10+69+4564+678 = 5321). Sub-agent cost is an estimate — always render with the `≈` prefix (spec §10.5/§13; the mockup omits it, spec wins). | Meter formatting: `fmtTokens(n)` = `n<1000 ? `${n} tok` : `${(n/1000).toFixed(1)}k tok``; `fmtUsd` = `$${x.toFixed(2)}`; agents `${n} agent${n===1?'':'s'}`. |
| P3-F14 | `marked.esm.js` has NO default export (use `mod.marked`); `purify.es.mjs` default-exports a factory called with a window. jsdom parse+sanitize→fragment cost: 16 KB ≈ 14 ms, 64 KB ≈ 50 ms, 200 KB ≈ 137 ms (linear, sanitize dominates; a real browser is 3–5× faster). | The streaming re-render uses a size ladder (Task 5); >200 KB renders plain (spec §10.7). |

## As-built P2 server contract (inlined; authority = code at `dbb47f68`)

**REST** (`ui/server.mjs`, loopback-guarded; ids `ASK_ID_RE = /^[a-z]+_[0-9a-f]{8}$/`; malformed id → 400 `{error:'invalid <thread|attachment|card> id'}`):

| route | notes P3 relies on |
|---|---|
| `GET /api/ask/threads?limit=50` | `{threads:[…]}` rows `{id, title\|null, createdAt, updatedAt, model\|null, effort\|null, sessionId\|null, context\|null, totals:{costUsd,input,output,cacheRead,cacheCreation,turns,agents}, runLinks:<count>, inFlight:<bool>}` newest first; `limit` clamped to 200, malformed → 50 |
| `POST /api/ask/threads {title?}` | **201** `{thread}`; empty title → `null` |
| `GET /api/ask/threads/:id` | `{thread, messages, attachments, runLinks, inFlight:{messageId}\|null}`; `messages[].blocks` is a parsed ARRAY or `null`; message rows `{id, threadId, seq, role, text, blocks, status, reason, model, effort, usage\|null, costUsd\|null, durationMs\|null, createdAt}` ordered by seq; runLinks rows `{threadId, runId, pipelineId\|null, cardId\|null, status\|null, phase\|null, createdAt}` |
| `PATCH /api/ask/threads/:id {title}` | non-empty ≤120 → `{thread}` |
| `DELETE /api/ask/threads/:id` | `{ok:true}`; aborts turn, detaches followers, cascades, `rm -rf` |
| `POST /api/ask/threads/:id/messages` | body `{text, model, effort, context?, attachments?:[{name,dataBase64}]}` → **202 `{userMessageId, assistantMessageId}`**. Validation ORDER: shape-400 → 404 → **409 `{error:'turn in flight'}`** → **429 `{error:'at most 3 turns may run at once'}`** → 400 text/model/effort/context → attachment 400s → **413** (`attachment over 524288 bytes: <name>` / `attachment budget for this thread exceeded`). **409/429 fire BEFORE body validation.** |
| `POST /api/ask/threads/:id/stop` | `{ok:true}` ALWAYS after shape check (no 404) |
| `POST /api/ask/threads/:id/cards/:cardId {state:'dismissed'}` | order: thread-404 → 400 `state must be "dismissed"` → card-404 → **409 `{error:'card is <state>'}`** → `{block}` |
| `GET /api/ask/threads/:id/attachments/:attId` | `text/plain; charset=utf-8` + nosniff + `Content-Disposition: inline` |
| `GET /api/ask/models` | `{models:[{id,label,efforts,custom:false\|'global'}], efforts:['medium','high','xhigh','max']}` |
| `POST /api/run` + `{askThreadId, askCardId}` | both-or-neither; unknown thread/card → **400** (`unknown askThreadId` / `unknown askCardId`, NOT 404); non-proposed card → 409 `card is <state>`; success → plain 200 `{runId}`. Sync between wireRun and announceRun: link row → card flip `started` → system "Run started" message + broadcast → follower attach. A TOCTOU failure inside that block is logged and swallowed — **the run still starts and `{runId}` is still returned**. |
| `GET/POST /api/settings` | carries `askMaxTurns` (default 40, int 1–500; `''`/null clears to default) and `askMaxBudgetUsd` (default 2, 0.1–100; **stored `null` = no cap**, `''` clears to default 2 — Q&A 4). An ask-only POST never clears `root`. |

**WS:** `hello` = `{type:'hello', runs:…, ask:[{threadId, messageId}]}` (running turns only; possibly `undefined` from an older server — guard). Job frames (buffered, replayed, stamped `{threadId, messageId, seq}`): `ask-start {userMessageId, model, effort, startedAt:ISO}` · `ask-label {label}` · `ask-delta {text}` (batched ≤50 ms/256 chars) · `ask-block {block}` · `ask-card {block}` · `ask-usage {usage:{input,output,cacheRead,cacheCreation}, costUsd}` · `ask-done {text, blocks, usage, costUsd, durationMs, model, status:'done'|'stopped', reason?, threadTotals}` · `ask-error {message, errorClass?}`. Out-of-turn (NOT buffered, upsert by own key): `ask-message {threadId, message}` (WHOLE persisted row — user echo, system notices, card-flip refresh) · `ask-title {threadId, title}` (only the D13 background replacement; the deterministic first title has NO frame — the panel sets it locally) · `ask-run-status {threadId, runId, pipelineId, cardId, status, phase}` (any field may be null = "no change"; can broadcast with an empty patch).

**Block shapes** (`ask_messages.blocks`, one vocabulary live + persisted):
```
{kind:'tool',   id, name, input, status:'running'|'done'|'error', durationMs, error?}
   input is the original object OR {_truncated:true, preview:string} — render preview verbatim, mono
{kind:'agent',  id, label, type, model, tokens, usage, costUsd, estimated:true, status, durationMs, log:[{t,text}]}
   model/tokens/usage/costUsd are null while running
{kind:'card',   id, state:'proposed'|'started'|'dismissed'|'failed', card:{...15 keys...}, runId?, error?}
   card keys: target, projectKey, projectName, projectDir, workspaceId, workspaceName,
              members (workspace: [{projectKey,projectName,projectDir}]), workflowId, workflowName,
              guardrailsId, brief, title, sourceBranch, featureBranch, sourceBranchByKey
{kind:'notice', text, href?}
{kind:'attachment', id, name, bytes}      -- on user messages
```

**Server-derived activity labels** (`ask-label`; the client never guesses): `Thinking` · `Finding runs` · `Reading run <id>` · `Looking at workflows` · `Preparing a run` · `Reading <name>` · `Running N sub-agent(s)` (singular at 1) · `Writing`. On completion the CLIENT renders `Worked for <elapsed>` / `Stopped after <elapsed>` from `ask-done`.

---
## Module architecture (binding — adjudicated; tasks implement exactly this)

### `ui/public/ask-model.mjs` — DOM-free thread model

`createThreadModel({threadId})` → `Object.freeze({threadId, load(snapshot), apply(frame), takeDirty(), messages(), thread(), totals(), inFlight(), live(), runLinks(), attachmentsBytes(), findCard(cardId), noteLocalUserMessage({id,text,attachments})})`.

`apply(frame)` returns `{ok:true}` | `{dropped:'other-thread'|'stale-seq'|'terminal-message'|'no-live'}` | `{gap:true}`. Rules (in order):
1. `frame.threadId !== threadId` → `other-thread`.
2. `typeof frame.seq === 'number'` → job frame: (a) target row already terminal (`done|stopped|error`) → `terminal-message`; (b) live turn for this `messageId`: `seq ≤ lastSeq` → `stale-seq`; `seq > lastSeq+1` → `{gap:true}` (frame NOT applied — the panel resyncs; the model never latches); else apply, `lastSeq = seq`; (c) no live but `frame.type==='ask-start'` → create/adopt the streaming row, `live = {…, lastSeq: frame.seq}`; (d) no live but the snapshot said `inFlight` for this messageId → **adoption**: accept the frame at whatever seq it carries (ring eviction; `ask-done.text` heals the missing prefix); (e) otherwise `no-live`.
3. No `seq` → out-of-turn: `ask-message` upserts the WHOLE row by `message.id` (replace in place; new rows insert sorted by row `seq`, seq-less optimistic rows append); `ask-title` sets `thread.title`; `ask-run-status` merges into `runLinks` by `runId` with **null = no change** per field.

Frame application: `ask-start` → streaming row `{id: messageId, role:'assistant', text:'', blocks:[], status:'streaming', model, effort}`, `live = {messageId, userMessageId, label:'Thinking', startedAt, lastSeq, text:'', usage:null, costUsd:null}`; `ask-delta` → `live.text += text`; `ask-label` → `live.label`; `ask-block`/`ask-card` → upsert into the streaming row's `blocks` by `block.id` (replace-or-append, order preserved); `ask-usage` → `live.usage/costUsd`; `ask-done` → row gets `{text, blocks, usage, costUsd, durationMs, status, reason}` from the payload (payload text REPLACES the accumulation), `thread.totals = threadTotals ?? thread.totals`, `live = null`, `inFlight = null`; `ask-error` → row `{status:'error', text: live.text, errorMessage: frame.message}`, `live = null`, `inFlight = null`. While a row is streaming the PANEL renders `live().text`, not `row.text` (protects against a mid-turn whole-row `ask-message` upsert whose persisted text is `''`, P3-F6).

Dirty descriptor (drained once per flush): `{structure:bool, messages:Set<id>, blocks:Map<messageId,Set<blockId>>, answer:Set<id>, label:bool, meters:bool, title:bool, runLinks:bool}`.

### `ui/public/ask-markdown.mjs`

`createMarkdownRenderer({doc, load, hljsLoader})` → `Object.freeze({ensure(), isReady(), isFailed(), render(text), highlight(container)})`. `ensure()` starts the lazy `load()` once per attempt, ≤3 attempts (the `MAX_RESOURCE_FAILURES` precedent, `hljs-loader.mjs:45`) then a PERMANENT plain latch. One DOMPurify instance from `doc.defaultView`, reused; no parse cache. `render(text)` is sync → `{kind:'md', frag}` | `{kind:'plain'}` (not ready / failed / >200 000 chars). Pipeline: `marked.parse(text,{gfm:true,breaks:true,async:false})` → `DOMPurify.sanitize(html, {ALLOWED_TAGS:[p,br,strong,em,del,code,pre,ul,ol,li,a,h1-h6,blockquote,hr,table,thead,tbody,tr,th,td,input], ALLOWED_ATTR:[href,class,type,checked,disabled,align], ALLOWED_URI_REGEXP:/^(?:https?:|mailto:|#)/i, ADD_URI_SAFE_ATTR:['type','align'], RETURN_DOM_FRAGMENT:true})` → post-pass: classes re-validated (`language-*` on `code`, hljs-shaped classes on `span`, everything else stripped); `http(s)`/`mailto` anchors get `target="_blank" rel="noopener noreferrer"`, `#…` untouched; non-checkbox `input` removed, checkbox inputs forced `disabled`. `highlight(container)` runs on `ask-done` only: fence language → alias table → `SUPPORTED_LANGUAGE_IDS` → `hljsLoader.forLanguage(lang)` → the `hdApplyHighlights` staging discipline verbatim (`app.js:11235-11259`): stage into a detached holder, reject unless `holder.textContent === source` and every descendant is a SPAN whose only attribute is a valid class, commit with `replaceChildren`.

### `ui/public/ask-panel.mjs` — single factory closure

`createAskPanel({doc, win, fetch, sendWs, confirm, getPageContext, openNewPipeline, loadMarkdown, hljsLoader, storage, raf, now})` → `Object.freeze({root, open, close, toggle, isOpen, pushServerFrame, onHello, ownsKey, destroy})` (spec §10.1 verbatim). All state in the factory closure (`st`); nothing at module scope. Internal sections and the names tasks reference: shell (`buildRoot/openSheet/closeSheet/toggleSheet/destroy/announce/focusComposer`), keys (`onDocKeydown/onDocPointerdown/ownsKey/isToggleCombo`), popover primitive (`createPopover`), popovers (`openThreadsPopover/openRunInfoPopover/openModelPopover/loadCatalog`), composer (`buildComposer/sendMessage/addFiles/renderChips/setComposerMsg/updateSendStop/stopTurn`), transcript (`renderTranscript/buildMessage/buildUserMessage/buildActivity/toolRow/agentRow/buildAnswer/buildCard/collectCardBody/startCard/dismissCard/prefillFromCard/buildNotice/buildErrorLine`), flush (`scheduleFlush/flush/renderAnswerNow/updateMeters/startElapsed/stopElapsed/tickElapsed`), scroll (`updatePinFromScroll/applyPin/jumpToLatest`), glue (`pushServerFrame/subscribe/resync/onHello/loadThread/switchThread/newThread/ensureFirstOpen`), storage (`readStoredModel/storeModel/readStoredThread/storeThread`).

**Binding behaviours** (adjudicated verdicts, restated where each task lands):
- **V1** one `createThreadModel` instance, bound to the active thread, created lazily, swapped on switch, kept while the sheet is closed. Frames for other threads are dropped by the model's `threadId` filter — the panel holds no other models (the threads popover re-fetches on open).
- **V2** streaming answer: full markdown re-render from the accumulated text, only when dirty, size ladder — ≤32 KB every flush; >32 KB at most one re-render per 250 ms (injected `now`); >200 000 chars plain pre-wrap. Highlight on `ask-done` only. Selection guard: skip the re-render when `win.getSelection()` has `rangeCount>0 && !isCollapsed` and either endpoint is inside the answer element; keep the message dirty and re-arm the flush.
- **V3** schedule-on-dirty: one armed `raf(flush)` at a time; `flush` re-arms itself only when the selection guard left dirt. Elapsed: one `setInterval(tickElapsed, 1000)` started on send / on subscribing to an in-flight thread, cleared on done/error/stop.
- **V4** popovers: `div.ask-pop.<class>` `role="menu"`, absolutely positioned inside the sheet with fixed per-popover CSS offsets (no measurement — the only scheme testable under jsdom). `role="menuitem"` buttons, roving `tabindex`, Arrow/Home/End move, Enter/Space activate, Escape → close + focus trigger (handled by the doc-level keydown, not per-popover), click-away via the sheet's single capture pointerdown. One popover at a time; "More models ›"/"Effort ›" are in-panel pane swaps.
- **V5** `ownsKey(e) = e.key==='Escape' && isOpen() && (root.contains(e.target) || root.contains(doc.activeElement))` — pure, no side effects, true even with no popover open (owned no-op). ⌘K is not part of it. While `confirmModal` is up, focus sits in `#confirm-modal` (outside root, `app.js:6726`) → false, and the existing modal guards in both app.js Escape handlers already return.
- **V6** `pinned` computed in the scroll listener (`scrollHeight - scrollTop - clientHeight < 24`); `flush()` ends with `applyPin()`; the Jump-to-latest pill's `hidden = pinned`. Re-pin (`pinned = true` + flush) on open and after `loadThread`; `applyPin` only runs with the sheet unhidden (a hidden sheet has no geometry).
- **V7** card edits live in the DOM only (uncontrolled inputs); `collectCardBody` reads them at Start/prefill time. `update(next)`: still `proposed` → do NOT touch the fields; any other state → re-render the read-only/stub form. Start errors (400/403/409 bodies) render verbatim in `.ask-card-err`, Start re-enabled, fields untouched.
- **V8** `worca-cc.ask.model` (`{model,effort}`, default `{claude-opus-5, high}`) read once at factory, written per selection, validated when the catalog first loads (unknown → default). Catalog fetched on FIRST sheet open, cached for the page life. `worca-cc.ask.thread` read at factory, loaded on first open (GET 404 → drop key, start empty), written on switch/create, removed on delete-current; "New thread" clears it until the next send.
- **V9** attachments client-side pre-POST: `accept` list + name re-check, dedupe by name (newest wins), max 8, `File.size` > 524 288 rejected before reading, 4 MB thread budget best-effort (server attachment bytes + pending). The server response body is the authority and renders verbatim in `.ask-composer-msg`.
- **V10** prefill = the card's CURRENT DOM values: `{target, projectDir?, workspaceId?, workflowId, guardrailsId, prompt, title, sourceBranch ('' = auto), featureBranch, sourceBranchByKey?}`.
- **Thread load ordering:** `loadThread` = GET → `model.load(snapshot)` → `renderTranscript()` → THEN `subscribe(threadId)` when `snapshot.inFlight` is non-null. Never subscribe before load — the replay would be consumed and then wiped. `resync()` (on `{gap:true}`) is latched: one in flight at a time, released when it completes.
- **Send flow:** no thread yet → `POST /api/ask/threads {}` (201) first, store the id + `storeThread`. Then `POST …/messages` with `{text, model, effort, context: getPageContext(), attachments}` → 202 → `model.noteLocalUserMessage(...)` (optimistic; the echo `ask-message` replaces it by id), set the deterministic header title locally from the first text (no frame exists for it), `startElapsed`, subscribe if this socket hasn't. Non-202 → response error verbatim in `.ask-composer-msg` (409 "turn in flight", 429, 400s, 413s).

## Visual reference (mockup-derived; spec §10.3-§10.6/§13 win on conflict)

The mockup (`~/Downloads/Ask Worca chat interface/Ask Worca.dc.html`, 1:1 px) maps ENTIRELY onto existing tokens — the ask CSS introduces **zero new colour tokens**: `#FFFFFF→--panel · #19191B→--ink · #5C5C63→--ink-2 · #9A9AA1→--ink-3 · #B7B7BC→--seq · #ECECEA→--line · #E3E3E0→--line-2 · #F6F6F4→--field · #8C7FD6→--violet · #5BAE5B→--green · #2F7A38→--green-ink · #3782A8→--blue-ink · #C5483A/#FBE3E0→--red-ink/--red-bg`. The mockup's black-button hover `#2E2E31` is NOT added — use the app convention `filter:brightness(1.08)` on `var(--ink)` (`.btn-primary:hover`, `style.css:499-500`). Fonts = `var(--sans)`/`var(--mono)` exactly.

Key measurements (Task 9 uses these; deviations §13 already applied): sheet `width:min(782px,100%); height:min(669px,calc(100% - 20px)); radius 24px (--r-card); border 1px --line-2; shadow 0 18px 60px rgba(25,25,27,.14), 0 2px 6px rgba(25,25,27,.06)`; header `padding:13px 14px 13px 16px; border-bottom 1px --line; title 600 13px; 30×30 icon buttons radius 9px hover --field`; transcript `padding:18px 20px 8px; gap 16px`; composer `border-top 1px --line; padding:10px 12px 11px; textarea 400 13.5px/1.6, max-height 120px; 31×31 send (black circle) / stop (1.5px --line border circle)`; pill `padding:11px 18px 11px 14px; border 1.5px --line-2; radius 999; 600 13.5px; kbd chip 400 10.5px mono --field/--ink-3 radius 7`; user bubble `--field, radius 16/16/4/16, max-width 78%, padding 10px 14px, 400 13.5px/1.6`; activity gutter `1.5px solid --line, padding-left 14px, gap 7px; dot 6px (--violet pulse → --green); label 500 12px --ink-2; elapsed 400 11px mono --ink-3; meter 400 10.5px mono --ink-3`; tool row `op 38px uppercase 400 10px mono ls .06em --ink-3 · target 400 11.5px mono --ink-2 ellipsis · note 400 10.5px mono --seq`; agent row `padding 5px 7px radius 9 hover --field; name 400 11.5px mono --ink; status word 500 10.5px (--green-ink done else --ink-3)`; **spec overrides the mockup row content: `name · model · tokens · ≈$ · status` all ON the row**; log panel `margin-left 22px, border 1px --line radius 11, header strip 400 10px mono, body max-height 104px --field 400 10.5px/1.75 mono, timestamps mm:ss --seq`; answer `max-width 92%, 400 13.5px/1.72`; card `border 1.5px --line radius 16; buttons: Not now = ghost pill 600 12px --ink-2 hover --field; Start = black pill 600 12px --panel on --ink`; popovers `--panel, border 1px --line-2, radius 16-18, padding 6-7px; rows radius 10-12 hover --field; caption 600 10px ls .12em uppercase --ink-3`; threads meter `18.4k tok · $0.21 · 3 agents` (middots); composer meter `19.6k tok | $0.25 | 6 agents` (pipes coloured --line-2, agents segment is the run-info button); jump pill floating `top:-40px` above the composer, 600 11.5px, radius 999.

**Undesigned — authored from scratch in Task 9 (no mockup reference exists):** `.ask-md` markdown typography (derive from the History-detail panes; hljs colour vars widened `.hd-diff-pane,.ask-md{…}`), notice (`--ink-3` + `--blue-ink` link) and error (`--red-ink`) lines, the full card form (selects/textarea/branch fields — mockup shows only a compact suggest row), user-bubble attachment pills (`.extra-pill` family with `padding-right:12px` restated — no ×), empty-thread state (plain empty transcript), focus rings (`outline:2px solid var(--ink); outline-offset:2px` house convention).

---
## app.js / index.html / style.css anchor table (read at `dbb47f68`)

| site | anchor | note |
|---|---|---|
| boot block end | `app.js:14255-14271` (`showView` call :14268; file ends :14271) | mount appends AFTER :14271 (EOF — no collision) |
| `handleServerMessage` | `:541-603`; agentgen branch closes `:566`; `if (!msg.runId) return;` at **:603** | ask branch inserted after :566 |
| `onHello` | `:697-764`; backfill loop closes `:753`; then `refreshAllCounts()` :755 | insert after :753 |
| `sendWs` idiom | `:6936-6937` (`const ws = state.ws; if (ws && state.wsReady) …`) | resolve socket at call time |
| WS connect | `:298-340` — URL bare `/ws`, no query; `state.helloSubscribed` reset per socket `:315` | panel keeps its own per-socket subscribe memo |
| History Escape (capture) | `:12463-12477`; `e.key !== 'Escape'` check `:12464` | guard inserted after :12464 |
| Running Escape (capture) | `:12483-12493`; check `:12484` | guard inserted after :12484 |
| `confirmModal` | def `:6714-6749`; options `{title,message,confirmLabel,cancelLabel,checkbox,danger}` → `Promise<boolean>`; steals focus `:6726`, never restores | panel restores focus after the promise settles |
| `applySidebarCollapsed` | `:367-406`; toggles `.sidebar.collapsed` `:369`; boot call `:429` | `body.rail-collapsed` toggle added after :369 |
| body-flag precedent | `:14147-14148` (`view-history`/`view-running`) | |
| `parseHash` | `:766-770` → `[view, param]`, split at FIRST `/` | |
| `runs` Map | `:1162`; entry fields incl. `kind:'run'|'workspace-run'`, `pipelineId` (null until persisted), `workspaceId`, `projectDir` | |
| `parseHistDetailParam` | `:9985-9992` → `{projectKey, id, workspace}`; workspace key = `workspaces/<id>` | |
| `selectedProjectPath` | `:5335-5338` (abs path or `''`) | |
| `state.runTarget` / `state.selectedWorkspaceId` | `:34` / `:33` | |
| `showView('new')` arm | `:14183` — `if (name === 'new') { loadTaskSources(); applyBudgetToNewView(); refreshMentionHighlights(); }` | prefill applied at end of arm |
| `setRunTarget` | `:5645-5684` — writes `localStorage['worca-cc.runTarget']`; workspace arm calls `ensureWorkspaceOptions()` (async) | |
| `syncSourceToggle` | `:4646-4654`; forcing "prompt" needs 3 steps: `state.activePluginSource=null`, check the `prompt` radio, fix `#source-seg` `.on` classes (`:4658-4672` shows the reset) | |
| `onProjectChanged` | `:5388-5401` — persists `worca-cc.lastProject`, `loadConfig`, `refreshBranches`; programmatic `.value=` fires no change event | |
| `refreshMentionHighlights` | `:5245-5248` | call after setting `#prompt` |
| `loadWorkflowsInto(selectId)` / `loadGuardrailsInto(selectId)` | `:3063-3084` / `:3114-3141` — async, take the DESIRED id, fall back silently | re-read `state.workflowId`/`state.guardrailsId` after |
| `#advanced-config` | `index.html:286`, `el.advancedConfig` `app.js:145` | `.open = true` |
| `refreshBranches` | `:5447-5453` — **early-returns when `state.runTarget==='workspace'`** | prefill order: setRunTarget → select → onProjectChanged → await → `#sourceBranch` |
| workspace member sources | `renderWorkspaceSourceBranches` `:5716-5759` — `select.ws-src-select` keyed `dataset.projectKey`, async, rebuilt on workspace change | New Pipeline uses `<select>`; the ask CARD deliberately uses text `<input>` per member (it cannot lazily fetch branches — documented deviation) |
| `/api/run` body builder | `:7071-7115` — `guardrailsId` omitted when `'permissive'` (the CARD instead sends it ALWAYS, spec §9.4); workspace: `delete body.sourceBranch`, `sourceBranchByKey` omitted when empty | card body deep-equal tests copy these conventions |
| `beginRun` | `:7176-7193` — navigates (`showView('running')` :7191) | **never called by the card**; the rail picks the run up from `run-created` (`:606-621`) |
| `renderProjectOptions` | `:5357-5386` — option.value = path, `(missing)` suffix, calls `onProjectChanged()` :5385 | |
| `workflowPickerLabel` | import `./results-view.mjs` (`app.js:62`; def `results-view.mjs:115`) | second arg `[]` = suffix-free |
| `__worcaTestHooks` | read once `app.js:90` (`window.__worcaTestHooks?.hljsLoader ?? …`) | `askMarkdown` follows the identical idiom at the mount |
| Settings view | `index.html:1115-1220`; budget card `:1157-1205`; chat card `:1207-1219` | ask card inserted between `:1205` and `:1207` |
| Settings app.js | `el` entries `:195-209`; `saveSettings` posts ONLY `{root, projectsRoot}` `:7316-7337`; budget arm `:7443-7513`; `loadSettings` arm `:14182` | ask keys = their own POST (budget pattern) |
| style.css tokens | `:10-49` (single `:root`) | |
| final reduced-motion | comment `:2799`, `@media` `:2804-2820` | ask CSS inserted BEFORE the comment; `.ask-dock *{animation:none !important;}` added INSIDE the :2804 block |
| hljs vars | `:1877-1884` `.hd-diff-pane{--hd-syntax-…}` | selector widened to `.hd-diff-pane,.ask-md` |
| rail widths | `.sidebar` 298px `:77-86`; `.sidebar.collapsed` 76px `:2624-2625`; `@media (max-width:1080px)` hides the rail `:919-923` | |
| z-index | tabs 5 · sheet **40** (new) · `.viewer-modal` 50 `:929` · `#confirm-modal` 60 `:933` · `.info-bubble`/`.mention-popup`/`.chart-tip` 70 | z-70 trio paints above the sheet by design (`chart-tip` is `pointer-events:none`) |
| `.extra-pill` | `:397-404` (asymmetric `padding:4px 6px 4px 12px` — right slot is the ×'s) | no-× variant restates `padding-right:12px` |
| `.sr-only` | `:1603-1604` (global) | reused for the aria-live line — no new CSS |
| `wr-rise`/`wr-pulse` | `:2263-2266`; timing idioms `.3s cubic-bezier(.2,.7,.3,1) both` (`:2414`) and `1.6s ease-in-out infinite` (`:2342`) | referenced by name only |

## Task DAG

```
T0 (env) ─▶ T1 (helper+model) ─▶ T4 ─▶ T5 ─▶ T6, T7, T8
            T2 (markdown) ──────▶ T4          │    │
            T3 (shell+popover) ─▶ T4          ▼    ▼
            {T3..T8} ─▶ T9 (CSS)      T10 (seams+integration) ─▶ T11 (prefill+card)
            T12 (settings) — independent, scheduled last
```

Suite is green after every task. §12's single "ask-panel" test name is satisfied by the `ask-panel*` family (house convention: many focused files; per-task files avoid cross-task merge hazards). `ui/public/*.mjs` module suites are UNPREFIXED (`ask-model.test.mjs`, like `diff-view.test.mjs`); app-boot suites carry `ui-` (`ui-ask-integration`). T10 is the only task touching code the regression fences boot.

---

### Task 0: Environment check (no commit)

**Files:** none (verification only).

- [ ] **Step 0.1** Verify the tree: `git rev-parse HEAD` must print `dbb47f684e8511df0aba7ecd5a1966827d477716` (or a descendant whose diff against it touches none of the files this plan anchors on — if it differs, STOP and re-verify the anchor table). `git status --porcelain` clean (untracked `docs/`/`marketing/` entries are fine).
- [ ] **Step 0.2** `npm ci` (mandatory — see Global Constraints; `node_modules/marked` + `node_modules/dompurify` must exist afterwards: `node -e "import('marked').then(m=>console.log(typeof m.marked))"` prints `function`).
- [ ] **Step 0.3** Baseline: `npm test` → expect **3230 pass / 0 fail / 0 skip** (≈70-90 s). A different pass count means the base moved — STOP and report; do not "fix" unrelated reds.
- [ ] **Step 0.4** Confirm node ≥22.13 (`node --version`; measured v25.6.1).

No branch is created here — the execution vehicle (orchestrator worktree or manual) decides branch handling; this plan is vehicle-agnostic.

---
### Task 1: Fixture-frame helper + thread model (`ask-model.mjs`)

**Files:**
- Create: `test/helpers/ask-frames.mjs`
- Create: `ui/public/ask-model.mjs`
- Test: `test/ask-model.test.mjs`

**Interfaces:**
- Consumes: `src/core/ask/events.mjs#createTurnReducer` (P1, unchanged), `test/fixtures/ask/*.jsonl` (P1, committed).
- Produces: `stampFrames(bare, {threadId, messageId, seqStart=1})` → stamped array; `replayFixture(name, opts)` → `{frames, summary}` where `frames` = `[stamped ask-start, …stamped reducer frames…, stamped ask-done]`; `createThreadModel({threadId})` → the frozen API of the architecture section. Every later UI task consumes both.

- [ ] **Step 1.1: Write the helper** (not a test itself — the suites of every later task import it; `test/helpers/` is outside the `test/*.mjs` runner glob).

```js
// test/helpers/ask-frames.mjs — build realistic ask-* frame streams for UI tests.
//
// The committed fixtures (test/fixtures/ask/*.jsonl) are RAW claude stream-json
// frames, not ask-* frames (spec §17 "P3 FIXTURE FRAMES"). Replaying one through
// createTurnReducer yields the BARE job frames the reducer emits (ask-label /
// ask-delta / ask-block / ask-usage, + ask-card via onProposal); turn.mjs owns
// ask-start / ask-done / ask-error and the server stamps {threadId, messageId,
// seq}. This helper reproduces both sides so a UI test gets exactly what the
// panel would see on the wire. Hand-authored arrays through stampFrames() are
// the right tool for card flips, ask-error, out-of-turn frames and gap
// sequences — the "never hand-write fixtures" rule covers the captured CLI
// files, not test frame arrays.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTurnReducer } from '../../src/core/ask/events.mjs';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/ask/', import.meta.url));

export function stampFrames(bare, { threadId, messageId, seqStart = 1 } = {}) {
  let seq = seqStart;
  return bare.map((f) => ({ ...f, threadId, messageId, seq: seq++ }));
}

export function replayFixture(name, {
  threadId = 'ask_11111111',
  messageId = 'askm_00000001',
  userMessageId = 'askm_u0000001',
  model = 'claude-haiku-4-5',
  effort = 'high',
  threadTotals = null,
  card = null,
  cardId = 'card_00000001',
} = {}) {
  const lines = readFileSync(`${FIXTURE_DIR}${name}.jsonl`, 'utf8').split('\n').filter(Boolean);
  const raws = lines.map((l) => JSON.parse(l));
  const bare = [];
  const reducer = createTurnReducer({
    onFrame: (f) => bare.push(f),
    // turn.mjs's proposal hook validates then addBlock()s the card; the helper
    // mirrors the success path when the caller supplies a card payload.
    onProposal: () => {
      if (card) reducer.addBlock({ kind: 'card', id: cardId, state: 'proposed', card });
      return null;
    },
    setTimeout: (fn) => (fn(), 1),
    clearTimeout() {},
  });
  const init = raws.find((f) => f.type === 'system' && f.subtype === 'init');
  if (init) reducer.push({ type: 'session', sessionId: init.session_id });
  for (const raw of raws) reducer.push({ type: raw.type, raw }); // envelope, never bare (ask-events-fixtures.test.mjs:20-28)
  reducer.flush();
  // turn.mjs adds the limit notice BEFORE finish() (turn.mjs:211-217, defaults 40 / $2).
  const sub = reducer.snapshot().resultSubtype || '';
  if (/error_max_budget/.test(sub)) {
    reducer.addBlock({ kind: 'notice', text: 'Stopped: reached the $2 per-turn cap (Settings → Ask Worca)' });
  } else if (/error_max_turns/.test(sub)) {
    reducer.addBlock({ kind: 'notice', text: 'Stopped: reached the 40-turn limit (Settings → Ask Worca)' });
  }
  const summary = reducer.finish();
  const start = { type: 'ask-start', userMessageId, model, effort, startedAt: '2026-08-23T00:00:00.000Z' };
  const done = {
    type: 'ask-done',
    text: summary.text,
    blocks: summary.blocks,
    usage: summary.usage,
    costUsd: summary.costUsd,
    durationMs: summary.durationMs ?? 0,
    model,
    status: summary.status,
    ...(summary.reason ? { reason: summary.reason } : {}),
    threadTotals,
  };
  return { frames: stampFrames([start, ...bare, done], { threadId, messageId }), summary };
}
```

- [ ] **Step 1.2: Write the failing tests** — `test/ask-model.test.mjs`. The full file:

```js
// test/ask-model.test.mjs — DOM-free thread model (spec §10.1 ask-model, §10.8
// replay rules). Frames come from test/helpers/ask-frames.mjs; no jsdom needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createThreadModel } from '../ui/public/ask-model.mjs';
import { replayFixture, stampFrames } from './helpers/ask-frames.mjs';

const TID = 'ask_11111111';
const MID = 'askm_00000001';

function snapshot({ inFlight = null, messages = [], title = null, totals = {} } = {}) {
  return {
    thread: { id: TID, title, createdAt: 't0', updatedAt: 't0', model: null, effort: null, sessionId: null, context: null, totals },
    messages,
    attachments: [],
    runLinks: [],
    inFlight,
  };
}

function doneRow(id, seq, text = 'earlier answer') {
  return { id, threadId: TID, seq, role: 'assistant', text, blocks: [], status: 'done', reason: null, model: 'm', effort: 'high', usage: null, costUsd: 0, durationMs: 5, createdAt: 't1' };
}

test('ask-model: frames for another thread are dropped', () => {
  const m = createThreadModel({ threadId: TID });
  const r = m.apply({ type: 'ask-delta', text: 'x', threadId: 'ask_ffffffff', messageId: MID, seq: 1 });
  assert.deepEqual(r, { dropped: 'other-thread' });
  assert.equal(m.messages().length, 0);
});

test('ask-model: plain-text fixture replay builds one done assistant row', () => {
  const m = createThreadModel({ threadId: TID });
  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID });
  for (const f of frames) assert.deepEqual(m.apply(f), { ok: true });
  const rows = m.messages();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, MID);
  assert.equal(rows[0].status, 'done');
  assert.equal(rows[0].text, 'pong');
  assert.equal(m.live(), null);
  assert.equal(m.inFlight(), null);
});

test('ask-model: replaying the same stamped frames is a no-op (seq dedupe)', () => {
  const m = createThreadModel({ threadId: TID });
  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID });
  for (const f of frames) m.apply(f);
  const before = JSON.stringify(m.messages());
  const results = frames.map((f) => m.apply(f));
  // every replayed frame is dropped — stale seq or terminal row, never applied
  assert.ok(results.every((r) => r.dropped));
  assert.equal(JSON.stringify(m.messages()), before);
});

test('ask-model: job frames for a terminal message are ignored', () => {
  const m = createThreadModel({ threadId: TID });
  m.load(snapshot({ messages: [doneRow(MID, 2)] }));
  const r = m.apply({ type: 'ask-delta', text: 'late', threadId: TID, messageId: MID, seq: 9 });
  assert.deepEqual(r, { dropped: 'terminal-message' });
  assert.equal(m.messages()[0].text, 'earlier answer');
});

test('ask-model: a seq gap is reported and the frame is not applied', () => {
  const m = createThreadModel({ threadId: TID });
  const [start] = stampFrames([{ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' }], { threadId: TID, messageId: MID });
  assert.deepEqual(m.apply(start), { ok: true });
  const r = m.apply({ type: 'ask-delta', text: 'skipped ahead', threadId: TID, messageId: MID, seq: 3 });
  assert.deepEqual(r, { gap: true });
  assert.equal(m.live().text, '');
  // seq 2 still applies afterwards — the gap report did not consume the counter
  assert.deepEqual(m.apply({ type: 'ask-delta', text: 'ok', threadId: TID, messageId: MID, seq: 2 }), { ok: true });
  assert.equal(m.live().text, 'ok');
});

test('ask-model: adoption — after load(inFlight) the first frame is accepted at any seq', () => {
  const m = createThreadModel({ threadId: TID });
  m.load(snapshot({ inFlight: { messageId: MID } }));
  const r = m.apply({ type: 'ask-delta', text: 'tail of the answer', threadId: TID, messageId: MID, seq: 41 });
  assert.deepEqual(r, { ok: true });
  assert.equal(m.live().text, 'tail of the answer');
  // ask-done heals the missing prefix: payload text replaces the accumulation
  m.apply({ type: 'ask-done', text: 'the whole answer', blocks: [], usage: { input: 1, output: 2, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.01, durationMs: 9, model: 'm', status: 'done', threadTotals: { costUsd: 0.01, turns: 1 }, threadId: TID, messageId: MID, seq: 42 });
  assert.equal(m.messages()[0].text, 'the whole answer');
  assert.deepEqual(m.thread().totals, { costUsd: 0.01, turns: 1 });
});

test('ask-model: frames with no live turn and no inFlight are dropped', () => {
  const m = createThreadModel({ threadId: TID });
  const r = m.apply({ type: 'ask-delta', text: 'orphan', threadId: TID, messageId: MID, seq: 7 });
  assert.deepEqual(r, { dropped: 'no-live' });
});
```
```js
test('ask-model: out-of-turn ask-message upserts by id and replaces the optimistic row', () => {
  const m = createThreadModel({ threadId: TID });
  m.noteLocalUserMessage({ id: 'askm_u0000001', text: 'hello', attachments: [{ name: 'a.md', bytes: 10 }] });
  assert.equal(m.messages().length, 1);
  assert.equal(m.messages()[0].blocks[0].kind, 'attachment');
  const persisted = { id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'hello', blocks: [{ kind: 'attachment', id: 'att_00000001', name: 'a.md', bytes: 10 }], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't1' };
  assert.deepEqual(m.apply({ type: 'ask-message', threadId: TID, message: persisted }), { ok: true });
  assert.equal(m.messages().length, 1);
  assert.equal(m.messages()[0].seq, 1);
  assert.equal(m.messages()[0].blocks[0].id, 'att_00000001');
});

test('ask-model: ask-message inserts new rows in seq order', () => {
  const m = createThreadModel({ threadId: TID });
  m.load(snapshot({ messages: [doneRow('askm_00000002', 2)] }));
  m.apply({ type: 'ask-message', threadId: TID, message: { ...doneRow('askm_00000001', 1), role: 'user' } });
  assert.deepEqual(m.messages().map((r) => r.id), ['askm_00000001', 'askm_00000002']);
});

test('ask-model: ask-title and ask-run-status upsert; null run-status fields mean no change', () => {
  const m = createThreadModel({ threadId: TID });
  m.load(snapshot({ title: 'first title' }));
  m.apply({ type: 'ask-title', threadId: TID, title: 'A better title' });
  assert.equal(m.thread().title, 'A better title');
  m.apply({ type: 'ask-run-status', threadId: TID, runId: 'r1', pipelineId: 'abcd1234', cardId: 'card_00000001', status: 'running', phase: 'plan' });
  m.apply({ type: 'ask-run-status', threadId: TID, runId: 'r1', pipelineId: null, cardId: null, status: null, phase: null });
  assert.deepEqual(m.runLinks().get('r1'), { pipelineId: 'abcd1234', cardId: 'card_00000001', status: 'running', phase: 'plan' });
});

test('ask-model: load() round-trips the snapshot', () => {
  const m = createThreadModel({ threadId: TID });
  const rows = [doneRow('askm_00000001', 1), doneRow('askm_00000002', 2)];
  m.load(snapshot({ messages: rows, title: 'T', totals: { costUsd: 1, turns: 2 } }));
  assert.deepEqual(m.messages(), rows);
  assert.equal(m.thread().title, 'T');
  assert.deepEqual(m.totals(), { costUsd: 1, turns: 2, live: null });
});

test('ask-model: totals() overlays the live turn usage', () => {
  const m = createThreadModel({ threadId: TID });
  const bare = [
    { type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-usage', usage: { input: 5, output: 7, cacheRead: 0, cacheCreation: 0 }, costUsd: null },
  ];
  for (const f of stampFrames(bare, { threadId: TID, messageId: MID })) m.apply(f);
  const t = m.totals();
  assert.deepEqual(t.live, { usage: { input: 5, output: 7, cacheRead: 0, cacheCreation: 0 }, costUsd: null });
});

test('ask-model: tool blocks upsert in place through the tool-list-runs fixture', () => {
  const m = createThreadModel({ threadId: TID });
  const { frames } = replayFixture('tool-list-runs', { threadId: TID, messageId: MID });
  for (const f of frames) m.apply(f);
  const row = m.messages()[0];
  const tools = row.blocks.filter((b) => b.kind === 'tool');
  assert.ok(tools.length >= 1);
  assert.equal(tools[0].status, 'done');
  assert.equal(tools[0].name, 'mcp__worca__list_runs');
});

test('ask-model: agent block hydrates by id through the task-subagent fixture', () => {
  const m = createThreadModel({ threadId: TID });
  const { frames } = replayFixture('task-subagent', { threadId: TID, messageId: MID });
  let sawRunningAgent = false;
  for (const f of frames) {
    m.apply(f);
    const row = m.messages()[0];
    const agent = row && (row.blocks || []).find((b) => b.kind === 'agent');
    if (agent && agent.status === 'running') sawRunningAgent = true;
  }
  const agent = m.messages()[0].blocks.find((b) => b.kind === 'agent');
  assert.ok(sawRunningAgent, 'agent block streamed as running before finishing');
  assert.equal(agent.status, 'done');
  assert.equal(agent.tokens, 5321);
  assert.equal(agent.estimated, true);
  assert.ok(Array.isArray(agent.log) && agent.log.length >= 2);
});

test('ask-model: propose-run fixture with a card yields a proposed card block; findCard sees it', () => {
  const m = createThreadModel({ threadId: TID });
  const card = { target: 'project', projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/tmp/proj', workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal', brief: 'do it', title: 'Do it', sourceBranch: '', featureBranch: 'worca/do-it', sourceBranchByKey: null, workspaceId: null, workspaceName: null, members: null };
  const { frames } = replayFixture('propose-run', { threadId: TID, messageId: MID, card, cardId: 'card_00000001' });
  assert.ok(frames.some((f) => f.type === 'ask-card'));
  for (const f of frames) m.apply(f);
  const found = m.findCard('card_00000001');
  assert.ok(found);
  assert.equal(found.block.state, 'proposed');
  assert.equal(found.block.card.brief, 'do it');
  assert.equal(found.message.id, MID);
});

test('ask-model: max-turns fixture ends stopped with the limit notice appended', () => {
  const m = createThreadModel({ threadId: TID });
  const { frames } = replayFixture('max-turns', { threadId: TID, messageId: MID });
  for (const f of frames) m.apply(f);
  const row = m.messages()[0];
  assert.equal(row.status, 'stopped');
  assert.equal(row.reason, 'max_turns');
  const notice = row.blocks.find((b) => b.kind === 'notice');
  assert.match(notice.text, /^Stopped: reached the 40-turn limit/);
});

test('ask-model: ask-error finalizes with the accumulated partial text', () => {
  const m = createThreadModel({ threadId: TID });
  const bare = [
    { type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-delta', text: 'partial ' },
    { type: 'ask-delta', text: 'answer' },
    { type: 'ask-error', message: 'claude exited with code 1: boom', errorClass: null },
  ];
  for (const f of stampFrames(bare, { threadId: TID, messageId: MID })) m.apply(f);
  const row = m.messages()[0];
  assert.equal(row.status, 'error');
  assert.equal(row.text, 'partial answer');
  assert.equal(row.errorMessage, 'claude exited with code 1: boom');
  assert.equal(m.live(), null);
});

test('ask-model: dirty tracking drains once and is per-kind', () => {
  const m = createThreadModel({ threadId: TID });
  const bare = [
    { type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-label', label: 'Finding runs' },
    { type: 'ask-delta', text: 'x' },
    { type: 'ask-block', block: { kind: 'tool', id: 'toolu_1', name: 'mcp__worca__list_runs', input: {}, status: 'running', durationMs: null } },
    { type: 'ask-usage', usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: null },
  ];
  for (const f of stampFrames(bare, { threadId: TID, messageId: MID })) m.apply(f);
  const d = m.takeDirty();
  assert.equal(d.structure, true);           // the streaming row appeared
  assert.equal(d.label, true);
  assert.equal(d.meters, true);
  assert.ok(d.answer.has(MID));
  assert.ok(d.blocks.get(MID).has('toolu_1'));
  const d2 = m.takeDirty();
  assert.equal(d2.structure, false);
  assert.equal(d2.answer.size, 0);
  assert.equal(d2.blocks.size, 0);
});

test('ask-model: a replayed ask-start after progress is stale, not a reset', () => {
  const m = createThreadModel({ threadId: TID });
  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID });
  // apply everything but the terminal ask-done, then replay ask-start (seq 1)
  const nonTerminal = frames.filter((f) => f.type !== 'ask-done');
  for (const f of nonTerminal) m.apply(f);
  const before = m.live().text;
  assert.deepEqual(m.apply(frames[0]), { dropped: 'stale-seq' });
  assert.equal(m.live().text, before);
});

test('ask-model: unknown ask-* job frame types consume their seq silently', () => {
  const m = createThreadModel({ threadId: TID });
  const bare = [
    { type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-future-frame', payload: 1 },
    { type: 'ask-delta', text: 'still fine' },
  ];
  const stamped = stampFrames(bare, { threadId: TID, messageId: MID });
  assert.deepEqual(m.apply(stamped[0]), { ok: true });
  assert.deepEqual(m.apply(stamped[1]), { ok: true });
  assert.deepEqual(m.apply(stamped[2]), { ok: true });
  assert.equal(m.live().text, 'still fine');
});

test('ask-model: a frame re-delivered at the SAME seq is dropped, not applied twice', () => {
  const m = createThreadModel({ threadId: TID });
  const stamped = stampFrames([
    { type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-delta', text: 'once' },
  ], { threadId: TID, messageId: MID });
  for (const f of stamped) m.apply(f);
  assert.deepEqual(m.apply(stamped[1]), { dropped: 'stale-seq' }, 'seq === lastSeq is stale');
  assert.equal(m.live().text, 'once');
});
```

- [ ] **Step 1.3: Run the tests to verify they fail**

Run: `node --disable-warning=ExperimentalWarning --test --test-force-exit test/ask-model.test.mjs`
Expected: the file fails to load: node:test reports `tests 1 / fail 1` with `ERR_MODULE_NOT_FOUND … ui/public/ask-model.mjs` (the helper resolves — it only touches P1 modules).
- [ ] **Step 1.4: Implement `ui/public/ask-model.mjs`** — the full module:

```js
// ui/public/ask-model.mjs — DOM-free thread model + ask-* frame reducer for the
// Ask Worca panel (spec §10.1). One instance per open thread; the panel swaps
// instances on thread switch. Everything lives in the factory closure — the
// module is evaluated once per test file even though app.js is re-imported with
// a cache-buster, so module scope must stay empty of state.
//
// Frame classes (spec §6.6 / the P2→P3 contract): job frames carry
// {threadId, messageId, seq} and are deduped by the per-job monotonic seq;
// out-of-turn frames (ask-message / ask-title / ask-run-status) upsert by their
// own key. A seq gap is REPORTED ({gap:true}), never healed here — the panel
// re-fetches the thread over REST and resubscribes (spec §10.8).

const TERMINAL = new Set(['done', 'stopped', 'error']);

export function createThreadModel({ threadId }) {
  let thread = { id: threadId, title: null, model: null, effort: null, totals: {}, updatedAt: null };
  let rows = [];
  let attachments = [];
  const links = new Map();
  let live = null;
  let inFlight = null;
  let dirty = newDirty();

  function newDirty() {
    return { structure: false, messages: new Set(), blocks: new Map(), answer: new Set(), label: false, meters: false, title: false, runLinks: false };
  }

  function rowById(id) {
    for (const r of rows) if (r && r.id === id) return r;
    return null;
  }

  function upsertRow(message) {
    const i = rows.findIndex((r) => r && r.id === message.id);
    if (i >= 0) {
      rows[i] = message;
    } else {
      const seq = typeof message.seq === 'number' ? message.seq : Infinity;
      const at = rows.findIndex((r) => (typeof r.seq === 'number' ? r.seq : Infinity) > seq);
      if (at === -1) rows.push(message);
      else rows.splice(at, 0, message);
    }
    dirty.structure = true;
  }

  function markBlockDirty(messageId, blockId) {
    if (!dirty.blocks.has(messageId)) dirty.blocks.set(messageId, new Set());
    dirty.blocks.get(messageId).add(blockId);
  }

  function ensureStreamingRow(messageId, base = {}) {
    let row = rowById(messageId);
    if (!row) {
      row = {
        id: messageId, threadId, seq: undefined, role: 'assistant', text: '', blocks: [],
        status: 'streaming', reason: null, model: base.model ?? null, effort: base.effort ?? null,
        usage: null, costUsd: null, durationMs: null, createdAt: base.startedAt ?? null,
      };
      upsertRow(row);
    }
    if (!Array.isArray(row.blocks)) row.blocks = [];
    return row;
  }

  function upsertBlock(row, block) {
    const i = row.blocks.findIndex((b) => b && b.id === block.id);
    if (i >= 0) row.blocks[i] = block;
    else row.blocks.push(block);
  }

  function finalizeDone(row, frame) {
    row.text = frame.text ?? '';
    row.blocks = Array.isArray(frame.blocks) ? frame.blocks : row.blocks;
    row.usage = frame.usage ?? null;
    row.costUsd = frame.costUsd ?? null;
    row.durationMs = frame.durationMs ?? null;
    row.status = frame.status || 'done';
    row.reason = frame.reason ?? null;
    row.model = frame.model ?? row.model;
    if (frame.threadTotals) { thread.totals = frame.threadTotals; }
    live = null;
    inFlight = null;
    dirty.structure = true;
    dirty.messages.add(row.id);
    dirty.answer.add(row.id);
    dirty.meters = true;
    dirty.label = true;
  }

  function applyJobFrame(frame) {
    const existing = rowById(frame.messageId);
    if (existing && TERMINAL.has(existing.status)) return { dropped: 'terminal-message' };
    if (live && frame.messageId === live.messageId) {
      if (frame.seq <= live.lastSeq) return { dropped: 'stale-seq' };
      if (frame.seq > live.lastSeq + 1) return { gap: true };
      live.lastSeq = frame.seq;
    } else if (frame.type === 'ask-start') {
      ensureStreamingRow(frame.messageId, frame);
      live = { messageId: frame.messageId, userMessageId: frame.userMessageId ?? null, label: 'Thinking', startedAt: frame.startedAt ?? null, lastSeq: frame.seq, text: '', usage: null, costUsd: null };
      inFlight = { messageId: frame.messageId };
      dirty.label = true;
    } else if (!live && inFlight && frame.messageId === inFlight.messageId) {
      // Adoption: the ring buffer may have evicted the prefix — accept the first
      // frame at whatever seq it carries; ask-done.text heals the missing text.
      ensureStreamingRow(frame.messageId);
      live = { messageId: frame.messageId, userMessageId: null, label: null, startedAt: null, lastSeq: frame.seq, text: '', usage: null, costUsd: null };
    } else {
      return { dropped: 'no-live' };
    }

    const row = ensureStreamingRow(frame.messageId, frame);
    switch (frame.type) {
      case 'ask-start':
        row.model = frame.model ?? row.model;
        row.effort = frame.effort ?? row.effort;
        break;
      case 'ask-label':
        live.label = frame.label;
        dirty.label = true;
        break;
      case 'ask-delta':
        live.text += String(frame.text ?? '');
        dirty.answer.add(frame.messageId);
        break;
      case 'ask-block':
      case 'ask-card':
        if (frame.block && frame.block.id != null) {
          upsertBlock(row, frame.block);
          markBlockDirty(frame.messageId, frame.block.id);
        }
        break;
      case 'ask-usage':
        live.usage = frame.usage ?? null;
        live.costUsd = frame.costUsd ?? null;
        dirty.meters = true;
        break;
      case 'ask-done':
        finalizeDone(row, frame);
        break;
      case 'ask-error':
        row.text = live.text;
        row.status = 'error';
        row.errorMessage = frame.message || 'unknown error';
        live = null;
        inFlight = null;
        dirty.structure = true;
        dirty.messages.add(row.id);
        dirty.answer.add(row.id);
        dirty.label = true;
        dirty.meters = true;
        break;
      default:
        break; // unknown ask-* job frame: its seq is consumed, its payload ignored
    }
    return { ok: true };
  }

  function applyOutOfTurn(frame) {
    switch (frame.type) {
      case 'ask-title':
        thread.title = frame.title ?? null;
        dirty.title = true;
        return { ok: true };
      case 'ask-message': {
        const m = frame.message;
        if (!m || typeof m.id !== 'string') return { dropped: 'no-live' };
        upsertRow(m);
        dirty.messages.add(m.id);
        return { ok: true };
      }
      case 'ask-run-status': {
        if (typeof frame.runId !== 'string') return { dropped: 'no-live' };
        const cur = links.get(frame.runId) || { pipelineId: null, cardId: null, status: null, phase: null };
        links.set(frame.runId, {
          pipelineId: frame.pipelineId ?? cur.pipelineId,
          cardId: frame.cardId ?? cur.cardId,
          status: frame.status ?? cur.status,
          phase: frame.phase ?? cur.phase,
        });
        dirty.runLinks = true;
        return { ok: true };
      }
      default:
        return { dropped: 'no-live' };
    }
  }

  return Object.freeze({
    threadId,
    load(snapshot) {
      thread = { ...snapshot.thread };
      rows = Array.isArray(snapshot.messages) ? snapshot.messages.slice() : [];
      attachments = Array.isArray(snapshot.attachments) ? snapshot.attachments.slice() : [];
      links.clear();
      for (const l of Array.isArray(snapshot.runLinks) ? snapshot.runLinks : []) {
        links.set(l.runId, { pipelineId: l.pipelineId ?? null, cardId: l.cardId ?? null, status: l.status ?? null, phase: l.phase ?? null });
      }
      live = null;
      inFlight = snapshot.inFlight ?? null;
      dirty = newDirty();
      dirty.structure = true;
      dirty.title = true;
      dirty.meters = true;
      dirty.runLinks = true;
      dirty.label = true;
    },
    apply(frame) {
      if (!frame || frame.threadId !== threadId) return { dropped: 'other-thread' };
      if (typeof frame.seq === 'number') return applyJobFrame(frame);
      return applyOutOfTurn(frame);
    },
    takeDirty() {
      const d = dirty;
      dirty = newDirty();
      return d;
    },
    messages() { return rows; },
    thread() { return thread; },
    totals() {
      return { ...thread.totals, live: live ? { usage: live.usage, costUsd: live.costUsd } : null };
    },
    inFlight() { return inFlight; },
    live() { return live; },
    runLinks() { return links; },
    attachmentsBytes() { return attachments.reduce((n, a) => n + (a && Number.isFinite(a.bytes) ? a.bytes : 0), 0); },
    findCard(cardId) {
      for (const r of rows) {
        const b = (r && Array.isArray(r.blocks) ? r.blocks : []).find((x) => x && x.kind === 'card' && x.id === cardId);
        if (b) return { message: r, block: b };
      }
      return null;
    },
    noteLocalUserMessage({ id, text, attachments: atts }) {
      upsertRow({
        id, threadId, seq: undefined, role: 'user', text: String(text ?? ''),
        blocks: (Array.isArray(atts) ? atts : []).map((a) => ({ kind: 'attachment', id: a.id ?? null, name: a.name, bytes: a.bytes })),
        status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: null,
      });
      dirty.messages.add(id);
    },
  });
}
```

- [ ] **Step 1.5: Run the tests to verify they pass**

Run: `node --disable-warning=ExperimentalWarning --test test/ask-model.test.mjs`
Expected: **21 pass / 0 fail**, clean exit (no `--test-force-exit` on green).

- [ ] **Step 1.6: Full suite**

Run: `npm test`
Expected: **3251 pass / 0 fail**.

- [ ] **Step 1.7: Commit**

```bash
git add ui/public/ask-model.mjs test/helpers/ask-frames.mjs test/ask-model.test.mjs
git commit -m "worca ask p3: thread model + fixture frame helper"
```

---
### Task 2: Markdown renderer (`ask-markdown.mjs`)

**Files:**
- Create: `ui/public/ask-markdown.mjs`
- Test: `test/ask-markdown.test.mjs`

**Interfaces:**
- Consumes: `ui/public/syntax-highlight.mjs#SUPPORTED_LANGUAGE_IDS` (existing, frozen array of 40 ids); the injected `load()` (in production the app's lazy `/vendor` imports; in tests direct `import('marked')`/`import('dompurify')` — the SAME pinned packages the vendor routes serve); the injected `hljsLoader` (`{forLanguage(lang) → null | {lang, highlight(text)}}`).
- Produces: `createMarkdownRenderer({doc, load, hljsLoader})` → `Object.freeze({ensure, isReady, isFailed, render, highlight})` — consumed by ask-panel (Task 4/5) and `window.__worcaTestHooks.askMarkdown` (Task 10 reads the hook and passes it AS the panel's `loadMarkdown`).

- [ ] **Step 2.1: Write the failing tests** — `test/ask-markdown.test.mjs`, full file:

```js
// test/ask-markdown.test.mjs — the sandboxed markdown pipeline (spec §10.7)
// against the REAL pinned marked@18.0.10 + dompurify@3.4.14 under jsdom.
// npm ci is a prerequisite — without it both imports fail for reasons
// unrelated to this module.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { createMarkdownRenderer } from '../ui/public/ask-markdown.mjs';

let dom;
before(() => { dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/' }); });

const realLoad = async () => ({
  marked: (await import('marked')).marked,
  createDOMPurify: (await import('dompurify')).default,
});

async function makeReady({ hljsLoader = { forLanguage: async () => null }, load = realLoad } = {}) {
  const r = createMarkdownRenderer({ doc: dom.window.document, load, hljsLoader });
  assert.equal(await r.ensure(), true);
  return r;
}

function htmlOf(result) {
  assert.equal(result.kind, 'md');
  const div = dom.window.document.createElement('div');
  div.appendChild(result.frag);
  return div;
}

test('ask-markdown: renders basic gfm (heading, list, table, code fence, breaks)', async () => {
  const r = await makeReady();
  const out = htmlOf(r.render('# Hi\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```js\nconst a = 1;\n```\nline1\nline2'));
  assert.ok(out.querySelector('h1'));
  assert.equal(out.querySelectorAll('li').length, 2);
  assert.ok(out.querySelector('table thead th'));
  const code = out.querySelector('pre > code');
  assert.ok(code);
  assert.ok([...code.classList].some((c) => c === 'language-js'));
  assert.ok(out.querySelectorAll('br').length >= 1, 'breaks:true turns the newline into <br>');
});

test('ask-markdown: the §12 hostile matrix is neutralised', async () => {
  const r = await makeReady();
  const hostile = [
    '<script>window.__pwned = 1</script>',
    '<img src=x onerror="window.__pwned=2">',
    '[x](javascript:alert(1))',
    '[y](data:text/html,<script>1</script>)',
    '<iframe src="https://evil"></iframe>',
    '<form action="/api/run"><input name="ok"></form>',
    '<a id="confirm-ok" name="runs">clobber</a>',
    '<style>body{display:none}</style>',
    '<b onclick="1">b</b>',
    '<svg onload="window.__pwned=3"><circle r="1"/></svg>',
  ].join('\n\n');
  const out = htmlOf(r.render(hostile));
  assert.equal(out.querySelector('script,iframe,form,style,svg,img'), null);
  assert.equal(out.querySelector('[onerror],[onclick],[onload],[id],[name],[action],[src]'), null);
  for (const a of out.querySelectorAll('a[href]')) {
    assert.match(a.getAttribute('href'), /^(?:https?:|mailto:|#)/i);
  }
  assert.equal(dom.window.__pwned, undefined);
});

test('ask-markdown: https/mailto links get _blank + noopener noreferrer; #hash links stay in-app', async () => {
  const r = await makeReady();
  const out = htmlOf(r.render('[ext](https://example.com) [mail](mailto:a@b.c) [in](#history/p/1)'));
  const [ext, mail, hash] = [...out.querySelectorAll('a')];
  assert.equal(ext.getAttribute('target'), '_blank');
  assert.equal(ext.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(mail.getAttribute('target'), '_blank');
  assert.equal(hash.getAttribute('href'), '#history/p/1');
  assert.equal(hash.getAttribute('target'), null, 'in-app hash links do not open a new tab');
});

test('ask-markdown: foreign classes are stripped, language-*/hljs-* survive on the right tags', async () => {
  const r = await makeReady();
  const out = htmlOf(r.render('```python\nx = 1\n```\n\n<p class="steal-layout">p</p>'));
  const code = out.querySelector('code');
  assert.deepEqual([...code.classList], ['language-python']);
  assert.ok(!out.innerHTML.includes('steal-layout'));
});

test('ask-markdown: task-list checkboxes are inert; non-checkbox inputs are removed', async () => {
  const r = await makeReady();
  const out = htmlOf(r.render('- [x] done item\n- [ ] open item\n\n<input type="text" value="steal">'));
  const boxes = [...out.querySelectorAll('input')];
  assert.ok(boxes.length >= 2);
  for (const b of boxes) {
    assert.equal(b.getAttribute('type'), 'checkbox');
    assert.ok(b.hasAttribute('disabled'));
  }
});

test('ask-markdown: over 200 000 chars renders plain', async () => {
  const r = await makeReady();
  assert.deepEqual(r.render('a'.repeat(200_001)), { kind: 'plain' });
  assert.equal(r.render('a'.repeat(1000)).kind, 'md');
});

test('ask-markdown: not ready → plain; ready flips to md', async () => {
  const r = createMarkdownRenderer({ doc: dom.window.document, load: realLoad, hljsLoader: { forLanguage: async () => null } });
  assert.deepEqual(r.render('**bold**'), { kind: 'plain' });
  assert.equal(r.isReady(), false);
  await r.ensure();
  assert.equal(r.isReady(), true);
  assert.equal(r.render('**bold**').kind, 'md');
});

test('ask-markdown: a failing load latches to plain after 3 attempts, never retries endlessly', async () => {
  let calls = 0;
  const r = createMarkdownRenderer({ doc: dom.window.document, load: async () => { calls += 1; throw new Error('offline'); }, hljsLoader: null });
  assert.equal(await r.ensure(), false);
  assert.equal(await r.ensure(), false);
  assert.equal(await r.ensure(), false);
  assert.equal(r.isFailed(), true);
  assert.equal(await r.ensure(), false);
  assert.equal(calls, 3, 'exactly three attempts, then the permanent latch');
  assert.deepEqual(r.render('# x'), { kind: 'plain' });
});

test('ask-markdown: highlight() applies span-only hljs markup on ask-done', async () => {
  const hljsLoader = {
    forLanguage: async (lang) => (lang === 'javascript'
      ? { lang, highlight: (text) => text.replace('const', '<span class="hljs-keyword">const</span>') }
      : null),
  };
  const r = await makeReady({ hljsLoader });
  const host = dom.window.document.createElement('div');
  host.appendChild(r.render('```js\nconst a = 1;\n```').frag);
  await r.highlight(host);
  assert.ok(host.querySelector('code .hljs-keyword'));
  assert.equal(host.querySelector('code').textContent, 'const a = 1;\n');
});

test('ask-markdown: hostile hljs output is rejected — code stays plain', async () => {
  const hljsLoader = {
    forLanguage: async (lang) => ({ lang, highlight: () => '<img src=x onerror=1><span class="hljs-keyword">const</span> a = 1;\n' }),
  };
  const r = await makeReady({ hljsLoader });
  const host = dom.window.document.createElement('div');
  host.appendChild(r.render('```js\nconst a = 1;\n```').frag);
  await r.highlight(host);
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.querySelector('.hljs-keyword'), null, 'the whole block is rejected, not partially applied');
  assert.equal(host.querySelector('code').textContent, 'const a = 1;\n');
});

test('ask-markdown: unknown fence languages and alias mapping', async () => {
  const seen = [];
  const hljsLoader = { forLanguage: async (lang) => { seen.push(lang); return null; } };
  const r = await makeReady({ hljsLoader });
  const host = dom.window.document.createElement('div');
  host.appendChild(r.render('```ts\nlet x\n```\n\n```made-up-lang\nzzz\n```').frag);
  await r.highlight(host);
  assert.deepEqual(seen, ['typescript'], 'ts aliases to typescript; unknown languages never reach the loader');
});

test('ask-markdown: render() never throws on garbage', async () => {
  const r = await makeReady();
  for (const bad of [null, undefined, 42, '\u0000', '<'.repeat(500)]) {
    const out = r.render(bad);
    assert.ok(out.kind === 'md' || out.kind === 'plain');
  }
});

test('ask-markdown: hljs output that changes the text is rejected', async () => {
  const hljsLoader = { forLanguage: async (lang) => ({ lang, highlight: () => '<span class="hljs-keyword">const</span> a = 2;\n' }) };
  const r = await makeReady({ hljsLoader });
  const host = dom.window.document.createElement('div');
  host.appendChild(r.render('```js\nconst a = 1;\n```').frag);
  await r.highlight(host);
  assert.equal(host.querySelector('.hljs-keyword'), null, 'text must round-trip byte-for-byte');
  assert.equal(host.querySelector('code').textContent, 'const a = 1;\n');
});
```

- [ ] **Step 2.2: Run to verify failure**

Run: `node --disable-warning=ExperimentalWarning --test --test-force-exit test/ask-markdown.test.mjs`
Expected: the file fails to load: node:test reports `tests 1 / fail 1` with `ERR_MODULE_NOT_FOUND … ui/public/ask-markdown.mjs`.
- [ ] **Step 2.3: Implement `ui/public/ask-markdown.mjs`** — the full module:

```js
// ui/public/ask-markdown.mjs — sandboxed markdown for Ask Worca answers
// (spec §10.7). marked + DOMPurify are lazy-loaded through the injected
// `load()` (the app wires it to the P2 vendor routes; tests import the same
// pinned packages directly). Failure latches to plain text after three
// attempts — the MAX_RESOURCE_FAILURES precedent of hljs-loader.mjs — never an
// endless retry. Code blocks are highlighted only on ask-done, with the same
// detached-staging commit rules as hdApplyHighlights (app.js:11235-11259):
// text must round-trip byte-for-byte and only class-carrying SPANs may appear.
import { SUPPORTED_LANGUAGE_IDS } from './syntax-highlight.mjs';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'a',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input'];
const ALLOWED_ATTR = ['href', 'class', 'type', 'checked', 'disabled', 'align'];
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|#)/i;
// DOMPurify tests EVERY non-URI-safe attribute VALUE against ALLOWED_URI_REGEXP;
// with the strict regexp above, type="checkbox" and align="right" would be
// dropped (only `class` is URI-safe by default) — the post-pass would then
// remove every checkbox. These two carry no URL, so marking them URI-safe
// restores them without loosening the href guard.
const ADD_URI_SAFE_ATTR = ['type', 'align'];
const CODE_CLASS_RE = /^language-[A-Za-z0-9_+-]{1,64}$/;
// hljs primary tokens plus the secondary `word_` scope tokens it appends
// (same shape syntax-highlight.mjs:49 accepts).
const HLJS_CLASS_RE = /^(?:hljs-[A-Za-z0-9_-]+|[A-Za-z0-9-]+_+)$/;
const PLAIN_LIMIT = 200_000;
const MAX_ATTEMPTS = 3;

export const LANGUAGE_ALIASES = Object.freeze({
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', node: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  yml: 'yaml', html: 'xml', htm: 'xml', svg: 'xml', vue: 'xml',
  py: 'python', rb: 'ruby', md: 'markdown', golang: 'go', 'c++': 'cpp', cs: 'csharp', patch: 'diff', toml: 'ini',
});

const SUPPORTED = new Set(SUPPORTED_LANGUAGE_IDS);

export function createMarkdownRenderer({ doc, load, hljsLoader }) {
  let mods = null;
  let loading = null;
  let attempts = 0;
  let failed = false;

  function ensure() {
    if (mods) return Promise.resolve(true);
    if (failed) return Promise.resolve(false);
    if (!loading) {
      loading = Promise.resolve()
        .then(() => load())
        .then((loaded) => {
          const marked = loaded && loaded.marked;
          const createDOMPurify = loaded && loaded.createDOMPurify;
          const purifier = typeof createDOMPurify === 'function' ? createDOMPurify(doc.defaultView) : null;
          if (!marked || typeof marked.parse !== 'function' || !purifier || typeof purifier.sanitize !== 'function') {
            throw new Error('markdown modules have an unexpected shape');
          }
          mods = { marked, purifier };
          return true;
        })
        .catch(() => {
          attempts += 1;
          loading = null;
          if (attempts >= MAX_ATTEMPTS) failed = true;
          return false;
        });
    }
    return loading;
  }

  function render(text) {
    const s = String(text ?? '');
    if (!mods || failed || s.length > PLAIN_LIMIT) return { kind: 'plain' };
    let html;
    try {
      html = mods.marked.parse(s, { gfm: true, breaks: true, async: false });
    } catch {
      return { kind: 'plain' };
    }
    let frag;
    try {
      frag = mods.purifier.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP, ADD_URI_SAFE_ATTR, RETURN_DOM_FRAGMENT: true });
    } catch {
      return { kind: 'plain' };
    }
    for (const node of [...frag.querySelectorAll('[class]')]) {
      const tag = node.tagName;
      const keep = [...node.classList].filter((c) => (
        tag === 'CODE' ? CODE_CLASS_RE.test(c) : tag === 'SPAN' ? HLJS_CLASS_RE.test(c) : false
      ));
      if (keep.length) node.setAttribute('class', keep.join(' '));
      else node.removeAttribute('class');
    }
    for (const a of [...frag.querySelectorAll('a[href]')]) {
      const href = a.getAttribute('href') || '';
      if (/^(?:https?:|mailto:)/i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    }
    for (const input of [...frag.querySelectorAll('input')]) {
      if ((input.getAttribute('type') || '').toLowerCase() !== 'checkbox') { input.remove(); continue; }
      input.setAttribute('disabled', '');
    }
    return { kind: 'md', frag };
  }

  async function highlight(container) {
    if (!container || !hljsLoader || failed) return;
    for (const code of [...container.querySelectorAll('pre > code')]) {
      const cls = [...code.classList].find((c) => c.startsWith('language-'));
      if (!cls) continue;
      const raw = cls.slice('language-'.length).toLowerCase();
      const lang = SUPPORTED.has(raw) ? raw : LANGUAGE_ALIASES[raw];
      if (!lang || !SUPPORTED.has(lang)) continue;
      let binding = null;
      try { binding = await hljsLoader.forLanguage(lang); } catch { binding = null; }
      if (!binding) continue;
      const source = code.textContent;
      let html = '';
      try { html = binding.highlight(source); } catch { continue; }
      // hdApplyHighlights staging rules, verbatim: detached holder, byte-exact
      // text, SPAN-only markup whose only attribute is a valid class.
      const holder = doc.createElement('span');
      holder.innerHTML = html;
      if (holder.textContent !== source) continue;
      const els = [...holder.querySelectorAll('*')];
      const bad = els.some((el) => el.tagName !== 'SPAN'
        || [...el.attributes].some((attr) => attr.name !== 'class')
        || [...el.classList].some((c) => !HLJS_CLASS_RE.test(c)));
      if (bad) continue;
      code.replaceChildren(...holder.childNodes);
    }
  }

  return Object.freeze({
    ensure,
    isReady: () => !!mods,
    isFailed: () => failed,
    render,
    highlight,
  });
}
```

- [ ] **Step 2.4: Run to verify pass**

Run: `node --disable-warning=ExperimentalWarning --test test/ask-markdown.test.mjs`
Expected: **13 pass / 0 fail**, clean exit.

- [ ] **Step 2.5: Full suite**

Run: `npm test`
Expected: **3264 pass / 0 fail** (previous + 13).

- [ ] **Step 2.6: Commit**

```bash
git add ui/public/ask-markdown.mjs test/ask-markdown.test.mjs
git commit -m "worca ask p3: sandboxed markdown renderer"
```

---
### Task 3: Panel shell, keys, popover primitive, threads popover (list only)

**Files:**
- Create: `ui/public/ask-panel.mjs` (the skeleton every later task extends — stub functions are REPLACED WHOLESALE by later tasks, so their exact bodies below are the Edit anchors)
- Create: `test/helpers/ask-panel-harness.mjs`
- Test: `test/ask-panel.test.mjs`

**Interfaces:**
- Consumes: `./ask-model.mjs#createThreadModel` (Task 1), `./ask-markdown.mjs#createMarkdownRenderer` (Task 2).
- Produces: `createAskPanel(deps)` → `Object.freeze({root, open, close, toggle, isOpen, pushServerFrame, onHello, ownsKey, destroy})` — the exact spec §10.1 surface, nothing extra (tests reach internals through the DOM and the injected deps only). The harness exports `makePanel(overrides)` → `{panel, window, doc, fetchCalls, wsSends, flush, storage}` used by every `ask-panel*` suite. Re-slice note (adjudicated): the THREADS POPOVER's list UI lands here because it exercises the popover primitive with real menu items over the injected fetch; thread SWITCHING/DELETE actions and the model picker land in Task 7.

- [ ] **Step 3.1: Write the harness** — `test/helpers/ask-panel-harness.mjs`, full file:

```js
// test/helpers/ask-panel-harness.mjs — jsdom rig for the ask-panel unit suites.
// No app boot: the panel takes every environment dependency through its factory
// (spec §10.1), so the harness only builds a bare document and records what the
// panel does with fetch / sendWs / raf / storage.
import { JSDOM } from 'jsdom';
import { createAskPanel } from '../../ui/public/ask-panel.mjs';

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

export function makePanel(overrides = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:4317/' });
  const { window } = dom;
  const fetchCalls = [];
  const wsSends = [];
  const rafQueue = [];
  let lastRaf = null;
  const storage = overrides.storage || makeStorage();
  const deps = {
    doc: window.document,
    win: window,
    fetch: (url, opts) => {
      fetchCalls.push({ url: String(url), opts: opts || {} });
      const h = overrides.fetchHandler;
      if (h) return Promise.resolve(h(String(url), opts || {}));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    },
    sendWs: (obj) => { wsSends.push(obj); },
    confirm: overrides.confirm || (async () => true),
    getPageContext: overrides.getPageContext || (() => ({})),
    openNewPipeline: overrides.openNewPipeline || (() => {}),
    loadMarkdown: overrides.loadMarkdown || (async () => { throw new Error('markdown disabled in this suite'); }),
    hljsLoader: overrides.hljsLoader || { forLanguage: async () => null },
    storage,
    raf: (fn) => { rafQueue.push(fn); lastRaf = fn; return rafQueue.length; },
    now: overrides.now || (() => 1_000_000),
    ...(overrides.deps || {}),
  };
  const panel = createAskPanel(deps);
  window.document.body.appendChild(panel.root);
  // Force one flush pass, then drain whatever it re-arms. With nothing armed
  // the panel's flush must still run: in production the 1 s elapsed interval
  // keeps calling scheduleFlush(), and a test that only advances the injected
  // `now` has no other stand-in for that tick.
  const flush = () => {
    if (!rafQueue.length && lastRaf) lastRaf();
    for (let i = 0; i < 5 && rafQueue.length; i++) rafQueue.splice(0).forEach((fn) => fn());
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { panel, window, doc: window.document, fetchCalls, wsSends, flush, tick, storage };
}

export function key(window, target, key, init = {}) {
  const e = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  (target || window.document).dispatchEvent(e);
  return e;
}

export function pointerdown(window, target) {
  const e = new window.Event('pointerdown', { bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}
```

- [ ] **Step 3.2: Write the failing tests** — `test/ask-panel.test.mjs`, full file:

```js
// test/ask-panel.test.mjs — shell, keyboard, pointerdown routing and the
// popover primitive (spec §10.4, §10.6). No app boot; see the harness header.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel, key, pointerdown } from './helpers/ask-panel-harness.mjs';

const THREADS = {
  threads: [
    { id: 'ask_00000001', title: 'Fix the login bug', updatedAt: 't2', createdAt: 't1', model: 'claude-opus-5', effort: 'high', sessionId: null, context: null, totals: { costUsd: 0.21, input: 9200, output: 9200, cacheRead: 0, cacheCreation: 0, turns: 3, agents: 3 }, runLinks: 0, inFlight: true },
    { id: 'ask_00000002', title: 'Explain run 4e1f', updatedAt: 't1', createdAt: 't0', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false },
  ],
};

const threadsHandler = (url) => (url.startsWith('/api/ask/threads')
  ? { ok: true, status: 200, json: async () => THREADS }
  : { ok: true, status: 200, json: async () => ({}) });

test('ask-panel: root structure — dock, pill, hidden sheet, dialog semantics, no data-view/data-nav', () => {
  const { panel, doc } = makePanel();
  const dock = panel.root;
  assert.ok(dock.classList.contains('ask-dock'));
  const pill = dock.querySelector('.ask-pill');
  const sheet = dock.querySelector('.ask-sheet');
  assert.ok(pill && sheet);
  assert.equal(sheet.hidden, true);
  assert.equal(pill.hidden, false);
  assert.equal(sheet.getAttribute('role'), 'dialog');
  assert.equal(sheet.getAttribute('aria-label'), 'Ask Worca');
  // documentary fence — cannot fail unless the builder grows the feature
  assert.equal(sheet.getAttribute('aria-modal'), null, 'no aria-modal (spec §10.4)');
  assert.ok(sheet.hasAttribute('data-ask-sheet'));
  assert.equal(dock.querySelector('[data-view],[data-nav]'), null);
  assert.ok(dock.querySelector('.sr-only[aria-live="polite"]'), 'the announcement line exists');
  assert.equal(panel.isOpen(), false);
});

test('ask-panel: pill click opens; the composer textarea gets focus; close restores it', () => {
  const { panel, doc } = makePanel();
  const outside = doc.createElement('button');
  doc.body.appendChild(outside);
  outside.focus();
  panel.root.querySelector('.ask-pill').click();
  assert.equal(panel.isOpen(), true);
  assert.equal(panel.root.querySelector('.ask-sheet').hidden, false);
  assert.equal(panel.root.querySelector('.ask-pill').hidden, true);
  assert.equal(doc.activeElement, panel.root.querySelector('textarea.ask-input'));
  panel.close();
  assert.equal(panel.isOpen(), false);
  assert.equal(doc.activeElement, outside, 'previous focus restored when still connected');
});

test('ask-panel: ⌘K and Ctrl+K toggle with preventDefault; repeat and composing are ignored', () => {
  const { panel, window } = makePanel();
  const e1 = key(window, null, 'k', { metaKey: true });
  assert.equal(e1.defaultPrevented, true);
  assert.equal(panel.isOpen(), true);
  const e2 = key(window, null, 'k', { ctrlKey: true });
  assert.equal(panel.isOpen(), false);
  assert.equal(e2.defaultPrevented, true);
  key(window, null, 'k', { metaKey: true, repeat: true });
  assert.equal(panel.isOpen(), false, 'e.repeat ignored');
  key(window, null, 'k', { metaKey: true, isComposing: true });
  assert.equal(panel.isOpen(), false, 'e.isComposing ignored');
  key(window, null, 'k', {});
  assert.equal(panel.isOpen(), false, 'bare k does nothing');
});

test('ask-panel: ownsKey truth table', () => {
  const { panel, window, doc } = makePanel();
  const mk = (target) => new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  // closed → never owns
  assert.equal(panel.ownsKey(Object.assign(mk(), {})), false);
  panel.open();
  const input = panel.root.querySelector('textarea.ask-input');
  input.focus();
  // focus inside → owns even though the event target is the document
  const eDoc = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  Object.defineProperty(eDoc, 'target', { value: doc.body });
  assert.equal(panel.ownsKey(eDoc), true);
  // target inside → owns
  const eIn = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  Object.defineProperty(eIn, 'target', { value: input });
  assert.equal(panel.ownsKey(eIn), true);
  // non-Escape never owned
  const eK = new window.KeyboardEvent('keydown', { key: 'k', bubbles: true });
  Object.defineProperty(eK, 'target', { value: input });
  assert.equal(panel.ownsKey(eK), false);
  // focus + target both outside → not owned
  const out = doc.createElement('button');
  doc.body.appendChild(out);
  out.focus();
  const eOut = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  Object.defineProperty(eOut, 'target', { value: out });
  assert.equal(panel.ownsKey(eOut), false);
});

test('ask-panel: Escape with the sheet open and no popover is an owned no-op', () => {
  const { panel, window } = makePanel();
  panel.open();
  panel.root.querySelector('textarea.ask-input').focus();
  key(window, panel.root.querySelector('textarea.ask-input'), 'Escape');
  assert.equal(panel.isOpen(), true, 'the sheet does not close on Escape (mockup rule)');
});

test('ask-panel: pointerdown outside closes; exempt overlays do not', () => {
  const { panel, window, doc } = makePanel();
  for (const cls of ['viewer-modal', 'info-bubble', 'mention-popup']) {
    const n = doc.createElement('div');
    n.className = cls;
    doc.body.appendChild(n);
  }
  const confirmModal = doc.createElement('div');
  confirmModal.id = 'confirm-modal';
  doc.body.appendChild(confirmModal);
  panel.open();
  pointerdown(window, doc.querySelector('.viewer-modal'));
  pointerdown(window, doc.querySelector('.info-bubble'));
  pointerdown(window, doc.querySelector('.mention-popup'));
  pointerdown(window, confirmModal);
  assert.equal(panel.isOpen(), true, 'exempt overlays never close the sheet');
  pointerdown(window, panel.root.querySelector('.ask-sheet'));
  assert.equal(panel.isOpen(), true, 'inside the sheet stays open');
  pointerdown(window, doc.body);
  assert.equal(panel.isOpen(), false, 'outside closes');
});

test('ask-panel: threads popover lists rows with meter and live dot; empty state', async () => {
  const { panel, doc, tick, fetchCalls } = makePanel({ fetchHandler: threadsHandler });
  panel.open();
  doc.querySelector('[data-ask-threads-btn]').click();
  await tick();
  assert.ok(fetchCalls.some((c) => c.url.startsWith('/api/ask/threads')), 'list fetched on open');
  const pop = doc.querySelector('.ask-pop');
  assert.ok(pop);
  assert.equal(pop.getAttribute('role'), 'menu');
  const items = [...pop.querySelectorAll('[role="menuitem"]')];
  assert.equal(items.length, 2);
  assert.match(items[0].textContent, /Fix the login bug/);
  assert.match(items[0].textContent, /18\.4k tok · \$0\.21 · 3 agents/);
  assert.ok(items[0].querySelector('.ask-dot-live'), 'in-flight thread shows the live dot');
  assert.equal(items[1].querySelector('.ask-dot-live'), null);
  // empty state
  const empty = makePanel({ fetchHandler: () => ({ ok: true, status: 200, json: async () => ({ threads: [] }) }) });
  empty.panel.open();
  empty.doc.querySelector('[data-ask-threads-btn]').click();
  await empty.tick();
  assert.match(empty.doc.querySelector('.ask-pop').textContent, /No saved chats\./);
});

test('ask-panel: popover menu keyboard — roving focus, wrap, Home/End, Enter, Escape to trigger', async () => {
  const { panel, window, doc, tick } = makePanel({ fetchHandler: threadsHandler });
  panel.open();
  const trigger = doc.querySelector('[data-ask-threads-btn]');
  trigger.click();
  await tick();
  const pop = doc.querySelector('.ask-pop');
  const items = [...pop.querySelectorAll('[role="menuitem"]')];
  assert.equal(doc.activeElement, items[0], 'first item focused on open');
  key(window, items[0], 'ArrowDown');
  assert.equal(doc.activeElement, items[1]);
  key(window, items[1], 'ArrowDown');
  assert.equal(doc.activeElement, items[0], 'wraps');
  key(window, items[0], 'ArrowUp');
  assert.equal(doc.activeElement, items[1], 'wraps up');
  key(window, items[1], 'Home');
  assert.equal(doc.activeElement, items[0]);
  key(window, items[0], 'End');
  assert.equal(doc.activeElement, items[1]);
  key(window, items[1], 'Escape');
  assert.equal(doc.querySelector('.ask-pop'), null, 'Escape closes the popover');
  assert.equal(doc.activeElement, trigger, 'focus returns to the trigger');
  assert.equal(panel.isOpen(), true, 'the sheet stays open');
});

test('ask-panel: click-away inside the sheet closes the popover, not the sheet; reopening is a toggle', async () => {
  const { panel, window, doc, tick } = makePanel({ fetchHandler: threadsHandler });
  panel.open();
  const trigger = doc.querySelector('[data-ask-threads-btn]');
  trigger.click();
  await tick();
  assert.ok(doc.querySelector('.ask-pop'));
  pointerdown(window, panel.root.querySelector('textarea.ask-input'));
  assert.equal(doc.querySelector('.ask-pop'), null);
  assert.equal(panel.isOpen(), true);
  trigger.click();
  await tick();
  assert.ok(doc.querySelector('.ask-pop'));
  trigger.click();
  assert.equal(doc.querySelector('.ask-pop'), null, 'the trigger toggles');
});

test('ask-panel: destroy removes the root and unbinds the document listeners', () => {
  const { panel, window, doc } = makePanel();
  panel.destroy();
  assert.equal(doc.querySelector('.ask-dock'), null);
  const e = key(window, null, 'k', { metaKey: true });
  assert.equal(e.defaultPrevented, false, 'no listener left behind');
});
```

- [ ] **Step 3.3: Run to verify failure**

Run: `node --disable-warning=ExperimentalWarning --test --test-force-exit test/ask-panel.test.mjs`
Expected: the file fails to load: node:test reports `tests 1 / fail 1` with `ERR_MODULE_NOT_FOUND … ui/public/ask-panel.mjs`.
- [ ] **Step 3.4: Implement the `ask-panel.mjs` skeleton.** Later tasks REPLACE the functions marked `// [T<N> replaces]` wholesale — their bodies below are deliberate one-liner stubs so the Edit `old_string` stays unique. The full initial file:

```js
// ui/public/ask-panel.mjs — the Ask Worca floating sheet (spec §10). One
// factory, everything in the closure: the module is evaluated once per test
// file even though app.js is re-imported with a cache-buster, so module scope
// holds no state. All markup is built with DOM APIs and textContent — no
// innerHTML for content anywhere in this file (the markdown renderer owns the
// only sanitized-HTML path).
import { createThreadModel } from './ask-model.mjs';
import { createMarkdownRenderer } from './ask-markdown.mjs';

const ICONS = {
  threads: 'M4 6h16M4 12h16M4 18h9',
  plus: 'M12 5v14M5 12h14',
  chevronDown: 'M6 9l6 6 6-6',
  send: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
};

export function fmtTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1000 ? `${n} tok` : `${(n / 1000).toFixed(1)}k tok`;
}
export function fmtUsd(x) {
  return Number.isFinite(x) ? `$${x.toFixed(2)}` : null;
}
export function fmtAgents(n) {
  return Number.isFinite(n) && n > 0 ? `${n} agent${n === 1 ? '' : 's'}` : null;
}
export function totalsTokens(t) {
  if (!t) return 0;
  return (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheCreation || 0);
}

export function createAskPanel({ doc, win, fetch, sendWs, confirm, getPageContext, openNewPipeline, loadMarkdown, hljsLoader, storage, raf, now }) {
  const st = {
    open: false,
    threadId: null,
    model: null,              // createThreadModel for the active thread (Task 4+)
    picker: readStoredModel(),
    catalog: null,
    popover: null,            // {panel, trigger, onClose}
    expandedAgents: new Set(),
    pinned: true,
    prevFocus: null,
    pendingFiles: [],
    sending: false,
    subscribedFor: null,
    elapsedTimer: null,
    elapsedStart: null,
    flushArmed: false,
    resyncing: false,
    firstOpenDone: false,
    destroyed: false,
    lastAnswerRender: 0,
  };
  const el = {}; // element refs, filled by the builders
  const renderer = createMarkdownRenderer({ doc, load: loadMarkdown, hljsLoader });

  // ---- storage --------------------------------------------------------------
  function readStoredModel() {
    try {
      const raw = storage.getItem('worca-cc.ask.model');
      const v = raw ? JSON.parse(raw) : null;
      if (v && typeof v.model === 'string' && typeof v.effort === 'string') return { model: v.model, effort: v.effort };
    } catch { /* storage unavailable */ }
    return { model: 'claude-opus-5', effort: 'high' };
  }
  function storeModel() { try { storage.setItem('worca-cc.ask.model', JSON.stringify(st.picker)); } catch { /* ignore */ } }
  function readStoredThread() { try { return storage.getItem('worca-cc.ask.thread') || null; } catch { return null; } }
  function storeThread(id) {
    try {
      if (id) storage.setItem('worca-cc.ask.thread', id);
      else storage.removeItem('worca-cc.ask.thread');
    } catch { /* ignore */ }
  }

  // ---- tiny DOM helpers -----------------------------------------------------
  function make(tag, className, text) {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
  function svgIcon(d, size = 17, sw = 1.9) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(sw));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const part of Array.isArray(d) ? d : [d]) {
      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', part);
      svg.appendChild(path);
    }
    return svg;
  }
  function iconButton(className, title, icon, onClick) {
    const b = make('button', className);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.appendChild(svgIcon(icon));
    b.addEventListener('click', onClick);
    return b;
  }

  // ---- shell ----------------------------------------------------------------
  function buildRoot() {
    const dock = make('div', 'ask-dock');

    const pill = make('button', 'ask-pill');
    pill.type = 'button';
    const pillLogo = doc.createElement('img');
    pillLogo.className = 'ask-pill-logo';
    pillLogo.src = '/assets/worca-favicon.png';
    pillLogo.alt = '';
    pill.appendChild(pillLogo);
    pill.appendChild(make('span', 'ask-pill-label', 'Ask Worca'));
    pill.appendChild(make('span', 'ask-kbd', '⌘K'));
    pill.addEventListener('click', openSheet);

    const sheet = make('section', 'ask-sheet');
    sheet.hidden = true;
    sheet.setAttribute('data-ask-sheet', '');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Ask Worca');

    const header = make('header', 'ask-header');
    const logo = doc.createElement('img');
    logo.className = 'ask-header-logo';
    logo.src = '/assets/worca-favicon.png';
    logo.alt = '';
    header.appendChild(logo);
    el.title = make('div', 'ask-title', 'Ask Worca');
    header.appendChild(el.title);
    header.appendChild(make('span', 'ask-header-spacer'));
    const threadsBtn = iconButton('ask-icon-btn', 'Recent chats', ICONS.threads, () => toggleThreadsPopover(threadsBtn));
    threadsBtn.setAttribute('data-ask-threads-btn', '');
    header.appendChild(threadsBtn);
    const newBtn = iconButton('ask-icon-btn', 'New chat', ICONS.plus, () => newThread());
    newBtn.setAttribute('data-ask-new-btn', '');
    header.appendChild(newBtn);
    header.appendChild(iconButton('ask-icon-btn', 'Close', ICONS.chevronDown, closeSheet));
    sheet.appendChild(header);

    el.transcript = make('div', 'ask-transcript');
    el.transcript.setAttribute('data-ask-scroll', '');
    el.transcript.addEventListener('scroll', updatePinFromScroll);
    sheet.appendChild(el.transcript);

    sheet.appendChild(buildComposer());

    el.live = make('div', 'sr-only');
    el.live.setAttribute('aria-live', 'polite');
    sheet.appendChild(el.live);

    dock.appendChild(sheet);
    dock.appendChild(pill);
    el.pill = pill;
    el.sheet = sheet;
    return dock;
  }

  function buildComposer() { // [T6 replaces]
    const wrap = make('div', 'ask-composer');
    el.input = doc.createElement('textarea');
    el.input.className = 'ask-input';
    el.input.rows = 1;
    el.input.placeholder = 'Ask about any run, agent, or project…';
    wrap.appendChild(el.input);
    const row = make('div', 'ask-composer-row');
    el.composerMsg = make('div', 'ask-composer-msg');
    el.composerMsg.hidden = true;
    row.appendChild(el.composerMsg);
    wrap.appendChild(row);
    return wrap;
  }

  function announce(text) { el.live.textContent = text; }

  function focusComposer() {
    try { el.input.focus({ preventScroll: true }); } catch { try { el.input.focus(); } catch { /* detached */ } }
  }

  function openSheet() {
    if (st.open || st.destroyed) return;
    st.open = true;
    st.prevFocus = doc.activeElement;
    el.pill.hidden = true;
    el.sheet.hidden = false;
    st.pinned = true;
    ensureFirstOpen();
    focusComposer();
    scheduleFlush();
  }

  function closeSheet() {
    if (!st.open) return;
    closePopover({ focusTrigger: false });
    st.open = false;
    el.sheet.hidden = true;
    el.pill.hidden = false;
    const prev = st.prevFocus;
    st.prevFocus = null;
    if (prev && prev.isConnected && typeof prev.focus === 'function') { try { prev.focus(); return; } catch { /* fall through */ } }
    try { el.pill.focus(); } catch { /* ignore */ }
  }

  function toggleSheet() { (st.open ? closeSheet : openSheet)(); }

  function ensureFirstOpen() { if (st.firstOpenDone) return; st.firstOpenDone = true; } // [T7 replaces]
```
```js
  // ---- keyboard + pointer routing ------------------------------------------
  function containsNode(rootEl, t) { return !!(t && t.nodeType && rootEl.contains(t)); }

  function ownsKey(e) {
    return e.key === 'Escape' && st.open
      && (containsNode(root, e.target) || containsNode(root, doc.activeElement));
  }

  function isToggleCombo(e) {
    return (e.metaKey || e.ctrlKey) && !e.altKey && typeof e.key === 'string' && e.key.toLowerCase() === 'k';
  }

  function onDocKeydown(e) {
    if (st.destroyed) return;
    if (isToggleCombo(e)) {
      if (e.repeat || e.isComposing) return;
      e.preventDefault();
      toggleSheet();
      return;
    }
    if (e.key === 'Escape' && ownsKey(e) && st.popover) closePopover({ focusTrigger: true });
    // Escape with nothing open is an owned no-op — app.js's handlers already
    // returned via ownsKey(); the sheet itself never closes on Escape (§10.4).
  }

  function onDocPointerdown(e) {
    if (st.destroyed || !st.open) return;
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (t.closest('[data-ask-sheet]')) {
      if (st.popover && !st.popover.panel.contains(t) && !st.popover.trigger.contains(t)) {
        closePopover({ focusTrigger: false });
      }
      return;
    }
    if (t.closest('.viewer-modal, #confirm-modal, .info-bubble, .mention-popup')) return;
    closeSheet();
  }

  // ---- popover primitive (spec §10.6 .ask-pop) ------------------------------
  function closePopover({ focusTrigger = true } = {}) {
    const p = st.popover;
    if (!p) return;
    st.popover = null;
    p.panel.remove();
    if (p.onClose) { try { p.onClose(); } catch { /* ignore */ } }
    if (focusTrigger) { try { p.trigger.focus(); } catch { /* ignore */ } }
  }

  function menuItems(panel) { return [...panel.querySelectorAll('[role="menuitem"]:not([disabled])')]; }

  function onPopKeydown(e) {
    const p = st.popover;
    if (!p) return;
    const items = menuItems(p.panel);
    if (!items.length) return;
    const idx = items.indexOf(doc.activeElement);
    const go = (i) => { const item = items[(i + items.length) % items.length]; item.tabIndex = 0; try { item.focus(); } catch { /* ignore */ } };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(idx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(idx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(items.length - 1); }
    else if ((e.key === 'Enter' || e.key === ' ') && idx >= 0) { e.preventDefault(); items[idx].click(); }
  }

  function openPopover({ panelClass, trigger, build, onClose }) {
    if (st.popover && st.popover.trigger === trigger) { closePopover({ focusTrigger: false }); return null; }
    closePopover({ focusTrigger: false });
    const panel = make('div', `ask-pop ${panelClass}`);
    panel.setAttribute('role', 'menu');
    panel.addEventListener('keydown', onPopKeydown);
    build(panel);
    el.sheet.appendChild(panel);
    st.popover = { panel, trigger, onClose: onClose || null };
    const first = menuItems(panel)[0];
    if (first) { first.tabIndex = 0; try { first.focus(); } catch { /* ignore */ } }
    return panel;
  }

  function menuItem(className, onPick) {
    const b = make('button', `ask-pop-item ${className}`.trim());
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.tabIndex = -1;
    if (onPick) b.addEventListener('click', onPick);
    return b;
  }

  // ---- threads popover (list; switching/delete land in Task 7) -------------
  function threadMeter(t) {
    const parts = [fmtTokens(totalsTokens(t.totals)), fmtUsd(t.totals && t.totals.costUsd), fmtAgents(t.totals && t.totals.agents)];
    return parts.filter(Boolean).join(' · ');
  }

  function toggleThreadsPopover(trigger) {
    const panel = openPopover({ panelClass: 'ask-pop-threads', trigger, build: (p) => { p.appendChild(make('div', 'ask-pop-caption', 'Recent chats')); } });
    if (!panel) return;
    Promise.resolve()
      .then(() => fetch('/api/ask/threads?limit=50'))
      .then((r) => (r && r.ok ? r.json() : { threads: [] }))
      .catch(() => ({ threads: [] }))
      .then(({ threads }) => {
        if (st.popover === null || st.popover.panel !== panel) return; // closed meanwhile
        renderThreadRows(panel, Array.isArray(threads) ? threads : []);
      });
  }

  function renderThreadRows(panel, threads) {
    if (!threads.length) {
      panel.appendChild(make('div', 'ask-pop-empty', 'No saved chats.'));
      return;
    }
    for (const t of threads) {
      const row = make('div', 'ask-thread-row');
      const pick = menuItem('ask-thread-pick', () => { closePopover({ focusTrigger: false }); switchThread(t.id); });
      pick.appendChild(make('span', `ask-dot${t.inFlight ? ' ask-dot-live' : ''}`));
      const col = make('span', 'ask-thread-col');
      col.appendChild(make('span', 'ask-thread-title', t.title || '(untitled)'));
      col.appendChild(make('span', 'ask-thread-meter', threadMeter(t)));
      pick.appendChild(col);
      row.appendChild(pick);
      row.appendChild(buildThreadTrash(t));
      panel.appendChild(row);
    }
    const first = menuItems(panel)[0];
    if (first) { first.tabIndex = 0; try { first.focus(); } catch { /* ignore */ } }
  }

  function buildThreadTrash(t) { // [T7 replaces]
    return make('span', 'ask-thread-trash-slot');
  }

  // ---- stubs the later tasks replace wholesale ------------------------------
  function renderTranscript() { /* [T4 replaces] */ }
  function loadThread(id) { return Promise.resolve(id && null); } // [T4 replaces]
  function switchThread(id) { /* [T7 replaces] */ }
  function newThread() { /* [T7 replaces] */ }
  function sendMessage() { /* [T6 replaces] */ }
  function pushServerFrame(frame) { /* [T5 replaces] */ }
  function onHello(list) { /* [T5 replaces] */ }
  function subscribe(threadId) { /* [T5 replaces] */ }
  function resync() { /* [T5 replaces] */ }
  function updateMeters() { /* [T6 replaces] */ }
  function flushExtra() { /* [T5 replaces] */ }

  // ---- flush + scroll (minimal now; Task 5 extends via flushExtra) ---------
  function scheduleFlush() {
    if (st.flushArmed || st.destroyed) return;
    st.flushArmed = true;
    raf(() => { st.flushArmed = false; flush(); });
  }

  function flush() {
    if (st.destroyed) return;
    flushExtra();
    applyPin();
  }

  function updatePinFromScroll() {
    const t = el.transcript;
    st.pinned = t.scrollHeight - t.scrollTop - t.clientHeight < 24;
    if (el.jump) el.jump.hidden = st.pinned;
  }

  function applyPin() {
    if (!st.open) return;
    if (st.pinned) el.transcript.scrollTop = el.transcript.scrollHeight;
    if (el.jump) el.jump.hidden = st.pinned;
  }

  // ---- mount ----------------------------------------------------------------
  const root = buildRoot();
  doc.addEventListener('keydown', onDocKeydown, true);
  doc.addEventListener('pointerdown', onDocPointerdown, true);

  function destroy() {
    if (st.destroyed) return;
    st.destroyed = true;
    closePopover({ focusTrigger: false });
    if (st.elapsedTimer) { clearInterval(st.elapsedTimer); st.elapsedTimer = null; }
    doc.removeEventListener('keydown', onDocKeydown, true);
    doc.removeEventListener('pointerdown', onDocPointerdown, true);
    root.remove();
  }

  return Object.freeze({
    root,
    open: openSheet,
    close: closeSheet,
    toggle: toggleSheet,
    isOpen: () => st.open,
    pushServerFrame,
    onHello,
    ownsKey,
    destroy,
  });
}
```

Note for later tasks: `pushServerFrame`/`onHello`/`subscribe`/`resync`/`updateMeters`/`flushExtra`/`renderTranscript`/`loadThread`/`switchThread`/`newThread`/`sendMessage`/`buildComposer`/`ensureFirstOpen`/`buildThreadTrash` are one-liner stubs — each later task's Edit replaces the WHOLE stub line (or the whole `buildComposer` function) with the real implementation; nothing else in this file moves. (The frozen return object captures the function DECLARATIONS by name, so wholesale re-declaration inside the factory is not possible — the stubs are replaced in the source, not at runtime.)

- [ ] **Step 3.5: Run to verify pass**

Run: `node --disable-warning=ExperimentalWarning --test test/ask-panel.test.mjs`
Expected: **10 pass / 0 fail**, clean exit.

- [ ] **Step 3.6: Full suite**

Run: `npm test`
Expected: **3274 pass / 0 fail**.

- [ ] **Step 3.7: Commit**

```bash
git add ui/public/ask-panel.mjs test/helpers/ask-panel-harness.mjs test/ask-panel.test.mjs
git commit -m "worca ask p3: panel shell, keys, popover primitive"
```

---
### Task 4: Persisted rendering, thread load, scroll pinning

**Files:**
- Modify: `ui/public/ask-panel.mjs` (replace stubs `renderTranscript`, `loadThread`, `switchThread`, `buildThreadTrash` stays; add the block builders + jump pill)
- Test: `test/ask-panel-render.test.mjs`

**Interfaces:**
- Consumes: Task 1 model, Task 2 renderer, Task 3 shell/popover.
- Produces: `renderTranscript()`, `buildMessage(row) → {el, update}`, `buildUserMessage/buildActivity/toolRow/agentRow/buildAnswer/buildNotice/buildErrorLine/buildCard(stub)/buildAttachmentPill`, `loadThread(id) → Promise<snapshot|null>`, real `switchThread(id)` (store + load — Task 7 no longer owns it), `fmtElapsed(ms)`, the jump pill. Task 5 consumes `st.rowEls`, `rerenderAnswers()`, `renderAnswerNow(row)`.

Rendering rules this task pins (from the architecture + visual sections): user bubble right-aligned with `.extra-pill`-family attachment pills (no ×); activity block = gutter + head row (dot `.ask-dot` + `.ask-dot-run` while streaming / `.ask-dot-done` when done, server label or `Worked for <elapsed>` / `Stopped after <elapsed>`, mono elapsed, right meter `fmtTokens · fmtUsd`) + tool rows (`.ask-tool-op` = the verb, first `_`-segment of the tool short name, CSS-uppercased; `.ask-tool-target` = the remaining segments + a ≤60-char JSON preview of `input` (or `input.preview` when `{_truncated:true}`); `.ask-tool-note` = `fmtElapsed(durationMs)` or `error`) + a Sub-agents section (row = dot · name(label) · model · tokens · `≈$` · status word; chevron toggles the mono log panel `mm:ss` lines; expansion keyed by agent id in `st.expandedAgents`, survives updates) — spec §10.5's row content wins over the mockup's; answer (`.ask-md` when the renderer is ready, plain `.ask-answer-plain` otherwise; terminal answers get `renderer.highlight()` fire-and-forget); notice (`.ask-notice`, `--blue-ink` link when `href`); error line (`.ask-error-line`, `row.errorMessage` else `'This turn ended with an error.'` — only when `status === 'error'` and no notice explains it); card renders through `buildCard` (a one-line stub until Task 8).

- [ ] **Step 4.1: Write the failing tests** — `test/ask-panel-render.test.mjs`, full file:

```js
// test/ask-panel-render.test.mjs — persisted-thread rendering + scroll pinning
// (spec §10.5, §10.4). Threads load through the public path: threads popover →
// row click → switchThread → GET /api/ask/threads/:id.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_00000001';

function listBody(over = {}) {
  return { threads: [{ id: TID, title: 'My thread', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false, ...over }] };
}

function snapBody(messages, over = {}) {
  return {
    thread: { id: TID, title: 'My thread', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: { costUsd: 0.5, input: 100, output: 200, cacheRead: 0, cacheCreation: 0, turns: 2, agents: 1 } },
    messages,
    attachments: [],
    runLinks: [],
    inFlight: null,
    ...over,
  };
}

function handlerFor(snapshot) {
  return (url) => {
    if (url.startsWith(`/api/ask/threads/${TID}`)) return { ok: true, status: 200, json: async () => snapshot };
    if (url.startsWith('/api/ask/threads')) return { ok: true, status: 200, json: async () => listBody() };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

async function openThread(ctx) {
  ctx.panel.open();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  ctx.doc.querySelector('.ask-pop [role="menuitem"]').click();
  await ctx.tick();
  await ctx.tick();
  ctx.flush();
}

const userRow = (id, seq, text, blocks = []) => ({ id, threadId: TID, seq, role: 'user', text, blocks, status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' });
const asstRow = (id, seq, over = {}) => ({ id, threadId: TID, seq, role: 'assistant', text: 'the answer', blocks: [], status: 'done', reason: null, model: 'claude-opus-5', effort: 'high', usage: { input: 900, output: 1100, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.14, durationMs: 6400, createdAt: 't', ...over });

test('ask-panel-render: user bubble + attachment pills, assistant answer plain fallback', async () => {
  const snap = snapBody([
    userRow('askm_u0000001', 1, 'what changed in run 4e1f?', [{ kind: 'attachment', id: 'att_00000001', name: 'notes.md', bytes: 41000 }]),
    asstRow('askm_00000001', 2),
  ]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const user = ctx.doc.querySelector('.ask-msg-user');
  assert.ok(user);
  assert.match(user.textContent, /what changed in run 4e1f\?/);
  const pill = user.querySelector('.extra-pill');
  assert.ok(pill, 'attachment renders as an extra-pill');
  assert.match(pill.textContent, /notes\.md/);
  // documentary fence — cannot fail unless the builder grows the feature
  assert.equal(pill.querySelector('.extra-pill-x'), null, 'no × on transcript pills');
  const answer = ctx.doc.querySelector('.ask-answer');
  assert.match(answer.textContent, /the answer/);
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'My thread', 'header shows the thread title');
});

test('ask-panel-render: activity head — done label, elapsed, meter; stopped label', async () => {
  const snap = snapBody([
    asstRow('askm_00000001', 1),
    asstRow('askm_00000002', 2, { status: 'stopped', reason: 'max_turns', durationMs: 72000, blocks: [{ kind: 'notice', text: 'Stopped: reached the 40-turn limit (Settings → Ask Worca)' }] }),
  ]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const heads = [...ctx.doc.querySelectorAll('.ask-activity-head')];
  assert.match(heads[0].textContent, /Worked for/);
  assert.match(heads[0].textContent, /6\.4s/);
  assert.match(heads[0].textContent, /2\.0k tok/);
  assert.match(heads[0].textContent, /\$0\.14/);
  assert.ok(heads[0].querySelector('.ask-dot-done'));
  assert.match(heads[1].textContent, /Stopped after/);
  assert.match(heads[1].textContent, /1m 12s/);
  assert.match(ctx.doc.querySelectorAll('.ask-notice')[0].textContent, /Stopped: reached the 40-turn limit/);
});

test('ask-panel-render: tool rows — op, target with input preview, note', async () => {
  const snap = snapBody([asstRow('askm_00000001', 1, {
    blocks: [
      { kind: 'tool', id: 't1', name: 'mcp__worca__list_runs', input: { limit: 20 }, status: 'done', durationMs: 800 },
      { kind: 'tool', id: 't2', name: 'mcp__worca__get_run_diff', input: { _truncated: true, preview: '{"id":"4e1f2a9b"…' }, status: 'error', durationMs: 120, error: 'boom' },
    ],
  })]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const rows = [...ctx.doc.querySelectorAll('.ask-tool-row')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.ask-tool-op').textContent, 'list');
  assert.match(rows[0].querySelector('.ask-tool-target').textContent, /runs/);
  assert.match(rows[0].querySelector('.ask-tool-target').textContent, /"limit":20/);
  assert.equal(rows[0].querySelector('.ask-tool-note').textContent, '0.8s');
  assert.equal(rows[1].querySelector('.ask-tool-op').textContent, 'get');
  assert.match(rows[1].querySelector('.ask-tool-target').textContent, /run diff/);
  assert.match(rows[1].querySelector('.ask-tool-target').textContent, /4e1f2a9b/, 'the preview string renders verbatim');
  assert.equal(rows[1].querySelector('.ask-tool-note').textContent, 'error');
});

test('ask-panel-render: agent row carries name · model · tokens · ≈$ · status; expand survives update', async () => {
  const agent = { kind: 'agent', id: 'toolu_1', label: 'count runs', type: 'general-purpose', model: 'claude-haiku-4-5', tokens: 5321, usage: { input: 10, output: 69, cacheRead: 4564, cacheCreation: 678 }, costUsd: 0.0017, estimated: true, status: 'done', durationMs: 2861, log: [{ t: 0, text: '→ list_runs {}' }, { t: 61000, text: '← ok 0.0s' }] };
  const snap = snapBody([asstRow('askm_00000001', 1, { blocks: [agent] })]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const row = ctx.doc.querySelector('.ask-agent-row');
  assert.match(row.textContent, /count runs/);
  assert.match(row.textContent, /claude-haiku-4-5/);
  assert.match(row.textContent, /5\.3k tok/);
  assert.match(row.textContent, /≈\$0\.00/);
  assert.match(row.textContent, /done/);
  assert.equal(ctx.doc.querySelector('.ask-agent-log'), null, 'collapsed by default');
  row.click();
  const log = ctx.doc.querySelector('.ask-agent-log');
  assert.ok(log, 'expanded on click');
  assert.match(log.textContent, /00:00/);
  assert.match(log.textContent, /01:01/);
  assert.match(log.textContent, /→ list_runs \{\}/);
  // a FULL re-render (re-selecting the thread rebuilds the transcript from a
  // fresh model) keeps the expansion — st.expandedAgents is panel-level (§10.5)
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  ctx.doc.querySelector('.ask-pop [role="menuitem"]').click();
  await ctx.tick();
  await ctx.tick();
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-agent-log'), 'expanded state survives a re-render');
});

test('ask-panel-render: markdown answers render once the real pins load; code highlighted', async () => {
  const realLoad = async () => ({ marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default });
  const hljsLoader = { forLanguage: async (lang) => (lang === 'javascript' ? { lang, highlight: (t) => t.replace('const', '<span class="hljs-keyword">const</span>') } : null) };
  const snap = snapBody([asstRow('askm_00000001', 1, { text: '**bold** and\n\n```js\nconst a = 1;\n```' })]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap), loadMarkdown: realLoad, hljsLoader });
  await openThread(ctx);
  await ctx.tick(); // renderer.ensure() resolves
  ctx.flush();
  await ctx.tick(); // highlight() resolves
  const answer = ctx.doc.querySelector('.ask-answer');
  assert.ok(answer.querySelector('strong'), 'markdown rendered');
  assert.ok(answer.classList.contains('ask-md'));
  assert.ok(answer.querySelector('code .hljs-keyword'), 'terminal answers get highlighted');
});

test('ask-panel-render: error rows show the red line with a fallback text', async () => {
  const snap = snapBody([
    asstRow('askm_00000001', 1, { status: 'error', text: 'partial', errorMessage: undefined, blocks: [] }),
  ]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  assert.match(ctx.doc.querySelector('.ask-error-line').textContent, /This turn ended with an error\./);
});

test('ask-panel-render: notice with href renders an in-app link', async () => {
  const snap = snapBody([asstRow('askm_00000001', 1, { blocks: [{ kind: 'notice', text: 'Run started — "Fix login"', href: '#running/abc-123' }] })]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const a = ctx.doc.querySelector('.ask-notice a');
  assert.equal(a.getAttribute('href'), '#running/abc-123');
});

test('ask-panel-render: scroll pinning with instrumented accessors + jump pill', async () => {
  const snap = snapBody([asstRow('askm_00000001', 1)]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const t = ctx.doc.querySelector('.ask-transcript');
  Object.defineProperty(t, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(t, 'clientHeight', { value: 200, configurable: true });
  t.scrollTop = 100; // far from the bottom
  t.dispatchEvent(new ctx.window.Event('scroll'));
  const jump = ctx.doc.querySelector('.ask-jump');
  assert.equal(jump.hidden, false, 'unpinned shows the jump pill');
  jump.click();
  ctx.flush();
  assert.equal(t.scrollTop, 1000, 'jump scrolls to the bottom');
  assert.equal(jump.hidden, true);
  // near the bottom counts as pinned (threshold 24)
  t.scrollTop = 790;
  t.dispatchEvent(new ctx.window.Event('scroll'));
  assert.equal(jump.hidden, true);
});

test('ask-panel-render: reopening the sheet re-pins', async () => {
  const snap = snapBody([asstRow('askm_00000001', 1)]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const t = ctx.doc.querySelector('.ask-transcript');
  Object.defineProperty(t, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(t, 'clientHeight', { value: 200, configurable: true });
  t.scrollTop = 0;
  t.dispatchEvent(new ctx.window.Event('scroll'));
  assert.equal(ctx.doc.querySelector('.ask-jump').hidden, false);
  ctx.panel.close();
  ctx.panel.open();
  ctx.flush();
  assert.equal(t.scrollTop, 1000, 're-pinned on open');
});

test('ask-panel-render: a 404 thread clears the stored id and renders nothing', async () => {
  const ctx = makePanel({
    fetchHandler: (url) => (url.startsWith(`/api/ask/threads/${TID}`)
      ? { ok: false, status: 404, json: async () => ({ error: 'thread not found' }) }
      : { ok: true, status: 200, json: async () => listBody() }),
  });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  await openThread(ctx);
  assert.equal(ctx.doc.querySelector('.ask-msg-user'), null);
  assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), null, 'stored id dropped on 404');
});
```

- [ ] **Step 4.2: Run to verify failure**

Run: `node --disable-warning=ExperimentalWarning --test --test-force-exit test/ask-panel-render.test.mjs`
Expected: FAIL — the stubs render nothing (`.ask-msg-user` etc. absent).
- [ ] **Step 4.3: Implement.** Three edits to `ui/public/ask-panel.mjs`.

**(a)** Module-level formatting helpers — insert immediately BEFORE the line `export function createAskPanel({ doc, win, fetch`:

```js
export function fmtElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
}
function mmss(ms) {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function clipInput(input) {
  if (input && input._truncated === true) return String(input.preview ?? '');
  if (input == null) return '';
  let s = '';
  try { s = JSON.stringify(input); } catch { s = String(input); }
  if (s === '{}') return '';
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}
```

**(b)** Replace the three contiguous stubs

```js
  function renderTranscript() { /* [T4 replaces] */ }
  function loadThread(id) { return Promise.resolve(id && null); } // [T4 replaces]
  function switchThread(id) { /* [T7 replaces] */ }
```

with the transcript section:

```js
  // ---- transcript (spec §10.5) ---------------------------------------------
  function buildAttachmentPill(b) {
    const pill = make('span', 'extra-pill ask-attachment-pill');
    pill.appendChild(make('span', 'extra-pill-name', b.name || '(attachment)'));
    return pill;
  }

  function buildNotice(b) {
    const n = make('div', 'ask-notice');
    n.appendChild(make('span', null, b.text || ''));
    if (b.href) {
      n.appendChild(doc.createTextNode(' '));
      const a = make('a', 'ask-notice-link', 'open');
      a.setAttribute('href', b.href);
      n.appendChild(a);
    }
    return n;
  }

  function buildCard(block, row) { return make('div', 'ask-card', (block.card && (block.card.title || block.card.brief)) || 'Run proposal'); } // [T8 replaces]

  function toolRow(block) {
    const rowEl = make('div', 'ask-tool-row');
    const short = String(block.name || '').replace(/^mcp__worca__/, '');
    const parts = short.split('_');
    rowEl.appendChild(make('span', 'ask-tool-op', parts[0] || short));
    const target = parts.slice(1).join(' ');
    const preview = clipInput(block.input);
    rowEl.appendChild(make('span', 'ask-tool-target', preview ? (target ? `${target} · ${preview}` : preview) : target));
    const note = block.status === 'error' ? 'error' : block.status === 'running' ? '…' : fmtElapsed(block.durationMs);
    rowEl.appendChild(make('span', 'ask-tool-note', note || ''));
    return rowEl;
  }

  function agentRow(block) {
    const wrap = make('div', 'ask-agent');
    const rowEl = make('button', 'ask-agent-row');
    rowEl.type = 'button';
    rowEl.appendChild(make('span', `ask-dot${block.status === 'running' ? ' ask-dot-run' : block.status === 'done' ? ' ask-dot-done' : ''}`));
    rowEl.appendChild(make('span', 'ask-agent-name', block.label || block.type || 'agent'));
    rowEl.appendChild(make('span', 'ask-agent-model', block.model || ''));
    rowEl.appendChild(make('span', 'ask-agent-tokens', fmtTokens(block.tokens) || ''));
    rowEl.appendChild(make('span', 'ask-agent-cost', Number.isFinite(block.costUsd) ? `≈${fmtUsd(block.costUsd)}` : ''));
    rowEl.appendChild(make('span', `ask-agent-status${block.status === 'done' ? ' is-done' : ''}`, block.status || ''));
    rowEl.addEventListener('click', () => {
      if (st.expandedAgents.has(block.id)) st.expandedAgents.delete(block.id);
      else st.expandedAgents.add(block.id);
      const found = st.model && findRowOfBlock(block.id);
      if (found) refreshRow(found);
    });
    wrap.appendChild(rowEl);
    if (st.expandedAgents.has(block.id)) {
      const log = make('div', 'ask-agent-log');
      const head = make('div', 'ask-agent-log-head');
      head.appendChild(make('span', null, [block.model, fmtTokens(block.tokens), Number.isFinite(block.costUsd) ? `≈${fmtUsd(block.costUsd)}` : null].filter(Boolean).join(' · ')));
      head.appendChild(make('span', 'ask-agent-log-type', block.type || ''));
      log.appendChild(head);
      const body = make('div', 'ask-agent-log-body');
      for (const line of Array.isArray(block.log) ? block.log : []) {
        const l = make('div', 'ask-agent-log-line');
        l.appendChild(make('span', 'ask-agent-log-t', mmss(line.t)));
        l.appendChild(make('span', 'ask-agent-log-text', line.text || ''));
        body.appendChild(l);
      }
      log.appendChild(body);
      wrap.appendChild(log);
    }
    return wrap;
  }

  function findRowOfBlock(blockId) {
    for (const row of st.model.messages()) {
      if ((row.blocks || []).some((b) => b && b.id === blockId)) return row;
    }
    return null;
  }

  function refreshRow(row) {
    const entry = st.rowEls && st.rowEls.get(row.id);
    if (entry) entry.update(row);
  }

  function buildActivity(row) {
    const isLive = !!(st.model && st.model.live() && st.model.live().messageId === row.id);
    const live = isLive ? st.model.live() : null;
    const activity = make('div', 'ask-activity');
    const head = make('div', 'ask-activity-head');
    head.appendChild(make('span', `ask-dot${isLive ? ' ask-dot-run' : row.status === 'error' ? '' : ' ask-dot-done'}`));
    const label = isLive
      ? (live.label || 'Thinking')
      : row.status === 'stopped' || row.status === 'error' ? 'Stopped after' : 'Worked for';
    head.appendChild(make('span', 'ask-activity-label', label));
    const elapsed = make('span', 'ask-activity-elapsed', isLive ? '' : (fmtElapsed(row.durationMs) || ''));
    if (isLive) el.elapsed = elapsed; // the ONE live elapsed node; tickElapsed (Task 5) writes it
    head.appendChild(elapsed);
    head.appendChild(make('span', 'ask-activity-spacer'));
    const usage = isLive ? live.usage : row.usage;
    const cost = isLive ? live.costUsd : row.costUsd;
    const meter = [fmtTokens(totalsTokens(usage)), fmtUsd(cost)].filter(Boolean).join(' · ');
    head.appendChild(make('span', 'ask-activity-meter', meter));
    activity.appendChild(head);
    const tools = (row.blocks || []).filter((b) => b && b.kind === 'tool');
    for (const b of tools) activity.appendChild(toolRow(b));
    const agents = (row.blocks || []).filter((b) => b && b.kind === 'agent');
    if (agents.length) {
      const sect = make('div', 'ask-agents');
      const cap = make('div', 'ask-agents-cap');
      cap.appendChild(make('span', null, 'Sub-agents'));
      cap.appendChild(make('span', 'ask-agents-count', String(agents.length)));
      sect.appendChild(cap);
      for (const b of agents) sect.appendChild(agentRow(b));
      activity.appendChild(sect);
    }
    return { el: activity };
  }

  function renderAnswerInto(div, row) {
    const isLive = !!(st.model && st.model.live() && st.model.live().messageId === row.id);
    const text = isLive ? st.model.live().text : row.text || '';
    // Seed the >32 KB throttle clock here, not only in renderAnswerFor: a
    // structural flush repaints answers through renderTranscript, which never
    // passes through renderAnswerFor — left at 0, the 250 ms window would be
    // permanently expired and the size ladder dead.
    st.lastAnswerRender = now();
    if (!renderer.isReady() && !renderer.isFailed() && !st.mdKicked) {
      st.mdKicked = true;
      renderer.ensure().then((ok) => { if (ok && !st.destroyed) rerenderAnswers(); });
    }
    const out = renderer.render(text);
    if (out.kind === 'md') {
      div.classList.add('ask-md');
      div.classList.remove('ask-answer-plain');
      div.replaceChildren(out.frag);
      if (!isLive) renderer.highlight(div); // fire-and-forget; §10.5: highlight on done
    } else {
      div.classList.add('ask-answer-plain');
      div.classList.remove('ask-md');
      div.textContent = text;
    }
  }

  function rerenderAnswers() {
    if (!st.rowEls) return;
    for (const entry of st.rowEls.values()) { if (entry.renderAnswer) entry.renderAnswer(); }
    scheduleFlush();
  }

  function buildMessage(row) {
    const wrap = make('div', `ask-msg ask-msg-${row.role}`);
    let renderAnswer = null;
    if (row.role === 'user') {
      const bubble = make('div', 'ask-user-bubble', row.text || '');
      wrap.appendChild(bubble);
      const atts = (row.blocks || []).filter((b) => b && b.kind === 'attachment');
      if (atts.length) {
        const pills = make('div', 'extras-pills ask-user-pills');
        for (const b of atts) pills.appendChild(buildAttachmentPill(b));
        wrap.appendChild(pills);
      }
    } else if (row.role === 'system') {
      const notices = (row.blocks || []).filter((b) => b && b.kind === 'notice');
      if (notices.length) for (const b of notices) wrap.appendChild(buildNotice(b));
      else wrap.appendChild(buildNotice({ text: row.text }));
    } else {
      wrap.appendChild(buildActivity(row).el);
      const answer = make('div', 'ask-answer');
      wrap.appendChild(answer);
      renderAnswer = () => renderAnswerInto(answer, row);
      renderAnswer();
      for (const b of row.blocks || []) {
        if (!b) continue;
        if (b.kind === 'notice') wrap.appendChild(buildNotice(b));
        else if (b.kind === 'card') wrap.appendChild(buildCard(b, row));
      }
      if (row.status === 'error') {
        const explained = (row.blocks || []).some((b) => b && b.kind === 'notice');
        if (row.errorMessage) wrap.appendChild(make('div', 'ask-error-line', row.errorMessage));
        else if (!explained) wrap.appendChild(make('div', 'ask-error-line', 'This turn ended with an error.'));
      }
    }
    const entry = {
      el: wrap,
      renderAnswer,
      update(row2) {
        const fresh = buildMessage(row2);
        wrap.replaceWith(fresh.el);
        st.rowEls.set(row2.id, fresh);
      },
    };
    return entry;
  }

  function renderTranscript() {
    st.rowEls = new Map();
    el.transcript.replaceChildren();
    if (!st.model) return;
    for (const row of st.model.messages()) {
      const entry = buildMessage(row);
      st.rowEls.set(row.id, entry);
      el.transcript.appendChild(entry.el);
    }
  }

  async function loadThread(id) {
    let res = null;
    try { res = await fetch(`/api/ask/threads/${id}`); } catch { return null; }
    if (!res || !res.ok) {
      if (res && res.status === 404 && readStoredThread() === id) storeThread(null);
      return null;
    }
    let snap = null;
    try { snap = await res.json(); } catch { return null; }
    st.threadId = id;
    st.model = createThreadModel({ threadId: id });
    st.model.load(snap);
    el.title.textContent = (snap.thread && snap.thread.title) || 'Ask Worca';
    renderTranscript();
    updateMeters();
    st.pinned = true;
    scheduleFlush();
    if (snap.inFlight) subscribe(id);
    return snap;
  }

  function switchThread(id) {
    if (!id) return Promise.resolve(null);
    storeThread(id);
    return loadThread(id);
  }
```

**(c)** The jump pill. In `buildRoot`, replace

```js
    dock.appendChild(sheet);
    dock.appendChild(pill);
```

with

```js
    el.jump = make('button', 'ask-jump');
    el.jump.type = 'button';
    el.jump.appendChild(svgIcon(ICONS.down, 12, 2.2));
    el.jump.appendChild(make('span', null, 'Jump to latest'));
    el.jump.hidden = true;
    el.jump.addEventListener('click', jumpToLatest);
    sheet.appendChild(el.jump);
    dock.appendChild(sheet);
    dock.appendChild(pill);
```

and insert `jumpToLatest` immediately BEFORE the mount comment line — quote that anchor line IN FULL (no ellipsis; it is exactly):

```js
  // ---- mount ----------------------------------------------------------------
```


```js
  function jumpToLatest() {
    st.pinned = true;
    el.transcript.scrollTop = el.transcript.scrollHeight;
    if (el.jump) el.jump.hidden = true;
  }
```

- [ ] **Step 4.4: Run to verify pass**

Run: `node --disable-warning=ExperimentalWarning --test test/ask-panel-render.test.mjs test/ask-panel.test.mjs`
Expected: **20 pass / 0 fail** (10 new + the Task 3 ten stay green — the popover/threads flow now loads threads for real).

- [ ] **Step 4.5: Full suite**

Run: `npm test`
Expected: **3284 pass / 0 fail**.

- [ ] **Step 4.6: Commit**

```bash
git add ui/public/ask-panel.mjs test/ask-panel-render.test.mjs
git commit -m "worca ask p3: transcript rendering, thread load, scroll pinning"
```

---
### Task 5: Live streaming, flush loop, resync, hello

**Files:**
- Modify: `ui/public/ask-panel.mjs` (replace stubs `pushServerFrame`, `onHello`, `subscribe`, `resync`, `flushExtra`; add the frame side-effects + elapsed + throttled answer render; add an `updateSendStop` stub for Task 6)
- Test: `test/ask-panel-stream.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–4. Produces for Tasks 6–8/10: `pushServerFrame(frame)` (public), `onHello(list)` (public), `subscribe(threadId, {force})`, `resync()`, `startElapsed/stopElapsed`, `announce` side-effects (`'answer finished'`, `'run needs an answer'`), `updateSendStop` stub.

- [ ] **Step 5.1: Write the failing tests** — `test/ask-panel-stream.test.mjs`, full file:

```js
// test/ask-panel-stream.test.mjs — live frames → DOM (spec §10.5, §10.8).
// Frame streams come from the Task 1 helper; the panel is driven through its
// public pushServerFrame/onHello only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { replayFixture, stampFrames } from './helpers/ask-frames.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';

function snapBody(over = {}) {
  return {
    thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
    messages: [{ id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' }],
    attachments: [], runLinks: [], inFlight: null, ...over,
  };
}

function handlerFor(snapshotRef) {
  return (url) => {
    if (url.startsWith(`/api/ask/threads/${TID}`)) return { ok: true, status: 200, json: async () => snapshotRef.body };
    if (url.startsWith('/api/ask/threads')) return { ok: true, status: 200, json: async () => ({ threads: [{ id: TID, title: 'T', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

async function openWith(snapshotRef, overrides = {}) {
  const ctx = makePanel({ fetchHandler: handlerFor(snapshotRef), ...overrides });
  ctx.panel.open();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  ctx.doc.querySelector('.ask-pop [role="menuitem"]').click();
  await ctx.tick();
  await ctx.tick();
  ctx.flush();
  return ctx;
}

test('ask-panel-stream: frames for another thread are ignored', async () => {
  // NB this pins the MODEL's filter through the panel path — the panel's own check is unobservable defence-in-depth.
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'not mine', threadId: 'ask_ffffffff', messageId: MID, seq: 1 });
  ctx.flush();
  assert.ok(!ctx.doc.querySelector('.ask-transcript').textContent.includes('not mine'));
});

test('ask-panel-stream: plain-text stream — dot, label, growing answer, done state', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID, threadTotals: { costUsd: 0.02, input: 10, output: 44, cacheRead: 0, cacheCreation: 11290, turns: 1, agents: 0 } });
  const done = frames[frames.length - 1];
  for (const f of frames.slice(0, -1)) ctx.panel.pushServerFrame(f);
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-dot-run'), 'violet running dot while streaming');
  assert.match(ctx.doc.querySelector('.ask-activity-label').textContent, /Thinking|Writing/);
  assert.match(ctx.doc.querySelector('.ask-answer').textContent, /pong/);
  ctx.panel.pushServerFrame(done);
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-dot-done'), 'green dot after done');
  assert.match(ctx.doc.querySelector('.ask-activity-label').textContent, /Worked for/);
  assert.equal(ctx.doc.querySelector('.sr-only[aria-live="polite"]').textContent, 'answer finished');
});

test('ask-panel-stream: tool rows stream in with server labels', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const { frames } = replayFixture('tool-list-runs', { threadId: TID, messageId: MID });
  let sawFindingRuns = false;
  let sawRunningTool = false;
  for (const f of frames) {
    ctx.panel.pushServerFrame(f);
    ctx.flush();
    const label = ctx.doc.querySelector('.ask-activity-label');
    if (label && /Finding runs/.test(label.textContent)) sawFindingRuns = true;
    const note = ctx.doc.querySelector('.ask-tool-note');
    if (note && note.textContent === '…') sawRunningTool = true;
  }
  assert.ok(sawFindingRuns, 'the server label rendered mid-stream');
  assert.ok(sawRunningTool, 'the tool row rendered while running');
  assert.equal(ctx.doc.querySelectorAll('.ask-tool-row').length >= 1, true);
});

test('ask-panel-stream: sub-agent expands mid-stream and stays expanded to the end', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const { frames } = replayFixture('task-subagent', { threadId: TID, messageId: MID });
  const firstAgentAt = frames.findIndex((f) => f.type === 'ask-block' && f.block.kind === 'agent');
  for (const f of frames.slice(0, firstAgentAt + 1)) ctx.panel.pushServerFrame(f);
  ctx.flush();
  const row = ctx.doc.querySelector('.ask-agent-row');
  assert.ok(row);
  row.click();
  assert.ok(ctx.doc.querySelector('.ask-agent-log'), 'expanded mid-stream');
  for (const f of frames.slice(firstAgentAt + 1)) ctx.panel.pushServerFrame(f);
  ctx.flush();
  const log = ctx.doc.querySelector('.ask-agent-log');
  assert.ok(log, 'still expanded after the agent finished');
  assert.match(log.textContent, /→ list_runs/);
  assert.match(ctx.doc.querySelector('.ask-agent-row').textContent, /claude-haiku-4-5/);
});

test('ask-panel-stream: max-turns ends stopped with the notice and Stopped after', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const { frames } = replayFixture('max-turns', { threadId: TID, messageId: MID });
  for (const f of frames) ctx.panel.pushServerFrame(f);
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-activity-label').textContent, /Stopped after/);
  assert.match(ctx.doc.querySelector('.ask-notice').textContent, /Stopped: reached the 40-turn limit/);
});

test('ask-panel-stream: ask-error keeps the partial text and shows the red line', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const bare = [
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-delta', text: 'partial ' },
    { type: 'ask-delta', text: 'answer' },
    { type: 'ask-error', message: 'claude exited with code 1: boom', errorClass: null },
  ];
  for (const f of stampFrames(bare, { threadId: TID, messageId: MID })) ctx.panel.pushServerFrame(f);
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-answer').textContent, /partial answer/);
  assert.match(ctx.doc.querySelector('.ask-error-line').textContent, /claude exited with code 1: boom/);
});

test('ask-panel-stream: a seq gap triggers one REST resync + forced resubscribe', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const getsBefore = ctx.fetchCalls.filter((c) => c.url.startsWith(`/api/ask/threads/${TID}`)).length;
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  // now simulate a mid-stream turn in the snapshot so the resync resubscribes
  ref.body = snapBody({ inFlight: { messageId: MID } });
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'lost', threadId: TID, messageId: MID, seq: 5 });
  await ctx.tick();
  await ctx.tick();
  const getsAfter = ctx.fetchCalls.filter((c) => c.url.startsWith(`/api/ask/threads/${TID}`)).length;
  assert.equal(getsAfter, getsBefore + 1, 'exactly one re-fetch');
  assert.deepEqual(ctx.wsSends.at(-1), { type: 'subscribe', threadId: TID }, 'resubscribed after the re-fetch');
  // the replay then applies cleanly via adoption
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'recovered', threadId: TID, messageId: MID, seq: 6 });
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-answer').textContent, /recovered/);
});

test('ask-panel-stream: onHello re-syncs the active running thread on a fresh socket', async () => {
  const ref = { body: snapBody({ inFlight: { messageId: MID } }) };
  const ctx = await openWith(ref);
  const before = ctx.wsSends.length;
  ctx.panel.onHello([{ threadId: TID, messageId: MID }]);
  await ctx.tick();
  await ctx.tick();
  assert.ok(ctx.wsSends.length > before, 'resubscribed');
  assert.deepEqual(ctx.wsSends.at(-1), { type: 'subscribe', threadId: TID });
  ctx.panel.onHello(undefined); // older server — must not throw
});

test('ask-panel-stream: replaying the whole stream twice renders once', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID });
  for (const f of frames) ctx.panel.pushServerFrame(f);
  for (const f of frames) ctx.panel.pushServerFrame(f);
  ctx.flush();
  const text = ctx.doc.querySelector('.ask-transcript').textContent;
  assert.equal(text.match(/pong/g).length, 1, 'no duplicated answer');
  assert.equal(ctx.doc.querySelectorAll('.ask-msg-assistant').length, 1);
});

test('ask-panel-stream: elapsed renders from injected now and ticks via flush', async () => {
  let t = 1_000_000;
  const ref = { body: snapBody() };
  const ctx = await openWith(ref, { now: () => t });
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 'x', threadId: TID, messageId: MID, seq: 1 });
  ctx.flush();
  t += 6400;
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-activity-elapsed').textContent, /6\.4s/);
});

test('ask-panel-stream: big answers re-render at most every 250 ms', async () => {
  let t = 1_000_000;
  const ref = { body: snapBody() };
  const ctx = await openWith(ref, { now: () => t });
  const big = 'x'.repeat(40_000);
  const bare = [
    { type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 'x' },
    { type: 'ask-delta', text: big },
  ];
  const stamped = stampFrames(bare, { threadId: TID, messageId: MID });
  ctx.panel.pushServerFrame(stamped[0]);
  ctx.panel.pushServerFrame(stamped[1]);
  ctx.flush(); // first render always happens
  assert.equal(ctx.doc.querySelector('.ask-answer').textContent.length, 40_000);
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'TAIL', threadId: TID, messageId: MID, seq: 3 });
  ctx.flush(); // within 250 ms — throttled
  assert.ok(!ctx.doc.querySelector('.ask-answer').textContent.includes('TAIL'), 'render throttled inside the window');
  t += 300;
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-answer').textContent.includes('TAIL'), 'rendered once the window passed');
});

test('ask-panel-stream: an active selection inside the answer defers the re-render', async (tst) => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const bare = [
    { type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 'x' },
    { type: 'ask-delta', text: 'select me' },
  ];
  for (const f of stampFrames(bare, { threadId: TID, messageId: MID })) ctx.panel.pushServerFrame(f);
  ctx.flush();
  const answer = ctx.doc.querySelector('.ask-answer');
  const sel = ctx.window.getSelection();
  try {
    const range = ctx.doc.createRange();
    range.selectNodeContents(answer);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { /* jsdom selection quirk */ }
  if (!sel.rangeCount || sel.isCollapsed) { tst.skip('jsdom cannot hold a non-collapsed selection'); return; }
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: ' MORE', threadId: TID, messageId: MID, seq: 3 });
  ctx.flush();
  assert.ok(!answer.textContent.includes('MORE'), 'deferred while selected');
  sel.removeAllRanges();
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-answer').textContent.includes('MORE'), 'rendered after the selection cleared');
});

test('ask-panel-stream: a gap on an already-subscribed thread still re-requests the replay', async () => {
  const ref = { body: snapBody({ inFlight: { messageId: MID } }) };
  const ctx = await openWith(ref);
  const subs = () => ctx.wsSends.filter((s) => s.type === 'subscribe' && s.threadId === TID).length;
  assert.equal(subs(), 1, 'loadThread subscribed once');
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'lost', threadId: TID, messageId: MID, seq: 9 });
  await ctx.tick();
  await ctx.tick();
  assert.equal(subs(), 2, 'the forced resubscribe re-requests the ring replay');
});
```

- [ ] **Step 5.2: Run to verify failure**

Run: `node --disable-warning=ExperimentalWarning --test --test-force-exit test/ask-panel-stream.test.mjs`
Expected: FAIL — `pushServerFrame` is a stub; nothing renders.
- [ ] **Step 5.3: Implement.** In `ui/public/ask-panel.mjs`, ONE Edit. Its `old_string` is all SIX contiguous stub lines of the Task 3 skeleton:

```js
  function pushServerFrame(frame) { /* [T5 replaces] */ }
  function onHello(list) { /* [T5 replaces] */ }
  function subscribe(threadId) { /* [T5 replaces] */ }
  function resync() { /* [T5 replaces] */ }
  function updateMeters() { /* [T6 replaces] */ }
  function flushExtra() { /* [T5 replaces] */ }
```

Its `new_string` re-emits the `updateMeters` stub unchanged (Task 6 owns it), then the streaming section:

```js
  function updateMeters() { /* [T6 replaces] */ }

  // ---- live streaming (spec §10.8) -----------------------------------------
  function rowOf(id) {
    if (!st.model) return null;
    for (const r of st.model.messages()) if (r && r.id === id) return r;
    return null;
  }

  function hasSelectionInside(entry) {
    let sel = null;
    try { sel = win.getSelection ? win.getSelection() : null; } catch { return false; }
    if (!sel || !sel.rangeCount || sel.isCollapsed) return false;
    return containsNode(entry.el, sel.anchorNode) || containsNode(entry.el, sel.focusNode);
  }

  // Streaming answers re-parse the whole accumulated text (spec §10.5); the
  // ladder bounds the cost: ≤32 KB every flush, above that at most one render
  // per 250 ms (measured ≈50 ms/64 KB under jsdom), >200 KB the renderer
  // itself falls back to plain. A live selection inside the answer defers the
  // render to the next flush (§10.8).
  function renderAnswerFor(id) {
    const entry = st.rowEls && st.rowEls.get(id);
    const row = rowOf(id);
    if (!row) return;
    if (!entry || !entry.renderAnswer) { refreshRow(row); return; }
    const live = st.model.live();
    const isLive = !!(live && live.messageId === id);
    if (isLive) {
      if (live.text.length > 32_000 && now() - st.lastAnswerRender < 250) { st.answerPending = id; scheduleFlush(); return; }
      if (hasSelectionInside(entry)) { st.answerPending = id; scheduleFlush(); return; }
    }
    st.lastAnswerRender = now();
    entry.renderAnswer();
  }

  function startElapsed() {
    st.elapsedStart = now();
    if (st.elapsedTimer) clearInterval(st.elapsedTimer);
    // Bare setInterval on purpose (app.js:14247-14253 precedent): in a browser
    // it IS window.setInterval; under node:test this module resolves it to
    // Node's global, whose Timeout can be unref'd — jsdom's window.setInterval
    // returns a bare number with no unref(), and a leaked 1s tick would hold
    // the event loop open for every turn a test leaves streaming.
    st.elapsedTimer = setInterval(() => scheduleFlush(), 1000);
    if (st.elapsedTimer && typeof st.elapsedTimer.unref === 'function') st.elapsedTimer.unref();
  }
  function stopElapsed() {
    if (st.elapsedTimer) { clearInterval(st.elapsedTimer); st.elapsedTimer = null; }
    st.elapsedStart = null;
  }
  function updateLiveElapsed() {
    if (st.elapsedStart != null && el.elapsed && st.model && st.model.live()) {
      el.elapsed.textContent = fmtElapsed(now() - st.elapsedStart);
    }
  }

  function afterFrame(frame) {
    if (frame.type === 'ask-start') { startElapsed(); updateSendStop(); }
    else if (frame.type === 'ask-done' || frame.type === 'ask-error') { stopElapsed(); updateSendStop(); announce('answer finished'); }
    else if (frame.type === 'ask-message' && frame.message && typeof frame.message.text === 'string'
      && /is waiting for your answer/.test(frame.message.text)) announce('run needs an answer');
  }

  function pushServerFrame(frame) {
    // Defence-in-depth: the model's own threadId filter is the real router — this early return only saves an apply() call and cannot be observed from tests (the model would drop the frame identically).
    if (st.destroyed || !frame || !st.model || frame.threadId !== st.threadId) return;
    const r = st.model.apply(frame);
    if (r && r.gap) { resync(); return; }
    if (!r || !r.ok) return;
    afterFrame(frame);
    scheduleFlush();
  }

  function subscribe(threadId, { force = false } = {}) {
    if (!threadId) return;
    if (!force && st.subscribedFor === threadId) return;
    st.subscribedFor = threadId;
    sendWs({ type: 'subscribe', threadId });
  }

  // Re-fetch + resubscribe (spec §10.8: a seq gap or a reconnect re-syncs over
  // REST — the ring buffer replay then re-plays from seq 1 and the model's seq
  // dedupe/adoption absorb it). Latched: one resync at a time.
  function resync() {
    if (st.resyncing || !st.threadId || st.destroyed) return;
    st.resyncing = true;
    const id = st.threadId;
    Promise.resolve()
      .then(() => loadThread(id))
      .then((snap) => { if (snap && snap.inFlight) subscribe(id, { force: true }); })
      .catch(() => { /* the thread may be gone; loadThread handled storage */ })
      .then(() => { st.resyncing = false; });
  }

  function onHello(list) {
    if (st.destroyed || !Array.isArray(list)) return;
    st.subscribedFor = null; // a fresh socket forgot every prior subscribe
    const mine = st.threadId && list.some((x) => x && x.threadId === st.threadId);
    if (mine) resync();
  }

  function updateSendStop() { /* [T6 replaces] */ }

  function flushExtra() {
    if (!st.model) return;
    if (st.answerPending) { const pid = st.answerPending; st.answerPending = null; renderAnswerFor(pid); }
    const d = st.model.takeDirty();
    if (d.title) el.title.textContent = st.model.thread().title || 'Ask Worca';
    if (d.structure) {
      renderTranscript();
    } else {
      for (const id of d.messages) { const row = rowOf(id); if (row) refreshRow(row); }
      if (d.label && st.model.live()) { const row = rowOf(st.model.live().messageId); if (row) refreshRow(row); }
      for (const id of d.blocks.keys()) {
        if (d.messages.has(id)) continue;
        if (d.label && st.model.live() && st.model.live().messageId === id) continue; // already rebuilt
        const row = rowOf(id);
        if (row) refreshRow(row);
      }
      for (const id of d.answer) renderAnswerFor(id);
    }
    if (d.meters) updateMeters();
    updateLiveElapsed();
  }
```

The single Edit above must leave exactly ONE definition of each function in the file — verify with `grep -c "function subscribe" ui/public/ask-panel.mjs` → 1, same for `pushServerFrame`, `onHello`, `resync`, `updateMeters`, `flushExtra`, `updateSendStop`.

- [ ] **Step 5.4: Run to verify pass**

Run: `node --disable-warning=ExperimentalWarning --test test/ask-panel-stream.test.mjs test/ask-panel-render.test.mjs test/ask-panel.test.mjs`
Expected: **33 pass / 0 fail** (13 new — the selection test may report 1 skip if jsdom cannot hold a non-collapsed selection; record which).

- [ ] **Step 5.5: Full suite**

Run: `npm test`
Expected: **3297 pass / 0 fail**.

- [ ] **Step 5.6: Commit**

```bash
git add ui/public/ask-panel.mjs test/ask-panel-stream.test.mjs
git commit -m "worca ask p3: live streaming, flush loop, resync"
```

---
### Task 6: Composer, attachments, send/stop

**Files:**
- Modify: `ui/public/ask-panel.mjs` (replace `buildComposer`, `sendMessage`, `updateSendStop`, `updateMeters` stubs; add `addFiles/renderChips/setComposerMsg/stopTurn/bytesToBase64` + popover stubs for Task 7)
- Test: `test/ask-panel-composer.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–5. Produces: the full composer DOM (`.ask-composer`, `textarea.ask-input`, hidden `input[type=file]` + `[data-ask-attach-btn]`, chips `.ask-chip`, `.ask-composer-msg`, meter `[data-ask-meter]` with `.ask-meter-tokens/.ask-meter-cost` + `[data-ask-agents-btn]`, `[data-ask-model-btn]` (Task 7 wires its popover), `[data-ask-send]`/`[data-ask-stop]`), `sendMessage()`, `addFiles(fileList)`, `stopTurn()`, real `updateSendStop()`/`updateMeters()`; stubs `openModelPopover`/`openRunInfoPopover` for Task 7.
- Send contract (restated): create-thread-on-first-send (`POST /api/ask/threads {}` → 201), then `POST /api/ask/threads/:id/messages {text, model, effort, context, attachments?}` → 202 → optimistic user row by the returned `userMessageId` (the out-of-turn echo replaces it), local deterministic title (`text.slice(0,80)` — NO frame exists for it), clear input+chips, `subscribe`, re-pin. Any non-202 renders the response `error` VERBATIM in `.ask-composer-msg`. Client caps (V9): extension allowlist `.md .markdown .txt .json .csv .log`, dedupe by name newest-wins, max 8, `File.size` > 524288 rejected pre-read, 4 MB thread budget (server bytes + pending). Enter sends, Shift+Enter inserts a newline (composer textarea only).

- [ ] **Step 6.1: Write the failing tests** — `test/ask-panel-composer.test.mjs`, full file:

```js
// test/ask-panel-composer.test.mjs — composer, attachments, send/stop
// (spec §10.6, §7.3 client mirror). jsdom has no DataTransfer — files are
// injected with defineProperty(input,'files') (probed working under jsdom 29).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel, key } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';

function apiHandler(calls = {}) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url === '/api/ask/threads' && method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ thread: { id: TID, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } }) };
    }
    if (url === `/api/ask/threads/${TID}/messages` && method === 'POST') {
      if (calls.messages) return calls.messages(url, opts);
      return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: MID }) };
    }
    if (url === `/api/ask/threads/${TID}/stop` && method === 'POST') {
      calls.stopped = (calls.stopped || 0) + 1;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

function injectFiles(ctx, files) {
  const input = ctx.doc.querySelector('.ask-composer input[type="file"]');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
}

const mkFile = (ctx, name, content) => new ctx.window.File([content], name, { type: 'text/plain' });

test('ask-panel-composer: attach → chip; send posts base64 attachments and the picker model', async () => {
  const bodies = [];
  const calls = {
    messages: (url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: MID }) }; },
  };
  const ctx = makePanel({ fetchHandler: apiHandler(calls), getPageContext: () => ({ view: 'new' }) });
  ctx.panel.open();
  injectFiles(ctx, [mkFile(ctx, 'notes.md', 'hello world')]);
  await ctx.tick();
  await ctx.tick();
  const chip = ctx.doc.querySelector('.ask-chip');
  assert.ok(chip);
  assert.match(chip.textContent, /notes\.md/);
  ctx.doc.querySelector('textarea.ask-input').value = 'summarize the notes';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick();
  await ctx.tick();
  await ctx.tick();
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].text, 'summarize the notes');
  assert.equal(bodies[0].model, 'claude-opus-5');
  assert.equal(bodies[0].effort, 'high');
  assert.deepEqual(bodies[0].context, { view: 'new' });
  assert.equal(bodies[0].attachments.length, 1);
  assert.equal(bodies[0].attachments[0].name, 'notes.md');
  assert.equal(bodies[0].attachments[0].dataBase64, Buffer.from('hello world').toString('base64'));
  // 202 aftermath: optimistic user row, cleared composer, local title, stored thread
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-msg-user').textContent, /summarize the notes/);
  assert.equal(ctx.doc.querySelector('textarea.ask-input').value, '');
  assert.equal(ctx.doc.querySelector('.ask-chip'), null, 'chips cleared after send');
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'summarize the notes');
  assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), TID);
  assert.deepEqual(ctx.wsSends.at(-1), { type: 'subscribe', threadId: TID });
});

test('ask-panel-composer: dedupe by name — newest wins, one chip', async () => {
  const ctx = makePanel({ fetchHandler: apiHandler() });
  ctx.panel.open();
  injectFiles(ctx, [mkFile(ctx, 'a.md', 'first')]);
  await ctx.tick(); await ctx.tick();
  injectFiles(ctx, [mkFile(ctx, 'a.md', 'second')]);
  await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelectorAll('.ask-chip').length, 1);
});

test('ask-panel-composer: bad extension and oversize rejected inline; the × removes a chip', async () => {
  const ctx = makePanel({ fetchHandler: apiHandler() });
  ctx.panel.open();
  injectFiles(ctx, [mkFile(ctx, 'evil.exe', 'x')]);
  await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-chip'), null);
  assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /attachment type not allowed: evil\.exe/);
  injectFiles(ctx, [mkFile(ctx, 'big.md', 'x'.repeat(524_289))]);
  await ctx.tick(); await ctx.tick();
  assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /attachment over 524288 bytes: big\.md/);
  injectFiles(ctx, [mkFile(ctx, 'ok.md', 'fine')]);
  await ctx.tick(); await ctx.tick();
  assert.ok(ctx.doc.querySelector('.ask-chip'));
  ctx.doc.querySelector('.ask-chip .ask-chip-x').click();
  assert.equal(ctx.doc.querySelector('.ask-chip'), null);
});

test('ask-panel-composer: at most 8 attachments', async () => {
  const ctx = makePanel({ fetchHandler: apiHandler() });
  ctx.panel.open();
  injectFiles(ctx, Array.from({ length: 9 }, (_, i) => mkFile(ctx, `f${i}.md`, 'x')));
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelectorAll('.ask-chip').length, 8);
  assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /at most 8 attachments per message/);
});

test('ask-panel-composer: Enter sends, Shift+Enter does not', async () => {
  const bodies = [];
  const calls = { messages: (url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: MID }) }; } };
  const ctx = makePanel({ fetchHandler: apiHandler(calls) });
  ctx.panel.open();
  const input = ctx.doc.querySelector('textarea.ask-input');
  input.value = 'hello';
  const shift = key(ctx.window, input, 'Enter', { shiftKey: true });
  assert.equal(shift.defaultPrevented, false, 'Shift+Enter keeps the native newline');
  assert.equal(bodies.length, 0);
  const plain = key(ctx.window, input, 'Enter');
  assert.equal(plain.defaultPrevented, true);
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(bodies.length, 1);
});

test('ask-panel-composer: a 409 body renders verbatim and the composer keeps the text', async () => {
  const calls = { messages: () => ({ ok: false, status: 409, json: async () => ({ error: 'turn in flight' }) }) };
  const ctx = makePanel({ fetchHandler: apiHandler(calls) });
  ctx.panel.open();
  ctx.doc.querySelector('textarea.ask-input').value = 'try again later';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-composer-msg').textContent, 'turn in flight');
  assert.equal(ctx.doc.querySelector('textarea.ask-input').value, 'try again later', 'text preserved on failure');
});

test('ask-panel-composer: a 413 body renders verbatim', async () => {
  const calls = { messages: () => ({ ok: false, status: 413, json: async () => ({ error: 'attachment budget for this thread exceeded' }) }) };
  const ctx = makePanel({ fetchHandler: apiHandler(calls) });
  ctx.panel.open();
  ctx.doc.querySelector('textarea.ask-input').value = 'big send';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-composer-msg').textContent, 'attachment budget for this thread exceeded');
});

test('ask-panel-composer: streaming swaps send→stop; stop POSTs; done swaps back', async () => {
  const calls = {};
  const ctx = makePanel({ fetchHandler: apiHandler(calls) });
  ctx.panel.open();
  ctx.doc.querySelector('textarea.ask-input').value = 'hello';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const bare = [{ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' }];
  for (const f of stampFrames(bare, { threadId: TID, messageId: MID })) ctx.panel.pushServerFrame(f);
  ctx.flush();
  assert.equal(ctx.doc.querySelector('[data-ask-send]').hidden, true);
  assert.equal(ctx.doc.querySelector('[data-ask-stop]').hidden, false);
  ctx.doc.querySelector('[data-ask-stop]').click();
  await ctx.tick();
  assert.equal(calls.stopped, 1, 'stop POSTed');
  const doneBare = [{ type: 'ask-done', text: 'ok', blocks: [], usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 5, model: 'm', status: 'stopped', reason: 'user', threadTotals: { costUsd: 0, input: 1, output: 1, cacheRead: 0, cacheCreation: 0, turns: 1, agents: 0 } }];
  ctx.panel.pushServerFrame({ ...doneBare[0], threadId: TID, messageId: MID, seq: 2 });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('[data-ask-send]').hidden, false);
  assert.equal(ctx.doc.querySelector('[data-ask-stop]').hidden, true);
});

test('ask-panel-composer: the user echo replaces the optimistic row (no duplicate)', async () => {
  const ctx = makePanel({ fetchHandler: apiHandler() });
  ctx.panel.open();
  ctx.doc.querySelector('textarea.ask-input').value = 'echo me';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.flush();
  assert.equal(ctx.doc.querySelectorAll('.ask-msg-user').length, 1);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'echo me', blocks: [], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' } });
  ctx.flush();
  assert.equal(ctx.doc.querySelectorAll('.ask-msg-user').length, 1, 'upsert by id, not append');
});

test('ask-panel-composer: the meter shows thread totals after done', async () => {
  const ctx = makePanel({ fetchHandler: apiHandler() });
  ctx.panel.open();
  ctx.doc.querySelector('textarea.ask-input').value = 'meter me';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-meter-cost').textContent, '', 'no cost rendered before a result');
  const frames = stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-done', text: 'ok', blocks: [], usage: { input: 900, output: 1100, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.14, durationMs: 5, model: 'm', status: 'done', threadTotals: { costUsd: 0.25, input: 9000, output: 10600, cacheRead: 0, cacheCreation: 0, turns: 2, agents: 6 } },
  ], { threadId: TID, messageId: MID });
  for (const f of frames) ctx.panel.pushServerFrame(f);
  ctx.flush();
  const meter = ctx.doc.querySelector('[data-ask-meter]');
  assert.match(meter.textContent, /19\.6k tok/);
  assert.match(meter.textContent, /\$0\.25/);
  assert.match(ctx.doc.querySelector('[data-ask-agents-btn]').textContent, /6 agents/);
});
```

- [ ] **Step 6.2: Run to verify failure**

Run: `node --disable-warning=ExperimentalWarning --test --test-force-exit test/ask-panel-composer.test.mjs`
Expected: FAIL — no file input, `sendMessage` is a stub.
- [ ] **Step 6.3: Implement.** In `ui/public/ask-panel.mjs`: replace the whole Task-3 `buildComposer` function, the `sendMessage` stub, the `updateSendStop` stub (from Task 5) and the `updateMeters` stub (from Task 3) with:

```js
  const ASK_ATTACH_EXT = ['.md', '.markdown', '.txt', '.json', '.csv', '.log'];

  function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return win.btoa(bin);
  }

  function setComposerMsg(text) {
    el.composerMsg.textContent = text || '';
    el.composerMsg.hidden = !text;
  }

  function renderChips() {
    el.chips.replaceChildren();
    el.chips.hidden = !st.pendingFiles.length;
    for (const f of st.pendingFiles) {
      const chip = make('span', 'ask-chip');
      chip.appendChild(make('span', 'ask-chip-name', f.name));
      const x = make('button', 'ask-chip-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', `Remove ${f.name}`);
      x.addEventListener('click', () => {
        st.pendingFiles = st.pendingFiles.filter((p) => p !== f);
        renderChips();
      });
      chip.appendChild(x);
      el.chips.appendChild(chip);
    }
  }

  async function addFiles(fileList) {
    for (const f of [...(fileList || [])]) {
      const name = String(f.name || '');
      const dot = name.lastIndexOf('.');
      const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
      if (!ASK_ATTACH_EXT.includes(ext)) { setComposerMsg(`attachment type not allowed: ${name}`); continue; }
      if (f.size > 524_288) { setComposerMsg(`attachment over 524288 bytes: ${name}`); continue; }
      const others = st.pendingFiles.filter((p) => p.name !== name); // dedupe by name, newest wins
      if (others.length >= 8) { setComposerMsg('at most 8 attachments per message'); continue; }
      const serverBytes = st.model ? st.model.attachmentsBytes() : 0;
      const pendingBytes = others.reduce((n, p) => n + p.bytes, 0);
      if (serverBytes + pendingBytes + f.size > 4 * 1024 * 1024) { setComposerMsg('attachment budget for this thread exceeded'); continue; }
      let dataBase64 = '';
      try {
        dataBase64 = bytesToBase64(new Uint8Array(await f.arrayBuffer()));
      } catch { setComposerMsg(`could not read ${name}`); continue; }
      st.pendingFiles = [...others, { name, bytes: f.size, dataBase64 }];
    }
    renderChips();
  }

  function updateSendStop() {
    if (!el.send) return;
    const streaming = !!(st.model && st.model.live());
    el.send.hidden = streaming;
    el.stop.hidden = !streaming;
  }

  function updateMeters() {
    if (!el.meterTokens) return;
    const totals = st.model ? st.model.totals() : { live: null };
    const liveTok = totals.live ? totalsTokens(totals.live.usage) : 0;
    el.meterTokens.textContent = fmtTokens(totalsTokens(totals) + liveTok) || '0 tok';
    // cost comes from thread totals only — never from a live null (P3-F5)
    // No cost yet → empty cell, never a fabricated $0.00 (P3-F5).
    el.meterCost.textContent = totals.costUsd == null ? '' : (fmtUsd(totals.costUsd) || '');
    el.agentsBtnLabel.textContent = fmtAgents(totals.agents) || '0 agents';
  }

  function stopTurn() {
    if (!st.threadId) return;
    Promise.resolve()
      .then(() => fetch(`/api/ask/threads/${st.threadId}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))
      .catch(() => { /* the turn will end via its own frames */ });
  }

  function openModelPopover(trigger) { /* [T7 replaces] */ }
  function openRunInfoPopover(trigger) { /* [T7 replaces] */ }

  async function sendMessage() {
    if (st.sending || st.destroyed) return;
    if (st.model && st.model.live()) return; // a turn is streaming — the stop button is showing
    const text = el.input.value.trim();
    if (!text) return;
    st.sending = true;
    setComposerMsg(null);
    try {
      let id = st.threadId;
      if (!id) {
        let r = null;
        try {
          r = await fetch('/api/ask/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        } catch { r = null; }
        if (!r || (r.status !== 201 && !r.ok)) { setComposerMsg('could not create the thread'); return; }
        const body = await r.json();
        id = body.thread.id;
        st.threadId = id;
        st.model = createThreadModel({ threadId: id });
        st.model.load({ thread: body.thread, messages: [], attachments: [], runLinks: [], inFlight: null });
        renderTranscript();
        storeThread(id);
      }
      const payload = {
        text,
        model: st.picker.model,
        effort: st.picker.effort,
        context: getPageContext() || {},
        ...(st.pendingFiles.length ? { attachments: st.pendingFiles.map((f) => ({ name: f.name, dataBase64: f.dataBase64 })) } : {}),
      };
      let res = null;
      try {
        res = await fetch(`/api/ask/threads/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } catch { setComposerMsg('network error — the message was not sent'); return; }
      if (!res || res.status !== 202) {
        let msg = `request failed (${res ? res.status : 'network'})`;
        try { const b = await res.json(); if (b && b.error) msg = b.error; } catch { /* keep the fallback */ }
        setComposerMsg(msg);
        return;
      }
      const { userMessageId } = await res.json();
      st.model.noteLocalUserMessage({ id: userMessageId, text, attachments: st.pendingFiles.map((f) => ({ name: f.name, bytes: f.bytes })) });
      if (!st.model.thread().title) {
        // The deterministic first title has NO frame — record it in the MODEL
        // as well as the header: model.load() left `title` dirty and the very
        // next flushExtra() repaints el.title from thread().title.
        st.model.thread().title = text.slice(0, 80);
        el.title.textContent = st.model.thread().title;
      }
      el.input.value = '';
      st.pendingFiles = [];
      renderChips();
      subscribe(id);
      st.pinned = true;
      scheduleFlush();
    } finally {
      st.sending = false;
      updateSendStop();
    }
  }

  function buildComposer() {
    const wrap = make('div', 'ask-composer');

    el.chips = make('div', 'ask-chips');
    el.chips.hidden = true;
    wrap.appendChild(el.chips);

    el.input = doc.createElement('textarea');
    el.input.className = 'ask-input';
    el.input.rows = 1;
    el.input.placeholder = 'Ask about any run, agent, or project…';
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
    });
    el.input.addEventListener('input', () => {
      el.input.style.height = 'auto';
      el.input.style.height = `${Math.min(el.input.scrollHeight || 0, 120)}px`;
    });
    wrap.appendChild(el.input);

    el.composerMsg = make('div', 'ask-composer-msg');
    el.composerMsg.hidden = true;
    wrap.appendChild(el.composerMsg);

    const row = make('div', 'ask-composer-row');

    el.fileInput = doc.createElement('input');
    el.fileInput.type = 'file';
    el.fileInput.multiple = true;
    el.fileInput.accept = `${ASK_ATTACH_EXT.join(',')},text/*`;
    el.fileInput.hidden = true;
    el.fileInput.addEventListener('change', () => { addFiles(el.fileInput.files); el.fileInput.value = ''; });
    row.appendChild(el.fileInput);
    const attach = iconButton('ask-icon-btn', 'Attach files', ICONS.plus, () => el.fileInput.click());
    attach.setAttribute('data-ask-attach-btn', '');
    row.appendChild(attach);

    row.appendChild(make('span', 'ask-composer-spacer'));

    const meter = make('span', 'ask-meter');
    meter.setAttribute('data-ask-meter', '');
    el.meterTokens = make('span', 'ask-meter-tokens', '0 tok');
    meter.appendChild(el.meterTokens);
    meter.appendChild(make('span', 'ask-meter-sep', '|'));
    el.meterCost = make('span', 'ask-meter-cost', '$0.00');
    meter.appendChild(el.meterCost);
    meter.appendChild(make('span', 'ask-meter-sep', '|'));
    row.appendChild(meter);

    const agentsBtn = make('button', 'ask-agents-btn');
    agentsBtn.type = 'button';
    agentsBtn.setAttribute('data-ask-agents-btn', '');
    el.agentsBtnLabel = make('span', null, '0 agents');
    agentsBtn.appendChild(el.agentsBtnLabel);
    agentsBtn.appendChild(svgIcon('M6 15l6-6 6 6', 11, 2));
    agentsBtn.addEventListener('click', () => openRunInfoPopover(agentsBtn));
    row.appendChild(agentsBtn);

    const modelBtn = make('button', 'ask-model-btn');
    modelBtn.type = 'button';
    modelBtn.setAttribute('data-ask-model-btn', '');
    el.modelBtnLabel = make('span', 'ask-model-btn-label', st.picker.model);
    el.modelBtnEffort = make('span', 'ask-model-btn-effort', st.picker.effort);
    modelBtn.appendChild(el.modelBtnLabel);
    modelBtn.appendChild(el.modelBtnEffort);
    modelBtn.appendChild(svgIcon(ICONS.chevronDown, 12, 2));
    modelBtn.addEventListener('click', () => openModelPopover(modelBtn));
    row.appendChild(modelBtn);

    el.send = make('button', 'ask-send');
    el.send.type = 'button';
    el.send.setAttribute('data-ask-send', '');
    el.send.setAttribute('aria-label', 'Send');
    el.send.appendChild(svgIcon(ICONS.send, 15, 2.2));
    el.send.addEventListener('click', sendMessage);
    row.appendChild(el.send);

    el.stop = make('button', 'ask-stop');
    el.stop.type = 'button';
    el.stop.setAttribute('data-ask-stop', '');
    el.stop.setAttribute('aria-label', 'Stop');
    el.stop.hidden = true;
    const stopRect = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    stopRect.setAttribute('width', '10');
    stopRect.setAttribute('height', '10');
    stopRect.setAttribute('viewBox', '0 0 24 24');
    stopRect.setAttribute('fill', 'currentColor');
    stopRect.setAttribute('aria-hidden', 'true');
    const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '6'); rect.setAttribute('y', '6');
    rect.setAttribute('width', '12'); rect.setAttribute('height', '12');
    rect.setAttribute('rx', '2');
    stopRect.appendChild(rect);
    el.stop.appendChild(stopRect);
    el.stop.addEventListener('click', stopTurn);
    row.appendChild(el.stop);

    wrap.appendChild(row);
    return wrap;
  }
```

Verify single definitions again: `grep -c "function buildComposer" ui/public/ask-panel.mjs` → 1 (same for `sendMessage`, `updateSendStop`, `updateMeters`).

- [ ] **Step 6.4: Run to verify pass**

Run: `node --disable-warning=ExperimentalWarning --test test/ask-panel-composer.test.mjs test/ask-panel.test.mjs test/ask-panel-render.test.mjs test/ask-panel-stream.test.mjs`
Expected: **43 pass / 0 fail** (10 new; earlier suites stay green — Task 3's shell test still finds `textarea.ask-input`).

- [ ] **Step 6.5: Full suite**

Run: `npm test`
Expected: **3307 pass / 0 fail**.

- [ ] **Step 6.6: Commit**

```bash
git add ui/public/ask-panel.mjs test/ask-panel-composer.test.mjs
git commit -m "worca ask p3: composer, attachments, send/stop"
```

---
### Task 7: Model picker, run-info popover, thread actions, first-open loading

**Files:**
- Modify: `ui/public/ask-panel.mjs` (replace stubs `ensureFirstOpen`, `newThread`, `buildThreadTrash`, `openModelPopover`, `openRunInfoPopover`; add `loadCatalog`, `applyCatalogToPicker`, `setPickerModel/setPickerEffort`, `deleteThread`)
- Test: `test/ask-panel-pickers.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–6. Produces (D8, §10.6): catalog fetched ONCE on first sheet open (`GET /api/ask/models`), cached for the page life; `st.picker` validated against it (unknown model → `{claude-opus-5, high}`; invalid effort → `'high'` if available else the entry's first effort), persisted to `worca-cc.ask.model` on every change; primary picker list = FIRST entry per family (`/^claude-(opus|fable|sonnet|haiku)-/`, catalog order) plus every `custom:'global'` entry; the rest under "More models ›"; "Effort ›" pane lists the CURRENT model's efforts. Run-info popover ("Agents this chat"): non-interactive rows `label · model · meter · elapsed` from every agent block in the thread, header meter = Σ agent tokens / Σ agent cost, empty state `No agents spawned yet.`. Thread delete via the injected `confirm` with EXACT copy `{title:'Delete this chat?', message:'“<title>” and its transcript are removed. This cannot be undone.', confirmLabel:'Delete', danger:true}` (curly quotes, D14). `newThread()` clears the active thread + stored id; the row is created on the next send (§6.2.1). First open also restores `worca-cc.ask.thread` (Task 4's `switchThread`).

- [ ] **Step 7.1: Write the failing tests** — `test/ask-panel-pickers.test.mjs`, full file:

```js
// test/ask-panel-pickers.test.mjs — model picker, run-info, thread actions
// (spec §10.6, D8, D13/D14). Catalog and threads come from the injected fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_00000001';

const CATALOG = {
  models: [
    { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
    { id: 'claude-fable-5', label: 'Fable 5 (1M)', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
    { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', efforts: ['medium', 'high', 'max'], custom: false },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false },
    { id: 'my-corp-model', label: 'Corp', efforts: ['high'], custom: 'global' },
  ],
  efforts: ['medium', 'high', 'xhigh', 'max'],
};

function snapBody(messages = []) {
  return { thread: { id: TID, title: 'Stored', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} }, messages, attachments: [], runLinks: [], inFlight: null };
}

function handler({ messages = [] } = {}) {
  return (url, opts) => {
    if (url === '/api/ask/models') return { ok: true, status: 200, json: async () => CATALOG };
    if (url.startsWith(`/api/ask/threads/${TID}`) && (!opts.method || opts.method === 'GET')) return { ok: true, status: 200, json: async () => snapBody(messages) };
    if (url.startsWith(`/api/ask/threads/${TID}`) && opts.method === 'DELETE') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (url.startsWith('/api/ask/threads') && !opts.method) return { ok: true, status: 200, json: async () => ({ threads: [{ id: TID, title: 'Stored', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false }] }) };
    if (url === '/api/ask/threads' && opts.method === 'POST') return { ok: true, status: 201, json: async () => ({ thread: { id: TID, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } }) };
    if (url.endsWith('/messages') && opts.method === 'POST') return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: 'askm_00000001' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

test('ask-panel-pickers: zero fetches before open; first open loads catalog once + the stored thread', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  assert.equal(ctx.fetchCalls.length, 0, 'no network before the sheet opens');
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.fetchCalls.filter((c) => c.url === '/api/ask/models').length, 1);
  assert.equal(ctx.fetchCalls.filter((c) => c.url === `/api/ask/threads/${TID}`).length, 1, 'stored thread restored');
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Stored');
  ctx.panel.close();
  ctx.panel.open();
  await ctx.tick();
  assert.equal(ctx.fetchCalls.filter((c) => c.url === '/api/ask/models').length, 1, 'catalog cached');
});

test('ask-panel-pickers: primary list = one per family + globals; More models holds the rest', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click();
  await ctx.tick();
  const pop = ctx.doc.querySelector('.ask-pop-model');
  assert.ok(pop);
  const names = [...pop.querySelectorAll('.ask-model-name')].map((n) => n.textContent);
  assert.deepEqual(names, ['Opus 5', 'Fable 5 (1M)', 'Sonnet 4.6', 'Haiku 4.5', 'Corp']);
  assert.match(pop.textContent, /More models/);
  assert.match(pop.textContent, /Effort/);
  // the selected model carries the check mark
  const checked = pop.querySelector('.ask-model-check');
  assert.ok(checked && checked.closest('[role="menuitem"]').textContent.includes('Opus 5'));
  // More pane
  ctx.doc.querySelector('[data-ask-more-models]').click();
  const moreNames = [...ctx.doc.querySelectorAll('.ask-pop-model .ask-model-name')].map((n) => n.textContent);
  assert.deepEqual(moreNames, ['Opus 4.8']);
  ctx.doc.querySelector('[data-ask-pane-back]').click();
  assert.match(ctx.doc.querySelector('.ask-pop-model').textContent, /Fable 5/);
});

test('ask-panel-pickers: effort pane lists the current model efforts; picking persists', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click();
  await ctx.tick();
  ctx.doc.querySelector('[data-ask-effort-row]').click();
  const efforts = [...ctx.doc.querySelectorAll('.ask-pop-model .ask-model-name')].map((n) => n.textContent);
  assert.deepEqual(efforts, ['medium', 'high', 'xhigh', 'max']);
  const max = [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent.includes('max'));
  max.click();
  assert.equal(ctx.doc.querySelector('.ask-model-btn-effort').textContent, 'max');
  assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-opus-5', effort: 'max' });
});

test('ask-panel-pickers: picking a model with fewer efforts coerces the effort', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-opus-5', effort: 'max' }));
  const ctx2 = makePanel({ fetchHandler: handler(), storage: ctx.storage });
  ctx2.panel.open();
  await ctx2.tick(); await ctx2.tick();
  ctx2.doc.querySelector('[data-ask-model-btn]').click();
  await ctx2.tick();
  const haiku = [...ctx2.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent.includes('Haiku 4.5'));
  haiku.click();
  assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-haiku-4-5', effort: 'high' }, 'max is not available on haiku — coerced to high');
  assert.equal(ctx2.doc.querySelector('.ask-model-btn-label').textContent, 'Haiku 4.5', 'button shows the label once the catalog is known');
});

test('ask-panel-pickers: an unknown stored model resets to the initial default on catalog load', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-gone-1', effort: 'high' }));
  const ctx2 = makePanel({ fetchHandler: handler(), storage: ctx.storage });
  ctx2.panel.open();
  await ctx2.tick(); await ctx2.tick();
  assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-opus-5', effort: 'high' });
});

test('ask-panel-pickers: the send body carries the picked model', async () => {
  const bodies = [];
  const h = handler();
  const ctx = makePanel({
    fetchHandler: (url, opts) => {
      if (url.endsWith('/messages') && opts.method === 'POST') { bodies.push(JSON.parse(opts.body)); }
      return h(url, opts);
    },
  });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click();
  await ctx.tick();
  [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent.includes('Haiku 4.5')).click();
  ctx.doc.querySelector('textarea.ask-input').value = 'hello there';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(bodies[0].model, 'claude-haiku-4-5');
  assert.equal(bodies[0].effort, 'high');
});

test('ask-panel-pickers: run-info popover lists agents with model and meter; empty state', async () => {
  const agent = { kind: 'agent', id: 'toolu_1', label: 'count runs', type: 'general-purpose', model: 'claude-haiku-4-5', tokens: 5321, usage: { input: 10, output: 69, cacheRead: 4564, cacheCreation: 678 }, costUsd: 0.62, estimated: true, status: 'done', durationMs: 2861, log: [] };
  const messages = [{ id: 'askm_00000001', threadId: TID, seq: 1, role: 'assistant', text: 'ok', blocks: [agent], status: 'done', reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' }];
  const ctx = makePanel({ fetchHandler: handler({ messages }) });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-agents-btn]').click();
  await ctx.tick();
  const pop = ctx.doc.querySelector('.ask-pop-runinfo');
  assert.ok(pop);
  assert.match(pop.textContent, /Agents this chat/);
  assert.match(pop.textContent, /count runs/);
  assert.match(pop.textContent, /claude-haiku-4-5/);
  assert.match(pop.textContent, /5\.3k tok/);
  assert.match(pop.textContent, /≈\$0\.62/);
  // empty
  const ctx2 = makePanel({ fetchHandler: handler() });
  ctx2.panel.open();
  await ctx2.tick(); await ctx2.tick();
  ctx2.doc.querySelector('[data-ask-agents-btn]').click();
  await ctx2.tick();
  assert.match(ctx2.doc.querySelector('.ask-pop-runinfo').textContent, /No agents spawned yet\./);
});

test('ask-panel-pickers: delete asks with the exact copy, DELETEs, clears the current thread', async () => {
  const confirms = [];
  const ctx = makePanel({ fetchHandler: handler(), confirm: async (opts) => { confirms.push(opts); return true; } });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  ctx.doc.querySelector('.ask-thread-trash').click();
  await ctx.tick(); await ctx.tick();
  assert.equal(confirms.length, 1);
  assert.deepEqual(confirms[0], { title: 'Delete this chat?', message: '“Stored” and its transcript are removed. This cannot be undone.', confirmLabel: 'Delete', danger: true });
  assert.ok(ctx.fetchCalls.some((c) => c.url === `/api/ask/threads/${TID}` && c.opts.method === 'DELETE'));
  assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), null);
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Ask Worca', 'back to an empty thread');
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('textarea.ask-input'), 'focus returns to the textarea');
});

test('ask-panel-pickers: declining the confirm sends no DELETE', async () => {
  const ctx = makePanel({ fetchHandler: handler(), confirm: async () => false });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  ctx.doc.querySelector('.ask-thread-trash').click();
  await ctx.tick(); await ctx.tick();
  assert.ok(!ctx.fetchCalls.some((c) => c.opts.method === 'DELETE'));
});

test('ask-panel-pickers: New chat clears the thread; the next send creates a fresh row', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Stored');
  ctx.doc.querySelector('[data-ask-new-btn]').click();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Ask Worca');
  assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), null);
  ctx.doc.querySelector('textarea.ask-input').value = 'fresh start';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.ok(ctx.fetchCalls.some((c) => c.url === '/api/ask/threads' && c.opts.method === 'POST'), 'thread created on send');
});
```

- [ ] **Step 7.2: Run to verify failure**

Run: `node --disable-warning=ExperimentalWarning --test --test-force-exit test/ask-panel-pickers.test.mjs`
Expected: FAIL — `ensureFirstOpen`/`openModelPopover` are stubs (no catalog fetch, no `.ask-pop-model`).
- [ ] **Step 7.3: Implement.** In `ui/public/ask-panel.mjs`, replace the stubs `ensureFirstOpen` (Task 3), `newThread` (Task 3), `buildThreadTrash` (Task 3), `openModelPopover` + `openRunInfoPopover` (Task 6) with:

```js
  // ---- catalog + picker (D8) ------------------------------------------------
  function catalogEntry(id) { return st.catalog ? st.catalog.models.find((m) => m && m.id === id) || null : null; }

  function updatePickerButton() {
    if (!el.modelBtnLabel) return;
    const entry = catalogEntry(st.picker.model);
    el.modelBtnLabel.textContent = entry ? entry.label : st.picker.model;
    el.modelBtnEffort.textContent = st.picker.effort;
  }

  function coerceEffort(entry, effort) {
    if (!entry || !Array.isArray(entry.efforts) || entry.efforts.includes(effort)) return effort;
    return entry.efforts.includes('high') ? 'high' : entry.efforts[0];
  }

  function applyCatalogToPicker() {
    const entry = catalogEntry(st.picker.model);
    const next = entry
      ? { model: st.picker.model, effort: coerceEffort(entry, st.picker.effort) }
      : { model: 'claude-opus-5', effort: 'high' }; // unknown stored model → initial default (§11)
    if (next.model !== st.picker.model || next.effort !== st.picker.effort) {
      st.picker = next;
      storeModel();
    }
    updatePickerButton();
  }

  function loadCatalog() {
    if (st.catalog) return Promise.resolve(st.catalog);
    if (st.catalogLoading) return st.catalogLoading;
    st.catalogLoading = Promise.resolve()
      .then(() => fetch('/api/ask/models'))
      .then((r) => (r && r.ok ? r.json() : null))
      .catch(() => null)
      .then((body) => {
        st.catalogLoading = null;
        if (body && Array.isArray(body.models)) { st.catalog = body; applyCatalogToPicker(); }
        return st.catalog;
      });
    return st.catalogLoading;
  }

  function ensureFirstOpen() {
    if (st.firstOpenDone) return;
    st.firstOpenDone = true;
    loadCatalog();
    const stored = readStoredThread();
    if (stored && !st.threadId) switchThread(stored);
  }

  function splitCatalog() {
    const primary = [];
    const rest = [];
    const seen = new Set();
    for (const m of st.catalog ? st.catalog.models : []) {
      if (!m) continue;
      if (m.custom === 'global') { primary.push(m); continue; }
      const fam = (m.id.match(/^claude-(opus|fable|sonnet|haiku)-/) || [])[1] || m.id;
      if (seen.has(fam)) rest.push(m);
      else { seen.add(fam); primary.push(m); }
    }
    return { primary, rest };
  }

  function setPickerModel(id) {
    st.picker = { model: id, effort: coerceEffort(catalogEntry(id), st.picker.effort) };
    storeModel();
    updatePickerButton();
    closePopover({ focusTrigger: false });
    focusComposer();
  }

  function setPickerEffort(effort) {
    st.picker = { ...st.picker, effort };
    storeModel();
    updatePickerButton();
    closePopover({ focusTrigger: false });
    focusComposer();
  }

  function openModelPopover(trigger) {
    const panel = openPopover({ panelClass: 'ask-pop-model', trigger, build: () => {} });
    if (!panel) return;
    const focusFirst = () => { const f = menuItems(panel)[0]; if (f) { f.tabIndex = 0; try { f.focus(); } catch { /* ignore */ } } };
    const modelItem = (m) => {
      const item = menuItem('ask-model-item', () => setPickerModel(m.id));
      item.appendChild(make('span', 'ask-model-name', m.label || m.id));
      if (m.id === st.picker.model) item.appendChild(make('span', 'ask-model-check', '✓'));
      return item;
    };
    const renderPane = (pane) => {
      panel.replaceChildren();
      if (pane === 'effort') {
        const back = menuItem('ask-pane-back', () => renderPane('main'));
        back.setAttribute('data-ask-pane-back', '');
        back.appendChild(make('span', null, '‹ Effort'));
        panel.appendChild(back);
        panel.appendChild(make('div', 'ask-pop-divider'));
        const entry = catalogEntry(st.picker.model);
        for (const eff of entry && Array.isArray(entry.efforts) ? entry.efforts : ['medium', 'high', 'xhigh', 'max']) {
          const item = menuItem('ask-effort-item', () => setPickerEffort(eff));
          item.appendChild(make('span', 'ask-model-name', eff));
          if (eff === st.picker.effort) item.appendChild(make('span', 'ask-model-check', '✓'));
          panel.appendChild(item);
        }
      } else if (pane === 'more') {
        const back = menuItem('ask-pane-back', () => renderPane('main'));
        back.setAttribute('data-ask-pane-back', '');
        back.appendChild(make('span', null, '‹ Models'));
        panel.appendChild(back);
        panel.appendChild(make('div', 'ask-pop-divider'));
        for (const m of splitCatalog().rest) panel.appendChild(modelItem(m));
      } else {
        const { primary, rest } = splitCatalog();
        for (const m of primary) panel.appendChild(modelItem(m));
        panel.appendChild(make('div', 'ask-pop-divider'));
        const effortRow = menuItem('ask-effort-row', () => renderPane('effort'));
        effortRow.setAttribute('data-ask-effort-row', '');
        effortRow.appendChild(make('span', null, 'Effort'));
        effortRow.appendChild(make('span', 'ask-pop-row-value', st.picker.effort));
        effortRow.appendChild(make('span', 'ask-pop-row-chev', '›'));
        panel.appendChild(effortRow);
        if (rest.length) {
          const moreRow = menuItem('ask-more-models', () => renderPane('more'));
          moreRow.setAttribute('data-ask-more-models', '');
          moreRow.appendChild(make('span', null, 'More models'));
          moreRow.appendChild(make('span', 'ask-pop-row-chev', '›'));
          panel.appendChild(moreRow);
        }
      }
      focusFirst();
    };
    loadCatalog().then(() => { if (st.popover && st.popover.panel === panel) renderPane('main'); });
    renderPane('main');
  }

  // ---- run-info popover ("Agents this chat") --------------------------------
  function openRunInfoPopover(trigger) {
    openPopover({ panelClass: 'ask-pop-runinfo', trigger, build: (p) => {
      const agents = [];
      if (st.model) {
        for (const row of st.model.messages()) {
          for (const b of row.blocks || []) if (b && b.kind === 'agent') agents.push(b);
        }
      }
      const head = make('div', 'ask-pop-caption-row');
      head.appendChild(make('span', 'ask-pop-caption', 'Agents this chat'));
      const tok = agents.reduce((n, a) => n + (Number.isFinite(a.tokens) ? a.tokens : 0), 0);
      const cost = agents.reduce((n, a) => n + (Number.isFinite(a.costUsd) ? a.costUsd : 0), 0);
      head.appendChild(make('span', 'ask-pop-caption-meter', agents.length ? [fmtTokens(tok), `≈${fmtUsd(cost)}`].filter(Boolean).join(' · ') : ''));
      p.appendChild(head);
      if (!agents.length) { p.appendChild(make('div', 'ask-pop-empty', 'No agents spawned yet.')); return; }
      for (const a of agents) {
        const row = make('div', 'ask-runinfo-row');
        row.appendChild(make('span', `ask-dot${a.status === 'running' ? ' ask-dot-run' : a.status === 'done' ? ' ask-dot-done' : ''}`));
        const col = make('span', 'ask-runinfo-col');
        col.appendChild(make('span', 'ask-runinfo-name', a.label || a.type || 'agent'));
        col.appendChild(make('span', 'ask-runinfo-sub', [a.model, fmtTokens(a.tokens), Number.isFinite(a.costUsd) ? `≈${fmtUsd(a.costUsd)}` : null].filter(Boolean).join(' · ')));
        row.appendChild(col);
        row.appendChild(make('span', 'ask-runinfo-elapsed', fmtElapsed(a.durationMs) || '—'));
        p.appendChild(row);
      }
    } });
  }

  // ---- thread actions -------------------------------------------------------
  function newThread() {
    st.threadId = null;
    st.model = null;
    st.subscribedFor = null;
    stopElapsed();
    storeThread(null);
    el.title.textContent = 'Ask Worca';
    renderTranscript();
    updateMeters();
    updateSendStop();
    setComposerMsg(null);
    focusComposer();
  }

  async function deleteThread(t) {
    closePopover({ focusTrigger: false });
    const ok = await confirm({
      title: 'Delete this chat?',
      message: `“${t.title || '(untitled)'}” and its transcript are removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) { focusComposer(); return; }
    try { await fetch(`/api/ask/threads/${t.id}`, { method: 'DELETE' }); } catch { /* the list will show it either way */ }
    if (readStoredThread() === t.id) storeThread(null);
    if (st.threadId === t.id) newThread(); // clears + focuses the textarea (D14)
    else focusComposer();
  }

  function buildThreadTrash(t) {
    const b = make('button', 'ask-thread-trash');
    b.type = 'button';
    b.setAttribute('aria-label', `Delete "${t.title || '(untitled)'}"`);
    b.appendChild(svgIcon('M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7', 14, 1.8));
    b.addEventListener('click', (e) => { e.stopPropagation(); deleteThread(t); });
    return b;
  }
```

Single-definition greps again (`ensureFirstOpen`, `newThread`, `buildThreadTrash`, `openModelPopover`, `openRunInfoPopover` → 1 each).

- [ ] **Step 7.4: Run to verify pass**

Run: `node --disable-warning=ExperimentalWarning --test test/ask-panel-pickers.test.mjs test/ask-panel.test.mjs test/ask-panel-composer.test.mjs`
Expected: **30 pass / 0 fail** (10 new).

- [ ] **Step 7.5: Full suite**

Run: `npm test`
Expected: **3317 pass / 0 fail**.

- [ ] **Step 7.6: Commit**

```bash
git add ui/public/ask-panel.mjs test/ask-panel-pickers.test.mjs
git commit -m "worca ask p3: model picker, run info, thread actions"
```

---
### Task 8: Start-run card

**Files:**
- Modify: `ui/public/ask-panel.mjs` (replace the `buildCard` stub; add `loadCardOptions`, `collectCardBody`, `startCard`, `dismissCard`, `prefillFromCard`; import `workflowPickerLabel` from `./results-view.mjs`)
- Test: `test/ask-panel-card.test.mjs`

**Interfaces:**
- Consumes (envelopes VERIFIED against the live server during the dry-runs): `GET /api/projects → {projects:[{key,name,path,exists}]}` · `GET /api/workflows → {workflows:[…]}` · `GET /api/guardrails → {guardrails:[…]}` (ui/server.mjs:2905-2913 — NOT `{sets}`) · `GET /api/workspaces → {workspaces:[…]}` (rows carry `id,name,projectPaths,projectKeys`) · `GET /api/branches?projectDir= → {branches:[…], current}`. The `grab()` helper stays envelope-tolerant (array or keyed object) as defence-in-depth, but the keys above are the real ones. `POST /api/run` and `POST /api/ask/threads/:id/cards/:cardId` per the inlined contract.
- Produces: `buildCard(block, row) → element` with `update` semantics (V7): a `proposed` card re-render NEVER touches field values; any other state renders the terminal form (started link / one-line dismissed stub / failed stub + error). Start posts the EXACT §9.4 body — `guardrailsId` ALWAYS present (unlike New Pipeline's omit-when-default), `mock:false`, `askThreadId`+`askCardId`, empty `sourceBranch`/`featureBranch` omitted, `sourceBranchByKey` only non-empty entries. Card option lists are fetched once per panel (`loadCardOptions`, cached promise). `prefillFromCard` → `openNewPipeline({target, projectDir|workspaceId, workflowId, guardrailsId, prompt, title, sourceBranch, featureBranch, sourceBranchByKey?})` from the CURRENT DOM values (V10). Errors from Start land verbatim in `.ask-card-err`; the dismissed/started flips arrive as frames (the server broadcasts them — the card does not self-flip on 200).

- [ ] **Step 8.1: Write the failing tests** — `test/ask-panel-card.test.mjs`, full file:

```js
// test/ask-panel-card.test.mjs — the Start-run card (spec §9, §10.5, D1-D3).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';
const CARD_ID = 'card_00000001';

const PROJECT_CARD = {
  target: 'project', projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj',
  workspaceId: null, workspaceName: null, members: null,
  workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal',
  brief: 'Fix the login bug', title: 'Fix login', sourceBranch: '', featureBranch: 'worca/fix-login', sourceBranchByKey: null,
};
const WS_CARD = {
  ...PROJECT_CARD, target: 'workspace', projectKey: null, projectName: null, projectDir: null,
  workspaceId: 'wks-team-00000001', workspaceName: 'team',
  members: [{ projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj' }, { projectKey: 'lib-00000002', projectName: 'lib', projectDir: '/repos/lib' }],
  featureBranch: 'worca/fix-login', sourceBranchByKey: null,
};

function apiHandler(recorder = {}) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url === '/api/projects') return { ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: '/repos/proj', exists: true }, { name: 'other', path: '/repos/other', exists: false }] }) };
    if (url === '/api/workflows') return { ok: true, status: 200, json: async () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_review', name: 'Review only' }] }) };
    if (url === '/api/guardrails') return { ok: true, status: 200, json: async () => ({ guardrails: [{ id: 'permissive', name: 'Permissive' }, { id: 'normal', name: 'Normal' }, { id: 'strict', name: 'Strict' }] }) };
    if (url === '/api/workspaces') return { ok: true, status: 200, json: async () => ({ workspaces: [{ id: 'wks-team-00000001', name: 'team', projectPaths: ['/repos/proj', '/repos/lib'], projectKeys: ['proj-00000001', 'lib-00000002'] }] }) };
    if (url.startsWith('/api/branches')) {
      recorder.branchCalls = [...(recorder.branchCalls || []), url];
      return { ok: true, status: 200, json: async () => ({ branches: ['main', 'dev'] }) };
    }
    if (url === '/api/run' && method === 'POST') {
      recorder.runBodies = [...(recorder.runBodies || []), JSON.parse(opts.body)];
      if (recorder.runResponse) return recorder.runResponse;
      return { ok: true, status: 200, json: async () => ({ runId: 'run-uuid-1' }) };
    }
    if (url === `/api/ask/threads/${TID}/cards/${CARD_ID}` && method === 'POST') {
      recorder.dismissBodies = [...(recorder.dismissBodies || []), JSON.parse(opts.body)];
      return { ok: true, status: 200, json: async () => ({ block: { kind: 'card', id: CARD_ID, state: 'dismissed', card: PROJECT_CARD } }) };
    }
    if (url.startsWith(`/api/ask/threads/${TID}`) && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} }, messages: [], attachments: [], runLinks: [], inFlight: null }) };
    }
    if (url.startsWith('/api/ask/threads') && method === 'GET') return { ok: true, status: 200, json: async () => ({ threads: [{ id: TID, title: 'T', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

async function openWithCard(card, recorder = {}) {
  const ctx = makePanel({ fetchHandler: apiHandler(recorder) });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const frames = stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-card', block: { kind: 'card', id: CARD_ID, state: 'proposed', card } },
  ], { threadId: TID, messageId: MID });
  for (const f of frames) ctx.panel.pushServerFrame(f);
  ctx.flush();
  await ctx.tick(); await ctx.tick(); // option lists load
  ctx.flush();
  return ctx;
}

test('ask-panel-card: proposed project card renders the form; Start posts the exact §9.4 body', async () => {
  const rec = {};
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const cardEl = ctx.doc.querySelector('.ask-card');
  assert.ok(cardEl);
  assert.equal(cardEl.querySelector('.ask-card-brief').value, 'Fix the login bug');
  const guard = cardEl.querySelector('.ask-card-guardrails');
  assert.equal(guard.value, 'normal', 'default normal selected');
  assert.ok([...guard.options].some((o) => o.value === 'permissive'), 'Permissive IS offered on the card (user choice, §9.3)');
  const proj = cardEl.querySelector('.ask-card-project-select');
  assert.equal(proj.value, '/repos/proj');
  assert.match([...proj.options].find((o) => o.value === '/repos/other').textContent, /\(missing\)/);
  const src = cardEl.querySelector('.ask-card-source');
  assert.equal(src.options[0].value, '', 'current branch (auto) first');
  cardEl.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick();
  assert.equal(rec.runBodies.length, 1);
  assert.deepEqual(rec.runBodies[0], {
    projectDir: '/repos/proj', prompt: 'Fix the login bug', workflowId: 'wf_default', guardrailsId: 'normal',
    title: 'Fix login', featureBranch: 'worca/fix-login', mock: false, askThreadId: TID, askCardId: CARD_ID,
  });
});

test('ask-panel-card: edits flow into the Start body', async () => {
  const rec = {};
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const cardEl = ctx.doc.querySelector('.ask-card');
  cardEl.querySelector('.ask-card-workflow').value = 'wf_review';
  cardEl.querySelector('.ask-card-guardrails').value = 'strict';
  cardEl.querySelector('.ask-card-brief').value = 'Review it instead';
  cardEl.querySelector('.ask-card-feature').value = 'worca/review-1';
  cardEl.querySelector('.ask-card-source').value = 'dev';
  cardEl.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick();
  assert.deepEqual(rec.runBodies[0], {
    projectDir: '/repos/proj', prompt: 'Review it instead', workflowId: 'wf_review', guardrailsId: 'strict',
    title: 'Fix login', sourceBranch: 'dev', featureBranch: 'worca/review-1', mock: false, askThreadId: TID, askCardId: CARD_ID,
  });
  cardEl.querySelector('.ask-card-guardrails').value = 'permissive';
  cardEl.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick();
  assert.equal(rec.runBodies[1].guardrailsId, 'permissive', 'guardrailsId is ALWAYS sent — even permissive (spec §9.4; New Pipeline\'s omit-when-default convention must NOT leak in)');
});

test('ask-panel-card: switching the project reloads its branches', async () => {
  const rec = {};
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const before = (rec.branchCalls || []).length;
  const proj = ctx.doc.querySelector('.ask-card-project-select');
  proj.value = '/repos/other';
  proj.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await ctx.tick(); await ctx.tick();
  assert.equal(rec.branchCalls.length, before + 1);
  assert.match(rec.branchCalls.at(-1), /projectDir=%2Frepos%2Fother/);
});

test('ask-panel-card: workspace card — members, per-member sources, workspace body', async () => {
  const rec = {};
  const ctx = await openWithCard(WS_CARD, rec);
  const cardEl = ctx.doc.querySelector('.ask-card');
  assert.match(cardEl.querySelector('.ask-card-members').textContent, /proj/);
  assert.match(cardEl.querySelector('.ask-card-members').textContent, /lib/);
  const memberInputs = [...cardEl.querySelectorAll('.ask-card-member-src')];
  assert.equal(memberInputs.length, 2);
  memberInputs[1].value = 'release';
  cardEl.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick();
  assert.deepEqual(rec.runBodies[0], {
    workspaceId: 'wks-team-00000001', prompt: 'Fix the login bug', workflowId: 'wf_default', guardrailsId: 'normal',
    title: 'Fix login', featureBranch: 'worca/fix-login', sourceBranchByKey: { 'lib-00000002': 'release' },
    mock: false, askThreadId: TID, askCardId: CARD_ID,
  });
});

test('ask-panel-card: switching the target segment to workspace posts the workspace body', async () => {
  const rec = {};
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const cardEl = ctx.doc.querySelector('.ask-card');
  cardEl.querySelector('[data-ask-card-seg="workspace"]').click();
  await ctx.tick(); await ctx.tick();
  const ws = cardEl.querySelector('.ask-card-workspace-select');
  assert.ok(ws, 'workspace select appears');
  assert.equal(ws.value, 'wks-team-00000001');
  cardEl.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick();
  assert.equal(rec.runBodies[0].workspaceId, 'wks-team-00000001');
  assert.equal(rec.runBodies[0].projectDir, undefined);
});

test('ask-panel-card: a 403 renders in .ask-card-err and Start stays enabled', async () => {
  const rec = { runResponse: { ok: false, status: 403, json: async () => ({ error: 'total cost limit reached' }) } };
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const cardEl = ctx.doc.querySelector('.ask-card');
  cardEl.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(cardEl.querySelector('.ask-card-err').textContent, 'total cost limit reached');
  assert.equal(cardEl.querySelector('[data-ask-card-start]').disabled, false);
  assert.ok(cardEl.querySelector('.ask-card-brief'), 'still the editable form');
});

test('ask-panel-card: Not now posts the dismiss; the flip frame renders the stub', async () => {
  const rec = {};
  const ctx = await openWithCard(PROJECT_CARD, rec);
  ctx.doc.querySelector('[data-ask-card-dismiss]').click();
  await ctx.tick(); await ctx.tick();
  assert.deepEqual(rec.dismissBodies, [{ state: 'dismissed' }]);
  ctx.panel.pushServerFrame({ type: 'ask-card', block: { kind: 'card', id: CARD_ID, state: 'dismissed', card: PROJECT_CARD }, threadId: TID, messageId: MID, seq: 3 });
  ctx.flush();
  const stub = ctx.doc.querySelector('.ask-card-stub');
  assert.ok(stub, 'one-line dismissed stub');
  assert.equal(ctx.doc.querySelector('.ask-card-brief'), null, 'form gone');
});

test('ask-panel-card: the started flip renders the run link read-only', async () => {
  const ctx = await openWithCard(PROJECT_CARD);
  ctx.panel.pushServerFrame({ type: 'ask-card', block: { kind: 'card', id: CARD_ID, state: 'started', runId: 'run-uuid-1', card: PROJECT_CARD }, threadId: TID, messageId: MID, seq: 3 });
  ctx.flush();
  const link = ctx.doc.querySelector('.ask-card a[href="#running/run-uuid-1"]');
  assert.ok(link, 'links to the running view');
  assert.equal(ctx.doc.querySelector('.ask-card-brief'), null, 'no editable fields after start');
});

test('ask-panel-card: a proposed re-emit never clobbers local edits', async () => {
  const ctx = await openWithCard(PROJECT_CARD);
  const brief = ctx.doc.querySelector('.ask-card-brief');
  brief.value = 'my local edit';
  ctx.panel.pushServerFrame({ type: 'ask-card', block: { kind: 'card', id: CARD_ID, state: 'proposed', card: PROJECT_CARD }, threadId: TID, messageId: MID, seq: 3 });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-card-brief').value, 'my local edit');
});

test('ask-panel-card: Open in New Pipeline hands over the CURRENT values', async () => {
  const handoffs = [];
  const rec = {};
  const ctx = makePanel({ fetchHandler: apiHandler(rec), openNewPipeline: (p) => handoffs.push(p) });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  for (const f of stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-card', block: { kind: 'card', id: CARD_ID, state: 'proposed', card: PROJECT_CARD } },
  ], { threadId: TID, messageId: MID })) ctx.panel.pushServerFrame(f);
  ctx.flush();
  await ctx.tick(); await ctx.tick();
  ctx.flush();
  ctx.doc.querySelector('.ask-card-brief').value = 'edited brief';
  ctx.doc.querySelector('[data-ask-card-open-np]').click();
  assert.equal(handoffs.length, 1);
  assert.deepEqual(handoffs[0], {
    target: 'project', projectDir: '/repos/proj', workflowId: 'wf_default', guardrailsId: 'normal',
    prompt: 'edited brief', title: 'Fix login', sourceBranch: '', featureBranch: 'worca/fix-login',
  });
});
```

- [ ] **Step 8.2: Run to verify failure**

Run: `node --disable-warning=ExperimentalWarning --test --test-force-exit test/ask-panel-card.test.mjs`
Expected: FAIL — the Task-4 `buildCard` stub renders a text div, no form.
- [ ] **Step 8.3: Implement.** Add to the import block at the top of `ui/public/ask-panel.mjs`:

```js
import { workflowPickerLabel } from './results-view.mjs';
```

Then replace the Task-4 `buildCard` stub line with the card section:

```js
  // ---- Start-run card (spec §9, §10.5; D1-D3) -------------------------------
  // Field edits live in the DOM only (V7): a proposed card's element is CACHED
  // by card id and REUSED across message re-renders, so streaming updates and
  // proposed re-emits never clobber what the user typed. Only a STATE change
  // (started/dismissed/failed) builds a fresh terminal element.
  function loadCardOptions() {
    if (st.cardOptions) return st.cardOptions;
    const grab = (url, key) => Promise.resolve()
      .then(() => fetch(url))
      .then((r) => (r && r.ok ? r.json() : null))
      .catch(() => null)
      .then((body) => {
        if (Array.isArray(body)) return body;
        if (body && Array.isArray(body[key])) return body[key];
        return [];
      });
    st.cardOptions = Promise.all([
      grab('/api/projects', 'projects'),
      grab('/api/workflows', 'workflows'),
      // Verified against ui/server.mjs:2905-2913 — the envelope key is
      // `guardrails`, NOT `sets` (app.js listGuardrailsApi:3090-3095). The
      // wrong key renders an empty select, Start posts guardrailsId:'' and
      // /api/run silently coerces that to 'permissive'.
      grab('/api/guardrails', 'guardrails'),
      grab('/api/workspaces', 'workspaces'),
    ]).then(([projects, workflows, guardrails, workspaces]) => ({ projects, workflows, guardrails, workspaces }));
    return st.cardOptions;
  }

  function fillSelect(select, options, value) {
    select.replaceChildren();
    for (const o of options) {
      const opt = doc.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      select.appendChild(opt);
    }
    if (value != null && [...select.options].some((o) => o.value === value)) select.value = value;
  }

  function loadBranchesInto(select, projectDir, want) {
    fillSelect(select, [{ value: '', label: 'current branch (auto)' }], '');
    if (!projectDir) return;
    Promise.resolve()
      .then(() => fetch(`/api/branches?projectDir=${encodeURIComponent(projectDir)}`))
      .then((r) => (r && r.ok ? r.json() : null))
      .catch(() => null)
      .then((body) => {
        const branches = Array.isArray(body) ? body : (body && Array.isArray(body.branches)) ? body.branches : [];
        const opts = [{ value: '', label: 'current branch (auto)' }, ...branches.map((b) => ({ value: b, label: b }))];
        if (want && !opts.some((o) => o.value === want)) opts.push({ value: want, label: want });
        fillSelect(select, opts, want || '');
      });
  }

  function wsBasename(p) { return String(p || '').replace(/\/+$/, '').split('/').pop() || String(p || ''); }

  function buildCardTerminal(block) {
    const card = block.card || {};
    if (block.state === 'started') {
      const n = make('div', 'ask-card ask-card-started');
      n.appendChild(make('span', null, `Run started — ${card.title || card.brief || 'run'} `));
      const a = make('a', 'ask-card-link', 'open');
      a.setAttribute('href', `#running/${block.runId || ''}`);
      n.appendChild(a);
      return n;
    }
    if (block.state === 'failed') {
      return make('div', 'ask-card-stub ask-card-failed', `Run failed${block.error ? `: ${block.error}` : ''} — ${card.title || card.brief || ''}`);
    }
    return make('div', 'ask-card-stub', `Not now — ${card.title || card.brief || 'run proposal'}`);
  }

  function buildCardForm(block) {
    const card = block.card || {};
    const rootEl = make('div', 'ask-card');
    const local = { target: card.target === 'workspace' ? 'workspace' : 'project', options: null };

    rootEl.appendChild(make('div', 'ask-card-title', card.title || 'Run proposal'));

    const seg = make('div', 'ask-card-seg');
    const segBtns = {};
    for (const [t, label] of [['project', 'Project'], ['workspace', 'Workspace']]) {
      const b = make('button', 'ask-card-seg-btn', label);
      b.type = 'button';
      b.setAttribute('data-ask-card-seg', t);
      b.addEventListener('click', () => {
        if (local.target === t) return;
        local.target = t;
        for (const k of Object.keys(segBtns)) segBtns[k].classList.toggle('on', k === local.target);
        renderTarget();
      });
      segBtns[t] = b;
      seg.appendChild(b);
    }
    segBtns[local.target].classList.add('on');
    rootEl.appendChild(seg);

    const targetHost = make('div', 'ask-card-target');
    rootEl.appendChild(targetHost);

    const field = (label, control) => {
      const f = make('div', 'ask-card-field');
      f.appendChild(make('label', 'ask-card-label', label));
      f.appendChild(control);
      return f;
    };

    const workflowSel = doc.createElement('select');
    workflowSel.className = 'ask-card-workflow';
    rootEl.appendChild(field('Workflow', workflowSel));

    const guardSel = doc.createElement('select');
    guardSel.className = 'ask-card-guardrails';
    rootEl.appendChild(field('Guardrails', guardSel));

    const brief = doc.createElement('textarea');
    brief.className = 'ask-card-brief';
    brief.value = card.brief || '';
    brief.addEventListener('input', () => {
      brief.style.height = 'auto';
      brief.style.height = `${Math.min(brief.scrollHeight || 0, 160)}px`;
    });
    rootEl.appendChild(field('Task brief', brief));

    const feature = doc.createElement('input');
    feature.type = 'text';
    feature.className = 'ask-card-feature';
    feature.value = card.featureBranch || '';
    rootEl.appendChild(field('Feature branch', feature));

    const err = make('div', 'ask-card-err');
    rootEl.appendChild(err);

    const actions = make('div', 'ask-card-actions');
    const openNp = make('button', 'ask-card-open-np', 'Open in New Pipeline');
    openNp.type = 'button';
    openNp.setAttribute('data-ask-card-open-np', '');
    openNp.addEventListener('click', () => prefillFromCard(block, rootEl, local));
    actions.appendChild(openNp);
    actions.appendChild(make('span', 'ask-card-actions-spacer'));
    const dismissBtn = make('button', 'ask-card-not-now', 'Not now');
    dismissBtn.type = 'button';
    dismissBtn.setAttribute('data-ask-card-dismiss', '');
    dismissBtn.addEventListener('click', () => dismissCard(block, rootEl));
    actions.appendChild(dismissBtn);
    const startBtn = make('button', 'ask-card-start', 'Start');
    startBtn.type = 'button';
    startBtn.setAttribute('data-ask-card-start', '');
    startBtn.addEventListener('click', () => startCard(block, rootEl, local));
    actions.appendChild(startBtn);
    rootEl.appendChild(actions);

    function renderTarget() {
      targetHost.replaceChildren();
      const opts = local.options;
      if (local.target === 'project') {
        const projSel = doc.createElement('select');
        projSel.className = 'ask-card-project-select';
        const srcSel = doc.createElement('select');
        srcSel.className = 'ask-card-source';
        if (opts) {
          fillSelect(projSel, opts.projects.map((p) => ({ value: p.path, label: p.exists === false ? `${p.name} (missing)` : p.name })), card.projectDir || (opts.projects[0] && opts.projects[0].path) || '');
          loadBranchesInto(srcSel, projSel.value, card.sourceBranch || '');
        }
        projSel.addEventListener('change', () => loadBranchesInto(srcSel, projSel.value, ''));
        targetHost.appendChild(field('Project', projSel));
        targetHost.appendChild(field('Source branch', srcSel));
      } else {
        const wsSel = doc.createElement('select');
        wsSel.className = 'ask-card-workspace-select';
        const members = make('div', 'ask-card-members');
        const srcInput = doc.createElement('input');
        srcInput.type = 'text';
        srcInput.className = 'ask-card-source-input';
        srcInput.placeholder = 'auto';
        srcInput.value = card.sourceBranch || '';
        const details = doc.createElement('details');
        details.className = 'ask-card-members-src';
        details.appendChild(make('summary', null, 'Per-member source branches'));
        const memberHost = make('div', 'ask-card-members-src-list');
        details.appendChild(memberHost);
        const renderMembers = () => {
          members.replaceChildren();
          memberHost.replaceChildren();
          const row = opts && opts.workspaces.find((w) => w && w.id === wsSel.value);
          const list = row && Array.isArray(row.projectKeys)
            ? row.projectKeys.map((k, i) => ({ projectKey: k, name: wsBasename(row.projectPaths && row.projectPaths[i]) }))
            : Array.isArray(card.members) ? card.members.map((m) => ({ projectKey: m.projectKey, name: m.projectName })) : [];
          members.textContent = list.map((m) => m.name).join(', ');
          for (const m of list) {
            const inp = doc.createElement('input');
            inp.type = 'text';
            inp.className = 'ask-card-member-src';
            inp.placeholder = 'auto';
            inp.setAttribute('data-project-key', m.projectKey);
            if (card.sourceBranchByKey && card.sourceBranchByKey[m.projectKey]) inp.value = card.sourceBranchByKey[m.projectKey];
            memberHost.appendChild(field(m.name, inp));
          }
        };
        if (opts) {
          fillSelect(wsSel, opts.workspaces.map((w) => ({ value: w.id, label: w.name || w.id })), card.workspaceId || (opts.workspaces[0] && opts.workspaces[0].id) || '');
          renderMembers();
        }
        wsSel.addEventListener('change', renderMembers);
        targetHost.appendChild(field('Workspace', wsSel));
        targetHost.appendChild(members);
        targetHost.appendChild(field('Source branch (default)', srcInput));
        targetHost.appendChild(details);
      }
    }

    renderTarget();
    loadCardOptions().then((opts) => {
      if (st.destroyed) return;
      local.options = opts;
      fillSelect(workflowSel, opts.workflows.map((w) => ({ value: w.id, label: workflowPickerLabel(w, []) || w.name || w.id })), card.workflowId || 'wf_default');
      fillSelect(guardSel, opts.guardrails.map((g) => ({ value: g.id, label: g.id === 'permissive' ? 'Permissive' : (g.name || g.id) })), card.guardrailsId || 'normal');
      renderTarget();
    });
    return rootEl;
  }

  function collectCardBody(rootEl, local, card) {
    const body = {
      prompt: rootEl.querySelector('.ask-card-brief').value,
      workflowId: rootEl.querySelector('.ask-card-workflow').value,
      guardrailsId: rootEl.querySelector('.ask-card-guardrails').value, // ALWAYS sent (spec §9.4)
      title: card.title || undefined,
      mock: false,
    };
    const feature = rootEl.querySelector('.ask-card-feature').value.trim();
    if (feature) body.featureBranch = feature;
    if (local.target === 'workspace') {
      body.workspaceId = rootEl.querySelector('.ask-card-workspace-select').value;
      const src = rootEl.querySelector('.ask-card-source-input');
      if (src && src.value.trim()) body.sourceBranch = src.value.trim();
      const byKey = {};
      for (const inp of rootEl.querySelectorAll('.ask-card-member-src')) {
        const k = inp.getAttribute('data-project-key');
        const v = inp.value.trim();
        if (k && v) byKey[k] = v;
      }
      if (Object.keys(byKey).length) body.sourceBranchByKey = byKey;
    } else {
      body.projectDir = rootEl.querySelector('.ask-card-project-select').value;
      const src = rootEl.querySelector('.ask-card-source');
      if (src && src.value) body.sourceBranch = src.value;
    }
    return body;
  }

  async function startCard(block, rootEl, local) {
    const err = rootEl.querySelector('.ask-card-err');
    const startBtn = rootEl.querySelector('[data-ask-card-start]');
    err.textContent = '';
    startBtn.disabled = true;
    try {
      const body = { ...collectCardBody(rootEl, local, block.card || {}), askThreadId: st.threadId, askCardId: block.id };
      let res = null;
      try {
        res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } catch { err.textContent = 'network error'; return; }
      if (!res.ok) {
        let msg = `request failed (${res.status})`;
        try { const b = await res.json(); if (b && b.error) msg = b.error; } catch { /* keep */ }
        err.textContent = msg;
        return;
      }
      // Success: the server links, flips the card to started and broadcasts;
      // the flip frame renders the terminal state. The browser never navigates
      // (beginRun is NEVER called — spec §10.5).
    } finally {
      startBtn.disabled = false;
    }
  }

  async function dismissCard(block, rootEl) {
    const err = rootEl.querySelector('.ask-card-err');
    err.textContent = '';
    let res = null;
    try {
      res = await fetch(`/api/ask/threads/${st.threadId}/cards/${block.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'dismissed' }) });
    } catch { err.textContent = 'network error'; return; }
    if (!res.ok) {
      let msg = `request failed (${res.status})`;
      try { const b = await res.json(); if (b && b.error) msg = b.error; } catch { /* keep */ }
      err.textContent = msg;
    }
    // the flip frame renders the stub
  }

  function prefillFromCard(block, rootEl, local) {
    const card = block.card || {};
    const p = {
      target: local.target,
      workflowId: rootEl.querySelector('.ask-card-workflow').value,
      guardrailsId: rootEl.querySelector('.ask-card-guardrails').value,
      prompt: rootEl.querySelector('.ask-card-brief').value,
      title: card.title || '',
      featureBranch: rootEl.querySelector('.ask-card-feature').value.trim(),
    };
    if (local.target === 'workspace') {
      p.workspaceId = rootEl.querySelector('.ask-card-workspace-select').value;
      const src = rootEl.querySelector('.ask-card-source-input');
      p.sourceBranch = src ? src.value.trim() : '';
      const byKey = {};
      for (const inp of rootEl.querySelectorAll('.ask-card-member-src')) {
        const k = inp.getAttribute('data-project-key');
        const v = inp.value.trim();
        if (k && v) byKey[k] = v;
      }
      if (Object.keys(byKey).length) p.sourceBranchByKey = byKey;
    } else {
      p.projectDir = rootEl.querySelector('.ask-card-project-select').value;
      const src = rootEl.querySelector('.ask-card-source');
      p.sourceBranch = src ? src.value : '';
    }
    openNewPipeline(p);
  }

  function buildCard(block) {
    if (!st.cardEls) st.cardEls = new Map();
    const cached = st.cardEls.get(block.id);
    if (cached && cached.state === block.state && block.state === 'proposed') return cached.el;
    const built = block.state === 'proposed' ? buildCardForm(block) : buildCardTerminal(block);
    st.cardEls.set(block.id, { el: built, state: block.state });
    return built;
  }
```

- [ ] **Step 8.4: Run to verify pass**

Run: `node --disable-warning=ExperimentalWarning --test test/ask-panel-card.test.mjs test/ask-panel-render.test.mjs test/ask-panel-stream.test.mjs`
Expected: **33 pass / 0 fail** (10 new; the render and stream suites make no card-shape assertions, so the stub→form change cannot red them).

- [ ] **Step 8.5: Full suite**

Run: `npm test`
Expected: **3327 pass / 0 fail**.

- [ ] **Step 8.6: Commit**

```bash
git add ui/public/ask-panel.mjs test/ask-panel-card.test.mjs
git commit -m "worca ask p3: start-run card"
```

---
### Task 9: CSS

**Files:**
- Modify: `ui/public/style.css` (one new section inserted BEFORE the final reduced-motion section comment at `:2799`; one line added INSIDE the `@media` block at `:2804`; the hljs variable selector at `:1877` widened)
- Test: `test/ui-ask-style.test.mjs`

**Interfaces:** consumes every `.ask-*`/`data-ask-*` class name Tasks 3–8 created. Produces the §10.3 layout. Hard fences (Global Constraints): zero 6-digit hex in the new section; `var(--token)` only; `wr-rise`/`wr-pulse` referenced by name, never redeclared; every `animation:wr-*` sits before the final reduced-motion block; no comments inside rule bodies, no `}` in any comment; `[hidden]{display:none}` twin for every hideable element whose base rule sets `display`; the `<1080px` media rule must RESTATE `body.rail-collapsed .ask-dock` (a bare `.ask-dock` at (0,1,0) loses the specificity tie against the (0,2,0) rail rule — the spec's literal selectors are broken below 1080px; this plan fixes them).

- [ ] **Step 9.1: Write the failing tests** — `test/ui-ask-style.test.mjs`, full file:

```js
// test/ui-ask-style.test.mjs — raw style.css assertions for the Ask Worca
// section (spec §10.3). Same technique as test/ui-diff-style.test.mjs /
// ui-running-routing's ruleBody: anchored selector match, body capture stops at
// the first closing brace — hence the "no comments in rule bodies" house rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1].replace(/\s+/g, ' ') : null;
}

test('ui-ask-style: the dock is a fixed, click-through layer at z-40 with the rail arms', () => {
  const dock = ruleBody('.ask-dock');
  assert.ok(dock, '.ask-dock rule exists');
  assert.match(dock, /position:fixed/);
  assert.match(dock, /z-index:40/);
  assert.match(dock, /pointer-events:none/);
  assert.match(dock, /left:298px/);
  const collapsed = ruleBody('body.rail-collapsed .ask-dock');
  assert.ok(collapsed, 'collapsed-rail arm exists');
  assert.match(collapsed, /left:76px/);
  // the children restore pointer events
  assert.match(ruleBody('.ask-sheet') || '', /pointer-events:auto/);
  assert.match(ruleBody('.ask-pill') || '', /pointer-events:auto/);
});

test('ui-ask-style: below 1080px the dock spans the viewport EVEN with a collapsed rail', () => {
  // the media rule must carry the higher-specificity selector too, or
  // body.rail-collapsed .ask-dock{left:76px} wins below the breakpoint
  const media = css.slice(css.indexOf('@media (max-width:1080px)', css.indexOf('.ask-dock')));
  const block = media.slice(0, media.indexOf('}', media.indexOf('{', media.indexOf('{') + 1)) + 1);
  assert.match(block, /body\.rail-collapsed \.ask-dock/, 'media rule restates the rail-collapsed selector');
  assert.match(block, /left:0/);
});

test('ui-ask-style: the sheet uses wr-rise and the card radius token', () => {
  const sheet = ruleBody('.ask-sheet');
  assert.match(sheet, /animation:wr-rise/);
  assert.match(sheet, /var\(--r-card\)/);
  assert.match(sheet, /width:min\(782px/);
  assert.match(sheet, /height:min\(669px/);
});

test('ui-ask-style: hidden twins exist for the hideable ask elements', () => {
  for (const sel of ['.ask-sheet[hidden]', '.ask-pill[hidden]', '.ask-jump[hidden]', '.ask-composer-msg[hidden]', '.ask-chips[hidden]']) {
    const body = ruleBody(sel);
    assert.ok(body, `${sel} twin exists`);
    assert.match(body, /display:none/);
  }
});

test('ui-ask-style: the ask section spends tokens, not hex', () => {
  const start = css.indexOf('/* ---------- Ask Worca');
  assert.ok(start !== -1, 'the ask section comment exists');
  const end = css.indexOf('/* ---------- reduced motion for the Running redesign');
  assert.ok(end > start, 'the ask section sits before the final reduced-motion block');
  const section = css.slice(start, end);
  assert.equal((section.match(/#[0-9a-fA-F]{6}\b/g) || []).length, 0, 'no 6-digit hex literals in the ask section');
  assert.ok(!/#[0-9a-fA-F]{3}\b/.test(section.replace(/#fff\b/g, '')), 'no non-#fff 3-digit hex either');
});

test('ui-ask-style: the FINAL reduced-motion block neutralises the dock', () => {
  const guard = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(css.slice(guard).includes('.ask-dock *{animation:none !important;}'), 'the last block carries the ask arm');
  // every ask animation reference precedes the guard
  const lastAskAnim = css.lastIndexOf('animation:wr-rise');
  assert.ok(lastAskAnim < guard, 'wr-rise uses sit before the final reduced-motion block');
});

test('ui-ask-style: the hljs variable block now feeds .ask-md too', () => {
  assert.match(css, /\.hd-diff-pane,\.ask-md\{\s*--hd-syntax-comment/, 'selector widened without restating hexes');
  const count = (css.match(/--hd-syntax-comment:#/g) || []).length;
  assert.equal(count, 1, 'the six syntax hexes still appear exactly once');
});

test('ui-ask-style: dots reuse wr-pulse; the pill and popovers are tokened', () => {
  assert.match(ruleBody('.ask-dot-run') || '', /animation:wr-pulse/);
  assert.match(ruleBody('.ask-dot-run') || '', /var\(--violet\)/);
  assert.match(ruleBody('.ask-dot-done') || '', /var\(--green\)/);
  assert.match(ruleBody('.ask-pill') || '', /border-radius:999px/);
  assert.match(ruleBody('.ask-pop') || '', /position:absolute/);
  assert.match(ruleBody('.ask-error-line') || '', /var\(--red-ink\)/);
});

test('ui-ask-style: composer textarea overrides the global textarea rules', () => {
  const input = ruleBody('.ask-composer textarea.ask-input');
  assert.ok(input, 'the higher-specificity selector exists (spec §10.3)');
  assert.match(input, /min-height:0/);
  assert.match(input, /max-height:120px/);
  assert.match(input, /resize:none/);
});
```

- [ ] **Step 9.2: Run to verify failure**

Run: `node --disable-warning=ExperimentalWarning --test --test-force-exit test/ui-ask-style.test.mjs`
Expected: FAIL — no `.ask-*` CSS exists yet.
- [ ] **Step 9.3: Implement.** Three edits to `ui/public/style.css`.

**(a)** Widen the hljs variable selector (`:1877`) — change ONLY the selector line. Bare `.hd-diff-pane{` is NOT unique (it also matches `.hd-diff-list,.hd-diff-pane{` at `:1876`), so the Edit `old_string` must be the two-line anchor

```css

.hd-diff-pane{
  --hd-syntax-comment
```

(leading blank line included), replaced by the same block with the widened selector:

```css

.hd-diff-pane,.ask-md{
  --hd-syntax-comment
```

(the six `--hd-syntax-*` declarations inside are untouched; `test/ui-diff-style.test.mjs`'s `hex()` reads the FIRST match, which this still is).

**(b)** Insert the ask section immediately BEFORE the final reduced-motion section comment. Edit anchor (unique): the line `/* ---------- reduced motion for the Running redesign ---------- */`. Insert above it:

```css
/* ---------- Ask Worca (spec §10.3-§10.6; tokens only, no hex) ---------- */
/* Fixed full-height dock over the content column; children restore pointer
   events. z-40 sits above sticky tab lists (5) and below .viewer-modal (50)
   and #confirm-modal (60) so page modals dim the sheet and confirmModal stays
   reusable. Left offsets track the rail: 298px expanded, 76px collapsed
   (.sidebar / .sidebar.collapsed own those widths). */
.ask-dock{position:fixed;top:0;bottom:0;right:0;left:298px;z-index:40;pointer-events:none;
  display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
  padding:0 28px 26px;transition:left .2s cubic-bezier(.65,.02,.28,1);}
body.rail-collapsed .ask-dock{left:76px;}
/* Below the rail breakpoint the sidebar is display:none while .collapsed may
   still be present — restate the higher-specificity selector or left:76px wins. */
@media (max-width:1080px){
  .ask-dock,body.rail-collapsed .ask-dock{left:0;}
}

.ask-pill{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:11px 18px 11px 14px;
  border:1.5px solid var(--line-2);border-radius:999px;background:var(--panel);color:var(--ink);
  font-family:inherit;font-weight:600;font-size:13.5px;cursor:pointer;
  box-shadow:0 6px 28px rgba(25,25,27,.10),0 1px 2px rgba(25,25,27,.06);transition:border-color .15s;}
.ask-pill:hover{border-color:var(--ink);}
.ask-pill:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.ask-pill[hidden]{display:none;}
.ask-pill-logo{width:22px;height:22px;border-radius:50%;}
.ask-kbd{padding:3px 7px;border-radius:7px;background:var(--field);color:var(--ink-3);
  font-family:var(--mono);font-weight:400;font-size:10.5px;}

.ask-sheet{pointer-events:auto;position:relative;display:flex;flex-direction:column;overflow:hidden;
  width:min(782px,100%);height:min(669px,calc(100% - 20px));background:var(--panel);
  border:1px solid var(--line-2);border-radius:var(--r-card);
  box-shadow:0 18px 60px rgba(25,25,27,.14),0 2px 6px rgba(25,25,27,.06);
  animation:wr-rise .26s cubic-bezier(.2,.7,.3,1) both;}
.ask-sheet[hidden]{display:none;}

.ask-header{display:flex;align-items:center;gap:10px;padding:13px 14px 13px 16px;border-bottom:1px solid var(--line);}
.ask-header-logo{width:20px;height:20px;border-radius:50%;}
.ask-title{font-weight:600;font-size:13px;color:var(--ink);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ask-header-spacer,.ask-composer-spacer,.ask-activity-spacer,.ask-card-actions-spacer{flex:1 1 auto;}
.ask-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;
  border:0;border-radius:9px;background:transparent;color:var(--ink-2);cursor:pointer;transition:.15s;}
.ask-icon-btn:hover{background:var(--field);color:var(--ink);}
.ask-icon-btn:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}

.ask-transcript{position:relative;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;
  padding:18px 20px 8px;display:flex;flex-direction:column;gap:16px;}
.ask-msg{display:flex;flex-direction:column;gap:6px;animation:wr-rise .2s cubic-bezier(.2,.7,.3,1) both;}
.ask-user-bubble{align-self:flex-end;max-width:78%;padding:10px 14px;border-radius:16px 16px 4px 16px;
  background:var(--field);color:var(--ink);font-size:13.5px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;}
.ask-user-pills{justify-content:flex-end;margin-top:0;}
.ask-attachment-pill{padding-right:12px;}

.ask-activity{border-left:1.5px solid var(--line);padding:2px 0 2px 14px;display:flex;flex-direction:column;gap:7px;}
.ask-activity-head{display:flex;align-items:center;gap:9px;min-width:0;}
.ask-dot{width:6px;height:6px;flex:0 0 6px;border-radius:50%;background:var(--seq);}
.ask-dot-run{background:var(--violet);animation:wr-pulse 1.6s ease-in-out infinite;}
.ask-dot-done{background:var(--green);animation:none;}
.ask-dot-live{background:var(--green);}
.ask-activity-label{font-weight:500;font-size:12px;color:var(--ink-2);white-space:nowrap;}
.ask-activity-elapsed{font-family:var(--mono);font-size:11px;color:var(--ink-3);}
.ask-activity-meter{font-family:var(--mono);font-size:10.5px;color:var(--ink-3);white-space:nowrap;}
.ask-tool-row{display:flex;align-items:center;gap:9px;min-width:0;}
.ask-tool-op{width:38px;flex:0 0 38px;font-family:var(--mono);font-size:10px;letter-spacing:.06em;
  text-transform:uppercase;color:var(--ink-3);}
.ask-tool-target{min-width:0;font-family:var(--mono);font-size:11.5px;color:var(--ink-2);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ask-tool-note{flex:0 0 auto;font-family:var(--mono);font-size:10.5px;color:var(--seq);}

.ask-agents{margin-top:3px;display:flex;flex-direction:column;gap:2px;}
.ask-agents-cap{display:flex;align-items:center;gap:8px;padding:2px 0 3px;font-weight:600;font-size:9.5px;
  letter-spacing:.12em;text-transform:uppercase;color:var(--seq);}
.ask-agents-count{padding:1px 6px;border-radius:999px;background:var(--field);color:var(--ink-3);
  font-family:var(--mono);font-weight:400;font-size:9.5px;letter-spacing:0;text-transform:none;}
.ask-agent-row{display:flex;align-items:center;gap:9px;width:100%;padding:5px 7px;border:0;border-radius:9px;
  background:transparent;text-align:left;cursor:pointer;font-family:inherit;transition:.15s;}
.ask-agent-row:hover{background:var(--field);}
.ask-agent-row:focus-visible{outline:2px solid var(--ink);outline-offset:-2px;}
.ask-agent-name{min-width:0;font-family:var(--mono);font-size:11.5px;color:var(--ink);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ask-agent-model,.ask-agent-tokens,.ask-agent-cost{flex:0 0 auto;font-family:var(--mono);font-size:10px;color:var(--ink-3);}
.ask-agent-status{flex:0 0 auto;margin-left:auto;font-weight:500;font-size:10.5px;color:var(--ink-3);}
.ask-agent-status.is-done{color:var(--green-ink);}
.ask-agent-log{margin:1px 0 6px 22px;border:1px solid var(--line);border-radius:11px;overflow:hidden;}
.ask-agent-log-head{display:flex;align-items:center;gap:10px;padding:6px 10px;border-bottom:1px solid var(--line);
  background:var(--panel);font-family:var(--mono);font-size:10px;color:var(--ink-3);}
.ask-agent-log-type{margin-left:auto;}
.ask-agent-log-body{max-height:104px;overflow-y:auto;padding:7px 10px;background:var(--field);
  font-family:var(--mono);font-size:10.5px;line-height:1.75;color:var(--ink-2);}
.ask-agent-log-line{display:flex;gap:8px;min-width:0;}
.ask-agent-log-t{flex:0 0 auto;color:var(--seq);}
.ask-agent-log-text{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;}

.ask-answer{max-width:92%;font-size:13.5px;line-height:1.72;color:var(--ink);}
.ask-answer-plain{white-space:pre-wrap;overflow-wrap:anywhere;}
.ask-md :is(h1,h2,h3,h4,h5,h6){margin:14px 0 6px;font-size:13.5px;font-weight:600;color:var(--ink);}
.ask-md h1{font-size:15px;}
.ask-md h2{font-size:14px;}
.ask-md p{margin:6px 0;}
.ask-md :is(ul,ol){margin:6px 0;padding-left:22px;}
.ask-md li{margin:2px 0;}
.ask-md blockquote{margin:8px 0;padding:2px 12px;border-left:2px solid var(--line-2);color:var(--ink-2);}
.ask-md hr{border:0;border-top:1px solid var(--line);margin:12px 0;}
.ask-md a{color:var(--blue-ink);}
.ask-md code{font-family:var(--mono);font-size:11.5px;background:var(--field);border-radius:4px;padding:1px 4px;}
.ask-md pre{margin:8px 0;padding:10px 12px;background:var(--field);border:1px solid var(--line);
  border-radius:10px;overflow-x:auto;}
.ask-md pre code{background:transparent;padding:0;font-size:11px;line-height:1.6;display:block;white-space:pre;}
.ask-md table{border-collapse:collapse;margin:8px 0;font-size:12.5px;}
.ask-md :is(th,td){border:1px solid var(--line);padding:4px 9px;text-align:left;}
.ask-md th{background:var(--field);font-weight:600;}
.ask-md input[type="checkbox"]{margin-right:6px;}

.ask-notice{font-size:12.5px;color:var(--ink-3);}
.ask-notice-link{color:var(--blue-ink);}
.ask-error-line{font-size:12.5px;color:var(--red-ink);}

.ask-card{margin-top:2px;display:flex;flex-direction:column;gap:10px;padding:13px 15px;
  border:1.5px solid var(--line);border-radius:16px;background:var(--panel);}
.ask-card-title{font-weight:600;font-size:12.5px;color:var(--ink);}
.ask-card-seg{display:flex;gap:4px;}
.ask-card-seg-btn{padding:5px 12px;border:1px solid var(--line-2);border-radius:999px;background:transparent;
  color:var(--ink-2);font-family:inherit;font-weight:600;font-size:11px;cursor:pointer;transition:.15s;}
.ask-card-seg-btn.on{background:var(--ink);border-color:var(--ink);color:var(--panel);}
.ask-card-target{display:flex;flex-direction:column;gap:10px;}
.ask-card-field{display:flex;flex-direction:column;gap:4px;}
.ask-card-label{font-weight:600;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-3);}
.ask-card :is(select,input[type="text"],textarea){font-size:12.5px;padding:8px 11px;border-radius:10px;}
.ask-card textarea.ask-card-brief{min-height:0;height:auto;max-height:160px;resize:none;line-height:1.5;}
.ask-card-members{font-family:var(--mono);font-size:10.5px;color:var(--ink-3);}
.ask-card-members-src summary{font-weight:600;font-size:10.5px;color:var(--ink-3);cursor:pointer;}
.ask-card-members-src-list{display:flex;flex-direction:column;gap:8px;margin-top:8px;}
.ask-card-err{font-size:12px;color:var(--red-ink);min-height:0;}
.ask-card-err:empty{display:none;}
.ask-card-actions{display:flex;align-items:center;gap:8px;}
.ask-card-open-np{border:0;background:transparent;padding:0;color:var(--blue-ink);font-family:inherit;
  font-size:11.5px;cursor:pointer;}
.ask-card-not-now{padding:8px 13px;border:0;border-radius:999px;background:transparent;color:var(--ink-2);
  font-family:inherit;font-weight:600;font-size:12px;cursor:pointer;transition:.15s;}
.ask-card-not-now:hover{background:var(--field);color:var(--ink);}
.ask-card-start{display:flex;align-items:center;gap:7px;padding:8px 15px;border:0;border-radius:999px;
  background:var(--ink);color:var(--panel);font-family:inherit;font-weight:600;font-size:12px;cursor:pointer;transition:.15s;}
.ask-card-start:hover{filter:brightness(1.35);}
.ask-card-start:disabled{opacity:.55;cursor:default;}
.ask-card :is(.ask-card-seg-btn,.ask-card-not-now,.ask-card-start,.ask-card-open-np):focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.ask-card-stub{font-size:12.5px;color:var(--ink-3);}
.ask-card-failed{color:var(--red-ink);}
.ask-card-link{color:var(--blue-ink);}

.ask-jump{position:absolute;left:0;right:0;bottom:104px;margin:0 auto;width:max-content;
  display:flex;align-items:center;gap:7px;padding:6px 12px;border:1px solid var(--line-2);border-radius:999px;
  background:var(--panel);color:var(--ink);font-family:inherit;font-weight:600;font-size:11.5px;cursor:pointer;
  box-shadow:0 6px 18px rgba(25,25,27,.10);transition:border-color .15s;}
.ask-jump:hover{border-color:var(--ink);}
.ask-jump[hidden]{display:none;}

.ask-composer{position:relative;flex:0 0 auto;border-top:1px solid var(--line);padding:10px 12px 11px;
  display:flex;flex-direction:column;gap:4px;}
.ask-chips{display:flex;flex-wrap:wrap;gap:6px;padding:2px 4px 4px;}
.ask-chips[hidden]{display:none;}
.ask-chip{display:inline-flex;align-items:center;gap:7px;padding:5px 8px 5px 9px;border:1px solid var(--line);
  border-radius:8px;background:var(--field);color:var(--ink-2);font-family:var(--mono);font-size:11px;max-width:240px;}
.ask-chip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ask-chip-x{border:0;background:transparent;color:var(--ink-3);cursor:pointer;font-family:inherit;
  font-size:13px;line-height:1;padding:1px 4px;border-radius:5px;transition:.15s;}
.ask-chip-x:hover{background:var(--line);color:var(--ink);}
.ask-composer textarea.ask-input{min-height:0;height:auto;max-height:120px;resize:none;border:0;border-radius:0;
  background:transparent;padding:6px 6px 8px;font-size:13.5px;line-height:1.6;}
.ask-composer textarea.ask-input:focus{background:transparent;border-color:transparent;}
.ask-composer textarea.ask-input:focus-visible{outline:none;}
.ask-composer-msg{font-size:11.5px;color:var(--red-ink);padding:0 6px;}
.ask-composer-msg[hidden]{display:none;}
.ask-composer-row{display:flex;align-items:center;gap:8px;position:relative;}
.ask-meter{display:flex;align-items:center;gap:7px;font-family:var(--mono);font-size:10.5px;
  color:var(--ink-3);white-space:nowrap;}
.ask-meter-sep{color:var(--line-2);}
.ask-meter-cost{color:var(--ink-2);}
.ask-agents-btn{display:flex;align-items:center;gap:6px;padding:5px 8px;border:0;border-radius:8px;
  background:transparent;color:var(--ink-3);font-family:var(--mono);font-size:10.5px;white-space:nowrap;
  cursor:pointer;transition:.15s;}
.ask-agents-btn:hover{background:var(--field);color:var(--ink);}
.ask-model-btn{display:flex;align-items:center;gap:7px;padding:6px 10px;border:0;border-radius:9px;
  background:transparent;color:var(--ink);font-family:inherit;font-weight:600;font-size:12.5px;cursor:pointer;transition:.15s;}
.ask-model-btn:hover{background:var(--field);}
.ask-model-btn-effort{font-weight:500;color:var(--ink-3);}
.ask-send,.ask-stop{display:inline-flex;align-items:center;justify-content:center;width:31px;height:31px;
  flex:0 0 31px;border-radius:50%;cursor:pointer;transition:.15s;}
.ask-send{border:0;background:var(--ink);color:var(--panel);}
.ask-send:hover{filter:brightness(1.35);}
.ask-send[hidden]{display:none;}
.ask-stop{border:1.5px solid var(--line);background:var(--panel);color:var(--ink);}
.ask-stop:hover{border-color:var(--ink);}
.ask-stop[hidden]{display:none;}
.ask-composer :is(.ask-agents-btn,.ask-model-btn,.ask-send,.ask-stop,.ask-chip-x):focus-visible{outline:2px solid var(--ink);outline-offset:2px;}

.ask-pop{position:absolute;z-index:3;background:var(--panel);border:1px solid var(--line-2);
  padding:6px;box-shadow:0 12px 34px rgba(25,25,27,.12);border-radius:16px;}
.ask-pop-threads{top:46px;right:76px;width:284px;}
.ask-pop-model{right:30px;bottom:42px;width:292px;border-radius:18px;}
.ask-pop-runinfo{right:96px;bottom:44px;width:326px;z-index:4;}
.ask-pop-caption,.ask-pop-caption-row .ask-pop-caption{padding:8px 10px 6px;font-weight:600;font-size:10px;
  letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);}
.ask-pop-caption-row{display:flex;align-items:baseline;gap:8px;}
.ask-pop-caption-meter{margin-left:auto;padding-right:10px;font-family:var(--mono);font-size:10px;color:var(--ink-3);}
.ask-pop-empty{padding:10px 10px 12px;font-size:12px;color:var(--ink-3);}
.ask-pop-divider{height:1px;margin:6px 11px;background:var(--line);}
.ask-pop-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 11px;border:0;border-radius:12px;
  background:transparent;text-align:left;font-family:inherit;cursor:pointer;transition:.15s;}
.ask-pop-item:hover,.ask-pop-item:focus-visible{background:var(--field);outline:none;}
.ask-model-name{font-weight:500;font-size:13.5px;color:var(--ink);}
.ask-model-check{margin-left:auto;color:var(--blue-ink);font-weight:600;}
.ask-pop-row-value{margin-left:auto;font-weight:400;font-size:12.5px;color:var(--ink-3);}
.ask-pop-row-chev{color:var(--ink-3);}
.ask-thread-row{display:flex;align-items:center;border-radius:10px;}
.ask-thread-row:hover{background:var(--field);}
.ask-thread-pick{flex:1 1 auto;min-width:0;padding:8px 4px 8px 10px;border-radius:10px;}
.ask-thread-col{display:flex;flex-direction:column;gap:1px;min-width:0;}
.ask-thread-title{font-weight:500;font-size:12.5px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ask-thread-meter{font-family:var(--mono);font-size:10px;color:var(--ink-3);}
.ask-thread-trash{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;
  flex:0 0 26px;margin-right:5px;border:0;border-radius:8px;background:transparent;color:var(--seq);
  cursor:pointer;transition:.15s;}
.ask-thread-trash:hover{background:var(--red-bg);color:var(--red-ink);}
.ask-thread-trash:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.ask-runinfo-row{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:10px;}
.ask-runinfo-row:hover{background:var(--field);}
.ask-runinfo-col{display:flex;flex-direction:column;gap:1px;min-width:0;}
.ask-runinfo-name{font-family:var(--mono);font-size:11.5px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ask-runinfo-sub{font-family:var(--mono);font-size:10px;color:var(--ink-3);}
.ask-runinfo-elapsed{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--seq);}

```

**(c)** Add the reduced-motion arm INSIDE the existing final block. The line `.rd-sec-logs .log::after{animation:none;}` appears TWICE in the file (`:2535` and again in the final block) — do NOT anchor on it. Anchor instead on inserting the ask arm immediately BEFORE the line `  .run-shell *{animation:none !important;}` inside the FINAL `@media (prefers-reduced-motion: reduce)` block (former `:2804`):

```css
  /* Ask Worca: every element inside the dock, same blanket rationale as the
     .run-shell one below. */
  .ask-dock *{animation:none !important;}
```

- [ ] **Step 9.4: Run to verify pass**

Run: `node --disable-warning=ExperimentalWarning --test test/ui-ask-style.test.mjs test/ui-theme.test.mjs test/ui-diff-style.test.mjs test/ui-shell.test.mjs`
Expected: **9 new pass + the three fences stay green** (hex-once, keyframe-once, reduced-motion ordering, hd-syntax first-match).

- [ ] **Step 9.5: Full suite**

Run: `npm test`
Expected: **3336 pass / 0 fail**.

- [ ] **Step 9.6: Commit**

```bash
git add ui/public/style.css test/ui-ask-style.test.mjs
git commit -m "worca ask p3: stylesheet"
```

---
### Task 10: app.js seams 1–6, mount, integration suite

**Files:**
- Modify: `ui/public/app.js` (~45 additive lines across seven sites)
- Test: `test/ui-ask-integration.test.mjs`

**Interfaces:**
- Consumes: the Task 3–8 panel API. Produces: the mounted panel + `getPageContext()` + `openNewPipeline(prefill)` (navigation half — Task 11 consumes `newPipelinePrefill`). The `window.__worcaTestHooks.askMarkdown` seam (the 8th seam): read ONCE at mount with the `?.` + `??` idiom of `app.js:90` and passed AS the panel's `loadMarkdown`.

- [ ] **Step 10.1: Write the failing tests** — `test/ui-ask-integration.test.mjs`, full file:

```js
// test/ui-ask-integration.test.mjs — the ask panel inside the real app shell
// (spec §10.2 seams 1-6, §12 ui-ask-integration). Boot preamble copied from
// test/ui-running-routing.test.mjs:34-94 (the house convention: duplicated per
// suite, no shared harness), with /api/ask fetch arms added and the
// __worcaTestHooks.askMarkdown hook set before the import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const TID = 'ask_00000001';
const MID = 'askm_00000001';

function askArms(url, opts) {
  const method = ((opts && opts.method) || 'GET').toUpperCase();
  if (url.includes('/api/ask/models')) {
    return { ok: true, status: 200, json: async () => ({ models: [{ id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false }, { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false }], efforts: ['medium', 'high', 'xhigh', 'max'] }) };
  }
  if (url.includes(`/api/ask/threads/${TID}/messages`) && method === 'POST') {
    return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: MID }) };
  }
  if (url.includes(`/api/ask/threads/${TID}`) && method === 'DELETE') {
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }
  if (url.includes(`/api/ask/threads/${TID}`)) {
    return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} }, messages: [], attachments: [], runLinks: [], inFlight: null }) };
  }
  if (url.includes('/api/ask/threads') && method === 'POST') {
    return { ok: true, status: 201, json: async () => ({ thread: { id: TID, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } }) };
  }
  if (url.includes('/api/ask/threads')) {
    return { ok: true, status: 200, json: async () => ({ threads: [{ id: TID, title: 'T', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false }] }) };
  }
  return null;
}

async function boot({ url = 'http://localhost:4317/' } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};

  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {}
    close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };

  const calls = [];
  window.fetch = (u, opts) => {
    const url2 = String(u);
    calls.push({ url: url2, opts: opts || {} });
    const ask = askArms(url2, opts);
    if (ask) return Promise.resolve(ask);
    if (url2.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: '/repos/proj', exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }) });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();
  // renderProjectOptions (app.js:5370-5399) restores the selection from
  // worca-cc.lastProject BY NAME and otherwise leaves the disabled placeholder
  // selected — with a cleared store selectedProjectPath() would be '' and the
  // page context would carry no projectDir. Seed the remembered name.
  window.localStorage.setItem('worca-cc.lastProject', 'proj');
  window.__worcaTestHooks = { askMarkdown: async () => { throw new Error('markdown disabled in integration'); } };

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  const open = () => lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  open();
  return { window, calls, recv };
}

async function settle(window, n = 4) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}
function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}
function keydown(window, target, init) {
  const e = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
function pointerdown(window, target) {
  target.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }));
}
// the hello row shape mirrors test/ui-running-routing.test.mjs's summarizeRuns rows
const RUN_ROW = { runId: 'r1', title: 'a run', projectDir: '/p', status: 'running', startedAt: '10:00:00', kind: 'run', pipelineId: null, pendingQuestion: null, pauseReason: null };

async function openSheet(window) {
  window.document.querySelector('.ask-pill').click();
  await settle(window);
}
async function sendText(window, text) {
  const input = window.document.querySelector('textarea.ask-input');
  input.value = text;
  window.document.querySelector('[data-ask-send]').click();
  await settle(window, 6);
}

test('ui-ask-integration: boot mounts a closed dock as a body child; zero /api/ask fetches at boot', async () => {
  const { window, calls } = await boot();
  const dock = window.document.querySelector('body > .ask-dock');
  assert.ok(dock, 'dock is a direct body child');
  assert.equal(dock.querySelector('.ask-sheet').hidden, true);
  assert.equal(dock.querySelector('.ask-pill').hidden, false);
  assert.equal(dock.querySelector('[data-view],[data-nav]'), null);
  assert.ok(calls.every((c) => !c.url.includes('/api/ask')), 'no ask fetch at boot — the repo-wide fence');
});

test('ui-ask-integration: ⌘K and Ctrl+K toggle with preventDefault', async () => {
  const { window } = await boot();
  const e1 = keydown(window, window.document.body, { key: 'k', metaKey: true });
  assert.equal(e1.defaultPrevented, true);
  assert.equal(window.document.querySelector('.ask-sheet').hidden, false);
  keydown(window, window.document.body, { key: 'k', metaKey: true });
  assert.equal(window.document.querySelector('.ask-sheet').hidden, true);
  keydown(window, window.document.body, { key: 'k', ctrlKey: true });
  assert.equal(window.document.querySelector('.ask-sheet').hidden, false);
});

test('ui-ask-integration: the sheet survives view navigation', async () => {
  const { window } = await boot();
  await openSheet(window);
  go(window, 'running');
  go(window, 'history');
  go(window, 'settings');
  await settle(window);
  assert.equal(window.document.querySelector('.ask-sheet').hidden, false);
  assert.ok(window.document.querySelector('body > .ask-dock'));
});

test('ui-ask-integration: Escape is routed by focus location', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [RUN_ROW], ask: [] });
  await settle(window);
  go(window, 'running/r1');
  await settle(window);
  assert.ok(window.document.querySelector('.run-shell').classList.contains('detail-open'), 'running detail open');
  await openSheet(window);
  const input = window.document.querySelector('textarea.ask-input');
  input.focus();
  keydown(window, input, { key: 'Escape' });
  await settle(window);
  assert.equal(window.location.hash, '#running/r1', 'sheet-owned Escape left the detail alone');
  keydown(window, window.document.body, { key: 'k', metaKey: true }); // ⌘K closes the sheet
  await settle(window);
  keydown(window, window.document.body, { key: 'Escape' });
  await settle(window);
  assert.equal(window.location.hash, '#running', 'document Escape still routes the detail back');
});

test('ui-ask-integration: ask frames reach the panel; runId frames do not', async () => {
  const { window, recv } = await boot();
  await openSheet(window);
  await sendText(window, 'stream something');
  recv({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'claude-opus-5', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  recv({ type: 'ask-delta', text: 'streamed!', threadId: TID, messageId: MID, seq: 2 });
  await settle(window);
  assert.match(window.document.querySelector('.ask-transcript').textContent, /streamed!/);
  recv({ type: 'state', runId: 'r1', status: 'running' }); // must not throw or touch the panel
  await settle(window);
  assert.match(window.document.querySelector('.ask-transcript').textContent, /streamed!/);
});

test('ui-ask-integration: hello without an ask field is tolerated', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [] });
  recv({ type: 'hello', runs: [], ask: [] });
  await settle(window);
  assert.ok(window.document.querySelector('body > .ask-dock'), 'still alive');
});

test('ui-ask-integration: body.rail-collapsed follows the sidebar toggle', async () => {
  const { window } = await boot();
  assert.equal(window.document.body.classList.contains('rail-collapsed'), false);
  window.document.querySelector('#side-toggle').click();
  assert.equal(window.document.body.classList.contains('rail-collapsed'), true);
  window.document.querySelector('#side-toggle').click();
  assert.equal(window.document.body.classList.contains('rail-collapsed'), false);
});

test('ui-ask-integration: delete flows through confirmModal and focus returns to the textarea', async () => {
  const { window, calls } = await boot();
  await openSheet(window);
  window.document.querySelector('[data-ask-threads-btn]').click();
  await settle(window);
  window.document.querySelector('.ask-thread-trash').click();
  await settle(window);
  const modal = window.document.querySelector('#confirm-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'the app confirmModal is up');
  assert.equal(window.document.querySelector('#confirm-title').textContent, 'Delete this chat?');
  window.document.querySelector('#confirm-ok').click();
  await settle(window, 6);
  assert.ok(calls.some((c) => c.url.includes(`/api/ask/threads/${TID}`) && c.opts.method === 'DELETE'));
  assert.equal(window.document.activeElement, window.document.querySelector('textarea.ask-input'));
});

test('ui-ask-integration: pointerdown inside .viewer-modal keeps the sheet open', async () => {
  const { window } = await boot();
  await openSheet(window);
  const viewer = window.document.querySelector('#viewer-card');
  viewer.classList.remove('hidden');
  pointerdown(window, viewer);
  assert.equal(window.document.querySelector('.ask-sheet').hidden, false);
  pointerdown(window, window.document.querySelector('.main'));
  assert.equal(window.document.querySelector('.ask-sheet').hidden, true, 'outside still closes');
});

test('ui-ask-integration: the send body carries the resolved page context', async () => {
  const { window, calls, recv } = await boot();
  await openSheet(window);
  await sendText(window, 'context check one');
  const post1 = calls.filter((c) => c.url.includes('/messages') && c.opts.method === 'POST').at(-1);
  assert.deepEqual(JSON.parse(post1.opts.body).context, { view: 'new', projectDir: '/repos/proj' });
  recv({ type: 'ask-done', text: 'ok', blocks: [], usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 5, model: 'm', status: 'done', threadTotals: {}, threadId: TID, messageId: MID, seq: 1 });
  recv({ type: 'hello', runs: [RUN_ROW], ask: [] });
  await settle(window);
  go(window, 'running/r1');
  await settle(window);
  await sendText(window, 'context check two');
  const post2 = calls.filter((c) => c.url.includes('/messages') && c.opts.method === 'POST').at(-1);
  assert.deepEqual(JSON.parse(post2.opts.body).context, { view: 'running', runId: 'r1', projectDir: '/p' });
});
```

NB the second send in the last test rides the SAME thread (the panel keeps `st.threadId`); the interleaved `ask-done` for seq 1 exists only to clear any in-flight state — the panel refuses to send while `live()` is set. If the seq bookkeeping of that synthetic frame proves awkward in the dry-run (no `ask-start` preceded it, so the model drops it as `no-live` — which is FINE, nothing was in flight), simply delete that `recv` line; it is belt-and-braces.

- [ ] **Step 10.2: Run to verify failure**

Run: `node --disable-warning=ExperimentalWarning --test --test-force-exit test/ui-ask-integration.test.mjs`
Expected: FAIL — `document.body` has no `.ask-dock` (nothing is mounted).
- [ ] **Step 10.3: Implement — seven edits to `ui/public/app.js`** (anchors from the anchor table; every edit is additive).

**(1) Import + module refs.** After the existing line `const diffHljsLoader = window.__worcaTestHooks?.hljsLoader ?? createHljsLoader();` (`:90`) add:

```js
let askPanel = null;           // Ask Worca panel — assigned by the boot mount; every seam uses askPanel?.
let newPipelinePrefill = null; // one-shot card → New Pipeline handoff (§10.2 seam 7, consumed by Task 11)
```

and add to the import block (after the `results-view.mjs` import at `:62`):

```js
import { createAskPanel } from './ask-panel.mjs';
```

**(2) WS branch.** In `handleServerMessage`, immediately AFTER the agent-gen early branch (its closing `}` at `:566`, before the blank line) insert:

```js
  // Ask Worca frames are tagged by threadId (job frames also carry messageId +
  // seq) and ride the same broadcast socket. Handle them BEFORE the
  // !msg.runId early-return below.
  if (typeof msg.type === 'string' && msg.type.startsWith('ask-')) {
    askPanel?.pushServerFrame(msg);
    return;
  }
```

**(3) Hello.** In `onHello`, between the backfill loop's closing `}` (`:753`) and `refreshAllCounts();` (`:755`) insert:

```js
  askPanel?.onHello(msg.ask);
```

**(4) Escape guards.** In BOTH capture-phase Escape handlers, immediately after their `if (e.key !== 'Escape') return;` line (`:12464` and `:12484`) insert:

```js
  if (askPanel?.ownsKey(e)) return;
```

The one-liner `  if (e.key !== 'Escape') return;` appears in BOTH handlers, so each Edit's `old_string` must be TWO lines — the guard plus the view check that follows it:

```js
  if (e.key !== 'Escape') return;
  if (currentView() !== 'history') return;
```

for the History handler, and

```js
  if (e.key !== 'Escape') return;
  if (currentView() !== 'running') return;
```

for the Running one (each `new_string` keeps both lines with `  if (askPanel?.ownsKey(e)) return;` between them).

**(5) Rail flag.** In `applySidebarCollapsed()`, after the line `if (aside) aside.classList.toggle('collapsed', sidebarCollapsed);` (`:369`) insert:

```js
  document.body.classList.toggle('rail-collapsed', sidebarCollapsed);
```

(the boot call at `:429` now stamps the body class before the panel mounts — the dock inherits the right offset from CSS alone).

**(6) Page context + navigation handoff.** Insert BEFORE the `// boot` banner comment (`:14255`):

```js
// ---- Ask Worca seams (§10.2) ----------------------------------------------
// Server-resolvable page context only (§6.5 keys); the server re-validates and
// resolves every id against its own rows — never send titles or names.
function getPageContext() {
  const [view, param] = parseHash();
  const ctx = { view: VIEW_NAMES.includes(view) ? view : 'new' };
  if (ctx.view === 'running' && param) {
    const r = runs.get(param);
    if (r) {
      ctx.runId = param;
      if (r.pipelineId) ctx.pipelineId = r.pipelineId;
      if (r.kind === 'workspace-run' && r.workspaceId) ctx.workspaceId = r.workspaceId;
      else if (r.projectDir) ctx.projectDir = r.projectDir;
      return ctx;
    }
  }
  if (ctx.view === 'history' && param) {
    const p = parseHistDetailParam(param);
    if (p) {
      ctx.view = 'history-detail';
      ctx.pipelineId = p.id;
      if (p.workspace) ctx.workspaceId = p.projectKey.slice('workspaces/'.length);
      else ctx.projectKey = p.projectKey;
      return ctx;
    }
  }
  if (ctx.view === 'new' && state.runTarget === 'workspace' && state.selectedWorkspaceId) {
    ctx.workspaceId = state.selectedWorkspaceId;
    return ctx;
  }
  const dir = selectedProjectPath();
  if (dir) ctx.projectDir = dir;
  return ctx;
}

function openNewPipeline(prefill) {
  newPipelinePrefill = prefill || null;
  askPanel?.close();
  // hash already #new fires no hashchange — call showView directly (the
  // nav-click guard at the navLinks handler models this exact case).
  if (location.hash.slice(1) === 'new') showView('new');
  else location.hash = 'new';
}
```

**(7) Mount.** Append at the very end of the file (after `startBudgetTick();`, `:14271`):

```js
// Ask Worca mount (§10.2 seam 1): a JS-built body-level overlay — index.html is
// untouched so ui-shell's data-view census stays at 14. No network happens here;
// the panel fetches only on first open / hello.
askPanel = createAskPanel({
  doc: document,
  win: window,
  fetch: (...args) => fetch(...args),
  sendWs: (obj) => {
    const ws = state.ws;
    if (ws && state.wsReady) {
      try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
    }
  },
  confirm: confirmModal,
  getPageContext,
  openNewPipeline,
  loadMarkdown: window.__worcaTestHooks?.askMarkdown
    ?? (() => Promise.all([import('/vendor/marked/marked.esm.js'), import('/vendor/dompurify/purify.es.mjs')])
      .then(([m, d]) => ({ marked: m.marked, createDOMPurify: d.default }))),
  hljsLoader: diffHljsLoader,
  storage: window.localStorage,
  raf: window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : ((fn) => setTimeout(fn, 0)),
  now: () => Date.now(),
});
document.body.appendChild(askPanel.root);
```

- [ ] **Step 10.4: Run to verify pass**

Run: `node --disable-warning=ExperimentalWarning --test test/ui-ask-integration.test.mjs`
Expected: **10 pass / 0 fail**.

- [ ] **Step 10.5: Regression fences + full suite**

Run: `node --disable-warning=ExperimentalWarning --test test/ui-shell.test.mjs test/ui-boot.test.mjs test/ui-theme.test.mjs test/ui-running-routing.test.mjs test/ui-history-detail.test.mjs test/ui-settings.test.mjs`
Expected: all green — the mount performs no network, adds no markup to index.html, and `askPanel?.` guards every seam. Then `npm test` → **3346 pass / 0 fail**. If ANY previously-green ui-* suite reds here, the failure is almost certainly a boot fetch or an unguarded seam — fix the seam, never the fence.

- [ ] **Step 10.6: Commit**

```bash
git add ui/public/app.js test/ui-ask-integration.test.mjs
git commit -m "worca ask p3: app.js seams and panel mount"
```

---
### Task 11: Seam 7 — New Pipeline prefill + card-in-app suite

**Files:**
- Modify: `ui/public/app.js` (add `applyAskPrefill`; hook it into the `'new'` arm)
- Test: `test/ui-ask-card.test.mjs`

**Interfaces:** consumes `newPipelinePrefill` (Task 10) + the V10 prefill shape from `prefillFromCard` (Task 8). Ordering is NON-NEGOTIABLE (the `refreshBranches` early-return trap): `setRunTarget` → force the prompt source (3-step reset: `state.activePluginSource = null`, check the `prompt` radio, fix the `#source-seg` `.on` classes) → project select + `onProjectChanged()` / workspace select + `change` dispatch → `#prompt` + `refreshMentionHighlights()` → `#title` → `await loadWorkflowsInto(id)` → `await loadGuardrailsInto(id)` + `#advanced-config.open` → `#featureBranch` → `await refreshBranches(dir)` THEN `#sourceBranch` (append the option if the branch list lacks it) / per-member `select.ws-src-select` values after the async rebuild. Known deliberate side effects (documented, accepted): the prefill updates `worca-cc.runTarget` and `worca-cc.lastProject` — the same thing happens when the user drives the form by hand.

- [ ] **Step 11.1: Write the failing tests** — `test/ui-ask-card.test.mjs`, full file. Boot preamble: copy Task 10's (`test/ui-ask-integration.test.mjs`) verbatim including `askArms`, with the plumbing below spliced into its `boot()` — a `runResponse` override, a `runBodies` recorder and five extra fetch arms. This is the dry-run-resolved form; nothing in it is left to the implementer:

```js
async function boot({ url = 'http://localhost:4317/', runResponse = null } = {}) {
  // …everything from Task 10's boot() down to and including `const calls = [];`…
  const runBodies = [];
  window.fetch = (u, opts) => {
    const url2 = String(u);
    calls.push({ url: url2, opts: opts || {} });
    const ask = askArms(url2, opts);
    if (ask) return Promise.resolve(ask);
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    const path = url2.split('?')[0];
    if (path.endsWith('/api/run') && method === 'POST') {
      runBodies.push(JSON.parse(opts.body));
      return Promise.resolve(runResponse || { ok: true, status: 200, json: async () => ({ runId: 'run-uuid-1' }) });
    }
    // EXACT path match, not includes(): /api/workflows/:id is the per-workflow
    // config fetch — a substring test hands it the LIST envelope instead.
    if (path.endsWith('/api/workflows')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_review', name: 'Review only' }] }) });
    }
    if (path.endsWith('/api/guardrails')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ guardrails: [{ id: 'permissive', name: 'Permissive' }, { id: 'normal', name: 'Normal' }] }) });
    }
    if (path.endsWith('/api/workspaces')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [{ id: 'wks-team-00000001', name: 'team', projectPaths: ['/repos/proj', '/repos/lib'], projectKeys: ['proj-00000001', 'lib-00000002'] }] }) });
    }
    if (path.endsWith('/api/branches')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ branches: ['main', 'dev'], current: 'main' }) });
    }
    if (url2.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: '/repos/proj', exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }) });
  };
  // …the rest of Task 10's boot() verbatim (globals, localStorage seed, app
  // import, open(), recv) …
  return { window, calls, recv, runBodies };
}
```

Shared driver:

```js
const CARD = { target: 'project', projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj', workspaceId: null, workspaceName: null, members: null, workflowId: 'wf_review', workflowName: 'Review only', guardrailsId: 'normal', brief: 'Fix the login bug', title: 'Fix login', sourceBranch: 'dev', featureBranch: 'worca/fix-login', sourceBranchByKey: null };
const WS_CARD = { ...CARD, target: 'workspace', projectKey: null, projectName: null, projectDir: null, workspaceId: 'wks-team-00000001', workspaceName: 'team', members: [{ projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj' }, { projectKey: 'lib-00000002', projectName: 'lib', projectDir: '/repos/lib' }], sourceBranch: '', sourceBranchByKey: { 'lib-00000002': 'release' } };

async function openCard(ctx, card) {
  await openSheet(ctx.window);
  await sendText(ctx.window, 'please help');       // 202 wires the thread
  ctx.recv({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  ctx.recv({ type: 'ask-card', block: { kind: 'card', id: 'card_00000001', state: 'proposed', card }, threadId: TID, messageId: MID, seq: 2 });
  await settle(ctx.window, 6); // options load
}
```

The five tests:

```js
test('ui-ask-card: Start posts the §9.4 body from inside the app; the page does not navigate', async () => {
  const ctx = await boot();
  await openCard(ctx, CARD);
  const before = ctx.window.location.hash;
  ctx.window.document.querySelector('[data-ask-card-start]').click();
  await settle(ctx.window, 6);
  assert.equal(ctx.runBodies.length, 1);
  assert.deepEqual(ctx.runBodies[0], {
    projectDir: '/repos/proj', prompt: 'Fix the login bug', workflowId: 'wf_review', guardrailsId: 'normal',
    title: 'Fix login', sourceBranch: 'dev', featureBranch: 'worca/fix-login', mock: false,
    askThreadId: TID, askCardId: 'card_00000001',
  });
  assert.equal(ctx.window.location.hash, before, 'beginRun is never called — no navigation');
  // the flip frame renders the started link
  ctx.recv({ type: 'ask-card', block: { kind: 'card', id: 'card_00000001', state: 'started', runId: 'run-uuid-1', card: CARD }, threadId: TID, messageId: MID, seq: 3 });
  await settle(ctx.window);
  assert.ok(ctx.window.document.querySelector('.ask-card a[href="#running/run-uuid-1"]'));
});

test('ui-ask-card: a 403 stays on the editable card with the error inline', async () => {
  const ctx = await boot({ runResponse: { ok: false, status: 403, json: async () => ({ error: 'total cost limit reached' }) } });
  await openCard(ctx, CARD);
  ctx.window.document.querySelector('[data-ask-card-start]').click();
  await settle(ctx.window, 6);
  assert.equal(ctx.window.document.querySelector('.ask-card-err').textContent, 'total cost limit reached');
  assert.ok(ctx.window.document.querySelector('.ask-card-brief'), 'still editable');
});

test('ui-ask-card: Not now dismisses; the flip renders the stub', async () => {
  const ctx = await boot();
  await openCard(ctx, CARD);
  ctx.window.document.querySelector('[data-ask-card-dismiss]').click();
  await settle(ctx.window, 4);
  assert.ok(ctx.calls.some((c) => c.url.includes(`/cards/card_00000001`) && c.opts.method === 'POST'));
  ctx.recv({ type: 'ask-card', block: { kind: 'card', id: 'card_00000001', state: 'dismissed', card: CARD }, threadId: TID, messageId: MID, seq: 3 });
  await settle(ctx.window);
  assert.ok(ctx.window.document.querySelector('.ask-card-stub'));
});

test('ui-ask-card: Open in New Pipeline prefills the project form with the source forced to prompt', async () => {
  const ctx = await boot();
  await openCard(ctx, CARD);
  ctx.window.document.querySelector('.ask-card-brief').value = 'edited before handoff';
  ctx.window.document.querySelector('[data-ask-card-open-np]').click();
  await settle(ctx.window, 8); // the async applier awaits workflows/guardrails/branches
  const doc = ctx.window.document;
  assert.equal(ctx.window.location.hash, '#new');
  assert.equal(doc.querySelector('.ask-sheet').hidden, true, 'the sheet closed');
  assert.equal(doc.querySelector('#prompt').value, 'edited before handoff');
  assert.equal(doc.querySelector('#title').value, 'Fix login');
  assert.equal(doc.querySelector('#workflowSelect').value, 'wf_review');
  assert.equal(doc.querySelector('#guardrailsSelect').value, 'normal');
  assert.equal(doc.querySelector('#featureBranch').value, 'worca/fix-login');
  assert.equal(doc.querySelector('#sourceBranch').value, 'dev');
  assert.equal(doc.querySelector('#advanced-config').open, true);
  assert.equal(doc.querySelector('#prompt-pane').classList.contains('hidden'), false, 'prompt source visible');
});

test('ui-ask-card: Open in New Pipeline for a workspace card selects the workspace and the member overrides', async () => {
  const ctx = await boot();
  await openCard(ctx, WS_CARD);
  ctx.window.document.querySelector('[data-ask-card-open-np]').click();
  await settle(ctx.window, 10);
  const doc = ctx.window.document;
  assert.equal(ctx.window.location.hash, '#new');
  assert.equal(doc.querySelector('#workspaceSelect').value, 'wks-team-00000001');
  const member = [...doc.querySelectorAll('select.ws-src-select')].find((s) => s.dataset.projectKey === 'lib-00000002');
  assert.ok(member, 'per-member selects rebuilt');
  assert.equal(member.value, 'release');
});
```

Both former adaptation points are resolved above: the `boot({url, runResponse})` plumbing is written out in full, and the prompt-pane element is the real `#prompt-pane` (`index.html:229`; `el.promptPane` `app.js:121`). Nothing in this file is left to the implementer's judgement — every assertion stays exactly as written.

- [ ] **Step 11.2: Run to verify failure**

Run: `node --disable-warning=ExperimentalWarning --test --test-force-exit test/ui-ask-card.test.mjs`
Expected: the first three tests PASS already (Task 8 wired the card; the seams of Task 10 deliver the frames); the two prefill tests FAIL — `newPipelinePrefill` is never consumed.

- [ ] **Step 11.3: Implement.** In `ui/public/app.js`:

**(a)** Make `onProjectChanged` (`:5388-5401`) return its `loadConfig` promise, so a caller can await the tail that repaints the pickers. Both arms change; existing callers ignore the return value, so this is purely additive:

```js
    const cfgLoad = loadConfig(path); // its tail repaints the workflow/guardrail
    refreshBranches(path);            // pickers (app.js:1833-1835) — callers that
    return cfgLoad;                   // prefill MUST await it or be clobbered
```

(mirror the same three lines in the empty-path arm, with `loadConfig('')`.)

**(b)** Insert `applyAskPrefill` directly after `openNewPipeline` (Task 10's block):

```js
// Apply a card handoff to the New Pipeline form (§10.2 seam 7). One-shot; runs
// at the end of showView('new'). Async — the pickers and branch lists load
// through their normal async loaders; every await keeps the user-visible form
// consistent if they start typing meanwhile.
async function applyAskPrefill() {
  const p = newPipelinePrefill;
  if (!p) return;
  newPipelinePrefill = null;
  setRunTarget(p.target === 'workspace' ? 'workspace' : 'project');
  // force the prompt source — the three-step reset of the segment handler
  state.activePluginSource = null;
  el.sourceRadios.forEach((r) => { r.checked = r.value === 'prompt'; });
  document.querySelectorAll('#source-seg button[data-src]').forEach((b) => {
    b.classList.toggle('on', b.dataset.src === 'prompt');
    b.setAttribute('aria-pressed', String(b.dataset.src === 'prompt')); // the real handler at :4671-4683 maintains it
  });
  syncSourceToggle();
  if (p.target === 'workspace') {
    await ensureWorkspaceOptions();
    if (p.workspaceId && el.workspaceSelect) {
      el.workspaceSelect.value = p.workspaceId;
      // bare `Event` is Node's under the test globals and jsdom rejects it
      el.workspaceSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    }
  } else if (p.projectDir) {
    const idx = state.projects.findIndex((x) => x && x.path === p.projectDir);
    if (idx >= 0) el.projectSelect.selectedIndex = idx + 1; // +1 past the placeholder
    // AWAITED: onProjectChanged → loadConfig → loadWorkflowsInto/loadGuardrailsInto — un-awaited, that tail lands after our own awaits and resets both pickers.
    await onProjectChanged();
  }
  el.prompt.value = p.prompt || '';
  refreshMentionHighlights();
  const titleInput = document.getElementById('title');
  if (titleInput) titleInput.value = p.title || '';
  await loadWorkflowsInto(p.workflowId);
  await loadGuardrailsInto(p.guardrailsId);
  if (el.advancedConfig) el.advancedConfig.open = true;
  if (el.featureBranch) el.featureBranch.value = p.featureBranch || '';
  if (p.target === 'workspace') {
    // the per-member selects are rebuilt asynchronously on the change above
    await Promise.resolve();
    const byKey = p.sourceBranchByKey || {};
    for (const sel of el.wsSourceBranches ? el.wsSourceBranches.querySelectorAll('select.ws-src-select') : []) {
      const want = byKey[sel.dataset.projectKey];
      if (!want) continue;
      if (![...sel.options].some((o) => o.value === want)) sel.appendChild(option(want, want));
      sel.value = want;
    }
  } else {
    await refreshBranches(selectedProjectPath());
    if (p.sourceBranch && el.sourceBranch) {
      if (![...el.sourceBranch.options].some((o) => o.value === p.sourceBranch)) {
        el.sourceBranch.appendChild(option(p.sourceBranch, p.sourceBranch));
      }
      el.sourceBranch.value = p.sourceBranch;
    }
  }
}
```

(`option(value, label)` is the existing app.js helper used by `loadWorkflowsInto` at `:3079`; if the real `el` key for any control differs, use the anchor table's ids — `#prompt`, `#title`, `#workflowSelect`, `#guardrailsSelect`, `#featureBranch`, `#sourceBranch`, `#ws-source-branches` — never invent new markup.)

**(c)** Hook the arm. Replace (`:14183`):

```js
  if (name === 'new') { loadTaskSources(); applyBudgetToNewView(); refreshMentionHighlights(); }
```

with:

```js
  if (name === 'new') { loadTaskSources(); applyBudgetToNewView(); refreshMentionHighlights(); applyAskPrefill(); }
```

- [ ] **Step 11.4: Run to verify pass**

Run: `node --disable-warning=ExperimentalWarning --test test/ui-ask-card.test.mjs test/ui-ask-integration.test.mjs`
Expected: **15 pass / 0 fail** (5 new).

- [ ] **Step 11.5: Full suite**

Run: `npm test`
Expected: **3351 pass / 0 fail** (fences incl. `ui-newpipeline-*` stay green — `applyAskPrefill` is a no-op when `newPipelinePrefill` is null).

- [ ] **Step 11.6: Commit**

```bash
git add ui/public/app.js test/ui-ask-card.test.mjs
git commit -m "worca ask p3: card to New Pipeline prefill"
```

---
### Task 12: Settings — the Ask Worca card

**Files:**
- Modify: `ui/public/index.html` (one new `section.card.settings-card` between the Budget card's `</section>` at `:1205` and the Chat-notifications comment at `:1207`)
- Modify: `ui/public/app.js` (paint/save/reset wiring, budget-card pattern `:7443-7513`)
- Modify: `test/ui-settings-tooltips.test.mjs` (the info-tip census: 6 → 9)
- Test: `test/ui-settings-ask.test.mjs`

**Interfaces:** `GET/POST /api/settings` already carry `askMaxTurns` / `askMaxBudgetUsd` (P1/P2). Semantics (§17 Q&A 4 — the null/'' distinction is the WHOLE point of the checkbox): `askMaxTurns` int 1–500, `''` clears to the default 40; `askMaxBudgetUsd` 0.1–100, **stored `null` = no cap** (flag omitted at spawn), `''` clears to the default 2. The ask keys post ALONE (their own Save — `saveSettings` posts only `{root, projectsRoot}` and must stay untouched; the API-side fence `settings-projects-root:309-313` already lists the ask keys). Copy the budget card's markup idiom EXACTLY (`index.html:1157-1205`): `div.field > div.label-row > label + button.info-tip > span.tip-content.hidden`, `.btn-ghost.btn-mini` + `.btn-primary.btn-mini`, `<small class="hint" id="askLimitsMsg">` (hints stay textually empty — the tooltips fence at `:56-73` checks it).

- [ ] **Step 12.1: Write the failing tests** — `test/ui-settings-ask.test.mjs`, full file. Boot: copy `test/ui-settings-budget.test.mjs:33-71` VERBATIM (header comment naming it), with the GET `/api/settings` arm returning `{ root: '/w', projectsRoot: '/p', projectsRootDefault: '/p', default: {}, chat: {}, pipelineCostLimitUsd: null, totalCostLimitUsd: null, costLimitResetPeriod: 'monthly', askMaxTurns: 40, askMaxBudgetUsd: 2 }` and every POST recorded into `posts` then answered with the same body merged with the posted keys resolved (`askMaxTurns: 55` etc.; `''` resolves to the default, `null` stays null). Tests:

```js
test('ui-settings-ask: GET paints the card (defaults, no-cap unchecked)', async () => {
  const { $, openSettings } = await boot();
  await openSettings();
  assert.equal($('#askMaxTurns').value, '40');
  assert.equal($('#askMaxBudgetUsd').value, '2');
  assert.equal($('#askNoCap').checked, false);
  assert.equal($('#askMaxBudgetUsd').disabled, false);
});

test('ui-settings-ask: Save posts exactly the two ask keys', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#askMaxTurns').value = '55';
  $('#askMaxBudgetUsd').value = '3.5';
  $('#askLimitsSave').click();
  await tick();
  assert.equal(posts.length, 1, 'exactly one POST');
  assert.deepEqual(posts[0], { askMaxTurns: 55, askMaxBudgetUsd: 3.5 });
  assert.match($('#askLimitsMsg').textContent, /Saved/);
});

test('ui-settings-ask: client validation short-circuits the POST', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#askMaxTurns').value = '0';
  $('#askLimitsSave').click();
  await tick();
  assert.equal(posts.length, 0, 'out-of-range turns never reaches the server');
  assert.ok($('#askLimitsMsg').classList.contains('err'));
  $('#askMaxTurns').value = '40';
  $('#askMaxBudgetUsd').value = '0.05';
  $('#askLimitsSave').click();
  await tick();
  assert.equal(posts.length, 0, 'sub-floor budget rejected too');
});

test('ui-settings-ask: a server 400 lands verbatim', async () => {
  const { $, tick, openSettings } = await boot({
    postResponse: { ok: false, status: 400, json: async () => ({ error: 'askMaxTurns must be an integer between 1 and 500' }) },
  });
  await openSettings();
  $('#askMaxTurns').value = '77';
  $('#askLimitsSave').click();
  await tick();
  assert.equal($('#askLimitsMsg').textContent, 'askMaxTurns must be an integer between 1 and 500');
});

test('ui-settings-ask: the No-cap checkbox disables the field and posts null', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#askNoCap').checked = true;
  $('#askNoCap').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal($('#askMaxBudgetUsd').disabled, true);
  $('#askLimitsSave').click();
  await tick();
  assert.deepEqual(posts[0], { askMaxTurns: 40, askMaxBudgetUsd: null });
});

test('ui-settings-ask: Use defaults posts empty strings (the clear-to-default wire value)', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#askLimitsReset').click();
  await tick();
  assert.deepEqual(posts[0], { askMaxTurns: '', askMaxBudgetUsd: '' });
  assert.equal($('#askMaxTurns').value, '40', 'painted back from the response defaults');
});
```

(the `boot({postResponse})` override and the `window` reference follow the budget suite's own patterns — adapt only those plumbing details, never the assertions).

Also update `test/ui-settings-tooltips.test.mjs:20-31`: the census becomes

```js
    assert.equal(tips.length, 9, 'nine ⓘ icons (2 folder fields, budget heading, 3 budget fields, ask heading, 2 ask fields)');
```

and rename the test title in the same file: `'settings: six info-tip icons, each with non-empty tip content'` → `'settings: nine info-tip icons, each with non-empty tip content'`.

(only the count, its message and the title change; every per-tip assertion in the loop already covers the new three).

- [ ] **Step 12.2: Run to verify failure**

Run: `node --disable-warning=ExperimentalWarning --test --test-force-exit test/ui-settings-ask.test.mjs test/ui-settings-tooltips.test.mjs`
Expected: ui-settings-ask FAILS (no `#askMaxTurns`); ui-settings-tooltips FAILS (still 6 tips vs the updated 9).

- [ ] **Step 12.3: Implement.**

**(a) `ui/public/index.html`** — insert after the Budget card's last two lines, `<small class="hint" id="budgetMsg"></small>` and its closing `</section>` (`:1204-1205`), and before the Chat-notifications comment (`:1207`):

```html
          <!-- Ask Worca (ask-worca-design §6.9): per-turn guards for the
               assistant chat. Read fresh on every turn (D12); a stored null
               budget means "no cap". Posted ALONE — never with root/budget keys. -->
          <section class="card settings-card">
            <div class="card-head">
              <div class="label-row">
                <h2>Ask Worca</h2>
                <button type="button" class="info-tip" aria-label="About Ask Worca limits">i<span class="tip-content hidden">
                  Per-turn guards for the Ask Worca assistant chat. A chat turn stops when it reaches the turn limit or the per-turn cost cap; both are read fresh on every turn.
                </span></button>
              </div>
            </div>
            <div class="field">
              <div class="label-row">
                <label for="askMaxTurns">Turn limit</label>
                <button type="button" class="info-tip" aria-label="About Turn limit">i<span class="tip-content hidden">
                  Maximum assistant/tool turns one chat message may use (1&ndash;500). Leave empty to restore the default of 40.
                </span></button>
              </div>
              <input id="askMaxTurns" class="input" type="number" min="1" max="500" step="1" inputmode="numeric" placeholder="40" autocomplete="off" />
            </div>
            <div class="field">
              <div class="label-row">
                <label for="askMaxBudgetUsd">Per-turn cost cap (USD)</label>
                <button type="button" class="info-tip" aria-label="About Per-turn cost cap">i<span class="tip-content hidden">
                  Stop a chat turn when its estimated cost reaches this amount (0.1&ndash;100). Leave empty to restore the default of $2, or tick No cap to disable the guard.
                </span></button>
              </div>
              <input id="askMaxBudgetUsd" class="input" type="number" min="0.1" max="100" step="0.1" inputmode="decimal" placeholder="2" autocomplete="off" />
              <label class="check-row" for="askNoCap"><input id="askNoCap" type="checkbox" /> No cap</label>
            </div>
            <div class="add-project-actions" style="margin-top:14px">
              <button type="button" id="askLimitsReset" class="btn btn-ghost btn-mini">Use defaults</button>
              <button type="button" id="askLimitsSave" class="btn btn-primary btn-mini">Save</button>
            </div>
            <small class="hint" id="askLimitsMsg"></small>
          </section>
```

(if `label.check-row` has no styling in the app, leave the class — it renders acceptably unstyled and Task 9 is closed; do NOT add CSS to style.css here, the ui-theme fences were settled in Task 9).

**(b) `ui/public/app.js`** — insert the mirrored ask block immediately after the `if (el.budgetReset) { … }` listener block (it ends at `app.js:7529`):

```js
// ---- Ask Worca limits card (budget-card pattern above) ---------------------
function setAskLimitsMsg(text, kind) {
  const n = document.getElementById('askLimitsMsg');
  if (n) { n.textContent = text || ''; n.className = `hint${kind ? ` ${kind}` : ''}`; }
}
function paintAskSettings(data) {
  const turns = document.getElementById('askMaxTurns');
  const budget = document.getElementById('askMaxBudgetUsd');
  const noCap = document.getElementById('askNoCap');
  if (!turns || !budget || !noCap) return;
  turns.value = data.askMaxTurns == null ? '' : String(data.askMaxTurns);
  noCap.checked = data.askMaxBudgetUsd === null;
  budget.disabled = noCap.checked;
  budget.value = data.askMaxBudgetUsd == null ? '' : String(data.askMaxBudgetUsd);
}
async function postAskLimits(body) {
  setAskLimitsMsg('');
  let res = null;
  try {
    res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { setAskLimitsMsg('network error', 'err'); return; }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) { setAskLimitsMsg((data && data.error) || `save failed (${res.status})`, 'err'); return; }
  paintAskSettings(data || {});
  setAskLimitsMsg('Saved.');
}
function saveAskLimits() {
  const turnsRaw = document.getElementById('askMaxTurns').value.trim();
  const noCap = document.getElementById('askNoCap').checked;
  const budgetRaw = document.getElementById('askMaxBudgetUsd').value.trim();
  let askMaxTurns = '';
  if (turnsRaw !== '') {
    const n = Number(turnsRaw);
    if (!Number.isInteger(n) || n < 1 || n > 500) { setAskLimitsMsg('the turn limit must be an integer between 1 and 500', 'err'); return; }
    askMaxTurns = n;
  }
  let askMaxBudgetUsd = '';
  if (noCap) askMaxBudgetUsd = null;
  else if (budgetRaw !== '') {
    const b = Number(budgetRaw);
    if (!Number.isFinite(b) || b < 0.1 || b > 100) { setAskLimitsMsg('the per-turn cap must be between 0.1 and 100', 'err'); return; }
    askMaxBudgetUsd = b;
  }
  postAskLimits({ askMaxTurns, askMaxBudgetUsd });
}
document.getElementById('askLimitsSave')?.addEventListener('click', saveAskLimits);
document.getElementById('askLimitsReset')?.addEventListener('click', () => postAskLimits({ askMaxTurns: '', askMaxBudgetUsd: '' }));
document.getElementById('askNoCap')?.addEventListener('change', () => {
  const budget = document.getElementById('askMaxBudgetUsd');
  if (budget) budget.disabled = document.getElementById('askNoCap').checked;
});
```

and inside `loadSettings()` insert `paintAskSettings(data);` immediately after the `paintBudgetSettings(data);` call (`app.js:7250-7251`, before `paintBudgetReadout();`):

```js
  paintAskSettings(data);
```

- [ ] **Step 12.4: Run to verify pass**

Run: `node --disable-warning=ExperimentalWarning --test test/ui-settings-ask.test.mjs test/ui-settings-tooltips.test.mjs test/ui-settings.test.mjs test/ui-settings-budget.test.mjs test/ui-shell.test.mjs`
Expected: **6 new pass**, tooltips census green at 9, the neighbouring settings suites and `ui-shell` untouched (the new section adds ids but no `data-view`).

- [ ] **Step 12.5: Full suite**

Run: `npm test`
Expected: **3357 pass / 0 fail**.

- [ ] **Step 12.6: Commit**

```bash
git add ui/public/index.html ui/public/app.js test/ui-settings-ask.test.mjs test/ui-settings-tooltips.test.mjs
git commit -m "worca ask p3: settings card for the per-turn guards"
```

---
### Task 13: Final verification (no new code)

- [ ] **Step 13.1** Full suite: `npm test` → expected **3357 pass / 0 fail / 0 skip** (baseline 3230 + 127 new across Tasks 1–12). Green runs exit on their own — if the process hangs, a panel timer leaked (`.unref()`/clearInterval audit, Global Constraints).
- [ ] **Step 13.2** Fence greps, all must hold:
  - `grep -c 'data-view' ui/public/index.html` → **14**
  - `grep -n '#[0-9a-fA-F]\{6\}' ui/public/style.css | awk -F: '$1 > 2500'` → only lines INSIDE the final reduced-motion block region or none in the ask section (the ui-ask-style test is the real fence; this is the eyeball)
  - `grep -c '@keyframes wr-rise' ui/public/style.css` → **1**
  - `grep -n 'ask-' ui/public/app.js | grep -vE "askPanel|askQuestions|asksQuestions|run-ask-banner|sic-ask|newPipelinePrefill|applyAskPrefill|askMaxTurns|askMaxBudgetUsd|askLimits|askNoCap|ask-panel|startsWith\('ask-'\)|Task-source|hd-ov-task"` → nothing unexpected
  - the reserved-word fence:

```
grep -nE '(chat|channel)' ui/public/ask-panel.mjs ui/public/ask-model.mjs ui/public/ask-markdown.mjs \
  | grep -vE "Recent chats|New chat|No saved chats|Agents this chat|Delete this chat" → zero hits
  (the reserved-word rule governs identifiers/CSS/data-attributes; those five strings are mandated UI copy)
```

  - `grep -c "function subscribe" ui/public/ask-panel.mjs` → 1 (repeat for every stub-replaced name)
- [ ] **Step 13.3** `git log --oneline` shows the 12 task commits on top of `dbb47f68`; `git status --porcelain` clean.
- [ ] **Step 13.4** Record the final counts and any skipped selection-guard test in the execution notes.

Out of scope, deliberately: `docs/storage.md` / `docs/guardrails.md` / `README.md` (§15 assigns docs to the P4 gate), the §12 manual gate (P4), `package.json` (P2 owns the pins), any server change.

---

## Clarifications (Q&A)

Recorded decisions — downstream agents treat these as answered, never as open questions.

1. **Q: What tree does this plan build on?** — A: Branch `worca-cc/ask-worca-p2-server-implementation-plan-70aea22b` @ `dbb47f68` (P1+P2 as-built, stacked; user decision 2026-08-23). Merge to `dev` stays behind the P4 gate. Every anchor in this plan was read at that commit; P1/P2 touched nothing under `ui/public/`.
2. **Q: Is the mockup an input?** — A: Yes, read-only visual reference (user decision 2026-08-23); its measurements are distilled into the Visual reference section. Spec §10/§13 win over the mockup on every conflict (13 conflicts catalogued during recon: sub-agent row content, attachment chip family, "Start" label, live thread dot, 1-s elapsed cadence, etc. — the spec's reading is used throughout).
3. **Q: Branch/worktree setup inside the plan?** — A: None (same ruling as P2): the plan is execution-vehicle-agnostic; Task 0 only verifies HEAD, runs `npm ci`, and reproduces the 3230/0 baseline. The orchestrator's own branch is the contract when it executes this plan.
4. **Q: package.json / docs deltas?** — A: Zero. §16's letter lists "dependency pins" under P3; the adjudicated single-lockfile-owner override moved them to P2, where they shipped (`marked@18.0.10`, `dompurify@3.4.14`). Docs (`storage.md`, `guardrails.md`, README) belong to P4 per §15.
5. **Q: Which contract governs where spec §10 and the as-built P2 disagree?** — A: The as-built code at `dbb47f68` (verified: the Frozen P2→P3 contract in the pipeline-store v3.1 plan is accurate; its 7 precision gaps are folded into this plan as P3-F3/F5/F6/F8 and the /api/run 400-not-404 row).
6. **Q: The §12 test-name letter ("ask-panel" as one suite)?** — A: Satisfied by the `ask-panel*` family plus `ui-ask-*` (house convention: many focused files; per-task files avoid cross-task merge hazards). The threads-popover LIST landed in Task 3 (it exercises the popover primitive over injected fetch) and the thread ACTIONS in Task 7 — a deliberate re-slice of the adjudicated DAG, recorded here.
7. **Q: Which behaviours are adjudicated LAW for this plan?** — A: The Part-3 verdicts inlined in the architecture section: one thread model swapped on switch (V1); streaming re-render ladder ≤32 KB/every-flush → 250 ms throttle → 200 KB plain, with the selection guard (V2); schedule-on-dirty rAF (V3); CSS-anchored in-sheet popovers with role=menu semantics (V4); the `ownsKey` predicate (V5); scroll-listener pinning (V6); card edits in the DOM with element reuse across re-renders (V7); `worca-cc.ask.model`/`worca-cc.ask.thread` storage semantics with catalog-load validation (V8); client-mirrored attachment caps with server-echo authority (V9); the V10 prefill shape; the Task-1 fixture helper as the single fixture entry point (V11); `__worcaTestHooks.askMarkdown` as the integration markdown seam (V12); the Settings card with the No-cap checkbox for the null/'' distinction (V13); no parse cache + 3-attempt latch (V14).
8. **Q: Are the per-task suite counts binding?** — A: Yes as of v2 — every count was MEASURED by the two executed dry-runs at `dbb47f68` (final 3357 = D2's measured 3354 plus the three survivor-killer tests v2 adds). A count mismatch during execution is a STOP-and-investigate signal, not a number to adjust silently. The 3230/0 baseline is likewise binding.
9. **Q: Updating existing tests — allowed?** — A: Exactly one: `test/ui-settings-tooltips.test.mjs`'s info-tip census 6 → 9 (Task 12) — the test is a deliberate census fence and the Ask card legitimately adds three icons. No other existing test changes; every other fence must stay green as-is.
10. **Q: Known deliberate divergences from sibling app code?** — A: The ask composer reads files with `File.arrayBuffer()` (spec §10.6) while New Pipeline uses `FileReader.readAsDataURL` — both verified working; the ask CARD uses per-member text `<input>`s where New Pipeline uses branch `<select>`s (the card cannot lazily enumerate branches for every member; spec §10.5's "mirrors the New Pipeline workspace controls" is read as mirroring the DATA it feeds `sourceBranchByKey`, not the widget); notices/error lines/markdown typography/card form have NO mockup reference and are authored from the app's token system (recon-verified as undesigned).
11. **Q: What may the implementer adapt without a deviation record?** — A: Only mechanical Edit-anchor drift (line numbers moved by earlier tasks in the same file). The two spots v1 left open in Task 11 — the `boot({url, runResponse})` plumbing and the prompt-pane selector — are now resolved in-plan by the dry-runs, so no permitted adaptations remain beyond that drift. Everything else — names, payloads, assertions, error strings — is exact; a mismatch means STOP and record a deviation, not silently adapt.
12. **Q: What is committed?** — A: Code and tests per task on the working branch; nothing under `docs/superpowers/` ever; scratch experiments stay outside the repo.
