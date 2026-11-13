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
4. It runs electron-builder (`desktop/build/electron-builder.json`). On macOS it then reads the built
   `Worca.app/Contents/Info.plist` (`plutil`) and fails the build unless `CFBundleName` and `CFBundleDisplayName`
   are `Worca`, `CFBundleIdentifier` is `dev.worca.desktop` and an icon file is set.
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

On macOS the menu bar takes its bold app name from the app bundle, and `electron .` runs the stock `Electron.app`.
So `npm start` (`desktop/dev/start.mjs`) first copies that app to `desktop/.dev-app/Worca.app` (gitignored), sets
its name to Worca and its icon to the worca icon, signs the copy ad hoc and runs it. The copy is built once, and
again only when the Electron version or the icon changes; `rm -r desktop/.dev-app` forces a rebuild.
`node dev/start.mjs --build-only` in `desktop/` builds or checks the copy without launching it.
- The ad-hoc signature is new to macOS, so it may ask for the microphone once more in dev.
- `WORCA_DESKTOP_DEV_BUNDLE=0 npm start --prefix desktop` skips the copy and runs the stock `Electron.app`.
- If the copy cannot be built (a missing tool such as `codesign` without the Xcode command line tools, or any
  failed step), the launcher prints one line saying why and runs the stock `Electron.app`. The menu items still say
  Worca, but the bold menu-bar title says "Electron": then only the packaged build shows the name.
- On Windows and Linux `npm start` is exactly `electron .`.

**Live check (macOS).** `node tools/desktop-live-check.mjs` launches the app in a sandbox home (needs
`npm ci --prefix desktop`; macOS only) and measures what tests cannot: the wordmark and the logo row's controls clear
the traffic lights, the drag strip, the collapsed rail, full screen and a double-click on the top bar. It prints one
JSON line per check and exits 0 when all pass. `--reuse-old <git-ref>` first starts an older worca server from that
commit, so the app reuses it; `--desktop-dir <dir>` launches another `desktop/` folder; `--os-click` also posts a real
OS double-click, which needs Accessibility permission for the terminal; `--keep` keeps the sandbox. It is not part of
`npm test` and never stops a process it did not start.

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
  own pages may use the microphone (voice), notifications, the clipboard and full screen. A preload
  (`desktop/preload.cjs`) marks the page as the desktop shell and reports the theme and the badge; it exposes
  nothing to the page.
