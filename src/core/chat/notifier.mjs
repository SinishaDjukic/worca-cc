// src/core/chat/notifier.mjs
// Outbound run-event notifications (chat-connectivity-design.md §4.5).
// attach(orch, {runId, entry}) subscribes to the orchestrator's question/done/
// error events — riding the exception-isolated _emit, so nothing here can
// break a run — renders them to NormalizedMessages, and fans out to every
// enabled+connected outbound channel's notifyChatIds through a per-channel
// host-side rate limiter. Workers surface platform 429s; the limiter ladder
// retries them.
//
// Core module (no Express, no orchestrator import): ui/server.mjs wires it
// today; a CLI runner can attach the same notifier later.

import { readPluginConfig } from '../plugin-config.mjs';
import { parseIdList } from './allowlist.mjs';
import { createRateLimiter } from './rate-limiter.mjs';
import { renderDone, renderError, renderQuestion } from './renderers.mjs';
import { pauseConsequences } from '../failure-policy.mjs';

/**
 * @param {{channelHost: object, getPrefs: () => {notify:object, channels:object},
 *          chatContext: {isMuted(k):boolean, incrementMuted(k):void},
 *          logger?: (level:string, msg:string) => void,
 *          ratePerMin?: number}} deps
 */
export function createNotifier({ channelHost, getPrefs, chatContext, logger = () => {}, ratePerMin = 20 }) {
  const limiters = new Map(); // "plugin/channelId" -> rate limiter

  const limiterFor = (key) => {
    let l = limiters.get(key);
    if (!l) { l = createRateLimiter({ ratePerMin, logger }); limiters.set(key, l); }
    return l;
  };

  async function deliver(message) {
    let prefs;
    try { prefs = getPrefs(); } catch { prefs = { notify: {}, channels: {} }; }
    for (const entry of channelHost.list()) {
      const key = `${entry.plugin}/${entry.channelId}`;
      if (!entry.capabilities?.outbound) continue;
      if (prefs.channels?.[key]?.enabled === false) continue;
      let chatIds = [];
      try { chatIds = parseIdList(readPluginConfig(entry.plugin, entry.configSchema).notifyChatIds); }
      catch { /* unreadable config: nothing to send to */ }
      for (const chatId of chatIds) {
        const chatKey = `${entry.platform}:${chatId}`;
        if (chatContext.isMuted(chatKey)) {
          try { chatContext.incrementMuted(chatKey); } catch { /* best effort */ }
          continue;
        }
        // Sequenced per channel by the limiter's FIFO; failures are logged,
        // never thrown (the caller is an event listener on the run).
        limiterFor(key).send(message, (m) => channelHost.sendMessage({
          plugin: entry.plugin, channelId: entry.channelId, chatId, message: m,
        })).then((sent) => {
          if (!sent) logger('warn', `chat notify dropped after rate-limit retries (${key} -> ${chatId})`);
        }).catch((err) => {
          logger('error', `chat notify failed (${key} -> ${chatId}): ${err?.message || err}`);
        });
      }
    }
  }

  return {
    /**
     * Subscribe one live run. `entry` is the server's runs-Map record — title
     * is read at SEND time (titles generate mid-run).
     */
    attach(orch, { runId, entry } = {}) {
      const meta = () => ({
        runId,
        title: entry?.title || orch?.state?.title || '',
        totalCostUsd: orch?.state?.totalCostUsd,
        totalActiveMs: orch?.state?.totalActiveMs,
      });
      const guard = (fn) => (payload) => {
        try { fn(payload); } catch (err) { logger('error', `chat notifier: ${err?.message || err}`); }
      };

      orch.on('question', guard((payload) => {
        if (getPrefsSafe().notify.question === false) return;
        deliver(renderQuestion(meta(), payload || {}));
      }));

      orch.on('error', guard((payload) => {
        if (getPrefsSafe().notify.error === false) return;
        deliver(renderError(meta(), payload || {}));
      }));

      orch.on('done', guard((payload) => {
        const status = payload?.status || 'done';
        if (status === 'error') return; // the richer 'error' event already went out
        const prefs = getPrefsSafe().notify;
        // Which preference gates a pause follows its reason (failure-policy.mjs):
        // an error-pause IS the failure notification (no 'error' event precedes
        // it), so notify.error gates it, not notify.paused.
        const gate = status === 'paused' ? prefs[pauseConsequences(payload?.reason).notifyPref] : prefs.done;
        if (gate === false) return;
        deliver(renderDone(meta(), payload || {}));
      }));

      function getPrefsSafe() {
        try { return getPrefs(); } catch { return { notify: {} }; }
      }
    },

    /** The Test button / smoke path: send one message to one channel's
     *  notifyChatIds directly (no prefs gating — an explicit user action). */
    async sendTest(plugin, channelId, message) {
      const entry = channelHost.list().find((e) => e.plugin === plugin && e.channelId === channelId);
      if (!entry) throw new Error(`no such chat channel "${plugin}/${channelId}"`);
      const chatIds = parseIdList(readPluginConfig(entry.plugin, entry.configSchema).notifyChatIds);
      if (!chatIds.length) throw new Error('notifyChatIds is not configured for this channel');
      const results = [];
      for (const chatId of chatIds) {
        try {
          await channelHost.sendMessage({ plugin, channelId, chatId, message });
          results.push({ chatId, ok: true });
        } catch (err) {
          results.push({ chatId, ok: false, error: { kind: err?.kind || 'plugin', message: err?.message || String(err) } });
        }
      }
      return { ok: results.every((r) => r.ok), results };
    },
  };
}
