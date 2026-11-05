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
const REACT_TIMEOUT_MS = 10 * 1000;   // one reaction request; the 429 ladder adds its own waits
/** The longest 429 wait react() sits out itself; a longer one is thrown back to the host. Worst case 3 × 5 s waits +
 *  4 × 10 s requests = 55 s, under channel-host's 60 s react timeout, so a late call never lands after the next one. */
const REACT_MAX_WAIT_MS = 5 * 1000;
/** Live status (0.5.0): Discord shows "is typing…" for about 10 s per POST, so the worker refreshes it every 8 s until
 *  the host stops it; one that is never stopped (a host that died) ends on its own. */
const TYPING_REFRESH_MS = 8 * 1000;
const TYPING_MAX_MS = 30 * 60 * 1000;

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

// ── chat context (0.4.0): the replied-to message, its files and recent channel history ───────────────────────────────
const CONTEXT_READ_TIMEOUT_MS = 5 * 1000;   // one context read (a replied-to message, a history page)
/** The longest 429 wait history() sits out itself (3 waits + 4 reads stay under channel-host's 30 s history timeout). */
const HISTORY_MAX_WAIT_MS = 2 * 1000;
const HISTORY_MAX = 50;
const HISTORY_FRAME_BUDGET = 900 * 1024;    // a history answer stays under the 1 MiB protocol frame
const QUOTE_TEXT_MAX = 4000;                // channel-protocol.mjs INBOUND_LIMITS.text
const QUOTE_AUTHOR_MAX = 100;
const ATTACHMENTS_MAX = 10;
const GUILDS_KEEP = 500;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A Discord attachment → the protocol's {name, contentType, size, url}; only an https URL (the HOST downloads it, and
 *  only from the manifest's attachmentHosts). */
export function toAttachmentRef(a) {
  const url = typeof a?.url === 'string' ? a.url : '';
  if (!url.startsWith('https://') || url.length > 2048) return null;
  return { name: String(a.filename || 'file').slice(0, 255) || 'file',
    contentType: typeof a.content_type === 'string' && a.content_type ? a.content_type.slice(0, 128) : null,
    size: Number.isSafeInteger(a.size) && a.size >= 0 ? a.size : 0, url };
}
const refsOf = (list) => (Array.isArray(list) ? list : []).map(toAttachmentRef).filter(Boolean).slice(0, ATTACHMENTS_MAX);

