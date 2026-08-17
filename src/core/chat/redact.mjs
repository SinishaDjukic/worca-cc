// src/core/chat/redact.mjs
// Secret scrubbing for every worker-originated string (log frames, status
// details, send errors) BEFORE it reaches the host logger or the UI
// (chat-connectivity-design.md §4.4). Ported from the pre-1.0
// integrations/index.js redactSecrets, extended with generic Bearer/token
// scrubs for the platforms added in 1.0 (Teams AAD tokens, app secrets).
// Workers legitimately hold bot tokens; this is the belt-and-braces layer for
// the strings they emit, not a substitute for not logging secrets.

export function redactSecrets(input) {
  return String(input)
    // Telegram bot tokens (123456:ABC-...) — bare or inside api.telegram.org URLs
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<redacted>')
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{30,}/g, '<redacted>')
    // Slack incoming-webhook URLs + xox* OAuth tokens + xapp app tokens
    .replace(/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g, 'hooks.slack.com/services/<redacted>')
    .replace(/xox[abeprs]-[A-Za-z0-9-]+/g, 'xox<redacted>')
    .replace(/xapp-[A-Za-z0-9-]+/g, 'xapp-<redacted>')
    // Discord webhook URLs + bot tokens (base64ish triplet)
    .replace(/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g, 'discord.com/api/webhooks/<redacted>')
    .replace(/\b[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,}\b/g, '<redacted>')
    // Authorization header values and JWTs (Teams Bot Framework / AAD)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<redacted-jwt>')
    // client_secret=... in URL-encoded bodies (AAD token endpoint)
    .replace(/([?&]|\b)(client_secret|access_token|token)=[^&\s]+/gi, '$1$2=<redacted>');
}
