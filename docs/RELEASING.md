# Releasing

How Worca packages get published, and what has to be configured — once per
package, and occasionally afterwards — for that to work.

Everything here is **tag-driven**: you never run `npm publish` by hand for an
established package. You push a git tag; a GitHub Actions workflow validates,
tests, and publishes it with an OIDC-signed provenance attestation. The only
manual publish in this document is the **bootstrap** of a brand-new package
name, and it exists solely to break a chicken-and-egg problem described below.

---

## 1. Releasables in this repo

| Package | Source | Tag prefix | Workflow |
| --- | --- | --- | --- |
| `@worca/app` | repo root | `worca-app-v*` | `.github/workflows/release-npm-app.yml` |
| `@worca/ui` | `worca-ui/` | `worca-ui-v*` | `.github/workflows/release-npm.yml` |

Every releasable gets its **own tag prefix and its own workflow file**. A bare
`v1.2.3` tag is not usable here — the repo publishes more than one artifact, and
the tag has to say which one it means.

> The two packages currently live on divergent branch lines: `@worca/ui` and its
> workflow are on the `master` line, `@worca/app` on the `dev` line. Workflows
> only run from the branch or tag they exist on, so each package's workflow must
> be present in the lineage its release tags point into.

---

## 2. Tag naming

```
worca-app-v0.1.0        GA release
worca-app-v0.1.0-rc.1   release candidate
```

Rules:

- **`<package>-v<version>`**, where `<version>` is exactly the string in that
  package's `package.json`. The workflow refuses to publish when the two
  disagree, so a typo fails in CI rather than shipping the wrong number.
- The `v` is part of the prefix, not the version. `worca-app-v0.1.0` publishes
  `0.1.0`, never `v0.1.0`.
- Pre-releases use the `-rc.N` suffix, counting from 1. The workflow keys the
  npm dist-tag off the literal substring `-rc.`, so `-beta.1` or `-rc1` will be
  published as `latest`. Use `-rc.N`.
- Tags are created by `npm version`, which also writes `package.json` and
  commits — see §4.

---

## 3. One-time setup for a NEW package

Do this once, when introducing a package name that has never been published.

### 3.1 The npm scope

`@worca` is an **organization** scope on npmjs.com and already exists, so a new
package under it needs no scope-level work. Only a genuinely new scope
(`@worcalabs/...`) would require creating an org first.

Note that scoped packages default to **restricted** (private), which fails on a
free org. Two independent guards, and you want both:

- `"publishConfig": { "access": "public" }` in `package.json` — covers manual
  publishes
- `--access public` on the `npm publish` line in the workflow — covers CI

### 3.2 `repository` must match the building repo

`npm publish --provenance` refuses to run unless `package.json` `repository.url`
points at the same GitHub repository as the workflow generating the
attestation:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/SinishaDjukic/worca-cc.git"
}
```

For a package in a subdirectory, add `"directory": "<subdir>"`. A stale
`repository` field inherited from a template is the single most common cause of
a first release failing at the very last step.

### 3.3 Bootstrap the name (the one manual publish)

npm's Trusted Publishing is configured **per package**, under that package's
Settings tab — which means the package has to exist before you can point an
OIDC publisher at it. So the first version goes up with a token:

```bash
npm login                       # or: set a granular token in ~/.npmrc
npm publish --access public     # version 0.0.1, no --provenance
```

That first tarball is unattested and that is expected; it exists to claim the
name. Publish `0.0.1` — a deliberately inert placeholder — rather than a version
anyone might install.

> Check the package Settings UI first. npm has been adding support for
> pre-registering a trusted publisher for a not-yet-published package; where
> that is available, skip straight to §3.4 and let CI do the first publish.

### 3.4 Configure the trusted publisher on npmjs.com

npmjs.com → the package → **Settings** → **Trusted Publisher** → GitHub Actions:

| Field | Value |
| --- | --- |
| Organization / user | `SinishaDjukic` |
| Repository | `worca-cc` (the GitHub repo name, as-is) |
| Workflow filename | `release-npm-app.yml` |
| Environment | *(leave empty unless the job declares one)* |

The workflow filename is matched **exactly**, and the registration covers
**one package only** — `@worca/ui`'s publisher grants nothing to `@worca/app`,
even though both live in this repo.

### 3.5 Lock the bootstrap credential down

Once §3.4 is in place, CI no longer needs a token. Revoke the granular token
used in §3.3 (npmjs.com → Access Tokens), and — recommended — set the package's
publishing access to **"Require two-factor authentication or trusted
publishing"** so a leaked token cannot publish it.

### 3.6 GitHub side

Nothing to configure beyond the workflow file itself. There is no `NPM_TOKEN`
secret in this repo and there should not be one. What the job *does* need:

```yaml
permissions:
  id-token: write   # mints the OIDC token npm verifies
  contents: read
