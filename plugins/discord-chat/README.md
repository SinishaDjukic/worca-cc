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

## Sending commands

Commands are plain messages: both `/approve` and `@worca /approve` work
(Discord delivers the mention as `<@123> /approve`). The channel must be a
server channel — the bot has no DM intent.

## Freeform chat (opt-in)

With **Freeform chat** set to `on`, mentioning the bot in an Allowed channel opens a Discord thread off your message and
binds it to a worca Ask chat. The thread is one conversation: the same history, model session and cost accounting as a
chat in the browser, and it shows up in the owner's worca chat list. A header message at the top of the thread names the
active scope (No project, a project or a workspace) and carries three controls: a **Scope** select, **New conversation**
and **Stop**. Replies are rendered as markdown.

Native controls come only from the structured cards worca stores for the chat, never from the model's prose:

| Card | In Discord |
|---|---|
| Run proposal for a project, a workspace or No project (including "on the source branch") | **Start run**, **Not now**, **Request changes** (a text box, then a normal reply; the proposal stays pending), Open in worca |
| Project ask | A select menu of the candidates plus "Continue without project" |
| Question with a bounded choice | A select menu |
| Question with a free-text answer | An **Answer** button that opens a text box, or just reply in the thread |
| Run progress, receipts | A summary and Open in worca |
| Everything else (presets, schedules, shapes, attachments, workflows, forms, diffs, scripts, Actions, clone, proxy, ...) | A "needs worca" line and Open in worca. The card **stays pending** in worca; Discord never accepts or drops it |

A Start run that needs a confirmation the browser would ask for (a sync choice, a team policy reason or cap, an
unguarded-engine consent) is not answered from Discord: it says "Open in worca to confirm" and the card stays pending.
Run status arrives as messages in the thread (started, questions, finished, failed, paused).

### Setup

1. Developer Portal, OAuth2 URL generator: add the permissions **Create Public Threads** and **Send Messages in
   Threads** to the invite URL (re-invite the bot if it was added without them).
2. In worca set **Freeform chat** to `on`, fill **Freeform chat members** and, if you want links, **Worca address for
   links**. The channel must be listed in **Allowed channel IDs**.
3. No Interactions Endpoint URL is needed: buttons and selects arrive over the Gateway. If one is set in the Developer
   Portal, remove it, because Discord then sends interactions there instead.

**Freeform chat members** is a list of `discordUserId=worca identity` pairs, comma or newline separated, for example
`123456789012345678=ada@example.com`. Only listed people can start or continue a freeform chat or press its controls.

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

- No DMs (unchanged), no attachments, and replies arrive when complete rather than streaming.
- Delivery is at-least-once: after a crash a message part can repeat.
- With the plugin's advanced **Channel allowlist** set, the bot still hears the threads it opened itself (it remembers
  them across restarts); other threads under an allowed channel stay filtered. It remembers the newest 500 threads.
- A command (`/status`, ...) typed inside a freeform thread acts for the parent channel and answers in the thread.
- A freeform conversation opened in worca's browser chat runs without agent mode (no shell commands, no shared
  terminal), the same rule as in Discord. Start a separate worca chat for that.

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