- **Badge.** The app mirrors the page's Alerts badge, so it shows only while **Settings › General › Alerts ›
  Badge when something is waiting** is on. The count is the runs that need you (the page title's `(N)`). Unread
  schedule problems alone show a dot.
  - macOS: the Dock badge shows the number, or `•` for problems only.
  - Windows: a red taskbar overlay shows `1`–`9`, `9+`, or a plain dot for problems only.
  - Linux: the launcher count (`app.setBadgeCount`), on desktops whose launcher shows one (Unity, KDE).
  - The tray tooltip says it too, for example `Worca — 2 runs need you` or `Worca — unread schedule problems`.

  The badge clears at 0, when a server the app started stops, when the window loads a new page (the Restart reload,
  a reload, a moved server) or fails to load one, and when the page's renderer crashes.
- **Notifications on Windows.** The app sets its AppUserModelID (`dev.worca.desktop`, the build's `appId`) at
  start, so Windows shows toasts under Worca's name and icon. The installer's Start menu shortcut carries the same ID.

## Window and icons

**Title bar.** The window has no separate title bar where the OS allows it:

- **macOS:** the title bar is hidden and the traffic lights sit in the sidebar's logo row; the Worca wordmark moves
  right of them. When the sidebar is collapsed to its rail, the logo row gets a taller top and the lights sit above
  the round mark. In full screen macOS hides the lights, and the logo row goes back to its normal layout.
- **Windows:** the minimize, maximize and close buttons are drawn over the right end of the top bar, in the
  theme's colours (light or dark). The top bar and the open terminal's head keep their own buttons clear of them.
- **Linux:** the native title bar, as before.

The logo row and the top bar move the window when dragged; their buttons, links and fields work as usual. The
Workflows view, which has no top bar, gets a 48px strip at the top for this. A double-click on the empty part of
that strip acts like a double-click on a title bar:

- **macOS** follows System Settings › Desktop & Dock › "Double-click a window's title bar to": Zoom or Fill zooms the
  window (a second double-click restores it), Minimize minimizes it, Do Nothing does nothing.
- **Windows:** the top bar is the window's title bar, so it maximizes and restores. The open terminal's head works
  the same way.
- **Linux:** the native title bar does this itself.

In full screen the double-click does nothing. At the window's narrowest width, the
Chat page's run panel, the Help me answer panel and the export dialogs on the Requirements page fill the window; they
start below the top bar, so the lights and buttons never cover their headers. These rules live in
`ui/public/shell/desktop-shell.css` and apply only when the preload has set `data-shell-chrome` on the page, so
the web UI in a browser looks exactly as before. A server this app did not start may serve an older page without the
desktop CSS (for example an older CLI or web worca already running on the same store), so the app then adds its own
copy of that file to the window on every page load. A newer server's page keeps its own rules; the added copy only
repeats the app's.

**Theme.** The preload tells the app the theme setting (System, Light or Dark), the resulting light or dark scheme
and whether the sidebar is collapsed. The app then sets the window background (and on Windows the button colours)
from its own fixed colours, which match the UI's `--bg`, `--panel` and `--ink` tokens. It saves the theme
setting and the sidebar state (not colours) to `<userData>/window-shell.json`, so the next launch opens in the
right colours with no flash. A missing or broken file means System and an expanded sidebar.

**Icons.** Every icon is generated from the logo `desktop/build-resources/logo.png` by `tools/desktop-icons.mjs`
(pure Node, no image library) and committed. The app icons put the whole black logo on an off-white rounded tile,
so they read on a dark Dock or taskbar as well as on a light one:

| File | Used for |
|---|---|
| `desktop/build-resources/icon.icns` | macOS Dock and app bundle (an off-white rounded tile, 824 inside 1024, with the logo centred) |
| `desktop/build-resources/icon.png` | the same 1024px tile: the About panel, the Dock icon from a checkout and the dev `Worca.app` |
| `desktop/build-resources/icon.ico` | Windows exe, taskbar, installer and uninstaller (16 to 256px, a full-bleed rounded tile) |
| `desktop/build-resources/icons/<n>x<n>.png` | Linux (16 to 512px, the full-bleed tile) |
| `desktop/assets/icon.png` | the window and taskbar icon on Windows and Linux (256px, the full-bleed tile) |
| `desktop/assets/trayTemplate.png`, `@2x` | the macOS menu bar icon (a template image the menu bar tints) |
| `desktop/assets/tray-white.png`, `tray-black.png`, `@2x` | the Windows and Linux tray icon: white on a dark taskbar, black on a light one, swapped when the OS theme changes |

After changing the logo, run `node tools/desktop-icons.mjs` and commit the files.
`node tools/desktop-icons.mjs --check` decodes the committed files and compares their pixels with a fresh
generation (`test/desktop-icons.test.mjs` does the same).

## App name, menu and icon (macOS)

- **Menus.** The menu bar shows **Worca** (About Worca, Services, Hide Worca, Hide Others, Show All, Quit Worca),
  **Edit** (undo, redo, cut, copy, paste, paste and match style, delete, select all), **View** (reload, actual size,
  zoom in, zoom out, full screen) and **Window** (minimize, zoom, close, bring all to front, and the window list).
  Close (Cmd+W) hides the window to the tray. Quit Worca behaves like the tray's Quit.
- **Developer tools.** Toggle Developer Tools is in the View menu only when the app runs from a checkout.
- **About Worca** shows the name, the version and the icon. The packaged app shows its own version; from a checkout
  it shows the version of the checkout's root `package.json`.
- **Icon.** The Dock and the app show the off-white tile with the logo: `icon.icns` in the packaged build, the
  generated `desktop/build-resources/icon.png` from a checkout.
- **userData.** The app sets its name to Worca at start, the same name it already had, so the folder under
  `~/Library/Application Support/Worca` (logs, see [Logs](#logs)) does not move.

Windows and Linux keep Electron's default menu, which has no About item. Their window and taskbar icon is the tile
(`desktop/assets/icon.png`).

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
- When the app opens a window on an already running Worca that is older than the app, that Worca's page has no
  desktop title bar rules: on macOS the traffic lights cover the wordmark, and the window moves only by its edges.
  Restart that Worca from the new version to fix it.
- Running `npm start --prefix desktop` from a checkout shows Electron's own Dock icon on macOS; the packaged app
  shows Worca's.
- Linux has no dot badge: unread schedule problems alone show nothing there, only the tray tooltip says it.
- Run from a checkout on Windows, toasts need a Start menu shortcut that carries the AppUserModelID
  `dev.worca.desktop`. Without one, Windows may label them oddly or drop them. Installing the app provides it.
- An already running Worca that is older than the app still sets the app badge itself (the web Badging API) and may
  race the Dock text, for example showing a number where the app would show `•`. Restart that Worca from the new
  version to fix it.

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
