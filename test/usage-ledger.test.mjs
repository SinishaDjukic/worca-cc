// test/usage-ledger.test.mjs
// The usage ledger (plans/core-protection-layer-design.md §4.3): the harness's _bookUsage is the one place a step's
// spend changes. A relayed spawn's measured spend is booked on every exit exactly once, a routed result's own figures
// never; an unpriced model or a cost:false engine leaves the step's cost unknown (never a known $0); with a cost cap such
// a run is refused at start, and a step that turns unknown mid-run pauses the run once. The per-engine exit matrix is
// conformance row C-LEDGER (test/engine-conformance.test.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { E2bExecEnv } from '../src/core/exec-env/e2b-env.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { runCopilotProcess } from '../src/core/engines/copilot.mjs';
import { createCursorNormalizer } from '../src/core/engines/cursor.mjs';
import { setPipelineCostLimitUsd, setTotalCostLimitUsd } from '../src/core/settings.mjs';
import { setCostCapOverride } from '../src/core/cost-budget.mjs';
import { runCostLabel, costKnownOf } from '../src/shared/engine-switch.mjs';
import { priceRelayUsage } from '../src/core/exec-env/relay-usage.mjs';
import { scratchDirs, fixture, makeEnvOpts } from './helpers/e2b-fixture.mjs';
import { fakeCopilot } from './helpers/fake-copilot.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'e2b mode is POSIX-only' : false, timeout: 90_000 };
const KEY = 'sk-ant-ledger-0123456789abcdef';
useTempHome(after, 'worca-usage-ledger-home-');
const { tmp, cleanup } = scratchDirs();
// Settings (the cost caps, catalog prices) live under $HOME/.worca-cc: never the developer's real file.
const userHome = mkdtempSync(join(tmpdir(), 'worca-usage-ledger-user-'));
const saved = {};
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK', 'ORCH_MOCK', 'WORCA_BROKER_URL', 'PATH'];
before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  Object.assign(process.env, { HOME: userHome, USERPROFILE: userHome, WORCA_TEST_ALLOW_HOME_FALLBACK: '1' });
  for (const k of ['WORCA_MOCK', 'ORCH_MOCK', 'WORCA_BROKER_URL']) delete process.env[k];
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(userHome, { recursive: true, force: true });
  cleanup();
});

const fmt = (n) => `$${Number(n).toFixed(2)}`;
const RELAY = { messages: 2, byModel: { 'claude-sonnet-5': { input_tokens: 2000, output_tokens: 1000, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 } } };

/** An orchestrator whose state holds one step row (as test/exec-env-relay-cost.test.mjs unitHarness builds it). */
function unitHarness(stepKey, model = 'claude-sonnet-5', claude = { mock: true }) {
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'worca-usage-ledger-unit'), claude });
  orch._persist = async () => {};
  orch.state.steps.push({ key: stepKey, executionId: stepKey, nodeId: stepKey.split(':')[1], costUsd: 0 });
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  let booked = 0;
  const rec = orch._recordCost.bind(orch);
  orch._recordCost = (...a) => { booked += 1; return rec(...a); };
  return { orch, logs, attr: { stepKey, executionId: stepKey, model }, booked: () => booked };
}

test('a routed result\'s own figures are never booked', () => {
  const { orch, logs, attr, booked } = unitHarness('x:n_impl:1');
  orch._onAgentEvent('implementer', { type: 'result', relay: { messages: 0, byModel: {} }, costUsd: 9, usage: { input_tokens: 5, output_tokens: 5 } }, attr);
  assert.equal(booked(), 0, 'nothing measured, nothing booked: the sandbox\'s $9 is a claim');
  assert.equal(orch.state.steps[0].costKnown, undefined, 'the cost is not unknown: nothing was spent at the relay');
  assert.equal(orch.state.steps[0].usage, undefined, 'the claimed tokens are not tallied');
  assert.equal(logs.filter((l) => l.level === 'warn' && /the model relay measured \$0\.0000 \(0 model replies\)/.test(l.text)).length, 1);
  orch._onAgentEvent('implementer', { type: 'spend', source: 'relay', ...RELAY }, attr);
  assert.equal(booked(), 1);
  assert.equal(orch.state.steps[0].costUsd, 0.0141, 'the relay\'s take is booked once');
  assert.deepEqual(orch.state.steps[0].usage, { input: 2000, output: 1000, cacheRead: 400, cacheWrite: 0 });
});

