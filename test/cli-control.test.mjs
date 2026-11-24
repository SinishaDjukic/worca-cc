// test/cli-control.test.mjs — `worca stop | pause` (issue #513): the control
// mailbox round trip. The CLI writes a command to pipeline_commands; the run's
// OWNING process claims and executes it; the CLI reports from the run's ROW —
// never from the command. Covers the core module's at-most-once claim, the reaper,
// the live-boundary refusals, the dead-owner pre-check, and the full transport
// with a simulated owner (the harness's exact contract: claim → act → row status).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { enqueuePipelineCommand, claimPipelineCommand, reapPipelineCommands, discardPendingPipelineCommands } from '../src/core/pipeline-commands.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitDir } from './helpers/git-dir.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { projectKey } from '../src/core/store.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createTicket, resumeTicketsFor } from '../src/core/scheduler.mjs';
import { checkRows } from './helpers/rows.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');
const SRC = resolve(__dirname, '..', 'src');
const home = useTempHome(after);
const HOST = hostname();

function run(args, extraEnv = {}) {
  return new Promise((res) => {
    // HOME too: settings.json resolves under HOME, not WORCA_HOME.
    const env = { ...process.env, WORCA_HOME: home, HOME: home, USERPROFILE: home, ...extraEnv };
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}

/** Seed one pipelines row, with owner columns (the control commands read them). */
function insertPipeline({ id, title, status, minutesAgo = 1, ownerPid = null, ownerHost = null, heartbeatAt = null }) {
  const iso = (ms) => new Date(ms).toISOString();
  const t = Date.now() - minutesAgo * 60_000;
  getDb().prepare(`
    INSERT INTO pipelines (id, project_key, target, title, status, phase, cycle, started_at, updated_at)
    VALUES (?, 'proj-a', 'project', ?, ?, 'plan', 1, ?, ?)
  `).run(id, title, status, iso(t), iso(t + 30_000));
  if (ownerPid != null || ownerHost || heartbeatAt) {
    getDb().prepare('UPDATE pipelines SET owner_pid = ?, owner_host = ?, heartbeat_at = ? WHERE id = ?')
      .run(ownerPid, ownerHost, heartbeatAt, id);
  }
}

/** A paused (or interrupted) row the CLI can stop in-process: registered project, v2 resume
 *  point, no worktree (the harness suite covers the teardown). */
async function insertParked({ id, title, status = 'paused' }) {
  const dir = gitDir(`cli-${id}`);
  await addProject({ name: `cli-${id}`, path: dir });
  const iso = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO pipelines (id, project_key, target, title, status, phase, cycle, started_at, updated_at, resume_point)
    VALUES (?, ?, 'project', ?, ?, 'plan', 1, ?, ?, ?)
  `).run(id, projectKey(dir), title, status, iso, iso,
    JSON.stringify(graphResumePoint({ pipelineDir: mkdtempSync(join(tmpdir(), 'cli-stop-pdir-')) })));
}

const commandsOf = (pipelineId) => getDb().prepare(
  'SELECT id, action, consumed_at, consumed_by FROM pipeline_commands WHERE pipeline_id = ? ORDER BY id',
).all(pipelineId);

// ── the store layer ──────────────────────────────────────────────────────────────

test('migration: the mailbox table and its pending index exist on a fresh store', () => {
  const db = getDb();
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pipeline_commands'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_pipeline_commands_pending'").get());
  assert.ok(db.prepare('PRAGMA user_version').get().user_version >= 44);
});

test('claim is at-most-once and FIFO, carries actor and JSON payload; the losing side of a race gets null', async () => {
  await checkRows([
    { name: 'claim is at-most-once and FIFO; the losing side of a race gets null', run: async () => {
      insertPipeline({ id: 'ccc10001', title: 'mailbox demo', status: 'running' });
      const a = enqueuePipelineCommand('ccc10001', 'stop', { by: 'alice' });
      const b = enqueuePipelineCommand('ccc10001', 'pause');
      assert.ok(b.id > a.id, 'FIFO arrival order');
      const first = claimPipelineCommand('ccc10001');
      assert.equal(first.action, 'stop');
      assert.equal(first.by, 'alice', "the command's actor rides through");
      const second = claimPipelineCommand('ccc10001');
      assert.equal(second.action, 'pause');
      assert.equal(claimPipelineCommand('ccc10001'), null, 'nothing left to claim');
      assert.ok(commandsOf('ccc10001').every((r) => r.consumed_at), 'both rows are consumed');
    } },
    { name: 'payload round-trips as JSON (the reserved column the answer action will use)', run: async () => {
      enqueuePipelineCommand('ccc10001', 'pause', { payload: { choice: 'approve' } });
      const cmd = claimPipelineCommand('ccc10001');
      assert.deepEqual(cmd.payload, { choice: 'approve' });
      assert.equal(claimPipelineCommand('ccc10001'), null);
    } },
  ]);
});

test('reap drops commands of settled runs; discard drops only one pipeline\'s UNCLAIMED commands', async () => {
  await checkRows([
    { name: 'reap drops commands whose run settled and keeps the live ones', run: async () => {
      insertPipeline({ id: 'ccc10002', title: 'finished', status: 'done' });
      insertPipeline({ id: 'ccc10003', title: 'still live', status: 'running' });
      enqueuePipelineCommand('ccc10002', 'stop');
      const keep = enqueuePipelineCommand('ccc10003', 'pause');
      reapPipelineCommands();
      assert.equal(commandsOf('ccc10002').length, 0, 'a settled run can never execute a command');
      assert.equal(commandsOf('ccc10003').length, 1);
      assert.equal(commandsOf('ccc10003')[0].id, keep.id);
    } },
    { name: 'discard drops only the UNCLAIMED commands of one pipeline', run: async () => {
      insertPipeline({ id: 'ccc10004', title: 'discard demo', status: 'running' });
      insertPipeline({ id: 'ccc10005', title: 'bystander', status: 'running' });
      enqueuePipelineCommand('ccc10004', 'stop');
      claimPipelineCommand('ccc10004');                 // executed: stays as the audit trail
      enqueuePipelineCommand('ccc10004', 'pause');      // pending: dropped
      enqueuePipelineCommand('ccc10005', 'stop');       // another run's: untouched
      assert.equal(discardPendingPipelineCommands('ccc10004'), 1);
      assert.deepEqual(commandsOf('ccc10004').map((r) => Boolean(r.consumed_at)), [true]);
      assert.equal(commandsOf('ccc10005').length, 1);
    } },
  ]);
});

// ── the harness: ownership start discards stale commands, then the slot executes ──

/** The harness's control methods on a stand-in `this` — the real prototype code,
 *  without booting a whole run. */
function fakeOwner(pipelineId) {
  const calls = [];
  return {
    calls,
    pipeline: { id: pipelineId },
    _log() {},
    stop: (by) => calls.push(['stop', by]),
    pause: (by) => { calls.push(['pause', by]); return true; },
    _checkControlSlot: RunHarness.prototype._checkControlSlot,
  };
}

test('a stop left pending before a resume does NOT stop the resumed run', () => {
  // `worca stop` timed out unconfirmed, then the run was paused another way: the
  // command is still pending when `worca resume` re-takes ownership.
  insertPipeline({ id: 'ggg10001', title: 'resumed run', status: 'running' });
  enqueuePipelineCommand('ggg10001', 'stop');
  const owner = fakeOwner('ggg10001');
  RunHarness.prototype._startHeartbeat.call(owner);
  try {
    assert.equal(commandsOf('ggg10001').length, 0, 'the stale stop is discarded on ownership');
    owner._checkControlSlot();
    assert.deepEqual(owner.calls, [], 'nothing executes against the resumed run');
    // A command written AFTER ownership is the live path: claimed and executed with its actor.
    enqueuePipelineCommand('ggg10001', 'pause', { by: 'alice' });
    owner._checkControlSlot();
    assert.deepEqual(owner.calls, [['pause', 'alice']]);
  } finally { RunHarness.prototype._stopHeartbeat.call(owner); }
});

test("the owner's control timer picks a command up within one poll interval", { timeout: 10000 }, async () => {
  insertPipeline({ id: 'ggg10002', title: 'timer run', status: 'running' });
  const owner = fakeOwner('ggg10002');
  // The poll period is read when _startHeartbeat arms the timer: 25 ms here, not 1 s.
  const prevControlCheckMs = process.env.WORCA_CONTROL_CHECK_MS;
  process.env.WORCA_CONTROL_CHECK_MS = '25';
  try {
    RunHarness.prototype._startHeartbeat.call(owner);
    enqueuePipelineCommand('ggg10002', 'stop', { by: 'bob' });
    const deadline = Date.now() + 3000;
    while (!owner.calls.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(owner.calls, [['stop', 'bob']]);
  } finally {
    RunHarness.prototype._stopHeartbeat.call(owner);
    if (prevControlCheckMs === undefined) delete process.env.WORCA_CONTROL_CHECK_MS;
    else process.env.WORCA_CONTROL_CHECK_MS = prevControlCheckMs;
  }
});

test('a test try never pauses through the mailbox: the pause is consumed as a no-op (workflow tests)', () => {
  insertPipeline({ id: 'ggg10003', title: 'Test: Bulk · try 1', status: 'running' });
  const owner = { ...fakeOwner('ggg10003'), opts: { workflowTest: true } };
  enqueuePipelineCommand('ggg10003', 'pause', { by: 'bob' });
  owner._checkControlSlot();
  assert.deepEqual(owner.calls, [], 'a paused try would be a failed try');
  assert.ok(commandsOf('ggg10003')[0].consumed_at, 'consumed, so it cannot pause it later');
  enqueuePipelineCommand('ggg10003', 'stop', { by: 'bob' });
  owner._checkControlSlot();
  assert.deepEqual(owner.calls, [['stop', 'bob']], 'a stop still stops it');
});

// ── the CLI: the live boundary, the refusals, the dispatch ───────────────────────

test('pause refuses a test try, and enqueues nothing (workflow tests)', async () => {
  insertPipeline({ id: 'ddd10009', title: 'Test: Bulk · try 1', status: 'running', ownerPid: process.pid, ownerHost: HOST, heartbeatAt: new Date().toISOString() });
  getDb().prepare('UPDATE pipelines SET is_test = 1 WHERE id = ?').run('ddd10009');
  const r = await run(['pause', 'ddd10009']);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /A test try cannot be paused: stop its test instead\./);
  assert.equal(commandsOf('ddd10009').length, 0);
});

test('stop on an already-stopped run succeeds — idempotent, for scripts', async () => {
  insertPipeline({ id: 'ddd10001', title: 'already gone', status: 'stopped' });
  const r = await run(['stop', 'ddd10001']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /already stopped/);
  assert.equal(commandsOf('ddd10001').length, 0, 'nothing is enqueued for a settled run');
});

test('pause refuses a paused run (points at resume) and both verbs refuse a done run', async () => {
  await checkRows([
    { name: 'pause refuses a paused run and points at resume', run: async () => {
      insertPipeline({ id: 'ddd10002', title: 'parked', status: 'paused' });
      const r = await run(['pause', 'ddd10002']);
      assert.equal(r.code, 1, r.stderr);
      assert.match(r.stderr, /is "paused" — pause targets a live run — resume it with: worca resume ddd10002/);
    } },
    { name: 'a done run is refused for both verbs', run: async () => {
      insertPipeline({ id: 'ddd10003', title: 'finished run', status: 'done' });
      for (const verb of ['stop', 'pause']) {
        const r = await run([verb, 'ddd10003']);
        assert.equal(r.code, 1, r.stderr);
        assert.match(r.stderr, new RegExp(`is "done" — ${verb} targets a live ${verb === 'stop' ? 'or paused ' : ''}run`));
      }
    } },
  ]);
});

test('stop a PAUSED run: settled right here (stopped, no resume point, nothing enqueued); --json reports the outcome', async () => {
  await checkRows([
    { name: 'stop a PAUSED run: settled right here — stopped, no resume point, nothing enqueued', run: async () => {
      await insertParked({ id: 'hhh10001', title: 'parked work' });
      const r = await run(['stop', 'hhh10001']);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /Stopped parked work/);
      const row = getDb().prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get('hhh10001');
      assert.equal(row.status, 'stopped');
      assert.equal(row.resume_point, null);
      assert.equal(commandsOf('hhh10001').length, 0, 'a paused run has no owner to mail');
    } },
    { name: 'stop --json on a paused run reports the outcome', run: async () => {
      await insertParked({ id: 'hhh10002', title: 'parked json' });
      const r = await run(['stop', '--json', 'hhh10002']);
      assert.equal(r.code, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.outcome, 'stop');
      assert.equal(out.status, 'stopped');
      assert.equal(out.commandId, null, 'same keys as a live stop: no command was mailed');
      assert.equal(out.consumed, null);
    } },
  ]);
});

test('stop refuses an INTERRUPTED run and points at resume — it stays resumable', async () => {
  await insertParked({ id: 'hhh10003', title: 'crashed', status: 'interrupted' });
  const r = await run(['stop', 'hhh10003']);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /is "interrupted" — stop targets a live or paused run — resume it with: worca resume hhh10003/);
  const row = getDb().prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get('hhh10003');
  assert.equal(row.status, 'interrupted');
  assert.ok(row.resume_point);
});

test('stop a PAUSED run cancels its pending "Resume at…" ticket, as the UI stop does', async () => {
  await insertParked({ id: 'hhh10004', title: 'parked with a ticket' });
  createTicket({ title: 'resume later', runAtMs: Date.now() + 3_600_000, request: {}, resumePipelineId: 'hhh10004' });
  const r = await run(['stop', 'hhh10004']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(resumeTicketsFor('hhh10004').length, 0, 'a stopped run has nothing left to resume');
});

test('two terminals stopping one PAUSED run at once: both succeed (stopping a stopped run is idempotent)', async () => {
  await insertParked({ id: 'hhh10005', title: 'parked twice' });
  const [a, b] = await Promise.all([run(['stop', 'hhh10005']), run(['stop', 'hhh10005'])]);
  assert.deepEqual([a.code, b.code], [0, 0], `${a.stderr} | ${b.stderr}`);
  assert.match(a.stdout + b.stdout, /Stopped parked twice/);
  assert.equal(getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get('hhh10005').status, 'stopped');
});

test('stop a PAUSED run whose project is not registered here: refused, with how to register it, and left paused', async () => {
  const iso = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO pipelines (id, project_key, target, title, status, phase, cycle, started_at, updated_at, resume_point)
    VALUES (?, ?, 'project', ?, 'paused', 'plan', 1, ?, ?, ?)
  `).run('hhh10006', projectKey(gitDir('cli-hhh10006')), 'unregistered', iso, iso,
    JSON.stringify(graphResumePoint({ pipelineDir: mkdtempSync(join(tmpdir(), 'cli-stop-pdir-')) })));
  const r = await run(['stop', 'hhh10006']);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /not onboarded on this machine — register it \(worca add --path <project dir>\) or run this from the project directory/);
  assert.equal(getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get('hhh10006').status, 'paused');
});

