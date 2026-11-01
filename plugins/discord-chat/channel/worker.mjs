/**
 * Discord channel worker — two-way: Gateway v10 websocket inbound
 * (channel/gateway.mjs) + REST channel-message outbound (ported from the
 * pre-1.0 adapters/discord.js send path). The worker is a dumb transport: no
 * command parsing, no allowlist — host policy. Edge filters only: drop bot/own
 * messages and (optionally) non-allowlisted channels.
 */

import { renderSegments, DISCORD_STYLE } from '../lib/segments.mjs';
import { splitText, sendError, withRetryLadder } from '../lib/send-util.mjs';

/** Mark a send error the platform refused for good, so the host does not retry the same message. */
const refusal = (err) => Object.assign(err, { permanent: true });
import { createGatewayClient } from './gateway.mjs';

const DISCORD_API = 'https://discord.com/api/v10';
const MAX_MESSAGE_CHARS = 2000;

export function renderToMarkdown(msg) {
  return renderSegments(msg, DISCORD_STYLE);
}

const STYLE = { primary: 1, secondary: 2, success: 3, danger: 4 };
const CUSTOM_ID_PREFIX = 'w:';
const MODAL_BUTTON_PREFIX = 'w:m:';     // a button that opens a modal: decidable with no memory (restart-safe)
const TOKEN_TTL_MS = 14 * 60 * 1000;
const THREADS_STATE_KEY = 'freeformThreads';
const THREADS_KEEP = 500;              // newest thread ids kept in ctx.state (well under the 1 MiB state frame)
const REF_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** custom_id → { ref, opensModal } for our ids, else null. */
export function parseCustomId(cid) {
  const s = String(cid || '');
  if (s.startsWith(MODAL_BUTTON_PREFIX)) { const ref = s.slice(MODAL_BUTTON_PREFIX.length); return REF_RE.test(ref) ? { ref, opensModal: true } : null; }
  if (s.startsWith(CUSTOM_ID_PREFIX)) { const ref = s.slice(CUSTOM_ID_PREFIX.length); return REF_RE.test(ref) ? { ref, opensModal: false } : null; }
  return null;
}

/** The modal a button opens when the worker has no spec for it (fresh process): one required paragraph `text`,
 *  titled with the clicked button's own label from the interaction's message. The host validates the answer. */
export function fallbackModal(raw, cid) {
  let label = '';
  for (const row of raw?.message?.components || []) for (const c of row?.components || []) if (c?.custom_id === cid && typeof c.label === 'string') label = c.label;
  return { title: (label || 'Answer').slice(0, 45), fields: [{ id: 'text', label: 'Your answer', style: 'paragraph', required: true, maxLength: 2000 }] };
}

/** NormalizedMessage.controls → Discord action rows: every select its own row, buttons and links 5 per row, ≤ 5 rows. */
export function renderComponents(controls) {
  if (!Array.isArray(controls) || !controls.length) return [];
  const rows = [];
  let buttons = [];
  const flush = () => { if (buttons.length) { rows.push({ type: 1, components: buttons }); buttons = []; } };
  for (const c of controls) {
    if (c.kind === 'select') {
      flush();
      rows.push({ type: 1, components: [{ type: 3, custom_id: CUSTOM_ID_PREFIX + c.ref, ...(c.placeholder ? { placeholder: c.placeholder } : {}),
        min_values: 1, max_values: 1,
        options: c.options.map((o) => ({ value: o.value, label: o.label, ...(o.description ? { description: o.description } : {}) })) }] });
      continue;
    }
    buttons.push(c.kind === 'link'
      ? { type: 2, style: 5, label: c.label, url: c.url }
      : { type: 2, style: STYLE[c.style] || 2, label: c.label, custom_id: (c.modal ? MODAL_BUTTON_PREFIX : CUSTOM_ID_PREFIX) + c.ref });
    if (buttons.length === 5) flush();
  }
  flush();
  return rows.slice(0, 5);
}

/** The modal a button's control carries (D9: opened by the worker itself, inside the 3 s window). */
export function renderModal(ref, modal) {
  return { custom_id: CUSTOM_ID_PREFIX + ref, title: modal.title,
    components: modal.fields.map((f) => ({ type: 1, components: [{ type: 4, custom_id: f.id, label: f.label,
      style: f.style === 'paragraph' ? 2 : 1, required: f.required, max_length: f.maxLength }] })) };
}

/** INTERACTION_CREATE → our IncomingInteraction, or null for anything not ours (no `w:` prefix, bad ref, other types).
 *  A modal SUBMIT's custom_id is always the plain `w:<ref>` (renderModal); `w:m:` only marks the opening button. */
