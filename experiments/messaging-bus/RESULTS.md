# Messaging bus spike: results

The design these experiments test is `docs/design/messaging-bus.md`. Raw numbers are in `results/e1.json` …
`results/e4.json` (full run, `node experiments/messaging-bus/run-all.mjs`). Every `key | value` row below is copied
from that file's `summary` object, and `test/results.test.mjs` checks that they match. The `threshold` and `verdict`
cells are judgements against the plan's §6 table.

A FAIL would be a result, not a defect. None of the thresholds failed on this machine.

## Environment

- Node v26.0.0 on darwin 24.6.0 (macOS), CPU "Apple M3 Pro", 12 cores, one machine for every process.
- `node:sqlite` `DatabaseSync`, WAL, `synchronous=NORMAL`, `busy_timeout=5000`. Every database was a fresh file under
  `os.tmpdir()`.
- No real model, no broker, no network beyond 127.0.0.1. The host was not otherwise idle (a worca server and other
  sessions were running), so the timings are a realistic upper bound, not a best case.

## E1 SQLite outbox micro-benchmark

### Hypothesis

A SQLite outbox with per-consumer cursors is fast enough for every local worca entity. Out-of-process agents can
get messages without a broker. A restart loses nothing, and a transactional consumer is effectively-once.

### Method

`e1-outbox-bench.mjs`. (a) 50 000 publishes as single-row transactions, the same in 100-row batches, and two writer
processes sharing one file (25 000 each). (b) A consumer child process per wake mode, `poll-10/50/250` and `watch`
(fs.watch on the `-wal` file, with a 1 s poll fallback). The parent publishes 2 000 messages at a fixed 500/s.
Latency is the consumer's receive time minus the publish time, both `performance.timeOrigin + performance.now()`
on one machine. The in-process EmitterBus is the floor. (c) 10 000 messages; a consumer child SIGKILLs itself
(`--die-after-effect 4000`) after the effect of row 4 000 and before its ack (naive) or its COMMIT (transactional),
and is restarted on the same DB. The `transactional` kind records `processed`, the effect and the cursor in one
transaction; the `naive` kind writes the effect, then acks in a second transaction. (d) Delete 90 % of
100 000 rows.

### Numbers

| key | value | threshold | verdict |
|---|---|---|---|
| `e1.publish.n` | 50000 | | |
| `e1.publish.single.msgsPerSec` | 30491 | ≥ 2 000 msg/s | PASS |
| `e1.publish.batch100.msgsPerSec` | 138652 | reported | |
| `e1.publish.twoWriters.msgsPerSec` | 26237 | reported | |
| `e1.publish.twoWriters.busyErrors` | 0 | reported | |
| `e1.publish.twoWriters.seqGapFree` | true | must be true | PASS |
| `e1.latency.ratePerSec` | 500 | | |
| `e1.latency.poll-10.p99Ms` | 12.27 | reported | |
| `e1.latency.poll-50.p50Ms` | 24.3 | reported | |
| `e1.latency.poll-50.p99Ms` | 51.44 | ≤ 75 ms | PASS |
| `e1.latency.poll-250.p99Ms` | 249.15 | reported | |
| `e1.latency.watch.p50Ms` | 1.84 | reported | |
| `e1.latency.watch.p99Ms` | 7.65 | ≤ 100 ms | PASS |
| `e1.latency.watch.received` | 2000 | all 2 000 | PASS |
| `e1.latency.emitter.p99Ms` | 0.64 | floor | |
| `e1.restart.transactional.lost` | 0 | 0 | PASS |
| `e1.restart.transactional.duplicateEffects` | 0 | 0 | PASS |
| `e1.restart.transactional.redeliveries` | 1 | reported (the killed row, read again) | |
| `e1.restart.naive.lost` | 0 | reported | |
| `e1.restart.naive.duplicateEffects` | 1 | 1 (the contrast) | PASS |
| `e1.prune.n` | 100000 | | |
| `e1.prune.ms` | 202.99 | ≤ 1 000 ms | PASS |

### Verdict

E1a, E1b, E1c and E1d all PASS. Throughput is about 300 times worca's busiest stream (run events, < 100/s). With the
watcher, out-of-process delivery is a few milliseconds; a 50 ms poll stays at about 51 ms at p99. Neither needs a broker.

