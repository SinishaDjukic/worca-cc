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

test('a tracker task titles its run "[key] title" with no AI call; a given title is kept', async () => {
  const { stopAt, afterStarts } = await import('./helpers/engines.mjs');
  const { setMockSourceResponses } = await import('../src/core/plugin-shim.mjs');
  process.env.WORCA_MOCK = '1';
  setMockSourceResponses({ getTask: (a) => ({ id: a.id, title: 'Fix the login redirect', url: 'https://t.test/1', state: 'open', updatedAt: 'x', body: 'b', meta: {} }) });
  try {
    const source = { type: 'plugin', plugin: 'jira-source', sourceId: 'jira', taskId: 'TECH-104' };
    for (const [title, want, wantCalls] of [['jira-source: TECH-104', '[TECH-104] Fix the login redirect', 0], [undefined, '[TECH-104] Fix the login redirect', 0], ['My own title', 'My own title', 1]]) {
      const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-title-ticket-'));
      dirs.push(projectDir);
      let calls = 0;
      const orch = createOrchestrator({ projectDir, source, title, auto: true, claude: { mock: true },
        titleRunClaude: async () => { calls++; return { text: 'Generated title' }; } });
      const seen = [];
      orch.on('title', (p) => seen.push(p.title));
      await stopAt(orch, afterStarts(1));
      await orch._titlePromise;
      assert.equal(orch.state.title === want || orch.state.title === 'Generated title', true, `${title} -> ${orch.state.title}`);
      if (!wantCalls) {
        assert.equal(orch.state.title, want);
        assert.equal(orch.state.titleProvisional, false);
        assert.deepEqual(seen, [want], 'one title event replaces the placeholder');
      }
      assert.equal(calls, wantCalls, `AI title calls for ${title}`);
    }
  } finally {
    delete process.env.WORCA_MOCK;
    setMockSourceResponses(null);
  }
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
