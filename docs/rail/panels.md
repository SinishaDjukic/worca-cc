# Panels, side columns, conversations

| Rule | What | Why | Held by |
|---|---|---|---|
| `panel.over` | A panel opens over any page under its button; it has no page of its own | It never changes where you are | pulse-sweep |
| `panel.side-column` | A side column pushes above 1080px, covers to 761px, takes the window below; one at a time | Same as the app's need, in Rail's motion | worca-sweep |
| `panel.dismiss` | What lies over a page closes on a click or tap outside and on Esc; a click inside never does; focus returns to what opened it | One habit, on every page | worca-sweep |
| `panel.conversation` | A conversation holds the person right, Worca on the page, work as cards on 760px | Readable at any width | by hand |
| `panel.conversation-rail` | What Worca does sits on one rail: a mark, one quiet line, what it took. Thinking is one row (ThinkingRow): Worca's orb (OrbMark, the app's sphere of dots, its W facing you as the sphere turns under it) turning, faster while it writes, and one line saying what it does now in plain words ("Thinking" only until it says) with a slow light passing through it, and its seconds, all updated in place; done, the same row reads "Thought for 8s" with what it did folded under it. Thinking and commands fold; a failure opens itself; Send becomes Stop | A long conversation stays readable | by hand |
| `panel.conversation-cards` | Every card in a conversation is Rail's, in one shape (CardHead: a kicker with its mark and one word, the title, one line, its facts, ⋯ at the head's right; then its body; then one primary action beside quiet ones). A TaskCard's How it ran opens the card in place with its task page's own stage stream, parts and controls; waiting or scheduled it is one line (Start now, Cancel), opened in place on demand; a feature lists its slices; a command running counts its seconds and folds its output when done; a task named in what you said is a chip that leads to its card. a task Worca proposes is a TaskProposal (the running card's shape, the composer's own sentence and Customise, Start beside Not now; Start turns it into the running card in place; open decisions offer Shaper); any other change it proposes (a setting, a workflow, a schedule) is a ChangeProposal, before → after, Apply beside Not now, a receipt with Revert once applied; a one-line offer or warning (a PR to open, a stop that loses work, a project to switch to) is a TurnRow with its actions at its end; a change of ground is a TurnDivider; a question of the chat itself is answered under it, and several take Worca's picks at once; the Shaper's plan is a PlanCard (its version, Reviewed by N roles · M open folding to one row per role, Approve and build), its disagreements and routes are questions, its changes a ChangeProposal, its ship a PR offer; files are a FilesCard (pictures as tiles, files as rows, Download); what you said is a YouTurn, with the quote you answered and the files you attached | One family of cards: a person learns one shape | by hand |
| `panel.task-card` | A task in a conversation is a TaskCard: its page's anatomy, its status line, its one action and ⋯, its stages; never a card of its own making | A card and its page read the same, and neither can drift | design-system-components |
| `panel.timeline` | A long conversation has a thin timeline on its right edge, each tick where its moment is, the band what is on screen; it widens under the pointer; a tick's hover shows what is there, a click goes, `[` and `]` step | You move through it without scrolling to find things | design-system-components |

**A panel** (Pulse, the profile menu): opens under its top-bar button over any page, never as a page of its own.
Its head holds Tabs with each count as a caption and ⋯ at the right; the body scrolls and the head stays. On a narrow
screen it is the window's width.

**A side column** (Ask worca, a Feature chat): a column beside the page, opened from its top-bar button. Above 1080px
it pushes the page; from 761 to 1080px it covers the page's right side; at 760px and below it takes the window. Its
width is dragged between 360 and 680px and kept. It opens with Motion's fade, the page narrowing with it, and closes
at once. One side column at a time.

**The Chats column** (reference for Wave 2; in Wave 2's Shaping it is gone, the Chat list lives in the one bar, `nav.one-bar`) is a side column on the page's other side, with its own width: beside the conversation on Chat,
by the same three tiers and limits; at 760px and below it takes the window until a chat opens, and the conversation's
list button brings it back.

**A conversation** (Chat, a side column): the person's messages on the right on `--field`, Worca's text on the page,
its work as cards on a 760px text column under the shared card head: a run card, a command group (folded to its head;
a failure opens itself), a graph in its well.

**What closes how.** A menu, a picker, a popover, a flyout, a panel (Pulse, the profile menu), search results and an editor
close on a click or tap outside and on Esc. A click closes every open layer it landed outside; Esc closes the top one only. A click inside never closes them. That click does nothing
else, unless it lands on a real control: another menu's button or another top-bar button closes the first and opens the
second, in one click. A Dialog closes on its scrim only when nothing was typed in it; with typed text it stays, since nothing
typed is lost, and Esc follows the same rule. The ConfirmStrip and a side column stay: they are not over the page. The focus
returns to the control that opened it. Every page calls `dismissOnOutside(doc, layer)` (`dismiss.mjs`), one registry per
document, and keeps no outside-click code of its own.
