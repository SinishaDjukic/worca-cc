// test/cli-logs.test.mjs — `worca logs` (issue #531): the terminal read-side of
// a run's live log. The CLI reads the run's NDJSON file directly — no Worca
// server — covering the pretty tail (the same `[source] text` language the
// foreground run prints), --tail/--component/--level filters, --json verbatim
// lines, the no-log-yet honesty, and the follow loop: poll-and-append at the
// writer's cadence, Ctrl-C detaches (exit 0, run untouched), a settled run ends
// the follow on its own.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectStorePath } from '../src/core/store.mjs';
import { RUN_LOG_FILE } from '../src/core/run-log.mjs';
import { checkRows } from './helpers/rows.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');
const home = useTempHome(after);

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

/** Seed one pipelines row (columns mirror what the runs/detail readers SELECT). */
function insertPipeline({ id, projectKey, title, status, minutesAgo = 5 }) {
  const iso = (ms) => new Date(ms).toISOString();
  const t = Date.now() - minutesAgo * 60_000;
  getDb().prepare(`
    INSERT INTO pipelines (id, project_key, target, title, status, phase, cycle, started_at, updated_at)
    VALUES (?, ?, 'project', ?, ?, 'plan', 1, ?, ?)
  `).run(id, projectKey, title, status, iso(t), iso(t + 30_000));
}

/** Seed a run + its run-dir log file; returns the run dir (basename ends -<id>).
 *  `lines` are already-encoded NDJSON strings (one record each). */
