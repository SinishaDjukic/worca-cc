// test/orchestrator-factory-fallback.test.mjs — the factory model defaults on the real orchestrator in mock mode: a
// signed-out Claude install with Copilot roles starts Shaper with one warning per dropped factory default; a user-set
// model that needs the sign-in refuses the start at the engine gate; resume neither re-warns nor refuses.
// It needs the orchestrator and a git dir (no browser, no server).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { readWorkflow, writeGraphWorkflow } from '../src/core/workflows.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';
import { CLAUDE_AUTH_ENV_KEYS, CLAUDE_AUTH_ENV_FLAGS, clearClaudeAuthCache } from '../src/core/preflight.mjs';

useTempHome(after);
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK'];
const prev = {};
let home;
const GW = 'gw-s46';
before(async () => {
  home = mkdtempSync(join(tmpdir(), 'worca-factory-orch-home-'));
  for (const k of KEYS) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  await addGlobalModel({ id: GW, label: 'Copilot Claude Sonnet 4.6', efforts: ['medium', 'high', 'xhigh'], env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' } });
});
after(() => {
  for (const k of KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  rmSync(home, { recursive: true, force: true });
});
/** The user settings file, keeping the routed catalog entry addGlobalModel stored (`models`). */
function writeUser(obj) {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  const file = join(home, '.worca-cc', 'settings.json');
  const models = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).models : undefined;
  writeFileSync(file, JSON.stringify({ ...(models ? { models } : {}), ...obj }));
}

const ROLES_COPILOT = { modelRoles: { claude: { deep: { model: GW, effort: 'medium' }, everyday: { model: GW, effort: 'medium' }, quick: { model: GW } } } };
const authOf = (state) => { const fn = async () => { fn.calls += 1; return { state, source: 'cli', detail: null }; }; fn.calls = 0; return fn; };
const SHAPE = { perspectives: ['product', 'ux', 'qa'] };
const FACTORY_RE = /needs Claude Code sign-in; using /;

/** A mock run; Clarify answers empty (or `onClarify`), plan asks are approved. */
function start(opts = {}, onClarify = null) {
  const dir = opts.projectDir || gitDir('factory-orch');
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: SHAPE, ...opts });
  const logs = []; const execs = [];
  orch.on('log', (l) => logs.push(l));
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => {
    if (q.kind === 'plan') { setImmediate(() => orch.answer(q.id, { decision: 'approve' })); return; }
    if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => (onClarify ? onClarify(q, orch) : orch.answer(q.id, { answers: [] })));
  });
  const done = opts.resume ? orch.resume() : orch.run();
  return { orch, logs, execs, done, dir };
}
const factoryLogs = (h) => h.logs.filter((l) => l.level === 'warn' && FACTORY_RE.test(l.text || '')).map((l) => l.text);

test('signed out, Copilot roles: a Shaper run starts and logs exactly one warning per affected setting', async () => {
  writeUser(ROLES_COPILOT);
  const auth = authOf('signed-out');
  const h = start({ claudeAuth: auth });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  // The Deep thinking role covers Plan Review, so its factory default is never wanted: only the second opinion warns.
  assert.deepEqual(factoryLogs(h), [
    'Second-opinion reviewer: Opus 5.5 needs Claude Code sign-in; using Copilot Claude Sonnet 4.6 · high',
  ]);
  assert.deepEqual(h.orch.getState().warnings.filter((w) => FACTORY_RE.test(w)), factoryLogs(h), 'kept in the run warnings');
  const nc = h.orch.resolved.nodeCtx.n_roles;
  assert.deepEqual([nc.model, nc.effort], [GW, 'medium']);
  assert.deepEqual(nc.roles.product, { effort: 'high', source: 'default', wanted: { model: 'claude-opus-5-5', effort: 'medium' } });
  assert.equal(auth.calls, 1, 'one probe');
});

test('defrag, no role: no model named, the warning names Claude\'s default model', async () => {
  writeUser({});
  const h = start({ workflowId: 'wf_memory_defrag', memoryScope: 'project', shape: undefined, claudeAuth: authOf('signed-out') });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h.orch.resolved.nodeCtx.n_defrag.model, undefined);
  assert.deepEqual(factoryLogs(h), ["Memory defragment: Sonnet 5 needs Claude Code sign-in; using Claude's default model"]);
});

test('defrag, routed Copilot Quick role, signed out: the pair is the Quick role, no factory warning, no refusal', async () => {
  writeUser(ROLES_COPILOT);
  const h = start({ workflowId: 'wf_memory_defrag', memoryScope: 'project', shape: undefined, claudeAuth: authOf('signed-out') });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h.orch.resolved.nodeCtx.n_defrag.model, GW);
  assert.deepEqual(factoryLogs(h), []);
});

test('a mock run with no injected claudeAuth never probes; the Shaper nodes take the roles, the second opinion its factory default', async () => {
  writeUser(ROLES_COPILOT);
  const orch = createOrchestrator({ projectDir: gitDir('factory-orch-noseam'), workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: SHAPE });
  let calls = 0;
  orch._claudeAuth = async () => { calls += 1; return { state: 'signed-out', source: 'cli', detail: null }; };
  assert.equal(orch._resolveClaudeAuth(), undefined);
  orch.on('question', (q) => setImmediate(() => orch.answer(q.id, q.kind === 'plan' ? { decision: 'approve' } : { answers: [] })));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(calls, 0);
  const nc = orch.resolved.nodeCtx.n_roles;
  assert.deepEqual([nc.model, nc.effort], [GW, 'medium'], 'the Deep thinking role beats the factory default');
  assert.deepEqual(nc.roles.product, { model: 'claude-opus-5-5', effort: 'medium', source: 'template' });
});

