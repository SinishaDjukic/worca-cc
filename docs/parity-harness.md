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
   `GET /api/projects` must answer 401 first. Every route must answer 401 except the 4 in
   `tools/parity/public-routes.json` (`GET /api/health`, which must answer only `name` and `version`, and the Teams,
   GitHub and Azure DevOps ingress webhooks, which must answer a 4xx other than 401 without a valid token).
4. **UI server** at fixed paths (`$TMPDIR/worca-parity/home` and `…/sandbox`, wiped per launch, mode `0700`, guarded
   by a lock dir) so both sides show the same paths. 9 pages (Chat home, a chat thread, New run, Runs list, a live
   run, History detail, Settings, Labs, Statistics) are captured in light and dark (18 PNGs, 1280×800), then the 6
   flows run: open every page; send a chat message and see the reply; start a mock run from New run and see it hand
   off to History; open that run from the Runs list and by a fresh link to it in History; change the theme and see it after a reload; turn on the Labs "Flags demo" switch and see its note
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
The docker and package pairs run in `.github/workflows/parity-docker.yml`, on every PR into dev and every push to dev
with no paths filter, meant as a required check.

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

## Differential crawl

`npm run parity -- crawl --a T --b T [--b T …] --out DIR [--workers N] [--screens GLOB] [--no-control] [--keep]`
(`tools/parity/crawl.mjs`) is the exhaustive before/after check: every registered hash route, every dialog, menu, popover,
tooltip and collapsible, and every input, button and shortcut, enumerated from the DOM and compared A vs B (DOM, pixels,
network, console). Targets are `tree:` and `package:` (no Docker). verify:919 row h runs it as dev against the split
tree and against `package:.`; the readiness parity row runs it as dev against the migrated tree.

- **Same seeded database** (`tools/parity/crawl-seed.mjs`). One template per worker, built with A: `seed()` plus every
  entity a route param needs (a run group, a second project and a workspace, a requirement, a project memory, an MCP
  server, a linked local plugin; the first builtin workflow, agent, script, model, MCP set and marketplace), and a feature
  written into the stopped server's DB by the target's own `createSliceFeature` (no route creates one). Every A, control
  and B server starts on a copy at the same fixed path (`$TMPDIR/worca-parity-crawl-K`), so ids, paths and sandbox
  commits match. The live held run cannot survive a restart: it is made per server, on first use, and its id is
  normalised and masked.
- **Variants and flag passes.** The full element exercise runs at 1280×800 and 375×812, light, `expert` (the superset
  level; "advanced" in the request). Every screen is also visited and captured at desktop and 375px in dark/expert,
  light/simple, dark/simple and light/advanced, so each UI level is covered. All of it runs twice: every Labs flag off,
  then every flag on.
- **Routes** (`tools/parity/crawl-routes.mjs`), read in the running app: `PAGE_TITLES`, `SETTING_ENTRIES`, `GROUP_TABS`,
  marketplace `TABS`, and every `const *_TABS = [...]` in the served `app.js` (an unmapped list throws). Hashes found while
  crawling (links and the hash after each action) are added when every id in them is a seed id. Routes are patterns
  (`#history/{projectKey}/{pipelineId}`); each worker fills its own template's ids. A route is *visited* when, in some
  variant and flag pass, it renders its own view without the "Unknown address" fallback. An unvisited route, or one
  whose param the seed cannot fill, fails the run.
- **Elements**, enumerated by one generic selector (`tools/parity/crawl-page.mjs`). Duplicate rows in one list and the
  shared chrome (sidebar, top bar) are exercised once and then listed as skipped, with the reason. Each element starts
  from a fresh load of its screen: text gets typed, then Enter and Escape; a select moves to its next option; a toggle is
  clicked twice; a tip is hovered; everything else is clicked, then Escape. An overlay a click opens has its own elements
  exercised (depth 2). Shortcuts come from `keys-sheet.mjs` `sheetSections` on the Runs and Chat pages (Anywhere's once
  per pass), plus Escape on every screen. An action that made a non-GET `/api` call restarts the server from the
  template, so destructive actions run against the sandbox and never leak into the next one.
