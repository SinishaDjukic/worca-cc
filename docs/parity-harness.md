# Parity harness

`node tools/parity.mjs` (or `npm run parity --`) proves that two builds of Worca behave the same: the same API
routes with the same answers, the same signed-out wall, the same main flows, the same pixels on the main pages, and
boot and page-load times within budget. It was built for #919 (moving code out of `ui/server.mjs`, `style.css` and
`index.html` into per-feature files), but it compares any two targets.

## Commands

```
node tools/parity.mjs snapshot --target T --out DIR                       one target → DIR/snapshot.json + DIR/shots/*.png
node tools/parity.mjs compare  --a DIR --b DIR --out DIR                  two snapshots → report.json + report.md
node tools/parity.mjs run      --a T --b T --out DIR [--quick] [--no-timing-gate]
```

`run` takes both snapshots, with the boot and page-load timings interleaved (A, B, A, B, …), then compares them.
`--quick` takes one timing sample per side instead of 5 (timings are then reported, not gated).
`--no-timing-gate` reports timings without gating them. Exit 0 means every gate passed; 1 means a gate failed or the
run stopped with a `FAIL (fatal)` line; 2 means the arguments were wrong.

A target `T` is one of:

- `tree:DIR`: a source checkout, started as `node DIR/ui/server.mjs`. Its dependencies must be installed
  (`npm ci --ignore-scripts`).
- `package:DIR`: the `npm pack --ignore-scripts` tarball of that tree, extracted to a temp dir, reusing the tree's
  `node_modules`. No registry request is made.
- `docker:IMAGE`: a container of that image, run with the args of `tools/docker-smoke.mjs` (`--cap-drop ALL`,
  `--security-opt no-new-privileges:true`, a loopback-only port). Build one with `npm run docker:build`.

The browser is the system Chrome (`CHROME_BIN`, or the usual install paths), driven by `playwright-core`.
`CHROME_NO_SANDBOX=1` adds `--no-sandbox` (needed as root in CI).

## What one snapshot does

Every server is a child process with an allowlisted env (`PATH`, `LANG`, `LC_*`, `TMPDIR`, `TERM`, …) plus a temp
`HOME` = `WORCA_HOME`, `WORCA_MOCK=1`, `WORCA_NO_NATIVE_DIALOG=1` and a harness-picked `PORT` (never 4317, the host
app). No token, SSH agent or host config of the operator reaches a target.

1. **Route list.** The target's own node imports its `ui/server.mjs` (no listen) and prints `app._router.stack`,
   nested routers included. Every `/api` route is listed (523 at this checkpoint).
2. **Signed-in probes**, on their own seeded server. Every route classified `probe` in
   `tools/parity/route-classes.json` is called: GETs twice with the seeded ids, other methods once with
   `parity-missing` in every param and `{}` as the body. A response is kept as its status and its JSON *shape*
   (types and sorted keys, never values; data-keyed maps collapse to `{"*": …}`). A GET whose two shapes differ is
   `volatile` and compared by status only. A route that drops the connection or times out (15 s) is `crashed` /
   `timeout`; the server is restarted and re-seeded, and the run fails naming the route.
3. **Signed-out pass**, on an unseeded server in remote mode (`WORCA_ALLOWED_HOSTS=parity.invalid`, an http
   localhost issuer). Every request carries `Host: parity.invalid`, no `Origin` and no identity. A canary
   `GET /api/projects` must answer 401 first. Every route must answer 401 except the 2 in
   `tools/parity/public-routes.json` (`GET /api/health`, which must answer only `name` and `version`, and the Teams
   ingress webhook, which must answer a 4xx other than 401 without a valid token).
4. **UI server** at fixed paths (`$TMPDIR/worca-parity/home` and `…/sandbox`, wiped per launch, mode `0700`, guarded
   by a lock dir) so both sides show the same paths. 9 pages (Chat home, a chat thread, New run, Runs list, a live
   run, History detail, Settings, Labs, Statistics) are captured in light and dark (18 PNGs, 1280×800), then the 5
   flows run: open every page; send a chat message and see the reply; start a mock run from New run and see it hand
   off to History; change the theme and see it after a reload; turn on the Labs "Flags demo" switch and see its note
   after a reload.

The seed goes through the public API only (settings, onboarding, one project, one chat thread with one mock turn,
one mock run finished to `done`, one run held at its clarify question), so it works the same in a container.

## Gates

