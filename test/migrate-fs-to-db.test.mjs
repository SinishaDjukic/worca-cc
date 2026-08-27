// test/migrate-fs-to-db.test.mjs
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DatabaseSync } from 'node:sqlite';
import { getDb, _resetForTests, migrate, dbPath } from '../src/core/db.mjs';
import { maybeMigrateFromFs } from '../src/core/migrate-fs-to-db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };

// Each test gets its own WORCA_HOME so the singleton DB + legacy tree are fully
// isolated. _resetForTests() drops the cached handle so the next getDb() reopens
// against the new home (mirrors db.test.mjs / the temp-home discipline).
const homes = [];
function freshHome() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-fsmig-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  return dir;
}

beforeEach(() => { freshHome(); });

after(() => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  // Teardown hygiene never fails the file: Windows EPERMs while a just-closed handle lingers.
  for (const d of homes) { try { rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* best effort */ } }
});

// ── fixture builder ────────────────────────────────────────────────────────────
// Writes a realistic legacy JSON+markdown tree under the CURRENT WORCA_HOME.
// Returns the key info the assertions need (project keys, the home path). The
// shapes are copied verbatim from the live store (see Phase 4 §2).
//
// A12 (DATA-DESTRUCTION GUARD): the two registered projects are THROWAWAY
// git-initialized temp dirs (tempGitRepo), NEVER process.cwd(). This is required
// because the per-project config import writes <projA>/.worca-cc/config.json and a
// later task archives→removes it; pointing projA at the real repo would delete the
// developer's actual <repo>/.worca-cc/config.json. The temp dirs are git-initialized
// so projectKey() resolves a stable git-based key and the dirs exist (config import
// skips gone dirs); both are pushed to `homes` for cleanup.
function tempGitRepo(label) {
  const dir = mkdtempSync(join(tmpdir(), `worca-cc-fsmig-${label}-`));
  homes.push(dir); // reuse the same cleanup list
  try { execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); } catch { /* projectKey degrades to realpath */ }
  return dir;
}

function writeJson(p, obj) {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
function writeText(p, text) {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text, 'utf8');
}

