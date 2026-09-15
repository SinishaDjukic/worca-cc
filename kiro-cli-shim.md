# Kiro CLI shim

`scripts/kiro-claude-shim.mjs` lets a worca run execute on **Kiro CLI** instead of
Claude Code, without touching a line of `src/`.

## Why it exists

`src/core/claude-runner.mjs` already resolves its binary from `WORCA_CLAUDE_BIN`.
That is the whole seam. The shim is a drop-in stand-in for `claude`:

- **outside** — claude's headless contract: claude argv in, `stream-json` NDJSON out
- **inside** — Kiro's Agent Client Protocol (`kiro-cli acp`), line-delimited JSON-RPC 2.0

```bash
export WORCA_CLAUDE_BIN=/abs/path/to/scripts/kiro-claude-shim.mjs
```

ACP rather than `kiro-cli chat --no-interactive` because `chat` emits ANSI-wrapped
prose with no structured mode (`-f json` only covers `--list-models` /
`--list-sessions`). Parsing it would lose the session id (pause/resume), the tool-call
events (the UI's tool pills) and the spend. Verified against kiro-cli 2.18.0.

## Architecture

```
worca  (src/core/claude-runner.mjs)
  │  spawn(WORCA_CLAUDE_BIN, [-p, --append-system-prompt, --model, --resume, ...])
  │  ◀── stdout: stream-json NDJSON  +  bare lines → {type:'log'}
  ▼
scripts/kiro-claude-shim.mjs
  ├─ parseArgs()          claude argv → the subset worca actually emits
  ├─ mapModel()           worca model id → a Kiro model id (logs every substitution)
  ├─ foldSystemPrompt()   no ACP system channel → <system-instructions> in the prompt
  ├─ hasPermissionRules() --settings with real rules → refuse the run
  ├─ translate()          ACP session/update → stream-json events   (pure, unit-tested)
  └─ usdFromCredits()     metered credits × operator rate → total_cost_usd
  │  spawn(kiro-cli acp --trust-all-tools [--model] [--effort])
  │  ◀── stdio: JSON-RPC 2.0, one message per line
  ▼
kiro-cli 2.18.0
```

Everything above `main()` is pure and stateful-by-argument, so the translation layer is
tested without spawning anything; `main()` is only wiring.

### Turn lifecycle

1. `initialize` — `fs/*` declared **false**, so kiro does its own file IO and never calls
   back into the shim.
2. `session/new` (or `session/load` when `--resume` was passed) → the session id goes out
   as `{type:'system',subtype:'init',session_id}`; worca persists it for the next step.
3. `session/prompt` with the system prompt folded into the user message.
4. `session/update` notifications stream in and are translated:

   | ACP | stream-json |
   | --- | --- |
   | `agent_message_chunk` | `assistant` / `text` |
   | `tool_call` | `assistant` / `tool_use` (kind → Read, Edit, Bash, Grep, WebFetch, Task) |
   | `tool_call_update status=completed` | `user` / `tool_result` |

5. The `session/prompt` response settles the run as `{type:'result'}` with the full text.

`session/load` **replays the entire prior conversation** as `agent_message_chunk` before
going live, so a `replaying` flag drops those chunks — without it every resumed step
returns stale text.

## Configuration

| Env var | Effect |
| --- | --- |
| `WORCA_CLAUDE_BIN` | point worca at the shim (required) |
| `WORCA_KIRO_BIN` | kiro binary, default `kiro-cli` |
| `WORCA_KIRO_MODEL` | force one model, bypassing the alias table |
| `WORCA_KIRO_USD_PER_CREDIT` | credit price from your Kiro billing page; enables cost reporting |

Under the `envScrub` guardrail, `buildSpawnEnv()` keeps only the base vars plus
`ANTHROPIC_*` / `CLAUDE_*`, so **every `WORCA_KIRO_*` var must be added to the project's
`envAllowlist`** or it silently disappears from the child environment.

Worca's catalog is all Claude ids and Kiro knows none of them, so `mapModel()` maps
haiku→`claude-haiku-4.5`, sonnet→`claude-sonnet-4.5`, opus→`claude-sonnet-4.5`
(*Kiro has no Opus tier*) — and logs each substitution, because a silent one would
misreport which model did the work.

## Cost

Kiro meters in **credits**, and the credit price is a property of the operator's plan —
nothing on the wire carries it. So the rate is configuration, never a constant.

- Credits accumulate across **every** `_kiro.dev/metadata` message of a turn (a multi-step
  turn meters more than once) and are converted once, at settle.
- The cost rides on **both** result shapes: credits are burned whether the turn succeeded
  or blew up.
- With no rate set, the field is omitted entirely and the event is byte-identical to the
  pre-costing one. Worca reads that as "no cost reported", not `$0.00`.
- A malformed, zero or negative rate is treated as **unset**, and `0` credits also yields
  no field — `_kiro.dev/metadata` has no ordering guarantee against the prompt response, so
  zero credits means *the meter was never seen*, not *this step was free*.

With a rate configured, `extractResultCost()` picks up `total_cost_usd` unchanged, so
per-phase spend, the budget cap and the stats rollups all work on the Kiro route. The
derivation is logged (`0.0176 credits x $0.04/credit = $0.0007`) so a wrong dollar figure
is always traceable back to the rate.

## Deliberate omissions

- **`--settings`** — guardrail permission rules have no ACP equivalent. The shim **refuses
  to run** when real rules are present rather than silently running less sandboxed than
  the operator asked for.
- **`--allowedTools`** — not enforced; the run is `--trust-all-tools` (the `acceptEdits`
  analogue). Tool names differ entirely between the two CLIs.
- **`--mcp-config`** — not translated (logged as a warning). `session/new` takes an
  `mcpServers[]` array, but worca's generated config shape was never mapped or tested.

## Tests

`test/kiro-claude-shim.test.mjs` — pure units for argv, model mapping, system-prompt
folding, permission-rule detection, ACP translation and credits→USD, plus end-to-end runs
that drive the real spawn path through a fake `kiro-cli` (text/session/tool pills, resume
with replayed history dropped, a mid-turn crash, and both cost outcomes).

```bash
node --test test/kiro-claude-shim.test.mjs
```
