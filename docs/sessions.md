# Sessions: several steps in one harness session

**Labs, off by default.** Flag `sessionGroups` (Settings › Labs, title **One session**, or `worca flags on sessionGroups`).

A **session** lets 2–4 consecutive agent steps of a workflow run inside one harness session instead of one session
each. On an engine that supports it, the session's **main agent** hands each step to a **sub-agent**, one step at a
time, in the order Worca decides. Every step keeps its own prompt, model, effort, tools, verdict, questions, retries
and cost, exactly as it would on its own.

**Sub-agents on Claude are not on yet.** Claude Code sessions run their steps as sub-agents only after the owner has
run the Phase 0 spikes against the real CLI and the S7b go/no-go (the reference pipeline run with and without a
session, compared for quality) has passed. Until the owner flips that gate, every Sub-agents session on Claude runs as
separate sessions, and the run says so (One conversation needs no sub-agents). The mock engine (`--mock`, the Mock switch) runs sessions as sub-agents today, with the
flag on.

## What a session is

- In the Composer, select an agent card and press ⌘G: when exactly one next step can join, it joins it into one
  session; otherwise (none, or more than one) ⌘G opens the menu. The agent toolbar's **One session** menu lists the neighbours it can run in one
  session with; a session's inspector adds the next step, up to four. The cards get a tray behind them. **Ungroup**
  (⇧⌘G, the session toolbar or the inspector), or Delete on the tray, turns them back into separate steps. The
  session's settings sit in the inspector: its name, its mode, and the main agent's model and effort.
- The workflow stores it on the cards (`config.session`, an id like `s_k3f9a2b1`) and in `template.sessions[sid]`
  (`label`, `mode`, `hostModel`, `hostEffort`). Every other setting stays on the cards.
- The word is "session": a run's harness sessions, one per step, become one per session.

## How it runs

Each session runs in one of three ways. Worca picks it once, when the run starts, and never refuses a run because of a
session.

| Mode | What happens | When |
|---|---|---|
| Sub-agents (`subagents`, the default) | One harness session hosts the steps. For each step, Worca sends one turn (`--resume`) that tells the main agent to dispatch exactly one sub-agent; the sub-agent gets the step's own system prompt and brief, byte for byte, its model, effort and tools. The main agent does no work itself. | The engine has sub-agents, its gate is open, the Labs flag is on, and (on Claude) the CLI is at least 2.1.281 and supports `--forward-subagent-text` |
| One conversation (`shared`) | The steps run as consecutive turns of one conversation (`--resume`), so each step sees what the steps before it said and did. There is no main agent: each turn is the step itself, with its own model, effort and tools, its role and task in the turn's message. A reviewer then reads the implementer's reasoning, so its review is not independent (the inspector warns). The conversation never rotates. | Chosen per session in its settings (How it runs › One conversation). It needs only the Labs flag: every engine can resume a session |
| Separate sessions | Every step starts its own harness session, exactly as without a session. The tray is drawn dashed and says why. | Anything else: the flag is off, the engine has no sub-agents, the gate is closed, the CLI is too old, the steps use different model endpoints, or the kill switch is set |

A step's ×N task slices always run outside the session, one harness session each, and so does a role review. A session
that keeps a sub-agent dispatch from happening is switched to separate sessions for the rest of the run (see
Troubleshooting). Worca promises nothing about the harness beyond this: the steps behave as they would on their own.

## Engines

| Engine | On default settings | Notes |
|---|---|---|
| Claude Code | Separate sessions until the owner opens the gate (the spikes and S7b) | Per-step model, effort and tools in each sub-agent's definition; cost from `total_cost_usd` |
| Codex | Separate sessions until its spikes (S10) pass | No live stream of a sub-agent's work |
| Copilot CLI | Separate sessions until S10 passes | Reports no cost: tokens only, cost blank |
| OpenCode | Separate sessions until S10 passes | A sub-agent's steps only after the turn |
| Cursor, Gemini CLI, Goose, Qwen Code | Separate sessions | No sub-agents |

With the Labs flag on, a session set to One conversation runs as one conversation on every engine in this table.

## Turning it on

- **The Labs flag `sessionGroups`.** Off (the default), the Composer still draws a saved session as a dashed tray that
  says "separate sessions", the controls that create one are hidden, and every run runs its sessions as separate
  sessions. The flag is read when a run starts.
