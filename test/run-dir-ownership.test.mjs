// test/run-dir-ownership.test.mjs — G19: under the agent pool, a run's own folders (the
// store's pipelines/<run> dir and runs/<id>) belong to the run owner's agent group, which only
// worca and that one agent user are in, so another person's agent cannot edit its verdicts or
// outputs. Their parents are sticky: an agent cannot rename or delete a run folder it does not own.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { agentPool, agentIdentityFor, claimRunDir } from '../src/core/agent-pool.mjs';
import { claimForAgent, claimFileForAgent } from '../src/core/agent-user.mjs';
import { withBillTo } from '../src/core/billing.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const dir = mkdtempSync(join(tmpdir(), 'worca-rundir-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const ENV = {
  WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: '/data/agent-home', WORCA_AGENT_GID: '1001',
  WORCA_AGENT_POOL: 'worca-agent-01,worca-agent-02', WORCA_AGENT_HOMES: '/data/agent-homes',
  WORCA_AGENT_RUN_GIDS: 'worca-agent-01:1101,worca-agent-02:1102',
};
const POSIX = { skip: process.platform === 'win32' ? 'POSIX modes' : false };

test('pool: each pool user carries its own run group; the shared user and a pool without groups do not', () => {
  const file = join(dir, 'agent-pool.json');
  assert.deepEqual(agentPool(ENV).runGids, { 'worca-agent-01': 1101, 'worca-agent-02': 1102 });
  assert.equal(agentIdentityFor('ada@acme.dev', ENV, { file }).runGid, 1101);
  assert.equal(agentIdentityFor('bob@acme.dev', ENV, { file }).runGid, 1102);
  assert.equal(agentIdentityFor('local', ENV, { file }).runGid, undefined, 'the shared agent user has no run group');
  const { WORCA_AGENT_RUN_GIDS: _drop, ...noGroups } = ENV;
  assert.equal(agentIdentityFor('ada@acme.dev', noGroups, { file }).runGid, undefined);
  assert.equal(agentPool({ ...ENV, WORCA_AGENT_RUN_GIDS: 'worca-agent-01:x,bad name:7' }).runGids?.['worca-agent-01'], undefined);
});

test('claimForAgent: run group, setgid 2770 on the run dir, sticky parent; a no-op without a run group', () => {
  const calls = [];
  const fsOps = {
    chownSync: (p, u, g) => calls.push(['chown', p, u, g]),
    chmodSync: (p, m) => calls.push(['chmod', p, m.toString(8)]),
    statSync: () => ({ mode: 0o42770 }),
  };
  claimForAgent('/h/runs/r1', { user: 'worca-agent-01', gid: 1001, runGid: 1101 }, fsOps);
  assert.deepEqual(calls, [
    ['chown', '/h/runs/r1', -1, 1101],
    ['chmod', '/h/runs/r1', '2770'],
    ['chmod', '/h/runs', '3770'],
  ]);
  calls.length = 0;
  claimForAgent('/h/runs/r1', { user: 'worca-agent', gid: 1001 }, fsOps);
  claimForAgent('/h/runs/r1', null, fsOps);
  assert.deepEqual(calls, []);
  // Best effort: a failing chown never throws into the run.
  assert.doesNotThrow(() => claimForAgent('/x', { runGid: 1 }, { ...fsOps, chownSync: () => { throw new Error('EPERM'); } }));
});

test('V10: claimFileForAgent gives a relayed turn\'s MCP config to the agent user\'s own group, 0640; a no-op without one', () => {
  const calls = [];
  const fsOps = { chownSync: (p, u, g) => calls.push(['chown', p, u, g]), chmodSync: (p, m) => calls.push(['chmod', p, m.toString(8)]) };
  claimFileForAgent('/h/tmp/ask/mcp-m1.json', { user: 'worca-agent-01', gid: 1001, runGid: 1101 }, fsOps);
  assert.deepEqual(calls, [['chown', '/h/tmp/ask/mcp-m1.json', -1, 1101], ['chmod', '/h/tmp/ask/mcp-m1.json', '640']]);
  calls.length = 0;
  claimFileForAgent('/x', { user: 'worca-agent', gid: 1001 }, fsOps);
  claimFileForAgent('/x', null, fsOps);
  assert.deepEqual(calls, []);
  assert.doesNotThrow(() => claimFileForAgent('/x', { runGid: 1 }, { ...fsOps, chownSync: () => { throw new Error('EPERM'); } }));
});

