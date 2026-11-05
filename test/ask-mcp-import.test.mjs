// test/ask-mcp-import.test.mjs — propose_mcp_change kind "import" (src/core/ask/mcp-import.mjs) over a real discovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { discoverMcpConfigs } from '../src/core/mcp/discover.mjs';
import { createMcpImportValidator, suggestName, worcaMatch, MCP_IMPORT_ERRORS } from '../src/core/ask/mcp-import.mjs';
import { createMcpChangeValidator } from '../src/core/ask/mcp-proposal.mjs';
import { validateMcpDefinition } from '../src/core/mcp/definitions.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';

const SECRET = 'sk-live-123';
const home = realpathSync(mkdtempSync(join(tmpdir(), 'worca-mcp-import-')));
const cursorFile = join(home, '.cursor', 'mcp.json');
mkdirSync(dirname(cursorFile), { recursive: true });
writeFileSync(cursorFile, JSON.stringify({ mcpServers: {
  files: { command: '/opt/homebrew/bin/npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/My Documents', '--mode=read only'] },
  openai: { command: 'uvx', args: ['openai-mcp'], env: { OPENAI_API_KEY: SECRET, LOG_LEVEL: 'debug' } },
  github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } },
  docs: { url: 'https://docs.example.test/mcp', headers: { Authorization: 'Bearer ${env:DOCS_TOKEN}' } },
  'My Search': { command: 'search-mcp' },
  leaky: { command: 'leak-mcp', args: ['--token', 'abc123'] },
  vars: { command: 'node', args: ['${workspaceFolder}/server.js'] },
  sock: { type: 'ws', url: 'wss://ws.example.test/mcp' },
  pg: { command: 'pg-mcp', args: ['--dsn', 'postgres://app:hunter2@db.test/shop'], env: { DATABASE_URL: 'postgres://app:hunter2@db.test/shop', MODE: 'ro' } },
  '文書': { command: 'doc-mcp' },
  dock: { command: 'docker', args: ['run', '-e', 'API_KEY=plain9', '--env=DB_PASSWORD=pw8', 'img'] },
  onearg: { command: 'one-mcp', args: ['--token abc124'] },
  cmdtok: { command: 'node --token hunter5' },
  upstream: { url: 'https://up.example.test/mcp', headers: { 'X-Upstream': 'Bearer hunter9' } },
} }));
const disc = await discoverMcpConfigs({ home, platform: 'linux', env: {}, projects: [] });
rmSync(home, { recursive: true, force: true });

const FROM = `Cursor · ${join('~', '.cursor', 'mcp.json')}`;
const norm = (raw, name) => validateMcpDefinition(raw, { name, source: 'manual' }).def;
const catalog = [
  { id: 'manual:github', source: 'manual', name: 'github', base: 'github', sourceLabel: 'Manual', inSets: [],
    def: norm({ type: 'stdio', command: 'npx', args: [], env: {}, fields: [], description: '' }, 'github') },
  { id: 'manual:docs', source: 'manual', name: 'docs', base: 'docs', sourceLabel: 'Manual', inSets: [],
    def: norm({ type: 'http', url: 'https://other.example.test/mcp', headers: {}, fields: [], description: '' }, 'docs') },
];
const calls = [];
const registry = { catalog: async () => catalog, nameTaken: async (n) => catalog.some((e) => e.name === n), engines: () => ({ on: ['Claude'], off: [] }) };
const validate = createMcpChangeValidator({ ...registry,
  importChange: createMcpImportValidator({ ...registry, discover: async (o) => { calls.push(o); return disc; } }) });
const idOf = (name) => disc.servers.find((s) => s.name === name).id;

