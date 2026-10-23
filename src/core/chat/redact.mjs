// src/core/chat/redact.mjs
// Secret scrubbing for every worker-originated string (log frames, status
// details, send errors) BEFORE it reaches the host logger or the UI
// (chat-connectivity-design.md §4.4). Ported from the pre-1.0
// integrations/index.js redactSecrets, extended with generic Bearer/token
// scrubs for the platforms added in 1.0 (Teams AAD tokens, app secrets).
// Workers legitimately hold bot tokens; this is the belt-and-braces layer for
// the strings they emit, not a substitute for not logging secrets.

/** Messenger token shapes only this module knows — exported for src/core/secret-scan.mjs (it reports, never redacts). */
export const TELEGRAM_TOKEN_RE = /\b\d{6,}:[A-Za-z0-9_-]{30,}/g;
export const SLACK_APP_TOKEN_RE = /xapp-[A-Za-z0-9-]+/g;
export const DISCORD_BOT_TOKEN_RE = /\b[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,}\b/g;
export const QUERY_TOKEN_RE = /([?&]|\b)(client_secret|access_token|token)=[^&\s]+/gi;
export const CHAT_TOKEN_SHAPES = Object.freeze([
  ['telegram-bot-token', 'a Telegram bot token', TELEGRAM_TOKEN_RE],
  ['slack-app-token', 'a Slack app-level token', SLACK_APP_TOKEN_RE],
  ['discord-bot-token', 'a Discord bot token', DISCORD_BOT_TOKEN_RE],
  ['query-credential', 'a credential in a URL query or form body', QUERY_TOKEN_RE],
]);

export function redactSecrets(input) {
  return String(input)
    // Telegram bot tokens (123456:ABC-...) — bare or inside api.telegram.org URLs
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<redacted>')
    .replace(TELEGRAM_TOKEN_RE, '<redacted>')
    // Slack incoming-webhook URLs + xox* OAuth tokens + xapp app tokens
    .replace(/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g, 'hooks.slack.com/services/<redacted>')
    .replace(/xox[abeprs]-[A-Za-z0-9-]+/g, 'xox<redacted>')
    .replace(SLACK_APP_TOKEN_RE, 'xapp-<redacted>')
    // Discord webhook URLs + bot tokens (base64ish triplet)
    .replace(/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g, 'discord.com/api/webhooks/<redacted>')
    .replace(DISCORD_BOT_TOKEN_RE, '<redacted>')
    // Authorization header values and JWTs (Teams Bot Framework / AAD)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<redacted-jwt>')
    // client_secret=... in URL-encoded bodies (AAD token endpoint)
    .replace(QUERY_TOKEN_RE, '$1$2=<redacted>');
}
