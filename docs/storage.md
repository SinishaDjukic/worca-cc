# Where Worca keeps its state

Worca keeps **structured state** (projects, workspaces, workflows, per-project
config, run state + steps + audit events, clarify Q&A, review verdicts) in a
single **SQLite database**, and the agents' **markdown** outputs (+ any
attachments) in a machine-wide **external store**. Neither lives in your
project's working tree, so nothing is ever committed to your repo.

## Layout

```
<worcaHome>/                            default ~/.worca-cc
  settings.json                         { root } only — the bootstrap that locates the DB
  worca-cc.db  (+ -wal, -shm)           ALL structured state (SQLite, WAL mode)
                                        (the Requirements Feature chat: req_helper_messages (v78), one row per
                                        message, kept until Clear chat; its spend is in req_cost_ledger with
                                        helper_message_id, which Clear chat keeps)
                                        Requirements export (v80): req_export_setups (one row per project or
                                        workspace: the connection — plugin, source, profile, never a token —, the
                                        tracker project, issue type, labels, priority, where criteria go, the done
                                        status) and req_export_links (one row per feature: its current ticket, the
                                        spec and fields as last sent, the tracker's fingerprint of the description,
                                        a pending create's marker). Every export is also an `export` turn.
  backup-<ts>/                          legacy JSON archived on first upgrade (see below)
  store/no-project-00000000/            runs without a project: one store, the History group "No project";
                                        a run's work/ moves into its pipeline folder as work/ when it ends
  store/<projectKey>/
    plans/      <DD-MM-YY>-<name>.md, -v2.md, ...   (plan markdown + refinements)
    reviews/    <DD-MM-YY>-<name>-impl-review.md     (review markdown)
    pipelines/  <DD-MM-YY>-<slug>-<id>/              (one folder per run)
      prompt.md          the prompt text (or copied markdown brief)
      diff-patch.patch   the run's captured diff (written when the run completes)
      folder-manifest.json
                         a Folder run: path → sha1, size, mtime of the copy at run start
      changes.json, changes.patch
                         a Folder run's added / modified / deleted files, their state (pending /
                         applied / discarded) and their diff (built without git)
      members/<projectKey>/
                         a workspace run's Folder member: folder-manifest.json, changes.json,
                         changes.patch, skipped/ (its own Changes; Apply to folder / Discard per member)
      skipped/           the run's version of files Apply to folder skipped
      skills/            the run's set skills (docs/skills.md): one generated plugin per set, passed
                         with --plugin-dir; rebuilt on resume, never inside a checkout
      extras/            any optional extra files you attached (a Requirements start's switched-on files too)
                         Internal, line-anchored review comments on that diff are DB
                         rows (diff_comments), never files; ask_card_comments carries
                         a proposal's comment ids from propose_run through to launch.
                         Archiving a run deletes its comments with its artifacts.
                         The pipelines row itself is only soft-deleted (`archived_at`):
                         the run stays viewable under Runs › Archived and can be
                         restored there, minus the reclaimed artifacts. A restored run
                         never resumes (its resume point is dropped; a paused one comes
                         back interrupted). Delete (Runs list, Advanced) is permanent:
                         it archives, then anonymises the row in place and stamps
                         `deleted_at` (see "Run groups (v65)" below).
  store/workspaces/<workspaceId>/       a workspace's runs, laid out like a project's store, plus
                                        workspace-graph.json — the last scan's merged cross-project
                                        graph (see workspace-map.md); the map itself and its reviews
                                        are DB columns (workspaces.map_json, map_overrides_json,
                                        description_origin — schema v40)
  scheduled/<id>/extras/                files attached to a scheduled run (or a repeating
                                        schedule), kept until it starts — the OS temp dir does
                                        not survive a reboot. The tickets, schedules and the
                                        activity feed are DB rows: scheduled_runs, schedules,
                                        notifications (see scheduled-runs.md).
                                        (v34: after_kind/after_id/after_policy/
                                        source_from_previous — a run that waits for another run.)
  ask/<threadId>/att/<attachmentId>.<ext>  Chat attachment bodies — .txt for text kinds,
                                        the sniffed type's extension for images/PDFs (threads, messages and
                                        run links live in the DB: ask_threads, ask_messages,
                                        ask_attachments, ask_run_links); removed with the thread.
                                        Chat spend is copied per turn into ask_cost_ledger
                                        (append-only, FK-free), so Statistics keeps session
                                        count and cost after deletion
  ask/<threadId>/wt/<worktreeId>/       chat worktrees: read-only DETACHED git
                                        checkouts the assistant opens (registry: ask_worktrees;
                                        removed with the thread, reconciled at boot)
  ask/<threadId>/skills/<messageId>/    an Ask turn's set skills, one generated plugin per set;
                                        written before the turn's spawn, removed when the turn ends
  requirements/att/<id>.<ext>           Requirements files and brief documents — .txt for text kinds, the real
                                        extension for images and PDF; the name is the store's id (ratt_<12 hex>),
                                        never the file's. Rows: req_attachments (v77). Folder 0700, files 0600.
                                        Removed with the file, or with the brief for its documents; an archived
                                        feature keeps its files. A replace writes <id>.<ext>.tmp-<8 hex> and renames
                                        it over the body; one a crash left, older than an hour, is swept at boot
  tmp/requirements/att-read-<8 hex>/    one file read's folder: a copy of that one file (a text file's copy is its
                                        redacted text), mode 0700 / 0600, removed when the read ends (a restart's
                                        leftovers older than an hour are swept at boot)
  tmp/ask/                              the Chat assistant's scratch cwd + per-turn
                                        mcp-<messageId>.json, mode 0600 (never a project folder)
  logs/ask-web.jsonl                    Chat web access: one line per web_fetch/web_search
                                        call (redacted URL, status, bytes); rotated to .1 at 5 MB
  runs/<pipelineId>/                    detached run roots: run.json, repos/<projectKey>/ worktrees (Git)
                                        or copies (Folder); a Folder run's copy is kept (run.json retain
                                        "folder-apply") until Apply to folder, Discard or Archive, and a
                                        workspace run's root until each unapplied Folder member is applied
                                        or discarded; a run without a project works in
                                        runs/<pipelineId>/work/ (its cwd, no git)
  metrics/
    repos/<owner~repo>/                  git worktree of the project repo, detached at origin/worca-metrics
    snapshots/<owner~repo>/              without git, or a typed GitHub repository: the branch's README.md and
                                         .worca-metrics/ read over the GitHub API
    snapshots/<owner~repo>@sha           the commit that copy holds
    outbox/<owner~repo>/*.jsonl  .lock   pending run records (durability point) + cross-process lock
    no-hooks/                            empty core.hooksPath for metrics git commands
    ledger/<runId>.json                  per-run team-metrics status for the History header (swept after 180 d)
    pr-cache.json                        Timeline: pull requests per repo#branch asked from gh (merged = final)
    tmp/enable-*                         transient staging for the orphan root commit
  policy/
    repos/<owner~repo>/                  git worktree of the project repo, detached at origin/worca-policy
    locks/<owner~repo>.lock              cross-process lock for enable / follow / publish
  team-memory/                          team memory (phases 1a and 1b; projects/ only for projects with memory.team on)
    projects/<projectKey>/
      team.json                         last fetched snapshot of origin/worca-memory (what runs and chats load)
      sync.json  outbox/  inflight/     fetch/push record; queued intents (never note text); intents being pushed
      status/<name>.json                per-note verdict: pending | deleting | blocked (rule + line, never the value) | shared | kept | held
      seed.json                         the last seeding (phase 1b): decided notes and their texts before it, for Undo
      worktree/                         git worktree of the project repo, detached at origin/worca-memory
    locks/<projectKey>.lock             cross-process lock for flush / refresh / switch-off
    offers/<projectKey>.json            the one-time "share existing notes" offer: done | dismissed (kept by a switch-off)
    available/<projectKey>.json         whether origin had worca-memory when the project was added, and the Overview
                                        line's answer: pending | dismissed | accepted (kept by a switch-off and an unregister)
  memory-usage/                         memory note usage counts (collect-only; local, never shared): hit / read / edit per
    projects/<projectKey>.json          note and day (90 days), last 5 repo-relative trigger paths; global.json for global
    global.json                         notes. Written once per sync-back; a run's hook files sit in
                                        <pipeline>/memory-loads/<execution>.jsonl until then
  mcp/                                  the MCP registry: servers for worca only, never written to
                                        ~/.claude.json or .mcp.json; every file mode 0600, written
                                        atomically under mcp/.lock; a file with schema > 1 stops the
                                        registry ("MCP registry files need a newer Worca")
    servers.json                         manual definitions, consented team-policy definitions, and
                                         the persisted base name of every server id (never reassigned)
    sets.json                            user sets (General is implicit until first edited) with their
                                         servers and their skills (`skills[]`: skill id + switch),
                                         retired set ids, Team set state per policy home (servers and
                                         skills, with consent), project assignments
    secrets.json                         set secrets — the only place a registry secret value is stored;
                                         runs and chats get them as spawn env, never in a file
    tests.json                           the last Test per set and server (tools, stale fingerprint)
  skills/                               the skill library (docs/skills.md): imported skills, never
                                        written to ~/.claude or a repository; written under
                                        skills/.lock (folders 0700, files 0600, exec bits kept)
    library.json                         schema 1: one entry per imported skill — its origin (a folder,
                                         a git URL and ref, ~/.claude/skills; none when pasted), hash,
                                         file and script counts, import and update times
    <name>/                              the skill's own folder (SKILL.md, scripts/, references/…)
  tmp/skills/<stage>/                   an import or update staged for its preview (beside <stage>.json, its
                                        origin); gone on Import, Update, Back or Cancel, an abandoned one
                                        a day later
  plugins/                              installed plugin checkouts
    .cache/<slug>.tree/<sha>/            without git: a GitHub commit's plugin folders and marketplace file
                                         (the newest three and every installed pin kept; <sha>.meta.json beside it)
  agents/                               installed agent registry checkouts
  workflows/                            saved workflow templates
  projects/                             New and Clone from URL projects (the default projects root). Removing a
                                        Folder project (no git) whose folder sits directly in here deletes that
                                        folder too, after a confirm that names it; Git projects, projects added
                                        from elsewhere and a custom projects root are only unregistered
  projects.json                         registered project index
  workspaces.json                       workspace index
  chat-context.json                     chat context cache
```