- **The kill switch `WORCA_SESSIONS_DISABLE=1`.** Set in the Worca server's environment, it is a hard bypass: no
  session host is created, no trace is written, no event names a session, and the run's state looks like a run without
  sessions. The run's audit trail gets one line: `Sessions disabled by WORCA_SESSIONS_DISABLE=1: every session runs as
  separate sessions.`
- **The sub-agents gate** (`SESSION_SUBAGENTS_VERIFIED`, per engine). It opens for Claude only after the owner's Phase 0
  spikes pass — in particular S3 (the run's deny rules and the host guard reach the sub-agents, on both measured CLI
  versions) — and the S7b go/no-go passes (the reference pipeline, run with and without a session, keeps its quality).
  Codex, Copilot and OpenCode follow after their own spike (S10).
- The run-start notice under the Engine dropdown on New pipeline says, per session, how it will run: `2 steps share
  one session (Refine Plan + Decompose).`, or the reason it runs as separate sessions.

## Limits

- 2 to 4 steps (`MAX_SESSION_MEMBERS = 4`), all agent cards, consecutive: no other card runs between two of them. The
  validator names the rule a selection breaks.
- ×N task slices and role reviews run outside the session (one harness session each); the run-start notice names the
  step whose tasks or reviews do.
- One conversation has no main agent, so the three limits below are the sub-agents mode's only: each of its turns is
  the step's own spawn with the step's own flags, and the conversation never rotates.
- Every host turn runs with `--max-turns 4` and, when the run has a cost cap, `--max-budget-usd` set to what is left of
  it (left off when the step runs on the CLI's default model, or a model of the turn has a cost override or a custom
  endpoint: the CLI meters at list price, Worca's books would not). A turn stopped there checks the run's cap: a reached cap pauses
  the run with the cost-cap reason, as a step would. Between steps, Worca's own cost gate runs before every dispatch, as
  it does before every step.
- In each turn the main agent holds the Agent tool and the tool grants of the step it dispatches (over a run, the
  union of its steps' grants, as the run log says). Its own tool calls are stopped after the fact by the watchdog, not
  refused before they run, unless the host-only guard hook is on (it needs a spike result that tells a sub-agent's
  call from the main agent's).
- The host rotates to a fresh harness session after 24 dispatches, once a turn's last host message held 120000
  context tokens, or when the harness refuses another sub-agent. Steps never notice: each brief is self-contained.

## Auto workflows

A session is not topology: `TOPOLOGY_CONFIG` (`src/shared/graph/isomorphic.mjs`) does not list `session`, so when an
Auto run matches a saved template that has sessions, the template is reused and its sessions run as written.

## What you see

A session in One conversation has no main agent and no hand-offs, so none of the places below names either for it; its
Sessions card names the conversation's id.

- **The run monitor's tray.** A header over the session's cards: its status, engine and mode, the step running now, and
  at Expert `turn N · time · cost`. Its tooltip tells the whole story, including `incl. $x hand-offs` and any restart.
  A click on the header opens the step log drawer filtered to the session.
- **The Sessions tab** (run page, Advanced and up, only on a run with a session): one card per session with its main
  agent, host session id, a cost bar per step plus the hand-offs, every turn (step, attempt, time, tokens, cost, cost
  source, verdict, links to the step's log and sub-agent) and whether the figures reconcile; then an "Outside sessions"
  card for the steps that started their own harness session, with the reason.
- **The step drawer.** A step that ran inside a session says so under the drawer's head: `Inside session ‹label› · turn
  7 · dispatch d:x:n_review:2:a1`, with its sub-agent id and a copy button. The same line is the tooltip of its row in
  the card's run list.
- **The log.** The main agent's own lines have the source `session`. The **Showing one session** chip on the Logs tab
  keeps one session's lines: the main agent's and its steps'. Click it to clear it.
- **The cost breakdown.** A **Session hand-offs** line: the main agent's own share, already inside the steps' costs. A
  step's cost tooltip says `incl. $0.02 session hand-off`.
- **The CLI.** `worca sessions <run>` prints each session, its turns and its cost split; `--json` prints the same report
  as `GET /api/runs/<id>/sessions`. A run started from the CLI prints a line for each session transition that matters
  (open, a switch to separate sessions, dispatch, rotate, restart, resume, a failed dispatch, close) next to its step
  lines.
- **Run telemetry** (its own Labs flag, [run-telemetry.md](run-telemetry.md)): one `host` record per booked host turn. A
  turn cut by a pause or a crash and booked after the resume gets none, and so does every turn of One conversation (it
  has no main agent). It never replaces the trace.

## The session trace

Every session writes `<run folder>/sessions/<sid>/trace.ndjson` (`sessions/<sid>/trace.ndjson` under the run's
pipeline folder): append-only, one JSON object per line, always on, whatever the Run telemetry flag says. The Sessions
tab, the CLI and the API read it; the run's state holds a summary that the same code rebuilds from the file.
`GET /api/runs/<id>/sessions/<sid>/trace` serves the raw file.

It holds ids, names, counts, tokens, costs and times only: never a prompt, a brief, a report, a tool input or a tool
output (the privacy rule of [run-telemetry.md](run-telemetry.md)). A sub-agent's definition file lives only in the
turn's private staging folder and is deleted after the turn.

Every record carries `v` (the schema version, `v: 1`), `ts`, `seq` (counts up by one per file), `kind`, `runId`, `sid`,
`hostEpoch` (the host session's number inside the session: a rotation or restart starts the next) and `hostSessionId`.

| Record | Written when | Its own fields |
|---|---|---|
| `open` | The session opens at run start | `engine`, `mode`, `transport`, `hostModel`, `hostEffort`, `members`, `label` |
| `mode` | The mode is chosen | `mode`, `requested`, `reason`, `engine`, `transport` |
| `degrade` | The session runs as separate sessions from here on | `from`, `to`, `reason` |
| `turn_start` | A host turn starts | `turnId`, `resume`, `maxTurns`, `maxBudgetUsd`, `hostModel`, `hostEffort` |
| `dispatch` | The turn names the step to dispatch | `turnId`, `dispatchId`, `executionId`, `nodeId`, `attempt`, `agentType`, `cold`, `queueMs` |
| `member_bound` | The main agent's Agent call is seen | `turnId`, `dispatchId`, `memberAgentId` |
| `member_done` | The sub-agent returns | `turnId`, `dispatchId`, `memberAgentId`, `memberTranscriptId`, `tokens`, `resolvedModel`, `durationMs`, `isError`, `errorClass` |
| `turn_end` | The host process ends | `turnId`, `cumulativeUsd`, `deltaUsd`, `hostUsage`, `hostModel`, `numTurns`, `durationMs`, `exit`, `subtype` |
| `cost` | The turn is booked | `turnId`, `dispatchId`, `executionId`, `nodeId`, `memberUsd`, `hostOverheadUsd`, `costSource`, `hostPriced`, `overridden`, `carriedBy`, `cut` |
| `reconcile` | The turn's figures are checked | `turnId`, `dispatchId`, `ok`, `checks` |
| `watchdog` | The main agent did not dispatch as told, or a warning | `turnId`, `dispatchId`, `code`, `level`, `detail` |
| `rotate` | A fresh host session takes over | `reason`, `fromSessionId`, `fromEpoch`, `dispatches`, `contextTokens`, `epochCheck` |
| `restart` | A lost or switched host starts fresh | `reason`, `fromSessionId`, `engine`, `transport`, `epochCheck` |
| `resume` | A paused or interrupted run resumes the session | `after` |
| `pause` | The run pauses (inside a turn: with that turn's ids and its cut tokens) | `turnId`, `dispatchId`, `reason`, `cutTokens` |
| `verdict` | The step's verdict is read (counts only) | `dispatchId`, `executionId`, `nodeId`, `verdict`, `issues` |
| `close` | The run ends | `status`, `costUsd`, `memberUsd`, `hostOverheadUsd`, `turns`, `dispatches`, `rotations`, `restarts`, `wallMs`, `activeMs`, `tokens`, `reconciled`, `epochChecks` |

Ids nest like spans: the session `s_…`, a turn `t:<sid>:<n>`, a dispatch `d:<executionId>:a<attempt>`, the sub-agent's
`memberAgentId` (the main agent's Agent call) and `memberTranscriptId` (the sub-agent's own transcript). A step's row
carries the same ids in `step.session`.

## Cost

Each turn's cost is the change in the harness's own running total for the host session (Δ). It is split into the
step's share and the main agent's own overhead, the **hand-off**: the main agent's tokens that turn, priced at its
model. Both are booked on the step's row, the hand-off as the `Session hand-offs` part, so the steps add up to the
session and the sessions to the run.

| Source (`costSource`) | Where the figure comes from |
|---|---|
| `harness` | The harness's own figure: Δ of the running total it reports (Claude Code, Goose), or, in One conversation on Codex and OpenCode, the turn's own cost |
| `bridge` | The cost Worca's model bridge reported for the turn |
| `hook` | The sub-agent's own cost from the sub-agent hooks |
| `estimate` | A cut turn's tokens priced at their models, when no later turn of the same host session can carry its spend; in One conversation also a turn whose result came without its figure on Codex or OpenCode |
| `none` | An engine without cost (Copilot): blank, never $0.00 |

- **A cut turn.** A process killed after the sub-agent spent money but before its result: the next turn of the same
  host restores the running total, and its Δ carries that spend. The carried part is booked on the cut step's row as
  its own `cost` record with `carriedBy` (the turn that carried it); the rest is the current step's. When no later turn
  of that host session can carry it (a rotation, a restart, an engine switch, the session's close), the cut turn is
  booked at once as an `estimate`, its `cost` record marked `cut`.
- **One conversation.** No main agent, so no hand-off: all of a turn's cost is its step's (`hostOverheadUsd` is 0 and
  there is no **Session hand-offs** line). On Claude Code and Goose it is the Δ of the conversation's running total; on
  Codex and OpenCode, whose result is the turn's own cost, that figure. A cost override on the step's model prices the
  turn from its own usage, as it prices the step without a session (on Goose, whose usage is the session's sum, a
  per-Mtok price cannot be applied, and the run log says so). A cut turn, or a result without its figure, that its usage
  cannot price books nothing: the row stays blank, never $0.00. A step on a bridged model is booked at what its upstream
  reported, a stopped turn too, and a result of a turn that never ran (a refusal before the CLI starts, the answer to a
  lost conversation) books nothing. With no hook, and a step usage that leaves out what its
  investigators spent, its turns are checked only per conversation: the bookings against the running total.
- **Checks.** After every turn: the hook figure against the booked step cost within `max($0.001, 2%)`, and the step's
  own token estimate within `max($0.01, 15%)`. Per host session (on rotate, restart and close): the bookings against
  the harness's own total within `max($0.001, 2%)`. A mismatch is shown and audited once; it never changes a booking.

## Failure and resume

| Event | What happens |
|---|---|
| The sub-agent fails | The step fails as it would on its own, with the same error class: retried (on the same host, with the next attempt) or paused by the same recovery rules |
| The host process fails (a limit, the network) | Classified like a step's own failure: retried, or the run pauses |
| Pause or stop | The host process is killed with its sub-agent; the step's row is paused (or stopped); its harness session is the host's |
| Resume after a pause or a usage limit | The host is restored from the run's resume point; the step is dispatched again, told that an earlier attempt was interrupted |
| Crash (the run reads Interrupted) | The host is restored; if its harness session is gone, a new one starts (`restart`) |
| The host's harness session is gone | A new host session, a `restart` record and an audit line |
| Resumed on another engine | A new host on that engine; the mode is chosen again |
| A step asks questions | The step writes its questions and stops; Worca asks; the step is dispatched again with the answers |

## Troubleshooting

Watchdog codes (the step fails with the `session_host` error class and is retried, up to 3 times by default):

| Code | Cause | What to do |
|---|---|---|
| `SESSION_HOST_NO_DISPATCH` | The main agent did not dispatch the step: no Agent call, the wrong sub-agent type, a model or background override, or it answered from an earlier turn | Nothing; the retry dispatches again. If it repeats, the session switches to separate sessions |
| `SESSION_HOST_MULTI_DISPATCH` | It dispatched the step more than once in one turn | As above |
| `SESSION_HOST_STRAY_TOOL` | It called a tool itself | As above; check the step's tool grants |
| `SESSION_HOST_VANISHED` | The resumed host session was not found | One fresh restart per dispatch, automatic |
| `SESSION_HOST_CAP` | The harness refused another sub-agent in this session | The host rotates and retries, automatic |
| `SESSION_HOST_BUDGET` | The turn reached `--max-budget-usd` while the run's own cap was not reached | Retried like the others. A run whose cap was reached pauses with the cost-cap reason instead: raise the cap, then resume |

- **The main agent did not dispatch, again and again.** After `HOST_DEGRADE_AFTER` consecutive watchdog failures in one
  session (the recovery attempts, 3 by default, `WORCA_RECOVERY_MAX_ATTEMPTS`), the session runs as separate sessions
  for the rest of the run: a `degrade` record with the reason `the main agent did not dispatch`, and an audit line.
- **Warnings** (a `watchdog` record with `level: warn`; the step is kept): `model-mismatch` (the sub-agent ran on
  another model than its definition names), `member-self-dispatch` (the step's sub-agent tried to dispatch a step),
  `member-cap-refused` (the harness refused one of the step's own research sub-agents), and a violation after the step
  had already returned (`detail.afterDone`).
- **The trace's integrity.** The Sessions tab and `worca sessions` count the lines they could not read (`torn`,
  `invalid`) and the gaps in `seq` (`seqGaps`). A torn last line comes from a crash mid-write; the rest of the file still
  reads.
- **Sessions do not start.** The run log's first lines say, per session, how it runs and why (`session s_…: separate
  sessions — <reason>`). Check the Labs flag, the engine, the Claude Code version (at least 2.1.281) and the kill
  switch.
