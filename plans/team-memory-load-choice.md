# Team Memory — Which Memory Loads (draft)

Status: decisions taken 2026-10-24 (Q1 a write-through, Q2 a Local = off); implemented in the same commit as this file. Issue #922 follow-up. Builds on the team memory commit (feat/team-memory-rebase)
and its usage counts; nothing here is implemented yet.

## Problem

With team memory on, a run or chat loads up to `memory.maxFilesPerScope` (50) local project notes in `project/` **and**
up to `memory.teamMaxFiles` (50) team notes in `team/`, with local notes winning on a name clash. Users read that as
"50 local + 50 team" and cannot tell which knowledge an agent saw. They want one simple choice: load **local**,
**team** or **both**.

## Proposal in one paragraph

The Team view's on/off switch becomes one 3-way choice: **Local · Team · Both**. Both is today's "on". Local is today's
"off" (recommended; see Q2). Team loads only what the team shares: this machine's copies of team notes (including an
edit on its way to the team, see Q1) plus teammates' notes, at most `memory.teamMaxFiles` of them in all. Plain local
notes (never shared, blocked, held) stay in the store, untouched, and are not loaded. Global notes always load, in
every mode. No other control is added.

## Modes

| mode | `project/` (both copies) | `team/` (rules copy) | fetch / push |
|---|---|---|---|
| Local | every local note (as off today) | none | none (Q2 option a) |
| Both (default when on) | every local note | team notes not shadowed by a local one, newest `teamMaxFiles` (today) | yes |
| Team | local notes that ARE team notes: state `shared` (tracked copy, in sync or behind) and `pending` (Q1 option a) | the other team notes; a local note that is not loaded never shadows one | yes |

Team mode cap: `teamMaxFiles` applies to the union of `project/` and `team/`, newest `updated` first, so "Team" means at
most 50 notes, not 50 + 50. `maxFilesPerScope` keeps capping store writes as today (hidden notes still count: a new
note can be refused "scope is full" while the agent sees fewer files; the existing message stands).

Why tracked copies go into `project/` and not into `team/`: they are files an agent edits in place in the writable copy,
so the memory block's write instructions, `syncBack` and the usage hook work unchanged. A note in `team/` still has no
writable copy (D2).

## Surfaces

1. **Settings** (`settings.mjs`, `settings-cascade.mjs`). Depends on Q2.
   - Q2 a (recommended): no new key. `memory.team` stays project-only and takes `true | "only"` (`null`/`false` = Local).
     `teamMemoryEnabled` = `true || "only"` (every on/off check keeps working); new `teamMemoryLoad(scope)` →
     `local | both | team`. Old configs need no migration. One key ⇒ one PATCH for the Team view, the project
     settings card, the CLI and Ask's guard.
   - Q2 b: new project-only key `memory.load` (`both` default | `local` | `team`) next to the `memory.team` switch;
     it only matters while the switch is on.
2. **One load plan** (`memory-team.mjs`). `memoryLoadPlan(projectKey)` → `{ load, localNames: Set|null, team:[{name,text}] }`
   (null = every local note). The Team rule is the pure `teamOnlyLoad` over `teamNoteStates` rows and the last snapshot,
   so the mount, the status API's `mounted`, Ask's list/read and the run log share it. `mountTeamLayer` takes the plans
   the local copies were mounted with; `teamMountNames` keeps the Both rule. In Team mode `teamNoteStates` sets
   `mounted` per row: whether THAT row's copy loads (a held local row: no; the team's row of its name: yes).
