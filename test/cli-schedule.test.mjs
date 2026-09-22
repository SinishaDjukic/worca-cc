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

test('--after writes a chained ticket; --wait, timed-only flags and a lone --source-from-previous are refused', async () => {
  const seed = await run(['--project', proj, '--prompt', 'Refactor', '--at', 'tomorrow 02:00', '--yes']);
  assert.equal(seed.code, 0, seed.stderr);
  const pred = listTickets().find((t) => t.title === 'Refactor');
  const short = pred.id.slice(0, 8);
  const r = await run(['--project', proj, '--prompt', 'Add tests', '--after', short, '--after-any', '--source-from-previous', '--yes']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Scheduled [0-9a-f]{8} after ‘Refactor’ \(scheduled\)/);
  const t = listTickets().find((x) => x.title === 'Add tests');
  assert.deepEqual(t.after, { kind: 'ticket', id: pred.id, policy: 'any' });
  assert.equal(t.sourceFromPrevious, true);
  assert.equal(t.runAt, '9999-12-31T00:00:00.000Z');
  // Run now on it would force the gate open with nothing to branch from — the server's 409, as an exit 2.
  const rn = await run(['schedule', 'run-now', t.id.slice(0, 8)]);
  assert.equal(rn.code, 2); assert.match(rn.stderr, /Start ‘Refactor’ first, or change its source branch/);
  assert.equal(listTickets().find((x) => x.id === t.id).forced, false, 'nothing was forced');
  // A repeating schedule's own id is refused with the pinned sentence, not "no run matches".
  const ser = await run(['--project', proj, '--prompt', 'x', '--after', 'sch_deadbeef']);
  assert.equal(ser.code, 2); assert.match(ser.stderr, /a repeating schedule is not supported — give the id of one of its runs/);
  const w = await run(['--project', proj, '--prompt', 'x', '--after', short, '--wait']);
  assert.equal(w.code, 2); assert.match(w.stderr, /--wait needs --at: a run after another run is started by the Worca server/);
  const g = await run(['--project', proj, '--prompt', 'x', '--after', short, '--grace', '2h']);
  assert.equal(g.code, 2); assert.match(g.stderr, /--grace only applies to a timed schedule/);
  const s = await run(['--project', proj, '--prompt', 'x', '--source-from-previous', '--at', 'tomorrow 03:00']);
  assert.equal(s.code, 2); assert.match(s.stderr, /--source-from-previous needs --after/);
  const aa = await run(['--project', proj, '--prompt', 'x', '--after-any', '--at', 'tomorrow 03:00']);
  assert.equal(aa.code, 2); assert.match(aa.stderr, /--after-any needs --after/);
  const b = await run(['--project', proj, '--prompt', 'x', '--after', short, '--source-from-previous', '--source-branch', 'main']);
  assert.equal(b.code, 2); assert.match(b.stderr, /--source-from-previous and --source-branch cannot both be given/);
  const n = await run(['--project', proj, '--prompt', 'x', '--after', 'zzzzzzzz']);
  assert.equal(n.code, 2); assert.match(n.stderr, /no run or scheduled run matches "zzzzzzzz"/);
  const both = await run(['--project', proj, '--prompt', 'x', '--after', short, '--at', 'tomorrow 03:00']);
  assert.equal(both.code, 2); assert.match(both.stderr, /use one of --at, --every, --cron, --after/);
  // With NO schedule flag at all readScheduleFlags never runs — the lone flag must still be refused.
  // Keep the stderr match: without the guard the CLI still exits 2 (the stdin/--yes refusal), so the
  // exit code alone proves nothing.
  const lone = await run(['--project', proj, '--prompt', 'x', '--source-from-previous']);
  assert.equal(lone.code, 2); assert.match(lone.stderr, /need --after/);
  // `--after ""` (an unset shell variable in a chaining script) is scheduling that fails — never a run started now.
  const empty = await run(['--project', proj, '--prompt', 'x', '--after', '']);
  assert.equal(empty.code, 2); assert.match(empty.stderr, /--after needs a run id/);
  // LIKE metacharacters in the prefix are literal: a lone `_` matches nothing, never every row (which
  // would read "matches N runs" — there are several tickets by now).
  const meta = await run(['--project', proj, '--prompt', 'x', '--after', '_']);
  assert.equal(meta.code, 2); assert.match(meta.stderr, /no run or scheduled run matches "_"/);
});

