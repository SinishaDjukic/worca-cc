// src/core/chat/conversation-bridge.mjs — freeform chat (D1–D15): authorize, bind a platform thread to an Ask thread,
// turn messages into Ask turns, clicks into the SAME card/run services the browser uses, and deliver what the Ask
// thread holds. Every service is injected (ui/server.mjs supplies the real ones); nothing here runs a model or a tool.
import { parseCommand } from './parser.mjs';
import { createAllowlistGuard, parseIdList, parseChatMembers } from './allowlist.mjs';
import { TokenBucket } from './rate-limiter.mjs';
import * as conv from './conversations.mjs';
import { renderMessageParts, runBodyFromCard, isNativeRunCard } from './card-render.mjs';

const { HEADER_CONTROL_TTL_MS } = conv;
export const FREEFORM_RATE_PER_MIN = 6;
/** The same refusal to the same person in the same chat is posted at most once per this window (review m5). */
export const NOTICE_EVERY_MS = 10 * 60 * 1000;
/** Card actions whose success leaves the card open (D8): their refs are reusable and nothing is retired. */
const REUSABLE_CARD_ACTIONS = new Set(['changes']);
/** Run-start refusals that ask the browser user to confirm something (D4 row 1): never answered from chat. */
const BROWSER_CONFIRM_CODES = new Set(['sync-diverged', 'sync-fetch-failed', 'reason_required', 'team_total', 'engine-refused', 'preset-broken']);
const BOT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export const SAY = {
  notMember: 'You are not set up for worca chat here. Ask the worca operator to add your Discord user ID under Freeform chat members.',
  notOwner: (owner) => `Only <@${owner}> can act on this conversation.`,
  stale: 'This control is no longer valid. Use the newest message.',
  busy: 'Chat is still replying. Try again once the answer lands.',
  rate: 'Slow down a little: too many messages in a minute. Nothing was sent to the model.',
  budget: 'Total cost limit reached — nothing was sent to the model. Raise the limit in worca Settings.',
  off: 'Freeform chat is turned off for this channel.',
  confirmInWorca: 'This needs a confirmation in worca (branch sync, team policy or engine consent). Open in worca to confirm — nothing was started.',
  failed: (e) => `That did not work: ${String(e || 'unknown error').slice(0, 300)}`,
  gate: (e) => `${String(e || 'This chat cannot start here.').slice(0, 400)} Open in worca to switch the chat engine or add your key — nothing was sent to the model.`,
  answeredNoReply: (e) => `Answer saved, but the reply could not start: ${String(e || 'unknown error').slice(0, 300)}`,
  done: 'Done — the message will update shortly.',
  changesSent: 'Sent your change request. The proposal stays open.',
};

/** Remove only THIS bot's mention tokens (`<@id>` / `<@!id>`). Other mentions, e-mail addresses, newlines and
 *  markdown reach the model exactly as typed (M2). */
export function stripBotMention(text, botId) {
  let t = String(text ?? '');
  if (typeof botId === 'string' && BOT_ID_RE.test(botId)) t = t.replace(new RegExp(`<@!?${botId}>[ \\t]?`, 'g'), '');
  return t.trim();
}

/** A run-start / card refusal → the one line the person sees. */
export function refusalText(r) {
  const b = (r && r.body) || {};
  if (r && r.status === 409 && /turn in flight/.test(b.error || '')) return SAY.busy;
  if (b.code === 'engine-broker' || b.code === 'credential-missing') return SAY.gate(b.error);
  if (BROWSER_CONFIRM_CODES.has(b.code) || b.needsPolicyAck === true) return SAY.confirmInWorca;
  return SAY.failed(b.error);
}

/** A turn-start refusal (startAskTurn or the extracted send-route gates) → the one line the person sees (D14). */
export function turnRefusalText(r) {
  if (r && (r.code === 'engine-broker' || r.code === 'credential-missing')) return SAY.gate(r.error);
  if (r && r.status === 403 && /cost limit/i.test(r.error || '')) return SAY.budget;
  if (r && r.status === 409 && /in flight/.test(r.error || '')) return SAY.busy;
  return SAY.failed(r && r.error);
}

/** A successful card apply whose event turn failed (D10, review m9): the cards route answers 200 with
 *  `turn: {error, status}` (failedEventTurn). null when the follow-up started, was deferred, or there was none. */
export function followUpError(r) {
  const t = r && r.body && r.body.turn;
  return t && typeof t === 'object' && typeof t.error === 'string' && t.error ? t.error : null;
}

/** deps: { host: {sendMessage, replyInteraction}, ask: {createThread, deleteThread, getThread, listMessages, findCard,
 *  initialScope (async), threadScope, scopeLabel (async), scopeOptions (async → {options, hidden}), refreshProjects (async), projectDirOf,
 *  startTurn, applyCard, startRun,
 *  switchScope, stopTurn}, readConfig(plugin, channelId), linksFor(threadId), watch(threadId), now(), log(level,msg),
 *  ratePerMin? } */
