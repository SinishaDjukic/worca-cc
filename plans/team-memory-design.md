# Team Memory — Design

Agent memory lives on one machine (`~/.worca-cc/memory/projects/<key>`), so teammates' agents relearn the same traps.
Team memory shares an opted-in project's PROJECT-scope notes across the team through a `worca-memory` branch in the
project's own repo, with a secret gate before anything is pushed. Teammates' agents (runs and Ask chats) load the
team's notes read-only next to their local ones; a local note wins a name clash.

Three layers per project, the more specific winning a name clash: **local** (today's store) > **team** (the
`worca-memory` branch) > **repo** (rules committed in the repo, phase 2). Global memory never leaves the machine.

Phases:
- **1a** (built): the branch (create, fetch, read, write through an outbox with push-with-retry, reusing the
  team-metrics branch machinery in `src/core/metrics/sync.mjs`), the ONE secret detector (`src/core/secret-scan.mjs`),
  every project-note writer queueing its changes, the read-only team mount for runs and Ask, the per-project switch
  and the status API / CLI. Code: `src/core/memory-team.mjs`.
- **1b** (built): the Memory tab's Team view, the switch UI in the Team view and project Settings, seeding existing
  notes, holds, Undo (§4). Code: `src/core/memory-team.mjs` (its seeding section), `ui/public/memory-view.mjs`,
  `ui/public/app.js` (`createTeamMemoryController`).
- **2**: a "Promote memory" workflow that moves confirmed notes into the repo by PR.

Out of scope for 1a: the Memory page UI, seeding, the promote workflow, a workspace memory home, team-policy fields,
defragmenting the team layer.

## 1. Decisions

- **D1 Opt-in controls everything.** Off ⇒ the behaviour before team memory: no fetch, no team notes in runs or chats,
  nothing pushed; switching off drops this machine's queue at once. Switching on shares only new or changed notes: every
  existing note gets a `kept` baseline, written with the switch under the team lock, so a Save without an edit uploads nothing.
- **D2 Team notes live in a `team/` folder of the read-only rules copy only** (`team/<projectKey>/` per workspace member).
  To change one, an agent writes a same-named local note: it shadows the team copy and is shared like any change.
- **D3 An unedited tracked copy follows the team.** A teammate's update replaces it; a teammate's deletion — a commit on
  the branch that removed the note — removes it and leaves a `removed` tombstone. A note merely absent (the branch was
  deleted and started again, its history rewritten) was deleted by no one: it is untracked and kept as a plain local note.
- **D4 Ask participates like runs.** It loads team notes (rules mount + `list_memory` / `read_memory`) and its
  remember/forget changes are shared. A `remember` of a team-only note changes that note: an omitted hook or paths keep
  the team's values and `append` adds under the team's body. The team note is found case-insensitively (D9): a
  `remember` with a case variant of its name writes under the team's spelling, and `read_memory` / `forget` name it.
- **D5 No override of a block.** A blocked note reaches the team only after an edit passes; every change is gated at
  queue time and again at push time. A note the host refuses (secret scanning) is blocked the same way, the rest pushed.
  A refusal that names no note (another host's wording, a pre-receive hook, a size or path rule) is narrowed by halves
  until one upsert is refused on its own while the rest landed; a refusal of every push (branch protection) pins none.
- **D6 The switch is the settings cascade's project layer only:** `memory.team` (boolean, default `false`, no user layer,
  no team-policy key) in `project_config.extra.settings`. `removeProject` clears it, so a re-added project starts off.
- **D7 Separate caps.** The local store keeps `memory.maxFilesPerScope`; `memory.teamMaxFiles` (default 50) caps how many
  team notes a run or chat loads per project, newest `updated` first. Team-only notes never count against the local cap.
- **D8 The branch is created lazily** by the first share (an orphan: `README.md` + `.worca-memory/config.json`
  `{schema:1}`) and started again the same way if deleted. Removals alone never start it. Switching on refuses a project
  with no `origin` (`NO_ORIGIN`), a Folder project (`FOLDER_PROJECT`) and a machine without git (`NO_GIT`): team memory
  fetches and pushes with git only, never over the git-free HTTPS transport.
