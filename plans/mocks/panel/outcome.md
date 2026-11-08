# Panel outcome: choice design and New chat

Panel: Dana (power user, 15 tasks/day), Marta (lead, desktop and phone), Sam (first day), and a UX designer.
Rounds: r1 independent → r2 cross-read → r3 in Rail's own parts → r4 users' last fixes → r5 nothing lost → r6 short menus → r7 the 'what will happen' sentence → r8 the sentence is the card's control. **All three users pass r8.**

Final mock: `r8-ux.png` (the proposal card), `r7-ux.png` (the button tooltip and templates), `r6-ux.png` (every menu opens with 7 lines or fewer; lengths table in `r6-ux.md`), with `r5-ux.png` for the full states, with `r4-ux.png` for the phone and the Tab order, and `r3-ux.png` for the composer states. Parity table, every function today and where it lives: `r5-ux.md`. Rail mapping: `r3-ux.md`, `r4-ux.md`.

## The design
**Composer**: one line, chosen before you send.
- Quiet SentencePicker variant: values 400 in ink, repo 500, a light ⌄ on each, spacing instead of connector words. A connector stays only where a value alone says nothing (at, starts).
- Each mode has its own sentence:
  - Ask: repo and engine, with the arrow.
  - Task: repo, engine and finish, with Propose (r7).
  - Schedule: repo, `every day at 02:00`, with Schedule.
- A preset (Hotfix) is an IntentChip with ✕ in the mode word's place.
- The engine is one picker: families as headers (Claude Code, Codex, Gemini CLI), then Thinks, using the plain effort words quick, standard, thorough and deepest. Typing the CLI's name finds the level.
- Workflow and where it starts live in Customise, whose tooltip says so. A change wears the ChangedDot, and so does a value remembered per repo.
- Tab from the text goes repo → engine → finish → Customise.
- Enter shows the TaskProposal at once with Start focused. Its line adds `starts now ⌄`: at a time, tonight, repeating, or after a task. Not now or Esc gives the text back. Customise keeps all of today's rows.

**Chat list**
- BarHead: `Chat ⌄   + New chat   ◫`. New chat keeps its word on a phone. Keys: ⌥⌘N in a browser, ⌘N in the app or PWA, and the tooltip shows only the one that works there.
- At rest: `Showing all ⌄` at the right of the first head. Its menu:
  - Showing: all, needs you, running, archived.
  - From: the projects.
  - By: date, state, project, topic, AI topics.
  - r6: the menu opens with 7 lines (Showing, then From a project › and Group and sort ›). Select is ⌘ click or long-press, Keyboard shortcuts is ?, and Reset view is ✕.
- Off its defaults (filter, grouping or sort): one line of the parts that differ, then the count, then ✕ (Reset view). It persists across reloads.
- A waiting row's end is its reason: "Asks you" or "Needs your OK". Amber ?; red only for Failed.

**New to Rail:** the effort words, and ⌘N as an app-only alias.

## r7: the sentence as what will happen
- A template (no model) builds one plain sentence from the values, one per case (Ask, Task, later, after a task, repeating, Shaper, preset, Schedule). Changed values in ink; the base branch is always said. It ends with what won't happen.
- Shown in the send button's tooltip and as the TaskProposal's reason line. The Task button is now **Propose**.
- r6 nits fixed: Select first in the row ⋯ (Add to group and Delete under More ›), Keyboard shortcuts at the Showing menu foot, the engine find searches all engines, recent models in a stable order.

## r8: the sentence is the card's control
- On the TaskProposal the sentence holds the values as SentencePickers: "Worca will change [billing-api ⌄] with [Opus 5.5, thinking longer ⌄], starting from [the latest dev branch ⌄], [now ⌄], then [open a PR ⌄]. Nothing starts until you press Start." There's no separate value line, so each fact is said once.
- Body size; values in ink 400 (repo 500) with a light ⌄; connectors in ink-3; the closing promise in ink-2. Menu choices use the sentence's own words. A later start ends "Nothing runs before then" and Start becomes Schedule.
- The composer stays one compact line, and its button tooltip is the same template as plain text (500ms delay on keyboard focus). At 375px Start stays visible under the sentence.

## Last nits after r8 (all pass; wording and behaviour, no new round needed)
- "…dev branch, now, then…" stumbles (Sam, Marta): move when forward, e.g. "starting [now ⌄] from [the latest dev branch ⌄]".
- Phone (Marta): the whole value word is the tap target, not only the ⌄.
- Keys (Dana): Shift+Tab from Start walks the pickers backwards; after a pick, focus returns to Start. The repo stays first and bold.
- Sam: keep one clause per value so the sentence doesn't get busy.

## Rule changes this needs in docs/rail
- `components.md`: SentencePicker quiet variant, ListSentence folded/one-line, BarHead action with label, row reason end, engine picker with Thinks.
- `forms.md`: `form.composer`, per-mode sentences.
- `lists.md`: off-defaults line, reason end.
- `keyboard.md`: app-only ⌘N.
- `narrow.md`: the bar head keeps New chat's word.
- `small-rules.md`: the effort words.
