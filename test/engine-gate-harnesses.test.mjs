// test/engine-gate-harnesses.test.mjs — the start checks cover every harness a run's steps use (_harnessPlan's U):
// each non-Claude harness's gate, the Claude sign-in whenever Claude Code is in U, the credential broker; on a run that
// uses more than one harness each line names the harness and its steps, a one-harness run keeps today's lines.
import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { MEMORY_BLOCK_INTRO, MEMORY_BLOCK_INTRO_READ } from '../src/core/memory-store.mjs';
import { ENGINE_PROJECT_FILES } from '../src/core/engines/project-files.mjs';

useTempHome(after);

let prevMock;
beforeEach(() => { prevMock = process.env.WORCA_MOCK; delete process.env.WORCA_MOCK; });
afterEach(() => { if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock; });

const orch = (claude = {}) => createOrchestrator({ projectDir: '/tmp/gate-proj', guardrailsId: 'permissive', claude: { mock: true, ...claude } });
const withNodes = (o, nodes) => { o.resolved = { nodeCtx: nodes }; return o; };
const RULES = { deny: ['Bash(curl:*)', 'Read(.env*)'] };   // a command codex can hold, a path it cannot


const NODES = () => ({
  n_plan: { nodeId: 'n_plan', kind: 'agent', key: 'planner', meta: { displayName: 'Plan' }, model: 'gpt-5.5', engine: 'codex', tools: [] },
  n_impl: { nodeId: 'n_impl', kind: 'agent', key: 'implementer', meta: { displayName: 'Implementation' }, model: 'claude-opus-5-5', engine: 'claude', tools: [] },
});
test('U is the default harness plus every step\'s, sorted; steps are named only on a mixed run', () => {
  assert.deepEqual(withNodes(orch(), NODES())._harnessPlan(), { engines: ['claude', 'codex'], steps: { claude: ['Implementation'], codex: ['Plan'] } });
  assert.deepEqual(withNodes(orch({ engine: 'cursor' }), NODES())._harnessPlan().engines, ['claude', 'codex', 'cursor']);
  assert.deepEqual(withNodes(orch(), {})._harnessPlan(), { engines: ['claude'], steps: {} });
});
test('a Claude-default run with a step on Codex meets Codex\'s gate, named with its step', () => {
  const o = withNodes(orch(), NODES());
  o.guardrailPermissionRules = RULES; o.guardrailsId = 'strict';
  assert.throws(() => o._engineGate(), { message: /^engine codex \(Plan\): guardrail set "strict" has permission rules this engine cannot enforce \(Read\(\.env\*\)\)/ });
  const ok = withNodes(orch({ allowUnguardedEngine: true }), NODES());
  ok.guardrailPermissionRules = RULES; ok.guardrailsId = 'strict';
  const lines = ok._engineGate();
  assert.ok(lines.some((l) => l.startsWith('engine codex (Plan): no allowedTools — ')), lines.join('\n'));
  assert.ok(lines.every((l) => l.startsWith('engine codex (Plan): ')), 'no line for Claude Code');
});
test('a one-harness run keeps today\'s lines, with no step names', () => {
  assert.ok(withNodes(orch({ engine: 'codex' }), {})._engineGate().every((l) => /^engine codex: /.test(l)));
});
test('Claude in U: the sign-in refusal names the Claude step, on a Codex-default run too', () => {
  const o = withNodes(orch({ engine: 'codex' }), NODES());
  o._signInBlocked = [{ nodeId: 'n_impl', node: 'Implementation', model: 'claude-opus-5-5', source: 'run' }];
  o._signInLabels = {};
  assert.throws(() => o._engineGate(), { message: /^engine claude \(Implementation\): Claude Code isn't signed in/ });
});
test('the credential broker locks a harness a step reaches through its pin', () => {
  const prev = process.env.WORCA_BROKER_URL;
  process.env.WORCA_BROKER_URL = 'http://broker.internal:8080';
  try {
    assert.throws(() => withNodes(orch(), NODES())._engineGate(), { message: /^engine codex \(Plan\): the credential broker is on, and codex signs in with its own credentials/ });
  } finally { if (prev === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prev; }
});

test('Review Focus 2: a Codex-default start with a step pinned to Claude while Claude Code is signed out is refused before the run exists', async () => {
  const o = createOrchestrator({ projectDir: gitDir('psh-signedout'), workflowId: 'wf_default', prompt: 'x', guardrailsId: 'permissive',
    claude: { mock: true, engine: 'codex' }, claudeAuth: async () => ({ state: 'signed-out' }),
    overlay: { nodes: { n_impl: { model: 'claude-opus-5-5', engine: 'claude' } } } });
  const r = await o.engineStartRefusal();
  assert.deepEqual([r.overridable, r.engines], [false, ['claude']]);
  assert.match(r.error, /^engine claude \(Implementation\): Claude Code isn't signed in/);
  const plain = createOrchestrator({ projectDir: gitDir('psh-plain'), workflowId: 'wf_default', prompt: 'x', claude: { mock: true } });
  assert.equal(await plain.engineStartRefusal(), null, 'a Claude-only start: nothing to say');
});

test('the memory block is worded per harness; every harness\'s project files are registered', async () => {
  const o = withNodes(orch(), NODES());
  o.memory = { dirs: [{ label: 'Project', rel: 'project' }], mount: '/m', rules: null, team: [], entries: null };
  o._refreshMemoryBlock();
  assert.ok(o._memoryBlockFor('planner', 'codex').includes(MEMORY_BLOCK_INTRO_READ));
  assert.ok(o._memoryBlockFor('implementer').includes(MEMORY_BLOCK_INTRO));
  const wt = mkdtempSync(join(tmpdir(), 'psh-cfg-'));
  const c = withNodes(orch(), { n: { nodeId: 'n', kind: 'agent', key: 'planner', model: 'x', engine: 'cursor' } });
  c.runCwd = wt; c.workDirs = new Map([['k', wt]]);
  await c._registerEngineConfig();
  assert.deepEqual(c.injectedPaths.k.filter((e) => e.kind === 'engineConfig').map((e) => e.path), ENGINE_PROJECT_FILES.cursor);
});

test('TOCTOU: a pick written between the early check and run() is judged by run() on the graph it dispatches', async () => {
  const seen = [];
  const o = createOrchestrator({ projectDir: gitDir('psh-toctou'), workflowId: 'wf_default', prompt: 'x', auto: true, guardrailsId: 'normal', claude: { mock: true },
    runners: { clarifier: async () => { seen.push('spawn'); return { outputs: {}, verdict: null, summary: '' }; }, producer: async () => { seen.push('spawn'); return { outputs: {}, verdict: null, summary: '' }; } } });
  assert.equal(await o.engineStartRefusal(), null, 'a Claude-only start passes the early check');
  o.opts.overlay = { nodes: { n_plan: { model: 'gpt-5.5', engine: 'codex' } } };
  const res = await o.run();
  assert.equal(res.status, 'error');
  assert.match(String(res.error), /^engine codex \(Plan\): guardrail set "normal" has permission rules this engine cannot enforce/);
  assert.deepEqual(seen, [], 'nothing spawned');
});
