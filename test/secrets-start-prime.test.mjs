// test/secrets-start-prime.test.mjs — the server start waits (bounded) for the vault key's prime before its
// once-at-start consumers. With the secretVault flag on and a slow OS store, a chat channel worker started after the
// settle gets its vaulted token on its first start; with a never-answering store the settle gives up as `locked` and
// the channel is listed unconfigured with no worker spawned; with the flag off the settle is null with no store call;
// and the server source settles, behind the flag, before the egress proxy and the channel host start.
// WORCA_MOCK is removed first: under it the channel host never spawns a worker, so "no worker" would prove nothing.
delete process.env.WORCA_MOCK;
const { test, after } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { spawnSync } = await import('node:child_process');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const { peekKey, readFakeCalls, writeFakeState } = await import('./helpers/os-store-fake.mjs');

const REPO = fileURLToPath(new URL('../', import.meta.url));
const CHILD = fileURLToPath(new URL('./fixtures/secrets/settings-child.mjs', import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'worca-start-prime-'));
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_TEST_OS_STORE', 'WORCA_TEST_STORE_TIMEOUT_MS'];
const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
mkdirSync(join(ROOT, 'home'), { recursive: true });
Object.assign(process.env, {
  HOME: join(ROOT, 'home'), USERPROFILE: join(ROOT, 'home'), WORCA_HOME: join(ROOT, 'unused'),
  WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_FLAGS: 'secretVault',
});
after(() => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 });
});

const { primeSettingsVaultIfEnabled } = await import('../src/core/settings.mjs');
const { readPluginConfig } = await import('../src/core/plugin-config.mjs');
const { writePluginsLock, pluginCurrentDir } = await import('../src/core/plugins-lock.mjs');
const { createChannelHost } = await import('../src/core/chat/channel-host.mjs');
const { osItemName } = await import('../src/core/secrets/os-store.mjs');
const { worcaHome } = await import('../src/core/projects.mjs');
const { readServerSource } = await import('../src/core/read-server-source.mjs');

// The fixture chat channel of test/channel-host.test.mjs; its worker logs only whether it got the seeded token, so no
// host redaction of the token's text can hide the answer.
const NAME = 'fixture-chat';
const SCHEMA = [{ key: 'token', type: 'text', label: 'Token', secret: true, required: true }];
const TOKEN = 'tok-start-prime-0001';
const WORKER = [
  'export function createChannelWorker(ctx) {',
  '  return {',
  "    async start() { ctx.log('info', 'token-match ' + (ctx.config.token === " + JSON.stringify(TOKEN) + ")); return { identity: 'fixture-bot' }; },",
  '    async stop() {},',
  '    async send() { return { ok: true }; },',
  '  };',
  '}',
].join('\n');

let n = 0;
/** A fresh Worca home (the per-home prime state must not carry over) with the fixture channel and a vaulted token. */
function freshHome() {
  const dir = mkdtempSync(join(ROOT, `case${++n}-`));
  const state = join(dir, 'fake', 'state.json');
  writeFakeState(state, { state: 'available' });
  Object.assign(process.env, { WORCA_HOME: join(dir, 'worca'), WORCA_TEST_OS_STORE: state });
  const cur = pluginCurrentDir(NAME);
  mkdirSync(join(cur, 'channel'), { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: NAME, engines: { 'worca-cc-api': '>=2 <3' },
    chatChannels: [{ id: 'main', displayName: 'Fixture', platform: 'testchat', module: './channel/worker.mjs', configSchema: SCHEMA }],
  }));
  writeFileSync(join(cur, 'channel', 'worker.mjs'), WORKER);
  writePluginsLock({ [NAME]: { repoUrl: 'https://example.test/fixture.git', subdir: '', pinnedSha: 'f'.repeat(40), version: null, enabled: true, installedAt: '2026-08-12T00:00:00.000Z' } });
  const r = spawnSync(process.execPath, [CHILD, 'seed-plugin-secret', '--plugin', NAME, '--key', 'token', '--value', TOKEN],
    { cwd: REPO, env: process.env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  const item = osItemName(worcaHome());
  return { state, item, key: peekKey(state, item) };
}

async function waitFor(fn, ms = 8000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 25))) if (fn()) return true;
  return false;
}

test('flag on, a store that answers after 300 ms: the settle is ready and the channel worker gets its token on its first start', async () => {
  const { state, item, key } = freshHome();
  writeFakeState(state, { state: 'available', items: { [item.account]: key }, delayMs: 300 });
  assert.equal(readPluginConfig(NAME, SCHEMA).token, null, 'control: before the settle the vaulted token reads as unset');
  assert.deepEqual(await primeSettingsVaultIfEnabled({ settle: true }), { state: 'ready' });
  const logs = [];
  const host = createChannelHost({ logger: (level, msg) => logs.push(msg) });
  try {
    host.start();
    assert.ok(await waitFor(() => logs.some((l) => l.includes('token-match'))), logs.join('\n'));
    assert.ok(logs.some((l) => l.includes('token-match true')), logs.join('\n'));
  } finally { await host.stop(); }
});