test('claimRunDir: the owner of the current run decides the group (real fs, own gid)', POSIX, () => {
  const own = process.getgid();
  const env = { ...ENV, WORCA_AGENT_RUN_GIDS: `worca-agent-01:${own},worca-agent-02:${own}` };
  const runDir = join(dir, 'store', 'k', 'pipelines', 'p1');
  mkdirSync(runDir, { recursive: true });
  withBillTo('ada@acme.dev', () => claimRunDir(runDir, { env, file: join(dir, 'pool2.json') }));
  assert.equal(statSync(runDir).mode & 0o7777, 0o2770);
  assert.equal(statSync(runDir).gid, own);
  assert.ok(statSync(dirname(runDir)).mode & 0o1000, 'pipelines/ is sticky');

  const other = join(dir, 'store', 'k', 'pipelines', 'p2');
  mkdirSync(other, { recursive: true, mode: 0o755 });
  claimRunDir(other, { env, file: join(dir, 'pool2.json') });      // no owner: the shared user, untouched
  assert.equal(statSync(other).mode & 0o7777, 0o755);
});

// The call sites (PR #854 review: reverting each left the suite green): the store's pipeline folder and every
// runs/<id> root a run makes go to the run owner's group, on the real fs with this process's own gid as that group.
async function withPool(fn) {
  const own = process.getgid();
  const env = { ...ENV, WORCA_AGENT_HOME: join(dir, 'agent-home'), WORCA_AGENT_GID: String(own), WORCA_AGENT_RUN_GIDS: `worca-agent-01:${own},worca-agent-02:${own}` };
  const prev = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return await withBillTo('ada@acme.dev', fn); } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

test('G19 call sites: createPipeline and the no-project run root are claimed for the run owner', POSIX, async () => {
  const { createPipeline } = await import('../src/core/artifacts.mjs');
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const projectDir = mkdtempSync(join(dir, 'proj-'));
  const p = await withPool(() => createPipeline(projectDir, { promptText: 'x', sourceType: 'prompt' }));
  assert.equal(statSync(p.dir).mode & 0o7777, 0o2770, 'the store pipeline folder');
  const orch = createOrchestrator({ projectDir });
  orch.pipeline = { id: 'abcd1234', dir: p.dir };
  orch._persist = async () => {};
  await withPool(() => orch._setupNoProjectRoot());
  assert.equal(statSync(orch.runRoot).mode & 0o7777, 0o2770, 'runs/<id> of a no-project run');
});

test('G19 call sites: a detached git run root and a folder run root are claimed for the run owner', POSIX, async () => {
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const prevMode = process.env.WORCA_RUN_ROOT;
  process.env.WORCA_RUN_ROOT = 'detached';
  try {
    const git = createOrchestrator({ projectDir: mkdtempSync(join(dir, 'proj-')), prompt: 'x', claude: { mock: true } });
    git.pipeline = { id: 'detgit01', dir: mkdtempSync(join(dir, 'pipe-')) };
    git.state.id = 'detgit01';
    git._persist = async () => {};
    // Stop right after the claim: no git runs under the pool env.
    git._resolveSingleBranches = async () => { throw new Error('stop after claim'); };
    await withPool(() => git._setupRunRoot()).catch(() => {});
    assert.equal(statSync(git.runRoot).mode & 0o7777, 0o2770, 'runs/<id> of a detached git run');
  } finally {
    if (prevMode === undefined) delete process.env.WORCA_RUN_ROOT; else process.env.WORCA_RUN_ROOT = prevMode;
  }
  const folder = createOrchestrator({ projectDir: mkdtempSync(join(dir, 'fold-')), workMode: 'folder', prompt: 'x', claude: { mock: true } });
  folder.pipeline = { id: 'folder01', dir: mkdtempSync(join(dir, 'pipe-')) };
  folder._persist = async () => {};
  folder._setupFolderMember = async () => ({ workMode: 'folder' });
  await withPool(() => folder._setupFolderRunRoot()).catch(() => {});
  assert.equal(statSync(folder.runRoot).mode & 0o7777, 0o2770, 'runs/<id> of a folder run');
});