- **D9 Branch layout:** `.worca-memory/notes/<name>.md`, one memory file per note (`name`, `description`, `paths`,
  `updated`, `author`; never `source`, never this machine's extras). One file per name case-insensitively: last write wins.
- **D10 Tracked-copy marker:** the frontmatter extra `team: <contentHash>`, where `contentHash` covers name, description,
  paths and body only. It is worca's state, never a client's: every store write of client text (the Memory page's PUT, a
  run's sync-back) takes the stored copy's marker (`teamClientText`), and a run's sync compares notes without the marker
  line (`syncHash`).
- **D11 The outbox holds intents, not content** (`outbox/<name>.json`). The flush reads and gates the note as it is then,
  claiming entries by rename, so writers never block and never lose a newer intent.
- **D12 Deletions** are gate-free and reach the team only for a note shared from here (`sharedHash`) or through an explicit
  team delete (API / CLI), which keeps any local copy as a plain local note. A queued team delete is cancelled only by a
  clean edit shared on top of it.
- **D13 No-change rules.** A re-save of an unedited tracked copy, of a `kept` copy, or of an edit that never reached the
  team and was undone is never pushed; on an opted-in project a write never clips a hook it leaves as it is. A Memory-page
  restore changes the team only where it undoes this machine's own push (`pushed`).
- **D14 The gate is specific shapes plus two key/value rules:** the redactors' context-free credential shapes, a
  secret-named variable or config key given a credential-looking literal, emails, private addresses, internal hosts and
  absolute home paths. Placeholders, references and code never trip it; a finding carries rule, label and line, never the value.
- **D15 Defragment runs** mount no team folder and share nothing.
- **D16 Fetch policy:** a run start fetches if the snapshot is older than 5 min (waiting ≤ 15 s, then mounting the last
  snapshot); an Ask turn never waits; the server flushes and refreshes every opted-in project on start and every 30 min.
  A failed fetch counts for the TTL too; an explicit sync always fetches.
- **D17 Identity / credential:** commits use the developer's git identity, network git goes through worca's own write
  credential, hooks off — the team-metrics rules.
- **D18 Local state is files** under `<worcaHome>/team-memory/projects/<key>/` (no DB column, no schema bump), with the
  lock beside that dir at `<worcaHome>/team-memory/locks/<key>.lock`.

## 2. Design

### 2.1 Layers and precedence
`local` (`~/.worca-cc/memory/projects/<key>/`, unchanged) > `team` (snapshot of `origin/worca-memory`) > `repo`
(phase 2). Name comparison for shadowing is case-insensitive (the store refuses case twins). Global scope never takes
part: no code path turns a global note into a team change (`teamChangesFromSync` keeps project dirs only, and
`queueTeamChanges` takes a project key).

### 2.2 The branch
```
worca-memory (orphan, never merged)
├── README.md                       what the branch is; do not merge
├── .worca-memory/config.json       {"schema": 1}
└── .worca-memory/notes/<name>.md   one shared note (memory-file format, no `source`, + `author`)
```
Commit messages: `memory: update a, b; remove c`. Pushes: `HEAD:refs/heads/worca-memory`, `--no-verify`, ≤ 5 attempts
with metrics' jittered backoff on non-fast-forward. One file per note name, case-insensitively: an upsert or a
removal of `deploy` also removes `Deploy.md` (D9).

### 2.3 Local state (`<worcaHome>/team-memory/`)
```
projects/<projectKey>/
  team.json            snapshot of the branch: {schema:1, branch, headSha, fetchedAt, missing, deleted:[names a commit removed]|null, notes:{name:{text,hash,description,paths,updated,author,bytes}}}
  sync.json            {projectDir, lastFetchAt, lastFetchError, lastFetchErrorAt, lastSyncAt, lastError, lastErrorCode, lastErrorAt, hint}
  outbox/<name>.json   an intent {op:'sync'|'delete', force, at, source, teamDelete?} (teamDelete: a team delete rides under the edit)
  inflight/<name>.json intents claimed by the running flush
  status/<name>.json   {state:'pending'|'deleting'|'blocked'|'shared'|'kept'|'removed'|'held', hash, sharedHash, pushed?, kept?, reason, findings, error, at}
                       (held, 1b: a same-name clash skipped while seeding, {state:'held', hash, sharedHash, kept} — `hash`
                       follows the note's content, `kept` its baseline)
                       (removed: a tombstone — a teammate's deletion followed here; no status row shows it; it keeps
                       the note's baseline, `kept`)
                       (pushed: the content this machine last pushed — `pushed === sharedHash` ⇔ the team's version, as
                       last synced, is this machine's own and not a teammate's followed here; a follow writes no `pushed`)
                       (state kept: a plain note's content when it stopped being, or never was, shared — a re-save of it is
                       no change; `kept` on a pending / blocked / deleting record: that baseline (one only: written over a
                       kept record, its `hash`), carried until an edit is shared, and kept in a kept record when the note is
                       deleted here — also once its team delete landed;
                       `kept` on a kept record: also the team version its team delete removed, when the copy then held an
                       edit that never reached the team, or (1b) the opt-in baseline of a held clash deleted, released or
                       put back by Undo, of a tracked copy untracked, or of my spelling of a case variant Take team
                       replaced — either content is no change; `kept` on a shared record (1b, Take team, or a
                       copy adopted as identical to the team's): the opt-in baseline, since neither shares anything — a
                       follow of a teammate's update and an edit that never reached the team, taken out again, carry it)
  seed.json            the last seeding (1b), for its Undo: {schema:1, at, snapshotId, decisions:{name:{action, hash, teamName,
                       teamHash, kept, before, done?}}} (`before`: the note's text before the seeding, null for a skip; `kept`:
                       its opt-in baseline then; `done`: settled by an Undo that failed on another note)
  worktree/            detached worktree of the project repo at origin/worca-memory (metrics' ensure/reset/clean)
locks/<projectKey>.lock   cross-process lock (metrics/lock.mjs) + in-process queue (withQueuedLock)
offers/<projectKey>.json  the one-time seeding offer (1b): {schema:1, state:'done'|'dismissed', at}; absent = pending —
                          beside projects/, so a switch-off keeps it
available/<projectKey>.json  E10: what the add-time check found — {schema:1, branchOnOrigin, checkedAt,
                          state:'pending'|'dismissed'|'accepted'}; beside projects/, so a switch-off and an unregister keep it
```

### 2.4 Write path
```
store write (run sync-back | Ask remember/forget via server sink | REST PUT /DELETE/restore)
  client text (PUT, run sync-back) → teamClientText: the stored copy's marker, never the client's (an unedited synced
                                     version a follow replaced since keeps its own: no change); a run's sync compares
                                     notes WITHOUT the marker line (syncHash), so the marker a push writes under a live
                                     run never blocks that run's later deletion of the note
  → queueTeamChanges(key, names)            off ⇒ no-op · one call at a time per project (team deletes take turns too)
                                            `restore`: forces only an older tracked version over this machine's own push,
                                            never re-marks an untracked copy, removes a copy for the team only over its own
                                            push · `force`: past every no-change rule
      local exists:  unchanged since its sync, or a `kept` copy re-saved ⇒ skip · back to its baseline after an edit
                     that never reached the team ⇒ the queued share goes (a team delete under it comes back) · the
                     content the host refused, re-saved ⇒ skip · gate (noteFindings) hit ⇒ status BLOCKED (+reason;
                     the baseline carried), cancel intent (a team delete stays, or comes back from under the edit) ·
                     clean ⇒ outbox intent + status pending (the baseline carried; over a team delete: carries it,
                     `teamDelete`, until it lands)
      local gone:    team delete queued or under the edit ⇒ delete · team delete in flight ⇒ queued again · shared
                     from here (for a restore: the team's version is this machine's push), or its first share in
                     flight ⇒ intent (delete) · else cancel (a baseline record stays)
  → scheduleTeamFlush(key) (setImmediate, coalesced)
flushTeamMemory(key)  [lock]
  claim outbox→inflight (an unreadable claim goes back) · planOps: re-read + re-gate each note (upsert | delete | drop;
           back to its synced or baseline content ⇒ drop; a note that cannot be read goes back; a `teamDelete` under a
           dropped edit ⇒ delete) · release dropped claims
  pushOps: ensureBranchWorktree → commitToTeamBranch(fetch → reset --hard → clean → apply+stage → commit → push, retry)
           apply: one file per name case-insensitively (case twins removed, deletions first)
           origin has no branch ⇒ removals only: nothing to remove (a `missing` snapshot) · else createTeamBranch
           (orphan) ⇒ retry once
  host refused named notes (secret scanning) ⇒ those BLOCKED, their claims released, the rest pushed again
  host refused, naming no note, a batch of 2+ ⇒ pushed by halves (each landed half finished); one upsert refused alone
           after the other half landed ⇒ BLOCKED (rule `remote`) · both halves refused ⇒ the batch fails as it is
  nothing staged (`git diff --cached --quiet`, never `status`: a checkout of case twins reads as modified) ⇒ no commit
  success: status shared (+ `pushed`) + marker `team: <hash>` (CAS on what planOps read; the note changed meanwhile ⇒ the marker is
           set on it as it is now) — unless an intent was queued meanwhile (its record is kept, and no marker under a
           team delete, which then removes exactly this push) or a newer BLOCKED verdict exists · a note changed during its
           push that a queue call saw (an undone edit) ⇒ re-queued, forced · a TEAM delete's surviving copy ⇒ `kept` · no
           copy left, a baseline ⇒ `kept` (D1) · snapshot from the worktree · reconcileTracked against it (a push follows
           the team too) unless switched off · release
  failure: the pushed claims back to outbox (unless a newer intent exists — it then takes on a `teamDelete` the claim
           carried; by rename where hard links fail)
           · sync.json lastError (+ protection hint)
```

### 2.5 Read path
```
refreshTeamLayer(key)  [lock; TTL 5 min after a fetch OR a failed attempt, re-checked inside the lock; never throws]
  fetch +refs/heads/worca-memory:refs/remotes/origin/worca-memory (never FETCH_HEAD)
  missing branch ⇒ snapshot {missing:true} (deletes nothing locally) · offline ⇒ keep last snapshot
  ok ⇒ worktree reset --hard → read notes (lstat/realpath/size/name guards; case twins in `git ls-files` skipped and
       warned about; at most 2000 notes and 16 MiB in all, warned when hit) + `deleted` (git log --diff-filter=D, minus
       the names at HEAD; after a rewrite only since the fork with the last head seen; none when this checkout does not
       know that head) → team.json · failed ⇒ {error}
  reconcileTracked: per local note — queued ⇒ skip · no marker ⇒ adopt if identical to team (its baseline carried, as by
                    every follow and untrack: its text from before opt-in, written back after a follow, stays local —
                    Compare → Keep mine shares it) · edited ⇒ skip (local wins)
                    in sync ⇒ skip · team changed ⇒ FOLLOW (write team text, source 'team'; the write and a removal
                    are a compare-and-swap on the note as read — `expectHash`, checked after the scope snapshot: an
                    edit another process landed meanwhile is ESTALE and stays; over this machine's
                    per-file cap ⇒ untracked once, kept as a plain local note with a `kept` record)
                    absent + a commit removed it ⇒ remove (a `removed` tombstone) · absent, never removed (branch started again) ⇒ untrack,
                    keep (`kept`) · switched off during the push that wrote the snapshot ⇒ no follow at all
                    tracked, the team holds it, its record dropped (off and on again) ⇒ sharedHash restored first
mountTeamLayer({rules, dirs}) — per opted-in project dir: teamMountNames (snapshot notes − shadowed by a local note
                    or a queued intent − over the local per-file cap, newest teamMaxFiles) → rules/team[/<key>]/
```

### 2.6 Note states (status API, pure `teamNoteStates`)
| state | meaning |
|---|---|
| `pending` | an intent is queued (upsert); `error` = last flush failure code |
| `deleting` | an intent is queued for a removal from the team (also a team delete waiting under a blocked edit) |
| `blocked` | the gate — or the host's secret scanning — refused this exact content; `reason`, `findings[{rule,kind,label,field,line}]` |
| `held` | a same-name clash skipped while seeding: no change of it is shared while the team holds that name |
| `shared` | local copy is tracked and unedited; `behind: true` ⇒ it follows the team on the next refresh |
| `local` | a local note not on the team (never shared, edited while off, untracked after the branch started again, removed from the team by a team delete, or too big to follow — the last three and every note that existed at opt-in carry a `kept` record); `shadows: true` if a team note has its name, case-insensitively |
| `team` | a teammate's note with no local copy; `mounted` says whether it loads (cap) |

### 2.7 Entry points
| writer | process | hook |
|---|---|---|
| run sync-back (`_syncMemoryWith`) | server or CLI | `syncBack({ prepare: teamClientText })`, then `_queueTeamMemory(res, dirs)` |
| Ask remember/forget | MCP child writes; server sees the tool result | `askMemoryMutation` (server sink, now with `name`) |
| Memory page PUT / DELETE | server | the PUT's text through `teamClientText`; queue after the write |
| Memory page restore | server | before/after diff → queue with `restore` (forces only an older tracked version over this machine's own push; never re-marks an untracked copy) |
| team delete (API/CLI) | server / CLI | `deleteTeamNote` |
| switch on (API/CLI) | server / CLI | `switchTeamMemoryOn`: the origin check, then the baseline (`recordExistingNotes`) and the switch write under the team lock (no queue) |
| follow-the-team | any | never queued (it IS the team's version) |

### 2.8 Prompts
Run block: when a run mounts ≥ 1 team note, the ONE intro line of `## Worca memory` gains one sentence naming
`<rules>/team` (read-only; change one by writing a same-named file into the matching Project directory; an Explore or
Plan sub-agent, which loads no rules, reads them there). Dir lines unchanged ⇒ the mock parser and its pins are untouched. Ask rule 13 gains one sentence (team folder, read-only, how to
change/forget); the Codex rewrite keys on rule 13's FIRST sentence only, which is unchanged.

### 2.9 API / CLI (what 1b consumes)
- `PATCH /api/projects/:key/settings {"memory.team": true|null}` — switch (true is refused 400 without origin).
- `GET /api/memory/team/:key` — `teamMemoryStatus`: `{projectKey, enabled, branch, caps:{localMaxFiles,teamMaxFiles},
  canStart?, startError?:{code, message}` (off only: whether the switch would turn on — null when no checkout is known —
  and why not: `NO_GIT`, `FOLDER_PROJECT`, `NO_ORIGIN`; the Team view disables the switch and says why in one line),
  remote:{exists, headSha, fetchedAt, lastSyncAt, lastError, lastErrorCode, lastErrorAt, hint, lastFetchError},
  counts:{<state>:n}, notes:[{name, state, local, team, mounted, updated, author, reason?, findings?, error?, behind?, shadows?}]}`.
- `POST /api/memory/team/:key/sync` — flush + refresh now. `DELETE /api/memory/team/:key/notes/:name` — team delete.
- 1b: `GET /api/memory/team/:key/seed[?name=<note>]` — the seeding preview (`previewTeamSeed`: a fresh fetch, the gate's
  dry run, the team's version of every same-name note); `POST …/seed {decisions:[{name, action:'share'|'take-team'|'skip',
  hash, teamHash}]}` — the seeding (409 `STALE` with `names` when a note changed since the review; 502 `FETCH_FAILED`
  when a share cannot fetch the branch first); `POST …/resolve {name, action:'share'|'take-team', hash, teamHash}` —
  Compare on one clash (the same refusals); `POST …/seed/undo` — Undo of the last
  seeding (404 `ENOSEED` when there is none); `POST …/seed/dismiss` — "Not now" on the offer. The seed preview, these four
  POSTs, `sync`, the team delete and (opted in) the History restore refuse a page not served by this server (403
  `CROSS_ORIGIN`) and a possible agent (403 `TEAM_AGENT_BLOCKED`), as in E8. `teamMemoryStatus` gains
  `seed: {offer:'pending'|'done'|'dismissed', last:{at, snapshotId, shared, tookTeam, held}|null}`.
- E10: `teamMemoryStatus` gains `available: {branchOnOrigin: true|false|null, checkedAt, state, offer}`; `GET /api/projects`
  marks a row `teamMemoryOffer: true` while `offer` holds; `POST /api/memory/team/:key/available/dismiss` is Not now (E8's
  guards). Frames `available`, `available-dismissed` (the server re-sends them as `projects-changed`).
- WS frame `{type:'memory-team-changed', projectKey, action}` (`flushed`, `flush-failed`, `blocked`, `followed`, `discarded`;
  1b: `seeded`, `resolved`, `seed-undone`, `seed-dismissed`).
- CLI `worca memory team status|on|off|sync|rm <name> [--project <path>] [--json]`; 1b adds `resolve <name>
  [--keep-mine | --take-team]`: E7's Compare for one note (no choice: both versions shown, nothing written; a choice: the
  same compare-and-swap as `POST …/resolve`, on versions it fetched just before).

## 3. Phase 1b / phase 2 hooks

- **1b Team tab** = `GET /api/memory/team/:key` rows + `memory-team-changed` frames; the switch = `PATCH …/settings
  {"memory.team"}`; seeding = `queueTeamChanges(key, names, { force: true })` behind a new route (the gate applies).
- **Phase 2 promote:** branch files are already memory files with `paths`; the repo layer enters `teamMountNotes` as a
  third shadowing set (local > team > repo).
- **Workspace memory home:** `team-memory/projects/<key>` leaves room for `team-memory/workspaces/<wk>`.

## 4. Phase 1b decisions

- **E1 Placement and level.** The Team view is a second view of the project Memory tab ("Notes | Team"), hash-first:
  `#projects/<key>/memory/~team` (`~` is outside the note-name class, so the segment is never a note name). Global memory
  (Settings › Memory) gets none: global notes never leave the machine. Level Advanced, like the Memory tab: the switch
  changes what every run loads and must stay reachable for a regular user.
- **E2 States.** 1a's states plus `held`. A tracked copy is "Shared": one state, one label. A `deleting` row reads
  "Removing from the team — your local copy stays" (D12).
- **E3 Seeding flow.** The preview fetches first (offline: the last snapshot, and the dialog says so) and lists every
  `local`, `held` and `blocked` note with the gate's dry-run verdict (nothing recorded) and the team's version of the same
  name, case-insensitively (D9). The checklist holds the notes that pass and the team does not hold, none ticked: an
  existing note is never uploaded unless picked. A clash shows side by side with Keep mine / Take team / Skip, Skip by
  default; Keep mine is off when my version fails the gate, Take team when the team's version is over this machine's
  per-file cap. A note recorded `blocked` (an edit the gate blocked, the host's refusal) is listed with its reason even
  when the team holds its name: it is never a clash to decide. The commit is a compare-and-swap after a fresh fetch:
  every decided note must still have the reviewed hash, the team's version of its name the reviewed hash, and a `local`
  or `held` row — never `blocked`, `pending` or `shared`, which `force` would push past — else 409 `STALE`, nothing
  written. When that fetch fails (offline, a busy lock, a broken worktree), a commit with a share is refused (502
  `FETCH_FAILED`): checked against an old snapshot, the forced share could replace a teammate's version nobody reviewed.
  Only that fetch is checked: a share whose push then fails is retried later with no new check (1a's last write wins).
  Take team and Skip change only this machine and go ahead. Then, under the team lock →
  store lock → queue turn: a scope snapshot (source `seed`); every note Take team replaces read again — the store lock is
  per process, so a write another process landed meanwhile (a CLI run's sync-back, the Ask MCP child) is STALE, never
  overwritten (the snapshot just taken stays in History: the scope as it was, nothing written since); the Undo journal,
  the take-team writes, the holds and ONE forced queue call; after the locks, one flush:
  one commit (a host secret-scan refusal still splits it, D5). The offer becomes `done` (not when a switch-off during
  the apply dropped the shares).
- **E4 Holds.** A skipped clash gets a `held` record. While the team holds a note of that name (case-insensitively; also
  while no snapshot exists — the next fetch decides) no edit of it, mine or an agent's, is queued, until Keep mine (a
  forced share) or Take team. The team's note gone (a teammate deleted it, the branch is gone): a plain local note again,
  under 1a's rules — an edit then is shared and ends the hold. The record stays meanwhile: when a teammate writes a note
  of that name again before this one changed, it is held again (the safe side: nothing of it replaces their note
  unseen; Compare resolves it). A held copy deleted here ends the hold and leaves the team's version, which loads here again: a held
  note never changes the team, by an edit or by a deletion. Its last content and its opt-in baseline stay no change:
  bringing either back (a restore, an Ask remember) uploads nothing. A team delete replaces the hold, as in 1a. Take team
  keeps the opt-in baseline too (for a case variant, my spelling keeps its own): a History restore of the seeding's own
  snapshot uploads nothing — also after 1a changed the tracked copy since: a teammate's update or deletion followed, the
  copy untracked (the branch started again, a team version over this machine's cap), an edit that never reached the team
  taken out again, the copy deleted here and its team delete landed. The baseline holds for any write of that text, not
  only a restore: written back over the team's version (by hand, an Ask remember, a run) it is no change until an edit of
  this machine is shared — the Team view lists it as a local note that shadows the team's, and Compare → Keep mine shares
  it. Limits (closing them needs `kept` as a list): only a `kept` record holds two baselines, and a record written over
  one carries only its `hash`, so a copy untracked and then changed, adopted again or taken from the team by Compare
  loses the opt-in baseline; Remove from team after a Take team makes the team's version the baseline instead (D12), so
  a restore of the seeding's snapshot shares my text — over the team's version while the delete is on its way, as a new
  note once it landed; and a held note edited, then taken from the team (Compare, a later seeding), keeps its opt-in
  baseline but not the held edit, which a restore of that step's snapshot shares.
- **E5 Undo** (the last seeding only). A share it queued that has not landed is cancelled; every note it shared or replaced
  with the team's version gets its pre-seeding text back unless it still has it; every note it held is released. Each note
  put back or released is a plain local note whose content is its baseline, and its opt-in baseline stays one: a
  re-save uploads nothing, a real edit is shared. When the two differ (a held note edited before the Undo), the next
  edit that does not reach the team or a deletion here keeps only the content Undo left (E4's limits). A landed share
  that is unchanged stays a tracked copy. What the seeding pushed stays on the team; nothing is queued. The scope is
  snapshotted first (`…-seed-undo`), and every note is read again right before it is written: one another process
  changed meanwhile is left as it is and reported (`failed`); Undo again puts it back, its edit kept in History. When
  the snapshot fails, no note is written (the holds are already released and the queued shares cancelled). After a
  failure the journal stays with every other note marked done: Undo again retries only the notes that failed, never
  reverts a note it already put back, and the Team view still names the seeding as it was. The journal keeps the
  decided notes' texts, so Undo still works after the 20-snapshot ring has moved on.
- **E6 The offer.** `offers/<key>.json` (`done` | `dismissed`; absent = pending), beside `projects/`, so a switch-off keeps
  it: offered once per project on this machine. The first switch-on from the Team view opens the dialog; the Team view
  shows the offer as a banner until a seeding is finished or "Not now" is pressed, and "Share existing notes…" stays. A
  switch-on from Settings or the CLI shows the banner next time the Team view opens; the CLI prints a one-line hint.
- **E7 Compare.** On a held note, or a local note that shadows a team note, the Team view opens the same side by side for
  one note with Keep mine / Take team. It is not a seeding: no journal, the offer untouched; a Take team snapshots the
  scope first (source `user`, never `team`: a follow prunes `-team` snapshots first). The Team view and its dialog send
  one request at a time: while one runs every control waits. The dialog belongs to its page: it closes with the page, a
  page that has left acts on no new click and opens no dialog (an Undo, Remove or switch-off asked for before it left
  still goes once confirmed), and a dialog closed while its request runs leaves
  `#plugin-modal` — maybe another dialog by then — alone (a refusal, a STALE too, is then a toast).
- **E8 Origin check.** The routes that push notes off the machine or rewrite them (seed, resolve, undo, dismiss, 1a's
  sync and team delete, and the Memory page's History restore while the project is opted in: it pushes, D13), and the
  seed preview GET (it fetches and follows) refuse a browser Origin that is not this server (`terminalSameOrigin`, 403
  `CROSS_ORIGIN`) and a `Sec-Fetch-Site` other than `same-origin` / `none` (an `<img>` sends no Origin): the host guard
  checks the hostname, never the port, and a body-less POST needs no CORS preflight. They also refuse a possible agent
  (`agentMayBeCaller`, 403 `TEAM_AGENT_BLOCKED`), like the Update routes: seeding is the person's consent (E3).
- **E9 Settings row.** "Team memory" in the project Settings "Context and memory" card: a select "Off (default)" / "On",
  saved through the card's PATCH (`true` / `null`); a missing origin shows on the card as "Not saved". Its hint warns
  that switching off drops changes still waiting to be pushed, as the Team view's confirm does.
- **E10 A team already sharing.** Adding a project leaves the switch off and fetches nothing (D1, D6), so someone adding a
  repo whose team shares notes was never told. After every add (Add, Use git, Clone, the bulk and workspace-wizard
  import, a Chat project card, `worca add`) one `git ls-remote --heads origin worca-memory` runs in the background
  through `runGit` (worca's own credential, hooks off, 10 s), skipped where the switch could not turn on (no git, a Folder
  project, no origin). It never blocks or fails the add; an unreachable origin keeps the last verdict. The verdict is
  stored in `available/<key>.json`, beside `offers/`. While the branch is there and the project is off, the project
  Overview shows one line, "Your team shares memory for this repository", with Turn on and Not now, at the Team
  view's level (advanced). It is not a dialog. Turn on is the normal switch (PATCH `memory.team: true`, so D8's checks
  and the fetch at once apply). Not now closes the offer for good on this machine. Any switch-on marks the offer taken,
  so a later switch-off is never asked about again. The Projects list (what Add projects added) and the workspace wizard's
  import list mark such a project "team memory available", the Team view's off text says the branch is on origin, and
  `worca add` prints one hint line. It
  only ever offers: the check never writes `memory.team`, because switching on makes agents load teammates' notes as
  rules.

The answers these rest on:
- **Undo** puts my notes back and pushes nothing; what the seeding shared stays on the team (restoring the pre-seeding
  snapshot would share the seeded notes again, or push my old text over a teammate's).
- **A skipped clash is held**: not shared until I pick Keep mine or Take team (1a would share its next edit, mine or an
  agent's, over the teammate's version).
- **The offer**: once, raised by the first switch-on and kept in the Team view until finished or dismissed; a "Share
  existing notes" button stays.
- **Shared vs tracked copy**: nothing tells them apart — one state, one label.
