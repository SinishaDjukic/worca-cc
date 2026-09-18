// src/cli/schedule.mjs
// The CLI side of scheduled runs: `worca … --at/--every/--cron` writes a launch ticket
// (or a recurring schedule) straight into the shared database — no running server is
// needed to SCHEDULE, only to START — plus the `worca schedule` management verbs and the
// `--wait` foreground mode, where this terminal owns its ticket and starts it itself.

import { randomUUID, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { join, basename } from 'node:path';
import { mkdir, copyFile } from 'node:fs/promises';
import process from 'node:process';

import {
  createTicket, getTicket, listTickets, updateTicket, cancelTicket, requestRunNow, claimTicket,
  heartbeatTicket, releaseTicket, markTicketFired, setTicketPipeline, recordOutcome,
  createSchedule, listSchedules, pauseSchedule, resumeSchedule, skipNext, runScheduleNow,
  deleteSchedule, scheduleStageDir,
} from '../core/scheduler.mjs';
import { listNotifications, markAllRead, unreadCount, addNotification } from '../core/notifications.mjs';
import { scheduleDefaults } from '../core/settings.mjs';
import { readUiInstance, probeUi } from '../core/ui-instance.mjs';
import {
  parseAt, parseEvery, parseCron, normalizeRule, nextOccurrence, describeRule, formatInstant,
  formatCountdown, localDate, isValidTimeZone, OVERLAP_POLICIES, MISSED_POLICIES,
} from '../shared/schedule/recurrence.mjs';

/** The value flags the run command gains (parseArgs registers them). */
export const SCHEDULE_VALUE_FLAGS = {
  '--at': 'at', '--every': 'every', '--cron': 'cron', '--until': 'until', '--count': 'count',
  '--overlap': 'overlap', '--max-failures': 'maxFailures', '--if-missed': 'ifMissed', '--grace': 'grace', '--tz': 'tz',
};

export const SCHEDULE_HELP = `worca schedule — manage scheduled runs

Create one by adding a time to any run command:
  worca --prompt "<task>" --at "tomorrow 02:00"          Run once, later
  worca --prompt "<task>" --at 02:00 --wait               …and hold this terminal until then
  worca --prompt "<task>" --every "weekdays 02:00"        Repeat
  worca --prompt "<task>" --cron "0 2 * * 1-5"            Repeat (cron subset)

  --at <when>          "02:00" (next), "today 22:00", "tomorrow 02:00", "+90m", "+2h",
                       "2026-09-19 02:00", or ISO 8601 with an offset. Local time unless an offset is given.
  --every <pattern>    "day 03:30", "3 days 02:00", "weekdays 02:00", "weekends 09:00",
                       "mon,thu 02:00", "2 weeks mon 02:00", "month 1 02:00", "month last 02:00"
  --until <date>       Last day a repeating schedule may run (YYYY-MM-DD)
  --count <n>          Stop a repeating schedule after n runs
  --overlap <p>        If the previous run is still going: skip (default) | start | queue
  --max-failures <n>   Pause a repeating schedule after n failures in a row (default 3, 0 = never)
  --if-missed <p>      If Worca is not running at that time: run (start late) | skip
  --grace <dur>        How late a missed run may still start: 90m, 6h, 1d (default 6h)
  --tz <zone>          IANA timezone for local times (default: this machine's)
  --wait               With --at: keep this terminal open and start the run here

A scheduled run starts only while a Worca process is up (\`worca ui\`, or --wait) and the
machine is awake.

Commands:
  worca schedule list [--all]             Waiting runs and repeating schedules
  worca schedule show <id>                One item in detail
  worca schedule run-now <id>             Start it now (a repeating schedule gets one extra run)
  worca schedule move <id> --at <when>    Change the time of a one-off run
  worca schedule cancel <id>              Cancel a one-off run, or delete a repeating schedule
  worca schedule skip <id>                Skip the next run of a repeating schedule
  worca schedule pause|resume <id>        Pause or resume a repeating schedule
  worca schedule log [--unread] [--mark-read]   The activity feed

<id> may be any unique prefix.
`;

const systemTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** "6h" / "90m" / "1d" / bare minutes -> minutes, or null. */
export function parseGrace(text) {
  const r = /^(\d+)\s*(m|min|h|hr|d)?$/i.exec(String(text || '').trim());
  if (!r) return null;
  const n = Number(r[1]); const u = (r[2] || 'm')[0].toLowerCase();
  const min = n * (u === 'm' ? 1 : u === 'h' ? 60 : 1440);
  return Number.isSafeInteger(min) && min >= 0 && min <= 10080 ? min : null;
}

/** True when the flags ask for a schedule rather than an immediate run. */
export function wantsSchedule(flags) {
  return !!(flags.at || flags.every || flags.cron);
}

/**
 * Validate the schedule flags. Returns { runAtMs | rule, overlap, maxFailures, ifMissed,
 * graceMin, tz }; calls `fail` (which exits) on the first problem.
 */
export function readScheduleFlags(flags, { fail, now = Date.now() }) {
  const tz = flags.tz || systemTz();
  if (!isValidTimeZone(tz)) fail(`--tz: "${tz}" is not a known timezone`);
  const given = ['at', 'every', 'cron'].filter((k) => flags[k]);
  if (given.length > 1) fail(`use one of --at, --every, --cron (got: ${given.map((k) => `--${k}`).join(', ')})`);
  const defaults = scheduleDefaults();
  const out = { tz, ifMissed: defaults.ifMissed, graceMin: defaults.graceMin, overlap: 'skip', maxFailures: defaults.maxFailures };
  if (flags.ifMissed !== undefined) {
    if (!MISSED_POLICIES.includes(flags.ifMissed)) fail(`--if-missed must be one of ${MISSED_POLICIES.join(', ')}, got: ${flags.ifMissed}`);
    out.ifMissed = flags.ifMissed;
  }
  if (flags.grace !== undefined) {
    const g = parseGrace(flags.grace);
    if (g == null) fail(`--grace: cannot read "${flags.grace}" — try 90m, 6h or 1d (at most 7d)`);
    out.graceMin = g;
  }
  if (flags.at) {
    for (const k of ['until', 'count', 'overlap', 'maxFailures']) {
      if (flags[k] !== undefined) fail(`--${k === 'maxFailures' ? 'max-failures' : k} only applies to a repeating schedule (--every / --cron)`);
    }
    const at = parseAt(flags.at, { nowMs: now, tz });
    if (!at.ok) fail(at.error);
    if (at.ms <= now) fail(`--at: ${formatInstant(at.ms, tz, { withYear: true })} is in the past`);
    out.runAtMs = at.ms;
    return out;
  }
  if (flags.wait) fail('--wait needs --at: a repeating schedule is started by the Worca server (worca ui)');
  const parsed = flags.every ? parseEvery(flags.every) : parseCron(flags.cron);
  if (!parsed.ok) fail(parsed.error);
  const rule = { ...parsed.rule, tz };
  if (flags.until !== undefined && flags.count !== undefined) fail('use --until or --count, not both');
  if (flags.until !== undefined) rule.end = { type: 'until', until: String(flags.until) };
  if (flags.count !== undefined) rule.end = { type: 'count', count: Number(flags.count) };
  const norm = normalizeRule(rule, { todayLocal: localDate(now, tz) });
  if (!norm.ok) fail(norm.error.replace(/^rule\.end\.until/, '--until').replace(/^rule\.end\.count/, '--count'));
  if (nextOccurrence(norm.rule, now) == null) fail('this schedule has no future run');
  out.rule = norm.rule;
  if (flags.overlap !== undefined) {
    if (!OVERLAP_POLICIES.includes(flags.overlap)) fail(`--overlap must be one of ${OVERLAP_POLICIES.join(', ')}, got: ${flags.overlap}`);
    out.overlap = flags.overlap;
  }
  if (flags.maxFailures !== undefined) {
    const n = Number(flags.maxFailures);
    if (!Number.isSafeInteger(n) || n < 0 || n > 100) fail(`--max-failures must be a whole number from 0 to 100, got: ${flags.maxFailures}`);
    out.maxFailures = n;
  }
  return out;
}

/** Copy `--extras` files into the durable staging dir; returns the staged paths. */
async function stageExtras(stageId, extras) {
  if (!extras.length) return [];
  const dir = join(scheduleStageDir(stageId), 'extras');
  await mkdir(dir, { recursive: true });
  const out = [];
  for (const src of extras) {
    const dest = join(dir, basename(src));
    await copyFile(src, dest);
    out.push(dest);
  }
  return out;
}

/** The stored request (POST /api/run body shape + `internal`) for the CLI's flags. */
async function requestFromFlags(flags, { projectDir, extras, promptText, stageId }) {
  const request = {
    projectDir,
    workflowId: flags.workflow || 'wf_default',
    ...(flags.title ? { title: flags.title } : {}),
    ...(flags.mock ? { mock: true } : {}),
    ...(flags.sourceBranch ? { sourceBranch: flags.sourceBranch } : {}),
    ...(flags.featureBranch ? { featureBranch: flags.featureBranch } : {}),
    ...(flags.memoryScope ? { memoryScope: flags.memoryScope } : {}),
    ...(flags.humanInLoop === false ? { humanInLoop: false } : {}),
  };
  // Text the user authored is frozen on the ticket — including a --file's content.
  if (flags.file) request.promptMarkdown = promptText;
  else request.prompt = flags.prompt;
  request.internal = {
    extrasPaths: await stageExtras(stageId, extras),
    ...(flags.model ? { model: flags.model } : {}),
    ...(flags.permissionMode ? { permissionMode: flags.permissionMode } : {}),
    ...(flags.auto ? { auto: true } : {}),
  };
  return request;
}

function fallbackTitle(flags, promptText) {
  if (flags.title) return flags.title;
  const line = String(promptText || flags.prompt || '').split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) || 'Scheduled run';
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

async function serverIsUp() {
  const inst = readUiInstance();
  if (!inst) return false;
  try { return (await probeUi({ host: inst.host, port: inst.port })).state === 'worca'; } catch { return false; }
}

/**
 * `worca … --at/--every/--cron`: write the ticket or the schedule. Returns
 * { ticket, schedule, spec } — the caller decides whether to --wait.
 */
export async function createFromFlags(flags, { projectDir, extras, promptText, spec, out, c }) {
  const title = fallbackTitle(flags, promptText);
  let ticket, schedule = null;
  if (spec.rule) {
    const id = `sch_${randomBytes(4).toString('hex')}`;
    const request = await requestFromFlags(flags, { projectDir, extras, promptText, stageId: id });
    ({ schedule, ticket } = createSchedule({
      id, title, projectDir, request, rule: spec.rule, overlap: spec.overlap, maxFailures: spec.maxFailures,
      ifMissed: spec.ifMissed, graceMin: spec.graceMin,
    }));
    out(`${c('green', 'Scheduled')} ${c('bold', schedule.id)} — ${describeRule(schedule.rule)} (${spec.tz})`);
    if (ticket) out(`  Next run: ${formatInstant(Date.parse(ticket.runAt), spec.tz, { withYear: true })} (in ${formatCountdown(Date.parse(ticket.runAt) - Date.now())})`);
  } else {
    const id = randomUUID();
    const request = await requestFromFlags(flags, { projectDir, extras, promptText, stageId: id });
    ticket = createTicket({
      id, title, projectDir, runAtMs: spec.runAtMs, request, ifMissed: spec.ifMissed, graceMin: spec.graceMin,
      ...(flags.wait ? { ownerPid: process.pid, ownerHost: hostname() } : {}),
    });
    out(`${c('green', 'Scheduled')} ${c('bold', ticket.id.slice(0, 8))} for ${formatInstant(spec.runAtMs, spec.tz, { withYear: true })} (in ${formatCountdown(spec.runAtMs - Date.now())})`);
  }
  out(`  ${title}`);
  if (!flags.wait && !(await serverIsUp())) {
    out(c('yellow', 'Note: no Worca server is up. Start `worca ui` before then'
      + (spec.rule ? '.' : ', or add --wait to hold this terminal.')));
  }
  out(c('gray', `  Manage it: worca schedule list | show | run-now | cancel ${(schedule ? schedule.id : ticket.id.slice(0, 8))}`));
  return { ticket, schedule };
}

/**
 * `--wait`: this terminal owns the ticket. Poll the row (so Run now / Change time /
 * Cancel from the UI still work), then start the run HERE through `drive`.
 * @param {object} o
 * @param {(onPipelineId:(id:string)=>void) => Promise<{code:number, status:string}>} o.drive
 * @returns {Promise<number>} exit code
 */
export async function waitAndRun({ ticketId, tz, out, c, drive, pollMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let released = false;
  const onSigint = () => {
    if (released) return;
    released = true;
    try { releaseTicket(ticketId); } catch { /* best effort */ }
    process.stdout.write('\n');
    out(c('yellow', 'Stopped waiting. The run stays scheduled — the Worca server will start it (worca ui).'));
    out(c('gray', `  To cancel it instead: worca schedule cancel ${ticketId.slice(0, 8)}`));
    process.exit(0);
  };
  process.on('SIGINT', onSigint);
  out(c('gray', 'Waiting here. Ctrl+C hands the run to the Worca server; it stays scheduled.'));
  let lastLine = '';
  try {
    for (;;) {
      const t = getTicket(ticketId);
      if (!t) { out(c('yellow', 'The scheduled run was removed.')); return 0; }
      if (t.status === 'canceled') { out(c('yellow', 'The scheduled run was canceled.')); return 0; }
      if (t.status !== 'scheduled') { out(c('yellow', `The scheduled run is now ${t.status} — another Worca process took it.`)); return 0; }
      if (t.ownerPid !== process.pid) { out(c('yellow', 'This terminal no longer owns the run — the Worca server will start it.')); return 0; }
      const now = Date.now();
      const due = t.forced || Date.parse(t.runAt) <= now;
      if (due) break;
      heartbeatTicket(ticketId);
      const line = `  starts ${formatInstant(Date.parse(t.runAt), tz)} — in ${formatCountdown(Date.parse(t.runAt) - now)}`;
      if (line !== lastLine) {
        if (process.stdout.isTTY) process.stdout.write(`\r\x1b[2K${line}`); else out(line);
        lastLine = line;
      }
      const left = Date.parse(t.runAt) - now;
      await sleep(Math.max(250, Math.min(pollMs, left)));
    }
    if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K');
    if (!claimTicket(ticketId)) { out(c('yellow', 'Another Worca process started this run.')); return 0; }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
  released = true; // from here the run's own Ctrl+C ladder (pause/stop) is in charge
  const t = getTicket(ticketId);
  const late = Date.now() - Date.parse(t.runAt);
  markTicketFired(ticketId);
  if (!t.forced && late > 5 * 60_000) {
    addNotification({ kind: 'late', severity: 'info', ticketId, projectDir: t.projectDir, title: t.title, message: `started late. It was due at ${t.runAt}.` });
  }
  out(c('cyan', `Starting the scheduled run — ${t.title || ticketId.slice(0, 8)}`));
  let res;
  try {
    res = await drive((pipelineId) => { try { setTicketPipeline(ticketId, pipelineId); } catch { /* decoration */ } });
  } catch (err) {
    recordOutcome(ticketId, { status: 'error', detail: err && err.message ? err.message : String(err) });
    throw err;
  }
  recordOutcome(ticketId, { status: res.status, pipelineId: res.pipelineId || null, reason: res.reason || null, detail: res.detail || null });
  return res.code;
}

// ── worca schedule <verb> ────────────────────────────────────────────────────

function resolveItem(ref, fail) {
  const q = String(ref || '').trim();
  if (!q) fail('an id is required (see: worca schedule list)');
  const hits = [
    ...listSchedules().filter((s) => s.id.startsWith(q) || s.id.slice(4).startsWith(q)).map((s) => ({ kind: 'recurring', item: s })),
    ...listTickets({ all: true, limit: 2000 }).filter((t) => t.id.startsWith(q)).map((t) => ({ kind: 'once', item: t })),
  ];
  if (!hits.length) fail(`no scheduled run or schedule matches "${q}" (see: worca schedule list)`);
  if (hits.length > 1) fail(`"${q}" matches ${hits.length} items — use a longer id`);
  return hits[0];
}

const where = (x) => (x.workspaceId ? `workspace ${x.workspaceId}` : (x.projectDir ? basename(x.projectDir) : '—'));

export async function cmdSchedule(argv, { out, c, fail }) {
  const verb = argv[0];
  const rest = argv.slice(1);
  const tz = systemTz();
  const when = (isoStr) => (isoStr ? formatInstant(Date.parse(isoStr), tz, { withYear: true }) : '—');
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') { process.stdout.write(SCHEDULE_HELP); return 0; }

  if (verb === 'list') {
    const all = rest.includes('--all');
    const series = listSchedules({ includeEnded: all });
    const tickets = listTickets({ all, oneShotOnly: true });
    if (!series.length && !tickets.length) { out('No scheduled runs. Add --at or --every to a run command (see: worca schedule help).'); return 0; }
    if (series.length) {
      out(c('bold', 'Repeating'));
      for (const s of series) {
        const state = s.status === 'active' ? `next ${when(s.nextRunAt)}` : s.status === 'paused' ? c('yellow', s.pauseReason === 'failure_streak' ? `paused after ${s.failureStreak} failures` : 'paused') : 'ended';
        out(`  ${s.id}  ${s.sentence}  ·  ${state}  ·  ${where(s)}  ·  ${s.title || ''}`);
      }
    }
    if (tickets.length) {
      out(c('bold', 'Once'));
      for (const t of tickets) {
        const st = t.status === 'scheduled' ? `in ${formatCountdown(Date.parse(t.runAt) - Date.now()) || 'a moment'}` : t.status === 'missed' ? c('yellow', 'missed') : t.status;
        const held = t.ownerPid != null && t.status === 'scheduled' ? '  ·  held by a waiting terminal' : '';
        out(`  ${t.id.slice(0, 8)}  ${when(t.runAt)}  ·  ${st}  ·  ${where(t)}  ·  ${t.title || ''}${held}`);
      }
    }
    const unread = unreadCount('schedule');
    if (unread) out(c('yellow', `\n${unread} unread problem${unread === 1 ? '' : 's'} — worca schedule log --unread`));
    return 0;
  }

  if (verb === 'log') {
    const rows = listNotifications({ unread: rest.includes('--unread'), limit: 50 }).reverse();
    if (!rows.length) { out('Nothing to report.'); return 0; }
    for (const n of rows) {
      const mark = n.unread ? c('yellow', '●') : ' ';
      out(`${mark} ${when(n.createdAt)}  ${(n.kind || '').padEnd(10)} ${n.title || 'Scheduled run'} ${n.message}`);
    }
    if (rest.includes('--mark-read')) { markAllRead('schedule'); out(c('gray', 'Marked all as read.')); }
    return 0;
  }

  const known = new Set(['show', 'run-now', 'move', 'cancel', 'skip', 'pause', 'resume']);
  if (!known.has(verb)) fail(`unknown schedule command "${verb}" — see: worca schedule help`);
  const found = resolveItem(rest.find((a) => !a.startsWith('-')), fail);
  const { kind, item } = found;
  const label = kind === 'recurring' ? item.id : item.id.slice(0, 8);

  if (verb === 'show') {
    out(c('bold', item.title || label));
    out(`  id         ${item.id}`);
    out(`  target     ${where(item)}`);
    if (kind === 'recurring') {
      out(`  repeats    ${item.sentence} (${item.tz})`);
      out(`  status     ${item.status}${item.pauseReason ? ` (${item.pauseReason.replace(/_/g, ' ')})` : ''}`);
      out(`  next run   ${when(item.nextRunAt)}`);
      out(`  runs       ${item.runsCount}${item.lastResult ? `, last: ${item.lastResult}` : ''}`);
      out(`  overlap    ${item.overlap}   pause after ${item.maxFailures || 'no'} failures (streak ${item.failureStreak})`);
    } else {
      out(`  when       ${when(item.runAt)}`);
      out(`  status     ${item.status}${item.failReason ? ` — ${item.failReason}` : ''}`);
      if (item.pipelineId) out(`  pipeline   ${item.pipelineId}`);
    }
    out(`  if missed  ${item.ifMissed === 'skip' ? 'skip' : `start late, within ${item.graceMin} min`}`);
    out(`  workflow   ${item.summary.workflowId}${item.summary.mock ? '  (mock)' : ''}`);
    if (item.summary.prompt) out(`  task       ${item.summary.prompt.split('\n')[0].slice(0, 100)}`);
    return 0;
  }

  if (verb === 'run-now') {
    const t = kind === 'recurring' ? runScheduleNow(item.id) : requestRunNow(item.id);
    if (!t) fail(`${label} is ${item.status} and cannot be started`);
    out(`Asked ${c('bold', label)} to start now.`);
    if (!(await serverIsUp()) && t.ownerPid == null) out(c('yellow', 'Note: no Worca server is up — it starts as soon as `worca ui` runs.'));
    return 0;
  }
  if (verb === 'cancel') {
    if (kind === 'recurring') { deleteSchedule(item.id); out(`Deleted the repeating schedule ${c('bold', label)}.`); return 0; }
    if (item.scheduleId) fail(`${label} is the next run of ${item.scheduleId} — use: worca schedule skip ${item.scheduleId}`);
    if (!cancelTicket(item.id)) fail(`${label} is ${item.status} and can no longer be canceled`);
    out(`Canceled ${c('bold', label)}.`);
    return 0;
  }
  if (verb === 'move') {
    if (kind === 'recurring') fail('a repeating schedule has no single time — delete it and create a new one, or edit it in the UI');
    if (item.scheduleId) fail(`${label} is the next run of ${item.scheduleId} and cannot be moved — skip it instead`);
    const i = rest.indexOf('--at');
    const inline = rest.find((a) => a.startsWith('--at='));
    const value = inline ? inline.slice(5) : (i !== -1 ? rest[i + 1] : undefined);
    if (!value) fail('move needs --at "<when>"');
    const at = parseAt(value, { nowMs: Date.now(), tz });
    if (!at.ok) fail(at.error);
    if (at.ms <= Date.now()) fail('--at: that time is in the past');
    if (!updateTicket(item.id, { runAtMs: at.ms })) fail(`${label} is ${item.status} and can no longer be moved`);
    out(`Moved ${c('bold', label)} to ${formatInstant(at.ms, tz, { withYear: true })} (in ${formatCountdown(at.ms - Date.now())}).`);
    return 0;
  }
  if (kind !== 'recurring') fail(`${verb} applies to a repeating schedule; ${label} runs once`);
  const s = verb === 'skip' ? skipNext(item.id) : verb === 'pause' ? pauseSchedule(item.id) : resumeSchedule(item.id);
  if (!s) fail(`${label} is ${item.status}`);
  out(verb === 'skip' ? `Skipped. Next run: ${when(s.nextRunAt)}.` : verb === 'pause' ? `Paused ${c('bold', label)}.` : `Resumed ${c('bold', label)}. Next run: ${when(s.nextRunAt)}.`);
  return 0;
}
