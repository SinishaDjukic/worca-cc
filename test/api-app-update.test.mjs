// test/api-app-update.test.mjs
// The manual update endpoints (issue #841): eligibility, the shared / cross-origin / agent gates,
// version validation, the handoff record + onShutdown('update'), the preview, the version list and
// the last result. App imported (no port bind) on an ephemeral http server; no network: the version
// fetcher and the npm probe are fakes, and onShutdown is a stub, so nothing drains for real.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { appServer } from './helpers/app-server.mjs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { readUpdateRecord, writeUpdateRecord } from '../src/core/ui-update.mjs';
const HOME_DIR = useTempHome(after);
// settings.json lives under $HOME, not WORCA_HOME: sandbox it BEFORE the server import, so
// updateCheckEnabled() reads the default (true) instead of the developer's real setting.
process.env.HOME = HOME_DIR; process.env.USERPROFILE = HOME_DIR;

const DOC = { 'dist-tags': { latest: '9.1.0', rc: '9.2.0-rc.1' }, versions: { '1.13.1': {}, '9.0.0': {}, '9.1.0': {}, '9.2.0-rc.1': {} }, time: {} };
let srv; let base; let T; let port;

before(async () => {
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  T = mod._testing;
  srv = appServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port; base = `http://127.0.0.1:${port}`;
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); delete process.env.WORCA_MOCK; });

let shutdowns;
function eligibleRig() {
  shutdowns = [];
  T.setSourceBuild(false);
  T.setUpdateDeployment('local');
  T.setVersionsFetcher(async () => (await import('../src/core/update-check.mjs')).parseVersionList(DOC));
  T.setNpmProbe(() => ({ root: '/g', underRoot: true, writable: true, unwritable: [] }));
  T.setUpdateMockOverride(false);     // mock mode would refuse with reason 'mock'
  T.uiControl.token = 'a'.repeat(64);
  T.uiControl.onShutdown = (why) => shutdowns.push(why);
  process.env.WORCA_UI_SUPERVISOR = String(process.ppid);   // what a real `worca ui` parent would pass
}
afterEach(() => {
  T.setUpdateDeployment(null); T.setVersionsFetcher(null); T.setChangelogFetcher(null); T.setNpmProbe(null); T.setUpdateMockOverride(null);
  T.setSourceBuild(null);
  T.resetUpdateRequest();
  T.uiControl.token = null; T.uiControl.onShutdown = null;
  for (const k of ['WORCA_UI_SUPERVISOR', 'WORCA_IDENTITY_HEADER', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME']) delete process.env[k];
});

const post = (body, headers = {}) => fetch(`${base}/api/app/update`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
function rawPost(path, body, headers) {           // fetch drops a caller-set Origin/Host; use http.request
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } },
      (m) => { let s = ''; m.on('data', (d) => { s += d; }); m.on('end', () => res({ status: m.statusCode, body: JSON.parse(s || '{}') })); });
    r.on('error', rej); r.end(data);
  });
}

test('GET /api/app/update: eligible → canUpdate, distTags, startCommand; no network in tests', async () => {
  eligibleRig();
  const j = await (await fetch(`${base}/api/app/update`)).json();
  assert.equal(j.canUpdate, true);
  assert.equal(j.distTags.latest, '9.1.0');
  assert.equal(j.autoRestartMin, '1.14.0');
  assert.match(j.startCommand, /^worca ui/);
});

test('shared (container deployment or WORCA_IDENTITY_HEADER) → GET says shared, POST 403 UPDATE_DISABLED, nothing written', async () => {
  for (const setup of [() => T.setUpdateDeployment('container'), () => T.setUpdateDeployment('hosted'), () => { process.env.WORCA_IDENTITY_HEADER = 'X-User'; }]) {
    eligibleRig(); setup();
    const g = await (await fetch(`${base}/api/app/update`)).json();
    assert.deepEqual([g.canUpdate, g.reason], [false, 'shared']);
    const r = await post({ version: '9.1.0' });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'UPDATE_DISABLED');
    assert.deepEqual(shutdowns, []);
    T.setUpdateDeployment(null); delete process.env.WORCA_IDENTITY_HEADER;
  }
});

test('cross-origin page → 403', async () => {
  eligibleRig();
  const r = await rawPost('/api/app/update', { version: '9.1.0' }, { origin: 'http://localhost:9999' });
  assert.equal(r.status, 403);   // G10: the global Origin check refuses it before the update route's own check
  assert.deepEqual(shutdowns, []);
});

