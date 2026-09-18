// test/cli-schedule.test.mjs — `worca … --at/--every/--cron`, the `worca schedule` verbs,
// and the `--wait` foreground mode (the terminal owns its ticket and starts the run itself).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { getDb } from '../src/core/db.mjs';
import { listTickets, listSchedules } from '../src/core/scheduler.mjs';
import { listNotifications } from '../src/core/notifications.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');
const home = useTempHome(after);
const proj = gitDir('cli-sched');
writeFileSync(join(proj, 'task.md'), '# Tidy the README\n\nMake it friendlier.\n');

function run(args) {
  return new Promise((res) => {
    // HOME too: settings.json (the schedule defaults) resolves under HOME, not WORCA_HOME.
    const env = { ...process.env, WORCA_MOCK: '1', WORCA_HOME: home, HOME: home, USERPROFILE: home, TZ: 'Europe/Berlin' };
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], { env, cwd: proj, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}

test('--at writes a one-shot ticket and exits without starting anything', async () => {
  const r = await run(['--project', proj, '--prompt', 'Upgrade dependencies', '--at', 'tomorrow 02:00', '--model', 'claude-sonnet-5', '--yes', '--grace', '2h', '--if-missed', 'skip']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Scheduled [0-9a-f]{8} for \w{3} \w{3} \d+ \d{4}, 02:00 \(in /);
  assert.match(r.stdout, /no Worca server is up/);
  const [t] = listTickets();
  assert.equal(t.title, 'Upgrade dependencies');
  assert.equal(t.ifMissed, 'skip');
  assert.equal(t.graceMin, 120);
  assert.equal(t.ownerPid, null);
  const req = JSON.parse(getDb().prepare('SELECT request FROM scheduled_runs WHERE id = ?').get(t.id).request);
  assert.deepEqual(req.internal, { extrasPaths: [], model: 'claude-sonnet-5', auto: true }, 'CLI-only options survive the wait');
  assert.equal(req.prompt, 'Upgrade dependencies');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM pipelines').get().n, 0);
});

test('--every freezes a --file prompt and creates a repeating schedule', async () => {
  const r = await run(['--project', proj, '--file', 'task.md', '--every', 'weekdays 02:00', '--overlap', 'queue', '--max-failures', '2', '--until', '2030-01-01']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Scheduled sch_[0-9a-f]{8} — Every weekday at 02:00, until 2030-01-01 \(Europe\/Berlin\)/);
  const [s] = listSchedules();
  assert.equal(s.overlap, 'queue');
  assert.equal(s.maxFailures, 2);
  assert.equal(s.title, 'Tidy the README');
  const req = JSON.parse(getDb().prepare('SELECT request FROM schedules WHERE id = ?').get(s.id).request);
  assert.match(req.promptMarkdown, /Make it friendlier/, 'the file CONTENT is stored, not its path');
  const c = await run(['--project', proj, '--prompt', 'x', '--cron', '30 3 * * 1,4']);
  assert.match(c.stdout, /Every Monday and Thursday at 03:30/);
});

test('bad schedule flags fail with exit 2 and a usable message, before anything is written', async () => {
  const before = listTickets({ all: true }).length + listSchedules().length;
  const bad = async (args, re) => { const r = await run(['--project', proj, '--prompt', 'x', ...args]); assert.equal(r.code, 2, r.stdout); assert.match(r.stderr, re); };
  await bad(['--at', 'yesterday'], /cannot read "yesterday"/);
  await bad(['--at', '2020-01-01 02:00'], /in the past/);
  await bad(['--cron', '*/5 * * * *'], /use --every/);
  await bad(['--every', 'fortnightly'], /--every/);
  await bad(['--wait'], /--wait needs --at/);
  await bad(['--every', 'day 02:00', '--wait'], /--wait needs --at/);
  await bad(['--at', '02:00', '--every', 'day 02:00'], /use one of --at, --every, --cron/);
  await bad(['--at', '02:00', '--count', '3'], /only applies to a repeating schedule/);
  await bad(['--every', 'day 02:00', '--overlap', 'never'], /--overlap must be one of/);
  await bad(['--at', '02:00', '--tz', 'Mars/Base'], /not a known timezone/);
  await bad(['--at', '02:00', '--grace', 'soon'], /--grace/);
  await bad(['--at', '02:00', '--workflow', 'wf_nope'], /workflow/i);
  assert.equal(listTickets({ all: true }).length + listSchedules().length, before);
});

test('worca schedule: list, show, move, skip, pause, resume, run-now, cancel, log', async () => {
  const t = listTickets({ oneShotOnly: true })[0];
  const s = listSchedules().find((x) => x.overlap === 'queue');
  const short = t.id.slice(0, 8);
  let r = await run(['schedule', 'list']);
  assert.match(r.stdout, /Repeating/); assert.match(r.stdout, /Once/); assert.match(r.stdout, new RegExp(short));
  r = await run(['schedule', 'show', short]);
  assert.match(r.stdout, /if missed  skip/);
  r = await run(['schedule', 'move', short, '--at', '+3h']);
  assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /Moved/);
  r = await run(['schedule', 'skip', s.id]);
  assert.match(r.stdout, /Skipped\. Next run:/);
  assert.match((await run(['schedule', 'pause', s.id])).stdout, /Paused/);
  assert.equal((await run(['schedule', 'pause', s.id])).code, 2);
  assert.match((await run(['schedule', 'resume', s.id])).stdout, /Resumed/);
  assert.equal((await run(['schedule', 'skip', short])).code, 2, 'skip is for repeating schedules');
  assert.equal((await run(['schedule', 'move', s.id, '--at', '+1h'])).code, 2);
  assert.match((await run(['schedule', 'run-now', short])).stdout, /start now/);
  assert.equal(listTickets().find((x) => x.id === t.id).forced, true);
  r = await run(['schedule', 'cancel', short]);
  assert.match(r.stdout, /Canceled/);
  assert.equal((await run(['schedule', 'cancel', short])).code, 2);
  assert.match((await run(['schedule', 'cancel', s.id])).stdout, /Deleted the repeating schedule/);
  assert.equal((await run(['schedule', 'show', 'zzzz'])).code, 2);
  assert.equal((await run(['schedule', 'frobnicate'])).code, 2);
  assert.match((await run(['schedule', 'help'])).stdout, /worca schedule — manage scheduled runs/);
  assert.match((await run(['--help'])).stdout, /--at <when>/);
});

test('--wait owns the ticket, starts the run in this terminal, and reports the outcome', { timeout: 120000 }, async () => {
  const r = await run(['--project', proj, '--prompt', 'Wait mode demo', '--at', '+2s', '--wait', '--yes', '--mock']);
  assert.equal(r.code, 0, r.stderr + r.stdout.slice(-600));
  assert.match(r.stdout, /Waiting here/);
  assert.match(r.stdout, /Starting the scheduled run/);
  assert.match(r.stdout, /Pipeline complete/);
  const t = listTickets({ all: true }).find((x) => x.title === 'Wait mode demo');
  assert.equal(t.status, 'fired');
  assert.ok(t.pipelineId, 'the ticket learned its pipeline');
  const row = getDb().prepare('SELECT status, scheduled_for FROM pipelines WHERE id = ?').get(t.pipelineId);
  assert.equal(row.status, 'done');
  assert.equal(row.scheduled_for, t.runAt);
  assert.ok(listNotifications().some((n) => n.kind === 'completed' && n.ticketId === t.id));
  assert.match((await run(['schedule', 'log'])).stdout, /completed\s+Wait mode demo finished\./);
});
