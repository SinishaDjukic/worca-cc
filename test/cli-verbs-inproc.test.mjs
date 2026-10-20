// test/cli-verbs-inproc.test.mjs — the CLI verbs whose io is already injectable, driven
// in-process: readScheduleFlags' refusals (the bad-flag matrices cli-schedule used to
// spawn), waitAndRun's foreground wait (Run now, canceled, lost ownership) and the `fail`
// refusals of cmdLogs, cmdRuns and cmdControl. `fail` throws here (the real one exits 2),
// so each row stops at the first problem exactly like the CLI. cli-schedule, cli-logs
// and cli-control keep one spawn smoke per verb family: the real `fail` reaching stderr
// with exit 2, and the guards that live in worca-cc.mjs's main().
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { checkRows } from './helpers/rows.mjs';
import { getDb } from '../src/core/db.mjs';
import { createTicket, getTicket, listTickets, listSchedules, requestRunNow, cancelTicket, releaseTicket, createSchedule } from '../src/core/scheduler.mjs';
import { listNotifications } from '../src/core/notifications.mjs';
import { settingsFile } from '../src/core/settings.mjs';
import { readScheduleFlags, wantsSchedule, waitAndRun } from '../src/cli/schedule.mjs';
import { cmdLogs } from '../src/cli/logs.mjs';
import { cmdRuns } from '../src/cli/runs.mjs';
import { cmdControl } from '../src/cli/control.mjs';

