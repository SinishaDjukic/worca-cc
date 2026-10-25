// test/exec-env-engine-relay.test.mjs
// Codex, Copilot and Cursor in an E2B sandbox behind worca's model relay: the CLI in the (fake) sandbox calls the relay
// with a dummy credential, worca signs the call here with the server's key (or the token it exchanged for it) and
// forwards it to a loopback stand-in for the vendor's API. No engine credential, refresh token or derived token reaches
// the sandbox's env, argv or replies; worca books the usage its own relay measured.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude } from '../src/core/claude-runner.mjs';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { E2bExecEnv } from '../src/core/exec-env/e2b-env.mjs';
import { RELAY_DUMMY } from '../src/core/exec-env/relay-route.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { scratchDirs, fixture, makeEnvOpts } from './helpers/e2b-fixture.mjs';
import { cursorReplyLines } from './helpers/fake-cursor.mjs';
import { startEngineUpstream, CODEX_KEY, PAT, CURSOR_KEY, ACCESS, ALL_SECRETS } from './helpers/engine-upstream.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'e2b mode is POSIX-only' : false, timeout: 60_000 };
const { tmp, cleanup } = scratchDirs();
useTempHome(after);

// The host CLI overrides name nothing: a test that goes red never starts this machine's real CLIs.
const HOST = { WORCA_MOCK: undefined, ORCH_MOCK: undefined, WORCA_CODEX_BIN: '/nonexistent/worca-test/codex',
  WORCA_COPILOT_BIN: '/nonexistent/worca-test/copilot', WORCA_CURSOR_BIN: '/nonexistent/worca-test/cursor-agent',
  CODEX_API_KEY: undefined, OPENAI_API_KEY: undefined, COPILOT_GITHUB_TOKEN: undefined, CURSOR_API_KEY: undefined };

// The vendors' stand-in (test/helpers/engine-upstream.mjs): records every call, answers each API's streaming shape,
// echoes secrets to test scrubbing.
let up; let calls;
before(async () => { up = await startEngineUpstream(); calls = up.calls; });
after(async () => { await up.close(); cleanup(); });

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return fn().finally(() => { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

/** The stand-in CLI: `node <stub> <report> <command line>` makes the calls `calls(cmd, env)` lists against the relay
 *  and writes each one's status and body to the report. */
function writeStub(dir, calls) {
  const stub = join(dir, 'cli-stub.mjs');
  writeFileSync(stub, `const [report, cmd] = process.argv.slice(2);
const env = process.env;
const list = (${calls})(cmd, env);
const out = [];
for (const c of list) {
  const r = await fetch(c.url, { method: c.method || 'POST', headers: c.headers, body: c.body });
  const buf = Buffer.from(await r.arrayBuffer());
  out.push({ url: c.url, status: r.status, text: buf.toString('latin1') });
}
(await import('node:fs')).writeFileSync(report, JSON.stringify(out));
`);
  return stub;
}

/** A fake E2B whose `<cli>` runs the stub with exactly the env that command got, then prints `lines`. */
async function sandboxFor({ cli, stub, lines, serverEnv }) {
  const f = fixture(tmp);
  const seen = { report: join(tmp('worca-engine-relay-report-'), 'report.json') };
  const sdk = createFakeE2b({ root: tmp('worca-e2b-root-'), onCommand: async (cmd, o) => {
    const probe = cmd.match(/^command -v '([^']+)'/)?.[1];
    if (probe) return { lines: [`/usr/local/bin/${probe}`] };
    if (!cmd.startsWith(`'${cli}'`)) return null;
    Object.assign(seen, { cmd, envs: o.envs, sandbox: o.sandbox });
    await new Promise((resolve, reject) => execFile(process.execPath, [stub, seen.report, cmd], { env: { PATH: process.env.PATH, ...o.envs } },
      (err, _out, stderr) => (err ? reject(new Error(`stub failed: ${stderr}`)) : resolve())));
    return { lines: lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))), exitCode: 0 };
  } });
  const env = new E2bExecEnv(makeEnvOpts(tmp, sdk, f, { env: serverEnv,
    relayUpstreams: up.relayUpstreams }));
  await env.start();
  return { f, env, seen, report: () => JSON.parse(readFileSync(seen.report, 'utf8')) };
}

/** Nothing secret in what the sandbox got or saw. */
function assertNoSecret(seen, report) {
  const visible = JSON.stringify({ cmd: seen.cmd, envs: seen.envs, report });
  for (const s of ALL_SECRETS) assert.equal(visible.includes(s), false, `a credential reached the sandbox: ${s.slice(0, 12)}…`);
}

