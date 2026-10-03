# codex `exec --json` captures

Captured 2026-09-26 with `codex-cli 0.146.0-alpha.9.2` (ChatGPT sign-in), then run
through the same sanitiser as `test/fixtures/ask` (`createSanitizer` in
`tools/ask-capture-fixtures.mjs`: paths, uuids, timestamps).

| file | command |
|---|---|
| `exec-command.jsonl` | `codex exec --json --skip-git-repo-check --sandbox workspace-write -c model_reasoning_effort=low -c 'developer_instructions="You are terse."' "Run the shell command: cat a.txt — then reply with exactly the word it printed."` in a dir holding `a.txt` = `hello` |
| `exec-resume.jsonl` | `echo "Reply with exactly: again" \| codex exec resume <thread_id> --json --skip-git-repo-check -c 'sandbox_mode="workspace-write"' -c model_reasoning_effort=low -` on the thread above. `turn.completed.usage` is CUMULATIVE for the thread (35101 then 56809 input tokens). |
| `turn-failed.jsonl` | `echo x \| codex exec --json --skip-git-repo-check -m no-such-model-xyz -` (exit 1): non-fatal `error` items, then a top-level `error` and `turn.failed`. |
| `signed-out.jsonl` | `echo hi \| CODEX_HOME=<empty dir> codex exec --json --skip-git-repo-check -c 'model_reasoning_effort="max"' -` (exit 1), captured 2026-09-30: codex's stream retries arrive as top-level `error` events (`Reconnecting... N/5 (…)`), then the final `error` and `turn.failed` (401). `cf-ray` and request ids zeroed. |

Ask-on-Codex spike captures (`ask-spike/`), 2026-10-03, `codex-cli 0.146.0-alpha.9.2`, run from a scratch git dir
holding `a.txt` = `hello`, `red.png`, `blue.png`. `BASE` = `--json --skip-git-repo-check --ignore-user-config --sandbox read-only`;
`L` = the lockdown list and `M` = the `mcp_servers.spike.*` overrides, both as recorded in `plans/ask-on-codex-spike.md`.

| file | command |
|---|---|
| `ask-spike/a2-shell-baseline.jsonl` | `echo 'Run the shell command: cat a.txt — then reply with exactly what it printed.' \| codex exec $BASE -` |
| `ask-spike/a1-lockdown.jsonl` | `echo 'Run the shell command: cat a.txt. If you have no way to run commands, say NO_SHELL. Then list every tool name you can call, …' \| codex exec $BASE $L -` |
| `ask-spike/a1-tool-probe.jsonl` | `codex exec $BASE $L -` asked to use `functions.exec`, `view_image`, `apply_patch` and a sub-agent: `view_image` and sub-agents work under the lockdown |
| `ask-spike/a1-view-image-probe.jsonl` | `codex exec $BASE $L -c agents.max_depth=0 -` asked to `view_image` a PNG outside the cwd: it succeeds |
| `ask-spike/a3-unknown-feature.jsonl` | `echo hi \| codex exec $BASE --disable no_such_feature_xyz -` (exit 1, empty stdout; stderr `Error: Unknown feature flag: no_such_feature_xyz`) |
| `ask-spike/b-network-readonly.jsonl` | `codex exec $BASE -` asked to `curl https://example.com`: `Could not resolve host`, exit_code 6 |
| `ask-spike/b-websearch-off.jsonl` | `echo 'Search the web for the current price of gold …' \| codex exec $BASE $L -`: no `web_search` item |
| `ask-spike/c-mcp.jsonl` | `echo 'Call the spike echo tool …, then the spike env tool, then the spike fail tool …' \| SPIKE_KEY=key-ok codex exec $BASE $L $M -` |
| `ask-spike/e-stream.jsonl` | `echo 'Write about 300 words on how rivers form. No tools.' \| codex exec $BASE $L -`: no `item.updated`, usage only on `turn.completed` |
| `ask-spike/f-image.jsonl` | `echo 'What colour is the attached image? One word.' \| codex exec -i red.png $BASE $L -` |
| `ask-spike/f-image-resume.jsonl` | `echo 'And the colour of this one? One word.' \| codex exec resume <thread> -i blue.png --json --skip-git-repo-check --ignore-user-config -c 'sandbox_mode="read-only"' $L -` |
| `ask-spike/f-image-last.jsonl` | `codex exec $BASE $L -i red.png -` (image just before the `-` prompt): works |
| `ask-spike/g-resume-unknown.txt` | `echo hi \| codex exec resume 00000000-0000-4000-8000-00000000dead --json --skip-git-repo-check --ignore-user-config -c 'sandbox_mode="read-only"' -` (exit 1) |
