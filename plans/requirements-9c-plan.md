# Requirements (9c: choosing the harness and model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A product owner picks the harness, a model that runs on it and an effort for each feature (New feature, then the feature page). Every Requirements step (interview rounds, Look closer, attachment reads, Feature chat) runs on that choice through a new shared module, the **helper call**. Worca says plainly what a harness can't do, books billed, estimated and unknown costs honestly, and never moves a running feature to Claude by itself.

**Architecture:** A new `src/core/helper-call/` (three files: `profiles.mjs` pure per-engine launch options and words, `cost.mjs` the cost chain and the D9 estimates, `index.mjs` the call itself) sits under Requirements' existing `callModel`, which becomes a thin wrapper; on Claude it still builds its options with `interviewCallOptions`, so every Claude launch stays byte-identical. A feature stores its choice in `req_features.model_json`; `src/core/requirements/model-choice.mjs` resolves the default (the Default engine, its Everyday coding model, its default effort) and a feature's model. Non-Claude calls reuse what Worca already proved: Chat's lockdown (`askLockdown`, as `title.mjs auxTextCall`), the classifier's read-only repo look (`sandbox: 'read-only'` + `writeFilesMcpConfig`), Chat's readiness gate (`chatEngineGate`) and Chat's prices (`chatModelRates`). The page gains the Who interviews selects, a recommendation note, a model chip with a small dialog, a switch confirm, step notices and a cost dialog.

**Tech Stack:** Node ESM, `node:sqlite`, `node:test`, jsdom, Express (`ui/server.mjs`), vanilla DOM (`ui/public/*.mjs`), the engine adapters through `runClaude({ engine, … })` (`src/core/claude-runner.mjs`).

