// test/design-api.test.mjs
// The Design REST routes (P2 Task 18, SPEC C-8) on a bare Express app, over a real build registry and the mock engine.
// One temp home for the file: earlier tests leave designs and settled builds behind, so every lookup goes by id.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import express from 'express';
import { newDesign, useDesignEnv, waitForFrame, waitUntil } from './helpers/design-fixture.mjs';
import { addAttachment, appendMessage, createThread } from '../src/core/ask/store.mjs';
import { currentBillTo } from '../src/core/billing.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { prepare } from '../src/core/db.mjs';
import { DesignRefusal } from '../src/core/design/build.mjs';
import { createDesignChatActions } from '../src/core/design/chat-actions.mjs';
import { DesignError } from '../src/core/design/ids.mjs';
import { stageDesignKit } from '../src/core/design/kit.mjs';
import { designDir, designWorkDir } from '../src/core/design/paths.mjs';
import { createDesignBuilds, ROUND_STARTING } from '../src/core/design/registry.mjs';
import { DESIGN_ROUTES, registerDesignRoutes } from '../src/core/design/routes.mjs';
import { getBuild, getDesign, listAgents, updateBuild, updateDesign } from '../src/core/design/store.mjs';

const servers = [];
const registries = [];
after(async () => {
  for (const r of registries) { r.pauseAll(); await r.settled(); }
  for (const srv of servers) {
    srv.closeAllConnections?.();
    await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  }
});
useDesignEnv(after);

/** `mock: true` keeps every spawn on the mock even while a test deletes `WORCA_MOCK`. */
const REG_DEPS = Object.freeze({ mock: true, staggerMs: 0, retryDelayMs: 0 });
const frames = [];
function registry(opts = {}) {
  const r = createDesignBuilds({ broadcast: (f) => frames.push(f), ...opts, deps: { ...REG_DEPS, ...opts.deps } });
  registries.push(r);
  return r;
}
const designBuilds = registry();

/** A bare app with these deps; `call(method, path, body, headers)` -> `{status, json}`. No body sends no content-type,
 *  so Express leaves `req.body` undefined, as for a real request with no JSON body. */
async function mkApp(deps) {
  const app = express();
  app.use(express.json());
  registerDesignRoutes(app, { broadcast: (f) => frames.push(f), deps });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  servers.push(srv);
  const base = `http://127.0.0.1:${srv.address().port}`;
  return async (method, path, body, headers = {}) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
}

let call;
let projKey;
let projDir;
before(async () => {
  call = await mkApp({ designBuilds });
  const { addProject } = await import('../src/core/projects.mjs');
  projDir = mkdtempSync(join(tmpdir(), 'design-api-shop-'));
  projKey = (await addProject({ name: 'shop', path: projDir })).find((p) => p.name === 'shop').key;
});
after(() => { if (projDir) rmSync(projDir, { recursive: true, force: true }); });

const fill = (path) => path.replace(':id', 'd_000000000000').replace(':bid', 'b_000000000000')
  .replace(':aid', 'a_00000000').replace(':n', '1');
const make = async (body = { kind: 'web' }) => (await call('POST', '/api/design', body)).json.design;
const designFolders = () => readdirSync(dirname(designDir('d_000000000000')));

test('DESIGN_ROUTES: the eleven routes, frozen, in registration order', () => {
  assert.ok(Object.isFrozen(DESIGN_ROUTES));
  assert.ok(DESIGN_ROUTES.every((r) => Object.isFrozen(r)));
  assert.deepEqual(DESIGN_ROUTES.map((r) => `${r.method} ${r.path}`), [
    'GET /api/design',
    'POST /api/design',
    'GET /api/design/limits',
    'GET /api/design/:id',
    'PATCH /api/design/:id',
    'DELETE /api/design/:id',
    'POST /api/design/:id/builds/:bid/stop',
    'POST /api/design/:id/builds/:bid/agents/:aid/stop',
    'POST /api/design/:id/builds/:bid/answer',
    'POST /api/design/:id/builds/:bid/continue',
    'POST /api/design/:id/versions/:n/restore',
  ]);
});

test('flag off: every route answers the flag gate 404', async () => {
  process.env.WORCA_FLAGS = '-design';
  try {
    for (const { method, path } of DESIGN_ROUTES) {
      const r = await call(method, fill(path), method === 'GET' ? undefined : {});
      assert.equal(r.status, 404, path);
      assert.deepEqual(r.json, { error: 'not found' });
    }
  } finally { process.env.WORCA_FLAGS = 'design'; }
});