function seedLog(id, lines, { projectKey = 'proj-a', status = 'running' } = {}) {
  insertPipeline({ id, projectKey, title: 'log demo', status });
  const dir = join(projectStorePath(projectKey), 'pipelines', `run-${id}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, RUN_LOG_FILE), lines.join('\n') + '\n');
  return dir;
}

const line = (source, level, text) => JSON.stringify({ source, level, text, ts: '2026-09-30T10:00:00.000Z' });

const FIVE = [
  line('orchestrator', 'info', 'run started'),
  line('orchestrator', 'info', 'phase plan entered'),
  line('claude', 'warn', 'context window at 80%'),
  line('claude', 'error', 'execution failed: timeout'),
  line('orchestrator', 'info', 'retrying execution'),
];

// ── the dispatch contract ────────────────────────────────────────────────────────

// The usage refusals (missing id, unknown option, two ids, unknown id, ambiguous prefix) are
// pinned in-process in test/cli-verbs-inproc.test.mjs; one of them stays here end to end.
test('help prints the logs usage; a bad flag fails with exit 2 and its message', async () => {
  const help = await run(['logs', 'help']);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /worca logs — read a run's live log/);
  const bad = await run(['logs', '--level', 'verbose', 'aaaaaaaa']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--level must be one of debug, info, warn, error/);
});

// ── the pretty tail ──────────────────────────────────────────────────────────────

test('pretty mode renders [source] text level-colored; --tail cuts from the END of the log', async () => {
  seedLog('22220001', FIVE);
  await checkRows([
    { name: 'pretty mode renders the records the foreground run prints: [source] text, level-colored', run: async () => {
      const r = await run(['logs', '22220001']);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /info\s+\[orchestrator\] run started/, 'timestamp, level, [source], text — the conventional log order');
      assert.match(r.stdout, /warn\s+\[claude\] context window at 80%/);
      assert.match(r.stdout, /error\s+\[claude\] execution failed: timeout/);
      assert.match(r.stdout, / \d{2}:\d{2}:\d{2} (info|warn|error) /, 'the dim clock leads the line');
      assert.doesNotMatch(r.stdout, /"source"/, 'raw JSON does not leak into pretty mode');
    } },
    { name: '--tail cuts from the END of the log, not the beginning', run: async () => {
      const r = await run(['logs', '22220001', '--tail', '2']);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /retrying execution/);
      assert.match(r.stdout, /execution failed: timeout/);
      assert.doesNotMatch(r.stdout, /run started/, 'older lines are gone');
    } },
  ]);
});

test('--component / --level THRESHOLD filters, unparseable lines survive, --json is verbatim (and --component= parses)', async () => {
  await checkRows([
    { name: '--component filters; --level is a THRESHOLD (warn shows warn and error); unparseable lines survive unfiltered views', run: async () => {
      // 'artifact' is a real level the writer emits (provenance records) that sits
      // outside the severity ladder; a record with no level counts as 'info'.
      seedLog('22220003', [...FIVE, line('artifact', 'artifact', 'wrote review.md'), '{"source":"x","text":"no level here"}', '{not json']);
      const comp = await run(['logs', '22220003', '--component', 'claude']);
      assert.match(comp.stdout, /context window at 80%/);
      assert.doesNotMatch(comp.stdout, /run started/);
      const warn = await run(['logs', '22220003', '--level', 'warn']);
      assert.match(warn.stdout, /context window at 80%/, 'warn itself is shown');
      assert.match(warn.stdout, /execution failed: timeout/, 'error is above the threshold');
      assert.doesNotMatch(warn.stdout, /run started/, 'info is below it');
      const all = await run(['logs', '22220003', '--level', 'debug']);
      assert.match(all.stdout, /run started/, 'debug is the floor: everything on the ladder shows');
      const both = await run(['logs', '22220003', '--component', 'claude', '--level', 'error']);
      assert.match(both.stdout, /execution failed: timeout/);
      assert.doesNotMatch(both.stdout, /context window at 80%/);
      const zero = await run(['logs', '22220003', '--component', 'orchestrator', '--level', 'error']);
      assert.match(zero.stdout, /No log lines match the given filters/);
      const noLevel = await run(['logs', '22220003', '--level', 'info']);
      assert.match(noLevel.stdout, /no level here/, 'a record with no level counts as info (the UI rule)');
      assert.doesNotMatch(noLevel.stdout, /wrote review\.md/, 'ladder-out levels only appear unfiltered');
      const raw = await run(['logs', '22220003', '--tail', '1']);
      assert.match(raw.stdout, /\{not json/, 'an unparseable line renders raw, it is not hidden');
    } },
    { name: '--json emits the NDJSON lines verbatim (and --component= inline form parses)', run: async () => {
      seedLog('22220004', FIVE);
      const r = await run(['logs', '22220004', '--json']);
      assert.equal(r.code, 0, r.stderr);
      const lines = r.stdout.trim().split('\n');
      assert.equal(lines.length, FIVE.length);
      assert.deepEqual(JSON.parse(lines[0]), { source: 'orchestrator', level: 'info', text: 'run started', ts: '2026-09-30T10:00:00.000Z' });
      const inline = await run(['logs', '22220004', '--json', '--component=claude']);
      assert.equal(inline.stdout.trim().split('\n').length, 2);
    } },
  ]);
});

test('a run with no log file yet says so honestly and exits 0; a unique prefix resolves', async () => {
  insertPipeline({ id: '55550001', projectKey: 'proj-a', title: 'not started', status: 'created' });
  const r = await run(['logs', '55550001']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /No log yet for run 55550001/);
  const prefixed = await run(['logs', '5555']);
  assert.equal(prefixed.code, 0, prefixed.stderr); // the only 5555* run is the one above
  assert.match(prefixed.stdout, /No log yet for run 55550001/);
});

// ── the follow loop ──────────────────────────────────────────────────────────────

function spawnFollow(args, extraEnv = {}) {
  const env = { ...process.env, WORCA_HOME: home, HOME: home, USERPROFILE: home, WORCA_LOGS_FOLLOW_MS: '150', ...extraEnv };
  return spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
}
const collect = (child) => new Promise((res) => {
  let text = '';
  child.stdout.on('data', (b) => (text += b.toString()));
  child.stderr.on('data', (b) => (text += b.toString()));
  child.on('exit', (code) => res({ code: code ?? 0, text }));
});
/** Resolve once the child has printed a line matching `re` (a fixed sleep races a slow CI runner's startup). */
const printed = (child, re) => new Promise((res) => {
  let text = '';
  const on = (b) => { text += b.toString(); if (re.test(text)) res(); };
  child.stdout.on('data', on); child.stderr.on('data', on);
});

test('follow appends new lines as they land; Ctrl-C detaches with exit 0, the run untouched', { timeout: 15000 }, async () => {
  const id = '33330001';
  const dir = seedLog(id, [line('orchestrator', 'info', 'first line')]);
  const child = spawnFollow(['logs', id, '-f', '--json']);
  const done = collect(child);
  await new Promise((r) => setTimeout(r, 400)); // past the first tick
  appendFileSync(join(dir, RUN_LOG_FILE), line('orchestrator', 'info', 'second line') + '\n' + line('claude', 'warn', 'third line') + '\n');
  await new Promise((r) => setTimeout(r, 700)); // a couple of ticks
  child.kill('SIGINT');
  const { code, text } = await done;
  assert.equal(code, 0, text);
  assert.match(text, /first line/);
  assert.match(text, /second line/, 'appended lines arrive while following');
  assert.match(text, /detached — the run keeps going/);
  assert.equal(getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(id).status, 'running', 'the run was never touched');
});

test('a settled run (done or error) ends the follow on its own, with the terminal status line', { timeout: 15000 }, async () => {
  await checkRows([
    { name: 'a settled run ends the follow on its own, with the terminal status line', run: async () => {
      seedLog('33330002', [line('orchestrator', 'info', 'done line')], { status: 'done' });
      const child = spawnFollow(['logs', '33330002', '-f', '--json']);
      const { code, text } = await collect(child);
      assert.equal(code, 0, text);
      assert.match(text, /done line/);
      assert.match(text, /run 33330002 done\./);
    } },
    { name: 'follow on a run that ended in error ends on its own', run: async () => {
      seedLog('33330006', [line('orchestrator', 'error', 'boom')], { status: 'error' });
      const { code, text } = await collect(spawnFollow(['logs', '33330006', '-f', '--json']));
      assert.equal(code, 0, text);
      assert.match(text, /run 33330006 error\./);
    } },
  ]);
});

test('follow picks up a truncation (the log resets) without dying', { timeout: 15000 }, async () => {
  const id = '33330003';
  const dir = seedLog(id, [line('orchestrator', 'info', 'old era')]);
  const child = spawnFollow(['logs', id, '-f', '--json']);
  const done = collect(child);
  await new Promise((r) => setTimeout(r, 400));
  // A real truncation SHRINKS the file (restart wipes to empty, cleanup
  // deletes) — the detector is size-shrink based, so the replacement is shorter.
  writeFileSync(join(dir, RUN_LOG_FILE), '{"text":"new era"}\n');
  await new Promise((r) => setTimeout(r, 700));
  child.kill('SIGINT');
  const { code, text } = await done;
  assert.equal(code, 0, text);
  assert.match(text, /new era/, 'post-truncation lines are picked up from offset 0');
});

test('follow on a run with no log file yet waits for it instead of crashing', { timeout: 15000 }, async () => {
  const id = '33330004';
  insertPipeline({ id, projectKey: 'proj-a', title: 'not started', status: 'running' });
  const child = spawnFollow(['logs', id, '-f', '--json']);
  const done = collect(child);
  // The file must appear only after the CLI said it is waiting for it.
  await printed(child, /No log yet for run 33330004 — waiting/);
  const dir = join(projectStorePath('proj-a'), 'pipelines', `run-${id}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, RUN_LOG_FILE), line('orchestrator', 'info', 'first ever line') + '\n');
  await new Promise((r) => setTimeout(r, 700));
  child.kill('SIGINT');
  const { code, text } = await done;
  assert.equal(code, 0, text);
  assert.match(text, /No log yet for run 33330004 — waiting/);
  assert.match(text, /first ever line/, 'the file appearing mid-follow is picked up from offset 0');
});