```

`id-token: write` must be on the **job**, not only at workflow level. Without
it the publish fails with an authentication error that looks, misleadingly,
like a bad credential.

### 3.7 Checklist

- [ ] `name`, `version` (`0.0.1`), `license`, `repository`, `publishConfig.access`
- [ ] `files` allowlist verified with `npm pack --dry-run`
- [ ] Release workflow added, with its own tag prefix and `id-token: write`
- [ ] Bootstrap publish of `0.0.1` done
- [ ] Trusted publisher registered on npmjs.com (repo + workflow filename)
- [ ] Bootstrap token revoked
- [ ] First tag-driven release published with provenance

---

## 4. Regular release procedure

Assumes §3 is done. Work on a release branch, never directly on `dev`.

### 4.1 Release candidates

`npm version`'s own tagging writes a bare `v0.2.0`, which is the wrong shape
for this repo — so bump the version without a tag and create the prefixed tag
yourself. That is the whole recipe, for every release:

```bash
# first RC of a new line — `latest` is untouched, users stay on the old version
npm version 0.2.0-rc.1 --no-git-tag-version
git commit -am "chore(release): @worca/app 0.2.0-rc.1"
git tag worca-app-v0.2.0-rc.1
git push --follow-tags

# subsequent RCs — `prerelease` walks -rc.2, -rc.3, ...
npm version prerelease --no-git-tag-version
git commit -am "chore(release): @worca/app $(node -p "require('./package.json').version")"
git tag "worca-app-v$(node -p "require('./package.json').version")"
git push --follow-tags
```

Testers opt in with:

```bash
npm install @worca/app@rc
```

### 4.2 GA release

```bash
npm version 0.2.0 --no-git-tag-version
git commit -am "chore(release): @worca/app 0.2.0"
git tag worca-app-v0.2.0
git push --follow-tags
```

The workflow publishes under `latest` and moves `rc` forward to the same
version, so `@rc` never resolves behind `@latest`.

> **Do not use `npm version minor` to close out an RC line.** From
> `0.2.0-rc.3`, semver's rules make `major`, `minor`, and `patch` all collapse
> to `0.2.0` — you cannot tell from the command which you will get, and from
> `0.2.1-rc.1` the same three commands disagree. Always type the target version
> literally.

### 4.3 Rules that are not negotiable

- **Versions are permanent.** A published `0.2.0-rc.2` can never be reused, even
  after unpublishing inside the 24-hour window — the number is burned. Burn RC
  numbers freely; never try to republish over one.
- **Release from a clean tree.** `--no-git-tag-version` skips npm's own
  clean-tree check, so this one is on you: the tag must describe exactly what
  CI will build.
- **Push the tag, not just the commit.** `git push` alone pushes no tags and
  triggers nothing. Use `--follow-tags`.
- **Verify after the fact:**

  ```bash
  npm view @worca/app dist-tags
  npm view @worca/app@<version> dist.attestations
  ```

  A missing `attestations` field means the tarball published without
  provenance — treat it as a misconfiguration and investigate before anyone
  installs it.

---

## 5. dist-tags and rc semantics

A dist-tag is a **mutable named pointer to one published version** — think git
branch names pointing at commits. The registry stores nothing more than
`{ latest: "0.2.0", rc: "0.2.0" }`.

Only `latest` has behaviour wired into the npm client:

- bare `npm install @worca/app` resolves `latest`
- `npm publish` writes `latest` **unless** `--tag` is passed

Every other tag name is convention. Ours:

| Tag | Meaning |
| --- | --- |
| `latest` | Stable. What a bare `npm install` gives you. |
| `rc` | The current release candidate. Ahead of `latest` while a line is baking; equal to `latest` immediately after a GA release. |

Two mechanics that explain why this matters:

- **Semver ranges never match pre-releases.** `^0.2.0` will not resolve to
  `0.3.0-rc.1`. A pre-release is reachable only by exact version or by
  dist-tag — that is the entire reason dist-tags exist.
- **`npm publish` does not detect pre-releases.** Publishing `0.3.0-rc.1`
  without `--tag` moves `latest` to it and every plain `npm install` in the
  world gets the RC. The version string being a pre-release changes nothing.
  This is why the workflow derives the dist-tag from the git tag instead of
  trusting anyone to remember a flag.

Also note that `npm install @worca/app@rc` records the **resolved version** in
the consumer's `package.json` (`^0.3.0-rc.1`), not a live pointer to the tag.
Consumers do not follow the tag over time.

Housekeeping: keep the tag list minimal. Tags that stop being maintained
resolve to ancient versions and quietly mislead — if a tag is not being moved
by a workflow, remove it:

```bash
npm dist-tag ls @worca/app
npm dist-tag rm @worca/app <tag>
```

Removing a dist-tag unpublishes nothing; the versions stay installable by exact
number.

---

## 6. Configuration that may be needed later

Most of these are silent until a release fails, so check this list first when a
previously working pipeline breaks.

| Change | What it requires |
| --- | --- |
| **Renaming the workflow file** | Update the workflow filename in the package's trusted publisher settings. The match is exact; a rename breaks publishing with an auth error. |
| **Renaming or transferring the repo** | Update `repository.url` in `package.json` *and* the trusted publisher's org/repo fields. Both are checked. |
| **Moving the job into a GitHub Environment** | Add the environment name to the trusted publisher config; leaving it blank while the job declares one fails the OIDC exchange. |
| **Adding another package** | A full pass of §3 — new tag prefix, new workflow, new bootstrap, new trusted publisher registration. Nothing is inherited from a sibling package. |
| **Publishing a package in a subdirectory** | Set `repository.directory`, and give the workflow steps a `working-directory`. |
| **npm/Node upgrade in CI** | Trusted Publishing needs npm >= 11.5.1 (bundled with Node >= 24.5). The workflow asserts this explicitly rather than failing obscurely at publish time. |
| **Adding a maintainer** | npmjs.com → org → members, then grant the team write access to the package. Not needed for CI publishing, which authenticates as the repo, not as a person. |
| **A release that must go out with the pipeline broken** | Mint a short-lived granular token scoped to the single package, publish locally with `--access public`, revoke it immediately. Do not add a long-lived `NPM_TOKEN` secret to the repo. |
| **Deprecating a bad version** | `npm deprecate @worca/app@<version> "<reason>"`. Prefer this to unpublishing — it warns installers without breaking anyone already pinned. |

### Troubleshooting

| Symptom | Cause |
| --- | --- |
| `npm error code ENEEDAUTH` in CI | Trusted publisher not registered, or workflow filename/repo mismatch, or missing `id-token: write` on the job |
| `provenance generation failed` / repository mismatch | `repository.url` does not point at the building repo |
| `You must sign up for private packages` | Missing `--access public` / `publishConfig.access` on a scoped package |
| `You cannot publish over the previously published versions` | The version was already published — bump it; it cannot be reused |
| Workflow never starts | Only the commit was pushed, not the tag, or the tag does not match the prefix pattern |
| `@rc` resolves behind `@latest` | The GA promote step did not run — re-point it with `npm dist-tag add` |
