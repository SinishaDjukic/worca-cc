// test/engine-gate.test.mjs — choosing an engine for a run (plans/harness-bridge-design.md §10):
// the run-start gate (refusals + degradation audit), the per-node ctx a non-Claude engine
// gets, and runClaude's dispatch by engine name.
import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { runOpts } from '../src/core/phases.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { ENGINES } from './helpers/engines.mjs';
import { fakeCodex } from './helpers/fake-codex.mjs';
import { mockSpawnLog } from '../src/core/claude-runner.mjs';
import { CODEX_DEFAULT_MODEL } from '../src/core/engines/codex.mjs';

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
const RULES = { deny: ['Bash(curl:*)'] };

test('an unknown engine fails at construction', () => {
  assert.throws(() => orch({ engine: 'codx' }), /unknown engine "codx"/);
  // The mock stands in for Claude under --mock only; it is not a run engine.
  assert.throws(() => orch({ engine: 'mock' }), /"mock" is not a run engine \(choose one of: claude, codex\); the offline mock runs under --mock/);
});

test('claude (the default) passes the gate with nothing to say', () => {
  const o = orch();
  assert.equal(o.claude.engine, 'claude');
  o.guardrailPermissionRules = RULES;
  assert.deepEqual(o._engineGate(), []);
});

test('codex: every missing capability is one audit line with its fallback', () => {
  const lines = withNodes(orch({ engine: 'codex' }), {})._engineGate();
  assert.deepEqual(lines.map((l) => l.split(':')[1].trim().split(' ')[1]).sort(),
    ['allowedTools', 'hookTelemetry', 'permissionRules', 'skills', 'subagentSystemPrompt', 'subagents', 'turnBudget']);
  assert.ok(lines.every((l) => /^engine codex: no \w+ — .{10,}$/.test(l)), lines.join('\n'));
});

test('codex refuses a run whose guardrail set has permission rules it cannot enforce', () => {
  const o = withNodes(orch({ engine: 'codex' }), {});
  o.guardrailPermissionRules = RULES;
  o.guardrailsId = 'strict';
  assert.throws(() => o._engineGate(), /engine codex: guardrail set "strict" has permission rules this engine cannot enforce/);
});

test('--allow-unguarded-engine runs it anyway and says so in the audit', () => {
  const o = withNodes(orch({ engine: 'codex', allowUnguardedEngine: true }), {});
  o.guardrailPermissionRules = RULES;
  o.guardrailsId = 'strict';
  const lines = o._engineGate();
  assert.ok(lines.some((l) => /guardrail set "strict": permission rules NOT enforced on codex \(--allow-unguarded-engine\)/.test(l)));
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

test('codex refuses a model routed to a custom endpoint (the model bridge included)', async () => {
  const home = tmp();
  const prev = { HOME: process.env.HOME, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try {
    await addGlobalModel({ id: 'gate-onprem', env: { ANTHROPIC_BASE_URL: 'https://p' } });
    const o = withNodes(orch({ engine: 'codex' }), { n1: { key: 'planner', tools: [], model: 'gate-onprem' } });
    assert.throws(() => o._engineGate(), /model "gate-onprem" is routed to a custom endpoint/);
  } finally {
    process.env.HOME = prev.HOME;
    if (prev.ALLOW === undefined) delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK; else process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = prev.ALLOW;
  }
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

test('the node ctx on codex: engine named, fan-out off (no grantable sub-agent tool)', () => {
  const o = orch({ engine: 'codex' });
  const c = o._engineNodeOpts({ fanOut: true });
  assert.deepEqual(c, { engine: 'codex', subagents: false, fanOut: false });
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
  assert.throws(() => o._engineGate(), /the project's \.claude\/settings\.json denies Bash\(rm:\*\), Read\(\.env\), which this engine cannot enforce/);
  assert.equal(await o._engineChecks(() => false), null, 'a set that does not honor project settings reads none');
  const allowed = mk({ allowUnguardedEngine: true });
  allowed._engineProjectRules = await allowed._engineChecks(() => true);
  assert.ok(allowed._engineGate().some((l) => l === "engine codex: the project's .claude/settings.json deny rules NOT enforced on codex (--allow-unguarded-engine): Bash(rm:*), Read(.env)"));
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
    error: 'engine codex: guardrail set "normal" has permission rules this engine cannot enforce — run it with the Permissive set, or pass --allow-unguarded-engine to run it without them',
    overridable: true,
  });
  assert.equal(await make({ engine: 'codex', allowUnguardedEngine: true }, { guardrailsId: 'normal' }).engineStartRefusal(), null);

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
