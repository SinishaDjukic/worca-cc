// test/api-marketplace-add-job.test.mjs — marketplace routes that tell every tab (CONTRACT §1.7, §2): plugins-changed
// after add / refresh / remove, and the opt-in add job (202 + marketplace-add-changed + GET /api/marketplaces/jobs/:id).
// The module's own server (HTTP and /ws on one port), a sandboxed home, real local git repos: offline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { marketplaceId } from '../src/core/marketplaces.mjs';
import { pluginsRoot } from '../src/core/plugins-lock.mjs';

useTempHome(after);
const run = promisify(execFile);
let srv, base, ws, T;
const frames = [];
const JSONH = { 'Content-Type': 'application/json' };
const get = (p) => fetch(`${base}${p}`);
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const bodyOf = async (pending) => { const r = await pending; return [r.status, await r.json()]; };
async function until(pred, ms = 20000) {
  const t0 = Date.now();
  while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
  assert.ok(pred(), 'timed out waiting for frames');
}
const PLUGIN_MANIFEST = (name) => JSON.stringify({ name, version: '0.1.0', description: `${name} fixture`,
  taskSources: [{ id: 'main', displayName: name, module: './index.mjs', inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }] });
const INDEX = 'export default () => ({ async validateConfig(){return {ok:true};} });\n';

before(async () => {
  const mod = await import('../ui/server.mjs'); // imported => no port bind until listen
  srv = mod.server;
  T = mod._testing;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  ws = new WebSocket(`ws://127.0.0.1:${srv.address().port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch { /* not JSON */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
});
after(async () => {
  ws?.close();
  srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
});

const created = [];   // every mkdtemp folder this file makes, removed by exact path
after(async () => { for (const d of created) await rm(d, { recursive: true, force: true }); });

// fixture: a marketplace repo with two depth-2 plugins (api-marketplaces.test's)
async function makeMarketRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-mktjob-'));
  created.push(dir);
  await mkdir(join(dir, 'plugins', 'aa'), { recursive: true });
  await mkdir(join(dir, 'plugins', 'bb'), { recursive: true });
  await writeFile(join(dir, 'worca-cc-marketplace.json'),
    JSON.stringify({ name: 'API Fixture Market', description: 'x', plugins: ['plugins/aa', 'plugins/bb'] }));
  for (const n of ['aa', 'bb']) {
    await writeFile(join(dir, 'plugins', n, 'worca-cc-plugin.json'), PLUGIN_MANIFEST(n));
    await writeFile(join(dir, 'plugins', n, 'index.mjs'), INDEX);
  }
  const git = (...args) => run('git', ['-C', dir, ...args]);
  await run('git', ['init', '-q', '-b', 'main', dir]);
  await git('config', 'user.email', 't@t');
  await git('config', 'user.name', 't');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'fixture market');
  const { stdout } = await git('rev-parse', 'HEAD');
  return { dir, sha: stdout.trim() };
}

test('add, refresh, refresh-all and remove each tell every tab: plugins-changed with the marketplace action', async () => {
  const { dir } = await makeMarketRepo();
  const mark = frames.length;
  const r = await post('/api/marketplaces', { url: dir });
  assert.equal(r.status, 200);
  const { marketplace } = await r.json();
  assert.equal((await post(`/api/marketplaces/${marketplace.id}/refresh`, {})).status, 200);
  assert.equal((await post('/api/marketplaces/refresh', {})).status, 200);
  assert.equal((await fetch(`${base}/api/marketplaces/${marketplace.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await post('/api/marketplaces', { url: join(tmpdir(), 'nope-does-not-exist') })).status, 400);
  const actions = () => frames.slice(mark).filter((f) => f.type === 'plugins-changed').map((f) => f.action);
  await until(() => actions().length >= 4);
  assert.deepEqual(actions(), ['marketplace-add', 'marketplace-refresh', 'marketplace-refresh', 'marketplace-remove'], 'none for the 400');
});

test('a plugin folder pasted as a marketplace is linked and tells every tab once: P1\'s link action, no marketplace action (SEAMS SM3)', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'worca-cc-mktjob-plugdir-'));
  created.push(folder);
  await writeFile(join(folder, 'worca-cc-plugin.json'), PLUGIN_MANIFEST('mktjob-folder-plugin'));
  await writeFile(join(folder, 'index.mjs'), INDEX);
  const mark = frames.length;
  const [status, body] = await bodyOf(post('/api/marketplaces', { url: folder }));
  assert.deepEqual([status, body.ok, body.linked, body.plugin.name], [200, true, true, 'mktjob-folder-plugin']);
  const actions = () => frames.slice(mark).filter((f) => f.type === 'plugins-changed').map((f) => f.action);
  await until(() => actions().includes('link'));
  await new Promise((r) => setTimeout(r, 100));   // a second (double) emit would land within this window
  assert.deepEqual(actions(), ['link']);
});

