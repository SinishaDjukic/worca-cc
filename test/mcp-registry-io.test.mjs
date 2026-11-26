// test/mcp-registry-io.test.mjs
// MCP registry §5 IO shell, §5.6 spawn limit, §9.2/§11.2 team readers: resolveRegistry binds the store,
// the catalog and this host's facts; the policy cache (never git) gives the Team set input.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { resolveRegistry, requiredOf, cachedTeamFor, cachedTeams, toolNameLimitFor } from '../src/core/mcp/registry.mjs';
import { addManualServer, putMember, mcpDir } from '../src/core/mcp/store.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';
import { projectKey } from '../src/core/store.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);
const sandbox = mkdtempSync(join(tmpdir(), 'worca-mcp-io-'));
const prev = {};
before(() => {
  for (const [k, v] of Object.entries({ HOME: sandbox, USERPROFILE: sandbox, WORCA_TEST_ALLOW_HOME_FALLBACK: '1' })) { prev[k] = process.env[k]; process.env[k] = v; }
});
after(() => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(sandbox, { recursive: true, force: true });
});

const ENTRY = { plugin: 'acme-tools', server: 'sentry' };
const doc = (required) => ({ fields: required === undefined ? {} : { 'mcp.required': { kind: 'soft', value: required } } });

test('requiredOf / cachedTeams: the mcp.required entries of a policy doc ([] for anything else); every cached home with ≥1 entry', async () => {
  await checkRows([
    { name: 'requiredOf: the mcp.required entries of a policy doc, [] for anything else', run: () => {
      assert.deepEqual(requiredOf(doc([ENTRY])), [ENTRY]);
      for (const d of [null, undefined, doc(), doc('x'), { fields: { 'mcp.required': null } }]) assert.deepEqual(requiredOf(d), []);
    } },
    { name: 'cachedTeams: every cached home with ≥1 mcp.required entry', run: () => {
      const homes = [{ slug: 'acme/a', doc: doc([ENTRY]) }, { slug: 'acme/b', doc: doc([]) }, { slug: 'acme/c', doc: doc() }];
      assert.deepEqual(cachedTeams(homes), [{ home: 'acme/a', required: [ENTRY], doc: homes[0].doc }]);
      assert.deepEqual(cachedTeams(), [], 'the real cache is empty');
    } },
  ]);
});

test('cachedTeamFor: a project\'s cached policy; a workspace\'s policy home only while it is still a member; null without entries', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'worca-mcp-home-'));
  try {
    const policies = { 'p-00000001': { home: 'acme/platform', doc: doc([ENTRY]) }, 'p-00000002': { home: 'acme/x', doc: doc([]) } };
    const deps = {
      policyForKey: (key) => policies[key] ?? null,
      policyForDir: (dir) => (dir === homeDir ? { home: 'acme/platform', doc: doc([ENTRY]) } : null),
      readWs: async (id) => ({
        w1: { policyProject: homeDir, projectKeys: [projectKey(homeDir), 'other-00000009'] },
        stale: { policyProject: homeDir, projectKeys: ['other-00000009'] },
        none: { policyProject: null, projectKeys: [] },
      })[id] ?? null,
    };
    assert.deepEqual(await cachedTeamFor({ projectKey: 'p-00000001' }, deps), { home: 'acme/platform', required: [ENTRY] });
    assert.equal(await cachedTeamFor({ projectKey: 'p-00000002' }, deps), null, 'no entry ⇒ no Team set');
    assert.equal(await cachedTeamFor({ projectKey: 'p-00000003' }, deps), null, 'no policy');
    assert.deepEqual(await cachedTeamFor({ workspaceId: 'w1' }, deps), { home: 'acme/platform', required: [ENTRY] });
    assert.equal(await cachedTeamFor({ workspaceId: 'stale' }, deps), null, 'the home left the workspace');
    assert.equal(await cachedTeamFor({ workspaceId: 'none' }, deps), null, 'no policy home');
    assert.equal(await cachedTeamFor({ workspaceId: 'gone' }, deps), null);
    assert.equal(await cachedTeamFor({ projectKey: 'no-such-00000000' }), null, 'the real cache: nothing cached');
  } finally { rmSync(homeDir, { recursive: true, force: true }); }
});

