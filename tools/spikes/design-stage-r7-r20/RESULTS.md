# Design stage R7 and R20: browser probe results

Verdict of plan Task 1 (risks R7 and R20) for Design P4 Stage. Tasks 5, 15 and 17 read `## Needs a ruling` and
`## Fallbacks to apply` below. Task 17 appends `## Proof` and `## Boards`.

## Needs a ruling

None. No row whose failure stops the work or calls for the main session failed:
- **R20 reflow:** `C` held its 600 px in every browser. Its top moved only by the change of `A` and `B` above it.
- **Origin:** every message had `e.origin === 'null'` and `e.source === frame.contentWindow`, in every browser.
- **R20 feedback:** the scale ran to 0.45 with `vh` sections, as the plan expects, and the kit rule's `clamp()` page
  never reached it. Nothing here shows that a real page needs the fallback. Task 17 measures a real build.
- **R16** (a run doc that navigates itself away) failed Task 17's proof in Firefox and WebKit. The review's fix
  cycle 2 added a C-6 report (`loaded`, see `## Proof`). Fix cycle 3 also counts the doc's own load that reaches the
  parent before its `ready`, which closed a page that leaves after its own load. Fix cycle 4 sends that report once per
  doc and only for a trusted `load`, and counts a frame load that comes while the frame is not believed. Fix cycle 5
  lets only that report bring a frame back, never a self-reload's `ready`. All three browsers now pass all four R16
  checks. Nothing is left for the main session.

## Fallbacks to apply

- **R7 fails in WebKit, so R7's fallback applies.** The overlay hides boxes, guides and `+` while `rects` scroll is
  active, and keeps cursors: one flag in `overlay.mjs` (Task 11). No contract change. The plan states this fallback
  with no browser condition.
  - Cause: WebKit runs a sandboxed frame's animation frames every 50 ms until the person clicks in it. A wheel over
    the frame does not lift that. The frame posts `rects` once per animation frame, so the overlay trails a scroll by
    one 50 ms frame: 2.8 to 2.9 screen frames, up to 100 px of travel at 2000 px/s.
  - After a click in the frame, WebKit trails by 1.00 frame, as Chrome and Firefox do.
- **R20:** no fallback. `selectLayout` keeps `viewH = stageH / s` (Task 5), and the box keeps the taller height
  while a zoom in eases (Task 14, L4.26).
- **Tween:** no fallback. `behavior:'instant'` holds under `scroll-behavior:smooth`, so the bridge keeps its rAF
  tween (Task 16, L4.27). In WebKit the tween runs on the same 50 ms frames (9 steps in 400 ms) and still lands on
  time.
- **Origin:** no fallback. `frame-host.mjs` keeps its check (Task 8).
- **For Task 17:** a WebKit run of `overlay within one frame while scrolling` meets the same 50 ms frames unless it
  clicks in the frame first.

## The plan's table, filled

The details of each cell are in `## Runs`. "Frames" are the parent's animation frames, which are the screen's.

| Risk | Measure | Chrome 156 | Firefox 157 | WebKit 27.2 | Pass | What changes if it fails |
|---|---|---|---|---|---|---|
| R7 | During a 2000 px/s scroll, the marker's screen `y` minus the element's screen `y`, over 120 frames, at scale 1 and 0.45 | ok: worst 17.0 ms = 1.02 frames at both scales (34.0 px at 1, 15.3 px at 0.45) | ok: worst 8.5 ms = 1.02 frames at 1, 8.4 ms = 1.00 at 0.45 (17.0 px, 7.5 px; 120 Hz) | **FAIL**: worst 50.0 ms = 2.94 frames at 1 (100.0 px), 48.0 ms = 2.82 at 0.45 (43.2 px). After a click in the frame: 17.0 ms = 1.00 | Worst lag at most about one frame of travel, judged as at most 1.5 frames | Overlay hides boxes, guides and `+` while `rects` scroll is active, keeps cursors. One flag in `overlay.mjs`. No contract change. **Applies** |
| R20 reflow | Set iframe height 1056 → 2000 → 1056. Record each section's rect | ok | ok | ok | `A` tracks `vh`, `B` stops at its clamp, `C` holds. All three browsers: `A` 1056, 2000, 1056; `B` 633.6, 800, 633.6; `C` 600 each time, its top at 1689.6, 2800, 1689.6 | If `C` moves, stop and tell the main session. Not needed |
| R20 feedback | Apply `scale = clamp(776 / spanH, 0.45, fit)` for 8 crew changes with two `100vh` sections running | ok: 0.45 at crew change 1 | ok: 0.45 at crew change 1 | ok: 0.45 at crew change 1 | Note the crew change at which scale hits 0.45 | The fallback: an iframe at `stageH / 0.45` for the whole round. Not needed: the kit rule's page never reached 0.45 |
| R20 ease | Zoom in over 400 ms with the iframe kept at the taller height. Sample the bottom row of pixels every frame | ok: the well in 0 of 25 seeked frames, 0 of 26 live frames short; the control showed it in 23 of 25 | ok: 0 of 25, 0 of 50 live; control 23 of 25 | ok: 0 of 25, 0 of 26 live; control 23 of 25 | The well colour never shows under the page | Zoom in without easing the scale. Not needed |
| Tween | `scrollTo` by rAF over 400 ms with `behavior:'instant'`, on a page with `scroll-behavior:smooth` | ok: at the target after 401 ms, 24 steps, 0 off target | ok: 400 ms, 48 steps, 0 off target | ok: 401 ms, 9 steps, 0 off target | Ends within 450 ms | Send `behavior:'auto'` and drop the tween. Not needed |
| Origin | `e.origin === 'null'` and `e.source === frame.contentWindow` | ok: 847 of 847 messages | ok: 833 of 833 | ok: 661 of 661 | Yes | Stop: `frame-host.mjs` depends on it. Not needed |

## Setup

- **Date:** 2026-11-08.
- **Host:** macOS 26.6.2 (Darwin 25.6.0), arm64, on AC power.
- **Probe:** `tools/spikes/design-stage-r7-r20/probe.mjs`. It is manual: it needs a real browser and is not part of
  `npm test` (M14).
