---
name: node-pty-spawn-helper-chmod
description: node-pty 1.1.0's macOS spawn-helper ships non-executable, so pty.spawn() throws "posix_spawnp failed." until the exec bit is set; read before using node-pty.
paths: src/core/terminal/pty.mjs, package.json
updated: 2026-10-03T08:55:26.303Z
author: Bulibas
---

Confirmed in the published tarball (`npm pack node-pty@1.1.0` then `tar -tvzf`): `package/prebuilds/darwin-arm64/spawn-helper`
and `darwin-x64/spawn-helper` are mode `-rw-r--r--`. It is not an artifact of a sandbox or of tar. node-pty's install script
(`node scripts/prebuild.js || node-gyp rebuild`) finds the prebuild and skips the build, so the helper stays non-executable.
node-pty's JS never runs chmod on it.

What happens: `require('node-pty')` succeeds, then every `pty.spawn(...)` throws `Error: posix_spawnp failed.` synchronously.
That error looks like a broken native module, but the module is fine.

Fix, verified on darwin-arm64 with node 26: set the exec bit at runtime before the first spawn. Find the package with
`dirname(require.resolve('node-pty/package.json'))`, then chmod `prebuilds/<platform>-<arch>/spawn-helper` and
`build/Release/spawn-helper` to 0755. If the chmod fails (for example a read-only global install), treat node-pty as
unavailable and fall back to pipes. Also catch a synchronous throw from `pty.spawn` and fall back.

Do not chmod the file by hand in a dev worktree. If you do, the repair path is never exercised on that machine.

Other facts:
- 1.1.0 ships prebuilds only for darwin and win32. Linux builds with node-gyp, and npm skips the package silently when that fails.
- The `onExit` payload is `{ exitCode, signal }`, where `signal` is `0` on a normal exit.
- The child calls setsid, so `process.kill(-pid, 0)` succeeds on it.