test('an unpriced model is booked at the fallback rate and reads as part unknown, never $0.00', () => {
  const { orch } = unitHarness('x:n_impl:1');
  const relay = { source: 'relay', messages: 1, byModel: { 'mystery-model': { input_tokens: 10000, output_tokens: 5000 } } };
  orch._bookUsage(relay, { stepKey: 'x:n_impl:1', model: null });
  const step = orch.state.steps[0];
  assert.equal(step.costKnown, false);
  assert.deepEqual(step.usage, { input: 10000, output: 5000, cacheRead: 0, cacheWrite: 0 }, 'its tokens are still counted');
  // Audit 2.8: the highest list rate (UNPRICED_RATES), so a cost cap still counts it; the label says it is a floor.
  const fallback = priceRelayUsage(relay, null).costUsd;
  assert.ok(fallback > 0.01, String(fallback));
  assert.equal(step.costUsd, fallback);
  assert.equal(runCostLabel('claude', orch.state.totalCostUsd, fmt, costKnownOf(orch.state)), `≥ ${fmt(fallback)} (part unknown)`);
  orch._bookUsage({ source: 'engine', costUsd: 0.5 }, { stepKey: 'x:n_impl:1', model: 'claude-sonnet-5' });
  assert.equal(runCostLabel('claude', orch.state.totalCostUsd, fmt, costKnownOf(orch.state)), `≥ ${fmt(fallback + 0.5)} (part unknown)`);
});

test('the result warnings keep their texts and need no step', () => {
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'worca-usage-ledger-warn'), claude: { engine: 'codex', bin: '/nonexistent/worca-test/codex' } });
  const logs = [];
  o.on('log', (l) => logs.push(l));
  o._onResultEvent('r', { type: 'result' }, { stepKey: 'nope' });
  assert.ok(logs.some((l) => l.level === 'warn' && l.text === 'result event carried no cost estimate (total_cost_usd absent)'), JSON.stringify(logs));
  o._onResultEvent('r', { type: 'result' }, { stepKey: 'nope' });
  assert.equal(logs.filter((l) => /total_cost_usd absent/.test(l.text)).length, 1, 'once per step');
});

test('a stopped step with floored turns is cost unknown', () => {
  const { orch, attr, booked } = unitHarness('x:n_impl:1');
  orch._onAgentEvent('implementer', { type: 'usage', phase: 'message', parentId: null, messageId: 'm1', usage: { input_tokens: 2000, output_tokens: 1000 } }, attr);
  orch._closeOpenTurns('x:n_impl:1');
  const step = orch.state.steps[0];
  assert.equal(step.stoppedTurns.turns, 1, 'the floor is kept, as before');
  assert.equal(step.costUsd, 0, 'the floor is display-only: never booked');
  assert.equal(booked(), 0);
  assert.equal(step.costKnown, false, 'a stopped step never reads as a known figure');
});

test('a row handed off to a resumed run is never touched from here', () => {
  const { orch } = unitHarness('x:n_impl:1');
  let persisted = 0;
  orch._persist = async () => { persisted += 1; };
  orch._rowHandedOff = () => true;
  orch._bookUsage({ source: 'engine', result: true, usage: { input_tokens: 5, output_tokens: 5 } }, { stepKey: 'x:n_impl:1', model: 'claude-sonnet-5' });
  assert.equal(persisted, 0);
  assert.equal(orch.state.steps[0].usage, undefined);
  assert.equal(orch.state.steps[0].costKnown, undefined);
});

test('copilot local tokens survive exit 1', { skip: process.platform === 'win32' }, async () => {
  const dir = tmp('worca-ledger-copilot-');
  const usage = { modelMetrics: { 'gpt-5.4': { requests: { count: 1, cost: 0 }, usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 100, cacheWriteTokens: 0, reasoningTokens: 0 } } } };
  const f = fakeCopilot(dir, { fixture: new URL('./fixtures/copilot/auth-error.jsonl', import.meta.url).pathname, code: 1, usage });
  const events = [];
  await assert.rejects(runCopilotProcess({ cwd: dir, bin: f.bin, prompt: 'P', usageDir: dir, scratchBase: join(dir, 'scratch'), onEvent: (e) => events.push(e) }));
  const spend = events.filter((e) => e.type === 'spend');
  assert.equal(spend.length, 1, JSON.stringify(events.map((e) => e.type)));
  assert.equal(spend[0].source, 'engine');
  assert.deepEqual(spend[0].usage, { input_tokens: 900, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 50 });
});