test('POST {url, progress:true} answers 202 at once; every phase reaches the tabs as marketplace-add-changed; GET /jobs/:id has the end (U3)', async () => {
  const { dir, sha } = await makeMarketRepo();
  const mark = frames.length;
  const r = await post('/api/marketplaces', { url: dir, progress: true });
  assert.equal(r.status, 202);
  const { jobId, job } = await r.json();
  assert.match(jobId, /^mkt_[0-9a-f]{8}$/);
  assert.deepEqual([job.id, job.url, job.state, job.phase, job.resolvedUrl, job.done, job.total, job.marketplace],
    [jobId, dir, 'running', 'resolving', dir, 0, null, null]);
  const mine = () => frames.slice(mark).filter((f) => f.type === 'marketplace-add-changed' && f.job.id === jobId).map((f) => f.job);
  await until(() => mine().some((j) => j.state !== 'running'));
  const seen = mine();
  const end = seen.at(-1);
  assert.deepEqual([...new Set(seen.map((j) => j.phase))], ['resolving', 'fetching', 'reading', 'checking', 'saved']);
  assert.deepEqual(seen.filter((j) => j.phase === 'checking').map((j) => [j.done, j.total, j.plugin]), [[0, 2, null], [1, 2, 'aa'], [2, 2, 'bb']]);
  assert.equal(seen.find((j) => j.phase === 'reading').sha, sha);
  assert.deepEqual([end.state, end.phase, end.error, end.code, end.existing, end.marketplace.name, end.marketplace.lastSync.sha, end.marketplace.lastError],
    ['done', 'saved', null, null, null, 'API Fixture Market', sha, null]);
  assert.deepEqual(end.marketplace.plugins.map((p) => [p.name, p.installed, p.notes]), [['aa', false, []], ['bb', false, []]]);
  assert.match(end.endedAt, /^\d{4}-\d\d-\d\dT/);
  await until(() => frames.slice(mark).some((f) => f.type === 'plugins-changed' && f.action === 'marketplace-add'));
  assert.deepEqual(await (await get(`/api/marketplaces/jobs/${jobId}`)).json(), { job: end });
  assert.deepEqual(await bodyOf(get('/api/marketplaces/jobs/mkt_00000000')), [404, { error: 'marketplace add job not found' }]);
  assert.ok((await (await get('/api/marketplaces')).json()).marketplaces.some((m) => m.id === end.marketplace.id));
});

test('with progress the refusals still answer at once, exactly as the blocking add, and start no job', async () => {
  const jobs = T.MARKET_JOBS.size;
  assert.deepEqual(await bodyOf(post('/api/marketplaces', { url: ' ', progress: true })), [400, { error: 'url is required' }]);
  const { dir } = await makeMarketRepo();
  const added = (await (await post('/api/marketplaces', { url: dir })).json()).marketplace;
  assert.deepEqual(await bodyOf(post('/api/marketplaces', { url: dir, progress: true })),
    [409, { error: `marketplace already added: ${dir}`, code: 'EXISTS', existing: { id: added.id, name: 'API Fixture Market' } }]);
  const folder = await mkdtemp(join(tmpdir(), 'worca-cc-mktjob-plugdir2-'));
  created.push(folder);
  await writeFile(join(folder, 'worca-cc-plugin.json'), PLUGIN_MANIFEST('mktjob-folder-plugin2'));
  await writeFile(join(folder, 'index.mjs'), INDEX);
  const [status, body] = await bodyOf(post('/api/marketplaces', { url: folder, progress: true }));
  assert.deepEqual([status, body.ok, body.linked, body.plugin.name], [200, true, true, 'mktjob-folder-plugin2']);
  const broken = await mkdtemp(join(tmpdir(), 'worca-cc-mktjob-plugdir3-'));
  created.push(broken);
  await writeFile(join(broken, 'worca-cc-plugin.json'), '{ not json');
  const [bStatus, bBody] = await bodyOf(post('/api/marketplaces', { url: broken, progress: true }));
  assert.deepEqual([bStatus, /^cannot link /.test(bBody.error)], [400, true], 'a plugin folder that cannot be linked answers 400 at once');
  assert.equal(T.MARKET_JOBS.size, jobs, 'no job for a refusal');
});

