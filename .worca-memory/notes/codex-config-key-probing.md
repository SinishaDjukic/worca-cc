---
name: codex-config-key-probing
description: Read before choosing codex `-c` / `--disable` flags (Ask lockdown, spike runs) — how to check a key exists without spending a turn, and which tools 0.146 cannot
paths: src/core/engines/codex.mjs, plans/ask-on-codex-spike.md
updated: 2026-10-03T13:47:41.255Z
author: Bulibas
---

**codex silently ignores an unknown `-c key=value`.** A misspelt lockdown key looks like it worked. Check each key
for free with `--strict-config` and an empty stdin, which stops before any model call:

```bash
printf '' | codex exec --json --skip-git-repo-check --ignore-user-config --sandbox read-only --strict-config -c 'tools.view_image=false' -
# unknown key:  Error loading config.toml: unknown configuration field `tools.view_image` in -c/--config override
# known key:    No prompt provided via stdin.
```

A wrong value type shows the expected struct (`expected struct AgentsToml`). Pass `{bogus=1}` as the value to learn a
table's field names. `--disable <feature>` does fail on an unknown name (`Error: Unknown feature flag`).

**Do not trust the model's own tool list.** Under the lockdown, codex-cli 0.146.0-alpha.9.2 lists `functions.exec`,
`view_image`, `apply_patch` and `collaboration.*`. Only a probe that asks it to USE each tool tells you which ones work.
On 0.146, `view_image` reads any image file (also outside the cwd), and sub-agents spawn. No key turns them off: the
`tools` table has only `web_search`, `experimental_request_user_input` and `update_plan`, and `--disable multi_agent_v2`
or `-c agents.max_depth=0` changes nothing. That is why `CODEX_ASK_LOCKDOWN` is null (plans/ask-on-codex-spike.md (a)).
`codex debug prompt-input` does not show tool schemas, so it cannot settle this either.
