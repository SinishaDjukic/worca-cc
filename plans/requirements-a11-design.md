# Requirements A1.1: the interview model, its own system prompt, a cache-friendly prompt

Date: 2026-10-21. Base: `feat/req-a2-ready-start` (ec8aed1c). Branch: `feat/req-a11-interview-model`.
Part 1.1 of the requirements track. A1 is `plans/requirements-design.md` (decisions A1-D<n>), A2 is
`plans/requirements-a2-design.md` (A2-D<n>). The screens were agreed as a mock first (Claude Design canvas
"Requirements — design round 2", boards 10 and 13); this document is the build contract for them. It runs
in parallel with A7 (the product brief, lane 2): see §9 for what each lane owns.

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
4. The prompt is ordered for the prompt cache: a system prompt that is byte-identical for every feature and
   round, then the feature's stable blocks, then what changes each round.
5. Cost, input and cache tokens and latency per call are measured with the real model before and after, with
   a small tool, so the effect is shown, not assumed.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **A Claude helper job `requirementsInterview`.** It joins `UTILITY_JOBS` (`src/core/settings.mjs:1157`); its setting id is `models.claude.utility.requirementsInterview` and it resolves through `utilityModelFor('claude', 'requirementsInterview')` (`src/core/settings-cascade.mjs:249`). Claude's helper slots live in their own settings keys (`titleModel`, `autoWorkflowModel`, `prDescriptionModel`, `memoryDefrag`; `utilityModels.claude` is refused by design, `settings.mjs:1259`), so this one is stored as `requirementsInterview: { model?, effort? }` in `settings.json` (a pair, like `memoryDefrag`). **User-level only** (`userOnly`, like the workspace scan): the interview is not a run and the project Settings tab is not in the design. **Claude only**: rounds and the look are Claude Code calls (they rely on `--tools`, `--system-prompt`), so the Codex tab does not list the job and `utilityModels.codex.requirementsInterview` is refused with "the requirements interview runs on Claude". |
