# Requirements A1.1: the interview model, its own system prompt, a cache-friendly prompt

Date: 2026-10-21 (revised after review the same day). Base: `feat/req-a2-ready-start` (ec8aed1c). Branch:
`feat/req-a11-interview-model`. Part 1.1 of the requirements track. A1 is `plans/requirements-design.md`
(decisions A1-D<n>), A2 is `plans/requirements-a2-design.md` (A2-D<n>). The screens were agreed as a mock
first (Claude Design canvas "Requirements — design round 2", boards 10 and 13); this document is the build
contract for them. It runs in parallel with A7 (the product brief, lane 2); §9 is the contract between the
two lanes and is written identically into A7's design.

## 1. Goal

**The interview runs on a model the team picks, with a prompt written for it, and costs less per round.**
Today every look and round runs on the newest plain Opus at medium effort (A1-D8), with Worca's instructions
appended to Claude Code's own coding-agent system prompt, and with the user's own plugins, hooks and skills
loaded into each call.

**Success:**
1. The interview model and effort are a helper job, **Requirements interview**, on Models › Engines › Claude
   › Helper jobs (board 10); unset, it is what it is today: the newest plain Opus at medium effort.
2. The New feature page says who interviews: "Worca interviews with Opus 5.5 at medium effort" (board 13).
3. The look and the rounds send Worca's own system prompt **instead of** Claude Code's default one, and load
   none of the user's plugins, hooks or skills.
4. The prompt is ordered for the prompt cache: a system prompt with no per-call value, then the feature's
   stable blocks, then what changes each round.
5. Cost, input and cache tokens and latency per call are measured with the real model before and after, rounds
   and the look, with a small tool, so the effect is shown, not assumed.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **A Claude-only, user-only setting entry `models.claude.requirementsInterview`.** It is found by id, like Ask Worca's model entries (`src/core/settings-cascade.mjs:100-108`), and is **not** added to `UTILITY_JOBS`: that list feeds `settingIds()` and so the project Settings API (the job would be listed there even with the flag off), and would need a Codex special case. `utilityModelFor('claude', 'requirementsInterview')` resolves it unchanged (`utilityId` gives `models.claude.requirementsInterview`, which `settingEntry` now knows); for Codex it finds nothing and returns the empty slot, and `utilityModels.codex.requirementsInterview` is refused as an unknown job, with a readable message (`settings-errors.mjs`). Stored as `requirementsInterview: { model?, effort? }` in `settings.json` (a pair, like `memoryDefrag`; `utilityModels.claude` is refused by design, `settings.mjs:1259`). Not in Ask Worca's settings registry in v1 (`src/core/ask/settings-registry.mjs:59-62`). |