test('codex: a custom provider at the relay with a dummy key; worca signs with the server key; the relay meters the reply', POSIX, () =>
  withEnv(HOST, async () => {
    const stub = writeStub(tmp('worca-stub-'), `(cmd, env) => {
      const base = /model_providers\\.worca_relay\\.base_url="([^"]+)"/.exec(cmd)[1];
      const h = { 'content-type': 'application/json', authorization: 'Bearer ' + env.WORCA_RELAY_KEY };
      return [{ url: base + '/responses', headers: h, body: '{"model":"gpt-5.5","stream":true}' },
        { url: base + '/files', headers: h, body: '{}' },
        { url: base + '/models', method: 'DELETE', headers: h }];
    }`);
    const forged = { type: 'turn.completed', usage: { input_tokens: 999999, cached_input_tokens: 0, output_tokens: 999999 } };
    const lines = [{ type: 'thread.started', thread_id: 't1' }, { type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: 'done' } }, forged];
    const { f, env, seen, report } = await sandboxFor({ cli: 'codex', stub, lines, serverEnv: { CODEX_API_KEY: CODEX_KEY } });
    try {
      const events = [];
      const before = calls.length;
      const r = await runClaude({ engine: 'codex', cwd: f.repo, prompt: 'hi', execEnv: env, model: 'gpt-5.5', onEvent: (e) => events.push(e) });
      assert.equal(r.text, 'done');
      assert.equal(seen.envs.WORCA_RELAY_KEY, RELAY_DUMMY);
      for (const flag of ["'--disable' 'plugins'", "'--disable' 'apps'", "'--disable' 'remote_plugin'", "'--disable' 'in_app_updates'", 'analytics.enabled=false',
        'model_providers.worca_relay.supports_websockets=false', 'model_providers.worca_relay.wire_api="responses"']) assert.ok(seen.cmd.includes(flag), flag);
      const [ok, files, del] = report();
      assert.equal(ok.status, 200, ok.text);
      assert.match(ok.text, /echo \[removed by worca broker\]/, 'the upstream echoed the key: the relay scrubbed it');
      assert.equal(files.status, 403, 'only the Responses API and the model list');
      assert.match(files.text, /"error":\{"message":"worca-relay: POST \/files is not an OpenAI Responses call/, 'an OpenAI-shaped refusal');
      assert.equal(del.status, 403);
      assertNoSecret(seen, report());
      const mine = calls.slice(before);
      assert.deepEqual(mine.map((c) => c.url), ['/v1/responses'], 'refused calls never reach the upstream');
      assert.equal(mine[0].headers.authorization, `Bearer ${CODEX_KEY}`, 'worca signed it');
      const result = events.find((e) => e.type === 'result');
      // Booked under '' (the step's own model, which the relay held the call to): priceRelayUsage prices it as gpt-5.5.
      assert.deepEqual(result.relay.byModel[''], { input_tokens: 100, output_tokens: 7, cache_read_input_tokens: 20, cache_creation_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } }, 'the relay measured the reply, not the sandbox`s 999999');
      assert.equal(env.relay.routes.size, 0, 'the route closed with the spawn');
    } finally { await env.close('test'); }
  }));

