// test/engine-gate.test.mjs — choosing an engine for a run (plans/harness-bridge-design.md §10):
// the run-start gate (refusals + degradation audit), the per-node ctx a non-Claude engine
// gets, and runClaude's dispatch by engine name.
import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { runOpts } from '../src/core/phases.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { addGlobalModel, setUtilityModels } from '../src/core/settings.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { ENGINES } from './helpers/engines.mjs';
import { fakeCodex } from './helpers/fake-codex.mjs';
import { mockSpawnLog } from '../src/core/claude-runner.mjs';
import { CODEX_DEFAULT_MODEL, codexRootsInWorcaHome } from '../src/core/engines/codex.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { writeCursorProjectFiles } from '../src/core/engines/cursor.mjs';
import { fakeCursor } from './helpers/fake-cursor.mjs';
import { removeInjectedPaths, writeRunManifest, readRunManifest } from '../src/core/run-manifest.mjs';
import { readGuardrailSet } from '../src/core/guardrail-store.mjs';
import { guardrailsToPermissionRules } from '../src/core/guardrails.mjs';

useTempHome(after);
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-gate-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

let prevMock;
beforeEach(() => { prevMock = process.env.WORCA_MOCK; delete process.env.WORCA_MOCK; });
afterEach(() => { if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock; });

const orch = (claude = {}) => createOrchestrator({ projectDir: '/tmp/gate-proj', claude: { mock: true, ...claude } });
const withNodes = (o, nodes) => { o.resolved = { nodeCtx: nodes }; return o; };
const RULES = { deny: ['Bash(curl:*)', 'Read(.env*)'] };   // a command codex can hold, a path it cannot
const CMD_RULES = { deny: ['Bash(curl:*)', 'Bash(git push)', 'WebSearch'] };

test('an unknown engine fails at construction', () => {
  assert.throws(() => orch({ engine: 'codx' }), /unknown engine "codx"/);
  // The mock stands in for Claude under --mock only; it is not a run engine.
  assert.throws(() => orch({ engine: 'mock' }), /"mock" is not a run engine \(choose one of: claude, codex, cursor\); the offline mock runs under --mock/);
});

test('claude (the default) passes the gate with nothing to say', () => {
  const o = orch();
  assert.equal(o.claude.engine, 'claude');
  o.guardrailPermissionRules = RULES;
  assert.deepEqual(o._engineGate(), []);
});

test('codex: every missing capability is one audit line with its fallback', () => {
  const lines = withNodes(orch({ engine: 'codex' }), {})._engineGate();
  const caps = lines.filter((l) => /^engine codex: no \w+ — /.test(l));
  assert.deepEqual(caps.map((l) => l.split(':')[1].trim().split(' ')[1]).sort(), ['allowedTools', 'hookTelemetry', 'turnBudget']);
  assert.ok(caps.every((l) => /^engine codex: no \w+ — .{10,}$/.test(l)), caps.join('\n'));
});

test('codex refuses a run whose guardrail set has permission rules it cannot enforce', () => {
  const o = withNodes(orch({ engine: 'codex' }), {});
  o.guardrailPermissionRules = RULES;
  o.guardrailsId = 'strict';
  assert.throws(() => o._engineGate(), /engine codex: guardrail set "strict" has permission rules this engine cannot enforce \(Read\(\.env\*\)\)/);
});

const REACH = 'they catch a command run directly, by full path or in an && chain, but not one with a redirect, a substitution or a variable';

test('codex holds command rules only in part: a set of them needs --allow-unguarded-engine, then runs on them and says how far they reach', () => {
  const o = withNodes(orch({ engine: 'codex' }), {});
  o.guardrailPermissionRules = CMD_RULES;
  o.guardrailsId = 'cmds';
  assert.throws(() => o._engineGate(), new RegExp(`guardrail set "cmds" has command rules this engine holds only in part \\(Bash\\(curl:\\*\\), Bash\\(git push\\)\\): ${REACH.replace(/&/g, '&')} — run it with the Permissive set, or pass --allow-unguarded-engine to run it with them as a partial guard`));
  const allowed = withNodes(orch({ engine: 'codex', allowUnguardedEngine: true }), {});
  allowed.guardrailPermissionRules = CMD_RULES;
  allowed.guardrailsId = 'cmds';
  const lines = allowed._engineGate();
  assert.ok(lines.includes('engine codex: deny rules enforced on codex: WebSearch'), lines.join('\n'));
  assert.ok(lines.includes(`engine codex: deny rules held on codex only in part, as command rules — ${REACH} (--allow-unguarded-engine): Bash(curl:*), Bash(git push)`), lines.join('\n'));
  assert.equal(lines.some((l) => /NOT enforced/.test(l)), false);
  // A set that only turns the shell or web search off is fully held: no consent needed.
  const off = withNodes(orch({ engine: 'codex' }), {});
  off.guardrailPermissionRules = { deny: ['Bash', 'WebSearch'] };
  assert.deepEqual(off._engineGate().filter((l) => /deny rules/.test(l)), ['engine codex: deny rules enforced on codex: Bash, WebSearch']);
});

test('codex does not hold WebFetch while its shell or web search can still fetch: the gate asks for consent and the audit says so', () => {
  const o = withNodes(orch({ engine: 'codex' }), {});
  o.guardrailPermissionRules = { deny: ['WebFetch', 'WebSearch'] };
  o.guardrailsId = 'web';
  assert.throws(() => o._engineGate(), /guardrail set "web" has permission rules this engine cannot enforce \(WebFetch\)/);
  const allowed = withNodes(orch({ engine: 'codex', allowUnguardedEngine: true }), {});
  allowed.guardrailPermissionRules = { deny: ['WebFetch', 'WebSearch'] };
  allowed.guardrailsId = 'web';
  const lines = allowed._engineGate();
  assert.ok(lines.includes('engine codex: deny rules enforced on codex: WebSearch'), lines.join('\n'));
  assert.ok(lines.includes('engine codex: guardrail set "web": rules NOT enforced on codex (--allow-unguarded-engine): WebFetch'), lines.join('\n'));
  // With the shell and web search both off, codex has no way left to fetch a page.
  const off = withNodes(orch({ engine: 'codex' }), {});
  off.guardrailPermissionRules = { deny: ['Bash', 'WebSearch', 'WebFetch'] };
  assert.deepEqual(off._engineGate().filter((l) => /deny rules/.test(l)), ['engine codex: deny rules enforced on codex: Bash, WebSearch, WebFetch']);
});

test('--allow-unguarded-engine runs it anyway and says so in the audit', () => {
  const o = withNodes(orch({ engine: 'codex', allowUnguardedEngine: true }), {});
  o.guardrailPermissionRules = RULES;
  o.guardrailsId = 'strict';
  const lines = o._engineGate();
  assert.ok(lines.includes('engine codex: guardrail set "strict": rules NOT enforced on codex (--allow-unguarded-engine): Read(.env*)'), lines.join('\n'));
  assert.ok(lines.includes(`engine codex: deny rules held on codex only in part, as command rules — ${REACH} (--allow-unguarded-engine): Bash(curl:*)`));
});

test('codex runs a node that needs MCP tools: it attaches the run\'s servers', () => {
  const o = withNodes(orch({ engine: 'codex' }), { n1: { key: 'manualWebUiTesting', tools: ['Read', 'mcp__plugin_playwright_playwright__browser_click'] } });
  assert.doesNotThrow(() => o._engineGate());
});

