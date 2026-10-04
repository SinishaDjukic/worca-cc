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
    plans/      legacy only — runs before the run-folder layout kept plan markdown here
    reviews/    legacy only — runs before the run-folder layout kept review markdown here
    pipelines/  <DD-MM-YY>-<slug>-<id>/              (one folder per run)
      prompt.md          the prompt text (or copied markdown brief)
      diff-patch.patch   the run's captured diff (written when the run completes)
                         Internal, line-anchored review comments on that diff are DB
                         rows (diff_comments), never files; ask_card_comments carries
                         a proposal's comment ids from propose_run through to launch.
                         Archiving a run deletes its comments with its artifacts.
      extras/            any optional extra files you attached
      steps/<node>-c<N>[-<slice>]/                   (one folder per execution)
                         every file that execution produced: its allocated outputs
                         (plan{vsuffix}.md, <kind>-review-cycleN.md, clarify.json,
                         decomposition.json, manual-tests-checklist.md, combine.md),
                         its verdict JSON, its tasks/ folder, and anything else the
                         agent wrote there. Each file is indexed in the artifacts
                         table with its node, cycle and step attribution, which is
                         what the Artifacts tab, the per-node "Artifacts (N)" list
                         and Ask Worca's artifact tools read.
      deck/, shots/, deck-kit/ ...                   (shared working trees)
                         folders an output port sweeps with `extraFiles` (the
                         Presentation workflow's deck, its screenshots, the staged
                         kit) stay at the run root: they are edited in place across
                         fix cycles, so each file keeps one row attributed to the
                         execution that last wrote it.
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
                                        mcp-<messageId>.json, mode 0600 (never a project folder)
  logs/ask-web.jsonl                    Ask Worca web access: one line per web_fetch/web_search
                                        call (redacted URL, status, bytes); rotated to .1 at 5 MB
  runs/<pipelineId>/                    detached run roots: run.json, repos/<projectKey>/ worktrees
  metrics/
    repos/<owner~repo>/                  git worktree of the project repo, detached at origin/worca-metrics
    outbox/<owner~repo>/*.jsonl  .lock   pending run records (durability point) + cross-process lock
    no-hooks/                            empty core.hooksPath for metrics git commands
    ledger/<runId>.json                  per-run team-metrics status for the History header (swept after 180 d)
    pr-cache.json                        Timeline: pull requests per repo#branch asked from gh (merged = final)
    tmp/enable-*                         transient staging for the orphan root commit
  policy/
    repos/<owner~repo>/                  git worktree of the project repo, detached at origin/worca-policy
    locks/<owner~repo>.lock              cross-process lock for enable / follow / publish
  mcp/                                  the MCP registry: servers for worca only, never written to
                                        ~/.claude.json or .mcp.json; every file mode 0600, written
                                        atomically under mcp/.lock; a file with schema > 1 stops the
                                        registry ("MCP registry files need a newer Worca")
    servers.json                         manual definitions, consented team-policy definitions, and
                                         the persisted base name of every server id (never reassigned)
    sets.json                            user sets (General is implicit until first edited), retired set
                                         ids, Team set state per policy home, project assignments
    secrets.json                         set secrets — the only place a registry secret value is stored;
                                         runs and chats get them as spawn env, never in a file
    tests.json                           the last Test per set and server (tools, stale fingerprint)
  plugins/                              installed plugin checkouts
  agents/                               installed agent registry checkouts
  workflows/                            saved workflow templates
  projects.json                         registered project index
  workspaces.json                       workspace index
  chat-context.json                     chat context cache
```

Everything that used to be a per-run control file — `clarify-answers.json`,
`state.json`, `pipeline.md`, plus `meta.json` and the per-project `config.json`
and global `workflows/*.json` — is a **row in `worca-cc.db`** instead. What an
agent writes stays on disk: `prompt.md`, `extras/`, and every file under
`steps/`, each indexed in the database rather than stored in it.

`plans/` and `reviews/` are no longer created. A run that predates the
run-folder layout keeps its markdown there and still opens from the UI — the
read path tries the run folder first and the store root second — but no new file
is ever written to either directory.

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
