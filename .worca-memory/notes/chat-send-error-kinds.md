---
name: chat-send-error-kinds
description: Read before treating a chat plugin send failure as permanent or retryable (channel-host sendMessage, conversation bridge reconcile).
paths: src/core/chat/channel-host.mjs, src/core/chat/conversation-bridge.mjs, src/core/chat/channel-worker-child.mjs, plugins/*-chat/channel/worker.mjs
updated: 2026-11-01T15:13:19.005Z
author: Bulibas
---

A chat send error with kind `plugin` does not mean "the platform refused this for good". The Discord worker
(`plugins/discord-chat/channel/worker.mjs`, the `post` helper in `send`) maps every non-OK status other than
401, 403, 404 and 429 to `plugin`, so 500, 502, 503 and 504 are `plugin` too. `errKind` in
`src/core/chat/channel-worker-child.mjs` also turns any untyped worker exception into `plugin`. Only 403, 404 and an
invalid body are refusals that will fail again on a retry.

This mattered in the freeform Discord cycle-1 fix (2026-11-01). It marked every `plugin` error as `permanent`, and
the bridge then recorded the part as delivered and never retried it. A short Discord 5xx outage would have dropped
replies silently.

How to apply:
- Decide whether a failure is permanent from the HTTP status, at the worker. Never infer it from `kind`.
- A host-side mapping in `sendMessage` has two branches: the mock `behavior.send` branch and the real worker RPC
  branch. The e2e tests use only the mock branch. Pin the RPC branch with the fixture worker in
  `test/channel-host.test.mjs`, otherwise a mutant that reverts it survives.