| D2 | **Resolution**, `interviewModel(deps)` in `interview.mjs`, once per call: the stored model when the catalog still lists it, else the newest plain Opus (`requirementsModel`, A1-D8, unchanged). So a model removed from the catalog falls back to the default instead of failing every call (the stored pair is kept; the Models row shows it as "not in the catalog", as inherit-field does today). Effort: the stored effort; else `medium` when no model is stored (today's value); else none, the model's own default (a model was picked and its effort left empty, which the effort select calls "Model default"). An effort without a model is allowed here (the board's "Opus 5.5 at high effort"; `memoryDefrag` refuses it, `settings.mjs:413`: the docs say so). One pair for the look and the rounds (and for A7's brief, §9). The model is stored on each turn as today. |
| D3 | **Where it shows.** Board 10: a row **Requirements interview** in Claude's Helper jobs (Model + Effort, Test, ×), hint "Looks at the code once and runs the interview rounds on the Requirements page.", empty choices reading "Opus 5.5 (default)" and "medium (default)". The row exists only while the `requirements` flag is on (A2-D14). The project Settings tab's jobs (`ui/public/project-settings-view.mjs:13`) stay unchanged. Board 13: the New feature actions line "Worca interviews with <model> at <effort> effort", followed by the cost words that are there today. Product owners **see** the model and change it only in Models, as for every helper job (**Q1, default until answered**). The board's Models subtitle change ("… and requirements interviews use") is **not** built: that sentence is static and would name the feature with the flag off; the row's hint says it instead. |
| D4 | **Worca's own system prompt replaces Claude Code's.** Today `callModel` (`interview.mjs:108`) passes `systemPrompt`, which `buildClaudeArgs` sends as `--append-system-prompt` (`src/core/engines/claude.mjs:322-325`), or `--append-system-prompt-file` when the argv is staged (`claude.mjs:418-421`; over `ARGV_INLINE_LIMIT` = 20 000 characters, `claude.mjs:89`, which later rounds reach normally): appended to Claude Code's default coding-agent prompt. **Runner change (upstream, default-off):** a runner option `systemPromptMode: 'append' \| 'replace'` (default `append`). `replace` sends `--system-prompt <text>`, staged `--system-prompt-file <path>`. `runClaude` names it in its destructure and in `engine.run` (`src/core/claude-runner.mjs:130-264`, the gate), `runClaudeProcess` forwards it to `stageClaudeInvocation` (`claude.mjs:444`, `:528`). Absent or `append`: every argv stays byte-identical. The host-guard preamble stays: the runner prepends it to `systemPrompt` before the flag is chosen (`claude.mjs:523-525`). Codex, Cursor and Copilot ignore the option. Checked offline on Claude Code 2.1.304 with the API unreachable (no spend): `--system-prompt-file` is accepted (a missing file answers "System prompt file not found", a misspelt flag "unknown option"); `--help` names it only inside `--bare`'s text. Docker pins 2.1.294 (`docker/CLAUDE_CODE_VERSION`), not probed; no fallback is built: a CLI that refuses the flag fails the call, which is an ordinary error turn with **Try again**. |
| D5 | **What the replaced prompt must carry**, now that the default is gone. Both prompts: who Worca is and who it talks to, the data rule, the reply format (all already there, plus a role header). The look additionally: its three read-only tools and how to use them, that it cannot run commands or change anything, that its final message is the JSON (in lane 1's header lines; the JSON line itself is lane 2's, §9), and the working directory, which goes into the **user** prompt's existing working-directory sentence (it changes per look; the default prompt used to carry it). **What stays exactly as now:** `tools` / `allowedTools` (`REPO_LOOK_TOOLS` for the look, none for rounds), `maxTurns` for the look, `strictMcpConfig`, `permissionMode`, `spawnKind: 'aux'`, the timeouts, `modelEnv` routing, the budget check before and booking after each call, the mock. |
| D6 | **A hermetic call: `settingSources: ['project']` and `disableSlashCommands: true`** on both calls, as Ask Worca's chat (`src/core/ask/spawn.mjs:194`), its title and suggestion calls (`turn.mjs:1402`, `:1453`), the night analysis and pinpoint already do. The user's plugins, hooks and skills no longer load into an interview (observed offline on a development machine: without it a user plugin's SessionStart hook injects a long block of instructions into every call; with it, none). **No regression against A2 (controller's decision):** `--setting-sources project` would drop user-level Claude Code settings too, and a sign-in that lives there would fail with "Not logged in". So before every call Worca reads the user settings file the CLI reads, `settings.json` in `CLAUDE_CONFIG_DIR` or else `<home>/.claude` (the same resolution as `src/core/skills-registry/host.mjs:99-100`), and when it carries sign-in or network configuration, a non-empty `apiKeyHelper`, `awsAuthRefresh` or `awsCredentialExport`, or an `env` block with any of `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_*` (Vertex, Bedrock, Foundry), `AWS_*`, `CLOUD_ML_REGION`, `GOOGLE_APPLICATION_CREDENTIALS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `ANTHROPIC_*`, `HTTP_PROXY` / `HTTPS_PROXY` (either case), `NODE_EXTRA_CA_CERTS`, the requirements calls do **not** pass `settingSources: ['project']`: they keep A2's behaviour (all setting sources), still with `disableSlashCommands: true`, and Worca logs once per server process `[worca] requirements: user Claude settings carry or may carry sign-in; keeping them for interviews`. This covers Docker's documented compose-secret setup (`docker/entrypoint.sh:223-225` writes an `apiKeyHelper` there). A missing or blank file, or valid JSON that is not an object, counts as "no sign-in there" (the hermetic flags apply); a file that exists but cannot be read or parsed keeps A2's behaviour (user settings kept). The check is `userClaudeSignIn()` in `interview.mjs`, read per call (a changed file applies without a restart). A stored `claude login` (`.credentials.json`) and `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` in Worca's environment keep working with the hermetic flags. Ask Worca has the plain gap today; carrying the user layer's auth keys through `extraSettings` for every hermetic spawn (`--settings` survives `--setting-sources project`; not with the credential broker on, `broker-guard.mjs:45`) is a separate issue. **What it keeps:** the look's checkout still loads the project's own `.claude/settings.json` hooks and its `CLAUDE.md`; only user-level ones are dropped. **Rejected:** `--bare` (accepts only API-key auth, no OAuth), `disableAllHooks` (would also switch off the host-guard hook), `--safe-mode` / `--restricted` (unknown to the code, unverified on the Docker pin). |
| D7 | **Prompt order and the cache boundary.** The system prompt has no date, path or per-call value of its own (the default prompt's per-machine sections leave with it); it still starts with the host-guard preamble, which names the server's PID (`host-guard.mjs:54`), so it is identical only within one server process. The round prompt keeps A2's order, which is already stable-first: `<feature>`, `<description>`, `<project_context>` (A7's `<product_brief>` after it), `<what_worca_found_in_the_code>`, then `<thread>` (append-only), `<current_spec>`, `<edited_by_product_owner>`, the round line, the follow-up line, the reply line. A1.1 makes the split explicit, `roundPromptParts()` → `{ stable, changing }`, and pins it with a test; `buildRoundPrompt` returns the same text as A2. **Where a saving can come from:** `claude -p` sends the prompt as one content block, and the API reuses a cached prefix only up to a cache breakpoint, and only above a model-specific minimum length (a round's system prompt of about 700 tokens with no tools may be below Opus's minimum and not be cached at all). So the order inside the message is expected to save little; what does save: (a) the default prompt, the user's plugin context and the per-machine sections are gone; (b) the look's system prompt no longer carries a per-look working directory, so it and the tool definitions can be reused across looks. **Measured variant, not shipped:** the feature's stable blocks at the end of the system prompt, which makes it long enough to cache and lets rounds 2..n of a feature read it. It is judged by the measured prompt-side cost of rounds 2..n; shipping it is the user's call (open question 1) because it puts the product owner's and the look's text into the system prompt. |
| D8 | **The measurement tool**, `tools/requirements-replay.mjs` (not shipped, not in `npm test`): replays N rounds (default 4, at most 6) and, with `--look <dir>`, one look, for a fixed fixture feature (`tools/requirements-replay.fixture.json`), so before and after send the same content. It builds every call with the production builders (`interviewCallOptions`, `buildRoundPrompt`, `buildOrientationPrompt`) and spawns them one after another through `runClaudeAdapter`, the function `runClaude` reaches for Claude (`src/core/engines/index.mjs:29`), so it sees the CLI's raw frames (the normalized `init` event drops what loaded); the only part of `runClaude` it skips is the mock switch (refused anyway) and the `.mcp.json` check (skipped under `strictMcpConfig`). Per call: cost (the CLI's, through `resolveModelCost` as `callModel` books it), input tokens, cache writes (5 m / 1 h), cache reads, output tokens, the prompt-side and output-side share of the cost, the CLI's duration, wall time, turns, the models in `modelUsage`, what the `init` frame loaded (plugins, skills, slash commands, tools, `apiKeySource`), which system-prompt flag the spawn used (from `WORCA_DEBUG_SPAWN`'s argv line), and whether the reply parses. It refuses mock mode before anything else, is a dry run without `--yes`, stops at a `--max-usd` cap, and `--compare a.json b.json` diffs two reports offline. **Before** = the branch at the tool's own commit (Task 1: A2's behaviour, unchanged); **after** = the branch head. The real runs spend money and need the user's go-ahead: a separate, final task, with a look before and after as a required part. |
| D9 | **No schema change, no new route.** The setting is a `settings.json` key; `GET /api/settings`, the `POST /api/settings` answer and `GET /api/requirements` gain fields; the flag rules of A2-D14 are unchanged. |

## 3. Data

No database change. `settings.json` (user layer) gains one optional key:

```json
"requirementsInterview": { "model": "claude-sonnet-5-5", "effort": "high" }
```

Either field may be absent; `null` clears it. Validated with `normalizeModelPair('claude', …)` (effort one of
Claude's efforts) and `assertSlotModels` (the model is in the catalog, runs on Claude, offers that effort).

## 4. API (changed)

| Route | Change |
|---|---|
| `GET /api/settings` and the `POST /api/settings` answer | add `requirementsInterview` (stored pair or `null`) and `requirementsInterviewDefault` (`{ model, effort: 'medium' }`: the newest plain Opus, what the empty choices mean). The POST answer needs both because Save repaints the Engines card from it (`app.js` `engineSettingsSave` → `paintEngineSettings(data)`). |
| `POST /api/settings` | accepts `requirementsInterview` (`{ model?, effort? }` or `null`); refused, naming the field, for a model Claude cannot run, an unknown model, an effort the model does not offer; a change sends `settings-changed` |
| `GET /api/requirements` | adds `interview`: `{ model, label, effort, source: 'settings' \| 'default' }` (`label` the catalog's name, else the id), or `null` when no model resolves. `lookCostUsd` becomes the median of the recent looks made with that model, when there are any (else of all recent looks, as today). |

## 5. Screens (boards 10 and 13)

- **Models › Engines › Claude › Helper jobs** (board 10): the row **Requirements interview** after Memory
  defragment, with the hint above; Model (catalog, Claude models) and Effort selects; **Test** and **×** as on
  every helper row. Listed in "+ Override a helper job…" and counted in "N other helper jobs follow Worca's
  defaults". Present only while the `requirements` flag is on; the card repaints when the flag flips.
- **New feature** (board 13, without a brief): the actions line reads
  `Worca interviews with Opus 5.5 at medium effort · about $0.25 for the code look, then cents per round`
  (no look cost yet: `… · cents per round`; no model resolved: today's text). With A7's brief, lane 2
  replaces only the part after the dot (board 13's "· cents per round"), never the model part.

## 6. Code changes

- `src/core/claude-runner.mjs`, `src/core/engines/claude.mjs`: `systemPromptMode` (D4).
- `src/core/requirements/round.mjs`: the system prompts' header lines (D5); `roundPromptParts` (D7); the
  working directory in `buildOrientationPrompt`'s existing working-directory sentence.
- `src/core/requirements/interview.mjs`: `interviewCallOptions(kind, overrides, { keepUserSettings })` and
  `callModel` (exported), the one place a call's options are built (§9), `interviewModel(deps)`,
  `userClaudeSignIn()`; replace mode and the hermetic flags (with D6's exception).
- `src/core/requirements/store.mjs`: `recentLookCosts(limit, { model })`.
- `src/core/settings.mjs`: `SETTINGS_POST_KEYS`, `requirementsInterviewSetting`,
  `assertRequirementsInterviewInput`, `setRequirementsInterview`.
- `src/core/settings-cascade.mjs`: the by-id entry.
- `src/core/settings-errors.mjs`: the field label and the Codex refusal's wording.
- `src/core/requirements/routes.mjs`: `interview` and the per-model look cost on the list.
- `ui/server.mjs`: settings state (GET and the POST answer) and patch.
- `ui/public/engine-settings-view.mjs`, `ui/public/app.js`: the row (board 10).
- `ui/public/requirements-view.mjs`: the line (board 13).
- `tools/requirements-replay.mjs`, `tools/requirements-replay.fixture.json`: the measurement (D8).
- `tools/verify-requirements-cdp.mjs`: the New feature line.
- Docs: `docs/requirements.md` (which model interviews, what a call loads and what sign-ins it needs),
  `docs/models.md` (the helper job, effort without a model).

## 7. Testing

- **Runner:** `buildClaudeArgs` / `planClaudeInvocation` with `replace`: `--system-prompt <text>` inline,
  `--system-prompt-file <path>` staged, never an `--append-system-prompt*` flag; absent / `append` / junk:
  byte-identical argv (the snapshot test stays green); the host-guard preamble leads a replaced prompt;
  `runClaude` forwards the option (the POSIX forwarding test; skipped on Windows like its neighbours).
- **Prompts:** `buildRoundPrompt` equals A2's text for a fixture (stored expectation); for two consecutive
  rounds of one feature the later prompt starts with the earlier one's `stable` part and its thread text; the
  system prompts contain no date, path or per-call value; the look prompt names its working directory once.
- **Calls:** `interviewCallOptions` / `callModel` accept exactly the overrides `systemPrompt`, `tools`,
  `maxTurns`, `effort` and the kinds `look` / `round`; the fake runner sees `systemPromptMode: 'replace'`,
  `settingSources: ['project']`, `disableSlashCommands: true` on both calls, the look tools and `maxTurns`
  unchanged, rounds tool-less; an override (A7's brief shape) keeps replace mode and the hermetic flags. With
  a fixture user settings file carrying `apiKeyHelper` (and, one at a time, an `env` block with each listed
  key) the calls carry no `settingSources` but still `disableSlashCommands`, and the log line appears once;
  with a file without them, no file or an invalid one, `settingSources: ['project']`; `CLAUDE_CONFIG_DIR`
  moves the file.
- **Model:** unset → newest plain Opus at `medium`; model only → that model, no effort; effort only → newest
  Opus at that effort; both → both; a stored model no longer in the catalog → the default; a throwing slot
  reader → the default.
- **Setting:** the by-id entry, `userOnly`, absent from `settingIds()`; no Codex entry and a readable Codex
  refusal; POST validation (unknown model, non-Claude model, effort not offered, clear with `null`); GET and
  POST answers carry both fields (the settings-keys test); `settings-changed` on a change.
- **API:** the list carries `interview` (default Opus, `medium`, `source: 'default'`; after a POST the stored
  pair, `source: 'settings'`); the look cost per model.
- **UI (jsdom):** the row with its hint, absent with the flag off, saves `{ requirementsInterview: … }`, ×
  clears to `null`; the empty choices name the default; the New feature line in its forms.
- **Tool:** mock refused before the dry run; dry run spawns nothing; the plan grows the thread round by round
  from the fixture; with a fake runner the report sums usage and splits the cost right; `--max-usd` stops;
  `--compare` deltas.
- **Real model (final task, with the user's go-ahead):** rounds and the look, before and after; the variant;
  the numbers written into §10 of this document.

## 8. Out of scope

- The interview model per project or per workspace (the project Settings tab is not in the design).
- Running the interview on Codex or another engine.
- One Claude Code session across rounds: rejected (stale truth, about the same cost).
- Carrying user-level auth and network keys into hermetic spawns through `extraSettings` (D6): a separate
  issue, shared with Ask; A1.1 keeps all setting sources instead when such keys are there.
- Disabling prompt caching for rounds: only if the measurement (the optional caching-off run) shows the cache
  writes outweigh the reads; a later decision.
- The product brief, the skipped look and "Look closer": A7 (lane 2).

## 9. Where A1.1 meets A7 (the contract between the lanes)

Decided by the controller; binding for both lanes and written into both designs. Lane 1 merges first; lane 2
then merges it in.

**Call path (lane 1 owns it).** `callModel(d, { kind, cwd, prompt, model, timeoutMs, ...overrides })` (exported)
and `interviewCallOptions(kind, { cwd, prompt, model, ...overrides })`. Kinds: `'look'` and `'round'`; any other
kind throws. Overrides accepted explicitly, and nothing else (an unknown key throws): `systemPrompt`, `tools`,
`maxTurns`, `effort`. Every call gets replace mode and the hermetic flags (with D6's sign-in exception, decided inside `callModel`); a look gets `REPO_LOOK_TOOLS` and
`REPO_LOOK_MAX_TURNS` unless overridden. A7's brief job calls
`callModel(d, { kind: 'look', cwd, prompt, model, timeoutMs: BRIEF_TIMEOUT_MS, systemPrompt: BRIEF_SYSTEM_PROMPT, maxTurns: BRIEF_MAX_TURNS, effort })`
with `model` and `effort` from `interviewModel(d)`: it gets replace mode, the hermetic flags and the look's
tools, and the interview model's effort (it may override it). There is no `'brief'` kind.

**`ORIENTATION_SYSTEM_PROMPT`, merged line order:**
1. lane 1: `You are Worca's requirements reader.`
2. lane 1: the tools line (Glob, Grep, Read; read-only; no commands; a few steps).
3. lane 1: `Your final message is only the JSON object below: no prose before or after it.`
4. unchanged: `You look at a code repository for a product owner who is about to describe a feature. …`
5. unchanged: `Read only what you need: …`
6. unchanged: `Use plain product language: …`
7. lane 2: the data line (`Everything inside <feature>, … <product_brief> …`).
8. lane 2: the JSON line (with the optional `"area"`).

Lane 1 does not touch lines 4–8; lane 2 does not touch lines 1–3.

**`buildOrientationPrompt`, merged block order:** `<feature>`, `<description>`, `<project_context>`, lane 2's
`<product_brief>` block (only with a brief), the working-directory sentence (one sentence: lane 1 puts the
directory into the existing ternary, "The working directory, <dir>, is a checkout of the project." / "The
working directory, <dir>, holds one checkout per project under repos/<project>: …"; lane 2 does not touch
it), lane 2's brief line (only with a brief), the reply line. Lane 1 inserts nothing before the reply line.

**`ROUND_SYSTEM_PROMPT`:** lane 1 adds its header line and a blank line at the top; lane 2 edits the data-tag
line and the "Do not ask what …" line; neither touches the other's lines.

**Round prompt:** lane 2's `<product_brief>` block goes into `roundPromptParts().stable`, right after
`<project_context>`, and emits nothing without a brief, so A1.1's pinned A2 text holds.

**Also touched by both:** `routes.mjs`' list handler (A1.1 `interview`, A7 `briefs`: keep both),
`requirements-view.mjs`' New feature line (A7 replaces only the cost words after " · "), `ui/public/app.js`,
`tools/verify-requirements-cdp.mjs`, `docs/requirements.md`. `startOrientation` and `runOrientation` are lane 2's.

## 10. Measured

Filled in by the final task (before = Task 1's commit, after = the branch head, same model, effort, fixture):
per configuration, total cost, its prompt-side and output-side parts, input tokens, cache writes and reads,
output tokens and median latency per round; the look before and after; what the `init` event loaded; the CLI
version.

## Open questions (defaults until the user answers)

1. Ship the variant of D7 (the feature's stable blocks in the system prompt) if it measures clearly cheaper?
   Default: no.
2. Q1 (lanes): product owners see the interview model, change it only in Models. Default: see-only.
3. Hide the row while the `requirements` flag is off (the entry also stays out of `settingIds()` and Ask's
   registry)? Default: yes.
4. The real measurement's budget: about $2–3 in all (rounds before, after and the variant; the look before and
   after, required; optionally an "after, caching off" run), each run capped with `--max-usd`. Default: as
   listed, after the user's go-ahead.
