// test/mcp-literal-screen.test.mjs — the literal screen (MCP registry design §4.1) and the non-secret value
// screen (§4.3): secret-looking literals in a definition, and secret-looking values typed into a set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMcpDefinition, mcpLiteralFindings, screenNonSecretValue } from '../src/core/mcp/definitions.mjs';
import { looksLikeSecret } from '../src/core/policy/registry.mjs';
import { TOKEN_SHAPE_RE, hasTokenShape } from '../src/core/mcp-secrets.mjs';
import { loadBudget } from './helpers/load-budget.mjs';

const GHP = 'ghp_' + 'a'.repeat(36);
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig';
const OPAQUE = 'Zk3q'.repeat(12); // 48 opaque chars
const stdio = (extra) => ({ type: 'stdio', command: 'node', ...extra });
const http = (extra) => ({ type: 'http', url: 'https://x.dev/mcp', ...extra });
const findings = (raw) => validateMcpDefinition(raw, { name: 'srv', source: 'manual' }).errors.join('\n');

test('literal screen hits: token shapes, JWT, secret query values, URL passwords, opaque tokens — each names its place', () => {
  const cases = [
    [http({ headers: { 'X-Auth': `Bearer ${GHP}` } }), /header X-Auth: looks like a secret — make it a secret field/],
    [stdio({ env: { SESSION_ID: 'abc' } }), /env SESSION_ID: looks like a secret/],
    [stdio({ args: ['--token', JWT] }), /args\[1\]: looks like a secret/],
    [http({ url: 'https://x.dev/mcp?api_key=abc123' }), /url: looks like a secret/],
    [http({ url: ['https://x.dev/mcp?key=abc&org=', { field: 'org' }], fields: [{ key: 'org', required: true }] }), /url: looks like a secret/],
    [http({ url: ['https://', { field: 'host' }, '/mcp?api_key=abc123'], fields: [{ key: 'host', required: true }] }), /url: looks like a secret/],
    [http({ url: [{ field: 'base' }, '/mcp?token=abc123'], fields: [{ key: 'base', required: true }] }), /url: looks like a secret/],
    [stdio({ args: ['postgresql://app:hunter2@db.internal/billing'] }), /args\[0\]: looks like a secret/],
    [stdio({ args: ['--db=postgresql://app:hunter2@db.internal/billing'] }), /args\[0\]: looks like a secret/],
    [stdio({ env: { JAVA_OPTS: '-Dmcp.endpoint=https://x.dev/mcp?token=abc123' } }), /env JAVA_OPTS: looks like a secret/],
    [http({ url: ['https://x.dev/mcp', '?api_key=abc123'] }), /url: looks like a secret/],
    [http({ url: ['https://app:pw@', { field: 'h' }, '/mcp'], fields: [{ key: 'h', required: true }] }), /url: looks like a secret/],
    [stdio({ args: [`token:${OPAQUE}`] }), /args\[0\]: looks like a secret/],
    [stdio({ args: [{ field: 'a', suffix: ` ${GHP}` }], fields: [{ key: 'a' }] }), /args\[0\]: looks like a secret/],
    [stdio({ args: [`--key=${OPAQUE}`] }), /args\[0\]: looks like a secret/],
    [stdio({ env: { A: { field: 'a', prefix: `${GHP} ` } }, fields: [{ key: 'a' }] }), /env A: looks like a secret/],
    [stdio({ fields: [{ key: 'a', default: `x,${OPAQUE}` }] }), /field a default: looks like a secret/],
    [stdio({ command: `/opt/${GHP}/srv` }), /command: looks like a secret/],
    [stdio({ description: `use ${GHP}` }), /description: looks like a secret/],
    [stdio({ env: { MCP_PATH: '/mcp?token=abc123' } }), /env MCP_PATH: looks like a secret/],
    [stdio({ args: ['https://x.dev/mcp?q=a b&token=abc'] }), /args\[0\]: looks like a secret/],
  ];
  for (const [raw, re] of cases) assert.match(findings(raw), re, JSON.stringify(raw));
});

test('no hit on absolute and relative paths, usernames without a password, an empty secret-named query parameter or an image digest', () => {
  const longPath = '/opt/mcp-servers/postgres_readonly/bin/server-main-entry';
  assert.ok(longPath.length >= 40);
  const clean = [
    stdio({ command: longPath, args: [`--root=${longPath}`, 'postgresql://readonly@db.internal/billing'] }),
    http({ url: ['https://x.dev/mcp?api_key=', { field: 'k' }], fields: [{ key: 'k', secret: true, required: true }] }),
    http({ headers: { 'X-Org': 'acme' } }),
    stdio({ command: 'docker', args: ['run', '-i', '--rm', `mcp/fetch@sha256:${'0a1b'.repeat(16)}`] }),
  ];
  for (const raw of clean) assert.equal(findings(raw), '', JSON.stringify(raw));
  // env and headers: mcpSecretFindings' own places, reported once
  assert.deepEqual(mcpLiteralFindings({ type: 'stdio', command: 'node', env: { GH: `x ${GHP}` }, fields: [], description: '' }),
    ['env GH: looks like a secret — make it a secret field']);
});

