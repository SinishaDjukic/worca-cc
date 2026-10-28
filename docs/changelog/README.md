# Changelog

One page per release in the ship-log design, written by `/worca-changelog`
from the PRs merged since the previous release. Read them at
**https://docs.worca.dev/changelog/**.

| File | What it is |
| --- | --- |
| `entries.json` | One record per release, newest first: `version`, `since`, `date`, and the Artifact preview's URL. The release list on the docs site is built from it. |
| `worca-app-v<version>.src.html` | The page. Edit this one. |
| `shots/<version>/` | The screenshots the page shows. |
| `unreleased.md` | Notes on merged features that have no release page yet. `/worca-changelog` folds them into the next page and empties the file. |

The list's summary and headlines come from the pages themselves (the hero's sub
line and each section's headline), so they cannot drift from what a page says.

`docs-site/build.mjs` turns each entry into `/changelog/<version>/`, with the
screenshots as separate files. `worca-app-v<version>.html` — the same page
with the screenshots embedded, which `/worca-changelog` publishes as a private
Artifact preview — is a local build output and is git-ignored.

A new entry goes live on docs.worca.dev once it is on `dev` and
`npm run docs:publish` has moved the `docs-live` pointer (see
`docs-site/README.md`).
