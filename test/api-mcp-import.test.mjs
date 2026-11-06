// test/api-mcp-import.test.mjs — Connectors › MCP servers' import from other tools (docs/mcp-servers.md "From the
// Servers view"): GET /api/mcp/discover and POST /api/mcp/import over the real express app.
// Its own file: it points HOME at a discovery fixture home and flips WORCA_CONTAINER / WORCA_AGENT_*, which would
// leak into the CRUD cases of test/api-mcp.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

// Discovery reads HOME (os.homedir), and XDG_CONFIG_HOME / APPDATA / CODEX_HOME besides: without these deletes it
// reads the developer's real Codex / VS Code / Claude Desktop files, and a container test host turns homeConfigs off.
const ENV_KEYS = ['HOME', 'USERPROFILE', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'APPDATA', 'WORCA_ALLOWED_HOSTS', 'WORCA_CONTAINER',
  'WORCA_DATA_DIR', 'WORCA_ASK_NO_HOME_CONFIGS', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const home = realpathSync(mkdtempSync(join(tmpdir(), 'worca-api-mcp-import-home-')));
const projDir = realpathSync(mkdtempSync(join(tmpdir(), 'worca-api-mcp-import-proj-')));
for (const k of ENV_KEYS) delete process.env[k];
process.env.HOME = home;
process.env.USERPROFILE = home;
after(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(home, { recursive: true, force: true });
  rmSync(projDir, { recursive: true, force: true });
});

const SECRET = 'sk-live-123';
const DSN = 'postgres://app:hunter2@db.test/shop';
const LEAKS = [SECRET, 'hunter2', 'gemini-oops-text'];
const cursorFile = join(home, '.cursor', 'mcp.json');
const writeCursor = (over = {}) => {
  mkdirSync(dirname(cursorFile), { recursive: true });
  writeFileSync(cursorFile, JSON.stringify({ mcpServers: {
    openai: { command: 'uvx', args: ['openai-mcp'], env: { OPENAI_API_KEY: SECRET, LOG_LEVEL: 'debug' } },
    ghx: { command: 'npx', args: ['-y', 'ghx-mcp'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } },
    pgx: { command: 'pgx-mcp', env: { DATABASE_URL: DSN } },
    agentok: { command: 'agentok-mcp' },
    ...over,
  } }));
};
writeCursor();
mkdirSync(join(home, '.gemini'), { recursive: true });
writeFileSync(join(home, '.gemini', 'settings.json'), '{\n "mcpServers": {\n  "x": {"command": "gemini-oops-text"} "y": 1\n }\n}\n');
writeFileSync(join(projDir, '.mcp.json'), JSON.stringify({ mcpServers: { 'proj-srv': { command: 'proj-mcp', args: ['--ro'] } } }));

let srv, base, mod, project;
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, p, b, headers = {}) => {
  const r = await fetch(`${base}${p}`, { method, headers: { ...(b !== undefined ? JSONH : {}), ...headers }, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });
  const text = await r.text();
  return { status: r.status, text, body: text ? JSON.parse(text) : null };
};
const noLeak = (r) => { for (const v of LEAKS) assert.equal(r.text.includes(v), false, `${v} in ${r.text}`); };
const id = (name) => `cursor:user:${name}`;
const manualIds = async () => (await call('GET', '/api/mcp/servers')).body.servers.map((s) => s.id).filter((x) => x.startsWith('manual:')).sort();

before(async () => {
  mod = await import('../ui/server.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  project = (await addProject({ name: 'shop', path: projDir })).find((p) => p.path === projDir);
  assert.ok(project, 'the fixture project is registered');
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); });

test('1. GET /api/mcp/discover lists the home configs, masked, with per-file errors; it writes nothing', async () => {
  const before = await manualIds();
  const r = await call('GET', '/api/mcp/discover');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.homeConfigs, true);
  assert.equal(r.body.project, null);
  assert.equal(Object.hasOwn(r.body, 'howTo'), false);
  const openai = r.body.servers.find((s) => s.id === id('openai'));
  assert.equal(openai.source, join('~', '.cursor', 'mcp.json'));
  assert.deepEqual([openai.name, openai.transport, openai.command, openai.args], ['openai', 'stdio', 'uvx', ['openai-mcp']]);
  assert.deepEqual(openai.env.OPENAI_API_KEY, { value: '••••', secret: true });
  const gem = r.body.files.find((f) => f.tool === 'Gemini CLI');
  assert.equal(gem.status, 'error');
  assert.match(gem.error, /^not valid JSON \(line \d+, column \d+\)$/);
  noLeak(r);
  assert.deepEqual(await manualIds(), before);
});

