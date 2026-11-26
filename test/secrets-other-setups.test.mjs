// test/secrets-other-setups.test.mjs — the secret vault next to the other setups (docs/secrets.md, "With the other
// setups"): it works only where Worca runs natively. In any container (a plain container with the egress sidecar, the
// Hardened box, a Shared instance, the sidecar itself) it is "not available here": nothing is sealed or migrated, the
// proxy login stays the sidecar's, and status, doctor and the CLI say so and point to the credential broker. The vault's
// files and locks are owner-only, so the secret-file boot check never flags them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vaultUnavailableHere, CONTAINER_TEXT, DOCTOR_CONTAINER_LINE } from '../src/core/secrets/place.mjs';
import { secretVaultEnabled, vaultInUse, vaultNotAvailableHere } from '../src/core/secrets/flag.mjs';
import { secretsStatus, statusLines, doctorLine } from '../src/core/secrets/status.mjs';
import { cmdSecrets } from '../src/cli/secrets.mjs';
import { saveProxyLogin, proxyLoginLiteral, PROXY_LOGIN_FILE, saveProxyLoginHash } from '../src/core/proxy-credentials.mjs';
import { isVaultRef } from '../src/core/secrets/refs.mjs';
import { acquireLock } from '../src/core/metrics/lock.mjs';
import { secretFileProblem } from '../src/core/secret-files.mjs';
import { VAULT_FILE, VAULT_LOCK_FILE, MIGRATE_LOCK_FILE } from '../src/core/secrets/files.mjs';
import { fakeVault } from './helpers/vault-on.mjs';

const dir = mkdtempSync(join(tmpdir(), 'worca-secrets-setups-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const { vaultOn, vaultOf } = fakeVault(dir);
const LOGIN = { domain: 'ACME', user: 'jdoe', password: 'S3cret!' };

/** Run fn with these env vars set on the process (the gates read process.env), restored after. */
async function withEnv(vars, fn) {
  const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('place: each container marker means "not available here"; a native install has none', () => {
  assert.equal(vaultUnavailableHere({}), null);
  assert.equal(vaultUnavailableHere({ WORCA_CONTAINER: '0' }), null);
  for (const env of [{ WORCA_CONTAINER: '1' }, { WORCA_DATA_DIR: '/data' }, { WORCA_BOX: 'hardened' },
    { WORCA_EGRESS_API_URL: 'http://egress:3129' }, { WORCA_EGRESS_DATA_DIR: '/worca/egress' }]) {
    assert.equal(vaultUnavailableHere(env), 'container', JSON.stringify(env));
  }
  assert.match(CONTAINER_TEXT, /credential broker/);
});

test('flag on in a container: the vault is not enabled, not in use, and says so', async () => {
  await vaultOn(() => withEnv({ WORCA_CONTAINER: '1' }, () => {
    assert.equal(secretVaultEnabled(), false);
    assert.equal(vaultInUse({ home: dir }), false);
    assert.equal(vaultNotAvailableHere(), true);
  }));
  await vaultOn(() => {
    assert.equal(secretVaultEnabled(), true, 'native: on');
    assert.equal(vaultNotAvailableHere(), false);
  });
});

test('status, its lines and the doctor line in a container: no OS key store is asked', async () => {
  const st = await secretsStatus({ home: dir, env: { WORCA_BOX: 'hardened' } });
  assert.equal(st.state, 'container');
  assert.equal(st.vault, 'none');
  assert.deepEqual(statusLines(st), ['Secrets vault: not available in a container', CONTAINER_TEXT]);
  assert.deepEqual(doctorLine(st), { text: DOCTOR_CONTAINER_LINE, warn: false });
});

test('worca secrets in a container: status says so and points to the broker; the other verbs refuse', async () => {
  for (const env of [{ WORCA_CONTAINER: '1' }, { WORCA_BOX: 'hardened' }]) {
    const out = []; const err = [];
    const code = await cmdSecrets(['status'], { out: (s) => out.push(s), err: (s) => err.push(s), fail: (s) => err.push(s), env });
    assert.equal(code, 0);
    assert.deepEqual(out, ['Secrets vault: not available in a container', CONTAINER_TEXT]);
    for (const verb of [['export'], ['reset'], ['ack'], ['status', '--check']]) {
      const e2 = [];
      assert.equal(await cmdSecrets(verb, { out: () => {}, err: (s) => e2.push(s), fail: (s) => e2.push(s), env }), 2, verb.join(' '));
      assert.match(e2.join('\n'), /not available in a container.*credential broker/s);
    }
  }
});

test('proxy login in a container: flag on, the login is saved plain and no vault entry is made', async () => {
  const home = mkdtempSync(join(dir, 'box-'));
  await vaultOn(async () => {
    await saveProxyLogin(LOGIN, { home, env: { WORCA_CONTAINER: '1' } });
    const hash = JSON.parse(readFileSync(join(home, PROXY_LOGIN_FILE), 'utf8')).ntHash;
    assert.match(hash, /^[0-9a-f]{32}$/, 'a plain NT hash, never a reference');
    assert.equal(existsSync(join(home, VAULT_FILE)), false, 'no vault file in the box');
    // The same save natively goes into the vault.
    const native = mkdtempSync(join(dir, 'native-'));
    await saveProxyLogin(LOGIN, { home: native, env: {} });
    assert.ok(isVaultRef(JSON.parse(readFileSync(join(native, PROXY_LOGIN_FILE), 'utf8')).ntHash));
    assert.equal((await vaultOf(native).list()).length, 1);
  });
});

test('migration never takes a login that belongs to the egress sidecar (bound to its upstream)', () => {
  const home = mkdtempSync(join(dir, 'sidecar-'));
  saveProxyLoginHash({ domain: 'ACME', user: 'jdoe', ntHash: 'a'.repeat(32) }, { home, env: {}, upstream: 'proxy.acme.example:8080' });
  assert.equal(proxyLoginLiteral({ home }), null);
  const plain = mkdtempSync(join(dir, 'plain-'));
  saveProxyLoginHash({ domain: 'ACME', user: 'jdoe', ntHash: 'b'.repeat(32) }, { home: plain, env: {} });
  assert.equal(proxyLoginLiteral({ home: plain }).value, 'b'.repeat(32), 'a native login is still moved');
});

test('secret-file boot check: the vault, its key and both locks are owner-only and never flagged', { skip: process.platform === 'win32' }, async () => {
  const home = mkdtempSync(join(dir, 'modes-'));
  await vaultOn(async () => {
    await vaultOf(home).put({ store: 'settings', field: 'providers.openai.apiKey', value: 'sk-acme-test' });
  });
  const uid = process.getuid();
  const rec = (p) => { const st = statSync(p); return { path: p, mode: st.mode & 0o777, uid: st.uid }; };
  assert.equal(rec(join(home, VAULT_FILE)).mode, 0o600);
  assert.equal(secretFileProblem('vault', rec(join(home, VAULT_FILE)), uid), null);
  for (const name of [VAULT_LOCK_FILE, MIGRATE_LOCK_FILE]) {
    const release = await acquireLock(join(home, name), { mode: 0o600, timeoutMs: 2000 });
    try {
      assert.equal(rec(join(home, name)).mode, 0o600, name);
      assert.equal(secretFileProblem(name, rec(join(home, name)), uid), null, name);
    } finally { await release(); }
  }
  // An open file is flagged by the same check: the rule is real.
  const loose = join(home, 'loose');
  writeFileSync(loose, 'x', { mode: 0o644 });
  assert.match(secretFileProblem('loose', rec(loose), uid), /readable by its group or by others/);
});
