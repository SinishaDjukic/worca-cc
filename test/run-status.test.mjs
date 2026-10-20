// test/run-status.test.mjs — §5a.7: the CLI's run status and Ask Worca's run answer say what the UI model says.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
useTempHome(after);
let home;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-runstatus-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
});
after(async () => { await rm(home, { recursive: true, force: true }); });

const dirs = [];
async function recordRun({ pauseAt = null } = {}) {
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const projectDir = gitDir('runstatus');
  dirs.push(projectDir);
  const orch = createOrchestrator({ projectDir, workflowId: 'wf_default', prompt: 'status probe', claude: { mock: true }, auto: false });
  orch.on('question', (q) => setImmediate(() => orch.answer(q.id, q.kind === 'gate' ? { decision: 'continue' } : { answers: [] })));
  // pause(by) records an actor, never a pauseReason, so the line reads "Build · paused".
  if (pauseAt) orch.on('exec', (e) => { if (e.status === 'start' && e.agentKey === pauseAt) orch.pause(); });
  await orch.run();
  return orch.getState().id;
}

function cliStateLine(id) {
  const r = spawnSync(process.execPath, [CLI, 'runs', id], { env: { ...process.env, NO_COLOR: '1' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return (/^\s+state\s+(.+)$/m.exec(r.stdout) || [])[1];
}

test('one recorded run, three surfaces, one status line', { timeout: 300000 }, async (t) => {
  const { runModel } = await import('../src/shared/run-model.mjs');
  const { readPipelineStateById, readPrState, persistPrState } = await import('../src/core/artifacts.mjs');
  const { runStatusLine } = await import('../src/core/run-status.mjs');
  const { createAskTools } = await import('../src/core/ask/tools.mjs');
  const { defaultToolDeps } = await import('../src/core/ask/tool-deps.mjs');
  const tools = createAskTools(defaultToolDeps({ threadId: null }));

  const paused = await recordRun({ pauseAt: 'implementer' });
  const done = await recordRun();
  t.after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }))));
  persistPrState(done, { url: 'https://github.com/acme/app/pull/12', number: 12, state: 'OPEN' });

  for (const [id, want] of [[paused, 'Build · paused'], [done, 'In review · PR #12']]) {
    const ui = runModel({ ...readPipelineStateById(id), pr: readPrState(id) }).line;
    assert.equal(ui, want, 'the UI model on the REST state');
    assert.equal(runStatusLine(id), ui, 'src/core/run-status.mjs');
    assert.equal(cliStateLine(id), ui, 'worca runs ID');
    assert.equal((await tools.call('get_run', { id })).statusLine, ui, "Ask Worca's get_run");
  }
});
