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
import { checkRows } from './helpers/rows.mjs';

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

test('list across projects newest first (plain, non-TTY) and as --json wire entries', async () => {
  await checkRows([
    { name: 'list across projects, newest first, plain (non-TTY) output', run: async () => {
      insertPipeline({ id: 'aaa10001', projectKey: 'proj-a', title: 'older done run', status: 'done', minutesAgo: 120, costUsd: 1.5, activeMs: 63_000, branch: JSON.stringify({ source: 'dev', feature: 'worca-cc/older-aaa10001' }) });
      insertPipeline({ id: 'aaa10002', projectKey: 'proj-a', title: 'paused run\nsecond line', status: 'paused', minutesAgo: 30, resumePoint: JSON.stringify({ pauseReason: 'error', pauseDetail: 'sourceBranch is not a valid ref: "main"' }) });
      insertPipeline({ id: 'bbb20001', projectKey: 'proj-b', title: 'running run', status: 'running', minutesAgo: 5, startedBy: 'alice' });
      const r = await run(['runs']);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /ID\s+STATUS\s+ENGINE\s+STARTED\s+PROJECT\s+TITLE/, 'a header row leads the table');
      const ids = r.stdout.split('\n').filter((l) => /^\s{2}[0-9a-f]{8} {2}/.test(l)).map((l) => l.trim().slice(0, 8));
      assert.deepEqual(ids, ['bbb20001', 'aaa10002', 'aaa10001'], 'newest first');
      assert.match(r.stdout, /bbb20001\s+running/);
      assert.match(r.stdout, /aaa10002\s+paused \(error\)/, 'the pause reason reads with the status');
      assert.doesNotMatch(r.stdout, /\x1b\[/, 'non-TTY output carries no ANSI escapes');
    } },
    { name: '--json list: the wire entries, parseable', run: async () => {
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
    } },
  ]);
});

test('--status and --project filter the list; bad/missing --status values exit 2', async () => {
  await checkRows([
    { name: '--status filters on the stored status vocabulary', run: async () => {
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
    } },
    { name: '--project filters by name or key', run: async () => {
      const r = await run(['runs', '--project', 'proj-b']);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /bbb20001/);
      assert.doesNotMatch(r.stdout, /aaa10001/);
      const none = await run(['runs', '--project', 'no-such-project']);
      assert.equal(none.code, 0);
      assert.match(none.stdout, /No runs match the given filters/);
    } },
  ]);
});

test('--tag filters the list (repeatable, ANDed; a key alone matches any value); a bare --tag exits 2 (#718)', async () => {
  insertPipeline({ id: 'eee50001', projectKey: 'proj-e-55555555', title: 'Tagged', status: 'done', minutesAgo: 3 });
  insertPipeline({ id: 'eee50002', projectKey: 'proj-e-55555555', title: 'Untagged', status: 'done', minutesAgo: 4 });
  getDb().prepare("INSERT INTO run_tags (pipeline_id, key, value) VALUES ('eee50001', 'client', 'acme'), ('eee50001', 'spike', '')").run();
  await checkRows([
    { name: 'exact key:value, as --json', run: async () => {
      const r = await run(['runs', '--tag', 'Client:Acme', '--json']);
      assert.equal(r.code, 0, r.stderr);
      const runs = JSON.parse(r.stdout);
      assert.deepEqual(runs.map((x) => x.id), ['eee50001']);
      assert.deepEqual(runs[0].tags, ['client:acme', 'spike']);
    } },
    { name: 'a key alone, and two ANDed terms (--tag=…)', run: async () => {
      const r = await run(['runs', '--tag', 'client', '--tag=spike', '--json']);
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout).map((x) => x.id), ['eee50001']);
    } },
    { name: 'the detail --json carries tags too ([] when untagged)', run: async () => {
      const r = await run(['runs', 'eee50001', '--json']);
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout).tags, ['client:acme', 'spike']);
      const u = await run(['runs', 'eee50002', '--json']);
      assert.deepEqual(JSON.parse(u.stdout).tags, []);
    } },
    { name: 'no match', run: async () => {
      const r = await run(['runs', '--tag', 'client:globex']);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /No runs match/);
    } },
    { name: 'bare --tag and an invalid tag exit 2', run: async () => {
      const bare = await run(['runs', '--tag']);
      assert.equal(bare.code, 2);
      assert.match(bare.stderr, /--tag needs a value/);
      const bad = await run(['runs', '--tag', 'client:']);
      assert.equal(bad.code, 2);
      assert.match(bad.stderr, /--tag: "client:" needs a value/);
    } },
  ]);
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

test('refusals: ambiguous prefix (match count), unknown verb/id (one combined error, never a silent list), unknown option — all exit 2', async () => {
  await checkRows([
    { name: 'ambiguous prefix refuses and names the matches count', run: async () => {
      const r = await run(['runs', 'aaa1']);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /matches 2 runs — use a longer id/);
    } },
    { name: 'unknown verb/id: one combined error, never a silent list', run: async () => {
      const r = await run(['runs', 'lst']);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /no run matches "lst", and "lst" is not a known verb either/);
      assert.doesNotMatch(r.stdout, /bbb20001/, 'the list must not print as a side effect');
      // ...but through `show` the message stays about the run only.
      const s = await run(['runs', 'show', 'zzzz9999']);
      assert.equal(s.code, 2);
      assert.match(s.stderr, /no run matches "zzzz9999"/);
      assert.doesNotMatch(s.stderr, /not a known verb/);
    } },
    { name: 'unknown options fail with usage', run: async () => {
      const r = await run(['runs', '--watch']);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /unknown option/);
    } },
  ]);
});