test('cursor\'s error result carries its usage', () => {
  const n = createCursorNormalizer({});
  const out = n.push(JSON.stringify({ type: 'result', is_error: true, result: 'boom', usage: { input_tokens: 12, output_tokens: 3 } }));
  assert.deepEqual(out, [{ type: 'result', text: '', isError: true, usage: { input_tokens: 12, output_tokens: 3 } }]);
  assert.equal(n.finish().error, 'boom', 'the turn still failed');
  assert.deepEqual(createCursorNormalizer({}).push(JSON.stringify({ type: 'result', is_error: true, result: 'boom' })), [], 'no usage, no result');
});

// ── cost caps ──
const withNodes = (o, nodes) => { o.resolved = { nodeCtx: nodes }; return o; };
const gateOrch = (claude) => createOrchestrator({ projectDir: join(tmpdir(), 'worca-usage-ledger-cap'), guardrailsId: 'permissive', claude: { mock: true, ...claude } });

test('cost cap refuses unknown cost', async () => {
  await setPipelineCostLimitUsd(5);
  try {
    const copilot = withNodes(gateOrch({ engine: 'copilot' }), { a: { nodeId: 'a', kind: 'agent', model: null } });
    assert.match(copilot._engineRefusal({ nodes: Object.values(copilot.resolved.nodeCtx) }), /^Copilot reports no cost, and the pipeline cost limit cannot count what this run spends/);
    const claude = withNodes(gateOrch({}), { a: { nodeId: 'a', kind: 'agent', model: 'mystery-model' } });
    assert.match(claude._engineRefusal({ nodes: Object.values(claude.resolved.nodeCtx) }), /^model "mystery-model" has no price, and the pipeline cost limit/);
    const codex = withNodes(gateOrch({ engine: 'codex', model: 'claude-sonnet-5' }), { a: { nodeId: 'a', kind: 'agent', model: null } });
    assert.equal(codex._engineRefusal({ nodes: Object.values(codex.resolved.nodeCtx) }), null, 'the Claude id is dropped on codex: its priced default runs');
    // R4: an engine that prices its own calls (Goose, OpenCode) starts under a cap only on a model worca can price. The
    // consent (allowed) lifts every overridable refusal, never the cap's.
    for (const engine of ['goose', 'opencode']) {
      const unpriced = withNodes(gateOrch({ engine, model: 'google/gemini-3-flash' }), { a: { nodeId: 'a', kind: 'agent', model: 'google/gemini-3-flash' } });
      assert.match(unpriced._engineRefusal({ nodes: Object.values(unpriced.resolved.nodeCtx), allowed: true }), /^model "google\/gemini-3-flash" has no price, and the pipeline cost limit/, engine);
      const priced = withNodes(gateOrch({ engine, model: 'anthropic/claude-sonnet-5-5' }), { a: { nodeId: 'a', kind: 'agent', model: 'anthropic/claude-sonnet-5-5' } });
      assert.equal(priced._engineRefusal({ nodes: Object.values(priced.resolved.nodeCtx), allowed: true }), null, `${engine}: Anthropic's list price`);
    }
  } finally { await setPipelineCostLimitUsd(''); }
  const copilot = withNodes(gateOrch({ engine: 'copilot' }), { a: { nodeId: 'a', kind: 'agent', model: null } });
  assert.equal(copilot._engineRefusal({ nodes: Object.values(copilot.resolved.nodeCtx) }), null, 'without a cap it starts');
  const claude = withNodes(gateOrch({}), { a: { nodeId: 'a', kind: 'agent', model: 'mystery-model' } });
  assert.equal(claude._engineRefusal({ nodes: Object.values(claude.resolved.nodeCtx) }), null);
  const lines = claude._engineGate();
  assert.deepEqual(lines.filter((l) => /has no price/.test(l)), ['engine claude: model "mystery-model" has no price — its spend is booked as cost unknown']);
});

