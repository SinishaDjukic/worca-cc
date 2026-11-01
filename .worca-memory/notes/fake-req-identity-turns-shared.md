---
name: fake-req-identity-turns-shared
description: Read before an in-process caller (chat bridge, automation) builds a fake req to act as a worca identity and starts an Ask turn or reads presets.
paths: ui/server.mjs, src/core/identity.mjs
updated: 2026-11-01T10:07:32.032Z
author: Bulibas
---

A fake request `{ headers: {}, worcaUser: { email: X } }` makes `resolveIdentity` report source `access`
(`src/core/identity.mjs`), which `isSharedIdentity` treats as a shared deployment. So `askViewer(req)` and
`askSignedIn(req)` return X even on a single-person local install, where the browser gets `null`.

That is not cosmetic: `reader` becomes `WORCA_ASK_READER` and the MCP tools' viewer. Presets on a local install are
stored with owner `null` and filtered by `created_by = reader`, so a non-null reader hides every preset and makes
preset proposals fail "preset not found". It also turns on "me"/`you:` filters and adds a `signed in:` prompt line.
Cost the freeform-Discord plan a review cycle (cycle 3, 2026-11-01).

How to apply:
- Use the fake req only for what worca RECORDS (`actorOf`, `startedBy`, broker bill-to).
- For what a turn SEES, branch on `askSharedOwner(thread)` (`ui/server.mjs`): shared → the identity's req, else a
  bare `{ headers: {} }` (operator name or nothing, like the local browser).
- Prove it on the live turn: `_testing.askJobs.get(threadId).turn.reader` and `.prompt` (look for `signed in:`)
  during a `MOCK_SLOW` turn; flip `WORCA_IDENTITY_HEADER` (read per call) for the shared half.
