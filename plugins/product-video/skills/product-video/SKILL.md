---
name: product-video
description: How to make a product demo video of one or more features — choosing the medium for the project type (web UI, terminal/CLI, desktop, mobile, library/API), an isolated demo environment with realistic seed data, a storyboard with captions and title cards, recording takes with the bundled harness, reviewing frames, and encoding an MP4 plus a copy under 10 MB. Videos and scratch files live in the pipeline directory and are never committed.
---

# Product video

A good demo video shows **exactly the moment each feature earns its place**, on believable data, with nothing on screen
that a viewer has to forgive. The tools in `tools/` (next to this file) do the mechanics; your job is the decisions.

## Hard rules

1. **Never touch the developer's real data, accounts, settings or running services.** Start a separate instance on its
   own port with `HOME` and every app data/config directory pointed at a scratch folder under the pipeline directory.
2. **Never commit, push or open a PR.** Videos, frames, takes, seed and recorder scripts all live under the pipeline
   directory (`{pipelineDir}`), never in the worktree. Change no project code.
3. **Use the project's mock/offline mode** when it has one; never spend on paid services or send messages for a demo.
4. **Scripted content is declared.** When a feature needs an answer mock mode cannot give (a model reply, a remote
   API), intercept that one call (`take.intercept`) with realistic scripted content and list it in the storyboard's
   "Scripted" section. Never fake what the product itself renders.
5. **No placeholder text on screen**: no "test", "foo", lorem ipsum, "[mock]", debug banners, onboarding dialogs.
6. **Stop everything you started** (servers, simulators, browsers) and delete scratch frames before you finish.

## Choose the medium per feature

| Project / surface | Medium | How |
|---|---|---|
| Web UI (app, dashboard, docs site) | browser take | `harness.mjs` `openTake` — Playwright + system Chrome, real mouse and keyboard |
| Terminal / CLI | terminal replay | run the session for real with `capture.mjs`, replay it with `playTerminal` (renders `terminal.html`) |
| Desktop app | screen recording | the platform recorder at a fixed window size (macOS: `screencapture -v -R x,y,w,h`), driven by the app's automation |
| iOS / Android | simulator | `xcrun simctl io booted recordVideo` / `adb shell screenrecord`, driven by UI automation |
| Library / API without UI | terminal replay | a short real program using the feature, run and replayed like a CLI; title cards carry the "why" |
| Mixed (CLI that changes a UI…) | both | scenes in the order a user meets them; one title card per surface |

Decide from the repo itself (package.json, framework, bin entries, README, the PRs). Name the choice and the reason in
the storyboard.

## Isolation and seed data

- Discover how the app is started (README, package.json scripts, `.claude/launch.json`, Procfile) and how its data
  directory is chosen (env vars such as `HOME`, `XDG_*`, `<APP>_HOME`, `--data-dir`). Point all of them at
  `{pipelineDir}/video-env/`.
- Seed through the app's own API, CLI or store functions — never by hand-editing a live database the real instance
  uses. Write the seed as a re-runnable script in `{pipelineDir}/video-env/seed.*` and make it idempotent: each take
  starts from the same state (delete what the last take created).
- Content must look real: real-sounding project and person names, believable tasks, plans, diffs and numbers that fit
  the feature. Reuse the project's fixtures or docs examples when they are good.
- Dismiss onboarding, welcome dialogs, cookie banners and tours before recording — through the app's settings API, or
  in the harness's unrecorded `warmUp`.

## Storyboard (what the approval form shows)

- Opening title card (feature name + one-line value, ~3 s), one section per feature with its own section card, a
  closing recap card. Total 60–120 s unless the task says otherwise; 20–40 s per feature.
- Per scene: goal · user actions · caption (≤ 8 words, present tense, says the *value*, not the click) · expected
  visible result · duration.
- Pick on-screen targets that fit: no selection that sits beyond the right edge of a long line, no popover that would
  cover what it describes, no layout that scrolls sideways at the chosen viewport.
- A "Scripted" section lists every intercepted response. A "Real" line states what the product rendered itself.
- Zoom moments (see below): the Scenes table has a `zoom` column — `—` for most scenes, or the target, why it matters
  and the hold, e.g. `` `.run-badge` — the run waits for you — 1.8 s ``.

## Zoom moments

An eased zoom pulls the eye to a detail too small to read at full frame: a status badge, a toolbar button, a count, a
small caption, one cell of a table, the line of terminal output that matters.
- **Use them sparingly**: at most one per feature, about 3–5 in a 2-minute video. Zoom on what the scene's caption
  is about, never on something the viewer can already read, and never on content that moves or scrolls during the hold.
- **Feel**: ease in ~650 ms, hold 1.5–2.5 s (long enough to read the label twice), ease out ~650 ms. Scale comes from
  the target's size (1.4–2.5×); a target that would need more is too small to film — pick a bigger anchor around it.
