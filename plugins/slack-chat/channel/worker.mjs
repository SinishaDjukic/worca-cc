/**
 * Slack channel worker — two-way via Socket Mode (chat-connectivity-design.md
 * §4.9): `apps.connections.open` (app-level `xapp-` token) hands out a wss URL;
 * envelopes arrive on it and MUST be acked immediately (3s deadline), BEFORE
 * processing; outbound rides the Web API (`xoxb-` bot token): `chat.postMessage`
 * (mrkdwn text, Block Kit when a message carries controls), `chat.update`
 * (edits), `chat.postEphemeral` (interaction replies), `views.open` (text
 * answers), `reactions.add/remove` (the bot's own status marks). No public URL,
 * no Events API or Interactivity request URL — the socket dials out. Zero
 * dependencies: Node >= 22 ships a global WebSocket client (undici).
 *
 * The worker is a dumb transport: no command parsing, no allowlist, no owner
 * check — host policy (src/core/chat/conversation-bridge.mjs). Its only edge
 * filters: drop our own/bot messages and message subtypes (edits, deletes,
 * joins), events seen twice (an app_mention twin, a redelivery), plus the
 * optional channelAllowlist to keep big workspaces from flooding the host.
 *
 * Freeform threads: a Slack thread is a channel plus the root message's ts. A
 * thread this bot opened (send options.thread) is its own chat, `<channel>:<ts>`,
 * remembered in ctx.state so a restart keeps routing it; every other message
 * keeps the plain channel id, so commands and notifications behave as before.
 */

import { renderSegments, SLACK_STYLE } from '../lib/segments.mjs';
import { splitText, sendError, withRetryLadder } from '../lib/send-util.mjs';

const SLACK_API = 'https://slack.com/api';
const MAX_MESSAGE_CHARS = 4000; // Slack's recommended text ceiling
const MAX_SECTION_CHARS = 3000; // one Block Kit section's text
const RECONNECT_DELAYS = [1000, 5000, 30000];
const REACT_TIMEOUT_MS = 10 * 1000;   // one reaction request; the 429 ladder adds its own waits
/** The longest 429 wait react() sits out itself; a longer one is thrown back to the host (receipts.mjs waits it out in
 *  order). Worst case 3 × 5 s waits + 4 × 10 s requests = 55 s, under channel-host's 60 s react timeout. */
const REACT_MAX_WAIT_MS = 5 * 1000;
const ACTION_PREFIX = 'w:';
const MODAL_ACTION_PREFIX = 'w:m:';   // a button that opens a modal: decidable with no memory (restart-safe)
const REF_RE = /^[A-Za-z0-9_-]{16,64}$/;
const FIELD_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
const INTERACTION_TTL_MS = 14 * 60 * 1000;
const THREADS_STATE_KEY = 'freeformThreads';
const THREADS_KEEP = 2000;            // newest thread chat ids kept in ctx.state (~30 bytes each, far under the 1 MiB frame)
const SEEN_KEEP = 1000;
const MODALS_KEEP = 500;

/** worca's receipt marks (src/core/chat/receipts.mjs MARK) → Slack emoji names. ⏹ comes with and without U+FE0F.
 *  Keys are built from code points so no invisible variation selector can go missing in a copy. */
export const REACTION_NAMES = Object.freeze({
  [String.fromCodePoint(0x23f3)]: 'hourglass_flowing_sand',
  [String.fromCodePoint(0x2705)]: 'white_check_mark',
  [String.fromCodePoint(0x274c)]: 'x',
  [String.fromCodePoint(0x23f9, 0xfe0f)]: 'black_square_for_stop',
  [String.fromCodePoint(0x23f9)]: 'black_square_for_stop',
});

