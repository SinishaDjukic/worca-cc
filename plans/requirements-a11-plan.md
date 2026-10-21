# Requirements (A1.1: interview model, own system prompt, prompt order) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The requirements look and rounds run on a model and effort picked as the helper job **Requirements interview** (default: today's newest plain Opus at medium), send Worca's own system prompt instead of Claude Code's default one, load none of the user's plugins, hooks or skills, keep a cache-friendly prompt order, and the effect is measured with the real model before and after.

**Architecture:** One default-off runner option, `systemPromptMode: 'replace'` (`--system-prompt` / `--system-prompt-file`), in `src/core/claude-runner.mjs` and `src/core/engines/claude.mjs`. In `src/core/requirements/`: `interviewCallOptions(kind, overrides)` and the exported `callModel` are the one call path (also A7's brief and the measurement tool), `interviewModel` resolves the helper job through `utilityModelFor('claude', 'requirementsInterview')`, `roundPromptParts` splits the round prompt into its stable and changing parts. The setting is a by-id, user-only cascade entry stored as the `settings.json` pair `requirementsInterview`. A tool, `tools/requirements-replay.mjs`, replays a fixture feature against the real model and reports cost, tokens and latency per call.

**Tech Stack:** Node ESM, `node:test`, jsdom, Express (`ui/server.mjs`), vanilla DOM (`ui/public/*.mjs`), Claude Code CLI (headless `-p`, stream-json).

**Spec:** `plans/requirements-a11-design.md` (decisions D1–D9 and the lane contract §9 win where this plan is unclear). A1: `plans/requirements-design.md`, A2: `plans/requirements-a2-design.md`. Lane 2's plan (`plans/requirements-a7-plan.md` on `feat/req-a7-product-brief`) is read-only reference.

**Visual reference (UI task):** boards 10 (**Models › Engines › Helper jobs**, `ModelsHelper.dc.html`) and 13 (**New feature with a brief**, `NewFeatureBrief.dc.html`) of the canvas "Requirements — design round 2"; their folder is given with the UI task's dispatch (not part of the repository). They use upstream's classes and tokens; inline styles are layout hints. Where the design doc deviates (D3: no Models subtitle change; the cost words after the dot), the doc wins.

## Global Constraints

- One commit per task; subjects start `Requirements:`; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Local only: never push or touch remotes.
- No database schema change, no new route (D9). The setting is the `settings.json` key `requirementsInterview`; it is **not** in `UTILITY_JOBS` and not in `settingIds()` (D1).
- `systemPromptMode` is default-off: absent, `'append'` or any other value ⇒ every argv byte-identical to today (`test/claude-argv-snapshot.test.mjs` stays green unchanged).
- The host-guard preamble stays at the head of every real spawn's system prompt, replaced or appended.
- **Lane contract (design §9), binding:** `callModel(d, { kind, cwd, prompt, model, timeoutMs, ...overrides })` exported, `interviewCallOptions(kind, { cwd, prompt, model, ...overrides })`; kinds `'look'` | `'round'` only; overrides `systemPrompt`, `tools`, `maxTurns`, `effort` and nothing else (anything else throws `TypeError`). In `round.mjs` lane 1 edits only: the new header lines of both system prompts, `roundPromptParts` / `buildRoundPrompt`, and the existing working-directory ternary of `buildOrientationPrompt`. Never edit: the data-rule lines and the "Do not ask what …" line of `ROUND_SYSTEM_PROMPT`, the data line and the JSON line of `ORIENTATION_SYSTEM_PROMPT`, anything before `buildOrientationPrompt`'s reply line other than the ternary, `startOrientation`, `runOrientation`. No import from Shaper code.
- Tests never spawn a real claude (`node tools/test.mjs` sets the guard). The measurement tool spends money only with `--yes`, and only Task 8 runs it, after the user's explicit go-ahead.
- `node_modules` in this worktree is a junction: never delete, move or reinstall it; never run `npm install`.
- No local machine paths in committed files (fixture included). Every file written is valid UTF-8 (`iconv -f utf-8 -t utf-8 <file> >/dev/null`).
- `style.css`: tokens only, never a hex colour.
- One test file: `node tools/test.mjs test/<file>.test.mjs`. On this Windows machine ~170 tests fail on the clean base too: judge a failure only by re-running the same file on `ec8aed1c`. Tests marked POSIX-only (`POSIX_SHIM`) skip here; say so in the report rather than claiming them.

## Review Focus

1. **Replace mode reaches the CLI** inline and staged, with the preamble first, and never alongside an `--append-system-prompt*` flag; append mode unchanged (Task 2).
2. **The look still works without Claude Code's default prompt:** same tools, same turn cap, the working directory named once, JSON as the final message (Task 3, fake runner; Task 8, a real look before and after, required).
3. **The call path is the lane contract:** exactly two kinds and four overrides; A7's brief call shape keeps replace mode and the hermetic flags (Tasks 1, 3).
4. **Model and effort resolution:** unset ⇒ newest plain Opus at `medium`; model only ⇒ no effort flag; effort only ⇒ newest Opus at that effort; a model gone from the catalog or a throwing reader ⇒ the default (Task 5).
5. **Flag off:** no Requirements interview row; the entry is in no settings listing; the API still accepts the key (harmless) (Tasks 4, 6).
6. **The tool never spends by accident:** mock refused first, dry run by default, `--max-usd` cap, the before run is A2's exact behaviour (Tasks 1, 8).

## Who does what

The controller (the main session, Opus 5.5) dispatches one implementer per task, then one reviewer (spec compliance and code quality, Opus 5.5) per task; fixes go back to the same implementer. A whole-branch review (Opus 5.5) follows Task 7.

| Task | Implementer | Why |
|---|---|---|
| 1 Tool + the call path | Sonnet 5.5 | mechanical; exact spec below |
| 2 Runner `systemPromptMode` | Opus 5.5 | the spawn gate; byte-identity matters |
| 3 System prompts, hermetic calls, prompt parts | Opus 5.5 | prompt wording, the A2-identity test, the lane seams |
| 4 Setting and settings API | Sonnet 5.5 | follows the Ask model entry and `memoryDefrag` patterns |
| 5 Resolution, list, tool defaults | Sonnet 5.5 | |
| 6 UI (boards 10, 13) | Sonnet 5.5 | small DOM changes, jsdom tests |
| 7 Proof, docs, whole-branch check | Sonnet 5.5 | |
| 8 Real measurement | the controller itself, no subagent | spends money; only after the user says yes |

---

### Task 1: The measurement tool and the one call path (no behaviour change)

**Files:**
- Modify: `src/core/requirements/interview.mjs` (`callModel` ~line 108, exported; the two call sites ~162 and ~215)
- Create: `tools/requirements-replay.mjs`
- Create: `tools/requirements-replay.fixture.json`
- Create: `test/requirements-replay-tool.test.mjs`
- Modify: `test/requirements-interview.test.mjs`

**Interfaces (the lane contract, design §9):**
- `interviewCallOptions(kind, { cwd, prompt, model, systemPrompt, tools, maxTurns, effort })` (exported) → the `runClaude` options of one call without `signal` / `onEvent`. `kind` `'look'` or `'round'`, anything else throws `TypeError`; a key other than these seven throws `TypeError`. Per-kind defaults: look → `ORIENTATION_SYSTEM_PROMPT`, `REPO_LOOK_TOOLS`, `REPO_LOOK_MAX_TURNS`; round → `ROUND_SYSTEM_PROMPT`, `[]`, no `maxTurns`; `effort` default `'medium'` (Task 5 removes the default). In this task the result is exactly what `callModel` sends today: `{ cwd, systemPrompt, prompt, model, modelEnv: resolveModelEnv(model), allowedTools: [...tools], tools: [...tools], strictMcpConfig: true, maxTurns (when set), effort, permissionMode: 'acceptEdits', spawnKind: 'aux' }`.
- `export async function callModel(d, { kind, cwd, prompt, model, timeoutMs, ...overrides })` → `{ text, costUsd }`, builds through `interviewCallOptions(kind, { cwd, prompt, model, ...overrides })`; behaviour otherwise unchanged (timeout, cost through `resolveModelCost`, the error carrying `costUsd`).

- [ ] **Step 1: Call path.** Add `interviewCallOptions`; `callModel` becomes `d.runClaudeImpl({ ...interviewCallOptions(kind, { cwd, prompt, model, ...overrides }), signal: ctrl.signal, onEvent: … })` and is exported; `orient` calls it with `kind: 'look'`, `runRound` with `kind: 'round'` (drop the `systemPrompt`, `tools`, `maxTurns` arguments there).
- [ ] **Step 2: Tests (interview).** For both kinds the options deep-equal A2's (write the A2 literal into the test), so every later change to them is deliberate; `interviewCallOptions('brief', …)` and an unknown key (`{ settingSources: [] }`) throw; the overrides replace their defaults (A7's shape: `kind: 'look'`, `systemPrompt: 'B'`, `maxTurns: 40` → `systemPrompt 'B'`, `maxTurns 40`, the look tools).
- [ ] **Step 3: Fixture** `tools/requirements-replay.fixture.json`, product language, realistic size, no paths:
  ```json
  { "version": 1,
    "feature": { "id": "FEAT-1", "title": "Gift message on an order",
                 "description": "Shoppers buying a present want to add a short message that is printed on the packing slip, without the prices. …(about 60 words)" },
    "context": "…the project's notes for Worca, about 120 words…",
    "orientation": "…what Worca found in the code, about 200 words, product language…",
    "rounds": [ { "questions": [ { "id": "…", "question": "…", "options": ["…", "…"], "recommended": "…", "why": "…" } ],
                  "answers": [ { "id": "…", "answer": "…" } ],
                  "specAfter": { …emptySpec() shape: goal, actors, flow, edgeCases, rules, outOfScope, criteria, assumptions, openQuestions, edited },
                  "criteriaSeq": 2, "assumptionSeq": 0 } ] }
  ```
  Five rounds, 2–3 questions each, answers mostly the recommended option; the spec grows to about 6 criteria (`R-po-1`…) and 3 assumptions (`A-1`…), the last `specAfter` with no open questions; `criteriaSeq` / `assumptionSeq` are the counters after that round.
