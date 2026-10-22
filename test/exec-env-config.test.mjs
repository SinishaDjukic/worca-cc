// test/exec-env-config.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectExecEnv, ExecEnvLostError, ExecEnvSyncError, isExecEnvFatal, isSandboxGone, isSandboxUnreachable } from '../src/core/exec-env/index.mjs';
import { shq, shellJoin, mkdirsScript } from '../src/core/exec-env/shell.mjs';
import { e2bPreflight, modelCredential, sandboxEnv, sandboxMcpConfig, redactKey, e2bConnection } from '../src/core/exec-env/e2b-config.mjs';
import { RemoteExecEnv } from '../src/core/exec-env/remote-env.mjs';
import { remotePreflight, remoteRefusesDefault, instanceTag, INSTANCE_ID_FILE } from '../src/core/exec-env/policy.mjs';
import { REMOTE_ENGINES } from '../src/shared/exec-env.mjs';
import { ENGINES, ENGINE_NAMES } from '../src/shared/engine-switch.mjs';

const scratch = []; after(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));
const OK_ENV = { E2B_API_KEY: 'e2b_1234567890abcdef', E2B_API_URL: 'http://localhost:3000', CLAUDE_CODE_OAUTH_TOKEN: 'oat' };
const pre = (o = {}) => e2bPreflight({ engine: 'claude', isWorkspace: false, env: OK_ENV, platform: 'darwin',
  nodeVersion: '22.19.0', sdkInstalled: () => true, ...o });

test('selectExecEnv: blank is local, unknown throws', () => {
  assert.equal(selectExecEnv(undefined), 'local');
  assert.equal(selectExecEnv(' e2b '), 'e2b');
  assert.throws(() => selectExecEnv('docker'), /unknown execution environment "docker"/);
});

test('preflight: a clean e2b claude single-project run passes', () => {
  assert.deepEqual(pre().errors, []);
});

test('an engine without sandbox support in the catalog (gemini, qwen, goose, opencode) is refused at run start: it runs locally only for now', () => {
  // The catalog flag decides, never a name list: REMOTE_ENGINES is exactly the catalog's sandbox engines.
  assert.deepEqual(REMOTE_ENGINES, ENGINE_NAMES.filter((e) => ENGINES[e].sandbox));
  for (const engine of ['gemini', 'qwen', 'goose', 'opencode']) {
    assert.equal(ENGINES[engine].sandbox, false, engine);
    const errs = pre({ engine }).errors;
    assert.equal(errs.length, 1, engine);
    assert.match(errs[0], new RegExp(`^E2B execution runs the claude engine only \\(this run uses ${engine}\\): ${ENGINES[engine].label} runs locally only for now\\. Pick Local, or switch the engine\\.$`));
    assert.equal(remoteRefusesDefault({ engine }), `the ${engine} engine`);
  }
  assert.deepEqual(pre({ engine: 'claude' }).errors, []);
});

test('preflight refuses other engines, workspace runs, win32, missing key/credential/sdk/old node, E2B_DEBUG', () => {
  assert.match(pre({ engine: 'codex' }).errors.join(), /claude engine only/);
  assert.match(pre({ isWorkspace: true }).errors.join(), /single-project runs only/);
  assert.match(pre({ platform: 'win32' }).errors.join(), /macOS or Linux/);
  assert.match(pre({ env: { ...OK_ENV, E2B_API_KEY: '' } }).errors.join(), /E2B_API_KEY is not set/);
  assert.match(pre({ env: { E2B_API_KEY: 'k' } }).errors.join(), /Neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY/);
  assert.match(pre({ sdkInstalled: () => false }).errors.join(), /npm install e2b@2\.56\.0/);
  assert.match(pre({ nodeVersion: '22.13.0' }).errors.join(), /Node 22\.19/);
  assert.match(pre({ env: { ...OK_ENV, E2B_DEBUG: 'true' } }).errors.join(), /E2B_DEBUG/);
  assert.match(pre({ runRootMode: 'legacy' }).errors.join(), /detached run-root mode/);
  assert.match(pre({ mock: true, runRootMode: 'legacy' }).errors.join(), /detached run-root mode/);
});

