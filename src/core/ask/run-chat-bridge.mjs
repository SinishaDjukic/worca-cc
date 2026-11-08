// src/core/ask/run-chat-bridge.mjs — cross-chat messaging slice 2: the in-process adapter a run's orchestrator posts
// through (`orch.chatPoster`). It stamps the live run id, turns a thrown messenger into a refusal code, and maps the
// run question's outcome (answered by `_questionsLoop`, closed by the server's `resolvePending`) onto the chat record.
import { RUN_QUESTION_KEEP_REASONS } from '../run-chat-posts.mjs';

/** deps: { messenger: createChatMessenger(...), findLiveRun(pipelineId) → runs-Map entry|null, log? }. */
export function createRunChatBridge({ messenger, findLiveRun, log = null }) {
  const warn = (msg) => { try { log?.('warn', msg); } catch { /* logging never breaks a post */ } };
  return {
    enabled: () => !!messenger.enabled(),

    /** Never rejects: a thrown messenger answers {ok:false, code:'CHAT_MESSAGE_ERROR'}. */
    async post(sender, input) {
      try {
        const live = findLiveRun(sender?.pipelineId);
        return await messenger.postFromRun({ ...sender, liveRunId: live?.id ?? null }, input);
      } catch (e) {
        const error = String(e?.message || e);
        warn(`run chat post failed: ${error}`);
        return { ok: false, code: 'CHAT_MESSAGE_ERROR', error };
      }
    },

    answered({ chatId, messageId, askId }, { answers, actedBy }) {
      try { messenger.markRunQuestion({ chatId, messageId, askId }, { state: 'answered', answers, actedBy }); } catch (e) { warn(`run chat answer mark failed: ${e?.message || e}`); }
    },

    /** `event` is the run's pending question frame (`{id, chat:{chatId, messageId}}`), `reason` resolvePending's. */
    closed(event, reason) {
      const why = String(reason || 'resolved');
      if (!event?.chat?.chatId || RUN_QUESTION_KEEP_REASONS.has(why)) return;
      try { messenger.markRunQuestion({ ...event.chat, askId: event.id }, { state: 'closed', reason: why }); } catch (e) { warn(`run chat close mark failed: ${e?.message || e}`); }
    },
  };
}