3. **Run mount** (`run-harness.mjs` `_mountMemoryUnguarded`, `_syncMemoryWith`). `mountMemory` / `refreshMount`
   (`memory-sync.mjs`) take an optional per-dir `only` filter (a Set of names). After `_refreshTeamMemory`, each project
   dir in Team mode gets `only = plan.localNames` for BOTH copies (non-Claude engines and Explore/Plan sub-agents read
   the writable copy's dirs). After a sync, the team queue runs FIRST, then the rules copy is refreshed with a fresh plan
   (a new pending note starts loading, a blocked one stops). The rules copy follows the current mode at every re-mount;
   the writable copy keeps what it was mounted with (its baseline must stay valid), so a mode change mid-run reaches the
   writable copy at the next segment. One info line at mount: `team memory: <label> loads team notes
   only — N local note(s) not loaded`. Defragment runs ignore the mode (they clean the local store; D15 unchanged).
4. **Workspace runs**: the plan is per member key, so members with different modes mix freely (one `project` dir and one
   `team/<key>` folder per member, as today). The global dir is never filtered.
5. **Ask** (`memory-deps.mjs` `refreshAskMemoryMount`; `tools.mjs` list_memory / read_memory). The mount uses the same
   plan per turn. `list_memory` lists only loaded local rows for the project and computes the team rows' `shadowed`
   against them. `read_memory` of a project name whose local note is not loaded reads the team's note of that name,
   else "not found". `remember` / `forget` still write the store; a `remember` over a hidden plain local note replaces
   it (its text goes to History) and is shared — the same rule as an agent's write (D2).
6. **Write path** (D2 unchanged in every mode): agents and Ask write local notes; with sharing on they are queued and
   pushed. Team mode changes loading only.
7. **Prompts**: no wording change. The `## Worca memory` team sentence already appears only when `team/` holds notes
   (Local: none), and "write a same-named file into the Project directory — it replaces the team version for everyone"
   holds in Both and Team. Ask rule 13 unchanged.
8. **Status API / CLI**. `GET /api/memory/team/:key` gains `load`. CLI: `worca memory team on [--team-only]`, `off`
   unchanged, `status` prints the mode. (Q2 b instead: `worca memory team load <both|local|team>`.)
9. **UI**. Team view head: the switch becomes a 3-option segmented control Local · Team · Both, same place, same
   `canStart` gating and refusal line. Local → Team/Both = today's switch-on (seed offer as today). Team/Both → Local =
   today's turn-off confirm. Team ↔ Both = plain PATCH, no dialog. The hint line under it says what the picked mode
   loads. Notes list: a local row that does not load in Team mode reads "not loaded into runs (Team memory loads team
   notes only)" — the same `mounted` hint team rows already have. Project settings card: the "Team memory" select gets
   the same three options. Memory page (the store list): unchanged.
10. **Ask settings tools**: `memory.team` stays out of `change_setting` (it publishes); under Q2 b `memory.load` joins it.
11. **Unchanged on purpose**: house brief (`house-brief.mjs`) and night analysis (`night/analysis.mjs`) keep reading this
    machine's store — they summarise notes, they do not load them for an agent. Usage counts follow the mount by
    themselves. Seeding, Compare, follow-the-team, team delete: unchanged.

## Decisions (owner, 2026-10-24)

- **Q1 Team mode: write-through or load-only?** Decided: a, write-through.
  - a (recommended) write-through: this machine's pending edits and new notes load before their push lands; a blocked
    one does not (it never reaches the team). Agents later in the same run, and the next chat turn, see what was just
    learned, also offline.
  - b load-only: Team loads exactly the last fetched branch. A new note loads only after its push lands and the snapshot
    is refreshed; offline, nothing new loads.
- **Q2 Local: same as today's off, or still sharing?** Decided: a, Local = off (`memory.team: true | "only"`, no new key).
  - a (recommended) Local = off: nothing fetched, loaded or pushed; picking it drops the queue (today's confirm). One
    control, three states, no hidden uploads.
  - b Local = load filter only: edits keep being shared while only local notes load. Needs the on/off switch plus the
    load choice (two controls, four states) and a separate `memory.load` key.

## Tests (`node tools/test.mjs <files>`)

- `memory-team` unit: `memoryLoadPlan` per mode (shared/pending/blocked/held/local/deleting rows, case-insensitive
  shadowing, union cap); `teamNoteStates` `mounted` on local rows.
- `memory-sync` unit: `names` filter in `mountMemory` / `refreshMount` (other files never written, stale ones removed).
- run harness: Team mode mounts filtered `project/` in both copies, re-mount after a sync loads a new pending note,
  workspace with mixed modes, defragment ignores the mode.
- Ask: mount + list_memory / read_memory in Team mode.
- settings: `memory.team: "only"` accepted, other strings refused; Team view 3-way rendering and transitions; CLI flag.
