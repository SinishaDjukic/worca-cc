# Team Memory — Usage Tracking (draft)

Worca mounts agent memory into every run as Claude Code rules (`<runCwd>/.claude/rules/worca/{global,project,team}/`,
`mountMemory` in `src/core/memory-sync.mjs`, `_mountMemoryUnguarded` in `src/core/run-harness.mjs`), and records nothing
about whether an agent used a note. So notes cannot be ranked, stale notes cannot be found, and phase 2 of team memory
("Promote memory": move confirmed team notes into the repo by PR, `plans/team-memory-design.md` §3) has no way to say
"confirmed". This draft adds usage counts with no performance cost on the run's hot path.

**Status (2026-10-24):** the collect-only part is built — `hit`, `read` and `edit` counts per note and execution in
`<worcaHome>/memory-usage/` (`src/core/memory-usage.mjs`, `src/core/memory-usage-hook.mjs`). Not built yet: the display
(§2.4), sharing (U7), scores and the promote threshold (U8), citations (U9). Codex `Bash` reads are not counted.

The design rests on a probe of Claude Code 2.1.310 (installed here; Appendix A). What the probe showed:
- `InstructionsLoaded` is a working hook event. It fires once per rule file per session, with `load_reason`
  `session_start` for unconditional rules and `path_glob_match` (+ `globs`, `trigger_file_path`) when the agent first
  touches a file the rule's `paths:` covers. A sub-agent's load carries `agent_id` and `agent_type`.
- The hook runs **asynchronously**. A hook that slept 1 s ran entirely in parallel with the next API request, so the
  agent never waited for it.
- The event **never reaches stream-json**, not even under `--include-hook-events` with a hook that echoes its stdin. The
  hook has to write a file itself.
- The CLI's session transcript also records every load (`attachment.type` `instructions` / `nested_memory`), so a
  hookless fallback exists.

## 1. Decisions

- **U1 Loaded ≠ used.** A count says how often a note was *relevant* (loaded on a trigger) or *looked up* (read on
  purpose), never that it changed an outcome. Only a citation (U9, opt-in) claims that, and the UI never words a load as
  a use.
- **U2 Signals and weights.** Each signal is counted at most once per note per **execution** (one agent session: a
  pipeline step, a fan-out child, an Ask turn), no matter how often it repeats:

  | signal | source | engines | weight |
  |---|---|---|---|
  | `session_start` / `compact` load | hook | Claude | **0**: not recorded (the note loads whatever the task is) |
  | `hit`: `path_glob_match` load | `InstructionsLoaded` hook | Claude, main agent and sub-agents | 1 |
  | `read`: a Read of a note file (rules copy or writable mount) | tool events Worca already parses | Claude (incl. Explore/Plan sub-agents), Cursor, Copilot; Codex only from a `Bash` command naming the path, best-effort | 2 |
  | `read`: Ask `read_memory` | Ask tool call | any Ask engine | 2 |
  | `edit`: a changed note at sync-back | `_syncMemoryWith` result | all | recorded and shown, **not scored** |
  | `cited` | the U9 line in the final message | Claude (opt-in) | 5 |

  `score = hit + 2·read + 5·cited` over the window (U5). An edit is not scored: it means the note was wrong or
  incomplete, and an edited team note becomes a local shadow (D2), which restarts its stability clock for U8. Weights
  are constants in one module, not settings.
- **U3 Hook scope.** The hook is registered with `matcher: "path_glob_match"` (the CLI matches it against
  `load_reason`), so the 0-weight loads start no process at all. It goes into the run's existing single `--settings`
  payload (`buildSettingsPayload`, `src/core/engines/claude.mjs`) as an `InstructionsLoaded` entry beside the host guard,
  and only when the mounted rules hold at least one note with `paths:`. A run with no path-scoped note gets a
  byte-identical argv.
