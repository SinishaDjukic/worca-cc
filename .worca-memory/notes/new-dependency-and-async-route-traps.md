---
name: new-dependency-and-async-route-traps
description: Read when adding an npm dependency or a new async Express route in ui/server.mjs
paths: package.json, ui/server.mjs
updated: 2026-10-03T10:30:50.211Z
author: Bulibas
---

**Adding a runtime dependency turns a census test red.** `test/wsmap-deps.test.mjs` pins the exact
sorted list of `package.json` `dependencies` for `@worca/app`. Any new runtime dependency (for example,
`@xterm/xterm` for issue #573) must be added to that list, with a one-line comment saying why. Plans
tend to miss it, because the test's name is about yaml/smol-toml. Optional dependencies are not in
that list.

**An async route in `ui/server.mjs` that throws outside its try crashes the whole server.** Express 4
does not catch rejected async handlers, and worca installs no `unhandledRejection` handler, so the
process exits. Every terminal and Action the server hosts goes with it. A common trigger is
`node:sqlite` throwing "Provided value cannot be bound to SQLite parameter N" when a request-body field
is `undefined`, an object or a boolean.

Rule for new routes:
- Type-check body fields (`typeof x === 'string'`) before they reach a prepared statement.
- Keep every awaited or DB call inside the handler's try/catch.

A reviewer can prove it with a body-less `DELETE` or `POST`.
