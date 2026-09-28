// test/cli-runs.test.mjs — `worca runs`: the list across projects, the detail
// view by id/prefix, --json, and the dispatch contract (unknown input never
// silently falls through to a full list — issue #481).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');
const home = useTempHome(after);

function run(args) {
  return new Promise((res) => {
    // HOME too: settings.json resolves under HOME, not WORCA_HOME.
    const env = { ...process.env, WORCA_HOME: home, HOME: home, USERPROFILE: home };
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}

/** Seed one pipelines row. Columns mirror what listAllPipelines/detail read. */
function insertPipeline({ id, projectKey, title, status, phase = 'plan', minutesAgo, costUsd = 0, activeMs = 0, branch = null, resumePoint = null, prompt = null, startedBy = null }) {
  const iso = (ms) => new Date(ms).toISOString();
  const t = Date.now() - minutesAgo * 60_000;
  getDb().prepare(`
    INSERT INTO pipelines (id, project_key, target, title, status, phase, cycle, started_at, updated_at,
                           total_cost_usd, total_active_ms, started_by, prompt, branch, resume_point)
    VALUES (?, ?, 'project', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectKey, title, status, phase, iso(t), iso(t + 30_000), costUsd, activeMs, startedBy, prompt, branch, resumePoint);
}

/** A run dir + persisted results.json (the readPipelineByKey read path). */
function seedResults(projectKey, id, summary) {
  const dir = join(home, '.worca-cc', 'store', projectKey, 'pipelines', `24-09-26-test-${id}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ summary }));
}

/** A v2 stepper + n executed steps (executionCount's read path); optionally one
 *  loop wire with `loop` deliveries recorded in the outcome JSON (loopDeliveries' read path). */
function seedExecutions(id, n, { loopWires = 0, loopDeliveries: deliveries = 0 } = {}) {
  const wires = [];
  for (let i = 0; i < loopWires; i++) wires.push({ id: `w-loop-${i}`, loop: true });
  getDb().prepare('UPDATE pipelines SET stepper = ?, outcome = ? WHERE id = ?')
    .run(
      JSON.stringify({ version: 2, graph: { nodes: [], wires } }),
      JSON.stringify({ endReached: false, wireDeliveries: Object.fromEntries(wires.map((w) => [w.id, deliveries])) }),
      id,
    );
  for (let i = 0; i < n; i++) {
    getDb().prepare("INSERT INTO pipeline_steps (pipeline_id, key, node_id, status, execution_id) VALUES (?, ?, 'impl', 'done', ?)")
      .run(id, `${i}:impl`, `x:impl:${i + 1}`);
  }
}

test('empty store: a friendly line, exit 0', async () => {
  const r = await run(['runs']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /No pipeline runs yet/);
});

