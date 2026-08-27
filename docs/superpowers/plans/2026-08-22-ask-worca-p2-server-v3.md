# Ask Worca — P2 Server Implementation Plan (v3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server half of Ask Worca: `src/core/ask/turn.mjs` (one sandboxed `claude -p` turn), `src/core/ask/follow.mjs` (run follower), the `askJobs` registry, every `/api/ask/*` REST route, the WS thread subscription + `hello.ask`, the boot sweeps, the `/api/run` ask-link seam, and the marked/dompurify vendor routes — so a P3 frontend can drive a full chat over mock mode.

**Architecture:** P1 (commit `1b02d87b`) shipped every leaf module (store, events reducer, spawn recipe, proposal, tools, mcp-stdio, limits, models, prompt, redact, runner options + mock `ask` role). P2 composes them: a route assembles prompts and persists rows, an `AskTurn` (EventEmitter, `run()` never throws) drives `runClaude` through the P1 reducer and finishes the assistant message, the server stamps `{threadId, messageId, seq}` onto the reducer's bare frames and fans them out over the existing flat-socket broadcast, and a follower mirrors orchestrator events into thread notices and `ask_run_links`.

**Tech Stack:** Node ≥22.13 ESM, express 4, `ws`, `node:sqlite` via `src/core/db.mjs`, `node:test` + `node:assert/strict`. Two NEW runtime dependencies (exact-pinned): `marked@18.0.10`, `dompurify@3.4.14`.

**Spec:** `docs/superpowers/specs/2026-08-22-ask-worca-design.md` — **rev 2.1**. Read §17 (appendix) FIRST: its F1–F12 probe facts, the frozen P1→P2/P3 contract, and rules R-A…R-G are binding and supersede §6/§14 where they conflict. This plan implements spec §16 row **P2 — server**.

**Revision:** v3 (2026-08-23). v1 (2026-08-22) was written after a five-agent recon/adjudication wave (A1 `ui/server.mjs` territory, A2 as-built-vs-contract verification, A3 lifecycle precedents, A4 test conventions + baseline, A5 Fable architecture adjudication; vendor facts verified empirically at the exact pins), then EXECUTED end to end by two independent dry-run agents (D1: Tasks 1–4 + 23-mutation audit; D2: Tasks 1–8 + 16-mutation audit) → v2 folded in their two server fixes (artifacts import, pipeline-row mapping), the test-fixture repairs and the mutation-audit hardening. v2 was then RE-EXECUTED end to end by a third zero-context agent — **every implementation hunk applied verbatim, every predicted count landed exactly, every line hint exact** — and COLD-REVIEWED by a second Fable pass, which found what execution cannot see: v3 folds in its 1 CRITICAL (the workspace `members:` header line read a phantom `ws.projects` field), 2 MAJORs (a create-time thread title was clobbered by the background haiku title; the 409/429 check-then-register window — not reachable today because every await in it resolves in microtasks, so the reservation is defence-in-depth plus the null-`messageId` guards it requires, pinned by a reserved-slot test) with their three pinning tests, its nine minors, and the re-execution's harness fixes (the red-step WS teardown wedge — `closeAllConnections()` does not destroy upgraded sockets — the `ask-api-cards` teardown reap, and wording/anchor polish).

## Execution context (read before Task 1)

- **This plan contains NO branch/worktree setup.** The execution vehicle (orchestrator pipeline, subagent-driven session, by hand) is chosen at execution start and provides a checkout; this plan only assumes it.
- **Assumed tree:** the P1 tip — commit `1b02d87b` on `worca-cc/ask-worca-p1-core-runner-implementation-9e4fbeab` (= `dev`@`79dc9256` + P1). Every `file:line` anchor below was verified at that commit; the anchor is the quoted text, the number is a hint (your own earlier tasks shift later numbers).
- **Dependencies installed:** run `npm ci` once before Task 1 if `node_modules/` is absent or stale (a fresh worktree without it fails `npm test` with bogus express errors).
- **Baseline:** `npm test` → **3166 pass / 0 fail** (~90 s, 387 test files) at the assumed tree. Every task ends with its own test file green AND `npm test` green with zero failures.
- **Run one file:** `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test test/<file>.test.mjs`. The full suite (`npm test`) wipes and uses the RELATIVE home `.worca-cc-test`.
- **Everything in this plan is offline.** No paid CLI calls anywhere (the real-CLI end-to-end is the P4 manual gate). `WORCA_MOCK=1` drives every API test.
- Known pre-existing flakes: a rare skills-gate/detached timing flake and an intermittent temp-dir `ENOTEMPTY` in `test/api-sources.test.mjs` — re-run the single file before treating either as real.
- **Never `git add` anything under `docs/superpowers/`** (plans and specs stay untracked). Commit per task with the trailer the environment mandates.

## Global Constraints

- **Namespace `ask` everywhere** — routes `/api/ask/*`, frames `ask-*`, registry `askJobs`. The words `chat` (messenger subsystem `src/core/chat/`) and `channel` (pipeline bus) are reserved; never reuse them (spec §5).
- **Decisions D1–D15 are locked** (spec §4). Rules **R-A…R-G** (spec §17) bind `turn.mjs` and the routes; each is cited inline where enforced.
- **No frontend changes.** Zero diffs under `ui/public/` and zero changes to `ui/public/index.html` — `test/ui-shell.test.mjs` pins an exact `data-view` count of 14 and P2 must leave it untouched. All P2 UI-facing work is server-side.
- **Regression fences that must stay green untouched:** `test/spawn-args.test.mjs` (three byte-exact baseline argv `deepEqual`s at `:35-38`, `:170-173`, `:189-192` plus `:211-219` and the negative-includes at `:65-71`), `test/claude-runner-session.test.mjs`, `test/settings-projects-root.test.mjs` (the settings work is **P1-complete** — P2 adds no settings key, so `:309-322`'s key list stays), `test/agentgen-api.test.mjs`, `test/api-hljs-assets.test.mjs`, `test/ui-shell.test.mjs`, `test/ui-theme.test.mjs`, `test/ui-boot.test.mjs`, and all 19 `test/ask-*.test.mjs` / `test/claude-runner-ask-mock.test.mjs` files P1 added.
- **Error envelope:** every ask 4xx/5xx responds `{error: string}` (the house `badRequest` helper / `res.status(n).json({error})`). **Deliberate divergence from house style:** existing routes answer 404 for a malformed id param; spec §8.1 mandates **400 on id shape, 404 on unknown** for `/api/ask/*` — implement the spec, and do not "fix" it to house style.
- **R-E:** never wrap `src/core/ask/store.mjs` writers in a route-level `tx()` — `tx()` is not re-entrant (`src/core/db.mjs:898` throws) and several store writers already `tx()` internally (`updateCardBlock`, `addThreadTotals`, `appendMessage`, `sweepStreamingMessages`).
- **No import-time DB or home access in `ui/server.mjs` additions** — tests import the module before their temp `WORCA_HOME` hook runs (the `chatCtx` lazy precedent, `ui/server.mjs:1022-1025`). `askJobs` is a bare `new Map()`; every store call happens inside a handler or `bootMaintenance()`.
- **Persist before broadcast** for terminal state: `finishMessage`/`addThreadTotals` run before the `ask-done`/`ask-error` frame is emitted, so a client's REST re-fetch triggered by the frame is never behind it.
- **Redaction:** `summary.text` from `reducer.finish()` is already redacted; **`snapshot().text` is NOT** (as-built fact B-2). Never persist or broadcast `snapshot().text`.
- **`finishMessage` overwrites all seven columns** (B-5): every call passes the full patch `{text, blocks, status, reason, usage, costUsd, durationMs}` — a partial call silently wipes `text`/`blocks`.
- **New runtime deps:** exactly `marked@18.0.10` + `dompurify@3.4.14`, exact-pinned (no caret), added in Task 1 and nowhere else. P3 never touches `package.json` (adjudicated: single lockfile owner).
- **Docs:** P1 already wrote everything P2-adjacent (`docs/storage.md:22,25` — `ask/` + `tmp/ask/`; `docs/guardrails.md:118-146` — the sandbox paragraph incl. the `//`-anchoring rule). P2 ships **zero doc edits**; Task 8 verifies they still describe shipped behavior. The README bullet is P4's.

## Binding inputs from P1 (what this plan builds against)

**Probe facts (spec §17, F1–F12)** used here: F1 (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` rides `spawn.mjs`'s `modelEnv` merge — nothing for P2 to add), F2 (`Agent` tool name — reducer handles it), **F5** (`error_max_turns`/`error_max_budget_usd` **exit 1** → `runClaude` REJECTS with `claude exited with code 1: no stderr`; classify from `reducer.snapshot().resultSubtype`, never the message), F7 (`--home/--thread` argv twins make env forwarding non-load-bearing), **F9** (bogus/expired `--resume` → exit 1, `errors:['No conversation found with session ID: …']`, **no `assistant` frame, no init** — the retry predicate), F10 (`--tools ""`, title-call hardening verified).

**As-built facts (recon A2/A3, verified at `1b02d87b`)** — numbered **B-1…B-8**, cited inline:

| # | fact | consequence |
|---|---|---|
| B-1 | `generateTitle` hard-codes `permissionMode:'acceptEdits'` (`src/core/title.mjs:48`) and has no marker seam. **Empirically verified:** under `WORCA_MOCK=1` a first message whose text is `MOCK_ASK: /tmp/x.json` makes the TITLE call write that file (the `acceptEdits` mock path falls through to the legacy prompt-marker arm, `claude-runner.mjs:886`). | Task 2 adds a `permissionMode` pass-through to `generateTitle`; the ask title call passes `'dontAsk'`, which routes `runMock` to the safe `mockAsk` arm (`claude-runner.mjs:867`) and is strictly tighter in real mode. R-F's marker rule stays mandatory for every `buildAskSpawnOptions` spawn. |
| B-2 | `snapshot().text` is unredacted; only `finish().text` is (`events.mjs:391` vs `:414`). `snapshot()` also carries one extra field `runningAgents`. | Persist/broadcast only `finish()` output text. |
| B-3 | `runMock` receives only `{cwd, systemPrompt, prompt, onEvent, signal, resumeSessionId, workspaceWriteTargets, permissionMode}` — model/effort/maxTurns/mcpConfigPath never reach the mock. The mock never fails a resume (no "No conversation found" scenario). | Mock-mode API tests cannot assert spawn options; the §6.2.7 retry is unit-tested in Task 4 with an injected `runClaudeImpl`. |
| B-4 | `runClaude` pre-checks the signal and throws a synchronous `AbortError` BEFORE any init (`claude-runner.mjs:273-277`); on close, abort wins over exit code (`:559-563`). The mock's `abortIfNeeded` throws the same shape. | R-C's abort branch MUST be classified first — a pre-aborted retry-eligible turn must not enter the resume fallback. |
| B-5 | `finishMessage` updates all seven columns unconditionally (`store.mjs:192-201`). | Always pass the full patch. |
| B-6 | `linkRun` is a plain INSERT — a duplicate `(thread_id, run_id)` throws `UNIQUE constraint failed`, an unknown thread throws `FOREIGN KEY constraint failed` (`store.mjs:304-316`). `updateRunLink` patches only `{pipelineId, status, phase}`; there is no `getRunLink` export. | Link exactly once per run, inside the seam's try/catch; card_id travels on the INSERT only. |
| B-7 | `buildAskSpawnOptions` reads `thread.sessionId \|\| undefined` (`spawn.mjs:70`) and has no "force no resume" flag; `turn.mock` only appends system-prompt markers (`:55`); `modelEnv` merges `ASK_SPAWN_ENV` last (`:62`). | The retry passes `{...thread, sessionId: null}`. |
| B-8 | The orchestrator emits `error {message}` and THEN `done {status:'error'}` — two events, one failure (`orchestrator.mjs:755,761`, `chat/notifier.mjs:88-94`); the first `state` event fires with `id: null` BEFORE `createPipeline` (`orchestrator.mjs:504` vs `:562`); a post-200 preflight failure surfaces ONLY through the `error` event (the route's `Promise` catch never fires — `run()` swallows, `:753-765`). | `follow.mjs` posts once per failure (done-skips-on-error interlock), guards the pipeline-id capture on a truthy string, and MUST be attached synchronously before `orch.run()` is scheduled. |

**P1 API surface consumed** (every name verified present and signature-checked at `1b02d87b`; the §17 contract block is accurate — zero renames): `store.mjs` (28 sync exports; `listThreads` rows carry `runLinks` as a COUNT; `updateCardBlock` whitelist `['state','runId','error']`; `setThreadTitle(id, title, {onlyIf})` uses SQL `IS` so `onlyIf: null` matches a NULL title; `deleteThread` shape-checks then removes the row + `rm -rf`s the whole thread dir), `events.mjs` (`createTurnReducer` → `{push, flush, settle, addBlock, updateBlock, snapshot, finish}`; bare frames; `settle()` has no timeout; `addBlock/updateBlock` return `null` after `finish()`), `spawn.mjs` (`buildAskSpawnOptions` → 24-key options object; `buildMcpConfig`; `buildMockMarkers`; `ASK_MCP_SERVER_PATH`), `limits.mjs` (`ASK_LIMITS` incl. `turnTimeoutMs 900000`, `jobGraceMs 30000`, `turnsGlobal 3`, `attachment` caps; `askLimits()`), `models.mjs` (async `askCatalog()` → already `{models, efforts}`; async `validateModelEffort`), `prompt.mjs` (all seven; `buildContextHeader` consumes a SERVER-RESOLVED shape; `buildRestoredPrompt(messages, turnPrompt, {maxChars})`), `proposal.mjs` (bound `validateProposal(input, {cardId})`; card = 15 fixed keys), `catalog.mjs` (bound `buildCatalog`), `claude-runner.mjs` (`runClaude` resolves `{text, exitCode}` ONLY; `mockEnabled`), `title.mjs` (`generateTitle` — extended in Task 2), `projects.mjs` (`listProjects` → `{key,name,path,exists}`), `artifacts.mjs` (`findPipelineRowById`, `lookupPipelineRow`), `workspaces.mjs` (`readWorkspace`).
## Frozen P2 → P3 contract

P3 (frontend) is written against exactly this. Changing any of it means changing the P3 plan.

```js
// ── REST (all §8.1 routes, loopback-guarded; ids ASK_ID_RE = /^[a-z]+_[0-9a-f]{8}$/; 400 bad shape, 404 unknown) ──
// GET    /api/ask/threads?limit=50      → {threads:[{id,title,updatedAt,createdAt,model,effort,sessionId,context,totals,runLinks:<count>,inFlight:<bool>}]}
// POST   /api/ask/threads {title?}      → 201 {thread}
// GET    /api/ask/threads/:id           → {thread, messages, attachments, runLinks, inFlight:{messageId}|null}   (messages carry parsed §7.1 blocks)
// PATCH  /api/ask/threads/:id {title}   → {thread}
// DELETE /api/ask/threads/:id           → {ok:true}
// POST   /api/ask/threads/:id/messages {text, model, effort, context?, attachments?:[{name,dataBase64}]}
//        → 202 {userMessageId, assistantMessageId} · 409 {error:'turn in flight'} · 429 · 400 · 413
// POST   /api/ask/threads/:id/stop      → {ok:true} always (after shape check)
// POST   /api/ask/threads/:id/cards/:cardId {state:'dismissed'} → {block} · 409 unless proposed · 404
// GET    /api/ask/threads/:id/attachments/:attId → text/plain; charset=utf-8 + nosniff + inline · 404
// GET    /api/ask/models                → {models:[{id,label,efforts,custom}], efforts}
// POST   /api/run (+ askThreadId, askCardId — both or neither; 400 before the run is created; 409 when the card is not proposed)

// ── WS ──
// hello gains: ask: [{threadId, messageId}]           (running turns only; messageId = streaming assistant message id)
// subscribe:  {type:'subscribe', threadId}  or  ?threadId=<id> at connect → replays the job ring buffer (stamped frames, in order)
// job frames (buffered, replayed): {threadId, messageId, seq, type:'ask-start'|'ask-label'|'ask-delta'|'ask-block'|'ask-card'|'ask-usage'|'ask-done'|'ask-error', ...payload}
//   seq is per-job monotonic from 1; client drops seq ≤ lastSeq; a GAP means re-fetch GET /api/ask/threads/:id and resubscribe
// out-of-turn frames (NOT buffered, upsert by own key): {threadId, type:'ask-title', title}
//   {threadId, type:'ask-message', message}   — a WHOLE persisted message row (user echo, system notices, card-flip refresh); upsert by message.id
//   {threadId, type:'ask-run-status', runId, pipelineId, cardId, status, phase}
// ask-done payload: {text, blocks, usage, costUsd, durationMs, model, status:'done'|'stopped', reason?, threadTotals}
// ask-error payload: {message, errorClass?}
// ask-start payload: {userMessageId, model, effort, startedAt}

// ── src/core/ask/turn.mjs ──
createAskTurn(opts) → AskTurn                       // class AskTurn extends EventEmitter
// opts: {threadId, assistantMessageId, userMessageId, prompt, systemPrompt, restoredPrompt, model, effort,
//        resumeSessionId, firstTurn, firstText, deterministicTitle, mock, attachmentNames, deps}
// public: reducer (LIVE attempt's reducer — R-B flips go through turn.reducer.updateBlock), status, timedOut, stopping, abort
// run() → Promise<{status:'done'|'stopped'|'error'}>  (never rejects) ; stop() idempotent
// events: 'done' {status, reason} · 'error' {message}   (registry bookkeeping only; frames travel via deps.onFrame)

// ── src/core/ask/follow.mjs ──
attachRunFollower(orch, {threadId, runId, cardId, post, updateStatus, onDetached}) → {detach}
// post({kind:'question'|'failed'|'done', text, href}) ; updateStatus({pipelineId?, status?, phase?, cardFailed?})

// ── ui/server.mjs seams ──
// _testing gains: askJobs, askFollowers, resolveAskContext, flipCard, resolveEsmAsset
// bootMaintenance() summary gains: ask: {interrupted, emptyThreads}
// GET /vendor/marked/marked.esm.js and GET /vendor/dompurify/purify.es.mjs (text/javascript + nosniff; misses → existing /vendor 404 no-store)
//   marked.esm.js has NO default export (use mod.marked); purify.es.mjs default-exports a factory (DOMPurify(win)) — verified at the pins

// ── P3-facing facts beyond the tables above ──
// - The cards route answers 400 when the body's state is anything but 'dismissed' (only the server flips to started/failed).
// - The DETERMINISTIC title is stamped synchronously BEFORE the 202 with NO frame — P3 reads it from the thread row (REST) or sets
//   it locally; only the D13 background replacement arrives as {type:'ask-title'}.
// - ask-label / ask-delta / ask-block / ask-card / ask-usage payload keys are spec §6.6's, verbatim (the reducer emits them; the
//   server only stamps threadId/messageId/seq).
// - marked/dompurify are pinned by P2 (18.0.10 / 3.4.14). P3 makes ZERO package.json changes — spec §16's letter lists
//   "dependency pins" under P3, but the adjudicated single-lockfile-owner override moves them here.
// - Follower notice texts are rendered VERBATIM by P3 (§10.5 notice block): 'Run started — "<title>"', 'Run "<title>" is waiting
//   for your answer (<kind>)', 'Run failed: <message>', 'Run finished — "<title>" · <status>[ · <dur>][ · <cost>]'.
```

## File structure

| path | action | responsibility |
|---|---|---|
| `package.json`, `package-lock.json` | modify | `marked@18.0.10` + `dompurify@3.4.14`, exact pins (T1) |
| `ui/server.mjs` | modify | vendor routes (T1); askJobs + WS + sweeps + thread/model routes (T5); message/stop routes (T6); cards + `/api/run` seam + follower wiring (T7) |
| `src/core/title.mjs` | modify | `permissionMode` pass-through (T2) |
| `src/core/ask/follow.mjs` | create | run follower (T3) |
| `src/core/ask/turn.mjs` | create | the turn engine (T4) |
| `test/api-ask-vendor-assets.test.mjs` | create | T1 |
| `test/ask-title-options.test.mjs` | modify (+2 tests) | T2 |
| `test/ask-follow.test.mjs` | create | T3 (the unit test P1 deferred) |
| `test/ask-turn.test.mjs` | create | T4 |
| `test/ask-api-threads.test.mjs` | create | T5 |
| `test/ask-api-messages.test.mjs` | create | T6 |
| `test/ask-api-cards.test.mjs` | create | T7 |

(Spec §12 names one `ask-api` file; splitting it into `ask-api-threads` / `ask-api-messages` / `ask-api-cards` keeps each task independently green — a deliberate, recorded deviation. `api-ask-vendor-assets` matches §12's name.)

## Task DAG

```
T1 vendor deps+routes ─────────────┐
T2 title permissionMode ── T4 turn ┼─ T5 registry/WS/threads ── T6 messages/stop ── T7 cards + /api/run ── T8 verify
T3 follow.mjs ─────────────────────┘                                                   (T7 also needs T3)
```

T1/T2/T3 are mutually independent. T4's own tests inject `generateTitle`, so they pin the OPTION OBJECT and pass without T2 — the real consumer of T2 is T6's route-level R-F regression (the real `generateTitle` under mock must take the `dontAsk` arm); T4 merely precedes T2's consumer in numeric order. T5 needs T4 (`askJobs` entries hold an `AskTurn`). T6 needs T2 + T5. T7 needs T3 + T6. T8 last. Execute in numeric order when sequential.

---
### Task 1: marked/dompurify pins + `/vendor` ESM routes

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm install`)
- Modify: `ui/server.mjs` (two hunks: resolver consts next to `resolveHljsAssets` ~`:131-141`; routes inside the vendor section ~`:616-649`; `_testing` tail ~`:3679-3683`)
- Test: `test/api-ask-vendor-assets.test.mjs`

**Interfaces:**
- Consumes: the existing `/vendor` plumbing — `sendHljsModule` shape, the 4-arg `/vendor` error handler and 404 no-store catch-all (`ui/server.mjs:640-649`), the SPA-fallback `/vendor` exclusion (`:3547`).
- Produces: `GET /vendor/marked/marked.esm.js`, `GET /vendor/dompurify/purify.es.mjs`; `_testing.resolveEsmAsset(spec, resolve?, warn?)`.

Verified at the exact pins (2026-08-22, scratch install): `import.meta.resolve('marked')` → `…/node_modules/marked/lib/marked.esm.js`; `import.meta.resolve('dompurify')` → `…/node_modules/dompurify/dist/purify.es.mjs`; both files are fully self-contained ESM (zero import statements — the `data:`-URL import trick works); `marked` has NO default export and `mod.marked.parse('**b**', {gfm:true, breaks:true, async:false})` returns synchronously; `dompurify` exports only `default` (a factory taking a window). Registry integrities: marked `sha512-FJeH4bRpYoXiggcgriCGItKCSv3xkngJc4QCZ/rkQCogU3VYaLxYJoZl8Nw/b4+x7iij/pd+09mZ6A1dXzpL0A==`, dompurify `sha512-dVoH9z+MY+C9IilgGCk3YfFqjLi3fChm2OiKJMzh6axrJ5qwxqWaZamgmHrpv22CN/KdbZJuGEGgfQoL00LTdg==`.

- [ ] **Step 1: Install the pinned dependencies**

Run: `npm install --save-exact marked@18.0.10 dompurify@3.4.14`
Expected: `package.json` `dependencies` gains `"dompurify": "3.4.14"` and `"marked": "18.0.10"` (exact, no caret); `package-lock.json` gains both entries with the integrities above. Nothing else changes in `dependencies`. The npm banner is environment-dependent ("added 3 packages" on a cold cache — the third is `@types/trusted-types`, an OPTIONAL dep of dompurify, lock-only; "up to date" when `node_modules` already holds the pins) — verify by reading `package.json` and the two lock integrities, never the banner.

- [ ] **Step 2: Write the failing test**

Create `test/api-ask-vendor-assets.test.mjs` (the `test/api-hljs-assets.test.mjs` pattern — simple boot, fresh `http.createServer(mod.app)`, no WS):

```js
// test/api-ask-vendor-assets.test.mjs
// Ask Worca §10.7: the two ESM vendor routes for the chat's markdown pipeline.
// marked has NO default export (use mod.marked); dompurify default-exports a
// factory. Both files are self-contained ESM, so the data:-URL import proves
// the served bytes are the real module. Misses fall into the existing /vendor
// no-store 404; nothing here may disturb the hljs routes or the SPA fallback.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

const root = fileURLToPath(new URL('..', import.meta.url));
let srv;
let base;
let testing;

before(async () => {
  const mod = await import('../ui/server.mjs');
  testing = mod._testing;
  srv = http.createServer(mod.app);
  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      srv.off('error', reject);
      resolve();
    });
  });
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) {
    await new Promise((resolve) => {
      srv.close(resolve);
      srv.closeAllConnections();
    });
  }
});

test('dependencies and lock pin the reviewed markdown packages exactly', () => {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
  const lock = JSON.parse(readFileSync(`${root}/package-lock.json`, 'utf8'));
  assert.equal(pkg.dependencies.marked, '18.0.10');
  assert.equal(pkg.dependencies.dompurify, '3.4.14');
  assert.equal((pkg.devDependencies || {}).marked, undefined);
  assert.equal((pkg.devDependencies || {}).dompurify, undefined);
  const markedLock = lock.packages['node_modules/marked'];
  assert.equal(markedLock.version, '18.0.10');
  assert.equal(markedLock.integrity,
    'sha512-FJeH4bRpYoXiggcgriCGItKCSv3xkngJc4QCZ/rkQCogU3VYaLxYJoZl8Nw/b4+x7iij/pd+09mZ6A1dXzpL0A==');
  assert.notEqual(markedLock.dev, true);
  const purifyLock = lock.packages['node_modules/dompurify'];
  assert.equal(purifyLock.version, '3.4.14');
  assert.equal(purifyLock.integrity,
    'sha512-dVoH9z+MY+C9IilgGCk3YfFqjLi3fChm2OiKJMzh6axrJ5qwxqWaZamgmHrpv22CN/KdbZJuGEGgfQoL00LTdg==');
  assert.notEqual(purifyLock.dev, true);
});

test('both vendor modules are served as importable ESM with the promised shapes', async () => {
  const cases = [
    { path: '/vendor/marked/marked.esm.js', expectMarked: true },
    { path: '/vendor/marked/marked.esm.js?retry=1', expectMarked: true },
    { path: '/vendor/dompurify/purify.es.mjs', expectMarked: false },
  ];
  for (const { path: pathname, expectMarked } of cases) {
    const res = await fetch(`${base}${pathname}`);
    assert.equal(res.status, 200, pathname);
    assert.match(res.headers.get('content-type') || '', /javascript/i, pathname);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', pathname);
    const source = await res.text();
    const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    if (expectMarked) {
      assert.equal(typeof mod.marked, 'function', `${pathname} exposes mod.marked`);
      assert.equal(mod.default, undefined, `${pathname} has no default export`);
      assert.equal(mod.marked.parse('**b**', { gfm: true, breaks: true, async: false }), '<p><strong>b</strong></p>\n');
    } else {
      assert.equal(typeof mod.default, 'function', `${pathname} default-exports the DOMPurify factory`);
    }
  }
});

test('vendor misses stay plain no-store 404s and never the SPA shell', async () => {
  const paths = [
    '/vendor/marked/',
    '/vendor/marked/marked.cjs',
    '/vendor/marked/package.json',
    '/vendor/dompurify/purify.cjs.js',
    '/vendor/dompurify/%2e%2e%2fpackage.json',
    '/vendor/marked/marked.esm.js.map',
  ];
  for (const pathname of paths) {
    const res = await fetch(`${base}${pathname}`);
    assert.equal(res.status, 404, pathname);
    assert.doesNotMatch(res.headers.get('content-type') || '', /text\/html/i, pathname);
    assert.match(res.headers.get('cache-control') || '', /no-store/i, pathname);
    assert.doesNotMatch(await res.text(), /<!doctype html/i, pathname);
  }
});

test('hljs vendor routes are untouched', async () => {
  const res = await fetch(`${base}/vendor/hljs/core.min.js`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('resolution failure returns null and warns once, and the routes degrade to 404', () => {
  const warnings = [];
  const result = testing.resolveEsmAsset(
    'marked',
    () => { throw new Error('unavailable'); },
    (message) => warnings.push(message),
  );
  assert.equal(result, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ask markdown asset unavailable \(marked\): unavailable/);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test test/api-ask-vendor-assets.test.mjs`
Expected: FAIL — the two vendor-module tests get 404 (routes missing) and the resolver test throws `TypeError: testing.resolveEsmAsset is not a function`. The pin test already PASSES (Step 1 installed the packages) — that is expected; the pin test guards regressions, not this task's red.

- [ ] **Step 4: Add the resolver + routes to `ui/server.mjs`**

Hunk A — directly below the `resolveHljsAssets` block (anchor: `const HLJS_ASSETS = resolveHljsAssets();` ~`:141`):

```js
// Ask Worca §10.7: the chat's markdown pipeline is served from node_modules the
// same way the hljs assets are, but resolved with import.meta.resolve — the CJS
// require.resolve lands on marked's CJS build, and dompurify/package.json is not
// exported. Each package degrades independently: a missing one just leaves its
// route unregistered and the existing /vendor no-store 404 answers.
function resolveEsmAsset(spec, resolve = (s) => import.meta.resolve(s), warn = (msg) => console.warn(msg)) {
  try {
    return fileURLToPath(resolve(spec));
  } catch (err) {
    warn(`[worca-ui] ask markdown asset unavailable (${spec}): ${err?.message || err}`);
    return null;
  }
}

const ASK_VENDOR_ASSETS = {
  marked: resolveEsmAsset('marked'),
  dompurify: resolveEsmAsset('dompurify'),
};
```

(`fileURLToPath` is already imported at `ui/server.mjs:17`.)

Hunk B — inside the vendor section, immediately AFTER the `if (HLJS_ASSETS) { … }` block's closing brace (~`:638`) and BEFORE the `/vendor` error handler (`app.use('/vendor', (err, …)` ~`:640`) — registration order is load-bearing, anything after `:646` is swallowed by the catch-all:

```js
// Ask Worca §10.7 vendor routes. sendHljsModule's shape, reused verbatim: the
// sendFile error path falls through to the /vendor no-store handlers below.
const sendEsmModule = (file) => (_req, res, next) => {
  res.type('text/javascript');
  res.set('X-Content-Type-Options', 'nosniff');
  res.sendFile(file, (err) => {
    if (!err) return;
    if (res.headersSent) return next(err);
    next();
  });
};
if (ASK_VENDOR_ASSETS.marked) {
  app.get('/vendor/marked/marked.esm.js', sendEsmModule(ASK_VENDOR_ASSETS.marked));
}
if (ASK_VENDOR_ASSETS.dompurify) {
  app.get('/vendor/dompurify/purify.es.mjs', sendEsmModule(ASK_VENDOR_ASSETS.dompurify));
}
```

Hunk C — add `resolveEsmAsset` to the `_testing` export object (anchor: `chatNotifier, resumeRun, resolveHljsAssets,` ~`:3682`):

```js
  chatNotifier, resumeRun, resolveHljsAssets, resolveEsmAsset,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test test/api-ask-vendor-assets.test.mjs`
Expected: PASS (5/5).

- [ ] **Step 6: Full suite + fences**

Run: `npm test`
Expected: baseline + 5 = **3171 pass / 0 fail**. `test/api-hljs-assets.test.mjs` in particular stays green (shared `/vendor` namespace untouched).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json ui/server.mjs test/api-ask-vendor-assets.test.mjs
git commit -m "worca ask: pin marked/dompurify and serve them as /vendor ESM assets"
```

---
### Task 2: `generateTitle` gains a `permissionMode` pass-through

**Files:**
- Modify: `src/core/title.mjs` (2 lines + JSDoc)
- Test: `test/ask-title-options.test.mjs` (append 2 tests)

**Interfaces:**
- Consumes: `runClaude`'s existing `permissionMode` option (already destructured with default `'acceptEdits'`, `claude-runner.mjs:247`).
- Produces: `generateTitle(prompt, {…, permissionMode?})` — absent ⇒ `'acceptEdits'` (legacy argv byte-identical).

**Why (B-1, adjudicated):** R-F demands that no ask spawn can reach `runMock`'s legacy `MOCK_ASK` file-write arm. The main turn is covered twice (markers + `dontAsk`), but `generateTitle` hard-codes `permissionMode:'acceptEdits'` and offers no marker seam — under `WORCA_MOCK=1` a first message `MOCK_ASK: /tmp/x.json` would make the TITLE call write that file (verified empirically). Passing `permissionMode:'dontAsk'` routes the mock to the safe `mockAsk` arm (`claude-runner.mjs:867` — `dontAsk` alone selects it) and is strictly tighter for a tool-less text call in real mode.

- [ ] **Step 1: Write the failing tests**

Append to `test/ask-title-options.test.mjs`. Exactly ONE import change is needed (dry-run-verified): the file's `node:fs/promises` line lacks `rm` — replace its line 6 with

```js
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
```

(everything else the new tests use — `test`, `assert`, `tmpdir`, `join`, `generateTitle` — is already imported; never add a second import statement). The file's existing `beforeEach` already deletes `WORCA_MOCK`/`ORCH_MOCK` at `:12-15`, so the new tests hit the real spawn path with no further setup. The helper is new and collision-free:

```js
// --- Task 2 (P2): permissionMode pass-through -------------------------------
// A fake `claude` that dumps its argv NUL-separated and answers one result line
// (spawn-args.test.mjs:82-93 technique) — generateTitle never throws either way.
async function pmArgvBin(dir) {
  const out = join(dir, 'pm-argv.txt');
  const bin = join(dir, 'claude-pm');
  await writeFile(bin, [
    '#!/bin/sh',
    `for a in "$@"; do printf '%s\\0' "$a" >> "${out}"; done`,
    `printf '%s\\n' '{"type":"result","result":"A Title"}'`,
    'exit 0',
    '',
  ].join('\n'));
  await chmod(bin, 0o755);
  return { bin, out };
}

test('generateTitle forwards permissionMode when given (the ask call passes dontAsk)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-title-pm-'));
  const { bin, out } = await pmArgvBin(dir);
  const t = await generateTitle('fix the login flow', { cwd: dir, bin, permissionMode: 'dontAsk' });
  assert.equal(t, 'A Title');
  const argv = (await readFile(out, 'utf8')).split('\0').filter(Boolean);
  const i = argv.indexOf('--permission-mode');
  assert.notEqual(i, -1);
  assert.equal(argv[i + 1], 'dontAsk');
  await rm(dir, { recursive: true, force: true });
});

