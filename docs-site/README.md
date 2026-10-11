# docs.worca.dev

The Worca docs site, published at **https://docs.worca.dev**.

Right now it is a landing page: the 1.x documentation is not written yet, and
the 0.x docs that used to live here (the `master` line, Python `worca-cc` +
`@worca/ui`) described a product that no longer matches what ships. Until the
new docs land, the page points at the README, the changelog, the why-worca
deck, and the notes under `docs/`.

No framework. `build.mjs` stamps `src/index.html` with the current
`@worca/app` version from the root `package.json` and builds the pages that
already live in `docs/`; the changelog half is `changelog.mjs`:

| Path | Source |
| --- | --- |
| `/` | `src/index.html` |
| `/changelog/` | the release list: `src/changelog.html`, one row per `docs/changelog/entries.json` record, summary and headlines read from each page |
| `/changelog/<version>/` | `docs/changelog/worca-app-v<version>.src.html` in a document shell, with a releases bar and its `shots/<version>/` images as files |
| `/changelog/latest/` | a 302 to the newest release (`_redirects`) |
| `/why-worca/` | `docs/why-worca/why-worca.standalone.html` |
| `/architecture/` | `docs/architecture/viewer.html` (the C4 viewer) with `architecture.c4` beside it, and the viewer module `ui/public/c4/c4-view.mjs` + `dagre.min.js` |
| anything else | `404.html` (the landing page, with a 404 status) |

The build fails when `entries.json` and the pages disagree or an image is
missing, so a broken entry cannot deploy. See `docs/changelog/README.md`.

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
| Build watch paths | `docs-site/*`, `docs/changelog/*`, `docs/why-worca/*`, `docs/architecture/*`, `ui/public/c4/*` (see below) |
| Production branch | `docs-live` |
| Build variable | `NODE_VERSION = 22` |

`docs-live` is a promotion pointer, not a working branch. Nothing publishes
until it moves, and `docs:publish` is how it moves:

```bash
npm run docs:publish -- --dry-run      # from the repo root: checks only
npm run docs:publish                   # fast-forward docs-live to origin/dev
npm run docs:publish -- --to <ref>     # …or to an older commit on dev
```

It refuses a target that is not on `origin/dev` or not a fast-forward, and
builds the site from the target's tree first, so it only moves the pointer to
a commit that builds. Run it after each changelog entry lands on `dev` (the
release procedure in `docs/RELEASING.md` says when).

The pointer was moved from the `master` line onto `dev` on 2026-09-03 (a
one-time force push). From here on it only fast-forwards along `dev`.

**Watch paths.** Workers Builds only builds when a commit touches a watch
path. Set them in the dashboard (Settings → Build → Build watch paths) to:

```
docs-site/*
docs/changelog/*
docs/why-worca/*
docs/architecture/*
ui/public/c4/*
```

With `docs-site/*` alone, a changelog-only change would build nothing. A new
entry always touches `docs/changelog/entries.json`, so it always triggers one.

The `worca-docs-staging` Worker (`staging.docs.worca.dev`) still tracks
`master` and serves the 0.x docs. It is not part of the 1.x pipeline.
