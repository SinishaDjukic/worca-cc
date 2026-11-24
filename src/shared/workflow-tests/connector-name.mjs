// src/shared/workflow-tests/connector-name.mjs — a connector by its plain name, on every workflow-tests page (the Test a
// version dialog's notes, board 31's Would have sent) and in the server's claude.ai names (connectors.mjs
// plainClaudeAiName). Pure and browser-safe. There is no display name for a registry copy, so this is its copy name made
// readable: "jira" → "Jira", "slack_team" → "Slack team", "claude_ai_Google_Drive" → "Google Drive".

/** "claude.ai Google Drive" / "claude_ai_Google_Drive": the prefix the CLI's claude.ai connectors carry. */
export const CLAUDE_AI_RE = /^claude[ ._]ai[ _]/i;

/** The name without the claude.ai prefix and with spaces for underscores; '' when nothing is left. */
export const plainName = (name) => String(name ?? '').replace(CLAUDE_AI_RE, '').replace(/_/g, ' ').trim();

/** The plain name with a capital first letter; "a connector" when there is no name. */
export function serverName(name) {
  const plain = plainName(name);
  return plain ? `${plain.charAt(0).toUpperCase()}${plain.slice(1)}` : 'a connector';
}
