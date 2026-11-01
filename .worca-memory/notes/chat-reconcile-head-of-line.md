---
name: chat-reconcile-head-of-line
description: When reviewing chat-platform delivery loops (conversation-bridge reconcile), check that one permanently failing part cannot block every later part.
paths: src/core/chat/conversation-bridge.mjs, plugins/*-chat/channel/worker.mjs
updated: 2026-11-01T14:56:47.789Z
author: Bulibas
---

The freeform Discord bridge's `reconcileOnce` walks messages in order and awaits `send()` with no per-part catch.
A part that fails every time therefore throws first on every pass, and the thread gets no more replies at all.
Examples are an edit of a message someone deleted in Discord (the worker throws 'channel or message not found' on a
404), a 403, or a message that fails `isValidMessage`.

This survived a plan that was replayed and mutation-swept over two refine cycles. Those checks only exercised
transient failures (case 17 rethrows and retries), never a permanent one. Found in implementation review cycle 1,
2026-11-01.

How to check: for any new delivery or reconcile loop, inject a permanent rejection for one part (a fake send that
rejects one messageId's edit). Then assert that a LATER message still arrives. The loop should tell permanent errors
(not found, forbidden, invalid) apart from transient ones (network, 429). A 404 on an edit should post the part as a
new message.