test('a saved copy of Shaper on Codex: the factory drop is recorded with source default and prints no warning', async () => {
  writeUser({});
  const saved = await writeGraphWorkflow({ ...structuredClone(await readWorkflow('wf_shape')), id: undefined, name: 'Shaper copy codex', domain: 'coding' });
  const h = start({ workflowId: saved.id, claude: { mock: true, engine: 'codex' }, guardrailsId: 'permissive' });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(h.orch.resolved.nodeCtx.n_roles.wanted, { model: 'claude-sonnet-5-5', effort: 'medium', source: 'default' });
  assert.deepEqual(h.orch.getState().warnings.filter((w) => w.startsWith('Plan Review')), []);
});

test('user-set Opus 5.5 Plan Review step while signed out: the start is refused naming the setting, no execution started', async () => {
  writeUser({ ...ROLES_COPILOT, stepModels: { claude: { planReviewer: { model: 'claude-opus-5-5' } } } });
  const h = start({ claudeAuth: authOf('signed-out') });
  const res = await h.done;
  assert.equal(res.status, 'error');
  assert.match(res.error, /^engine claude: Claude Code isn't signed in, and Models › Step models › Plan Review names Opus 5\.5, which needs it — pick a model routed through a provider on the Models page, or sign in/);
  assert.deepEqual(h.execs.filter((e) => e.agentKey), [], 'no agent ran');
});

test('user-set Second-opinion reviewer while signed out: refused naming Helper jobs › Second-opinion reviewer', async () => {
  writeUser({ ...ROLES_COPILOT, secondOpinionModel: { model: 'claude-opus-5-5' } });
  const h = start({ claudeAuth: authOf('signed-out') });
  const res = await h.done;
  assert.equal(res.status, 'error');
  assert.match(res.error, /Models › Helper jobs › Second-opinion reviewer names Opus 5\.5, which needs it/);
  assert.deepEqual(h.execs.filter((e) => e.agentKey), []);
});

test('signed in: no factory warnings, no refusal', async () => {
  writeUser({ stepModels: { claude: { planReviewer: { model: 'claude-opus-5-5' } } } });
  const h = start({ claudeAuth: authOf('signed-in') });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(factoryLogs(h), []);
  assert.equal(h.orch.resolved.nodeCtx.n_roles.model, 'claude-opus-5-5');
});

test('resume: a paused fallback run keeps its pairs with no new warning lines; an old pinned manifest resumes on its pins', async () => {
  writeUser(ROLES_COPILOT);
  const dir = gitDir('factory-orch-resume');
  let paused = false;
  const h = start({ projectDir: dir, claudeAuth: authOf('signed-out') }, (q, orch) => { if (!paused) { paused = true; orch.pause(); } });
  assert.equal((await h.done).status, 'paused');
  assert.equal(factoryLogs(h).length, 1, 'the second opinion only: the role covers Plan Review');
  const saved = readPipelineForResume(h.orch.getState().id);
  assert.equal(saved.resumePoint.pickWarnings.filter((w) => FACTORY_RE.test(w)).length, 1, 'the resume point carries it');

  const h2 = start({ projectDir: dir, resume: saved, shape: undefined, claudeAuth: authOf('signed-out') });
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(factoryLogs(h2), [], 'not logged again');
  assert.equal(h2.orch.getState().warnings.filter((w) => FACTORY_RE.test(w)).length, 1, 'still in the run warnings');
  assert.equal(h2.orch.resolved.nodeCtx.n_roles.model, GW, 'the manifest pair');

  // A run started before this change: its cell carries the old template pins and resumes on them, signed out or not.
  // No roles here, so the pin is the factory default the old template carried.
  writeUser({});
  const h3 = start({ projectDir: gitDir('factory-orch-resume-old'), claudeAuth: authOf('signed-in') }, (q, orch) => orch.pause());
  assert.equal((await h3.done).status, 'paused');
  const old = readPipelineForResume(h3.orch.getState().id);
  const cell = old.resumePoint.manifest.graph.nodes.find((n) => n.id === 'n_roles');
  cell.config = { ...cell.config, model: 'claude-sonnet-5-5', effort: 'medium' };
  assert.equal(cell.model, 'claude-sonnet-5-5', 'the cell froze the pair at start');
  const h4 = start({ projectDir: h3.dir, resume: old, shape: undefined, claudeAuth: authOf('signed-out') });
  const res4 = await h4.done;
  assert.equal(res4.status, 'done', res4.error);
  assert.equal(h4.orch.resolved.nodeCtx.n_roles.model, 'claude-sonnet-5-5');
});

test('the default sign-in probe asks the binary a spawn would use (WORCA_CLAUDE_BIN)', async () => {
  const bin = join(home, 'fake-claude');
  const asked = join(home, 'fake-claude-asked');
  rmSync(asked, { force: true });
  writeFileSync(bin, `#!/bin/sh\ntouch '${asked}'\necho '{"loggedIn":true}'\n`);
  chmodSync(bin, 0o755);
  const keys = ['WORCA_CLAUDE_BIN', 'WORCA_BROKER_URL', ...CLAUDE_AUTH_ENV_KEYS, ...CLAUDE_AUTH_ENV_FLAGS];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.WORCA_CLAUDE_BIN = bin;
  clearClaudeAuthCache();
  try {
    const orch = createOrchestrator({ projectDir: gitDir('factory-orch'), workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true } });
    assert.equal((await orch._claudeAuth()).state, 'signed-in');
    assert.ok(existsSync(asked), 'the configured binary answered');
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    clearClaudeAuthCache();
  }
});