test('the generic remote guards are worded with the backend title; a claude project run is not refused', () => {
  const errs = remotePreflight({ title: 'Loopback', isWorkspace: true, engine: 'codex' });
  assert.equal(errs.filter((e) => e.startsWith('Loopback execution')).length, 2);
  assert.equal(remoteRefusesDefault({ workspace: false, engine: 'claude' }), null);
});

test('a Folder project or a run without a project cannot run remotely: refused at start, a saved default skips it', () => {
  assert.match(remotePreflight({ title: 'E2B', workMode: 'folder' }).join(), /E2B execution needs a git project; this is a Folder project/);
  assert.match(remotePreflight({ title: 'E2B', workMode: 'none' }).join(), /E2B execution needs a project; this run has none/);
  assert.deepEqual(remotePreflight({ title: 'E2B', workMode: 'git' }), []);
  assert.match(pre({ mock: true, workMode: 'folder' }).errors.join(), /needs a git project/);
  assert.equal(remoteRefusesDefault({ workMode: 'folder' }), 'a Folder project');
  assert.equal(remoteRefusesDefault({ workMode: 'none' }), 'a run without a project');
  assert.equal(remoteRefusesDefault({ workMode: 'git', engine: 'claude' }), null);
});

test('E2B Cloud is an explicit choice: no E2B_API_URL refuses the run unless WORCA_E2B_CLOUD=1', () => {
  const cloud = { E2B_API_KEY: 'e2b_1234567890abcdef', CLAUDE_CODE_OAUTH_TOKEN: 'oat' };
  assert.match(pre({ env: cloud }).errors.join(), /E2B_API_URL is not set, so runs would go to E2B Cloud\. .*WORCA_E2B_CLOUD=1/);
  const ok = pre({ env: { ...cloud, WORCA_E2B_CLOUD: '1' } });
  assert.deepEqual(ok.errors, []); assert.match(ok.warnings.join(), /runs go to E2B Cloud/);
  assert.deepEqual(pre({ env: { ...cloud, E2B_DOMAIN: 'e2b.example.com' } }).errors, [], 'E2B_DOMAIN names a server too');
  assert.deepEqual(pre({ mock: true, env: {} }).errors, [], 'mock mode never reaches E2B');
});

test('preflight in mock mode skips E2B/credential/sdk checks but keeps engine/workspace/platform', () => {
  const r = pre({ mock: true, env: {}, sdkInstalled: () => false, nodeVersion: '22.13.0' });
  assert.deepEqual(r.errors, []);
  assert.match(pre({ mock: true, isWorkspace: true }).errors.join(), /single-project/);
});

test('preflight warns about E2B Cloud when chosen and the host guard, not about the broker', () => {
  const w = pre({ brokerOn: true, env: { ...OK_ENV, E2B_API_URL: '', WORCA_E2B_CLOUD: '1' } }).warnings.join('\n');
  assert.match(w, /E2B Cloud/); assert.match(w, /host guard is off/);
  assert.doesNotMatch(w, /does not reach E2B sandboxes/);
});

