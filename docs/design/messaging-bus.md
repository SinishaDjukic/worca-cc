# Design: a messaging bus for every worca entity

Status: proposal plus a measured spike (P0). Nothing here ships yet. The experiments live in
`experiments/messaging-bus/`, and their numbers are in `experiments/messaging-bus/RESULTS.md`. File:line references
are to dev at `70ae23e5b`, except the cross-chat references, which are to branch
`feat/run-3-incoming-messages-and-reply` at `372ca0f81`.

## Summary

Worca's entities (runs, steps, sub-agents, parallel implementers, chats, chat channels, schedules, Actions, team
hosts) talk through about a dozen separate mechanisms: port files read after a process exits, `directions.ndjson`
read at step start, a polled `pipeline_commands` table, in-memory EventEmitters, a 5 000-frame websocket ring, and
git branches. Most lead time and rework come from the same gap. A fact one agent learns mid-step reaches the agent
that needs it only at the next step boundary, or at review. This document proposes one bus with a single envelope
and a `BusTransport` interface. The local default is a SQLite outbox with per-(consumer, origin) cursors in the
existing `worca-cc.db`. Delivery to agents never starts a model turn: Claude agents read their mailbox through a
PostToolUse hook that prints nothing when the mailbox is empty, and other engines read at step start or through an
MCP `bus_read` tool. Hosts replicate by pulling each other's outboxes over HTTP in a full mesh.

