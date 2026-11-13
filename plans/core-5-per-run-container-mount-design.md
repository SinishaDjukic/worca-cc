# core-5: a project-scoped container box with secret masks

Date: 2026-10-24. Run R7 of the protection program (plan Task 15). Inputs fixed by
`plans/core-protection-layer-design.md` §4.6: one project path, and `maskPlan(projectDir, secretPathsFor(project))`.

## 1. What exists, and what "per run" can mean today

`worca container` runs the whole Worca server in one container (`docker/compose.yml`). Every agent is a child
process of that server, inside the same container and the same mount namespace. The container binds the whole
`${WORCA_PROJECTS}` tree read-write at the same path, so a run in project A can read project B and every secret file
in both.

A true per-RUN mount needs one of two things this setup does not have:

| Option | What it takes | Cost |
| --- | --- | --- |
| Per-run sibling containers | the server starts one container per run through the Docker socket | the socket is root-equivalent on the host, which undoes the box; a new exec backend, image and lifecycle (start, stream, stop, reattach) |
| Per-spawn mount namespaces | `bwrap`/`unshare` around each agent spawn | `CAP_SYS_ADMIN` or a relaxed seccomp profile, against today's `cap_drop: ALL` and `no-new-privileges` |

Both are large changes. What IS buildable on today's compose setup, without either, is a **project-scoped box**: one
box binds one project. The owner chose that (clarify answer 1). Every run in that box sees only that project, so "a
run cannot read a sibling project" holds for every run in it. What it does not give: two projects at once in one box,
or a different mount per run in the same project.

## 2. How the box gets only its project

`worca container up --project <dir>`:

1. Resolves `<dir>` to its real path and refuses the filesystem root, the home folder or a folder holding it, a
   folder holding the Worca home, and the clone-in overlay (which mounts no host folder).
2. Passes `WORCA_PROJECTS=<dir>` and `WORCA_PROJECTS_MOUNT=<dir>` to every `docker compose` call. `compose.yml`
   already builds its one bind from these, so the box binds `<dir>:<dir>` and nothing else from the host. Path
   parity keeps git worktree metadata valid. (compose.yml would also make `<dir>` the in-box projects root; step 6
   changes that.)
3. Runs the box as its own compose project, `-p worca-<name>-<hash>` (one per real path), so it has its own volumes.
   This matters: the `worca-home` volume keeps every run checkout, the store and the database of every project a box
   ever ran, and agents run as the same user as the server. A scoped box that reused the whole-tree box's volumes
   would still show project B to a run in project A.
4. Stops the box this container dir ran before, when the box changes (its volumes stay, and its active runs pause as
   on any stop), so the old whole-tree box does not keep running beside it.
5. Remembers the project in `<containerDir>/.worca-container.json`, like `--with`, and checks it again on every
   `up`. `run`, `login` and `shell`, which start one-off containers, carry the same name, env and masks.
   `up --no-project` goes back to the whole-tree box, with its history.
6. Sets the box's projects root to the project's parent. In the box that folder holds only the project and is not
   writable, so **New** and chat clones fail there instead of creating a repository inside the project.

Run checkouts: in the default detached layout they live on the `worca-home` volume (`/worca/runs/<id>/repos/<key>`),
and `git worktree add` writes into `<dir>/.git`, so the bind stays read-write. A checkout holds only committed files
plus the run's own work. Nothing copies untracked files into it. A Folder (non-git) project is the exception: its
run copies the whole folder, so a masked file arrives as an empty file, and Apply of a change to it fails.

A scoped box has its own login (`worca container login` once, or `CLAUDE_CODE_OAUTH_TOKEN`) and its own project
list: register the project in it once, at its real path. A second project at the same time is a second container
dir: `worca container init --dir <d>`, then another `WORCA_PORT` in that dir's `.env`.

Workspace runs (several projects) are out of scope: a project-scoped box has one project mounted.

## 3. From `maskPlan` to mounts

`up` computes the masks on the host, every time:

