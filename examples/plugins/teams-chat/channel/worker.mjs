/**
 * Microsoft Teams channel worker — Bot Framework, no SDK
 * (chat-connectivity-design.md §4.9). The one webhook-ingress channel: inbound
 * Activities arrive as host-forwarded webhook frames (the host's tokened
 * /api/ingress/teams route), THIS worker validates the Bot Framework JWT
 * (channel/jwt.mjs) and answers the HTTP status; outbound replies/proactive
 * messages POST Activities to the conversation's serviceUrl with an AAD
 * client-credentials token (channel/token.mjs).
 *
 * v1 scope cut: reply + proactive-to-SEEN-conversations only. Conversation
 * references are captured from every inbound activity into host-persisted
 * state; notifying a conversation the bot has never seen fails with an
 * actionable "message the bot once" error. Bot Framework retries webhooks, so
 * inbound is deduplicated on activity.id (in-memory LRU).
 */

import { toPlainText } from '../lib/markdown.mjs';
import { renderSegments } from '../lib/segments.mjs';
import { sendError, withRetryLadder } from '../lib/send-util.mjs';
import { createJwtValidator } from './jwt.mjs';
import { createTokenProvider } from './token.mjs';

const SEEN_LRU_MAX = 200;

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

/** NormalizedMessage -> AdaptiveCard 1.2 activity attachment (ported shape
 *  from the pre-1.0 webhook_out renderAsTeamsCard). */
export function renderCard(msg) {
  const body = [];
  if (msg.title) {
    body.push({ type: 'TextBlock', size: 'Medium', weight: 'Bolder', wrap: true, text: `${SEVERITY_ICON[msg.severity] || ''} ${msg.title}`.trim() });
  }
  body.push({ type: 'TextBlock', wrap: true, text: renderSegments({ ...msg, title: null }, PLAIN_STYLE) });
  return {
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: { type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.2', body },
  };
}

/** Strip the bot's <at>…</at> mention tags Teams injects into channel posts. */
export function stripMentions(text) {
  return String(text || '').replace(/<at>.*?<\/at>/g, '').replace(/\s+/g, ' ').trim();
}

export function createTeamsWorker(ctx, {
  fetchFn = globalThis.fetch,
  _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
} = {}) {
  const { appId, appPassword, tenantType, tenantId } = ctx.config;
  const validator = createJwtValidator({ appId, fetchFn, now });
  const tokens = createTokenProvider({ appId, appPassword, tenantType, tenantId, fetchFn, now });
  const seenActivityIds = [];

  const conversations = async () => (await ctx.state.get('conversations')) || {};

  async function rememberConversation(activity) {
    const conv = activity.conversation;
    if (!conv?.id || !activity.serviceUrl) return;
    const all = await conversations();
    all[conv.id] = {
      serviceUrl: activity.serviceUrl,
      tenantId: activity.channelData?.tenant?.id ?? null,
      channelId: activity.channelId ?? 'msteams',
      botId: activity.recipient?.id ?? null,
      user: activity.from ? { id: activity.from.id, name: activity.from.name ?? null, aadObjectId: activity.from.aadObjectId ?? null } : null,
      isGroup: conv.isGroup === true || conv.conversationType === 'channel',
      lastSeen: new Date(now()).toISOString(),
    };
    await ctx.state.set('conversations', all);
  }

  async function postActivity(serviceUrl, conversationId, activity) {
    const base = serviceUrl.endsWith('/') ? serviceUrl : `${serviceUrl}/`;
    const url = `${base}v3/conversations/${encodeURIComponent(conversationId)}/activities${activity.replyToId ? `/${encodeURIComponent(activity.replyToId)}` : ''}`;
    let refreshed = false;
    return withRetryLadder(async () => {
      const token = await tokens.get();
      let res;
      try {
        res = await fetchFn(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(activity),
        });
      } catch (err) {
        throw sendError('network', err?.message || String(err));
      }
      if (res.status === 429) {
        const retryAfterMs = (Number(res.headers?.get?.('retry-after')) || 2) * 1000;
        return { retryAfterMs };
      }
      if (res.status === 401) {
        if (!refreshed) { refreshed = true; tokens.invalidate(); return { retryAfterMs: 1 }; } // one forced refresh
        throw sendError('auth', 'Bot Framework rejected the AAD token — check appId/appPassword/tenant');
      }
      if (res.status === 403) throw sendError('plugin', 'forbidden: the bot is not a member of this conversation');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw sendError('plugin', `post activity failed: ${data.error?.message || `HTTP ${res.status}`}`);
      }
      return undefined;
    }, _sleep);
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

    async stop() {},

    /** Inbound webhook frame from the host ingress. Returns the HTTP answer. */
    async handleWebhook({ headers, bodyB64 }) {
      let activity;
      try { activity = JSON.parse(Buffer.from(bodyB64 || '', 'base64').toString('utf8')); }
      catch { return { statusCode: 400 }; }

      if (ctx.mock !== true) {
        const check = await validator.validate(headers?.authorization, activity?.serviceUrl);
        if (!check.ok) {
          ctx.log('warn', `rejected inbound activity: ${check.reason}`);
          return { statusCode: 401 };
        }
      }

      // Bot Framework retries non-2xx AND can redeliver: dedupe on activity.id.
      if (activity.id) {
        if (seenActivityIds.includes(activity.id)) return { statusCode: 200 };
        seenActivityIds.push(activity.id);
        if (seenActivityIds.length > SEEN_LRU_MAX) seenActivityIds.shift();
      }

      await rememberConversation(activity);

      if (activity.type === 'message') {
        ctx.emitMessage({
          chatId: String(activity.conversation?.id || ''),
          userId: String(activity.from?.aadObjectId || activity.from?.id || ''),
          text: stripMentions(activity.text),
          meta: {
            platform: 'teams',
            activityId: activity.id ?? null,
            serviceUrl: activity.serviceUrl ?? null,
            tenantId: activity.channelData?.tenant?.id ?? null,
            name: activity.from?.name ?? null,
            replyToId: activity.id ?? null,
          },
        });
      }
      // conversationUpdate etc. only feed the conversation store.
      return { statusCode: 200 };
    },

    /** Outbound: reply/proactive to a SEEN conversation (v1 scope cut). */
    async send(chatId, msg) {
      const all = await conversations();
      const ref = all[chatId];
      if (!ref) {
        throw sendError('plugin', `conversation ${chatId} not seen yet — the user must message the bot once (or @mention it in the channel) before worca-cc can notify it`);
      }
      await postActivity(ref.serviceUrl, chatId, {
        type: 'message',
        from: { id: ref.botId || appId },
        conversation: { id: chatId },
        attachments: [renderCard(msg)],
      });
      return { ok: true };
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
