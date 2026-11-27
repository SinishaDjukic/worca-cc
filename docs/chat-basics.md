# Chat basics

The small things in the composer and the chats list that save you a step: sending while a reply runs, reusing a
message, the context ring, the icon on each chat, the copy buttons, and finding the run behind a pull request.

**Where to find it:** the **Chat** page (first sidebar row), and the Ask worca dock beside any page.

## Queue messages while a reply runs

You don't have to wait for Chat to finish. While a reply streams, **Add to queue** (the Send button's name) holds your
next message. Up to 3 messages wait, per chat, and each one sends when the reply before it finishes. If the reply
finishes while you are in another chat, the queue waits for **Resume queue** instead of sending unseen.

- Queued messages appear above the composer, newest on top, with the note "Sends when the reply finishes". Files
  and a quote travel with the message.
- Click a queued message, or its pencil, to edit it in place. The **×** removes it ("Remove queued message 1", with the message's number).
- At 3 the button reads **Queue full** until one sends.
- **Stop**, or a reply that fails, pauses the queue ("Queue paused"). Click **Resume queue** to send the
  next message.

## Press ↑ to reuse a message

Press **↑** in an empty composer to bring back the last message you sent in this chat. Press it again to go further
back, and **↓** to come forward. **Esc** puts your draft back. Edit the text and send it as a new message.

↑ walks the history only from an empty box or when the cursor is at the very start of the text. In the middle of a
long draft it moves the cursor as usual.

## The context ring

The ring at the right of the composer shows how full this chat's context window is. It turns amber as automatic
compaction nears, and red when compaction is soon. Hover it for the figure, such as `120.4k / 1M ctx · 12%`.

Click the ring for the details: **Context window** with the used, **Autocompact buffer** and **Free space**
rows, and how much is left "until auto-compact". Once the context is large, the popover notes that each message
re-sends about that many tokens. On the Chat page, for a chat that has
started, the click opens the Overview in the tool panel with the same Context section.

## The icon on each chat

In the chats list, the column before a chat's title shows what the chat did:

| Icon | Tooltip |
| --- | --- |
| Bubble | Chat |
| Run | Started a run |
| Track | Follows a run |
| Workflow | Proposed a workflow |
| Amber **?** | Run needs you |

A dot pulses while the chat is replying, running a command or following a run. Chat shows one icon, the first that
applies in this order: needs you, started a run, follows a run, proposed a workflow. See the
[Chats column](chat-home.md#chats-column).

## Copy buttons

A copy button sits where text is meant to be taken:

- **Copy code**, in the corner of every code block in an answer.
- **Copy command** and **Copy output** on a command card.

Click one and the icon turns into a tick with "Copied" for a moment. It copies the plain text, never the
highlighting.

## Find the run behind a pull request

Paste a pull request link into the chat and ask which run opened it, for example "Which run made
this PR?" followed by the link. A GitHub, Azure DevOps or Bitbucket link works, and so does `owner/repo#N` or just the
number. Chat looks in the recorded runs and answers with the run.

A fix run that Watch PR started on that pull request is marked as a fix run. It never stands in for the run that
opened the pull request. If you ask from a chat in **No project**, a link to one of your projects also switches the
chat to it ([Scope from a pasted link](chat-home.md#scope-from-a-pasted-link)).

## Related

- [Chat](chat.md): which engine answers, scopes and cards you confirm.
- [Chat home](chat-home.md): the chats column and the page around the composer.
- [Runs](runs.md): the runs Chat finds and follows.
