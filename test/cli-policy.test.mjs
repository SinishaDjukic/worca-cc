// test/cli-policy.test.mjs
// `worca policy` (team-policy design §12) as a child process against a real bare origin, plus
// the run-entry team-cap refusal and its --past-team-cap / --reason escape.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { makeOrigin, cloneAs, useGitSandbox, git } from './helpers/metrics-git.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { addProject } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeTeamPolicyPrefs } from '../src/core/config.mjs';
import { recordCostDelta } from '../src/core/cost-budget.mjs';
import { readPolicyState } from '../src/core/policy/state.mjs';
import { POLICY_BRANCH, POLICY_FILE } from '../src/core/policy/sync.mjs';

const skip = process.platform === 'win32' ? 'sh / hooks not portable to win32' : false;
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'worca-cc.mjs');
const root = mkdtempSync(join(tmpdir(), 'worca-cli-policy-'));
useGitSandbox(before, after);
const home = useTempHome(after);
after(() => rmSync(root, { recursive: true, force: true }));

function runCli(args, extraEnv = {}) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, WORCA_HOME: home, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => res({ code, out, err }));
  });
}

let bare, dir;
before(async () => {
  bare = makeOrigin(root, 'gateway');
  dir = cloneAs(root, 'm', bare, 'gateway');
  await addProject({ name: 'gateway', path: dir });
});

test('help lists the subcommand; show without a policy exits 0', { skip }, async () => {
  const h = await runCli(['policy', 'help']);
  assert.equal(h.code, 0); assert.match(h.out, /worca policy show/); assert.match(h.out, /--past-team-cap/);
  const top = await runCli(['help']);
  assert.match(top.out, /policy <cmd>/);
  const s = await runCli(['policy', 'show', '--project', dir]);
  assert.equal(s.code, 0, s.err); assert.match(s.out, /no team policy/);
  const j = await runCli(['policy', 'show', '--project', dir, '--json']);
  assert.deepEqual(JSON.parse(j.out).policy, null);
});

test('init --here creates the branch; pull and show read it back', { skip }, async () => {
  const i = await runCli(['policy', 'init', '--here', '--project', dir, '--title', 'Gateway policy']);
  assert.equal(i.code, 0, i.err); assert.match(i.out, /gateway: created/); assert.match(i.out, /protect the worca-policy branch/);
  assert.equal(git(bare, 'rev-list', '--count', POLICY_BRANCH), '1');
  const doc = JSON.parse(git(bare, 'show', `${POLICY_BRANCH}:${POLICY_FILE}`));
  assert.equal(doc.title, 'Gateway policy');
  const p = await runCli(['policy', 'pull', '--project', dir]);
  assert.equal(p.code, 0, p.err); assert.match(p.out, /gateway: policy @/);
  const s = await runCli(['policy', 'show', '--project', dir]);
  assert.equal(s.code, 0, s.err); assert.match(s.out, /team policy gateway/); assert.match(s.out, /sets no fields yet/);
  const bad = await runCli(['policy', 'init', '--project', dir]);
  assert.equal(bad.code, 2); assert.match(bad.err, /--here or --follow/);
});

test('show renders the effective fold; setup lists the gaps and refuses to install without --install', { skip }, async () => {
  writeTeamPolicyPrefs(projectKey(dir), {
    present: true, hasOrigin: true, docKnown: true, slug: 'gateway', headSha: 'abc1234def', delegateTo: null, checkedAt: new Date().toISOString(),
    doc: { schema: 1, title: 'Gateway policy', fields: {
      'cost.pipelineLimitUsd': { kind: 'soft', value: 10, onBreach: 'pause' },
      'plugins.required': { kind: 'soft', value: [{ name: 'acme-jira', marketplace: 'acme/worca-plugins', minVersion: '1.2.0' }] },
    }, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } },
  });
  const s = await runCli(['policy', 'show', '--project', dir]);
  assert.equal(s.code, 0, s.err);
  assert.match(s.out, /Per-pipeline cap \(USD\)\s+team \$10\.00 \(soft\) → \$10\.00 \[team\]/);
  assert.match(s.out, /plugin acme-jira: missing/);
  const setup = await runCli(['policy', 'setup', '--project', dir]);
  assert.equal(setup.code, 0, setup.err);
  assert.match(setup.out, /plugin acme-jira ≥ 1\.2\.0: missing/); assert.match(setup.out, /run again with --install/);
});

test('the run entry refuses on a team total cap and lets --past-team-cap --reason through', { skip }, async () => {
  writeTeamPolicyPrefs(projectKey(dir), {
    present: true, hasOrigin: true, docKnown: true, slug: 'gateway', headSha: 'abc1234def', delegateTo: null, checkedAt: new Date().toISOString(), acks: {},
    doc: { schema: 1, fields: { 'cost.totalLimitUsd': { kind: 'soft', value: 1, onBreach: 'pause', requireReason: true } }, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } },
  });
  const { id } = await seedPipeline(dir, { title: 'spent', status: 'done' });
  recordCostDelta({ pipelineId: id, amountUsd: 1.5, tsMs: Date.now() });
  const r1 = await runCli(['--project', dir, '--prompt', 'x', '--mock'], { WORCA_MOCK: '1' });
  assert.equal(r1.code, 1); assert.match(r1.err, /team total cap reached/); assert.match(r1.err, /--past-team-cap/);
  const r2 = await runCli(['--project', dir, '--prompt', 'x', '--mock', '--past-team-cap'], { WORCA_MOCK: '1' });
  assert.equal(r2.code, 1); assert.match(r2.err, /requires a reason/);
  // A paused run: resume refuses on the team pipeline cap, then records the override.
  writeTeamPolicyPrefs(projectKey(dir), { doc: { schema: 1, fields: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 1 } }, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } } });
  const { id: paused } = await seedPipeline(dir, { title: 'paused', status: 'paused', totalCostUsd: 3,
    resumePoint: { version: 2, kind: 'boundary', stepIndex: 0, stepCycle: [], loopState: {}, bus: null, stepModels: null, workflowId: 'wf_default', plan: null, nodes: [], gate: null, pipelineDir: dir, pausedAt: '2026-06-09T00:00:00Z' } });
  const r3 = await runCli(['resume', paused]);
  assert.equal(r3.code, 1); assert.match(r3.err, /team cost cap reached/);
  const r4 = await runCli(['resume', paused, '--past-team-cap', '--reason', 'demo', '--mock'], { WORCA_MOCK: '1' });
  assert.notEqual(r4.err.includes('team cost cap reached'), true, r4.err);
  assert.deepEqual(readPolicyState(paused).overrides, ['pipeline']);
});
