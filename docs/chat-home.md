# Chat home

The Chat home is the page Chat opens on: the composer, a row of quick actions, and the tabs below
(Needs you, Running, Recent chats, Workflows). A quick action only arms the composer. Nothing is sent
until you send.

The composer is a compact bar of icons, with the engine's mark on the model button (Advanced); the [Chat](chat.md#which-engine-answers)
page lists them. For the small things in the composer and the chats list, see [Chat basics](chat-basics.md). Chat apps (Telegram, Slack, Discord, Teams) can start a chat and a run too: see [Plugins](plugins.md).

A run tile in Needs you or Running opens the chat that follows the run, with the run beside it in a Run tab
(its Workflow tab); **Answer** opens that chat at its question. A run no chat follows opens beside the home.


## Pinned workflows

The quick-action row has seven built-in tiles: **New run**, **Build workflow**, **Schedule a run**,
**Track a run**, **Explain a diff**, **Write a script** and **Add project** ([Projects](projects.md)). A pinned workflow's tile sits
right after **New run**, and **More** ends the row: when the row is too narrow, the last built-ins move into **More** first.

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
- **Shaper is pinned by default.** Someone who never pinned anything gets Shaper
  ([Shape it first](shape-it-first.md)), which is always on. It can be unpinned like any
  other pin, and it stays unpinned.
- **Per person.** Pins are kept for each signed-in person (one list on a local install), in
  `settings.json` under `chatHomePins`, through `GET` / `PUT /api/chat-home/pins`.
- **Deleted or hidden workflows.** A pinned workflow that the workflow list no longer holds (deleted,
  archived, or hidden by its flag) simply doesn't show. Its pin is kept, so it shows again if the
  workflow comes back.

## Chats column

The Chat page's list has the Runs list's anatomy: a head with "Chats" and View ⌄ (Show with
counts, Sort by and Group by as segmented rows, Select, Keyboard shortcuts), sections Pinned, then the Runs list's day sections
(Today · Yesterday · Previous 7 days · Previous 30 days · Older, Older folded), divided rows with a state column and a `project · state · cost · time` sub line, a row ⋯ menu, a selection
bar (⌘/Ctrl-click, Shift-click and a touch long-press select, as in the Runs list), a resize handle and the shared list keys. Pin and archive are new: Archive is blocked while a chat replies, runs
a command or follows a run that is still going (the server answers 409 `CHAT_BUSY`), and sending a message in an
archived chat unarchives it. The column's search moves into the top-bar search as a Chats group, and New chat is one +
right after the list toggle in the conversation head (the browser extension's sidebar head shows the same +). The
column loads only once Chat shows: while Chat is hidden, a change only marks the list stale, and the next show fetches
it once; a load that failed is tried again on the next show. Below 1100px the column is an overlay with a scrim; a
menu, picker or dialog opened from it keeps it open, and picking a chat closes it and focuses the composer. While the
sidebar lights Design (a new design or a chat with a design), the list is headed "Design chats" and holds only chats
with a design (`GET /api/ask/threads?designs=1`, its total and counts too), and its New is "New design": it opens
`#chat/new/design`, the sidebar's Design start, instead of a new chat; see [Design](design.md#in-the-chat).

Topic groups: Select › Group N or a chat's ⋯ › Add to group… puts chats in a group (one group per chat; adding a
grouped chat moves it; ⋯ on a selected chat adds the whole selection). A group row shows its count and expands with ⌄; View › Group by › Topic lists one section per
group, then Ungrouped. Archive group is blocked while a chat in it is busy. With Smart run naming on, the group dialog
suggests a name from the chat titles and first messages on the Run naming model; off, it is a plain name field and
`POST /api/ask/groups/suggest-name` answers 404.

A design starts from any chat, and its chat is in Chat's list, counts and search like any other, with the **Design** mark
before its title ([Design](design.md#in-the-chat)). Workflows chats stay out of Chat's list and out of the browser extension.

## Ask worca beside the page

Every page with the top bar, except Chat, has an **Ask worca** button left of Activity ([Search and Activity](search.md)). It opens the
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
- **Guide.** The docked composer follows the same rule as Chat's: with the Shaper pin set and Guide on, its Guide
  line checks the prompt 2 seconds after you stop typing and shows the same result and size words, such as
  "Clear enough · Small: one run". With no Shaper pin it asks nothing.

## Scope from a pasted link

A chat in **No project** can switch itself when your message holds links to an issue, a pull request
or a work item: GitHub `/issues/N` and `/pull/N`, Azure DevOps pull requests and work items, Bitbucket
pull requests and issues (https links only). Before the reply starts, worca compares each link with
the `origin` remote in every registered project's local git config. It reads no network and runs no
git command, and the remote's address never reaches the chat.

- **One project matches:** the chat switches to it. You see "Switched to <name>", the project button
  follows, and the message runs in that project. Links that match no project are ignored.
- **Two or three projects match** (one repository cloned twice, or links into different projects):
  nothing switches. The model is told which projects matched and may ask you with a scope card.
- **Switching back sticks:** after you switch such a chat back to No project, worca never switches
  it to that project again, as after "Continue without project" on a scope card.
- A project or workspace you picked is never changed, and Workflows chats never switch.
