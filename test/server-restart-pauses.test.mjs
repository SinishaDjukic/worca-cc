// test/server-restart-pauses.test.mjs — Known bug 11: stop and start the server with a live run; it reads Paused, then resumes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { gitDir } from './helpers/git-dir.mjs';

const SERVER = fileURLToPath(new URL('../ui/server.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); s.on('error', rej); });

function startServer(env, port) {
  const child = spawn(process.execPath, [SERVER], { env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.log = '';
  child.stdout.on('data', (d) => { child.log += d; });
  child.stderr.on('data', (d) => { child.log += d; });
  child.exited = new Promise((res) => child.on('exit', (code, signal) => res({ code, signal })));
  return child;
}
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(200); }
}

test('a live run is paused by a restart and resumes on the next start', { skip: process.platform === 'win32', timeout: 180000 }, async () => {
  const worcaHome = await mkdtemp(join(tmpdir(), 'worca-restart-db-'));
  const home = await mkdtemp(join(tmpdir(), 'worca-restart-home-'));
  const env = { ...process.env, WORCA_HOME: worcaHome, HOME: home, USERPROFILE: home, WORCA_MOCK: '1', WORCA_DRAIN_TIMEOUT_MS: '8000', WORCA_TEST_ALLOW_HOME_FALLBACK: '1' };
  delete env.WORCA_AUTO_RESUME;
  delete env.FORCE_COLOR;
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const ok = async () => { try { return (await fetch(`${base}/api/health`)).status === 200; } catch { return false; } };
  let child = startServer(env, port);
  const project = gitDir('restart');
  after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await rm(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(worcaHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  await until(ok, 30000, `first start:\n${child.log}`);
  // resumeRun maps the run's project_key back through the registry (ui/server.mjs resumeTargetDirs): without this
  // the second start logs "stays paused: project for this pipeline is not onboarded on this machine".
  const reg = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name: 'restart-probe', path: project }) });
  assert.ok(reg.ok, `POST /api/projects answered ${reg.status}: ${await reg.clone().text()}`);
  const r = await fetch(`${base}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ projectDir: project, workflowId: 'wf_default', guardrailsId: 'normal', prompt: 'restart probe' }) });
  assert.ok(r.ok, `POST /api/run answered ${r.status}: ${await r.clone().text()}`);

  process.env.WORCA_HOME = worcaHome;   // this process reads the same DB once the child is gone / beside it
  const { getDb } = await import('../src/core/db.mjs');
  const row = () => getDb().prepare('SELECT id, status, owner_pid, resume_point FROM pipelines ORDER BY started_at DESC LIMIT 1').get();
  const asking = () => getDb().prepare("SELECT 1 AS ok FROM pipeline_steps WHERE pipeline_id = ? AND node_id = 'n_clarify'").get(row()?.id);
  await until(() => row()?.status === 'running' && asking(), 60000, `the run waits on clarify:\n${child.log}`);
  await sleep(1000);   // the clarify execution is past its start and asking

  child.kill('SIGTERM');
  await child.exited;
  const parked = row();
  assert.equal(parked.status, 'paused', 'a restart pauses, never stops');
  assert.ok(parked.resume_point, `the drain wrote a resume point:\n${child.log}`);
  assert.equal(JSON.parse(parked.resume_point).pauseReason, 'drain');
  const { runModelFor } = await import('../src/core/run-status.mjs');
  const m = runModelFor(parked.id);
  assert.equal(m.word, 'Paused');
  assert.match(m.line, /paused · restart$/);

  child = startServer(env, port);
  await until(ok, 30000, `second start:\n${child.log}`);
  const back = await until(() => { const x = row(); return x.status === 'running' && x.owner_pid === child.pid ? x : null; }, 60000, `resume:\n${child.log}`);
  assert.equal(back.id, parked.id, 'the same run resumed');
});
