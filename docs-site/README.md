# docs.worca.dev

The Worca docs site, published at **https://docs.worca.dev**.

The pages are the repo's own `docs/*.md`, rendered by
[VitePress](https://vitepress.dev) (`.vitepress/config.mjs`, `srcDir: '../docs'`),
so a doc reads the same on GitHub and on the site. Only the top level of
`docs/` is the site; `superpowers/`, `plans/`, `changelog/`, `why-worca/` and
`ui-primitives/` are excluded. The home page is `docs/index.md`, the sidebar is
in the config, and the brand theme is `.vitepress/theme/custom.css`. The navbar
menu sits on the left and search at the top of the sidebar
(`.vitepress/theme/index.mjs`); `.vitepress/theme/NavBarSearch.vue` drops the
navbar's own search on those pages, so only the home page keeps it there.

`build.mjs` runs the VitePress build, then adds the pages that are not
markdown; the changelog half is `changelog.mjs`:

| Path | Source |
| --- | --- |
| `/` | `docs/index.md` (VitePress home layout) |
| `/<page>` | `docs/<page>.md`; `ARCHITECTURE.md`, `RELEASING.md` and `why-worca.md` are rewritten to `/architecture`, `/releasing` and `/differentiators` |
| `/changelog/` | the release list: `src/changelog.html`, one row per `docs/changelog/entries.json` record, summary and headlines read from each page |
| `/changelog/<version>/` | `docs/changelog/worca-app-v<version>.src.html` in a document shell, with a releases bar and its `shots/<version>/` images as files |
| `/changelog/latest/` | a 302 to the newest release (`_redirects`) |
| `/why-worca/` | `docs/why-worca/why-worca.standalone.html` |
| anything else | VitePress `404.html`, with a 404 status |

The build fails when `entries.json` and the pages disagree or an image is
missing, so a broken entry cannot deploy. See `docs/changelog/README.md`.
VitePress also fails it on a dead link between pages.

Writing a doc for both GitHub and the site:

- Link other docs relatively (`[Guardrails](guardrails.md)`). A relative link
  that leaves the site (`../docker/.env.example`, `../CONTRIBUTING.md`, a plan)
  is rewritten to the file on GitHub at build time, so keep it relative.
- A placeholder in prose needs a backslash, `\<path>`: a bare `<path>` is an
  HTML tag to both GitHub (which drops it) and VitePress (which fails the build).
  Inside backticks it needs nothing.
- `{{ }}` in prose is a Vue expression; inside backticks or a code block it is
  literal.

## Local

```bash
cd docs-site
npm install
npm run dev        # VitePress dev server with live reload (docs pages only)
npm run build      # -> ./dist, everything
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
| Build watch paths | `docs-site/*`, `docs/*.md`, `docs/screenshots/*`, `docs/changelog/*`, `docs/why-worca/*` (see below) |
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
docs/*.md
docs/screenshots/*
docs/changelog/*
docs/why-worca/*
```

**Change for VitePress:** the dashboard still has only the last two `docs/`
paths; add `docs/*.md` and `docs/screenshots/*`, or a docs-only change builds
nothing.

With `docs-site/*` alone, a changelog-only change would build nothing. A new
entry always touches `docs/changelog/entries.json`, so it always triggers one.

The `worca-docs-staging` Worker (`staging.docs.worca.dev`) still tracks
`master` and serves the 0.x docs. It is not part of the 1.x pipeline.
