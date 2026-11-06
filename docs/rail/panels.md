# Panels, side columns, conversations

| Rule | What | Why | Held by |
|---|---|---|---|
| `panel.over` | A panel opens over any page under its button; it has no page of its own | It never changes where you are | pulse-sweep |
| `panel.side-column` | A side column pushes above 1080px, covers to 761px, takes the window below; one at a time | Same as the app's need, in Rail's motion | worca-sweep |
| `panel.conversation` | A conversation holds the person right, Worca on the page, work as cards on 760px | Readable at any width | by hand |

**A panel** (Pulse, the account menu): opens under its top-bar button over any page, never as a page of its own.
Its head holds Tabs with each count as a caption and ⋯ at the right; the body scrolls and the head stays. On a narrow
screen it is the window's width.

**A side column** (Ask worca, a Feature chat): a column beside the page, opened from its top-bar button. Above 1080px
it pushes the page; from 761 to 1080px it covers the page's right side; at 760px and below it takes the window. Its
width is dragged between 360 and 680px and kept. It opens with Motion's fade, the page narrowing with it, and closes
at once. One side column at a time.

**The Chats column** is a side column on the page's other side, with its own width: beside the conversation on Chat,
by the same three tiers and limits; at 760px and below it takes the window until a chat opens, and the conversation's
list button brings it back.

**A conversation** (Chat, a side column): the person's messages on the right on `--field`, Worca's text on the page,
its work as cards on a 760px text column under the shared card head: a run card, a command group (folded to its head;
a failure opens itself), a graph in its well.
