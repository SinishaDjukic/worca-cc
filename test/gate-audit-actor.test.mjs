// test/gate-audit-actor.test.mjs — 6.3: a loop gate's audit line names who chose, not always "the user",
// and 2.1: a gate answer is exactly {decision: 'another' | 'continue'}.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator, gateAnswer } from '../src/core/orchestrator.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

test('the gate chooser: Away mode, a named person, the --yes run, else the user', () => {
  const orch = createOrchestrator({ projectDir: gitDir('gate-actor'), workflowId: 'wf_default', prompt: 'x', claude: { mock: true } });
  orch._answeredBy.set('gate-a', 'night-mode');
  orch._answeredBy.set('gate-b', 'ana');
  assert.equal(orch._gateChooser('gate-a'), 'Away mode');
  assert.equal(orch._gateChooser('gate-b'), 'ana');
  assert.equal(orch._gateChooser('gate-c'), 'the user');
  const yes = createOrchestrator({ projectDir: gitDir('gate-actor-yes'), workflowId: 'wf_default', prompt: 'x', claude: { mock: true }, auto: true });
  assert.equal(yes._gateChooser('gate-c'), 'the unattended run (--yes)');
});

test('gateAnswer accepts exactly another/continue; anything else leaves the question open', () => {
  assert.deepEqual(gateAnswer({ decision: 'another' }), { decision: 'another' });
  assert.deepEqual(gateAnswer({ decision: 'continue', extra: 1 }), { decision: 'continue' });
  for (const bad of [{}, null, 'continue', { decision: 'Another' }, { decision: 'yes' }, { answer: { decision: 'continue' } }]) {
    assert.equal(gateAnswer(bad), null, JSON.stringify(bad));
  }
});

test('3.6: three state writes failing in a row pause the run instead of running on with a frozen position', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('persist-fail'), workflowId: 'wf_default', prompt: 'x', claude: { mock: true } });
  orch.pipeline = { id: 'p-x', dir: gitDir('persist-fail-dir') };
  orch.state.id = 'p-x';
  orch.state.status = 'running';
  let paused = null;
  orch._pauseFor = (reason, err, o) => { paused = { reason, detail: o?.detail }; return true; };
  orch._persistWrite = async () => { throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); };
  assert.equal(await orch._persist(), false);
  assert.equal(await orch._persist(), false);
  assert.equal(paused, null, 'one or two failures are tolerated');
  assert.equal(await orch._persist(), false);
  assert.equal(paused?.reason, 'error');
  assert.match(paused.detail, /could not save its state 3 times in a row.*ENOSPC/);
  // A write that works again resets the count.
  orch._persistWrite = async () => {};
  paused = null;
  assert.equal(await orch._persist(), true);
  orch._persistWrite = async () => { throw new Error('busy'); };
  await orch._persist();
  assert.equal(paused, null);
});
