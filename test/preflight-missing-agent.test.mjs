// test/preflight-missing-agent.test.mjs
// Spec §9.4: every workflow node key must resolve in the MERGED registry before
// any node executes; a missing key hard-fails the run with an actionable message
// (naming the disabled plugin when one ships the key). Supersedes the silent
// empty-prompt degradation. Mock mode, per-test temp home + throwaway git repo.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { _resetForTests } from '../src/core/db.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { readPluginsLock, writePluginsLock, pluginDir } from '../src/core/plugins-lock.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

const prevHome = process.env.WORCA_HOME;
let home, proj;
beforeEach(async () => {
  _resetForTests();
  home = await mkdtemp(join(tmpdir(), 'worca-cc-preflight-home-'));
  process.env.WORCA_HOME = home;
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-preflight-proj-'));
  await writeFile(join(proj, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: proj });
  execFileSync('git', ['add', '-A'], { cwd: proj });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: proj });
});
afterEach(async () => {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME;
  else process.env.WORCA_HOME = prevHome;
  for (const d of [home, proj]) if (d) await rm(d, { recursive: true, force: true });
});

test('an unknown agent key errors the run BEFORE any pipeline/node work (was: empty-prompt degradation)', async () => {
  const wf = await writeGraphWorkflow({
    id: 'wf_ghost', name: 'Ghost',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 200, y: 0, config: {} },
      { id: 'n_ghost', kind: 'agent', key: 'ghostAgent', x: 400, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} },
    ],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }],
  });
  const execs = [];
  const orch = createOrchestrator({ projectDir: proj, prompt: 'demo', workflowId: wf.id, auto: true, claude: { mock: true } });
  orch.on('exec', (p) => execs.push(p));
  orch.on('error', () => {}); // consume the mirrored error event
  const res = await orch.run();
  assert.equal(res.status, 'error');
  // On the graph engine resolveGraph (workflows.mjs:547) rejects the unknown key
  // BEFORE the harness's _preflightAgentKeys gate can run, so the message is the
  // resolver's. The gate's own two messages are pinned directly below.
  assert.match(res.error, /unknown agent "ghostAgent" — no such key in the registry/);
  assert.equal(res.pipelineDir, null, 'failed BEFORE createPipeline — no pipeline dir, no node ran');
  assert.equal(execs.length, 0, 'not one execution — not even the preflight bookend');
});

test('a key shipped by a DISABLED plugin gets the "enable it" message naming the plugin', async () => {
  const versionDir = join(pluginDir('sleepy-source'), 'versions', 'abc1234');
  mkdirSync(join(versionDir, 'agents'), { recursive: true });
  writeFileSync(join(versionDir, 'agents', 'ghostAgent.md'), '# ghost\n');
  writeFileSync(join(versionDir, 'agents', 'ghostAgent.meta.json'),
    JSON.stringify({ key: 'ghostAgent', agentFile: 'ghostAgent.md', order: 50 }));
  // 'junction' on Windows (a plain/dir symlink needs elevated privileges there);
  // versionDir is absolute, as junctions require. Mirrors plugin-store's swap.
  symlinkSync(versionDir, join(pluginDir('sleepy-source'), 'current'), process.platform === 'win32' ? 'junction' : 'dir');
  writePluginsLock({ ...readPluginsLock(), 'sleepy-source': {
    repo: 'r', subdir: 'sleepy-source', pinnedSha: 'a'.repeat(40),
    version: '0.1.0', enabled: false, installedAt: '2026-07-12T00:00:00.000Z',
  } });

  const wf = await writeGraphWorkflow({
    id: 'wf_sleepy', name: 'Sleepy',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_ghost', kind: 'agent', key: 'ghostAgent', x: 200, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 400, y: 0, config: {} },
    ],
    wires: [],
  });
  const orch = createOrchestrator({ projectDir: proj, prompt: 'demo', workflowId: wf.id, auto: true, claude: { mock: true } });
  orch.on('error', () => {});
  const res = await orch.run();
  assert.equal(res.status, 'error');
  assert.match(res.error, /unknown agent "ghostAgent" — no such key in the registry/);

  // The gate's actionable hint still exists and still names the disabled plugin.
  // FINDING (P8): a saved graph can no longer REACH it — resolveGraph throws
  // first — so the hint now only fires for keys a resolver cannot see.
  const gate = createOrchestrator({ projectDir: proj, prompt: 'demo', claude: { mock: true } });
  gate.registry = {};
  assert.throws(() => gate._preflightAgentKeys(['ghostAgent']),
    /agent "ghostAgent" comes from disabled plugin "sleepy-source" — enable it/);
});

test('_preflightAgentKeys: an unknown key with no plugin gets the "not installed" hint', () => {
  const gate = createOrchestrator({ projectDir: proj, prompt: 'demo', claude: { mock: true } });
  gate.registry = { planner: {} };
  assert.throws(() => gate._preflightAgentKeys(['planner', 'nobodyAgent']),
    /agent "nobodyAgent" is not installed \(removed plugin\?\)/);
});

test('happy path unaffected: the default workflow still runs to done in mock mode', async () => {
  const orch = createOrchestrator({ projectDir: proj, prompt: 'demo happy', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done');
});
