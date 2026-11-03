// test/session-gate.test.mjs — the run says, at start, how each session will run and why.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator, resolvedFromManifest } from '../src/core/orchestrator.mjs';
import { buildGraphManifest } from '../src/shared/graph/manifest.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';
import { HOST_TOOLS_MODE, CHILD_INHERITS_PARENT } from '../src/core/engines/session-dispatch.mjs';
import { HOST_MAIN_THREAD_GUARD, HOST_GUARD_CONTEXT_FIELD, SESSION_SHARED_RUNTIME } from '../src/core/session-host.mjs';

useTempHome(after);
// C34's endpoint check reads the user's models: settings.json lives under $HOME/.worca-cc (as test/cost-cumulative-result.test.mjs).
const home = mkdtempSync(join(tmpdir(), 'worca-sess-gate-home-'));
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(home, { recursive: true, force: true });
});
const SID = 's_aaaaaaaa';
beforeEach(() => { process.env.WORCA_FLAGS = 'sessionGroups'; delete process.env.WORCA_SESSIONS_DISABLE; });
after(() => { delete process.env.WORCA_FLAGS; });
function gateFor({ engine = 'claude', mode, mock = true, settings = {}, pins = {} } = {}) {
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix'));
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
  for (const [id, cfg] of Object.entries(pins)) Object.assign(t.nodes.find((n) => n.id === id).config, cfg);
  t.sessions = { [SID]: { ...(mode ? { mode } : {}), ...settings } };
  if (!Object.keys(t.sessions[SID]).length) delete t.sessions;
  const reg = loadAgentRegistry();
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'worca-sess-gate'), claude: { mock, engine } });
  o._adoptResolvedGraph(resolvedFromManifest(buildGraphManifest(t, reg), reg));
  return o;
}

test('mock claude, flag on: sub-agents, with the tool-union and after-the-fact lines; no inherit line without an explicit hostModel', async () => {
  const o = gateFor();
  const lines = await o._sessionGate();
  assert.deepEqual(o._sessionDecisions.get(SID), { mode: 'subagents', requested: 'subagents', reason: 'ok', firstMemberModel: null });
  assert.equal(lines[0], `session ${SID}: sub-agents on Claude (2 steps: Implementation, Review Implementation; main agent the first step's model)`);
  // v3 — compared to the spike-gated constants Task 53 sets (each side is pinned by the _sessionConstsForTest rows below).
  assert.equal(lines.includes(`session ${SID}: the main agent holds the union of its steps' tool grants`), HOST_TOOLS_MODE === 'union');
  assert.equal(lines.includes(`session ${SID}: the main agent's own tool calls are stopped after the fact, not refused`),
    HOST_TOOLS_MODE === 'union' && !(HOST_MAIN_THREAD_GUARD && HOST_GUARD_CONTEXT_FIELD));
  assert.equal(lines.some((l) => /has no model of its own/.test(l)), false, 'C26');
});

