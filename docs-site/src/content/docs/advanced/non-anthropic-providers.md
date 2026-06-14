---
title: Non-Anthropic providers
description: Per-provider compatibility notes — how worca's model and effort axes map onto each provider's API surface.
sidebar:
  order: 5.5
---

worca's model alias and per-agent effort axes were designed around the Anthropic API. Any provider that exposes an Anthropic-compatible endpoint can be wired up via the `env` block on a model alias (see [Adding & routing models](/advanced/adding-models/)) — but each provider's thinking/reasoning semantics differ, so the effort ladder doesn't always translate 1:1.

This page collects the quirks per provider: which endpoint to point at, how worca's effort levels actually map onto the provider's API, and how to drive the provider's thinking modes from the **Pipeline Templates** editor without hand-editing JSON.

:::note[How worca delivers effort to the model]
worca resolves a per-agent effort rung (`low | medium | high | xhigh | max`) and sets `CLAUDE_CODE_EFFORT_LEVEL` on the subprocess env. The **Claude CLI** is what translates that into the API request — for Anthropic models it sets a `thinking` block with a budget; for non-Anthropic Anthropic-compatible endpoints, what actually reaches the wire depends on the provider's interpretation of `thinking.type` and whether it honours `budget_tokens`.
:::

## MiniMax

MiniMax exposes an Anthropic-compatible endpoint at `https://api.minimax.io/anthropic` covering the M2.x family (M2, M2.1, M2.5, M2.7, plus `-highspeed` variants) and M3.

### Endpoint setup

Define a model alias on the [Models page](/configuration/models/) that routes through MiniMax. The `env` block lives in `settings.local.json` (gitignored) so the API key never gets committed:

```jsonc
"worca": {
  "models": {
    "minimax-m3": {
      "id": "MiniMax-M3",
      "env": {
        "ANTHROPIC_BASE_URL": "https://api.minimax.io/anthropic",
        "ANTHROPIC_AUTH_TOKEN": "<YOUR-MINIMAX-API-KEY>"
      }
    }
  }
}
```

Set per-token rates in the model card's **Pricing** accordion — alt-endpoint runs override the Claude CLI's `total_cost_usd` from `worca.pricing.models.<alias>` so cost accounting stays accurate.

### Thinking semantics

MiniMax's `thinking` parameter is **binary**, not graded. It does not honour `budget_tokens`.

| Model family | Thinking control |
|---|---|
| **M3** | `thinking: {"type": "adaptive"}` or `{"type": "disabled"}`. Off by default. |
| **M2.x** (M2, M2.1, M2.5, M2.7) | Always on. No off switch. |

Compared to Anthropic's API where each rung is a different reasoning budget, on MiniMax all five worca rungs collapse to **"thinking on"** — the model does not differentiate between `low` and `max`.

### Effort level mapping

How worca's per-agent effort rung translates on MiniMax models in practice:

| worca per-agent effort | MiniMax M3 effective | MiniMax M2.x effective |
|---|---|---|
| **`(default)`** (unset) | thinking **off** (M3 default) | on (forced) |
| `low` / `medium` / `high` / `xhigh` / `max` | thinking **on** — all five identical | on |
| Escalation `+1` on `test_failure` (loopbacks) | no-op (already on) | no-op |
| Escalation `+2` on `review_changes` | no-op | no-op |
| `auto_cap` ceiling | no-op | no-op |

The whole effort ladder — explicit per-agent values, adaptive bead labels, loopback escalation, and the cap — collapses to a single boolean on M3 and to a no-op on M2.x.

### Recipe — disable thinking on M3 via the template editor

In the **Pipeline Templates** editor (see [Pipeline templates](/configuration/pipeline-templates/)), two settings together pin every stage to a thinking-off request:

1. **Pipeline tab → Effort policy card → Auto mode → `disabled`**
   Adaptive mode would otherwise inject the coordinator's bead-complexity label as the implementer's starting point, which becomes a non-null effort level → sets `CLAUDE_CODE_EFFORT_LEVEL` → the Claude CLI emits a `thinking` block → M3 turns thinking on. Pinning `disabled` removes that path.
2. **Agents tab → every agent's Effort field → `(default)`**
   Stores `effort: null`, which omits `CLAUDE_CODE_EFFORT_LEVEL` from the subprocess env. No env var → no `thinking` block in the request → M3 falls back to its default (off).

### Recipe — enable thinking on M3

Set any per-agent **Effort** to a literal rung (`low` through `max` — all equivalent on M3). The Claude CLI will emit a `thinking` block, which M3 interprets as on. There is no graduated control beyond on/off, so pick one rung consistently rather than tuning per agent.

### Caveats

- **M2.x always thinks.** The Effort field is purely cosmetic for M2.x models — no setting on either axis changes the request. Treat the effort policy as Anthropic-only when running M2.x; pin `auto_mode: disabled` to avoid misleading escalation telemetry in `status.json`.
- **Advisory min-effort indicators are false signals.** The yellow ⚠ "Below recommended floor" chip on `planner` / `reviewer` / `guardian` (see [Agents & models](/configuration/agents-and-models/)) is calibrated for Anthropic's reasoning ladder. On MiniMax, `low` and `max` are identical — ignore the indicator.
- **Forensic `requested` vs `level` is misleading.** The iteration record in `status.json` reports `requested: "xhigh"` / `level: "high"` based on the model's ladder, but the request actually carried `thinking.enabled` regardless of the rung. The forensic pair is only meaningful for Anthropic models.
- **Template scope, not project scope.** Effort lives on the template, not in project settings — configure these two knobs on whichever template runs MiniMax. See [Configuration precedence](/configuration/precedence/) for the strip-and-merge rules.

---

*More providers will be documented here as they're validated. If you've wired up a non-Anthropic provider with a different thinking-mode surface, the file lives at `docs-site/src/content/docs/advanced/non-anthropic-providers.md` — PRs welcome.*