export function toInteraction(i) {
  if (!i || (i.type !== 3 && i.type !== 5)) return null;
  const parsed = parseCustomId(i.data?.custom_id);
  if (!parsed) return null;
  const user = i.member?.user || i.user || {};
  const base = { id: String(i.id), chatId: String(i.channel_id || ''), userId: String(user.id || ''), ref: parsed.ref,
    meta: { platform: 'discord', guildId: i.guild_id ?? null, messageId: i.message?.id ?? null, username: user.username ?? null } };
  if (i.type === 5) {
    const fields = {};
    // Two submit shapes: action row → text input (what renderModal sends) and Label (type 18) → `component`
    // (Discord's newer modal layout; the docs mark the action-row form deprecated but accepted).
    for (const top of i.data?.components || []) for (const c of (top?.component ? [top.component] : top?.components || [])) if (typeof c?.custom_id === 'string') fields[c.custom_id] = String(c.value ?? '');
    return { ...base, kind: 'modal', fields };
  }
  if (i.data?.component_type === 3) return { ...base, kind: 'select', values: (i.data.values || []).map(String) };
  return { ...base, kind: 'button' };
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
  const pendingModals = new Map();   // ref -> modal spec from controls this process sent (nicer labels; optional)
  const tokens = new Map();          // interactionId -> { appId, token, at } (never leaves this process)
  const threads = new Set();         // thread ids this bot created for freeform chat (M5: admitted past channelAllowlist)
  const admits = (channelId, parentId = '') => !channelFilter.length || channelFilter.includes(channelId)
    || threads.has(channelId) || (parentId !== '' && channelFilter.includes(parentId));
  async function rememberThread(id) {
    threads.delete(id); threads.add(id);
    while (threads.size > THREADS_KEEP) threads.delete(threads.values().next().value);
    try { await ctx.state.set(THREADS_STATE_KEY, [...threads]); } catch (err) { ctx.log('warn', `thread list not saved: ${err?.message || err}`); }
  }

  async function callback(i, body) {
    const res = await fetchFn(`${DISCORD_API}/interactions/${i.id}/${i.token}/callback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw sendError(res.status === 429 ? 'rate-limit' : 'plugin', `interaction callback failed: HTTP ${res.status}`);
  }

  async function handleInteraction(raw) {
    const evt = toInteraction(raw);
    if (!evt) return;
    if (raw.member?.user?.bot || raw.user?.bot) return;
    if (!admits(evt.chatId, String(raw.channel?.parent_id || ''))) return;
    const cid = String(raw.data?.custom_id || '');
    // M7: "open a modal" is decided from the custom_id alone; the spec is a nicety that a restart may have lost.
    const modal = raw.type === 3 && evt.kind === 'button' && parseCustomId(cid)?.opensModal
      ? (pendingModals.get(evt.ref) || fallbackModal(raw, cid)) : null;
    // Acknowledge first, always inside Discord's window and independent of the host's queues.
    await callback(raw, modal ? { type: 9, data: renderModal(evt.ref, modal) } : { type: 6 });
    if (modal) return;   // the modal's SUBMIT (custom_id `w:<ref>`) is the interaction the host acts on
    const now = Date.now();
    for (const [k, v] of tokens) if (now - v.at > TOKEN_TTL_MS) tokens.delete(k);
    tokens.set(evt.id, { appId: String(raw.application_id || ''), token: String(raw.token || ''), at: now });
    ctx.emitInteraction(evt);
  }

  return {
    async start() {
      try {
        const saved = await ctx.state.get(THREADS_STATE_KEY);
        if (Array.isArray(saved)) for (const id of saved.slice(-THREADS_KEEP)) if (typeof id === 'string' && id) threads.add(id);
      } catch { /* no saved threads */ }
      let res;
      try {
        res = await fetchFn(`${DISCORD_API}/users/@me`, { headers: authHeaders, signal: ctx.shutdownSignal });
      } catch (err) {
        ctx.setStatus('disconnected', `network error: ${err?.message || err}`);
        throw err; // supervisor restarts with backoff
      }
      if (res.status === 401) {
        ctx.setStatus('disconnected', 'Discord rejected the bot token — check botToken');
        return { identity: null };
      }
      const me = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Transient: a null selfId would stop own-message filtering, so never continue here.
        const detail = `GET /users/@me failed: HTTP ${res.status}`;
        ctx.setStatus('disconnected', detail);
        throw Object.assign(new Error(detail), { kind: res.status === 429 ? 'rate-limit' : 'network' });
      }
      selfId = me?.id ?? null;

      const gw = await fetchFn(`${DISCORD_API}/gateway/bot`, { headers: authHeaders, signal: ctx.shutdownSignal });
      const gwData = await gw.json().catch(() => ({}));
      if (!gw.ok || !gwData.url) {
        const detail = `GET /gateway/bot failed: HTTP ${gw.status}`;
        ctx.setStatus('disconnected', detail);
        throw Object.assign(new Error(detail), { kind: gw.status === 429 ? 'rate-limit' : 'network' });
      }
      if (gwData.session_start_limit?.remaining === 0) {
        const detail = `gateway session limit exhausted — resets in ${Math.ceil((gwData.session_start_limit.reset_after || 0) / 60000)}min`;
        ctx.setStatus('disconnected', detail);
        throw Object.assign(new Error(detail), { kind: 'rate-limit' });
      }

      gateway = createGatewayClient({
        token,
        gatewayUrl: gwData.url,
        WebSocketImpl,
        _sleep,
        log: (l, m) => ctx.log(l, m),
        onState: (state, detail) => ctx.setStatus(state, detail ?? null),
        onFatal: (detail, kind) => ctx.setStatus('disconnected', `[${kind}] ${detail}`),
        onInteraction: (raw) => { handleInteraction(raw).catch((err) => ctx.log('warn', `interaction failed: ${err?.message || err}`)); },
        onMessage: (m) => {
          if (!m || m.author?.bot || m.author?.id === selfId) return;
          if (!admits(String(m.channel_id))) return;
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
              // A DM has no guild; every guild channel is a group (the router gates /direct on it).
              isGroup: m.guild_id != null,
              // Freeform chat: did this message mention THIS bot, and which id is the bot (the host strips only that
              // mention token from the text; other mentions and e-mail addresses stay).
              mentionsBot: Array.isArray(m.mentions) && m.mentions.some((u) => u && String(u.id) === String(selfId)),
              botId: selfId == null ? null : String(selfId),
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

    async send(chatId, msg, options = {}) {
      const components = renderComponents(msg.controls);
      for (const c of msg.controls || []) if (c.kind === 'button' && c.modal) pendingModals.set(c.ref, c.modal);
      const text = renderToMarkdown(msg);
      const post = (url, method, body) => withRetryLadder(async () => {
        let res;
        try { res = await fetchFn(url, { method, headers: authHeaders, body: JSON.stringify(body) }); }
        catch (err) { throw sendError('network', err?.message || String(err)); }
        if (res.status === 429) { const d = await res.json().catch(() => ({})); return { retryAfterMs: Math.ceil((d.retry_after ?? 1) * 1000) }; }
        if (res.status === 401) throw sendError('auth', 'Discord rejected the bot token');
        // Only a refusal that fails again on a retry is `permanent` (403, 404, an invalid body); a 5xx is an outage.
        if (res.status === 403) throw refusal(sendError('plugin', 'missing access: invite the bot with Send Messages, Send Messages in Threads and Create Public Threads in this channel'));
        if (res.status === 404) throw refusal(sendError('plugin', `channel or message not found (${chatId})`));
        if (res.status >= 500) throw sendError('network', `Discord is unavailable (HTTP ${res.status})`);
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          const e = sendError('plugin', `send failed: ${d.message || `HTTP ${res.status}`}`);
          throw res.status === 400 ? refusal(e) : e;
        }
        return { data: await res.json().catch(() => ({})) };
      }, _sleep);
      if (options.edit) {
        // An edit is one message: the text is cut to 2000 (card posts are built to fit), components replace the old ones.
        const out = await post(`${DISCORD_API}/channels/${chatId}/messages/${options.edit.messageId}`, 'PATCH',
          { content: splitText(text, MAX_MESSAGE_CHARS)[0], components, allowed_mentions: { parse: [] } });
        return { ok: true, messageIds: [String(out?.data?.id || options.edit.messageId)] };
      }
      let target = chatId;
      let threadId = null;
      if (options.thread) {
        const t = await post(`${DISCORD_API}/channels/${chatId}/messages/${options.thread.fromMessageId}/threads`, 'POST',
          { name: options.thread.name, auto_archive_duration: 1440 });
        threadId = String(t?.data?.id || '');
        if (!threadId) throw sendError('plugin', 'thread creation returned no id');
        await rememberThread(threadId);   // before the first post: the owner can reply the moment it appears
        target = threadId;
      }
      const chunks = splitText(text, MAX_MESSAGE_CHARS);
      const messageIds = [];
      for (let k = 0; k < chunks.length; k++) {
        const last = k === chunks.length - 1;
        const out = await post(`${DISCORD_API}/channels/${target}/messages`, 'POST',
          { content: chunks[k], ...(last && components.length ? { components } : {}), allowed_mentions: { parse: [] } });
        messageIds.push(String(out?.data?.id || ''));
      }
      return { ok: true, chunks: chunks.length, messageIds, ...(threadId ? { threadId } : {}) };
    },

    async replyInteraction(interactionId, text) {
      const t = tokens.get(interactionId);
      if (!t || Date.now() - t.at > TOKEN_TTL_MS) throw sendError('plugin', 'interaction expired');
      const res = await fetchFn(`${DISCORD_API}/webhooks/${t.appId}/${t.token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: String(text).slice(0, MAX_MESSAGE_CHARS), flags: 64, allowed_mentions: { parse: [] } }) });
      if (!res.ok) throw sendError(res.status === 429 ? 'rate-limit' : 'plugin', `interaction reply failed: HTTP ${res.status}`);
      return { ok: true };
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
