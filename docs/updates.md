# Updates

**Settings ▸ About ▸ Updates** shows the version you run, whether a newer one is out, and what
changed in between. Whether Worca may install that version itself depends on who owns the
instance. On a hosted or company-run one, the operator decides.

## What you see

- **Version.** Links to its GitHub release.
- **Updates.** "Up to date", or "1.14.0 is available" with:
  - every stable release between your version and the newest one, each linked to its release
    notes (the list stops at 20 and says how many more there are);
  - **Changes since 1.12.0**: the GitHub compare view between the two release tags;
  - **What's new**: the changelog on docs.worca.dev.
- **Check now** asks again. Worca also checks by itself, once 30 seconds after start and then
  every 12 hours.
- When an update is out, the account menu shows its version next to **Settings**.

A release candidate (`1.14.0-rc.1`) follows the RC channel: you are offered the next RC and the
stable release it becomes. A stable install is only offered stable releases.

## Who installs the update

| How Worca runs | Who updates it | What the card offers |
| --- | --- | --- |
| Desktop, installed with `npm install -g @worca/app` | you | **Update to x.y.z**, then **Restart now**; optional automatic updates |
| Desktop, `WORCA_SELF_UPDATE=0` (a laptop your IT manages) | your IT | the notice and release notes, no button |
| Source checkout (`git clone`) | you, with git | `git pull && npm install`, then `worca ui restart` |
| `npx @worca/app@x` | you | start the version you want |
| Container ([docker.md](docker.md)) | whoever runs compose | `WORCA_TAG`, then `docker compose pull && docker compose up -d` |
| Hosted ([remote-access.md](remote-access.md), [deploy-railway.md](deploy-railway.md)) | the administrator | the notice and release notes only. The update settings are read-only too |

Why containers and hosted instances never update themselves:

- **The image is the version.** A container's code lives in its image. Replacing it in place is
  lost on the next restart and breaks "this tag is what runs here". A new version is a new image
  tag.
- **Rollouts belong to the operator.** On a shared instance people reach through an identity
  proxy, an upgrade is a change to production: staged, done at a time the operator picks, and
  easy to roll back by deploying the previous tag. No visitor's button should trigger that.
- **Supply chain.** Pin an exact tag (or digest), mirror the image or package into your own
  registry, and promote it after review. Images and npm packages are published with provenance
  ([RELEASING.md](RELEASING.md)), so you can verify them before you promote them.

On a desktop install the button runs `npm install -g @worca/app@<the version shown>`. The version
is pinned, never `latest`, so you get exactly the version whose notes you read. npm uses your own
`.npmrc` (registry, proxy, CA). Worca first checks that this copy really is the global one
`npm install -g` replaces. A copy inside some project's `node_modules` is refused.

**Restart now** restarts the server onto the new code (`worca ui restart`). It waits while a run
or a chat turn is in progress: the button stays disabled and says why.

### Automatic updates

**Install updates automatically** is off by default and only offered on a desktop npm install.
When on, Worca installs a new **stable** release (never an RC) while nothing is running, then
restarts once it is idle again. It never restarts in the middle of a run or a chat turn.

## Settings for operators

Set these in the server's environment (`.env` for compose, service variables on Railway). They
override what anyone picks in Settings.

| Variable | Effect |
| --- | --- |
| `WORCA_UPDATE_CHECK=0` | Never contact a registry. For air-gapped networks, or when you track releases elsewhere. The card says checks are off, and the switch is gone |
| `WORCA_SELF_UPDATE=0` | A desktop install shows the notice but never installs. For laptops where IT ships versions (MDM, Intune, Jamf, a golden image) |
| `WORCA_UPDATE_REGISTRY=https://npm.corp/…` | Check an internal mirror (Artifactory, Nexus, Verdaccio) instead of `registry.npmjs.org`. A URL that carries a user name or password is ignored |

The check is a plain `GET` of the package's dist-tags. It carries nothing about your instance:
no id, no version, no usage. It goes through `HTTPS_PROXY` like every other outbound call. Under
an outbound allowlist (the [egress overlay](docker.md), a platform policy), allow
`registry.npmjs.org` or your mirror, or the card reports that it could not check.

## API

| Route | |
| --- | --- |
| `GET /api/app/update` | the status: `current`, `latest`, `target`, `updateAvailable`, `notes`, `apply` (`self` / `managed`), `managedBy`, `instructions`, `restart` |
| `POST /api/app/update/check` | ask the registry now. 409 while checks are off |
| `POST /api/app/update/apply` `{ version }` | install that version. 403 on a managed instance, 409 when `version` is no longer the one offered |
| `POST /api/app/update/restart` | restart onto the installed version. 409 while busy |
| `POST /api/settings` `{ updates: { check?, auto? } }` | the person's choice. Refused on a hosted instance |
