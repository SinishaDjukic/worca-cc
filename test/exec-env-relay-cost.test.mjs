// test/exec-env-relay-cost.test.mjs
// Security evaluation 2026-10-21, E4: in a sandbox, Claude Code's stream-json is the sandbox's word — root there can
// write any `result` frame to the CLI's stdout. worca's half of the model relay sees every upstream reply, so it
// meters their `usage` per route and the harness books that, keeping the sandbox's cost as a cross-check only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { E2bExecEnv } from '../src/core/exec-env/e2b-env.mjs';
import { createRouteMeter, priceRelayUsage } from '../src/core/exec-env/relay-usage.mjs';
import { UNPRICED_RATES } from '../src/broker/usage.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { createClaudeNormalizer } from '../src/core/engines/claude-events.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';
import { scratchDirs, fixture, makeEnvOpts } from './helpers/e2b-fixture.mjs';
import { startFakeUpstream } from './helpers/fake-model-upstream.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'e2b mode is POSIX-only' : false, timeout: 60_000 };
const KEY = 'sk-ant-relay-cost-0123456789abcdef';
useTempHome(after, 'worca-relay-cost-home-');
// Settings live under $HOME/.worca-cc: the priced model below must never reach the developer's real file.
const userHome = mkdtempSync(join(tmpdir(), 'worca-relay-cost-user-'));
const saved = {};
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK', 'ORCH_MOCK', 'WORCA_BROKER_URL'];
let up;
const { tmp, cleanup } = scratchDirs();
before(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  Object.assign(process.env, { HOME: userHome, USERPROFILE: userHome, WORCA_TEST_ALLOW_HOME_FALLBACK: '1' });
  for (const k of KEYS.slice(3)) delete process.env[k];
  up = await startFakeUpstream({ validKeys: [KEY] });
  up.set?.({ streamDelayMs: 5 });
});
after(async () => {
  await up?.close();
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(userHome, { recursive: true, force: true });
  cleanup();
});

const sse = (frames) => frames.map((f) => `event: ${f.type}\ndata: ${JSON.stringify(f)}\n\n`).join('');
const START = { type: 'message_start', message: { id: 'm1', type: 'message', model: 'claude-sonnet-5', usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 } } };
const DELTA = { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 500 } };

test('the route meter reads usage from an SSE reply split anywhere, and from one JSON message', () => {
  const meter = createRouteMeter();
  const bytes = Buffer.from(sse([START, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'héllo ✓' } }, DELTA, { type: 'message_stop' }]));
  for (const step of [1, 3, 7, 64]) {
    const r = meter.reply();
    for (let i = 0; i < bytes.length; i += step) r.push(bytes.subarray(i, i + step));
    r.end();
  }
  const json = meter.reply();
  json.push(Buffer.from(JSON.stringify({ type: 'message', model: 'claude-haiku-5', usage: { input_tokens: 10, output_tokens: 5 } })));
  json.end();
  const counted = meter.reply();                          // count_tokens: no message, nothing billed
  counted.push(Buffer.from('{"input_tokens":42}')); counted.end();
  const junk = meter.reply(); junk.push(Buffer.from('data: {not json\n\n')); junk.end();
  const got = meter.take();
  assert.equal(got.messages, 5);
  assert.deepEqual(got.byModel['claude-sonnet-5'], { input_tokens: 4000, output_tokens: 2000, cache_read_input_tokens: 800, cache_creation_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } });
  assert.equal(got.byModel['claude-haiku-5'].output_tokens, 5);
  assert.deepEqual(meter.take(), { messages: 0, byModel: {} }, 'a take hands over what it counted once');
});

test('a reply cut off after message_start still counts what the upstream reported', () => {
  const meter = createRouteMeter();
  const r = meter.reply(); r.push(Buffer.from(sse([START]))); r.end();
  assert.equal(meter.take().byModel['claude-sonnet-5'].input_tokens, 1000);
});

test('pricing: list price per reply model; the dispatched model\'s own override wins; an unknown model is named', async () => {
  const relay = { messages: 1, byModel: { 'claude-sonnet-5': { input_tokens: 2000, output_tokens: 1000, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 } } };
  const listed = priceRelayUsage(relay, 'sonnet');
  assert.ok(Math.abs(listed.costUsd - 0.01408) < 1e-9, String(listed.costUsd));   // 2000×2 + 1000×10 + 400×0.2 per Mtok
  assert.deepEqual(listed.unpriced, []);
  await addGlobalModel({ id: 'free-gw', label: 'Free gateway', cost: { free: true } });
  assert.deepEqual(priceRelayUsage(relay, 'free-gw'), { costUsd: 0, unpriced: [] });
  const odd = priceRelayUsage({ messages: 1, byModel: { 'gw-odd': { input_tokens: 1e6, output_tokens: 1e6 } } }, null);
  assert.deepEqual(odd.unpriced, ['gw-odd']);
  assert.equal(odd.costUsd, UNPRICED_RATES.input + UNPRICED_RATES.output, 'an unpriced model books at the fallback rate, never $0 (audit 2.8)');
});