const home = useTempHome(after);
// scheduleDefaults() reads settings.json under HOME, not WORCA_HOME.
const prevHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.HOME = home;
process.env.USERPROFILE = home;
const proj = gitDir('cli-inproc');
after(() => {
  for (const [k, v] of Object.entries(prevHome)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(proj, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const TZ = 'Europe/Berlin';
const NOW = Date.parse('2026-10-05T12:00:00Z');
const c = (_k, s) => s;
const fail = (m) => { throw Object.assign(new Error(m), { code: 'CLI_FAIL' }); };
/** The error `fail` threw, with the expected message: never a TypeError on the way. */
const failedWith = (re) => (e) => e.code === 'CLI_FAIL' && re.test(e.message);
const flagsRefused = (flags, re) => assert.throws(() => readScheduleFlags({ tz: TZ, ...flags }, { fail, now: NOW, projectDir: proj }), failedWith(re));

function insertPipeline(id, status = 'running') {
  const iso = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO pipelines (id, project_key, target, title, status, phase, cycle, started_at, updated_at)
    VALUES (?, 'proj-a', 'project', ?, ?, 'plan', 1, ?, ?)
  `).run(id, `run ${id}`, status, iso, iso);
}

// ── readScheduleFlags ─────────────────────────────────────────────────────────────

test('readScheduleFlags refuses every bad timed flag with its own message, through fail', async () => {
  const at = readScheduleFlags({ tz: TZ, at: 'tomorrow 02:00' }, { fail, now: NOW, projectDir: proj });
  assert.ok(at.runAtMs > NOW, 'the positive control: a good --at parses to a future instant');
  await checkRows([
    { name: 'an unreadable --at', run: () => flagsRefused({ at: 'yesterday' }, /cannot read "yesterday"/) },
    { name: 'an --at in the past', run: () => flagsRefused({ at: '2020-01-01 02:00' }, /^--at: .* is in the past$/) },
    { name: 'a --cron step under 15 minutes', run: () => flagsRefused({ cron: '*/5 * * * *' }, /at least 15 minutes apart: every 5 minutes is too often/) },
    { name: 'a --cron month field the subset cannot express', run: () => flagsRefused({ cron: '0 2 * 6 *' }, /use --every/) },
    { name: 'an --every under 15 minutes', run: () => flagsRefused({ every: '10m' }, /at least 15 minutes apart/) },
    { name: 'an --every with no pattern and time', run: () => flagsRefused({ every: 'fortnightly' }, /--every/) },
    { name: '--wait on a repeating schedule', run: () => flagsRefused({ every: 'day 02:00', wait: true }, /^--wait needs --at: a repeating schedule is started by the Worca server/) },
    { name: 'two timing flags', run: () => flagsRefused({ at: '02:00', every: 'day 02:00' }, /^use one of --at, --every, --cron, --after \(got: --at, --every\)$/) },
    { name: 'a repeating-only flag on a one-off', run: () => flagsRefused({ at: '02:00', count: '3' }, /^--count only applies to a repeating schedule/) },
    { name: 'an unknown --overlap', run: () => flagsRefused({ every: 'day 02:00', overlap: 'never' }, /^--overlap must be one of .*, got: never$/) },
    { name: 'an unknown --tz', run: () => flagsRefused({ at: '02:00', tz: 'Mars/Base' }, /^--tz: "Mars\/Base" is not a known timezone$/) },
    { name: 'an unreadable --grace', run: () => flagsRefused({ at: '02:00', grace: 'soon' }, /^--grace: cannot read "soon"/) },
  ]);
});

test('readScheduleFlags refuses a bad --after chain with its own message; the prefix lookup is literal', async () => {
  const pred = createTicket({ title: 'Refactor', projectDir: proj, runAtMs: NOW + 86_400_000, request: {} });
  // The rule exactly as the CLI hands it to createSchedule: readScheduleFlags' normalized one.
  const { rule } = readScheduleFlags({ tz: TZ, every: 'weekdays 03:00' }, { fail, projectDir: proj });
  const { ticket: occ } = createSchedule({ title: 'Nightly occ', projectDir: proj, request: {}, rule });
  assert.ok(occ, 'the series minted its first occurrence');
  const short = pred.id.slice(0, 8);
  const before = listTickets({ all: true }).length + listSchedules().length;
  const ok = readScheduleFlags({ tz: TZ, after: short, afterAny: true, sourceFromPrevious: true }, { fail, now: NOW, projectDir: proj });
  assert.deepEqual([ok.after.id, ok.afterPolicy, ok.sourceFromPrevious], [pred.id, 'any', true], 'the positive control: the prefix resolves');
  assert.equal(wantsSchedule({ after: '' }), true, '--after "" is a schedule that fails, never a run started now');
  await checkRows([
    { name: 'a repeating schedule id', run: () => flagsRefused({ after: 'sch_deadbeef' }, /^a repeating schedule is not supported — give the id of one of its runs$/) },
    { name: 'an occurrence of a repeating schedule, found by its prefix', run: () => flagsRefused({ after: occ.id.slice(0, 8) }, /^after a repeating schedule is not supported — give the id of one of its runs$/) },
    { name: '--wait on a chained run', run: () => flagsRefused({ after: short, wait: true }, /^--wait needs --at: a run after another run is started by the Worca server/) },
    { name: 'a timed-only flag on a chained run', run: () => flagsRefused({ after: short, grace: '2h' }, /^--grace only applies to a timed schedule/) },
    { name: '--source-from-previous without --after', run: () => flagsRefused({ sourceFromPrevious: true, at: 'tomorrow 03:00' }, /^--source-from-previous needs --after$/) },
    { name: '--after-any without --after', run: () => flagsRefused({ afterAny: true, at: 'tomorrow 03:00' }, /^--after-any needs --after$/) },
    { name: '--source-from-previous with --source-branch', run: () => flagsRefused({ after: short, sourceFromPrevious: true, sourceBranch: 'main' }, /^--source-from-previous and --source-branch cannot both be given$/) },
    { name: 'a prefix nothing matches', run: () => flagsRefused({ after: 'zzzzzzzz' }, /^no run or scheduled run matches "zzzzzzzz"$/) },
    { name: '--after with a time', run: () => flagsRefused({ after: short, at: 'tomorrow 03:00' }, /^use one of --at, --every, --cron, --after/) },
    { name: 'an empty --after (an unset shell variable)', run: () => flagsRefused({ after: '' }, /^--after needs a run id/) },
    { name: 'LIKE metacharacters are literal: a lone _ matches nothing, never every row', run: () => flagsRefused({ after: '_' }, /^no run or scheduled run matches "_"$/) },
  ]);
  assert.equal(listTickets({ all: true }).length + listSchedules().length, before, 'nothing was written');
});

// ── waitAndRun ────────────────────────────────────────────────────────────────────

/** A ticket this process owns, due in an hour, and a waitAndRun whose sleep acts on it. */
async function waitOn(title, onSleep, { request = {}, ...opts } = {}) {
  const t = createTicket({ title, projectDir: proj, runAtMs: Date.now() + 3_600_000, request, ownerPid: process.pid });
  const lines = [];
  const sleeps = [];
  let driven = 0;
  const sigint = process.listenerCount('SIGINT');
  const code = await waitAndRun({
    ticketId: t.id, tz: TZ, out: (l) => lines.push(l), c, pollMs: 5000,
    // A wait that ignores the change would poll forever on microtasks (no timer ever fires,
    // not even the test timeout): bail out loudly instead.
    sleep: async (ms) => {
      if (sleeps.push(ms) > 3) throw new Error(`waitAndRun kept polling after: ${title}`);
      onSleep(t.id);
    },
    drive: async (onPipelineId) => { driven++; onPipelineId('abcd1234'); return { code: 0, status: 'done' }; },
    ...opts,
  });
  assert.equal(process.listenerCount('SIGINT'), sigint, 'the Ctrl+C handler is released on every path');
  return { id: t.id, code, lines, sleeps, driven };
}

test('waitAndRun: Run now during the wait starts the run here through drive and reports it done', async () => {
  const w = await waitOn('Wait in process', (id) => requestRunNow(id));
  assert.equal(w.code, 0);
  assert.equal(w.driven, 1, 'drive ran exactly once');
  assert.deepEqual(w.sleeps, [5000], 'one poll, capped at pollMs, then the forced ticket is due');
  assert.match(w.lines[0], /^Waiting here\. Ctrl\+C hands the run to the Worca server/);
  assert.match(w.lines.join('\n'), /^ {2}starts .* — in /m);
  assert.equal(w.lines.at(-1), 'Starting the scheduled run — Wait in process');
  const t = getTicket(w.id);
  assert.equal(t.status, 'fired');
  assert.equal(t.pipelineId, 'abcd1234', 'drive\'s onPipelineId reached the ticket');
  assert.ok(listNotifications().some((n) => n.kind === 'completed' && n.ticketId === w.id), 'the outcome was recorded');
});

test('waitAndRun: a canceled ticket or a lost ownership ends the wait with exit 0 and never drives', async () => {
  await checkRows([
    { name: 'canceled from the UI while waiting', run: async () => {
      const w = await waitOn('Wait then cancel', (id) => cancelTicket(id));
      assert.deepEqual([w.code, w.driven], [0, 0]);
      assert.equal(w.lines.at(-1), 'The scheduled run was canceled.');
      assert.equal(getTicket(w.id).status, 'canceled');
    } },
    { name: 'ownership released (the server takes it over)', run: async () => {
      const w = await waitOn('Wait then release', (id) => releaseTicket(id));
      assert.deepEqual([w.code, w.driven], [0, 0]);
      assert.equal(w.lines.at(-1), 'This terminal no longer owns the run — the Worca server will start it.');
      const t = getTicket(w.id);
      assert.deepEqual([t.status, t.ownerPid], ['scheduled', null], 'it stays scheduled, for the server');
    } },
  ]);
});

test('waitAndRun: enforced tags re-check after the claim — a refusal skips the ticket (exit 2), a pass retags and drives', async () => {
  await checkRows([
    { name: 'refused: skipped with the reason, never driven', run: async () => {
      const w = await waitOn('Wait then refuse', (id) => requestRunNow(id), { checkTags: async () => ({ tags: [], error: 'Add Cost centre to start', enforced: true }) });
      assert.deepEqual([w.code, w.driven], [2, 0]);
      const t = getTicket(w.id);
      assert.deepEqual([t.status, t.failReason], ['skipped', 'Add Cost centre to start']);
      assert.equal(w.lines.at(-1), 'worca: Add Cost centre to start');
    } },
    { name: 'passed: retag gets the filled list, drive runs', run: async () => {
      const retagged = [];
      const w = await waitOn('Wait then retag', (id) => requestRunNow(id), {
        checkTags: async () => ({ tags: ['cc:4410'], error: null, enforced: true }), retag: (tags) => retagged.push(tags),
      });
      assert.deepEqual([w.code, w.driven], [0, 1]);
      assert.deepEqual(retagged, [['cc:4410']]);
    } },
    { name: 'default check reads the stored request\'s tags (withRequest)', run: async () => {
      const prev = process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
      process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
      mkdirSync(dirname(settingsFile()), { recursive: true });
      writeFileSync(settingsFile(), JSON.stringify({ tagDimensions: [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }], enforceTags: true }));
      try {
        const w = await waitOn('Wait with stored tags', (id) => requestRunNow(id), { request: { tags: ['cc:4410'] } });
        assert.deepEqual([w.code, w.driven], [0, 1]);
        assert.notEqual(getTicket(w.id).status, 'skipped');
      } finally {
        writeFileSync(settingsFile(), '{}');
        if (prev === undefined) delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK; else process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = prev;
      }
    } },
  ]);
});

// ── cmdLogs / cmdRuns / cmdControl: the usage refusals ────────────────────────────

test('logs, runs, stop and pause refuse bad usage, unknown ids and ambiguous prefixes through fail', async () => {
  insertPipeline('fff10001');
  insertPipeline('fff10002');
  const io = { out: () => assert.fail('a refusal prints nothing to stdout'), c, fail };
  const refused = (call, re) => assert.rejects(call, failedWith(re));
  await checkRows([
    { name: 'logs: an id is required', run: () => refused(() => cmdLogs([], io), /^a run id is required/) },
    { name: 'logs: an unknown option', run: () => refused(() => cmdLogs(['--watch', 'aaaaaaaa'], io), /^unknown option: --watch — see: worca logs help$/) },
    { name: 'logs: a bad --level', run: () => refused(() => cmdLogs(['--level', 'verbose', 'aaaaaaaa'], io), /^--level must be one of debug, info, warn, error, got: verbose$/) },
    { name: 'logs: one run at a time', run: () => refused(() => cmdLogs(['aaaaaaaa', 'bbbbbbbb'], io), /^one run at a time/) },
    { name: 'logs: an unknown run id refuses like worca runs does', run: () => refused(() => cmdLogs(['zzzz9999'], io), /^no run matches "zzzz9999" \(see: worca runs list\)$/) },
    { name: 'logs: an ambiguous prefix names the match count', run: () => refused(() => cmdLogs(['fff1'], io), /^"fff1" matches 2 runs — use a longer id$/) },
    { name: 'runs: an unknown verb or id is one combined error, never a silent list', run: () => refused(() => cmdRuns(['lst'], io), /^no run matches "lst", and "lst" is not a known verb either/) },
    { name: 'runs show: an unknown id', run: () => refused(() => cmdRuns(['show', 'zzzz9999'], io), /^no run matches "zzzz9999" \(see: worca runs list\)$/) },
    { name: 'runs: a bad --status', run: () => refused(() => cmdRuns(['--status', 'failed'], io), /^--status must be one of .*, got: failed$/) },
    { name: 'runs: an unknown option', run: () => refused(() => cmdRuns(['list', '--bogus'], io), /^unknown option\(s\): --bogus — see: worca runs help$/) },
    { name: 'stop: an unknown option', run: () => refused(() => cmdControl('stop', ['--watch', 'fff10001'], io), /^unknown option\(s\): --watch — see: worca stop help$/) },
    { name: 'stop: an id is required', run: () => refused(() => cmdControl('stop', [], io), /^a run id is required/) },
    { name: 'pause: an ambiguous prefix names the match count', run: () => refused(() => cmdControl('pause', ['fff1'], io), /^"fff1" matches 2 runs — use a longer id$/) },
    { name: 'stop: an unknown run id', run: () => refused(() => cmdControl('stop', ['zzzz9999'], io), /^no run matches "zzzz9999"/) },
  ]);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM pipeline_commands').get().n, 0, 'no refusal enqueued a command');
});
