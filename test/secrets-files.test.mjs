// test/secrets-files.test.mjs — the secret file names every deny rule and later vault slice share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VAULT_FILE, VAULT_LOCK_FILE, WRAPPED_KEY_FILE, VAULT_NAME_PREFIX, VAULT_ASIDE_INFIX, PROXY_LOGIN_BASENAME,
  SECRET_FILE_GLOBS, SECRET_FILE_RULE_PATHS, isSecretFileName,
} from '../src/core/secrets/files.mjs';
import { PROXY_LOGIN_FILE } from '../src/core/proxy-credentials.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('the names later slices write', () => {
  assert.equal(VAULT_FILE, 'worca-vault.enc');
  assert.equal(VAULT_LOCK_FILE, 'worca-vault.lock');
  assert.equal(isSecretFileName(VAULT_LOCK_FILE), true);
  assert.equal(WRAPPED_KEY_FILE, 'worca-vault.key');
  assert.equal(VAULT_NAME_PREFIX, 'worca-vault');
  assert.equal(VAULT_ASIDE_INFIX, '.unreadable-');
  assert.deepEqual(SECRET_FILE_GLOBS, ['proxy-login.json*', 'worca-vault*']);
  assert.deepEqual(SECRET_FILE_RULE_PATHS, ['//**/proxy-login.json*', '//**/worca-vault*']);
  assert.ok(Object.isFrozen(SECRET_FILE_GLOBS) && Object.isFrozen(SECRET_FILE_RULE_PATHS));
});

test('PROXY_LOGIN_BASENAME equals the proxy login store\'s file name', () => {
  assert.equal(PROXY_LOGIN_BASENAME, PROXY_LOGIN_FILE);
});

test('isSecretFileName: the files, their temp and moved-aside copies; not other files', () => {
  for (const n of [VAULT_FILE, 'worca-vault.enc.1a2b3c4d.tmp', VAULT_FILE + VAULT_ASIDE_INFIX + '20261121T101500Z',
    WRAPPED_KEY_FILE, 'proxy-login.json', 'proxy-login.json.ab12cd34.tmp', 'Worca-Vault.ENC', 'worca-vault-notes.md']) {
    assert.equal(isSecretFileName(n), true, n);
  }
  for (const n of ['settings.json', 'secrets.json', '', null]) assert.equal(isSecretFileName(n), false, String(n));
});

const srcHits = (match) => {
  const hits = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(?:mjs|js|cjs)$/.test(e.name) && match(readFileSync(p, 'utf8'))) hits.push(relative(ROOT, p).split('\\').join('/'));
    }
  };
  walk(join(ROOT, 'src'));
  return hits.sort();
};

test('only src/core/secrets/files.mjs spells the vault name under src/', () => {
  assert.deepEqual(srcHits((t) => t.includes('worca-vault')), ['src/core/secrets/files.mjs']);
});

test('only the name module, the vault and the vault-in-use gate use VAULT_FILE under src/', () => {
  // flag.mjs: vaultInUse() is one existsSync, and must not import vault.mjs (a flag-off process never loads it).
  assert.deepEqual(srcHits((t) => /\bVAULT_FILE\b/.test(t)), ['src/core/secrets/files.mjs', 'src/core/secrets/flag.mjs', 'src/core/secrets/vault.mjs']);
});
