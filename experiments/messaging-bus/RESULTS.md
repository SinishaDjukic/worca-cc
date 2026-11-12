# Messaging bus spike: results

The design these experiments test is `docs/design/messaging-bus.md`. Raw numbers are in `results/e1.json` …
`results/e7.json` (full run, `node experiments/messaging-bus/run-all.mjs`; E5–E7 were run on their own, so
E1–E4's files were not regenerated). Every `key | value` row below is copied
from that file's `summary` object, and `test/results.test.mjs` checks that they match. The `threshold` and `verdict`
cells are judgements against the plan's §6 table.

A FAIL would be a result, not a defect. One threshold failed on this machine: `e5.addedMs.edit.p99` (37.6 ms against
≤ 30 ms), under host load; E5's verdict explains why it measures spawn jitter, not detector work. Every other
threshold passed.

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

## E5 Hook detector on scripted traces

### Hypothesis

A mechanical detector in the PostToolUse hook finds every contract change an agent makes (exports, SQL, JSON schema,
config shape, edits outside the task's file list) with precision and recall ≥ 0.90. It stays silent on ordinary work,
never leaks a secret, coalesces bursts to the net surface diff, and adds ≤ 30 ms per Edit and ≤ 150 ms per Bash call.

### Method

`e5-detector.mjs` builds the corpus in `lib/trace-corpus.mjs`. Each case runs in a fresh `mkdtemp` git repo with
its setup committed and one bus DB, and the REAL `lib/hook.mjs` is spawned per tool call with `--detect`. Bash cases
run their effect between the Pre and Post hook calls: a real `git mv`, and for the `sed -i` cases the same text
replacement done in JS (no generator case is in the corpus). At case end the runner calls
`flushPending` in-process (`force:true`) and publishes its drafts, standing in for the product's step-end flush. A
match = one published message of the case names the expected file, reason and every expected name. The behaviour
cases (`dedup`, `revert`, `burst`, `loop`) are counted on their own, not in precision and recall. Timing pairs run
the same calls with and without `--detect`. Stated bias: the corpus and the detector come from the same author; E7's
replay is the out-of-sample check.

### Numbers

| key | value | threshold | verdict |
|---|---|---|---|
| `e5.cases.contract` | 32 | ≥ 30 | PASS |
| `e5.cases.ordinary` | 65 | ≥ 60 | PASS |
| `e5.precision` | 1 | ≥ 0.90 | PASS |
| `e5.recall` | 1 | ≥ 0.90 | PASS |
| `e5.falsePositiveRate` | 0 | ≤ 0.05 | PASS |
| `e5.secretLeaks` | 0 | 0 | PASS |
| `e5.maxBodyChars` | 107 | ≤ 600 | PASS |
| `e5.maxDataBytes` | 382 | ≤ 1 024 | PASS |
| `e5.dedup.publishes` | 1 | 1 | PASS |
| `e5.dedup.finalAfter` | price(item, opts) | the final signature | PASS |
| `e5.revert.publishes` | 2 | 2 | PASS |
| `e5.revert.lastReverted` | true | true | PASS |
| `e5.debounce.messages` | 2 | 2 | PASS |
| `e5.debounce.coalescedNames` | 3 | 3 (the later names) | PASS |
| `e5.stateMatchesFinal` | true | true | PASS |
| `e5.loop.messages` | 2 | reported |  |
| `e5.loop.maxHop` | 2 | ≤ 2 | PASS |
| `e5.detectErrors` | 0 | 0 | PASS |
| `e5.addedMs.edit.p50` | 3.1 | reported |  |
| `e5.addedMs.edit.p99` | 37.6 | ≤ 30 ms | FAIL (noisy, see the verdict) |
| `e5.addedMs.bash.p50` | 41.9 | reported |  |
| `e5.addedMs.bash.p99` | 85.5 | ≤ 150 ms | PASS |
| `e5.hookMs.p99` | 99.8 | ≤ 150 ms (E2) | PASS |
| `e5.inProcessMs.p99` | 0.85 | reported |  |
| `e5.recallByReason.config` | 1 | reported |  |
| `e5.recallByReason.export` | 1 | reported |  |
| `e5.recallByReason.json-schema` | 1 | reported |  |
| `e5.recallByReason.outside-task` | 1 | reported |  |
| `e5.recallByReason.sql` | 1 | reported |  |

### Verdict

Every correctness threshold PASS; one timing threshold does not hold reliably. On this corpus the detector found every planted contract change in all five reasons and
published nothing for the 65 ordinary cases, including a reformatted multi-line export, a new export, test and
Markdown edits, a Bash change to a sibling's file, and `.env.local` / `deploy.pem` edits outside the task list. The
net-diff rule gave exactly the planned message counts (1 for change → revert → reapply, 2 with `reverted:true` for
change → revert, 2 for a 4-edit burst), and after every flush the announced surface equalled the real one. The hop
rule stopped the A→B→A chain at hop 2. Bodies stayed far under the caps.

Timing: the detector adds about 3 ms at the median to an Edit and about 42 ms to a Bash call (the two `git`
snapshots); the detect pass itself is 0.85 ms p99 in-process, and the whole hook stays at 99.8 ms p99, under E2's
150 ms. The Edit p99 is the difference of two process spawns over 60 samples, so it is close to the worst sample: four
runs on this host at load 2–3 gave 37.6 (the committed run), 25.5, 41.6 and, before the review fixes, 10.3 ms. The
≤ 30 ms threshold is therefore NOT met reliably, though the cost is spawn jitter and not detector work. The Bash p99
ranged from 85 to 91 ms (one outlier run: 276 ms).
Perfect scores on a corpus written by the detector's author show the rules are implemented as designed, not that they
generalise; that is E7's question.

## E6 E3 re-run with the detector as the trigger

### Hypothesis

When the hook detector publishes A's `contract.changed` (no scripted `bus.publish`), E3's results are unchanged: same
rework, lead time, makespan and correctness per case, no false publishes, and A never sees its own message.

### Method

`e6-detector-e3.mjs` runs E3's 36-case grid through `runCase` with `trigger:'detector'` and again with the scripted
trigger. In detector mode A has a hook too: every tick A makes a body-only or comment Edit on `lib.mjs`, except at
tick k, where its Edit replaces the v1 signature with v2. A's hook runs `--detect` with a task map in which A owns
`lib.mjs` and B owns `cart.mjs`. Order inside a tick: A's tool call and A's hook run before B's tool call and B's
write, the same order as E3's scripted publish. `msgId` is read from the bus. `results/e3.json` is not regenerated.

### Numbers

| key | value | threshold | verdict |
|---|---|---|---|
| `e6.cases` | 36 |  |  |
| `e6.decompose.spread.meanRatio` | 0.5 | ≤ 0.55 | PASS |
| `e6.decompose.late.meanRatio` | 0.2 | ≤ 0.25 | PASS |
| `e6.subagents.spread.meanRatio` | 0.5 | reported |  |
| `e6.subagents.late.meanRatio` | 0.2 | reported |  |
| `e6.busAct.maxLeadTime` | 1 | ≤ 1 tick | PASS |
| `e6.busAct.maxD` | 0 | measured |  |
| `e6.busAct.reviewCycles` | 0 | 0 | PASS |
| `e6.review.meanLeadTime` | 6 | reported |  |
| `e6.busAct.meanMakespan` | 14 | reported |  |
| `e6.review.meanMakespan` | 19.5 | reported |  |
| `e6.busAct.meanMailboxTokens` | 57.5 | reported |  |
| `e6.allCorrect` | true | true | PASS |
| `e6.allMeasuredEqualsPredicted` | true | true | PASS |
| `e6.ignoreEqualsReview` | true | true | PASS |
| `e6.subagents.deliveredOnce` | true | true | PASS |
| `e6.subagents.selfShows` | 0 | 0 | PASS |
| `e6.subagents.cursorsUnmovedByA` | true | true | PASS |
| `e6.subagents.reworkEqualsDecompose` | true | true | PASS |
| `e6.subagents.lateJoinerFirstCall` | true | true | PASS |
| `e6.subagents.lateJoinerFirstCallTokens` | 62 | reported |  |
| `e6.equalsScripted` | true | true | PASS |
| `e6.falsePublishes` | 0 | 0 | PASS |
| `e6.autoPublishes.perCase` | 1 | reported |  |
| `e6.meanBodyTokens` | 14 | reported |  |
| `e6.selfShows` | 0 | 0 | PASS |

### Verdict

Every threshold PASS. All 36 cases equal their scripted twins, and the detector published exactly once per case, at
tick k, with 0 false publishes on the body-only and comment edits of the other ticks. A was shown its own message 0
times. The auto message is shorter than E3's hand-written one (14 body tokens; mean mailbox tokens 57.5 against
E3's 74), so the real hook's announcement is cheaper than the scripted one and just as early.

## E7 Noise on a replay of a real Decompose run

### Hypothesis

With layers 1 and 2 on and a modelled layer 3, a real Decompose run's agents see a small number of messages: a mean
of ≤ 1 500 tokens per task reader and a max of ≤ 4 000, ≤ 60 header tokens per message, no lifecycle message shown
to its own step, and no leak. The layer 2 count on real edits is the out-of-sample false-positive check.

### Method

`e7-noise.mjs` replays pipeline `03-10-26-built-in-terminal-pane-github-573` (14 tasks in 7 phases; phase 2 has 4
parallel tasks) from `test/fixtures/replay-decompose.json.gz`, built once by `tools/build-replay.mjs`.
- The touch pattern is real: every implementer Edit / Write / Bash record of the run's log, in log order.
- The content is the run's real final diff, applied hunk by hunk BY POSITION to the real base blobs: the replay tree
  is seeded with `git cat-file -p <base blob>` from this repository. Per path, the k-th armed call gets the k-th
  hunk. At the end each armed path's text is checked against the final blob id.
- Each task call writes the file and then spawns the REAL hook with `PostToolUse`, `--detect`, topic
  `run.<r>.siblings`, the phase's task map, and one consumer per task.
- Bash records are replayed as Pre + Post hook calls WITHOUT effects: the log keeps only ~87 chars of each command
  and no output. They measure the snapshot cost but never exercise Bash detection.
- The fix cycle (no task suffix) is counted, not armed: a single fix agent has no siblings.
- Layer 1 events are published at the scheduler points (step start/finish, task done, verdict per review cycle).
  Each task's hook reads the step topic `run.<r>.step.impl` as well as `siblings`, so only the order "publish
  `step.started`, then set the step-start mark" keeps a step's own lifecycle rows away from its agents.
- Layer 3 is a MODEL, not measured: reviewer findings = the review's blocking count; 1 implementer question per task
  in a phase with ≥ 2 tasks; 0 deliberate contract changes.
- Cost = what `readRenderAck` really shows each reader (`estimateTokens`).

### Numbers

| key | value | threshold | verdict |
|---|---|---|---|
| `e7.replay.calls` | 171 |  |  |
| `e7.replay.armedCalls` | 69 |  |  |
| `e7.replay.bashCalls` | 77 |  |  |
| `e7.fixCycle.calls` | 25 | counted, not armed |  |
| `e7.replay.baseMissing` | 0 | 0 | PASS |
| `e7.replay.unapplied` | 0 | 0 | PASS |
| `e7.replay.nonUnique` | 0 | reported |  |
| `e7.replay.contentlessCalls` | 0 | reported |  |
| `e7.replay.finalMismatch` | 0 | 0 | PASS |
| `e7.replay.unarmedPaths` | 15 | reported |  |
| `e7.replay.degraded` | false | false | PASS |
| `e7.detectErrors` | 0 | 0 | PASS |
| `e7.tasks` | 14 |  |  |
| `e7.layer1.messages` | 36 | reported |  |
| `e7.layer2.messages` | 0 | reported; judged by hand |  |
| `e7.layer3.modelledMessages` | 15 | modelled |  |
| `e7.agentShown.total` | 26 | reported |  |
| `e7.perReader.meanTokens` | 105.9 | ≤ 1 500 | PASS |
| `e7.perReader.maxTokens` | 303 | ≤ 4 000 | PASS |
| `e7.perReader.maxMessages` | 6 | reported |  |
| `e7.headerTokensPerMessage` | 21.6 | ≤ 60 | PASS |
| `e7.layer3.promptTokens` | 6072 | reported |  |
| `e7.lifecycleShownToOwnStep` | 0 | 0 | PASS |
| `e7.secretLeaks` | 0 | 0 | PASS |

### Verdict

The replay is valid (no missing base, every hunk applied, every final blob matched, no detector error), so the noise
numbers count. Every threshold PASS. The busiest reader (`p2t3`, in the 4-task phase) saw 6 messages for 303 tokens
over its whole task; the mean was about 106 tokens. Headers cost about 22 tokens per message. Layer 3's fixed prompt
cost (6 072 tokens across every agent that would get the fixtures) is far larger than the message traffic, which
supports the default `prompt:false`.

Layer 2 published 0 messages on the real paths. Judged by hand against the real diff (a manual judgement): the run
changed three existing exports. `busyRunIds` (`src/core/checkout.mjs`) kept its `(extra = [])` parameters and only
its body changed, and `SCHEMA_VERSION` (`src/core/db.mjs`) changed value, not shape; neither is a contract change by
the §3.3 rules, so 0 is correct for them. The one real signature change, `isDeadOwner` in `src/core/artifacts.mjs`
(its options became optional), was made by no armed task call: that path is among the 15 unarmed paths. So E7 shows no
false positive on real edits, but it gives no out-of-sample recall number.

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
- Secret redaction of the bodies agents write themselves (E1–E4, layer 3): the design calls for the existing
  redaction; the spike redacts only what the hook publishes (`lib/redact.mjs`, E5–E7).
- Live `tool_response.originalFile`: the detector uses it for a Write's before text when present; whether real
  PostToolUse payloads carry it is unverified (the cache and `git show HEAD` fallbacks were what ran).
- Real model behaviour on layer 3: E7 models the prompt-rule messages (questions, findings); no model was asked.
- Bash detection on real traces: E7 replays Bash records without effects; only E5's scripted Bash cases exercise it.
- Non-JS languages: the export surface covers JS/TS only; other languages have no surface.

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

Publish triggers (E5–E7), cheapest first: layer 1 (orchestrator lifecycle events and directions, no agent
involved) ships with P1/P2; layer 2 (the hook detector, `--detect`) ships with the P2 mailbox and is on by default
for Decompose slices and in-agent fan-out; layer 3 (per-role prompt rules) stays off by default and is switched on
per workflow node, because its fixed prompt cost outweighs the message traffic it adds.
