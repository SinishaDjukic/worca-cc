# Panel r6 · UX: every menu opens short

Mock: `r6-ux.png` (from `r6-ux.html`, rendered with `r2-ux-shot.mjs`). It shows every menu open at its first level, with its line count. Rule: each word opens its own CompactMenu of **7 lines or fewer**; separators and headers count as lines. What you pick often comes first. The rest is one › step away (as Sort already is), a find field away, or a key Rail already has.

## Menu lengths: r5 → r6

| Menu | r5 | r6 | First level in r6 |
|---|---|---|---|
| List: *Showing all ⌄* | 21 | **7** | All chats, Needs you, Running, Archived · From a project ›, Group and sort › |
| List: project word (*billing-api ⌄*) | inside the 21 | **6** | find, All projects, the 4 most used; the rest by typing |
| Group and sort › | inside the 21 | **7** | by date, state, project, topic, AI topics · Sort: Recent › |
| Sort › | 4 | 4 | Recent, Created, A to Z, Cost |
| Chat row ⋯ | up to 9 | **7** | In view, Pin, Rename, Add to group, Archive · Delete |
| Task row ⋯ | 5 | 5 | Open task, In view, Watch, Label, Archive |
| Mode (*Task ⌄*) | 3 | 3 | Ask, Task, Schedule, each described |
| Repo | 5 | **6** | find, the 5 most used; the rest by typing |
| Engine | 15 | **7** | find, 3 recent models (any family) · Thinks: thorough ›, Other engines › |
| Thinks › | (in the 15) | 4 | quick, standard, thorough, deepest |
| Other engines › | (in the 15) | 5 | find, then models with their family as the hint |
| Finish (*opens a PR ⌄*) | 4 | 5 | open a PR, leave a branch, push to the source · Reset to default |
| + | 9 | **7** | Files, Markdown, A ticket, Reuse last task, Shape it first · Preset › |
| Preset › | (in the 9) | 3 | No preset, Hotfix, Docs only |
| Schedule *every* (REPEATS) | 10 | **7** | 5 most used · Other days › |
| Schedule *at* (TIMES_OF_DAY) | 48 | **4** | find ("14", "14:30"), 02:00, 09:00, 17:00 |
| Proposal *when* | 9 | **6** | now, tonight at 02:00 · At a time ›, Repeating ›, After a task › |
| Proposal ⋯ | 1 | 1 | Edit in the composer |

## Changes

- **The list's one big menu is gone.** At rest the line is one SentencePicker word, *Showing all ⌄*, and its menu is that word's own. From and grouping are each one › step away. Once set, they come back as their own words on the line (*billing-api ⌄*, *by project ⌄*), and each opens only its own short menu. ✕ resets everything that differs.
- **Select and Keyboard shortcuts move to Rail's keys.** Select is ⌘ click, or long-press on touch (`narrow.md`). Keyboard shortcuts is `?`, which opens the sheet (`keys.sheet`), and that sheet lists Select. Reset view lives on as the ✕.
- **The engine menu shows what you use.** The first level lists 3 recent models from any family, then *Thinks ›* and *Other engines ›*.
  - Enter on a model keeps its Thinks and closes the menu.
  - Typing a level (*quick*, or the CLI's *high*) shows the Thinks choice directly.
  - Codex uses the same words (*Codex, thorough*). A family with an extra level names it in the same style, with the CLI's name in the tooltip.
- **Long lists get a find field:** projects, other engines and times of day. The most used items come first.
- **Phone:** with no menu longer than 7 lines, nothing scrolls at 375px, and Showing is always on top.
- **Task button:** stays *Continue* until the owner decides. The options are *Continue* (today's word), *Propose* (it names what happens next, per `form.composer`), *Review*, or *Start*. *Start* would be misleading, because nothing starts until the proposal's own Start.

## Parity rows that moved

| Function | r5 | r6 |
|---|---|---|
| From a project | big menu, From section | *From a project ›*; once set, its own word with find |
| by date / state / project / topic / AI topics | big menu, By section | *Group and sort ›*; once set, *by … ⌄* on the line |
| Sort | big menu › | *Group and sort › Sort ›*; once set, its own word |
| Select | big menu | ⌘ click, or long-press; listed in the `?` sheet |
| Keyboard shortcuts | big menu | `?` (Rail's key for it) |
| Reset view | big menu + ✕ | ✕ on the line, shown whenever anything differs |
| Other engine families and their models | headers in the engine menu | *Other engines ›* with find |
| Effort | Thinks section | *Thinks ›*, or type a level |
| Preset | + menu section | *+ › Preset ›* |
| Rarer repeats (Tue–Fri, monthly) | the full list | *Other days ›* |
| Times of day | 48 items | find field |
| When: at a time, repeating, after a task | flat list | one › step each |

Every other row of r5's parity table is unchanged. Nothing is lost.
