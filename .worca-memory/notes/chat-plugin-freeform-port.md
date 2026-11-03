---
name: chat-plugin-freeform-port
description: Porting Discord's freeform chat (interactive controls, threads, reactions) to another chat plugin worker — where the contract is tested and which traps cost a c
paths: plugins/*-chat/**, test/*-chat-worker.test.mjs
updated: 2026-11-03T07:25:45.051Z
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
