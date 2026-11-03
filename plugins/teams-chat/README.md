# teams-chat

Two-way Microsoft Teams channel for worca-cc via Bot Framework (no SDK):
pipeline notifications out, chat commands in (`/status`, `/pause`, `/approve`,
`/answer <n>`, …), and opt-in **freeform chat** with worca's Ask engine in
channel posts, with Adaptive Card buttons.

Teams is the one platform with **no outbound-connection option**: Bot Framework
only delivers inbound activities to a **public HTTPS endpoint**. worca-cc stays
loopback-only except for one hardened, token-guarded ingress route
(`/api/ingress/teams/...`) that you expose through a tunnel. The worker — not
the host — validates every inbound request's Bot Framework JWT, button clicks
(invokes) included.

**Scope**: replies + proactive messages to conversations the bot has
already seen. Someone must message the bot (or @mention it in a channel) once
before worca-cc can notify that conversation — that first message is also how
you discover the conversation ID.

## Setup

1. **Azure**: create an **Azure Bot** resource (portal.azure.com → Create →
   Azure Bot). Multi-tenant is simplest. Note the **Microsoft App ID**; create
   a **client secret** under the app registration.
2. **Tunnel**: expose the worca-cc server, e.g.

   ```bash
   cloudflared tunnel --url http://127.0.0.1:4317
   ```

   Only `/api/ingress/*` is reachable through it — every other route stays
   loopback-guarded.
3. **Ingress token**: generate one (`openssl rand -hex 24`).
4. **Messaging endpoint** (Azure Bot → Configuration):

   ```
   https://<tunnel-host>/api/ingress/teams/teams-chat/main/<ingressToken>
   ```
5. **Teams channel**: Azure Bot → Channels → add **Microsoft Teams**.
6. **Teams app**: a bot is used in a team's channels only through a Teams app
   package (`manifest.json` + two icons, zipped) uploaded in Teams (Apps →
   Manage your apps → Upload an app) and added to the team. The bot entry:

   ```json
   "bots": [
     {
       "botId": "<Microsoft App ID>",
       "scopes": ["team", "personal", "groupChat"],
       "supportsFiles": false,
       "isNotificationOnly": false
     }
   ]
   ```

   `team` lets the bot hear @mentions in channels (freeform chat and channel
   commands), `personal` is the 1:1 chat with the bot, `groupChat` group
   chats. `supportsFiles` stays `false`: worca takes no file uploads from Teams.
   No new permission and no resource-specific consent is needed: the bot only
   receives messages that @mention it. For a quick 1:1 test without a package,
   the App ID deep link works too:
   `https://teams.microsoft.com/l/chat/0/0?users=28:<appId>`.
7. **Install + configure**:

   ```bash
   worca plugin link plugins/teams-chat
   ```

   Fill App ID / secret / tenant / ingress token. Doctor verifies the AAD
   credentials (inbound wiring is proven by the first received message).
8. **Find the conversation ID**: send any command (e.g. `/whoami`) to the
   bot; worca refuses it and *Settings → Chat notifications* shows "Ignored
   /whoami from chat <id>". That is the conversation ID → put it in
   **Notify conversation IDs** and, for commands, **Allowed conversation IDs**.
   In a channel, send it in a **new post** that @mentions the bot: the ID is
   the channel's (`19:…@thread.tacv2`) and stays the same for every post. A
   command sent as a reply inside a post's replies is that post's own reply
   chain (`19:…;messageid=…`), which is not the channel.

