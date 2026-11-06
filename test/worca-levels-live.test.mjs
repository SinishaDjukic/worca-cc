// test/worca-levels-live.test.mjs — the live-event hooks of the worca levels (plan §3.7): a successful plugin install,
// a workspace create or membership edit, and a run added to the runs map each record a `live` patch for the
// person who did it and send ONE payload-free `worca-level-changed` poke. A failed install or a rejected workspace
// create records nothing; no response body gains worca data (I-5). In-process server, mock mode, sandboxed homes.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

const home = useTempHome(after);
const REAL_HOME = process.env.HOME;
const REAL_HEADER = process.env.WORCA_IDENTITY_HEADER;
const REAL_PROXIES = process.env.WORCA_IDENTITY_TRUSTED_PROXIES;
process.env.HOME = home;                         // worca-levels.json lives under HOME

const run = promisify(execFile);
const POKE = 'worca-level-changed';
const ADA = { 'X-Forwarded-Email': 'Ada@Example.com' };
const BOB = { 'X-Forwarded-Email': 'bob@example.com' };
const FULL_SHA = 'a'.repeat(40);

let server, base, runs, store, ws, repoDir, goodSha;
const frames = [];
const cleanup = [];
const call = async (method, p, body, headers = {}) => {
  const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, text, body: text ? JSON.parse(text) : null };
};
const pokes = () => frames.filter((f) => f.type === POKE).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Run `act`, give the broadcast a moment, return how many pokes it caused. */
async function pokesDuring(act) {
  const before = pokes();
  const out = await act();
  await sleep(150);
  return { out, pokes: pokes() - before };
}
const live = (key) => store.readPerson(key)?.live ?? null;

before(async () => {
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';
  repoDir = mkdtempSync(join(tmpdir(), 'worca-cc-live-plugin-'));
  cleanup.push(repoDir);
  writeFileSync(join(repoDir, 'worca-cc-plugin.json'), JSON.stringify({ name: 'live-src', version: '0.1.0', description: 'live fixture',
    taskSources: [{ id: 'main', displayName: 'Live', module: './connector/index.mjs', configSchema: [], inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }] }));
  mkdirSync(join(repoDir, 'connector'));
  writeFileSync(join(repoDir, 'connector', 'index.mjs'), 'export default () => ({ async validateConfig() { return { ok: true }; } });\n');
  const git = (...args) => run('git', ['-C', repoDir, ...args]);
  await run('git', ['init', '-q', '-b', 'main', repoDir]);
  await git('config', 'user.email', 't@t');
  await git('config', 'user.name', 't');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'v1');
  goodSha = (await git('rev-parse', 'HEAD')).stdout.trim();

  ({ server, runs } = await import('../ui/server.mjs'));
  store = await import('../src/core/worca-levels/store.mjs');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch { /* not JSON */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
});

