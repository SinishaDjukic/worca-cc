/**
 * Microsoft Teams channel worker — Bot Framework, no SDK
 * (chat-connectivity-design.md §4.9). The one webhook-ingress channel: inbound
 * Activities arrive as host-forwarded webhook frames (the host's tokened
 * /api/ingress/teams route), THIS worker validates the Bot Framework JWT
 * (channel/jwt.mjs) on every request — messages and invokes alike — and
 * answers the HTTP status (and, for an invoke, its body); outbound
 * replies/proactive messages POST Activities to the conversation's serviceUrl
 * with an AAD client-credentials token (channel/token.mjs).
 *
 * Proactive messages reach SEEN conversations only: conversation references
 * are captured from every inbound activity into host-persisted state (one per
 * channel or chat); notifying a conversation the bot has never seen fails with
 * an actionable "message the bot once" error. Bot Framework retries webhooks,
 * so inbound is deduplicated on activity.id (in-memory LRU).
 *
 * Interactive (freeform chat): a channel post that @mentions the bot opens a
 * conversation in that post's reply chain (`<channel>;messageid=<rootId>`).
 * Controls render as Adaptive Card 1.5 elements (Action.Execute buttons with an
 * Action.Submit fallback, Input.ChoiceSet + Choose, inline Input.Text +
 * submit); clicks arrive as `invoke` (adaptiveCard/action) or, from older
 * clients, as a message whose `value` is the same data. The worker answers the invoke itself, holding it briefly for the
 * host's notice. Teams bots cannot react to messages: the ⏳ receipt becomes a
 * typing indicator (Teams shows it in personal and group chats only).
 */

import { createHash } from 'node:crypto';
import { toPlainText } from '../lib/markdown.mjs';
import { renderSegments } from '../lib/segments.mjs';
import { splitText, sendError, withRetryLadder } from '../lib/send-util.mjs';
import { createJwtValidator } from './jwt.mjs';
import { createTokenProvider } from './token.mjs';
import { createFileRefs, readCapped, releaseBody, tooBigError } from '../lib/file-refs.mjs';

