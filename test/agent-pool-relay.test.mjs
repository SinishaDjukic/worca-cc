// test/agent-pool-relay.test.mjs
// One agent user per person (agent-pool.mjs) and the Ask Worca tool relay (mcp-stdio.mjs
// relay mode + createAskToolServer): with agents under their own users, a chat's MCP child
// only forwards JSON-RPC lines, and the worca tools answer from the server.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignPoolUser, agentPool, agentIdentityFor } from '../src/core/agent-pool.mjs';
import { createAskToolServer } from '../src/core/ask/mcp-stdio.mjs';
import { buildMcpConfig } from '../src/core/ask/spawn.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const dir = mkdtempSync(join(tmpdir(), 'worca-pool-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const ENV = {
  WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: '/data/agent-home', WORCA_AGENT_GID: '1001',
  WORCA_AGENT_POOL: 'worca-agent-01,worca-agent-02', WORCA_AGENT_HOMES: '/data/agent-homes',
};

test('pool: a free user per person, sticky, and a stable hash once everyone has one', () => {
  const users = ['a1', 'a2'];
  let r = assignPoolUser('ada@x', users, {});
  assert.deepEqual([r.user, r.shared], ['a1', false]);
  r = assignPoolUser('bob@x', users, r.assignments);
  assert.equal(r.user, 'a2');
  assert.equal(assignPoolUser('ada@x', users, r.assignments).user, 'a1', 'sticky');
  const full = assignPoolUser('cy@x', users, r.assignments);
  assert.equal(full.shared, true);
  assert.equal(full.user, assignPoolUser('cy@x', users, r.assignments).user, 'the same person always lands on the same user');
});

test('identity: each person gets their own user and HOME, stored; nobody in particular keeps the shared user', () => {
  const file = join(dir, 'agent-pool.json');
  assert.deepEqual(agentPool(ENV), { users: ['worca-agent-01', 'worca-agent-02'], homes: '/data/agent-homes' });
  const ada = agentIdentityFor('Ada@Acme.dev', ENV, { file });
  assert.deepEqual(ada, { user: 'worca-agent-01', home: '/data/agent-homes/worca-agent-01', gid: 1001, dedicated: true });
  const bob = agentIdentityFor('bob@acme.dev', ENV, { file });
  assert.equal(bob.user, 'worca-agent-02');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).people, { 'ada@acme.dev': 'worca-agent-01', 'bob@acme.dev': 'worca-agent-02' });
  assert.equal(agentIdentityFor('ada@acme.dev', ENV, { file }).user, 'worca-agent-01', 'after a restart too (read back from the file)');
  assert.deepEqual(agentIdentityFor('local', ENV, { file }), { user: 'worca-agent', home: '/data/agent-home', gid: 1001 });
  assert.deepEqual(agentIdentityFor(null, ENV, { file }).user, 'worca-agent');
  assert.equal(agentIdentityFor('ada@acme.dev', { ...ENV, WORCA_AGENT_POOL: '' }, { file }).user, 'worca-agent', 'no pool: the shared user');
  assert.equal(agentIdentityFor('ada@acme.dev', {}, { file }), null, 'no isolation: agents run as the server');
  // A third person with a pool of two shares a user: not dedicated (no Claude subscription for them).
  const cy = agentIdentityFor('cy@acme.dev', ENV, { file });
  assert.ok(['worca-agent-01', 'worca-agent-02'].includes(cy.user));
  assert.equal(cy.dedicated, false);
  assert.equal(agentIdentityFor('bob@acme.dev', ENV, { file }).dedicated, true);
});

test('relay config: the child gets the relay URL and this turn\'s token, nothing that points at worca\'s files', () => {
  const cfg = buildMcpConfig({ homeBase: '/data/worca', threadId: 'ask_1', serverPath: '/x/mcp-stdio.mjs', env: { WORCA_PROJECTS_ROOT: '/p' }, relay: { url: 'http://127.0.0.1:4317/api/ask/relay', token: 'tok' } });
  const s = cfg.mcpServers.worca;
  assert.deepEqual(s.args.slice(-4), ['--relay', 'http://127.0.0.1:4317/api/ask/relay', '--thread', 'ask_1']);
  assert.deepEqual(s.env, { WORCA_ASK_RELAY_TOKEN: 'tok', WORCA_ASK_THREAD_ID: 'ask_1' });
  assert.ok(!JSON.stringify(cfg).includes('/data/worca'));
});