after(async () => {
  for (const e of runs.values()) { try { e.orch.stop(); } catch { /* already over */ } }
  await sleep(300);
  ws?.close();
  server?.closeAllConnections?.();
  if (server) await new Promise((r) => server.close(r));
  delete process.env.WORCA_MOCK;
  process.env.HOME = REAL_HOME;
  if (REAL_HEADER === undefined) delete process.env.WORCA_IDENTITY_HEADER; else process.env.WORCA_IDENTITY_HEADER = REAL_HEADER;
  if (REAL_PROXIES === undefined) delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; else process.env.WORCA_IDENTITY_TRUSTED_PROXIES = REAL_PROXIES;
  for (const d of cleanup) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

beforeEach(() => {
  delete process.env.WORCA_IDENTITY_HEADER;
  try { unlinkSync(store.worcaLevelsFile()); } catch { /* none yet */ }
});

const noWorcaData = (text) => assert.doesNotMatch(text, /worca-?level|peakParallel|"live"\s*:/i, 'I-5: the response carries no worca data');

test('plugin install: a failed install records nothing; a successful one records the plugin id with one poke', async () => {
  const mkt = await call('POST', '/api/marketplaces', { url: repoDir });
  assert.equal(mkt.status, 200, mkt.text);
  const marketplace = mkt.body.marketplace.id;
  const body = { repoUrl: repoDir, subdir: '', name: 'live-src', sha: goodSha, marketplace };

  const bad = await pokesDuring(() => call('POST', '/api/plugins/install', { ...body, sha: FULL_SHA }));
  assert.notEqual(bad.out.status, 200);
  assert.deepEqual([bad.pokes, store.readPerson('_local')], [0, null], 'nothing recorded, nothing sent');

  const good = await pokesDuring(() => call('POST', '/api/plugins/install', body));
  assert.equal(good.out.status, 200, good.out.text);
  assert.equal(good.pokes, 1);
  assert.deepEqual(live('_local').addons, ['live-src']);
  noWorcaData(good.out.text);
});

test('workspace create: a rejected create records nothing; a created one records spaces with one poke', async () => {
  const dirs = [0, 1, 2].map((i) => { const d = mkdtempSync(join(tmpdir(), `worca-cc-live-ws${i}-`)); writeFileSync(join(d, 'n.txt'), 'n\n'); cleanup.push(d); return d; });
  for (const [i, d] of dirs.entries()) assert.equal((await call('POST', '/api/projects', { name: `Live ${i}`, path: d })).status, 200);

  const rejected = await pokesDuring(() => call('POST', '/api/workspaces', { name: 'Live WS', projectPaths: [dirs[0]] }));
  assert.equal(rejected.out.status, 400);
  assert.deepEqual([rejected.pokes, store.readPerson('_local')], [0, null]);

  const created = await pokesDuring(() => call('POST', '/api/workspaces', { name: 'Live WS', projectPaths: [dirs[0], dirs[1], dirs[2]] }));
  assert.equal(created.out.status, 201, created.out.text);
  assert.equal(created.pokes, 1);
  assert.equal(live('_local').spaces, true);
  noWorcaData(created.out.text);

  // The membership edit records too: clear the flag, then drop a member without a re-scan.
  unlinkSync(store.worcaLevelsFile());
  const id = created.out.body.workspace.id;
  const edited = await pokesDuring(() => call('POST', `/api/workspaces/${id}/members`, { remove: dirs[2], rescan: 'none' }));
  assert.equal(edited.out.status, 200, edited.out.text);
  assert.equal(edited.pokes, 1);
  assert.equal(live('_local').spaces, true);
  noWorcaData(edited.out.text);
});

test('run hook, shared install: peakParallel counts only that person\'s live runs', async () => {
  process.env.WORCA_IDENTITY_HEADER = 'X-Forwarded-Email';
  const start = (headers) => call('POST', '/api/run', { projectDir: gitDir('live'), prompt: 'x', mock: true, humanInLoop: false }, headers);

  const first = await pokesDuring(() => start(ADA));
  assert.equal(first.out.status, 200, first.out.text);
  assert.equal(first.pokes, 1);
  assert.equal(live('ada@example.com').peakParallel, 1);

  assert.equal((await start(BOB)).status, 200);
  assert.equal(live('bob@example.com').peakParallel, 1, 'ada\'s live run is not bob\'s');

  const second = await pokesDuring(() => start(ADA));
  assert.equal(second.out.status, 200, second.out.text);
  assert.equal(second.pokes, 1);
  assert.equal(live('ada@example.com').peakParallel, 2);
  assert.equal(live('bob@example.com').peakParallel, 1);
  noWorcaData(second.out.text);
});

test('run hook, single install: every live run counts', async () => {
  const start = () => call('POST', '/api/run', { projectDir: gitDir('live'), prompt: 'x', mock: true, humanInLoop: false });
  const live0 = [...runs.values()].filter((e) => e.kind === 'run' && ['running', 'starting', 'created', 'pausing'].includes(String(e.status))).length;
  const r = await start();
  assert.equal(r.status, 200, r.text);
  assert.equal(live('_local').peakParallel, live0 + 1, 'the new run plus every run already live');
});
