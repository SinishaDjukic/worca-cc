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
 * owns policy. It only drops other bots' messages and /cmd@name commands, and
 * skips edited_message (replayed edits are a command foot-gun).
 *
 * Interactive (v0.3, capabilities.interactive): a freeform conversation lives on a
 * surface this worker names (a DM, a forum topic, or a reply chain under the bot's
 * header: parseSurface), host controls become inline keyboards, a button that needs
 * typed text asks for a ForceReply answer, and the host's receipt marks become the
 * bot's own Telegram reaction (REACTION_FOR). README "Freeform chat".
 */

import { createHash } from 'node:crypto';
import { renderSegments, TELEGRAM_HTML_STYLE, escapeHtml } from '../lib/segments.mjs';
import { splitText, sendError, withRetryLadder } from '../lib/send-util.mjs';

const TELEGRAM_API = 'https://api.telegram.org';
const LONG_POLL_TIMEOUT_SEC = 25; // < the host's 30s ping interval
const MAX_MESSAGE_CHARS = 4096;
const STALE_AFTER_MS = (LONG_POLL_TIMEOUT_SEC * 2 + 20) * 1000;
// Telegram: "if there are no new updates for at least a week, the identifier of
// the next update will be chosen randomly" — a stored offset above it would
// confirm (discard) every new update unseen.
const CURSOR_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
// Sent on every poll: Telegram otherwise reuses whatever the LAST client set. Never message_reaction (it needs an
// admin bot, and worca never reads people's reactions) and never edited_* (replayed edits are a command foot-gun).
const ALLOWED_UPDATES = encodeURIComponent(JSON.stringify(['message', 'channel_post', 'callback_query']));

/** Mark a send error Telegram refused for good, so the host does not retry the same call. */
const refusal = (err) => Object.assign(err, { permanent: true });

/** Telegram's stand-in senders for anonymous group admins (GroupAnonymousBot) and channel posts (Channel_Bot): flagged
 *  is_bot, but a person acts through them, so their commands keep working. Fixed ids, not in the Bot API docs. */
const STAND_IN_SENDERS = new Set([1087968824, 136817688]);

/** worca's receipt marks (src/core/chat/receipts.mjs MARK, variation selectors dropped) → reactions Telegram accepts.
 *  ReactionTypeEmoji is a fixed list and none of the four marks is on it. */
export const REACTION_FOR = Object.freeze({ '⏳': '👀', '✅': '👌', '❌': '👎', '⏹': '🙈' });
const REACT_TIMEOUT_MS = 10 * 1000;   // one request; the 429 ladder adds its own waits
/** The longest 429 wait react() sits out itself; a longer one goes back to the host (receipts.mjs waits it out in
 *  order). Worst case 3 × 5 s waits + 4 × 10 s requests = 55 s, under channel-host's 60 s react timeout. */
const REACT_MAX_WAIT_MS = 5 * 1000;
/** The most a conversation start waits out 429s in all (topic, header post, pointer). channel-host's sendMessage RPC
 *  gives up after 15 s and binds nothing, so a start that succeeded later would leave its topic bound with no
 *  conversation: past this budget the start fails instead, inside openSurface's rollback. */
const START_WAIT_BUDGET_MS = 10 * 1000;

/** A press is answered (the client's spinner stops) when the host replies (its text becomes the toast), or without text
 *  after this long, so a slow host never leaves the spinner on. A later host reply is posted as a message. */
export const CALLBACK_ACK_MS = 2000;
const TOAST_MAX = 200;                       // answerCallbackQuery text: 0-200 characters
/** Select options per keyboard page; a longer select gets ◀ Back / More ▶. */
export const SELECT_PAGE = 8;
/** callback_data holds 1-64 bytes: `s:<ref>:<index>` fits refs up to 56 characters (host refs are 24); a longer ref
 *  rides as a stored `~<20>` alias. */
const INLINE_REF_MAX = 56;
const PROMPT_TTL_MS = 24 * 60 * 60 * 1000;   // a typed-answer prompt lives as long as a card control
const STALE_TEXT = 'This control is no longer valid. Use the newest message.';
const MODAL_FIELD_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
/** Bounded memories, newest kept. The persisted ones stay far under the host's 1 MiB state frame. */
const KEEP = { topics: 500, chains: 2000, prompts: 200, selects: 100, aliases: 500, keyboards: 300, modals: 300, inbound: 500, pending: 500, reactions: 2000 };
/** ctx.state keys of the memories a restart must keep (a reply in a known chain, a press on an older keyboard). */
const STATE_KEYS = { topics: 'freeformTopics', chains: 'freeformChains', prompts: 'freeformPrompts', selects: 'controlSelects', aliases: 'controlAliases' };

