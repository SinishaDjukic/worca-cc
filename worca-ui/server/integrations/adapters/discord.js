/**
 * Discord adapter — outbound only, REST POST /channels/{id}/messages (markdown).
 * @module adapters/discord
 */

const DISCORD_API = 'https://discord.com/api/v10';
const SEND_BACKOFF_DELAYS = [1000, 5000, 30000];

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

/**
 * Render a NormalizedMessage to Discord markdown.
 * @param {import('../adapter.js').NormalizedMessage} msg
 * @returns {string}
 */
export function renderToMarkdown(msg) {
  const parts = [];
  if (msg.title) {
    parts.push(`**${msg.title}**\n`);
  }
  for (const seg of msg.body) {
    switch (seg.kind) {
      case 'bold':
        parts.push(`**${seg.value}**`);
        break;
      case 'code':
        parts.push(`\`${seg.value}\``);
        break;
      case 'code_block':
        parts.push(`\`\`\`\n${seg.value}\n\`\`\``);
        break;
      case 'link':
        parts.push(`[${seg.value}](${seg.href ?? ''})`);
        break;
      default: // 'text'
        parts.push(seg.value);
    }
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   botToken: string,
 *   channelId?: string,
 *   fetchFn?: typeof fetch,
 *   _sleep?: (ms: number) => Promise<void>
 * }} options
 * @returns {import('../adapter.js').ChatAdapter}
 */
export function createDiscordAdapter({
  botToken,
  channelId: _defaultChannelId,
  fetchFn = globalThis.fetch,
  _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const authHeader = botToken.startsWith('Bot ') ? botToken : `Bot ${botToken}`;

  return {
    name: 'discord',
    supportsInbound: false,

    async start() {},

    async send(chatId, msg) {
      const content = renderToMarkdown(msg);
      const url = `${DISCORD_API}/channels/${chatId}/messages`;
      const body = JSON.stringify({ content });
      const headers = {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      };

      for (let attempt = 0; attempt <= SEND_BACKOFF_DELAYS.length; attempt++) {
        const res = await fetchFn(url, { method: 'POST', headers, body });
        if (res.status !== 429) {
          if (!res.ok)
            console.warn(`[discord] send failed: HTTP ${res.status}`);
          return;
        }
        if (attempt === SEND_BACKOFF_DELAYS.length) {
          console.warn('[discord] send dropped after retries (429)');
          return;
        }
        const data = await res.json().catch(() => ({}));
        const ms =
          (data.retry_after ?? 0) * 1000 || SEND_BACKOFF_DELAYS[attempt];
        await _sleep(ms);
      }
    },

    onInbound(_cb) {},
  };
}
