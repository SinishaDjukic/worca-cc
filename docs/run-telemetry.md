# Run telemetry

**Labs, off by default.** Flag `runTelemetry` (Settings › Labs, or `worca flags on runTelemetry`).

Run telemetry records detailed statistics about each run, so that decisions about Worca's own
design (context limits, how state is saved, how live updates are sent) can rest on real numbers.
It only records. A run with telemetry on does exactly what it would do with it off.

## What a run records

The flag is read once, when the run's folder is first written. A run that starts with the flag
off records nothing, even if you turn the flag on halfway through. A run that starts with it on
keeps recording until it ends.

Records go to `telemetry.ndjson` in the run's folder, one JSON object per line. Nothing is written
to the database. Deleting the run deletes the file.

| Record | When | What it holds |
|---|---|---|
| `run` | Recording starts | Format version |
| `step` | A step starts, ends, pauses or fails | Step key, node, status |
| `session` | An agent's CLI names its session or model | Session id, model |
| `call` | Every model call | Input, cache read and cache write tokens, and `out`, the output tokens the engine reported when the message began (on Claude Code a placeholder of a few tokens, far below the final count: use the `result` record's `out` for the real one); context (input + cache read + cache write); the model; the tools the call asked for; time since the previous call or tool result (`gapMs`, model wait, approximately); main agent or which sub-agent |
| `tool` | A tool call returns | Tool name, run time, error or not |
| `retry` | The CLI retries an API call | Attempt, HTTP status, reason, delay |
| `compact` | The CLI compacts the conversation | Trigger, tokens before |
| `agent` | A sub-agent spawns or finishes | Type, model, tokens, duration |
| `result` | A session ends | The session's usage and cost as the engine reports it |
| `harness` | Every 10 seconds with activity | State saves (count, total and max time, step rows written), live `state` updates (count, total and max size), event loop delay (p50, p99, max) |
| `end` | The run ends | Size of the database, the telemetry file (before its last lines) and the run log |

A call's output tokens are what the stream reports when the message starts. In Claude Code that
number is a placeholder: real output totals come only from `result`. A step's output figure uses
the results; when no result arrived (a killed spawn) it falls back to the calls' placeholders and
is marked `outputFrom: "calls"`, a lower bound.

Prompts, answers, tool inputs and tool output are never recorded: only names, counts, sizes and times.

## Engines

| Engine | Per-call usage |
|---|---|
| Claude Code, Qwen Code | Yes, main agent and sub-agents |
| OpenCode | Yes, main agent; sub-agents only as a total after the run |
| Codex, Copilot, Cursor, Gemini CLI, Goose | No. One `result` per session (Goose's end-of-session usage is a session total and is not counted as a call). For Codex and Copilot it can include earlier turns of the same thread, so it can be larger than the real context. |

Calls through Worca's model bridge are recorded like any other Claude Code call. The bridge
always reports zero cache-write tokens, and nothing here records the bridge's own timings.

## On the run page

With the flag on, each card on the run page's **Agents** tab shows:

- **Context peak**: the largest prompt one call sent, against the model's context window and as a
  share of it. Amber from 75% of the point where Claude Code compacts, red from 90%. An engine
  without per-call usage shows **context at end** instead.
- Calls, sessions (when more than one), how the step's time split (start-up, model, tools), the
  share of prompt tokens read from cache, tool errors, retries, compactions and sub-agent calls.
- A chart of context over time: the context of each call, the model's window (dashed), where
  compaction starts (dotted) and any compaction (a vertical line). Long steps are cut to 200 points,
  keeping the largest value in each stretch.

A line above the cards shows Worca's own figures for the run: saves, live updates and event loop delay.

The context window comes from the model catalog (Models page), or 1M for Claude models that have
one, else 200k. A 200k window that is only assumed says so on hover.

`GET /api/runs/:id/telemetry` answers the same figures as JSON, and 404 while the flag is off or
when the run recorded no telemetry.

## Cost of recording

Each call is one short line, about 200 bytes, written in batches once a second. A run with 2,000
calls writes about 400 KB. Measuring a live update serialises it once more. Recording never makes
a run fail: any error inside it is dropped.
