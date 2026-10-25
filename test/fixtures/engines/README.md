# Engine conformance fixtures

One folder per catalog entry (`src/shared/engine-switch.mjs ENGINES`), read by `test/engine-conformance.test.mjs`:
`stream.jsonl` is what `test/fixtures/fake-engine.mjs` prints for that engine, so the real adapter parses a
successful turn. Taken from the adapter tests' streams: Claude's is the stream-json shape of
`test/fixtures/ask`, Codex's `test/helpers/fake-codex.mjs codexReplyLines`, Copilot's the 1.0.100 capture
`test/fixtures/copilot/tools.jsonl`, Cursor's `test/helpers/fake-cursor.mjs cursorReplyLines`; Gemini CLI's, Qwen Code's, Goose's
and OpenCode's are their captured resumed turns (`test/fixtures/gemini/resume.jsonl`, `test/fixtures/qwen/resume.jsonl`,
`test/fixtures/goose/resumed.jsonl`, `test/fixtures/opencode/resumed.jsonl`). The rule fixtures
are under `test/fixtures/engine-rules/<engine>/`. A new engine adds both folders.

The ledger row (C-LEDGER) also reads `turncap.jsonl` (a turn that hits a one-tool-call cap: Claude's own
`error_max_turns` result, two codex `command_execution` pairs after its `turn.completed`, Copilot's capture up to its
second tool call, two Cursor `tool_call` pairs) and `spend-error.jsonl` (a failed turn that still spent: Claude's and
Cursor's `is_error` result with usage, codex's `turn.completed` then an error, a Copilot `session.error`). Cursor's
`stream.jsonl` result carries `usage` (10 in / 2 out) so its tokens can be booked. `fake-engine.mjs` knobs for these
rows: `FAKE_FILES`, `FAKE_CALL` (+ `FAKE_CALL_MODEL`) and `FAKE_HOLD_AFTER` (see its header).

Claude's `background-agent.jsonl` is `test/fixtures/hooks/subagent-background.jsonl` as captured: a turn that launches a
background sub-agent, its `result`, then the agent's notification turn (a second `init` and `result`). With
`FAKE_PAUSE` the fake goes quiet between the two, as Claude Code does while the agent works (R15).