**Upgrading from 0.2.** Version 0.2 showed a channel post's full id
(`19:…@thread.tacv2;messageid=…`) and stored the bot's channel reference under
it. 0.3 moves those stored references to the channel on its own, so a
**Notify conversation IDs** entry with the old full id keeps posting (in that
old post's replies). To post new top-level messages and to allow commands and
freeform chat in the channel, replace the old id with the channel id (the part
before `;messageid=`) in **Notify conversation IDs** and
**Allowed conversation IDs**.

## Freeform chat (opt-in)

With **Freeform chat** set to `on`, a new post in an Allowed channel that
@mentions the bot opens a conversation in that post's replies and binds it to a
worca Ask chat: the same history, model session and cost accounting as a chat in
the browser, and it shows up in the owner's worca chat list. The first reply is
a header card that names the active scope (No project, a project or a
workspace) and carries a **Scope** picker with **Choose**, **New conversation**
and **Stop**. New conversation disappears for good once a scope is picked (a
failed pick changes nothing).

**@mention the bot in every reply.** Teams delivers a channel message to a bot
only when it @mentions the bot (unless the app had the `ChannelMessage.Read.Group`
consent, which this plugin deliberately does not ask for). A reply without the
mention never reaches worca. The mention itself is removed before the model sees
the text; other people's mentions keep their name.

Freeform chat runs in **channels only**. In a personal or group chat with the
bot, commands and notifications work as before, but a message is not a chat
turn.

Native controls come only from the structured cards worca stores for the chat,
never from the model's prose:

| Card | In Teams |
|---|---|
| Run proposal for a project, a workspace or No project (including "on the source branch" and an issue-backed proposal from a task source, which shows its task) | **Start run**, **Not now**, a **What should change?** box with **Request changes** (a normal reply; the proposal stays pending), Open in worca |
| Project ask | A picker of the candidates plus "Continue without project", and **Choose** |
| Question with a bounded choice | A picker and **Choose** |
| Question with a free-text answer | An answer box with **Answer** on the card, or just reply (with the @mention) |
| Run progress, receipts | A summary and Open in worca |
| Everything else (presets, schedules, shapes, attachments, workflows, forms, diffs, scripts, Actions, clone, proxy, ...) | A "needs worca" line and Open in worca (without a **Worca address for links**, a line on how to open worca instead). The card **stays pending** in worca |

Text boxes are on the card itself (Teams has no pop-up dialog for this). A Start
run that needs a confirmation the browser would ask for (a sync choice, a team
policy reason or cap, an unguarded-engine consent) is not answered from Teams:
it links this conversation in worca and the card stays pending. A typed "ok" is
a message, not a Start: only the button starts a run. Run status arrives as
messages in the post's replies (started, questions, finished, failed, paused).

### Setup

1. Add the bot to the team with the app package above (`team` scope).
2. In worca set **Freeform chat** to `on`, fill **Freeform chat members** and,
   if you want links, **Worca address for links**. The channel must be listed in
   **Allowed conversation IDs** (its `19:…@thread.tacv2` id).
3. Buttons use Adaptive Card `Action.Execute` (card version 1.5, with an
   `Action.Submit` fallback for older Teams clients), which arrives on the same
   messaging endpoint: nothing else to configure.

**Freeform chat members** is a list of `entraObjectId=worca identity` pairs,
comma or newline separated, for example
`8a3e1f2b-1234-4cde-9abc-0123456789ab=ada@example.com`. The id is the person's
**Object ID** in Microsoft Entra (Entra admin center → Users → the person →
Object ID), the same id **Allowed user IDs** uses. Only listed people can start
or continue a freeform chat or press its buttons.

### Security

- Only the person who started a conversation controls it. Other members'
  messages in it are ignored (no paid turn); their clicks are answered with
  "Only <name> can act on this conversation."
- Both lists apply. A person must be in **Freeform chat members** and, when
  **Allowed user IDs** is set, in that list too. A person missing from Allowed
  user IDs gets no reply at all, exactly as for commands; a person missing from
  Freeform chat members gets one "not set up" reply per 10 minutes.
- Every request, button clicks included, must carry a valid Bot Framework JWT;
  messages from bots (this one included) are ignored, and a redelivered activity
  is handled once. A used or out-of-date button never applies twice: worca
  answers "This control is no longer valid".
- The identity mapping is an operator assertion. It decides who worca records
  for the chat, for card actions and for runs (use the person's real worca
  sign-in on a shared deployment, or `local`).
- With the credential broker on, a chat locked to a non-Claude engine, or a
  person without their own key, is refused exactly as in the browser.
- Channel posts are visible to the team. Do not use a channel that people
  outside the team can read. The Scope picker lists project and workspace names.
- Shell commands, scripts and Actions are never run from Teams. This is
  enforced in worca (a chat bound to Teams runs without agent mode).
- Cost: every message is a paid model turn under worca's global cost limit,
  limited to 6 per minute per person.

### Behavior notes

- **Button answers.** A click is answered by worca within about 3.5 seconds
  with a short notice only the clicker sees ("Done — the message will update
  shortly.", "Scope: …", "This control is no longer valid. …"). When worca
  needs longer (starting a run), Teams first shows "Got it. worca answers in
  this conversation." and the notice then arrives as a normal reply that
  everyone in the post can see. Older Teams clients that send a click as a
  plain message get every notice as a reply.
- **No reactions.** Teams bots cannot add reactions to people's messages, so
  the ⏳ / ✅ / ❌ / ⏹️ marks the Discord plugin shows do not exist here. While
  worca works on a command in a personal or group chat, the bot shows Teams'
  typing indicator instead. Teams does not show a bot's typing indicator in
  channels, so a freeform conversation shows nothing until the reply is posted.
  A failure is still explained in a reply.
- Cards update in place (the header after a scope change, a proposal after
  Start). Replies are plain text and arrive when complete rather than
  streaming; a long reply is split over several cards.
- Delivery is at-least-once: after a crash a message part can repeat.
- A command (`/status`, ...) typed in a freeform conversation acts for the
  channel and answers in the conversation.
- No attachments, no 1:1 or group-chat freeform chat. Teams does not let bots
  post in private channels, so use a standard channel.

## Security

- The ingress URL is a **capability URL**: the token is compared with a
  timing-safe check host-side; any mismatch is a detail-free 404. Rotate it by
  changing the config + the Azure messaging endpoint.
- The worker validates every inbound JWT: RS256 against Microsoft's JWKS
  (cached, kid-rotation aware), issuer `https://api.botframework.com`,
  audience = your App ID, exp/nbf ±5 min, and the token's `serviceurl` claim
  against the activity's `serviceUrl` (spoof guard). Invalid → 401.
- Inbound is deduplicated on `activity.id` (Bot Framework retries deliveries).
- **An allowed conversation is control of worca-cc** (approve gates, stop/pause
  runs). `allowedChatIds` is deny-by-default.
- `allowedUserIds` (optional) narrows an allowed chat to named senders; everyone
  else in it is ignored. `/direct` and the answer commands (`/answer`, `/approve`, `/retry`, `/abort`,
  `/cancel`) steer a live run, so in a group chat they are accepted only from those senders unless `directInGroups` is `anyone`; a direct
  message to the bot always works.

## Behavior notes

- Outbound renders an AdaptiveCard (1.2; 1.5 when it carries buttons) with a
  plain-text body — Teams TextBlock markdown is inconsistent across clients.
- Outbound auth: AAD client-credentials token, cached to expiry−300s; one
  forced refresh on a 401, then a typed auth error.
- 429s honor `Retry-After` on the standard ladder. A 5xx or a network error is
  reported as transient (worca retries a freeform reply later); a 400, 403 or
  404 is permanent and never retried for the same message.
