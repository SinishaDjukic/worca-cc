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
