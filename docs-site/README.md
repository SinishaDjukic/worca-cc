# docs.worca.dev

The Worca docs site, published at **https://docs.worca.dev**.

Right now it is a landing page: the 1.x documentation is not written yet, and
the 0.x docs that used to live here (the `master` line, Python `worca-cc` +
`@worca/ui`) described a product that no longer matches what ships. Until the
new docs land, the page points at the README, the changelog, the why-worca
deck, and the notes under `docs/`.

No framework. `build.mjs` stamps `src/index.html` with the current
`@worca/app` version from the root `package.json` and copies the
self-contained pages that already live in `docs/`:

| Path | Source |
| --- | --- |
| `/` | `src/index.html` |
| `/changelog/` | newest `docs/changelog/worca-app-v*.html` |
| `/changelog/<version>/` | every changelog page |
| `/why-worca/` | `docs/why-worca/why-worca.standalone.html` |
| anything else | `404.html` (the landing page, with a 404 status) |

When the real docs arrive, replace `build.mjs` with the generator of choice and
keep `dist/` as the output directory; nothing else in the deploy chain cares.

## Local

```bash
cd docs-site
npm install
npm run build      # -> ./dist
npm run preview    # wrangler dev, serves ./dist with the real 404 handling
```

## Deploy model

One Cloudflare Worker, `worca-docs`, defined by `wrangler.jsonc` and built by
**Workers Builds** (Git-connected CI, configured in the Cloudflare dashboard):

| Setting | Value |
| --- | --- |
| Repository | `SinishaDjukic/worca-cc` |
| Root directory | `docs-site` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Build watch paths | `docs-site/*` |
| Production branch | `docs-live` |
| Build variable | `NODE_VERSION = 22` |

`docs-live` is a promotion pointer, not a working branch. Nothing publishes
until it moves:

```bash
git push origin dev:docs-live          # fast-forward after a docs change merged to dev
```

The pointer was moved from the `master` line onto `dev` on 2026-09-03 (a
one-time force push). From here on it only fast-forwards along `dev`.

Note the watch path: only commits that touch `docs-site/` trigger a build.
A changelog page or deck change under `docs/` is picked up by the *next*
docs-site build, so touch something here (a comment in `build.mjs` will do)
or trigger a rebuild from the dashboard when only `docs/` changed.

The `worca-docs-staging` Worker (`staging.docs.worca.dev`) still tracks
`master` and serves the 0.x docs. It is not part of the 1.x pipeline.
