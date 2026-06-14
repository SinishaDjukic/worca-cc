---
title: Non-Anthropic providers
description: Per-provider compatibility notes — how worca's model and effort axes map onto each provider's API surface, with screenshot-driven setup recipes.
sidebar:
  order: 5.5
---

worca's model alias and per-agent effort axes were designed around the Anthropic API. Any provider that exposes an Anthropic-compatible endpoint can be wired up via the **Environment variables** table on a model alias (see [Adding & routing models](/advanced/adding-models/)) — but each provider's thinking/reasoning semantics differ, so the effort ladder doesn't always translate 1:1.

This page collects the quirks per provider: which endpoint to point at, how worca's effort levels actually map onto the provider's API, and how to drive the provider's thinking modes from the **Pipeline Templates** editor without hand-editing JSON.

:::note[How worca delivers effort to the model]
worca resolves a per-agent effort rung (`low | medium | high | xhigh | max`) and sets `CLAUDE_CODE_EFFORT_LEVEL` on the subprocess env. The **Claude CLI** is what translates that into the API request — for Anthropic models it sets a `thinking` block with a budget; for non-Anthropic Anthropic-compatible endpoints, what actually reaches the wire depends on the provider's interpretation of `thinking.type` and whether it honours `budget_tokens`.
:::

## MiniMax

MiniMax exposes an Anthropic-compatible endpoint at `https://api.minimax.io/anthropic` covering the M2.x family (M2, M2.1, M2.5, M2.7, plus `-highspeed` variants) and M3.

### Endpoint setup — on the Models page

Open the [Models](/configuration/models/) page, click **+ New** to create a MiniMax alias, and fill the **Environment variables** table:

![The Edit Model editor for the `minimax-m3` alias: ALIAS field reads "minimax-m3", Storage badge "Project", "Resolves to: opus + 8 env vars" summary, MODEL ID field set to `opus`, and the Environment variables table with ANTHROPIC_BASE_URL set to `https://api.minimax.io/anthropic`, plus API_TIMEOUT_MS (3000000), CLAUDE_CODE_MAX_OUTPUT_TOKENS (8192), MAX_THINKING_TOKENS (8191), ANTHROPIC_DEFAULT_OPUS_MODEL (`MiniMax-M3`), and ANTHROPIC_DEFAULT_SONNET_MODEL (`MiniMax-M3`) rows.](/screenshots/non-anthropic-providers/01-model-editor.png)

Minimum required env keys:

| Env key | Value |
|---|---|
| `ANTHROPIC_BASE_URL` | `https://api.minimax.io/anthropic` |
| `ANTHROPIC_AUTH_TOKEN` | your MiniMax API key (lives in `settings.local.json` — gitignored) |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` / `ANTHROPIC_DEFAULT_HAIKU_MODEL` | the MiniMax model id the alias should route each tier to (e.g. `MiniMax-M3`, `MiniMax-M2.7-highspeed`) |

The **MODEL ID** field above the env table can stay set to `opus`, `sonnet`, or `haiku` — the `ANTHROPIC_DEFAULT_*_MODEL` env vars override it on the wire, so the same alias can serve as a drop-in replacement for any Anthropic tier.

Set per-token rates in the alias card's **Pricing** accordion — alt-endpoint runs override the Claude CLI's `total_cost_usd` from your configured rates so cost accounting stays accurate.

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

**Step 1.** On the **Agents** tab, set **Auto mode** in the Effort Mode card to `disabled`:

![The Edit Template view for "Feature Development (Minimax)" — ID `feature-development-minim(ax)`, Project storage badge — Description noting that every agent is pinned to project-level MiniMax M3 and M2.7 models routed through the MiniMax public API endpoint. On the Agents tab, the EFFORT MODE card shows AUTO MODE set to `disabled` (inline description "Per-agent effort only; no runtime escalation on loopbacks.") and AUTO CAP set to `xhigh`.](/screenshots/non-anthropic-providers/02-effort-mode-disabled.png)

Why: adaptive mode would otherwise inject the coordinator's bead-complexity label as the implementer's starting point, which becomes a non-null effort level → sets `CLAUDE_CODE_EFFORT_LEVEL` → the Claude CLI emits a `thinking` block → M3 turns thinking on. Pinning `disabled` removes that path.

**Step 2.** On the same tab, set every per-agent **Effort** field to `(default)`:

![Agent cards on the Agents tab for the MiniMax template. Top row partially visible: three agents with EFFORT `(default)` and a MAX BEADS field set to `Auto` on the rightmost (coordinator). Bottom row: IMPLEMENTER (MODEL `minimax-m2_7`, EFFORT `(default)`), TESTER (MODEL `minimax-m2_7`, EFFORT `(default)`), REVIEWER (MODEL `minimax-m3`, EFFORT `(default)`). Below that, GUARDIAN / LEARNER / WORKSPACE_PLANNER cards begin.](/screenshots/non-anthropic-providers/03-per-agent-default.png)

Why: `(default)` stores `effort: null`, which omits `CLAUDE_CODE_EFFORT_LEVEL` from the subprocess env. No env var → no `thinking` block in the request → M3 falls back to its default (off).

### Recipe — enable thinking on M3

Set any per-agent **Effort** to a literal rung (`low` through `max` — all equivalent on M3). The Claude CLI will emit a `thinking` block, which M3 interprets as on. There is no graduated control beyond on/off, so pick one rung consistently rather than tuning per agent.

### Caveats

- **M2.x always thinks.** The Effort field is purely cosmetic for M2.x models — no setting on either axis changes the request. Treat the effort policy as Anthropic-only when running M2.x; pin **Auto mode** to `disabled` to avoid misleading escalation telemetry in `status.json`.
- **Advisory min-effort indicators are false signals.** The yellow ⚠ "Below recommended floor" chip on `planner` / `reviewer` / `guardian` (see [Tuning effort § Advisory recommended floors](/advanced/tuning-effort/#advisory-recommended-floors)) is calibrated for Anthropic's reasoning ladder. On MiniMax, `low` and `max` are identical — ignore the indicator.
- **Forensic `requested` vs `level` is misleading.** The iteration record in `status.json` reports `requested: "xhigh"` / `level: "high"` based on the model's ladder, but the request actually carried `thinking.enabled` regardless of the rung. The forensic pair is only meaningful for Anthropic models.
- **Template scope, not project scope.** Effort lives on the template, not in project settings — configure these two knobs on whichever template runs MiniMax. See [Configuration precedence](/configuration/precedence/) for the strip-and-merge rules.

---

*More providers will be documented here as they're validated. If you've wired up a non-Anthropic provider with a different thinking-mode surface, the file lives at `docs-site/src/content/docs/advanced/non-anthropic-providers.md` — PRs welcome.*
