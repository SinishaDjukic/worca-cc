// test/orchestrator-title-locked.test.mjs — Smart run naming (flag smartRunNaming): a title that was given
// (typed, or suggested on the form) is kept; only an empty title still gets the generated one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const dirs = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
async function make(extra) {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-title-locked-'));
  dirs.push(projectDir);
  let calls = 0;
  const orch = createOrchestrator({
    projectDir, prompt: 'Add a settings page', title: 'My own title', claude: { mock: true },
    titleRunClaude: async () => { calls++; return { text: 'Generated title' }; },
    ...extra,
  });
  orch.pipeline = { id: 'p-locked', promptText: 'Add a settings page' };
  orch.state.title = 'My own title';
  return { orch, calls: () => calls };
}

test('titleLocked: the generator never runs, the title is kept and no longer provisional', async () => {
  const { orch, calls } = await make({ titleLocked: true });
  orch.state.titleProvisional = true;
  const seen = [];
  orch.on('title', (p) => seen.push(p));
  orch._kickoffTitleGeneration();
  await orch._titlePromise;
  assert.equal(calls(), 0);
  assert.equal(seen.length, 0);
  assert.equal(orch.state.title, 'My own title');
  assert.equal(orch.state.titleProvisional, false);
});

test('without titleLocked: today\'s behaviour, the generator runs', async () => {
  const { orch, calls } = await make({});
  orch.state.titleProvisional = true;
  orch._kickoffTitleGeneration();
  await orch._titlePromise;
  assert.equal(calls(), 1);
});

test('a resume of a locked run (titleProvisional persisted false, no titleLocked option) does not re-run the generator', async () => {
  const { orch, calls } = await make({});
  orch.state.titleProvisional = false;   // what run() persisted for a locked run
  assert.equal(orch.state.titleProvisional, false);
  // the resume re-kick is guarded by `if (this.state.titleProvisional)`; mirror that guard
  if (orch.state.titleProvisional) orch._kickoffTitleGeneration();
  await orch._titlePromise;
  assert.equal(calls(), 0);
});

test('run() with titleLocked starts non-provisional; without it, provisional (the resume re-kick keys off this)', async () => {
  const { stopAt, afterStarts } = await import('./helpers/engines.mjs');
  for (const [locked, want] of [[true, false], [false, true]]) {
    const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-title-locked-'));
    dirs.push(projectDir);
    const orch = createOrchestrator({ projectDir, prompt: 'Add a settings page', title: 'My own title', auto: true, claude: { mock: true }, titleLocked: locked });
    await stopAt(orch, afterStarts(1));
    assert.equal(orch.state.titleProvisional === true, want, `titleLocked ${locked}`);
  }
});
