// src/core/ask/schedule-spec.mjs
// Scheduled runs in Ask Worca (docs/scheduled-runs.md "Ask Worca"). Pure: the clock, the
// user's timezone and every reader are injected, so the MCP child validates for the model's
// self-correction and the parent re-validates authoritatively — the split proposal.mjs and
// metrics-proposal.mjs make. Nothing here writes.
//
// The model never does date arithmetic. It passes the user's words in the CLI's forms
// ("tomorrow 02:00", "+90m", "weekdays 02:00") and gets back the instant, the sentence and
// the next dates, computed by the same shared module the schedule editor uses.
import { basename } from 'node:path';
import {
  parseAt, parseEvery, normalizeRule, previewOccurrences, describeRule, formatInstant, localDate,
  isValidTimeZone, zonedParts, OVERLAP_POLICIES,
} from '../../shared/schedule/recurrence.mjs';
import { ASK_LIMITS } from './limits.mjs';

/** A one-off run further out than this is almost certainly a misread date. */
export const MAX_AHEAD_MS = 366 * 86_400_000;
export const SCHEDULE_CHANGE_ACTIONS = Object.freeze(['run_now', 'move', 'edit', 'cancel', 'delete']);

/** Run chains: a predecessor that already ended, by its row's status — the words core's predecessorState
 *  uses (BAD_TICKET_REASON / BAD_PIPELINE_REASON), so the pinned sentence reads the same from Ask. */
const ENDED_TICKET = Object.freeze({ canceled: 'was canceled', missed: 'was missed', failed: 'could not start', skipped: 'was skipped' });
const ENDED_PIPELINE = Object.freeze({ error: 'ended with an error', stopped: 'was stopped', interrupted: 'was interrupted' });

