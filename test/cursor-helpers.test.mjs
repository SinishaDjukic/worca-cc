// test/cursor-helpers.test.mjs — on a Cursor run worca's helper jobs (title, night decider, Auto classifier) run on
// Claude (model-env.mjs helperEngineFor): Claude's engine, no cursor-agent bin, never the Cursor run's model. The
// memory defrag and the workspace scan are agent nodes of the run and stay on Cursor, with no Claude model.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { mockSpawnLog } from '../src/core/claude-runner.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';
import { WORKSPACE_SCAN_WORKFLOW_ID } from '../src/core/graph/builtin-workflows.mjs';
import { testModel } from '../src/core/model-test.mjs';
import { CURSOR_SIGNED_OUT_HINT } from '../src/core/engines/cursor.mjs';
import { fakeCursor } from './helpers/fake-cursor.mjs';

useTempHome(after);
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const home = mkdtempSync(join(tmpdir(), 'worca-cursor-helpers-home-'));
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
});
const writeUser = (obj) => { mkdirSync(join(home, '.worca-cc'), { recursive: true }); writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify(obj)); };
beforeEach(() => writeUser({}));

const FAKE_BIN = '/nonexistent/cursor-agent-must-not-spawn';
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};

test('title: Claude, no cursor-agent bin, no run model, no sandbox', () => {
  const o = createOrchestrator({ projectDir: '/tmp/cursor-helpers', claude: { mock: true, engine: 'cursor', bin: FAKE_BIN, model: 'my-cursor-m' } });
  const t = o._titleGenOpts();
  assert.equal(t.engine, 'claude');
  assert.equal(t.bin, undefined);
  assert.equal(t.runModel, null);
  assert.equal('sandbox' in t, false);
  // A Claude run keeps its own bin.
  assert.equal(createOrchestrator({ projectDir: '/tmp/cursor-helpers', claude: { mock: true, bin: '/x/claude' } })._titleGenOpts().bin, '/x/claude');
});

test('a mock Cursor run: agent nodes on cursor, the title spawn on Claude with no bin', { timeout: 120000 }, async () => {
  const titles = [];
  mockSpawnLog.length = 0;
  const orch = createOrchestrator({
    projectDir: gitDir('cursor-run'), prompt: 'Add a settings page', auto: true,
    claude: { mock: true, engine: 'cursor', bin: FAKE_BIN },
    titleRunClaude: async (o) => { titles.push(o); return { text: 'Add a settings page' }; },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.ok(mockSpawnLog.some((s) => s.engine === 'cursor'), JSON.stringify(mockSpawnLog));
  assert.ok(titles.length >= 1);
  for (const t of titles) {
    assert.ok(!t.engine || t.engine === 'claude', JSON.stringify(t.engine));
    assert.equal(t.bin, undefined);
    assert.equal('sandbox' in t, false);
  }
});

test('night decider: Claude, no cursor-agent bin, never the Cursor run\'s model', async () => {
  await addGlobalModel({ id: 'my-cursor-m', engine: 'cursor' });
  const seen = [];
  const o = createOrchestrator({ projectDir: '/tmp/cursor-helpers', claude: { mock: false, engine: 'cursor', bin: FAKE_BIN, model: 'my-cursor-m' },
    nightRunClaude: async (opts) => { seen.push(opts); return { text: '{"decisions":[]}' }; } });
  Object.assign(o, { state: { subAgents: [], steps: [] }, _upsertSubAgent: () => {}, _subAgentTransition: () => {},
    _recordCost: () => {}, _nightPlanPaths: async () => [], _runningStepKeys: () => [] });
  await o._nightAnalyze([{ id: 'q1', question: '?', options: ['a', 'b'] }], { kind: 'clarify' });
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].engine || seen[0].engine === 'claude', seen[0].engine);
  assert.equal(seen[0].bin, undefined);
  assert.notEqual(seen[0].model, 'my-cursor-m');
  assert.equal('sandbox' in seen[0], false);
});

test('workspace scan on Cursor: no Claude model reaches a scan node', () => {
  writeUser({ utilityModels: { claude: { workspaceScan: { model: 'claude-haiku-4-5' } } }, titleModel: 'claude-haiku-4-5' });
  const o = createOrchestrator({ projectDir: '/tmp/cursor-helpers', claude: { mock: true, engine: 'cursor' } });
  o.isWorkspace = true;
  o.workflowId = WORKSPACE_SCAN_WORKFLOW_ID;
  assert.equal(o._scanModelPins(), null);
});

test('memory defrag on Cursor: Cursor\'s default unless a model is named at start', async () => {
  writeUser({ memoryDefrag: { model: 'claude-haiku-4-5', effort: 'medium' } });
  const none = createOrchestrator({ projectDir: '/tmp/cursor-helpers', claude: { mock: true, engine: 'cursor' } });
  assert.deepEqual(await none._defragAgentPair(), { pair: null, warning: null });
  await addGlobalModel({ id: 'my-cursor-d', engine: 'cursor' });
  const named = createOrchestrator({ projectDir: '/tmp/cursor-helpers', claude: { mock: true, engine: 'cursor', model: 'my-cursor-d' } });
  const logs = [];
  named.on('log', (l) => logs.push(String(l.text)));
  const r = await named._defragAgentPair();
  assert.equal(r.pair.model, 'my-cursor-d');
  assert.ok(logs.some((t) => /Memory defragment model: my-cursor-d .*\(named at start\)/.test(t)), logs.join('\n'));
});

test('the Test button on a Cursor model: a temp cwd, removed after; a signed-out cursor-agent names its login', POSIX, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cursor-test-bin-'));
  try {
    const fake = fakeCursor(dir, 'OK');
    const ok = await testModel('my-cursor-t', { engine: 'cursor', bin: fake.bin });
    assert.deepEqual(ok, { ok: true, text: 'OK' });
    const cwd = fake.record().cwd;
    assert.notEqual(cwd, process.cwd());
    assert.equal(existsSync(cwd), false, 'the scratch cwd is gone');
    const out = fakeCursor(mkdtempSync(join(dir, 'b-')), null, { fail: 'Authentication required. Please run cursor-agent login' });
    const bad = await testModel('my-cursor-t', { engine: 'cursor', bin: out.bin });
    assert.equal(bad.ok, false);
    assert.equal(bad.errorClass, 'auth');
    assert.equal(bad.hint, CURSOR_SIGNED_OUT_HINT);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
