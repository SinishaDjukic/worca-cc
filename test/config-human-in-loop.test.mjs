import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { readRunConfig, setHumanInLoop, setActiveWorkflow } from '../src/core/config.mjs';

let proj, srv, base, homeDir, prevHome;
before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-hitl-home-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-hitl-proj-'));
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(proj, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});
const patch = (body) => fetch(`${base}/api/config`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectDir: proj, ...body }) });
const get = async () => (await (await fetch(`${base}/api/config?projectDir=${encodeURIComponent(proj)}`)).json()).config;

test('humanInLoop: absent means on; false is stored and surfaced; true removes the key again; a fresh project starts on Auto', async () => {
  const fresh = await readRunConfig(proj);
  assert.equal(fresh.humanInLoop, undefined, 'no row yet');
  assert.equal(fresh.activeWorkflowId, 'wf_auto', 'D16: a project with no remembered choice starts on Auto');
  await setHumanInLoop(proj, false);
  assert.equal((await readRunConfig(proj)).humanInLoop, false);
  assert.equal((await readRunConfig(proj)).activeWorkflowId, 'wf_auto', 'a row with a NULL active id still reads as Auto');
  await setHumanInLoop(proj, true);
  assert.equal((await readRunConfig(proj)).humanInLoop, undefined, 'on is the default and is not echoed');
  await setActiveWorkflow(proj, 'wf_quick-fix');
  assert.equal((await readRunConfig(proj)).activeWorkflowId, 'wf_quick-fix', 'a remembered choice wins; the toggle never touches it');
});

test('PATCH /api/config writes humanInLoop; GET reflects it; non-booleans are ignored', async () => {
  let r = await patch({ humanInLoop: false });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).config.humanInLoop, false);
  assert.equal((await get()).humanInLoop, false);
  r = await patch({ humanInLoop: 'yes' });
  assert.equal(r.status, 200);
  assert.equal((await get()).humanInLoop, false, 'a non-boolean changes nothing');
  r = await patch({ humanInLoop: true });
  assert.equal((await r.json()).config.humanInLoop, undefined);
});
