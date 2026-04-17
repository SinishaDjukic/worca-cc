# Chat Integrations — Setup Guide

Worca can push pipeline notifications to **Telegram**, **Discord**, **Slack**, and any generic outbound webhook. Telegram also supports two-way command control: pause, resume, stop, and status queries from your phone.

Integrations run inside the `worca-ui` server process — no separate daemon needed. If the UI server is running, integrations are running.

## Quick start

1. Create `~/.worca/integrations/config.json` (see [Configuration schema](#configuration-schema) below).
2. Set the required environment variables for your platforms (bot tokens, webhook URLs).
3. Restart the UI server: `pnpm worca:ui:restart`.
4. Verify with: `worca integrations status`.

---

## Configuration schema

`~/.worca/integrations/config.json` — global, user-wide. Loaded once at server boot.

```jsonc
{
  "schema_version": 1,            // required, must be 1
  "enabled": true,                // top-level on/off switch
  "webhook_secret_env": "WORCA_WEBHOOK_SECRET",    // optional, HMAC secret env var name
  "webhook_secrets_env": "WORCA_WEBHOOK_SECRETS",  // optional, comma-separated secrets
  "strict_inbox_verification": false,              // see §Security

  "telegram": {
    "enabled": true,
    "bot_token_env": "TELEGRAM_BOT_TOKEN",  // env var holding the token
    "chat_id": "123456789",                 // your Telegram user or group chat ID
    "events": [                             // events to forward
      "pipeline.run.completed",
      "pipeline.run.failed",
      "pipeline.run.interrupted",
      "pipeline.git.pr_created",
      "pipeline.git.pr_merged",
      "pipeline.circuit_breaker.tripped",
      "pipeline.cost.budget_warning"
    ],
    "rate_limit_per_min": 20                // optional (default: 20)
  },

  "discord": {
    "enabled": true,
    "bot_token_env": "DISCORD_BOT_TOKEN",   // env var holding the Bot token
    "channel_id": "1234567890123456789",    // target text channel ID
    "events": ["pipeline.run.completed", "pipeline.run.failed"]
  },

  "slack": {
    "enabled": true,
    "webhook_url_env": "SLACK_WEBHOOK_URL", // env var holding the incoming webhook URL
    "events": ["pipeline.run.completed", "pipeline.run.failed"]
  },

  "webhook_out": {
    "enabled": true,
    "endpoints": [
      {
        "url": "https://your-server.example.com/hook",
        "format": "generic-json",           // see §Generic webhook formats
        "events": ["pipeline.run.completed"],
        "headers": { "X-My-Secret": "..." } // optional custom headers
      }
    ]
  }
}
```

### Top-level fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `schema_version` | integer | yes | — | Must be `1` |
| `enabled` | boolean | no | `true` | Master switch; set `false` to disable all integrations without removing config |
| `webhook_secret_env` | string | no | — | Name of env var holding a single HMAC secret used to verify events from pipelines |
| `webhook_secrets_env` | string | no | — | Name of env var holding **comma-separated** HMAC secrets (rotation support) |
| `strict_inbox_verification` | boolean | no | `false` | See §Security |

---

## Tier 1 events

The following event types are supported in the `events` array for any adapter:

| Event type | When it fires |
|---|---|
| `pipeline.run.completed` | Run finished successfully |
| `pipeline.run.failed` | Run hit a fatal error |
| `pipeline.run.interrupted` | Run was paused or manually stopped |
| `pipeline.git.pr_created` | Guardian opened a pull request |
| `pipeline.git.pr_merged` | Pull request was merged |
| `pipeline.circuit_breaker.tripped` | Circuit breaker halted the run |
| `pipeline.cost.budget_warning` | Run crossed the budget threshold |

Omit an event from the `events` array to suppress it for that adapter.

---

## Telegram setup

Telegram is the only adapter that supports **inbound commands** in v1 (Discord/Slack inbound is a follow-up).

### 1. Create a bot via BotFather

1. Open Telegram and search for `@BotFather`.
2. Send `/newbot`. Follow the prompts (name → username ending in `Bot`).
3. BotFather replies with your **bot token**: `1234567890:ABCdef...`
4. Set the env var: `export TELEGRAM_BOT_TOKEN=1234567890:ABCdef...`

### 2. Find your chat ID

1. Start a chat with your new bot (send `/start`).
2. Start the UI server with the bot configured (even with an empty allowlist) and run:
   ```
   worca integrations status
   ```
   Alternatively, open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser after sending `/start` — look for `chat.id` in the response.
3. Set `chat_id` in `config.json` to that number.

### 3. Config example

```jsonc
{
  "schema_version": 1,
  "enabled": true,
  "telegram": {
    "enabled": true,
    "bot_token_env": "TELEGRAM_BOT_TOKEN",
    "chat_id": "123456789",
    "events": [
      "pipeline.run.completed",
      "pipeline.run.failed",
      "pipeline.circuit_breaker.tripped",
      "pipeline.cost.budget_warning"
    ]
  }
}
```

### 4. Inbound commands (Telegram only)

Once `chat_id` is in the config it is automatically added to the allowlist. Available commands:

**Global (no active project required)**

| Command | Description |
|---|---|
| `/start` | Show your chat ID (useful during setup) |
| `/help` | Print all commands |
| `/whoami` | Your chat ID, active project, mute state |
| `/projects` | List all registered projects |
| `/use <project>` | Set active project for this chat |
| `/active` | Show pipelines currently running across all projects |
| `/mute [duration]` | Silence notifications — e.g. `/mute 1h`, `/mute 30m` |
| `/unmute` | Restore notifications |

**Project-scoped (require `/use <project>` first)**

| Command | Description |
|---|---|
| `/status [run_id]` | Run status |
| `/runs [N]` | Recent runs (default 5) |
| `/last` | Most recent run detail |
| `/cost [today\|week\|run_id]` | Cost summary |
| `/pr [run_id]` | PR URL for a run |
| `/pause [run_id]` | Pause the active run |
| `/resume [run_id]` | Resume a paused run |
| `/stop [run_id]` | Stop the run immediately |

---

## Discord setup (outbound only)

### 1. Create a bot and get the token

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a **New Application**.
2. Under **Bot**, click **Add Bot**. Copy the **Bot Token**.
3. Set: `export DISCORD_BOT_TOKEN=<your-token>`

### 2. Invite the bot to your server

1. Under **OAuth2 → URL Generator**, select scopes: `bot`. Permissions: `Send Messages`.
2. Open the generated URL to invite the bot to your server.

### 3. Find the channel ID

Right-click the target channel in Discord → **Copy Channel ID** (requires Developer Mode in Discord settings).

### 4. Config example

```jsonc
{
  "schema_version": 1,
  "enabled": true,
  "discord": {
    "enabled": true,
    "bot_token_env": "DISCORD_BOT_TOKEN",
    "channel_id": "1234567890123456789",
    "events": [
      "pipeline.run.completed",
      "pipeline.run.failed",
      "pipeline.git.pr_created"
    ]
  }
}
```

---

## Slack setup (outbound only)

### 1. Create an incoming webhook

1. Go to your Slack workspace → **Apps** → search **Incoming Webhooks** → **Add to Slack**.
2. Choose the channel and click **Add Incoming Webhooks integration**.
3. Copy the **Webhook URL** (starts with `https://hooks.slack.com/services/...`).
4. Set: `export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...`

### 2. Config example

```jsonc
{
  "schema_version": 1,
  "enabled": true,
  "slack": {
    "enabled": true,
    "webhook_url_env": "SLACK_WEBHOOK_URL",
    "events": [
      "pipeline.run.completed",
      "pipeline.run.failed",
      "pipeline.cost.budget_warning"
    ]
  }
}
```

---

## Generic outbound webhook

Send pipeline events to any HTTP endpoint. Supports multiple endpoints, each with independent event filtering and format selection.

### Formats

| Format | Payload shape | Use when |
|---|---|---|
| `generic-json` | `{ "title", "body", "severity", "event_type", "run_id" }` | Custom receivers |
| `slack-compatible` | Slack `{"text": "..."}` shape | Slack-compatible services |
| `discord-compatible` | Discord `{"content": "..."}` shape | Discord-compatible services |
| `teams-card` | MS Teams Adaptive Card | Microsoft Teams |
| `ntfy` | ntfy.sh body | Self-hosted push notifications |
| `plain-text` | Bare text string | Webhooks expecting a plain body |

### Config example

```jsonc
{
  "schema_version": 1,
  "enabled": true,
  "webhook_out": {
    "enabled": true,
    "endpoints": [
      {
        "url": "https://ntfy.sh/my-worca-topic",
        "format": "ntfy",
        "events": ["pipeline.run.completed", "pipeline.run.failed"],
        "headers": { "Priority": "default" }
      },
      {
        "url": "https://my-api.example.com/worca-events",
        "format": "generic-json",
        "events": [
          "pipeline.run.completed",
          "pipeline.run.failed",
          "pipeline.git.pr_created"
        ],
        "headers": {
          "Authorization": "Bearer <token>",
          "X-Source": "worca"
        }
      }
    ]
  }
}
```

### Generic-JSON payload shape

```json
{
  "title": null,
  "body": "✓ run-abc done · 4m32s · $0.87",
  "severity": "success",
  "event_type": "pipeline.run.completed",
  "run_id": "run-abc",
  "timestamp": "2026-04-17T08:03:36Z"
}
```

---

## Environment variables

All sensitive values (bot tokens, webhook URLs) are **never stored in `config.json`** — only the name of the env var that holds the value. This keeps secrets out of the config file that may be synced across machines or committed to a dotfiles repo.

| Config field | Env var name (example) | Holds |
|---|---|---|
| `telegram.bot_token_env` | `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `discord.bot_token_env` | `DISCORD_BOT_TOKEN` | Discord bot token |
| `slack.webhook_url_env` | `SLACK_WEBHOOK_URL` | Slack incoming webhook URL |
| `webhook_secret_env` | `WORCA_WEBHOOK_SECRET` | Single HMAC signing secret |
| `webhook_secrets_env` | `WORCA_WEBHOOK_SECRETS` | Comma-separated HMAC secrets |

Set these in your shell profile (`.zshrc`, `.bashrc`) or the process environment before starting the UI server.

---

## Security model

> **Bot token = shell trust.** Anyone who can send a message from your allowlisted Telegram chat ID can run `/pause`, `/resume`, and `/stop` on your pipelines. Treat losing access to your Telegram account (or your bot token) the same as losing shell access to the machine running worca.

### Allowlist

The `chat_id` (Telegram) and `channel_id` (Discord) values in your config form the allowlist. Messages from any other chat ID are silently ignored — no response is sent.

### HMAC signing

Pipelines sign events with a secret when `worca.webhooks[].secret` is set in `.claude/settings.json`. Integrations verify that signature before processing any event.

To configure signing:
1. Choose a random secret (e.g. `openssl rand -hex 32`).
2. Add it to every project's `settings.json` under `worca.webhooks`:
   ```json
   "webhooks": [{ "url": "...", "secret": "my-secret" }]
   ```
3. Set the env var and reference it in `config.json`:
   ```
   export WORCA_WEBHOOK_SECRET=my-secret
   ```
   ```json
   "webhook_secret_env": "WORCA_WEBHOOK_SECRET"
   ```

### `strict_inbox_verification` (recommended for multi-user machines)

By default, the inbox handler (`POST /api/webhooks/inbox`) accepts events from any caller — the pre-existing behavior, unchanged for backwards compatibility.

Setting `"strict_inbox_verification": true` in `config.json` makes the inbox handler **reject any event that does not carry a valid HMAC signature** matching one of the configured secrets. This closes the pre-existing security gap where any local process could inject fake pipeline events.

**Before enabling strict mode**, ensure every project's pipeline has a `worca.webhooks[].secret` configured and all those secrets are enrolled in `webhook_secret_env` / `webhook_secrets_env`. Otherwise legitimate pipeline events will be rejected.

```jsonc
{
  "schema_version": 1,
  "enabled": true,
  "webhook_secret_env": "WORCA_WEBHOOK_SECRET",
  "strict_inbox_verification": true,
  ...
}
```

**Recommended for:** shared development machines, server deployments, any environment where untrusted local processes could reach the UI server port.

---

## Per-adapter event filtering

Each adapter has its own `events` array. The same event can go to multiple adapters, or you can send different subsets to each:

```jsonc
{
  "telegram": {
    "events": [
      "pipeline.run.completed",
      "pipeline.run.failed",
      "pipeline.circuit_breaker.tripped",
      "pipeline.cost.budget_warning"
    ]
  },
  "slack": {
    "events": [
      "pipeline.git.pr_created",
      "pipeline.git.pr_merged"
    ]
  }
}
```

Leave the `events` array empty (`[]`) to suppress all notifications for that adapter while keeping it configured for inbound commands (Telegram).

---

## Checking health

```bash
worca integrations status
```

Probes `http://127.0.0.1:3400/api/integrations/status` and prints a summary table. Uses the `WORCA_UI_URL` env var if the UI is on a non-default port:

```bash
WORCA_UI_URL=http://127.0.0.1:3401 worca integrations status
```

Sample output when integrations are enabled:

```
Integrations: enabled
Strict inbox verification: false
Secrets configured: 1

Adapters:
  telegram   connected   dropped=0   invalid_sigs=0   last_event=2026-04-17T08:03Z

Chats:
  telegram   123***789   project=worca-cc   muted=no
```

---

## Rate limiting

Each adapter has an independent token-bucket rate limiter (default: 20 messages/minute). Messages that exceed the limit are dropped with a console warning. Adjust with `rate_limit_per_min` in the adapter config:

```jsonc
"telegram": {
  "rate_limit_per_min": 5
}
```

---

## Muting

Send `/mute` from Telegram to silence notifications for the current chat. Optionally specify a duration:

```
/mute 1h     — mute for 1 hour
/mute 30m    — mute for 30 minutes
/mute 2d     — mute for 2 days
/unmute      — restore immediately
```

Muted events are counted and reported in `worca integrations status`.
