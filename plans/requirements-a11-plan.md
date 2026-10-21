# Requirements (A1.1: interview model, own system prompt, prompt order) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The requirements look and rounds run on a model and effort picked as the helper job **Requirements interview** (default: today's newest plain Opus at medium), send Worca's own system prompt instead of Claude Code's default one, load none of the user's plugins, hooks or skills, keep a cache-friendly prompt order, and the effect is measured with the real model before and after.

**Architecture:** One default-off runner option, `systemPromptMode: 'replace'` (`--system-prompt` / `--system-prompt-file`), in `src/core/claude-runner.mjs` and `src/core/engines/claude.mjs`. In `src/core/requirements/`: `interviewCallOptions` is the one builder of a call's options (used by `callModel` and the measurement tool), `interviewModel` resolves the helper job through `utilityModelFor('claude', 'requirementsInterview')`, `roundPromptParts` splits the round prompt into its stable and changing parts. The setting is a `settings.json` pair, `requirementsInterview`, like `memoryDefrag`. A tool, `tools/requirements-replay.mjs`, replays a fixture feature against the real model and reports cost, tokens and latency per call.

**Tech Stack:** Node ESM, `node:test`, jsdom, Express (`ui/server.mjs`), vanilla DOM (`ui/public/*.mjs`), Claude Code CLI (headless `-p`, stream-json).

**Spec:** `plans/requirements-a11-design.md` (decisions D1–D9 win where this plan is unclear). A1: `plans/requirements-design.md`, A2: `plans/requirements-a2-design.md`.

**Visual reference (UI task):** boards 10 (**Models › Engines › Helper jobs**, `ModelsHelper.dc.html`) and 13 (**New feature with a brief**, `NewFeatureBrief.dc.html`) of the canvas "Requirements — design round 2"; their folder is given with the UI task's dispatch (not part of the repository). They use upstream's classes and tokens; inline styles are layout hints. Where the design doc deviates (D3: no Models subtitle change; the cost words after the dot), the doc wins.

## Global Constraints

- One commit per task; subjects start `Requirements:`; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Local only: never push or touch remotes.
- No database schema change, no new route (D9). The setting is the `settings.json` key `requirementsInterview`.
- `systemPromptMode` is default-off: absent, `'append'` or any other value ⇒ every argv byte-identical to today (`test/claude-argv-snapshot.test.mjs` stays green unchanged).
- The host-guard preamble stays at the head of every real spawn's system prompt, replaced or appended.
- Lane rules (design §9): in `round.mjs` / `interview.mjs` change only what this plan names. Never edit the data-rule lines of `ROUND_SYSTEM_PROMPT` / `ORIENTATION_SYSTEM_PROMPT` (the lines starting "Everything inside") nor `startOrientation`: lane 2 owns those edits. No import from Shaper code.
- Tests never spawn a real claude (`node tools/test.mjs` sets the guard). The measurement tool spends money only with `--yes`, and only Task 7 runs it, after the user's explicit go-ahead.
- `node_modules` in this worktree is a junction: never delete, move or reinstall it; never run `npm install`.
- No local machine paths in committed files (fixture included). Every file written is valid UTF-8 (`iconv -f utf-8 -t utf-8 <file> >/dev/null`).
- `style.css`: tokens only, never a hex colour.
- One test file: `node tools/test.mjs test/<file>.test.mjs`. On this Windows machine ~170 tests fail on the clean base too: judge a failure only by re-running the same file on `ec8aed1c`. Tests marked POSIX-only (`POSIX_SHIM`) skip here; say so in the report rather than claiming them.

## Review Focus

1. **Replace mode reaches the CLI** inline and staged, with the preamble first, and never alongside an `--append-system-prompt*` flag; append mode unchanged (Task 2).
2. **The look still works without Claude Code's default prompt:** same tools, same turn cap, the working directory named in the prompt, JSON as the final message (Task 3, fake runner; Task 7, real).
3. **Model and effort resolution:** unset ⇒ newest plain Opus at `medium`; model only ⇒ no effort flag; effort only ⇒ newest Opus at that effort; a throwing slot reader ⇒ the default (Task 4).
4. **Flag off:** no Requirements interview row on the Models page; the API still accepts the setting (harmless) (Task 5).
5. **The tool never spends by accident:** dry run by default, refused under `WORCA_MOCK`, the before run is A2's exact behaviour (Tasks 1, 7).

