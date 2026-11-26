// test/exec-env-model-relay-bridge.test.mjs
// A bridged catalog model in an E2B sandbox: Claude Code in the sandbox calls the model relay; worca forwards to its
// own loopback model bridge with the bridge secret, and the bridge to the provider with the provider key. Neither
// enters the sandbox. Own file: it moves HOME/WORCA_HOME and starts the bridge (setup as test/bridge-server.test.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { addGlobalModel, updateProvider } from '../src/core/settings.mjs';
import { startBridge, stopBridge, bridgeSecret } from '../src/core/bridge/server.mjs';
import { resolveModelEnv } from '../src/core/config.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { E2bExecEnv } from '../src/core/exec-env/e2b-env.mjs';
import { scratchDirs, fixture, makeEnvOpts } from './helpers/e2b-fixture.mjs';
import { startFakeUpstream } from './helpers/fake-model-upstream.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'e2b mode is POSIX-only' : false, timeout: 60_000 };
const OPENAI_KEY = 'sk-openai-bridge-test-0123456789';
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK', 'ORCH_MOCK', 'WORCA_BROKER_URL',
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];
const STUB = `#!/usr/bin/env node
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'system', subtype: 'init', session_id: 's1' });
const r = await fetch(process.env.ANTHROPIC_BASE_URL + '/v1/messages', { method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.ANTHROPIC_AUTH_TOKEN, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }) });
out({ type: 'result', is_error: !r.ok, result: r.status + ' ' + await r.text(), total_cost_usd: 0 });
process.exit(r.ok ? 0 : 1);
`;

/** An onCommand for createFakeE2b: the sandbox's `claude` runs the node script `stub` with the env that command got;
 *  every other command (the model relay among them) runs for real. */
function stubClaude(stub, { onRun = () => {} } = {}) {
  return async (cmd, o) => {
    if (!cmd.startsWith("'claude'")) return null;
    onRun(o);
    const r = await new Promise((resolve) => execFile(process.execPath, [stub], { cwd: o.cwd, env: { PATH: process.env.PATH, ...o.envs } },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })));
    return { lines: String(r.stdout).split('\n').filter(Boolean), stderr: r.stderr, exitCode: r.code };
  };
}

const saved = {}; let home; let worcaHome; let up;
const { tmp, cleanup } = scratchDirs();

before(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  home = await mkdtemp(join(tmpdir(), 'worca-relay-bridge-home-'));
  worcaHome = await mkdtemp(join(tmpdir(), 'worca-relay-bridge-whome-'));
  Object.assign(process.env, { HOME: home, USERPROFILE: home, WORCA_HOME: worcaHome, WORCA_TEST_ALLOW_HOME_FALLBACK: '1' });
  for (const k of KEYS.slice(4)) delete process.env[k];
  _resetForTests();
  up = await startFakeUpstream({ validKeys: [OPENAI_KEY] });
  await updateProvider('openai', { apiKey: OPENAI_KEY, baseUrl: `${up.url}/v1` });
  await addGlobalModel({ id: 'gw-gpt', label: 'GPT (gw)', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-x' } });
  await startBridge({ log: () => {} });
});
after(async () => {
  await stopBridge(); await up?.close(); _resetForTests();
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await rm(home, { recursive: true, force: true }); await rm(worcaHome, { recursive: true, force: true });
  cleanup();
});

test('a bridged model runs in a sandbox: the bridge secret and the provider key stay on the host', POSIX, async () => {
  const stub = join(home, 'claude-stub.mjs'); await writeFile(stub, STUB);
  let sandboxEnv = null;
  const f = fixture(tmp);
  const sdk = createFakeE2b({ root: tmp('worca-e2b-root-'), onCommand: stubClaude(stub, { onRun: (o) => { sandboxEnv = o.envs; } }) });
  const execEnv = new E2bExecEnv(makeEnvOpts(tmp, sdk, f, { env: {} }));   // no server credential to fall back to
  try {
    await execEnv.start();
    const modelEnv = resolveModelEnv('gw-gpt', { tag: 'exec-1' });
    assert.match(modelEnv.ANTHROPIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\/m\/gw-gpt\/r\/exec-1$/);
    assert.equal(modelEnv.ANTHROPIC_AUTH_TOKEN, bridgeSecret());
    const r = await runClaude({ cwd: f.repo, prompt: 'hi', model: 'gw-gpt', modelEnv, execEnv });
    assert.match(r.text, /^200 /, r.text);
    assert.match(r.text, /hello from openai/);
    const m = /^http:\/\/127\.0\.0\.1:\d+\/r\/([A-Za-z0-9_-]{43})$/.exec(sandboxEnv.ANTHROPIC_BASE_URL);
    assert.ok(m, sandboxEnv.ANTHROPIC_BASE_URL);
    assert.equal(sandboxEnv.ANTHROPIC_AUTH_TOKEN, m[1], 'the sandbox holds only the route id');
    assert.equal(sandboxEnv.ANTHROPIC_MODEL, 'gw-gpt');
    assert.equal('ENABLE_TOOL_SEARCH' in sandboxEnv ? sandboxEnv.ENABLE_TOOL_SEARCH : null, modelEnv.ENABLE_TOOL_SEARCH ?? null, 'a bridged model keeps its own tool-search setting');
    const all = JSON.stringify(sandboxEnv);
    assert.equal(all.includes(bridgeSecret()), false, 'the bridge secret stays on the host');
    assert.equal(all.includes(OPENAI_KEY), false, 'the provider key stays on the host');
    const call = up.requests.find((q) => q.url === '/v1/chat/completions');
    assert.ok(call, 'the bridge reached the provider');
    assert.equal(call.headers.authorization, `Bearer ${OPENAI_KEY}`, 'the bridge added the provider key');
    assert.equal(execEnv.relay.routes.size, 0, 'the route closed with the spawn');
  } finally { await execEnv.close('test'); }
});
