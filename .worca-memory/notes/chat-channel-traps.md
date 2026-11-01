---
name: chat-channel-traps
description: Traps in the chat-channel stack (Discord worker filters, parser/rate-limiter APIs, Ask turn echo races) worth reading before planning or building chat-plugin fe
paths: plugins/*-chat/**, src/core/chat/**
updated: 2026-11-01T09:39:23.892Z
author: Bulibas
---

Each of these sank a reviewed plan once (freeform Discord chat plan, cycle 1, 2026-11-01):

- **Discord thread messages vs `channelAllowlist`.** A MESSAGE_CREATE inside a thread carries the THREAD id as
  `channel_id` and no parent id. `plugins/discord-chat/channel/worker.mjs` filters on `channelAllowlist`, so every
  thread message is dropped before `emitMessage` unless the worker itself remembers the thread ids (persist them in
  `ctx.state`; a restart replays state in `hello`). INTERACTION_CREATE does carry `channel.parent_id`.
- **`MENTION_TOKEN` is a string** (`src/core/chat/parser.mjs`, `String.raw`), not a RegExp: `.source` is `undefined`
  and `new RegExp(undefined, 'g')` matches between every character. Build `new RegExp(...)` from it or strip only
  the bot's own `<@id>` token.
- **`TokenBucket` has `tryConsume()` only** (`src/core/chat/rate-limiter.mjs`); constructor takes `{ now }`.
- **Echo race in `startAskTurn`.** The user row is broadcast (`ask-message`) before the turn's first await, and
  `enqueueChatWork` runs an idle queue on the next microtask. Anything that marks "this row came from the platform"
  AFTER `startAskTurn` returns is too late for a listener on another queue key; mark it inside, between
  `askAppendMessage` and the broadcast.
- **Scope shapes differ.** `askScopeLabel` (server) is async and reads the PATCH shape `{pinned, projectKey|workspaceId}`;
  `chatScopeOf` returns `{projectKey}|{workspaceId}|null`. Wrap with `scopeBody(...)`. `switchThreadScope(null)`
  throws `BAD_SCOPE`: "No project" is `{ pinned: false }`.
- **Discord modals after a restart.** A modal must be opened inside the 3 s ack window by the worker; keep "this
  button opens a modal" in the `custom_id` itself, never only in worker memory.