E1c kills the consumer inside its critical window on purpose: the window between an effect and its ack is a few
microseconds, so a kill sent by the parent lands between two finished rows and cannot show anything. With the seam,
both kinds read the killed row again on restart (1 redelivery each). The naive consumer repeats its effect (1
duplicate effect), and the transactional one does not (0), because its effect, `processed` and cursor were never
committed. `test/experiments-quick.test.mjs` asserts both values.

## E2 Mailbox token cost per tool call

### Hypothesis

A per-tool-call PostToolUse hook costs nothing when the mailbox is empty and little when it is not. It is cheaper
than polling an MCP tool. Overflow never loses a message.

### Method

`e2-mailbox-tokens.mjs`. A scripted fake agent makes 40 tool calls. Every body is exactly 200 ASCII chars on
`run.r_e2.siblings`. Schedules: `none`, `one` (before call 10), `burst` (10 at once before call 20), and `steady`
(one before every 5th call, 8 messages). Modes: `hook` spawns the real `lib/hook.mjs` per call; `mcp-poll` calls
`bus_read` on every call and counts the request JSON plus the response text; `step-start` renders once at the next
step's start. Tokens are `ceil(utf8 bytes / 4)`, a heuristic. Header overhead per message = (rendered tokens − body
tokens) / messages shown. A run continues up to 5 calls past 40 until every id is delivered.

### Numbers

