// src/core/chat/conversation-bridge.mjs — freeform chat (D1–D15): authorize, bind a platform thread to an Ask thread,
// turn messages into Ask turns, clicks into the SAME card/run services the browser uses, and deliver what the Ask
// thread holds. Every service is injected (ui/server.mjs supplies the real ones); nothing here runs a model or a tool.
import { parseCommand } from './parser.mjs';
import { createAllowlistGuard, parseIdList, parseChatMembers } from './allowlist.mjs';
import { TokenBucket } from './rate-limiter.mjs';
import * as conv from './conversations.mjs';
import { renderMessageParts, runBodyFromCard, isNativeRunCard, NO_LINK_HINT } from './card-render.mjs';
import { WORKING, INTERRUPTED, DONE_EMPTY, STATUS_TICK_MS, activityOf, statusText, statusMessage } from './live-status.mjs';

const { HEADER_CONTROL_TTL_MS } = conv;
export const FREEFORM_RATE_PER_MIN = 6;
/** The same refusal to the same person in the same chat is posted at most once per this window (review m5). */
export const NOTICE_EVERY_MS = 10 * 60 * 1000;
/** Card actions whose success leaves the card open (D8): their refs are reusable and nothing is retired. */
const REUSABLE_CARD_ACTIONS = new Set(['changes']);
/** Run-start refusals that ask the browser user to confirm something (D4 row 1): never answered from chat. */
const BROWSER_CONFIRM_CODES = new Set(['sync-diverged', 'sync-fetch-failed', 'reason_required', 'team_total', 'engine-refused', 'preset-broken']);
const BOT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

const MENTION_PLATFORMS = new Set(['discord', 'slack']);

export const SAY = {
  notMember: 'You are not set up for worca chat here. Ask the worca operator to add your chat user ID under Freeform chat members.',
  /** `<@id>` is the mention syntax of Discord and Slack; other platforms (Telegram, Teams) would show it raw, so they
   *  get the plain sentence. */
  notOwner: (owner, platform = 'discord') => (MENTION_PLATFORMS.has(platform)
    ? `Only <@${owner}> can act on this conversation.`
    : 'Only the person who started this conversation can act on it.'),
  stale: 'This control is no longer valid. Use the newest message.',
  busy: 'Chat is still replying. Try again once the answer lands.',
  rate: 'Slow down a little: too many messages in a minute. Nothing was sent to the model.',
  budget: 'Total cost limit reached — nothing was sent to the model. Raise the limit in worca Settings.',
  off: 'Freeform chat is turned off for this channel.',
  /** `url` = the conversation's Open in worca link (null when no worcaUrl is configured: say how to get there). */
  confirmInWorca: (url) => `This needs a confirmation in worca (branch sync, team policy or engine consent) — nothing was started. ${url ? `Confirm it in worca: ${url}` : NO_LINK_HINT}`,
  failed: (e) => `That did not work: ${String(e || 'unknown error').slice(0, 300)}`,
  gate: (e) => `${String(e || 'This chat cannot start here.').slice(0, 400)} Open in worca to switch the chat engine or add your key — nothing was sent to the model.`,
  answeredNoReply: (e) => `Answer saved, but the reply could not start: ${String(e || 'unknown error').slice(0, 300)}`,
  done: 'Done — the message will update shortly.',
  changesSent: 'Sent your change request. The proposal stays open.',
  /** Live status (discord-chat 0.5.0): what a "working" message becomes when no reply will be edited into it. */
  answerSaved: '✅ Answer saved.',
  answeredBelow: '✅ Answered below.',
  statusMoved: '⏹️ This reply stays in worca: a new conversation started.',
};

/** Remove only THIS bot's mention tokens (`<@id>` / `<@!id>`). Other mentions, e-mail addresses, newlines and
 *  markdown reach the model exactly as typed (M2). */
export function stripBotMention(text, botId) {
  let t = String(text ?? '');
  if (typeof botId === 'string' && BOT_ID_RE.test(botId)) t = t.replace(new RegExp(`<@!?${botId}>[ \\t]?`, 'g'), '');
  return t.trim();
}

/** The plugin setting "Read recent history when a conversation starts" (historyOnStart: off|5|10|20|50) → how many
 *  messages; anything else is 0 (off), never more than HISTORY_MAX. */
export const HISTORY_MAX = 50;
export function historyCountOf(v) {
  const n = Number(String(v ?? '').trim());
  return Number.isInteger(n) && n > 0 ? Math.min(n, HISTORY_MAX) : 0;
}

/** The chat context an inbound message carries (channel-protocol.mjs validated it): its files and the message it
 *  replies to; history is read (or taken from the frame) only when a conversation starts. */
export function inboundOf(msg) {
  return {
    attachments: Array.isArray(msg?.attachments) ? msg.attachments : [],
    replyTo: msg?.replyTo && typeof msg.replyTo === 'object' ? msg.replyTo : null,
    history: [],
    notes: [],
  };
}
const hasContext = (x) => !!x && (x.attachments.length > 0 || !!x.replyTo || x.history.length > 0 || x.notes.length > 0);

/** A run-start / card refusal → the one line the person sees, and whether it is a real failure (❌ on the message) or
 *  a refusal whose text is the answer (no mark): busy, a credential/engine gate, a browser confirmation. `links` is
 *  deps.linksFor(threadId): a browser confirmation names the conversation's Open in worca link when there is one. */
export function cardRefusal(r, links = null) {
  const b = (r && r.body) || {};
  if (r && r.status === 409 && /turn in flight/.test(b.error || '')) return { text: SAY.busy, failed: false };
  if (b.code === 'engine-broker' || b.code === 'credential-missing') return { text: SAY.gate(b.error), failed: false };
  if (BROWSER_CONFIRM_CODES.has(b.code) || b.needsPolicyAck === true) return { text: SAY.confirmInWorca((links && links.thread) || null), failed: false };
  return { text: SAY.failed(b.error), failed: true };
}
export function refusalText(r, links = null) { return cardRefusal(r, links).text; }

/** A turn-start refusal (startAskTurn or the extracted send-route gates) → its line (D14) and kind, as cardRefusal.
 *  The global turn cap (429) is a rate limit: a refusal, not a failure. */
export function turnRefusal(r) {
  if (r && (r.code === 'engine-broker' || r.code === 'credential-missing')) return { text: SAY.gate(r.error), failed: false };
  if (r && r.status === 403 && /cost limit/i.test(r.error || '')) return { text: SAY.budget, failed: false };
  if (r && r.status === 409 && /in flight/.test(r.error || '')) return { text: SAY.busy, failed: false };
  if (r && r.status === 429) return { text: SAY.failed(r.error), failed: false };
  return { text: SAY.failed(r && r.error), failed: true };
}
export function turnRefusalText(r) { return turnRefusal(r).text; }

