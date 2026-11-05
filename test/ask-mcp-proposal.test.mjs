import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpChangeValidator, mcpEventPrompt, mcpNoticeText, cardLeaks, describeForChat, defLines, fieldKeyFor, keepMasked, MCP_ERRORS, MASK } from '../src/core/ask/mcp-proposal.mjs';
import { fieldKeyFor as formFieldKeyFor } from '../ui/public/mcp-definition-form.mjs';
import { looksLikeSecret } from '../src/core/policy/registry.mjs';
import { validateMcpDefinition, defDigest } from '../src/core/mcp/definitions.mjs';

// Stored definitions are the registry's normalised ones (validateMcpDefinition adds `oauth: false` to each field),
// so the fixtures go through it too; a raw fixture would make the no-change edit look like a change.
const norm = (raw, name) => validateMcpDefinition(raw, { name, source: 'manual' }).def;

const GH = norm({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_TOKEN: { field: 'GITHUB_TOKEN' } }, fields: [{ key: 'GITHUB_TOKEN', label: 'GITHUB_TOKEN', secret: true, required: true }], description: '' }, 'gh');
const API = norm({ type: 'http', url: 'https://api.example.test/mcp', headers: { Authorization: { field: 'Authorization', prefix: 'Bearer ' } },
  fields: [{ key: 'Authorization', label: 'Authorization', secret: true, required: true }], description: '' }, 'api');
const catalog = [
  { id: 'manual:gh', source: 'manual', name: 'gh', base: 'gh', sourceLabel: 'Manual', def: GH, inSets: ['General'] },
  { id: 'manual:api', source: 'manual', name: 'api', base: 'api', sourceLabel: 'Manual', def: API, inSets: ['General'] },
  { id: 'plugin:acme/docs', source: 'plugin', name: 'docs', base: 'docs', sourceLabel: 'acme', def: { type: 'http', url: 'https://docs.acme.test/mcp', headers: {}, fields: [], description: '' }, inSets: [] },
  { id: 'policy:team-x/lint', source: 'policy', name: 'lint', base: 'lint', sourceLabel: 'Team · team-x', def: { type: 'stdio', command: 'lint-mcp', args: [], env: {}, fields: [], description: '' }, inSets: [] },
];
const validate = createMcpChangeValidator({
  catalog: async () => catalog,
  nameTaken: async (n) => catalog.some((e) => e.name === n),
  engines: (_n, def) => (def.type === 'stdio' ? { on: ['Claude', 'Codex'], off: [] } : { on: ['Claude'], off: [{ engine: 'Codex', reason: 'remote, and codex attaches stdio servers only: x' }] }),
});
const TOKEN = 'ghp_' + 'a'.repeat(36);
const LONG = '0123456789abcdef0123456789abcdef01234567';
const errsOf = async (inp) => { const r = await validate(inp); assert.equal(r.ok, false, JSON.stringify(inp)); return r.errors.join('\n'); };
const ROW1 = [
  [{ kind: 'rename', name: 'x' }, /kind must be one of add, edit, remove, import/],
  [{ kind: 'add' }, /name is required/],
  [{ kind: 'add', name: 'x', type: 'ws' }, /type must be stdio, http or sse/],
  [{ kind: 'add', name: 'Bad Name', type: 'stdio', command: 'x' }, /1–20 lowercase/],
  [{ kind: 'add', name: 'x', type: 'stdio', command: 'x', args: ['--root=${HOME}/a'] }, /works only as the whole value/],
  [{ kind: 'add', name: 'x', type: 'stdio', command: 'x', env: { API_HOST: TOKEN } }, /env API_HOST looks like a secret/],
  [{ kind: 'add', name: 'x', type: 'stdio', command: 'x', args: ['--token', TOKEN] }, /args\[1\] looks like a secret/],
  [{ kind: 'add', name: 'gh', type: 'stdio', command: 'x' }, /the name "gh" is taken/],
  [{ kind: 'edit', name: 'docs', type: 'http', url: 'https://docs.acme.test/mcp' }, /comes from the plugin acme and is read-only/],
  [{ kind: 'remove', name: 'lint' }, /Team · team-x and is read-only/],
  [{ kind: 'remove', name: 'nope' }, /no MCP server "nope"/],
  [{ kind: 'add', name: 'x', type: 'stdio', command: 'x', args: ['--rev', LONG] }, /args\[1\] looks like a secret/],
];

