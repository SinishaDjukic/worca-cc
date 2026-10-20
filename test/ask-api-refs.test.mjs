// test/ask-api-refs.test.mjs — POST /api/ask/refs/resolve (Chat answer chips) through the real server: worca runs and
// chats from the DB and the runs Map, GitHub through a stubbed gh runner, Azure DevOps through the stubbed fetch, the
// server-side cache, and the guards (a bad body, a composer thread, a caller that may be an agent).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import * as azurePr from '../src/core/pr/azure.mjs';

useTempHome(after);

let mod, srv, base;
const tmpDirs = [];
const JSONH = { 'Content-Type': 'application/json' };
const resolve = async (refs) => {
  const r = await fetch(`${base}/api/ask/refs/resolve`, { method: 'POST', headers: JSONH, body: JSON.stringify({ refs }) });
  return { status: r.status, body: await r.json() };
};
const GH_ENV = { GH_TOKEN: undefined, GITHUB_TOKEN: undefined, WORCA_GH_READ_TOKEN: undefined, WORCA_GH_WRITE_TOKEN: undefined, WORCA_GH_APP_ID: undefined };
/** gh --version answers; `gh api graphql` answers `data`, and every call is recorded. */
function stubGh(data) {
  const calls = [];
  gitInfo.setRunner(async (cmd, args) => {
    calls.push(args);
    if (args[0] === '--version') return { ok: true, stdout: 'gh version 2.63.2', stderr: '', code: 0 };
    return { ok: true, stdout: JSON.stringify(data), stderr: '', code: 0 };
  });
  return calls;
}