/** A Map that keeps only its newest `max` keys (setting a key again makes it the newest). */
class Recent extends Map {
  constructor(max) { super(); this.max = max; }
  set(key, value) {
    super.delete(key);
    super.set(key, value);
    while (this.size > this.max) super.delete(this.keys().next().value);
    return this;
  }
}

export function renderToHtml(msg) {
  return renderSegments(msg, TELEGRAM_HTML_STYLE);
}

/** Rendered-HTML chunk -> plain text (fallback when a chunk boundary broke a tag). */
export function htmlToPlain(html) {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

// ── ids ────────────────────────────────────────────────────────────────────────
// Telegram message ids are unique only inside a chat, so every id that leaves this worker names its chat:
// `<chat>:<id>` for a message, and for a conversation surface `<chat>` (a DM, or a group's own timeline),
// `<chat>:t<topic>` (a forum topic) or `<chat>:r<header message id>` (a reply chain under the bot's header).

export const messageKey = (chat, id) => `${chat}:${id}`;
export const topicSurface = (chat, topic) => `${chat}:t${topic}`;
export const chainSurface = (chat, anchor) => `${chat}:r${anchor}`;

/** A surface id → {chat, topic|null, anchor|null}, or null for anything this worker did not mint. */
export function parseSurface(chatId) {
  const m = /^(-?\d{1,20})(?::([tr])(\d{1,12}))?$/.exec(String(chatId ?? ''));
  if (!m) return null;
  return { chat: m[1], topic: m[2] === 't' ? Number(m[3]) : null, anchor: m[2] === 'r' ? Number(m[3]) : null };
}

/** `<chat>:<id>` → {chat, id}; a bare id takes its chat from the surface `chatId`; else null. */
export function parseMessageKey(key, chatId = '') {
  const s = String(key ?? '');
  const m = /^(-?\d{1,20}):(\d{1,12})$/.exec(s);
  if (m) return { chat: m[1], id: Number(m[2]) };
  const surface = parseSurface(chatId);
  return /^\d{1,12}$/.test(s) && surface ? { chat: surface.chat, id: Number(s) } : null;
}

// ── keyboards ──────────────────────────────────────────────────────────────────

const REF_PART_RE = /^(?:[A-Za-z0-9_-]{16,64}|~[A-Za-z0-9_-]{20})$/;
const CALLBACK_KIND = { b: 'button', m: 'modal', s: 'select', p: 'page' };

/** callback_data → {kind, ref, index?, page?} for our data, else null. `b:` a button, `m:` a button that asks for typed
 *  text (decided from the data alone, so a restarted worker still asks), `s:<ref>:<i>` a select option, `p:<ref>:<n>` a
 *  select page. `ref` may be a `~` alias (resolved by the worker). */
export function parseCallbackData(data) {
  const m = /^([bmsp]):([^:]{1,64})(?::(\d{1,3}))?$/.exec(String(data ?? ''));
  if (!m || !REF_PART_RE.test(m[2])) return null;
  const kind = CALLBACK_KIND[m[1]];
  const numbered = kind === 'select' || kind === 'page';
  if (numbered !== (m[3] !== undefined)) return null;
  const n = numbered ? Number(m[3]) : null;
  return { kind, ref: m[2], ...(kind === 'select' ? { index: n } : {}), ...(kind === 'page' ? { page: n } : {}) };
}

/** NormalizedMessage.controls → inline_keyboard rows: a select is a grid of its options (2 per row, SELECT_PAGE per
 *  page, ◀ Back / More ▶ when it holds more), buttons and links 2 per row, in control order. `pages[ref]` picks a
 *  select's page (clamped); `alias(ref)` maps a ref too long for callback_data. */
export function renderKeyboard(controls, { pages = {}, alias = (r) => r } = {}) {
  if (!Array.isArray(controls) || !controls.length) return [];
  const rows = [];
  let row = [];
  const flush = () => { if (row.length) { rows.push(row); row = []; } };
  const push = (b) => { row.push(b); if (row.length === 2) flush(); };
  for (const c of controls) {
    if (c.kind === 'select') {
      flush();
      const a = alias(c.ref);
      const last = Math.max(0, Math.ceil(c.options.length / SELECT_PAGE) - 1);
      const page = Math.min(Math.max(0, Number(pages[c.ref]) || 0), last);
      c.options.slice(page * SELECT_PAGE, (page + 1) * SELECT_PAGE)
        .forEach((o, k) => push({ text: o.label, callback_data: `s:${a}:${page * SELECT_PAGE + k}` }));
      flush();
      if (last > 0) {
        if (page > 0) push({ text: '◀ Back', callback_data: `p:${a}:${page - 1}` });
        if (page < last) push({ text: 'More ▶', callback_data: `p:${a}:${page + 1}` });
        flush();
      }
      continue;
    }
    if (c.kind === 'link') push({ text: c.label, url: c.url });
    else push({ text: c.label, callback_data: `${c.modal ? 'm' : 'b'}:${alias(c.ref)}` });
  }
  flush();
  return rows;
}

/** The keyboard minus its URL buttons (Telegram refuses a button whose address it will not open, e.g. localhost). */
function withoutUrlButtons(rows) {
  return rows.map((r) => r.filter((b) => !b.url)).filter((r) => r.length);
}

// ── mentions ───────────────────────────────────────────────────────────────────

/** The bot's own mentions in a message: an `@username` mention entity, or a text_mention of its id. */
export function ownMentions(m, { username, id }) {
  const t = typeof m?.text === 'string' ? m.text : '';
  const me = username ? `@${String(username).toLowerCase()}` : null;
  return (Array.isArray(m?.entities) ? m.entities : []).filter((e) => e && Number.isInteger(e.offset) && Number.isInteger(e.length)
    && ((e.type === 'mention' && me !== null && t.slice(e.offset, e.offset + e.length).toLowerCase() === me)
      || (e.type === 'text_mention' && id != null && String(e.user?.id) === String(id))));
}

/** Cut the given entities (UTF-16 offsets, as Telegram counts) out of the text; everything else stays as typed. */
const cutEntities = (text, ents) => [...ents].sort((a, b) => b.offset - a.offset)
  .reduce((s, e) => s.slice(0, e.offset) + s.slice(e.offset + e.length), text).trim();

/**
 * Inner factory with injectable I/O (old-code convention) — tests drive this
 * directly; the child entry point below applies the real defaults.
 */
export function createTelegramWorker(ctx, {
  fetchFn = globalThis.fetch,
  _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  setTimer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clearTimer = (t) => clearTimeout(t),
  callbackAckMs = CALLBACK_ACK_MS,
} = {}) {
  const token = String(ctx.config.botToken || '');
  const endpoint = (method) => `${TELEGRAM_API}/bot${token}/${method}`;
  let running = false;
  let botUsername = null;
  let botId = null;
  let lastPollOk = null;
  let staleTimer = null;
  let announced = 'connecting';
  let announcedDetail = null;

  // Persisted (STATE_KEYS): restart-safe routing and keyboards.
  const topics = new Recent(KEEP.topics);       // topic surface -> 1 (topics bound to a conversation)
  const chains = new Recent(KEEP.chains);       // message key -> chain surface it belongs to
  const prompts = new Recent(KEEP.prompts);     // prompt message key -> {ref, userId, surface, field, at}
  const selects = new Recent(KEEP.selects);     // select ref -> option values in the order shown
  const aliases = new Recent(KEEP.aliases);     // ~alias -> long ref
  const stores = { topics, chains, prompts, selects, aliases };
  const dirty = new Set();
  // Memory only.
  const tails = new Map();                      // chain surface -> newest message id in it (a restart falls back to the header)
  const keyboards = new Recent(KEEP.keyboards); // message key -> {controls, pages} (page turns)
  const modals = new Recent(KEEP.modals);       // ref -> modal spec (prompt wording; a fresh worker asks generically)
  const inbound = new Recent(KEEP.inbound);     // group mention key -> {forum, topic} (where a conversation starts)
  const pending = new Recent(KEEP.pending);     // interaction id -> {cq, answered, timer, surface, replyTo}
  const reactions = new Recent(KEEP.reactions); // message key -> the reaction this worker set last

  const setStatus = (state, detail) => {
    const d = detail ?? null;
    if (announced === state && announcedDetail === d) return;
    announced = state;
    announcedDetail = d;
    ctx.setStatus(state, d);
  };

  async function loadState() {
    for (const [name, map] of Object.entries(stores)) {
      try {
        const saved = await ctx.state.get(STATE_KEYS[name]);
        if (Array.isArray(saved)) for (const e of saved) if (Array.isArray(e) && e.length === 2 && typeof e[0] === 'string') map.set(e[0], e[1]);
      } catch { /* nothing saved */ }
    }
  }
  async function flushState() {
    for (const name of [...dirty]) {
      dirty.delete(name);
      try { await ctx.state.set(STATE_KEYS[name], [...stores[name]]); }
      catch (err) { ctx.log('warn', `${STATE_KEYS[name]} not saved: ${err?.message || err}`); }
    }
  }
  const mark = (name) => dirty.add(name);

  /** A ref as it rides callback_data: itself when short, else a stored alias. */
  function aliasFor(ref) {
    if (ref.length <= INLINE_REF_MAX) return ref;
    const a = `~${createHash('sha256').update(ref).digest('base64url').slice(0, 20)}`;
    if (aliases.get(a) !== ref) { aliases.set(a, ref); mark('aliases'); }
    return a;
  }
  const resolveRef = (r) => (r.startsWith('~') ? (aliases.get(r) ?? null) : r);

  // ── Bot API calls ─────────────────────────────────────────────────────────

  /** One Bot API POST through the 429 ladder → its `result`. Typed errors: a 429 past `maxWaitMs`, past what is left
   *  of a shared `budget` ({ left } ms, spent by every wait) and an exhausted ladder are rate-limit, 401 auth, 5xx and
   *  network errors network; any other refusal is plugin, with its HTTP `status` and Telegram's `description`. */
  async function call(method, body, { maxWaitMs = Infinity, timeoutMs = 0, budget = null } = {}) {
    const out = await withRetryLadder(async () => {
      let res;
      try {
        res = await fetchFn(endpoint(method), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
        });
      } catch (err) {
        throw sendError('network', err?.message || String(err));
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const ms = Math.ceil((data.parameters?.retry_after ?? 1) * 1000);
        if (ms > maxWaitMs || (budget && ms > budget.left)) throw sendError('rate-limit', `Telegram rate limit: retry in ${ms} ms`, ms);
        if (budget) budget.left -= ms;
        return { retryAfterMs: ms };
      }
      if (res.status === 401) throw sendError('auth', 'auth failed — check botToken');
      if (res.status >= 500) throw sendError('network', `Telegram is unavailable (HTTP ${res.status})`);
      if (!res.ok || data.ok === false) {
        const description = String(data.description || `HTTP ${res.status}`);
        throw Object.assign(sendError('plugin', `${method} failed: ${description}`), { status: res.status, description });
      }
      return { result: data.result };
    }, _sleep);
    return out.result;
  }

  /** A send-like call with the fixes Telegram makes necessary: a split that broke the HTML is resent once as plain
   *  text, a keyboard refused for its URL buttons (e.g. a localhost worca address) once without them. Refusals (400,
   *  403, 404) are permanent; a 403 on a send names the usual cause. */
  async function deliver(method, body, { budget = null } = {}) {
    let b = body;
    for (let fixes = 0; ; fixes++) {
      try {
        return await call(method, b, { budget });
      } catch (err) {
        if (![400, 403, 404].includes(err.status)) throw err;
        const why = String(err.description || '');
        const kb = b.reply_markup?.inline_keyboard;
        if (fixes < 2 && b.parse_mode && /can't parse entities/i.test(why)) {
          const { parse_mode: _html, ...rest } = b;
          b = { ...rest, text: htmlToPlain(b.text) };
          continue;
        }
        if (fixes < 2 && Array.isArray(kb) && kb.some((r) => r.some((x) => x.url)) && /BUTTON_URL_INVALID|wrong http url/i.test(why)) {
          ctx.log('warn', 'Telegram refused the Open in worca buttons (is "Worca address for links" an address Telegram opens?): sent without them');
          const rows = withoutUrlButtons(kb);
          const { reply_markup: _kb, ...rest } = b;
          b = rows.length || method !== 'sendMessage' ? { ...rest, reply_markup: { inline_keyboard: rows } } : rest;
          continue;
        }
        if (err.status === 403 && method === 'sendMessage') throw refusal(sendError('plugin', 'bot is blocked by this chat or was never started — open the chat and /start it'));
        throw refusal(err);
      }
    }
  }

  async function answerCallback(id, text = '') {
    try {
      await call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text: text.slice(0, TOAST_MAX) } : {}) },
        { maxWaitMs: REACT_MAX_WAIT_MS, timeoutMs: REACT_TIMEOUT_MS });
      return true;
    } catch (err) {
      ctx.log('warn', `answerCallbackQuery failed: ${err?.message || err}`);
      return false;
    }
  }

  // ── outbound ──────────────────────────────────────────────────────────────

  /** Rendered text + keyboard; remembers what a later press needs (option values, typed-answer wording). */
  function render(msg) {
    const controls = Array.isArray(msg.controls) ? msg.controls : [];
    for (const c of controls) {
      if (c.kind === 'select') { selects.set(c.ref, c.options.map((o) => o.value)); mark('selects'); }
      if (c.kind === 'button' && c.modal) modals.set(c.ref, c.modal);
    }
    const keyboard = renderKeyboard(controls, { alias: aliasFor });
    const hint = controls.find((c) => c.kind === 'select' && c.placeholder)?.placeholder;
    return { html: renderToHtml(msg) + (hint ? `\n\n<i>${escapeHtml(hint)}</i>` : ''), keyboard, controls };
  }

  /** Post into a surface: a topic gets its thread id, a chain replies to its newest message (or `replyTo`). The keyboard
   *  rides the last chunk; `budget` caps the 429 waits of all chunks (see call). Returns the posted message keys. */
  async function post(surfaceId, msg, { replyTo = null, budget = null } = {}) {
    const s = parseSurface(surfaceId);
    if (!s) throw refusal(sendError('plugin', `not a Telegram chat id: ${surfaceId}`));
    const { html, keyboard, controls } = render(msg);
    const chunks = splitText(html, MAX_MESSAGE_CHARS);
    const messageIds = [];
    for (let k = 0; k < chunks.length; k++) {
      const last = k === chunks.length - 1;
      const to = replyTo ?? (s.anchor != null ? (tails.get(surfaceId) ?? s.anchor) : null);
      const r = await deliver('sendMessage', {
        chat_id: s.chat, text: chunks[k], parse_mode: 'HTML',
        ...(s.topic != null ? { message_thread_id: s.topic } : {}),
        ...(to != null ? { reply_parameters: { message_id: to, allow_sending_without_reply: true } } : {}),
        ...(last && keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      }, { budget });
      const id = r?.message_id;
      const key = Number.isInteger(id) ? messageKey(s.chat, id) : '';
      messageIds.push(key);
      if (key && s.anchor != null) { chains.set(key, surfaceId); tails.set(surfaceId, id); mark('chains'); }
      if (key && last && controls.length) keyboards.set(key, { controls, pages: {} });
    }
    return { ok: true, chunks: chunks.length, messageIds };
  }

  /** Edit one posted message in place: the first chunk and the new keyboard (none = the buttons go). */
  async function edit(chatId, messageId, msg) {
    const k = parseMessageKey(messageId, chatId);
    if (!k) throw refusal(sendError('plugin', `message not found (${messageId})`));
    const key = messageKey(k.chat, k.id);
    const { html, keyboard, controls } = render(msg);
    try {
      await deliver('editMessageText', { chat_id: k.chat, message_id: k.id, text: splitText(html, MAX_MESSAGE_CHARS)[0],
        parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    } catch (err) {
      const why = String(err.description || err.message || '');
      if (/message to edit not found|message not found|MESSAGE_ID_INVALID/i.test(why)) throw refusal(sendError('plugin', `message not found (${messageId})`));
      if (!/message is not modified/i.test(why)) throw err;   // the same content: nothing to change
    }
    if (controls.length) keyboards.set(key, { controls, pages: {} }); else keyboards.delete(key);
    return { ok: true, messageIds: [key] };
  }

  /** Start a conversation off a message (send options.thread) → the surface it lives on, as `threadId`. */
  async function openSurface(chatId, msg, thread) {
    const s = parseSurface(chatId);
    const from = parseMessageKey(thread.fromMessageId, chatId);
    if (!s || s.topic != null || s.anchor != null || !from || from.chat !== s.chat) {
      throw refusal(sendError('plugin', `cannot start a conversation from ${thread.fromMessageId} in ${chatId}`));
    }
    const budget = { left: START_WAIT_BUDGET_MS };
    // A DM (a positive chat id) is itself the conversation: one per person, continued by every message.
    if (!s.chat.startsWith('-')) {
      const r = await post(s.chat, msg, { replyTo: from.id, budget });
      return { ...r, threadId: s.chat };
    }
    const origin = inbound.get(messageKey(s.chat, from.id));
    if (!origin) throw refusal(sendError('plugin', 'the plugin restarted and no longer knows where this conversation starts: mention the bot again'));
    if (origin.forum) {
      let topic = origin.topic;
      const created = topic == null;
      if (created) {
        let t;
        try {
          t = await call('createForumTopic', { chat_id: s.chat, name: String(thread.name).slice(0, 128) }, { budget });
        } catch (err) {
          if ([400, 403].includes(err.status)) throw refusal(sendError('plugin', `cannot open a topic: make the bot an admin with the Manage topics right (${err.description})`));
          throw err;
        }
        topic = t?.message_thread_id;
        if (!Number.isInteger(topic)) throw sendError('plugin', 'createForumTopic returned no topic');
      }
      const surface = topicSurface(s.chat, topic);
      const wasBound = topics.has(surface);
      topics.set(surface, 1);
      mark('topics');
      await flushState();   // before the first post: the owner can reply the moment it appears
      let r;
      try {
        r = await post(surface, msg, created ? { budget } : { replyTo: from.id, budget });
      } catch (err) {
        // No conversation starts here: an unbound topic must route as its plain chat again (commands, a new mention).
        if (!wasBound) { topics.delete(surface); mark('topics'); await flushState(); }
        throw err;
      }
      if (created) await pointToTopic(s.chat, from.id, topic, thread.name, budget);
      return { ...r, threadId: surface };
    }
    const r = await post(s.chat, msg, { replyTo: from.id, budget });
    const keys = r.messageIds.filter(Boolean);
    const head = keys.length ? parseMessageKey(keys[0]) : null;
    if (!head) throw sendError('plugin', 'sendMessage returned no message id');
    const surface = chainSurface(s.chat, head.id);
    for (const key of [messageKey(s.chat, from.id), ...keys]) chains.set(key, surface);
    tails.set(surface, parseMessageKey(keys.at(-1)).id);
    mark('chains');
    return { ...r, threadId: surface };
  }

  /** A mention in a forum's General opened a new topic: say where, under the mention (best effort). */
  async function pointToTopic(chat, replyTo, topic, name, budget) {
    const link = /^-100\d+$/.test(chat) ? `https://t.me/c/${chat.slice(4)}/${topic}` : null;
    const label = escapeHtml(String(name).slice(0, 128));
    try {
      await deliver('sendMessage', { chat_id: chat, parse_mode: 'HTML',
        text: `Continuing in the topic ${link ? `<a href="${link}">${label}</a>` : `<b>${label}</b>`}.`,
        reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }, { budget });
    } catch (err) {
      ctx.log('warn', `topic pointer not sent: ${err?.message || err}`);
    }
  }

  // ── inbound ───────────────────────────────────────────────────────────────

  /** The surface a person's message belongs to: a bound topic, a known reply chain (the message joins it), else the
   *  chat itself (a DM, an unbound topic or General, a plain group message). */
  function surfaceOf(m) {
    const chat = String(m.chat.id);
    if (m.chat.type === 'private' || m.chat.type === 'channel') return chat;
    if (m.chat.is_forum === true) {
      const t = m.is_topic_message === true && Number.isInteger(m.message_thread_id) ? topicSurface(chat, m.message_thread_id) : null;
      return t && topics.has(t) ? t : chat;
    }
    const r = m.reply_to_message?.message_id;
    const chain = Number.isInteger(r) ? chains.get(messageKey(chat, r)) : undefined;
    if (!chain) return chat;
    if (Number.isInteger(m.message_id) && m.message_id > 0) {
      chains.set(messageKey(chat, m.message_id), chain);
      tails.set(chain, m.message_id);
      mark('chains');
    }
    return chain;
  }

  /** The surface of one of the bot's OWN messages (a pressed keyboard). */
  function surfaceOfOwn(msg) {
    const chat = String(msg.chat.id);
    if (msg.chat.type === 'private') return chat;
    const t = msg.is_topic_message === true && Number.isInteger(msg.message_thread_id) ? topicSurface(chat, msg.message_thread_id) : null;
    if (t && topics.has(t)) return t;
    return chains.get(messageKey(chat, msg.message_id)) || chat;
  }

  /** The presser's reply to their ForceReply prompt is the answer (an interaction, not a message). */
  function takePromptAnswer(m, chat, text, userId) {
    const r = m.reply_to_message?.message_id;
    if (!Number.isInteger(r) || !text.trim() || text.startsWith('/')) return false;
    const key = messageKey(chat, r);
    const p = prompts.get(key);
    if (!p || p.userId !== userId) return false;
    prompts.delete(key);
    mark('prompts');
    if (now() - p.at > PROMPT_TTL_MS) return false;   // expired: an ordinary message
    const id = `r${chat}_${m.message_id}`;
    pending.set(id, { cq: null, answered: true, timer: null, surface: p.surface, replyTo: m.message_id });
    ctx.emitInteraction({ id, chatId: p.surface, userId, ref: p.ref, kind: 'modal', fields: { [p.field]: text.slice(0, 4000) },
      meta: { platform: 'telegram', messageId: messageKey(chat, m.message_id), username: m.from?.username ?? null } });
    return true;
  }

  async function handleMessage(m) {
    if (m.from?.is_bot === true && !STAND_IN_SENDERS.has(m.from.id)) return;   // other bots (Telegram hides them anyway)
    const chat = String(m.chat.id);
    const raw = typeof m.text === 'string' ? m.text : '';
    const userId = String(m.from?.id ?? m.chat.id);
    if (takePromptAnswer(m, chat, raw, userId)) return;
    let text = raw;
    // Group etiquette: /cmd@other_bot is not for us; /cmd@us loses the suffix.
    const cmdAt = /^(\/[A-Za-z0-9_-]+)@(\S+)([\s\S]*)$/.exec(raw);
    const mine = cmdAt ? [] : ownMentions(m, { username: botUsername, id: botId });
    if (cmdAt) {
      if (botUsername && cmdAt[2].toLowerCase() !== botUsername.toLowerCase()) return;
      text = cmdAt[1] + cmdAt[3];
    } else if (mine.length) {
      text = cutEntities(raw, mine);
    }
    const isPrivate = m.chat.type === 'private';
    const mentionsBot = m.chat.type !== 'channel' && (isPrivate || mine.length > 0);
    const id = Number.isInteger(m.message_id) && m.message_id > 0 ? messageKey(chat, m.message_id) : null;
    const surface = surfaceOf(m);
    if (id && mentionsBot && !isPrivate) {
      inbound.set(id, { forum: m.chat.is_forum === true,
        topic: m.is_topic_message === true && Number.isInteger(m.message_thread_id) ? m.message_thread_id : null });
    }
    ctx.emitMessage({
      chatId: surface,
      userId,
      text,
      meta: {
        platform: 'telegram',
        messageId: id,
        chatType: m.chat.type,
        chatTitle: m.chat.title ?? null,
        username: m.from?.username ?? null,
        isGroup: !isPrivate,
        // Freeform chat: a DM always addresses the bot; in a group only an @mention of THIS bot does (cut above).
        mentionsBot,
        botId: botId == null ? null : String(botId),
      },
    });
  }

  async function handleCallback(cq) {
    const id = String(cq.id || '');
    const parsed = parseCallbackData(cq.data);
    const msg = cq.message;
    // Not ours, no message to act on, or a bot: stop the spinner, nothing else.
    if (!parsed || !msg?.chat || cq.from?.is_bot === true) { await answerCallback(id); return; }
    const ref = resolveRef(parsed.ref);
    if (!ref) { await answerCallback(id, STALE_TEXT); return; }
    const chat = String(msg.chat.id);
    const key = messageKey(chat, msg.message_id);
    if (parsed.kind === 'page') { await turnPage(id, chat, msg.message_id, key, ref, parsed.page); return; }
    const surface = surfaceOfOwn(msg);
    if (parsed.kind === 'modal') {
      await answerCallback(id);
      await askForText({ surface, ref, from: cq.from, replyTo: msg.message_id });
      return;
    }
    let values;
    if (parsed.kind === 'select') {
      const v = selects.get(ref)?.[parsed.index];
      if (typeof v !== 'string') { await answerCallback(id, STALE_TEXT); return; }
      values = [v];
    }
    const p = { cq: id, answered: false, timer: null, surface, replyTo: msg.message_id };
    p.timer = setTimer(() => { if (!p.answered) { p.answered = true; answerCallback(id); } }, callbackAckMs);
    pending.set(id, p);
    ctx.emitInteraction({ id, chatId: surface, userId: String(cq.from?.id ?? ''), ref, kind: parsed.kind, ...(values ? { values } : {}),
      meta: { platform: 'telegram', messageId: key, username: cq.from?.username ?? null } });
  }

  async function turnPage(id, chat, messageId, key, ref, page) {
    const kb = keyboards.get(key);
    if (!kb || !kb.controls.some((c) => c.kind === 'select' && c.ref === ref)) { await answerCallback(id, STALE_TEXT); return; }
    const pages = { ...kb.pages, [ref]: page };
    try {
      await deliver('editMessageReplyMarkup', { chat_id: chat, message_id: messageId,
        reply_markup: { inline_keyboard: renderKeyboard(kb.controls, { pages, alias: aliasFor }) } });
      keyboards.set(key, { controls: kb.controls, pages });
    } catch (err) {
      if (!/message is not modified/i.test(String(err?.description || err?.message || ''))) ctx.log('warn', `page turn failed: ${err?.message || err}`);
    }
    await answerCallback(id);
  }

  /** A button that needs typed text (a Discord modal elsewhere): a ForceReply prompt that names the presser. */
  async function askForText({ surface, ref, from, replyTo }) {
    const s = parseSurface(surface);
    if (!s) return;
    const spec = modals.get(ref);
    const field = Array.isArray(spec?.fields) ? spec.fields[0] : null;
    const fieldId = typeof field?.id === 'string' && MODAL_FIELD_ID_RE.test(field.id) ? field.id : 'text';
    const label = String(field?.label || 'Your answer');
    const who = `<a href="tg://user?id=${encodeURIComponent(String(from?.id ?? ''))}">${escapeHtml(String(from?.first_name || from?.username || 'You'))}</a>`;
    const title = spec?.title ? `<b>${escapeHtml(String(spec.title))}</b>\n` : '';
    try {
      const r = await deliver('sendMessage', {
        chat_id: s.chat, parse_mode: 'HTML',
        text: `${title}${who}, reply to this message with your answer (${escapeHtml(label)}).`,
        ...(s.topic != null ? { message_thread_id: s.topic } : {}),
        reply_parameters: { message_id: replyTo, allow_sending_without_reply: true },
        reply_markup: { force_reply: true, selective: true, input_field_placeholder: label.slice(0, 64) },
      });
      if (!Number.isInteger(r?.message_id)) return;
      const key = messageKey(s.chat, r.message_id);
      prompts.set(key, { ref, userId: String(from?.id ?? ''), surface, field: fieldId, at: now() });
      mark('prompts');
      if (s.anchor != null) { chains.set(key, surface); tails.set(surface, r.message_id); mark('chains'); }
    } catch (err) {
      ctx.log('warn', `answer prompt not sent: ${err?.message || err}`);
    }
  }

  async function handleUpdate(update) {
    if (update.callback_query) { await handleCallback(update.callback_query); return; }
    const m = update.message ?? update.channel_post; // edited_* deliberately skipped
    if (m && m.chat) await handleMessage(m);
  }

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
        const res = await fetchFn(`${endpoint('getUpdates')}?offset=${cursor}&timeout=${pollTimeout}&allowed_updates=${ALLOWED_UPDATES}`, {
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
            try { await handleUpdate(update); }
            catch (err) { ctx.log('warn', `update ${update.update_id} not handled: ${err?.message || err}`); }
          }
          await flushState();
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
      await loadState();
      const res = await fetchFn(endpoint('getMe'), { signal: ctx.shutdownSignal });
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
      for (const p of pending.values()) if (p.timer) clearTimer(p.timer);
    },

    /** options: {} (post), {edit:{messageId}} (in place), {thread:{fromMessageId, name}} (start a conversation). */
    async send(chatId, msg, options = {}) {
      const o = options || {};
      const r = o.edit ? await edit(chatId, o.edit.messageId, msg)
        : o.thread ? await openSurface(chatId, msg, o.thread)
          : await post(chatId, msg);
      await flushState();
      return r;
    },

    /** The host's answer to a press: the toast while the press is still unanswered (≤ 200 characters), else a message
     *  replying to the pressed message (or to the typed answer). */
    async replyInteraction(interactionId, text) {
      const p = pending.get(interactionId);
      if (!p) throw sendError('plugin', 'interaction expired');
      const t = String(text ?? '');
      if (!p.answered) {
        p.answered = true;
        clearTimer(p.timer);
        if (t.length <= TOAST_MAX && await answerCallback(p.cq, t)) return { ok: true };
        if (t.length > TOAST_MAX) await answerCallback(p.cq);
      }
      await post(p.surface, { title: null, severity: 'info', body: [{ kind: 'text', value: t }] }, { replyTo: p.replyTo });
      await flushState();
      return { ok: true };
    },

    /** Set (`on`) or clear THIS bot's one reaction on a message; nobody else's reaction is ever touched. */
    async react(chatId, messageId, emoji, on) {
      const k = parseMessageKey(messageId, chatId);
      if (!k) throw refusal(sendError('plugin', `message not found (${messageId})`));
      const shown = REACTION_FOR[String(emoji).replace(/️/g, '')] ?? String(emoji);
      const key = messageKey(k.chat, k.id);
      // One bot reaction per message: an add replaces the old one, so a remove of a mark that a later add already
      // replaced must not clear the newer one.
      if (!on && reactions.has(key) && reactions.get(key) !== shown) return { ok: true };
      try {
        await call('setMessageReaction', { chat_id: k.chat, message_id: k.id, reaction: on ? [{ type: 'emoji', emoji: shown }] : [] },
          { maxWaitMs: REACT_MAX_WAIT_MS, timeoutMs: REACT_TIMEOUT_MS });
      } catch (err) {
        // An emoji this chat does not allow, a deleted message, no access: the same call fails again.
        if ([400, 403, 404].includes(err.status)) throw refusal(sendError('plugin', `reaction refused: ${err.description}`));
        throw err;
      }
      if (on) reactions.set(key, shown); else reactions.delete(key);
      return { ok: true };
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