**Recommendation** (from RESULTS.md): build the bus on SQLite, with no broker. The spike measured about 30 000
single-row publishes per second, 8 ms p99 to another process with a `-wal` watcher, 0 bytes per tool call when
nothing is waiting, about 37 tokens of header per delivered message, no loss across a consumer crash, a partition or
a replication crash, and, in a step model with the real hook's delivery delay, rework halved or better and lead time
cut from 6 ticks to 1. Start with P1 (a durable bus behind today's emitters, with no behaviour change). The mailbox
for step agents (P2) waits on a live check of `agent_id` and `additionalContext` in a real Claude session.

## Entity map

| Entity | Talks to | Through today | Lead-time / rework cost today |
|---|---|---|---|
| Run ↔ steps | the next step | port files in the pipeline dir: `allocateOutputs` / `allocateVerdict` (`src/core/graph/executor.mjs:160,181`), `readVerdict` (`src/core/graph/exec-io.mjs:47`), port tokens rendered by `portIoBlock` (`executor.mjs:247`) | what a step agent learns is read only after its process exits (`_execute`, `src/core/orchestrator.mjs:2100`) |
| Person / chat → a running run | the step agent | `directions.ndjson`: `appendDirection` (`src/core/directions.mjs:41`), `renderDirectionsBlock` (`:89`), read only at step START (`_primeDirections`, `orchestrator.mjs:2825`) | a direction sent mid-step waits for the next step |
| Client → run owner (stop / pause) | the owning process | SQLite `pipeline_commands`, polled every `CONTROL_CHECK_INTERVAL_MS = 1000` (`src/core/pipeline-commands.mjs:30`) | ≤ 1 s. This is the existing mailbox precedent: a durable row plus a polled claim |
| Orchestrator → UI websocket | browsers | `RunHarness extends EventEmitter` (`src/core/run-harness.mjs:816`) → `wireRun` (`ui/server.mjs:1448`) → a ring of `MAX_BUFFER = 5000` (`:838`) → `broadcast` (`:1181`) | in memory, lost on restart; replay is whatever is left in the ring; CLI-owned runs are visible only through the DB and files |
| Decompose slices (parallel implementers) | each other | nothing at run time: prompt rules only (`siblingsBlock`, `src/core/phases.mjs:1210`; `agents/worca-cc-implementer.md`); file-disjoint tasks (`agents/worca-cc-decomposer.md`); `DEVIATIONS.md` as an audit record; `Promise.allSettled` over the tasks (`src/core/graph/scheduler.mjs:493`) | a contract change is found by the reviewer, which costs a fix cycle |
| In-agent sub-agents (Agent tool) | the parent, each other | nothing; an optional PostToolUse:Agent telemetry hook (`buildHookSettings`, `src/core/engines/claude.mjs:270`, off by default, keyed by `tool_use_id`, `run-harness.mjs:7953`) | sub-agents cannot sync; the parent and its sub-agents fire the SAME staged hook command |
| Ask chats | tools, runs | SQLite `ask_threads` / `ask_messages` (`src/core/db.mjs:612,623`); the MCP stdio server `src/core/ask/mcp-stdio.mjs` with `createRpcServer` (`src/core/ask/rpc-server.mjs:16`); the relay `POST /api/ask/relay` with a per-turn token; the `askBus` emitter fed by `broadcast`; `attachRunFollower` (`src/core/ask/follow.mjs:26`, in-process only) | a run started by another process is invisible to the follower |
| Chat channels (Discord, Slack, Telegram, Teams) | Ask, runs | a child worker over stdio NDJSON (`src/core/chat/channel-host.mjs:284`), the in-memory `enqueueChatWork` (`ui/server.mjs:4505`), the `chat_deliveries` ledger (`db.mjs:1130`), the chat notifier (`src/core/chat/notifier.mjs`) | the in-memory inbound queue drops work when full; status edits are throttled to 5 s |
| Schedules | runs | `scheduled_runs` / `schedules` tables, `SCHEDULER_TICK_MS = 30_000` (`ui/server.mjs:3643`), cross-process change detection by a signature polled each tick | up to 30 s to notice a CLI write |
| Actions (services / tasks) | UI, Ask | `ActionRegistry extends EventEmitter` (`src/core/actions/registry.mjs:22`), `<home>/actions/state.json` with a 500 ms debounce, a 250 ms ready probe | cross-process status is a polled file |
| Team metrics / team policy | other machines | git branches `worca-metrics` (`src/core/metrics/sync.mjs:44`, outbox files `<ts>-<runId>.jsonl`, reset to remote with up to 5 retries) and `worca-policy` (`src/core/policy/sync.mjs`) | a 1 h discovery TTL. This is the precedent for broker-free, append-only, cross-host fan-in |
| Remote execution (E2B) | the host | not on dev: only on `claude/e2b-*` branches (`src/core/exec-env/backends/e2b.mjs`, `docs/e2b.md`); per-step file sync both ways; a model relay over the sandbox command's stdin/stdout ("nothing in the sandbox connects to Worca") | the sandbox never dials out, so mailbox frames must ride the channel the host opened |
| Cross-chat messaging (the next state) | chats, runs | branch `feat/run-3-incoming-messages-and-reply` @ `372ca0f81`: `createChatMessenger` (`src/core/ask/chat-messages.mjs:217`); `kind:'chat-message'` blocks on `role:'system'` rows; replies found by scanning the transcript (`findIncoming`, `:198`); `TokenBucket` rate limits (`:220-224`); the wake queue `askDeferred` (`ui/server.mjs:8446`) and `askChatMessageQueued` (`:9582`), in memory; run→chat posts drained from `chat-posts-x-<node>-c<ord>.json` at step end (`src/core/run-chat-posts.mjs`); MCP tools `send_to_chat` / `list_chats` | a queued wake is lost on restart; a failed wake is never retried; reply lookup is O(transcript); every message starts a paid turn |

**Where lead time and rework come from:**

- **Step boundaries are the only sync points.** Ports, directions and run→chat posts are all read when a process
  starts or ends. Anything learned mid-step waits a whole step.
- **Parallel work has no channel.** Decompose slices and sub-agents only find a contract change at review, which
  costs a fix cycle that re-runs review. E3 models this cost.
- **In-memory queues forget.** The websocket ring, `askDeferred`, `enqueueChatWork` and `attachRunFollower` lose state
  on restart or across processes, so recovery code polls files and tables instead.
- **Every wake is a paid turn.** Cross-chat messaging starts a model turn per message. The bus turns a wake into
  "read at the next natural point".
- **Polling intervals add up**: 1 s for control, 30 s for schedules, 1 h for team discovery.

## Message model

**Envelope** (implemented in `experiments/messaging-bus/lib/envelope.mjs`):

```
{ v: 1,
  id: string,            // 'm_' + 26 chars, time-ordered (ms timestamp base32 + random); globally unique
  origin: string,        // host id ('h_' + hex), stamped by the transport
  seq: integer,          // per-origin monotonic outbox sequence, stamped by the transport on commit
  topic: string,         // dotted [a-z0-9_-]{1,64} segments, ≤ 8 segments, ≤ 200 chars
  kind: 'note'|'question'|'answer'|'contract.changed'|'finding'|'status'|'direction',
  from: { kind: 'run'|'step'|'agent'|'chat'|'person'|'system', id: string, sub: string|null },  // stamped, never from the body
  scope: { kind: 'project'|'workspace'|'none', key: string|null, owner: string|null },
  ts: integer,           // ms epoch on the origin clock: display only, never used for ordering
  corr: string|null,     // conversation id
  replyTo: string|null,  // envelope id
  hop: integer,          // 1..6 (MAX_HOPS = CHAT_MESSAGE_MAX_HOPS)
  ttlMs: integer|null,
  body: { text: string /* ≤ 4000 chars, redacted */, data?: object /* ≤ 8192 bytes of JSON */ } }
```

**Addresses and topics.** `run.<runId>.step.<nodeId>` (everyone in that step); `run.<runId>.team.<nodeId>` (the
parent and every sub-agent of that step, each reading with its OWN cursor); `run.<runId>.siblings` (Decompose
phase-mates); `run.<runId>.directions`; `run.<runId>.control`; `agent.<sessionId>.inbox` (a session's main agent);
`agent.<sessionId>.sub.<agentId>` (one sub-agent); `chat.<chatId>.inbox`; `channel.<plugin>.<chatId>`;
`schedule.<id>`; `action.<instanceId>`; `team.metrics`; `team.policy`; `ui.broadcast`. A subscription is a list of
exact topics or one trailing `*` (`run.r1.*` matches `run.r1.step.a`, never `run.r10.x`); there are no regex
subscriptions. A bad topic is refused with `BUS_BAD_TOPIC`, never rewritten.

**Ordering.** Order is total per origin (`seq`, gap-free, allocated in the same transaction as the insert) and
absent across origins. Consumers order by `(origin, seq)`, never by `ts`.

**Idempotency.** `id` is UNIQUE: a re-publish or a re-replicated row is a no-op that reports `duplicate: true`.
`(origin, seq)` is UNIQUE too. A consumer that needs effectively-once processing records the id it processed in the
same transaction as its effect and its cursor (E1c's transactional consumer).

**Retention.** Time plus count per topic: the default is 7 days or 10 000 rows per topic, whichever comes first. E1d
measured pruning 90 000 of 100 000 rows at 203 ms.

**Size limits.** Body text ≤ 4 000 chars and `data` ≤ 8 192 bytes (`BUS_TOO_LARGE`), hop ≤ 6 (`BUS_HOP_LIMIT`), the
same numbers cross-chat uses, so its migration keeps its behaviour.

**Consumer identity.** A consumer id is `<prefix>:<sessionId>:<agentKey>`. `agentKey` is the hook payload's `agent_id`,
**with its case kept** (validated to `[A-Za-z0-9_-]{1,64}`), or `main` when the field is absent. The prefix comes
from the hook command line (for example `run.r1.step.impl`). Only the own address is lowercased:
`agent.<sessionId>.inbox`, or `agent.<sessionId>.sub.<agentId>` lowercased. When two ids collide after lowercasing
(`A7`, `a7`), the first one owns the address (`bus_agent_keys`) and the second is refused with `BUS_BAD_CONSUMER`.
`main` is reserved. The `agent_id` field comes from the Claude Code hook docs and was **not verified in this run**;
sub-agents share the parent's `session_id`.

**Start position.** A consumer without a cursor row is seeded from the **step-start mark**: the orchestrator calls
`bus.mark('step:<runId>:<nodeId>:<attempt>')` when the step starts, which records the max seq per origin. A sub-agent
spawned mid-step therefore sees everything published to its topics since the step started, exactly once, and
nothing from earlier steps. Two alternatives were rejected. "Latest" means a late joiner never learns a contract change
announced before it was spawned. "All retained" means a re-run node, or a run-wide topic like `siblings`, replays up
to 7 days of backlog. A missing mark falls back to all retained rows with a `BUS_NO_MARK` warning: it costs tokens,
never messages. A peer origin first seen after the mark has no seeded row and is read from seq 0.

**Self rows.** An agent's publish is stamped `from = {kind:'agent', id:<sessionId>, sub:<agentKey>}`, and a consumer
is never shown its own rows. Self rows still count for the ack, so they never pin a cursor.

**Delivery guarantee per hop.**

- Publisher → bus is exactly one row per id.
- Bus → hook process is at-least-once: cursors persist and survive crashes.
- Hook → model is **at most once**: the hook acks exactly what it prints, in the same transaction as the read.

**Ack rule: only the shown prefix.** The hook renders a prefix of the rows in `(origin, seq)` order within its budget
(2 000 chars; `bus_read` uses 8 000). The first row is always shown whole, so every call makes progress. The hook
then acks the longest prefix of the rows it read in which every non-self row was shown, per origin. The rest stays
above the cursor and arrives on the next tool call, announced as `+N more (next tool call or bus_read)`. So, as long as
the hook's output reaches the model, every row addressed to a consumer is shown exactly once, across as many calls as
overflow needs (E2e: a 10-message burst, each id once, at most 1 call late). If Claude Code drops or truncates the
hook output, the hook will not show those rows again. The mitigation is `bus_read {replay: n}`, which re-shows the
last n acked rows without moving the cursor. "Ack on the next invocation" was rejected: the next invocation cannot
tell whether the earlier output reached the model, so it would only delay the ack. Claim, seed, read, render and ack
are ONE `BEGIN IMMEDIATE` transaction; any throw rolls back every cursor move.

## Transport abstraction

```
interface BusTransport {
  publish(envelopeDraft, { from }) -> { id, origin, seq, duplicate }   // sync for SQLite; throws BusError
  read(consumer, patterns, { limit = 100, startMark?, self? }) -> Envelope[]
  ack(consumer, { origin, seq }) -> void                                // a cursor only moves forward (MAX)
  readRenderAck(consumer, patterns, { limit, startMark?, self?, render, claim? }) -> { text, shown, more }
  mark(name) -> { name, cursors: [{ origin, seq }] }                    // the step-start snapshot, idempotent per name
  wake(consumer, cb) -> unsubscribe                                     // a low-latency hint; never needed for correctness
  close()
}
BusError.code ∈ BUS_BAD_ENVELOPE | BUS_TOO_LARGE | BUS_BAD_TOPIC | BUS_HOP_LIMIT | BUS_CLOSED | BUS_BUSY
              | BUS_UNAUTHORIZED | BUS_BAD_CONSUMER
```

`from` is a transport-side argument, the caller's authenticated identity. It is never read from the draft.

**Local default: SQLite outbox / inbox with cursors**, in the existing `worca-cc.db` through a `db.mjs` migration:
`bus_messages(id UNIQUE, origin, seq, topic, kind, env_json, created_at, UNIQUE(origin, seq))` with an index on
`(topic, origin, seq)`, `bus_cursors(consumer, origin, seq)`, `bus_marks(name, origin, seq)`,
`bus_agent_keys(session_key, topic_key, agent_id)`, and the next seq in a meta row. `db.mjs` already runs WAL with a
`busy_timeout` and is shared by the UI server and the CLI, so every process already has a connection.

**Waking out-of-process consumers.** `fs.watch` on the `-wal` file, debounced, with a polling fallback (`PRAGMA
data_version`), plus an in-process signal for the connection's own writes. A wake is only a hint. E1b measured 8 ms
p99 with the watcher and 51 ms with a 50 ms poll, across processes.

**Distributed option: cursor pull over HTTP.** Each host serves `GET /outbox?after=<seq>&limit=<n>&wait=<ms>` (a long
poll of up to 25 s) behind a per-peer bearer token, and pulls each peer, storing the rows and the peer cursor
`bus_cursors('peer:<origin>')` in one transaction. The topology is a **full mesh**: a host serves only the rows it
originated, never rows it ingested, so there is no relay through a peer (an open question below). No endpoint
accepts a push. E4 measured 4 ms p99 lag on loopback, a 5 000-row partition healed in 91 ms, and no loss and no
re-pulled row across a SIGKILL inside an ingest transaction (with the cursor in a second transaction, the same kill
re-pulls the page).

**Brokers are optional adapters** (P5) behind the same interface, for a deployment that already runs one.

## Candidates compared

| Candidate | Footprint | Ordering | Delivery guarantee | Persistence across restarts | Multi-host | Security boundary | Agent token cost |
|---|---|---|---|---|---|---|---|
| EventEmitter (today's `RunHarness`, `askBus`) | none, in process | per emitter, synchronous | at most once; listeners only | none (the websocket ring is lost) | no | the process | n/a: agents cannot reach it (measured floor 0.53 ms p99, E1b) |
| SQLite outbox + cursors | `node:sqlite`, already the store | total per origin, gap-free (E1a) | at-least-once to consumers; effectively-once with a transactional consumer (E1c, a SIGKILL between effect and ack: 0 duplicate effects, a naive consumer 1) | yes (WAL file) | with the pull replication below | file permissions plus a per-owner read ACL | hook: 0 when empty, about 37 header tokens per message (E2) |
| SQLite + fs watcher | the above plus `fs.watch` on `-wal` | as above | as above; the watcher is a hint only | yes | as above | as above | as above; 8 ms p99 wake (E1b) |
| git-branch fan-in/out (`worca-metrics`, `worca-policy`) | git, already used | per file, append-only | at-least-once, with push retries | yes | yes, through a remote | the remote's auth | not suited to per-call delivery: minutes, not milliseconds |
| NATS / JetStream | a broker process | per stream | at-least-once / exactly-once with dedupe | yes (JetStream) | yes | broker auth, NKeys | same as SQLite (rendering is the same); **not measured: not installed** |
| Redis Streams | a Redis server | per stream | at-least-once with consumer groups | with AOF/RDB | yes | Redis ACL | same; **not measured: not installed** |
| Postgres LISTEN/NOTIFY | a Postgres server | none for NOTIFY (an outbox table gives order) | NOTIFY at most once, lost when no one listens; durable only with an outbox table | only through the table | yes | DB roles | same; **not measured: not installed** |

Measured rows cite RESULTS.md (E1, E2, E4). The broker rows are on paper only: none is installed on the spike host,
and the clarify answer chose SQLite-to-SQLite replication for the distributed experiment.

## Agent delivery without extra turns

**The rule: a message never starts a model turn.** A wake becomes a deferred "read at the next natural point". Only
a person's explicit action may start a turn.

Reading points:

- **Claude PostToolUse hook.** After every tool call the staged hook (one more entry in `buildSettingsPayload`,
  `src/core/engines/claude.mjs:68`) runs `readRenderAck` and prints
  `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"…"}}`. With an empty mailbox it prints
  nothing at all: E2a measured exactly 0 bytes over 40 calls. The hook costs about 64 ms per tool call (E2d) and
  never blocks one: on any error it prints nothing, acks nothing and exits 0. No worca hook injects context today
  (`src/` has no `additionalContext`), so this is new surface.
- **Step start.** The orchestrator renders the step's topics into the prompt, as `_primeDirections` does today. This
  subsumes `directions.ndjson`.
- **Session resume.** A resumed session reads from its cursor, so nothing is shown twice.
- **MCP `bus_read`** for engines without hooks (codex, copilot, cursor, gemini, goose, opencode, qwen all have
  `hookTelemetry` false). It acks what it returns by the same shown-prefix rule. It costs a tool call, so those
  engines should read at step start and on demand, not on every call (E2c: 560 tokens per 40 empty polls).

Publishing: an MCP `bus_publish` tool call, or an outbox file drained at step end (today's `chat-posts` pattern).
Pipeline step agents get no worca MCP server today (only the user's registry copy, `run-harness.mjs:1027`), so
publishing from a step agent is new surface in P2.

**Sub-agent addressing.** The parent and its sub-agents fire the same hook command line, so the consumer comes from
the payload. A sub-agent's `agent_id` gives it its own cursor and its own address `agent.<sessionId>.sub.<agentId>`.
It reads the step-wide topics, `run.<r>.team.<n>` and its own address, and starts at the step-start mark. One
sub-agent's tool call never acks a sibling's messages, and no agent is shown its own message (E3d: B, C and a late
joiner D each saw the change once; A, 0 times; A's calls moved no other cursor). An MCP server is per session and
cannot see which sub-agent calls it, so `bus_read` takes a self-asserted `reader` argument (see the trust model).

## Trust model

- **Bus content is untrusted DATA.** It is rendered only inside a fenced untrusted block (`<<<data … >>>`) under a
  header built from validated ids. A body cannot close the fence: runs of three or more angle brackets are collapsed.
  Header fields are clipped to 80 chars, with line breaks and `[tags]` removed. Bodies are redacted with the existing
  secret redaction and size-capped.
- **The transport stamps identity.** `from`, `origin` and `seq` are set by the transport from the caller's
  authenticated identity, never taken from the body or the tool arguments.
- **Reads have a per-scope / per-owner ACL.** Subscriptions are filtered by `scope.owner`, the same rule as
  `askFrameOwner` / `ownerOk` for websocket frames.
- **Loops and floods.** A hop limit of 6; per-sender rate buckets, persisted (today's `TokenBucket` is in memory).
- **Cross-host.** A cross-host pull needs a per-peer bearer token (compared in constant time) and is pull-only: no
  peer can push into a host. A refused request changes nothing (E4d: 32 of 32 refused, 0 rows changed).
- **E2B sandboxes** never dial out; mailbox frames ride the stdin/stdout channel the host opened.
- **One principal per session.** Within one Claude session, the parent and its sub-agents are ONE principal: an
  `agent_id` (or `bus_read`'s self-asserted `reader`) separates their cursors and addresses, never their permissions.
  A reader can only move cursors inside its own session, and `from.sub` is shown as "unverified within the session".

## Migration of cross-chat messaging

Designed against `feat/run-3-incoming-messages-and-reply` @ `372ca0f81`, read as the expected next state (clarify
answer). Each change names the branch code it replaces.

1. **Publish an envelope.** `send` (`src/core/ask/chat-messages.mjs:249`) and `postFromRun` (`:345`), both returned by
   `createChatMessenger` (`:217`), publish an envelope on `chat.<chatId>.inbox` with `kind` from the intent (`note`,
   `question`, or `answer` for a reply) and `corr` = the conversation id. They still write the `kind:'chat-message'`
   transcript block (`:299`, `:382`) for display, carrying the envelope id.
2. **Indexed reply lookup.** `findIncoming(rows, messageId)` (`:198`) scans the transcript. It becomes a lookup by
   envelope id (`bus_messages.id` is UNIQUE), so a reply costs O(1), not O(transcript).
3. **Durable wakes.** `askDeferred` (`ui/server.mjs:8446`) and `askChatMessageQueued` / `askChatMessageQueuedFrom`
   (`:9582-9583`) are in-memory maps. They become durable inbox rows with a `wake_state` (`pending|started|failed`).
   Boot re-scans pending and failed rows and retries them with backoff, so a queued wake survives a restart and a
   failed wake is retried. `chatMessageStartEvent` (`:9599`) becomes the wake worker.
4. **Persisted rate buckets.** The `TokenBucket`s (`chat-messages.mjs:220-224`; `CHAT_MESSAGE_RATE_PER_MIN = 6`,
   `CHAT_MESSAGE_GLOBAL_PER_MIN = 30`, `:14-15`) become persisted counters per sender, so a restart does not reset
   them.
5. **The paid wake becomes opt-in per chat.** By default a message is delivered at the target's next turn (step
   start for a chat), with no model call. A chat can opt in to "wake me", which keeps today's behaviour.
6. **One transport.** The loopback route `POST /api/ask/chat-messages` with its `x-worca-ask-message` token
   (`askChatMessageBridge`, `ui/server.mjs:8335`) and the in-process relay deps used by `send_to_chat` / `list_chats`
   (`src/core/ask/chat-message-deps.mjs`) both collapse onto `BusTransport.publish`.
7. **Run → chat posts.** The `chat-posts-x-<node>-c<ord>.json` files drained at step end (`src/core/run-chat-posts.mjs`,
   `chatPostsPath` `:20`, `readChatPosts` `:31`) become `bus_publish` calls from the step agent in P2. The drain stays
   as the fallback for engines without the MCP tool.
8. **Unchanged:** `CHAT_MESSAGE_MAX_HOPS = 6` and `CHAT_MESSAGE_TEXT_MAX = 4000` (`:12-13`) map to the envelope's hop
   and body limits, and the `CHAT_MESSAGE_*` error codes (`:29-41`) stay as they are at the tool boundary.

## Phased rollout

| Phase | What | Flag | Rollback | Gated by |
|---|---|---|---|---|
| P0 | This spike: design plus experiments, no product change | none | delete the folders | E1–E4 |
| P1 | `bus_messages` / `bus_cursors` / `bus_marks` tables (a `db.mjs` migration) and an in-process publish behind `broadcast` and the `RunHarness` emitter: no behaviour change, durable replay for the UI websocket and for CLI-owned runs | `bus.p1` | flag off; the tables stay unused | E1a, E1d |
| P1 first targets | `pipeline_commands` (`pipeline-commands.mjs`) becomes a `run.<runId>.control` topic whose claim is a cursor ack, keeping its 1 s poll as the fallback wake. `directions.ndjson` (`directions.mjs:41,89`) becomes `run.<runId>.directions`, still rendered at step start by `_primeDirections` and also delivered mid-step by the P2 hook | `bus.control`, `bus.directions` | flag off: back to the table and the file | E1b, E1c |
| P2 | The mailbox for step agents: the Claude PostToolUse hook and an MCP `bus_read` / `bus_publish` server for step agents; per-agent consumers for sub-agents; the Decompose `siblings` topic; step-start marks | `bus.mailbox` | flag off: no hook staged, no MCP server | E2, E3, and a live check of `agent_id` and `additionalContext` in a real Claude session |
| P3 | Cross-chat messaging onto the bus (the section above) | `bus.chat` | flag off: the branch's in-memory path | E2, E3d |
| P4 | Cross-host pull replication (team hosts, remote hosts) | `bus.peers` | remove the peers; local rows are unaffected | E4 |
| P5 | An optional broker adapter (NATS / Redis / Postgres) | `bus.transport` | switch back to SQLite | a broker benchmark not run here |

## Experiments

The results are in `experiments/messaging-bus/RESULTS.md`; every threshold passed.

### E1 SQLite outbox

- **Hypothesis:** a SQLite outbox is fast enough for every local entity, reaches out-of-process agents without a
  broker, and loses nothing across a restart.
- **Metric:** publish msgs/s (single-row transactions, 1 writer); p99 publish → consumer latency across processes;
  lost ids and duplicate effects for a transactional consumer after a SIGKILL between effect and ack, and resume; ms to prune 90 % of 100 000
  rows.
- **Threshold:** ≥ 2 000 msg/s; `watch` ≤ 100 ms and `poll-50` ≤ 75 ms; 0 lost and 0 duplicate effects; ≤ 1 000 ms.

### E2 Mailbox tokens per tool call

- **Hypothesis:** an empty mailbox costs nothing, delivery per tool call is cheap, a hook beats polling an MCP tool,
  and overflow loses nothing.
- **Metric:** injected bytes per call (`none`, `hook`); total estimated tokens and header overhead per message
  (`steady-every-5`, 200-char bodies); hook vs `mcp-poll` tokens; hook wall time p99; ids delivered vs published for
  a 10-message burst.
- **Threshold:** exactly 0 bytes; ≤ 900 tokens per run and ≤ 60 header tokens per message; `hook` = 0 and
  `mcp-poll` > 0; ≤ 150 ms; all delivered, each once, at most 2 calls late.

### E3 Contract change: bus vs review loop

E3 is **computed from a step model, not measured on real agents**. The delivery delay is measured from the real hook.

- **Hypothesis:** a mid-task announcement cuts rework and lead time at the measured delivery delay, and the review
  loop still catches an ignored message.
- **Metric:** mean rework ratio bus-act / review per variant (`decompose`, k = 2, 5, 8); lead time in ticks; the truth
  check of every arm; per-recipient delivery counts in the `subagents` topology.
- **Threshold:** `spread` ≤ 0.55 and `late` ≤ 0.25 (the model gives 0.50 / 0.20 at d = 0 and 0.60 / 0.33 at d = 1);
  0 review cycles in bus-act; lead time ≤ 1 tick; every arm correct; bus-ignore rework = review rework; B, C and the
  late joiner D each shown the change once and A 0 times.

### E4 Two hosts

- **Hypothesis:** pull replication is near-real-time, heals partitions and crashes without loss, and refuses
  unauthenticated peers.
- **Metric:** p99 lag (steady, long poll); catch-up time, loss, duplicates and order violations after a 3 s
  partition; loss and rows re-pulled (the puller's `duplicates`) after a SIGKILL inside an ingest; 401 count and rows changed by refused requests.
- **Threshold:** ≤ 250 ms; ≤ 5 s and 0 / 0 / 0; 0 / 0; all refused and 0 rows.

## Open questions and known gaps

- **Relay through a peer.** The design is a full mesh: a host serves only its own rows. Hosts that cannot reach each
  other directly would need relaying (re-serving foreign rows with their original `(origin, seq)`), which is not
  designed. Only two hosts were measured.
- **Live check of `agent_id` and `additionalContext`.** Both come from the Claude Code hook docs and were not verified
  in a live session. If real sub-agent payloads lack `agent_id`, every agent of a session falls back to `main` and
  shares one cursor (today's behaviour: no loss, but no sync between sub-agents). P2 is gated on this check.
- **The cursor is per (consumer, origin), not per topic.** A topic added to a consumer's `--topics` later starts after
  that consumer's existing cursor and skips the topic's older rows. Options: per-topic cursors (more rows, simpler
  semantics), or seeding a newly added topic from the step-start mark.
- **Hook output dropped after the ack.** Delivery to the model is at most once. `bus_read {replay: n}` is the
  mitigation; whether Claude Code ever drops `additionalContext` is unmeasured.
- **A peer origin first seen after a step-start mark** is read from seq 0 for that origin.
- **Case-only `agent_id` differences.** The second id is refused and that agent gets no mailbox (a logged
  `BUS_BAD_CONSUMER`), rather than merging two agents' cursors.
- **The cross-chat branch can drift** before migration; this section cites `372ca0f81`.
- **E3 models agents as acting on what they read.** Real model behaviour, and real token counts (the spike uses
  bytes/4), are not measured. Brokers, Windows and real clock skew are not tested.
