# slack-chat

Two-way Slack channel for worca-cc via **Socket Mode**: pipeline notifications
out (run done / failed / paused, **approval needed**), chat commands in
(`/status`, `/runs`, `/pause`, `/stop`, `/resume`, `/approve`, `/retry`,
`/answer <n>`, `/mute 30m`, `/help` — plain messages, not Slack slash-commands),
and opt-in **freeform chat** with worca's Ask engine in Slack threads.

Transport: a persistent WebSocket the worker dials **out** to Slack — no public
URL, no Events API endpoint, no Interactivity request URL, no tunnel.

## Setup (api.slack.com/apps)

1. **Create an app** (from scratch) in your workspace.
2. **Socket Mode** → enable. Create an **App-Level Token** with scope
   `connections:write` → this is your `xapp-…` **App-level token**.
3. **OAuth & Permissions** → Bot Token Scopes:
   - `chat:write` — post, edit and send private notes (outbound);
   - `channels:history` — read messages in public channels (inbound, and freeform replies without a mention);
   - `groups:history` — the same for private channels, only if you use one;
   - `app_mentions:read` — the mention that starts a freeform chat;
   - `reactions:write` — the bot's status reactions (⏳ ✅ ❌ ⏹️);
   - `files:read` — files on a message, its thread root and history (chat context).

   Install (or reinstall after adding scopes) to the workspace → copy the
   **Bot User OAuth Token** (`xoxb-…`).
4. **Event Subscriptions** → enable, subscribe to bot events
   `message.channels` (+ `message.groups` for private channels) and
   `app_mention`. With Socket Mode on, no Request URL is required.
