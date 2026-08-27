# Plugin Marketplaces — Design Spec

Date: 2026-08-17
Status: approved design, pre-implementation
Branch context: work builds on `feat/chat-connectivity` (the 4 chat plugins live there).

## 1. Problem & goals

Today Worca CC has **no persisted concept of a plugin repo**. `worca plugin add <url>` and
`POST /api/plugins/repo` are stateless scans; the discovered list lives only in the terminal
scrollback / DOM and is forgotten. The only registry is `plugins.lock.json` (installed plugins,
keyed by name). The 5 sample plugins live under `examples/plugins/` and are not reachable from
the UI at all.

Goals:

1. **This repo becomes a plugin repo (marketplace).** `examples/` is removed; the 5 plugins move
   to top-level `plugins/`. The repo declares them via a marketplace manifest.
2. **Built-in default marketplace.** The host's own repo checkout is auto-registered on first
   run, so its plugins appear in the UI ready to install.
3. **Marketplace management.** Users can add git repos (URL, `owner/repo`, or local path) as
   marketplaces; plugins from **all** marketplaces are listed in the UI for install; marketplaces
   can be removed. Removal deletes discovery only — **installed plugins remain fully functional,
   including updates**.

Non-goals:

- No central/hosted index, no ratings, no versioned release channels (HEAD-only discovery stays).
- No change to plugin manifest schema (`worca-cc-plugin.json`), install internals, consent
  inventory content, sandboxing, or the connector/channel runtime.
- No pre-installation of the bundled plugins — they are *available*, not installed.
- No migration of existing lock files (format is backward compatible).

## 2. Decisions locked with the user

| Question | Decision |
|---|---|
| Built-in marketplace reference | **Local checkout** — the repo root the host runs from, registered as a local-path marketplace. Discovery reads committed HEAD; `worca plugin link` remains the dev loop for uncommitted work. |
| Plugin layout + declaration | **`plugins/<name>/` + optional `worca-cc-marketplace.json`** at repo root. Repos without the manifest keep today's depth 0–1 auto-scan, so every existing plugin repo works as an implicit marketplace. |
| UI placement | **One Plugins view**, three sections: Installed / Available / Marketplaces. Replaces the transient Add-repo→Scan row. |
| Built-in removable? | Yes — removable like any other; seeded exactly once (never re-seeded after removal). |
| Updates after marketplace removal | Keep working — updates use the lock entry's own `repo`/`subdir` provenance, which is independent of the marketplace registry. |

## 3. Current-state facts this design builds on

(Verified in code during exploration; line numbers as of this branch.)

- `addPluginRepo(url)` (`src/core/plugin-repo.mjs:56`): `git clone --bare` /fetch into
  `<worcaHome>/plugins/.cache/<slug>.git` (`repoCacheDir`, `plugin-repo.mjs:23-31`), then scans
  **HEAD tree only** via `git ls-tree -r` for `worca-cc-plugin.json` at depth 0–1
  (`plugin-repo.mjs:62-82`). Returns `{repoUrl, sha, discovered[], warnings[]}`. Persists nothing.
  `owner/repo` shorthand → `https://github.com/owner/repo` unless an existing local path
  (`plugin-repo.mjs:59-61`). Local paths are valid repo URLs (bare clone from path).
- `installPlugin({repoUrl, subdir, name, sha})` (`src/core/plugin-store.mjs:198`): export via
  `git archive` from the bare cache into `<worcaHome>/plugins/<name>/versions/<sha7>`
  (`exportVersion`, `plugin-repo.mjs:188-215`), validate, `npm ci`/`uv sync`, consent inventory
  (`buildInstallInventory`, `plugin-store.mjs:59-114`), atomic `current` symlink swap, lock write
  (`plugin-store.mjs:212-218`: `{repo, subdir, pinnedSha, version, enabled, installedAt,
  lockfileHash}`), then workflow import.
- `updatePlugin` uses `fetchCandidate(name)` (`plugin-repo.mjs:153-178`) which reads
  `repo`/`subdir` **from the lock entry** — no external registry involved.
- `uninstallPlugin` (`plugin-store.mjs:302-343`) deletes the bare cache **only if no other lock
  entry shares that repo** (`plugin-store.mjs:333-335`).
