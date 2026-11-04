---
name: chat-channel-traps
description: Traps in the chat-channel stack (Discord worker filters, parser/rate-limiter APIs, Ask turn echo races) worth reading before planning or building chat-plugin fe
paths: plugins/*-chat/**, src/core/chat/**
updated: 2026-11-04T22:08:17.693Z
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
- **Checking Discord API facts headless.** WebFetch/WebSearch are refused in pipeline sub-agents. `curl` the official
  docs repo (`github.com/discord/discord-api-docs`, branch `main`) and grep the `.mdx` files instead. Facts it gave
  (2026-11-01): a text input inside an action row in a modal is deprecated (Label component, type 18; its submit item
  is `{type:18, component:{type:4, custom_id, value}}`), so read both submit shapes; a thread started off a message
  takes that message's id and a message holds one thread (retrying thread creation on the same message is a 400).
- **Ask turn shapes a bridge must handle** (refine cycle 1): a stopped turn finishes `status: 'stopped'`, often with
  empty text (render something); `job.status` is `'running'` before `job.turn` exists (tests wait for `.turn`); the
  mock's propose rule (`\b(propose|start|run)\b`) also fires on any text containing "run", e.g. a change request.
- **Late cases in `test/chat-freeform-e2e.test.mjs` see earlier cases' runs** (2026-11-03 reactions plan): by then
  `/status` in C1 answers a `warning` ("Ambiguous — use a longer suffix"), so a case expecting an info/success
  command reply never gets it. Use `/help` for a deterministic info reply. Also `?.x ?? 'gone'` on a DB row turns a
  real `NULL` column into the fallback; read the row first, then the column.
- **Task-source (issue-backed) run cards**: the browser sends `source` = `runSourceOf(card.source)`
  (`src/core/ask/source-spec.mjs`) and NO `prompt` (`ask-panel.mjs` `collectCardBody`); the card's `displayName`,
  `title`, `url`, `profileVia` are display only. A source card in a test: copy
  `test/fixtures/plugins/mock-source/worca-cc-plugin.json` into `pluginCurrentDir('mock-source')` and add its lock
  row (mock mode serves `getTask`), then `validateProposal({..., source: {plugin:'mock-source', sourceId:'mock', taskId}})`.
- **Router severity is not "refused"** (refine cycle 4, 2026-11-03): `command-router.mjs` answers a COMPLETED `/pause`,
  `/stop` of a live run and `/stop` of a paused run with severity `'warning'`, as it does real refusals. Anything that
  derives an outcome from a router reply (reactions, metrics) must not read every warning as a refusal; the reactions
  plan tags those three replies with a symbol key instead (symbol keys survive object spread, vanish in JSON/IPC).
- **Forcing a race in the freeform e2e deterministically:** `H.setSendHook` runs inside the bridge's send, so a hook
  that fires on one specific post (e.g. the first header `options.edit` of a new thread), injects a `click(...)` and
  `await`s its `replyAfter(n)` holds that code path until the other queue's work is done. The click's own sends
  re-enter the hook: guard with a `fired` flag. Read any "before" state (an Ask thread id) INSIDE the hook, not by
  polling `waitFor` afterwards: the click finishes before the 15 ms poll tick.
- **Per-message reactions: two blind spots in the freeform e2e** (implementation review, 2026-11-03). (1) A command
  typed in a bound thread is routed with the PARENT `chatId`, but its reaction belongs on `msg.chatId` (the thread).
  Every e2e command case was sent on `C1`, where both ids are equal, so a target built from `routed.chatId` stayed
  green. Pin it with a command sent on the thread (`TH1`), and assert the rxLog `chatId`: `marksOn` filters by
  message id only. (2) Any throw after `receipts.ack(mark)` that escapes to the server's catch leaves ⏳ for good.
  The real-deps e2e cannot throw from `startTurn`/`applyCard`, so removing those catches stayed green. Each post-ack
  catch needs a stub-deps or hook test.
  Recipe that worked (fix cycle, 2026-11-03): `stubBridge()` in `test/chat-conversation-bridge.test.mjs` builds
  `createConversationBridge` over stub deps and a `useTempHome` store; `ask.createThread` must create a REAL Ask
  thread (`chat_conversations.ask_thread_id` is a foreign key). A second stub bridge with throwing deps reads the
  first one's binding. One guard per invariant: an outer post-ack guard makes an inner catch that does the same thing
  an equivalent mutant, so drop it; keep an inner catch only where its outcome differs (runTurn's posts in the
  thread, the start guard posts in the parent channel; a failed reply check keeps ⏳ instead of ❌).
- **Inbound chat context vs the typed card answer** (chat-context review, 2026-11-03). The bridge skips the
  text-question card shortcut whenever a message carries `replyTo` or files (`answerOrTurn`). A platform Reply to
  the BOT's own message inside its bound thread is the natural way to answer a question card. So a worker must not
  attach `replyTo` there: that message is already in the Ask transcript. Otherwise the answer becomes a paid turn,
  the card stays open, and the bot's own text is quoted back as "untrusted". Every plugin that adopts `replyTo`
  (Slack `thread_ts` parent, Telegram `reply_to_message`) needs this, plus a row where a reply to the bot answers
  an open text question.
- **Live status messages (discord-chat 0.5.0, 2026-11-04).** A channel opts in with manifest
  `capabilities.liveStatus` (needs `interactive`); the e2e's main fixture does NOT declare it, so cases 1-34 never see
  a status post (case 35 uses its own `fixture-live` plugin on `L1`). Status rows live in `chat_deliveries` as
  part `'status'` (`ask_message_id` = `pending:<platform id>` until bound): `deliveredParts` filters that part out —
  any new reader of chat_deliveries must too. While a status is `starting`, `deliverAll` holds back any undelivered
  assistant row (else a fast mock reply lands as a new message before the status knows its row); `runTurn`
  reconciles right after binding. Pin progress in the e2e with mock `_testing.holdFrame` (hold after the first
  `text_delta` past the real 5 s tick), not `WORCA_MOCK_SLOW_MS`.
- **`test/discord-chat-worker.test.mjs` runs ~195 s** (tests finish in ~2 s; the process lingers, on the checkpoint
  too). A plain Bash call with the default 120 s timeout looks hung: give it `timeout: 300000`. For mutation sweeps,
  extract the one test (file head + `workerCtx` + the test) into a temp `test/zz-*.test.mjs` (~1 s per run).