## Who does what

The controller (the main session, Opus 5.5) dispatches one implementer per task, then one reviewer (spec compliance and code quality, Opus 5.5) per task; fixes go back to the same implementer. A whole-branch review (Opus 5.5) follows Task 6.

| Task | Implementer | Why |
|---|---|---|
| 1 Tool + call-options builder | Sonnet 5.5 | mechanical; exact spec below |
| 2 Runner `systemPromptMode` | Opus 5.5 | the spawn gate; byte-identity matters |
| 3 System prompts, hermetic calls, prompt parts | Opus 5.5 | prompt wording and the A2-identity test |
| 4 Helper job setting and resolution | Sonnet 5.5 | follows the `memoryDefrag` pattern |
| 5 UI (boards 10, 13) | Sonnet 5.5 | small DOM changes, jsdom tests |
| 6 Proof, docs, whole-branch check | Sonnet 5.5 | |
| 7 Real measurement | the controller itself, no subagent | spends money; only after the user says yes |

---

### Task 1: The measurement tool and one builder for a call's options (no behaviour change)

**Files:**
- Modify: `src/core/requirements/interview.mjs` (`callModel` ~line 108; the two call sites ~162 and ~215)
- Create: `tools/requirements-replay.mjs`
- Create: `tools/requirements-replay.fixture.json`
- Create: `test/requirements-replay-tool.test.mjs`
- Modify: `test/requirements-interview.test.mjs`

**Interfaces:**
- `interviewCallOptions(kind, { cwd, prompt, model, effort = 'medium' })` (exported from `interview.mjs`) → the `runClaude` options of one call without `signal` / `onEvent`. `kind` is `'look'` or `'round'`, anything else throws `TypeError`. In this task it returns exactly what `callModel` sends today:
  `{ cwd, systemPrompt: ORIENTATION_SYSTEM_PROMPT | ROUND_SYSTEM_PROMPT, prompt, model, modelEnv: resolveModelEnv(model), allowedTools: [...tools], tools: [...tools], strictMcpConfig: true, maxTurns: REPO_LOOK_MAX_TURNS (look only), effort, permissionMode: 'acceptEdits', spawnKind: 'aux' }` with `tools` = `REPO_LOOK_TOOLS` for a look, `[]` for a round.
- `callModel(d, { kind, cwd, prompt, model, timeoutMs })` builds through it; behaviour otherwise unchanged.

- [ ] **Step 1: Builder.** Add `interviewCallOptions`; `callModel` becomes `d.runClaudeImpl({ ...interviewCallOptions(kind, { cwd, prompt, model }), signal: ctrl.signal, onEvent: … })`; `orient` passes `kind: 'look'`, `runRound` `kind: 'round'` (drop the `systemPrompt`, `tools`, `maxTurns` arguments there).
- [ ] **Step 2: Test (interview).** For both kinds the options' key set and values deep-equal A2's (write the A2 literal into the test), so every later change to them is deliberate; `interviewCallOptions('x', …)` throws.
- [ ] **Step 3: Fixture** `tools/requirements-replay.fixture.json`, product language, realistic size, no paths:
  ```json
  { "version": 1,
    "feature": { "id": "FEAT-1", "title": "Gift message on an order",
                 "description": "Shoppers buying a present want to add a short message that is printed on the packing slip, without the prices. …(about 60 words)" },
    "context": "…the project's notes for Worca, about 120 words…",
    "orientation": "…what Worca found in the code, about 200 words, product language…",
    "rounds": [ { "questions": [ { "id": "…", "question": "…", "options": ["…", "…"], "recommended": "…", "why": "…" } ],
                  "answers": [ { "id": "…", "answer": "…" } ],
                  "specAfter": { …emptySpec() shape: goal, actors, flow, edgeCases, rules, outOfScope, criteria, assumptions, openQuestions, edited } } ] }
  ```
  Five rounds, 2–3 questions each, answers mostly the recommended option; the spec grows to about 6 criteria (`R-po-1`…) and 3 assumptions (`A-1`…), the last `specAfter` with no open questions.
