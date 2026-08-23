// test/upgrade-integration.test.mjs  (Phase 6, Task 6.16 — the capstone)
//
// End-to-end UPGRADE: a legacy (pre-SQLite) install is auto-migrated on the FIRST
// getDb(). We seed the exact on-disk JSON/markdown layout the OLD version wrote
// (projects.json, workspaces.json, workflows/<id>.json, per-project
// <projectDir>/.worca-cc/config.json, and a full store tree: meta.json +
// pipelines/<runId>/{state.json, pipeline.md, clarify.json, clarify-answers.json,
// impl-review-cycle1.json, prompt.md, extras/} plus shared plans/ & reviews/
// markdown), then open getDb() ONCE (no explicit migrate call) and assert the
// count-guarded one-time importer (db.mjs#getDb -> migrate -> maybeMigrateFromFs)
// ran: every relevant table is populated, the consumed JSON moved into a
// backup-<ts>/ archive, and the agent markdown + extras/ + the bootstrap
// settings.json stayed in place.
//
// CRUCIALLY the data is verified THROUGH THE SERVICE APIs (not just raw rows):
// listProjects / readConfig / readRunConfig / listWorkflows /
// listWorkspaces / readWorkspace / listAllPipelines / listPipelines /
// readPipelineByKey — plus a re-open (count-guard) NO-OP check.
//
// A12 (data-destruction guard): every fixture path is a throwaway temp dir under
// our own temp WORCA_HOME (or a temp git repo); we NEVER read/write
// process.cwd()/.worca-cc. Proper isolation: own temp home + _resetForTests().

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { getDb, _resetForTests, prepare } from '../src/core/db.mjs';
import { listProjects } from '../src/core/projects.mjs';
import { listWorkspaces, readWorkspace } from '../src/core/workspaces.mjs';
import { readConfig, readRunConfig } from '../src/core/config.mjs';
import { listPipelines, listAllPipelines, readPipelineByKey } from '../src/core/artifacts.mjs';
import { listWorkflows } from '../src/core/workflows.mjs';
import { projectKey, projectStorePath } from '../src/core/store.mjs';

let home, prevHome, repoA, repoB;
const RUN_ID = 'abcd1234';
const WS_KEY = 'wks-demo-9f3a1c20';

