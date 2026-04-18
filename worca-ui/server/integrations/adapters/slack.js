/**
 * Slack adapter — outbound only, POST to incoming webhook URL (mrkdwn).
 * @module adapters/slack
 */

const SEND_BACKOFF_DELAYS = [1000, 5000, 30000];

// ---------------------------------------------------------------------------
// mrkdwn renderer
// ---------------------------------------------------------------------------

/**
 * Render a NormalizedMessage to Slack mrkdwn.
 * @param {import('../adapter.js').NormalizedMessage} msg
 * @returns {string}
 */
export function renderToMrkdwn(msg) {
  const parts = [];
  if (msg.title) {
    parts.push(`*${msg.title}*\n`);
  }
  for (const seg of msg.body) {
    switch (seg.kind) {
      case 'bold':
        parts.push(`*${seg.value}*`);
        break;
      case 'code':
        parts.push(`\`${seg.value}\``);
        break;
      case 'code_block':
        parts.push(`\`\`\`\n${seg.value}\n\`\`\``);
        break;
      case 'link':
        parts.push(`<${seg.href ?? ''}|${seg.value}>`);
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
 *   webhookUrl?: string,
 *   fetchFn?: typeof fetch,
 *   _sleep?: (ms: number) => Promise<void>
 * }} options
 * @returns {import('../adapter.js').ChatAdapter}
 */
export function createSlackAdapter({
  webhookUrl = process.env.SLACK_WEBHOOK_URL,
  fetchFn = globalThis.fetch,
  _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  return {
    name: 'slack',
    supportsInbound: false,

    async start() {},
    async stop() {},

    async send(_chatId, msg) {
      const text = renderToMrkdwn(msg);
      const body = JSON.stringify({ text });
      const headers = { 'Content-Type': 'application/json' };

      for (let attempt = 0; attempt <= SEND_BACKOFF_DELAYS.length; attempt++) {
        const res = await fetchFn(webhookUrl, {
          method: 'POST',
          headers,
          body,
        });
        if (res.status !== 429) {
          if (!res.ok) console.warn(`[slack] send failed: HTTP ${res.status}`);
          return;
        }
        if (attempt === SEND_BACKOFF_DELAYS.length) {
          console.warn('[slack] send dropped after retries (429)');
          return;
        }
        const retryAfter = res.headers?.get('retry-after');
        const ms = retryAfter
          ? Number(retryAfter) * 1000
          : SEND_BACKOFF_DELAYS[attempt];
        await _sleep(ms);
      }
    },

    onInbound(_cb) {},
  };
}
