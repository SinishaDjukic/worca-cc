---
name: api-test-drain-response-bodies
description: Why an api-*.test.mjs file that boots ui/server.mjs on port 0 can take 30 s and print "write EPIPE" even though every test passes; what the in-process server ne
paths: test/api-*.test.mjs
updated: 2026-10-17T23:13:20.930Z
author: Bulibas
---

The `test/api-*.test.mjs` harness boots `app` from `ui/server.mjs` with `http.createServer(app)`
and closes it in `after()` with `srv.close()`. Node's `fetch` keeps the socket alive, and
`srv.close()` waits for every open connection. A response whose body was never read (for example
`(await fetch(url)).headers.get(...)` on a large static file) keeps its socket busy. The file then
hangs for about 30 s until the keep-alive times out, and prints `Error: write EPIPE` after the
summary. All tests still report as passing, so it is easy to miss.

Rule: consume every response body in these tests (`await r.arrayBuffer()`, `r.json()`, or
`r.body.cancel()`), including ones you only read headers or the status from. A healthy api test
file finishes in well under a second, so check the `duration_ms` line.

An api test imports `ui/server.mjs` and listens itself, so nothing inside `if (isMain)` runs (checked
2026-10-18): no `startTeamMemoryBackground`/team-metrics ticks, no scheduler, and no
`teamMemoryEvents` → `memory-changed` bridge (a follow's frame). A WS test that pins exact
`memory-changed` counts therefore sees only the route emitters (`emitMemoryChanged` calls) and is
deterministic; a real server can add a frame when a seeding's fetch follows a teammate's update.

Two related traps when running the suite:
- Running the full suite with `FORCE_COLOR=1` in the environment makes
  `test/graph-script-runner.test.mjs` fail on ANSI codes in the captured shell output. Unset it:
  `env -u FORCE_COLOR -u WORCA_HOST_PID HOME="$(mktemp -d)" npm test`.
- `test/bridge-view.test.mjs` pins the number of `.mv-pv-row` rows in the Providers card. A new
  row on that card has to update the pin.