Everything that used to be a per-run `.json`/`.md` control file —
`clarify.json`, `clarify-answers.json`, `*-review-cycleN.json`, `state.json`,
`pipeline.md`, plus `meta.json` and the per-project `config.json` and global
`workflows/*.json` — is a **row in `worca-cc.db`** instead. Only the
plan/review **markdown**, `prompt.md`, and `extras/` remain on disk (their
existence is indexed in the database).

### Run groups (v65)

The Runs list's groups (runs redesign §3.3) are the one new named state of the runs redesign:

- `run_groups` holds the groups a person creates (`grp_` + 12 hex, a title, the first run's project).
- `run_group_members` holds one row per ad-hoc member: `pipeline_id` is the primary key, so a run is in one group at a
  time. Its `group_id` names either a `run_groups.id` or a Shaper feature (`shape_features.id`); it has no foreign key,
  `src/core/run-groups.mjs` checks it. A feature's own slices are not rows here: they come from `shape_feature_slices`.
  Removing the last member of a user group deletes the group. Shipping a user group as one PR writes a branch named
  after the group (`worca-cc/` + slug + group id) and records the PR on every member's `pr_url`; no new column.
- `run_groups.name_source` (v79) is `'suggested'` or `'user'`, as `ask_chat_groups.name_source`: whether Smart naming
  named the group. Add to group takes several runs; a run already in another user group moves (the group it leaves is
  deleted once empty), and a Shaper slice is skipped. Its Undo is an in-memory one-shot token
  (`src/core/undo-tokens.mjs`, 10 minutes, per actor): it puts each run back, recreating a group the move deleted with
  its id, title and source. Nothing about Undo is stored; a restart drops the tokens.
- `pipelines.deleted_at` marks a run deleted from the Runs list. Delete keeps an anonymised row (title "deleted run",
  no prompt, no starter, no tags, no group) so its cost stays in Statistics; every feed skips it.
- `pipelines.pr_verdict` is the last CI, mergeability, draft and review verdict the PR refresh read for an open GitHub
  PR (JSON). The Runs list's PR chip ("Checks failing", "Conflicts", …) reads it through `readPrState`.
- `run_labels` (v67): one row per (run, label), `added_at` keeps the order on the run; survives archive and restore,
  removed with the run on a hard delete; never read by Statistics or the team metrics record.

## Resolution rules

- **`<worcaHome>`** = `<base>/.worca-cc`, where `<base>` is `WORCA_HOME` if
  set, else the persisted "Worca root folder" from Settings, else your OS
  home. By default this is `~/.worca-cc`, so the DB is
  `~/.worca-cc/worca-cc.db` and the store is `~/.worca-cc/store/`.
- **`<projectKey>`** = `<repo-basename-slug>-<sha1(canonicalRoot)[:8]>`,
  derived from the repository's identity (the parent of its shared `.git`).
  It is **stable across all git worktrees of the same repo**, so every
  worktree shares one history. A plain folder's key is its realpath's;
  projects.vcs ('git' | 'none', schema v69) records the kind at add time.
  It changes at most once afterwards: **Use git** on a Folder project runs
  `git init` in its folder and sets it to 'git' (`markProjectGit`). Nothing
  changes it the other way. The key stays the same, because a folder's
  realpath is also the root of the repository git init makes there. A run without a project uses the
  reserved key `no-project-00000000`; no project row is ever made for it.
- **projects root** = `WORCA_PROJECTS_ROOT` if set, else Settings › Projects root folder, else
  `<worcaHome>/projects` (created on the first New or Clone).

Because state is machine-wide and keyed by repo identity, the web UI has an
**"All projects"** view (and `GET /api/history`) that lists runs across every
project on the machine — backed by indexed SQL queries.

## First-launch migration

The first time you run this version, Worca imports any pre-existing JSON state
**found under `~/.worca-cc`** into `worca-cc.db` (in a single transaction) and
moves the consumed files into a timestamped `~/.worca-cc/backup-<ts>/`
directory (mirroring the old layout); this is one-way — the new version reads
only the database, so to roll back you stop Worca, restore the files from
`backup-<ts>/`, and downgrade.

There is **no** migration from the pre-rebrand home directory that older,
differently-named releases used: this version only ever looks at `~/.worca-cc`,
so if you are upgrading you must move your old state there **by hand before
the first launch** — otherwise Worca simply starts up empty, with no warning.
(Separately, any very old `<projectDir>/ai-artifacts/` directories from before
the external-store change are left in place and ignored.)