| key | value | threshold | verdict |
|---|---|---|---|
| `e2.calls` | 40 | | |
| `e2.none.hook.totalBytes` | 0 | exactly 0 | PASS |
| `e2.none.hook.maxBytesPerCall` | 0 | exactly 0 | PASS |
| `e2.none.mcp-poll.totalTokens` | 560 | > 0 (the poll's cost) | PASS |
| `e2.steady.hook.totalTokens` | 696 | ≤ 900 | PASS |
| `e2.steady.hook.headerOverheadTokens` | 37 | ≤ 60 per message | PASS |
| `e2.steady.mcp-poll.totalTokens` | 1216 | reported | |
| `e2.steady.step-start.totalTokens` | 577 | reported | |
| `e2.steady.step-start.maxDelayCalls` | 36 | reported (today's path) | |
| `e2.one.hook.totalTokens` | 87 | reported | |
| `e2.burst.hook.totalTokens` | 743 | reported | |
| `e2.burst.hook.headerOverheadTokens` | 24.3 | reported | |
| `e2.burst.hook.idsPublished` | 10 | | |
| `e2.burst.hook.idsDelivered` | 10 | = published | PASS |
| `e2.burst.hook.allDelivered` | true | true | PASS |
| `e2.burst.hook.maxShowsPerId` | 1 | = 1 | PASS |
| `e2.burst.hook.maxDelayCalls` | 1 | ≤ 2 | PASS |
| `e2.hook.p50Ms` | 64.39 | reported | |
| `e2.hook.p99Ms` | 72.41 | ≤ 150 ms | PASS |

### Verdict

E2a–E2e all PASS. An empty mailbox adds 0 bytes, so the hook can stay on for every Claude step. Polling `bus_read` on
every call costs 560 tokens over 40 empty calls. That is the cost a hook-less engine pays if it polls, so those
engines should read at step start and on demand rather than on every call. The burst (about 3 000 chars against
the 2 000-char budget) arrived over two calls, each id exactly once. The hook adds about 64 ms per tool call, almost
all of it node start-up. The step-start path delivers mid-step messages 21 to 36 calls late; that delay is the
lead time the bus removes.

## E3 Two implementers and a contract change

E3 is computed from a step model (§4.3 of the plan, restated here), not measured on real agents.

### Hypothesis

A mid-task announcement on the bus cuts rework and lead time versus today's review loop, at the delivery delay the
real hook achieves, and the review loop still catches an agent that ignores the message.

### Method

`e3-contract-change.mjs`. Agent A owns `lib.mjs` and changes `price(item)` to `price(item, { currency })` in tick k;
the new form throws without `currency`. Agent B writes one call site per tick in S_B (`spread` = ticks 1..10,
`late` = 6..10). Both advance in lockstep ticks 1..10: A's tool call, then B's tool call, then B's real
PostToolUse hook (`lib/hook.mjs`). Rework counts every stale call site in both arms, including sites written before
the change. Arms: `bus-act` (B rewrites stale sites the tick the hook shows the message), `bus-ignore` (B sees it
and does nothing), and `review` (the reviewer finds the stale sites after tick 10, then one fix cycle). The script
measures the delay d from the actual hook output and compares the measured rework with the model's prediction at
d = 0. Each arm's final `cart.mjs` is run against the final `lib.mjs`. Topologies: `decompose` (separate sessions,
`run.r_e3.siblings`), and `subagents` (A, B, C and a late joiner D are sub-agents of one session on
`run.r_e3.team.impl`, all running the same hook command line). 36 cases: 2 variants × k ∈ {2, 5, 8} × 2 topologies
× 3 arms.

### Numbers

| key | value | threshold | verdict |
|---|---|---|---|
| `e3.cases` | 36 | | |
| `e3.decompose.spread.meanRatio` | 0.5 | ≤ 0.55 | PASS |
| `e3.decompose.late.meanRatio` | 0.2 | ≤ 0.25 | PASS |
| `e3.subagents.spread.meanRatio` | 0.5 | reported | |
| `e3.subagents.late.meanRatio` | 0.2 | reported | |
| `e3.busAct.maxD` | 0 | measured | |
| `e3.busAct.maxLeadTime` | 1 | ≤ 1 tick | PASS |
| `e3.review.meanLeadTime` | 6 | reported (N − k + 1) | |
| `e3.busAct.reviewCycles` | 0 | 0 | PASS |
| `e3.busAct.meanMakespan` | 14 | reported | |
| `e3.review.meanMakespan` | 19.5 | reported | |
| `e3.busAct.meanMailboxTokens` | 74 | reported | |
| `e3.allCorrect` | true | every arm passes | PASS |
| `e3.allMeasuredEqualsPredicted` | true | measured = model | PASS |
| `e3.ignoreEqualsReview` | true | bus-ignore rework = review | PASS |
| `e3.subagents.deliveredOnce` | true | B, C, D once each | PASS |
| `e3.subagents.selfShows` | 0 | A shown 0 times | PASS |
| `e3.subagents.cursorsUnmovedByA` | true | true | PASS |
| `e3.subagents.reworkEqualsDecompose` | true | true | PASS |
| `e3.subagents.lateJoinerFirstCall` | true | D sees it on its first call | PASS |
| `e3.subagents.lateJoinerFirstCallTokens` | 78 | reported | |

### Verdict

E3a–E3d all PASS. The real hook delivered every announcement on the first tool call after it was published (d = 0),
so the measured rework equals the model at d = 0. The bus halves rework when B writes all along (`spread`), and
removes most of it when B writes late (`late`, 0.2). Lead time drops from 6 ticks on average to 1, and makespan
from 19.5 to 14 steps. The thresholds sit between the model's d = 0 and d = 1 values (0.60 and 0.33), and
`test/e3-model.test.mjs` shows that a hook lagging one call really moves rework from 5 to 6. So the pass reflects the
measured delay, not the script's arithmetic. A late-spawned sub-agent D learned the change from the step-start mark
on its first call, at a cost of 78 tokens.

What this does NOT show: whether a real model acts on the message. The `bus-ignore` arm bounds that case: rework
falls back to today's, and the review loop still catches it.

## E4 Two hosts, pull replication

### Hypothesis

SQLite→SQLite replication by cursor pull over HTTP, in a full mesh, is near-real-time, heals partitions without loss,
survives a crash mid-ingest, and gives an unauthenticated peer nothing.

### Method

`e4-two-host.mjs` spawns two `host.mjs` processes (`h_a`, `h_b`), each with its own DB and an outbox server on
127.0.0.1 port 0, each long-poll pulling the other in pages of 100. Phases: steady (1 000 messages each side at
200/s); partition (B's puller paused for 3 s while A publishes 5 000, then resumed); crash (B is stopped, A publishes 5 000,
B restarts with `--die-after-pages 3` and SIGKILLs itself inside the ingest transaction of its 3rd page, after the
rows and before the cursor; then it restarts normally on the same DB, and `recoverMs` runs from that respawn); auth (30 pulls with no token or a wrong one,
plus a POST and a PUT). Lag = ingest time − the envelope's `ts`, on one machine clock. Loss and per-origin
order are checked against the origin's own outbox. A duplicate ROW cannot exist (`id` and `(origin, seq)` are
UNIQUE), so `rePulled` counts what a broken cursor would show instead: the rows the puller received again (its
`duplicates`). `--split-cursor` is the contrast: the crash host writes the cursor in a second transaction, and the
quick test asserts that it re-pulls the whole 3rd page (100 rows).