const AUTH_ERRORS = new Set(['invalid_auth', 'token_revoked', 'account_inactive', 'not_authed']);
/** Slack's own outages, answered as HTTP 200 + ok:false: retried, never a refusal. */
const TRANSIENT = new Set(['fatal_error', 'internal_error', 'service_unavailable', 'request_timeout']);
/** Refusals that fail again on a retry: `permanent`, so the host neither resends nor waits on them. */
const REFUSED = new Set(['channel_not_found', 'not_in_channel', 'is_archived', 'message_not_found', 'cant_update_message',
  'edit_window_closed', 'msg_too_long', 'no_text', 'invalid_blocks', 'invalid_blocks_format', 'invalid_arguments',
  'restricted_action', 'invalid_name', 'too_many_reactions', 'too_many_emoji']);
const INVITE = 'invite the bot to the channel first (/invite @bot) and use the C… channel ID';
const HINTS = {
  channel_not_found: INVITE,
  not_in_channel: INVITE,
  message_not_found: 'message not found (deleted in Slack?)',
  is_archived: 'the channel is archived',
  cant_update_message: 'only messages the bot posted can be edited',
};

/** Mark a send error the platform refused for good, so the host does not retry the same message. */
const refusal = (err) => Object.assign(err, { permanent: true });
const plain = (text) => ({ type: 'plain_text', text });
/** Cut to `n` UTF-16 units with an ellipsis, never between a surrogate pair. */
const clip = (s, n) => {
  const t = String(s ?? '');
  if (t.length <= n) return t;
  let cut = n - 1;
  const cc = t.charCodeAt(cut - 1);
  if (cc >= 0xd800 && cc <= 0xdbff) cut -= 1;
  return `${t.slice(0, cut)}…`;
};
const BUTTON_STYLE = { primary: 'primary', success: 'primary', danger: 'danger' };   // secondary = Slack's default look

export function renderToMrkdwn(msg) {
  return renderSegments(msg, SLACK_STYLE);
}

/** `<channel>` or `<channel>:<thread ts>` → its parts (Slack channel ids never contain a colon). */
export function splitChatId(chatId) {
  const s = String(chatId ?? '');
  const i = s.indexOf(':');
  return i < 0 ? { channel: s, threadTs: null } : { channel: s.slice(0, i), threadTs: s.slice(i + 1) };
}

/** A receipt mark → its Slack emoji name, or null (never guessed). */
export function reactionName(emoji) {
  const e = String(emoji ?? '');
  return Object.hasOwn(REACTION_NAMES, e) ? REACTION_NAMES[e] : null;
}

/** action_id / callback_id → { ref, opensModal } for our ids, else null. */
export function parseActionId(id) {
  const s = String(id || '');
  if (s.startsWith(MODAL_ACTION_PREFIX)) { const ref = s.slice(MODAL_ACTION_PREFIX.length); return REF_RE.test(ref) ? { ref, opensModal: true } : null; }
  if (s.startsWith(ACTION_PREFIX)) { const ref = s.slice(ACTION_PREFIX.length); return REF_RE.test(ref) ? { ref, opensModal: false } : null; }
  return null;
}

/** NormalizedMessage.controls → one Block Kit actions block (≤ 10 controls, Slack allows 25 elements), or null. */
export function renderActions(controls) {
  if (!Array.isArray(controls) || !controls.length) return null;
  const elements = controls.map((c) => {
    if (c.kind === 'select') {
      return { type: 'static_select', action_id: ACTION_PREFIX + c.ref,
        ...(c.placeholder ? { placeholder: plain(clip(c.placeholder, 150)) } : {}),
        options: c.options.slice(0, 100).map((o) => ({ text: plain(clip(o.label, 75)), value: o.value,
          ...(o.description ? { description: plain(clip(o.description, 75)) } : {}) })) };
    }
    if (c.kind === 'link') return { type: 'button', text: plain(clip(c.label, 75)), url: c.url };
    const style = BUTTON_STYLE[c.style];
    return { type: 'button', text: plain(clip(c.label, 75)), action_id: (c.modal ? MODAL_ACTION_PREFIX : ACTION_PREFIX) + c.ref,
      ...(style ? { style } : {}) };
  });
  return { type: 'actions', elements: elements.slice(0, 25) };
}