test("a cost:false engine books worca's own aux call as a known figure", () => {
  const { orch, booked } = unitHarness('x:n_impl:1', null, { mock: true, engine: 'cursor' });
  assert.equal(orch._bookUsage({ source: 'engine', costUsd: 0.02, aux: 'away' }, { stepKey: 'x:n_impl:1', model: null }), 0.02);
  const step = orch.state.steps[0];
  assert.equal(booked(), 1);
  assert.deepEqual(step.auxCosts.away, { usd: 0.02, calls: 1 });
  assert.equal(step.costKnown, undefined, 'worca priced its own call: the step is not cost unknown');
  assert.equal(orch._costUnknownPending ?? null, null, 'and no cap pause is armed');
  orch._bookUsage({ source: 'engine', costUsd: 0.5 }, { stepKey: 'x:n_impl:1', model: null });
  assert.equal(step.costKnown, false, "the agent's own spend on Cursor stays unknown");
});

test('an unknown step under a cap pauses once', async () => {
  await setPipelineCostLimitUsd(5);
  try {
    const make = async () => {
      const orch = createOrchestrator({ projectDir: '/tmp/usage-ledger-proj' });
      const { id, dir } = await seedPipeline('/tmp/usage-ledger-proj-a', { status: 'running' });
      orch.pipeline = { id, dir };
      Object.assign(orch.state, { id, status: 'running', phase: 'implement', steps: [{ key: 'x:n_impl:1', costUsd: 0 }] });
      return { orch, id };
    };
    const { orch } = await make();
    orch._bookUsage({ source: 'relay', messages: 1, byModel: { 'mystery-model': { input_tokens: 1, output_tokens: 1 } } }, { stepKey: 'x:n_impl:1', model: null });
    assert.throws(() => orch._checkCostLimits(), (e) => e.name === 'PauseError');
    assert.equal(orch.pauseReason, 'cost_pipeline');
    assert.doesNotThrow(() => orch._checkCostLimits(), 'once per transition');
    orch._bookUsage({ source: 'relay', messages: 1, byModel: { 'mystery-model': { input_tokens: 1, output_tokens: 1 } } }, { stepKey: 'x:n_impl:1', model: null });
    assert.doesNotThrow(() => orch._checkCostLimits(), 'a second unknown reply on the same step does not pause the run again');
    const other = await make();
    setCostCapOverride(other.id);
    other.orch._bookUsage({ source: 'relay', messages: 1, byModel: { 'mystery-model': { input_tokens: 1, output_tokens: 1 } } }, { stepKey: 'x:n_impl:1', model: null });
    assert.doesNotThrow(() => other.orch._checkCostLimits(), 'the per-pipeline override is honoured');
  } finally { await setPipelineCostLimitUsd(''); }
  // A total (windowed) cap alone: the same pause, on the total's reason.
  await setTotalCostLimitUsd(50);
  try {
    const orch = createOrchestrator({ projectDir: '/tmp/usage-ledger-proj' });
    const { id, dir } = await seedPipeline('/tmp/usage-ledger-proj-b', { status: 'running' });
    orch.pipeline = { id, dir };
    Object.assign(orch.state, { id, status: 'running', phase: 'implement', steps: [{ key: 'x:n_impl:1', costUsd: 0 }] });
    orch._bookUsage({ source: 'relay', messages: 1, byModel: { 'mystery-model': { input_tokens: 1, output_tokens: 1 } } }, { stepKey: 'x:n_impl:1', model: null });
    assert.throws(() => orch._checkCostLimits(), (e) => e.name === 'PauseError');
    assert.equal(orch.pauseReason, 'cost_total');
  } finally { await setTotalCostLimitUsd(''); }
});

// ── a relayed spawn on the fake E2B whose `claude` is a real process (an abort reaches it) ──
const sse = (frames) => frames.map((f) => `event: ${f.type}\ndata: ${JSON.stringify(f)}\n\n`).join('');
const START = { type: 'message_start', message: { id: 'm1', type: 'message', model: 'claude-sonnet-5', usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } };

/** A stand-in for api.anthropic.com that answers every Messages call with message_start and then, per `mode`, cuts the
 *  socket ('cut') or holds the stream open until the client goes ('hold'). */
async function upstream(t, mode) {
  const requests = []; const held = [];
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      requests.push(req.url); held.push(res);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(sse([START]));
      if (mode === 'cut') setTimeout(() => res.socket.destroy(), 20);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => { srv.closeAllConnections(); srv.close(); });
  return { url: `http://127.0.0.1:${srv.address().port}`, requests, held };
}