| Gate | tree vs tree | tree vs package | any pair with docker |
|---|---|---|---|
| Routes (status, shape, existence) | gated | gated | gated |
| Signed out | gated | gated | gated |
| Flows | gated | gated | gated |
| Visuals (0 differing pixels) | gated | gated | reported, not gated (in-container paths and fonts differ) |
| Timings | gated with 5 samples and no `--no-timing-gate` | reported | reported |

Boot time is spawn → the first `200` from `/api/health`; a page load is a fresh document's navigation start → the
app's boot marker (`window.__np.getRun`), for Chat home and the Runs list. The timing gate fails B when its median is more than 10% above A's AND more than the noise floor above it (100 ms
for boot, 50 ms for a page load). A 10% gate alone fails identical trees on noise for ~1.4 s boots. CI runs parity
with `--no-timing-gate` because shared runners are noisier than 10%; the owner can turn it on by removing the flag.

Structural problems also fail a run: no signed-in or signed-out routes, fewer signed-out rows than signed-in ones, a
shot count other than 18, a missing flow, a crashed route.

## Output

`OUT/a/` and `OUT/b/` hold `snapshot.json` and `shots/*.png` per side; `OUT/report.json` and `OUT/report.md` hold
the comparison, plus a `*.diff.png` per differing shot (differing pixels in red over a dimmed copy of A).
A failed flow leaves `OUT/a|b/fail-<flow>.png` when the page could still be shot.

`report.json` always has `pass`, `routeDiffs`, `signedOutProblems`, `failedFlows`, `visualDiffs`, `timings`,
`problems` and `routeCounts` (`{a: {listed, probed, skipped}, b: …}`). `timings` is
`{boot: {a, b, deltaPct, gated, pass}, pages: {"chat-home": {…}, runs: {…}}}`. Snapshots and reports never hold
response values, page text or error messages: a failed flow stores a fixed reason, `METHOD path -> status` entries
and a page-error count.

## Classifying a route

`test/parity-routes.test.mjs` fails on any route the target registers that `tools/parity/route-classes.json` does
not classify, and on any row whose route is gone. Add one row per new route:

- a GET is `probe`, unless its handler calls the network, `git fetch`, `gh`, a native dialog, or streams forever;
- a non-GET with a path param is `probe` (the placeholder id answers 4xx), unless it acts without finding the id;
- a non-GET with no path param is `skip`, unless the reason says why `{}` is harmless ("400 without runId");
- a route that crashes the server in a self-run is `skip` with "crashes the server with {}".

Every row carries a reason. At this checkpoint 48 of 523 routes are `skip`: the network, process and global-state
routes (self-update, push, PR, clone, install, sync-all, terminals, folder dialog, settings reset, shutdown, …).
`skip` routes are still compared for existence, so a removed route shows as `only-in-a`.

## Adding a mask

Regions that hold times, durations, costs and ids differ between A and B. `tools/parity/visual-masks.json` lists
CSS selectors per page; every seeded id (run, held run, pipeline, thread) is also masked on every page by its text.
A mask is never a page container (`body`, `main`, `.view`, `[data-view]`; `test/parity-visual.test.mjs` enforces
it) and never a whole list or section: add the smallest element that holds the changing value.

## Flaky register

`test/flaky-register.json` lists the tests known to fail under full-suite load or in an agent environment, one row per
test: `{file, test, symptom, alone}`, where `test` is the title up to any `…`, and `alone` is `passes alone`,
`fails alone too` or `environment`. A `"*"` row covers only a file-level failure of that file (a load error or a
failing hook), and only as `environment`. The register names flaky tests; it does not fix or retry them.

`node tools/flaky-register.mjs LOG` reads a `node tools/test.mjs` log (spec reporter) and prints every failing test
the register does not cover. Exit 0: none; 1: at least one; 2: the log could not be read (no `ℹ fail N` summary, or
failures reported but none parsed).

## Deferred acceptance

"dev vs the s1 dry-run tree" is **not met yet**: slice 1's `tools/split-by-feature.mjs` refuses both `--dry-run` and
`--apply`, so no split tree exists. The harness was proved on this tree against itself and against a second checkout
of the same commit. Once a split tree exists, run:

```
npm run parity -- run --a tree:. --b tree:/path/to/split-tree --out /tmp/p-split
```

`npm run readiness -- run` (see [split-by-feature.md](split-by-feature.md)) builds the split tree in a scratch clone and
runs this comparison as its `parity` row.

The CLAUDE.md feature-index step was skipped: `docs/INDEX.md` and `tools/docs-index.mjs` are absent at this
checkpoint.