test('with the broker on no server credential is needed; with it off the credential must stay on the server', () => {
  const env = { E2B_API_KEY: 'k', E2B_API_URL: 'http://localhost:3000' };
  const on = pre({ brokerOn: true, env });
  assert.deepEqual(on.errors, []);
  assert.doesNotMatch(on.warnings.join('\n'), /does not reach E2B sandboxes/);
  const off = pre({ env }).errors.join();
  assert.match(off, /Neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY/);
  assert.match(off, /it stays on the server and signs the sandbox's model calls\./);
  assert.doesNotMatch(off, /sign Claude Code in/);
});

test('the instance tag is stored in worca home: stable across calls and hostnames, a stored id wins', () => {
  const home = mkdtempSync(join(tmpdir(), 'worca-instance-')); scratch.push(home);
  const first = instanceTag(home);
  assert.match(first, /^[0-9a-f]{12}$/);
  assert.equal(readFileSync(join(home, INSTANCE_ID_FILE), 'utf8').trim(), first, 'seeded with the value used before');
  assert.equal(instanceTag(home), first);
  writeFileSync(join(home, INSTANCE_ID_FILE), 'abcdef012345\n');
  assert.equal(instanceTag(home), 'abcdef012345', 'the stored id, whatever the hostname is now');
});

test('modelCredential prefers the OAuth token', () => {
  assert.deepEqual(modelCredential({ CLAUDE_CODE_OAUTH_TOKEN: 'o', ANTHROPIC_API_KEY: 'k' }), { CLAUDE_CODE_OAUTH_TOKEN: 'o' });
  assert.deepEqual(modelCredential({ ANTHROPIC_API_KEY: 'k' }), { ANTHROPIC_API_KEY: 'k' });
  assert.equal(modelCredential({}), null);
});

test('sandboxEnv: allowlist + keep, never host paths or GitHub/ADO tokens', () => {
  const env = sandboxEnv({ PATH: '/usr/bin', HOME: '/Users/x', TMPDIR: '/var/t', CLAUDE_CONFIG_DIR: '/Users/x/.c',
    ANTHROPIC_MODEL: 'm', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '1', WORCA_HOST_PID: '1', WORCA_HOME: '/w',
    WORCA_IN_PLAN: '/p', GH_TOKEN: 'ghp_x', WORCA_GH_WRITE_TOKEN: 'x', AWS_SECRET_ACCESS_KEY: 's', MY_SECRET: 'v',
    LANG: 'C', API_TIMEOUT_MS: '600000', MCPSECRET_ABCD1234: 'only-if-referenced' },
  { keep: ['MY_SECRET', 'PATH'] });
  assert.deepEqual(Object.keys(env).sort(),
    ['ANTHROPIC_MODEL', 'API_TIMEOUT_MS', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'LANG', 'MY_SECRET', 'WORCA_IN_PLAN']);
});

test('sandboxEnv: only the script contract WORCA_* vars, no OTEL_*, no E2B/GitHub/secret-named var, never the model credential', () => {
  const host = {
    WORCA_HEARTBEAT_TOKEN: 'hb', WORCA_HEARTBEAT_URL: 'https://hb', WORCA_CODEX_PROVIDER_KEY: 'ck', WORCA_MCP_SECRETS: 's',
    WORCA_DEBUG_SPAWN: '1', WORCA_DECK_ELEVENLABS_API_KEY: 'el', WORCA_EGRESS_PROXY_URL: 'http://127.0.0.1:9', WORCA_E2B_TEMPLATE: 't',
    OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer x', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318', OTEL_METRICS_EXPORTER: 'otlp',
    E2B_API_KEY: 'e2b_k', E2B_API_URL: 'http://localhost:3000', E2B_SANDBOX_URL: 'http://localhost:3002', E2B_ACCESS_TOKEN: 'a',
    GH_HOST: 'github.example.com', GITHUB_PERSONAL_ACCESS_TOKEN: 'p', GH_ENTERPRISE_TOKEN: 'e',
    ANTHROPIC_FOUNDRY_API_KEY: 'f', CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'r', MCP_REMOTE_SECRET: 'm', DISABLE_TOKEN: 'd',
  };
  const contract = { WORCA_ENVELOPE: '/p/env.json', WORCA_VERDICT: '/p/v.json', WORCA_CWD: '/w', WORCA_PIPELINE_DIR: '/p',
    WORCA_PROJECT_DIR: '/r', WORCA_CHECKPOINT_REF: 'refs/x', WORCA_CYCLE: '1', WORCA_RUN_ID: 'abc', WORCA_PLATFORM: 'darwin',
    WORCA_MOCK: '0', WORCA_BENCH: '1', WORCA_IN_PLAN: '/p/plan.md', WORCA_OUT_LOG: '/p/log.md', WORCA_PARAM_API_KEY: 'a param' };
  const credential = { ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 'g', CLAUDE_CODE_OAUTH_TOKEN: 'o' };
  const env = sandboxEnv({ ...host, ...contract, ...credential, MCPSECRET_0A1B2C3D: 'kept', STRIPE_KEY: 'declared' },
    { keep: ['MCPSECRET_0A1B2C3D', 'STRIPE_KEY', 'E2B_API_KEY', 'GITHUB_PERSONAL_ACCESS_TOKEN'] });
  for (const k of Object.keys(host)) assert.equal(k in env, false, k);
  assert.deepEqual(env, { ...contract, MCPSECRET_0A1B2C3D: 'kept', STRIPE_KEY: 'declared' },
    'the run`s own declared keys (keep) still pass, except an E2B or GitHub name; the model credential stays in worca');
});

test('sandboxEnv: a secret-named var in lower or mixed case is dropped too; keep still passes it (Minor 5)', () => {
  const env = { ANTHROPIC_gateway_key: 'a', CLAUDE_my_api_key: 'b', MCP_Server_Token: 'c', my_api_key: 'd', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '1' };
  assert.deepEqual(sandboxEnv(env), { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '1' });
  assert.deepEqual(sandboxEnv(env, { keep: ['my_api_key'] }), { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '1', my_api_key: 'd' });
});

test('sandboxEnv: the model credential, base URL and custom headers never enter a sandbox, not even through keep', () => {
  const model = { ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 'o', ANTHROPIC_AUTH_TOKEN: 'g', ANTHROPIC_BASE_URL: 'https://x', ANTHROPIC_CUSTOM_HEADERS: 'A: b' };
  assert.deepEqual(sandboxEnv(model), {});
  assert.deepEqual(sandboxEnv(model, { keep: Object.keys(model) }), {});
});

test('sandboxMcpConfig keeps remote url servers, drops stdio/loopback/token-carrying ones, reports env refs', () => {
  const { config, dropped, envRefs } = sandboxMcpConfig({ mcpServers: {
    remote: { type: 'http', url: 'https://mcp.example.com/x', headers: { Authorization: 'Bearer ${MCPSECRET_0A1B2C3D}' } },
    local: { command: 'node', args: ['/Users/x/s.mjs'], env: { K: '${MCPSECRET_99999999}' } },
    loop: { type: 'sse', url: 'http://127.0.0.1:9000/sse' },
    gh: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789' } },
  } });
  assert.deepEqual(Object.keys(config.mcpServers), ['remote']);
  assert.deepEqual(dropped.map((d) => d.name).sort(), ['gh', 'local', 'loop']);
  assert.deepEqual(envRefs, ['MCPSECRET_0A1B2C3D']);
});

test('sandboxMcpConfig drops a url server carrying any literal secret, like a GitHub token (E6)', () => {
  const { config, dropped, envRefs, exposed } = sandboxMcpConfig({ mcpServers: {
    hdr: { type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer lin_api_abcdefghijklmnop' } },
    apikey: { type: 'http', url: 'https://mcp.example.com/a', headers: { 'X-API-Key': 'plainvalue123' } },
    query: { type: 'sse', url: 'https://mcp.example.com/sse?token=abc123' },
    creds: { type: 'http', url: 'https://user:pw@mcp.example.com/x' },
    refs: { type: 'http', url: 'https://mcp.example.com/r', headers: { Authorization: 'Bearer ${LINEAR_TOKEN}', 'X-Team': '${TEAM_ID:-core}' } },
    plain: { type: 'http', url: 'https://mcp.example.com/p', headers: { 'X-Client': 'worca' } },
  } });
  assert.deepEqual(Object.keys(config.mcpServers).sort(), ['plain', 'refs']);
  const reasons = Object.fromEntries(dropped.map((d) => [d.name, d.reason]));
  assert.deepEqual(Object.keys(reasons).sort(), ['apikey', 'creds', 'hdr', 'query']);
  assert.equal(reasons.hdr, 'carries a secret (header Authorization)');
  assert.equal(reasons.query, 'carries a secret (URL parameter token)');
  for (const r of Object.values(reasons)) assert.ok(!/lin_api|plainvalue|abc123|pw@/.test(r), `no value in "${r}"`);
  assert.deepEqual(envRefs, ['LINEAR_TOKEN', 'TEAM_ID']);
  assert.deepEqual(exposed, [{ name: 'refs', envRefs: ['LINEAR_TOKEN', 'TEAM_ID'] }], 'only kept servers that read env vars');
});

test('the run log names every dropped MCP server and the env vars each kept one reads, never a value (E6)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-mcp-log-')); scratch.push(dir);
  const mcpConfigPath = join(dir, 'mcp.json');
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {
    hdr: { type: 'http', url: 'https://mcp.example.com/h', headers: { Authorization: 'Bearer sk-abcdefghijklmnopqrstuvwxyz' } },
    refs: { type: 'http', url: 'https://mcp.example.com/r', headers: { Authorization: 'Bearer ${LINEAR_TOKEN}' } },
    plain: { type: 'http', url: 'https://mcp.example.com/p' },
  } }));
  const logs = []; let uploaded = null;
  const env = { mcpConfigPath, supportFiles: [], label: 'E2B sandbox', mcpEnvRefs: [],
    log: (level, text) => logs.push(`${level} ${text}`), _putHost: async (_p, buf) => { uploaded = JSON.parse(String(buf)); } };
  await RemoteExecEnv.prototype._uploadSupport.call(env);
  assert.deepEqual(Object.keys(uploaded.mcpServers).sort(), ['plain', 'refs']);
  assert.deepEqual(env.mcpEnvRefs, ['LINEAR_TOKEN']);
  assert.deepEqual(logs, [
    'warn MCP server "hdr" is not available in the E2B sandbox: it carries a secret (header Authorization)',
    'warn MCP server "refs" is available in the E2B sandbox with the values of these env vars: LINEAR_TOKEN',
  ]);
});

