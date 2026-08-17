/**
 * Slack channel worker — two-way via Socket Mode (chat-connectivity-design.md
 * §4.9): `apps.connections.open` (app-level `xapp-` token) hands out a wss URL;
 * events arrive as envelopes that MUST be acked immediately (3s deadline),
 * BEFORE processing; outbound rides `chat.postMessage` (`xoxb-` bot token,
 * mrkdwn text in v1). No public URL, no Events API endpoint — the socket dials
 * out. Zero dependencies: Node >= 22 ships a global WebSocket client (undici).
 *
 * The worker is a dumb transport: no command parsing, no allowlist — host
 * policy. Its only edge filters: drop our own/bot messages and message
 * subtypes, plus the optional channelAllowlist to keep big workspaces from
 * flooding the host (the authoritative allowlist stays host-side).
 */

import { renderSegments, SLACK_STYLE } from '../lib/segments.mjs';
import { splitText, sendError, withRetryLadder } from '../lib/send-util.mjs';

const SLACK_API = 'https://slack.com/api';
const MAX_MESSAGE_CHARS = 4000; // Slack's recommended text ceiling
const RECONNECT_DELAYS = [1000, 5000, 30000];

export function renderToMrkdwn(msg) {
  return renderSegments(msg, SLACK_STYLE);
}

async function slackApi(fetchFn, method, token, body, signal) {
  const res = await fetchFn(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });
  if (res.status === 429) {
    const retryAfterMs = (Number(res.headers?.get?.('retry-after')) || 1) * 1000;
    return { httpStatus: 429, retryAfterMs };
  }
  const data = await res.json().catch(() => ({}));
  return { httpStatus: res.status, ...data };
}

