# Project environment spec

A project can store an environment spec. It lists the tools and system packages the project needs to build and test.

`worca container build` builds the box image from it: the container that `worca container` runs. `worca exec-env build` builds an E2B template or a Local sandbox (Docker) image from the same spec. All three render the spec with one renderer, so the tools and packages are the same in each.

## When to use this

Use a spec when your agents need tools the default image lacks. Python, Rust and a database client are common cases.

Do not use it for secrets, env vars or files. It also cannot install tools that are outside mise and apt. The spec holds tool names and pinned versions, nothing else.

The same spec builds the image for every sandboxed setup. "Native" runs on your own machine and needs no image.

| Setup | Image from the spec |
| --- | --- |
| "Native" | none needed |
| "Hardened box" | `worca container build` |
| "Shared instance" | `worca container build` on the server, then `-f compose.image.yml` and `WORCA_IMAGE` in `shared.env` (the image must be on that server; compose never pulls it). Elsewhere, build the Dockerfile from `--dry-run` in your own pipeline |
| "Local sandbox (Docker)" | `worca exec-env build --project <dir> --backend docker`, or the project page (see [Local sandbox (Docker)](local-sandbox.md#project-images)) |
| "E2B sandbox" | `worca exec-env build --project <dir>`, or the project page (see [E2B](e2b.md#building-and-rebuilding-a-project-environment)) |

Not supported yet:

- Tools outside mise and apt. Extend the image by hand for those (see [Worca in a container](docker.md#images)).
- Internal package mirrors at build time. The build fetches from the public apt, mise and tool sources, through the proxy in the container `.env`. A proxy URL that carries a login is not passed to the build. Set the proxy in Docker's own settings for that case.
- A corporate CA for a proxy that re-signs TLS is not added to the build.

## The format

```json
{
  "tools": [
    { "name": "node", "version": "24.21.0" },
    { "name": "npm:prettier", "version": "3.9.10" }
  ],
  "apt": ["libpq-dev"]
}
```

- `tools` is a list of `{ name, version }`. A name is a [mise](https://mise.jdx.dev) tool name: `node`, `npm:prettier`, `pipx:black`, `github:cli/cli`.
- `apt` is a list of Debian package names.
- `version` is optional. If you give it, it must be 1. Leave it out.

Worca sorts both lists and removes duplicate apt names when it stores the spec. It also adds a `hash` (sha256 over the sorted content) and an `updatedAt` time. The same tools always give the same hash.

## What the spec holds

The spec holds tools only. It never holds env vars, files, paths or secrets. Any other key is refused with an error.

Every tool version must be pinned. `latest` is refused, and so is a missing version. A pinned spec gives the same environment every time.

Limits: at most 100 tools and 200 apt packages. A tool listed twice is refused.

## The CLI

```bash
worca exec-env spec --project <key|dir>                   # show the spec
worca exec-env spec --project <key|dir> --set spec.json   # store (or replace) the spec
worca exec-env spec --project <key|dir> --clear           # remove the spec
worca exec-env spec --project <key|dir> --json            # print it as JSON
```

`--project` takes a project key or the project's folder. The project must be registered (`worca list`).

A spec that fails the checks is refused, and the stored spec stays as it was.

## On the project page

The project page's **Execution environment** section has the spec as a form, above the sandbox backends. There is one spec per project, whichever backend builds it.

- **Tools (mise)**: one row per tool, its mise name and its pinned version. **Add tool** adds a row, **Remove** drops one. An empty row is left out.
- **Apt packages**: the package names on one line, separated by spaces or commas.
- **Save spec** stores it. **Clear spec** removes it, after you confirm.

The server runs the same checks as the CLI. A refusal shows under the form, in the server's words (`tool node: version must be pinned (e.g. 24.21.0), not "latest"`), and what you typed stays. After a save, a build made from the old spec shows as out of date: **Rebuild environment** makes a new one. With no build yet, **Build environment** makes the first.

The form has no base image, env vars, files or secrets: a spec never holds them. The box image's base is set in the container `.env` ([The base image](#the-base-image)).

## Where it is stored

The spec is stored in Worca's database, under the project, in the `execEnvProject` record. It is never written into the repository.

## Building the box image

In the box, one image serves every project. `worca container build` builds it from the specs of the projects you name, or of every project that has a spec.

```bash
worca container build                                 # every project with a spec
worca container build --project ~/dev/acme-api        # only these (repeat --project)
worca container build --dry-run                       # print the Dockerfile, build nothing
worca container build --status                        # current or stale? (--json too)
worca container build --reset                         # back to the plain image
worca container up                                    # restart the box on the new image
```

What it does:

1. It joins the specs. Each tool goes in once, and so does each apt package.
2. It writes a Dockerfile: `FROM` the base, the apt packages, then mise and each pinned tool.
3. It builds the image and names it `worca-box:<12 hex>`. The name comes from the Dockerfile and the base image, so the same input gives the same name.
4. It checks the image. Node must meet Worca's minimum. git, `worca` and the base's pinned Claude Code must be there.
5. It writes `WORCA_IMAGE=worca-box:…` into the container `.env`. `worca container` then adds `compose.image.yml`, which points the box at that image.

Nothing changes until all five steps pass. A failed build or check keeps the previous image in use. Restart the box with `worca container up` to run the new image.

Two projects that pin different versions of one tool are refused. The error names both projects and the tool. Align the versions, or build for one project with `--project`.

### The base image

The build starts from `WORCA_BASE_IMAGE` in the container `.env`. Without it, the build starts from the image of `WORCA_TAG`.

```bash
# ~/.worca-cc/container/.env
WORCA_BASE_IMAGE=registry.acme.example/platform/worca:1.21.0
```

The base is an operator setting. It lives in the container `.env` only, never in a project or a spec. A repository cannot choose what a build starts from.

The base must be a Worca image or one built `FROM` it. Worca images carry the `dev.worca.claude-code.version` label, and the check refuses an image without it. To build Worca itself on a company base image, see [Building it yourself](docker.md#building-it-yourself).

A tool in the spec comes first on `PATH`, for Worca too. A `node` older than Worca's minimum fails the check, and so does a spec that replaces Claude Code.

### Current or stale

The build writes a record next to the `.env`: `.worca-box-image.json` in the container dir. It holds the image name, the base and its image id, each project's spec hash, and the build time.

`worca container build --status` compares that record with now. The image is stale when:

- a project in it changed or cleared its spec,
- `WORCA_BASE_IMAGE` or `WORCA_TAG` names another base, or
- a newer copy of the base was pulled.

A stale image is still used. `worca container up` warns about it. Nothing rebuilds by itself: run `worca container build` again. `--status` also notes projects that have a spec but are not in the image.

Worca inside the box shows the same state in **Settings › General › Security** (Advanced level): the image tag,
**Current** or **Stale** with the reason, and the rebuild command as text. It reads it from what the box was started
with: `compose.image.yml` passes the tag as `WORCA_BOX_IMAGE`, and the image records each project's spec hash in
`WORCA_BOX_IMAGE_PROJECTS`. It compares those with the specs now. A newer base image shows only on the host, with
`worca container build --status`. An image built before this release has no spec hashes: the card says **Unknown**
until you rebuild it.