/** A real git repo so projectKey()/canonicalProjectRoot() resolve a stable key. */
async function freshRepo(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

before(async () => {
  // Own throwaway home; flip WORCA_HOME and drop any singleton from another file
  // BEFORE we seed, so the very first getDb() in this file opens against THIS home.
  home = await mkdtemp(join(tmpdir(), 'worca-cc-upgrade-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();

  repoA = await freshRepo('worca-cc-up-a-'); // an onboarded project (has config.json)
  repoB = await freshRepo('worca-cc-up-b-'); // a workspace member

  const md = join(home, '.worca-cc'); // worcaHome() == <home>/.worca-cc
  await mkdir(md, { recursive: true });

  // A non-consumed bootstrap file that MUST survive (never archived/removed).
  await writeFile(join(md, 'settings.json'), JSON.stringify({ note: 'bootstrap stays' }, null, 2));

  // ── 1) legacy registries ───────────────────────────────────────────────────
  await writeFile(join(md, 'projects.json'),
    JSON.stringify([{ name: 'Repo A', path: repoA }, { name: 'Repo B', path: repoB }], null, 2));

  // a workspace over A+B (the persisted six-field shape the old version wrote)
  await writeFile(join(md, 'workspaces.json'),
    JSON.stringify([{
      id: WS_KEY, name: 'Demo WS', description: 'shared contract',
      projectPaths: [repoA, repoB], createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
    }], null, 2));

  // a user workflow template (was workflows/<id>.json)
  await mkdir(join(md, 'workflows'), { recursive: true });
  await writeFile(join(md, 'workflows', 'wf_quickfix.json'),
    JSON.stringify({
      id: 'wf_quickfix', name: 'Quick Fix', version: 1,
      steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'implementer' }]],
      feedbacks: [{ id: 'fb_0', from: 's1_0', to: 's0_0' }],
      createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
    }, null, 2));

  // ── 2) per-project legacy config (<projectDir>/.worca-cc/config.json) ─────────
  await mkdir(join(repoA, '.worca-cc'), { recursive: true });
  await writeFile(join(repoA, '.worca-cc', 'config.json'),
    JSON.stringify({
      steps: { planner: { model: 'claude-opus-4-8', effort: 'high' } },
      customModels: [{ id: 'my-fork-4-9', label: 'My Fork' }],
      workflows: { wf_quickfix: { nodes: { s0_0: { model: 'claude-sonnet-4-6', effort: 'high' } },
                                  feedbacks: { fb_0: { maxCycles: 3 } } } },
      activeWorkflowId: 'wf_quickfix',
      webUiTesting: { startCommand: 'npm run dev', baseUrl: 'http://localhost:5173' }, // unknown key -> extra
    }, null, 2));

  // ── 3) a full store tree for repo A: meta.json + one finished pipeline ───────
  const keyA = projectKey(repoA);
  const storeA = projectStorePath(keyA);
  await mkdir(join(storeA, 'plans'), { recursive: true });
  await mkdir(join(storeA, 'reviews'), { recursive: true });
  await writeFile(join(storeA, 'meta.json'),
    JSON.stringify({ key: keyA, path: repoA, name: 'Repo A', firstSeenAt: '2026-06-01T00:00:00Z' }, null, 2));

  const pdir = join(storeA, 'pipelines', `01-06-26-add-login-${RUN_ID}`);
  await mkdir(join(pdir, 'extras'), { recursive: true });
  await writeFile(join(pdir, 'state.json'), JSON.stringify({
    id: RUN_ID, title: 'Add login', projectDir: repoA, projectKey: keyA, projectName: 'Repo A',
    status: 'done', phase: 'done', cycle: 1, startedAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T01:00:00Z', totalCostUsd: 0.42, totalActiveMs: 5000,
    baseName: 'add-login', datePrefix: '01-06-26',
    branch: { source: 'main', feature: 'worca-cc/add-login-abcd1234' },
    steps: [
      { key: '0:s0_0', nodeId: 's0_0', phase: 'plan', stepIndex: 0, cycle: 1, status: 'done', costUsd: 0.20, activeMs: 2000 },
      { key: '1:s1_0', nodeId: 's1_0', phase: 'implement', stepIndex: 1, cycle: 1, status: 'done', costUsd: 0.22, activeMs: 3000 },
    ],
  }, null, 2));
  // control-flow JSON that MUST move into the DB:
  await writeFile(join(pdir, 'pipeline.md'),
    '# Pipeline: Add login\n\n## Timeline\n\n- `2026-06-01T00:00:00Z` Pipeline created (id abcd1234).\n- `2026-06-01T01:00:00Z` Pipeline finished with status **done**.\n');
  await writeFile(join(pdir, 'clarify.json'),
    JSON.stringify({ questions: [{ id: 'q1', question: 'Auth provider?', options: ['OAuth', 'Local', 'SSO'] }] }));
  await writeFile(join(pdir, 'clarify-answers.json'),
    JSON.stringify({ answers: [{ id: 'q1', question: 'Auth provider?', choice: 'OAuth' }] }));
  await writeFile(join(pdir, 'impl-review-cycle1.json'),
    JSON.stringify({ issues: [{ severity: 'low', title: 'nit', detail: 'x', location: 'a.js:1' }], summary: 'ok' }));
  await writeFile(join(pdir, 'prompt.md'), '# Add login\n');
  // agent MARKDOWN that MUST stay on FS:
  await writeFile(join(storeA, 'plans', '01-06-26-add-login.md'), '# Plan\n\n## Original request\n\nAdd login\n');
  await writeFile(join(storeA, 'reviews', '01-06-26-add-login-impl-review.md'), '# Review\n\nLGTM\n');
  // a user attachment in extras/ that MUST stay on FS:
  await writeFile(join(pdir, 'extras', 'mock.png'), 'PNGDATA');
});

