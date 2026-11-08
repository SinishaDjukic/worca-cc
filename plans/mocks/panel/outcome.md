# Panel outcome: choice design and New chat

Panel: Dana (power user, 15 tasks/day), Marta (lead, desktop and phone), Sam (first day), and a UX designer.
Rounds: r1 independent → r2 cross-read → r3 in Rail's own parts → r4 users' last fixes → r5 nothing lost → r6 short menus. **All three users pass r6.**

Final mock: `r6-ux.png` (every menu opens with 7 lines or fewer; lengths table in `r6-ux.md`), with `r5-ux.png` for the full states, with `r4-ux.png` for the phone and the Tab order, and `r3-ux.png` for the composer states. Parity table, every function today and where it lives: `r5-ux.md`. Rail mapping: `r3-ux.md`, `r4-ux.md`.

## The design
**Composer**: one line, chosen before you send.
- Quiet SentencePicker variant: values 400 in ink, repo 500, a light ⌄ on each, spacing instead of connector words. A connector stays only where a value alone says nothing (at, starts).
- Each mode has its own sentence:
  - Ask: repo and engine, with the arrow.
  - Task: repo, engine and finish, with Continue.
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

## Last nits after r6 (all pass; none blocking)
- **Select and shortcuts are hard to find** (Marta, Sam). Select is only ⌘ click or long-press, and on a phone long-press clashes with the row's tooltip. Fix: put Select back as the first item of the row's ⋯ (today's prototype has it there with Space), and show "? Keyboard shortcuts" at the foot of the Showing menu.
- **Task button: "Continue" or "Propose"** (Marta and Sam want Propose; Dana is fine with either). This is the owner's call.
- **Engine menu** (Dana): the top search also searches Other engines, and the 3 recent models keep a stable order.

## Rule changes this needs in docs/rail
- `components.md`: SentencePicker quiet variant, ListSentence folded/one-line, BarHead action with label, row reason end, engine picker with Thinks.
- `forms.md`: `form.composer`, per-mode sentences.
- `lists.md`: off-defaults line, reason end.
- `keyboard.md`: app-only ⌘N.
- `narrow.md`: the bar head keeps New chat's word.
- `small-rules.md`: the effort words.
