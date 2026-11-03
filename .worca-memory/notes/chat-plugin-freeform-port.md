---
name: chat-plugin-freeform-port
description: Porting Discord's freeform chat (interactive controls, threads, reactions) to another chat plugin worker — where the contract is tested and which traps cost a c
paths: plugins/*-chat/**, test/*-chat-worker.test.mjs
updated: 2026-11-03T19:26:57.623Z
author: Bulibas
---

Porting freeform chat to slack-chat (2026-11-03) showed where the worker-host contract really lives.

- **`test/chat-freeform-e2e.test.mjs` is not per-plugin.** It never loads a plugin worker: `WORCA_MOCK=1`, a fixture
  plugin with `platform: 'discord'`, a mock `behavior.send/react`, 48 cases sharing state in file order. Adding a
  platform there collides with every parallel port. Pin the contract in the plugin's own worker test instead: run
  `isValidIncoming` / `isValidInteraction` / `isValidFrame` (`src/core/chat/channel-protocol.mjs`) on what the worker
  emits, with the platform's real id shapes (Slack composite `C…:<ts>` chat ids, dotted `ts` message ids).
- **The bridge binds a conversation to ONE chatId** (`header.detail.threadId` from a `send` with `options.thread`). A
  platform whose threads are not their own channel (Slack: channel + `thread_ts`) needs a worker-made composite id,
  remembered in `ctx.state` (loaded in `start()` before the socket opens, saved before the header post) — otherwise
  replies after a restart arrive with the plain channel id and the conversation goes silent.
  **Roll that binding back on ANY throw of the thread send** (post failure, 429, host 15 s timeout). The bridge binds
  nothing then. A surface remembered without a conversation emits a composite chatId that is in no allowlist and has
  no row, so that place is dead: commands are dropped and mentions cannot start. Telegram review cycle 2 (2026-11-03)
  found this for an EXISTING forum topic, persisted before the header post. Test it with a refused thread send
  followed by a later message, which must arrive with the plain chat id.
  A `catch` around the post does NOT cover the host timeout. The worker's 429 ladder waits `retry_after` inline
  (`maxWaitMs` defaults to `Infinity`). So a 20 s wait outlives the host's 15 s `sendMessage` RPC, and then it
  SUCCEEDS: no throw, the binding stays, and the bridge has already given up (Telegram review cycle 3). Bound the
  thread-start post's total wait below 15 s, so that a long 429 throws inside the `try`. Test it with a recording
  `_sleep`: the fake `async () => {}` hides the wait.
  A per-wait cap (`maxWaitMs: 5000`) is not a total: the shared ladder (`SEND_BACKOFF_DELAYS`, 3 waits) still sleeps
  3 × 5 s = 15 s. Telegram fix (cycle 4): one `{ left }` budget object spent by every wait of the start (topic create,
  each header chunk, pointer). Pin it with a 429 `retry_after: 5` on EVERY try and assert the sleeps sum < 15000;
  a single 429 of 20 s does not tell a per-wait cap from a total.
  Pin the budget on EVERY start path, not just the one the review named. On cycle 4 a topic-only row left four
  forwarding sites unpinned: topic create, pointer, reply-chain post and DM post. Dropping `{ budget }` from any of
  them stayed green.
- **Receipt marks are Unicode** (`receipts.mjs` `MARK`, `⏹️` = U+23F9 U+FE0F). A platform that reacts by name needs a
  map; build its keys with `String.fromCodePoint(...)` (map both with and without U+FE0F): the Write tool turns
  backslash-u escapes into raw characters, and a lost U+FE0F is invisible.
- **Platforms that answer refusals as HTTP 200** (Slack `ok:false`) need permanence decided per error code, plus the
  platform's own outage codes (`fatal_error`, `internal_error`, `service_unavailable`) mapped to `network`, never
  permanent — see [[chat-send-error-kinds]].
- `plugins/*/lib/` must stay byte-identical across the four chat plugins (`test/chat-lib-drift.test.mjs`): put new
  platform code in `channel/worker.mjs`. New manifest fields must not be `advanced` unless
  `test/plugin-manifest.test.mjs:874` is updated too.
- **The reply target must be remembered for EVERY kind of interaction, modal submits included.** The bridge answers
  each interaction privately via `replyInteraction(evt.id, …)` (`conversation-bridge.mjs` `ephemeral`: stale, notOwner,
  busy). A worker keeps its own `interactionId -> {chatId, userId}` map; on Slack cycle 1 (2026-11-03), dropping that
  map's write in the `view_submission` branch left the whole worker test green. Every test must call
  `replyInteraction` on a click id AND on a modal-submit id, and assert the platform call each one makes.
