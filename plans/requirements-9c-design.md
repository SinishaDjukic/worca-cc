# Requirements 9c: choosing the harness and model for Requirements

Date: 2026-11-10. Base: `dev` (0e006ee4d). Branch: `feat/req-9c-model-choice`. Part 9c of the requirements track.
Earlier parts: A1 `plans/requirements-design.md`, A1.1 `plans/requirements-a11-design.md` (the interview model setting),
A2, A3 (Feature chat), A7 (Product brief), A8 (attachments), A6 and A6.1; all on `dev`. The screens were agreed as a
mock first (Claude Design canvas "Requirements model choice", boards 1–8); this document is the build contract for them.

## 1. Goal

**A product owner chooses the harness and the model that run a feature's Requirements work.** Today every Requirements
call (interview rounds, Look closer, the Product brief, attachment reads, Feature chat) runs on the Claude harness,
with one model from the A1.1 setting. After 9c the product owner picks a harness, a model that runs on that harness
and an effort, on New feature and later on the feature page. Worca runs each step on that choice, says plainly what
the harness can't do, and never moves the work to Claude by itself.

The calls go through a new shared module, the **helper call** (`src/core/helper-call/`), so other features that make
one-off model calls can move onto it later (a follow-up issue, §10).

**Success:**
1. A feature created on Codex runs its rounds, Look closer, attachment reads and Feature chat on Codex; on Gemini CLI
   its rounds and Feature chat run there and the repo steps are skipped with a notice.
