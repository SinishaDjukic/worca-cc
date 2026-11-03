// test/mcp-definitions.test.mjs — MCP registry definition rules (design §4.1): types, names, field keys,
// env keys, header names, field refs and their placement, url forms, non-secret text, description.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMcpDefinition, canonicalJson, sha256Hex, SET_ID_RE, SERVER_ID_RE, MEMBERSHIP_KEY_RE } from '../src/core/mcp/definitions.mjs';
import { loadBudget } from './helpers/load-budget.mjs';

const plain = (v) => JSON.parse(JSON.stringify(v));
const SENTRY = {
  type: 'http', url: 'https://mcp.sentry.dev/mcp',
  headers: { Authorization: { field: 'token', prefix: 'Bearer ' }, 'X-Sentry-Org': { field: 'org' } },
  fields: [
    { key: 'token', label: 'Sentry token', secret: true, oauth: true, required: true },
    { key: 'org', label: 'Organization', required: true },
  ],
  description: 'Sentry issues and events',
};
const JIRA = {
  type: 'stdio', command: 'node', args: ['./mcp/jira.mjs'],
  env: { JIRA_URL: { field: 'baseUrl' }, JIRA_TOKEN: { field: 'token' } },
  fields: [
    { key: 'baseUrl', label: 'Jira URL', required: true, default: 'https://acme.atlassian.net' },
    { key: 'token', label: 'API token', secret: true, required: true },
  ],
  description: 'Search and read Jira issues',
};
const PG = {
  type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', { field: 'database' }],
  env: { PGPASSWORD: { field: 'password' } },
  fields: [{ key: 'database', label: 'Database URL', required: true }, { key: 'password', label: 'Password', secret: true, required: true }],
  description: 'Read-only replica of the app database',
};
const manual = (raw, name = 'srv') => validateMcpDefinition(raw, { name, source: 'manual' });
const errorsOf = (raw, source = 'manual') => validateMcpDefinition(raw, { name: 'srv', source }).errors.join('\n');

test('the spec examples validate and normalize (defaults filled, maps null-prototype)', () => {
  const s = validateMcpDefinition(SENTRY, { name: 'sentry', source: 'plugin' });
  assert.deepEqual(s.errors, []);
  assert.deepEqual(plain(s.def), {
    type: 'http', url: 'https://mcp.sentry.dev/mcp',
    headers: { Authorization: { field: 'token', prefix: 'Bearer ' }, 'X-Sentry-Org': { field: 'org' } },
    fields: [
      { key: 'token', label: 'Sentry token', secret: true, oauth: true, required: true },
      { key: 'org', label: 'Organization', secret: false, oauth: false, required: true },
    ],
    description: 'Sentry issues and events',
  });
  assert.equal(Object.getPrototypeOf(s.def.headers), null);
  assert.deepEqual(validateMcpDefinition(JIRA, { name: 'jira', source: 'plugin' }).errors, []);
  assert.equal(validateMcpDefinition(JIRA, { name: 'jira', source: 'plugin' }).def.args[0], './mcp/jira.mjs');
  assert.deepEqual(manual(PG, 'postgres-ro').errors, []);
  const bare = manual({ type: 'stdio', command: '/usr/bin/srv', fields: [{ key: 'k' }] }).def;
  assert.deepEqual(plain(bare), { type: 'stdio', command: '/usr/bin/srv', fields: [{ key: 'k', label: 'k', secret: false, oauth: false, required: false }], description: '' });
});

test('env and header maps keep own keys like __proto__ and constructor', () => {
  const raw = JSON.parse('{"type":"stdio","command":"node","env":{"__proto__":"x","constructor":"y"}}');
  const { def, errors } = manual(raw);
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(def.env), ['__proto__', 'constructor']);
});

test('names: ^[a-z][a-z0-9-]{0,19}$, worca reserved', () => {
  for (const name of ['Sentry', 'my_srv', '9x', 'a'.repeat(21), '', undefined, ['worca'], ['srv']]) {
    assert.match(validateMcpDefinition(PG, { name, source: 'manual' }).errors.join(), /name/, String(name));
  }
  for (const name of [JSON.parse('{"toString":0}'), JSON.parse('[{"toString":0}]'), Object.create(null)]) { // coercing these throws
    assert.match(validateMcpDefinition(PG, { name, source: 'policy' }).errors.join(), /name/);
  }
  assert.match(validateMcpDefinition(PG, { name: 'worca', source: 'manual' }).errors.join(), /reserved/);
  assert.deepEqual(validateMcpDefinition(PG, { name: 'a'.repeat(20), source: 'manual' }).errors, []);
});

