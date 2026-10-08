// test/opencode-helpers.test.mjs — on an OpenCode run worca's helper jobs (title, night decider) run on Claude
// (model-env.mjs helperEngineFor): Claude's engine, no opencode bin, never the OpenCode run's model. The memory defrag
// is an agent node of the run and stays on OpenCode. The node prompt: OpenCode's fan-out directive and skills hint.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';
import { testModel } from '../src/core/model-test.mjs';
import { fanOutDirective, taskHeader } from '../src/core/phases.mjs';
import { OPENCODE_SIGNED_OUT_HINT, OPENCODE_INVESTIGATOR_AGENT } from '../src/core/engines/opencode.mjs';
import { fakeOpencode } from './helpers/fake-opencode.mjs';

useTempHome(after);
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const home = mkdtempSync(join(tmpdir(), 'worca-opencode-helpers-home-'));
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
});
const writeUser = (obj) => { mkdirSync(join(home, '.worca-cc'), { recursive: true }); writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify(obj)); };
beforeEach(() => writeUser({}));

const FAKE_BIN = '/nonexistent/opencode-must-not-spawn';
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};

test('title: Claude, no opencode bin, no run model', () => {
  const o = createOrchestrator({ projectDir: '/tmp/opencode-helpers', claude: { mock: true, engine: 'opencode', bin: FAKE_BIN, model: 'anthropic/x' } });
  const t = o._titleGenOpts();
  assert.equal(t.engine, 'claude');
  assert.equal(t.bin, undefined);
  assert.equal(t.runModel, null);
});

test('night decider: Claude, no opencode bin, never the OpenCode run\'s model', async () => {
  await addGlobalModel({ id: 'anthropic/oc-m', engine: 'opencode' });
  const seen = [];
  const o = createOrchestrator({ projectDir: '/tmp/opencode-helpers', claude: { mock: false, engine: 'opencode', bin: FAKE_BIN, model: 'anthropic/oc-m' },
    nightRunClaude: async (opts) => { seen.push(opts); return { text: '{"decisions":[]}' }; } });
  Object.assign(o, { state: { subAgents: [], steps: [] }, _upsertSubAgent: () => {}, _subAgentTransition: () => {},
    _recordCost: () => {}, _nightPlanPaths: async () => [], _runningStepKeys: () => [] });
  await o._nightAnalyze([{ id: 'q1', question: '?', options: ['a', 'b'] }], { kind: 'clarify' });
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].engine || seen[0].engine === 'claude', seen[0].engine);
  assert.equal(seen[0].bin, undefined);
  assert.notEqual(seen[0].model, 'anthropic/oc-m');
});

test('memory defrag on OpenCode: OpenCode\'s default unless a model is named at start', async () => {
  writeUser({ memoryDefrag: { model: 'claude-haiku-4-5', effort: 'medium' } });
  const none = createOrchestrator({ projectDir: '/tmp/opencode-helpers', claude: { mock: true, engine: 'opencode' } });
  assert.deepEqual(await none._defragAgentPair(), { pair: null, warning: null });
  await addGlobalModel({ id: 'openai/oc-d', engine: 'opencode' });
  const named = createOrchestrator({ projectDir: '/tmp/opencode-helpers', claude: { mock: true, engine: 'opencode', model: 'openai/oc-d' } });
  assert.equal((await named._defragAgentPair()).pair.model, 'openai/oc-d');
});

test('the Test button on an OpenCode model: a temp cwd, removed after; a missing key names the sign-in', POSIX, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-opencode-test-bin-'));
  try {
    const fake = fakeOpencode(dir, 'OK');
    assert.deepEqual(await testModel('anthropic/oc-t', { engine: 'opencode', bin: fake.bin }), { ok: true, text: 'OK' });
    const cwd = fake.record().cwd;
    assert.notEqual(cwd, process.cwd());
    assert.equal(existsSync(cwd), false, 'the scratch cwd is gone');
    const lines = [{ type: 'error', sessionID: 'ses_x', error: { name: 'ProviderAuthError', data: { providerID: 'anthropic', message: 'Anthropic API key is missing.' } } }];
    const out = fakeOpencode(mkdtempSync(join(dir, 'b-')), null, { lines, exit: 1 });
    const bad = await testModel('anthropic/oc-t', { engine: 'opencode', bin: out.bin });
    assert.equal(bad.ok, false);
    assert.equal(bad.errorClass, 'auth');
    assert.equal(bad.hint, OPENCODE_SIGNED_OUT_HINT);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fan-out on OpenCode: dispatch the worca investigator through the task tool', () => {
  const d = fanOutDirective(true, { engine: 'opencode' });
  assert.match(d, /the `task` tool/);
  assert.ok(d.includes(`subagent_type: "${OPENCODE_INVESTIGATOR_AGENT}"`), d);
  assert.match(d, /READ-ONLY/);
  assert.equal(fanOutDirective(false, { engine: 'opencode' }), '');
});

test('taskHeader on OpenCode: the .agents/skills mount is listed for the agent natively', () => {
  const h = taskHeader({ cwd: '/tmp/x', node: { key: 'planner', engine: 'opencode' }, inputs: { userPrompt: {} } }, 'Plan');
  assert.match(h, /mounted at \.agents\/skills for this run and are listed for you/);
});
