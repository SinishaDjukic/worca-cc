// The one "is this chat busy?" rule (issue #948 slice 2): a chat that is replying, running a command or following a
// run that is still going cannot be archived. The server's 409 and the Chats column's disabled tooltip both print
// CHAT_BUSY, so the reason reads the same everywhere. Browser-safe: no imports.

export const CHAT_BUSY = Object.freeze({
  replying: "Can't archive while this chat is replying. Wait for the reply or stop it.",
  command: "Can't archive while this chat is running a command. Wait for it to finish or stop it.",
  following: "Can't archive while this chat is following a run that is still going. Wait for the run to finish.",
});

/** 'replying' | 'command' | 'following' | null. `commands` and `tracking` are counts (running commands, live runs). */
export function chatBusyReason({ inFlight = false, commands = 0, tracking = 0 } = {}) {
  if (inFlight) return 'replying';
  if (Number(commands) > 0) return 'command';
  if (Number(tracking) > 0) return 'following';
  return null;
}

/** #948 s3: Archive group's tooltip and its 409, naming the first busy chat of the group. */
export function chatGroupBusyText(title) {
  return `Can't archive while “${title || 'New chat'}” is busy. Wait for it to finish or stop it.`;
}