test('redactKey never prints the whole key; connection reads env and sets no global request timeout', () => {
  assert.equal(redactKey('e2b_1234567890abcdef'), 'e2b_…cdef');
  const c = e2bConnection(OK_ENV);
  assert.equal(c.opts.apiUrl, 'http://localhost:3000');
  assert.equal(c.opts.requestTimeoutMs, undefined, 'uploads pass their own, longer, request timeout');
  assert.equal(c.template, 'worca-agent');
});

test('shell quoting', () => {
  assert.equal(shq("it's"), `'it'\\''s'`);
  assert.equal(shellJoin(['claude', '-p', 'a b']), `'claude' '-p' 'a b'`);
});

test('mkdirsScript creates every missing component (no chown when not root)', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'worca-mkdirs-')); scratch.push(root);
  execFileSync('bash', ['-c', mkdirsScript([join(root, 'a b', 'c'), join(root, 'd')])]);
  assert.ok(statSync(join(root, 'a b', 'c')).isDirectory());
  assert.ok(statSync(join(root, 'd')).isDirectory());
});

test('mkdirsScript tolerates a concurrent run creating the same parents', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'worca-mkdirs-')); scratch.push(root);
  const { execFile } = await import('node:child_process');
  const run = (leaf) => new Promise((res, rej) => execFile('bash', ['-c', mkdirsScript([join(root, 'p', 'q', leaf)])], (e) => (e ? rej(e) : res())));
  await Promise.all(Array.from({ length: 8 }, (_, i) => run(`x${i}`)));   // two parallel spawns staging prompts
  assert.ok(statSync(join(root, 'p', 'q', 'x7')).isDirectory());
});