test("an imported stdio server's card lists its command and every argument verbatim", async () => {
  const r = await validate({ kind: 'import', servers: [idOf('files')] }, { pin: { projectKey: 'shop' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.card.type, 'mcp');
  assert.equal(r.card.kind, 'import');
  assert.equal(r.card.summary, 'Import MCP server: files');
  assert.deepEqual(r.card.changes.filter((c) => c.label.startsWith('files · ')).map((c) => [c.label, c.after]), [
    ['files · From', FROM],
    ['files · Type', 'stdio'],
    ['files · Command', '/opt/homebrew/bin/npx'],
    ['files · Argument 1', '-y'],
    ['files · Argument 2', '@modelcontextprotocol/server-filesystem'],
    ['files · Argument 3', '/Users/me/My Documents'],
    ['files · Argument 4', '--mode=read only'],
  ]);
  assert.deepEqual(r.card.change.servers[0].def.args, ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/My Documents', '--mode=read only']);
  assert.deepEqual(calls.at(-1), { pin: { projectKey: 'shop' } });
});

test('sk-live-123 is never in the import card; OPENAI_API_KEY becomes an empty secret field, LOG_LEVEL stays text', async () => {
  const r = await validate({ kind: 'import', servers: [idOf('openai')] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(JSON.stringify(r).includes(SECRET), false);
  const def = r.card.change.servers[0].def;
  // validateMcpDefinition builds env with Object.create(null): spread it before a strict deepEqual.
  assert.deepEqual({ ...def.env }, { OPENAI_API_KEY: { field: 'OPENAI_API_KEY' }, LOG_LEVEL: 'debug' });
  assert.deepEqual(def.fields.map((f) => [f.key, f.secret, f.required]), [['OPENAI_API_KEY', true, true]]);
  assert.ok(r.card.warnings.some((w) => w.startsWith('openai: OPENAI_API_KEY is an empty secret field')));
});

test('a server whose name and command are already in mcp/servers.json is listed under alreadyPresent and gets no add', async () => {
  const only = await validate({ kind: 'import', servers: [idOf('github')] });
  assert.deepEqual(only, { ok: false, errors: [MCP_IMPORT_ERRORS.nothing], alreadyPresent: [{ id: idOf('github'), name: 'github', from: FROM }], skipped: [] });
  const mixed = await validate({ kind: 'import', servers: [idOf('github'), idOf('files')] });
  assert.equal(mixed.ok, true);
  assert.deepEqual(mixed.alreadyPresent.map((p) => p.name), ['github']);
  assert.deepEqual(mixed.card.alreadyPresent.map((p) => p.name), ['github']);
  assert.deepEqual(mixed.card.change.servers.map((s) => s.name), ['files']);
  assert.equal(mixed.card.changes.some((c) => c.label.startsWith('github · ')), false);
});

test('a taken name with another URL needs "as"; the secret header keeps its Bearer prefix', async () => {
  const taken = await validate({ kind: 'import', servers: [idOf('docs')] });
  assert.equal(taken.ok, false);
  assert.match(taken.errors[0], /the name "docs" is taken.*"as"/);
  const r = await validate({ kind: 'import', servers: [{ id: idOf('docs'), as: 'docs-2' }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const def = r.card.change.servers[0].def;
  assert.deepEqual([def.type, def.url, def.headers.Authorization], ['http', 'https://docs.example.test/mcp', { field: 'Authorization', prefix: 'Bearer ' }]);
  assert.ok(r.card.warnings.some((w) => /DOCS_TOKEN: worca passes only MCP_ variables/.test(w)));
});

test('names: a suggested worca name, and "as" for a name none can be made from', async () => {
  const s = await validate({ kind: 'import', servers: [idOf('My Search')] });
  assert.equal(s.ok, true);
  assert.equal(s.card.change.servers[0].name, 'my-search');
  const bad = await validate({ kind: 'import', servers: [idOf('文書')] });
  assert.match(bad.errors[0], /is not a worca name/);
  const ok = await validate({ kind: 'import', servers: [{ id: idOf('文書'), as: 'docs-jp' }] });
  assert.equal(ok.ok, true);
  assert.deepEqual([suggestName('GitHub_MCP'), suggestName('9lives'), suggestName('worca'), suggestName('')], ['github-mcp', 'lives', '', '']);
});

test('servers that cannot be imported are skipped with a reason; the rest still import; secrets stay out', async () => {
  for (const [n, re] of [['leaky', /argument 2 looks like a secret/], ['vars', /argument 1 uses \$\{…\}/], ['sock', /transport ws is not one worca has/], ['pg', /argument 2 looks like a secret/], ['dock', /argument 3 looks like a secret/]]) {
    const r = await validate({ kind: 'import', servers: [idOf(n)] });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, [MCP_IMPORT_ERRORS.nothing]);
    assert.match(r.skipped[0].reasons.join('\n'), re);
  }
  const mixed = await validate({ kind: 'import', servers: [idOf('leaky'), idOf('files')] });
  assert.equal(mixed.ok, true);
  assert.ok(mixed.card.warnings.some((w) => w.startsWith(`Not imported: leaky (${FROM}) — argument 2 looks like a secret`)));
  assert.equal(JSON.stringify(mixed).includes('abc123'), false);
  assert.equal(JSON.stringify(await validate({ kind: 'import', servers: [idOf('pg')] })).includes('hunter2'), false);
  assert.equal(/plain9|pw8/.test(JSON.stringify(await validate({ kind: 'import', servers: [idOf('dock'), idOf('files')] }))), false);
});

test('bad picks fail the call: none, more than 10, an unknown id, two picks with one name; no importChange → unavailable', async () => {
  assert.deepEqual((await validate({ kind: 'import', servers: [] })).errors, [MCP_IMPORT_ERRORS.picks]);
  assert.deepEqual((await validate({ kind: 'import', servers: Array(11).fill(idOf('files')) })).errors, [MCP_IMPORT_ERRORS.picks]);
  assert.match((await validate({ kind: 'import', servers: ['cursor:user:nope'] })).errors[0], /no discovered server "cursor:user:nope"/);
  assert.match((await validate({ kind: 'import', servers: [idOf('files'), { id: idOf('openai'), as: 'files' }] })).errors[0], /two picks would both be named "files"/);
  const bare = createMcpChangeValidator(registry);
  assert.deepEqual(await bare({ kind: 'import', servers: ['x'] }), { ok: false, errors: ['importing from other tools is unavailable here'] });
});

test('worcaMatch: same name and same URL is present; same name, other command is not', () => {
  const docs = disc.servers.find((s) => s.name === 'docs');
  assert.equal(worcaMatch(docs, ['docs'], catalog), null);
  assert.equal(worcaMatch({ ...docs, url: 'https://other.example.test/mcp' }, ['docs'], catalog)?.id, 'manual:docs');
  assert.equal(worcaMatch({ type: 'stdio', command: 'npx2' }, ['github'], catalog), null);
});

test('the tool table passes the chat pin to discover_mcp_servers and propose_mcp_change', async () => {
  const seen = [];
  const t = createAskTools({ limits: ASK_LIMITS, redact: (x) => x, pinnedScope: () => ({ projectKey: 'shop' }), mcpServers: {
    list: async () => ({ servers: [] }),
    discover: async (o) => { seen.push(['discover', o]); return { servers: [], files: [], howTo: '' }; },
    validateChange: async (inp, o) => { seen.push(['validate', o]); return { ok: false, errors: ['x'] }; },
  } });
  await t.call('discover_mcp_servers', {});
  await t.call('propose_mcp_change', { kind: 'import', servers: ['cursor:user:x'] });
  assert.deepEqual(seen, [['discover', { pin: { projectKey: 'shop' } }], ['validate', { pin: { projectKey: 'shop' } }]]);
});

test('one-argument secret flags and command credentials are skipped; an auth value under a plain header becomes a secret field', async () => {
  for (const [n, re] of [['onearg', /argument 1 looks like a secret/], ['cmdtok', /its command looks like it holds a secret/]]) {
    const r = await validate({ kind: 'import', servers: [idOf(n)] });
    assert.equal(r.ok, false);
    assert.match(r.skipped[0].reasons.join('\n'), re);
    assert.equal(/abc124|hunter5/.test(JSON.stringify(r)), false);
  }
  const r = await validate({ kind: 'import', servers: [idOf('upstream')] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.card.change.servers[0].def.headers['X-Upstream'], { field: 'X_Upstream', prefix: 'Bearer ' });
  assert.equal(JSON.stringify(r).includes('hunter9'), false);
});