test('C26 — an explicit hostModel is inherited by a bare member, and the line says so', async () => {
  const lines = await gateFor({ settings: { hostModel: 'claude-haiku-4-5' } })._sessionGate();
  assert.equal(lines.some((l) => /has no model of its own, so it runs on the main agent's model \(claude-haiku-4-5\)$/.test(l)), CHILD_INHERITS_PARENT.model === true);
});

test('flag off and a no-sub-agent engine degrade with their reason; the kill switch is one line and no decision (C36)', async () => {
  process.env.WORCA_FLAGS = '';
  assert.deepEqual(await gateFor()._sessionGate(), [`session ${SID}: separate sessions — the Labs flag sessionGroups is off`]);
  process.env.WORCA_FLAGS = 'sessionGroups'; process.env.WORCA_SESSIONS_DISABLE = '1';
  const k = gateFor();
  assert.deepEqual(await k._sessionGate(), ['Sessions disabled by WORCA_SESSIONS_DISABLE=1: every session runs as separate sessions.']);
  assert.equal(k._sessionsDisabled, true);
  assert.equal(k._sessionDecisions.size, 0);
  delete process.env.WORCA_SESSIONS_DISABLE;
  assert.deepEqual(await gateFor({ engine: 'gemini' })._sessionGate(), [`session ${SID}: separate sessions — Gemini CLI has no sub-agents`]);
});

test('M-11 — a real Claude CLI without --forward-subagent-text runs separate, by probe', async () => {
  const o = gateFor({ mock: false });
  const { SESSION_SUBAGENTS_VERIFIED } = await import('../src/shared/engine-switch.mjs');
  o._claudeCaps = async () => ({ version: '2.1.294', forwardSubagentText: false, mcpConfig: true, pluginDir: true });
  o._sessionVerifiedForTest = { ...SESSION_SUBAGENTS_VERIFIED, claude: true };
  assert.deepEqual(await o._sessionGate(), [`session ${SID}: separate sessions — Claude Code 2.1.294 cannot forward sub-agent text`]);
});

test('shared opt-in', async () => {
  // v4 — compared to SESSION_SHARED_RUNTIME, which Task 65 turns on with the shared runtime (both sides pinned below).
  assert.deepEqual(await gateFor({ mode: 'shared' })._sessionGate(), [SESSION_SHARED_RUNTIME
    ? `session ${SID}: one conversation on Claude (2 steps: Implementation, Review Implementation)`
    : `session ${SID}: separate sessions — one conversation is not available yet`]);
});

test('v4 — shared before its runtime exists runs separate, on every engine and past the closed gate; with the runtime it is one conversation', async () => {
  const gate = async (over, consts) => {
    const o = gateFor({ mode: 'shared', ...over });
    o._sessionConstsForTest = consts;
    if (over.mock === false) o._claudeCaps = async () => ({ version: '2.1.200', forwardSubagentText: false });
    return { lines: await o._sessionGate(), d: o._sessionDecisions.get(SID) };
  };
  const off = { mode: 'separate', requested: 'shared', reason: 'one conversation is not available yet', firstMemberModel: null };
  for (const over of [{}, { mock: false }, { engine: 'gemini' }]) {
    const { lines, d } = await gate(over, { sharedRuntime: false });
    assert.deepEqual(d, off, JSON.stringify(over));
    assert.deepEqual(lines, [`session ${SID}: separate sessions — one conversation is not available yet`]);
  }
  const on = await gate({}, { sharedRuntime: true });
  assert.deepEqual(on.d, { mode: 'shared', requested: 'shared', reason: 'chosen in the session settings', firstMemberModel: null });
  assert.deepEqual(on.lines, [`session ${SID}: one conversation on Claude (2 steps: Implementation, Review Implementation)`]);
});

test('the one pin of SESSION_SHARED_RUNTIME: Task 65 built the shared runtime and turned it on, and this pin with it', () => {
  assert.equal(SESSION_SHARED_RUNTIME, true);
});

test('no session: no line, no probe', async () => {
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'worca-sess-gate2'), claude: { mock: false } });
  const reg = loadAgentRegistry();
  o._adoptResolvedGraph(resolvedFromManifest(buildGraphManifest(structuredClone(SEED_TEMPLATES[0]), reg), reg));
  let probes = 0;
  o._claudeCaps = async () => { probes += 1; return { version: '2.1.308', forwardSubagentText: true }; };   // v3: counted (the gate swallows a throw)
  assert.deepEqual(await o._sessionGate(), []);
  assert.equal(probes, 0, 'a run without a session never probes');
});

test('v2 — C26: the first member\'s own model is the main agent\'s default; a member that pins its own gets no inherit line', async () => {
  const o = gateFor({ settings: { hostModel: 'claude-haiku-4-5', hostEffort: 'low' }, pins: { n_impl: { model: 'claude-sonnet-4-6', effort: 'high' } } });
  const lines = await o._sessionGate();
  assert.equal(o._sessionDecisions.get(SID).firstMemberModel, 'claude-sonnet-4-6');
  assert.deepEqual(lines.filter((l) => /of its own/.test(l)), [
    ...(CHILD_INHERITS_PARENT.model ? [`session ${SID}: Review Implementation has no model of its own, so it runs on the main agent's model (claude-haiku-4-5)`] : []),
    ...(CHILD_INHERITS_PARENT.effort ? [`session ${SID}: Review Implementation has no effort of its own, so it runs at the main agent's effort (low)`] : []),
  ]);
  assert.equal(lines[0], `session ${SID}: sub-agents on Claude (2 steps: Implementation, Review Implementation; main agent claude-haiku-4-5)`);
  const p = gateFor({ pins: { n_impl: { model: 'claude-sonnet-4-6' } } });
  await p._sessionGate();
  assert.equal(p._sessionDecisions.get(SID).firstMemberModel, 'claude-sonnet-4-6');
});

test('v2 — the specs the gate resolved are what _engineRun consumes; every line is logged at info', async () => {
  const o = gateFor();
  const logs = []; o.on('log', (l) => logs.push(l));
  const lines = await o._sessionGate();
  assert.deepEqual(o._sessionSpecs.map((x) => [x.sid, x.members]), [[SID, ['n_impl', 'n_review']]]);
  assert.equal(o._sessionsDisabled, false);
  assert.deepEqual(logs.filter((l) => /^session /.test(l.text)).map((l) => [l.level, l.text]), lines.map((l) => ['info', l]));
  process.env.WORCA_SESSIONS_DISABLE = '1';
  const k = gateFor();
  await k._sessionGate();
  assert.deepEqual(k._sessionSpecs.map((x) => x.sid), [SID], 'the kill switch keeps the specs (C42 reads them), builds nothing');
});

