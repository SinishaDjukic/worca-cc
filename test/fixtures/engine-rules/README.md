# Engine rule fixtures

The proof behind each engine's catalog `rules` and `subagents` (`src/shared/engine-switch.mjs`,
`plans/core-protection-layer-design.md` §4.4). `test/boundary-catalog.test.mjs` and `test/engine-conformance.test.mjs`
read them.

| file | what it proves |
|---|---|
| `<engine>/<kind>.json` | the translation: `{ rules, expected }`, where `expected` is the adapter's `rulePlan(rules)` (Claude: the `permissions` of its `--settings` payload). Every `held` and `partial` kind has one. |
| `<engine>/<kind>.denial.jsonl` | the denial: a captured stream from a real CLI run in which the engine refused the action that rule denies. Every `held` kind has one; the adapter's `denials(lines)` must find a refusal in it. |
| `<engine>/subagent.denial.jsonl` | the same refusal from inside a sub-agent: the only proof that lets `subagents.inheritsRules` be `yes`. |

## Captures

`WORCA_ALLOW_LIVE=1 npm run test:live -- --capture-denials claude [--only Read,Bash]` (`test/live/capture-denials.mjs`)
runs each kind's deny rule against the real CLI in a scratch dir, with a minimal env (HOME, USER, LOGNAME, PATH) and no
user settings, and writes the stream when the adapter finds the refusal. Paths, uuids, timestamps and the account's
own connectors, plugins and skills are taken out.

Claude Code 2.1.308, `claude-haiku-5-5`, captured 2026-10-22: `Read`, `Edit`, `Bash`, `WebFetch`, `WebSearch` and a
sub-agent's `Read` were refused. `mcp__probe__echo` was taken out of the session (its sibling `mcp__probe__ping`
stayed in the tool list) and the model's call to it was refused as "No such tool available": `claudeDenials` reports
that as a `removed` denial, the mcp kind's proof. Not held, from the same runs:

- `Write(./new.txt)`: the file was written. Claude Code consults Edit rules for every file-editing tool and never a
  Write rule, so the catalog says `unenforced`.
- `Grep`, `Glob`: this CLI has no such tools (it greps through Bash), so there is nothing to refuse: `unverified`.

Codex, Copilot and Cursor have no `held` kind: their tool-removing rules (a bare `Bash`, an MCP rule) leave no denial
event to capture, their command and path rules are `partial`, Copilot's account here has no CLI access and
`cursor-agent` is not signed in. `test/fixtures/copilot/denied.jsonl` is a real Copilot 1.0.100 capture of a
`shell(git push)` refusal, the shape `copilotDenials` reads.
