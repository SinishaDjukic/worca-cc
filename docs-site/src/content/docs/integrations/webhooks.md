---
title: Webhooks
description: Deliver pipeline events to any URL, with optional HMAC signing and control responses — managed from the Project Settings Webhooks panel.
sidebar:
  order: 2
---

A **webhook** POSTs every matching event to a URL you control. Everything you need to configure one — URL, secret, event filter, retries, control mode — lives in the dashboard's **Project Settings → Webhooks** panel.

## The Webhooks panel

Open **Project Settings → Webhooks** in the dashboard. Each subscriber is a card with all its fields inline; saves take effect on the next run.

![The Project Settings → Webhooks panel: Hook Events toggle and Rate limit (ms) at the top of the EVENT SYSTEM section, then the WEBHOOKS section with a Webhook 1 card containing URL, SECRET (HMAC signing), EVENT PATTERNS (set to `pipeline.*`), TIMEOUT (10000) / RETRIES (3) / RATE LIMIT (1000) fields, a Control Webhook sl-switch (off) with the description "Allow this webhook to control the pipeline (requires non-empty secret)", and Test / Remove buttons. Add Webhook + Save / Reset buttons sit beneath.](/screenshots/webhooks/01-panel.png)

Per subscriber:

| Field | What it does |
|---|---|
| **URL** | The endpoint that receives the POST. Required. |
| **Secret** | HMAC signing secret. Routed to `settings.local.json` (gitignored) — see [Secrets](/configuration/secrets/). |
| **Event Patterns** | Comma-separated fnmatch patterns (`pipeline.run.*`, `workspace.*`, a bare `*`). Empty means all events. |
| **Timeout / Retries / Rate Limit** | Delivery limits per subscriber. |
| **Control Webhook** | Toggle that promotes this subscriber to a synchronous control endpoint (see below). |
| **Test** | Sends a one-shot ping so you can confirm delivery without launching a pipeline. |

Above the subscriber list, the **Event System** controls let you toggle event emission as a whole (`Events Enabled`), include high-volume per-tool telemetry (`Agent Telemetry`), include hook governance events (`Hook Events`), and set the global Rate Limit (ms) — the minimum interval between same-event-type sends per webhook.

## Delivery headers

Each POST carries headers you can route and verify on:

| Header | Value |
|---|---|
| `X-Worca-Event` | the `event_type` string |
| `X-Worca-Delivery` | the `event_id` (UUID) — use it to dedupe |
| `X-Worca-Signature` | `sha256=<hex>` — present only when a secret is set |

## Verifying the signature

When a secret is configured, worca signs the body with HMAC-SHA256 and sends it in `X-Worca-Signature`. Verify it with a **timing-safe** comparison — recompute the HMAC over the raw request body with your shared secret and compare against the header. Never compare with a plain `==`.

## Control webhooks

Flip the **Control Webhook** switch on a subscriber to promote it from one-way delivery to a synchronous control endpoint. The switch is gated by the Secret field — without a non-empty signing secret it stays inert; the inline description in the screenshot above spells out the contract.

When enabled, the pipeline calls control webhooks **synchronously** at milestones and reads an action from the JSON response body:

```jsonc
{ "control": { "action": "pause" } }
```

The action is `pause`, `abort`, or `continue` — letting an external system gate the pipeline, for example holding a run until a deploy window opens. (Only the response shape — what your endpoint must return — needs JSON here; everything on worca's side is the UI toggle plus secret.)

:::tip[Verifying delivery]
The **Test** button on each subscriber sends a one-shot ping so you can validate the URL, signature, and event routing end-to-end without launching a pipeline. Each POST carries `X-Worca-Delivery` (the event ID) so you can confirm receipt and dedupe, and `X-Worca-Signature` so you can validate your HMAC verification.
:::
