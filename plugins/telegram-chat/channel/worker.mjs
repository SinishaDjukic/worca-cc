/**
 * Telegram channel worker — two-way: getUpdates long-poll inbound + HTML
 * sendMessage outbound. ~80% port of the pre-1.0 adapters/telegram.js
 * (chat-connectivity-design.md §4.9), re-homed onto the channel-worker
 * contract: the cursor moves from an fsync'd file to host-persisted state
 * deltas (with a lastUpdateId replay guard — inbound is at-least-once across
 * worker restarts), connection health is pushed as status frames instead of
 * being polled, and the long poll aborts instantly on shutdown.
 *
 * The worker is a dumb transport: no command parsing, no allowlist — the host
 * owns policy. It only filters other bots' /cmd@name commands and skips
 * edited_message (replayed edits are a command foot-gun).
 */

import { renderSegments, TELEGRAM_HTML_STYLE } from '../lib/segments.mjs';
import { splitText, sendError, withRetryLadder } from '../lib/send-util.mjs';

const TELEGRAM_API = 'https://api.telegram.org';
const LONG_POLL_TIMEOUT_SEC = 25; // < the host's 30s ping interval
const MAX_MESSAGE_CHARS = 4096;
const STALE_AFTER_MS = (LONG_POLL_TIMEOUT_SEC * 2 + 20) * 1000;
// Telegram: "if there are no new updates for at least a week, the identifier of
// the next update will be chosen randomly" — a stored offset above it would
// confirm (discard) every new update unseen.
const CURSOR_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
// Sent on every poll: Telegram otherwise reuses whatever the LAST client set.
const ALLOWED_UPDATES = encodeURIComponent(JSON.stringify(['message', 'channel_post']));

export function renderToHtml(msg) {
  return renderSegments(msg, TELEGRAM_HTML_STYLE);
}

