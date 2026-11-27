// test/workflow-test-criteria-frames.test.mjs — final review M5: Part 4's writes send the workflow's `workflow-tests-changed` frame
// (as Part 2's runner does), so the list, the trust report and an open test page in another tab repaint. Free: WORCA_MOCK=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import * as cs from '../src/core/workflow-tests/criteria-store.mjs';
import { registerCriteriaRoutes } from '../src/core/workflow-tests/criteria-routes.mjs';

const GOOD = '## Success metric\n\nCut export tickets by 60% within one quarter, counted by the Export tag.\n\n## Risks\n\nLarge accounts.';
const WFID = 'wf_frames';
const W = `/api/workflows/${WFID}/tests`;
let home, srv, base;
const frames = [];
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-wftframes-'));
  _resetForTests();
  process.env.WORCA_HOME = home; process.env.WORCA_FLAGS = 'workflowTests'; process.env.WORCA_MOCK = '1';
  const app = express(); app.use(express.json());
  registerCriteriaRoutes(app, { deps: { broadcast: (f) => frames.push(f) } });
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  delete process.env.WORCA_HOME; delete process.env.WORCA_FLAGS; delete process.env.WORCA_MOCK;
  await rm(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});
const call = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
};
const frameAfter = async (n, ms = 10000) => {
  const t0 = Date.now();
  while (frames.length <= n) { if (Date.now() - t0 > ms) throw new Error('no frame'); await new Promise((r) => setTimeout(r, 20)); }
  return frames[frames.length - 1];
};

test('an answer, the result you liked, and a Check the checker round (its end and its answers) each send the changed frame', async () => {
  const ex = store.createExample(WFID, { name: 'Bulk export', request: 'Write the brief.', criteria: [{ text: 'Names a success metric with a number' }],
    judge: { model: 'claude-haiku-4-5' } });
  const run = store.createTestRun({ workflowId: WFID, kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  const t = store.insertTry({ runId: run.id, workflowId: WFID, exampleId: ex.id, use: 'draft', fp: 'f', exampleFp: ex.fingerprint, tryNo: 1 });
  const j = cs.insertJudgement({ workflowId: WFID, exampleId: ex.id, criterionId: ex.criteria[0].id, fp: cs.criterionFp(ex.criteria[0].text),
    model: 'claude-haiku-4-5', purpose: 'try', tryId: t.id, j: { met: true, reason: 'r', proof: 'Cut export tickets by 60%', proofFound: true, error: null, costUsd: 0, ms: 1 } });

  let n = frames.length;
  assert.equal((await call('POST', `${W}/judgements/${j.id}/answer`, { agree: true })).status, 200);
  assert.deepEqual(await frameAfter(n), { type: 'workflow-tests-changed', workflowId: WFID, testRunId: run.id }, 'Agree: the test of the try repaints too');

  n = frames.length;
  assert.equal((await call('PUT', `${W}/examples/${ex.id}/liked`, { name: 'brief.md', dataBase64: Buffer.from(GOOD).toString('base64') })).status, 200);
  assert.deepEqual(await frameAfter(n), { type: 'workflow-tests-changed', workflowId: WFID });

  n = frames.length;
  const s = await call('POST', `${W}/examples/${ex.id}/checker`, { criterionId: ex.criteria[0].id });
  assert.equal(s.status, 201);
  assert.deepEqual(await frameAfter(n), { type: 'workflow-tests-changed', workflowId: WFID }, 'the round end');
  const v = await call('GET', `${W}/examples/${ex.id}/checker/${s.body.round.id}`);
  assert.equal(v.body.round.status, 'ready');

  n = frames.length;
  const a = await call('POST', `${W}/examples/${ex.id}/checker/${s.body.round.id}/answers`, { judgementId: v.body.cards[0].judgementId, right: true });
  assert.equal(a.status, 200);
  assert.deepEqual(await frameAfter(n), { type: 'workflow-tests-changed', workflowId: WFID });

  n = frames.length;
  assert.equal((await call('DELETE', `${W}/examples/${ex.id}/liked`)).status, 200);
  assert.deepEqual(await frameAfter(n), { type: 'workflow-tests-changed', workflowId: WFID });

  n = frames.length;
  assert.equal((await call('POST', `${W}/judgements/999999/answer`, { agree: true })).status, 404);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(frames.length, n, 'a refused write sends nothing');
});