function buildFixture(home) {
  // A12: two THROWAWAY git temp dirs as the registered projects, so their dirs
  // EXIST (per-project config import skips gone dirs), projectKey() resolves a
  // stable git-based key, and NOTHING under the real repo (process.cwd()) is ever
  // written or removed.
  const projA = tempGitRepo('a');
  const projB = tempGitRepo('b');
  const keyA = projectKey(projA);
  const keyB = projectKey(projB);

  // 1) registry
  writeJson(join(home, 'projects.json'), [
    { name: 'Worca CC', path: projA },
    { name: 'sandbox', path: projB },
  ]);

  // 2) a saved workflow template
  writeJson(join(home, 'workflows', 'wf_quick-fix.json'), {
    id: 'wf_quick-fix', name: 'Quick Fix', version: 1,
    steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'implementer' }],
            [{ id: 's2_0', key: 'reviewer' }]],
    feedbacks: [{ id: 'fb_0', from: 's2_0', to: 's1_0' }],
    createdAt: '2026-06-02T20:20:00.708Z', updatedAt: '2026-06-02T20:20:00.708Z',
  });

  // 3) per-project config for projA (steps + customModels + activeWorkflowId +
  //    workflows{nodes,feedbacks} + an UNKNOWN top-level key to test `extra`).
  writeJson(join(projA, '.worca-cc', 'config.json'), {
    steps: {
      planner: { model: 'claude-opus-4-8', effort: 'max' },
      refiner: { model: 'claude-opus-4-8', effort: 'max', fanOut: true },
    },
    customModels: [{ id: 'my-model', label: 'My Model' }],
    activeWorkflowId: 'wf_quick-fix',
    workflows: {
      'wf_quick-fix': {
        nodes: {
          s0_0: { model: 'claude-opus-4-8[1m]', effort: 'xhigh' },
          s1_0: { model: 'claude-opus-4-8', effort: 'high', fanOut: false },
        },
        feedbacks: { fb_0: { maxCycles: 2 } },
      },
    },
    webUiTesting: { enabled: true },                    // UNKNOWN key → must land in `extra`
  });

  // 4) store tree for projA's key: meta + one pipeline with the full file set.
  const keyDir = join(home, 'store', keyA);
  writeJson(join(keyDir, 'meta.json'), {
    key: keyA, path: projA, name: 'Worca CC', firstSeenAt: '2026-06-03T12:22:12.230Z',
  });
  const runId = 'abcd1234';
  const runDir = join(keyDir, 'pipelines', `06-06-26-history-rework-${runId}`);
  writeJson(join(runDir, 'state.json'), {
    id: runId, title: 'History rework', projectDir: projA,
    status: 'done', phase: 'done', cycle: 0,
    startedAt: '2026-06-06T07:04:14.625Z', updatedAt: '2026-06-06T08:15:13.099Z',
    steps: [
      { key: 'preflight', phase: 'preflight', cycle: 0, status: 'done',
        startedAt: '2026-06-06T07:04:14.629Z', updatedAt: '2026-06-06T07:04:15.030Z',
        activeMs: 401, runningSince: null },
      { key: '0:s0_0', phase: 'planner', nodeId: 's0_0', stepIndex: 0, cycle: 1,
        status: 'done', startedAt: '2026-06-06T07:13:26.120Z',
        updatedAt: '2026-06-06T07:25:31.006Z', activeMs: 724886, runningSince: null,
        costUsd: 4.9647 },
      { key: 'done', phase: 'done', cycle: 0, status: 'done',
        startedAt: '2026-06-06T08:15:13.099Z', updatedAt: '2026-06-06T08:15:13.099Z',
        activeMs: 0, runningSince: null },
    ],
    stepper: { version: 1, steps: [{ kind: 'preflight', nodes: [] }], feedbacks: [] },
    tools: { graphify: true, tool: 'graphify', kind: 'cli', instruction: 'x' },
    checkpointRef: 'd50b0b46bd29f6997352f30c7265158b77e5a4b1',
    totalCostUsd: 25.1017, totalActiveMs: 3932418,
    branch: { source: 'main', feature: 'worca-cc/history-rework-abcd1234',
              worktreeDir: '/tmp/wt/abcd1234', reusedExisting: false },
    baseName: 'history-rework', datePrefix: '06-06-26',
  });
  writeText(join(runDir, 'prompt.md'), '# History fast-load plan\n\nbody text\n');
  writeText(join(runDir, 'pipeline.md'),
    '# Pipeline: History rework\n\n- **id**: abcd1234\n\n## Prompt\n\n' +
    '- `not a timeline line` should be ignored (pre-Timeline backtick line)\n\n' +
    '## Timeline\n\n' +
    '- `2026-06-06T07:04:15.010Z` Pipeline created (id abcd1234).\n' +
    '- `2026-06-06T07:04:15.029Z` Git checkpoint at `d50b0b46bd`.\n' +
    '- `2026-06-06T08:15:13.099Z` Pipeline finished with status **done**.\n');
  writeJson(join(runDir, 'clarify.json'), {
    questions: [{ id: 'q1', question: 'Which approach?', options: ['a', 'b', 'c'],
                  allowFreeText: true }],
  });
  writeJson(join(runDir, 'clarify-answers.json'), {
    answers: [{ id: 'q1', question: 'Which approach?', choice: 'a' }],
  });
  writeJson(join(runDir, 'impl-review-cycle1.json'), {
    issues: [{ severity: 'minor', title: 'x', detail: 'y', location: 'z' }],
    summary: 'impl ok',
  });
  writeJson(join(runDir, 'refine-review-cycle1.json'), {
    issues: [], summary: 'refine ok',
  });
  writeJson(join(runDir, 'webui-review-cycle1.json'), {
    issues: [], summary: 'webui ok',
  });
  // markdown that STAYS + extras + a stray md
  writeText(join(runDir, 'manual-tests-checklist.md'), '# checklist\n- [ ] do thing\n');
  writeText(join(runDir, 'webui-review-cycle1.md'), '# webui review\nPASS\n');
  writeText(join(runDir, 'DEVIATIONS.md'), '# deviations\nnone\n');
  writeText(join(runDir, 'extras', 'attachment.txt'), 'user attachment\n');
  // shared plan/review markdown linked by <datePrefix>-<base>
  writeText(join(keyDir, 'plans', '06-06-26-history-rework.md'), '# plan v1\n');
  writeText(join(keyDir, 'plans', '06-06-26-history-rework-v2.md'), '# plan v2\n');
  writeText(join(keyDir, 'reviews', '06-06-26-history-rework-impl-review.md'), '# review\n');

  // 5) settings.json — MUST be ignored + left in place.
  writeJson(join(home, 'settings.json'), { root: '/some/where' });

  return { projA, projB, keyA, keyB, runId, runDir, keyDir };
}

