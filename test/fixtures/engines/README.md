# Engine conformance fixtures

One folder per catalog entry (`src/shared/engine-switch.mjs ENGINES`), read by `test/engine-conformance.test.mjs`:
`stream.jsonl` is what `test/fixtures/fake-engine.mjs` prints for that engine, so the real adapter parses a
successful turn. Taken from the adapter tests' streams: Claude's is the stream-json shape of
`test/fixtures/ask`, Codex's `test/helpers/fake-codex.mjs codexReplyLines`, Copilot's the 1.0.100 capture
`test/fixtures/copilot/tools.jsonl`, Cursor's `test/helpers/fake-cursor.mjs cursorReplyLines`; Gemini CLI's, Qwen Code's, Goose's
and OpenCode's are their captured resumed turns (`test/fixtures/gemini/resume.jsonl`, `test/fixtures/qwen/resume.jsonl`,
`test/fixtures/goose/resumed.jsonl`, `test/fixtures/opencode/resumed.jsonl`). The rule fixtures
are under `test/fixtures/engine-rules/<engine>/`. A new engine adds both folders.
