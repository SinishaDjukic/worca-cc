// test/session-dispatch.test.mjs — the host turn is built from the member's own runOpts; the brief rides only the agents file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentTypeFor, dispatchIdFor, turnIdFor, dispatchMessage, memberDefinition, hostSpawnOpts, hostFlagsFor,
  HOST_CONTRACT, BRIEF_DIVIDER, HOST_MAX_TURNS, MEMBER_BASE_TOOLS } from '../src/core/engines/session-dispatch.mjs';
import { planClaudeInvocation } from '../src/core/engines/claude.mjs';

test('ids: unique per attempt, sanitized, spec-shaped', () => {
  assert.equal(agentTypeFor('x:n_review:2', 1), 'worca-x-n_review-2-a1');
  assert.equal(agentTypeFor('x:n_review:2', 2), 'worca-x-n_review-2-a2');
  assert.equal(dispatchIdFor('x:n_review:2', 1), 'd:x:n_review:2:a1');
  assert.equal(turnIdFor('s_k3f9a2b1', 7), 't:s_k3f9a2b1:7');
});

test('the dispatch line: the type, the child prompt and the re-dispatch rule', () => {
  assert.equal(dispatchMessage({ agentType: 'worca-x-n_review-2-a2', label: 'Review · cycle 2' }),
    'Dispatch sub-agent worca-x-n_review-2-a2 (Review · cycle 2) now: call the Agent tool once, in the foreground, with subagent_type "worca-x-n_review-2-a2", a short description, the prompt "Begin your step." and no other parameter. Dispatch again even if an earlier attempt exists. Then reply DONE.');
  assert.match(HOST_CONTRACT, /Never call any other tool\./);
  assert.match(HOST_CONTRACT, /with no other parameter/);
  assert.match(HOST_CONTRACT, /a short description/); // the Agent tool requires it (verify major 2)
  assert.match(HOST_CONTRACT, /Never run it in the background\./);
  assert.equal(HOST_CONTRACT.split('\n').length, 2, 'v2: a line break only between the two paragraphs');
});

test('memberDefinition: byte-identical brief, tools = allowed ∪ MCP grants ∪ base tools, investigator kept', () => {
  const opts = { systemPrompt: 'SYS', prompt: 'TASK', allowedTools: ['Read', 'Agent'], mcpServerGrants: ['mcp__db'], model: 'claude-opus-5-5', effort: 'high',
    agents: { 'worca-investigator': { prompt: 'inv', effort: 'low' } } };
  const { agentType, definitions } = memberDefinition(opts, { executionId: 'x:n_impl:2', attempt: 1, label: 'Implementation · cycle 2' });
  assert.equal(agentType, 'worca-x-n_impl-2-a1');
  assert.deepEqual(definitions[agentType], { description: 'Implementation · cycle 2 (worca step)', prompt: `SYS${BRIEF_DIVIDER}TASK`,
    tools: ['Read', 'Agent', 'mcp__db', ...MEMBER_BASE_TOOLS], model: 'claude-opus-5-5', effort: 'high' });
  assert.deepEqual(definitions['worca-investigator'], { prompt: 'inv', effort: 'low' });
  const bare = memberDefinition({ ...opts, model: undefined, effort: undefined }, { executionId: 'x:n_impl:2', attempt: 1, label: 'L' }).definitions['worca-x-n_impl-2-a1'];
  assert.equal('model' in bare || 'effort' in bare, false);
  assert.ok(Array.isArray(bare.tools), 'C32: never omitted — a reviewer must not inherit the union of write tools');
  const dropped = memberDefinition(opts, { executionId: 'x:n_impl:2', attempt: 1, label: 'L' }, { dropFields: ['effort'] }).definitions['worca-x-n_impl-2-a1'];
  assert.equal('effort' in dropped, false);
});

test('C26 — host flags per dispatch: the spec default, unless the member has none of its own', () => {
  const settings = { hostModel: null, hostEffort: null };
  assert.deepEqual(hostFlagsFor({ settings, firstMemberModel: 'claude-opus-5-5', member: { model: 'claude-sonnet-4-5', effort: 'high' } }), { model: 'claude-opus-5-5', effort: 'low' });
  assert.deepEqual(hostFlagsFor({ settings, firstMemberModel: 'claude-opus-5-5', member: { model: null, effort: null } }), { model: undefined, effort: undefined },
    'a bare member gets the CLI default, exactly as ungrouped');
  assert.deepEqual(hostFlagsFor({ settings, firstMemberModel: 'claude-opus-5-5', member: {}, inherits: { model: false, effort: false } }), { model: 'claude-opus-5-5', effort: 'low' });
  assert.deepEqual(hostFlagsFor({ settings: { hostModel: 'claude-haiku-4-5', hostEffort: 'medium' }, firstMemberModel: 'x', member: {} }), { model: 'claude-haiku-4-5', effort: 'medium' },
    'an explicit choice wins; the run-start line says the member inherits it');
});