test('relay: the MCP child forwards each line, in order, and prints the server\'s answers', async () => {
  // Stand-in for ui/server.mjs /api/ask/relay: the real tool server behind a token check.
  const out = [];
  const rpc = createAskToolServer({ threadId: 'ask_relaytest', write: (s) => out.push(s), log: () => {} });
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', async () => {
      if (req.headers['x-worca-relay'] !== 'turn-token') { res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"no"}'); return; }
      const { line } = JSON.parse(b);
      seen.push(JSON.parse(line).method);
      out.length = 0;
      await rpc.feed(line); await rpc.idle();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ out: [...out] }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/api/ask/relay`;
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('../src/core/ask/mcp-stdio.mjs', import.meta.url)), '--relay', url, '--thread', 'ask_relaytest'],
    { env: { PATH: process.env.PATH, WORCA_ASK_RELAY_TOKEN: 'turn-token' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
  child.stdin.end();
  const code = await new Promise((r) => child.on('close', r));
  srv.close();
  assert.equal(code, 0);
  assert.deepEqual(seen, ['initialize', 'notifications/initialized', 'tools/list']);
  const msgs = stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(msgs.map((m) => m.id), [0, 1], 'answers in order; the notification has none');
  assert.ok(msgs[1].result.tools.some((t) => t.name === 'list_runs'), 'the real worca tools answer through the relay');
});

test('relay: a refused or unreachable relay answers every request with an error instead of hanging', async () => {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('../src/core/ask/mcp-stdio.mjs', import.meta.url)), '--relay', 'http://127.0.0.1:9/api/ask/relay'],
    { env: { PATH: process.env.PATH, WORCA_ASK_RELAY_TOKEN: 'x' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' })}\n`);
  await new Promise((r) => child.on('close', r));
  const m = JSON.parse(stdout.trim());
  assert.equal(m.id, 7);
  assert.match(m.error.message, /worca is not reachable/);
});

test('relay + web access: the server-side tool server lists the web tools only when its env carries the turn\'s web access', async () => {
  const { webMcpEnv, buildAskSpawnOptions } = await import('../src/core/ask/spawn.mjs');
  const web = { enabled: true, allowedDomains: ['docs.example.com'], search: { url: 'https://s.example/?q={query}', keyVar: 'RELAY_SEARCH_KEY', keyHeader: 'X-K', keyPrefix: '' } };
  const names = async (env) => {
    const out = [];
    const rpc = createAskToolServer({ threadId: 'ask_relayweb', env, write: (s) => out.push(s), log: () => {} });
    await rpc.feed(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })); await rpc.idle();
    return JSON.parse(out.join('').trim()).result.tools.map((t) => t.name);
  };
  const on = await names({ ...process.env, ...webMcpEnv(web), RELAY_SEARCH_KEY: 'k' });
  assert.ok(['propose_web_access', 'web_fetch', 'web_search'].every((n) => on.includes(n)), on.join(','));
  assert.ok(!(await names({ ...process.env })).includes('web_fetch'), 'no WORCA_ASK_WEB: no web tools');
  // Relayed, the agent user's claude never gets the search key: the tools that need it run in the server.
  const base = { thread: {}, turn: { systemPrompt: 's', prompt: 'p', model: 'm' }, limits: {}, mcpConfigPath: '/tmp/m.json', scratchDir: '/tmp/s' };
  assert.deepEqual(buildAskSpawnOptions({ ...base, web, relayed: true }).envAllowlist, ['SSH_AUTH_SOCK']);
  assert.deepEqual(buildAskSpawnOptions({ ...base, web }).envAllowlist, ['SSH_AUTH_SOCK', 'RELAY_SEARCH_KEY']);
});
