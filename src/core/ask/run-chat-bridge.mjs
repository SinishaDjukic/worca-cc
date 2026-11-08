// src/core/ask/run-chat-bridge.mjs — cross-chat messaging slice 2: the in-process adapter a run's orchestrator posts
// through (`orch.chatPoster`). It stamps the live run id, turns a thrown messenger into a refusal code, and maps the
// run question's outcome (answered by `_questionsLoop`, closed by the server's `resolvePending`) onto the chat record.
// Slice 3: a run question answered from the chat's channel thread goes through the server's `answerRun` here.
import { RUN_QUESTION_KEEP_REASONS } from '../run-chat-posts.mjs';

const ANSWER_ERROR_MAX = 300;
const refused = (status, code, error) => ({ status, body: { code, error } });
const NOT_FOUND = () => refused(404, 'CHAT_QUESTION_NOT_FOUND', 'This question is no longer in the chat.');
const BAD_ANSWER = () => refused(400, 'CHAT_QUESTION_BAD_ANSWER', 'Answer every question.');
const oneLine = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
const clip = (v, n) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);
/** An INVALID_ANSWER's errors (strings or {path, code, message}) as one line of at most 300 characters. */
function invalidText(err) {
  const list = Array.isArray(err?.errors) ? err.errors : [];
  const text = list.map((e) => (typeof e === 'string' ? e : String(e?.message || e?.code || ''))).filter(Boolean).join('; ');
  return clip(oneLine(text || err?.message || 'invalid answer'), ANSWER_ERROR_MAX);
}

/** The run's answer for one question from a press: a select's option index, or a modal's typed text. null = bad. */
function choiceOf(question, choices) {
  if (!Array.isArray(choices) || choices.length !== 1) return null;
  const c = choices[0];
  if (!c || typeof c !== 'object' || c.index !== 0) return null;
  const options = Array.isArray(question?.options) ? question.options : [];
  if (c.value !== undefined) {
    const v = String(c.value);
    if (!/^\d{1,3}$/.test(v) || Number(v) >= options.length) return null;
    return String(options[Number(v)]);
  }
  const text = typeof c.text === 'string' ? c.text.trim() : '';
  return text || null;
}

/** deps: { messenger: createChatMessenger(...), findLiveRun(pipelineId) → runs-Map entry|null,
 *  answerRun?(runId, askId, payload, by) (the server's: the one path every run answer takes), log? }. */
export function createRunChatBridge({ messenger, findLiveRun, answerRun = null, log = null }) {
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

    /**
     * Slice 3: answer the run question `messageId` of chat `chatId` from a channel press. Synchronous and never throws:
     * answers `{status, body}`. `choices` = [{index, value?|text?}] (a select's option index or a modal's text); `by` =
     * the person ("ada via Discord"). The record and the run's pending question are re-read here, and the pending check
     * and answerRun run with no await between them. The chat record is marked by the orchestrator's chatPoster.answered.
     */
    answerFromChat({ chatId, messageId, choices, by }) {
      try {
        if (typeof answerRun !== 'function') return { status: 500, body: { error: 'answering is unavailable' } };
        const block = messenger.readIncoming(chatId, messageId);
        const q = block?.question;
        if (!block || block.from?.kind !== 'run' || !q || typeof q !== 'object') return NOT_FOUND();
        if (q.state !== 'open') return refused(409, 'CHAT_QUESTION_CLOSED', 'This question was already answered or closed.');
        const questions = Array.isArray(q.questions) ? q.questions : [];
        if (questions.length !== 1) return BAD_ANSWER();      // a larger round has no control: answered in worca
        const choice = choiceOf(questions[0], choices);
        if (choice === null) return BAD_ANSWER();
        // By pipeline id: the runs-Map key changes on every resume. From here to answerRun: no await.
        const live = findLiveRun(block.from.runId);
        if (!live || live.pendingQuestion?.id !== q.askId) return refused(409, 'CHAT_QUESTION_CLOSED', 'The run is no longer waiting for this answer.');
        try {
          answerRun(live.id, q.askId, { answers: [{ id: questions[0].id, choice }] }, by);
        } catch (e) {
          if (e?.code === 'INVALID_ANSWER') return refused(422, 'CHAT_QUESTION_INVALID', `That answer was not accepted: ${invalidText(e)}`);
          return { status: 500, body: { error: clip(oneLine(e?.message || e), ANSWER_ERROR_MAX) } };
        }
        return { status: 200, body: { ok: true } };
      } catch (e) {
        warn(`run chat answer failed: ${e?.message || e}`);
        return { status: 500, body: { error: clip(oneLine(e?.message || e), ANSWER_ERROR_MAX) } };
      }
    },

    /** `event` is the run's pending question frame (`{id, chat:{chatId, messageId}}`), `reason` resolvePending's. */
    closed(event, reason) {
      const why = String(reason || 'resolved');
      if (!event?.chat?.chatId || RUN_QUESTION_KEEP_REASONS.has(why)) return;
      try { messenger.markRunQuestion({ ...event.chat, askId: event.id }, { state: 'closed', reason: why }); } catch (e) { warn(`run chat close mark failed: ${e?.message || e}`); }
    },
  };
}