- [ ] **Step 4: Tool** `tools/requirements-replay.mjs` (header comment with usage, as `tools/workspace-map-eval.mjs`):
  ```
  node tools/requirements-replay.mjs [--fixture <file>] [--rounds N] [--look <dir>] [--model <id>] [--effort <level>]
                                     [--max-usd <n>] [--no-cache] [--label <text>] [--out <file.json>] [--yes]
  node tools/requirements-replay.mjs --compare <a.json> <b.json>
  ```
  Exports, for the test: `loadFixture(path)`, `replayPlan(fixture, { rounds, lookDir, roundCwd, model, effort })`, `measureCall(spawn, call, { timeoutMs })`, `splitCost(costUsd, usage)`, `summarize(records)`, `compareReports(a, b)`, `main(argv, { spawn = runClaudeAdapter, log = console.log, env = process.env })`. Behaviour:
  1. **First:** `WORCA_MOCK` or `ORCH_MOCK` set → exit 2 "the replay measures the real model; unset WORCA_MOCK" (before the dry run, before anything else).
  2. `--rounds` default 4, 1–6 (`MAX_ROUNDS`). Fixture default `tools/requirements-replay.fixture.json` (resolved from the tool's folder).
  3. `replayPlan` → calls in order: the look first when `lookDir` is given (`buildOrientationPrompt({ feature, context })` as the code builds it at that commit, `kind: 'look'`, `cwd: lookDir`), then round k = 1..N: `feature` = `{ ...fixture.feature, orientation: { summary: fixture.orientation }, spec: k === 1 ? emptySpec() : rounds[k-2].specAfter, rounds: k - 1 }`; `turns` = for j < k a `round` turn `{ id: 2j, kind: 'round', payload: { questions } }` and an `answers` turn `{ id: 2j + 1, kind: 'answers', payload: { roundTurnId: 2j, answers } }`; prompt = `buildRoundPrompt({ feature, context, turns, final: k >= MAX_ROUNDS, round: k })`; options = `interviewCallOptions(kind, { cwd, prompt, model, effort })`. Round cwd: one fixed folder, `join(tmpdir(), 'worca-req-replay')`, created once.
  4. Model: `--model`, else `await requirementsModel()`; effort: `--effort`, else `medium`.
  5. **Dry run** (no `--yes`): print one line per call (kind, round, system prompt chars, prompt chars, ≈ tokens = chars / 4) and "Dry run: nothing was sent. Add --yes to call the model (this costs money)."; exit 0; `spawn` is never called.
  6. **With `--yes`:** the tool sets `WORCA_DEBUG_SPAWN=1` in its own process. Calls run one after another, each `spawn({ ...options, signal, onEvent, ...(noCache ? { spawnEnv: { DISABLE_PROMPT_CACHING: '1' } } : {}) })` with the round timeout 180 s, the look `REPO_LOOK_TIMEOUT_MS`. `spawn` is `runClaudeAdapter` (`src/core/engines/claude.mjs`, what `runClaude` reaches for Claude; the tool passes `bin: DEFAULT_BIN` as `runClaude` does), so `onEvent` sees raw frames; the tool reads the raw `system`/`init` frame and the `[worca] spawn-debug:` stderr line itself and normalizes the rest with `normalizingOnEvent` for the `result`. Before each call: the summed cost so far ≥ `--max-usd` (default 1.50) → stop, record the remaining calls as `skipped: 'max-usd'`, exit 1.
  7. `measureCall` returns a record: `{ kind, round, ok, error, skipped, costUsd, promptCostUsd, outputCostUsd, inputTokens, cacheWrite5m, cacheWrite1h, cacheWriteTokens, cacheReadTokens, outputTokens, durationMs, wallMs, numTurns, models, loaded, systemPromptFlag, replyReadable }`. `costUsd` = `resolveModelCost(model, cliCost, usage)` when finite, else the CLI's `costUsd` (as `callModel`). Tokens from the result's `usage` (`input_tokens`, `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`); `models` = `Object.keys(modelUsage)`. `splitCost`: prompt weight P = input + 1.25 × 5m writes + 2 × 1h writes + 0.1 × reads, output weight O = 5 × output (Claude's output/input price ratio, as `src/core/ask/events.mjs:34`); `promptCostUsd = costUsd × P / (P + O)`, the rest output. `loaded` = from the init frame `{ apiKeySource, tools: n, plugins: n, skills: n, slashCommands: n, mcpServers: n }`. `systemPromptFlag` = `'replace'` when the spawn-debug argv has `--system-prompt` or `--system-prompt-file`, `'append'` for the `--append-…` flags, else `null`. `replyReadable` = a round reply passes `applyRound(feature.spec, safeParseJson(text), { criteriaSeq, assumptionSeq, final })` (the previous round's counters from the fixture, `0` for round 1; `final` as in the plan), a look reply has a string `summary`. A failed call is recorded (`ok: false`, `error`) and the replay goes on; exit 1 when any failed.
  8. Report: a table (one row per call, then totals, the prompt-side cost of rounds 2..N, and the median round latency) on stdout, and with `--out` the JSON `{ version: 1, label, at, commit (git rev-parse --short HEAD, best effort), cli (claude --version, best effort), model, effort, variant: null, noCache, fixture: <basename>, rounds, calls: [records], totals: { costUsd, promptCostUsd, outputCostUsd, promptCostRounds2toN, inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens, wallMs } }`.
  9. `--compare a b`: offline; per call (matched by kind + round) and totals: a, b, b − a, percent; spawns nothing.
- [ ] **Step 5: Test** `test/requirements-replay-tool.test.mjs` (a fake `spawn`, never a real one): `WORCA_MOCK=1` → exit 2 and the dry run text is not printed; dry run never calls `spawn` and exits 0; the plan for 3 rounds has 3 round calls whose prompts carry the earlier rounds' answers (round 2 contains round 1's first answer, round 1 contains none) and whose `<current_spec>` is the fixture's previous `specAfter`; `--look <dir>` adds a first look call with the look tools; with `--yes` and a fake `spawn` that emits a raw init frame, a spawn-debug stderr line and a raw `result` with `usage` and `modelUsage`, the JSON report's records (`loaded`, `systemPromptFlag`, tokens), `splitCost` and totals add up; `--max-usd 0.15` with fake calls of $0.10 stops after two and marks the rest skipped; `--no-cache` passes `spawnEnv.DISABLE_PROMPT_CACHING`; a throwing call is recorded and the exit code is 1; `--compare` deltas and percentages.
- [ ] **Step 6:** `node tools/test.mjs test/requirements-replay-tool.test.mjs test/requirements-interview.test.mjs`; also run the tool's dry run once by hand (`node tools/requirements-replay.mjs` and `… --look .`) and paste its output in the report. Commit `Requirements: replay tool for interview cost; one call path for looks and rounds`. **Record this commit's hash: Task 8's "before" runs on it.**