- **U4 Hot path: nothing new.** During a run Worca does no new I/O. The hook is the CLI's own child process, off the
  agent's critical path (U3, Appendix A.4). Tool-event reads reuse `_trackMemoryCalls`: the same path mapping
  (`_memoryWriteKey`) extended to a read-tool set, plus a `Set.add` on the run's in-memory tally. The hook's file is read
  once, at sync-back.
- **U5 Storage: local files, no schema bump.** Counts live in `<worcaHome>/memory-usage/` (§2.3), outside the memory
  store, whose dirs are mounted into runs and diffed at sync-back. Daily buckets keep 90 days, so the windows (30 d for
  ranking, 90 d for "not loaded since") come from one file. No DB column.
- **U6 One write per sync-back.** `_syncMemoryWith` (per execution, and the run-end/resume drains) merges that
  execution's tally into the usage file: one read-modify-write under a usage lock of its own, `locks/<key>.usage.lock`,
  never the team lock (a flush holds that through a network push). The write is best-effort: a failure logs one debug
  line and drops the tally. A crash loses only that execution's counts.
- **U7 Sharing rides existing pushes.** The tally is shared only on an opted-in project (D1), and only inside a commit
  that `commitToTeamBranch` is making anyway. A count change alone never commits, fetches or pushes. Each machine writes
  one file, `.worca-memory/usage/<machineId>.json`, holding cumulative totals (not deltas). A retried push reapplies the
  same file, so nothing is counted twice, and no two machines ever write the same file. The team totals are the sum over
  the snapshot's usage files, read by `refreshTeamLayer` into `team.json`.
- **U8 Promote threshold (phase 2).** A team note is a promotion candidate when, over 30 days: `score ≥ 10`, from **≥ 2
  machines**, its content unchanged for ≥ 7 days, its state `shared` (never `blocked`/`held`), and it has `paths:` (an
  unconditional note has no hit signal, so it qualifies only through `read`/`cited`). The workflow proposes; a human
  merges the PR. Thresholds are constants, revisited after the first month of real data.
- **U9 Citations are opt-in and measured first.** The setting `memory.citeNotes` (default off) adds one line to the run
  block: *"If a Worca memory note changed your approach, end your final message with `Notes used: <name>, …`."* Worca
  parses that line from the step's final text and strips it from the result shown elsewhere. It ships only after the
  #681 benchmark shows no quality loss and the token cost below.
- **U10 Privacy: counts, never content.** Recorded per note: its scope and name, signal counts, daily buckets, and the
  last 5 trigger paths, **repo-relative**, kept **local only**. The hook keeps only `file_path`, `load_reason`,
  `trigger_file_path` and `agent_type`, and drops `cwd`, `transcript_path` and `session_id` on arrival. Nothing from a
  prompt, a tool result or a file body is ever stored. The shared file holds note names (already on the branch),
  counts, day buckets and a random machine id, never a trigger path or a git identity. Global notes are never shared
  (§2.1 of the team design).

## 2. Design

### 2.1 Capture during a run
```
mount (per execution)          rules copy has a note with paths: ⇒ settings.hooks.InstructionsLoaded =
                                 [{ matcher: 'path_glob_match', hooks: [{ type: 'command',
                                    command: "<node> <src>/core/memory-usage-hook.mjs <pipelineDir>/memory-loads/<executionId>.jsonl" }] }]
CLI (child process, async)     appends {f: rel(file_path), r: load_reason, t: rel(trigger_file_path), a: agent_type|null}
tool event (_onToolEvent)      _trackMemoryCalls: Read / Write / Edit … → _memoryWriteKey(path) → tally[exec].read.add(id)
Ask read_memory                the server sink that already sees askMemoryMutation adds a read for that note
```
The hook command copies the host guard's pattern (`hostGuardHookEntry`: `process.execPath` plus a script path, forward
slashes, works on Windows). The script relativises paths against the rules root and the run cwd before it writes. An
absolute path outside both is dropped, so no absolute home path is ever stored (D14).