test('maybeMigrateFromFs imports the full legacy tree into every table', POSIX_SHIM, () => {
  const home = worcaHome();                 // <WORCA_HOME>/.worca-cc
  mkdirSync(home, { recursive: true });
  const fx = buildFixture(home);

  const db = getDb();                          // opens + migrate(); hook is the no-op stub still
  maybeMigrateFromFs(db);                      // explicit call (decoupled from getDb's own call)

  // projects
  const projCount = db.prepare('SELECT count(*) AS n FROM projects').get().n;
  assert.equal(projCount, 2, 'both registry projects imported');
  const pa = db.prepare('SELECT * FROM projects WHERE key = ?').get(fx.keyA);
  assert.equal(pa.name, 'Worca CC');
  assert.equal(pa.path, fx.projA);
  assert.ok(pa.created_at, 'created_at synthesized');

  // workflows (DEFAULT excluded; the saved one present)
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get('wf_quick-fix');
  assert.equal(wf.name, 'Quick Fix');
  assert.deepEqual(JSON.parse(wf.steps)[0], [{ id: 's0_0', key: 'planner' }]);

  // project_config + normalized rows + extra
  const cfg = db.prepare('SELECT * FROM project_config WHERE project_key = ?').get(fx.keyA);
  assert.equal(cfg.active_workflow_id, 'wf_quick-fix');
  assert.deepEqual(JSON.parse(cfg.steps).planner, { model: 'claude-opus-4-8', effort: 'max' });
  assert.deepEqual(JSON.parse(cfg.custom_models), [{ id: 'my-model', label: 'My Model' }]);
  assert.deepEqual(JSON.parse(cfg.extra), { webUiTesting: { enabled: true } });
  const nodeRows = db.prepare(
    'SELECT * FROM config_workflow_nodes WHERE project_key = ? AND workflow_id = ? ORDER BY node_id'
  ).all(fx.keyA, 'wf_quick-fix');
  assert.equal(nodeRows.length, 2);
  assert.equal(nodeRows[0].node_id, 's0_0');
  assert.equal(nodeRows[0].fan_out, null, 's0_0 had no fanOut → NULL');
  assert.equal(nodeRows[1].fan_out, 0, 's1_0 fanOut:false → 0');
  const fbRows = db.prepare(
    'SELECT * FROM config_workflow_feedbacks WHERE project_key = ?'
  ).all(fx.keyA);
  assert.equal(fbRows.length, 1);
  assert.equal(fbRows[0].max_cycles, 2);

  // store_meta
  const meta = db.prepare('SELECT * FROM store_meta WHERE key = ?').get(fx.keyA);
  assert.equal(meta.kind, 'project');
  assert.equal(JSON.parse(meta.data).name, 'Worca CC');

  // pipelines
  const pl = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(fx.runId);
  assert.ok(pl, 'pipeline row present');
  assert.equal(pl.project_key, fx.keyA);
  assert.equal(pl.workspace_key, null, 'single-project run has null workspace_key');
  assert.equal(pl.target, 'project');
  assert.equal(pl.status, 'done');
  assert.equal(pl.base_name, 'history-rework');
  assert.equal(pl.date_prefix, '06-06-26');
  assert.equal(pl.total_cost_usd, 25.1017);
  assert.equal(pl.total_active_ms, 3932418);
  assert.match(pl.prompt, /History fast-load plan/, 'prompt body from prompt.md');
  assert.equal(JSON.parse(pl.branch).feature, 'worca-cc/history-rework-abcd1234');
  assert.equal(JSON.parse(pl.stepper).version, 1);
  assert.equal(JSON.parse(pl.tools).tool, 'graphify');

  // pipeline_steps
  const steps = db.prepare(
    'SELECT * FROM pipeline_steps WHERE pipeline_id = ? ORDER BY key'
  ).all(fx.runId);
  assert.equal(steps.length, 3);
  const planner = steps.find((s) => s.key === '0:s0_0');
  assert.equal(planner.node_id, 's0_0');
  assert.equal(planner.step_index, 0);
  assert.equal(planner.cost_usd, 4.9647);
  assert.equal(planner.active_ms, 724886);
  const pre = steps.find((s) => s.key === 'preflight');
  assert.equal(pre.node_id, null, 'preflight carries no nodeId');
  assert.equal(pre.step_index, null);

  // pipeline_events (strict timeline lines ONLY; the pre-Timeline backtick line excluded)
  const events = db.prepare(
    'SELECT * FROM pipeline_events WHERE pipeline_id = ? ORDER BY id'
  ).all(fx.runId);
  assert.equal(events.length, 3, 'exactly the 3 timeline lines');
  assert.equal(events[0].ts, '2026-06-06T07:04:15.010Z');
  assert.match(events[0].text, /Pipeline created/);
  assert.match(events[2].text, /finished with status/);

  // clarify (one row, both halves)
  const cl = db.prepare('SELECT * FROM clarify WHERE pipeline_id = ?').get(fx.runId);
  assert.equal(JSON.parse(cl.questions).questions[0].id, 'q1');
  assert.equal(JSON.parse(cl.answers).answers[0].choice, 'a');

  // reviews (impl/refine/webui; cycle derived)
  const reviews = db.prepare(
    'SELECT * FROM reviews WHERE pipeline_id = ? ORDER BY kind'
  ).all(fx.runId);
  assert.deepEqual(reviews.map((r) => r.kind), ['impl', 'refine', 'webui']);
  assert.equal(reviews.every((r) => r.cycle === 1), true);
  const impl = reviews.find((r) => r.kind === 'impl');
  assert.equal(JSON.parse(impl.verdict).summary, 'impl ok');

  // artifacts: per-pipeline kept md + extras + stray md + shared plan/review
  const arts = db.prepare(
    'SELECT kind, rel_path FROM artifacts WHERE pipeline_id = ? ORDER BY kind, rel_path'
  ).all(fx.runId);
  const byKind = (k) => arts.filter((a) => a.kind === k).map((a) => a.rel_path);
  assert.deepEqual(byKind('manual-checklist'), ['manual-tests-checklist.md']);
  assert.deepEqual(byKind('webui-review'), ['webui-review-cycle1.md']);
  assert.deepEqual(byKind('extra'), ['extras/attachment.txt']);
  assert.deepEqual(byKind('extra-md'), ['DEVIATIONS.md']);
  assert.deepEqual(byKind('plan').sort(),
    ['plans/06-06-26-history-rework-v2.md', 'plans/06-06-26-history-rework.md']);
  assert.deepEqual(byKind('review'), ['reviews/06-06-26-history-rework-impl-review.md']);
});

// ── Task 4.2 — the self-guard (idempotent + no-op on empty/corrupt tree) ─────────

test('a second call is a no-op (idempotent) and does not duplicate rows', () => {
  const home = worcaHome();
  mkdirSync(home, { recursive: true });
  const fx = buildFixture(home);
  const db = getDb();

  maybeMigrateFromFs(db);
  const counts1 = tableCounts(db);
  assert.equal(counts1.projects, 2, 'first run imported');

  // Second call: the row-count self-guard must make it a no-op (no throw, no dupes).
  assert.doesNotThrow(() => maybeMigrateFromFs(db));
  const counts2 = tableCounts(db);
  assert.deepEqual(counts2, counts1, 'no table changed on the second call');
  void fx;
});