- **Recorded per step**: the visible DOM (one line per element, path-prefixed), a viewport PNG, same-origin requests as
  `METHOD path status request-shape response-shape`, console errors and page errors, and the final hash. uuids, thread
  ids, ISO times and epoch ms are normalised. The browser clock is fixed (`clock.json`) and `reducedMotion` is on. DOM
  text and PNGs are stored content-addressed (`dom/SHA.txt.gz`, `png/SHA.png`) and deleted at the end unless `--keep`.
- **External calls stubbed.** In the browser every non-localhost request is aborted and recorded; popups are closed,
  downloads cancelled, native dialogs dismissed (all recorded). The servers start with `buildEnv({ offline: true })`:
  `HTTP(S)_PROXY` points at a dead port with localhost exempt and `NODE_USE_ENV_PROXY=1`, so `gh`, `git fetch` and
  provider calls fail fast and alike on both sides.
- **Control pass.** A is crawled twice (A1, A2). Only what differs between those two becomes a mask (a DOM path, a PNG
  rect, a request key or a console message of one record). Every mask is listed in the report, and a record with more
  than 20 masks is called out. Anything else that differs between A1 and a B fails. `--no-control` skips A2 and the run
  cannot pass.
- **Workers** (`--workers N`, default 8): each has its own fixed root, template, server and Chrome, and a deterministic
  shard of the routes (route i → worker i mod N). Worker K of A and worker K of B use the same root and template.
- **Outputs**: `DIR/report.json` (`pass`, `control`, `a`/`bs` with their tree hashes, `masks`, `comparisons`, `coverage`,
  `minutes`), `DIR/report.md` (coverage with the unvisited and unfillable lists and the skipped elements by reason, every
  mask, and per B every difference with its diff image) and `DIR/diffs/N.png`. `DIR/a1`, `a2` and `bN` hold the records.

Timing (measured on the 11-core dev Mac, 2026-11-01): a step records in a median 0.85 s (p90 1.7 s). One screen like
`#workspace-create` (109 elements) takes about 6 min per side on one worker, across both exercise variants, all 12
variants' screen visits and both flag passes. The catalogue has 122 registered routes, and a full crawl (A1, A2 and two
Bs) runs for hours even with 8 workers: run it detached. Check a change on one screen first with `--screens`.

Determinism: a dev-vs-dev crawl must PASS. If it does not, fix the crawler's wait conditions, normalisation or Chrome
flags (`CRAWL_CHROME_ARGS`), never the masks; review any record the report lists with more than 20 masks. What a crawled
page holds still: a fixed clock, a seeded `Math.random`, repeating timers of 1 s or more frozen, reduced motion, every
font face loaded, one fixed port per worker, and the deterministic raster. Settle waits for network and WebSocket quiet
from the action, no chat turn in flight, DOM quiet, and two equal screenshots. Held-run ids, client random ids and
entrance-animation markers are normalised, and the seeded feature never fires its next slice.

## Against the split tree

`node tools/split-by-feature.mjs --apply` builds the split tree. Run it in a throwaway shared clone of a clean commit,
never in this checkout, then compare:

```
S=$(mktemp -d)/split
git clone --shared --no-checkout . "$S"
git -C "$S" checkout --detach HEAD
ln -s "$PWD/node_modules" "$S/node_modules"
node tools/split-by-feature.mjs --apply --root "$S"
npm run parity -- run --a tree:. --b tree:"$S" --out /tmp/p-split
```

`npm run readiness -- run` (see [split-by-feature.md](split-by-feature.md)) builds the split tree in a scratch clone and
runs this comparison as its `parity` row.

The CLAUDE.md feature-index step was skipped: `docs/INDEX.md` and `tools/docs-index.mjs` are absent at this
checkpoint.