/** A successful card apply whose event turn failed (D10, review m9): the cards route answers 200 with
 *  `turn: {error, status}` (failedEventTurn). null when the follow-up started, was deferred, or there was none. */
export function followUpError(r) {
  const t = r && r.body && r.body.turn;
  return t && typeof t === 'object' && typeof t.error === 'string' && t.error ? t.error : null;
}

/** deps: { host: {sendMessage, replyInteraction, history?}, ask: {createThread, deleteThread, getThread, listMessages, findCard,
 *  initialScope (async), threadScope, scopeLabel (async), scopeOptions (async → {options, hidden}), refreshProjects (async), projectDirOf,
 *  startTurn, applyCard, takeDeferredReply, startRun,
 *  switchScope, stopTurn}, readConfig(plugin, channelId), linksFor(threadId), watch(threadId), now(), log(level,msg),
 *  ratePerMin?, receipts?: {ack(target), settle(target, outcome)} (createReceipts; absent = no reactions),
 *  liveStatus?(plugin, channelId) → true when the channel shows a live status message per turn (host.typing optional),
 *  setInterval?/clearInterval? (tests) } */
const NOT_FOUND = /not found/i;
/** A ref minter that mints nothing: parts are rendered to learn their names (reconcile, receipts). */
const DRY_ISSUE = () => 'x'.repeat(24);
const NO_RECEIPTS = { ack() {}, settle() {} };
/** The inbound message a reaction belongs to, or null when the platform gave no id. */
const markOf = (plugin, channelId, chatId, messageId) => (messageId ? { plugin, channelId, chatId: String(chatId), messageId: String(messageId) } : null);
/** sweepStreamingMessages' notice (src/core/ask/store.mjs): the reply a restart cut off. */
const RESTART_NOTICE = 'interrupted by restart';
const cutByRestart = (m) => m.status === 'error' && Array.isArray(m.blocks) && m.blocks.some((b) => b && b.kind === 'notice' && b.text === RESTART_NOTICE);
const idsOf = (r) => r?.detail?.messageIds || r?.messageIds || [];