test('no-op when there is no legacy JSON at all', () => {
  const home = worcaHome();
  mkdirSync(home, { recursive: true });
  // Only a settings.json (bootstrap) — NOT a consumable source.
  writeJson(join(home, 'settings.json'), { root: '/x' });
  const db = getDb();
  assert.doesNotThrow(() => maybeMigrateFromFs(db));
  const counts = tableCounts(db);
  assert.equal(counts.projects, 0);
  assert.equal(counts.pipelines, 0);
  // settings.json must still be present (never consumed).
  assert.ok(existsSync(join(home, 'settings.json')), 'settings.json left in place');
  // No backup dir created when nothing was migrated.
  assert.equal(readdirSync(home).some((n) => n.startsWith('backup-')), false);
});

test('no-op when legacy JSON is present but only corrupt (no importable rows)', () => {
  const home = worcaHome();
  mkdirSync(home, { recursive: true });
  writeText(join(home, 'projects.json'), '{ this is not valid json');
  const db = getDb();
  assert.doesNotThrow(() => maybeMigrateFromFs(db));
  assert.equal(tableCounts(db).projects, 0, 'corrupt registry imported nothing');
});

// Sum helper used by the idempotency assertions.
function tableCounts(db) {
  const tables = ['projects', 'workspaces', 'workspace_projects', 'workflows',
    'project_config', 'config_workflow_nodes', 'config_workflow_feedbacks', 'pipelines',
    'pipeline_steps', 'pipeline_events', 'clarify', 'reviews', 'store_meta', 'artifacts'];
  const out = {};
  for (const t of tables) out[t] = db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n;
  return out;
}

// ── Task 4.3 — archive: consumed JSON → backup-<ts>/; md/extras/settings stay ────

test('archives consumed JSON into backup-<ts>/ mirroring layout; leaves md/extras/settings', () => {
  const home = worcaHome();
  mkdirSync(home, { recursive: true });
  const fx = buildFixture(home);
  const db = getDb();
  maybeMigrateFromFs(db);

  // Exactly one backup-<ts>/ dir was created.
  const backups = readdirSync(home).filter((n) => n.startsWith('backup-'));
  assert.equal(backups.length, 1, 'one backup dir created');
  const backup = join(home, backups[0]);

  // CONSUMED json moved OUT of their original locations...
  assert.ok(!existsSync(join(home, 'projects.json')), 'projects.json moved');
  assert.ok(!existsSync(join(fx.runDir, 'state.json')), 'state.json moved');
  assert.ok(!existsSync(join(fx.runDir, 'pipeline.md')), 'pipeline.md moved (consumed)');
  assert.ok(!existsSync(join(fx.runDir, 'clarify.json')), 'clarify.json moved');
  assert.ok(!existsSync(join(fx.runDir, 'impl-review-cycle1.json')), 'review json moved');
  assert.ok(!existsSync(join(fx.keyDir, 'meta.json')), 'meta.json moved');
  assert.ok(!existsSync(projectConfigPath(fx.projA)), 'per-project config.json moved');

  // ...and now live under backup-<ts>/ mirroring the home-relative layout.
  assert.ok(existsSync(join(backup, 'projects.json')), 'projects.json mirrored');
  assert.ok(existsSync(join(backup, 'workflows', 'wf_quick-fix.json')), 'workflow mirrored');
  const relRun = relativeToHome(home, fx.runDir);
  assert.ok(existsSync(join(backup, relRun, 'state.json')), 'state.json mirrored under store/.../');
  assert.ok(existsSync(join(backup, relRun, 'pipeline.md')), 'pipeline.md mirrored');
  assert.ok(existsSync(join(backup, relRun, 'clarify.json')), 'clarify.json mirrored');
  assert.ok(existsSync(join(backup, relRun, 'impl-review-cycle1.json')), 'review mirrored');
  // per-project config namespaced by projectKey under project-config/<key>/.
  assert.ok(existsSync(join(backup, 'project-config', fx.keyA, 'config.json')),
    'per-project config namespaced in backup');

  // MARKDOWN + extras + settings + the run dir itself STAY in place.
  assert.ok(existsSync(join(fx.runDir, 'prompt.md')), 'prompt.md stays');
  assert.ok(existsSync(join(fx.runDir, 'manual-tests-checklist.md')), 'checklist md stays');
  assert.ok(existsSync(join(fx.runDir, 'webui-review-cycle1.md')), 'webui review md stays');
  assert.ok(existsSync(join(fx.runDir, 'DEVIATIONS.md')), 'stray md stays');
  assert.ok(existsSync(join(fx.runDir, 'extras', 'attachment.txt')), 'extras stay');
  assert.ok(existsSync(join(fx.keyDir, 'plans', '06-06-26-history-rework.md')), 'plan md stays');
  assert.ok(existsSync(join(fx.keyDir, 'reviews', '06-06-26-history-rework-impl-review.md')),
    'review md stays');
  assert.ok(existsSync(join(home, 'settings.json')), 'settings.json NEVER moved');
  // NONE of the kept markdown/extras leaked into the backup.
  assert.ok(!existsSync(join(backup, relRun, 'prompt.md')), 'prompt.md not in backup');
  assert.ok(!existsSync(join(backup, relRun, 'manual-tests-checklist.md')), 'checklist not in backup');
  assert.ok(!existsSync(join(backup, relRun, 'extras', 'attachment.txt')), 'extras not in backup');
  assert.ok(!existsSync(join(backup, 'settings.json')), 'settings.json not in backup');
});