test('generateTitle without permissionMode keeps the legacy acceptEdits argv', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-title-pm-legacy-'));
  const { bin, out } = await pmArgvBin(dir);
  await generateTitle('fix the login flow', { cwd: dir, bin });
  const argv = (await readFile(out, 'utf8')).split('\0').filter(Boolean);
  const i = argv.indexOf('--permission-mode');
  assert.equal(argv[i + 1], 'acceptEdits');
  await rm(dir, { recursive: true, force: true });
});
```


- [ ] **Step 2: Run to verify the first fails**

Run: `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test test/ask-title-options.test.mjs`
Expected: FAIL — `argv[i + 1]` is `'acceptEdits'` in the first new test (the option is silently dropped today). The legacy test passes.

- [ ] **Step 3: Implement**

In `src/core/title.mjs`: change the hard-coded line (anchor: `permissionMode: 'acceptEdits',` ~`:48`) to

```js
      permissionMode: opts.permissionMode || 'acceptEdits',
```

and extend the `@param` JSDoc opts line (anchor: the `{{cwd:string, …}}` type at ~`:31`) with `, permissionMode?:string`, plus these two note lines inserted directly above the `@param {string} prompt` line:

```js
 * `permissionMode` (default 'acceptEdits') exists for Ask Worca: its title call
 * passes 'dontAsk' so the mock dispatcher can never reach a file-writing role.
```

- [ ] **Step 4: Run to verify green**

Run: `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test test/ask-title-options.test.mjs`
Expected: PASS (existing 3 + new 2).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: **3173 pass / 0 fail** (3171 + 2). `test/spawn-args.test.mjs` and `test/claude-runner-session.test.mjs` untouched-green (the default branch keeps every legacy argv byte-identical).

- [ ] **Step 6: Commit**

```bash
git add src/core/title.mjs test/ask-title-options.test.mjs
git commit -m "worca ask: generateTitle permissionMode pass-through for the dontAsk title call"
```

---

### Task 3: `src/core/ask/follow.mjs` — the run follower

**Files:**
- Create: `src/core/ask/follow.mjs`
- Test: `test/ask-follow.test.mjs` (the unit test spec §16 lists under P1 but §17's deviation list defers to P2 — it needs nothing but a bare `EventEmitter`)

**Interfaces:**
- Consumes: the orchestrator event vocabulary (B-8): `state` = full `getState()` clone (`id` is `null` until `createPipeline` — `orchestrator.mjs:504` fires before `:562`), `phase {phase, cycle, status:<step status>, nodeId}`, `question {id, kind, …}`, `error {message}` then `done {status:'error'}` (two events, one failure), `done {status, pipelineDir, reason?}`.
- Produces: `attachRunFollower(orch, {threadId, runId, cardId, post, updateStatus, onDetached}) → {detach}`. `post({kind, text, href})` and `updateStatus({pipelineId?, status?, phase?, cardFailed?})` are server closures (Task 7 wires them to `appendMessage`/`updateRunLink`/`flipCard` + broadcasts).

Design rules (adjudicated): `chatNotifier.attach` shape (`chat/notifier.mjs:62-99`) — every handler wrapped in an exception `guard`; the done-skips-on-error interlock copied verbatim (`notifier.mjs:88-94` precedent); pipeline-id captured on FIRST truthy string only (the `wireRun` guard, `ui/server.mjs:458-466`); question notices deduped by id and capped at 3 per run (spec §9.5's "at most 3–4 messages per run" counts the FOLLOWER's messages: ≤3 question notices + exactly one of failed/finished; the "Run started" message is the route's, on top); `detach()` is NEW construction (the notifier has none — spec §11 "thread deleted while a run is followed → follower detached"): named handlers removed via `removeListener`, plus a `detached` latch so a racing in-flight handler no-ops; the follower self-detaches on `error`/`done`. Duration/cost for the finish line come from `orch.getState()` at done-time, NOT the `done` payload (renderers read `meta`, `chat/renderers.mjs:53-74`); `fmtMs`/`fmtUsd` are reused from `chat/renderers.mjs` (exported).

- [ ] **Step 1: Write the failing test**

```js
// test/ask-follow.test.mjs
// attachRunFollower over a bare EventEmitter (spec §6.1 row): exact notices, no
// flooding, first-sight pipeline id, done-skips-on-error, detach semantics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { attachRunFollower } from '../src/core/ask/follow.mjs';

function harness(extra = {}) {
  const orch = new EventEmitter();
  orch.state = {};
  orch.getState = () => ({ ...orch.state });
  const posts = [];
  const patches = [];
  let detachedCb = 0;
  const follower = attachRunFollower(orch, {
    threadId: 'ask_00000001',
    runId: 'run-uuid-1',
    cardId: 'card_00000001',
    post: (m) => posts.push(m),
    updateStatus: (p) => patches.push(p),
    onDetached: () => { detachedCb += 1; },
    ...extra,
  });
  return { orch, posts, patches, follower, detached: () => detachedCb };
}

test('state: pipeline id captured on first truthy sight only; status mirrored', () => {
  const { orch, patches } = harness();
  orch.emit('state', { id: null, status: 'starting' });
  orch.emit('state', { id: 'a1b2c3d4', status: 'running', title: 'T' });
  orch.emit('state', { id: 'ffffffff', status: 'running' });
  assert.equal(patches.length, 3);
  assert.equal(patches[0].pipelineId, undefined);
  assert.equal(patches[0].status, 'starting');
  assert.equal(patches[1].pipelineId, 'a1b2c3d4');
  assert.equal(patches[2].pipelineId, undefined, 'only the FIRST sight patches the id');
});

test('phase: updateStatus only, status forced running, no message', () => {
  const { orch, posts, patches } = harness();
  orch.emit('phase', { phase: 'implement', cycle: 1, status: 'start' });
  assert.equal(posts.length, 0);
  assert.deepEqual(patches, [{ phase: 'implement', status: 'running' }]);
});

test('question: one notice per question id, capped at 3, wording + href', () => {
  const { orch, posts } = harness();
  orch.emit('state', { id: 'a1b2c3d4', status: 'running', title: 'Fix login' });
  orch.emit('question', { id: 'q1', kind: 'clarify' });
  orch.emit('question', { id: 'q1', kind: 'clarify' });   // duplicate id — dropped
  orch.emit('question', { id: 'q2', kind: 'gate' });
  orch.emit('question', { id: 'q3', kind: 'recovery' });
  orch.emit('question', { id: 'q4', kind: 'clarify' });   // over the cap — dropped
  assert.equal(posts.length, 3);
  assert.equal(posts[0].kind, 'question');
  assert.equal(posts[0].text, 'Run "Fix login" is waiting for your answer (clarify)');
  assert.equal(posts[1].text, 'Run "Fix login" is waiting for your answer (gate)');
  assert.equal(posts[0].href, '#running/run-uuid-1');
});

test('error then done{error}: ONE failed message, card flagged, then detached', () => {
  const { orch, posts, patches, detached } = harness();
  orch.emit('error', { message: 'Preflight failed: 1 workflow agent key(s) do not resolve:\n  - agent "x" is not installed' });
  orch.emit('done', { status: 'error', pipelineDir: null });
  assert.equal(posts.length, 1, 'done{status:error} posts nothing (the richer error already did)');
  assert.equal(posts[0].kind, 'failed');
  assert.match(posts[0].text, /^Run failed: Preflight failed:/);
  const err = patches.find((p) => p.cardFailed);
  assert.ok(err, 'updateStatus carried cardFailed');
  assert.equal(err.status, 'error');
  assert.equal(detached(), 1, 'self-detached exactly once');
  orch.emit('question', { id: 'q9', kind: 'clarify' });
  assert.equal(posts.length, 1, 'detached: later events are ignored');
});

test('done{done}: one finish message with status, duration and cost from getState()', () => {
  const { orch, posts, patches } = harness();
  orch.state = { title: 'Fix login', totalActiveMs: 192000, totalCostUsd: 0.42 };
  orch.emit('state', { id: 'a1b2c3d4', status: 'running', title: 'Fix login' });
  orch.emit('done', { status: 'done', pipelineDir: '/x' });
  const fin = posts.find((p) => p.kind === 'done');
  assert.ok(fin);
  assert.equal(fin.text, 'Run finished — "Fix login" · done · 3m12s · $0.42');
  assert.equal(fin.href, '#running/run-uuid-1');
  assert.equal(patches.at(-1).status, 'done');
});

test('done{stopped} wording omits absent duration/cost', () => {
  const { orch, posts } = harness();
  orch.emit('done', { status: 'stopped', pipelineDir: '/x' });
  assert.equal(posts[0].text, 'Run finished — "run" · stopped');
});

test('a throwing post/updateStatus never breaks the emitter (guard)', () => {
  const orch = new EventEmitter();
  orch.state = {};
  orch.getState = () => ({});
  attachRunFollower(orch, {
    threadId: 't', runId: 'r', cardId: null,
    post: () => { throw new Error('boom'); },
    updateStatus: () => { throw new Error('boom'); },
  });
  assert.doesNotThrow(() => {
    orch.emit('state', { id: 'a1b2c3d4' });
    orch.emit('question', { id: 'q1', kind: 'clarify' });
    orch.emit('error', { message: 'x' });
    orch.emit('done', { status: 'error' });
  });
});

test('manual detach removes every listener and fires onDetached once', () => {
  const { orch, posts, follower, detached } = harness();
  follower.detach();
  follower.detach();
  assert.equal(detached(), 1);
  assert.equal(orch.listenerCount('state') + orch.listenerCount('phase')
    + orch.listenerCount('question') + orch.listenerCount('error') + orch.listenerCount('done'), 0);
  orch.emit('question', { id: 'q1', kind: 'clarify' });
  assert.equal(posts.length, 0);
});

test('a lone done{status:error} (no preceding error event) posts nothing', () => {
  // The interlock itself: without a prior `error` (which self-detaches), the
  // done handler must still skip the message for status 'error'.
  const { orch, posts, patches, detached } = harness();
  orch.emit('done', { status: 'error' });
  assert.equal(posts.length, 0, 'the failure notice belongs to the `error` event alone (done-skips-on-error)');
  assert.equal(patches.at(-1).status, 'error');
  assert.equal(detached(), 1);
});

