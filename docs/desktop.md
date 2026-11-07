# Desktop app

The Worca desktop app is an optional build of Worca for macOS, Windows and Linux. It runs the same Worca server
the npm package runs, and shows it in its own window with a tray icon. Nothing else changes: the npm package,
`npm start`, the Docker image and the hosted deployment are the same with or without it.

It shares your Worca store (`~/.worca-cc`) with a CLI or web install. If a Worca is already running on that store,
the app opens a window on it and starts nothing.

## Build it

Prerequisites:

- Node 24 (the major in `.nvmrc`). The build installs node-pty for that Node, so it refuses any other major.
- The target machine itself. A build makes the app for the platform and arch it runs on: an Apple silicon Mac
  builds `mac arm64`, an Intel Mac `mac x64`, Windows `win x64`, Linux `linux x64`. There are no cross builds,
  because node-pty is native. ARM Windows and ARM Linux are not built.

```sh
npm ci
npm ci --prefix desktop
npm run build:desktop          # = node tools/build.mjs --target desktop
```

The installers land in `desktop/dist/`: a `.dmg` and a `.zip` on macOS, an NSIS `.exe` on Windows, an `.AppImage`
and a `.deb` on Linux. `node tools/build.mjs --target desktop --dir` builds only the unpacked app, which is quicker.
`--no-smoke` skips the two server checks described below.

What the build does:

1. `npm pack` of this checkout (its `prepack` builds the browser extension), checked with `tools/check-pack.mjs`.
   It installs that package with `npm ci --omit=dev` into `desktop/build/server/`. The app carries exactly
   what the npm package ships.
2. It downloads the pinned Node runtime (`desktop/node-runtime.json`) from nodejs.org into
   `desktop/build/cache/`, checks its SHA-256, and puts `node` and its `LICENSE` in `desktop/build/node/`.
3. It starts that server with that Node, as the app would, and checks `/api/health` and the updater state.
4. It runs electron-builder (`desktop/build/electron-builder.json`).
5. It runs the same check against the server and Node inside the packaged app.

`node tools/build.mjs` with no target (or `npm run build:web`) is the web build. It runs the package's `prepack`
step (`node tools/build-extension.mjs --pack`) and nothing else.

The manual GitHub workflow **Desktop build** (`.github/workflows/desktop-build.yml`) builds all four targets on
their own runners and uploads the installers as workflow artifacts for 14 days. It creates no release.

## Run it from a checkout

```sh
npm ci --prefix desktop
npm start --prefix desktop
```

From a checkout the app runs `ui/server.mjs` from the checkout with the `node` on your `PATH` (Node 22.19 or
newer). Set `WORCA_DESKTOP_NODE=/path/to/node` to choose another. A Node shim that forks (Volta) fails the app's
pid check: point `WORCA_DESKTOP_NODE` at the real binary.

## How it behaves

- **A Worca already running.** The app reads `<store>/ui.json` and asks that server's `/api/health`. If the pid
  matches, it opens a window on that server and starts nothing. Quit then leaves that server running.
- **Its own server.** Otherwise it starts the server on port 4317 when that port is free, else on a port the
  system picks. If another Worca grabs 4317 at the same moment, the app looks again and uses it, or starts on a
  free port. Settings you keep per page origin (local storage) differ when the app runs on a port other than 4317.
- **One app.** Opening the app again focuses the first window.
- **Close and Quit.** Closing the window keeps the app in the tray, and the server keeps running.
  **Quit Worca (stops the Worca server)** in the tray menu stops a server the app started, through the same
  graceful drain as `worca ui stop`. Running runs pause and resume later.
  Quit while the server is still starting, or during a Restart, stops that server too.
  If the app itself crashes, its server keeps running, and the next launch uses it. The server then ignores its
  closed output pipes (`WORCA_DESKTOP=1`), so its later log lines are lost, not fatal.
- **The server stopped.** If a server the app started stops on its own, the app offers Restart or Quit.
- **Launch at login** (tray menu, macOS and Windows) starts the app hidden in the tray. Linux has no such item.
- **PATH.** An app opened from the Dock or Start menu gets a short system PATH. On macOS and Linux the app reads
  `PATH` from your login shell (`$SHELL -ilc`, 5 s limit) and gives it to the server, so `claude`, `git` and the
  tools from Homebrew, mise or nvm are found. Only `PATH` is read: other variables your shell exports are not.