// Path helpers for the archive assertions (kept local to the test file). join is
// already imported at the top; relative is aliased here to avoid shadowing it.
import { relative as _relative } from 'node:path';
function relativeToHome(home, p) { return _relative(home, p); }
function projectConfigPath(projectDir) { return join(projectDir, '.worca-cc', 'config.json'); }

// ── Task 4.4 — workspace runs: composite key, workspace_meta, ordered members ────

test('imports a workspace registry + workspace-store pipeline correctly', () => {
  const home = worcaHome();
  mkdirSync(home, { recursive: true });
  const a = tempGitRepo('wsa');
  const b = tempGitRepo('wsb');
  const ka = projectKey(a);
  const kb = projectKey(b);
  const wkey = 'wks-demo-12345678';

  // registry (projects + workspaces)
  writeJson(join(home, 'projects.json'), [
    { name: 'A', path: a }, { name: 'B', path: b },
  ]);
  writeJson(join(home, 'workspaces.json'), [{
    id: wkey, name: 'Demo WS', description: 'two repos',
    projectPaths: [a, b],                 // PERSISTED input order -> ordinals 0,1
    createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-02T00:00:00.000Z',
  }]);

  // workspace store: meta + a workspace pipeline (target:'workspace' superset)
  const sortedKeys = [ka, kb].sort();
  const wsKeyDir = join(home, 'store', 'workspaces', wkey);
  writeJson(join(wsKeyDir, 'meta.json'), {
    key: wkey, id: wkey, name: 'Demo WS',
    projectKeys: sortedKeys, projectPaths: [a, b], firstSeenAt: '2026-06-01T00:00:00.000Z',
  });
  const runId = 'ws00ff11';
  const runDir = join(wsKeyDir, 'pipelines', `06-06-26-add-pagination-${runId}`);
  writeJson(join(runDir, 'state.json'), {
    id: runId, title: 'add pagination', projectDir: a,
    status: 'done', phase: 'done', cycle: 0,
    startedAt: '2026-06-06T00:00:00.000Z', updatedAt: '2026-06-06T01:00:00.000Z',
    steps: [{ key: 'preflight', phase: 'preflight', cycle: 0, status: 'done', activeMs: 1, runningSince: null }],
    target: 'workspace', workspaceId: wkey, workspaceKey: wkey, workspaceName: 'Demo WS',
    workspaceDescription: '# Workspace: Demo\nlots of detail',
    projectKeys: sortedKeys,
    projects: sortedKeys.map((k, i) => ({ projectKey: k, projectDir: i === 0 ? a : b, projectName: i === 0 ? 'A' : 'B' })),
    checkpointRefs: {}, branches: {},
    baseName: 'add-pagination', datePrefix: '06-06-26',
  });
  writeText(join(runDir, 'prompt.md'), 'add pagination\n');

  const db = getDb();
  maybeMigrateFromFs(db);

  // workspaces + ordered members
  const ws = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(wkey);
  assert.equal(ws.name, 'Demo WS');
  assert.equal(ws.created_at, '2026-06-01T00:00:00.000Z');
  const members = db.prepare(
    'SELECT project_key, ordinal FROM workspace_projects WHERE workspace_id = ? ORDER BY ordinal'
  ).all(wkey).map((r) => ({ project_key: r.project_key, ordinal: r.ordinal })); // node:sqlite rows are null-proto
  assert.deepEqual(members, [
    { project_key: a, ordinal: 0 },         // A1: stores the PATH (ordinal-ordered), not the key
    { project_key: b, ordinal: 1 },
  ]);

  // store_meta keyed by the BARE workspace key, kind=workspace
  const meta = db.prepare('SELECT * FROM store_meta WHERE key = ?').get(wkey);
  assert.equal(meta.kind, 'workspace');

  // the workspace pipeline: composite workspace_key, primary project_key, workspace_meta
  const pl = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(runId);
  assert.equal(pl.target, 'workspace');
  assert.equal(pl.workspace_key, `workspaces/${wkey}`, 'composite workspace_key tag');
  assert.equal(pl.project_key, sortedKeys[0], 'primary (first sorted) member key');
  const wm = JSON.parse(pl.workspace_meta);
  assert.equal(wm.workspaceName, 'Demo WS');
  assert.equal(wm.workspaceDescription, '# Workspace: Demo\nlots of detail');
  assert.deepEqual(wm.projectKeys, sortedKeys);
  assert.equal(wm.projects.length, 2);
  assert.deepEqual(wm.checkpointRefs, {});
  // a single-project run elsewhere must still have null workspace_meta (sanity).
});