test('the detach latch stops late events even when the emitter keeps its listeners', () => {
  // A foreign / already-torn-down orchestrator whose removeListener no-ops:
  // only the `detached` latch inside guard() can stop the flood.
  const orch = new EventEmitter();
  orch.getState = () => ({});
  orch.removeListener = () => orch;
  const posts = [];
  attachRunFollower(orch, {
    threadId: 'ask_00000001', runId: 'r', cardId: null,
    post: (m) => posts.push(m), updateStatus: () => {},
  });
  orch.emit('done', { status: 'done' });
  assert.equal(posts.length, 1);
  orch.emit('question', { id: 'q1', kind: 'clarify' });
  orch.emit('done', { status: 'done' });
  assert.equal(posts.length, 1, 'the detached latch no-ops every later handler');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test test/ask-follow.test.mjs`
Expected: FAIL — `Cannot find module '../src/core/ask/follow.mjs'`.

- [ ] **Step 3: Implement `src/core/ask/follow.mjs`**

```js
// src/core/ask/follow.mjs
// Follow a run started from an Ask Worca card (ask-worca-design.md §9.5, §11).
// attachRunFollower(orch, deps) subscribes to the orchestrator's state/phase/
// question/error/done events — every handler exception-guarded so nothing here
// can break a run (chat/notifier.mjs precedent) — and mirrors them into the
// thread through two injected closures:
//   post({kind, text, href})                     → a system message + notice
//   updateStatus({pipelineId?, status?, phase?, cardFailed?}) → ask_run_links + ask-run-status
// Message budget per run: ≤3 question notices (deduped by id) + exactly one of
// failed/finished. done{status:'error'} posts nothing — the richer `error`
// event already did (the orchestrator emits both for one failure).
// detach() removes the named listeners and latches; the follower self-detaches
// on error/done. Core module: no Express, no orchestrator import — driven by a
// bare EventEmitter in tests.
import { fmtMs, fmtUsd } from '../chat/renderers.mjs';

const MAX_QUESTION_NOTICES = 3;

export function attachRunFollower(orch, {
  threadId, runId, cardId = null, post = () => {}, updateStatus = () => {}, onDetached = null,
} = {}) {
  let detached = false;
  let seenPipelineId = false;
  let title = '';
  const seenQuestions = new Set();

  const guard = (fn) => (payload) => {
    if (detached) return;
    try { fn(payload && typeof payload === 'object' ? payload : {}); } catch { /* never break the run */ }
  };

  const finishLine = (status) => {
    // Duration/cost live on the orchestrator state, not the done payload
    // (chat/renderers.mjs:53-74 reads them from meta the same way).
    let state = {};
    try { state = (typeof orch.getState === 'function' && orch.getState()) || {}; } catch { /* keep {} */ }
    const name = title || state.title || 'run';
    const parts = [`Run finished — "${name}" · ${status}`];
    const dur = fmtMs(state.totalActiveMs);
    if (dur) parts.push(dur);
    const cost = fmtUsd(state.totalCostUsd);
    if (cost) parts.push(cost);
    return parts.join(' · ');
  };

  const handlers = {
    state: guard((p) => {
      if (typeof p.title === 'string' && p.title) title = p.title;
      const patch = {};
      // First truthy sight only (ui/server.mjs wireRun guard): null pre-createPipeline
      // snapshots and later re-emits must not churn the stored id.
      if (!seenPipelineId && typeof p.id === 'string' && p.id) {
        seenPipelineId = true;
        patch.pipelineId = p.id;
      }
      if (p.status) patch.status = p.status;
      updateStatus(patch);
    }),
    phase: guard((p) => {
      updateStatus({ phase: p.phase ?? null, status: 'running' });
    }),
    question: guard((p) => {
      const qid = String(p.id ?? 'q');
      if (seenQuestions.has(qid) || seenQuestions.size >= MAX_QUESTION_NOTICES) return;
      seenQuestions.add(qid);
      post({
        kind: 'question',
        text: `Run "${title || 'run'}" is waiting for your answer (${p.kind || 'question'})`,
        href: `#running/${runId}`,
      });
    }),
    error: guard((p) => {
      const message = typeof p.message === 'string' && p.message ? p.message : 'unknown error';
      updateStatus({ status: 'error', cardFailed: message });
      post({ kind: 'failed', text: `Run failed: ${message}`, href: `#running/${runId}` });
      detach();
    }),
    done: guard((p) => {
      const status = p.status || 'done';
      updateStatus({ status });
      if (status !== 'error') {
        post({ kind: 'done', text: finishLine(status), href: `#running/${runId}` });
      }
      detach();
    }),
  };

  function detach() {
    if (detached) return;
    detached = true;
    for (const [name, handler] of Object.entries(handlers)) {
      try { orch.removeListener?.(name, handler); } catch { /* already gone */ }
    }
    try { onDetached?.(); } catch { /* prune callback is best-effort */ }
  }

  for (const [name, handler] of Object.entries(handlers)) orch.on(name, handler);
  return { detach, get detached() { return detached; }, threadId, runId, cardId };
}
```

- [ ] **Step 4: Run to verify green**

Run: `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test test/ask-follow.test.mjs`
Expected: PASS (10/10). Two layers back each other up and each has its own test: `removeListener` covers the ordinary post-detach silence, while the `if (detached) return;` latch in `guard` is what the foreign-emitter test pins (a stubbed `removeListener` cannot unhook), and the lone `done{status:'error'}` test pins the done-skips-on-error interlock directly.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: **3183 pass / 0 fail** (3173 + 10).

- [ ] **Step 6: Commit**

```bash
git add src/core/ask/follow.mjs test/ask-follow.test.mjs
git commit -m "worca ask: run follower (state/phase/question/error/done -> notices + run links)"
```

---
### Task 4: `src/core/ask/turn.mjs` — the turn engine

**Files:**
- Create: `src/core/ask/turn.mjs`
- Test: `test/ask-turn.test.mjs`

**Interfaces:**
- Consumes: `createTurnReducer` (events.mjs — incl. `settle()`, post-`finish()` null semantics), `buildAskSpawnOptions`/`buildMcpConfig`/`ASK_MCP_SERVER_PATH` (spawn.mjs), bound `validateProposal` (proposal.mjs), `askLimits`/`ASK_LIMITS` (limits.mjs), store writers (`finishMessage`, `setMessageBlocks`, `addThreadTotals`, `updateThread`, `setThreadTitle`, `newAskId`), `runClaude`/`generateTitle` (Task 2's `permissionMode`), `resolveModelEnv`, `worcaHome`.
- Produces: `createAskTurn(opts) → AskTurn` per the Frozen P2→P3 contract block. Bare frames via `deps.onFrame` (`ask-start` + everything the reducer emits + terminal `ask-done`/`ask-error`); `deps.onOutOfTurn` for `ask-title`; emitter events `'done'`/`'error'` for registry bookkeeping.

Design (adjudicated, cites in the code): ONE instance retries internally (≤2 attempts, fresh reducer per attempt, one `AbortController` + one 15-minute timer spanning both); R-C classification order with the abort branch FIRST (B-4: `runClaude` throws a synchronous `AbortError` pre-init); retry passes `{...thread, sessionId: null}` (B-7); `restoredPrompt` is PREBUILT by the route; terminal writes are persist-before-broadcast; `finishMessage` always gets the full seven-column patch (B-5); the title call fires on any terminal status of the first turn with `permissionMode:'dontAsk'` (B-1) and no signal (the turn's controller is already aborted after a user stop — passing it would make `generateTitle` return `''` before spawning).

- [ ] **Step 1: Write the failing test**

```js
// test/ask-turn.test.mjs
// AskTurn over the REAL store (temp home) with an injected runClaudeImpl —
// every R-A/R-C/R-F/R-G branch, plus session capture, totals, title, timer,
// stop. Frames asserted BARE (the server stamps threadId/messageId/seq).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { createAskTurn } from '../src/core/ask/turn.mjs';
import {
  createThread, appendMessage, getMessage, getThread,
  updateThread, setThreadTitle, deleteThread,
} from '../src/core/ask/store.mjs';

useTempHome(after);

const RESULT = (over = {}) => ({
  type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.05,
  usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  modelUsage: {}, duration_ms: 40, num_turns: 1, session_id: 'sess-1', permission_denials: [], ...over,
});
const push = (onEvent, raw) => onEvent({ type: raw.type, raw });
const say = (onEvent, id, text) => {
  push(onEvent, { type: 'assistant', message: { id, content: [{ type: 'text', text }] }, parent_tool_use_id: null });
};
// B-4: the REAL runClaude pre-checks the signal and throws synchronously before
// any init. run() only reaches runClaudeImpl after two awaited fs calls
// (mkdir + the mcp-json write), so a stop() scheduled by the test can already
// have fired — a fake that only LISTENS for 'abort' would then wait forever.
// Mirror the runner's pre-check.
const waitAbort = (signal) => new Promise((r) => {
  if (signal.aborted) return r();
  signal.addEventListener('abort', r, { once: true });
});

function seed() {
  const thread = createThread();
  const user = appendMessage(thread.id, { role: 'user', text: 'hello there' });
  const asst = appendMessage(thread.id, { role: 'assistant', text: '', status: 'streaming' });
  return { thread, user, asst };
}

function makeTurn({ thread, user, asst }, over = {}, deps = {}) {
  const frames = [];
  const outOfTurn = [];
  const turn = createAskTurn({
    threadId: thread.id, assistantMessageId: asst.id, userMessageId: user.id,
    prompt: 'PROMPT-1', systemPrompt: 'SYS', restoredPrompt: 'RESTORED-1',
    model: 'claude-opus-5', effort: 'high',
    resumeSessionId: null, firstTurn: false, firstText: 'hello there', deterministicTitle: null,
    mock: null, attachmentNames: {},
    ...over,
    deps: {
      onFrame: (f) => frames.push(f),
      onOutOfTurn: (f) => outOfTurn.push(f),
      generateTitle: async () => '',
      ...deps,
    },
  });
  return { turn, frames, outOfTurn };
}

test('happy path: frames ordered, session stored immediately, row + totals persisted before ask-done', async () => {
  const s = seed();
  let rowStatusAtDoneFrame = null;
  let sessionAtEvent = null;   // observed inside the impl, ASSERTED after run()
  // (an assert thrown inside runClaudeImpl is caught by turn.mjs's own catch and
  // reclassified as a turn failure — the real message would never surface)
  const { turn, frames } = makeTurn(s, {}, {
    runClaudeImpl: async (opts) => {
      opts.onEvent({ type: 'session', sessionId: 'sess-1' });
      sessionAtEvent = getThread(s.thread.id).sessionId;
      say(opts.onEvent, 'msg_1', 'partial answer');
      push(opts.onEvent, RESULT());
      return { text: 'partial answer', exitCode: 0 };
    },
  });
  // wrap the default onFrame to observe persistence order at the terminal frame
  const baseOnFrame = turn.deps.onFrame;
  turn.deps.onFrame = (f) => {
    baseOnFrame(f);
    if (f.type === 'ask-done') rowStatusAtDoneFrame = getMessage(s.asst.id).status;
  };
  const out = await turn.run();
  assert.equal(out.status, 'done');
  assert.equal(sessionAtEvent, 'sess-1', 'session id stored the moment it arrives');
  assert.equal(frames[0].type, 'ask-start');
  assert.equal(frames[0].userMessageId, s.user.id);
  assert.equal(frames.at(-1).type, 'ask-done');
  assert.equal(rowStatusAtDoneFrame, 'done', 'persist-before-broadcast');
  const row = getMessage(s.asst.id);
  assert.equal(row.status, 'done');
  assert.equal(row.text, 'partial answer');
  assert.equal(row.costUsd, 0.05);
  const totals = getThread(s.thread.id).totals;
  assert.equal(totals.turns, 1);
  assert.equal(totals.costUsd, 0.05);
  const done = frames.at(-1);
  assert.equal(done.status, 'done');
  assert.deepEqual(done.threadTotals, totals);
});

test('R-G: mcp config written (resolved home, argv twins), deleted in finally even on rejection', async () => {
  const s = seed();
  let sawPath = null;
  let cfg = null;
  const { turn } = makeTurn(s, {}, {
    runClaudeImpl: async (opts) => {
      sawPath = opts.mcpConfigPath;
      assert.ok(existsSync(sawPath), 'config exists while the turn runs');
      cfg = JSON.parse(readFileSync(sawPath, 'utf8'));
      throw Object.assign(new Error('claude exited with code 1: boom'), { errorClass: 'api' });
    },
  });
  await turn.run();
  const base = pathResolve(process.env.WORCA_HOME);
  assert.match(sawPath, new RegExp(`mcp-${s.asst.id}\\.json$`));
  assert.equal(cfg.mcpServers.worca.env.WORCA_HOME, base);
  assert.equal(cfg.mcpServers.worca.env.WORCA_ASK_THREAD_ID, s.thread.id);
  const args = cfg.mcpServers.worca.args;
  assert.equal(args[args.indexOf('--home') + 1], base);
  assert.equal(args[args.indexOf('--thread') + 1], s.thread.id);
  assert.ok(!existsSync(sawPath), 'unlinked in finally');
});

test('R-A: valid proposal → card persisted mid-turn and ask-card precedes ask-done', async () => {
  const s = seed();
  const card = { target: 'project', projectKey: 'demo-00000001', workflowId: 'wf_default' };
  let proposalArgs = null;   // observed in the hook, asserted after run() (see the
  let midBlocks = null;      // sessionAtEvent note above — inline asserts get swallowed)
  const { turn, frames } = makeTurn(s, {}, {
    validateProposal: async (input, { cardId }) => {
      proposalArgs = { input, cardId };
      return { ok: true, card };
    },
    runClaudeImpl: async (opts) => {
      push(opts.onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__worca__propose_run', input: { brief: 'do it' } }] } });
      push(opts.onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' }] }, tool_use_result: '{"ok":true}' });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      midBlocks = getMessage(s.asst.id).blocks;
      push(opts.onEvent, RESULT());
      return { text: '', exitCode: 0 };
    },
  });
  await turn.run();
  assert.match(proposalArgs.cardId, /^card_[0-9a-f]{8}$/);
  assert.equal(proposalArgs.input.brief, 'do it');
  assert.ok((midBlocks || []).some((b) => b.kind === 'card' && b.state === 'proposed'),
    'card persisted via setMessageBlocks WHILE the turn streams');
  const iCard = frames.findIndex((f) => f.type === 'ask-card');
  const iDone = frames.findIndex((f) => f.type === 'ask-done');
  assert.ok(iCard !== -1 && iCard < iDone, 'card broadcast before ask-done');
  assert.deepEqual(frames[iCard].block.card, card);
  const final = getMessage(s.asst.id);
  assert.ok(final.blocks.some((b) => b.kind === 'card' && b.state === 'proposed'));
});

test('invalid proposal → "Proposal rejected" notice, no card', async () => {
  const s = seed();
  const { turn, frames } = makeTurn(s, {}, {
    validateProposal: async () => ({ ok: false, errors: ['unknown projectKey "nope"'] }),
    runClaudeImpl: async (opts) => {
      push(opts.onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__worca__propose_run', input: { brief: 'x' } }] } });
      push(opts.onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":false}' }] }, tool_use_result: '{"ok":false}' });
      push(opts.onEvent, RESULT());
      return { text: '', exitCode: 0 };
    },
  });
  await turn.run();
  assert.ok(!frames.some((f) => f.type === 'ask-card'));
  const notice = getMessage(s.asst.id).blocks.find((b) => b.kind === 'notice');
  assert.equal(notice.text, 'Proposal rejected: unknown projectKey "nope"');
});

test('R-A settle race: a hook still pending when the user stops does not hang the turn', async () => {
  const s = seed();
  let release;
  const gate = new Promise((r) => { release = r; });
  const { turn } = makeTurn(s, {}, {
    validateProposal: () => gate.then(() => ({ ok: false, errors: ['late'] })),
    runClaudeImpl: async (opts) => {
      push(opts.onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__worca__propose_run', input: {} }] } });
      push(opts.onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'x' }] }, tool_use_result: 'x' });
      await waitAbort(opts.signal);
      const err = new Error('aborted'); err.name = 'AbortError';
      throw err;
    },
  });
  const done = turn.run();
  setImmediate(() => turn.stop());
  // A missing settle()/abort race is a HANG, not a failure — npm test sets no
  // --test-timeout, so bound it here and fail loudly instead.
  const wedged = new Promise((_res, rej) => {
    const t = setTimeout(() => rej(new Error('turn.run() never settled: settle() must be raced against the abort')), 2000);
    t.unref?.();
  });
  const out = await Promise.race([done, wedged]);   // settle() raced against the abort — resolves
  assert.equal(out.status, 'stopped');
  release();                                  // late hook lands after finish(): swallowed
  await new Promise((r) => setImmediate(r));
  assert.ok(!getMessage(s.asst.id).blocks?.some((b) => b.kind === 'notice' && b.text === 'Proposal rejected: late'));
});

test('R-C user stop: ask-done stopped/user, costUsd null without a result, partial text kept', async () => {
  const s = seed();
  const { turn, frames } = makeTurn(s, {}, {
    runClaudeImpl: async (opts) => {
      say(opts.onEvent, 'msg_1', 'half an ans');
      await waitAbort(opts.signal);
      const err = new Error('aborted'); err.name = 'AbortError';
      throw err;
    },
  });
  const p = turn.run();
  setImmediate(() => { turn.stop(); turn.stop(); });   // idempotent
  const out = await p;
  assert.equal(out.status, 'stopped');
  const done = frames.at(-1);
  assert.equal(done.type, 'ask-done');
  assert.equal(done.status, 'stopped');
  assert.equal(done.reason, 'user');
  assert.equal(done.costUsd, null);
  const row = getMessage(s.asst.id);
  assert.equal(row.status, 'stopped');
  assert.equal(row.reason, 'user');
  assert.equal(row.text, 'half an ans');
  assert.equal(row.costUsd, null);
  assert.equal(getThread(s.thread.id).totals.turns, 1, 'a null-cost turn still counts');
});

test('R-C timeout: the timer sets timedOut BEFORE aborting → ask-error "timed out after 15 min"', async () => {
  const s = seed();
  let fireTimer = null;
  const { turn, frames } = makeTurn(s, {}, {
    // The reducer shares this injected timer for its ≤50 ms delta batching —
    // fire those inline and capture ONLY the 15-minute wall clock.
    setTimeout: (fn, ms) => { if (ms === 900000) { fireTimer = fn; return 1; } fn(); return 2; },
    clearTimeout: () => {},
    runClaudeImpl: async (opts) => {
      await waitAbort(opts.signal);
      const err = new Error('aborted'); err.name = 'AbortError';
      throw err;
    },
  });
  const p = turn.run();
  // run() installs the wall clock only after two awaited fs calls — poll for it.
  await new Promise((res) => { (function tick() { if (fireTimer) return res(); setImmediate(tick); })(); });
  fireTimer();
  await p;
  const last = frames.at(-1);
  assert.equal(last.type, 'ask-error');
  assert.equal(last.message, 'timed out after 15 min');
  assert.equal(getMessage(s.asst.id).status, 'error');
  assert.equal(turn.timedOut, true);
});

test('R-C limits: exit-1 rejection classified from resultSubtype; notice uses the fresh limit', async () => {
  const s = seed();
  const { turn, frames } = makeTurn(s, {}, {
    askLimits: () => ({ maxTurns: 7, maxBudgetUsd: 2 }),
    runClaudeImpl: async (opts) => {
      push(opts.onEvent, RESULT({ subtype: 'error_max_turns', is_error: true, errors: ['Reached maximum number of turns (7)'] }));
      throw new Error('claude exited with code 1: no stderr');   // F5 shape — never parsed
    },
  });
  await turn.run();
  const done = frames.at(-1);
  assert.equal(done.type, 'ask-done');
  assert.equal(done.status, 'stopped');
  assert.equal(done.reason, 'max_turns');
  const notice = getMessage(s.asst.id).blocks.find((b) => b.kind === 'notice');
  assert.equal(notice.text, 'Stopped: reached the 7-turn limit (Settings → Ask Worca)');
});

test('R-C resume fallback: retry once without --resume, restored prompt, notice, new session stored', async () => {
  const s = seed();
  const calls = [];
  const { turn, frames } = makeTurn(s, { resumeSessionId: 'dead-sid', mock: { card: { a: 1 } } }, {
    runClaudeImpl: async (opts) => {
      calls.push({ resume: opts.resumeSessionId, prompt: opts.prompt, sys: opts.systemPrompt });
      if (calls.length === 1) {
        push(opts.onEvent, RESULT({ subtype: 'error_during_execution', is_error: true, total_cost_usd: 0, errors: ['No conversation found with session ID: dead-sid'] }));
        throw new Error('claude exited with code 1: No conversation found with session ID: dead-sid');
      }
      opts.onEvent({ type: 'session', sessionId: 'fresh-sid' });
      say(opts.onEvent, 'msg_2', 'restored answer');
      push(opts.onEvent, RESULT({ session_id: 'fresh-sid' }));
      return { text: 'restored answer', exitCode: 0 };
    },
  });
  const out = await turn.run();
  assert.equal(out.status, 'done');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].resume, 'dead-sid');
  assert.equal(calls[0].prompt, 'PROMPT-1');
  assert.equal(calls[1].resume, undefined, 'retry drops --resume');
  assert.equal(calls[1].prompt, 'RESTORED-1', 'retry uses the prebuilt restored prompt');
  assert.match(calls[0].sys, /MOCK_ROLE: ask/, 'R-F: markers on attempt 1');
  assert.match(calls[1].sys, /MOCK_ROLE: ask/, 'R-F: markers on the retry too');
  assert.equal(getThread(s.thread.id).sessionId, 'fresh-sid');
  const blocks = getMessage(s.asst.id).blocks;
  assert.ok(blocks.some((b) => b.kind === 'notice' && b.text === 'Context restored from history'));
  assert.equal(frames.at(-1).type, 'ask-done');
});

test('retry also fails: session cleared, ask-error with the runner message + errorClass', async () => {
  const s = seed();
  updateThread(s.thread.id, { sessionId: 'dead-sid' });   // observable clear
  let n = 0;
  const { turn, frames } = makeTurn(s, { resumeSessionId: 'dead-sid' }, {
    runClaudeImpl: async (opts) => {
      n += 1;
      if (n === 1) throw new Error('claude exited with code 1: no stderr'); // no init at all → predicate hits
      throw Object.assign(new Error('claude exited with code 1: auth'), { errorClass: 'auth' });
    },
  });
  await turn.run();
  assert.equal(n, 2);
  assert.equal(getThread(s.thread.id).sessionId, null);
  const last = frames.at(-1);
  assert.equal(last.type, 'ask-error');
  assert.equal(last.message, 'claude exited with code 1: auth');
  assert.equal(last.errorClass, 'auth');
});

test('B-4 guard: an abort rejection NEVER enters the resume fallback', async () => {
  const s = seed();
  let n = 0;
  const { turn } = makeTurn(s, { resumeSessionId: 'live-sid' }, {
    runClaudeImpl: async () => {
      n += 1;
      const err = new Error('aborted'); err.name = 'AbortError';
      throw err;                                   // pre-aborted shape: no init seen either
    },
  });
  turn.stop();
  const out = await turn.run();
  assert.equal(out.status, 'stopped');
  assert.equal(n, 1, 'no retry on abort even though !sawInit && resumeSessionId');
});

test('healthy-session failure does NOT retry (narrow predicate)', async () => {
  const s = seed();
  updateThread(s.thread.id, { sessionId: 'live-sid' });   // observable non-clear
  let n = 0;
  const { turn } = makeTurn(s, { resumeSessionId: 'live-sid' }, {
    runClaudeImpl: async (opts) => {
      n += 1;
      opts.onEvent({ type: 'system', raw: { type: 'system', subtype: 'init', session_id: 'live-sid' } });
      throw new Error('claude exited with code 1: network blip');
    },
  });
  await turn.run();
  assert.equal(n, 1, 'sawInit && no no-conversation error → plain failure, session kept');
  assert.equal(getThread(s.thread.id).sessionId, 'live-sid');
});

test('title: fires on the first turn with the R-D + dontAsk option set; rename guard wins', async () => {
  const s = seed();
  const titleCalls = [];
  const { turn, outOfTurn } = makeTurn(s, { firstTurn: true, firstText: 'hello there', deterministicTitle: 'hello there' }, {
    generateTitle: async (text, opts) => { titleCalls.push({ text, opts }); return 'Fable Title'; },
    runClaudeImpl: async (opts) => { push(opts.onEvent, RESULT()); return { text: 'x', exitCode: 0 }; },
  });
  setThreadTitle(s.thread.id, 'hello there');   // stamp the deterministic title like the route does
  await turn.run();
  await turn.titlePromise;
  assert.equal(titleCalls.length, 1);
  assert.equal(titleCalls[0].text, 'hello there');
  const o = titleCalls[0].opts;
  assert.deepEqual(o.tools, []);
  assert.equal(o.strictMcpConfig, true);
  assert.deepEqual(o.settingSources, ['project']);
  assert.equal(o.disableSlashCommands, true);
  assert.equal(o.envScrub, true);
  assert.deepEqual(o.envAllowlist, []);
  assert.equal(o.permissionMode, 'dontAsk');
  assert.equal(o.signal, undefined, 'no signal — fires after ANY terminal, incl. a stop that aborted the controller');
  assert.equal(getThread(s.thread.id).title, 'Fable Title');
  assert.deepEqual(outOfTurn, [{ type: 'ask-title', title: 'Fable Title' }]);
});

test('title suppressed when the user renamed mid-generation; not fired on later turns', async () => {
  const s = seed();
  let release;
  const gate = new Promise((r) => { release = r; });
  const { turn, outOfTurn } = makeTurn(s, { firstTurn: true, firstText: 'hi', deterministicTitle: 'hi' }, {
    generateTitle: () => gate.then(() => 'Late Title'),
    runClaudeImpl: async (opts) => { push(opts.onEvent, RESULT()); return { text: 'x', exitCode: 0 }; },
  });
  setThreadTitle(s.thread.id, 'hi');
  await turn.run();
  setThreadTitle(s.thread.id, 'User Named It');       // PATCH landed while haiku ran
  release();
  await turn.titlePromise;
  assert.equal(getThread(s.thread.id).title, 'User Named It');
  assert.equal(outOfTurn.length, 0, 'suppressed frame');

  const s2 = seed();
  const calls = [];
  const { turn: t2 } = makeTurn(s2, { firstTurn: false }, {
    generateTitle: async () => { calls.push(1); return 'X'; },
    runClaudeImpl: async (opts) => { push(opts.onEvent, RESULT()); return { text: 'x', exitCode: 0 }; },
  });
  await t2.run();
  await t2.titlePromise;
  assert.equal(calls.length, 0, 'no title call on non-first turns');
});

test('deleted thread mid-turn: terminal write is harmless, run() still resolves', async () => {
  const s = seed();
  const { turn } = makeTurn(s, {}, {
    runClaudeImpl: async (opts) => {
      deleteThread(s.thread.id);                      // user deleted while streaming
      push(opts.onEvent, RESULT());
      return { text: 'x', exitCode: 0 };
    },
  });
  const out = await turn.run();
  assert.equal(out.status, 'done');                   // finishMessage/addThreadTotals hit no rows, swallowed
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test test/ask-turn.test.mjs`
Expected: FAIL — `Cannot find module '../src/core/ask/turn.mjs'`.
- [ ] **Step 3: Implement `src/core/ask/turn.mjs`**

```js
// src/core/ask/turn.mjs
// One Ask Worca turn: spawn `claude -p` through the P1 sandbox recipe, feed
// every event to the P1 reducer, persist the assistant message, and emit bare
// ask-* frames through deps.onFrame (the SERVER stamps {threadId, messageId,
// seq} — spec §17 contract). run() NEVER throws; stop() aborts. One instance
// owns one turn INCLUDING the §6.2.7 resume retry (fresh reducer per attempt,
// one AbortController + one 15-minute wall clock spanning both attempts).
// Shape: agent-gen.mjs (EventEmitter, terminal latch, finally cleanup).
// Binding rules enforced here: R-A (settle-before-finish, persist card/notice
// mid-turn), R-C (rejection classification, abort branch FIRST — the runner
// throws a synchronous AbortError before any init when pre-aborted), R-F
// (turn.mock rides EVERY attempt), R-G (spawn wiring: scratch dir, RAW home
// base, per-message mcp json deleted in finally), R-D + B-1 (title call:
// hardened options + permissionMode 'dontAsk', no signal).
import { EventEmitter } from 'node:events';
import { join, dirname, resolve as pathResolve } from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';

import { runClaude } from '../claude-runner.mjs';
import { resolveModelEnv } from '../config.mjs';
import { worcaHome } from '../projects.mjs';
import { generateTitle } from '../title.mjs';
import { createTurnReducer } from './events.mjs';
import { buildAskSpawnOptions, buildMcpConfig, ASK_MCP_SERVER_PATH } from './spawn.mjs';
import { validateProposal } from './proposal.mjs';
import { askLimits, ASK_LIMITS } from './limits.mjs';
import {
  newAskId, finishMessage, setMessageBlocks, addThreadTotals, updateThread, setThreadTitle,
} from './store.mjs';

export function createAskTurn(opts) { return new AskTurn(opts); }

const TERMINAL = new Set(['done', 'stopped', 'error']);

class AskTurn extends EventEmitter {
  constructor({
    threadId, assistantMessageId, userMessageId,
    prompt, systemPrompt, restoredPrompt = '',
    model, effort, resumeSessionId = null,
    firstTurn = false, firstText = '', deterministicTitle = null,
    mock = null, attachmentNames = {},
    deps = {},
  } = {}) {
    super();
    this.threadId = threadId;
    this.assistantMessageId = assistantMessageId;
    this.userMessageId = userMessageId;
    this.prompt = prompt;
    this.systemPrompt = systemPrompt;
    this.restoredPrompt = restoredPrompt;
    this.model = model;
    this.effort = effort;
    this.resumeSessionId = resumeSessionId || null;
    this.firstTurn = !!firstTurn;
    this.firstText = firstText;
    this.deterministicTitle = deterministicTitle ?? null;
    this.mock = mock || null;
    this.attachmentNames = attachmentNames || {};
    this.deps = {
      runClaudeImpl: deps.runClaudeImpl ?? runClaude,
      store: {
        finishMessage, setMessageBlocks, addThreadTotals, updateThread, setThreadTitle,
        ...(deps.store || {}),
      },
      validateProposal: deps.validateProposal ?? validateProposal,
      generateTitle: deps.generateTitle ?? generateTitle,
      askLimits: deps.askLimits ?? askLimits,
      limits: deps.limits ?? ASK_LIMITS,
      resolveModelEnv: deps.resolveModelEnv ?? resolveModelEnv,
      worcaHome: deps.worcaHome ?? worcaHome,
      buildMcpConfig: deps.buildMcpConfig ?? buildMcpConfig,
      serverPath: deps.serverPath ?? ASK_MCP_SERVER_PATH,
      newAskId: deps.newAskId ?? newAskId,
      now: deps.now ?? Date.now,
      // Default timers unref so a 15-minute clock never holds the process open
      // (orchestrator.mjs:2627 _backoff precedent). Tests inject both.
      setTimeout: deps.setTimeout ?? ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }),
      clearTimeout: deps.clearTimeout ?? ((t) => clearTimeout(t)),
      fs: deps.fs ?? { mkdir, writeFile, unlink },
      onFrame: deps.onFrame ?? (() => {}),
      onOutOfTurn: deps.onOutOfTurn ?? (() => {}),
    };
    this.abort = new AbortController();
    this.status = 'created';
    this.timedOut = false;
    this.stopping = false;
    this.reducer = null;
    this.sessionId = this.resumeSessionId;
    this.scratchDir = null;
    this.titlePromise = Promise.resolve();
    this._completed = false;
  }

  stop() {
    if (TERMINAL.has(this.status)) return;
    this.stopping = true;
    try { this.abort.abort(); } catch { /* ignore */ }
  }

  _frame(frame) {
    try { this.deps.onFrame(frame); } catch { /* a broken sink must not break the turn */ }
  }

  _persistBlocks() {
    // R-A: the card (and every mid-turn notice) must survive a server restart
    // and be visible to findCard/updateCardBlock while the turn streams.
    try { this.deps.store.setMessageBlocks(this.assistantMessageId, this.reducer.snapshot().blocks); }
    catch { /* thread may be gone — the terminal write is equally guarded */ }
  }

  async _onProposal(input) {
    const d = this.deps;
    const cardId = d.newAskId('card');
    try {
      const r = await d.validateProposal(input && typeof input === 'object' ? input : {}, { cardId });
      if (r && r.ok) {
        this.reducer.addBlock({ kind: 'card', id: cardId, state: 'proposed', card: r.card });
      } else {
        const errors = (r && Array.isArray(r.errors) && r.errors.length) ? r.errors : ['invalid proposal'];
        this.reducer.addBlock({ kind: 'notice', text: `Proposal rejected: ${errors.join('; ')}` });
      }
    } catch (err) {
      this.reducer.addBlock({ kind: 'notice', text: `Proposal rejected: ${err?.message || err}` });
    }
    this._persistBlocks();
  }

  _makeReducer() {
    const d = this.deps;
    this.reducer = createTurnReducer({
      onFrame: (f) => this._frame(f),
      now: d.now,
      setTimeout: d.setTimeout,
      clearTimeout: d.clearTimeout,
      attachmentNames: this.attachmentNames,
      limits: d.limits,
      onProposal: ({ input }) => this._onProposal(input),
    });
    return this.reducer;
  }

  async _settle() {
    // R-A verbatim: settle() has no timeout of its own — race it against the
    // turn's abort so a hung proposal hook cannot wedge the terminal write.
    const aborted = new Promise((res) => {
      if (this.abort.signal.aborted) return res();
      this.abort.signal.addEventListener('abort', () => res(), { once: true });
    });
    await Promise.race([this.reducer.settle(), aborted]);
  }

  /**
   * The single terminal writer — called exactly once per run().
   * kind 'done'  → ask-done{status:'done'|'stopped', reason?}
   * kind 'error' → ask-error{message, errorClass?} with message status 'error'.
   * The §6.2.8 costUsd:null rule needs no plumbing here: the P1 reducer sets
   * lastResult and sawResult together, so summary.costUsd is ALREADY null
   * whenever no `result` frame arrived (pinned by test/ask-events.test.mjs).
   */
  async _complete({ kind, status, reason = null, message = null, errorClass = undefined }) {
    if (this._completed) return { status: this.status };
    this._completed = true;
    const d = this.deps;
    await this._settle();
    const summary = this.reducer.finish();
    const finalStatus = kind === 'error' ? 'error' : status;
    const costUsd = summary.costUsd;
    // Persist BEFORE broadcasting: a client re-fetch on the terminal frame must
    // never see a still-streaming row. finishMessage gets the FULL patch (B-5).
    try {
      d.store.finishMessage(this.assistantMessageId, {
        text: summary.text, blocks: summary.blocks, status: finalStatus, reason,
        usage: summary.usage, costUsd, durationMs: summary.durationMs,
      });
    } catch { /* deleted thread — the frames still settle the UI */ }
    let threadTotals = null;
    try {
      threadTotals = d.store.addThreadTotals(this.threadId, {
        costUsd, usage: summary.usage, agents: summary.agents,
      });
    } catch { /* deleted thread */ }
    this.status = finalStatus;
    if (summary.reducerErrors) {
      console.warn(`[worca-ask] turn ${this.assistantMessageId}: ${summary.reducerErrors} reducer error(s) absorbed`);
    }
    if (kind === 'error') {
      this._frame({ type: 'ask-error', message: message || 'unknown error', ...(errorClass !== undefined ? { errorClass } : {}) });
      this.emit('error', { message: message || 'unknown error' });
    } else {
      this._frame({
        type: 'ask-done', text: summary.text, blocks: summary.blocks, usage: summary.usage,
        costUsd, durationMs: summary.durationMs, model: this.model, status: finalStatus,
        ...(reason ? { reason } : {}), threadTotals,
      });
      this.emit('done', { status: finalStatus, reason });
    }
    return { status: finalStatus };
  }

  _limitNotice(reason, limitsNow) {
    const text = reason === 'max_budget'
      ? `Stopped: reached the $${limitsNow.maxBudgetUsd} per-turn cap (Settings → Ask Worca)`
      : `Stopped: reached the ${limitsNow.maxTurns}-turn limit (Settings → Ask Worca)`;
    this.reducer.addBlock({ kind: 'notice', text });
    this._persistBlocks();
  }

  async run() {
    if (this.status !== 'created') return { status: this.status };
    this.status = 'running';
    const d = this.deps;
    this._makeReducer();
    this._frame({
      type: 'ask-start', userMessageId: this.userMessageId,
      model: this.model, effort: this.effort, startedAt: new Date(d.now()).toISOString(),
    });
    let timer = null;
    let mcpConfigPath = null;
    let out;
    try {
      // R-G: ONE scratch dir for all threads, RAW home base (never worcaHome()
      // itself — it already ends in /.worca-cc), per-message config json.
      const scratchDir = join(d.worcaHome(), 'tmp', 'ask');
      this.scratchDir = scratchDir;
      await d.fs.mkdir(scratchDir, { recursive: true });
      const homeBase = process.env.WORCA_HOME?.trim()
        ? pathResolve(process.env.WORCA_HOME)
        : dirname(d.worcaHome());
      mcpConfigPath = join(scratchDir, `mcp-${this.assistantMessageId}.json`);
      await d.fs.writeFile(
        mcpConfigPath,
        JSON.stringify(d.buildMcpConfig({ homeBase, threadId: this.threadId, serverPath: d.serverPath }), null, 2),
        'utf8',
      );
      // One 15-minute budget for the whole turn, retry included. The timedOut
      // flag and abort() run in ONE synchronous callback, so R-C always reads
      // the flag set (the awaiting continuation resumes a microtask later);
      // flag-first is kept as defensive style (plugin-shim.mjs:164 precedent).
      timer = d.setTimeout(() => { this.timedOut = true; try { this.abort.abort(); } catch { /* ignore */ } }, d.limits.turnTimeoutMs);
      const limitsNow = d.askLimits(); // D12: read fresh every turn
      out = await this._attempts(limitsNow, mcpConfigPath, scratchDir);
    } catch (err) {
      // Backstop for a deps failure (mkdir/write) — _attempts itself never throws.
      out = await this._complete({ kind: 'error', message: err?.message || String(err) });
    } finally {
      if (timer != null) d.clearTimeout(timer);
      if (mcpConfigPath) await d.fs.unlink(mcpConfigPath).catch(() => {});
    }
    this._kickoffTitle();
    return out;
  }

  async _attempts(limitsNow, mcpConfigPath, scratchDir) {
    const d = this.deps;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const isRetry = attempt === 2;
      if (isRetry) {
        this._makeReducer(); // fresh reducer; the dead attempt's reducer is discarded unfinished
        // Deliberate deviation from §6.2.7's ordering (which posts the notice
        // after a successful restore): the notice is added EAGERLY so it is
        // visible while the retry streams (R-A persistence below). If the retry
        // then fails, the notice stays above the ask-error — acceptable, and
        // recorded in the Clarifications Q&A.
        this.reducer.addBlock({ kind: 'notice', text: 'Context restored from history' });
        this._persistBlocks();
      }
      const options = buildAskSpawnOptions({
        thread: { id: this.threadId, sessionId: isRetry ? null : this.resumeSessionId }, // B-7: the only no-resume lever
        turn: {
          prompt: isRetry ? this.restoredPrompt : this.prompt,
          systemPrompt: this.systemPrompt,
          model: this.model,
          effort: this.effort,
          modelEnv: d.resolveModelEnv(this.model),
          mock: this.mock, // R-F: markers on EVERY attempt
          signal: this.abort.signal,
          onEvent: (e) => {
            if (e && e.type === 'session' && typeof e.sessionId === 'string' && e.sessionId) {
              // §6.2.4: stored on the thread immediately, not at turn end.
              this.sessionId = e.sessionId;
              try { d.store.updateThread(this.threadId, { sessionId: e.sessionId }); } catch { /* deleted thread */ }
            }
            this.reducer.push(e);
          },
        },
        limits: limitsNow,
        mcpConfigPath,
        scratchDir,
      });
      try {
        await d.runClaudeImpl(options);
        // Resolve path. Future-proofing: if a later CLI exits 0 on a limit,
        // the reducer still computed status/reason from the result subtype.
        await this._settle();
        const s = this.reducer.snapshot();
        if (/max_turns|max_budget/.test(s.resultSubtype ?? '')) this._limitNotice(s.reason, limitsNow);
        return await this._complete({ kind: 'done', status: s.reason ? 'stopped' : 'done', reason: s.reason ?? null });
      } catch (err) {
        const s = this.reducer.snapshot();
        // R-C, literal order. (1) The abort branch FIRST — B-4: a pre-aborted
        // runClaude throws before any init, so this must precede the resume test.
        if (err?.name === 'AbortError') {
          // costUsd falls out of the reducer: no `result` seen ⇒ summary.costUsd
          // is null (spec §6.2.8); a result that DID land before the abort keeps
          // its real cost.
          if (this.timedOut) {
            return await this._complete({ kind: 'error', message: 'timed out after 15 min' });
          }
          return await this._complete({ kind: 'done', status: 'stopped', reason: 'user' });
        }
        // (2) The per-turn limits — F5: exit 1, classify from the reducer.
        if (/max_turns|max_budget/.test(s.resultSubtype ?? '')) {
          this._limitNotice(s.reason, limitsNow);
          return await this._complete({ kind: 'done', status: 'stopped', reason: s.reason });
        }
        // (3) The narrow resume-fallback predicate (F9): only a session that
        // never produced an init or said "No conversation found".
        if (!isRetry && this.resumeSessionId
          && (!s.sawInit || s.errors.some((m) => /No conversation found/.test(m)))) {
          continue;
        }
        // (4) Everything else is a turn failure.
        if (isRetry) {
          try { d.store.updateThread(this.threadId, { sessionId: null }); } catch { /* deleted */ }
        }
        return await this._complete({
          kind: 'error',
          message: err?.message || String(err),
          errorClass: err?.errorClass ?? undefined,
        });
      }
    }
    /* c8 ignore next */
    return { status: this.status };
  }

  _kickoffTitle() {
    if (!this.firstTurn) return;
    const d = this.deps;
    // Fire-and-forget after ANY terminal status of the first turn (§7.4).
    // Stored for test determinism, never awaited by run() (orchestrator.mjs:3821).
    // NO signal: after a user stop this.abort is already aborted and would kill
    // the call before it spawns. permissionMode 'dontAsk' is the B-1 fix.
    this.titlePromise = Promise.resolve()
      .then(() => d.generateTitle(this.firstText, {
        cwd: this.scratchDir || join(d.worcaHome(), 'tmp', 'ask'),
        tools: [], strictMcpConfig: true, settingSources: ['project'],
        disableSlashCommands: true, envScrub: true, envAllowlist: [],
        permissionMode: 'dontAsk',
      }))
      .then((title) => {
        if (!title || title === this.deterministicTitle) return;
        // setThreadTitle's onlyIf is the rename guard: a PATCHed or deleted
        // thread makes the UPDATE match 0 rows and the frame is suppressed.
        let applied = false;
        try { applied = d.store.setThreadTitle(this.threadId, title, { onlyIf: this.deterministicTitle }); }
        catch { /* deleted thread */ }
        if (applied) {
          try { d.onOutOfTurn({ type: 'ask-title', title }); } catch { /* sink */ }
        }
      })
      .catch(() => { /* generateTitle already swallows; final backstop */ });
  }
}
```

- [ ] **Step 4: Run to verify green**

Run: `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test test/ask-turn.test.mjs`
Expected: PASS (15/15) — and stable across repeats (the dry run held 5/5 consecutive green runs; the two `setImmediate` awaits in the card fake are the determinism knob).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: **3198 pass / 0 fail** (3183 + 15).

- [ ] **Step 6: Commit**

```bash
git add src/core/ask/turn.mjs test/ask-turn.test.mjs
git commit -m "worca ask: AskTurn engine (R-A/R-C/R-F/R-G, resume retry, title kickoff)"
```

---
### Task 5: `askJobs` registry, WS, boot sweeps, thread/model/attachment routes

**Files:**
- Modify: `ui/server.mjs` (imports; registry section; WS hunks at the connection handler ~`:207-257`; `bootMaintenance` ~`:3580-3636`; a new `/api/ask` route section between the guardrails block and `/api/agents*` ~`:2820`; `_testing` tail)
- Test: `test/ask-api-threads.test.mjs`

**Interfaces:**
- Consumes: everything Task 4 produced plus the P1 store/models modules; the WS plumbing facts (hello at ~`:234`, the subscribe handler at ~`:242-256`, flat `sockets` broadcast).
- Produces: `askJobs`/`askFollowers` Maps + `askInFlight`/`askRunningCount`/`askHello`/`replayAskJob`/`stampAskFrames` helpers (Task 6/7 consume them); routes `GET/POST /api/ask/threads`, `GET/PATCH/DELETE /api/ask/threads/:id`, `GET /api/ask/threads/:id/attachments/:attId`, `GET /api/ask/models`; `hello.ask`; `bootMaintenance().ask`; `_testing.askJobs`, `_testing.askFollowers`.

- [ ] **Step 1: Write the failing test**

```js
// test/ask-api-threads.test.mjs
// Thread CRUD + models + attachment download + hello.ask + boot sweeps.
// Boot = the agentgen-api recipe (temp home BEFORE the dynamic import; listen
// on the MODULE server so /ws upgrades work).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let homeDir, srv, base, wsBase, mod, prevHome;
const JSONH = { 'Content-Type': 'application/json' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askthreads-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
  if (srv) {
    // A RED WS test never reaches ws.close(), and an upgraded socket is NOT
    // destroyed by closeAllConnections() — server.close()'s callback then never
    // fires and the file hangs in teardown. Bound the wait so the failures
    // actually print (pair the red run with --test-force-exit).
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
});

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const patch = (p, body) => fetch(`${base}${p}`, { method: 'PATCH', headers: JSONH, body: JSON.stringify(body) });
const del = (p) => fetch(`${base}${p}`, { method: 'DELETE' });

