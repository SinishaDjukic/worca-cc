---
name: server-route-and-ws-traps
description: Read before adding an HTTP route, /ws message, WebSocket channel or npm dependency to ui/server.mjs — origin port, single upgrade path, async crashes.
paths: ui/server.mjs, src/core/remote-access.mjs, package.json, test/wsmap-deps.test.mjs
updated: 2026-11-03T21:53:08.460Z
author: Bulibas
---

**The host guard ignores the port.** `createHostGuard` (`src/core/remote-access.mjs:101-114`, used as `isLocalRequest`)
compares only the hostnames of `Host` and `Origin` against localhost, 127.0.0.1, ::1 and `WORCA_ALLOWED_HOSTS`. A page
from `http://127.0.0.1:<any other port>` (another dev server, an Action on 4400-4499 running agent-written code) passes
for every route and the `/ws` upgrade; so does a request with no `Origin`. There is no CSRF token and no
`sec-fetch-site` check. Any route or WS message that executes something or hands out session ids and output needs an
exact-origin check: when `Origin` is present, require `new URL(origin).host === req.headers.host` (case-insensitive), as
`terminalSameOrigin(req)` does (`403 TERMINAL_CROSS_ORIGIN`, #573). Test with `http.request` and explicit `host` /
`origin` headers (Node's `fetch` drops a caller-set Host), and a `ws` client with
`{ host: '127.0.0.1:<port>', origin: 'http://127.0.0.1:4401' }`.

**One WebSocket upgrade path.** The single `WebSocketServer` is `{ server, path: '/ws', verifyClient }`; ws 8 answers
HTTP 400 to upgrades on any other path, so a second server on `/ws/other` does not work. Doing it properly means
`noServer: true` for both and routing `server.on('upgrade')` by pathname, re-applying `isLocalRequest` and
`requestIdentity` by hand (upgrades bypass the express middleware). The cheaper pattern (actions `action-*`, terminal
`term-*`): multiplex typed frames on `/ws`, tag each frame with its own id, keep per-socket state on the `ws` object
(e.g. `ws.termAttached`, set in the `connection` handler from the upgrade `req`), send high-volume frames only to the
sockets that subscribed (never `broadcast()`), and route them in `app.js` `handleServerMessage` before the `!msg.runId`
early return. `/ws` has no backpressure: `send()`/`broadcast()` never check `ws.bufferedAmount`, so a high-rate stream
needs its own flow control (`src/core/terminal/fanout.mjs`).

**An async route that throws outside its try kills the whole server.** Express 4 does not catch rejected async
handlers and worca installs no `unhandledRejection` handler, so the process exits with every terminal and Action it
hosts. A common trigger: `node:sqlite` "Provided value cannot be bound to SQLite parameter N" when a body field is
`undefined`, an object or a boolean. Type-check body fields (`typeof x === 'string'`) before a prepared statement and
keep every await or DB call inside the handler's try/catch; a reviewer proves it with a body-less `DELETE` or `POST`.

**A new runtime dependency turns `test/wsmap-deps.test.mjs` red**: it pins the exact sorted `dependencies` of
`@worca/app` (optional dependencies are not in it). Add the new one there with a one-line reason; plans miss it
because the test's name is about yaml/smol-toml.

**A sandboxed frame (no `allow-same-origin`) sends `Origin: null`** on module scripts, CORS fetches and WS upgrades, and
`createHostGuard`'s `originOk` refuses `null`: a page served by worca into such a frame cannot load its own modules
(tool panel slice 2, 2026-11-03). The preview proxy keeps the Host half only (`hostGuard({ headers: { host } })`) for
`/preview/` paths. The `noServer: true` + one `server.on('upgrade')` router pattern above was built and kept
api-terminal/api-actions green; it needs proxied upgraded sockets destroyed in the `server.close` wrapper, or test
teardown hangs. `test/ui-theme-tokens.test.mjs` also bans the CSS words `white`/`black` outside token blocks (no
white token exists).