test('a Cursor run: the detail reads "cost unknown", never $0.00, and the list entry names its engine', async () => {
  insertPipeline({ id: 'ccc30001', projectKey: 'proj-c', title: 'cursor run', status: 'done', minutesAgo: 1, costUsd: 0.3,
    resumePoint: JSON.stringify({ claude: { engine: 'cursor' } }) });
  const r = await run(['runs', 'ccc30001']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /cost\s+cost unknown \(worca's own calls: \$0\.30\)/);
  const list = JSON.parse((await run(['runs', '--json'])).stdout);
  assert.equal(list.find((x) => x.id === 'ccc30001').runEngine, 'cursor');
  assert.equal(list.find((x) => x.id !== 'ccc30001').runEngine, 'claude', 'a run with no engine recorded is Claude');
  assert.match(r.stdout, /engine\s+Cursor/);
  assert.match((await run(['runs'])).stdout, /ccc30001\s+done\s+Cursor\s/, 'the list names the engine');
});

test('a step whose cost could not be counted: the detail reads "≥ $x (part unknown)"', async () => {
  insertPipeline({ id: 'hhh70001', projectKey: 'proj-h', title: 'unpriced run', status: 'done', minutesAgo: 1, costUsd: 1.5 });
  getDb().prepare("INSERT INTO pipeline_steps (pipeline_id, key, node_id, status, cost_known) VALUES (?, 'x:impl:1', 'impl', 'done', 0)").run('hhh70001');
  const r = await run(['runs', 'hhh70001']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /cost\s+≥ \$1\.50 \(part unknown\)/);
});

test('a paused run: the detail says how to resume; after a usage limit its engine hit, on each other engine too', async () => {
  insertPipeline({ id: 'ddd40001', projectKey: 'proj-d', title: 'limited run', status: 'paused', minutesAgo: 1,
    resumePoint: JSON.stringify({ claude: { engine: 'codex' }, pauseReason: 'usage_limit', pauseDetail: 'try again at 3pm', limitEngine: 'codex' }) });
  insertPipeline({ id: 'ddd40002', projectKey: 'proj-d', title: 'error run', status: 'paused', minutesAgo: 1,
    resumePoint: JSON.stringify({ pauseReason: 'error', pauseDetail: 'disk full' }) });
  const r = await run(['runs', 'ddd40001']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Resume with: worca resume ddd40001\n/);
  assert.match(r.stdout, /Or continue now on Claude: worca resume ddd40001 --engine claude/);
  assert.match(r.stdout, /Or continue now on Cursor: worca resume ddd40001 --engine cursor/);
  const d = JSON.parse((await run(['runs', 'ddd40001', '--json'])).stdout);
  assert.deepEqual([d.engine, d.limitEngine], ['codex', 'codex']);
  const e = await run(['runs', 'ddd40002']);
  assert.match(e.stdout, /Resume with: worca resume ddd40002/);
  assert.doesNotMatch(e.stdout, /continue now/, 'another pause offers no switch');
  assert.doesNotMatch((await run(['runs', 'aaa10001'])).stdout, /Resume with/, 'a finished run has nothing to resume');
});

test('the detail prints the run model status line as `state`, and --json carries it as statusLine (§5a.7)', async () => {
  insertPipeline({ id: 'ggg60001', projectKey: 'proj-g', title: 'paused at build', status: 'paused', minutesAgo: 1 });
  getDb().prepare("INSERT INTO pipeline_steps (pipeline_id, key, node_id, status, execution_id) VALUES (?, '0:impl', 'impl', 'paused', 'x:impl:1')")
    .run('ggg60001');
  getDb().prepare('UPDATE pipelines SET stepper = ? WHERE id = ?').run(JSON.stringify({ version: 2,
    graph: { nodes: [{ id: 'impl', kind: 'agent', key: 'implementer', label: 'Implementation', progressStage: 'build' }], wires: [] } }), 'ggg60001');
  const r = await run(['runs', 'ggg60001']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^\s+state\s+Build · paused$/m);
  assert.equal(JSON.parse((await run(['runs', 'ggg60001', '--json'])).stdout).statusLine, 'Build · paused');
});

test('--json carries shapeStats for a shaped run (Shaper D28) and no shapeStats key otherwise', async () => {
  const STATS = { questions: { asked: 2, skipped: 1 }, revises: [{ round: 1, by: 'person' }], shapeScore: 0.875,
    reviewCycles: 2, checklist: null, cost: { shaping: 12.5, building: 30 } };
  insertPipeline({ id: 'fff50001', projectKey: 'proj-f', title: 'shaped run', status: 'done', minutesAgo: 1 });
  insertPipeline({ id: 'fff50002', projectKey: 'proj-f', title: 'plain run', status: 'done', minutesAgo: 1 });
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify(STATS), 'fff50001');
  const shaped = JSON.parse((await run(['runs', 'show', 'fff50001', '--json'])).stdout);
  assert.deepEqual(shaped.shapeStats, STATS);
  const plain = JSON.parse((await run(['runs', 'show', 'fff50002', '--json'])).stdout);
  assert.equal('shapeStats' in plain, false);
});
