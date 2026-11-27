# Diff comments

Diff comments are notes you leave on single lines of a run's diff, with replies under them, so a review of what the run
wrote stays next to the code. They live in Worca; nothing is posted to a pull request, and the diff and the run are
never changed. You can also ask Chat about a comment, and Chat can answer inside the thread.

**Where to find it:** open a finished run and go to **Diff** on its record (see [Runs](runs.md#a-runs-record)). A file with open
comments shows a count next to its name in the file list.

## Leave a comment

1. Open **Diff** and pick a file.
2. Hover the line you mean and click the **+** that appears beside it (**Comment on this line**). From the keyboard, Tab
   into the diff, move to the line with ↑ and ↓, then press Tab to reach the **+** and Enter to open it.
3. Type in the **New comment** box (**Leave a note on this line…**). Markdown works. **Preview** shows how it will read;
   **Text** goes back to editing.
4. Click **Comment**. **Cancel** drops the draft. Only one draft is open at a time.

The comment sits under the line, on the side you clicked: the old line for a removed one, the new line for an added or
unchanged one. It names you, shows how long ago it was written, and keeps a copy of the line's text.

A file that holds credentials, such as `.env` files, keys and `secrets` folders, is marked **protected path** and takes
no new comments. Comments already on it still show. A run with no stored diff, such as an archived one, can be read but
not commented on.

If a comment's line can't be drawn any more, it still shows: under its file the card carries the path, the line number
and the line as it was when you wrote the comment.

## Reply in a thread

A comment and its replies form a thread. Click **Reply** on the comment, or on the last reply, and write in the **Your
reply** box (**Reply…**). Click **Reply** to post it. Threads are one level deep: a reply is always to the thread, not to
another reply.

A thread with replies has **Hide replies (2)** and **Show replies (2)** to fold it away. That choice lasts while the
Diff stays open; leaving the run forgets it.

## Resolve, reopen and delete

- **Resolve** marks a thread done and tags it **Resolved**. **Reopen** brings it back. The count on the file only
  includes threads that are still open.
- **Delete** removes a comment, or a reply, for good. Worca asks first, and says how many replies go with a comment. The
  diff and the run stay as they are.

## Ask Chat about a comment

**Ask in Chat** on a comment opens [Chat](chat.md) with a reference to it in the message box, unsent, so several
comments can stack before you send. Chat reads the whole thread, replies included.

Ask it to answer and it replies inside the thread, so the answer sits next to the code. Its replies are marked **Worca**
and carry the Worca mark. Chat can also add a comment on a line, and resolve a thread when you ask it to. It deletes only
its own comments, and it asks you first.

While a diff has open comments, a tray lists them as **N open comments**, with **Send to chat** and, once the run is
done, **Propose fix run** (see [Chat](chat.md#pinpoint)). A thread that was sent shows **sent to #** and the run's
id.

## Related

- [Runs](runs.md): a run's record and its tabs.
- [Chat](chat.md): where **Ask in Chat** goes.