/** Discord's ISO time (microseconds) → a plain ISO string, or null. */
export function isoOf(ts) {
  const t = Date.parse(String(ts || '').replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** A message's jump link (a DM has no guild: `@me`). */
export function messageLink(channelId, messageId, guildId) {
  return `https://discord.com/channels/${guildId || '@me'}/${channelId}/${messageId}`;
}

/** A Discord message → the protocol's quoted message {author, text, at, link, attachments?}, or null. The author is
 *  the display name (server nickname, then global name, then user name); worca's own messages say "(this bot)", other
 *  bots "(bot)". */
export function toQuoted(m, { selfId = null, guildId = null } = {}) {
  const at = isoOf(m?.timestamp);
  if (!m || !m.id || !m.channel_id || !at) return null;
  const a = m.author || {};
  const own = selfId != null && String(a.id) === String(selfId);
  const name = String(m.member?.nick || a.global_name || a.username || 'unknown').slice(0, QUOTE_AUTHOR_MAX - 11);
  const attachments = refsOf(m.attachments);
  return { author: `${name}${own ? ' (this bot)' : a.bot ? ' (bot)' : ''}`, text: String(m.content ?? '').slice(0, QUOTE_TEXT_MAX), at,
    link: messageLink(String(m.channel_id), String(m.id), guildId ?? m.guild_id ?? null), ...(attachments.length ? { attachments } : {}) };
}

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
  _timers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (id) => clearInterval(id) },
  _now = () => Date.now(),
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
  const guilds = new Map();          // channel id -> guild id of a server channel this worker saw a message in (history())
  const chains = new Map();          // channel id -> the delivery a reply's context read holds (keeps the channel's order)
  const typingFor = new Map();       // channel id -> { since, pauseUntil, timer } while the host shows a turn working there
  function stopTyping(ch, entry = typingFor.get(ch)) {
    if (!entry || typingFor.get(ch) !== entry) return;
    typingFor.delete(ch);
    if (entry.timer != null) _timers.clearInterval(entry.timer);
  }
  /** One POST /typing. A 429 pauses the refresh for retry_after (never waited inline); a refusal (no access, a deleted
   *  thread) or the time cap stops it. Returns the refusal, or null. */
  async function typingBeat(ch, entry) {
    if (typingFor.get(ch) !== entry) return null;
    if (_now() - entry.since > TYPING_MAX_MS) { stopTyping(ch, entry); return null; }
    if (_now() < entry.pauseUntil) return null;
    let res;
    try { res = await fetchFn(`${DISCORD_API}/channels/${ch}/typing`, { method: 'POST', headers: authHeaders, signal: AbortSignal.timeout(REACT_TIMEOUT_MS) }); }
    catch (err) { ctx.log('warn', `typing not shown: ${err?.message || err}`); return null; }
    if (res.status === 429) {
      const d = await res.json().catch(() => ({}));
      entry.pauseUntil = _now() + Math.ceil((d.retry_after ?? 1) * 1000);
      return null;
    }
    if (res.ok || res.status >= 500) return null;   // a 5xx skips one beat; the next one tries again
    stopTyping(ch, entry);
    if (res.status === 401) return sendError('auth', 'Discord rejected the bot token');
    return refusal(sendError('plugin', res.status === 403 ? 'missing access: the bot needs Send Messages in this channel to show typing'
      : res.status === 404 ? `channel not found (${ch})` : `typing failed: HTTP ${res.status}`));
  }
  const rememberGuild = (ch, g) => {
    guilds.delete(ch);
    guilds.set(ch, g);
    if (guilds.size > GUILDS_KEEP) guilds.delete(guilds.keys().next().value);
  };
  const mentionsSelf = (m) => Array.isArray(m.mentions) && m.mentions.some((u) => u && String(u.id) === String(selfId));
  /** A reply (not a forward) to a message in the same channel. */
  const isReply = (m) => {
    const r = m.message_reference;
    return !!r && r.message_id != null && (r.type === undefined || r.type === 0)
      && (r.channel_id == null || String(r.channel_id) === String(m.channel_id));
  };
  /** Reply context only for a message worca acts on: a mention of this bot, or a message in its own thread. */
  const wantsContext = (m) => mentionsSelf(m) || threads.has(String(m.channel_id));

  /** GET the replied-to message when the event came without it. One try that never blocks the message: any failure
   *  (403 without Read Message History, 404, 429, network) delivers it without the reply. */
  async function readReferenced(m) {
    const ch = String(m.channel_id);
    const id = String(m.message_reference.message_id);
    if (!ID_RE.test(ch) || !ID_RE.test(id)) return null;
    let res;
    try { res = await fetchFn(`${DISCORD_API}/channels/${ch}/messages/${id}`, { headers: authHeaders, signal: AbortSignal.timeout(CONTEXT_READ_TIMEOUT_MS) }); }
    catch (err) { ctx.log('warn', `replied-to message not read: ${err?.message || err}`); return null; }
    if (!res.ok) {
      ctx.log('warn', `replied-to message not read: HTTP ${res.status}${res.status === 403 ? ' (the bot needs Read Message History)' : ''}`);
      return null;
    }
    const d = await res.json().catch(() => null);
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  }

  /** MESSAGE_CREATE → IncomingMessage (+ chat context). `fetched` = the replied-to message readReferenced got. */
  function toInbound(m, fetched = null) {
    const ch = String(m.channel_id);
    const guildId = m.guild_id ?? null;
    const ref = fetched || (m.referenced_message && typeof m.referenced_message === 'object' ? m.referenced_message : null);
    // In its own thread a Reply to worca's message is already part of the conversation (and is how a person answers
    // an open question card): it is not quoted again. A start mention replying to anything keeps it.
    const ownInThread = !!ref && threads.has(ch) && selfId != null && String(ref.author?.id) === String(selfId);
    const replyTo = ref && !ownInThread && isReply(m) && wantsContext(m) ? toQuoted({ ...ref, channel_id: ref.channel_id ?? ch }, { selfId, guildId }) : null;
    const attachments = refsOf(m.attachments);
    return {
      chatId: ch,
      userId: String(m.author?.id ?? ''),
      text: m.content ?? '',
      meta: {
        platform: 'discord',
        messageId: m.id ?? null,
        guildId,
        username: m.author?.username ?? null,
        // A DM has no guild; every guild channel is a group (the router gates /direct on it).
        isGroup: m.guild_id != null,
        // Freeform chat: did this message mention THIS bot, and which id is the bot (the host strips only that
        // mention token from the text; other mentions and e-mail addresses stay).
        mentionsBot: mentionsSelf(m),
        botId: selfId == null ? null : String(selfId),
        // The message's own link, the source of its files (chat context); absent without files, as before.
        ...(attachments.length && m.id != null ? { link: messageLink(ch, String(m.id), guildId) } : {}),
      },
      ...(attachments.length ? { attachments } : {}),
      ...(replyTo ? { replyTo } : {}),
    };
  }

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
          const ch = String(m.channel_id);
          if (!admits(ch)) return;
          if (m.guild_id != null) rememberGuild(ch, String(m.guild_id));
          if (!m.content && !warnedEmptyContent) {
            warnedEmptyContent = true;
            ctx.log('warn', 'MESSAGE_CREATE with empty content — is the MESSAGE CONTENT INTENT toggle enabled in the Developer Portal?');
          }
          // The channel's order holds: while a reply's quoted message is being read, later messages of the same channel
          // wait behind it. Every other message is delivered at once, as before.
          const read = isReply(m) && wantsContext(m) && m.referenced_message === undefined;
          const held = chains.get(ch);
          if (!read && !held) { ctx.emitMessage(toInbound(m)); return; }
          const run = (held || Promise.resolve())
            .then(async () => { ctx.emitMessage(toInbound(m, read ? await readReferenced(m) : null)); })
            .catch((err) => ctx.log('warn', `message not delivered: ${err?.message || err}`));
          chains.set(ch, run);
          run.finally(() => { if (chains.get(ch) === run) chains.delete(ch); });
        },
      });
      gateway.start();
      return { identity: me?.username ? `@${me.username}` : null };
    },

    async stop() {
      gateway?.stop();
      for (const ch of [...typingFor.keys()]) stopTyping(ch);
    },

    /** v2 (live status): show (`on`) "is typing…" in one channel or thread, refreshed every 8 s until stopped. The first
     *  POST is awaited: its refusal (403/404) is `permanent` and starts no refresh. A later refusal only stops it. */
    async typing(chatId, on) {
      const ch = String(chatId ?? '');
      if (!ID_RE.test(ch)) throw refusal(sendError('plugin', 'typing needs a channel id'));
      stopTyping(ch);
      if (!on) return { ok: true };
      const entry = { since: _now(), pauseUntil: 0, timer: null };
      typingFor.set(ch, entry);
      const refused = await typingBeat(ch, entry);
      if (refused) throw refused;
      if (typingFor.get(ch) === entry) {
        entry.timer = _timers.setInterval(() => {
          typingBeat(ch, entry).then((err) => { if (err) ctx.log('warn', `typing stopped: ${err.message}`); }, () => {});
        }, TYPING_REFRESH_MS);
        entry.timer?.unref?.();
      }
      return { ok: true };
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

    /** Add (PUT) or remove (DELETE) THIS bot's own reaction (`@me`) — other people's reactions are never touched.
     *  Needs Add Reactions + Read Message History in the channel; refusals are `permanent`, 5xx/network are not. */
    async react(chatId, messageId, emoji, on) {
      const url = `${DISCORD_API}/channels/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}/@me`;
      await withRetryLadder(async () => {
        let res;
        try { res = await fetchFn(url, { method: on ? 'PUT' : 'DELETE', headers: authHeaders, signal: AbortSignal.timeout(REACT_TIMEOUT_MS) }); }
        catch (err) { throw sendError('network', err?.message || String(err)); }
        if (res.status === 429) {
          const d = await res.json().catch(() => ({}));
          const ms = Math.ceil((d.retry_after ?? 1) * 1000);
          // A long wait goes back to the host: its per-message chain sits it out in order (receipts.mjs).
          if (ms > REACT_MAX_WAIT_MS) throw sendError('rate-limit', `Discord rate limit: retry in ${ms} ms`, ms);
          return { retryAfterMs: ms };
        }
        if (res.status === 401) throw sendError('auth', 'Discord rejected the bot token');
        if (res.status === 403) throw refusal(sendError('plugin', 'missing access: invite the bot with Add Reactions and Read Message History in this channel'));
        if (res.status === 404) throw refusal(sendError('plugin', `message not found (${messageId})`));
        if (res.status >= 500) throw sendError('network', `Discord is unavailable (HTTP ${res.status})`);
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          const e = sendError('plugin', `reaction failed: ${d.message || `HTTP ${res.status}`}`);
          throw res.status === 400 ? refusal(e) : e;
        }
        return undefined;
      }, _sleep);
      return { ok: true };
    },

    /** v2 (chat context): up to `limit` messages of a server channel before one message, oldest first, as quoted
     *  messages. Only a channel this worker admits AND has seen a server message in: never a DM, never an unrelated
     *  channel. Other bots' messages are skipped, worca's own stay; joins, pins and other system rows are dropped.
     *  Needs View Channel + Read Message History (403 → permanent). A short 429 is waited out, a long one goes back. */
    async history(chatId, before, limit) {
      const ch = String(chatId ?? '');
      const from = String(before ?? '');
      if (!ID_RE.test(ch) || !ID_RE.test(from) || !guilds.has(ch) || !admits(ch)) {
        throw refusal(sendError('plugin', 'history is read only in an allowed server channel'));
      }
      const n = Math.max(1, Math.min(HISTORY_MAX, Math.trunc(Number(limit)) || 1));
      const url = `${DISCORD_API}/channels/${ch}/messages?before=${from}&limit=${n}`;
      const out = await withRetryLadder(async () => {
        let res;
        try { res = await fetchFn(url, { headers: authHeaders, signal: AbortSignal.timeout(CONTEXT_READ_TIMEOUT_MS) }); }
        catch (err) { throw sendError('network', err?.message || String(err)); }
        if (res.status === 429) {
          const d = await res.json().catch(() => ({}));
          const ms = Math.ceil((d.retry_after ?? 1) * 1000);
          if (ms > HISTORY_MAX_WAIT_MS) throw sendError('rate-limit', `Discord rate limit: retry in ${ms} ms`, ms);
          return { retryAfterMs: ms };
        }
        if (res.status === 401) throw sendError('auth', 'Discord rejected the bot token');
        if (res.status === 403) throw refusal(sendError('plugin', 'missing access: the bot needs View Channel and Read Message History in this channel'));
        if (res.status === 404) throw refusal(sendError('plugin', `channel not found (${ch})`));
        if (res.status >= 500) throw sendError('network', `Discord is unavailable (HTTP ${res.status})`);
        if (!res.ok) throw sendError('plugin', `history read failed: HTTP ${res.status}`);
        return { data: await res.json().catch(() => []) };
      }, _sleep);
      const guildId = guilds.get(ch);
      const msgs = [];
      for (const m of (Array.isArray(out?.data) ? out.data : []).slice().reverse()) {   // Discord answers newest first
        if (!m || typeof m !== 'object' || (m.type !== 0 && m.type !== 19)) continue;     // people's messages and replies only
        if (m.author?.bot && String(m.author?.id) !== String(selfId)) continue;           // other bots are skipped
        const q = toQuoted({ ...m, channel_id: m.channel_id ?? ch }, { selfId, guildId });
        if (q) msgs.push(q);
      }
      // Under the 1 MiB protocol frame: the oldest messages go first.
      while (msgs.length && Buffer.byteLength(JSON.stringify(msgs), 'utf8') > HISTORY_FRAME_BUDGET) msgs.shift();
      return msgs;
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