- **Driver:** `playwright-core` 1.64.1. Chromium is the system Chrome that `findChrome()` returns. Firefox and WebKit
  are Playwright's own builds (`firefox-1555`, `webkit-2370`), already installed on this host.

| Browser | Version | Notes |
|---|---|---|
| Chrome | 156.0.8078.80 | The sandboxed frame ran out of process: CDP listed an `iframe` target |
| Firefox | 157.0 | Headless runs both documents at 120 Hz (8.3 ms frames) |
| WebKit | 27.2 | The sandboxed frame's animation frames come every 50 ms until a click in it |

Real Safari was not run: this probe has no `--serve` mode. The 50 ms frames are WebKit's own throttle for a
cross-origin frame the person has not clicked in, so Safari is expected to behave the same. That is not verified here.

## What the probe checks

**The stage.** The parent page is 1280 × 1000. The stage is 1091 × 900 at (20, 20), filled with the well colour
`rgb(255,0,170)`. It holds `.frame-box`, 1280 px wide (the page width, L4.9's fallback), with `transform-origin:0 0`
and `translate(ox,0) scale(s)`. The box is `round(900 / s)` px tall (M11), and the iframe fills it.
- Fit is 1091 / 1280 = 0.852, so the frame at fit is 1056 px tall.
- The floor 0.45 gives 2000 px.
- 776 is 900 − 96 − 2 × 14 (L4.22).

This geometry reproduces the plan's 1056, 2000 and 776.

**The frame.** It is `sandbox="allow-scripts"`, served by the probe's own server on the same host, so its origin is
opaque. It posts `rects` (`scrollX`, `scrollY`, `vw`, `vh`, `docH`, the sections' document rects) at most once per
animation frame on `scroll`, `resize` and a ResizeObserver, as P3's bridge does. `.overlay-doc` is translated by
`-scrollX,-scrollY` on each `rects`. Its markers sit at the reported document `y`s.

**R7 timing (`r7-lag-*`).**
- The frame scrolls by a fixed step in each of its animation frames, and logs each frame's time and `scrollY`. The
  step is sized from the frame's own measured frame interval, so the scroll runs at 2000 px/s.
- In each of its own animation frames, the parent logs the time and the screen `y` of the marker on `C`
  (`getBoundingClientRect`). Both clocks are `performance.timeOrigin` plus the animation-frame time.
- For each parent frame within the drive's 120 measured frames (after 10 warm-up frames), the element's screen `y` is
  where the frame's own log puts it at that moment. Lag is the marker's `y` minus the element's.
- The lag is reported in ms of travel and in parent frames. It passes at 1.5 frames or less ("about one frame").
- `r7-lag-s1-clicked` repeats scale 1 after a click in the frame.
- The marker's `y` agrees with `frameTop + s × (C − scrollY shown)` to 0.01 px ("marker mapping error").

**R7 on screen (`r7-pixels-*`).**
- The frame's filler has a green 6 px stripe every 400 px, and the overlay puts a blue marker on each stripe's
  reported `y`. One screenshot reads the marker tops and the stripe tops.
- The row is judged at rest: the marker must sit within 1.5 px of its stripe.
- Twelve screenshots taken while scrolling are printed but not judged. Firefox's and WebKit's screenshots draw the
  page on request, after both documents have caught up, so they read 0 px. Chrome's are copied from a composited
  frame, but they still read within 1.5 frames with the overlay held back a whole extra frame (see the mutation
  check).

**`frame-raf`.** This row is not in the plan's table; it explains R7 in WebKit. It measures the frame's and the parent's
animation-frame intervals, as the median of 20: fresh, after a wheel over the frame, and after a click in it. It passes
when the fresh frame keeps the parent's pace (at most 1.5 times its interval).

**R20 reflow.** The frame is set to 1056, then 2000, then 1056 px tall, at scale `900 / h`. `A`, `B` and `C` are read
from the `rects` each height produces. Expected:
- `A` = `vh`;
- `B` = `clamp(480, 0.6 vh, 800)`;
- `C` = 600, with its top at `A + B`;
- the way back equal to the start.

**R20 feedback.** There are four runs of the same 8 crew changes. On top of the running `100vh` sections, the extras
are: `c1`; none; `c1`; `c1 c2`; `c2`; none; `c1`; none.
- `vh2` (the plan's measure): `nav` 80, `h1` and `h2` at `100vh`, `c1`, `c2` and `foot` at 300 px. `h1` and `h2` run
  throughout.
- `vh1`: the same page with only `h1`.
- `kit`: `vh1` with `h1` at `clamp(480px,60vh,800px)`, which is the kit rule.
- Fallback: `vh2` with the frame held at `900 / 0.45 = 2000` px for the whole round.

At each change, `spanH` comes from the latest `rects`, `scale = clamp(776 / spanH, 0.45, fit)`, the frame becomes
`round(900 / scale)` px tall, and the probe waits for the reflowed `rects`. The row passes when:
- `vh2` reaches 0.45 (the change is recorded);
- `kit` never does;
- the fallback holds the frame height, and each crew's scale, still.

**R20 ease.**
- The camera starts at 0.45 with the frame 2000 px tall. A WAAPI animation zooms in to fit over 400 ms, with `ease`,
  while the frame stays 2000 px tall.
- The animation is paused and seeked every 16.7 ms (25 frames). Each time, a screenshot of the stage's bottom row is
  checked for well-coloured pixels within the page's columns.
- A live run checks in every animation frame that the box's bottom is not above the stage's.
- Control: the frame set to 1056 px (the zoomed-in height) before the ease. It must show the well, or the row fails.

**Tween.**
- The page has `html{scroll-behavior:smooth}`. A rAF tween scrolls 0 → 3000 over 400 ms (ease-out cubic) with
  `behavior:'instant'`, and a timer lands the end at 400 ms (L4.27).
- It passes when the frame reaches 3000 within 450 ms of the command and every step lands on its target.
- Control: the same with `behavior:'auto'`.

**Origin.** Every message the parent received during the whole run, across 18 frame loads.

### Mutation check

Each mutant is a one-line change to a scratch copy of the final probe, run once in Chrome. Each turned exactly the
rows below `FAIL`, and no other row. The control (no change) was all `ok`.

| Mutant | Rows that turned `FAIL` |
|---|---|
| The parent applies each `rects` one animation frame late | `r7-lag-s1`, `r7-lag-s0.45`, `r7-lag-s1-clicked` |
| The overlay's markers sit 5 px low (`margin-top:5px`) | `r7-pixels-s1`, `r7-pixels-s0.45` |
| The iframe gets `sandbox="allow-scripts allow-same-origin"` | `origin` |
| `C` is `height:60vh` instead of `600px` | `r20-reflow` |
| The kit page's `clamp(480px,60vh,800px)` section is `100vh` | `r20-feedback` |
| The frame shrinks to the zoomed-in 1056 px before every ease | `r20-ease` |
| The tween's `behavior:'instant'` is sent as `'auto'` | `tween` |

An earlier version of the probe judged Chrome's screenshots while scrolling as well. Under the first mutant they still
passed, reading within 1.5 frames. That is why the final probe judges screenshots at rest only.

## Runs

Each table holds the probe's rows for one command, unedited. A `FAIL` line exits 1. The header line under each
command drops the timestamp. All runs were on the host above, one after another.

### chromium

`node tools/spikes/design-stage-r7-r20/probe.mjs --browser chromium`: exit 0, `browser=chromium version=156.0.8078.80 os=darwin viewport=1280x1000 stage=1091x900 pageW=1280 fit=0.852 frame=out-of-process`

| Row | Result | Detail |
|---|---|---|
| r7-lag-s1 | ok | scale 1, frame 900 px tall; frame 16.7 ms (16.6-16.8), parent 16.7 ms; drive 2000 px/s as 33.4 px a frame; 120 parent frames over the drive's 120; lag worst 17.0 ms = 1.02 parent frames, p95 17.0 ms, median 16.5 ms, best 16.5 ms; worst on screen 34.0 px (one parent frame of travel = 33.4 px); marker mapping error 0.00 px |
| r7-lag-s0.45 | ok | scale 0.45, frame 2000 px tall; frame 16.7 ms (16.6-16.7), parent 16.7 ms; drive 2000 px/s as 33.4 px a frame; 120 parent frames over the drive's 120; lag worst 17.0 ms = 1.02 parent frames, p95 17.0 ms, median 16.5 ms, best 16.5 ms; worst on screen 15.3 px (one parent frame of travel = 15.0 px); marker mapping error 0.00 px |
| r7-lag-s1-clicked | ok | scale 1, frame 900 px tall; frame 16.7 ms (16.6-16.7), parent 16.7 ms; drive 2000 px/s as 33.4 px a frame; 120 parent frames over the drive's 120; lag worst 17.0 ms = 1.02 parent frames, p95 17.0 ms, median 16.5 ms, best 16.5 ms; worst on screen 34.0 px (one parent frame of travel = 33.4 px); marker mapping error 0.00 px |
| r7-pixels-s1 | ok | scale 1: at rest 5 marker/stripe pairs, worst 0.0 px. Not judged: 12 screenshots while scrolling (44 drive frames of 33.4 px, 1437 px), 26 pairs; marker y minus stripe y per shot [33.0 34.0 33.0 33.0 33.0 34.0 34.0 33.0 33.0 33.0 34.0 34.0] px; worst 34.0 px = 1.02 parent frames of travel (one = 33.4 px) |
| r7-pixels-s0.45 | ok | scale 0.45: at rest 10 marker/stripe pairs, worst 0.0 px. Not judged: 12 screenshots while scrolling (51 drive frames of 33.4 px, 1670 px), 60 pairs; marker y minus stripe y per shot [15.0 15.0 15.0 15.0 15.0 15.0 15.0 16.0 16.0 15.0 15.0 15.0] px; worst 16.0 px = 1.06 parent frames of travel (one = 15.0 px) |
| frame-raf | ok | animation-frame interval, median of 20: fresh frame frame 16.7 ms (16.5-16.8), parent 16.7 ms; after a wheel over the frame frame 16.7 ms (16.6-16.8), parent 16.7 ms; after a click in the frame frame 16.7 ms (16.6-16.7), parent 16.7 ms; the frame keeps the parent's pace fresh, keeps it after a wheel, keeps it after a click |
| r20-reflow | ok | frame 1056: A 1056.0 (vh 1056), B 633.6, C 600.0 at y 1689.6; frame 2000: A 2000.0 (vh 2000), B 800.0, C 600.0 at y 2800.0; frame 1056: A 1056.0 (vh 1056), B 633.6, C 600.0 at y 1689.6; C held 600 px at every height and its top moved 1110.4 px, exactly A's and B's change |
| r20-feedback | ok | scale = clamp(776 / spanH, 0.45, 0.852), frame = 900 / scale, 8 crew changes. Two 100vh running: 0.45 at change 1 (scales 0.450 0.450 0.450 0.450 0.450 0.450 0.450 0.450; spans 2412 4000 4300 4600 4600 4000 4300 4000). One 100vh running: 0.45 at change 3 (scales 0.572 0.493 0.450 0.450 0.450 0.450 0.450 0.450). Kit rule, the same page with clamp(480px,60vh,800px) for the 100vh: never at 0.45 (scales 0.831 0.852 0.831 0.621 0.554 0.852 0.831 0.852). Fallback, frame held at 2000 for the round, two 100vh running: frame and scale per crew held still, 0.45 at change 1 (scales 0.450 0.450 0.450 0.450 0.450 0.450 0.450 0.450) |
| r20-ease | ok | zoom in 0.45 -> 0.852 over 400 ms (ease). Frame kept at 2000 px: the well under the page in 0 of 25 frames seeked every 16.7 ms (bottom row, 573-1089 px under the page); live, 26 frames, box bottom above the stage bottom in 0 (least margin 0.0 px). Control, frame set to 1056 px first: the well in 23 of 25 frames (up to 1085 px of the row), live 23 of 26 frames short |
| tween | ok | page scroll-behavior:smooth; 0 -> 3000 by rAF over 400 ms plus a landing timer. behavior:'instant': at 3000 after 401 ms, 24 steps, 0 off target. Control behavior:'auto': at 3000 after 1281 ms, 24 of 24 steps off target |
| origin | ok | 847 messages from the frame over the whole run; e.origin other than 'null': 0; e.source other than frame.contentWindow: 0 |

### firefox

`node tools/spikes/design-stage-r7-r20/probe.mjs --browser firefox`: exit 0, `browser=firefox version=157.0 os=darwin viewport=1280x1000 stage=1091x900 pageW=1280 fit=0.852 frame=unknown`

| Row | Result | Detail |
|---|---|---|
| r7-lag-s1 | ok | scale 1, frame 900 px tall; frame 8.3 ms (6.7-10.3), parent 8.3 ms; drive 2000 px/s as 16.6 px a frame; 120 parent frames over the drive's 120; lag worst 8.5 ms = 1.02 parent frames, p95 8.5 ms, median 8.5 ms, best 8.0 ms; worst on screen 17.0 px (one parent frame of travel = 16.6 px); marker mapping error 0.00 px |
| r7-lag-s0.45 | ok | scale 0.45, frame 2000 px tall; frame 8.3 ms (7.0-9.7), parent 8.3 ms; drive 2000 px/s as 16.7 px a frame; 120 parent frames over the drive's 120; lag worst 8.4 ms = 1.00 parent frames, p95 8.4 ms, median 8.3 ms, best 8.3 ms; worst on screen 7.5 px (one parent frame of travel = 7.5 px); marker mapping error 0.01 px |
| r7-lag-s1-clicked | ok | scale 1, frame 900 px tall; frame 8.3 ms (6.7-16.7), parent 8.3 ms; drive 2000 px/s as 16.7 px a frame; 120 parent frames over the drive's 120; lag worst 8.5 ms = 1.02 parent frames, p95 8.5 ms, median 8.5 ms, best 8.0 ms; worst on screen 17.0 px (one parent frame of travel = 16.7 px); marker mapping error 0.00 px |
| r7-pixels-s1 | ok | scale 1: at rest 6 marker/stripe pairs, worst 0.0 px. Not judged: 12 screenshots while scrolling (51 drive frames of 16.6 px, 828 px), 25 pairs; marker y minus stripe y per shot [0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0] px; worst 0.0 px = 0.00 parent frames of travel (one = 16.6 px) |
| r7-pixels-s0.45 | ok | scale 0.45: at rest 10 marker/stripe pairs, worst 0.0 px. Not judged: 12 screenshots while scrolling (44 drive frames of 16.6 px, 716 px), 60 pairs; marker y minus stripe y per shot [-1.0 0.0 -1.0 0.0 -1.0 0.0 -1.0 0.0 -1.0 -1.0 0.0 0.0] px; worst 1.0 px = 0.13 parent frames of travel (one = 7.5 px) |
| frame-raf | ok | animation-frame interval, median of 20: fresh frame frame 8.3 ms (7.3-10.1), parent 8.3 ms; after a wheel over the frame frame 8.3 ms (7.4-15.5), parent 8.3 ms; after a click in the frame frame 8.3 ms (6.9-19.7), parent 8.3 ms; the frame keeps the parent's pace fresh, keeps it after a wheel, keeps it after a click |
| r20-reflow | ok | frame 1056: A 1056.0 (vh 1056), B 633.6, C 600.0 at y 1689.6; frame 2000: A 2000.0 (vh 2000), B 800.0, C 600.0 at y 2800.0; frame 1056: A 1056.0 (vh 1056), B 633.6, C 600.0 at y 1689.6; C held 600 px at every height and its top moved 1110.4 px, exactly A's and B's change |
| r20-feedback | ok | scale = clamp(776 / spanH, 0.45, 0.852), frame = 900 / scale, 8 crew changes. Two 100vh running: 0.45 at change 1 (scales 0.450 0.450 0.450 0.450 0.450 0.450 0.450 0.450; spans 2412 4000 4300 4600 4600 4000 4300 4000). One 100vh running: 0.45 at change 3 (scales 0.572 0.493 0.450 0.450 0.450 0.450 0.450 0.450). Kit rule, the same page with clamp(480px,60vh,800px) for the 100vh: never at 0.45 (scales 0.831 0.852 0.831 0.621 0.554 0.852 0.831 0.852). Fallback, frame held at 2000 for the round, two 100vh running: frame and scale per crew held still, 0.45 at change 1 (scales 0.450 0.450 0.450 0.450 0.450 0.450 0.450 0.450) |
| r20-ease | ok | zoom in 0.45 -> 0.852 over 400 ms (ease). Frame kept at 2000 px: the well under the page in 0 of 25 frames seeked every 16.7 ms (bottom row, 573-1089 px under the page); live, 50 frames, box bottom above the stage bottom in 0 (least margin 0.0 px). Control, frame set to 1056 px first: the well in 23 of 25 frames (up to 1086 px of the row), live 46 of 49 frames short |
| tween | ok | page scroll-behavior:smooth; 0 -> 3000 by rAF over 400 ms plus a landing timer. behavior:'instant': at 3000 after 400 ms, 48 steps, 0 off target. Control behavior:'auto': at 3000 after 840 ms, 48 of 48 steps off target |
| origin | ok | 833 messages from the frame over the whole run; e.origin other than 'null': 0; e.source other than frame.contentWindow: 0 |

### webkit

`node tools/spikes/design-stage-r7-r20/probe.mjs --browser webkit`: exit 1, `browser=webkit version=27.2 os=darwin viewport=1280x1000 stage=1091x900 pageW=1280 fit=0.852 frame=unknown`

| Row | Result | Detail |
|---|---|---|
| r7-lag-s1 | FAIL | scale 1, frame 900 px tall; frame 50.0 ms (34.0-50.0), parent 17.0 ms; drive 2000 px/s as 100.0 px a frame; 325 parent frames over the drive's 120; lag worst 50.0 ms = 2.94 parent frames, p95 50.0 ms, median 0.0 ms, best 0.0 ms; worst on screen 100.0 px (one parent frame of travel = 34.0 px); marker mapping error 0.00 px |
| r7-lag-s0.45 | FAIL | scale 0.45, frame 2000 px tall; frame 48.0 ms (34.0-50.0), parent 17.0 ms; drive 2000 px/s as 96.0 px a frame; 320 parent frames over the drive's 120; lag worst 48.0 ms = 2.82 parent frames, p95 48.0 ms, median 0.0 ms, best -0.0 ms; worst on screen 43.2 px (one parent frame of travel = 15.3 px); marker mapping error 0.00 px |
| r7-lag-s1-clicked | ok | scale 1, frame 900 px tall; frame 17.0 ms (12.0-19.0), parent 17.0 ms; drive 2000 px/s as 34.0 px a frame; 120 parent frames over the drive's 120; lag worst 17.0 ms = 1.00 parent frames, p95 17.0 ms, median 17.0 ms, best 17.0 ms; worst on screen 34.0 px (one parent frame of travel = 34.0 px); marker mapping error 0.00 px |
| r7-pixels-s1 | ok | scale 1: at rest 6 marker/stripe pairs, worst 0.0 px. Not judged: 12 screenshots while scrolling (24 drive frames of 100.0 px, 2300 px), 27 pairs; marker y minus stripe y per shot [0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0] px; worst 0.0 px = 0.00 parent frames of travel (one = 34.0 px) |
| r7-pixels-s0.45 | ok | scale 0.45: at rest 10 marker/stripe pairs, worst 0.0 px. Not judged: 12 screenshots while scrolling (24 drive frames of 96.0 px, 2208 px), 60 pairs; marker y minus stripe y per shot [-1.0 0.0 0.0 0.0 0.0 -1.0 -1.0 0.0 0.0 0.0 0.0 0.0] px; worst 1.0 px = 0.07 parent frames of travel (one = 15.3 px) |
| frame-raf | FAIL | animation-frame interval, median of 20: fresh frame frame 50.0 ms (34.0-52.0), parent 17.0 ms; after a wheel over the frame frame 50.0 ms (34.0-50.0), parent 17.0 ms; after a click in the frame frame 16.0 ms (13.0-19.0), parent 17.0 ms; the frame does NOT keep the parent's pace fresh, does NOT keep it after a wheel, keeps it after a click |
| r20-reflow | ok | frame 1056: A 1056.0 (vh 1056), B 633.6, C 600.0 at y 1689.6; frame 2000: A 2000.0 (vh 2000), B 800.0, C 600.0 at y 2800.0; frame 1056: A 1056.0 (vh 1056), B 633.6, C 600.0 at y 1689.6; C held 600 px at every height and its top moved 1110.4 px, exactly A's and B's change |
| r20-feedback | ok | scale = clamp(776 / spanH, 0.45, 0.852), frame = 900 / scale, 8 crew changes. Two 100vh running: 0.45 at change 1 (scales 0.450 0.450 0.450 0.450 0.450 0.450 0.450 0.450; spans 2412 4000 4300 4600 4600 4000 4300 4000). One 100vh running: 0.45 at change 3 (scales 0.572 0.493 0.450 0.450 0.450 0.450 0.450 0.450). Kit rule, the same page with clamp(480px,60vh,800px) for the 100vh: never at 0.45 (scales 0.831 0.852 0.831 0.621 0.554 0.852 0.831 0.852). Fallback, frame held at 2000 for the round, two 100vh running: frame and scale per crew held still, 0.45 at change 1 (scales 0.450 0.450 0.450 0.450 0.450 0.450 0.450 0.450) |
| r20-ease | ok | zoom in 0.45 -> 0.852 over 400 ms (ease). Frame kept at 2000 px: the well under the page in 0 of 25 frames seeked every 16.7 ms (bottom row, 573-1089 px under the page); live, 26 frames, box bottom above the stage bottom in 0 (least margin 0.0 px). Control, frame set to 1056 px first: the well in 23 of 25 frames (up to 1085 px of the row), live 23 of 26 frames short |
| tween | ok | page scroll-behavior:smooth; 0 -> 3000 by rAF over 400 ms plus a landing timer. behavior:'instant': at 3000 after 401 ms, 9 steps, 0 off target. Control behavior:'auto': at 3000 after 614 ms, 9 of 9 steps off target |
| origin | ok | 661 messages from the frame over the whole run; e.origin other than 'null': 0; e.source other than frame.contentWindow: 0 |

### Linux: Chrome and Firefox

not reached: this run had only the macOS host, and no Linux machine was reachable from it.

### Windows: Chrome and Firefox

not reached: this run had only the macOS host, and no Windows machine was reachable from it.

## Findings

1. **R7 holds in Chrome and Firefox.** The marker is exactly one frame behind, 1.00 to 1.02 parent frames at both
   scales. That frame is the `rects` hop: the frame posts in its animation frame, and the parent paints the move in
   its next one. At rest the markers sit exactly on their stripes (0 px) at both scales, in all three browsers.
2. **R7 fails in WebKit because WebKit throttles the frame, not because of the hop.**
   - The sandboxed frame gets an animation frame every 50 ms (34 to 52 ms) until the person clicks in it. A wheel
     over it does not lift that, and the parent's frames stay at 17 ms.
   - So the marker trails the page by one 50 ms frame, then catches up. The median lag is 0 ms and the worst is
     48 to 50 ms: the overlay moves in 50 ms steps.
   - After a click in the frame, WebKit matches Chrome: 1.00 frame.
   - The probe scrolls from the frame's own animation frames, so in WebKit the page also moved in 50 ms steps.
   - A person's wheel scroll moves the page at the screen's rate while `rects` still come every 50 ms. Not measured
     here: no browser gave a live screenshot.
3. **Firefox headless runs at 120 Hz:** 8.3 ms frames in both documents. The drive steps 16.7 px a frame, so the
   scroll is still 2000 px/s, and one frame of travel is 16.7 px there.
4. **R20 reflow is exactly as the plan expects, in all three browsers.**
   - `A` follows the frame height.
   - `B` follows `60vh` at 1056 px and stops at 800 px at 2000.
   - `C` holds 600 px. Its top moves 1110.4 px with `A` and `B` above it: that is the reflow risk itself, not `C`
     moving.
   - The way back to 1056 restores every rect.
5. **R20 feedback is identical in all three browsers:** the arithmetic runs on reported rects, and the reflow is
   exact.
   - **Two `100vh` sections:** 0.45 at the first crew change. At fit, their span alone is 2 × 1056 px, and
     776 / 2112 = 0.37.
   - **One `100vh` section:** 0.572, then 0.493, then 0.45 at change 3. It stays at the floor for the rest of the
     round, also when the crew drops back to that one section (changes 6 and 8): the frame is 2000 px tall by then,
     so `100vh` is 2000 px.
   - **The kit rule's page:** scales between 0.554 and 0.852, never the floor. The same crew got the same scale each
     time (0.831 at changes 1, 3 and 7).
   - **The fallback:** it holds the frame height and each crew's scale still. But at 2000 px a `100vh` section is
     2000 px tall, so a `vh` page sits at the floor anyway: the fallback stops the feedback, not the cost of `vh`.
6. **R20 ease:**
   - With the frame kept at the taller height, the well never showed under the page: 0 of 25 seeked frames, and no
     live frame short of the stage bottom, in all three browsers.
   - The control showed the well in 23 of 25 seeked frames, every frame but the last two, so the check can fail.
7. **Tween:** `behavior:'instant'` holds under `scroll-behavior:smooth` in all three browsers, and the end lands at
   400 to 401 ms. With `behavior:'auto'` the page's smooth scroll takes over: every step was off target, and the end
   came at 614 to 1281 ms.
8. **Origin:** every message from the opaque frame had `e.origin === 'null'` and `e.source === frame.contentWindow`
   in all three browsers. This matches P3's R5 probe (`p3-opaque`).

## Proof

Task 17's `npm run verify:design-stage` (`tools/verify-design-stage-cdp.mjs`) on the host above, 2026-11-08, one run
per browser, re-run in the review's fix cycles 2, 3, 4 and 5 with the R16 fixes and their checks. It drives the real stage
in the real shell (`node ui/server.mjs`, `WORCA_FLAGS=design`, `WORCA_MOCK=1`) with scripted C-5 frames through
`window.__design.pushFrame`; the frames, their bridge and every `ready`, `rects` and `applied` are real. The stage is
1096 x 900 at (584, 100) in a 1680 x 1000 window, so fit is 0.856.

| Run | Exit | Result |
|---|---|---|
| `npm run verify:design-stage` (Chrome 156.0.8078.80) | 0 | all 25 checks `ok` |
| `node tools/verify-design-stage-cdp.mjs --browser firefox` (Firefox 157.0) | 0 | all 25 checks `ok` |
| `node tools/verify-design-stage-cdp.mjs --browser webkit` (WebKit 27.2) | 0 | all 25 checks `ok` |

The first run of the task had 22 checks: Chrome passed all of them, and Firefox and WebKit failed `a frame that
navigates away offers Reload` (R16, below). Fix cycle 2 added `a frame that navigates away after its ready offers
Reload`, fix cycle 3 added `a frame that navigates away after its load offers Reload`, and fix cycle 4 added `a frame
that fires its own load event, then navigates away, offers Reload`. R7's check is a timing
check: one Chrome run in cycle 2 failed it at 2.01 frames while mutation runs loaded the host, and one Firefox run in
cycle 3 at 2.00 frames (15.8 ms at 120 Hz, scale 0.45) right after another browser run. Each passed when re-run
alone, at 0.99 and 1.02 frames.

**R7 against Task 1's table** (pass: worst lag at most 1.5 parent frames): `overlay within one frame while scrolling`
compares the stage's real blue box (`.dz-box` of the writing agent) with its element in the frame (`frame.evaluate`),
over a 2000 px/s scroll the frame drives itself, after each parent frame is drawn.

| Scale | Chrome | Firefox (120 Hz) | WebKit (after a click in the frame) |
|---|---|---|---|
| 1 | ok: worst 16.5 ms = 0.99 frames (33 px), median 0 ms | ok: 8.5 ms = 1.08 frames (17 px), median 8.5 ms | ok: 17 ms = 1.00 frames (34 px), median 17 ms |
| 0.45 | ok: worst 0 ms = 0.00 frames, median 0 ms | ok: 8.1 ms = 1.03 frames (7.3 px), median 7.8 ms | ok: 17 ms = 1.00 frames (15.3 px), median 17 ms |

- Chrome's frame and parent run their animation frames on the same beat, so a `rects` posted in the frame's frame is
  often painted in the same parent frame: 0 to 1 frame of lag.
- R7's fallback (the marks hide while `rects` scroll is active) was on for every sample in every browser:
  `.overlay-clip` was hidden in 120 of 120 parent frames each time, so what the person sees while scrolling is the
  cursors only.
- WebKit still needs the click Task 1 found (its 50 ms frame throttle). The fallback covers the case without one.

**R20 against Task 1's table:** no row failed; the fallback (the iframe held at `stageH / 0.45`) is not needed.
- Every section is px tall (R20), and the camera's scale is M11's: 3 running sections spanning 2400 px give the floor
  0.45 (776/2400 = 0.323), spanning 1200 px give 0.647 (776/1200) with no cursor parked, and a 4000 px crew parks only
  its far cursor. A change round's 1600 px section holds 0.485 (776/1600) through its end.
- The box keeps the taller height while a zoom in eases (L4.26): seeked at each of 25 frames of the 0.45 to 0.856
  ease, the box stayed 2000 px tall (900 / 0.45) and the well never showed under the page; live, the box's bottom
  never rose above the stage's in 36 (Chrome), 73 (Firefox) or 37 (WebKit) frames.

**Fixed in this task, each found by a check here** (both were red, then green; each fix reverted alone turns exactly
its check `FAIL` again):
1. `whole-round Stop keeps the zoom`: --s went 0.45 to 0.856 and the frame scrolled 4769 to 6351. P2 ends each agent
   with its own `stopped` frame before the build's, so the crew shrank under a `building` build and the camera
   reframed. `cameraStep` (`stage-model.mjs`) now holds while the person's own whole-round Stop is on its way
   (`state.stopping`, L4.34).
2. `a new round shows text the last round already showed` (added with the fix; found by the board comparison below):
   the reveal remembers each path's last text across rounds, so a builder whose first text in a new round equals the
   old round's was never sent to the new build doc, and its slot stayed empty. `stage.mjs` now drops the old round's
   reveal entries when the build id changes.

**R16: a run doc that navigates itself away.** The first run failed it in Firefox and WebKit. Fix cycle 2 added the
`loaded` report (review M4). Fix cycle 3 closed the case cycle 2 still missed, a page that leaves after its own load.
Fix cycle 4 closed the two spare credits cycle 3 still left (review cycle 3, M1). Fix cycle 5 closed the last route
back for a page that left while a report was owed, a self-reload's late `ready` (review cycle 4, Major 1). The four
checks below pass in all three browsers.
- **Cause.** In Firefox and WebKit, the doc posts `ready` at DOMContentLoaded, and then the navigation aborts its own
  `load`. The frame gets one `load`, the foreign page's, and `frame-host.mjs` counted it as the doc's own (each
  `ready` covered one `load`). It went on believing a frame that showed another page. Chrome never posts `ready` for
  a doc that navigates while it parses, so its ready timeout caught that case. But Chrome shows the same order for a
  navigation from a DOMContentLoaded handler.
- **Fix (a C-6 addition, frame to parent `loaded {mode}`).**
  - The bridge posts `loaded` at its window `load`, or at boot if the doc is already complete. It posts it once per
    doc, and never for a `load` event a script dispatched (`isTrusted` false).
  - The frame host counts a frame `load` as the doc's own only against a `loaded` report: per slot, reports minus
    every frame load, the ones before the first `ready` and the ones while the frame is not believed too. A load while
    the frame is not believed never stretches the grace already running.
  - A load with no report (the page left) stops the host believing the frame, and starts the grace. For a load that
    came before the first `ready`, that happens at the `ready`: the stage still gets the `ready`, and its replies wait.
  - A late report within the grace brings the frame back once it has paid every load owed. A self-reload's `ready`
    does not: the stage gets it, and its replies wait for the report, as at a first `ready`.
- **What cycle 2 missed (review cycle 2, Major 1).** Its host ignored a load before the first `ready`, taken for a
  blank doc's load; the proof counts no such load in any browser. That load is the doc's own whenever its window
  `load` follows DOMContentLoaded closely, which is every build doc and every run doc without slow images. The doc's
  `loaded` then left a spare credit, so a page that left after its own load was believed: its forged messages reached
  the stage, and the stage's messages, nonce included, went to it. Cycle 2's checks both navigate before that load.
- **What cycle 3 missed (review cycle 3, M1).** Two more routes to a spare credit.
  - A script's own `load` event (`dispatchEvent(new Event('load'))`, which some code fires to re-run late
    initialisers) made the bridge post a second `loaded`. After that, any later navigation was believed for good, a
    person's click on a link in the run doc included. The bridge now reports once per doc, and only a trusted `load`.
    Once alone would be wrong: a synthetic `load` before `ready` would use up the real report (the host ignores a
    report before `ready`), and a good doc would end lost.
  - The host dropped a frame load that came while it did not believe the frame, and since cycle 3 that is every doc
    from its first `ready` to its `loaded`. A foreign page's load there would have been paid by the old doc's report.
    No browser showed that order in the review's ~350 frames, but nothing in the code orders the two. The host now
    counts that load, and does not re-arm the grace for it.
- **What cycle 4 missed (review cycle 4, Major 1).** A self-reload's `ready` that came within the grace brought the
  frame back whatever it still owed. Take a self-reload whose load beat its `ready`, and that then left (after its own
  load, or at its DOMContentLoaded with no load at all). The foreign page's load was counted too, but the late `ready`
  brought the frame back, so the page was believed for good: its forged messages reached the stage, the stage's
  messages went to it, and nothing failed. The same reorder as cycle 3's: no browser has shown it, and nothing in the
  code orders the two. The `ready` now leaves the frame unbelieved, and only reports that pay every load owed bring it
  back, within the grace the self-reload's load started. Such a self-reload is believed a few ms later, at its report.
  This also ends a debt: a trip away that came back within the grace (the Back button) left a load owed while the
  frame was believed, so a later ordinary self-reload reloaded a good doc. Such a trip now reloads when the grace ends.
- **Order measured.** The proof logs which came first for each of its 23 frame loads (23 or 24 in WebKit; the figures
  vary from run to run), in each browser:
  - In all three browsers, every doc load (15, and 15 or 16 in WebKit) reached the page before its doc's report, and
    none after it. The report came 0 to 7 ms later; the slowest per run was 2 to 2.3 ms in Chrome, 3 to 7 ms in
    Firefox and 2 to 4 ms in WebKit. The other 8 are the pages the docs went to, and they never report.
  - So the host holds the messages of those milliseconds both ways, at most 256 each way. The report then delivers
    them in order: the stage's first, then the frame's. A grace that runs out drops them.
- **The checks.**
  - `a frame that navigates away offers Reload`: the section script sets `location` while the doc parses.
  - `a frame that navigates away after its ready offers Reload`: it sets `location` from a DOMContentLoaded handler,
    after the bridge's `ready`.
  - `a frame that navigates away after its load offers Reload`: it sets `location` 300 ms after the window `load`, so
    after the doc's `ready` and `loaded`, to a work file that keeps the nonce from the hash and forges a `rects` every
    100 ms. It passes only when `.dz-lost` shows, the page did forge, and no forged `docH` reached the model.
  - `a frame that fires its own load event, then navigates away, offers Reload`: 50 ms after the window `load` the
    section script dispatches a synthetic `load` and tells the page it did, then sets `location` 300 ms later, to the
    same forging page. It passes only when both the doc and its reload fired it, `.dz-lost` shows, the page did forge,
    and no forged `docH` reached the model.
  - All four show `.dz-lost` after one reload, and Reload restores the doc. They pass in all three browsers.
  - Against cycle 2's host (both changes reverted in a scratch copy), Chrome fails the third check: 194 forged `rects`
    believed, and `.dz-lost` never shows. The other two still pass there.
  - Against cycle 3's bridge (its once-and-trusted rule reverted, nothing else), Chrome fails the fourth check: 194
    forged `rects` believed, and `.dz-lost` never shows. The other 24 checks still pass there.
- **Known limit of load-based detection.** A foreign page's messages posted before its frame `load` reaches the
  parent are believed. The review measured 0.2 to 9 ms of such lead in 8 of 8 runs in Chromium and Firefox, and in 0
  to 3 of 8 in WebKit. The end state is still right: the frame is caught, reloaded once and offered Reload. Those
  messages pass the same validation as the doc's own, whose scripts hold the nonce anyway. A bridge `pagehide` report
  ("leaving") could narrow the window for navigations the doc starts itself.

## Boards

The real stage driven into each attached board's state through `window.__design.pushFrame`, as the proof does, shot
at 1680 x 1000 in Chrome 156 (light theme; `Dark` in dark) on 2026-11-08, and compared with
`canvas-shots-m11-<board>.png`.

**How the shares were measured:**
- Both PNGs are drawn to one canvas in a blank page. A pixel differs when any channel differs by more than 16; the
  second number uses more than 48.
- Stage = x 584 to 1679, y 48 to 999: the head and the well, the same box in both, since the real page puts the
  stage exactly where the mock does. HUD band = the stage's bottom 96 px.

**The page in the frame:**
- The mock paints its Apsida page on a canvas, with its own fonts, art and copy. The comparison used an HTML
  look-alike: 28 sections named as the mock's jobs, at the mock's heights.
- So most differing pixels are page content, and the agent counts, layer counts, costs and crew colours differ with
  the scripted data. The verdicts judge what P4 owns: the head, the well and frame, the cursors and labels, the marks,
  the HUD and the Agents popover.

| Board | Stage, >16 / >48 | HUD band | Verdict |
|---|---|---|---|
| Planning | 1.8% / 1.5% | 3.0% | matches. Slot lines with centred tags, `+` marks, `Planning…` HUD. Lead calls: the lead stays home (L4.7); the HUD shows the cost (L4.6) |
| BuildCalm | 18.8% / 17.9% | 4.3% | matches; page content differs |
| hero-5_5 | 16.7% / 4.9% | 3.9% | matches; page content differs |
| hero-8 | 18.7% / 15.1% | 10.2% | matches. 12 cursors at 0.45; boxes with handles and size tags; ghosted text |
| hero-11 | 18.2% / 14.9% | 8.9% | matches; page content differs |
| hero-14 | 10.3% / 8.8% | 2.1% | matches; page content differs |
| hero-17 | 10.1% / 8.7% | 12.9% | matches; page content differs |
| hero-20 | 16.2% / 13.2% | 10.5% | matches. Lead call L4.8: no red gap measures |
| hero-23 | 16.5% / 12.4% | 11.2% | matches; L4.8 as hero-20 |
| hero-26 | 18.2% / 14.0% | 8.7% | matches; page content differs |
| hero-30 | 26.7% / 11.3% | 9.3% | matches; page content differs (the mock's CTA art) |
| hero-end | 16.2% / 9.9% | 11.5% | matches. Fit at the top, `Built by 29 agents in 6m 14s · $4.20`; Export disabled until P6 (L4.15) |
| hero-reduced | 8.9% / 7.5% | 1.0% | matches. No trails, guides or measures; the camera jumps |
| follow-scrolled | 3.3% / 3.0% | 2.9% | matches. Every cursor parked at the top with ↑, three rows by colour; Follow in the HUD |
| follow-stays | 3.0% / 2.7% | 2.7% | matches. The camera stays off |
| follow-back | 11.8% / 9.7% | 13.9% | matches. Follow reframes the crew and leaves the HUD |
| AgentsClosed | 9.9% / 8.6% | 6.8% | matches. The dot tip names the job and its action |
| AgentsOpen | 20.1% / 5.1% | 3.8% | matches. The popover has the same place, width and rows, and the picked row is highlighted. The mock's rows add finished agents and real costs (data) |
| Done | 20.2% / 11.8% | 13.2% | matches. Not drawn here: the pin (6a: P5's Point) and the Export menu (P6, L4.15) |
| done-tablet | 19.5% / 11.6% | 4.6% | matches. The 820 px page is framed at scale 1 with 24 px on top; pin and menu as Done |
| Phone | 9.3% / 5.8% | 2.9% | matches. 390 px page at scale 1; HUD closed |
| Stopped | 4.9% / 1.7% | 3.1% | matches. `Stopped · … · $3.00`, Resume, ×; `+` marks stay, no boxes |
| Dark | 15.3% / 12.3% | 5.2% | matches. The head takes the dark tokens; the well, HUD and labels are unchanged |
| failed | 17.4% / 14.7% | 13.7% | matches. Dashed red box with a `Fleet failed` tag, `· 1 failed`. Decided: the failed cursor and its ringed dot leave at once (10a, L4.2) |
| failed-paused | 10.4% / 4.9% | 1.7% | matches. Framed on Fleet at fit with 150 page px of lead room (L4.22); `Paused · 1 failed`, Resume, × |

**The nav row** reads `Design`, then the count (`1` while a build is live, hidden otherwise, L4.30), then `Labs`
(L4.14). Checked as `["Design","1","Labs"]`.

**Differences fixed:** one, the reveal across rounds (Proof, fix 2). Before it, every board whose sections had been
written in an earlier round showed an empty frame where the mock shows text, boxes and ghosts.