export function createSlackWorker(ctx, {
  fetchFn = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const botToken = String(ctx.config.botToken || '');
  const appToken = String(ctx.config.appToken || '');
  const channelFilter = String(ctx.config.channelAllowlist || '').split(',').map((s) => s.trim()).filter(Boolean);
  let running = false;
  let ws = null;
  let selfUserId = null;
  let reconnects = 0;
  let announced = null;

  const setStatus = (state, detail) => {
    if (announced === state) return;
    announced = state;
    ctx.setStatus(state, detail ?? null);
  };

  function handleEnvelope(raw) {
    let env;
    try { env = JSON.parse(raw); } catch { return; }
    if (env.type === 'hello') { reconnects = 0; setStatus('connected'); return; }
    if (env.type === 'disconnect') {
      // Routine (refresh_requested etc.): reopen with a FRESH url.
      ctx.log('info', `socket disconnect requested (${env.reason || 'unspecified'}) — reopening`);
      try { ws?.close(); } catch { /* already closing */ }
      return;
    }
    // Ack FIRST (3s deadline), then process.
    if (env.envelope_id) {
      try { ws?.send(JSON.stringify({ envelope_id: env.envelope_id })); }
      catch { /* socket died: the event redelivers on the next connection */ }
    }
    if (env.type !== 'events_api') return;
    const ev = env.payload?.event;
    if (!ev || ev.type !== 'message' || ev.subtype) return;
    if (ev.bot_id || !ev.user || ev.user === selfUserId) return;
    if (channelFilter.length && !channelFilter.includes(ev.channel)) return;
    ctx.emitMessage({
      chatId: String(ev.channel),
      userId: String(ev.user),
      text: ev.text ?? '',
      meta: {
        platform: 'slack',
        ts: ev.ts ?? null,
        threadTs: ev.thread_ts ?? null,
        team: env.payload?.team_id ?? null,
      },
    });
  }

  async function connectLoop() {
    while (running) {
      let opened;
      try {
        opened = await slackApi(fetchFn, 'apps.connections.open', appToken, null, ctx.shutdownSignal);
      } catch (err) {
        if (!running || ctx.shutdownSignal.aborted) return;
        setStatus('disconnected', err?.message || String(err));
        await _sleep(RECONNECT_DELAYS[Math.min(reconnects++, RECONNECT_DELAYS.length - 1)]);
        continue;
      }
      if (opened.httpStatus === 429) { await _sleep(opened.retryAfterMs); continue; }
      if (!opened.ok) {
        setStatus('disconnected', `apps.connections.open failed: ${opened.error || `HTTP ${opened.httpStatus}`}`);
        if (opened.error === 'invalid_auth' || opened.error === 'not_authed') return; // bad app token: restart cannot help
        await _sleep(RECONNECT_DELAYS[Math.min(reconnects++, RECONNECT_DELAYS.length - 1)]);
        continue;
      }
      setStatus('connecting');
      const socket = new WebSocketImpl(opened.url);
      ws = socket;
      const closed = new Promise((resolve) => {
        socket.addEventListener('close', resolve, { once: true });
        socket.addEventListener('error', resolve, { once: true });
      });
      socket.addEventListener('message', (e) => handleEnvelope(typeof e.data === 'string' ? e.data : String(e.data)));
      await closed;
      ws = null;
      if (!running) return;
      setStatus('disconnected', 'socket closed — reconnecting');
      await _sleep(RECONNECT_DELAYS[Math.min(reconnects++, RECONNECT_DELAYS.length - 1)]);
    }
  }

  return {
    async start() {
      running = true;
      const auth = await slackApi(fetchFn, 'auth.test', botToken, null, ctx.shutdownSignal);
      if (!auth.ok) {
        // Definitive, restart-cannot-help auth.test errors (matches + extends the send() list):
        const FATAL_AUTH = new Set(['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked',
          'token_expired', 'not_allowed_token_type', 'no_permission', 'org_login_required',
          'ekm_access_denied', 'two_factor_setup_required', 'enterprise_is_restricted']);
        const fatal = FATAL_AUTH.has(auth.error);
        const detail = `auth.test failed: ${auth.error || `HTTP ${auth.httpStatus}`}`;
        if (fatal) {
          setStatus('disconnected', `${detail} — check botToken`);
          return { identity: null };
        }
        // Transient (429/5xx/network-ish): crash so the supervisor restarts with backoff.
        throw Object.assign(new Error(detail), { kind: auth.httpStatus === 429 ? 'rate-limit' : 'network' });
      }
      selfUserId = auth.user_id ?? null;
      connectLoop().catch((err) => ctx.log('error', `socket loop died: ${err?.message || err}`));
      return { identity: auth.user ? `@${auth.user}` : null };
    },

    async stop() {
      running = false;
      try { ws?.close(); } catch { /* already closed */ }
    },

    async send(chatId, msg) {
      const chunks = splitText(renderToMrkdwn(msg), MAX_MESSAGE_CHARS);
      for (const text of chunks) {
        await withRetryLadder(async () => {
          let out;
          try {
            out = await slackApi(fetchFn, 'chat.postMessage', botToken, { channel: chatId, text });
          } catch (err) {
            throw sendError('network', err?.message || String(err));
          }
          if (out.httpStatus === 429) return { retryAfterMs: out.retryAfterMs };
          if (out.ok) return undefined;
          if (out.error === 'ratelimited') return { retryAfterMs: 1000 };
          if (['invalid_auth', 'token_revoked', 'account_inactive', 'not_authed'].includes(out.error)) {
            throw sendError('auth', `Slack rejected the bot token (${out.error})`);
          }
          if (out.error === 'channel_not_found' || out.error === 'not_in_channel') {
            throw sendError('plugin', `${out.error}: invite the bot to the channel first (/invite @bot) and use the C… channel ID`);
          }
          throw sendError('plugin', `chat.postMessage failed: ${out.error || `HTTP ${out.httpStatus}`}`);
        }, _sleep);
      }
      return { ok: true, chunks: chunks.length };
    },
  };
}

/** Channel-worker child entry point. */
export function createChannelWorker(ctx) {
  return createSlackWorker(ctx);
}

/** Doctor: dual check — bot token (auth.test) AND app token (connections.open)
 *  with per-field errors so the UI pins the failing one. */
export async function validateConfig(config, { fetchFn = globalThis.fetch } = {}) {
  const errors = [];
  if (!config?.botToken) errors.push({ field: 'botToken', message: 'botToken (xoxb-…) is required' });
  if (!config?.appToken) errors.push({ field: 'appToken', message: 'appToken (xapp-…, connections:write) is required' });
  if (errors.length) return { ok: false, errors };
  let identity = null;
  try {
    const auth = await slackApi(fetchFn, 'auth.test', config.botToken, null);
    if (!auth.ok) errors.push({ field: 'botToken', message: `auth.test failed: ${auth.error || `HTTP ${auth.httpStatus}`}` });
    else identity = auth.user ? `@${auth.user}` : null;
    const open = await slackApi(fetchFn, 'apps.connections.open', config.appToken, null);
    if (!open.ok) errors.push({ field: 'appToken', message: `apps.connections.open failed: ${open.error || `HTTP ${open.httpStatus}`}` });
  } catch (err) {
    errors.push({ field: null, message: `network error: ${err?.message || err}` });
  }
  return errors.length ? { ok: false, errors } : { ok: true, identity };
}