test('v2 — a real Claude run reads the shipped gate (compared to the constant: Tasks 53 and 69 flip it)', async () => {
  const { SESSION_SUBAGENTS_VERIFIED } = await import('../src/shared/engine-switch.mjs');
  const o = gateFor({ mock: false });
  o._claudeCaps = async () => ({ version: '2.1.308', forwardSubagentText: true });
  const [line] = await o._sessionGate();
  assert.equal(line, SESSION_SUBAGENTS_VERIFIED.claude
    ? `session ${SID}: sub-agents on Claude (2 steps: Implementation, Review Implementation; main agent the first step's model)`
    : `session ${SID}: separate sessions — sub-agents are not available on Claude yet`);
});

test('v2 — the CLI floor and an unknown version, by probe', async () => {
  const { SESSION_SUBAGENTS_VERIFIED } = await import('../src/shared/engine-switch.mjs');
  const old = gateFor({ mock: false });
  old._claudeCaps = async () => ({ version: '2.1.280', forwardSubagentText: true });
  old._sessionVerifiedForTest = { ...SESSION_SUBAGENTS_VERIFIED, claude: true };
  assert.deepEqual(await old._sessionGate(), [`session ${SID}: separate sessions — Claude Code 2.1.280 is older than 2.1.281`]);
  const none = gateFor({ mock: false });
  none._claudeCaps = async () => { throw new Error('no claude'); };
  none._sessionVerifiedForTest = { ...SESSION_SUBAGENTS_VERIFIED, claude: true };
  assert.deepEqual(await none._sessionGate(), [`session ${SID}: separate sessions — the Claude Code version is unknown`]);
  const ok = gateFor({ mock: false });
  ok._claudeCaps = async () => ({ version: '2.1.281', forwardSubagentText: true });
  ok._sessionVerifiedForTest = { ...SESSION_SUBAGENTS_VERIFIED, claude: true };
  assert.match((await ok._sessionGate())[0], /: sub-agents on Claude \(/);
});

test('v2 — the kill switch with no session says nothing', async () => {
  process.env.WORCA_SESSIONS_DISABLE = '1';
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'worca-sess-gate3'), claude: { mock: true } });
  const reg = loadAgentRegistry();
  o._adoptResolvedGraph(resolvedFromManifest(buildGraphManifest(structuredClone(SEED_TEMPLATES[0]), reg), reg));
  assert.deepEqual(await o._sessionGate(), []);
  assert.equal(o._sessionsDisabled, false);
});

test('v2 — a fresh run audits the gate\'s lines (the call beside the engine gate)', { timeout: 120000 }, async () => {
  const { gitDir } = await import('./helpers/git-dir.mjs');
  const { writeGraphWorkflow } = await import('../src/core/workflows.mjs');
  const { readPipeline } = await import('../src/core/artifacts.mjs');
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix'));
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
  await writeGraphWorkflow({ ...t, id: 'wf_sess_gate', name: 'Sess gate' });
  const o = createOrchestrator({ projectDir: gitDir('sessgate'), workflowId: 'wf_sess_gate', prompt: 'demo', auto: true, claude: { mock: true } });
  assert.equal((await o.run()).status, 'done');
  const audit = (await readPipeline(o.projectDir, o.state.id)).auditMarkdown;
  // v4 — exactly once: a non-Auto fresh run calls the gate beside the engine gate only (the Auto call needs an adopted graph).
  assert.equal(audit.split(`session ${SID}: sub-agents on Claude (2 steps: Implementation, Review Implementation; main agent the first step's model)`).length - 1, 1, audit);
});

