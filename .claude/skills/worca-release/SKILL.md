---
name: worca-release
description: Cut a release candidate or a stable release of @worca/app — bumps the version, commits, tags `worca-app-v<version>`, and pushes so CI publishes to npm with provenance — and, with --publish-changelog, commit a /worca-changelog entry to dev and put it on docs.worca.dev. Triggers on "cut a release", "cut an RC", "release candidate", "bump RC", "stable release", "worca-release", "publish the changelog", or any request to release @worca/app.
---

# Release @worca/app

The git tag is the trigger and the source of truth. You bump the version, tag
it, and push; `.github/workflows/release-npm-app.yml` validates, tests, and
publishes with an OIDC provenance attestation. **Never run `npm publish` by
hand** — a manual publish burns the version number and produces an unattested
tarball.

The rules behind this procedure live in `docs/RELEASING.md`. Read it when
something here doesn't fit; do not restate its contents back to the user.

**Usage:**

- `/worca-release` — print status and stop
- `/worca-release --rc` — cut the next release candidate
- `/worca-release --stable` — close out the current RC line
- `/worca-release --version:micro` — stable release from stable, patch bump
- `/worca-release --version:minor` — stable release from stable, minor bump
- `/worca-release --publish-changelog` — commit the changelog entry
  `/worca-changelog` left in `docs/changelog/`, push it to `dev`, and put it
  on docs.worca.dev (see *Changelog mode* at the end). Add `--version:<V>` to
  name the entry; the default is the newest one in `entries.json`. It does not
  cut a release and does not combine with `--rc` / `--stable`.

`--version:` also accepts a **literal target** — `--version:1.0.0` — which
pairs with either mode and says the number outright instead of relying on
inferred arithmetic:

- `/worca-release --rc --version:1.0.0` → `1.0.0-rc.1` (suffix appended)
- `/worca-release --stable --version:1.0.0` → `1.0.0`

Prefer the literal form for any jump the defaults would not reach — a major
release, or opening a patch line as an RC. See Step 2 for which combinations
are legal.

---

## Step 0: No-args mode (status)

If invoked with **no arguments**, print the usage above, then report:

```bash
node -p "require('./package.json').version"          # local version
npm view @worca/app dist-tags                        # what the registry serves
git tag --sort=-v:refname | grep '^worca-app-v' | head -10
```

**Stop here.** Do not release. Tell the user to re-invoke with an argument.

---

## Step 1: Preconditions

All four must hold. Stop and report on any failure — never "fix it and
continue".

```bash
# 1. Clean working tree — the tag must describe exactly what CI will build.
[ -z "$(git status --porcelain)" ] || { echo "ERROR: working tree is dirty"; exit 1; }

# 2. The release workflow MUST exist in the commit being tagged. Tag-triggered
#    workflows run from the tagged ref, not from the default branch — tagging a
#    commit without it fires nothing at all, silently, and burns the tag.
git cat-file -e HEAD:.github/workflows/release-npm-app.yml 2>/dev/null \
  || { echo "ERROR: release-npm-app.yml is not in this commit — merge the release branch first"; exit 1; }

# 3. Local branch is pushed and current, so the tag points at a commit that exists upstream.
git fetch --quiet origin
[ -z "$(git log @{u}..HEAD --oneline 2>/dev/null)" ] || { echo "ERROR: unpushed commits — push first"; exit 1; }

# 4. Tests pass. CI gates on `npm test`; failing here costs 90 seconds,
#    failing there costs a permanent tag.
npm test
```

If `npm test` fails, **stop**. Report which tests failed. A release cannot
proceed past a red suite — the workflow will refuse it anyway.

---

## Step 2: Compute the new version

Read the current version:

```bash
node -p "require('./package.json').version"
```

`--version:` carries one of two things, and which one decides everything
below:

- a **keyword** — `micro` or `minor` — meaning "infer the number"
- a **literal target** — anything matching `X.Y.Z` — meaning "use this number"