export function createConversationBridge(deps) {
  const buckets = new Map();
  const rate = deps.ratePerMin ?? FREEFORM_RATE_PER_MIN;
  const bucketFor = (userId) => {
    let b = buckets.get(userId);
    if (!b) { b = new TokenBucket(rate, { now: deps.now }); buckets.set(userId, b); }
    return b;
  };
  const log = deps.log || (() => {});
  const receipts = deps.receipts || NO_RECEIPTS;
  // Accepted messages still waiting for their reply, per conversation (memory only, clarify answer): each settles once
  // the assistant row it waits for is finished and fully delivered (checkReceipts, run after every reconcile pass).
  // A typed answer whose follow-up was queued has no row yet: it waits by card id (takeDeferredReply).
  const waiting = new Map();   // conversationId -> [{ mark, assistantId|null, cardId|null }]
  // review m5: refusals are throttled per (chat, user, reason); the map holds the last post time.
  const noticed = new Map();
  function noticeDue(chatId, userId, reason) {
    const key = `${chatId}\u0000${userId}\u0000${reason}`;
    const t = deps.now();
    const last = noticed.get(key);
    if (last !== undefined && t - last < NOTICE_EVERY_MS) return false;
    noticed.set(key, t);
    if (noticed.size > 5000) for (const [k, v] of noticed) if (t - v >= NOTICE_EVERY_MS) noticed.delete(k);
    return true;
  }

  // ── live status messages (discord-chat 0.5.0) ───────────────────────────
  // A turn's "⏳ Working on it…" message, edited with the elapsed time and the activity while the turn runs and edited
  // into the reply's first part when it lands. One record per status message (several can be live: a busy refusal
  // posts its own and ends it at once). phase: 'starting' (the turn is being started: delivery of a new reply waits, so
  // the reply cannot land as a new message before the status knows its row), 'deferred' (a typed card answer whose
  // follow-up is queued: waits by card id) or 'bound' (waits for assistantId). The row in chat_deliveries survives a
  // restart; sweepStatuses finishes any it finds without a record here.
  const statuses = new Map();   // platform message id -> status record
  const setI = deps.setInterval || globalThis.setInterval;
  const clearI = deps.clearInterval || globalThis.clearInterval;
  const liveOn = (c) => { try { return deps.liveStatus?.(c.plugin, c.channelId) === true; } catch { return false; } };
  const activeIn = (c) => [...statuses.values()].filter((st) => st.c.id === c.id);

  function typing(c, on) {
    if (typeof deps.host.typing !== 'function') return;
    Promise.resolve().then(() => deps.host.typing({ plugin: c.plugin, channelId: c.channelId, chatId: c.chatId, on }))
      .catch((err) => log('warn', `typing ${on ? 'start' : 'stop'} failed: ${err?.message || err}`));
  }

  /** Post the status message and start its ticker and the typing indicator; null when the channel has no live status
   *  or the post failed (the turn then runs exactly as before). */
  async function beginStatus(c) {
    if (!liveOn(c)) return null;
    let id;
    try { id = idsOf(await send(c, statusMessage(WORKING))).at(-1); }
    catch (err) { log('warn', `status message not posted: ${err?.message || err}`); return null; }
    if (!id) return null;
    const st = { c, id: String(id), phase: 'starting', assistantId: null, cardId: null, startedAt: deps.now(), activity: null,
      shown: WORKING, done: false, lost: false, used: false, editing: false, pauseUntil: 0, chain: Promise.resolve(), timer: null };
    try { conv.recordStatus({ conversationId: c.id, platformMessageId: st.id }, { now: deps.now() }); }
    catch (err) { log('warn', `status message not recorded: ${err?.message || err}`); }
    statuses.set(st.id, st);
    typing(c, true);
    st.timer = setI(() => tickStatus(st), STATUS_TICK_MS);
    st.timer?.unref?.();
    return st;
  }

  /** One progress edit: only when the text changed, never while one is in flight or a 429 asked to wait. */
  function tickStatus(st) {
    if (st.done || st.lost || st.editing || deps.now() < st.pauseUntil) return;
    const text = statusText({ elapsedMs: deps.now() - st.startedAt, activity: st.activity });
    if (text === st.shown) return;
    st.editing = true;
    st.chain = st.chain.then(async () => {
      if (st.done) return;
      try { await send(st.c, statusMessage(text), { edit: { messageId: st.id } }); st.shown = text; }
      catch (err) {
        if (Number.isFinite(err?.retryAfterMs)) st.pauseUntil = deps.now() + err.retryAfterMs;
        else if (err?.permanent) st.lost = true;          // deleted or no access: no more progress; the reply posts anew
        log('warn', `status update failed: ${err?.message || err}`);
      }
    }).finally(() => { st.editing = false; });
  }

  /** The Ask turn's live frames (ask-block, ask-delta), forwarded by the server: the activity the next tick shows. */
  function progress(c, frame) {
    const activity = activityOf(frame);
    if (!activity || !c) return;
    for (const st of activeIn(c)) if (!st.done && st.assistantId && st.assistantId === frame.messageId) st.activity = activity;
  }

  function bindStatus(st, assistantId) {
    if (!st || st.done) return;
    st.phase = 'bound';
    st.assistantId = assistantId;
    try { conv.bindStatus(st.c.id, st.id, assistantId); } catch (err) { log('warn', `status message not recorded: ${err?.message || err}`); }
  }

  /** No more progress: the ticker stops, typing stops once no other status of the conversation runs, and any edit in
   *  flight has landed (so it can never overwrite the final text). */
  async function quietStatus(st) {
    if (!st.done) {
      st.done = true;
      if (st.timer) clearI(st.timer);
      st.timer = null;
      if (!activeIn(st.c).some((o) => o !== st && !o.done)) typing(st.c, false);
    }
    await st.chain;
  }

  function dropStatus(st) {
    statuses.delete(st.id);
    try { conv.clearStatus(st.c.id, st.id); } catch (err) { log('warn', `status message not cleared: ${err?.message || err}`); }
  }

  /** The status message becomes `message` (a refusal, a failure, a note). Without a status, or when its edit fails,
   *  `message` is posted as a new message (as before live status) unless fallback is false. */
  async function finishWith(c, st, message, { fallback = true } = {}) {
    if (st) {
      await quietStatus(st);
      let shown = false;
      if (!st.lost) {
        try { await send(st.c, message, { edit: { messageId: st.id } }); shown = true; }
        catch (err) { log('warn', `status message not updated: ${err?.message || err}`); }
      }
      dropStatus(st);
      if (shown || !fallback) return;
    }
    await send(c, message).catch(() => {});
  }

  /** Deferred card answers: their follow-up's row id, learned once the queued reply started (shared with receipts:
   *  takeDeferredReply hands each answer out once). */
  const deferred = new Map();   // card id -> {assistantMessageId} | {error}
  function takeDeferred(cardId) {
    if (deferred.has(cardId)) return deferred.get(cardId);
    const d = deps.ask.takeDeferredReply(cardId);
    if (d) deferred.set(cardId, d);
    return d || null;
  }
  function releaseDeferred(cardId) {
    const waits = [...waiting.values()].some((l) => l.some((w) => w.cardId === cardId && !w.assistantId));
    const live = [...statuses.values()].some((st) => st.phase === 'deferred' && st.cardId === cardId);
    if (!waits && !live) deferred.delete(cardId);
  }
  async function resolveDeferredStatuses(c) {
    for (const st of activeIn(c)) {
      if (st.phase !== 'deferred' || st.done) continue;
      const d = takeDeferred(st.cardId);
      if (!d) continue;
      if (d.assistantMessageId) bindStatus(st, d.assistantMessageId);
      else await finishWith(c, st, warn(SAY.answeredNoReply(d.error)));
      releaseDeferred(st.cardId);
    }
  }

  /** After a restart (or a worker reconnect), a status row with no record here was left saying "working". A reply
   *  that finished is still edited into it (deliverAll adopts it); otherwise it becomes "Interrupted". A transient
   *  failure stops the sweep: the next pass (the worker's reconnect) retries. */
  async function sweepStatuses(c) {
    const rows = conv.listStatuses(c.id).filter((r) => !statuses.has(r.platformMessageId));
    if (!rows.length) return;
    const msgs = deps.ask.listMessages(c.askThreadId);
    for (const row of rows) {
      const m = row.askMessageId ? msgs.find((x) => x.id === row.askMessageId) : null;
      if (m && m.role === 'assistant' && m.status && m.status !== 'streaming' && !cutByRestart(m)) {
        statuses.set(row.platformMessageId, { c, id: row.platformMessageId, phase: 'bound', assistantId: m.id, cardId: null,
          startedAt: deps.now(), activity: null, shown: WORKING, done: true, lost: false, used: false, editing: false, pauseUntil: 0,
          chain: Promise.resolve(), timer: null });
        continue;
      }
      try { await send(c, statusMessage(INTERRUPTED), { edit: { messageId: row.platformMessageId } }); }
      catch (err) {
        if (!err?.permanent) { log('warn', `interrupted status not updated yet: ${err?.message || err}`); return; }
        log('warn', `interrupted status not updated: ${err?.message || err}`);
      }
      // A cut-off reply with nothing to show would only repeat "The reply failed": the Interrupted line stands for it.
      if (m && cutByRestart(m) && !(typeof m.text === 'string' && m.text.trim()) && !conv.deliveredParts(c.id, m.id).length
        && !(m.blocks || []).some((b) => b && b.kind === 'card')) {
        conv.recordDelivery({ conversationId: c.id, askMessageId: m.id, part: 'text:0', platformMessageId: row.platformMessageId }, { now: deps.now() });
      }
      conv.clearStatus(c.id, row.platformMessageId);
    }
  }

  function policy(plugin, channelId) {
    const cfg = deps.readConfig(plugin, channelId) || {};
    return { cfg, on: cfg.freeformChat === 'on', members: parseChatMembers(cfg.chatMembers), historyCount: historyCountOf(cfg.historyOnStart),
      guard: createAllowlistGuard(parseIdList(cfg.allowedChatIds), {}, parseIdList(cfg.allowedUserIds)) };
  }

  async function send(c, message, options = null) {
    return deps.host.sendMessage({ plugin: c.plugin, channelId: c.channelId, chatId: c.chatId, message, ...(options ? { options } : {}) });
  }

  /** A user row that came FROM the platform: recorded as delivered so it is never echoed back (D10). Called from
   *  startAskTurn's onUserRow hook, synchronously, before the row's ask-message broadcast (M4). */
  function markFromChat(c, askMessageId) {
    if (askMessageId) conv.recordDelivery({ conversationId: c.id, askMessageId, part: 'chat' }, { now: deps.now() });
  }

  // ── inbound messages ────────────────────────────────────────────────────

  /** true = handled (the router must not see it), including a replayed command (dropped here); commands and unrelated
   *  chatter return false (D13). */
  async function handleMessage({ plugin, channelId, platform, msg }) {
    const meta = msg.meta && typeof msg.meta === 'object' ? msg.meta : {};
    const eventId = meta.messageId ? `m:${meta.messageId}` : '';
    // Commands go to the router (D13). A replay of one (a gateway resume) is dropped here, so it runs and is
    // acknowledged once; chatter is never recorded.
    if (parseCommand(msg.text)) return !conv.markSeen({ plugin, channelId, eventId }, { now: deps.now() });
    const bound = conv.findConversation({ plugin, channelId, chatId: msg.chatId });
    const p = policy(plugin, channelId);
    if (!bound && !(p.on && meta.mentionsBot === true && p.guard.isAllowed({ platform, chatId: msg.chatId }))) return false;
    if (!conv.markSeen({ plugin, channelId, eventId }, { now: deps.now() })) return true;
    const text = stripBotMention(msg.text, meta.botId);
    if (bound) return continueConversation(bound, p, msg, text);
    return startConversation({ plugin, channelId, platform, msg, meta, p, text });
  }

  /** The chat id the command router should see (D13): a bound thread's PARENT channel, else the chat itself. */
  function commandChatId({ plugin, channelId, chatId }) {
    const c = conv.findConversation({ plugin, channelId, chatId });
    return c ? c.parentChatId : chatId;
  }

  async function startConversation({ plugin, channelId, platform, msg, meta, p, text }) {
    const identity = p.members.get(msg.userId);
    // A real failure is always posted (cycle-3 m3); only refusals are throttled per (chat, user, reason) (m5).
    const post = (t) => deps.host.sendMessage({ plugin, channelId, chatId: msg.chatId, message: warn(t) }).catch(() => {});
    const reply = (t, reason) => (noticeDue(msg.chatId, msg.userId, reason) ? post(t) : null);
    // D2 / cycle-3 m2: a sender outside allowedUserIds is ignored WITHOUT a reply, exactly like the command router
    // (command-router.mjs:684-688): a reply would tell a stranger the bot listens.
    if (!p.guard.isSenderAllowed({ platform, chatId: msg.chatId, userId: msg.userId })) return true;
    if (!identity) { await reply(SAY.notMember, 'not-member'); return true; }
    if (!meta.messageId) { log('warn', 'freeform start without a message id: cannot open a thread'); return true; }
    if (!bucketFor(msg.userId).tryConsume()) { await reply(SAY.rate, 'rate'); return true; }
    // Accepted: the mention (in the PARENT channel) shows ⏳ until its thread is up, or until the first reply when it
    // carried text. Every exit below settles it.
    const mark = markOf(plugin, channelId, msg.chatId, meta.messageId);
    receipts.ack(mark);
    const fail = async (what, err) => {
      const why = typeof err === 'string' ? err : err?.message;   // a thrown {kind} object has no message: "unknown error"
      log('warn', `freeform ${what} failed: ${why || err}`);
      receipts.settle(mark, 'fail');
      await post(SAY.failed(why));
      return true;
    };
    // Plan decision 9: any throw after the ack (a store or dependency call) fails this message here, so it never
    // reaches the server's log-only catch with ⏳ left on it.
    try { return await openConversation({ plugin, channelId, platform, msg, meta, p, identity, text, mark, fail }); }
    catch (err) { return fail('chat', err); }
  }

  async function openConversation({ plugin, channelId, platform, msg, meta, p, identity, text, mark, fail }) {
    let thread;
    try { thread = deps.ask.createThread({ createdBy: identity, scope: await deps.ask.initialScope(platform, msg.chatId) }); }
    catch (err) { return fail('chat creation', err); }
    let header;
    try {
      header = await deps.host.sendMessage({ plugin, channelId, chatId: msg.chatId,
        message: headerMessage({ scopeLabel: await deps.ask.scopeLabel(thread.id), controls: [] }),
        options: { thread: { fromMessageId: String(meta.messageId), name: threadName(text) } } });
    } catch (err) {
      deps.ask.deleteThread(thread.id);
      return fail('thread creation', err);
    }
    const threadChatId = header?.detail?.threadId || header?.threadId;
    const headerId = (header?.detail?.messageIds || header?.messageIds || [])[0] || null;
    if (!threadChatId) { deps.ask.deleteThread(thread.id); return fail('thread creation', 'the platform returned no thread'); }
    let c;
    try {
      c = conv.createConversation({ plugin, channelId, platform, guildId: meta.guildId ?? null, parentChatId: msg.chatId,
        chatId: String(threadChatId), ownerUserId: msg.userId, worcaIdentity: identity, askThreadId: thread.id, headerMessageId: headerId },
      { now: deps.now() });
    } catch (err) {
      // refine cycle 2: a binding write that fails (a thread id already bound, a busy database) must not leave an
      // orphan Ask thread or fail silently — the same handling as a thread-creation failure above.
      deps.ask.deleteThread(thread.id);
      return fail('binding', err);
    }
    deps.watch(thread.id);
    await refreshHeader(c).catch((err) => log('warn', `header update failed: ${err?.message || err}`));
    const extra = inboundOf(msg);
    // A bare mention (no words, no reply, no files): the thread and its header ARE the answer.
    if (!text && !hasContext(extra)) { receipts.settle(mark, 'ok'); return true; }
    // Opt-in (historyOnStart): the first turn also quotes the channel's last N messages before the mention — read only
    // now that the start is authorized, only in a group channel (never a DM), and never blocking the turn. History a
    // plugin pushed on the frame is used instead of a read.
    if (p.historyCount > 0 && meta.isGroup === true) {
      const h = Array.isArray(msg.history)
        ? { messages: msg.history.slice(-p.historyCount), note: null }
        : await readHistory({ plugin, channelId, chatId: msg.chatId, before: String(meta.messageId), limit: p.historyCount });
      extra.history = h.messages;
      if (h.note) extra.notes.push(h.note);
    }
    return runTurn(c, text, mark, hasContext(extra) ? inboundFor(c, meta, extra) : null);
  }

  /** The chat context handed to the turn: where it came from, the message's own link and the quoted data. */
  function inboundFor(c, meta, extra) {
    return { plugin: c.plugin, channelId: c.channelId, platform: c.platform, link: typeof meta.link === 'string' ? meta.link : null, ...extra };
  }

  async function readHistory(a) {
    if (typeof deps.host.history !== 'function') return { messages: [], note: null };
    try { return { messages: await deps.host.history(a), note: null }; }
    catch (err) {
      log('warn', `chat history not read: ${err?.message || err}`);
      return { messages: [], note: 'The recent channel history could not be read, so it is not included.' };
    }
  }

  async function continueConversation(c, p, msg, text) {
    const why = refusal(c, p, msg.userId);
    // D3: others' messages start nothing and get no reply; cycle-3 m2: nor do a sender's outside allowedUserIds.
    if (why === 'not-owner' || why === 'not-sender') return true;
    if (why) {
      if (noticeDue(c.chatId, msg.userId, why)) await send(c, warn(why === 'off' ? SAY.off : SAY.notMember)).catch(() => {});
      return true;
    }
    const extra = inboundOf(msg);
    if (!text && !hasContext(extra)) return true;
    if (!bucketFor(msg.userId).tryConsume()) {
      if (noticeDue(c.chatId, msg.userId, 'rate')) await send(c, warn(SAY.rate)).catch(() => {});
      return true;
    }
    const meta = msg.meta && typeof msg.meta === 'object' ? msg.meta : {};
    const mark = markOf(c.plugin, c.channelId, msg.chatId, meta.messageId);
    receipts.ack(mark);
    let st = null;
    // Plan decision 9: any throw after the ack fails this message with the usual post, never leaving ⏳ behind.
    try {
      st = await beginStatus(c);
      return await answerOrTurn(c, text, mark, hasContext(extra) ? inboundFor(c, meta, extra) : null, st);
    } catch (err) {
      const why = err?.message || String(err);
      log('warn', `freeform reply failed: ${why}`);
      receipts.settle(mark, 'fail');
      await finishWith(c, st && statuses.has(st.id) ? st : null, warn(SAY.failed(why)));
      return true;
    }
  }

  async function answerOrTurn(c, text, mark, inbound = null, st = null) {
    // D5 text-reply rule: the newest card is an open text question → this message answers it (its event turn's user
    // row is synthetic, so nothing is echoed). A message carrying files or a reply is always a turn: a card answer takes
    // text only, and the files and the quoted message must reach the model.
    const open = inbound ? null : newestOpenTextQuestion(c.askThreadId);
    if (open) {
      const r = await deps.ask.applyCard({ threadId: c.askThreadId, cardId: open.id, body: { text }, actor: c.worcaIdentity });
      if (r.status >= 400) {
        const k = cardRefusal(r, deps.linksFor(c.askThreadId));
        await finishWith(c, st, warn(k.text));
        receipts.settle(mark, k.failed ? 'fail' : null);
        return true;
      }
      const lost = followUpError(r);
      if (lost) {                             // clarify answer: saved, but its follow-up could not start → ❌
        await finishWith(c, st, warn(SAY.answeredNoReply(lost)));
        receipts.settle(mark, 'fail');
        return true;
      }
      const turn = r.body && typeof r.body.turn === 'object' ? r.body.turn : null;
      if (turn && (turn.assistantMessageId || turn.deferred)) {
        if (turn.assistantMessageId) bindStatus(st, turn.assistantMessageId);
        else if (st) { st.phase = 'deferred'; st.cardId = open.id; }
        awaitReply(c, mark, { assistantId: turn.assistantMessageId || null, cardId: turn.assistantMessageId ? null : open.id });
        if (st) reconcile(c).catch((err) => log('warn', `post update failed: ${err?.message || err}`));
      } else {
        if (st) await finishWith(c, st, { title: null, severity: 'info', body: [{ kind: 'markdown', value: SAY.answerSaved }] }, { fallback: false });
        receipts.settle(mark, 'ok');      // answered, and no follow-up reply will come
      }
      return true;
    }
    return runTurn(c, text, mark, inbound, st);
  }

  function refusal(c, p, userId) {
    // Order matters (refine cycle 1): who is speaking is decided BEFORE whether the chat is on, so a non-owner or a
    // sender outside allowedUserIds is never told anything, even "turned off" (D3, cycle-3 m2).
    if (userId !== c.ownerUserId) return 'not-owner';
    // review m7: the router's sender gate (allowedUserIds) applies to freeform chat too; its own reason, because a
    // message from such a sender gets no reply (cycle-3 m2) while a click still gets the ephemeral not-member text.
    if (!p.guard.isSenderAllowed({ platform: c.platform, chatId: c.parentChatId, userId })) return 'not-sender';
    if (!p.on || !p.guard.isAllowed({ platform: c.platform, chatId: c.parentChatId })) return 'off';
    if (p.members.get(userId) !== c.worcaIdentity) return 'not-member';
    return null;
  }

  /** One paid turn, as the bound worca identity: the host runs the send route's gates first (D14, review M2), and
   *  startAskTurn calls onUserRow synchronously before broadcasting the row (M4). */
  async function startTurn(c, text, inbound = null) {
    // No context: the call is exactly what it was before chat context existed.
    return deps.ask.startTurn({ threadId: c.askThreadId, text, actor: c.worcaIdentity, onUserRow: (m) => markFromChat(c, m && m.id),
      ...(inbound ? { inbound } : {}) });
  }

  /** `st`: the status message a bound-thread message already posted; a conversation's first turn posts its own. */
  async function runTurn(c, text, mark = null, inbound = null, st = undefined) {
    if (st === undefined) st = await beginStatus(c);
    let r;
    try { r = await startTurn(c, text, inbound); }
    catch (err) { r = { ok: false, status: 500, error: err?.message || String(err) }; }
    if (!r.ok) {
      const k = turnRefusal(r);
      await finishWith(c, st, warn(k.text));
      receipts.settle(mark, k.failed ? 'fail' : null);
      return true;
    }
    if (st) {
      if (r.assistantMessageId) bindStatus(st, r.assistantMessageId);
      else await finishWith(c, st, { title: null, severity: 'info', body: [{ kind: 'markdown', value: DONE_EMPTY }] }, { fallback: false });
    }
    awaitReply(c, mark, { assistantId: r.assistantMessageId || null });
    // The reply waited for its status to be bound: deliver it now if it already finished.
    if (st) reconcile(c).catch((err) => log('warn', `post update failed: ${err?.message || err}`));
    return true;
  }

  // ── receipts (reactions on the inbound message) ─────────────────────────

  function awaitReply(c, mark, { assistantId = null, cardId = null }) {
    if (!mark) return;
    if (!assistantId && !cardId) { receipts.settle(mark, null); return; }   // nothing to wait for: never a false mark
    // New conversation was clicked while this turn started (a mention's first turn starts on the PARENT channel's queue,
    // the click runs on the thread's): its reply will never reach this platform thread, as in dropWaits.
    if (conv.getConversation(c.id)?.askThreadId !== c.askThreadId) { receipts.settle(mark, null); return; }
    const list = waiting.get(c.id) || [];
    list.push({ mark, assistantId, cardId });
    waiting.set(c.id, list);
    // The reply may be delivered already: the first message's reconcile runs on the thread's queue. A failed check
    // keeps the wait (and ⏳): the turn is running, and the reconcile pass that delivers its reply checks again.
    try { checkReceipts(c); } catch (err) { log('warn', `reply check failed: ${err?.message || err}`); }
  }

  /** Settle every wait of this conversation whose reply is finished and delivered. A typed answer whose follow-up was
   *  queued behind another reply learns from the server which reply that became, or that it could not start (❌,
   *  clarify answer) — never by guessing from row order, so another queued event's reply can never settle it. */
  function checkReceipts(c) {
    const list = waiting.get(c.id);
    if (!list) return;
    const msgs = deps.ask.listMessages(c.askThreadId);
    const links = deps.linksFor(c.askThreadId);
    for (const w of list.slice()) {
      if (!w.assistantId) {
        const d = takeDeferred(w.cardId);
        if (!d) continue;                                      // still queued behind the running reply
        if (!d.assistantMessageId) { list.splice(list.indexOf(w), 1); releaseDeferred(w.cardId); receipts.settle(w.mark, 'fail'); continue; }
        w.assistantId = d.assistantMessageId;
        releaseDeferred(w.cardId);
      }
      const m = msgs.find((x) => x.id === w.assistantId);
      const outcome = m ? replyOutcome(c, m, links) : null;
      if (!outcome) continue;
      list.splice(list.indexOf(w), 1);
      receipts.settle(w.mark, outcome);
    }
    if (!list.length) waiting.delete(c.id);
  }

  /** null while the reply is streaming or not fully delivered; else ✅ ok, ❌ fail (an error reply, or a part the
   *  platform refused for good — skipPart records it without a message id), ⏹️ stop. */
  function replyOutcome(c, m, links) {
    if (m.role !== 'assistant' || !m.status || m.status === 'streaming') return null;
    const parts = renderMessageParts(m, { issue: DRY_ISSUE, links, fromWorca: false });
    const have = new Map(conv.deliveredParts(c.id, m.id).map((d) => [d.part, d]));
    if (!parts.every((p) => have.has(p.part))) return null;
    if (m.status === 'error' || parts.some((p) => !have.get(p.part).platformMessageId)) return 'fail';
    return m.status === 'stopped' ? 'stop' : 'ok';
  }

  /** New conversation: the old thread's pending replies will never reach this platform thread. */
  function dropWaits(c) {
    const list = waiting.get(c.id);
    if (!list) return;
    waiting.delete(c.id);
    for (const w of list) receipts.settle(w.mark, null);
  }

  // ── interactions ────────────────────────────────────────────────────────

  async function handleInteraction({ plugin, channelId, evt }) {
    const ephemeral = (text) => deps.host.replyInteraction({ plugin, channelId, interactionId: evt.id, text })
      .catch((err) => log('warn', `interaction reply failed: ${err?.message || err}`));
    if (!conv.markSeen({ plugin, channelId, eventId: `i:${evt.id}` }, { now: deps.now() })) return;
    const ctl = conv.getControl(evt.ref);
    const c = ctl ? conv.getConversation(ctl.conversationId) : null;
    // Forged, unknown, pruned or cross-thread refs all answer the same (no oracle).
    if (!ctl || !c || c.plugin !== plugin || c.channelId !== channelId || c.chatId !== evt.chatId || c.status !== 'active') return ephemeral(SAY.stale);
    const p = policy(plugin, channelId);
    const why = refusal(c, p, evt.userId);
    if (why === 'not-owner') return ephemeral(SAY.notOwner(c.ownerUserId, c.platform));
    if (why) return ephemeral(why === 'off' ? SAY.off : SAY.notMember);
    if (Date.parse(ctl.expiresAt) <= deps.now() || ctl.usedAt) return ephemeral(SAY.stale);
    if (ctl.action.startsWith('header:')) return handleHeader(c, ctl, evt, ephemeral);
    const found = deps.ask.findCard(c.askThreadId, ctl.cardId);
    if (!found || found.block.state !== ctl.issuedState) { await reconcile(c).catch(() => {}); return ephemeral(SAY.stale); }
    if (!conv.claimControl(evt.ref, { now: deps.now() })) return ephemeral(SAY.stale);
    let r;
    try { r = await applyControl(c, ctl, evt, found); }
    catch (err) { r = { status: 500, body: { error: err?.message || String(err) } }; }
    if (r.status >= 400) {
      conv.releaseControl(evt.ref);          // no-op for reusable refs
      return ephemeral(refusalText(r, deps.linksFor(c.askThreadId)));
    }
    if (REUSABLE_CARD_ACTIONS.has(ctl.action)) return ephemeral(SAY.changesSent);   // M6: the proposal and its buttons stay
    conv.retireCardControls(c.id, ctl.cardId, { now: deps.now() });
    const lost = followUpError(r);                       // review m9: answered, but its event turn could not start
    await ephemeral(lost ? SAY.answeredNoReply(lost) : SAY.done);
    await reconcile(c).catch((err) => log('warn', `post update failed: ${err?.message || err}`));
  }

  async function applyControl(c, ctl, evt, found) {
    const card = found.block.card || {};
    switch (ctl.action) {
      case 'start': {
        if (!isNativeRunCard(card)) return { status: 409, body: { error: 'this run needs worca' } };
        await deps.ask.refreshProjects();          // projectDirOf below reads a map this refreshes (listProjects is async)
        const body = runBodyFromCard(card, { projectDirOf: deps.ask.projectDirOf, threadId: c.askThreadId, cardId: ctl.cardId });
        if (!body) return { status: 409, body: { error: 'the project is no longer registered' } };
        return deps.ask.startRun({ body, actor: c.worcaIdentity });
      }
      case 'dismiss': return deps.ask.applyCard({ threadId: c.askThreadId, cardId: ctl.cardId, body: { state: 'dismissed' }, actor: c.worcaIdentity });
      case 'choice': return deps.ask.applyCard({ threadId: c.askThreadId, cardId: ctl.cardId, body: { choice: (evt.values || [])[0] }, actor: c.worcaIdentity });
      case 'text': return deps.ask.applyCard({ threadId: c.askThreadId, cardId: ctl.cardId, body: { text: evt.fields?.text ?? '' }, actor: c.worcaIdentity });
      case 'changes': {
        const t = String(evt.fields?.text || '').trim();
        if (!t) return { status: 400, body: { error: 'empty change request' } };
        if (!bucketFor(c.ownerUserId).tryConsume()) return { status: 429, body: { error: SAY.rate } };
        // A change request is a normal message; the proposal stays proposed (the model may propose again).
        const r = await startTurn(c, `Change request for the proposed run (${ctl.cardId}): ${t}`);
        return r.ok ? { status: 202, body: {} } : { status: r.status || 500, body: { error: r.error, ...(r.code ? { code: r.code } : {}) } };
      }
      default: return { status: 400, body: { error: 'unknown control' } };
    }
  }

  async function handleHeader(c, ctl, evt, ephemeral) {
    if (ctl.action === 'header:stop') { deps.ask.stopTurn(c.askThreadId); return ephemeral('Stopping the reply.'); }
    if (ctl.action === 'header:new') {
      dropWaits(c);
      for (const st of activeIn(c)) await finishWith(c, st, { title: null, severity: 'info', body: [{ kind: 'markdown', value: SAY.statusMoved }] }, { fallback: false });
      const t = deps.ask.createThread({ createdBy: c.worcaIdentity, scope: deps.ask.threadScope(c.askThreadId) });
      const next = conv.rebindConversation(c.id, { askThreadId: t.id }, { now: deps.now() });
      deps.watch(t.id);
      await send(next, { title: null, severity: 'info', body: [{ kind: 'markdown', value: '— **New conversation** — earlier messages stay in worca.' }] }).catch(() => {});
      await refreshHeader(next);
      return ephemeral('Started a new conversation.');
    }
    if (ctl.action === 'header:scope' && evt.kind === 'select') {
      const r = await deps.ask.switchScope({ threadId: c.askThreadId, value: (evt.values || [])[0] });
      // A failed switch changes nothing: the header and every ref on it stay usable.
      if (!r.ok) return ephemeral(r.status === 409 ? SAY.busy : SAY.failed(r.error));
      // Any successful pick (clarify answer) ends New conversation for good: its refs are spent first, so a click on
      // the old header can never start one, even if the header edit below fails.
      conv.retireNewConversation(c.id, { now: deps.now() });
      await refreshHeader(c);
      return ephemeral(`Scope: ${await deps.ask.scopeLabel(c.askThreadId)}`);
    }
    return ephemeral(SAY.stale);
  }

  // ── header ──────────────────────────────────────────────────────────────

  /** Re-issue the header's reusable refs (older header refs are spent first) and edit the header in place. The New
   *  conversation flag is read from the store: callers may hold a row from before a scope pick. */
  async function refreshHeader(c) {
    if (!c.headerMessageId) return;
    const startOver = conv.getConversation(c.id)?.headerNewOff !== true;
    const label = await deps.ask.scopeLabel(c.askThreadId);
    const { options, hidden } = await deps.ask.scopeOptions();
    conv.retireHeaderControls(c.id, { now: deps.now() });
    const mint = (action) => conv.issueControl({ conversationId: c.id, action, ownerUserId: c.ownerUserId, singleUse: false, ttlMs: HEADER_CONTROL_TTL_MS }, { now: deps.now() });
    const links = deps.linksFor(c.askThreadId);
    const controls = [
      { kind: 'select', ref: mint('header:scope'), placeholder: `Scope: ${label}`.slice(0, 100), options },
      ...(startOver ? [{ kind: 'button', ref: mint('header:new'), label: 'New conversation', style: 'secondary' }] : []),
      { kind: 'button', ref: mint('header:stop'), label: 'Stop', style: 'danger' },
      ...(links.thread ? [{ kind: 'link', label: 'Open in worca', url: links.thread }] : []),
    ];
    await send(c, headerMessage({ scopeLabel: label, controls, hiddenScopes: hidden, startOver }), { edit: { messageId: c.headerMessageId } })
      .catch((err) => log('warn', `header update failed: ${err?.message || err}`));
  }

  // ── delivery (D10) ──────────────────────────────────────────────────────

  /** Deliver what is missing and correct what is stale (D10). Idempotent: a second run with nothing new sends nothing.
   *  Parts are first computed with a DRY ref minter; a part is re-rendered with real refs only right before it is
   *  sent or edited, so no unused refs pile up. A transient send failure (network, 429, worker down)
   *  stops this pass and the next trigger retries from there; a permanent one skips just that part (skipPart). */
  // One reconcile per conversation at a time (refine cycle 1): the server already runs every caller on the chat's
  // queue, but a direct caller (tests, a future path) must not race it into double posts.
  const reconciling = new Map();
  function reconcile(c) {
    const run = (reconciling.get(c.id) || Promise.resolve()).catch(() => {}).then(() => reconcileOnce(c));
    reconciling.set(c.id, run);
    run.finally(() => { if (reconciling.get(c.id) === run) reconciling.delete(c.id); }).catch(() => {});
    return run;
  }

  async function reconcileOnce(c) {
    try {
      // Status upkeep never blocks delivery: a failure here is logged and the replies still go out.
      try { await sweepStatuses(c); await resolveDeferredStatuses(c); }
      catch (err) { log('warn', `status messages not checked: ${err?.message || err}`); }
      await deliverAll(c);
    }
    // Also after a pass a transient error ended: a reply delivered before it settles now, not at the next trigger.
    // replyOutcome checks each row's own delivery records, so an undelivered part still keeps its ⏳.
    finally { checkReceipts(c); }
  }

  async function deliverAll(c) {
    const links = deps.linksFor(c.askThreadId);
    const DRY = DRY_ISSUE;
    const realIssue = (action, cardId, state) => conv.issueControl({ conversationId: c.id, cardId, action, issuedState: state,
      ownerUserId: c.ownerUserId, singleUse: !REUSABLE_CARD_ACTIONS.has(action) }, { now: deps.now() });
    for (const m of deps.ask.listMessages(c.askThreadId)) {
      if (m.createdAt < c.createdAt) continue;                       // history from before the binding stays in worca
      if (m.role === 'assistant' && m.status === 'streaming') continue;
      const have = new Map(conv.deliveredParts(c.id, m.id).map((d) => [d.part, d]));
      if (m.role === 'user' && have.has('chat')) continue;          // came from the platform
      // A turn whose status message does not yet know its row: a new reply waits (runTurn reconciles once it is bound).
      if (m.role === 'assistant' && !have.size && activeIn(c).some((st) => st.phase === 'starting')) continue;
      const fromWorca = m.role === 'user' && !isSyntheticUserRow(m);
      const st = m.role === 'assistant' ? activeIn(c).find((x) => x.phase === 'bound' && x.assistantId === m.id && !x.used) : null;
      const parts = renderMessageParts(m, { issue: DRY, links, fromWorca });
      for (const part of parts) {
        const prev = have.get(part.part);
        if (prev && (!part.cardId || prev.shownState === part.state)) continue;   // delivered and current
        // Order matters: spend the card's older refs FIRST, then mint the ones this post will carry.
        if (part.cardId) conv.retireCardControls(c.id, part.cardId, { now: deps.now() });
        const real = renderCardOrPart(m, part.part, { issue: realIssue, links, fromWorca });
        // The reply's first new part goes INTO the status message. A transient failure stops the pass (retried with the
        // same edit: nothing is posted twice); a refusal (deleted message, no access) posts the part as a new message.
        if (!prev && st && !st.used) {
          st.used = true;
          await quietStatus(st);
          if (!st.lost) {
            try {
              await send(c, real.message, { edit: { messageId: st.id } });
              conv.recordDelivery({ conversationId: c.id, askMessageId: m.id, part: part.part, platformMessageId: st.id, shownState: part.state ?? null }, { now: deps.now() });
              dropStatus(st);
              continue;
            } catch (err) {
              if (!err?.permanent) { st.used = false; throw err; }
              log('warn', `status message not turned into the reply: ${err?.message || err}`);
            }
          }
          dropStatus(st);
        }
        let editFailed = false;
        if (prev && part.cardId && prev.platformMessageId) {
          try {
            await send(c, real.message, { edit: { messageId: prev.platformMessageId } });
            conv.recordDelivery({ conversationId: c.id, askMessageId: m.id, part: part.part, platformMessageId: prev.platformMessageId, shownState: part.state }, { now: deps.now() });
            continue;
          } catch (err) {
            if (!err?.permanent) throw err;
            if (!NOT_FOUND.test(err.message || '')) { skipPart(c, m, part, err); continue; }
            editFailed = true;   // the message was deleted on the platform: post the card again as a new message
          }
        }
        if (editFailed) conv.retireCardControls(c.id, part.cardId, { now: deps.now() });   // the failed edit's refs were never shown
        const post = editFailed ? renderCardOrPart(m, part.part, { issue: realIssue, links, fromWorca }) : real;
        try {
          const r = await send(c, post.message);
          const ids = r?.detail?.messageIds || r?.messageIds || [];
          conv.recordDelivery({ conversationId: c.id, askMessageId: m.id, part: part.part, platformMessageId: ids[ids.length - 1] || null, shownState: part.state ?? null }, { now: deps.now() });
        } catch (err) {
          if (!err?.permanent) throw err;
          skipPart(c, m, part, err);
        }
      }
      // The reply had no new part for it (nothing to show, or delivered before the status knew its row): never leave
      // the status message saying "working".
      if (st && !st.used) {
        const note = parts.length ? SAY.answeredBelow : DONE_EMPTY;
        await finishWith(c, st, { title: null, severity: 'info', body: [{ kind: 'markdown', value: note }] }, { fallback: false });
      }
    }
  }

  /** A part the platform refuses for good (403, an invalid message, a deleted channel) is recorded as delivered at its
   *  current state, so it neither blocks the parts after it nor is retried on every pass. A later state change retries it. */
  function skipPart(c, m, part, err) {
    log('warn', `chat part ${part.part} not delivered: ${err?.message || err}`);
    if (part.cardId) conv.retireCardControls(c.id, part.cardId, { now: deps.now() });   // refs minted for a post that never showed
    conv.recordDelivery({ conversationId: c.id, askMessageId: m.id, part: part.part, platformMessageId: null, shownState: part.state ?? null }, { now: deps.now() });
  }

  function newestOpenTextQuestion(threadId) {
    const msgs = deps.ask.listMessages(threadId);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const cards = (msgs[i].blocks || []).filter((b) => b && b.kind === 'card');
      if (!cards.length) continue;
      const last = cards[cards.length - 1];
      return last.state === 'proposed' && last.card && last.card.type === 'question' && last.card.answer === 'text' ? last : null;
    }
    return null;
  }

  return { handleMessage, handleInteraction, reconcile, refreshHeader, commandChatId, progress, resetRateLimits: () => buckets.clear() };
}