test('follow applies --level and --component to appended lines too', { timeout: 15000 }, async () => {
  const id = '33330005';
  const dir = seedLog(id, [line('claude', 'error', 'seed error')]);
  const child = spawnFollow(['logs', id, '-f', '--json', '--level', 'warn', '--component', 'claude']);
  const done = collect(child);
  await new Promise((r) => setTimeout(r, 400));
  appendFileSync(join(dir, RUN_LOG_FILE), [
    line('claude', 'info', 'below the threshold'),
    line('orchestrator', 'error', 'other component'),
    line('claude', 'warn', 'kept warn'),
  ].join('\n') + '\n');
  await new Promise((r) => setTimeout(r, 700));
  child.kill('SIGINT');
  const { code, text } = await done;
  assert.equal(code, 0, text);
  assert.match(text, /seed error/);
  assert.match(text, /kept warn/);
  assert.doesNotMatch(text, /below the threshold/);
  assert.doesNotMatch(text, /other component/);
});

test('follow never splits a record that is mid-append when read', { timeout: 15000 }, async () => {
  const id = '33330007';
  const dir = seedLog(id, [line('orchestrator', 'info', 'whole')]);
  const file = join(dir, RUN_LOG_FILE);
  const rec = line('claude', 'info', 'split across two flushes ✓');
  const cut = Buffer.from(rec).length - 3; // inside the multi-byte ✓
  appendFileSync(file, Buffer.from(rec).subarray(0, cut)); // a partial record before following starts
  const child = spawnFollow(['logs', id, '-f', '--json']);
  const done = collect(child);
  await new Promise((r) => setTimeout(r, 400));
  appendFileSync(file, Buffer.concat([Buffer.from(rec).subarray(cut), Buffer.from('\n')]));
  await new Promise((r) => setTimeout(r, 700));
  child.kill('SIGINT');
  const { code, text } = await done;
  assert.equal(code, 0, text);
  const recs = text.split('\n').filter((l) => l.startsWith('{'));
  assert.deepEqual(recs, [line('orchestrator', 'info', 'whole'), rec], 'each record printed once, whole');
});