test('an unreachable source ends the job in error UNREACHABLE with a short detail, records nothing, and never echoes a URL credential', async () => {
  const mark = frames.length;
  // 127.0.0.1:9 refuses at once (no DNS): git says "unable to access '…': Failed to connect to 127.0.0.1 port 9 …".
  const r = await post('/api/marketplaces', { url: 'https://u:tok-secret-123@127.0.0.1:9/acme/market', progress: true });
  assert.equal(r.status, 202);
  const { jobId, job } = await r.json();
  assert.deepEqual([job.url, job.resolvedUrl],
    ['https://***@127.0.0.1:9/acme/market', 'https://***@127.0.0.1:9/acme/market']);
  let end;
  await until(() => (end = frames.slice(mark).map((f) => f.job).filter((j) => j?.id === jobId).at(-1))?.state === 'error');
  assert.deepEqual([end.code, end.marketplace, typeof end.error, end.error.length > 0], ['UNREACHABLE', null, 'string', true]);
  assert.equal(JSON.stringify(frames.slice(mark)).includes('tok-secret-123'), false, 'no frame carries the credential');
  assert.equal((await (await get(`/api/marketplaces/jobs/${jobId}`)).text()).includes('tok-secret-123'), false);
  assert.equal((await (await get('/api/marketplaces')).json()).marketplaces.some((m) => m.url.includes('127.0.0.1:9')), false);
});

test('a second add of a url already being added joins that job; finished jobs are kept one hour, running ones until they end', async () => {
  const { dir } = await makeMarketRepo();
  const fake = { id: 'mkt_feedbeef', url: dir, state: 'running', phase: 'fetching', resolvedUrl: dir, sha: null, done: 0, total: null,
    plugin: null, error: null, code: null, existing: null, marketplace: null, startedAt: '2026-10-20T00:00:00.000Z', endedAt: null };
  T.MARKET_JOBS.set(fake.id, { job: fake, marketId: marketplaceId(dir) });
  try {
    assert.deepEqual(await bodyOf(post('/api/marketplaces', { url: dir, progress: true })), [202, { jobId: 'mkt_feedbeef', job: fake }]);
    T.pruneMarketJobs(Date.now() + 2 * 3600_000);
    assert.equal(T.MARKET_JOBS.has('mkt_feedbeef'), true, 'a running job is never dropped');
    Object.assign(fake, { state: 'error', endedAt: '2026-10-20T00:00:00.000Z' });
    T.pruneMarketJobs(Date.parse('2026-10-20T00:59:59.999Z'));
    assert.equal(T.MARKET_JOBS.has('mkt_feedbeef'), true, 'kept within the hour');
    T.pruneMarketJobs(Date.parse('2026-10-20T01:00:00.000Z'));
    assert.equal(T.MARKET_JOBS.has('mkt_feedbeef'), false, 'gone after an hour');
    assert.equal((await get('/api/marketplaces/jobs/mkt_feedbeef')).status, 404);
  } finally {
    T.MARKET_JOBS.delete('mkt_feedbeef');
  }
});

test('only progress: true starts a job; any other value is the blocking add', async () => {
  const { dir } = await makeMarketRepo();
  const jobs = T.MARKET_JOBS.size;
  const [status, body] = await bodyOf(post('/api/marketplaces', { url: dir, progress: 'yes' }));
  assert.deepEqual([status, body.ok, body.marketplace?.name, 'jobId' in body, T.MARKET_JOBS.size], [200, true, 'API Fixture Market', false, jobs]);
});

test('an add after a job ended starts a new job: only a running job is joined', async () => {
  const url = 'https://127.0.0.1:9/acme/retry-market';
  const first = (await (await post('/api/marketplaces', { url, progress: true })).json()).jobId;
  await until(() => T.MARKET_JOBS.get(first)?.job.state === 'error');
  const [status, body] = await bodyOf(post('/api/marketplaces', { url, progress: true }));
  assert.deepEqual([status, body.jobId !== first, body.job.state], [202, true, 'running'], 'a finished job is never joined');
  await until(() => T.MARKET_JOBS.get(body.jobId)?.job.state === 'error');
});

