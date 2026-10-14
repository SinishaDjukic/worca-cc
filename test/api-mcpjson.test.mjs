// test/api-mcpjson.test.mjs — GET /api/mcp/projects/:key/mcpjson and POST …/mcpjson/approve: a registered
// project's committed .mcp.json servers with their status, and Approve writing the untracked settings.local.json.
// Boots the real express app (imported ⇒ no port bind) against a sandboxed WORCA_HOME.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
process.env.GIT_CONFIG_GLOBAL = '/dev/null';   // the machine's global gitignore must not decide

let srv, base, key, repo;
const call = async (method, p, b) => {
  const r = await fetch(`${base}${p}`, { method, ...(b !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {}) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  repo = await realpath(await mkdtemp(join(tmpdir(), 'worca-api-mcpjson-')));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  await writeFile(join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'db' }, docs: { command: 'docs' } } }));
  await mkdir(join(repo, '.claude'));
  await writeFile(join(repo, '.claude', 'settings.json'), JSON.stringify({ enabledMcpjsonServers: ['docs'] }));
  const { addProject } = await import('../src/core/projects.mjs');
  key = (await addProject({ name: basename(repo), path: repo })).find((p) => p.path === repo).key;
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); });

test('GET lists the servers unapproved (a committed approval does not count); POST approve writes settings.local.json', async () => {
  let r = await call('GET', `/api/mcp/projects/${key}/mcpjson`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { servers: [{ name: 'db', status: 'unapproved' }, { name: 'docs', status: 'unapproved' }], canApprove: true, error: null });
  r = await call('POST', `/api/mcp/projects/${key}/mcpjson/approve`, { names: ['db'] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.servers, [{ name: 'db', status: 'approved' }, { name: 'docs', status: 'unapproved' }]);
  assert.deepEqual(JSON.parse(await readFile(join(repo, '.claude', 'settings.local.json'), 'utf8')), { enabledMcpjsonServers: ['db'] });
});

test('POST refuses bad names, an unknown server and an unknown project', async () => {
  assert.equal((await call('POST', `/api/mcp/projects/${key}/mcpjson/approve`, { names: [] })).status, 400);
  assert.equal((await call('POST', `/api/mcp/projects/${key}/mcpjson/approve`, { names: [1] })).status, 400);
  const r = await call('POST', `/api/mcp/projects/${key}/mcpjson/approve`, { names: ['nope'] });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'UNKNOWN_SERVER');
  assert.equal((await call('GET', '/api/mcp/projects/nosuch-1a2b3c4d/mcpjson')).status, 404);
});