5. **Interactivity & Shortcuts** → turn **Interactivity** on (needed for
   freeform chat's buttons, selects and text boxes). With Socket Mode on, there
   is no Request URL to fill in: clicks arrive over the same socket.
6. Install the plugin and paste both tokens (or use
   `{"$env":"SLACK_BOT_TOKEN"}` / `{"$env":"SLACK_APP_TOKEN"}`):

   ```bash
   worca plugin link plugins/slack-chat
   ```
7. `/invite @your-bot` into the channel(s); channel IDs (`C…`) are in the
   channel's *About* tab. Fill **Notify channel IDs** and — for commands —
   **Allowed channel IDs**. Test from *Settings → Chat notifications*.

## Sending commands

Commands are plain messages, not Slack slash commands. Address the bot:
`@worca /approve *ab12` (Slack delivers it as `<@U…> /approve *ab12`, which
worca understands). A bare message starting with `/` is intercepted by Slack
as a slash command; a leading space (` /approve`) also works.

## Freeform chat (opt-in)

With **Freeform chat** set to `on`, mentioning the bot in a top-level message of an Allowed channel starts a Slack thread
under your message and binds it to a worca Ask chat. The thread is one conversation: the same history, model session and
cost accounting as a chat in the browser, and it shows up in the owner's worca chat list. Reply in the thread to
continue; no mention is needed there. A header message at the top of the thread names the active scope (No project, a
project or a workspace) and carries a **Scope** select, **New conversation** and **Stop**. New conversation disappears
for good once a scope is picked (a failed pick changes nothing). Replies are rendered as Slack mrkdwn.

Native controls come only from the structured cards worca stores for the chat, never from the model's prose:

| Card | In Slack |
|---|---|
| Run proposal for a project, a workspace or No project (including "on the source branch" and an issue-backed proposal from a task source, which shows its task) | **Start run**, **Not now**, **Request changes** (a text box, then a normal reply; the proposal stays pending), Open in worca |
| Project ask | A select menu of the candidates plus "Continue without project" |
| Question with a bounded choice | A select menu |
| Question with a free-text answer | An **Answer** button that opens a text box, or just reply in the thread |
| Run progress, receipts | A summary and Open in worca |
| Everything else (presets, schedules, shapes, attachments, workflows, forms, diffs, scripts, Actions, clone, proxy, ...) | A "needs worca" line that names what needs worca, and Open in worca (without a **Worca address for links**, a line on how to open worca instead). The card **stays pending** in worca; Slack never accepts or drops it |

A Start run that needs a confirmation the browser would ask for (a sync choice, a team policy reason or cap, an
unguarded-engine consent) is not answered from Slack: it links this conversation in worca (or says how to open it) and
the card stays pending. A typed "ok" is a message, not a Start: only the button starts a run. A button that was already
used, or belongs to an older version of a card, answers "This control is no longer valid" and changes nothing.
Run status arrives as messages in the thread (started, questions, finished, failed, paused).

### Setup

1. Add the scopes and events above (`app_mentions:read`, `reactions:write`, `app_mention`) and turn **Interactivity**
   on; reinstall the app so the new scopes apply.
2. In worca set **Freeform chat** to `on`, fill **Freeform chat members** and, if you want links, **Worca address for
   links**. The channel must be listed in **Allowed channel IDs**.

**Freeform chat members** is a list of `slackMemberId=worca identity` pairs, comma or newline separated, for example
`U0123ABCDE=ada@example.com` (profile → ⋮ → *Copy member ID*). Only listed people can start or continue a freeform chat
or press its controls.

### Where it works

- A mention in a top-level message of a channel starts a chat in a new thread under it. A mention inside an existing
  thread starts a conversation in THAT thread (Slack has no nested threads); its first message is quoted to worca as
  context.
- Direct messages are not supported for freeform chat (commands in a DM work as before).
- A command (`/status`, ...) typed inside a freeform thread acts for the parent channel and answers in the thread.

### Security

- Only the person who started a thread controls it. Other members' messages in the thread are ignored (no paid turn);
  their clicks get a private "Only <owner> can act on this conversation."
- Both lists apply. A person must be in **Freeform chat members** and, when **Allowed user IDs** is set, in that list
  too. A person missing from Allowed user IDs gets no reply at all, exactly as for commands; a person missing from
  Freeform chat members gets one "not set up" reply per 10 minutes.
- The identity mapping is an operator assertion. It decides who worca records for the chat, for card actions and for
  runs (use the person's real worca sign-in on a shared deployment, or `local`). What the chat itself may see (run
  presets, "my runs") follows the deployment exactly as in the browser.
- With the credential broker on, a chat locked to a non-Claude engine, or a person without their own key, is refused
  exactly as in the browser.
- Threads are visible to the channel's members. Do not use a channel that people outside the team can read. The Scope
  select lists project and workspace names to the thread.
- Shell commands, scripts and Actions are never run from Slack. This is enforced in worca (a chat bound to a chat app
  runs without agent mode), not only in the prompt. Do those in worca.
- Model credentials and tools stay on the worca host. Model output never pings anyone: `<!channel>`, `<!here>` and
  user mentions are escaped before posting.
- Cost: every message is a paid model turn under worca's global cost limit, limited to 6 per minute per person.

### Context: thread root, history and files (0.4.0)

- **Thread root.** A mention inside an existing thread quotes the thread's first message (with its files) to worca as
  context. The worker reads it (`conversations.replies`) only for a listed **Freeform chat member** in an **Allowed
  channel**; anybody else's mention costs no API call.
- **History** (opt-in, **Read recent history when a conversation starts**: off, 5, 10, 20 or 50). The first turn also
  quotes that many earlier messages, oldest first. A start inside a thread reads the thread's earlier replies; a
  top-level start reads the channel. Only in Allowed channels, never in direct messages; other bots' messages and joins
  are skipped, worca's own are kept.
- **Files** on the message, the thread root and history are saved as chat attachments. The worker downloads them with
  the bot token (`files:read`); the token and file addresses never leave the worker. External files, Slack Connect
  files and files hidden by the plan's history limit are listed by name with why. The same caps as Discord apply: 25 MB
  per file, 4 files per message, 8 files and 50 MB per message with its context.
- **Authors** are the display name when Slack includes it, else the member ID (`U0123ABCD`). No `users:read` scope is
  needed.
- All of it is untrusted data: worca quotes it to the model, never obeys it.

### Live status while worca works (0.4.0)

- While worca works, the thread shows a "⏳ Working on it…" message that is edited with progress (`chat.update`) and
  then into the answer. An answer longer than one Slack section continues in new replies in the thread.
- A Slack rate limit on an edit is waited out up to 10 seconds; a longer one goes back to worca, which waits it.
- If worca restarts mid-turn, the status message is edited to "⏹️ Interrupted — send your message again."
- Slack has **no typing indicator** for bots in channels, so the status message is the only live signal.

### Behavior notes

- Replies arrive when complete rather than streaming.
- Delivery is at-least-once: after a crash a message part can repeat.
- The bot remembers the newest 2000 threads it opened (across restarts). An older thread stops being a conversation:
  start a new one with a mention.
- With the plugin's advanced **Listen filter** set, the bot still hears the threads it opened itself.
- **Reactions.** The bot marks each message it accepted with its own reaction: ⏳ (`hourglass_flowing_sand`) while
  worca works on it, then ✅ (`white_check_mark`) once the reply (or the command's answer, or the new thread's header
  for a bare mention) was posted, ❌ (`x`) when it failed, ⏹️ (`black_square_for_stop`) when it was stopped. A
  refusal (busy, rate limit, cost limit, sign-in or engine gate, a command refused with a warning) only removes ⏳: its
  posted explanation is the answer. Messages from other people in your thread, other bots, edits, chatter, unknown
  commands and replayed events get no reaction. Only the bot's own reactions are added or removed.
- Without the `reactions:write` scope, messages are handled exactly as before and worca logs the refusal once. A Slack
  rate limit with a long Retry-After is waited out by worca in order; a deleted message is skipped.
- Reactions are remembered in memory only: if worca restarts while a reply is in progress, that message can keep ⏳.

## Security

**A bot in an allowed channel is control of worca-cc** (approve gates,
stop/pause runs). `allowedChatIds` is deny-by-default (empty = no inbound
commands). Tokens travel only over stdin to the sandboxed worker child;
host-side redaction scrubs them from logs.

`allowedUserIds` (optional) narrows an allowed chat to named senders; everyone
else in it is ignored. `/direct` and the answer commands (`/answer`, `/approve`, `/retry`, `/abort`,
`/cancel`) steer a live run, so in a group chat they are accepted only from those senders unless `directInGroups` is `anyone`; a direct
message to the bot always works.

## Behavior notes

- Envelopes (messages, clicks, text-box submits) are **acked before processing**
  (Slack's 3s deadline), never after a model turn; an ack that is lost to a
  dying socket simply redelivers the event on reconnect, and the redelivery is
  dropped as a duplicate.
- `disconnect` frames (e.g. `refresh_requested`) are routine: the worker
  reopens with a fresh URL. Socket errors reconnect on a 1s/5s/30s ladder.
- Own/bot messages and message subtypes (edits, deletes, joins) are ignored.
- Outbound is mrkdwn text split at 4000 chars; a message with controls is Block
  Kit (a section of up to 3000 chars plus its buttons).
