---
name: host-guard-ignores-port
description: Read before adding any HTTP route or /ws message that runs commands or changes state — isLocalRequest checks the Origin's hostname only, so other localhost port
paths: ui/server.mjs, src/core/remote-access.mjs
updated: 2026-10-03T08:55:26.303Z
author: Bulibas
---

`createHostGuard` (`src/core/remote-access.mjs:101-114`) is used as `isLocalRequest` in `ui/server.mjs`. It compares
`hostnameOf(req.headers.host)` and `hostnameOf(req.headers.origin)` against the allowed names (localhost, 127.0.0.1,
::1, plus WORCA_ALLOWED_HOSTS). It never compares the port.

As a result, a page served from `http://127.0.0.1:<any other port>` passes the guard for every HTTP route and for the
`/ws` upgrade. Such pages include another dev server, or an Action service running agent-written code on 4400-4499.
A request with no `Origin` header also passes. There is no CSRF token and no `sec-fetch-site` check.

This was harmless while `/ws` only replayed state. Before 2026-10 the only client message was `subscribe`.

Rule: any route or WS message that executes something, or hands out session ids and output, needs an exact-origin
check. When `Origin` is present, require `new URL(origin).host === req.headers.host` (case-insensitive). The terminal
plan (#573, D13) does this as `terminalSameOrigin(req)` and refuses with `403 TERMINAL_CROSS_ORIGIN`.

To test it, send requests with `http.request` and explicit `host` / `origin` headers, because Node's `fetch` drops a
caller-set Host. Then open a `ws` client with the headers `{ host: '127.0.0.1:<port>', origin: 'http://127.0.0.1:4401' }`.
