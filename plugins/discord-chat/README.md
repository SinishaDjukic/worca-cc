# discord-chat

Two-way Discord channel for worca-cc: pipeline notifications out (run done /
failed / paused, **approval needed**), chat commands in (`/status`, `/runs`,
`/pause`, `/stop`, `/resume`, `/approve`, `/retry`, `/answer <n>`, `/mute 30m`,
`/help` — plain messages, not Discord slash-commands).

Transport: a persistent **Gateway** websocket the worker dials out to Discord —
no public URL, no interactions endpoint, no tunnel. Zero npm dependencies
(Node ≥ 22's built-in WebSocket).

## Setup (discord.com/developers/applications)

1. **New Application** → **Bot**: copy the **Token**.
2. **Privileged Gateway Intents**: enable **MESSAGE CONTENT INTENT** (required
   for inbound commands; bots in ≥100 servers need verification for it — this
   single-user bot won't be). Without it, messages arrive with empty content —
   the worker logs a hint.
3. **Invite the bot**: OAuth2 → URL Generator → scope `bot`, permissions
   *View Channels*, *Send Messages*, *Read Message History* → open the URL,
   pick your server.
4. **Channel IDs**: Settings → Advanced → Developer Mode on, then right-click a
   channel → *Copy Channel ID*.
5. Install + configure:

   ```bash
   worca plugin link plugins/discord-chat
   ```

   Paste the token (or `{"$env":"DISCORD_BOT_TOKEN"}`), fill **Notify channel
   IDs** and — for commands — **Allowed channel IDs**. Test from *Settings →
   Chat notifications*.

## Security

**A bot token, or write access to an allowed channel, is control of worca-cc**
(approve gates, stop/pause runs). `allowedChatIds` is deny-by-default. The
token travels only over stdin to the sandboxed worker child; host-side
redaction scrubs it from logs.

## Behavior notes

- Full Gateway lifecycle: identify with intents 33281
  (GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT), heartbeat with ACK tracking
  (missed ACK → resume), `resume_gateway_url` + seq resume, `RECONNECT` /
  `INVALID_SESSION` handling, 1s/5s/30s reconnect ladder.
- Close code **4004** (bad token) and **4014** (intents toggle off) stop the
  retry loop with an actionable status — restarting cannot fix them.
- Bot/own messages are ignored; DMs are out of scope for v1 (guild channels
  only).
- Outbound is standard markdown split at 2000 chars; REST 429s honor
  `retry_after`.
