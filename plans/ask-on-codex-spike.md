# Ask on Codex — spike record (Plan 2b, Task 0)

- Date: 2026-10-03
- `codex --version`: `codex-cli 0.146.0-alpha.9.2` (`/Applications/ChatGPT.app/Contents/Resources/codex`)
- `codex login status`: `Logged in using ChatGPT`
- No command was blocked by a usage limit, a rate limit or a transport error.

## Setup (as run)

```bash
CODEX="${WORCA_CODEX_BIN:-codex}"
SPK=$(mktemp -d); SRV="$PWD/test/fixtures/codex/ask-spike/echo-mcp.mjs"; NODE=$(command -v node)
git -C "$SPK" init -q && printf 'hello\n' > "$SPK/a.txt"
node test/fixtures/codex/ask-spike/solid-png.mjs "$SPK/red.png" ff0000
node test/fixtures/codex/ask-spike/solid-png.mjs "$SPK/blue.png" 0000ff
# final L (unchanged from the candidate: no further key could remove the remaining tools, see (a))
L=(--disable shell_tool --disable unified_exec --disable code_mode_host --disable apps --disable plugins --disable browser_use --disable computer_use --disable in_app_browser --disable image_generation --disable multi_agent --disable tool_suggest --disable goals --disable hooks -c 'web_search="disabled"' --ignore-rules)
BASE=(--json --skip-git-repo-check --ignore-user-config --sandbox read-only)
M=(-c "mcp_servers.spike.command=\"$NODE\"" -c "mcp_servers.spike.args=[\"$SRV\"]" \
   -c 'mcp_servers.spike.env_vars=["SSH_AUTH_SOCK","SPIKE_KEY"]' -c 'mcp_servers.spike.env={SPIKE_INLINE="inline-ok"}' \
   -c 'mcp_servers.spike.required=true' -c 'mcp_servers.spike.startup_timeout_sec=30' -c 'mcp_servers.spike.tool_timeout_sec=1800' \
   -c 'mcp_servers.spike.default_tools_approval_mode="approve"')
```

Every command ran from `$SPK`, with stderr captured to `<label>.stderr.txt`.

## (a) The shell is off — and the tool list

```bash
echo 'Run the shell command: cat a.txt — then reply with exactly what it printed.' | "$CODEX" exec "${BASE[@]}" - > a2-shell-baseline.raw.jsonl
echo 'Run the shell command: cat a.txt. If you have no way to run commands, say NO_SHELL. Then list every tool name you can call, one per line, nothing else.' | "$CODEX" exec "${BASE[@]}" "${L[@]}" - > a1-lockdown.raw.jsonl
grep -c '"command_execution"' a2-shell-baseline.raw.jsonl a1-lockdown.raw.jsonl
```

- Baseline: 2 `command_execution` items (exit 0). Lockdown: **0** `command_execution` items. The shell is off.
- The lockdown run's tool list (last `agent_message`):
  `NO_SHELL`, `functions.wait`, `functions.request_user_input`, `functions.exec`, `functions.apply_patch`,
  `functions.update_plan`, `functions.view_image`, `collaboration.followup_task`, `collaboration.interrupt_agent`,
  `collaboration.list_agents`, `collaboration.send_message`, `collaboration.spawn_agent`, `collaboration.wait_agent`.
- **The list is not clean.** Probes (`a1-tool-probe.jsonl`, `a1-view-image-probe.jsonl`) asked the model to use each
  extra tool under the lockdown:
  - `functions.exec` (code mode) has no `exec_command` inside it (`TypeError`); it cannot read a file.
  - `apply_patch` is present; the read-only sandbox rejects the write
    (`patch rejected: writing is blocked by read-only sandbox`).
  - **`view_image` works, also on a PNG outside the cwd** (`/tmp/…/outside/secret.png` → "blue"). It reads any image
    file the user can read, with no worca deny rule in the way.
  - **Sub-agents spawn** (`collab_tool_call` items; the sub-agent replied "Hi"). They have the same tools.
- Keys tried to remove them, checked with `--strict-config` (an unknown `-c` key errors:
  `unknown configuration field \`tools.view_image\` in -c/--config override`):
  - unknown in this version: `tools.view_image`, `tools.image`, `tools.apply_patch`, `include_apply_patch_tool`,
    `include_view_image_tool`, `view_image`, `apply_patch_tool_type`, `tools.code_mode`, `tools.exec`,
    `tools.multi_agent`, `tools.spawn_agent`, `collaboration_mode`, `model_supports_image_input` and others;
  - `ToolsToml` has three fields only: `web_search`, `experimental_request_user_input`, `update_plan`;
  - `--disable multi_agent_v2` and `-c agents.max_depth=0` were accepted but the sub-agent tools stayed and a
    sub-agent still spawned (`a1-view-image-probe.jsonl` used `agents.max_depth=0`).