The current version decides which flags are legal. Reject the wrong one rather
than silently ignoring it — a flag that cannot change the outcome must not be
accepted as if it did.

### With a literal target

The target is the release line. It is honoured as given; no arithmetic.

- `--rc --version:1.0.0` → `1.0.0-rc.1`, appending the suffix. If the current
  version is already on that line (`1.0.0-rc.2`), continue it: `1.0.0-rc.3`.
  Never restart a line's numbering at `rc.1` — that number is burned.
- `--stable --version:1.0.0` → `1.0.0` exactly.

Two rejections, both hard:

1. **The target must be strictly greater than the highest published version**
   (`npm view @worca/app version`). Reject anything equal or lower: the number
   is already burned and the publish would fail after the tag exists.
2. **`--stable --version:X.Y.Z` while on a pre-release of a *different* line**
   — e.g. on `1.0.0-rc.3` with `--version:2.0.0`. Stop and ask. Shipping a
   number the RCs never rehearsed defeats the point of having cut them.

`--version:<literal>` requires `--rc` or `--stable`. On its own it does not say
which one you mean; do not guess.

### Without a target

**`--rc`** (semver pre-release, `X.Y.Z-rc.N`) — legal from either state:

- Already a pre-release → increment N: `0.1.0-rc.4` → `0.1.0-rc.5`
- Stable → open the next **minor** line as an RC: `0.1.0` → `0.2.0-rc.1`

The stable → next-minor jump is only a default. For a major line, or a patch
line, say so with `--version:` rather than talking the skill out of its
arithmetic.

**`--stable`** — legal **only from a pre-release**. Strip the suffix; that is
the release:

- `0.2.0-rc.3` → `0.2.0`

There is no bump to choose here. The micro-vs-minor decision was made when the
RC line was opened, and the whole point of the RCs was to rehearse this exact
number. If the current version is already stable, stop: there is no RC line to
close out, and the user wants a keyword or a literal target.

**`--version:micro` / `--version:minor`** — legal **only from a stable
version**:

- `micro`: `0.2.0` → `0.2.1`
- `minor`: `0.2.0` → `0.3.0`

If the current version is a pre-release, stop: the line is already set, and
neither keyword can change what ships. The user wants `--stable`.

Never compute a stable version with `npm version minor`. From `0.2.0-rc.3`,
semver makes `major`, `minor`, and `patch` all collapse to `0.2.0` — the
command doesn't say what you'll get. Always pass the literal version.

### Worked examples

| Current | Invocation | Result |
| --- | --- | --- |
| `0.1.0` | `--rc` | `0.2.0-rc.1` (inferred next minor) |
| `0.1.0` | `--rc --version:1.0.0` | `1.0.0-rc.1` |
| `1.0.0-rc.2` | `--rc` | `1.0.0-rc.3` |
| `1.0.0-rc.2` | `--rc --version:1.0.0` | `1.0.0-rc.3` (same line, continues) |
| `1.0.0-rc.3` | `--stable` | `1.0.0` |
| `1.0.0-rc.3` | `--stable --version:1.0.0` | `1.0.0` (identical, just explicit) |
| `1.0.0-rc.3` | `--stable --version:2.0.0` | **stop** — RCs rehearsed 1.0.0 |
| `0.1.0` | `--stable` | **stop** — no RC line open |
| `1.0.0-rc.3` | `--version:minor` | **stop** — line already set |
| any | `--version:0.1.0` | **stop** — already published |

**Print the computed version and confirm with the user before proceeding.**

---

## Step 3: Check the tarball contents

The `files` allowlist in `package.json` decides what ships. Compare against the
last release so nothing sneaks in or drops out:

```bash
npm pack --dry-run 2>&1 | tail -8
```

Verify the file count and package size are in line with the previous release
(`npm view @worca/app dist.fileCount dist.unpackedSize`). A sudden jump usually
means test fixtures or build artifacts entered the allowlist; a sudden drop
means a runtime directory left it. Report either and stop.

