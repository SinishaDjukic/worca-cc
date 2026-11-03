---
name: ask-untrusted-input-and-secrets
description: Read before turning model or user input into a regex or glob, writing a shell-command or path check, redacting output, or giving the Ask MCP child a secret.
paths: src/core/ask/**, src/core/secret-paths.mjs, src/core/settings-cascade.mjs, src/core/host-guard.mjs, src/core/redact.mjs
updated: 2026-11-03T23:24:50.321Z
author: Bulibas
---

Treat everything the Ask model sends or can read as hostile: repository text can prompt-inject it.

**Patterns: bound the run time, not the length.**
- `globToRegExp` (`ask/deny-rules.mjs`) backtracks on repeated `*`: `'/b/' + '*a'.repeat(7) + 'z'` against a 60-char
  name took 5 s (2026-10-03). `new RegExp(pattern)` accepts `(a+)+$`. In agent-relay mode (`askAgentRelay`)
  `createAskToolServer` runs inside the worca server, so one slow match blocks the whole server.
- User input too: the project setting `secretPaths` feeds `src/core/secret-paths.mjs`, and `isSecretPathList` checks only
  length (256) and count (200). The old `globRe` (`[^/]*` per `*`) took 45 s on `'*a'.repeat(7) + '*b'`, and
  `overlayFiles` matches every file synchronously at sandbox start, so the run hung. When a setting starts feeding an
  existing matcher, the matcher's input is no longer trusted.
- Fix (core-3, 2026-10-24): `secret-paths.mjs` `globSteps` + `globMatch`, a set-of-states walk (name length × pattern
  steps; ~5x slower than the regex on plain patterns, 229 vs 46 ms for 100,000 paths × 6 defaults). Reuse it (e.g. for
  `globToRegExp`), or collapse `*` runs and cap wildcards, or match in a worker with a timeout. Pin with a timing test
  that would hang on the old matcher: `'*a'.repeat(8) + '*b'` against 200 `a`s under 50 ms (`test/secret-paths.test.mjs`).
  Review flags an unbounded reachable version as at least major; the Codex `grep`/`glob` tools (Plan 2b) are still
  unbounded and become reachable when `CODEX_ASK_LOCKDOWN` is set.
- Node `net.BlockList`: an IPv6 rule `::ffff:0:0/96` matches EVERY IPv4 address (v4 is checked in v4-mapped form). To
  block v4-mapped or NAT64 addresses, decode the embedded IPv4 and check it against the IPv4 rules.

**Command-line checks** (`host-guard.mjs` `stripQuotes`, `ask/command-policy.mjs`). Blanking quoted spans is right for
"is this a command?" (`-m "rm -rf /"` is data) but WRONG for "does this name a path?": `cat "$HOME/.ssh/id_rsa"` and
`rm -rf "/tmp/x"` become `cat ""` / `rm -rf ""`, and Claude quotes paths by habit (#574 refine 4). Path denies read the
whole text, quotes included (a commit message naming `.env` is refused); command checks split on `;`, `&&`, `|`… with
quoted spans masked, then restore each span unquoted as one word. Per-segment first-word checks missed (2026-10-05):
`cd .. && rm -rf proj` (target resolved before the `cd`), `xargs rm -rf /`, `bash -c "rm -rf /"`, `rm -rf $(pwd)/..`
(the split on `$(` dropped the target), `git -C . push --force`. Block-list tests must cover `cd` tracking, wrapper
prefixes (xargs, nice, timeout, doas), `sh -c` bodies, `$(`/backtick targets and git global options. `ASK_DENY_RULES`
anchors `.claude`, `.docker`, `.kube`, `.npmrc` at `~/` only: every worktree has its own `.claude/rules`, so refusing
those names anywhere blocks ordinary project work.

**Redaction.** Ask shell output reaches the model: refuse `gh auth token`, and `ask/redact.mjs` must cover `gho_`, not
only `ghp_`. `redactSecrets` (`src/core/redact.mjs`) removes only broker `wbt_…` tokens, not `ghp_…`: a redaction test
uses a `wbt_` token, or `createRedactor(values)` for known secret values.

**Secrets never go on disk the model can read.** The per-turn `mcp-<msgId>.json` sits in `<worcaHome>/tmp/ask`, the
chat's own cwd shared by all threads, guarded only by `Read(//**/.worca-cc/tmp/**)`; Grep has been seen ignoring path
denies (`spawn.mjs` header), so a deny rule protects nothing. Never put a secret value in `buildMcpConfig` env or any
file under the worca home. Put the variable NAME in the config and add it to `buildAskSpawnOptions` `envAllowlist`: the
scrubbed claude process keeps it and Claude Code passes it to the stdio child (the path `SSH_AUTH_SOCK` takes; see
`webKeyVar` / `webMcpEnv`). Reject reserved names (`RESERVED_KEY_VAR`, case-insensitive) before allowlisting. Prove it
with a turn test: set a real env value, read the written json in a fake `runClaudeImpl`, assert the value is absent and
the name is in `opts.envAllowlist`. A search key written there cost a review cycle; a 30–40 char key also falls under the
data-in-URL threshold, so it could leave through `web_fetch`.

**A `${VAR}` the model names is a credential choice, and `RESERVED_KEY_VAR` is not the credential list.** It misses
Worca's own `GH_TOKEN`, `GITHUB_TOKEN`, `AZURE_DEVOPS_EXT_PAT` and the Bitbucket keys. The #1074 v2 plan accepted
`${GH_TOKEN}` in a Jira profile with an attacker `baseUrl`. The server resolves `{"$env"}` in its own process
(`readPluginConfig` before the connector spawns), so the token would go to that host. The plan's warning ("agents can
read GH_TOKEN") was false too. Test names against `stripHostCredentials({[NAME]:'1'})` (upper-cased) and allow a host
credential only where the field's manifest `help` names it (github-source documents `GH_TOKEN`). Any card that pairs
an address with a token reference must name the destination host. Re-validation at Apply must refuse warnings the card
did not show.