test('isSandboxGone / isSandboxUnreachable recognise SDK classes and names', () => {
  class SandboxNotRunningError extends Error {}
  const sdk = { SandboxNotRunningError };
  assert.equal(isSandboxGone(new SandboxNotRunningError('x'), sdk), true);
  const e = new Error('x'); e.name = 'SandboxNotFoundError';
  assert.equal(isSandboxGone(e), true);
  assert.equal(isSandboxGone(new Error('boom')), false);
  const u = new Error('x'); u.name = 'SandboxUnreachableError';
  assert.equal(isSandboxGone(u), false);
  assert.equal(isSandboxUnreachable(u), true);
  assert.equal(new ExecEnvLostError('m').code, 'EXEC_ENV_LOST');
  assert.equal(isExecEnvFatal(new ExecEnvLostError('m')), true);
  assert.equal(isExecEnvFatal(new ExecEnvSyncError('m')), true);
  assert.equal(new ExecEnvSyncError('m').code, 'EXEC_ENV_PATCH_REJECTED');
  assert.equal(new ExecEnvSyncError('m', { code: 'EXEC_ENV_MERGE_COMMIT' }).code, 'EXEC_ENV_MERGE_COMMIT');
  assert.equal(isExecEnvFatal(new Error('m')), false);
});
