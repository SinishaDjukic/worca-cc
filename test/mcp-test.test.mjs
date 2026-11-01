// test/mcp-test.test.mjs — Test (spec §7.3): a fixture stdio server through the launcher, a fixture
// HTTP server (header expansion, 401 ⇒ "token rejected"), redaction, the 2-minute timeout and the tree
// kill, agent isolation, refusals, background re-tests, the SDK pin.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { testMembership, retestInBackground, probe, killProbe, materializeForTest, TEST_TIMEOUT_MS } from '../src/core/mcp/test.mjs';
import { createSet, addManualServer, putMember as storePut, readMcpStore, mcpDir } from '../src/core/mcp/store.mjs';
import { getSetView } from '../src/core/mcp/views.mjs';
import { withBillTo } from '../src/core/billing.mjs';
import { copyName, secretEnvName } from '../src/core/mcp/identity.mjs';
import { checkRows } from './helpers/rows.mjs';

// P1 putMember takes the server's definition; these memberships are all of manual servers.
const putMember = async (setId, serverId, patch) => storePut(setId, serverId, patch, { def: (await readMcpStore()).manual[serverId.slice(7)] });

useTempHome(after);
const FIXTURE = fileURLToPath(new URL('./fixtures/mcp/stdio-server.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'mcp-test-'));
const fakeHome = mkdtempSync(join(tmpdir(), 'mcp-test-home-'));
after(() => { for (const d of [scratch, fakeHome]) rmSync(d, { recursive: true, force: true }); });
const SECRET = 'fixture-secret-7f3a9c';
const def = (mode, extra = []) => ({
  type: 'stdio', command: process.execPath, args: [FIXTURE, mode, ...extra],
  env: { FIXTURE_TOKEN: { field: 'token' } },
  fields: [{ key: 'token', label: 'API token', secret: true, required: true }], description: `fixture ${mode}`,
});
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms = 10000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 50))) { const v = await fn(); if (v) return v; }
  throw new Error('timed out');
};

let setId;
before(async () => {
  process.env.HOME = fakeHome;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-must-not-leak';
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-must-not-leak';
  process.env.GITHUB_TOKEN = 'ghp-must-not-leak';
  ({ id: setId } = await createSet('Fixtures'));
});

test('stdio: tools listed through the launcher, result stored, the child sees only the keep-list and its own env', async () => {
  const envFile = join(scratch, 'env.json');
  await addManualServer('fx-ok', def('ok', [envFile]));
  await putMember(setId, 'manual:fx-ok', { enabled: true, values: {}, secrets: { token: SECRET } });
  const r = await testMembership(setId, 'manual:fx-ok');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.tools, ['search_issues', 'get_issue']);
  assert.match(r.fingerprint, /^[0-9a-f]{16}$/);
  const stored = (await readMcpStore()).tests[`${setId}|manual:fx-ok`];
  assert.deepEqual({ ...stored }, r);
  const env = JSON.parse(readFileSync(envFile, 'utf8'));
  assert.equal(env.FIXTURE_TOKEN, SECRET, 'the declared env reaches the server, expanded');
  for (const k of Object.keys(env)) assert.doesNotMatch(k, /^(ANTHROPIC_|CLAUDE_|GITHUB_|MCPSECRET_|MCPCHILD_)/i, k);
  assert.equal(existsSync(join(process.env.HOME, '.claude.json')), false, 'Test never writes ~/.claude.json');
  for (const d of [process.env.HOME, process.cwd()]) assert.equal(existsSync(join(d, '.mcp.json')), false, 'Test writes no .mcp.json');
});

test('two Tests of one membership at once share a single probe', async () => {
  const [a, b] = await Promise.all([testMembership(setId, 'manual:fx-ok'), testMembership(setId, 'manual:fx-ok')]);
  assert.equal(a, b);
  assert.equal(a.ok, true, a.error);
});

test('a server that dies at once reports its last stderr line', async () => {
  await addManualServer('fx-dead', { type: 'stdio', command: '/nonexistent/mcp-server', args: [], env: {}, fields: [], description: 'dead' });
  await putMember(setId, 'manual:fx-dead', { enabled: true });
  const r = await testMembership(setId, 'manual:fx-dead');
  assert.equal(r.ok, false);
  assert.match(r.error, / — \S/, 'the error carries the launcher\'s stderr line');
});