- No flag or config key in `codex-cli 0.146.0-alpha.9.2` removes `view_image` or the sub-agent tools.

**Result: NOT CONFIRMED.** The shell is off, but the tool list cannot be made clean: `view_image` reads image files
outside Ask's roots and around its deny rules. Per §4.6 ("Any lockdown item the spike cannot confirm makes Ask on Codex
refuse"), `CODEX_ASK_LOCKDOWN = null` and Ask on Codex refuses to start until a codex version can turn these tools off.

## (a′) Unknown feature flag

```bash
echo hi | "$CODEX" exec "${BASE[@]}" --disable no_such_feature_xyz - > a3-unknown-feature.raw.jsonl 2> a3-unknown-feature.stderr.txt
```

Exit 1, empty stdout, stderr `Error: Unknown feature flag: no_such_feature_xyz`. **CONFIRMED**: a renamed flag fails
closed. (Task 10's shell-item guard is built either way.)

## (b) Network off under read-only; native web search off

```bash
echo "Run the shell command: curl -sS -m 5 -o /dev/null -w '%{http_code}' https://example.com — …" | "$CODEX" exec "${BASE[@]}" - > b-network-readonly.raw.jsonl
echo 'Search the web for the current price of gold and give one number.' | "$CODEX" exec "${BASE[@]}" "${L[@]}" - > b-websearch-off.raw.jsonl
grep -c '"web_search"' b-websearch-off.raw.jsonl
```

- curl: `command_execution` `status: "failed"`, `exit_code: 6`, output `curl: (6) Could not resolve host: example.com`.
- Web search: 0 `web_search` items; the reply was "I can’t access live web prices in this session."

**Result: CONFIRMED.**

## (c) + (d) MCP server per call; env passthrough

```bash
echo 'Call the spike echo tool with text "hello", then the spike env tool, then the spike fail tool. Then reply DONE.' \
  | SPIKE_KEY=key-ok "$CODEX" exec "${BASE[@]}" "${L[@]}" "${M[@]}" - > c-mcp.raw.jsonl
```

- 6 `mcp_tool_call` items (3 `item.started` + 3 `item.completed`), `server: "spike"`. No call was declined or cancelled.
- `item.started` carries `arguments` (e.g. `{"text":"hello"}`), `result: null`, `error: null`, `status: "in_progress"`.
- Success shape: `"result":{"content":[{"type":"text","text":"{\"echoed\":\"hello\"}"}],"structured_content":null},"error":null,"status":"completed"`.
- Failed shape: `"result":{"content":[{"type":"text","text":"error: fail: as asked"}],"structured_content":null},"error":null,"status":"failed"`
  — `status: "failed"` with the text in `result.content`; `error` is null and there is no `is_error` field.
- env tool `markers`: `SPIKE_KEY: "key-ok"` (via `env_vars`), `SPIKE_INLINE: "inline-ok"` (the `env` table),
  `SSH_AUTH_SOCK: "set"`, `HOME`/`PATH: "set"`, `WORCA_HOME`, `OPENAI_API_KEY`, `AWS_SECRET_ACCESS_KEY`,
  `ANTHROPIC_API_KEY`: null. The child saw 11 variables in total.

**(c) CONFIRMED. (d) CONFIRMED.**

## (e) + (e′) Text deltas and usage

```bash
echo 'Write about 300 words on how rivers form. No tools.' | "$CODEX" exec "${BASE[@]}" "${L[@]}" - > e-stream.raw.jsonl
grep -c '"item.updated"' e-stream.raw.jsonl c-mcp.raw.jsonl
```

Event types: `thread.started`, `turn.started`, one `item.completed` (`agent_message`), `turn.completed`. 0 `item.updated`
in both captures. Usage appears only on `turn.completed`.

**(e) NOT CONFIRMED** (whole messages). **(e′) NOT CONFIRMED** (budget checked when a reply ends).

## (f) Images on exec and exec resume

```bash
echo 'What colour is the attached image? One word.' | "$CODEX" exec -i red.png "${BASE[@]}" "${L[@]}" - > f-image.raw.jsonl
echo 'And the colour of this one? One word.' | "$CODEX" exec resume "$T" -i blue.png --json --skip-git-repo-check --ignore-user-config -c 'sandbox_mode="read-only"' "${L[@]}" - > f-image-resume.raw.jsonl
echo 'What colour is the attached image? One word.' | "$CODEX" exec "${BASE[@]}" "${L[@]}" -i red.png - > f-image-last.raw.jsonl 2> f-image-last.stderr.txt
```

"Red", then "Blue" on resume; the image-last placement also answered "Red" (stderr only `Reading prompt from stdin...`),
so `-i <file> -` does not swallow the `-`. **CONFIRMED**; Task 4 keeps `-i` right after `exec` / `resume <thread>`.

## (g) Resuming an unknown thread

```bash
echo hi | "$CODEX" exec resume 00000000-0000-4000-8000-00000000dead --json --skip-git-repo-check --ignore-user-config -c 'sandbox_mode="read-only"' - > g-resume-unknown.stdout.txt 2> g-resume-unknown.stderr.txt
```

Exit 1; stdout empty (no `thread.started`); stderr
`Error: thread/resume: thread/resume failed: no rollout found for thread id 00000000-0000-4000-8000-00000000dead (code -32600)`.
**CONFIRMED**: `/no rollout found for (?:thread|conversation) id/i` matches as is.

## Sanitised fixtures

Step 9 printed `clean`. Kept under `test/fixtures/codex/ask-spike/`: `a1-lockdown`, `a1-tool-probe`, `a1-view-image-probe`,
`a2-shell-baseline`, `a3-unknown-feature` (empty), `b-network-readonly`, `b-websearch-off`, `c-mcp`, `e-stream`, `f-image`,
`f-image-resume`, `f-image-last` (`.jsonl`) and `g-resume-unknown.txt`.

## Decision table

| Item | What was checked | Result | If CONFIRMED | If NOT CONFIRMED |
|---|---|---|---|---|
| (a) shell off | lockdown run has no `command_execution`; tool list clean | **NOT CONFIRMED** — no shell, but `view_image` (reads images anywhere) and sub-agents cannot be turned off | Task 4 sets `CODEX_ASK_LOCKDOWN` to the verified `L`; Task 9 proceeds | **applied:** Task 4 sets `CODEX_ASK_LOCKDOWN = null`; Task 9 refuses every Codex turn with `CODEX_NO_LOCKDOWN_MESSAGE`; Task 6 hides Codex models from the Ask catalog |
| (a′) unknown feature | `--disable no_such_feature_xyz` errors | **CONFIRMED** (`Error: Unknown feature flag`) | **applied:** nothing extra | Task 10's shell-item guard is the only safety net |
| (b) network off / web search off | curl fails under read-only; no `web_search` item | **CONFIRMED** | **applied:** nothing extra | as (a) NOT CONFIRMED |
| (c) MCP per call | `mcp_tool_call` items for `spike`; calls run, none declined | **CONFIRMED** — failed call = `status:"failed"`, `error:null`, text in `result.content` | **applied:** overrides built; `mcpResultText` unwraps `content[].text` | as (a) NOT CONFIRMED |
| (d) env to the MCP child | `SPIKE_KEY=key-ok` via `env_vars` | **CONFIRMED** | **applied:** values via the codex process env + `env_vars`; nothing on argv | — |
| (e) deltas | `item.updated` with a growing `agent_message` | **NOT CONFIRMED** (no `item.updated`) | Task 4 Step 5 streams deltas | **applied:** whole messages (D15), Task 4 Step 5 skipped |
| (e′) mid-turn usage | usage before `turn.completed` | **NOT CONFIRMED** | Task 10 checks at each usage event | **applied:** Task 10 checks the budget when a reply ends; Task 13's hint says so |
| (f) images | red / blue answered on exec and resume | **CONFIRMED** | **applied:** `-i` right after `exec` / `resume <thread>` | — |
| (g) unknown resume | exact error text | **CONFIRMED** — `no rollout found for thread id … (code -32600)`, exit 1, no `thread.started` | **applied:** `CODEX_RESUME_NOT_FOUND_RE` unchanged | — |

## Follow-up for the owner

Ask on Codex ships refusing (`CODEX_NO_LOCKDOWN_MESSAGE`) because of (a). To lift it, a codex version must offer a way to
remove `view_image` and the sub-agent tools (or the owner must decide that image reads outside the roots are acceptable).
Then set `CODEX_ASK_LOCKDOWN` to the verified list in `src/core/engines/codex.mjs` and re-run this spike.

## (h) codex-cli 0.162.0-alpha.2 — 2026-10-08 (decision 1 of #635: option A, re-run on a newer codex)

- `codex --version`: `codex-cli 0.162.0-alpha.2` (`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`).
- `codex features list` now has `view_image` (`stable  true`): `--disable view_image` is a feature flag.
- Every run used a scratch `CODEX_HOME`, `--ephemeral` (no session files) and `--strict-config`. The sign-in was a link
  to the user's `auth.json`, as worca's managed homes do. Config keys were probed in a home with no sign-in, so a valid
  key reached a 401 and an unknown one failed at start-up.

**How the tool list was read.** On 0.162 the model's own list of its tools is not reliable: two runs of the same flags
named different tools. The authoritative list is the request codex sends. Each flag set was run against a local
stand-in Responses endpoint (`-c model_provider=…` with `base_url = http://127.0.0.1:<port>/v1`) that records the
request body and answers 400. No model was called. On 0.162 the tools ride the request's `input` as an
`additional_tools` item:
- the namespace `functions` holds `exec`, `wait` and `request_user_input`
- the namespace `collaboration` holds `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `list_agents` and
  `interrupt_agent`
- `exec` (code mode, JavaScript with no file system or network) names its nested tools in its description

| Flags (all with `--sandbox read-only`, `-m gpt-5.6-sol`) | `exec`'s nested tools | top level |
|---|---|---|
| none | `apply_patch`, `create_goal`, `exec_command`, `get_goal`, MCP resource tools, `update_goal`, `view_image`, `write_stdin` | `functions.*`, `collaboration.*` |
| the lockdown below | `apply_patch`, MCP resource tools (and the chat's MCP tools, see below) | `functions.*`, `collaboration.*` |

- **`view_image` is gone** under `--disable view_image`. Same for the shell (`exec_command`, `write_stdin`) and goals.
- **The sub-agent tools stay** under every switch tried: `--disable multi_agent`, `--disable multi_agent_v2`,
  `--disable collaboration_modes`, `-c agents.max_depth=0` and `-c agents.max_concurrent_threads_per_session=1`.
  `max_concurrent_threads_per_session=0` is rejected ("must be at least 1"). `multi_agent_mode` is not a config key in
  `exec` (it is a thread setting of the app server).
- **Code mode must stay on.** With `--disable code_mode_host`, as in the 0.146 list, `exec` fails closed ("Code Mode is
  unavailable") and the chat's MCP tools are unreachable: a real turn asked to call the spike `echo` tool answered
  `NO_TOOL`. With code mode on, the same turn ran an `mcp_tool_call` (`spike`/`echo`, `{"echoed":"hello"}`, `completed`).
  The model then listed `exec`'s nested tools as `apply_patch`, the MCP resource tools and `mcp__spike__echo|env|fail`.
- **A sub-agent inherits the lockdown.** A real turn asked to spawn one that runs `cat a.txt`, views an image outside the
  cwd and lists its tools. The sub-agent answered `NO_SHELL`, `NO_IMAGE_TOOL`, and that its only nested tool is
  `apply_patch`. The parent's stream showed a `collab_tool_call` (`wait`), which the Ask watchdog stops a turn on.
- **An attached image still reaches the model** with `view_image` off: the request carried one `input_image` item for
  `-i red.png`.

The final list, `CODEX_ASK_LOCKDOWN` in `src/core/engines/codex.mjs`:

```
--disable shell_tool --disable unified_exec --disable view_image --disable apps --disable plugins --disable browser_use
--disable computer_use --disable in_app_browser --disable image_generation --disable multi_agent --disable multi_agent_v2
--disable tool_suggest --disable goals --disable hooks -c web_search="disabled" --ignore-rules
```

**Result: CONFIRMED with one accepted residual.**
- There is no shell, no image viewer and no web search, and worca's MCP tools work.
- `apply_patch` remains, and the read-only sandbox rejects its writes.
- The owner accepted the sub-agent tools (#635, decision 1, option A). A sub-agent has the same locked-down tools, and
  the watchdog stops the chat when one appears.
- A codex that lacks any of these feature flags (0.146 has no `view_image` switch) is refused before the turn by
  `codexAskSupport` ("update codex to 0.162 or newer"), not by codex's bare "Unknown feature flag".