test('looksLikeSecret: a string starting with /, ./, ~/ or a drive letter is not an opaque token', () => {
  for (const p of ['/opt/mcp-servers/postgres_readonly/bin/server-main-entry', './mcp-servers/postgres_readonly/bin/server-main',
    '~/mcp-servers/postgres_readonly/bin/server-main-entry', 'C:/mcp-servers/postgres_readonly/bin/server-main-entry']) {
    assert.equal(looksLikeSecret(p), false, p);
  }
  assert.equal(looksLikeSecret(OPAQUE), true);
  assert.equal(looksLikeSecret('sk-ant-' + 'a'.repeat(30)), true);
});

test('screenNonSecretValue: text rules, $ / { edges, substring token screen', () => {
  assert.equal(screenNonSecretValue('acme-billing'), null);
  assert.equal(screenNonSecretValue('postgresql://readonly@db.internal/billing'), null);
  assert.equal(screenNonSecretValue(OPAQUE), null); // values get the substring screen only (§4.3)
  const bad = [
    [5, /must be text/],
    ['a${X}', /may not contain \$\{/],
    ['a\tb', /control characters/],
    ['cost$', /may not end with \$/],
    ['{NAME}', /may not start with \{/],
    [`org ${GHP}`, /make this field secret/],
    ['postgresql://app:pw@db/x', /make this field secret/],
    ['https://x.dev/?token=abc', /make this field secret/],
    ['--db=postgresql://app:pw@db/x', /make this field secret/],
    ['mcp?token=abc123', /make this field secret/],
    ['https://x.dev/mcp?q=a b&token=abc', /make this field secret/],
    ['https://u:correct horse@x.dev/mcp', /make this field secret/],
  ];
  for (const [v, re] of bad) assert.match(screenNonSecretValue(v), re, String(v));
});

test('the screens stay linear on long text (a PUT body, a policy value, a manifest arg)', () => {
  // 'a.': a possible URL scheme start at every letter; 'eyJ-': a JWT start after every `-` (TOKEN_SHAPE_RE rescans the run)
  for (const long of ['a.'.repeat(75000), 'eyJ-'.repeat(37500)]) {
    for (const run of [() => screenNonSecretValue(long), () => findings(stdio({ args: [long] })), () => findings(stdio({ env: { A: long } }))]) {
      const t0 = performance.now();
      run();
      const ms = performance.now() - t0;
      assert.ok(ms < loadBudget(2000), `${long.slice(0, 4)}…: took ${Math.round(ms)} ms`);
    }
  }
});

test('a definition with 200k secret-looking args returns its findings, never throws', () => {
  const { def, errors } = validateMcpDefinition(stdio({ args: Array.from({ length: 200000 }, () => `sk-${'a'.repeat(20)}`) }), { name: 'srv', source: 'manual' });
  assert.equal(def, null);
  assert.ok(errors.length > 200000, String(errors.length)); // errors.push(...list) overflows the stack at ~120k
});

test('hasTokenShape answers exactly as TOKEN_SHAPE_RE', () => {
  const samples = ['eyJhbGciOiJIUzI1NiJ9.e30.sig', 'x-eyJhbGciOiJIUzI1NiJ9.e30', 'xeyJhbGciOiJIUzI1NiJ9.e30', 'eyJ-eyJhbGciOiJ.x',
    '-eyJabcdefghij.', '-eyJabcdefghi.', 'eyJabcdefghij', 'a b eyJabcdefghij.', `sk-${'a'.repeat(16)}`, `sk-${'a'.repeat(15)}`, GHP,
    `AKIA${'A'.repeat(16)}`, 'plain text', ''];
  for (const s of samples) assert.equal(hasTokenShape(s), TOKEN_SHAPE_RE.test(s), s);
});

test('a single token near the 8 MB body limit never makes a check throw (no quantifier keeps a backtrack entry per character)', () => {
  const long = 'a'.repeat(8e6);
  assert.match(findings(stdio({ args: [long] })), /args\[0\]: looks like a secret/);
  assert.match(findings(stdio({ env: { A: `@sha256:${long}` } })), /env A: looks like a secret/);
  assert.equal(looksLikeSecret(long), true);
  assert.equal(looksLikeSecret(`eyJ${long}.x`), true);
  assert.deepEqual([39, 40].map((n) => looksLikeSecret('a'.repeat(n))), [false, true]); // a long opaque token: 40 or more
  for (const [t, want] of [['eyJabcdefghij.x', true], ['eyJabcdefghi.x', false], ['eyJabcdefghij', false], ['eyJabc/efghijk.x', false]]) assert.equal(looksLikeSecret(t), want, t);
  assert.equal(screenNonSecretValue(`sk-${long}`), 'looks like a secret — make this field secret');
  for (const p of ['sk-', 'ghp_', 'github_pat_', 'xoxb-']) assert.equal(hasTokenShape(p + long), true, p);
});
