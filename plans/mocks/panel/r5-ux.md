# Panel r5 · UX: nothing lost

Mock: `r5-ux.png` (from `r5-ux.html`, rendered with `r2-ux-shot.mjs`). It shows the list's menu with By and Archived, two narrowed lines, the proposal with *when*, Ask and Schedule, a preset armed, and the engine menu with families.

Sources checked: `plans/rail/prototype/chat/chats-column.js` (parts, SORTS, tools, can, bulk) and `chat/conversation.js` (sentence, detail/Customise, + menu, composerHtml, proposalHtml).

## Parity table

| Function today | r5 |
|---|---|
| **List head** | |
| Title ⌄ opens the places | same |
| New chat (+) | moved to BarHead's action with its word; ⌥⌘N (⌘N in the app or PWA); the tooltip shows only the key that works there |
| Hide the bar | same |
| Showing: all, needs you, running, archived, each with a count | moved into the *Showing all ⌄* menu, Showing section (Archived restored) |
| from: all projects / each project, with counts | the same menu, From section |
| by: date, state, project, (person), topic, AI topics (`byPart`) | the same menu, **By** section (restored); person when signed in as a team |
| Sort: Recent, Created, A to Z, Cost | the same menu, *Sort: Recent ›* |
| Select (⌘ click) | the same menu |
| Reset view | the same menu (off at the defaults), and ✕ on the line whenever **any** part differs, sort and by included |
| Keyboard shortcuts (?) | the same menu (restored) |
| The view kept across reloads | same (`STORE_V`) |
| **List rows** | |
| Open, fold, keys (↑↓ J K . E R P G ⌫) | same |
| Row ⋯: In view, Open task, Watch, Label, Rename, Pin, Archive, Add to group, Delete | same |
| Selecting: Archive / Restore, Add to group, Delete | same (SelectionBar) |
| State in the tooltip | same; under Needs you the reason is also the row's end: *Asks you* / *Needs your OK* |
| Empty, loading, offline, failed | same (ListState) |
| **Composer** | |
| Mode Ask / Task / Schedule | same picker, items described |
| Ask: project, engine, effort | same, as quiet values |
| Task: project, workflow, engine, effort, from, then | project, engine+effort, then on the line; workflow and from moved to Customise |
| Schedule: project, every …, at … (REPEATS, TIMES_OF_DAY) | same, `every day at 02:00`; button *Schedule* |
| Preset (Hotfix, Docs only), from + › Preset | armed as an IntentChip in the mode word's place, ✕ to clear |
| Engine families (Claude Code / Codex / Gemini CLI) and their models | the engine menu: families as headers, then *Thinks*; Codex has no Thinks, because its model names carry their level |
| + menu: Files, Markdown, Ticket, Reuse last task, Shape it first | same |
| Starters on Chat home (IntentChip) | same |
| @ a task, a chip | same |
| Queue while replying (Edit, remove), Stop | same |
| Context meter | same |
| Voice, hands-free options | same |
| Customise: Title, Labels, New branch, Asks you, Memory, Guardrails, Agents, MCP | same, plus Workflow and Starts from; its tooltip names what it holds |
| Send words: arrow (Ask), *Continue* (Task), *Schedule* | same |
| Start note from Pulse (Use X, Start at) | same |
| **Proposal** | |
| Kicker (Proposed · from ticket / preset) | same |
| Title editable in place, why | same; drawn at once, Worca's title under the shimmer |
| Sentence: project, workflow, engine, effort, **when**, then | quiet values: project, engine+effort, *starts now ⌄*, then; workflow on the line when not Default |
| When: now, at a time, tonight, repeating, after a task | the *starts* picker (restored) |
| Shaper's *reviewed by* perspectives | same, on the line when the workflow is Shaper |
| What the workflow does · starts … | same (the line under the values) |
| Brief and files | same, in Customise |
| Customise: where it runs, source / feature / base branch, run on source, guardrails, labels, memory, asks you, agents (expert: Reset to proposal, Save as project defaults) | same |
| Nudge + split Start (Run as is / Shape it first) | same |
| Start / *Schedule* (later) / *Start planning* (Shaper) | same |
| Not now → *Not now: X · Bring back* | same; Esc as well, putting the text back in the composer |
| ⋯ Edit in the composer | same |

No row is lost: every function is the same as today or has moved to a named place.

## Changes since r4

- **The list menu is complete.** Showing (with Archived), From and **By** with their counts, then Sort, Select, Reset view and Keyboard shortcuts.
- **Reset is always reachable.** Any part off its default brings the one line back, so `Showing all by project ✕` is a valid line. The count sits with the words (Marta).
- **At rest, `Showing all ⌄`** replaces `All chats ⌄`, so it reads as covering the whole list rather than the group (Sam).
- **Each mode draws its own sentence.** Ask has no finish. Schedule reads `every day at 02:00`. A connector word stays only where a value alone says nothing (*at*, *starts*).
- **A preset is an IntentChip in the mode word's place,** as `form.composer` already says for an armed starter. The values it sets carry no ChangedDot.
- **The engine menu has families plus Thinks.** Thinks lists only the levels the chosen family has.
- **The proposal has *starts now ⌄*,** and its Start renames itself for later and Shaper.
- **The Task button is *Continue*,** today's word.
- **Nits:** *Needs your OK* replaces *Waits for your OK* (shorter, so titles keep more). Customise's tooltip says *from the latest dev branch*.

## New to Rail (unchanged from r4)

Two items:
- The effort words.
- ⌘N as an alias inside the app.