test('schedule list / show print the predecessor; move --after re-chains a ticket', async () => {
  const pred = listTickets().find((t) => t.title === 'Refactor');
  const t = listTickets().find((x) => x.title === 'Add tests');
  const list = await run(['schedule', 'list']);
  assert.match(list.stdout, new RegExp(`${t.id.slice(0, 8)}  after ‘Refactor’  ·  waiting`));
  const show = await run(['schedule', 'show', t.id.slice(0, 8)]);
  assert.match(show.stdout, /after {6}‘Refactor’ \(scheduled\)/);
  assert.match(show.stdout, /on error {3}start anyway/);
  assert.match(show.stdout, /source {5}the run before it/);
  assert.doesNotMatch(show.stdout, /if missed/);
  const other = await run(['--project', proj, '--prompt', 'Other', '--at', 'tomorrow 04:00', '--yes']);
  assert.equal(other.code, 0, other.stderr);
  const o = listTickets().find((x) => x.title === 'Other');
  const mv = await run(['schedule', 'move', t.id.slice(0, 8), '--after', o.id.slice(0, 8)]);
  assert.equal(mv.code, 0, mv.stderr);
  assert.match(mv.stdout, /Moved [0-9a-f]{8} after ‘Other’/);
  assert.equal(listTickets().find((x) => x.id === t.id).after.id, o.id);
  // `--at` and `--after` together are refused on move as on create; a flag BEFORE the id still moves the id.
  const mixed = await run(['schedule', 'move', t.id.slice(0, 8), '--after', o.id.slice(0, 8), '--at', 'tomorrow 05:00']);
  assert.equal(mixed.code, 2); assert.match(mixed.stderr, /use --at or --after, not both/);
  const swapped = await run(['schedule', 'move', '--after', o.id.slice(0, 8), t.id.slice(0, 8)]);
  assert.equal(swapped.code, 0, swapped.stderr);
  assert.match(swapped.stdout, /Moved [0-9a-f]{8} after ‘Other’/);
  const any = await run(['schedule', 'move', t.id.slice(0, 8), '--after', pred.id.slice(0, 8), '--after-any']);
  assert.equal(any.code, 0, any.stderr);
  assert.equal(listTickets().find((x) => x.id === t.id).after.policy, 'any');
  const cyc = await run(['schedule', 'move', pred.id.slice(0, 8), '--after', t.id.slice(0, 8)]);
  assert.equal(cyc.code, 2); assert.match(cyc.stderr, /already waits for this run/);
  // A FIRED one-off ticket is still a valid predecessor: the gate follows it into its pipeline.
  const done = listTickets({ all: true }).find((x) => x.title === 'Wait mode demo');
  const chain = await run(['--project', proj, '--prompt', 'After the wait run', '--after', done.id.slice(0, 8), '--yes']);
  assert.equal(chain.code, 0, chain.stderr);
  assert.match(chain.stdout, /Scheduled [0-9a-f]{8} after ‘Wait mode demo’ \(fired\)/);
  // `list` prints the predecessor's title whole — a title with parentheses must keep its closing quote.
  const paren = await run(['--project', proj, '--prompt', 'Refactor (v2)', '--at', 'tomorrow 06:00', '--yes']);
  assert.equal(paren.code, 0, paren.stderr);
  const pv = listTickets().find((x) => x.title === 'Refactor (v2)');
  const onto = await run(['--project', proj, '--prompt', 'Onto parens', '--after', pv.id.slice(0, 8), '--yes']);
  assert.equal(onto.code, 0, onto.stderr);
  assert.match((await run(['schedule', 'list'])).stdout, /after ‘Refactor \(v2\)’  ·  waiting/);
  // An OCCURRENCE of a repeating schedule is found by its prefix and refused with the pinned sentence.
  const ser = await run(['--project', proj, '--prompt', 'Nightly occ', '--every', 'weekdays 03:00', '--yes']);
  assert.equal(ser.code, 0, ser.stderr);
  const occ = listTickets({ all: true }).find((x) => x.scheduleId && x.title === 'Nightly occ');
  assert.ok(occ, 'the series minted its first occurrence');
  const viaOcc = await run(['--project', proj, '--prompt', 'x', '--after', occ.id.slice(0, 8)]);
  assert.equal(viaOcc.code, 2); assert.match(viaOcc.stderr, /a repeating schedule is not supported — give the id of one of its runs/);
});

test('the management verbs find an after-ticket on a busy home: it sits at the 9999 sentinel, past listTickets\' cap', async () => {
  const t = listTickets().find((x) => x.title === 'Add tests');   // still chained after the moves above
  // 2000 ended one-offs dated BEFORE the sentinel: listTickets({ all: true, limit: 2000 }) is ORDER BY
  // run_at, so the after-ticket is the first row it drops — resolveItem must read the row by prefix.
  const ins = getDb().prepare("INSERT INTO scheduled_runs (id, title, project_dir, run_at, request, status, created_at, updated_at) VALUES (?, 'filler', ?, ?, '{}', 'canceled', ?, ?)");
  const ts = new Date().toISOString();
  for (let i = 0; i < 2000; i++) ins.run(`ffff${String(i).padStart(4, '0')}-0000-4000-8000-000000000000`, proj, `2000-01-01T00:00:00.${String(i % 1000).padStart(3, '0')}Z`, ts, ts);
  const show = await run(['schedule', 'show', t.id.slice(0, 8)]);
  assert.equal(show.code, 0, show.stderr);
  assert.match(show.stdout, /after {6}‘/);
  const cancel = await run(['schedule', 'cancel', t.id.slice(0, 8)]);
  assert.equal(cancel.code, 0, cancel.stderr);
  assert.equal(listTickets({ all: true, limit: 2000 }).some((x) => x.id === t.id), false, 'the premise: the cap really hides it');
});