// m14 (CRITICAL correctness): a hand-corrupted workspaces.json with two
// CI-name-colliding entries (distinct ids) must NOT roll the whole migration back.
// `idx_workspaces_name COLLATE NOCASE` makes `INSERT OR IGNORE` drop the 2nd
// `workspaces` row (changes===0); its `workspace_projects` children would then FK-
// fail (parent absent) and — because `INSERT OR IGNORE` does NOT swallow a FOREIGN
// KEY violation, it THROWS — abort+rollback the entire import. Since getDb() calls
// the hook on every open, that rethrow makes every launch re-attempt the migration
// forever (an infinite re-migrate loop). The importer must guard this: emit a
// workspace's member rows ONLY when its `workspaces` row actually inserted
// (changes===1), or pre-dedupe by id+CI-name. This test proves the migration
// COMPLETES and the surviving workspace + its members import cleanly.
test('m14: CI-name-colliding workspaces.json migrates without rolling back', () => {
  const home = worcaHome();
  mkdirSync(home, { recursive: true });
  const a = tempGitRepo('m14a');
  const b = tempGitRepo('m14b');
  const c = tempGitRepo('m14c');

  writeJson(join(home, 'projects.json'), [
    { name: 'A', path: a }, { name: 'B', path: b }, { name: 'C', path: c },
  ]);
  // Two DISTINCT workspace ids whose names collide case-insensitively ("Demo"/"demo").
  // The unique COLLATE NOCASE name index keeps only the first `workspaces` row.
  writeJson(join(home, 'workspaces.json'), [
    {
      id: 'wks-demo-aaaaaaaa', name: 'Demo', description: 'first',
      projectPaths: [a, b],
      createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
    },
    {
      id: 'wks-demo-bbbbbbbb', name: 'demo', description: 'collides on name',
      projectPaths: [b, c],
      createdAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-06-02T00:00:00.000Z',
    },
  ]);

  const db = getDb();
  // The whole import must COMPLETE — no FK-violation rollback, no rethrow.
  assert.doesNotThrow(() => maybeMigrateFromFs(db));

  // The migration ran to completion: the projects (committed in the SAME tx) are present.
  assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n, 3,
    'all projects imported (proves the tx committed, not rolled back)');

  // Exactly the FIRST workspace survived the unique-name index.
  const wsRows = db.prepare('SELECT id, name FROM workspaces ORDER BY id').all();
  assert.equal(wsRows.length, 1, 'only the first CI-name workspace inserted');
  assert.equal(wsRows[0].id, 'wks-demo-aaaaaaaa');

  // The surviving workspace keeps its members; the DROPPED workspace left NO orphan
  // member rows (the guard suppressed them, so no FK violation could occur).
  const survivors = db.prepare(
    'SELECT ordinal FROM workspace_projects WHERE workspace_id = ? ORDER BY ordinal'
  ).all('wks-demo-aaaaaaaa');
  assert.equal(survivors.length, 2, 'surviving workspace has both members');
  const orphans = db.prepare(
    'SELECT count(*) AS n FROM workspace_projects WHERE workspace_id = ?'
  ).get('wks-demo-bbbbbbbb').n;
  assert.equal(orphans, 0, 'dropped workspace contributed no member rows');
});

// ── Task 4.5 — rollback safety: a DB error leaves the DB empty AND the JSON intact ──
//
// A8 (crash-safety): the import is ONE transaction (A5) and the archive runs ONLY after
// a clean COMMIT. A DB error mid-insert must (a) ROLLBACK + rethrow, leaving EVERY table
// empty, and (b) leave the legacy JSON on disk (un-archived, no backup-<ts>/ dir), so a
// later open retries cleanly.
//
// Forcing the error (A14 — observable effect, NOT namespace mocking): we add a real
// BEFORE-INSERT trigger on pipeline_events that RAISE(ABORT)s. The fixture's pipeline.md
// yields timeline rows, so insertAll() reaches the events insert — AFTER projects /
// pipelines are already inserted in the SAME tx — and the FIRST event insert throws,
// proving ROLLBACK discards even the rows written earlier in the transaction. We never
// mock.method the importer or db.mjs; the trigger is a genuine schema constraint.
//
// Why a RAW handle (not getDb()): the Phase-1.6 wiring makes getDb() run the real
// importer DURING open (db.mjs#getDb -> maybeMigrateFromFs). Since buildFixture() seeds
// the legacy tree BEFORE we open, getDb() would already import + archive — leaving
// nothing to roll back and the trigger un-armed. So we open a fresh DatabaseSync at the
// SAME dbPath(), enable FKs, run migrate() (so the schema + user_version exist), arm the
// trigger, and call maybeMigrateFromFs(db) on that handle via the seam the importer
// already exposes (it takes `db`). This drives the identical single-transaction import.
// The trigger is dropped in `finally`; the handle is closed at the end (each test reopens
// a fresh DB at its own home regardless). A12: home + fixture dirs are throwaway temps.
test('a DB error mid-import rolls back ALL rows and leaves the legacy JSON untouched', () => {
  const home = worcaHome();
  mkdirSync(home, { recursive: true });
  const fx = buildFixture(home);

  // Open a raw handle (NOT getDb(), whose open-time hook would import before we can arm
  // the trigger) and prepare it exactly as getDb() does, up to but excluding the hook.
  const db = new DatabaseSync(dbPath());
  db.exec('PRAGMA foreign_keys = ON;'); // so a FK/constraint abort behaves like production
  migrate(db);                          // schema + PRAGMA user_version = 1

  // Force a transaction failure during insertAll(): pipeline_events is inserted AFTER
  // projects/pipelines in the SAME tx, so the first event insert aborting proves the
  // ROLLBACK discards the rows committed earlier in the transaction too.
  db.exec("CREATE TRIGGER _force_fail BEFORE INSERT ON pipeline_events " +
          "BEGIN SELECT RAISE(ABORT, 'forced'); END;");
  try {
    assert.throws(() => maybeMigrateFromFs(db), /forced/, 'the DB error propagates');
  } finally {
    db.exec('DROP TRIGGER _force_fail');
  }

  // Atomicity: the rollback discarded EVERY table the transaction touched.
  const counts = tableCounts(db);
  for (const [t, n] of Object.entries(counts)) {
    assert.equal(n, 0, `table ${t} is empty after rollback`);
  }

  // The legacy JSON is STILL on disk (archive only runs after a successful commit),
  // so nothing is lost and a retry is safe.
  assert.ok(existsSync(join(home, 'projects.json')), 'projects.json not archived on failure');
  assert.ok(existsSync(join(fx.runDir, 'state.json')), 'state.json not archived on failure');
  assert.equal(readdirSync(home).some((n) => n.startsWith('backup-')), false,
    'no backup dir created on a failed migration');

  // A clean retry (trigger removed) now succeeds — the empty DB + intact JSON re-import.
  assert.doesNotThrow(() => maybeMigrateFromFs(db));
  assert.equal(tableCounts(db).projects, 2, 'retry imports successfully');
  // And NOW (after a clean commit) the archive ran exactly once.
  assert.equal(readdirSync(home).filter((n) => n.startsWith('backup-')).length, 1,
    'backup dir created only after the successful retry commit');

  db.close();
});