after(async () => {
  // Order: reset singleton (checkpoints WAL + closes the handle) BEFORE rm so the
  // open DB file does not block deleting the temp home; then restore env.
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
  await rm(repoA, { recursive: true, force: true });
  await rm(repoB, { recursive: true, force: true });
});

test('first getDb() auto-runs the fs->db migration (DB is empty + legacy JSON present)', () => {
  const db = getDb(); // triggers migrate(db) then maybeMigrateFromFs(db)
  const n = db.prepare('SELECT COUNT(*) AS c FROM pipelines').get().c;
  assert.ok(n >= 1, 'the legacy pipeline was imported into the pipelines table');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 19, 'schema stamped');
  // every relevant table populated by the one-time importer
  const count = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  assert.equal(count('projects'), 2, 'projects.json -> projects');
  assert.equal(count('workspaces'), 1, 'workspaces.json -> workspaces');
  assert.equal(count('workspace_projects'), 2, 'ordered members imported');
  assert.equal(count('workflows'), 1, 'workflows/<id>.json -> workflows');
  assert.equal(count('project_config'), 1, 'per-project config.json -> project_config');
  assert.ok(count('config_workflow_nodes') >= 1, 'normalized node overrides imported');
  assert.ok(count('config_workflow_feedbacks') >= 1, 'normalized feedback cycles imported');
  assert.ok(count('store_meta') >= 1, 'meta.json -> store_meta');
  assert.equal(count('pipeline_steps'), 2, 'state.steps -> pipeline_steps');
  assert.ok(count('pipeline_events') >= 1, 'pipeline.md timeline -> pipeline_events');
  assert.equal(count('clarify'), 1, 'clarify(+answers).json -> clarify');
  assert.equal(count('reviews'), 1, 'impl-review-cycle1.json -> reviews');
  assert.ok(count('artifacts') >= 1, 'plan/review/extras markdown indexed in artifacts');
});

test('listProjects() returns the migrated registry', async () => {
  const list = await listProjects();
  const names = list.map((p) => p.name).sort();
  assert.deepEqual(names, ['Repo A', 'Repo B']);
  assert.ok(list.every((p) => p.exists), 'both registered repos exist on disk');
});

test('readConfig() returns the migrated legacy {steps, customModels} view', async () => {
  const cfg = await readConfig(repoA);
  assert.deepEqual(cfg.steps.planner, { model: 'claude-opus-4-8', effort: 'high' });
  assert.ok(cfg.customModels.some((m) => m.id === 'my-fork-4-9'), 'custom model preserved');
});

test('listWorkflows() returns the migrated user workflow template', async () => {
  const list = await listWorkflows();
  const wf = list.find((w) => w.id === 'wf_quickfix');
  assert.ok(wf, 'wf_quickfix imported');
  assert.equal(wf.name, 'Quick Fix');
  assert.equal(wf.steps.length, 2, 'two-stage topology preserved');
  assert.equal(wf.feedbacks.length, 1, 'feedback edge preserved');
});

test('listWorkspaces() + readWorkspace() return the migrated workspace + ordered members', async () => {
  const list = await listWorkspaces();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Demo WS');
  assert.equal(list[0].description, 'shared contract');
  assert.equal(list[0].projectPaths.length, 2);
  assert.equal(list[0].projectKeys.length, 2, 'derived member keys present');

  const ws = await readWorkspace(WS_KEY);
  assert.ok(ws, 'readWorkspace by id resolves the migrated workspace');
  assert.equal(ws.name, 'Demo WS');
  // members are annotated: projectKeys index-aligned with the (re-ordered) projectPaths,
  // and the derived keys match recomputing projectKey() over the member repos.
  assert.deepEqual([...ws.projectKeys].sort(), [projectKey(repoA), projectKey(repoB)].sort());
  assert.equal(ws.projectKeys.length, ws.projectPaths.length, 'keys index-aligned with paths');
  assert.equal(ws.exists.filter(Boolean).length, 2, 'both members exist on disk (derived)');
});

