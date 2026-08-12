# slack-chat

Two-way Slack channel for worca-cc via **Socket Mode**: pipeline notifications
out (run done / failed / paused, **approval needed**), chat commands in
(`/status`, `/runs`, `/pause`, `/stop`, `/resume`, `/approve`, `/retry`,
`/answer <n>`, `/mute 30m`, `/help` — plain messages, not Slack slash-commands).

Transport: a persistent WebSocket the worker dials **out** to Slack — no public
URL, no Events API endpoint, no tunnel.

## Setup (api.slack.com/apps)

1. **Create an app** (from scratch) in your workspace.
2. **Socket Mode** → enable. Create an **App-Level Token** with scope
   `connections:write` → this is your `xapp-…` **App-level token**.
3. **OAuth & Permissions** → Bot Token Scopes: `chat:write` (outbound),
   `channels:history` (+ `groups:history` for private channels) for inbound.
   Install to workspace → copy the **Bot User OAuth Token** (`xoxb-…`).
4. **Event Subscriptions** → enable, subscribe to bot events
   `message.channels` (+ `message.groups` if needed). With Socket Mode on, no
   Request URL is required.
5. Install the plugin and paste both tokens (or use
   `{"$env":"SLACK_BOT_TOKEN"}` / `{"$env":"SLACK_APP_TOKEN"}`):

   ```bash
   worca plugin link examples/plugins/slack-chat
   ```
6. `/invite @your-bot` into the channel(s); channel IDs (`C…`) are in the
   channel's *About* tab. Fill **Notify channel IDs** and — for commands —
   **Allowed channel IDs**. Test from *Settings → Chat notifications*.

## Security

**A bot in an allowed channel is control of worca-cc** (approve gates,
stop/pause runs). `allowedChatIds` is deny-by-default (empty = no inbound
commands). Tokens travel only over stdin to the sandboxed worker child;
host-side redaction scrubs them from logs.

## Behavior notes

- Envelopes are **acked before processing** (Slack's 3s deadline); an ack that
  is lost to a dying socket simply redelivers the event on reconnect.
- `disconnect` frames (e.g. `refresh_requested`) are routine: the worker
  reopens with a fresh URL. Socket errors reconnect on a 1s/5s/30s ladder.
- Own/bot messages and message subtypes (edits, joins) are ignored.
- Outbound is mrkdwn text (Block Kit is a later upgrade), split at 4000 chars.