### Numbers

| key | value | threshold | verdict |
|---|---|---|---|
| `e4.steady.n` | 1000 | | |
| `e4.steady.lagP50Ms` | 2 | reported | |
| `e4.steady.lagP99Ms` | 4 | ≤ 250 ms | PASS |
| `e4.partition.backlog` | 5000 | | |
| `e4.partition.catchUpMs` | 91 | ≤ 5 s | PASS |
| `e4.partition.loss` | 0 | 0 | PASS |
| `e4.partition.rePulled` | 0 | 0 | PASS |
| `e4.partition.orderViolations` | 0 | 0 | PASS |
| `e4.crash.rowsAtKill` | 200 | 2 committed pages; the 3rd rolled back | |
| `e4.crash.recoverMs` | 219 | reported | |
| `e4.crash.loss` | 0 | 0 | PASS |
| `e4.crash.rePulled` | 0 | 0 | PASS |
| `e4.auth.requests` | 32 | | |
| `e4.auth.refused` | 32 | all refused | PASS |
| `e4.auth.rowsChanged` | 0 | 0 | PASS |
| `e4.total.loss` | 0 | 0 | PASS |
| `e4.total.rePulled` | 0 | 0 | PASS |
| `e4.total.orderViolations` | 0 | 0 | PASS |

### Verdict

E4a–E4d all PASS. Loopback is far kinder than a real network, so the 4 ms p99 is a floor for the protocol, not a LAN
number. What carries over is correctness: a 5 000-row backlog healed with no loss, re-pull or reordering, and a
kill inside the 3rd page's ingest lost nothing and re-pulled nothing, because rows and the peer cursor commit in one
transaction (with the cursor split out, the same kill re-pulls 100 rows).

## Not tested

- Brokers (NATS/JetStream, Redis Streams, Postgres LISTEN/NOTIFY): not installed; compared on paper only.
- Real model tokens and real agent behaviour: simulated by decision (no paid model call). Token counts are a
  bytes/4 heuristic.
- `agent_id` and `additionalContext` in a live Claude Code session: taken from the Claude Code hook docs, not
  verified here.
- E2B sandboxes: the code is on `claude/e2b-*` branches only, not on dev.
- Hooks for non-Claude engines: none exist; E2 measures what MCP polling would cost them.
- Relay through a peer and more than two hosts: the full mesh is designed; two hosts were measured.
- Real multi-machine clock skew: both hosts shared one clock.
- Windows: not run.
- Secret redaction of message bodies: the design calls for the existing redaction; the spike does not redact.

## Recommendation

Build the bus on SQLite, in the existing `worca-cc.db`, and do not add a broker. Every local and two-host
correctness claim held, and the costs are small: about 30 000 single-row publishes per second, a few milliseconds
to another process with the `-wal` watcher, 0 bytes per tool call when nothing is waiting, and about 37 tokens of
header per delivered message.

Order of work: P1 (durable `bus_messages`/`bus_cursors` behind `broadcast` and the RunHarness emitter, no behaviour
change). Then move `pipeline_commands` and `directions.ndjson` onto `run.<runId>.control` and
`run.<runId>.directions`. Then P2, the Claude PostToolUse mailbox for step agents with per-sub-agent consumers,
gated on a live check that real payloads carry `agent_id` and that `additionalContext` reaches the model. Engines
without hooks get step-start delivery plus an on-demand `bus_read`, not a poll on every call (E2: 560 tokens per
40 empty calls). Cross-chat messaging (P3) and cross-host pull (P4) follow; a broker adapter (P5) stays optional
until a deployment needs one.