test('stop a PAUSED run: Ctrl+C is held while the stop commits the work, and released after it', async () => {
  await insertParked({ id: 'hhh10007', title: 'parked, interrupted' });
  const { cmdControl } = await import('../src/cli/control.mjs');
  const metrics = RunHarness.prototype._recordRunMetrics;
  let inStop = false;
  let release;
  const gate = new Promise((r) => { release = r; });
  // Hold the stop after its claim, before its teardown (the window a Ctrl+C must not cut short).
  RunHarness.prototype._recordRunMetrics = async function held(...a) { inStop = true; await gate; return metrics.apply(this, a); };
  const before = process.listenerCount('SIGINT');
  try {
    const out = [];
    const p = cmdControl('stop', ['hhh10007'], { out: (l) => out.push(l), c: (_k, s) => s, fail: (m) => { throw new Error(m); } });
    for (let i = 0; i < 200 && !inStop; i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(inStop, 'the stop reached its settle');
    assert.equal(process.listenerCount('SIGINT'), before + 1, 'a Ctrl+C mid-stop is held');
    release();
    assert.equal(await p, 0);
    assert.match(out.join('\n'), /Stopped parked, interrupted/);
  } finally {
    release();
    RunHarness.prototype._recordRunMetrics = metrics;
  }
  assert.equal(process.listenerCount('SIGINT'), before, 'and released once the stop is over');
  assert.equal(getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get('hhh10007').status, 'stopped');
});

test('dead owner: no command is enqueued for a run nobody can execute', async () => {
  // A pid that cannot exist on this host: kill(pid, 0) answers ESRCH -> dead.
  insertPipeline({ id: 'ddd10004', title: 'orphaned', status: 'running', ownerPid: 999_999_999, ownerHost: HOST, heartbeatAt: new Date().toISOString() });
  const r = await run(['stop', 'ddd10004']);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /no live owner process for run ddd10004/);
  assert.match(r.stderr, /worca resume ddd10004/);
  assert.equal(commandsOf('ddd10004').length, 0, 'never enqueue a command nobody will read');
});

