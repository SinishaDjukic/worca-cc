# telegram-chat

Two-way Telegram channel for worca-cc: pipeline notifications out (run done /
failed / paused, **approval needed** with reply instructions), chat commands in
(`/status`, `/runs`, `/pause`, `/stop`, `/resume`, `/approve`, `/retry`,
`/answer <n>`, `/mute 30m`, `/help`), and an opt-in **freeform chat** with
worca's Ask engine that uses inline buttons and reactions.

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

   Then in the UI: *Marketplace → Installed → telegram-chat → Settings* — paste the **Bot
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

## Freeform chat (opt-in)

With **Freeform chat** set to `on`, a person listed in **Freeform chat members** chats with worca's Ask engine. Each
conversation is a worca chat: the same history, model session and cost accounting as a chat in the browser, and it
shows up in the owner's worca chat list. A header message at the top names the active scope (No project, a project or
a workspace) and carries the **Scope** buttons, **New conversation**, **Stop** and **Open in worca**. New conversation
disappears for good once a scope is picked (a failed pick changes nothing). Replies arrive when complete.

Where a conversation lives:

| Where you write | What happens |
|---|---|
| A direct message to the bot | The DM is ONE ongoing conversation: every message that is not a `/command` continues it. **New conversation** on the header starts a fresh worca chat in the same DM. |
| A forum group (topics on), inside a topic | Mentioning the bot binds THAT topic: from then on the owner's messages in the topic continue the conversation. |
| A forum group, in General | Mentioning the bot opens a new topic named after your message; the bot says where under your mention. |
| A group without topics | Mentioning the bot starts a reply thread under the bot's header: reply to any message of that thread to continue it. |

Native controls come only from the structured cards worca stores for the chat, never from the model's prose:

| Card | In Telegram |
|---|---|
| Run proposal for a project, a workspace or No project (including "on the source branch" and an issue-backed proposal from a task source, which shows its task) | **Start run**, **Not now**, **Request changes** (the bot asks you to reply with the change; the proposal stays pending), Open in worca |
| Project ask | A button per candidate plus "Continue without project" |
| Question with a bounded choice | A button per option (8 per page, with ◀ Back / More ▶) |
| Question with a free-text answer | An **Answer** button (the bot asks you to reply with the answer), or just write the answer |
| Run progress, receipts | A summary and Open in worca |
| Everything else (presets, schedules, shapes, attachments, workflows, forms, diffs, scripts, Actions, clone, proxy, ...) | A "needs worca" line and Open in worca (without a **Worca address for links**, a line on how to open worca instead). The card **stays pending** in worca |