**Spec:** `plans/requirements-9c-design.md` (D1–D16, §3–§10; it wins where this plan is unclear, except for the gaps below, which need the user's OK where marked). Earlier parts: A1.1 `plans/requirements-a11-design.md`, A3, A7, A8 `plans/requirements-a8-design.md`.

**Visual reference (UI tasks):** the Claude Design canvas "Requirements model choice" (boards 1–8): board 1 New feature (Who interviews, the note), board 2 the harness list open, 3 the feature page's model chip and dialog, 4 the switch confirm, 5 the thread's step lines, notices and errors, 6 Cost of this feature, 7 the fallback on New feature, 8 board 2 in dark (tokens only). They use upstream classes (`card`, `btn`, `btn-sm`/`btn-mini`, `chip`, `hint`, `select-wrap`, `input select`, `badge`); inline styles are layout hints.

## Spec gaps found (resolutions this plan builds; ⚑ = confirm with the user before Task 8 / Task 11)

1. ⚑ **The Product brief belongs to a project or workspace, not a feature** (`brief-job.mjs` runs per scope). The spec puts "the brief's code look" in the repo profile but never says which choice it uses. Resolution: the brief runs on the **scope's default** (D3, with D4's fallback), resolved when Create or Refresh is pressed; on a harness that can't read the repo, Create and Refresh are disabled and the brief card says "<Harness> can't read the repo, so it can't make a Product brief. Pick a harness that can as your Default engine." The brief's existing model line ("<model> · counts toward your limit") gains " on <harness>".
2. **Today's look estimate has history only per model in `req_turns`**, not in the ledger. D9 (1) therefore reads `req_turns` (`kind = 'orientation'` for `look`, `kind = 'round'` for `round`, `model = ?`, `cost_usd > 0`), as `recentLookCosts` does today; only D9 (2) reads the new ledger token columns. Otherwise every estimate would read "no estimate yet" right after the upgrade.
3. **Requirements' mock mode returns before the runner** (`mockEnabled({})` in `orient`, `runRound`, `answer`, `runRead`), so `recordMockSpawn` (spec §8.5) never sees a Requirements call. The whole-step tests use Requirements' own seam, a fake `runClaudeImpl` that records `engine`, `sandbox`, `askLockdown`, `mcpConfigPath` and `model` (the same facts `recordMockSpawn` records).
4. **Native `<select>` options are one line**, and every upstream picker (and `engine-locks.mjs`) is a `<select>`. Board 2's second line goes into the option text: "Gemini CLI (beta) · Can't read the repo", "Copilot (beta) · Not installed" (disabled), "Qwen Code (beta) · Not signed in" (disabled); a broker-locked engine keeps `lockEngineOptions`' suffix ": off while the credential broker is on".
5. **Readiness reasons are free text** (`codexPreflight`: "codex is not signed in — run `codex login`"; `cliRefusal`: "cannot run <bin> (ENOENT) — …"). Short words come from one mapper, `notReadyWords(engine, reason)` (Task 4): "not signed in" → "Not signed in" / "<Harness> isn't signed in. Sign in, or change the model."; "cannot run" → "Not installed" / "<Harness> isn't installed. Install it, or change the model."; a broker refusal → "<Harness> is off while the credential broker is on. Change the model."; anything else → "Not ready" / "<Harness> can't run this step: <reason>. Change the model, or try again." (the last three sentences are new copy in the spec's words).
6. **The orientation and brief system prompts name Claude's tools** ("Glob finds files…, Read reads one file (use paths under the working directory…)"). On Codex and Copilot the look reads through Worca's files server (`read_file`, `grep`, `glob`, absolute paths), as the classifier's `repoRoot` sentence does. Resolution: on Claude the prompts stay byte-identical; on Codex and Copilot one tools sentence is swapped (Task 7), in the classifier's wording.
7. **"Sent to <company>"** (D11) is clear only for engines that sign in to one provider. `companyOf(engine, model)`: claude → Anthropic, codex → OpenAI, copilot → GitHub, gemini → Google, qwen → Alibaba Cloud; a model with its own endpoint (catalog entry `custom` global/plugin with `hasEnv`, `bridged`, or `upstream`), and every Goose or OpenCode model → "the provider of <model>". Two choices are "the same company" only when both resolve to the same named company.
8. **A file skipped for the harness** (an image, a PDF, text over 24 KB on a non-Claude harness) is stored as a `failed` read with `error.code = 'SKIPPED_ENGINE'` and the D12 words; the view draws it as a grey line with **Read again**, not the red failed line. When the feature later switches to a harness that can read it, the switch queues those files for a read (Task 8). Under A8-D8 a `failed` file is not "unasked", so nothing else changes.
9. **The models list**: §5 puts the harness list in `GET /api/requirements`. That list route is read on every list paint, and `createAskModels().askCatalog()` reads the catalog and plugin secrets. Resolution: `GET /api/requirements` carries only `interview: { default, fallbackReason }`; the selects load `GET /api/requirements/models` (flag-gated) when the form or the dialog opens.
10. **Cost of this feature** (board 6) needs per-step rows the API doesn't have yet: `GET /api/requirements/:seq/costs` (Task 10).
11. **Rate limits**: the helper call wraps every attempt in `withRecoveryRetry({ classes: ['rate_limit'] })` on every engine, Claude included. The options each attempt sends are unchanged (the golden test compares options), but a Claude call that hit a rate limit now waits and retries instead of failing at once.
12. **No lint script in this repo** (`package.json` has none; the CLAUDE.md biome/ruff lines belong to the Python worca-cc). The gates are `node tools/test.mjs` and the CDP proof.
13. **The removed-model words**: board 5 says "…used the project default.", D13 says "…used the default." The spec wins: "<model> is no longer available, so this step used the default."

## Global Constraints

- One commit per task; subjects start `Requirements:`; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Claude path byte-identical.** With Claude chosen (and for every feature from before 9c, `model_json` NULL), every call passes `interviewCallOptions`' exact options to the runner; Task 1's golden test must stay green unchanged from Task 1 to the end. No new option, flag or env on a Claude launch.
- **Never a silent switch to Claude once a feature runs.** A step whose harness isn't ready stops with D13's error; only the New feature form (D4) may pick Claude, visibly, before anything runs.
- **Cursor is never offered**: not in the harness list, refused by the API (`400`), refused by `helperCall` before any spawn.
- **Cost words:** "$0.03" billed, "≈$0.04" estimated, "cost unknown" (never $0.00). The feature's chip shows "≈" as soon as any part is estimated. Estimated costs count toward the Requirements budget; unknown costs are booked as `amount_usd = 0`, `cost_kind = 'unknown'` and counted separately.
- **The `requirements` flag off = nothing shows**: every new route is in `REQUIREMENTS_ROUTES` behind `requireFlag('requirements')`; no new frame or page part renders without the flag.
- **Notice and error strings (verbatim):**
  - D12: "Repo not read: <Harness> can't read the repo." · "<file> skipped: <Harness> gets files as text only." · "<file> skipped: it is too large for <Harness>." · "<Harness> keeps its own copy of this step in its history on this computer." · "Cost estimated: <Harness> reports none."
  - D13: "<Harness> isn't signed in. Sign in, or change the model." · "<model> is no longer available, so this step used the default." · buttons **Change the model**, **Try again**.
  - D4: "Your default engine is Cursor, which can't run Requirements, so this starts on Claude." · "Codex isn't signed in, so this starts on Claude." · "Codex is off while the credential broker is on, so this starts on Claude." · "Copilot isn't installed, so this starts on Claude." (the pattern: "<Harness> <reason>, so this starts on Claude.").
  - `<Harness>` is `engineLabel(engine)` ("Gemini CLI"); option text uses `engineChoiceLabel` ("Codex (beta)").
- **Offered harnesses**: Claude plus every `ASK_ENGINES` engine whose chat descriptor has a lockdown (`chatDescriptor(e).lockdown()`), exactly askCatalog's `available`. Capabilities: `repo` on claude, codex, copilot (`ENGINES[e].helpers`); `files` (images, PDFs, text over 24 KB) on claude only; `keepsCopy` on copilot, gemini, goose, qwen; `reportsCost` = `ENGINES[e].cost`.
- **Security unchanged (D16):** ticket and file text stay `asData`; the file-read guard stays Claude-only (`runClaude` already throws for `readGuard` on another engine); no file tool for attachments on other harnesses; no-tools steps on other harnesses use `askLockdown: true, envScrub: true`.
- **Schema v89** (`SCHEMA_VERSION` 88 → 89), additive columns in `INCREMENTAL_COLUMNS`, the rung `if (current < 89) repairSchemaGaps(db, schemaGaps(db));` after v88's; if `dev` took 89 by merge time, renumber (Task 15).
- **Paid calls:** every automated test uses a fake `runClaudeImpl` or mock mode. The manual real-harness check (Task 15) needs the user's OK first and a check of `~/.worca-cc` model routing, naming which account pays.
- **Windows test baseline:** many upstream tests already fail on this laptop on clean `dev` (`test/` files that spawn POSIX tools, symlinks, signals). Before blaming this branch, run the failing file on the base (`git -C ../worca-cc-dev …` or a clean `dev` worktree) and compare file by file; POSIX-only tests run in WSL Ubuntu.
- One test file: `node tools/test.mjs test/<file>.test.mjs`; each task runs its own files and the Requirements files it touches. Full suite: `npm test`. Browser proof: `npm run verify:requirements`.
- `style.css`: tokens only (no hex, no `rgba(`); new rules go inside the existing Requirements block (it ends right before `/* ── marketplace P3 ── */`).
- No local machine paths in shipped files, tests, docs or this plan's code.

## Review Focus

1. **Claude unchanged** (Task 1's golden options; Tasks 5–8 change nothing there).
2. **No silent switch, no Cursor**: `helperCall` refuses Cursor and a not-ready engine before any spawn; no code path picks Claude after creation (Tasks 4–7).
3. **Lockdown and read-only hold**: every non-Claude `none` call carries `askLockdown: true, envScrub: true, sandbox: 'read-only'`; every `repo` call `sandbox: 'read-only'` with the files server and no shell; `file` never runs off Claude (Task 4).
4. **Money**: billed / estimated / unknown booked once each, unknown rows add $0, the budget sums are unchanged for old rows, estimates read the right model (Tasks 3, 9).
5. **D2**: a feature keeps the exact choice it was created with; a changed Default engine moves no existing feature (Tasks 6, 10).
6. **Flag off**: every new route 404s (Task 10).

## Files

| File | Task(s) | Responsibility |
|---|---|---|
| `test/requirements-9c-golden.test.mjs` (new) | 1 | today's Claude launch options per step, frozen |
| `src/core/db.mjs`, `src/core/requirements/store.mjs`, `src/core/requirements/spec.mjs`, `src/core/cost-budget.mjs`, `src/core/stats.mjs` | 2, 9 | v89 columns, the store fields, ledger rows with engine/step/kind/tokens, zero-amount filters |
| `src/core/helper-call/cost.mjs` (new) | 3 | the cost chain of one result, D9 estimates |
| `src/core/helper-call/profiles.mjs` (new) | 4 | offered harnesses, capabilities, launch options per engine × profile, words |
| `src/core/helper-call/index.mjs` (new) | 5 | `helperCall`: gate, retry, timeout, abort, events, cost, notices, Codex no-save |
| `src/core/engines/codex.mjs` | 5 | `removeCodexThread(thread)` |
| `src/core/requirements/model-choice.mjs` (new) | 6 | the default (D3, D4), a feature's model (D13), validation, the switch |
| `src/core/requirements/interview.mjs`, `round.mjs` | 7 | `callModel` over `helperCall`; rounds and looks on the feature's choice |
| `src/core/requirements/helper.mjs`, `attachment-job.mjs`, `brief-job.mjs`, `brief.mjs` | 8 | Feature chat, reads, the brief on the helper call |
| `src/core/requirements/routes.mjs`, `ui/server.mjs` | 10 | API |
| `ui/public/requirements-view.mjs`, `ui/public/requirements-model.mjs` (new), `ui/public/app.js`, `ui/public/style.css` | 11–13 | the screens |
| `tools/verify-requirements-cdp.mjs`, `docs/requirements.md`, `docs/changelog/unreleased.md` | 14 | proof, docs |

---

### Task 1: The regression guard — today's Claude launches, frozen

Record exactly what each Requirements step hands the runner today, before anything changes.

**Files:**
- Create: `test/requirements-9c-golden.test.mjs`

**Interfaces:** none produced; later tasks must keep this file green **without editing it**.

- [ ] **Step 1: Write the test.** A fake runner that records options, the same shape as `fakeRunner` in `test/requirements-interview.test.mjs`. Normalize only what varies per run (temp paths and prompt text), never a key's presence:

```js
// test/requirements-9c-golden.test.mjs — 9c's guard: on Claude every Requirements step hands the runner exactly
// today's options (plans/requirements-9c-design.md §8.1). Written before any 9c change; never edited after.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
beforeEach(() => { delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; });

const h = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
/** Paths and prompts vary per run: keep every key, replace those values by a stable token. */
function normalize(o) {
  const out = {};
  for (const [k, v] of Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) {
    if (k === 'signal' || k === 'onEvent') continue;
    if (k === 'cwd' || k === 'readGuard') out[k] = '<path>';
    else if (k === 'prompt') out[k] = '<prompt>';
    else if (k === 'systemPrompt') out[k] = h(v);
    else if (k === 'allowedTools') out[k] = v.map((t) => (t.startsWith('Read(') ? 'Read(<copy>)' : t));
    else out[k] = v;
  }
  return out;
}
```

  Then one `test()` per step, each driving the real job with `deps({ runClaudeImpl })` exactly as the existing tests do, and asserting `deepEqual(normalize(calls[0]), EXPECTED_<STEP>)`:
  - `round`: `submitAnswers` after a first round (`test/requirements-interview.test.mjs` pattern).
  - `look`: `startOrientation` with `lookAtCode: true` and `openLook` returning a temp dir.
  - `brief look`: `makeBrief` / the brief job with a fake `defaultBranchRef` (`test/requirements-brief-job.test.mjs` pattern).
  - `inline read`: `addAttachments` with a 1 KB `.txt` (`test/requirements-attachment-job.test.mjs` pattern; a fake runner that returns the read JSON and emits a `result` with no tool calls).
  - `guarded read`: the same with a 1 KB `.png` (the fake runner returns `readGuardDecisions` covering its events, as that file's tests do).
  - `Feature chat`: `sendMessage` (`test/requirements-helper-job.test.mjs` pattern).
- [ ] **Step 2: Fill each `EXPECTED_<STEP>` from a first run** on the untouched base (print `JSON.stringify(normalize(calls[0]), null, 2)` once, paste it as a literal, remove the print). The six literals are the contract.
- [ ] **Step 3: Run** `node tools/test.mjs test/requirements-9c-golden.test.mjs` → 6 pass.
- [ ] **Step 4: Commit** `Requirements: freeze today's Claude launch options (9c guard)`.

---

### Task 2: Schema v89 and the store fields

**Files:**
- Modify: `src/core/db.mjs` (`SCHEMA_VERSION = 89`; `INCREMENTAL_COLUMNS`; the v89 rung after v88's), `src/core/requirements/store.mjs`, `src/core/requirements/spec.mjs`, `src/core/cost-budget.mjs`, `src/core/stats.mjs`
- Test: create `test/db-migrate-v89.test.mjs`; modify `test/requirements-store.test.mjs`, `test/cost-budget-requirements.test.mjs`, `test/requirements-helper-store.test.mjs`; any test that pins the ledger's columns (`grep -l "req_cost_ledger" test/`)

**Interfaces (produced):**
- Columns (all nullable): `req_features.model_json TEXT`; `req_cost_ledger.engine TEXT, step TEXT, cost_kind TEXT, input_tokens INTEGER, output_tokens INTEGER`; `req_turns.engine TEXT, notices_json TEXT`; `req_helper_messages.engine TEXT, notices_json TEXT`; `req_attachments.read_engine TEXT`.
- `spec.mjs`: `TURN_KINDS` gains `'model'` (a switch event: payload `{ engine, model, effort, from: { engine, model, effort } }`).
- `store.mjs`: feature objects gain `model` (`{ engine, model, effort } | null`); `createFeature({ …, model = null })`; `updateFeature` accepts `model` (JSON field); `appendTurn(seq, { kind, payload, model, costUsd, engine = null, notices = null })`; turns read back `engine` and `notices` (`[]` when NULL); `insertHelperMessage({ …, engine = null, notices = null })` and its rows carry them; `updateAttachment` accepts `readEngine`; `recentStepCosts(step, { model, limit = 10 })` (`step` `'look'` → `kind = 'orientation'`, `'round'` → `kind = 'round'`; `cost_usd > 0`, newest first); `recentStepTokens(step, limit = 10)` → `[{ input, output }]` from ledger rows with both token columns set; `featureCostRows(seq)` → ledger rows of the feature, oldest first, with their turn's kind and payload, attachment name, helper message id; `unknownCostCount(fromMs)`.
- `cost-budget.mjs`: `recordRequirementsCostDelta({ …, engine = null, step = null, costKind = 'billed', inputTokens = null, outputTokens = null })` — writes a row when `amountUsd > 0`, **and** when `costKind === 'unknown'` (then `amount_usd = 0`); never a row for `amountUsd <= 0` otherwise.
- Readers that must not see `$0` rows: `recentBriefCosts`, `recentHelperCosts` gain `AND amount_usd > 0`; `stats.mjs requirementsTotals` counts `COUNT(DISTINCT CASE WHEN amount_usd > 0 THEN NULLIF(feature_seq, 0) END)`.

- [ ] **Step 1: Write `test/db-migrate-v89.test.mjs`** on the v88 file's pattern: a fresh DB has the nine columns; a DB at 88 (drop the nine with `ALTER TABLE … DROP COLUMN`, stamp 88, migrate) reaches 89 with them and `shape(db)` equal to a fresh one; one stamped 89 without them is repaired.
- [ ] **Step 2: Run it** → FAIL (no such column).
- [ ] **Step 3: Add the columns:**

```js
  req_cost_ledger:        { brief_id: 'INTEGER', attachment_id: 'TEXT', helper_message_id: 'INTEGER',
                            engine: 'TEXT', step: 'TEXT', cost_kind: 'TEXT', input_tokens: 'INTEGER', output_tokens: 'INTEGER' },   // …; v89: 9c (engine, step, billed|estimated|unknown, tokens)
  req_features:           { early_start_reason: 'TEXT', model_json: 'TEXT' },   // v85: …; v89: the feature's { engine, model, effort } (9c D2); NULL = before 9c
  req_turns:              { engine: 'TEXT', notices_json: 'TEXT' },   // v89: the harness a step ran on, its D12 notices
  req_helper_messages:    { engine: 'TEXT', notices_json: 'TEXT' },   // v89: as req_turns
  req_attachments:        { fetch_json: 'TEXT', read_engine: 'TEXT' },   // v88: …; v89: the harness that read the file
```

  and the rung (with a comment in the v88 style) `if (current < 89) repairSchemaGaps(db, schemaGaps(db));`.
- [ ] **Step 4: Store and ledger** as in Interfaces; tests: a feature round-trips `model`; a turn and a helper message round-trip `engine` and `notices`; an `unknown` row is written with 0 and leaves `requirementsWindowedSpendUsd` unchanged; a `billed` row with amount 0 is still skipped; `recentBriefCosts`, `recentHelperCosts` and the stats feature count ignore a 0 row; `recentStepCosts('look', { model })` reads only that model's orientation turns.
- [ ] **Step 5: Run** `node tools/test.mjs test/db-migrate-v89.test.mjs test/db-migrate-v88.test.mjs test/requirements-store.test.mjs test/cost-budget-requirements.test.mjs test/requirements-helper-store.test.mjs test/requirements-9c-golden.test.mjs` → pass.
- [ ] **Step 6: Commit** `Requirements: schema v89, the harness and cost kind of every step (9c)`.

---

### Task 3: `helper-call/cost.mjs` — the cost chain and D9's estimates

**Files:**
- Create: `src/core/helper-call/cost.mjs`
- Modify: `src/core/requirements/routes.mjs` (`lookCostUsd` reads `stepEstimate`; its any-model fallback goes)
- Test: create `test/helper-call-cost.test.mjs`; modify `test/requirements-api.test.mjs` where it pinned the any-model fallback

**Interfaces (produced):**
- `ratesFor(engine, model, deps = {})` → per-Mtok rates or null: Claude `liveCostRates(model)` (`config.mjs`), else `chatModelRates(chatDescriptor(engine), model)` (`ask/chat-price.mjs`).
- `costOfResult({ engine, model, event, rates })` → `{ costUsd, costKind, inputTokens, outputTokens }`: an event with `costUsd != null` → `resolveModelCost(model, Number(event.costUsd), event.usage ?? null)`, kind `'billed'` (NaN → `'unknown'`, 0); else, with `rates` and `isPriceableUsage(event.usage)` → `estimateCost(event.usage, rates)`, `'estimated'`; else `{ costUsd: 0, costKind: 'unknown' }`. Tokens: `usage.input_tokens ?? usage.input`, `usage.output_tokens ?? usage.output`, else null.
- `addCost(a, b)` → combined (`billed` + `estimated` = `estimated`; any `unknown` part with no money = `unknown`; money with an unknown part keeps the money's kind and `unknownParts: 1`).
- `stepEstimate({ engine, model, step }, deps = { recentStepCosts, recentStepTokens, ratesFor })` → `{ usd: number, kind: 'history' | 'priced' } | { usd: null, reason: 'no-estimate' | 'no-price' }`: (1) median of `recentStepCosts(step, { model })`, rounded to 4 places; (2) else the medians of `recentStepTokens(step)` input and output, priced with `ratesFor(engine, model)` (`estimateCost({ input_tokens, output_tokens }, rates)`); no rates → `no-price`; (3) else `no-estimate`.

- [ ] **Step 1: Tests first:** the chain on a Claude result (billed), a Codex result with an override price (billed via `resolveModelCost`), a Gemini result without cost but with usage and Models-page rates (estimated), no usage (unknown, 0), no rates (unknown); `addCost` table; `stepEstimate`: own history wins; another model's history never used for (1); tokens priced for a model without history; `no-price` for a model without rates; `no-estimate` with nothing.
- [ ] **Step 2: Run** `node tools/test.mjs test/helper-call-cost.test.mjs` → FAIL (module missing).
- [ ] **Step 3: Implement** (median helper shared with `stepEstimate`):

```js
// src/core/helper-call/cost.mjs — what one helper call cost, and what a step will cost (plans/requirements-9c-design.md D9, D14).
import { resolveModelCost, estimateCost, isPriceableUsage, liveCostRates } from '../config.mjs';
import { chatModelRates } from '../ask/chat-price.mjs';
import { chatDescriptor } from '../engines/chat.mjs';

const median = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round4 = (n) => Math.round(n * 1e4) / 1e4;

export function ratesFor(engine, model) {
  if (!engine || engine === 'claude') return liveCostRates(model);
  return chatModelRates(chatDescriptor(engine), model);
}
```

  then `costOfResult`, `addCost`, `stepEstimate` exactly as in Interfaces.
- [ ] **Step 4:** `routes.mjs` `lookCostUsd(model)` becomes `stepEstimate({ engine: 'claude', model, step: 'look' }).usd` (Task 10 passes the feature's engine once features have one); the "all recent looks" fallback is deleted (the spec's reason: it showed two models the same price).
- [ ] **Step 5: Run** `node tools/test.mjs test/helper-call-cost.test.mjs test/requirements-api.test.mjs test/requirements-9c-golden.test.mjs` → pass.
- [ ] **Step 6: Commit** `Requirements: the helper call's cost chain and per-model estimates (9c D9)`.

---

### Task 4: `helper-call/profiles.mjs` — harnesses, capabilities, launch options, words

Pure: no spawn, no fs.

**Files:**
- Create: `src/core/helper-call/profiles.mjs`
- Test: create `test/helper-call-profiles.test.mjs`

**Interfaces (produced):**
- `PROFILES = ['none', 'repo', 'file']`.
- `requirementsEngines(deps = { lockdown: (e) => !!chatDescriptor(e)?.lockdown() })` → `['claude', …ASK_ENGINES with a lockdown]`, never `'cursor'`.
- `capabilities(engine)` → `{ repo: ENGINES[e].helpers === true, files: e === 'claude', keepsCopy: ['copilot', 'gemini', 'goose', 'qwen'].includes(e), reportsCost: ENGINES[e].cost === true, deletesSession: e === 'codex' }`.
- `launchOptions({ engine, profile, cwd, systemPrompt, prompt, model, effort, mcpConfigPath = null, maxTurns = null })` → the runner options for a **non-Claude** engine (Claude never comes here: `helperCall` builds Claude's with `interviewCallOptions`):

```js
const BASE = (o) => ({ engine: o.engine, cwd: o.cwd, systemPrompt: o.systemPrompt, prompt: o.prompt, model: o.model,
  ...(o.effort ? { effort: o.effort } : {}), permissionMode: 'acceptEdits', spawnKind: 'aux', sandbox: 'read-only' });
export function launchOptions(o) {
  if (!o.engine || o.engine === 'claude') throw new TypeError('launchOptions: Claude calls use interviewCallOptions');
  if (o.engine === 'cursor') throw new TypeError('launchOptions: Cursor is never offered');
  if (o.profile === 'none') return { ...BASE(o), askLockdown: true, envScrub: true, allowedTools: [] };   // Chat's lockdown (title.mjs auxTextCall)
  if (o.profile === 'repo') {
    if (!capabilities(o.engine).repo) throw new TypeError(`launchOptions: ${o.engine} cannot read the repo`);
    if (!o.mcpConfigPath) throw new TypeError('launchOptions: a repo look needs the files server');
    return { ...BASE(o), mcpConfigPath: o.mcpConfigPath, allowedTools: [...REPO_LOOK_TOOLS], tools: [...REPO_LOOK_TOOLS],
      ...(o.maxTurns ? { maxTurns: o.maxTurns } : {}) };   // the classifier's read-only look (auto/classify.mjs)
  }
  throw new TypeError(`launchOptions: profile ${JSON.stringify(o.profile)} runs on Claude only`);
}
```

- `stepNotices({ engine, profile, files = [], estimated = false })` → D12 strings in order: repo skipped, each file skipped (kind not text → "gets files as text only"; text over `REQ_ATTACH_LIMITS.inlineBytes` → "it is too large for"), keeps-copy, cost estimated.
- `notReadyWords(engine, reason, { broker = false })` → `{ short, sentence, startsOn }` per gap 5 (`short` for the option text, `sentence` for D13, `startsOn` for D4: "<Harness> isn't signed in, so this starts on Claude." etc.; Cursor: "Your default engine is Cursor, which can't run Requirements, so this starts on Claude.").
- `companyOf(engine, entry)` per gap 7; `sameCompany(a, b)`.
- `harnessLine(engine)` → board 1/2 hints: "Codex reads the repo read-only. Files go to it as text." · "<Harness> can't read the repo. Files go to it as text." · Claude: `null`.

- [ ] **Step 1: Tests:** every offered engine × profile (Claude throws; `none` on codex, copilot, gemini, goose, opencode, qwen has `askLockdown: true, envScrub: true, sandbox: 'read-only', allowedTools: []` and no `tools`, no `mcpConfigPath`; `repo` on codex and copilot has the files server and `REPO_LOOK_TOOLS`; `repo` on gemini throws; `file` off Claude throws; cursor throws everywhere); `requirementsEngines` never lists cursor and drops an engine whose lockdown is off; each notice string verbatim; `notReadyWords` for the four reason shapes; `companyOf` table.
- [ ] **Step 2: Run** `node tools/test.mjs test/helper-call-profiles.test.mjs` → FAIL.
- [ ] **Step 3: Implement**; imports: `ENGINES`, `engineLabel` from `src/shared/engine-switch.mjs`; `ASK_ENGINES` from `src/core/model-env.mjs`; `chatDescriptor` from `src/core/engines/chat.mjs`; `REPO_LOOK_TOOLS` from `src/core/auto/classify.mjs`; `REQ_ATTACH_LIMITS` from `src/core/requirements/attachments.mjs`.
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `Requirements: helper-call profiles per harness (9c §4)`.

---

### Task 5: `helper-call/index.mjs` — the call

**Files:**
- Create: `src/core/helper-call/index.mjs`
- Modify: `src/core/engines/codex.mjs` (export `removeCodexThread`)
- Test: create `test/helper-call.test.mjs`; modify `test/codex-*.test.mjs` only to add `removeCodexThread`'s cases (in `test/codex-thread-home.test.mjs` if it exists, else a new `test/codex-remove-thread.test.mjs`)

**Interfaces:**
- Consumes: Task 3 (`costOfResult`, `addCost`, `ratesFor`), Task 4 (`launchOptions`, `capabilities`, `stepNotices`, `notReadyWords`, `requirementsEngines`).
- Produces: `helperCall(args, deps = {})` with `args = { engine, model, effort, profile, cwd, systemPrompt, prompt, timeoutMs, signal = null, claudeOptions = null, files = [], roots = null, maxTurns = null }` → `{ text, engine, model, costUsd, costKind, inputTokens, outputTokens, notices, events, readGuardDecisions? }`. Throws `HelperCallError` with `code` (`'NOT_READY' | 'NOT_OFFERED' | 'TIMEOUT' | …`), `message` (the D13 sentence for `NOT_READY`), `docsUrl` (the chat descriptor's `notReady.docsUrl`), and `costUsd` / `costKind` of what was spent. `deps`: `{ run = runClaude, gate = chatEngineGate, mock = () => mockEnabled({}), writeFilesMcpConfig, removeCodexThread, scratch }`.
- `removeCodexThread(thread)` (codex.mjs): deletes `findCodexRollout(h, thread)` under every known home (`knownCodexHomes()`); returns whether one was removed; never throws.

**Behaviour:**
1. `engine === 'claude'`: `claudeOptions` (built by the caller with `interviewCallOptions`) go to `run` **unchanged** plus `signal` and `onEvent`. No gate (today's behaviour).
2. Else: refuse `cursor` and engines not in `requirementsEngines()` (`NOT_OFFERED`, before any spawn); `gate(chatDescriptor(engine), { model, mock: deps.mock() })` — a refusal becomes `NOT_READY` with `notReadyWords(engine, refusal.message).sentence`; `repo`: `mcpConfigPath = writeFilesMcpConfig({ dir: join(scratch, 'files-mcp'), roots, name: 'requirements' })`; options from `launchOptions`.
3. Every attempt through `withRecoveryRetry(fn, { classes: ['rate_limit'], signal })` (`src/core/recovery-backoff.mjs`); the timeout aborts the call's own controller, as `callModel` does today, and a timeout throws `code: 'TIMEOUT'` with "Worca got no reply within N seconds. Try again." (today's words).
4. `onEvent: normalizingOnEvent(e => …)`: collect events; for each `result` event add `costOfResult({ engine, model, event: e, rates })` (rates read once); a `session` event on Codex keeps its thread id (`sessionId` minus `CODEX_SESSION_PREFIX`).
5. After the call, success or failure: on Codex with a thread id, `removeCodexThread(thread)`; when it returns false, the notices get the keeps-copy line for Codex too.
6. `notices = stepNotices({ engine, profile, files, estimated: costKind === 'estimated' })`.

- [ ] **Step 1: Tests** (fake `run`, fake `gate`): Claude options pass through byte-identical (deepEqual to the input plus `signal`/`onEvent`); cursor refused with no spawn; a gate refusal "codex is not signed in — run `codex login`" → `NOT_READY` "Codex isn't signed in. Sign in, or change the model." with no spawn; `none` on gemini launches with `askLockdown`; `repo` on codex writes the files server for the look's roots; a rate-limit error then success spawns twice; a timeout throws `TIMEOUT` with the cost so far; a Gemini result with usage and rates → `estimated` plus "Cost estimated: Gemini CLI reports none."; a Codex call removes its session file (temp home with a fake rollout) and has no keeps-copy notice, and keeps the notice when no file was found; aborting via `signal` stops the call.
- [ ] **Step 2: Run** `node tools/test.mjs test/helper-call.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `removeCodexThread` (codex.mjs, next to `findCodexRollout`) and `helperCall`.
- [ ] **Step 4: Run** `node tools/test.mjs test/helper-call.test.mjs test/helper-call-profiles.test.mjs test/helper-call-cost.test.mjs test/requirements-9c-golden.test.mjs` → pass.
- [ ] **Step 5: Commit** `Requirements: the helper call (9c §4)`.

---

### Task 6: `requirements/model-choice.mjs` — the default, a feature's model, the switch

**Files:**
- Create: `src/core/requirements/model-choice.mjs`
- Test: create `test/requirements-model-choice.test.mjs`

**Interfaces:**
- Consumes: Task 4 (`requirementsEngines`, `notReadyWords`), `createAskModels` (`src/core/ask/models.mjs`: `askCatalog`, `validateModelEffort`), `resolveRunEngine` (`src/core/settings-cascade.mjs`), `roleModelFor` / `resolveRoleModel` (`src/core/model-roles.mjs`), `interviewModel` (`interview.mjs`), `engineReadiness` (`src/core/engines/readiness.mjs`).
- Produces:
  - `scopeOf(f)` → `{ projectKey }` for a project, `{ workspace: true }` for a workspace.
  - `defaultChoice(scope, d = {})` → `{ choice: { engine, model, effort }, fallbackReason: string | null }`: engine = `resolveRunEngine(scope).engine`; when it is not in `requirementsEngines()`, or `engineReadiness()` says not ready / broker, the choice is Claude and `fallbackReason` = `notReadyWords(...).startsOn` (Cursor: the Cursor sentence). Claude: `interviewModel(d)` (its effort, `medium` by default). Another engine: model = `roleModelFor(engine, 'requirementsInterview')?.model` when the catalog runs it on that engine, else askCatalog's per-engine default; effort `null` ("Default effort").
  - `recommendedModel(engine)` → `resolveRoleModel(engine, 'deep')?.model ?? null`.
  - `featureModel(f, d = {})` → `{ engine, model, effort, notice: string | null }`: `f.model == null` → Claude with `interviewModel(d)` (today); a stored model the catalog no longer lists (`validateModelEffort(model, effort ?? 'medium', { engine })` says unknown model) → the engine's default from `defaultChoice` restricted to the same engine, notice "<model> is no longer available, so this step used the default."; an effort the model no longer takes → `null` effort, no notice.
  - `checkChoice({ engine, model, effort })` → `{ ok: true, choice } | { ok: false, error }`: engine offered (`cursor` → "Cursor can't run Requirements."), model runs on it, effort among `effortsOn` (`null` allowed).
  - `setFeatureModel(seq, choice, { by }, d)` → writes `model`, appends a `model` turn with `from`, then calls `d.afterSwitch?.(seq, choice.engine)` (Task 10 wires it to Task 8's `queueSkippedReads`, gap 8); refused while busy, archived or starting (the A1 lock words).

- [ ] **Step 1: Tests:** a project whose Default engine is codex → codex with its Everyday coding model and `effort: null`; claude → `interviewModel()`'s pair (`medium`); cursor → Claude + the Cursor sentence; codex not signed in → Claude + "Codex isn't signed in, so this starts on Claude."; broker on → Claude + "Codex is off while the credential broker is on, so this starts on Claude."; a NULL feature → today's pair; a removed model → the default + notice; `checkChoice` refusals; `setFeatureModel` writes the turn and refuses while busy; D2: changing `run.engine` after creation leaves `featureModel(f)` unchanged.
- [ ] **Step 2: Run** `node tools/test.mjs test/requirements-model-choice.test.mjs` → FAIL.
- [ ] **Step 3: Implement** (inject every reader through `d` for the tests, the defaults being the real ones).
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `Requirements: the default and a feature's harness and model (9c D2–D4, D13)`.

---

### Task 7: Rounds and looks on the feature's choice

**Files:**
- Modify: `src/core/requirements/interview.mjs` (`callModel`, `orient`, `runOrientation`, `runRound`, `failTurn`), `src/core/requirements/round.mjs` (the non-Claude tools sentence)
- Test: modify `test/requirements-interview.test.mjs`; create `test/requirements-9c-steps.test.mjs`

**Interfaces:**
- `callModel(d, { kind, cwd, prompt, model, timeoutMs, signal, engine = 'claude', profile = null, files = [], roots = null, ...overrides })`: Claude → `interviewCallOptions(kind, …)` exactly as today, then `helperCall({ engine: 'claude', claudeOptions, … }, { run: d.runClaudeImpl })`; another engine → `helperCall({ engine, profile: profile ?? (kind === 'look' ? 'repo' : 'none'), … }, { run: d.runClaudeImpl })`. It returns today's `{ text, costUsd, events, readGuardDecisions? }` **plus** `{ engine, costKind, inputTokens, outputTokens, notices }`.
- `orient`: `const fm = await featureModel(f, d)` replaces `interviewModel(d)`; when `!capabilities(fm.engine).repo` → no call, `{ summary: '', files: [], skipped: 'engine', notices: ['Repo not read: <Harness> can't read the repo.'] }`; the look turn stores `engine` and `notices`.
- `runRound`: `featureModel(f, d)`; the round turn stores `engine`, `notices` (plus `fm.notice` when set).
- A `HelperCallError` with `NOT_READY` becomes an error turn `{ code: 'NOT_READY', message, job, docsUrl }`, status as today's failure, nothing charged.
- `round.mjs`: `orientationSystemPrompt(engine)` returns `ORIENTATION_SYSTEM_PROMPT` for Claude (the same string object) and, for Codex and Copilot, the same text with the tools sentence replaced by: "You can only read, with the read_file, grep and glob tools (absolute paths under the folder the message names). You cannot run commands or change anything, and you have only a few steps: answer before they run out."

- [ ] **Step 1: Tests** (fake `runClaudeImpl` recording options): a Codex feature's round runs with `engine: 'codex', askLockdown: true`; its look with `sandbox: 'read-only'` and a files server rooted at the look's cwd and the Codex tools sentence; a Gemini feature's look makes no call and stores `skipped: 'engine'` with the notice; a Gemini round stores "Gemini CLI keeps its own copy of this step in its history on this computer."; a not-signed-in Codex round stores the `NOT_READY` error turn and spends nothing; a NULL feature runs exactly as before (golden test green).
- [ ] **Step 2: Run** `node tools/test.mjs test/requirements-9c-steps.test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node tools/test.mjs test/requirements-9c-steps.test.mjs test/requirements-interview.test.mjs test/requirements-round.test.mjs test/requirements-9c-golden.test.mjs` → pass.
- [ ] **Step 5: Commit** `Requirements: rounds and looks run on the feature's harness (9c)`.

---

### Task 8: Feature chat, attachment reads and the brief on the helper call

**Files:**
- Modify: `src/core/requirements/helper.mjs` (`answer`), `src/core/requirements/attachment-job.mjs` (`readCall`, `runRead`, `failureOf`, new `queueSkippedReads`), `src/core/requirements/brief-job.mjs` (`briefModel`, `briefCall`), `src/core/requirements/brief.mjs` (the non-Claude tools sentence, as Task 7)
- Test: modify `test/requirements-helper-job.test.mjs`, `test/requirements-attachment-job.test.mjs`, `test/requirements-brief-job.test.mjs`; extend `test/requirements-9c-steps.test.mjs`

**Interfaces:**
- `answer`: `featureModel(f, d)`; `callModel(d, { kind: 'round', engine: fm.engine, … })`; the Worca row stores `engine` and `notices`; a `NOT_READY` error becomes the row's error `{ code: 'NOT_READY', message }` (the D13 sentence).
- `readCall(e, row)`: for a feature file `featureModel(getFeature(owner.id), d)`; for a brief document the scope's `defaultChoice(scope, d).choice`. Off Claude: an inline text (≤ 24 KB) runs `profile: 'none'` with today's prompt; anything else makes no call and throws `SKIPPED_ENGINE` (code) with message "<name> skipped: <Harness> gets files as text only." or "<name> skipped: it is too large for <Harness>."; `failureOf` keeps that code and message; `updateAttachment(id, { readEngine })` on success.
- `queueSkippedReads(seq, engine, d)`: re-queues the feature's `failed` rows with `error.code === 'SKIPPED_ENGINE'` that `engine` can read (Claude: all; others: text ≤ 24 KB).
- Brief (gap 1, ⚑): `briefModel(d, scope)` → `defaultChoice(scope, d).choice`; when its engine cannot read the repo, `makeBrief` / refresh refuse with `RequirementsError('CONFLICT', "<Harness> can't read the repo, so it can't make a Product brief. Pick a harness that can as your Default engine.")`; on Codex and Copilot `briefCall` runs `profile: 'repo'` with the swapped tools sentence.

- [ ] **Step 1: Tests:** Feature chat on Codex locks down; on Gemini stores the keeps-copy notice; a PNG on a Codex feature is not sent anywhere and shows the skipped words; a 30 KB text on Codex says "too large"; a 2 KB text on Gemini is read inline with `askLockdown`; switching the feature to Claude re-queues the PNG (`queueSkippedReads`); a brief with Default engine codex runs read-only with the files server; with Default engine gemini Create is refused with the sentence; every Claude case still matches the golden test.
- [ ] **Step 2: Run** the four test files → FAIL on the new cases.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node tools/test.mjs test/requirements-helper-job.test.mjs test/requirements-attachment-job.test.mjs test/requirements-brief-job.test.mjs test/requirements-9c-steps.test.mjs test/requirements-9c-golden.test.mjs` → pass.
- [ ] **Step 5: Commit** `Requirements: Feature chat, file reads and the brief on the chosen harness (9c)`.

---

### Task 9: Booking — engine, step, cost kind and tokens on every row

**Files:**
- Modify: `src/core/requirements/interview.mjs` (`charge`, `chargeHelper`, `failTurn`), `src/core/requirements/brief-job.mjs` (`book`), `src/core/requirements/attachment-job.mjs` (the read's booking), `src/core/requirements/routes.mjs` (`requirementsSpend` gains `unknownSteps`)
- Test: extend `test/requirements-9c-steps.test.mjs`, `test/cost-budget-requirements.test.mjs`

**Interfaces:**
- `charge(seq, turnId, { costUsd, costKind, engine, model, step, inputTokens, outputTokens })` (and `chargeHelper(seq, cost, writeRow)` with the same object): `addFeatureCost` only when `costUsd > 0`; `recordRequirementsCostDelta` always, so an `unknown` call leaves a $0 row. `step`: `'look'` (orientation and its errors), `'round'`, `'read'`, `'brief'`, `'chat'`.
- `requirementsSpend()` → `{ windowUsd, totalLimitUsd, resetPeriod, unknownSteps: unknownCostCount(windowStartMs) }`.

- [ ] **Step 1: Tests:** a billed Codex round writes `engine 'codex', step 'round', cost_kind 'billed'` and its tokens; an estimated Gemini round counts toward `requirementsWindowedSpendUsd`; an unknown Qwen round adds a $0 row, leaves the spend unchanged and raises `unknownSteps` by 1; a failed round books its spend with its kind.
- [ ] **Step 2–4:** run → FAIL, implement, run `node tools/test.mjs test/requirements-9c-steps.test.mjs test/cost-budget-requirements.test.mjs test/requirements-interview.test.mjs test/requirements-9c-golden.test.mjs` → pass.
- [ ] **Step 5: Commit** `Requirements: book each step's harness, cost kind and tokens (9c D14)`.

---

### Task 10: API (§5)

**Files:**
- Modify: `src/core/requirements/routes.mjs` (`REQUIREMENTS_ROUTES`, `featureView`, the list route, the create route, new routes), `src/core/requirements/import.mjs` (`createImported` takes `model`)
- Test: create `test/requirements-9c-api.test.mjs`; modify `test/requirements-api.test.mjs`

**Interfaces (all behind `requireFlag('requirements')`, `{ error }` with 400 / 404 / 409 on failure):**
- `GET /api/requirements` → `interview: { default: { engine, model, label, effort }, fallbackReason }` (replaces today's `{ model, label, effort, source }`), `spend.unknownSteps`.
- `GET /api/requirements/models` (new, before `/:seq`) → `{ harnesses: [{ engine, label, choiceLabel, ready, short, reason, broker, repo, files, keepsCopy, reportsCost, company }], models: askCatalog().models, defaults: { <engine>: { model, effort: null | string } }, recommended: { <engine>: model | null } }`.
- `GET /api/requirements/estimates?engine=&model=` (new) → `{ look, round, recommended: { model, look, round } | null }`, each `{ usd } | { usd: null, reason }` from `stepEstimate`.
- `POST /api/requirements` — body `model: { engine, model, effort }` (required from 9c's page; when absent, `defaultChoice` is stored, so an API client keeps working); `checkChoice` → 400 with its error. Also on the ticket path.
- `PUT /api/requirements/:seq/model` (new) — same body, `setFeatureModel(seq, choice, { by }, { ...d, afterSwitch: (s, e) => queueSkippedReads(s, e, d) })`, answers the feature view; 409 while busy, archived or starting. `lookCostUsd` now passes the feature's engine (`featureModel(f, d).engine`).
- `GET /api/requirements/:seq/costs` (new) → `{ rows: [{ step: 'look' | 'round' | 'read' | 'chat', label, ranOn, usd, kind }], billedUsd, estimatedUsd, unknownSteps, totalUsd, anyEstimated }` with labels "Code look", "Round N" (N = the round's number among the feature's round turns), "File read · <name>", "Feature chat"; `ranOn` "<model label> on <Harness>".
- Feature view: `feature.model` (the stored choice or the NULL-feature's resolved Claude pair with `legacy: true`), `feature.modelLabel` ("GPT-5.6 Sol on Codex"), `feature.anyEstimated`; every turn and helper message keeps `engine` and `notices`; `interview` keeps its shape for the privacy note, from `featureModel`.

- [ ] **Step 1: Tests:** each route with the flag off → 404; `POST` with `engine: 'cursor'` → 400 "Cursor can't run Requirements."; with a model not on the harness → 400; `PUT …/model` stores the choice and appends a `model` turn; 409 while busy; `GET …/costs` sums billed, estimated and unknown; `GET /models` never lists cursor and marks a broker-locked engine `broker: true`.
- [ ] **Step 2–4:** run → FAIL, implement, run `node tools/test.mjs test/requirements-9c-api.test.mjs test/requirements-api.test.mjs test/requirements-attachments-api.test.mjs test/requirements-helper-api.test.mjs test/requirements-import-api.test.mjs` → pass.
- [ ] **Step 5: Commit** `Requirements: the model choice API (9c §5)`.

---

### Task 11: New feature — Who interviews, the note, the fallback (boards 1, 2, 7, 8)

**Files:**
- Create: `ui/public/requirements-model.mjs` (pure DOM helpers shared by Tasks 11 and 12)
- Modify: `ui/public/requirements-view.mjs` (`paintNew`, `costHint`, `privacyNote`), `ui/public/style.css`
- Test: create `test/requirements-view-model.test.mjs`; modify `test/requirements-view.test.mjs`, `test/requirements-view-files.test.mjs`

**Interfaces (`requirements-model.mjs`):**
- `whoInterviews(doc, { models, harnesses, choice, defaults, onChange })` → `{ el, value(): { engine, model, effort } }`: a `fieldset` with legend "Who interviews" and three labelled `<select>`s "Harness", "Model", "Effort". Harness options: `choiceLabel` plus " · Can't read the repo" when `!repo`, " · <short>" and `disabled` when not ready; then `lockEngineOptions(select)`. Model: `appendModelGroups(select, models.filter((m) => runsOn(m, engine)), { engine })`. Effort: "Default effort" (`value=''`) then `effortsOn(entry, engine)`; hidden when the model has `noEffort`. Changing the harness sets Model to `defaults[engine].model` and Effort to ''.
- `recommendationNote(doc, { engine, picked, recommended, estimates, labels })` → the info-icon line: "Requirements work best with a strong model, like <rec> on <Harness>: about $X for a code look, about $Y a round." (`for a code look` part left out when `!repo`; a missing part "no estimate yet"; a model without price "cost unknown"); plus "You picked <model>: about $X for a code look, about $Y a round." and a **Use <rec>** button when `picked !== recommended`; only the first sentence when the recommended model is picked; no recommendation part when `recommended` is null (then "About $X for a code look, about $Y a round.").
- `defaultLine(doc, { choice, defaultChoice, labels, onUse })` → "Your default: <model> on <Harness>. Use the default" only when they differ.
- `fallbackLine(doc, reason)` → the grey D4 line.

**Page:** `paintNew` loads `GET /api/requirements/models` once per form open, fills Who interviews from `interview.default`, shows `fallbackLine` when `interview.fallbackReason`, the harness hint (`harnessLine`), the note (estimates from `GET /api/requirements/estimates`, refetched on each change), and sends `model` with the create. Today's sentence "Worca interviews with … · …" goes; the file line keeps "reads each file once before round 1, about $X a file" inside the note's words for files. `privacyNote` takes the choice: Claude keeps today's exact text; another harness: "Worca sends each file to <model> on <Harness> to read it. Text is checked for keys and passwords first. <Harness> gets files as text: PDFs and images are skipped."

- [ ] **Step 1: Tests (jsdom):** the three selects and their labels; a cursor-free harness list with the option texts of gap 4; a broker lock's suffix; changing the harness refills Model and resets Effort; the note's three shapes (other model picked, recommended picked, no recommendation); "Use Opus 5.5" sets the model; the fallback line; the create body carries `model`; the privacy note on Claude is byte-identical to today's.
- [ ] **Step 2–4:** run → FAIL, implement, run `node tools/test.mjs test/requirements-view-model.test.mjs test/requirements-view.test.mjs test/requirements-view-files.test.mjs` → pass.
- [ ] **Step 5: Commit** `Requirements: Who interviews on New feature (9c boards 1, 2, 7)`.

---

### Task 12: Feature page — the model chip, its dialog, the switch confirm (boards 3, 4)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (the header chips next to `${usd(f.costUsd)} so far`), `ui/public/requirements-model.mjs`, `ui/public/app.js` (the view's `deps` gain `confirm: (o) => confirmModal(o)`), `ui/public/style.css`
- Test: extend `test/requirements-view-model.test.mjs`

**Interfaces:**
- `modelChip(doc, f, onOpen)` → a `button.chip` with `aria-haspopup="dialog"`, text `f.modelLabel` and a chevron, after the cost chip.
- `modelDialog(doc, { … })` → role=dialog "Model for this feature", sub "Interviews, code looks, file reads and Feature chat use it.", `whoInterviews`, the harness hint, "Applies from the next step. Steps already done keep the model that ran them.", `defaultLine`, `recommendationNote`, **Cancel** / **Save**.
- `switchConfirm({ from, to, harnesses, files, feature })` → `{ title, message, confirmLabel } | null` in `engineSwitchConfirm`'s format (`ui/public/ask-engine.mjs`): title "Switch this feature to <Harness>?", lead "Worca's next step runs on <Harness> with <model>. Steps already done keep their answers and their cost.", then "\n\nWhat changes:\n• …" with only the lines that apply: "<Harness> can't read the repo: Look closer and the code look for the Product brief are skipped." · "Attached files go as text: <a> and <b> are skipped." · "<Harness> keeps its own copy of each step in its history on this computer." · "Your feature's description, answers and attachments are sent to <company>." · "<Harness> reports no cost. Worca estimates it from list prices where it can."; confirm label "Switch to <Harness>". `null` (no confirm) when the target loses nothing and `sameCompany`.
- Save: `switchConfirm` → `deps.confirm(…)` when not null → `PUT /api/requirements/:seq/model` → repaint.

- [ ] **Step 1: Tests:** the chip's text and position; the dialog's parts; Codex → Gemini lists repo, the two skipped files, keeps-copy, Google, cost; Codex → Claude with nothing lost asks only "sent to Anthropic"; Claude → Claude (another model) asks nothing and saves; Cancel saves nothing.
- [ ] **Step 2–4:** run → FAIL, implement, run `node tools/test.mjs test/requirements-view-model.test.mjs test/requirements-view.test.mjs` → pass.
- [ ] **Step 5: Commit** `Requirements: change a feature's model, with the switch confirm (9c boards 3, 4)`.

---

### Task 13: The thread and the cost list (boards 5, 6)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (round and look cards, the error block at `f.lastError`, Feature chat rows, the cost chip, the list's spend line), `ui/public/style.css`
- Test: extend `test/requirements-view-model.test.mjs`; modify `test/requirements-view-helper.test.mjs`

**Behaviour:**
- Each round, look and Feature chat reply shows "<model label> on <Harness> · <cost>" right-aligned (`$0.03`, `≈$0.04`, `cost unknown`; an error with nothing spent: "nothing spent").
- Notices: grey `hint` lines with the info icon under the step's head (`ul aria-label="What this step could not do"`), never amber.
- A `NOT_READY` error turn: title "<Look closer | Round N> stopped", the D13 sentence, **Change the model** (opens the dialog of Task 12), **Try again** (today's retry), and the descriptor's docs link "How to sign in to <Harness>" when `docsUrl` is present.
- A `model` turn: one plain row "You switched this feature to <model> on <Harness> · <time>".
- A `SKIPPED_ENGINE` file: grey line with **Read again** (gap 8).
- The header cost chip: `${anyEstimated ? '≈' : ''}${usd(f.costUsd)} so far` as a `button` (`aria-haspopup="dialog"`) opening **Cost of this feature**: the table (Step / Ran on / Cost) from `GET …/costs`, the "So far" row, and the sentence "$X billed and ≈$Y estimated, plus N step(s) with cost unknown. The Requirements budget counts ≈$T of $L this month; the step(s) with cost unknown <is|are> not counted." (parts with zero left out; "this week" for a weekly budget; without a limit: "The Requirements budget counts ≈$T this month.").
- The list's spend line adds " plus N step(s) with cost unknown" when `spend.unknownSteps > 0`.

- [ ] **Step 1: Tests:** each piece above with fixed feature JSON (no server); the error block's buttons; the cost dialog's sums and sentence for billed only, estimated, and unknown.
- [ ] **Step 2–4:** run → FAIL, implement, run `node tools/test.mjs test/requirements-view-model.test.mjs test/requirements-view-helper.test.mjs test/requirements-view.test.mjs` → pass.
- [ ] **Step 5: Commit** `Requirements: step lines, notices, errors and the cost list (9c boards 5, 6)`.

---

### Task 14: Whole steps as Codex, Gemini CLI and Copilot; browser proof; docs

**Files:**
- Modify: `test/requirements-9c-steps.test.mjs`, `tools/verify-requirements-cdp.mjs`, `docs/requirements.md` ("Which model interviews" becomes "Choosing the harness and model"), `docs/changelog/unreleased.md`

- [ ] **Whole steps** (fake `runClaudeImpl` standing in for each harness, gap 3): for codex, gemini and copilot one feature runs create → look → round → file read → Feature chat; assert each launch's `engine`, `sandbox`, `askLockdown`, `mcpConfigPath`, the stored notices, and `GET …/costs`.
- [ ] **Browser proof** (mock mode): New feature shows Who interviews and the note; the harness list has no Cursor; changing the harness refills Model; the feature chip opens the dialog; Codex → Gemini shows the confirm; the cost chip opens the cost dialog; light and dark at 1280 px and 390 px (the selects stack under 600 px). `npm run verify:requirements` → all checks passed.
- [ ] **Docs:** "Choosing the harness and model" (the three selects, the default, the fallback, what each harness can't do, the copy kept in a harness's history, cost words, changing a running feature), in product language; the changelog entry.
- [ ] **Run** `node tools/test.mjs test/requirements-9c-steps.test.mjs` → pass; check that docs and plans carry no local path.
- [ ] **Commit** `Requirements: whole-step proof, docs and changelog (9c)`.

---

### Task 15: Whole-branch check and the real harnesses

**Files:** whatever this task finds to fix (no new feature code).

- [ ] Merge `dev`. If it took schema 89, renumber this rung past it (the `INCREMENTAL_COLUMNS` comments, the rung, `test/db-migrate-v89.test.mjs` and the design's §3 line move together).
- [ ] `npm test` on the branch; run every failing file on clean `dev` too (Windows baseline). A file that fails here and passes there is this branch's to fix; record both counts.
- [ ] The full suite in WSL Ubuntu from a clean export of the committed tree, so the POSIX-only tests run.
- [ ] `npm run verify:requirements` → all checks passed.
- [ ] **Real harnesses (manual, paid — only after the user's OK):** first read `~/.worca-cc` model routing (Vertex or other env on the models used) and tell the user which account pays. Then on a test project: one round, a Look closer, a 2 KB text read and a Feature chat message on **Claude**, **Codex** and **Gemini CLI** (installed in WSL Ubuntu); record per step the launch, the notices, the cost and its kind, and that Codex's session file is gone afterwards. The report goes into the PR description.
- [ ] Fix what is this branch's in the task module that owns it, its test first; commit `Requirements: whole-branch fixes (9c)` if anything changed.

---

## Appendix: spec points → tasks

| Spec point | Task(s) |
|---|---|
| D1 reasons | (context) |
| D2 one stored choice per feature; pre-9c features as today | 2, 6, 10 |
| D3 default = Default engine, Everyday coding, default effort; A1.1 row kept | 6, 11 |
| D4 fallback to Claude on the form only | 4, 6, 11 |
| D5 Who interviews always shown; "Use the default" | 11 |
| D6 harness list (no Cursor, greyed reasons, broker suffix) | 4, 10, 11 |
| D7 models and efforts per harness; no admin limits | 6, 10, 11 |
| D8 the recommendation note | 3, 6, 10, 11 |
| D9 estimates per model | 2, 3, 10 |
| D10 the chip and dialog; applies from the next step | 6, 10, 12 |
| D11 the switch confirm | 4, 12 |
| D12 notices, never Claude | 4, 5, 7, 8, 13 |
| D13 errors, removed model | 5, 6, 7, 13 |
| D14 cost words, cost list, budget | 3, 9, 10, 13 |
| D15 copies in a harness's history | 4, 5 |
| D16 security unchanged | 4, 5, 8 |
| §3 data | 2, 9 |
| §4 the helper call | 3, 4, 5, 7, 8 |
| §5 API | 10 |
| §6 screens (boards 1–8) | 11, 12, 13, 14 |
| §7 code changes, docs | 2–14 |
| §8 testing (8.1 guard, 8.2–8.6, 8.7 real harnesses) | 1, 3–14, 15 |
| §9 #981, #608, broker | 4, 6, 10 |
