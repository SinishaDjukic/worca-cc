---
name: worca-release
description: Cut a release candidate or a stable release of @worca/app — bumps the version, commits, tags `worca-app-v<version>`, and pushes so CI publishes to npm with provenance. Triggers on "cut a release", "cut an RC", "release candidate", "bump RC", "stable release", "worca-release", or any request to release @worca/app.
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

`--stable` and `--version:*` are mutually exclusive, and which one applies is
decided by the current version, not by preference — see Step 2.

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

The current version decides which flags are legal. Reject the wrong one rather
than silently ignoring it — a flag that cannot change the outcome must not be
accepted as if it did.

**`--rc`** (semver pre-release, `X.Y.Z-rc.N`) — legal from either state:

- Already a pre-release → increment N: `0.1.0-rc.4` → `0.1.0-rc.5`
- Stable → open the next **minor** line as an RC: `0.1.0` → `0.2.0-rc.1`

The stable → next-minor jump is a default, not a law. If the user wants a patch
line instead (`0.0.1` → `0.0.2-rc.1`) or a major one, ask before computing.

**`--stable`** — legal **only from a pre-release**. Strip the suffix; that is
the release:

- `0.2.0-rc.3` → `0.2.0`

There is no bump to choose here. The micro-vs-minor decision was made when the
RC line was opened, and the whole point of the RCs was to rehearse this exact
number. If the current version is already stable, stop: there is no RC line to
close out, and the user wants `--version:micro` or `--version:minor`.

**`--version:micro` / `--version:minor`** — legal **only from a stable
version**:

- `micro`: `0.2.0` → `0.2.1`
- `minor`: `0.2.0` → `0.3.0`

If the current version is a pre-release, stop: the line is already set, and
neither flag can change what ships. The user wants `--stable`.

Never compute a stable version with `npm version minor`. From `0.2.0-rc.3`,
semver makes `major`, `minor`, and `patch` all collapse to `0.2.0` — the
command doesn't say what you'll get. Always pass the literal version.

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
git add package.json package-lock.json
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

# 3. GA only: `rc` must not trail `latest`. The promote step runs
#    continue-on-error, so it can silently not have happened.
npm dist-tag ls @worca/app
```

If `rc` is behind `latest` after a stable release, re-point it:

```bash
npm dist-tag add @worca/app@<VERSION> rc
```

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