### 2.2 Sync-back
```
_syncMemoryWith(exec)
  read <pipelineDir>/memory-loads/<exec>.jsonl (absent ⇒ nothing; malformed lines skipped) → tally.hit
  tally.edit ← the sync result's changed project/global notes
  tally.cited ← parsed "Notes used:" names that match a mounted note (U9 on only)
  recordMemoryUsage(key, tally)  [usage lock] read → add one per (note, signal) for today → atomic write
  drop the jsonl and the in-memory tally
```
A rules-copy path maps to the note it copies: `project/<n>.md` and `team/<n>.md` (or `team/<projectKey>/<n>.md` in a
workspace) are counted per layer, because the Team view ranks team notes and a local note that shadows a team note is a
different text.

### 2.3 Files
```
<worcaHome>/memory-usage/
  projects/<projectKey>.json   {schema:1, notes:{"<layer>:<name>":{days:{"2026-10-24":{hit,read,edit,cited}}, last:{hit,read,edit,cited}, triggers:[rel,…≤5]}}}
  global.json                  same shape, global notes
  machine-id                   random 128-bit id, created once (never derived from host, user or email)
<worcaHome>/team-memory/projects/<key>/team.json   + usage:{"<name>":{machines, days:{…}}}   (summed from the branch)
worca-memory branch: .worca-memory/usage/<machineId>.json   {schema:1, notes:{"<name>":{days:{…}}}}   (team-layer and
                     shared local notes only; 90-day buckets; written only into a commit already being made)
```
A note deleted or renamed keeps its counts for 90 days, then they age out. A rename starts from zero: the rule is
simpler than following renames.

### 2.4 Display (no new controls)
- **Memory page, note row:** one muted line under the description: "Loaded for matching files in 12 runs · read 3 times ·
  last 2 days ago" (30 d), or "Not loaded in 90 days" for a note with `paths:` that never matched. A note with no
  `paths:` shows reads and citations only, since it loads in every run anyway. No new sort control: the list keeps its
  order.
- **Team view, team note row:** "Relevant on 3 machines this month". A candidate under U8 gets a quiet "Ready to
  promote" badge, which turns into the phase-2 action when that ships. Nothing to switch on: counting starts on its own.
- **Defragment** (existing) may take "not loaded in 90 days" as a hint. Its prompt stays as it is until a later
  decision.

### 2.5 Cost of U9 (to measure with #681 before shipping)
The line is about 35 input tokens per spawn, inside the cached system prompt, so after the first turn it costs cache-read
rates (Haiku 4.5 ~$0.000003, Opus ~$0.00002 per spawn). A citation adds about 10–20 output tokens to the final message.
The risk is quality, not money: the instruction could make agents pad answers or cite notes they did not use. #681's
memory track runs the corpus with the line on and off, and checks task success, turns, cost, and how often a cited note
matches a `hit`/`read` in the same execution (a citation with neither is suspect).

## 3. Open questions

1. **Hook vs transcript.** The transcript (`~/.claude/projects/<cwd>/<session>.jsonl`, plus `subagents/agent-*.jsonl`)
   records every load as `attachment.type: "nested_memory"`, with zero processes and no settings change. But it is an
   internal format, lives under the CLI's config dir (CLAUDE_CONFIG_DIR / HOME varies per deployment and E2B sandbox),
   and carries the note's full text, which the reader would have to skip. The draft picks the documented hook, with the
   transcript as a fallback only if the hook proves fragile. Agree?
2. **Explore/Plan and rules.** Team design §2.8 says an Explore or Plan sub-agent "loads no rules". On 2.1.310 an
   Explore sub-agent got no `session_start` rules but **did** get a `path_glob_match` load (Appendix A.3). Should the
   run-block sentence change, and is this behaviour stable enough to count on?