// ── Task 4.6 — integration: getDb() triggers the migration on first open (e2e) ──────
//
// Proves the WHOLE Phase-1.6 wiring (getDb -> migrate -> maybeMigrateFromFs) now drives
// the REAL Phase-4 importer, not a stub no-op: a fresh getDb() against a temp home with a
// legacy fixture must, as part of the single open, import every table AND archive the
// consumed JSON — with NO explicit maybeMigrateFromFs() call. A12: the home + the two
// registered projects are throwaway temp dirs (buildFixture/tempGitRepo), so the real
// <repo>/.worca-cc is never touched. We also prove the count-guard makes a reopen a no-op.
test('getDb() runs the fs->db migration automatically on first open', () => {
  const home = worcaHome();
  mkdirSync(home, { recursive: true });
  const fx = buildFixture(home);

  // No explicit maybeMigrateFromFs() call — getDb() must invoke it as part of open.
  const db = getDb();

  assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n, 2,
    'projects imported during getDb() open');
  assert.ok(db.prepare('SELECT 1 FROM pipelines WHERE id = ?').get(fx.runId),
    'pipeline imported during getDb() open');

  // The binding 4.6 contract: EVERY table the legacy fixture seeds is populated by the
  // single open. buildFixture() is a SINGLE-PROJECT tree, so the two workspace tables are
  // legitimately empty (the dedicated workspace import — composite key + ordered members +
  // workspace_meta — is proven exhaustively by the Task 4.4 test above); the OTHER 12
  // tables must all have rows after open. This asserts the whole 14-table importer ran as
  // part of getDb(), not a stub no-op.
  const counts = tableCounts(db);
  const seededTables = Object.keys(counts).filter(
    (t) => t !== 'workspaces' && t !== 'workspace_projects');
  for (const t of seededTables) {
    assert.ok(counts[t] > 0, `table ${t} populated during getDb() open (got ${counts[t]})`);
  }
  assert.equal(counts.workspaces, 0, 'single-project fixture seeds no workspaces (see Task 4.4)');
  assert.equal(counts.workspace_projects, 0, 'single-project fixture seeds no workspace members');

  // And the consumed JSON was archived as part of the same open.
  assert.ok(!existsSync(join(home, 'projects.json')), 'projects.json archived on open');
  assert.equal(readdirSync(home).filter((n) => n.startsWith('backup-')).length, 1,
    'exactly one backup-<ts>/ created on open');

  // Reopen no-op: drop the cached handle and getDb() AGAIN against the SAME home. The
  // legacy JSON is now archived (gone), but even if it lingered the count-guard
  // (projects/pipelines > 0) makes the second open import nothing and create no second
  // backup dir — the DB is authoritative.
  _resetForTests();
  const db2 = getDb();
  const counts2 = tableCounts(db2);
  assert.deepEqual(counts2, counts, 'reopen imported nothing (count-guard no-op)');
  assert.equal(readdirSync(home).filter((n) => n.startsWith('backup-')).length, 1,
    'reopen created no second backup dir');
});

// ── M3 — completion marker latch (re-run safety independent of row counts) ───────
const MIGRATION_MARKER_KEY = '__fs_migration__';
function markerRow(db) {
  return db.prepare('SELECT kind, data FROM store_meta WHERE key = ?').get(MIGRATION_MARKER_KEY);
}

test('M3: a successful import stamps the completion marker inside the tx', () => {
  const home = worcaHome();
  mkdirSync(home, { recursive: true });
  buildFixture(home);
  const db = getDb();
  maybeMigrateFromFs(db);

  const m = markerRow(db);
  assert.ok(m, 'marker row present after a successful import');
  assert.equal(m.kind, '_meta', 'marker uses the reserved _meta kind');
  const data = JSON.parse(m.data);
  assert.equal(data.migrated, true, 'marker payload records completion');
  assert.ok(typeof data.at === 'string' && data.at.length > 0, 'marker stamps a timestamp');
});

test('M3: re-run is gated on the marker, not the row counts', () => {
  const home = worcaHome();
  mkdirSync(home, { recursive: true });
  buildFixture(home);
  const db = getDb();
  maybeMigrateFromFs(db);
  assert.ok(markerRow(db), 'marker stamped on first import');

  // Wipe the rows the OLD proxy keyed on, but KEEP the marker. The importer must
  // STILL be a no-op (the marker says "done"), proving it no longer trusts counts.
  db.exec('DELETE FROM pipelines; DELETE FROM projects;');
  assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n, 0);
  assert.doesNotThrow(() => maybeMigrateFromFs(db));
  assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n, 0,
    're-import suppressed by the marker even with zero project rows');
});