test('2. ?project=<key> adds the project\'s files; a bad key is 400, an unknown one 404', async () => {
  const r = await call('GET', `/api/mcp/discover?project=${encodeURIComponent(project.key)}`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.project, { key: project.key, name: 'shop' });
  const p = r.body.servers.find((s) => s.name === 'proj-srv');
  assert.ok(p, JSON.stringify(r.body.servers.map((s) => s.id)));
  assert.equal(p.scope, 'project');
  assert.ok(r.body.servers.some((s) => s.id === id('openai')), 'home servers still listed');
  const bad = await call('GET', '/api/mcp/discover?project=BAD');
  assert.deepEqual([bad.status, bad.body.code], [400, 'BAD_PROJECT']);
  const twice = await call('GET', '/api/mcp/discover?project=a&project=b');
  assert.deepEqual([twice.status, twice.body.code], [400, 'BAD_PROJECT']);
  const none = await call('GET', '/api/mcp/discover?project=nope-12345678');
  assert.deepEqual([none.status, none.body.code], [404, 'NOT_FOUND']);
  const alive = await call('GET', '/api/mcp/discover');
  assert.equal(alive.status, 200, 'the server is still up after the refusals');
});

test('3. on a container worca the home configs are not read; the project files still are', async () => {
  process.env.WORCA_CONTAINER = '1';
  try {
    const r = await call('GET', `/api/mcp/discover?project=${encodeURIComponent(project.key)}`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.homeConfigs, false);
    assert.equal(r.body.servers.some((s) => s.scope === 'user'), false);
    assert.deepEqual(r.body.servers.map((s) => s.name), ['proj-srv']);
  } finally { delete process.env.WORCA_CONTAINER; }
});