---

## Step 4: Bump, commit, tag, push

`npm version`'s own tagging writes a bare `v0.2.0`, which is the wrong shape
for this repo — bump without a tag and create the prefixed tag yourself:

The version bump belongs on the branch being released — `dev` — because the
next release computes its number from `package.json`. A bump parked on a side
branch leaves the line stale.

```bash
npm version <VERSION> --no-git-tag-version
git add package.json npm-shrinkwrap.json
git commit -m "chore(release): @worca/app <VERSION>"
git tag -a worca-app-v<VERSION> -m "@worca/app <VERSION>"
git push origin HEAD
git push origin worca-app-v<VERSION>
```

Substitute the literal computed version — e.g. `npm version 0.2.0-rc.1
--no-git-tag-version`, `git tag -a worca-app-v0.2.0-rc.1 -m "@worca/app 0.2.0-rc.1"`.

**The tag must be annotated (`-a`) and pushed explicitly.** `git push` alone
pushes no tags, and `--follow-tags` pushes *only annotated* ones — so the
obvious-looking `git tag <name>` + `git push --follow-tags` reports success,
pushes the commit, silently leaves the tag local, and fires no workflow.

Confirm the tag actually landed before moving on:

```bash
git ls-remote --tags origin "worca-app-v<VERSION>"
```

---

## Step 5: Watch the release

The workflow derives the npm dist-tag from the tag name: `-rc.` → `rc`,
otherwise `latest`. Nobody has to remember a flag.

```bash
gh run watch "$(gh run list --workflow=release-npm-app.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

If the job fails **before** the publish step, fix it and re-tag with the next
version — the burned number cannot be reused. If it fails **after** publish,
the package is already live; treat it as a post-release fix, not a retry.

---

## Step 6: Verify the published result

Three checks. All three matter; report each.

```bash
# 1. The version is serving under the expected dist-tag.
npm view @worca/app dist-tags

# 2. Provenance was attested. A missing `attestations` field means the trusted
#    publisher is misconfigured and the tarball is unverifiable — investigate
#    before telling anyone to install it.
npm view @worca/app@<VERSION> dist.attestations

# 3. Both pointers read as expected.
npm dist-tag ls @worca/app
```

After a GA release `rc` still points at the last release candidate, and that is
correct — the OIDC credential is granted `npm publish` only and cannot move a
dist-tag, so nothing promotes it. Report it as expected, not as a fault. The
next `--rc` moves it ahead of `latest` again.

---

## Step 7: Print the summary

```
Release complete

  @worca/app:  <OLD> → <NEW>   (dist-tag: rc | latest)
  Tag pushed:  worca-app-v<NEW>
  Provenance:  attested | MISSING — investigate

  Install:
    npm install -g @worca/app@<NEW>     # or: @rc for release candidates
    npx @worca/app
