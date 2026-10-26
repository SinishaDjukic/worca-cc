// src/broker/copilot-token.mjs
// The only GitHub token worca relays or brokers Copilot's calls with: a fine-grained personal access token with only the
// Copilot Requests permission. A classic or OAuth token reaches every repository the account can. Pure.
export const FINE_GRAINED_PAT_RE = /^github_pat_[A-Za-z0-9_]{20,}$/;
const tokenKind = (t) => (/^ghp_/.test(t) ? 'a classic token (ghp_)' : /^gho_/.test(t) ? 'an OAuth token (gho_)'
  : /^gh[usr]_/.test(t) ? `a ${t.slice(0, 4)} token` : 'not a fine-grained token');
/** null for a fine-grained PAT, else why not (never the token itself). `name`/`where` name the place it came from. */
export function copilotTokenProblem(token, { name = 'COPILOT_GITHUB_TOKEN', where = "worca signs a sandbox's Copilot calls" } = {}) {
  const t = String(token || '').trim();
  if (FINE_GRAINED_PAT_RE.test(t)) return null;
  return `${name} is ${tokenKind(t)}: ${where} only with a fine-grained personal access token (github_pat_…), never a classic or OAuth token, which reaches every repository your account can. Create a fine-grained token with only the Copilot Requests permission.`;
}

/** What copilot 1.0.100 sends as x-github-api-version (the relay's and the broker's Copilot calls). */
export const COPILOT_CLI_API_VERSION = '2026-08-01';
/** The headers the Copilot CLI sends with a fine-grained PAT (the broker's copilot-pat slot adds them; the relay sends the
 *  same set with its pinned CLI's editor-version). */
export const COPILOT_PAT_HEADERS = Object.freeze({ 'copilot-integration-id': 'copilot-developer-cli', 'editor-version': 'copilot/1.0.100',
  'x-github-api-version': COPILOT_CLI_API_VERSION, 'openai-intent': 'conversation-agent' });
