# Qwen Code `stream-json` captures

Captured 2026-10-08 with `@qwen-code/qwen-code` 0.25.0 (`qwen --version`), under a scratch `HOME`, in a scratch git
checkout holding `a.txt` = `hello` (and `secret.txt` = `TOPSECRET` for the rule runs). No Qwen account was used: every
run signs in with `--auth-type gemini -m gemini-3.8-flash` and `GEMINI_API_KEY`, so the stream is Qwen Code's own and
the model is Google's. The MCP server is the same stdio `echo` server as in `../gemini/README.md`. Paths are rewritten
to `/tmp/spike/...`; session ids and timestamps are as captured.

`BASE` = `qwen -o stream-json --approval-mode yolo --auth-type gemini -m gemini-3.8-flash`. The prompt is the positional
argument.

| file | command |
|---|---|
| `shell-write-mcp-failed-read.jsonl` | `BASE '… 1) run the shell command \`cat a.txt\`; 2) write a file b.txt …; 3) call the MCP tool echo …; 4) read the file missing.txt …'` with the server in the checkout's `.qwen/settings.json`. Claude-shaped frames (`system`/`init`, `assistant`, `user` tool results, `result`) plus a `stream_event` `goal_state`. The MCP tool is called through the `tool_search` + `tool_call` meta tools (`tool_call` input `{name: "mcp__spike__echo", arguments}`) |
| `denied.jsonl` | `BASE --mcp-config <json> --exclude-tools 'Bash(git log:*)' 'Read(./secret.txt)' 'Edit(./b.txt)' mcp__spike__echo WebFetch '…'`: Claude-syntax rules are held (`is_error` results naming the rule); `env git log` runs; the `Read` rule also stops `cat secret.txt` in the shell |
| `mcp-denied.jsonl` | `BASE --mcp-config <json> --exclude-tools mcp__spike__echo '…'`: the call is refused and listed in `result.permission_denials` |
| `system-settings-mcp.jsonl` | `QWEN_CODE_SYSTEM_SETTINGS_PATH=<json> BASE '…'`, the file holding `mcpServers` (env `${SPIKE_SECRET}`) and `permissions.deny: ["Bash(git log:*)"]`: the server connects, `${VAR}` is filled, the rule holds |
| `resume.jsonl` | `BASE --resume <session id> '…'`: the same `session_id` in `init` |
| `signed-out.jsonl` | `qwen hi -o stream-json` with no auth type selected (exit 1): one `result` `error_during_execution` |
| `api-key-invalid.jsonl` | `GEMINI_API_KEY=<bad> BASE hi` (exit 1): the API error as assistant text, then `result` `error_during_execution` with `error.message` |
| `resume-unknown.stderr.txt` | `BASE --resume <unknown uuid> hi`: exit 1, nothing on stdout |

Other facts from the same spike (not files):

- `--mcp-config <file>` does NOT fill `${VAR}` in a server's env (the server saw the literal text); the settings files
  (system, user, project) do.
- `QWEN_CODE_SYSTEM_SETTINGS_PATH` is honoured for any owner (no root check), so worca's servers and rules need no file
  in the checkout.
- `--append-system-prompt` reaches the model.
- `--max-session-turns 2` did not stop four tool calls (they ran in two turns), so it is not a tool-call cap.
- `--allowed-mcp-server-names <name>` limits the servers like Gemini's flag.
- A long prompt can arrive on stdin with no positional prompt (300 kB tested).
- Auth: `security.auth.selectedType` in the settings, `--auth-type`, or env alone when it names a whole set
  (`getAuthTypeFromEnv`: `OPENAI_API_KEY` + `OPENAI_MODEL`/`QWEN_MODEL` + `OPENAI_BASE_URL`, `GEMINI_API_KEY` +
  `GEMINI_MODEL`, …). `GEMINI_API_KEY` or `OPENAI_API_KEY` alone is "No auth type is selected".
- `result` carries `usage` tokens and no cost.