test('POST creates a thread; the list shows it with runLinks count and inFlight:false', async () => {
  const r = await post('/api/ask/threads', {});
  assert.equal(r.status, 201);
  const { thread } = await r.json();
  assert.match(thread.id, /^ask_[0-9a-f]{8}$/);
  assert.equal(thread.title, null);
  const list = await (await fetch(`${base}/api/ask/threads`)).json();
  const row = list.threads.find((t) => t.id === thread.id);
  assert.ok(row);
  assert.equal(row.runLinks, 0);
  assert.equal(row.inFlight, false);
});

test('POST with a title stores the trimmed title; over-long is a 400', async () => {
  const r = await post('/api/ask/threads', { title: '  My chat  ' });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).thread.title, 'My chat');
  const bad = await post('/api/ask/threads', { title: 'x'.repeat(121) });
  assert.equal(bad.status, 400);
});

test('GET one: 400 on shape, 404 on unknown, snapshot envelope on hit', async () => {
  assert.equal((await fetch(`${base}/api/ask/threads/nope`)).status, 400);
  assert.equal((await fetch(`${base}/api/ask/threads/ask_ffffffff`)).status, 404);
  const { thread } = await (await post('/api/ask/threads', {})).json();
  const snap = await (await fetch(`${base}/api/ask/threads/${thread.id}`)).json();
  assert.deepEqual(Object.keys(snap).sort(), ['attachments', 'inFlight', 'messages', 'runLinks', 'thread']);
  assert.deepEqual(snap.messages, []);
  assert.equal(snap.inFlight, null);
});

