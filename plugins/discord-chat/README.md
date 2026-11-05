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
   *View Channels*, *Send Messages*, *Read Message History*, *Add Reactions* → open the URL,
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

## Sending commands

Commands are plain messages: both `/approve` and `@worca /approve` work
(Discord delivers the mention as `<@123> /approve`). The channel must be a
server channel — the bot has no DM intent.

## Freeform chat (opt-in)

With **Freeform chat** set to `on`, mentioning the bot in an Allowed channel opens a Discord thread off your message and
binds it to a worca Ask chat. The thread is one conversation: the same history, model session and cost accounting as a
chat in the browser, and it shows up in the owner's worca chat list. A header message at the top of the thread names the
active scope (No project, a project or a workspace) and carries a **Scope** select, **New conversation** and **Stop**.
New conversation disappears for good once a scope is picked (a failed pick changes nothing). Replies are rendered as
markdown.

Native controls come only from the structured cards worca stores for the chat, never from the model's prose:

| Card | In Discord |
|---|---|
| Run proposal for a project, a workspace or No project (including "on the source branch" and an issue-backed proposal from a task source, which shows its task) | **Start run**, **Not now**, **Request changes** (a text box, then a normal reply; the proposal stays pending), Open in worca |
| Project ask | A select menu of the candidates plus "Continue without project" |
| Question with a bounded choice | A select menu |
| Question with a free-text answer | An **Answer** button that opens a text box, or just reply in the thread |
| Run progress, receipts | A summary and Open in worca |
| Everything else (presets, schedules, shapes, attachments, workflows, forms, diffs, scripts, Actions, clone, proxy, ...) | A "needs worca" line that names what needs worca, and Open in worca (without a **Worca address for links**, a line on how to open worca instead). The card **stays pending** in worca; Discord never accepts or drops it |

A Start run that needs a confirmation the browser would ask for (a sync choice, a team policy reason or cap, an
unguarded-engine consent) is not answered from Discord: it links this conversation in worca (or says how to open it) and
the card stays pending. A typed "ok" is a message, not a Start: only the button starts a run.
Run status arrives as messages in the thread (started, questions, finished, failed, paused).

### Setup

1. Developer Portal, OAuth2 URL generator: add the permissions **Create Public Threads**, **Send Messages in
   Threads** and **Add Reactions** to the invite URL (re-invite the bot if it was added without them).
2. In worca set **Freeform chat** to `on`, fill **Freeform chat members** and, if you want links, **Worca address for
   links**. The channel must be listed in **Allowed channel IDs**.
3. No Interactions Endpoint URL is needed: buttons and selects arrive over the Gateway. If one is set in the Developer
   Portal, remove it, because Discord then sends interactions there instead.

**Freeform chat members** is a list of `discordUserId=worca identity` pairs, comma or newline separated, for example
`123456789012345678=ada@example.com`. Only listed people can start or continue a freeform chat or press its controls.

### Context: replies, channel history and files (0.4.0)

- **Replies.** Reply to any message and mention the bot (or reply inside a worca thread): worca sends the replied-to
  message along with yours — author, time, text, link and its files. The model sees it as quoted context, never as
  your words; the worca chat shows it as a collapsed "Context from Discord" block above your message. Inside a worca
  thread, a reply to worca's own message is not quoted (it is already in the conversation), so replying to a question
  answers it.
- **Recent history (opt-in).** *Read recent history when a conversation starts* (`off` by default; 5, 10, 20 or 50
  messages): the first reply of a new conversation also quotes that many messages of the channel before the mention,
  oldest first. Only in Allowed channels, never in direct messages; other bots' messages are skipped (worca's own stay).
  Later messages in the thread read no history.
