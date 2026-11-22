# Design in chat: inventory and plan

Owner's ask (2026-11-15): Design becomes a capability of the chat.

1. Design shows with the other panels: the chat's tool panel (issue 1064) gets a **Design** entry that shows the
   design (preview, builds, pictures) beside the chat.
2. The menu's **Design** button stays, but starts a design chat.
3. Every Design ability works from the chat, through the cards, tools and MCP surface the Design chat uses today.

Branch: `claude/design-in-chat-2efdd5` on the tool panel stack (c1b47777b, PR #1299). Schema is v98.

## Today

A design is a `designs` row. Its chat is a normal Ask thread with `mode = 'design'`, linked one-to-one through
`designs.thread_id` (`designIdForThread`). That thread is a *surface* thread (`thread-modes.mjs`): it is in no Chat
list, it gets no title call and no suggestions, and the browser extension is closed to it. It opens only on the Design
page (`#design/<id>`), in the page's own chat dock (`ui/public/design/chat.mjs`) beside the stage
(`ui/public/design/stage.mjs`). The dock has its own renderer. It shares the thread model (`ask-model.mjs`), question
cards and forms with Chat, but none of the transcript code in `ask-panel.mjs`.

### Inventory: what a design can do, and where it lives

| Ability | Model tool or UI route | Where |
|---|---|---|
| Read the design (plan, open build, attachments, paths) | tool `get_design` | `ask/tools.mjs`, `ask/design-deps.mjs` |
| First build | tool `start_design_build` → `designChatActions.apply` → `designBuilds.start`, `design-round` receipt card | `design/chat-actions.mjs` |
| Change (sections, needsLead) | tool `change_design` | same |
| Design questions (picks, or a `fields` form) | tool `design_questions` → `design-questions` card | `ask/turn.mjs` `_onDesignAction`, dock `clarifyCard`/`formCard` |
| Mid-build questions from build agents | WS `design-question` frames, `POST /api/design/:id/builds/:bid/answer` | `design/questions.mjs`, dock `createQuestionState` |
| Sound choice (video) | `design-sound` card, `/api/design/:id/sound[/ask]` | `design/sound-cards.mjs`, `design/sound-card.mjs` |
| Pictures (made by the lead) | `design_pictures` rows, `GET /api/design/:id/pictures[/:pid]`, `design-picture` frames | `design/pictures.mjs` (both sides) |
| Pictures switch, Build fast, Lead/Builders models | `PATCH /api/design/:id {pictures, fast, models}`, `GET /api/design/:id/models`, `/limits` | dock gear: `composer-settings.mjs`, `model-pills.mjs` |
| Plan and Retry of a failed section | `design-plan` frames, `POST /builds/:bid/continue` | `plan-list.mjs` |
| Preview (sandboxed frame, preview tokens) | `POST /api/design/:id/preview-token` | `stage.mjs`, `frame-host.mjs` |
| HUD: Stop, Resume, agents and their cost | `/builds/:bid/stop`, `/agents/:aid/stop`, `/continue` | `hud.mjs`, `agents-panel.mjs` |
| Pins ("point at the page") | stage pick → message payload `design.pins` | `stage.mjs`, dock |
| Hand-off to integration | narration line only (no card) | `narration.mjs` |
| Round receipts | `design-round` cards that follow `design-build` frames | `design/round-receipts.mjs` |
| Back to before this (restore) | `POST /api/design/:id/versions/:n/restore` | dock `roundRow` |
| Export (HTML, zip via fflate, PDF, MP4, copy into project) | `/api/design/:id/export…` | `export-dialog.mjs`, `design/export-routes.mjs` |
| Rename, Delete | `PATCH`, `DELETE /api/design/:id` | `library.mjs` `designMoreMenu` |
| Engine gate (Allow unguarded / Use Claude) | 409 from `POST /api/design` | `engine-gate-dialog.mjs`, `design/engines.mjs` |
| Lockdown on a non-Claude chat engine | `designRoots` → `WORCA_ASK_DESIGN_ROOTS`, the `DESIGN_ALLOW` tool allowlist | `server.mjs` `startAskTurn`, `ask/file-deps.mjs` |
| Thumbnails, Library list | `design-thumb` frames, `GET /api/design` | `library.mjs`, `design/thumb.mjs` |

### Entry points to the Design page

- Sidebar **Design** row (`shell/sidebar.html:42`) with its live count.
- Routes `#design` (Library) and `#design/<id>` (the studio); flag-off deep links fall back to Chat.
- The Library's composer (creates the design, then opens it) and its tiles.
- Activity and Needs you rows (`activity-model.mjs:50`, `href: #design/<id>`).
- Rename/Delete in the studio's More menu; Delete goes back to `#design`.
- No Chat home "More" row, palette entry, shortcut, notification or Statistics link opens Design today.

## The plan

The Design chat moves to the Chat page and stays a design chat: a thread with `mode = 'design'`, on the same engine
gate, design prompt, tool allowlist and lockdown it has today. That keeps the cards, tools and MCP surface as they are.
The page around the chat is what changes.

1. **The Design tool kind** (`ui/public/tool-design.mjs`, registered in app.js like Files and Changes). On a design
   chat the panel opens on the Design tab. It mounts the stage, so the design shows beside the chat: preview, HUD,
   agents, deck rail or film bar, plan, pictures and Export. On any other chat the kind is unavailable ("Only a design
   chat has a design"). The frame fan-out (`pushDesignFrame`) goes to whichever stage is mounted, the page's or the
   panel's.
2. **The design chat opens on the Chat page** (`#chat/<threadId>`). The chat column mounts the design dock
   (`createDesignChat`) in place of the Ask panel's transcript and composer, so every design card, the pins, the gear
   (models, Build fast, Pictures, Sound) and Back to before this work as they do now. The dock's `setPick` and
   `onRestored` reach the panel's stage.
3. **Entry points.** The sidebar's Design row and the Library's New start a design chat: a new design is made with the
   kind and the first message, then `#chat/<threadId>` opens. `#design/<id>`, Activity rows and Library tiles open that
   design's chat. Nothing a person relies on goes away.
4. **Design chats in Chat lists.** They are listed and searchable like other chats, with a Design mark. They stay
   closed to the browser extension and keep their engine.

### What cannot move, and why

- **Design tools in a plain chat** (a chat with runs, MCP servers and skills that also builds a design). Today's
  design tools are kept apart by the design-only allowlist and lockdown on purpose: a design agent's lead can read the
  project and run commands. A plain chat also has no one-to-one design link. Making a plain chat own a design means
  splitting the `design` turn flag from `surfaceLocked`, writing a design section for the normal prompt, carrying the
  design id per thread, and reviewing lockdown on Codex and the other engines. It is a follow-up, not part of this
  change. What a plain chat has instead is a hand-off: `start_design` makes a new design chat on the brief (below).
- **The engine-gate dialog** stays a dialog at create time; there is no chat card for it, because the gate runs before
  a chat exists.

## Owner decisions (2026-11-15)

1. A design stays a design chat (this plan): it opens on the Chat page with the Design tab beside it. A plain chat
   building a design is a later follow-up.
2. The Design page stays as the list of designs (the Library: tiles, thumbnails, its start). Its studio goes; a tile
   opens the design's chat. The sidebar's Design starts a new design chat (`#chat/new/design`).
3. Design chats are listed in Chat and its search with a Design mark, and stay closed to the browser extension.

## Built

- `ui/public/design/studio.mjs`: the design chat's two halves (the dock with its bar, the stage for the Design tab)
  and the new design's start page. `view.mjs` is the Library only; `#design/<id>` opens the design's chat.
- `ui/public/tool-design.mjs`: the Design tab. `tool-panel.mjs` learns `onlyWhenAvailable` and `folderless`.
- `ask-panel.mjs`: a `designChat` host, a design slot and the `design` view; `startDesign()` for `#chat/new/design`.
- Server: design chats join the Chat lists (`CHAT_LISTED_MODES`), the extension lists plain chats only, a thread
  snapshot names its `designId`, and a design's rename renames its chat.
- Docs: `docs/design.md` "In the chat".
- A plain chat's hand-off: `start_design` (on the tab bridge, listed only for a plain chat with the design flag on)
  makes the design through `POST /api/design`'s own path (`registerDesignRoutes` returns `create`), so the engine gate
  binds it, and starts the design chat's first turn on the brief (`askStartDesign` in `ui/server.mjs`).
- One composer: a design chat and a new design send through the chat's own composer (`ask-panel.mjs`
  `setComposerExt`): the dock (`chat.mjs`, `external`) lends its pin chips, Point, the gear and its send; the new
  design's page (`studio.mjs createDesignStartPage`) a Kind pill, the gear and a send that makes the design
  (`library.mjs makeDesign`, shared with the Library's start, the engine gate's dialog included).