test('M3: a DB with rows but NO marker still imports (handles a pre-marker DB)', () => {
  const home = worcaHome();
  mkdirSync(home, { recursive: true });
  buildFixture(home);
  const db = getDb();
  maybeMigrateFromFs(db);

  // Simulate a DB migrated by a pre-marker build: rows exist, but the marker does
  // not. Removing it must let a subsequent run proceed (re-stamping it). We first
  // re-seed the legacy JSON the prior archive moved away, so there IS data to import.
  db.exec('DELETE FROM store_meta WHERE key = \'__fs_migration__\';');
  assert.equal(markerRow(db), undefined, 'marker removed');
  // Re-create a minimal legacy registry so legacyPresent() + collectLegacy() see rows.
  writeJson(join(home, 'projects.json'), [{ name: 'Reappear', path: home }]);

  assert.doesNotThrow(() => maybeMigrateFromFs(db));
  assert.ok(markerRow(db), 'marker re-stamped after a marker-less re-import');
});

// M-min3a: parseTimeline must NOT scan a header-less pipeline.md with the ISO regex
// (a prompt body can legitimately contain "- `<ISO ts>` ..." lines). Without a
// "## Timeline" header the importer should record NO events. We assert through the
// public effect (pipeline_events rows), since parseTimeline is module-private.
test('M-min3a: a header-less pipeline.md fabricates no pipeline_events', () => {
  const home = worcaHome();
  mkdirSync(home, { recursive: true });
  const proj = tempGitRepo('nohdr');
  const key = projectKey(proj);
  writeJson(join(home, 'projects.json'), [{ name: 'NoHdr', path: proj }]);

  const keyDir = join(home, 'store', key);
  writeJson(join(keyDir, 'meta.json'), { key, path: proj, name: 'NoHdr', firstSeenAt: '2026-06-01T00:00:00.000Z' });
  const runId = 'deadbeef';
  const runDir = join(keyDir, 'pipelines', `06-06-26-no-header-${runId}`);
  writeJson(join(runDir, 'state.json'), {
    id: runId, title: 'No header', projectDir: proj, status: 'done', phase: 'done',
    cycle: 0, startedAt: '2026-06-06T00:00:00.000Z', updatedAt: '2026-06-06T01:00:00.000Z',
    baseName: 'no-header', datePrefix: '06-06-26', steps: [],
  });
  // A pipeline.md with NO "## Timeline" header but WITH ISO-backtick lines in prose.
  writeText(join(runDir, 'pipeline.md'),
    '# Pipeline: No header\n\n## Prompt\n\n' +
    'Please fix the thing.\n' +
    '- `2026-06-06T07:04:15.010Z` this is quoted prompt text, NOT a timeline event\n' +
    '- `2026-06-06T07:04:15.029Z` also prose, must be ignored\n');

  const db = getDb();
  maybeMigrateFromFs(db);

  const n = db.prepare('SELECT count(*) AS n FROM pipeline_events WHERE pipeline_id = ?').get(runId).n;
  assert.equal(n, 0, 'no events when pipeline.md has no "## Timeline" header');
  // sanity: the pipeline itself imported (so we know parseTimeline ran on this run).
  assert.ok(db.prepare('SELECT 1 FROM pipelines WHERE id = ?').get(runId), 'pipeline imported');
});

// M-min3b: archive failures are best-effort (must NOT crash app open) but MUST be
// logged so a leftover un-archived file is diagnosable. We strip write perm on the run
// dir so renameSync() of its files out during archive fails (EACCES/EPERM), then assert:
// the import still commits (no throw) and console.warn carried a diagnostic.
//
// NOTE: we open a RAW handle (NOT getDb(), whose open-time hook would import, archive
// successfully, and stamp the M3 marker BEFORE we can strip perms — making a later
// maybeMigrateFromFs() a marker no-op that never reaches archive). This mirrors the
// rollback test above so the SINGLE import runs below, after perms are stripped.
test('M-min3b: an archive failure is swallowed but logged', { ...POSIX_SHIM,
  // Skip under root: root ignores directory write perms, so chmod 0o500 would not block
  // renameSync and no archive failure would be injected (the brief's env is non-root).
  skip: typeof process.getuid === 'function' && process.getuid() === 0
    ? 'requires non-root: chmod perms are ignored as root' : false,
}, () => {
  const home = worcaHome();
  mkdirSync(home, { recursive: true });
  const fx = buildFixture(home);

  // Prepare a raw handle exactly as getDb() does, up to but excluding the import hook.
  const db = new DatabaseSync(dbPath());
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
  try {
    chmodSync(fx.runDir, 0o500);             // r-x: can read children but not rename them out
    assert.doesNotThrow(() => maybeMigrateFromFs(db), 'archive failure must not crash open');
  } finally {
    chmodSync(fx.runDir, 0o700);             // restore so cleanup (rmSync) works
    console.warn = origWarn;
  }

  // The import still succeeded (archive runs AFTER commit; only the file move failed).
  assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n, 2, 'import committed');
  // The failure was logged (diagnosable leftover).
  assert.ok(warnings.some((w) => /archive/i.test(w)),
    'an archive failure is logged via console.warn');
  db.close();
});