test('create, read, list, patch', async () => {
  const c = await call('POST', '/api/design', { kind: 'web', title: 'Ship', fast: true });
  assert.equal(c.status, 201);
  assert.match(c.json.threadId, /^ask_/);
  assert.match(c.json.design.id, /^d_[0-9a-f]{12}$/);
  assert.deepEqual([c.json.design.title, c.json.design.fast, c.json.design.engine, c.json.design.createdBy], ['Ship', true, 'claude', 'local']);
  const g = await call('GET', `/api/design/${c.json.design.id}`);
  assert.deepEqual(Object.keys(g.json).sort(), ['build', 'design', 'plan', 'sections', 'versions']);
  assert.deepEqual([g.json.plan, g.json.build, g.json.sections, g.json.versions], [null, null, [], []]);
  assert.equal(g.json.design.id, c.json.design.id);
  const l = await call('GET', '/api/design');
  const item = l.json.find((x) => x.id === c.json.design.id);
  assert.deepEqual(Object.keys(item).sort(), ['costKnown', 'costUsd', 'id', 'kind', 'status', 'thumb', 'title', 'updatedAt']);
  assert.deepEqual([item.thumb, item.costUsd, item.status, item.title], [null, 0, 'empty', 'Ship']);
  const p = await call('PATCH', `/api/design/${c.json.design.id}`, { title: 'New', fast: false });
  assert.equal(p.status, 200);
  assert.deepEqual([p.json.title, p.json.fast], ['New', false]);
  assert.deepEqual([getDesign(c.json.design.id).title, getDesign(c.json.design.id).fast], ['New', false]);
  const none = await call('PATCH', `/api/design/${c.json.design.id}`);
  assert.equal(none.status, 200, 'a PATCH with no body changes nothing');
  assert.equal(none.json.title, 'New');
});

test('a project key must name a project, on POST and PATCH; a refused POST makes no folder', async () => {
  const c = await call('POST', '/api/design', { kind: 'web', projectKey: projKey });
  assert.equal(c.status, 201);
  assert.equal(c.json.design.projectKey, projKey);
  const before = designFolders().length;
  const bad = await call('POST', '/api/design', { kind: 'web', projectKey: 'nope' });
  assert.equal(bad.status, 400);
  assert.equal(designFolders().length, before, 'no folder for a refused POST');
  assert.equal((await call('PATCH', `/api/design/${c.json.design.id}`, { projectKey: 'nope' })).status, 400);
  assert.equal(getDesign(c.json.design.id).projectKey, projKey);
  assert.equal((await call('PATCH', `/api/design/${c.json.design.id}`, { projectKey: null })).json.projectKey, null);
  assert.equal((await call('PATCH', `/api/design/${c.json.design.id}`, { projectKey: projKey })).json.projectKey, projKey);
});

test('M7: PATCH {fast} during a build reaches build.setFast and kills nothing', async () => {
  const d = await make();
  const { buildId } = await designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=2 MOCK_HANG_SECTION=hero', by: 'local' });
  await waitUntil(() => designBuilds.liveAgentCount() > 0 && designBuilds.get(buildId)?.status === 'building');
  const b = designBuilds.get(buildId); const seen = [];
  const orig = b.setFast.bind(b); b.setFast = (v) => { seen.push(v); orig(v); };
  const bad = await call('PATCH', `/api/design/${d.id}`, { fast: 'yes' });
  assert.equal(bad.status, 400);
  assert.deepEqual(seen, [], 'a refused PATCH reaches nothing');
  const t = await call('PATCH', `/api/design/${d.id}`, { title: 'Only a title' });
  assert.equal(t.status, 200);
  assert.deepEqual(seen, [], 'a PATCH without fast leaves the build alone');
  const r = await call('PATCH', `/api/design/${d.id}`, { fast: true });
  assert.equal(r.json.fast, true);
  assert.deepEqual(seen, [true]);
  assert.equal(designBuilds.get(buildId).status, 'building');
  await call('POST', `/api/design/${d.id}/builds/${buildId}/stop`, {}); await designBuilds.settled();
  assert.equal(getDesign(d.id).fast, true, 'remembered per design');
});

test('bad bodies are 400; a bad project is 400', async () => {
  for (const b of [{ kind: 'poster' }, { kind: 'web', title: 'x'.repeat(121) }, { kind: 'web', fast: 'yes' }, { kind: 'web', projectKey: 'nope' }]) {
    assert.equal((await call('POST', '/api/design', b)).status, 400, JSON.stringify(b));
  }
  assert.equal((await call('POST', '/api/design')).status, 400, 'no body: kind is missing');
  const d = await make();
  assert.equal((await call('PATCH', `/api/design/${d.id}`, { status: 'done', currentBuild: 'b_000000000000', engine: 'codex', threadId: 't_x', version: 4 })).status, 200);
  const row = getDesign(d.id);
  assert.deepEqual([row.status, row.currentBuild, row.engine, row.threadId, row.version], ['empty', null, 'claude', d.threadId, 0],
    'only title, fast and projectKey reach updateDesign, which accepts more');
  for (const b of [{ fast: 'yes' }, { title: 5 }, { title: 'x'.repeat(121) }, { projectKey: 7 }, { projectKey: 'nope' }]) {
    assert.equal((await call('PATCH', `/api/design/${d.id}`, b)).status, 400, JSON.stringify(b));
  }
  assert.deepEqual([getDesign(d.id).title, getDesign(d.id).fast], ['Untitled design', false]);
});

