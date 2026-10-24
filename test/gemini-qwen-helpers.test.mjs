// test/gemini-qwen-helpers.test.mjs — on a Gemini CLI or Qwen Code run worca's helper jobs (title, night decider) run on
// Claude (model-env.mjs helperEngineFor): Claude's engine, no gemini/qwen bin, never the run's model. The Test button on
// one of their models runs in a scratch cwd and names that CLI's sign-in when it is signed out.
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
import { testModel } from '../src/core/model-test.mjs';
import { GEMINI_SIGNED_OUT_HINT } from '../src/core/engines/gemini.mjs';
import { QWEN_SIGNED_OUT_HINT } from '../src/core/engines/qwen.mjs';
import { fakeGemini, fakeQwen } from './helpers/fake-gemini-family.mjs';

useTempHome(after);
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const home = mkdtempSync(join(tmpdir(), 'worca-gq-helpers-home-'));
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
});
const writeUser = (obj) => { mkdirSync(join(home, '.worca-cc'), { recursive: true }); writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify(obj)); };
beforeEach(() => writeUser({}));

const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const ENGINES = [
  { engine: 'gemini', fake: fakeGemini, hint: GEMINI_SIGNED_OUT_HINT, signedOut: { lines: [{ type: 'init', session_id: 's' }, { type: 'result', status: 'error', error: { type: 'unknown', message: 'API key not valid. Please pass a valid API key.' } }], exit: 1 } },
  { engine: 'qwen', fake: fakeQwen, hint: QWEN_SIGNED_OUT_HINT, signedOut: { lines: [{ type: 'result', subtype: 'error_during_execution', is_error: true, error: { message: 'No auth type is selected.' } }], exit: 1 } },
];

for (const { engine, fake, hint, signedOut } of ENGINES) {
  test(`${engine}: the title runs on Claude with no ${engine} bin and no run model`, () => {
    const o = createOrchestrator({ projectDir: `/tmp/${engine}-helpers`, claude: { mock: true, engine, bin: `/nonexistent/${engine}`, model: `my-${engine}-m` } });
    const t = o._titleGenOpts();
    assert.equal(t.engine, 'claude');
    assert.equal(t.bin, undefined);
    assert.equal(t.runModel, null);
  });

  test(`${engine}: a mock run puts agent nodes on ${engine} and the title spawn on Claude`, { timeout: 120000 }, async () => {
    const titles = [];
    mockSpawnLog.length = 0;
    const orch = createOrchestrator({
      projectDir: gitDir(`${engine}-run`), prompt: 'Add a settings page', auto: true,
      claude: { mock: true, engine, bin: `/nonexistent/${engine}` },
      titleRunClaude: async (o) => { titles.push(o); return { text: 'Add a settings page' }; },
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', res.error);
    assert.ok(mockSpawnLog.some((s) => s.engine === engine), JSON.stringify(mockSpawnLog));
    for (const t of titles) { assert.ok(!t.engine || t.engine === 'claude', JSON.stringify(t.engine)); assert.equal(t.bin, undefined); }
  });

  test(`${engine}: the night decider runs on Claude, never the run's model`, async () => {
    await addGlobalModel({ id: `my-${engine}-d`, engine });
    const seen = [];
    const o = createOrchestrator({ projectDir: `/tmp/${engine}-helpers`, claude: { mock: false, engine, bin: `/nonexistent/${engine}`, model: `my-${engine}-d` },
      nightRunClaude: async (opts) => { seen.push(opts); return { text: '{"decisions":[]}' }; } });
    Object.assign(o, { state: { subAgents: [], steps: [] }, _upsertSubAgent: () => {}, _subAgentTransition: () => {},
      _recordCost: () => {}, _nightPlanPaths: async () => [], _runningStepKeys: () => [] });
    await o._nightAnalyze([{ id: 'q1', question: '?', options: ['a', 'b'] }], { kind: 'clarify' });
    assert.equal(seen.length, 1);
    assert.ok(!seen[0].engine || seen[0].engine === 'claude', seen[0].engine);
    assert.equal(seen[0].bin, undefined);
    assert.notEqual(seen[0].model, `my-${engine}-d`);
  });

  test(`${engine}: the Test button runs in a scratch cwd, removed after; signed out names the CLI's sign-in`, POSIX, async () => {
    const dir = mkdtempSync(join(tmpdir(), `worca-${engine}-test-bin-`));
    try {
      const ok = fake(dir, 'OK');
      assert.deepEqual(await testModel(`my-${engine}-t`, { engine, bin: ok.bin }), { ok: true, text: 'OK' });
      const cwd = ok.record().cwd;
      assert.notEqual(cwd, process.cwd());
      assert.equal(existsSync(cwd), false, 'the scratch cwd is gone');
      assert.equal(ok.args()[ok.args().indexOf('--model') + 1], `my-${engine}-t`);
      const out = fake(mkdtempSync(join(dir, 'b-')), null, signedOut);
      const bad = await testModel(`my-${engine}-t`, { engine, bin: out.bin });
      assert.equal(bad.ok, false);
      assert.equal(bad.errorClass, 'auth');
      assert.equal(bad.hint, hint);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