---

### Task 2: The runner can replace Claude Code's system prompt

**Files:**
- Modify: `src/core/engines/claude.mjs` (`buildClaudeArgs` ~304–325, `planClaudeInvocation` ~409–431, `runClaudeProcess` signature ~444 and its `stageClaudeInvocation` call ~528)
- Modify: `src/core/claude-runner.mjs` (JSDoc; the destructure ~130–190 and the `engine.run` call ~220–264: the gate)
- Modify: `test/spawn-argv-limit.test.mjs`, `test/host-guard-wiring.test.mjs`, `test/spawn-args.test.mjs`

**Interfaces:**
- Runner option `systemPromptMode?: 'append' | 'replace'`. `'replace'` ⇒ `--system-prompt <text>` inline, `--system-prompt-file <dir>/system-prompt.md` staged (the normal case on later rounds: `ARGV_INLINE_LIMIT` is 20 000 characters, `claude.mjs:89`). Anything else ⇒ today's `--append-system-prompt` / `--append-system-prompt-file`.

- [ ] **Step 1: Tests first.** `spawn-argv-limit`: `planClaudeInvocation({ …, systemPrompt: 'SYS', systemPromptMode: 'replace' })` inline → argv has `--system-prompt SYS` and no `--append-system-prompt`; over the limit → `--system-prompt-file <stage>/system-prompt.md`, no `--append-system-prompt-file`, the file's content is the text; `systemPromptMode: 'append'`, absent, or `'bogus'` → argv identical to the call without the option. `host-guard-wiring`: with the guard on and `replace`, the `--system-prompt` value starts with the host-guard preamble and ends with `SYS`. `spawn-args` (POSIX shim): `runClaude` forwards `systemPromptMode` to the spawn (argv has `--system-prompt`).
- [ ] **Step 2: `buildClaudeArgs`** takes `systemPromptMode`; `const replace = systemPromptMode === 'replace'`; the existing `if (systemPrompt)` block picks `--system-prompt-file` / `--system-prompt` when `replace`, else today's flags. Same position in argv (right after `--resume`), so append-mode argv stays byte-identical. `planClaudeInvocation` needs no change beyond passing `opts` through (the file name stays `system-prompt.md`).
- [ ] **Step 3: Forwarding.** `runClaudeProcess` destructures `systemPromptMode` and passes it to `stageClaudeInvocation`; `runClaude` names it in its destructure and in the real `engine.run({...})` call (the mock call does not need it; say so in a comment), and documents it in the JSDoc (`@param {'append'|'replace'} [o.systemPromptMode]`). The broker path (`runViaBroker`) spreads `opts`, so it needs nothing.
- [ ] **Step 4:** `node tools/test.mjs test/spawn-argv-limit.test.mjs test/host-guard-wiring.test.mjs test/spawn-args.test.mjs test/claude-argv-snapshot.test.mjs`. Record in the report: `claude --version`; `claude --help | grep -n system-prompt` (2.1.304 names `--system-prompt-file` only inside `--bare`'s text); the offline probe with no spend, `ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_API_KEY=x claude -p hi --system-prompt-file ./missing.md --tools ""` → "System prompt file not found"; and that Docker pins 2.1.294 (`docker/CLAUDE_CODE_VERSION`), not probed. No fallback is built (design D4). Commit `Requirements: the runner can replace Claude Code's system prompt (default off)`.

---

### Task 3: Worca's own system prompts, hermetic calls, the prompt's two parts

**Files:**
- Modify: `src/core/requirements/round.mjs` (the top of both system prompts ~17 and ~43, `buildRoundPrompt` ~128–151, the working-directory ternary of `buildOrientationPrompt` ~158–160)
- Modify: `src/core/requirements/interview.mjs` (`interviewCallOptions`; `orient` passes the look's cwd)
- Modify: `tools/requirements-replay.mjs` (`--variant system-stable`)
- Modify: `test/requirements-round.test.mjs`, `test/requirements-interview.test.mjs`, `test/requirements-replay-tool.test.mjs`

**Interfaces:**
- `roundPromptParts(args)` (same arguments as `buildRoundPrompt`) → `{ stable, changing }`: `stable` = the `<feature>`, `<description>`, `<project_context>`, `<what_worca_found_in_the_code>` blocks joined with a blank line; `changing` = `<thread>`, `<current_spec>`, `<edited_by_product_owner>`, the round line, the follow-up line (when any), the reply line. `buildRoundPrompt(args)` = `` `${stable}\n\n${changing}` ``, byte-identical to A2.
- `buildOrientationPrompt({ feature, context, members, cwd = null })`: the existing ternary becomes, with `cwd`, `` `The working directory, ${asData(cwd)}, holds one checkout per project under repos/<project>: ${…}.` `` / `` `The working directory, ${asData(cwd)}, is a checkout of the project.` ``; without `cwd`, today's two sentences. Nothing else in the function changes (lane 2 adds its block and line).

- [ ] **Step 1: Pin A2's text first.** On the unchanged code, write a round-test that builds `buildRoundPrompt` for a fixed feature (title, description, context, orientation summary, a thread with one round, its answers, an edited section, round 2) and compares it with a string literal captured from today's output (paste it into the test). It must stay green after Step 3.
- [ ] **Step 2: System prompts** (design §9's line order). Add lines at the top only; every existing line stays byte-identical:
  - `ROUND_SYSTEM_PROMPT`, first line: `You are Worca's requirements interviewer. You talk with a product owner through Worca's Requirements page, never through a terminal, and you have no tools: everything you know is in the message.` then an empty line.
  - `ORIENTATION_SYSTEM_PROMPT`, three new first lines: `You are Worca's requirements reader.`; `You can only read: Glob finds files by name pattern, Grep searches file contents, Read reads one file (use paths under the working directory the message names). You cannot run commands or change anything, and you have only a few steps: answer before they run out.`; `Your final message is only the JSON object below: no prose before or after it.` The data line and the JSON line are lane 2's: untouched.
  - Neither prompt may contain a date, a path, a pid or any per-call value (test: no drive letter, no `\d{4}-\d{2}`, no `/` path segment outside the JSON example; the constants are equal across two imports).
- [ ] **Step 3: Parts.** `roundPromptParts` as above; `buildRoundPrompt` joins them. Comment above the stable list: `// Stable for a feature across rounds (cache-friendly: first). A7's <product_brief> goes after <project_context>, only with a brief.`
- [ ] **Step 4: Look prompt.** The ternary as above; `orient` passes `cwd: look.cwd`.
- [ ] **Step 5: Calls.** `interviewCallOptions(kind, overrides, { keepUserSettings = false } = {})` adds `systemPromptMode: 'replace'` and `disableSlashCommands: true` for both kinds, whatever the overrides, and `settingSources: ['project']` unless `keepUserSettings` (update Task 1's options test to the new literal). `callModel` passes `keepUserSettings: d.userSignIn()`.
- [ ] **Step 5a: Keep the user's sign-in settings** (design D6: no regression against A2). `export function userClaudeSignIn({ env = process.env, home = homedir(), read = (p) => readFileSync(p, 'utf8') } = {})` in `interview.mjs` → boolean. The file: `settings.json` in `env.CLAUDE_CONFIG_DIR` (trimmed, when set) else in `join(home, '.claude')`, as `src/core/skills-registry/host.mjs:99-100`; parsed as JSON (a leading BOM tolerated). `true` when `apiKeyHelper` is a non-empty string, or `env` is an object with a key `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_BEDROCK` or `NODE_EXTRA_CA_CERTS`, `HTTP_PROXY` / `HTTPS_PROXY` (case-insensitive), or one starting `ANTHROPIC_`; missing, unreadable, invalid or not an object → `false`. Never throws. `DEFAULTS.userSignIn` = `userClaudeSignIn()` plus, the first time it is `true` in this process (a module-level flag), `console.warn('[worca] requirements: user Claude settings carry sign-in; keeping them for interviews')`. The tool passes `{ keepUserSettings: userClaudeSignIn() }` too and records it in its report (`keptUserSettings`).
- [ ] **Step 6: Tool variant.** `--variant system-stable` (rounds only; with `--look` the look call is unchanged): `systemPrompt` = `ROUND_SYSTEM_PROMPT + '\n\n' + parts.stable` (passed as the `systemPrompt` override), `prompt` = `parts.changing`; the report's `variant` is `'system-stable'`. Test: the variant's calls carry the stable blocks in `systemPrompt` and not in `prompt`.
- [ ] **Step 7: Tests.** Round: Step 1's literal still equal; for rounds 2 and 3 of one feature, `stable` is equal and round 3's `changing` starts with round 2's thread lines (append-only thread); the look prompt with `cwd` names it in exactly one sentence, for a project and a workspace, and is unchanged without `cwd`; system prompt checks of Step 2; every pre-existing line of both prompts still present, in order, after the new ones. Interview (fake runner): both calls carry `systemPromptMode: 'replace'`, `settingSources: ['project']`, `disableSlashCommands: true`; the look keeps `REPO_LOOK_TOOLS` and `maxTurns`, its prompt names `repoDir`; rounds stay tool-less; A7's call shape (`kind: 'look'`, `systemPrompt`, `maxTurns: 40`, `effort: 'high'` overrides) keeps replace mode, the hermetic flags and the look tools. Sign-in branch, with fixture files in a temp home (the `home` and `env` seams): `{ "apiKeyHelper": "cat /run/secrets/key" }` → true; an `env` block with each listed key, one at a time (`ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_BEDROCK`, `HTTPS_PROXY`, `http_proxy`, `NODE_EXTRA_CA_CERTS`) → true; `{ "env": { "FOO": "1" } }`, `{}`, `{ "apiKeyHelper": "" }`, no file, invalid JSON, a JSON array → false; `CLAUDE_CONFIG_DIR` pointing at another folder reads that folder's file. With `deps.userSignIn` returning true, both calls carry no `settingSources` and still `disableSlashCommands: true` and replace mode; returning false, `settingSources: ['project']`. The default `userSignIn` (a fixture home with `apiKeyHelper`) logs the line once across two calls (a `console.warn` spy).
- [ ] **Step 8:** `node tools/test.mjs test/requirements-round.test.mjs test/requirements-interview.test.mjs test/requirements-replay-tool.test.mjs`; commit `Requirements: Worca's own system prompt for the look and the rounds; no user plugins in a call`.

---

### Task 4: The Requirements interview setting and the settings API

**Files:**
- Modify: `src/core/settings.mjs` (`SETTINGS_POST_KEYS` ~1125–1150; new getter / assert / setter next to `askModelsSetting`)
- Modify: `src/core/settings-cascade.mjs` (a by-id entry next to the Ask entries ~100–108, `settingEntry`)
- Modify: `src/core/settings-errors.mjs` (field label; the Codex refusal rewrite)
- Modify: `ui/server.mjs` (`settingsState` ~9000; the `GET /api/settings` answer ~9425 and the `POST /api/settings` answer ~9462; `applySettingsPatch` ~9480–9630)
- Modify: `test/settings-cascade.test.mjs`, `test/utility-model-slots.test.mjs`, `test/api-engine-settings.test.mjs`, `test/settings-projects-root.test.mjs`

**Interfaces:**
- `settings.mjs`: `SETTINGS_POST_KEYS` gains `'requirementsInterview'` (comment `// Models › Engines › Claude: the requirements interview { model, effort }`); `requirementsInterviewSetting()` → stored pair or `undefined` (home-guarded under `node:test` exactly like `askModelsSetting`); `assertRequirementsInterviewInput(input)` → `normalizeModelPair('claude', input, 'requirementsInterview')` (`null` clears); `async setRequirementsInterview(input)` → stores or deletes the key, `persistSettings`, returns `{ requirementsInterview: requirementsInterviewSetting() ?? null }`. `UTILITY_JOBS` is **unchanged**.
- `settings-cascade.mjs`: `const REQUIREMENTS_INTERVIEW = Object.freeze({ id: 'models.claude.requirementsInterview', family: 'utility', engine: 'claude', job: 'requirementsInterview', path: ['requirementsInterview'], store: 'settings', default: undefined, userOnly: true, validate: pairCheck('claude'), readUser: () => pickPair(requirementsInterviewSetting()), readProject: () => undefined, team: null })`; `settingEntry` returns it for that id (before the `UTIL_RE` match); `settingIds()` does not list it. `utilityModelFor('claude', 'requirementsInterview')` then resolves it with no change to `utilityModelFor` (`utilityId` already yields that id for a job outside `RUN_JOBS`).
- `settings-errors.mjs`: `SETTINGS_FIELD_LABELS.requirementsInterview = 'Requirements interview'`; a rewrite for `/^utilityModels\.(\w+): unknown job "requirementsInterview"/` → field `utilityModels`, message `The requirements interview runs on Claude: set it on the Claude tab.` (so `INTERNAL_KEY`, ~line 94, never shows the raw key).
- Server: `settingsState()` adds `requirementsInterview: requirementsInterviewSetting() ?? null`; `async requirementsInterviewState()` → `{ requirementsInterviewDefault: { model: (await requirementsModel(() => listModels(''))) ?? null, effort: 'medium' } }`, merged into **both** the GET answer and the POST answer (Save repaints from the POST answer: `app.js` `engineSettingsSave` → `paintEngineSettings(data)`).

- [ ] **Step 1: Settings, cascade, errors** as above.
- [ ] **Step 2: Server.** In `applySettingsPatch`: `has('requirementsInterview')` joins the `refuseNonClaudeUtilityModel` key loop (~9532); validation before any write, `await asSettingsField('requirementsInterview', async () => { const v = assertRequirementsInterviewInput(body.requirementsInterview); if (v?.model) await assertSlotModels([{ id: 'requirementsInterview', engine: 'claude', value: v }]); })`; the write `await asSettingsField('requirementsInterview', () => setRequirementsInterview(body.requirementsInterview))` with the other setters; the key joins the `settings-changed` condition. Both answers as above.
- [ ] **Step 3: Tests.**
  - Cascade / slots: the pair in `settings.json` (the sandboxed-home pattern of `test/utility-model-slots.test.mjs`) resolves through `utilityModelFor('claude', 'requirementsInterview')`; `utilityModelFor('codex', 'requirementsInterview')` is the empty slot; `settingEntry('models.claude.requirementsInterview').userOnly`; a project patch of that id is refused "is set per user"; `settingIds()` contains no `requirementsInterview` id.
  - Validators: `assertUtilityModelsInput({ codex: { requirementsInterview: {…} } })` throws the unknown-job error and the error mapper turns it into the Claude sentence; `assertRequirementsInterviewInput` accepts model only, effort only, both, `null`; refuses `effort: 'low'` and unknown fields.
  - API (`test/api-engine-settings.test.mjs`): POST a catalog Claude model + `high` → GET returns it and the POST answer carries `requirementsInterview` and `requirementsInterviewDefault`; `null` clears; an unknown model → 400 naming the field; a Codex-only model → 400; an effort the model does not offer → 400; GET carries `requirementsInterviewDefault.model` matching `/^claude-opus-/` and `effort: 'medium'`; a change emits `settings-changed`.
  - `test/settings-projects-root.test.mjs` (~319–326, the deep-equal of GET's keys): add `requirementsInterview` and `requirementsInterviewDefault`.
- [ ] **Step 4:** run the four test files; commit `Requirements: the Requirements interview setting (Claude, per user)`.

---

### Task 5: Resolution, the list's model and look cost, the tool's defaults

**Files:**
- Modify: `src/core/requirements/interview.mjs` (`DEFAULTS`, `interviewModel`, `orient`, `runRound`, `interviewCallOptions`)
- Modify: `src/core/requirements/store.mjs` (`recentLookCosts` ~190)
- Modify: `src/core/requirements/routes.mjs` (`lookCostUsd` ~87, `GET /api/requirements` ~170)
- Modify: `tools/requirements-replay.mjs` (default model and effort)
- Modify: `test/requirements-interview.test.mjs`, `test/requirements-api.test.mjs`, `test/requirements-store.test.mjs`

**Interfaces:**
- `interview.mjs`: `export const DEFAULT_INTERVIEW_EFFORT = 'medium'`; `DEFAULTS.interviewSlot = () => utilityModelFor('claude', 'requirementsInterview')`; `export async function interviewModel(deps = {})` → `{ model: string|null, effort: string|null, source: 'settings'|'default' }`: `slot` = `d.interviewSlot()` (a throw ⇒ `{}`); the stored model counts only when `d.listModels(null)` lists it (case-insensitive; a failing catalog read ⇒ it counts); `model` = that model, else `await requirementsModel(d.listModels)`; `effort` = `slot.effort` || (a stored model counts ? `null` : `DEFAULT_INTERVIEW_EFFORT`); `source` = `'settings'` when a stored model or effort was used. `interviewCallOptions` loses its effort default and emits `effort` only when truthy.
- `store.mjs`: `recentLookCosts(limit = 10, { model = null } = {})`: with `model`, only orientation turns whose `model` equals it.
- `routes.mjs`: `lookCostUsd(model)` = the median of `recentLookCosts(10, { model })`, else of `recentLookCosts(10)` when that is empty; the list answer adds `interview`: `{ model, label, effort, source }` or `null` (`label` = the `listModels('')` entry's `label`, else the id; any throw ⇒ `null`; `deps.interviewModel` injectable for tests).

- [ ] **Step 1: Resolution.** `orient` and `runRound` call `interviewModel(d)` where they called `requirementsModel(d.listModels)` and pass `model` and `effort` to `callModel`. Mock mode unchanged. The turn's `model` stays the resolved id.
- [ ] **Step 2: Store and list** as above.
- [ ] **Step 3: Tool.** Without `--model` / `--effort`, the tool uses `interviewModel()`.
- [ ] **Step 4: Tests.**
  - Interview (fake runner, `deps.interviewSlot`; add `interviewSlot: () => ({})` to the file's `deps()` helper): `{}` → `claude-opus-5-5` + `effort: 'medium'` on both calls; `{ model: 'claude-sonnet-5' }` → that model and no `effort` key; `{ effort: 'high' }` → Opus + `high`; both → both; `{ model: 'gone-model' }` (not in the fake catalog) → the default pair; a throwing reader → the default.
  - Store: `recentLookCosts` with and without `model`.
  - API (`test/requirements-api.test.mjs`): the list carries `interview` with `model` matching `/^claude-opus-/`, a non-empty `label`, `effort: 'medium'`, `source: 'default'`; with `deps.interviewModel` stubbed to throw, `interview` is `null` and the list still answers 200; `lookCostUsd` uses the looks of the current model when there are some.
- [ ] **Step 5:** run the three test files and `test/requirements-replay-tool.test.mjs`; commit `Requirements: the interview runs on the Requirements interview model`.

---

### Task 6: The row on Models › Engines (board 10) and the line on New feature (board 13)

**Files:**
- Modify: `ui/public/engine-settings-view.mjs` (`JOB_LABELS` ~8, `OWN_RUN_JOBS` / `utilityId` ~11–12, `JOB_HINTS` ~15, `CLAUDE_HELPER_KEYS` and `enginePatchToSettingsBody` ~146–158)
- Modify: `ui/public/app.js` (`CLAUDE_USER_HELPER_JOBS`, `CLAUDE_USER_HELPER_OWN`, `paintEngineSettings` ~16682–16715; a flag listener)
- Modify: `ui/public/requirements-view.mjs` (`paint` ~218, `paintNew` ~320–352)
- Modify: `test/ui-settings-engines.test.mjs`, `test/requirements-view.test.mjs`
- Unchanged: `ui/public/project-settings-view.mjs` (its `JOBS`, line 13, does not get the job: D1, D3)

- [ ] **Step 1: The row.** `JOB_LABELS.requirementsInterview = 'Requirements interview'`; `JOB_HINTS.requirementsInterview = 'Looks at the code once and runs the interview rounds on the Requirements page.'`; `utilityId('claude', 'requirementsInterview')` must be `models.claude.requirementsInterview` (the cascade id): add the job to the set of jobs with a bare id (today `OWN_RUN_JOBS`; adjust its comment). `enginePatchToSettingsBody`: that id maps to `body.requirementsInterview` = `{ model?, effort? }` with only the non-empty fields, or `null` when both are empty (×). Codex ids never produce it.
- [ ] **Step 2: Models page** (`app.js`): the Claude helper jobs are `['title', 'classifier', 'prDescription', 'memoryDefrag']` plus `'requirementsInterview'` only while `flagOn('requirements')` (computed at paint time, not a module constant). Its field: `own` from `data.requirementsInterview`; `inherited: { value: data.requirementsInterviewDefault?.model ? { model, effort } : undefined, source: 'default' }`, so the empty choices read "Opus 5.5 (default)" and "medium (default)". Not in `noEffort`. `onFlagChange('requirements', …)` repaints the Engines card when the Models page is open (`currentView() === 'models'`). The Models subtitle is unchanged (design D3).
- [ ] **Step 3: New feature** (`requirements-view.mjs`): `paint()` keeps one `GET /api/requirements` call and passes `lookCostUsd` and `interview` to `paintNew(lookCost, interview)`. The actions hint (class `hint req-new-cost`, built without `null` / `false` children):
  - `interview` and a look cost: a `span.req-new-model` "Worca interviews with Opus 5.5 at medium effort", then " · about $0.25 for the code look, then cents per round";
  - `interview`, no look cost: "Worca interviews with Opus 5.5 at medium effort · cents per round";
  - `interview.effort` null: "Worca interviews with Sonnet 5" (no "at … effort");
  - no `interview`: today's "About $0.25 for the code look, then cents per round." or nothing.
  The model name is `interview.label || interview.model`. Lane 2 later replaces only the part after " · ".
- [ ] **Step 4: Tests.** Engines: the Claude card lists the row with its label and hint only when the `requirements` flag is on (set `<html data-flags>` as the existing flag tests do); the empty choices name the default pair; picking Sonnet + high and saving posts `{ requirementsInterview: { model, effort } }`; × posts `{ requirementsInterview: null }`; after Save the card repaints from the POST answer with the default labels intact; the Codex card never has the row; `enginePatchToSettingsBody` maps the id. View: the forms above and today's form (update the existing "cost hint" test, do not delete it).
- [ ] **Step 5:** `node tools/test.mjs test/ui-settings-engines.test.mjs test/requirements-view.test.mjs test/requirements-app.test.mjs`; screenshots of the Models row (desktop) and New feature (desktop and phone width) in the report. Commit `Requirements: Requirements interview on the Models page; New feature says who interviews`.

---

### Task 7: Proof, docs, whole-branch check

**Files:**
- Modify: `tools/verify-requirements-cdp.mjs`
- Modify: `docs/requirements.md`, `docs/models.md`

- [ ] **Step 1: Proof.** In the existing New feature check (mock mode), assert the actions hint starts with "Worca interviews with". Keep the proof's structure and output style.
- [ ] **Step 2: Docs.** `docs/requirements.md`, under *How it works*, a short section **Which model interviews**: the newest Opus at medium effort unless **Requirements interview** on Models › Engines › Claude › Helper jobs says otherwise (a model removed from the catalog falls back to the default); the New feature page names it. Then **What a look or round loads**: Worca's own instructions, not Claude Code's coding-agent ones; none of your user-level Claude Code plugins, hooks, skills or settings; the look's temporary checkout still loads the project's own `.claude/settings.json` hooks and `CLAUDE.md`. And the exception (design D6): when your user-level Claude Code settings (`settings.json` in `~/.claude`, or in `CLAUDE_CONFIG_DIR`) hold your sign-in or network setup, an `apiKeyHelper` or an `env` block for Vertex, Bedrock, your own `ANTHROPIC_*` endpoint, a proxy or a CA (Docker's compose-secret setup is one), Worca keeps your user-level settings for interviews so the sign-in keeps working, and says so once in its log; your plugins and hooks then load as they did before, slash commands still do not. `docs/models.md`: add the Requirements interview to the helper models where the page lists them (the cards paragraph ~line 281): it runs on Claude only, per user, and unlike Memory defragment it takes an effort without a model (then the default model runs at that effort). Product language, short.
- [ ] **Step 3: Whole branch.** `npm test`; for every failing file run the same file on `ec8aed1c` (`git stash -u; git switch --detach ec8aed1c; node tools/test.mjs <files>; git switch -; git stash pop`); only failures that pass on the base are this branch's. `npm run verify:requirements` green. Record the counts.
- [ ] **Step 4:** fix what is this branch's; commit `Requirements: A1.1 proof and docs` (plus `Requirements: whole-branch fixes` if anything else changed).

---

### Task 8: Measure with the real model (only after the user's go-ahead)

Spends money: about $2–3 in all (estimate). **Do not start without the user's explicit yes**, given with the estimate and the runs below. Every run is capped with `--max-usd` (default 1.50). Run with the real `HOME` (a sandboxed home is not signed in to Claude Code), Worca's server untouched; the tool writes nothing into Worca's data. Reports go to the scratchpad, not the repository. The look reads a read-only checkout of a registered project the user names (`<dir>` below; for a fair pair, the same commit before and after).

- [ ] **Step 1:** `claude --version` into the report; Task 2's offline flag probe again.
- [ ] **Step 2: Before** (A2's behaviour): `git switch --detach <Task 1 commit>`; `node tools/requirements-replay.mjs --rounds 4 --look <dir> --model claude-opus-5-5 --effort medium --label before --out <scratch>/before.json --yes`; `git switch -`.
- [ ] **Step 3: After** (branch head): the same command with `--label after --out <scratch>/after.json`. **Required:** the look's `replyReadable` is true (a JSON reply within `REPO_LOOK_MAX_TURNS`), its `systemPromptFlag` is `'replace'`, and `loaded.plugins` / `loaded.skills` dropped against before (this machine's user settings carry no sign-in keys, so the hermetic branch applies: the report's `keptUserSettings` must be false). A failed look is a finding: report it and stop; do not tune the prompt in this task.
- [ ] **Step 4: Variant** (rounds only): `--rounds 4 --variant system-stable --label variant --out <scratch>/variant.json`.
- [ ] **Step 5 (optional, if the user chose it): caching off**, rounds only: `--rounds 4 --no-cache --label nocache --out <scratch>/nocache.json` (`DISABLE_PROMPT_CACHING` is not a reserved env key, `model-env.mjs:159-164`).
- [ ] **Step 6:** `--compare before.json after.json`, `--compare after.json variant.json` (judged by `promptCostRounds2toN`), and `--compare after.json nocache.json` when run. Every round's `replyReadable` must be true after; a false one is a finding.
- [ ] **Step 7:** Fill in §10 of `plans/requirements-a11-design.md` (per configuration: total cost, prompt-side and output-side parts, input tokens, cache writes and reads, output tokens, median round latency; the look before and after; what the init frame loaded; the CLI version) and, under open question 1, what the variant saved. Commit `Requirements: A1.1 measured before and after`.