3. **Hits for unconditional notes.** A note without `paths:` can only score through reads and citations. Should the
   promote workflow nudge authors to add `paths:`, or should U8 weigh such notes on reads alone?
4. **Codex reads.** Codex shows file reads only as shell commands. Matching a rules path inside `cat`/`sed`/`rg`
   command strings is cheap but approximate. Keep it best-effort, or leave Codex out of `read`?
5. **Machine id vs author.** U7 keeps counts anonymous per machine. Should the Team view say *who* found a note
   relevant (the git `author` already on notes), or is "on 3 machines" enough?
6. **Hook at exit.** A `path_glob_match` load fires when the next request's attachments are built, so its hook normally
   ends before the session does. The draft accepts that the last load of a session can be lost if the CLI exits first.
   It could be verified by a probe that reads a matching file as the very last tool call.

## Appendix A. Probe (2026-10-24, Claude Code 2.1.310, `claude-haiku-4-5`)

Scratch git repo: `.claude/rules/worca/project/always.md` (no `paths`), `.claude/rules/worca/project/scoped.md`
(`paths: src/billing/**`), `.claude/rules/worca/team/x.md` (`paths: src/other/**`), `src/billing/invoice.js`. The hook
came in through `--settings <file>` only (no real config touched):
`{"hooks":{"InstructionsLoaded":[{"hooks":[{"type":"command","command":"<scratch>/hook.sh"}]}]}}`, which runs
`tee -a $LOG`. Flags: `-p … --output-format stream-json --verbose --include-hook-events --setting-sources project,local
--strict-mcp-config --tools … --disable-slash-commands --permission-mode acceptEdits`. `<P>` = the scratch project.

### A.1 Events (hook stdin, `transcript_path` / `cwd` / `scratchpad_dir` trimmed)
Run 3, main agent reads then edits `src/billing/invoice.js`:
```json
{"session_id":"8e40d505-…","hook_event_name":"InstructionsLoaded","file_path":"<P>/.claude/rules/worca/project/always.md","memory_type":"Project","load_reason":"session_start"}
{"session_id":"8e40d505-…","prompt_id":"491717b1-…","hook_event_name":"InstructionsLoaded","file_path":"<P>/.claude/rules/worca/project/scoped.md","memory_type":"Project","load_reason":"path_glob_match","globs":["src/billing"],"trigger_file_path":"<P>/src/billing/invoice.js"}
```
- `path_glob_match` fires on the first Read of a matching file. The later Edit of the same file fired nothing: one load
  per rule per session.
- `globs` comes back normalised: `paths: src/billing/**` is reported as `["src/billing"]`.
- `session_start` events carry no `prompt_id`, `globs` or `trigger_file_path`. With user settings loaded (run 1),
  `~/.claude/CLAUDE.md` also came as `memory_type: "User"`, `session_start`.
- `team/x.md`, whose `paths` did not match, never loaded.
- Source fields (`kUr` in the binary): `file_path, memory_type, load_reason, globs, trigger_file_path, parent_file_path`
  plus the common `session_id, transcript_path, cwd, prompt_id, agent_id, agent_type`. Hooks are matched on
  `load_reason`.

### A.2 Stream
No `hook_started` / `hook_response` line for `InstructionsLoaded` appeared in any run, with `--include-hook-events` and a
hook that echoes its stdin to stdout. Other events' hook lines (SessionStart, PreToolUse, UserPromptSubmit) did appear in
run 1. The rule body is not in stream-json either. **Worca cannot read loads from the stream.** The session transcript
does have them:
```json
{"type":"attachment","isSidechain":false,"attachment":{"type":"nested_memory","path":"<P>/.claude/rules/worca/project/scoped.md","content":{"type":"Project","globs":["src/billing"],"content":"# Billing note…","rawContent":"---\npaths: src/billing/**\n---\n…"},"displayPath":".claude/rules/worca/project/scoped.md"}}
{"type":"attachment","attachment":{"type":"instructions","files":[{"path":"<P>/.claude/rules/worca/project/always.md","type":"Project","content":"…"}]}}
```