/** A `claude` on PATH for the fake sandbox: one streamed Messages call at the relay, read to its end, then exit `code`. */
function claudeShim(t, code) {
  const bin = tmp('worca-ledger-bin-');
  const script = join(bin, 'claude-shim.mjs');
  writeFileSync(script, `const env = process.env;
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }));
try {
  const r = await fetch(env.ANTHROPIC_BASE_URL + '/v1/messages', { method: 'POST',
    headers: { authorization: 'Bearer ' + env.ANTHROPIC_AUTH_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', stream: true, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }) });
  await r.text();
} catch { /* the stream broke */ }
process.exit(${code});
`);
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const prev = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${prev}`;
  t.after(() => { process.env.PATH = prev; });
}

async function shimEnv(t) {
  const seen = {};
  const sdk = createFakeE2b({ root: tmp('worca-ledger-root-'), onCommand: (cmd, o) => { if (cmd.startsWith("'claude'")) seen.envs = o.envs; return null; } });
  const f = fixture(tmp);
  const env = new E2bExecEnv(makeEnvOpts(tmp, sdk, f, { env: {} }));
  await env.start();
  t.after(() => env.close('test'));
  return { env, f, seen };
}

test('broken stream books measured tokens once', POSIX, async (t) => {
  const up = await upstream(t, 'cut');
  claudeShim(t, 1);
  const { env, f } = await shimEnv(t);
  const events = [];
  await assert.rejects(runClaude({ cwd: f.repo, prompt: 'hi', model: 'claude-sonnet-5', execEnv: env,
    modelEnv: { ANTHROPIC_BASE_URL: up.url, ANTHROPIC_API_KEY: KEY }, onEvent: (e) => events.push(e) }), /exited with code 1/);
  const carrying = events.filter((e) => (e.type === 'spend' && e.messages) || (e.type === 'result' && e.relay?.messages));
  assert.equal(carrying.length, 1, JSON.stringify(events.map((e) => e.type)));
  assert.equal(carrying[0].byModel['claude-sonnet-5'].input_tokens, 1000, 'the relay committed the cut reply');
  const { orch, attr, booked } = unitHarness('x:n_impl:1');
  for (const e of events) orch._onAgentEvent('implementer', e, attr);
  orch._closeOpenTurns('x:n_impl:1');
  assert.equal(booked(), 1);
  assert.equal(orch.state.steps[0].usage.input, 1000);
  assert.equal(env.relay.routes.size, 0, 'the route closed with the spawn');
});

test('a reply still streaming when its spawn ends is booked once it ends, as a second spend', POSIX, async (t) => {
  const up = await upstream(t, 'hold');
  claudeShim(t, 0);
  const { env, f, seen } = await shimEnv(t);
  const events = [];
  const ac = new AbortController();
  const run = runClaude({ cwd: f.repo, prompt: 'hi', model: 'claude-sonnet-5', execEnv: env, signal: ac.signal,
    modelEnv: { ANTHROPIC_BASE_URL: up.url, ANTHROPIC_API_KEY: KEY }, onEvent: (e) => events.push(e) });
  const atReject = run.then(() => null, (err) => ({ err, events: events.slice() }));
  for (let i = 0; !up.requests.length && i < 600; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(up.requests.length, 1, 'the call reached the upstream and is still streaming');
  ac.abort();
  const { err, events: seenAtReject } = await atReject;
  assert.equal(err?.name, 'AbortError');
  // The drain's wait ended with the reply still streaming: the close's spend has nothing yet, and the call runs on
  // (the sandbox cannot cut a reply short of its usage, audit 2.3/2.4).
  const spend = seenAtReject.find((e) => e.type === 'spend');
  assert.ok(spend, 'the close\'s spend came before the spawn settled');
  assert.equal(spend.messages, 0);
  up.held[0].end();
  for (let i = 0; events.filter((e) => e.type === 'spend').length < 2 && i < 400; i++) await new Promise((r) => setTimeout(r, 25));
  const late = events.filter((e) => e.type === 'spend');
  assert.equal(late.length, 2, 'one more spend once the reply ended');
  assert.equal(late[1].messages, 1);
  assert.equal(late[1].byModel['claude-sonnet-5'].input_tokens, 1000, 'the reply that outlived its spawn is booked');
  const again = await fetch(`${seen.envs.ANTHROPIC_BASE_URL}/v1/messages`, { method: 'POST',
    headers: { authorization: `Bearer ${seen.envs.ANTHROPIC_AUTH_TOKEN}`, 'content-type': 'application/json' }, body: '{"model":"claude-sonnet-5"}' });
  assert.equal(again.status, 403);
  assert.match((await again.json()).error.message, /unknown or ended route/);
});