// The usage refusals (unknown option, missing id, ambiguous prefix) are pinned in-process in
// test/cli-verbs-inproc.test.mjs; the ambiguous prefix stays here end to end.
test('an ambiguous prefix fails cleanly and help prints the usage', async () => {
  insertPipeline({ id: 'fff10001', title: 'one', status: 'running' });
  insertPipeline({ id: 'fff10002', title: 'two', status: 'running' });
  const amb = await run(['pause', 'fff1']);
  assert.equal(amb.code, 2, 'ambiguous prefix');
  assert.match(amb.stderr, /matches 2 runs/);
  const help = await run(['stop', 'help']);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /worca stop \| worca pause — control a run from the terminal/);
});

// ── the transport: owner claims and executes, the CLI reports from the ROW ───────

/**
 * A simulated owner: the harness's exact contract in miniature — poll the
 * control slot, claim one command, apply it to the run's ROW, exit. (A real
 * mock pipeline finishes too fast to race a stop deterministically; this pins
 * the transport. The harness hook itself is exercised by the live smoke.)
 */
const OWNER_SCRIPT = `
  const { claimPipelineCommand } = await import(${JSON.stringify(resolve(SRC, 'core', 'pipeline-commands.mjs'))});
  const { getDb } = await import(${JSON.stringify(resolve(SRC, 'core', 'db.mjs'))});
  const deadline = Date.now() + 15000;
  for (;;) {
    const cmd = claimPipelineCommand(process.env.OWNER_PIPELINE);
    if (cmd) {
      // OWNER_SET: 'none' = a no-op consumption (the moment passed), any other value
      // = the status the run settles in instead; default = the command's own effect.
      const set = process.env.OWNER_SET || (cmd.action === 'stop' ? 'stopped' : 'paused');
      if (set !== 'none') getDb().prepare('UPDATE pipelines SET status = ? WHERE id = ?').run(set, process.env.OWNER_PIPELINE);
      process.exit(0);
    }
    if (Date.now() > deadline) process.exit(1);
    await new Promise((r) => setTimeout(r, 50));
  }
`;

