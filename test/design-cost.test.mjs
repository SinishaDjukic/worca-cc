// test/design-cost.test.mjs — the per-agent cost meter, worca's caps and the per-process budget flag (Design P2 Task 5).
// Settings live under HOME (settings.mjs `settingsFile`), so the file sandboxes HOME and USERPROFILE as well as
// WORCA_HOME: a bare `node --test` run never reads or writes the real ~/.worca-cc/settings.json.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { fakeGithub } from './helpers/fake-github.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { addProject } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { readTeamPolicyPrefs, writeTeamPolicyPrefs } from '../src/core/config.mjs';
import { normalizePolicyDoc, serializePolicyDoc } from '../src/core/policy/registry.mjs';
import { _testing as ghTesting } from '../src/core/git-free/github.mjs';
import { addGlobalModel, costLimitResetPeriod, setPipelineCostLimitUsd, setTotalCostLimitUsd, updateGlobalModel } from '../src/core/settings.mjs';
import { createAgentMeter, processBudgetUsd, readDesignCaps, isListPriced } from '../src/core/design/cost.mjs';

useTempHome(after);
const ENV_KEYS = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_BROKER_URL'];
const prevEnv = {};
const dirs = [];
before(async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-design-cost-home-'));
  dirs.push(home);
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  delete process.env.WORCA_BROKER_URL;
});
after(async () => {
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const M = 'claude-sonnet-5-5';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
const u = (messageId, phase, usage) => ({ type: 'usage', messageId, parentId: null, phase, usage });
const res = (costUsd, extra = {}) => ({ type: 'result', costUsd, cumulativeCost: true, sessionId: 's', ...extra });

test('usage is per message and per field at its peak, never summed across phases', () => {
  const m = createAgentMeter({ model: M, costCfg: null });
  m.observe(u('m1', 'start', { input_tokens: 1000, output_tokens: 4 }));
  m.observe(u('m1', 'delta', { input_tokens: 1000, output_tokens: 500 }));
  m.observe(u('m1', 'message', { input_tokens: 1000, output_tokens: 4 }));
  near(m.snapshot().estimatedUsd, 0.007);
  m.observe(u('m2', 'start', { input_tokens: 2000, output_tokens: 100 }));
  const s = m.snapshot();
  near(s.estimatedUsd, 0.012);
  assert.equal(s.costUsd, null, 'blank until a result: the panel shows >=$x');
  assert.deepEqual(s.tokens, { in: 3000, out: 600, cr: 0, cw: 0 });
});
test('a sub-agent usage event, and one with no usage object, are ignored', () => {
  const m = createAgentMeter({ model: M, costCfg: null });
  m.observe({ ...u('m1', 'start', { input_tokens: 1000 }), parentId: 'toolu_1' });
  assert.equal(m.snapshot().tokens.in, 0);
  m.observe(u('m2', 'start', null)); m.observe(u('m3', 'start', { input_tokens: 1000 }));
  near(m.snapshot().estimatedUsd, 0.002);
});
test('result books the running total, then the estimate retires', () => {
  const m = createAgentMeter({ model: M, costCfg: null });
  m.observe(u('m1', 'start', { input_tokens: 1000 }));
  near(m.observe(res(0.02)), 0.02);
  assert.equal(m.snapshot().estimatedUsd, 0);
  near(m.snapshot().costUsd, 0.02);
});
test('a resumed process books only the difference', () => {
  const m = createAgentMeter({ model: M, costCfg: null, priorUsd: 0.02 });
  near(m.observe(res(0.05)), 0.03);
  near(m.observe(res(0.06)), 0.01);
});
test('killed before result books priced usage once; the next running total nets it out', () => {
  const m = createAgentMeter({ model: M, costCfg: null });
  m.observe(u('m1', 'delta', { input_tokens: 1000, output_tokens: 500 }));
  near(m.settleCut(), 0.007);
  assert.equal(m.settleCut(), null);
  near(m.sessionTotalUsd(), 0.007);
  near(m.observe(res(0.05)), 0.043);
  near(m.snapshot().costUsd, 0.05);
});
test('sessionUsd seeds the running total of the session a resume continues, apart from the booked total', () => {
  // A lost session replaced by a fresh one: $0.25 booked before, $0.25 by the session the next --resume continues.
  const m = createAgentMeter({ model: M, costCfg: null, priorUsd: 0.5, sessionUsd: 0.25 });
  near(m.sessionTotalUsd(), 0.25);
  near(m.snapshot().costUsd, 0.5, 'the booked total is every session together');
  near(m.observe(res(0.5)), 0.25, 'only what this session added since');
  near(m.snapshot().costUsd, 0.75);
  near(m.sessionTotalUsd(), 0.5);
  const fresh = createAgentMeter({ model: M, costCfg: null, priorUsd: 0.5, sessionUsd: 0 });
  near(fresh.observe(res(0.1)), 0.1, 'a session with nothing booked yet books its whole total');
  near(createAgentMeter({ model: M, costCfg: null, priorUsd: 0.5 }).sessionTotalUsd(), 0.5, 'one session: priorUsd is its total');
  for (const bad of [-1, NaN, null, 'x']) near(createAgentMeter({ model: M, costCfg: null, priorUsd: 0.5, sessionUsd: bad }).sessionTotalUsd(), 0);
});
test('a lower figure books nothing and becomes the baseline', () => {
  const m = createAgentMeter({ model: M, costCfg: null, priorUsd: 0.05 });
  assert.equal(m.observe(res(0.03)), 0);
  near(m.observe(res(0.04)), 0.01);
});
test('a kill with no usage books nothing; a kill with no rates makes the cost unknown', () => {
  assert.equal(createAgentMeter({ model: M, costCfg: null }).settleCut(), null);
  const m = createAgentMeter({ model: 'mock', costCfg: null });
  m.observe(u('m1', 'start', { input_tokens: 10 }));
  assert.equal(m.snapshot().estimatedUsd, null);
  assert.equal(m.settleCut(), null);
  assert.equal(m.snapshot().costKnown, false);
});
test('a result with no cost is unknown, never $0', () => {
  const m = createAgentMeter({ model: M, costCfg: null });
  assert.equal(m.observe({ type: 'result', sessionId: 's' }), null);
  assert.equal(m.snapshot().costKnown, false);
});
test('cost overrides: free books 0, perMtok reprices from the result usage', () => {
  assert.equal(createAgentMeter({ model: 'x', costCfg: { free: true } }).observe(res(5)), 0);
  const per = createAgentMeter({ model: 'x', costCfg: { perMtok: { input: 1, output: 1 } } });
  near(per.observe(res(5, { usage: { input_tokens: 1e6, output_tokens: 0 } })), 1);
});
test('the session model prices when no model was configured', () => {
  const m = createAgentMeter({ model: null, costCfg: null });
  m.observe({ type: 'session', sessionId: 's', model: M, init: true });
  m.observe(u('m1', 'start', { input_tokens: 1000 }));
  near(m.snapshot().estimatedUsd, 0.002);
});
test('M13: no per-run cap set in Settings means no flag; Design has no cap of its own', () => {
  assert.equal(processBudgetUsd({ remainingUsd: null, sessionTotalUsd: 0, listPriced: true }), null);
  assert.equal(processBudgetUsd({ remainingUsd: null, sessionTotalUsd: 1.5, listPriced: true }), null);
  assert.equal(processBudgetUsd({ remainingUsd: 12, sessionTotalUsd: 0, listPriced: true }), 12);
});
test('processBudgetUsd counts the whole session, floors at a cent, and is withheld off list price', () => {
  assert.equal(processBudgetUsd({ remainingUsd: 5, sessionTotalUsd: 1.5, listPriced: true }), 6.5);
  assert.equal(processBudgetUsd({ remainingUsd: -1, sessionTotalUsd: 0, listPriced: true }), 0.01);
  assert.equal(processBudgetUsd({ remainingUsd: 5, sessionTotalUsd: 1.5, listPriced: false }), null);
});
test('readDesignCaps with no project and no Settings caps', async () => {
  assert.deepEqual(await readDesignCaps({ projectDir: null }), { perRunCapUsd: null, totalCapUsd: null, period: costLimitResetPeriod() });
});

// Rows beyond the plan's snippet: each pins a branch the snippet leaves open.
test('a turn that streams no message id still counts each message once', () => {
  const m = createAgentMeter({ model: M, costCfg: null });
  m.observe(u(null, 'start', { input_tokens: 1000 }));
  m.observe(u(null, 'delta', { input_tokens: 1000, output_tokens: 500 }));
  m.observe(u(null, 'start', { input_tokens: 1000 }));
  near(m.snapshot().estimatedUsd, 0.009);
  assert.deepEqual(m.snapshot().tokens, { in: 2000, out: 500, cr: 0, cw: 0 });
});
test('the cache-write buckets peak per message too, so a 1-hour write keeps its own rate', () => {
  const m = createAgentMeter({ model: M, costCfg: null });
  const cw = { cache_creation_input_tokens: 1000, cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 0 } };
  m.observe(u('m1', 'start', cw));
  m.observe(u('m1', 'delta', cw));
  near(m.snapshot().estimatedUsd, 1000 * 4 / 1e6);
});
test('tokens survive the result and the cut that retire their estimate; the session model prices the cut', () => {
  const m = createAgentMeter({ model: null, costCfg: null });
  m.observe({ type: 'session', sessionId: 's', model: M });
  m.observe(u('m1', 'start', { input_tokens: 1000, cache_read_input_tokens: 50 }));
  assert.equal(m.settleCut(), null, 'only the init session event names the model: nothing to price');
  assert.equal(m.snapshot().costKnown, false);
  const c = createAgentMeter({ model: M, costCfg: null });
  c.observe({ type: 'session', sessionId: 's', model: 'mock', init: true });
  c.observe(u('m1', 'start', { input_tokens: 1000 }));
  near(c.snapshot().estimatedUsd, 0.002, 'the configured model wins over the session init');
  const n = createAgentMeter({ model: null, costCfg: null });
  n.observe({ type: 'session', sessionId: 's', model: M, init: true });
  n.observe(u('m1', 'start', { input_tokens: 1000, cache_read_input_tokens: 50 }));
  near(n.observe(res(0.01)), 0.01);
  n.observe(u('m2', 'start', { input_tokens: 1000, cache_creation_input_tokens: 7 }));
  near(n.settleCut(), 0.002 + 7 * 2.5 / 1e6);
  assert.deepEqual(n.snapshot().tokens, { in: 2000, out: 0, cr: 50, cw: 7 });
  assert.equal(n.snapshot().estimatedUsd, 0);
});
test('observe answers undefined for events that carry no cost', () => {
  const m = createAgentMeter({ model: M, costCfg: null });
  assert.equal(m.observe(u('m1', 'start', { input_tokens: 1 })), undefined);
  assert.equal(m.observe({ type: 'session', sessionId: 's', model: M, init: true }), undefined);
  assert.equal(m.observe({ type: 'text', text: 'hi' }), undefined);
  assert.equal(m.observe(null), undefined);
  assert.equal(m.snapshot().costKnown, true);
});
test('a result that is not a running total books its own figure', () => {
  const m = createAgentMeter({ model: M, costCfg: null, priorUsd: 0.05 });
  near(m.snapshot().costUsd, 0.05, 'a resumed row shows what it booked before');
  near(m.observe({ type: 'result', costUsd: 0.02, sessionId: 's' }), 0.02);
  near(m.snapshot().costUsd, 0.07);
  near(m.sessionTotalUsd(), 0.05, 'only a running total moves the baseline');
});
test('a cost override still reprices once the running total nets a cut out', () => {
  const m = createAgentMeter({ model: 'x', costCfg: { perMtok: { input: 1, output: 1 } }, ratesFor: () => ({ input: 1, output: 1 }) });
  m.observe(u('m1', 'start', { input_tokens: 1e6 }));
  near(m.settleCut(), 1);
  near(m.observe(res(0.5, { usage: { input_tokens: 2e6, output_tokens: 0 } })), 2);
  near(m.snapshot().costUsd, 3);
  near(m.sessionTotalUsd(), 0.5, 'the running total took the cut back');
});
test('an engine that reports no cost keeps the cost unknown and books nothing', () => {
  const m = createAgentMeter({ model: M, engine: 'copilot', costCfg: null });
  assert.equal(m.snapshot().costKnown, false);
  m.observe(u('m1', 'start', { input_tokens: 1000 }));
  assert.equal(m.settleCut(), null);
  assert.equal(m.observe(res(0.05)), null);
  assert.equal(m.snapshot().costUsd, null);
  assert.equal(createAgentMeter({ model: M, engine: 'claude', costCfg: null }).snapshot().costKnown, true);
});
test('the default rates are read once per model for the meter\'s life', async () => {
  await addGlobalModel({ id: 'metered', cost: { perMtok: { input: 1, output: 1 } } });
  const m = createAgentMeter({ model: 'metered' });
  m.observe(u('m1', 'start', { input_tokens: 1e6 }));
  near(m.snapshot().estimatedUsd, 1);
  await updateGlobalModel('metered', { cost: { perMtok: { input: 3, output: 3 } } });
  m.observe(u('m2', 'start', { input_tokens: 1e6 }));
  near(m.snapshot().estimatedUsd, 2, 'a Settings edit mid-agent never reprices its open messages');
  const fresh = createAgentMeter({ model: 'metered' });
  fresh.observe(u('m1', 'start', { input_tokens: 1e6 }));
  near(fresh.snapshot().estimatedUsd, 3, 'a new meter reads the edited rates');
});
test('isListPriced: built-ins and a model-less spawn are; an override, a base URL or the broker are not', async () => {
  assert.equal(isListPriced(M), true);
  assert.equal(isListPriced(null), true, 'an unset role runs the CLI default model at list price');
  await addGlobalModel({ id: 'onprem', cost: { free: true } });
  await addGlobalModel({ id: 'routed', env: { ANTHROPIC_BASE_URL: 'https://p' } });
  assert.equal(createAgentMeter({ model: 'onprem' }).observe(res(5)), 0, 'the meter reads the model\'s override by default');
  assert.equal(isListPriced('onprem'), false);
  assert.equal(isListPriced('routed'), false);
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9';
  try {
    assert.equal(isListPriced(M), false);
    assert.equal(isListPriced(null), false, 'every model is routed through the broker');
  } finally { delete process.env.WORCA_BROKER_URL; }
});
test('readDesignCaps reads worca\'s Settings caps and folds a project\'s team policy', async () => {
  await setPipelineCostLimitUsd(5);
  await setTotalCostLimitUsd(20);
  try {
    assert.deepEqual(await readDesignCaps({ projectDir: null }), { perRunCapUsd: 5, totalCapUsd: 20, period: costLimitResetPeriod() });
    const proj = await mkdtemp(join(tmpdir(), 'worca-design-cost-proj-'));
    dirs.push(proj);
    await addProject({ name: 'design-cost', path: proj });
    writeTeamPolicyPrefs(projectKey(proj), {
      present: true, hasOrigin: true, docKnown: true, slug: 'acme/site', headSha: 'abc1234def', delegateTo: null, unknownSchema: false, warnings: [],
      checkedAt: new Date().toISOString(), acks: {},
      doc: { schema: 1, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] }, fields: {
        'cost.pipelineLimitUsd': { kind: 'soft', value: 3, onBreach: 'pause' },
        'cost.totalLimitUsd': { kind: 'soft', value: 12, onBreach: 'pause' },
        'cost.resetPeriod': { kind: 'default', value: costLimitResetPeriod() === 'weekly' ? 'monthly' : 'weekly' },
      } },
    });
    const caps = await readDesignCaps({ projectDir: proj });
    assert.deepEqual(caps, { perRunCapUsd: 3, totalCapUsd: 12, period: costLimitResetPeriod() === 'weekly' ? 'monthly' : 'weekly' });
  } finally {
    await setPipelineCostLimitUsd('');
    await setTotalCostLimitUsd('');
  }
});
test('M2: a team-bound per-run cap that only warns is no per-run cap, as for a run; any other cap binds', async () => {
  const caps = (cap, binding, team) => ({ policy: team ? { home: 'acme/site' } : null, fields: {}, period: 'monthly',
    pipeline: { cap, binding, team }, total: { cap: 12, binding: 'local', team: null } });
  const read = async (c) => (await readDesignCaps({ projectDir: null }, { teamCaps: async () => c })).perRunCapUsd;
  const warns = { kind: 'soft', value: 3, onBreach: 'warn' };
  assert.equal(await read(caps(3, 'team', warns)), null, 'the team binds and only warns: no halt, no --max-budget-usd');
  assert.equal(await read(caps(3, 'team', { kind: 'soft', value: 3, onBreach: 'pause' })), 3);
  assert.equal(await read(caps(3, 'team', { kind: 'soft', value: 3 })), 3, 'no onBreach reads as pause');
  assert.equal(await read(caps(2, 'local', { kind: 'soft', value: 5, onBreach: 'warn' })), 2, 'a tighter cap of the person still binds');
  assert.equal(await read(caps(3, 'team-default', { kind: 'default', value: 3, onBreach: 'warn' })), 3, 'a team default stands in for the own cap');
  assert.equal(await read(caps(null, null, null)), null);
  assert.deepEqual(await readDesignCaps({ projectDir: null }, { teamCaps: async () => caps(3, 'team', warns) }), { perRunCapUsd: null, totalCapUsd: 12, period: 'monthly' });
  let asked = null;
  await readDesignCaps({ projectDir: null }, { teamCaps: async (target, opts) => { asked = [target, opts]; return caps(null, null, null); } });
  assert.deepEqual(asked, [{ projectDir: null }, { discover: false }]);
});
test('M2 through the real fold: a project whose team per-run cap warns has none', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-design-cost-warn-'));
  dirs.push(proj);
  await addProject({ name: 'design-cost-warn', path: proj });
  writeTeamPolicyPrefs(projectKey(proj), {
    present: true, hasOrigin: true, docKnown: true, slug: 'acme/warn', headSha: 'abc1234def', delegateTo: null, unknownSchema: false, warnings: [],
    checkedAt: new Date().toISOString(), acks: {},
    doc: { schema: 1, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] }, fields: {
      'cost.pipelineLimitUsd': { kind: 'soft', value: 3, onBreach: 'warn' },
    } },
  });
  try {
    assert.equal((await readDesignCaps({ projectDir: proj })).perRunCapUsd, null);
    await setPipelineCostLimitUsd(2);
    assert.equal((await readDesignCaps({ projectDir: proj })).perRunCapUsd, 2, 'the own cap is tighter: it binds');
  } finally {
    await setPipelineCostLimitUsd('');
  }
});
// The fake GitHub (in-process fetch over local bare repos, precedent: test/git-free-team-policy.test.mjs) is the only
// way to see which discovery readDesignCaps asks for: a cached policy reads the same under every `discover` value.
test('readDesignCaps discovers over HTTPS a team policy never read, and never runs a Git discovery', async (t) => {
  const gh = await fakeGithub();
  ghTesting.setFetch(gh.fetch);
  t.after(() => { ghTesting.reset(); gh.close(); });
  const root = await mkdtemp(join(tmpdir(), 'worca-design-cost-team-'));
  dirs.push(root);
  const capDoc = serializePolicyDoc(normalizePolicyDoc({ schema: 1, fields: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 2 } } }).doc);
  gh.repo('acme/design-https', { files: { a: '1' } });
  gh.commit('acme/design-https', { branch: 'worca-policy', orphan: true, files: { '.worca-policy/policy.json': capDoc } });
  const https = join(root, 'https');
  mkdirSync(join(https, '.git'), { recursive: true });
  writeFileSync(join(https, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/acme/design-https.git\n');
  await addProject({ name: 'design-https', path: https });
  const restoreGit = withNoGit();
  try {
    assert.deepEqual(await readDesignCaps({ projectDir: https }), { perRunCapUsd: 2, totalCapUsd: null, period: costLimitResetPeriod() },
      'a Folder project without git reads its team policy at the first build, as a Folder run does');
  } finally { restoreGit(); }
  // git present for the second half under any runner (tools/test.mjs exports WORCA_GIT=1; a bare run never probed).
  const prevGit = process.env.WORCA_GIT;
  process.env.WORCA_GIT = '1';
  t.after(() => { if (prevGit === undefined) delete process.env.WORCA_GIT; else process.env.WORCA_GIT = prevGit; });
  const git = join(root, 'git');
  mkdirSync(git);
  execFileSync('git', ['init', '-q', git]);
  execFileSync('git', ['-C', git, 'remote', 'add', 'origin', pathToFileURL(join(root, 'no-such-remote.git')).href]);
  await addProject({ name: 'design-git', path: git });
  assert.deepEqual(await readDesignCaps({ projectDir: git }), { perRunCapUsd: null, totalCapUsd: null, period: costLimitResetPeriod() });
  assert.equal(readTeamPolicyPrefs(projectKey(git)), null, 'a build is no Git run: it never waits on a bounded git discovery');
});
