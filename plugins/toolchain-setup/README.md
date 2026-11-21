# toolchain-setup

A pipeline that finds the toolchains a repository needs, installs them with [mise](https://mise.jdx.dev) after
approval, checks that they run, and records a per-project lock. Nothing is written into the repository: installs go
into one shared toolchain root, and each project's lock and environment file sit beside it.

## The flow

| Step | Kind | What it does |
|---|---|---|
| Detect | script | Reads version files (`.tool-versions`, `mise.toml`, `.nvmrc`, `rust-toolchain.toml`, `go.mod`, `pyproject.toml`, `pom.xml`, Gradle files, `pubspec.yaml`, `global.json`, `package.json`, …) and probes for mise. No mise: routes to Ask / Bootstrap |
| Ask to install mise | agent | One question, Install or Skip. Away mode may answer it (see below) |
| Bootstrap | script | Installs mise for this user: `brew install mise`, else the mise.run installer into `~/.local/bin`; on Windows winget (`jdx.mise`, user scope), else scoop. Never sudo |
| Investigate | agent | Reads CI files, Dockerfiles, Makefiles and docs for what Detect cannot see. Read-only; writes proposals as data, never commands |
| Resolve | script | One plan from Detect's facts and the proposals: concrete versions, sizes, conflicts, what is already installed |
| Approve | agent | One question listing every row: Install all, Install selected, or Skip |
| Install | script | Installs exactly the approved rows, nothing else |
| Verify | script | Proves each installed tool runs; reports anything new in `$HOME` |
| Record | script | Writes `toolchain.lock.json`, `toolchain.env` and `toolchain.env.json`; reports the run |

## What a proposal can name

- A mise registry tool: `node`, `java`, `terraform`, `jq`, … (a Java vendor goes in the version: `temurin-17`).
- A mise backend spec: `github:owner/repo`, `aqua:owner/repo`, `npm:name`, `pipx:name`, `cargo:crate`, `go:module/path`,
  `gem:name`. A backend that needs a runtime (npm needs node, pipx needs uv, cargo needs rust, go needs go, gem needs
  ruby) gets that runtime as its own row. `http:`, `ubi:`, `asdf:` and `vfox:` are refused.
- A system package, for what no toolchain manager installs (C libraries, build tools): `brew:`, `apt:`, `dnf:`,
  `winget:`, `scoop:`, without a version. Only the package managers present on the machine count; the others are
  listed as "for other operating systems". apt and dnf without passwordless sudo become "run this yourself".
- An Android SDK component: `sdkmanager:platforms;android-34` and similar.

## Where things go

- **Toolchain root**: `~/.worca-cc/toolchains`, or `/data/toolchains` when `/data` exists (a container volume). The
  Resolve card's *Toolchain root* param overrides it.
- **Per project**: `<root>/projects/<slug>/` holds `toolchain.lock.json`, `toolchain.env` and `toolchain.env.json`.
  worca runs do not load `toolchain.env` yet.
- **Kept inside the root**: mise's data, cache and state, rustup and cargo homes, the npm (aube), uv and go caches, and
  uv's own Python. Terraform's version check-in is switched off and the `~/.default-*-packages` lists are ignored.
- **System packages** install system-wide, outside the root, and are listed separately in the report.

## Approval and Away mode

- Away mode may approve toolchain rows and the mise install: what gets installed comes from fixed sources and the
  plan, never from free text.
- System packages are **never** installed on Away mode's answer, or when it cannot be confirmed that a person answered.
  Install refuses them and prints the command to run yourself.

## Requirements

- **mise 2026.10.7 or newer.** Older versions ignore settings the isolation depends on; Resolve then marks every row
  "not possible here" with upgrade steps.
- Node 22.13 or newer (worca's own floor).
- macOS and Linux are tested for real. Windows (`mise.exe` lookup, winget and scoop bootstrap, `rustup.exe`) is
  covered by tests only.

## Tests

```bash
worca plugin validate plugins/toolchain-setup --run-cases    # the 14 shipped cases, on the real bench
node --test test/toolchain-setup-*.test.mjs                  # the script suites, against stub tools
```

The suites stub `mise`, `brew`, `winget`, `rustup` and `powershell` on a temporary PATH and HOME, so they install
nothing and need no network. They are POSIX shell stubs: the suites skip on Windows.

One manual check downloads for real, on macOS only: `npm run smoke:toolchain-bootstrap`. It hides Homebrew's mise
with `sandbox-exec`, installs mise with the mise.run installer into a scratch HOME (about 20 MB), and resolves a version
with it. Your own mise and HOME are not touched; `--keep` (via `node tools/smoke-toolchain-bootstrap.mjs --keep`)
keeps the scratch folder.

## Developing it

Your own scripts and agents win over a plugin's on a key clash, so remove local copies of the `toolchain*` scripts and
agents (in `~/.worca-cc/scripts` and `~/.worca-cc/agents`) before linking:

```bash
worca plugin link plugins/toolchain-setup
worca plugin reimport toolchain-setup      # after editing workflows/toolchain-setup.json
```

A workflow edited in the UI can be exported back over this folder with
`worca workflow export <id> --format plugin --target plugins/toolchain-setup`.