```

Only claim `attested` when Step 6 actually showed an `attestations` field.

For a stable (`latest`) release, end with the next step: *"Next:
`/worca-changelog` for the What's-new page. It offers to commit and publish
the entry when it is done; to do that later, after changing something, run
`/worca-release --publish-changelog`."*

---

## Changelog mode: `--publish-changelog`

Takes the entry `/worca-changelog` left uncommitted in `docs/changelog/`,
commits it to `dev`, and publishes docs.worca.dev. It is the "commit and
publish" answer at the end of `/worca-changelog`, and the separate call when
the entry needed changes first. Steps 1–7 above do not run in this mode.

### C1: Find the entry

```bash
node -e 'const e=require("./docs/changelog/entries.json");console.log(e.map(x=>x.version).join(" "))'
git status --porcelain -- docs/changelog/
```

The version is `--version:<V>` when given, otherwise the first record in
`entries.json` (newest first). The entry is exactly these paths:

```
docs/changelog/entries.json
docs/changelog/worca-app-v<V>.src.html
docs/changelog/shots/<V>/
```

Stop when `worca-app-v<V>.src.html` does not exist, or when none of the three
paths has a change to commit (`git status --porcelain -- <paths>` is empty):
the entry is already committed, so say so and skip to C4 to publish it.

Other uncommitted files are never part of the commit. List them in the
summary so the user knows they were left alone.

### C2: Preconditions

```bash
[ "$(git branch --show-current)" = "dev" ] || { echo "ERROR: not on dev"; exit 1; }
git fetch --quiet origin
git pull --quiet --rebase --autostash origin dev   # dev moves often; land on its tip
node docs-site/build.mjs                          # the site builds with the entry
node --test test/docs-site-changelog.test.mjs
```

Stop on any failure and report it. A build failure names the problem: a
missing image, or a page and an `entries.json` record that disagree.

### C3: Commit and push

```bash
git add -- docs/changelog/entries.json docs/changelog/worca-app-v<V>.src.html docs/changelog/shots/<V>
git commit -m "Changelog: What's new in <V>"
git push origin dev
```

Add only those paths. Never `git add -A`: the built
`worca-app-v<V>.html` is git-ignored, and anything else in the working tree
belongs to someone else. End the commit message with the attribution lines
this session's instructions give.

### C4: Publish the docs

```bash
npm run docs:publish -- --dry-run
npm run docs:publish
```

The dry run shows the pointer move (`docs-live: <old> -> <new>`); stop if it
fails. The real run fast-forwards `docs-live` to `origin/dev`.

### C5: Confirm it is live

Workers Builds takes a few minutes. Poll the page, for up to ten minutes:

```bash
for i in $(seq 1 40); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' https://docs.worca.dev/changelog/<V>/)" = 200 ] && break
  sleep 15
done
curl -s -o /dev/null -w '%{http_code}\n' https://docs.worca.dev/changelog/<V>/
```

Then check the home page. Its version chip, its "Changelog for …" card and
its link all come from the build (`package.json` and the newest
`entries.json` record), so they move with the same deploy, and nothing in
`docs-site/src/` is edited by hand for a release:

```bash
curl -s https://docs.worca.dev/ | perl -ne 'print "$1\n" while /(\@worca\/app [0-9A-Za-z.-]+|Changelog for [0-9A-Za-z.-]+|Built [0-9-]+)/g'
```

Expect `@worca/app <V>` and `Changelog for <V>`. An older version there means
the old build is still being served, even when the changelog page answers.

Still not 200, or a home page naming the previous version, means the
Cloudflare build did not deploy. Check *Build history* (Workers & Pages →
worca-docs → Deployments → View all builds): no row for the new `docs-live`
commit means the push never started a build; a red row has the reason in its
log. Either way the commit can go live without waiting, by deploying exactly
the `docs-live` commit with wrangler, the same deploy Workers Builds runs:

```bash
W=<scratchpad>/docs-live-wt
git worktree add -q --detach "$W" "$(git ls-remote origin docs-live | cut -f1)"
(cd "$W/docs-site" && node build.mjs \
  && CLOUDFLARE_ACCOUNT_ID=05989744162c7031c609e572a5185057 npx --yes wrangler@4 deploy --message "docs-live <sha>")
git worktree remove "$W"
```

Then run the two checks above again, and tell the user which case it was so
the automatic build can be fixed: a red row is usually an expired or rolled
build token (Settings → Builds → API token); no row means Cloudflare never
acted on the push (check the Cloudflare Workers and Pages GitHub app's access
to the repository).

### C6: Summary

```
Changelog published

  Entry:      <V>  (since <SINCE>)
  Commit:     <sha> "Changelog: What's new in <V>" on dev
  docs-live:  <old> → <new>
  Live:       https://docs.worca.dev/changelog/<V>/   (200 | not yet — see the build log)
  Home page:  @worca/app <V> · Changelog for <V>      (| still <old> — see the build log)
  Left alone: <other uncommitted files, or "nothing">
```
