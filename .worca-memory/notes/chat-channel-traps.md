---
name: chat-channel-traps
description: Traps in the chat-channel stack (Discord worker filters, parser/rate-limiter APIs, Ask turn echo races) worth reading before planning or building chat-plugin fe
paths: plugins/*-chat/**, src/core/chat/**
updated: 2026-11-01T09:56:13.417Z
author: Bulibas
---

Each of these sank a reviewed plan once (freeform Discord chat plan, cycles 1-2, 2026-11-01):

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
- **Starting an Ask run card from outside the browser** (cycle 2). The target is `card.target`
  (`'project'|'workspace'|'none'`, `src/core/ask/proposal.mjs:304-315`): a No-project card has every target id `null`
  and NO `noProject` key. A card proposing its source branch carries `sameAsSource: true`, and the browser then sends
  `sameAsSource` and no `featureBranch` (`ask-panel.mjs` `collectCardBody`). `startRunHandler` checks only that the
  card is `proposed`, so a wrong body starts the wrong run silently. Build test fixtures from real `validateProposal`
  output, never hand-made `{noProject:true}` cards. The mock (`mockAskCard`) never proposes No project.
- **Any non-browser user turn needs the send route's gates** (cycle 2). `POST /api/ask/threads/:id/messages` refuses
  before `startAskTurn`: `brokerEngineRefusal(askChatEngine(...))` (409 `engine-broker`) and `brokerStartRefusal(req,
  [model])` (409 `credential-missing`, skipped in mock), then un-archives and passes `signedIn`/`reader`. Event turns
  skip these only because a gated user turn came first. Share the gates, do not call `startAskTurn` bare.
- **Discord modals after a restart.** A modal must be opened inside the 3 s ack window by the worker; keep "this
  button opens a modal" in the `custom_id` itself, never only in worker memory.