test('codex refuses a run while the credential broker is on (it signs in with its own credentials)', () => {
  const prev = process.env.WORCA_BROKER_URL;
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9';
  try {
    assert.throws(() => withNodes(orch({ engine: 'codex' }), {})._engineGate(),
      /engine codex: the credential broker is on, and codex signs in with its own credentials, which the broker cannot bill or revoke/);
    assert.deepEqual(withNodes(orch(), {})._engineGate(), [], 'claude runs through the broker');
  } finally {
    if (prev === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prev;
  }
});

test('codex attaches a registry layer\'s stdio copies and refuses its remote ones; claude and an empty layer pass', async () => {
  const STDIO = { command: process.execPath, args: ['/launch.mjs'] };
  const HTTP = { type: 'http', url: 'https://mcp.example/' };
  const layer = (copies, servers = {}) => async () => ({ result: { copies, servers }, catalog: {} });
  const o = orch({ engine: 'codex' });
  o._resolveMcp = layer([{ name: 'sentry_billing', setName: 'Billing' }, { name: 'jira', setName: 'General' }], { sentry_billing: HTTP, jira: STDIO });
  await assert.rejects(() => o._engineMcpGate(), /engine codex: this run attaches remote MCP servers \(sentry_billing\), and codex attaches stdio servers only/);
  // The run's own resolution refuses too (a resume's early look runs before its team policy).
  assert.match(o._engineMcpRefusal({ copies: [{ name: 'pg' }], servers: { pg: HTTP } }), /attaches remote MCP servers \(pg\)/);
  assert.equal(o._engineMcpRefusal({ copies: [{ name: 'pg' }], servers: { pg: STDIO } }), null, 'a stdio copy is attached');
  const stdio = orch({ engine: 'codex' });
  stdio._resolveMcp = layer([{ name: 'jira' }], { jira: STDIO });
  await stdio._engineMcpGate();
  const none = orch({ engine: 'codex' });
  none._resolveMcp = layer([]);
  await none._engineMcpGate();
  const claude = orch();
  claude._resolveMcp = layer([{ name: 'sentry_billing' }], { sentry_billing: HTTP });
  await claude._engineMcpGate();
  assert.equal(claude._engineMcpRefusal({ copies: [{ name: 'pg' }], servers: { pg: HTTP } }), null);
});

test('a Claude model routed to a custom endpoint is dropped on codex like any Claude model, not refused', async () => {
  const home = tmp();
  const prev = { HOME: process.env.HOME, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try {
    await addGlobalModel({ id: 'gate-onprem', env: { ANTHROPIC_BASE_URL: 'https://p' } });
    const o = withNodes(orch({ engine: 'codex' }), { n1: { key: 'planner', tools: [], model: 'gate-onprem' } });
    const lines = o._engineGate();
    assert.ok(lines.some((l) => /model "gate-onprem" is a Claude model — the nodes that name it run on codex's default model/.test(l)), lines.join('\n'));
    assert.equal(o._engineModel('gate-onprem'), undefined);
  } finally {
    process.env.HOME = prev.HOME;
    if (prev.ALLOW === undefined) delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK; else process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = prev.ALLOW;
  }
});

/** Run `fn` with HOME sandboxed for catalog writes (settings.json lives under $HOME). */
async function withCatalogHome(fn) {
  const home = tmp();
  const prev = { HOME: process.env.HOME, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try { return await fn(home); } finally {
    process.env.HOME = prev.HOME;
    if (prev.ALLOW === undefined) delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK; else process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = prev.ALLOW;
  }
}
const ENDPOINT = { provider: 'openai', api: 'openai-responses', model: 'qwen3-coder', baseUrl: 'http://127.0.0.1:8000/v1' };

test('a Codex model on its own OpenAI-compatible endpoint runs on codex: not refused, kept on the spawn', async () => {
  await withCatalogHome(async () => {
    await addGlobalModel({ id: 'gate-cx-local', engine: 'codex', upstream: ENDPOINT });
    const o = withNodes(orch({ engine: 'codex', model: 'gate-cx-local' }), { n1: { key: 'planner', tools: [], model: 'gate-cx-local' } });
    const lines = o._engineGate();
    assert.ok(!lines.some((l) => /gate-cx-local/.test(l)), lines.join('\n'));
    assert.equal(o._engineModel('gate-cx-local'), 'gate-cx-local');
  });
});

test('a codex run skips the sign-in only when every Codex model it can name is on an endpoint, helpers included', async () => {
  await withCatalogHome(async () => {
    await addGlobalModel({ id: 'gate-cx-a', engine: 'codex', upstream: ENDPOINT });
    await addGlobalModel({ id: 'gate-cx-b', engine: 'codex', upstream: { ...ENDPOINT, model: 'qwen3-small' } });
    const run = (claude = {}) => createOrchestrator({ projectDir: tmp(), claude: { mock: true, engine: 'codex', ...claude } });
    // No model named: the run, and every helper, runs codex's default model.
    assert.equal(await run()._codexNeedsSignIn(), true);
    // The run's model is on an endpoint, but the helper jobs (title, overview, …) have no model: codex's default.
    assert.equal(await run({ model: 'gate-cx-a' })._codexNeedsSignIn(), true);
    const jobs = Object.fromEntries(['title', 'overview', 'prDescription', 'memoryDefrag'].map((j) => [j, { model: 'gate-cx-b' }]));
    await setUtilityModels({ codex: jobs });
    assert.equal(await run({ model: 'gate-cx-a' })._codexNeedsSignIn(), false);
    // A Claude run model is dropped on codex: the nodes run codex's default model.
    assert.equal(await run({ model: 'claude-sonnet-5' })._codexNeedsSignIn(), true);
    // A built-in Codex model anywhere — here a workflow node — needs the sign-in again.
    const o = run({ model: 'gate-cx-a' });
    o.state.stepper = { nodes: [{ id: 'n1', model: 'gpt-5.5' }] };
    assert.equal(await o._codexNeedsSignIn(), true);
    // An Auto run's classifier may pick any Codex model.
    const auto = run({ model: 'gate-cx-a' });
    auto.workflowId = 'wf_auto';
    assert.equal(await auto._codexNeedsSignIn(), true);
  });
});

test('a real codex run on endpoint models only checks the binary, not the sign-in', POSIX, async () => {
  await withCatalogHome(async () => {
    await addGlobalModel({ id: 'gate-cx-only', engine: 'codex', upstream: ENDPOINT });
    await setUtilityModels({ codex: Object.fromEntries(['title', 'overview', 'prDescription', 'memoryDefrag'].map((j) => [j, { model: 'gate-cx-only' }])) });
    const dir = tmp();
    const out = join(dir, 'codex-out');
    writeFileSync(out, '#!/bin/sh\necho "Not logged in"\nexit 1\n');
    chmodSync(out, 0o755);
    const real = (claude) => createOrchestrator({ projectDir: dir, claude: { engine: 'codex', bin: out, ...claude } });
    assert.equal(await real({ model: 'gate-cx-only' })._engineChecks(() => true), null);
    await assert.rejects(() => real({ model: 'gpt-5.5' })._engineChecks(() => true), /codex-out is not signed in/);
    await assert.rejects(() => real({ model: 'gate-cx-only', bin: join(dir, 'missing') })._engineChecks(() => true), /cannot run .*missing \(ENOENT\)/);
  });
});

test('a Claude model runs on codex\'s default model: dropped from the spawn, named in the audit', () => {
  const o = withNodes(orch({ engine: 'codex', model: 'claude-opus-5-5' }), {
    n1: { key: 'planner', tools: [], model: 'claude-sonnet-5' },
    n2: { key: 'implementer', tools: [], model: 'gpt-5.6-sol' },
    n3: { key: 'reviewer', tools: [], model: 'sonnet' },
  });
  const dropped = o._engineGate().filter((l) => / is a Claude model /.test(l));
  assert.deepEqual(dropped.map((l) => l.match(/model "([^"]+)"/)[1]), ['claude-opus-5-5', 'claude-sonnet-5', 'sonnet']);
  assert.equal(o._engineModel('claude-sonnet-5'), undefined);
  assert.equal(o._engineModel('sonnet'), undefined);
  assert.equal(o._engineModel('gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.equal(o._engineModel(undefined), undefined);
  assert.equal(orch()._engineModel('claude-sonnet-5'), 'claude-sonnet-5', 'claude keeps its model');
});

test('the night decider runs on the run\'s engine: that engine\'s model kept, another engine\'s dropped, codex\'s default named', async () => {
  const seen = [];
  const decide = async (claude) => {
    const o = createOrchestrator({ projectDir: '/tmp/gate-proj', claude: { mock: false, ...claude },
      nightRunClaude: async (opts) => { seen.push([opts.engine || 'claude', opts.model]); return { text: '{"decisions":[]}' }; } });
    Object.assign(o, { state: { subAgents: [], steps: [] }, _upsertSubAgent: () => {}, _subAgentTransition: () => {},
      _recordCost: () => {}, _nightPlanPaths: async () => [], _runningStepKeys: () => [] });
    await o._nightAnalyze([{ id: 'q1', question: '?', options: ['a', 'b'] }], { kind: 'clarify' });
    return o.state.subAgents[0].runModel;                     // the decider's row names the model it ran
  };
  assert.equal(await decide({ engine: 'codex', model: 'gpt-5.5' }), 'gpt-5.5');
  assert.equal(await decide({ engine: 'codex', model: 'claude-sonnet-5' }), CODEX_DEFAULT_MODEL);
  assert.equal(await decide({ engine: 'claude', model: 'claude-opus-5-5' }), 'claude-opus-5-5');
  assert.equal(await decide({ engine: 'claude', model: 'gpt-5.5' }), null);
  assert.equal(await decide({ engine: 'codex' }), CODEX_DEFAULT_MODEL);
  assert.deepEqual(seen, [['codex', 'gpt-5.5'], ['codex', CODEX_DEFAULT_MODEL], ['claude', 'claude-opus-5-5'], ['claude', null], ['codex', CODEX_DEFAULT_MODEL]]);
});

test('the run title runs on the run\'s engine: codex gets no model, Claude keeps the run model', () => {
  const t = (claude) => orch(claude)._titleGenOpts();
  assert.equal(t({ engine: 'codex', model: 'gpt-5.6-sol' }).engine, 'codex');
  assert.equal(t({ engine: 'codex', model: 'gpt-5.6-sol' }).runModel, null);
  assert.equal(t({ engine: 'codex', model: 'claude-sonnet-5' }).runModel, null);
  assert.equal(t({ engine: 'claude', model: 'claude-opus-5-5' }).engine, 'claude');
  assert.equal(t({ engine: 'claude', model: 'claude-opus-5-5' }).runModel, 'claude-opus-5-5');
  assert.equal(t({}).runModel, null);
});

test('the node ctx on codex: engine named, fan-out on (codex\'s own spawn_agent, worca\'s investigator role)', () => {
  const o = orch({ engine: 'codex' });
  const c = o._engineNodeOpts({ fanOut: true });
  assert.deepEqual(c, { engine: 'codex', subagents: true, fanOut: true });
  assert.deepEqual(orch()._engineNodeOpts({ fanOut: true }), { engine: 'claude', subagents: true, fanOut: true });
});

test('runOpts forwards the engine to runClaude', () => {
  const opts = runOpts({ projectDir: '/p', claudeOpts: { engine: 'codex' } }, { role: 'r', prompt: 'P', systemPrompt: 'S', allowedTools: [] });
  assert.equal(opts.engine, 'codex');
});

test('runClaude({engine:"codex"}) spawns codex; mock mode still spawns nothing', POSIX, async () => {
  const dir = tmp();
  const bin = join(dir, 'codex');
  const argsOut = join(dir, 'args.json');
  const fixture = new URL('./fixtures/codex/exec-command.jsonl', import.meta.url).pathname;
  writeFileSync(bin, `#!/bin/sh\nnode -e 'require("fs").writeFileSync(${JSON.stringify(argsOut)}, JSON.stringify(process.argv.slice(1)))' -- "$@"\ncat > /dev/null\ncat ${JSON.stringify(fixture)}\n`);
  chmodSync(bin, 0o755);
  const events = [];
  const r = await runClaude({ engine: 'codex', bin, cwd: dir, prompt: 'P', onEvent: (e) => events.push(e) });
  assert.match(r.text, /hello$/);
  assert.equal(JSON.parse(readFileSync(argsOut, 'utf8'))[0], 'exec');
  assert.equal(events[0].sessionId, 'codex:00000000-0000-4000-8000-000000000001');
  const mocked = await runClaude({ engine: 'codex', mock: true, cwd: dir, prompt: 'x\nMOCK_ROLE: gatetest', onEvent: () => {} });
  assert.equal(mocked.exitCode, 0);
});

test('the claude adapter never resumes another engine\'s session', POSIX, async () => {
  const dir = tmp();
  const bin = join(dir, 'claude');
  const argsOut = join(dir, 'args.json');
  writeFileSync(bin, `#!/bin/sh\nnode -e 'require("fs").writeFileSync(${JSON.stringify(argsOut)}, JSON.stringify(process.argv.slice(1)))' -- "$@"\necho '{"type":"result","result":"ok"}'\n`);
  chmodSync(bin, 0o755);
  const events = [];
  await runClaude({ bin, cwd: dir, prompt: 'P', resumeSessionId: 'codex:th-1', onEvent: (e) => events.push(e) });
  assert.equal(JSON.parse(readFileSync(argsOut, 'utf8')).includes('--resume'), false);
  assert.ok(events.some((e) => e.type === 'stderr' && /belongs to another engine/.test(e.text)));
  const cursorEvents = [];
  await runClaude({ bin, cwd: dir, prompt: 'P', resumeSessionId: 'cursor:abc', onEvent: (e) => cursorEvents.push(e) });
  assert.equal(JSON.parse(readFileSync(argsOut, 'utf8')).includes('--resume'), false);
  assert.ok(cursorEvents.some((e) => e.type === 'stderr' && /belongs to another engine/.test(e.text)));
});

test('runOpts names the directories a node writes its outputs to', () => {
  const ctx = {
    projectDir: '/p', claudeOpts: { engine: 'codex' },
    outputs: { plan: { path: '/store/plans/x.md' }, answers: { path: '/pipe/clarify.json' }, done: { path: null } },
    verdict: { path: '/pipe/review.json' },
  };
  const opts = runOpts(ctx, { role: 'r', prompt: 'P', systemPrompt: 'S', allowedTools: [] });
  assert.deepEqual(opts.writableDirs, ['/store/plans', '/pipe']);
  assert.deepEqual(runOpts({ projectDir: '/p', claudeOpts: {} }, { role: 'r', prompt: 'P', systemPrompt: 'S', allowedTools: [] }).writableDirs, []);
  // A review handle names two files; the clarify step writes into the pipeline dir itself.
  const review = { projectDir: '/p', claudeOpts: {}, pipelineDir: '/pipe', outputs: { review: { kind: 'review', mdPath: '/store/reviews/r.md', jsonPath: '/pipe/r.json' } }, questionsFile: '/pipe/q.json' };
  assert.deepEqual(runOpts(review, { role: 'r', prompt: 'P', systemPrompt: 'S', allowedTools: [] }).writableDirs, ['/store/reviews', '/pipe']);
});

test('a codex run\'s own writable roots pass the Worca-home check: they live in the run store and the run\'s folder', async () => {
  const engine = ENGINES[0];
  const dir = tmp();
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  const seen = [];
  const look = (ctx) => {
    const o = runOpts(ctx, { role: 'r', prompt: 'P', systemPrompt: 'S', allowedTools: [] });
    seen.push({ cwd: o.cwd, roots: [...(o.addDirs || []), ...o.writableDirs] });
  };
  const runners = {
    producer: async (ctx) => { look(ctx); return { status: 'ok', summary: 'ok' }; },
    verifier: async (ctx) => { look(ctx); return { status: 'ok', issues: [], review: { issues: [] }, summary: '' }; },
  };
  const res = await engine.create({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true, engine: 'codex' }, runners }).run();
  assert.equal(res.status, 'done', res.error);
  assert.ok(seen.length > 1 && seen.some((s) => s.roots.some((r) => r.startsWith(worcaHome()))), JSON.stringify(seen));
  for (const s of seen) assert.deepEqual(codexRootsInWorcaHome(s), [], JSON.stringify(s));
});

test('a codex spawn gets the output dirs as writable roots (its sandbox allows the cwd only)', POSIX, async () => {
  const dir = tmp();
  const bin = join(dir, 'codex');
  const argsOut = join(dir, 'args.json');
  const fixture = new URL('./fixtures/codex/exec-command.jsonl', import.meta.url).pathname;
  writeFileSync(bin, `#!/bin/sh\nnode -e 'require("fs").writeFileSync(${JSON.stringify(argsOut)}, JSON.stringify(process.argv.slice(1)))' -- "$@"\ncat > /dev/null\ncat ${JSON.stringify(fixture)}\n`);
  chmodSync(bin, 0o755);
  await runClaude({ engine: 'codex', bin, cwd: dir, prompt: 'P', addDirs: ['/mem'], writableDirs: ['/store/plans', '/pipe', '/mem'], onEvent: () => {} });
  const args = JSON.parse(readFileSync(argsOut, 'utf8'));
  const added = args.flatMap((a, i) => (a === '--add-dir' ? [args[i + 1]] : []));
  assert.deepEqual(added, ['/mem', '/store/plans', '/pipe']);
});

test('a codex spawn reports its thread as the step session (pause/resume re-attaches it)', POSIX, async () => {
  // The harness stamps step.sessionId only from a runner `session` event without
  // `init` (the init copy is Ask Worca's). Without one, a paused codex node resumes fresh.
  const dir = tmp();
  const bin = join(dir, 'codex');
  const fixture = new URL('./fixtures/codex/exec-command.jsonl', import.meta.url).pathname;
  writeFileSync(bin, `#!/bin/sh\ncat > /dev/null\ncat ${JSON.stringify(fixture)}\n`);
  chmodSync(bin, 0o755);
  const events = [];
  await runClaude({ engine: 'codex', bin, cwd: dir, prompt: 'P', onEvent: (e) => events.push(e) });
  const stamped = events.filter((e) => e.type === 'session' && !e.init).map((e) => e.sessionId);
  assert.deepEqual(stamped, ['codex:00000000-0000-4000-8000-000000000001']);
});

test('a resume keeps the saved consent; a point without it is refused and stays paused', async () => {
  // The consent rides the resume point (claude.allowUnguardedEngine), so a resume that
  // names nothing keeps it. A point without it (written before the field) is refused before
  // resume()'s try: the paused row, its point and its checkout stay as they were.
  const engine = ENGINES[0];
  const dir = tmp();
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  let hang = true;
  let ref = null;
  const models = [];
  const runners = () => ({
    producer: async (ctx) => {
      models.push(ctx.claudeOpts.model);
      ctx.onEvent({ type: 'session', sessionId: 'codex:t-1' });
      if (hang) {
        hang = false;
        queueMicrotask(() => ref.pause());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      return { status: 'ok', summary: 'ok' };
    },
    verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
  });
  const claude = { mock: true, engine: 'codex', model: 'claude-sonnet-5' };
  ref = engine.create({ projectDir: dir, prompt: 'demo', auto: true, guardrailsId: 'normal', claude: { ...claude, allowUnguardedEngine: true }, runners: runners() });
  const first = await ref.run();
  assert.equal(first.status, 'paused');
  const id = ref.state.id;
  assert.equal(models[0], undefined, 'a Claude model never reaches the codex spawn');

  const saved = readPipelineForResume(id);
  assert.deepEqual(saved.resumePoint.claude, { model: 'claude-sonnet-5', engine: 'codex', allowUnguardedEngine: true });

  const bare = { ...saved, resumePoint: { ...saved.resumePoint, claude: { model: 'claude-sonnet-5', engine: 'codex' } } };
  ref = engine.create({ projectDir: dir, auto: true, claude: { mock: true }, runners: runners(), resume: bare });
  const gateNodes = await ref._engineGateNodes(bare.resumePoint);
  assert.ok(gateNodes.length > 0 && gateNodes.every((n) => n.key && Array.isArray(n.tools)), JSON.stringify(gateNodes));
  await assert.rejects(() => ref.resume(), /engine codex: guardrail set "normal" has permission rules this engine cannot enforce/);
  const kept = readPipelineForResume(id);
  assert.equal(kept.row.status, 'paused');
  assert.ok(kept.resumePoint, 'the resume point is kept');

  // The real saved point: no flags named, the engine and the consent come back.
  ref = engine.create({ projectDir: dir, auto: true, claude: { mock: true }, runners: runners(), resume: kept });
  assert.equal(ref.claude.engine, 'codex');
  assert.equal((await ref.resume()).status, 'done');
  assert.ok(models.slice(1).every((m) => m === undefined));
});

test('the MCP layer refusal runs at run start and before a resume touches the paused run', async () => {
  const engine = ENGINES[0];
  const dir = tmp();
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  const withCopies = (o) => { o._resolveMcp = async () => ({ result: { copies: [{ name: 'sentry_billing', setName: 'Billing' }], servers: { sentry_billing: { type: 'http', url: 'https://mcp.example/' } } }, catalog: {} }); return o; };
  const claude = { mock: true, engine: 'codex' };
  const runners = (onProduce) => ({
    producer: async (ctx) => onProduce(ctx),
    verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
  });
  const ok = () => ({ status: 'ok', summary: 'ok' });
  const refused = await withCopies(engine.create({ projectDir: dir, prompt: 'demo', auto: true, claude, runners: runners(ok) })).run();
  assert.equal(refused.status, 'error');
  assert.match(refused.error, /engine codex: this run attaches remote MCP servers \(sentry_billing\)/);
  // A paused codex run whose layer gained a copy since: the resume is refused and the row stays paused.
  let ref = null;
  ref = engine.create({ projectDir: dir, prompt: 'demo', auto: true, claude, runners: runners((ctx) => {
    queueMicrotask(() => ref.pause());
    return new Promise((_r, rej) => {
      const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
      if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
    });
  }) });
  assert.equal((await ref.run()).status, 'paused');
  const saved = readPipelineForResume(ref.state.id);
  await assert.rejects(() => withCopies(engine.create({ projectDir: dir, auto: true, claude, runners: runners(ok), resume: saved })).resume(),
    /engine codex: this run attaches remote MCP servers \(sentry_billing\)/);
  assert.equal(readPipelineForResume(ref.state.id).row.status, 'paused');
});

test("the project's own .claude/settings.json deny rules refuse a codex run too, unless allowed", async () => {
  const dir = tmp();
  execSync('mkdir -p .claude', { cwd: dir });
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Bash(rm:*)', 'Read(.env)'], allow: ['Bash(ls:*)'] } }));
  const mk = (claude) => withNodes(createOrchestrator({ projectDir: dir, claude: { mock: true, engine: 'codex', ...claude } }), {});
  const o = mk({});
  o._engineProjectRules = await o._engineChecks(() => true);
  assert.deepEqual(o._engineProjectRules, { deny: ['Bash(rm:*)', 'Read(.env)'] }, 'deny only: allow is never lifted');
  assert.throws(() => o._engineGate(), /the project's \.claude\/settings\.json denies Read\(\.env\), which this engine cannot enforce/);
  assert.equal(await o._engineChecks(() => false), null, 'a set that does not honor project settings reads none');
  const allowed = mk({ allowUnguardedEngine: true });
  allowed._engineProjectRules = await allowed._engineChecks(() => true);
  const lines = allowed._engineGate();
  assert.ok(lines.includes("engine codex: the project's .claude/settings.json deny rules NOT enforced on codex (--allow-unguarded-engine): Read(.env)"), lines.join('\n'));
  assert.ok(lines.includes(`engine codex: deny rules held on codex only in part, as command rules — ${REACH} (--allow-unguarded-engine): Bash(rm:*)`));
});

test("a single-project codex run's project deny rules reach every codex spawn and its rules file; Claude's spawns stay as they were", POSIX, async () => {
  const engine = ENGINES[0];
  const dir = tmp();
  execSync('git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  execSync('mkdir -p .claude', { cwd: dir });
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Bash(git push:*)'] } }));
  const make = (claude) => engine.create({ projectDir: dir, prompt: 'x', auto: true, branch: { source: 'main' }, claude: { mock: true, ...claude } });
  // Without the consent the Permissive set's run is refused: the command rule holds only in part.
  assert.deepEqual(await make({ engine: 'codex' }).engineStartRefusal(), {
    error: `engine codex: the project's .claude/settings.json denies Bash(git push:*), which this engine holds only in part: ${REACH} — pass --allow-unguarded-engine to run it with them as a partial guard`,
    overridable: true,
  });
  const o = make({ engine: 'codex', allowUnguardedEngine: true });
  const seen = [];
  engine.spyCtx(o, seen);
  assert.equal((await o.run()).status, 'done');
  assert.ok(seen.length >= 3, 'several nodes ran');
  for (const { key, claudeOpts: c } of seen) assert.deepEqual(c.permissionRules, { deny: ['Bash(git push:*)'] }, key);
  // What the spawn gets lands in the managed CODEX_HOME's rules file.
  const fake = fakeCodex(dir, 'ok');
  await runClaude({ engine: 'codex', bin: fake.bin, cwd: dir, prompt: 'P', permissionRules: seen[0].claudeOpts.permissionRules, onEvent: () => {} });
  assert.match(readFileSync(join(fake.env().CODEX_HOME, 'rules', 'worca.rules'), 'utf8'), /pattern=\["git","push"\], decision="forbidden"/);
  // Claude Code reads the project's file itself: its spawns carry no copy.
  const c = make({});
  const claudeSeen = [];
  engine.spyCtx(c, claudeSeen);
  assert.equal((await c.run()).status, 'done');
  for (const { key, claudeOpts: co } of claudeSeen) assert.equal(co.permissionRules, undefined, key);
});

test("a real (non-mock) codex run checks the engine's binary and sign-in before anything else", POSIX, async () => {
  const dir = tmp();
  const out = join(dir, 'codex-out');
  writeFileSync(out, '#!/bin/sh\necho "Not logged in"\nexit 1\n');
  chmodSync(out, 0o755);
  const real = (bin) => createOrchestrator({ projectDir: dir, claude: { engine: 'codex', bin } });
  await assert.rejects(() => real(out)._engineChecks(() => true), /engine codex: .*codex-out is not signed in — run `codex login`/);
  await assert.rejects(() => real(join(dir, 'missing'))._engineChecks(() => true), /engine codex: cannot run .*missing \(ENOENT\)/);
  // A mock run spawns nothing, so it checks nothing.
  assert.equal(await createOrchestrator({ projectDir: dir, claude: { mock: true, engine: 'codex', bin: out } })._engineChecks(() => true), null);
});

test('engineStartRefusal answers before a run exists, and says when the consent would lift it', async () => {
  const dir = tmp();
  const make = (claude, extra = {}) => createOrchestrator({ projectDir: dir, ...extra, claude: { mock: true, ...claude } });
  assert.equal(await make({}).engineStartRefusal(), null, 'Claude: nothing to check');
  assert.equal(await make({ engine: 'codex' }).engineStartRefusal(), null, 'the Permissive set has no rules');

  const strict = make({ engine: 'codex' }, { guardrailsId: 'normal' });
  assert.deepEqual(await strict.engineStartRefusal(), {
    error: 'engine codex: guardrail set "normal" has permission rules this engine cannot enforce (Read(.env*), Edit(.env*), Read(*.pem) (+28 more)) — run it with the Permissive set, or pass --allow-unguarded-engine to run it without them',
    overridable: true,
  });
  assert.equal(await make({ engine: 'codex', allowUnguardedEngine: true }, { guardrailsId: 'normal' }).engineStartRefusal(), null);
  // Secure was already refused for its path rules; WebFetch now joins the rules it lists, and the consent still lifts it.
  const secure = await make({ engine: 'codex' }, { guardrailsId: 'secure' }).engineStartRefusal();
  assert.equal(secure.overridable, true);
  assert.match(secure.error, /guardrail set "secure" has permission rules this engine cannot enforce/);
  assert.equal(await make({ engine: 'codex', allowUnguardedEngine: true }, { guardrailsId: 'secure' }).engineStartRefusal(), null);

  const prev = process.env.WORCA_BROKER_URL;
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9';
  try {
    const r = await strict.engineStartRefusal();
    assert.equal(r.overridable, false, 'the consent cannot lift the broker refusal');
    assert.match(r.error, /^engine codex: the credential broker is on/);
  } finally {
    if (prev === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prev;
  }
});

test('engineStartRefusal reports an MCP registry layer as not liftable', async () => {
  // The same stub as the MCP refusal test above (:84): _resolveMcp is the only seam.
  const HTTP = { type: 'http', url: 'https://mcp.example/' };
  const layer = (copies) => async () => ({ result: { copies, servers: Object.fromEntries(copies.map((c) => [c.name, HTTP])) }, catalog: {} });
  const o = createOrchestrator({ projectDir: tmp(), claude: { mock: true, engine: 'codex', allowUnguardedEngine: true } });
  o._resolveMcp = layer([{ name: 'sentry_billing', setName: 'Billing' }]);
  assert.deepEqual(await o.engineStartRefusal(), {
    error: 'engine codex: this run attaches remote MCP servers (sentry_billing), and codex attaches stdio servers only',
    overridable: false,
  });
  // Rules AND copies: the consent would lift only the rules, so the answer is the copies, not liftable.
  const both = createOrchestrator({ projectDir: tmp(), guardrailsId: 'normal', claude: { mock: true, engine: 'codex' } });
  both._resolveMcp = layer([{ name: 'pg' }]);
  const r = await both.engineStartRefusal();
  assert.equal(r.overridable, false);
  assert.match(r.error, /attaches remote MCP servers \(pg\)/);
});

test('engineStartRefusal reports a failed preflight as not liftable', POSIX, async () => {
  // A non-mock run, so the adapter preflight runs. The same signed-out fake binary as the
  // real-preflight test below (:328-338), written inline.
  const dir = tmp();
  const bin = join(dir, 'codex-out');
  writeFileSync(bin, '#!/bin/sh\necho "Not logged in"\nexit 1\n');
  chmodSync(bin, 0o755);
  const r = await createOrchestrator({ projectDir: dir, claude: { engine: 'codex', bin } }).engineStartRefusal();
  assert.equal(r.overridable, false);
  assert.match(r.error, /^engine codex: .*codex-out is not signed in/);
});

test('engineStartRefusal logs nothing: a preflight warning is left to run()', POSIX, async () => {
  // A binary whose `login status` says nothing recognizable: the preflight warns, it
  // does not refuse. Logged here, the line would sit in the log writer's pre-bind buffer
  // and reach the run log twice (once from here, once from run()).
  const dir = tmp();
  const bin = join(dir, 'codex-vague');
  writeFileSync(bin, '#!/bin/sh\necho "hmm"\nexit 0\n');
  chmodSync(bin, 0o755);
  const o = createOrchestrator({ projectDir: dir, claude: { engine: 'codex', bin } });
  const logs = [];
  o.on('log', (l) => logs.push(l));
  assert.equal(await o.engineStartRefusal(), null);
  assert.deepEqual(logs, [], JSON.stringify(logs));
  // The run-start gate itself still warns (unchanged).
  await o._engineChecks(() => true);
  assert.ok(logs.some((l) => /could not tell whether .*codex-vague is signed in/.test(l.text)), JSON.stringify(logs));
});

test('engineStartRefusal leaves an unexpected error to run()', async () => {
  const o = createOrchestrator({ projectDir: tmp(), claude: { mock: true, engine: 'codex' } });
  o._resolveMcp = async () => { throw new Error('registry store unreadable'); };
  assert.equal(await o.engineStartRefusal(), null, 'no early answer; run() reports it on the run');
});

test('a legacy workspace node may write every member worktree; a detached one has them under its cwd', () => {
  const workspace = { projects: [{ projectKey: 'a', worktreeDir: '/repo-a/.worca-cc/worktrees/p1' }, { projectKey: 'b', worktreeDir: '/repo-b/.worca-cc/worktrees/p1' }] };
  const base = { projectDir: '/repo-a/.worca-cc/worktrees/p1', claudeOpts: { engine: 'codex' }, pipelineDir: '/pipe', workspace };
  const legacy = runOpts({ ...base, runRoot: null }, { role: 'r', prompt: 'P', systemPrompt: 'S', allowedTools: [] });
  assert.deepEqual(legacy.writableDirs, ['/pipe', '/repo-a/.worca-cc/worktrees/p1', '/repo-b/.worca-cc/worktrees/p1']);
  const detached = runOpts({ ...base, runRoot: '/runs/p1', projectDir: '/runs/p1' }, { role: 'r', prompt: 'P', systemPrompt: 'S', allowedTools: [] });
  assert.deepEqual(detached.writableDirs, ['/pipe']);
});

test('a codex catalog id is not a Claude model: kept on codex, dropped on Claude and for the Claude-only calls', () => {
  assert.equal(orch({ engine: 'codex' })._engineModel('gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.equal(orch()._engineModel('gpt-5.6-sol'), undefined, 'Claude never gets a codex id');
  assert.equal(orch({ model: 'gpt-5.6-sol' })._claudeCallModel(), null);
  const lines = withNodes(orch({ engine: 'codex', model: 'gpt-5.6-sol' }), { n1: { key: 'planner', tools: [], model: 'gpt-5.5' } })._engineGate();
  assert.equal(lines.filter((l) => / is a Claude model /.test(l)).length, 0, 'codex ids are not named as Claude models');
});

test('a node keeps its model only on the engine that owns it; a dropped model takes its effort along', () => {
  const codexRun = orch({ engine: 'codex', model: 'gpt-5.6-sol' });
  assert.deepEqual(codexRun._nodeModelPair({ model: 'claude-opus-5-5', effort: 'max' }), { model: 'gpt-5.6-sol', effort: undefined });
  assert.deepEqual(codexRun._nodeModelPair({ model: 'gpt-5.5', effort: 'low' }), { model: 'gpt-5.5', effort: 'low' });
  assert.deepEqual(orch({ engine: 'codex' })._nodeModelPair({ model: 'claude-opus-5-5', effort: 'max' }), { model: undefined, effort: undefined });
  const claudeRun = orch({ model: 'claude-opus-5-5' });
  assert.deepEqual(claudeRun._nodeModelPair({ model: 'gpt-5.5', effort: 'low' }), { model: 'claude-opus-5-5', effort: undefined });
  assert.deepEqual(claudeRun._nodeModelPair({ effort: 'high' }), { model: 'claude-opus-5-5', effort: 'high' }, 'an effort without a node model rides the run model, as before');
  assert.deepEqual(claudeRun._nodeModelPair({ model: 'claude-sonnet-5', effort: 'xhigh' }), { model: 'claude-sonnet-5', effort: 'xhigh' });
  assert.deepEqual(orch()._nodeModelPair({ model: 'my-proxy-model', effort: 'high' }), { model: 'my-proxy-model', effort: 'high' }, 'an id no catalog knows is never dropped on Claude');
});

test('runClaude forwards sandbox: a read-only codex spawn gets no writable dir', POSIX, async () => {
  const dir = tmp();
  const codex = fakeCodex(dir, 'ok');
  await runClaude({ engine: 'codex', bin: codex.bin, cwd: dir, prompt: 'P', sandbox: 'read-only', addDirs: ['/mem'], writableDirs: ['/pipe'], onEvent: () => {} });
  const args = codex.args();
  assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), ['--sandbox', 'read-only']);
  assert.equal(args.includes('--add-dir'), false);
});

test('the mock records the engine, sandbox and model of every spawn', async () => {
  const dir = tmp();
  await runClaude({ engine: 'codex', mock: true, cwd: dir, prompt: 'x\nMOCK_ROLE: gatetest', sandbox: 'read-only', model: 'gpt-5.5', onEvent: () => {} });
  assert.deepEqual(mockSpawnLog.at(-1), { engine: 'codex', sandbox: 'read-only', model: 'gpt-5.5' });
  await runClaude({ mock: true, cwd: dir, prompt: 'x\nMOCK_ROLE: gatetest', onEvent: () => {} });
  assert.deepEqual(mockSpawnLog.at(-1), { engine: 'claude', sandbox: null, model: null });
});

// ── Cursor (engines/cursor.mjs) ──────────────────────────────────────────────

const NORMAL_RULES = async () => guardrailsToPermissionRules((await readGuardrailSet('normal')).settings);

test('cursor: Permissive passes, one audit line per missing capability', () => {
  const lines = withNodes(orch({ engine: 'cursor' }), {})._engineGate();
  const caps = lines.filter((l) => /^engine cursor: no \w+ — /.test(l));
  assert.deepEqual(caps.map((l) => l.split(':')[1].trim().split(' ')[1]).sort(),
    ['allowedTools', 'cost', 'effort', 'hookTelemetry', 'skills', 'subagentSystemPrompt', 'subagents', 'systemPromptFlag', 'turnBudget']);
  assert.ok(lines.includes('engine cursor: no cost — cost cells stay blank and totals stay 0 (cost unknown, not free)'), lines.join('\n'));
});

test('cursor holds every rule only in part: the Normal set needs --allow-unguarded-engine, then says what it holds', async () => {
  const rules = await NORMAL_RULES();
  const o = withNodes(orch({ engine: 'cursor' }), {});
  o.guardrailPermissionRules = rules;
  o.guardrailsId = 'normal';
  assert.throws(() => o._engineGate(), (err) => /holds only in part|cannot enforce/.test(err.message));
  const allowed = withNodes(orch({ engine: 'cursor', allowUnguardedEngine: true }), {});
  allowed.guardrailPermissionRules = rules;
  allowed.guardrailsId = 'normal';
  const lines = allowed._engineGate();
  assert.ok(lines.some((l) => l.startsWith('engine cursor: deny rules held on cursor only in part, as permission-file rules — worca writes them to .cursor/cli.json')), lines.join('\n'));
  assert.ok(lines.some((l) => /^engine cursor: guardrail set "normal": rules NOT enforced on cursor .*Bash\(git push\)/.test(l)), lines.join('\n'));
});

test('engineStartRefusal: a cursor refusal is liftable by the consent', async () => {
  const r = await createOrchestrator({ projectDir: tmp(), guardrailsId: 'normal', claude: { mock: true, engine: 'cursor' } }).engineStartRefusal();
  assert.equal(r.overridable, true);
  assert.match(r.error, /holds only in part|cannot enforce/);
});

test('cursor: a pipeline or total cost limit says it cannot count Cursor\'s spend; codex says nothing new', async () => {
  await withCatalogHome(async (home) => {
    mkdirSync(join(home, '.worca-cc'), { recursive: true });
    writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ pipelineCostLimitUsd: 5, totalCostLimitUsd: 50 }));
    const lines = withNodes(orch({ engine: 'cursor' }), {})._engineGate();
    assert.ok(lines.includes("engine cursor: the pipeline cost limit cannot count cursor's spend (cost unknown)"), lines.join('\n'));
    assert.ok(lines.includes("engine cursor: the total cost limit cannot count cursor's spend (cost unknown)"), lines.join('\n'));
    assert.equal(withNodes(orch({ engine: 'codex' }), {})._engineGate().some((l) => /cost limit/.test(l)), false);
    writeFileSync(join(home, '.worca-cc', 'settings.json'), '{}');
    const team = withNodes(orch({ engine: 'cursor' }), {});
    team.policyRun = { fields: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 3 }, 'cost.totalLimitUsd': { kind: 'soft', value: 30 } } };
    const t = team._engineGate();
    assert.ok(t.includes("engine cursor: the pipeline cost limit cannot count cursor's spend (cost unknown)"), t.join('\n'));
    assert.ok(t.includes("engine cursor: the total cost limit cannot count cursor's spend (cost unknown)"), t.join('\n'));
    assert.equal(withNodes(orch({ engine: 'cursor' }), {})._engineGate().some((l) => /cost limit/.test(l)), false, 'no cap, no line');
  });
});

test('engineStartRefusal: a signed-out cursor-agent is not liftable', POSIX, async () => {
  const prevKey = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    const fake = fakeCursor(tmp(), 'x', { statusText: 'Not logged in', statusExit: 1 });
    const r = await createOrchestrator({ projectDir: tmp(), claude: { engine: 'cursor', bin: fake.bin } }).engineStartRefusal();
    assert.equal(r.overridable, false);
    assert.match(r.error, /not signed in/);
  } finally {
    if (prevKey !== undefined) process.env.CURSOR_API_KEY = prevKey;
  }
});

test('a result with no cost warns on a reporting engine, not on cursor; a per-Mtok model warns on any engine', async () => {
  await withCatalogHome(async () => {
    await addGlobalModel({ id: 'gate-priced', cost: { perMtok: { input: 1, output: 2 } } });
    const warns = (engine, model = null) => {
      const o = createOrchestrator({ projectDir: tmp(), claude: { engine } });
      const logs = [];
      o.on('log', (l) => { if (l.level === 'warn') logs.push(String(l.text)); });
      o._onResultEvent('implementer', { type: 'result', text: 'ok', isError: false }, { stepKey: 's1', model });
      return logs;
    };
    assert.ok(warns('codex').some((t) => /result event carried no cost estimate/.test(t)));
    assert.equal(warns('cursor').some((t) => /no cost estimate/.test(t)), false);
    assert.ok(warns('cursor', 'gate-priced').some((t) => /priced per-Mtok but the result carried no token usage/.test(t)));
  });
});

// The Cursor files in the §8.8 set, the commit and the diffs (run-harness _registerEngineConfig, _injectedFor,
// _engineConfigState). A real linked worktree, so the adapter's info/exclude lines land in the SHARED common dir.
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const CLI = '{"permissions":{"deny":["Shell(curl)"]}}\n';
const MCP = '{"mcpServers":{"w":{"command":"x"}}}\n';
const AGENT_MCP = '{"mcpServers":{"agent":{"command":"y"}}}\n';
function linkedWorktree({ ignore = null } = {}) {
  const repo = tmp();
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 't@t']); git(repo, ['config', 'user.name', 't']);
  writeFileSync(join(repo, 'seed.txt'), 'seed\n');
  if (ignore) writeFileSync(join(repo, '.gitignore'), ignore);
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'init']);
  const wt = join(tmp(), 'wt');
  git(repo, ['worktree', 'add', '-q', '-b', 'feat/cursor', wt]);
  return { repo, wt, base: git(wt, ['rev-parse', 'HEAD']).trim() };
}
function harnessOn(wt, { engine = 'cursor', base = null } = {}) {
  const o = createOrchestrator({ projectDir: '/tmp/gate-proj-cursor', claude: { mock: true, engine } });
  o.workDirs = new Map([['pk', wt]]);
  o.runCwd = wt;
  o.checkpointRefs = base ? { pk: base } : {};
  o.injectedPaths = {};
  return o;
}
/** worca wrote both files (owned, with both exclude lines), then the agent replaced mcp.json (its deliverable). */
function cursorCheckout(wt) {
  writeCursorProjectFiles(wt, { '.cursor/cli.json': CLI, '.cursor/mcp.json': MCP });
  writeFileSync(join(wt, '.cursor', 'mcp.json'), AGENT_MCP);
  writeFileSync(join(wt, 'a.txt'), 'agent work\n');
}
const tree = (cwd, ref) => git(cwd, ['ls-tree', '-r', '--name-only', ref]).split('\n').filter(Boolean);
/** _commitWork the way every teardown caller does: the state first, then the commit, then the removal. */
async function teardownCommit(o, wt) {
  const ec = await o._engineConfigState(wt, { ignoreAbort: true });
  const commit = await o._commitWork({ worktreeDir: wt, branch: 'feat/cursor' }, null,
    { excludePathspecs: o._excludePathspecs('pk'), forcePaths: ec.forced, unstagePaths: ec.owned });
  await removeInjectedPaths(wt, o._injectedFor('pk', wt));
  return commit;
}

test('_registerEngineConfig: a cursor run registers both files beside the memory entry, idempotently, and into run.json', async () => {
  const { wt } = linkedWorktree();
  const o = harnessOn(wt);
  o.injectedPaths = { pk: [{ path: '.claude/rules/worca', kind: 'memory', source: null }] };
  await o._registerEngineConfig();
  await o._registerEngineConfig();
  assert.deepEqual(o.injectedPaths.pk, [
    { path: '.claude/rules/worca', kind: 'memory', source: null },
    { path: '.cursor/cli.json', kind: 'engineConfig', source: null },
    { path: '.cursor/mcp.json', kind: 'engineConfig', source: null },
  ]);
  // A detached workspace run: the run root is the cwd, and the manifest gets the set too.
  const root = tmp();
  await writeRunManifest(root, { pipelineId: 'p', injectedPaths: {} });
  const d = harnessOn(wt);
  d.runRoot = root; d.runCwd = root;
  await d._registerEngineConfig();
  assert.deepEqual(d.injectedPaths.runRoot.map((e) => e.path), ['.cursor/cli.json', '.cursor/mcp.json']);
  assert.deepEqual((await readRunManifest(root)).injectedPaths.runRoot.map((e) => e.kind), ['engineConfig', 'engineConfig']);
});

test('_registerEngineConfig: a claude or codex run registers only a file worca wrote, and never runs git', async () => {
  const { wt } = linkedWorktree();
  for (const engine of ['claude', 'codex']) {
    const o = harnessOn(wt, { engine });
    let gitCalls = 0;
    const realGit = o._git.bind(o);
    o._git = (...a) => { gitCalls++; return realGit(...a); };
    await o._registerEngineConfig();
    assert.deepEqual(o.injectedPaths, {}, `${engine}: no .cursor file`);
    mkdirSync(join(wt, '.cursor'), { recursive: true });
    writeFileSync(join(wt, '.cursor', 'cli.json'), '{"mine":true}');
    await o._registerEngineConfig();
    assert.deepEqual(o.injectedPaths, {}, `${engine}: someone else's file`);
    assert.equal(gitCalls, 0);
    rmSync(join(wt, '.cursor'), { recursive: true, force: true });
  }
  // A resume that switched a cursor run to claude: the cursor segment's own file is still registered.
  writeCursorProjectFiles(wt, { '.cursor/cli.json': CLI });
  const switched = harnessOn(wt, { engine: 'claude' });
  await switched._registerEngineConfig();
  assert.deepEqual(switched.injectedPaths.pk, [{ path: '.cursor/cli.json', kind: 'engineConfig', source: null }]);
});

test('_injectedFor drops a .cursor entry whose file is not worca\'s; _excludePathspecs never names a .cursor file', async () => {
  const { wt } = linkedWorktree();
  const o = harnessOn(wt);
  o.injectedPaths = { pk: [{ path: '.claude/rules/worca', kind: 'memory', source: null }] };
  await o._registerEngineConfig();
  assert.deepEqual(o._injectedFor('pk').map((e) => e.path), ['.claude/rules/worca', '.cursor/cli.json', '.cursor/mcp.json'], 'absent files keep their entries');
  mkdirSync(join(wt, '.cursor'), { recursive: true });
  writeFileSync(join(wt, '.cursor', 'mcp.json'), AGENT_MCP);
  assert.deepEqual(o._injectedFor('pk').map((e) => e.path), ['.claude/rules/worca', '.cursor/cli.json']);
  writeCursorProjectFiles(wt, {});   // leaves the agent's file alone
  rmSync(join(wt, '.cursor', 'mcp.json'));
  writeCursorProjectFiles(wt, { '.cursor/mcp.json': MCP });
  assert.deepEqual(o._injectedFor('pk').map((e) => e.path), ['.claude/rules/worca', '.cursor/cli.json', '.cursor/mcp.json']);
  assert.deepEqual(o._excludePathspecs('pk'), [':(exclude).claude/rules/worca']);
  assert.equal(o._excludePathspecs('pk').some((x) => x.startsWith(':(exclude).cursor')), false);
});

test('teardown commit with worca\'s exclude lines present: commits, keeps worca\'s file out, carries the agent\'s', async () => {
  const { wt } = linkedWorktree();
  const o = harnessOn(wt);
  await o._registerEngineConfig();
  cursorCheckout(wt);
  const commit = await teardownCommit(o, wt);
  assert.equal(commit.ok, true, JSON.stringify(commit));
  assert.equal(commit.committed, true);
  const files = tree(wt, 'HEAD');
  assert.ok(files.includes('a.txt'));
  assert.ok(files.includes('.cursor/mcp.json'), 'the agent\'s deliverable is committed');
  assert.ok(!files.includes('.cursor/cli.json'), 'worca\'s own file stays out');
  assert.ok(!existsSync(join(wt, '.cursor', 'cli.json')), 'worca\'s file is removed');
  assert.equal(readFileSync(join(wt, '.cursor', 'mcp.json'), 'utf8'), AGENT_MCP, 'the agent\'s file is kept');
});

test('teardown commit: an agent .cursor file alone still commits', async () => {
  const { wt } = linkedWorktree();
  const o = harnessOn(wt);
  writeCursorProjectFiles(wt, { '.cursor/cli.json': CLI, '.cursor/mcp.json': MCP });
  writeFileSync(join(wt, '.cursor', 'mcp.json'), AGENT_MCP);
  assert.equal(git(wt, ['status', '--porcelain']), '', 'porcelain lists nothing');
  const commit = await teardownCommit(o, wt);
  assert.equal(commit.committed, true, JSON.stringify(commit));
  assert.deepEqual(git(wt, ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n'), ['.cursor/mcp.json']);
});

test('teardown commit: the user\'s own ignore rules win both ways', async () => {
  const ignored = linkedWorktree({ ignore: '.cursor/\n' });
  cursorCheckout(ignored.wt);
  const a = harnessOn(ignored.wt);
  assert.deepEqual(await a._engineConfigState(ignored.wt), { owned: ['.cursor/cli.json'], forced: [] });
  assert.equal((await teardownCommit(a, ignored.wt)).ok, true);
  assert.ok(!tree(ignored.wt, 'HEAD').some((f) => f.startsWith('.cursor/')), 'a .cursor/ rule keeps the agent file out');

  const unignored = linkedWorktree({ ignore: '!.cursor/cli.json\n' });
  cursorCheckout(unignored.wt);
  const b = harnessOn(unignored.wt);
  assert.equal((await teardownCommit(b, unignored.wt)).ok, true);
  assert.ok(!tree(unignored.wt, 'HEAD').includes('.cursor/cli.json'), 'worca\'s file is unstaged even when un-ignored');
});

test('_engineConfigState: owned and forced, no git without a .cursor file, the user\'s ignore decides', async () => {
  const { wt } = linkedWorktree();
  const o = harnessOn(wt);
  let gitCalls = 0;
  const realGit = o._git.bind(o);
  o._git = (...a) => { gitCalls++; return realGit(...a); };
  assert.deepEqual(await o._engineConfigState(wt), { owned: [], forced: [] });
  assert.equal(gitCalls, 0);
  cursorCheckout(wt);
  assert.deepEqual(await o._engineConfigState(wt), { owned: ['.cursor/cli.json'], forced: ['.cursor/mcp.json'] });
  writeFileSync(join(wt, '.gitignore'), '!.cursor/mcp.json\n');
  assert.deepEqual((await o._engineConfigState(wt)).forced, [], 'a negation decides: plain add -A stages it');
});

test('a later claude run in the same repository still commits the agent\'s .cursor file (no registration needed)', async () => {
  const { wt } = linkedWorktree();
  cursorCheckout(wt);
  rmSync(join(wt, '.cursor', 'cli.json'));
  const o = harnessOn(wt, { engine: 'claude' });
  await o._registerEngineConfig();
  assert.deepEqual(o.injectedPaths, {});
  assert.deepEqual(await o._engineConfigState(wt), { owned: [], forced: ['.cursor/mcp.json'] });
  await teardownCommit(o, wt);
  assert.ok(tree(wt, 'HEAD').includes('.cursor/mcp.json'));
});

test('the diffs: staging and liveDiff list the agent\'s .cursor file, never worca\'s', async () => {
  const { wt, base } = linkedWorktree();
  const o = harnessOn(wt, { base });
  cursorCheckout(wt);
  const live = await o.liveDiff();
  const paths = live.results.newFiles.map((f) => f.path);
  assert.ok(paths.includes('.cursor/mcp.json'), JSON.stringify(paths));
  assert.ok(!paths.includes('.cursor/cli.json'));
  const warns = [];
  o.on('log', (l) => { if (l.level === 'warn') warns.push(String(l.text)); });
  await o._stageWorkingTree();
  const ns = git(wt, ['diff', '--name-status', base]);
  assert.match(ns, /^A\t\.cursor\/mcp\.json$/m);
  assert.doesNotMatch(ns, /cli\.json/);
  assert.equal(warns.some((t) => /git add -A -N/.test(t)), false, warns.join('\n'));
  assert.deepEqual((await o._engineConfigState(wt)).forced, [], 'an intent-to-add entry is never forced again');
  assert.equal((await teardownCommit(o, wt)).ok, true);
  assert.ok(tree(wt, 'HEAD').includes('.cursor/mcp.json'));
});

test('a tracked agent .cursor file is never forced: unchanged it is not in liveDiff, changed it is an M', async () => {
  const { wt, base } = linkedWorktree();
  cursorCheckout(wt);
  git(wt, ['add', '-f', '.cursor/mcp.json']);
  git(wt, ['commit', '-qm', 'agent mcp']);
  const o = harnessOn(wt, { base: git(wt, ['rev-parse', 'HEAD']).trim() });
  assert.deepEqual((await o._engineConfigState(wt)).forced, []);
  const unchanged = await o.liveDiff();
  assert.ok(![...unchanged.results.newFiles, ...unchanged.results.changedFiles].some((f) => f.path === '.cursor/mcp.json'));
  writeFileSync(join(wt, '.cursor', 'mcp.json'), '{"mcpServers":{}}\n');
  const changed = await o.liveDiff();
  assert.ok(changed.results.changedFiles.some((f) => f.path === '.cursor/mcp.json'), JSON.stringify(changed.results));
  assert.equal((await teardownCommit(o, wt)).ok, true);
  assert.equal(git(wt, ['show', 'HEAD:.cursor/mcp.json']), '{"mcpServers":{}}\n');
  assert.ok(base);
});

test('_engineConfigState in a subdirectory of a plain repo: the exclude source resolves against the top', async () => {
  const repo = tmp();
  git(repo, ['init', '-q']);
  const sub = join(repo, 'sub');
  mkdirSync(join(sub, '.cursor'), { recursive: true });
  writeFileSync(join(repo, '.git', 'info', 'exclude'), '/sub/.cursor/mcp.json\n');
  writeFileSync(join(sub, '.cursor', 'mcp.json'), AGENT_MCP);
  assert.deepEqual(await harnessOn(sub)._engineConfigState(sub), { owned: [], forced: ['.cursor/mcp.json'] });
});

test('stopPaused registers the Cursor files even when memory never mounted, and a failure there never fails the stop', { timeout: 120000 }, async () => {
  const run = async () => {
    const dir = tmp();
    execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
    let orchRef = null;
    const o1 = createOrchestrator({
      projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true, engine: 'cursor' },
      runners: {
        producer: async (ctx) => {
          queueMicrotask(() => orchRef.pause());
          return new Promise((_r, rej) => {
            const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
            if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
          });
        },
        verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
      },
    });
    orchRef = o1;
    assert.equal((await o1.run()).status, 'paused');
    rmSync(o1._memoryLedgerPath(), { force: true });   // memory never mounted
    return { dir, saved: readPipelineForResume(o1.state.id) };
  };
  const a = await run();
  const o2 = createOrchestrator({ projectDir: a.dir, claude: { mock: true, engine: 'cursor' }, auto: true, resume: a.saved });
  const seen = [];
  const real = o2._registerEngineConfig.bind(o2);
  o2._registerEngineConfig = async () => { await real(); seen.push(Object.values(o2.injectedPaths || {}).flat().filter((e) => e.kind === 'engineConfig').map((e) => e.path)); };
  assert.equal((await o2.stopPaused('ada')).status, 'stopped');
  assert.deepEqual(seen.at(-1), ['.cursor/cli.json', '.cursor/mcp.json']);

  const b = await run();
  const o3 = createOrchestrator({ projectDir: b.dir, claude: { mock: true, engine: 'cursor' }, auto: true, resume: b.saved });
  const logs = [];
  o3.on('log', (l) => logs.push(String(l.text)));
  o3._registerEngineConfig = async () => { throw new Error('boom'); };
  assert.equal((await o3.stopPaused('ada')).status, 'stopped');
  assert.ok(logs.some((t) => /stop: Cursor's \.cursor config was not registered for removal \(boom\)/.test(t)), logs.join('\n'));
});

test('legacy teardown on a cursor run: the kept branch carries the agent\'s .cursor/mcp.json and never worca\'s cli.json', { timeout: 120000 }, async () => {
  const prevMode = process.env.WORCA_RUN_ROOT;
  process.env.WORCA_RUN_ROOT = 'legacy';
  try {
    const repo = tmp();
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 't@t']); git(repo, ['config', 'user.name', 't']);
    writeFileSync(join(repo, 'seed.txt'), 'seed\n');
    git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'init']);
    const pipelineDir = tmp();
    const o = createOrchestrator({ projectDir: repo, prompt: 'x', auto: true, claude: { mock: true, engine: 'cursor' },
      branch: { source: 'main', feature: 'feat/cursor-td' } });
    o.pipeline = { id: 'p-cursor', dir: pipelineDir, promptText: 'x' };
    o.state.id = 'p-cursor';
    o.state.pipelineDir = pipelineDir;
    o.checkpointRef = git(repo, ['rev-parse', 'HEAD']).trim();
    await o._setupRunRoot();
    const wt = o.workDir;
    assert.notEqual(wt, repo);
    await o._registerEngineConfig();
    cursorCheckout(wt);
    o.state.status = 'done';
    await o._teardownWorktree();
    const branch = o.getState().branch;
    assert.equal(branch.commitFailed, undefined, JSON.stringify(branch.commitFailed));
    const files = tree(repo, branch.feature);
    assert.ok(files.includes('a.txt'), files.join(','));
    assert.ok(files.includes('.cursor/mcp.json'), 'the agent\'s deliverable is committed');
    assert.ok(!files.includes('.cursor/cli.json'), 'worca\'s own file never is');
  } finally {
    if (prevMode === undefined) delete process.env.WORCA_RUN_ROOT; else process.env.WORCA_RUN_ROOT = prevMode;
  }
});