### A.3 Sub-agent (run 4: the main agent asks one Explore sub-agent to Read `src/billing/invoice.js` and `.claude/rules/worca/team/x.md`)
```json
{"session_id":"d0dca304-…","hook_event_name":"InstructionsLoaded","file_path":"<P>/.claude/rules/worca/project/always.md","memory_type":"Project","load_reason":"session_start"}
{"session_id":"d0dca304-…","prompt_id":"2e2b9040-…","agent_id":"acd7efd56bd20fdb9","agent_type":"Explore","hook_event_name":"InstructionsLoaded","file_path":"<P>/.claude/rules/worca/project/scoped.md","memory_type":"Project","load_reason":"path_glob_match","globs":["src/billing"],"trigger_file_path":"<P>/src/billing/invoice.js"}
```
- `agent_id` equals the stream's `task_started.task_id`, so a load can be attributed to its sub-agent. The sub-agent got
  no `session_start` load of its own.
- Signal (2) is visible: both sub-agent Reads came through stream-json as `assistant` `tool_use` blocks with
  `parent_tool_use_id` set (`is_backgrounded: false`). `claude-events.mjs` normalises them to `{type:'tool', parentId,
  calls}`, which reach `_onToolEvent` → `_trackMemoryCalls`. Reading `team/x.md` directly fired no
  `InstructionsLoaded`: a direct read is a `read` signal only.
- Other engines: Cursor (`TOOL_NAMES.read → 'Read'`) and Copilot (`view → 'Read'`, `file_path` from `path`) emit
  `Read` calls with paths. Codex emits only `Bash {command}` and `Edit` (from `file_change`).

### A.4 Latency
- A 1 s sleeping hook ran from t=458.73 to 459.79. The sub-agent's next API request left at 458.70 and answered at
  459.89 (transcript timestamps). The `session_start` hook (453.22–454.28) ran after the main request had left (453.17).
  **The hook does not block the agent.**
- Per-event process cost, outside the CLI (20 spawns, median / max): `sh` + `tee` 10.1 / 15.8 ms; a Node script
  (append one JSON line) 62.9 / 77.0 ms. Both run off the critical path and only for `path_glob_match` under U3.
- Wall time for the same task (n = 1 each, model variance dominates): with hook 13.45 s (CLI `duration_ms` 9091, 3
  turns), without 12.12 s (7729 ms, 3 turns). There is no measurable difference that can be attributed to the hook.

### A.5 Spend
| run | what | USD |
|---|---|---|
| 1 | user settings on (plugins, MCP): stopped by the $0.08 budget on the first turn | 0.0806 |
| 2 | `--setting-sources project,local`, MCP still on: stopped by budget | 0.0696 |
| 3 | lean flags, hook, read + edit | 0.0267 |
| 4 | lean, 1 s hook, Explore sub-agent | 0.0393 |
| 5 | lean, no hook (baseline) | 0.0108 |
| | **total** | **0.2270** |

### A.6 How Worca would add the hook
`buildSettingsPayload` (`src/core/engines/claude.mjs`) builds the ONE `--settings` JSON (inline, or a staged file over
`ARGV_INLINE_LIMIT`) from the telemetry `PostToolUse:Agent` hook (gated, off by default), the host-guard `PreToolUse:Bash`
hook and the guardrail `permissions`. A caller's `extraSettings` can never set `hooks` (`RUNNER_SETTINGS_KEYS`), so the
usage hook must be added inside `buildSettingsPayload`, like the host guard, from a flag the harness passes when U3
holds. `--include-hook-events` is not needed. Pipeline runs keep user setting sources. Ask, title, pinpoint and night
analysis use `--setting-sources project`, which still loads `.claude/rules`, so the same hook works there.
