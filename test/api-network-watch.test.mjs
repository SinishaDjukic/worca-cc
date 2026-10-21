// test/api-network-watch.test.mjs
// The server's network watch (network-wait.mjs + startNetworkWatch in ui/server.mjs): which
// paused / interrupted rows it resumes once the endpoint answers again, and how.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { stopAndSettle } from './helpers/stop-and-settle.mjs';

let homeDir, userHome, srv, base, dir, mod, getDb, runs;
const prev = {};
const ENV_KEYS = ['WORCA_HOME', 'WORCA_MOCK', 'HOME', 'USERPROFILE', 'WORCA_NETWORK_WAIT', 'WORCA_NETWORK_WAIT_MAX_MS'];
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b ?? {}) });
const inFuture = (ms) => new Date(Date.now() + ms).toISOString();
async function until(fn, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('condition never became true');
    await new Promise((r) => setTimeout(r, 25));
  }
}

before(async () => {
  for (const k of ENV_KEYS) prev[k] = process.env[k];
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-netwatch-'));
  // The watch reads effectiveNetworkWait() from user settings (HOME), never the developer's file.
  userHome = await mkdtemp(join(tmpdir(), 'worca-cc-netwatch-user-'));
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  process.env.HOME = userHome;
  process.env.USERPROFILE = userHome;
  process.env.WORCA_NETWORK_WAIT = '1';
  delete process.env.WORCA_NETWORK_WAIT_MAX_MS;   // the 4 h default
  mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  ({ getDb } = await import('../src/core/db.mjs'));
  const { addProject } = await import('../src/core/projects.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  dir = gitDir('net-watch');
  await addProject({ name: 'net-watch', path: dir });
});

after(async () => {
  await stopAndSettle(runs);
  await new Promise((r) => srv.close(r));
  for (const k of ENV_KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(userHome, { recursive: true, force: true });
});

const since = () => new Date(Date.now() - 10 * 60_000).toISOString();
const net = (over = {}) => ({ since: since(), origin: 'https://api.anthropic.com', reachable: false, waiting: false, ...over });

/** A resumable fixture (v2 point + a real worktree dir) whose resume point carries `over`. */
async function seedRun(over = {}, status = 'paused') {
  const wt = await mkdtemp(join(tmpdir(), 'net-watch-wt-'));
  const branch = { source: 'main', feature: 'feat/x', worktreeDir: wt, reusedExisting: false };
  const { id } = await seedPipeline(dir, { title: 'Net feat', status, branch, resumePoint: graphResumePoint({ pipelineDir: dir, ...over }) });
  return id;
}
/** Park a row so later passes never see it. */
const retire = (id) => getDb().prepare("UPDATE pipelines SET status = 'stopped' WHERE id = ?").run(id);

test('the watcher resumes only network pauses parked while unreachable, inside the window, and keeps --yes', async () => {
  const ids = {
    netAuto: await seedRun({ pauseReason: 'recoverable', pauseClass: 'network', network: net(), runAuto: true }),
    netReach: await seedRun({ pauseReason: 'recoverable', pauseClass: 'network', network: net({ reachable: true }) }),
    auth: await seedRun({ pauseReason: 'recoverable', pauseClass: 'auth', network: net() }),
    cost: await seedRun({ pauseReason: 'cost_pipeline', network: net() }),
    usage: await seedRun({ pauseReason: 'usage_limit', network: net() }),
    manual: await seedRun({ pauseReason: null, network: net() }),
    old: await seedRun({ pauseReason: 'recoverable', pauseClass: 'network', network: net({ since: new Date(Date.now() - 5 * 3_600_000).toISOString() }) }),
    legacy: await seedRun({ pauseReason: 'recoverable', pauseDetail: 'network: ECONNRESET' }),
  };
  const probes = [];
  mod._testing.setNetworkProbe(async (o) => { probes.push(o); return true; });
  const resumed = await mod._testing.networkWatchTick();
  assert.deepEqual(resumed, [ids.netAuto]);
  assert.deepEqual(probes, ['https://api.anthropic.com'], 'one probe for the one origin');
  const entry = [...runs.values()].find((e) => e.pipelineId === ids.netAuto);
  assert.ok(entry, 'a live entry drives the pipeline again');
  assert.equal(entry.orch.auto, true, 'the --yes mode survived the resume');
  assert.equal(entry.lastAction.by, 'worca (network watch)');
  const line = await until(() => getDb().prepare("SELECT text, actor FROM pipeline_events WHERE pipeline_id = ? AND text LIKE 'Network back%'").get(ids.netAuto));
  assert.equal(line.actor, 'worca (network watch)');
  assert.match(line.text, /api\.anthropic\.com answers again\. Run resumed by worca \(network watch\)/);
  for (const k of ['netReach', 'auth', 'cost', 'usage', 'manual', 'old', 'legacy']) {
    assert.equal(getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(ids[k]).status, 'paused', k);
    retire(ids[k]);
  }
  await stopAndSettle(runs, (e) => e === entry);
});

test('a probe that still fails resumes nothing; a pending "Resume at…" ticket wins', async () => {
  const down = await seedRun({ pauseReason: 'recoverable', pauseClass: 'network', network: net() });
  mod._testing.setNetworkProbe(async () => false);
  assert.deepEqual(await mod._testing.networkWatchTick(), []);
  assert.equal(getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(down).status, 'paused');
  retire(down);

  const ticketed = await seedRun({ pauseReason: 'recoverable', pauseClass: 'network', network: net() });
  const r = await post('/api/schedules/resume', { pipelineId: ticketed, scheduledFor: inFuture(2 * 3_600_000) });
  assert.equal(r.status, 202);
  await r.arrayBuffer();
  mod._testing.setNetworkProbe(async () => true);
  assert.deepEqual(await mod._testing.networkWatchTick(), [], 'the user\'s scheduled resume time wins');
  assert.equal(getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(ticketed).status, 'paused');
  retire(ticketed);
});

test('an interrupted run that died while waiting is resumed when the network answers', async () => {
  const died = await seedRun({ pauseReason: null, network: net({ waiting: true }), runAuto: true }, 'interrupted');
  const notWaiting = await seedRun({ pauseReason: null, network: net() }, 'interrupted');
  mod._testing.setNetworkProbe(async () => true);
  assert.deepEqual(await mod._testing.networkWatchTick(), [died]);
  const entry = [...runs.values()].find((e) => e.pipelineId === died);
  assert.ok(entry);
  assert.equal(entry.orch.auto, true);
  retire(notWaiting);
  await stopAndSettle(runs, (e) => e === entry);
});