test('PATCH renames within 120 chars; empty and unknown rejected', async () => {
  const { thread } = await (await post('/api/ask/threads', {})).json();
  assert.equal((await patch(`/api/ask/threads/${thread.id}`, { title: '' })).status, 400);
  assert.equal((await patch(`/api/ask/threads/${thread.id}`, { title: 'y'.repeat(121) })).status, 400);
  assert.equal((await patch('/api/ask/threads/ask_ffffffff', { title: 'x' })).status, 404);
  const ok = await patch(`/api/ask/threads/${thread.id}`, { title: 'Renamed' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).thread.title, 'Renamed');
});

test('DELETE removes rows and the attachment directory; unknown is 404', async () => {
  assert.equal((await del('/api/ask/threads/ask_ffffffff')).status, 404);
  const store = await import('../src/core/ask/store.mjs');
  const thread = store.createThread();
  const msg = store.appendMessage(thread.id, { role: 'user', text: 'x' });
  store.addAttachment(thread.id, msg.id, { name: 'n.md', text: 'hello' });
  const dir = store.attachmentsDir(thread.id);
  assert.ok(existsSync(dir));
  const r = await del(`/api/ask/threads/${thread.id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal((await fetch(`${base}/api/ask/threads/${thread.id}`)).status, 404);
  assert.ok(!existsSync(dir));
});

test('?limit clamps the list', async () => {
  for (let i = 0; i < 3; i += 1) await post('/api/ask/threads', {});
  const j = await (await fetch(`${base}/api/ask/threads?limit=2`)).json();
  assert.equal(j.threads.length, 2);
});

test('attachment download: text/plain + nosniff + inline; wrong thread 404; bad shape 400', async () => {
  const store = await import('../src/core/ask/store.mjs');
  const thread = store.createThread();
  const msg = store.appendMessage(thread.id, { role: 'user', text: 'x' });
  const att = store.addAttachment(thread.id, msg.id, { name: 'n.md', text: 'hello body' });
  const other = store.createThread();
  const r = await fetch(`${base}/api/ask/threads/${thread.id}/attachments/${att.id}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/plain/i);
  assert.match(r.headers.get('content-type') || '', /utf-8/i);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-disposition') || '', /inline/);
  assert.equal(await r.text(), 'hello body');
  assert.equal((await fetch(`${base}/api/ask/threads/${other.id}/attachments/${att.id}`)).status, 404);
  assert.equal((await fetch(`${base}/api/ask/threads/${thread.id}/attachments/zzz`)).status, 400);
});

test('GET /api/ask/models returns the chat catalog', async () => {
  const j = await (await fetch(`${base}/api/ask/models`)).json();
  assert.ok(Array.isArray(j.models) && j.models.length > 0);
  assert.ok(Array.isArray(j.efforts) && j.efforts.includes('high'));
  const entry = j.models.find((m) => /opus/i.test(m.id));
  assert.ok(entry, 'a predefined opus id survives the filter');
  assert.ok(Array.isArray(entry.efforts));
  assert.ok(entry.custom === false || entry.custom === 'global');
});

test('hello carries an ask array; a threadId subscribe for an unknown thread is a no-op', async () => {
  const msgs = [];
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  await new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      if (msgs.some((m) => m.type === 'hello')) return res();
      if (Date.now() - t0 > 4000) return rej(new Error('no hello'));
      setTimeout(tick, 15);
    })();
  });
  const hello = msgs.find((m) => m.type === 'hello');
  assert.ok(Array.isArray(hello.ask));
  ws.send(JSON.stringify({ type: 'subscribe', threadId: 'ask_ffffffff' }));
  await new Promise((r) => setTimeout(r, 50));
  ws.close();
});

test('bootMaintenance sweeps streaming messages and reports the ask summary', async () => {
  const store = await import('../src/core/ask/store.mjs');
  const thread = store.createThread();
  store.appendMessage(thread.id, { role: 'user', text: 'q' });
  const asst = store.appendMessage(thread.id, { role: 'assistant', text: 'partial', status: 'streaming' });
  const summary = await mod.bootMaintenance();
  assert.equal(typeof summary.ask.interrupted, 'number');
  assert.ok(summary.ask.interrupted >= 1);
  assert.equal(typeof summary.ask.emptyThreads, 'number');
  const row = store.getMessage(asst.id);
  assert.equal(row.status, 'error');
  assert.ok(row.blocks.some((b) => b.kind === 'notice' && /interrupted by restart/.test(b.text)));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test --test-force-exit test/ask-api-threads.test.mjs`
Expected: FAIL — every `/api/ask/*` fetch returns the SPA shell/404 (routes missing), `hello.ask` is `undefined`, `summary.ask` is `undefined`. (`--test-force-exit` on RED runs only — with routes missing the WS sockets never close and the bounded teardown alone cannot exit the process.)

- [ ] **Step 3: Implement the server hunks**

**Hunk A — imports.** Two parts (dry-run-verified: none of the 38 new bindings collide with an existing name, and every one is referenced by the end of Task 7).

A-1: `lookupPipelineRow` and `findPipelineRowById` are **NOT yet imported** (they appear nowhere in `ui/server.mjs` at `1b02d87b`). There are already TWO artifacts imports at base — extend the **FIRST** one (the multi-line block at `:22-27` ending `listArtifacts,` at `:26`), NOT the single-line `listWorkspacePipelines` import at `:71`, and do not add a third; its last specifiers then read:

```js
  listArtifacts, lookupPipelineRow, findPipelineRowById,
} from '../src/core/artifacts.mjs';
```

(`listProjects`, `readWorkspace`, `worcaHome` and `fileURLToPath` are already imported — `:29`, `:17` — and stay untouched.)

A-2: below the existing `src/core/settings.mjs` import block (`:30-37`) add:

```js
import {
  ASK_ID_RE, createThread as askCreateThread, getThread as askGetThread,
  listThreads as askListThreads, updateThread as askUpdateThread,
  deleteThread as askDeleteThread, sweepEmptyThreads, sweepStreamingMessages,
  appendMessage as askAppendMessage, getMessage as askGetMessage,
  listMessages as askListMessages, setMessageBlocks as askSetMessageBlocks,
  findCard as askFindCard, updateCardBlock as askUpdateCardBlock,
  addAttachment as askAddAttachment, listAttachments as askListAttachments,
  readAttachmentText as askReadAttachmentText, threadAttachmentBytes as askThreadAttachmentBytes,
  linkRun as askLinkRun, updateRunLink as askUpdateRunLink, listRunLinks as askListRunLinks,
  setThreadTitle as askSetThreadTitle, finishMessage as askFinishMessage,
} from '../src/core/ask/store.mjs';
import { sanitizeTitle as askSanitizeTitle } from '../src/core/title.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { askCatalog, validateModelEffort } from '../src/core/ask/models.mjs';
import { buildCatalog as askBuildCatalog } from '../src/core/ask/catalog.mjs';
import {
  buildSystemPrompt as askBuildSystemPrompt, buildContextHeader as askBuildContextHeader,
  buildTurnPrompt as askBuildTurnPrompt, buildRestoredPrompt as askBuildRestoredPrompt,
  selectInlineAttachments as askSelectInlineAttachments, validateClientContext,
} from '../src/core/ask/prompt.mjs';
import { createAskTurn } from '../src/core/ask/turn.mjs';
import { attachRunFollower } from '../src/core/ask/follow.mjs';
import { mockEnabled } from '../src/core/claude-runner.mjs';
```

(The `ask*` aliases keep the file's existing `getThread`-free namespace unambiguous. Tasks 6–7 use the rest of these imports; an unused binding in the interim is fine.)

**Hunk B — registry + helpers.** New banner section directly after the guardrails routes end, before the `/api/agents*` banner (~`:2823`):

```js
// ---------------------------------------------------------------------------
// Ask Worca (ask-worca-design.md §8). askJobs is SEPARATE from the runs Map —
// the client's Running badge counts runs entries, and a thread id is the
// subscription key (§8.3). No store/home access at import time (the chatCtx
// rule): the Maps are bare and every store call lives inside a handler or
// bootMaintenance.
// ---------------------------------------------------------------------------
const askJobs = new Map();      // threadId -> {turn, messageId, userMessageId, events, seq, status, startedAt, graceTimer}
const askFollowers = new Map(); // threadId -> Set<{detach}>
const ASK_JOB_MAX_BUFFER = 5000; // same arithmetic as MAX_BUFFER: deltas dominate; eviction ⇒ client seq-gap re-sync

function askInFlight(threadId) {
  const job = askJobs.get(threadId);
  return job && job.status === 'running' ? job : null;
}

function askRunningCount() {
  let n = 0;
  for (const job of askJobs.values()) if (job.status === 'running') n += 1;
  return n;
}

/** hello payload: running turns only (§8.2). A job whose slot was just
 *  reserved (messageId still null — the message route's atomic reservation,
 *  Task 6) is skipped: it becomes visible once its assistant row exists. */
function askHello() {
  const out = [];
  for (const [threadId, job] of askJobs.entries()) {
    if (job.status === 'running' && job.messageId) out.push({ threadId, messageId: job.messageId });
  }
  return out;
}

/** Replay a job's stamped ring buffer to one socket. No state snapshot — the
 *  REST thread GET is the snapshot; the client dedupes by seq (§6.6). */
function replayAskJob(ws, job) {
  for (const ev of job.events) send(ws, ev);
}

/** The stamping closure (§17: reducer frames are BARE; the server stamps).
 *  Shared by the turn's own ask-start/ask-done/ask-error and every reducer
 *  frame, so ALL job frames are buffered, replayed and seq-ordered alike. */
function stampAskFrames(threadId, job) {
  return (bare) => {
    const frame = { ...bare, threadId, messageId: job.messageId, seq: ++job.seq };
    job.events.push(frame);
    if (job.events.length > ASK_JOB_MAX_BUFFER) job.events.splice(0, job.events.length - ASK_JOB_MAX_BUFFER);
    broadcast(frame);
  };
}

/** 400 on shape (spec §8.1 — a DELIBERATE divergence from the house 404-on-
 *  malformed-param style), null-return contract like badRequest. */
function askIdParam(res, value, kind) {
  if (typeof value !== 'string' || !ASK_ID_RE.test(value)) {
    res.status(400).json({ error: `invalid ${kind} id` });
    return null;
  }
  return value;
}
```

**Hunk C — WS.** Three edits in the connection handler:

1. Query parse (declarations start ~`:219`, the `const id = …` line ~`:232`): add `requestedThreadId` next to the other three:
```js
  let requestedThreadId = null;
```
inside the `try`: `requestedThreadId = u.searchParams.get('threadId');` (and `null` it in the `catch`).
2. The hello line (~`:234`):
```js
  send(ws, { type: 'hello', runs: summarizeRuns(), ask: askHello() });
```
3. After the `if (id && runs.has(id)) { replayEntry(ws, runs.get(id)); }` block:
```js
  if (requestedThreadId && askJobs.has(requestedThreadId)) {
    replayAskJob(ws, askJobs.get(requestedThreadId));
  }
```
4. In the message handler, after the existing `subId` block (~`:252-255`) — a PARALLEL branch, never merged into the `runs` lookup:
```js
    const askThreadId = msg && msg.type === 'subscribe' && typeof msg.threadId === 'string' ? msg.threadId : null;
    if (askThreadId && askJobs.has(askThreadId)) {
      replayAskJob(ws, askJobs.get(askThreadId));
    }
```

**Hunk D — thread/model/attachment routes** (inside the new section from Hunk B):

```js
app.get('/api/ask/threads', (req, res) => {
  try {
    const raw = Number.parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 200) : 50;
    const threads = askListThreads({ limit }).map((t) => ({ ...t, inFlight: !!askInFlight(t.id) }));
    res.json({ threads });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/ask/threads', (req, res) => {
  try {
    const body = req.body || {};
    let title = null;
    if (body.title !== undefined && body.title !== null && body.title !== '') {
      if (typeof body.title !== 'string' || body.title.length > 120) {
        return badRequest(res, 'title must be a string of at most 120 characters');
      }
      title = body.title.trim() || null;
    }
    const thread = askCreateThread();
    if (title) askUpdateThread(thread.id, { title });
    res.status(201).json({ thread: askGetThread(thread.id) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/ask/threads/:id', (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  try {
    const thread = askGetThread(id);
    if (!thread) return res.status(404).json({ error: 'thread not found' });
    const job = askInFlight(id);
    res.json({
      thread,
      messages: askListMessages(id),
      attachments: askListAttachments(id),
      runLinks: askListRunLinks(id),
      inFlight: job && job.messageId ? { messageId: job.messageId } : null, // null while the slot is only reserved
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.patch('/api/ask/threads/:id', (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  try {
    const raw = (req.body || {}).title;
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 120) {
      return badRequest(res, 'title must be a non-empty string of at most 120 characters');
    }
    const thread = askUpdateThread(id, { title: raw.trim() });
    if (!thread) return res.status(404).json({ error: 'thread not found' });
    res.json({ thread });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// §7.5 order: abort the in-flight turn -> detach followers -> delete the row
// (tx + cascades) + rm -rf inside deleteThread -> drop the job entry.
app.delete('/api/ask/threads/:id', (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  try {
    if (!askGetThread(id)) return res.status(404).json({ error: 'thread not found' });
    const job = askJobs.get(id);
    if (job && job.turn && typeof job.turn.stop === 'function') {
      try { job.turn.stop(); } catch { /* best-effort */ }
    }
    const followers = askFollowers.get(id);
    if (followers) {
      for (const f of [...followers]) {
        try { f.detach(); } catch { /* best-effort */ }
      }
      askFollowers.delete(id);
    }
    askDeleteThread(id);
    if (job) {
      if (job.graceTimer) clearTimeout(job.graceTimer);
      askJobs.delete(id);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/ask/threads/:id/attachments/:attId', (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  const attId = askIdParam(res, req.params.attId, 'attachment');
  if (!attId) return;
  try {
    if (!askGetThread(id)) return res.status(404).json({ error: 'thread not found' });
    const att = askReadAttachmentText(id, attId);
    if (!att) return res.status(404).json({ error: 'attachment not found' });
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', 'inline');
    res.type('text/plain; charset=utf-8').send(att.text);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// D8/§8.1: the chat model catalog. Fresh per request (the /api/config
// precedent) — a cache would go stale against global-model edits.
app.get('/api/ask/models', async (_req, res) => {
  try {
    res.json(await askCatalog());
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});
```

**Hunk E — boot sweeps.** Inside `bootMaintenance()` (~`:3580`): extend the summary initialiser to `const summary = { reconciled: 0, runRoots: null, legacy: null, ask: null };` and append, after the legacy-worktrees step (each existing step is independent — the ask sweep goes last and follows the same try/catch + log voice):

```js
  // Ask Worca (§6.2): mark turns orphaned by a restart, sweep stale empty threads.
  try {
    const interrupted = sweepStreamingMessages();
    const emptyThreads = sweepEmptyThreads();
    summary.ask = { interrupted, emptyThreads };
    if (interrupted || emptyThreads) {
      console.log(`[worca-ui] ask sweep: ${interrupted} interrupted turn(s), ${emptyThreads} empty thread(s)`);
    }
  } catch (err) {
    summary.ask = { interrupted: 0, emptyThreads: 0 };
    console.error(`[worca-ui] ask sweep failed: ${err && err.message ? err.message : err}`);
  }
```

**Hunk F — `_testing`.** Extend the export object (~`:3679-3683`):

```js
  chatNotifier, resumeRun, resolveHljsAssets, resolveEsmAsset, askJobs, askFollowers,
```

- [ ] **Step 4: Run to verify green**

Run: `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test test/ask-api-threads.test.mjs`
Expected: PASS (10/10).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: **3208 pass / 0 fail** (3198 + 10). Watch the fences: `agentgen-api` (hello shape gained a key — its tests read `msg.runs`, not the whole frame, so they stay green — dry-run-confirmed), `scan-api`, `ui-server-stepper-seed`. A single `api-sources` ENOTEMPTY flake may appear once — re-run that file alone.

- [ ] **Step 6: Commit**

```bash
git add ui/server.mjs test/ask-api-threads.test.mjs
git commit -m "worca ask: askJobs registry, WS thread subscribe + hello.ask, boot sweeps, thread/model/attachment routes"
```

---
### Task 6: message POST + stop — the turn goes live

**Files:**
- Modify: `ui/server.mjs` (three additions inside the ask section: `resolveAskContext`, `mockAskCard`, the two routes)
- Test: `test/ask-api-messages.test.mjs`

**Interfaces:**
- Consumes: Task 5's registry + `stampAskFrames`; Task 4's `createAskTurn`; P1 prompt/models/store modules; `runs` Map + `listProjects`/`readWorkspace`/`lookupPipelineRow`/`findPipelineRowById` for server-side context resolution.
- Produces: `POST /api/ask/threads/:id/messages` (202/409/429/400/413/404), `POST /api/ask/threads/:id/stop`, `resolveAskContext(threadId, ctx, listed)` and `mockAskCard(ctx, text)` (Task 7's tests reuse the mock-card behaviour).

Mock-behaviour dependencies this task's tests lean on (all pinned by P1 tests): the `ask` mock role strips the `[worca context]…[/worca context]` block before picking a scenario AND before echoing, so the default answer is `[mock] <first line of the USER text>`; `MOCK_SLOW` inserts 300 ms between ~8+ frames; the mock session id is `mock-session-ask-1`; `MOCK_FAIL`/`MOCK_MAX_*` reject after their `result` frame (F5 mirror).

- [ ] **Step 1: Write the failing test**

```js
// test/ask-api-messages.test.mjs
// The live turn over WORCA_MOCK: frames to ask-done, 409/grace, 429, stop,
// attachments, the R-F route-level MOCK_ASK regression, mid-turn replay.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let homeDir, srv, base, wsBase, mod, prevHome;
const JSONH = { 'Content-Type': 'application/json' };
const MODEL = { model: 'claude-opus-5', effort: 'high' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askmsg-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  if (srv) {
    // A RED WS test never reaches ws.close(), and an upgraded socket is NOT
    // destroyed by closeAllConnections() — server.close()'s callback then never
    // fires and the file hangs in teardown. Bound the wait so the failures
    // actually print (pair the red run with --test-force-exit).
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
});

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const newThread = async () => (await (await post('/api/ask/threads', {})).json()).thread;
const snapshot = async (id) => (await fetch(`${base}/api/ask/threads/${id}`)).json();

function openWs(query = '') {
  const ws = new WebSocket(`${wsBase}${query}`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
function waitFor(pred, timeoutMs = 8000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      const v = pred();
      if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 15);
    })();
  });
}
// JOB frames only. The §17 contract splits ask-* into buffered job frames (they
// carry the per-job `seq`) and out-of-turn frames (ask-message / ask-title /
// ask-run-status — no seq, upserted by their own key). The user echo is an
// out-of-turn ask-message broadcast BEFORE the turn starts, so a bare
// type.startsWith('ask-') filter would put it at index 0 and break every
// ordering and seq-monotonic assertion below.
const framesFor = (msgs, threadId) => msgs.filter((m) => m.threadId === threadId
  && typeof m.type === 'string' && m.type.startsWith('ask-') && typeof m.seq === 'number');

test('validation: 404 unknown thread, 400 model/effort/context/text', async () => {
  assert.equal((await post('/api/ask/threads/ask_ffffffff/messages', { text: 'x', ...MODEL })).status, 404);
  const t = await newThread();
  assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'x', model: 'no-such-model', effort: 'high' })).status, 400);
  assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'x', model: 'claude-opus-5', effort: 'ultra' })).status, 400);
  assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'x', ...MODEL, context: { pipelineId: 'zz' } })).status, 400);
  assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: '   ', ...MODEL })).status, 400);
});

test('a full mock turn: 202, stamped frames to ask-done, persistence, session, title, echo', async () => {
  const t = await newThread();
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  const r = await post(`/api/ask/threads/${t.id}/messages`, { text: 'hi there', ...MODEL });
  assert.equal(r.status, 202);
  const { userMessageId, assistantMessageId } = await r.json();
  assert.match(userMessageId, /^askm_[0-9a-f]{8}$/);
  // §7.4: the deterministic title is stamped SYNCHRONOUSLY before the 202 —
  // read it NOW; after ask-done the fire-and-forget D13 title call replaces it.
  assert.equal((await snapshot(t.id)).thread.title, 'hi there',
    'deterministic title stamped by the message route');
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-done'));
  const frames = framesFor(msgs, t.id);
  assert.equal(frames[0].type, 'ask-start');
  assert.equal(frames[0].userMessageId, userMessageId);
  assert.equal(frames[0].messageId, assistantMessageId);
  for (let i = 1; i < frames.length; i += 1) {
    assert.equal(frames[i].seq, frames[i - 1].seq + 1, 'per-job monotonic seq');
  }
  const done = frames.at(-1);
  assert.equal(done.type, 'ask-done');
  assert.equal(done.status, 'done');
  assert.equal(done.threadTotals.turns, 1);
  const echo = msgs.find((m) => m.type === 'ask-message' && m.threadId === t.id);
  assert.ok(echo && echo.message.id === userMessageId, 'user message echoed for other tabs');
  const snap = await snapshot(t.id);
  const asst = snap.messages.find((m) => m.id === assistantMessageId);
  assert.equal(asst.status, 'done');
  assert.equal(asst.text, '[mock] hi there', 'the mock echoes the USER text — the context header was stripped');
  assert.equal(snap.thread.sessionId, 'mock-session-ask-1');
  assert.equal(snap.inFlight, null);
  // D13: the background title call then replaces the deterministic title and
  // announces it out-of-turn (under WORCA_MOCK it echoes the title prompt).
  const titled = await waitFor(() => msgs.find((m) => m.type === 'ask-title' && m.threadId === t.id));
  assert.ok(typeof titled.title === 'string' && titled.title, 'ask-title carries the new title');
  assert.equal((await snapshot(t.id)).thread.title, titled.title, 'the announced title is the stored one');
  ws.close();
});