const stdio = (extra) => ({ type: 'stdio', command: 'node', ...extra });
const http = (extra) => ({ type: 'http', url: 'https://x.dev/mcp', ...extra });
const F = (key, extra = {}) => ({ key, label: key, ...extra });
const SECRET = (key) => F(key, { secret: true, required: true });

test('refusals, one per rule', () => {
  const cases = [
    [{ type: 'ws', url: 'https://x' }, /type must be stdio, http or sse/],
    [{ type: 'stdio' }, /command is required/],
    [stdio({ command: '   ' }), /command is required/],
    [stdio({ command: 'bin/srv' }), /command: use an absolute path or a bare name/],
    [stdio({ command: './srv' }), /command: use an absolute path or a bare name/],
    [stdio({ args: ['./x.mjs'] }), /args\[0\]: \.\/ paths are only for plugin servers/],
    [stdio({ args: 'x' }), /args must be an array/],
    [stdio({ env: { '1BAD': 'x' } }), /env 1BAD: /],
    [stdio({ env: { MCPSECRET_X: 'x' } }), /env MCPSECRET_X: MCPSECRET_ and MCPCHILD_ names are reserved/],
    [stdio({ env: { mcpChild_x: 'x' } }), /env mcpChild_x: MCPSECRET_ and MCPCHILD_ names are reserved/],
    [stdio({ env: { Foo: 'a', FOO: 'b' } }), /env FOO: declared twice/],
    [http({ headers: { Host: 'x' } }), /header Host: not allowed/],
    [http({ headers: { 'content-length': '1' } }), /header content-length: not allowed/],
    [http({ headers: { 'Transfer-Encoding': 'x' } }), /header Transfer-Encoding: not allowed/],
    [http({ headers: { Connection: 'x' } }), /header Connection: not allowed/],
    [http({ headers: { Upgrade: 'x' } }), /header Upgrade: not allowed/],
    [http({ headers: { 'Bad Header': 'x' } }), /header Bad Header: not a valid header name/],
    [http({ headers: { 'X-A': 'a', 'x-a': 'b' } }), /header x-a: declared twice/],
    [stdio({ fields: [F('_x')] }), /fields\[0\]: key must be/],
    [stdio({ fields: [{ key: true }] }), /fields\[0\]: key must be/],
    [stdio({ fields: [{ key: ['tok'] }] }), /fields\[0\]: key must be/],
    [stdio({ fields: [F('a', { default: 5 })] }), /field a: default must be text/],
    [http({ headers: { 'X(A)': 'x' } }), /header X\(A\): not a valid header name/],
    [http({ url: [] }), /url is required/],
    [stdio({ description: `a${String.fromCharCode(31)}b` }), /description: may not contain control characters/],
    [http({ url: ['https://x.dev/mcp', 'field0x#', { field: 's' }], fields: [SECRET('s')] }), /url: secret field s may appear only in the path or query/],
    [stdio({ fields: [F('a'.repeat(33))] }), /fields\[0\]: key must be/],
    [stdio({ env: { ['A'.repeat(65)]: 'x' } }), /env A+: names are letters/],
    [stdio({ fields: [F('token'), F('TOKEN')] }), /fields\[1\]: key TOKEN is declared twice/],
    [stdio({ fields: [F('t', { oauth: true })] }), /field t: oauth applies to secret fields only/],
    [stdio({ fields: [F('t', { secret: true, default: 'x' })] }), /field t: a secret field has no default/],
    [stdio({ fields: [F('t', { secret: 'true' })] }), /field t: secret must be true or false/],
    [stdio({ args: [{ field: 'nope' }] }), /args\[0\]: unknown field "nope"/],
    [stdio({ args: [{ nope: 1 }] }), /args\[0\]: must be text or \{ "field": … \}/],
    [stdio({ args: [{ field: 'a', prefix: 'x$' }], fields: [F('a')] }), /args\[0\]: prefix may not end with \$/],
    [stdio({ args: [{ field: 'a', suffix: '{x' }], fields: [F('a')] }), /args\[0\]: suffix may not start with \{/],
    [stdio({ args: ['a${HOME}'] }), /args\[0\]: may not contain \$\{/],
    [stdio({ env: { A: { field: 'a', prefix: '${X}' } }, fields: [F('a')] }), /env A prefix: may not contain \$\{/],
    [stdio({ fields: [F('a', { default: 'x\ny' })] }), /field a: default may not contain control characters/],
    [stdio({ description: 'line\u007f' }), /description: may not contain control characters/],
    [stdio({ description: 'x'.repeat(201) }), /description: at most 200 characters/],
    [stdio({ description: 5 }), /description must be text/],
    [stdio({ args: [{ field: 'tok' }], fields: [SECRET('tok')] }), /args\[0\]: secret field tok cannot be an argument/],
    [stdio({ env: { API_TOKEN: { field: 'a' } }, fields: [F('a')] }), /env API_TOKEN: field a must be secret/],
    [http({ headers: { Authorization: { field: 'a', prefix: 'Bearer ' } }, fields: [F('a')] }), /header Authorization: field a must be secret/],
    [{ type: 'http' }, /url is required/],
    [http({ url: 'http://example.com/mcp' }), /url: must be https:\/\//],
    [http({ url: 'not a url' }), /url: not a valid URL/],
    [http({ url: { field: 'u' }, fields: [F('u')] }), /url: field u must be required/],
    [http({ url: { field: 'u' }, fields: [SECRET('u')] }), /url: a URL that starts with a field cannot use a secret field/],
    [http({ url: ['https://', { field: 's' }, '.x.dev/mcp'], fields: [SECRET('s')] }), /url: secret field s may appear only in the path or query/],
    [http({ url: ['https://', { field: 's' }, '@x.dev/mcp'], fields: [SECRET('s')] }), /url: secret field s may appear only in the path or query/],
    [http({ url: ['https://x.dev/mcp#', { field: 's' }], fields: [SECRET('s')] }), /url: secret field s may appear only in the path or query/],
    [http({ url: ['https://x.dev/', { field: 's' }, '/../mcp'], fields: [SECRET('s')] }), /url: secret field s may appear only in the path or query/],
    [http({ url: ['https://x.dev/mcp?api_key=', { field: 'k' }], fields: [F('k', { required: true })] }), /url: field k is the value of api_key: make it a secret field/],
    [http({ url: [{ field: 'base' }, '/mcp?token=', { field: 't' }], fields: [F('base', { required: true }), F('t', { required: true })] }), /url: field t is the value of token: make it a secret field/],
    [http({ url: ['https://x.dev/', { field: 'a', suffix: '$' }, '{GITHUB_TOKEN}'], fields: [F('a', { required: true })] }), /url: its parts may not join into \$\{/],
    [http({ url: ['https://x.dev/$', { field: 'a', prefix: '{HOME}' }], fields: [F('a', { required: true })] }), /url: its parts may not join into \$\{/],
    [http({ url: [[{ field: 'u' }]], fields: [F('u', { required: true })] }), /url\[0\]: must be text or/],
    [stdio({ env: { A: { field: 'a', prefix: 5 } }, fields: [F('a')] }), /env A: prefix must be text/],
    [stdio({ fields: [F('a', { label: 5 })] }), /field a: label must be text/],
    [stdio({ command: 'a${X}' }), /command: may not contain \$\{/],
    [stdio({ fields: {} }), /fields must be an array/],
    [stdio({ env: 'A=1' }), /env must be an object/],
    [stdio({ fields: [F('t', { required: 'yes' })] }), /field t: required must be true or false/],
    [stdio({ fields: [F('t', { secret: true, oauth: 1 })] }), /field t: oauth must be true or false/],
    [stdio({ command: 'bin\\srv' }), /command: use an absolute path or a bare name/],
    [http({ url: 'ftp://x.dev/mcp' }), /url: must be https:\/\//],
    [stdio({ fields: [F('a', { label: '  ' })] }), /field a: label must be text/],
    [stdio({ fields: [F('a', { label: 'a${X}' })] }), /field a: label may not contain \$\{/],
  ];
  for (const [raw, re] of cases) assert.match(errorsOf(raw), re, JSON.stringify(raw));
  for (const [raw] of cases) assert.equal(validateMcpDefinition(raw, { name: 'srv', source: 'manual' }).def, null);
  const edges = [stdio({ env: { ['A'.repeat(64)]: 'x' } }), stdio({ fields: [F('a'.repeat(32))] }), stdio({ description: 'word '.repeat(40) })];
  for (const raw of edges) assert.equal(errorsOf(raw), '', JSON.stringify(raw));
});

test('plugin sources may use ./ in command and args; other relative paths are refused for every source', () => {
  assert.equal(errorsOf(stdio({ command: './bin/srv', args: ['./x.mjs'] }), 'plugin'), '');
  assert.match(errorsOf(stdio({ command: '../srv' }), 'plugin'), /command: use \.\/…/);
  assert.match(errorsOf(stdio({ command: './srv' }), 'policy'), /command: use an absolute path/);
  for (const command of ['/usr/local/bin/srv', 'C:\\tools\\srv.exe', 'npx']) assert.equal(errorsOf(stdio({ command })), '', command);
});

test('url forms: string, one field ref, array; loopback http; secrets in path and query', () => {
  const ok = [
    http({ url: 'http://localhost:3000/mcp' }),
    http({ url: 'http://127.0.0.1/mcp' }),
    http({ url: 'http://[::1]:8080/' }),
    http({ url: { field: 'u' }, fields: [F('u', { required: true })] }),
    http({ url: ['https://x.dev/mcp'] }),
    { type: 'sse', url: 'https://x.dev/sse' },
    http({ url: ['https://', { field: 'host' }, '/', { field: 'tok' }, '?api_key=', { field: 'key' }],
      fields: [F('host', { required: true }), SECRET('tok'), SECRET('key')] }),
  ];
  for (const raw of ok) assert.equal(errorsOf(raw), '', JSON.stringify(raw));
  assert.deepEqual(plain(manual(http({ url: ['https://x.dev/mcp'] })).def.url), 'https://x.dev/mcp');
  assert.equal(manual(http({ url: ['https://x.dev', '/mcp'] })).def.url, 'https://x.dev/mcp'); // all text: one string
  assert.deepEqual(plain(manual(stdio({ args: [{ field: 'a', prefix: '', suffix: '' }], fields: [F('a')] })).def.args), [{ field: 'a' }]); // empty = none
  // text that looks like a placeholder is no field ref: `mcpfield00x` is not ref 0 (`mcpfield0x`)
  assert.doesNotMatch(errorsOf(http({ url: ['https://x.dev/mcp?org=', { field: 'a' }, '&token=mcpfield00x'], fields: [F('a', { required: true })] })), /field a is the value/);
});

test('url checks stay linear in the number of field refs (a manifest, a policy entry, the manual form)', () => {
  const query = ['https://x.dev/mcp?'];
  for (let i = 0; i < 16000; i++) query.push({ field: 'a' }, '&token=mcpfield15999x&'); // every value holds the last ref
  const path = ['https://x.dev/'];
  for (let i = 0; i < 40000; i++) path.push({ field: 's' }, '/');
  const cases = [[http({ url: query, fields: [F('a', { required: true })] }), /url: field a is the value of token: make it a secret field/],
    [http({ url: path, fields: [SECRET('s')] }), /^$/]];
  for (const [raw, re] of cases) {
    const t0 = performance.now();
    const out = errorsOf(raw);
    const ms = performance.now() - t0;
    assert.match(out, re);
    assert.ok(ms < loadBudget(2000), `took ${Math.round(ms)} ms`);
  }
});

test('canonicalJson sorts keys recursively and keeps array order; sha256Hex', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  assert.equal(sha256Hex('acme/platform').slice(0, 4), '9333');
});

test('id validators (§12): valid and invalid ids of every form', () => {
  const table = [
    [SET_ID_RE, ['general', 'billing', 's--2', 'team-acme-platform-9333', 'x'.repeat(32)],
      ['General', '2x', 'a_b', 'x'.repeat(33), '', 'billing|x']],
    [SERVER_ID_RE, ['manual:postgres-ro', 'plugin:acme-tools/sentry', 'policy:acme/platform/github', 'policy:gitlab.example/grp/sub/linear', 'policy:acme/_tools/linear'],
      ['manual:Pg', 'manual:a_b', `manual:${'a'.repeat(21)}`, 'plugin:acme-tools', 'plugin:Acme/sentry', 'plugin:a--b/x',
        'policy:github', 'policy:Acme/x/github', 'policy:.acme/github', 'policy:acme//github', 'mcp:x']],
    [MEMBERSHIP_KEY_RE, ['billing|manual:pg', 'general|plugin:acme-tools/sentry', 'team-acme-platform-9333|policy:acme/platform/github'],
      ['billingmanual:pg', 'billing|', '|manual:pg', 'Billing|manual:pg', 'billing|manual:pg|x', 'billing|mcp:x']],
  ];
  for (const [re, valid, invalid] of table) {
    for (const id of valid) assert.match(id, re, id);
    for (const id of invalid) assert.doesNotMatch(id, re, id);
  }
});

test('id validators stop at 1024 characters and never throw on a long entry (P4 mcpOptOut, P5 mcpOff: 8 MB bodies)', () => {
  const plugin = `plugin:a${'-a'.repeat(4e6)}/x`;
  const policy = `policy:${'a/'.repeat(4e6)}x`;
  for (const s of [plugin, policy]) {
    assert.equal(SERVER_ID_RE.test(s), false);
    assert.equal(MEMBERSHIP_KEY_RE.test(`x|${s}`), false);
  }
  const id = (n) => `policy:${'a'.repeat(n - 9)}/x`; // a server id of n characters: at most 1024
  assert.match(id(1024), SERVER_ID_RE);
  assert.match(`x|${id(1024)}`, MEMBERSHIP_KEY_RE);
  assert.doesNotMatch(id(1025), SERVER_ID_RE);
  assert.doesNotMatch(`x|${id(1025)}`, MEMBERSHIP_KEY_RE);
});