- **Links** to other sites open in your browser. The window is sandboxed, with no Node access, and only Worca's
  own pages may use the microphone (voice), notifications, the clipboard and full screen.

## Updates

The in-app updater is turned off in the desktop app: the About card (Settings › General) says so, and offers no npm command. To
update, download and install a newer build of the app. The version badge still tells you when a newer Worca is
out. The server gets this through `WORCA_DESKTOP=1`, which the app sets; nothing else reads it.

## Unsigned builds

Builds are unsigned unless signing secrets are present.

- **macOS:** the first open is refused, and an unsigned Apple silicon app is often reported as "damaged". Run
  `xattr -dr com.apple.quarantine /Applications/Worca.app`, then open it again. On macOS 15 and newer the
  right-click › **Open** override is gone: after a refused open, use System Settings › Privacy & Security ›
  **Open Anyway**.
- **Windows:** SmartScreen warns. Choose **More info**, then **Run anyway**.

## Signing

Signing turns on only when its variables are set and not empty (the workflow passes them from same-named
secrets, each to its own platform's job only; a missing secret counts as unset):

| Platform | Variables |
|---|---|
| macOS signing | `CSC_LINK`, `CSC_KEY_PASSWORD` (workflow secrets `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`) |
| macOS notarization (needs signing) | `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows signing | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` only. A Windows build removes `CSC_LINK` and `CSC_KEY_PASSWORD` (the Apple certificate) from electron-builder's env |

An unsigned build sets `CSC_IDENTITY_AUTO_DISCOVERY=false`, so a signing identity in your keychain is never used
by accident. The signing variables reach electron-builder only: `npm pack`, `npm ci` (and every dependency's
install script) and the smoke's server run without them. A signed macOS build uses the hardened runtime with
`desktop/build-resources/entitlements.mac.plist` (JIT and library validation for the bundled Node and node-pty,
the microphone). Signed and notarized builds have not been tried yet.

## Logs

The app writes its server's output to `<userData>/logs/server.log` (on macOS
`~/Library/Application Support/Worca/logs/server.log`). The file starts over on every server start. When the
server cannot start, the error dialog shows the last lines and this path.

## Terminal

The terminal uses node-pty, installed for the bundled Node. If node-pty cannot load, the terminal falls back to
pipes, as it does in the npm package.

## The `worca` CLI

The desktop app does not install the `worca` command. To use it in a terminal, install the npm package too:
`npm i -g @worca/app`. Both share the same store and the same running server.

## Known gaps

- Only `PATH` comes from the login shell. Other variables you export there are not passed to the server.
- The bundled Node runs Worca, its hooks and its own MCP servers. If your machine has no Node of its own, `npx`
  MCP servers and plugins that need `npm ci` fail, as they would for a web install without Node.
- Settings kept per page origin (local storage) differ when the app runs on a port other than 4317.
- On Ubuntu 23.10 and newer the AppImage may refuse to start because of the Chromium sandbox. Use the `.deb`.
- If the app crashes, its server keeps running. The next launch uses it, and Quit then leaves it running. Its
  output after the crash is not in `server.log`.
- A Worca on 4317 for the same store whose `ui.json` is missing (its write failed) looks like another store's
  Worca. The app then starts a second server on the store.

## Third-party binaries

The app bundles Node (its `LICENSE` is in `<resources>/node/`) and, through the npm package, the optional
`ffmpeg-static` binary (GPL-3.0-or-later; its license is under `<resources>/server/node_modules/ffmpeg-static/`).
Check licensing before any public release.

## Pinned versions

| Component | Version | Where |
|---|---|---|
| Electron | 45.2.3 | `desktop/package.json` (exact) |
| electron-builder | 26.18.0 | `desktop/package.json` (exact) |
| Node runtime | 24.22.2 | `desktop/node-runtime.json` (SHA-256 per asset, from the release's `SHASUMS256.txt`) |

These are bumped by hand: Dependabot does not watch `desktop/`. To bump Node, copy the four SHA-256 values from
`https://nodejs.org/dist/v<version>/SHASUMS256.txt`. Keep its major equal to `.nvmrc`.
