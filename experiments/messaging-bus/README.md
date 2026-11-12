# Messaging bus spike

Self-contained experiments for the bus design in `docs/design/messaging-bus.md`. This is not a product
feature: nothing here is wired into the server or the orchestrator, and nothing imports from `src/`. The code
uses Node built-ins only (`node:sqlite` needs Node ≥ 22.19). The results and the recommendation are in
[RESULTS.md](RESULTS.md).

## What is here

| Path | What it is |
|---|---|
| `lib/envelope.mjs` | The envelope: time-ordered ids, topic rules, size and hop limits, `BusError` |
| `lib/consumer-id.mjs` | Consumer id `<prefix>:<sessionId>:<agentKey>` and own address from a PostToolUse payload |
| `lib/render.mjs` | The fenced, untrusted mailbox text; renders a prefix and announces the rest |
| `lib/sqlite.mjs`, `lib/sqlite-bus.mjs` | The SQLite transport: outbox, per-(consumer, origin) cursors, marks, `readRenderAck` |
| `lib/emitter-bus.mjs` | The in-process EventEmitter baseline with the same read rules |
| `lib/hook.mjs` | The Claude PostToolUse mailbox hook (prints nothing when empty) |
| `lib/mcp-mailbox.mjs` | The mailbox as an MCP stdio server (`bus_read`, `bus_publish`) |
| `lib/replicate.mjs`, `host.mjs` | Cursor-pull replication over loopback HTTP, and E4's host process |
| `lib/task-files.mjs` | Parses a task file's `## Files you may touch` list; builds the task map |
| `lib/surface.mjs` | Export / SQL / JSON schema / config surfaces of a file, and their breaking diff |
| `lib/redact.mjs` | Secret-value masking and the secret-path list for auto-published bodies |
| `lib/detect-state.mjs` | The detector's state tables (announced / current surface, windows, counters, snapshots) |
| `lib/detector.mjs` | The pure layer 2 detector: `detect`, `planPublishes` (net-diff coalescing, caps, hops), `flushPending` |
| `lib/publish-layers.mjs` | `resolvePublishLayers`: the `busPublish` workflow switch |
| `lib/prompts.mjs`, `prompts/*.md` | The layer 3 per-role prompt texts and their token cost |
| `lib/trace-corpus.mjs` | E5's scripted tool-call corpus |
| `lib/replay-tree.mjs` | E7's replay tree: seeds base blobs, applies hunks by position, builds tool inputs |
| `tools/build-replay.mjs` | Builds `test/fixtures/replay-decompose.json.gz` from a past pipeline (run once) |
| `e1-outbox-bench.mjs` | E1: publish throughput, cross-process latency per wake mode, restart recovery, prune |
| `e2-mailbox-tokens.mjs` | E2: injected bytes/tokens per tool call for hook, MCP poll and step start |
| `e3-contract-change.mjs` | E3: a breaking contract change, bus vs review loop (a step model with measured delivery) |
| `e4-two-host.mjs` | E4: two hosts, steady / partition / crash / auth |
| `e5-detector.mjs` | E5: detector precision, recall, false positives, coalescing and added ms on scripted traces |
| `e6-detector-e3.mjs` | E6: E3 re-run with the detector as the publish trigger |
| `e7-noise.mjs` | E7: messages and tokens per reader on a replay of a real Decompose run |
| `run-all.mjs` | Runs E1–E7 and writes `results/e1.json` … `results/e7.json` |

`sqlite-bus.mjs` has three helpers beyond the plan's `BusTransport` contract, used by the experiments and tests:
`publishBatch` (E1's 100-row transactions), `cursors(consumer)` (reading the cursor rows), and the `db` and `origin`
properties.

## Running

From the repository root:

```
node experiments/messaging-bus/run-all.mjs            # full run (about 90 s here) → results/*.json
node experiments/messaging-bus/run-all.mjs --quick    # small N, each script well under 60 s
node experiments/messaging-bus/e1-outbox-bench.mjs --quick --out /tmp/e1.json   # one script
```

Each script prints a one-line JSON summary on stdout and writes the full result (with a `summary` object) to
`--out`, by default `results/<exp>.json`. Databases are created under `os.tmpdir()` and removed afterwards. Every
child process a script starts is recorded and stopped in a `finally`.

If you re-run the full suite, update the numbers in `RESULTS.md`: `test/results.test.mjs` checks every
`key | value` row against `results/*.json`.

## Tests

The tests run by explicit path with the repo's runner. `npm test` does not discover them, because its
discovery is `test/*.mjs`:

```
env -u WORCA_HOST_PID node tools/test.mjs \
  experiments/messaging-bus/test/envelope.test.mjs experiments/messaging-bus/test/consumer-id.test.mjs \
  experiments/messaging-bus/test/render.test.mjs experiments/messaging-bus/test/sqlite-bus.test.mjs \
  experiments/messaging-bus/test/delivery.test.mjs experiments/messaging-bus/test/replicate.test.mjs \
  experiments/messaging-bus/test/e3-model.test.mjs experiments/messaging-bus/test/experiments-quick.test.mjs \
  experiments/messaging-bus/test/design-doc.test.mjs experiments/messaging-bus/test/results.test.mjs \
  experiments/messaging-bus/test/scope.test.mjs experiments/messaging-bus/test/task-files.test.mjs \
  experiments/messaging-bus/test/surface.test.mjs experiments/messaging-bus/test/redact.test.mjs \
  experiments/messaging-bus/test/detector.test.mjs experiments/messaging-bus/test/publish-layers.test.mjs \
  experiments/messaging-bus/test/prompts.test.mjs experiments/messaging-bus/test/replay-tree.test.mjs \
  experiments/messaging-bus/test/replay-fixture.test.mjs
```

`test/scope.test.mjs` checks that only `docs/design/messaging-bus.md` and this folder differ from the run
checkpoint `70ae23e5b8fb20c28342944a6ca251e1b9ad02b0` (override with `BUS_SCOPE_BASE`). It goes stale once this
branch merges: it then skips when that commit is missing or not an ancestor of HEAD. That is harmless, because
`npm test` never runs it.