test('409 while in flight; the 30 s grace entry never blocks the next turn', async () => {
  const t = await newThread();
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'MOCK_SLOW one', ...MODEL })).status, 202);
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-start'));
  assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'second', ...MODEL })).status, 409);
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-done'));
  const again = await post(`/api/ask/threads/${t.id}/messages`, { text: 'third', ...MODEL });
  assert.equal(again.status, 202, 'a done grace entry never 409s');
  await waitFor(() => framesFor(msgs, t.id).filter((f) => f.type === 'ask-done').length >= 2);
  ws.close();
});

test('mid-turn reconnect: ?threadId= replay and {type:subscribe,threadId} both deliver the stamped prefix', async () => {
  const t = await newThread();
  const a = openWs(`?threadId=${t.id}`);
  await a.opened;
  await post(`/api/ask/threads/${t.id}/messages`, { text: 'MOCK_SLOW replay me', ...MODEL });
  await waitFor(() => framesFor(a.msgs, t.id).length >= 3);
  const b = openWs(`?threadId=${t.id}`);
  await b.opened;
  await waitFor(() => framesFor(b.msgs, t.id).length >= 3);
  const seqOf = (list) => list.map((f) => `${f.seq}:${f.type}`);
  const bFrames = framesFor(b.msgs, t.id);
  assert.deepEqual(seqOf(bFrames.slice(0, 3)), seqOf(framesFor(a.msgs, t.id).slice(0, 3)), 'replayed prefix identical');
  const c = openWs();
  await c.opened;
  c.ws.send(JSON.stringify({ type: 'subscribe', threadId: t.id }));
  await waitFor(() => framesFor(c.msgs, t.id).length >= 3);
  assert.equal(framesFor(c.msgs, t.id)[0].seq, 1, 'in-band subscribe replays from the start');
  await waitFor(() => framesFor(a.msgs, t.id).some((f) => f.type === 'ask-done'));
  a.ws.close(); b.ws.close(); c.ws.close();
});

test('429 at three global running turns', async () => {
  const ts = [await newThread(), await newThread(), await newThread()];
  const w = openWs();
  await w.opened;
  for (const t of ts) {
    assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'MOCK_SLOW hold', ...MODEL })).status, 202);
  }
  const extra = await newThread();
  assert.equal((await post(`/api/ask/threads/${extra.id}/messages`, { text: 'x', ...MODEL })).status, 429);
  for (const t of ts) await post(`/api/ask/threads/${t.id}/stop`, {});
  await waitFor(() => ts.every((t) => framesFor(w.msgs, t.id).some((f) => f.type === 'ask-done')));
  w.ws.close();
});

test('stop: ask-done stopped/user with costUsd null; idempotent; bad shape 400', async () => {
  const t = await newThread();
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  await post(`/api/ask/threads/${t.id}/messages`, { text: 'MOCK_SLOW stopping', ...MODEL });
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-delta'));
  assert.deepEqual(await (await post(`/api/ask/threads/${t.id}/stop`, {})).json(), { ok: true });
  const done = await waitFor(() => framesFor(msgs, t.id).find((f) => f.type === 'ask-done'));
  assert.equal(done.status, 'stopped');
  assert.equal(done.reason, 'user');
  assert.equal(done.costUsd, null, 'no result frame arrived before the abort');
  assert.deepEqual(await (await post(`/api/ask/threads/${t.id}/stop`, {})).json(), { ok: true }, 'idempotent after done');
  assert.equal((await post('/api/ask/threads/zzz/stop', {})).status, 400);
  const snap = await snapshot(t.id);
  const asst = snap.messages.at(-1);
  assert.equal(asst.status, 'stopped');
  assert.equal(asst.reason, 'user');
  assert.equal(asst.costUsd, null);
  assert.equal(snap.thread.totals.turns, 1, 'a null-cost turn still counts');
  ws.close();
});

test('R-F route regression: a chat message "MOCK_ASK: <path>" writes NOTHING — turn and title included', async () => {
  const probe = join(homeDir, 'mock-ask-probe.json');
  const t = await newThread();
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  const r = await post(`/api/ask/threads/${t.id}/messages`, { text: `MOCK_ASK: ${probe}`, ...MODEL });
  assert.equal(r.status, 202);
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-done'));
  await new Promise((res) => setTimeout(res, 400)); // the fire-and-forget title call (dontAsk, Task 2) settles
  assert.ok(!existsSync(probe), 'neither the turn nor the title call reached the legacy MOCK_ASK write arm');
  ws.close();
});

test('attachments: stored + block on the user message; caps enforced', async () => {
  const t = await newThread();
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const ok = await post(`/api/ask/threads/${t.id}/messages`, {
    text: 'with files', ...MODEL,
    attachments: [{ name: 'notes.md', dataBase64: b64('# hello attachment') }],
  });
  assert.equal(ok.status, 202);
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-done'));
  const snap = await snapshot(t.id);
  assert.equal(snap.attachments.length, 1);
  assert.equal(snap.attachments[0].name, 'notes.md');
  const user = snap.messages.find((m) => m.role === 'user');
  assert.ok(user.blocks.some((b) => b.kind === 'attachment' && b.name === 'notes.md' && b.bytes > 0));
  const dl = await fetch(`${base}/api/ask/threads/${t.id}/attachments/${snap.attachments[0].id}`);
  assert.equal(await dl.text(), '# hello attachment');

  const t2 = await newThread();
  const send = (atts) => post(`/api/ask/threads/${t2.id}/messages`, { text: 'x', ...MODEL, attachments: atts, context: { view: 'history' } });
  const before = (await snapshot(t2.id)).thread;
  assert.equal((await send([{ name: 'evil.exe', dataBase64: b64('x') }])).status, 400);
  assert.equal((await send([{ name: 'big.md', dataBase64: Buffer.alloc(513 * 1024, 97).toString('base64') }])).status, 413);
  assert.equal((await send([{ name: 'bad.md', dataBase64: Buffer.from([0xff, 0xfe, 0xfd]).toString('base64') }])).status, 400);
  assert.equal((await send([{ name: 'nul.md', dataBase64: Buffer.from('a\u0000b', 'utf8').toString('base64') }])).status, 400);
  assert.equal((await send(Array.from({ length: 9 }, (_, i) => ({ name: `f${i}.md`, dataBase64: b64('x') })))).status, 400);
  // Every check precedes the FIRST write (all-or-nothing): a rejected message
  // must leave the thread untouched — no context/model/title write, no rows.
  const after2 = await snapshot(t2.id);
  assert.equal(after2.thread.title, before.title, 'no deterministic title on a rejected message');
  assert.deepEqual(after2.thread.context, before.context, 'context not stored on a rejected message');
  assert.equal(after2.thread.model, before.model, 'model not stored on a rejected message');
  assert.deepEqual(after2.messages, [], 'no message rows written');
  assert.deepEqual(after2.attachments, [], 'no attachment rows written');
  ws.close();
});

test('M1: a title given at thread creation is NEVER replaced by the background title (D13 guard)', async () => {
  const r = await post('/api/ask/threads', { title: 'Named By Hand' });
  const t = (await r.json()).thread;
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  await post(`/api/ask/threads/${t.id}/messages`, { text: 'hello named', ...MODEL });
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-done'));
  await new Promise((res) => setTimeout(res, 400)); // give a (wrong) title call time to land
  assert.ok(!msgs.some((m) => m.type === 'ask-title' && m.threadId === t.id),
    'no ask-title frame: the haiku call is not even fired for a user-named thread');
  assert.equal((await snapshot(t.id)).thread.title, 'Named By Hand');
  ws.close();
});

test('M2: a reserved slot (ids still null) holds the 409 yet stays invisible to hello and GET', async () => {
  const t = await newThread();
  // The exact entry the message route reserves BEFORE its first write. Two
  // concurrent POSTs cannot pin this: every await between the top 409 check and
  // the reservation (validateModelEffort -> composeCatalog, askBuildCatalog ->
  // three synchronous better-sqlite3 reads, resolveAskContext) resolves in
  // microtasks, so a second request never enters the route mid-window
  // (empirically instrumented — a Promise.all race test passes on the UNFIXED
  // code and pins nothing).
  mod._testing.askJobs.set(t.id, {
    turn: null, messageId: null, userMessageId: null,
    events: [], seq: 0, status: 'running',
    startedAt: new Date().toISOString(), graceTimer: null,
  });
  try {
    assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'x', ...MODEL })).status, 409,
      'the reservation blocks the next POST before any row exists');
    assert.equal((await snapshot(t.id)).inFlight, null,
      'GET reports no in-flight turn while the assistant row does not exist yet');
    const w = openWs();
    await w.opened;
    const hello = await waitFor(() => w.msgs.find((m) => m.type === 'hello'));
    assert.ok(!hello.ask.some((a) => a.threadId === t.id),
      'hello omits a slot whose assistant message id is still null');
    w.ws.close();
  } finally {
    mod._testing.askJobs.delete(t.id);
  }
});

test('MOCK_FAIL surfaces as ask-error with the runner message; the thread stays usable', async () => {
  const t = await newThread();
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  await post(`/api/ask/threads/${t.id}/messages`, { text: 'please MOCK_FAIL now', ...MODEL });
  const err = await waitFor(() => framesFor(msgs, t.id).find((f) => f.type === 'ask-error'));
  assert.match(err.message, /claude exited with code 1: mock failure/);
  const snap = await snapshot(t.id);
  assert.equal(snap.messages.at(-1).status, 'error');
  assert.equal(snap.inFlight, null, 'grace entry, not running');
  const again = await post(`/api/ask/threads/${t.id}/messages`, { text: 'hello again', ...MODEL });
  assert.equal(again.status, 202, 'the thread survives an errored turn');
  await waitFor(() => framesFor(msgs, t.id).filter((f) => f.type === 'ask-done').length >= 1);
  ws.close();
});
```

(Transcription hazard: the two `\u0000` occurrences — the `nul.md` test payload and, in Step 3, the route's NUL check — are LITERAL six-character source escapes. Several agent write tools interpolate them into a real NUL byte; verify with `grep -c 'u0000' test/ask-api-messages.test.mjs` → 1 after writing.)

- [ ] **Step 2: Run to verify it fails**

Run: `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test --test-force-exit test/ask-api-messages.test.mjs`
Expected: FAIL — the message POST 404s (route missing). (`--test-force-exit` on RED runs only — see Task 5's note.)

- [ ] **Step 3: Implement — context resolver, mock card, the two routes**

Append the two helpers AND both routes at the end of the ask section — after `GET /api/ask/models`, before the `/api/agents*` banner (no express route-matching conflict; dry-run-verified). Also append `resolveAskContext` to the `_testing` export object (the line becomes `…, askJobs, askFollowers, resolveAskContext,`) — Task 7 pins its workspace-members shape.

```js
/** lookupPipelineRow/findPipelineRowById return the RAW `SELECT * FROM pipelines`
 *  row: snake_case columns, and `branch` is a JSON DOCUMENT
 *  ({source, feature, worktreeDir, …}), not a branch name. Reading
 *  row.startedAt/row.branch directly loses the date and pastes a JSON blob into
 *  the [worca context] line (dry-run-verified). */
function askRunFromPipelineRow(row) {
  let branchObj = null;
  if (typeof row.branch === 'string') {
    try { branchObj = JSON.parse(row.branch); } catch { branchObj = null; }
  } else if (row.branch && typeof row.branch === 'object') {
    branchObj = row.branch;
  }
  const branch = branchObj && typeof branchObj.feature === 'string'
    ? branchObj.feature
    : (typeof branchObj === 'string' ? branchObj : null);
  return {
    id: row.id,
    title: row.title || '',
    status: row.status || '',
    startedAt: row.started_at || row.updated_at || '',
    branch,
  };
}

/** Resolve the VALIDATED client context into the server-side shape
 *  buildContextHeader consumes (§6.5: server-resolved rows only — never
 *  client-supplied titles or paths). Every lookup is individually guarded:
 *  a vanished row degrades to an absent header line, never a 500. */
async function resolveAskContext(threadId, ctx = {}, listedAttachments = [], currentMessageId = null) {
  const out = { now: new Date().toISOString() };
  if (ctx.view) out.view = ctx.view;
  try {
    if (ctx.projectKey || ctx.projectDir) {
      const projects = await listProjects();
      const p = projects.find((x) =>
        (ctx.projectKey && x.key === ctx.projectKey) || (ctx.projectDir && x.path === ctx.projectDir));
      if (p) out.project = { name: p.name, key: p.key };
    }
  } catch { /* absent line */ }
  try {
    if (ctx.workspaceId) {
      const ws = await readWorkspace(ctx.workspaceId);
      if (ws) {
        // readWorkspace returns {id, name, projectPaths, projectKeys, …} — there
        // is NO per-member name object (the {projectName} shape is a local
        // /api/run construction, ui/server.mjs:894). Member display names are
        // the path basenames, same as that precedent.
        out.workspace = {
          name: ws.name, id: ws.id,
          members: (ws.projectPaths || []).map((p) => path.basename(p)).filter(Boolean),
        };
      }
    }
  } catch { /* absent line */ }
  try {
    if (ctx.pipelineId) {
      const key = ctx.workspaceId ? `workspaces/${ctx.workspaceId}` : out.project?.key;
      const row = (key ? lookupPipelineRow(key, ctx.pipelineId) : null) || findPipelineRowById(ctx.pipelineId);
      if (row) out.run = askRunFromPipelineRow(row);
    } else if (ctx.runId && runs.has(ctx.runId)) {
      const entry = runs.get(ctx.runId);
      out.run = {
        id: entry.pipelineId || ctx.runId.slice(0, 8), title: entry.title || '',
        status: entry.status || '', startedAt: entry.startedAt || '', branch: null,
      };
    }
  } catch { /* absent line */ }
  // (the ctx.runId branch reads the LIVE runs-Map entry, which really is
  // camelCase — only the DB pipeline row needs askRunFromPipelineRow)
  try {
    const links = askListRunLinks(threadId).slice(0, ASK_LIMITS.headerRuns).map((l) => {
      const live = runs.get(l.runId);
      return {
        id: l.pipelineId || l.runId.slice(0, 8),
        title: (live && live.title) || '', status: l.status || (live && live.status) || '',
        phase: l.phase || '',
      };
    });
    if (links.length) out.linkedRuns = links;
    const cards = [];
    for (const m of askListMessages(threadId)) {
      if (!Array.isArray(m.blocks)) continue;
      for (const b of m.blocks) {
        if (b && b.kind === 'card') {
          cards.push({
            id: b.id, state: b.state, workflowId: b.card && b.card.workflowId,
            targetName: (b.card && (b.card.projectName || b.card.workspaceName)) || '',
          });
        }
      }
    }
    if (cards.length) out.cards = cards.slice(-ASK_LIMITS.headerCards);
    // §6.5: the CURRENT message's non-inlined files, then EARLIER attachments
    // newest first — inlined current files must not be double-listed, so the
    // earlier set excludes the whole current message, not just `listed` ids.
    const earlier = askListAttachments(threadId)
      .filter((a) => !currentMessageId || a.messageId !== currentMessageId)
      .slice(-ASK_LIMITS.headerAttachments)
      .reverse()
      .map((a) => ({ id: a.id, name: a.name, bytes: a.bytes }));
    const atts = [...listedAttachments.map((a) => ({ id: a.id, name: a.name, bytes: a.bytes })), ...earlier];
    if (atts.length) out.attachments = atts.slice(0, ASK_LIMITS.headerAttachments);
  } catch { /* absent lines */ }
  return out;
}

/** R-F: whenever mock mode is on, EVERY ask spawn carries markers. The card is
 *  the mock propose_run INPUT, derived from page context so a seeded project/
 *  workspace validates and an empty context exercises the rejection notice. */
