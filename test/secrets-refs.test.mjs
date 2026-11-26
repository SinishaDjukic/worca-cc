// test/secrets-refs.test.mjs — vault references, the owner check and the fixed refusal messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VAULT_REF_PREFIX, VAULT_STORES, isVaultRef, newVaultRef, refId, checkOwner, VaultError, VAULT_MESSAGES,
} from '../src/core/secrets/refs.mjs';

test('a new ref is the prefix plus 22 base64url characters, and 1000 refs are unique', () => {
  assert.equal(VAULT_REF_PREFIX, 'worca:vault:v1:');
  const refs = new Set();
  for (let i = 0; i < 1000; i++) {
    const r = newVaultRef();
    assert.match(r, /^worca:vault:v1:[A-Za-z0-9_-]{22}$/);
    assert.equal(isVaultRef(r), true);
    assert.equal(refId(r), r.slice(VAULT_REF_PREFIX.length));
    refs.add(r);
  }
  assert.equal(refs.size, 1000);
});

test('isVaultRef rejects near-misses and non-strings; refId gives null for them', () => {
  const id = 'A'.repeat(22);
  for (const v of [VAULT_REF_PREFIX + 'A'.repeat(21), VAULT_REF_PREFIX + 'A'.repeat(23), 'worca:vault:v2:' + id,
    'worca:vault:v1' + id, VAULT_REF_PREFIX + 'A'.repeat(21) + '+', VAULT_REF_PREFIX + id + '\n', 'sk-abc', '', null, undefined, 42, { ref: VAULT_REF_PREFIX + id }]) {
    assert.equal(isVaultRef(v), false, String(v));
    assert.equal(refId(v), null);
  }
  assert.equal(isVaultRef(VAULT_REF_PREFIX + id), true);
});

test('the store set is closed and frozen', () => {
  assert.deepEqual(VAULT_STORES, ['settings', 'mcp', 'plugin', 'proxy']);
  assert.ok(Object.isFrozen(VAULT_STORES));
});

test('checkOwner accepts a known store and a plain field, and rejects the rest', () => {
  assert.equal(checkOwner({ store: 'settings', field: 'providers.openai.apiKey' }), null);
  assert.equal(checkOwner({ store: 'proxy', field: 'x'.repeat(256) }), null);
  for (const o of [{ store: 'vault', field: 'a' }, { store: 'settings', field: '' }, { store: 'settings', field: 'x'.repeat(257) },
    { store: 'settings', field: 'a\nb' }, { store: 'settings', field: 'a\u0007b' }, { store: 'settings' }, { field: 'a' }, {}, undefined]) {
    assert.deepEqual(checkOwner(o), { code: 'bad-owner', message: 'invalid vault owner' }, JSON.stringify(o));
  }
});

test('VaultError carries the table message, its code and no cause', () => {
  const e = new VaultError('tampered');
  assert.ok(e instanceof Error);
  assert.equal(e.code, 'tampered');
  assert.equal(e.message, 'the vault file was changed outside Worca or is damaged; it was not used');
  assert.equal('cause' in e, false);
  assert.equal(new VaultError('store-locked', { reason: 'timeout' }).reason, 'timeout');
  assert.equal(new VaultError('unsupported-format', { format: 2 }).message, 'the vault file was written by a newer Worca (format 2)');
  assert.equal(new VaultError('lock-order', { name: 'mcp' }).message, 'cannot wait on the mcp lock while holding the vault lock');
  assert.equal(new VaultError('lock-busy').message, 'another Worca process holds the vault lock; try again');
  assert.ok(Object.isFrozen(VAULT_MESSAGES));
  for (const code of Object.keys(VAULT_MESSAGES)) assert.equal(typeof new VaultError(code).message, 'string');
});