test('readRunConfig() returns the migrated per-project config incl. extra (webUiTesting)', async () => {
  const rc = await readRunConfig(repoA);
  assert.deepEqual(rc.steps.planner, { model: 'claude-opus-4-8', effort: 'high' });
  assert.ok(rc.customModels.some((m) => m.id === 'my-fork-4-9'));
  assert.equal(rc.workflows.wf_quickfix.nodes.s0_0.model, 'claude-sonnet-4-6');
  assert.equal(rc.workflows.wf_quickfix.feedbacks.fb_0.maxCycles, 3);
  assert.equal(rc.activeWorkflowId, 'wf_quickfix');
  assert.equal(rc.webUiTesting.startCommand, 'npm run dev', 'unknown key preserved via project_config.extra');
});

test('listAllPipelines() surfaces the migrated run tagged with its project', async () => {
  const all = await listAllPipelines();
  const row = all.find((p) => p.id === RUN_ID);
  assert.ok(row, 'migrated pipeline appears in the cross-project history');
  assert.equal(row.projectName, 'Repo A', 'project name resolved from store_meta');
  assert.equal(row.status, 'done');
});

test('listPipelines() + readPipelineByKey() return the migrated run, steps, clarify, review, audit', async () => {
  const keyA = projectKey(repoA);
  const list = await listPipelines(repoA);
  const row = list.find((p) => p.id === RUN_ID);
  assert.ok(row, 'migrated pipeline listed');
  assert.equal(row.totalCostUsd, 0.42);
  assert.equal(row.totalActiveMs, 5000);
  assert.equal(row.branch, 'worca-cc/add-login-abcd1234');
  assert.equal(row.sourceBranch, 'main');

  const detail = await readPipelineByKey(keyA, RUN_ID);
  assert.ok(detail, 'readPipelineByKey resolves the run');
  assert.equal(detail.state.title, 'Add login');
  assert.equal(detail.state.status, 'done');
  assert.equal(detail.state.prompt, '# Add login\n', 'prompt.md body -> pipelines.prompt');
  assert.equal(detail.state.steps.length, 2, 'reconstructed steps in state');
  // audit moved from pipeline.md into pipeline_events -> surfaced as auditMarkdown
  assert.match(detail.auditMarkdown, /Add login|created|done/i);
  assert.match(detail.auditMarkdown, /## Timeline/, 'rebuilt audit reproduces the timeline header');

  // steps normalized into pipeline_steps (raw-row check)
  const steps = prepare('SELECT key, status, cost_usd FROM pipeline_steps WHERE pipeline_id = ? ORDER BY step_index').all(RUN_ID);
  assert.equal(steps.length, 2);
  assert.equal(steps[1].cost_usd, 0.22);

  // clarify Q&A moved into the clarify table
  const clar = prepare('SELECT questions, answers FROM clarify WHERE pipeline_id = ?').get(RUN_ID);
  assert.match(clar.questions, /Auth provider/);
  assert.match(clar.answers, /OAuth/);

  // review verdict moved into the reviews table. The importer captures the kind
  // group of <kind>-review-cycleN.json, so impl-review-cycle1.json -> kind 'impl', cycle 1.
  const rev = prepare("SELECT verdict FROM reviews WHERE pipeline_id = ? AND kind = 'impl' AND cycle = 1").get(RUN_ID);
  assert.ok(rev && /summary|ok/.test(rev.verdict), 'impl-review-cycle1.json imported into reviews (kind=impl)');
});

test('agent markdown + extras/ + settings.json remain on the filesystem (NOT deleted by migration)', async () => {
  const keyA = projectKey(repoA);
  const storeA = projectStorePath(keyA);
  assert.ok(existsSync(join(storeA, 'plans', '01-06-26-add-login.md')), 'plan md kept on FS');
  assert.ok(existsSync(join(storeA, 'reviews', '01-06-26-add-login-impl-review.md')), 'review md kept on FS');
  const pdir = join(storeA, 'pipelines', `01-06-26-add-login-${RUN_ID}`);
  assert.ok(existsSync(join(pdir, 'extras', 'mock.png')), 'user attachment kept on FS');
  assert.ok(existsSync(join(pdir, 'prompt.md')), 'prompt.md kept on FS (markdown)');
  assert.ok(existsSync(join(home, '.worca-cc', 'settings.json')), 'bootstrap settings.json untouched');
  // the FROM-DB control-flow JSON should have been MOVED OUT of the live tree:
  assert.equal(existsSync(join(pdir, 'state.json')), false, 'consumed state.json removed from live tree');
  assert.equal(existsSync(join(pdir, 'clarify.json')), false, 'consumed clarify.json removed from live tree');
  assert.equal(existsSync(join(pdir, 'clarify-answers.json')), false, 'consumed clarify-answers.json removed');
  assert.equal(existsSync(join(pdir, 'impl-review-cycle1.json')), false, 'consumed review json removed');
  assert.equal(existsSync(join(pdir, 'pipeline.md')), false, 'consumed pipeline.md removed (now pipeline_events)');
  // the consumed registries are gone from .worca-cc/ too
  assert.equal(existsSync(join(home, '.worca-cc', 'projects.json')), false, 'consumed projects.json moved');
  assert.equal(existsSync(join(home, '.worca-cc', 'workspaces.json')), false, 'consumed workspaces.json moved');
});

test('a backup-<ts>/ archive of the consumed legacy JSON was created', async () => {
  const md = join(home, '.worca-cc');
  const entries = await readdir(md, { withFileTypes: true });
  const backups = entries.filter((e) => e.isDirectory() && /^backup-/.test(e.name)).map((e) => e.name);
  assert.equal(backups.length, 1, 'exactly one backup-<ts>/ dir created');
  // the registries + the consumed pipeline state should be mirrored under it
  const archived = await readFile(join(md, backups[0], 'projects.json'), 'utf8').catch(() => '');
  assert.match(archived, /Repo A/, 'projects.json archived into the backup');
  assert.ok(existsSync(join(md, backups[0], 'workspaces.json')), 'workspaces.json archived');
  // the per-project config (outside home) lands under project-config/<key>/
  const keyA = projectKey(repoA);
  assert.ok(existsSync(join(md, backups[0], 'project-config', keyA, 'config.json')),
    'per-project config.json archived under project-config/<key>/');
  // settings.json must NOT be in the backup (it was never consumed)
  assert.equal(existsSync(join(md, backups[0], 'settings.json')), false, 'settings.json was not archived');
});

test('re-open is a count-guard NO-OP (no second backup; counts unchanged)', async () => {
  const before = (db) => ({
    projects: db.prepare('SELECT COUNT(*) AS c FROM projects').get().c,
    pipelines: db.prepare('SELECT COUNT(*) AS c FROM pipelines').get().c,
    reviews: db.prepare('SELECT COUNT(*) AS c FROM reviews').get().c,
  });
  const snapBefore = before(getDb());

  // Drop the singleton and re-open against the SAME home: the legacy JSON is now
  // archived (gone from the live tree) AND the DB already holds rows, so the
  // count-guard makes maybeMigrateFromFs a no-op — no new backup, counts identical.
  _resetForTests();
  const db2 = getDb();
  const snapAfter = before(db2);
  assert.deepEqual(snapAfter, snapBefore, 'row counts unchanged after re-open');

  const md = join(home, '.worca-cc');
  const entries = await readdir(md, { withFileTypes: true });
  const backups = entries.filter((e) => e.isDirectory() && /^backup-/.test(e.name));
  assert.equal(backups.length, 1, 'still exactly one backup dir (no second archive)');
});