2. With Claude chosen, every call sends exactly what it sends today (byte-identical options, §8.1).
3. Every step names the model and harness that ran it and its cost: billed, estimated (≈) or "cost unknown".
4. A harness that is not ready, or a model that no longer exists, never leads to a silent switch.
5. With the `requirements` flag off nothing of this shows; a feature created before 9c keeps running as today.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **Why.** All three reasons count (question 1, answer D): another harness is a team's only tool; data must stay in-house; cost and fit per feature. |
| D2 | **One choice per feature: harness, model, effort.** Not per step (question 3). The feature stores the concrete choice it was created with, never "follow the default": changing your Default engine later does not move existing features. A feature created before 9c stores nothing and runs as today (Claude, `interviewModel()`). |
| D3 | **The default is the Default engine.** No separate Requirements setting, no new rows on the Models page, project settings or team policy. The New feature form fills Harness from the `run.engine` setting through the cascade (project → you → team), Model from that harness's Requirements slot (`roleModelFor(engine, 'requirementsInterview')`, i.e. its **Everyday coding** role), and Effort from that harness's default. On Claude the existing A1.1 "Requirements interview" row (`models.claude.requirementsInterview`, user-only) keeps working unchanged and is what `interviewModel()` returns, including its default effort `medium`. |
| D4 | **The default can't run Requirements → Claude, visibly, before anything runs.** When the Default engine is Cursor, not installed, not signed in, or off because the credential broker is on, the form picks Claude and shows one grey line: "Your default engine is Cursor, which can't run Requirements, so this starts on Claude." (other reasons: "Codex isn't signed in, so…", "Codex is off while the credential broker is on, so…", "Copilot isn't installed, so…"). When Claude isn't ready either, the form shows today's sign-in message. This happens only on the form; a running feature never switches by itself (D11). |
| D5 | **Who interviews is always visible.** The New feature form shows the three selects Harness, Model, Effort under **Who interviews** (board 1). Today's sentence "Worca interviews with Opus 5.5 at medium effort · …" goes away. "Your default: <model> on <harness>. Use the default" shows only when the choice differs from the default. |
| D6 | **The harness list.** Claude plus every engine with a verified Chat lockdown (`CHAT_ENGINES`, `src/core/engines/chat.mjs`); Cursor is therefore not listed. An engine that is not installed, not signed in or locked by the credential broker is greyed with its reason, using `engineLocks` / `ui/public/engine-locks.mjs` (": off while the credential broker is on"). The second line under a harness says what it can't do ("Can't read the repo"). Labels: `engineChoiceLabel` ("Codex (beta)"). |
| D7 | **The model and effort lists.** Model lists the models that run on the chosen harness (`appendModelGroups`, `ui/public/model-options.mjs`; the same `runsOn` check as #608), plugin models and bridged models included. Changing the harness fills Model with that harness's Everyday coding model. Effort lists only that model's efforts (`effortsOn`) with "Default effort" first, and is hidden for a model without any. No admin limits: team policy's **Allowed models** only warns and records, as for steps. |
| D8 | **The recommendation note** (board 1), with the info icon, under the selects: "Requirements work best with a strong model, like <deep> on <harness>: about $X for a code look, about $Y a round." `<deep>` is the chosen harness's **Deep thinking** role model (`resolveRoleModel(engine, 'deep')`). When another model is picked it adds "You picked <model>: about $X for a code look, about $Y a round." and a **Use <deep>** link. When the harness can't read the repo the code-look part is left out. Costs come from D9; a part without an estimate says "no estimate yet". |
| D9 | **Cost estimates per model** (question 5 and the 2026-11-10 follow-up, answer A). For a model and a step kind (`look`, `round`): (1) the median of that model's last 10 steps of that kind with a known cost; else (2) the median input and output tokens of the last 10 steps of that kind on any model, priced with that model's rates (`estimateCost(usage, perMtok)`, `src/core/config.mjs`; rates through the model's price in Models, plugin prices and the built-in list prices, as `chatModelRates`); else "no estimate yet". A model without a price is "cost unknown". Today's fallback to other models' looks (`lookCostUsd`, `routes.mjs`) is removed: it showed two models the same price. Tokens are stored from 9c on (§3). |
| D10 | **Changing the model of a running feature** (board 3). A chip after the cost chip names "<model> on <harness>"; it opens a small dialog "Model for this feature" with the same three selects, the same note, "Applies from the next step. Steps already done keep the model that ran them." and Save. A step already running keeps its model. Each step reads the feature's current choice when it starts. |
| D11 | **The switch confirm** (board 4), the shape of Chat's engine switch ("Switch this chat to X?"): "Switch this feature to <harness>?", one lead line, **What changes**, **Switch to <harness>**. It lists only the lines that apply: repo not read (code looks skipped, for this feature and for the Product brief), attached files that will be skipped by name, "keeps its own copy of each step in its history on this computer" (D15), "Your feature's description, answers and attachments are sent to <company>", and "reports no cost; Worca estimates it". Moving to a harness that can do as much, at the same company, asks nothing. |
| D12 | **What a harness can't do is skipped with a notice, never sent to Claude** (question 2, answer A). Notices are grey hint lines on the step (board 5), never amber: "Repo not read: Gemini CLI can't read the repo.", "<file> skipped: Gemini CLI gets files as text only.", "<file> skipped: it is too large for <harness>.", "Gemini CLI keeps its own copy of this step in its history on this computer.", "Cost estimated: Gemini CLI reports none." |
| D13 | **Errors** (board 5). Harness not ready: the step stops with "<Harness> isn't signed in. Sign in, or change the model." (and the not-installed and broker variants), **Change the model**, **Try again** and a help link; nothing is spent. A model removed from Models: the step uses the default (D3) and says "<model> is no longer available, so this step used the default."; the title jobs handle a removed model the same way. Rate and usage limits: the usual backoff, then **Try again**, as Feature chat today. Time limits and the strict reply check are unchanged, now on every harness. |
| D14 | **Cost words** follow Worca: "$0.03" billed, "≈$0.04" estimated, "cost unknown" (never $0.00) (`runCostLabel`). The feature's chip shows ≈ as soon as any part is estimated. **Cost of this feature** (board 6) lists each step, what it ran on and its cost, then "So far". Estimated costs count toward the Requirements budget; unknown costs can't, so the budget line adds "plus N steps with cost unknown". |
| D15 | **Copies in a harness's own history** (section 3, answer A). Claude: `--no-session-persistence` as today (file reads, asks, brief look, Feature chat). Codex: the call runs under a Worca-managed `CODEX_HOME` for Requirements (auth linked as `guardedCodexHome` does), and Worca removes that call's session files when it ends; if that can't be done on the installed codex, the step gets the "keeps its own copy" notice instead. OpenCode keeps none. Copilot, Gemini CLI, Goose, Qwen Code: the step runs and gets the notice. When a no-save option is verified for one of them later, its notice goes away. |
| D16 | **Unchanged for safety.** Ticket and file text stays marked as data. No-tools steps on other harnesses use Chat's lockdown (`askLockdown`). The A8 file-read guard stays Claude-only; other harnesses never get a file tool for an attachment. Worca stores no more prompt text than today. |
| D17 | **The code look is a step in the thread** (board 5). Today its result sits only in the folded card "What Worca found in the code" (`orientationBox`, `requirements-view.mjs`), and the texts name it four ways. From 9c the thread shows each code look as a step row like the rounds: "Code look · 3 files" with "<model> on <harness> · <cost>" on the right, the summary's first sentence, and **Show what it found**, which opens the folded card. One name everywhere: "code look". The card's title becomes "Code look: what Worca found"; the error row is "Code look stopped"; the switch confirm line is "<harness> can't read the repo: code looks are skipped, for this feature and for the Product brief." **Look closer** and **Look again** stay as the buttons that start one. A skipped look (D12) shows as a step row with its notice. |
| D18 | **The Product brief is made on a choice made each time** (board 9; the brief belongs to a project or workspace, not a feature). Its **Create the brief** box gains **Who makes it** (the same three selects, filled as D3) and the note for a brief ("A brief works best with a strong model, like <deep> on <harness>: about $X. You picked <model>: about $Y. Counts toward your limit." and **Use <deep>**), replacing today's "<model> · counts toward your limit". **⋯ › Refresh the brief** opens a small dialog "Refresh the brief" ("One look at <branch>, read-only, 3 to 5 minutes. Your edits are kept.") with the same selects, starting from what made the brief last time, the line "Last made with <model> on <harness>. Your default: <model> on <harness>. Use the default" (the default part only when it differs) and **Refresh the brief**. A brief needs the code, so a harness without repo reading is disabled in this list with "Can't read the repo"; when the Default engine is one, the box picks Claude and says "Your default engine is <Harness>, which can't read the repo, so this brief is made on Claude." The choice is used for that make or refresh only; nothing is saved as a setting. The brief stores what made it (`req_briefs.model`, plus a new `engine`), and its chips name it: "<model> on <harness> · $0.42". The brief's documents are read with the brief's last make choice (before a first make: the default). The brief's estimate per model is D9 with step `brief`. |

## 3. Data

Schema: the next free rung at build time (`dev` is at v88). All additive, in `INCREMENTAL_COLUMNS`, reconcile-safe.

- `req_features.model_json TEXT` — `{ engine, model, effort }` (effort may be null). NULL = a feature from before 9c: Claude
  and `interviewModel()`, as today.
- `req_cost_ledger` gains `engine TEXT`, `step TEXT` (`look`, `round`, `brief`, `read`, `chat`), `cost_kind TEXT`
  (`billed`, `estimated`, `unknown`), `input_tokens INTEGER`, `output_tokens INTEGER`. From 9c every call writes one ledger
  row, also when its cost is unknown (`amount_usd = 0`, `cost_kind = 'unknown'`), so the budget line can count those and D9
  can read tokens. Rows from before 9c have NULLs and count as `billed` Claude rows.
- `req_turns` and `req_helper_messages` gain `engine TEXT` beside their `model`, plus `notices_json TEXT` (the D12 lines of
  that step). Attachment reads and brief looks are known through their ledger rows (`step = 'read'` / `'brief'`), which
  carry `engine`; their notices go on the file's or the brief's view as today's read errors do.
- D9 reads the ledger: by `model` and `step` for (1), by `step` for the token medians of (2).

## 4. The helper call (`src/core/helper-call/`)

A feature gives it `{ engine, model, effort, profile, systemPrompt, prompt, timeoutMs, signal, claude }` and gets
`{ text, engine, model, costUsd, costKind, usage, notices, events }`; a failed call throws with the money spent as `costUsd`.
`claude` carries the Claude-only overrides Requirements uses today (`tools`, `allowedTools`, `maxTurns`, `permissionRules`,
`readGuard`, `noSessionPersistence`) and is ignored on other engines.

**Profiles:**

| Profile | Requirements steps | Claude | Codex, Copilot | Gemini CLI, Goose, OpenCode, Qwen Code | Cursor |
|---|---|---|---|---|---|
| `none` (no tools) | rounds, Feature chat, small text reads inline | today's options (`interviewCallOptions`) | Chat lockdown | Chat lockdown | not offered |
| `repo` (read the repo) | Look closer, the brief's code look | today's options | read-only sandbox + Worca's files MCP server (`writeFilesMcpConfig`), the classifier's path in `src/core/auto/classify.mjs` | skipped, notice | not offered |
| `file` (read one file) | images, PDFs, text over 24 KB | today's guarded read (A8 D3) | skipped, notice | skipped, notice | not offered |

A small text file (≤ 24 KB) is already read inline with no tools (A8 D3), so it uses `none` and works on every offered harness.

**What the module owns:** the per-engine launch options above (through `runClaude({ engine, … })`, which already starts every
engine), the readiness check before the call (`engineLocks`, `brokerEngineRefusal`, the chat descriptor's `askSupport`),
the timeout and abort, the rate-limit backoff, the no-save handling of D15, and the cost chain: the CLI's figure
(`resolveModelCost`) → the model's rates on its token counts (`estimateCost`) → unknown. **What stays in Requirements:** its
prompts, its reply checks, its budget and booking (`charge`, `chargeHelper`), and the notices' wording.

**On Claude the module calls exactly what `callModel` calls today** (`interviewCallOptions` stays the one source of the Claude
options); `callModel` becomes a thin wrapper over the helper call.

## 5. API (new and changed)

- `GET /api/requirements` — `interview` becomes `{ default: { engine, model, effort }, fallbackReason?, harnesses: [{ engine,
  label, ready, reason?, cannot: ['repo','files'] }] }`; `lookCostUsd` is replaced by `estimates` per model on request
  (`GET /api/requirements/estimates?engine=&model=` → `{ look, round, recommended: { model, look, round } }`).
- `POST /api/requirements` (create) — takes `model: { engine, model, effort }`; checked with `runsOn` / `effortsOn`.
- `PUT /api/requirements/:seq/model` — new; same body and checks; refused on an archived feature.
- The feature view carries `model` (the stored choice), and every turn, helper message and cost row carries `engine`,
  `costKind` and `notices`.

## 6. Screens (boards 1–8)

1. **New feature** — Who interviews (D5), the note (D8), the files note following the harness ("Codex gets files as text:
   PDFs and images are skipped."; on Claude as today).
2. **Harness list open** (D6). 8 is the same in dark.
3. **Feature page** — the model chip and the "Model for this feature" dialog (D10).
4. **Switch confirm** (D11).
5. **The thread** — each step's "<model> on <harness> · cost", the notices (D12), the errors (D13), the switch event row
   ("You switched this feature to <model> on <harness> · <time>"), the code look as a step (D17).
6. **Cost of this feature** (D14).
7. **Fallback** on New feature (D4).
9. **Product brief** — Who makes it in the Create box, and the Refresh dialog (D18).

## 7. Code changes

- `src/core/helper-call/` — new: `index.mjs` (the call), `profiles.mjs` (per engine and profile), `cost.mjs` (the chain and
  D9's estimates).
- `src/core/requirements/interview.mjs` — `callModel` over the helper call; `interviewModel()` stays for Claude; a new
  `featureModel(f)` resolves a feature's choice (NULL → today's), checks it is still in the catalog (D13).
- `helper.mjs`, `attachment-job.mjs`, `brief-job.mjs` — pass the feature's choice and profile; book `engine`, `step`,
  `costKind`, tokens and notices.
- `store.mjs`, `src/core/db.mjs` — §3; `recentLookCosts` replaced by the D9 queries.
- `routes.mjs` — §5; `lookCostUsd`'s any-model fallback removed.
- `ui/public/requirements-view.mjs` — boards 1–7; `costHint` replaced by the note. Uses `appendModelGroups`, `effortsOn`,
  `engine-locks.mjs` and `runCostLabel`; no new picker component.
- `docs/requirements.md` — a "Choosing the harness and model" section.

## 8. Testing

1. **Claude unchanged.** Before moving anything, record each step's launch options on Claude (round, Look closer, brief
   look, file read inline and guarded, Feature chat); after the move they must be identical. All existing Requirements
   tests pass unchanged.
2. **Helper call (unit, no network):** each engine × profile gives the expected launch (read-only + files MCP on Codex and
   Copilot, lockdown on the others, Cursor refused); skipped profiles return their notice; D15 per engine; the cost chain
   at each step; not signed in, broker lock, rate limit then retry, timeout, unreadable reply.
3. **Choosing:** D3's default on each engine; D4's fallback for Cursor, not ready and broker; a removed model (D13); a model
   not on the harness or an effort it lacks is refused (`runsOn` / `effortsOn`); D9's three sources and "no estimate yet".
4. **Database:** the migration at its rung; a pre-9c feature runs as today; unknown-cost rows don't change the budget sum.
5. **Whole steps on the mock engine** (`recordMockSpawn({ engine, sandbox, model })`) standing in for Codex, Gemini CLI and
   Copilot: what was launched, the notices, the cost list.
6. **Screens** (headless Chrome): boards 1–7 in light and dark.
7. **Real harnesses, by hand, before review:** one round, a Look closer, a file read and a Feature chat message on Claude,
   Codex and Gemini CLI (one per access mode), on a test project. Paid: check `~/.worca-cc` routing first and say which
   account pays. Codex and Gemini CLI run in WSL Ubuntu.
8. If #1178's replay suite lands first, these cases go there too.

## 9. Where 9c meets other work

- **#981** (harness catalog, open): the harness facts (lockdown, minimum versions, sessions) are read from the shared
  places, so a CLI too old for the lockdown shows greyed with #981's reason once it lands.
- **#608** (model switching on runs, open): the same `runsOn` / `effortsOn` checks.
- **Credential broker:** with it on, only Claude is offered (D6).

## 10. Out of scope

- Per-step choices (a cheap model for rounds, a strong one for the brief).
- Admin limits on harnesses or models (team policy's hard kind is reserved Worca-wide).
- File tools for attachments on non-Claude harnesses.
- Moving the other one-off model calls (titles, classifier, overview, PR description, Away mode's decider, model test) onto
  the helper call: a follow-up issue, titles first, the classifier and Away mode last.