test('validation errors', async () => {
  assert.equal(looksLikeSecret(LONG), true);
  for (const [inp, re] of ROW1) assert.match(await errsOf(inp), re);
  assert.deepEqual(await validate({ kind: 'edit', name: 'gh', ...describeForChat(GH) }), { ok: false, errors: [MCP_ERRORS.noChange] });
});

test('no error or warning text contains TOKEN', async () => {
  for (const [inp] of ROW1) assert.equal(JSON.stringify(await validate(inp)).includes(TOKEN), false);
  for (const kind of ['edit', 'remove']) {
    const r = await validate({ kind, name: TOKEN });
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /no MCP server "••••"/);
    assert.equal(JSON.stringify(r).includes(TOKEN), false);
  }
  const f = await validate({ kind: 'edit', name: 'gh', ...describeForChat(GH), env: { GITHUB_TOKEN: { field: TOKEN } } });
  assert.equal(f.ok, false);
  assert.match(f.errors.join('\n'), /field "••••" is not declared/);
  assert.equal(JSON.stringify(f).includes(TOKEN), false);
  const k = await validate({ kind: 'add', name: 'x', type: 'stdio', command: 'x', env: { [TOKEN]: 'x' } });
  assert.equal(JSON.stringify(k).includes(TOKEN), false);
  // shown: a quoted model word is one line and at most 60 characters (fail() also scrubs, so the mask is layered).
  const wordy = 'not a server '.repeat(8);
  const long = await validate({ kind: 'remove', name: wordy });
  assert.equal(long.errors[0], `no MCP server "${wordy.trim().slice(0, 60)}" — list_mcp_servers shows them`);
  const broken = await validate({ kind: 'remove', name: 'a\nb' });
  assert.equal(broken.errors[0], 'no MCP server "a b" — list_mcp_servers shows them');
  const n = await validate({ kind: 'add', name: TOKEN, type: 'stdio', command: 'x' });
  assert.equal(n.ok, false);
  assert.equal(JSON.stringify(n).includes(TOKEN), false);
});

const ADD_GH = { kind: 'add', name: 'github', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: TOKEN } };

test('add with GITHUB_TOKEN=ghp_… gives an empty secret field and no ghp_ anywhere', async () => {
  const r = await validate(ADD_GH);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(JSON.stringify(r.card).includes('ghp_'), false);
  assert.deepEqual(r.card.change.def.env.GITHUB_TOKEN, { field: 'GITHUB_TOKEN' });
  assert.deepEqual(JSON.parse(JSON.stringify(r.card.change.def.fields)), [{ key: 'GITHUB_TOKEN', label: 'GITHUB_TOKEN', secret: true, required: true, oauth: false }]);
  assert.ok(r.card.warnings.some((w) => /value given for env GITHUB_TOKEN was left out/.test(w)));
});