test('flag on, a never-answering store: the settle gives up as locked in time; the channel is unconfigured and spawns no worker', async () => {
  process.env.WORCA_TEST_STORE_TIMEOUT_MS = '200';
  try {
    const { state, item, key } = freshHome();
    writeFakeState(state, { state: 'never-answers', items: { [item.account]: key } });
    const t0 = Date.now();
    assert.deepEqual(await primeSettingsVaultIfEnabled({ settle: true }), { state: 'locked' });
    const ms = Date.now() - t0;
    assert.ok(ms >= 195 && ms <= 1200, `settled after ${ms} ms`);
    const logs = [];
    const host = createChannelHost({ logger: (level, msg) => logs.push(msg) });
    try {
      host.start();
      const [row] = host.status();
      assert.equal(row.state, 'unconfigured');
      assert.deepEqual(row.missingConfig, ['token']);
      assert.equal(row.detail, 'missing config: token');
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(!logs.some((l) => l.includes('token-match')), 'no worker started');
    } finally { await host.stop(); }
  } finally { delete process.env.WORCA_TEST_STORE_TIMEOUT_MS; }
});

test('flag off: the settle is null and makes no store call', () => {
  const dir = mkdtempSync(join(ROOT, 'off-'));
  const state = join(dir, 'state.json');
  writeFakeState(state, { state: 'available' });
  const script = "const m = await import('./src/core/settings.mjs'); console.log(JSON.stringify(await m.primeSettingsVaultIfEnabled({ settle: true })));";
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: REPO, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, WORCA_HOME: join(dir, 'worca'), WORCA_FLAGS: '-secretVault', WORCA_TEST_OS_STORE: state },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'null');
  assert.deepEqual(readFakeCalls(state), []);
});

test('flag off after a migration: the vault is still in use, the start settle is ready and the proxy login resolves', async () => {
  const dir = mkdtempSync(join(ROOT, 'migrated-'));
  const home = join(dir, 'home');
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  const state = join(dir, 'fake', 'state.json');
  writeFakeState(state, { state: 'available' });
  const env = { ...process.env, HOME: home, USERPROFILE: home, WORCA_HOME: home, WORCA_TEST_OS_STORE: state, WORCA_TEST_DEPLOYMENT: 'local',
    WORCA_FLAGS: 'secretVault' };
  for (const cmd of ['seed-literals', 'migrate']) {
    const r = spawnSync(process.execPath, [CHILD, cmd], { cwd: REPO, env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
  }
  const keep = { WORCA_HOME: process.env.WORCA_HOME, WORCA_FLAGS: process.env.WORCA_FLAGS, WORCA_TEST_OS_STORE: process.env.WORCA_TEST_OS_STORE };
  Object.assign(process.env, { WORCA_HOME: home, WORCA_FLAGS: '-secretVault', WORCA_TEST_OS_STORE: state });
  try {
    const { readProxyLogin } = await import('../src/core/proxy-credentials.mjs');
    const { secretSlots } = await import('./helpers/secret-literals.mjs');
    assert.match(JSON.parse(readFileSync(join(home, '.worca-cc', 'proxy-login.json'), 'utf8')).ntHash, /^worca:vault:v1:/);
    assert.deepEqual(await primeSettingsVaultIfEnabled({ settle: true }), { state: 'ready' });
    const login = readProxyLogin();
    assert.equal(login.error, undefined, login.error);
    assert.equal(login.ntHash.toString('hex'), secretSlots().find((s) => s.id === 'proxy').value);
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('the server start settles the prime behind the flag, after the keep-awake migration and before the proxy and the channels', () => {
  const src = readServerSource();
  const count = (needle) => src.split(needle).length - 1;
  assert.equal(count('await startLiveEgress('), 1);
  assert.equal(count('channelHost.start();'), 1);
  assert.equal(count('primeSettingsVaultIfEnabled({ settle: true })'), 1);
  const at = src.indexOf('primeSettingsVaultIfEnabled({ settle: true })');
  const line = src.slice(src.lastIndexOf('\n', at) + 1, at);
  assert.match(line, /^\s*if \(vaultInUse\(\)\) await $/);
  assert.ok(src.indexOf('migrateKeepAwakeFlag()') < at);
  assert.ok(at < src.indexOf('await startLiveEgress('));
  assert.ok(at < src.indexOf('channelHost.start();'));
});

test('the server start migrates once, after the settle and before the egress proxy; the CLI migrates inside its prime branch', () => {
  const src = readServerSource();
  const settle = src.indexOf('primeSettingsVaultIfEnabled({ settle: true })');
  const egress = src.indexOf('await startLiveEgress(');
  const window = src.slice(settle, egress);
  assert.equal(window.split('migrateSecretsIfEnabled(').length - 1, 1);
  assert.match(window, /migrateSecretsIfEnabled\(\{ reason: 'start', deployment: DEPLOYMENT \}\)/);
  const cli = readFileSync(join(REPO, 'src/cli/worca-cc.mjs'), 'utf8');
  assert.equal(cli.split('migrateSecretsIfEnabled(').length - 1, 1);
  const branch = cli.indexOf('if (CLI_PRIME_COMMANDS.includes(primeName))');
  assert.ok(branch > 0);
  const call = cli.indexOf('migrateSecretsIfEnabled(');
  // Inside the branch's block: after its opening and before the block's first closing line.
  assert.ok(call > branch && call < cli.indexOf('\n  }\n', branch), 'the CLI gate sits inside the CLI_PRIME_COMMANDS branch');
});