function mockAskCard(ctx = {}, text = '') {
  const target = ctx.workspaceId
    ? { workspaceId: ctx.workspaceId }
    : { projectKey: ctx.projectKey || 'mock-project-00000000' };
  return { ...target, workflowId: 'wf_default', guardrailsId: 'normal', brief: text.slice(0, 200) || 'Mock run' };
}
```

The message route (validation order is spec §6.2.2 verbatim — 409 → 429 → 400s → 413s — and EVERY check precedes the first write):

```js
app.post('/api/ask/threads/:id/messages', async (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  try {
    const thread = askGetThread(id);
    if (!thread) return res.status(404).json({ error: 'thread not found' });
    if (askInFlight(id)) return res.status(409).json({ error: 'turn in flight' });
    if (askRunningCount() >= ASK_LIMITS.turnsGlobal) {
      return res.status(429).json({ error: `at most ${ASK_LIMITS.turnsGlobal} turns may run at once` });
    }
    const body = req.body || {};
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) return badRequest(res, 'text is required');
    const mv = await validateModelEffort(body.model, body.effort);
    if (!mv.ok) return badRequest(res, mv.error);
    const cv = validateClientContext(body.context);
    if (!cv.ok) return badRequest(res, cv.error);

    // §7.3 — validate EVERY attachment before ANY write (all-or-nothing).
    const files = [];
    if (body.attachments !== undefined) {
      if (!Array.isArray(body.attachments)) return badRequest(res, 'attachments must be an array');
      if (body.attachments.length > ASK_LIMITS.attachment.maxFiles) {
        return badRequest(res, `at most ${ASK_LIMITS.attachment.maxFiles} attachments per message`);
      }
      const dec = new TextDecoder('utf-8', { fatal: true });
      for (const a of body.attachments) {
        const name = a && typeof a.name === 'string' ? a.name : '';
        const dot = name.lastIndexOf('.');
        const ext = dot === -1 ? '' : name.slice(dot).toLowerCase();
        if (!ASK_LIMITS.attachment.extensions.includes(ext)) {
          return badRequest(res, `attachment type not allowed: ${name || '(unnamed)'}`);
        }
        const raw = typeof a.dataBase64 === 'string' ? a.dataBase64 : '';
        const buf = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
        if (!buf.length) return badRequest(res, `attachment is empty or not valid base64: ${name}`);
        if (buf.length > ASK_LIMITS.attachment.maxBytesPerFile) {
          return res.status(413).json({ error: `attachment over ${ASK_LIMITS.attachment.maxBytesPerFile} bytes: ${name}` });
        }
        let bodyText;
        try { bodyText = dec.decode(buf); } catch { return badRequest(res, `attachment is not valid UTF-8: ${name}`); }
        if (bodyText.includes('\u0000')) return badRequest(res, `attachment contains NUL bytes: ${name}`);
        files.push({ name, text: bodyText, bytes: buf.length });
      }
      const total = askThreadAttachmentBytes(id) + files.reduce((s, f) => s + f.bytes, 0);
      if (total > ASK_LIMITS.attachment.maxBytesPerThread) {
        return res.status(413).json({ error: 'attachment budget for this thread exceeded' });
      }
    }

    // §6.2.2 ATOMIC re-check + slot reservation. Today every await between the
    // top 409/429 pair and here resolves in microtasks (validateModelEffort ->
    // composeCatalog; askBuildCatalog -> three synchronous better-sqlite3
    // reads), so the route is macrotask-atomic and two POSTs cannot interleave
    // (empirically instrumented). The reservation is what keeps that true if
    // any of those readers ever becomes genuinely async: it is synchronous —
    // check-and-set cannot interleave — and runs BEFORE the first write, so a
    // loser leaves no rows.
    if (askInFlight(id)) return res.status(409).json({ error: 'turn in flight' });
    if (askRunningCount() >= ASK_LIMITS.turnsGlobal) {
      return res.status(429).json({ error: `at most ${ASK_LIMITS.turnsGlobal} turns may run at once` });
    }
    const prev = askJobs.get(id);
    if (prev && prev.graceTimer) clearTimeout(prev.graceTimer); // atomic replace of a grace entry (§8.3)
    const job = {
      turn: null, messageId: null, userMessageId: null, // ids filled once the rows exist;
      events: [], seq: 0, status: 'running',            // askHello()/GET inFlight skip a null messageId
      startedAt: new Date().toISOString(), graceTimer: null,
    };
    askJobs.set(id, job);

    let asstMsg = null;
    let turn;
    try {
      // Writes. Store the LAST context + model/effort on the thread (§6.5 tail, D8).
      askUpdateThread(id, { context: cv.context, model: mv.model, effort: mv.effort });
      let deterministicTitle = thread.title;
      let titleWasAuto = false;
      if (thread.title == null) {
        // §7.4 — no frame for the deterministic title. titleWasAuto gates the
        // D13 background replacement: a title given at THREAD CREATION is the
        // user's, and the haiku call must never fire for it (§17 Q&A 1).
        deterministicTitle = askSanitizeTitle(text.slice(0, 80)) || 'New chat';
        askSetThreadTitle(id, deterministicTitle);
        titleWasAuto = true;
      }
      const userMsg = askAppendMessage(id, { role: 'user', text });
      job.userMessageId = userMsg.id;
      const attRows = files.map((f) => askAddAttachment(id, userMsg.id, { name: f.name, text: f.text }));
      if (attRows.length) {
        askSetMessageBlocks(userMsg.id, attRows.map((a) => ({ kind: 'attachment', id: a.id, name: a.name, bytes: a.bytes })));
      }
      broadcast({ type: 'ask-message', threadId: id, message: askGetMessage(userMsg.id) }); // echo for other tabs
      asstMsg = askAppendMessage(id, { role: 'assistant', text: '', status: 'streaming', model: mv.model, effort: mv.effort });
      job.messageId = asstMsg.id;

      // Prompt assembly (§6.5) — the route owns it; the turn only spawns.
      const catalog = await askBuildCatalog();
      const systemPrompt = askBuildSystemPrompt(catalog);
      const withText = attRows.map((a, i) => ({ id: a.id, name: a.name, bytes: a.bytes, text: files[i].text }));
      const { inline, listed } = askSelectInlineAttachments(withText);
      const headerCtx = await resolveAskContext(id, cv.context, listed, userMsg.id);
      const header = askBuildContextHeader(headerCtx);
      const prompt = askBuildTurnPrompt(header, text, inline);
      const prior = askListMessages(id).filter((m) => m.seq < userMsg.seq);
      const restoredPrompt = askBuildRestoredPrompt(prior, prompt);
      const attachmentNames = {};
      for (const a of askListAttachments(id)) attachmentNames[a.id] = a.name;

      turn = createAskTurn({
        threadId: id, assistantMessageId: asstMsg.id, userMessageId: userMsg.id,
        prompt, systemPrompt, restoredPrompt,
        model: mv.model, effort: mv.effort,
        resumeSessionId: thread.sessionId || null,
        firstTurn: userMsg.seq === 1 && titleWasAuto, // D13 guard: never replace a user-authored title
        firstText: text,
        deterministicTitle,
        mock: mockEnabled({}) ? { card: mockAskCard(cv.context, text) } : null, // R-F
        attachmentNames,
        deps: {
          onFrame: stampAskFrames(id, job),
          onOutOfTurn: (f) => broadcast({ ...f, threadId: id }),
        },
      });
      job.turn = turn;
    } catch (err) {
      // A write/assembly failure must release the reserved slot and never leave
      // a `streaming` row for the boot sweep to find.
      if (askJobs.get(id) === job) askJobs.delete(id);
      if (asstMsg) {
        try {
          askFinishMessage(asstMsg.id, {
            text: '', blocks: [{ kind: 'notice', text: 'failed to start the turn' }],
            status: 'error', reason: null, usage: null, costUsd: null, durationMs: null,
          });
        } catch { /* thread gone */ }
      }
      return res.status(500).json({ error: err && err.message ? err.message : String(err) });
    }
    const settleJob = (status) => {
      if (askJobs.get(id) !== job) return;
      job.status = status;
      job.graceTimer = setTimeout(() => {
        if (askJobs.get(id) === job) askJobs.delete(id);
      }, ASK_LIMITS.jobGraceMs);
      job.graceTimer.unref?.();
    };
    turn.on('done', () => settleJob('done'));
    turn.on('error', () => settleJob('error'));
    // Fire-and-forget with a backstop (startAgentGen shape) — run() never throws.
    Promise.resolve()
      .then(() => turn.run())
      .catch((err) => {
        console.error(`[worca-ui] ask turn crashed: ${err && err.message ? err.message : err}`);
        settleJob('error');
      });
    res.status(202).json({ userMessageId: job.userMessageId, assistantMessageId: job.messageId });
  } catch (err) {
    // Only pre-reservation throws land here (`job` is block-scoped to the outer
    // try and every post-reservation failure returned from the inner catch), so
    // there is no slot to release.
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Idempotent stop (the /api/agents/generate/stop family): always {ok:true}
// after the shape check; the costUsd:null rule lives in the turn (R-C).
app.post('/api/ask/threads/:id/stop', (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  const job = askInFlight(id);
  if (job && job.turn && typeof job.turn.stop === 'function') {
    try { job.turn.stop(); } catch { /* best-effort */ }
  }
  res.json({ ok: true });
});
```

- [ ] **Step 4: Run to verify green**

Run: `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test test/ask-api-messages.test.mjs`
Expected: PASS (11/11), ~8-11 s total (`MOCK_SLOW` paces ~2.1 s per slow test; the R-F test's 400 ms title settle is ample — the mock title call resolves in ~40 ms; the M2 reserved-slot test is ~70 ms).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: **3219 pass / 0 fail** (3208 + 11).

- [ ] **Step 6: Commit**

```bash
git add ui/server.mjs test/ask-api-messages.test.mjs
git commit -m "worca ask: message POST (validation, prompt assembly, turn spawn) + idempotent stop"
```

---
### Task 7: cards — dismiss, the `/api/run` seam, follower wiring

**Files:**
- Modify: `ui/server.mjs` (`flipCard` helper + dismiss route in the ask section; two hunks inside `POST /api/run`; `_testing` gains `flipCard`)
- Test: `test/ask-api-cards.test.mjs`

**Interfaces:**
- Consumes: Task 3's `attachRunFollower`; Task 5/6 registry + routes; the `/api/run` seam (`runs.set` ~`:997`, `wireRun` ~`:998`, `announceRun` ~`:999` — P1-current numbers; the anchor is the three adjacent calls); B-6 (`linkRun` throws on dup/missing-thread), B-8 (attach BEFORE `orch.run()` is scheduled — the seam is synchronous, `Promise.resolve().then(() => orch.run())` fires later, so the preflight `error` event cannot be missed).
- Produces: `POST /api/ask/threads/:id/cards/:cardId`; `/api/run` accepting `askThreadId`/`askCardId`; `flipCard(threadId, cardId, patch)`; the `ask-run-status` + follower `ask-message` broadcasts.

- [ ] **Step 1: Write the failing test**

```js
// test/ask-api-cards.test.mjs
// Cards end to end over WORCA_MOCK: propose (mock card from page context) →
// Start (/api/run link seam) → follower notices, for a project AND a workspace
// target; dismiss incl. the R-B mid-stream dual update; the rejection notice;
// DELETE-while-followed. The full agentgen-api boot (cwd git sandbox — the
// mock pipeline runs for real).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

const origCwd = process.cwd();
let cwdSandbox = null;
let homeDir, srv, base, wsBase, mod, prevHome;
let projectDir, projectDir2, projectKey, workspaceId;
const JSONH = { 'Content-Type': 'application/json' };
const MODEL = { model: 'claude-opus-5', effort: 'high' };

function gitInit(dir) {
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'README.md'), '# x\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
}

before(async () => {
  cwdSandbox = mkdtempSync(join(tmpdir(), 'worca-cc-askcards-cwd-'));
  gitInit(cwdSandbox);
  process.chdir(cwdSandbox);
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askcards-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;

  // A registered project (the mock card's target) + a workspace over it.
  // POST /api/workspaces takes `projectPaths` and rejects fewer than 2 members
  // ("a workspace needs at least 2 member projects"), so a second registered
  // project is part of the fixture (dry-run-verified).
  projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-askcards-proj-'));
  gitInit(projectDir);
  projectDir2 = mkdtempSync(join(tmpdir(), 'worca-cc-askcards-proj2-'));
  gitInit(projectDir2);
  const { addProject, listProjects } = await import('../src/core/projects.mjs');
  await addProject({ name: 'demo', path: projectDir });
  await addProject({ name: 'demo2', path: projectDir2 });
  projectKey = (await listProjects()).find((p) => p.path === projectDir).key;
  const wsRes = await fetch(`${base}/api/workspaces`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ name: 'Team', projectPaths: [projectDir, projectDir2] }),
  });
  assert.equal(wsRes.status, 201, 'workspace seeded');
  workspaceId = (await wsRes.json()).workspace.id;
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  for (const r of mod.runs.values()) { try { r.orch?.stop?.(); } catch { /* reap */ } }
  mod.runs.clear();
  if (srv) {
    // A RED WS test never reaches ws.close(), and an upgraded socket is NOT
    // destroyed by closeAllConnections() — server.close()'s callback then never
    // fires and the file hangs in teardown. Bound the wait so the failures
    // actually print (pair the red run with --test-force-exit).
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  process.chdir(origCwd);
  // A stopped orchestrator still flushes artifacts for a few ticks, so a plain
  // recursive rm races those writes and ENOTEMPTYs under full-suite load (seen
  // once in ~2 `npm test` runs; never in isolation). Retry, and never let
  // teardown hygiene fail the file.
  const reap = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  if (cwdSandbox) await reap(cwdSandbox);
  await reap(homeDir);
  await reap(projectDir);
  await reap(projectDir2);
});

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const newThread = async () => (await (await post('/api/ask/threads', {})).json()).thread;
const snapshot = async (id) => (await fetch(`${base}/api/ask/threads/${id}`)).json();

function openWs(query = '') {
  const ws = new WebSocket(`${wsBase}${query}`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
function waitFor(pred, timeoutMs = 10000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      const v = pred();
      if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 15);
    })();
  });
}
const frames = (msgs, threadId, type) => msgs.filter((m) => m.threadId === threadId && m.type === type);

/** /api/run never forwards the orchestrator's `auto` flag, so a REAL mock run
 *  parks at every HITL gate for ever — wf_default's clarify question is the
 *  first one (test/api-sources.test.mjs:179 records the same fact: "HITL gates
 *  may hold a server run open"). This pump answers exactly as orchestrator auto
 *  mode does (orchestrator.mjs:2802-2818: clarify/questions → the first
 *  non-blank option, anything else → decision 'continue'), so a card-linked run
 *  reaches `done` and the follower posts its finish notice (dry-run-measured:
 *  518 ms to done with the pump; parked 60 s+ without). Returns a stopper. */
function autoAnswerRun(runId) {
  let stopped = false;
  let last = null;
  const tick = async () => {
    if (stopped) return;
    const pq = mod.runs.get(runId)?.pendingQuestion;
    if (pq && pq !== last) {
      last = pq;
      const payload = (pq.kind === 'clarify' || pq.kind === 'questions')
        ? { answers: (pq.questions || []).map((q) => ({ id: q.id, choice: (q.options || []).find((o) => o && o.trim()) || 'auto' })) }
        : { decision: 'continue' };
      try { await post('/api/answer', { runId, id: pq.id, payload }); } catch { /* run gone */ }
    }
    if (!stopped) { const t = setTimeout(tick, 25); t.unref?.(); }
  };
  const t0 = setTimeout(tick, 25); t0.unref?.();
  return () => { stopped = true; };
}

/** Drive one mock turn whose text triggers the propose scenario; returns the proposed card block. */
async function proposeCard(context, text) {
  const t = await newThread();
  const w = openWs(`?threadId=${t.id}`);
  await w.opened;
  const r = await post(`/api/ask/threads/${t.id}/messages`, { text, ...MODEL, context });
  assert.equal(r.status, 202);
  await waitFor(() => frames(w.msgs, t.id, 'ask-done').length >= 1);
  const cardFrame = frames(w.msgs, t.id, 'ask-card')[0];
  w.ws.close();
  return { thread: t, card: cardFrame ? cardFrame.block : null, msgs: w.msgs };
}

test('project card: propose → Start via /api/run → started flip, notice, follower done + run-status', async () => {
  const { thread, card } = await proposeCard({ projectKey }, 'propose a run for this project');
  assert.ok(card, 'the mock propose scenario produced a card');
  assert.equal(card.state, 'proposed');
  assert.equal(card.card.projectKey, projectKey);
  assert.equal(card.card.guardrailsId, 'normal');
  const w = openWs();
  await w.opened;
  const start = await post('/api/run', {
    projectDir, prompt: card.card.brief, workflowId: card.card.workflowId,
    guardrailsId: card.card.guardrailsId, title: card.card.title,
    askThreadId: thread.id, askCardId: card.id,
  });
  assert.equal(start.status, 200);
  const { runId } = await start.json();
  const stopPump = autoAnswerRun(runId);
  const snap1 = await snapshot(thread.id);
  const flipped = snap1.messages.flatMap((m) => m.blocks || []).find((b) => b.kind === 'card' && b.id === card.id);
  assert.equal(flipped.state, 'started', 'flip landed synchronously with the 200');
  assert.equal(flipped.runId, runId);
  assert.ok(snap1.messages.some((m) => m.role === 'system' && m.text === `Run started — "${card.card.title}"`));
  assert.equal(snap1.runLinks.length, 1);
  assert.equal(snap1.runLinks[0].runId, runId);
  assert.equal(snap1.runLinks[0].cardId, card.id);
  await waitFor(() => frames(w.msgs, thread.id, 'ask-message').some((m) => /Run finished/.test(m.message.text)));
  const statuses = frames(w.msgs, thread.id, 'ask-run-status');
  assert.ok(statuses.length >= 1);
  assert.ok(statuses.some((s) => typeof s.pipelineId === 'string' && s.pipelineId), 'pipeline id captured from state');
  const snap2 = await snapshot(thread.id);
  assert.ok(snap2.runLinks[0].pipelineId, 'link row carries the pipeline id');
  assert.equal(snap2.runLinks[0].status, 'done');
  stopPump();
  w.ws.close();
});

test('workspace card: Start posts the workspace body; entry kind is workspace-run', async () => {
  const { thread, card } = await proposeCard({ workspaceId }, 'propose a run here');
  assert.ok(card);
  assert.equal(card.card.target, 'workspace');
  assert.equal(card.card.workspaceId, workspaceId);
  const w = openWs();
  await w.opened;
  const start = await post('/api/run', {
    workspaceId, prompt: card.card.brief, workflowId: card.card.workflowId,
    guardrailsId: card.card.guardrailsId, title: card.card.title,
    sourceBranchByKey: card.card.sourceBranchByKey || undefined,
    askThreadId: thread.id, askCardId: card.id,
  });
  assert.equal(start.status, 200);
  const { runId } = await start.json();
  const stopPump = autoAnswerRun(runId);
  assert.equal(mod.runs.get(runId).kind, 'workspace-run');
  await waitFor(() => frames(w.msgs, thread.id, 'ask-message').some((m) => /Run finished/.test(m.message.text)));
  stopPump();
  w.ws.close();
});

test('/api/run pair validation: 400 on half a pair, unknown thread, unknown card; 409 on non-proposed — and NO run is created', async () => {
  const body = { projectDir, prompt: 'x', workflowId: 'wf_default' };
  const rejects = [
    { ...body, askThreadId: 'ask_ffffffff' },
    { ...body, askCardId: 'card_ffffffff' },
    { ...body, askThreadId: 'ask_ffffffff', askCardId: 'card_ffffffff' },
  ];
  for (const b of rejects) {
    const n = mod.runs.size;
    assert.equal((await post('/api/run', b)).status, 400);
    assert.equal(mod.runs.size, n, 'a rejected ask pair creates no run entry (validated BEFORE the run exists)');
  }
  const { thread, card } = await proposeCard({ projectKey }, 'propose again');
  await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'dismissed' });
  const n = mod.runs.size;
  const r = await post('/api/run', { ...body, askThreadId: thread.id, askCardId: card.id });
  assert.equal(r.status, 409, 'a dismissed card cannot start a run');
  assert.equal(mod.runs.size, n, 'the 409 also creates no run entry');
});

test('dismiss: {block} on success, 400 on other states, 404 unknown, 409 when not proposed; other tabs get the ask-message refresh', async () => {
  const { thread, card } = await proposeCard({ projectKey }, 'propose one more');
  assert.equal((await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'started' })).status, 400);
  assert.equal((await post(`/api/ask/threads/${thread.id}/cards/card_ffffffff`, { state: 'dismissed' })).status, 404);
  const w = openWs();
  await w.opened;
  const ok = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'dismissed' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).block.state, 'dismissed');
  // The card's turn is already over — no live reducer took the flip, so the
  // whole message re-broadcasts as an out-of-turn ask-message (§6.6 upsert key).
  await waitFor(() => frames(w.msgs, thread.id, 'ask-message').find((m) =>
    (m.message.blocks || []).some((b) => b.kind === 'card' && b.id === card.id && b.state === 'dismissed')));
  assert.equal((await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'dismissed' })).status, 409);
  w.ws.close();
});

test('R-B: dismissing WHILE the turn still streams survives finishMessage (live reducer re-emits)', async () => {
  const t = await newThread();
  const w = openWs(`?threadId=${t.id}`);
  await w.opened;
  await post(`/api/ask/threads/${t.id}/messages`, { text: 'MOCK_SLOW propose something', ...MODEL, context: { projectKey } });
  const cardFrame = await waitFor(() => frames(w.msgs, t.id, 'ask-card')[0]);
  assert.equal(cardFrame.block.state, 'proposed');
  const flip = await post(`/api/ask/threads/${t.id}/cards/${cardFrame.block.id}`, { state: 'dismissed' });
  assert.equal(flip.status, 200);
  const reEmit = await waitFor(() => frames(w.msgs, t.id, 'ask-card').find((f) => f.block.state === 'dismissed'));
  assert.ok(reEmit.seq > cardFrame.seq, 'the live reducer re-emitted the flipped card as a job frame');
  await waitFor(() => frames(w.msgs, t.id, 'ask-done').length >= 1);
  const snap = await snapshot(t.id);
  const block = snap.messages.flatMap((m) => m.blocks || []).find((b) => b.kind === 'card');
  assert.equal(block.state, 'dismissed', 'finishMessage did NOT revert the flip');
  w.ws.close();
});

test('resolveAskContext: the workspace members line carries the member names (§6.5)', async () => {
  // Pins the C1 fresh-eyes fix: readWorkspace has NO `projects` field — members
  // come from projectPaths basenames. Without the fix this is always [].
  const t = await newThread();
  const ctx = await mod._testing.resolveAskContext(t.id, { workspaceId }, []);
  assert.equal(ctx.workspace.id, workspaceId);
  assert.ok(ctx.workspace.members.length >= 2, 'both member names resolved');
  for (const m of ctx.workspace.members) assert.equal(typeof m, 'string');
});

test('rejected proposal (no valid target in context) → notice, no card', async () => {
  const { thread, card } = await proposeCard({}, 'propose with no context');
  assert.equal(card, null);
  const snap = await snapshot(thread.id);
  const notice = snap.messages.flatMap((m) => m.blocks || []).find((b) => b.kind === 'notice');
  assert.match(notice.text, /^Proposal rejected: /);
});

test('preflight failure after 200 {runId}: "Run failed: Preflight failed:" notice + card failed (B-8)', async () => {
  // POST /api/workflows VALIDATES agent keys against the registry, so the ghost
  // workflow is written through the STORE (writeWorkflow only stamps id/dates;
  // key resolution happens at run preflight — orchestrator.mjs:1859-1890).
  const { writeWorkflow } = await import('../src/core/workflows.mjs');
  const ghost = await writeWorkflow({
    name: 'Ghost', steps: [[{ id: 's0_0', key: 'ghost-agent-zz' }]], feedbacks: [],
  });
  const { thread, card } = await proposeCard({ projectKey }, 'propose a doomed run');
  const w = openWs();
  await w.opened;
  const start = await post('/api/run', {
    projectDir, prompt: card.card.brief, workflowId: ghost.id,
    guardrailsId: 'normal', title: card.card.title,
    askThreadId: thread.id, askCardId: card.id,
  });
  assert.equal(start.status, 200, 'preflight runs AFTER the 200 — the link must already exist');
  const failed = await waitFor(() => frames(w.msgs, thread.id, 'ask-message')
    .find((m) => /^Run failed: Preflight failed:/.test(m.message.text)));
  assert.ok(failed, 'the follower attached before orch.run() was scheduled');
  const snap = await snapshot(thread.id);
  const block = snap.messages.flatMap((m) => m.blocks || []).find((b) => b.kind === 'card' && b.id === card.id);
  assert.equal(block.state, 'failed');
  assert.match(block.error, /Preflight failed/);
  assert.equal(snap.runLinks[0].status, 'error');
  w.ws.close();
});

