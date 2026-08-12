/**
 * Discord channel worker — two-way: Gateway v10 websocket inbound
 * (channel/gateway.mjs) + REST channel-message outbound (ported from the
 * pre-1.0 adapters/discord.js send path). The worker is a dumb transport: no
 * command parsing, no allowlist — host policy. Edge filters only: drop bot/own
 * messages and (optionally) non-allowlisted channels.
 */

import { renderSegments, DISCORD_STYLE } from '../lib/segments.mjs';
import { splitText, sendError, withRetryLadder } from '../lib/send-util.mjs';
import { createGatewayClient } from './gateway.mjs';

const DISCORD_API = 'https://discord.com/api/v10';
const MAX_MESSAGE_CHARS = 2000;

export function renderToMarkdown(msg) {
  return renderSegments(msg, DISCORD_STYLE);
}

export function createDiscordWorker(ctx, {
  fetchFn = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const token = String(ctx.config.botToken || '');
  const channelFilter = String(ctx.config.channelAllowlist || '').split(',').map((s) => s.trim()).filter(Boolean);
  const authHeaders = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
  let gateway = null;
  let selfId = null;
  let warnedEmptyContent = false;

  return {
    async start() {
      let me;
      try {
        const res = await fetchFn(`${DISCORD_API}/users/@me`, { headers: authHeaders, signal: ctx.shutdownSignal });
        if (res.status === 401) {
          ctx.setStatus('disconnected', 'Discord rejected the bot token — check botToken');
          return { identity: null };
        }
        me = await res.json().catch(() => ({}));
      } catch (err) {
        ctx.setStatus('disconnected', `network error: ${err?.message || err}`);
        throw err; // supervisor restarts with backoff
      }
      selfId = me?.id ?? null;

      const gw = await fetchFn(`${DISCORD_API}/gateway/bot`, { headers: authHeaders, signal: ctx.shutdownSignal });
      const gwData = await gw.json().catch(() => ({}));
      if (!gw.ok || !gwData.url) {
        ctx.setStatus('disconnected', `GET /gateway/bot failed: HTTP ${gw.status}`);
        return { identity: me?.username ? `@${me.username}` : null };
      }
      if (gwData.session_start_limit?.remaining === 0) {
        ctx.setStatus('disconnected', `gateway session limit exhausted — resets in ${Math.ceil((gwData.session_start_limit.reset_after || 0) / 60000)}min`);
        return { identity: me?.username ? `@${me.username}` : null };
      }

      gateway = createGatewayClient({
        token,
        gatewayUrl: gwData.url,
        WebSocketImpl,
        _sleep,
        log: (l, m) => ctx.log(l, m),
        onState: (state, detail) => ctx.setStatus(state, detail ?? null),
        onFatal: (detail, kind) => ctx.setStatus('disconnected', `[${kind}] ${detail}`),
        onMessage: (m) => {
          if (!m || m.author?.bot || m.author?.id === selfId) return;
          if (channelFilter.length && !channelFilter.includes(String(m.channel_id))) return;
          if (!m.content && !warnedEmptyContent) {
            warnedEmptyContent = true;
            ctx.log('warn', 'MESSAGE_CREATE with empty content — is the MESSAGE CONTENT INTENT toggle enabled in the Developer Portal?');
          }
          ctx.emitMessage({
            chatId: String(m.channel_id),
            userId: String(m.author?.id ?? ''),
            text: m.content ?? '',
            meta: {
              platform: 'discord',
              messageId: m.id ?? null,
              guildId: m.guild_id ?? null,
              username: m.author?.username ?? null,
            },
          });
        },
      });
      gateway.start();
      return { identity: me?.username ? `@${me.username}` : null };
    },

    async stop() {
      gateway?.stop();
    },

    async send(chatId, msg) {
      const chunks = splitText(renderToMarkdown(msg), MAX_MESSAGE_CHARS);
      for (const content of chunks) {
        await withRetryLadder(async () => {
          let res;
          try {
            res = await fetchFn(`${DISCORD_API}/channels/${chatId}/messages`, {
              method: 'POST', headers: authHeaders, body: JSON.stringify({ content }),
            });
          } catch (err) {
            throw sendError('network', err?.message || String(err));
          }
          if (res.status === 429) {
            const data = await res.json().catch(() => ({}));
            return { retryAfterMs: Math.ceil((data.retry_after ?? 1) * 1000) };
          }
          if (res.status === 401) throw sendError('auth', 'Discord rejected the bot token');
          if (res.status === 403) throw sendError('plugin', 'missing access: invite the bot to the server with Send Messages permission in this channel');
          if (res.status === 404) throw sendError('plugin', `channel ${chatId} not found — copy the channel ID with Developer Mode enabled`);
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw sendError('plugin', `send failed: ${data.message || `HTTP ${res.status}`}`);
          }
          return undefined;
        }, _sleep);
      }
      return { ok: true, chunks: chunks.length };
    },
  };
}

/** Channel-worker child entry point. */
export function createChannelWorker(ctx) {
  return createDiscordWorker(ctx);
}

/** Doctor: token via /users/@me, gateway auth via /gateway/bot. */
export async function validateConfig(config, { fetchFn = globalThis.fetch } = {}) {
  const token = String(config?.botToken || '');
  if (!token) return { ok: false, errors: [{ field: 'botToken', message: 'botToken is required' }] };
  const headers = { Authorization: `Bot ${token}` };
  try {
    const me = await fetchFn(`${DISCORD_API}/users/@me`, { headers });
    if (me.status === 401) return { ok: false, errors: [{ field: 'botToken', message: 'Discord rejected the token (401)' }] };
    const meData = await me.json().catch(() => ({}));
    if (!me.ok) return { ok: false, errors: [{ field: null, message: `GET /users/@me failed: HTTP ${me.status}` }] };
    const gw = await fetchFn(`${DISCORD_API}/gateway/bot`, { headers });
    if (!gw.ok) return { ok: false, errors: [{ field: null, message: `GET /gateway/bot failed: HTTP ${gw.status}` }] };
    return { ok: true, identity: meData.username ? `@${meData.username}` : null };
  } catch (err) {
    return { ok: false, errors: [{ field: null, message: `network error: ${err?.message || err}` }] };
  }
}