/** mrkdwn text (≤ 3000 chars) + controls → blocks: one section, then the actions block. */
export function renderBlocks(text, controls) {
  const blocks = text ? [{ type: 'section', text: { type: 'mrkdwn', text } }] : [];
  const actions = renderActions(controls);
  return actions ? [...blocks, actions] : blocks;
}

/** The modal a button opens (views.open, inside the 3 s trigger window). Its submit carries callback_id `w:<ref>` and
 *  the chat it belongs to in private_metadata (a view_submission names no channel). */
export function renderModalView(ref, modal, chatId) {
  return { type: 'modal', callback_id: ACTION_PREFIX + ref, private_metadata: JSON.stringify({ chatId }),
    title: plain(clip(modal.title, 24)), submit: plain('Send'), close: plain('Cancel'),
    blocks: modal.fields.map((f) => ({ type: 'input', block_id: f.id, optional: f.required !== true, label: plain(clip(f.label, 2000)),
      element: { type: 'plain_text_input', action_id: f.id, multiline: f.style === 'paragraph', max_length: Math.min(f.maxLength, 3000) } })) };
}

/** The modal a button opens when the worker has no spec for it (fresh process): one required paragraph `text`, titled
 *  with the clicked button's own label from the payload's message. The host validates the answer. */
export function fallbackModal(payload, actionId) {
  let label = '';
  for (const b of payload?.message?.blocks || []) {
    for (const e of (b && Array.isArray(b.elements) ? b.elements : [])) if (e?.action_id === actionId && typeof e.text?.text === 'string') label = e.text.text;
  }
  return { title: label || 'Answer', fields: [{ id: 'text', label: 'Your answer', style: 'paragraph', required: true, maxLength: 2000 }] };
}

/** A block_actions payload → { evt, actionId, opensModal } for our action, else null. `chatIdOf(channel, threadTs)`
 *  maps a thread the bot opened to its own chat id. */
export function toBlockAction(p, interactionId, chatIdOf = (channel) => channel) {
  if (!p || p.type !== 'block_actions' || !interactionId) return null;
  const a = Array.isArray(p.actions) ? p.actions[0] : null;   // Slack sends one action per payload
  const parsed = parseActionId(a?.action_id);
  if (!parsed) return null;
  const channel = String(p.channel?.id || p.container?.channel_id || '');
  const userId = String(p.user?.id || '');
  if (!channel || !userId) return null;
  const threadTs = p.message?.thread_ts || p.container?.thread_ts || null;
  const base = { id: interactionId, chatId: chatIdOf(channel, threadTs), userId, ref: parsed.ref,
    meta: { platform: 'slack', team: p.team?.id ?? null, messageId: p.message?.ts ?? p.container?.message_ts ?? null, username: p.user?.username ?? null } };
  if (a.type === 'static_select') {
    const v = a.selected_option?.value;
    return typeof v === 'string' && v ? { actionId: a.action_id, opensModal: false, evt: { ...base, kind: 'select', values: [v] } } : null;
  }
  return { actionId: a.action_id, opensModal: parsed.opensModal, evt: { ...base, kind: 'button' } };
}