A press shows its result as a short notice at the top of the chat ("Done — the message will update shortly.", "This
control is no longer valid. Use the newest message."); an answer that takes longer than two seconds arrives as a reply
instead. A control that was used, replaced or expired never applies twice. Buttons that ask for text send a reply
prompt that mentions you: answer by replying to that prompt (a reply from someone else, or a `/command`, is an ordinary
message). A Start run that needs a confirmation the browser would ask for (a sync choice, a team policy reason or cap,
an unguarded-engine consent) is not answered from Telegram: it links this conversation in worca and the card stays
pending. A typed "ok" is a message, not a Start: only the button starts a run.

### Setup

1. **Privacy mode.** By default a bot in a group only receives commands and replies to its own messages; plain
   messages that mention it are NOT delivered. For group conversations do ONE of:
   - in @BotFather: `/setprivacy` → pick the bot → **Disable**, then remove the bot from the group and add it again
     (the change only applies after re-adding), or
   - make the bot an **administrator** of the group (admin bots receive every message).

   Direct messages always reach the bot. A reply thread continues with privacy mode on (replies to the bot are
   delivered), but starting one, and every forum-topic conversation, needs privacy off or an admin bot.
2. **Forum topics.** To open a topic from a mention in General, the bot must be an administrator with the **Manage
   topics** right. Without it the mention gets "That did not work: cannot open a topic …" and 👎; mentions inside an
   existing topic need no extra right.
3. In worca set **Freeform chat** to `on`, fill **Freeform chat members** and, if you want links, **Worca address for
   links** (an address Telegram can open; it refuses `localhost`, and such messages then go out without the button).
4. **Allowed chat IDs** must list every chat freeform chat may use: the group (negative ID) and, for direct messages,
   each member's DM chat ID, which is their user ID.

**Freeform chat members** is a list of `telegramUserId=worca identity` pairs, comma or newline separated, for example
`123456789=ada@example.com`. Only listed people can start or continue a freeform chat or press its controls.

### Security

- Only the person who started a conversation controls it. Other people's messages in the topic or reply thread are
  ignored (no paid turn, no reply); their presses get "Only the person who started this conversation can act on it."
  Telegram has no private replies: a press's notice shows at the top of the presser's screen, but an answer that comes
  late is posted in the chat.
- Both lists apply. A person must be in **Freeform chat members** and, when **Allowed user IDs** is set, in that list
  too. A person missing from Allowed user IDs gets no reply at all, exactly as for commands; a person missing from
  Freeform chat members gets one "not set up" reply per 10 minutes.
- The identity mapping is an operator assertion. It decides who worca records for the chat, for card actions and for
  runs (use the person's real worca sign-in on a shared deployment, or `local`).
- With the credential broker on, a chat locked to a non-Claude engine, or a person without their own key, is refused
  exactly as in the browser.
- Group conversations are visible to the group's members. Do not use a group that people outside the team can read.
  The Scope buttons list project and workspace names.
- Shell commands, scripts and Actions are never run from Telegram (a chat bound to a chat app runs without agent mode).
- Cost: every message is a paid model turn under worca's global cost limit, limited to 6 per minute per person.

### Reactions

The bot marks each message it accepted with ONE reaction of its own. Telegram allows bots one reaction per message and
only a fixed emoji set, which has none of worca's ⏳ ✅ ❌ ⏹️, so they are shown as:

| worca | Telegram | Meaning |
|---|---|---|
| ⏳ | 👀 | worca is working on it |
| ✅ | 👌 | the reply, the command's answer, or the new conversation's header was posted |
| ❌ | 👎 | it failed |
| ⏹️ | 🙈 | it was stopped (also a reply cut off by a turn or budget limit) |

A refusal (busy, rate limit, cost limit, sign-in or engine gate, a command refused with a warning) only removes 👀: its
posted explanation is the answer. Messages from other people in your conversation, other bots, chatter, unknown
commands, edits and replayed updates get no reaction. Only the bot's own reaction is set or removed; no admin right is
needed. If a chat restricts reactions, or the message was deleted, the reaction is skipped (logged once) and the
message is handled exactly as before; a Telegram rate limit is waited out. Reactions are remembered in memory only: if
worca restarts while a reply is in progress, that message can keep 👀.

### Behavior notes

- No attachments; replies are not streamed.
- Delivery is at-least-once: after a crash a message part can repeat.
- The bot remembers the topics and reply threads it is part of across restarts (the newest 500 topics and 2000 thread
  messages). A restart in the moment between a mention and the conversation's header answers "mention the bot again".
- A command (`/status`, ...) typed inside a conversation acts for its chat and answers in the conversation. In a forum,
  command replies outside a conversation go to General.
- Buttons older than 48 hours may no longer report which topic they are in; such a press answers that the control is
  no longer valid.

## Security

**A bot token, or membership in an allowed chat, is control of worca-cc**:
approving gates, stopping/pausing runs, reading run titles and costs.

- `allowedChatIds` is **deny-by-default**: empty means *no* inbound commands.
- `allowedUserIds` (optional) narrows an allowed chat to named senders; everyone
  else in it is ignored. `/direct` and the answer commands (`/answer`, `/approve`, `/retry`, `/abort`,
  `/cancel`) steer a live run, so in a group chat they are accepted only from those senders unless `directInGroups` is `anyone`; a direct
  message to the bot always works.
- The worker child runs with a scrubbed environment ({PATH, HOME}, the proxy and
  CA variables, never a proxy URL with credentials); the token travels only over
  stdin and never reaches logs (host-side redaction).
- Notifications are rate-limited host-side (default 20 msg/min). Command
  replies are not rate-limited by the host — inbound is bounded by the
  allowlist; the worker's retry ladder absorbs platform 429s.

## Behavior notes

- Inbound is **at-least-once** across worker restarts (the update cursor is
  persisted host-side after each batch): `/status`-class commands are
  idempotent; destructive commands reply with what they did.
- `edited_message` updates are ignored (edits replaying commands is a foot-gun).
- `/cmd@other_bot` group commands addressed to other bots are dropped;
  `/cmd@this_bot` works. Messages from other bots are ignored.
- Long messages split at 4096 chars on line boundaries.

## Offline dev

```bash
WORCA_MOCK=1 worca plugin channel telegram-chat main --check   # canned validateConfig
worca plugin channel telegram-chat main --check                # real getMe
worca plugin channel telegram-chat main                        # live worker in the foreground
```