- [ ] **Step 4: Tool** `tools/requirements-replay.mjs` (header comment with usage, as `tools/workspace-map-eval.mjs`):
  ```
  node tools/requirements-replay.mjs [--fixture <file>] [--rounds N] [--look <dir>] [--gap <seconds>]
                                     [--model <id>] [--effort <level>] [--label <text>] [--out <file.json>] [--yes]
  node tools/requirements-replay.mjs --compare <a.json> <b.json>
  ```
  Exports, for the test: `loadFixture(path)`, `replayPlan(fixture, { rounds, lookDir, roundCwd, model, effort })`, `measureCall(run, call, { timeoutMs })`, `summarize(records)`, `compareReports(a, b)`, `main(argv, { run = runClaude, log = console.log, env = process.env })`. Behaviour:
  1. `--rounds` default 4, 1–6 (`MAX_ROUNDS`). Fixture default `tools/requirements-replay.fixture.json` (resolved from the tool's folder).
  2. `replayPlan` → calls in order: the look first when `lookDir` is given (`buildOrientationPrompt({ feature, context })`, `kind: 'look'`, `cwd: lookDir`), then round k = 1..N: `feature` = `{ ...fixture.feature, orientation: { summary: fixture.orientation }, spec: k === 1 ? emptySpec() : rounds[k-2].specAfter, rounds: k - 1 }`; `turns` = for j < k a `round` turn `{ id: 2j, kind: 'round', payload: { questions } }` and an `answers` turn `{ id: 2j + 1, kind: 'answers', payload: { roundTurnId: 2j, answers } }`; prompt = `buildRoundPrompt({ feature, context, turns, final: k >= MAX_ROUNDS, round: k })`; options = `interviewCallOptions(kind, { cwd, prompt, model, effort })`. Round cwd: one fixed folder, `join(tmpdir(), 'worca-req-replay')`, created once.
  3. Model: `--model`, else `await requirementsModel()`; effort: `--effort`, else `medium`.
  4. **Dry run** (no `--yes`): print one line per call (kind, round, system prompt chars, prompt chars, ≈ tokens = chars / 4) and "Dry run: nothing was sent. Add --yes to call the model (this costs money)."; exit 0; `run` is never called.
  5. `WORCA_MOCK` or `ORCH_MOCK` set → exit 2 "the replay measures the real model; unset WORCA_MOCK".
  6. **With `--yes`:** calls run one after another (sleep `--gap` seconds between them), each `run({ ...options, signal, onEvent: normalizingOnEvent(…) })` with the round timeout 180 s, the look `REPO_LOOK_TIMEOUT_MS`. `measureCall` returns a record: `{ kind, round, ok, error, costUsd, inputTokens, cacheWrite5m, cacheWrite1h, cacheWriteTokens, cacheReadTokens, outputTokens, durationMs, wallMs, numTurns, models, replyReadable }` from the `result` event (`costUsd`, `usage.input_tokens`, `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`, `usage.cache_creation_input_tokens`, `usage.cache_read_input_tokens`, `usage.output_tokens`, `durationMs`, `numTurns`, `Object.keys(modelUsage)`); `replyReadable` = a round reply passes `applyRound(feature.spec, safeParseJson(text), {…})`, a look reply has a string `summary`. A failed call is recorded (`ok: false`, `error`) and the replay goes on; exit 1 when any failed.
  7. Report: a table (one row per call, then totals and the median round latency) on stdout, and with `--out` the JSON `{ version: 1, label, at, commit (git rev-parse --short HEAD, best effort), model, effort, variant: null, fixture: <basename>, rounds, gapSec, calls: [records], totals: { costUsd, inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens, wallMs } }`.
  8. `--compare a b`: offline; per call (matched by kind + round) and totals: a, b, b − a, percent; spawns nothing.
- [ ] **Step 5: Test** `test/requirements-replay-tool.test.mjs` (a fake `run`, never a real one): dry run never calls `run` and exits 0; the plan for 3 rounds has 3 round calls whose prompts carry the earlier rounds' answers (round 2 contains round 1's first answer, round 1 contains none) and whose `<current_spec>` is the fixture's previous `specAfter`; `--look <dir>` adds a first look call with the look tools; with `--yes` and a fake `run` that emits a normalized `result` event with `usage` and `modelUsage`, the JSON report's records and totals add up; a throwing call is recorded and the exit code is 1; `--compare` deltas and percentages; `WORCA_MOCK=1` → exit 2.
- [ ] **Step 6:** `node tools/test.mjs test/requirements-replay-tool.test.mjs test/requirements-interview.test.mjs`; also run the tool's dry run once by hand (`node tools/requirements-replay.mjs`) and paste its output in the report. Commit `Requirements: replay tool for interview cost; one builder for a call's options`. **Record this commit's hash: Task 7's "before" runs on it.**

---

### Task 2: The runner can replace Claude Code's system prompt

**Files:**
- Modify: `src/core/engines/claude.mjs` (`buildClaudeArgs` ~304–325, `planClaudeInvocation` ~409–431, `runClaudeProcess` signature ~444 and its `stageClaudeInvocation` call ~528)
- Modify: `src/core/claude-runner.mjs` (JSDoc; the destructure ~130–190 and the `engine.run` call ~220–264: the gate)
- Modify: `test/spawn-argv-limit.test.mjs`, `test/host-guard-wiring.test.mjs`, `test/spawn-args.test.mjs`

**Interfaces:**
- Runner option `systemPromptMode?: 'append' | 'replace'`. `'replace'` ⇒ `--system-prompt <text>` inline, `--system-prompt-file <dir>/system-prompt.md` staged. Anything else ⇒ today's `--append-system-prompt` / `--append-system-prompt-file`.

- [ ] **Step 1: Tests first.** `spawn-argv-limit`: `planClaudeInvocation({ …, systemPrompt: 'SYS', systemPromptMode: 'replace' })` inline → argv has `--system-prompt SYS` and no `--append-system-prompt`; over the limit → `--system-prompt-file <stage>/system-prompt.md`, no `--append-system-prompt-file`, the file's content is the text; `systemPromptMode: 'append'`, absent, or `'bogus'` → argv identical to the call without the option. `host-guard-wiring`: with the guard on and `replace`, the `--system-prompt` value starts with the host-guard preamble and ends with `SYS`. `spawn-args` (POSIX shim): `runClaude` forwards `systemPromptMode` to the spawn (argv has `--system-prompt`).
- [ ] **Step 2: `buildClaudeArgs`** takes `systemPromptMode`; `const replace = systemPromptMode === 'replace'`; the existing `if (systemPrompt)` block picks `--system-prompt-file` / `--system-prompt` when `replace`, else today's flags. Same position in argv (right after `--resume`), so append-mode argv stays a byte-identical prefix. `planClaudeInvocation` needs no change beyond passing `opts` through (the file name stays `system-prompt.md`).
- [ ] **Step 3: Forwarding.** `runClaudeProcess` destructures `systemPromptMode` and passes it to `stageClaudeInvocation`; `runClaude` names it in its destructure and in the real `engine.run({...})` call (the mock call does not need it; say so in a comment), and documents it in the JSDoc (`@param {'append'|'replace'} [o.systemPromptMode]`). The broker path (`runViaBroker`) spreads `opts`, so it needs nothing.
- [ ] **Step 4:** `node tools/test.mjs test/spawn-argv-limit.test.mjs test/host-guard-wiring.test.mjs test/spawn-args.test.mjs test/claude-argv-snapshot.test.mjs`. Offline flag probe, recorded in the report (no spend: the API is unreachable): `ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_API_KEY=x claude -p hi --system-prompt-file ./missing.md --tools ""` must answer "System prompt file not found" (the flag exists in the installed CLI). Commit `Requirements: the runner can replace Claude Code's system prompt (default off)`.