test('4-6. preview writes nothing; apply with its digest imports; the same pick again is already present', async () => {
  const before = await manualIds();
  const pre = await call('POST', '/api/mcp/import', { servers: [{ id: id('openai') }] });
  assert.equal(pre.status, 200, pre.text);
  assert.equal(pre.body.ok, true);
  assert.match(pre.body.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(pre.body.review.names, ['openai']);
  assert.ok(pre.body.review.warnings.some((w) => /OPENAI_API_KEY is an empty secret field/.test(w)));
  assert.equal(Object.hasOwn(pre.body, 'card'), false);
  noLeak(pre);
  assert.deepEqual(await manualIds(), before);

  const done = await call('POST', '/api/mcp/import', { servers: [{ id: id('openai') }], apply: true, digest: pre.body.digest });
  assert.equal(done.status, 200, done.text);
  assert.deepEqual(done.body.names, ['openai']);
  assert.match(done.body.detail, /in no set yet/);
  noLeak(done);
  assert.deepEqual(await manualIds(), [...before, 'manual:openai'].sort());

  const again = await call('POST', '/api/mcp/import', { servers: [{ id: id('openai') }] });
  assert.deepEqual([again.status, again.body.code], [400, 'NOTHING_TO_IMPORT']);
  assert.equal(again.body.alreadyPresent[0].name, 'openai');
  assert.match(again.body.error, /nothing to import/);
  assert.deepEqual(await manualIds(), [...before, 'manual:openai'].sort());
});

test('7. a taken "as" is refused in the person\'s words; a fresh one imports under that name', async () => {
  const taken = await call('POST', '/api/mcp/import', { servers: [{ id: id('ghx'), as: 'openai' }] });
  assert.deepEqual([taken.status, taken.body.code], [400, 'IMPORT_INVALID']);
  assert.deepEqual(taken.body.errors, ['the name "openai" is taken — choose another']);
  const pre = await call('POST', '/api/mcp/import', { servers: [{ id: id('ghx'), as: ' gh-two ' }] });
  assert.equal(pre.status, 200, pre.text);
  assert.deepEqual(pre.body.review.names, ['gh-two']);
  const done = await call('POST', '/api/mcp/import', { servers: [{ id: id('ghx'), as: 'gh-two' }], apply: true, digest: pre.body.digest });
  assert.equal(done.status, 200, done.text);
  assert.ok((await manualIds()).includes('manual:gh-two'));
  const blank = await call('POST', '/api/mcp/import', { servers: [{ id: id('ghx'), as: '   ' }] });
  assert.equal(blank.status, 200, 'a blank "as" falls back to the suggested name');
  assert.deepEqual(blank.body.review.names, ['ghx']);
});

test('8. a file changed after the review: 409 IMPORT_CHANGED and nothing written', async () => {
  const pre = await call('POST', '/api/mcp/import', { servers: [{ id: id('pgx') }] });
  assert.equal(pre.status, 200, pre.text);
  const before = await manualIds();
  writeCursor({ pgx: { command: 'pgx-mcp', args: ['--replica'], env: { DATABASE_URL: DSN } } });
  try {
    const r = await call('POST', '/api/mcp/import', { servers: [{ id: id('pgx') }], apply: true, digest: pre.body.digest });
    assert.deepEqual([r.status, r.body.code], [409, 'IMPORT_CHANGED']);
    assert.match(r.body.error, /changed since the review/);
    noLeak(r);
    assert.deepEqual(await manualIds(), before);
  } finally { writeCursor(); }
});

test('9. bad bodies answer 400 before any discovery', async () => {
  const pick = { id: id('pgx') };
  for (const [body, code] of [
    [[], 'BAD_REQUEST'],
    [{ servers: [] }, 'BAD_REQUEST'],
    [{ servers: 'x' }, 'BAD_REQUEST'],
    [{ servers: Array(11).fill(pick) }, 'BAD_REQUEST'],
    [{ servers: ['cursor:user:pgx'] }, 'BAD_REQUEST'],
    [{ servers: [{ id: { toString: 0 } }] }, 'BAD_REQUEST'],
    [{ servers: [{ id: '' }] }, 'BAD_REQUEST'],
    [{ servers: [{ id: 'x'.repeat(201) }] }, 'BAD_REQUEST'],
    [{ servers: [{ id: 'x', as: 7 }] }, 'BAD_REQUEST'],
    [{ servers: [{ id: 'x', as: 'a'.repeat(41) }] }, 'BAD_REQUEST'],
    [{ servers: [pick], apply: 'yes' }, 'BAD_REQUEST'],
    [{ servers: [pick], apply: true }, 'DIGEST_REQUIRED'],
    [{ servers: [pick], apply: true, digest: 'abc' }, 'DIGEST_REQUIRED'],
    [{ servers: [pick], projectKey: 7 }, 'BAD_PROJECT'],
  ]) {
    const r = await call('POST', '/api/mcp/import', body);
    assert.deepEqual([r.status, r.body.code], [400, code], `${JSON.stringify(body).slice(0, 80)} → ${r.text}`);
  }
  const unknown = await call('POST', '/api/mcp/import', { servers: [pick], projectKey: 'nope-12345678' });
  assert.deepEqual([unknown.status, unknown.body.code], [404, 'NOT_FOUND']);
  const hash = await call('POST', '/api/mcp/import', { servers: [pick], hash: 'x' });
  assert.equal(hash.status, 400);
  assert.match(hash.body.error, /"hash" cannot be set here/);
});

// G1 answers 403 AGENT_CALLER_BLOCKED to every caller on this machine without the UI token; the token makes the caller
// a person. So the import route's own agentMayBeCaller line (D6, as on the cards route) is an equivalent mutant
// in-process: nothing here can reach it with a possible agent caller.
test('10. under agent isolation both routes need the UI token', async () => {
  const homeOs = mkdtempSync(join(tmpdir(), 'worca-api-mcp-import-agent-'));
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(homeOs, 'agent');
  try {
    const before = await (async () => { const r = await call('GET', '/api/mcp/servers', undefined, { 'x-worca-ui-token': mod._testing.uiToken() }); return r.body.servers.length; })();
    const g = await call('GET', '/api/mcp/discover');
    assert.deepEqual([g.status, g.body.code], [403, 'AGENT_CALLER_BLOCKED']);
    const p = await call('POST', '/api/mcp/import', { servers: [{ id: id('agentok') }] });
    assert.deepEqual([p.status, p.body.code], [403, 'AGENT_CALLER_BLOCKED']);
    const a = await call('POST', '/api/mcp/import', { servers: [{ id: id('agentok') }], apply: true, digest: 'f'.repeat(64) });
    assert.deepEqual([a.status, a.body.code], [403, 'AGENT_CALLER_BLOCKED']);
    const tok = { 'x-worca-ui-token': mod._testing.uiToken() };
    assert.equal((await call('GET', '/api/mcp/discover', undefined, tok)).status, 200);
    const pre = await call('POST', '/api/mcp/import', { servers: [{ id: id('agentok') }] }, tok);
    assert.equal(pre.status, 200, pre.text);
    const done = await call('POST', '/api/mcp/import', { servers: [{ id: id('agentok') }], apply: true, digest: pre.body.digest }, tok);
    assert.equal(done.status, 200, done.text);
    const after = (await call('GET', '/api/mcp/servers', undefined, tok)).body.servers.length;
    assert.equal(after, before + 1);
  } finally {
    delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
    rmSync(homeOs, { recursive: true, force: true });
  }
});