test('toolNameLimitFor: 64 when any model is translated by the bridge, else 128', async () => {
  await addGlobalModel({ id: 'gw-gpt', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-x' } });
  await addGlobalModel({ id: 'gw-claude', upstream: { provider: 'anthropic', api: 'anthropic', model: 'claude-y' } });
  assert.equal(toolNameLimitFor(['claude-opus-4-8', 'gw-claude']), 128);
  assert.equal(toolNameLimitFor(['claude-opus-4-8', 'gw-gpt']), 64);
  assert.equal(toolNameLimitFor([]), 128);
});

test('resolveRegistry: store + catalog + this host (execPath, the real launcher); a newer registry file resolves nothing', async () => {
  const def = await addManualServer('playwright', { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp'], fields: [], description: 'Browser automation' });
  await putMember('general', 'manual:playwright', { enabled: true, values: {} }, { def });
  const opts = { surface: 'ask', targets: [], teams: {}, off: { sets: [], members: [] }, toolNameLimit: 128, copyCap: 12, mcpTimeoutMs: 15000 };
  const files = () => ({ ...Object.fromEntries(readdirSync(mcpDir()).map((f) => [f, statSync(join(mcpDir(), f)).mtimeMs])),
    '~/.claude.json': existsSync(join(sandbox, '.claude.json')), '.mcp.json': existsSync('.mcp.json') });
  const before = files();
  const r = await resolveRegistry(opts);
  assert.deepEqual(files(), before, 'resolving writes nothing: no registry file, ~/.claude.json or .mcp.json (§15 global)');
  assert.deepEqual(Object.keys(r.servers), ['playwright']);
  const { command, args } = r.servers.playwright;
  assert.equal(command, process.execPath);
  assert.ok(existsSync(args[0]) && args[0].endsWith(join('src', 'core', 'mcp', 'launch.mjs')), args[0]);
  assert.deepEqual(args.slice(1), ['--copy', 'playwright', '--', 'npx', '-y', '@playwright/mcp']);
  assert.equal(r.newer, undefined);
  writeFileSync(join(mcpDir(), 'sets.json'), JSON.stringify({ schema: 2 }));
  assert.deepEqual(await resolveRegistry(opts), { servers: {}, env: {}, secretValues: [], grants: [], disallowedTools: [],
    copies: [], skipped: [], skippedTools: [], sets: [], newer: true });
});

test('flag on: the server env gets the vaulted value and the $env value; an unresolvable reference is missing:KEY, never text', async () => {
  const { rmSync: rm, readFileSync: read } = await import('node:fs');
  const { writeFakeState, fileFakeOsStore } = await import('./helpers/os-store-fake.mjs');
  const { createVault } = await import('../src/core/secrets/vault.mjs');
  const { osItemName } = await import('../src/core/secrets/os-store.mjs');
  const { newVaultRef } = await import('../src/core/secrets/refs.mjs');
  const { worcaHome } = await import('../src/core/projects.mjs');
  const { clearSettingsVaultReader } = await import('../src/core/secrets/settings-resolver.mjs');
  rm(mcpDir(), { recursive: true, force: true });
  const state = join(sandbox, 'fake-state.json');
  writeFakeState(state, { state: 'available' });
  const keep = { WORCA_FLAGS: process.env.WORCA_FLAGS, WORCA_TEST_OS_STORE: process.env.WORCA_TEST_OS_STORE, MCP_REG_OTHER: process.env.MCP_REG_OTHER };
  Object.assign(process.env, { WORCA_FLAGS: 'secretVault', WORCA_TEST_OS_STORE: state, MCP_REG_OTHER: 'from-env-0002' });
  const warn = console.warn;
  const lines = [];
  console.warn = (l) => lines.push(String(l));
  try {
    const def = await addManualServer('vaulted', { type: 'stdio', command: 'npx', args: ['-y', 'vaulted-mcp'],
      env: { API_TOKEN: { field: 'token' }, OTHER: { field: 'other' } },
      fields: [{ key: 'token', secret: true, required: true }, { key: 'other', secret: true }], description: 'x' });
    await putMember('general', 'manual:vaulted', { enabled: true, secrets: { token: 'tok-reg-0001', other: { $env: 'MCP_REG_OTHER' } } }, { def });
    const opts = { surface: 'ask', targets: [], teams: {}, off: { sets: [], members: [] }, toolNameLimit: 128, copyCap: 12, mcpTimeoutMs: 15000 };
    const ok = await resolveRegistry(opts);
    assert.deepEqual(Object.keys(ok.servers), ['vaulted']);
    assert.deepEqual([...ok.secretValues].sort(), ['from-env-0002', 'tok-reg-0001']);
    assert.ok(Object.values(ok.env).includes('tok-reg-0001'));
    const secretsFile = join(mcpDir(), 'secrets.json');
    const raw = JSON.parse(read(secretsFile, 'utf8'));
    const field = 'manual:vaulted/token';
    const vault = createVault({ home: worcaHome(), store: fileFakeOsStore(state, { item: osItemName(worcaHome()) }) });
    const crossRef = await vault.put({ store: 'mcp', field: 'manual:vaulted/other', value: 'not-for-token' });
    const setToken = (ref) => { raw.sets.general['manual:vaulted'].token.value = ref; writeFileSync(secretsFile, JSON.stringify(raw)); };
    const cases = [['unknown-ref', () => setToken(newVaultRef())], ['cross-owner', () => setToken(crossRef)], ['locked', () => clearSettingsVaultReader()]];
    for (const [code, arrange] of cases) {
      arrange();
      const r = await resolveRegistry(opts);
      assert.deepEqual(Object.keys(r.servers), [], code);
      assert.match(JSON.stringify(r.skipped), /missing:token/, code);
      assert.ok(!JSON.stringify({ servers: r.servers, env: r.env, secretValues: r.secretValues }).includes('worca:vault:'), code);
      assert.ok(lines.some((l) => l.includes(`${field} cannot be read (${code})`)), `${code}: ${lines.join(' | ')}`);
    }
    for (const l of lines) assert.ok(!l.includes('worca:vault:') && !l.includes('tok-reg-0001') && !l.includes(sandbox), l);
  } finally {
    console.warn = warn;
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
