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
import { writeWorkflow } from '../src/core/workflows.mjs';
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
  const wf = await writeWorkflow({
    name: 'Ghost',
    steps: [[{ id: 's0', key: 'planner' }], [{ id: 's1', key: 'ghostAgent' }]],
    feedbacks: [],
  });
  const phases = [];
  const orch = createOrchestrator({ projectDir: proj, prompt: 'demo', workflowId: wf.id, auto: true, claude: { mock: true } });
  orch.on('phase', (p) => phases.push(p));
  orch.on('error', () => {}); // consume the mirrored error event
  const res = await orch.run();
  assert.equal(res.status, 'error');
  assert.match(res.error, /agent "ghostAgent" is not installed \(removed plugin\?\)/);
  assert.equal(res.pipelineDir, null, 'failed BEFORE createPipeline — no pipeline dir, no node ran');
  assert.equal(phases.length, 0, 'not even the preflight phase started');
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

  const wf = await writeWorkflow({ name: 'Sleepy', steps: [[{ id: 's0', key: 'ghostAgent' }]], feedbacks: [] });
  const orch = createOrchestrator({ projectDir: proj, prompt: 'demo', workflowId: wf.id, auto: true, claude: { mock: true } });
  orch.on('error', () => {});
  const res = await orch.run();
  assert.equal(res.status, 'error');
  assert.match(res.error, /agent "ghostAgent" comes from disabled plugin "sleepy-source" — enable it/);
});

test('happy path unaffected: the default workflow still runs to done in mock mode', async () => {
  const orch = createOrchestrator({ projectDir: proj, prompt: 'demo happy', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done');
});