before(async () => {
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
beforeEach(() => { mod._testing.askRefResolver.clear(); gitInfo.reset(); azurePr._testing.reset(); });
after(async () => {
  gitInfo.reset();
  azurePr._testing.reset();
  mod.runs.clear();
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  closeDbForTests();
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

test('POST /api/ask/refs/resolve: a body that is not a short list of strings is a 400', async () => {
  for (const body of [{}, { refs: 'gh:o/r#1' }, { refs: [1] }, { refs: Array.from({ length: 51 }, (_, i) => `gh:o/r#${i + 1}`) }, { refs: [`gh:o/${'r'.repeat(400)}#1`] }]) {
    const r = await fetch(`${base}/api/ask/refs/resolve`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
    await r.json();
  }
  assert.deepEqual((await resolve(['nope', 'gh:o/r#0'])).body, { refs: {} }, 'unparseable keys are dropped, never echoed');
});

test('POST /api/ask/refs/resolve: runs by History id or live id; chats by id; composer threads and unknown ids are misses', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-ask-refs-'));
  tmpDirs.push(dir);
  const saved = await seedPipeline(dir, { title: 'Saved plan', status: 'done', steps: [] });
  const parked = await seedPipeline(dir, { title: 'Parked', status: 'paused', resumePoint: { pauseReason: 'cost_total' }, steps: [] });
  const going = await seedPipeline(dir, { title: 'Row title', status: 'running', steps: [] });
  const entry = { id: '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0', orch: new EventEmitter(), projectDir: dir, pipelineId: going.id, title: 'Live title', status: 'paused', pauseReason: 'cost_pipeline', startedAt: new Date().toISOString(), events: [], pendingQuestion: null };
  const young = { id: '1c2d3e4f-5061-7283-94a5-b6c7d8e9f0a1', orch: new EventEmitter(), projectDir: dir, pipelineId: null, title: 'Starting up', status: 'starting', startedAt: new Date().toISOString(), events: [], pendingQuestion: null };
  const unsaved = { ...young, id: '2d3e4f50-6172-8394-a5b6-c7d8e9f0a1b2', pipelineId: 'feedf00d', title: 'No row yet', status: 'running' };
  for (const e of [entry, young, unsaved]) mod.runs.set(e.id, e);
  const chat = (await (await fetch(`${base}/api/ask/threads`, { method: 'POST', headers: JSONH, body: JSON.stringify({ title: 'Release notes' }) })).json()).thread;
  const composer = (await (await fetch(`${base}/api/ask/threads`, { method: 'POST', headers: JSONH, body: JSON.stringify({ mode: 'composer' }) })).json()).thread;
  try {
    const { status, body } = await resolve([`run:${saved.id}`, `run:${parked.id}`, `run:${going.id}`, `run:${entry.id}`, `run:${young.id}`, 'run:feedf00d',
      'run:00000000', `chat:${chat.id}`, `chat:${composer.id}`, 'chat:ask_00000000']);
    assert.equal(status, 200);
    const home = projectKey(dir);
    assert.deepEqual(body.refs[`run:${saved.id}`], { ok: true, kind: 'run', id: saved.id, runId: null, title: 'Saved plan', status: 'done', pauseReason: null, home });
    assert.deepEqual(body.refs[`run:${parked.id}`], { ok: true, kind: 'run', id: parked.id, runId: null, title: 'Parked', status: 'paused', pauseReason: 'cost_total', home },
      'a saved run\'s pause cause comes from its resume point');
    const live = { ok: true, kind: 'run', id: going.id, runId: entry.id, title: 'Live title', status: 'paused', pauseReason: 'cost_pipeline', home };
    assert.deepEqual(body.refs[`run:${going.id}`], live, 'the live entry outranks the row');
    assert.deepEqual(body.refs[`run:${entry.id}`], live, 'the app run id finds the same run');
    assert.deepEqual(body.refs[`run:${young.id}`], { ok: true, kind: 'run', id: null, runId: young.id, title: 'Starting up', status: 'starting', pauseReason: null, home: null },
      'a run with no History row yet answers by its app run id');
    assert.deepEqual(body.refs['run:feedf00d'], { ok: true, kind: 'run', id: 'feedf00d', runId: unsaved.id, title: 'No row yet', status: 'running', pauseReason: null, home },
      'a History id the DB does not hold yet: the live entry names its home');
    assert.deepEqual(body.refs['run:00000000'], { ok: false });
    assert.deepEqual(body.refs[`chat:${chat.id}`], { ok: true, kind: 'chat', title: 'Release notes' });
    assert.deepEqual(body.refs[`chat:${composer.id}`], { ok: false }, 'a Workflows composer thread is no chat');
    assert.deepEqual(body.refs['chat:ask_00000000'], { ok: false });
    const mixed = await resolve(['constructor:x', '__proto__:x', `chat:${chat.id}`]);
    assert.equal(mixed.status, 200, 'a prototype-named kind never fails the batch');
    assert.deepEqual(mixed.body, { refs: { [`chat:${chat.id}`]: { ok: true, kind: 'chat', title: 'Release notes' } } }, 'the good key still resolves');
  } finally { for (const e of [entry, young, unsaved]) mod.runs.delete(e.id); }
});

test('POST /api/ask/refs/resolve: GitHub through gh (one call per repo, cached), Azure DevOps through the PAT', async () => {
  await withEnv({ ...GH_ENV, WORCA_ADO_TOKEN: 'pat', WORCA_ADO_BOARDS_TOKEN: undefined }, async () => {
    const calls = stubGh({ data: { r: { p777: { title: 'fix(promo-kit): startApp.stop()', state: 'MERGED', isDraft: false }, i777: null, p5: null, i5: null } } });
    const seen = [];
    azurePr._testing.setFetch(async (url) => {
      seen.push(String(url));
      if (/pullrequests\/42\?/.test(url)) return { ok: true, status: 200, json: async () => ({ status: 'active', isDraft: false, title: 'ADO PR' }) };
      if (/wit\/workitems\?/.test(url)) return { ok: true, status: 200, json: async () => ({ value: [{ id: 123, fields: { 'System.Title': 'Login loops', 'System.State': 'Resolved', 'System.WorkItemType': 'Bug' } }] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const keys = ['gh:SinishaDjukic/worca-cc#777', 'gh:SinishaDjukic/worca-cc#5', 'adopr:acme/My%20Shop#42', 'adowi:acme#123'];
    const { body } = await resolve(keys);
    assert.deepEqual(body.refs, {
      'gh:SinishaDjukic/worca-cc#777': { ok: true, kind: 'pr', title: 'fix(promo-kit): startApp.stop()', state: 'merged' },
      'gh:SinishaDjukic/worca-cc#5': { ok: false },
      'adopr:acme/My%20Shop#42': { ok: true, kind: 'pr', title: 'ADO PR', state: 'open' },
      'adowi:acme#123': { ok: true, kind: 'workitem', title: 'Login loops', state: 'Resolved', type: 'Bug' },
    });
    assert.equal(calls.filter((a) => a[0] === 'api').length, 1, 'one gh call for both numbers of the repo');
    assert.ok(seen.some((u) => u.startsWith('https://dev.azure.com/acme/My%20Shop/_apis/git/pullrequests/42?')));
    await resolve(keys);
    assert.equal(calls.filter((a) => a[0] === 'api').length, 1, 'the second batch is served from the cache');
    assert.equal(seen.length, 2);
  });
});

test('POST /api/ask/refs/resolve: a caller that may be an agent gets no GitHub or Azure lookup', async () => {
  const calls = stubGh({ data: { r: { p1: null, i1: { title: 'Private', state: 'OPEN' } } } });
  await withEnv({ ...GH_ENV, WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: join(tmpdir(), 'agent-home') }, async () => {
    const { body } = await resolve(['gh:o/private#1', 'chat:ask_00000000']);
    assert.deepEqual(body.refs, { 'gh:o/private#1': { ok: false }, 'chat:ask_00000000': { ok: false } });
  });
  assert.equal(calls.length, 0, 'gh never ran');
});