| D2 | **Resolution**, `interviewModel(deps)` in `interview.mjs`, once per call: the slot's model, else the newest plain Opus (`requirementsModel`, A1-D8, unchanged). Effort: the slot's effort; else `medium` when no model is set (today's value); else none, the model's own default (a model was picked and its effort left empty, which the effort select calls "Model default"). An effort without a model is allowed (the board's "Opus 5.5 at high effort"). One pair for the look and the rounds. The model is stored on each turn as today. |
| D3 | **Where it shows.** Board 10: a row **Requirements interview** in Claude's Helper jobs (Model + Effort, Test, ×), hint "Looks at the code once and runs the interview rounds on the Requirements page.", empty choices reading "Opus 5.5 (default)" and "medium (default)". The row exists only while the `requirements` flag is on (A2-D14: the feature is invisible with the flag off). Board 13: the New feature actions line "Worca interviews with <model> at <effort> effort", followed by the cost words that are there today. Product owners **see** the model and change it only in Models, as for every helper job (**Q1, default until answered**). The board's Models subtitle change ("… and requirements interviews use") is **not** built: that sentence is static and would name the feature with the flag off; the row's hint says it instead. |
| D4 | **Worca's own system prompt replaces Claude Code's.** Today `callModel` (`interview.mjs:108`) passes `systemPrompt`, which `buildClaudeArgs` sends as `--append-system-prompt` (`src/core/engines/claude.mjs:322-325`), or `--append-system-prompt-file` when the argv is staged (`claude.mjs:418-421`): appended to Claude Code's default coding-agent prompt. **Runner change (upstream, default-off):** a runner option `systemPromptMode: 'append' \| 'replace'` (default `append`). `replace` sends `--system-prompt <text>`, staged `--system-prompt-file <path>`. `runClaude` names it in its destructure and in `engine.run` (`src/core/claude-runner.mjs:130-264`, the gate), `runClaudeProcess` forwards it to `stageClaudeInvocation` (`claude.mjs:444`, `:528`). Absent or `append`: every argv stays byte-identical. The host-guard preamble stays: the runner prepends it to `systemPrompt` before the flag is chosen (`claude.mjs:523-525`), so a replaced prompt starts with it as before. Codex, Cursor and Copilot ignore the option. Checked offline on Claude Code 2.1.304, with the API unreachable (no spend): `--system-prompt-file` is accepted (a missing file answers "System prompt file not found", a misspelt flag "unknown option"). |
| D5 | **What the replaced prompt must carry**, now that the default is gone. Both prompts: who Worca is and who it talks to, the data rule, the reply format (all already there, plus a two-line role header). The look additionally: its three read-only tools and how to use them, that it cannot run commands or change anything, that its final message is the JSON, and the working directory, which goes into the **user** prompt (it changes per look; the default prompt used to carry it). **What stays exactly as now:** `tools` / `allowedTools` (`REPO_LOOK_TOOLS` for the look, none for rounds), `maxTurns` for the look, `strictMcpConfig`, `permissionMode`, `spawnKind: 'aux'`, the timeouts, `modelEnv` routing, the budget check before and booking after each call, the mock. |
| D6 | **A hermetic call.** Both calls also pass `settingSources: ['project']` and `disableSlashCommands: true`, as Ask Worca's title and suggestion calls do (`src/core/ask/turn.mjs:1402`, `:1453`): the user's plugins, hooks and skills no longer load into an interview. Observed offline on this machine: without it, a user plugin's SessionStart hook injects a long block of instructions into every call; with it, none. `--bare` was considered and rejected: it accepts only API-key auth. |
| D7 | **Prompt order and the cache boundary.** The system prompt is byte-identical for every feature and round (the default prompt's per-machine sections, date, working directory and git status, leave with it). The round prompt keeps A2's order, which is already stable-first: `<feature>`, `<description>`, `<project_context>` (lane 2 inserts `<product_brief>` here), `<what_worca_found_in_the_code>`, then `<thread>` (append-only), `<current_spec>`, `<edited_by_product_owner>`, the round line, the follow-up line, the reply line. A1.1 makes the split explicit, `roundPromptParts()` → `{ stable, changing }`, and pins it with a test; `buildRoundPrompt` returns the same text as A2. **Where the saving comes from:** `claude -p` sends the prompt as one content block, and the API reuses a cached prefix only up to a cache breakpoint; as far as the CLI's behaviour is known, it sets them after the system prompt and at the end of the message, so inside the user message the order alone is expected to save little (the measurement says how much). What does save: (a) the default prompt, the user's plugin context and the per-machine sections are gone; (b) the look's system prompt no longer carries a per-look working directory, so it and the tool definitions are reused across looks. **Measured variant, not shipped:** the feature's stable blocks at the end of the system prompt, which would let rounds 2..n of a feature read them from the cache. The tool measures it; shipping it is the user's call (open question 1) because it puts the product owner's and the look's text into the system prompt. |
| D8 | **The measurement tool**, `tools/requirements-replay.mjs` (not shipped, not in `npm test`): replays N rounds (default 4, at most 6) and, with `--look <dir>`, one look, for a fixed fixture feature (`tools/requirements-replay.fixture.json`: title, description, notes, look summary, and per round the questions, the answers and the spec after it), so before and after send the same content. It builds every call with the production builders (`interviewCallOptions`, `buildRoundPrompt`, `buildOrientationPrompt`) and spawns through `runClaude`, sequentially, with an optional `--gap <seconds>` (to see the 5-minute cache lifetime). Per call: the CLI's cost, input tokens, cache writes (5 m / 1 h), cache reads, output tokens, the CLI's duration, wall time, turns, the models seen in `modelUsage`, and whether the reply parses (`applyRound`). Without `--yes` it is a dry run (prints the calls and their sizes, spawns nothing); `--compare a.json b.json` diffs two reports offline. **Before** = the branch at the tool's own commit (Task 1: A2's behaviour, unchanged); **after** = the branch head. The real runs spend money and need the user's go-ahead: they are a separate, final task. |
| D9 | **No schema change, no new route.** The setting is a `settings.json` key; `GET /api/settings` and `GET /api/requirements` gain fields; the flag rules of A2-D14 are unchanged. |

## 3. Data

No database change. `settings.json` (user layer) gains one optional key:

```json
"requirementsInterview": { "model": "claude-sonnet-5-5", "effort": "high" }
```

Either field may be absent; `null` or `{}` clears it. Validated with `normalizeModelPair('claude', …)` (effort one
of Claude's efforts) and `assertSlotModels` (the model is in the catalog, runs on Claude, offers that effort).

## 4. API (changed)

| Route | Change |
|---|---|
| `GET /api/settings` | adds `requirementsInterview` (stored pair or `null`), `requirementsInterviewDefault` (`{ model, effort: 'medium' }`: the newest plain Opus, what the empty choices mean) |
| `POST /api/settings` | accepts `requirementsInterview` (`{ model?, effort? }` or `null`); refused, naming the field, for a model Claude cannot run, an unknown model, an effort the model does not offer; a change sends `settings-changed` |
| `GET /api/requirements` | adds `interview`: `{ model, label, effort, source: 'settings' \| 'default' }` (`label` the catalog's name, else the id), or `null` when no model resolves |

## 5. Screens (boards 10 and 13)

- **Models › Engines › Claude › Helper jobs** (board 10): the row **Requirements interview** after Memory
  defragment, with the hint above; Model (catalog, Claude models) and Effort selects; **Test** and **×** as on
  every helper row. Listed in "+ Override a helper job…" and counted in "N other helper jobs follow Worca's
  defaults". Present only while the `requirements` flag is on; the card repaints when the flag flips.
- **New feature** (board 13, without a brief): the actions line reads
  `Worca interviews with Opus 5.5 at medium effort · about $0.25 for the code look, then cents per round`
  (no look cost yet: `… · cents per round`; no model resolved: today's text). With A7's brief, lane 2
  replaces the part after the dot (board 13's "· cents per round"), never the model part.

## 6. Code changes

- `src/core/claude-runner.mjs`, `src/core/engines/claude.mjs`: `systemPromptMode` (D4).
- `src/core/requirements/round.mjs`: the two system prompts (D5); `roundPromptParts` (D7);
  `buildOrientationPrompt` names the working directory.
- `src/core/requirements/interview.mjs`: `interviewCallOptions(kind, …)` (the one place a call's options are
  built, also for the tool), `interviewModel(deps)`, `callModel` uses both; replace mode and the hermetic
  flags (D4, D6).
- `src/core/settings.mjs`: `UTILITY_JOBS`, `SETTINGS_POST_KEYS`, `requirementsInterviewSetting`,
  `assertRequirementsInterviewInput`, `setRequirementsInterview`, the Codex refusal.
- `src/core/settings-cascade.mjs`: the id, the Claude reader, `userOnly`, no Codex entry.
- `src/core/settings-errors.mjs`: the field label.
- `src/core/requirements/routes.mjs`: `interview` on the list.
- `ui/server.mjs`: settings state and patch.
- `ui/public/engine-settings-view.mjs`, `ui/public/app.js`: the row (board 10).
- `ui/public/requirements-view.mjs`: the line (board 13).
- `tools/requirements-replay.mjs`, `tools/requirements-replay.fixture.json`: the measurement (D8).
- `tools/verify-requirements-cdp.mjs`: the New feature line.
- Docs: `docs/requirements.md` (which model interviews, what a call loads), `docs/models.md` (the helper job).

## 7. Testing

- **Runner:** `buildClaudeArgs` / `planClaudeInvocation` with `replace`: `--system-prompt <text>` inline,
  `--system-prompt-file <path>` staged, never an `--append-system-prompt*` flag; absent / `append` / junk:
  byte-identical argv (the snapshot test stays green); the host-guard preamble leads a replaced prompt;
  `runClaude` forwards the option (the POSIX forwarding test; skipped on Windows like its neighbours).
- **Prompts:** `buildRoundPrompt` equals A2's text for a fixture (stored expectation); for two consecutive
  rounds of one feature the later prompt starts with the earlier one's `stable` part and its thread text; the
  system prompts contain no date, path or per-run value; the look prompt names its working directory.
- **Calls:** the fake runner sees `systemPromptMode: 'replace'`, `settingSources: ['project']`,
  `disableSlashCommands: true` on both calls, the look tools and `maxTurns` unchanged, rounds tool-less.
- **Model:** unset → newest plain Opus at `medium`; model only → that model, no effort; effort only → newest
  Opus at that effort; both → both; a throwing slot reader falls back to the default.
- **Setting:** cascade id and reader; `userOnly`; no Codex entry; POST validation (unknown model, non-Claude
  model, effort not offered, clear with `null`); `GET /api/settings` fields; `settings-changed` on a change.
- **API:** the list carries `interview` (default Opus, `medium`, `source: 'default'`; after a POST the stored
  pair, `source: 'settings'`).
- **UI (jsdom):** the row with its hint, absent with the flag off, saves `{ requirementsInterview: … }`, ×
  clears to `null`; the empty choices name the default; the New feature line in its three forms.
- **Tool:** dry run spawns nothing; the plan grows the thread round by round from the fixture; with a fake
  runner the report sums usage right; `--compare` deltas; refused under `WORCA_MOCK`.
- **Real model (final task, with the user's go-ahead):** before / after / variant, and the numbers written
  into §10 of this document.

## 8. Out of scope

- The interview model per project or per workspace (the project Settings tab is not in the design).
- Running the interview on Codex or another engine.
- One Claude Code session across rounds: rejected (stale truth, about the same cost).
- Disabling prompt caching for rounds (whose message is written to the cache and never read back): only if
  the measurement shows the cache writes outweigh the reads; a later decision.
- The product brief, the skipped look and "Look closer": A7 (lane 2).

## 9. Lanes (A1.1 next to A7)

Lane 1 (this part) owns, in `round.mjs` and `interview.mjs`: the two system prompts' new header and look
lines, `roundPromptParts`, the working-directory line, `interviewCallOptions`, `interviewModel`, `callModel`.
It does **not** edit the data-rule line of `ROUND_SYSTEM_PROMPT` (lane 2 adds `<product_brief>` to it), nor
`startOrientation` (lane 2's skip). Lane 1 merges first; lane 2 then puts its brief block into
`roundPromptParts`' `stable` list, after `<project_context>`.

## 10. Measured

Filled in by the final task (before = Task 1's commit, after = the branch head, same model, effort, fixture):
per configuration, total cost, input tokens, cache writes and reads, output tokens and median latency per
round, and for the look when it was measured.

## Open questions (defaults until the user answers)

1. Ship the variant of D7 (the feature's stable blocks in the system prompt) if the measurement shows a clear
   saving? Default: no; the design keeps them in the user message.
2. Q1 (lanes): product owners see the interview model, change it only in Models. Default: see-only.
3. The real measurement's budget: about $1 to $1.50 for 4 rounds × 3 configurations, plus about $0.50 if the
   look is measured too. Default: rounds only, then a second pass with `--gap 90` if the first shows cache
   reads.
