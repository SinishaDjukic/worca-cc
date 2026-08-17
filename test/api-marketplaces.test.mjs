// test/api-marketplaces.test.mjs — /api/marketplaces* CRUD + refresh, the
// installed/provenance merges onto /api/plugins, and the retirement of
// POST /api/plugins/repo. Harness = test/api-plugins.test.mjs: import the real
// express app (=> no port bind), mount it on an ephemeral http port, sandbox
// WORCA_HOME with useTempHome. Each test builds its own REAL local git market
// repo, so everything stays offline. No WORCA_MOCK here on purpose: install's
// doctor really loads the fixture connector, whose validateConfig returns ok.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const run = promisify(execFile);

let srv, base;
const JSONH = { 'Content-Type': 'application/json' };
const get = (p) => fetch(`${base}${p}`);
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const del = (p, b) => fetch(`${base}${p}`, {
  method: 'DELETE', ...(b ? { headers: JSONH, body: JSON.stringify(b) } : {}),
});

before(async () => {
  const { app } = await import('../ui/server.mjs'); // imported => no port bind
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
});

// fixture: a marketplace repo with two depth-2 plugins
async function makeMarketRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-mktrepo-'));
  const plug = (name) => JSON.stringify({
    name, version: '0.1.0', description: `${name} fixture`,
    taskSources: [{ id: 'main', displayName: name, module: './index.mjs',
      configSchema: [{ key: 'token', type: 'text', label: 'Token', secret: true }],
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  });
  await mkdir(join(dir, 'plugins', 'aa'), { recursive: true });
  await mkdir(join(dir, 'plugins', 'bb'), { recursive: true });
  await writeFile(join(dir, 'worca-cc-marketplace.json'),
    JSON.stringify({ name: 'API Fixture Market', description: 'x', plugins: ['plugins/aa', 'plugins/bb'] }));
  await writeFile(join(dir, 'plugins', 'aa', 'worca-cc-plugin.json'), plug('aa'));
  await writeFile(join(dir, 'plugins', 'aa', 'index.mjs'), 'export default () => ({ async validateConfig(){return {ok:true};} });\n');
  await writeFile(join(dir, 'plugins', 'bb', 'worca-cc-plugin.json'), plug('bb'));
  await writeFile(join(dir, 'plugins', 'bb', 'index.mjs'), 'export default () => ({ async validateConfig(){return {ok:true};} });\n');
  const git = (...args) => run('git', ['-C', dir, ...args]);
  await run('git', ['init', '-q', '-b', 'main', dir]);
  await git('config', 'user.email', 't@t');
  await git('config', 'user.name', 't');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'fixture market');
  const { stdout } = await git('rev-parse', 'HEAD');
  return { dir, sha: stdout.trim() };
}