---

### Task 3: Worca's own system prompts, hermetic calls, the prompt's two parts

**Files:**
- Modify: `src/core/requirements/round.mjs` (the two system prompts ~17–49, `buildRoundPrompt` ~128–151, `buildOrientationPrompt` ~153–163)
- Modify: `src/core/requirements/interview.mjs` (`interviewCallOptions`, `orient` passes the look's cwd)
- Modify: `tools/requirements-replay.mjs` (`--variant system-stable`)
- Modify: `test/requirements-round.test.mjs`, `test/requirements-interview.test.mjs`, `test/requirements-replay-tool.test.mjs`

**Interfaces:**
- `roundPromptParts(args)` (same arguments as `buildRoundPrompt`) → `{ stable, changing }`: `stable` = the `<feature>`, `<description>`, `<project_context>`, `<what_worca_found_in_the_code>` blocks joined with a blank line; `changing` = `<thread>`, `<current_spec>`, `<edited_by_product_owner>`, the round line, the follow-up line (when any), the reply line. `buildRoundPrompt(args)` = `` `${stable}\n\n${changing}` ``, byte-identical to A2.
- `buildOrientationPrompt({ feature, context, members, cwd = null })`: when `cwd` is given, the line `` `The working directory is ${asData(cwd)}.` `` comes right before the reply line.

- [ ] **Step 1: Pin A2's text first.** On the unchanged code, write a round-test that builds `buildRoundPrompt` for a fixed feature (title, description, context, orientation summary, a thread with one round, its answers, an edited section, round 2) and compares it with a string literal captured from today's output (paste it into the test). It must stay green after Step 3.
- [ ] **Step 2: System prompts.** Prepend, leaving every existing line as it is except the look's last one:
  - `ROUND_SYSTEM_PROMPT` first line: `You are Worca's requirements interviewer. You talk with a product owner through Worca's Requirements page, never through a terminal, and you have no tools: everything you know is in the message.` then an empty line.
  - `ORIENTATION_SYSTEM_PROMPT` first two lines: `You are Worca's requirements reader. A product owner is about to describe a feature; you look at the product's code first, so the interview does not ask what the product already shows.` and `You can only read: Glob finds files by name pattern, Grep searches file contents, Read reads one file (use paths under the working directory the message names). You cannot run commands or change anything, and you have only a few steps: answer before they run out.`; its last line becomes `Your final message is ONLY this JSON object, no prose, no code fence: { "summary": "...", "files": ["each path you read"] }`.
  - Neither prompt may contain a date, a path, a pid or any per-call value (test: a regex for digits-with-slashes / drive letters / `\d{4}-\d{2}` finds nothing; the constants are equal across two imports).
- [ ] **Step 3: Parts.** `roundPromptParts` as above; `buildRoundPrompt` joins them. Comment above the stable list: `// Stable for a feature across rounds (cache-friendly: first). A7's product brief goes after <project_context>.`
- [ ] **Step 4: Look prompt.** `buildOrientationPrompt` takes `cwd`; `orient` passes `cwd: look.cwd`.
- [ ] **Step 5: Calls.** `interviewCallOptions` adds `systemPromptMode: 'replace'`, `settingSources: ['project']`, `disableSlashCommands: true` for both kinds (update Task 1's options test to the new literal).
- [ ] **Step 6: Tool variant.** `--variant system-stable` (rounds only; with `--look` the look call is unchanged): `systemPrompt` = `ROUND_SYSTEM_PROMPT + '\n\n' + parts.stable`, `prompt` = `parts.changing`; the report's `variant` is `'system-stable'`. Test: the variant's calls carry the stable blocks in `systemPrompt` and not in `prompt`.
- [ ] **Step 7: Tests.** Round: Step 1's literal still equal; for rounds 2 and 3 of one feature, `stable` is equal and round 3's `changing` starts with round 2's thread lines (append-only thread); the look prompt ends with the working-directory line before the reply line, and has none without `cwd`; system prompt checks of Step 2. Interview (fake runner): both calls carry `systemPromptMode: 'replace'`, `settingSources: ['project']`, `disableSlashCommands: true`; the look keeps `REPO_LOOK_TOOLS` and `maxTurns`, its prompt names `repoDir`; rounds stay tool-less; the `systemPrompt` of each call is the matching constant.
- [ ] **Step 8:** `node tools/test.mjs test/requirements-round.test.mjs test/requirements-interview.test.mjs test/requirements-replay-tool.test.mjs`; commit `Requirements: Worca's own system prompt for the look and the rounds; no user plugins in a call`.

---

### Task 4: The Requirements interview helper job

**Files:**
- Modify: `src/core/settings.mjs` (`SETTINGS_POST_KEYS` ~1125–1150, `UTILITY_JOBS` ~1157, `assertUtilityModelsInput` ~1255; new getter / assert / setter next to `utilityModelsSetting`)
- Modify: `src/core/settings-cascade.mjs` (`UTIL_RE`, `RUN_JOBS`, `CLAUDE_USER`, `utilEntry` ~79–99)
- Modify: `src/core/settings-errors.mjs` (field label)
- Modify: `ui/server.mjs` (`settingsState` ~9000; the two `GET /api/settings` answers ~9425 and ~9462; `applySettingsPatch` ~9480–9630)
- Modify: `src/core/requirements/interview.mjs` (`DEFAULTS`, `interviewModel`, `orient`, `runRound`, `callModel`, `interviewCallOptions`)
- Modify: `src/core/requirements/routes.mjs` (`GET /api/requirements` ~170)
- Modify: `tools/requirements-replay.mjs` (default model and effort from `interviewModel`)
- Modify: `test/utility-model-slots.test.mjs`, `test/settings-cascade.test.mjs`, `test/api-engine-settings.test.mjs`, `test/requirements-interview.test.mjs`, `test/requirements-api.test.mjs`

**Interfaces:**
- `settings.mjs`: `UTILITY_JOBS` gains `'requirementsInterview'`; `SETTINGS_POST_KEYS` gains `'requirementsInterview'` (comment `// Models › Engines › Claude: the requirements interview { model, effort }`); `requirementsInterviewSetting()` → stored pair or `undefined` (home-guarded under `node:test` exactly like `utilityModelsSetting`); `assertRequirementsInterviewInput(input)` → `normalizeModelPair('claude', input, 'requirementsInterview')` (null clears); `async setRequirementsInterview(input)` → stores or deletes the key, `persistSettings`, returns `{ requirementsInterview: requirementsInterviewSetting() ?? null }`. `assertUtilityModelsInput` refuses `utilityModels.<engine>.requirementsInterview` for every engine with `utilityModels.<engine>: the requirements interview runs on Claude — set it on the Claude tab`.
- `settings-cascade.mjs`: `UTIL_RE` accepts `models.claude.utility.requirementsInterview`; `RUN_JOBS` gains it (so the id has `utility.`); `CLAUDE_USER.requirementsInterview = (ctx) => pickPair(ctx.settings().requirementsInterview)`; `utilEntry` returns `null` for a non-Claude engine with this job and marks the Claude entry `userOnly`.
- `interview.mjs`: `export const DEFAULT_INTERVIEW_EFFORT = 'medium'`; `DEFAULTS.interviewSlot = () => utilityModelFor('claude', 'requirementsInterview')`; `export async function interviewModel(deps = {})` → `{ model: string|null, effort: string|null, source: 'settings'|'default' }` per design D2 (slot reader throwing ⇒ `{}`); `interviewCallOptions(kind, { cwd, prompt, model, effort })` loses the effort default and emits `effort` only when truthy.
- `GET /api/requirements` adds `interview`: `{ model, label, effort, source }` or `null` (`label` from `listModels('')`'s entry, else the id; any throw ⇒ `null`). Injectable for tests through `deps.interviewModel`.
- `GET /api/settings` adds `requirementsInterview` (pair or `null`) and `requirementsInterviewDefault: { model: <await requirementsModel(() => listModels(''))> ?? null, effort: 'medium' }`. `POST /api/settings` accepts `requirementsInterview`.

- [ ] **Step 1: Settings and cascade** as above; `settings-errors.mjs` labels `requirementsInterview: 'Requirements interview'`.
- [ ] **Step 2: Server.** In `applySettingsPatch`: `has('requirementsInterview')` joins the `refuseNonClaudeUtilityModel` key loop (~9532); validation `await asSettingsField('requirementsInterview', async () => { const v = assertRequirementsInterviewInput(body.requirementsInterview); if (v?.model) await assertSlotModels([{ id: 'requirementsInterview', engine: 'claude', value: v }]); })` before any write; the write `await asSettingsField('requirementsInterview', () => setRequirementsInterview(body.requirementsInterview))` with the other setters; the key joins the `settings-changed` condition. `settingsState()` adds `requirementsInterview`; both GET answers merge `requirementsInterviewDefault` (async, like `autoModelState()`).
- [ ] **Step 3: Resolution in the interview.** `orient` and `runRound` call `interviewModel(d)` where they called `requirementsModel(d.listModels)` and pass `model` and `effort` to `callModel` → `interviewCallOptions`. Mock mode unchanged. The turn's `model` stays the resolved id.
- [ ] **Step 4: List route.** `interview` on `GET /api/requirements` as above.
- [ ] **Step 5: Tool.** Without `--model` / `--effort`, the tool uses `interviewModel()`.
- [ ] **Step 6: Tests.**
  - Cascade / slots: the id resolves through `utilityModelFor('claude', 'requirementsInterview')` from the `settings.json` pair (use the existing sandboxed-home pattern of `test/utility-model-slots.test.mjs`); `settingEntry('models.codex.utility.requirementsInterview')` is `null`; the Claude entry is `userOnly` (a project patch is refused "is set per user").
  - Validators: `assertUtilityModelsInput({ codex: { requirementsInterview: … } })` throws the Claude message; `assertRequirementsInterviewInput` accepts model only, effort only, both, `null`; refuses `effort: 'low'`, unknown fields.
  - API (`test/api-engine-settings.test.mjs`): POST a catalog Claude model + `high` → GET returns it; `null` clears; an unknown model → 400 naming the field; a Codex-only model → 400; an effort the model does not offer → 400; GET carries `requirementsInterviewDefault.model` matching `/^claude-opus-/` and `effort: 'medium'`.
  - Interview (fake runner, `deps.interviewSlot`): `{}` → `claude-opus-5-5` + `effort: 'medium'` on both calls; `{ model: 'claude-sonnet-5' }` → that model and no `effort` key; `{ effort: 'high' }` → Opus + `high`; both → both; a throwing reader → the default. Add `interviewSlot: () => ({})` to the test file's `deps()` helper.
  - API (`test/requirements-api.test.mjs`): the list carries `interview` with `model` matching `/^claude-opus-/`, a non-empty `label`, `effort: 'medium'`, `source: 'default'`; with `deps.interviewModel` stubbed to throw, `interview` is `null` and the list still answers 200.
- [ ] **Step 7:** run the five test files; commit `Requirements: the interview model and effort are a helper job`.

---

### Task 5: The row on Models › Engines (board 10) and the line on New feature (board 13)

**Files:**
- Modify: `ui/public/engine-settings-view.mjs` (`JOB_LABELS` ~8, `JOB_HINTS` ~15, `CLAUDE_HELPER_KEYS` and `enginePatchToSettingsBody` ~146–158)
- Modify: `ui/public/app.js` (`CLAUDE_USER_HELPER_JOBS`, `CLAUDE_USER_HELPER_OWN`, `paintEngineSettings` ~16682–16715; a flag listener)
- Modify: `ui/public/requirements-view.mjs` (`paint` ~218, `paintNew` ~320–352)
- Modify: `test/ui-settings-engines.test.mjs`, `test/requirements-view.test.mjs`

- [ ] **Step 1: The row.** `JOB_LABELS.requirementsInterview = 'Requirements interview'`; `JOB_HINTS.requirementsInterview = 'Looks at the code once and runs the interview rounds on the Requirements page.'`; `utilityId('claude', 'requirementsInterview')` is `models.claude.utility.requirementsInterview` (not an own-run job). `enginePatchToSettingsBody`: that id maps to `body.requirementsInterview` = `{ model?, effort? }` with only the non-empty fields, or `null` when both are empty (×). Codex ids never produce it.
- [ ] **Step 2: Models page** (`app.js`): the Claude helper jobs are `['title', 'classifier', 'prDescription', 'memoryDefrag']` plus `'requirementsInterview'` only while `flagOn('requirements')` (computed at paint time, not a module constant). Its field: `own` from `data.requirementsInterview`; `inherited: { value: data.requirementsInterviewDefault?.model ? { model, effort } : undefined, source: 'default' }`, so the empty choices read "Opus 5.5 (default)" and "medium (default)" (inherit-field already renders an inherited pair that way). Not in `noEffort`. `onFlagChange('requirements', …)` repaints the Engines card when the Models page is open (`currentView() === 'models'`). The Models subtitle is unchanged (design D3).
- [ ] **Step 3: New feature** (`requirements-view.mjs`): `paint()` keeps one `GET /api/requirements` call and passes `lookCostUsd` and `interview` to `paintNew(lookCost, interview)`. The actions hint (class `hint req-new-cost`, built without `null` / `false` children):
  - `interview` and a look cost: a `span.req-new-model` "Worca interviews with Opus 5.5 at medium effort", then " · about $0.25 for the code look, then cents per round";
  - `interview`, no look cost: "Worca interviews with Opus 5.5 at medium effort · cents per round";
  - `interview.effort` null: "Worca interviews with Sonnet 5" (no "at … effort");
  - no `interview`: today's "About $0.25 for the code look, then cents per round." or nothing.
  The model name is `interview.label || interview.model`. Lane 2 later replaces only the part after " · ".
- [ ] **Step 4: Tests.** Engines: the Claude card lists the row with its label and hint only when the `requirements` flag is on (set `<html data-flags>` as the existing flag tests do); the empty choices name the default pair; picking Sonnet + high and saving posts `{ requirementsInterview: { model, effort } }`; × posts `{ requirementsInterview: null }`; the Codex card never has the row; `enginePatchToSettingsBody` maps the id. View: the three hint forms above and today's form (update the existing "cost hint" test, do not delete it).
- [ ] **Step 5:** `node tools/test.mjs test/ui-settings-engines.test.mjs test/requirements-view.test.mjs test/requirements-app.test.mjs`; screenshots of the Models row (desktop) and New feature (desktop and phone width) in the report. Commit `Requirements: Requirements interview on the Models page; New feature says who interviews`.

---

### Task 6: Proof, docs, whole-branch check

**Files:**
- Modify: `tools/verify-requirements-cdp.mjs`
- Modify: `docs/requirements.md`, `docs/models.md`

- [ ] **Step 1: Proof.** In the existing New feature check (mock mode), assert the actions hint starts with "Worca interviews with". Keep the proof's structure and output style.
- [ ] **Step 2: Docs.** `docs/requirements.md`, under *How it works*, a short paragraph **Which model interviews**: the newest Opus at medium effort unless **Requirements interview** on Models › Engines › Claude › Helper jobs says otherwise; the New feature page names it; each look and round sends Worca's own instructions, not Claude Code's coding-agent ones, and loads none of your Claude Code plugins, hooks or skills. `docs/models.md`: add the Requirements interview to the Claude helper jobs where the page lists them (the cards paragraph ~line 281), one sentence, noting it runs on Claude only. Product language, short.
- [ ] **Step 3: Whole branch.** `npm test`; for every failing file run the same file on `ec8aed1c` (`git stash -u; git switch --detach ec8aed1c; node tools/test.mjs <files>; git switch -; git stash pop`); only failures that pass on the base are this branch's. `npm run verify:requirements` green. Record the counts.
- [ ] **Step 4:** fix what is this branch's; commit `Requirements: A1.1 proof and docs` (plus `Requirements: whole-branch fixes` if anything else changed).

---

### Task 7: Measure with the real model (only after the user's go-ahead)

Spends money (estimate: about $1–1.50 for 4 rounds in three configurations; about $0.50 more per configuration that includes the look). **Do not start without the user's explicit yes**, given with the estimate and the configurations below. Run with the real `HOME` (a sandboxed home is not signed in to Claude Code) and Worca's server untouched; the tool writes nothing into Worca's data. Reports go to the scratchpad, not the repository.

- [ ] **Step 1:** `claude --version` into the report; Task 2's offline flag probe again.
- [ ] **Step 2: Before** (A2's behaviour): `git switch --detach <Task 1 commit>`; `node tools/requirements-replay.mjs --rounds 4 --model claude-opus-5-5 --effort medium --label before --out <scratch>/before.json --yes`; `git switch -`.
- [ ] **Step 3: After** (branch head): the same command with `--label after --out <scratch>/after.json`.
- [ ] **Step 4: Variant:** `--variant system-stable --label variant --out <scratch>/variant.json`.
- [ ] **Step 5 (only if the user chose them):** the look (`--look <a read-only checkout of a registered project>`) for before and after; a second pass with `--gap 90` when Step 3 showed cache reads.
- [ ] **Step 6:** `--compare before.json after.json` and `--compare after.json variant.json`; every call's `replyReadable` must be true after (a false one is a finding: report it, do not tune the prompt in this task).
- [ ] **Step 7:** Fill in §10 of `plans/requirements-a11-design.md` (per configuration: total cost, input tokens, cache writes and reads, output tokens, median round latency; the look when measured; the CLI version) and, under open question 1, what the variant saved. Commit `Requirements: A1.1 measured before and after`.