test('the env handed to the launcher is the keep-list plus MCPCHILD_* entries, refs expanded single-pass', async () => {
  const seen = [];
  const fake = (file, args, opts) => {
    seen.push({ file, args, opts });
    const c = new EventEmitter();
    Object.assign(c, { pid: 424242, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    return c;
  };
  await assert.rejects(probe({ command: process.execPath, args: ['launch.mjs', '--', 'x'], env: { MCPCHILD_FIXTURE_TOKEN: SECRET } },
    { spawnImpl: fake, timeoutMs: 50, kill: () => {} }), /no answer within/);
  const env = seen[0].opts.env;
  assert.equal(env.MCPCHILD_FIXTURE_TOKEN, SECRET);
  for (const k of Object.keys(env)) assert.doesNotMatch(k, /^(ANTHROPIC_|CLAUDE_|GITHUB_)/, k);
  assert.equal(seen[0].opts.detached, process.platform !== 'win32');
});

test('error text is redacted before it is returned or stored', async () => {
  await addManualServer('fx-leak', def('leak'));
  await putMember(setId, 'manual:fx-leak', { enabled: true, secrets: { token: SECRET } });
  const r = await testMembership(setId, 'manual:fx-leak');
  assert.equal(r.ok, false);
  assert.match(r.error, /bad token \[redacted\]/);
  assert.equal(readFileSync(join(mcpDir(), 'tests.json'), 'utf8').includes(SECRET), false);
});

test('a hanging server is killed with its whole tree when the timeout fires; the timeout is 2 minutes', async () => {
  assert.equal(TEST_TIMEOUT_MS, 120000);
  const pidFile = join(scratch, 'pids');
  await assert.rejects(probe({ command: process.execPath, args: [FIXTURE, 'hang', pidFile], env: {} }, { timeoutMs: 700 }), /no answer within/);
  const [pid, gc] = readFileSync(pidFile, 'utf8').split(' ').map(Number);
  try { await until(() => !alive(pid) && !alive(gc), 3000); }
  // Only a still-live pid: once seen dead it may already belong to an unrelated process.
  finally { for (const p of [pid, gc]) if (alive(p)) try { process.kill(p, 'SIGKILL'); } catch { /* dead, as it should be */ } }
});

test('http: headers carry the expanded secret; a 401 or a 403 reads "token rejected"', async () => {
  const srv = http.createServer((req, res) => {
    if (req.headers.authorization === 'Bearer forbidden-token-1') { res.writeHead(403).end('no'); return; }
    if (req.headers.authorization !== `Bearer ${SECRET}`) { res.writeHead(401).end('no'); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const msg = JSON.parse(body);
      if (msg.id === undefined) { res.writeHead(202).end(); return; }
      const result = msg.method === 'initialize'
        ? { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'h', version: '1' } }
        : { tools: [{ name: 'search', inputSchema: { type: 'object' } }] };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/mcp`;
  try {
    await addManualServer('fx-http', { type: 'http', url, headers: { Authorization: { field: 'token', prefix: 'Bearer ' } },
      fields: [{ key: 'token', label: 'Token', secret: true, oauth: true, required: true }], description: 'http fixture' });
    await putMember(setId, 'manual:fx-http', { enabled: true, secrets: { token: SECRET } });
    let r = await testMembership(setId, 'manual:fx-http');
    assert.deepEqual([r.ok, r.tools], [true, ['search']], r.error);
    await putMember(setId, 'manual:fx-http', { secrets: { token: 'wrong-token-123' } });
    r = await testMembership(setId, 'manual:fx-http');
    assert.deepEqual([r.ok, r.error], [false, 'token rejected']);
    await putMember(setId, 'manual:fx-http', { secrets: { token: 'forbidden-token-1' } });
    r = await testMembership(setId, 'manual:fx-http');
    assert.deepEqual([r.ok, r.error], [false, 'token rejected'], 'a 403 too');
  } finally { await new Promise((r) => srv.close(r)); }
});

test('refusals: plugin disabled, $env outside MCP_*, a missing required field ("fill in <label>")', async () => {
  const snapshot = await readMcpStore();
  const entry = { id: 'plugin:acme/fx', source: 'plugin', plugin: 'acme', name: 'fx', def: def('ok'), dir: '/p', code: 'abc1234',
    pluginEnabled: false, base: 'fx', provisional: false };
  snapshot.sets.general = { name: 'General', members: [{ server: 'plugin:acme/fx', enabled: true, values: {} }] };
  const ctx = { snapshot, catalog: [entry], teams: [], env: {}, platform: 'linux', execPath: '/n', worcaRoot: ROOT };
  assert.throws(() => materializeForTest(ctx, 'general', 'plugin:acme/fx'), { status: 409, message: 'plugin disabled' });
  entry.pluginEnabled = true;
  assert.throws(() => materializeForTest(ctx, 'general', 'plugin:acme/fx'), { status: 400, message: 'fill in API token' });
  snapshot.secrets.general = { 'plugin:acme/fx': { token: { value: { $env: 'GITHUB_TOKEN' }, updatedAt: 'x' } } };
  assert.throws(() => materializeForTest(ctx, 'general', 'plugin:acme/fx'), { status: 409, message: '$env variable GITHUB_TOKEN is not an MCP_* name' });
  snapshot.secrets.general['plugin:acme/fx'].token.value = { $env: 'MCP_FX_UNSET' };
  assert.throws(() => materializeForTest(ctx, 'general', 'plugin:acme/fx'), { status: 400, message: 'fill in API token' }, 'an unset $env is a missing value');
  assert.throws(() => materializeForTest(ctx, 'general', 'manual:none'), { status: 404 });
  snapshot.sets.general.members.push({ server: 'manual:gone', enabled: true, values: {} });
  assert.throws(() => materializeForTest(ctx, 'general', 'manual:gone'), { status: 409, message: 'the server is no longer installed' });
  assert.throws(() => materializeForTest(ctx, 'nope', 'plugin:acme/fx'), { status: 404 });
  snapshot.sets.general.members[0].enabled = false;
  snapshot.secrets.general['plugin:acme/fx'].token.value = 'tok-12345678';
  assert.equal(materializeForTest(ctx, 'general', 'plugin:acme/fx').entry.args[2], 'fx', 'a switched-off membership still tests');
  const T = 'team-acme-platform-9333';
  ctx.catalog.push({ ...entry, id: 'plugin:acme/fy', name: 'fy', base: 'fy' });
  ctx.teams = [{ home: 'acme/platform', required: [{ plugin: 'acme', server: 'fx' }, { plugin: 'acme', server: 'fy' }] }];
  snapshot.teams = { 'acme/platform': { id: T, slug: 'team-platfor', name: 'Team · acme/platform', members: {
    'plugin:acme/fy': { enabled: true, values: {}, seeded: {}, consent: 'h1' } } } };
  snapshot.secrets[T] = { 'plugin:acme/fx': { token: { value: 'tok-team-12345678', updatedAt: 'x' } },
    'plugin:acme/fy': { token: { value: 'tok-fy-87654321', updatedAt: 'x' } } };
  assert.throws(() => materializeForTest(ctx, T, 'plugin:acme/fx'), { status: 409, message: 'turn it on from the team checklist' });
  snapshot.teams['acme/platform'].members['plugin:acme/fx'] = { enabled: false, values: {}, seeded: {}, consent: 'h1' };
  assert.deepEqual(materializeForTest(ctx, T, 'plugin:acme/fx').secretValues, ['tok-team-12345678'],
    'a consented Team member tests even while switched off, with only its own secrets');
});

test('a Test finishing after an edit keeps the edit and is stale against it; the Save\'s own Test runs after it', async () => {
  // The fixture answers initialize after 800 ms: an edit at 200 ms that takes < 600 ms lands while the probe connects.
  await addManualServer('fx-slow', { ...def('slow', ['800']), fields: [...def('slow').fields, { key: 'org', label: 'Org' }], env: { FIXTURE_TOKEN: { field: 'token' }, ORG: { field: 'org' } } });
  await putMember(setId, 'manual:fx-slow', { enabled: true, values: { org: 'a' }, secrets: { token: SECRET } });
  const t = testMembership(setId, 'manual:fx-slow');
  await new Promise((r) => setTimeout(r, 200));   // the probe is connecting now (initialize is answered after 800 ms)
  const t0 = Date.now();
  await putMember(setId, 'manual:fx-slow', { values: { org: 'b' } });
  assert.ok(Date.now() - t0 < 600, 'the edit did not wait for the probe: no lock is held while connecting');
  retestInBackground([`${setId}|manual:fx-slow`]);   // what the members PUT does after a Save
  const r = await t;
  assert.equal(r.ok, true, r.error);
  const snap = await readMcpStore();
  assert.equal(snap.sets[setId].members.find((m) => m.server === 'manual:fx-slow').values.org, 'b', 'the edit is kept');
  const card = async () => (await getSetView(setId)).members.find((x) => x.serverId === 'manual:fx-slow');
  assert.equal((await card()).test.stale, true, 'the fingerprint was taken when the Test started');
  await until(async () => (await card()).test.at !== r.at);
  assert.equal((await card()).test.stale, false, 'the Save\'s Test ran after the one in flight');
});

test('a Test clicked after a Save while a probe runs answers with the Save\'s run, not the older one', async () => {
  const t1 = testMembership(setId, 'manual:fx-slow');
  await new Promise((r) => setTimeout(r, 200));
  await putMember(setId, 'manual:fx-slow', { values: { org: 'c' } });
  retestInBackground([`${setId}|manual:fx-slow`]);   // the members PUT
  const t2 = testMembership(setId, 'manual:fx-slow');  // then the Test button
  assert.notEqual(t2, t1);
  const [r1, r2] = await Promise.all([t1, t2]);
  assert.ok(r2.at > r1.at, 'it started after the first ended');
  assert.equal((await getSetView(setId)).members.find((x) => x.serverId === 'manual:fx-slow').test.stale, false);
});

test('agent isolation: the probe runs through agentSpawn (sudo) and the group dies through killAgentGroup', async () => {
  const agent = { user: 'worca-agent', home: '/home/worca-agent', gid: 1001 };
  const spawned = [];
  const killed = [];
  const fake = (file, args, opts) => {
    spawned.push({ file, args, opts });
    const c = new EventEmitter();
    Object.assign(c, { pid: 31337, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    return c;
  };
  await assert.rejects(probe({ command: process.execPath, args: ['launch.mjs'], env: {} }, {
    platform: 'linux', agent, spawnImpl: fake, timeoutMs: 50,
    kill: (child, o) => killProbe(child, { ...o, kill: () => {}, killGroup: (pid, id) => killed.push([pid, id]) }),
  }), /no answer within/);
  assert.equal(spawned[0].file, 'sudo');
  assert.deepEqual(spawned[0].args.slice(0, 6), ['-n', '-E', '-u', 'worca-agent', '--', process.execPath]);
  assert.equal(spawned[0].opts.env.HOME, '/home/worca-agent');
  assert.deepEqual(killed, [[31337, agent]]);
});

test('a server flooding stdout with no newline fails its Test; the worca process lives on', { timeout: 30000 }, async () => {
  await assert.rejects(probe({ command: process.execPath, args: [FIXTURE, 'flood'], env: {} }, { timeoutMs: 15000 }),
    / — ReadBuffer exceeded maximum size of 10485760 bytes$/);
});

test('a spawn that fails (no sudo on PATH, EMFILE) fails its Test with the spawn error; the worca process lives on', async () => {
  const failing = (file, args, opts) => spawn(join(scratch, 'no-such-binary'), args, opts);
  await assert.rejects(probe({ command: process.execPath, args: ['x'], env: {} }, { spawnImpl: failing, timeoutMs: 5000 }),
    / — spawn \S*no-such-binary ENOENT$/);
});

test('stderr is redacted before its last 2000 characters are cut: no piece of a secret survives the cut', async () => {
  await addManualServer('fx-noisy', def('noisy'));
  await putMember(setId, 'manual:fx-noisy', { enabled: true, secrets: { token: SECRET } });
  const r = await testMembership(setId, 'manual:fx-noisy');
  assert.equal(r.ok, false);
  assert.match(r.error, /redacted\]m{1990}$/);
  assert.equal(r.error.includes(SECRET.slice(-6)), false);
});

test('a Test runs as the acting person\'s agent user under isolation (agentIdentityFor(currentOwner()))', async () => {
  const seen = [];
  const probeImpl = async (_entry, opts) => { seen.push(opts.agent); return ['t']; };
  const pool = join(scratch, 'pool');   // agentIdentityFor only joins it
  const vars = { WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: '/home/worca-agent', WORCA_AGENT_GID: '1001',
    WORCA_AGENT_POOL: 'worca-agent-01,worca-agent-02', WORCA_AGENT_HOMES: pool };
  Object.assign(process.env, vars);
  try {
    const r = await withBillTo('dev@example.com', () => testMembership(setId, 'manual:fx-ok', { probeImpl }));
    assert.equal(r.ok, true, r.error);
  } finally { for (const k of Object.keys(vars)) delete process.env[k]; }
  assert.deepEqual(seen, [process.platform === 'win32' ? null
    : { user: 'worca-agent-01', home: join(pool, 'worca-agent-01'), gid: 1001, dedicated: true }]);
});

test('Test expands ${MCPSECRET_…} refs in one pass: a secret spelling another ref reaches the server as text', async () => {
  const envFile = join(scratch, 'env-two.json');
  await addManualServer('fx-two', { type: 'stdio', command: process.execPath, args: [FIXTURE, 'ok', envFile],
    env: { FIXTURE_A: { field: 'a' }, FIXTURE_B: { field: 'b' } },
    fields: [{ key: 'a', label: 'A', secret: true, required: true }, { key: 'b', label: 'B', secret: true, required: true }], description: 'two' });
  const refB = `\${${secretEnvName(copyName('fx-two', (await readMcpStore()).sets[setId].slug), 'b')}}`;
  await putMember(setId, 'manual:fx-two', { enabled: true, secrets: { a: refB, b: 'second-secret-123' } });
  const r = await testMembership(setId, 'manual:fx-two');
  assert.equal(r.ok, true, r.error);
  const env = JSON.parse(readFileSync(envFile, 'utf8'));
  assert.deepEqual([env.FIXTURE_A, env.FIXTURE_B], [refB, 'second-secret-123']);
});

test('killProbe: POSIX signals the group, Windows runs taskkill /T /F /PID; once the child has exited, no taskkill /T and no kill through sudo', async () => {
  await checkRows([
    { name: 'killProbe: POSIX signals the group, Windows runs taskkill /T /F /PID', run: () => {
      const calls = [];
      killProbe({ pid: 77 }, { platform: 'linux', kill: (pid, sig) => calls.push(['kill', pid, sig]) });
      killProbe({ pid: 78 }, { platform: 'win32', spawnSyncImpl: (cmd, args) => calls.push([cmd, ...args]) });
      assert.deepEqual(calls, [['kill', -77, 'SIGKILL'], ['taskkill', '/T', '/F', '/PID', '78']]);
    } },
    { name: 'killProbe: once the child has exited, no taskkill /T and no kill through sudo (its pid may be reused)', run: () => {
      const calls = [];
      const agent = { user: 'worca-agent', home: '/home/worca-agent', gid: 1001 };
      const posix = { platform: 'linux', agent, kill: (pid) => calls.push(['kill', pid]), killGroup: (pid) => calls.push(['group', pid]) };
      killProbe({ pid: 79, exitCode: 1, signalCode: null }, { platform: 'win32', spawnSyncImpl: (cmd) => calls.push([cmd]) });
      killProbe({ pid: 80, exitCode: null, signalCode: 'SIGKILL' }, posix);
      killProbe({ pid: 81, exitCode: null, signalCode: null }, posix);
      assert.deepEqual(calls, [['kill', -80], ['kill', -81], ['group', 81]]);
    } },
  ]);
});

test('the SDK is pinned exactly and named in THIRD_PARTY_NOTICES.md', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(ROOT, 'npm-shrinkwrap.json'), 'utf8'));
  assert.equal(pkg.dependencies['@modelcontextprotocol/sdk'], '1.32.1');
  assert.equal(lock.packages['node_modules/@modelcontextprotocol/sdk'].version, '1.32.1');
  assert.match(readFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8'), /@modelcontextprotocol\/sdk 1\.32\.1/);
});

test('a server whose tools/list cursor never ends fails its Test once it passes 10000 tools', async () => {
  await assert.rejects(probe({ command: process.execPath, args: [FIXTURE, 'cursor'], env: {} }, { timeoutMs: 1500 }),
    /tools\/list returned more than 10000 tools$/);
});

test('a Node server that throws at start reports its error line, not a stack frame or the "Node.js v…" trailer', async () => {
  await assert.rejects(probe({ command: process.execPath, args: ['-e', 'function onError() { throw new Error("DATABASE_URL is not set"); } onError();'], env: {} }, { timeoutMs: 5000 }),
    / — Error: DATABASE_URL is not set$/);
});

test('a server that closes its stdin fails its Test at once (EPIPE); the worca process lives on', async () => {
  await assert.rejects(probe({ command: process.execPath, args: [FIXTURE, 'closein'], env: {} }, { timeoutMs: 3000 }),
    /Connection closed — write EPIPE$/);
});

test('http: a 401 on the optional GET stream is not the token\'s; an unreachable server names fetch\'s cause', async () => {
  const srv = http.createServer((req, res) => {
    if (req.method === 'GET') { res.writeHead(401).end('no'); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const msg = JSON.parse(body);
      if (msg.id === undefined) { res.writeHead(202).end(); return; }
      if (msg.method !== 'initialize') { setTimeout(() => res.writeHead(500).end('list failed'), 200); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: msg.id,
        result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'h', version: '1' } } }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(probe({ type: 'http', url: `http://127.0.0.1:${srv.address().port}/mcp`, headers: {} }, { timeoutMs: 5000 }),
      (err) => !err.rejected && /list failed/.test(err.message));
  } finally { await new Promise((r) => srv.close(r)); }
  const dead = http.createServer();   // a port nothing listens on any more
  await new Promise((r) => dead.listen(0, '127.0.0.1', r));
  const { port } = dead.address();
  await new Promise((r) => dead.close(r));
  await assert.rejects(probe({ type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: {} }, { timeoutMs: 5000 }),
    /fetch failed: connect ECONNREFUSED 127\.0\.0\.1:\d+$/);
});

test('sse: tools listed over the SSE transport; a 401 on its stream reads "token rejected"', async () => {
  let stream = null;
  const srv = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${SECRET}`) { res.writeHead(401).end('no'); return; }
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write('event: endpoint\ndata: /messages\n\n');
      stream = res;
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(202).end();
      const msg = JSON.parse(body);
      if (msg.id === undefined) return;
      const result = msg.method === 'initialize'
        ? { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 's', version: '1' } }
        : { tools: [{ name: 'sse_tool', inputSchema: { type: 'object' } }] };
      stream.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/sse`;
  try {
    assert.deepEqual(await probe({ type: 'sse', url, headers: { Authorization: `Bearer ${SECRET}` } }, { timeoutMs: 2000 }), ['sse_tool']);
    await assert.rejects(probe({ type: 'sse', url, headers: { Authorization: 'Bearer wrong-token-123' } }, { timeoutMs: 2000 }),
      (err) => err.rejected === true && err.message === 'token rejected');
  } finally { srv.closeAllConnections(); await new Promise((r) => srv.close(r)); }
});

test('the probe hands the SDK its whole bound: initialize and tools/list get timeoutMs, not the SDK\'s own 60 s', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { connect, listTools } = Client.prototype;
  const seen = [];
  Client.prototype.connect = function (transport, options) { seen.push(['initialize', options?.timeout]); return connect.call(this, transport, options); };
  Client.prototype.listTools = function (params, options) { seen.push(['tools/list', options?.timeout]); return listTools.call(this, params, options); };
  try {
    assert.deepEqual(await probe({ command: process.execPath, args: [FIXTURE, 'ok'], env: {} }, { timeoutMs: 90000 }), ['search_issues', 'get_issue']);
  } finally {
    Object.assign(Client.prototype, { connect, listTools });
  }
  assert.deepEqual(seen, [['initialize', 90000], ['tools/list', 90000]]);
});
