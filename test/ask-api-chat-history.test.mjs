// test/ask-api-chat-history.test.mjs — worca Chat P1: GET /api/ask/threads flags `waiting` (the History column's amber
// dot) from the follower map: an undetached follower on a live, unsettled run with a pending question.
// Boot = test/ask-api-threads.test.mjs (temp home BEFORE the dynamic import).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let homeDir, srv, base, mod, prevHome;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-chathist-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) {
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
});

test('the History list flags waiting: a followed live run with a pending question; not once answered, detached or settled', async () => {
  const store = await import('../src/core/ask/store.mjs');
  const t = store.createThread();
  const entry = { id: 'uuid-WAIT', orch: new EventEmitter(), projectDir: join(homeDir, 'p'), title: 't', status: 'running', startedAt: new Date().toISOString(), events: [], pendingQuestion: { id: 'q1', kind: 'clarify' }, pipelineId: 'aaaa1111' };
  mod.runs.set(entry.id, entry);
  const follower = (runId, detached = false) => ({ runId, detached, detach() {} });
  const rowFor = async () => (await (await fetch(`${base}/api/ask/threads`)).json()).threads.find((x) => x.id === t.id);
  try {
    let row = await rowFor();
    assert.equal(row.waiting, false, 'no follower: nothing waits');
    mod._testing.askFollowers.set(t.id, new Set([follower('uuid-WAIT')]));
    row = await rowFor();
    assert.equal(row.waiting, true);
    assert.equal(row.tracking, true, 'a waiting run is still a followed live run');
    entry.pendingQuestion = null;
    row = await rowFor();
    assert.equal(row.waiting, false, 'answered');
    entry.pendingQuestion = { id: 'q2', kind: 'gate' };
    mod._testing.askFollowers.set(t.id, new Set([follower('uuid-WAIT', true)]));
    row = await rowFor();
    assert.equal(row.waiting, false, 'a detached follower');
    mod._testing.askFollowers.set(t.id, new Set([follower('uuid-WAIT')]));
    entry.status = 'stopped';
    row = await rowFor();
    assert.equal(row.waiting, false, 'a settled run');
  } finally {
    mod._testing.askFollowers.delete(t.id);
    mod.runs.delete(entry.id);
  }
});
