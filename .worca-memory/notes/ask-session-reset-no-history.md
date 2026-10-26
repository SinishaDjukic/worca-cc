---
name: ask-session-reset-no-history
description: Read before changing an Ask chat's provider session (clearing sessionId, switching engine, forking): a null session starts the next turn with NO history.
paths: src/core/ask/turn.mjs, src/core/ask/prompt.mjs, ui/server.mjs
updated: 2026-10-26T16:29:08.919Z
author: Bulibas
---

Clearing `ask_threads.session_id` does not make the next turn replay the conversation. In `turn.mjs` `_attempts`,
attempt 1 always sends `this.prompt`, which is the turn prompt only. `restoredPrompt` (`prompt.mjs` `buildRestoredPrompt`:
text only, 30 000 chars, header "the previous session expired") is used ONLY on the retry, and the retry fires only when
`this.resumeSessionId` was set and the resume failed (`!sawInit`, "No conversation found", `chat.resumeNotFound`).
So a null session means a fresh session with no context, silently.

A session id of another engine is no better. Every adapter drops a foreign id with only a stderr line: Claude
`engines/index.mjs` (`/^[a-z]+:/`), `codexThreadOf`, `copilotSessionOf`, `familySessionOf`, `gooseSessionOf`,
`opencodeSessionOf`. That is not an error, so the retry never runs. Ids are `<engine>:<id>`, except Claude's, which are
bare UUIDs.

How to apply: any feature that resets or swaps the session (engine switch #943, a fork) must put the transcript into
the FIRST attempt's prompt, chosen in `startAskTurn`. The #943 plan does this with `needsHandoff(thread, prior)` and
`buildHandoffPrompt`. It also has to clear the session id; keeping it is not enough.

`ask_messages` had no `engine` column before v77 (#943). Below v77 a reply's engine can only be guessed from its model,
and a model on two harnesses makes that guess ambiguous.

Anything put IN FRONT of an Ask turn's prompt breaks the mock: `src/core/engines/mock.mjs` `mockAsk` matches
`^\s*\[worca event\] …` at the prompt's start (after stripping only the context and canvas blocks). The #943 handoff
transcript turned `test/ask-api-workflow-cards.test.mjs` "Ask graph card with thenRun" red, because its seeded assistant
row has no session, so the event turn hydrates. The fix is a leading-block strip in `mockAsk` (`ASK_HANDOFF_BLOCK_RE`).
Tests that seed assistant rows by hand never set a session, so a no-session trigger fires in them.
