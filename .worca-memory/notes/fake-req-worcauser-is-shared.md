---
name: fake-req-worcauser-is-shared
description: Read when an in-process caller (chat bridge, automation) builds a fake req with worcaUser to act as a person and passes askViewer/askSignedIn results on.
paths: ui/server.mjs, src/core/identity.mjs
updated: 2026-11-01T10:02:35.118Z
author: Bulibas
---

A fake request `{ headers: {}, worcaUser: { email: X } }` always resolves as a SHARED identity. `resolveIdentity`
returns `source: 'access'` for any `worcaUser.email` (`src/core/identity.mjs`), and `isSharedIdentity('access')` is
true. This holds on a single-person local install too, and even when X is `'local'`.

So `askViewer(fakeReq)` returns X, where the browser on the same install gets `null`. The resulting `reader` is not
cosmetic. It becomes `WORCA_ASK_READER` and then the Ask tools' `viewer`:
- `list_presets` and preset proposals filter `created_by = X`, but local presets are stored with owner `null`, so every
  preset disappears.
- `startedBy: "me"` and the `you:` markers start applying.
- The context header claims a sign-in.

Flagged as a major in the freeform Discord chat plan review, cycle 3 (2026-11-01).

How to apply:
- Keep the fake req for actor attribution (`startedBy`) and the credential-broker check.
- Gate `reader` and `signedIn` on the deployment with `askSharedOwner(thread)` (`ui/server.mjs`), the helper the server
  already uses for request-less event turns.
- No mock e2e test sees this. Pin it with a non-shared-install test that asserts `reader === null`.