- UI: `GET /api/plugins` (`ui/server.mjs:2801`) returns installed + orphans only. Transient scan:
  `POST /api/plugins/repo` (`ui/server.mjs:2811-2827`) + `discoveryInventory`
  (`ui/server.mjs:2786-2799`, git-archive to tmpdir → inventory → delete; no plugin code runs).
  Install-from-UI: `openInstallConsent` (`ui/public/app.js:6384-6399`) → `renderInstallConsent`
  (`ui/public/plugins-view.mjs:111-171`) → `POST /api/plugins/install` (`ui/server.mjs:2832`).
- View pattern: vanilla ES modules, no build. Section markup in `ui/public/index.html`
  (plugins: 730-750), pure DOM renderers in `ui/public/plugins-view.mjs` (jsdom-tested), state +
  fetches + one delegated click listener in `ui/public/app.js` (element cache 242-254, loader
  dispatch ~9766-9778, plugins listener 6442-6512), styles `ui/public/style.css`.
- CLI: `worca plugin` dispatch `src/cli/worca-cc.mjs:1055-1240`, help text 798-813.
  `plugin install` requires `--repo` unless the name is already in the lock
  (`worca-cc.mjs:1093-1094`).
- `worcaHome()` = `<WORCA_HOME | repoRoot | home>/.worca-cc` (`src/core/projects.mjs:24-40`) —
  repo-root detection already exists; reuse it for built-in seeding.
- `examples/` contains only `examples/plugins/{github-source, telegram-chat, slack-chat,
  discord-chat, teams-chat}`. **Zero references from `src/` or `ui/`.** Load-bearing references:
  - Hard ESM imports: `test/github-source-connector.test.mjs:7`,
    `test/telegram-chat-worker.test.mjs:12-14`, `test/slack-chat-worker.test.mjs:8`,
    `test/discord-chat-worker.test.mjs:8-9`, `test/teams-chat-worker.test.mjs:9-11`.
  - Runtime path: `test/chat-lib-drift.test.mjs:13` (`join(..., '..', 'examples', 'plugins')`)
    + canon assert `:19` (`telegram-chat` must exist).
  - `.gitignore:3` (`examples/sandbox`), `package.json:22` (smoke `--project examples/sandbox`
    — fails *silently* if the dir concept moves), `README.md:160` (same command),
    `scripts/smoke-workspace.mjs:15` (comment).
  - `.claude/skills/creating-worca-cc-plugins/SKILL.md:129` (example pointer).
  - Plugin READMEs: self-path references, `worca plugin link examples/plugins/<n>` lines,
    and `github-source/README.md:41` §Publishing declaring publish-by-copy into
    `denislavprinov/maestro-plugins` (this feature replaces that model).
- The four chat plugins vendor identical `lib/` copies; `test/chat-lib-drift.test.mjs` enforces
  byte-identity with `telegram-chat` as canon.

## 4. Design

### 4.1 Marketplace manifest — `worca-cc-marketplace.json`

Optional file at a marketplace repo's root:

```json
{
  "name": "Worca CC Official",
  "description": "Plugins bundled with the Worca CC repo",
  "plugins": [
    "plugins/github-source",
    "plugins/telegram-chat",
    "plugins/slack-chat",
    "plugins/discord-chat",
    "plugins/teams-chat"
  ]
}
```

Rules:

- `plugins[]`: repo-relative dirs, any depth. Each must contain `worca-cc-plugin.json`.
  Validation mirrors module-path rules: must not start with `/` or `./../`, no `..` segments,
  no backslashes, no empty entries. `name` required when the file exists; `description` optional.
- Present + valid → it is the **complete** plugin list (no additional scanning).
- Absent → fall back to today's depth 0–1 auto-scan (backward compatible with every existing
  plugin repo).
- Invalid file (bad JSON, bad shape) → treated per-entry where possible; file-level failure →
  fall back to scan **and** surface a warning. Individual bad entries (missing dir, invalid
  plugin manifest, engines-incompatible) → skipped into `warnings`, never thrown — same policy
  as today's scan.
- Duplicate plugin names within one manifest → first wins, warning for the rest.

### 4.2 Marketplace store — `src/core/marketplaces.mjs` (new)

New JSON file `<worcaHome>/plugins/marketplaces.json`, atomic temp+rename writes, tolerant reads
(never throw), unknown keys preserved — same conventions as `src/core/plugins-lock.mjs`.

