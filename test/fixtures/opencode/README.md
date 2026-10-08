# OpenCode `--format json` fixtures

Captured from **opencode 1.18.23** (macOS arm64) on 2026-10-08, with an isolated `HOME`/`XDG_*` so no real session
was touched, and sanitized: the spike's scratch paths read `/tmp/oc-spike`. Most runs used the free model
`opencode/big-pickle`, so every `cost` is 0.

Command shape: `opencode run --format json [--auto] -m opencode/big-pickle "<prompt>" </dev/null` from a scratch git
repo (stdin closed: with stdin open and not a TTY, `run` waits for it).

| file | what it is |
|---|---|
| `shell-and-write.jsonl` | a shell command, a file write, then the reply `DONE`: `step_start`, `tool_use` (`bash`, `write`), `step_finish` with `tokens` and `cost`, `text` |
| `mcp-and-failed-read.jsonl` | an MCP tool (`spike_magic_number`, server `spike` from an `opencode.json`) and a `read` of a missing file (`state.status: "error"`) |
| `permission-denied.jsonl` | calls refused by `OPENCODE_PERMISSION` rules (`curl *`, `git push*`, `*.env`), and a shell `cat .env` the read rule does not stop |
| `task-subagent.jsonl` | `bash` calls refused by inline-config rules (a command pattern, `external_directory`) and a `task` sub-agent; its `metadata.sessionId` names the sub-session |
| `resumed.jsonl` | `-s <session>` on the session of `shell-and-write.jsonl`: the same `sessionID` |
| `export-subsession.json` | `opencode export <sub-session id>`: the sub-agent's messages with their `cost` and `tokens` (absent from the parent stream) |
| `error-auth.jsonl` | a provider with no key: `error` named `ProviderAuthError` |
| `error-unknown.jsonl` | an unknown model: `error` named `UnknownError`; the cause is only in the error log (`stderr-model-not-found.txt`, from `--print-logs --log-level ERROR`) |
| `error-free-tier.jsonl` | a Zen free model refusing a request whose tool list lacks the shell (`bash` denied outright): `APIError`, `statusCode` 403 |
| `stderr-session-not-found.txt` | `-s` with an unknown session id: plain stderr, exit 1, no JSON |
