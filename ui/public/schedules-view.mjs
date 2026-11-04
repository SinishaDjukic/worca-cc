// ui/public/schedules-view.mjs
// The Schedules view, three tabs (the Statistics .seg idiom): Activity — the feed (every
// miss, failure, skip, late start and self-pause, with read state); Once — one-off runs;
// Repeating — the series. app.js owns routing and the WebSocket; this module owns the
// hosts it is given and routes a tab click through `deps.route(tab)` (#schedules/<tab>).
//
//   const view = createSchedulesView({ tabsHost, feedHost, onceHost, repeatingHost, subEl, msgEl, deps });
//   view.load()          fetch + paint (view entry, `schedules-changed`)
//   view.showTab(tab)    'activity' (default) | 'once' | 'repeating' — the route's param
//   view.loadFeed()      feed only (`notification`, `notifications-changed`)
//   view.upcoming(ms)    tickets due within `ms` — the Running view's Scheduled group
//   view.chains()        the server's after-ticket chains (last load())
//   view.tickets() / noteTicket(t) / forgetTicket(id)   every ticket; upsert one by id; drop one
//   view.destroy()       stop the countdown tick

import { formatInstant, formatCountdown } from '../../src/shared/schedule/recurrence.mjs';
import { openScheduleSheet, browserTimeZone } from './schedule-sheet.mjs';
import { splitMessage } from './feedback.mjs';
import { actionError, httpError } from './action-errors.mjs';

const ICON = {
  clock: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></svg>',
  repeat: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l3 3-3 3"></path><path d="M4 11V9a3 3 0 0 1 3-3h13"></path><path d="M7 21l-3-3 3-3"></path><path d="M20 13v2a3 3 0 0 1-3 3H4"></path></svg>',
  bang: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 6.5v7"></path><path d="M12 17.4h.01"></path></svg>',
  pause: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5"></rect><rect x="14" y="5" width="4" height="14" rx="1.5"></rect></svg>',
};
/** Feed kinds -> badge word + colour family (the app's .badge variants). */
const KIND = {
  missed: ['Missed', 'amber'], failed: ['Failed', 'red'], run_error: ['Error', 'red'], paused: ['Paused', 'amber'],
  run_paused: ['Paused', 'amber'], skipped: ['Skipped', 'grey'], late: ['Late', 'blue'], retrying: ['Retrying', 'grey'],
  completed: ['Completed', 'green'], ended: ['Ended', 'grey'],
  // Git event automations (#711): what a rule did with an issue or PR.
  automation_started: ['Started', 'blue'], automation_skipped: ['Skipped', 'grey'], automation_queued: ['Queued', 'grey'],
  'automation_awaiting-approval': ['Approve?', 'amber'], automation_done: ['Done', 'green'], automation_failed: ['Failed', 'red'],
};
const RESULT_WORD = { completed: 'completed', error: 'ended with an error', failed: 'could not start', missed: 'missed', skipped: 'skipped', paused: 'paused', stopped: 'stopped' };
const RESULT_FAMILY = { completed: 'green', error: 'red', failed: 'red', missed: 'amber', skipped: 'grey', paused: 'amber', stopped: 'grey' };
/** How the run an after-ticket waits for stands (its pipeline or ticket status). */
const AFTER_WORD = { running: 'running', starting: 'starting', created: 'starting', pausing: 'pausing', paused: 'paused', scheduled: 'scheduled', firing: 'starting', fired: 'starting',
  done: 'finished', error: 'ended with an error', stopped: 'stopped', interrupted: 'interrupted', missed: 'missed', canceled: 'canceled', failed: 'could not start', skipped: 'skipped' };
const afterWord = (a) => (a && a.status ? (AFTER_WORD[a.status] || a.status) : 'waiting');
const afterName = (a) => `‘${(a && a.title) || 'the run before it'}’`;

/** A constant SVG string from ICON as a node, parsed as XML. */
function svgIcon(markup) {
  const doc = new DOMParser().parseFromString(markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '), 'image/svg+xml');
  return document.importNode(doc.documentElement, true);
}

function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'icon') node.append(svgIcon(v));
    else if (k === 'hidden') node.hidden = !!v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
}

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw httpError(res, data);
  return data;
}