- **Browser and terminal takes zoom live** (`take.zoom()` in harness.mjs, a `{ zoom: 'text' }` step in
  `playTerminal`): a CSS transform, so text is re-rendered sharp at the zoomed size; the caption pill and cursor stay
  their size and the cursor stays on its target. Clicks and hovers keep working while zoomed (`zoomTo` … `zoomOut`).
- **Other takes** (simulator, desktop recorder) cannot zoom live. List them in `<take name>.zooms.json` next to the
  take as `post` zooms — `{ "version": 1, "zooms": [{ "kind": "post", "at": 41.2, "hold": 1800, "rect": { "x": 1210,
  "y": 64, "w": 180, "h": 40 }, "why": "…" }] }` (take seconds, take pixels) — and the encode step applies them as an
  eased crop + scale. That upscales pixels, so it is softer: keep post zooms at ≤ 2× and say so in the storyboard.
- Keep the caption on during a zoom only if it is short; the zoomed detail is the message.

## Recording with the harness

```bash
node tools/find-playwright.mjs          # prints a playwright-core index.mjs path (no install needed when cached)
```

```js
import { chromium } from '<printed path>';
import { openTake } from '<skill dir>/tools/harness.mjs';

const take = await openTake({
  chromium, out: '<pipelineDir>/video-takes', base: 'http://localhost:4392',
  title: ['Pinpoint', 'Act on exactly the text you mean'],
  warmUp: async (p) => { /* dismiss onboarding, reset state — not recorded */ },
});
const { page, caption, card, select, click, hover, type, key, reveal, wait, zoom } = take;
await page.goto(`${'http://localhost:4392'}/#chat/...`);
await card('');                                        // the opening card was up since the first paint
await caption('Select any text — a toolbar appears');
await select('.answer', 'fails open', { expect: '.toolbar' });   // real drag, scripted fallback if the UI missed it
await click('.toolbar [data-k="explain"]');
await zoom('.toolbar [data-k="explain"]', { why: 'the action the caption names', hold: 1800 });
await wait(3000);
const webm = await take.close({ as: 'pinpoint-cycle1' });   // video-takes/pinpoint-cycle1.webm + .zooms.json
```

- Wait on real UI state (`page.waitForSelector`, `expect:`), add fixed pauses only for viewing time (0.6–3 s).
- Typing at 30–40 ms per key; hover each toolbar item ~400 ms when introducing it.
- Viewport 1920×1080 (wider when the layout is dense — a 3-column app squeezes content at 1440). Light theme unless the
  product is dark-first.
- Terminal: write `session.in.json` (see `capture.mjs`), run `node tools/capture.mjs session.in.json session.json`,
  then `playTerminal(take, JSON.parse(...))` inside a take opened without `base`. Commands run in the platform shell
  (`/bin/sh`, `cmd.exe` on Windows): write them for the OS the run is on.
- One take per run of the script; re-record the whole take after a fix rather than splicing.

## Review (before anything is delivered)

The pipeline's contact-sheets step makes the sheets (`video-sheets/sheetNN.png`, 12 frames each, one every 2.5 s). By
hand, or for a closer look at one moment:

```bash
node tools/video.mjs sheets <take.webm> <outdir> --every 2.5
```

Open every sheet with Read and check, scene by scene, against the storyboard:
- the caption matches what is on screen at that moment;
- nothing covers the action (dialogs, toasts, the caption pill itself over the key UI);
- popovers and menus stay inside the viewport and don't cover what they describe;
- no placeholder/mock/debug text, no blank or loading frames except the very first second;
- no sideways scroll, no cut-off text, the cursor is visible where the action is;
- every zoom (`video-sheets/zoomNN.png`, one frame from the middle of each hold): the target is centred, or as near as
  the frame edge allows, and wholly in frame; it is sharp (a live zoom must not look upscaled; a post zoom may be
  slightly soft); the hold is long enough to read it; nothing the caption talks about is cut off; the storyboard's
  zoom moments are all there and there are no unplanned ones.
A failed check is a `major` (critical when a feature is not shown at all).

## Delivery

The pipeline's encode step does this after a clean review; by hand:

```bash
node tools/video.mjs finish <take.webm> <pipelineDir>/video <slug>
```

Trims the blank lead-in, writes `<slug>.mp4` (native width, H.264) and `<slug>-small.mp4` (1600 wide, under 10 MB —
GitHub's upload limit on free accounts), and prints sizes, durations and resolutions. It uses an ffmpeg with libx264
(any OS); on macOS without one, Playwright's ffmpeg decodes and `encode.swift` (AVFoundation, needs `swiftc`) encodes.
`node tools/video.mjs check` says what this machine has.

Uploading is a person's job: a GitHub attachment needs a signed-in browser. Say so in the summary, with both paths.
