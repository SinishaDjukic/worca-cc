// test/git-missing-background.test.mjs — the three loops: no git while git is missing, one tick when it arrives.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { _testing as cap } from '../src/core/git-available.mjs';
import { withNoGit, gitArrives } from './helpers/git-off.mjs';
import { startProjectSyncBackground } from '../src/core/project-sync.mjs';
// Namespaces: P6 deletes the two loop gates, and a missing named export would fail this whole file at link time.
import * as metricsSync from '../src/core/metrics/sync.mjs';
import * as policySync from '../src/core/policy/sync.mjs';
import { _testing as gitSync } from '../src/core/git-sync.mjs';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { addProject } from '../src/core/projects.mjs';

const { startTeamMetricsBackground, _testing: metricsGit } = metricsSync;
const { startTeamPolicyBackground } = policySync;

useTempHome(after);
afterEach(() => { cap.reset(); gitSync.reset(); gitInfo.reset(); metricsGit.reset(); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms = 3000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await wait(10); } };
const counter = () => { const calls = []; return { calls, fn: async (...a) => { calls.push(a); return { ok: false, stdout: '', stderr: 'x', code: 1, timedOut: false }; } }; };

test('background loops', async (t) => {
  withNoGit(t);
  const repo = gitDir('p0-bg');
  await addProject({ name: 'p0bg', path: repo });
  await checkRows([
    { name: 'project sync: no tick work while missing (projects never listed); the flip runs one tick', run: async () => {
      const r = counter(); gitSync.setRunner(r.fn);
      let lists = 0;
      const listProjectsFn = async () => { lists += 1; return [{ key: 'p0bg-00000001', path: repo, exists: true }]; };
      // tickMs far beyond the row: only the start tick and the git flip can run a tick (the git-sync runner gate
      // alone already keeps r at 0, so `lists` is what shows the loop's own gate).
      const stop = startProjectSyncBackground({ tickMs: 60_000, log: () => {}, listProjectsFn });
      await wait(120); assert.deepEqual([lists, r.calls.length], [0, 0]);
      gitArrives(); await until(() => r.calls.length > 0);
      await stop();
    } },
    { name: 'team metrics: no git spawn while missing (discovery runs over HTTPS); the flip runs discovery at once; a stopped loop ignores later flips', run: async () => {
      withNoGit();
      const g = counter(); const i = counter(); metricsGit.setGit(g.fn); gitInfo.setRunner(i.fn);
      const gitCalls = () => g.calls.length + i.calls.filter((c) => c[0] === 'git').length;
      if (typeof metricsSync.metricsLoopCanSync === 'function') assert.equal(metricsSync.metricsLoopCanSync(), false);   // P6 deletes the gate (S5)
      const stop = startTeamMetricsBackground({ log: () => {} });
      await wait(150); assert.equal(gitCalls(), 0);
      gitArrives(); await until(() => i.calls.some((c) => c[0] === 'git'));   // the hourly timer is 30 min away
      stop(); await wait(50);
      const n = gitCalls(); withNoGit(); gitArrives(); await wait(100);
      assert.equal(gitCalls(), n, 'a stopped loop does not wake on a later flip');
    } },
    { name: 'team policy: discovery over HTTPS and onTick while missing; the flip ticks again', run: async () => {
      withNoGit();
      let ticks = 0; const g = counter(); metricsGit.setGit(g.fn);
      if (typeof policySync.policyLoopCanSync === 'function') assert.equal(policySync.policyLoopCanSync(), false);   // P6 deletes the gate (S5)
      const stop = startTeamPolicyBackground({ log: () => {}, onTick: async () => { ticks += 1; } });
      await until(() => ticks === 1); assert.equal(g.calls.length, 0); gitArrives(); await until(() => ticks === 2); stop();
      const n = ticks; withNoGit(); gitArrives(); await wait(100);
      assert.equal(ticks, n, 'a stopped loop does not wake on a later flip');
    } },
  ]);
});