function relativeAgo(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  if (ms < 60_000) return 'just now';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)} h ago`;
  return formatInstant(Date.parse(iso), browserTimeZone());
}

/** Run 4 (D22): the pause reasons the server names (src/core/failure-policy.mjs REASON, "_" as spaces), in plain words. */
const PAUSED_WHY = Object.freeze({ drain: 'worca was stopping', 'usage limit': 'usage limit reached',
  'cost pipeline': 'its cost limit was reached', 'cost total': 'the total budget was reached',
  'cost pipeline policy': 'the team cost cap was reached', 'cost total policy': 'the team cost cap was reached',
  'night guardrail': 'an Away mode limit was reached', error: 'it hit an error', recoverable: 'it hit an error' });
const RESUME_ON = /\s*—?\s*resume on (.+?) to continue now\.$/;

/** A feed message as plain words ("paused · worca was stopping") and its raw detail, for the row's tooltip. The server's
 *  stored text is unchanged (src/core/scheduler.mjs recordOutcome), so rows written before this read the same way. */
export function plainFeedMessage(message) {
  const s = String(message || '');
  const p = /^paused \(([^)]+)\)(?::\s*|\.)?([\s\S]*)$/.exec(s);
  if (p) {
    const resume = RESUME_ON.exec(p[2]);
    const why = PAUSED_WHY[p[1]];
    return { text: `paused${why ? ` · ${why}` : ''}${resume ? `. Resume on ${resume[1]} to continue now.` : ''}`,
      detail: p[2].replace(RESUME_ON, '').trim() };
  }
  const raw = /^(ended with an error|could not start): ([\s\S]+?)\.?$/.exec(s);
  if (raw) return { text: raw[1], detail: raw[2] };
  return { text: s, detail: '' };
}

export const SCHEDULE_TABS = ['activity', 'once', 'repeating'];

/**
 * @param {object} o
 * @param {HTMLElement} o.tabsHost       the .tabs strip holding button[data-tab]
 * @param {HTMLElement} o.feedHost       the Activity pane (the feed)
 * @param {HTMLElement} o.onceHost       the Once pane (one-off runs)
 * @param {HTMLElement} o.repeatingHost  the Repeating pane (series)
 * @param {HTMLElement} [o.subEl]   the topbar sub line
 * @param {HTMLElement} [o.msgEl]   a .form-msg line for action errors
 * @param {object} o.deps  { confirmModal, targetLabel(item), workflowLabel(id), onCounts(counts), openRun(item), route(tab), notify(o) }
 */
export function createSchedulesView({ tabsHost = null, feedHost, onceHost, repeatingHost, subEl = null, msgEl = null, deps }) {
  const tz = browserTimeZone();
  const model = { schedules: [], tickets: [], chains: [], counts: {}, defaults: { graceMin: 360, ifMissed: 'run', maxFailures: 3 }, feed: [], filter: 'all', loaded: false, tab: 'activity' };
  let timer = null;

  // #555: an action's result is a toast through deps.notify; 'err-inline' (what load()/loadFeed() report) stays on msgEl.
  const say = (text, kind = '') => {
    if (kind && kind !== 'err-inline' && text && deps.notify) { deps.notify({ tone: kind, ...splitMessage(text) }); text = ''; kind = ''; }
    if (kind === 'err-inline') kind = 'err';
    if (msgEl) { msgEl.textContent = text || ''; msgEl.className = `form-msg${kind ? ` ${kind}` : ''}`; }
  };
  const when = (iso) => formatInstant(Date.parse(iso), tz);
  const countdown = (iso) => formatCountdown(Date.parse(iso) - Date.now());

  /** `what` completes "Could not …" (D8): the failure toast then names the action and the next step. */
  async function act(fn, okText = '', what = '') {
    say('');
    try { await fn(); if (okText) say(okText, 'ok'); }
    catch (err) {
      if (what && deps.notify) deps.notify(actionError(what, err));
      else say(err.message, 'err');
    }
    await load();
  }

  // ── rows ───────────────────────────────────────────────────────────────────
  // Who made / last changed it (step 2's display rule lives in app.js: deps.personLabel/personShown
  // return '' unless the deployment has per-person sign-ins; 'you' for the viewer).
  const label = (v) => (typeof deps.personLabel === 'function' ? deps.personLabel(v) : '');
  const shown = (v) => (typeof deps.personShown === 'function' ? deps.personShown(v) : '');
  /** The card's meta segment: "· (AL) by ada@…" / "by you" for the creator; null when nobody is shown. */
  function bySeg(item) {
    const who = label(item.createdBy);
    if (!who) return null;
    const full = shown(item.createdBy);
    const ini = typeof deps.personIni === 'function' ? deps.personIni(full, `Created by ${full}`) : null;
    return h('span', { class: 'rc-seg sched-by', title: `Created by ${full}` }, h('span', { class: 'rc-dot', text: '·' }), ini, h('span', { class: 'sched-by-text', text: `by ${who}` }));
  }

  function metaLine(item) {
    const bits = [deps.targetLabel(item), deps.workflowLabel(item.summary.workflowId)];
    const git = typeof deps.gitOn !== 'function' || deps.gitOn();
    if (git && item.summary.sourceBranch) bits.push(`from ${item.summary.sourceBranch}`);
    if (git && item.sourceFromPrevious) bits.push('from the run before it');
    if (item.summary.mock) bits.push('mock');
    if (item.presetId) bits.push(item.presetName ? `preset ${item.presetName}` : 'preset deleted');
    return bits.filter(Boolean).join(' · ');
  }

  function detailsBlock(item) {
    const body = h('div', { class: 'sched-details-body', hidden: true });
    const row = (k, v) => (v ? h('div', { class: 'sched-kv' }, h('span', { class: 'sched-k', text: k }), h('span', { class: 'sched-v', text: v })) : null);
    const src = item.summary.source && item.summary.source.type === 'plugin' ? item.summary.source : null;
    const git = typeof deps.gitOn !== 'function' || deps.gitOn();
    body.append(...[
      row('Task', src ? `${src.plugin} · ${src.taskId} (fetched when the run starts)` : (item.summary.prompt || '—')),
      row('Created by', shown(item.createdBy)),
      shown(item.updatedBy) && shown(item.updatedBy) !== shown(item.createdBy) ? row('Changed by', shown(item.updatedBy)) : null,
      item.after ? row('After', `${(item.after.title || item.after.id.slice(0, 8))} · ${afterWord(item.after)}`) : null,
      item.after ? row('If it fails', item.after.policy === 'any' ? 'Start anyway' : 'Do not start') : null,
      git && item.sourceFromPrevious ? row('Source branch', 'the run before it') : null,
      git ? row('Feature branch', item.summary.sameAsSource ? 'none (commits onto the source branch)'
        : (item.summary.featureBranch ? (item.kind === 'recurring' ? `${item.summary.featureBranch}-<date>` : item.summary.featureBranch) : '')) : null,
      row('Guardrails', item.summary.guardrailsId && item.summary.guardrailsId !== 'permissive' ? item.summary.guardrailsId : ''),
      row('Preset', item.presetId ? (item.presetName ? `${item.presetName} (read when the run starts)`
        : `${item.presetGoneName || 'A preset'} (deleted: the next run will fail)`) : ''),
      row('Extra files', item.summary.extras ? String(item.summary.extras) : ''),
      item.after ? null : row('If Worca is not running', item.ifMissed === 'skip' ? 'Skip it' : `Start it late, at most ${item.graceMin >= 60 && item.graceMin % 60 === 0 ? `${item.graceMin / 60} h` : `${item.graceMin} min`}`),
      item.kind === 'recurring' ? row('If the previous run is still going', { skip: 'Skip this one', queue: 'Wait, then start', start: 'Start anyway' }[item.overlap]) : null,
      item.kind === 'recurring' ? row('Pause after failures in a row', item.maxFailures ? String(item.maxFailures) : 'Never') : null,
      item.kind === 'recurring' ? row('Runs so far', String(item.runsCount)) : null,
      item.ownerPid != null && item.status === 'scheduled' ? row('Held by', 'a waiting terminal (worca --wait), which starts the run') : null,
    ].filter(Boolean));
    return body;
  }

  /** The card's footer: a Details toggle on the left, the actions on the right. */
  function footer(item, acts, body) {
    const more = h('button', { type: 'button', class: 'btn btn-sm btn-quiet sched-more', 'aria-expanded': 'false', text: 'Details' });
    more.addEventListener('click', () => {
      body.hidden = !body.hidden;
      more.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
    });
    return h('div', { class: 'sched-foot' }, more, acts);
  }

  function ticketRow(t) {
    const missed = t.status === 'missed';
    const firing = t.status === 'firing';
    const chained = !!t.after;
    const resumeTarget = !t.scheduleId && t.resumePipelineId
      ? (typeof deps.labelResumeTarget === 'function' ? deps.labelResumeTarget(t.resumePipelineId) : null)
      : null;
    const statusWord = missed ? 'Missed' : firing ? 'Starting' : chained ? 'Waiting for a run' : t.queued ? 'Waiting for the previous run' : t.retryAt ? 'Retrying' : 'Scheduled';
    const family = missed ? 'amber' : firing ? 'peach' : 'grey';
    // The word after the dot always describes the PREDECESSOR (running / finished / ended with an
    // error); a missed after-ticket says Missed in the status word and its fail_reason below.
    const timeText = chained
      ? `After ${afterName(t.after)} · ${afterWord(t.after)}`
      : (missed ? `was due ${when(t.runAt)}` : `${when(t.runAt)}${countdown(t.runAt) ? ` · in ${countdown(t.runAt)}` : ''}`);
    const acts = h('div', { class: 'sched-acts' });
    if (!firing) {
      const runNow = h('button', { type: 'button', class: 'btn btn-sm', text: resumeTarget ? 'Resume now' : 'Run now' });
      runNow.addEventListener('click', () => act(async () => {
        const out = await api('POST', `/api/schedules/${t.id}/run-now`);
        if (out.status === 'failed') throw new Error(out.failReason || 'The run could not be started.');
        if (out.status === 'fired' && deps.openRun) deps.openRun(out.resume ? { runId: out.runId, pipelineId: out.pipelineId } : { runId: out.runId });
      }, 'Run started', 'start the run now'));
      acts.append(runNow);
      if (!t.scheduleId) {
        const move = h('button', { type: 'button', class: 'btn btn-sm', text: chained ? 'Change…' : (missed ? 'Reschedule' : 'Change time') });
        move.addEventListener('click', async () => {
          const res = await openScheduleSheet({
            mode: 'ticket', runTitle: t.title || '', defaults: model.defaults,
            initial: chained ? { after: t.after, afterPolicy: t.after.policy } : { scheduledFor: t.runAt, ifMissed: t.ifMissed, graceMin: t.graceMin },
            candidates: () => api('GET', `/api/schedules/after-candidates?${t.workspaceId ? `workspaceId=${encodeURIComponent(t.workspaceId)}` : `projectDir=${encodeURIComponent(t.projectDir || '')}`}`),
          });
          if (res) act(() => api('PATCH', `/api/schedules/${t.id}`, res), 'Schedule changed');
        });
        const cancel = h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: missed ? 'Dismiss' : 'Cancel' });
        cancel.addEventListener('click', async () => {
          if (!missed) {
            // The same sentence, cap and guard as app.js's afterDependentsNote (the Archive note) — not
            // named `deps`: that is this view's injected dependencies object. The read is async and no modal
            // is up yet: hold the button, or a second click sends a second DELETE.
            cancel.disabled = true;
            let note = '';
            try {
              const d = await api('GET', `/api/schedules/dependents?ticketId=${encodeURIComponent(t.id)}`);
              const waiting = Array.isArray(d && d.dependents) ? d.dependents : [];
              if (waiting.length) {
                const names = waiting.slice(0, 4).map((x) => `“${x.title || 'Scheduled run'}”`).join(', ');
                note = `\n\n${names}${waiting.length > 4 ? ` and ${waiting.length - 4} more` : ''} ${waiting.length === 1 ? 'waits' : 'wait'} for this run and will be marked missed.`;
              }
            } catch { /* the note is optional */ }
            cancel.disabled = false;
            if (!(await deps.confirmModal({ title: 'Cancel scheduled run', message: `Cancel “${t.title || 'this run'}”?\nIt will not start. Nothing has run yet, so there is nothing to clean up.${note}`, confirmLabel: 'Cancel run' }))) return;
          }
          act(() => api('DELETE', `/api/schedules/${t.id}`), 'Schedule cancelled', missed ? 'dismiss the missed run' : 'cancel the waiting run');
        });
        acts.append(move, cancel);
      }
    }
    if (!t.scheduleId && !missed) {
      const next = h('button', { type: 'button', class: 'btn btn-sm', text: 'Schedule next…', title: 'Schedule a run that starts after this one' });
      next.addEventListener('click', () => { location.hash = `#new/after/t:${t.id}`; });
      acts.append(next);
    }
    const details = detailsBlock(t);
    return h('div', { class: `drow drow-stack sched-item${missed ? ' attention' : ''}`, 'data-id': t.id },
      h('div', { class: 'sched-head' },
        h('span', { class: `rc-sic st-${missed ? 'amber' : 'grey'}`, icon: missed ? ICON.bang : ICON.clock, role: 'img', 'aria-label': statusWord }),
        h('div', { class: 'rc-body' },
          h('div', { class: 'rc-title', text: t.title || 'Scheduled run' }),
          h('div', { class: 'rc-meta' },
            h('span', { class: `rc-status-word st-${family}`, text: statusWord }),
            h('span', { class: 'rc-seg' }, h('span', { class: 'rc-dot', text: '·' }), h('span', { class: 'sched-when', 'data-at': missed || chained ? '' : t.runAt, text: timeText })),
            bySeg(t)),
          resumeTarget ? h('div', { class: 'sched-resume-target', text: `Resumes ‘${resumeTarget.title}’ · ${resumeTarget.statusWord}` }) : null,
          h('div', { class: 'sched-target', text: `${t.scheduleId ? 'Repeating' : 'Once'} · ${metaLine(t)}` }),
          missed && t.failReason ? h('div', { class: 'sched-reason', text: t.failReason }) : null)),
      footer(t, acts, details), details);
  }

  function seriesRow(s) {
    const paused = s.status === 'paused';
    const ended = s.status === 'ended';
    const streakPause = paused && s.pauseReason === 'failure_streak';
    const statusWord = ended ? 'Ended' : streakPause ? `Paused after ${s.failureStreak} failure${s.failureStreak === 1 ? '' : 's'}` : paused ? 'Paused' : 'Active';
    const family = ended ? 'grey' : paused ? 'amber' : 'green';
    const sw = h('div', { class: `switch${s.status === 'active' ? ' on' : ''}`, role: 'switch', tabindex: ended ? '-1' : '0', 'aria-checked': s.status === 'active' ? 'true' : 'false', 'aria-label': paused ? 'Resume this schedule' : 'Pause this schedule', title: paused ? 'Resume' : 'Pause' });
    const toggle = () => { if (!ended) act(() => api('POST', `/api/schedules/${s.id}/${paused ? 'resume' : 'pause'}`), paused ? 'Resumed' : 'Paused'); };
    sw.addEventListener('click', toggle);
    sw.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });

    const acts = h('div', { class: 'sched-acts' });
    if (!ended) {
      const runNow = h('button', { type: 'button', class: 'btn btn-sm', text: 'Run now', title: 'Start one extra run now. The schedule itself does not shift' });
      runNow.addEventListener('click', () => act(async () => {
        const out = await api('POST', `/api/schedules/${s.id}/run-now`);
        if (out.status === 'failed') throw new Error(out.failReason || 'The run could not be started.');
        if (out.status === 'fired' && deps.openRun) deps.openRun({ runId: out.runId });
      }, 'Run started', 'start the run now'));
      const skip = h('button', { type: 'button', class: 'btn btn-sm', text: 'Skip next', hidden: paused });
      skip.addEventListener('click', () => act(() => api('POST', `/api/schedules/${s.id}/skip-next`), 'Next run skipped'));
      const edit = h('button', { type: 'button', class: 'btn btn-sm', text: 'Edit' });
      edit.addEventListener('click', async () => {
        const res = await openScheduleSheet({ mode: 'series', runTitle: s.title || '', defaults: model.defaults, initial: { rule: s.rule, overlap: s.overlap, maxFailures: s.maxFailures, ifMissed: s.ifMissed, graceMin: s.graceMin } });
        if (res) act(() => api('PATCH', `/api/schedules/${s.id}`, { rule: res.repeat.rule, overlap: res.repeat.overlap, maxFailures: res.repeat.maxFailures, ifMissed: res.ifMissed, graceMin: res.graceMin }), 'Schedule changed');
      });
      acts.append(runNow, skip, edit);
    }
    const del = h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Delete' });
    del.addEventListener('click', async () => {
      if (!(await deps.confirmModal({ title: 'Delete schedule', message: `Delete “${s.title || 'this schedule'}”?\nIt stops repeating. Runs it already started stay in Runs.`, confirmLabel: 'Delete schedule' }))) return;
      act(() => api('DELETE', `/api/schedules/${s.id}`), 'Schedule deleted');
    });
    acts.append(del);

    const next = s.nextRunAt ? h('span', { class: 'sched-when', 'data-at': s.nextRunAt, 'data-prefix': 'Next: ', text: `Next: ${when(s.nextRunAt)}${countdown(s.nextRunAt) ? ` · in ${countdown(s.nextRunAt)}` : ''}` }) : null;
    const last = s.lastResult ? h('span', { class: `badge ${RESULT_FAMILY[s.lastResult] || 'grey'}`, text: `Last: ${RESULT_WORD[s.lastResult] || s.lastResult}` }) : null;
    const details = detailsBlock(s);
    return h('div', { class: `drow drow-stack sched-item${streakPause ? ' attention' : ''}`, 'data-id': s.id },
      h('div', { class: 'sched-head' },
        h('span', { class: `rc-sic st-${streakPause ? 'amber' : 'grey'}`, icon: paused ? ICON.pause : ICON.repeat, role: 'img', 'aria-label': 'Repeating schedule' }),
        h('div', { class: 'rc-body' },
          h('div', { class: 'rc-title', text: s.title || 'Repeating schedule' }),
          h('div', { class: 'rc-meta' },
            h('span', { class: `rc-status-word st-${family}`, text: statusWord }),
            h('span', { class: 'rc-seg' }, h('span', { class: 'rc-dot', text: '·' }), h('span', { class: 'sched-rule', text: s.sentence })),
            bySeg(s)),
          h('div', { class: 'sched-target', text: metaLine(s) }),
          (next || last) ? h('div', { class: 'sched-sub' }, next, last) : null),
        ended ? null : sw),
      footer(s, acts, details), details);
  }

  /** Replace a pane's rows, keeping an open Details panel open (a tick or a broadcast must not slam it shut). */
  function paintPane(host, rows, emptyNode) {
    if (!host) return;
    const openIds = new Set([...host.querySelectorAll('.sched-item')].filter((c) => c.querySelector('.sched-more[aria-expanded="true"]')).map((c) => c.dataset.id));
    host.replaceChildren(...(rows.length ? rows : [emptyNode]));
    for (const c of host.querySelectorAll('.sched-item')) if (openIds.has(c.dataset.id)) c.querySelector('.sched-more').click();
  }
  const emptyOnce = () => h('p', { class: 'empty-line' }, 'No one-off run is waiting. Pick a time with ',
    h('a', { href: '#new/schedule', text: 'Schedule a run' }), ', then describe the task. Or use Schedule… next to Start run on New run.');
  const emptyRepeating = () => h('p', { class: 'empty-line' }, 'No repeating schedule. Pick a time with ',
    h('a', { href: '#new/schedule', text: 'Schedule a run' }), ' and choose Every day, Weekdays, Weekly or Monthly.');

  function paintTabs() {
    if (!tabsHost) return;
    const once = model.tickets.filter((t) => !t.scheduleId).length;
    const series = model.schedules.filter((s) => s.status !== 'ended').length;
    const unread = model.feed.filter((n) => n.unread).length;
    const label = { activity: unread ? `Activity · ${unread}` : 'Activity', once: once ? `Once · ${once}` : 'Once', repeating: series ? `Repeating · ${series}` : 'Repeating' };
    for (const b of tabsHost.querySelectorAll('button[data-tab]')) {
      b.textContent = label[b.dataset.tab] || b.dataset.tab;
      b.classList.toggle('on', b.dataset.tab === model.tab);
      b.setAttribute('aria-pressed', b.dataset.tab === model.tab ? 'true' : 'false');
    }
    for (const [tab, host] of [['activity', feedHost], ['once', onceHost], ['repeating', repeatingHost]]) if (host) host.hidden = tab !== model.tab;
  }
  /** Show one tab (the route's param); an unknown or empty name is Activity. */
  function showTab(tab) {
    model.tab = SCHEDULE_TABS.includes(tab) ? tab : 'activity';
    paintTabs();
  }
  tabsHost?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    if (typeof deps.route === 'function') deps.route(b.dataset.tab); else showTab(b.dataset.tab);
  });

  function paintList() {
    const series = model.schedules;
    const once = model.tickets.filter((t) => !t.scheduleId);
    paintPane(onceHost, once.map(ticketRow), emptyOnce());
    paintPane(repeatingHost, series.map(seriesRow), emptyRepeating());
    paintTabs();
    if (subEl) {
      const n = once.filter((t) => t.status !== 'missed').length;
      const active = series.filter((s) => s.status === 'active').length;
      subEl.textContent = `${n} run${n === 1 ? '' : 's'} waiting · ${active} repeating schedule${active === 1 ? '' : 's'} active`;
    }
  }

  // ── feed ───────────────────────────────────────────────────────────────────
  function feedItem(n) {
    const [word, family] = KIND[n.kind] || [n.kind, 'grey'];
    const msg = plainFeedMessage(humanMessage(n));
    const ticket = n.ticketId ? model.tickets.find((t) => t.id === n.ticketId) : null;
    const series = n.scheduleId ? model.schedules.find((s) => s.id === n.scheduleId) : null;
    const acts = [];
    if (!n.resolvedAt && n.kind === 'missed' && ticket && ticket.status === 'missed') {
      const b = h('button', { type: 'button', class: 'btn btn-sm', text: 'Run now' });
      b.addEventListener('click', () => act(() => api('POST', `/api/schedules/${ticket.id}/run-now`), 'Run started', 'start the run now'));
      acts.push(b);
    }
    if (!n.resolvedAt && n.kind === 'paused' && series && series.status === 'paused') {
      const b = h('button', { type: 'button', class: 'btn btn-sm', text: 'Resume schedule' });
      b.addEventListener('click', () => act(() => api('POST', `/api/schedules/${series.id}/resume`), 'Resumed'));
      acts.push(b);
    }
    if (n.pipelineId && deps.openRun) {
      const b = h('button', { type: 'button', class: 'btn btn-sm sched-feed-open', text: 'Open run' });
      b.addEventListener('click', () => deps.openRun({ pipelineId: n.pipelineId, projectDir: n.projectDir }));
      acts.push(b);
    }
    if (n.unread) {
      const b = h('button', { type: 'button', class: 'btn btn-sm btn-quiet sched-feed-read', text: 'Mark read', title: 'Mark as read' });
      b.addEventListener('click', async () => { try { await api('POST', `/api/notifications/${n.id}/read`); } catch (err) { say(err.message, 'err'); } await loadFeed(); });
      acts.push(b);
    }
    // One table row: Kind · What happened · Actions.
    return h('tr', { class: `sched-feed-item${n.unread ? ' unread' : ''}`, 'data-id': n.id },
      h('td', { class: 'sched-feed-kind', 'data-label': 'Kind' }, h('span', { class: `badge ${family}`, text: word })),
      h('td', { class: 'sched-feed-body table-main' },
        h('div', { class: 'sched-feed-text', ...(msg.detail ? { title: msg.detail } : {}) }, h('b', { text: n.title || 'Scheduled run' }), ` ${msg.text}`),
        h('div', { class: 'sched-feed-time', text: relativeAgo(n.createdAt), title: new Date(n.createdAt).toLocaleString() })),
      h('td', { class: 'sched-feed-acts', 'data-label': 'Actions' }, ...acts));
  }

  /** Server messages carry ISO instants; show them in local time. */
  function humanMessage(n) {
    return String(n.message || '').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (isoStr) => when(isoStr));
  }

  function paintFeed() {
    const unread = model.feed.filter((n) => n.unread).length;
    const rows = model.feed.filter((n) => (model.filter === 'unread' ? n.unread : model.filter === 'problems' ? n.severity === 'problem' : true));
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter activity' });
    for (const [key, label] of [['all', 'All'], ['unread', unread ? `Unread · ${unread}` : 'Unread'], ['problems', 'Problems']]) {
      const b = h('button', { type: 'button', class: model.filter === key ? 'on' : '', 'aria-pressed': model.filter === key ? 'true' : 'false', text: label });
      b.addEventListener('click', () => { model.filter = key; paintFeed(); });
      seg.append(b);
    }
    const markAll = h('button', { type: 'button', class: 'btn btn-sm', text: 'Mark all read', disabled: unread === 0 });
    markAll.addEventListener('click', async () => { try { await api('POST', '/api/notifications/read-all', {}); } catch (err) { say(err.message, 'err'); } await loadFeed(); });
    const list = rows.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table sched-feed-table' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Kind' }), h('th', { text: 'What happened' }), h('th', { text: '' }))),
        h('tbody', {}, ...rows.map(feedItem))))
      : h('p', { class: 'empty-line', text: model.filter === 'all' ? 'No activity yet. Missed, failed, skipped and completed scheduled runs show up here.' : 'Nothing here.' });
    feedHost.replaceChildren(
      h('div', { class: 'card-head sched-feed-head' }, h('h2', { text: 'Activity' }), h('div', { class: 'sched-feed-tools' }, seg, markAll)),
      list);
  }

  // ── data ───────────────────────────────────────────────────────────────────
  async function loadFeed() {
    try {
      const data = await api('GET', '/api/notifications?scope=schedule');
      model.feed = Array.isArray(data.notifications) ? data.notifications : [];
      model.counts = { ...model.counts, unread: data.unread || 0 };
      deps.onCounts?.(model.counts);
      if (feedHost.isConnected) { paintFeed(); paintTabs(); }
    } catch (err) { say(err.message, 'err-inline'); }
  }

  async function load() {
    ensureTimer();
    try {
      const data = await api('GET', '/api/schedules');
      model.schedules = Array.isArray(data.schedules) ? data.schedules : [];
      model.tickets = Array.isArray(data.tickets) ? data.tickets : [];
      model.chains = Array.isArray(data.chains) ? data.chains : [];
      model.counts = data.counts || {};
      if (data.defaults) model.defaults = data.defaults;
      model.loaded = true;
      deps.onCounts?.(model.counts);
      paintList();
    } catch (err) { say(err.message, 'err-inline'); }
    await loadFeed();
  }

  /** Repaint the "in 7h 12m" parts in place — no refetch, no rebuild. */
  function tickCountdowns(root = document) {
    for (const node of root.querySelectorAll('.sched-when[data-at]')) {
      const at = node.dataset.at;
      if (!at) continue;
      const cd = countdown(at);
      node.textContent = `${node.dataset.prefix || ''}${when(at)}${cd ? ` · in ${cd}` : ''}`;
    }
  }
  // Started lazily on the first load (never at import: app.js is also imported under Node by
  // the jsdom tests, where a live interval would hold the process open) and unref'd there.
  function ensureTimer() {
    if (timer) return;
    timer = setInterval(() => tickCountdowns(), 15000);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  return {
    load, loadFeed, tickCountdowns, showTab,
    /** Repaint from the loaded model (the viewer arrived after the first paint). */
    repaint() { if (model.loaded) paintList(); },
    get tab() { return model.tab; },
    get defaults() { return model.defaults; },
    get counts() { return model.counts; },
    /** One-off tickets and series occurrences due within `ms` (in the list's own order), plus missed — plus
     *  EVERY waiting after-ticket (its runAt is the sentinel): Running › Scheduled shows a chain whole. */
    upcoming(ms) {
      const limit = Date.now() + ms;
      return model.tickets.filter((t) => t.status === 'missed' || (t.after && (t.status === 'scheduled' || t.status === 'firing')) || Date.parse(t.runAt) <= limit);
    },
    /** Every ticket the server listed (scheduled, firing, missed) — unlike upcoming(), none is dropped for being far out. */
    tickets() { return model.tickets; },
    /** The after-ticket chains the server listed with the last load(). */
    chains() { return model.chains; },
    /** Upsert a ticket by id (an optimistic add before the next load). */
    noteTicket(t) {
      const i = model.tickets.findIndex((x) => x.id === t.id);
      if (i < 0) model.tickets.push(t);
      else model.tickets[i] = t;
    },
    forgetTicket(id) { model.tickets = model.tickets.filter((t) => t.id !== id); },
    ticketRow,
    isLoaded: () => model.loaded,
    destroy() { clearInterval(timer); timer = null; },
  };
}
