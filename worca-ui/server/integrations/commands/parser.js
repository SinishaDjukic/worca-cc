const MENTION_RE = /^@\S+$/i;

const COMMAND_RE = /^\/([a-z_]+)(?:@\S+)?$/i;

/**
 * Parses a chat message into a command name and argument list.
 * Strips bot @mentions (anywhere in the text) and handles the
 * Telegram /command@botname suffix convention.
 *
 * @param {string} text
 * @returns {{ command: string, args: string[] } | null}
 */
export function parseCommand(text) {
  if (!text || !text.trim()) return null;

  const tokens = text.trim().split(/\s+/);

  const filtered = tokens.filter((t) => !MENTION_RE.test(t));

  if (filtered.length === 0) return null;

  const match = COMMAND_RE.exec(filtered[0]);
  if (!match) return null;

  return {
    command: match[1].toLowerCase(),
    args: filtered.slice(1),
  };
}
