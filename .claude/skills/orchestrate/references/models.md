# Model selection for `/orchestrate`

## Native mapping — what this skill actually applies

In a Claude Code session each agent runs as a subagent. A subagent takes a model
**tier** (`opus` | `sonnet` | `haiku` | `inherit`) — **not** a dated model id and
**not** a per-agent effort.

Defaults (all Opus):

| Agent | Tier |
|---|---|
| worca-cc-planner | opus |
| worca-cc-plan-refiner | opus |
| worca-cc-plan-reviewer | opus |
| worca-cc-implementer | opus |
| worca-cc-code-reviewer | opus |

- **Effort** is a **session-level** setting you choose once for your Claude Code
  session (recommend `high` or `max` for this workload). It cannot be pinned per
  agent in native mode.
- **Override per run:** tell `/orchestrate` e.g. "use sonnet for the implementer" and
  the conductor passes `model: sonnet` to that spawn.

## Reference — full Worca CC matrix (Node engine only)

When you run the real Node engine (`src/cli/worca-cc.mjs`), `--model` accepts any of
these ids and `--effort` gives full per-step granularity. This table is for that
path; the native skill cannot express dated ids or per-agent effort.

| id | label | efforts |
|---|---|---|
| `claude-opus-5` | Opus 5 | medium, high, xhigh, max |
| `claude-opus-4-8` | Opus 4.8 | medium, high, xhigh, max |
| `claude-opus-4-8[1m]` | Opus 4.8 (1M) | medium, high, xhigh, max |
| `claude-opus-4-7` | Opus 4.7 | medium, high, xhigh, max |
| `claude-opus-4-7[1m]` | Opus 4.7 (1M) | medium, high, xhigh, max |
| `claude-opus-4-6` | Opus 4.6 | medium, high, max |
| `claude-opus-4-6[1m]` | Opus 4.6 (1M) | medium, high, max |
| `claude-sonnet-4-6` | Sonnet 4.6 | medium, high, max |
| `claude-sonnet-4-6[1m]` | Sonnet 4.6 (1M) | medium, high, max |
| `claude-haiku-4-5` | Haiku 4.5 | medium, high |

The `[1m]` suffix selects the 1M-token long-context variant. Haiku 4.5 1M is omitted
(the CLI rejects it). Opus 5 (`claude-opus-5`) is 1M-context only and needs no `[1m]`
suffix. These ids are aliases the installed `claude` CLI must accept — verify with
`claude --model <id>`.