const str = (v) => (typeof v === 'string' ? v.trim() : '');
// eslint-disable-next-line no-control-regex
const BREAKS_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
const clip = (v, n) => String(v ?? '').replace(BREAKS_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
/** The CLI parsers name their flag; the model passed a field, so the field is named instead. */
const fieldError = (msg, field) => String(msg || '').replace(/--(?:every|at)\b:?\s*/g, '').replace(/^/, `${field}: `);

/** The zone to read the user's words in: theirs when the browser sent a valid one, else this machine's. */
export function effectiveTimeZone(tz) {
  if (isValidTimeZone(tz)) return tz;
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** "Sat Sep 19, 02:00" — with the year only when it is not this year. */
export function whenText(ms, tz, nowMs) {
  return formatInstant(ms, tz, { withYear: zonedParts(ms, tz).y !== zonedParts(nowMs, tz).y });
}

function endOf(input, errors) {
  const until = str(input.until);
  const hasCount = input.count !== undefined && input.count !== null && input.count !== '';
  if (until && hasCount) { errors.push('give until OR count, not both'); return null; }
  if (until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) { errors.push('until must be a date, YYYY-MM-DD'); return null; }
    return { type: 'until', until };
  }
  if (hasCount) {
    const c = Number(input.count);
    if (!Number.isInteger(c) || c < 1 || c > 1000) { errors.push('count must be a whole number from 1 to 1000'); return null; }
    return { type: 'count', count: c };
  }
  return undefined;
}

/** A rule's preview: the sentence and the next dates, as the card and the tool show them. */
export function describeSeries(rule, nowMs, n = 3) {
  return {
    sentence: describeRule(rule),
    next: previewOccurrences(rule, nowMs, n).map((ms) => ({ at: new Date(ms).toISOString(), when: whenText(ms, rule.tz, nowMs) })),
  };
}

/**
 * Resolve the schedule fields of a propose_run / preview_schedule input.
 * @param {{when?:string, every?:string, until?:string, count?:number, overlap?:string, maxFailures?:number}} input
 * @param {{nowMs:number, timeZone?:string, defaults?:{maxFailures?:number}, afterRef?:Function}} opts
 * @returns {{ok:true, schedule:null|object}|{ok:false, errors:string[]}}
 */
export function resolveScheduleSpec(input = {}, { nowMs, timeZone = null, defaults = {}, afterRef = null } = {}) {
  const inp = input && typeof input === 'object' ? input : {};
  const tz = effectiveTimeZone(timeZone);
  const when = str(inp.when);
  const every = str(inp.every);
  const after = str(inp.after);
  const errors = [];
  const repeatOnly = ['until', 'count', 'overlap', 'maxFailures'].filter((k) => inp[k] !== undefined && inp[k] !== null && inp[k] !== '');
  // `sourceFromPrevious: false` is NOT "given" — a plain timed proposal may carry it.
  const afterOnly = ['afterPolicy', 'sourceFromPrevious'].filter((k) => (k === 'sourceFromPrevious' ? inp[k] === true : inp[k] !== undefined && inp[k] !== null && inp[k] !== ''));
  if ([when, every, after].filter(Boolean).length > 1) return { ok: false, errors: ['give when (run once), every (repeat) OR after (another run), not both'] };
  if (!after && afterOnly.length) return { ok: false, errors: [`${afterOnly.join(', ')} only appl${afterOnly.length === 1 ? 'ies' : 'y'} with after`] };
  if (after) {
    if (repeatOnly.length) return { ok: false, errors: [`${repeatOnly.join(', ')} only apply with every`] };
    if (typeof afterRef !== 'function') return { ok: false, errors: ['after: scheduled runs are unavailable here'] };
    const policy = inp.afterPolicy === undefined || inp.afterPolicy === null || inp.afterPolicy === '' ? 'done' : inp.afterPolicy;
    if (!['done', 'any'].includes(policy)) return { ok: false, errors: ['afterPolicy must be one of done | any'] };
    if (inp.sourceFromPrevious !== undefined && inp.sourceFromPrevious !== null && typeof inp.sourceFromPrevious !== 'boolean') return { ok: false, errors: ['sourceFromPrevious must be true or false'] };
    if (after.startsWith('sch_')) return { ok: false, errors: ['after: a repeating schedule is not supported — give the id of one of its runs'] };
    const ref = afterRef(after);
    if (!ref) return { ok: false, errors: [`after: no run or scheduled run has id ${after}`] };
    if (ref.scheduleId) return { ok: false, errors: ['after: a repeating schedule is not supported — give the id of one of its runs'] };
    const name = `‘${ref.title || after.slice(0, 8)}’`;
    const projectKey = str(inp.projectKey);
    const workspaceId = str(inp.workspaceId);
    if (workspaceId && !ref.workspaceId) return { ok: false, errors: [`after: ${name} targets a project; this run targets a workspace`] };
    if (workspaceId && ref.workspaceId !== workspaceId) return { ok: false, errors: [`after: ${name} targets another workspace; this run targets ${workspaceId}`] };
    if (!workspaceId && ref.workspaceId) return { ok: false, errors: [`after: ${name} targets a workspace; this run targets a project`] };
    if (projectKey && ref.projectKey && ref.projectKey !== projectKey) return { ok: false, errors: [`after: ${name} targets another project`] };
    // The outcome, from the row's status alone (no DB here): a ticket that already ended can never be waited
    // for; a pipeline that ended badly only under `any`. A fired ticket whose pipeline ended badly is not
    // visible here (its status is `fired`) — POST /api/run's resolveAfterRef is the final gate for that one.
    const ended = ref.kind === 'ticket' ? ENDED_TICKET[ref.status] : (policy === 'any' ? null : ENDED_PIPELINE[ref.status]);
    if (ended) return { ok: false, errors: [`after: ${name} ${ended} — nothing to wait for`] };
    return { ok: true, schedule: { kind: 'after', after: { kind: ref.kind, id: ref.id, title: ref.title || null, status: ref.status || null }, policy,
      sourceFromPrevious: inp.sourceFromPrevious === true, text: `After ${name} finishes` } };
  }
  if (!when && !every) {
    if (repeatOnly.length) return { ok: false, errors: [`${repeatOnly.join(', ')} only apply with every`] };
    return { ok: true, schedule: null };
  }
  if (when) {
    if (repeatOnly.length) return { ok: false, errors: [`${repeatOnly.join(', ')} only apply with every`] };
    const at = parseAt(when, { nowMs, tz });
    if (!at.ok) return { ok: false, errors: [fieldError(at.error, 'when')] };
    if (at.ms < nowMs - 5_000) return { ok: false, errors: [`when: ${whenText(at.ms, tz, nowMs)} (${tz}) is in the past`] };
    if (at.ms > nowMs + MAX_AHEAD_MS) return { ok: false, errors: ['when: more than a year ahead — check the date'] };
    return { ok: true, schedule: { kind: 'once', runAt: new Date(at.ms).toISOString(), when: whenText(at.ms, tz, nowMs), timeZone: tz } };
  }
  const parsed = parseEvery(every);
  if (!parsed.ok) return { ok: false, errors: [fieldError(parsed.error, 'every')] };
  const end = endOf(inp, errors);
  let overlap = 'skip';
  if (inp.overlap !== undefined && inp.overlap !== null && inp.overlap !== '') {
    if (!OVERLAP_POLICIES.includes(inp.overlap)) errors.push(`overlap must be one of ${OVERLAP_POLICIES.join(' | ')}`);
    else overlap = inp.overlap;
  }
  let maxFailures = Number.isSafeInteger(defaults.maxFailures) ? defaults.maxFailures : 3;
  if (inp.maxFailures !== undefined && inp.maxFailures !== null && inp.maxFailures !== '') {
    const n = Number(inp.maxFailures);
    if (!Number.isSafeInteger(n) || n < 0 || n > 100) errors.push('maxFailures must be a whole number from 0 to 100 (0 = never pause)');
    else maxFailures = n;
  }
  if (errors.length) return { ok: false, errors };
  const norm = normalizeRule({ ...parsed.rule, tz, ...(end ? { end } : {}) }, { todayLocal: localDate(nowMs, tz) });
  if (!norm.ok) return { ok: false, errors: [fieldError(norm.error, 'every')] };
  const series = describeSeries(norm.rule, nowMs);
  if (!series.next.length) return { ok: false, errors: ['every: this schedule has no future run — check until / count'] };
  return { ok: true, schedule: { kind: 'repeat', rule: norm.rule, ...series, overlap, maxFailures, timeZone: tz } };
}

/** The POST /api/run fields a card's schedule turns into. */
export function scheduleRequestFields(schedule) {
  if (!schedule || typeof schedule !== 'object') return {};
  if (schedule.kind === 'once') return { scheduledFor: schedule.runAt };
  if (schedule.kind === 'repeat') return { repeat: { rule: schedule.rule, overlap: schedule.overlap, maxFailures: schedule.maxFailures } };
  if (schedule.kind === 'after') return { after: { kind: schedule.after.kind, id: schedule.after.id }, afterPolicy: schedule.policy || 'done', ...(schedule.sourceFromPrevious ? { sourceFromPrevious: true } : {}) };
  return {};
}

const targetName = (item) => (item.workspaceId ? item.workspaceId : item.projectDir ? basename(item.projectDir) : '');
const itemTitle = (item) => clip(item.title || (item.summary && item.summary.prompt) || 'Scheduled run', 120);

/**
 * propose_schedule_change: validate one change to an existing schedule and build its card.
 * Readers: getItem(id) -> {kind:'once'|'recurring', item} | null (scheduler rows).
 * @returns {Promise<{ok:true, card:object}|{ok:false, errors:string[]}>}
 */
export function createScheduleChangeValidator({ getItem, afterRef = null, now = Date.now }) {
  return async function validateScheduleChange(input = {}, { timeZone = null } = {}) {
    const raw = input && typeof input === 'object' ? input : {};
    const id = str(raw.id);
    const action = str(raw.action);
    if (!SCHEDULE_CHANGE_ACTIONS.includes(action)) return { ok: false, errors: [`action must be one of ${SCHEDULE_CHANGE_ACTIONS.join(', ')}`] };
    if (!id) return { ok: false, errors: ['id is required (a schedule id sch_… or a scheduled run id from list_schedules)'] };
    const found = await getItem(id);
    if (!found) return { ok: false, errors: [`no schedule or scheduled run "${id}" — list_schedules shows the ids`] };
    const { kind, item } = found;
    const nowMs = now();
    const title = itemTitle(item);
    const occurrence = kind === 'once' && !!item.scheduleId;
    const card = {
      type: 'schedule', action, id: item.id, itemKind: kind, title, targetName: clip(targetName(item), 120),
      status: item.status, scheduleId: kind === 'recurring' ? item.id : item.scheduleId || null,
      note: clip(raw.note, ASK_LIMITS.proposalNoteMaxChars), summary: '', before: null, after: null, patch: null,
    };
    const tzOf = () => (kind === 'recurring' ? item.rule?.tz : effectiveTimeZone(timeZone));
    const beforeOnce = () => ({ when: whenText(Date.parse(item.runAt), effectiveTimeZone(timeZone), nowMs), at: item.runAt });
    // Run chains: an after-ticket's runAt is the 9999 sentinel — its "before" is the run it waits for, by
    // TITLE through the injected reader (rowToTicket's `after` carries only the id), with `at: null`
    // (there is no time). Every arm that names the current state of a one-off reads this, never beforeOnce.
    const beforeCurrent = () => {
      if (!item.after) return beforeOnce();
      const prevRef = typeof afterRef === 'function' ? afterRef(item.after.id) : null;
      return { when: `after ‘${(prevRef && prevRef.title) || item.after.id.slice(0, 8)}’`, at: null };
    };
    const beforeSeries = () => ({ sentence: item.sentence, when: item.nextRunAt ? whenText(Date.parse(item.nextRunAt), item.rule.tz, nowMs) : null, at: item.nextRunAt });
    const errors = [];
    switch (action) {
      case 'run_now': {
        if (kind === 'recurring' && item.status === 'ended') return { ok: false, errors: ['this schedule has ended'] };
        if (kind === 'once' && !['scheduled', 'missed'].includes(item.status)) return { ok: false, errors: [`this run is ${item.status} and cannot be started`] };
        card.before = kind === 'recurring' ? beforeSeries() : beforeCurrent();
        card.summary = kind === 'recurring' ? `Run "${title}" once now — the schedule keeps its times` : `Start "${title}" now instead of ${card.before.when}`;
        break;
      }
      case 'move': {
        if (kind !== 'once') return { ok: false, errors: ['move changes a one-off run — for a repeating schedule use action "edit" with every'] };
        if (occurrence) return { ok: false, errors: ['this is one occurrence of a repeating schedule — edit the schedule, or skip this occurrence with skip_next_run'] };
        if (!['scheduled', 'missed'].includes(item.status)) return { ok: false, errors: [`this run is ${item.status} and can no longer be moved`] };
        if (str(raw.after)) {
          if (str(raw.when)) return { ok: false, errors: ['move: give when OR after, not both'] };
          const aspec = resolveScheduleSpec({ after: raw.after, afterPolicy: raw.afterPolicy ?? (item.after ? item.after.policy : undefined), sourceFromPrevious: raw.sourceFromPrevious ?? item.sourceFromPrevious,   // a re-chaining keeps the ticket's branch choice, like afterPolicy
            projectKey: item.projectKey, workspaceId: item.workspaceId }, { nowMs, timeZone: tzOf(), afterRef });
          if (!aspec.ok) return { ok: false, errors: aspec.errors.map((e) => `move: ${e.replace(/^after: /, '')}`) };   // no `move: after: …` double prefix
          if (aspec.schedule.after.kind === 'ticket' && aspec.schedule.after.id === item.id) return { ok: false, errors: ['move: a run cannot wait for itself'] };
          card.before = beforeCurrent();   // an after-ticket's "before" is its predecessor, never the 9999 sentinel
          // `card.after` means "the state AFTER the change" in this validator — the predecessor
          // itself rides under `afterRun` so the two senses never collide.
          card.after = { afterRun: aspec.schedule.after, policy: aspec.schedule.policy, sourceFromPrevious: aspec.schedule.sourceFromPrevious, text: aspec.schedule.text };
          // scheduleRequestFields omits a falsy sourceFromPrevious — right for POST (the column defaults
          // to 0), wrong for a PATCH (omitted = keep): say it explicitly whenever the change flips it.
          card.patch = { ...scheduleRequestFields(aspec.schedule), ...(aspec.schedule.sourceFromPrevious !== !!item.sourceFromPrevious ? { sourceFromPrevious: aspec.schedule.sourceFromPrevious } : {}) };
          card.summary = `${title}: ${aspec.schedule.text.replace(/^After/, 'after')}`;
          break;
        }
        const spec = resolveScheduleSpec({ when: raw.when }, { nowMs, timeZone: tzOf() });
        if (!spec.ok) return spec;
        if (!spec.schedule) return { ok: false, errors: ['move needs when'] };
        card.before = beforeCurrent();
        card.after = { when: spec.schedule.when, at: spec.schedule.runAt, timeZone: spec.schedule.timeZone };
        card.patch = { scheduledFor: spec.schedule.runAt };
        card.summary = `Move "${title}" from ${card.before.when} to ${card.after.when}`;
        break;
      }
      case 'edit': {
        if (kind !== 'recurring') return { ok: false, errors: ['edit changes a repeating schedule — for a one-off run use action "move"'] };
        if (item.status === 'ended') return { ok: false, errors: ['this schedule has ended — propose a new run with every instead'] };
        const patch = {};
        const hasEnd = ['until', 'count'].some((k) => raw[k] !== undefined && raw[k] !== null && raw[k] !== '');
        if (str(raw.every) || hasEnd) {
          let rule;
          if (str(raw.every)) {
            const parsed = parseEvery(str(raw.every));
            if (!parsed.ok) return { ok: false, errors: [fieldError(parsed.error, 'every')] };
            rule = { ...parsed.rule, tz: item.rule.tz, anchor: item.rule.anchor, end: item.rule.end };
          } else rule = { ...item.rule };
          const end = endOf(raw, errors);
          if (errors.length) return { ok: false, errors };
          if (end) rule.end = end;
          const norm = normalizeRule(rule, { todayLocal: localDate(nowMs, item.rule.tz) });
          if (!norm.ok) return { ok: false, errors: [fieldError(norm.error, 'every')] };
          if (!previewOccurrences(norm.rule, nowMs, 1).length) return { ok: false, errors: ['the edited schedule has no future run — check until / count'] };
          patch.rule = norm.rule;
        }
        if (raw.overlap !== undefined && raw.overlap !== null && raw.overlap !== '') {
          if (!OVERLAP_POLICIES.includes(raw.overlap)) errors.push(`overlap must be one of ${OVERLAP_POLICIES.join(' | ')}`);
          else if (raw.overlap !== item.overlap) patch.overlap = raw.overlap;
        }
        if (raw.maxFailures !== undefined && raw.maxFailures !== null && raw.maxFailures !== '') {
          const n = Number(raw.maxFailures);
          if (!Number.isSafeInteger(n) || n < 0 || n > 100) errors.push('maxFailures must be a whole number from 0 to 100 (0 = never pause)');
          else if (n !== item.maxFailures) patch.maxFailures = n;
        }
        const newTitle = clip(raw.title, 120);
        if (newTitle && newTitle !== item.title) patch.title = newTitle;
        if (errors.length) return { ok: false, errors };
        if (!Object.keys(patch).length) return { ok: false, errors: ['nothing to change — give every, until, count, overlap, maxFailures or title with a new value'] };
        card.before = { ...beforeSeries(), overlap: item.overlap, maxFailures: item.maxFailures, title: item.title };
        const rule = patch.rule || item.rule;
        card.after = { ...describeSeries(rule, nowMs), overlap: patch.overlap ?? item.overlap, maxFailures: patch.maxFailures ?? item.maxFailures, title: patch.title ?? item.title };
        card.patch = patch;
        const parts = [];
        if (patch.rule) parts.push(`${card.after.sentence}`);
        if (patch.overlap) parts.push(`overlap ${patch.overlap}`);
        if (patch.maxFailures !== undefined) parts.push(patch.maxFailures === 0 ? 'never pause on failures' : `pause after ${patch.maxFailures} failures in a row`);
        if (patch.title) parts.push(`rename to "${patch.title}"`);
        card.summary = `Change "${title}": ${parts.join('; ')}`;
        break;
      }
      case 'cancel': {
        if (kind !== 'once') return { ok: false, errors: ['cancel is for a one-off run — a repeating schedule is paused (pause_schedule) or deleted (action "delete")'] };
        if (occurrence) return { ok: false, errors: ['this is one occurrence of a repeating schedule — skip it with skip_next_run instead'] };
        if (!['scheduled', 'missed'].includes(item.status)) return { ok: false, errors: [`this run is ${item.status} and can no longer be canceled`] };
        card.before = beforeCurrent();
        card.summary = item.after ? `Cancel "${title}", waiting for ${card.before.when.replace(/^after /, '')}` : `Cancel "${title}", scheduled for ${card.before.when}`;
        break;
      }
      case 'delete': {
        if (kind !== 'recurring') return { ok: false, errors: ['delete removes a repeating schedule — a one-off run is canceled (action "cancel")'] };
        card.before = beforeSeries();
        card.summary = `Delete the schedule "${title}" (${item.sentence})`;
        break;
      }
      default: break;
    }
    return { ok: true, card };
  };
}

const eventText = (s, n) => clip(s, n).replace(/"/g, "'").replace(/\[(\/?)worca context\]/gi, '($1worca context)');

/** `[worca event] …` — the synthetic turn's prompt after the user acted on a schedule card. */
export function scheduleEventPrompt({ cardId, state, card = {}, result = null }) {
  const summary = eventText(card.summary, 200);
  if (state === 'declined') return `[worca event] schedule card ${cardId} declined; "${summary}"`;
  if (state === 'failed') return `[worca event] schedule card ${cardId} failed: ${eventText(result?.error || 'unknown error', 200)}; "${summary}"`;
  return `[worca event] schedule card ${cardId} applied; "${summary}"${result?.detail ? `; ${eventText(result.detail, 300)}` : ''}`;
}

/** The user-row notice above the event turn. */
export function scheduleNoticeText({ state, card = {}, result = null }) {
  const s = clip(card.summary, 160);
  if (state === 'declined') return `Declined — ${s}`;
  if (state === 'failed') return `Could not apply — ${s}: ${clip(result?.error || 'unknown error', 200)}`;
  return `Applied — ${s}${result?.detail ? ` · ${clip(result.detail, 200)}` : ''}`;
}
