# Gemini CLI `stream-json` captures

Captured 2026-10-08 with `@google/gemini-cli` 0.63.0 (`gemini --version`), signed in with `GEMINI_API_KEY`, under a
scratch `HOME`, in a scratch git checkout holding `a.txt` = `hello` (and `secret.txt` = `TOPSECRET` for the policy
runs). The MCP server is a 20-line stdio server with one `echo` tool that returns its text upper-cased plus the value of
its `SPIKE_TOKEN` env (set from `${SPIKE_SECRET}` in the settings file). Paths are rewritten to `/tmp/spike/...`;
session ids and timestamps are as captured.

`BASE` = `gemini --output-format stream-json --approval-mode yolo`, run with `GEMINI_CLI_TRUST_WORKSPACE=true` unless
the row says otherwise.

| file | command |
|---|---|
| `shell-write-failed-read.jsonl` | `BASE --skip-trust -p 'Do these steps in order, using tools: 1) run the shell command \`cat a.txt\`; 2) write a file b.txt containing "bye"; 3) call the MCP tool echo …; 4) read the file missing.txt …'` (no trust env: the checkout's `.gemini/settings.json` MCP server did NOT load under `--skip-trust`, so step 3 is `tool_not_registered`) |
| `mcp.jsonl` | `BASE -p 'Call the echo tool from the "spike" MCP server …'` with the server in the checkout's `.gemini/settings.json`: the tool is `mcp_spike_echo`, and `$VAR` / `${VAR}` in its env were filled from gemini's own env |
| `resume.jsonl` | `BASE --resume <session_id of mcp.jsonl> -p 'What text did the echo tool return earlier? …'`: the same `session_id` comes back in `init` |
| `policy-denied.jsonl` | `BASE --admin-policy <toml> -p '… 1) git log … 3) read secret.txt … 4) write b.txt … 5) echo … 6) fetch …'`, the TOML denying `run_shell_command` `commandPrefix = "git log"`, `read_file` on `secret\.txt`, `write_file`/`replace` on `b.txt`, `mcpName = "spike"` `echo`, and `web_fetch`: denied calls are `tool_result` `status: "error"`, `error.type: "policy_violation"`; the wholly denied tools (`mcp_spike_echo`, `web_fetch`) are not offered to the model at all |
| `policy-bypass.jsonl` | `BASE --admin-policy <toml denying only commandPrefix "git log">`: `cd . && git log` and `bash -c "git log"` are denied, `GIT_PAGER=cat git log` and `env git log` run, `cat secret.txt` runs |
| `api-key-invalid.jsonl` | `GEMINI_API_KEY=<bad> gemini -p hi -o stream-json` (exit 144): `init`, then a `result` with `status: "error"` and the API error text (`API_KEY_INVALID`) |
| `signed-out.stderr.txt` | `gemini -p hi -o stream-json` with no key and an empty home: exit 41, nothing on stdout |
| `untrusted.stderr.txt` | `BASE -p …` without trust: exit 55, nothing on stdout |
| `resume-unknown.stderr.txt` | `gemini -p hi -o stream-json --resume <unknown uuid>`: exit 42, nothing on stdout |
| `policy-error.stderr.txt` | `--admin-policy` naming a TOML whose rule has `commandPrefix` but no `toolName`: the file is reported on stderr and IGNORED, and the run goes on with no worca rule (the adapter treats this line as fatal) |

Other facts from the same spike (not files):

- A long prompt can arrive on stdin with no `-p` (300 kB tested); `-p` is appended to stdin when both are given.
- `--allowed-mcp-server-names <name>` limits the servers to the names given, user-level (`~/.gemini/settings.json`)
  and checkout ones included; a name no server has leaves none.
- `GEMINI_CLI_SYSTEM_SETTINGS_PATH` is refused unless its directory is owned by root, so worca's MCP servers go into
  the checkout's `.gemini/settings.json`.
- Workspace policies (`.gemini/policies`) are documented as disabled in 0.63; `--admin-policy` loads at the admin tier
  (5.x) and is skipped when the system policy directory already holds a `.toml` file.
- Without trust (`--skip-trust` or `GEMINI_CLI_TRUST_WORKSPACE=true`) a headless run exits 55; with `--skip-trust` the
  checkout's MCP servers stay off, so the adapter sets the env var.
- `result.stats` carries tokens per model and no cost.
