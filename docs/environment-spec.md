# Project environment spec

A project can store an environment spec. It lists the tools and system packages the project needs to build and test.

This release stores the spec. It does not build anything from it yet. Builds of a container image, an E2B template or a Docker backend image from the spec arrive in later releases. Setting a spec today changes nothing about how runs execute.

## When to use this

Use a spec when your agents need tools the default image lacks. Python, Rust and a database client are common cases.

Do not use it for secrets, env vars or files. It also cannot install tools that are outside mise and apt. The spec holds tool names and pinned versions, nothing else.

The same spec will build the image for every sandboxed setup: "Local sandbox (Docker)", "E2B sandbox", "Hardened box" and "Shared instance". "Native" runs on your own machine and needs no image.

Today only the spec and its CLI ship. No setup builds an image from it yet.

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

## Where it is stored

The spec is stored in Worca's database, under the project, in the `execEnvProject` record. It is never written into the repository.
