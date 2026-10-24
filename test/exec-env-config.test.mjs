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
import { engineCredential, sandboxEnv as sbxEnv, ENGINE_SANDBOX } from '../src/core/exec-env/policy.mjs';

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
    assert.match(errs[0], new RegExp(`^E2B execution runs the claude, codex, copilot and cursor engines only \\(this run uses ${engine}\\): ${ENGINES[engine].label} runs locally only for now\\. Pick Local, or switch the engine\\.$`));
    assert.equal(remoteRefusesDefault({ engine }), `the ${engine} engine`);
  }
  assert.deepEqual(pre({ engine: 'claude' }).errors, []);
});

test('preflight refuses other engines, workspace runs, win32, missing key/credential/sdk/old node, E2B_DEBUG', () => {
  assert.match(pre({ engine: 'gemini' }).errors.join(), /claude, codex, copilot and cursor engines only/);
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

test('the remote engines: claude, codex, copilot and cursor pass; any other engine is refused at start and skips a saved default', () => {
  assert.deepEqual([...REMOTE_ENGINES], ['claude', 'codex', 'copilot', 'cursor']);
  for (const engine of REMOTE_ENGINES) {
    assert.deepEqual(remotePreflight({ title: 'E2B', engine }), [], engine);
    assert.equal(remoteRefusesDefault({ engine }), null, engine);
  }
  assert.match(remotePreflight({ title: 'Loopback', engine: 'gemini' }).join(),
    /^Loopback execution runs the claude, codex, copilot and cursor engines only \(this run uses gemini\): Gemini CLI runs locally only for now\. Pick Local, or switch the engine\.$/);
  assert.equal(remoteRefusesDefault({ engine: 'gemini' }), 'the gemini engine');
});

test('the generic remote guards are worded with the backend title; a codex project run is not refused', () => {
  const errs = remotePreflight({ title: 'Loopback', isWorkspace: true, engine: 'gemini' });
  assert.equal(errs.filter((e) => e.startsWith('Loopback execution')).length, 2);
  assert.deepEqual(remotePreflight({ title: 'Loopback', engine: 'codex' }), []);
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

const PAT = `github_pat_${'A1b2'.repeat(10)}`;

test('every remote engine has its sandbox rules, and only those', () => {
  assert.deepEqual(Object.keys(ENGINE_SANDBOX), [...REMOTE_ENGINES]);
});

test('sandboxEnv per engine: its own config keys only, never a credential or endpoint of any engine, no host-path keys', () => {
  const host = { ANTHROPIC_API_KEY: 'sk-ant', CLAUDE_CODE_OAUTH_TOKEN: 'oat', OPENAI_API_KEY: 'sk-oai', OPENAI_BASE_URL: 'https://api.example',
    OPENAI_ORG_ID: 'org', CODEX_API_KEY: 'sk-cx', CODEX_HOME: '/Users/x/.codex', COPILOT_GITHUB_TOKEN: PAT, COPILOT_AUTO_UPDATE: 'false',
    COPILOT_HOME: '/Users/x/.copilot', COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:9', COPILOT_PROVIDER_API_KEY: 'byok', COPILOT_OFFLINE: 'true',
    COPILOT_API_URL: 'https://elsewhere', CURSOR_API_KEY: 'crsr', CURSOR_AUTH_TOKEN: 'tok', CURSOR_API_ENDPOINT: 'https://elsewhere',
    CURSOR_CONFIG_DIR: '/Users/x/.cursor', CURSOR_MODEL: 'gpt-5', LANG: 'C', MCP_TIMEOUT: '5', E2B_API_KEY: 'e2b', WORCA_E2B_TEMPLATE: 't',
    GH_TOKEN: 'ghp_x', PATH: '/usr/bin', COPILOT_ALLOW_ALL: 'true', COPILOT_ASSISTED_APPROVAL: '1', CODEX_SANDBOX: 'off', CURSOR_FORCE: '1' };
  assert.deepEqual(Object.keys(sbxEnv(host, { engine: 'codex' })).sort(), ['LANG', 'OPENAI_ORG_ID']);
  assert.deepEqual(Object.keys(sbxEnv(host, { engine: 'copilot' })).sort(), ['COPILOT_AUTO_UPDATE', 'LANG']);
  assert.deepEqual(Object.keys(sbxEnv(host, { engine: 'cursor' })).sort(), ['CURSOR_MODEL', 'LANG']);
  assert.deepEqual(Object.keys(sbxEnv(host, { engine: 'claude' })).sort(), ['LANG', 'MCP_TIMEOUT']);
  assert.deepEqual(sbxEnv(host), sbxEnv(host, { engine: 'claude' }), 'the default is claude');
  // Exact names, no prefix family (G14): copilot's allow-list wideners stay on this machine, even for another engine.
  for (const engine of REMOTE_ENGINES) {
    const out = sbxEnv(host, { engine });
    for (const k of ['COPILOT_ALLOW_ALL', 'COPILOT_ASSISTED_APPROVAL', 'CODEX_SANDBOX', 'CURSOR_FORCE']) assert.equal(out[k], undefined, `${engine}: ${k}`);
  }
  const all = ['CODEX_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'COPILOT_GITHUB_TOKEN', 'COPILOT_PROVIDER_BASE_URL', 'COPILOT_PROVIDER_API_KEY',
    'COPILOT_OFFLINE', 'COPILOT_API_URL', 'CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN', 'CURSOR_API_ENDPOINT', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];
  for (const engine of REMOTE_ENGINES) {
    assert.deepEqual(Object.keys(sbxEnv(host, { engine, keep: all })).filter((k) => all.includes(k)), [], `${engine}: relay-owned keys never pass, even kept`);
  }
  assert.equal('CODEX_HOME' in sbxEnv(host, { engine: 'codex', keep: ['CODEX_HOME'] }), false, 'a host path never passes, even kept');
  assert.equal('CURSOR_CONFIG_DIR' in sbxEnv(host, { engine: 'cursor', keep: ['CURSOR_CONFIG_DIR'] }), false);
  assert.throws(() => sbxEnv(host, { engine: 'gemini' }), /cannot run in a remote sandbox/);
});

test('engineCredential: the credential worca signs each engine`s calls with, from the server env only; never a file', () => {
  assert.deepEqual(engineCredential('claude', { CLAUDE_CODE_OAUTH_TOKEN: 'o' }), { value: 'o', source: 'CLAUDE_CODE_OAUTH_TOKEN' });
  assert.match(engineCredential('claude', {}).problem, /Neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY/);
  assert.deepEqual(engineCredential('codex', { CODEX_API_KEY: 'c', OPENAI_API_KEY: 'o' }), { value: 'c', source: 'CODEX_API_KEY' });
  assert.deepEqual(engineCredential('codex', { OPENAI_API_KEY: ' o\n' }), { value: 'o', source: 'OPENAI_API_KEY' });
  // A ChatGPT sign-in (auth.json, with its refresh token) is never copied in nor relayed: an API key only.
  assert.match(engineCredential('codex', { CODEX_HOME: '/h/cx' }).problem, /CODEX_API_KEY or OPENAI_API_KEY.*ChatGPT sign-in \(codex login\) cannot be used in a sandbox/);
  assert.deepEqual(engineCredential('copilot', { COPILOT_GITHUB_TOKEN: PAT }), { value: PAT, source: 'COPILOT_GITHUB_TOKEN' });
  assert.deepEqual(engineCredential('copilot', { COPILOT_GITHUB_TOKEN: ` ${PAT}\n` }).value, PAT, 'the checked (trimmed) value is the one used');
  assert.match(engineCredential('copilot', {}).problem, /COPILOT_GITHUB_TOKEN is not set.*github_pat_/);
  for (const [tok, kind] of [['ghp_' + 'x'.repeat(36), 'classic'], ['gho_' + 'x'.repeat(36), 'OAuth'], ['ghu_' + 'x'.repeat(36), 'ghu_'], ['nonsense-token', 'not a fine-grained']]) {
    const p = engineCredential('copilot', { COPILOT_GITHUB_TOKEN: tok }).problem;
    assert.match(p, new RegExp(kind)); assert.match(p, /fine-grained/);
    assert.equal(p.includes(tok.slice(4)), false, 'the token value never reaches a message');
  }
  assert.deepEqual(engineCredential('cursor', { CURSOR_API_KEY: 'k' }), { value: 'k', source: 'CURSOR_API_KEY' });
  assert.match(engineCredential('cursor', {}).problem, /CURSOR_API_KEY is not set/);
  // Read from each engine's relay row, never an engine-name branch: an engine with no row has no credential, and every
  // engine a sandbox runs has one.
  assert.match(engineCredential('gemini', { GEMINI_API_KEY: 'g' }).problem, /the gemini engine cannot run in a remote sandbox/);
  for (const e of REMOTE_ENGINES) assert.doesNotMatch(engineCredential(e, {}).problem, /cannot run in a remote sandbox/, e);
});

test('preflight checks the credential the relay signs the run engine`s calls with: a codex API key, a fine-grained Copilot token, the Cursor key', () => {
  const base = { E2B_API_KEY: 'e2b_1234567890abcdef', E2B_API_URL: 'http://localhost:3000' };
  assert.deepEqual(pre({ engine: 'codex', env: { ...base, OPENAI_API_KEY: 'k' } }).errors, []);
  assert.match(pre({ engine: 'codex', env: base }).errors.join(), /Codex in a sandbox needs CODEX_API_KEY or OPENAI_API_KEY/);
  // A codex run whose every model is on its own endpoint (the harness's _codexNeedsSignIn) needs no OpenAI key.
  assert.deepEqual(pre({ engine: 'codex', env: base, needsSignIn: false }).errors, []);
  assert.deepEqual(pre({ engine: 'copilot', env: { ...base, COPILOT_GITHUB_TOKEN: `github_pat_${'x'.repeat(30)}` } }).errors, []);
  assert.match(pre({ engine: 'copilot', env: { ...base, COPILOT_GITHUB_TOKEN: `ghp_${'x'.repeat(36)}` } }).errors.join(), /classic token \(ghp_\).*fine-grained/);
  assert.match(pre({ engine: 'copilot', env: base }).errors.join(), /COPILOT_GITHUB_TOKEN is not set/);
  assert.deepEqual(pre({ engine: 'cursor', env: { ...base, CURSOR_API_KEY: 'k' } }).errors, []);
  assert.match(pre({ engine: 'cursor', env: base }).errors.join(), /CURSOR_API_KEY is not set/);
  // No Claude credential is asked of another engine, and none of another engine's of Claude.
  assert.equal(pre({ engine: 'cursor', env: { ...base, CURSOR_API_KEY: 'k' } }).errors.some((e) => /CLAUDE_CODE_OAUTH_TOKEN/.test(e)), false);
  assert.deepEqual(pre({ engine: 'claude', env: { ...base, CLAUDE_CODE_OAUTH_TOKEN: 'o' } }).errors, []);
  // The broker holds Claude's keys: none asked of the server then.
  assert.deepEqual(pre({ engine: 'claude', env: base, brokerOn: true }).errors, []);
  // Mock skips every credential check, as before.
  assert.deepEqual(pre({ engine: 'copilot', mock: true, env: {} }).errors, []);
  // An engine no sandbox runs: one refusal (remotePreflight's), no credential noise.
  assert.equal(pre({ engine: 'gemini', env: base }).errors.length, 1);
});

test('propose_run\'s execEnv and the chat rules name the engines a sandbox runs from the catalog (REMOTE_ENGINES), never a copied list', async () => {
  const { createAskTools } = await import('../src/core/ask/tools.mjs');
  const { ASK_LIMITS } = await import('../src/core/ask/limits.mjs');
  const { ASK_SYSTEM_RULES } = await import('../src/core/ask/prompt.mjs');
  const { REMOTE_ENGINES: remote } = await import('../src/shared/exec-env.mjs');
  const { engineLabel } = await import('../src/shared/engine-switch.mjs');
  const desc = (deps) => createAskTools({ limits: ASK_LIMITS, ...deps }).list().find((d) => d.name === 'propose_run').inputSchema.properties.execEnv.description;
  assert.match(desc({ remoteEngines: ['claude', 'zeta'] }), /one git project\) on the claude or zeta engine\. Only/);
  assert.match(desc({}), /one git project\)\. Only/, 'no list given: no engine named');
  const words = `${remote.slice(0, -1).map(engineLabel).join(', ')} or ${engineLabel(remote.at(-1))}`;
  assert.ok(String(ASK_SYSTEM_RULES).includes(`E2B takes runs of one git project only, on ${words}: no workspace`));
});

// ── sandbox egress (plan Task 13): Sandbox.create gets `network` only for an `allow` project ──
test('e2b create: no network option unless one is given; a given one reaches Sandbox.create as it is', async () => {
  const { createFakeE2b } = await import('../src/core/exec-env/e2b-fake.mjs');
  const { e2bClient } = await import('../src/core/exec-env/backends/e2b.mjs');
  const root = mkdtempSync(join(tmpdir(), 'worca-egress-root-')); scratch.push(root);
  const sdk = createFakeE2b({ root });
  const client = e2bClient(sdk, { opts: {} }, { mock: true });
  const open = await client.create({ environment: 'worca-agent', tags: {}, timeoutMs: 60_000 });
  const network = { allowOut: ['github.com', '*.github.com'], denyOut: ['0.0.0.0/0'] };
  const closed = await client.create({ environment: 'worca-agent', tags: {}, timeoutMs: 60_000, network });
  const creates = sdk.events.filter((e) => e.type === 'create');
  assert.equal(Object.hasOwn(creates[0], 'network'), false, 'open by default: no network key at all');
  assert.deepEqual(creates[1].network, network);
  await sdk.Sandbox.kill(open.id); await sdk.Sandbox.kill(closed.id);
});

test('e2b create: a 400 for the network shape is a config error, not a lost sandbox', async () => {
  const { createFakeE2b } = await import('../src/core/exec-env/e2b-fake.mjs');
  const { E2bExecEnv } = await import('../src/core/exec-env/e2b-env.mjs');
  const root = mkdtempSync(join(tmpdir(), 'worca-egress-root-')); scratch.push(root);
  const sdk = createFakeE2b({ root });
  const env = new E2bExecEnv({ sdk, conn: { opts: {}, template: 'worca-agent' }, worktreeDir: root, pipelineDir: root, metadata: {},
    scratchDir: mkdtempSync(join(tmpdir(), 'worca-egress-scratch-')), network: { allowOut: ['github.com'] } });
  await assert.rejects(env.start(), (err) => {
    assert.equal(err.errorClass, 'config');
    assert.match(err.message, /^E2B refused the sandbox's network settings \(400: .*ALL_TRAFFIC.*\)\. Check WORCA_EGRESS_ALLOW and WORCA_EGRESS_DENY, or set the project's sandbox network back to open\.$/);
    return true;
  });
  assert.equal(env.lost, null);
  assert.equal(sdk.live.size, 0);
});

test('the e2b fake answers like E2B 2.56.0 for each network shape', async () => {
  const { createFakeE2b } = await import('../src/core/exec-env/e2b-fake.mjs');
  const root = mkdtempSync(join(tmpdir(), 'worca-egress-root-')); scratch.push(root);
  const sdk = createFakeE2b({ root });
  const ok = async (network) => { const sb = await sdk.Sandbox.create('t', { network }); await sdk.Sandbox.kill(sb.sandboxId); };
  await ok({ allowOut: ['github.com'], denyOut: ['0.0.0.0/0'] });
  await ok({ allowOut: ['1.1.1.0/24', 'registry.npmjs.org'], denyOut: ['0.0.0.0/0'] });
  await ok({ denyOut: ['0.0.0.0/0'] });
  await ok({ allowOut: ['1.1.1.1'] });
  await assert.rejects(sdk.Sandbox.create('t', { network: { allowOut: ['github.com'] } }), (e) => e.statusCode === 400 && /ALL_TRAFFIC/.test(e.message));
  await assert.rejects(sdk.Sandbox.create('t', { network: { denyOut: ['github.com'] } }), (e) => e.statusCode === 400 && /invalid denied CIDR github\.com/.test(e.message));
});

test('e2b create: a 400 without a network option keeps the SDK error (it is not about the network)', async () => {
  const { e2bClient } = await import('../src/core/exec-env/backends/e2b.mjs');
  const sdkErr = Object.assign(new Error('400: template not usable'), { name: 'SandboxError', statusCode: 400 });
  const sdk = { Sandbox: { create: async () => { throw sdkErr; } } };
  const client = e2bClient(sdk, { opts: {} }, { mock: true });
  await assert.rejects(client.create({ environment: 'worca-agent', tags: {}, timeoutMs: 60_000 }), (err) => err === sdkErr);
  await assert.rejects(client.create({ environment: 'worca-agent', tags: {}, timeoutMs: 60_000, network: { denyOut: ['0.0.0.0/0'] } }),
    (err) => err.errorClass === 'config' && err.cause === sdkErr);
});