test('${VAR} becomes an empty secret field', async () => {
  const r = await validate({ ...ADD_GH, env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(JSON.stringify(r.card.change).includes('${'), false);
  assert.ok(r.card.warnings.some((w) => /MCP_GITHUB_TOKEN/.test(w)));
});

test('{"secret": true} and Bearer header', async () => {
  const r = await validate({ kind: 'add', name: 'web', type: 'http', url: 'https://api.example.test/mcp', headers: { Authorization: 'Bearer ' + TOKEN } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.card.change.def.headers.Authorization, { field: 'Authorization', prefix: 'Bearer ' });
  assert.equal(JSON.stringify(r.card).includes(TOKEN), false);
  assert.ok(r.card.effects.some((e) => e.includes('connect to api.example.test')));
  assert.ok(r.card.effects.some((e) => e.startsWith('Not on Codex: remote')));
  const s = await validate({ kind: 'add', name: 'web2', type: 'stdio', command: 'srv', env: { DB_URL: { secret: true } } });
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.deepEqual(s.card.change.def.env.DB_URL, { field: 'DB_URL' });
  assert.equal(s.card.change.def.fields[0].secret, true);
});

test('the card shows every command, argument and env name word for word', async () => {
  const { card } = await validate(ADD_GH);
  const rows = card.changes.map((c) => [c.label, c.after]);
  for (const row of [['Command', 'npx'], ['Argument 1', '-y'], ['Argument 2', '@modelcontextprotocol/server-github']]) assert.ok(rows.some((r) => r[0] === row[0] && r[1] === row[1]), row.join());
  assert.ok(rows.some((r) => r[0] === 'env GITHUB_TOKEN' && r[1] === '{GITHUB_TOKEN: secret, filled in each set}'));
  assert.ok(card.effects[0].includes('"npx -y @modelcontextprotocol/server-github"'));
});

const EDIT_GH = { kind: 'edit', name: 'gh', ...describeForChat(GH), args: ['-y', '@modelcontextprotocol/server-github', '--read-only'] };

test('edit keeps the stored secret field and diffs rows', async () => {
  const r = await validate(EDIT_GH);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.card.change.def.fields.some((f) => f.key === 'GITHUB_TOKEN'));
  assert.deepEqual(r.card.changes, [{ op: 'add', label: 'Argument 3', after: '--read-only' }]);
  assert.equal(typeof r.card.change.expect, 'string');
  assert.ok(r.card.warnings.some((w) => /^secret GITHUB_TOKEN \(stored in General\) will now be given to the command "npx -y @modelcontextprotocol\/server-github --read-only"$/.test(w)), r.card.warnings.join('\n'));
});

test('edit dropping a secret field warns', async () => {
  const { env: _env, ...rest } = EDIT_GH;
  const r = await validate(rest);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.card.warnings.some((w) => /secret field GITHUB_TOKEN goes/.test(w)));
});

test('an edit that swaps the URL host warns about the kept secret', async () => {
  const r = await validate({ kind: 'edit', name: 'api', ...describeForChat(API), url: 'https://evil.test/mcp' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.card.changes.some((c) => c.op === 'change' && c.label === 'URL' && c.before === 'https://api.example.test/mcp' && c.after === 'https://evil.test/mcp'));
  assert.ok(r.card.warnings.includes('secret Authorization (stored in General) will now be given to evil.test'), r.card.warnings.join('\n'));
  const d = await validate({ kind: 'edit', name: 'api', ...describeForChat(API), description: 'the API' });
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(d.card.warnings.some((w) => w.startsWith('secret Authorization')), false);
});

test('an env-only edit warns about the kept secret', async () => {
  const r = await validate({ kind: 'edit', name: 'gh', ...describeForChat(GH), env: { GITHUB_TOKEN: { field: 'GITHUB_TOKEN', secret: true }, NODE_OPTIONS: '--require /tmp/x.js' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.card.changes, [{ op: 'add', label: 'env NODE_OPTIONS', after: '--require /tmp/x.js' }]);
  assert.ok(r.card.warnings.includes('secret GITHUB_TOKEN (stored in General) stays while env NODE_OPTIONS change: check them before applying'), r.card.warnings.join('\n'));
});

test('remove card', async () => {
  const r = await validate({ kind: 'remove', name: 'gh' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.card.summary, 'Remove MCP server gh');
  assert.match(r.card.effects[0], /^It leaves General\. Its values, secrets and test results go\.$/);
  assert.deepEqual(Object.keys(r.card.change).sort(), ['expect', 'name', 'serverId']);
  assert.deepEqual({ ...r.card.change, expect: typeof r.card.change.expect }, { name: 'gh', serverId: 'manual:gh', expect: 'string' });
});

test('the note cannot smuggle a secret', async () => {
  assert.deepEqual(await validate({ ...ADD_GH, env: {}, note: 'use ' + TOKEN }), { ok: false, errors: [MCP_ERRORS.cardSecret] });
});

test('cardLeaks walks values and keys', () => {
  assert.equal(cardLeaks({ a: [{ b: TOKEN }] }), true);
  assert.equal(cardLeaks({ [TOKEN]: 1 }), true);
  assert.equal(cardLeaks({ a: 'npx' }), false);
});

test('fieldKeyFor matches the Settings form', () => {
  for (const n of ['GITHUB_TOKEN', 'x-api-key', '1abc', '!!!', 'A'.repeat(40)]) assert.equal(fieldKeyFor(n), formFieldKeyFor(n), n);
  assert.equal(fieldKeyFor('GITHUB_TOKEN', ['github_token']), 'GITHUB_TOKEN_2');
});

test('describeForChat masks a secret-looking literal of a plugin definition', () => {
  assert.equal(describeForChat({ type: 'http', url: 'https://x.test/' + TOKEN, headers: {}, fields: [] }).url, '••••');
});

test('a short literal under a secret-named key is masked', () => {
  const D = { type: 'stdio', command: 'srv', args: [], env: { API_KEY: 'short-secret', LOG_LEVEL: 'debug' }, fields: [] };
  assert.deepEqual(describeForChat(D).env, { API_KEY: '••••', LOG_LEVEL: 'debug' });
  const lines = defLines(D);
  assert.ok(lines.some((l) => l.label === 'env API_KEY' && l.value === '••••'));
  assert.ok(lines.some((l) => l.label === 'env LOG_LEVEL' && l.value === 'debug'));
  const H = { type: 'http', url: 'https://x.test/mcp', headers: { Authorization: 'Bearer abc' }, fields: [] };
  assert.deepEqual(describeForChat(H).headers, { Authorization: '••••' });
  assert.ok(defLines(H).some((l) => l.label === 'header Authorization' && l.value === '••••'));
});

test('event and notice text', () => {
  const card = { summary: 'Add MCP server github (stdio)' };
  assert.equal(mcpEventPrompt({ cardId: 'card_1', state: 'applied', card, result: { detail: 'Added github.' } }), '[worca event] mcp card card_1 applied; "Add MCP server github (stdio)"; Added github.');
  assert.equal(mcpEventPrompt({ cardId: 'card_1', state: 'declined', card }), '[worca event] mcp card card_1 declined; "Add MCP server github (stdio)"');
  assert.equal(mcpEventPrompt({ cardId: 'card_1', state: 'failed', card, result: { error: 'boom' } }), '[worca event] mcp card card_1 failed: boom; "Add MCP server github (stdio)"');
  assert.equal(mcpNoticeText({ state: 'applied', card, result: { detail: 'Added github.' } }), 'Applied — Add MCP server github (stdio) · Added github.');
  assert.equal(mcpNoticeText({ state: 'declined', card }), 'Declined — Add MCP server github (stdio)');
  assert.equal(mcpNoticeText({ state: 'failed', card, result: { error: 'boom' } }), 'Could not apply — Add MCP server github (stdio): boom');
  for (const t of [mcpEventPrompt({ cardId: 'card_1', state: 'failed', card: { summary: 's' }, result: { error: 'bad token ' + TOKEN } }),
    mcpNoticeText({ state: 'failed', card: { summary: 's' }, result: { error: 'bad token ' + TOKEN } })]) {
    assert.ok(t.includes('••••'), t);
    assert.equal(t.includes(TOKEN), false);
  }
});

// A stored literal the chat masks (an `=` inside keeps the store's literal screen quiet; secretish flags it).
const V = 'Kq7Zr2Lm9Xw4Tb8Nc3Vd=Hs6Jp1Gf5Ry0Ue2Wa7Mo';
const HID = norm({ type: 'stdio', command: 'srv', args: ['--seed', V], env: { CFG: V, MODE: 'a' }, fields: [], description: '' }, 'hid');
const validateHid = createMcpChangeValidator({
  catalog: async () => [{ id: 'manual:hid', source: 'manual', name: 'hid', base: 'hid', sourceLabel: 'Manual', def: HID, inSets: [] }],
  nameTaken: async () => false,
  engines: () => ({ on: ['Claude'], off: [] }),
});

test('a remove or edit card pins a digest, never the stored literals', async () => {
  assert.equal(describeForChat(HID).env.CFG, MASK);
  const rm = await validateHid({ kind: 'remove', name: 'hid' });
  assert.equal(rm.ok, true, JSON.stringify(rm));
  assert.equal(rm.card.change.expect, defDigest(HID));
  assert.match(rm.card.change.expect, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(rm).includes(V), false);
  const ed = await validateHid({ kind: 'edit', name: 'hid', ...describeForChat(HID), description: 'x' });
  assert.equal(ed.ok, true, JSON.stringify(ed));
  assert.equal(ed.card.change.expect, defDigest(HID));
  assert.equal(JSON.stringify(ed).includes(V), false);
});

test('an edit sending a masked value back keeps the stored literal', async () => {
  const shown = describeForChat(HID);
  const r = await validateHid({ kind: 'edit', name: 'hid', ...shown, env: { ...shown.env, MODE: 'b' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.card.changes, [{ op: 'change', label: 'env MODE', before: 'a', after: 'b' }]);
  assert.equal(JSON.stringify(r).includes(V), false);
  const full = keepMasked(r.card.change.def, HID);
  assert.deepEqual(full.args, ['--seed', V]);
  assert.deepEqual(full.env, { CFG: V, MODE: 'b' });
  assert.deepEqual(await validateHid({ kind: 'edit', name: 'hid', ...shown }), { ok: false, errors: [MCP_ERRORS.noChange] });
});

test('a mask is refused where there is no hidden stored literal to keep', async () => {
  assert.match(await errsOf({ kind: 'add', name: 'x', type: 'stdio', command: 'x', args: [MASK] }), /args\[0\] is ••••/);
  assert.match(await errsOf({ kind: 'add', name: 'x', type: 'stdio', command: 'x', env: { MODE: MASK } }), /env MODE is ••••/);
  const shown = describeForChat(HID);
  const r = await validateHid({ kind: 'edit', name: 'hid', ...shown, env: { ...shown.env, MODE: MASK } });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /env MODE is ••••/);
  const moved = await validateHid({ kind: 'edit', name: 'hid', ...shown, args: [MASK, '--seed'] });
  assert.equal(moved.ok, false);
  assert.match(moved.errors.join('\n'), /args\[0\] is ••••/);
  assert.equal(keepMasked({ type: 'stdio', command: 'srv', args: [MASK], env: {} }, HID), null);
});

test('a {secret:true} header keeps only Bearer / Basic / Token as its prefix', async () => {
  const r = await validate({ kind: 'add', name: 'pre', type: 'http', url: 'https://a.example.test/mcp', headers: { Authorization: { secret: true, prefix: 'Bearer ' } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.card.change.def.headers.Authorization, { field: 'Authorization', prefix: 'Bearer ' });
  const evil = await validate({ kind: 'add', name: 'pre', type: 'http', url: 'https://a.example.test/mcp', headers: { Authorization: { secret: true, prefix: 'evil ' } } });
  assert.deepEqual(evil.card.change.def.headers.Authorization, { field: 'Authorization' });
});

test('kind "import" with no import validator is unavailable', async () => {
  const r = await validate({ kind: 'import', servers: ['cursor:user:x'] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [MCP_ERRORS.importOff]);
});