/** Render only the named part with real refs (a card part mints refs for that card alone). */
function renderCardOrPart(m, partName, opts) {
  if (partName.startsWith('card:')) {
    const id = partName.slice(5);
    const only = { ...m, text: '', status: 'done', blocks: (m.blocks || []).filter((b) => b && b.kind === 'card' && b.id === id) };
    return renderMessageParts(only, opts).find((x) => x.part === partName);
  }
  return renderMessageParts({ ...m, blocks: (m.blocks || []).filter((b) => !(b && b.kind === 'card')) }, opts).find((x) => x.part === partName);
}

/** An event turn's user row (`synthetic: true` notice block, ui/server.mjs startAskTurn) is shown in worca as a notice
 *  and here as nothing: it is never a person's message typed in worca. */
export function isSyntheticUserRow(m) {
  return Array.isArray(m.blocks) && m.blocks.some((b) => b && b.kind === 'notice' && b.synthetic === true);
}

const warn = (text) => ({ title: null, severity: 'warning', body: [{ kind: 'markdown', value: text }] });
const threadName = (text) => (text ? `worca: ${text.split('\n')[0]}`.slice(0, 90) : 'worca chat');
function headerMessage({ scopeLabel, controls, hiddenScopes = 0, startOver = true }) {
  const more = hiddenScopes > 0 ? `\n${hiddenScopes} more scope${hiddenScopes === 1 ? '' : 's'}: pick ${hiddenScopes === 1 ? 'it' : 'them'} in worca.` : '';
  const what = startOver ? 'change scope, start over or stop a reply' : 'change scope or stop a reply';
  return { title: null, severity: 'info',
    body: [{ kind: 'markdown', value: `**worca chat** · scope: **${scopeLabel}**\nReply in this thread to continue. Use the controls to ${what}.${more}` }],
    ...(controls.length ? { controls } : {}) };
}
