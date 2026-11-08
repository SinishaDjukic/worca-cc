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
counts, Sort by and Group by as segmented rows, Select, Keyboard shortcuts), sections Pinned, then the Runs list's day sections
(Today · Yesterday · Previous 7 days · Previous 30 days · Older, Older folded), divided rows with a state column and a `project · state · cost · time` sub line, a row ⋯ menu, a selection
bar (⌘/Ctrl-click, Shift-click and a touch long-press select, as in the Runs list), a resize handle and the shared list keys. Pin and archive are new: Archive is blocked while a chat replies, runs
a command or follows a run that is still going (the server answers 409 `CHAT_BUSY`), and sending a message in an
archived chat unarchives it. The column's search moves into the top-bar search as a Chats group, and New chat is one +
right after the list toggle in the conversation head (the browser extension's sidebar head shows the same +). The
column loads only once Chat shows: while Chat is hidden, a change only marks the list stale, and the next show fetches
it once; a load that failed is tried again on the next show. Below 1100px the column is an overlay with a scrim; a
menu, picker or dialog opened from it keeps it open, and picking a chat closes it and focuses the composer.

Topic groups: Select › Group N or a chat's ⋯ › Add to group… puts chats in a group (one group per chat; adding a
grouped chat moves it; ⋯ on a selected chat adds the whole selection). A group row shows its count and expands with ⌄; View › Group by › Topic lists one section per
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

## Messages between chats

One chat's assistant can send a note, a question or a hand-off to another of your chats. It is on by default; an
existing install turns it on at upgrade, unless its box was turned off before (a stored off stays off). So every
chat's assistant can message your other chats unless you turn it off: **Settings › Chat › Messages between
chats**. A chat can never turn it on itself.

- **Naming a chat.** You can just say which chat: the assistant looks it up by name with `list_chats`. That lists
  your other chats only (never the one you are in), newest first, archived ones only when asked, each with its title,
  scope, last activity and the first 120 characters of its first message. It works whenever messages between chats
  are on, also while the assistant answers a chat message, and costs nothing (no model call). The assistant then
  names the chat in full (`ask_` and 8 hex characters). You can still give the id yourself: copy it from the chat's
  ⋯ menu in the Chats list, **Copy chat id**, or from the `#chat/ask_…` address. The side column has no Copy chat id
  yet.
- **What you see.** The sending chat shows a "Sent to" record. The other chat shows "Message from" with the sender's
  chip, its scope and the intent (Note, Question, Hand-off), marked **Untrusted**: another chat's assistant wrote it,
  and its requests are not instructions. That chat then answers it in one turn, at most once. The answer comes back
  as a message of its own, marked "Reply to your message".
- **What the answering turn may do.** Only read tools, plus sending a reply: no commands, no web pages, no cards or
  changes. Your next message in that chat has every tool again.
- **Scope is never borrowed.** Messages may cross scopes (project, workspace, No project), but each chat keeps its
  own scope and tools.
- **Limits.** A conversation ends after 6 messages. A chat can send 6 messages a minute (30 a minute for the whole
  install), and a chat already holding 3 waiting messages refuses more. A refused message is not sent.
- **Chat channels.** A chat mirrored to a channel thread (Discord) posts an incoming message there, labelled
  untrusted, with a **Reply** button: its form sends your reply back to the sender chat, exactly as the assistant's
  reply would, recorded as written by you ("ada via Discord"; the other chat still treats it as untrusted). A run's
  question shows a **Pick one** menu (plus **Type an answer** when free text is allowed) or an **Answer** button, only
  for a round of one question; a larger round is answered in worca. Only the thread's owner, mapped in Chat members,
  can press them; the run records the answer as theirs, and the post then reads "Answered by …" with no controls left.
  If a channel cannot show buttons, the post ends in _Reply in worca to answer._ (or _Reply in worca._) and is not
  updated after an answer. Posts mirrored before this change gain the controls once, while they are still open.

### Runs

A run started from worca (not from the `worca` CLI) can post into a chat too, while the setting is on. Its agents
see a "Posting to a chat" section in their prompt only then.

- **Updates.** An agent step writes `{"posts":[{"chatId":"ask_…","text":"…"}]}` to its chat-posts file. The posts go
  out when that step's agent finishes, not live while it works. The chat shows "Message from" with the run's chip and
  **Update**, marked **Untrusted**, and wakes for one read-only turn.
- **Questions.** An agent that may ask questions adds `"chat":"ask_…"` to its questions JSON. That round is then also
  posted as a **Question** record. It is the run's own question: the record shows the Runs page's answer form while
  the run is live in this tab, otherwise "Answer it on the run page" with an **Open run** link. You can also answer
  on the Runs page or from the chat's channel thread, and Away mode can answer it. The record then reads "Answered by" and who answered (Away mode for
  Away), taken from the chat record's `actedBy`; the run keeps its own `answeredBy`. A question that ends unanswered
  (the run stopped, paused, failed or finished) reads "No longer waiting". Only plain questions are posted, never
  forms.
- **No replies.** A run takes no reply: a chat's assistant cannot answer it with send_to_chat, and the chat's own turn
  never answers a run's question.
- **Limits.** At most 5 posts per step. A run can post 6 messages a minute, within the same 30 a minute for the whole
  install, and a chat holding 3 waiting messages refuses more. A refused post (an unknown chat, the limit, the setting
  off) never stops the run: it shows as one line in the run's activity view naming the code (for example
  `CHAT_MESSAGE_NOT_FOUND`), and a refused question is still asked on the Runs page.