test('list across projects, newest first, plain (non-TTY) output', async () => {
  insertPipeline({ id: 'aaa10001', projectKey: 'proj-a', title: 'older done run', status: 'done', minutesAgo: 120, costUsd: 1.5, activeMs: 63_000, branch: JSON.stringify({ source: 'dev', feature: 'worca-cc/older-aaa10001' }) });
  insertPipeline({ id: 'aaa10002', projectKey: 'proj-a', title: 'paused run\nsecond line', status: 'paused', minutesAgo: 30, resumePoint: JSON.stringify({ pauseReason: 'error', pauseDetail: 'sourceBranch is not a valid ref: "main"' }) });
  insertPipeline({ id: 'bbb20001', projectKey: 'proj-b', title: 'running run', status: 'running', minutesAgo: 5, startedBy: 'alice' });
  const r = await run(['runs']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /ID\s+STATUS\s+STARTED\s+PROJECT\s+TITLE/, 'a header row leads the table');
  const ids = r.stdout.split('\n').filter((l) => /^\s{2}[0-9a-f]{8} {2}/.test(l)).map((l) => l.trim().slice(0, 8));
  assert.deepEqual(ids, ['bbb20001', 'aaa10002', 'aaa10001'], 'newest first');
  assert.match(r.stdout, /bbb20001\s+running/);
  assert.match(r.stdout, /aaa10002\s+paused \(error\)/, 'the pause reason reads with the status');
  assert.doesNotMatch(r.stdout, /\x1b\[/, 'non-TTY output carries no ANSI escapes');
});

test('--status filters on the stored status vocabulary', async () => {
  const r = await run(['runs', '--status', 'paused']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /aaa10002/);
  assert.doesNotMatch(r.stdout, /aaa10001/);
  assert.doesNotMatch(r.stdout, /bbb20001/);
  const bad = await run(['runs', '--status', 'failed']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--status must be one of/);
  const bare = await run(['runs', '--status']);
  assert.equal(bare.code, 2);
  assert.match(bare.stderr, /--status needs a value/);
});

test('--project filters by name or key', async () => {
  const r = await run(['runs', '--project', 'proj-b']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /bbb20001/);
  assert.doesNotMatch(r.stdout, /aaa10001/);
  const none = await run(['runs', '--project', 'no-such-project']);
  assert.equal(none.code, 0);
  assert.match(none.stdout, /No runs match the given filters/);
});

test('--json list: the wire entries, parseable', async () => {
  const r = await run(['runs', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const runs = JSON.parse(r.stdout);
  assert.equal(runs.length, 3);
  const paused = runs.find((x) => x.id === 'aaa10002');
  assert.equal(paused.status, 'paused');
  assert.equal(paused.pauseReason, 'error');
  assert.equal(paused.pauseDetail, 'sourceBranch is not a valid ref: "main"');
  assert.equal(paused.projectKey, 'proj-a');
  assert.equal(paused.totalCostUsd, null, 'no cost recorded reads as null, the wire convention');
});

test('detail by full id and by unique prefix', async () => {
  seedResults('proj-a', 'aaa10001', { linesAdded: 8, linesRemoved: 0 });
  seedExecutions('aaa10001', 1, { loopWires: 1, loopDeliveries: 2 });
  let r = await run(['runs', 'aaa10001']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /older done run/);
  assert.match(r.stdout, /status\s+done/);
  assert.match(r.stdout, /branch\s+dev → worca-cc\/older-aaa10001/, 'source → feature, the web UI order');
  assert.match(r.stdout, /changes\s+\+8 -0/, 'the persisted diff summary reads from results.json');
  assert.match(r.stdout, /duration\s+1m03s · 1 execution · 2 loop deliveries/, "the web UI's DURATION sub-line counts");
  assert.match(r.stdout, /started\s+\d+[hd] ago \(\w{3} \w{3} \d+, \d{2}:\d{2}\)/, 'relative age with the absolute stamp in parens');
  assert.match(r.stdout, /cost\s+\$1\.50 · across 1 step/, "the web UI's COST sub-line wording");
  assert.doesNotMatch(r.stdout, /by\s+/, 'no person line when nobody started it');
  r = await run(['runs', 'bbb2']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /running run/);
  assert.match(r.stdout, /by\s+alice/, "a real person's name shows; 'local' never would");
  assert.doesNotMatch(r.stdout, /execution/, 'no executions claimed without a v2 stepper');
  r = await run(['runs', 'show', 'bbb2', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.equal(d.id, 'bbb20001');
  assert.equal(d.status, 'running');
  assert.equal(d.project.key, 'proj-b');
  assert.equal(d.featureBranch, null);
  assert.equal(d.startedBy, 'alice');
  assert.equal(d.executions, null);
  assert.equal(d.loopDeliveries, null);
});

test('ambiguous prefix refuses and names the matches count', async () => {
  const r = await run(['runs', 'aaa1']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /matches 2 runs — use a longer id/);
});

test('unknown verb/id: one combined error, never a silent list', async () => {
  const r = await run(['runs', 'lst']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no run matches "lst", and "lst" is not a known verb either/);
  assert.doesNotMatch(r.stdout, /bbb20001/, 'the list must not print as a side effect');
  // ...but through `show` the message stays about the run only.
  const s = await run(['runs', 'show', 'zzzz9999']);
  assert.equal(s.code, 2);
  assert.match(s.stderr, /no run matches "zzzz9999"/);
  assert.doesNotMatch(s.stderr, /not a known verb/);
});

test('unknown options fail with usage', async () => {
  const r = await run(['runs', '--watch']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown option/);
});

test('help prints the group usage', async () => {
  for (const args of [['runs', 'help'], ['runs', '-h']]) {
    const r = await run(args);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /worca runs — list and inspect pipeline runs/);
  }
});
