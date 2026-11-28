// test/exec-env-vault.test.mjs — a sandbox run (E2B or Local sandbox (Docker)) never receives a secret vault value or
// reference. The vault and its key live on the host: a model's vaulted key is resolved there (prepareModelEnv) and the
// relay signs with it there; the sandbox gets the relay URL and a dummy. A reference that reaches the sandbox env or an
// MCP server's config is dropped, and an unresolved one refuses the run on the host.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxEnv, sandboxMcpConfig } from '../src/core/exec-env/policy.mjs';
import { remoteModelRoute } from '../src/core/exec-env/relay-route.mjs';
import { prepareModelEnv } from '../src/core/model-env.mjs';
import { isVaultRef } from '../src/core/secrets/refs.mjs';
import { fakeVault } from './helpers/vault-on.mjs';

const dir = mkdtempSync(join(tmpdir(), 'worca-exec-env-vault-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const { vaultOn, vaultOf } = fakeVault(dir);
const KEY = 'sk-ant-acme-vaulted-0001';

test('a vaulted model key is resolved on the host and signs at the relay; the sandbox env holds neither key nor reference', async () => {
  const home = mkdtempSync(join(dir, 'home-'));
  const ref = await vaultOn(() => vaultOf(home).put({ store: 'settings', field: 'models.acme.env.ANTHROPIC_API_KEY', value: KEY }));
  assert.ok(isVaultRef(ref));
  const resolveRef = async (r) => vaultOn(() => vaultOf(home).resolve(r, { store: 'settings', field: 'models.acme.env.ANTHROPIC_API_KEY' }));
  const value = await resolveRef(ref);
  // The host resolver (model-env.mjs) turns the reference into the key; here it is the vault's own answer.
  const { env: modelEnv } = prepareModelEnv({ ANTHROPIC_API_KEY: ref, ANTHROPIC_BASE_URL: 'https://gw.acme.example' }, {}, { resolveRef: () => value });
  assert.equal(modelEnv.ANTHROPIC_API_KEY, KEY);
  const spawnEnv = { ...modelEnv, TZ: 'Europe/Berlin', ACME_NOTE: ref };
  const route = remoteModelRoute({ spawnEnv, modelEnv, serverEnv: {}, label: 'E2B sandbox' });
  assert.equal(route.signed, true);
  assert.deepEqual(route.authHeaders(), { 'x-api-key': KEY }, 'the relay, on the host, signs with the key');
  const inSandbox = sandboxEnv(spawnEnv, { keep: ['ACME_NOTE'], engine: 'claude' });
  const text = JSON.stringify(inSandbox);
  assert.ok(!text.includes(KEY), 'no key value');
  assert.ok(!text.includes('worca:vault:'), 'no vault reference, even a kept one');
  assert.equal(inSandbox.TZ, 'Europe/Berlin', 'plain allowed values still pass');
});

test('an unresolved vault reference refuses the run on the host instead of signing with it', () => {
  const ref = 'worca:vault:v1:AAAAAAAAAAAAAAAAAAAAAA';
  assert.throws(() => remoteModelRoute({ spawnEnv: {}, modelEnv: { ANTHROPIC_API_KEY: ref }, serverEnv: {}, label: 'Local sandbox (Docker)' }),
    (e) => e.errorClass === 'config' && /secret vault/.test(e.message) && !e.message.includes(ref));
});

test('an MCP server whose config carries a vault reference stays out of the sandbox', () => {
  const r = sandboxMcpConfig({ mcpServers: {
    acme: { type: 'http', url: 'https://mcp.acme.example', headers: { authorization: 'Bearer worca:vault:v1:BBBBBBBBBBBBBBBBBBBBBB' } },
    open: { type: 'http', url: 'https://docs.acme.example/mcp' },
  } });
  assert.deepEqual(Object.keys(r.config.mcpServers), ['open']);
  assert.deepEqual(r.dropped.map((d) => d.name), ['acme']);
  assert.match(r.dropped[0].reason, /vault reference/);
});