```json
{
  "seededBuiltin": true,
  "marketplaces": {
    "<id>": {
      "url": "https://github.com/owner/repo | /abs/local/path",
      "name": "Worca CC Official",
      "description": "…",
      "builtin": true,
      "addedAt": "ISO",
      "lastSync": { "sha": "<full-sha>", "at": "ISO" },
      "plugins": [
        { "name": "github-source", "subdir": "plugins/github-source",
          "description": "…", "version": "1.2.0",
          "inventory": { /* buildInstallInventory output */ } }
      ],
      "warnings": ["…"]
    }
  }
}
```

- `id` = slug of the normalized url — **same slugging as `repoCacheDir`** so id ↔ bare-cache dir
  correspond. Normalization: apply the `owner/repo` → github URL expansion, resolve local paths
  to absolute, strip trailing `/` and `.git`. Adding an already-present normalized url → error
  `code:'EXISTS'` (HTTP 409).
- `plugins[]` is the **cached discovery snapshot**: everything the UI needs to render Available
  cards and open the consent modal with zero network. `inventory` is computed at sync time via
  the existing tmpdir git-archive inventory routine (moved from `ui/server.mjs:2786` into core so
  CLI and server share it — see 4.8).
- `version` comes from the plugin manifest when present (absent ⇒ sha-is-version, per existing
  convention).

Exported API (all sync-file + async-git, mirroring existing module style):

- `readMarketplaces()` / private atomic write
- `addMarketplace(url)` → normalize, dedupe, `syncMarketplace`, persist entry, return it
- `removeMarketplace(id)` → delete entry; delete `.cache/<slug>.git` **only if** no
  `plugins.lock.json` entry has a matching normalized `repo` (reuse the uninstall refcount rule,
  `plugin-store.mjs:333-335`)
- `syncMarketplace(id | url)` → discovery + inventories → rewrite snapshot + `lastSync`; on git
  failure, keep prior snapshot, set `warnings` (stale-but-usable)
- `listMarketplaces()` → entries merged with nothing (raw); installed-flag merging happens at the
  API layer where the lock is already read
- `seedBuiltinMarketplace()` → if `seededBuiltin` is falsy **and** the host runs from a git repo
  root (reuse the `projects.mjs` repo-root detection; additionally require
  `worca-cc-marketplace.json` to exist there to avoid seeding arbitrary checkouts): add it with
  `builtin: true` and set `seededBuiltin: true`. The flag is set **only on successful seed** —
  detection failure leaves it falsy so a later run from a proper checkout can still seed; once
  seeded, a removed builtin never resurrects (see edge cases 4.12).

Seeding call sites: server startup (`ui/server.mjs` boot path) and lazily at the start of CLI
`marketplace` commands. Seeding performs **no git operations** — it only writes the registry
entry (`plugins: []`, `lastSync: null`); the first sync happens via the Plugins view's
background refresh-all or an explicit refresh. This keeps boot fast and offline-safe.

`addMarketplace` (user-invoked) DOES sync immediately, and **fails without recording** when the
repo is unreachable (clone/scan error) — a typo'd URL never leaves a junk entry. Only syncs of
an already-registered marketplace degrade to stale-snapshot + warning.

### 4.3 Discovery changes — `src/core/plugin-repo.mjs`

`addPluginRepo(url)` grows marketplace-manifest awareness (existing callers keep working; the
return shape is extended, not changed):

1. `ensureCache` + `rev-parse HEAD` (unchanged).
2. Try `git show <sha>:worca-cc-marketplace.json`.
   - Parse + validate per 4.1. For each listed dir, `git show <sha>:<dir>/worca-cc-plugin.json`
     → `normalizeManifest`. Valid → `discovered[]` entry `{name, subdir: dir, manifest}`.
   - Return gains `marketplace: {name, description} | null`.
3. No manifest → existing depth 0–1 `ls-tree` scan; `marketplace: null`.

**`exportVersion` subdir depth — verified correct.** `plugin-repo.mjs:201` already computes
`--strip-components` as `String(sub.split('/').length)`, and `discoveryInventory`
(`ui/server.mjs:2793`) does the same; `fetchCandidate` uses the subdir as a git pathspec (depth
irrelevant). No fix needed — the plan adds depth-2 regression tests to lock this in.