- **Files.** Files on your message, on the replied-to message and on the history messages are downloaded by worca —
  only from Discord's file hosts (`cdn.discordapp.com`, `media.discordapp.net`, declared in the plugin manifest as
  `attachmentHosts`) — and saved as attachments of the chat, so the model can read them and they show in worca.
  Limits: the chat attachment types worca accepts (text, images, PDF; what the chat's engine can view), **25 MB per
  file, 4 files per Discord message, 8 files and 50 MB per message with its context**. A file that is too large, of
  another type, or fails to download is listed by name with the reason; the reply still goes ahead.
- **Permissions.** Reading a replied-to message the event did not include, and reading history, need **Read Message
  History** — already in the invite above. Without it the reply or history is left out (and the log says why).
- Everything quoted is treated as untrusted data: text that looks like an instruction is never followed.

### Live status while worca works (0.5.0)

A reply can take a while. As soon as a message starts a turn (the mention that opens a conversation with words, any
later message in the thread, and a typed answer to an open question that starts a follow-up), the bot posts
"⏳ Working on it… this message will update." in the thread and shows **is typing…** (refreshed every 8 seconds
while the turn runs).

- **While it runs** the same message is edited with the elapsed time and what worca is doing, in plain words:
  "Reading files…", "Running a command…", "Looking at run 1234abcd…", "Writing the answer…". Tool arguments, paths and
  text are never shown. At most one edit every 5 seconds, and only when the text changed; when Discord answers 429,
  worca waits the `retry_after` it names.
- **When the answer is ready** the status message becomes its first part, with its buttons if it has any. Further
  parts and cards follow as new messages, as before, and your message's reaction still goes ✅. If the status message
  was deleted or cannot be edited (permissions), the answer is posted as a new message instead, exactly once.
- **Failure, Stop, busy or a cost-limit refusal**: the status message becomes the usual explanation ("That did not
  work: …", "Stopped before any reply.", "Chat is still replying…"). It is never left saying "working".
- **Restarts.** The status message is remembered with the conversation. After a worca restart or a worker
  reconnect, one that is still marked working is edited to "⏹️ Interrupted — send your message again." (or into
  the answer, if it finished just before the restart).
- The manifest declares this as `capabilities.liveStatus`; a chat plugin without it keeps the old behaviour (no
  status message, the answer arrives as new messages). It uses the permissions you already gave the bot (Send
  Messages in Threads).

### Security

- Only the person who started a thread controls it. Other members' messages in the thread are ignored (no paid turn);
  their clicks get a private "Only <owner> can act on this conversation."
- Both lists apply. A person must be in **Freeform chat members** and, when **Allowed user IDs** is set, in that list
  too. A person missing from Allowed user IDs gets no reply at all, exactly as for commands; a person missing from
  Freeform chat members gets one "not set up" reply per 10 minutes.
- The identity mapping is an operator assertion. It decides who worca records for the chat, for card actions and for
  runs (use the person's real worca sign-in on a shared deployment, or `local`). What the chat itself may see (run
  presets, "my runs") follows the deployment exactly as in the browser: on a local install the chat sees what the
  local browser sees.
- With the credential broker on, a chat locked to a non-Claude engine, or a person without their own key, is refused
  exactly as in the browser.
- Threads are visible to the channel's members. Do not use a channel that people outside the team can read. The Scope
  select lists project and workspace names to the thread.
- Shell commands, scripts and Actions are never run from Discord. This is enforced in worca (a chat bound to Discord
  runs without agent mode), not only in the prompt. Do those in worca.
- Model credentials and tools stay on the worca host. Interaction tokens never leave the plugin process.
- Cost: every message is a paid model turn under worca's global cost limit, limited to 6 per minute per person.

### Behavior notes

- No DMs (unchanged). Replies arrive when complete rather than streaming; the live status message shows progress until then.
- Delivery is at-least-once: after a crash a message part can repeat.
- With the plugin's advanced **Channel allowlist** set, the bot still hears the threads it opened itself (it remembers
  them across restarts); other threads under an allowed channel stay filtered. It remembers the newest 500 threads.
- A command (`/status`, ...) typed inside a freeform thread acts for the parent channel and answers in the thread.
- A freeform conversation opened in worca's browser chat runs without agent mode (no shell commands, no shared
  terminal), the same rule as in Discord. Start a separate worca chat for that.
- **Reactions.** The bot marks each message it accepted with its own reaction: ⏳ while worca works on it, then ✅ once
  the reply (or the command's answer, or the new thread's header for a bare mention) was posted, ❌ when it failed,
  ⏹️ when it was stopped (also a reply cut off by a turn or budget limit). A reply that asks a question or proposes a run counts as posted; the run itself still waits
  for Start. A refusal (busy, rate limit, cost limit, sign-in or engine gate, a command refused with a warning) only
  removes ⏳: its posted explanation is the answer (a `/pause` or `/stop` that worked still gets ✅). Messages from
  other people in your thread, other bots, chatter, unknown commands and replayed events get no reaction. Only the
  bot's own reactions are added or removed.
- The bot needs **Add Reactions** and **Read Message History** for this. Without them messages are handled exactly
  as before and worca logs the refusal once (once per channel for missing permissions).
- Reactions are remembered in memory only: if worca restarts, or the chat is deleted in worca, while a reply is in
  progress, that message can keep ⏳. So can a worker or Discord outage that outlasts the reaction retries (about
  12 seconds): a message can then keep ⏳, or show ⏳ beside its final mark.
  A message answering a question whose follow-up is queued behind another reply keeps ⏳ until that follow-up arrives.

## Security

**A bot token, or write access to an allowed channel, is control of worca-cc**
(approve gates, stop/pause runs). `allowedChatIds` is deny-by-default. The
token travels only over stdin to the sandboxed worker child; host-side
redaction scrubs it from logs.

`allowedUserIds` (optional) narrows an allowed chat to named senders; everyone
else in it is ignored. `/direct` and the answer commands (`/answer`, `/approve`, `/retry`, `/abort`,
`/cancel`) steer a live run, so in a group chat they are accepted only from those senders unless `directInGroups` is `anyone`. The bot
reads guild channels only: it does not request the DIRECT_MESSAGES intent, so a direct message to the bot is not delivered.

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
