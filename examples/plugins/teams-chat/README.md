# teams-chat

Two-way Microsoft Teams channel for worca-cc via Bot Framework (no SDK):
pipeline notifications out, chat commands in (`/status`, `/pause`, `/approve`,
`/answer <n>`, …).

Teams is the one platform with **no outbound-connection option**: Bot Framework
only delivers inbound activities to a **public HTTPS endpoint**. worca-cc stays
loopback-only except for one hardened, token-guarded ingress route
(`/api/ingress/teams/...`) that you expose through a tunnel. The worker — not
the host — validates every inbound request's Bot Framework JWT.

**v1 scope**: replies + proactive messages to conversations the bot has
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
5. **Teams channel**: Azure Bot → Channels → add **Microsoft Teams**. To chat
   with it, use the App ID deep link (`https://teams.microsoft.com/l/chat/0/0?users=28:<appId>`)
   or package a Teams app manifest referencing the bot.
6. **Install + configure**:

   ```bash
   worca plugin link examples/plugins/teams-chat
   ```

   Fill App ID / secret / tenant / ingress token. Doctor verifies the AAD
   credentials (inbound wiring is proven by the first received message).
7. **Message the bot once** → copy the conversation ID from the worker's
   inbound frame (`worca plugin channel teams-chat main` shows it) → put it in
   **Notify conversation IDs** and, for commands, **Allowed conversation IDs**.

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

## Behavior notes

- Outbound renders an AdaptiveCard 1.2 (plain-text body in v1 — Teams TextBlock
  markdown is inconsistent across clients).
- Outbound auth: AAD client-credentials token, cached to expiry−300s; one
  forced refresh on a 401, then a typed auth error.
- 429s honor `Retry-After` on the standard ladder.
