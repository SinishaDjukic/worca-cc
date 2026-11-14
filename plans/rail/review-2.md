# Review 2: parity with dev and two user tests (7 Nov 2026)

There were five independent reports: three parity audits of dev's code (chat, tasks, schedules) and two user agents who clicked through
the built prototype. One user is a daily Worca user and the other is a newcomer. The full reports are in the session scratchpad (`review2/`).
This file merges them into one list. A box is ticked once the fix is in and a gate or sweep checks it.

**Scores:** daily user 4.8 / 10, newcomer 5.8 / 10. Only two tasks reached 8: answering a question, and finding Settings.
**Parity:** chat 59 missing and 64 different; tasks 33 missing and 42 different; schedules 78 missing and 39 different.

What is already better than today (keep it):
- Answering a question in the chat.
- The stage view, including "What broke".
- The schedule page's run history.
- Archive and groups with Undo.
- Dark mode and the phone layout.
- The proposal read as one sentence.

## A. Broken: fix now, no decision needed

1. [x] **View PR on the task card pauses the task.** It should open the PR.
2. [x] **The Tasks list and Pulse open the wrong chats.** They match on a case shared by many tasks. Pulse items also start fake chats ("On it.", a spinner that never ends).
3. [x] **Pickers inside a card (When, workflow) open off-screen**, and the sentence breaks into one word per line.
4. [x] **A trigger's own tooltip covers its open menu**: Ask, project, repeat, voice, the account menu, engine and Label.
5. [x] **Menus open far from their trigger**: the card's ⋯ opens by the sidebar, and the group picker opens at the top left. Others are clipped: the list's ⋯ by the sidebar edge, Chat home's More under the top bar.
6. [x] **Typing in the Label menu fires single-key shortcuts** (R renamed a chat). No shortcut may fire while a menu is open.
7. [x] **"Full plan" opens nothing.** The plan can't be read before approving it.
8. [x] **Message order:** your message shows below Worca's reply ("Ask for changes", "Merge it please").
9. [ ] **"Writing the answer" never ends** in seeded chats, and it is clipped on a phone. *(partly: settles after you open it; the phone clipping is not checked yet)*
10. [x] **Titles and branches are cut mid-word** with no ellipsis (proposal, scheduled card, branch).
11. [x] **Counts disagree.** Needs you shows 1 in the sidebar but 3 in Pulse. A failed task and a Shaper chat waiting on questions are missing from the sidebar's Needs you. "Plan asks 2 questions" when one is shown.
12. [x] **Progress disagrees with itself:**
    - "step 1 of 2" sits next to a five-stage bar.
    - A passed Plan is drawn red.
    - "Show its stages" shows another task's plan and "What you asked".
13. [x] **A schedule changed on its page keeps the old time in the bar.** Only four times can be picked.
14. [x] **"Schedule a task" defaults to a one-off "tonight"** while the Schedule mode defaults to "every day". "Here it is, scheduled" is said before anything is scheduled.
15. [x] **The script approval says "runs in the sandbox".** Dev runs it with no sandbox, so this is a wrong claim.
16. [x] **Two Restart Build buttons**, and the tooltip says "Opens the task" although it restarts in place.
17. [ ] **A finished card's ⋯ opens inline at full width**, pushing the card down. *(partly: not checked yet)*
18. [x] **Reset view** says "by state" while the default is by date.
19. [ ] **Words:** *(partly: run → task done; `{folder}` is a real command template, kept)*
    - "run" in Pulse, search and Settings (should be "task").
    - Settings shows a raw `{folder}`.
    - One task has two names in different places (seed data).
    - "Here is what I found. Tell me if you want it built." answers every question.
20. [ ] **Things that need a tooltip or label:** the "?" and PR marks, the theme and background buttons, the Pulse button (its accessible name is "3"), Shaper, and the 17% meter. *(partly: Pulse named, Shaper and theme buttons say what they are; the ? and PR marks not checked yet)*
21. [x] **Pulse's tooltip covers its own Updates tab, and toasts cover the composer's controls.**

## B. Missing compared with dev: daily work (do in this pass)

1. [ ] **Merge:** *(partly: Merge PR on an approved card, failing checks named; Approve on a waiting review not yet)*
    - Merge PR on the card when checks pass.
    - The failing checks listed by name.
    - Watching shown on the card.
    - Approve when the review step waits on you.
2. [x] **Pause and Stop on a live task's card**: dev's chat card has both.
3. [x] **Task-wide actions in the card's ⋯:** Archive, Restore, Report, Save as preset, Run after, Labels, Terminal, Start a follow-up. Today these appear only inside "Show its stages", and the two ⋯ menus differ ("Add to group" vs "Move to group").
4. [x] **Ask for changes and follow-up on a finished card**, tied to the task, its branch and its PR. Today it becomes an unrelated new task.
5. [x] **Why a task failed, on the card face** (one line), not two clicks deep.
6. [ ] **Schedules:** *(partly: any time, every repeat, Pause, Skip, Delete, Run now on the card; Start now as the proposal's alternative not yet)*
    - Every day, monthly and custom repeats; any time.
    - Pause, Resume, Skip next, Delete.
    - Next runs shown.
    - Run now and Delete on the chat's schedule card.
    - Start now as the alternative on the proposal.
7. [x] **Creating a new label** from the Label menu.
8. [x] **A "while you were away" summary** when Away ends.
9. [x] **Engine, then model**, picked separately (Codex has its own models).
10. [x] **Sync log** (the one task-page gap Rail still lacks; Run after and Copy branch name are already there).

## C. Missing compared with dev: rarer, needs a decision on scope

- **Shaper:** route card, requirements step, requirements-first proposal, direction chip (send to a live run).
- **Questions:** form widgets (text, slider, rank, table-select) and arrow keys.
- **Workflow proposal at full parity:** rounds, name edit, model per node, loops, Save & propose.
- **Settings proposals with no card yet:** Metrics or Policy, Proxy, Clone, Actions. Also Sets · N (MCP servers and skills per chat).
- **Dialogs that became one-line confirms:** Create PR (Ship-it), Raise the cap, Resume at…, Switch model…, Report.
- **The full schedule dialog:** time zone, end date or run count, overlap, failure and missed-start policies, After a run with its options.
- **Task page depth:** base-branch conflicts before a PR, refused-resume questions, the Archive block, Sync before run, per-repository rows for a workspace PR, the Actions tab, the diff comment thread, the live graph, the full Report dialog, Sessions and telemetry.
- **Answers:** pinpoint (Copy, Explain, Alternatives, Disagree, Quote), ref chips, the error with Sign in….
- **Ask worca's side column:** its home and page chips. **Chat home:** Plans tab, run tiles, the "More you can do" promos.

## Checklist ticks that did not hold

`chat-cards.md` ticked these items, but the code doesn't back them up:
- Route.
- Add project (New, Folder, Clone).
- Explain a diff's picker.
- Track a run filling the composer.
- The script sandbox note.
- Cost and elapsed time on the task card.
- Ask for changes inline on the task card.
- All three schedule cards.

These ticks are undone. `@ mentions` is new in Rail, not parity.