test('finished jobs are pruned by the job GET and by a progress POST', async () => {
  const old = (id, state) => ({ id, url: '/x', state, phase: 'fetching', resolvedUrl: '/x', sha: null, done: 0, total: null,
    plugin: null, error: null, code: null, existing: null, marketplace: null, startedAt: '2020-01-01T00:00:00.000Z', endedAt: '2020-01-01T00:00:01.000Z' });
  T.MARKET_JOBS.set('mkt_0dd0dd01', { job: old('mkt_0dd0dd01', 'error'), marketId: 'nope-0dd0dd01' });
  T.MARKET_JOBS.set('mkt_0dd0dd02', { job: old('mkt_0dd0dd02', 'done'), marketId: 'nope-0dd0dd02' });
  try {
    assert.equal((await get('/api/marketplaces/jobs/mkt_0dd0dd01')).status, 404);
    assert.equal(T.MARKET_JOBS.has('mkt_0dd0dd01'), false, 'pruned by the GET');
    T.MARKET_JOBS.set('mkt_0dd0dd01', { job: old('mkt_0dd0dd01', 'error'), marketId: 'nope-0dd0dd01' });
    const r = await post('/api/marketplaces', { url: 'https://127.0.0.1:9/acme/prune-market', progress: true });
    assert.equal(r.status, 202);
    const { jobId } = await r.json();
    assert.deepEqual([T.MARKET_JOBS.has('mkt_0dd0dd01'), T.MARKET_JOBS.has('mkt_0dd0dd02')], [false, false], 'pruned by the POST');
    await until(() => T.MARKET_JOBS.get(jobId)?.job.state !== 'running');
  } finally {
    T.MARKET_JOBS.delete('mkt_0dd0dd01');
    T.MARKET_JOBS.delete('mkt_0dd0dd02');
  }
});

test('a failed job carries a short, safe error: EXISTS keeps existing, a sync failure its lastError, anything else its own code and no cache folder', () => {
  const cache = join(pluginsRoot(), '.cache', 'u-tok-secret-9-git.acme.dev-a-b-1234abcd.git');
  assert.deepEqual(T.marketJobFailure(Object.assign(new Error('marketplace already added: https://u:tok-secret-9@git.acme.dev/a/b'), { code: 'EXISTS', existing: { id: 'x', name: 'X' } })),
    { code: 'EXISTS', error: 'marketplace already added: https://***@git.acme.dev/a/b', existing: { id: 'x', name: 'X' } });
  assert.deepEqual(T.marketJobFailure(Object.assign(new Error('never synced; refresh failed: x'), { code: 'BAD_REQUEST', syncError: { message: 'HTTP 403', code: 'UNREACHABLE', at: '2026-10-20T00:00:00.000Z' } })),
    { code: 'UNREACHABLE', error: 'HTTP 403' });
  assert.deepEqual(T.marketJobFailure(Object.assign(new Error(`ENOTEMPTY: directory not empty, rmdir '${cache}'\n    at rmSync`), { code: 'ENOTEMPTY' })),
    { code: 'ENOTEMPTY', error: "ENOTEMPTY: directory not empty, rmdir '<worca cache>'" });
  assert.deepEqual(T.marketJobFailure(new Error('boom')), { code: 'ERROR', error: 'boom' });
});

test('a job reads with every key, null when it has none yet: frames and the job GET never drop one (CONTRACT §2.2)', async () => {
  T.MARKET_JOBS.set('mkt_5ca1ab1e', { job: { id: 'mkt_5ca1ab1e', state: 'running', phase: 'fetching' }, marketId: 'nope-5ca1ab1e' });
  try {
    assert.deepEqual(await bodyOf(get('/api/marketplaces/jobs/mkt_5ca1ab1e')), [200, { job: { id: 'mkt_5ca1ab1e', url: null, state: 'running',
      phase: 'fetching', resolvedUrl: null, sha: null, done: null, total: null, plugin: null, error: null, code: null, existing: null,
      marketplace: null, startedAt: null, endedAt: null } }]);
  } finally {
    T.MARKET_JOBS.delete('mkt_5ca1ab1e');
  }
});

test('a job keeps and sends at most 2 000 characters of the typed url: a long url makes no long frames', async () => {
  const mark = frames.length;
  const [status, body] = await bodyOf(post('/api/marketplaces', { url: `https://127.0.0.1:9/${'a'.repeat(50_000)}`, progress: true }));
  assert.equal(status, 202);
  assert.deepEqual([body.job.url.length, body.job.url.endsWith('…'), body.job.resolvedUrl.length], [2000, true, 2000]);
  await until(() => T.MARKET_JOBS.get(body.jobId)?.job.state !== 'running');
  const mine = frames.slice(mark).filter((f) => f.job?.id === body.jobId).map((f) => JSON.stringify(f).length);
  assert.ok(mine.length >= 3 && mine.every((n) => n < 6000), `frame sizes ${mine}`);
});