/** An E2B env on the loopback fake whose `claude` makes `calls` streamed model calls through the relay, then prints
 *  `lines` — whatever the sandbox chooses to say about them. */
async function sandboxClaude(t, { calls = 1, lines }) {
  const sdk = createFakeE2b({ root: tmp('worca-relay-cost-root-'), onCommand: async (cmd, o) => {
    if (!cmd.startsWith("'claude'")) return null;
    for (let i = 0; i < calls; i++) {
      const r = await fetch(`${o.envs.ANTHROPIC_BASE_URL}/v1/messages`, { method: 'POST',
        headers: { authorization: `Bearer ${o.envs.ANTHROPIC_AUTH_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-5', stream: true, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }) });
      await r.text();
    }
    return { lines: lines.map((l) => JSON.stringify(l)), exitCode: 0 };
  } });
  const f = fixture(tmp);
  const env = new E2bExecEnv(makeEnvOpts(tmp, sdk, f, { env: {} }));
  await env.start();
  t.after(() => env.close('test'));
  const events = [];
  const normalize = createClaudeNormalizer();
  await runClaude({ cwd: f.repo, prompt: 'hi', model: 'claude-sonnet-5', execEnv: env,
    modelEnv: { ANTHROPIC_BASE_URL: up.url, ANTHROPIC_API_KEY: KEY }, onEvent: (e) => events.push(...normalize(e)) });
  return { env, events };
}

const INIT = { type: 'system', subtype: 'init', session_id: 's1' };
const FORGED = { type: 'result', subtype: 'success', session_id: 's1', result: 'all good', total_cost_usd: 0.000001, usage: { input_tokens: 1, output_tokens: 1 } };

test('a remote result carries what the relay measured, whatever the sandbox printed', POSIX, async (t) => {
  const { events } = await sandboxClaude(t, { calls: 2, lines: [INIT, FORGED] });
  const result = events.find((e) => e.type === 'result');
  assert.ok(result, JSON.stringify(events));
  assert.equal(result.costUsd, 0.000001, 'the sandbox\'s figure rides along, for the cross-check');
  assert.equal(result.relay.messages, 2);
  const u = result.relay.byModel['claude-sonnet-5'];
  assert.equal(u.input_tokens, 2000); assert.equal(u.output_tokens, 1000); assert.equal(u.cache_read_input_tokens, 400);
  const close = events.filter((e) => e.type === 'spend');
  assert.deepEqual(close, [{ type: 'spend', source: 'relay', messages: 0, byModel: {} }], 'the close books nothing more: the result took it all');
});

test('a remote spawn that printed no result still hands over what the relay measured', POSIX, async (t) => {
  const { events, env } = await sandboxClaude(t, { calls: 1, lines: [INIT] });
  assert.equal(events.some((e) => e.type === 'result'), false);
  const rest = events.find((e) => e.type === 'spend' && e.source === 'relay');
  assert.ok(rest, JSON.stringify(events));
  assert.equal(rest.messages, 1);
  assert.equal(rest.byModel['claude-sonnet-5'].output_tokens, 500);
  assert.equal(env.relay.routes.size, 0, 'the route closed with the spawn');
});

function unitHarness(stepKey, model = 'claude-sonnet-5') {
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'worca-relay-cost-unit'), claude: { mock: true } });
  orch._persist = async () => {};
  orch.state.steps.push({ key: stepKey, executionId: stepKey, nodeId: stepKey.split(':')[1], costUsd: 0 });
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  return { orch, logs, attr: { stepKey, executionId: stepKey, model } };
}
const RELAY = { messages: 2, byModel: { 'claude-sonnet-5': { input_tokens: 2000, output_tokens: 1000, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 } } };

test('the harness books the relay\'s figure for a remote result and flags a sandbox figure far from it', () => {
  const { orch, logs, attr } = unitHarness('x:n_impl:1');
  orch._onAgentEvent('implementer', { type: 'result', text: 'all good', costUsd: 0.000001, cumulativeCost: true, sessionId: 's1', usage: { input_tokens: 1, output_tokens: 1 }, relay: RELAY }, attr);
  assert.equal(orch.state.steps[0].costUsd, 0.0141);
  const warn = logs.find((l) => l.level === 'warn' && /model relay measured/.test(l.text));
  assert.ok(warn, JSON.stringify(logs));
  assert.match(warn.text, /the sandbox reported \$0\.0000 .*the model relay measured \$0\.0141.*books the relay's figure/);
});

test('a sandbox figure close to the relay\'s is booked as measured, with no warning', () => {
  const { orch, logs, attr } = unitHarness('x:n_impl:1');
  orch._onAgentEvent('implementer', { type: 'result', costUsd: 0.0139, cumulativeCost: true, sessionId: 's1', relay: RELAY }, attr);
  assert.equal(orch.state.steps[0].costUsd, 0.0141);
  assert.equal(logs.some((l) => /model relay measured/.test(l.text)), false);
});

test('a model the relay cannot price books at the fallback rate, never at the sandbox\'s figure (audit 2.8)', () => {
  // A step with no model of its own (Codex's default): the sandbox calls a model with no list price and claims ~$0.
  const unpriced = { messages: 1, byModel: { 'o9-pro-unlisted': { input_tokens: 1e6, output_tokens: 1e6 } } };
  const fallback = UNPRICED_RATES.input + UNPRICED_RATES.output;
  for (const claim of [0.000001, 999]) {
    const { orch, logs, attr } = unitHarness('x:n_impl:1', null);
    orch._onAgentEvent('implementer', { type: 'result', costUsd: claim, relay: unpriced }, attr);
    // The ledger holds max(claim, measured) for an unpriced model: a forged ~$0 claim books the fallback.
    assert.equal(orch.state.steps[0].costUsd, Math.max(claim, fallback), `claim ${claim}`);
    assert.ok(logs.some((l) => l.level === 'warn' && /no price for o9-pro-unlisted/.test(l.text)), JSON.stringify(logs));
  }
  const rest = unitHarness('x:n_impl:1', null);
  rest.orch._onAgentEvent('implementer', { type: 'spend', source: 'relay', ...unpriced }, rest.attr);
  assert.equal(rest.orch.state.steps[0].costUsd, fallback, 'also for calls no result covered');
  const mixed = unitHarness('x:n_impl:1', 'gw-odd');
  mixed.orch._onAgentEvent('implementer', { type: 'result', costUsd: 0, relay: { messages: 2, byModel: { ...RELAY.byModel, 'gw-odd': { input_tokens: 0, output_tokens: 0 } } } }, mixed.attr);
  assert.equal(mixed.orch.state.steps[0].costUsd, 0.0141, 'the priced part as measured');
});

test('calls no result covered are booked from the relay when the spawn ends; their open turns are not counted again', () => {
  const { orch, attr } = unitHarness('x:n_impl:1');
  orch._onAgentEvent('implementer', { type: 'usage', phase: 'message', parentId: null, messageId: 'm1', usage: { input_tokens: 2000, output_tokens: 1000 } }, attr);
  orch._onAgentEvent('implementer', { type: 'spend', source: 'relay', ...RELAY }, attr);
  assert.equal(orch.state.steps[0].costUsd, 0.0141);
  orch._closeOpenTurns('x:n_impl:1');
  assert.equal(orch.state.steps[0].stoppedTurns, undefined, 'the relay priced those turns');
});

/** An E2B env on the loopback fake whose `claude` starts one streamed model call and lets go of it: `hangup` reads the
 *  first bytes and hangs up; `leave` exits with the reply still streaming. The usage comes last (message_delta). */
async function sandboxLetsGo(t, how) {
  up.set({ streamDelayMs: 400 });
  t.after(() => up.set({ streamDelayMs: 5 }));
  const sdk = createFakeE2b({ root: tmp('worca-relay-cost-root-'), onCommand: async (cmd, o) => {
    if (!cmd.startsWith("'claude'")) return null;
    const ac = new AbortController();
    const r = await fetch(`${o.envs.ANTHROPIC_BASE_URL}/v1/messages`, { method: 'POST', signal: ac.signal,
      headers: { authorization: `Bearer ${o.envs.ANTHROPIC_AUTH_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5', stream: true, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }) });
    if (how === 'hangup') { await r.body.getReader().read(); ac.abort(); }
    return { lines: [JSON.stringify(INIT)], exitCode: 0 };
  } });
  const f = fixture(tmp);
  const env = new E2bExecEnv(makeEnvOpts(tmp, sdk, f, { env: {} }));
  await env.start();
  t.after(() => env.close('test'));
  const events = [];
  const normalize = createClaudeNormalizer();
  await runClaude({ cwd: f.repo, prompt: 'hi', model: 'claude-sonnet-5', execEnv: env,
    modelEnv: { ANTHROPIC_BASE_URL: up.url, ANTHROPIC_API_KEY: KEY }, onEvent: (e) => events.push(...normalize(e)) });
  return { env, events };
}
const relaySpend = (e) => e.type === 'spend' && e.source === 'relay';
const bookedOutput = (events) => events.filter((e) => relaySpend(e) || e.relay)
  .reduce((n, e) => n + (((e.relay || e).byModel || {})['claude-sonnet-5']?.output_tokens || 0), 0);

for (const how of ['hangup', 'leave']) {
  test(`a sandbox that ${how === 'hangup' ? 'hangs up on a reply' : 'exits with a reply still streaming'} cannot keep its output tokens off the books (audit 2.3, 2.4)`, POSIX, async (t) => {
    const { events, env } = await sandboxLetsGo(t, how);
    for (let i = 0; bookedOutput(events) < 500 && i < 300; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(bookedOutput(events), 500, JSON.stringify(events.filter(relaySpend)));
    assert.equal(env.relay.routes.size, 0, 'the route closed with the spawn');
  });
}
