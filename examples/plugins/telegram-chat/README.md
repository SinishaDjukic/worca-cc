# telegram-chat

Two-way Telegram channel for worca-cc: pipeline notifications out (run done /
failed / paused, **approval needed** with reply instructions), chat commands in
(`/status`, `/runs`, `/pause`, `/stop`, `/resume`, `/approve`, `/retry`,
`/answer <n>`, `/mute 30m`, `/help`).

Transport: long-polling `getUpdates` — **no public URL, no webhook, no tunnel**.
The worker runs as a persistent child process supervised by the worca-cc UI
server and dials out to `api.telegram.org` only.

## Setup

1. **Create a bot**: message [@BotFather](https://t.me/BotFather) → `/newbot` →
   copy the token (`123456:ABC-…`).
2. **Install + configure**:

   ```bash
   worca plugin link examples/plugins/telegram-chat   # dev; or install by repo URL
   ```

   Then in the UI: *Plugins → telegram-chat → Settings* — paste the **Bot
   token** (or set `{"$env":"TELEGRAM_BOT_TOKEN"}` and export the var).
3. **Find your chat ID**: open a chat with the bot (or add it to a group) and
   send any message. Then:

   ```bash
   worca plugin channel telegram-chat main   # foreground worker, prints inbound frames
   ```

   The inbound frame shows `chatId`. Groups have negative IDs.
4. Put that ID into **Notify chat IDs** (outbound) and — if you want chat
   commands — **Allowed chat IDs** (inbound).
5. *Settings → Chat notifications* — pick which events notify, hit **Test**.

## Security

**A bot token, or membership in an allowed chat, is control of worca-cc**:
approving gates, stopping/pausing runs, reading run titles and costs.

- `allowedChatIds` is **deny-by-default**: empty means *no* inbound commands.
- The worker child runs with a scrubbed environment ({PATH, HOME}); the token
  travels only over stdin and never reaches logs (host-side redaction).
- Notifications and commands are rate-limited host-side (default 20 msg/min).

## Behavior notes

- Inbound is **at-least-once** across worker restarts (the update cursor is
  persisted host-side after each batch): `/status`-class commands are
  idempotent; destructive commands reply with what they did.
- `edited_message` updates are ignored (edits replaying commands is a foot-gun).
- `/cmd@other_bot` group commands addressed to other bots are dropped;
  `/cmd@this_bot` works.
- Long messages split at 4096 chars on line boundaries.

## Offline dev

```bash
WORCA_MOCK=1 worca plugin channel telegram-chat main --check   # canned validateConfig
worca plugin channel telegram-chat main --check                # real getMe
worca plugin channel telegram-chat main                        # live worker in the foreground
```