const NOT_FOUND = /not found/i;

export function createConversationBridge(deps) {
  const buckets = new Map();
  const rate = deps.ratePerMin ?? FREEFORM_RATE_PER_MIN;
  const bucketFor = (userId) => {
    let b = buckets.get(userId);
    if (!b) { b = new TokenBucket(rate, { now: deps.now }); buckets.set(userId, b); }
    return b;
  };
  const log = deps.log || (() => {});
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

  function policy(plugin, channelId) {
    const cfg = deps.readConfig(plugin, channelId) || {};
    return { cfg, on: cfg.freeformChat === 'on', members: parseChatMembers(cfg.chatMembers),
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

  /** true = handled (the router must not see it). Commands and unrelated chatter return false (D13). */
  async function handleMessage({ plugin, channelId, platform, msg }) {
    if (parseCommand(msg.text)) return false;
    const meta = msg.meta && typeof msg.meta === 'object' ? msg.meta : {};
    const bound = conv.findConversation({ plugin, channelId, chatId: msg.chatId });
    const p = policy(plugin, channelId);
    if (!bound && !(p.on && meta.mentionsBot === true && p.guard.isAllowed({ platform, chatId: msg.chatId }))) return false;
    if (!conv.markSeen({ plugin, channelId, eventId: meta.messageId ? `m:${meta.messageId}` : '' }, { now: deps.now() })) return true;
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
    const thread = deps.ask.createThread({ createdBy: identity, scope: await deps.ask.initialScope(platform, msg.chatId) });
    let header;
    try {
      header = await deps.host.sendMessage({ plugin, channelId, chatId: msg.chatId,
        message: headerMessage({ scopeLabel: await deps.ask.scopeLabel(thread.id), controls: [] }),
        options: { thread: { fromMessageId: String(meta.messageId), name: threadName(text) } } });
    } catch (err) {
      log('warn', `freeform thread creation failed: ${err?.message || err}`);
      deps.ask.deleteThread(thread.id);
      await post(SAY.failed(err?.message));
      return true;
    }
    const threadChatId = header?.detail?.threadId || header?.threadId;
    const headerId = (header?.detail?.messageIds || header?.messageIds || [])[0] || null;
    if (!threadChatId) { deps.ask.deleteThread(thread.id); await post(SAY.failed('the platform returned no thread')); return true; }
    let c;
    try {
      c = conv.createConversation({ plugin, channelId, platform, guildId: meta.guildId ?? null, parentChatId: msg.chatId,
        chatId: String(threadChatId), ownerUserId: msg.userId, worcaIdentity: identity, askThreadId: thread.id, headerMessageId: headerId },
      { now: deps.now() });
    } catch (err) {
      // refine cycle 2: a binding write that fails (a thread id already bound, a busy database) must not leave an
      // orphan Ask thread or fail silently — the same handling as a thread-creation failure above.
      log('warn', `freeform binding failed: ${err?.message || err}`);
      deps.ask.deleteThread(thread.id);
      await post(SAY.failed(err?.message));
      return true;
    }
    deps.watch(thread.id);
    await refreshHeader(c);
    if (!text) return true;          // a bare mention opens the thread and waits for the first real message
    return runTurn(c, text);
  }

  async function continueConversation(c, p, msg, text) {
    const why = refusal(c, p, msg.userId);
    // D3: others' messages start nothing and get no reply; cycle-3 m2: nor do a sender's outside allowedUserIds.
    if (why === 'not-owner' || why === 'not-sender') return true;
    if (why) {
      if (noticeDue(c.chatId, msg.userId, why)) await send(c, warn(why === 'off' ? SAY.off : SAY.notMember)).catch(() => {});
      return true;
    }
    if (!text) return true;
    if (!bucketFor(msg.userId).tryConsume()) {
      if (noticeDue(c.chatId, msg.userId, 'rate')) await send(c, warn(SAY.rate)).catch(() => {});
      return true;
    }
    // D5 text-reply rule: the newest card is an open text question → this message answers it (its event turn's user
    // row is synthetic, so nothing is echoed).
    const open = newestOpenTextQuestion(c.askThreadId);
    if (open) {
      const r = await deps.ask.applyCard({ threadId: c.askThreadId, cardId: open.id, body: { text }, actor: c.worcaIdentity });
      if (r.status >= 400) await send(c, warn(refusalText(r))).catch(() => {});
      else if (followUpError(r)) await send(c, warn(SAY.answeredNoReply(followUpError(r)))).catch(() => {});
      return true;
    }
    return runTurn(c, text);
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
  async function startTurn(c, text) {
    return deps.ask.startTurn({ threadId: c.askThreadId, text, actor: c.worcaIdentity, onUserRow: (m) => markFromChat(c, m && m.id) });
  }

  async function runTurn(c, text) {
    const r = await startTurn(c, text);
    if (!r.ok) await send(c, warn(turnRefusalText(r))).catch(() => {});
    return true;
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
    if (why === 'not-owner') return ephemeral(SAY.notOwner(c.ownerUserId));
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
      return ephemeral(refusalText(r));
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
      const t = deps.ask.createThread({ createdBy: c.worcaIdentity, scope: deps.ask.threadScope(c.askThreadId) });
      const next = conv.rebindConversation(c.id, { askThreadId: t.id }, { now: deps.now() });
      deps.watch(t.id);
      await send(next, { title: null, severity: 'info', body: [{ kind: 'markdown', value: '— **New conversation** — earlier messages stay in worca.' }] }).catch(() => {});
      await refreshHeader(next);
      return ephemeral('Started a new conversation.');
    }
    if (ctl.action === 'header:scope' && evt.kind === 'select') {
      const r = await deps.ask.switchScope({ threadId: c.askThreadId, value: (evt.values || [])[0] });
      if (!r.ok) return ephemeral(r.status === 409 ? SAY.busy : SAY.failed(r.error));
      await refreshHeader(c);
      return ephemeral(`Scope: ${await deps.ask.scopeLabel(c.askThreadId)}`);
    }
    return ephemeral(SAY.stale);
  }

  // ── header ──────────────────────────────────────────────────────────────

  /** Re-issue the header's three reusable refs (older header refs are spent first) and edit the header in place. */
  async function refreshHeader(c) {
    if (!c.headerMessageId) return;
    const label = await deps.ask.scopeLabel(c.askThreadId);
    const { options, hidden } = await deps.ask.scopeOptions();
    conv.retireHeaderControls(c.id, { now: deps.now() });
    const mint = (action) => conv.issueControl({ conversationId: c.id, action, ownerUserId: c.ownerUserId, singleUse: false, ttlMs: HEADER_CONTROL_TTL_MS }, { now: deps.now() });
    const links = deps.linksFor(c.askThreadId);
    const controls = [
      { kind: 'select', ref: mint('header:scope'), placeholder: `Scope: ${label}`.slice(0, 100), options },
      { kind: 'button', ref: mint('header:new'), label: 'New conversation', style: 'secondary' },
      { kind: 'button', ref: mint('header:stop'), label: 'Stop', style: 'danger' },
      ...(links.thread ? [{ kind: 'link', label: 'Open in worca', url: links.thread }] : []),
    ];
    await send(c, headerMessage({ scopeLabel: label, controls, hiddenScopes: hidden }), { edit: { messageId: c.headerMessageId } })
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
    const links = deps.linksFor(c.askThreadId);
    const DRY = () => 'x'.repeat(24);
    const realIssue = (action, cardId, state) => conv.issueControl({ conversationId: c.id, cardId, action, issuedState: state,
      ownerUserId: c.ownerUserId, singleUse: !REUSABLE_CARD_ACTIONS.has(action) }, { now: deps.now() });
    for (const m of deps.ask.listMessages(c.askThreadId)) {
      if (m.createdAt < c.createdAt) continue;                       // history from before the binding stays in worca
      if (m.role === 'assistant' && m.status === 'streaming') continue;
      const have = new Map(conv.deliveredParts(c.id, m.id).map((d) => [d.part, d]));
      if (m.role === 'user' && have.has('chat')) continue;          // came from the platform
      const fromWorca = m.role === 'user' && !isSyntheticUserRow(m);
      for (const part of renderMessageParts(m, { issue: DRY, links, fromWorca })) {
        const prev = have.get(part.part);
        if (prev && (!part.cardId || prev.shownState === part.state)) continue;   // delivered and current
        // Order matters: spend the card's older refs FIRST, then mint the ones this post will carry.
        if (part.cardId) conv.retireCardControls(c.id, part.cardId, { now: deps.now() });
        const real = renderCardOrPart(m, part.part, { issue: realIssue, links, fromWorca });
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

  return { handleMessage, handleInteraction, reconcile, refreshHeader, commandChatId, resetRateLimits: () => buckets.clear() };
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
function headerMessage({ scopeLabel, controls, hiddenScopes = 0 }) {
  const more = hiddenScopes > 0 ? `\n${hiddenScopes} more scope${hiddenScopes === 1 ? '' : 's'}: pick ${hiddenScopes === 1 ? 'it' : 'them'} in worca.` : '';
  return { title: null, severity: 'info',
    body: [{ kind: 'markdown', value: `**worca chat** · scope: **${scopeLabel}**\nReply in this thread to continue. Use the controls to change scope, start over or stop a reply.${more}` }],
    ...(controls.length ? { controls } : {}) };
}
