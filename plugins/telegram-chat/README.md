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
   worca plugin link plugins/telegram-chat   # dev; or install by repo URL
   ```

   Then in the UI: *Marketplace → telegram-chat → Settings* — paste the **Bot
   token** (or set `{"$env":"TELEGRAM_BOT_TOKEN"}` and export the var).
3. **Find your chat ID**: send `/whoami` to the bot from the chat, then read
   the ID from *Settings → Chat notifications* ("Ignored /whoami from chat …").
   Add it to **Allowed chat IDs** (and **Notify chat IDs** for notifications).
   Groups have negative IDs. If the chat is already in **Notify chat IDs**,
   worca also replies in the chat that it is not allowed yet and names its ID.

   Don't run `worca plugin channel telegram-chat main` while the worca UI is
   up: it becomes a second poller and steals the updates.
4. **Notify chat IDs** is outbound; **Allowed chat IDs** is inbound (chat
   commands).
5. *Settings → Chat notifications* — pick which events notify, hit **Test**.

## Commands do nothing?

- **Allowed chat IDs is empty** (or lacks this chat). Empty means nobody may
  send commands. A notified chat gets a one-line hint naming its ID;
  *Settings → Chat notifications* shows "Commands are off" and the last
  ignored command.
- **`HTTP 409` badge**: another poller (a second worca, `worca plugin
  channel`) or a webhook is using this bot token. Stop the other poller; if
  you set a webhook yourself, remove it with
  `https://api.telegram.org/bot<token>/deleteWebhook`. worca never deletes it
  for you.
- **Group privacy mode**: in a group, the bot only sees commands addressed to
  it — use `/approve@yourbot`.

## Security

**A bot token, or membership in an allowed chat, is control of worca-cc**:
approving gates, stopping/pausing runs, reading run titles and costs.

- `allowedChatIds` is **deny-by-default**: empty means *no* inbound commands.
- The worker child runs with a scrubbed environment ({PATH, HOME}); the token
  travels only over stdin and never reaches logs (host-side redaction).
- Notifications are rate-limited host-side (default 20 msg/min). Command
  replies are not rate-limited by the host — inbound is bounded by the
  allowlist; the worker's retry ladder absorbs platform 429s.

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
