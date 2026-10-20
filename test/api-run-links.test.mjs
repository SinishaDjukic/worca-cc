// test/api-run-links.test.mjs — GET /api/run-links/:runId (runs redesign §5a.1): an old `#running/<runId>` link from
// chat history names the saved run it became. Booted like test/api-runs-bulk.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../ui/server.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { createThread, linkRun } from '../src/core/ask/store.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';

let srv, base, home, prevHome;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-run-links-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

test('GET /api/run-links/:runId names the saved run of a chat-started run', async () => {
  seedPipelineRow({ id: 'p-chat', title: 'From chat', status: 'done' });
  const t = createThread({ title: 't' });
  linkRun(t.id, { runId: 'run-old-1', pipelineId: 'p-chat', cardId: 'c1' });
  const r = await fetch(`${base}/api/run-links/run-old-1`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { pipelineId: 'p-chat', historyKey: 'proj-00000001' });
});

test('an unknown run id, or a deleted run, is a 404', async () => {
  assert.equal((await fetch(`${base}/api/run-links/nope`)).status, 404);
  seedPipelineRow({ id: 'p-del', status: 'done' });
  getDb().prepare("UPDATE pipelines SET deleted_at = '2026-10-19T00:00:00Z' WHERE id = 'p-del'").run();
  linkRun(createThread({ title: 'u' }).id, { runId: 'run-del', pipelineId: 'p-del' });
  assert.equal((await fetch(`${base}/api/run-links/run-del`)).status, 404);
});

test('a workspace run resolves to its workspaces/ key', async () => {
  seedPipelineRow({ id: 'p-ws', target: 'workspace', workspaceKey: 'wk1', status: 'done' });
  linkRun(createThread({ title: 'w' }).id, { runId: 'run-ws', pipelineId: 'p-ws' });
  assert.equal((await (await fetch(`${base}/api/run-links/run-ws`)).json()).historyKey, 'workspaces/wk1');
});
