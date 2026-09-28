// test/api-ask-form-files.test.mjs
// The HTTP half of ask forms (spec §5 gate 3, §7, D8): a gate-3 rejection is a
// 422 that leaves the question OPEN, and the snapshot files are served by
// (run, askId, index) with the Ask-attachment route's headers — no path input
// anywhere on the surface. Rows are seeded through the PRODUCTION writers
// (seedPipeline -> createPipeline + writeState): runDirForRow finds a run dir by
// scanning the store's pipelines/ dir for `-<id>`, no column ever holds it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { snapshotAskFiles } from '../src/core/ask-files.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', 'utf8');
/** Non-ASCII prose, built without a typed escape (a `\u` in test source is a copy trap). */
const NOTES = '# caf' + String.fromCharCode(0xe9) + ' notes\n';
const WS_KEY = 'wks-team-a-00000001';

let srv, base, runs, prevHome, homeDir, proj, key, id, dir, wsId;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askfilesapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  _resetForTests();
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-askfilesapi-proj-'));
  ({ id, key, dir } = await seedPipeline(proj, { title: 'A', status: 'done' }));
  const work = await mkdtemp(join(homeDir, 'wt-'));
  await writeFile(join(work, 'a.png'), PNG);
  await writeFile(join(work, 'logo.svg'), SVG);
  await writeFile(join(work, 'notes.md'), NOTES, 'utf8');
  const snap = await snapshotAskFiles({
    refs: [{ path: 'data.a', rel: 'a.png', accept: [] }, { path: 'data.b', rel: 'logo.svg', accept: [] },
      { path: 'data.c', rel: 'notes.md', accept: [] }],
    roots: [work], destDir: join(dir, 'ask-files', 'ask1'),
  });
  assert.deepEqual(snap.errors, []);
  // A workspace run under the workspace store namespace (ruling X12).
  const ws = await seedWorkspacePipeline(proj, WS_KEY, { title: 'ws run', status: 'done' },
    [{ projectKey: key, projectDir: proj, projectName: 'alpha' }]);
  wsId = ws.id;
  const wsSnap = await snapshotAskFiles({
    refs: [{ path: 'data.a', rel: 'a.png', accept: [] }], roots: [work], destDir: join(ws.dir, 'ask-files', 'ask9'),
  });
  assert.deepEqual(wsSnap.errors, []);
  const mod = await import('../ui/server.mjs');
  runs = mod.runs; srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  runs.clear();
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 3 });
  await rm(proj, { recursive: true, force: true, maxRetries: 3 });
});

