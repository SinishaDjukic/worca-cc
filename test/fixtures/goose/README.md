# goose `run --output-format stream-json` captures

Captured 2026-10-11 with `goose 1.54.0` (provider `google`, model `gemini-2.5-flash`, `GOOGLE_API_KEY` in the env,
`GOOSE_MODE=auto`), in a scratch git dir holding `a.txt` = `hello world`. Sanitised: `thoughtSignature` and
`signature` fields dropped, thinking text replaced with `(thinking)`, temp paths replaced with `/tmp/proj`.

Re-checked 2026-10-20 on `goose 1.55.0`: the shell stream (`shell-streamed-text.jsonl`'s command) has the same event and content shapes, and the max-turns text and the missing-session stderr are unchanged. Only a provider failure changed (`provider-error-auth-1.55.jsonl`).

`BASE` = `goose run -q --output-format stream-json --no-profile --with-builtin developer --provider google --model gemini-2.5-flash`

| file | command |
|---|---|
| `shell-streamed-text.jsonl` | `$BASE --name worca-probe-1 --max-turns 10 -t "Read a.txt with a shell command and tell me its contents in one line."`: a `thinking` message, a `shell` `toolRequest`, its `toolResponse` (on a `user` message), then ONE assistant text streamed as two `message` lines with the same `message.id`, and a `complete` with `cost_usd`. |
| `shell-and-write.jsonl` | `echo "Run the shell command 'cat missing.txt' (it will fail), then create the file b.txt containing exactly 'hi' using your write tool, then reply done." \| $BASE --name worca-probe-w-… --system "End every reply with the word BANANA." -i -`: the failed `cat` is a successful tool call whose `structuredContent.exit_code` is 1 (and `isError` true), then a `write`. |
| `resumed.jsonl` | `$BASE --resume --name worca-probe-1 -t "What did I ask you before? One line."`: the earlier session's context is there; the stream does not name the session. |
| `provider-error-auth.jsonl` | `GOOGLE_API_KEY=xxx $BASE --name worca-probe-auth -t hi` (exit 0): an assistant text "Ran into this error: … API key not valid …" and a `complete` with zero tokens and no `cost_usd`. |
| `provider-error-auth-1.55.jsonl` | goose **1.55.0**, `GOOGLE_API_KEY=xxx $BASE --name worca-probe-auth2 -t hi` (**exit 1**, the error also on stderr): the assistant message's content item is now `{"type":"error","message":"Ran into this error: …"}`, followed by a top-level `{"type":"error","error":"…"}`. |
| `provider-error-model.jsonl` | `$BASE --model gemini-nope-9 --name worca-probe-bad -t hi` (exit 0): the same shape, a 404 from the provider. |
| `max-turns.jsonl` | `$BASE --name worca-probe-mt --max-turns 1 -t "Run 'ls' then run 'cat a.txt' as two separate shell calls, then summarize."`: one tool call, then the text "I've reached the maximum number of actions …" and a healthy `complete`. |
| `mcp-tool.jsonl` | `echo "Call the probe_ping tool, then reply with exactly what it returned." \| PROBE_TOKEN=tok-fixture $BASE --with-extension "'<dir>/probe'" --name worca-fixture-mcp-… -i -`, where `<dir>/probe` is a wrapper script (`exec node mcp-ping.mjs`, a stdio server with one tool returning `TOKEN=$PROBE_TOKEN`): the extension is named after the script, so the tool is `probe__probe_ping`. |
| `claude-acp-terminal.jsonl` | `echo "Run the shell command 'cat a.txt', then reply with exactly what it printed." \| goose run -q --output-format stream-json --no-profile --with-builtin developer --provider claude-acp --model sonnet --name worca-probe-acp-… -i -` with `claude-agent-acp` 0.89.1 on PATH and a Claude subscription: Claude Code runs its own tool, relayed as a `Terminal` `toolRequest` with no arguments, `_meta` `goose.external_dispatch` and `goose.acp.kind: execute`; its title and output come back in the `toolResponse`. The `complete` carries no `cost_usd`. |
| `stderr-session-not-found.txt` | stderr of `$BASE --resume --name worca-nope-xyz -t hi` (exit 1, empty stdout). |
