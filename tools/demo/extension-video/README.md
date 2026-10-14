# Worca browser extension demo video

```bash
npm ci                          # once: esbuild + @playwright/test (Playwright's Chromium must be installed)
npm run demo:extension-video    # → tools/demo/extension-video/out/worca-extension-demo-<YYYYMMDD-HHMM>.mp4
```

The command records a captioned walkthrough of the extension, about 1.5 minutes long, from a clean checkout. It
prints the file's path, resolution and length when it finishes. Nothing is published, and nothing touches your own Worca or
`~/.worca-cc`.

## Flags

Pass flags after `--`, e.g. `npm run demo:extension-video -- --size 1600x900 --keep`.

| Flag | Effect |
|---|---|
| `--size WxH` | The video size (default `1920x1080`). |
| `--headed` | Show the browser window while it records. |
| `--keep` | Keep the temp work dir (Worca home, extension build, frames) and print its path. |
| `--webm` | Skip ffmpeg and record WebM with Playwright's own recorder. |
| `--out DIR` | Write the video to `DIR` instead of `out/`. |

ffmpeg is optional. With it (`brew install ffmpeg`), frames come from a CDP screencast (JPEG q92) and are encoded as
H.264 MP4 (crf 18). Without it, the video is Playwright's WebM (VP8, about 1 Mbit/s). That fallback looks softer and
opens on a few blank frames, so MP4 is the polished path.

## What it does

1. **Builds a demo extension**: `buildOne('chrome', { demo: true })` (`tools/build-extension.mjs --demo`) writes
   `chrome-demo/`. That is the test build's hooks (`__worcaTest.command`, `setCaptureSource`, `?tabId=`) plus two
   manifest entries: `host_permissions: ['http://localhost/*']`, and `sidebar.html` web-accessible from
   `http://localhost/*`. Worca itself runs on `127.0.0.1`. A host permission there would make Chrome drop the `Origin`
   header the pairing gate needs. The demo build is never released: `--zip` and `--pack` refuse `--demo`, and the
   production build's leak check also greps for `__WORCA_EXT_DEMO__`.
2. **Starts a demo Worca** in a child process (`lib/worca-host.mjs`, started by `lib/start-host.mjs`). It gets a temp
   `HOME`/`WORCA_HOME`, a free port, `WORCA_MOCK=1` and `WORCA_DEMO_SCENARIO=scenario.json`. It then:
   - creates the sample project **Acme Pulse** (`sample-app/`, plus Worca's own woff2 fonts) as a temp git repo;
   - registers the project and finishes one mock run;
   - starts the app as a Worca **Action** (`node serve.mjs`, `PORT` auto). The sidebar's running-Action match then
     pins the chat scope to "Acme Pulse".
3. **Launches Playwright Chromium** with the demo build. The build has the demo Worca's address baked in
   (`WORCA_EXT_PORT`), and it is paired through the real pairing routes (`lib/pairing.mjs`, as the E2E fixtures do).
4. **Plays the script** (`lib/script.mjs`), in this order:
   - a title card;
   - Ask about the page;
   - Pinpoint Explain on the wrong annual price, then "Go deeper in chat";
   - an area capture of the misaligned button;
   - the composer (scope, models, cost and context meter);
   - an outro.

## How the stage works

One page is recorded: the sample app is the top-level page. `sidebar.html` (pinned to that tab with `?tabId=`) is
docked on the right as an `<iframe>`. Captions, title cards, the keycap HUD, the fake cursor and the spotlight live in
a closed-shadow `<worca-demo-stage>` overlay with `pointer-events: none`. Its CSS is built from Worca's real tokens
(`tools/extension-css.mjs`).

There is no `chrome-extension://` stage page with the app in a frame, because the extension acts on frame 0 only:
- `background.mjs` injects with `allFrames: false`;
- it drops content ports from other frames;
- it refuses the Pinpoint proxy off frame 0.

With the app on top, Pinpoint, the capture overlay and page context run unchanged.

Shortcuts cannot be pressed from Playwright, so the script calls `__worcaTest.command(...)` and shows the keys on the
keycap HUD. For the capture, the recorder hands the extension a clean `page.screenshot()` with the overlay hidden.
That is `DEMO_BUILD`'s single runtime branch in `background.mjs#captureVisible`, and production folds it away.

The browser runs without viewport emulation. Headless Chromium with an extension keeps hidden browser UI inside
`--window-size`, so an emulated 1080 px viewport is cropped to about 941 px in the screencast, and input below that
line is dropped. `fitWindow` (`lib/capture.mjs`) resizes the real window until its content area is exactly the
requested size.

## The scripted answers (`WORCA_DEMO_SCENARIO`)

`scenario.json` holds what the mock says, and `src/core/demo-scenario.mjs` reads it, only while
`WORCA_DEMO_SCENARIO` is set and Worca is in mock mode. A miss, or the variable unset, leaves the stock mock answers
unchanged.

- `ask[]`: `{ match, title, answer, costUsd, usage }`.
  - `match` is a case-insensitive substring of the typed first line. The first entry that matches wins, so put
    specific entries before general ones.
  - `title` answers Worca's thread-title prompt.
  - `usage` and `costUsd` feed the cost and context meter.
- `pinpoint[]`: `{ match, explain, alternatives }`. `match` is matched against the selected quote.
- `chunkMs`: the delay between streamed word groups.

Edit a typed prompt in `lib/script.mjs` (`PROMPTS`) together with its `match`. `test/demo-video-tooling.test.mjs`
fails when a prompt has no scripted answer.

## Fallbacks and troubleshooting

- **The Action does not start.** For example, the mock run left no feature branch. The host then serves the app
  itself, logs `WARN … serving the app directly`, and the script picks "Acme Pulse" in the scope popover by hand. The
  video still shows the pinned scope.
- **Pairing or API calls fail with 403 `origin`.** The `localhost`-only host permission assumption broke; see the
  comment in `extension/src/manifest.mjs`.
- **An aborted run.** Ctrl-C closes the browser and stops the demo Worca, which stops the Action. After a hard kill,
  check `ps` for a stray `serve.mjs`, and stop it by its PID.
- Videos land in `tools/demo/extension-video/out/`, which is git-ignored.
