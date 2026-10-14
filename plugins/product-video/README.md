# product-video

A worca plugin that records product demo videos of one or more features: storyboard, your approval, an isolated demo
environment, recorded takes, frame review, MP4 delivery. Videos are run artifacts under the pipeline directory, never
commits.

## Workflow: Product Video

| Step | Kind | Does |
|---|---|---|
| Video: check programs | script | Checks Playwright, a browser, ffmpeg and an H.264 encoder before anything else; stops the run with install commands when one is missing |
| Clarify | agent | Asks what the task leaves open |
| Video Storyboard | agent | Picks the medium per feature (only ones this machine can record), plans the demo environment and seed, writes the storyboard |
| Video Approval | form | You approve the storyboard, or approve it with notes |
| Video Recorder | agent | Starts the demo instance, seeds it, writes and records the take |
| Video: contact sheets | script | Contact sheets of the take for the review |
| Video Review | agent | Checks every scene against the storyboard; blocking findings go back to the recorder (up to 3 cycles) |
| Video: encode MP4 | script | Trims and encodes `video/<slug>.mp4` and `<slug>-small.mp4` (under 10 MB), writes `video-package.md` |

## Requirements

Works on macOS, Linux and Windows. The first step checks all of these; `node skills/product-video/tools/video.mjs
check` does the same by hand.

- **Node** — the one worca runs on.
- **Playwright** — `playwright-core` in the project's `node_modules` or npm's npx cache
  (`npx -y playwright@latest --version` fills the cache), and a browser it can start: Google Chrome, or
  `npx -y playwright@latest install chromium`.
- **ffmpeg** to read the take: the one on PATH, or the one Playwright downloads with its browsers
  (`npx -y playwright@latest install ffmpeg`).
- **Encoding needs ffmpeg with libx264, or macOS with the Xcode command line tools.** Any OS: an ffmpeg with libx264
  on PATH (`brew install ffmpeg`, `apt install ffmpeg`, `winget install Gyan.FFmpeg`). macOS without one: `swiftc`
  from the Xcode command line tools (`xcode-select --install`) encodes through AVFoundation. Playwright's own ffmpeg
  cannot encode H.264.

No python, Pillow or ImageMagick: contact sheets and probing are done in Node.

## Zoom moments

Storyboards can mark a few scenes for an eased zoom on a small detail (a badge, a button, a count). Browser and
terminal takes zoom live through `take.zoom()` in `harness.mjs`, re-rendered sharp. Takes that cannot zoom live
(simulator, desktop recorder) list `post` zooms in `<take>.zooms.json`; the encode step applies them as a crop +
scale, which is softer. The contact-sheets step adds a frame from each zoom for the review. See SKILL.md, "Zoom
moments".

Media that need a particular OS (an iOS simulator needs macOS with Xcode; desktop screen recording uses that OS's
recorder) are planned only when the check found them; otherwise the storyboard falls back to a browser take or a
terminal replay.

## Layout

- `agents/` — the four agents and their sidecars (the approval form lives in `videoApproval.meta.json`).
- `scripts/` — the three script steps, with test cases (`worca plugin validate . --run-cases`).
- `skills/product-video/` — the skill the agents follow, and `tools/`: `harness.mjs` (browser takes), `capture.mjs` +
  `terminal.html` (terminal replays), `find-playwright.mjs`, `video.mjs` (sheets, encode, probe, check) and
  `encode.swift` (the macOS encoder). The script steps import `tools/video.mjs`, so there is one copy of that code.
- `workflows/product-video.json` — the pipeline template. After editing it in a linked folder, run
  `worca plugin reimport product-video`.
