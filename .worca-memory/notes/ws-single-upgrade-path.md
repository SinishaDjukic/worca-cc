---
name: ws-single-upgrade-path
description: Read before adding any new WebSocket endpoint or streaming channel to ui/server.mjs (terminal, logs, live data).
paths: ui/server.mjs
updated: 2026-10-03T08:25:16.470Z
author: Bulibas
---

`ui/server.mjs` builds its one `WebSocketServer` as `{ server, path: '/ws', verifyClient }`. With `path`
set, ws 8 answers HTTP 400 to every upgrade on any other path, so a second
`new WebSocketServer({ server, path: '/ws/other' })` does not work. Doing it properly means switching
both servers to `noServer: true` and routing `server.on('upgrade')` by pathname. That route must
re-apply `isLocalRequest` and `requestIdentity` by hand, because upgrades bypass the express middleware.

The cheaper pattern, used by actions (`action-*`) and the terminal plan (#573, `term-*`), is to
multiplex typed frames on `/ws`:
- Tag each frame with its own id.
- Keep per-socket state on the `ws` object (for example `ws.termAttached`, `ws.terminalAllowed`, set in
  the `connection` handler from the upgrade `req`).
- Send high-volume frames only to the sockets that subscribed, never through `broadcast()`.
- Route them in `app.js` `handleServerMessage` before the `!msg.runId` early return.
