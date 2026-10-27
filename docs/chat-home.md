# Chat home

The Chat home is the page Chat opens on: the composer, a row of quick actions, and the tabs below
(Needs you, Running, Recent chats, Workflows). A quick action only arms the composer. Nothing is sent
until you send.

## Pinned workflows

The quick-action row has seven built-in tiles: **New run**, **Build workflow**, **Schedule a run**,
**Track a run**, **Explain a diff**, **Write a script** and **Clone a repo**. After them comes one slot
for a pinned workflow, then **More**.

- **Pin any workflow.** In the Workflows Library, open a workflow row's ⋯ menu and pick
  **Pin to Chat home**. On the workflow page, the top bar's **Workflows** menu has the same item (it is
  disabled until the canvas is saved). Pick it again to **Unpin from Chat home**.
- **One pin in the row, the rest in More.** The first pin that can show takes the slot. Every other pin
  is listed in **More** under a **Pinned** header, in the order you pinned them.
- **What a click does.** A pinned tile shows the workflow's name and arms **New run** with that workflow:
  the composer chip shows the workflow's name, and your message asks Chat to propose a run of that
  workflow. Nothing is sent until you send.
- **Unpin from the tile.** Right-click a pinned tile (or focus it and press Shift+F10 or the menu key)
  and pick **Unpin**. The next pin moves into the slot.
- **Shaper is pinned by default.** Someone who never pinned anything gets Shaper, which shows while
  [Shape it first](shape-it-first.md) is on, with its **Beta** badge. It can be unpinned like any
  other pin, and it stays unpinned.
- **Per person.** Pins are kept for each signed-in person (one list on a local install), in
  `settings.json` under `chatHomePins`, through `GET` / `PUT /api/chat-home/pins`.
- **Deleted or hidden workflows.** A pinned workflow that the workflow list no longer holds (deleted,
  archived, or hidden by its flag) simply doesn't show. Its pin is kept, so it shows again if the
  workflow comes back.

## Chats column

The Chat page's list has the Runs list's anatomy: a head with "Chats" and View ⌄ (Show with
counts, Sort by and Group by as segmented rows, Select, Keyboard shortcuts), sections Pinned · Today · Recent (the 10 latest before today) · Older
(folded), divided rows with a state column and a `project · state · cost · time` sub line, a row ⋯ menu, a selection
bar (⌘/Ctrl-click, Shift-click and a touch long-press select, as in the Runs list), a resize handle and the shared list keys. Pin and archive are new: Archive is blocked while a chat replies, runs
a command or follows a run that is still going (the server answers 409 `CHAT_BUSY`), and sending a message in an
archived chat unarchives it. The column's search moves into the top-bar search as a Chats group, and New chat is one +
right after the list toggle in the conversation head (the browser extension's sidebar head shows the same +). The
column loads only once Chat shows: while Chat is hidden, a change only marks the list stale, and the next show fetches
it once; a load that failed is tried again on the next show. Below 1100px the column is an overlay with a scrim; a
menu, picker or dialog opened from it keeps it open, and picking a chat closes it and focuses the composer.

Topic groups: Select › Group N or a chat's ⋯ › Add to group… puts chats in a group (one group per chat; adding a
grouped chat moves it). A group row shows its count and expands with ⌄; View › Group by › Topic lists one section per
group, then Ungrouped. Archive group is blocked while a chat in it is busy. With Smart run naming on, the group dialog
suggests a name from the chat titles and first messages on the Run naming model; off, it is a plain name field and
`POST /api/ask/groups/suggest-name` answers 404.

## Ask worca beside the page

Every page with the top bar, except Chat, has an **Ask worca** button left of Activity. It opens the
same Chat beside the page: the same chats, the same history and the same composer. On a wide window
the page moves over to make room; on a narrower one the chat covers the page until you hide it. A run
or a link you open from the chat there moves the chat aside, so the page shows; the button brings it
back. Workflows has its own chat and no button.

- **What the page gives the chat.** The composer shows the page as chips: a run (and the file open
  in its Diff), a project, a workspace, or the page itself. The **×** on a chip leaves it out of the
  messages you send from this page. It comes back the next time you open the page.
- **Where a message was sent.** A message sent beside a page shows "on Run · Diff" (or the page's
  name) under it, here and in Chat.
- **New chats.** A new chat beside a project, workspace or run page starts in that project or
  workspace. It follows the page until you pick a scope or send. A new chat on the Chat page starts
  in No project.
- **Size and layout.** Drag the column's left edge (or use the arrow keys on it) for 360–560px. Above
  1080px the column pushes the page, and the menu folds to its rail when the page would get too
  narrow. Between 761 and 1080px it covers the page. On a phone it fills the screen under the top bar.
- **Head buttons.** The chat's title opens your chats. **New chat** starts one, **Open in Chat**
  takes this chat to the Chat page, and **Hide chat** closes the column. Open or hidden is
  remembered across pages and reloads. A dot on the **Ask worca** button means a new reply: the
  button opens that chat, as the Chat row does.
