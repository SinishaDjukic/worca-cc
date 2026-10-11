# Cursor CLI `stream-json` fixtures

**Hand-written, not captured.** No Cursor CLI (`cursor-agent`) was available when the Cursor adapter
(`src/core/engines/cursor.mjs`) was written, so these files follow Cursor's documented
`cursor-agent -p --output-format stream-json` shape. Replace each one with a sanitized capture (paths, uuids,
timestamps) once a real `cursor-agent` is available, and record the CLI version and the exact command here, as
`test/fixtures/codex/README.md` does.

| file | what it stands for |
|---|---|
| `shell-and-write.jsonl` | a run that runs `cat a.txt` in the shell, then writes `b.txt`: `system`/`init`, a `user` echo, two `assistant` text messages, `tool_call` `started`/`completed` pairs (`shellToolCall`, `writeToolCall`), and a successful `result` with no usage and no cost |
| `mcp-and-failed-read.jsonl` | an MCP call (`mcpToolCall`), a read a deny rule rejected (`rejected`), a `function` tool, and a `result` carrying `usage` |
| `error-result.jsonl` | a run that ends in an `is_error` `result` (a usage limit) |

Things to check against a capture:

- the event and field names above (`tool_call`, `call_id`, `<kind>ToolCall`, `args`, `result.success` /
  `result.rejected`), and whether `result` ever carries `usage` or a cost;
- the order of `system`/`init` and the error when `--resume <chatId>` names a chat Cursor no longer knows
  (`CURSOR_RESUME_NOT_FOUND_RE`; the adapter retries fresh only when no session event came first);
- the wording of `cursor-agent status` signed in and signed out (`parseCursorStatus`).
