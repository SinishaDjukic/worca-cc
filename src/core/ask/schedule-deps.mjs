// src/core/ask/schedule-deps.mjs
// The scheduled-runs dependency bundle of the Ask Worca tools (docs/scheduled-runs.md
// "Ask Worca"): the ONE module that touches the scheduler on the tools' behalf. tools.mjs
// imports nothing, so every reader, the validators and the four small writers live here.
// Two callers:
//   • the MCP child (mcp-stdio.mjs): deps.schedules.* behind list_schedules, get_schedule,
//     list_schedule_activity, preview_schedule, propose_schedule_change (validate only — the
//     card is the user's to apply) and the direct pause / resume / skip / mark-read tools;
//   • the parent: turn.mjs re-validates a change with validateScheduleChange.
// The writers are the reversible ones that never start a run. Anything that starts, moves,
// edits or removes a run is a card, applied by ui/server.mjs behind the user's click.
import { getThread } from './store.mjs';
import {
  listSchedules, listTickets, getSchedule, getTicket, pauseSchedule, resumeSchedule, skipNext, scheduleCounts,
} from '../scheduler.mjs';
import { listNotifications, markRead, markAllRead, unreadCount } from '../notifications.mjs';
import { scheduleDefaults } from '../settings.mjs';
import { createScheduleChangeValidator, resolveScheduleSpec, effectiveTimeZone, whenText } from './schedule-spec.mjs';
import { previewOccurrences } from '../../shared/schedule/recurrence.mjs';

/** A schedule (sch_…) or a scheduled run (its runId) by id. */
export function getScheduleItem(id) {
  if (typeof id !== 'string' || !id) return null;
  if (id.startsWith('sch_')) { const s = getSchedule(id); return s ? { kind: 'recurring', item: s } : null; }
  const t = getTicket(id);
  return t ? { kind: 'once', item: t } : null;
}

/** The authoritative validator over the real rows (the turn's default; the child's too). */
export const validateScheduleChange = createScheduleChangeValidator({ getItem: getScheduleItem });

/** The timezone the user's browser reported for this thread, else this machine's. */
export function threadTimeZone(threadId) {
  let tz = null;
  try { tz = threadId ? getThread(threadId)?.context?.timeZone ?? null : null; } catch { tz = null; }
  return effectiveTimeZone(tz);
}

/**
 * @param {{threadId?:string|null}} [o]
 */
export function defaultScheduleDeps({ threadId = null } = {}) {
  return {
    schedules: {
      timeZone: () => threadTimeZone(threadId),
      now: () => Date.now(),
      defaults: () => scheduleDefaults(),
      /** An ISO instant as the user reads it: "Sat Sep 19, 02:00" in their zone. */
      when: (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? whenText(ms, threadTimeZone(threadId), Date.now()) : null; },
      /** A series' next dates, in the series' own zone. */
      nextDates: (rule, firedCount = 0) => (rule ? previewOccurrences(rule, Date.now(), 3, { firedCount })
        .map((ms) => ({ at: new Date(ms).toISOString(), when: whenText(ms, rule.tz, Date.now()) })) : []),
      list: ({ includeEnded = false } = {}) => ({
        schedules: listSchedules({ includeEnded }),
        runs: listTickets({ all: includeEnded, oneShotOnly: false, limit: 500 }),
        counts: { ...scheduleCounts(), unread: unreadCount('schedule') },
      }),
      get: (id) => {
        const found = getScheduleItem(id);
        if (!found) return null;
        const history = found.kind === 'recurring' ? listTickets({ scheduleId: found.item.id, all: true, limit: 50 }).reverse() : [];
        const notifications = listNotifications({ scheduleId: found.kind === 'recurring' ? found.item.id : null, limit: 50 })
          .filter((n) => found.kind === 'recurring' || n.ticketId === found.item.id);
        return { ...found, history, notifications };
      },
      activity: ({ unread = false, problems = false, limit = 30 } = {}) => ({
        notifications: listNotifications({ scope: 'schedule', unread, problems, limit }),
        unread: unreadCount('schedule'),
      }),
      preview: (input, { nowMs = Date.now() } = {}) => resolveScheduleSpec(input, {
        nowMs, timeZone: threadTimeZone(threadId), defaults: scheduleDefaults(),
      }),
      validateChange: (input) => validateScheduleChange(input, { timeZone: threadTimeZone(threadId) }),
      getItem: getScheduleItem,
      pause: (id) => pauseSchedule(id),
      resume: (id) => resumeSchedule(id),
      skipNext: (id) => skipNext(id),
      markRead: (ids) => ids.map((id) => markRead(id)).filter(Boolean).length,
      markAllRead: () => markAllRead('schedule'),
      unread: () => unreadCount('schedule'),
    },
  };
}
