// test/ask-secrets-status.test.mjs — the chat and the secret vault (docs/secrets.md; the secretVault flag): the
// get_secrets_status tool (listed only while the flag is on; the vault's state, the key store's name and counts by
// kind, never a value, a secret's name, a key or a path), the security: line's vault= item (no key store call; the
// header stays within its 1 KB), and the one rule sentence (only while the flag is on).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { securityToolFamily } from '../src/core/ask/security-tools.mjs';
import { secretsForChat, vaultLineFact, SECURITY_BRIDGE_OPS, securityBridgeOp } from '../src/core/ask/security-deps.mjs';
import { buildContextHeader, securityHeaderLine, buildSystemPrompt, VAULT_CHAT_RULE } from '../src/core/ask/prompt.mjs';
import { noteLastStatus, _resetLastStatus } from '../src/core/secrets/last-status.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after);
const KEY = 'sk-acme-chat-vault-0001';

async function withEnv(vars, fn) {
  const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const family = (sec) => securityToolFamily({ deps: { security: sec }, SCHEMA: { obj: (p) => ({ type: 'object', properties: p }), s: (d) => ({ type: 'string', description: d }), b: (d) => ({ type: 'boolean', description: d }) },
  str: (v) => (typeof v === 'string' ? v : ''), AskToolError: Error, scopeError: async () => null, pinnedScope: () => null });
const baseSec = { posture: async () => ({}), execEnvs: async () => ({}), projectEnv: async () => ({}) };

test('get_secrets_status: listed only while the flag is on, and it answers what the server says', async () => {
  const off = family({ ...baseSec, secretsEnabled: () => false, secrets: async () => ({}) });
  assert.equal(off.defs.some((d) => d.name === 'get_secrets_status'), false);
  const none = family(baseSec);
  assert.equal(none.defs.some((d) => d.name === 'get_secrets_status'), false, 'no vault deps: not listed');
  const on = family({ ...baseSec, secretsEnabled: () => true, secrets: async () => ({ state: 'on' }) });
  assert.ok(on.defs.some((d) => d.name === 'get_secrets_status'));
  assert.deepEqual(await on.handlers.get_secrets_status({}), { state: 'on' });
  assert.ok(SECURITY_BRIDGE_OPS.includes('secrets-status'));
});

test('secretsForChat: flag off, a container, and a native install with keys in files, then in the vault', async () => {
  await withEnv({ WORCA_FLAGS: '-secretVault' }, async () => assert.equal((await secretsForChat()).state, 'flag-off'));
  await withEnv({ WORCA_FLAGS: 'secretVault', WORCA_CONTAINER: '1' }, async () => {
    const r = await secretsForChat();
    assert.equal(r.state, 'not-available-in-container');
    assert.match(r.detail, /credential broker/);
  });
  _resetLastStatus();
  const settingsDir = join(process.env.HOME, '.worca-cc');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify({ providers: { openai: { apiKey: KEY } } }), { mode: 0o600 });
  await withEnv({ WORCA_FLAGS: 'secretVault', WORCA_CONTAINER: undefined, WORCA_HOME: process.env.HOME }, async () => {
    assert.equal(worcaHome(), join(process.env.HOME, '.worca-cc'));
    const before = await secretsForChat();
    assert.match(before.lastCheck, /not checked yet/);
    noteLastStatus({ state: 'ready', label: 'macOS Keychain', vault: 'none', checkedAt: '2026-11-26T10:00:00.000Z', message: 'x' });
    const r = await securityBridgeOp('secrets-status');
    assert.equal(r.state, 'off');
    assert.equal(r.keyStore, 'macOS Keychain');
    assert.equal(r.inFiles.settings, 1);
    const text = JSON.stringify(r);
    assert.ok(!text.includes(KEY) && !text.includes('openai') && !/\/|worca:vault:/.test(text.replace(/docs\/[\w-]+\.md/g, '').replace(/Settings › General › Secret vault/g, '')), text);
    assert.equal(await vaultLineFact(), 'off');
    noteLastStatus({ state: 'locked', label: 'macOS Keychain', vault: 'unknown' });
    assert.equal((await secretsForChat()).state, 'locked');
  });
  _resetLastStatus();
});

test('the security: line: vault= only with the flag on; the header stays within 1 KB', async () => {
  await withEnv({ WORCA_FLAGS: '-secretVault' }, async () => assert.equal(await vaultLineFact(), null));
  await withEnv({ WORCA_FLAGS: 'secretVault', WORCA_BOX: 'hardened' }, async () => assert.equal(await vaultLineFact(), 'container'));
  assert.equal(securityHeaderLine({ setup: 'native', vault: 'pending' }), 'security: setup=native vault=pending');
  assert.doesNotMatch(securityHeaderLine({ setup: 'native' }), /vault/);
  const security = { setup: 'container', broker: 'on', agentUsers: 'on', network: 'allow-list', proxyLogin: 'sidecar', vault: 'container', execEnv: 'docker', sandboxed: true };
  const big = { security, linkedRuns: Array.from({ length: 5 }, (_, i) => ({ id: `0000000${i}`, title: 'R'.repeat(200), status: 'done' })),
    attachments: Array.from({ length: 8 }, (_, i) => ({ id: `att_0000000${i}`, name: 'N'.repeat(200), bytes: 1024 })) };
  const h = buildContextHeader(big);
  assert.ok(h.length <= ASK_LIMITS.contextHeaderMaxChars, `${h.length}`);
  assert.ok(h.includes('vault=container'));
});

test('the rule sentence: only with the flag on, once; at-rest encryption, not a sandbox, the status command and the doc', () => {
  assert.equal(buildSystemPrompt([], {}).includes(VAULT_CHAT_RULE), false);
  const on = buildSystemPrompt([], { vault: true });
  assert.equal(on.split(VAULT_CHAT_RULE).length - 1, 1);
  assert.match(VAULT_CHAT_RULE, /at-rest encryption/);
  assert.match(VAULT_CHAT_RULE, /not a sandbox/);
  assert.match(VAULT_CHAT_RULE, /worca secrets status/);
  assert.match(VAULT_CHAT_RULE, /docs\/secrets\.md/);
});
