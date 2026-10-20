// test/git-free-team-run-gates.test.mjs — the run / resume entries' team caps without git (P6 Task 10): a Folder run on a
// GitHub team repository whose policy no discovery has read yet discovers it at its own gate (server and CLI) and is refused.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { fakeGithub } from './helpers/fake-github.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { stopAndSettle } from './helpers/stop-and-settle.mjs';
import { addProject } from '../src/core/projects.mjs';
import { recordCostDelta } from '../src/core/cost-budget.mjs';
import { normalizePolicyDoc, serializePolicyDoc } from '../src/core/policy/registry.mjs';
import { _testing as ghTesting } from '../src/core/git-free/github.mjs';

useTempHome(after);   // the spawned CLI inherits WORCA_HOME: it reads this file's projects, runs and cost ledger
const gh = await fakeGithub();
ghTesting.setFetch(gh.fetch);
const root = mkdtempSync(join(tmpdir(), 'worca-gf-gates-'));   // every fixture folder lives here; the CLI's cwd too
let srv, base, mod;
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
before(async () => {
  mod = await import('../ui/server.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (mod) await stopAndSettle(mod.runs);   // a run a broken gate let through: settled before its folder goes
  ghTesting.reset(); gh.close();
  if (srv) await new Promise((r) => srv.close(r));
  rmSync(root, { recursive: true, force: true });
});
const PF = '.worca-policy/policy.json';
const soft = (value) => ({ kind: 'soft', value });
const policyOf = (fields) => ({ 'worca-policy': { [PF]: serializePolicyDoc(normalizePolicyDoc({ schema: 1, fields }).doc) } });
/** A Folder project on github.com/acme/<name> (.git/config written by hand, no git); nothing here discovers its policy. */
async function project(name) {
  const d = mkdtempSync(join(root, `${name}-`));
  mkdirSync(join(d, '.git'));
  writeFileSync(join(d, '.git', 'config'), `[remote "origin"]\n\turl = https://github.com/acme/${name}.git\n`);
  await addProject({ name, path: d });
  return d;
}
function onFake(name, fields) {
  gh.repo(`acme/${name}`, { files: { a: '1' } });
  for (const [branch, files] of Object.entries(policyOf(fields))) gh.commit(`acme/${name}`, { branch, orphan: true, files });
}
async function spentOver(d, usd) { const { id } = await seedPipeline(d, { title: 'spent', status: 'done' }); recordCostDelta({ pipelineId: id, amountUsd: usd, tsMs: Date.now() }); }
const pausedRun = (d) => seedPipeline(d, { title: 'paused', status: 'paused', totalCostUsd: 3,
  branch: { workMode: 'folder', runRootMode: 'detached' }, resumePoint: graphResumePoint({ pipelineDir: d }) });

test('POST /api/run without git: a Folder run on a GitHub team repository whose policy was never read is refused by the team total cap', async (t) => {
  withNoGit(t);
  const d = await project('run-gate');
  onFake('run-gate', { 'cost.totalLimitUsd': soft(1) });
  await spentOver(d, 1.5);
  const r = await post('/api/run', { projectDir: d, prompt: 'x', mock: true });
  const j = await r.json();
  assert.equal(r.status, 403, JSON.stringify(j));
  assert.deepEqual([j.code, j.needsPolicyAck, j.policy?.home], ['team_total', true, 'acme/run-gate']);
});

test('POST /api/resume without git: a paused Folder run whose project policy was never read is refused by the team pipeline cap', async (t) => {
  withNoGit(t);
  const d = await project('resume-gate');
  onFake('resume-gate', { 'cost.pipelineLimitUsd': soft(1) });
  const { id } = await pausedRun(d);
  const r = await post('/api/resume', { pipelineId: id, mock: true });
  const j = await r.json();
  assert.equal(r.status, 403, JSON.stringify(j));
  assert.deepEqual([j.code, j.needsPolicyOverride, j.policy?.home], ['team_pipeline', true, 'acme/resume-gate']);
});

const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
const PRELOAD = new URL('./helpers/fake-github-preload.mjs', import.meta.url).href;
// WORCA_GIT=0 in the child; its GitHub is the preload's own fake. stdin closed: a run past a broken gate stops at its first prompt.
const cli = (args, repos) => spawnSync(process.execPath, ['--import', PRELOAD, CLI, ...args], { cwd: root, encoding: 'utf8', timeout: 60_000,
  stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WORCA_GIT: '0', WORCA_TEST_FAKE_GH: JSON.stringify(repos) } });

test('worca run without git: a Folder run on a GitHub team repository whose policy was never read is refused by the team total cap', async (t) => {
  withNoGit(t);
  const d = await project('cli-run-gate');
  await spentOver(d, 1.5);
  const r = cli(['--mock', '--prompt', 'x', '--project', d], { 'acme/cli-run-gate': policyOf({ 'cost.totalLimitUsd': soft(1) }) });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /^worca: team total cap reached \(\$\d+\.\d\d >= \$1\.00 this month, acme\/cli-run-gate\)\. Continue: add --past-team-cap/m);
});

test('worca resume without git: a paused Folder run whose project policy was never read is refused by the team pipeline cap', async (t) => {
  withNoGit(t);
  const d = await project('cli-resume-gate');
  const { id } = await pausedRun(d);
  const r = cli(['resume', id, '--mock'], { 'acme/cli-resume-gate': policyOf({ 'cost.pipelineLimitUsd': soft(1) }) });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, new RegExp(`^worca: team cost cap reached \\(\\$3\\.00 >= \\$1\\.00, acme/cli-resume-gate\\)\\. Continue: worca resume ${id} --past-team-cap`, 'm'));
});