### 4.4 Install / update / provenance

- Core install/update/uninstall flows unchanged. The Available card supplies
  `{repoUrl, subdir, name, sha}` from the snapshot exactly as the transient scan did.
- Lock entry gains optional `marketplace: "<id>"` written at install time when the install came
  from a marketplace (UI always; CLI when resolved via marketplaces). **Display provenance
  only** — update (`fetchCandidate`) keeps reading `repo`/`subdir` from the lock, so removing a
  marketplace affects neither updates nor uninstall. Unknown-key tolerance in
  `plugins-lock.mjs` means old code reading a new lock is unaffected.
- `listInstalledPlugins()` (`plugin-store.mjs:388-407`) additionally returns `repo`, `subdir`,
  and resolved marketplace name (when the id still exists) so installed cards can show
  provenance.
- Name collisions: two marketplaces shipping the same plugin name both appear in Available
  (badge disambiguates). Install of a name already in the lock stays refused
  (`plugin-store.mjs:201`); UI preempts by rendering an "Installed" tag instead of the button
  for any Available card whose `name` is in the lock (all duplicates get the tag).

### 4.5 Remove semantics (user requirement, restated)

Removing a marketplace:

- Deletes the registry entry + cached snapshot (its plugins vanish from Available).
- **Installed plugins remain**: lock entries, `current`/`versions/`, `data/`, enabled state all
  untouched; update and uninstall keep working via lock provenance.
- Bare cache: deleted only when no installed plugin references that repo.
- Builtin: removable; `seededBuiltin` stays `true` so it never auto-returns. Re-add manually by
  path/URL if wanted.
- Confirm modal copy: "Removes plugin discovery from this marketplace. Installed plugins are not
  affected."

### 4.6 Refresh model

- `addMarketplace` syncs immediately.
- Manual: per-marketplace Refresh button; CLI `worca marketplace refresh [id]` (no id = all).
- Plugins view load: render from cached snapshots instantly, then fire one non-blocking
  refresh-all request; re-render on completion. Failures leave stale snapshots + per-marketplace
  warning ("last sync <relative time>; refresh failed: <reason>").
- No timers/daemons. Sync is on-demand only.

### 4.7 HTTP API — `ui/server.mjs` (routes join the `/api/plugins*` block, 2730-3024)

| Method + path | Behavior |
|---|---|
| `GET /api/marketplaces` | `{marketplaces: [...]}` — entries + snapshots; each snapshot plugin gains `installed: bool` (lock membership) |
| `POST /api/marketplaces {url}` | validate + add + sync → `{ok, marketplace}`; 409 `EXISTS`, 400 bad url |
| `POST /api/marketplaces/:id/refresh` | resync → `{ok, marketplace}`; sync failure → 200 with `warnings` (stale snapshot preserved) |
| `POST /api/marketplaces/refresh` | refresh-all (view-load hook) → `{ok, marketplaces}` |
| `DELETE /api/marketplaces/:id` | remove; 404 unknown id |
| `GET /api/plugins` | unchanged shape + installed entries gain `repo`, `marketplace` name |
| `POST /api/plugins/repo` | **removed** (superseded; UI was the only consumer) |
| `POST /api/plugins/install` | unchanged (body may include `marketplace` id, threaded into the lock entry) |

Id validation mirrors `requirePlugin`'s pattern (slug regex + store membership → 404).
Error mapping reuses `pluginErrorStatus`/`sendPluginError` (`ui/server.mjs:2754-2766`).

### 4.8 Inventory reuse

`discoveryInventory` (git archive → tmpdir → `buildInstallInventory` → delete; **no plugin code
runs**) moves from `ui/server.mjs:2786-2799` into a new small `src/core/plugin-inventory.mjs`
(imports the archive plumbing from `plugin-repo.mjs` and `buildInstallInventory` from
`plugin-store.mjs`; avoids a store↔repo import cycle) so `syncMarketplace` (core) and the
server share one implementation. Server route keeps its behavior via the moved function.

Cost note: sync runs one archive+inventory per plugin per marketplace — acceptable at this
scale (5 bundled plugins; syncs are on-demand). Snapshot caching means view loads cost zero
archives.

### 4.9 UI — one Plugins view, three sections