function spawnOwner(pipelineId, ownerSet = '') {
  return spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', OWNER_SCRIPT], {
    env: { ...process.env, WORCA_HOME: home, HOME: home, USERPROFILE: home, OWNER_PIPELINE: pipelineId, OWNER_SET: ownerSet },
    stdio: 'ignore',
  });
}

test('stop a LIVE run: enqueue -> owner claims and executes -> the CLI reports from the row', { timeout: 30000 }, async () => {
  insertPipeline({ id: 'eee10001', title: 'live run to stop', status: 'running', ownerPid: process.pid, ownerHost: HOST, heartbeatAt: new Date().toISOString() });
  const owner = spawnOwner('eee10001');
  try {
    const r = await run(['stop', 'eee10001']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Stopped .*live run to stop/);
    assert.equal(getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get('eee10001').status, 'stopped');
    const cmds = commandsOf('eee10001');
    assert.equal(cmds.length, 1);
    assert.ok(cmds[0].consumed_at, 'the owner consumed the command');
    assert.match(cmds[0].consumed_by, /^\d+@/, 'claimed with the pid@host stamp');
  } finally { owner.kill(); }
});

test('pause a LIVE run end-to-end, with the resume pointer in the success line', { timeout: 30000 }, async () => {
  insertPipeline({ id: 'eee10002', title: 'live run to pause', status: 'running', ownerPid: process.pid, ownerHost: HOST, heartbeatAt: new Date().toISOString() });
  const owner = spawnOwner('eee10002');
  try {
    const r = await run(['pause', 'eee10002']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Paused .*live run to pause/);
    assert.match(r.stdout, /worca resume eee10002/);
    assert.equal(getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get('eee10002').status, 'paused');
  } finally { owner.kill(); }
});