test('possible agent caller → 403 AGENT_CALLER_BLOCKED', async () => {
  eligibleRig();
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(process.env.WORCA_HOME, 'agent');
  const r = await post({ version: '9.1.0' });
  assert.deepEqual([r.status, (await r.json()).code], [403, 'AGENT_CALLER_BLOCKED']);   // G1: the global gate answers first
});

test('bad / unknown / same version → 400; not supervised → 409 with reason', async () => {
  eligibleRig();
  for (const v of ['latest', '9.9.9', '1.0.0 && x']) assert.equal((await post({ version: v })).status, 400, v);
  const same = await post({ version: T.pkgVersion });
  assert.equal((await same.json()).code, 'UPDATE_SAME_VERSION');
  for (const flag of [undefined, '1']) {            // missing, or inherited from a supervisor further up
    if (flag === undefined) delete process.env.WORCA_UI_SUPERVISOR; else process.env.WORCA_UI_SUPERVISOR = flag;
    const r = await post({ version: '9.1.0' });
    const j = await r.json();
    assert.deepEqual([r.status, j.code, j.reason], [409, 'UPDATE_UNAVAILABLE', 'not-supervised'], String(flag));
  }
  assert.deepEqual(shutdowns, []);
});

test('POST ok → 202, record written as requested, onShutdown("update"); a second POST is refused', async () => {
  eligibleRig();
  const r = await post({ version: 'v9.1.0' });
  assert.equal(r.status, 202);
  const j = await r.json();
  assert.deepEqual([j.target, j.autoRestart], ['9.1.0', true]);
  await new Promise((res) => setImmediate(res)); await new Promise((res) => setImmediate(res));
  assert.deepEqual(shutdowns, ['update']);
  const rec = readUpdateRecord();
  assert.deepEqual([rec.state, rec.to, rec.from], ['requested', '9.1.0', T.pkgVersion]);
  assert.equal((await post({ version: '9.0.0' })).status, 503);
});

test('GET /api/app/update/preview lists active runs and starts due soon; flags a pre-1.14 target', async () => {
  eligibleRig();
  const j = await (await fetch(`${base}/api/app/update/preview?version=1.13.1`)).json();
  assert.ok(Array.isArray(j.runs) && Array.isArray(j.scheduled));
  assert.equal(j.autoRestart, false);
  assert.equal(typeof j.autoResume, 'boolean');
  assert.match(j.startCommand, /^worca ui/);
  const cross = await new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path: '/api/app/update/preview?version=9.1.0', headers: { origin: 'http://localhost:9999' } },
      (m) => { m.resume(); m.on('end', () => res(m.statusCode)); }).on('error', rej);
  });
  assert.equal(cross, 403, 'run titles never answer another origin');
});

// "What changes for you": the preview carries the docs site's release records between the running
// version and the target. The feed fetcher is swapped here; by default it refuses under tests.
const feedRel = (version) => ({ version, date: '2026-11-05', sub: '', url: `https://docs.worca.dev/changelog/${version}/`, sections: [{ kicker: 'Chat', title: `New in ${version}` }] });
const FEED = ['9.2.0', '9.1.0', '9.0.0', '0.0.1'].map(feedRel);
const changesOf = async (v) => { const r = await fetch(`${base}/api/app/update/changes?version=${v}`); const body = await r.json(); return { status: r.status, body: { changes: body } }; };
const preview = changesOf;

test('changes: lists every release between the running version and the target', async () => {
  eligibleRig();
  T.setChangelogFetcher(async () => FEED);
  const { body } = await preview('9.1.0');
  assert.equal(body.changes.state, 'ok');
  assert.deepEqual(body.changes.releases.map((r) => r.version), ['9.1.0', '9.0.0']);
  assert.equal(body.changes.to, '9.1.0');
  assert.equal(body.changes.rollback, false);
  assert.deepEqual(body.changes.releases[0].sections, [{ kicker: 'Chat', title: 'New in 9.1.0' }]);
});

test('changes: the feed is down → unavailable, 200', async () => {
  eligibleRig();
  T.setChangelogFetcher(async () => { throw new Error('down'); });
  const { status, body } = await preview('9.1.0');
  assert.equal(status, 200);
  assert.equal(body.changes.state, 'unavailable');
  assert.deepEqual(body.changes.releases, []);
});

test('changes: a feed that answers 200 with a web page (captive portal) → unavailable', async () => {
  eligibleRig();
  const { fetchChangelogFeed } = await import('../src/core/update-check.mjs');
  T.setChangelogFetcher(() => fetchChangelogFeed({ fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } }) }));
  const { status, body } = await changesOf('9.1.0');
  assert.equal(status, 200);
  assert.equal(body.changes.state, 'unavailable');
});