/** A live-run entry whose orchestrator is a stub; `answer` decides the gate. */
function fakeEntry(runId, answer, pendingQuestion = null) {
  const orch = new EventEmitter();
  orch.state = { id: runId, steps: [], subAgents: [], status: 'running' };
  orch.getState = () => ({ ...orch.state });
  orch.answer = answer;
  return { id: runId, runId, kind: 'run', orch, projectDir: '/tmp/x', title: 't', status: 'running',
    startedAt: new Date().toISOString(), events: [], pendingQuestion };
}
const post = (body) => fetch(`${base}/api/answer`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('POST /api/answer: a gate-3 rejection is 422 with the errors, and the question stays OPEN', async () => {
  const runId = 'run-422';
  let open = true;
  const entry = fakeEntry(runId, (qid, payload) => {
    if (payload?.values?.verdict === 'approve') { open = false; return true; }
    const err = new Error('invalid answer');
    err.code = 'INVALID_ANSWER';
    err.errors = [{ path: 'verdict', code: 'enum', message: 'verdict must be approve or changes' }];
    throw err;
  }, { type: 'question', id: 'q-form-1', kind: 'form', form: 'review-mockups' });
  runs.set(runId, entry);

  const bad = await post({ runId, id: 'q-form-1', payload: { values: { verdict: 'maybe' } } });
  assert.equal(bad.status, 422);
  const body = await bad.json();
  assert.equal(body.error, 'invalid answer');
  assert.deepEqual(body.errors, [{ path: 'verdict', code: 'enum', message: 'verdict must be approve or changes' }]);
  assert.equal(open, true);
  assert.ok(entry.pendingQuestion, 'the question is still the active one — no question-resolved was broadcast');

  const ok = await post({ runId, id: 'q-form-1', payload: { values: { verdict: 'approve' } } });
  assert.equal(ok.status, 200);
  assert.equal(entry.pendingQuestion, null);
  runs.delete(runId);
});

test('answerRun / chatActions.answer RETHROW the gate-3 error unchanged and never resolve the question (X2)', async () => {
  const { _testing } = await import('../ui/server.mjs');
  const { answerRun, chatActions } = _testing;
  const runId = 'run-rethrow';
  const thrown = Object.assign(new Error('invalid answer'), {
    code: 'INVALID_ANSWER', errors: [{ path: 'picked', code: 'enum', message: 'not an option' }],
  });
  const pending = { type: 'question', id: 'q-form-2', kind: 'form', form: 'review-mockups' };
  const entry = fakeEntry(runId, () => { throw thrown; }, pending);
  runs.set(runId, entry);
  // This is the exact shape P4's CLI and chat callers will write.
  let caught = null;
  try { answerRun(runId, 'q-form-2', { values: { picked: 'zzz' } }); } catch (err) { caught = err; }
  assert.equal(caught, thrown, 'the SAME error object — not wrapped, not re-created');
  assert.equal(caught.code, 'INVALID_ANSWER');
  assert.deepEqual(caught.errors, [{ path: 'picked', code: 'enum', message: 'not an option' }]);
  assert.equal(entry.pendingQuestion, pending, 'resolvePending was never reached — the question stays open');
  // The chat-facing action is the SAME function, so a /answer from Discord sees
  // the identical throw and P4 can catch it once.
  let chatCaught = null;
  try { await chatActions.answer(runId, 'q-form-2', { values: { picked: 'zzz' } }); } catch (err) { chatCaught = err; }
  assert.equal(chatCaught, thrown);
  assert.equal(entry.pendingQuestion, pending);
  runs.delete(runId);
});

test('POST /api/answer: a non-gate failure is still a 500 (the 422 is gate 3 ONLY)', async () => {
  const runId = 'run-500';
  runs.set(runId, fakeEntry(runId, () => { throw new Error('boom'); }));
  const r = await post({ runId, id: 'q1', payload: {} });
  assert.equal(r.status, 500);
  assert.equal((await r.json()).error, 'boom');
  runs.delete(runId);
});

test('GET /api/runs/:id/ask-files/:askId/:index: the sniffed type, inline, nosniff, immutable', async () => {
  const png = await fetch(`${base}/api/runs/${id}/ask-files/ask1/0`);
  assert.equal(png.status, 200);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal(png.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(png.headers.get('content-disposition'), 'inline');
  assert.match(png.headers.get('cache-control'), /private.*immutable/);
  assert.equal(png.headers.get('content-security-policy'), null, 'only SVG gets the sandbox CSP');
  assert.deepEqual(Buffer.from(await png.arrayBuffer()), PNG);

  const svg = await fetch(`${base}/api/runs/${id}/ask-files/ask1/1`);
  assert.equal(svg.status, 200);
  assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
  assert.equal(svg.headers.get('content-security-policy'), "sandbox; default-src 'none'",
    'spec §7: an svg response is inert even when opened directly');

  // F29: a text class names its charset. The sniffer proved the body UTF-8, and under
  // nosniff a bare text/plain is decoded with the browser's legacy default on a direct open.
  const txt = await fetch(`${base}/api/runs/${id}/ask-files/ask1/2`);
  assert.equal(txt.status, 200);
  assert.equal(txt.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(txt.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await txt.text(), NOTES, 'the bytes are the snapshot, decoded as UTF-8');
  assert.equal(png.headers.get('content-type'), 'image/png', 'a binary class stays bare');
});

test('the file route takes NO path input: bad ids, traversal shapes and unknown asks', async () => {
  for (const [url, status] of [
    [`/api/runs/${id}/ask-files/ask1/99`, 404],
    [`/api/runs/${id}/ask-files/nope/0`, 404],
    [`/api/runs/${id}/ask-files/ask1/manifest.json`, 400],
    [`/api/runs/${id}/ask-files/ask1/-1`, 400],
    [`/api/runs/${id}/ask-files/ask1/1e3`, 400],
    [`/api/runs/${id}/ask-files/${encodeURIComponent('../../etc')}/0`, 400],
    [`/api/runs/${id}/ask-files/${encodeURIComponent('a.b')}/0`, 400],
    ['/api/runs/nosuchrun/ask-files/ask1/0', 404],
  ]) {
    const r = await fetch(base + url);
    assert.equal(r.status, status, `${url} => ${r.status}`);
  }
});

test('the HISTORY twin serves the same bytes and refuses a malformed store key', async () => {
  const ok = await fetch(`${base}/api/history/${key}/${id}/ask-files/ask1/0`);
  assert.equal(ok.status, 200);
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), PNG);
  assert.equal((await fetch(`${base}/api/history/NOT_A_KEY/${id}/ask-files/ask1/0`)).status, 404);
  assert.equal((await fetch(`${base}/api/history/${key}/nosuch/ask-files/ask1/0`)).status, 404);
});

test('the WORKSPACE twin (ruling X12): same bytes, WORKSPACE_KEY_RE guard, composed store key', async () => {
  const ok = await fetch(`${base}/api/workspaces/${WS_KEY}/runs/${wsId}/ask-files/ask9/0`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), PNG);
  for (const [url, status] of [
    [`/api/workspaces/NOT-A-WORKSPACE-KEY/runs/${wsId}/ask-files/ask9/0`, 404],
    [`/api/workspaces/${WS_KEY}/runs/nosuch/ask-files/ask9/0`, 404],
    [`/api/workspaces/${WS_KEY}/runs/${wsId}/ask-files/ask9/99`, 404],
    [`/api/workspaces/${WS_KEY}/runs/${wsId}/ask-files/${encodeURIComponent('../x')}/0`, 400],
    [`/api/workspaces/${WS_KEY}/runs/${wsId}/ask-files/ask9/manifest.json`, 400],
    [`/api/history/workspaces/${WS_KEY}/${wsId}/ask-files/ask9/0`, 404],
  ]) {
    assert.equal((await fetch(base + url)).status, status, url);
  }
});

test('the live WS runId also resolves (the browser holds it, not the pipeline id)', async () => {
  const uuid = 'ffffffff-0000-4000-8000-000000000001';
  runs.set(uuid, { ...fakeEntry(uuid, () => true), pipelineId: id });
  const r = await fetch(`${base}/api/runs/${uuid}/ask-files/ask1/0`);
  assert.equal(r.status, 200);
  runs.delete(uuid);
});