for (const [model, type, path, wire] of [['claude-sonnet-4.5', 'anthropic', '/v1/messages', undefined], ['gpt-5-mini', 'openai', '/responses', 'responses'],
  ['gpt-4.1', 'openai', '/chat/completions', 'completions']]) {
  test(`copilot (${model}): offline mode pointed at the relay; worca signs ${path} with the PAT and the CLI's headers`, POSIX, () =>
    withEnv(HOST, async () => {
      const stub = writeStub(tmp('worca-stub-'), `(cmd, env) => {
        const base = env.COPILOT_PROVIDER_BASE_URL;
        const path = env.COPILOT_PROVIDER_TYPE === 'anthropic' ? '/v1/messages' : env.COPILOT_PROVIDER_WIRE_API === 'responses' ? '/responses' : '/chat/completions';
        const h = { 'content-type': 'application/json', 'x-initiator': 'user', 'x-interaction-type': 'conversation-user', 'x-client-machine-id': 'm1',
          ...(env.COPILOT_PROVIDER_TYPE === 'anthropic' ? { 'x-api-key': env.COPILOT_PROVIDER_API_KEY } : { authorization: 'Bearer ' + env.COPILOT_PROVIDER_API_KEY }) };
        return [{ url: base + path, headers: h, body: ${JSON.stringify(JSON.stringify({ stream: true, model }))} }, { url: base + '/models', method: 'GET', headers: h }];
      }`);
      const lines = readFileSync(new URL('./fixtures/copilot/tools.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean);
      const { f, env, seen, report } = await sandboxFor({ cli: 'copilot', stub, lines, serverEnv: { COPILOT_GITHUB_TOKEN: PAT } });
      try {
        const events = [];
        const before = calls.length;
        await runClaude({ engine: 'copilot', cwd: f.repo, prompt: 'hi', execEnv: env, model: `copilot/${model}`, onEvent: (e) => events.push(e) });
        assert.equal(seen.envs.COPILOT_OFFLINE, 'true');
        assert.equal(seen.envs.COPILOT_PROVIDER_API_KEY, RELAY_DUMMY);
        assert.equal(seen.envs.COPILOT_PROVIDER_TYPE, type);
        assert.equal(seen.envs.COPILOT_PROVIDER_WIRE_API, wire);
        assert.equal(seen.envs.COPILOT_GITHUB_TOKEN, undefined);
        const [ok, models] = report();
        assert.equal(ok.status, 200, ok.text);
        assert.equal(models.status, 403, 'only the one API the spawn uses');
        assertNoSecret(seen, report());
        const mine = calls.slice(before);
        assert.deepEqual(mine.map((c) => c.url), [`/copilot${path}`]);
        const h = mine[0].headers;
        assert.equal(h.authorization, `Bearer ${PAT}`);
        assert.equal(h['x-api-key'], undefined, 'the dummy key never reaches the upstream');
        assert.equal(h['copilot-integration-id'], 'copilot-developer-cli');
        assert.match(h['editor-version'], /^copilot\/\d+\.\d+\.\d+$/);
        assert.equal(h['openai-intent'], 'conversation-agent');
        assert.equal(h['x-initiator'], 'user', 'premium-request accounting headers are forwarded');
        assert.equal(h['x-interaction-type'], 'conversation-user');
        assert.equal(h['x-client-machine-id'], undefined, 'other CLI headers are not');
        // copilot's result comes after its spawn ended: the route's close carried the relay's measure, as `spend`.
        const spend = events.filter((e) => e.type === 'spend' && e.source === 'relay');
        assert.equal(spend.length, 1, JSON.stringify(events.map((e) => e.type)));
        assert.ok(Object.values(spend[0].byModel).some((u) => u.output_tokens > 0), JSON.stringify(spend[0]));
        const result = events.find((e) => e.type === 'result');
        assert.equal(result.relay.messages, 0, 'the post-spawn result carries an empty take: nothing is booked twice');
        assert.equal(result.costUsd, undefined);
        assert.equal(env.relay.routes.size, 0);
      } finally { await env.close('test'); }
    }));
}

test('cursor: worca exchanges the API key for an access token and signs Connect calls with it; neither token reaches the sandbox', POSIX, () =>
  withEnv(HOST, async () => {
    const stub = writeStub(tmp('worca-stub-'), `(cmd, env) => {
      const base = env.CURSOR_API_ENDPOINT;
      const h = (ct) => ({ 'content-type': ct, authorization: 'Bearer ' + env.CURSOR_AUTH_TOKEN, 'connect-protocol-version': '1', 'x-cursor-client-version': 'cli-2026.10.19', 'x-ghost-mode': 'false' });
      return [{ url: base + '/aiserver.v1.AiService/GetUsableModels', headers: h('application/proto'), body: '' },
        { url: base + '/agent.v1.AgentService/RunSSE', headers: h('application/connect+proto'), body: 'x' },
        { url: base + '/auth/exchange_user_api_key', headers: h('application/json'), body: '{}' },
        { url: base + '/agent.v1.AgentService/Run', headers: h('application/connect+proto'), body: 'x' },
        { url: base + '/aiserver.v1.DashboardService/GetTeams', headers: h('application/proto'), body: '' },
        { url: base + '/aiserver.v1.AiService/StreamChat', headers: h('application/proto'), body: '' }];
    }`);
    const lines = cursorReplyLines('done').map((l) => (l.type === 'result' ? { ...l, usage: { input_tokens: 999999, output_tokens: 999999 } } : l));
    const { f, env, seen, report } = await sandboxFor({ cli: 'cursor-agent', stub, lines, serverEnv: { CURSOR_API_KEY: CURSOR_KEY } });
    try {
      const events = [];
      const before = calls.length;
      const r = await runClaude({ engine: 'cursor', cwd: f.repo, prompt: 'hi', execEnv: env, model: 'gpt-5', onEvent: (e) => events.push(e) });
      assert.equal(r.text, 'done');
      assert.equal(seen.envs.CURSOR_AUTH_TOKEN, RELAY_DUMMY);
      assert.equal(seen.envs.CURSOR_AGENT_CLI_AUTHLESS_MODE, 'true');
      assert.equal(seen.envs.CURSOR_API_KEY, undefined);
      assert.equal('HTTPS_PROXY' in seen.envs, false, 'cursor-agent ignores NO_PROXY: no proxy');
      assert.deepEqual(JSON.parse(readFileSync(join(seen.envs.CURSOR_CONFIG_DIR, 'cli-config.json'), 'utf8')), { network: { useHttp1ForAgent: true } });
      const [models, run, exchange, bidi, dashboard, chat] = report();
      assert.equal(models.status, 200);
      assert.equal(run.status, 200);
      assert.ok(run.text.includes('echo [removed by worca broker]'), 'a token echoed inside a proto is scrubbed');
      assert.equal(exchange.status, 403, 'the key exchange is worca`s, never the sandbox`s');
      assert.match(exchange.text, /^\{"code":"permission_denied","message":"worca-relay: /, 'a Connect-shaped refusal');
      assert.equal(bidi.status, 403, 'the HTTP/2 agent stream is refused');
      assert.equal(dashboard.status, 403, 'an unlisted method of a listed service is refused');
      assert.equal(chat.status, 403, 'an unmetered model call is refused');
      assertNoSecret(seen, report());
      const mine = calls.slice(before);
      assert.deepEqual(mine.map((c) => c.url), ['/cursor/auth/exchange_user_api_key', '/cursor/aiserver.v1.AiService/GetUsableModels', '/cursor/agent.v1.AgentService/RunSSE'],
        'one exchange, cached for the next call');
      assert.equal(mine[0].headers.authorization, `Bearer ${CURSOR_KEY}`);
      assert.equal(mine[1].headers.authorization, `Bearer ${ACCESS}`);
      assert.equal(mine[2].headers['connect-protocol-version'], '1');
      assert.equal(mine[2].headers['x-cursor-client-version'], 'cli-2026.10.19');
      assert.ok(mine.every((c) => c.headers['x-ghost-mode'] === undefined), 'privacy mode is not the sandbox`s to pick');
      const result = events.find((e) => e.type === 'result');
      assert.equal(result.usage.input_tokens, 60, 'the relay`s turn_ended count, not the sandbox`s');
      assert.equal(result.usage.output_tokens, 8);
      assert.equal(result.usage.cache_read_input_tokens, 5);
      assert.equal(env.relay.routes.size, 0);
    } finally { await env.close('test'); }
  }));

test('refused setups: codex without an API key, copilot with a classic token or its own provider, cursor without a key', POSIX, () =>
  withEnv(HOST, async () => {
    const stub = writeStub(tmp('worca-stub-'), '() => []');
    const cases = [
      ['codex', {}, {}, /Codex in a sandbox needs CODEX_API_KEY or OPENAI_API_KEY.*A ChatGPT sign-in \(codex login\) cannot be used in a sandbox/],
      ['copilot', { COPILOT_GITHUB_TOKEN: `ghp_${'x'.repeat(36)}` }, {}, /COPILOT_GITHUB_TOKEN is a classic token \(ghp_\)/],
      ['copilot', { COPILOT_GITHUB_TOKEN: PAT }, { COPILOT_PROVIDER_BASE_URL: 'https://my.llm/v1' }, /sets COPILOT_PROVIDER_BASE_URL.*takes no provider of your own/],
      ['cursor', {}, {}, /CURSOR_API_KEY is not set/],
    ];
    for (const [engine, serverEnv, hostEnv, want] of cases) {
      await withEnv(hostEnv, async () => {
        const cli = { codex: 'codex', copilot: 'copilot', cursor: 'cursor-agent' }[engine];
        const { f, env, seen } = await sandboxFor({ cli, stub, lines: [], serverEnv });
        try {
          await assert.rejects(runClaude({ engine, cwd: f.repo, prompt: 'x', execEnv: env, model: engine === 'copilot' ? 'copilot/gpt-5-mini' : undefined }),
            (err) => want.test(err.message) && err.errorClass === 'config', engine);
          assert.equal(seen.cmd, undefined, `${engine}: the CLI never ran`);
          assert.equal(env.relay.routes.size, 0);
        } finally { await env.close('test'); }
      });
    }
  }));