test('the preview never waits for the feed: it answers while the feed hangs, and carries no changes', async () => {
  eligibleRig();
  let asked = 0;
  T.setChangelogFetcher(() => { asked++; return new Promise(() => {}); });
  const r = await fetch(`${base}/api/app/update/preview?version=9.1.0`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.autoRestart, true);
  assert.equal('changes' in j, false);
  assert.equal(asked, 0);
});

test('changes: a target the cached feed does not list → one fresh read, then flagged if still missing', async () => {
  eligibleRig();
  let reads = 0;
  T.setChangelogFetcher(async () => { reads++; return reads === 1 ? FEED.filter((r) => r.version !== '9.2.0') : FEED; });
  assert.deepEqual((await changesOf('9.1.0')).body.changes.releases.map((r) => r.version), ['9.1.0', '9.0.0']);
  assert.equal(reads, 1);
  const fresh = (await changesOf('9.2.0')).body.changes;      // published after the feed was cached
  assert.equal(reads, 2);
  assert.deepEqual({ versions: fresh.releases.map((r) => r.version), targetListed: fresh.targetListed }, { versions: ['9.2.0', '9.1.0', '9.0.0'], targetListed: true });
  const missing = (await changesOf('9.3.0')).body.changes;    // the docs site lags the registry
  assert.equal(missing.targetListed, false);
  assert.equal(missing.state, 'ok');
  assert.equal(reads, 2, 'at most one forced read per few minutes');
});

test('changes: a bad version → 400', async () => {
  eligibleRig();
  assert.equal((await fetch(`${base}/api/app/update/changes?version=nope`)).status, 400);
});

test('changes: without a swapped fetcher nothing is fetched under tests or mock (off, not "could not be loaded")', async () => {
  eligibleRig();
  assert.equal((await preview('9.1.0')).body.changes.state, 'off');
});

test('changes: a release-candidate target the feed does not list → no forced read (rc pages rarely come)', async () => {
  eligibleRig();
  let reads = 0;
  T.setChangelogFetcher(async () => { reads++; return FEED; });
  const c = (await changesOf('9.3.0-rc.1')).body.changes;
  assert.equal(reads, 1);
  assert.deepEqual({ targetListed: c.targetListed, prerelease: c.prerelease }, { targetListed: false, prerelease: true });
});

test('changes: an older target is a rollback with nothing to list', async () => {
  eligibleRig();
  T.setChangelogFetcher(async () => FEED);
  const { body } = await preview('0.0.1');
  assert.deepEqual({ state: body.changes.state, rollback: body.changes.rollback, releases: body.changes.releases }, { state: 'none', rollback: true, releases: [] });
});

test('changes: update checks switched off → no feed request', async () => {
  eligibleRig();
  let calls = 0;
  T.setChangelogFetcher(async () => { calls++; return FEED; });
  const set = (on) => fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updateCheck: on }) });
  try {
    assert.equal((await set(false)).status, 200);
    assert.equal((await preview('9.1.0')).body.changes.state, 'off');
    assert.equal(calls, 0);
  } finally { await set(true); }
});

test('GET /api/app/update/versions annotates; 502 when the registry cannot be reached', async () => {
  eligibleRig();
  const j = await (await fetch(`${base}/api/app/update/versions`)).json();
  assert.equal(j.versions.find((v) => v.version === '9.1.0').relation, 'newer');
  T.setVersionsFetcher(async () => { throw new Error('offline'); });
  assert.equal((await fetch(`${base}/api/app/update/versions?refresh=1`)).status, 502);
});

test('lastResult: a fresh failure from the running version shows; one from another version does not', async () => {
  eligibleRig();
  const finishedAt = new Date().toISOString();
  writeUpdateRecord({ state: 'failed', from: T.pkgVersion, to: '9.1.0', reason: 'npm could not write to /x (EACCES)', output: 'npm error code EACCES', finishedAt });
  const a = await (await fetch(`${base}/api/app/update`)).json();
  assert.deepEqual([a.lastResult?.state, a.lastResult?.to], ['failed', '9.1.0']);
  writeUpdateRecord({ state: 'failed', from: '0.0.1', to: '9.1.0', reason: 'x', output: '', finishedAt });
  assert.equal((await (await fetch(`${base}/api/app/update`)).json()).lastResult, null, 'stale: another version runs now');
});

test('existing /api/app/version payload is unchanged (decision 4)', async () => {
  const j = await (await fetch(`${base}/api/app/version`)).json();
  assert.deepEqual(Object.keys(j).sort(), ['checkedAt', 'current', 'enabled', 'latest', 'links', 'status']);
});
