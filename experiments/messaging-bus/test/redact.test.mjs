// T-redact: secret values masked in every published string; secret paths never published (plan §3.3, §4.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactText, redactSecretValues, isSecretPath, SECRET_PATTERNS } from '../lib/redact.mjs';

// built at run time so this file holds no secret-shaped literal
const r = (n, c = 'a') => c.repeat(n);
const SAMPLES = {
  wbt: `wbt_${r(24)}`,
  ghp: `ghp_${r(36, 'B')}`,
  ghs: `ghs_${r(36, 'C')}`,
  pat: `github_pat_${r(30, 'D')}`,
  ant: `sk-ant-api03-${r(30, 'E')}`,
  sk: `sk-${r(24, 'F')}`,
  aws: `AKIA${r(16, 'G')}`,
  slack: `xoxb-${r(12, '1')}-${r(12, 'h')}`,
  pem: `-----BEGIN RSA PRIVATE KEY-----\n${r(40, 'Q')}\n-----END RSA PRIVATE KEY-----`,
};

test('each secret pattern is masked', () => {
  for (const [name, secret] of Object.entries(SAMPLES)) {
    const out = redactText(`before ${secret} after`);
    assert.ok(!out.includes(secret), name);
    assert.ok(out.startsWith('before ') && out.endsWith(' after'), `${name}: ${out}`);
    assert.ok(out.includes('[redacted]'), name);
    assert.ok(SECRET_PATTERNS.some((p) => new RegExp(p.source, p.flags.replace('g', '')).test(secret)), `${name} in SECRET_PATTERNS`);
  }
});

test('URL userinfo is masked, the user name included', () => {
  const out = redactText('clone https://alice:hunter2@example.com/r.git now');
  assert.equal(out, 'clone https://[redacted]@example.com/r.git now');
  assert.equal(redactText('ssh://bob@host/x'), 'ssh://[redacted]@host/x');
});

test('key = value secrets keep the key and lose the value', () => {
  assert.equal(redactText('password = swordfish'), 'password = [redacted]');
  assert.equal(redactText('api_key: abc123'), 'api_key: [redacted]');
  assert.equal(redactText('TOKEN=xyz'), 'TOKEN=[redacted]');
});

test('key = value: the key may be the tail of a longer name (M3a)', () => {
  assert.equal(redactText("f(a, GITHUB_TOKEN = 'abcdef123456')"), 'f(a, GITHUB_TOKEN = [redacted]');
  assert.equal(redactText("{ a, DB_PASSWORD: 'hunter2hunter2' }"), '{ a, DB_PASSWORD: [redacted] }');
  assert.equal(redactText('apiToken: "abc"'), 'apiToken: [redacted]');
  assert.equal(redactText('clientSecret=abc'), 'clientSecret=[redacted]');
});

test('a PEM block with no END marker (a clipped one) is masked to the end of the text (M3b)', () => {
  const out = redactText(`k = "-----BEGIN RSA PRIVATE KEY----- ${r(80, 'Q')}`);
  assert.ok(!out.includes('QQQQ'), out);
  assert.ok(out.includes('[redacted]'));
  assert.ok(!redactSecretValues(`x -----BEGIN PRIVATE KEY-----${r(80, 'Z')}`).includes('ZZZZ'));
});

test('plain code is untouched', () => {
  const code = 'lib.mjs: price(item) → price(item, opts) [signature]; const sky = tokenize(x); task-done';
  assert.equal(redactText(code), code);
  assert.equal(redactText(''), '');
});

test('isSecretPath covers the list', () => {
  for (const p of ['.env', '.env.local', 'app/.env.production', 'deploy.pem', 'certs/server.key', 'id_rsa', 'home/id_rsa.pub',
    'aws-credentials.json', 'config/credentials', '.npmrc', 'x/.netrc']) assert.equal(isSecretPath(p), true, p);
  for (const p of ['src/env.mjs', 'docs/keys.md', 'lib/pem-parser.mjs', 'src/a.mjs', 'environment.ts']) assert.equal(isSecretPath(p), false, p);
});

test('redactSecretValues masks secret-shaped values and userinfo but leaves key = value code alone', () => {
  const code = "  pid: process.pid, host: HOST, port, token: uiControl.token,";
  assert.equal(redactSecretValues(code), code);
  assert.notEqual(redactText(code), code);
  assert.ok(!redactSecretValues(`x ${SAMPLES.ghp} y`).includes(SAMPLES.ghp));
  assert.equal(redactSecretValues('https://u:p@h/x'), 'https://[redacted]@h/x');
});