test('marketplace lifecycle: add -> list -> install (consent snapshot) -> remove keeps the install', async () => {
  const { dir, sha } = await makeMarketRepo();

  // add
  let r = await post('/api/marketplaces', { url: dir });
  const addBody = await r.text();
  assert.equal(r.status, 200, addBody);
  const { marketplace } = JSON.parse(addBody); // B4: read the body once (a Response body is single-use)
  assert.equal(marketplace.name, 'API Fixture Market');
  assert.equal(marketplace.lastSync.sha, sha);
  assert.equal(marketplace.plugins.length, 2);
  assert.equal(marketplace.plugins[0].inventory.taskSources[0].secrets[0], 'token');

  // duplicate -> 409
  assert.equal((await post('/api/marketplaces', { url: dir })).status, 409);
  // junk -> 400
  assert.equal((await post('/api/marketplaces', { url: join(tmpdir(), 'nope-does-not-exist') })).status, 400);

  // list with installed flags (nothing installed yet)
  r = await get('/api/marketplaces');
  let list = (await r.json()).marketplaces;
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].plugins.map((p) => p.installed), [false, false]);

  // install aa from the snapshot (depth-2 subdir!) with marketplace provenance
  r = await post('/api/plugins/install', {
    repoUrl: dir, subdir: 'plugins/aa', name: 'aa', sha, marketplace: marketplace.id,
  });
  const installBody = await r.text();
  assert.equal(r.status, 200, installBody); // B4: body read once

  // provenance in GET /api/plugins
  r = await get('/api/plugins');
  const row = (await r.json()).plugins.find((p) => p.name === 'aa');
  assert.equal(row.repo, dir);
  assert.equal(row.subdir, 'plugins/aa');
  assert.equal(row.marketplaceName, 'API Fixture Market');

  // installed flag in the marketplace listing
  list = (await (await get('/api/marketplaces')).json()).marketplaces;
  assert.deepEqual(list[0].plugins.map((p) => [p.name, p.installed]), [['aa', true], ['bb', false]]);

  // both refresh shapes route correctly AND carry installed flags (B6, E10):
  const one = await (await post(`/api/marketplaces/${marketplace.id}/refresh`, {})).json();
  assert.ok(one.marketplace && !Array.isArray(one.marketplace), ':id refresh -> single {marketplace}');
  const all = await (await post('/api/marketplaces/refresh', {})).json();
  assert.ok(Array.isArray(all.marketplaces), 'refresh-all -> {marketplaces[]}');
  assert.equal(all.marketplaces[0].plugins.find((p) => p.name === 'aa').installed, true,
    'refresh-all merges installed flags via withInstalled');

  // remove marketplace -> discovery gone, installed plugin remains fully functional
  assert.equal((await del(`/api/marketplaces/${marketplace.id}`)).status, 200);
  assert.equal((await (await get('/api/marketplaces')).json()).marketplaces.length, 0);
  r = await get('/api/plugins');
  assert.ok((await r.json()).plugins.find((p) => p.name === 'aa'), 'installed plugin survives');
  const upd = await post('/api/plugins/aa/update', {});
  assert.equal(upd.status, 200, 'update preview still works from lock provenance');

  // unknown id -> 404
  assert.equal((await del('/api/marketplaces/ghost')).status, 404);
});

test('POST /api/plugins/repo is gone', async () => {
  const r = await post('/api/plugins/repo', { url: '/tmp/x' });
  assert.equal(r.status, 404);
});

test('install rejects a junk subdir (option-injection) and drops a junk marketplace id (A4, E12)', async () => {
  const { dir, sha } = await makeMarketRepo();
  await post('/api/marketplaces', { url: dir });
  // A4: a subdir that looks like a git option -> 400, nothing installed
  assert.equal((await post('/api/plugins/install',
    { repoUrl: dir, subdir: '--output=/tmp/x', name: 'aa', sha })).status, 400);
  assert.equal((await post('/api/plugins/install',
    { repoUrl: dir, subdir: '-x', name: 'aa', sha })).status, 400,
  'dash-leading segment rejected — install guard is as strict as the manifest parser');
  // E12: a junk marketplace id fails MARKETPLACE_ID_RE and is dropped, not stamped.
  // Install `bb` (not `aa`): the lifecycle test above already installed `aa` into this
  // shared useTempHome, so re-installing `aa` would 500 ("already installed").
  assert.equal((await post('/api/plugins/install',
    { repoUrl: dir, subdir: 'plugins/bb', name: 'bb', sha, marketplace: 'a b' })).status, 200);
  const row = (await (await get('/api/plugins')).json()).plugins.find((p) => p.name === 'bb');
  assert.equal(row.marketplace, null, 'junk marketplace id not persisted');
});

test('marketplace id cannot reach Object.prototype (no pollution, 404 not 200) (A5, E11)', async () => {
  assert.equal((await post('/api/marketplaces/__proto__/refresh', {})).status, 404);
  assert.equal((await post('/api/marketplaces/constructor/refresh', {})).status, 404);
  assert.equal((await del('/api/marketplaces/__proto__')).status, 404);
  assert.equal((await del('/api/marketplaces/a b')).status, 404); // E11: ID_RE rejects the space
  assert.equal(({}).warnings, undefined, 'Object.prototype not polluted');
  // This is a PROPERTY test (outcome: no pollution + 404), not a single-layer mutation test:
  // the defense is deliberately redundant (Object.hasOwn AND downstream NOT_FOUND AND the
  // null-proto map), so no lone mutation flips a 404. The null-proto map itself is pinned
  // directly by the A5 test in test/marketplaces.test.mjs.
});