test('an unconfirmed command gets the honest enqueued line, exit 0', async () => {
  insertPipeline({ id: 'eee10003', title: 'nobody answers', status: 'running', ownerPid: process.pid, ownerHost: HOST, heartbeatAt: new Date().toISOString() });
  const r = await run(['stop', 'eee10003'], { WORCA_CONTROL_CONFIRM_MS: '700' });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /enqueued — the run has not picked it up yet/);
  assert.equal(commandsOf('eee10003').length, 1, 'the command stays for the owner');
});

test('a command the owner consumed as a no-op reports "received", not "enqueued"', { timeout: 30000 }, async () => {
  insertPipeline({ id: 'eee10004', title: 'moment passed', status: 'running', ownerPid: process.pid, ownerHost: HOST, heartbeatAt: new Date().toISOString() });
  const owner = spawnOwner('eee10004', 'none');
  try {
    const r = await run(['pause', '--json', 'eee10004'], { WORCA_CONTROL_CONFIRM_MS: '2000' });
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.outcome, 'received');
    assert.equal(j.consumed, true);
    assert.equal(j.status, 'running');
  } finally { owner.kill(); }
});

test('a run that settles in another status ends the wait early: "did not apply", exit 1', { timeout: 30000 }, async () => {
  insertPipeline({ id: 'eee10005', title: 'stopped meanwhile', status: 'running', ownerPid: process.pid, ownerHost: HOST, heartbeatAt: new Date().toISOString() });
  const owner = spawnOwner('eee10005', 'stopped');
  try {
    const t0 = Date.now();
    const r = await run(['pause', 'eee10005']);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stderr, /the pause did not apply: run eee10005 is now "stopped"/);
    assert.ok(Date.now() - t0 < 8000, 'no full 10s wait once the run settled');
  } finally { owner.kill(); }
});
