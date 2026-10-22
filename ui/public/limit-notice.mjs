// ui/public/limit-notice.mjs
// The usage-limit pause notice's model (states A–D). Pure: app.js paints it.
// The browser cannot load src/core, so the margin mirrors recoverable-error.mjs (a test pins them equal).
import { untilText } from './openrouter-free-view.mjs';

export const LIMIT_RESUME_MARGIN_MS = 5 * 60_000;
const OPENROUTER_RE = /^OpenRouter's free-model requests/;

/** The limit's noun, from the pause detail. */
export function limitNoun(detail) {
  const s = String(detail || '');
  return /weekly limit/i.test(s) ? 'weekly limit' : /session limit/i.test(s) ? 'session limit' : 'usage limit';
}

/** The open resume ticket for a pipeline among the schedules view's tickets, or null. */
export function resumeTicketOf(tickets, pipelineId) {
  return (tickets || []).find((t) => t && t.resumePipelineId === pipelineId && !t.scheduleId
    && (t.status === 'scheduled' || t.status === 'firing' || t.status === 'missed')) || null;
}

/**
 * @param {{ pauseDetail?: string|null, whose?: string, limitResetAt?: string|null,
 *           ticket?: {id:string, runAt:string, status:string}|null, now?: number }} o
 *   whose: "Claude's " or '' (the caller owns engineLabel).
 * @returns {{ state: 'A'|'B'|'B2'|'C'|'C2'|'D', lead: string|null, timeAt: number|null, sentence: string,
 *             countdownTo: number|null, repaintAt: number|null,
 *             action: null|{kind:'schedule', at:number}|{kind:'cancel', ticketId:string} }}
 *   Copy = lead + ' ' + sentence (timeAt rendered as hh:mm in a <time>) + [', ' + countdown] + '.'
 *   repaintAt: when the model's output next changes (the tick repaints then); null = never.
 */
export function limitNotice({ pauseDetail = null, whose = '', limitResetAt = null, ticket = null, now = Date.now() }) {
  const openRouter = OPENROUTER_RE.test(pauseDetail || '');
  const lead = openRouter ? `Paused: ${pauseDetail}.` : `Paused: ${whose}${limitNoun(pauseDetail)}.`;
  const none = { timeAt: null, sentence: '', countdownTo: null, repaintAt: null, action: null };
  if (ticket) {
    const at = Date.parse(ticket.runAt);
    if (ticket.status === 'firing' || (ticket.status === 'scheduled' && Number.isFinite(at) && at <= now)) {
      return { ...none, state: 'D', lead: 'Paused: resuming…' };
    }
    const cancel = { kind: 'cancel', ticketId: ticket.id };
    if (ticket.status === 'missed') {
      return { ...none, state: 'C2', lead, timeAt: at, sentence: 'The scheduled resume at {t} was missed', action: cancel };
    }
    return { ...none, state: 'C', lead, timeAt: at, sentence: 'Resumes automatically at {t}', countdownTo: at, repaintAt: at, action: cancel };
  }
  const reset = Date.parse(limitResetAt ?? '');
  if (!Number.isFinite(reset)) return { ...none, state: 'A', lead: null };
  const at = reset + LIMIT_RESUME_MARGIN_MS;
  if (at <= now) return { ...none, state: 'B2', lead, timeAt: reset, sentence: 'It reset at {t}. Resume to continue' };
  const action = { kind: 'schedule', at };
  if (openRouter) return { ...none, state: 'B', lead, repaintAt: at, action };   // its detail already names the reset
  // Inside the margin: the limit is back but the one-click time is still ahead — no "in under a minute".
  if (reset <= now) return { ...none, state: 'B', lead, timeAt: reset, sentence: 'It reset at {t}', repaintAt: at, action };
  return { ...none, state: 'B', lead, timeAt: reset, sentence: 'It resets at {t}', countdownTo: reset, repaintAt: reset, action };
}

/** "in 2h 14m" / "in under a minute". */
export function countdownText(to, now = Date.now()) { return `in ${untilText(to - now)}`; }
