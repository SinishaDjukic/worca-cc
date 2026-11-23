// test/runs-answer-route-attached.test.mjs — POST /api/runs/:id/answer forwards the Requirements card's
// agreedSeqs / decisions / conflicts to the answer handler, and leaves them off when the body has none.
// Boot = the server-mock-mode recipe (temp home + WORCA_MOCK BEFORE the dynamic import; listen on the MODULE server).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let srv, base, runs;
const savedMock = process.env.WORCA_MOCK;
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

before(async () => {
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  ({ runs } = mod);
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
  if (savedMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = savedMock;
});

function fakePlanRun(id, answer) {
  runs.set(id, { id, kind: 'run', status: 'running', events: [], orch: { answer }, pendingQuestion: { id: 'plan-n_refine-1', kind: 'plan' } });
}

test('agreedSeqs, decisions and conflicts reach the answer handler', async () => {
  const calls = [];
  fakePlanRun('attached-fwd-run', (qid, payload) => { calls.push({ qid, payload }); return true; });
  try {
    const body = {
      id: 'plan-n_refine-1', decision: 'approve',
      agreedSeqs: [3, 5],
      decisions: { 3: 'keep' },
      conflicts: { 5: 'theirs' },
    };
    const r = await post('/api/runs/attached-fwd-run/answer', body);
    assert.equal(r.status, 200, await r.text());
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].payload, {
      decision: 'approve', agreedSeqs: [3, 5], decisions: { 3: 'keep' }, conflicts: { 5: 'theirs' },
    });
  } finally { runs.delete('attached-fwd-run'); }
});

test('a body without them forwards no such keys', async () => {
  const calls = [];
  fakePlanRun('attached-absent-run', (qid, payload) => { calls.push(payload); return true; });
  try {
    const r = await post('/api/runs/attached-absent-run/answer', { id: 'plan-n_refine-1', decision: 'approve' });
    assert.equal(r.status, 200, await r.text());
    assert.deepEqual(calls[0], { decision: 'approve' });
    assert.ok(!('agreedSeqs' in calls[0]) && !('decisions' in calls[0]) && !('conflicts' in calls[0]));
  } finally { runs.delete('attached-absent-run'); }
});
