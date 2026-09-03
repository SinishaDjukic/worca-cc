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
  backup-<ts>/                          legacy JSON archived on first upgrade (see below)
  store/<projectKey>/
    plans/      <DD-MM-YY>-<name>.md, -v2.md, ...   (plan markdown + refinements)
    reviews/    <DD-MM-YY>-<name>-impl-review.md     (review markdown)
    pipelines/  <DD-MM-YY>-<slug>-<id>/              (one folder per run)
      prompt.md          the prompt text (or copied markdown brief)
      diff-patch.patch   the run's captured diff (written when the run completes)
      extras/            any optional extra files you attached
                         Internal, line-anchored review comments on that diff are DB
                         rows (diff_comments), never files; ask_card_comments carries
                         a proposal's comment ids from propose_run through to launch.
                         Archiving a run deletes its comments with its artifacts.
  ask/<threadId>/att/<attachmentId>.<ext>  Ask Worca attachment bodies — .txt for text kinds,
                                        the sniffed type's extension for images/PDFs (threads, messages and
                                        run links live in the DB: ask_threads, ask_messages,
                                        ask_attachments, ask_run_links); removed with the thread.
                                        Chat spend is copied per turn into ask_cost_ledger
                                        (append-only, FK-free), so Statistics keeps session
                                        count and cost after deletion
  ask/<threadId>/wt/<worktreeId>/       Ask Worca chat worktrees: read-only DETACHED git
                                        checkouts the assistant opens (registry: ask_worktrees;
                                        removed with the thread, reconciled at boot)
  tmp/ask/                              the Ask Worca assistant's scratch cwd + per-turn
                                        mcp-<messageId>.json (never a project folder)
  runs/<pipelineId>/                    detached run roots: run.json, repos/<projectKey>/ worktrees
  plugins/                              installed plugin checkouts
  agents/                               installed agent registry checkouts
  workflows/                            saved workflow templates
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

## Resolution rules

- **`<worcaHome>`** = `<base>/.worca-cc`, where `<base>` is `WORCA_HOME` if
  set, else the persisted "Worca root folder" from Settings, else your OS
  home. By default this is `~/.worca-cc`, so the DB is
  `~/.worca-cc/worca-cc.db` and the store is `~/.worca-cc/store/`.
- **`<projectKey>`** = `<repo-basename-slug>-<sha1(canonicalRoot)[:8]>`,
  derived from the repository's identity (the parent of its shared `.git`).
  It is **stable across all git worktrees of the same repo**, so every
  worktree shares one history.

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
