// test/ask-redact.test.mjs
// P1/T6: best-effort redaction for text that flows from tools to the model and
// from the model to the DB (ask-worca-design.md §6.1 redact.mjs, §6.6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactAskText, ASK_EXTRA_PATTERNS } from '../src/core/ask/redact.mjs';

test('null/undefined → "", plain text untouched', () => {
  assert.equal(redactAskText(null), '');
  assert.equal(redactAskText(undefined), '');
  assert.equal(redactAskText('hello world 123'), 'hello world 123');
});

test('anthropic, github, aws keys', () => {
  assert.equal(redactAskText('key=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'), 'key=sk-ant-<redacted>');
  assert.equal(redactAskText('token ghp_abcdefghijklmnopqrstuvwxyz0123456789 ok'), 'token ghp_<redacted> ok');
  assert.equal(redactAskText('github_pat_11ABCDEFG0123456789_abcdefghijklmnop'), 'github_pat_<redacted>');
  assert.equal(redactAskText('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE'), 'AWS_ACCESS_KEY_ID=AKIA<redacted>');
  assert.equal(redactAskText('AKIA1234 is too short'), 'AKIA1234 is too short');
});

test('PEM private key blocks collapse to a placeholder (any key type, multi-line)', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nABCD\n-----END RSA PRIVATE KEY-----';
  assert.equal(redactAskText(`before\n${pem}\nafter`),
    'before\n-----BEGIN PRIVATE KEY-----\n<redacted>\n-----END PRIVATE KEY-----\nafter');
  const ec = '-----BEGIN PRIVATE KEY-----\nxyz\n-----END PRIVATE KEY-----';
  assert.equal(redactAskText(ec), '-----BEGIN PRIVATE KEY-----\n<redacted>\n-----END PRIVATE KEY-----');
  assert.equal(redactAskText('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'),
    '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----', 'certificates are not secrets');
  const two = `${pem}\nKEEP THIS LINE\n${ec}`;
  assert.equal(redactAskText(two),
    '-----BEGIN PRIVATE KEY-----\n<redacted>\n-----END PRIVATE KEY-----\nKEEP THIS LINE\n-----BEGIN PRIVATE KEY-----\n<redacted>\n-----END PRIVATE KEY-----',
    'lazy match: the text between two key blocks survives');
});

test('composes with chat/redact.mjs (messenger patterns still apply)', () => {
  assert.equal(redactAskText('Authorization: Bearer abc.def.ghi'), 'Authorization: Bearer <redacted>');
  assert.equal(redactAskText('xoxb-123-abc'), 'xox<redacted>');
});

test('a diff hunk keeps its structure around the redaction', () => {
  const diff = 'diff --git a/.envrc b/.envrc\n+export KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz\n-old\n';
  assert.equal(redactAskText(diff), 'diff --git a/.envrc b/.envrc\n+export KEY=sk-ant-<redacted>\n-old\n');
});

test('ASK_EXTRA_PATTERNS is a frozen list of [RegExp, string] pairs with the g flag', () => {
  assert.ok(Object.isFrozen(ASK_EXTRA_PATTERNS));
  assert.equal(ASK_EXTRA_PATTERNS.length, 5);
  for (const [re, rep] of ASK_EXTRA_PATTERNS) {
    assert.ok(re instanceof RegExp && re.global, `${re} is global`);
    assert.equal(typeof rep, 'string');
  }
});