test('DELETE while a followed run lives: run unaffected, followers detached, no late writes crash', async () => {
  const { thread, card } = await proposeCard({ projectKey }, 'propose then delete');
  const start = await post('/api/run', {
    projectDir, prompt: card.card.brief, workflowId: card.card.workflowId,
    guardrailsId: 'normal', title: card.card.title,
    askThreadId: thread.id, askCardId: card.id,
  });
  const { runId } = await start.json();
  const stopPump = autoAnswerRun(runId);
  const del = await fetch(`${base}/api/ask/threads/${thread.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(mod._testing.askFollowers.get(thread.id), undefined, 'follower set dropped');
  await waitFor(() => ['done', 'error', 'stopped'].includes(String(mod.runs.get(runId)?.status)));
  stopPump();
  assert.equal((await fetch(`${base}/api/ask/threads/${thread.id}`)).status, 404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test --test-force-exit test/ask-api-cards.test.mjs`
Expected: FAIL — 6 of 9 (the dismiss route 404s through the SPA fallback, `/api/run` ignores the ask fields — no flip, no link row; the rejection-notice, DELETE and `resolveAskContext`-pin tests already pass on Task 6's work). (`--test-force-exit` on RED runs only — see Task 5's note.)

- [ ] **Step 3: Implement**

**Hunk A — `flipCard` + the dismiss route** (in the ask section, after Task 6's routes):

```js
/** R-B dual update. Flip in the STORE and, when the owning thread's turn is
 *  still streaming, in the LIVE reducer (updateBlock re-emits the stamped
 *  ask-card job frame) — otherwise finishMessage at turn end reverts the flip
 *  with the reducer's stale copy. When no live reducer held the card (turn
 *  over, or the card sits on an earlier message), re-broadcast the whole
 *  message so tabs upsert the flipped block by message.id (§6.6 out-of-turn). */
function flipCard(threadId, cardId, patch) {
  const block = askUpdateCardBlock(threadId, cardId, patch);
  if (!block) return null;
  const job = askInFlight(threadId);
  const live = job && job.turn && job.turn.reducer ? job.turn.reducer.updateBlock(cardId, patch) : null;
  if (!live) {
    const found = askFindCard(threadId, cardId);
    if (found) broadcast({ type: 'ask-message', threadId, message: found.message });
  }
  return block;
}

// D14 dismiss ("Not now" keeps a stub — the client renders state:'dismissed').
app.post('/api/ask/threads/:id/cards/:cardId', (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  const cardId = askIdParam(res, req.params.cardId, 'card');
  if (!cardId) return;
  try {
    if (!askGetThread(id)) return res.status(404).json({ error: 'thread not found' });
    if ((req.body || {}).state !== 'dismissed') return badRequest(res, 'state must be "dismissed"');
    const found = askFindCard(id, cardId);
    if (!found) return res.status(404).json({ error: 'card not found' });
    if (found.block.state !== 'proposed') {
      return res.status(409).json({ error: `card is ${found.block.state}` });
    }
    const block = flipCard(id, cardId, { state: 'dismissed' });
    res.json({ block });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});
```

**Hunk B — `/api/run` validation.** Immediately after the workspaceId/projectDir mutual-exclusion checks (anchor: the two `badRequest` returns at ~`:793-796`), BEFORE the source/prompt handling and the budget gate — a 403 must not leave a half-linked card, and per spec §8.1 every ask-field failure is decided "before the run is created" (the pair-validation test pins `mod.runs.size` unchanged):

```js
    // Ask Worca card link (§8.1): both or neither; the thread must exist and
    // the card must still be `proposed` BEFORE any run state is created.
    const hasAskThread = body.askThreadId !== undefined && body.askThreadId !== null;
    const hasAskCard = body.askCardId !== undefined && body.askCardId !== null;
    let askLink = null;
    if (hasAskThread || hasAskCard) {
      if (!hasAskThread || !hasAskCard) {
        return badRequest(res, 'askThreadId and askCardId must be provided together');
      }
      if (typeof body.askThreadId !== 'string' || !ASK_ID_RE.test(body.askThreadId)
        || typeof body.askCardId !== 'string' || !ASK_ID_RE.test(body.askCardId)) {
        return badRequest(res, 'invalid askThreadId or askCardId');
      }
      if (!askGetThread(body.askThreadId)) return badRequest(res, 'unknown askThreadId');
      const found = askFindCard(body.askThreadId, body.askCardId);
      if (!found) return badRequest(res, 'unknown askCardId');
      if (found.block.state !== 'proposed') {
        return res.status(409).json({ error: `card is ${found.block.state}` });
      }
      askLink = { threadId: body.askThreadId, cardId: body.askCardId };
    }
```

**Hunk C — the seam.** Between `wireRun(entry);` and `announceRun(entry);` (~`:998-999`) — synchronous, ONE try/catch (a thread deleted after validation makes `linkRun` throw its FK error — the run must proceed and `{runId}` must still be returned, spec §11 last row), three separate store calls, never a route-level `tx()` (R-E). The follower attaches HERE, before `Promise.resolve().then(() => orch.run())` at ~`:1002`, so the microtask ordering guarantees it sees a preflight `error` (B-8):

```js
    if (askLink) {
      try {
        // Card-state TOCTOU: awaits (source-ref check, budget) sit between Hunk
        // B's `proposed` check and here — a concurrent Start may have flipped
        // the card already. Re-check and skip the link/flip/notice quietly (the
        // run itself proceeds and {runId} is still returned).
        const still = askFindCard(askLink.threadId, askLink.cardId);
        if (!still || still.block.state !== 'proposed') throw new Error('card no longer proposed');
        askLinkRun(askLink.threadId, { runId, cardId: askLink.cardId, status: entry.status });
        flipCard(askLink.threadId, askLink.cardId, { state: 'started', runId });
        const startedMsg = askAppendMessage(askLink.threadId, {
          role: 'system',
          text: `Run started — "${title}"`,
          blocks: [{ kind: 'notice', text: `Run started — "${title}"`, href: `#running/${runId}` }],
        });
        broadcast({ type: 'ask-message', threadId: askLink.threadId, message: startedMsg });
        const follower = attachRunFollower(orch, {
          threadId: askLink.threadId,
          runId,
          cardId: askLink.cardId,
          post: ({ text, href }) => {
            try {
              const m = askAppendMessage(askLink.threadId, {
                role: 'system', text, blocks: [{ kind: 'notice', text, href }],
              });
              broadcast({ type: 'ask-message', threadId: askLink.threadId, message: m });
            } catch { /* thread deleted mid-run */ }
          },
          updateStatus: (patch) => {
            try {
              const linkPatch = {};
              if (patch.pipelineId) linkPatch.pipelineId = patch.pipelineId;
              if (patch.status) linkPatch.status = patch.status;
              if (patch.phase !== undefined) linkPatch.phase = patch.phase;
              const row = Object.keys(linkPatch).length
                ? askUpdateRunLink(askLink.threadId, runId, linkPatch) : null;
              if (patch.cardFailed) {
                flipCard(askLink.threadId, askLink.cardId, { state: 'failed', error: patch.cardFailed });
              }
              broadcast({
                type: 'ask-run-status', threadId: askLink.threadId, runId,
                pipelineId: (row && row.pipelineId) || patch.pipelineId || null,
                cardId: askLink.cardId,
                status: patch.status || (row && row.status) || null,
                phase: patch.phase !== undefined ? patch.phase : ((row && row.phase) || null),
              });
            } catch { /* thread deleted mid-run */ }
          },
          onDetached: () => {
            const set = askFollowers.get(askLink.threadId);
            if (set) {
              set.delete(follower);
              if (!set.size) askFollowers.delete(askLink.threadId);
            }
          },
        });
        let set = askFollowers.get(askLink.threadId);
        if (!set) {
          set = new Set();
          askFollowers.set(askLink.threadId, set);
        }
        set.add(follower);
      } catch (err) {
        console.error(`[worca-ui] ask run link failed: ${err && err.message ? err.message : err}`);
      }
    }
```

**Hunk D — `_testing`:** append `flipCard` (final line: `chatNotifier, resumeRun, resolveHljsAssets, resolveEsmAsset, askJobs, askFollowers, resolveAskContext, flipCard,`).

- [ ] **Step 4: Run to verify green**

Run: `WORCA_HOME=/tmp/worca-p2-home node --disable-warning=ExperimentalWarning --test test/ask-api-cards.test.mjs`
Expected: PASS (9/9), ~10-15 s (dry-run-measured 9.9 s before the pin test — the auto-answer pump takes each mock pipeline to `done` in ~0.5 s).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: **3228 pass / 0 fail** (3219 + 9). `/api/run` fences: `workspaces-api`, `api-workflows`, `api-workflow-defaults`, `ui-server-stepper-seed`, `ui-server-question-replay` all untouched-green (the ask hunks are no-ops without the ask fields).

- [ ] **Step 6: Commit**

```bash
git add ui/server.mjs test/ask-api-cards.test.mjs
git commit -m "worca ask: card dismiss + /api/run link seam + run follower wiring"
```

---
### Task 8: final verification + P3 handoff

**Files:** none created or modified (verification only; fix-forward inside the offending task's files if a check fails).

- [ ] **Step 1: Full suite, twice**

Run: `npm test` (twice in a row).
Expected: **3228 pass / 0 fail** both times (flake shield). If `test/api-sources.test.mjs` ENOTEMPTYs or the skills-gate timing flake fires, re-run the single file before investigating.

- [ ] **Step 2: Fence audit**

Run each and expect green, untouched by P2 (`git diff --stat 1b02d87b -- <file>` empty for every test file listed):
`spawn-args`, `claude-runner-session`, `settings-projects-root`, `agentgen-api`, `api-hljs-assets`, `ui-shell`, `ui-theme`, `ui-boot`, `scan-api`, `workspaces-api`, plus all 19 P1 `ask-*`/`claude-runner-ask-mock` files (only `test/ask-title-options.test.mjs` may differ — Task 2 appended two tests).

- [ ] **Step 3: No-frontend check**

Run: `git diff --stat 1b02d87b -- ui/public/`
Expected: empty. Any diff under `ui/public/` is a plan violation (P3's territory).

- [ ] **Step 4: Docs still true (zero-delta contract)**

Verify (read, don't edit): `docs/storage.md` documents `ask/<threadId>/att/<attachmentId>.txt` and `tmp/ask/` (~`:22,:25`); `docs/guardrails.md` carries the "Ask Worca sandbox" paragraph incl. the `//`-anchoring rule (~`:118-146`). Both were written by P1 and P2 changed no behaviour they describe. The README feature bullet stays P4's.

- [ ] **Step 5: P3 handoff smoke**

Run: `node --disable-warning=ExperimentalWarning -e "const m = await import('./ui/server.mjs'); for (const k of ['askJobs','askFollowers','flipCard','resolveEsmAsset']) if (!(k in m._testing)) throw new Error(k); console.log('handoff ok');"` with `WORCA_HOME=/tmp/worca-p2-home`.
Expected: `handoff ok`. The Frozen P2 → P3 contract section of this plan is now literally true — P3's plan is written against it.

- [ ] **Step 6: Commit check**

`git log --oneline 1b02d87b..HEAD` shows exactly the seven task commits (T1–T7). Nothing under `docs/superpowers/` is tracked (`git status --short docs/superpowers/` shows only `??` entries or nothing).

---

## Spec §12 coverage map (P2 rows)

| spec §12 requirement | where |
|---|---|
| threads CRUD incl. 404s | T5 `ask-api-threads` |
| message → frames until `ask-done` | T6 `ask-api-messages` |
| a card with `guardrailsId:'normal'` + the seeded project | T7 (`card.card.guardrailsId === 'normal'` asserted) |
| mid-turn reconnect replay (`MOCK_SLOW`) | T6 (`?threadId=` + in-band subscribe) |
| `POST /api/run` + ask pair → started/done notices, project AND workspace card (`workspace-run`) | T7 |
| `400` bad/missing pair · `409` non-proposed card | T7 |
| `409` in flight, never during grace · `429` at 3 global | T6 |
| stop idempotent | T6 |
| `DELETE` removes rows + directory | T5 (+ T7 while-followed) |
| attachment validation (`400`/`413`, UTF-8, NUL) | T6 |
| `GET /api/ask/models` | T5 |
| settings (ask-only POST root guard, ranges, `settingsState` keys) | **P1-complete** — fences only |
| `api-ask-vendor-assets` (200/type/nosniff, importable, pins, 404 no-store) | T1 |
| `ask-follow` (bare emitter → exact notices, no flooding) | T3 |
| R-F route-level `MOCK_ASK` regression | T6 (turn AND title call, via T2) |
| preflight failure after `200 {runId}` → "Run failed" notice, card `failed` (spec §11) | T7 (ghost-workflow test; B-8's attach-ordering case) |
| regression fences list | Task 8 step 2 |

## Verification ledger (P2 planning, 2026-08-22)

| claim | status |
|---|---|
| `marked@18.0.10` → `lib/marked.esm.js` via `import.meta.resolve`, NO default export, sync `parse` | **verified empirically** (scratch install at the exact pin) |
| `dompurify@3.4.14` → `dist/purify.es.mjs`, default-exports factory | **verified empirically** |
| both vendor files self-contained ESM (data:-URL importable); lock integrities as quoted in T1 | **verified empirically** |
| baseline 3166/3166 (~90 s) at `1b02d87b`; 387 test files | **verified** (clean clone, `npm ci`, full run) |
| P1 exports match the §17 contract, zero renames; B-1…B-8 as-built facts | **verified** (A2 import-check + code read; B-1 and B-6 exercised empirically) |
| mock `ask` role strips `[worca context]` before scenario pick AND echo; `dontAsk` alone selects the safe arm; limit scenarios reject | **pinned by P1 tests** (`claude-runner-ask-mock`) |
| server anchors (seam `:997-999`, vendor `:616-649`, WS `:207-257`, `bootMaintenance` `:3580`, `_testing` `:3679`) | **verified at `1b02d87b`** (A1) — hints only; anchor = quoted code |
| `agentgen-api`/`scan-api` hello assertions tolerate the new `ask` key (they read `msg.runs`) | **verified** (A4 read the assertions) |
| paid CLI probes needed for P2 planning | **none** (adjudicated; $0 spent — npm-registry only). Real-CLI end-to-end stays P4's manual gate |
| the whole plan, executed | **v1 EXECUTED TWICE** (2026-08-22/23): D1 (T1–T4, 23-mutation audit) and D2 (T1–T8, 16-mutation audit) — every implementation hunk verbatim except the two server fixes now folded in (artifacts import, `askRunFromPipelineRow`); v1's counts landed exactly at every task; final state 3222/0 twice + all T8 checks green (v2's counts shift only for the tests the audits added) |
| `/api/run` never forwards `auto` → a real mock run parks at the clarify HITL gate indefinitely | **verified** (D2: 60 s+ parked; 518 ms to `done` with the auto-answer pump; `test/api-sources.test.mjs:179` records the same) |
| `POST /api/workflows` validates agent keys (`validateWorkflow`) — a ghost-key workflow must be written via `writeWorkflow` (store stamps only) | **verified** (route source + `test/api-workflows.test.mjs:79`; re-exec: `writeWorkflow({name:'Ghost',…})` → `wf_ghost`, no validation, run emits `Run failed: Preflight failed:` exactly) |
| v2 re-executed end to end by a third zero-context agent | **verified** — every hunk verbatim, counts 3171/3173/3183/3198/3208/3217/3225 + double 3225 exact, all anchors exact, T3 audit tests mutation-proven sole catchers; 17 suite runs, flakes = ENOTEMPTY class only (now reaped) |
| cold Fable fresh-eyes on v2 | 1 CRITICAL (phantom `ws.projects` → empty members line), 2 MAJOR (create-time title clobber; 409/429 TOCTOU), 9 minor — ALL folded into v3 with three pinning tests; its "checked, holds" list re-confirmed R-C/§6.6/§6.2/§7.5/§8.1 fidelity and B-1…B-8 |
| every v3-new delta, in the leftover v2 clone | **verified green-with / red-without** by a fourth agent: members pin red on the phantom-field revert; M1 test red on the gate revert; four files 10/10 · 11/11 · 9/9 · 15/15 and `npm test` **3228/0 first try**; the teardown fix measured (exit 1 in 1 s with failures printed vs a 45 s alarm-killed hang pre-fix). Its one finding — the original Promise.all M2 race test passed on the UNFIXED code (the window is macrotask-atomic; instrumented: a `setImmediate` probe armed between the top checks and the registration never fires) — is folded in: the reserved-slot test above replaces it |

**v1 soft spots — all RESOLVED by the dry runs:** (1) pipeline rows are RAW snake_case and `branch` is a JSON document → `askRunFromPipelineRow` (Task 6) is the fix, folded in; (2) `createThread({title})` IS supported (`store.mjs:67`) — the create + `updateThread` composition is kept anyway (twice dry-run-verified; switching would churn a green path); (3) `listAttachments` is `ORDER BY created_at, id` — the `.slice(-5)` assumption was CORRECT; (4) the `Run finished — "title" · done · 3m12s · $0.42` wording is this plan's contract (spec §9.5 wants "status / duration / cost / link" without exact copy) — P3 renders `notice.text` verbatim, so do not "fix" the wording without updating T3's tests.

## Self-review (done while writing)

1. **Spec coverage:** every §16 P2-row item has a task — `turn` (T4), `askJobs` (T5), REST routes (T5/T6/T7), WS subscribe/hello (T5), startup sweeps (T5), `follow` + `/api/run` link (T3/T7), `GET /api/ask/models` (T5), vendor routes (T1), docs (zero-delta, Task 8). Every §8.1 route row implemented; §6.2 lifecycle steps 1–10 land in T4 (5–10) and T6 (1–4); §7.4 titles split route/turn per D13; §7.5 deletion order in T5's DELETE.
2. **Placeholder scan:** no TBD/TODO/"adapt as needed"; every step carries full code and a run command with expected red/green.
3. **Type consistency:** `createAskTurn` opts in T4 = T6's call site (field-for-field); `stampAskFrames(threadId, job)` defined T5, used T6; `flipCard` defined T7, used by T7's seam + dismiss; `attachRunFollower` deps in T3 = T7's wiring (`post({kind,text,href})`, `updateStatus({pipelineId?,status?,phase?,cardFailed?})`, `onDetached`); `resolveEsmAsset` name matches T1's test; the `ask*` import aliases in T5's Hunk A cover every store call used in T5–T7.
4. **Counts:** 3166 → T1 3171 → T2 3173 → T3 3183 → T4 3198 → T5 3208 → T6 3219 → T7 3228. (v1's 3181/3196/3206/3215/3222 landed exactly in both dry runs and v2's 3183/3198/3208/3217/3225 landed exactly in the full re-execution; v3 adds the fresh-eyes pinning tests — M1 named-title, M2 concurrency in T6, the `resolveAskContext` members pin in T7.)
5. **v1 → v2 review wave (2026-08-22/23):** two executed dry runs — D1 (T1–T4 in a reset clone, 23 mutations: every functional `turn.mjs`/`follow.mjs`/vendor mutation a test could see was caught; 4 survivors → 2 closed by the new `ask-follow` tests, 2 proven unobservable and resolved by deleting the dead `costOverride` plumbing and keeping the `timedOut`-first ordering as documented style) and D2 (T1–T8 in a fresh clone, 16 mutations: 11 caught; survivors closed by the write-order asserts in T6's attachments and T7's pair-validation tests, the dismiss-broadcast observation, and the new preflight-failure test). Every correction is folded in: the three T4 fixtures now mirror the runner's signal pre-check (`waitAbort`) and bound the settle-race hang; T6's `framesFor` filters job frames by `seq`; the title asserts split deterministic-vs-D13; T7's fixture uses `projectPaths` + two members and the HITL auto-answer pump. Anchor fixes: `claude-runner.mjs:247`, `orchestrator.mjs:2627`, WS parse `:219`, ask section `:2823`, `/api/run` mutual-exclusion `:793`.
6. **v2 → v3 (2026-08-23):** (a) a third zero-context agent re-executed v2 end to end — every implementation hunk verbatim, every count exact (…3225 double), every anchor exact; the T3 spot-mutations proved both audit tests are each the SOLE catcher of their survivor. Its harness findings are folded in: the red-step teardown wedge (`closeAllConnections()` does not destroy upgraded WS sockets → bounded close + `--test-force-exit` on RED runs), the `ask-api-cards` teardown reap (`maxRetries` rm — a stopped orchestrator still flushes artifacts), the two-artifacts-imports wording, the npm-banner wording, T7's actual red count, the ` ` transcription-hazard note, and the A1–A3 placement resolutions. (b) a cold Fable fresh-eyes pass found what execution cannot: C1 CRITICAL — the workspace `members:` header line read a phantom `ws.projects` field (`readWorkspace` has only `projectPaths`/`projectKeys`; every workspace turn shipped `members: -` with a green suite) → basename mapping + a `_testing.resolveAskContext` pin test; M1 — a create-time thread title was clobbered by the D13 background title (`titleWasAuto` gate + test); M2 — the 409/429 check-then-register window (a fourth verifier then proved it macrotask-atomic today — every await in it resolves in microtasks — so the reservation stands as defence-in-depth with the null-`messageId` guards it requires, pinned by a reserved-slot test that IS red on the unfixed code, replacing a Promise.all race test that passed on it); and nine minors (all folded: contract-block additions for P3, the attachments-header double-list/order fix with `currentMessageId`, the eager restored-notice deviation documented, the `/api/run` card-state re-check, the §9.5 budget wording, the DAG-edge justification, the assembly-failure cleanup with `askFinishMessage`, the R-D no-signal Q&A entry, the Q&A 15 provenance).

## Clarifications (Q&A)

Decisions recorded so downstream agents treat them as answered, not open:

1. **Q: Where is the branch/worktree setup?** — A: Deliberately absent (user decision, 2026-08-22): the execution vehicle provides the checkout; this plan assumes the P1 tip `1b02d87b` + `npm ci` and contains no git-setup task.
2. **Q: Which base does P2 build on?** — A: Stacked on the P1 branch at `1b02d87b` (user decision). Merge to `dev` stays behind the P4 gate (spec §15).
3. **Q: Who adds `marked`/`dompurify`?** — A: P2, exclusively, exact pins `18.0.10`/`3.4.14` (adjudicated: single lockfile owner; P3 never touches `package.json`). Verified empirically 2026-08-22 incl. integrities.
4. **Q: How is R-F satisfied for the title call, given `generateTitle` has no marker seam (B-1)?** — A: Task 2 adds a `permissionMode` pass-through; the ask title call passes `'dontAsk'`, which the P1 runner routes to the safe `mockAsk` arm and which is strictly tighter in real mode. Markers stay mandatory for every `buildAskSpawnOptions` spawn (both attempts).
5. **Q: One `AskTurn` per resume retry, or two?** — A: One instance, internal ≤2-attempt loop, fresh reducer per attempt, one AbortController + one 15-minute timer spanning both; `restoredPrompt` prebuilt by the route (adjudicated).
6. **Q: Why three API test files when spec §12 says `ask-api`?** — A: Task-sized green gates (`ask-api-threads`/`-messages`/`-cards`); recorded deviation, `api-ask-vendor-assets` keeps its spec name.
7. **Q: 400-vs-404 for malformed ids?** — A: Spec §8.1 (400 on shape) wins over the house 404 style — deliberate, documented in Global Constraints; do not "fix".
8. **Q: Sweep cadence?** — A: Boot-only, inside `bootMaintenance()` (spec §6.2.1 wording; adjudicated); tests call the exported function.
9. **Q: Ring buffer?** — A: Own `ASK_JOB_MAX_BUFFER = 5000` + copied splice (the `bufferEvent` constant), not a `bufferEvent` reuse (that helper is welded to runId tagging and pendingQuestion replay).
10. **Q: `GET /api/ask/models` caching?** — A: None — fresh `askCatalog()` per request (the `/api/config` precedent; D12-consistent freshness).
11. **Q: Docs?** — A: Zero P2 edits — P1 already wrote the `ask/` roots and the sandbox paragraph; Task 8 verifies; README bullet is P4.
12. **Q: Paid probes during P2 planning?** — A: Adjudicated unnecessary; $0 spent. The remaining real-CLI checks are P4's manual gate (spec §12).
13. **Q: Why does every card test that runs a real mock pipeline drive an "auto-answer pump"?** — A: `/api/run` never forwards the orchestrator's `auto` flag, so a server-started mock run parks at `wf_default`'s clarify HITL gate indefinitely (D2-measured; `test/api-sources.test.mjs:179` records the same fact). The pump mirrors orchestrator auto mode (`orchestrator.mjs:2802-2818`). This is a harness fact, not a P2 defect — controlling live runs from the chat is a spec §3 non-goal.
14. **Q: Where did `costOverride` go?** — A: Deleted as dead code (D1 mutation e6): the P1 reducer sets `lastResult` and `sawResult` together, so `summary.costUsd` is already `null` whenever no `result` frame arrived — the §6.2.8 rule holds with zero plumbing, and `test/ask-events.test.mjs` pins the coupling.
15. **Q: Why is the preflight-failure test's workflow written via `writeWorkflow` instead of `POST /api/workflows`?** — A: The route validates agent keys against the live registry (it imports `validateWorkflow` separately and calls it with `loadAgentRegistry(AGENTS_DIR)` — `validateWorkflow` is NOT a `workflows.mjs` export); `writeWorkflow` itself only stamps id/dates, so the store path is the only one that can produce a workflow whose key stops resolving — exactly the production scenario (agent removed / plugin disabled after creation) the preflight gate exists for.
16. **Q: Why does the title call omit `signal`, when R-D's option list includes it?** — A: Deliberate, recorded deviation: §7.4 fires the title after ANY terminal status — including a user stop, at which point the turn's controller is already aborted and a passed signal would kill the call before it spawns (`runClaude` pre-checks the signal). Side effect: a title call can spend ~$0.01 of real haiku even after a stop/delete; the `onlyIf` rename guard and the deleted-thread 0-row UPDATE make it harmless.
17. **Q: Why is the "Context restored from history" notice added BEFORE the retry instead of after a successful restore (§6.2.7's order)?** — A: Deliberate, recorded deviation: eager posting makes the notice visible while the retry streams (R-A persistence); if the retry then fails, the notice stays above the `ask-error` — acceptable.
18. **Q: Why `--test-force-exit` on the RED runs of Tasks 5–7?** — A: A red WS test never reaches `ws.close()`, and `closeAllConnections()` does not destroy upgraded sockets, so `server.close()`'s callback never fires; the bounded teardown makes the failures print and the flag makes the process exit. Green runs and `npm test` never need it (verified).