/** Rendered-HTML chunk -> plain text (fallback when a chunk boundary broke a tag). */
export function htmlToPlain(html) {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/**
 * Inner factory with injectable I/O (old-code convention) — tests drive this
 * directly; the child entry point below applies the real defaults.
 */
export function createTelegramWorker(ctx, {
  fetchFn = globalThis.fetch,
  _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
} = {}) {
  const token = String(ctx.config.botToken || '');
  const api = (method) => `${TELEGRAM_API}/bot${token}/${method}`;
  let running = false;
  let botUsername = null;
  let botId = null;
  let lastPollOk = null;
  let staleTimer = null;
  let announced = 'connecting';
  let announcedDetail = null;

  const setStatus = (state, detail) => {
    const d = detail ?? null;
    if (announced === state && announcedDetail === d) return;
    announced = state;
    announcedDetail = d;
    ctx.setStatus(state, d);
  };

  async function pollLoop() {
    let cursor = Number(await ctx.state.get('cursor')) || 0;
    let lastSeen = Number(await ctx.state.get('lastUpdateId')) || 0;
    const storedBot = await ctx.state.get('botId');
    let cursorAt = Number(await ctx.state.get('cursorAt')) || 0;
    // The cursor belongs to ONE bot and goes stale after a week of silence; either
    // way offset=cursor would silently swallow new commands. Legacy state (no
    // botId / cursorAt) is kept — it cannot be proven wrong, and a reset could
    // replay a processed-but-unconfirmed update.
    const resetCursor = async (reason) => {
      ctx.log('info', `telegram cursor reset (${reason})`);
      cursor = 0;
      lastSeen = 0;
      await ctx.state.set('cursor', 0);
      await ctx.state.set('lastUpdateId', 0);
    };
    if (botId != null && storedBot != null && String(storedBot) !== String(botId)) {
      await resetCursor('bot token changed');
    }
    if (botId != null && String(storedBot) !== String(botId)) await ctx.state.set('botId', botId);
    let firstPoll = true;
    while (running) {
      try {
        // Checked before EVERY poll: a healthy worker is never recycled, so a
        // start-only check would miss a server that idles for a week. After the
        // reset cursor is 0, so this is a no-op until an update restamps cursorAt.
        if (cursor > 0 && cursorAt > 0 && now() - cursorAt > CURSOR_MAX_AGE_MS) {
          await resetCursor('idle for more than 7 days');
        }
        const pollTimeout = firstPoll ? 0 : LONG_POLL_TIMEOUT_SEC;
        const res = await fetchFn(`${api('getUpdates')}?offset=${cursor}&timeout=${pollTimeout}&allowed_updates=${ALLOWED_UPDATES}`, {
          signal: ctx.shutdownSignal,
        });
        firstPoll = false;
        if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          await _sleep((data.parameters?.retry_after ?? 1) * 1000);
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          setStatus('disconnected', `auth failed (HTTP ${res.status}) — check botToken`);
          return; // a restart cannot fix a bad token; wait for config reload
        }
        if (res.status === 409) {
          // A webhook is set on this bot, or another getUpdates client (a second
          // worca, `worca plugin channel`, an old adapter) holds the long poll.
          // Outbound still works, so this is the "notifications fine, replies
          // lost" shape — say why. Never deleteWebhook here: it is the bot's
          // remote config and may belong to another deployment.
          const data = await res.json().catch(() => ({}));
          setStatus('disconnected', `HTTP 409 — another client or a webhook is using this bot token; replies will not arrive until it stops${data.description ? ` (${data.description})` : ''}`);
          if (running) await _sleep(5000);
          continue;
        }
        if (!res.ok) {
          setStatus('disconnected', `HTTP ${res.status}`);
          if (running) await _sleep(5000);
          continue;
        }
        lastPollOk = now();
        setStatus('connected');
        const data = await res.json();
        if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
          for (const update of data.result) {
            cursor = update.update_id + 1;
            if (update.update_id <= lastSeen) continue; // replay guard (at-least-once)
            lastSeen = update.update_id;
            const m = update.message ?? update.channel_post; // edited_* deliberately skipped
            if (!m) continue;
            let text = m.text ?? '';
            // Group etiquette: /cmd@other_bot is not for us; /cmd@us loses the suffix.
            const cmdAt = /^(\/[A-Za-z0-9_-]+)@(\S+)([\s\S]*)$/.exec(text);
            if (cmdAt) {
              if (botUsername && cmdAt[2].toLowerCase() !== botUsername.toLowerCase()) continue;
              text = cmdAt[1] + cmdAt[3];
            }
            ctx.emitMessage({
              chatId: String(m.chat.id),
              userId: String(m.from?.id ?? m.chat.id),
              text,
              meta: {
                platform: 'telegram',
                messageId: m.message_id,
                chatType: m.chat.type,
                chatTitle: m.chat.title ?? null,
                username: m.from?.username ?? null,
                isGroup: m.chat.type !== 'private',
              },
            });
          }
          await ctx.state.set('cursor', cursor);
          await ctx.state.set('lastUpdateId', lastSeen);
          cursorAt = now();
          await ctx.state.set('cursorAt', cursorAt);
        }
      } catch (err) {
        if (!running || ctx.shutdownSignal.aborted) return;
        setStatus('disconnected', err?.message || String(err));
        await _sleep(1000);
      }
    }
  }

  return {
    async start() {
      running = true;
      const res = await fetchFn(api('getMe'), { signal: ctx.shutdownSignal });
      if (res.status === 401) {
        setStatus('disconnected', 'auth failed — check botToken');
        return { identity: null };
      }
      const me = await res.json().catch(() => ({}));
      botUsername = me?.result?.username ?? null;
      botId = me?.result?.id ?? null;
      pollLoop().catch((err) => ctx.log('error', `poll loop died: ${err?.message || err}`));
      // Push-based stale detection (the old adapter computed this on demand).
      staleTimer = setInterval(() => {
        if (announced === 'connected' && lastPollOk && now() - lastPollOk > STALE_AFTER_MS) {
          setStatus('degraded', 'connection stale — no poll response');
        }
      }, 15000);
      return { identity: botUsername ? `@${botUsername}` : null };
    },

    async stop() {
      running = false;
      clearInterval(staleTimer);
    },

    async send(chatId, msg) {
      // One chunk-send through the 429 ladder; `extra` carries {text[, parse_mode]}.
      const sendChunk = (target, extra) => withRetryLadder(async () => {
        let res;
        try {
          res = await fetchFn(api('sendMessage'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: target, ...extra }),
          });
        } catch (err) {
          throw sendError('network', err?.message || String(err));
        }
        if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          return { retryAfterMs: (data.parameters?.retry_after ?? 0) * 1000 };
        }
        if (res.status === 401) throw sendError('auth', 'auth failed — check botToken');
        if (res.status === 403) throw sendError('plugin', 'bot is blocked by this chat or was never started — open the chat and /start it');
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw sendError('plugin', `sendMessage failed: ${data.description || `HTTP ${res.status}`}`);
        }
        return undefined;
      }, _sleep);

      const chunks = splitText(renderToHtml(msg), MAX_MESSAGE_CHARS);
      for (const text of chunks) {
        try {
          await sendChunk(chatId, { text, parse_mode: 'HTML' });
        } catch (err) {
          // A chunk boundary inside an HTML tag loses the whole notification:
          // strip tags and resend ONCE as plain text, on a fresh ladder.
          if (err?.kind !== 'plugin' || !/can't parse entities/i.test(err?.message || '')) throw err;
          await sendChunk(chatId, { text: htmlToPlain(text) });
        }
      }
      return { ok: true, chunks: chunks.length };
    },
  };
}

/** Channel-worker child entry point (chat-connectivity-design.md §4.4). */
export function createChannelWorker(ctx) {
  return createTelegramWorker(ctx);
}

/** Doctor / `worca plugin channel --check`: prove the token works. */
export async function validateConfig(config, { fetchFn = globalThis.fetch } = {}) {
  const token = String(config?.botToken || '');
  if (!token) return { ok: false, errors: [{ field: 'botToken', message: 'botToken is required' }] };
  let res;
  try {
    res = await fetchFn(`${TELEGRAM_API}/bot${token}/getMe`);
  } catch (err) {
    return { ok: false, errors: [{ field: null, message: `network error: ${err?.message || err}` }] };
  }
  if (res.status === 401) return { ok: false, errors: [{ field: 'botToken', message: 'Telegram rejected the token (401)' }] };
  const me = await res.json().catch(() => ({}));
  if (!res.ok || !me.ok) return { ok: false, errors: [{ field: null, message: `getMe failed: HTTP ${res.status}` }] };
  return { ok: true, identity: me.result?.username ? `@${me.result.username}` : null };
}
