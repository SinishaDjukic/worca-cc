/**
 * Generic outbound webhook adapter — POSTs to configured URL(s) with templated payloads.
 * @module adapters/webhook_out
 */

import { toDiscordMarkdown, toPlainText, toSlackMrkdwn } from '../markdown.js';

const SEND_BACKOFF_DELAYS = [1000, 5000, 30000];

// ---------------------------------------------------------------------------
// Internal text helpers
// ---------------------------------------------------------------------------

function bodyToPlain(msg) {
  return msg.body
    .map((seg) =>
      seg.kind === 'markdown' ? toPlainText(seg.value) : seg.value,
    )
    .join('');
}

function bodyToMrkdwn(msg) {
  const parts = [];
  if (msg.title) parts.push(`*${msg.title}*\n`);
  for (const seg of msg.body) {
    switch (seg.kind) {
      case 'markdown':
        parts.push(toSlackMrkdwn(seg.value));
        break;
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
      default:
        parts.push(seg.value);
    }
  }
  return parts.join('');
}

function bodyToMarkdown(msg) {
  const parts = [];
  if (msg.title) parts.push(`**${msg.title}**\n`);
  for (const seg of msg.body) {
    switch (seg.kind) {
      case 'markdown':
        parts.push(toDiscordMarkdown(seg.value));
        break;
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
      default:
        parts.push(seg.value);
    }
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Payload templates
// ---------------------------------------------------------------------------

/**
 * @param {import('../adapter.js').NormalizedMessage} msg
 * @returns {object}
 */
export function renderAsGenericJson(msg) {
  return {
    title: msg.title,
    severity: msg.severity,
    text: bodyToPlain(msg),
    segments: msg.body,
  };
}

/**
 * @param {import('../adapter.js').NormalizedMessage} msg
 * @returns {{ text: string }}
 */
export function renderAsSlackCompatible(msg) {
  return { text: bodyToMrkdwn(msg) };
}

/**
 * @param {import('../adapter.js').NormalizedMessage} msg
 * @returns {{ content: string }}
 */
export function renderAsDiscordCompatible(msg) {
  return { content: bodyToMarkdown(msg) };
}

/**
 * @param {import('../adapter.js').NormalizedMessage} msg
 * @returns {object}
 */
export function renderAsTeamsCard(msg) {
  const cardBody = [];
  if (msg.title) {
    cardBody.push({
      type: 'TextBlock',
      text: msg.title,
      weight: 'bolder',
      size: 'medium',
    });
  }
  cardBody.push({ type: 'TextBlock', text: bodyToPlain(msg), wrap: true });
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          type: 'AdaptiveCard',
          $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
          version: '1.2',
          body: cardBody,
        },
      },
    ],
  };
}

const NTFY_PRIORITY = { info: 2, success: 3, warning: 4, error: 5 };

/**
 * @param {import('../adapter.js').NormalizedMessage} msg
 * @returns {object}
 */
export function renderAsNtfy(msg) {
  return {
    title: msg.title ?? undefined,
    message: bodyToPlain(msg),
    priority: NTFY_PRIORITY[msg.severity] ?? 3,
  };
}

/**
 * @param {import('../adapter.js').NormalizedMessage} msg
 * @returns {string}
 */
export function renderAsPlainText(msg) {
  const parts = [];
  if (msg.title) parts.push(msg.title);
  const body = bodyToPlain(msg);
  if (body) parts.push(body);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

const TEMPLATES = {
  'generic-json': renderAsGenericJson,
  'slack-compatible': renderAsSlackCompatible,
  'discord-compatible': renderAsDiscordCompatible,
  'teams-card': renderAsTeamsCard,
  ntfy: renderAsNtfy,
  'plain-text': renderAsPlainText,
};

// ---------------------------------------------------------------------------
// Internal: send to one endpoint
// ---------------------------------------------------------------------------

async function sendToEndpoint(ep, msg, fetchFn, _sleep) {
  const render = TEMPLATES[ep.format] ?? renderAsGenericJson;
  const payload = render(msg);
  const isPlainText = ep.format === 'plain-text';
  const body = isPlainText ? payload : JSON.stringify(payload);
  const headers = {
    'Content-Type': isPlainText ? 'text/plain' : 'application/json',
    ...ep.headers,
  };

  for (let attempt = 0; attempt <= SEND_BACKOFF_DELAYS.length; attempt++) {
    const res = await fetchFn(ep.url, { method: 'POST', headers, body });
    if (res.status !== 429) {
      if (!res.ok)
        console.warn(
          `[webhook_out] send to ${ep.name ?? ep.url} failed: HTTP ${res.status}`,
        );
      return;
    }
    if (attempt === SEND_BACKOFF_DELAYS.length) {
      console.warn(
        `[webhook_out] send to ${ep.name ?? ep.url} dropped after retries (429)`,
      );
      return;
    }
    const retryAfter = res.headers?.get?.('retry-after');
    const ms = retryAfter
      ? Number(retryAfter) * 1000
      : SEND_BACKOFF_DELAYS[attempt];
    await _sleep(ms);
  }
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   endpoints?: Array<{url: string, format: string, headers?: object, name?: string}>,
 *   fetchFn?: typeof fetch,
 *   _sleep?: (ms: number) => Promise<void>
 * }} options
 * @returns {import('../adapter.js').ChatAdapter}
 */
export function createWebhookOutAdapter({
  endpoints = [],
  fetchFn = globalThis.fetch,
  _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  return {
    name: 'webhook_out',
    supportsInbound: false,
    persistent: false,

    connectionState() {
      return { state: 'n/a', error: null };
    },

    async start() {},
    async stop() {},

    async send(_chatId, msg) {
      await Promise.all(
        endpoints.map((ep) => sendToEndpoint(ep, msg, fetchFn, _sleep)),
      );
    },

    onInbound(_cb) {},
  };
}
