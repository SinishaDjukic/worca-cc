// test/helpers/metrics-git.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const NO_SIGN = ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'];

/** Pin HOME / USERPROFILE / GIT_CONFIG_GLOBAL into a throwaway directory for this suite. */
export function useGitSandbox(before, after) {
  let home;
  const prev = {};
  before(() => {
    home = mkdtempSync(join(tmpdir(), 'worca-git-sandbox-'));
    for (const k of ['HOME', 'USERPROFILE', 'GIT_CONFIG_GLOBAL']) prev[k] = process.env[k];
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    writeFileSync(join(home, '.gitconfig-empty'), '');
    process.env.GIT_CONFIG_GLOBAL = join(home, '.gitconfig-empty');
  });
  after(() => {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(home, { recursive: true, force: true });
  });
}

export function git(cwd, ...args) {
  const r = spawnSync('git', [...NO_SIGN, ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} (${cwd}): ${r.stderr}`);
  return r.stdout.trim();
}

/** A bare repository acting as `origin`, seeded with a `main` branch. */
export function makeOrigin(root, name) {
  const bare = join(root, 'remotes', `${name}.git`);
  mkdirSync(bare, { recursive: true });
  git(bare, 'init', '--bare', '-q', '-b', 'main');
  const seed = mkdtempSync(join(root, `seed-${name}-`));
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'config', 'user.name', 'seed'); git(seed, 'config', 'user.email', 'seed@t');
  writeFileSync(join(seed, 'README.md'), `# ${name}\n`);
  git(seed, 'add', '-A'); git(seed, 'commit', '-qm', 'init');
  git(seed, 'remote', 'add', 'origin', bare); git(seed, 'push', '-q', 'origin', 'main');
  rmSync(seed, { recursive: true, force: true });
  return bare;
}

/** A developer clone. The dir basename IS the slug for file remotes (§4.3 fallback). */
export function cloneAs(root, machine, bare, name) {
  const dir = join(root, machine, name);
  mkdirSync(dirname(dir), { recursive: true });
  git(dirname(dir), 'clone', '-q', bare, name);
  git(dir, 'config', 'user.name', `${machine} dev`);
  git(dir, 'config', 'user.email', `${machine}@t`);
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

export function branchFiles(bare, branch = 'worca-metrics') {
  const out = spawnSync('git', ['ls-tree', '-r', '--name-only', branch], { cwd: bare, encoding: 'utf8' });
  return out.status === 0 ? out.stdout.trim().split('\n').filter(Boolean).sort() : null;
}

function writeHook(file, body) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

export function rejectAllPushes(bare, message = 'protected branch hook declined') {
  writeHook(join(bare, 'hooks', 'pre-receive'), `echo "${message}" >&2\nexit 1`);
}

/** Failing client-side hooks in a clone's shared hooks dir (husky/lefthook/beads stand-in). */
export function installFailingClientHooks(clone) {
  // reference-transaction fires on fetch / reset --hard / update-ref too (decision 33).
  for (const h of ['pre-commit', 'commit-msg', 'pre-push', 'post-checkout', 'reference-transaction']) {
    writeHook(join(clone, '.git', 'hooks', h), `echo "${h} hook ran" >&2\nexit 1`);
  }
}

/** Push a marker config onto a fresh orphan worca-metrics branch without Worca (for chain tests). */
export function pushRawMarker(root, bare, config) {
  const dir = mkdtempSync(join(root, 'raw-'));
  git(dir, 'init', '-q'); git(dir, 'config', 'user.name', 'raw'); git(dir, 'config', 'user.email', 'raw@t');
  git(dir, 'checkout', '-q', '--orphan', 'worca-metrics');
  mkdirSync(join(dir, '.worca-metrics'));
  writeFileSync(join(dir, '.worca-metrics', 'config.json'), JSON.stringify(config));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'marker');
  git(dir, 'push', '-q', bare, 'worca-metrics');
  rmSync(dir, { recursive: true, force: true });
}

/** Minimal fake finished harness for recordRunMetrics (non-mock, row exists). Used from Step 3. */
export function fakeHarness({ projectDir, runId, status = 'done', workspace = null, members = null }) {
  const now = new Date().toISOString();
  return {
    projectDir, isWorkspace: !!workspace, workspace,
    members: members || [{ projectKey: 'k', projectDir }],
    claude: { mock: false },
    pipeline: { id: runId, dir: null },
    resolved: { template: { id: 'wf_auto', name: 'Auto', version: 2 }, agentKeys: new Set(['planner']) },
    workflowId: 'wf_auto',
    state: {
      id: runId, title: `run ${runId}`, startedAt: now, updatedAt: now, totalActiveMs: 1000, totalCostUsd: 0.5,
      steps: [{ key: 'p:1', nodeId: 'n1', agentKey: 'planner', phase: 'planner', cycle: 1, costUsd: 0.5 }], subAgents: [],
      stepper: { template: { id: 'wf_auto', name: 'Auto' }, graph: { nodes: [{ id: 'n1', uiPhase: 'plan' }] } },
      branch: null, branches: {},
    },
    _metricsIv: { questions: 0, pauses: 0, resumes: 0, lastPauseReason: null, lastPauseDetail: null },
    logs: [],
    _log(source, level, text) { this.logs.push({ source, level, text }); },
  };
}