/** A view_submission of one of our modals → IncomingInteraction (kind 'modal'), else null. */
export function toViewSubmission(p, interactionId) {
  if (!p || p.type !== 'view_submission' || !interactionId) return null;
  const parsed = parseActionId(p.view?.callback_id);
  if (!parsed || parsed.opensModal) return null;
  let chatId = '';
  try { const m = JSON.parse(p.view.private_metadata || '{}'); if (m && typeof m.chatId === 'string') chatId = m.chatId; } catch { /* not ours */ }
  const userId = String(p.user?.id || '');
  if (!chatId || !userId) return null;
  const fields = {};
  for (const block of Object.values(p.view?.state?.values || {})) {
    for (const [id, v] of Object.entries(block || {})) if (FIELD_ID_RE.test(id)) fields[id] = String(v?.value ?? '').slice(0, 4000);
  }
  return { id: interactionId, chatId, userId, ref: parsed.ref, kind: 'modal', fields,
    meta: { platform: 'slack', team: p.team?.id ?? null, messageId: null, username: p.user?.username ?? null } };
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

/** One Web API answer → undefined (done), {retryAfterMs} (rate limited: the ladder retries) or a thrown typed error.
 *  Slack answers most refusals as HTTP 200 + ok:false; only those in REFUSED are `permanent` — a 5xx is an outage.
 *  `tolerated` is the one error that means "already so" (already_reacted / no_reaction). */
function check(out, what, tolerated = null) {
  if (out.httpStatus === 429) return { retryAfterMs: out.retryAfterMs };
  if (out.ok || (tolerated && out.error === tolerated)) return undefined;
  if (out.error === 'ratelimited') return { retryAfterMs: 1000 };
  if (AUTH_ERRORS.has(out.error)) throw sendError('auth', `Slack rejected the bot token (${out.error})`);
  if (out.httpStatus >= 500 || TRANSIENT.has(out.error)) throw sendError('network', `Slack is unavailable (${out.error || `HTTP ${out.httpStatus}`})`);
  if (out.error === 'missing_scope') {
    throw refusal(sendError('plugin', `missing scope ${out.needed || ''}: add it under OAuth & Permissions and reinstall the Slack app`));
  }
  if (REFUSED.has(out.error)) throw refusal(sendError('plugin', `${out.error}: ${HINTS[out.error] || `${what} refused`}`));
  throw sendError('plugin', `${what} failed: ${out.error || `HTTP ${out.httpStatus}`}`);
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
  const threads = new Set();          // `<channel>:<ts>` of threads this bot opened for freeform chat
  const seen = new Set();             // `<channel>:<ts>` of messages already emitted (app_mention twins, redeliveries)
  const pendingModals = new Map();    // ref -> modal spec from controls this process sent (nicer labels; optional)
  const interactions = new Map();     // interactionId -> { chatId, userId, at } (ephemeral reply target)

  const chatIdOf = (channel, threadTs) => (threadTs && threads.has(`${channel}:${threadTs}`) ? `${channel}:${threadTs}` : channel);
  const admits = (chatId) => !channelFilter.length || channelFilter.includes(splitChatId(chatId).channel) || threads.has(chatId);
  const firstSight = (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > SEEN_KEEP) seen.delete(seen.values().next().value);
    return true;
  };
  async function rememberThread(id) {
    threads.delete(id); threads.add(id);
    while (threads.size > THREADS_KEEP) threads.delete(threads.values().next().value);
    try { await ctx.state.set(THREADS_STATE_KEY, [...threads]); } catch (err) { ctx.log('warn', `thread list not saved: ${err?.message || err}`); }
  }
  function rememberInteraction(evt) {
    const now = Date.now();
    for (const [k, v] of interactions) if (now - v.at > INTERACTION_TTL_MS) interactions.delete(k);
    interactions.set(evt.id, { chatId: evt.chatId, userId: evt.userId, at: now });
  }

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
    // Ack FIRST (3s deadline), then process — never after anything the host does (a model turn can take minutes).
    if (env.envelope_id) {
      try { ws?.send(JSON.stringify({ envelope_id: env.envelope_id })); }
      catch { /* socket died: the event redelivers on the next connection */ }
    }
    if (env.type === 'events_api') { handleEvent(env); return; }
    if (env.type === 'interactive') {
      handleInteractive(env.payload, env.envelope_id).catch((err) => ctx.log('warn', `interaction failed: ${err?.message || err}`));
    }
  }

  function handleEvent(env) {
    const ev = env.payload?.event;
    if (!ev || (ev.type !== 'message' && ev.type !== 'app_mention')) return;
    // Edits, deletes, joins and bot posts arrive as subtypes; a reply also sent to the channel is still a message.
    if (ev.subtype && ev.subtype !== 'thread_broadcast') return;
    if (ev.bot_id || !ev.user || ev.user === selfUserId) return;
    const channel = String(ev.channel || '');
    const threadTs = ev.thread_ts && ev.thread_ts !== ev.ts ? String(ev.thread_ts) : null;
    const chatId = chatIdOf(channel, threadTs);
    if (!admits(chatId)) return;
    if (ev.ts && !firstSight(`${channel}:${ev.ts}`)) return;
    const text = ev.text ?? '';
    ctx.emitMessage({
      chatId,
      userId: String(ev.user),
      text,
      meta: {
        platform: 'slack',
        messageId: ev.ts == null ? null : String(ev.ts),
        ts: ev.ts ?? null,
        threadTs: ev.thread_ts ?? null,
        team: env.payload?.team_id ?? null,
        // Only a 1:1 DM ("im") is not a group; channels and multi-person DMs are.
        isGroup: ev.channel_type !== 'im',
        // Freeform chat starts only from a top-level channel message that mentions THIS bot: a mention inside a
        // thread (Slack has no nested threads) or in a DM starts nothing. The host strips only `<@botId>`.
        mentionsBot: !threadTs && ev.channel_type !== 'im' && !!selfUserId && text.includes(`<@${selfUserId}>`),
        botId: selfUserId == null ? null : String(selfUserId),
      },
    });
  }

  async function handleInteractive(p, envelopeId) {
    const interactionId = String(p?.trigger_id || envelopeId || '').slice(0, 64);
    if (p?.type === 'view_submission') {
      const evt = toViewSubmission(p, interactionId);
      if (!evt || !admits(evt.chatId)) return;
      rememberInteraction(evt);
      ctx.emitInteraction(evt);
      return;
    }
    const hit = toBlockAction(p, interactionId, chatIdOf);
    if (!hit || !admits(hit.evt.chatId)) return;
    if (hit.opensModal) {
      // "Open a modal" is decided from the action_id alone; the spec is a nicety that a restart may have lost.
      const modal = pendingModals.get(hit.evt.ref) || fallbackModal(p, hit.actionId);
      const out = await slackApi(fetchFn, 'views.open', botToken, { trigger_id: p.trigger_id, view: renderModalView(hit.evt.ref, modal, hit.evt.chatId) });
      if (!out.ok) ctx.log('warn', `views.open failed: ${out.error || `HTTP ${out.httpStatus}`}`);
      return;   // the modal's SUBMIT is the interaction the host acts on
    }
    rememberInteraction(hit.evt);
    ctx.emitInteraction(hit.evt);
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

  /** One Web API write through the 429 ladder → the answer's `ts`. */
  const call = (method, body) => withRetryLadder(async () => {
    let out;
    try { out = await slackApi(fetchFn, method, botToken, body); }
    catch (err) { throw sendError('network', err?.message || String(err)); }
    return check(out, method) ?? { ts: out.ts == null ? null : String(out.ts) };
  }, _sleep);

  return {
    async start() {
      running = true;
      try {
        const saved = await ctx.state.get(THREADS_STATE_KEY);
        if (Array.isArray(saved)) for (const id of saved.slice(-THREADS_KEEP)) if (typeof id === 'string' && id.includes(':')) threads.add(id);
      } catch { /* no saved threads */ }
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

    /** Post (or with options.edit, update in place) one message. Controls render as Block Kit on the last chunk.
     *  options.thread opens the freeform thread off the given message: Slack threads need no create call, so its chat
     *  id is `<channel>:<fromMessageId>` and the first post is the reply that starts it. */
    async send(chatId, msg, options = {}) {
      const controls = Array.isArray(msg.controls) && msg.controls.length ? msg.controls : null;
      for (const c of controls || []) {
        if (c.kind === 'button' && c.modal) {
          pendingModals.set(c.ref, c.modal);
          if (pendingModals.size > MODALS_KEEP) pendingModals.delete(pendingModals.keys().next().value);
        }
      }
      const text = renderToMrkdwn(msg);
      if (options.edit) {
        // An edit is one message. Blocks are always sent (a section, plus the actions when there are controls): what
        // Slack renders then never depends on chat.update's text-vs-blocks rules, and spent buttons always go away.
        const first = splitText(text, MAX_SECTION_CHARS)[0];
        await call('chat.update', { channel: splitChatId(chatId).channel, ts: String(options.edit.messageId), text: first, blocks: renderBlocks(first, controls) });
        return { ok: true, messageIds: [String(options.edit.messageId)] };
      }
      let { channel, threadTs } = splitChatId(chatId);
      let threadId = null;
      if (options.thread) {
        threadTs = String(options.thread.fromMessageId);
        threadId = `${channel}:${threadTs}`;
        await rememberThread(threadId);   // before the first post: the owner can reply the moment it appears
      }
      const chunks = splitText(text, controls ? MAX_SECTION_CHARS : MAX_MESSAGE_CHARS);
      const messageIds = [];
      for (let k = 0; k < chunks.length; k++) {
        const last = k === chunks.length - 1;
        const out = await call('chat.postMessage', { channel, text: chunks[k], ...(threadTs ? { thread_ts: threadTs } : {}),
          ...(last && controls ? { blocks: renderBlocks(chunks[k], controls) } : {}) });
        messageIds.push(out?.ts || '');
      }
      return { ok: true, chunks: chunks.length, messageIds, ...(threadId ? { threadId } : {}) };
    },

    /** A private answer to one acknowledged interaction, seen only by the person who clicked. */
    async replyInteraction(interactionId, text) {
      const t = interactions.get(interactionId);
      if (!t || Date.now() - t.at > INTERACTION_TTL_MS) throw sendError('plugin', 'interaction expired');
      const { channel, threadTs } = splitChatId(t.chatId);
      let out;
      try {
        out = await slackApi(fetchFn, 'chat.postEphemeral', botToken,
          { channel, user: t.userId, text: String(text).slice(0, 2000), ...(threadTs ? { thread_ts: threadTs } : {}) });
      } catch (err) { throw sendError('network', err?.message || String(err)); }
      if (out.httpStatus === 429 || out.error === 'ratelimited') throw sendError('rate-limit', 'interaction reply failed: rate limited', out.retryAfterMs);
      if (!out.ok) throw sendError('plugin', `interaction reply failed: ${out.error || `HTTP ${out.httpStatus}`}`);
      return { ok: true };
    },

    /** Add or remove THIS bot's own reaction (a bot token can only remove its own) by Slack emoji name. Needs the
     *  reactions:write scope; refusals are `permanent`, 5xx/network are not, "already so" counts as done. */
    async react(chatId, messageId, emoji, on) {
      const name = reactionName(emoji);
      if (!name) throw refusal(sendError('plugin', `no Slack emoji name for the reaction ${emoji}`));
      const method = on ? 'reactions.add' : 'reactions.remove';
      const body = { channel: splitChatId(chatId).channel, timestamp: String(messageId), name };
      await withRetryLadder(async () => {
        let out;
        try { out = await slackApi(fetchFn, method, botToken, body, AbortSignal.timeout(REACT_TIMEOUT_MS)); }
        catch (err) { throw sendError('network', err?.message || String(err)); }
        const retry = check(out, method, on ? 'already_reacted' : 'no_reaction');
        // A long wait goes back to the host: its per-message chain sits it out in order (receipts.mjs).
        if (retry && retry.retryAfterMs > REACT_MAX_WAIT_MS) throw sendError('rate-limit', `Slack rate limit: retry in ${retry.retryAfterMs} ms`, retry.retryAfterMs);
        return retry;
      }, _sleep);
      return { ok: true };
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