test('bad ids and other people answer 404, on every route', async () => {
  const d = await make();
  const { buildId } = await designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'local' });
  await designBuilds.settled();
  const other = await make();
  const { buildId: otherBuild } = await designBuilds.start({ designId: other.id, brief: 'MOCK_SECTIONS=1', by: 'local' });
  await designBuilds.settled();
  const otherAgent = listAgents(otherBuild)[0].id;
  const B = `/api/design/${d.id}/builds`;
  for (const [method, path, body] of [
    ['GET', '/api/design/nope'], ['GET', '/api/design/d_000000000000'],
    ['PATCH', '/api/design/nope', {}], ['DELETE', '/api/design/d_000000000000'],
    ['POST', `${B}/nope/stop`, {}], ['POST', `${B}/b_000000000000/stop`, {}], ['POST', `${B}/${otherBuild}/stop`, {}],
    ['POST', `${B}/${buildId}/agents/nope/stop`, {}], ['POST', `${B}/${buildId}/agents/${otherAgent}/stop`, {}],
    ['POST', `${B}/${otherBuild}/answer`, { askId: 'as_00000000', answers: [] }],
    ['POST', `${B}/${otherBuild}/continue`, {}], ['POST', `${B}/nope/continue`, {}],
    ['POST', '/api/design/nope/versions/1/restore', {}],
  ]) {
    assert.equal((await call(method, path, body)).status, 404, `${method} ${path}`);
  }

  const prev = { header: process.env.WORCA_IDENTITY_HEADER, proxies: process.env.WORCA_IDENTITY_TRUSTED_PROXIES };
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';
  try {
    const alice = { 'x-test-user': 'alice@example.com' };
    const bob = { 'x-test-user': 'bob@example.com' };
    const c = await call('POST', '/api/design', { kind: 'web', title: 'Alice' }, alice);
    assert.equal(c.status, 201);
    const a = c.json.design;
    assert.equal(a.createdBy, 'alice@example.com');
    const { buildId: ab } = await designBuilds.start({ designId: a.id, brief: 'MOCK_SECTIONS=1', by: 'alice@example.com' });
    await designBuilds.settled();
    const agentId = listAgents(ab)[0].id;
    const AB = `/api/design/${a.id}/builds/${ab}`;
    // Each of these would answer something other than 404 if the owner check were gone (200, 409, 422 or 400).
    for (const [method, path, body] of [
      ['GET', `/api/design/${a.id}`],
      ['PATCH', `/api/design/${a.id}`, { title: 'Bob was here' }],
      ['POST', `${AB}/stop`, {}],
      ['POST', `${AB}/agents/${agentId}/stop`, {}],
      ['POST', `${AB}/answer`, {}],
      ['POST', `${AB}/continue`, { sections: 'x' }],
      ['POST', `/api/design/${a.id}/versions/abc/restore`, {}],
      // P6's two routes, outside DESIGN_ROUTES: the export of Alice's finished design would answer 200, and the
      // thumbnail its own 404 words; the loop asserts the owner check's 'design not found' body.
      ['POST', `/api/design/${a.id}/export`, { format: 'html' }],
      ['GET', `/api/design/${a.id}/thumb`],
      ['DELETE', `/api/design/${a.id}`],
    ]) {
      const r = await call(method, path, body, bob);
      assert.equal(r.status, 404, `bob ${method} ${path}`);
      assert.deepEqual(r.json, { error: 'design not found' });
    }
    assert.equal(getDesign(a.id).title, 'Alice');
    assert.ok(existsSync(designDir(a.id)));
    const ids = async (h) => (await call('GET', '/api/design', undefined, h)).json.map((x) => x.id);
    assert.equal((await ids(bob)).includes(a.id), false, "bob's list omits it");
    assert.equal((await ids(alice)).includes(a.id), true, 'alice sees it');
    assert.equal((await call('GET', `/api/design/${a.id}`, undefined, alice)).status, 200);
    assert.equal((await call('GET', `/api/design/${a.id}`)).status, 200, 'no shared sign-in: the local viewer sees every design');
    const nobody = newDesign({ createdBy: null });
    assert.equal((await call('GET', `/api/design/${nobody.id}`, undefined, bob)).status, 200, "a design with no maker is everyone's");
    assert.equal((await ids(bob)).includes(nobody.id), true);
  } finally {
    for (const [k, v] of [['WORCA_IDENTITY_HEADER', prev.header], ['WORCA_IDENTITY_TRUSTED_PROXIES', prev.proxies]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('stop: idempotent, on a live build, a paused one and a finished one; another design 404', async () => {
  const d = await make();
  const { buildId } = await designBuilds.start({ designId: d.id, brief: 'MOCK_HANG_LEAD', by: 'local' });
  const url = `/api/design/${d.id}/builds/${buildId}/stop`;
  assert.deepEqual((await call('POST', url, {})).json, { ok: true });
  await designBuilds.settled();
  assert.deepEqual((await call('POST', url, {})).json, { ok: true });
  assert.equal(getBuild(buildId).status, 'stopped');
  const other = await make();
  assert.equal((await call('POST', `/api/design/${other.id}/builds/${buildId}/stop`, {})).status, 404);

  const p = await make();
  const { buildId: pb } = await designBuilds.start({ designId: p.id, brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero', by: 'local' });
  await designBuilds.settled();
  assert.equal(getBuild(pb).status, 'paused');
  assert.deepEqual((await call('POST', `/api/design/${p.id}/builds/${pb}/stop`)).json, { ok: true });
  assert.deepEqual([getBuild(pb).status, getBuild(pb).reason], ['stopped', 'user'], 'a paused build is closed before the route answers');

  const f = await make();
  const { buildId: fb } = await designBuilds.start({ designId: f.id, brief: 'MOCK_SECTIONS=1', by: 'local' });
  await designBuilds.settled();
  assert.equal(getBuild(fb).status, 'done');
  assert.deepEqual((await call('POST', `/api/design/${f.id}/builds/${fb}/stop`, {})).json, { ok: true });
  assert.equal(getBuild(fb).status, 'done');

  // Stop of a paused build is awaited: a refusal while closing it answers its status, never {ok:true}.
  const refusing = Object.create(designBuilds, { stopBuild: { value: async () => { throw new DesignRefusal(500, 'could not close the build'); } } });
  const r = await (await mkApp({ designBuilds: refusing }))('POST', `/api/design/${f.id}/builds/${fb}/stop`, {});
  assert.deepEqual([r.status, r.json], [500, { error: 'could not close the build' }]);
});

test('stop one agent: ok, then 404 for an unknown one', async () => {
  const d = await make();
  const { buildId } = await designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=2 MOCK_HANG_SECTION=hero', by: 'local' });
  await waitForFrame(frames, (f) => f.type === 'design-delta' && f.buildId === buildId && f.sectionId === 'hero');
  const B = `/api/design/${d.id}/builds/${buildId}`;
  assert.equal((await call('POST', `${B}/agents/a_00000000/stop`, {})).status, 404);
  assert.equal((await call('POST', `${B}/agents/nope/stop`, {})).status, 404);
  const hero = listAgents(buildId).find((a) => a.sectionId === 'hero');
  assert.deepEqual((await call('POST', `${B}/agents/${hero.id}/stop`)).json, { ok: true });
  await designBuilds.settled();
  assert.deepEqual([getBuild(buildId).status, getBuild(buildId).reason], ['done', 'partial'], 'only that agent stopped');
  assert.equal(listAgents(buildId).find((a) => a.id === hero.id).status, 'stopped');
  const r = await call('POST', `${B}/agents/${hero.id}/stop`, {});
  assert.deepEqual([r.status, r.json], [409, { error: 'The build is not running' }]);
});

test('answer: 200, 409, 422', async () => {
  const d = await make();
  const { buildId } = await designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', by: 'local' });
  const q = await waitForFrame(frames, (f) => f.type === 'design-question' && f.buildId === buildId);
  const url = `/api/design/${d.id}/builds/${buildId}/answer`;
  for (const b of [undefined, {}, { askId: q.askId }, { answers: [] }, { askId: 5, answers: [] }, { askId: q.askId, answers: 'a' }]) {
    assert.equal((await call('POST', url, b)).status, 422, JSON.stringify(b));
  }
  assert.equal((await call('POST', url, { askId: q.askId, answers: [{ id: 'q1', value: 'z' }] })).status, 422, 'not one of its options');
  assert.equal((await call('POST', url, { askId: 'as_00000000', answers: [{ id: 'q1', value: 'a' }] })).status, 409, 'wrong askId');
  assert.deepEqual(await call('POST', url, { askId: q.askId, answers: [{ id: 'q1', value: 'a' }] }), { status: 200, json: { ok: true } });
  assert.equal((await call('POST', url, { askId: q.askId, answers: [{ id: 'q1', value: 'a' }] })).status, 409, 'again');
  await designBuilds.settled();
  assert.equal(getBuild(buildId).status, 'done');
  assert.equal((await call('POST', url, { askId: q.askId, answers: [{ id: 'q1', value: 'a' }] })).status, 409, 'a finished build');

  // Paused by a drain while the question waits (L2.29): the build is not in memory, so the answer is 409 (L2.25).
  const p = await make();
  const { buildId: pb } = await designBuilds.start({ designId: p.id, brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', by: 'local' });
  const pq = await waitForFrame(frames, (f) => f.type === 'design-question' && f.buildId === pb);
  designBuilds.pauseAll();
  await designBuilds.settled();
  assert.deepEqual([getBuild(pb).status, designBuilds.get(pb)], ['paused', null]);
  const r = await call('POST', `/api/design/${p.id}/builds/${pb}/answer`, { askId: pq.askId, answers: [{ id: 'q1', value: 'a' }] });
  assert.deepEqual([r.status, r.json], [409, { error: 'This question is no longer open' }]);
  await call('POST', `/api/design/${p.id}/builds/${pb}/stop`, {});
  assert.equal(getBuild(pb).status, 'stopped');
});

test('continue: 202 with sections or with no body; 409, 422, 403, 503, credential refusal 409', async () => {
  const failed = async () => {
    const d = await make();
    const { buildId } = await designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=2 MOCK_FAIL_SECTION=hero', by: 'local' });
    await designBuilds.settled();
    assert.deepEqual([getBuild(buildId).status, getBuild(buildId).reason], ['paused', 'failed']);
    return { d, buildId, url: `/api/design/${d.id}/builds/${buildId}/continue` };
  };

  const one = await failed();
  assert.equal((await call('POST', one.url, { sections: 'x' })).status, 422);
  assert.equal((await call('POST', one.url, { sections: ['hero', 7] })).status, 422);
  assert.equal((await call('POST', one.url, { sections: null })).status, 422);
  assert.equal((await call('POST', one.url, { sections: ['ghost'] })).status, 422, 'a paused build: the build refuses an unknown section');
  assert.equal(getBuild(one.buildId).status, 'paused');
  assert.deepEqual(await call('POST', one.url, { sections: ['hero'] }), { status: 202, json: { ok: true } });
  await designBuilds.settled();
  assert.deepEqual([getBuild(one.buildId).status, getBuild(one.buildId).reason], ['done', null]);
  assert.equal((await call('POST', one.url, {})).status, 409, 'done, reason null: nothing to continue');
  assert.equal((await call('POST', one.url, { sections: ['ghost'] })).status, 409, 'on a done build an unknown section is 409');
  assert.equal((await call('POST', one.url, { sections: 'x' })).status, 422, 'the body is checked before any lookup');
  assert.equal((await call('POST', one.url, { sections: ['hero', 7] })).status, 422, 'every item must be a section id');

  const two = await failed();
  assert.deepEqual(await call('POST', two.url), { status: 202, json: { ok: true } }, 'no body: every unfinished section');
  await designBuilds.settled();
  assert.equal(getBuild(two.buildId).status, 'done');
  assert.equal(getBuild(two.buildId).sections.every((s) => s.status === 'done'), true);

  // With the mock on, a refusing credential gate is never asked.
  const asked = [];
  const gated = await mkApp({ designBuilds, brokerStartRefusal: async (req, models) => { asked.push(models); return 'no key'; } });
  const three = await failed();
  assert.equal((await gated('POST', three.url, {})).status, 202);
  assert.deepEqual(asked, []);
  await designBuilds.settled();

  // worca's total limit, and a drain.
  const four = await failed();
  const blocked = await mkApp({ designBuilds: registry({ deps: { budgetStatus: () => ({ blocked: true }) } }) });
  assert.deepEqual(await blocked('POST', four.url, {}), { status: 403, json: { error: 'total cost limit reached' } });
  const drained = await mkApp({ designBuilds: registry({ draining: () => true }) });
  assert.equal((await drained('POST', four.url, {})).status, 503);
  assert.equal(getBuild(four.buildId).status, 'paused');

  // The mock off (mockEnabled reads the env): the gate refuses before anything starts.
  const spawns = [];
  const live = registry({ deps: { mock: false, runClaude: async (o) => { spawns.push(o); throw new Error('no live Claude in tests'); } } });
  const credential = await mkApp({ designBuilds: live, brokerStartRefusal: async (req, models) => { asked.push(models); return 'no key'; } });
  const saved = { WORCA_MOCK: process.env.WORCA_MOCK, ORCH_MOCK: process.env.ORCH_MOCK };
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  let r;
  try {
    r = await credential('POST', four.url, {});
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  assert.deepEqual([r.status, r.json], [409, { error: 'no key', code: 'credential-missing' }]);
  assert.deepEqual(asked, [[]], 'no role set: brokerStartRefusal gets an empty model list');
  assert.deepEqual([spawns.length, live.get(four.buildId), getBuild(four.buildId).status], [0, null, 'paused']);
  await call('POST', `/api/design/${four.d.id}/builds/${four.buildId}/stop`, {});

  // `by` is the person asking: their Continue is billed to them.
  const billed = [];
  const billing = registry({ deps: { runClaude: (o) => { billed.push(currentBillTo()); return runClaude({ ...o, mock: true }); } } });
  const billApp = await mkApp({ designBuilds: billing });
  const prevHeader = process.env.WORCA_IDENTITY_HEADER;
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  try {
    const ada = { 'x-test-user': 'ada@example.com' };
    const mine = (await call('POST', '/api/design', { kind: 'web' }, ada)).json.design;
    const { buildId } = await designBuilds.start({ designId: mine.id, brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero', by: 'ada@example.com' });
    await designBuilds.settled();
    assert.equal((await billApp('POST', `/api/design/${mine.id}/builds/${buildId}/continue`, {}, ada)).status, 202);
    await billing.settled();
    assert.equal(getBuild(buildId).status, 'done');
  } finally {
    if (prevHeader === undefined) delete process.env.WORCA_IDENTITY_HEADER; else process.env.WORCA_IDENTITY_HEADER = prevHeader;
  }
  assert.ok(billed.length > 0);
  assert.deepEqual([...new Set(billed)], ['ada@example.com']);
});

test('continue and answer check the broker first', async () => {
  const d = await make();
  const { buildId } = await designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'local' });
  await designBuilds.settled();
  const asked = [];
  const refusing = await mkApp({ designBuilds, brokerStartRefusal: async (req, models) => { asked.push(models); return 'You have not added your key yet.'; } });
  const B = `/api/design/${d.id}/builds/${buildId}`;
  const saved = { WORCA_MOCK: process.env.WORCA_MOCK, ORCH_MOCK: process.env.ORCH_MOCK };
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  let cont;
  let answer;
  try {
    cont = await refusing('POST', `${B}/continue`, {});
    answer = await refusing('POST', `${B}/answer`, { askId: 'as_ab12cd34', answers: [{ id: 'q1', value: 'a' }] });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  const refusal = { code: 'credential-missing', error: 'You have not added your key yet.' };
  assert.deepEqual([cont.status, cont.json], [409, refusal]);
  assert.deepEqual([answer.status, answer.json], [409, refusal]);
  assert.deepEqual(asked, [[], []], 'both ask with the design\'s build models');
});

test('restore: 400 on a bad n, 409 while a build runs or is paused, delegates to versions, 404 without one', async () => {
  const d = await make();
  assert.deepEqual(await call('POST', `/api/design/${d.id}/versions/3/restore`, {}), { status: 404, json: { error: 'That version is no longer kept' } });
  const restored = [];
  const versions = {
    list: async () => [],
    restore: async (id, n) => {
      if (n === 8) throw Object.assign(new Error('gone'), { status: 404 });
      if (n === 9) throw new DesignError('NOT_FOUND', 'gone');
      if (n === 10) throw new Error('disk full');
      restored.push([id, n]);
    },
  };
  const v = await mkApp({ designBuilds, versions });
  for (const n of ['abc', '0', '01', '-1', '1.5', '1e3', '9'.repeat(400)]) {   // the last one passes the pattern but is no safe integer
    assert.deepEqual(await v('POST', `/api/design/${d.id}/versions/${n}/restore`, {}), { status: 400, json: { error: 'version must be a whole number' } }, n);
  }
  assert.deepEqual(await v('POST', `/api/design/${d.id}/versions/3/restore`, {}), { status: 200, json: { ok: true } });
  assert.deepEqual(restored, [[d.id, 3]]);
  for (const n of [8, 9]) {
    assert.deepEqual(await v('POST', `/api/design/${d.id}/versions/${n}/restore`), { status: 404, json: { error: 'That version is no longer kept' } }, String(n));
  }
  assert.equal((await v('POST', `/api/design/${d.id}/versions/10/restore`, {})).status, 500);

  const busy = { status: 409, json: { error: 'A build is running: stop it first' } };
  const { buildId } = await designBuilds.start({ designId: d.id, brief: 'MOCK_HANG_LEAD', by: 'local' });
  assert.deepEqual(await v('POST', `/api/design/${d.id}/versions/3/restore`, {}), busy, 'a live build');
  await call('POST', `/api/design/${d.id}/builds/${buildId}/stop`, {}); await designBuilds.settled();

  const { buildId: pb } = await designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero', by: 'local' });
  await designBuilds.settled();
  assert.equal(getBuild(pb).status, 'paused');
  assert.deepEqual(await v('POST', `/api/design/${d.id}/versions/3/restore`, {}), busy, 'a paused build');
  assert.deepEqual(restored, [[d.id, 3]]);
  await call('POST', `/api/design/${d.id}/builds/${pb}/stop`, {});
  assert.equal((await v('POST', `/api/design/${d.id}/versions/3/restore`, {})).status, 200);
});

test('P5: a restore holds the design: a second restore, a Continue and a Delete answer 409 while it runs; a failed restore is a 500 with no path', async () => {
  const d = await make();
  const { buildId } = await designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero', by: 'local' });
  await designBuilds.settled();
  await call('POST', `/api/design/${d.id}/builds/${buildId}/stop`, {});
  assert.equal(getBuild(buildId).status, 'stopped');
  let entered; const inside = new Promise((res) => { entered = res; });
  let release; const gate = new Promise((res) => { release = res; });
  let entries = 0;
  const leak = `EEXIST: file already exists, mkdir '${designWorkDir(d.id)}/assets'`;
  const v = await mkApp({ designBuilds, versions: { list: async () => [], restore: async (id, n) => {
    if (n === 7) throw Object.assign(new Error(leak), { code: 'EEXIST' });
    entries += 1;
    if (entries > 1) return { version: 5, restoredFrom: n };   // never parks a second one: an unheld route fails, not hangs
    entered(); await gate; return { version: 4, restoredFrom: n };
  } } });
  const first = v('POST', `/api/design/${d.id}/versions/1/restore`, {});
  await inside;
  const busy = { status: 409, json: { error: 'A restore is running: try again in a moment' } };
  assert.deepEqual(await v('POST', `/api/design/${d.id}/versions/1/restore`, {}), busy, 'a second restore (another tab)');
  assert.deepEqual(await v('POST', `/api/design/${d.id}/builds/${buildId}/continue`, {}), busy, 'a Continue');
  assert.deepEqual(await v('DELETE', `/api/design/${d.id}`), busy, 'a Delete: the restore would recreate work/ with no row');
  await assert.rejects(designBuilds.start({ designId: d.id, brief: 'x', by: 'local' }), (e) => e.status === 409 && e.message === busy.json.error);
  assert.equal(getBuild(buildId).status, 'stopped');
  release();
  assert.deepEqual(await first, { status: 200, json: { ok: true, version: 4, restoredFrom: 1 } });
  const e = await v('POST', `/api/design/${d.id}/versions/7/restore`, {});
  assert.deepEqual(e, { status: 500, json: { error: 'The page was not restored: try again' } }, 'no server path reaches the browser');
  assert.equal((await v('POST', `/api/design/${d.id}/builds/${buildId}/continue`, {})).status, 202, 'released after the throw');
  await designBuilds.settled();
});
test('P5: a chat hand-off holds the design against a Delete (409); a Delete before the hold leaves no folder, kit or upload copy behind', async () => {
  const dropped = []; const threads = [];
  const del = await mkApp({ designBuilds, dropGrants: (id) => { dropped.push(id); }, deleteThread: async (t) => { threads.push(t); } });
  const withChat = () => {   // the route's deleteThread is a fake: the upload stays readable, as while the real one awaits
    const d = newDesign(); const t = createThread({ mode: 'design', title: d.title });
    updateDesign(d.id, { threadId: t.id });
    addAttachment(t.id, appendMessage(t.id, { role: 'user', text: 'x' }).id, { name: 'logo.png', kind: 'image', mime: 'image/png', data: Buffer.from('private upload') });
    return { d, t };
  };
  const actions = ({ broker, stage }) => createDesignChatActions({
    designBuilds, receipts: { posted() {} }, flagOn: () => true, appendCardRow() {}, newCardId: () => 'card_00000001',
    brokerRefusal: async () => { await broker?.(); return null; },
    stageKit: async (o) => { await stage?.(); return stageDesignKit(o); },
  });
  const a = withChat();
  let entered; const inside = new Promise((res) => { entered = res; });
  let release; const gate = new Promise((res) => { release = res; });
  const staging = actions({ stage: () => { entered(); return gate; } }).apply({ kind: 'design-start', brief: 'MOCK_SECTIONS=1' }, { threadId: a.t.id, by: 'local' });
  await inside;
  assert.deepEqual(await del('DELETE', `/api/design/${a.d.id}`), { status: 409, json: { error: ROUND_STARTING } }, 'the round being staged would recreate the folder with no row');
  assert.ok(getDesign(a.d.id));
  assert.ok(existsSync(designDir(a.d.id)));
  assert.deepEqual([dropped, threads], [[], []], 'a refused delete drops nothing');
  release();
  assert.equal((await staging).ok, true);
  await designBuilds.settled();
  assert.deepEqual(await del('DELETE', `/api/design/${a.d.id}`), { status: 200, json: { ok: true } }, 'released once the round started');
  assert.equal(existsSync(designDir(a.d.id)), false);
  const b = withChat();
  let asked; const atBroker = new Promise((res) => { asked = res; });
  let open; const broker = new Promise((res) => { open = res; });
  let staged = 0;
  const handOff = actions({ broker: () => { asked(); return broker; }, stage: () => { staged += 1; } }).apply({ kind: 'design-start', brief: 'MOCK_SECTIONS=1' }, { threadId: b.t.id, by: 'local' });
  await atBroker;
  assert.deepEqual(await del('DELETE', `/api/design/${b.d.id}`), { status: 200, json: { ok: true } }, 'no hold yet: the Delete runs');
  assert.equal(existsSync(designDir(b.d.id)), false);
  open();
  assert.deepEqual(await handOff, { ok: false, notice: 'Could not start the build: design not found.' });
  assert.equal(staged, 0, 'refused before the kit is staged');
  assert.equal(existsSync(designDir(b.d.id)), false, 'no folder recreated: no kit and no copy of the deleted upload');
});

test('M10: delete answers 409 on CONFLICT under an open build; after a stop it removes the folder and rows, keeps the ledger', async () => {
  const dropped = []; const threads = [];
  const del = await mkApp({ designBuilds, dropGrants: (id) => { dropped.push(id); }, deleteThread: async (t) => { threads.push(t); } });
  const d = await make();
  const { buildId } = await designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_COST=0.25 MOCK_FAIL_SECTION=hero', by: 'local' });
  await designBuilds.settled();
  assert.equal(getBuild(buildId).status, 'paused');
  updateDesign(d.id, { threadId: 't_x' });
  assert.equal((await del('DELETE', `/api/design/${d.id}`)).status, 409);
  assert.ok(existsSync(designDir(d.id)));
  assert.deepEqual([dropped, threads], [[], []], 'a refused delete drops nothing');
  await call('POST', `/api/design/${d.id}/builds/${buildId}/stop`, {});
  await designBuilds.settled();
  assert.deepEqual(await del('DELETE', `/api/design/${d.id}`), { status: 200, json: { ok: true } });
  assert.equal(existsSync(designDir(d.id)), false);
  assert.equal(getDesign(d.id), null);
  assert.equal(getBuild(buildId), null);
  assert.ok(prepare('SELECT COUNT(*) n FROM design_cost_ledger WHERE design_id = ?').get(d.id).n > 0);
  assert.deepEqual([dropped, threads], [[d.id], ['t_x']]);
  const plain = newDesign();
  assert.equal((await del('DELETE', `/api/design/${plain.id}`)).status, 200);
  assert.deepEqual([dropped, threads], [[d.id, plain.id], ['t_x']], 'a design with no thread never calls deleteThread');
});

test('GET /:id: build.costKnown is a boolean, false after a MOCK_NO_COST build', async () => {
  const d = await make();
  const { buildId } = await designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_NO_COST', by: 'local' });
  await designBuilds.settled();
  const g = (await call('GET', `/api/design/${d.id}`)).json;
  assert.equal(g.build.id, buildId);
  assert.equal(g.build.costKnown, false);
  assert.equal('sections' in g.build, false, 'section records are in sections, not in build');
  assert.deepEqual(g.sections.map((s) => [s.id, s.status]), [['hero', 'done']]);
  assert.equal(g.plan.sections[0].id, 'hero', 'the valid plan.json on disk');

  const p = await make();
  const { buildId: pb } = await designBuilds.start({ designId: p.id, brief: 'MOCK_SECTIONS=1 MOCK_COST=0.25', by: 'local' });
  await designBuilds.settled();
  const priced = (await call('GET', `/api/design/${p.id}`)).json;
  assert.equal(priced.build.costKnown, true);
  assert.equal(priced.build.id, pb);

  // A section's `todo` and `unbuiltAdd` never leave the engine (L2.35); an invalid plan.json reads as null.
  updateBuild(pb, { sections: getBuild(pb).sections.map((s) => ({ ...s, todo: { stage: 'touch', brief: 'b' }, unbuiltAdd: true })) });
  writeFileSync(join(designWorkDir(p.id), 'plan.json'), '{"not":"a plan"}');
  const after = (await call('GET', `/api/design/${p.id}`)).json;
  assert.equal(after.sections.length, 1);
  assert.equal(after.sections.some((s) => 'todo' in s || 'unbuiltAdd' in s), false);
  assert.equal(after.plan, null);

  const listed = await mkApp({ designBuilds, versions: { list: async (id) => [{ n: 1, id }], restore: async () => {} } });
  assert.deepEqual((await listed('GET', `/api/design/${p.id}`)).json.versions, [{ n: 1, id: p.id }]);
});

test('the store and refusals map to their status', async () => {
  const d = await make();
  let err;
  const e = await mkApp({ designBuilds, versions: { list: async () => { throw err; }, restore: async () => {} } });
  for (const [thrown, status, json] of [
    [new DesignError('NOT_FOUND', 'gone'), 404, { error: 'gone' }],
    [new DesignError('BAD_REQUEST', 'bad'), 400, { error: 'bad' }],
    [new DesignError('CONFLICT', 'busy'), 409, { error: 'busy' }],
    [new DesignError('IO', 'disk'), 500, { error: 'disk' }],
    [new DesignRefusal(503, 'stopping'), 503, { error: 'stopping' }],
    [new DesignRefusal(409, 'no key', 'credential-missing'), 409, { error: 'no key', code: 'credential-missing' }],
    [Object.assign(new Error('closed'), { status: 410 }), 410, { error: 'closed' }],
    [new Error('boom'), 500, { error: 'boom' }],
  ]) {
    err = thrown;
    assert.deepEqual(await e('GET', `/api/design/${d.id}`), { status, json }, thrown.message);
  }
});
