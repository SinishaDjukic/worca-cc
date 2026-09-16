// test/run-harness-git-timeout.test.mjs
// RunHarness._git is bounded: a git that never comes back is SIGKILLed after
// `timeoutMs` and reported as a failed step, never awaited forever. (A wedged git
// on the stop/teardown path — which ignores the abort signal on purpose — once
// held `npm test` until CI's 30-minute job limit killed it.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunHarness } from '../src/core/run-harness.mjs';

function bareHarness() {
  const h = Object.create(RunHarness.prototype);
  h.projectDir = process.cwd();
  h.abort = new AbortController();
  return h;
}

// A git alias that shells out to node and sleeps: portable (no `sleep` binary
// needed) and independent of any repository state.
const HANG = ['-c', 'alias.worca-hang=!node -e "setTimeout(() => {}, 5000)"', 'worca-hang'];

test('_git kills a git that outlives timeoutMs and reports it as a failed step', async () => {
  const h = bareHarness();
  const t0 = Date.now();
  const r = await h._git(HANG, { timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.equal(r.code, -1);
  assert.match(r.stderr, /git timed out/);
  assert.ok(Date.now() - t0 < 4_000, 'came back on the timeout, not on the 5 s sleep');
});

test('_git with ignoreAbort still honours timeoutMs (the teardown path is bounded too)', async () => {
  const h = bareHarness();
  h.abort.abort();
  const r = await h._git(HANG, { ignoreAbort: true, timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.match(r.stderr, /git timed out/);
});

test('_git: a fast command is unaffected by the bound', async () => {
  const h = bareHarness();
  const r = await h._git(['--version'], { timeoutMs: 30_000 });
  assert.equal(r.ok, true);
  assert.match(r.stdout, /^git version/);
});