Markup (`ui/public/index.html`, replacing the current add-row at 742-748), renderers
(`ui/public/plugins-view.mjs`), wiring (`ui/public/app.js`: element cache, `loadPluginsView`,
the single delegated listener at 6442-6512), styles (`ui/public/style.css`).

1. **Installed** — existing cards + one provenance line: `from <marketplace name> · <repo|path>
   @ <sha7>` (repo/marketplace now returned by `GET /api/plugins`). Linked plugins show `linked`
   as today.
2. **Available** — flat card list across all marketplaces (installed ones tagged, not hidden):
   name, description, version-or-sha7, marketplace badge, `Install…` button →
   `renderInstallConsent` fed from the cached snapshot inventory → existing
   `POST /api/plugins/install` flow (+ `marketplace` id in body). Empty state: "No marketplaces
   yet — add one below."
3. **Marketplaces** — one row per entry: name, builtin badge, url/path, `sha7 · synced <rel
   time> · N plugins`, warnings line, `Refresh` and `Remove` buttons (Remove → confirm modal per
   4.5); add-row: text input (`https://…`, `owner/repo`, or local path) + `Add` button with
   inline error on failure.

New renderers are pure DOM functions (jsdom-testable) following `plugins-view.mjs`
conventions; all new click targets ride the existing delegated listener via `pl-*` classes +
`data-*` attrs.

### 4.10 CLI — `src/cli/worca-cc.mjs`

New namespace + help text:

```
worca marketplace add <url|owner/repo|path>   # add + sync, prints discovered plugins
worca marketplace list                        # name, id, url, sha7, N plugins, builtin/warnings
worca marketplace refresh [id]                # one or all
worca marketplace remove <id> [--yes]         # prints "installed plugins remain"
```

- `worca plugin add <url>` → thin alias of `marketplace add` + deprecation hint (behavior
  change: now persists; acceptable — old behavior was a strict subset).
- `worca plugin install <name>` resolution order: `--repo` flag → lock entry (reinstall/linked
  cases) → **unique** name match across marketplace snapshots (uses its `repoUrl`+`subdir`+
  synced `sha`, stamps `marketplace` id) → multiple matches: list candidates, exit 1 asking for
  `--repo` or `--marketplace <id>` (new flag). Kills the "reinstall requires --repo" wart.
- `worca plugin update` untouched (lock-driven).

### 4.11 Repo restructure (this repo becomes the marketplace)

- `git mv examples/plugins/github-source plugins/github-source` (×5); `examples/` disappears.
- Add root `worca-cc-marketplace.json` (content per 4.1, name "Worca CC Official").
- Test fixes (mechanical path rewrites):
  - `test/github-source-connector.test.mjs:7`, `test/telegram-chat-worker.test.mjs:12-14`,
    `test/slack-chat-worker.test.mjs:8`, `test/discord-chat-worker.test.mjs:8-9`,
    `test/teams-chat-worker.test.mjs:9-11` → `../plugins/…`.
  - `test/chat-lib-drift.test.mjs:13` → `join(…, '..', 'plugins')`; canon assert at `:19`
    unchanged in spirit (telegram-chat must exist). Note the dir now also contains
    `github-source` (no `lib/`) — the test already filters to dirs with `lib/`, keep that.
- Sandbox rename (`examples/` concept dies):
  - `.gitignore:3` `examples/sandbox` → `/sandbox` (anchored — don't ignore nested `sandbox`
    dirs elsewhere)
  - `package.json:22` smoke script `--project examples/sandbox` → `--project sandbox`
  - `README.md:160` same command; `scripts/smoke-workspace.mjs:15` comment.