const MEMBER = { cwd: '/w', systemPrompt: 'SYS', prompt: 'TASK', allowedTools: ['Read', 'Write'], mcpConfigPath: '/m.json', mcpServerGrants: ['mcp__db'],
  permissionMode: 'acceptEdits', addDirs: ['/mem'], writableDirs: ['/out'], modelEnv: { ANTHROPIC_BASE_URL: 'x' },
  spawnEnv: { CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '8' }, appendSubagentSystemPrompt: 'MEM', pluginDirs: ['/p'],
  permissionRules: { deny: ['Read(.env*)'] }, envScrub: true, asAgent: true, engine: 'claude', mock: false,
  model: 'claude-opus-5-5', effort: 'high', agents: { a: {} }, resumeSessionId: 'old-host' };
const DEFS = { 'worca-x-n_a-1-a1': { prompt: `SYS${BRIEF_DIVIDER}TASK` } };

test('hostSpawnOpts: contract, dispatch, resume, hard limits, env; run-level fields kept; the brief never on the host argv', () => {
  const h = hostSpawnOpts(MEMBER, { hostSessionId: 'H1', hostModel: 'claude-haiku-4-5', hostEffort: 'low', definitions: DEFS, maxBudgetUsd: 3.5, hostToolsMode: 'union', dispatchText: 'D' });
  assert.equal(h.systemPrompt, HOST_CONTRACT);
  assert.equal(h.prompt, 'D');
  assert.equal(h.resumeSessionId, 'H1');
  assert.equal(h.model, 'claude-haiku-4-5');
  assert.equal(h.effort, 'low');
  assert.equal(h.maxTurns, HOST_MAX_TURNS);
  assert.equal(h.maxBudgetUsd, 3.5);
  assert.equal(h.forwardSubagentText, true);
  assert.equal(h.agentsViaFile, true);
  assert.deepEqual(h.agents, DEFS, 'the member\'s own investigator map is replaced by the definitions');
  assert.deepEqual(h.allowedTools, ['Agent', 'Task', 'Read', 'Write']);
  assert.equal(h.tools, undefined);
  assert.equal(h.extraSettings, undefined);
  assert.equal(h.mainThreadGuard, undefined);
  assert.deepEqual(h.spawnEnv, { CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '8', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' });
  for (const k of ['cwd', 'mcpConfigPath', 'mcpServerGrants', 'permissionMode', 'addDirs', 'writableDirs', 'modelEnv', 'appendSubagentSystemPrompt', 'pluginDirs', 'permissionRules', 'envScrub', 'asAgent', 'engine', 'mock']) {
    assert.deepEqual(h[k], MEMBER[k], k);
  }
  const plan = planClaudeInvocation(h, { dir: '/tmp/stage' });
  assert.ok(!plan.args.join('\u0000').includes('TASK') && !plan.args.join(' ').includes('SYS'), 'the brief rides the agents file only');   // v3: a substring check
});

test('hostSpawnOpts: first turn, bare member, no cap, agent-only tools, main-thread guard', () => {
  const guard = { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node guard.mjs' }] }] } };
  const a = hostSpawnOpts(MEMBER, { hostSessionId: null, hostModel: undefined, hostEffort: undefined, definitions: DEFS, maxBudgetUsd: null, hostToolsMode: 'agent-only', mainThreadGuard: guard, dispatchText: 'D' });
  assert.equal(a.resumeSessionId, undefined);
  assert.equal(a.model, undefined);
  assert.equal(a.effort, undefined, 'C26: no --effort, so a bare member gets the CLI default');
  assert.deepEqual(a.allowedTools, ['Agent', 'Task']);
  assert.deepEqual(a.tools, ['Agent', 'Task']);
  assert.equal(a.mcpServerGrants, undefined, 'v3: buildClaudeArgs would union the grants into --allowedTools');
  assert.equal(a.mcpConfigPath, MEMBER.mcpConfigPath, 'the MCP config stays');
  const argv = planClaudeInvocation(a, { dir: '/tmp/stage6' }).args;
  assert.equal(argv[argv.indexOf('--allowedTools') + 1], 'Agent,Task');
  assert.equal(argv[argv.indexOf('--tools') + 1], 'Agent,Task');
  assert.equal(a.maxBudgetUsd, undefined);
  assert.deepEqual(a.mainThreadGuard, guard, 'v2 (C40): its own adapter option; extraSettings strips hooks');
  assert.equal(a.extraSettings, undefined);
});

test('v4 — S2 may drop model or effort from a definition, never description, prompt or tools (C32)', () => {
  const opts = { systemPrompt: 'SYS', prompt: 'TASK', allowedTools: ['Read'], model: 'claude-opus-5-5', effort: 'high' };
  const def = memberDefinition(opts, { executionId: 'x:n_impl:2', attempt: 1, label: 'L' }, { dropFields: ['tools', 'description', 'prompt', 'model'] }).definitions['worca-x-n_impl-2-a1'];
  assert.deepEqual(Object.keys(def), ['description', 'prompt', 'tools', 'effort']);
});

test('v4 — C26 reads each inherit fact for its own flag; no first-member model means no --model', () => {
  const settings = { hostModel: null, hostEffort: null };
  assert.deepEqual(hostFlagsFor({ settings, firstMemberModel: 'claude-opus-5-5', member: {}, inherits: { model: true, effort: false } }), { model: undefined, effort: 'low' });
  assert.deepEqual(hostFlagsFor({ settings, firstMemberModel: 'claude-opus-5-5', member: {}, inherits: { model: false, effort: true } }), { model: 'claude-opus-5-5', effort: undefined });
  assert.deepEqual(hostFlagsFor({ settings, firstMemberModel: null, member: { model: 'claude-sonnet-4-5', effort: 'high' } }), { model: undefined, effort: 'low' });
});

test('v4 — every run-level field the member carries reaches the host unchanged; one it lacks stays out; signal and onEvent are the caller\'s', () => {
  const RUN_LEVEL = { cwd: '/w', mcpConfigPath: '/m.json', mcpServerGrants: ['mcp__db'], mcpjsonProjectDir: '/w', noGit: true, workspaceWriteTargets: ['/t'],
    permissionMode: 'acceptEdits', addDirs: ['/mem'], writableDirs: ['/out'], modelEnv: { ANTHROPIC_BASE_URL: 'x' }, redactValues: ['tok'],
    disallowedTools: ['WebFetch'], appendSubagentSystemPrompt: 'MEM', pluginDirs: ['/p'], memoryLoadLog: '/mem.ndjson',
    permissionRules: { deny: ['Read(.env*)'] }, envScrub: true, envAllowlist: ['PATH'], asAgent: true, bin: '/opt/claude', engine: 'claude', mock: false };
  const h = hostSpawnOpts({ ...RUN_LEVEL, systemPrompt: 'SYS', prompt: 'TASK', signal: 'S', onEvent: 'E' }, { definitions: DEFS, dispatchText: 'D' });
  for (const [k, v] of Object.entries(RUN_LEVEL)) assert.deepEqual(h[k], v, k);
  for (const k of ['signal', 'onEvent', 'tools', 'extraSettings']) assert.equal(k in h, false, k);
  assert.equal('noGit' in hostSpawnOpts({ cwd: '/w' }, { definitions: DEFS, dispatchText: 'D' }), false, 'a kept field the member lacks is left out');
});

test('v4 — --max-budget-usd only for a finite positive number', () => {
  for (const bad of [0, -1, Infinity, NaN, '3', null]) {
    assert.equal('maxBudgetUsd' in hostSpawnOpts(MEMBER, { definitions: DEFS, maxBudgetUsd: bad, dispatchText: 'D' }), false, String(bad));
  }
});

test('v5 — tool lists are de-duplicated in order and keep only names; a host spawn always disables background tasks', () => {
  const opts = { systemPrompt: 'S', prompt: 'P', allowedTools: ['Read', 'Agent', 'Read', '', null], mcpServerGrants: ['mcp__db', 'Read'] };
  const def = memberDefinition(opts, { executionId: 'x:n_a:1', attempt: 1, label: 'L' }).definitions['worca-x-n_a-1-a1'];
  assert.deepEqual(def.tools, ['Read', 'Agent', 'mcp__db', ...MEMBER_BASE_TOOLS]);
  const stale = memberDefinition({ ...opts, agents: { 'worca-x-n_a-1-a1': { prompt: 'stale' }, 'worca-investigator': { prompt: 'inv' } } },
    { executionId: 'x:n_a:1', attempt: 1, label: 'L' }).definitions;
  assert.equal(stale['worca-x-n_a-1-a1'].description, 'L (worca step)', 'the member\'s own definition wins its agentType');
  assert.deepEqual(stale['worca-investigator'], { prompt: 'inv' });
  const h = hostSpawnOpts({ ...opts, spawnEnv: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '0', X: '1' } }, { definitions: DEFS, dispatchText: 'D' });
  assert.deepEqual(h.allowedTools, ['Agent', 'Task', 'Read']);
  assert.deepEqual(h.spawnEnv, { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', X: '1' }, 'Global Constraints: always on host spawns');
});