test('v2 — C34: a main agent on another endpoint than its steps runs separate (the host\'s env is compared too, untagged)', async () => {
  await addGlobalModel({ id: 'gw-host-model', env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/v1', ANTHROPIC_AUTH_TOKEN: 'sk-test' } });
  assert.deepEqual(await gateFor({ settings: { hostModel: 'gw-host-model' } })._sessionGate(),
    [`session ${SID}: separate sessions — the steps use different model endpoints`]);
  const both = gateFor({ settings: { hostModel: 'gw-host-model' }, pins: { n_impl: { model: 'gw-host-model' }, n_review: { model: 'gw-host-model' } } });
  assert.match((await both._sessionGate())[0], /: sub-agents on Claude \(/, 'one endpoint for all: sub-agents');
});

test('v3 — C40: the after-the-fact line is gone only when the host guard is on AND has a proven field (Task 53 sets both)', async () => {
  const UNION = `session ${SID}: the main agent holds the union of its steps' tool grants`;
  const AFTER = `session ${SID}: the main agent's own tool calls are stopped after the fact, not refused`;
  const linesWith = async (consts) => { const o = gateFor(); o._sessionConstsForTest = consts; return o._sessionGate(); };
  const both = await linesWith({ toolsMode: 'union', mainThreadGuard: true, guardField: 'agent_id' });
  assert.equal(both.includes(UNION), true);
  assert.equal(both.includes(AFTER), false, 'refused before it runs: no after-the-fact line');
  assert.equal((await linesWith({ toolsMode: 'union', mainThreadGuard: true, guardField: null })).includes(AFTER), true, 'a guard without a proven field attaches nothing');
  assert.equal((await linesWith({ toolsMode: 'union', mainThreadGuard: false, guardField: 'agent_id' })).includes(AFTER), true, 'a field without the guard');
  const agentOnly = await linesWith({ toolsMode: 'agent-only', mainThreadGuard: false, guardField: null });
  assert.equal(agentOnly.includes(UNION) || agentOnly.includes(AFTER), false, 'an agent-only host holds no other tool');
});

test('v3 — C26: the inherit lines follow CHILD_INHERITS_PARENT, model and effort apart (S2 sets them)', async () => {
  const linesWith = async (inherits) => {
    const o = gateFor({ settings: { hostModel: 'claude-haiku-4-5', hostEffort: 'low' } });
    o._sessionConstsForTest = { inherits };
    return (await o._sessionGate()).filter((l) => /of its own/.test(l)).map((l) => l.replace(/^.*: (\w+ ?\w*) has no (\w+) of its own.*$/, '$1/$2'));
  };
  assert.deepEqual(await linesWith({ model: true, effort: true }), ['Implementation/model', 'Implementation/effort', 'Review Implementation/model', 'Review Implementation/effort']);
  assert.deepEqual(await linesWith({ model: true, effort: false }), ['Implementation/model', 'Review Implementation/model']);
  assert.deepEqual(await linesWith({ model: false, effort: true }), ['Implementation/effort', 'Review Implementation/effort']);
  assert.deepEqual(await linesWith({ model: false, effort: false }), [], 'without inheritance the line would lie');
});

test('v3 — a fresh Auto run that reuses a workflow with a session resolves it once the workflow is decided', { timeout: 120000 }, async () => {
  const { gitDir } = await import('./helpers/git-dir.mjs');
  const { writeGraphWorkflow } = await import('../src/core/workflows.mjs');
  const { readPipeline } = await import('../src/core/artifacts.mjs');
  const { normalizeShape, assembleShape } = await import('../src/shared/graph/assemble.mjs');
  const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
  const SHAPE = { name: 'Session twin', taskKind: 'prompt', stages: [{ agent: 'planner' }, { agent: 'reviewer' }] };   // no seed has this topology
  const built = assembleShape(normalizeShape(SHAPE), { registry: REG, humanInLoop: false });
  const t = structuredClone(built.template);
  for (const n of t.nodes) if (n.kind === 'agent') n.config = { ...(n.config || {}), session: SID };
  await writeGraphWorkflow({ ...t, id: 'wf_sess_auto', name: 'Sess auto', domain: 'coding' });
  const classify = async (input) => ({ shape: normalizeShape(SHAPE), warnings: [], costUsd: 0.02, usage: { input_tokens: 100, output_tokens: 20 }, attempts: 1, model: input.model || null });
  const o = createOrchestrator({ projectDir: gitDir('sessgate-auto'), workflowId: 'wf_auto', prompt: 'demo', claude: { mock: true }, humanInLoop: false, classify });
  const res = await o.run();
  assert.equal(res.status, 'done', res.error);
  const auto = o.getState().stepper.auto;
  assert.equal(auto.via, 'reused');
  assert.equal(auto.workflowId, 'wf_sess_auto');
  assert.deepEqual(o._sessionSpecs.map((s) => s.sid), [SID], 'the gate saw the adopted graph, not the empty bootstrap');
  const audit = (await readPipeline(o.projectDir, o.state.id)).auditMarkdown;
  const line = `session ${SID}: sub-agents on Claude (2 steps: Plan, Review Implementation; main agent the first step's model)`;
  assert.equal(audit.split(line).length - 1, 1, audit);   // audited once: the bootstrap call resolved nothing
});