- Skill `.claude/skills/creating-worca-cc-plugins/SKILL.md`:
  - `:129` example pointer → `plugins/github-source/`
  - add short sections: marketplace manifest reference (4.1) + publishing model ("push a repo
    with worca-cc-plugin.json dirs; optional worca-cc-marketplace.json; users add it via
    `worca marketplace add <url>` / Plugins → Marketplaces → Add")
  - "Before you ship" section: `worca plugin add` → `worca marketplace add`.
- Plugin READMEs:
  - link lines → `worca plugin link plugins/<name>`
  - self-path header comments in `github-source/connector/*.mjs`
  - `github-source/README.md` §Publishing rewritten: this repo is the source of truth **and**
    the default marketplace; drop the maestro-plugins verbatim-copy instructions; fix manifest
    `homepage` if it points at maestro-plugins.
- `chat-connectivity-design.md:22`: "in-repo under `examples/plugins/`" → `plugins/`.
- `docs/superpowers/plans/*` historical references: leave untouched (untracked history).

### 4.12 Edge cases

- **Host not a git checkout** (future npm dist): builtin seed silently skipped; `seededBuiltin`
  left falsy so a later run from a real checkout can still seed. The flag means "a builtin was
  seeded once" and is set only on successful seed (4.2); after that, removal never resurrects it.
- **Local-path marketplace whose path vanished**: sync fails → stale snapshot + warning;
  Remove always works.
- **Same repo as marketplace and direct `--repo` install**: fine — bare cache shared by slug;
  refcount rules already handle deletion.
- **Marketplace manifest present but empty `plugins: []`**: valid; zero Available entries;
  no scan fallback (the manifest is authoritative when valid).
- **Engines-incompatible plugin** (`engines.worca-cc-api` unsatisfiable): already fails closed
  in `normalizeManifest` → lands in `warnings`; marketplace row surfaces it; no Available card.
- **`plugins.lock.json` `marketplace` id pointing at a removed marketplace**: installed card
  falls back to showing raw `repo` provenance.
- **Concurrent syncs**: last-write-wins on the JSON file (same policy as the lock); the UI
  refresh-all endpoint serializes internally (simple `for` loop, not parallel git).

### 4.13 Testing

New unit tests (node --test, existing patterns; UI renderers under jsdom):

- `marketplaces.mjs`: add (URL/`owner/repo`/local path), duplicate → `EXISTS`, remove (+cache
  refcount interplay with an installed plugin), refresh success/failure (stale snapshot kept),
  seed-once semantics incl. removal-no-resurrect, tolerant read of garbage file, atomic write.
- `plugin-repo.mjs`: manifest-based discovery (valid; absent → scan fallback; file-level invalid
  → fallback + warning; bad path entries skipped w/ warnings; duplicate names first-wins;
  depth-2 subdir), `exportVersion` depth-2 `--strip-components` regression, `fetchCandidate`
  depth-2 pathspec.
- Server: marketplace endpoints (fixture-backed local git repos, as existing plugin tests do),
  `GET /api/plugins` provenance fields, removed `/api/plugins/repo` returns 404.
- `plugins-view.mjs`: Available card render (badge, Installed tag, consent from snapshot),
  Marketplaces rows (builtin badge, warnings, buttons), installed provenance line.
- CLI: `worca marketplace *` happy paths + `plugin install` marketplace resolution
  (unique/ambiguous).
- Existing 6 chat/connector test files: path fixes only; `chat-lib-drift` keeps enforcing lib
  identity at the new location.
- Fixtures: one local git repo fixture with `worca-cc-marketplace.json` + 2 plugins (one at
  depth 2), one manifest-less multi-plugin repo (existing `alpha`/`beta` pattern,
  `test/plugin-repo.test.mjs:48-66`).
- Baseline: `npm test` judged modulo the 4 known pre-existing imagegen-skill failures; fresh
  worktrees need `npm ci` first.
- Smoke: `npm run smoke` after the sandbox path change (hand-made `sandbox/` git repo optional,
  as before).

### 4.14 Out of scope / follow-ups (not in this feature)

- Branch/tag selection for discovery (HEAD-only stays; noted gap).
- Auto-update checks or scheduled marketplace syncs.
- Guardrail contributions from plugins (`guardrail_sets.origin` remains unwritten).
- HTTP endpoint for `plugin link` (CLI-only stays).

## 5. Clarifications Q&A

- **Q: How should the built-in marketplace reference the worca-cc repo?**
  A: Local checkout — repo root the host runs from; offline-friendly; HEAD-only discovery;
  `worca plugin link` covers uncommitted dev work.
- **Q: Plugin layout + marketplace declaration?**
  A: `plugins/<name>/` dirs + optional root `worca-cc-marketplace.json`; manifest-less repos
  keep depth 0–1 auto-scan.
- **Q: UI placement?**
  A: Single Plugins view with Installed / Available / Marketplaces sections; transient scan row
  removed.
- **Q: What happens to installed plugins when their marketplace is removed?**
  A (from the original request): they remain installed; discovery alone is removed. Design keeps
  their updates working too, via lock-held provenance.