- `maskPlan(dir, secretPathsFor({ secretPaths }))` lists the files that exist and match (`.env*`, `*.pem`, `*.key`,
  `.npmrc`, `.netrc`, `id_*`, plus the project's `secretPaths`).
- Dropped from that list:
  - anything under `.worca-cc/` (worca's own legacy run checkouts);
  - anything under an installed-packages folder (`site-packages/`, `dist-packages/`, `vendor/`, `.pixi/`). Every
    Python virtualenv holds certifi's `cacert.pem` (Composer and pixi ship one too), and an empty CA bundle breaks
    TLS in the box. `maskPlan` already skips `node_modules` for the same reason;
  - anything a `secretPathsUnmask` pattern matches;
  - committed files (`git ls-files --recurse-submodules`). A committed secret is in the git history, which the box
    has anyway. Covering it would make git see it as modified, and an agent's `git add -A` could commit it empty. It
    is named once in a warning, the same rule the sandbox upload uses.
- When git is missing or refuses the repository's config, nothing can be told apart, so every match is masked and a
  warning says why.
- A link is masked at its target, because Docker resolves a mount target through links. A link whose target is a
  file inside the project masks that file. A link that leads out of the project or nowhere is not masked and is named
  in a warning: the box does not have that path.

Each remaining path gets one long-syntax bind in a generated overlay, `<containerDir>/project-mount.yml` (which
also sets the projects root):
`{ type: bind, source: <containerDir>/mask-empty, target: <dir>/<path>, read_only: true }`. `mask-empty` is a 0-byte
file, mode 0444. Inside the box the file reads as empty. A write fails with "read-only file system", and a delete or
rename fails with "device or resource busy". The overlay goes last on the `-f` list, so the masks sit on top of the
project bind. A tmpfs per secret path is not used: tmpfs mounts directories, and `maskPlan` lists files.

**Paths that appear during the run.** Masks are fixed when the box starts.
- A secret file created on the host afterwards is readable in the box until the next `worca container up`.
- So is a masked file that an editor saves by writing a new file and renaming it over the old one: the rename
  detaches the bind.
- `up` re-plans each time. compose recreates the box when the overlay changed.
- Files that agents create in a run checkout, on the box's volume, are their own work and are never masked. A file
  written into the project folder itself belongs to the project, so the next `up` masks it if it matches.
- `up` prints this limit once.

## 4. What changes for users

- New: `worca container up --project <dir>` (remembered) and `--no-project`. Opt-in: the whole-tree bind stays the
  default (clarify answer 2). `up` now prints a line saying the whole tree is mounted unmasked.
- A scoped box is a separate box: its own login, project list and history. Switching between boxes stops the other.
- `up --project` prints what is mounted and masked, and warns about committed secrets and links it cannot mask.
- A project adds patterns with its `secretPaths` setting (decision 6), and leaves patterns unmasked with the new
  `secretPathsUnmask` setting, for example `[".env.example"]`. Both are lists of single-line patterns, at most 200,
  validated by `isSecretPathList`, and set per project or in `settings.json`. They are read from **this machine's**
  worca settings for that folder. The box's own Settings page cannot change the box's own mounts.
- `secretPathsUnmask` applies to the container mount only. The E2B upload (`overlayFiles`, owned by core-3) honours
  it in a follow-up.
- Unchanged: clone-in stays the strongest mode, and the default mount is the same.

## 5. Decision 4

Native stays the local default. Container and E2B stay opt-in. This change does not touch the default. The owner
could revisit it once:
- the project-scoped box has been used on real projects;
- `docker:smoke` covers the conformance row below;
- per-run mounts exist (a sibling-container backend).

## 6. Tests that prove it

Docker is not available on the build machine, so the proof is in two layers:

- **Unit tests, `test/cli-container.test.mjs`** (always run):
  - a run cannot read a sibling project: `up --project A` passes `WORCA_PROJECTS=A` and `WORCA_PROJECTS_MOUNT=A`
    and its own compose project (`-p`) to `up` and to every later verb, and stops the whole-tree box first;
  - switching to project B stops A's box; a remembered project that is gone refuses `up`;
  - the overlay masks an untracked `.env` and an ignored `.env.local` with the read-only empty file, and the empty
    file is 0 bytes and 0444;
  - an added project path (`secretPaths: ['*.tfvars']`) is masked, and an unmasked one
    (`secretPathsUnmask: ['.env.example']`) is not;
  - a committed `config/.env` is warned about, not masked;
  - a link out of the project, or a dangling one, is not masked;
  - nothing under `.worca-cc/` is masked, not even through a link;
  - installed packages (a virtualenv's `cacert.pem`, vendored gems) are not masked;
  - when the repository's git config is refused, every match is masked and the reason is given;
  - every refusal above.
- **`docker compose config` test** (skipped when `docker compose` is missing):
  - the rendered config is its own compose project, and its projects root is the parent of `<dir>`;
  - it has exactly one host bind besides the masks, `<dir>:<dir>`;
  - every mask is a read-only bind of the empty file.
- **Conformance row C-MASK** (deferred to `npm run docker:smoke`, which needs a Docker host): inside the box,
  - `cat <dir>/.env` prints nothing;
  - `echo x > <dir>/.env` fails;
  - `ls <sibling>` fails.
  The manual check is in `docs/docker.md`.