const SEEN_LRU_MAX = 200;
const MAX_CONVERSATIONS = 200;
/** One card's text. Teams refuses activities over ~28 KB; 6000 UTF-16 units stay under it even for 3-byte scripts. */
const MAX_CARD_TEXT = 6000;
const REQUEST_TIMEOUT_MS = 10 * 1000;
/** How long an invoke waits for the host's notice before answering without it (clarify: about 3-4 s). */
export const INVOKE_HOLD_MS = 3500;
/** A notice that arrives later is posted in the chat, for as long as the host may still send one. */
const NOTICE_TTL_MS = 14 * 60 * 1000;
const PENDING_MAX = 500;
const NAMES_MAX = 500;
/** Teams shows a typing indicator for about 3 s: repeat it while ⏳ is on, never longer than TYPING_MAX_MS. */
const TYPING_EVERY_MS = 3000;
const TYPING_MAX_MS = 10 * 60 * 1000;
const MSGID = ';messageid=';
const EXEC_VERB = 'worca';
const REF_RE = /^[A-Za-z0-9_-]{16,64}$/;
const FIELD_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
const KINDS = new Set(['button', 'select', 'modal']);
const ACTION_STYLE = { primary: 'positive', success: 'positive', danger: 'destructive' };
const ATTACHMENTS_MAX = 10;
const EDIT_WAIT_BUDGET_MS = 10 * 1000;   // every 429 wait of one status edit: under the host's 15 s send RPC
const IMAGE_EXT = Object.freeze({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' });
const SHAREPOINT_NOTE = 'a SharePoint or OneDrive file link: open it in Teams (worca does not download SharePoint files)';
const OFF_HOST_NOTE = 'an image on a host worca does not send the bot\'s token to';

/** What the worker itself answers (no host round trip): a click it cannot hand on, or the hold running out. */
export const NOTICE = Object.freeze({
  received: 'Got it. worca answers in this conversation.',
  pickFirst: 'Pick an option first, then press Choose.',
  stale: 'This control is no longer valid. Use the newest message.',
});

/** Mark a send error the platform refused for good, so the host does not retry the same message. */
const refusal = (err) => Object.assign(err, { permanent: true });

/** Markdown-ish segments -> plain text (Teams TextBlock markdown is
 *  inconsistent across clients; plain text is the honest v1 — old
 *  renderAsTeamsCard did the same). */
const PLAIN_STYLE = {
  title: (t) => `${toPlainText(t)}\n`,
  markdown: (v) => toPlainText(v),
  bold: (v) => v,
  code: (v) => v,
  code_block: (v) => `\n${v}\n`,
  link: (v, seg) => (seg.href ? `${v} (${seg.href})` : v),
  text: (v) => v,
};

const SEVERITY_ICON = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '🔴' };

/** `19:x@thread.tacv2;messageid=123` → { base: '19:x@thread.tacv2', root: '123' }; other ids have no root. */
export function splitConversationId(id) {
  const s = String(id || '');
  const i = s.indexOf(MSGID);
  return i < 0 ? { base: s, root: null } : { base: s.slice(0, i), root: s.slice(i + MSGID.length) || null };
}

/** The chat id worca sees. A channel's TOP-LEVEL post (its conversation id names the post itself as the root) is the
 *  channel, so Allowed conversation IDs and notifications use one stable id. A reply is its post's reply chain
 *  (`<channel>;messageid=<rootId>`). Personal and group chats are their conversation id. */
export function chatIdOf(activity) {
  const full = String(activity?.conversation?.id || '');
  const { base, root } = splitConversationId(full);
  return root && activity.type === 'message' && root === String(activity.id ?? '') ? base : full;
}

const seenAt = (ref) => Date.parse(ref?.lastSeen ?? '') || 0;

/** v0.2.0 stored a channel's reference under each post's full `<channel>;messageid=<root>` id, without a
 *  conversationType. Re-key those to the channel (the newest reference wins) and mark them as a channel, so a
 *  stored id from before the upgrade still reaches its channel and never gets a typing indicator. */
export function migrateConversations(all) {
  for (const id of Object.keys(all)) {
    const { base, root } = splitConversationId(id);
    if (!root) continue;
    const ref = { ...all[id], conversationType: all[id]?.conversationType ?? 'channel' };
    delete all[id];
    if (!all[base] || seenAt(ref) > seenAt(all[base])) all[base] = ref;
  }
  return all;
}

/** The reply chain of the post `rootId` in a channel. */
export const replyChainId = (channelId, rootId) => `${splitConversationId(channelId).base}${MSGID}${rootId}`;

/** Did a bot (another one, or this one) send it? Teams marks bots with role "bot"; this bot is the recipient. */
export function isFromBot(activity) {
  const from = activity?.from || {};
  return from.role === 'bot' || (!!from.id && from.id === activity?.recipient?.id);
}

/** The mention entities that name THIS bot (the activity's recipient). */
export function botMentions(activity) {
  const me = String(activity?.recipient?.id || '');
  return (Array.isArray(activity?.entities) ? activity.entities : [])
    .filter((e) => e && e.type === 'mention' && me !== '' && String(e.mentioned?.id || '') === me);
}

/** Remove the bot's own `<at>…</at>` mention text; other people's mentions keep their name. `mentions` null (the
 *  activity has no mention entity at all, e.g. an old client) drops every `<at>` tag, as v0.2 did. Line breaks stay. */
export function stripMentions(text, mentions = null) {
  let t = String(text || '');
  if (Array.isArray(mentions)) {
    for (const m of mentions) if (typeof m?.text === 'string' && m.text) t = t.split(m.text).join('');
    t = t.replace(/<at>(.*?)<\/at>/g, '$1');
  } else {
    t = t.replace(/<at>.*?<\/at>/g, '');
  }
  return t.split('\n').map((line) => line.replace(/[^\S\n]+/g, ' ').trim()).join('\n').trim();
}

/** An Action.Execute (an invoke) with an Action.Submit fallback (a message with `value`) for Teams clients without
 *  Universal Actions: both carry the same data, so both paths parse alike (parseSubmit). */
function executeAction(title, ref, kind, ix, style, withInputs) {
  const data = { 'w-ref': ref, 'w-kind': kind, 'w-ix': ix };
  const common = { title, data, associatedInputs: withInputs ? 'auto' : 'none', ...(ACTION_STYLE[style] ? { style: ACTION_STYLE[style] } : {}) };
  return { type: 'Action.Execute', verb: EXEC_VERB, ...common, fallback: { type: 'Action.Submit', ...common } };
}

/** NormalizedMessage.controls → Adaptive Card body elements. Buttons and links: ActionSets of ≤ 5. A select: an
 *  Input.ChoiceSet (`w<ix>-choice`) and a Choose button. A button with a `modal`: its fields inline as Input.Text
 *  (`w<ix>-<fieldId>`) and a submit button with the button's label (clarify: no dialogs). Input ids carry the
 *  control's index so two text boxes on one card never share an id. No input is `isRequired`: Teams would then
 *  block every other button of the card; the host checks the answer. */
export function renderControls(controls) {
  if (!Array.isArray(controls) || !controls.length) return [];
  const out = [];
  let actions = [];
  const flush = () => { if (actions.length) { out.push({ type: 'ActionSet', actions }); actions = []; } };
  controls.forEach((c, ix) => {
    if (c.kind === 'select') {
      flush();
      out.push({ type: 'Input.ChoiceSet', id: `w${ix}-choice`, style: 'compact', ...(c.placeholder ? { placeholder: c.placeholder } : {}),
        choices: c.options.map((o) => ({ title: o.description ? `${o.label} — ${o.description}` : o.label, value: o.value })) });
      out.push({ type: 'ActionSet', actions: [executeAction('Choose', c.ref, 'select', ix, 'primary', true)] });
      return;
    }
    if (c.kind === 'button' && c.modal) {
      flush();
      out.push({ type: 'Container', separator: true, items: [
        ...c.modal.fields.map((f) => ({ type: 'Input.Text', id: `w${ix}-${f.id}`, label: f.label,
          isMultiline: f.style === 'paragraph', maxLength: f.maxLength })),
        { type: 'ActionSet', actions: [executeAction(c.label, c.ref, 'modal', ix, c.style, true)] },
      ] });
      return;
    }
    actions.push(c.kind === 'link' ? { type: 'Action.OpenUrl', title: c.label, url: c.url }
      : executeAction(c.label, c.ref, 'button', ix, c.style, false));
    if (actions.length === 5) flush();
  });
  flush();
  return out;
}

function cardFor({ title = null, severity = 'info', text = '', controls = null }) {
  const body = [];
  if (title) {
    body.push({ type: 'TextBlock', size: 'Medium', weight: 'Bolder', wrap: true, text: `${SEVERITY_ICON[severity] || ''} ${title}`.trim() });
  }
  body.push({ type: 'TextBlock', wrap: true, text });
  const extra = renderControls(controls);
  body.push(...extra);
  return {
    contentType: 'application/vnd.microsoft.card.adaptive',
    // Teams runs Action.Execute only on a 1.5 card; a card without controls stays at 1.2 (widest client support).
    content: { type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: extra.length ? '1.5' : '1.2', body },
  };
}

const textOf = (msg) => renderSegments({ ...msg, title: null }, PLAIN_STYLE);

/** NormalizedMessage -> AdaptiveCard activity attachment (ported shape
 *  from the pre-1.0 webhook_out renderAsTeamsCard), controls included. */
export function renderCard(msg) {
  return cardFor({ title: msg.title, severity: msg.severity, text: textOf(msg), controls: msg.controls });
}

/** An invoke's `action.data` (or an Action.Submit message's `value`) → our interaction fields, or null if not ours. */
export function parseSubmit(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const ref = data['w-ref'];
  const kind = data['w-kind'];
  const ix = data['w-ix'];
  if (typeof ref !== 'string' || !REF_RE.test(ref) || !KINDS.has(kind) || !Number.isInteger(ix) || ix < 0 || ix > 9) return null;
  if (kind === 'select') {
    const v = data[`w${ix}-choice`];
    return { ref, kind, values: typeof v === 'string' && v !== '' && v.length <= 100 ? [v] : [] };
  }
  if (kind === 'modal') {
    const fields = {};
    const prefix = `w${ix}-`;
    for (const [k, v] of Object.entries(data)) {
      if (!k.startsWith(prefix)) continue;
      const id = k.slice(prefix.length);
      if (id !== 'choice' && FIELD_ID_RE.test(id)) fields[id] = String(v ?? '').slice(0, 4000);
    }
    return { ref, kind, fields };
  }
  return { ref, kind };
}

/** A platform activity id as an interaction id (≤ 64 chars; a longer one is hashed, stable across redeliveries). */
export function interactionIdOf(activityId) {
  const s = String(activityId || '');
  if (s && s.length <= 64) return s;
  return `h:${createHash('sha256').update(s).digest('hex').slice(0, 40)}`;
}

/** The HTTP answer to an adaptiveCard/action invoke: a message only the clicker sees. */
export const invokeReply = (text) => ({
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  bodyB64: Buffer.from(JSON.stringify({ statusCode: 200, type: 'application/vnd.microsoft.activity.message', value: String(text).slice(0, 2000) })).toString('base64'),
});

/** The only hosts the bot's Bot Framework token is ever sent to for a file: the conversation's own serviceUrl host
 *  (vouched by the inbound JWT's serviceurl claim), the Bot Connector's attachment host and Teams' image store. */
export function teamsFileHostOk(contentUrl, serviceUrl) {
  let u;
  try { u = new URL(String(contentUrl)); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port !== '') return false;
  const h = u.hostname.toLowerCase();
  let svc = null;
  try { svc = new URL(String(serviceUrl)).hostname.toLowerCase(); } catch { /* none */ }
  return h === svc || h === 'smba.trafficmanager.net' || h.endsWith('.asm.skype.com');
}
const isSharePoint = (url) => { try { return /(^|\.)sharepoint\.com$/i.test(new URL(String(url)).hostname); } catch { return false; } };

export function createTeamsWorker(ctx, {
  fetchFn = globalThis.fetch,
  _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  invokeHoldMs = INVOKE_HOLD_MS,
  typingEveryMs = TYPING_EVERY_MS,
} = {}) {
  const { appId, appPassword, tenantType, tenantId } = ctx.config;
  const validator = createJwtValidator({ appId, fetchFn, now });
  const tokens = createTokenProvider({ appId, appPassword, tenantType, tenantId, fetchFn, now });
  const seenActivityIds = [];
  const pending = new Map();   // interactionId -> { chatId, at, resolve|null } (a held invoke has a resolve)
  const names = new Map();     // user id (aadObjectId) -> display name, for `<@id>` in host notices
  const typing = new Map();    // `${chatId}\0${messageId}` -> interval timer
  const loggedTyping = new Set();
  const fileRefs = createFileRefs({ now });

  /** An activity's files: inline images on a vouched host → refs; SharePoint / OneDrive files → listed with a note;
   *  cards are not files. A `text/html` attachment is the message body again: only its `<img src>` on a vouched host
   *  count (Teams may put a channel's pasted images only there); any other <img> there (emoji, stickers) is skipped. */
  function filesOf(activity) {
    const out = [];
    const urls = new Set();
    let n = 0;
    const image = (url, type, name) => {
      if (urls.has(url)) return;
      urls.add(url);
      n += 1;
      const fileName = String(name || `image-${n}${IMAGE_EXT[type] || '.png'}`).slice(0, 255);
      const contentType = Object.hasOwn(IMAGE_EXT, type) ? type : null;
      out.push(teamsFileHostOk(url, activity.serviceUrl)
        ? { name: fileName, contentType, size: 0, ref: fileRefs.put({ url, serviceUrl: activity.serviceUrl }) }
        : { name: fileName, contentType: null, size: 0, unavailable: OFF_HOST_NOTE });
    };
    const list = (Array.isArray(activity.attachments) ? activity.attachments : []).filter((a) => a && typeof a === 'object');
    for (const a of list) {
      if (out.length >= ATTACHMENTS_MAX) break;
      const type = String(a.contentType || '').toLowerCase();
      const url = typeof a.contentUrl === 'string' ? a.contentUrl : '';
      if (type.startsWith('image/') && url) image(url, type, a.name);
      else if (type === 'application/vnd.microsoft.teams.file.download.info' || type === 'reference' || isSharePoint(url)) {
        out.push({ name: String(a.name || 'file').slice(0, 255) || 'file', contentType: null, size: 0, unavailable: SHAREPOINT_NOTE });
      }
    }
    for (const a of list) {
      if (String(a.contentType || '').toLowerCase() !== 'text/html' || typeof a.content !== 'string') continue;
      for (const m of a.content.slice(0, 200_000).matchAll(/<img\b[^>]*?\ssrc="([^"]{1,2048})"/gi)) {
        if (out.length >= ATTACHMENTS_MAX) break;
        const url = m[1].replace(/&amp;/g, '&');
        if (teamsFileHostOk(url, activity.serviceUrl)) image(url, '', null);
      }
    }
    return out;
  }

  /** Repeat a typing activity under `key` until stopped (TYPING_MAX_MS at most, or a refused repeat). */
  async function startTyping(key, chatId, ref) {
    if (!(await sendTyping(chatId, ref))) return;
    const until = now() + TYPING_MAX_MS;
    const timer = setInterval(async () => {
      if (!typing.has(key)) return;
      if (now() > until || !(await sendTyping(chatId, ref))) stopTyping(key);
    }, typingEveryMs);
    timer.unref?.();
    typing.set(key, timer);
  }

  const conversations = async () => migrateConversations((await ctx.state.get('conversations')) || {});
  /** The stored reference for a chat id: a reply chain uses its channel's reference. */
  const refFor = async (chatId) => (await conversations())[splitConversationId(chatId).base] || null;

  let convChain = Promise.resolve(); // serialize read-modify-write on the conversations bag
  function rememberConversation(activity) {
    const work = async () => {
      const conv = activity.conversation;
      if (!conv?.id || !activity.serviceUrl) return;
      const all = await conversations();
      all[splitConversationId(conv.id).base] = {
        serviceUrl: activity.serviceUrl,
        tenantId: activity.channelData?.tenant?.id ?? null,
        channelId: activity.channelId ?? 'msteams',
        botId: activity.recipient?.id ?? null,
        user: activity.from ? { id: activity.from.id, name: activity.from.name ?? null, aadObjectId: activity.from.aadObjectId ?? null } : null,
        isGroup: conv.isGroup === true || conv.conversationType === 'channel',
        conversationType: conv.conversationType ?? null,
        lastSeen: new Date(now()).toISOString(),
      };
      const ids = Object.keys(all);
      if (ids.length > MAX_CONVERSATIONS) {
        // Numeric compare on Date.parse — total, tolerant of missing/garbage
        // lastSeen (sorts oldest), with an id tiebreaker for determinism.
        const ts = (id) => seenAt(all[id]);
        ids.sort((a, b) => ts(a) - ts(b) || (a < b ? -1 : a > b ? 1 : 0));
        const evicted = ids.slice(0, ids.length - MAX_CONVERSATIONS);
        for (const id of evicted) delete all[id];
        ctx.log('warn', `conversation store capped at ${MAX_CONVERSATIONS}; evicted ${evicted.length} least-recently-seen (proactive notify to an evicted chat needs the user to message the bot once)`);
      }
      await ctx.state.set('conversations', all);
    };
    convChain = convChain.then(work, work);
    return convChain;
  }

  /** One Bot Framework call through the 429 ladder. Refusals that fail again (400, 403, 404) are `permanent`; 5xx and
   *  network errors are transient. `once`: a 429 is thrown back instead of waited out (notices, typing). */
  async function call(method, serviceUrl, path, body, { what = 'post activity', once = false, budget = null } = {}) {
    const url = `${serviceUrl.endsWith('/') ? serviceUrl : `${serviceUrl}/`}${path}`;
    let refreshed = false;
    return withRetryLadder(async () => {
      const token = await tokens.get();
      let res;
      try {
        res = await fetchFn(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw sendError('network', err?.message || String(err));
      }
      if (res.status === 429) {
        const retryAfterMs = (Number(res.headers?.get?.('retry-after')) || 2) * 1000;
        if (once || (budget && retryAfterMs > budget.left)) throw sendError('rate-limit', `Teams rate limit: retry in ${retryAfterMs} ms`, retryAfterMs);
        if (budget) budget.left -= retryAfterMs;
        return { retryAfterMs };
      }
      if (res.status === 401) {
        if (!refreshed) { refreshed = true; tokens.invalidate(); return { retryAfterMs: 1 }; } // one forced refresh
        throw sendError('auth', 'Bot Framework rejected the AAD token — check appId/appPassword/tenant');
      }
      if (res.status === 403) throw refusal(sendError('plugin', 'forbidden: the bot is not a member of this conversation'));
      if (res.status === 404) throw refusal(sendError('plugin', `conversation or message not found (${what})`));
      if (res.status >= 500) throw sendError('network', `Bot Framework is unavailable (HTTP ${res.status})`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const e = sendError('plugin', `${what} failed: ${data.error?.message || `HTTP ${res.status}`}`);
        throw res.status === 400 ? refusal(e) : e;
      }
      return { data: await res.json().catch(() => ({})) };
    }, _sleep);
  }

  const activitiesPath = (conversationId, activityId = null) =>
    `v3/conversations/${encodeURIComponent(conversationId)}/activities${activityId ? `/${encodeURIComponent(activityId)}` : ''}`;

  async function postText(chatId, text, opts) {
    const ref = await refFor(chatId);
    if (!ref) throw refusal(sendError('plugin', `conversation ${chatId} not seen yet`));
    await call('POST', ref.serviceUrl, activitiesPath(chatId), { type: 'message', from: { id: ref.botId || appId }, textFormat: 'plain', text }, opts);
  }

  /** Host notices name a person Discord-style as `<@id>`: Teams shows the name the bot last saw for that id. */
  const humanize = (text) => String(text).replace(/<@([^>\s]{1,64})>/g, (_m, id) => names.get(id) || 'the person who started this conversation');

  function remember(map, key, value, max) {
    map.delete(key);
    map.set(key, value);
    while (map.size > max) map.delete(map.keys().next().value);
  }

  function prunePending() {
    const t = now();
    for (const [k, v] of pending) if (t - v.at > NOTICE_TTL_MS && !v.resolve) pending.delete(k);
  }

  /** The interaction to hand on, or the notice the worker answers itself (nothing picked, not our control). */
  function interactionOf(activity, data) {
    const parsed = parseSubmit(data);
    if (!parsed) return { notice: NOTICE.stale };
    if (parsed.kind === 'select' && !parsed.values.length) return { notice: NOTICE.pickFirst };
    const from = activity.from || {};
    return { evt: {
      id: interactionIdOf(activity.id), chatId: chatIdOf(activity), userId: String(from.aadObjectId || from.id || ''), ...parsed,
      meta: { platform: 'teams', messageId: activity.replyToId ?? null, name: from.name ?? null },
    } };
  }

  /** adaptiveCard/action: emit, then wait up to invokeHoldMs for the host's notice and answer with it (the clicker
   *  alone sees it); a notice that comes later is posted in the chat by replyInteraction. */
  async function handleInvoke(activity) {
    if (activity.name !== 'adaptiveCard/action') return { statusCode: 200 };
    const action = activity.value?.action || {};
    const { evt, notice } = action.verb === EXEC_VERB ? interactionOf(activity, action.data) : { notice: NOTICE.stale };
    if (!evt) return invokeReply(notice);
    prunePending();
    const text = await new Promise((resolve) => {
      // Ref'd on purpose: the hold is bounded and cleared by the answer or stop(), and an unref'd timer would let the
      // event loop drain while the invoke's HTTP answer is still pending.
      const timer = setTimeout(() => { const p = pending.get(evt.id); if (p) p.resolve = null; resolve(null); }, invokeHoldMs);
      remember(pending, evt.id, { chatId: evt.chatId, at: now(), resolve: (t) => { clearTimeout(timer); resolve(t); } }, PENDING_MAX);
      ctx.emitInteraction(evt);
    });
    return invokeReply(text ?? NOTICE.received);
  }

  /** Action.Submit (older clients): a message whose `value` is our data. No invoke to answer, so notices are posted. */
  async function handleSubmit(activity) {
    const { evt, notice } = interactionOf(activity, activity.value);
    if (!evt) {
      await postText(chatIdOf(activity), notice, { what: 'notice', once: true }).catch((err) => ctx.log('warn', `notice not posted: ${err?.message || err}`));
      return;
    }
    prunePending();
    remember(pending, evt.id, { chatId: evt.chatId, at: now(), resolve: null }, PENDING_MAX);
    ctx.emitInteraction(evt);
  }

  function stopTyping(key) {
    const timer = typing.get(key);
    if (timer) { clearInterval(timer); typing.delete(key); }
  }

  /** One typing activity; false (logged once per error text) when Teams refused it. */
  async function sendTyping(chatId, ref) {
    try {
      await call('POST', ref.serviceUrl, activitiesPath(chatId), { type: 'typing', from: { id: ref.botId || appId } }, { what: 'typing', once: true });
      return true;
    } catch (err) {
      const text = String(err?.message || err);
      if (!loggedTyping.has(text)) {
        if (loggedTyping.size >= 50) loggedTyping.clear();
        loggedTyping.add(text);
        ctx.log('warn', `typing indicator failed: ${text}`);
      }
      return false;
    }
  }

  return {
    async start() {
      // Webhook-ingress channel: "connected" = outbound credentials work; the
      // inbound path is proven by the first delivered activity.
      try {
        await tokens.get();
        ctx.setStatus('connected');
      } catch (err) {
        ctx.setStatus('disconnected', `${err.message} — inbound webhooks still validate, outbound is down`);
      }
      return { identity: appId || null };
    },

    async stop() {
      for (const key of [...typing.keys()]) stopTyping(key);
      for (const p of pending.values()) p.resolve?.(null);
      pending.clear();
    },

    /** Inbound webhook frame from the host ingress. Returns the HTTP answer. */
    async handleWebhook({ headers, bodyB64 }) {
      let activity;
      try { activity = JSON.parse(Buffer.from(bodyB64 || '', 'base64').toString('utf8')); }
      catch { return { statusCode: 400 }; }
      if (!activity || typeof activity !== 'object') return { statusCode: 400 };

      // Every request, invokes included: the JWT is the only proof an activity came from Bot Framework.
      if (ctx.mock !== true) {
        const check = await validator.validate(headers?.authorization, activity?.serviceUrl);
        if (!check.ok) {
          ctx.log('warn', `rejected inbound activity: ${check.reason}`);
          return { statusCode: 401 };
        }
      }

      // Bot Framework retries non-2xx AND can redeliver: dedupe on activity.id.
      if (activity.id) {
        if (seenActivityIds.includes(activity.id)) return activity.type === 'invoke' ? invokeReply(NOTICE.received) : { statusCode: 200 };
        seenActivityIds.push(activity.id);
        if (seenActivityIds.length > SEEN_LRU_MAX) seenActivityIds.shift();
      }

      await rememberConversation(activity);
      if (isFromBot(activity)) return { statusCode: 200 };
      const from = activity.from || {};
      const userId = String(from.aadObjectId || from.id || '');
      if (userId && typeof from.name === 'string' && from.name) remember(names, userId, from.name, NAMES_MAX);

      if (activity.type === 'invoke') return handleInvoke(activity);
      if (activity.type === 'message' && parseSubmit(activity.value)) { await handleSubmit(activity); return { statusCode: 200 }; }
      if (activity.type === 'message') {
        const chatId = chatIdOf(activity);
        const hasMentions = Array.isArray(activity.entities) && activity.entities.some((e) => e?.type === 'mention');
        const mine = botMentions(activity);
        const attachments = filesOf(activity);
        ctx.emitMessage({
          chatId,
          userId,
          text: stripMentions(activity.text, hasMentions ? mine : null),
          meta: {
            platform: 'teams',
            activityId: activity.id ?? null,
            messageId: activity.id ?? null,
            serviceUrl: activity.serviceUrl ?? null,
            tenantId: activity.channelData?.tenant?.id ?? null,
            name: from.name ?? null,
            replyToId: activity.id ?? null,
            // Only a "personal" conversation is 1:1; group chats and channels are groups.
            isGroup: activity.conversation?.conversationType !== 'personal',
            // Freeform chat starts only from a channel's top-level post that @mentions this bot (clarify: channels only).
            // Only a channel post has a `;messageid=` root, so "the chat id is not the conversation id" means exactly that.
            mentionsBot: chatId !== String(activity.conversation?.id || '') && mine.length > 0,
          },
          ...(attachments.length ? { attachments } : {}),
        });
      }
      // conversationUpdate etc. only feed the conversation store.
      return { statusCode: 200 };
    },

    /** Outbound: a new message, the first post in a post's reply chain (`thread`) or an in-place card update (`edit`). */
    async send(chatId, msg, options = {}) {
      const ref = await refFor(chatId);
      if (!ref) {
        throw refusal(sendError('plugin', `conversation ${chatId} not seen yet — the user must message the bot once (or @mention it in the channel) before worca-cc can notify it`));
      }
      const from = { id: ref.botId || appId };
      const chunks = splitText(textOf(msg), MAX_CARD_TEXT);
      if (options.edit) {
        // The first chunk updates the card, controls replace the old ones. A live status edit carries the WHOLE reply:
        // the rest follows as new posts in the same chat, and the controls ride the last one. One budget caps every
        // 429 wait of the edit and its posts.
        const id = options.edit.messageId;
        const budget = { left: EDIT_WAIT_BUDGET_MS };
        await call('PUT', ref.serviceUrl, activitiesPath(chatId, id),
          { type: 'message', id, from, attachments: [cardFor({ title: msg.title, severity: msg.severity, text: chunks[0], controls: chunks.length === 1 ? msg.controls : null })] },
          { what: 'update activity', budget });
        const messageIds = [String(id)];
        for (let k = 1; k < chunks.length; k++) {
          const out = await call('POST', ref.serviceUrl, activitiesPath(chatId), {
            type: 'message', from, conversation: { id: chatId },
            attachments: [cardFor({ severity: msg.severity, text: chunks[k], controls: k === chunks.length - 1 ? msg.controls : null })],
          }, { budget });
          messageIds.push(String(out?.data?.id || ''));
        }
        return { ok: true, messageIds };
      }
      let target = chatId;
      let threadId = null;
      if (options.thread) {
        // A reply chain needs no creation call: posting to `<channel>;messageid=<root>` replies under that post.
        if (ref.conversationType !== 'channel') throw refusal(sendError('plugin', 'freeform chat runs in Teams channels only'));
        target = replyChainId(chatId, options.thread.fromMessageId);
        threadId = target;
      }
      const messageIds = [];
      for (let k = 0; k < chunks.length; k++) {
        const last = k === chunks.length - 1;
        const out = await call('POST', ref.serviceUrl, activitiesPath(target), {
          type: 'message', from, conversation: { id: target },
          attachments: [cardFor({ title: k === 0 ? msg.title : null, severity: msg.severity, text: chunks[k], controls: last ? msg.controls : null })],
        });
        messageIds.push(String(out?.data?.id || ''));
      }
      return { ok: true, chunks: chunks.length, messageIds, ...(threadId ? { threadId } : {}) };
    },

    /** The host's notice for one interaction: the held invoke's answer (only the clicker sees it), else a post. */
    async replyInteraction(interactionId, text) {
      const p = pending.get(interactionId);
      pending.delete(interactionId);
      if (!p || (!p.resolve && now() - p.at > NOTICE_TTL_MS)) throw sendError('plugin', 'interaction expired');
      const out = humanize(text);
      if (p.resolve) { p.resolve(out); return { ok: true }; }
      await postText(p.chatId, out, { what: 'notice', once: true });
      return { ok: true };
    },

    /** Teams bots cannot react to a message. ⏳ on starts a typing indicator, repeated until ⏳ off (Teams shows it in
     *  personal and group chats only, so channels send nothing); every other mark is a no-op. Never throws. */
    async react(chatId, messageId, emoji, on) {
      if (emoji !== '⏳') return { ok: true };
      const key = `${chatId}\u0000${messageId}`;
      stopTyping(key);
      if (!on) return { ok: true };
      const ref = await refFor(chatId);
      if (!ref || ref.conversationType === 'channel') return { ok: true };
      await startTyping(key, chatId, ref);
      return { ok: true };
    },

    /** Start (`on`) or stop the typing indicator in one conversation: a typing activity repeated until stopped in a
     *  personal or group chat. Teams shows no bot typing in channels, so a channel (where freeform chat runs) sends
     *  nothing. */
    async typing(chatId, on) {
      const key = `typing:${chatId}`;
      stopTyping(key);
      if (!on) return { ok: true };
      const ref = await refFor(chatId);
      if (!ref) throw refusal(sendError('plugin', `conversation ${chatId} not seen yet`));
      if (ref.conversationType === 'channel') return { ok: true };
      await startTyping(key, chatId, ref);
      return { ok: true };
    },

    /** The bytes of one inline image this worker announced, fetched with the Bot Framework token from a vouched host
     *  only, with no redirects. Errors never carry the URL or the token. */
    async fetchFile(ref, { maxBytes, signal } = {}) {
      const e = fileRefs.get(ref);
      if (!e) throw refusal(sendError('plugin', 'file reference expired: send the image again'));
      if (!teamsFileHostOk(e.url, e.serviceUrl)) throw refusal(sendError('plugin', OFF_HOST_NOTE));
      const token = await tokens.get();
      let res;
      try { res = await fetchFn(e.url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', ...(signal ? { signal } : {}) }); }
      catch { throw sendError('network', 'image download failed'); }
      if (res.status === 429) { releaseBody(res); const ms = (Number(res.headers?.get?.('retry-after')) || 2) * 1000; throw sendError('rate-limit', `Teams rate limit: retry in ${ms} ms`, ms); }
      if (res.status === 401 || res.status === 403 || res.status === 404) { releaseBody(res); throw refusal(sendError('plugin', `Teams refused the image download (HTTP ${res.status})`)); }
      if (!res.ok) { releaseBody(res); throw sendError(res.status >= 500 ? 'network' : 'plugin', `image download failed (HTTP ${res.status})`); }
      const got = await readCapped(res, maxBytes);
      if (got.tooBig) throw tooBigError(maxBytes);
      return { data: got.buf, contentType: res.headers?.get?.('content-type') || null };
    },
  };
}

/** Channel-worker child entry point. */
export function createChannelWorker(ctx) {
  return createTeamsWorker(ctx);
}

/** Doctor: prove the AAD credentials (cannot prove Teams-side wiring without
 *  an inbound message — say so). */
export async function validateConfig(config, { fetchFn = globalThis.fetch } = {}) {
  const errors = [];
  if (!config?.appId) errors.push({ field: 'appId', message: 'appId (Microsoft App ID) is required' });
  if (!config?.appPassword) errors.push({ field: 'appPassword', message: 'appPassword (client secret) is required' });
  if (config?.tenantType === 'single-tenant' && !config?.tenantId) {
    errors.push({ field: 'tenantId', message: 'tenantId is required for single-tenant apps' });
  }
  if (!config?.ingressToken) errors.push({ field: 'ingressToken', message: 'ingressToken is required (any long random string — it becomes part of the webhook URL)' });
  if (errors.length) return { ok: false, errors };
  try {
    await createTokenProvider({ ...config, fetchFn }).get();
  } catch (err) {
    const field = err.kind === 'auth' ? 'appPassword' : null;
    return { ok: false, errors: [{ field, message: err.message }] };
  }
  return {
    ok: true,
    identity: config.appId,
    note: 'AAD credentials verified. Inbound wiring (Azure bot messaging endpoint + tunnel) is proven by the first message the bot receives.',
  };
}
