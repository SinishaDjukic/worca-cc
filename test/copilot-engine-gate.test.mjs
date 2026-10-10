// test/copilot-engine-gate.test.mjs — a run on the GitHub Copilot CLI engine (engines/copilot.mjs): the run-start
// gate (refusals and the degradation audit), the models a node spawn gets, the MCP check, the fan-out directive.
import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { fanOutDirective } from '../src/core/phases.mjs';
import { COPILOT_COMMAND_RULE_REACH } from '../src/core/engines/copilot.mjs';
import { resolveStepModels } from '../src/core/config.mjs';
import { utilityModelFor } from '../src/core/settings-cascade.mjs';

useTempHome(after);
let prevMock;
beforeEach(() => { prevMock = process.env.WORCA_MOCK; delete process.env.WORCA_MOCK; });
afterEach(() => { if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock; });

const orch = (claude = {}) => createOrchestrator({ projectDir: '/tmp/gate-proj', claude: { mock: true, ...claude } });
const withNodes = (o, nodes) => { o.resolved = { nodeCtx: nodes }; return o; };

test('copilot: every missing capability is one audit line with its fallback', () => {
  const lines = withNodes(orch({ engine: 'copilot' }), {})._engineGate();
  const caps = lines.filter((l) => /^engine copilot: no \w+ — /.test(l));
  assert.deepEqual(caps.map((l) => l.split(':')[1].trim().split(' ')[1]).sort(), ['cost', 'hookTelemetry', 'turnBudget']);
});

test('copilot refuses a set with rules it cannot hold, and asks consent for those it holds in part', () => {
  const o = withNodes(orch({ engine: 'copilot' }), {});
  o.guardrailPermissionRules = { deny: ['Read(.env*)'] };
  o.guardrailsId = 'strict';
  assert.throws(() => o._engineGate(), /engine copilot: guardrail set "strict" has permission rules this engine cannot enforce \(Read\(\.env\*\)\)/);
  const part = withNodes(orch({ engine: 'copilot' }), {});
  part.guardrailPermissionRules = { deny: ['Bash(git push:*)', 'Edit(secrets.txt)', 'mcp__github', 'Bash'] };
  part.guardrailsId = 'cmds';
  assert.throws(() => part._engineGate(), /guardrail set "cmds" has command and write rules this engine holds only in part \(Bash\(git push:\*\), Edit\(secrets\.txt\)\)/);
  const allowed = withNodes(orch({ engine: 'copilot', allowUnguardedEngine: true }), {});
  allowed.guardrailPermissionRules = part.guardrailPermissionRules;
  allowed.guardrailsId = 'cmds';
  const lines = allowed._engineGate();
  assert.ok(lines.includes('engine copilot: deny rules enforced on copilot: mcp__github, Bash'), lines.join('\n'));
  assert.ok(lines.includes(`engine copilot: deny rules held on copilot only in part, as command and write rules — ${COPILOT_COMMAND_RULE_REACH} (--allow-unguarded-engine): Bash(git push:*), Edit(secrets.txt)`), lines.join('\n'));
});

test('copilot names its models its own way: a catalog model of another engine is dropped, any other id runs as named', () => {
  const o = orch({ engine: 'copilot' });
  assert.equal(o._engineModel('gpt-5.4'), 'gpt-5.4');
  assert.equal(o._engineModel('claude-sonnet-4.6'), 'claude-sonnet-4.6');
  assert.equal(o._engineModel('auto'), 'auto');
  assert.equal(o._engineModel('opus'), undefined);
  assert.equal(o._engineModel('gpt-5.6-sol'), undefined);
  const lines = withNodes(orch({ engine: 'copilot' }), { a: { key: 'planner', model: 'opus' }, b: { key: 'implementer', model: 'gpt-5.6-sol' }, c: { key: 'reviewer', model: 'claude-sonnet-4.6' } })._engineGate();
  assert.ok(lines.includes('engine copilot: model "opus" runs on Claude — the nodes that name it run on copilot\'s default model, so their cost stays unknown'), lines.join('\n'));
  assert.ok(lines.includes('engine copilot: model "gpt-5.6-sol" runs on Codex — the nodes that name it run on copilot\'s default model'), lines.join('\n'));
  assert.ok(!lines.some((l) => l.includes('claude-sonnet-4.6')));
});

test('copilot has no step or helper slots: steps run the run\'s model, helpers copilot\'s default', async () => {
  const steps = await resolveStepModels('/tmp/gate-proj', 'gpt-5.4', 'copilot');
  assert.ok(Object.values(steps).length > 0);
  assert.ok(Object.values(steps).every((s) => s.model === 'gpt-5.4' && s.effort === undefined));
  assert.deepEqual(utilityModelFor('copilot', 'title'), { model: null, effort: null, source: 'default' });
});

test('copilot attaches remote MCP copies too; a copy with no command or url is refused', () => {
  const o = orch({ engine: 'copilot' });
  assert.equal(o._engineMcpRefusal({ copies: [{ name: 'gh' }], servers: { gh: { type: 'http', url: 'https://mcp.example' } } }), null);
  assert.equal(o._engineMcpRefusal({ copies: [{ name: 'odd' }], servers: { odd: { type: 'stdio' } } }), 'this run attaches MCP servers copilot cannot attach — no command and no url: odd');
  assert.equal(o._engineMcpRefusal({ copies: [{ name: 'odd' }, { name: 'a.b' }], servers: { odd: {}, 'a.b': { type: 'http', url: 'https://mcp.example' } } }),
    'this run attaches MCP servers copilot cannot attach — a name copilot cannot use (only letters, digits, _ and -, at most 64 characters): a.b; no command and no url: odd',
    'a remote server is fine on copilot; its name is not');
});

test('fan-out on copilot: the task tool and the worca-investigator agent', () => {
  const d = fanOutDirective(true, { engine: 'copilot' });
  assert.match(d, /the `task` tool/);
  assert.match(d, /agent_type: "worca-investigator"/);
  assert.doesNotMatch(d, /spawn_agent|subagent_type/);
});
